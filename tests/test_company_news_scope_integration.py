"""Fictional releases, real catalogue structure; never an AI/publication call."""
from copy import deepcopy
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from company_news_catalogue import load_catalogue
from company_news_prtimes import parse_feed, extract_article
from company_news_runtime import (CompanyNewsRuntime, PREFIX, source_hash, source_fingerprint,
                                 source_catalogue, valid_source, valid_record, pending_candidates,
                                 public_snapshot, read_records, candidate_records,
                                 MAX_CANDIDATES_PER_DAY, StorageUnavailable, SupabaseNewsStorage)
from company_news_producer import _validated_source, WRITING_INSTRUCTION, REVIEW_INSTRUCTION
from scripts.run_company_news_job import run_job
from tests.test_company_news_prtimes import NOW, SINCE, URL, feed, feed_item, article
from tests.test_company_news_runtime import MemoryStorage, CountingStorage, record, source


def pr_source(catalogue=None):
    catalogue = catalogue or load_catalogue(now=NOW)
    issuer = '株式会社 日立製作所'
    title = '架空の設備の実験を開始・取得処理のテスト用'
    body = (issuer + 'による実際の発表ではありません。以下は取得処理を確認する架空の文章です。'
            'この架空の会社は、架空の設備の性能と使える条件を調べる実験を開始します。' * 3)
    item = parse_feed(feed(feed_item(issuer=issuer, title=title)), NOW, SINCE, catalogue)[0]
    return extract_article(article(author=issuer, company_label=issuer, title=title, body=body),
                           item, URL, NOW, SINCE, observed_at=NOW.timestamp()-2, catalogue=catalogue)


def catalogue_path(catalogue):
    return f'{PREFIX}/catalogues/{catalogue.facts_sha256}/{catalogue.provenance["source_sha256"]}.json'


class PagedStorage(CountingStorage, SupabaseNewsStorage):
    """Exercise the real adapter's bounded list transport without credentials."""
    def __init__(self):
        CountingStorage.__init__(self)
        self.pages = []

    def _list(self, prefix):
        raise AssertionError('company queue must not use the morning first-page limit')

    def _request(self, method, path, *, json):
        if method != 'POST' or path != '/object/list/website-news':
            raise AssertionError('unexpected storage operation')
        self.pages.append(deepcopy(json))
        rows = sorted(MemoryStorage._list(self, json['prefix']), key=lambda row: row['name'], reverse=True)
        rows = rows[json['offset']:json['offset'] + json['limit']]
        return SimpleNamespace(status_code=200, json=lambda: deepcopy(rows))


class ScopeIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.catalogue = load_catalogue(now=NOW)
        self.now = NOW.timestamp()
        self.storage = MemoryStorage()
        self.storage.create(catalogue_path(self.catalogue), self.catalogue.snapshot())
        self.src = pr_source(self.catalogue)

    def test_non_original_company_is_valid_only_with_matching_membership_issuer_and_source_id(self):
        self.assertEqual(self.src['symbol'], '6501.T')
        self.assertTrue(valid_source(self.src, self.now, catalogue=self.catalogue))
        for key, value in [('symbol', '9999.T'), ('name', '別の会社'), ('related_company', '日立製作所の取引先'),
                           ('company_id', '152542'), ('catalogue_facts_sha256', 'f'*64),
                           ('catalogue_source_sha256', 'f'*64), ('catalogue_as_of', '2026-10-07')]:
            damaged = dict(self.src, **{key: value})
            self.assertFalse(valid_source(damaged, self.now, catalogue=self.catalogue), key)

    def test_producer_binds_optional_proof_without_changing_legacy_review_hashes(self):
        clean = _validated_source(self.src, self.now)
        self.assertEqual(source_hash(clean), source_hash(self.src))
        changed = dict(self.src, business_context_mode='announcement_only')
        self.assertNotEqual(source_hash(changed), source_hash(self.src))
        self.assertEqual(source_hash(source()), source_hash(_validated_source(source(), self.now)))

    def test_membership_snapshot_is_cached_and_missing_or_modified_proof_fails_closed(self):
        storage = CountingStorage()
        path = catalogue_path(self.catalogue)
        self.assertIsNone(source_catalogue(storage, self.src))
        self.assertFalse(valid_source(self.src, self.now))
        saved = record(self.src); saved['company']['reviewed_at'] = self.now
        self.assertFalse(valid_record(saved, self.now))
        storage.create(f'{PREFIX}/candidates/2026-10-08/{source_fingerprint(self.src)}.json', self.src)
        self.assertEqual(candidate_records(storage, self.now), [])
        self.assertEqual(pending_candidates(storage, self.now, candidates=[self.src]), [])
        self.assertEqual(public_snapshot([saved], self.now, storage=storage)['companies'], [])
        modified = self.catalogue.snapshot(); modified['items'][0]['name'] = '異なる会社'
        storage.create(path, modified)
        self.assertIsNone(source_catalogue(storage, self.src))
        self.assertEqual(candidate_records(storage, self.now), [])
        storage.create(f'{PREFIX}/days/2026-10-08/published-1.json', saved)
        with self.assertRaisesRegex(StorageUnavailable, 'company_record_invalid'):
            read_records(storage, self.now)
        storage = CountingStorage(); storage.create(path, self.catalogue.snapshot())
        self.assertIsNotNone(source_catalogue(storage, self.src))
        self.assertIsNotNone(source_catalogue(storage, self.src))
        self.assertEqual(storage.reads, [path])

    def test_distinct_csv_provenance_with_same_facts_has_distinct_immutable_archive_keys(self):
        changed = self.catalogue.snapshot(); changed['source']['sha256'] = 'f' * 64
        second = load_catalogue(snapshot=changed, now=NOW)
        self.assertEqual(second.facts_sha256, self.catalogue.facts_sha256)
        self.assertNotEqual(catalogue_path(second), catalogue_path(self.catalogue))
        second_src = pr_source(second)
        self.assertTrue(self.storage.create(catalogue_path(second), second.snapshot()))
        for src, expected in ((self.src, self.catalogue), (second_src, second)):
            restored = source_catalogue(self.storage, src)
            self.assertEqual(restored.provenance['source_sha256'], expected.provenance['source_sha256'])
            self.assertTrue(valid_source(src, self.now, catalogue=restored))
        with tempfile.TemporaryDirectory() as temp:
            storage = MemoryStorage()
            runtime = CompanyNewsRuntime(storage, collector=lambda **_: {
                'status': 'ready', 'articles': [second_src], 'catalogue': second.snapshot()},
                clock=lambda: self.now, cache_path=temp + '/cache.json')
            runtime.run_once()
            self.assertIn(catalogue_path(second), storage.values)
            self.assertEqual(runtime.operational_snapshot()['pending_count'], 1)

    def test_legacy_facts_only_snapshot_fallback_requires_exact_csv_provenance(self):
        legacy_path = f'{PREFIX}/catalogues/{self.catalogue.facts_sha256}.json'
        storage = CountingStorage(); storage.create(legacy_path, self.catalogue.snapshot())
        self.assertIsNotNone(source_catalogue(storage, self.src))
        self.assertEqual(storage.reads, [catalogue_path(self.catalogue), legacy_path])
        damaged = dict(self.src, catalogue_source_sha256='f' * 64)
        self.assertIsNone(source_catalogue(storage, damaged))
        self.assertFalse(valid_source(damaged, self.now, catalogue=source_catalogue(storage, damaged)))

    def test_non_original_company_can_be_claimed_reviewed_and_read_using_same_snapshot(self):
        now = self.now + 20
        self.storage.create(f'{PREFIX}/candidates/2026-10-08/{source_fingerprint(self.src)}.json', self.src)
        def generate(src, **_):
            result = record(src)['company']; result['reviewed_at'] = self.now
            return result
        outcome = run_job(self.storage, generate, clock=lambda: now)
        self.assertEqual(outcome['published_count'], 1)
        records = read_records(self.storage, now)
        self.assertEqual(public_snapshot(records, now, storage=self.storage)['companies'][0]['symbol'], '6501.T')
        self.assertEqual(run_job(self.storage, generate, clock=lambda: now)['attempt_count'], 0)

    def test_removed_membership_does_not_erase_archived_approval_or_allow_new_generation(self):
        self.storage.create(f'{PREFIX}/candidates/2026-10-08/{source_fingerprint(self.src)}.json', self.src)
        saved = record(self.src); saved['company']['reviewed_at'] = self.now
        self.storage.create(f'{PREFIX}/days/2026-10-08/published-1.json', saved)
        class Changed:
            def is_member(self, symbol): return False
        with patch('company_news_catalogue.load_current_snapshot', return_value=Changed()):
            records = read_records(self.storage, self.now+20)
            self.assertEqual(len(public_snapshot(records, self.now+20, storage=self.storage)['companies']), 1)
            self.assertEqual(pending_candidates(self.storage, self.now+20), [])

    def test_removed_native_member_is_excluded_from_new_queue_but_approved_copy_is_retained(self):
        native = source()
        self.storage.create(f'{PREFIX}/candidates/2026-10-08/{source_fingerprint(native)}.json', native)
        self.storage.create(f'{PREFIX}/days/2026-10-08/published-1.json', record(native))
        class Changed:
            def is_member(self, symbol): return symbol != native['symbol']
        with patch('company_news_catalogue.load_current_snapshot', return_value=Changed()):
            self.assertEqual(candidate_records(self.storage, self.now), [])
            self.assertEqual(pending_candidates(self.storage, self.now, candidates=[native]), [])
            retained = read_records(self.storage, self.now)
            self.assertEqual(len(public_snapshot(retained, self.now, storage=self.storage)['companies']), 1)
            with tempfile.TemporaryDirectory() as temp:
                runtime = CompanyNewsRuntime(self.storage, clock=lambda: self.now, cache_path=temp+'/cache.json')
                runtime._pending = [native]
                self.assertEqual(runtime.operational_snapshot()['pending_count'], 0)

    def queue(self, storage, count):
        sources = [source(suffix=f'queue-{i:03}') for i in range(count)]
        important = min(sources, key=source_fingerprint)
        important['title'] = '架空の会社による事業買収の発表'
        for src in sources:
            storage.create(f'{PREFIX}/candidates/2026-10-08/{source_fingerprint(src)}.json', src)
        return sources, important

    def test_company_pagination_finds_late_important_candidate_for_selection_and_known_urls(self):
        storage = PagedStorage()
        sources, important = self.queue(storage, 110)
        found = candidate_records(storage, self.now)
        self.assertEqual(len(found), 110)
        self.assertEqual(found[0]['url'], important['url'])
        today_pages = [page for page in storage.pages if page['prefix'].endswith('2026-10-08')]
        self.assertEqual([page['offset'] for page in today_pages], [0, 100])
        self.assertEqual(pending_candidates(storage, self.now)[0]['url'], important['url'])
        initial_body_reads = sum('/candidates/' in path for path in storage.reads)
        known = []
        def collect(**options):
            known.extend(options['exclude_urls'])
            return {'status': 'ready', 'articles': []}
        with tempfile.TemporaryDirectory() as temp:
            runtime = CompanyNewsRuntime(storage, collector=collect, clock=lambda: self.now,
                                         cache_path=temp+'/cache.json')
            runtime.run_once()
            self.assertEqual(runtime.operational_snapshot()['pending_count'], 1)
        self.assertEqual(set(known), {src['url'] for src in sources})
        self.assertEqual(sum('/candidates/' in path for path in storage.reads), initial_body_reads)
        found[0]['title'] = 'caller modification'
        self.assertEqual(candidate_records(storage, self.now)[0]['title'], important['title'])

    def test_exact_queue_bound_is_complete_and_overflow_cannot_start_paid_generation(self):
        storage = PagedStorage()
        self.queue(storage, MAX_CANDIDATES_PER_DAY)
        self.assertEqual(len(candidate_records(storage, self.now)), MAX_CANDIDATES_PER_DAY)
        probe = [page for page in storage.pages if page['prefix'].endswith('2026-10-08')][-1]
        self.assertEqual((probe['offset'], probe['limit']), (MAX_CANDIDATES_PER_DAY, 1))
        overflow = PagedStorage(); self.queue(overflow, MAX_CANDIDATES_PER_DAY+1)
        def unused(*_, **__): raise AssertionError('queue overflow must never invoke AI')
        with self.assertRaisesRegex(StorageUnavailable, 'company_queue_limit'):
            run_job(overflow, unused, clock=lambda: self.now)
        self.assertFalse(any('/candidates/' in path for path in overflow.reads))
        self.assertFalse(any('/attempt-' in path or '/seen/' in path for path in overflow.values))

    def test_queue_scan_timeout_preserves_completed_immutable_reads_and_old_cache_is_pruned(self):
        clock = [0]
        class SlowStorage(PagedStorage):
            def read(self, path):
                if '/candidates/' in path:
                    clock[0] += 15
                return super().read(path)
        storage = SlowStorage(); self.queue(storage, 7)
        with patch('company_news_runtime.time.monotonic', side_effect=lambda: clock[0]):
            with self.assertRaisesRegex(StorageUnavailable, 'company_queue_timeout'):
                candidate_records(storage, self.now)
            self.assertEqual(len(storage._company_candidate_cache), 4)
            found = candidate_records(storage, self.now)
        self.assertEqual(len(found), 7)
        self.assertEqual(sum('/candidates/' in path for path in storage.reads), 7)
        stale_path = f'{PREFIX}/candidates/2026-10-05/{source_fingerprint(source())}.json'
        storage._company_candidate_cache[stale_path] = source()
        candidate_records(storage, self.now)
        self.assertNotIn(stale_path, storage._company_candidate_cache)

    def test_full_daily_claims_do_not_enumerate_company_queue(self):
        storage = PagedStorage()
        for slot in range(1, 4):
            storage.create(f'{PREFIX}/days/2026-10-08/attempt-{slot}.json', {'symbol': '9432.T'})
        self.assertEqual(pending_candidates(storage, self.now), [])
        self.assertEqual(storage.pages, [])

    def test_publication_is_not_globally_limited_to_three_companies(self):
        records = [record(source(symbol)) for symbol in ('9432.T', '9433.T', '6752.T')]
        saved = record(self.src); saved['company']['reviewed_at'] = self.now
        records.append(saved)
        self.assertEqual(len(public_snapshot(records, self.now+20, storage=self.storage)['companies']), 4)
        metadata = public_snapshot(records, self.now+20, storage=self.storage)
        self.assertEqual(metadata['max_generation_attempts_per_day'], 3)
        self.assertNotIn('max_companies_per_day', metadata)

    def test_runtime_retains_safe_partial_coverage_and_snapshot_before_candidates(self):
        with tempfile.TemporaryDirectory() as temp:
            runtime = CompanyNewsRuntime(self.storage, collector=lambda **_: {
                'status': 'ready', 'articles': [self.src], 'catalogue': self.catalogue.snapshot(),
                'collection_health': 'partial', 'diagnostics': {}}, clock=lambda: self.now+20,
                cache_path=temp+'/cache.json')
            runtime.run_once()
            status = runtime.operational_snapshot()
            self.assertEqual(status['pending_count'], 1)
            self.assertEqual(status['coverage']['candidate_company_count'], 225)
            self.assertEqual(status['max_generation_attempts_per_day'], 3)
            self.assertNotIn('max_companies_per_day', status)
            self.assertFalse(status['coverage']['all_company_announcements_covered'])
            self.assertEqual(status['collection_health'], 'partial')
            self.assertLess(len(__import__('json').dumps(status).encode()), 8192)

    def test_missing_business_evidence_does_not_authorize_a_guessed_business(self):
        self.assertIn('announcement_only', WRITING_INSTRUCTION)
        self.assertIn('共同相手や子会社', WRITING_INSTRUCTION)
        self.assertIn('不明と明記', REVIEW_INSTRUCTION)

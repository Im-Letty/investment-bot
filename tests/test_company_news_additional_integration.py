"""Registry integration boundaries; fictional copy, no network or AI calls.

The additional source module owns inspected HTML/identity extraction tests.
These tests isolate its identity predicate to verify the durable membership
handoff, existing copy receipts, safe status output and unchanged paid limits.
"""
import ast
from copy import deepcopy
from datetime import datetime
from hashlib import sha256
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import company_news_additional as additional
import company_news_runtime as runtime
from company_news_catalogue import load_catalogue
from company_news_producer import _validated_source
from scripts.run_company_news_job import run_job
from tests.test_company_news_runtime import MemoryStorage, NOW, record, source


class AdditionalIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.catalogue = load_catalogue(now=datetime.fromtimestamp(NOW, runtime.JST))
        self.label, self.config = next(iter(additional.SOURCES.items()))
        member = self.catalogue.members[self.config['symbol']]
        # A positive mocked predicate represents a separately verified body.
        # Source-specific extraction and identity have their own module tests.
        self.src = {**source(), 'source': self.label, 'symbol': member['symbol'],
            'name': member['name'], 'related_company': self.config.get('issuer', member['name']),
            'url': f"https://{self.config['host']}/news/integration-fixture.html",
            'business_url': f"https://{self.config['host']}/news/integration-fixture.html",
            'business_context_mode': 'announcement_only',
            'catalogue_as_of': self.catalogue.provenance['as_of'],
            'catalogue_facts_sha256': self.catalogue.facts_sha256,
            'catalogue_source_sha256': self.catalogue.provenance['source_sha256']}
        self.path = (f'{runtime.PREFIX}/catalogues/{self.catalogue.facts_sha256}/'
                     f'{self.catalogue.provenance["source_sha256"]}.json')
        self.storage = MemoryStorage()
        self.storage.create(self.path, self.catalogue.snapshot())

    def queue(self, storage=None):
        storage = self.storage if storage is None else storage
        path = (f'{runtime.PREFIX}/candidates/2026-10-08/'
                f'{runtime.source_fingerprint(self.src)}.json')
        storage.create(path, self.src)

    def test_registered_label_always_requires_valid_identity_and_membership_snapshot(self):
        with patch.object(runtime, 'valid_identity', return_value=True) as identity:
            self.assertFalse(runtime.valid_source(self.src, NOW))
            identity.assert_not_called()
            self.assertTrue(runtime.valid_source(self.src, NOW, catalogue=self.catalogue))
            identity.assert_called_once_with(self.src, self.catalogue)
        with patch.object(runtime, 'valid_identity', return_value=False):
            self.assertFalse(runtime.valid_source(self.src, NOW, catalogue=self.catalogue))
        self.assertFalse(runtime.valid_source(dict(self.src, url='https://unregistered.example/news.html'),
                                              NOW, catalogue=self.catalogue))

    def test_unsafe_urls_are_rejected_even_if_the_identity_predicate_is_mocked_positive(self):
        with patch.object(runtime, 'valid_identity', return_value=True):
            for url in ('http://example.com/news', 'https://user@example.com/news',
                        'https://example.com:444/news', 'https://example.com/news?private=1',
                        'https://example.com/news#secret'):
                with self.subTest(url=url):
                    self.assertFalse(runtime.valid_source(dict(self.src, url=url), NOW,
                                                          catalogue=self.catalogue))

    def test_missing_or_changed_archived_proof_never_reaches_generator_or_public_copy(self):
        for damaged in ('missing', 'facts', 'source'):
            storage = MemoryStorage()
            if damaged != 'missing':
                changed = self.catalogue.snapshot()
                if damaged == 'facts':
                    changed['items'][0]['name'] = '架空の異なる会社'
                else:
                    changed['source']['sha256'] = 'f' * 64
                storage.create(self.path, changed)
            self.queue(storage)
            with patch.object(runtime, 'valid_identity', return_value=True):
                self.assertIsNone(runtime.source_catalogue(storage, self.src))
                self.assertEqual(runtime.candidate_records(storage, NOW), [])
                self.assertEqual(runtime.pending_candidates(storage, NOW, candidates=[self.src]), [])
                result = run_job(storage, lambda *_args, **_kw: self.fail('AI must not run'),
                                 clock=lambda: NOW)
                self.assertEqual(result['attempt_count'], 0)
                self.assertEqual(runtime.public_snapshot([record(self.src)], NOW, storage=storage)['companies'], [])

    def test_source_hash_binds_existing_provenance_fields_and_preserves_legacy_hash(self):
        clean = _validated_source(self.src, NOW)
        self.assertEqual(runtime.source_hash(clean), runtime.source_hash(self.src))
        for key, value in (('catalogue_as_of', '2026-10-07'),
                           ('catalogue_facts_sha256', 'f' * 64),
                           ('catalogue_source_sha256', 'f' * 64),
                           ('business_context_mode', 'verified_profile'),
                           ('related_company', '架空の別会社')):
            with self.subTest(key=key):
                self.assertNotEqual(runtime.source_hash(dict(self.src, **{key: value})),
                                    runtime.source_hash(self.src))
        legacy = source()
        self.assertEqual(runtime.source_hash(legacy), runtime.source_hash(_validated_source(legacy, NOW)))

    def test_removed_current_member_keeps_archived_approved_card_but_blocks_new_generation(self):
        self.queue()
        self.storage.create(f'{runtime.PREFIX}/days/2026-10-08/published-1.json', record(self.src))
        class ChangedCatalogue:
            def is_member(self, _symbol):
                return False
        with patch('company_news_catalogue.load_current_snapshot', return_value=ChangedCatalogue()), \
                patch.object(runtime, 'valid_identity', return_value=True) as identity:
            self.assertEqual(runtime.candidate_records(self.storage, NOW), [])
            self.assertEqual(runtime.pending_candidates(self.storage, NOW, candidates=[self.src]), [])
            restored = runtime.read_records(self.storage, NOW)
            public = runtime.public_snapshot(restored, NOW, storage=self.storage)
        self.assertEqual(len(public['companies']), 1)
        self.assertTrue(all(isinstance(call.args[1].members, dict) for call in identity.call_args_list))
        self.assertTrue(all(call.args[1].facts_sha256 == self.catalogue.facts_sha256
                            for call in identity.call_args_list))

    def test_later_business_profile_does_not_invalidate_an_archived_announcement_only_card(self):
        import company_news_catalogue
        config = additional.SOURCES['トヨタ自動車']
        bare = load_catalogue(snapshot=self.catalogue.snapshot(), editorial_path=None,
                              now=datetime.fromtimestamp(NOW, runtime.JST))
        url = 'https://global.toyota/jp/newsroom/corporate/12345678.html'
        body = (config['issuer'] + 'は、新しい設備を使う架空の実験を開始します。'
                '取得処理を確かめる架空の文章であり、実際の企業発表ではありません。'
                '設備の性能と利用条件を調べる計画を立て、結果を確かめるためのテストです。') * 3
        src = {**self.src, 'source': 'トヨタ自動車', 'symbol': config['symbol'],
               'name': bare.members[config['symbol']]['name'], 'related_company': config['issuer'],
               'url': url, 'body': body, 'body_sha256': sha256(body.encode()).hexdigest(),
               'business': body[:1800], 'business_url': url, 'business_context_mode': 'announcement_only',
               'catalogue_as_of': bare.provenance['as_of'], 'catalogue_facts_sha256': bare.facts_sha256,
               'catalogue_source_sha256': bare.provenance['source_sha256']}
        self.assertTrue(additional.valid_identity(src, bare))
        with tempfile.TemporaryDirectory() as temp:
            profile = Path(temp, 'new-profile.json')
            profile.write_text(json.dumps({'schema_version': 1, 'items': [{
                'symbol': src['symbol'], 'name': src['name'], 'reviewed_on': '2026-10-08',
                'business': '新しい会社説明が後から確認されたという架空のテスト情報です。',
                'sources': [{'title': '架空の検証用会社説明',
                             'url': 'https://global.toyota/jp/company/profile/'}]}]}, ensure_ascii=False))
            updated = load_catalogue(snapshot=bare.snapshot(), editorial_path=profile,
                                     now=datetime.fromtimestamp(NOW, runtime.JST))
            self.assertNotEqual(updated.members[src['symbol']]['business'], src['business'])
            self.assertEqual(updated.facts_sha256, bare.facts_sha256)
            self.assertTrue(additional.valid_identity(src, updated))
            storage = MemoryStorage()
            storage.create(f'{runtime.PREFIX}/catalogues/{bare.facts_sha256}/'
                           f'{bare.provenance["source_sha256"]}.json', bare.snapshot())
            storage.create(f'{runtime.PREFIX}/days/2026-10-08/published-1.json', record(src))
            original_loader = company_news_catalogue.load_catalogue
            def later_profile(*args, **kwargs):
                return original_loader(*args, **{**kwargs, 'editorial_path': profile})
            with patch.object(company_news_catalogue, 'load_catalogue', side_effect=later_profile):
                archived = runtime.read_records(storage, NOW)
                self.assertEqual(len(runtime.public_snapshot(archived, NOW, storage=storage)['companies']), 1)
            # The retained source and both original review hashes stay intact.
            self.assertEqual(archived[0]['source']['business_context_mode'], 'announcement_only')
            self.assertEqual(archived[0]['company']['source_sha256'], runtime.source_hash(src))

    def test_new_route_uses_existing_exact_copy_receipts_and_never_exposes_source_body(self):
        good = record(self.src)
        with patch.object(runtime, 'valid_identity', return_value=True):
            self.assertTrue(runtime.valid_record(good, NOW, catalogue=self.catalogue))
            for provider in ('gemini', 'openai'):
                for key in ('approved', 'content_sha256', 'source_sha256'):
                    changed = deepcopy(good)
                    changed['company']['reviews'][provider][key] = False if key == 'approved' else 'f' * 64
                    self.assertFalse(runtime.valid_record(changed, NOW, catalogue=self.catalogue))
            changed = deepcopy(good)
            changed['company']['event'] += '本文にない架空の追加。'
            self.assertFalse(runtime.valid_record(changed, NOW, catalogue=self.catalogue))
            public = runtime.public_snapshot([good], NOW, storage=self.storage)
        self.assertEqual(len(public['companies']), 1)
        self.assertEqual(public['max_generation_attempts_per_day'], 3)
        encoded = json.dumps(public, ensure_ascii=False)
        for private in ('body_sha256', 'body_verified_at', 'catalogue_facts_sha256',
                        'reviews', self.src['body']):
            self.assertNotIn(private, encoded)

    def test_successful_additional_candidate_is_claimed_once_without_changing_daily_slots(self):
        self.queue()
        calls = []
        def generate(src, **_):
            calls.append(src['symbol'])
            return record(src)['company']
        with patch.object(runtime, 'valid_identity', return_value=True):
            result = run_job(self.storage, generate, clock=lambda: NOW)
            again = run_job(self.storage, generate, clock=lambda: NOW)
            restored = runtime.read_records(self.storage, NOW)
            self.assertEqual(len(runtime.public_snapshot(restored, NOW, storage=self.storage)['companies']), 1)
            for slot in (2, 3):
                self.storage.create(f'{runtime.PREFIX}/days/2026-10-08/attempt-{slot}.json', {'symbol': 'other'})
            self.assertEqual(runtime.pending_candidates(self.storage, NOW, candidates=[self.src]), [])
        self.assertEqual((result['attempt_count'], result['published_count']), (1, 1))
        self.assertEqual(again['attempt_count'], 0)
        self.assertEqual(len(calls), 1)
        self.assertEqual(set(path.rsplit('/', 1)[-1] for path in self.storage.values if '/attempt-' in path),
                         {'attempt-1.json', 'attempt-2.json', 'attempt-3.json'})

    def test_dynamic_coverage_and_safe_failure_diagnostics_fit_the_existing_clock_envelope(self):
        diagnostics = {label: {'feed_status': 'ok', 'status': 'no_matching_candidates', 'errors': []}
                       for label in runtime.CHANNEL_NAMES}
        diagnostics[self.label] = {'feed_status': 'failed', 'status': 'feed_failed',
            'errors': ['source_unavailable', 'sk-private-error'], 'body': 'private body'}
        with tempfile.TemporaryDirectory() as temp:
            worker = runtime.CompanyNewsRuntime(self.storage, collector=lambda **_: {
                'status': 'ready', 'articles': [], 'catalogue': self.catalogue.snapshot(),
                'collection_health': 'partial', 'diagnostics': diagnostics},
                clock=lambda: NOW, cache_path=temp + '/cache.json')
            worker.run_once()
            result = worker.operational_snapshot()
        self.assertEqual(set(result['sources']), set(runtime.CHANNEL_NAMES))
        self.assertEqual(result['coverage']['direct_feed_company_count'], additional.direct_feed_company_count())
        self.assertEqual(result['coverage']['source_channel_count'], len(runtime.CHANNEL_NAMES))
        self.assertEqual(result['coverage']['candidate_company_count'], 225)
        self.assertFalse(result['coverage']['all_company_announcements_covered'])
        self.assertEqual(result['collection_health'], 'partial')
        self.assertEqual(result['source_diagnostics'][self.label]['errors'],
                         ['source_read_failed', 'source_unavailable'])
        encoded = json.dumps(result, ensure_ascii=False)
        self.assertLess(len(encoded.encode()), 8192)
        self.assertLess(len(json.dumps(result).encode()), 8192)
        self.assertNotIn('sk-private', encoded)
        self.assertNotIn('private body', encoded)
        self.assertEqual(result['max_generation_attempts_per_day'], 3)

    def test_all_registered_channels_with_every_fixed_error_fit_clock_response_limit(self):
        # More than a normal collector can return: retain every allowed fixed
        # error for every channel to bound an expanded status response safely.
        diagnostics = {label: {'feed_status': 'failed', 'status': 'articles_unavailable',
                       'errors': sorted(runtime.SOURCE_ERROR_CODES)}
                       for label in runtime.CHANNEL_NAMES}
        with tempfile.TemporaryDirectory() as temp:
            worker = runtime.CompanyNewsRuntime(self.storage, collector=lambda **_: {
                'status': 'error', 'articles': [], 'catalogue': self.catalogue.snapshot(),
                'collection_health': 'partial', 'diagnostics': diagnostics},
                clock=lambda: NOW, cache_path=temp + '/cache.json')
            worker.run_once()
            result = worker.operational_snapshot()
        self.assertEqual(set(result['source_diagnostics']), set(runtime.CHANNEL_NAMES))
        self.assertTrue(all(set(row['errors']) == set(runtime.SOURCE_ERROR_CODES)
                            for row in result['source_diagnostics'].values()))
        self.assertLess(len(json.dumps(result, ensure_ascii=False).encode()), 8192)
        # Flask's default JSON provider escapes non-ASCII labels, so bound
        # that larger wire representation too, not just the UTF-8 variant.
        self.assertLess(len(json.dumps(result).encode()), 8192)

    def test_wrapper_coverage_is_shared_and_failed_new_source_is_not_false_empty_success(self):
        import company_news_catalogue
        import company_news_sources
        tree = ast.parse(Path(__file__).resolve().parents[1].joinpath('line_bot.py').read_text())
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                        and node.name == '_collect_company_sources')
        namespace = {}
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<company-wrapper>', 'exec'), namespace)
        for failed in (False, True):
            diagnostics = {label: {'feed_status': 'ok', 'status': 'no_matching_candidates', 'errors': []}
                           for label in company_news_sources.FEEDS}
            if failed:
                diagnostics[self.label] = {'feed_status': 'failed', 'status': 'feed_failed',
                                          'errors': ['source_unavailable']}
            def collect(*_, diagnostics: dict, **__):
                diagnostics.update(deepcopy(expected))
                return []
            expected = diagnostics
            with patch.object(company_news_catalogue, 'current_catalogue', return_value=self.catalogue), \
                    patch.object(company_news_sources, 'collect_company_articles', side_effect=collect):
                result = namespace['_collect_company_sources'](now=NOW)
            self.assertEqual(result['status'], 'ready' if failed else 'source_empty')
            self.assertEqual(result['collection_health'], 'partial' if failed else 'complete')
            self.assertEqual(result['coverage']['direct_feed_company_count'], additional.direct_feed_company_count())
            self.assertEqual(result['coverage']['source_channel_count'], len(company_news_sources.FEEDS))
            self.assertFalse(result['coverage']['all_company_announcements_covered'])


if __name__ == '__main__':
    unittest.main()

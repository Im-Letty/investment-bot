from copy import deepcopy
import ast
from datetime import date, timedelta
from hashlib import sha256
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from company_news_runtime import (CompanyNewsRuntime, PREFIX, article_id, canonical_hash,
    pending_candidates, public_snapshot, source_fingerprint, source_hash, valid_record, valid_source)

NOW = 1791424800.0  # 2026-10-08 11:00 JST


def source(symbol='9432.T', day='2026-10-08', suffix='a'):
    from company_news_runtime import SOURCES
    name, host, _ = SOURCES[symbol]
    url = f'https://{host}/jp/newsrelease/2026/10/08/261008{suffix}.html'
    if symbol == '9433.T':
        url = f'https://{host}/news/detail/kddi_nr-20261008{suffix}.html'
    elif symbol == '6752.T':
        url = f'https://{host}/jp/press/jn261008-1'
    body = '架空のテスト資料です。会社は新しい通信設備の実験を始めると発表しました。実験結果を確認して今後の使い方を検討します。' * 3
    return {'symbol': symbol, 'name': name, 'sector': '通信', 'business': '通信などの仕組みを支える会社です。',
        'source': name, 'title': '新しい設備の実験について', 'url': url, 'body': body,
        'published_date': day, 'published_at': None, 'body_verified_at': NOW - 100,
        'body_sha256': sha256(body.encode()).hexdigest()}


def record(src=None):
    src = source() if src is None else src
    copy = {'title': '新しい通信設備を使う実験を開始',
        'business': 'スマホやインターネットの通信を支える仕組みをつくる会社です。',
        'event': '新しい通信設備を使う実験を始めると発表しました。まだ実験の段階です。',
        'outlook': '実験の結果を見て、どのような場所で使えるかを調べるとしています。'}
    digest = canonical_hash(copy)
    company = {**copy, **{key: src[key] for key in ('symbol', 'name', 'sector', 'source', 'published_date',
        'published_at', 'body_verified_at', 'body_sha256')}, 'source_url': src['url'], 'article_id': article_id(src),
        'content_sha256': digest, 'source_sha256': source_hash(src), 'reviewed_at': NOW - 10,
        'valid_until': (date.fromisoformat(src['published_date']) + timedelta(days=7)).isoformat(),
        'reviews': {key: {'approved': True, 'content_sha256': digest, 'source_sha256': source_hash(src)}
                    for key in ('gemini', 'openai')}}
    return {'schema': 'company-reviewed-v1', 'source': src, 'company': company}


class MemoryStorage:
    def __init__(self):
        self.values, self.lock = {}, threading.Lock()
    def ensure_private(self):
        pass
    def after_fork(self):
        pass
    def read(self, path):
        return deepcopy(self.values.get(path))
    def create(self, path, value):
        with self.lock:
            if path in self.values:
                return False
            self.values[path] = deepcopy(value)
            return True
    def _list(self, prefix):
        return [{'name': key[len(prefix) + 1:]} for key in self.values
                if key.startswith(prefix + '/') and '/' not in key[len(prefix) + 1:]]


class CountingStorage(MemoryStorage):
    def __init__(self):
        super().__init__()
        self.reads, self.lists = [], []
    def read(self, path):
        self.reads.append(path)
        return super().read(path)
    def _list(self, prefix):
        self.lists.append(prefix)
        return super()._list(prefix)
    def reset_counts(self):
        self.reads.clear(); self.lists.clear()


class CompanyRuntimeTests(unittest.TestCase):
    def diagnostics(self, error=False):
        from company_news_runtime import SOURCES
        result = {name: {'feed_status': 'ok', 'status': 'no_matching_candidates', 'errors': []}
                  for name, _, _ in SOURCES.values()}
        result['PR TIMES'] = {'feed_status': 'ok', 'status': 'no_matching_candidates', 'errors': []}
        if error:
            result['NTT'].update(status='articles_unavailable', errors=['body_or_date_unverified'])
        return result

    def test_operational_diagnostics_are_fixed_bounded_and_never_expose_untrusted_text(self):
        storage = MemoryStorage()
        diagnostics = self.diagnostics(error=True)
        diagnostics['NTT'].update(body='private original body', url='https://secret.example',
            errors=['body_or_date_unverified', 'sk-private-error', ['unknown']])
        diagnostics['KDDI'].update(feed_status=['untrusted'], status='raw provider message')
        diagnostics['unknown company'] = {'errors': ['sk-private-error']}
        with tempfile.TemporaryDirectory() as temp:
            runtime = CompanyNewsRuntime(storage, collector=lambda **_: {'status': 'error',
                'articles': [], 'diagnostics': diagnostics}, clock=lambda: NOW, cache_path=temp + '/cache.json')
            runtime.run_once(); result = runtime.operational_snapshot()
        safe = result['source_diagnostics']
        self.assertEqual(set(safe), {'NTT', 'KDDI', 'パナソニック ホールディングス', 'PR TIMES'})
        self.assertTrue(all(set(row) == {'feed_status', 'status', 'errors'} for row in safe.values()))
        self.assertEqual(safe['NTT']['errors'], ['body_or_date_unverified', 'source_read_failed'])
        self.assertEqual(safe['KDDI']['feed_status'], 'not_completed')
        self.assertEqual(safe['KDDI']['status'], 'fetch_incomplete')
        self.assertEqual(result['status'], 'error')
        self.assertEqual(result['last_error_phase'], 'source_collect')
        self.assertEqual(result['last_error_code'], 'source_collection_failed')
        for private in ('sk-private', 'original body', 'secret.example', 'raw provider', 'unknown company'):
            self.assertNotIn(private, json.dumps(result))
        result['source_diagnostics']['NTT']['errors'].append('changed by caller')
        self.assertNotIn('changed by caller', runtime.operational_snapshot()['source_diagnostics']['NTT']['errors'])

    def test_source_diagnostics_are_retained_between_polls_and_cleared_on_recovery(self):
        storage, clock, calls = CountingStorage(), [NOW], []
        storage.create(f'{PREFIX}/days/2026-10-08/published-1.json', record())
        def collect(**_):
            calls.append(1)
            failed = len(calls) == 1
            return {'status': 'error' if failed else 'source_empty', 'articles': [],
                    'diagnostics': self.diagnostics(error=failed)}
        with tempfile.TemporaryDirectory() as temp:
            runtime = CompanyNewsRuntime(storage, collector=collect, clock=lambda: clock[0],
                cache_path=temp + '/cache.json')
            runtime.run_once()
            initial = runtime.operational_snapshot()['source_diagnostics']
            self.assertEqual(len(runtime.snapshot()['companies']), 1)
            storage.reset_counts(); clock[0] += 60; runtime.run_once()
            self.assertEqual(runtime.operational_snapshot()['source_diagnostics'], initial)
            self.assertEqual(storage.lists, [])
            self.assertEqual(len(calls), 1)
            clock[0] = NOW + 900; runtime.run_once()
            recovered = runtime.operational_snapshot()
            self.assertEqual(recovered['status'], 'ready')
            self.assertIsNone(recovered['last_error_phase'])
            self.assertIsNone(recovered['last_error_code'])
            self.assertEqual(recovered['source_diagnostics']['NTT']['errors'], [])

    def test_failure_phase_and_code_are_safe_for_storage_collection_and_local_cache(self):
        from company_news_runtime import StorageUnavailable
        for failure, expected_phase, expected_code in (
                ('bucket', 'storage_check', 'storage_private_required'),
                ('queue', 'candidate_read', 'storage_list'),
                ('source', 'source_collect', 'runtime_failed'),
                ('candidate', 'candidate_write', 'storage_write'),
                ('publication', 'publication_read', 'storage_read'),
                ('claims', 'claim_read', 'storage_read'),
                ('cache', 'cache_write', 'runtime_failed')):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temp:
                storage = MemoryStorage()
                collector = lambda **_: {'status': 'ready', 'articles': [source()],
                                         'diagnostics': self.diagnostics()}
                def fail(code): raise StorageUnavailable(code)
                if failure == 'bucket': storage.ensure_private = lambda: fail('storage_private_required')
                if failure == 'queue': storage._list = lambda _: fail('storage_list')
                if failure == 'source':
                    def collector(**_): raise RuntimeError('sk-private-source-body')
                if failure == 'candidate': storage.create = lambda *_: fail('storage_write')
                original_read = storage.read
                if failure in ('publication', 'claims'):
                    def read(path):
                        if ('/published-' if failure == 'publication' else '/attempt-') in path:
                            fail('storage_read')
                        return original_read(path)
                    storage.read = read
                if failure == 'cache': storage.create(f'{PREFIX}/days/2026-10-08/published-1.json', record())
                runtime = CompanyNewsRuntime(storage, collector=collector, clock=lambda: NOW,
                                             cache_path=temp + '/cache.json')
                if failure == 'cache':
                    def persist(_): raise OSError('sk-private-local-path')
                    runtime._persist = persist
                runtime.run_once(); result = runtime.operational_snapshot()
                self.assertEqual(result['status'], 'error')
                self.assertEqual(result['last_error_phase'], expected_phase)
                self.assertEqual(result['last_error_code'], expected_code)
                self.assertNotIn('sk-private', json.dumps(result))
                if failure == 'publication':
                    self.assertEqual(result['source_diagnostics'], self.diagnostics())

    def test_company_collector_wrapper_distinguishes_partial_feed_coverage_without_blocking_verified_news(self):
        import company_news_sources
        tree = ast.parse(Path(__file__).resolve().parents[1].joinpath('line_bot.py').read_text())
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                        and node.name == '_collect_company_sources')
        namespace = {}
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<company-wrapper>', 'exec'), namespace)
        for failure in (False, True):
            expected = self.diagnostics(error=failure)
            def collect(*_, diagnostics, **__):
                diagnostics.update(expected)
                return []
            with patch.object(company_news_sources, 'collect_company_articles', side_effect=collect):
                result = namespace['_collect_company_sources'](now=NOW)
            self.assertEqual(result['diagnostics'], expected)
            self.assertEqual(result['status'], 'ready' if failure else 'source_empty')
            self.assertEqual(result['collection_health'], 'partial' if failure else 'complete')
            self.assertEqual(result['coverage']['candidate_company_count'], 225)
            self.assertFalse(result['coverage']['all_company_announcements_covered'])

    def test_source_verification_binds_body_date_and_fixed_official_identity(self):
        self.assertTrue(valid_source(source(), NOW))
        for key, value in [('body', 'x' * 120), ('url', 'https://evil.example/news'),
                           ('name', '別の会社'), ('published_date', '2026-10-09'), ('body_verified_at', NOW + 60)]:
            damaged = source(); damaged[key] = value
            self.assertFalse(valid_source(damaged, NOW), key)
        damaged = source(); damaged['published_at'] = NOW - 86400
        self.assertFalse(valid_source(damaged, NOW))

    def test_both_reviews_must_match_exact_copy_and_no_date_extension(self):
        self.assertTrue(valid_record(record(), NOW))
        for change in ('copy', 'review', 'date', 'source'):
            changed = record()
            if change == 'copy': changed['company']['event'] += '成功しました。'
            if change == 'review': changed['company']['reviews']['openai']['content_sha256'] = 'a' * 64
            if change == 'date': changed['company']['valid_until'] = '2026-12-31'
            if change == 'source': changed['company']['source_url'] = 'https://evil.example/'
            self.assertFalse(valid_record(changed, NOW), change)

    def test_public_response_contains_no_original_body_or_review_input(self):
        result = public_snapshot([record()], NOW)
        self.assertEqual(len(result['companies']), 1)
        self.assertNotIn('body', result['companies'][0])
        self.assertNotIn('reviews', result['companies'][0])
        self.assertNotIn('body_sha256', result['companies'][0])
        self.assertEqual(public_snapshot([record()], NOW + 8 * 86400)['companies'], [])

    def test_review_proof_also_binds_exact_source_metadata_and_body(self):
        changed = record()
        changed['source']['business'] += '別の事業も行っています。'
        self.assertFalse(valid_record(changed, NOW))

    def test_candidate_queue_deduplicates_companies_and_paid_attempts(self):
        storage = MemoryStorage()
        first, next_one = source(), source(suffix='b')
        for item in (first, next_one, source('9433.T')):
            storage.create(f'{PREFIX}/candidates/2026-10-08/{source_fingerprint(item)}.json', item)
        self.assertEqual(len(pending_candidates(storage, NOW)), 2)
        storage.create(f'{PREFIX}/days/2026-10-08/attempt-1.json', {'symbol': '9432.T'})
        self.assertEqual([x['symbol'] for x in pending_candidates(storage, NOW)], ['9433.T'])
        storage.create(f'{PREFIX}/seen/{source_fingerprint(source("9433.T"))}.json', {})
        self.assertEqual(pending_candidates(storage, NOW), [])

    def test_periodic_source_poll_is_separate_from_reviewed_cache_refresh(self):
        storage, calls = MemoryStorage(), []
        storage.create(f'{PREFIX}/days/2026-10-08/published-1.json', record())
        clock = [NOW]
        def collect(**options):
            calls.append(options)
            return {'status': 'ready', 'articles': [source('9433.T')]}
        with tempfile.TemporaryDirectory() as temp:
            runtime = CompanyNewsRuntime(storage, collector=collect, clock=lambda: clock[0], cache_path=temp + '/cache.json')
            runtime.run_once(); self.assertEqual(len(runtime.snapshot()['companies']), 1)
            self.assertEqual(runtime.operational_snapshot()['pending_count'], 1)
            clock[0] += 60; runtime.run_once(); self.assertEqual(len(calls), 1)
            self.assertEqual(runtime.snapshot()['checked_at'], NOW)
            clock[0] += 900; runtime.run_once(); self.assertEqual(len(calls), 2)

    def test_source_or_storage_error_keeps_approved_articles_and_error_status(self):
        storage = MemoryStorage(); storage.create(f'{PREFIX}/days/2026-10-08/published-1.json', record())
        clock = [NOW]
        with tempfile.TemporaryDirectory() as temp:
            runtime = CompanyNewsRuntime(storage, collector=lambda **_: {'status': 'error', 'articles': []},
                clock=lambda: clock[0], cache_path=temp + '/cache.json')
            runtime.run_once(); self.assertEqual(runtime.snapshot()['status'], 'error')
            self.assertEqual(len(runtime.snapshot()['companies']), 1)
            clock[0] += 60; runtime.run_once(); self.assertEqual(runtime.snapshot()['status'], 'error')
            storage.read = lambda _: (_ for _ in ()).throw(RuntimeError('sensitive'))
            runtime.run_once(); self.assertEqual(len(runtime.snapshot()['companies']), 1)

    def test_minute_checks_only_missing_current_slots_and_cached_candidate_claims(self):
        storage, clock = CountingStorage(), [NOW]
        item = source('9433.T')
        storage.create(f'{PREFIX}/candidates/2026-10-08/{source_fingerprint(item)}.json', item)
        published = f'{PREFIX}/days/2026-10-08/published-1.json'
        storage.create(published, record())
        with tempfile.TemporaryDirectory() as temp:
            runtime = CompanyNewsRuntime(storage, collector=lambda **_: {'status': 'ready', 'articles': []},
                clock=lambda: clock[0], cache_path=temp + '/cache.json')
            runtime.run_once()
            self.assertEqual(len([path for path in storage.reads if '/published-' in path]), 24)
            storage.reset_counts(); clock[0] += 60; runtime.run_once()
            self.assertEqual(storage.lists, [])
            self.assertNotIn(published, storage.reads)
            self.assertEqual([path for path in storage.reads if '/published-' in path],
                [f'{PREFIX}/days/2026-10-08/published-{slot}.json' for slot in (2, 3)])
            self.assertFalse(any('/candidates/' in path for path in storage.reads))
            self.assertEqual(len([path for path in storage.reads if '/attempt-' in path]), 3)
            self.assertIn(f'{PREFIX}/seen/{source_fingerprint(item)}.json', storage.reads)
            storage.reset_counts(); clock[0] = NOW + 900; runtime.run_once()
            self.assertEqual(len(storage.lists), 3)
            self.assertEqual(len([path for path in storage.reads if '/published-' in path]), 23)
            self.assertNotIn(published, storage.reads)

    def test_new_current_slot_is_merged_without_dropping_previous_day_records(self):
        storage, clock = CountingStorage(), [NOW]
        older = source('6752.T', day='2026-10-07')
        older['body_verified_at'] -= 86400
        saved = record(older); saved['company']['reviewed_at'] -= 86400
        storage.create(f'{PREFIX}/days/2026-10-07/published-1.json', saved)
        storage.create(f'{PREFIX}/days/2026-10-08/published-1.json', record())
        with tempfile.TemporaryDirectory() as temp:
            runtime = CompanyNewsRuntime(storage, collector=lambda **_: {'status': 'ready', 'articles': []},
                clock=lambda: clock[0], cache_path=temp + '/cache.json')
            runtime.run_once()
            storage.create(f'{PREFIX}/days/2026-10-08/published-2.json', record(source('9433.T')))
            storage.reset_counts(); clock[0] += 60; runtime.run_once()
            self.assertEqual({item['symbol'] for item in runtime.snapshot()['companies']},
                {'9432.T', '9433.T', '6752.T'})
            self.assertFalse(any('/days/2026-10-07/' in path for path in storage.reads))
            storage.reset_counts(); clock[0] += 60; runtime.run_once()
            self.assertEqual([path for path in storage.reads if '/published-' in path],
                [f'{PREFIX}/days/2026-10-08/published-3.json'])

    def test_day_rollover_forces_full_scan_and_candidate_refresh_before_fifteen_minutes(self):
        storage, clock = CountingStorage(), [NOW + 12 * 3600 + 59 * 60]
        with tempfile.TemporaryDirectory() as temp:
            runtime = CompanyNewsRuntime(storage, collector=lambda **_: {'status': 'ready', 'articles': []},
                clock=lambda: clock[0], cache_path=temp + '/cache.json')
            runtime.run_once()
            storage.reset_counts(); clock[0] += 60; runtime.run_once()
            self.assertEqual(len([path for path in storage.reads if '/published-' in path]), 24)
            self.assertEqual(storage.lists, [f'{PREFIX}/candidates/{day}'
                for day in ('2026-10-09', '2026-10-08', '2026-10-07')])
            self.assertEqual(runtime._restore_day, '2026-10-09')

    def test_slow_collector_uses_completion_time_for_validation_and_receipt(self):
        storage, clock = MemoryStorage(), [NOW]
        def collect(**_):
            clock[0] += 40
            item = source(); item['body_verified_at'] = clock[0]
            return {'status': 'ready', 'articles': [item]}
        with tempfile.TemporaryDirectory() as temp:
            runtime = CompanyNewsRuntime(storage, collector=collect, clock=lambda: clock[0],
                cache_path=temp + '/cache.json')
            runtime.run_once()
            self.assertEqual(runtime.operational_snapshot()['pending_count'], 1)
            self.assertEqual(runtime.snapshot()['checked_at'], NOW + 40)
            self.assertEqual(runtime.snapshot()['status'], 'ready')
            self.assertTrue(any('/candidates/' in path for path in storage.values))

    def test_cached_queue_rechecks_paid_seen_and_daily_cap_without_manifest_reads(self):
        storage, clock = CountingStorage(), [NOW]
        for symbol in ('9432.T', '9433.T', '6752.T'):
            item = source(symbol)
            storage.create(f'{PREFIX}/candidates/2026-10-08/{source_fingerprint(item)}.json', item)
        with tempfile.TemporaryDirectory() as temp:
            runtime = CompanyNewsRuntime(storage, collector=lambda **_: {'status': 'ready', 'articles': []},
                clock=lambda: clock[0], cache_path=temp + '/cache.json')
            runtime.run_once(); self.assertEqual(runtime.operational_snapshot()['pending_count'], 3)
            storage.create(f'{PREFIX}/days/2026-10-08/attempt-1.json', {'symbol': '9432.T'})
            storage.create(f'{PREFIX}/seen/{source_fingerprint(source("9433.T"))}.json', {})
            storage.reset_counts(); clock[0] += 60; runtime.run_once()
            self.assertEqual([item['symbol'] for item in runtime._pending], ['6752.T'])
            self.assertEqual(storage.lists, [])
            self.assertFalse(any('/candidates/' in path for path in storage.reads))
            for slot, symbol in ((2, '9433.T'), (3, '6752.T')):
                storage.create(f'{PREFIX}/days/2026-10-08/attempt-{slot}.json', {'symbol': symbol})
            storage.reset_counts(); clock[0] += 60; runtime.run_once()
            self.assertEqual(runtime.operational_snapshot()['pending_count'], 0)
            self.assertFalse(any('/seen/' in path for path in storage.reads))

    def test_failed_collection_stays_error_until_another_successful_poll(self):
        storage, clock, calls = MemoryStorage(), [NOW], []
        def collect(**_):
            calls.append(clock[0])
            if len(calls) == 2:
                raise RuntimeError('private storage message')
            return {'status': 'ready', 'articles': []}
        with tempfile.TemporaryDirectory() as temp:
            runtime = CompanyNewsRuntime(storage, collector=collect, clock=lambda: clock[0],
                cache_path=temp + '/cache.json')
            runtime.run_once(); self.assertEqual(runtime.snapshot()['status'], 'ready')
            clock[0] += 900; runtime.run_once(); self.assertEqual(runtime.snapshot()['status'], 'error')
            clock[0] += 60; runtime.run_once(); self.assertEqual(runtime.snapshot()['status'], 'error')
            self.assertEqual(len(calls), 2)
            clock[0] += 900; runtime.run_once(); self.assertEqual(runtime.snapshot()['status'], 'ready')


if __name__ == '__main__':
    unittest.main()

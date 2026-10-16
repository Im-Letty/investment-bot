"""Normal collection evidence: offline, fixed identities, no publication proof."""
from copy import deepcopy
from datetime import datetime
from hashlib import sha256
import json
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

import company_news_collection_checks as checks
from company_news_runtime import CompanyNewsRuntime, candidate_records, read_records
from news_cache import JST
from tests.test_company_news_runtime import MemoryStorage, NOW, record


def catalogue_document(day='2026-10-08', source_digest='c' * 64):
    from company_news_catalogue import SOURCE_URL, COMPONENT_URL
    return dict(schema_version=1, index='nikkei225', as_of=day, retrieved_at=day + 'T08:00:00+09:00',
        items=[dict(code=str(code), symbol=str(code) + '.T', name=f'架空会社{code}') for code in range(1000, 1225)],
        source=dict(url=SOURCE_URL, component_url=COMPONENT_URL, sha256=source_digest))


def registry(ctx):
    return {key: deepcopy(ctx[key]) for key in ('routes', 'source_sha256')}


def context(base=2, extra=7):
    routes = {}
    for index in range(base + extra):
        label = 'PR TIMES' if index == 0 else f'Route {index:03d}'
        routes[label] = dict(symbol=None if index == 0 else f'{1000 + index}.T',
            feed_url=f'https://fixture.invalid/feed/{index}', config_sha256=f'{index:064x}',
            expansion=index >= base)
    return checks.context_from_registry(routes, source_sha256='a' * 64,
        catalogue_sha256='b' * 64, catalogue_source_sha256='c' * 64)


def result(ctx, stamp=NOW):
    return dict(status='source_empty', articles=[], diagnostics={label: dict(feed_status='ok',
        status='no_matching_candidates', candidates=0, selected=0, completed=0, accepted=0,
        returned=0, errors=[]) for label in checks._scheduled(ctx, stamp)})


def projected(ctx=None, stamp=NOW, finish=None):
    ctx = context() if ctx is None else ctx
    return checks.project(ctx, result(ctx, stamp), reference_at=stamp,
                          started_at=stamp, finished_at=stamp + 1 if finish is None else finish)


class CountingStorage(MemoryStorage):
    def __init__(self):
        super().__init__()
        self.created, self.reads, self.options = [], [], []
        self.check_failure = False
    def create(self, path, value, *, deadline=None, clock=None):
        self.created.append(path)
        self.options.append((deadline, clock))
        if self.check_failure and path.startswith(checks.PREFIX + '/'):
            raise RuntimeError('private-token-and-error-url')
        return super().create(path, value)
    def read(self, path, *, deadline=None, clock=None):
        self.reads.append(path)
        return super().read(path)


class ProjectionTests(unittest.TestCase):
    def setUp(self):
        self.network = patch.object(socket.socket, 'connect', side_effect=AssertionError('no network'))
        self.network.start()
        self.addCleanup(self.network.stop)

    def test_only_scheduled_trusted_rows_and_counters_are_kept(self):
        ctx, raw = context(), result(context())
        label = next(iter(raw['diagnostics']))
        raw['diagnostics'][label].update(symbol='9999.T', feed_url='https://secret.invalid/token',
            source='unregistered', body='private article body', errors=['source_timeout', 'sk-secret'])
        raw['diagnostics']['secret label'] = dict(feed_status='ok', secret='private')
        saved = checks.project(ctx, raw, reference_at=NOW, started_at=NOW + 2, finished_at=NOW + 31)
        self.assertEqual(saved['registered_route_count'], 9)
        self.assertLessEqual(len(saved['rows']), 8)
        self.assertEqual({row['source'] for row in saved['rows']}, set(checks._scheduled(ctx, NOW)))
        row = next(row for row in saved['rows'] if row['source'] == label)
        self.assertEqual(row['feed_url'], ctx['routes'][label]['feed_url'])
        self.assertEqual(row['symbol'], ctx['routes'][label]['symbol'])
        self.assertEqual(row['errors'], ['source_read_failed', 'source_timeout'])
        global_row = next(row for row in saved['rows'] if row['source'] == 'PR TIMES')
        self.assertIsNone(global_row['symbol'])
        self.assertTrue(checks.validate(saved, ctx, NOW + 32))
        for secret in ('secret.invalid', 'secret label', 'sk-secret', 'private article', '9999.T'):
            self.assertNotIn(secret, json.dumps(saved))
        self.assertNotIn('published', saved)

    def test_missing_incomplete_and_malformed_rows_never_become_feed_success(self):
        ctx = context()
        label = checks._scheduled(ctx, NOW)[0]
        for change in (None, {'selected': True}, {'accepted': float('nan')}, {'candidates': 201},
                       {'selected': 2, 'completed': 3}, {'feed_status': ['ok']},
                       {'feed_status': 'not_scheduled'}, {'errors': 'private-token'}):
            raw = result(ctx)
            if change is None:
                del raw['diagnostics'][label]
            else:
                raw['diagnostics'][label].update(change)
            with self.subTest(change=change):
                saved = checks.project(ctx, raw, reference_at=NOW, started_at=NOW, finished_at=NOW + 1)
                row = next(row for row in saved['rows'] if row['source'] == label)
                self.assertFalse(row['diagnostics_valid'])
                self.assertEqual(row['feed_status'], 'not_completed')
                self.assertEqual(saved['invalid_row_count'], 1)
                self.assertTrue(checks.validate(saved, ctx, NOW + 2))
        raw = result(ctx)
        raw['diagnostics'][label].update(feed_status='not_completed', status='fetch_incomplete')
        saved = checks.project(ctx, raw, reference_at=NOW, started_at=NOW, finished_at=NOW)
        self.assertEqual(saved['rows'][0]['feed_status'], 'not_completed')

    def test_global_body_budget_corruption_is_not_projected_as_accepted(self):
        ctx, raw = context(), result(context())
        for row in raw['diagnostics'].values():
            row.update(candidates=8, selected=8, completed=3, accepted=3, returned=3, status='collected')
        saved = checks.project(ctx, raw, reference_at=NOW, started_at=NOW, finished_at=NOW + 1)
        self.assertEqual(saved['invalid_row_count'], saved['scheduled_route_count'])
        self.assertTrue(all(row['accepted'] == 0 and row['feed_status'] == 'not_completed' for row in saved['rows']))

    def test_registry_and_parser_and_membership_versions_change_path_not_clock(self):
        ctx = context()
        reordered = checks.context_from_registry(dict(reversed(list(ctx['routes'].items()))),
            source_sha256=ctx['source_sha256'], catalogue_sha256=ctx['catalogue_sha256'],
            catalogue_source_sha256=ctx['catalogue_source_sha256'])
        self.assertEqual(ctx, reordered)
        self.assertEqual(projected(ctx)['fingerprint'], projected(ctx, NOW + 900)['fingerprint'])
        for key in ('source_sha256', 'catalogue_sha256', 'catalogue_source_sha256'):
            options = {name: ctx[name] for name in ('source_sha256', 'catalogue_sha256', 'catalogue_source_sha256')}
            options[key] = 'd' * 64
            changed = checks.context_from_registry(ctx['routes'], **options)
            self.assertNotEqual(checks.slot_path(ctx['fingerprint'], NOW), checks.slot_path(changed['fingerprint'], NOW))
            self.assertFalse(checks.validate(projected(ctx), changed, NOW + 2))
        routes = deepcopy(ctx['routes']);routes['PR TIMES']['config_sha256'] = 'e' * 64
        changed = checks.context_from_registry(routes, source_sha256='a' * 64,
            catalogue_sha256='b' * 64, catalogue_source_sha256='c' * 64)
        self.assertNotEqual(ctx['fingerprint'], changed['fingerprint'])

    def test_actual_start_day_and_slot_are_distinct_from_schedule_reference_and_finish(self):
        ctx = context()
        started = datetime(2026, 10, 8, 23, 59, 55, tzinfo=JST).timestamp()
        saved = checks.project(ctx, result(ctx, started - 900), reference_at=started - 900,
                              started_at=started, finished_at=started + 20)
        self.assertEqual(saved['day'], '2026-10-08')
        self.assertEqual(saved['slot'], 95)
        self.assertEqual(saved['reference_at'], started - 900)
        self.assertTrue(checks.slot_path(ctx['fingerprint'], started).endswith('/2026-10-08/slot-95.json'))
        self.assertTrue(checks.validate(saved, ctx, started + 21))

    def test_tamper_wrong_primitive_types_and_future_clocks_are_rejected(self):
        ctx = context()
        for change in ({'schema_version': True}, {'slot': True}, {'invalid_row_count': False},
                       {'registered_route_count': True}, {'fingerprint': 'e' * 64},
                       {'started_at': float('nan')}, {'finished_at': NOW + 10}, {'day': '2026-10-09'}):
            self.assertFalse(checks.validate({**projected(ctx), **change}, ctx, NOW + 2), change)
        changed = projected(ctx);changed['rows'][0]['diagnostics_valid'] = 1
        self.assertFalse(checks.validate(changed, ctx, NOW + 2))
        changed = projected(ctx);changed['rows'][0]['body'] = 'private source'
        self.assertFalse(checks.validate(changed, ctx, NOW + 2))
        changed = projected(ctx);changed['rows'].append(deepcopy(changed['rows'][0]))
        self.assertFalse(checks.validate(changed, ctx, NOW + 2))

    def test_real_registry_uses_only_fixed_related_files_and_stays_within_private_cap(self):
        current = datetime(2026, 10, 17, 3, tzinfo=JST).timestamp()
        ctx = checks.registered_context(current)
        from company_news_sources import FEEDS, collection_schedule
        self.assertEqual(set(ctx['routes']), set(FEEDS))
        self.assertEqual(set(checks._scheduled(ctx, current)), set(collection_schedule(current)['feeds']))
        saved = projected(ctx, current)
        self.assertLessEqual(len(checks._encoded(saved)), checks.MAX_BYTES)
        self.assertLessEqual(len(saved['rows']), 39)
        self.assertTrue(checks.validate(saved, ctx, current + 2))
        self.assertNotIn('line_bot.py', checks.SOURCE_FILES)
        self.assertTrue(all('__pycache__' not in name and not name.endswith('.pyc') for name in checks.SOURCE_FILES))

    def test_size_cap_fails_closed_without_omitting_rows(self):
        ctx = context(base=33, extra=6)
        routes = {}
        for index, row in enumerate(ctx['routes'].values()):
            routes['架' * 195 + f'{index:03d}'] = {**row, 'symbol': f'{1000 + index}.T',
                'feed_url': 'https://fixture.invalid/' + 'x' * 1980 + str(index)}
        large = checks.context_from_registry(routes, source_sha256='a' * 64,
            catalogue_sha256='b' * 64, catalogue_source_sha256='c' * 64)
        with self.assertRaisesRegex(ValueError, 'collection_check_size'):
            projected(large)

    def test_actual_result_catalogue_rebinds_normal_daily_refresh_without_source_io(self):
        local = registry(context())
        old = checks.context_for_result(local, {'catalogue': catalogue_document('2026-10-07', 'b' * 64)}, reference_at=NOW)
        actual = checks.context_for_result(local, {'catalogue': catalogue_document()}, reference_at=NOW)
        self.assertNotEqual(old['fingerprint'], actual['fingerprint'])
        self.assertEqual(old['routes'], actual['routes'])
        self.assertEqual(old['source_sha256'], actual['source_sha256'])
        saved = projected(actual)
        self.assertTrue(checks.validate(saved, actual, NOW + 2))
        self.assertFalse(checks.validate(saved, old, NOW + 2))

    def test_missing_or_invalid_actual_snapshot_cannot_authenticate_a_collection(self):
        for payload in ({}, {'catalogue': None}, {'catalogue': {}},
                        {'catalogue': {**catalogue_document(), 'items': []}}):
            with self.subTest(payload=list(payload)), self.assertRaises(ValueError):
                checks.context_for_result(registry(context()), payload, reference_at=NOW)

    def test_actual_snapshot_uses_collection_reference_day_not_next_day_finish(self):
        started = datetime(2026, 10, 8, 23, 59, 55, tzinfo=JST).timestamp()
        local = registry(context())
        actual = checks.context_for_result(local, {'catalogue': catalogue_document()}, reference_at=started)
        saved = checks.project(actual, result(actual, started), reference_at=started,
                              started_at=started, finished_at=started + 20)
        self.assertEqual(saved['day'], '2026-10-08')
        self.assertTrue(checks.validate(saved, actual, started + 21))
        with self.assertRaises(ValueError):
            checks.context_for_result(local, {'catalogue': catalogue_document('2026-10-09')}, reference_at=started)


class StorageTests(unittest.TestCase):
    def test_single_write_has_deadline_and_duplicate_or_error_never_retries(self):
        storage, saved = CountingStorage(), projected()
        self.assertEqual(checks.write_once(storage, saved, context=context(), clock=lambda: 100), 'stored')
        self.assertEqual(storage.options[-1][0], 102)
        self.assertEqual(checks.write_once(storage, saved, context=context(), clock=lambda: 100), 'duplicate_unconfirmed')
        storage.check_failure = True
        self.assertEqual(checks.write_once(storage, saved, context=context()), 'unavailable')
        self.assertEqual(len(storage.created), 3)
        self.assertEqual(storage.reads, [])

    def test_existing_storage_without_deadline_signature_is_called_only_once(self):
        storage = MemoryStorage()
        self.assertEqual(checks.write_once(storage, projected(), context=context()), 'stored')
        self.assertEqual(len(storage.values), 1)

    def test_private_reader_only_reads_small_exact_current_version_slots(self):
        ctx, storage, saved = context(), CountingStorage(), projected()
        path = checks.slot_path(ctx['fingerprint'], NOW)
        storage.create(path, saved)
        slots = [saved['slot'], saved['slot'] + 1]
        result = checks.read_slots(storage, ctx, saved['day'], slots, now=NOW + 2, deadline=200, clock=lambda: 100)
        self.assertEqual(result['records'], [saved])
        self.assertEqual(result['missing_slots'], [saved['slot'] + 1])
        self.assertEqual(len(storage.reads), 2)
        self.assertTrue(all(path.startswith(checks.PREFIX + '/' + ctx['fingerprint']) for path in storage.reads))
        for bad_day, bad_slots in (('../escape', [1]), ('2026-10-04', [1]),
                                   (saved['day'], list(range(9))), (saved['day'], [True]),
                                   (saved['day'], [0, 0]), (saved['day'], [96])):
            with self.assertRaises(ValueError):
                checks.read_slots(storage, ctx, bad_day, bad_slots, now=NOW + 2, deadline=200, clock=lambda: 100)
        self.assertEqual(len(storage.reads), 2)

    def test_partial_deadline_does_not_turn_unread_slots_into_missing_or_success(self):
        clock, storage, ctx = [100], CountingStorage(), context()
        def read(path, **options):
            storage.reads.append(path);clock[0] += 3
            return None
        storage.read = read
        result = checks.read_slots(storage, ctx, '2026-10-08', [0, 1, 2], now=NOW,
            deadline=200, clock=lambda: clock[0])
        self.assertEqual(result['read_count'], 2)
        self.assertEqual(result['missing_slots'], [0])
        self.assertEqual(result['unread_slots'], [1, 2])


class RuntimeHookTests(unittest.TestCase):
    def run_runtime(self, *, storage=None, collector=None, clock=None):
        storage = storage or CountingStorage()
        storage.create('company-news/v1/days/2026-10-08/published-1.json', record())
        document = catalogue_document()
        ctx = checks.context_for_result(registry(context()), {'catalogue': document}, reference_at=NOW)
        collector = collector or (lambda **options: {**result(ctx, options['now']), 'catalogue': document})
        clock = clock or [NOW]
        folder = tempfile.TemporaryDirectory();self.addCleanup(folder.cleanup)
        runtime = CompanyNewsRuntime(storage, collector=collector, clock=lambda: clock[0],
            cache_path=folder.name + '/cache.json')
        return runtime, storage, ctx, clock

    def test_one_optional_write_normal_article_survives_and_passive_reads_do_no_io(self):
        runtime, storage, ctx, clock = self.run_runtime()
        with patch('company_news_runtime.collection_check_registry', return_value=registry(ctx)), \
                patch('company_news_runtime.candidate_records', return_value=[]):
            runtime.run_once()
            self.assertEqual(runtime.snapshot()['status'], 'ready')
            self.assertEqual(runtime.snapshot()['companies'][0]['symbol'], '9432.T')
            self.assertEqual(runtime.collection_check_snapshot()['write']['status'], 'stored')
            check_paths = [p for p in storage.created if p.startswith(checks.PREFIX)]
            self.assertEqual(len(check_paths), 1)
            reads, creates = list(storage.reads), list(storage.created)
            first = runtime.collection_check_snapshot();first['record']['rows'].clear()
            observation = runtime.publication_observation()
            runtime.collection_check_snapshot();runtime.publication_observation()
            self.assertEqual(storage.reads, reads)
            self.assertEqual(storage.created, creates)
            self.assertTrue(runtime.collection_check_snapshot()['record']['rows'])
            self.assertLessEqual(len(json.dumps(observation, ensure_ascii=True).encode()), 8192)
            clock[0] += 60;runtime.run_once()
            self.assertEqual(len([p for p in storage.created if p.startswith(checks.PREFIX)]), 1)

    def test_optional_write_or_registry_error_cannot_change_publication_success(self):
        for failure in ('write', 'registry'):
            runtime, storage, ctx, _ = self.run_runtime()
            storage.check_failure = failure == 'write'
            with patch('company_news_runtime.collection_check_registry', side_effect=RuntimeError('sk-private')
                    if failure == 'registry' else None, return_value=registry(ctx)), \
                    patch('company_news_runtime.candidate_records', return_value=[]):
                runtime.run_once()
            observation = runtime.publication_observation()
            self.assertEqual(observation['status'], 'ready')
            self.assertIsNone(observation['last_error_code'])
            self.assertEqual(observation['valid_reviewed_count'], 1)
            self.assertEqual(observation['collection_check']['status'], 'unavailable')
            self.assertNotIn('private', json.dumps(observation))

    def test_normal_refresh_binds_actual_snapshot_without_pre_call_membership_and_missing_is_unavailable(self):
        for missing in (False, True):
            runtime, storage, ctx, _ = self.run_runtime()
            if missing:
                runtime.collector = lambda **options: result(ctx, options['now'])
            with patch('company_news_runtime.collection_check_registry', return_value=registry(ctx)), \
                    patch('company_news_runtime.candidate_records', return_value=[]), \
                    patch('company_news_catalogue.load_current_snapshot', side_effect=ValueError('old local seed')):
                runtime.run_once()
            self.assertEqual(runtime.snapshot()['status'], 'ready')
            self.assertEqual(len(runtime.snapshot()['companies']), 1)
            check = runtime.collection_check_snapshot()
            if missing:
                self.assertEqual(check['write']['status'], 'unavailable')
                self.assertIsNone(check['record'])
            else:
                self.assertEqual(check['write']['status'], 'stored')
                self.assertEqual(check['record']['fingerprint'], ctx['fingerprint'])
                self.assertEqual(check['record']['catalogue_sha256'], ctx['catalogue_sha256'])

    def test_collector_failure_preserves_article_and_is_not_feed_failure_evidence(self):
        def fail(**options):
            raise RuntimeError('raw private failure')
        runtime, storage, ctx, _ = self.run_runtime(collector=fail)
        with patch('company_news_runtime.collection_check_registry', return_value=registry(ctx)), \
                patch('company_news_runtime.candidate_records', return_value=[]):
            runtime.run_once()
        self.assertEqual(runtime.snapshot()['companies'][0]['symbol'], '9432.T')
        observation = runtime.publication_observation()
        self.assertEqual(observation['last_error_phase'], 'source_collect')
        self.assertEqual(observation['last_error_code'], 'runtime_failed')
        check = runtime.collection_check_snapshot()
        self.assertIsNone(check['record'])
        self.assertEqual(check['write']['status'], 'unavailable')
        self.assertNotIn('raw private', json.dumps(check))

    def test_new_namespace_cannot_become_article_queue_or_paid_claim(self):
        runtime, storage, ctx, _ = self.run_runtime()
        original = read_records(storage, NOW)
        for slot in range(96):
            saved = projected(ctx, NOW + slot)
            storage.create(f'{checks.PREFIX}/{ctx["fingerprint"]}/2026-10-08/slot-{slot:02d}.json', saved)
        self.assertEqual(read_records(storage, NOW), original)
        with patch('company_news_runtime._current_catalogue', return_value=None):
            self.assertEqual(candidate_records(storage, NOW), [])
        self.assertFalse(any('/attempt-' in path or '/seen/' in path for path in storage.created))


if __name__ == '__main__':
    unittest.main()

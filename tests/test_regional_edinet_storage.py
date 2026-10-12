"""Checkpoint transport tests: no real credentials, API calls or bucket changes."""
import base64
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zlib

from regional_edinet_storage import (CHECKPOINT_PATH, EdinetCheckpointStore,
                                    FACT_PREFIX, MAX_RAW_BYTES)
from daily_news_runtime import StorageUnavailable


class Response:
    def __init__(self, code=200, payload=None):
        self.status_code, self.payload = code, payload

    def json(self):
        return self.payload


class Transport:
    def __init__(self, private=True):
        self.private, self.calls, self.wrapper = private, [], None
        self.facts = {}

    def _request(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        if method == 'GET':
            return Response(payload={'public': not self.private})
        self.wrapper = json.loads(kwargs['data'])
        return Response()

    def read(self, path, **kwargs):
        self.calls.append(('READ', path, kwargs))
        return deepcopy(self.wrapper if path == CHECKPOINT_PATH else self.facts.get(path))

    def create(self, path, value, **kwargs):
        self.calls.append(('CREATE', path, kwargs))
        if path in self.facts:
            return False
        self.facts[path] = deepcopy(value)
        return True

    def _list(self, prefix, **kwargs):
        self.calls.append(('LIST', prefix, kwargs))
        return [{'name': key[len(prefix) + 1:]} for key in self.facts if key.startswith(prefix + '/')]

    def after_fork(self):
        self.calls.append(('FORK',))


class CheckpointTests(unittest.TestCase):
    def setUp(self):
        self.transport = Transport()
        self.store = EdinetCheckpointStore(self.transport, clock=lambda: 10)
        self.cache = {'version': 1, 'snapshots': {}, 'records': {}, 'next_request': 60}

    def test_constructor_does_not_read_or_write(self):
        self.assertEqual(self.transport.calls, [])

    def test_fixed_private_object_round_trip_preserves_backoff(self):
        self.assertTrue(self.store.save(self.cache))
        self.assertEqual(self.store.load(), self.cache)
        methods = [item[0] for item in self.transport.calls]
        self.assertEqual(methods, ['GET', 'POST', 'READ'])
        write = self.transport.calls[1]
        self.assertTrue(write[1].endswith('/website-news/' + CHECKPOINT_PATH))
        self.assertEqual(write[2]['deadline'], 18)
        self.assertEqual(write[2]['headers']['x-upsert'], 'true')

    def test_public_or_missing_bucket_never_gets_created_or_updated(self):
        transport = Transport(private=False)
        self.assertFalse(EdinetCheckpointStore(transport).save(self.cache))
        self.assertEqual([item[0] for item in transport.calls], ['GET'])

    def test_unknown_fields_cannot_carry_credentials_or_logs(self):
        for extra in ('api_key', 'headers', 'response_body', 'raw_xbrl'):
            self.assertFalse(self.store.save({**self.cache, extra: 'fixture-only'}))
        bad = {**self.cache, 'records': {'9085': {'company': {'code': '9085'},
                                                'descriptor': {'api_key': 'fixture-only'}}}}
        self.assertFalse(self.store.save(bad))
        self.assertEqual(self.transport.calls, [])

    def test_corrupt_or_extra_checkpoint_is_rejected_on_load(self):
        self.assertTrue(self.store.save(self.cache))
        self.transport.wrapper['sha256'] = '0' * 64
        with self.assertRaises(ValueError):
            self.store.load()
        self.assertEqual(self.store.last_load_error, 'checkpoint_digest_mismatch')
        self.transport.wrapper['headers'] = {'private': 'fixture-only'}
        with self.assertRaises(ValueError):
            self.store.load()
        self.assertEqual(self.store.last_load_error, 'checkpoint_wrapper_invalid')

    def test_compression_bomb_is_bounded(self):
        raw = b' ' * (MAX_RAW_BYTES + 1)
        self.transport.wrapper = {'version': 1, 'encoding': 'zlib-base64',
            'data': base64.b64encode(zlib.compress(raw)).decode(), 'sha256': sha256(raw).hexdigest()}
        with self.assertRaises(ValueError):
            self.store.load()

    def test_network_failure_does_not_claim_save_success(self):
        self.transport._request = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError('fixture-only'))
        self.assertFalse(self.store.save(self.cache))
        self.assertEqual(self.store.last_save_error, 'checkpoint_save_failed')

    def test_fixed_storage_deadline_is_distinct_from_raw_unknown_exception(self):
        self.transport.read = lambda *a, **k: (_ for _ in ()).throw(StorageUnavailable('storage_deadline'))
        with self.assertRaises(StorageUnavailable):
            self.store.load()
        self.assertEqual(self.store.last_load_error, 'storage_deadline')
        self.transport.read = lambda *a, **k: (_ for _ in ()).throw(RuntimeError('credential=never display'))
        with self.assertRaises(RuntimeError):
            self.store.load()
        self.assertEqual(self.store.last_load_error, 'checkpoint_read_failed')

    def test_bad_encoding_compression_and_schema_have_fixed_distinct_errors(self):
        for data, expected in (('not base64!', 'checkpoint_encoding_invalid'),
                               (base64.b64encode(b'not zlib').decode(), 'checkpoint_compression_invalid')):
            self.transport.wrapper = {'version': 1, 'encoding': 'zlib-base64', 'data': data, 'sha256': '0' * 64}
            with self.assertRaises(ValueError):
                self.store.load()
            self.assertEqual(self.store.last_load_error, expected)
        raw = json.dumps({**self.cache, 'credential': 'never expose'}).encode()
        self.transport.wrapper = {'version': 1, 'encoding': 'zlib-base64',
            'data': base64.b64encode(zlib.compress(raw)).decode(), 'sha256': sha256(raw).hexdigest()}
        with self.assertRaises(ValueError):
            self.store.load()
        self.assertEqual(self.store.last_load_error, 'checkpoint_schema_invalid')

    def test_only_exact_safe_diagnostics_round_trip(self):
        from regional_edinet import DIAGNOSTIC_REASONS
        for phase in ('daily_index', 'filing', 'checkpoint'):
            for reason in DIAGNOSTIC_REASONS:
                for statuses in ({}, {'http_status': 100}, {'api_status': 599},
                                 {'http_status': 200, 'api_status': 503}):
                    diagnostic = {'phase': phase, 'reason': reason, **statuses}
                    with self.subTest(diagnostic=diagnostic):
                        cache = {**self.cache, 'records': {'6147': {
                            'company': {'code': '6147'}, 'diagnostic': diagnostic}}}
                        self.assertTrue(self.store.save(cache))
                        self.assertEqual(self.store.load(), cache)
                        self.assertIsNone(self.store.last_save_error)
                        self.assertIsNone(self.store.last_load_error)
        # Existing checkpoints without any diagnostic retain their contract.
        self.assertTrue(self.store.save(self.cache))
        self.assertEqual(self.store.load(), self.cache)

    def test_untrusted_diagnostics_reject_before_transport_and_on_load(self):
        safe = {'phase': 'daily_index', 'reason': 'http_error'}
        bad = [None, [], 'fixture-only', 503, True, {},
               {'phase': 'unknown', 'reason': 'http_error'},
               {'phase': ['daily_index'], 'reason': 'http_error'},
               {'phase': {'value': 'daily_index'}, 'reason': 'http_error'},
               {'phase': 'daily_index', 'reason': 'unknown'},
               {'phase': 'daily_index', 'reason': ['http_error']},
               {'phase': 'daily_index', 'reason': {'value': 'http_error'}},
               {'phase': 'daily_index'}, {'reason': 'http_error'}]
        bad.extend({**safe, key: 'fixture-only'} for key in
                   ('url', 'message', 'headers', 'api_key', 'response_body', 'Subscription-Key'))
        bad.extend({**safe, 'reason': value} for value in
                   ('https://example.invalid/private', 'credential=fixture-only', True, 503, None))
        bad.extend({**safe, key: value} for key in ('http_status', 'api_status')
                   for value in (99, 600, True, False, 200.0, '200', None, [], {},
                                 'https://example.invalid/private'))
        for diagnostic in bad:
            with self.subTest(diagnostic=diagnostic):
                transport = Transport()
                store = EdinetCheckpointStore(transport, clock=lambda: 10)
                cache = {**self.cache, 'records': {'6147': {
                    'company': {'code': '6147'}, 'diagnostic': diagnostic}}}
                self.assertFalse(store.save(cache))
                self.assertEqual(store.last_save_error, 'checkpoint_schema_invalid')
                self.assertEqual(transport.calls, [])
                raw = json.dumps(cache).encode()
                transport.wrapper = {'version': 1, 'encoding': 'zlib-base64',
                    'data': base64.b64encode(zlib.compress(raw)).decode(),
                    'sha256': sha256(raw).hexdigest()}
                with self.assertRaises(ValueError):
                    store.load()
                self.assertEqual(store.last_load_error, 'checkpoint_schema_invalid')
                self.assertFalse(any(call[0] in ('POST', 'CREATE') for call in transport.calls))

    def test_real_service_safe_diagnostic_preserves_checkpoint_facts_and_resume(self):
        from regional_edinet_service import RegionalEdinetDividends
        from tests.test_regional_edinet_service import FixtureProvider, snapshot
        from tests.test_regional_edinet import NOW, IDENTITY

        class BackoffProvider(FixtureProvider):
            def next_request_at(self):
                return NOW + 3600

        diagnostic = {'phase': 'daily_index', 'reason': 'api_status',
                      'http_status': 200, 'api_status': 503}
        record = {**self.fact_record(), 'status': 'fetch_error', 'diagnostic': diagnostic,
                  'last_attempt_at': NOW, 'warm_resume_after': NOW + 3600, 'updated_at': NOW,
                  'warm_progress': {'from': '2026-10-09', 'to': '2026-10-11',
                                    'started_at': NOW - 60, 'operations': 12,
                                    'status': 'interrupted', 'last_date': '2026-10-10'}}
        snapshots = {'2026-10-11': snapshot('2026-10-11', [record['descriptor']]),
                     '2026-10-10': snapshot('2026-10-10')}
        with tempfile.TemporaryDirectory() as folder, patch(
                'requests.sessions.Session.request', side_effect=AssertionError('network forbidden')):
            source = RegionalEdinetDividends(Path(folder) / 'source.json', provider=BackoffProvider(),
                     identities=(IDENTITY,), clock=lambda: NOW, window_days=3,
                     checkpoint_store=self.store)
            self.addCleanup(source.close)
            source._restore_checkpoint()
            cleaned = source._clean_record('6147', record)
            self.assertEqual(cleaned['diagnostic'], diagnostic)
            self.assertEqual(cleaned['fact'], record['fact'])
            source._records['6147'] = cleaned
            source._snapshots = deepcopy(snapshots)
            source._save()
            self.assertEqual(source._checkpoint_status, 'saved')
            self.assertIsNone(source._checkpoint_save_error)
            cache = self.store.load()
            local = json.loads((Path(folder) / 'source.json').read_text())
            self.assertEqual(cache, local)
            self.assertEqual(cache['snapshots'], snapshots)
            self.assertEqual(cache['records']['6147'], cleaned)
            self.assertEqual(cache['next_request'], NOW + 3600)
            journal = deepcopy(self.transport.facts)
            self.assertEqual(len(journal), 1)

            provider = BackoffProvider()
            target = RegionalEdinetDividends(Path(folder) / 'absent.json', provider=provider,
                     identities=(IDENTITY,), clock=lambda: NOW + 10, window_days=3,
                     checkpoint_store=EdinetCheckpointStore(self.transport, clock=lambda: 10))
            self.addCleanup(target.close)
            self.assertFalse(target.cache_path.exists())
            self.assertEqual(target._snapshots, {})
            target._restore_checkpoint()
            self.assertEqual(target._checkpoint_restore_status, 'restored')
            self.assertIsNone(target._checkpoint_restore_error)
            self.assertEqual(target._snapshots, snapshots)
            self.assertEqual(target._records['6147'], cleaned)
            self.assertEqual(target._restored_next_request, NOW + 3600)
            self.assertEqual(target._checkpoint_restored_days, 2)
            self.assertEqual(len(target._checkpoint_restored_facts), 1)
            self.assertTrue(target._persistence('6147', record['fact'])['selected_fact_restored'])
            self.assertEqual(target._coverage()['missing_days'], 1)
            self.assertFalse(target._coverage()['complete'])
            self.assertEqual(self.transport.facts, journal)
            self.assertEqual(source.provider.calls, [])
            self.assertEqual(provider.calls, [])
            self.assertIsNone(source._worker)
            self.assertIsNone(target._worker)

    def fact_record(self):
        from tests.test_regional_edinet import NOW, IDENTITY, COMPANY, DESCRIPTOR, zipped
        from tests.test_regional_edinet_service import descriptor
        from regional_edinet import parse_annual_zip
        row = descriptor()
        return {'company': deepcopy(COMPANY), 'status': 'available', 'invalidated': False,
                'descriptor': row, 'fact': parse_annual_zip(zipped(), IDENTITY, row, NOW)}

    def test_fact_journal_is_create_only_and_conflicting_amount_is_never_overwritten(self):
        record = self.fact_record()
        self.assertTrue(self.store.save_fact(record))
        self.assertTrue(self.store.save_fact(record))
        saved = deepcopy(self.transport.facts)
        conflict = deepcopy(record)
        conflict['fact']['value'] = 21
        self.assertFalse(self.store.save_fact(conflict))
        self.assertEqual(self.store.last_save_error, 'checkpoint_digest_mismatch')
        self.assertEqual(self.transport.facts, saved)
        self.assertEqual(self.store.load_facts('6147', from_date='2025-09-07', to_date='2026-10-11'), [record])
        self.assertTrue(all(call[0] != 'POST' for call in self.transport.calls))

    def test_fact_journal_rejects_cross_issuer_path_hash_and_unknown_fields(self):
        record = self.fact_record()
        self.assertTrue(self.store.save_fact(record))
        path = next(iter(self.transport.facts))
        wrapper = self.transport.facts[path]
        for mutation in ('hash', 'issuer', 'extra'):
            bad = deepcopy(wrapper)
            if mutation == 'hash': bad['sha256'] = '0' * 64
            if mutation == 'issuer': bad['record']['company']['code'] = '9999'
            if mutation == 'extra': bad['record']['fact']['credential'] = 'never expose'
            self.transport.facts[path] = bad
            with self.assertRaises(ValueError):
                self.store.load_facts('6147', from_date='2025-09-07', to_date='2026-10-11')
            self.assertEqual(self.store.last_load_error, 'checkpoint_schema_invalid')

    def test_fact_journal_is_bounded_and_does_not_read_other_company_prefix(self):
        self.transport.facts[FACT_PREFIX + '/9999/unknown.json'] = {'credential': 'never expose'}
        self.assertEqual(self.store.load_facts('6147', from_date='2025-09-07', to_date='2026-10-11'), [])
        self.assertEqual([call[1] for call in self.transport.calls if call[0] == 'LIST'], [FACT_PREFIX + '/6147'])
        for n in range(4):
            self.transport.facts[FACT_PREFIX + '/6147/2026-03-31-202606260900-S100TES' + str(n) + '.json'] = {}
        with self.assertRaises(ValueError):
            self.store.load_facts('6147', from_date='2025-09-07', to_date='2026-10-11')
        self.assertEqual(self.store.last_load_error, 'checkpoint_size_limit')
        self.assertFalse(any(call[0] == 'READ' for call in self.transport.calls))

    def journal_source(self, folder):
        from regional_edinet_service import RegionalEdinetDividends
        from tests.test_regional_edinet_service import FixtureProvider, descriptor
        from tests.test_regional_edinet import NOW, IDENTITY, COMPANY, xbrl, zipped
        from regional_edinet import parse_annual_zip
        class TenProvider(FixtureProvider):
            def fetch(self, company, selected):
                self.calls.append(('filing', selected['docID']))
                return {'status': 'available', 'dividend_fact':
                        parse_annual_zip(zipped(xbrl('10.00')), IDENTITY, selected, NOW)}
        service = RegionalEdinetDividends(Path(folder) / 'source.json',
                 provider=TenProvider({'2026-10-10': [descriptor(submitDateTime='2026-10-10 09:00',
                                                              opeDateTime='2026-10-10 09:00')]}), identities=(IDENTITY,),
                 clock=lambda: NOW, window_days=3, checkpoint_store=self.store)
        service.get(COMPANY)
        self.assertTrue(service.wait_idle())
        self.assertTrue(service.get(COMPANY)['persistence']['selected_fact_saved'])
        return service

    def overwrite_global_without_fact(self, *, rows=()):
        from regional_edinet import parse_daily_filings
        from tests.test_regional_edinet import NOW
        from tests.test_regional_edinet_service import envelope
        snapshot = parse_daily_filings(envelope(rows=rows), '2026-10-11', NOW + 10)
        cache = {'version': 1, 'snapshots': {'2026-10-11': snapshot}, 'records': {}, 'next_request': 0}
        self.assertTrue(self.store.save(cache))
        self.assertEqual(self.store.load()['records'], {})

    def current_metadata_provider(self, *, original_present=True):
        from tests.test_regional_edinet_service import FixtureProvider, descriptor
        from tests.test_regional_edinet import NOW
        rows = {'2026-10-10': [descriptor(submitDateTime='2026-10-10 09:00',
                                        opeDateTime='2026-10-10 09:00')]} if original_present else {}
        class CurrentProvider(FixtureProvider):
            def fetch_day(self, day):
                result = super().fetch_day(day)
                if result.get('snapshot'):
                    result['snapshot']['fetched_at'] = NOW + 10
                return result
        return CurrentProvider(rows)

    def test_old_global_empty_overwrite_cannot_erase_exact_amount_after_name_change(self):
        from regional_edinet_service import RegionalEdinetDividends
        from tests.test_regional_edinet_service import FixtureProvider
        from tests.test_regional_edinet import NOW, IDENTITY, COMPANY
        with tempfile.TemporaryDirectory() as folder:
            source = self.journal_source(folder)
            fact = deepcopy(source.get(COMPANY)['dividend_fact'])
            self.assertEqual(fact['value'], 10)
            source.close()
            journal = deepcopy(self.transport.facts)
            # Simulate a different/old deployment overwriting only the global
            # progress object. It cannot mutate the create-only fact object.
            self.overwrite_global_without_fact()
            provider = self.current_metadata_provider()
            target = RegionalEdinetDividends(Path(folder) / 'absent.json', provider=provider,
                      identities=(IDENTITY,), clock=lambda: NOW + 10, window_days=3,
                      checkpoint_store=EdinetCheckpointStore(self.transport, clock=lambda: 10))
            renamed = {**COMPANY, 'name': '株式会社ヤマザキ'}
            target.get(renamed)
            self.assertTrue(target.wait_idle())
            result = target.get(renamed)
            self.assertEqual(result['dividend_fact'], fact)
            self.assertEqual(result['persistence']['restored_indexed_days'], 1)
            self.assertEqual(result['persistence']['restored_facts'], 1)
            self.assertTrue(result['persistence']['selected_fact_restored'])
            self.assertFalse(result['persistence']['selected_fact_saved'])
            self.assertFalse(any(kind == 'filing' for kind, value in provider.calls))
            self.assertEqual(self.transport.facts, journal)
            target.close()

    def test_withdrawal_or_newer_filing_never_recovers_stale_journal_fact(self):
        from regional_edinet_service import RegionalEdinetDividends
        from tests.test_regional_edinet_service import FixtureProvider, descriptor
        from tests.test_regional_edinet import NOW, IDENTITY, COMPANY
        cases = [descriptor(legalStatus='0'),
                 descriptor(docID='S100NEW1', periodStart='2026-04-01', periodEnd='2026-09-30',
                            submitDateTime='2026-10-09 09:00', opeDateTime='2026-10-09 09:00')]
        for row in cases:
            with self.subTest(row=row['docID']), tempfile.TemporaryDirectory() as folder:
                source = self.journal_source(folder)
                source.close()
                self.overwrite_global_without_fact(rows=[row])
                provider = FixtureProvider(fact_status='fetch_error')
                target = RegionalEdinetDividends(Path(folder) / 'absent.json', provider=provider,
                         identities=(IDENTITY,), clock=lambda: NOW + 10, window_days=3,
                         checkpoint_store=EdinetCheckpointStore(self.transport, clock=lambda: 10))
                target.get(COMPANY)
                self.assertTrue(target.wait_idle())
                result = target.get(COMPANY)
                self.assertEqual(result['data'], {})
                self.assertFalse(result['persistence']['selected_fact_restored'])
                self.assertFalse(result['persistence']['selected_fact_saved'])
                target.close()
                self.transport.wrapper, self.transport.facts = None, {}

    def test_refetched_timestamp_only_adopts_original_exact_stored_observation(self):
        from tests.test_regional_edinet import NOW, COMPANY
        with tempfile.TemporaryDirectory() as folder:
            source = self.journal_source(folder)
            original = deepcopy(source.get(COMPANY)['dividend_fact'])
            journal = deepcopy(self.transport.facts)
            source.clock = lambda: NOW + 10
            source._records['6147']['fact']['fetched_at'] = NOW + 10
            self.assertFalse(source.get(COMPANY)['persistence']['selected_fact_saved'])
            source._save()
            result = source.get(COMPANY)
            self.assertEqual(result['dividend_fact'], original)
            self.assertTrue(result['persistence']['selected_fact_saved'])
            self.assertIsNone(result['persistence']['save_error'])
            self.assertEqual(self.transport.facts, journal)
            local = json.loads((Path(folder) / 'source.json').read_text())
            self.assertEqual(local['records']['6147']['fact'], original)
            source.close()

    def test_legacy_fact_stays_visible_and_gets_one_bounded_hash_upgrade(self):
        from regional_edinet_service import RegionalEdinetDividends
        from tests.test_regional_edinet_service import FixtureProvider, descriptor
        from tests.test_regional_edinet import NOW, IDENTITY, COMPANY
        with tempfile.TemporaryDirectory() as folder:
            first = RegionalEdinetDividends(Path(folder) / 'first.json',
                    provider=FixtureProvider({'2026-10-10': [descriptor()]}),
                    identities=(IDENTITY,), clock=lambda: NOW, window_days=3)
            first.get(COMPANY)
            self.assertTrue(first.wait_idle())
            cache = json.loads((Path(folder) / 'first.json').read_text())
            cache['records']['6147']['fact'].pop('xbrl_body_sha256')
            first.close()
            self.assertTrue(self.store.save(cache))
            provider = FixtureProvider()
            target = RegionalEdinetDividends(Path(folder) / 'absent.json', provider=provider,
                    identities=(IDENTITY,), clock=lambda: NOW + 10, window_days=3,
                    checkpoint_store=EdinetCheckpointStore(self.transport, clock=lambda: 10))
            target.get(COMPANY)
            self.assertTrue(target.wait_idle())
            result = target.get(COMPANY)
            self.assertEqual(result['dividend_fact']['value'], 20)
            self.assertRegex(result['dividend_fact']['xbrl_body_sha256'], r'^[a-f0-9]{64}$')
            self.assertEqual(provider.calls, [('filing', 'S100TEST')])
            self.assertTrue(result['persistence']['selected_fact_saved'])
            self.assertFalse(result['persistence']['selected_fact_restored'])
            target.get(COMPANY)
            self.assertEqual(provider.calls, [('filing', 'S100TEST')])
            target.close()

    def test_read_only_journal_recovery_does_not_invent_saved_timestamp(self):
        from regional_edinet_service import RegionalEdinetDividends
        from tests.test_regional_edinet_service import FixtureProvider
        from tests.test_regional_edinet import NOW, IDENTITY, COMPANY
        with tempfile.TemporaryDirectory() as folder:
            source = self.journal_source(folder)
            original = deepcopy(source.get(COMPANY)['dividend_fact'])
            source.close()
            read = self.transport.read
            def without_global(path, **kwargs):
                if path == CHECKPOINT_PATH:
                    raise StorageUnavailable('storage_deadline')
                return read(path, **kwargs)
            self.transport.read = without_global
            self.transport.calls = []
            target = RegionalEdinetDividends(Path(folder) / 'absent.json', provider=self.current_metadata_provider(),
                     identities=(IDENTITY,), clock=lambda: NOW + 10, window_days=3,
                     checkpoint_store=EdinetCheckpointStore(self.transport, clock=lambda: 10))
            target.get(COMPANY)
            self.assertTrue(target.wait_idle())
            result = target.get(COMPANY)
            self.assertEqual(result['dividend_fact'], original)
            self.assertTrue(result['persistence']['selected_fact_restored'])
            self.assertEqual(result['persistence']['restored_at'], NOW + 10)
            self.assertFalse(result['persistence']['selected_fact_saved'])
            self.assertIsNone(result['persistence']['saved_at'])
            self.assertEqual(result['persistence']['durable_status'], 'restored')
            self.assertFalse(any(call[0] in ('POST', 'CREATE') for call in self.transport.calls))
            target.close()

    def test_journal_and_global_save_failures_cannot_claim_persisted_value(self):
        from tests.test_regional_edinet import COMPANY
        self.transport.create = lambda *a, **k: (_ for _ in ()).throw(StorageUnavailable('storage_write'))
        original_request = self.transport._request
        def reject_write(method, path, **kwargs):
            if method == 'POST': return Response(500)
            return original_request(method, path, **kwargs)
        self.transport._request = reject_write
        with tempfile.TemporaryDirectory() as folder:
            from regional_edinet_service import RegionalEdinetDividends
            from tests.test_regional_edinet_service import FixtureProvider, descriptor
            from tests.test_regional_edinet import NOW, IDENTITY
            target = RegionalEdinetDividends(Path(folder) / 'source.json',
                     provider=FixtureProvider({'2026-10-10': [descriptor()]}),
                     identities=(IDENTITY,), clock=lambda: NOW, window_days=3, checkpoint_store=self.store)
            target.get(COMPANY)
            self.assertTrue(target.wait_idle())
            result = target.get(COMPANY)
            self.assertEqual(result['dividend_fact']['value'], 20)
            self.assertEqual(result['persistence']['save_error'], 'storage_write')
            self.assertFalse(result['persistence']['selected_fact_saved'])
            self.assertIsNone(result['persistence']['saved_at'])
            target.close()

    def test_known_invalidated_record_stays_invalid_when_negative_snapshot_was_lost(self):
        from regional_edinet_service import RegionalEdinetDividends
        from tests.test_regional_edinet import NOW, IDENTITY, COMPANY
        with tempfile.TemporaryDirectory() as folder:
            source = self.journal_source(folder)
            source.close()
            self.overwrite_global_without_fact()
            cache = self.store.load()
            cache['records']['6147'] = {'company': deepcopy(COMPANY), 'status': 'filing_invalidated',
                                        'invalidated': True, 'updated_at': NOW + 1}
            self.assertTrue(self.store.save(cache))
            self.transport.calls = []
            target = RegionalEdinetDividends(Path(folder) / 'absent.json',
                     provider=self.current_metadata_provider(original_present=False), identities=(IDENTITY,),
                     clock=lambda: NOW + 10, window_days=3,
                     checkpoint_store=EdinetCheckpointStore(self.transport, clock=lambda: 10))
            target.get(COMPANY)
            self.assertTrue(target.wait_idle())
            result = target.get(COMPANY)
            self.assertTrue(result['invalidated'])
            self.assertEqual(result['status'], 'filing_invalidated')
            self.assertIsNone(result['dividend_fact'])
            self.assertFalse(result['persistence']['selected_fact_restored'])
            self.assertFalse(any(call[0] == 'LIST' for call in self.transport.calls))
            target.close()

    def test_today_success_without_original_submission_metadata_cannot_restore_amount(self):
        from regional_edinet_service import RegionalEdinetDividends
        from tests.test_regional_edinet import NOW, IDENTITY, COMPANY
        with tempfile.TemporaryDirectory() as folder:
            source = self.journal_source(folder)
            source.close()
            self.overwrite_global_without_fact()
            provider = self.current_metadata_provider(original_present=False)
            target = RegionalEdinetDividends(Path(folder) / 'absent.json', provider=provider,
                     identities=(IDENTITY,), clock=lambda: NOW + 10, window_days=3,
                     checkpoint_store=EdinetCheckpointStore(self.transport, clock=lambda: 10))
            target.get(COMPANY)
            self.assertTrue(target.wait_idle())
            result = target.get(COMPANY)
            self.assertIsNone(result['dividend_fact'])
            self.assertFalse(result['persistence']['selected_fact_restored'])
            self.assertEqual(provider.calls.count(('day', '2026-10-10')), 1)
            target.close()

    def test_archive_conflict_is_not_hidden_by_successful_mutable_global_save(self):
        from tests.test_regional_edinet import COMPANY, NOW, xbrl
        from regional_edinet import sha256
        with tempfile.TemporaryDirectory() as folder:
            source = self.journal_source(folder)
            original = deepcopy(self.transport.facts)
            source.clock = lambda: NOW + 10
            source._records['6147']['fact'].update(value=21,
                xbrl_body_sha256=sha256(xbrl('21.00')).hexdigest(), fetched_at=NOW + 10)
            source._save()
            result = source.get(COMPANY)
            self.assertEqual(self.store.load()['records']['6147']['fact']['value'], 21)
            self.assertEqual(self.transport.facts, original)
            self.assertEqual(result['persistence']['save_error'], 'checkpoint_digest_mismatch')
            self.assertFalse(result['persistence']['selected_fact_saved'])
            source.close()

    def test_partial_legacy_checkpoint_prioritizes_real_submitted_date_before_hash_upgrade(self):
        from regional_edinet_service import RegionalEdinetDividends
        from tests.test_regional_edinet_service import FixtureProvider, descriptor, snapshot
        from tests.test_regional_edinet import NOW, IDENTITY, COMPANY
        with tempfile.TemporaryDirectory() as folder:
            first = RegionalEdinetDividends(Path(folder) / 'first.json',
                    provider=FixtureProvider({'2026-10-10': [descriptor()]}),
                    identities=(IDENTITY,), clock=lambda: NOW, window_days=3)
            first.get(COMPANY)
            self.assertTrue(first.wait_idle())
            cache = json.loads((Path(folder) / 'first.json').read_text())
            first.close()
            cache['records']['6147']['fact'].pop('xbrl_body_sha256')
            cache['snapshots'] = {'2026-10-11': snapshot('2026-10-11')}
            self.assertTrue(self.store.save(cache))
            class CurrentProvider(FixtureProvider):
                def fetch_day(self, day):
                    self.calls.append(('day', day))
                    return {'status': 'indexed', 'snapshot': {'date': day,
                        'process_at': '2026-10-11 21:00', 'fetched_at': NOW + 10,
                        'rows': [descriptor()] if day == '2026-06-26' else []}}
            provider = CurrentProvider()
            target = RegionalEdinetDividends(Path(folder) / 'absent.json', provider=provider,
                    identities=(IDENTITY,), clock=lambda: NOW + 10, window_days=400,
                    max_warm_operations=3,
                    checkpoint_store=EdinetCheckpointStore(self.transport, clock=lambda: 10))
            target.get(COMPANY)
            self.assertTrue(target.wait_idle())
            result = target.get(COMPANY)
            self.assertEqual(provider.calls, [('day', '2026-06-26'), ('filing', 'S100TEST'),
                                              ('day', '2026-10-10')])
            self.assertEqual(result['dividend_fact']['value'], 20)
            self.assertRegex(result['dividend_fact']['xbrl_body_sha256'], r'^[a-f0-9]{64}$')
            self.assertTrue(result['persistence']['selected_fact_saved'])
            self.assertEqual(len(self.transport.facts), 1)
            self.assertGreater(result['coverage']['missing_days'], 0)
            target.close()

    def test_resumable_progress_round_trip_and_unknown_progress_rejection(self):
        cache = {**self.cache, 'records': {'9085': {'company': {'code': '9085', 'symbol': '9085.JP',
                  'name': 'fixture', 'provider_symbol': None}, 'status': 'pending', 'invalidated': False,
                  'updated_at': 10, 'warm_resume_after': 60,
                  'warm_progress': {'from': '2025-09-08', 'to': '2026-10-12', 'started_at': 10,
                                    'operations': 12, 'status': 'interrupted', 'last_date': '2026-10-01'}}}}
        self.assertTrue(self.store.save(cache))
        self.assertEqual(self.store.load(), cache)
        cache['records']['9085']['warm_progress']['api_key'] = 'fixture-only'
        self.assertFalse(self.store.save(cache))

    def test_after_fork_rechecks_private_bucket(self):
        self.assertTrue(self.store.save(self.cache))
        self.store.after_fork()
        self.assertTrue(self.store.save(self.cache))
        self.assertEqual([item[0] for item in self.transport.calls].count('GET'), 2)

    def test_real_service_checkpoint_contract_survives_local_cache_loss(self):
        from datetime import datetime
        from regional_edinet import EdinetIdentity, JST
        from regional_edinet_service import RegionalEdinetDividends
        now = datetime(2026, 10, 12, 3, 0, tzinfo=JST).timestamp()

        class Provider:
            configured = True
            def retry_after_seconds(self):
                return 0
            def next_request_at(self):
                return now + 60
            def restore_cooldown(self, value):
                return True
            def fetch_day(self, day):
                return {'status': 'indexed', 'snapshot': {'date': day, 'process_at': '2026-10-12 03:00',
                                                         'fetched_at': now, 'rows': []}}

        identity = EdinetIdentity('9085', 'E99999', 'fixture', '90850', '1234567890123', '2026-10-11')
        company = {'code': '9085', 'symbol': '9085.JP', 'name': 'fixture', 'provider_symbol': None}
        with tempfile.TemporaryDirectory() as folder:
            first = RegionalEdinetDividends(Path(folder) / 'first.json', provider=Provider(),
                         identities=(identity,), clock=lambda: now, window_days=1,
                         checkpoint_store=self.store)
            first.get(company)
            self.assertTrue(first.wait_idle())
            self.assertEqual(first.get(company)['durable_checkpoint_status'], 'saved')
            self.assertIsNotNone(self.transport.wrapper)
            first.close()
            second = RegionalEdinetDividends(Path(folder) / 'absent.json', provider=Provider(),
                         identities=(identity,), clock=lambda: now, window_days=1,
                         checkpoint_store=self.store)
            second.get(company)
            self.assertTrue(second.wait_idle())
            self.assertTrue(second.get(company)['coverage']['complete'])
            self.assertEqual(second.get(company)['coverage']['missing_days'], 0)
            second.close()

    def test_actual_fixture_amount_and_dates_restore_through_compressed_transport(self):
        from regional_edinet_service import RegionalEdinetDividends
        from tests.test_regional_edinet_service import FixtureProvider, descriptor
        from tests.test_regional_edinet import NOW, IDENTITY, COMPANY
        with tempfile.TemporaryDirectory() as folder:
            first = RegionalEdinetDividends(Path(folder) / 'first.json',
                      provider=FixtureProvider({'2026-10-10': [descriptor()]}),
                      identities=(IDENTITY,), clock=lambda: NOW, window_days=3,
                      checkpoint_store=self.store)
            first.get(COMPANY)
            self.assertTrue(first.wait_idle())
            fact = first.get(COMPANY)['dividend_fact']
            self.assertEqual(fact['value'], 20)
            self.assertTrue(first.get(COMPANY)['persistence']['selected_fact_saved'])
            first.close()
            self.assertFalse((Path(folder) / 'absent.json').exists())
            provider = FixtureProvider()
            second = RegionalEdinetDividends(Path(folder) / 'absent.json', provider=provider,
                      identities=(IDENTITY,), clock=lambda: NOW, window_days=3,
                      checkpoint_store=EdinetCheckpointStore(self.transport, clock=lambda: 10))
            # A new process restores only in its selected-company worker.
            second.get(COMPANY)
            self.assertTrue(second.wait_idle())
            restored = second.get(COMPANY)
            self.assertEqual(provider.calls, [])
            self.assertEqual(restored['dividend_fact'], fact)
            self.assertEqual(restored['persistence']['restored_indexed_days'], 3)
            self.assertEqual(restored['persistence']['restored_facts'], 1)
            self.assertTrue(restored['persistence']['selected_fact_restored'])
            self.assertTrue(restored['persistence']['selected_fact_saved'])
            self.assertEqual(restored['persistence']['restore_status'], 'restored')
            self.assertEqual(restored['persistence']['durable_status'], 'saved')
            second.close()


if __name__ == '__main__':
    unittest.main()

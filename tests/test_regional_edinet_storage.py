"""Checkpoint transport tests: no real credentials, API calls or bucket changes."""
import base64
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
import tempfile
import unittest
import zlib

from regional_edinet_storage import (CHECKPOINT_PATH, EdinetCheckpointStore,
                                    MAX_RAW_BYTES)


class Response:
    def __init__(self, code=200, payload=None):
        self.status_code, self.payload = code, payload

    def json(self):
        return self.payload


class Transport:
    def __init__(self, private=True):
        self.private, self.calls, self.wrapper = private, [], None

    def _request(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        if method == 'GET':
            return Response(payload={'public': not self.private})
        self.wrapper = json.loads(kwargs['data'])
        return Response()

    def read(self, path, **kwargs):
        self.calls.append(('READ', path, kwargs))
        return deepcopy(self.wrapper)

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
        self.transport.wrapper['headers'] = {'private': 'fixture-only'}
        with self.assertRaises(ValueError):
            self.store.load()

    def test_compression_bomb_is_bounded(self):
        raw = b' ' * (MAX_RAW_BYTES + 1)
        self.transport.wrapper = {'version': 1, 'encoding': 'zlib-base64',
            'data': base64.b64encode(zlib.compress(raw)).decode(), 'sha256': sha256(raw).hexdigest()}
        with self.assertRaises(ValueError):
            self.store.load()

    def test_network_failure_does_not_claim_save_success(self):
        self.transport._request = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError('fixture-only'))
        self.assertFalse(self.store.save(self.cache))

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

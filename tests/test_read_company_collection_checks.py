"""Read-only CLI boundaries; all transport/session fixtures stay offline."""
import argparse
from copy import deepcopy
from datetime import datetime
import io
import json
import os
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import Mock, patch

import company_news_collection_checks as checks
from news_cache import JST
from scripts import read_company_collection_checks as reader
from tests.test_company_news_collection_checks import context, projected, CountingStorage, NOW

SLOT = (datetime.fromtimestamp(NOW, JST).hour * 60 + datetime.fromtimestamp(NOW, JST).minute) // 15


def args(ctx, **changes):
    value = dict(fingerprint=ctx['fingerprint'], day='2026-10-08', slots=f'{SLOT:02d}', read_live=True,
                 result_file=None)
    value.update(changes)
    return argparse.Namespace(**value)


def registry(ctx):
    return {key: deepcopy(ctx[key]) for key in ('routes', 'source_sha256')}


class ReaderTests(unittest.TestCase):
    def setUp(self):
        patcher = patch.object(socket.socket, 'connect', side_effect=AssertionError('no network'))
        patcher.start();self.addCleanup(patcher.stop)

    def test_only_current_fixed_records_count_and_do_not_claim_membership_or_publication(self):
        ctx, storage = context(), CountingStorage()
        saved = projected(ctx, NOW - 1, finish=NOW)
        storage.create(checks.slot_path(ctx['fingerprint'], NOW - 1), saved)
        # NOW is11:00: prior observation belongs to slot43, not slot44.
        selected = f'{saved["slot"]:02d}'
        with patch('company_news_catalogue.load_current_snapshot', side_effect=ValueError('stale seed')), \
                patch('company_news_catalogue.current_catalogue', side_effect=AssertionError('source updater')):
            result = reader.run(args(ctx, slots=selected), environ={'SUPABASE_KEY': 'secret-fixture'},
                clock=lambda: NOW + 1, monotonic=lambda: 100,
                registry_factory=lambda: registry(ctx), storage_factory=lambda env, paths: storage)
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(result['records'], [saved])
        self.assertGreater(result['feed_ok_route_count'], 0)
        self.assertLess(result['dedicated_company_feed_ok_count'], result['feed_ok_route_count'])
        for field in ('membership_freshness_verified', 'publication_verified', 'all_registered_routes_verified',
                      'source_collection_started', 'generation_started'):
            self.assertFalse(result[field])
        self.assertNotIn('secret-fixture', json.dumps(result))
        self.assertEqual(len(storage.reads), 1)

    def test_dry_run_does_not_instantiate_storage_or_require_credentials(self):
        ctx, factory = context(), Mock(side_effect=AssertionError('live storage forbidden'))
        result = reader.run(args(ctx, read_live=False), environ={}, clock=lambda: NOW,
            registry_factory=lambda: registry(ctx), storage_factory=factory)
        self.assertEqual(result['status'], 'not_requested')
        self.assertEqual(result['read_count'], 0)
        factory.assert_not_called()

    def test_future_day_slot_duplicates_large_batch_or_bad_fingerprint_fail_before_get(self):
        ctx, factory = context(), Mock()
        for change in ({'day': '2026-10-09'}, {'day': '2026-10-04'}, {'day': '../escape'},
                       {'slots': f'{SLOT + 1:02d}'}, {'slots': '00,00'}, {'slots': '0'}, {'slots': '96'},
                       {'slots': '00,01,02,03,04,05,06,07,08'}, {'fingerprint': 'sk-secret'}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                reader.run(args(ctx, **change), clock=lambda: NOW,
                    registry_factory=lambda: registry(ctx), storage_factory=factory)
        factory.assert_not_called()

    def test_tampered_catalogue_version_bad_types_and_raw_errors_are_not_printed(self):
        ctx = context()
        saved = projected(ctx, NOW - 1, finish=NOW)
        for mutation in ('catalogue', 'source', 'body', 'boolean', 'row_boolean', 'raw_error'):
            storage, value = CountingStorage(), deepcopy(saved)
            if mutation == 'catalogue':value['catalogue_sha256'] = 'd' * 64
            elif mutation == 'source':value['source_sha256'] = 'e' * 64
            elif mutation == 'body':value['rows'][0]['body'] = 'secret original source body'
            elif mutation == 'boolean':value['schema_version'] = True
            elif mutation == 'row_boolean':
                value['rows'][0]['diagnostics_valid'] = False
                value['rows'][0].update(checks._empty_row());value['rows'][0]['selected'] = False
                value['invalid_row_count'] = 1
            else:value['rows'][0]['errors'] = ['secret-key https://private.invalid/error']
            storage.values[checks.slot_path(ctx['fingerprint'], NOW - 1)] = value
            result = reader.run(args(ctx, slots=f'{saved["slot"]:02d}'), clock=lambda: NOW + 1,
                monotonic=lambda: 100, registry_factory=lambda: registry(ctx),
                storage_factory=lambda env, paths: storage)
            with self.subTest(mutation=mutation):
                self.assertEqual(result['status'], 'partial')
                self.assertEqual(result['records'], [])
                self.assertEqual(result['feed_ok_route_count'], 0)
                self.assertEqual(result['invalid_slots'], [saved['slot']])
                for secret in ('secret', 'original source body', 'private.invalid'):
                    self.assertNotIn(secret, json.dumps(result))

    def test_read_failure_uses_fixed_state_not_exception_or_credentials(self):
        ctx, storage = context(), CountingStorage()
        storage.read = Mock(side_effect=RuntimeError('sb_secret_test https://private.invalid'))
        result = reader.run(args(ctx), environ={'SUPABASE_KEY': 'secret'}, clock=lambda: NOW,
            monotonic=lambda: 100, registry_factory=lambda: registry(ctx),
            storage_factory=lambda env, paths: storage)
        self.assertEqual(result['unread_slots'], [SLOT])
        self.assertEqual(result['read_count'], 1)
        self.assertEqual(result['records'], [])
        self.assertNotIn('secret', json.dumps(result))
        self.assertNotIn('private.invalid', json.dumps(result))

    def test_local_registry_without_fresh_seed_is_same_descriptor_generation(self):
        with patch('company_news_catalogue.load_current_snapshot', side_effect=ValueError('stale seed')):
            local = checks.local_registry()
        self.assertGreater(len(local['routes']), 1)
        # Reader uses opaque server catalogue hashes, not the CI seed freshness.
        ctx = checks.context_from_registry(local['routes'], source_sha256=local['source_sha256'],
            catalogue_sha256='b' * 64, catalogue_source_sha256='c' * 64)
        self.assertEqual(ctx['source_sha256'], local['source_sha256'])


class GetOnlyTests(unittest.TestCase):
    def test_fixed_allowlist_and_method_cannot_write_or_follow_redirect(self):
        ctx = context()
        path = checks.slot_path(ctx['fingerprint'], NOW)
        storage = reader.ReadOnlyStorage({'SUPABASE_URL': 'https://fixture.supabase.co',
                                         'SUPABASE_KEY': 'sb_secret_fixture'}, [path])
        self.assertFalse(hasattr(storage, 'create'))
        self.assertFalse(hasattr(storage, 'ensure_private'))
        with self.assertRaises(reader.StorageUnavailable):
            storage.read('days/2026-10-08/edition.json', deadline=102, clock=lambda: 100)
        client = storage._client
        client._session = Mock()
        route = next(iter(client._allowed))
        for method, location in (('POST', route), ('GET', '/bucket/anything')):
            with self.assertRaises(reader.StorageUnavailable):
                client._request_direct(method, location, deadline=102, clock=lambda: 100)
        client._session.request.assert_not_called()
        response = Mock(status_code=302, headers={})
        response.raw.read1.side_effect = [b'{}', b'']
        client._session.request.return_value = response
        result = client._request_direct('GET', route, deadline=102, clock=lambda: 100)
        self.assertEqual(result.status_code, 302)
        self.assertFalse(client._session.request.call_args.kwargs['allow_redirects'])
        response.close.assert_called_once()

    def test_private_response_has_strict128kb_cap(self):
        ctx = context();path = checks.slot_path(ctx['fingerprint'], NOW)
        client = reader._GetClient('https://fixture.supabase.co', 'sb_secret_fixture', [path])
        route = next(iter(client._allowed))
        for length in (str(checks.MAX_BYTES + 1), 'not-a-number'):
            response = Mock(status_code=200, headers={'Content-Length': length})
            client._session = Mock();client._session.request.return_value = response
            with self.assertRaises(reader.StorageUnavailable):
                client._request_direct('GET', route, deadline=102, clock=lambda: 100)
            response.raw.read1.assert_not_called()
        response = Mock(status_code=200, headers={})
        response.raw.read1.side_effect = [b'x' * (checks.MAX_BYTES + 1)]
        client._session.request.return_value = response
        with self.assertRaises(reader.StorageUnavailable):
            client._request_direct('GET', route, deadline=102, clock=lambda: 100)


class FileAndMainTests(unittest.TestCase):
    def test_result_file_is_new0600_and_rejects_existing_or_symlink_components(self):
        with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as folder:
            path = Path(folder) / 'result.json'
            report = {'status': 'complete', 'success': True}
            reader.write_result(path, report)
            self.assertEqual(json.loads(path.read_text()), report)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):reader.write_result(path, {})
            link = Path(folder) / 'link';link.symlink_to(path)
            with self.assertRaises(OSError):reader.write_result(link, {})
            nested = Path(folder) / 'nested';nested.symlink_to(folder, target_is_directory=True)
            with self.assertRaises(OSError):reader.write_result(nested / 'other.json', {})
            self.assertEqual(json.loads(path.read_text()), report)

    def test_invalid_cli_does_not_echo_arguments_or_raw_errors(self):
        output = io.StringIO()
        with patch('sys.stdout', output):
            code = reader.main(['--fingerprint', 'sb_secret_fixture', '--day', '../escape', '--slots', '96'])
        self.assertEqual(code, 1)
        value = json.loads(output.getvalue())
        self.assertEqual(value['status'], 'invalid_request')
        self.assertNotIn('secret', output.getvalue())
        self.assertNotIn('../escape', output.getvalue())


if __name__ == '__main__':
    unittest.main()

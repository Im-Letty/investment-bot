"""Offline coverage for the narrowly scoped cost-only reconciliation CLI."""
from contextlib import redirect_stdout
from copy import deepcopy
from datetime import datetime
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from daily_news_runtime import BUCKET, StorageUnavailable
from news_review_costs import JST, PREFIX, ReviewUsageRecorder


_SPEC = importlib.util.spec_from_file_location(
    'cost_reconciliation_cli',
    Path(__file__).resolve().parents[1] / 'scripts' / 'reconcile_news_review_costs.py')
cli = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(cli)

DAY = '2026-10-16'
NOW = datetime(2026, 10, 17, 3, 50, tzinfo=JST).timestamp()
SECRET = 'private-secret-fixture https://private.invalid/?key=private-secret-fixture'


class MemoryStorage:
    """No transport, credentials, bucket creation or writes during a scan."""

    def __init__(self):
        self.values = {}
        self.operations = []
        self.passes = 0
        self.on_pass = None
        self.fail_private = False
        self.fail_list = False
        self.closed = False

    def create(self, path, value, *, deadline=None):
        if path in self.values:
            return False
        self.values[path] = deepcopy(value)
        return True

    def read(self, path, *, deadline=None):
        self.operations.append(('read', path, deadline))
        return deepcopy(self.values.get(path))

    def _list(self, prefix, *, offset=0, deadline=None):
        self.operations.append(('list', prefix, offset, deadline))
        if offset == 0:
            self.passes += 1
            if self.on_pass is not None:
                self.on_pass(self.passes)
        if self.fail_list:
            raise RuntimeError(SECRET)
        names = sorted((key[len(prefix) + 1:] for key in self.values
                        if key.startswith(prefix + '/')), reverse=True)
        return [{'name': name} for name in names[offset:offset + 30]]

    def check_private(self, *, deadline):
        self.operations.append(('check_private', deadline))
        if self.fail_private:
            raise RuntimeError(SECRET)

    def close(self):
        self.closed = True


def add_receipt(storage, number=1, *, usage=True):
    identifier = format(number, '032x')
    recorder = ReviewUsageRecorder(storage, scope='company',
        clock=lambda: datetime(2026, 10, 16, 9, 0, tzinfo=JST).timestamp(),
        run_context={})
    recorder.start_request(provider='gemini', model='gemini-2.5-flash',
                           request_id=identifier)
    recorder.record_request(provider='gemini', model='gemini-2.5-flash',
        request_id=identifier, usage=({'promptTokenCount': 1000,
            'totalTokenCount': 1100, 'candidatesTokenCount': 100,
            'thoughtsTokenCount': 0} if usage else None))
    return identifier


class ReconciliationTests(unittest.TestCase):
    def setUp(self):
        network = patch('socket.socket.connect', side_effect=AssertionError('network disabled'))
        network.start()
        self.addCleanup(network.stop)
        self.storage = MemoryStorage()
        self.factory_calls = []

    def factory(self, environ, day):
        self.factory_calls.append((environ, day))
        return self.storage

    def run_report(self, *, day=DAY, live=True, **options):
        return cli.run(SimpleNamespace(day=day, live=live), environ={},
            storage_factory=self.factory, clock=lambda: NOW,
            monotonic=lambda: 100.0, **options)

    def test_offline_mode_never_constructs_storage(self):
        result = self.run_report(live=False)
        self.assertEqual(result['status'], 'not_requested')
        self.assertEqual(self.factory_calls, [])
        self.assertFalse(result['scan_complete'])

    def test_explicit_day_is_checked_against_jst_not_utc(self):
        self.assertEqual(self.run_report(day='2026-10-17', live=False)['day'], '2026-10-17')
        self.assertEqual(self.run_report(day='2026-09-16', live=False)['day'], '2026-09-16')
        for day in ('2026-10-18', '2026-09-15', '2026-10-32',
                    '20261016', '2026-10-16/../private', '2026-1-1'):
            with self.subTest(day=day), self.assertRaises(ValueError):
                self.run_report(day=day)
        self.assertEqual(self.factory_calls, [])

    def test_two_complete_stable_scans_reconcile_known_amount_once(self):
        identifier = add_receipt(self.storage)
        result = self.run_report()
        self.assertEqual(result['status'], 'complete')
        self.assertTrue(result['scan_complete'])
        self.assertTrue(result['stable_receipts'])
        self.assertTrue(result['full_amount_known'])
        self.assertEqual(len(result['passes']), 2)
        self.assertEqual(result['daily']['request_count'], 1)
        self.assertEqual(result['daily']['estimated_cost_usd'], '0.00055')
        self.assertEqual(result['daily']['estimated_cost_jpy'], '0.08745')
        for field in ('receipt_set_sha256', 'request_set_sha256', 'request_count',
                      'estimated_cost_usd', 'estimated_cost_jpy'):
            self.assertEqual(result['daily'][field], result['passes'][1][field])
        self.assertTrue(all('receipts' not in value for value in result['passes']))
        self.assertEqual(result['daily']['receipts'][0]['request_sha256'],
                         hashlib.sha256(identifier.encode()).hexdigest())
        self.assertNotIn('request_id', json.dumps(result))
        self.assertFalse(result['snapshot_guaranteed'])
        self.assertFalse(result['invoice_amount'])
        self.assertFalse(result['historical_run_attribution_complete'])
        self.assertTrue(self.storage.closed)
        self.assertEqual([call[0] for call in self.storage.operations].count('check_private'), 1)
        self.assertTrue(all(call[0] in ('read', 'list', 'check_private')
                            for call in self.storage.operations))

    def test_unknown_cost_is_reconciled_as_unknown_never_zero_amount(self):
        add_receipt(self.storage, usage=False)
        result = self.run_report()
        self.assertEqual(result['status'], 'reconciled_with_unknown_costs')
        self.assertTrue(result['stable_receipts'])
        self.assertFalse(result['full_amount_known'])
        self.assertEqual(result['daily']['unknown_cost_count'], 1)
        self.assertIsNone(result['daily']['receipts'][0]['usd_nanos'])
        self.assertFalse(result['daily']['estimate_complete'])
        self.assertEqual(result['daily']['target_state'], 'unknown')

    def test_changed_receipt_set_between_passes_is_incomplete(self):
        add_receipt(self.storage)
        self.storage.on_pass = lambda number: add_receipt(self.storage, 2) if number == 2 else None
        result = self.run_report()
        self.assertTrue(result['scan_complete'])
        self.assertFalse(result['stable_receipts'])
        self.assertFalse(result['full_amount_known'])
        self.assertEqual(result['status'], 'incomplete')
        self.assertEqual([value['request_count'] for value in result['passes']], [1, 2])
        self.assertEqual(result['daily']['request_count'], 2)

    def test_failed_scan_keeps_failure_status_and_never_raw_error(self):
        self.storage.fail_list = True
        result = self.run_report()
        self.assertEqual(result['status'], 'incomplete')
        self.assertFalse(result['scan_complete'])
        self.assertFalse(result['stable_receipts'])
        self.assertFalse(result['full_amount_known'])
        self.assertIn('storage_list_failed', result['daily']['scan']['reason_codes'])
        self.assertNotIn('private-secret-fixture', json.dumps(result))
        self.assertNotIn('private.invalid', json.dumps(result))
        self.assertTrue(self.storage.closed)

    def test_private_bucket_failure_never_attempts_receipt_scan_or_leaks_exception(self):
        self.storage.fail_private = True
        result = self.run_report()
        self.assertEqual(result['status'], 'storage_unavailable')
        self.assertEqual(result['passes'], [])
        self.assertEqual([call[0] for call in self.storage.operations], ['check_private'])
        self.assertTrue(self.storage.closed)
        self.assertNotIn('private-secret-fixture', json.dumps(result))

    def test_payload_extra_content_is_never_copied_to_report(self):
        add_receipt(self.storage)
        for value in self.storage.values.values():
            value.update(raw_response=SECRET, prompt=SECRET, url=SECRET, api_key=SECRET)
        result = self.run_report()
        self.assertEqual(result['status'], 'complete')
        self.assertNotIn('private-secret-fixture', json.dumps(result))
        self.assertNotIn('private.invalid', json.dumps(result))

    def test_near_object_capacity_remains_within_output_bound(self):
        for number in range(1, 600):
            add_receipt(self.storage, number)
        result = self.run_report()
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(result['daily']['request_count'], 599)
        self.assertEqual(result['daily']['scan']['read_object_count'], 1198)
        self.assertEqual(len(result['daily']['receipts']), 599)
        self.assertTrue(all('receipts' not in value for value in result['passes']))
        payload = json.dumps(result, ensure_ascii=True, sort_keys=True,
                             allow_nan=False).encode() + b'\n'
        self.assertLessEqual(len(payload), cli.MAX_OUTPUT_BYTES)
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory).resolve() / 'safe.json'
            cli.write_result(target, result)
            self.assertEqual(target.stat().st_size, len(payload))

    def test_only_valid_nonsecret_reader_metadata_is_projected_from_environment(self):
        safe_env = {'COST_SOURCE_REVISION': 'b' * 40,
                    'GITHUB_RUN_ID': '38826905435', 'GITHUB_RUN_ATTEMPT': '2',
                    'SUPABASE_KEY': SECRET, 'SUPABASE_URL': SECRET,
                    'GITHUB_TOKEN': SECRET, 'OTHER_PRIVATE_FIELD': SECRET}
        result = cli.run(SimpleNamespace(day=DAY, live=True), environ=safe_env,
                         storage_factory=self.factory, clock=lambda: NOW,
                         monotonic=lambda: 100.0)
        self.assertEqual(result['reader_source_revision'], 'b' * 40)
        self.assertEqual(result['reader_run_id'], 38826905435)
        self.assertEqual(result['reader_run_attempt'], 2)
        self.assertNotIn('private-secret-fixture', json.dumps(result))
        unsafe_env = {key: SECRET for key in ('COST_SOURCE_REVISION',
                                            'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT')}
        result = cli.run(SimpleNamespace(day=DAY, live=True), environ=unsafe_env,
                         storage_factory=self.factory, clock=lambda: NOW,
                         monotonic=lambda: 100.0)
        self.assertNotIn('reader_source_revision', result)
        self.assertNotIn('reader_run_id', result)
        self.assertNotIn('reader_run_attempt', result)
        self.assertNotIn('private-secret-fixture', json.dumps(result))

    def test_orphan_usage_does_not_look_like_a_complete_empty_day(self):
        identifier = add_receipt(self.storage)
        del self.storage.values[f'{PREFIX}/{DAY}/{identifier}.start.json']
        result = self.run_report()
        self.assertEqual(result['status'], 'incomplete')
        self.assertFalse(result['scan_complete'])
        self.assertEqual(result['daily']['scan']['orphan_usage_count'], 1)

    def test_main_sanitizes_parser_and_runtime_errors(self):
        for argv in (['--day', SECRET], ['--day', DAY, '--unrecognized', SECRET]):
            with self.subTest(argv=argv), io.StringIO() as output, redirect_stdout(output):
                self.assertEqual(cli.main(argv), 1)
                value = output.getvalue()
                self.assertEqual(json.loads(value)['status'], 'invalid_request')
                self.assertNotIn('private-secret-fixture', value)
        with patch.object(cli, 'run', side_effect=RuntimeError(SECRET)):
            with io.StringIO() as output, redirect_stdout(output):
                self.assertEqual(cli.main(['--day', DAY]), 1)
                self.assertNotIn('private-secret-fixture', output.getvalue())


class NarrowAdapterTests(unittest.TestCase):
    def setUp(self):
        self.client = object.__new__(cli._CostClient)
        self.client.day = DAY
        self.client.prefix = f'{PREFIX}/{DAY}'
        self.client._url = 'https://private.invalid/storage/v1'
        self.client._headers = {'Authorization': 'Bearer private-secret-fixture'}
        self.client._timeout = (3, 8)
        self.client._session = Mock()
        self.bucket_path = '/bucket/' + BUCKET
        self.object_path = '/object/authenticated/' + BUCKET + '/' + self.client.prefix + '/' + 'a' * 32 + '.start.json'
        self.list_path = '/object/list/' + BUCKET
        self.payload = {'prefix': self.client.prefix, 'limit': 30, 'offset': 0,
                        'sortBy': {'column': 'name', 'order': 'desc'}}

    def test_allowlist_permits_only_exact_bucket_get_receipt_get_and_day_list(self):
        for method, path, options in [('GET', self.bucket_path, {}),
                ('GET', self.object_path, {}),
                ('GET', self.object_path.replace('.start.json', '.usage.json'), {}),
                ('POST', self.list_path, {'json': self.payload})]:
            with self.subTest(method=method, path=path):
                self.client._allowed(method, path, options)

    def test_allowlist_denies_writes_other_prefixes_and_path_injection(self):
        attempts = [
            ('PUT', self.object_path, {}), ('DELETE', self.object_path, {}),
            ('POST', self.object_path, {'json': {}}),
            ('POST', self.bucket_path, {'json': {}}),
            ('GET', self.bucket_path + '/other', {}),
            ('GET', self.object_path, {'params': {'download': True}}),
            ('GET', self.object_path.replace(DAY, '2026-10-15'), {}),
            ('GET', self.object_path + '?key=secret', {}),
            ('GET', self.object_path.replace('a' * 32, '../' + 'a' * 32), {}),
            ('GET', self.object_path.replace('a' * 32, '%2e%2e%2f' + 'a' * 32), {}),
            ('GET', self.object_path.replace('a' * 32, 'A' * 32), {}),
            ('GET', self.object_path.replace('.start.json', '.news.json'), {}),
            ('POST', self.list_path, {'json': self.payload, 'headers': {}}),
        ]
        for method, path, options in attempts:
            with self.subTest(method=method, path=path, options=options):
                with self.assertRaises(StorageUnavailable):
                    self.client._allowed(method, path, options)
        self.client._session.request.assert_not_called()

    def test_list_payload_has_fixed_bounds_and_no_extra_options(self):
        changes = [
            {'prefix': self.client.prefix + '/other'}, {'limit': 31},
            {'offset': -30}, {'offset': True}, {'offset': 1},
            {'offset': 1200}, {'offset': 30.0},
            {'sortBy': {'column': 'name', 'order': 'asc'}},
            {'search': 'private-secret-fixture'},
        ]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(StorageUnavailable):
                self.client._allowed('POST', self.list_path,
                                     {'json': {**self.payload, **change}})
        for offset in (0, 30, 1170):
            self.client._allowed('POST', self.list_path,
                                 {'json': {**self.payload, 'offset': offset}})

    def response(self, *, status=200, chunks=(b'{}', b''), headers=None):
        value = Mock()
        value.status_code = status
        value.headers = {} if headers is None else headers
        value.raw.read1.side_effect = list(chunks)
        self.client._session.request.return_value = value
        return value

    def test_direct_transport_disables_redirects_and_closes_response(self):
        response = self.response(status=302, headers={'Location': 'https://evil.invalid/'})
        result = self.client._request_direct('GET', self.bucket_path,
                                             deadline=10, clock=lambda: 0)
        self.assertEqual(result.status_code, 302)
        options = self.client._session.request.call_args.kwargs
        self.assertFalse(options['allow_redirects'])
        self.assertTrue(options['stream'])
        self.assertEqual(self.client._session.request.call_count, 1)
        response.close.assert_called_once()

    def test_oversized_declared_or_streamed_body_is_rejected_and_closed(self):
        cases = [({'Content-Length': str(cli.MAX_RESPONSE_BYTES + 1)}, (b'',)),
                 ({'Content-Length': 'bad'}, (b'',)),
                 ({}, (b'a' * cli.MAX_RESPONSE_BYTES, b'b', b''))]
        for headers, chunks in cases:
            with self.subTest(headers=headers):
                response = self.response(headers=headers, chunks=chunks)
                with self.assertRaises(StorageUnavailable):
                    self.client._request_direct('GET', self.bucket_path,
                                                 deadline=10, clock=lambda: 0)
                response.close.assert_called_once()

    def test_exact_stream_limit_is_accepted(self):
        response = self.response(chunks=(b'a' * cli.MAX_RESPONSE_BYTES, b''))
        result = self.client._request_direct('GET', self.bucket_path,
                                             deadline=10, clock=lambda: 0)
        self.assertEqual(len(result.content), cli.MAX_RESPONSE_BYTES)
        response.close.assert_called_once()

    def test_missing_deadline_and_network_exception_are_safe(self):
        with self.assertRaises(StorageUnavailable):
            self.client._request_direct('GET', self.bucket_path)
        self.client._session.request.assert_not_called()
        self.client._session.request.side_effect = RuntimeError(SECRET)
        with self.assertRaises(StorageUnavailable) as raised:
            self.client._request_direct('GET', self.bucket_path,
                                         deadline=10, clock=lambda: 0)
        self.assertEqual(str(raised.exception), 'storage_network')
        self.assertNotIn('private-secret-fixture', str(raised.exception))


class ResultFileTests(unittest.TestCase):
    def test_output_is_private_exclusive_and_json_only(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory).resolve() / 'safe.json'
            report = {'status': 'complete', 'count': 2}
            cli.write_result(target, report)
            self.assertEqual(json.loads(target.read_text()), report)
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            with self.assertRaises(FileExistsError):
                cli.write_result(target, {'count': 3})
            self.assertEqual(json.loads(target.read_text()), report)

    def test_final_and_parent_symlinks_are_not_followed(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory).resolve()
            destination = base / 'untouched.json'
            destination.write_text('untouched')
            link = base / 'safe.json'
            link.symlink_to(destination)
            with self.assertRaises(OSError):
                cli.write_result(link, {'status': 'complete'})
            self.assertEqual(destination.read_text(), 'untouched')
            real = base / 'real'
            real.mkdir()
            parent_link = base / 'parent'
            parent_link.symlink_to(real, target_is_directory=True)
            with self.assertRaises(OSError):
                cli.write_result(parent_link / 'new.json', {'status': 'complete'})
            self.assertEqual(list(real.iterdir()), [])

    def test_nonfinite_and_oversized_output_do_not_create_file(self):
        for report in ({'count': float('nan')}, {'data': 'x' * cli.MAX_OUTPUT_BYTES}):
            with self.subTest(kind=list(report)):
                with tempfile.TemporaryDirectory() as directory:
                    target = Path(directory).resolve() / 'safe.json'
                    with self.assertRaises(ValueError):
                        cli.write_result(target, report)
                    self.assertFalse(target.exists())


if __name__ == '__main__':
    unittest.main()

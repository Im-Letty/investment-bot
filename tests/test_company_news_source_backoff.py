"""No-HTTP fixtures verify refusal/rate waits and restart-safe merging."""
from concurrent.futures import ThreadPoolExecutor
from email.utils import formatdate
import importlib
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import company_news_source_backoff as backoff


NOW = 1791882000
HOST = 'prtimes.jp'
OTHER = 'fixture.example'


class CompanySourceBackoffTests(unittest.TestCase):
    def setUp(self):
        self.waits = backoff.SourceHostBackoff({HOST, OTHER}, clock=lambda: NOW)

    def test_positive_retry_after_seconds_is_exact_even_below_or_above_fallback(self):
        for seconds in (1, 5, 901, 7200, 172800):
            with self.subTest(seconds=seconds):
                waits = backoff.SourceHostBackoff({HOST})
                row = waits.record_response(HOST, 429, str(seconds), now=NOW)
                self.assertEqual(row, {'blocked': True, 'error_code': 'source_rate_wait',
                                       'wait_until': NOW + seconds})
                self.assertTrue(waits.check(HOST, now=NOW + seconds - 0.1)['blocked'])
                self.assertFalse(waits.check(HOST, now=NOW + seconds)['blocked'])

    def test_future_http_date_is_exact_without_fetch_clock_replacement(self):
        until = NOW + 3600
        row = self.waits.record_response(HOST, 503, formatdate(until, usegmt=True))
        self.assertEqual(row['wait_until'], until)

    def test_absent_invalid_zero_negative_and_past_retry_after_use_900(self):
        for value in (None, '', '0', '-5', '5.2', 100, 'private-error',
                      formatdate(NOW - 1, usegmt=True), 'Wed, 1 Jan 2020 00:00:00',
                      '9' * 128, '\r\nsecret:value'):
            with self.subTest(value=str(value)[:20]):
                waits = backoff.SourceHostBackoff({HOST})
                self.assertEqual(waits.record_response(HOST, 503, value, now=NOW)['wait_until'], NOW + 900)

    def test_403_refusal_is_at_least_one_day_and_can_preserve_longer_server_wait(self):
        for value, until in ((None, NOW + 86400), ('1', NOW + 86400),
                             ('172800', NOW + 172800)):
            with self.subTest(value=value):
                waits = backoff.SourceHostBackoff({HOST})
                row = waits.record_response(HOST, 403, value, now=NOW)
                self.assertEqual(row['error_code'], 'source_refused')
                self.assertEqual(row['wait_until'], until)

    def test_success_and_shorter_later_wait_never_clear_or_shorten_existing_wait(self):
        original = self.waits.record_response(HOST, 429, '10000')
        for status in (200, 404, 500, 429, 503):
            row = self.waits.record_response(HOST, status, '1', now=NOW + 10)
            self.assertEqual(row, original)

    def test_unrelated_approved_host_is_not_blocked_and_unknown_host_never_enters_state(self):
        self.waits.record_response(HOST, 403)
        self.assertFalse(self.waits.check(OTHER)['blocked'])
        for host in ('127.0.0.1', 'PRTIMES.JP', 'prtimes.jp.evil.example',
                     'https://prtimes.jp', 'localhost', '', None):
            with self.subTest(host=host):
                with self.assertRaisesRegex(ValueError, '^unapproved_source$'):
                    self.waits.check(host)
                with self.assertRaisesRegex(ValueError, '^unapproved_source$'):
                    self.waits.record_response(host, 429, '7200')

    def test_invalid_time_http_status_or_approved_host_configuration_is_fixed(self):
        for value in (None, True, 0, -1, math.nan, math.inf, 10 ** 400, 253402300800):
            with self.subTest(now=str(value)[:12]):
                waits = backoff.SourceHostBackoff({HOST}, clock=lambda: value)
                with self.assertRaisesRegex(ValueError, '^source_backoff_unavailable$'):
                    waits.check(HOST)
        for status in (True, 99, 600, '429', None):
            with self.assertRaisesRegex(ValueError, '^source_backoff_unavailable$'):
                self.waits.record_response(HOST, status)
        for hosts in ([], [HOST, HOST], ['localhost'], ['127.0.0.1'],
                      ['user@prtimes.jp'], ['fixture.example\n'], 'prtimes.jp'):
            with self.assertRaisesRegex(ValueError, '^unapproved_source$'):
                backoff.SourceHostBackoff(hosts)

    def test_expiry_and_clock_rollback_do_not_erase_wait_history(self):
        original = self.waits.record_response(HOST, 429, '900')
        self.assertFalse(self.waits.check(HOST, now=NOW + 901)['blocked'])
        self.assertEqual(self.waits.check(HOST, now=NOW - 1), original)

    def test_restart_retains_exact_wait_and_new_object_cannot_reduce_disk_state(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'backoff.json'
            first = backoff.SourceHostBackoff({HOST}, state_path=path)
            original = first.record_response(HOST, 429, '9000', now=NOW)
            fresh = backoff.SourceHostBackoff({HOST}, state_path=path)
            self.assertEqual(fresh.check(HOST, now=NOW), original)
            self.assertEqual(fresh.record_response(HOST, 503, '1', now=NOW + 1), original)
            self.assertEqual(first.check(HOST, now=NOW + 1), original)
            self.assertLess(path.stat().st_size, 64000)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_different_instances_and_threads_merge_maximum_under_shared_file_lock(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'backoff.json'
            workers = [backoff.SourceHostBackoff({HOST, OTHER}, state_path=path) for _ in range(8)]
            def record(index):
                return workers[index].record_response(HOST, 429, str((index + 1) * 1000), now=NOW)
            with ThreadPoolExecutor(max_workers=8) as pool:
                list(pool.map(record, range(8)))
            for worker in workers:
                self.assertEqual(worker.check(HOST, now=NOW)['wait_until'], NOW + 8000)
            workers[0].record_response(OTHER, 403, now=NOW)
            self.assertEqual(workers[7].check(HOST, now=NOW)['wait_until'], NOW + 8000)
            self.assertEqual(workers[7].check(OTHER, now=NOW)['wait_until'], NOW + 86400)

    def test_removed_host_history_does_not_expand_next_process_allowlist(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'backoff.json'
            original = backoff.SourceHostBackoff({HOST, OTHER}, state_path=path)
            original.record_response(HOST, 429, '9000', now=NOW)
            narrowed = backoff.SourceHostBackoff({OTHER}, state_path=path)
            narrowed.record_response(OTHER, 403, now=NOW)
            with self.assertRaisesRegex(ValueError, '^unapproved_source$'):
                narrowed.check(HOST, now=NOW)
            restored = backoff.SourceHostBackoff({HOST}, state_path=path)
            self.assertEqual(restored.check(HOST, now=NOW)['wait_until'], NOW + 9000)

    def test_corrupt_or_oversized_persistent_state_fails_closed_without_clearing_memory(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'backoff.json'
            worker = backoff.SourceHostBackoff({HOST}, state_path=path)
            worker.record_response(HOST, 429, '9000', now=NOW)
            invalid = [b'private-corrupt-error', b'x' * 64001,
                       json.dumps({'schema_version': True, 'hosts': {}}).encode(),
                       json.dumps({'schema_version': 1, 'hosts': {HOST: {'until': NOW + 9000,
                         'code': 'upstream-secret-error'}}}).encode()]
            for payload in invalid:
                path.write_bytes(payload)
                with self.assertRaisesRegex(ValueError, '^source_backoff_unavailable$'):
                    worker.check(HOST, now=NOW)
            path.unlink()
            self.assertEqual(worker.check(HOST, now=NOW)['wait_until'], NOW + 9000)

    def test_symlink_state_or_lock_is_rejected_without_reading_target(self):
        with tempfile.TemporaryDirectory() as folder:
            path, target = Path(folder) / 'backoff.json', Path(folder) / 'private-target'
            target.write_text('private sentinel')
            for destination in (path, Path(str(path) + '.lock')):
                if destination.exists():
                    destination.unlink()
                destination.symlink_to(target)
                worker = backoff.SourceHostBackoff({HOST}, state_path=path)
                with self.assertRaisesRegex(ValueError, '^source_backoff_unavailable$'):
                    worker.check(HOST, now=NOW)
                destination.unlink()
                self.assertEqual(target.read_text(), 'private sentinel')

    def test_import_check_and_record_never_create_network_or_sleep(self):
        with patch('socket.socket', side_effect=AssertionError('network forbidden')), \
             patch('time.sleep', side_effect=AssertionError('sleep forbidden')):
            module = importlib.reload(backoff)
            worker = module.SourceHostBackoff({HOST})
            self.assertTrue(worker.record_response(HOST, 429, '1', now=NOW)['blocked'])
            self.assertFalse(worker.check(HOST, now=NOW + 1)['blocked'])


if __name__ == '__main__':
    unittest.main()

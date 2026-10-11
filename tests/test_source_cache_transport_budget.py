"""Offline transport checks: no real HTTP, credentials, or paid providers."""
import json
import multiprocessing
import os
import pickle
import subprocess
from threading import Event, Thread
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from daily_news_runtime import StorageUnavailable, SupabaseNewsStorage, _StorageResponse

OFFLINE_CONTEXT = multiprocessing.get_context('fork')


class SharedClock:
    def __init__(self, now=100.0):
        self.value = OFFLINE_CONTEXT.Value('d', now)

    def __call__(self):
        return self.value.value

    def advance(self, seconds):
        with self.value.get_lock():
            self.value.value += seconds


class OfflineSession:
    def __init__(self, *, clock=None, header_seconds=0, body_seconds=0,
                 blocked=None, trickle=False, status=200, error=None):
        self.clock, self.header_seconds, self.body_seconds = clock, header_seconds, body_seconds
        self.blocked, self.trickle, self.status, self.error = blocked, trickle, status, error
        self.calls = OFFLINE_CONTEXT.Value('i', 0)
        self.closed = OFFLINE_CONTEXT.Value('i', 0)
        self.timeout = OFFLINE_CONTEXT.Array('d', [0, 0])
        self.offset = OFFLINE_CONTEXT.Value('i', -1)
        self.started = OFFLINE_CONTEXT.Event()
        self.body_started = OFFLINE_CONTEXT.Event()
        self.never = OFFLINE_CONTEXT.Event()

    def request(self, method, url, **kwargs):
        with self.calls.get_lock():
            self.calls.value += 1
        self.started.set()
        self.timeout[:] = kwargs['timeout']
        if self.blocked == 'headers':
            self.never.wait()
        if self.error:
            raise RuntimeError(self.error)
        if self.clock:
            self.clock.advance(self.header_seconds)
        if method == 'POST':
            self.offset.value = kwargs['json']['offset']
            payload = [{'name': 'result.json'}]
        else:
            payload = {'verified': True}
        return OfflineResponse(self, json.dumps(payload).encode())


class OfflineResponse:
    def __init__(self, session, payload):
        self.session, self.payload = session, payload
        self.status_code, self.headers, self.raw = session.status, {}, self
        self.read_count = 0

    def read1(self, size, **kwargs):
        self.session.body_started.set()
        if self.session.blocked == 'body':
            self.session.never.wait()
        if self.session.trickle:
            # Continual progress would evade a socket inactivity timeout.
            time.sleep(0.03)
            return b' '
        self.read_count += 1
        if self.session.clock and self.read_count == 1:
            self.session.clock.advance(self.session.body_seconds)
        return self.payload if self.read_count == 1 else b''

    def close(self):
        with self.session.closed.get_lock():
            self.session.closed.value += 1


class SafeForkserverStorage(SupabaseNewsStorage):
    """Importable worker fixture with a real, pickleable requests Session.

    Its worker entry never calls HTTP; only the strict subprocess/IPC path is
    exercised. An inherited-session marker proves that the pool was replaced.
    """
    def __init__(self, *, delay=0, pid_writer=None):
        super().__init__('https://example.supabase.test', 'sb_secret_fixture')
        self._session.headers['X-parent-session-marker'] = 'fixture'
        self.delay, self.pid_writer = delay, pid_writer

    def _request_direct(self, method, path, **kwargs):
        if self.pid_writer is not None:
            self.pid_writer.send_bytes(str(os.getpid()).encode())
            self.pid_writer.close()
        if self.delay:
            time.sleep(self.delay)
        return _StorageResponse(200, json.dumps({
            'fresh_session': 'X-parent-session-marker' not in self._session.headers,
            'worker_pid': os.getpid(),
        }).encode())


def orphan_owner(writer):
    try:
        SafeForkserverStorage(delay=60, pid_writer=writer).read('fixture', deadline=time.monotonic() + 1)
    except StorageUnavailable:
        os._exit(2)


class SourceCacheTransportBudgetTests(unittest.TestCase):
    def storage(self, session, **kwargs):
        # Deliberately fictional input; no credential lookup is performed.
        return SupabaseNewsStorage('https://example.supabase.test', 'sb_secret_fixture',
                                   session=session, **kwargs)

    def test_one_absolute_deadline_is_shared_by_successive_reads(self):
        clock = SharedClock()
        session = OfflineSession(clock=clock, header_seconds=7)
        storage = self.storage(session)
        self.assertEqual(storage.read('first.json', deadline=112, clock=clock), {'verified': True})
        self.assertEqual(clock(), 107)
        with self.assertRaisesRegex(StorageUnavailable, '^storage_deadline$'):
            storage.read('second.json', deadline=112, clock=clock)
        self.assertEqual(clock(), 114)
        self.assertEqual(session.calls.value, 2)
        self.assertEqual(tuple(session.timeout), (5, 5))
        self.assertEqual(session.closed.value, 2)

    def test_already_exhausted_budget_starts_no_request(self):
        clock, session = SharedClock(), OfflineSession()
        storage = self.storage(session)
        for operation in [lambda: storage.read('a', deadline=100, clock=clock),
                          lambda: storage._list('polls', deadline=99, clock=clock)]:
            with self.assertRaisesRegex(StorageUnavailable, '^storage_deadline$'):
                operation()
        self.assertEqual(session.calls.value, 0)

    def test_invalid_budget_fails_closed_before_request(self):
        session = OfflineSession()
        storage = self.storage(session)
        for deadline, clock in [(True, SharedClock()), (float('nan'), SharedClock()),
                                (float('inf'), SharedClock()), ('112', SharedClock()),
                                (112, 100), (112, lambda: float('nan')),
                                (112, lambda: True), (1e308, lambda: -1e308),
                                (None, SharedClock())]:
            with self.subTest(deadline=deadline), self.assertRaisesRegex(StorageUnavailable, '^storage_budget$'):
                storage.read('a', deadline=deadline, clock=clock)
        self.assertEqual(session.calls.value, 0)

    def test_invalid_configured_timeout_cannot_remove_budget(self):
        for timeout in [None, (None, 15), (5, 0), (5, float('inf')), (5,), True]:
            session = OfflineSession()
            with self.subTest(timeout=timeout), self.assertRaisesRegex(StorageUnavailable, '^storage_budget$'):
                self.storage(session, timeout=timeout).read('a', deadline=112, clock=SharedClock())
            self.assertEqual(session.calls.value, 0)

    def test_list_supports_bounded_pagination_under_same_deadline(self):
        clock = SharedClock()
        session = OfflineSession(clock=clock, header_seconds=2)
        storage = self.storage(session)
        for offset in [0, 30, 180]:
            self.assertEqual(storage._list('polls', deadline=112, clock=clock, offset=offset),
                             [{'name': 'result.json'}])
            self.assertEqual(session.offset.value, offset)
        self.assertEqual(clock(), 106)
        self.assertEqual(session.calls.value, 3)
        for offset in [-1, 181, True, 30.0, '30']:
            with self.subTest(offset=offset), self.assertRaisesRegex(StorageUnavailable, '^storage_budget$'):
                storage._list('polls', deadline=112, clock=clock, offset=offset)
        self.assertEqual(session.calls.value, 3)

    def test_remaining_budget_caps_both_socket_timeouts(self):
        session, clock = OfflineSession(), SharedClock()
        self.assertEqual(self.storage(session).read('a', deadline=100.75, clock=clock), {'verified': True})
        self.assertEqual(tuple(session.timeout), (0.75, 0.75))

    def test_stream_consumption_cannot_return_after_fake_deadline(self):
        clock = SharedClock()
        session = OfflineSession(clock=clock, header_seconds=3, body_seconds=10)
        with self.assertRaisesRegex(StorageUnavailable, '^storage_deadline$'):
            self.storage(session).read('a', deadline=112, clock=clock)
        self.assertEqual(clock(), 113)
        self.assertEqual(session.closed.value, 1)

    def test_existing_thirty_second_request_ceiling_is_preserved(self):
        clock = SharedClock()
        session = OfflineSession(clock=clock, header_seconds=31)
        with self.assertRaisesRegex(StorageUnavailable, '^storage_deadline$'):
            self.storage(session).read('a', deadline=200, clock=clock)
        self.assertEqual(clock(), 131)
        self.assertEqual(session.closed.value, 1)

    def test_blocked_headers_and_blocked_body_are_killed_at_real_deadline(self):
        for blocked in ['headers', 'body']:
            session = OfflineSession(blocked=blocked)
            started = time.monotonic()
            with self.subTest(blocked=blocked), self.assertRaisesRegex(StorageUnavailable, '^storage_deadline$'):
                self.storage(session).read('a', deadline=started + 0.15)
            self.assertLess(time.monotonic() - started, 0.75)
            self.assertTrue(session.started.is_set())
            self.assertEqual(session.body_started.is_set(), blocked == 'body')
            self.assertEqual(session.calls.value, 1)

    def test_progressing_trickle_body_still_has_a_total_deadline(self):
        session = OfflineSession(trickle=True)
        started = time.monotonic()
        with self.assertRaisesRegex(StorageUnavailable, '^storage_deadline$'):
            self.storage(session)._list('polls', deadline=started + 0.18)
        self.assertLess(time.monotonic() - started, 0.75)
        self.assertTrue(session.body_started.is_set())

    def test_network_error_remains_fixed_and_private_detail_free(self):
        session = OfflineSession(error='private response and credential fixture')
        with self.assertRaisesRegex(StorageUnavailable, '^storage_network$'):
            self.storage(session).read('a', deadline=112, clock=SharedClock())

    def test_missing_object_remains_none_with_a_budget(self):
        session = OfflineSession(status=404)
        self.assertIsNone(self.storage(session).read('missing', deadline=112, clock=SharedClock()))

    def test_unbudgeted_path_keeps_original_session_and_timeouts(self):
        session = Mock()
        response = Mock(status_code=200, headers={})
        response.raw.read1.side_effect = [b'{"verified":true}', b'']
        session.request.return_value = response
        self.assertEqual(self.storage(session).read('a'), {'verified': True})
        session.request.assert_called_once()
        self.assertEqual(session.request.call_args.kwargs['timeout'], (5, 15))
        response.close.assert_called_once()

    def test_budgeted_path_accepts_an_injected_mock_session(self):
        session = Mock()
        response = Mock(status_code=200, headers={})
        response.raw.read1.side_effect = [b'{"verified":true}', b'']
        session.request.return_value = response
        self.assertEqual(self.storage(session).read('a', deadline=112, clock=SharedClock()),
                         {'verified': True})

    def test_budgeted_real_session_uses_a_fresh_transport_after_fork(self):
        import requests
        original = requests.sessions.Session()
        original.request = Mock(side_effect=AssertionError('inherited pool must not be used'))
        replacement = OfflineSession()
        offline_context = multiprocessing.get_context('fork')
        with patch('daily_news_runtime.requests.Session', return_value=replacement), \
                patch('daily_news_runtime.multiprocessing.get_context', return_value=offline_context) as context:
            self.assertEqual(self.storage(original).read('a', deadline=112, clock=SharedClock()),
                             {'verified': True})
        context.assert_called_once_with('forkserver')
        self.assertEqual(replacement.calls.value, 1)
        original.close()

    def test_actual_forkserver_round_trip_with_real_pickleable_session_and_no_http(self):
        storage = SafeForkserverStorage()
        pickle.dumps(storage)
        started = time.monotonic()
        result = storage.read('fixture', deadline=started + 3)
        self.assertTrue(result['fresh_session'])
        self.assertNotEqual(result['worker_pid'], os.getpid())
        self.assertLess(time.monotonic() - started, 3)

    def test_actual_forkserver_from_daemon_thread_returns_safe_fixture(self):
        results = {}
        def read():
            try:
                results['value'] = SafeForkserverStorage().read('fixture', deadline=time.monotonic() + 3)
            except StorageUnavailable as exc:
                results['error'] = str(exc)
        thread = Thread(target=read, daemon=True)
        thread.start()
        thread.join(3.25)
        self.assertFalse(thread.is_alive())
        self.assertNotIn('error', results)
        self.assertTrue(results['value']['fresh_session'])
        self.assertNotEqual(results['value']['worker_pid'], os.getpid())

    def test_forkserver_startup_itself_is_in_the_shared_deadline(self):
        context = multiprocessing.get_context('fork')
        finished = Event()
        class SlowStartup:
            def __init__(self, **kwargs):
                pass
            def start(self):
                time.sleep(0.1)
            def kill(self):
                finished.set()
            def join(self, timeout=None):
                pass
            def is_alive(self):
                return True
        started = time.monotonic()
        with patch('daily_news_runtime.multiprocessing.get_context', return_value=context), \
                patch.object(context, 'Process', SlowStartup), \
                self.assertRaisesRegex(StorageUnavailable, '^storage_deadline$'):
            SafeForkserverStorage().read('fixture', deadline=started + 0.02)
        self.assertLess(time.monotonic() - started, 0.075)
        self.assertTrue(finished.wait(0.25))

    def test_daemonized_owner_rejects_child_start_without_unbounded_fallback(self):
        session = OfflineSession()
        with patch('daily_news_runtime.multiprocessing.current_process', return_value=SimpleNamespace(daemon=True)), \
                self.assertRaisesRegex(StorageUnavailable, '^storage_budget$'):
            self.storage(session).read('fixture', deadline=112, clock=SharedClock())
        self.assertEqual(session.calls.value, 0)

    def test_worker_hard_timer_survives_owner_sigkill(self):
        context = multiprocessing.get_context('spawn')
        reader, writer = context.Pipe(duplex=False)
        owner = context.Process(target=orphan_owner, args=(writer,))
        owner.start()
        writer.close()
        try:
            self.assertTrue(reader.poll(2))
            worker_pid = int(reader.recv_bytes())
            owner.kill()
            owner.join(0.25)

            deadline = time.monotonic() + 1.4
            running = True
            while running and time.monotonic() < deadline:
                status = subprocess.run(['ps', '-p', str(worker_pid), '-o', 'stat='],
                                        capture_output=True, text=True, timeout=0.25).stdout.strip()
                running = bool(status) and not status.startswith('Z')
                if running:
                    time.sleep(0.01)
            self.assertFalse(running, 'worker must close sockets independently of its killed owner')
        finally:
            reader.close()
            if owner.is_alive():
                owner.kill()
            owner.join(0.25)

    def test_serving_process_start_failure_is_fixed_and_has_no_http_fallback(self):
        context = multiprocessing.get_context('fork')
        worker = Mock()
        worker.start.side_effect = RuntimeError('private infrastructure detail fixture')
        with patch('daily_news_runtime.multiprocessing.get_context', return_value=context), \
                patch.object(context, 'Process', return_value=worker), \
                self.assertRaisesRegex(StorageUnavailable, '^storage_budget$'):
            SafeForkserverStorage().read('fixture', deadline=time.monotonic() + 1)
        worker.start.assert_called_once()

    def test_concurrent_blocked_reader_does_not_hold_finished_response_open(self):
        fast, slow = OfflineSession(blocked='headers'), OfflineSession(blocked='headers')
        fast_done, results = Event(), {}
        def read_fast():
            try:
                results['value'] = self.storage(fast).read('a', deadline=time.monotonic() + 0.7)
            except Exception as exc:
                results['error'] = str(exc)
            finally:
                fast_done.set()
        def read_slow():
            try:
                self.storage(slow).read('b', deadline=time.monotonic() + 0.7)
            except StorageUnavailable:
                pass
        first, second = Thread(target=read_fast), Thread(target=read_slow)
        first.start()
        self.assertTrue(fast.started.wait(0.4))
        second.start()
        self.assertTrue(slow.started.wait(0.4))
        fast.never.set()
        self.assertTrue(fast_done.wait(0.25))
        first.join(1)
        second.join(1)
        self.assertEqual(results, {'value': {'verified': True}})
        self.assertFalse(first.is_alive() or second.is_alive())

    def test_unavailable_process_boundary_has_no_silent_unbounded_fallback(self):
        session = OfflineSession()
        with patch('daily_news_runtime.multiprocessing.get_context', side_effect=ValueError), \
                self.assertRaisesRegex(StorageUnavailable, '^storage_budget$'):
            self.storage(session).read('a', deadline=112, clock=SharedClock())
        self.assertEqual(session.calls.value, 0)


if __name__ == '__main__':
    unittest.main()

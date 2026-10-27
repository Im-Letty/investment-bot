"""No application startup, credentials, paid calls or upstream connections."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import runpy
from threading import Event, Lock
import unittest

from request_scheduling import MAX_NONCRITICAL_REQUESTS, PublicReadScheduling


def environ(path, method="GET"):
    return {"REQUEST_METHOD": method, "PATH_INFO": path}


def consume(app, path, method="GET"):
    return b"".join(app(environ(path, method), lambda *args: None))


class SchedulingTests(unittest.TestCase):
    def test_six_waiting_quotes_do_not_hold_the_page_or_static_assets(self):
        release, all_entered, counter_lock = Event(), Event(), Lock()
        count = 0
        def application(env, start_response):
            nonlocal count
            if env["PATH_INFO"] == "/api/quote":
                with counter_lock:
                    count += 1
                    if count == 6:
                        all_entered.set()
                if not release.wait(3):
                    raise AssertionError("quote fixture not released")
            return [b"unchanged-response"]
        app = PublicReadScheduling(application)
        with ThreadPoolExecutor(max_workers=8) as pool:
            quotes = [pool.submit(consume, app, "/api/quote") for _ in range(6)]
            try:
                self.assertTrue(all_entered.wait(2))
                self.assertEqual(pool.submit(consume, app, "/").result(timeout=.5), b"unchanged-response")
                self.assertEqual(pool.submit(consume, app, "/static/startup-css-example.css").result(timeout=.5), b"unchanged-response")
            finally:
                release.set()
            self.assertEqual([f.result() for f in quotes], [b"unchanged-response"] * 6)

    def test_existing_quota_and_mutable_handlers_cannot_overlap(self):
        first_entered, release_first, second_entered = Event(), Event(), Event()
        active, maximum, calls = 0, 0, 0
        lock = Lock()
        def application(env, start_response):
            nonlocal active, maximum, calls
            with lock:
                calls += 1
                number = calls
                active += 1
                maximum = max(maximum, active)
            if number == 1:
                first_entered.set()
                if not release_first.wait(3):
                    raise AssertionError("serial fixture not released")
            else:
                second_entered.set()
            with lock:
                active -= 1
            return [b"quota-fixture-only"]
        app = PublicReadScheduling(application)
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(consume, app, "/api/chat", "POST")
            self.assertTrue(first_entered.wait(1))
            second = pool.submit(consume, app, "/api/chat-suggestions")
            try:
                self.assertFalse(second_entered.wait(.1))
            finally:
                release_first.set()
            first.result(); second.result()
        self.assertEqual(maximum, 1)

    def test_health_and_other_data_reads_retain_serial_execution(self):
        app = PublicReadScheduling(lambda env, start_response: [b"same"])
        first = app(environ("/health"), lambda *args: None)
        with ThreadPoolExecutor(max_workers=1) as pool:
            other = pool.submit(consume, app, "/api/lookup")
            self.assertFalse(other.done())
            first.close()
            self.assertEqual(other.result(timeout=1), b"same")

    def test_posts_and_near_match_paths_do_not_bypass_serialization(self):
        for path, method in [("/", "POST"), ("/static/change", "POST"),
                             ("/api/quote", "POST"), ("/api/quote", "HEAD"),
                             ("/api/quote-other", "GET"), ("/static", "GET"),
                             ("/other", "GET"), ("/webhook", "POST")]:
            with self.subTest(path=path, method=method):
                self.assertFalse(PublicReadScheduling.parallel_read(environ(path, method)))

    def test_cached_public_reads_do_not_wait_for_a_slow_health_check(self):
        app = PublicReadScheduling(lambda env, start_response: [b"original-snapshot"])
        health = app(environ("/health"), lambda *args: None)
        paths = ["/api/morning-news", "/api/morning-data", "/api/company-news",
                 "/api/scanner", "/api/company-profile",
                 "/api/dividend/calendar-v2", "/api/lookup_all"]
        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                for path in paths:
                    self.assertEqual(pool.submit(consume, app, path).result(timeout=.5), b"original-snapshot")
                    self.assertFalse(app.parallel_read(environ(path, "POST")))
                    self.assertFalse(app.parallel_read(environ(path + "/unknown")))
        finally:
            health.close()

    def test_head_page_and_static_reads_remain_parallel_without_api_head_bypass(self):
        for path in ["/", "/static/home-a.css"]:
            self.assertTrue(PublicReadScheduling.parallel_read(environ(path, "HEAD")))

    def test_app_exception_releases_the_serial_handler(self):
        failure = RuntimeError("fixture failure")
        app = PublicReadScheduling(lambda env, start_response: (_ for _ in ()).throw(failure))
        with self.assertRaises(RuntimeError) as caught:
            app(environ("/api/test"), lambda *args: None)
        self.assertIs(caught.exception, failure)
        self.assertTrue(app._serial.acquire(blocking=False))
        app._serial.release()

    def test_iterator_creation_error_releases_and_closes_exactly_once(self):
        class Broken:
            closes = 0
            def __iter__(self):
                raise ValueError("iterator fixture")
            def close(self):
                self.closes += 1
        value = Broken()
        app = PublicReadScheduling(lambda env, start_response: value)
        result = app(environ("/api/test"), lambda *args: None)
        with self.assertRaises(ValueError):
            list(result)
        result.close()
        self.assertEqual(value.closes, 1)
        self.assertFalse(app._serial.locked())

    def test_streaming_error_releases_and_propagates_without_swallowing(self):
        def stream():
            yield b"first"
            raise RuntimeError("stream fixture")
        app = PublicReadScheduling(lambda env, start_response: stream())
        result = app(environ("/api/test"), lambda *args: None)
        iterator = iter(result)
        self.assertEqual(next(iterator), b"first")
        with self.assertRaises(RuntimeError):
            next(iterator)
        result.close()
        self.assertFalse(app._serial.locked())

    def test_unused_and_exhausted_responses_close_once(self):
        class Response:
            closes = 0
            def __iter__(self):
                return iter([b"same"])
            def close(self):
                self.closes += 1
        for consume_response in [False, True]:
            with self.subTest(consume=consume_response):
                response = Response()
                app = PublicReadScheduling(lambda env, start_response: response)
                result = app(environ("/api/test"), lambda *args: None)
                if consume_response:
                    self.assertEqual(b"".join(result), b"same")
                result.close(); result.close()
                self.assertEqual(response.closes, 1)
                self.assertFalse(app._serial.locked())

    def test_response_close_error_still_releases_the_serial_handler(self):
        class Response:
            def close(self):
                raise ValueError("close fixture")
        app = PublicReadScheduling(lambda env, start_response: Response())
        response = app(environ("/api/test"), lambda *args: None)
        with self.assertRaises(ValueError):
            response.close()
        response.close()
        self.assertFalse(app._serial.locked())


    def assert_admission_reusable(self, app):
        """All six slots remain available after a response failure or close."""
        previous = app.application
        app.application = lambda env, start: [b"healthy"]
        held, statuses = [], []
        try:
            for _ in range(6):
                held.append(app(environ("/api/quote"),
                                lambda status, headers: statuses.append(status)))
            self.assertEqual(statuses, [])
            overflow = app(environ("/api/quote"),
                           lambda status, headers: statuses.append(status))
            self.assertEqual(statuses, ["503 Service Unavailable"])
            self.assertEqual(b"".join(overflow),
                             b'{"error":"server_busy","retry_after":1}')
        finally:
            for response in held:
                response.close()
            app.application = previous

    def test_six_admitted_quotes_leave_two_real_worker_slots_for_page_and_static(self):
        release, all_entered, guard = Event(), Event(), Lock()
        count = 0
        def application(env, start_response):
            nonlocal count
            if env["PATH_INFO"] == "/api/quote":
                with guard:
                    count += 1
                    if count == 6:
                        all_entered.set()
                if not release.wait(3):
                    raise AssertionError("quote fixture not released")
            return [b"same-response"]
        app = PublicReadScheduling(application)
        with ThreadPoolExecutor(max_workers=8) as pool:
            quotes = [pool.submit(consume, app, "/api/quote") for _ in range(6)]
            try:
                self.assertTrue(all_entered.wait(1))
                page = pool.submit(consume, app, "/")
                static = pool.submit(consume, app, "/static/news-orbit.js")
                self.assertEqual(page.result(timeout=.5), b"same-response")
                self.assertEqual(static.result(timeout=.5), b"same-response")
                self.assertFalse(release.is_set())
            finally:
                release.set()
            self.assertEqual([x.result(timeout=1) for x in quotes],
                             [b"same-response"] * 6)
        self.assert_admission_reusable(app)

    def test_six_serial_holder_and_waiters_leave_entry_worker_slots(self):
        release, holder_entered, six_started = Event(), Event(), Event()
        guard = Lock()
        count = 0
        def application(env, start_response):
            if env["PATH_INFO"] == "/api/slow-fixture":
                holder_entered.set()
                if not release.wait(3):
                    raise AssertionError("serial fixture not released")
            return [b"same-response"]
        app = PublicReadScheduling(application)
        def serial_request(path):
            nonlocal count
            with guard:
                count += 1
                if count == 6:
                    six_started.set()
            return consume(app, path)
        with ThreadPoolExecutor(max_workers=8) as pool:
            holder = pool.submit(serial_request, "/api/slow-fixture")
            self.assertTrue(holder_entered.wait(1))
            waiters = [pool.submit(serial_request, "/health") for _ in range(5)]
            try:
                self.assertTrue(six_started.wait(1))
                page = pool.submit(consume, app, "/")
                static = pool.submit(consume, app, "/static/home-a.css", "HEAD")
                self.assertEqual(page.result(timeout=.5), b"same-response")
                self.assertEqual(static.result(timeout=.5), b"same-response")
                self.assertFalse(release.is_set())
            finally:
                release.set()
            self.assertEqual(holder.result(timeout=1), b"same-response")
            self.assertEqual([x.result(timeout=1) for x in waiters],
                             [b"same-response"] * 5)
        self.assert_admission_reusable(app)

    def test_overflow_is_safe_busy_before_every_noncritical_handler(self):
        calls = []
        def application(env, start):
            calls.append((env["REQUEST_METHOD"], env["PATH_INFO"]))
            return [b"handler-response"]
        app = PublicReadScheduling(application)
        held = [app(environ("/api/quote"), lambda *args: None) for _ in range(6)]
        try:
            before = len(calls)
            for method, path in [
                ("GET", "/api/quote"), ("GET", "/api/morning-news"),
                ("GET", "/health"), ("POST", "/auth/fixture"),
                ("HEAD", "/api/quote"), ("POST", "/"),
                ("POST", "/static/fixture"), ("GET", "/static"),
            ]:
                with self.subTest(method=method, path=path):
                    captured = []
                    response = app(environ(path, method),
                                   lambda status, headers: captured.append((status, dict(headers))))
                    self.assertEqual(captured[0][0], "503 Service Unavailable")
                    self.assertEqual(captured[0][1]["Cache-Control"], "no-store")
                    self.assertEqual(captured[0][1]["Retry-After"], "1")
                    self.assertEqual(captured[0][1]["Content-Type"], "application/json")
                    body = b"".join(response)
                    expected = b'{"error":"server_busy","retry_after":1}'
                    self.assertEqual(int(captured[0][1]["Content-Length"]), len(expected))
                    self.assertEqual(body, b"" if method == "HEAD" else expected)
                    self.assertEqual(len(calls), before, "Busy requests must not enter a handler")
            for method, path in [("GET", "/"), ("HEAD", "/"),
                                 ("GET", "/static/site.css"), ("HEAD", "/static/site.css")]:
                self.assertEqual(consume(app, path, method), b"handler-response")
            self.assertEqual(len(calls), before + 4)
        finally:
            for response in held:
                response.close()
        self.assert_admission_reusable(app)

    def test_admission_lasts_until_unused_or_streamed_response_closes(self):
        class Response:
            closes = 0
            def __iter__(self):
                yield b"first"
                yield b"second"
            def close(self):
                self.closes += 1
        originals = []
        def application(env, start):
            response = Response()
            originals.append(response)
            return response
        app = PublicReadScheduling(application)
        held = [app(environ("/api/quote"), lambda *args: None) for _ in range(6)]
        try:
            iterator = iter(held[0])
            self.assertEqual(next(iterator), b"first")
            statuses = []
            busy = app(environ("/api/quote"), lambda status, headers: statuses.append(status))
            self.assertEqual(statuses, ["503 Service Unavailable"])
            self.assertEqual(b"".join(busy), b'{"error":"server_busy","retry_after":1}')
            iterator.close()
            self.assertEqual(originals[0].closes, 1)
            held[0].close()
            next_response = app(environ("/api/quote"), lambda *args: self.fail("slot not released"))
            self.assertEqual(b"".join(next_response), b"firstsecond")
            next_response.close()
            self.assertEqual(originals[-1].closes, 1)
        finally:
            for response in held:
                response.close()
        self.assertTrue(all(response.closes == 1 for response in originals))
        self.assert_admission_reusable(app)

    def test_base_exceptions_release_both_permit_and_serial_resource(self):
        class Abort(BaseException):
            pass
        for path in ["/api/quote", "/api/serial-fixture"]:
            for phase in ["application", "iterator", "stream", "close"]:
                with self.subTest(path=path, phase=phase):
                    closes = []
                    class Response:
                        def __iter__(self):
                            if phase == "iterator":
                                raise Abort("iterator fixture")
                            def stream():
                                yield b"first"
                                if phase == "stream":
                                    raise Abort("stream fixture")
                            return stream()
                        def close(self):
                            closes.append(1)
                            if phase == "close":
                                raise Abort("close fixture")
                    def application(env, start):
                        if phase == "application":
                            raise Abort("application fixture")
                        return Response()
                    app = PublicReadScheduling(application)
                    if phase == "application":
                        with self.assertRaises(Abort):
                            app(environ(path), lambda *args: None)
                    else:
                        response = app(environ(path), lambda *args: None)
                        with self.assertRaises(Abort):
                            if phase == "close":
                                response.close()
                            else:
                                b"".join(response)
                        response.close(); response.close()
                        self.assertEqual(closes, [1])
                    self.assertFalse(app._serial.locked())
                    self.assert_admission_reusable(app)

    def test_concurrent_response_close_releases_once(self):
        close_entered, release_close = Event(), Event()
        closes = []
        class Response:
            def close(self):
                closes.append(1)
                close_entered.set()
                if not release_close.wait(2):
                    raise AssertionError("close fixture not released")
        app = PublicReadScheduling(lambda env, start: Response())
        response = app(environ("/api/serial-fixture"), lambda *args: None)
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(response.close)
            try:
                self.assertTrue(close_entered.wait(1))
                pool.submit(response.close).result(timeout=.5)
                self.assertEqual(closes, [1])
            finally:
                release_close.set()
            first.result(timeout=1)
        response.close()
        self.assertFalse(app._serial.locked())
        self.assert_admission_reusable(app)


    def test_critical_runtime_marker_preserves_wsgi_start_response_contract(self):
        for path, method in [("/", "GET"), ("/", "HEAD"),
                             ("/static/site.css", "GET"), ("/static/site.css", "HEAD")]:
            for exc_mode in ["omitted", "explicit_none", "exception_tuple"]:
                with self.subTest(path=path, method=method, exc_mode=exc_mode):
                    received, writes = [], []
                    headers = [
                        ("Content-Type", "text/plain"),
                        ("Set-Cookie", "fixture=a"),
                        ("x-kn-request-scheduling", "old"),
                        ("Set-Cookie", "fixture=b"),
                        ("X-KN-Request-Scheduling", "duplicate"),
                        ("Cache-Control", "private"),
                    ]
                    original = list(headers)
                    info = (ValueError, ValueError("response fixture"), None)
                    def write(data):
                        writes.append(data)
                    def start_response(*args):
                        received.append(args)
                        return write
                    def application(env, start):
                        if exc_mode == "omitted":
                            callback = start("200 OK", headers)
                        elif exc_mode == "explicit_none":
                            callback = start("200 OK", headers, None)
                        else:
                            callback = start("200 OK", headers, info)
                        self.assertIs(callback, write)
                        callback(b"prefix")
                        return [b"body"]
                    result = PublicReadScheduling(application)(environ(path, method), start_response)
                    self.assertEqual(b"".join(result), b"body")
                    self.assertEqual(writes, [b"prefix"])
                    self.assertEqual(headers, original, "Do not mutate an application's header list")
                    args = received[0]
                    self.assertEqual(args[0], "200 OK")
                    self.assertEqual(len(args), 2 if exc_mode == "omitted" else 3)
                    if exc_mode != "omitted":
                        self.assertIs(args[2], None if exc_mode == "explicit_none" else info)
                    marker = [(k, v) for k, v in args[1]
                              if k.lower() == "x-kn-request-scheduling"]
                    self.assertEqual(marker, [("X-KN-Request-Scheduling", "bounded-v1")])
                    self.assertEqual([(k, v) for k, v in args[1]
                                      if k.lower() != "x-kn-request-scheduling"],
                                     [(k, v) for k, v in original
                                      if k.lower() != "x-kn-request-scheduling"])

    def test_noncritical_headers_are_not_stamped_or_rewritten(self):
        for path in ["/api/quote", "/health"]:
            with self.subTest(path=path):
                headers = [("Content-Type", "application/json"),
                           ("X-KN-Request-Scheduling", "application-owned")]
                received = []
                def application(env, start):
                    start("202 Accepted", headers)
                    return [b"same"]
                app = PublicReadScheduling(application)
                response = app(environ(path), lambda *args: received.append(args))
                self.assertEqual(b"".join(response), b"same")
                response.close()
                self.assertEqual(received, [("202 Accepted", headers)])

    def test_server_keeps_one_collector_process_and_bounded_threads(self):
        values = runpy.run_path(str(Path(__file__).parents[1] / "gunicorn.conf.py"))
        self.assertEqual(values["workers"], 1)
        self.assertEqual(values["worker_class"], "gthread")
        self.assertEqual(values["threads"], 8)
        self.assertEqual(values["threads"] - MAX_NONCRITICAL_REQUESTS, 2)
        self.assertNotIn("preload_app", values)
        self.assertNotIn("timeout", values)


if __name__ == "__main__":
    unittest.main()

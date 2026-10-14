"""No application startup, credentials, paid calls or upstream connections."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import runpy
from threading import Event, Lock
import unittest

from request_scheduling import PublicReadScheduling


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

    def test_server_keeps_one_collector_process_and_bounded_threads(self):
        values = runpy.run_path(str(Path(__file__).parents[1] / "gunicorn.conf.py"))
        self.assertEqual(values["workers"], 1)
        self.assertEqual(values["worker_class"], "gthread")
        self.assertEqual(values["threads"], 8)
        self.assertNotIn("preload_app", values)
        self.assertNotIn("timeout", values)


if __name__ == "__main__":
    unittest.main()

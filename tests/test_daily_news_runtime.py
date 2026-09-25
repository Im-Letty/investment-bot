from copy import deepcopy
from datetime import datetime
import json
import io
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Barrier, Event, Lock, Thread
import time
import unittest
from unittest.mock import Mock, patch

from daily_news_runtime import (DailyNewsRuntime, StorageUnavailable, SupabaseNewsStorage,
                                ATTEMPT_INTERVAL, MAX_ATTEMPTS, start)
from news_cache import JST, load_reviewed_digests, select_daily_news


def at(day="2026-09-24", hour=7, minute=45, second=0):
    return datetime.fromisoformat(day).replace(hour=hour, minute=minute,
                                             second=second, tzinfo=JST).timestamp()


def issue(day="2026-09-24", *, reviewed=None):
    refs = [{"source": source, "title": title, "url": f"https://example.test/{day}/{index}",
             "published_at": at(day, 6, index)}
            for index, (source, title) in enumerate((("NHK経済", "国内の企業の動き"),
                                                     ("ロイター経済", "為替市場の動き")))]
    return {"edition_date": day, "lang": "ja", "publication_mode": "curated",
            "reviewed_at": reviewed or at(day, 7, 30), "publish_at": at(day, 8, 0),
            "headline": "暮らしと経済のニュース", "summary": "文" * 240,
            "article_refs": refs,
            "article_summaries": [{**ref, "headline": "一つのニュース", "summary": "詳" * 240} for ref in refs]}


class MemoryStorage:
    def __init__(self, values=None):
        self.values = deepcopy(values or {})
        self.guard = Lock()
        self.created = []
        self.before_create = None
        self.private_checks = 0

    def ensure_private(self):
        self.private_checks += 1

    def read(self, path):
        with self.guard:
            return deepcopy(self.values.get(path))

    def create(self, path, value):
        if self.before_create:
            self.before_create(path, value)
        with self.guard:
            if path in self.values:
                return False
            self.values[path] = deepcopy(value)
            self.created.append(path)
            return True

    def recent_days(self):
        return sorted({path.split("/")[1] for path in self.values}, reverse=True)

    def reviewed_keys(self, day):
        return [path for path in self.values if path.startswith(f"days/{day}/reviewed-")]


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.folder = TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.baseline = Path(self.folder.name) / "baseline.json"
        self.cache = Path(self.folder.name) / "cache.json"
        self.baseline.write_text("[]", encoding="utf-8")
        self.now = at()
        self.storage = MemoryStorage()
        self.generator = Mock(side_effect=lambda now: issue(datetime.fromtimestamp(now, JST).date().isoformat()))

    def runtime(self, **options):
        return DailyNewsRuntime(options.pop("storage", self.storage), options.pop("generator", self.generator),
                                baseline_path=options.pop("baseline_path", self.baseline),
                                cache_path=options.pop("cache_path", self.cache), clock=lambda: self.now,
                                enabled=options.pop("enabled", True), **options)

    def write(self, path, values):
        path.write_text(json.dumps(values, ensure_ascii=False), encoding="utf-8")

    def test_preparation_persists_before_cache_then_gate_opens_at_eight(self):
        previous = issue("2026-09-23")
        self.write(self.baseline, [previous])
        candidate = issue()
        del candidate["publish_at"]
        self.generator.side_effect = lambda now: candidate
        observations = []
        self.storage.before_create = lambda path, value: observations.append((path, self.cache.exists()))
        runtime = self.runtime()
        state = runtime.run_once()
        self.assertEqual(state["status"], "prepared")
        self.assertEqual(state["edition_date"], "2026-09-24")
        self.assertEqual(state["publish_at"], at(hour=8, minute=0))
        self.assertIn(("days/2026-09-24/edition.json", False), observations)
        self.assertEqual(load_reviewed_digests(self.cache), [previous, issue()])
        before = select_daily_news({"news": []}, at(hour=7, minute=59, second=59),
                                   reviewed_digests=runtime.reviewed_digests())
        self.assertEqual(before["edition_date"], "2026-09-23")
        self.now = at(hour=8, minute=0)
        self.assertEqual(runtime.run_once()["status"], "ready")
        after = select_daily_news({"news": []}, self.now, reviewed_digests=runtime.reviewed_digests())
        self.assertEqual(after["edition_date"], "2026-09-24")
        self.generator.assert_called_once()

    def test_generation_window_includes_0700_and_excludes_2200(self):
        for hour, minute, allowed in ((0, 0, False), (6, 59, False), (7, 0, True), (7, 44, True),
                                       (21, 59, True), (22, 0, False), (23, 59, False)):
            with self.subTest(hour=hour, minute=minute):
                self.now = at(hour=hour, minute=minute)
                generator = Mock(return_value=issue())
                self.runtime(storage=MemoryStorage(), generator=generator).run_once()
                self.assertEqual(generator.call_count, int(allowed))

    def test_attempts_are_durable_spaced_and_capped(self):
        self.generator.side_effect = ValueError("provider secret must never be returned")
        runtime = self.runtime()
        self.assertEqual(runtime.run_once()["status"], "generation_failed")
        self.now += ATTEMPT_INTERVAL - 1
        runtime.run_once()
        self.assertEqual(self.generator.call_count, 1)
        # A fresh worker must obey the same persisted attempt budget.
        runtime = self.runtime()
        self.now += 1
        runtime.run_once()
        self.assertEqual(self.generator.call_count, 2)
        self.now += ATTEMPT_INTERVAL
        runtime.run_once()
        self.now += ATTEMPT_INTERVAL
        for _ in range(MAX_ATTEMPTS - 3):
            runtime.run_once()
            self.now += ATTEMPT_INTERVAL
        state = self.runtime().run_once()
        self.assertEqual(state["status"], "daily_limit")
        self.assertEqual(state["attempt_count"], MAX_ATTEMPTS)
        self.assertEqual(self.generator.call_count, MAX_ATTEMPTS)
        self.assertEqual(len([key for key in self.storage.values if key.endswith(".lock")]), MAX_ATTEMPTS)
        self.assertFalse(self.cache.exists())

    def test_next_japan_day_gets_a_separate_attempt_budget(self):
        self.generator.side_effect = ValueError("no_eligible_topics")
        runtime = self.runtime()
        for _ in range(3):
            runtime.run_once()
            self.now += ATTEMPT_INTERVAL
        self.now = at("2026-09-25")
        state = runtime.run_once()
        self.assertEqual(state["attempt_count"], 1)
        self.assertEqual(self.generator.call_count, 4)
        self.assertIn("days/2026-09-25/attempt-1.lock", self.storage.values)

    def test_disabled_generation_still_restores_durable_editions(self):
        self.storage.values["days/2026-09-23/edition.json"] = issue("2026-09-23")
        runtime = self.runtime(enabled=False)
        state = runtime.run_once()
        self.assertEqual(state["status"], "disabled")
        self.assertEqual(state["edition_date"], "2026-09-23")
        self.assertEqual(runtime.reviewed_digests(), [issue("2026-09-23")])
        self.generator.assert_not_called()
        self.assertEqual(self.storage.created, [])

    def test_restart_after_success_restores_cache_without_regeneration(self):
        runtime = self.runtime()
        runtime.run_once()
        self.cache.unlink()
        new_runtime = self.runtime()
        self.assertEqual(new_runtime.run_once()["status"], "prepared")
        self.assertEqual(load_reviewed_digests(self.cache), [issue()])
        self.generator.assert_called_once()

    def test_storage_failure_never_publishes_generated_issue_or_changes_old_cache(self):
        previous = issue("2026-09-23")
        self.write(self.cache, [previous])
        before = self.cache.read_bytes()
        def fail(path, value):
            if path.endswith("/edition.json"):
                raise StorageUnavailable("storage_write")
        self.storage.before_create = fail
        runtime = self.runtime()
        self.assertEqual(runtime.run_once()["status"], "storage_unavailable")
        self.assertEqual(self.cache.read_bytes(), before)
        self.assertEqual(runtime.reviewed_digests(), [previous])
        runtime.run_once()
        self.generator.assert_called_once()

    def test_ambiguous_storage_success_is_reconciled_without_another_paid_call(self):
        def commit_then_disconnect(path, value):
            if path.endswith("/edition.json"):
                self.storage.values[path] = deepcopy(value)
                raise StorageUnavailable("storage_network")
        self.storage.before_create = commit_then_disconnect
        runtime = self.runtime()
        self.assertEqual(runtime.run_once()["status"], "storage_unavailable")
        self.assertFalse(self.cache.exists())
        self.storage.before_create = None
        self.assertEqual(runtime.run_once()["status"], "prepared")
        self.generator.assert_called_once()
        self.assertEqual(load_reviewed_digests(self.cache), [issue()])

    def test_cache_write_failure_retries_saved_edition_without_regeneration(self):
        self.write(self.cache, [issue("2026-09-23")])
        before = self.cache.read_bytes()
        runtime = self.runtime()
        with patch("daily_news_runtime._replace_atomically", side_effect=OSError("private path")):
            self.assertEqual(runtime.run_once()["status"], "cache_unavailable")
        self.assertEqual(self.cache.read_bytes(), before)
        self.assertIn("days/2026-09-24/edition.json", self.storage.values)
        self.assertEqual(runtime.run_once()["status"], "prepared")
        self.generator.assert_called_once()

    def test_invalid_old_and_future_reviewed_issues_do_not_publish(self):
        for value in (None, {}, issue("2026-09-23"), {**issue(), "summary": "短い"},
                      {**issue(), "reviewed_at": self.now + 1}):
            with self.subTest(value=value):
                runtime = self.runtime(storage=MemoryStorage(), generator=lambda now: value)
                self.assertEqual(runtime.run_once()["status"], "invalid_edition")
                self.assertFalse(self.cache.exists())

    def test_atomic_claim_prevents_two_workers_generating_same_attempt(self):
        barrier = Barrier(2)
        self.storage.before_create = lambda path, value: barrier.wait(3) if path.endswith("attempt-1.lock") else None
        runtimes = [self.runtime(cache_path=Path(self.folder.name) / f"cache-{index}.json") for index in range(2)]
        threads = [Thread(target=runtime.run_once) for runtime in runtimes]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(5)
        self.assertFalse(any(thread.is_alive() for thread in threads))
        self.generator.assert_called_once()
        self.assertEqual(len([key for key in self.storage.values if key.endswith(".lock")]), 1)

    def test_kick_returns_immediately_and_deduplicates_background_work(self):
        entered, release, finished = Event(), Event(), Event()
        def blocked(now):
            entered.set()
            release.wait(3)
            finished.set()
            return issue()
        self.generator.side_effect = blocked
        runtime = self.runtime()
        started = time.monotonic()
        runtime.kick()
        self.assertLess(time.monotonic() - started, .5)
        self.assertTrue(entered.wait(2))
        runtime.kick()
        runtime.run_once()
        self.assertEqual(runtime.snapshot()["status"], "generating")
        self.assertEqual(self.generator.call_count, 1)
        release.set()
        self.assertTrue(finished.wait(2))
        # Wait until the daemon has finished its small atomic cache write.
        deadline = time.monotonic() + 2
        while runtime.snapshot()["status"] == "generating" and time.monotonic() < deadline:
            time.sleep(.005)
        runtime.stop()
        self.assertEqual(runtime.snapshot()["status"], "prepared")

    def test_human_baseline_today_persists_without_paid_generation(self):
        self.write(self.baseline, [issue()])
        runtime = self.runtime()
        self.assertEqual(runtime.run_once()["status"], "prepared")
        self.assertEqual(self.storage.read("days/2026-09-24/edition.json"), issue())
        self.generator.assert_not_called()
        self.assertFalse(any(key.endswith(".lock") for key in self.storage.values))

    def test_newer_human_correction_wins_old_runtime_and_restores_after_restart(self):
        old = issue()
        corrected = {**issue(reviewed=at(hour=7, minute=40)), "headline": "人が確認した新しい訂正版"}
        self.write(self.baseline, [corrected])
        self.write(self.cache, [old])
        self.storage.values["days/2026-09-24/edition.json"] = old
        runtime = self.runtime()
        state = runtime.run_once()
        self.assertEqual(runtime.reviewed_digests(), [corrected])
        self.assertEqual(state["status"], "prepared")
        self.assertEqual(self.storage.read("days/2026-09-24/edition.json"), old)
        self.assertEqual(len(self.storage.reviewed_keys("2026-09-24")), 1)
        self.cache.unlink()
        self.write(self.baseline, [])
        restarted = self.runtime()
        restarted.run_once()
        self.assertEqual(restarted.reviewed_digests(), [corrected])
        self.generator.assert_not_called()

    def test_existing_newer_durable_review_wins_older_baseline(self):
        corrected = {**issue(reviewed=at(hour=7, minute=40)), "headline": "新しい記事"}
        self.write(self.baseline, [issue()])
        self.storage.values["days/2026-09-24/edition.json"] = corrected
        runtime = self.runtime()
        runtime.run_once()
        self.assertEqual(runtime.reviewed_digests(), [corrected])
        self.generator.assert_not_called()

    def test_safe_error_code_is_retained_through_retry_wait_and_restart(self):
        self.generator.side_effect = ValueError("gemini_http_429")
        runtime = self.runtime()
        self.assertEqual(runtime.run_once()["last_error"], "gemini_http_429")
        self.assertEqual(self.runtime().run_once()["last_error"], "gemini_http_429")
        self.generator.side_effect = ValueError("sk-secret https://private.invalid response body")
        self.now += ATTEMPT_INTERVAL
        state = runtime.run_once()
        self.assertEqual(state["last_error"], "generation_failed")
        self.assertNotIn("sk-secret", json.dumps(state))
        self.assertNotIn("private.invalid", json.dumps(self.storage.values))

    def test_missing_storage_never_calls_generator_and_keeps_baseline(self):
        self.write(self.baseline, [issue("2026-09-23")])
        runtime = self.runtime(storage=None)
        for _ in range(3):
            self.assertEqual(runtime.run_once()["status"], "storage_unavailable")
        self.assertEqual(runtime.reviewed_digests(), [issue("2026-09-23")])
        self.generator.assert_not_called()

    def test_corrupt_claim_fails_closed_without_new_attempt(self):
        self.storage.values["days/2026-09-24/attempt-1.lock"] = {"edition_date": "2026-09-24", "attempt": 1,
                                                                "started_at": float("nan")}
        self.assertEqual(self.runtime().run_once()["status"], "storage_unavailable")
        self.generator.assert_not_called()
        self.assertEqual(self.storage.created, [])

    def test_pid_change_resets_inherited_held_locks_and_dead_thread_before_start(self):
        runtime = self.runtime()
        old_state, old_work, old_stop = runtime._state_lock, runtime._work_lock, runtime._stop
        old_state.acquire()
        old_work.acquire()
        old_stop.set()
        runtime._thread = Mock()
        runtime._private = runtime._restored = True
        self.storage.after_fork = Mock()
        started = Event()
        fake_thread = Mock()
        fake_thread.is_alive.return_value = True
        fake_thread.start.side_effect = started.set
        try:
            with patch("daily_news_runtime.os.getpid", return_value=runtime._pid + 1), \
                    patch("daily_news_runtime.Thread", return_value=fake_thread) as constructor:
                # Calling from a separate thread gives a bounded failure if a
                # regression acquires either permanently held parent lock.
                caller = Thread(target=runtime.start, daemon=True)
                caller.start()
                caller.join(1)
                self.assertFalse(caller.is_alive(), "start blocked on a parent-process lock")
                self.assertTrue(started.is_set())
                self.assertIsNot(runtime._state_lock, old_state)
                self.assertIsNot(runtime._work_lock, old_work)
                self.assertIsNot(runtime._stop, old_stop)
                self.assertFalse(runtime._stop.is_set())
                self.assertFalse(runtime._private)
                self.assertFalse(runtime._restored)
                self.assertEqual(runtime.snapshot()["status"], "starting")
                runtime.start()
                self.assertEqual(constructor.call_count, 1)
                self.assertEqual(fake_thread.start.call_count, 1)
                self.storage.after_fork.assert_called_once()
        finally:
            old_state.release()
            old_work.release()

    def test_repeated_start_keeps_one_live_periodic_thread(self):
        runtime = self.runtime(enabled=False)
        runtime.start()
        first = runtime._thread
        try:
            for _ in range(5):
                runtime.start()
                self.assertIs(runtime._thread, first)
            self.assertTrue(first.is_alive())
        finally:
            runtime.stop()
            first.join(2)
        self.assertFalse(first.is_alive())


class Response:
    def __init__(self, status, value):
        self.status_code = status
        self.value = value
        self.content = json.dumps(value).encode()
        self.headers = {"Content-Length": str(len(self.content))}
        self.raw = Mock()
        stream = io.BytesIO(self.content)
        self.raw.read1.side_effect = lambda size, **options: stream.read(size)
        self.closed = False

    def json(self):
        return self.value

    def close(self):
        self.closed = True


class StorageTests(unittest.TestCase):
    def adapter(self, responses):
        session = Mock()
        session.request.side_effect = responses
        return SupabaseNewsStorage("https://example.supabase.co", "sb_secret_test", session=session), session

    def test_auto_creates_private_bucket_and_verifies_after_race(self):
        storage, session = self.adapter([Response(404, {}), Response(409, {}),
                                         Response(200, {"public": False})])
        storage.ensure_private()
        create = session.request.call_args_list[1]
        self.assertEqual(create.kwargs["json"]["public"], False)
        self.assertEqual(create.kwargs["json"]["name"], "website-news")
        for call in session.request.call_args_list:
            self.assertEqual(call.kwargs["timeout"], (5, 15))
            self.assertFalse(call.kwargs["allow_redirects"])
            self.assertTrue(call.kwargs["stream"])

    def test_existing_public_bucket_is_rejected_without_mutation(self):
        storage, session = self.adapter([Response(200, {"public": True})])
        with self.assertRaises(StorageUnavailable):
            storage.ensure_private()
        self.assertEqual(session.request.call_count, 1)

    def test_object_create_is_atomic_and_conflict_is_not_overwritten(self):
        storage, session = self.adapter([Response(200, {}), Response(400, {"statusCode": "409", "error": "Duplicate"})])
        self.assertTrue(storage.create("days/2026-09-24/attempt-1.lock", {"attempt": 1}))
        self.assertFalse(storage.create("days/2026-09-24/attempt-1.lock", {"attempt": 2}))
        for call in session.request.call_args_list:
            self.assertEqual(call.kwargs["headers"]["x-upsert"], "false")
            self.assertNotIn("/public/", call.args[1])

    def test_storage_reads_and_lists_filter_paths_and_do_not_accept_auth_failure_as_missing(self):
        storage, session = self.adapter([Response(400, {"message": "Object not found"}),
                                         Response(200, [{"name": "2026-09-24"}, {"name": "../bad"}, {"name": "2026-09-23"}]),
                                         Response(200, [{"name": "reviewed-00000000000000000001.json"}, {"name": "attempt-1.lock"}]),
                                         Response(403, {"error": "private response"})])
        self.assertIsNone(storage.read("days/2026-09-24/edition.json"))
        self.assertEqual(storage.recent_days(), ["2026-09-24", "2026-09-23"])
        self.assertEqual(storage.reviewed_keys("2026-09-24"), ["days/2026-09-24/reviewed-00000000000000000001.json"])
        with self.assertRaisesRegex(StorageUnavailable, "^storage_read$"):
            storage.read("days/2026-09-24/edition.json")

    def test_non_service_key_and_untrusted_url_are_rejected_before_network(self):
        import base64
        anon = "head." + base64.urlsafe_b64encode(b'{"role":"anon"}').decode().rstrip("=") + ".sig"
        for url, key in (("https://example.supabase.co", anon), ("https://example.supabase.co", ""),
                          ("http://example.supabase.co", "sb_secret_test"),
                          ("https://user:pass@example.supabase.co", "sb_secret_test")):
            with self.subTest(url=url, key=key), self.assertRaises(StorageUnavailable):
                SupabaseNewsStorage(url, key)

    def test_factory_missing_configuration_is_nonblocking_without_http(self):
        with TemporaryDirectory() as directory, patch("daily_news_runtime.requests.Session") as session:
            runtime = start(generator=Mock(), enabled=True, baseline_path=Path(directory) / "absent.json",
                            cache_path=Path(directory) / "absent-cache.json")
            runtime.stop()
            session.assert_not_called()

    def test_factory_deferred_start_creates_no_master_thread_or_http_request(self):
        with TemporaryDirectory() as directory, patch("daily_news_runtime.Thread") as thread:
            storage = Mock()
            runtime = start(storage=storage, generator=Mock(), enabled=True, autostart=False,
                            baseline_path=Path(directory) / "absent.json",
                            cache_path=Path(directory) / "absent-cache.json")
            self.assertIsNone(runtime._thread)
            self.assertEqual(runtime.snapshot()["status"], "starting")
            storage.ensure_private.assert_not_called()
            thread.assert_not_called()

    def test_storage_transport_recreated_after_fork_without_touching_old_pool(self):
        storage, inherited_session = self.adapter([])
        with patch("daily_news_runtime.requests.Session") as factory:
            storage.after_fork()
        self.assertIs(storage._session, factory.return_value)
        inherited_session.close.assert_not_called()
        inherited_session.request.assert_not_called()

    def test_response_size_and_slow_stream_fail_closed_and_close_connection(self):
        oversized = Response(200, {})
        oversized.headers["Content-Length"] = "1000001"
        storage, _ = self.adapter([oversized])
        with self.assertRaises(StorageUnavailable):
            storage.read("days/2026-09-24/edition.json")
        oversized.raw.read1.assert_not_called()
        self.assertTrue(oversized.closed)

        slow = Response(200, {})
        storage, _ = self.adapter([slow])
        with patch("daily_news_runtime.time.monotonic", side_effect=[0, 1, 31]):
            with self.assertRaises(StorageUnavailable):
                storage.read("days/2026-09-24/edition.json")
        self.assertTrue(slow.closed)

        growing = Response(200, {})
        growing.headers = {}
        growing.raw.read1.side_effect = lambda *args, **kwargs: b"x" * 65536
        storage, _ = self.adapter([growing])
        with self.assertRaises(StorageUnavailable):
            storage.read("days/2026-09-24/edition.json")
        self.assertTrue(growing.closed)
        self.assertLessEqual(growing.raw.read1.call_count, 16)


if __name__ == "__main__":
    unittest.main()

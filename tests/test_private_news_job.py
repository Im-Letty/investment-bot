"""Private CI orchestration contracts; no sockets, credentials or CLI calls."""
from contextlib import nullcontext, redirect_stdout
from copy import deepcopy
from datetime import datetime
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from codex_website_producer import CodexWebsiteProviders, generate_codex_website_edition
from daily_news_producer import GenerationError
from daily_news_runtime import DailyNewsRuntime, StorageUnavailable
from morning_news_window import morning_window, select_articles
from news_cache import JST, OFFICIAL_NEWS_SOURCES, select_daily_news
from scripts import run_private_news_job as job
from scripts import run_codex_news as original_runner
from tests.test_codex_website_producer import Writer
from tests.test_daily_news_runtime import MemoryStorage
from tests.test_website_news_producer import ENV, MockTransport, approval, sources


def at(hour=7, minute=17, second=0):
    return datetime(2026, 10, 6, hour, minute, second, tzinfo=JST).timestamp()


class Clock:
    def __init__(self, now=None):
        self.now, self.mono, self.pauses = at() if now is None else now, 100.0, []

    def sleep(self, seconds):
        self.pauses.append(seconds)
        self.now += seconds
        self.mono += seconds


class ReadStorage(MemoryStorage):
    def __init__(self, manifest):
        self.reads = []
        super().__init__({"days/2026-10-06/preparation/manifest.json": manifest} if manifest is not None else {})

    def read(self, path):
        self.reads.append(path)
        return super().read(path)


class PrivateJobTests(unittest.TestCase):
    def setUp(self):
        self.env = {"SUPABASE_URL": "https://fixture.supabase.co", "SUPABASE_KEY": "sb_secret_fixture",
                    "GEMINI_API_KEY": "fixture-gemini", "OPENAI_API_KEY": "fixture-openai",
                    "ANTHROPIC_API_KEY": "unused-claude"}
        self.executable = patch.object(original_runner, "codex_executable", return_value="/fixture/codex")
        self.executable.start()
        self.addCleanup(self.executable.stop)
        network = patch("requests.sessions.Session.request", side_effect=AssertionError("network forbidden"))
        network.start()
        self.addCleanup(network.stop)
        self.clock = Clock()
        self.window = morning_window(at())
        self.manifest = {**self.window, "articles": select_articles(sources(), self.window),
             "source_status": {name: {"feed_status": "ok", "status": "collected", "errors": []}
                                for name in OFFICIAL_NEWS_SOURCES}}
        self.storage = ReadStorage(self.manifest)
        self.preflight = Mock()
        self.runtime = Mock()
        self.runtime.run_once.return_value = {"status": "prepared", "edition_date": "2026-10-06",
                                             "publish_at": at(8, 0), "attempt_count": 1}
        self.build = Mock(return_value=self.runtime)

    def run_job(self, **overrides):
        options = {"wall_clock": lambda: self.clock.now, "monotonic": lambda: self.clock.mono,
                   "sleep": self.clock.sleep, "storage_factory": lambda *_: self.storage,
                   "runtime_factory": self.build, "preflight": self.preflight}
        options.update(overrides)
        return job.run_job(self.env, **options)

    def test_dry_default_does_not_authenticate_build_read_storage_or_install_alarm(self):
        out = io.StringIO()
        with patch.dict(job.os.environ, self.env, clear=True), redirect_stdout(out), \
                patch.object(job, "run_job") as live, patch.object(job, "process_deadline") as alarm:
            self.assertEqual(job.main([]), 0)
        live.assert_not_called()
        alarm.assert_not_called()
        result = json.loads(out.getvalue())
        self.assertFalse(result["publication_allowed"])
        self.assertFalse(result["connection_checked"])
        self.assertEqual(result["job_seconds"], 35 * 60)
        self.assertEqual(result["generation_seconds"], 12 * 60)
        self.assertEqual(result["generation_attempts"], 1)
        for value in self.env.values():
            self.assertNotIn(value, out.getvalue())

    def test_cli_has_no_force_date_retry_keychain_or_secret_arguments(self):
        for option in ("--force", "--date", "--max-attempts", "--use-keychain", "--api-key"):
            with self.subTest(option=option), patch("sys.stderr", io.StringIO()), \
                    patch.object(job, "run_job") as live:
                with self.assertRaises(SystemExit):
                    job.main(["--run-live", option, "synthetic"])
                live.assert_not_called()

    def test_outside_real_jst_morning_exits_before_preflight_or_connection(self):
        for stamp in (at(6, 59), at(8, 0), at(15, 0), at(23, 59)):
            with self.subTest(stamp=stamp):
                self.clock.now = stamp
                result = self.run_job()
                self.assertEqual(result["status"], "outside_morning_window")
                self.assertFalse(result["success"])
        self.preflight.assert_not_called()
        self.build.assert_not_called()
        self.assertEqual(self.storage.reads, [])

    def test_configuration_and_disabled_are_not_quiet_success(self):
        for env, expected in (({}, "configuration_unavailable"),
                              ({**self.env, "DAILY_NEWS_ENABLED": "0"}, "disabled")):
            with self.subTest(expected=expected):
                result = job.run_job(env, wall_clock=lambda: at())
                self.assertEqual(result["status"], expected)
                self.assertFalse(result["success"])

    def test_login_failure_does_not_consume_daily_claim_or_connect(self):
        self.preflight.side_effect = GenerationError("private-credential-text")
        result = self.run_job()
        self.assertEqual(result["status"], "subscription_login_unavailable")
        self.assertEqual(self.storage.reads, [])
        self.assertEqual(self.storage.created, [])
        self.build.assert_not_called()
        self.assertNotIn("private-credential-text", json.dumps(result))

    def test_wait_before_cutoff_only_sleeps_then_reads_fixed_manifest_once(self):
        result = self.run_job()
        self.assertTrue(result["success"])
        self.assertEqual(self.clock.now, at(7, 30))
        self.assertEqual(len(self.clock.pauses), 26)
        self.assertEqual(self.storage.reads, ["days/2026-10-06/preparation/manifest.json"])
        self.assertEqual(self.storage.private_checks, 0)
        self.assertEqual(self.storage.created, [])
        self.preflight.assert_called_once_with(self.env)
        self.assertEqual(self.build.call_args.kwargs["max_attempts"], 1)
        self.runtime.run_once.assert_called_once()
        self.runtime.stop.assert_called_once()
        copied = self.runtime.source_preparer.prepare(self.clock.now)
        copied["articles"][0]["body"] = "changed"
        self.assertEqual(self.runtime.source_preparer.prepare(self.clock.now), self.manifest)

    def test_late_freeze_wait_is_readonly_and_still_allows_one_tick(self):
        self.clock.now = at(7, 30)
        values = [None, None, deepcopy(self.manifest)]
        self.storage.read = Mock(side_effect=values)
        result = self.run_job()
        self.assertTrue(result["success"])
        self.assertEqual(self.clock.now, at(7, 31))
        self.assertEqual(self.storage.read.call_count, 3)
        self.assertEqual(self.storage.created, [])
        self.runtime.run_once.assert_called_once()

    def test_missing_manifest_is_bounded_and_cannot_collect_or_freeze(self):
        self.storage = ReadStorage(None)
        result = self.run_job()
        self.assertEqual(result["status"], "job_deadline")
        self.assertFalse(result["success"])
        self.assertEqual(self.clock.now, at(7, 52))
        self.assertEqual(self.clock.mono, 100 + job.JOB_SECONDS)
        self.assertTrue(all(path == "days/2026-10-06/preparation/manifest.json"
                            for path in self.storage.reads))
        self.assertEqual(self.storage.created, [])
        self.assertEqual(self.storage.private_checks, 0)
        self.build.assert_not_called()

    def test_monotonic_budget_expires_even_when_wall_clock_rolls_back(self):
        self.storage = ReadStorage(None)
        self.clock.now = at(7, 30)
        def rollback(seconds):
            self.clock.mono += seconds
            self.clock.now = at(7, 30)
        result = self.run_job(sleep=rollback)
        self.assertEqual(result["status"], "job_deadline")
        self.assertEqual(self.clock.mono, 100 + job.JOB_SECONDS)
        self.build.assert_not_called()

    def test_invalid_frozen_manifest_is_rejected_without_runtime(self):
        changes = ({"edition_date": "2026-10-05"}, {"cutoff_at": at(7, 31)},
                   {"articles": [{"body": "not verified"}]})
        for change in changes:
            with self.subTest(change=list(change)):
                self.clock = Clock(at(7, 30))
                self.storage = ReadStorage({**self.manifest, **change})
                result = self.run_job()
                self.assertEqual(result["status"], "invalid_source_manifest")
        self.build.assert_not_called()

    def test_slow_read_cannot_start_generation_after_job_budget(self):
        def slow(_path):
            self.clock.sleep(job.JOB_SECONDS + 1)
            return deepcopy(self.manifest)
        self.storage.read = slow
        result = self.run_job()
        self.assertEqual(result["status"], "job_deadline")
        self.build.assert_not_called()

    def test_late_manifest_cannot_start_without_full_generation_reserve(self):
        def late(_path):
            self.clock.sleep(7 * 60)
            return deepcopy(self.manifest)
        self.storage.read = late
        result = self.run_job()
        self.assertEqual(result["status"], "generation_window_exhausted")
        self.assertFalse(result["success"])
        self.build.assert_not_called()

    def test_only_complete_enabled_sources_can_be_reported_as_quiet(self):
        self.runtime.run_once.return_value = {"status": "source_empty", "edition_date": "2026-10-06"}
        quiet = {**self.manifest, "articles": []}
        self.storage = ReadStorage(quiet)
        self.assertTrue(self.run_job()["success"])
        bad_rows = [{}, {OFFICIAL_NEWS_SOURCES[0]: {"feed_status": "ok", "status": "collected"}},
                    {**quiet["source_status"], "preparation": {"feed_status": "not_completed",
                                                               "status": "source_unavailable"}},
                    {**quiet["source_status"], OFFICIAL_NEWS_SOURCES[0]: {
                         "feed_status": "ok", "status": "collected", "errors": ["source_read_failed"]}}]
        for rows in bad_rows:
            with self.subTest(rows=list(rows)):
                self.clock = Clock(at(7, 30))
                self.storage = ReadStorage({**quiet, "source_status": rows})
                self.build.reset_mock()
                result = self.run_job()
                self.assertEqual(result["status"], "source_unavailable")
                self.assertFalse(result["success"])
                self.build.assert_not_called()

    def test_nonterminal_runtime_statuses_and_rejections_are_never_success_or_retried(self):
        for status in ("collecting", "waiting", "freezing", "waiting_for_writer", "daily_limit",
                       "generation_failed", "invalid_edition", "disabled", "source_unavailable"):
            with self.subTest(status=status):
                self.clock = Clock(at(7, 30))
                self.runtime.reset_mock()
                self.runtime.run_once.return_value = {"status": status, "edition_date": "2026-10-06"}
                result = self.run_job()
                self.assertFalse(result["success"])
                self.runtime.run_once.assert_called_once()

    def test_terminal_claim_requires_today_and_correct_code_owned_release(self):
        for fields in ({"edition_date": "2026-10-05"}, {"publish_at": at(7, 59)},
                       {"publish_at": float("nan")}, {"status": "ready", "publish_at": at(8, 0)}):
            with self.subTest(fields=fields):
                self.clock = Clock(at(7, 30))
                self.runtime.run_once.return_value = {"status": "prepared", "edition_date": "2026-10-06",
                                                      "publish_at": at(8, 0), **fields}
                self.assertFalse(self.run_job()["success"])

    def test_safe_output_never_reflects_unknown_status_exception_or_body(self):
        self.runtime.run_once.return_value = {"status": "private raw response", "edition_date": "2026-10-06",
                                             "last_error": "private-key", "body": "private body"}
        result = self.run_job()
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["last_error"], "generation_failed")
        self.assertNotIn("private", json.dumps(result))
        for error, expected in ((StorageUnavailable("secret-body"), "storage_unavailable"),
                                (RuntimeError("secret-key"), "job_unavailable")):
            self.clock = Clock(at(7, 30))
            self.build.side_effect = error
            result = self.run_job()
            self.assertEqual(result["status"], expected)
            self.assertNotIn("secret", json.dumps(result))

    def test_hard_deadline_bypasses_runtime_guard_but_stops_runtime(self):
        self.runtime.run_once.side_effect = job.JobDeadline()
        with self.assertRaises(job.JobDeadline):
            self.run_job()
        self.runtime.stop.assert_called_once()

    def test_cli_masks_hard_timeout_and_does_not_make_nonterminal_status_success(self):
        for state in ({"status": "waiting", "success": False}, job.JobDeadline()):
            out = io.StringIO()
            with self.subTest(state=type(state).__name__), redirect_stdout(out), \
                    patch.object(job, "process_deadline", return_value=nullcontext()) as deadline, \
                    patch.object(job.time, "time", return_value=at(7, 17)), patch.object(job, "run_job") as run:
                if isinstance(state, BaseException):
                    run.side_effect = state
                else:
                    run.return_value = state
                self.assertEqual(job.main(["--run-live"]), 1)
            self.assertFalse(json.loads(out.getvalue())["success"])
            deadline.assert_called_once_with(seconds=job.JOB_SECONDS)

    def test_real_runtime_reviews_identical_copy_claims_once_and_keeps_eight_am_release(self):
        calls, reviews = [], []
        with TemporaryDirectory() as folder:
            baseline = Path(folder) / "baseline.json"
            baseline.write_text("[]")
            def build(_env, **options):
                def generate(now, **source_options):
                    transport = MockTransport(reviewer=lambda name, data: reviews.append((name, data)) or approval())
                    writer = Writer()
                    calls.append(writer)
                    return generate_codex_website_edition(now, **source_options,
                        clock=lambda: self.clock.now,
                        providers=CodexWebsiteProviders(ENV, transport.session, writer=writer))
                return DailyNewsRuntime(options["storage"], generate, enabled=True,
                    baseline_path=baseline, cache_path=options["cache_path"],
                    max_attempts=options["max_attempts"], clock=lambda: self.clock.now)
            result = self.run_job(runtime_factory=build)
            self.assertEqual((result["status"], result["success"]), ("prepared", True))
            self.assertEqual([name for name, _ in reviews], ["gemini", "openai"])
            self.assertEqual(reviews[0][1], reviews[1][1])
            issue = self.storage.values["days/2026-10-06/edition.json"]
            self.assertEqual(issue["publish_at"], at(8, 0))
            self.assertEqual(issue["reading_structure"], "lead-plus-other-news-v1")
            self.assertIsNone(select_daily_news({"news": []}, at(7, 59, 59), reviewed_digests=[issue])
                              ["digest"])
            self.assertEqual(select_daily_news({"news": []}, at(8, 0), reviewed_digests=[issue])
                             ["digest"]["edition_date"], issue["edition_date"])
            self.clock = Clock(at(7, 40))
            self.assertTrue(self.run_job(runtime_factory=build)["success"])
            self.assertEqual(len(calls), 1)
            self.assertEqual([path for path in self.storage.created if path.endswith(".lock")],
                             ["days/2026-10-06/attempt-1.lock"])

    def test_real_runtime_quiet_day_has_no_claim_or_generation(self):
        self.storage = ReadStorage({**self.manifest, "articles": []})
        with TemporaryDirectory() as folder:
            baseline = Path(folder) / "baseline.json"
            baseline.write_text("[]")
            generator = Mock(side_effect=AssertionError("quiet day cannot generate"))
            def build(_env, **options):
                return DailyNewsRuntime(options["storage"], generator, enabled=True,
                    baseline_path=baseline, cache_path=options["cache_path"],
                    max_attempts=options["max_attempts"], clock=lambda: self.clock.now)
            result = self.run_job(runtime_factory=build)
        self.assertEqual((result["status"], result["success"]), ("source_empty", True))
        generator.assert_not_called()
        self.assertEqual(self.storage.created, [])

    def test_real_failed_daily_claim_is_not_repeated_by_a_restarted_ci_job(self):
        with TemporaryDirectory() as folder:
            baseline = Path(folder) / "baseline.json"
            baseline.write_text("[]")
            generator = Mock(side_effect=GenerationError("editorial_review_failed_facts"))
            def build(_env, **options):
                return DailyNewsRuntime(options["storage"], generator, enabled=True,
                    baseline_path=baseline, cache_path=options["cache_path"],
                    max_attempts=options["max_attempts"], clock=lambda: self.clock.now)
            first = self.run_job(runtime_factory=build)
            self.clock = Clock(at(7, 50))
            second = self.run_job(runtime_factory=build)
        self.assertEqual((first["status"], first["success"]), ("generation_failed", False))
        self.assertEqual((second["status"], second["success"]), ("daily_limit", False))
        generator.assert_called_once()
        self.assertEqual([path for path in self.storage.created if path.endswith(".lock")],
                         ["days/2026-10-06/attempt-1.lock"])


class ProcessDeadlineTests(unittest.TestCase):
    def test_alarm_bounds_wait_and_restores_handler_even_on_base_exception(self):
        with patch.object(job.signal, "getitimer", return_value=(0.0, 0.0)), \
                patch.object(job.signal, "getsignal", return_value="previous"), \
                patch.object(job.signal, "signal") as handler, \
                patch.object(job.signal, "setitimer") as timer:
            with self.assertRaises(job.JobDeadline):
                with job.process_deadline(monotonic=lambda: 123):
                    callback = handler.call_args.args[1]
                    callback()
        self.assertEqual(timer.call_args_list[0].args, (job.signal.ITIMER_REAL, job.JOB_SECONDS))
        self.assertEqual(timer.call_args_list[-1].args, (job.signal.ITIMER_REAL, 0))
        self.assertEqual(handler.call_args.args, (job.signal.SIGALRM, "previous"))

    def test_existing_timer_is_not_silently_replaced_or_ignored(self):
        with patch.object(job.signal, "getitimer", return_value=(20.0, 0.0)), \
                patch.object(job.signal, "setitimer") as timer:
            with self.assertRaises(job.DeadlineUnavailable):
                with job.process_deadline():
                    self.fail("must refuse unbounded work")
        timer.assert_not_called()


if __name__ == "__main__":
    unittest.main()

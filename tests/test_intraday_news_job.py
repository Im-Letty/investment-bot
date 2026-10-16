from contextlib import nullcontext, redirect_stdout
from io import StringIO
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from scripts import run_intraday_news_job as job
from scripts.run_private_news_job import DeadlineUnavailable, JobDeadline
from daily_news_runtime import StorageUnavailable
from tests.test_intraday_news_runtime import Cache, Storage, at, source
from tests.test_news_review_diagnostics import diagnostic


class IntradayJobTests(unittest.TestCase):
    def setUp(self):
        self.env = {name: "test-config-only" for name in job.REQUIRED}
        self.env["NEWS_INTRADAY_ENABLED"] = "1"
        self.storage = Storage()
        self.cache = Cache([source()])

    def test_default_reports_only_configuration_without_storage_or_auth(self):
        output = StringIO()
        with patch.dict(os.environ, self.env, clear=True), redirect_stdout(output), \
                patch.object(job, "run_job") as run:
            self.assertEqual(job.main([]), 0)
        run.assert_not_called()
        value = json.loads(output.getvalue())
        self.assertFalse(value["publication_allowed"])
        self.assertEqual(value["target_mode"], "soft")
        self.assertNotIn("test-config-only", output.getvalue())

    def test_editorial_projection_survives_progress_and_safe_report_without_private_text(self):
        value = diagnostic()
        value['raw_response'] = 'private reviewer prose'
        value['rounds'][0]['openai']['issues'] = ['private reviewer prose']
        state = {'status': 'review_failed', 'phase': 'generation', 'attempt_count': 1,
                 'last_error': 'isolated_editorial_review_failed', 'editorial_review_diagnostics': value}
        progress = job.IntradayProgress()
        progress.record(state)
        self.assertEqual(progress.fields()['editorial_review_diagnostics'], diagnostic())
        fields = progress.fields()
        fields['editorial_review_diagnostics']['rounds'].clear()
        self.assertEqual(progress.fields()['editorial_review_diagnostics'], diagnostic())
        report = job.safe_report(state, at(), at() + 1, False, progress)
        self.assertEqual(report['editorial_review_diagnostics'], diagnostic())
        self.assertEqual(report['status'], 'review_failed')
        self.assertEqual(report['published_count'], 0)
        self.assertNotIn('private reviewer prose', json.dumps(report))
        for changes in ({'last_error': 'openai_unavailable'}, {'last_error': None},
                        {'editorial_review_diagnostics': {'raw': 'private response'}}):
            self.assertNotIn('editorial_review_diagnostics',
                job.safe_report({**state, **changes}, at(), at() + 1, False))
        # A later unrelated deadline must not carry the former editorial result.
        progress.value['last_error'] = 'job_deadline'
        self.assertNotIn('editorial_review_diagnostics', progress.fields())

    def test_check_needs_only_storage_and_never_restores_or_checks_login(self):
        env = {key: value for key, value in self.env.items() if key not in ("GEMINI_API_KEY", "OPENAI_API_KEY")}
        with patch("scripts.run_codex_news.preflight_subscription") as preflight:
            report = job.run_job(env, check_only=True, clock=lambda: at(),
                                storage_factory=lambda url, key: self.storage, cache=self.cache)
        self.assertEqual(report["status"], "ready")
        self.assertEqual(report["eligible_count"], 1)
        self.assertEqual(report["schema_version"], 1)
        preflight.assert_not_called()
        self.assertEqual(self.storage.created, [])
        self.assertTrue(report["eligibility_checked"])
        self.assertTrue(report["source_health_verified"])
        self.assertEqual(report["phase"], "outcome")

    def test_source_snapshot_fixed_error_is_distinguished_from_healthy_zero(self):
        self.cache.snapshot = Mock(side_effect=ValueError("invalid_source_cache_poll"))
        preflight = Mock()
        report = job.run_job(self.env, check_only=True, clock=lambda: at(),
            storage_factory=lambda url, key: self.storage, cache=self.cache, preflight=preflight)
        self.assertEqual(report["status"], "job_unavailable")
        self.assertEqual(report["phase"], "source_snapshot")
        self.assertEqual(report["last_error"], "invalid_source_cache_poll")
        self.assertFalse(report["eligibility_checked"])
        self.assertFalse(report["source_health_verified"])
        self.assertEqual(self.storage.created, [])
        preflight.assert_not_called()

    def test_unrecognized_source_exception_is_redacted_but_phase_is_retained(self):
        self.cache.snapshot = Mock(side_effect=RuntimeError("fake-private-response-and-key"))
        report = job.run_job(self.env, check_only=True, clock=lambda: at(),
            storage_factory=lambda url, key: self.storage, cache=self.cache)
        self.assertEqual(report["phase"], "source_snapshot")
        self.assertEqual(report["last_error"], "job_unavailable")
        self.assertNotIn("fake-private", json.dumps(report))
        self.assertFalse(report["eligibility_checked"])

    def test_existing_bucket_check_failure_remains_storage_not_review_failure(self):
        self.storage.ensure_private = Mock(side_effect=StorageUnavailable("storage_private_required"))
        report = job.run_job(self.env, check_only=True, clock=lambda: at(),
            storage_factory=lambda url, key: self.storage, cache=self.cache)
        self.assertEqual(report["status"], "storage_unavailable")
        self.assertEqual(report["last_error"], "storage_private_required")
        self.assertEqual(report["phase"], "storage_private_check")
        self.assertFalse(report["eligibility_checked"])
        self.assertEqual(self.storage.created, [])

    def test_fixed_history_errors_keep_cause_and_preclaim_phase(self):
        for code in ("intraday_history_invalid", "intraday_history_deadline", "intraday_history_capacity"):
            with self.subTest(code=code):
                self.storage.reviewed_keys = Mock(side_effect=StorageUnavailable(code))
                report = job.run_job(self.env, check_only=True, clock=lambda: at(),
                    storage_factory=lambda url, key: self.storage, cache=self.cache)
                self.assertEqual(report["last_error"], code)
                self.assertEqual(report["phase"], "published_history")
                self.assertTrue(report["source_health_verified"])
                self.assertFalse(report["eligibility_checked"])
                self.assertEqual(self.storage.created, [])

    def test_default_storage_gets_private_absolute_budget_and_custom_factory_stays_two_args(self):
        with patch.object(job, "PrivateNewsStorage", return_value=self.storage) as private:
            report = job.run_job(self.env, check_only=True, clock=lambda: at(),
                                 monotonic=lambda: 100, cache=self.cache)
        self.assertEqual(report["status"], "ready")
        self.assertEqual(private.call_args.kwargs["deadline"], 100 + job.CHECK_SECONDS)
        self.assertEqual(private.call_args.kwargs["phase"], "source_preparation")
        custom = Mock(return_value=self.storage)
        job.run_job(self.env, check_only=True, clock=lambda: at(), storage_factory=custom, cache=self.cache)
        custom.assert_called_once_with(self.env["SUPABASE_URL"], self.env["SUPABASE_KEY"])

    def test_storage_setup_error_is_safe_and_never_opens_writer(self):
        factory = Mock(side_effect=StorageUnavailable("storage_network"))
        writer = Mock()
        report = job.run_job(self.env, check_only=True, clock=lambda: at(),
                             storage_factory=factory, writer_factory=writer)
        self.assertEqual(report["status"], "storage_unavailable")
        self.assertEqual(report["phase"], "storage_configuration")
        self.assertEqual(report["last_error"], "storage_network")
        writer.assert_not_called()

    def test_hard_deadline_retains_progress_and_paid_claim_count(self):
        def interrupted(storage, **kwargs):
            kwargs["progress"]({"phase": "generation", "eligibility_checked": True,
                                  "source_health_verified": True, "attempt_count": 1, "eligible_count": 1})
            raise JobDeadline()
        with patch.object(job, "run_intraday", side_effect=interrupted):
            report = job.run_job(self.env, check_only=True, clock=lambda: at(),
                                storage_factory=lambda url, key: self.storage)
        self.assertEqual(report["status"], "job_deadline")
        self.assertEqual(report["phase"], "generation")
        self.assertEqual(report["attempt_count"], 1)
        self.assertEqual(report["eligible_count"], 1)
        self.assertTrue(report["eligibility_checked"])

    def test_safe_result_drops_raw_metadata_and_keeps_only_fixed_counters_and_receipts(self):
        value = {**job._base("published", at(), False), "phase": "publication", "attempt_count": 1,
            "eligibility_checked": True, "source_health_verified": True,
            "source_cache_observations": {"legacy_two_source_polls": 1, "concurrent_read_records": 2,
                                           "fake-private-counter": 1},
            "source_status": {"財務省": {"feed_status": "ok", "status": "collected", "accepted": 1,
                                          "fake-private-response": "fake-private-value"}},
            "review_receipt": {"content_sha256": "a" * 64, "review_payload_sha256": "b" * 64,
                "source_body_sha256": ["c" * 64], "reviewed_at": at(), "gemini_approved": True,
                "openai_approved": True, "body": "fake-private-original"},
            "api_review_cost": {"request_count": 2, "estimated_cost_jpy": "1.25", "estimate_complete": True,
                                "scope": "economy", "response": "fake-private-ai-response"},
            "prompt": "fake-private-prompt", "body": "fake-private-original",
            "last_error": "fake-private-key"}
        report = job.safe_report(value, at(), at() + 1, False)
        self.assertEqual(report["source_cache_observations"], {"legacy_two_source_polls": 1, "concurrent_read_records": 2})
        self.assertEqual(report["review_receipt"]["content_sha256"], "a" * 64)
        self.assertEqual(report["api_review_cost"]["estimated_cost_jpy"], "1.25")
        self.assertEqual(report["last_error"], "job_unavailable")
        self.assertNotIn("fake-private", json.dumps(report))

    def test_main_check_budget_is_shorter_and_interrupted_progress_is_written(self):
        def interrupted(*, progress, **kwargs):
            progress.record({"phase": "source_snapshot", "attempt_count": 0,
                             "source_cache_observations": {"legacy_two_source_polls": 1}})
            raise JobDeadline()
        with patch.object(job, "run_job", side_effect=interrupted), \
                patch("scripts.run_private_news_job.process_deadline", return_value=nullcontext()) as timer, \
                redirect_stdout(StringIO()) as output:
            self.assertEqual(job.main(["--check-live"]), 1)
        timer.assert_called_once_with(seconds=job.CHECK_SECONDS)
        value = json.loads(output.getvalue())
        self.assertEqual(value["phase"], "source_snapshot")
        self.assertEqual(value["last_error"], "job_deadline")
        self.assertFalse(value["eligibility_checked"])
        self.assertEqual(value["source_cache_observations"]["legacy_two_source_polls"], 1)

    def test_progress_rejects_wrong_types_and_unbounded_cache_counters(self):
        progress = job.IntradayProgress()
        progress.record({"phase": "fake-private-phase", "attempt_count": True, "eligibility_checked": 1,
                         "source_cache_observations": {"legacy_two_source_polls": 129,
                                                       "concurrent_read_records": False}})
        self.assertEqual(progress.fields()["phase"], "starting")
        self.assertFalse(progress.fields()["eligibility_checked"])
        self.assertEqual(progress.fields()["source_cache_observations"], {})

    def test_cache_read_progress_is_fixed_bounded_and_survives_safe_report_projection(self):
        safe = {"read_seconds": 60, "read_count": 128, "list_count": 3,
                "elapsed_seconds": 50.25, "deadline_exceeded": False}
        progress = job.IntradayProgress()
        progress.record({"source_cache_reads": {**safe, "url": "secret", "body": "secret"}})
        self.assertEqual(progress.fields()["source_cache_reads"], safe)
        value = job.safe_report({"status": "ready", **progress.fields()}, at(), at(), True, progress=progress)
        self.assertEqual(value["source_cache_reads"], safe)
        self.assertNotIn("secret", repr(value))
        progress.record({"source_cache_reads": {"read_seconds": 61, "read_count": True,
            "list_count": 10000, "elapsed_seconds": float('inf'), "deadline_exceeded": 1}})
        self.assertEqual(progress.fields()["source_cache_reads"], {})

    def test_missing_hard_deadline_cannot_silently_start_live_processing(self):
        with patch("scripts.run_private_news_job.process_deadline", side_effect=DeadlineUnavailable()), \
                patch.object(job, "run_job") as run, redirect_stdout(StringIO()) as output:
            self.assertEqual(job.main(["--check-live"]), 1)
        run.assert_not_called()
        self.assertEqual(json.loads(output.getvalue())["status"], "job_deadline_unavailable")

    def test_disabled_missing_and_bad_expected_day_do_not_start_ai(self):
        for env, status in (({}, "configuration_unavailable"),
                            ({**self.env, "NEWS_INTRADAY_ENABLED": "0"}, "disabled"),
                            ({**self.env, "INTRADAY_EXPECTED_DAY": "malformed"}, "outside_intraday_window")):
            with self.subTest(status=status):
                factory = Mock()
                self.assertEqual(job.run_job(env, clock=lambda: at(), storage_factory=factory)["status"], status)
                factory.assert_not_called()

    def test_review_cost_is_present_when_generation_fails_or_deadline_interrupts(self):
        for error in (ValueError("never print upstream text"), JobDeadline()):
            with self.subTest(error=type(error).__name__):
                storage = Storage()
                def mark_usage(now, *, articles, source_window, providers, clock):
                    recorder = providers.usage_recorder
                    recorder.start_request(provider="gemini", model="gemini-2.5-flash", request_id="a" * 32)
                    recorder.record_request(provider="gemini", model="gemini-2.5-flash", request_id="a" * 32,
                        usage={"promptTokenCount": 100, "totalTokenCount": 120,
                               "candidatesTokenCount": 20, "thoughtsTokenCount": 0})
                    raise error
                def interrupted(storage, generator, **kwargs):
                    # The recorder is passed into the existing provider without
                    # any HTTP. Persist real-shaped numeric test usage first.
                    generator(at(), articles=[source()], source_window={})
                with patch.object(job, "run_intraday", side_effect=interrupted), \
                        patch("codex_website_producer.generate_codex_website_edition", side_effect=mark_usage):
                    report = job.run_job(self.env, clock=lambda: at(), storage_factory=lambda url, key: storage,
                                         writer_factory=lambda: Mock(), preflight=Mock())
                self.assertIn("api_review_cost", report)
                self.assertEqual(report["api_review_cost"]["target_mode"], "soft")
                self.assertEqual(report["api_review_cost"]["request_count"], 1)
                self.assertTrue(report["api_review_cost"]["persistence_complete"])
                self.assertNotIn("upstream", json.dumps(report))

    def test_result_file_is_fixed_safe_metadata_and_rejects_existing_destination(self):
        with TemporaryDirectory() as folder:
            target = Path(folder).resolve() / "result.json"
            report = job._base("ready", at(), True)
            report["eligible_count"] = 1
            with patch.object(job, "run_job", return_value=report), redirect_stdout(StringIO()):
                self.assertEqual(job.main(["--check-live", "--result-file", str(target)]), 0)
            value = json.loads(target.read_text())
            self.assertEqual(value["eligible_count"], 1)
            self.assertEqual(value["report_kind"], "private_intraday_writer")
            prior = target.read_text()
            with patch.object(job, "run_job") as run, redirect_stdout(StringIO()):
                self.assertEqual(job.main(["--check-live", "--result-file", str(target)]), 1)
            run.assert_not_called()
            self.assertEqual(target.read_text(), prior)


if __name__ == "__main__":
    unittest.main()

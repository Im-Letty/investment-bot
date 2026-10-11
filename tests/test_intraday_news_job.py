from contextlib import redirect_stdout
from io import StringIO
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from scripts import run_intraday_news_job as job
from scripts.run_private_news_job import JobDeadline
from tests.test_intraday_news_runtime import Cache, Storage, at, source


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

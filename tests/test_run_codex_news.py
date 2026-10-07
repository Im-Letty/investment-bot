from contextlib import redirect_stdout
import io
import json
import time
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from scripts import run_codex_news as worker
from daily_news_runtime import StorageUnavailable
from tests.test_daily_news_runtime import MemoryStorage


class LocalWorkerTests(unittest.TestCase):
    def setUp(self):
        self.env = {"SUPABASE_URL": "https://storage.example", "SUPABASE_KEY": "fake-server-secret",
                    "GEMINI_API_KEY": "fake-gemini", "OPENAI_API_KEY": "fake-openai",
                    "ANTHROPIC_API_KEY": "unused-claude-secret"}
        executable = patch.object(worker, "codex_executable", return_value="/synthetic/codex")
        executable.start()
        self.addCleanup(executable.stop)
        preflight = patch.object(worker, "preflight_subscription", return_value=None)
        preflight.start()
        self.addCleanup(preflight.stop)

    def test_default_only_reports_names_without_authenticated_work(self):
        out = io.StringIO()
        with patch.dict(worker.os.environ, self.env, clear=True), redirect_stdout(out), \
                patch.object(worker, "build_runtime") as build:
            self.assertEqual(worker.main([]), 0)
        build.assert_not_called()
        value = json.loads(out.getvalue())
        self.assertTrue(value["configured"])
        self.assertFalse(value["publication_allowed"])
        for secret in self.env.values():
            self.assertNotIn(secret, out.getvalue())

    def test_modes_alone_cannot_trigger_live_work(self):
        for mode in ("--once", "--serve"):
            with self.subTest(mode=mode), patch.object(worker, "build_runtime") as build, \
                    redirect_stdout(io.StringIO()):
                self.assertEqual(worker.main([mode]), 0)
                build.assert_not_called()

    def test_live_needs_a_mode_and_valid_configuration(self):
        with patch.object(worker, "build_runtime") as build, patch("sys.stderr", io.StringIO()):
            with self.assertRaises(SystemExit):
                worker.main(["--run-live"])
            build.assert_not_called()
        with patch.dict(worker.os.environ, {}, clear=True), redirect_stdout(io.StringIO()):
            self.assertEqual(worker.main(["--run-live", "--once"]), 2)

    def test_runtime_is_real_clock_and_bounded_with_no_auth_or_generation_on_build(self):
        storage = MemoryStorage()
        with TemporaryDirectory() as folder, patch.object(worker, "CodexWebsiteProviders") as provider:
            runtime = worker.build_runtime(self.env, storage=storage,
                        cache_path=str(Path(folder) / "cache.json"))
            self.assertIs(runtime.clock, time.time)
            self.assertEqual(runtime.max_attempts, 1)
            self.assertEqual(runtime.generation_owner, "local")
            self.assertEqual(storage.created, [])
            self.assertEqual(storage.private_checks, 0)
            provider.assert_not_called()

    def test_only_two_review_keys_reach_provider_and_frozen_input_is_preserved(self):
        storage = MemoryStorage()
        with TemporaryDirectory() as folder, patch.object(worker, "CodexWebsiteProviders") as provider, \
                patch.object(worker, "generate_codex_website_edition", return_value={"private": "result"}) as generate:
            runtime = worker.build_runtime(self.env, storage=storage,
                        cache_path=str(Path(folder) / "cache.json"))
            articles, window = [{"body": "unchanged verified body"}], {"version": 1}
            result = runtime.generator(123, articles=articles, source_window=window)
            self.assertEqual(result, {"private": "result"})
            supplied = provider.call_args.kwargs
            self.assertEqual(supplied["environ"], {"GEMINI_API_KEY": "fake-gemini", "OPENAI_API_KEY": "fake-openai"})
            self.assertEqual(supplied["writer"].executable, "/synthetic/codex")
            generate.assert_called_once_with(123, articles=articles, source_window=window,
                                             providers=provider.return_value)

    def test_cli_does_not_reflect_configuration_exceptions(self):
        out = io.StringIO()
        with patch.object(worker, "build_runtime", side_effect=StorageUnavailable("fake-secret")), redirect_stdout(out):
            self.assertEqual(worker.main(["--run-live", "--once"]), 2)
        self.assertNotIn("fake-secret", out.getvalue())
        self.assertEqual(json.loads(out.getvalue())["status"], "configuration_unavailable")

    def test_missing_cli_fails_before_storage_or_daily_attempt_claim(self):
        storage = MemoryStorage()
        with patch.object(worker, "codex_executable", return_value=None):
            self.assertIn("CODEX_EXECUTABLE", worker.configuration(self.env)["missing"])
            with self.assertRaisesRegex(StorageUnavailable, "^codex_local_configuration$"):
                worker.build_runtime(self.env, storage=storage)
        self.assertEqual(storage.created, [])
        self.assertEqual(storage.private_checks, 0)

    def test_rejected_generation_is_not_reported_as_successful_tick(self):
        runtime = Mock()
        runtime.run_once.return_value = {"status": "generation_failed", "last_error": "isolated_editorial_review_failed"}
        with patch.object(worker, "build_runtime", return_value=runtime), redirect_stdout(io.StringIO()):
            self.assertEqual(worker.main(["--run-live", "--once"]), 1)

    def test_saved_key_dry_check_never_reads_values_or_builds_runtime(self):
        credentials = Mock()
        credentials.status.return_value = {"review_keys_saved": True, "storage_saved": True, "errors": {}}
        out = io.StringIO()
        with patch.object(worker, "MacNewsCredentials", return_value=credentials), \
                patch.dict(worker.os.environ, {}, clear=True), patch.object(worker, "build_runtime") as build, \
                redirect_stdout(out):
            self.assertEqual(worker.main(["--use-keychain"]), 0)
        result = json.loads(out.getvalue())
        self.assertTrue(result["configured"])
        self.assertFalse(result["connection_checked"])
        self.assertFalse(result["publication_allowed"])
        credentials.load_review_keys.assert_not_called()
        credentials.load_storage.assert_not_called()
        build.assert_not_called()

    def test_live_saved_credentials_are_not_exported_and_claude_is_not_loaded(self):
        credentials = Mock()
        credentials.status.return_value = {"review_keys_saved": True, "storage_saved": True, "errors": {}}
        credentials.load_review_keys.return_value = {"GEMINI_API_KEY": "saved-gemini", "OPENAI_API_KEY": "saved-openai"}
        credentials.load_storage.return_value = {"SUPABASE_URL": "https://fixed.supabase.co", "SUPABASE_KEY": "saved-service"}
        env = {"ANTHROPIC_API_KEY": "do-not-use", "OPENAI_API_KEY": "do-not-export"}
        with TemporaryDirectory() as folder, patch.object(worker, "SupabaseNewsStorage") as storage, \
                patch.object(worker, "CodexWebsiteProviders") as provider, \
                patch.object(worker, "generate_codex_website_edition"):
            runtime = worker.build_runtime(env, use_keychain=True, credentials=credentials,
                        cache_path=str(Path(folder) / "cache.json"))
            provider.assert_not_called()
            storage.assert_called_once_with("https://fixed.supabase.co", "saved-service")
            runtime.generator(123, articles=[], source_window={})
            self.assertEqual(provider.call_args.kwargs["environ"],
                             {"GEMINI_API_KEY": "saved-gemini", "OPENAI_API_KEY": "saved-openai"})
        self.assertEqual(env, {"ANTHROPIC_API_KEY": "do-not-use", "OPENAI_API_KEY": "do-not-export"})
        self.assertEqual(credentials.load_storage.return_value, {})

    def test_missing_or_unknown_storage_blocks_before_key_read_and_claim(self):
        for value in (False, None):
            credentials = Mock()
            credentials.status.return_value = {"review_keys_saved": True, "storage_saved": value,
                                               "errors": {"storage_saved": "locked"} if value is None else {}}
            storage = MemoryStorage()
            with self.subTest(value=value), self.assertRaisesRegex(StorageUnavailable, "^codex_local_configuration$"):
                worker.build_runtime({}, storage=storage, use_keychain=True, credentials=credentials)
            credentials.load_review_keys.assert_not_called()
            credentials.load_storage.assert_not_called()
            self.assertEqual(storage.created, [])

    def test_saved_key_access_denial_is_a_safe_configuration_failure(self):
        credentials = Mock()
        credentials.status.return_value = {"review_keys_saved": True, "storage_saved": True, "errors": {}}
        credentials.load_review_keys.side_effect = worker.MacNewsCredentialsError("access_denied")
        with self.assertRaisesRegex(StorageUnavailable, "^codex_local_configuration$"):
            worker.build_runtime({}, use_keychain=True, credentials=credentials)
        credentials.load_storage.assert_not_called()

    def test_subscription_preflight_failure_prevents_runtime_and_claim(self):
        out = io.StringIO()
        with patch.object(worker, "preflight_subscription", side_effect=worker.GenerationError("codex_chatgpt_login_required")), \
                patch.object(worker, "build_runtime") as build, redirect_stdout(out):
            self.assertEqual(worker.main(["--run-live", "--once", "--use-keychain"]), 2)
        build.assert_not_called()
        self.assertEqual(json.loads(out.getvalue())["status"], "subscription_login_unavailable")

    def test_morning_window_uses_real_japan_date_and_rejects_outside_before_auth(self):
        stamp = lambda hour, minute: datetime(2026, 10, 7, hour, minute, tzinfo=worker.JST).timestamp()
        self.assertIsNone(worker.morning_end(stamp(6, 44)))
        self.assertEqual(worker.morning_end(stamp(6, 45)), stamp(8, 15))
        self.assertEqual(worker.morning_end(stamp(8, 14)), stamp(8, 15))
        self.assertIsNone(worker.morning_end(stamp(8, 15)))
        for now in (stamp(6, 44), stamp(8, 15), stamp(18, 0)):
            with self.subTest(now=now), patch.object(worker.time, "time", return_value=now), \
                    patch.object(worker, "preflight_subscription") as auth, \
                    patch.object(worker, "build_runtime") as build, redirect_stdout(io.StringIO()):
                self.assertEqual(worker.main(["--run-live", "--serve", "--morning"]), 2)
                auth.assert_not_called()
                build.assert_not_called()

    def test_morning_service_does_not_start_another_tick_after_end(self):
        start = datetime(2026, 10, 7, 8, 14, 59, tzinfo=worker.JST).timestamp()
        end = datetime(2026, 10, 7, 8, 15, tzinfo=worker.JST).timestamp()
        runtime = Mock()
        runtime.run_once.return_value = {"status": "ready"}
        with patch.object(worker.time, "time", side_effect=[start, start, end, end]), \
                patch.object(worker, "build_runtime", return_value=runtime), \
                patch.object(worker, "Event") as event, patch.object(worker.signal, "signal"), \
                redirect_stdout(io.StringIO()):
            event.return_value.is_set.return_value = False
            self.assertEqual(worker.main(["--run-live", "--serve", "--morning"]), 0)
        runtime.run_once.assert_called_once_with()
        runtime.stop.assert_called_once_with()
        event.return_value.wait.assert_called_once_with(0)


if __name__ == "__main__":
    unittest.main()

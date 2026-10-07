"""Cloud subscription probe tests; every native process is a static fake."""
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

import codex_news_writer as native
from daily_news_producer import GenerationError
from scripts import check_cloud_subscription as checker
from tests.test_codex_news_writer import ENV, FakeRunner


class SubscriptionCheckTests(unittest.TestCase):
    def setUp(self):
        guard = patch.object(native.subprocess, 'Popen', side_effect=AssertionError('real process forbidden'))
        guard.start()
        self.addCleanup(guard.stop)
        network = patch('requests.sessions.Session.request', side_effect=AssertionError('network forbidden'))
        network.start()
        self.addCleanup(network.stop)

    def instance(self, runner, env=None):
        return native.CodexNewsWriter(executable='/fake/codex', runner=runner,
                                     environ=ENV if env is None else env)

    def check(self, runner, *, monotonic=None, env=None):
        instance = self.instance(runner, env)
        result = checker.check_subscription(writer_factory=lambda: instance, monotonic=monotonic)
        self.assertTrue(instance._closed)
        self.assertEqual(set(result), {'status', 'verified', 'call_count'})
        self.assertLessEqual(result['call_count'], 1)
        self.assertTrue(all(not Path(call['cwd']).exists() for call in runner.calls))
        return result

    def test_default_dry_path_does_not_construct_writer_or_read_auth(self):
        with patch.object(checker, 'CodexNewsWriter') as constructor, \
                patch.object(checker, 'check_subscription') as live, redirect_stdout(io.StringIO()) as output:
            self.assertEqual(checker.main([]), 0)
        constructor.assert_not_called()
        live.assert_not_called()
        self.assertEqual(json.loads(output.getvalue()), {'status': 'dry_run', 'verified': False, 'call_count': 0})

    def test_one_fixed_prompt_uses_native_safe_environment_and_private_cleanup(self):
        secrets = {name: 'secret-' + name for name in ('OPENAI_API_KEY', 'GEMINI_API_KEY',
            'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'CODEX_API_KEY', 'SUPABASE_KEY', 'HTTPS_PROXY')}
        runner = FakeRunner({'status': 'ok'}, stderr=b'private-process-output')
        result = self.check(runner, env={**ENV, **secrets})
        self.assertEqual(result, {'status': 'subscription_verified', 'verified': True, 'call_count': 1})
        self.assertEqual(len(runner.calls), 2)  # readonly login status, then one model invocation
        self.assertEqual(runner.calls[0]['argv'], ['/fake/codex', 'login', 'status'])
        call = runner.calls[1]
        self.assertEqual(call['input'], checker.PROMPT)
        self.assertEqual(call['schema'], checker.ACK_SCHEMA)
        self.assertEqual((call['directory_mode'], call['schema_mode'], call['answer_mode']), (0o700, 0o600, 0o600))
        self.assertEqual(call['argv'][:3], ['/fake/codex', '--no-daemon', 'exec'])
        self.assertEqual(call['argv'][call['argv'].index('--sandbox') + 1], 'read-only')
        for flag in ('--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--json'):
            self.assertIn(flag, call['argv'])
        settings = [call['argv'][i + 1] for i, flag in enumerate(call['argv']) if flag == '-c']
        self.assertEqual(tuple(settings), checker.SETTINGS)
        self.assertIn('forced_login_method="chatgpt"', settings)
        self.assertIn('shell_environment_policy.inherit="none"', settings)
        for invocation in runner.calls:
            self.assertEqual(invocation['env'], ENV)
            self.assertGreater(invocation['timeout'], 0)
            self.assertLessEqual(invocation['timeout'], 120)
            self.assertNotIn('secret-', str(invocation))
        self.assertEqual(call['max_output_bytes'], checker.MAX_WIRE_BYTES)
        self.assertNotIn('private-process-output', json.dumps(result))

    def test_api_auth_or_missing_login_never_attempts_the_prompt(self):
        for status in (b'Logged in using API key: sk-private\n', b'Not logged in\n', b''):
            runner = FakeRunner({'status': 'ok'}, status=status)
            with self.subTest(status=status):
                result = self.check(runner)
                self.assertEqual(result, {'status': 'chatgpt_login_required', 'verified': False, 'call_count': 0})
                self.assertEqual(len(runner.calls), 1)
                self.assertNotIn('sk-private', json.dumps(result))

    def test_exact_ack_only_no_duplicate_keys_extra_fields_or_nonfinite_json(self):
        invalid = ({'status': 'OK'}, {}, [], {'status': 'ok', 'extra': True},
                   {'status': True}, b'{"status":"ok","status":"ok"}',
                   b'{"status":NaN}', b'private non-json', b'"ok"',
                   b' ' * checker.MAX_ACK_BYTES + b'{"status":"ok"}')
        for answer in invalid:
            runner = FakeRunner(answer)
            with self.subTest(answer=answer):
                result = self.check(runner)
                self.assertEqual(result, {'status': 'subscription_invalid_response', 'verified': False, 'call_count': 1})
                self.assertEqual(len(runner.calls), 2)

    def test_cli_failure_tool_use_or_bad_events_stop_without_retry_or_output(self):
        for options, expected in (({'exec_code': 1, 'stderr': b'private auth failure'}, 'subscription_unavailable'),
                ({'events': b'{"type":"item.completed","item":{"type":"command_execution"}}\n'}, 'subscription_invalid_response'),
                ({'events': b'private non-json event'}, 'subscription_invalid_response'),
                ({'events': b'{"type":"turn.failed"}\n'}, 'subscription_unavailable'),
                ({'stderr': b'x' * (checker.MAX_WIRE_BYTES + 1)}, 'subscription_invalid_response')):
            runner = FakeRunner({'status': 'ok'}, **options)
            with self.subTest(options=list(options)):
                result = self.check(runner)
                self.assertEqual(result['status'], expected)
                self.assertFalse(result['verified'])
                self.assertEqual(result['call_count'], 1)
                self.assertEqual(len(runner.calls), 2)
                self.assertNotIn('private', json.dumps(result))

    def test_late_answer_cannot_report_success_and_preserves_one_attempt(self):
        clock = {'now': 0}
        runner = FakeRunner({'status': 'ok'})
        def execute(argv, **options):
            result = runner(argv, **options)
            if 'exec' in argv:
                clock['now'] = checker.CHECK_SECONDS + 1
            return result
        instance = self.instance(execute)
        result = checker.check_subscription(writer_factory=lambda: instance, monotonic=lambda: clock['now'])
        self.assertEqual(result, {'status': 'subscription_timeout', 'verified': False, 'call_count': 1})
        self.assertTrue(instance._closed)
        self.assertTrue(all(not Path(call['cwd']).exists() for call in runner.calls))

    def test_expired_preflight_budget_prevents_login_and_model_processes(self):
        clock = {'now': 0}
        runner = FakeRunner({'status': 'ok'})
        instance = self.instance(runner)
        def construct():
            clock['now'] = checker.CHECK_SECONDS + 1
            return instance
        result = checker.check_subscription(writer_factory=construct, monotonic=lambda: clock['now'])
        self.assertEqual(result, {'status': 'subscription_timeout', 'verified': False, 'call_count': 0})
        self.assertEqual(runner.calls, [])
        self.assertTrue(instance._closed)

    def test_transport_timeout_or_cancellation_still_removes_files_and_closes_writer(self):
        for error in (subprocess.TimeoutExpired('private command', 1), KeyboardInterrupt()):
            runner = FakeRunner({'status': 'ok'})
            def execute(argv, **options):
                result = runner(argv, **options)
                if 'exec' in argv:
                    raise error
                return result
            instance = self.instance(execute)
            with self.subTest(error=type(error).__name__):
                if isinstance(error, KeyboardInterrupt):
                    with self.assertRaises(KeyboardInterrupt):
                        checker.check_subscription(writer_factory=lambda: instance)
                else:
                    result = checker.check_subscription(writer_factory=lambda: instance)
                    self.assertEqual(result['status'], 'subscription_timeout')
                    self.assertEqual(result['call_count'], 1)
                self.assertTrue(instance._closed)
                self.assertTrue(all(not Path(call['cwd']).exists() for call in runner.calls))

    def test_constructor_failures_are_fixed_metadata_and_do_not_call_any_transport(self):
        for error in (GenerationError('codex_writer_configuration'), RuntimeError('sk-private-error')):
            with self.subTest(error=type(error).__name__):
                result = checker.check_subscription(writer_factory=lambda: (_ for _ in ()).throw(error))
                self.assertFalse(result['verified'])
                self.assertEqual(result['call_count'], 0)
                self.assertNotIn('sk-private', json.dumps(result))

    def test_live_cli_flag_is_explicit_and_exit_status_matches_verification(self):
        for status, verified, code in (('subscription_verified', True, 0), ('subscription_timeout', False, 1)):
            result = {'status': status, 'verified': verified, 'call_count': 1}
            with self.subTest(status=status), patch.object(checker, 'check_subscription', return_value=result) as live, \
                    redirect_stdout(io.StringIO()) as output:
                self.assertEqual(checker.main(['--check-live']), code)
                live.assert_called_once_with()
                self.assertEqual(json.loads(output.getvalue()), result)


if __name__ == '__main__':
    unittest.main()

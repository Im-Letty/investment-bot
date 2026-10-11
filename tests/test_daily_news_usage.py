"""No sockets: account for each HTTP before editorial response validation."""
from copy import deepcopy
import io
import json
import unittest
from unittest.mock import Mock, patch

import requests
import daily_news_producer as shared


class Abort(BaseException):
    pass


class Raw(io.BytesIO):
    def read1(self, size, *, decode_content=True):
        return super().read1(size)


class Response:
    def __init__(self, value=None, *, status=200, raw=None):
        self.status_code = status
        self.raw = Raw(json.dumps(value).encode()) if raw is None else raw

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass


class Recorder:
    def __init__(self):
        self.events = []

    def start_request(self, **record):
        self.events.append(('start', deepcopy(record)))

    def record_request(self, **record):
        self.events.append(('finish', deepcopy(record)))


def gemini(*, text='{}', finish='STOP', usage=None):
    value = {'candidates': [{'finishReason': finish, 'content': {'parts': [{'text': text}]}}]}
    if usage is not None:
        value['usageMetadata'] = usage
    return value


def openai(*, status='completed', usage=None, tier=None):
    value = {'status': status, 'output': [
        {'type': 'message', 'role': 'assistant', 'status': 'completed',
         'content': [{'type': 'output_text', 'text': '{}'}]}]}
    if usage is not None:
        value['usage'] = usage
    if tier is not None:
        value['service_tier'] = tier
    return value


class UsageTests(unittest.TestCase):
    def setUp(self):
        blocker = patch('requests.sessions.Session.request', side_effect=AssertionError('network disabled'))
        blocker.start()
        self.addCleanup(blocker.stop)
        self.recorder = Recorder()
        self.session = Mock()
        self.provider = shared.Providers({'GEMINI_API_KEY': 'private-key',
            'OPENAI_API_KEY': 'private-key'}, self.session, usage_recorder=self.recorder)

    def replies(self, *values):
        self.session.post.side_effect = [Response(value) for value in values]

    def finishes(self):
        return [record for event, record in self.recorder.events if event == 'finish']

    def assert_pair(self):
        self.assertEqual([name for name, _ in self.recorder.events], ['start', 'finish'])
        started, finished = [record for _, record in self.recorder.events]
        self.assertRegex(started['request_id'], r'^[a-f0-9]{32}$')
        self.assertEqual(started['request_id'], finished['request_id'])
        return finished

    def test_gemini_records_safe_numeric_usage_without_input_or_headers(self):
        usage = {'promptTokenCount': 100, 'candidatesTokenCount': 20,
                 'cachedContentTokenCount': 0, 'thoughtsTokenCount': 3,
                 'toolUsePromptTokenCount': 0, 'totalTokenCount': 123,
                 'serviceTier': 'STANDARD', 'text': 'private-response',
                 'promptTokensDetails': [{'text': 'private-body'}]}
        self.replies(gemini(usage=usage))
        self.assertEqual(self.provider.gemini('private-instruction', {'body': 'private-body'}), {})
        record = self.assert_pair()
        self.assertEqual(record['model'], 'gemini-2.5-flash')
        self.assertEqual(record['service_tier'], 'STANDARD')
        self.assertEqual(set(record['usage']), set(usage) - {'serviceTier', 'text', 'promptTokensDetails'})
        self.assertEqual(record['usage']['cachedContentTokenCount'], 0)
        self.assertNotIn('private-', json.dumps(self.recorder.events))

    def test_openai_records_cached_write_and_reasoning_without_response_body(self):
        usage = {'input_tokens': 100, 'output_tokens': 20, 'total_tokens': 120,
                 'input_tokens_details': {'cached_tokens': 5, 'cache_write_tokens': 7, 'key': 'private-key'},
                 'output_tokens_details': {'reasoning_tokens': 4, 'text': 'private-text'},
                 'instructions': 'private-instruction'}
        self.replies(openai(usage=usage, tier='flex'))
        self.assertEqual(self.provider.openai('private-instruction', {}), {})
        record = self.assert_pair()
        self.assertEqual(record['model'], 'gpt-6-luna')
        self.assertEqual(record['service_tier'], 'flex')
        self.assertEqual(record['usage']['input_tokens_details'], {'cached_tokens': 5, 'cache_write_tokens': 7})
        self.assertEqual(record['usage']['output_tokens_details'], {'reasoning_tokens': 4})
        self.assertNotIn('private-', json.dumps(self.recorder.events))

    def test_gemini_max_tokens_retry_records_two_distinct_http_requests(self):
        self.replies(gemini(finish='MAX_TOKENS', usage={'promptTokenCount': 100, 'candidatesTokenCount': 6000}),
                     gemini(usage={'promptTokenCount': 100, 'candidatesTokenCount': 30}))
        self.assertEqual(self.provider.gemini('fixture', {}), {})
        records = self.finishes()
        self.assertEqual([event for event, _ in self.recorder.events], ['start', 'finish', 'start', 'finish'])
        self.assertEqual([row['usage']['candidatesTokenCount'] for row in records], [6000, 30])
        self.assertNotEqual(records[0]['request_id'], records[1]['request_id'])
        self.assertEqual(self.session.post.call_count, 2)

    def test_semantic_and_draft_failures_keep_known_http_usage(self):
        for route, value, error in (
            ('gemini', gemini(finish='SAFETY', usage={'promptTokenCount': 7}), 'gemini_review_safety'),
            ('gemini', gemini(text='not JSON', usage={'promptTokenCount': 7}), 'invalid_provider_json'),
            ('openai', openai(status='incomplete', usage={'input_tokens': 7}), 'openai_incomplete')):
            with self.subTest(error=error):
                self.recorder.events.clear()
                self.replies(value)
                with self.assertRaisesRegex(shared.GenerationError, '^' + error + '$'):
                    getattr(self.provider, route)('fixture', {})
                record = self.assert_pair()
                self.assertIsNotNone(record['usage'])

    def test_missing_or_empty_usage_is_unknown_and_does_not_become_zero(self):
        for value in (gemini(), gemini(usage={}), openai(), openai(usage={})):
            with self.subTest(value=value):
                self.recorder.events.clear()
                self.replies(value)
                method = self.provider.gemini if 'candidates' in value else self.provider.openai
                self.assertEqual(method('fixture', {}), {})
                self.assertIsNone(self.assert_pair()['usage'])

    def test_malformed_known_numeric_fields_make_entire_usage_unknown(self):
        invalid = (True, -1, 1.5, '7', None, 2 ** 63)
        for value in invalid:
            for route, usage in (
                ('gemini', {'promptTokenCount': 10, 'thoughtsTokenCount': value}),
                ('openai', {'input_tokens': 10, 'output_tokens': value}),
                ('openai', {'input_tokens': 10, 'input_tokens_details': {'cached_tokens': value}})):
                with self.subTest(route=route, value=value):
                    self.recorder.events.clear()
                    self.replies(gemini(usage=usage) if route == 'gemini' else openai(usage=usage))
                    self.assertEqual(getattr(self.provider, route)('fixture', {}), {})
                    self.assertIsNone(self.assert_pair()['usage'])

    def test_partial_usage_keeps_missing_components_absent(self):
        self.replies(openai(usage={'input_tokens': 0}))
        self.provider.openai('fixture', {})
        self.assertEqual(self.assert_pair()['usage'], {'input_tokens': 0})

    def test_unknown_service_tier_is_fixed_marker_not_an_assumed_default(self):
        for route, tier in (('gemini', 'private-tier'), ('openai', 'private-tier'), ('openai', 7)):
            with self.subTest(route=route, tier=tier):
                self.recorder.events.clear()
                self.replies(gemini(usage={'promptTokenCount': 1, 'serviceTier': tier})
                             if route == 'gemini' else openai(usage={'input_tokens': 1}, tier=tier))
                getattr(self.provider, route)('fixture', {})
                self.assertEqual(self.assert_pair()['service_tier'], 'unknown')
                self.assertNotIn('private-tier', json.dumps(self.recorder.events))

    def test_gemini_documented_unspecified_tier_remains_distinct(self):
        self.replies(gemini(usage={'promptTokenCount': 1, 'serviceTier': 'SERVICE_TIER_UNSPECIFIED'}))
        self.provider.gemini('fixture', {})
        self.assertEqual(self.assert_pair()['service_tier'], 'SERVICE_TIER_UNSPECIFIED')

    def test_http_error_timeout_and_invalid_transport_json_record_unknown_once(self):
        failures = (Response({}, status=429), requests.Timeout('private-response'),
                    Response(raw=Raw(b'{')))
        for failure in failures:
            with self.subTest(failure=type(failure).__name__):
                self.recorder.events.clear()
                self.session.post.side_effect = failure if isinstance(failure, Exception) else [failure]
                with self.assertRaises(shared.GenerationError):
                    self.provider.gemini('fixture', {})
                self.assertIsNone(self.assert_pair()['usage'])
                self.assertNotIn('private-response', json.dumps(self.recorder.events))

    def test_forced_interruption_records_unknown_and_preserves_base_exception(self):
        raw = Mock()
        raw.read1.side_effect = Abort()
        self.session.post.side_effect = [Response(raw=raw)]
        with self.assertRaises(Abort):
            self.provider.gemini('fixture', {})
        self.assertIsNone(self.assert_pair()['usage'])

    def test_expired_before_http_has_no_start_or_finish(self):
        token = shared._generation_deadline.set(0)
        try:
            with self.assertRaisesRegex(shared.GenerationError, '^generation_deadline$'):
                self.provider.gemini('fixture', {})
        finally:
            shared._generation_deadline.reset(token)
        self.assertFalse(self.recorder.events)
        self.session.post.assert_not_called()

    def test_recorder_failures_flag_failure_without_retry_or_changing_editorial_result(self):
        for method in ('start_request', 'record_request'):
            with self.subTest(method=method):
                recorder = Recorder()
                setattr(recorder, method, Mock(side_effect=RuntimeError('private-record-error')))
                provider = shared.Providers({'OPENAI_API_KEY': 'private-key'}, self.session,
                                            usage_recorder=recorder)
                self.session.post.reset_mock()
                self.replies(openai(usage={'input_tokens': 1, 'output_tokens': 2}))
                self.assertEqual(provider.openai('fixture', {}), {})
                self.assertTrue(provider.usage_recording_failed)
                self.session.post.assert_called_once()

    def test_finish_signal_does_not_attempt_a_second_finish(self):
        self.recorder.record_request = Mock(side_effect=Abort())
        self.replies(gemini(usage={'promptTokenCount': 1}))
        with self.assertRaises(Abort):
            self.provider.gemini('fixture', {})
        self.recorder.record_request.assert_called_once()

    def test_model_or_header_secrets_are_not_passed_to_the_recorder(self):
        self.replies(openai(usage={'input_tokens': 1}))
        self.provider._post('https://example.test', {'Authorization': 'private-key'},
                            {'model': 'sk-private-key', 'input': 'private-body'}, 'openai')
        self.assertIsNone(self.assert_pair()['model'])
        self.assertNotIn('private-', json.dumps(self.recorder.events))

    def test_absent_recorder_keeps_existing_response_and_transport_behavior(self):
        provider = shared.Providers({}, self.session)
        self.replies(gemini())
        self.assertEqual(provider.gemini('fixture', {}), {})
        self.assertFalse(provider.usage_recording_failed)
        self.session.post.assert_called_once()


if __name__ == '__main__':
    unittest.main()

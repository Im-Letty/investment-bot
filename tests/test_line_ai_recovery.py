"""LINE recovery integration without importing the app or sending any requests."""

import ast
from copy import deepcopy
from datetime import datetime, timedelta
from pathlib import Path
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from line_language import language_command, normalize_language
from line_news import format_news_reply, is_news_request
from news_cache import select_daily_news


ROOT = Path(__file__).parents[1]
NOW = datetime.fromisoformat('2026-10-04T03:00:00+00:00').timestamp()
RECIPIENT = 'mock-private-recipient'
RAW_ERROR = (
    "Error code: 400 - {'error': {'message': 'Your credit balance is too low to access "
    "the Anthropic API', 'type': 'invalid_request_error'}, "
    "'request_id': 'req-private-123', 'payload': 'provider-private-payload', "
    "'recipient': 'mock-private-recipient'}"
)


def load_functions(context):
    names = {'handle_message', 'get_message', 'get_news_summary', 'line_ai_response',
             'generate_morning_report', 'notify_admin'}
    nodes = [node for node in ast.parse((ROOT / 'line_bot.py').read_text()).body
             if isinstance(node, ast.FunctionDef) and node.name in names]
    assert {node.name for node in nodes} == names
    for node in nodes:
        node.decorator_list = []
    exec(compile(ast.Module(body=nodes, type_ignores=[]),
                 '<isolated-line-ai-recovery>', 'exec'), context)
    return context


class ApiClientStub:
    def __init__(self, _configuration):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def article(number=1, *, age=3600, source='NHK経済'):
    return {'source': source, 'title': f'確認済み経済ニュース{number}',
            'url': f'https://news.example/article-{number}', 'published_at': NOW - age}


def snapshot(items=None, *, failed=False):
    labels = ('NHK経済', 'NHK株・企業', 'ロイター経済')
    return {'news': [article()] if items is None else items,
            'fetched_at': None if failed else NOW - 10,
            'source_fetched_at': {} if failed else {label: NOW - 10 for label in labels},
            'source_status': {label: 'error' if failed else 'ok' for label in labels},
            'source_stale': {label: False for label in labels},
            'source_refreshing': {label: False for label in labels}, 'refreshing': False}


class RecoveryHarness:
    def __init__(self, language='ja', raw=None):
        self.api = SimpleNamespace(reply_message=Mock(), push_message=Mock())
        self.clock = Mock(return_value=1000.0)
        self.context = {
            'normalize_language': normalize_language, 'language_command': language_command,
            'is_news_request': is_news_request, 'format_news_reply': format_news_reply,
            'get_user_lang': Mock(return_value=language), 'set_user_lang': Mock(return_value=True),
            'ApiClient': ApiClientStub, 'configuration': object(),
            'MessagingApi': lambda _: self.api, 'ReplyMessageRequest': SimpleNamespace,
            'PushMessageRequest': SimpleNamespace, 'TextMessage': SimpleNamespace,
            '_line_admin_command': Mock(return_value=False), 'ADMIN_USER_ID': 'mock-admin',
            '_admin_error_notices': {}, '_admin_error_notice_lock': threading.Lock(),
            'time': SimpleNamespace(monotonic=self.clock), 'datetime': datetime,
            'timedelta': timedelta, 'print': Mock(),
            'detect_intent': Mock(return_value='question'),
            'answer_question': Mock(return_value='通常の回答'),
            '_generate_morning_report': Mock(return_value='通常の朝レター'),
            'send_line_message': Mock(), 'get_user': Mock(return_value={}), 'save_user': Mock(),
            'news_cache': SimpleNamespace(snapshot=Mock(return_value=snapshot() if raw is None else raw)),
            'news_translations': SimpleNamespace(snapshot=Mock(side_effect=lambda rows, lang: (deepcopy(rows), False))),
            'select_daily_news': Mock(side_effect=lambda data, **kwargs: select_daily_news(data, now=NOW, **kwargs)),
            # These must never be used by the no-AI news route.
            'translate_news_items': Mock(side_effect=AssertionError('legacy synchronous translation called')),
            'get_anthropic_client': Mock(side_effect=AssertionError('AI client requested')),
            'anthropic': Mock(),
        }
        load_functions(self.context)

    def send(self, text):
        event = SimpleNamespace(message=SimpleNamespace(text=text), reply_token='mock-reply',
                                source=SimpleNamespace(user_id=RECIPIENT))
        self.context['handle_message'](event)

    def reply(self):
        return self.api.reply_message.call_args.args[0].messages[0].text

    def summary(self, lang='ja', **kwargs):
        return self.context['get_news_summary'](lang, **kwargs)


class LineRecoveryTests(unittest.TestCase):
    def assert_no_private_error(self, text):
        for secret in ('credit balance', 'invalid_request_error', 'req-private-123',
                       'provider-private-payload', RECIPIENT, 'request_id', 'Error code:'):
            self.assertNotIn(secret, text)

    def test_natural_news_requests_bypass_ai_detection_and_generation(self):
        for text in ('今日のニュース', '今日の経済ニュース', 'ニュースを教えて'):
            with self.subTest(text=text):
                app = RecoveryHarness()
                app.context['detect_intent'].side_effect = RuntimeError(RAW_ERROR)
                app.send(text)
                self.assertIn('確認済み経済ニュース1', app.reply())
                self.assertIn('https://news.example/article-1', app.reply())
                for name in ('detect_intent', 'answer_question', '_generate_morning_report',
                             'get_anthropic_client', 'translate_news_items', 'send_line_message', 'set_user_lang'):
                    app.context[name].assert_not_called()
                self.assertEqual(app.context['anthropic'].mock_calls, [])
                app.api.push_message.assert_not_called()

    def test_intent_credit_failure_returns_a_short_localized_reply(self):
        for lang in ('ja', 'en', 'ko', 'zh'):
            with self.subTest(lang=lang):
                app = RecoveryHarness(lang)
                app.context['detect_intent'].side_effect = RuntimeError(RAW_ERROR)
                app.send('NISAについて知りたい')
                self.assertEqual(app.reply(), app.context['get_message'](lang, 'ai_unavailable'))
                self.assertLess(len(app.reply()), 300)
                self.assert_no_private_error(app.reply())
                app.context['answer_question'].assert_not_called()
                app.context['send_line_message'].assert_not_called()
                app.context['set_user_lang'].assert_not_called()

    def test_answer_failure_pushes_localized_guidance_after_waiting_reply(self):
        for lang in ('ja', 'en', 'ko', 'zh'):
            with self.subTest(lang=lang):
                app = RecoveryHarness(lang)
                app.context['answer_question'].side_effect = RuntimeError(RAW_ERROR)
                app.send('NISAとは何ですか')
                self.assertEqual(app.reply(), app.context['get_message'](lang, 'waiting'))
                guidance = app.context['get_message'](lang, 'ai_unavailable')
                app.context['send_line_message'].assert_called_once_with(guidance, user_id=RECIPIENT)
                self.assert_no_private_error(guidance)

    def test_morning_ai_failure_sends_a_labeled_headlines_fallback(self):
        for lang in ('ja', 'en', 'ko', 'zh'):
            for text, natural in [('朝レター', False), ('今日の朝のレターを読みたい', True)]:
                with self.subTest(lang=lang, text=text):
                    app = RecoveryHarness(lang)
                    app.context['detect_intent'].return_value = 'morning'
                    app.context['_generate_morning_report'].side_effect = RuntimeError(RAW_ERROR)
                    app.send(text)
                    self.assertEqual(app.reply(), app.context['get_message'](lang, 'waiting_morning'))
                    sent = app.context['send_line_message'].call_args.args[0]
                    self.assertTrue(sent.startswith(app.context['get_message'](lang, 'morning_headlines_fallback')))
                    self.assertIn('https://news.example/article-1', sent)
                    self.assert_no_private_error(sent)
                    app.context['_generate_morning_report'].assert_called_once_with(lang)
                    self.assertEqual(app.context['detect_intent'].call_count, int(natural))

    def test_successful_ai_operation_is_preserved_and_does_not_notify(self):
        app = RecoveryHarness()
        operation, fallback = Mock(return_value='生成済みの説明'), Mock()
        self.assertEqual(app.context['line_ai_response'](operation, 'ja', fallback), '生成済みの説明')
        operation.assert_called_once_with()
        fallback.assert_not_called()
        app.api.push_message.assert_not_called()


class LineNewsSelectionTests(unittest.TestCase):
    def test_summary_uses_only_todays_nhk_economy_articles_and_caps_at_three(self):
        items = [article(index, age=index * 300) for index in range(1, 6)]
        items += [article('yesterday', age=86400), article('future', age=-60),
                  article('other-source', age=30, source='ロイター経済'),
                  article('nhk-other', age=20, source='NHK株・企業')]
        app = RecoveryHarness(raw=snapshot(items))
        text = app.summary(limit=20)
        self.assertIn('2026-10-04', text)
        for number in (1, 2, 3):
            self.assertIn(f'確認済み経済ニュース{number}', text)
            self.assertIn(f'https://news.example/article-{number}', text)
        for omitted in ('ニュース4', 'ニュース5', 'yesterday', 'future', 'other-source', 'nhk-other'):
            self.assertNotIn(omitted, text)
        self.assertEqual(text.count('NHK経済'), 3)
        selected = app.context['select_daily_news'].call_args.kwargs
        self.assertEqual(selected['allowed_sources'], ('NHK経済',))
        self.assertEqual(selected['max_items'], 3)
        self.assertEqual(selected['reviewed_digests'], ())
        self.assertEqual(selected['reviewed_supplements'], ())
        app.context['get_anthropic_client'].assert_not_called()
        app.context['translate_news_items'].assert_not_called()

    def test_cached_translation_is_used_without_losing_original_date_or_link(self):
        app = RecoveryHarness()
        def translate(rows, lang):
            self.assertEqual(lang, 'en')
            return [{**row, 'title': 'Verified economic headline'} for row in rows], False
        app.context['news_translations'].snapshot.side_effect = translate
        text = app.summary(' EN ')
        self.assertIn('Verified economic headline', text)
        self.assertIn('Published: 2026-10-04', text)
        self.assertIn('https://news.example/article-1', text)
        self.assertNotIn('確認済み経済ニュース1', text)
        app.context['translate_news_items'].assert_not_called()

    def test_pending_translation_is_disclosed_without_hiding_available_headlines(self):
        app = RecoveryHarness()
        app.context['news_translations'].snapshot.side_effect = lambda rows, lang: (rows, True)
        text = app.summary('en')
        self.assertIn('translation is pending', text)
        self.assertIn('確認済み経済ニュース1', text)
        self.assertIn('https://news.example/article-1', text)

    def test_cached_original_after_translation_failure_still_discloses_missing_translation(self):
        app = RecoveryHarness()
        # A failed translator can cache the source title and report no work pending.
        app.context['news_translations'].snapshot.side_effect = lambda rows, lang: (deepcopy(rows), False)
        text = app.summary('en')
        self.assertIn('translation is pending', text)
        self.assertIn('確認済み経済ニュース1', text)
        self.assertNotIn('翻訳を準備中', app.summary('ja'))

    def test_all_sources_failed_gives_an_error_without_old_or_fabricated_headlines(self):
        app = RecoveryHarness(raw=snapshot([], failed=True))
        text = app.summary()
        self.assertIn('ニュースを取得できませんでした', text)
        self.assertNotIn('https://', text)
        self.assertNotIn('確認済み', text)
        app.context['get_anthropic_client'].assert_not_called()

    def test_snapshot_timeout_and_translation_failure_return_localized_error_text(self):
        for dependency in ('news_cache', 'news_translations'):
            for lang in ('ja', 'en', 'ko', 'zh'):
                with self.subTest(dependency=dependency, lang=lang):
                    app = RecoveryHarness(lang)
                    app.context[dependency].snapshot.side_effect = TimeoutError('mock transport timeout')
                    self.assertEqual(app.summary(lang), app.context['get_message'](lang, 'news_error'))


class AdminNoticeTests(unittest.TestCase):
    def test_credit_notice_is_japanese_and_never_contains_raw_payload_or_user_identifiers(self):
        app = RecoveryHarness()
        app.context['notify_admin']('morning send error to ' + RECIPIENT, RuntimeError(RAW_ERROR))
        request = app.api.push_message.call_args.args[0]
        self.assertEqual(request.to, 'mock-admin')
        body = request.messages[0].text
        self.assertIn('利用残高が不足', body)
        self.assertIn('日本時間', body)
        LineRecoveryTests().assert_no_private_error(body)
        self.assertNotIn('morning send error', body)

    def test_generic_error_notice_also_redacts_provider_text_and_recipient(self):
        app = RecoveryHarness()
        app.context['notify_admin']('failure for ' + RECIPIENT,
                                    RuntimeError('request_id=req-private-123 provider-private-payload'))
        body = app.api.push_message.call_args.args[0].messages[0].text
        self.assertIn('サーバーログで原因を確認', body)
        LineRecoveryTests().assert_no_private_error(body)

    def test_matching_credit_notices_are_suppressed_for_fifteen_minutes(self):
        app = RecoveryHarness()
        for at in (1000.0, 1001.0, 1899.9, 1900.0):
            app.clock.return_value = at
            app.context['notify_admin']('different request at ' + str(at), RuntimeError(RAW_ERROR))
        self.assertEqual(app.api.push_message.call_count, 2)

    def test_notice_delivery_failure_cannot_replace_the_user_fallback_with_an_exception(self):
        app = RecoveryHarness()
        app.api.push_message.side_effect = RuntimeError('mock LINE outage')
        failed = Mock(side_effect=RuntimeError(RAW_ERROR))
        self.assertEqual(app.context['line_ai_response'](failed),
                         app.context['get_message']('ja', 'ai_unavailable'))


if __name__ == '__main__':
    unittest.main()

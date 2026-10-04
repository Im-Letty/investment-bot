"""Exercise LINE language selection without importing or starting the real app."""

import ast
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from line_language import language_command, normalize_language


ROOT = Path(__file__).parents[1]
SOURCE = (ROOT / 'line_bot.py').read_text(encoding='utf-8')


def load_functions(names, context):
    nodes = [node for node in ast.parse(SOURCE).body
             if isinstance(node, ast.FunctionDef) and node.name in names]
    for node in nodes:
        node.decorator_list = []
    exec(compile(ast.Module(body=nodes, type_ignores=[]),
                 '<isolated-line-functions>', 'exec'), context)
    return context


class ApiClientStub:
    def __init__(self, configuration):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class MessageHarness:
    def __init__(self, stored='ja', save_succeeds=True, intent='question'):
        self.stored = stored
        self.api = SimpleNamespace(reply_message=Mock())

        def save_language(_recipient, language):
            if save_succeeds:
                self.stored = language
            return save_succeeds

        self.context = {
            'normalize_language': normalize_language,
            'language_command': language_command,
            'get_user_lang': Mock(side_effect=lambda _: self.stored),
            'set_user_lang': Mock(side_effect=save_language),
            'ApiClient': ApiClientStub,
            'configuration': object(),
            'MessagingApi': lambda _: self.api,
            'ReplyMessageRequest': SimpleNamespace,
            'TextMessage': SimpleNamespace,
            '_line_admin_command': Mock(return_value=False),
            'get_message': Mock(side_effect=lambda lang, key: f'{lang}:{key}'),
            'get_user_delivery_hour': Mock(return_value=8),
            'build_settings_text': Mock(side_effect=lambda lang, hour: f'{lang}:settings:{hour}'),
            'get_market_summary': Mock(side_effect=lambda lang: f'{lang}:market'),
            'get_news_summary': Mock(side_effect=lambda lang: f'{lang}:news'),
            'get_fx_summary': Mock(side_effect=lambda lang: f'{lang}:fx'),
            'get_compound_calc': Mock(side_effect=lambda args, lang: f'{lang}:calc'),
            'get_savings_calc': Mock(side_effect=lambda args, lang: f'{lang}:savings'),
            'set_user_delivery_hour': Mock(return_value=True),
            'get_stock_price': Mock(side_effect=lambda symbol, lang: f'{lang}:price'),
            'detect_intent': Mock(return_value=intent),
            'generate_morning_report': Mock(side_effect=lambda lang='ja': f'{lang}:report'),
            'send_line_message': Mock(),
            'get_user': Mock(return_value={}),
            'answer_question': Mock(side_effect=lambda text, user, lang: f'{lang}:answer'),
            'save_user': Mock(),
        }
        # Including the legacy detector lets the same tests reproduce old behavior.
        load_functions({'handle_message', 'detect_language'}, self.context)

    def send(self, text):
        event = SimpleNamespace(message=SimpleNamespace(text=text),
                                reply_token='mock-reply-token',
                                source=SimpleNamespace(user_id='mock-recipient'))
        self.context['handle_message'](event)

    def reply(self):
        return self.api.reply_message.call_args.args[0].messages[0].text


class LanguageCommandTests(unittest.TestCase):
    def test_supported_saved_values_are_normalized_without_guessing(self):
        for value, expected in [('ja', 'ja'), (' EN ', 'en'), ('Ko', 'ko'), ('zh', 'zh'),
                                (None, 'ja'), ('', 'ja'), ('fr', 'ja'), (7, 'ja'),
                                ({'lang': 'en'}, 'ja')]:
            with self.subTest(value=value):
                self.assertEqual(normalize_language(value), expected)

    def test_explicit_language_commands_and_readable_aliases(self):
        cases = {
            'lang ja': 'ja', ' LANG EN ': 'en', 'lang ko': 'ko', 'lang zh': 'zh',
            'ＬＡＮＧ　ＪＡ': 'ja', '日本語': 'ja', '日本語にして': 'ja',
            '日本語にしてください': 'ja', '日本語で': 'ja', '日本語に変更': 'ja',
            '日本語に変更して': 'ja', '日本語に変更してください': 'ja',
            'english': 'en', 'Ｅｎｇｌｉｓｈ': 'en', '英語': 'en',
            '한국어': 'ko', '韓国語': 'ko', '中文': 'zh', '中国語': 'zh',
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(language_command(text), expected)

    def test_ordinary_text_or_invalid_commands_are_not_language_requests(self):
        for text in ['7203', 'AAPL', 'NISA', '2026', '投資信託', 'news', 'help',
                     'lang xx', 'lang', 'lang en please', 'please lang ja',
                     '日本語のニュースを教えて', 'English news', '']:
            with self.subTest(text=text):
                self.assertIsNone(language_command(text))


class MessageLanguageTests(unittest.TestCase):
    def test_numbers_symbols_and_kanji_do_not_overwrite_japanese(self):
        for text in ['7203', 'AAPL', 'NISA', '2026', '投資信託', '💹💹💹💹']:
            with self.subTest(text=text):
                app = MessageHarness('ja')
                app.send(text)
                app.context['set_user_lang'].assert_not_called()
                self.assertEqual(app.stored, 'ja')
                self.assertEqual(app.context['answer_question'].call_args.args[-1], 'ja')
                # Conversation storage must not smuggle a language update.
                self.assertNotIn('lang', app.context['save_user'].call_args.args[1])

    def test_existing_non_japanese_preferences_survive_japanese_input(self):
        for language in ('en', 'ko', 'zh'):
            with self.subTest(language=language):
                app = MessageHarness(language)
                app.send('今日の相場を教えて')
                app.context['set_user_lang'].assert_not_called()
                self.assertEqual(app.context['answer_question'].call_args.args[-1], language)
                self.assertEqual(app.stored, language)

    def test_all_ordinary_commands_use_the_saved_language_without_changing_it(self):
        commands = ['help', 'settings', 'market', 'news', 'forex', 'morning',
                    'calc 10000 5 10', 'howmuch 1000000 30 5', 'delivery 8',
                    'price AAPL', 'ニュース', '朝レター', '設定', '株価 7203']
        for language in ('ja', 'en', 'ko', 'zh'):
            for command in commands:
                with self.subTest(language=language, command=command):
                    app = MessageHarness(language)
                    app.send(command)
                    app.context['set_user_lang'].assert_not_called()
                    self.assertEqual(app.stored, language)
                    self.assertTrue(app.reply().startswith(language + ':'), app.reply())
                    if command in ('morning', '朝レター'):
                        app.context['generate_morning_report'].assert_called_once_with(language)

    def test_new_user_replies_in_japanese_without_automatically_saving_it(self):
        app = MessageHarness(None)
        app.send('AAPL')
        self.assertIsNone(app.stored)
        app.context['set_user_lang'].assert_not_called()
        self.assertEqual(app.context['answer_question'].call_args.args[-1], 'ja')

    def test_failed_preference_read_does_not_overwrite_existing_english(self):
        app = MessageHarness('en')
        app.context['get_user_lang'] = Mock(return_value=None)
        app.send('AAPL')
        self.assertEqual(app.stored, 'en')
        app.context['set_user_lang'].assert_not_called()
        self.assertNotIn('lang', app.context['save_user'].call_args.args[1])
        self.assertEqual(app.context['answer_question'].call_args.args[-1], 'ja')

    def test_invalid_saved_language_falls_back_to_japanese(self):
        for value in ('fr', 7):
            with self.subTest(value=value):
                app = MessageHarness(value)
                app.send('AAPL')
                self.assertEqual(app.context['answer_question'].call_args.args[-1], 'ja')

    def test_explicit_request_updates_preference_and_confirms_requested_language(self):
        for command, language in [('lang ja', 'ja'), ('lang en', 'en'),
                                  ('lang ko', 'ko'), ('lang zh', 'zh'),
                                  ('日本語にしてください', 'ja'), ('ＬＡＮＧ　ＪＡ', 'ja')]:
            with self.subTest(command=command):
                app = MessageHarness('en')
                app.send(command)
                self.assertEqual(app.stored, language)
                self.assertEqual(app.reply(), language + ':lang_changed')
                self.assertEqual(app.context['set_user_lang'].call_count, 1)
                app.context['detect_intent'].assert_not_called()

    def test_language_save_failure_does_not_claim_success_or_change_preference(self):
        app = MessageHarness('en', save_succeeds=False)
        app.send('日本語にしてください')
        self.assertEqual(app.stored, 'en')
        self.assertEqual(app.reply(), 'ja:lang_save_error')
        app.context['detect_intent'].assert_not_called()
        app.context['send_line_message'].assert_not_called()

    def test_invalid_language_request_does_not_save_a_new_preference(self):
        app = MessageHarness('ja')
        app.send('lang xx')
        app.context['set_user_lang'].assert_not_called()
        self.assertEqual(app.stored, 'ja')

    def test_japanese_recovery_sticks_for_a_subsequent_morning_command(self):
        app = MessageHarness('en')
        app.send('日本語にしてください')
        app.context['set_user_lang'].reset_mock()
        app.send('morning')
        self.assertEqual(app.stored, 'ja')
        app.context['set_user_lang'].assert_not_called()
        app.context['generate_morning_report'].assert_called_once_with('ja')

    def test_natural_language_morning_request_passes_each_saved_language(self):
        for language in ('ja', 'en', 'ko', 'zh'):
            with self.subTest(language=language):
                app = MessageHarness(language, intent='morning')
                app.send('今日の朝のレターを読みたい')
                app.context['set_user_lang'].assert_not_called()
                app.context['generate_morning_report'].assert_called_once_with(language)


class LanguagePersistenceTests(unittest.TestCase):
    def test_set_user_lang_reports_real_storage_success_or_failure(self):
        save = Mock()
        context = load_functions({'set_user_lang'}, {'save_user': save, 'print': Mock()})
        self.assertIs(context['set_user_lang']('mock-recipient', 'ja'), True)
        self.assertEqual(save.call_args.args[-1], {'lang': 'ja'})
        save.side_effect = RuntimeError('mock database failure')
        self.assertIs(context['set_user_lang']('mock-recipient', 'ja'), False)

    def test_scheduled_delivery_uses_each_users_saved_language(self):
        values = [('ja', 'ja'), ('en', 'en'), ('ko', 'ko'), ('zh', 'zh'),
                  (' EN ', 'en'), (None, 'ja'), ('fr', 'ja')]
        for saved, expected in values:
            with self.subTest(saved=saved):
                database = Mock()
                database.table.return_value.select.return_value.execute.return_value = SimpleNamespace(
                    data=[{'line_user_id': 'U' + '0' * 32, 'lang': saved, 'delivery_hour': 7}])
                generate = Mock(return_value='mock report')
                push = Mock()
                context = load_functions({'morning'}, {
                    'request': SimpleNamespace(args={'secret': 'mock-secret', 'force': '1'}),
                    'os': SimpleNamespace(environ={'CRON_SECRET': 'mock-secret'}),
                    'datetime': datetime,
                    'normalize_language': normalize_language,
                    'supabase': database,
                    'generate_morning_report': generate,
                    'send_line_message': push,
                    'notify_admin': Mock(),
                    'gc': SimpleNamespace(collect=Mock()),
                    'print': Mock(),
                })
                self.assertIn('sent=1', context['morning']())
                generate.assert_called_once_with(expected)
                self.assertEqual(push.call_count, 1)


if __name__ == '__main__':
    unittest.main()

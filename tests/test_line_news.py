"""Pure news replies stay useful when AI is unavailable; no app/network imports."""

from copy import deepcopy
import unittest

from line_news import format_news_reply, is_news_request


def article(title='国内企業が新たなサービスを発表', *, day='2026-10-04', url=None):
    return {'title': title, 'source': 'NHK経済', 'published_date': day,
            'url': url or 'https://example.test/news/1'}


def selection(news=None, status='ready'):
    return {'edition_date': '2026-10-04', 'news': [article()] if news is None else news,
            'selection_status': status, 'supplements': [], 'digest': None}


class NewsRequestTests(unittest.TestCase):
    def test_common_news_requests_are_recognized_before_ai_routing(self):
        for text in ['ニュース', '今日のニュース', '本日のニュース', '最新ニュース',
                     '今日の経済ニュース', 'ニュースを教えて',
                     '今日のニュースを教えてください', '相場のニュース',
                     'ＮＥＷＳ', '  今日のニュース！？　', 'latest   news.',
                     '뉴스', '오늘의 뉴스', '新聞', '今天的新闻']:
            with self.subTest(text=text):
                self.assertTrue(is_news_request(text))

    def test_general_questions_and_partial_matches_still_reach_normal_routing(self):
        for text in ['ニュースって何？', 'ニュースの見方を教えて',
                     '今日のニュースについて詳しく説明して', 'このニュースは本当？',
                     'news about AAPL', 'what is news?', 'ニュースを教えてください。別の質問も',
                     '朝レター', 'lang ja', 'AAPL', '', None, 123]:
            with self.subTest(text=text):
                self.assertFalse(is_news_request(text))


class NewsReplyTests(unittest.TestCase):
    def test_headline_reply_preserves_source_article_date_and_full_link(self):
        url = 'https://example.test/news/1?edition=2026-10-04&lang=ja#article'
        item = article(day='2026-10-03', url=url)
        reply = format_news_reply(selection([item]))
        self.assertIn('2026-10-04 | ニュース見出し', reply)
        self.assertIn(item['title'], reply)
        self.assertIn('NHK経済 | 発表: 2026-10-03', reply)
        self.assertIn(url, reply.splitlines())
        self.assertNotIn('要約', reply)
        self.assertNotIn('AI分析', reply)

    def test_only_first_three_selected_headlines_are_used_without_supplements(self):
        selected = selection([article(title=f'選択記事{number}', url=f'https://example.test/{number}')
                              for number in range(4)])
        selected['supplements'] = [article(title='過去の補足記事')]
        selected['digest'] = {'headline': '昨日のまとめ', 'summary': '保存済みの解説'}
        original = deepcopy(selected)
        reply = format_news_reply(selected)
        for number in range(3):
            self.assertIn(f'選択記事{number}', reply)
        for excluded in ('選択記事3', '過去の補足記事', '昨日のまとめ', '保存済みの解説'):
            self.assertNotIn(excluded, reply)
        self.assertEqual(selected, original)

    def test_no_current_headlines_does_not_substitute_an_old_digest(self):
        selected = selection([], 'empty_today')
        selected['supplements'] = [article(title='昨日の補足')]
        selected['digest'] = {'headline': '保存された昨日号'}
        reply = format_news_reply(selected)
        self.assertIn('本日発表されたニュースの見出しは、まだ確認できていません。', reply)
        self.assertNotIn('昨日', reply)
        self.assertNotIn('https://', reply)

    def test_empty_loading_and_failure_have_distinct_messages_in_each_language(self):
        expected = {
            'ja': ('まだ確認できていません', '取得しています', '取得できませんでした'),
            'en': ('No headlines published today', 'News is loading', 'News could not be retrieved'),
            'ko': ('아직 확인되지 않았습니다', '불러오고 있습니다', '가져오지 못했습니다'),
            'zh': ('暂未确认', '正在获取新闻', '未能获取新闻'),
        }
        for language, messages in expected.items():
            for status, message in zip(('empty_today', 'refreshing', 'unavailable'), messages):
                with self.subTest(language=language, status=status):
                    reply = format_news_reply(selection([], status), language)
                    self.assertIn(message, reply)
                    self.assertIn('2026-10-04', reply)

    def test_pending_translation_is_disclosed_without_fabricating_translated_titles(self):
        selected = selection([article(title='Original headline')])
        notices = {'ja': '原文の見出し', 'en': 'original language', 'ko': '원문 제목', 'zh': '保留原文'}
        for language, notice in notices.items():
            with self.subTest(language=language):
                pending = format_news_reply(selected, language, translation_pending=True)
                self.assertIn(notice, pending)
                self.assertIn('Original headline', pending)
                self.assertNotIn(notice, format_news_reply(selected, language))

    def test_pathological_titles_and_complete_urls_fit_the_line_message_budget(self):
        url = 'https://example.test/' + 'a' * 879
        self.assertLessEqual(len(url), 900)
        selected = selection([{'title': '見出し' * 2000, 'source': '出典' * 500,
                               'published_date': '2026-10-04', 'url': url} for _ in range(3)])
        for language in ('ja', 'en', 'ko', 'zh'):
            with self.subTest(language=language):
                reply = format_news_reply(selected, language, translation_pending=True)
                self.assertLessEqual(len(reply), 4000)
                self.assertEqual(reply.splitlines().count(url), 3)

    def test_overlong_urls_are_omitted_instead_of_truncated_into_broken_links(self):
        url = 'https://example.test/' + 'x' * 5000
        reply = format_news_reply(selection([article(url=url)]))
        self.assertIn('記事リンクは表示できないため省略しました。', reply)
        self.assertNotIn('https://example.test/', reply)
        self.assertLessEqual(len(reply), 4000)

    def test_unsafe_links_are_not_rendered_as_article_urls(self):
        for url in ['javascript:alert(1)', 'https://example.test/\n別の文章',
                    'https://user:password@example.test/article', 'https://example.test:invalid/']:
            with self.subTest(url=url):
                reply = format_news_reply(selection([article(url=url)]))
                self.assertIn('記事リンクは表示できないため省略しました。', reply)
                self.assertNotIn(url, reply)

    def test_unknown_language_uses_a_japanese_notice(self):
        self.assertIn('ニュースを取得できませんでした',
                      format_news_reply(selection([], 'unavailable'), 'invalid'))


if __name__ == '__main__':
    unittest.main()

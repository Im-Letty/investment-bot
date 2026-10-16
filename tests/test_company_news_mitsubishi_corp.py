"""Fictional JSON/HTML fixtures only; no publisher text or network."""
from datetime import date, datetime
from html import escape
import json
import socket
import unittest
from unittest.mock import patch

import company_news_additional as common

LABEL = '三菱商事'
URL = 'https://www.mitsubishicorp.com/jp/ja/news/release/2026/20261009001.html'
TITLE = '架空の新事業を開発'
NOW = datetime(2026, 10, 10, 12, tzinfo=common.JST)
SINCE = date(2026, 10, 7)
BODY = ('三菱商事株式会社は、検証専用の架空の新事業を開発したという設定です。'
        'この文章は実在する企業発表ではなく、解析の動作を試すために独立して作成したものです。'
        '架空の事業内容と条件を説明しており、実際の取引、商品の提供や投資判断を示すものではありません。')


class Catalogue:
    members = {'8058.T': dict(symbol='8058.T', name=LABEL, business=None, business_sources=[])}
    provenance = {'as_of': '2026-10-01', 'source_sha256': 'b' * 64}
    facts_sha256 = 'a' * 64


def row(**changes):
    result = dict(publishDate1='2026年10月9日', publishDate2='2026-10-09', publishYear='2026',
                  url=URL, title=TITLE, linkIcon='詳細ページ')
    result.update(changes)
    return result


def index(rows=None):
    return json.dumps({'newsReleaseData': [row()] if rows is None else rows}).encode()


def original(body=BODY, day='2026年10月9日', canonical=URL, hidden=''):
    return ('<meta property="og:url" content="' + escape(URL) + '"><link rel="canonical" href="'
            + escape(canonical) + '"><main class="l-main"><header class="p-pagetitle1"><h1 class="p-pagetitle1__hd">'
            + escape(TITLE) + '</h1></header><div class="p-post"><div class="prDate">' + escape(day)
            + '</div><div class="prSubsection"><div class="news-body"><div class="p-txt01" '
            + hidden + '><p>' + escape(body) + '</p></div><hr><div class="p-txt01">PRIVATE CONTACT</div>'
            + '</div></div></div></main><footer>三菱商事株式会社 PRIVATE FOOTER</footer>').encode()


class MitsubishiCorpTests(unittest.TestCase):
    def setUp(self):
        guard = patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden'))
        guard.start()
        self.addCleanup(guard.stop)

    def item(self):
        return common.parse_feed(index(), LABEL, NOW, SINCE, Catalogue())[0]

    def extract(self, payload=None):
        return common.extract_article(original() if payload is None else payload,
            self.item(), URL, NOW, SINCE, catalogue=Catalogue())

    def test_original_parent_body_and_source_day_are_bound_without_a_clock(self):
        result = self.extract()
        self.assertTrue(common.valid_identity(result, Catalogue()))
        self.assertEqual(result['published_date'], '2026-10-09')
        self.assertIsNone(result['published_at'])
        self.assertEqual(result['body'], BODY)
        self.assertEqual(result['publication_evidence']['discovery_format'], 'json_index')

    def test_json_requires_corroborated_day_year_url_and_internal_html_type(self):
        for changes in (dict(publishDate2='2026-10-08'), dict(publishDate1='更新日2026年10月9日'),
                        dict(publishDate1='2026年10月9日 更新'), dict(publishYear='2025'), dict(publishDate2='2026-10-09T12:00:00+09:00'),
                        dict(linkIcon='PDF'), dict(linkIcon='外部サイトページ'), dict(publishDate2=True),
                        dict(url=URL.replace('/2026/20261009', '/2025/20261009')),
                        dict(url=URL + '?x=1'), dict(url=URL.replace('www.mitsubishicorp.com', 'example.test'))):
            self.assertEqual(common.parse_feed(index([row(**changes)]), LABEL, NOW, SINCE, Catalogue()), [])

    def test_json_duplicate_keys_bad_structure_conflicts_and_bound_fail_closed(self):
        for payload in (b'{"newsReleaseData":[],"newsReleaseData":[]}', b'{"newsReleaseData":null}', b'[]', b'{'):
            with self.assertRaises(ValueError):
                common.parse_feed(payload, LABEL, NOW, SINCE, Catalogue())
        self.assertEqual(common.parse_feed(index([row(), row(title='架空の別製品を発売')]), LABEL, NOW, SINCE, Catalogue()), [])
        self.assertEqual(common.parse_feed(index([row(linkIcon='PDF')] * 120 + [row()]), LABEL, NOW, SINCE, Catalogue()), [])

    def test_parent_is_not_inferred_from_footer_later_mention_or_child(self):
        for body in ('株式会社架空子会社は、' + BODY, '架空会社は、三菱商事株式会社と共同で投資。' + BODY,
                     '三菱商事株式会社の子会社は、' + BODY):
            self.assertIsNone(self.extract(original(body=body)))

    def test_original_wrong_day_updated_only_hidden_body_or_wrong_canonical_rejected(self):
        for payload in (original(day='2026年10月10日'), original(day='更新日2026年10月9日'), original(day='2026年10月9日 更新'),
                        original(hidden='hidden'), original(canonical=URL + '#x')):
            self.assertIsNone(self.extract(payload))

    def test_old_source_day_does_not_become_current(self):
        self.assertEqual(common.parse_feed(index(), LABEL, datetime(2026, 10, 17, tzinfo=common.JST),
                                         date(2026, 10, 14), Catalogue()), [])


if __name__ == '__main__':
    unittest.main()

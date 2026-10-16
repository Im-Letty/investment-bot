"""Synthetic markup only; no publisher prose or requests."""
from datetime import date, datetime
from html import escape
import socket
import unittest
from unittest.mock import patch

import company_news_additional as common

LABEL = '小松製作所'
URL = 'https://www.komatsu.jp/ja/newsroom/2026/20261009_1'
TITLE = '架空の建設機械を発売'
NOW = datetime(2026, 10, 10, 12, tzinfo=common.JST)
SINCE = date(2026, 10, 7)
BODY = ('コマツ（社長：架空の検証専用名）は、動作検証に用いる架空の建設機械を発売したという設定です。'
        'この文章は実際の企業発表ではなく、解析と主語判定だけを試験するために独立して作成しました。'
        '導入先や性能も存在しない仮定であり、表示内容と日付を安全に比較するための試験データです。')


class Catalogue:
    members = {'6301.T': dict(symbol='6301.T', name=LABEL, business=None, business_sources=[])}
    provenance = {'as_of': '2026-10-01', 'source_sha256': 'b' * 64}
    facts_sha256 = 'a' * 64


def row(url=URL, day='2026年10月9日', title=TITLE, hidden=''):
    return ('<div ' + hidden + '><dt class="newsList_dt">' + escape(day)
            + '</dt><dd class="newsList_dd"><div class="newsList_dd-inr"><a href="'
            + escape(url) + '">' + escape(title) + '</a></div></dd></div>')


def index(rows=None):
    return ('<div class="cp_NewsList"><div class="newsList_inr"><dl class="newsList_dl">'
            + (row() if rows is None else rows) + '</dl></div></div>').encode()


def original(body=BODY, day='2026年10月9日', canonical=URL, extra=''):
    return ('<meta property="og:url" content="' + escape(URL) + '"><link rel="canonical" href="'
            + escape(canonical) + '"><div id="content cp_base"><div class="cp_PageTitle"><h1>'
            + escape(TITLE) + '</h1></div><div class="headingText1_inr"><div><p>' + escape(day)
            + '</p><p>' + escape(body) + '</p><p>以上</p><p>PRIVATE CONTACT</p></div></div>'
            + extra + '</div><footer>株式会社小松製作所 PRIVATE FOOTER</footer>').encode()


class KomatsuTests(unittest.TestCase):
    def setUp(self):
        guard = patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden'))
        guard.start()
        self.addCleanup(guard.stop)

    def item(self):
        return common.parse_feed(index(), LABEL, NOW, SINCE, Catalogue())[0]

    def extract(self, payload=None):
        return common.extract_article(original() if payload is None else payload,
            self.item(), URL, NOW, SINCE, catalogue=Catalogue())

    def test_parent_alias_preserves_original_body_day_and_null_clock(self):
        result = self.extract()
        self.assertIsNotNone(result)
        self.assertTrue(common.valid_identity(result, Catalogue()))
        self.assertEqual(result['related_company'], 'コマツ')
        self.assertEqual(result['published_date'], '2026-10-09')
        self.assertIsNone(result['published_at'])
        self.assertEqual(result['body'], BODY)

    def test_parenthetical_permission_is_source_specific_and_subject_is_required(self):
        self.assertFalse(common._declared_actor('Honda', 'Honda（架空）は、' + BODY))
        self.assertFalse(common._declared_actor('コマツ', BODY))
        for body in ('コマツの子会社は、' + BODY, 'コマツ子会社（架空）は、' + BODY,
                     '株式会社架空子会社は、' + BODY, '架空会社は、コマツと共同開発。' + BODY,
                     'コマツ（' + 'x' * 251 + '）は、' + BODY,
                     'コマツ（架空（入れ子））は、' + BODY):
            self.assertIsNone(self.extract(original(body=body)))

    def test_conflicting_original_day_url_and_duplicated_dated_body_are_rejected(self):
        for payload in (original(day='2026年10月10日'), original(canonical=URL + '?x=1'),
                        original(day='更新日2026年10月9日'), original(day='2026年10月9日 更新'),
                        original(extra='<div class="headingText1_inr"><div><p>2026年10月9日</p></div></div>')):
            self.assertIsNone(self.extract(payload))

    def test_index_is_bounded_and_rejects_hidden_conflicting_or_foreign_rows(self):
        for rows in (row(day='2026年10月8日'), row(day='2026年10月9日 更新'), row(hidden='hidden'), row(url=URL + '?x=1'),
                     row(url=URL.replace('/2026/20261009', '/2025/20261009')),
                     row(url=URL.replace('www.komatsu.jp', 'example.test')),
                     row() + row(title='架空の別機械を発売')):
            self.assertEqual(common.parse_feed(index(rows), LABEL, NOW, SINCE, Catalogue()), [])
        old = row(url='https://www.komatsu.jp/ja/newsroom/2026/20260901', day='2026年9月1日')
        self.assertEqual(common.parse_feed(index(old * 120 + row()), LABEL, NOW, SINCE, Catalogue()), [])

    def test_source_day_is_not_replaced_with_current_day(self):
        self.assertEqual(common.parse_feed(index(), LABEL, datetime(2026, 10, 17, tzinfo=common.JST),
                                         date(2026, 10, 14), Catalogue()), [])


if __name__ == '__main__':
    unittest.main()

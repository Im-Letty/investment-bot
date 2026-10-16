"""Fictional HTML fixtures only; no publisher prose, images or network."""
from datetime import date, datetime
from html import escape
import socket
import unittest
from unittest.mock import patch

import company_news_additional as common
from company_news_cyberagent import CYBERAGENT_CONFIG

LABEL = 'サイバーエージェント'
URL = 'https://www.cyberagent.co.jp/news/detail/id=12345'
TITLE = '検証用の架空AI技術を共同開発'
DAY = '2026-10-09'
NOW = datetime(2026, 10, 10, 12, tzinfo=common.JST)
SINCE = date(2026, 10, 7)
BODY = ('株式会社サイバーエージェント（所在地は架空、試験専用）は、架空のAI技術を共同開発したという設定です。'
        'この文章は解析試験に使うためだけに作成しており、実際の企業の発表を示すものではありません。'
        '架空の実験条件と検証用の研究内容を説明し、ソフトウェアの動作だけを確認する文章です。')


class Catalogue:
    members = {'4751.T': dict(symbol='4751.T', name=LABEL, business=None, business_sources=[])}
    provenance = {'as_of': '2026-10-01', 'source_sha256': 'b' * 64}
    facts_sha256 = 'a' * 64


def row(*, url=URL, title=TITLE, stated=DAY, visible='2026年10月 9日', hidden=''):
    return ('<li class="m-card" ' + hidden + '><a href="' + escape(url) + '"><div class="m-card_body">'
            '<p class="m-card_date"><time datetime="' + escape(stated) + '">' + escape(visible)
            + '</time></p><p class="m-card_text">' + escape(title) + '</p></div></a></li>')


def index(rows=None):
    return ('<html><main class="l-main" id="main"><div class="newsIndex"><ul class="m-cardGroup">'
            + (row() if rows is None else rows) + '</ul></div></main></html>').encode()


def original(*, body=BODY, title=TITLE, visible='2026年10月 9日', stated=DAY, og=URL, hidden='', extra=''):
    return ('<html><head><meta property="og:url" content="' + escape(og) + '"></head><nav>PRIVATE NAV</nav>'
            '<main class="l-main" id="main"><article class="newsDetail"><header class="newsDetail_header">'
            '<h1 class="newsDetail_header_title">' + escape(title) + '</h1><time datetime="' + escape(stated)
            + '">' + escape(visible) + '</time></header><div class="newsDetail_body">'
            '<div class="newsDetail_body_box" ' + hidden + '><p>' + escape(body) + '</p></div></div>'
            '<footer class="newsDetail_footer_localNav">PRIVATE RELATED</footer></article></main>'
            '<footer>株式会社サイバーエージェント PRIVATE FOOTER</footer>' + extra + '</html>').encode()


class CyberAgentTests(unittest.TestCase):
    def setUp(self):
        self.catalogue = Catalogue()
        network = patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden'))
        network.start()
        self.addCleanup(network.stop)

    def item(self):
        items = common.parse_feed(index(), LABEL, NOW, SINCE, self.catalogue)
        self.assertEqual(len(items), 1)
        return items[0]

    def extract(self, payload=None):
        return common.extract_article(original() if payload is None else payload,
            self.item(), URL, NOW, SINCE, catalogue=self.catalogue)

    def test_visible_and_stated_day_parent_subject_and_body_are_bound(self):
        result = self.extract()
        self.assertIsNotNone(result)
        self.assertEqual(result['published_date'], DAY)
        self.assertIsNone(result['published_at'])
        self.assertEqual(result['publication_precision'], 'day')
        self.assertEqual(result['body_verified_at'], NOW.timestamp())
        self.assertTrue(common.valid_identity(result, self.catalogue))
        for text in ('PRIVATE NAV', 'PRIVATE RELATED', 'PRIVATE FOOTER'):
            self.assertNotIn(text, result['body'])

    def test_original_day_conflicts_missing_or_updated_only_are_rejected(self):
        for payload in (original(visible='2026年10月10日'), original(stated='2026-10-10'),
                        original(visible='更新日2026年10月9日'), original(stated=''),
                        original(stated='2026-10-09T12:00:00+09:00')):
            self.assertIsNone(self.extract(payload))

    def test_parent_is_not_inferred_from_footer_or_a_later_mention(self):
        for body in ('株式会社架空子会社は、' + BODY,
                     '架空の研究者は、株式会社サイバーエージェントと共同開発しました。' + BODY):
            self.assertIsNone(self.extract(original(body=body)))

    def test_hidden_body_and_wrong_page_or_heading_fail_closed(self):
        for payload in (original(hidden='hidden'), original(og=URL + '#body'),
                        original(title='別の架空AI技術を開発'), original(extra='<main id="main" class="l-main"></main>')):
            self.assertIsNone(self.extract(payload))

    def test_index_rejects_conflicts_hidden_rows_and_unknown_urls(self):
        for rows in (row(stated='2026-10-10'), row(visible='更新日2026年10月9日'), row(hidden='hidden'),
                     row(url=URL + '?x=1'), row(url=URL.replace('www.cyberagent.co.jp', 'example.test')),
                     row() + row(stated='2026-10-08', visible='2026年10月8日')):
            self.assertEqual(common.parse_feed(index(rows), LABEL, NOW, SINCE, self.catalogue), [])

    def test_old_and_future_source_days_do_not_become_current(self):
        self.assertEqual(common.parse_feed(index(row(stated='2026-10-11', visible='2026年10月11日')),
                                     LABEL, NOW, SINCE, self.catalogue), [])
        later = datetime(2026, 10, 17, 12, tzinfo=common.JST)
        self.assertEqual(common.parse_feed(index(), LABEL, later, date(2026, 10, 14), self.catalogue), [])


if __name__ == '__main__':
    unittest.main()

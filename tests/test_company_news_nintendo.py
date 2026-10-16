"""Fictional text only; safe adaptation to the existing common parser."""
from datetime import date, datetime
from html import escape
import socket
import unittest
from unittest.mock import patch

import company_news_additional as common
from company_news_nintendo import NINTENDO_CONFIG, article_layout, normalize_feed_payload

LABEL = '任天堂'
URL = 'https://www.nintendo.co.jp/corporate/release/2026/261006.html'
TITLE = '架空の試験用ソフトを発売'
NOW = datetime(2026, 10, 7, 12, tzinfo=common.JST)
SINCE = date(2026, 10, 4)
BODY = ('この文章は解析試験だけのために用意した架空の文章です。実際の企業発表ではありません。'
        '検証用のソフトと架空の発売条件を説明するという設定であり、実際の販売情報ではありません。'
        'テストでは原文の発表主体、可視日付、見出し、本文の対応を確認しています。')


class Catalogue:
    members = {'7974.T': dict(symbol='7974.T', name=LABEL, business=None, business_sources=[])}
    provenance = {'as_of': '2026-10-01', 'source_sha256': 'b' * 64}
    facts_sha256 = 'a' * 64


def feed(*, title=None, url=URL, published='Tue, 6 Oct 2026 10:00:38 +0900', extra=''):
    title = 'ニュースリリース「' + TITLE + '」を公開しました。' if title is None else title
    return ('<rss><channel><item><title>' + escape(title) + '</title><link>' + escape(url)
            + '</link>' + ('<pubDate>' + published + '</pubDate>' if published else '')
            + extra + '</item></channel></rss>').encode()


def original(*, actor='任天堂株式会社', visible='2026年10月6日', title=TITLE,
             og=URL, body=BODY, extra='', hidden=''):
    return ('<html><head><meta property="og:url" content="' + escape(og) + '"></head>'
            '<nav>PRIVATE NAV</nav><div id="nr_body"><div class="nr-headdata">'
            '<p class="ta_r">' + escape(visible) + '</p><p>各位</p><p class="ta_r" ' + hidden + '>'
            + escape(actor) + '</p></div><h1 class="nr-header--1">' + escape(title)
            + '</h1><div id="nr_text"><p>' + escape(body) + '</p></div>'
            '<div class="local-section local-section--2">PRIVATE RELATED 任天堂株式会社</div>'
            '</div><footer>任天堂株式会社 PRIVATE FOOTER</footer>' + extra + '</html>').encode()


class NintendoTests(unittest.TestCase):
    def setUp(self):
        self.catalogue = Catalogue()
        network = patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden'))
        network.start()
        self.addCleanup(network.stop)

    def parse(self, payload=None, now=NOW, since=SINCE):
        return common.parse_feed(feed() if payload is None else payload,
                                 LABEL, now, since, self.catalogue)

    def item(self):
        rows = self.parse()
        self.assertEqual(len(rows), 1)
        return rows[0]

    def extract(self, payload=None):
        return common.extract_article(original() if payload is None else payload,
                                      self.item(), URL, NOW, SINCE, catalogue=self.catalogue)

    def test_exact_notice_unwrap_and_original_signer_day_narrative_bind(self):
        item, result = self.item(), self.extract()
        self.assertEqual(item['title'], TITLE)
        self.assertIsNotNone(result)
        self.assertEqual(result['related_company'], '任天堂株式会社')
        self.assertEqual(result['published_date'], '2026-10-06')
        self.assertIsNone(result['published_at'])
        self.assertEqual(result['publication_precision'], 'day')
        self.assertEqual(result['body_verified_at'], NOW.timestamp())
        self.assertEqual(result['publication_evidence']['feed_timestamp_role'], 'discovery')
        self.assertIsNotNone(result['publication_evidence']['feed_reported_at'])
        self.assertTrue(common.valid_identity(result, self.catalogue))
        for text in ('PRIVATE NAV', 'PRIVATE RELATED', 'PRIVATE FOOTER'):
            self.assertNotIn(text, result['body'])

    def test_unknown_notice_wrapper_or_date_is_not_guessed(self):
        for payload in (feed(title=TITLE), feed(title='ニュースリリース「' + TITLE + '」を更新しました。'),
                        feed(published='', extra='<updated>2026-10-06</updated>')):
            self.assertEqual(self.parse(payload), [])

    def test_subsidiary_hidden_or_later_parent_does_not_supply_the_signer(self):
        for payload in (original(actor='株式会社架空子会社'), original(hidden='hidden'),
                        original(actor='', body='任天堂株式会社は、' + BODY)):
            self.assertIsNone(self.extract(payload))

    def test_visible_day_heading_url_and_duplicate_roots_are_checked(self):
        for payload in (original(visible='2026年10月7日'), original(visible='更新日2026年10月6日'),
                        original(title='別の架空ソフトを発売'), original(og=URL + '#body'),
                        original(extra='<div id="nr_body"></div>')):
            self.assertIsNone(self.extract(payload))

    def test_originals_are_only_exact_first_party_corporate_html(self):
        for url in (URL.replace('.html', '.pdf'), URL.replace('.html', '.jpg'),
                    URL + '?tracking=1', URL + '#body',
                    URL.replace('www.nintendo.co.jp', 'www.nintendo.co.jp.evil.test'),
                    URL.replace('/corporate/release/', '/support/')):
            self.assertEqual(self.parse(feed(url=url)), [])

    def test_retrieval_clock_cannot_relabel_a_past_publication(self):
        later = datetime(2026, 10, 17, 12, tzinfo=common.JST)
        self.assertEqual(self.parse(now=later, since=date(2026, 10, 14)), [])
        self.assertEqual(self.extract()['published_date'], '2026-10-06')

    def test_entity_and_size_budgets_remain_closed(self):
        for payload in (b'<!DOCTYPE rss><rss><channel/></rss>', b'x' * (common.MAX_BYTES + 1)):
            with self.assertRaises(ValueError):
                normalize_feed_payload(payload)


if __name__ == '__main__':
    unittest.main()

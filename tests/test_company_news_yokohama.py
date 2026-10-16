"""Fictional HTML through production hooks; no live source or AI."""
from copy import deepcopy
from datetime import date, datetime
from html import escape
import socket
import unittest
from unittest.mock import patch

import company_news_additional as common
import company_news_yokohama as adapter
from daily_news_sources import _Document

LABEL = '横浜ゴム'
CONFIG = adapter.YOKOHAMA_CONFIG
URL = CONFIG['feed'] + '?id=9001&lang=ja'
NOW = datetime(2026, 10, 17, 2, tzinfo=common.JST)
SINCE = date(2026, 10, 15)
TITLE = '架空の試験技術を共同開発 ～実用化前の検証～'
BODY = ('架空の技術を共同開発する計画を発表しました。実在の発表ではありません。'
        '技術的な実現性を検証する段階で、導入完了や売上実現を意味しません。'
        '二社はそれぞれ異なる技術上の役割を担い、結果は今後の評価によって変わります。') * 2


class Catalogue:
    members = {'5101.T': dict(symbol='5101.T', name=LABEL, business=None, business_sources=[])}
    provenance = dict(as_of='2026-10-01', source_sha256='b' * 64)
    facts_sha256 = 'a' * 64


def row(*, target=URL, day='2026年10月16日', title=TITLE, hidden=''):
    return (f'<li class="li-06-inr" {hidden}><a class="md-link" href="{escape(target)}">'
            f'<dl class="md-item"><dt class="md-head">{escape(day)}</dt><dd class="md-cont">'
            f'<span class="md-cat-label">PRIVATE CATEGORY</span><p class="md-ttl">{escape(title)}</p>'
            '</dd></dl></a></li>')


def index(rows=None, extra=''):
    return ('<html><main role="main"><div class="sec-contents--lv3"><ul class="md-li-06">'
            + (row() if rows is None else rows) + '</ul></div></main>' + extra + '</html>').encode()


def paragraph(text, hidden=''):
    return ('<div class="md-cl-27 md-cl-27-noline"><div class="md-item">'
            f'<p class="md-read" {hidden}>' + escape(text) + '</p></div></div>')


def original(*, title=TITLE, day='2026年10月16日', author=CONFIG['issuer'],
             actor=CONFIG['issuer'], partner='dotData, Inc.', joint=True, extra='',
             hidden_body='', body=None, canonical=None, og=None):
    opening = actor + ('（本社：架空市）と' + partner + '（本社：架空都市）は、' if joint else 'は、')
    narrative = opening + BODY if body is None else body
    metadata = f'<meta name="author" content="{escape(author)}">'
    if canonical is not None:metadata += '<link rel="canonical" href="' + escape(canonical) + '">'
    if og is not None:metadata += '<meta property="og:url" content="' + escape(og) + '">'
    return ('<html><head>' + metadata + '</head><body><header><h1>PRIVATE LOGO</h1></header>'
            '<main role="main"><div class="sec-contents--lv2"><h1>ニュース</h1></div>'
            '<div class="sec-contents--lv3"><div class="md-hd-17"><div class="md-inr">'
            f'<h2 class="md-ttl">{escape(title)}</h2></div><div class="md-inr">'
            f'<div class="md-page-info"><p class="md-date">{escape(day)}</p></div></div></div></div>'
            '<div class="sec-contents--lv3">' + paragraph(narrative, hidden_body)
            + '<div class="md-column"><p>PRIVATE IMAGE CAPTION</p><img src="private.png"></div>'
            '<div class="md-hd-05"><h2 class="md-ttl">今後の検証</h2></div>'
            + paragraph('検証結果と事業化は未確定であるという限定を保持します。')
            + '<table><tr><td>PRIVATE TABLE</td></tr></table>'
            '<div class="md-hd-05"><h2 class="md-ttl">本件に関するお問い合わせ先</h2></div>'
            + paragraph('PRIVATE CONTACT') + '</div><div class="sec-contents--lv3">PRIVATE RELATED</div>'
            '</main>' + extra + '<footer>PRIVATE FOOTER</footer></body></html>').encode()


class YokohamaTests(unittest.TestCase):
    def setUp(self):
        self.catalogue = Catalogue()
        guard = patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden'))
        guard.start()
        self.addCleanup(guard.stop)

    def item(self, payload=None, since=SINCE):
        result = common.parse_feed(index() if payload is None else payload, LABEL, NOW, since, self.catalogue)
        self.assertEqual(len(result), 1)
        return result[0]

    def extract(self, payload=None, item=None, final=URL):
        return common.extract_article(original() if payload is None else payload,
            self.item() if item is None else item, final, NOW, SINCE, catalogue=self.catalogue)

    def test_fixed_joint_parent_day_and_entire_qualified_narrative_roundtrip(self):
        for joint in (False, True):
            result = self.extract(original(joint=joint))
            self.assertIsNotNone(result)
            self.assertEqual(result['related_company'], CONFIG['issuer'])
            self.assertEqual(result['url'], URL)
            self.assertEqual(result['published_date'], '2026-10-16')
            self.assertIsNone(result['published_at'])
            self.assertEqual(result['body_verified_at'], NOW.timestamp())
            self.assertEqual(result['publication_evidence']['index_date_fields'], {'date': '2026-10-16'})
            self.assertIn('事業化は未確定', result['body'])
            self.assertIn('導入完了や売上実現を意味しません', result['body'])
            self.assertTrue(common.valid_identity(result, self.catalogue))
            self.assertNotIn('PRIVATE', result['body'])

    def test_query_is_preserved_for_only_this_source_fixed_grammar(self):
        self.assertEqual(adapter.safe_url(URL), URL)
        self.assertEqual(common.safe_url(URL, LABEL), URL)
        self.assertEqual(common.safe_url(URL), URL)
        self.assertEqual(adapter.safe_url('//www.y-yokohama.com/release/?id=9001&lang=ja'), URL)
        self.assertEqual(adapter.safe_url(CONFIG['feed']), CONFIG['feed'])
        self.assertNotEqual(adapter.safe_url(URL), adapter.safe_url(URL.replace('9001', '9002')))
        for target in (' ' + URL, URL + ' ', URL + '&token=x', URL + '&id=9002', URL.replace('&lang=ja', '&lang=en'),
                       URL.replace('id=9001&lang=ja', 'lang=ja&id=9001'),
                       URL.replace('9001', '0'), URL.replace('9001', '-1'), URL.replace('9001', '%399001'),
                       URL + '#body', URL.replace('https:', 'http:'),
                       URL.replace('www.y-yokohama.com', 'example.com'),
                       URL.replace('www.y-yokohama.com', 'user@www.y-yokohama.com'),
                       URL.replace('/release/', '/other/'), URL.replace('9001', '123456789')):
            with self.subTest(target=target):
                self.assertIsNone(adapter.safe_url(target))
                self.assertIsNone(common.safe_url(target, LABEL))
                self.assertEqual(adapter.parse_index(index(row(target=target)), LABEL, NOW, SINCE, self.catalogue), [])

    def test_other_partners_mentions_possessive_late_subsidiary_and_signer_do_not_announce(self):
        for options in ({'partner': 'otherData, Inc.'}, {'actor': '横浜ゴム株式会社の子会社'},
                        {'actor': '横浜ゴム工業株式会社'}, {'actor': '架空子会社株式会社'},
                        {'body': '別会社が' + BODY + '横浜ゴム株式会社は協力します。'},
                        {'body': '横浜ゴム株式会社の技術を使う別会社が' + BODY},
                        {'body': '横浜ゴム株式会社\n架空子会社株式会社は' + BODY},
                        {'hidden_body': 'hidden'}):
            with self.subTest(options=options):
                self.assertIsNone(self.extract(original(**options)))

    def test_joint_helper_does_not_change_general_lowercase_actor_grammar(self):
        text = CONFIG['issuer'] + '（本社：架空市）とdotData, Inc.（本社：架空都市）は、' + BODY
        self.assertFalse(common._declared_actor(CONFIG['issuer'], text))
        self.assertTrue(adapter.declared_actor(CONFIG['issuer'], text))
        self.assertFalse(adapter.declared_actor('別会社株式会社', text))
        self.assertFalse(adapter.declared_actor(CONFIG['issuer'], text.replace('dotData, Inc.', 'dotData Group')))

    def test_original_title_day_author_and_final_url_are_not_inferred_from_site_header(self):
        for options in ({'title': '別の架空システムを導入'}, {'day': '2026年10月15日'}, {'day': '2026年'},
                        {'author': '架空子会社株式会社'},
                        {'extra': '<meta name="author" content="横浜ゴム株式会社">'},
                        {'canonical': URL.replace('9001', '9002')}, {'og': 'https://example.com/wrong'}):
            self.assertIsNone(self.extract(original(**options)))
        self.assertIsNone(self.extract(final=URL.replace('9001', '9002')))
        self.assertIsNotNone(self.extract(original(canonical=URL, og=URL)))

    def test_hidden_visible_day_and_duplicate_headers_or_main_are_rejected(self):
        for payload in (original().replace(b'class="md-date"', b'class="md-date" hidden'),
                        original(extra='<main role="main"></main>'),
                        original().replace(b'<h2 class="md-ttl">', b'<h2 class="md-ttl">DUP</h2><h2 class="md-ttl">', 1)):
            self.assertIsNone(self.extract(payload))

    def test_old_future_date_only_cutoff_and_priority_filters_are_kept(self):
        for options in ({'day': '2026年10月10日'}, {'day': '2026年10月18日'}, {'day': '2026年'},
                        {'day': '2026年10月16日 追記'}, {'title': 'イベント出展のお知らせ'}):
            self.assertEqual(adapter.parse_index(index(row(**options)), LABEL, NOW, None, self.catalogue), [])
        self.assertEqual(adapter.parse_index(index(), LABEL, NOW,
            datetime(2026, 10, 16, 1, tzinfo=common.JST), self.catalogue), [])

    def test_index_uses_exact_visible_list_and_rejects_conflicting_duplicate_id(self):
        self.assertEqual(adapter.parse_index(index(row(hidden='hidden')), LABEL, NOW, SINCE, self.catalogue), [])
        self.assertEqual(adapter.parse_index(index('', row()), LABEL, NOW, SINCE, self.catalogue), [])
        self.assertEqual(len(adapter.parse_index(index(row() * 2), LABEL, NOW, SINCE, self.catalogue)), 1)
        self.assertEqual(adapter.parse_index(index(row() + row(title='別の架空技術を導入')),
            LABEL, NOW, SINCE, self.catalogue), [])

    def test_index_and_original_bounds_encoding_and_membership_fail_closed(self):
        old = row(day='2020年1月1日')
        self.assertEqual(adapter.MAX_INDEX_ITEMS, 120)
        self.assertEqual(adapter.parse_index(index(old * 120 + row()), LABEL, NOW, SINCE, self.catalogue), [])
        for payload in (b'\xff', b'x' * 1_000_001):
            with self.assertRaises(ValueError):adapter.parse_index(payload, LABEL, NOW, SINCE, self.catalogue)
        for text in ('横浜ゴム株式会社は短文です。', CONFIG['issuer'] + 'は' + BODY + '文' * 20_000):
            self.assertIsNone(self.extract(original(joint=False, body=text)))
        self.catalogue = deepcopy(self.catalogue)
        self.catalogue.members = {'5101.T': dict(symbol='5101.T', name='別会社')}
        self.assertEqual(adapter.parse_index(index(), LABEL, NOW, SINCE, self.catalogue), [])


if __name__ == '__main__':
    unittest.main()

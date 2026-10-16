"""Offline fictional fixtures in two inspected first-party HTML layouts."""
from copy import deepcopy
from datetime import date, datetime
from html import escape
import socket
import unittest
from unittest.mock import patch

import company_news_additional as common
from company_news_kline_mmc import KLINE_CONFIG, MMC_CONFIG, MAX_INDEX_ITEMS, parse_index, article_layout

NOW = datetime(2026, 10, 17, 2, tzinfo=common.JST)
SINCE = date(2026, 10, 15)
DAY = '2026-10-16'
VISIBLE = '2026年10月16日'
TITLE = '架空の新システムを導入 ～検証用の条件を確認～'
NARRATIVE = ('は、架空の実験システムを導入する計画を発表しました。'
             '試験段階の技術であり、今回の検証データは実在する発表ではありません。'
             '将来の運用条件を検討する予定で、商用化や売上の確定を意味しません。') * 2


class Catalogue:
    def __init__(self, configs):
        self.members = {c['symbol']: dict(symbol=c['symbol'], name=c['name'], business=None,
                                         business_sources=[]) for c in configs}
        self.provenance = dict(as_of='2026-10-01', source_sha256='b' * 64)
        self.facts_sha256 = 'a' * 64


def url(config, day='20261016'):
    if config['template'] == 'kline_html':
        return 'https://www.kline.co.jp/ja/news/other/other-' + day + '.html'
    return 'https://news.mmc.co.jp/corporate/ja/newsroom/press/news' + day + 'a.html'


def row(config, *, title=TITLE, target=None, stated='2026/10/16', visible=VISIBLE, hidden='', extra=''):
    return (f'<li class="no-img normal" entrydate="{escape(stated)}" {hidden}><div class="item">'
            f'<a href="{escape(target or url(config))}"><span class="date">{escape(visible)}</span>'
            f'<span class="news_tx">{escape(title)}</span></a>{extra}</div></li>')


def index(config, rows=None, extra=''):
    return ('<html><div id="basic-list2-1" class="basic-list2 tabbox"><ul class="tabItems">'
            + (row(config) if rows is None else rows) + '</ul></div>' + extra + '</html>').encode()


def rich(paragraphs):
    return ('<div class="multiColumn multiColumn1"><div class="column columnLast column1">'
            '<div class="text-section"><div class="rich-text">' + paragraphs + '</div>'
            '</div></div></div>')


def article(config, *, title=TITLE, actor=None, narrative_actor=None, visible=VISIBLE,
            body_day=VISIBLE, signer_day=VISIBLE, hidden_signer='', canonical=None,
            body=None, extra='', missing_visible=False):
    actor = config['issuer'] if actor is None else actor
    narrative_actor = config['issuer'] if narrative_actor is None else narrative_actor
    signer = (escape(signer_day) + '<br>' if config['template'] == 'kline_html' else '') + escape(actor)
    text = escape(narrative_actor + NARRATIVE) if body is None else body
    head, subtitle = title.split(' ', 1)
    return ('<html><head><meta property="og:url" content="' + escape(canonical or url(config)) + '"></head>'
            f'<body id="multi3" entrydate="{escape(body_day)}">'
            '<header><h1 class="logo">UNRELATED LOGO</h1></header><div id="page-intro">'
            f'<h1>{escape(head)}<br>{escape(subtitle)}</h1>'
            + ('' if missing_visible else '<div class="text-meta" role="contentinfo">' + escape(visible) + '</div>')
            + '</div><div id="sharewithmain" role="main">'
            + rich(f'<p {hidden_signer} style="text-align:right">{signer}</p>')
            + rich('<p>' + text + '</p><p hidden>PRIVATE HIDDEN</p>')
            + rich('<p>【PRIVATE IMAGE CAPTION】</p><table><tr><td>PRIVATE TABLE</td></tr></table>')
            + rich('<p>【関連情報】</p><p>PRIVATE RELATED</p>')
            + rich('<p>以上</p><p>PRIVATE CONTACT</p>')
            + '</div>' + extra + '<footer>PRIVATE FOOTER</footer></body></html>').encode()


class KlineMMCTests(unittest.TestCase):
    def setUp(self):
        self.configs = [deepcopy(KLINE_CONFIG), deepcopy(MMC_CONFIG)]
        self.catalogue = Catalogue(self.configs)
        p = patch.dict(common.SOURCES, {c['name']: c for c in self.configs})
        p.start()
        self.addCleanup(p.stop)
        p = patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden'))
        p.start()
        self.addCleanup(p.stop)
        p = patch.object(common, '_layout', side_effect=lambda d, c, now, expected: article_layout(d, c, expected))
        p.start()
        self.addCleanup(p.stop)

    def item(self, config, payload=None, since=SINCE):
        items = parse_index(index(config) if payload is None else payload,
                            config['name'], NOW, since, self.catalogue)
        self.assertEqual(len(items), 1)
        return items[0]

    def extract(self, config, payload=None, item=None, final=None):
        return common.extract_article(article(config) if payload is None else payload,
                                      self.item(config) if item is None else item,
                                      url(config) if final is None else final, NOW, SINCE,
                                      catalogue=self.catalogue)

    def test_original_parent_visible_date_title_and_private_narrative_roundtrip(self):
        for c in self.configs:
            with self.subTest(symbol=c['symbol']):
                result = self.extract(c)
                self.assertIsNotNone(result)
                self.assertEqual(result['published_date'], DAY)
                self.assertIsNone(result['published_at'])
                self.assertEqual(result['publication_precision'], 'day')
                self.assertEqual(result['related_company'], c['issuer'])
                self.assertEqual(result['publication_evidence']['index_date_fields'], {'date': DAY})
                self.assertEqual(result['publication_evidence']['discovery_format'], 'html_index')
                self.assertEqual(result['body_verified_at'], NOW.timestamp())
                self.assertTrue(common.valid_identity(result, self.catalogue))
                self.assertIn('商用化や売上の確定を意味しません', result['body'])
                for token in ('PRIVATE', 'UNRELATED'):
                    self.assertNotIn(token, result['body'])

    def test_discovery_requires_agreeing_visible_attribute_filename_days(self):
        for c in self.configs:
            for options in ({'visible': ''}, {'stated': ''}, {'visible': '2026年10月15日'},
                            {'stated': '2026-10-16T12:00:00+09:00'},
                            {'target': url(c, '20261015')},
                            {'visible': '2026年10月18日', 'stated': '2026/10/18', 'target': url(c, '20261018')}):
                with self.subTest(symbol=c['symbol'], options=options):
                    self.assertEqual(parse_index(index(c, row(c, **options)), c['name'], NOW,
                                                 SINCE, self.catalogue), [])

    def test_discovery_does_not_use_logo_recent_panel_hidden_rows_or_outside_anchor_dates(self):
        for c in self.configs:
            for rows, extra in ((row(c, hidden='hidden'), ''), ('', row(c)),
                                ('', '<div id="basic-list2-2" class="basic-list2"><ul class="tabItems">'
                                 + row(c) + '</ul></div>'),
                                (row(c).replace('</a>', '') .replace('</div>', '</a></div>', 1)
                                 .replace('<span class="date">', '</a><span class="date">'), '')):
                self.assertEqual(parse_index(index(c, rows, extra), c['name'], NOW,
                                             SINCE, self.catalogue), [])

    def test_duplicate_disagreement_removes_url_but_identical_duplicate_is_single(self):
        for c in self.configs:
            self.assertEqual(len(parse_index(index(c, row(c) * 2), c['name'], NOW,
                                             SINCE, self.catalogue)), 1)
            self.assertEqual(parse_index(index(c, row(c) + row(c, title='別の架空技術を共同開発')),
                                         c['name'], NOW, SINCE, self.catalogue), [])

    def test_fixed_original_paths_exclude_pdf_offsite_query_fragment_and_encoding(self):
        for c in self.configs:
            target = url(c)
            for value in (target.replace('.html', '.pdf'), target + '?cache=1', target + '#x',
                          target.replace('https:', 'http:'), target.replace(c['host'], 'example.com'),
                          target.replace(c['host'], 'user@' + c['host']),
                          target.replace('/ja/', '/%6aa/'), target.replace('.html', '/extra.html')):
                with self.subTest(url=value):
                    self.assertIsNone(common.safe_url(value, c['name']))
                    self.assertEqual(parse_index(index(c, row(c, target=value)), c['name'],
                                                 NOW, SINCE, self.catalogue), [])

    def test_original_requires_both_leading_signer_and_opening_parent_not_footer_mention(self):
        for c in self.configs:
            for options in ({'actor': '株式会社架空子会社'}, {'hidden_signer': 'hidden'},
                            {'actor': c['issuer'] + 'の子会社'}, {'narrative_actor': '株式会社架空子会社'},
                            {'narrative_actor': c['issuer'] + 'の子会社'},
                            {'actor': '株式会社架空子会社', 'body': escape('株式会社架空子会社' + NARRATIVE + c['issuer'] + 'は協力しました。')}):
                with self.subTest(symbol=c['symbol'], options=options):
                    self.assertIsNone(self.extract(c, article(c, **options)))

    def test_original_day_and_heading_canonical_are_bound_and_cannot_use_hidden_day(self):
        for c in self.configs:
            for options in ({'visible': '2026年10月15日'}, {'body_day': '2026年10月15日'},
                            {'missing_visible': True}, {'title': '別の新サービスを提供開始 ～架空検証～'},
                            {'canonical': 'https://example.com/wrong.html'},
                            {'extra': '<meta property="og:url" content="' + url(c) + '">'},
                            {'extra': '<link rel="canonical" href="https://example.com/wrong.html">'}):
                self.assertIsNone(self.extract(c, article(c, **options)))
        self.assertIsNone(self.extract(self.configs[0], article(self.configs[0], signer_day='2026年10月15日')))

    def test_old_day_is_not_relabelled_today_and_date_only_cutoff_remains_strict(self):
        for c in self.configs:
            self.assertEqual(parse_index(index(c, row(c, target=url(c, '20261007'), stated='2026/10/07',
                                                      visible='2026年10月7日')), c['name'],
                                         NOW, None, self.catalogue), [])
            self.assertEqual(parse_index(index(c), c['name'], NOW,
                                         datetime(2026, 10, 16, 1, tzinfo=common.JST), self.catalogue), [])
            self.assertEqual(parse_index(index(c, row(c, title='イベント出展のお知らせ')),
                                         c['name'], NOW, SINCE, self.catalogue), [])

    def test_index_is_bounded_at_120_rows_and_identity_is_current_catalogue(self):
        self.assertEqual(MAX_INDEX_ITEMS, 120)
        for c in self.configs:
            old = row(c, target=url(c, '20200101'), stated='2020/01/01', visible='2020年1月1日')
            self.assertEqual(parse_index(index(c, old * MAX_INDEX_ITEMS + row(c)), c['name'],
                                         NOW, SINCE, self.catalogue), [])
            self.catalogue.members[c['symbol']]['name'] = '別の会社'
            self.assertEqual(parse_index(index(c), c['name'], NOW, SINCE, self.catalogue), [])
            self.catalogue.members[c['symbol']]['name'] = c['name']

    def test_incomplete_structures_size_encoding_short_long_and_final_url_fail_closed(self):
        for c in self.configs:
            self.assertIsNone(self.extract(c, b'<html/>'))
            self.assertIsNone(self.extract(c, article(c, body=escape(c['issuer'] + 'は短文です。'))))
            self.assertIsNone(self.extract(c, article(c, body=escape(c['issuer'] + NARRATIVE + '文' * 20_000))))
            self.assertIsNone(self.extract(c, final=url(c) + '?unverified=1'))
            for payload in (b'\xff', b'x' * 1_000_001):
                with self.assertRaises(ValueError):
                    parse_index(payload, c['name'], NOW, SINCE, self.catalogue)
            with self.assertRaisesRegex(ValueError, 'unsupported_feed_structure'):
                parse_index(b'<html/>', c['name'], NOW, SINCE, self.catalogue)


if __name__ == '__main__':
    unittest.main()

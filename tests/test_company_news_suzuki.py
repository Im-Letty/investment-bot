"""Offline fictional text in the two inspected Suzuki original HTML seams."""
from datetime import date, datetime
from html import escape
import socket
import unittest
from unittest.mock import patch

import company_news_additional as common
from company_news_suzuki import SUZUKI_CONFIG

NOW = datetime(2026, 10, 17, 3, tzinfo=common.JST)
SINCE = date(2026, 10, 14)
URL = 'https://www.suzuki.co.jp/release/d/2026/1015/'
TITLE = 'スズキ、架空の検証サービスを提供開始'
BODY = ('これは解析確認用の架空の文章で、実際の企業の発表ではありません。'
        '新しい技術の検証を進めると説明しました。成果は実験の条件内に限られ、'
        '将来の製品化を決めたという意味ではないことを示しています。') * 3


def row(url=URL, title=TITLE, day='2026年10月15日', kind='corporate'):
    return (f'<item class="{kind}"><link>{escape(url)}</link><date>{escape(day)}</date>'
            f'<ttl>{escape(title)}</ttl><top>別の短い表示名</top></item>')


def index(rows=None, fiscal='2026', title=None):
    return (f'<release><year id="ad{fiscal}"><h1>{fiscal}年4月～</h1>'
            + (row() if rows is None else rows) + '</year></release>').encode()


def article(*, title=TITLE, day='2026年10月15日', actor='スズキ株式会社', body=BODY,
            og=URL, canonical=URL, hidden='', extra=''):
    return (f'<html><head><meta property="og:url" content="{escape(og)}">'
            f'<link rel="canonical" href="{escape(canonical)}"></head>'
            '<nav>PRIVATE HEADER スズキ株式会社</nav><div id="stage">'
            f'<div id="releaseNumber"><div class="contents"><div id="date">{escape(day)}</div>'
            '<div class="pdfIcon">PRIVATE PDF</div></div></div>'
            '<div id="mainContents"><section class="contents"><div class="flat_sp">'
            f'<h1 id="releaseTitle">{escape(title)}</h1><h1 class="releaseSubTitle">架空の副見出し</h1></div>'
            '<div id="releaseImage">PRIVATE IMAGE CAPTION</div>'
            f'<div id="lead" {hidden}><p>{escape(actor)}は、検証を開始すると発表しました。</p>'
            f'<p>{escape(body)}</p></div><div class="boxLine"><h1>検証の条件</h1>'
            '<p>検証は一定の条件だけで実施し、結果があらゆる場面に適用できる意味ではありません。</p></div>'
            '<div class="backBtn flat_sp">PRIVATE BACK BUTTON</div><p>PRIVATE AFTER CONTENT</p>'
            '</section></div></div>' + extra + '<footer>PRIVATE FOOTER スズキ株式会社</footer></html>').encode()


class Catalogue:
    def __init__(self):
        self.members = {'7269.T': dict(symbol='7269.T', name='スズキ', business=None, business_sources=[])}
        self.provenance = dict(as_of='2026-10-08', source_sha256='b' * 64)
        self.facts_sha256 = 'a' * 64


class SuzukiTests(unittest.TestCase):
    def setUp(self):
        self.catalogue = Catalogue()
        patcher = patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden'))
        patcher.start();self.addCleanup(patcher.stop)

    def items(self, payload=None, now=NOW, since=SINCE):
        return common.parse_feed(index() if payload is None else payload, 'スズキ', now, since, self.catalogue)

    def extract(self, payload=None, item=None):
        return common.extract_article(article() if payload is None else payload,
            self.items()[0] if item is None else item, URL, NOW, SINCE, catalogue=self.catalogue)

    def test_date_only_parent_original_and_full_qualifications_without_layout_extras(self):
        result = self.extract()
        self.assertEqual(result['published_date'], '2026-10-15')
        self.assertIsNone(result['published_at'])
        self.assertEqual(result['publication_precision'], 'day')
        self.assertEqual(result['related_company'], 'スズキ株式会社')
        self.assertEqual(result['publication_evidence']['discovery_format'], 'xml_index')
        self.assertIn('一定の条件だけ', result['body'])
        self.assertIn('製品化を決めたという意味ではない', result['body'])
        self.assertNotIn('PRIVATE', result['body'])
        self.assertTrue(common.valid_identity(result, self.catalogue))

    def test_fiscal_year_and_calendar_path_do_not_make_old_or_future_items_current(self):
        for payload in (index(fiscal='2025'), index(row(day='2026年10月16日')),
                        index(row(day='2026年26月15日')), index(row(day='2026年10月18日')),
                        index(row(day='2026年10月15日12:00')), index(row(kind='car'))):
            with self.subTest(payload=payload[:70]):
                self.assertEqual(self.items(payload), [])
        now = datetime(2026, 3, 31, 12, tzinfo=common.JST)
        values = self.items(index(row(url='https://www.suzuki.co.jp/release/d/2026/0330/',
                                     day='2026年3月30日'), fiscal='2025'), now, date(2026, 3, 29))
        self.assertEqual(values[0]['published_date'], '2026-03-30')

    def test_unknown_duplicate_year_structure_and_declarations_fail_closed(self):
        for payload in (b'<rss/>', index().replace(b'ad2026', b'unknown'),
                        index().replace(b'</release>', index()[len(b'<release>'):-len(b'</release>')] + b'</release>'),
                        index().replace('2026年4月～'.encode(), '2025年4月～'.encode()),
                        b'<!DOCTYPE release>' + index(), b'x' * 1_000_001, b'\xff'):
            with self.subTest(payload=payload[:30]), self.assertRaises(ValueError):
                self.items(payload)

    def test_inspected1998_archive_groups_are_ignored_without_becoming_current(self):
        archived = '<year id="ad1998"><h1>1998年4月～</h1>' + row() + '</year>'
        payload = index().replace(b'</release>', archived.encode() + b'</release>')
        self.assertEqual([item['url'] for item in self.items(payload)], [URL])

    def test_only120_relevant_entries_are_inspected_and_conflicts_do_not_survive(self):
        beyond = row(url='https://www.suzuki.co.jp/release/d/2026/1016/', day='2026年10月16日')
        values = self.items(index(row() * 120 + beyond))
        self.assertEqual([item['url'] for item in values], [URL])
        self.assertEqual(self.items(index(row() + row(title='スズキ、別の新サービスを提供開始'))), [])

    def test_non_html_external_query_fragment_or_routine_items_are_not_candidates(self):
        for url in (URL.replace('https:', 'http:'), URL + '?x=1', URL + '#part',
                    URL.replace('www.', 'user@www.'), URL.replace('www.suzuki.co.jp', 'example.invalid'),
                    URL + 'pdf/1015.pdf', URL.replace('/2026/', '/%32%30%32%36/')):
            with self.subTest(url=url):self.assertEqual(self.items(index(row(url=url))), [])
        self.assertEqual(self.items(index(row(title='人事異動について'))), [])

    def test_visible_day_heading_and_original_metadata_must_agree(self):
        for options in ({'day': '2026年10月16日'}, {'day': '2026年10月15日 更新'}, {'title': '別の発表'},
                        {'og': URL + '?x=1'}, {'canonical': URL.replace('1015', '1016')},
                        {'extra': '<meta property="og:url" content="' + URL + '">'}):
            with self.subTest(options=options):self.assertIsNone(self.extract(article(**options)))

    def test_subsidiary_or_parent_only_in_footer_or_hidden_lead_is_not_parent_actor(self):
        for options in ({'actor': '株式会社スズキビジネス'}, {'actor': '架空の共同研究企業'},
                        {'actor': '架空企業', 'body': BODY + 'スズキ株式会社は、研究を紹介しました。'},
                        {'hidden': 'style="display:none"'}):
            with self.subTest(options=options):self.assertIsNone(self.extract(article(**options)))

    def test_expected_containers_and_original_body_boundaries_are_required(self):
        for payload in (article().replace(b'id="releaseNumber"', b'id="other"'),
                        article().replace(b'id="mainContents"', b'id="other"'),
                        article().replace(b'class="backBtn flat_sp"', b'class="unknown"'),
                        article().replace(b'id="lead"', b'id="other"')):
            self.assertIsNone(self.extract(payload))

    def test_current_identity_and_membership_remain_required(self):
        self.catalogue.members['7269.T']['name'] = '別会社'
        self.assertEqual(self.items(), [])


if __name__ == '__main__':
    unittest.main()

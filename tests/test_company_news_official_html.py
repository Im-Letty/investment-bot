"""Fictional text in the inspected Furukawa HTML structure; offline only."""
from copy import deepcopy
from datetime import date, datetime, timedelta
from html import escape
import socket
import unittest
from unittest.mock import MagicMock, patch

import company_news_additional as common
import company_news_sources as collector
from company_news_official_html import FURUKAWA_CONFIG, TOSOH_CONFIG, MAX_INDEX_ITEMS

LABEL = '古河電気工業'
NOW = datetime(2026, 10, 4, 20, tzinfo=common.JST)
SINCE = date(2026, 10, 1)
DAY = '2026-10-02'
URL = 'https://www.furukawaelectric.com/release/2026/dev_20261002.html'
TITLE = '検証用の架空技術を共同開発 ～実験用の条件を確認～'
BODY = ('これは解析確認のために作った架空の文章です。実際の企業の発表ではありません。'
        '共同開発の実験を予定し、要素技術の評価結果と今後の研究条件を説明します。'
        '商品化を完了したという意味ではなく、将来の事業化に向けて検討する段階です。') * 2


class Catalogue:
    def __init__(self):
        self.members = {'5801.T': dict(symbol='5801.T', name=LABEL, business=None,
                                       business_sources=[])}
        self.provenance = {'as_of': '2026-10-01', 'source_sha256': 'b' * 64}
        self.facts_sha256 = 'a' * 64
    def is_member(self, symbol):
        return symbol in self.members


def row(*, title=TITLE, url=URL, visible='2026.10.02', stated=DAY, extra='', hidden=''):
    return ('<li class="m-link-news__item" ' + hidden + '><div class="m-link-news__meta">'
            f'<time class="m-link-news__date" datetime="{escape(stated)}">{escape(visible)}</time>'
            '</div><div class="m-link-news__content"><ul><li>'
            f'<a class="m-link" href="{escape(url)}">{escape(title)}</a>{extra}'
            '</li></ul></div></li>')


def index(rows=None, extra=''):
    return ('<html><main class="l-main"><ol class="m-link-news">'
            + (row() if rows is None else rows) + '</ol></main>' + extra + '</html>').encode()


def article(*, title=TITLE, visible='2026年10月2日', actor='古河電気工業株式会社',
            joint=True, body=BODY, canonical=URL, extra='', actor_hidden=''):
    head, caption = title.split(' ', 1)
    signers = escape(actor) + ('<br>株式会社架空の共同研究者' if joint else '')
    return ('<html><head><meta property="og:url" content="' + escape(canonical) + '"></head>'
            '<nav>UNRELATED NAV</nav><main class="l-main"><div class="l-page-title">'
            f'<h1 class="l-page-title__title">{escape(head)}</h1>'
            f'<p class="l-page-title__sub-title">{escape(caption)}</p></div>'
            '<div class="l-content__inner"><div class="m-text text-right">'
            f'<p class="m-text__item">{escape(visible)}</p></div>'
            f'<div class="m-text text-right"><p class="m-text__item" {actor_hidden}>{signers}</p></div>'
            f'<div class="m-layout-media"><p>{escape(body)}</p></div>'
            '<h3>関連ページ</h3><div>PRIVATE RELATED LINK</div>'
            '<h2>古河電工グループについて</h2><p>PRIVATE PROFILE 古河電気工業株式会社は</p>'
            '<h2>お問い合わせ先</h2><p>PRIVATE CONTACT</p>'
            '</div></main>' + extra + '<footer>UNRELATED FOOTER</footer></html>').encode()


class OfficialHTMLTests(unittest.TestCase):
    def setUp(self):
        self.config = deepcopy(FURUKAWA_CONFIG)
        self.catalogue = Catalogue()
        self.config_patch = patch.dict(common.SOURCES, {LABEL: self.config})
        self.config_patch.start()
        self.addCleanup(self.config_patch.stop)
        self.network_patch = patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden'))
        self.network_patch.start()
        self.addCleanup(self.network_patch.stop)

    def item(self, payload=None, now=NOW, since=SINCE):
        values = common.parse_feed(index() if payload is None else payload, LABEL, now, since, self.catalogue)
        self.assertEqual(len(values), 1)
        return values[0]

    def extract(self, payload=None, item=None):
        return common.extract_article(article() if payload is None else payload,
                                      self.item() if item is None else item, URL, NOW, SINCE,
                                      catalogue=self.catalogue)

    def test_original_joint_issuer_day_and_body_are_bound_without_invented_clock(self):
        item, result = self.item(), self.extract()
        self.assertEqual(item['feed_date_fields'], {'date': DAY})
        self.assertEqual(result['published_date'], DAY)
        self.assertIsNone(result['published_at'])
        self.assertEqual(result['publication_precision'], 'day')
        self.assertEqual(result['publication_evidence']['discovery_format'], 'html_index')
        self.assertNotIn('feed_published_at', result['publication_evidence'])
        self.assertEqual(result['related_company'], self.config['issuer'])
        self.assertIn('株式会社架空の共同研究者', result['body'])
        self.assertIn('将来の事業化', result['body'])
        self.assertTrue(common.valid_identity(result, self.catalogue))
        for text in ('PRIVATE', 'UNRELATED'):
            self.assertNotIn(text, result['body'])

    def test_discovery_rejects_conflicting_attribute_visible_day_filename_and_future_day(self):
        for options in ({'visible': '2026.10.01'}, {'stated': ''}, {'visible': ''},
                        {'stated': '2026-10-02T12:00:00+09:00'},
                        {'url': URL.replace('20261002', '20261003')},
                        {'url': URL.replace('/2026/', '/2025/')},
                        {'stated': '2026-10-05', 'visible': '2026.10.05'}):
            with self.subTest(options=options):
                self.assertEqual(common.parse_feed(index(row(**options)), LABEL, NOW, SINCE,
                                                   self.catalogue), [])

    def test_duplicates_with_disagreeing_titles_are_removed(self):
        self.assertEqual(common.parse_feed(index(row() + row(title='別の共同開発を発表')),
                                          LABEL, NOW, SINCE, self.catalogue), [])
        self.assertEqual(len(common.parse_feed(index(row() + row()), LABEL, NOW, SINCE,
                                              self.catalogue)), 1)

    def test_unsafe_pdf_and_uninspected_routes_are_not_fetchable(self):
        for value in (URL.replace('.html', '.pdf'), URL + '?cache=1', URL + '#part',
                      URL.replace('https:', 'http:'), URL.replace('www.', 'user@www.'),
                      URL.replace('/dev_', '/unobserved_'), URL.replace('www.', '127.0.0.1.'),
                      URL.replace('/2026/', '/%32%30%32%36/')):
            with self.subTest(url=value):
                self.assertIsNone(common.safe_url(value, LABEL))
                self.assertEqual(common.parse_feed(index(row(url=value)), LABEL, NOW, SINCE,
                                                   self.catalogue), [])
        self.assertEqual(common.safe_url(self.config['feed'], LABEL), self.config['feed'])

    def test_date_only_boundary_membership_and_priority_filters_remain_in_force(self):
        self.assertEqual(common.parse_feed(index(), LABEL, NOW,
                                          datetime(2026, 10, 2, 1, tzinfo=common.JST), self.catalogue), [])
        self.catalogue.members['5801.T']['name'] = 'different'
        self.assertEqual(common.parse_feed(index(), LABEL, NOW, SINCE, self.catalogue), [])
        self.catalogue.members['5801.T']['name'] = LABEL
        self.assertEqual(common.parse_feed(index(row(title='イベント出展について')), LABEL,
                                          NOW, SINCE, self.catalogue), [])

    def test_index_limit_stays_120_and_hidden_rows_do_not_supply_evidence(self):
        self.assertEqual(MAX_INDEX_ITEMS, 120)
        old = row(stated='2020-01-01', visible='2020.01.01')
        self.assertEqual(common.parse_feed(index(old * MAX_INDEX_ITEMS + row()), LABEL,
                                          NOW, SINCE, self.catalogue), [])
        self.assertEqual(common.parse_feed(index(row(hidden='hidden')), LABEL, NOW, SINCE,
                                          self.catalogue), [])

    def test_original_actor_must_be_a_visible_leading_signer_not_a_partner_or_footer_mention(self):
        for payload in (article(actor='株式会社別の会社'), article(actor_hidden='hidden'),
                        article(actor='古河電気工業株式会社の子会社'),
                        article(actor='株式会社別の会社', body=BODY + '古河電気工業株式会社は参加します。')):
            self.assertIsNone(self.extract(payload))
        self.assertIsNotNone(self.extract(article(joint=False)))

    def test_original_visible_day_heading_and_canonical_must_match_discovery(self):
        for payload in (article(visible='2026年10月1日'), article(title='別の架空提携 発表'),
                        article(canonical=URL.replace('dev_', 'kei_')),
                        article(extra='<meta property="og:url" content="' + URL + '">'),
                        article(extra='<link rel="canonical" href="https://example.com">')):
            self.assertIsNone(self.extract(payload))

    def test_short_oversized_and_non_original_payloads_fail_closed(self):
        for payload in (article(body='短文'), article(body=BODY + '文' * 20_000), b'<html/>'):
            self.assertIsNone(self.extract(payload))
        for payload in (b'\xff', b'x' * 1_000_001):
            with self.assertRaises(ValueError):
                common.parse_feed(payload, LABEL, NOW, SINCE, self.catalogue)

    def test_staged_html_route_uses_existing_rotating_slots_and_does_not_increase_base_count(self):
        with patch.dict(collector.FEEDS, {LABEL: self.config['feed']}):
            plans = [collector.collection_schedule(NOW + timedelta(seconds=900 * i)) for i in range(22)]
        self.assertTrue(any(LABEL in plan['feeds'] for plan in plans))
        for plan in plans:
            self.assertEqual(plan['coverage']['base_channel_count'], 33)
            self.assertLessEqual(plan['coverage']['additional_scheduled_channel_count'], 6)

    def test_registered_html_indexes_require_HTML_mime_and_keep_pinned_verified_transport(self):
        for config in (FURUKAWA_CONFIG, TOSOH_CONFIG):
            for mime in ('text/html', 'application/xml'):
                with self.subTest(host=config['host'], mime=mime):
                    response = MagicMock()
                    response.__enter__.return_value = response
                    response.status_code = 200
                    response.headers = {'Content-Type': mime}
                    response.raw.read1.side_effect = [b'<html/>', b'']
                    session = MagicMock()
                    session.__enter__.return_value = session
                    session.get.return_value = response
                    with patch.object(collector, '_public_addresses', return_value=['8.8.8.8']), \
                         patch.object(collector.requests, 'Session', return_value=session), \
                         patch.object(collector, '_PinnedHTTPSAdapter') as pin, \
                         patch.object(collector.time, 'monotonic', return_value=100), \
                         patch.object(collector._SOURCE_BACKOFF, 'check', return_value={'blocked': False}):
                        if mime == 'text/html':
                            self.assertEqual(collector._download(config['feed'], 140), (b'<html/>', config['feed']))
                        else:
                            with self.assertRaisesRegex(ValueError, 'source_content_type'):
                                collector._download(config['feed'], 140)
                    pin.assert_called_once_with(config['host'], '8.8.8.8')
                    self.assertTrue(session.get.call_args.kwargs['verify'])
                    self.assertFalse(session.get.call_args.kwargs['allow_redirects'])
        with patch.object(collector.requests, 'Session') as session:
            with self.assertRaisesRegex(ValueError, 'unapproved_source'):
                collector._download('https://www.furukawaelectric.com/unregistered/', 140)
            session.assert_not_called()


class TosohHTMLTests(unittest.TestCase):
    def setUp(self):
        self.catalogue = Catalogue()
        self.catalogue.members['4042.T'] = dict(symbol='4042.T', name='東ソー', business=None, business_sources=[])
        self.config_patch = patch.dict(common.SOURCES, {'東ソー': deepcopy(TOSOH_CONFIG)})
        self.config_patch.start()
        self.addCleanup(self.config_patch.stop)
        self.network_patch = patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden'))
        self.network_patch.start()
        self.addCleanup(self.network_patch.stop)
        self.url = 'https://www.tosoh.co.jp/news/release/2026/20261002.html'
        self.body = '東ソーは、架空の共同開発を行う計画を発表しました。' + BODY

    def index(self, *, day='2026.10.02', url=None, title=TITLE, extra='', year='2026'):
        row = ('<li class="mod-news_content_item"><a href="' + escape(url or self.url) + '">'
               '<div class="mod-news_content-date"><p class="mod-news_content-time">' + escape(day)
               + '</p><p class="mod-news_content-tag">ニュースリリース</p></div>'
               '<div class="mod-news_content_txt">' + escape(title) + '</div></a></li>')
        return ('<main class="news_sort"><div class="mod-selectBox_block" data-year="' + year + '">'
                '<ul class="mod-news_content_list">' + row + extra + '</ul></div></main>').encode()

    def article(self, *, day='2026.10.02', body=None, title=TITLE, url=None, hidden=''):
        return ('<html><meta property="og:url" content="' + escape(url or self.url) + '">'
                '<main class="news_release"><div class="container"><div class="mod-printHeader">'
                '<p class="mod-printHeader-date">2099年1月1日</p><p>東ソー株式会社</p></div>'
                '<div class="mod-newsTtl"><p class="mod-newsTtl-time">' + escape(day) + '</p>'
                '<h1 class="mod-h1">' + escape(title) + '</h1></div><div class="mod-txt" ' + hidden + '>'
                '<p>' + escape(self.body if body is None else body) + '</p></div>'
                '<h3>株式譲受日</h3><p>2027年3月31日（予定）</p>'
                '<h2>お問い合わせ先</h2><p>PRIVATE CONTACT 東ソー株式会社</p></div></main></html>').encode()

    def item(self, payload=None):
        items = common.parse_feed(self.index() if payload is None else payload, '東ソー', NOW, SINCE, self.catalogue)
        self.assertEqual(len(items), 1)
        return items[0]

    def extract(self, payload=None):
        return common.extract_article(self.article() if payload is None else payload, self.item(),
                                      self.url, NOW, SINCE, catalogue=self.catalogue)

    def test_visible_original_day_and_alias_are_used_print_header_and_future_event_are_separate(self):
        result = self.extract()
        self.assertEqual(result['published_date'], DAY)
        self.assertIsNone(result['published_at'])
        self.assertEqual(result['related_company'], '東ソー')
        self.assertEqual(result['publication_evidence']['index_date_fields'], {'date': DAY})
        self.assertTrue(common.valid_identity(result, self.catalogue))
        self.assertIn('2027年3月31日（予定）', result['body'])
        self.assertNotIn('2099', result['body'])
        self.assertNotIn('PRIVATE', result['body'])

    def test_parent_alias_must_be_opening_actor_and_hidden_or_subsidiary_signers_are_rejected(self):
        for body in ('東ソー・ファインケムは、発表しました。' + BODY,
                     '別の会社は、発表しました。' + BODY + '東ソーは参加します。',
                     'これは東ソーは参加するという架空の説明です。' + BODY):
            self.assertIsNone(self.extract(self.article(body=body)))
        self.assertIsNone(self.extract(self.article(hidden='hidden')))

    def test_original_heading_day_canonical_and_current_membership_must_match(self):
        for payload in (self.article(day='2026.10.01'), self.article(title='別の共同開発'),
                        self.article(url=self.url.replace('20261002', '20261003'))):
            self.assertIsNone(self.extract(payload))
        self.catalogue.members['4042.T']['name'] = 'different'
        self.assertEqual(common.parse_feed(self.index(), '東ソー', NOW, SINCE, self.catalogue), [])

    def test_discovery_day_year_path_pdf_query_and_external_routes_fail_closed(self):
        for options in ({'day': '2026.10.01'}, {'year': '2025'}, {'day': ''},
                        {'url': self.url.replace('.html', '.pdf')}, {'url': self.url + '?x=1'},
                        {'url': self.url.replace('www.tosoh.co.jp', 'example.com')}):
            self.assertEqual(common.parse_feed(self.index(**options), '東ソー', NOW, SINCE, self.catalogue), [])


if __name__ == '__main__':
    unittest.main()

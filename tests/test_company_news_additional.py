"""Fictional release text in eight inspected official page structures.

No production source bodies, network access or paid AI calls are used.
"""
from copy import deepcopy
from datetime import date, datetime
from html import escape
import json
import unittest

import company_news_additional as sources

NOW = datetime(2026, 10, 10, 20, tzinfo=sources.JST)
SINCE = date(2026, 10, 7)
DAY = '2026-10-09'
STAMP = '2026-10-09T11:00:00+09:00'
TITLE = '検証用の架空設備を共同開発する提携を発表'
PATHS = {'toyota': '/jp/newsroom/corporate/44911302.html', 'honda': '/jp/news/2026/4261009.html',
         'softbank': '/news/press/20261009', 'nec': '/press/202610/20261009_01.html',
         'dentsu': '/jp/news/release/001754.html', 'mhi': '/jp/news/261009.html',
         'osakagas': '/company/press/pr2026/1825621_60967.html', 'bridgestone': '/corporate/news/2026100901.html'}


class Catalogue:
    def __init__(self):
        self.members = {cfg['symbol']: {'symbol': cfg['symbol'], 'name': cfg['name'],
                        'business': None, 'business_sources': []} for cfg in sources.SOURCES.values()}
        self.provenance = {'as_of': DAY, 'source_sha256': 'b' * 64}
        self.facts_sha256 = 'a' * 64


def url(label):
    config = sources.SOURCES[label]
    return 'https://' + config['host'] + PATHS[config['template']]


def feed(label, *, title=TITLE, link=None, stamp=STAMP, extra='', rdf=False):
    link = url(label) if link is None else link
    if rdf:
        return ('<rdf:RDF xmlns:rdf="' + sources.RDF + '" xmlns="' + sources.RSS + '" '
                'xmlns:dc="' + sources.DC + '"><channel/><item><title>' + escape(title) + '</title>'
                '<link>' + escape(link) + '</link><dc:date>' + stamp + '</dc:date>' + extra
                + '</item></rdf:RDF>').encode()
    return ('<rss><channel><item><title>' + escape(title) + '</title><link>' + escape(link)
            + '</link><pubDate>' + stamp + '</pubDate>' + extra + '</item></channel></rss>').encode()


def body(label, *, actor=None):
    actor = actor or sources.SOURCES[label]['actors'][0]
    return (actor + 'は、検証用の架空設備を共同開発する提携を発表しました。'
            'この文章はソフトウェアの解析確認専用に作成した架空の文章で、実際の会社の発表や事業ではありません。'
            '利用条件や動作を確認する実験用の仕組みについて、確認結果と利用する際の条件を説明しています。'
            '今後の実験予定は発表日ではなく計画として記載しています。')


def article(label, *, title=TITLE, text=None, visible=DAY, clock=STAMP, extra='', hidden=''):
    cfg = sources.SOURCES[label]
    text = body(label) if text is None else text
    value, header, day = escape(text), escape(title), escape(visible)
    template = cfg['template']
    if template == 'toyota':
        markup = ('<div class="contents_main"><div class="section html article_info">'
                  f'<h1 class="title">{header}</h1><p class="date">{day}</p></div>'
                  f'<div class="section html"><p>{value}{hidden}</p></div></div>')
    elif template == 'honda':
        obj = {'@type': 'NewsArticle', 'datePublished': clock, 'headline': title}
        markup = ('<script type="application/ld+json">' + json.dumps(obj) + '</script>'
                  '<main class="tp22"><article><div class="p-post22__head">'
                  f'<h1 class="p-post22__title">{header}</h1><time class="c-time22" datetime="2023-00-00">{day}</time>'
                  f'</div><div class="p-post22__body"><p>{value}{hidden}</p></div></article></main>')
    elif template == 'softbank':
        markup = ('<main><article><article data-history-node-id="123"><h1>' + header + '</h1>'
                  f'<time datetime="{escape(clock)}">{day}</time><div class="field-content"><p>{value}{hidden}</p>'
                  '</div></article></article></main>')
    elif template == 'nec':
        markup = ('<main class="site-main"><h1 class="hdg">' + header + '</h1><div class="str-column-main">'
                  f'<div><p class="align-right">{day}</p></div><div><p>{value}{hidden}</p></div>'
                  '<div><h2>本件に関するお問い合わせ先</h2></div><div>PRIVATE CONTACT</div></div></main>')
    elif template == 'dentsu':
        markup = ('<main class="wrap-main"><h1 class="hdg-lv1-article">' + header + '</h1>'
                  f'<div class="wrap-article-info"><div><p>{day}</p></div></div>'
                  f'<div class="wrap-edit"><p>{value}{hidden}</p></div></main>')
    elif template == 'mhi':
        markup = ('<article><div id="comMainContent"><h1>' + header + '</h1>'
                  f'<div class="field--name-field-published-date"><time datetime="2026-10-09T11:00:00Z">{day}</time></div>'
                  f'<div class="field--name-field-description"><p>{value}{hidden}</p></div>'
                  '<div class="field--name-body">PRIVATE CONTACT</div></div></article>')
    elif template == 'osakagas':
        markup = ('<div id="contents"><h2>' + header + '</h2>'
                  f'<p class="aRight marB10">{day}</p><p>{value}{hidden}</p>'
                  '<div class="secShare">PRIVATE CONTACT</div></div>')
    else:
        markup = ('<article id="main"><div class="h2_basic01Wrap"><h2 class="h2_basic01">' + header + '</h2></div>'
                  f'<p class="txt01 taR">{day}</p><p class="txt01">{value}{hidden}</p>'
                  '<div class="box01Wrap">PRIVATE CONTACT</div></article>')
    return ('<html><body><nav>UNRELATED NAV</nav>' + markup + extra
            + '<footer>UNRELATED FOOTER</footer></body></html>').encode()


class AdditionalSourceTests(unittest.TestCase):
    def setUp(self):
        self.catalogue = Catalogue()
        self.label = 'トヨタ自動車'

    def item(self, label=None, **options):
        label = label or self.label
        items = sources.parse_feed(feed(label, **options), label, NOW, SINCE, self.catalogue)
        self.assertEqual(len(items), 1)
        return items[0]

    def extract(self, label=None, *, item=None, **options):
        label = label or self.label
        item = self.item(label) if item is None else item
        return sources.extract_article(article(label, **options), item, item['url'], NOW, SINCE,
                                       catalogue=self.catalogue)

    def test_all_eight_inspected_templates_produce_catalogue_matched_private_inputs(self):
        self.assertEqual(sources.direct_feed_company_count(), 11)
        for label, cfg in sources.SOURCES.items():
            if cfg['template'] == 'prtimes_group':
                continue  # The independent distribution route has separate issuer/actor fixtures.
            with self.subTest(label=label):
                record = self.extract(label)
                self.assertIsNotNone(record)
                self.assertEqual(record['symbol'], cfg['symbol'])
                self.assertEqual(record['name'], cfg['name'])
                self.assertEqual(record['published_date'], DAY)
                self.assertEqual(record['business_context_mode'], 'announcement_only')
                self.assertEqual(record['business'], record['body'][:1800])
                self.assertTrue(sources.valid_identity(record, self.catalogue))
                self.assertNotIn('PRIVATE CONTACT', record['body'])
                self.assertNotIn('UNRELATED', record['body'])
                if cfg['template'] not in ('honda', 'softbank'):
                    self.assertIsNone(record['published_at'])
                    self.assertEqual(record['publication_precision'], 'day')

    def test_honda_and_softbank_retain_only_corroborated_original_clocks(self):
        for label in ('本田技研工業', 'ソフトバンクグループ'):
            record = self.extract(label)
            self.assertEqual(record['published_at'], sources._publication(STAMP)['published_at'])
            self.assertIsNone(self.extract(label, clock='2026-10-09T12:00:00+09:00'))
            self.assertIsNone(self.extract(label, clock='2026-10-11T12:00:00+09:00'))
        label = '本田技研工業'
        item = self.item(label)
        payload = article(label).replace(b'"headline": "', b'"headline": "OTHER ')
        self.assertIsNone(sources.extract_article(payload, item, item['url'], NOW, SINCE,
                                                  catalogue=self.catalogue))

    def test_rdf_namespace_dates_are_retained(self):
        for label in ('本田技研工業', '大阪ガス'):
            item = sources.parse_feed(feed(label, rdf=True), label, NOW, SINCE, self.catalogue)[0]
            self.assertEqual(item['feed_date_fields'], {'{' + sources.DC + '}date': STAMP})

    def test_exact_verified_tracking_is_removed_and_other_queries_are_rejected(self):
        for label, tracking in (('本田技研工業', 'from=RSS'), ('ブリヂストン', 'ref=rss')):
            canonical = url(label)
            self.assertEqual(sources.safe_url('  ' + canonical + '?' + tracking + '\n', label), canonical)
            self.assertEqual(self.item(label, link=canonical + '?' + tracking)['url'], canonical)
            for suffix in ('?other=RSS', '?' + tracking + '&extra=1', '#story'):
                self.assertIsNone(sources.safe_url(canonical + suffix, label))

    def test_fetch_allowlist_rejects_external_ports_credentials_private_encoded_and_cross_company_urls(self):
        for unsafe in ('https://localhost/news/press/20261009', 'https://127.0.0.1/news/press/20261009',
                       'http://global.toyota/jp/newsroom/corporate/44911302.html',
                       'https://user@global.toyota/jp/newsroom/corporate/44911302.html',
                       'https://global.toyota:444/jp/newsroom/corporate/44911302.html',
                       'https://global.toyota/jp/newsroom/corporate/%2e%2e/44911302.html',
                       'https://global.toyota/jp/newsroom/corporate/44911302.html?x=1',
                       'https://global.toyota/jp/newsroom/corporate/44911302.html\\x', url('本田技研工業')):
            self.assertIsNone(sources.safe_url(unsafe, self.label), unsafe)
        self.assertIsNone(sources.safe_url(url(self.label), 'unknown'))

    def test_each_company_requires_current_provided_catalogue_identity_for_discovery(self):
        cfg = sources.SOURCES[self.label]
        for mutation in ('missing', 'name', 'symbol'):
            cat = Catalogue()
            if mutation == 'missing':
                del cat.members[cfg['symbol']]
            else:
                cat.members[cfg['symbol']][mutation] = 'incorrect'
            self.assertFalse(sources.valid_identity(self.label, cat))
            self.assertEqual(sources.parse_feed(feed(self.label), self.label, NOW, SINCE, cat), [])

    def test_original_heading_day_layout_and_redirect_must_agree(self):
        item = self.item()
        self.assertIsNone(self.extract(title='別の共同開発ニュース'))
        self.assertIsNone(self.extract(visible='2026-10-08'))
        self.assertIsNone(self.extract(visible='2026-10-11'))
        self.assertIsNone(sources.extract_article(article(self.label), item, url('本田技研工業'), NOW,
                                                  SINCE, catalogue=self.catalogue))
        self.assertIsNone(sources.extract_article(b'<h1>' + TITLE.encode() + b'</h1>', item, item['url'],
                                                  NOW, SINCE, catalogue=self.catalogue))

    def test_absent_short_or_oversized_body_never_falls_back_to_feed_or_page(self):
        for value in ('', '短い文章', body(self.label) + '文' * 20_000):
            self.assertIsNone(self.extract(text=value))

    def test_titles_over_400_and_routine_or_future_releases_never_queue(self):
        for options in ({'title': '提携' + '文' * 399}, {'title': 'イベント出展について'},
                        {'stamp': '2026-10-11T11:00:00+09:00'}, {'stamp': '2026-10-01'},
                        {'extra': '<pubDate>2026-10-11T11:00:00+09:00</pubDate>'}):
            self.assertEqual(sources.parse_feed(feed(self.label, **options), self.label, NOW, SINCE,
                                               self.catalogue), [])

    def test_duplicate_conflicting_fields_and_declarations_fail_closed(self):
        for value in (feed(self.label, extra='<title>違う提携</title>'),
                      feed(self.label, extra='<dc:date xmlns:dc="' + sources.DC + '">2026-10-08</dc:date>')):
            self.assertEqual(sources.parse_feed(value, self.label, NOW, SINCE, self.catalogue), [])
        for value in (b'<!DOCTYPE rss><rss><channel/></rss>', b'<html/>', b'<rss>', b'\xff'):
            with self.assertRaises(ValueError):
                sources.parse_feed(value, self.label, NOW, SINCE, self.catalogue)

    def test_parent_only_mentioned_later_possessive_partner_and_brand_collisions_are_rejected(self):
        parent = sources.SOURCES[self.label]['issuer']
        for value in ('他社は、架空の設備の開発を開始しました。' + '架空文章。' * 30 + '\n' + parent,
                      parent + 'の取引先が発表しました。' + '架空文章。' * 30,
                      '別会社は、' + parent + 'と提携しました。' + '架空文章。' * 30):
            self.assertIsNone(self.extract(text=value))
        label = '本田技研工業'
        self.assertIsNone(self.extract(label, text=body(label, actor='HondaJet')))
        self.assertIsNone(self.extract(label, text=body(label, actor='Honda Racing')))
        self.assertIsNotNone(self.extract(label, text=body(label, actor='Honda')))

    def test_hidden_actor_is_not_publication_evidence(self):
        for hidden in ('<span hidden>' + sources.SOURCES[self.label]['issuer'] + 'は</span>',
                       '<span style="display:none">' + sources.SOURCES[self.label]['issuer'] + 'は</span>'):
            self.assertIsNone(self.extract(text='別会社の架空文章。' * 30, hidden=hidden))

    def test_durable_identity_rejects_changed_label_symbol_actor_path_provenance_and_business_mode(self):
        record = self.extract()
        for key, value in [('source', '本田技研工業'), ('symbol', '7267.T'), ('name', '偽名'),
                           ('related_company', '別会社'), ('url', 'https://global.toyota/anything.html'),
                           ('catalogue_as_of', '2026-10-08'), ('catalogue_source_sha256', 'c' * 64),
                           ('catalogue_facts_sha256', 'c' * 64), ('business_context_mode', 'unknown'),
                           ('business', '捏造された事業です。'), ('business_url', 'https://example.com/')]:
            with self.subTest(key=key):
                self.assertFalse(sources.valid_identity(dict(record, **{key: value}), self.catalogue))
        self.assertFalse(sources.valid_identity(record, None))
        self.assertFalse(sources.valid_identity([], self.catalogue))

    def test_profile_added_later_keeps_original_announcement_only_identity(self):
        record = self.extract()
        self.catalogue.members[record['symbol']].update(business='新しい審査済みの架空事業説明です。',
            business_sources=[{'url': 'https://global.toyota/jp/company/'}])
        self.assertTrue(sources.valid_identity(record, self.catalogue))

    def test_verified_profile_context_is_not_invented_or_recomputed_for_archived_records(self):
        member = self.catalogue.members[sources.SOURCES[self.label]['symbol']]
        member.update(business='審査済みの架空事業説明として実装を確認します。',
                      business_sources=[{'url': 'https://global.toyota/jp/company/'}])
        record = self.extract()
        self.assertEqual(record['business_context_mode'], 'verified_profile')
        self.assertTrue(sources.valid_identity(record, self.catalogue))
        member['business'] = '変更後の架空説明です。'
        self.assertTrue(sources.valid_identity(record, self.catalogue))
        self.assertFalse(sources.valid_identity(dict(record, business_url='http://example.com/'), self.catalogue))

    def test_date_only_publication_does_not_invent_midnight_or_claim_after_partial_day_cutoff(self):
        item = self.item(stamp=DAY)
        record = self.extract(item=item)
        self.assertIsNone(record['published_at'])
        noon = datetime(2026, 10, 9, 12, tzinfo=sources.JST)
        self.assertEqual(sources.parse_feed(feed(self.label, stamp=DAY), self.label, NOW, noon, self.catalogue), [])

    def test_tampered_feed_evidence_and_invalid_observation_clock_are_rejected(self):
        item = self.item()
        for mutated in (dict(item, published_date='2026-10-08'), dict(item, issuer='別会社'),
                        dict(item, feed_date_fields={'unsafe': STAMP})):
            self.assertIsNone(self.extract(item=mutated))
        for value in (True, float('nan'), -1):
            with self.assertRaises(ValueError):
                sources.extract_article(article(self.label), item, item['url'], NOW, SINCE,
                                         observed_at=value, catalogue=self.catalogue)


if __name__ == '__main__':
    unittest.main()

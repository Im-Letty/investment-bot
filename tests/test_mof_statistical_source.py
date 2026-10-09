"""Real publisher template, fictional values; never a published news draft."""
from datetime import datetime
from html import escape
from unittest import TestCase
from unittest.mock import patch

import official_news_sources as sources


class MinistryStatisticalPublicationTests(TestCase):
    url = 'https://www.mof.go.jp/policy/international_policy/reference/balance_of_payments/preliminary/pg202608.htm'
    archive_url = 'https://www.mof.go.jp/public_relations/whats_new/202610.html'
    title = '令和8年8月中 国際収支状況（速報）の概要'
    now = datetime(2026, 10, 9, 7, 20, tzinfo=sources.JST)
    since = datetime(2026, 10, 8, tzinfo=sources.JST)
    body = 'これは取得検証専用の架空の統計本文です。実際の経済状況ではありません。' * 4

    def item(self):
        return {'source': '財務省', 'title': self.title, 'url': self.url,
                **sources._publication('Thu, 08 Oct 2026 08:50:00 +0900')}

    def html(self, *, meta='2026-10-05', dateline='令和8年10月8日', publisher='財務省',
             heading=None, extra='', before='', after=''):
        return (f'<html><head><meta charset="utf-8"><meta name="date" content="{escape(meta)}">{extra}</head>'
                f'<main id="main"><h1>{escape(heading or self.title)}</h1><section class="content-section">'
                f'{before}<p class="text-right">{escape(dateline)}</p><p class="text-right">{escape(publisher)}</p>'
                f'<h2>{escape(heading or self.title)}</h2><div class="unique-block"><p>{self.body}</p>{after}</div>'
                '</section></main></html>').encode()

    def archive(self, *, day='令和8年10月08日（木曜日）', title=None, url=None,
                category='international', label='国際政策', duplicate=False):
        entry = (f'<li class="information-item"><a class="information-item-inner" href="{escape(url or self.url)}">'
                 f'<span class="information-item-label label -{category}">{escape(label)}</span>'
                 f'<div class="information-item-content"><p>{escape(title or self.title)}</p></div></a></li>')
        return (f'<html><meta charset="utf-8"><main id="main"><h1>令和8年（2026年）新着情報：10月</h1>'
                f'<section><h3>{escape(day)}</h3><ul class="information">{entry}{entry if duplicate else ""}</ul>'
                '</section></main></html>').encode()

    def extract(self, *, html=None, archive=None, item=None, final=None):
        item = item or self.item()
        with patch.object(sources, '_download', return_value=(archive or self.archive(), self.archive_url)) as download:
            row = sources._extract_article(html or self.html(), item, final or item['url'], self.now,
                self.since, observed_at=self.now.timestamp(), deadline=12345)
        return row, download

    def test_stale_cms_date_needs_visible_dateline_and_official_archive(self):
        row, download = self.extract()
        self.assertEqual(row['published_date'], '2026-10-08')
        self.assertEqual(row['published_at'], self.item()['published_at'])
        self.assertEqual(row['page_metadata_date'], '2026-10-05')
        self.assertEqual(row['body'], self.body)
        self.assertEqual(row['observed_at'], self.now.timestamp())
        self.assertEqual(row['publication_evidence']['url'], self.archive_url)
        download.assert_called_once_with(self.archive_url, 12345,
            max_bytes=sources.MAX_BYTES - len(self.html()), publication_archive=True)

    def test_hidden_duplicate_table_captions_and_css_are_excluded_from_result(self):
        markup = ('<style type="text/css">.data{color:black}</style>'
                  '<table><caption style="visibility:hidden">重複の表タイトル</caption>'
                  '<tr><th>今回</th><td>比較値</td></tr></table>')
        row, _ = self.extract(html=self.html(after=markup))
        self.assertIsNotNone(row)
        self.assertIn('今回', row['body'])
        self.assertIn('比較値', row['body'])
        self.assertNotIn('重複の表タイトル', row['body'])
        self.assertNotIn('color:black', row['body'])

    def test_archive_identity_date_label_and_unique_placement_required(self):
        for archive in (self.archive(day='令和8年10月07日（水曜日）'),
                        self.archive(day='令和8年10月08日（金曜日）'),
                        self.archive(title='別の統計'), self.archive(url=self.url.replace('202608', '202607')),
                        self.archive(category='conference', label='会見等'),
                        self.archive(duplicate=True)):
            with self.subTest(archive=archive):
                self.assertIsNone(self.extract(archive=archive)[0])

    def test_visible_publisher_dateline_and_result_period_required(self):
        for html in (self.html(dateline='令和8年10月7日'), self.html(dateline='令和8年13月8日'),
                     self.html(publisher='別の発行元'), self.html(heading=self.title.replace('8月中', '7月中')),
                     self.html(before='<p>引用された別文書</p>'),
                     self.html(before='引用された別文書：'),
                     self.html().replace(b'text-right', b'reference-date')):
            with self.subTest(html=html):
                row, download = self.extract(html=html)
                self.assertIsNone(row)
                download.assert_not_called()

    def test_nonvisible_archive_entries_do_not_establish_publication_date(self):
        archive = self.archive()
        for altered in (archive.replace(b'<main id="main">', b'<main id="main" hidden>'),
                        archive.replace(b'<section>', b'<section aria-hidden="true">'),
                        archive.replace(b'class="information-item"', b'class="information-item" style="display:none"'),
                        archive.replace(b'<h3>', b'<h3 hidden>'),
                        archive.replace(b'class="information-item-content"', b'class="information-item-content" hidden'),
                        archive.replace(b'<p>', b'<p hidden>', 1)):
            with self.subTest(archive=altered):
                self.assertIsNone(self.extract(archive=altered)[0])

    def test_other_explicit_publication_metadata_and_future_cms_dates_still_reject(self):
        for html in (self.html(meta='2026-10-10'), self.html(meta='invalid'),
                     self.html(extra='<meta property="article:published_time" content="2026-10-07T08:50:00+09:00">'),
                     self.html(extra='<meta property="og:url" content="https://example.test/other">'),
                     self.html(after='<p>2026年10月7日公表</p>')):
            with self.subTest(html=html):
                row, download = self.extract(html=html)
                self.assertIsNone(row)
                download.assert_not_called()

    def test_arbitrary_pages_and_redirects_cannot_use_this_exception(self):
        for url in (self.url.replace('pg202608.htm', 'other.htm'),
                    'https://www.mof.go.jp/policy/budget/topics/test.html'):
            item = {**self.item(), 'url': url}
            row, download = self.extract(item=item)
            self.assertIsNone(row)
            download.assert_not_called()
        row, download = self.extract(final=self.url.replace('pg202608.htm', 'pg202607.htm'))
        self.assertIsNone(row)
        download.assert_not_called()

    def test_hidden_or_auxiliary_datelines_cannot_override_metadata(self):
        html = self.html()
        for altered in (html.replace(b'class="text-right"', b'hidden class="text-right"', 1),
                        html.replace(b'class="text-right"', b'aria-hidden="true" class="text-right"', 1),
                        html.replace(b'class="text-right"', b'style="display: none !important;" class="text-right"', 1),
                        html.replace(b'class="content-section"', b'class="content-section related"'),
                        html.replace(b'<section class="content-section">', b'<aside class="content-section">')
                            .replace(b'</section>', b'</aside>')):
            with self.subTest(html=altered):
                row, download = self.extract(html=altered)
                self.assertIsNone(row)
                download.assert_not_called()

    def test_hidden_evidence_descendants_are_not_visible_release_content(self):
        html = self.html()
        for altered in (html.replace(b'<h1>', b'<h1 hidden>'),
                        html.replace('令和8年10月8日</p>'.encode(),
                                     '<span hidden>令和8年10月8日</span></p>'.encode()),
                        html.replace(b'<div class="unique-block"><p>', b'<div class="unique-block"><p hidden>')):
            with self.subTest(html=altered):
                row, download = self.extract(html=altered)
                self.assertIsNone(row)
                download.assert_not_called()

    def test_extra_or_future_result_periods_cannot_be_reclassified(self):
        for title in (self.title.replace('8月中', '8月中 別文書の参考資料'),
                      self.title.replace('8月中', '8月中 令和8年7月中'),
                      self.title.replace('8月中', '10月中'), self.title.replace('8月中', '12月中')):
            with self.subTest(title=title):
                item = {**self.item(), 'title': title}
                if '10月中' in title:
                    item['url'] = self.url.replace('202608', '202610')
                if '12月中' in title:
                    item['url'] = self.url.replace('202608', '202612')
                row, download = self.extract(item=item, html=self.html(heading=title), archive=self.archive(title=title))
                self.assertIsNone(row)
                download.assert_not_called()

    def test_collection_records_real_verification_time_not_morning_cutoff(self):
        rss = (f'<rss><channel><item><title>{escape(self.title)}</title><link>{self.url}</link>'
               '<pubDate>Thu, 08 Oct 2026 08:50:00 +0900</pubDate></item></channel></rss>').encode()
        docs = {sources.FEEDS['財務省']: rss, self.url: self.html(), self.archive_url: self.archive()}
        actual = datetime(2026, 10, 9, 14, 30, tzinfo=sources.JST).timestamp()
        diagnostics = {}
        with patch.object(sources, '_download', side_effect=lambda url, *a, **k: (docs[url], url)):
            rows = sources.collect_official_articles(self.now, since=self.since,
                enabled_sources=('財務省',), diagnostics=diagnostics, clock=lambda: actual)
        self.assertEqual(rows[0]['body_verified_at'], actual)
        self.assertEqual(rows[0]['published_date'], '2026-10-08')
        self.assertEqual(diagnostics['財務省']['status'], 'collected')

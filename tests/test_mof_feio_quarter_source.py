"""Inspected MOF quarter structure with fictional values; no original prose/AI/network."""
from datetime import date, datetime
from html import escape
from unittest import TestCase
from unittest.mock import patch

import official_news_sources as sources


class MofFeioQuarterSourceTests(TestCase):
    url = 'https://www.mof.go.jp/policy/international_policy/reference/feio/data/quarter/2026_3Q.html'
    archive_url = 'https://www.mof.go.jp/public_relations/whats_new/202611.html'
    title = '外国為替平衡操作の実施状況(令和8年7月～令和8年9月)'
    now = datetime(2026, 11, 9, 15, 0, tzinfo=sources.JST)
    body = ('<table><thead><tr><th>架空の実施日</th><th>架空の金額</th></tr></thead>'
            '<tbody><tr><td>令和8年7月30日</td><td>'
            + 'これは取得検証専用の架空の表です。実際の為替介入や統計値ではありません。' * 4
            + '</td></tr></tbody></table>')

    def item(self, *, url=None, title=None, day='2026-11-09'):
        return {'source': '財務省', 'url': url or self.url, 'title': title or self.title,
                **sources._publication(day + 'T08:50:00+09:00')}

    def html(self, *, meta='2026-10-27', dateline='令和8年11月9日', publisher='財務省',
             heading=None, subtitle=None, body=None, before='', after='', extra='',
             canonical=None, section_class='content-section'):
        heading = self.title if heading is None else heading
        subtitle = heading if subtitle is None else subtitle
        date_html = '' if dateline is None else '<p class="text-right">' + escape(dateline) + '</p>'
        meta_html = '' if meta is None else '<meta name="date" content="' + escape(meta) + '">'
        original = self.url if canonical is None else canonical
        return ('<html><head><meta charset="utf-8">' + meta_html + extra
                + '<link rel="canonical" href="' + escape(original) + '">'
                + '<meta property="og:url" content="' + escape(original) + '"></head>'
                + '<main id="main"><h1>' + escape(heading) + '</h1>'
                + '<section class="' + section_class + '">' + before + date_html
                + '<p class="text-right">' + escape(publisher) + '</p><h2>'
                + escape(subtitle) + '</h2><div class="unique-block">'
                + (self.body if body is None else body) + '</div>' + after
                + '<aside class="contact-box"></aside></section></main></html>').encode()

    def archive(self, *, day='令和8年11月09日（月曜日）', title=None, url=None,
                category='international', label='国際政策', duplicate=False, hidden=''):
        entry = ('<li class="information-item"><a class="information-item-inner" href="'
                 + escape(url or self.url) + '"><span class="information-item-label label -'
                 + category + '">' + label + '</span><div class="information-item-content"><p>'
                 + escape(title or self.title) + '</p></div></a></li>')
        return ('<html><meta charset="utf-8"><main id="main"><h1>令和8年（2026年）新着情報：11月</h1>'
                + '<section' + hidden + '><h3>' + escape(day) + '</h3><ul class="information">'
                + entry + (entry if duplicate else '') + '</ul></section></main></html>').encode()

    def extract(self, *, html=None, archive=None, item=None, final=None, since=None):
        item = item or self.item()
        with patch.object(sources, '_download', return_value=(archive or self.archive(), self.archive_url)) as fetch:
            row = sources._extract_article(html or self.html(), item, final or item['url'], self.now,
                date(2026, 11, 9) if since is None else since, observed_at=self.now.timestamp(), deadline=12345)
        return row, fetch

    def test_visible_date_and_independent_archive_recover_only_quarter_template(self):
        row, fetch = self.extract()
        self.assertIsNotNone(row)
        self.assertEqual(row['published_date'], '2026-11-09')
        self.assertIsNone(row['published_at'])
        self.assertEqual(row['publication_precision'], 'day')
        self.assertEqual(row['page_metadata_date'], '2026-10-27')
        self.assertEqual(row['source_scope'], 'official_mof_feio_quarter_html_with_verified_publication_archive')
        self.assertEqual(row['publication_evidence']['url'], self.archive_url)
        fetch.assert_called_once_with(self.archive_url, 12345,
            max_bytes=sources.MAX_BYTES - len(self.html()), publication_archive=True)

    def test_missing_or_conflicting_publication_evidence_stays_rejected(self):
        for html in [self.html(dateline=None), self.html(dateline='令和8年11月8日'),
                     self.html(dateline='令和8年11月10日'), self.html(meta='2026-11-10'),
                     self.html(meta='invalid'), self.html(publisher='別の発行元'),
                     self.html(extra='<meta name="date" content="2026-10-28">'),
                     self.html(extra='<meta property="article:published_time" content="2026-11-08T08:50:00+09:00">'),
                     self.html(after='<p class="text-right">令和8年11月8日</p>'),
                     self.html(before='<p class="text-right">令和8年11月9日</p>')]:
            with self.subTest(html=html):
                row, fetch = self.extract(html=html)
                self.assertIsNone(row)
                fetch.assert_not_called()

    def test_arbitrary_footer_date_cannot_replace_missing_adjacent_dateline(self):
        html = self.html(dateline=None).replace(b'</main>', '<footer>令和8年11月9日公表</footer></main>'.encode())
        row, fetch = self.extract(html=html)
        self.assertIsNone(row)
        fetch.assert_not_called()

    def test_matching_cms_day_alone_cannot_bypass_visible_and_archive_contract(self):
        row, fetch = self.extract(html=self.html(meta='2026-11-09', dateline=None))
        self.assertIsNone(row)
        fetch.assert_not_called()
        row, fetch = self.extract(html=self.html(meta='2026-11-09'), archive=self.archive(day='令和8年11月08日（日曜日）'))
        self.assertIsNone(row)
        fetch.assert_called_once()

    def test_quarter_url_h1_h2_and_feed_identity_must_all_agree(self):
        cases = [dict(item=self.item(url=self.url.replace('_3Q', '_2Q'))),
                 dict(item=self.item(url=self.url.replace('2026_', '2025_'))),
                 dict(html=self.html(subtitle=self.title.replace('7月', '6月'))),
                 dict(html=self.html(heading=self.title.replace('9月', '10月'))),
                 dict(item=self.item(title=self.title + 'の別資料')),
                 dict(html=self.html(heading=self.title + 'の参考資料')),
                 dict(item=self.item(day='2026-11-08'))]
        for case in cases:
            with self.subTest(case=case):
                row, fetch = self.extract(**case)
                self.assertIsNone(row)
                fetch.assert_not_called()

    def test_future_or_unfinished_period_is_not_a_completed_quarter_report(self):
        title = self.title.replace('7月', '10月').replace('9月', '12月')
        item = self.item(url=self.url.replace('_3Q', '_4Q'), title=title)
        row, fetch = self.extract(html=self.html(heading=title, canonical=item['url']), item=item)
        self.assertIsNone(row)
        fetch.assert_not_called()

    def test_hidden_or_duplicate_structures_do_not_establish_release_provenance(self):
        original = self.html()
        for html in [original.replace(b'<main id="main">', b'<main id="main" hidden>'),
                     original.replace(b'<h1>', b'<h1 hidden>'),
                     original.replace(b'<p class="text-right">', b'<p hidden class="text-right">', 1),
                     original.replace(b'<h2>', b'<h2 aria-hidden="true">'),
                     original.replace(b'<div class="unique-block">', b'<div hidden class="unique-block">'),
                     original.replace(b'</h1>', b'</h1><h1>duplicate</h1>'),
                     original.replace(b'</section>', b'<div class="unique-block">duplicate</div></section>'),
                     original.replace(b'<main id="main">', b'<main id="main"></main><main id="main">')]:
            with self.subTest(html=html):
                row, fetch = self.extract(html=html)
                self.assertIsNone(row)
                fetch.assert_not_called()

    def test_archive_requires_exact_unique_visible_category_title_url_and_day(self):
        for archive in [self.archive(duplicate=True), self.archive(title='別の資料'),
                        self.archive(url=self.url.replace('_3Q', '_2Q')),
                        self.archive(category='conference', label='会見等'),
                        self.archive(day='令和8年11月08日（日曜日）'),
                        self.archive(day='令和8年11月09日（火曜日）'),
                        self.archive(hidden=' hidden')]:
            with self.subTest(archive=archive):
                row, fetch = self.extract(archive=archive)
                self.assertIsNone(row)
                fetch.assert_called_once()

    def test_original_redirect_or_declared_identity_mismatch_is_rejected(self):
        for case in [dict(final=self.url.replace('_3Q', '_2Q')),
                     dict(html=self.html(canonical=self.url + '?bad=1')),
                     dict(html=self.html(extra='<meta property="og:url" content="' + self.url + '">')),
                     dict(item=self.item(url=self.url.replace('feio/data/quarter/2026_3Q.html', 'other/report.html')))]:
            with self.subTest(case=case):
                row, fetch = self.extract(**case)
                self.assertIsNone(row)
                fetch.assert_not_called()

    def test_meaningful_result_and_visible_table_are_required_not_pdf_only_links(self):
        for body in ['', '<p>短すぎる架空の本文。</p>',
                     '<p>' + '架空の資料リンクであり原報告本文ではありません。' * 8 + '</p><a href="data.pdf">PDF</a>',
                     '<table><tr><td>' + '架空のデータ。' * 30 + '</td></tr></table>']:
            with self.subTest(body=body):
                row, fetch = self.extract(html=self.html(body=body))
                self.assertIsNone(row)
                fetch.assert_not_called()

    def test_day_precision_does_not_invent_after_cutoff_eligibility(self):
        row, fetch = self.extract(since=datetime(2026, 11, 9, 8, 0, tzinfo=sources.JST))
        self.assertIsNone(row)
        fetch.assert_not_called()

    def test_current_year_spreadsheet_index_is_not_silently_excluded(self):
        index = 'https://www.mof.go.jp/policy/international_policy/reference/gaitametokkai/index.html'
        item = self.item(url=index, title='外国為替資金特別会計の外貨建資産の内訳及び運用収入の内訳等')
        rss = ('<rss><channel><item><title>' + escape(item['title']) + '</title><link>' + index
               + '</link><pubDate>Mon, 09 Nov 2026 08:50:00 +0900</pubDate></item></channel></rss>').encode()
        self.assertEqual(sources._feed_items(rss, sources.FEEDS['財務省'], self.now, date(2026, 11, 9)), [item])
        html = ('<html><meta charset="utf-8"><meta name="date" content="2026-10-29"><main id="main"><h1>'
                + item['title'] + '</h1><ul><li><a href="gaitametokkai_20261109.xlsx">Excel</a>'
                + '</li></ul></main></html>').encode()
        row, fetch = self.extract(html=html, item=item)
        self.assertIsNone(row)
        fetch.assert_not_called()

    def test_verified_quarter_does_not_hide_unverified_index_in_collection_health(self):
        index = 'https://www.mof.go.jp/policy/international_policy/reference/gaitametokkai/index.html'
        index_title = '外国為替資金特別会計の外貨建資産の内訳及び運用収入の内訳等'
        entries = [(self.url, self.title), (index, index_title)]
        rss = ('<rss><channel>' + ''.join('<item><title>' + escape(title) + '</title><link>' + url
               + '</link><pubDate>Mon, 09 Nov 2026 08:50:00 +0900</pubDate></item>'
               for url, title in entries) + '</channel></rss>').encode()
        index_html = ('<html><meta charset="utf-8"><main id="main"><h1>' + index_title
                      + '</h1><ul><li><a href="gaitametokkai_20261109.xlsx">Excel</a></li></ul></main></html>').encode()
        docs = {sources.FEEDS['財務省']: rss, self.url: self.html(), self.archive_url: self.archive(), index: index_html}
        diagnostics = {}
        with patch.object(sources, '_download', side_effect=lambda url, *a, **k: (docs[url], url)):
            rows = sources.collect_official_articles(self.now, since=date(2026, 11, 9),
                enabled_sources=('財務省',), diagnostics=diagnostics, clock=lambda: self.now.timestamp())
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['url'], self.url)
        self.assertIsNone(rows[0]['published_at'])
        self.assertEqual(diagnostics['財務省']['candidates'], 2)
        self.assertEqual(diagnostics['財務省']['accepted'], 1)
        self.assertEqual(diagnostics['財務省']['status'], 'collected_partial')
        self.assertEqual(diagnostics['財務省']['errors'], ['body_or_date_unverified'])

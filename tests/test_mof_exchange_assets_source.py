"""Synthetic parent/archive/workbook binding; no original report values or transport."""
from datetime import date, datetime
from hashlib import sha256
from html import escape
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

import official_news_sources as sources


class MofExchangeAssetsSourceTests(TestCase):
    url = 'https://www.mof.go.jp/policy/international_policy/reference/gaitametokkai/index.html'
    workbook_url = 'https://www.mof.go.jp/policy/international_policy/reference/gaitametokkai/gaitametokkai_20261109.xlsx'
    archive_url = 'https://www.mof.go.jp/public_relations/whats_new/202611.html'
    title = '外国為替資金特別会計の外貨建資産の内訳及び運用収入の内訳等'
    now = datetime(2026, 11, 9, 19, 0, tzinfo=sources.JST)
    workbook = b'PK-synthetic-workbook-body-is-validated-by-separate-reader'
    body = 'これは親資料と公表日の対応だけを確かめる架空の報告本文です。実際の財務データではありません。' * 4

    def item(self, *, day='2026-11-09', url=None, title=None):
        return {'source': '財務省', 'title': title or self.title, 'url': url or self.url,
                **sources._publication(day + 'T08:50:00+09:00')}

    def html(self, *, link=None, duplicate=False, hidden='', heading=None, meta='2026-10-29', extra='', canonical=None):
        anchor = '<li><a' + hidden + ' href="' + escape(link or self.workbook_url) + '">Excel(Excel:29KB)</a></li>'
        original = self.url if canonical is None else canonical
        return ('<html><head><meta charset="utf-8"><meta name="date" content="' + escape(meta) + '">'
                + '<link rel="canonical" href="' + escape(original) + '"><meta property="og:url" content="'
                + escape(original) + '">' + extra + '</head><main id="main"><h1>'
                + escape(heading or self.title) + '</h1><h2>参考資料</h2><ul>' + anchor
                + (anchor if duplicate else '') + '<li><a href="gaitametokkai_20251110.xlsx">Excel</a>'
                + '</li></ul></main></html>').encode()

    def archive(self, *, day='令和8年11月09日（月曜日）', title=None, url=None, duplicate=False,
                category='international', label='国際政策'):
        entry = ('<li class="information-item"><a class="information-item-inner" href="'
                 + escape(url or self.url) + '"><span class="information-item-label label -' + category + '">'
                 + label + '</span><div class="information-item-content"><p>' + escape(title or self.title)
                 + '</p></div></a></li>')
        return ('<html><meta charset="utf-8"><main id="main"><h1>令和8年（2026年）新着情報：11月</h1>'
                + '<section><h3>' + escape(day) + '</h3><ul class="information">' + entry
                + (entry if duplicate else '') + '</ul></section></main></html>').encode()

    def report(self):
        return {'body': self.body, 'body_sha256': sha256(self.body.encode()).hexdigest(), 'title': '令和7年度 ' + self.title,
                'workbook_sha256': sha256(self.workbook).hexdigest(), 'reporting_fiscal_year': 2025,
                'fiscal_year_label': '令和7年度', 'source_kind': 'mof_exchange_assets_xlsx_cached_v1'}

    def extract(self, *, html=None, archive=None, item=None, report=None, final=None, since=None,
                parser_error=None, workbook_final=None, workbook=None):
        report = self.report() if report is None else report
        reader = MagicMock(return_value=report, side_effect=parser_error)
        docs = {self.archive_url: (archive or self.archive(), self.archive_url),
                self.workbook_url: (self.workbook if workbook is None else workbook,
                                    workbook_final or self.workbook_url)}
        with patch.dict('sys.modules', {'official_mof_exchange_assets_xlsx': SimpleNamespace(
                extract_mof_exchange_assets_workbook=reader)}), \
                patch.object(sources, '_download', side_effect=lambda url, *a, **k: docs[url]) as fetch:
            row = sources._extract_article(html or self.html(), item or self.item(), final or self.url,
                self.now, date(2026, 11, 9) if since is None else since,
                observed_at=self.now.timestamp(), deadline=12345)
        return row, fetch, reader

    def test_parent_archive_and_full_workbook_are_explicit_separate_provenance(self):
        row, fetch, reader = self.extract()
        self.assertIsNotNone(row)
        self.assertEqual(row['body'], self.body)
        self.assertEqual(row['evidence_url'], self.url)
        self.assertEqual(row['source_scope'], 'official_mof_exchange_assets_xlsx_with_verified_publication_archive')
        self.assertIsNone(row['published_at'])
        self.assertEqual(row['publication_precision'], 'day')
        self.assertEqual(row['published_date'], '2026-11-09')
        self.assertEqual(row['page_metadata_date'], '2026-10-29')
        proof = row['supporting_documents'][0]
        self.assertEqual(proof['url'], self.workbook_url)
        self.assertEqual(proof['publication_evidence_url'], self.archive_url)
        self.assertEqual(proof['reporting_fiscal_year'], 2025)
        self.assertIsNone(proof['publication_date_in_workbook'])
        self.assertIsNone(proof['issuer_in_workbook'])
        self.assertEqual(proof['source_kind'], 'mof_exchange_assets_xlsx_cached_v1')
        reader.assert_called_once_with(self.workbook, '2026-11-09')
        self.assertEqual(fetch.call_count, 2)
        self.assertEqual(fetch.call_args.kwargs['mof_exchange_assets_workbook'], True)
        self.assertLessEqual(fetch.call_args.kwargs['max_bytes'], 128_000)

    def test_missing_duplicate_wrong_day_or_hidden_attachment_does_not_fetch(self):
        for html in [self.html(link=self.workbook_url.replace('20261109', '20251110')),
                     self.html(duplicate=True), self.html(hidden=' hidden'),
                     self.html(link=self.workbook_url.replace('www.mof.go.jp', 'example.org')),
                     self.html(link=self.workbook_url.replace('.xlsx', '.xls'))]:
            with self.subTest(html=html):
                row, fetch, reader = self.extract(html=html)
                self.assertIsNone(row)
                fetch.assert_not_called()
                reader.assert_not_called()

    def test_parent_identity_date_and_canonical_conflicts_are_not_overridden(self):
        for case in [dict(html=self.html(heading='別の年次報告')),
                     dict(item=self.item(title='別の発表')),
                     dict(final=self.url.replace('index.html', 'other.html')),
                     dict(html=self.html(canonical=self.url + '?bad=1')),
                     dict(html=self.html(meta='2026-11-10')),
                     dict(html=self.html(meta='invalid')),
                     dict(html=self.html(extra='<meta property="article:published_time" content="2026-11-08T08:50:00+09:00">')),
                     dict(item=self.item(day='2026-11-10'))]:
            with self.subTest(case=case):
                row, fetch, reader = self.extract(**case)
                self.assertIsNone(row)
                fetch.assert_not_called()
                reader.assert_not_called()

    def test_unique_international_archive_proof_is_required_before_workbook(self):
        for archive in [self.archive(duplicate=True), self.archive(title='別の資料'),
                        self.archive(url=self.url.replace('index.html', 'other.html')),
                        self.archive(day='令和8年11月08日（日曜日）'),
                        self.archive(category='conference', label='会見等')]:
            with self.subTest(archive=archive):
                row, fetch, reader = self.extract(archive=archive)
                self.assertIsNone(row)
                self.assertEqual(fetch.call_count, 1)
                reader.assert_not_called()

    def test_workbook_validation_failure_never_becomes_html_or_healthy_fallback(self):
        row, _, reader = self.extract(parser_error=ValueError('mof_xlsx_invalid'))
        self.assertIsNone(row)
        reader.assert_called_once()
        for key, value in [('title', '別の資料'), ('body_sha256', '0' * 64),
                           ('workbook_sha256', '0' * 64), ('source_kind', 'unverified_html'),
                           ('reporting_fiscal_year', 2026), ('fiscal_year_label', '令和8年度')]:
            report = self.report()
            report[key] = value
            with self.subTest(key=key):
                self.assertIsNone(self.extract(report=report)[0])

    def test_attachment_size_and_redirect_remain_bounded(self):
        with self.assertRaisesRegex(ValueError, 'source_size_limit'):
            self.extract(workbook=b'x' * 128_001)
        with self.assertRaisesRegex(ValueError, 'unapproved_redirect'):
            self.extract(workbook_final=self.workbook_url.replace('20261109', '20251110'))

    def test_fiscal_year_does_not_become_publication_day_or_after_cutoff_clock(self):
        row, fetch, reader = self.extract(since=datetime(2026, 11, 9, 8, 0, tzinfo=sources.JST))
        self.assertIsNone(row)
        fetch.assert_not_called()
        reader.assert_not_called()

    def test_cache_preserves_typed_workbook_origin_and_day_only_publication(self):
        from official_news_cache import _article
        row, _, _ = self.extract()
        row['body_verified_at'] = self.now.timestamp()
        cached = _article(row, self.now.timestamp())
        self.assertIsNone(cached['published_at'])
        self.assertEqual(cached['publication_precision'], 'day')
        self.assertEqual(cached['supporting_documents'][0]['source_kind'], 'mof_exchange_assets_xlsx_cached_v1')
        self.assertEqual(cached['supporting_documents'][0]['reporting_fiscal_year'], 2025)

    def test_writer_and_both_mocked_reviewers_receive_same_full_typed_source(self):
        from copy import deepcopy
        from daily_news_producer import generate_edition
        from intraday_news_runtime import intraday_window
        from tests.test_daily_news_producer import provider_mock, draft, approved
        row, _, _ = self.extract()
        row['body_verified_at'] = self.now.timestamp()
        before = deepcopy(row)
        provider = provider_mock()
        provider.claude.return_value = draft(1)
        provider.gemini.return_value = approved()
        result = generate_edition(self.now.timestamp(), articles=[row],
            source_window=intraday_window(self.now.timestamp()), providers=provider,
            collector=MagicMock(side_effect=AssertionError('offline frozen source must not fetch')),
            clock=lambda: self.now.timestamp())
        self.assertEqual(row, before)
        for method, key in [(provider.claude, 'articles'), (provider.gemini, 'original_articles'),
                            (provider.openai, 'original_articles')]:
            method.assert_called_once()
            submitted = method.call_args.args[1][key][0]
            for field in ['body', 'body_sha256', 'source_scope', 'supporting_documents',
                          'publication_evidence', 'publication_precision', 'published_at']:
                self.assertEqual(submitted[field], row[field])
        self.assertEqual(provider.gemini.call_args.args[1], provider.openai.call_args.args[1])
        self.assertIsNone(result['article_refs'][0]['published_at'])
        self.assertNotIn('supporting_documents', result['article_refs'][0])

"""Narrow MOF workbook transport contracts; all transport is mocked."""
from unittest import TestCase
from unittest.mock import MagicMock, patch

import official_news_sources as sources


class MofExchangeAssetsTransportTests(TestCase):
    url = 'https://www.mof.go.jp/policy/international_policy/reference/gaitametokkai/gaitametokkai_20261109.xlsx'
    mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

    def test_only_valid_dated_workbook_paths_can_opt_into_transport(self):
        self.assertIsNone(sources._safe_url(self.url))
        self.assertEqual(sources._safe_url(self.url, allow_mof_exchange_assets_workbook=True), self.url)
        for url in [self.url.replace('20261109', '20261309'), self.url.replace('20261109', '20260230'),
                    self.url.replace('.xlsx', '.xls'), self.url.replace('.xlsx', '.xlsm'),
                    self.url.replace('www.mof.go.jp', 'example.org'),
                    self.url.replace('gaitametokkai_20261109.xlsx', 'other.xlsx'),
                    self.url.replace('/gaitametokkai/gaitametokkai_', '/another/gaitametokkai_'),
                    self.url + '?download=1']:
            with self.subTest(url=url):
                self.assertIsNone(sources._safe_url(url, allow_mof_exchange_assets_workbook=True))
        for kwargs in [{'supporting_pdf': True, 'mof_exchange_assets_workbook': True},
                       {'publication_archive': True, 'mof_exchange_assets_workbook': True}]:
            with self.subTest(kwargs=kwargs), self.assertRaisesRegex(ValueError, 'unapproved_source'):
                sources._download(self.url, 55, **kwargs)

    def test_workbook_download_keeps_pinned_https_mime_and_byte_deadline_contracts(self):
        session = MagicMock()
        response = session.get.return_value.__enter__.return_value
        response.status_code = 200
        response.headers = {'Content-Type': self.mime}
        response.raw.read1.side_effect = [b'PK-synthetic', b'']
        with patch.object(sources.requests, 'Session') as factory, \
                patch.object(sources, '_public_ip', return_value='8.8.8.8') as public_ip, \
                patch.object(sources, '_PinnedHTTPSAdapter') as adapter, \
                patch.object(sources.time, 'monotonic', return_value=0):
            factory.return_value.__enter__.return_value = session
            with self.assertRaisesRegex(ValueError, 'unapproved_source'):
                sources._download(self.url, 55)
            self.assertEqual(sources._download(self.url, 55, max_bytes=20, mof_exchange_assets_workbook=True),
                             (b'PK-synthetic', self.url))
            public_ip.assert_called_with('www.mof.go.jp')
            adapter.assert_called_with('www.mof.go.jp', '8.8.8.8')
            self.assertFalse(session.trust_env)
            self.assertFalse(session.get.call_args.kwargs['allow_redirects'])
            self.assertTrue(session.get.call_args.kwargs['verify'])
            self.assertEqual(session.get.call_args.kwargs['headers']['Accept'], self.mime)
            for mime in ['text/html', 'application/zip', 'application/octet-stream', 'application/vnd.ms-excel']:
                response.headers = {'Content-Type': mime}
                with self.subTest(mime=mime), self.assertRaisesRegex(ValueError, 'source_content_type'):
                    sources._download(self.url, 55, mof_exchange_assets_workbook=True)
            response.headers = {'Content-Type': self.mime, 'Content-Length': '21'}
            with self.assertRaisesRegex(ValueError, 'source_size_limit'):
                sources._download(self.url, 55, max_bytes=20, mof_exchange_assets_workbook=True)
            response.headers = {'Content-Type': self.mime}
            response.raw.read1.side_effect = [b'x' * 21]
            with self.assertRaisesRegex(ValueError, 'source_size_or_time_limit'):
                sources._download(self.url, 55, max_bytes=20, mof_exchange_assets_workbook=True)
            calls = session.get.call_count
            with self.assertRaisesRegex(ValueError, 'source_time_limit'):
                sources._download(self.url, 0, mof_exchange_assets_workbook=True)
            self.assertEqual(session.get.call_count, calls)

    def test_workbook_redirect_cannot_switch_document_or_host(self):
        session = MagicMock()
        response = session.get.return_value.__enter__.return_value
        response.status_code = 302
        with patch.object(sources.requests, 'Session') as factory, \
                patch.object(sources, '_public_ip', return_value='8.8.8.8'), \
                patch.object(sources, '_PinnedHTTPSAdapter'), \
                patch.object(sources.time, 'monotonic', return_value=0):
            factory.return_value.__enter__.return_value = session
            for redirect in [self.url.replace('20261109', '20251110'),
                             self.url.replace('www.mof.go.jp', 'example.org'),
                             'https://www.mof.go.jp/policy/international_policy/reference/gaitametokkai/index.html']:
                response.headers = {'Location': redirect}
                with self.subTest(redirect=redirect), self.assertRaisesRegex(ValueError, 'unapproved_redirect'):
                    sources._download(self.url, 55, mof_exchange_assets_workbook=True)

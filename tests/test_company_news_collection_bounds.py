"""Fictional discovery inputs verify bounded, distinct-company collection."""
from datetime import datetime, timedelta
from hashlib import sha256
import unittest
from unittest.mock import patch

import company_news_sources as sources

NOW = datetime(2026, 10, 11, 17, tzinfo=sources.JST)
SYMBOLS = ('9432.T', '9433.T', '6752.T', '7203.T', '7267.T',
           '9984.T', '5108.T', '6701.T', '7011.T')


def item(index, ordinal=0):
    return {'source': 'fixture-' + str(index), 'symbol': SYMBOLS[index],
            'title': '架空の会社、新しい設備の実証を開始',
            'url': f'https://fixture.example/{index}/{ordinal}.html',
            **sources._publication('2026-10-11T12:00:00+09:00')}


class CompanyCollectionBoundsTests(unittest.TestCase):
    def test_transport_failures_have_fixed_safe_codes_through_runtime(self):
        from company_news_runtime import _safe_source_diagnostics
        failures = (
            (sources.socket.gaierror, 'source_dns_failed'),
            (sources.requests.exceptions.SSLError, 'source_tls_failed'),
            (sources.requests.exceptions.ConnectTimeout, 'source_timeout'),
            (sources.requests.exceptions.ReadTimeout, 'source_timeout'),
            (sources.requests.exceptions.ConnectionError, 'source_connection_failed'),
            (RuntimeError, 'source_read_failed'),
        )
        for exception, expected in failures:
            with self.subTest(exception=exception.__name__):
                report = {}
                with patch.object(sources, 'FEEDS', {'NTT': sources.FEEDS['NTT']}), \
                     patch.object(sources, '_download', side_effect=exception('private diagnostic sentinel')):
                    self.assertEqual(sources.collect_company_articles(NOW, diagnostics=report), [])
                self.assertEqual(report['NTT']['feed_status'], 'failed')
                self.assertEqual(report['NTT']['errors'], [expected])
                safe = _safe_source_diagnostics(report)
                self.assertEqual(safe['NTT']['errors'], [expected])
                self.assertNotIn('private diagnostic sentinel', str(safe))

    def collect(self, records, rejected=(), expired=False):
        feeds = {key: f'https://fixture.example/feed/{key}' for key in records}
        reads, report, clock = [], {}, [0.0]

        def parse(payload, source, now, since):
            return records[source]

        def extract(payload, candidate, final, now, since, observed_at):
            reads.append(candidate)
            if candidate['symbol'] in rejected:
                return None
            body = 'これは取得を検証する架空の本文です。実際の企業発表ではありません。' * 4
            return dict(candidate, body=body, body_sha256=sha256(body.encode()).hexdigest())

        original_parallel = sources._parallel

        def parallel(values, callback, deadline):
            result = original_parallel(values, callback, deadline)
            if expired and values and isinstance(values[0], str):
                clock[0] = 41.0
            return result

        with patch.object(sources, 'FEEDS', feeds), \
             patch.object(sources, '_download', side_effect=lambda url, deadline: (b'fixture', url)), \
             patch.object(sources, '_feed_items', side_effect=parse), \
             patch.object(sources, '_extract_article', side_effect=extract), \
             patch.object(sources, '_parallel', side_effect=parallel), \
             patch.object(sources.time, 'monotonic', side_effect=lambda: clock[0]):
            result = sources.collect_company_articles(NOW, since=NOW - timedelta(days=2),
                                                     diagnostics=report,
                                                     clock=lambda: NOW.timestamp())
        return result, report, reads

    def test_one_issuers_eight_headlines_do_not_hide_other_companies(self):
        first = [dict(item(0, n), title='架空の会社、事業買収を決定') for n in range(8)]
        result, report, reads = self.collect({'fixture-0': first,
                                             'fixture-1': [item(1)], 'fixture-2': [item(2)]})
        self.assertEqual({row['symbol'] for row in result}, set(SYMBOLS[:3]))
        self.assertEqual(len(reads), 3)
        self.assertEqual(report['fixture-0']['selected'], 1)

    def test_failed_top_body_fills_from_next_distinct_company(self):
        records = {'fixture-' + str(i): [item(i)] for i in range(4)}
        # The company with the lowest symbol sorts first at the same priority.
        failed = min(SYMBOLS[:4])
        result, report, reads = self.collect(records, rejected=(failed,))
        self.assertEqual(len(result), 3)
        self.assertNotIn(failed, {row['symbol'] for row in result})
        self.assertEqual(len(reads), 4)
        self.assertTrue(any(row['status'] == 'articles_unavailable' for row in report.values()))

    def test_failed_bodies_never_exceed_eight_distinct_attempts(self):
        records = {'fixture-' + str(i): [item(i)] for i in range(9)}
        result, report, reads = self.collect(records, rejected=SYMBOLS)
        self.assertEqual(result, [])
        self.assertEqual(len(reads), 8)
        self.assertEqual(len({row['symbol'] for row in reads}), 8)
        self.assertEqual(sum(row['selected'] for row in report.values()), 8)

    def test_shared_deadline_is_incomplete_not_healthy_absence(self):
        records = {'fixture-' + str(i): [item(i)] for i in range(4)}
        result, report, reads = self.collect(records, expired=True)
        self.assertEqual(result, [])
        self.assertEqual(reads, [])
        self.assertTrue(any(row['status'] == 'fetch_incomplete' for row in report.values()))
        self.assertTrue(all(row['feed_status'] == 'ok' for row in report.values()))


if __name__ == '__main__':
    unittest.main()

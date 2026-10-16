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
    def test_frozen_membership_is_used_without_reading_a_changed_local_cache(self):
        from company_news_catalogue import load_catalogue
        frozen = load_catalogue(now=NOW).snapshot()
        with patch.object(sources, 'FEEDS', {'PR TIMES': sources.FEEDS['PR TIMES']}), \
             patch.object(sources, '_download', return_value=(b'fixture', sources.FEEDS['PR TIMES'])), \
             patch('company_news_catalogue.load_current_snapshot', side_effect=AssertionError('changed local cache')), \
             patch('company_news_prtimes.parse_feed', return_value=[]) as parse:
            self.assertEqual(sources.collect_company_articles(NOW, catalogue_snapshot=frozen), [])
        actual = parse.call_args.args[3]
        expected = load_catalogue(snapshot=frozen, now=NOW)
        self.assertEqual(actual.facts_sha256, expected.facts_sha256)
        self.assertEqual(actual.provenance['source_sha256'], expected.provenance['source_sha256'])

    def test_invalid_explicit_membership_never_falls_back_or_starts_source_get(self):
        with patch('company_news_catalogue.load_current_snapshot', side_effect=AssertionError('fallback')), \
             patch.object(sources, '_download', side_effect=AssertionError('source GET')) as download:
            with self.assertRaises(ValueError):
                sources.collect_company_articles(NOW, catalogue_snapshot={})
        download.assert_not_called()

    def test_short_feed_budget_tries_selected_expansion_first_and_rotates_base_tail(self):
        base = {f'base-{index:03d}': f'https://fixture.example/base/{index}' for index in range(33)}
        extra = {f'extra-{index:03d}': f'https://fixture.example/extra/{index}' for index in range(127)}
        feeds = {**base, **extra}
        reads, queues, clock = [], [], [0.0]

        def download(url, deadline):
            reads.append((url, deadline))
            return b'fixture', url

        def short_parallel(values, callback, deadline):
            if not values:
                return []
            # A synthetic three-worker queue finishes nine slow feeds within
            # the unchanged 30-second feed budget; the rest remain incomplete.
            queues.append(list(values))
            result = []
            for start in range(0, len(values), 3):
                if clock[0] + sources.REQUEST_SECONDS > deadline:
                    break
                result.extend(callback(value) for value in values[start:start + 3])
                clock[0] += sources.REQUEST_SECONDS
            return result

        completed_base, completed_extra = set(), set()
        first_slot = int(NOW.timestamp() // 900)
        with patch.object(sources, 'FEEDS', feeds), \
             patch.object(sources.issuer_feeds, 'EXPANSION_CHANNELS', frozenset(extra)), \
             patch('company_news_catalogue.load_current_snapshot', return_value=object()), \
             patch.object(sources, '_download', side_effect=download), \
             patch.object(sources, '_feed_items', return_value=[]), \
             patch.object(sources, '_parallel', side_effect=short_parallel), \
             patch.object(sources.time, 'monotonic', side_effect=lambda: clock[0]):
            for slot in range(first_slot, first_slot + len(base)):
                clock[0] = 0.0
                now = datetime.fromtimestamp(slot * 900, sources.JST)
                report = {}
                self.assertEqual(sources.collect_company_articles(now, diagnostics=report), [])
                plan = sources.collection_schedule(now)
                self.assertEqual(queues[-1], list(plan['feeds']))
                selected_extra = set(plan['feeds']) & set(extra)
                checked = {label for label, row in report.items() if row['feed_status'] == 'ok'}
                self.assertTrue(selected_extra.issubset(checked))
                self.assertLessEqual(len(queues[-1]), 39)
                self.assertEqual(len(checked), 9)
                self.assertTrue(all(report[label]['feed_status'] == 'not_scheduled'
                                    for label in set(extra) - selected_extra))
                self.assertTrue(any(row['feed_status'] == 'not_completed' for row in report.values()))
                completed_base.update(checked & set(base))
                completed_extra.update(checked & set(extra))
        self.assertEqual(completed_base, set(base))
        self.assertEqual(completed_extra, set(extra))
        self.assertTrue(all(deadline == 30.0 for _, deadline in reads))
        self.assertEqual((sources.FEED_COLLECTION_SECONDS, sources.COLLECTION_SECONDS,
                          sources.MAX_CANDIDATES, sources.MAX_ARTICLES), (30, 40, 8, 3))

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

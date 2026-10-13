"""Fictional routes verify bounded scheduling, identity and wire-size behavior."""
from copy import deepcopy
from datetime import datetime, timezone
import json
import tempfile
import unittest
from unittest.mock import patch

import company_news_expanded_routes as expanded
import company_news_sources as collection
import company_news_runtime as runtime
from company_news_route_schedule import select_route_schedule
from tests.test_company_news_runtime import MemoryStorage

NOW = datetime(2026, 10, 13, 10, tzinfo=timezone.utc)


def route():
    return dict(symbol='9101.T', name='日本郵船', issuer='日本郵船株式会社',
                company_id='120868', status='verified_issuer_rss_route',
                parent_issuer_identity_verified=True, explicit_rss_link_verified=True,
                evidence_sha256='a' * 64,
                release_url='https://prtimes.jp/main/html/rd/p/000000001.000120868.html',
                feed_url='https://prtimes.jp/companyrdf.php?company_id=120868')


class ExpandedRouteTests(unittest.TestCase):
    def test_registration_requires_matching_original_ID_and_explicit_review_evidence(self):
        good = dict(schema_version=1, items=[route()])
        self.assertEqual(expanded.registered_routes(good)['PR TIMES / 日本郵船']['symbol'], '9101.T')
        for field, value in [('parent_issuer_identity_verified', False),
                             ('explicit_rss_link_verified', False), ('evidence_sha256', None),
                             ('symbol', '9101.JP'), ('company_id', '0120868'),
                             ('release_url', 'https://example.com/main/html/rd/p/000000001.000120868.html'),
                             ('feed_url', route()['feed_url'] + '&force=1')]:
            bad = deepcopy(good); bad['items'][0][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'company_expanded_routes_invalid'):
                expanded.registered_routes(bad)

    def test_duplicate_companies_or_issuer_IDs_cannot_multiply_routes(self):
        for other in [route(), dict(route(), symbol='9107.T', name='川崎汽船')]:
            with self.assertRaisesRegex(ValueError, 'company_expanded_routes_invalid'):
                expanded.registered_routes(dict(schema_version=1, items=[route(), other]))

    def test_rotation_fetches_only_scheduled_routes_and_retains_unscheduled_as_unknown(self):
        bases = {'base-' + str(i): 'https://fixture.example/base/' + str(i) for i in range(3)}
        extras = {'extra-' + str(i): 'https://fixture.example/new/' + str(i) for i in range(194)}
        feeds = {**bases, **extras}; diagnostics = {}; reads = []
        def download(url, deadline):
            reads.append((url, deadline)); return b'fixture', url
        def parallel(values, callback, deadline):
            return [callback(value) for value in values]
        with patch.object(collection, 'FEEDS', feeds), \
             patch.object(collection.issuer_feeds, 'EXPANSION_CHANNELS', frozenset(extras)), \
             patch.object(collection, '_download', side_effect=download), \
             patch.object(collection, '_parallel', side_effect=parallel), \
             patch.object(collection, '_feed_items', return_value=[]), \
             patch.object(collection.time, 'monotonic', return_value=10.0):
            expected = collection.collection_schedule(NOW)['feeds']
            self.assertEqual(collection.collect_company_articles(NOW, diagnostics=diagnostics), [])
        self.assertEqual({url for url, deadline in reads}, set(expected.values()))
        self.assertEqual(len(reads), 9)
        self.assertTrue(all(deadline == 40.0 for url, deadline in reads))
        self.assertEqual(sum(row['feed_status'] == 'not_scheduled' for row in diagnostics.values()), 188)
        self.assertTrue(all(row['status'] == 'not_scheduled' and row['accepted'] == 0
                            for label, row in diagnostics.items() if label not in expected))

    def test_maximum_registry_and_long_error_labels_fit_real_ASCII_clock_envelope(self):
        labels = tuple('検証用' * 30 + str(i) for i in range(227))
        diagnostics = {label: {'feed_status': 'failed', 'status': 'feed_failed',
                              'errors': ['unsupported_source_encoding', 'private diagnostic']} for label in labels}
        with tempfile.TemporaryDirectory() as temp, patch.object(runtime, 'CHANNEL_NAMES', labels), \
             patch.object(runtime, '_current_catalogue', return_value=None):
            worker = runtime.CompanyNewsRuntime(MemoryStorage(), clock=lambda: NOW.timestamp(),
                                               cache_path=temp + '/cache.json')
            worker._source_diagnostics = runtime._safe_source_diagnostics(diagnostics)
            result = worker.operational_snapshot()
        encoded = json.dumps(result, ensure_ascii=True, separators=(',', ':')).encode()
        self.assertLessEqual(len(encoded), 8000)
        self.assertEqual(result['source_diagnostic_counts']['registered'], 227)
        self.assertEqual(result['source_diagnostic_counts']['failed'], 227)
        self.assertEqual(result['source_diagnostics_omitted_count'], 227 - len(result['source_diagnostics']))
        self.assertEqual(result['max_generation_attempts_per_day'], 3)
        self.assertNotIn(b'private diagnostic', encoded)
        self.assertFalse(result['coverage']['all_company_announcements_covered'])

    def test_only_valid_bounded_rotation_counts_reach_operational_metadata(self):
        bases = {'base': 'https://fixture.example/base'}
        extra = {'extra-' + str(i): 'https://fixture.example/' + str(i) for i in range(194)}
        coverage = select_route_schedule(bases, extra, NOW.timestamp())['coverage']
        self.assertEqual(runtime.safe_rotation_coverage(coverage), coverage)
        for key, value in [('registered_channel_count', 400),
                           ('additional_unscheduled_channel_count', -1),
                           ('rotation_full_cycle_seconds', 900),
                           ('all_company_announcements_covered', True),
                           ('base_channel_count', True)]:
            self.assertEqual(runtime.safe_rotation_coverage(dict(coverage, **{key: value})), {})
        with tempfile.TemporaryDirectory() as temp, patch.object(runtime, '_current_catalogue', return_value=None):
            worker = runtime.CompanyNewsRuntime(MemoryStorage(), clock=lambda: NOW.timestamp(),
                cache_path=temp + '/cache.json', collector=lambda **_: {
                    'articles': [], 'status': 'ready', 'collection_health': 'partial',
                    'scheduled_collection_health': 'complete', 'coverage': coverage})
            worker.run_once()
            result = worker.operational_snapshot()
        self.assertEqual(result['coverage']['additional_unscheduled_channel_count'], 188)
        self.assertEqual(result['scheduled_collection_health'], 'complete')
        self.assertEqual(result['collection_health'], 'partial')
        self.assertFalse(result['coverage']['all_company_announcements_covered'])


if __name__ == '__main__':
    unittest.main()

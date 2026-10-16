"""Offline wire-response to persisted accounting tests for Gemini ServiceTier."""
from copy import deepcopy
from datetime import datetime
import json
import unittest
from unittest.mock import patch

from daily_news_producer import Providers
from news_review_costs import (PREFIX, ReviewUsageRecorder, collect_daily_cost,
                               estimate_cost, normalize_service_tier)


USAGE = {'promptTokenCount': 1000, 'candidatesTokenCount': 100, 'thoughtsTokenCount': 60,
         'cachedContentTokenCount': 200, 'totalTokenCount': 1160}
EXPECTED_NANOS = 800 * 300 + 200 * 30 + 160 * 2500
IDENTIFIER = '00000000000000000000000000000001'


class NumericMemoryStorage:
    def __init__(self):
        self.values = {}

    def create(self, path, value, *, deadline=None):
        if path in self.values:
            return False
        self.values[path] = deepcopy(value)
        return True

    def read(self, path, *, deadline=None):
        return deepcopy(self.values.get(path))

    def _list(self, prefix, *, offset=0, deadline=None):
        names = sorted(key[len(prefix) + 1:] for key in self.values if key.startswith(prefix + '/'))
        return [{'name': name} for name in names[offset:offset + 30]]


class ServiceTierTests(unittest.TestCase):
    def setUp(self):
        no_network = patch('socket.socket.connect', side_effect=AssertionError('offline only'))
        no_network.start()
        self.addCleanup(no_network.stop)

    def roundtrip(self, wire_tier):
        storage = NumericMemoryStorage()
        payload = {'usageMetadata': {**USAGE, 'serviceTier': wire_tier,
                                     'ignored_private': 'private-secret-fixture'},
                   'ignored_private': 'private-secret-fixture'}
        usage, tier = Providers._response_usage('gemini', payload)
        recorder = ReviewUsageRecorder(storage, scope='company',
            clock=lambda: datetime.fromisoformat('2026-10-17T08:00:00+09:00').timestamp(), run_context={})
        recorder.start_request(provider='gemini', model='gemini-2.5-flash', request_id=IDENTIFIER)
        recorder.record_request(provider='gemini', model='gemini-2.5-flash', request_id=IDENTIFIER,
                                usage=usage, service_tier=tier)
        return storage, recorder.safe_summary(), collect_daily_cost(storage, '2026-10-17')

    def test_documented_lowercase_standard_and_unspecified_roundtrip_as_known_standard_price(self):
        for wire, canonical in [('standard', 'STANDARD'), ('unspecified', 'SERVICE_TIER_UNSPECIFIED')]:
            with self.subTest(wire=wire):
                storage, run, daily = self.roundtrip(wire)
                self.assertTrue(run['estimate_complete'])
                self.assertTrue(daily['scan_complete'])
                self.assertTrue(daily['estimate_complete'])
                self.assertEqual(run['receipts'][0]['service_tier'], canonical)
                self.assertEqual(daily['receipts'][0]['usd_nanos'], EXPECTED_NANOS)
                self.assertEqual(daily['receipts'][0]['tokens'], USAGE)
                self.assertEqual(run['receipt_set_sha256'], daily['receipt_set_sha256'])
                self.assertEqual(daily['providers']['gemini']['unknown_cost_count'], 0)
                self.assertNotIn('private-secret-fixture', json.dumps(storage.values))

    def test_flex_and_priority_remain_unknown_with_numeric_tokens_retained(self):
        for wire, canonical in [('flex', 'FLEX'), ('priority', 'PRIORITY')]:
            with self.subTest(wire=wire):
                storage, run, daily = self.roundtrip(wire)
                self.assertTrue(daily['scan_complete'])
                self.assertFalse(daily['estimate_complete'])
                receipt = daily['receipts'][0]
                self.assertEqual(receipt['service_tier'], canonical)
                self.assertIsNone(receipt['usd_nanos'])
                self.assertEqual(receipt['reason'], 'pricing_unavailable')
                self.assertEqual(receipt['tokens'], USAGE)
                self.assertEqual(run['receipt_set_sha256'], daily['receipt_set_sha256'])
                self.assertEqual(daily['unknown_reasons'], {'pricing_unavailable': 1})

    def test_arbitrary_or_malformed_tier_never_leaks_or_becomes_standard(self):
        for wire in ('private-secret-fixture', {'private': 'private-secret-fixture'}, True,
                     'Standard', 'standard ', '', 0):
            with self.subTest(wire=wire):
                storage, run, daily = self.roundtrip(wire)
                self.assertTrue(daily['scan_complete'])
                self.assertEqual(daily['unknown_cost_count'], 1)
                self.assertEqual(daily['receipts'][0]['service_tier'], 'unknown')
                self.assertEqual(daily['receipts'][0]['tokens'], USAGE)
                self.assertNotIn('private-secret-fixture', json.dumps([storage.values, run, daily]))

    def test_direct_estimator_and_recorder_normalize_documented_lowercase_without_new_rates(self):
        for wire in ('standard', 'unspecified', 'STANDARD', 'SERVICE_TIER_UNSPECIFIED', None):
            with self.subTest(wire=wire):
                self.assertEqual(estimate_cost('gemini', 'gemini-2.5-flash', USAGE, wire)['usd_nanos'],
                                 EXPECTED_NANOS)
        self.assertEqual(normalize_service_tier('openai', 'auto'), 'auto')
        self.assertIsNone(estimate_cost('openai', 'gpt-6-luna',
            {'input_tokens': 100, 'output_tokens': 20, 'total_tokens': 120}, 'auto')['usd_nanos'])

    def test_historical_lost_tokens_and_unknown_tier_stay_unknown_after_future_fix(self):
        storage, _, _ = self.roundtrip('standard')
        finish = storage.values[f'{PREFIX}/2026-10-17/{IDENTIFIER}.usage.json']
        finish.update(usd_nanos=None, tokens={}, service_tier='unknown',
                      reason='pricing_unavailable', basis='unknown', state='usage_unknown')
        original = deepcopy(storage.values)
        daily = collect_daily_cost(storage, '2026-10-17')
        self.assertTrue(daily['scan_complete'])
        self.assertFalse(daily['estimate_complete'])
        self.assertEqual(daily['unknown_cost_count'], 1)
        self.assertIsNone(daily['receipts'][0]['usd_nanos'])
        self.assertEqual(daily['receipts'][0]['tokens'], {})
        self.assertEqual(storage.values, original)


if __name__ == '__main__':
    unittest.main()

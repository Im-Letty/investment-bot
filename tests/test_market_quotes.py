"""Exercise real market route code without startup, credentials, or network calls."""

import ast
from datetime import date, datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import math
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from flask import Flask, jsonify, request
from market_snapshot import CORE_MARKETS, MarketSnapshot


ROOT = Path(__file__).parents[1]


class FakeHistory:
    def __init__(self, closes):
        self.closes = closes

    def __len__(self):
        return len(self.closes)

    def __getitem__(self, column):
        assert column == 'Close'
        return SimpleNamespace(iloc=self.closes)


class FakeTicker:
    def __init__(self, closes, current, info=None):
        self.history = Mock(return_value=FakeHistory(closes))
        self.fast_info = {'last_price': current}
        self._info = info
        self.info_reads = 0

    @property
    def info(self):
        self.info_reads += 1
        if self._info is None:
            raise AssertionError('Light quotes must not fetch detailed metadata')
        return self._info


class MarketQuoteTests(unittest.TestCase):
    def setUp(self):
        # Compile the production functions only, matching the existing route tests.
        # Importing line_bot would initialize paid APIs and production provisioning.
        tree = ast.parse((ROOT / 'line_bot.py').read_text(encoding='utf-8'))
        names = {'_rtp', '_market_change_values', '_market_quote_units',
                 '_fetch_market_quote', '_load_market_snapshot', 'initial_market_payload',
                 'fetch_market_data', 'api_morning_data', 'api_quote',
                 '_cached_api_quote', '_load_api_quote'}
        nodes = [node for node in tree.body
                 if isinstance(node, ast.FunctionDef) and node.name in names]
        self.app = Flask('market-test')
        self.tickers = {}
        self.ticker_factory = Mock(side_effect=lambda symbol: self.tickers[symbol])
        self.context = dict(app=self.app, jsonify=jsonify, request=request,
                            date=date, datetime=datetime, math=math,
                            time=SimpleNamespace(time=lambda: 1000.0),
                            yf=SimpleNamespace(Ticker=self.ticker_factory),
                            _MKT_CACHE={'ts': 0, 'data': None},
                            _QUOTE_CACHE={}, _QUOTE_TTL=60,
                            _QUOTE_ERRORS={}, _QUOTE_RETRY_TTL=15,
                            _QUOTE_LOCKS=tuple(threading.Lock() for _ in range(64)),
                            ThreadPoolExecutor=ThreadPoolExecutor, as_completed=as_completed,
                            CORE_MARKETS=CORE_MARKETS)
        exec(compile(ast.Module(body=nodes, type_ignores=[]),
                     str(ROOT / 'line_bot.py'), 'exec'), self.context)
        self.context['_market_snapshot'] = MarketSnapshot(
            lambda:self.context['_load_market_snapshot'](), now=lambda:1000)
        self.client = self.app.test_client()

    def prime_market(self):
        # Warm the snapshot explicitly; an HTTP request must never do this work.
        self.context['_market_snapshot']._refresh()

    def quote(self, symbol, closes, current, *, light=True, info=None):
        self.tickers[symbol] = FakeTicker(closes, current, info)
        suffix = '&light=1' if light else ''
        return self.client.get('/api/quote?symbol=' + symbol + suffix)

    def test_morning_exposes_unrounded_absolute_change_and_units(self):
        values = {
            '^N225': (41600, 42020.123456, 'JPY', 'currency'),
            'JPY=X': (148.111111, 148.131234, 'JPY', 'currency'),
            '^TNX': (4.1, 4.123456, '', 'percentage_points'),
            '^GSPC': (5700, 5680.375, '', 'points'),
            '^DJI': (42000, 42420, '', 'points'),
            '^VIX': (15, 15, '', 'points'),
        }
        labels = ['日経225', 'ドル円', '米10年金利', 'S&P500', 'NYダウ', 'VIX恐怖指数']
        for symbol, (previous, current, _, _) in values.items():
            self.tickers[symbol] = FakeTicker([previous, current], current)
        self.prime_market()
        response = self.client.get('/api/morning-data')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data['fetched_at'], 1000)
        for label, (_, (previous, current, currency, unit)) in zip(labels, values.items()):
            with self.subTest(label=label):
                quote = data['market'][label]
                self.assertEqual(quote['price'], current)
                self.assertAlmostEqual(quote['change_value'], current - previous)
                self.assertAlmostEqual(quote['pct'], (current - previous) / previous * 100)
                self.assertEqual(quote['currency'], currency)
                self.assertEqual(quote['change_unit'], unit)
                self.assertEqual(quote['change'], '--')  # Existing legacy field.
        self.assertEqual(data['market']['日経225']['display'], '42,020.12　▲1.01%')
        self.assertEqual(data['market']['日経225']['value'], 42020.123456)
        self.assertEqual(response.headers['Cache-Control'], 'public, max-age=15, stale-while-revalidate=60')
        self.assertFalse(data['refreshing'])
        for ticker in self.tickers.values():
            ticker.history.assert_called_once_with(period='5d', timeout=8)
            self.assertEqual(ticker.info_reads, 0)
        calls = self.ticker_factory.call_count
        self.assertEqual(self.client.get('/api/morning-data').get_json(), data)
        self.assertEqual(self.ticker_factory.call_count, calls)

    def test_morning_api_returns_saved_prices_while_provider_is_blocked(self):
        entered, release = threading.Event(), threading.Event()
        def load():
            entered.set(); release.wait(2)
            return {"market": {}}
        snapshot = MarketSnapshot(load, now=lambda:1000)
        snapshot._market = {'日経225':{'price':42000,'display':'42,000','pct':None,
                                    'change_value':None,'fetched_at':900}}
        self.context['_market_snapshot'] = snapshot
        try:
            response = self.client.get('/api/morning-data')
            self.assertTrue(entered.wait(1))
            data = response.get_json()
            self.assertEqual(data['market']['日経225']['price'],42000)
            self.assertEqual(data['market']['日経225']['fetched_at'],900)
            self.assertTrue(data['refreshing'])
            self.assertEqual(self.ticker_factory.call_count,0)
        finally:
            release.set();snapshot._thread.join(2)

    def test_quote_absolute_change_is_not_reconstructed_from_rounded_percent(self):
        response = self.quote('7203.T', [41600, 41900], 42020.123456)
        data = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(data['price'], 42020.1235)
        self.assertEqual(data['pct'], 1.01)
        self.assertAlmostEqual(data['change_value'], 420.123456)
        self.assertNotAlmostEqual(data['change_value'], 41600 * data['pct'] / 100)
        self.assertEqual(data['display'], '42,020.12 ▲1.01%')
        self.assertEqual(data['change'], '▲1.01%')
        self.assertEqual((data['currency'], data['change_unit']), ('JPY', 'currency'))
        self.assertEqual(self.tickers['7203.T'].info_reads, 0)

    def test_small_negative_fx_change_and_true_zero_remain_distinct(self):
        down = self.quote('EURUSD=X', [1.123456, 1.12], 1.123444).get_json()
        self.assertAlmostEqual(down['change_value'], -0.000012)
        self.assertEqual(down['pct'], 0)  # The legacy percentage rounds to zero.
        self.assertEqual((down['currency'], down['change_unit']), ('USD', 'currency'))
        flat = self.quote('GBPJPY=X', [190, 190], 190).get_json()
        self.assertEqual(flat['change_value'], 0)
        self.assertEqual(flat['pct'], 0)

    def test_missing_previous_close_is_null_in_both_routes(self):
        data = self.quote('BTC-JPY', [10000], 10100).get_json()
        self.assertIsNone(data['change_value'])
        self.assertIsNone(data['pct'])
        self.assertEqual(data['display'], '10,100.00')
        self.assertEqual(data['change'], '--')
        self.tickers['^N225'] = FakeTicker([42100], 42100)
        self.prime_market()
        morning = self.client.get('/api/morning-data').get_json()['market']['日経225']
        self.assertEqual(morning['price'], 42100)
        self.assertIsNone(morning['change_value'])
        self.assertIsNone(morning['pct'])

    def test_invalid_previous_close_does_not_become_a_fake_zero_or_nan(self):
        for previous in (None, 0, -1, float('nan'), float('inf')):
            with self.subTest(previous=previous):
                self.context['_QUOTE_CACHE'].clear()
                response = self.quote('GC=F', [previous, 2500], 2501)
                self.assertEqual(response.status_code, 200)
                data = response.get_json()
                self.assertIsNone(data['change_value'])
                self.assertIsNone(data['pct'])
                self.assertEqual(data['change'], '--')

    def test_invalid_current_price_is_rejected_even_without_previous_close(self):
        for closes in ([100], [99, 100]):
            for current in (float('nan'), float('inf'), -100):
                with self.subTest(closes=closes, current=current):
                    self.context['_QUOTE_ERRORS'].clear()
                    response = self.quote('7203.T', closes, current)
                    self.assertEqual(response.status_code, 422)
                    self.assertEqual(response.get_json()['error'], 'invalid data')

    def test_light_symbol_units_without_extra_metadata(self):
        cases = {
            '^N225': ('JPY', 'currency'),
            '^NDX': ('', 'points'),
            '^CUSTOM': ('', 'points'),
            '^TNX': ('', 'percentage_points'),
            '^IRX': ('', 'percentage_points'),
            'JPY=X': ('JPY', 'currency'),
            'EURUSD=X': ('USD', 'currency'),
            '7203.T': ('JPY', 'currency'),
            'BTC-JPY': ('JPY', 'currency'),
            'ETH-USD': ('USD', 'currency'),
            'GC=F': ('USD', 'currency'),
            'SI=F': ('USD', 'currency'),
            'CL=F': ('USD', 'currency'),
            'UNKNOWN': ('', 'currency'),
        }
        for symbol, expected in cases.items():
            with self.subTest(symbol=symbol):
                data = self.quote(symbol, [100, 101], 101).get_json()
                self.assertEqual((data['currency'], data['change_unit']), expected)
                self.assertEqual(self.tickers[symbol].info_reads, 0)

    def test_full_quote_preserves_details_and_light_reuses_currency_and_cache(self):
        info = {'currency': 'CAD', 'shortName': 'Example', 'marketCap': 100000}
        full = self.quote('EXAMPLE.TO', [10, 10.5], 10.5, light=False, info=info).get_json()
        self.assertEqual(full['name'], 'Example')
        self.assertEqual(full['details']['marketCap'], 100000)
        calls_before_light = self.ticker_factory.call_count
        self.context['time'].time = lambda: 1010.0
        light = self.client.get('/api/quote?symbol=EXAMPLE.TO&light=1').get_json()
        self.assertEqual(light['currency'], 'CAD')
        self.assertEqual(light['change_value'], 0.5)
        self.assertEqual(light['fetched_at'], 1000)
        self.assertEqual(self.ticker_factory.call_count, calls_before_light)
        self.assertEqual(self.tickers['EXAMPLE.TO'].info_reads, 1)
        calls = self.ticker_factory.call_count
        cached = self.client.get('/api/quote?symbol=EXAMPLE.TO&light=1').get_json()
        self.assertEqual(cached, light)
        self.assertEqual(self.ticker_factory.call_count, calls)

    def test_quote_refresh_time_is_preserved_on_cache_hits_and_moves_only_after_fetch(self):
        first = self.quote('7203.T', [100, 101], 101).get_json()
        self.assertEqual(first['fetched_at'], 1000)
        ticker = self.tickers['7203.T']
        ticker.history.assert_called_once_with(period='5d', timeout=8)
        ticker.fast_info['last_price'] = 102
        self.context['time'].time = lambda: 1030.0
        cached = self.client.get('/api/quote?symbol=7203.T&light=1').get_json()
        self.assertEqual((cached['price'], cached['fetched_at']), (101, 1000))
        self.assertEqual(ticker.history.call_count, 1)
        self.context['time'].time = lambda: 1061.0
        fresh = self.client.get('/api/quote?symbol=7203.T&light=1').get_json()
        self.assertEqual((fresh['price'], fresh['fetched_at']), (102, 1061))
        self.assertEqual(ticker.history.call_count, 2)

    def test_one_bar_quote_has_a_real_retrieval_timestamp_without_fake_change(self):
        data = self.quote('BTC-JPY', [10000], 10100).get_json()
        self.assertEqual(data['fetched_at'], 1000)
        self.assertIsNone(data['pct'])
        self.assertIsNone(data['change_value'])

    def test_concurrent_same_symbol_requests_fetch_history_once(self):
        entered, release, contender = threading.Event(), threading.Event(), threading.Event()
        guard, serial = threading.Lock(), threading.Lock()
        class TrackingLock:
            attempts = 0
            def acquire(self, timeout):
                with guard:
                    self.attempts += 1
                    if self.attempts == 2:
                        contender.set()
                return serial.acquire(timeout=timeout)
            def release(self):
                serial.release()
        self.context['_QUOTE_LOCKS'] = (TrackingLock(),)
        ticker = FakeTicker([100, 101], 101)
        def history(**kwargs):
            entered.set()
            if not release.wait(2):
                raise RuntimeError('test provider timed out')
            return FakeHistory([100, 101])
        ticker.history.side_effect = history
        self.tickers['7203.T'] = ticker
        def fetch():
            with self.app.test_client() as client:
                response = client.get('/api/quote?symbol=7203.T&light=1')
                return response.status_code, response.get_json()
        with ThreadPoolExecutor(max_workers=2) as workers:
            first = workers.submit(fetch)
            try:
                self.assertTrue(entered.wait(1))
                second = workers.submit(fetch)
                self.assertTrue(contender.wait(1))
                self.assertEqual(ticker.history.call_count, 1)
            finally:
                release.set()
            one, two = first.result(timeout=2), second.result(timeout=2)
        self.assertEqual(one, two)
        self.assertEqual(one[0], 200)
        self.assertEqual(one[1]['fetched_at'], 1000)
        self.assertEqual(ticker.history.call_count, 1)

    def test_failed_refresh_is_throttled_and_preserves_previous_cache_timestamp(self):
        self.quote('7203.T', [100, 101], 101)
        ticker = self.tickers['7203.T']
        ticker.history.side_effect = RuntimeError('provider unavailable')
        self.context['time'].time = lambda: 1061.0
        failed = self.client.get('/api/quote?symbol=7203.T&light=1')
        self.assertEqual(failed.status_code, 500)
        self.assertNotIn('fetched_at', failed.get_json())
        self.context['time'].time = lambda: 1070.0
        again = self.client.get('/api/quote?symbol=7203.T&light=1')
        self.assertEqual(again.status_code, 500)
        self.assertEqual(ticker.history.call_count, 2)
        saved = self.context['_QUOTE_CACHE'][('7203.T', True)]
        self.assertEqual((saved[0], saved[1]['fetched_at']), (1000, 1000))
        self.context['time'].time = lambda: 1077.0
        ticker.history.side_effect = None
        ticker.fast_info['last_price'] = 102
        fresh = self.client.get('/api/quote?symbol=7203.T&light=1').get_json()
        self.assertEqual((fresh['price'], fresh['fetched_at']), (102, 1077))
        self.assertEqual(ticker.history.call_count, 3)

    def test_waiting_for_inflight_quote_has_a_bounded_timeout(self):
        lock = Mock()
        lock.acquire.return_value = False
        self.context['_QUOTE_LOCKS'] = (lock,)
        response = self.client.get('/api/quote?symbol=7203.T&light=1')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('fetched_at', response.get_json())
        lock.acquire.assert_called_once_with(timeout=10)
        lock.release.assert_not_called()
        self.ticker_factory.assert_not_called()


if __name__ == '__main__':
    unittest.main()

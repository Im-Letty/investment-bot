"""On-demand delayed quotes preserve observation times without bulk scanning."""
from copy import deepcopy
from datetime import datetime, timezone
from email.utils import format_datetime
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

import requests

from company_quotes import (CompanyQuotes, YahooQuoteProvider, QuoteFailure, TTL,
                            RETAIN, MAX_RECORDS, MAX_BACKOFF_SECONDS, parse_quote,
                            retry_after_delay, _valid_record)

NOW = datetime(2026, 10, 11, 11, tzinfo=timezone.utc).timestamp()


def payload(symbol='7203.T', *, quote_at=NOW - 20 * 60, price=3000, cap=35_000_000_000_000):
    return {'chart': {'error': None, 'result': [{'meta': {
        'symbol': symbol, 'currency': 'JPY', 'regularMarketPrice': price,
        'regularMarketTime': quote_at, 'marketCap': cap}}]}}


def record(symbol='7203.T', *, now=NOW, quote_at=None, cap=35_000_000_000_000):
    return parse_quote(payload(symbol, quote_at=now - 20 * 60 if quote_at is None else quote_at,
                               cap=cap), symbol, 'テスト会社', now)


def wait_until(condition, timeout=2):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return
        time.sleep(.005)
    raise AssertionError('background quote operation did not finish')


class Response:
    def __init__(self, status, data=b'', headers=None):
        self.status_code, self.headers = status, headers or {}
        self.parts = [data if isinstance(data, bytes) else json.dumps(data).encode()]
        self.raw = self
        self.reads = 0
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return None
    def read1(self, *args, **kwargs):
        self.reads += 1
        return self.parts.pop(0) if self.parts else b''


class ParseTests(unittest.TestCase):
    def test_quote_is_delayed_and_observed_separately_from_fetch(self):
        value = record()
        self.assertEqual(value['data']['price'], 3000)
        self.assertEqual(value['data']['price_updated_at'], NOW - 1200)
        self.assertEqual(value['source']['fields']['price'], {'fetched_at': NOW, 'as_of': NOW - 1200})
        self.assertEqual(value['source']['kind'], 'delayed')
        self.assertEqual(value['source']['delay_minutes'], 20)
        self.assertIsNone(value['source']['fields']['market_cap']['as_of'])
        self.assertNotIn('dividend', json.dumps(value))

    def test_missing_cap_is_not_computed_from_shares_or_previous_close(self):
        raw = payload(cap=None)
        raw['chart']['result'][0]['meta'].update(sharesOutstanding=10_000, chartPreviousClose=2900)
        value = parse_quote(raw, '7203.T', 'トヨタ', NOW)
        self.assertIsNone(value['data']['market_cap'])
        self.assertEqual(value['field_status']['market_cap'], 'source_missing')

    def test_wrong_symbol_currency_shape_and_local_exchange_rejected(self):
        for symbol in ['7203', '7203.JP', 'AAPL', '../7203.T', '7203.T?crumb=private']:
            self.assertIsNone(parse_quote(payload(), symbol, 'test', NOW))
        for key, value in [('symbol', '9432.T'), ('currency', 'USD')]:
            raw = payload(); raw['chart']['result'][0]['meta'][key] = value
            self.assertIsNone(parse_quote(raw, '7203.T', 'test', NOW))
        for raw in [{}, {'chart': {}}, {'chart': {'error': 'private', 'result': []}},
                    {'chart': {'result': [{}, {}]}}]:
            self.assertIsNone(parse_quote(raw, '7203.T', 'test', NOW))
        self.assertIsNotNone(parse_quote(payload('285A.T'), '285A.T', 'test', NOW))

    def test_future_missing_or_30day_old_quote_is_not_available(self):
        for quote_at in [None, NOW + 1, NOW - RETAIN, 0, float('nan'), True]:
            value = parse_quote(payload(quote_at=quote_at), '7203.T', 'test', NOW)
            self.assertIsNone(value['data']['price'])
            self.assertIsNone(value['data']['price_updated_at'])
            self.assertNotIn('price', value['source']['fields'])
        self.assertIsNone(parse_quote(payload(quote_at=None, cap=None), '7203.T', 'test', NOW))

    def test_zero_and_nonfinite_prices_do_not_become_zero_quotes(self):
        for value in [0, -1, float('inf'), float('nan'), True, '3000']:
            parsed = parse_quote(payload(price=value, cap=None), '7203.T', 'test', NOW)
            self.assertIsNone(parsed)

    def test_old_actual_trade_survives_without_inventing_market_close(self):
        value = record(quote_at=NOW - 2 * 86400)
        self.assertEqual(value['data']['price_updated_at'], NOW - 2 * 86400)
        self.assertNotIn('market_state', value)
        self.assertEqual(_valid_record(value, NOW), value)

    def test_persisted_extra_fields_never_escape(self):
        value = record(); value['raw_response'] = 'private upstream'; value['data']['shares'] = 1
        value['source']['secret'] = 'credential'
        value['source']['delay_minutes'] = 0
        clean = _valid_record(value, NOW)
        self.assertNotIn('private upstream', json.dumps(clean))
        self.assertNotIn('credential', json.dumps(clean))
        self.assertNotIn('shares', clean['data'])
        self.assertEqual(clean['source']['delay_minutes'], 20)

    def test_saved_cap_does_not_take_stock_quote_time(self):
        value = record(); value['source']['fields']['market_cap']['as_of'] = NOW - 1200
        self.assertIsNone(_valid_record(value, NOW))

    def test_expired_independent_cap_does_not_hide_good_price(self):
        value = record(); value['source']['fields']['market_cap']['fetched_at'] = NOW - RETAIN
        clean = _valid_record(value, NOW)
        self.assertEqual(clean['data']['price'], 3000)
        self.assertIsNone(clean['data']['market_cap'])
        self.assertEqual(clean['field_status']['market_cap'], 'unconfirmed')


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.now = NOW
        self.session = Mock(); self.session.headers = {}
        self.factory = Mock(return_value=self.session)
        self.provider = YahooQuoteProvider(session_factory=self.factory, now=lambda: self.now)

    def test_exact_chart_only_bounded_request(self):
        self.session.get.return_value = Response(200, payload())
        result = self.provider('7203.T', 'トヨタ')
        self.assertEqual(result['data']['price'], 3000)
        self.assertEqual(self.session.get.call_count, 1)
        args, kwargs = self.session.get.call_args
        self.assertEqual(args, ('https://query1.finance.yahoo.com/v8/finance/chart/7203.T',))
        self.assertEqual(kwargs['params'], {'range': '1d', 'interval': '1d'})
        self.assertFalse(kwargs['allow_redirects']); self.assertTrue(kwargs['stream'])
        self.assertLessEqual(sum(kwargs['timeout']), 8)

    def test_invalid_symbol_never_starts_network_session(self):
        for symbol in ['7203.JP', '7203', 'AAPL', None, '7203.T/../']:
            self.assertEqual(self.provider(symbol, 'test').reason, 'invalid')
        self.factory.assert_not_called()

    def test_429_body_is_never_read_and_other_symbols_share_backoff(self):
        denied = Response(429, b'private response', {'Retry-After': '120'})
        self.session.get.side_effect = [denied, Response(200, payload('9432.T', quote_at=NOW - 1000))]
        first = self.provider('7203.T', 'トヨタ')
        self.assertEqual(first.reason, 'rate_limited'); self.assertEqual(first.retry_after_seconds, 120)
        self.assertEqual(denied.reads, 0)
        self.assertEqual(self.provider('9432.T', 'NTT').reason, 'rate_limited')
        self.assertEqual(self.session.get.call_count, 1)
        self.now += 120
        self.assertEqual(self.provider('9432.T', 'NTT')['symbol'], '9432.T')
        self.assertEqual(self.session.get.call_count, 2)

    def test_retry_after_http_dates_invalid_and_fixed_bounds(self):
        date = format_datetime(datetime.fromtimestamp(NOW + 150, timezone.utc), usegmt=True)
        self.assertEqual(retry_after_delay(date, NOW), 150)
        self.assertEqual(retry_after_delay('9999999999', NOW), MAX_BACKOFF_SECONDS)
        for value in ['0', '-1', 'private credential', None, '1' * 200]:
            delay = retry_after_delay(value, NOW)
            self.assertGreaterEqual(delay, 30); self.assertLessEqual(delay, MAX_BACKOFF_SECONDS)

    def test_transport_shape_status_and_body_size_failures_stay_fixed(self):
        for response, expected in [(Response(403, b'private'), 'fetch_error'),
                                   (Response(200, {'chart': []}), 'invalid'),
                                   (Response(200, b'private malformed response'), 'invalid'),
                                   (Response(200, b'x' * 50_001), 'invalid')]:
            self.session.get.return_value = response
            failure = self.provider('7203.T', 'test')
            self.assertEqual(failure.reason, expected)
            self.assertNotIn('private', repr(vars(failure)))
        self.session.get.side_effect = requests.Timeout('private credential')
        self.assertEqual(self.provider('7203.T', 'test').reason, 'fetch_error')

    def test_slow_body_deadline_returns_failure(self):
        self.session.get.return_value = Response(200, payload())
        self.provider.monotonic = Mock(side_effect=[0, 9])
        self.assertEqual(self.provider('7203.T', 'test').reason, 'fetch_error')

    def test_fork_discards_parent_session_and_locked_cooldown(self):
        self.session.get.side_effect = lambda *args, **kwargs: Response(200, payload())
        self.provider('7203.T', 'test')
        old = self.provider._cooldown_lock; old.acquire()
        with patch('company_quotes.os.getpid', return_value=self.provider._pid + 1):
            self.assertEqual(self.provider('7203.T', 'test')['symbol'], '7203.T')
        self.assertIsNot(old, self.provider._cooldown_lock)
        self.assertEqual(self.factory.call_count, 2)
        old.release()


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.now = NOW
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'quotes.json'

    def cache(self, loader=None, **kwargs):
        return CompanyQuotes(loader or (lambda symbol, name: record(symbol, now=self.now)),
                             cache_path=self.path, now=lambda: self.now, **kwargs)

    def wait_done(self, cache, symbol='7203.T'):
        wait_until(lambda: not cache.get(symbol, 'test')['refreshing'])

    def test_first_read_is_immediate_selected_only_and_duplicate_coalesced(self):
        release = threading.Event(); calls = []
        def load(symbol, name):
            calls.append(symbol); release.wait(2); return record(symbol, now=self.now)
        cache = self.cache(load)
        started = time.monotonic(); first = cache.get('7203.T', 'トヨタ')
        self.assertLess(time.monotonic() - started, .1)
        self.assertEqual(first['status'], 'pending')
        self.assertEqual(first['field_status']['price'], 'loading')
        for _ in range(30):
            cache.get('7203.T', 'トヨタ')
        wait_until(lambda: calls == ['7203.T'])
        release.set(); self.wait_done(cache)
        value = cache.get('7203.T', 'トヨタ')
        self.assertEqual(value['status'], 'ready'); self.assertEqual(calls, ['7203.T'])
        self.assertEqual(value['market_data'], dict(kind='delayed', delay_minutes=20,
                         quote_as_of=NOW - 1200, quote_age_seconds=1200, quote_is_recent=True))

    def test_selected_quote_ttl_is_60_seconds(self):
        loader = Mock(side_effect=lambda symbol, name: record(symbol, now=self.now))
        cache = self.cache(loader)
        cache.get('7203.T', 'test'); self.wait_done(cache)
        self.now += TTL - 1
        self.assertFalse(cache.get('7203.T', 'test')['refreshing']); self.assertEqual(loader.call_count, 1)
        self.now += 1
        cache.get('7203.T', 'test'); self.wait_done(cache)
        self.assertEqual(loader.call_count, 2)
        self.assertEqual(cache.get('7203.T', 'test')['updated_at'], self.now)

    def test_failure_retains_dated_price_and_cap_without_bumping_timestamps(self):
        loader = Mock(side_effect=lambda symbol, name: record(symbol, now=self.now))
        cache = self.cache(loader)
        cache.get('7203.T', 'test'); self.wait_done(cache)
        before = cache.get('7203.T', 'test')
        self.now += TTL; loader.side_effect = requests.Timeout('private key')
        cache.get('7203.T', 'test'); self.wait_done(cache)
        after = cache.get('7203.T', 'test')
        self.assertEqual(after['data'], before['data']); self.assertEqual(after['source'], before['source'])
        self.assertEqual(after['updated_at'], NOW); self.assertEqual(after['status'], 'stale')
        self.assertNotIn('private key', json.dumps(after))

    def test_new_retrieval_of_old_trade_does_not_claim_recent_quote(self):
        cache = self.cache(lambda symbol, name: record(symbol, now=self.now, quote_at=NOW - 2 * 86400))
        cache.get('7203.T', 'test'); self.wait_done(cache)
        value = cache.get('7203.T', 'test')
        self.assertEqual(value['status'], 'stale'); self.assertFalse(value['market_data']['quote_is_recent'])
        self.assertEqual(value['market_data']['quote_as_of'], NOW - 2 * 86400)
        self.assertEqual(value['updated_at'], NOW)

    def test_older_trade_cannot_overwrite_newer_saved_trade(self):
        cache = self.cache()
        cache._merge(record(quote_at=NOW - 1200))
        self.now += 60
        incoming = record(now=self.now, quote_at=NOW - 3600)
        incoming['data']['price'] = 2900
        cache._merge(incoming)
        value = cache.get('7203.T', 'test')
        self.assertEqual(value['data']['price'], 3000)
        self.assertEqual(value['data']['price_updated_at'], NOW - 1200)
        self.assertEqual(value['source']['fields']['price']['fetched_at'], NOW)

    def test_absent_cap_keeps_previous_direct_value_and_its_metadata(self):
        cache = self.cache(); cache._merge(record())
        self.now += 60
        cache._merge(record(now=self.now, cap=None))
        value = cache.get('7203.T', 'test')
        self.assertEqual(value['data']['market_cap'], 35_000_000_000_000)
        self.assertEqual(value['source']['fields']['market_cap']['fetched_at'], NOW)
        self.assertIsNone(value['source']['fields']['market_cap']['as_of'])

    def test_queue_is_bounded_and_no_local_only_ticker_fetch(self):
        release = threading.Event(); calls = []
        def load(symbol, name):
            calls.append(symbol); release.wait(2); return record(symbol, now=self.now)
        cache = self.cache(load, max_pending=2)
        for symbol in ['7203.JP', 'AAPL', None]:
            self.assertEqual(cache.get(symbol, 'test')['status'], 'unavailable')
        self.assertEqual(calls, [])
        cache.get('7203.T', 'test'); cache.get('9432.T', 'test')
        self.assertEqual(cache.get('9433.T', 'test')['status'], 'unavailable')
        release.set(); self.wait_done(cache); self.wait_done(cache, '9432.T')
        self.assertEqual(set(calls), {'7203.T', '9432.T'})

    def test_global_backoff_stops_queued_and_new_symbols_without_sleeping(self):
        release = threading.Event(); calls = []
        def load(symbol, name):
            calls.append(symbol); release.wait(2)
            return QuoteFailure('rate_limited', retry_after_seconds=120)
        cache = self.cache(load)
        cache.get('7203.T', 'test'); cache.get('9432.T', 'test'); release.set()
        self.wait_done(cache); self.wait_done(cache, '9432.T')
        value = cache.get('9433.T', 'test')
        self.assertFalse(value['refreshing']); self.assertEqual(value['retry_after_seconds'], 120)
        self.assertEqual(value['field_status']['price'], 'fetch_error')
        self.assertEqual(calls, ['7203.T'])

    def test_cache_backoff_shared_across_instances_until_exact_expiry(self):
        first = self.cache(lambda symbol, name: QuoteFailure('rate_limited', retry_after_seconds=120))
        first.get('7203.T', 'test'); self.wait_done(first)
        wait_until(lambda: self.path.with_name(self.path.name + '.backoff.json').exists())
        loader = Mock(side_effect=lambda symbol, name: record(symbol, now=self.now))
        second = self.cache(loader)
        self.assertFalse(second.get('9432.T', 'test')['refreshing']); loader.assert_not_called()
        self.now += 120
        second.get('9432.T', 'test'); self.wait_done(second, '9432.T')
        self.assertEqual(loader.call_count, 1)

    def test_invalid_saved_backoff_never_suppresses_provider(self):
        path = self.path.with_name(self.path.name + '.backoff.json')
        for value in [dict(version=1, observed_at=NOW, retry_at=NOW + 86400),
                      dict(version=1, observed_at=NOW + 1, retry_at=NOW + 2),
                      dict(version=1, observed_at=NOW, retry_at=True), []]:
            path.write_text(json.dumps(value))
            cache = self.cache()
            self.assertEqual(cache._read_shared_backoff(NOW), 0)

    def test_cache_restart_reuses_good_value_without_fetch_and_sanitizes_extras(self):
        cache = self.cache(); cache._merge(record()); cache._save()
        loader = Mock(side_effect=AssertionError('should not fetch'))
        restarted = self.cache(loader)
        self.assertEqual(restarted.get('7203.T', 'test')['data']['price'], 3000)
        loader.assert_not_called()

    def test_fork_resets_pending_and_locked_condition_preserving_quote(self):
        cache = self.cache(); cache._merge(record()); cache._pending.add('7203.T')
        old = cache._condition; old.acquire()
        with patch('company_quotes.os.getpid', return_value=cache._pid + 1):
            value = cache.get('7203.T', 'test')
        self.assertEqual(value['status'], 'ready'); self.assertFalse(value['refreshing'])
        self.assertIsNot(old, cache._condition); old.release()

    def test_full_domestic_catalogue_retention_exceeds_old_512(self):
        cache = self.cache()
        self.assertGreaterEqual(cache.max_records, 4096)
        for index in range(3700):
            cache._merge(record(str(1000 + index) + '.T'))
        self.assertEqual(len(cache._records), 3700)
        cache._save(); restarted = self.cache()
        self.assertEqual(len(restarted._records), 3700)
        self.assertEqual(restarted.get('1000.T', 'test')['data']['price'], 3000)

    def test_record_retention_expiry_refetches_instead_of_displaying_old_number(self):
        cache = self.cache(); cache._merge(record())
        self.now += RETAIN
        value = cache.get('7203.T', 'test')
        self.assertIsNone(value['data']); self.assertEqual(value['status'], 'pending')
        self.wait_done(cache)

    def test_parallel_worker_limit_and_pending_singleflight(self):
        release = threading.Event(); lock = threading.Lock()
        active = maximum = 0; calls = []
        def load(symbol, name):
            nonlocal active, maximum
            with lock:
                active += 1; maximum = max(maximum, active); calls.append(symbol)
            release.wait(2)
            with lock:
                active -= 1
            return record(symbol, now=self.now)
        cache = self.cache(load, workers=2)
        for symbol in ['7203.T', '9432.T', '9433.T', '7203.T']:
            cache.get(symbol, 'test')
        wait_until(lambda: len(calls) == 2)
        self.assertEqual(maximum, 2); release.set()
        for symbol in ['7203.T', '9432.T', '9433.T']:
            self.wait_done(cache, symbol)
        self.assertEqual(len(calls), 3); self.assertEqual(maximum, 2)

    def test_atomic_concurrent_saves_merge_both_selected_companies(self):
        first, second = self.cache(), self.cache()
        first._merge(record('7203.T')); second._merge(record('9432.T'))
        start = threading.Event()
        def save(cache):
            start.wait(); cache._save()
        threads = [threading.Thread(target=save, args=(cache,)) for cache in [first, second]]
        for thread in threads:
            thread.start()
        start.set()
        for thread in threads:
            thread.join(2); self.assertFalse(thread.is_alive())
        rows = json.loads(self.path.read_text())['items']
        self.assertEqual({row['symbol'] for row in rows}, {'7203.T', '9432.T'})

    def test_429_does_not_replace_saved_values_or_quote_time(self):
        cache = self.cache(); cache._merge(record()); cache._save()
        before = cache.get('7203.T', 'test')
        self.now += TTL
        cache.loader = lambda symbol, name: QuoteFailure('rate_limited', retry_after_seconds=120)
        cache.get('7203.T', 'test'); self.wait_done(cache)
        after = cache.get('7203.T', 'test')
        self.assertEqual(after['data'], before['data']); self.assertEqual(after['source'], before['source'])
        self.assertEqual(after['updated_at'], before['updated_at']); self.assertEqual(after['retry_after_seconds'], 120)
        self.assertEqual(after['field_status']['price'], 'available')

    def test_refresh_remains_pending_until_quote_persistence_finishes(self):
        loader = Mock(side_effect=lambda symbol, name: record(symbol, now=self.now))
        cache = self.cache(loader)
        entered, release = threading.Event(), threading.Event()
        original = cache._save
        def blocked_save():
            entered.set(); release.wait(2); original()
        cache._save = blocked_save
        cache.get('7203.T', 'test')
        try:
            self.assertTrue(entered.wait(2))
            during = cache.get('7203.T', 'test')
            self.assertTrue(during['refreshing'])
            self.assertEqual(during['data']['price'], 3000)
            self.assertFalse(self.path.exists())
            self.assertEqual(loader.call_count, 1)
        finally:
            release.set(); self.wait_done(cache)
        self.assertTrue(self.path.exists())
        self.assertEqual(json.loads(self.path.read_text())['items'][0]['symbol'], '7203.T')

    def test_refresh_remains_pending_until_shared_backoff_persistence_finishes(self):
        cache = self.cache(lambda symbol, name: QuoteFailure('rate_limited', retry_after_seconds=120))
        cache._merge(record()); self.now += TTL
        entered, release = threading.Event(), threading.Event()
        original = cache._save_shared_backoff
        def blocked_save(delay):
            entered.set(); release.wait(2); original(delay)
        cache._save_shared_backoff = blocked_save
        cache.get('7203.T', 'test')
        try:
            self.assertTrue(entered.wait(2))
            during = cache.get('7203.T', 'test')
            self.assertTrue(during['refreshing'])
            self.assertEqual(during['data']['price_updated_at'], NOW - 1200)
            self.assertEqual(during['retry_after_seconds'], 120)
        finally:
            release.set(); self.wait_done(cache)
        self.assertTrue(self.path.with_name(self.path.name + '.backoff.json').exists())

    def test_persistence_failure_releases_refresh_and_preserves_good_values(self):
        cache = self.cache()
        cache._save = Mock(side_effect=OSError('disk unavailable'))
        cache.get('7203.T', 'test'); self.wait_done(cache)
        first = cache.get('7203.T', 'test')
        self.assertEqual(first['data']['price'], 3000); self.assertFalse(first['refreshing'])
        self.now += TTL
        cache.get('7203.T', 'test'); self.wait_done(cache)
        self.assertEqual(cache._save.call_count, 2)
        self.assertEqual(cache.get('7203.T', 'test')['updated_at'], self.now)

    def test_wrong_ticker_response_is_rejected_without_publishing_it(self):
        cache = self.cache(lambda symbol, name: record('9432.T', now=self.now))
        cache.get('7203.T', 'test'); self.wait_done(cache)
        value = cache.get('7203.T', 'test')
        self.assertIsNone(value['data']); self.assertEqual(value['field_status']['price'], 'invalid')
        self.assertNotIn('9432.T', cache._records)


if __name__ == '__main__':
    unittest.main()

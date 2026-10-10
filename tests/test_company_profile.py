"""Company forecasts retain their meaning, origin and unknown observation dates."""
from copy import deepcopy
from datetime import datetime
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch
from urllib3.exceptions import ReadTimeoutError
import requests

from company_profile import (CompanyProfiles, YahooProfileProvider, JST, TTL,
                             parse_profile, parse_chart_profile, ProfileFailure, FIELDS)

NOW = datetime(2026, 9, 24, 15, tzinfo=JST).timestamp()


def payload(symbol='7203.T'):
    return {'quoteSummary': {'error': None, 'result': [{
        'price': {'symbol': symbol, 'currency': 'JPY', 'marketCap': {'raw': 35000000000000},
                  'regularMarketPrice': {'raw': 3000}, 'regularMarketTime': NOW - 60},
        'summaryDetail': {'dividendRate': 100, 'exDividendDate': 1790640000},
        'financialData': {'targetMeanPrice': 3600, 'targetLowPrice': 2900, 'targetHighPrice': 4900,
                          'numberOfAnalystOpinions': 19, 'financialCurrency': 'JPY'},
        'calendarEvents': {'exDividendDate': 1790640000, 'dividendDate': 1796083200},
        'assetProfile': {'longBusinessSummary': 'Internal English editorial source.'}
    }]}}


def record(symbol='7203.T', now=NOW):
    return parse_profile(payload(symbol), symbol, 'テスト会社', now)


def chart_payload(symbol='7203.T'):
    return {'chart': {'error': None, 'result': [{'meta': {
        'symbol': symbol, 'currency': 'JPY', 'regularMarketPrice': 3000,
        'regularMarketTime': NOW - 60}}]}}


def wait_until(condition, timeout=2):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition(): return
        time.sleep(.005)
    raise AssertionError('background operation did not finish')


class Response:
    def __init__(self, code, data):
        self.status_code = code
        self.parts = [data if isinstance(data, bytes) else json.dumps(data).encode()]
        self.raw = self
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read1(self, *args, **kwargs): return self.parts.pop(0) if self.parts else b''


class ParseTests(unittest.TestCase):
    def test_forecast_is_annualized_and_unknown_forecast_dates_remain_unknown(self):
        result = record(); data = result['data']
        self.assertEqual(data['forward_annual_dividend_per_share'], 100)
        self.assertEqual(data['forward_dividend_basis'], 'annualized')
        self.assertNotIn('annual_dividend', data)
        self.assertNotIn('fiscal_year', data)
        self.assertEqual(data['market_cap'], 35000000000000)
        self.assertEqual(data['analyst_target']['analyst_count'], 19)
        self.assertIsNone(data['analyst_target']['as_of'])
        self.assertIsNone(result['source']['fields']['market_cap']['as_of'])
        self.assertIsNone(result['source']['fields']['forward_annual_dividend_per_share']['as_of'])
        self.assertEqual(data['price_updated_at'], NOW - 60)
        self.assertEqual(result['source']['fields']['price']['as_of'], NOW - 60)
        self.assertEqual(data['ex_dividend_date'], '2026-09-29')
        self.assertEqual(data['dividend_payment_date'], '2026-12-01')

    def test_missing_values_are_null_while_explicit_zero_dividend_is_retained(self):
        value = payload(); modules = value['quoteSummary']['result'][0]
        modules['financialData'] = {}; modules['calendarEvents'] = {}; modules['summaryDetail'] = {}
        result = parse_profile(value, '7203.T', 'トヨタ', NOW)
        self.assertIsNone(result['data']['analyst_target'])
        self.assertIsNone(result['data']['forward_annual_dividend_per_share'])
        self.assertIsNone(result['data']['ex_dividend_date'])
        self.assertIsNone(result['data']['dividend_payment_date'])
        modules['summaryDetail']['dividendRate'] = 0
        self.assertEqual(parse_profile(value, '7203.T', 'トヨタ', NOW)['data']['forward_annual_dividend_per_share'], 0)

    def test_wrong_symbol_currency_impossible_target_and_nonfinite_values(self):
        for field, value in [('symbol','9432.T'), ('currency','USD')]:
            source = payload(); source['quoteSummary']['result'][0]['price'][field] = value
            self.assertIsNone(parse_profile(source, '7203.T', 'トヨタ', NOW))
        source = payload(); financial = source['quoteSummary']['result'][0]['financialData']
        financial['targetLowPrice'] = 10000
        self.assertIsNone(parse_profile(source, '7203.T', 'トヨタ', NOW)['data']['analyst_target'])
        source['quoteSummary']['result'][0]['price']['marketCap'] = float('nan')
        self.assertIsNone(parse_profile(source, '7203.T', 'トヨタ', NOW)['data']['market_cap'])
        self.assertIsNone(parse_profile(payload(), '../7203', 'bad', NOW))

    def test_provider_cookie_handshake_is_bounded_and_tokens_never_enter_result(self):
        session = Mock(); session.headers = {}
        session.get.side_effect = [Response(401, {}), Response(404, b''),
                                   Response(200, b'private-crumb'), Response(200, payload())]
        provider = YahooProfileProvider(session_factory=lambda: session, now=lambda: NOW)
        result = provider('7203.T', 'トヨタ')
        self.assertEqual(result['data']['market_cap'], 35000000000000)
        self.assertEqual(session.get.call_count, 4)
        self.assertNotIn('private-crumb', json.dumps(result))
        self.assertEqual(session.get.call_args.kwargs['params']['crumb'], 'private-crumb')
        for call in session.get.call_args_list:
            self.assertLessEqual(sum(call.kwargs['timeout']), 6)
            self.assertFalse(call.kwargs['allow_redirects'])
        # Reuse the private session on the next symbol rather than another handshake.
        session.get.side_effect = [Response(200, payload('9432.T'))]
        self.assertEqual(provider('9432.T', 'NTT')['symbol'], '9432.T')

    def test_oversize_and_deadline_stop_response_read(self):
        session = Mock(); session.headers = {}
        session.get.return_value = Response(200, b'x' * 250001)
        provider = YahooProfileProvider(session_factory=lambda: session)
        with self.assertRaises(ValueError):
            provider._read(provider._state(), 'https://example.test/', provider.monotonic() + 20)
        ticks = iter([0, 21])
        provider = YahooProfileProvider(session_factory=lambda: session, monotonic=lambda: next(ticks))
        with self.assertRaises(TimeoutError):
            provider._read(provider._state(), 'https://example.test/', 20)

    def test_financial_endpoint_failure_has_small_dated_quote_fallback(self):
        session = Mock(); session.headers = {}; clock = [0]
        session.get.side_effect = [Response(401, {}), Response(404, b''),
                                   Response(403, b'Access denied'), Response(200, chart_payload())]
        provider = YahooProfileProvider(session_factory=lambda: session, now=lambda: NOW,
                                         monotonic=lambda: clock[0])
        result = provider('7203.T', 'トヨタ')
        self.assertTrue(result['partial'])
        self.assertEqual(result['data']['price'], 3000)
        self.assertEqual(result['data']['price_updated_at'], NOW - 60)
        self.assertEqual(result['source']['fields']['price'], {'fetched_at': NOW, 'as_of': NOW - 60})
        for key in ('market_cap', 'analyst_target', 'forward_annual_dividend_per_share',
                    'ex_dividend_date', 'dividend_payment_date'):
            self.assertIsNone(result['data'][key])
        self.assertEqual(session.get.call_args.kwargs['params'], {'range': '1d', 'interval': '1d'})
        # Avoid repeating the failed handshake for each company or poll.
        session.get.side_effect = [Response(200, chart_payload('9432.T'))]
        clock[0] = 10
        self.assertEqual(provider('9432.T', 'NTT')['symbol'], '9432.T')
        self.assertEqual(session.get.call_count, 5)
        clock[0] = 181
        session.get.side_effect = [Response(200, payload('9432.T'))]
        self.assertNotIn('partial', provider('9432.T', 'NTT'))
        self.assertIn('quoteSummary', session.get.call_args.args[0])

    def test_fallback_reserves_time_inside_original_total_deadline(self):
        clock = [0]; calls = []
        provider = YahooProfileProvider(now=lambda: NOW, monotonic=lambda: clock[0], deadline=20)
        def read(state, url, deadline, **kwargs):
            calls.append((url, deadline))
            if 'quoteSummary' in url:
                clock[0] = deadline
                raise TimeoutError('financial timeout')
            clock[0] = 19
            return 200, json.dumps(chart_payload()).encode()
        provider._read = read
        self.assertEqual(provider('7203.T', 'トヨタ')['data']['price'], 3000)
        self.assertEqual([deadline for url, deadline in calls], [12, 20])
        clock[0] = 0
        def expired(state, url, deadline, **kwargs):
            clock[0] = 21
            raise TimeoutError('total timeout')
        provider = YahooProfileProvider(now=lambda: NOW, monotonic=lambda: clock[0])
        provider._read = Mock(side_effect=expired)
        self.assertEqual(set(provider('7203.T', 'トヨタ').field_status.values()), {'fetch_error'})
        self.assertEqual(provider._read.call_count, 1)

    def test_quote_fallback_rejects_identity_currency_and_unobserved_price(self):
        for key, invalid in [('symbol', '9432.T'), ('currency', 'USD'),
                             ('regularMarketTime', NOW + 60), ('regularMarketPrice', float('nan'))]:
            source = chart_payload(); source['chart']['result'][0]['meta'][key] = invalid
            self.assertIsNone(parse_chart_profile(source, '7203.T', 'トヨタ', NOW))
        source = chart_payload(); source['chart']['result'][0]['meta'].update(
            marketCap=35000000000000, dividendRate=100, targetMeanPrice=3600, exDividendDate=1790640000)
        result = parse_chart_profile(source, '7203.T', 'トヨタ', NOW)
        self.assertEqual(result['data']['market_cap'], 35000000000000)
        self.assertIsNone(result['source']['fields']['market_cap']['as_of'])
        self.assertIsNone(result['data']['forward_annual_dividend_per_share'])
        self.assertIsNone(result['data']['analyst_target'])
        self.assertIsNone(result['data']['ex_dividend_date'])
        self.assertEqual(result['field_status']['analyst_target'], 'unconfirmed')

    def test_stream_timeout_or_malformed_summary_can_still_return_dated_quote(self):
        for failure in [ReadTimeoutError(None, None, 'stream timed out'),
                        (200, json.dumps({'quoteSummary': ['invalid shape']}).encode())]:
            provider = YahooProfileProvider(now=lambda: NOW)
            provider._read = Mock(side_effect=[failure, (200, json.dumps(chart_payload()).encode())])
            self.assertTrue(provider('7203.T', 'トヨタ')['partial'])
            self.assertEqual(provider._read.call_count, 2)

    def test_field_reasons_separate_successful_missing_values_from_invalid_values(self):
        source = payload(); modules = source['quoteSummary']['result'][0]
        modules['summaryDetail']['dividendRate'] = {'raw': None}
        modules['calendarEvents']['dividendDate'] = None
        modules['financialData'] = {}
        modules['price']['marketCap'] = 'not a number'
        result = parse_profile(source, '7203.T', 'トヨタ', NOW)
        self.assertEqual(result['field_status']['market_cap'], 'invalid')
        for key in ('forward_annual_dividend_per_share', 'dividend_payment_date', 'analyst_target'):
            self.assertEqual(result['field_status'][key], 'source_missing')
        self.assertEqual(result['field_status']['price'], 'available')
        modules['summaryDetail']['dividendRate'] = 0
        modules['financialData'] = {'targetMeanPrice': 3600, 'targetLowPrice': 4000, 'targetHighPrice': 3000}
        result = parse_profile(source, '7203.T', 'トヨタ', NOW)
        self.assertEqual(result['field_status']['forward_annual_dividend_per_share'], 'available')
        self.assertEqual(result['field_status']['analyst_target'], 'invalid')
        modules['price']['marketCap'] = {}
        self.assertEqual(parse_profile(source, '7203.T', 'トヨタ', NOW)['field_status']['market_cap'], 'invalid')
        self.assertNotIn('unpublished', result['field_status'].values())

    def test_provider_fallback_keeps_summary_failure_reason_for_detailed_fields(self):
        for summary, reason in [(ReadTimeoutError(None, None, 'private request/token'), 'fetch_error'),
                                ((200, b'{invalid json'), 'invalid')]:
            provider = YahooProfileProvider(now=lambda: NOW)
            provider._read = Mock(side_effect=[summary, (200, json.dumps(chart_payload()).encode())])
            result = provider('7203.T', 'トヨタ')
            self.assertEqual(result['field_status']['price'], 'available')
            for key in set(FIELDS) - {'price'}:
                self.assertEqual(result['field_status'][key], reason)
            self.assertNotIn('private request/token', json.dumps(result))

    def test_complete_failure_contains_only_fixed_codes(self):
        provider = YahooProfileProvider(now=lambda: NOW)
        provider._read = Mock(side_effect=ReadTimeoutError(None, None, 'secret raw error'))
        result = provider('7203.T', 'トヨタ')
        self.assertIsInstance(result, ProfileFailure)
        self.assertEqual(set(result.field_status.values()), {'fetch_error'})
        self.assertNotIn('secret', json.dumps(result.field_status))

    def test_suppressed_summary_does_not_copy_another_companys_invalid_reason(self):
        provider = YahooProfileProvider(now=lambda: NOW)
        provider._read = Mock(side_effect=[(200, b'{malformed summary'),
            (200, json.dumps(chart_payload()).encode()),
            (200, json.dumps(chart_payload('9432.T')).encode())])
        first = provider('7203.T', 'トヨタ')
        self.assertEqual(first['field_status']['analyst_target'], 'invalid')
        second = provider('9432.T', 'NTT')
        self.assertEqual(second['field_status']['price'], 'available')
        self.assertEqual(second['field_status']['analyst_target'], 'unconfirmed')
        self.assertEqual(second['field_status']['dividend_payment_date'], 'unconfirmed')
        self.assertEqual(provider._read.call_count, 3)


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.now = NOW
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'profiles.json'

    def cache(self, loader=None, **kwargs):
        return CompanyProfiles(loader or (lambda symbol,name: record(symbol,self.now)),
                               cache_path=self.path, now=lambda: self.now, **kwargs)

    def test_get_is_immediate_singleflight_and_concurrency_is_at_most_two(self):
        release = threading.Event(); active = 0; maximum = 0; calls = []; lock = threading.Lock()
        def load(symbol,name):
            nonlocal active, maximum
            with lock:
                active += 1; maximum = max(maximum,active); calls.append(symbol)
            release.wait(3)
            with lock: active -= 1
            return record(symbol)
        cache = self.cache(load)
        started = time.monotonic()
        first = cache.get('7203.T','トヨタ')
        self.assertLess(time.monotonic()-started,.1); self.assertEqual(first['status'],'pending')
        for _ in range(10): cache.get('7203.T','トヨタ')
        cache.get('9432.T','NTT');cache.get('9433.T','KDDI')
        wait_until(lambda:len(calls)==2)
        self.assertEqual(calls.count('7203.T'),1)
        release.set();wait_until(lambda:cache.get('9433.T','KDDI')['status']=='ready')
        self.assertEqual(maximum,2);self.assertEqual(len(calls),3)
        self.assertEqual(cache.get('7203.T','トヨタ')['status'],'ready')

    def test_failure_preserves_previous_values_timestamps_and_hides_error_details(self):
        loader = Mock(side_effect=lambda symbol,name:record(symbol,self.now))
        cache = self.cache(loader);cache.get('7203.T','トヨタ')
        wait_until(lambda:cache.get('7203.T','トヨタ')['status']=='ready')
        before=cache.get('7203.T','トヨタ')
        self.now+=TTL+1;loader.side_effect=RuntimeError('private credential upstream detail')
        stale=cache.get('7203.T','トヨタ');self.assertEqual(stale['status'],'stale')
        wait_until(lambda:not cache.get('7203.T','トヨタ')['refreshing'])
        after=cache.get('7203.T','トヨタ')
        self.assertEqual(after['data'],before['data']);self.assertEqual(after['source'],before['source'])
        self.assertEqual(after['updated_at'],NOW);self.assertEqual(loader.call_count,2)
        self.assertNotIn('private credential',json.dumps(after))

    def test_partial_response_keeps_old_forecast_with_original_timestamp(self):
        cache=self.cache();cache.get('7203.T','トヨタ')
        wait_until(lambda:cache.get('7203.T','トヨタ')['status']=='ready')
        self.now+=TTL+1
        def partial(symbol,name):
            response=payload(symbol);response['quoteSummary']['result'][0]['financialData']={}
            response['quoteSummary']['result'][0]['price']['regularMarketPrice']=3100
            return parse_profile(response,symbol,name,self.now)
        cache.loader=partial;cache.get('7203.T','トヨタ')
        wait_until(lambda:not cache.get('7203.T','トヨタ')['refreshing'])
        result=cache.get('7203.T','トヨタ')
        self.assertEqual(result['data']['price'],3100)
        self.assertEqual(result['data']['analyst_target']['mean'],3600)
        self.assertEqual(result['source']['fields']['analyst_target']['fetched_at'],NOW)
        self.assertEqual(result['source']['fields']['price']['fetched_at'],self.now)
        self.assertEqual(result['status'],'stale')

    def test_quote_only_fallback_is_partial_and_does_not_refetch_on_every_poll(self):
        loader = Mock(side_effect=lambda symbol, name: parse_chart_profile(
            chart_payload(symbol), symbol, name, self.now))
        cache = self.cache(loader)
        cache.get('7203.T', 'トヨタ')
        wait_until(lambda: not cache.get('7203.T', 'トヨタ')['refreshing'])
        for _ in range(15):
            current = cache.get('7203.T', 'トヨタ')
            self.assertEqual(current['status'], 'stale')
            self.assertTrue(current['partial'])
            self.assertFalse(current['refreshing'])
        self.assertEqual(loader.call_count, 1)
        self.now += 181
        cache.get('7203.T', 'トヨタ')
        wait_until(lambda: loader.call_count == 2 and not cache.get('7203.T', 'トヨタ')['refreshing'])
        self.assertEqual(cache.get('7203.T', 'トヨタ')['source']['fields']['price']['fetched_at'], self.now)

    def test_pending_failed_and_queue_saturated_fields_have_distinct_reasons(self):
        release = threading.Event()
        def failed(symbol, name):
            release.wait(2)
            return ProfileFailure('invalid')
        cache = self.cache(failed, max_pending=1)
        pending = cache.get('7203.T', 'トヨタ')
        self.assertEqual(set(pending['field_status'].values()), {'loading'})
        saturated = cache.get('9432.T', 'NTT')
        self.assertEqual(set(saturated['field_status'].values()), {'unconfirmed'})
        release.set()
        wait_until(lambda: not cache.get('7203.T', 'トヨタ')['refreshing'])
        failure = cache.get('7203.T', 'トヨタ')
        self.assertEqual(set(failure['field_status'].values()), {'invalid'})
        self.assertEqual(failure['status'], 'unavailable')

    def test_cached_valid_facts_survive_failed_attempt_without_new_timestamps(self):
        cache = self.cache(); cache.get('7203.T', 'トヨタ')
        wait_until(lambda: cache.get('7203.T', 'トヨタ')['status'] == 'ready')
        before = cache.get('7203.T', 'トヨタ')
        self.now += TTL + 1
        cache.loader = lambda symbol, name: ProfileFailure('fetch_error')
        cache.get('7203.T', 'トヨタ')
        wait_until(lambda: not cache.get('7203.T', 'トヨタ')['refreshing'])
        after = cache.get('7203.T', 'トヨタ')
        self.assertEqual(after['data'], before['data'])
        self.assertEqual(after['source'], before['source'])
        self.assertEqual(after['updated_at'], NOW)
        self.assertEqual(after['field_status']['price'], 'available')

    def test_partial_merge_retains_old_values_and_marks_only_missing_fields_failed(self):
        cache = self.cache(); cache.get('7203.T', 'トヨタ')
        wait_until(lambda: cache.get('7203.T', 'トヨタ')['status'] == 'ready')
        self.now += TTL + 1
        cache.loader = lambda symbol, name: parse_chart_profile(chart_payload(symbol), symbol, name, self.now,
                                                               summary_status='fetch_error')
        cache.get('7203.T', 'トヨタ')
        wait_until(lambda: not cache.get('7203.T', 'トヨタ')['refreshing'])
        result = cache.get('7203.T', 'トヨタ')
        self.assertEqual(result['field_status']['analyst_target'], 'available')
        self.assertEqual(result['source']['fields']['analyst_target']['fetched_at'], NOW)

    def test_successful_all_missing_response_is_cached_as_source_missing_not_failure(self):
        source = {'quoteSummary': {'result': [{'price': {'symbol': '7203.T', 'currency': 'JPY'}}]}}
        loader = Mock(side_effect=lambda symbol, name: parse_profile(source, symbol, name, self.now))
        cache = self.cache(loader); cache.get('7203.T', 'トヨタ')
        wait_until(lambda: not cache.get('7203.T', 'トヨタ')['refreshing'])
        result = cache.get('7203.T', 'トヨタ')
        self.assertEqual(set(result['field_status'].values()), {'source_missing'})
        self.assertEqual(result['status'], 'ready')
        for _ in range(5): cache.get('7203.T', 'トヨタ')
        self.assertEqual(loader.call_count, 1)

    def test_legacy_or_malformed_cached_reasons_do_not_claim_confirmed_missing(self):
        value = record(); value['data']['dividend_payment_date'] = None
        value['source']['fields'].pop('dividend_payment_date')
        for supplied in [None, {'dividend_payment_date': 'unpublished'},
                         {'dividend_payment_date': []}, {'dividend_payment_date': 'available'}]:
            value['field_status'] = supplied
            self.path.write_text(json.dumps({'items': [value]}))
            cache = self.cache(Mock(side_effect=AssertionError('no fetch needed')))
            result = cache.get('7203.T', 'トヨタ')
            self.assertEqual(result['field_status']['dividend_payment_date'], 'unconfirmed')
            self.assertEqual(result['field_status']['price'], 'available')

    def test_unknown_loader_failure_is_not_reported_as_network_error(self):
        for supplied, reason in [(None, 'unconfirmed'), (RuntimeError('unknown issue'), 'unconfirmed'),
                                (requests.ConnectionError('private connection'), 'fetch_error'),
                                (TimeoutError('timed out'), 'fetch_error'),
                                (ValueError('invalid shape'), 'invalid')]:
            loader = Mock(side_effect=supplied) if isinstance(supplied, Exception) else Mock(return_value=supplied)
            cache = self.cache(loader)
            cache.get('7203.T', 'トヨタ')
            wait_until(lambda: not cache.get('7203.T', 'トヨタ')['refreshing'])
            result = cache.get('7203.T', 'トヨタ')
            self.assertEqual(set(result['field_status'].values()), {reason})
            self.assertNotIn('private', json.dumps(result))

    def test_older_or_unconfirmed_merge_does_not_erase_missing_reason(self):
        source = payload(); source['quoteSummary']['result'][0]['calendarEvents']['dividendDate'] = None
        cache = self.cache()
        newer = parse_profile(source, '7203.T', 'トヨタ', self.now)
        cache._merge(newer)
        older = deepcopy(newer); older['updated_at'] -= 60
        older['field_status']['dividend_payment_date'] = 'invalid'
        cache._merge(older)
        self.assertEqual(cache.get('7203.T', 'トヨタ')['field_status']['dividend_payment_date'], 'source_missing')
        unconfirmed = deepcopy(newer); unconfirmed['updated_at'] += 1
        self.now += 1
        unconfirmed['field_status']['dividend_payment_date'] = 'unconfirmed'
        cache._merge(unconfirmed)
        self.assertEqual(cache.get('7203.T', 'トヨタ')['field_status']['dividend_payment_date'], 'source_missing')

    def test_transport_failure_keeps_definitive_missing_reason_but_updates_unknown(self):
        source = {'quoteSummary': {'result': [{'price': {
            'symbol': '7203.T', 'currency': 'JPY', 'regularMarketPrice': 3000,
            'regularMarketTime': NOW - 60}}]}}
        before = parse_profile(source, '7203.T', 'トヨタ', self.now)
        before['field_status']['market_cap'] = 'unconfirmed'
        cache = self.cache(); cache._merge(before)
        self.now += TTL + 1
        cache.loader = lambda symbol, name: ProfileFailure('fetch_error')
        cache.get('7203.T', 'トヨタ')
        wait_until(lambda: not cache.get('7203.T', 'トヨタ')['refreshing'])
        result = cache.get('7203.T', 'トヨタ')
        self.assertEqual(result['field_status']['dividend_payment_date'], 'source_missing')
        self.assertEqual(result['field_status']['market_cap'], 'fetch_error')
        self.assertEqual(result['field_status']['price'], 'available')
        self.assertEqual(result['source']['fields']['price']['fetched_at'], NOW)

    def test_chart_partial_keeps_definitive_empty_field_observations_until_new_response(self):
        source = payload(); modules = source['quoteSummary']['result'][0]
        modules['calendarEvents']['dividendDate'] = None
        modules['financialData']['targetLowPrice'] = 10000
        cache = self.cache(); cache._merge(parse_profile(source, '7203.T', 'トヨタ', self.now))
        self.now += TTL + 1
        cache.loader = lambda symbol, name: parse_chart_profile(chart_payload(symbol), symbol, name, self.now,
                                                               summary_status='fetch_error')
        cache.get('7203.T', 'トヨタ')
        wait_until(lambda: not cache.get('7203.T', 'トヨタ')['refreshing'])
        result = cache.get('7203.T', 'トヨタ')
        self.assertEqual(result['field_status']['dividend_payment_date'], 'source_missing')
        self.assertEqual(result['field_status']['analyst_target'], 'invalid')
        self.assertEqual(result['field_status']['price'], 'available')
        self.assertEqual(result['source']['fields']['price']['fetched_at'], self.now)
        self.now += 1
        modules['financialData'] = {}
        modules['calendarEvents']['dividendDate'] = 1796083200
        cache._merge(parse_profile(source, '7203.T', 'トヨタ', self.now))
        updated = cache.get('7203.T', 'トヨタ')
        self.assertEqual(updated['field_status']['analyst_target'], 'source_missing')
        self.assertEqual(updated['field_status']['dividend_payment_date'], 'available')

    def test_disk_restart_and_raw_business_summary_is_editorial_only(self):
        cache=self.cache();cache.get('7203.T','トヨタ')
        wait_until(lambda:cache.get('7203.T','トヨタ')['status']=='ready')
        wait_until(self.path.exists)
        public=cache.get('7203.T','トヨタ')
        self.assertNotIn('Internal English',json.dumps(public));self.assertNotIn('_business_summary',public)
        self.assertEqual(cache.get_business_summary_for_review('7203.T'),'Internal English editorial source.')
        loader=Mock(side_effect=AssertionError('no network needed'))
        restart=self.cache(loader)
        self.assertEqual(restart.get('7203.T','トヨタ')['status'],'ready');loader.assert_not_called()

    def test_separate_worker_snapshots_merge_disk_without_losing_other_symbols(self):
        first=self.cache();second=self.cache()
        first._records['7203.T']=record('7203.T')
        second._records['9432.T']=record('9432.T')
        start=threading.Event()
        def save(cache): start.wait();cache._save()
        a=threading.Thread(target=save,args=(first,));b=threading.Thread(target=save,args=(second,))
        a.start();b.start();start.set();a.join(2);b.join(2)
        self.assertFalse(a.is_alive());self.assertFalse(b.is_alive())
        saved=json.loads(self.path.read_text())
        self.assertEqual({row['symbol'] for row in saved['items']},{'7203.T','9432.T'})
        first.loader=Mock(side_effect=AssertionError('disk data should be reused'))
        self.assertEqual(first.get('9432.T','NTT')['status'],'ready')
        first.loader.assert_not_called()

    def test_invalid_cached_price_observation_time_is_rejected(self):
        for invalid in [NOW+60,float('nan'),float('inf'),-1]:
            value=record();value['data']['price_updated_at']=invalid
            self.path.write_text(json.dumps({'items':[value]}))
            loader=Mock(return_value=None)
            cache=self.cache(loader)
            result=cache.get('7203.T','トヨタ')
            self.assertIsNone(result['data'])
            wait_until(lambda:not cache.get('7203.T','トヨタ')['refreshing'])

    def test_queue_is_bounded_and_invalid_symbols_never_start_provider(self):
        release=threading.Event();calls=[]
        def load(symbol,name): calls.append(symbol);release.wait(3);return record(symbol)
        cache=self.cache(load,max_pending=2)
        for bad in ['7203','AAPL','7203.T/../x','../../etc/passwd','7203.T?crumb=x',None]:
            self.assertEqual(cache.get(bad,'test')['status'],'unavailable')
        self.assertEqual(calls,[])
        cache.get('7203.T','トヨタ');cache.get('9432.T','NTT')
        self.assertEqual(cache.get('9433.T','KDDI')['status'],'unavailable')
        release.set();wait_until(lambda:cache.get('7203.T','トヨタ')['status']=='ready')

    def test_fork_resets_parent_condition_and_pending_without_erasing_facts(self):
        cache=self.cache();cache._records['7203.T']=record()
        cache._pending.add('7203.T');old=cache._condition;old.acquire()
        with patch('company_profile.os.getpid',return_value=cache._pid+1):
            result=cache.get('7203.T','トヨタ')
        self.assertEqual(result['status'],'ready');self.assertFalse(result['refreshing'])
        self.assertIsNot(old,cache._condition);old.release()


if __name__=='__main__':unittest.main()

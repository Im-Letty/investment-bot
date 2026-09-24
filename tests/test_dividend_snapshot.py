"""Dividend views share immediate, dated data instead of blocking scans."""
import ast
from copy import deepcopy
from datetime import datetime
import json
from pathlib import Path
import re
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

from flask import Flask, jsonify, request
from dividend_snapshot import DividendSnapshot, JST, TTL, parse_chart, validated, fetch_dividend_info

ROOT = Path(__file__).parents[1]
NOW = datetime(2026, 9, 24, 14, 0, tzinfo=JST).timestamp()


def stamp(day):
    return datetime.fromisoformat(day).replace(tzinfo=JST).timestamp()


def chart():
    return {'chart': {'result': [{'meta': {'symbol': '7203.T', 'currency': 'JPY',
            'regularMarketPrice': 3000, 'regularMarketTime': NOW - 60},
            'events': {'dividends': {
                '1': {'date': stamp('2025-03-28'), 'amount': 50},
                '2': {'date': stamp('2025-09-29'), 'amount': 45},
                '3': {'date': stamp('2026-03-30'), 'amount': 50}}}}], 'error': None}}


def row(code='7203', now=NOW):
    value = parse_chart(chart(), '7203.T', 'トヨタ自動車', now)
    value.update(ticker=code + '.T', code=code)
    return value


class ParsingTests(unittest.TestCase):
    def test_real_trailing_year_price_date_and_calendar_dates(self):
        actual = parse_chart(chart(), '7203.T', 'トヨタ自動車', NOW)
        self.assertEqual(actual['annual_dividend'], 95)
        self.assertEqual(actual['yield_pct'], 3.17)
        self.assertEqual(actual['price_updated_at'], NOW - 60)
        self.assertEqual(actual['fetched_at'], NOW)
        self.assertEqual(actual['ex_dividend_dates'], ['2025-03-28', '2025-09-29', '2026-03-30'])
        self.assertEqual(actual['history'], [{'year': 2025, 'total': 95}, {'year': 2026, 'total': 50}])

    def test_missing_price_is_unknown_not_zero_dividend_history_survives(self):
        data = chart(); data['chart']['result'][0]['meta'].pop('regularMarketPrice')
        actual = parse_chart(data, '7203.T', 'トヨタ自動車', NOW)
        self.assertIsNone(actual['price']); self.assertIsNone(actual['yield_pct'])
        self.assertEqual(actual['annual_dividend'], 95)
        empty = deepcopy(data); empty['chart']['result'][0]['events'] = {}
        self.assertIsNone(parse_chart(empty, '7203.T', 'トヨタ自動車', NOW))

    def test_unverified_split_adjustment_never_creates_false_high_yield(self):
        data = chart()
        data['chart']['result'][0]['events']['splits'] = {
            '1': {'date': stamp('2026-06-01'), 'numerator': 10, 'denominator': 1}}
        actual = parse_chart(data, '7203.T', 'トヨタ自動車', NOW)
        self.assertIsNone(actual['annual_dividend']); self.assertIsNone(actual['yield_pct'])
        self.assertEqual(actual['calculation_status'], 'split_review')
        self.assertEqual(actual['price'], 3000)

    def test_future_declared_dividend_is_not_counted_as_paid(self):
        data = chart()
        data['chart']['result'][0]['events']['dividends']['4'] = {'date': stamp('2026-09-29'), 'amount': 55}
        actual = parse_chart(data, '7203.T', 'トヨタ自動車', NOW)
        self.assertEqual(actual['annual_dividend'], 95)
        self.assertEqual(actual['ex_dividend_date'], '2026-09-29')
        self.assertEqual(actual['history'][-1]['total'], 50)

    def test_validation_preserves_timestamps_rejects_future_and_nan(self):
        good = row()
        bad = dict(good, fetched_at=NOW + 60)
        malformed = dict(good, price=float('nan'))
        undated = dict(good, price_updated_at=None)
        self.assertEqual(validated([bad, malformed, undated], NOW), {})
        repaired = dict(good, yield_pct=99)
        result = validated([repaired], NOW)['7203.T']
        self.assertEqual(result['yield_pct'], 3.17)
        self.assertEqual(result['price_updated_at'], NOW - 60)
        self.assertEqual(result['fetched_at'], NOW)

    def test_provider_request_is_bounded_and_declares_split_events(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.iter_content.return_value = [json.dumps(chart()).encode()]
        get = Mock(return_value=response)
        self.assertEqual(fetch_dividend_info('7203.T', 'トヨタ', now=lambda: NOW, get=get)['yield_pct'], 3.17)
        self.assertEqual(get.call_args.kwargs['timeout'], (2, 4))
        self.assertEqual(get.call_args.kwargs['params']['events'], 'div,splits')
        response.iter_content.return_value = [b'x' * 500001]
        with self.assertRaises(ValueError):
            fetch_dividend_info('7203.T', 'トヨタ', now=lambda: NOW, get=get)
        self.assertIsNone(fetch_dividend_info('../invalid', '', get=get))


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'dividends.json'
        self.now = NOW

    def snapshot(self, companies=None, loader=None, **kwargs):
        return DividendSnapshot(companies or {'7203': 'トヨタ'}, loader or (lambda *args: row(now=self.now)),
                                seed_path=None, cache_path=self.path, now=lambda: self.now,
                                startup_delay=0, **kwargs)

    def test_requests_return_immediately_share_one_refresh_and_max_two_workers(self):
        release = threading.Event(); entered = threading.Event()
        guard = threading.Lock(); calls = []; active = 0; maximum = 0
        def load(ticker, name):
            nonlocal active, maximum
            with guard:
                calls.append(ticker); active += 1; maximum = max(maximum, active)
                if active == 2: entered.set()
            release.wait(3)
            with guard: active -= 1
            return row(ticker[:-2])
        service = self.snapshot({'7203': 'トヨタ', '9432': 'NTT', '9433': 'KDDI'}, load)
        start = time.monotonic(); initial = service.payload()
        self.assertLess(time.monotonic() - start, .1)
        self.assertEqual(initial['status'], 'loading'); self.assertTrue(initial['refreshing'])
        self.assertTrue(entered.wait(1))
        for _ in range(10): service.payload()
        self.assertEqual(len(calls), 2)
        release.set(); service._thread.join(3)
        ready = service.payload(refresh=False)
        self.assertEqual(ready['status'], 'ready'); self.assertEqual(len(ready['items']), 3)
        self.assertEqual(maximum, 2); self.assertEqual(len(calls), 3)

    def test_failure_keeps_last_good_dates_disk_restart_and_retry_guard(self):
        service = self.snapshot(); service.payload(); service._thread.join(2)
        original = service.payload(refresh=False)['items']
        self.now += TTL + 1
        service.loader = Mock(side_effect=RuntimeError('provider down'))
        stale = service.payload(); service._thread.join(2)
        stale = service.payload()
        self.assertEqual(stale['status'], 'stale')
        self.assertEqual(stale['items'], original)
        self.assertEqual(stale['updated_at'], NOW)
        self.assertFalse(stale['refreshing'])
        self.assertEqual(service.loader.call_count, 1)
        restart = self.snapshot(loader=Mock(side_effect=AssertionError('must not block')))
        saved = restart.payload(refresh=False)
        self.assertEqual(saved['items'], original); self.assertEqual(saved['status'], 'stale')

    def test_incomplete_response_does_not_replace_known_price(self):
        service = self.snapshot(); service.payload(); service._thread.join(2)
        self.now += TTL + 1
        replacement = row(now=self.now); replacement['price'] = replacement['price_updated_at'] = None
        service.loader = lambda *args: replacement
        service.payload(); service._thread.join(2)
        result = service.payload(refresh=False)['items'][0]
        self.assertEqual(result['price'], 3000); self.assertEqual(result['fetched_at'], NOW)

    def test_process_fork_resets_lock_and_running_flag_and_retains_seed(self):
        service = self.snapshot(); service.payload(); service._thread.join(2)
        service._running = True
        service._lock.acquire()
        old_lock = service._lock
        with patch('dividend_snapshot.os.getpid', return_value=service._pid + 1):
            result = service.payload(refresh=False)
        self.assertFalse(result['refreshing']); self.assertEqual(len(result['items']), 1)
        self.assertIsNot(service._lock, old_lock)
        old_lock.release()

    def test_two_process_managers_use_one_disk_scan(self):
        release = threading.Event(); entered = threading.Event()
        def load(*args): entered.set(); release.wait(3); return row()
        first = self.snapshot(loader=load); second_loader = Mock(return_value=row())
        second = self.snapshot(loader=second_loader)
        first.payload(); self.assertTrue(entered.wait(1))
        second.payload(); second._thread.join(1)
        second_loader.assert_not_called()
        release.set(); first._thread.join(2)
        self.assertEqual(second.payload(refresh=False)['items'][0]['fetched_at'], NOW)

    def test_new_search_takes_next_slot_in_running_scan(self):
        release = threading.Event(); entered = threading.Event(); calls = []; guard = threading.Lock()
        def load(ticker, name):
            with guard:
                calls.append(ticker)
                if len(calls) == 2: entered.set()
            if ticker in ('7203.T', '9432.T'): release.wait(3)
            return row(ticker[:-2])
        companies = {'7203': 'トヨタ', '9432': 'NTT', '9433': 'KDDI', '9984': 'ソフトバンク'}
        service = self.snapshot(companies, load)
        service.payload(); self.assertTrue(entered.wait(1))
        pending = service.lookup('285A.T', 'キオクシア')
        self.assertEqual(pending['status'], 'loading')
        release.set(); service._thread.join(3)
        self.assertEqual(calls[2], '285A.T')
        self.assertEqual(calls.count('285A.T'), 1)
        self.assertEqual(service.lookup('285A.T', 'キオクシア')['status'], 'ready')

    def test_search_loading_success_and_failure_do_not_repeat_provider_on_poll(self):
        service = self.snapshot(loader=lambda *args: None)
        pending = service.lookup('7203.T', 'トヨタ')
        self.assertIn(pending['status'], ('loading', 'unavailable'))
        service._thread.join(2)
        service.loader = Mock(return_value=None)
        missing = service.lookup('7203.T', 'トヨタ')
        self.assertEqual(missing['status'], 'unavailable'); self.assertIsNone(missing['updated_at'])
        self.assertFalse(missing['refreshing']); service.loader.assert_not_called()
        self.now += 301; service.loader = lambda *args: row(now=self.now)
        service.lookup('7203.T', 'トヨタ'); service._thread.join(2)
        ready = service.lookup('7203.T', 'トヨタ')
        self.assertEqual(ready['status'], 'ready'); self.assertEqual(ready['updated_at'], self.now)


class RouteTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.service = Mock()
        self.service.payload.return_value = {'items': [row()], 'status': 'ready', 'refreshing': False,
                                             'updated_at': NOW, 'annual_dividend_basis': 'trailing_12m'}
        # Each view mutates its own copy of the snapshot, just as the real class does.
        payload = deepcopy(self.service.payload.return_value)
        self.service.payload.side_effect = lambda: deepcopy(payload)
        wanted = {'_dividend_response', '_dividend_limit', 'api_dividend_top',
                  'api_dividend_yearly', 'api_dividend_calendar'}
        tree = ast.parse((ROOT / 'line_bot.py').read_text())
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in wanted]
        scope = dict(app=self.app, jsonify=jsonify, request=request, re=re, _dividend_snapshot=self.service)
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'dividend-routes', 'exec'), scope)
        self.client = self.app.test_client()

    def test_three_views_share_contract_dates_and_nulls(self):
        top = self.client.get('/api/dividend/top?limit=-50').get_json()
        yearly = self.client.get('/api/dividend/yearly?limit=no').get_json()
        calendar = self.client.get('/api/dividend/calendar?month=2025-09').get_json()
        self.assertEqual(top['items'][0]['yield_pct'], 3.17)
        self.assertEqual(yearly['items'][0]['annual_dividend'], 95)
        self.assertEqual(calendar['days'][0]['date'], '2025-09-29')
        for value in (top, yearly, calendar): self.assertEqual(value['updated_at'], NOW)
        self.assertEqual(self.client.get('/api/dividend/calendar?month=2026-99').status_code, 400)
        self.assertEqual(self.service.payload.call_count, 3)
        self.assertEqual(self.client.get('/api/dividend/top').headers['Cache-Control'], 'no-store')

    def test_unknown_yield_is_excluded_but_valid_annual_dividend_remains(self):
        missing = row(); missing['price'] = missing['price_updated_at'] = missing['yield_pct'] = None
        self.service.payload.side_effect = lambda: {'items': [deepcopy(missing)], 'status': 'ready', 'updated_at': NOW}
        top = self.client.get('/api/dividend/top').get_json()
        yearly = self.client.get('/api/dividend/yearly').get_json()
        self.assertEqual(top['items'], [])
        self.assertEqual(yearly['items'][0]['annual_dividend'], 95)
        calendar = self.client.get('/api/dividend/calendar?month=2026-03').get_json()
        self.assertEqual(calendar['days'][0]['items'][0]['ticker'], '7203.T')
        self.assertIn('history', calendar['days'][0]['items'][0])


if __name__ == '__main__':
    unittest.main()

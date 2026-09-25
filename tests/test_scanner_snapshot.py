import ast
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from flask import Flask, jsonify, request
from scanner_snapshot import ScannerSnapshot, valid_quotes, RETAIN


NOW = datetime(2026, 9, 23, 8, tzinfo=timezone.utc).timestamp()
ROOT = Path(__file__).parents[1]


def quote(symbol="7203.T", price=103, previous=100, stamp=NOW):
    return {"symbol": symbol, "name": "会社", "price": price, "prev": previous,
            "fetched_at": stamp, "trade_date": "2026-09-18"}


class ScannerSnapshotTests(unittest.TestCase):
    def test_previous_trading_date_and_exact_change_are_preserved(self):
        row = valid_quotes([quote(price=100.0123, previous=99.9999)], NOW)["7203.T"]
        self.assertEqual(row["trade_date"], "2026-09-18")
        self.assertEqual(row["change_value"], 0.0124)
        self.assertEqual(row["pct"], 0.01)
        self.assertEqual(row["currency"], "JPY")

    def test_rejects_missing_nonfinite_prices_and_unverifiable_dates(self):
        for override in ({"price": None}, {"prev": 0}, {"price": math.nan},
                         {"price": True}, {"trade_date": ""},
                         {"trade_date": "2026-09-28"}, {"fetched_at": NOW + 1},
                         {"fetched_at": NOW - RETAIN}):
            with self.subTest(override=override):
                self.assertEqual(valid_quotes([dict(quote(), **override)], NOW), {})

    def test_read_never_waits_for_the_provider_and_only_starts_one_worker(self):
        started, release = threading.Event(), threading.Event()
        def loader():
            started.set()
            release.wait(2)
            return [quote()]
        source = Mock(side_effect=loader)
        cache = ScannerSnapshot(source, now=lambda: NOW)
        result = cache.payload()
        try:
            self.assertEqual(result["items"], [])
            self.assertTrue(result["refreshing"])
            self.assertTrue(started.wait(1))
            for _ in range(5):
                self.assertTrue(cache.payload()["refreshing"])
            self.assertEqual(source.call_count, 1)
        finally:
            release.set()
            cache._thread.join(2)
        self.assertEqual(cache.payload(refresh=False)["items"][0]["price"], 103)

    def test_failed_refresh_retains_real_snapshot_and_does_not_redate(self):
        old = quote(stamp=NOW - 900)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "seed.json"
            path.write_text(json.dumps({"items": [old]}))
            cache = ScannerSnapshot(Mock(side_effect=RuntimeError("provider unavailable")),
                                    seed_path=path, now=lambda: NOW)
            cache._refresh()
            result = cache.payload(refresh=False)
            self.assertTrue(result["stale"])
            self.assertEqual(result["updated_at"], NOW - 900)
            self.assertEqual(result["items"][0]["trade_date"], old["trade_date"])

    def test_partial_refresh_keeps_other_prices_with_their_own_ages(self):
        cache = ScannerSnapshot(lambda: [quote(price=106)], now=lambda: NOW)
        cache._quotes = valid_quotes([quote(stamp=NOW - 900), quote("6758.T", stamp=NOW - 900)], NOW)
        cache._refresh()
        rows = {row["symbol"]: row for row in cache.payload(refresh=False)["items"]}
        self.assertEqual(rows["7203.T"]["price"], 106)
        self.assertEqual(rows["6758.T"]["fetched_at"], NOW - 900)

    def test_completed_refresh_persists_valid_data_for_the_next_process(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "cache.json"
            cache = ScannerSnapshot(lambda: [quote()], cache_path=path, now=lambda: NOW)
            cache._refresh()
            next_cache = ScannerSnapshot(lambda: [], cache_path=path, now=lambda: NOW)
            self.assertEqual(next_cache.payload(refresh=False)["items"], cache.payload(refresh=False)["items"])

    def test_expired_snapshots_are_not_shown(self):
        cache = ScannerSnapshot(lambda: [], now=lambda: NOW + RETAIN)
        cache._quotes = valid_quotes([quote()], NOW)
        self.assertEqual(cache.payload(refresh=False)["items"], [])


class ScannerRouteTests(unittest.TestCase):
    def setUp(self):
        tree = ast.parse((ROOT / "line_bot.py").read_text())
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "api_scanner"]
        self.app = Flask("scanner-test")
        self.jp = [str(1000 + n) + ".T" for n in range(50)]
        self.us = ["AAPL"]
        rows = [quote(symbol, 110 + n) for n, symbol in enumerate(self.jp[:25])]
        rows += [quote(symbol, 90 - n) for n, symbol in enumerate(self.jp[25:])]
        rows += [quote("AAPL", 300)]
        self.snapshot = Mock()
        self.snapshot.payload.return_value = dict(items=list(valid_quotes(rows, NOW).values()),
            updated_at=NOW, cache_age_sec=0, stale=False, refreshing=False)
        context = dict(app=self.app, jsonify=jsonify, request=request, math=math,
                       time=SimpleNamespace(time=lambda: NOW), _SCANNER_TTL=600,
                       _SCANNER_UNIVERSE={key: {"name": key, "market": "prime"} for key in self.jp},
                       _scanner_snapshot=self.snapshot, _SCANNER_TICKERS_JP=self.jp, _SCANNER_TICKERS_US=self.us)
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(ROOT / "line_bot.py"), "exec"), context)
        self.client = self.app.test_client()

    def test_limits_sorts_and_reports_selected_scope(self):
        data = self.client.get("/api/scanner?limit=100").get_json()
        self.assertEqual((len(data["surges"]), len(data["drops"])), (20, 20))
        self.assertEqual(data["surges"][0]["symbol"], self.jp[24])
        self.assertEqual(data["drops"][0]["symbol"], self.jp[49])
        self.assertEqual(data["total_scanned"], 50)
        self.assertEqual(data["universe_size"], 50)
        self.assertTrue(all(row["currency"] == "JPY" for row in data["items"]))
        self.assertEqual(data["scope"], "rolling_jp")

    def test_pro_includes_us_with_currency_and_defaults_to_ten_per_direction(self):
        data = self.client.get("/api/scanner?pro=1").get_json()
        self.assertEqual(len(data["surges"]), 10)
        self.assertEqual(data["total_scanned"], 51)
        self.assertEqual(data["surges"][0]["symbol"], "AAPL")
        self.assertEqual(data["surges"][0]["currency"], "USD")
        self.assertEqual(data["scope"], "rolling_jp_us")

    def test_invalid_threshold_does_not_suppress_all_rows(self):
        for threshold in ("nan", "inf", "invalid"):
            with self.subTest(threshold=threshold):
                data = self.client.get("/api/scanner?threshold=" + threshold).get_json()
                self.assertEqual(data["threshold"], 3)
                self.assertTrue(data["surges"])

    def test_new_us_quotes_do_not_redate_the_japanese_scope(self):
        for row in self.snapshot.payload.return_value["items"]:
            if row["symbol"].endswith(".T"):
                row["fetched_at"] = NOW - 900
        data = self.client.get("/api/scanner").get_json()
        self.assertEqual(data["updated_at"], NOW - 900)
        self.assertEqual(data["cache_age_sec"], 900)
        self.assertTrue(data["stale"])
        pro = self.client.get("/api/scanner?pro=1").get_json()
        self.assertEqual(pro["updated_at"], NOW)
        self.assertTrue(pro["stale"])

    def test_empty_snapshot_returns_pending_state_without_fake_zero_prices(self):
        self.snapshot.payload.return_value.update(items=[], updated_at=None, cache_age_sec=None,
                                                 stale=True, refreshing=True)
        data = self.client.get("/api/scanner").get_json()
        self.assertEqual(data["items"], [])
        self.assertEqual(data["total_scanned"], 0)
        self.assertIsNone(data["updated_at"])
        self.assertTrue(data["refreshing"])


class ScannerLoaderTests(unittest.TestCase):
    def test_loader_preserves_bar_date_and_never_adjusts_previous_close(self):
        tree = ast.parse((ROOT / "line_bot.py").read_text())
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "_build_scanner_data"]
        source_day = datetime(2026, 9, 18)
        closes = SimpleNamespace(iloc=[101.025, 103.075], index=[source_day, source_day])
        class Series:
            def dropna(self):
                return self
            def __len__(self):
                return 2
            iloc = closes.iloc
            index = closes.index
        download = Mock(return_value={"7203.T": {"Close": Series()}, "6758.T": {"Close": Series()}})
        from scanner_universe import next_batch
        context = dict(next_batch=next_batch, _scanner_cursor=0, yf=SimpleNamespace(download=download),
                       time=SimpleNamespace(time=lambda: NOW), math=math,
                       gc=SimpleNamespace(collect=lambda: None),
                       _SCANNER_TICKERS_JP=["7203.T", "6758.T"], _SCANNER_TICKERS_US=[],
                       JP_STOCKS={"7203": "トヨタ自動車", "6758": "ソニーグループ"})
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(ROOT / "line_bot.py"), "exec"), context)
        rows = context["_build_scanner_data"]()
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["trade_date"], "2026-09-18")
        self.assertEqual(rows[0]["prev"], 101.025)
        self.assertEqual(rows[0]["change_value"], 2.05)
        self.assertEqual(rows[0]["name"], "トヨタ自動車")
        self.assertFalse(download.call_args.kwargs["auto_adjust"])
        self.assertLessEqual(download.call_args.kwargs["timeout"], 10)


if __name__ == "__main__":
    unittest.main()

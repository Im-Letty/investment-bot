import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock

from market_snapshot import CORE_MARKETS, MarketSnapshot, RETAIN, validated_market


def quote(price=42000, stamp=1000):
    return {"price": price, "display": f"{price:,.2f} ▲1%", "pct": 1,
            "change_value": 420, "currency": "JPY", "fetched_at": stamp}


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.seed = Path(self.directory.name) / "seed.json"
        self.cache = Path(self.directory.name) / "cache.json"

    def store(self, path, market):
        path.write_text(json.dumps({"market": market}), encoding="utf-8")

    def finish(self, snapshot):
        snapshot._thread.join(timeout=2)
        self.assertFalse(snapshot._thread.is_alive())

    def test_stale_response_does_not_wait_and_refresh_is_single_flight(self):
        entered, release = threading.Event(), threading.Event()
        def load():
            entered.set()
            release.wait(2)
            return {"market": {"日経225": quote(42100, 1100)}}
        loader = Mock(side_effect=load)
        self.store(self.seed, {"日経225": quote()})
        snapshot = MarketSnapshot(loader, seed_path=self.seed, now=lambda:1100)
        try:
            response = snapshot.payload()
            self.assertTrue(entered.wait(1))
            self.assertEqual(response["market"]["日経225"]["price"], 42000)
            self.assertEqual(response["fetched_at"], 1000)
            self.assertTrue(response["stale"])
            self.assertTrue(response["refreshing"])
            for _ in range(20):
                self.assertEqual(snapshot.payload()["market"]["日経225"]["price"], 42000)
            self.assertEqual(loader.call_count, 1)
        finally:
            release.set()
            self.finish(snapshot)
        self.assertEqual(snapshot.payload(refresh=False)["market"]["日経225"]["price"], 42100)

    def test_fresh_snapshot_starts_no_requests(self):
        loader = Mock()
        self.store(self.seed, {label: quote() for label in CORE_MARKETS})
        snapshot = MarketSnapshot(loader, seed_path=self.seed, now=lambda:1010)
        self.assertFalse(snapshot.payload()["refreshing"])
        self.assertFalse(snapshot.payload()["stale"])
        loader.assert_not_called()

    def test_partial_refresh_keeps_individual_timestamps_and_persists(self):
        self.store(self.seed, {"日経225": quote(), "ドル円": quote(150, 990)})
        snapshot = MarketSnapshot(lambda:{"market":{"日経225":quote(42100,1100)}},
                                  seed_path=self.seed, cache_path=self.cache, now=lambda:1100)
        snapshot.payload()
        self.finish(snapshot)
        result = snapshot.payload(refresh=False)
        self.assertEqual(result["market"]["日経225"]["fetched_at"],1100)
        self.assertEqual(result["market"]["ドル円"]["fetched_at"],990)
        reboot = MarketSnapshot(Mock(), seed_path=self.seed, cache_path=self.cache, now=lambda:1110)
        self.assertEqual(reboot.payload(refresh=False)["market"],result["market"])

    def test_error_keeps_data_and_backoff_avoids_repeat_upstream_requests(self):
        now=[1100]
        loader=Mock(side_effect=RuntimeError("offline"))
        self.store(self.seed,{"日経225":quote()})
        snapshot=MarketSnapshot(loader,seed_path=self.seed,now=lambda:now[0])
        snapshot.payload();self.finish(snapshot)
        for _ in range(5):
            self.assertEqual(snapshot.payload()["market"]["日経225"]["fetched_at"],1000)
        self.assertEqual(loader.call_count,1)
        now[0]=1131
        snapshot.payload();self.finish(snapshot)
        self.assertEqual(loader.call_count,2)

    def test_validation_rejects_future_expired_and_invalid_prices_without_forging_dates(self):
        for value in (float('inf'),float('nan'),-1,0,'42000',True):
            invalid=quote();invalid['price']=value
            self.assertEqual(validated_market({'market':{'日経225':invalid}},1100),{})
        for stamp in (1101,1100-RETAIN,None,'1000',True):
            self.assertEqual(validated_market({'market':{'日経225':quote(stamp=stamp)}},1100),{})
        invalid=quote();invalid['change_value']='420'
        self.assertEqual(validated_market({'market':{'日経225':invalid}},1100),{})
        self.assertEqual(validated_market({'market':{'unexpected':quote()}},1100),{})
        legacy=quote();del legacy['fetched_at']
        self.assertEqual(validated_market({'market':{'日経225':legacy},'fetched_at':1000},1100)['日経225']['fetched_at'],1000)

    def test_newer_saved_values_win_and_returned_data_cannot_mutate_cache(self):
        self.store(self.seed,{'日経225':quote(42000,1050)})
        self.store(self.cache,{'日経225':quote(41000,1000),'ドル円':quote(150,1000)})
        snapshot=MarketSnapshot(Mock(),seed_path=self.seed,cache_path=self.cache,now=lambda:1100)
        first=snapshot.payload(refresh=False)
        self.assertEqual(first['market']['日経225']['price'],42000)
        first['market']['日経225']['price']=1
        self.assertEqual(snapshot.payload(refresh=False)['market']['日経225']['price'],42000)

    def test_empty_cold_start_returns_refreshing_without_fabricated_prices(self):
        entered,release=threading.Event(),threading.Event()
        def load():
            entered.set();release.wait(2)
            return {'market':{}}
        snapshot=MarketSnapshot(load,now=lambda:1100)
        try:
            result=snapshot.payload()
            self.assertEqual(result['market'],{})
            self.assertIsNone(result['fetched_at'])
            self.assertTrue(result['refreshing'])
            self.assertTrue(entered.wait(1))
        finally:
            release.set();self.finish(snapshot)


if __name__ == '__main__':
    unittest.main()

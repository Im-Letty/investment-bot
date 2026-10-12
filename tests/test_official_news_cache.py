"""Offline original-cache contracts; no credentials, provider or live request."""
from copy import deepcopy
from datetime import datetime
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Barrier, Lock, Thread
import unittest
from unittest.mock import Mock, patch

from morning_news_window import JST, MorningNewsPreparer, morning_window
from daily_news_runtime import DailyNewsRuntime
from news_cache import OFFICIAL_NEWS_SOURCES
from official_news_cache import OfficialNewsCache, PREFIX, LEASE_SECONDS, POLL_SECONDS
from website_news import create_source_preparer


def at(day="2026-10-10", hour=12, minute=0, second=0):
    return datetime.fromisoformat(day).replace(hour=hour, minute=minute, second=second,
                                              tzinfo=JST).timestamp()


def article(*, published=None, day=None, body="原文で確認した公式の経済発表です。" * 12,
            url="https://www.mof.go.jp/public_relations/conference/my20261009.html"):
    published = at("2026-10-09") if published is None else published
    return {"source": "財務省", "url": url, "evidence_url": url, "title": "財務大臣の経済に関する発表",
            "body": body, "body_sha256": sha256(body.encode()).hexdigest(),
            "published_at": None if day else published,
            "published_date": day or datetime.fromtimestamp(published, JST).date().isoformat(),
            "publication_precision": "day" if day else "second", "body_verified_at": published}


class Storage:
    def __init__(self):
        self.values, self.reads, self.lists = {}, [], []
        self.guard = Lock()

    def read(self, path, *, deadline=None):
        with self.guard:
            self.reads.append(path)
            return deepcopy(self.values.get(path))

    def create(self, path, value):
        with self.guard:
            if path in self.values:
                return False
            self.values[path] = deepcopy(value)
            return True

    def _list(self, prefix, *, deadline=None, offset=0):
        with self.guard:
            self.lists.append(prefix)
            names = [key[len(prefix) + 1:] for key in self.values if key.startswith(prefix + "/")]
            return [{"name": name} for name in sorted(names, reverse=True)[offset:offset + 30]]

    def ensure_private(self):
        pass

    def recent_days(self):
        return sorted({key.split("/")[1] for key in self.values if key.startswith("days/")}, reverse=True)

    def reviewed_keys(self, day):
        return []


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.now = at()
        self.storage = Storage()
        self.rows = [article()]
        self.collector = Mock(side_effect=self.collect)
        self.network = patch("requests.sessions.Session.request", side_effect=AssertionError("network disabled"))
        self.network.start()
        self.addCleanup(self.network.stop)

    def collect(self, started, **options):
        for source in OFFICIAL_NEWS_SOURCES:
            matched = sum(row["source"] == source for row in self.rows)
            options["diagnostics"][source] = {"feed_status": "ok",
                "status": "collected" if matched else "no_matching_candidates", "errors": [],
                "candidates": matched, "selected": matched, "completed": matched,
                "accepted": matched, "returned": matched}
        return [{**deepcopy(row), "body_verified_at": self.now} for row in self.rows]

    def cache(self, collector=None):
        return OfficialNewsCache(self.storage, collector or self.collector, clock=lambda: self.now)

    def test_all_day_poll_never_creates_generation_claim_or_edition(self):
        cache = self.cache()
        for hour in (0, 6, 12, 23):
            self.now = at(hour=hour)
            cache.collect(self.now)
        self.assertEqual(self.collector.call_count, 4)
        self.assertFalse(any("attempt-" in path or "edition.json" in path for path in self.storage.values))
        self.assertTrue(all(path.startswith(PREFIX + "/") for path in self.storage.values))
        self.assertEqual(self.collector.call_args.kwargs["until"], self.now)
        self.assertEqual(self.collector.call_args.kwargs["since"], at("2026-10-08", 0))

    def test_cross_process_cas_and_restart_do_not_repeat_same_slot(self):
        barrier = Barrier(2)
        def run():
            barrier.wait()
            self.cache().collect(self.now)
        workers = [Thread(target=run) for _ in range(2)]
        for worker in workers: worker.start()
        for worker in workers: worker.join()
        self.cache().collect(self.now)
        self.assertEqual(self.collector.call_count, 1)
        self.now += POLL_SECONDS
        self.cache().collect(self.now)
        self.assertEqual(self.collector.call_count, 2)

    def test_identical_original_has_one_body_version_and_earliest_verification(self):
        cache = self.cache()
        original_time = self.now
        for _ in range(3):
            cache.collect(self.now)
            self.now += POLL_SECONDS
        restored = self.cache().snapshot(self.now)
        for folder in ("bodies", "versions", "identities"):
            self.assertEqual(sum(path.startswith(f"{PREFIX}/{folder}/") for path in self.storage.values), 1)
        self.assertEqual(restored["articles"][0]["body_verified_at"], original_time)
        restored["articles"][0]["body"] = "caller mutation"
        self.assertNotEqual(self.cache().snapshot(self.now)["articles"][0]["body"], "caller mutation")

    def test_canonical_legacy_two_source_poll_is_read_without_inventing_boj_health(self):
        self.rows = []
        self.cache().collect(self.now)
        key = next(path for path in self.storage.values if '/polls/' in path and path.endswith('.json'))
        self.storage.values[key]['source_status'].pop('日本銀行')
        original = deepcopy(self.storage.values[key])
        restored = self.cache()
        snapshot = restored.snapshot(self.now)
        self.assertEqual(snapshot['source_status']['日本銀行']['feed_status'], 'not_completed')
        self.assertEqual(snapshot['source_status']['日本銀行']['status'], 'fetch_incomplete')
        self.assertEqual(snapshot['source_cache_observations']['legacy_two_source_polls'], 1)
        self.assertEqual(self.storage.values[key], original, 'Do not rewrite immutable legacy evidence')
        from intraday_news_runtime import _healthy_snapshot
        self.assertFalse(_healthy_snapshot(snapshot, self.now))
        self.now += POLL_SECONDS
        restored.collect(self.now)
        fresh = restored.snapshot(self.now)
        self.assertTrue(_healthy_snapshot(fresh, self.now))
        self.assertEqual(fresh['source_status']['日本銀行']['feed_status'], 'ok')

    def test_legacy_cache_does_not_break_current_intraday_unpaid_preflight(self):
        from intraday_news_runtime import run_job
        self.rows = []
        self.now = at('2026-10-10')
        self.cache().collect(self.now)
        key = next(path for path in self.storage.values if '/polls/' in path and path.endswith('.json'))
        self.storage.values[key]['source_status'].pop('日本銀行')
        self.now = at('2026-10-12')
        cache = self.cache()
        generator, preflight = Mock(), Mock()
        with TemporaryDirectory() as folder:
            baseline = Path(folder) / 'baseline.json'
            baseline.write_text('[]')
            report = run_job(self.storage, generator, preflight=preflight, cache=cache,
                             clock=lambda: self.now, check_only=True, baseline_path=baseline)
        self.assertEqual(report['status'], 'no_new_release')
        self.assertEqual(report['attempt_count'], 0)
        self.assertEqual(report['published_count'], 0)
        self.assertGreater(cache.safe_observations()['legacy_two_source_polls'], 0)
        generator.assert_not_called()
        preflight.assert_not_called()
        self.assertFalse(any('attempt-' in key for key in self.storage.values))

    def test_legacy_compatibility_does_not_accept_partial_or_corrupt_source_rows(self):
        self.rows = []
        self.cache().collect(self.now)
        key = next(path for path in self.storage.values if '/polls/' in path and path.endswith('.json'))
        original = deepcopy(self.storage.values[key])
        original['source_status'].pop('日本銀行')
        for mutate in (
            lambda rows: rows.pop('財務省'),
            lambda rows: rows.update({'unapproved': {}}),
            lambda rows: rows['財務省'].update(status='unknown'),
            lambda rows: rows['財務省'].update(candidates=-1),
            lambda rows: rows['財務省'].update(extra='unexpected'),
            lambda rows: rows['財務省'].update(errors=['unapproved error string']),
        ):
            with self.subTest(mutation=mutate):
                corrupted = deepcopy(original)
                mutate(corrupted['source_status'])
                self.storage.values[key] = corrupted
                with self.assertRaisesRegex(ValueError, 'invalid_source_cache_poll'):
                    self.cache().snapshot(self.now)

    def test_concurrent_claim_is_validated_at_read_completion_and_is_pending(self):
        requested = self.now = at('2026-10-12', 14, 45, 4)
        prefix = f'{PREFIX}/polls/2026-10-12'
        self.storage.values[prefix + '/59.lock'] = {
            'version': 1, 'day': '2026-10-12', 'slot': 59, 'started_at': requested + 1}
        original_list = self.storage._list
        def concurrent_listing(path, **options):
            if path == prefix:
                self.now = requested + 2
            return original_list(path, **options)
        self.storage._list = concurrent_listing
        cache = self.cache()
        cache.collect(requested)
        self.collector.assert_not_called()
        snapshot = cache.snapshot(self.now)
        self.assertTrue(snapshot['pending'])
        self.assertEqual(snapshot['articles'], [])
        self.assertEqual(snapshot['source_cache_observations']['concurrent_read_records'], 1)
        self.assertFalse(any('attempt-' in key for key in self.storage.values))

    def test_future_claim_relative_to_actual_read_clock_remains_corruption(self):
        requested = self.now = at('2026-10-12', 14, 45, 4)
        prefix = f'{PREFIX}/polls/2026-10-12'
        self.storage.values[prefix + '/59.lock'] = {
            'version': 1, 'day': '2026-10-12', 'slot': 59, 'started_at': requested + 1}
        with self.assertRaisesRegex(ValueError, 'invalid_source_cache_poll'):
            self.cache().collect(requested)
        self.collector.assert_not_called()

    def test_completed_concurrent_poll_does_not_include_newer_facts_as_of_old_clock(self):
        requested = at('2026-10-12', 14, 45, 4)
        self.now = requested + 1
        self.rows = [article(published=at('2026-10-12', 14))]
        self.cache().collect(self.now)
        prefix = f'{PREFIX}/polls/2026-10-12'
        original_list = self.storage._list
        self.now = requested
        def concurrent_listing(path, **options):
            if path == prefix:
                self.now = requested + 2
            return original_list(path, **options)
        self.storage._list = concurrent_listing
        cache = self.cache()
        earlier = cache.snapshot(requested)
        self.assertTrue(earlier['pending'])
        self.assertEqual(earlier['articles'], [])
        self.assertEqual(earlier['source_cache_observations']['concurrent_read_records'], 1)
        current = cache.snapshot(self.now)
        self.assertFalse(current['pending'])
        self.assertEqual(current['articles'][0]['body_verified_at'], requested + 1)

    def test_concurrent_post_cutoff_verification_stays_out_of_frozen_morning(self):
        cutoff = at('2026-10-12', 7, 30)
        self.now = cutoff - 1
        self.rows = [article(published=at('2026-10-11', 12))]
        def finishing_after_cutoff(started, **options):
            self.now = cutoff + 1
            return self.collect(started, **options)
        self.cache(Mock(side_effect=finishing_after_cutoff)).collect(cutoff - 1)
        self.now = cutoff
        original_list = self.storage._list
        prefix = f'{PREFIX}/polls/2026-10-12'
        def concurrent_listing(path, **options):
            if path == prefix:
                self.now = cutoff + 2
            return original_list(path, **options)
        self.storage._list = concurrent_listing
        cache = self.cache()
        snapshot = cache.snapshot(cutoff, through=cutoff)
        self.assertEqual(snapshot['articles'], [])
        self.assertTrue(snapshot['pending'])
        current = cache.snapshot(self.now, through=cutoff)
        self.assertEqual(current['articles'], [])
        self.assertTrue(current['late_verification_pending'])
        self.assertFalse(current['pending'])

    def test_operational_observation_counters_are_bounded_and_safe(self):
        cache = self.cache()
        for slot in range(96):
            cache._observe('concurrent_read_records', '2026-10-10', slot, 'claim')
            cache._observe('concurrent_read_records', '2026-10-10', slot, 'poll')
        result = cache.operational_snapshot()['source_cache_observations']
        self.assertEqual(result['concurrent_read_records'], 128)
        self.assertEqual(set(result), {'legacy_two_source_polls', 'concurrent_read_records'})
        self.assertTrue(all(type(value) is int and 0 <= value <= 128 for value in result.values()))

    def test_revision_is_preserved_and_blocks_normal_morning_selection(self):
        self.now = at("2026-10-09", 14)
        cache = self.cache()
        cache.collect(self.now)
        self.rows = [article(body="公式の訂正を反映した新しい原文です。" * 12)]
        self.now += POLL_SECONDS
        cache.collect(self.now)
        self.now = at(hour=7, minute=30)
        rows = self.cache().snapshot(self.now)["articles"]
        self.assertEqual(len(rows), 2)
        self.assertEqual(sum(bool(row.get("requires_correction_review")) for row in rows), 1)
        manifest = MorningNewsPreparer(self.storage, self.collector, clock=lambda: self.now,
                                       source_cache=self.cache()).prepare(self.now)
        self.assertEqual(manifest["articles"], [])
        self.assertIn("correction_review_required", manifest["source_status"]["preparation"]["errors"])

    def test_reusable_url_on_new_date_is_distinct_without_correction(self):
        cache = self.cache()
        self.now = at("2026-10-09", 14)
        cache.collect(self.now)
        self.now = at(hour=12)
        self.rows = [article(published=self.now)]
        cache.collect(self.now)
        rows = self.cache().snapshot(self.now)["articles"]
        self.assertEqual(len(rows), 2)
        self.assertFalse(any(row.get("requires_correction_review") for row in rows))
        self.assertEqual(sum("/bodies/" in path for path in self.storage.values), 1)

    def test_date_only_precision_stays_unknown_and_survives_next_morning(self):
        self.now = at("2026-10-09", 14)
        self.rows = [article(day="2026-10-09")]
        self.cache().collect(self.now)
        self.now = at(hour=7, minute=30)
        manifest = MorningNewsPreparer(self.storage, self.collector, clock=lambda: self.now,
                                       source_cache=self.cache()).prepare(self.now)
        self.assertEqual(len(manifest["articles"]), 1)
        self.assertIsNone(manifest["articles"][0]["published_at"])
        self.assertEqual(manifest["articles"][0]["selection_route"], "date_only")

    def test_cumulative_index_keeps_original_after_first_30_files_disappear(self):
        self.now = at("2026-10-09", 0)
        self.rows = [article(published=self.now)]
        cache = self.cache()
        cache.collect(self.now)
        self.rows = []
        for _ in range(32):
            self.now += POLL_SECONDS
            cache.collect(self.now)
        self.storage.reads.clear()
        self.storage.lists.clear()
        restored = self.cache().snapshot(self.now)
        self.assertEqual(len(restored["articles"]), 1)
        self.assertEqual(len(self.storage.lists), 3)
        self.assertLessEqual(len(self.storage.reads), 6)

    def test_same_slot_snapshot_uses_cache_and_next_slot_refreshes_today_only(self):
        cache = self.cache()
        cache.collect(self.now)
        cache.snapshot(self.now)
        self.storage.reads.clear()
        self.storage.lists.clear()
        self.now += 60
        cache.snapshot(self.now)
        self.assertEqual(self.storage.reads, [])
        self.assertEqual(self.storage.lists, [])
        self.now += POLL_SECONDS
        cache.snapshot(self.now)
        self.assertEqual(self.storage.lists, [f"{PREFIX}/polls/2026-10-10"])
        self.assertLessEqual(len(self.storage.reads), 2)

    def test_unknown_exception_is_fixed_diagnostics_without_raw_error_or_retry(self):
        self.collector.side_effect = RuntimeError("PRIVATE_RAW_ERROR")
        cache = self.cache()
        cache.collect(self.now)
        cache.collect(self.now)
        self.cache().collect(self.now)
        self.assertEqual(self.collector.call_count, 1)
        self.assertNotIn("PRIVATE_RAW_ERROR", str(self.storage.values))
        self.assertEqual(cache.snapshot(self.now)["articles"], [])
        self.assertTrue(all(row["errors"] == ["source_read_failed"] for row in
                            cache.operational_snapshot()["source_status"].values()))

    def test_unapproved_host_or_boj_and_body_hash_are_not_cached(self):
        for change in ({"url": "https://evil.test/article"}, {"source": "日本銀行"},
                       {"body_sha256": "a" * 64}, {"evidence_url": "https://evil.test/article"},
                       {"url": "https://www.mof.go.jp/news.rss"}):
            with self.subTest(change=change):
                self.storage = Storage()
                self.rows = [{**article(), **change}]
                self.cache().collect(self.now)
                self.assertFalse(any("/bodies/" in path for path in self.storage.values))

    def test_corrupt_body_or_version_missing_fails_closed_without_fetching(self):
        for corrupt in ("body", "version"):
            with self.subTest(corrupt=corrupt):
                self.storage = Storage()
                self.cache().collect(self.now)
                key = next(path for path in self.storage.values if f"/{'bodies' if corrupt == 'body' else 'versions'}/" in path)
                if corrupt == "body": self.storage.values[key]["body"] = "corrupt original"
                else: del self.storage.values[key]
                before = self.collector.call_count
                with self.assertRaisesRegex(ValueError, "invalid_source_cache_(body|version)"):
                    self.cache().snapshot(self.now)
                self.assertEqual(self.collector.call_count, before)

    def test_missing_poll_claim_is_rejected(self):
        self.cache().collect(self.now)
        key = next(path for path in self.storage.values if path.endswith(".lock"))
        del self.storage.values[key]
        with self.assertRaisesRegex(ValueError, "invalid_source_cache_poll"):
            self.cache().snapshot(self.now)

    def test_lost_poll_pending_expires_without_same_slot_retry(self):
        day, slot = "2026-10-10", 48
        path = f"{PREFIX}/polls/{day}/{slot:02d}.lock"
        self.storage.create(path, {"version": 1, "day": day, "slot": slot, "started_at": self.now})
        cache = self.cache()
        cache.collect(self.now)
        self.assertTrue(cache.snapshot(self.now)["pending"])
        self.now += LEASE_SECONDS
        result = cache.snapshot(self.now)
        self.assertFalse(result["pending"])
        self.assertEqual(result["source_status"]["preparation"]["errors"], ["cache_slot_result_missing"])
        self.collector.assert_not_called()

    def test_long_failure_retains_original_and_recovers_in_next_slot_after_restart(self):
        self.cache().collect(self.now)
        for slot in range(49, 79):
            self.now = at(hour=slot // 4, minute=(slot % 4) * 15)
            self.storage.create(f"{PREFIX}/polls/2026-10-10/{slot:02d}.lock",
                {"version": 1, "day": "2026-10-10", "slot": slot, "started_at": self.now})
        self.now += LEASE_SECONDS
        restored = self.cache().snapshot(self.now)
        self.assertEqual(len(restored["articles"]), 1)
        self.assertEqual(restored["source_status"]["preparation"]["errors"],
                         ["cache_slot_result_missing"])
        before = self.collector.call_count
        self.now += POLL_SECONDS
        self.rows = []
        self.cache().collect(self.now)
        self.assertEqual(self.collector.call_count, before + 1)
        restored = self.cache().snapshot(self.now)
        self.assertEqual(len(restored["articles"]), 1)
        self.assertEqual(restored["articles"][0]["body"], article()["body"])
        self.assertNotIn("preparation", restored["source_status"])

    def test_full_day_of_missing_results_recovers_without_same_slot_retry(self):
        self.now = at(hour=0)
        original = self.rows[0]["body"]
        self.cache().collect(self.now)
        for slot in range(1, 95):
            self.now = at(hour=slot // 4, minute=(slot % 4) * 15)
            self.storage.create(f"{PREFIX}/polls/2026-10-10/{slot:02d}.lock",
                {"version": 1, "day": "2026-10-10", "slot": slot, "started_at": self.now})
        self.now += POLL_SECONDS
        self.cache().collect(self.now)
        self.assertEqual(self.collector.call_count, 2)
        self.cache().collect(self.now)
        self.assertEqual(self.collector.call_count, 2)
        self.assertEqual(self.cache().snapshot(self.now)["articles"][0]["body"], original)

    def test_non_paginating_storage_fails_closed_without_duplicate_page_loop(self):
        self.cache().collect(self.now)
        for slot in range(49, 79):
            self.now = at(hour=slot // 4, minute=(slot % 4) * 15)
            self.storage.create(f"{PREFIX}/polls/2026-10-10/{slot:02d}.lock",
                {"version": 1, "day": "2026-10-10", "slot": slot, "started_at": self.now})
        listing = self.storage._list
        self.storage._list = lambda prefix, **options: listing(prefix)
        with self.assertRaisesRegex(ValueError, "invalid_source_cache_index"):
            self.cache().snapshot(self.now)

    def test_distinct_version_window_capacity_is_explicit(self):
        cache = self.cache()
        with patch("official_news_cache.MAX_VERSIONS", 2):
            for number in range(2):
                self.rows = [article(body=(f"原文 {number} の経済発表です。" * 20))]
                cache.collect(self.now)
                self.now += POLL_SECONDS
            self.rows = [article(body="原文 3 の経済発表です。" * 20)]
            with self.assertRaisesRegex(ValueError, "source_cache_capacity"):
                cache.collect(self.now)

    def test_retention_is_three_days_and_process_memory_is_bounded(self):
        cache = self.cache()
        for day in ("2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"):
            self.now = at(day)
            self.rows = [article(published=self.now)]
            cache.collect(self.now)
        self.assertEqual(len(cache.snapshot(self.now)["articles"]), 3)
        self.assertEqual(len(cache._indexes), 3)
        self.assertLessEqual(len(cache._versions), 3)
        # Immutable archive evidence is retained; this module never deletes it.
        self.assertTrue(any("/polls/2026-10-07/" in path for path in self.storage.values))

    def test_safe_operational_metadata_contains_no_original_text_or_urls(self):
        cache = self.cache()
        cache.collect(self.now)
        state = str(cache.operational_snapshot())
        self.assertNotIn(self.rows[0]["body"], state)
        self.assertNotIn(self.rows[0]["url"], state)
        self.assertNotIn("body_sha256", state)

    def test_verification_timestamp_cannot_move_before_origin_claim_or_index(self):
        self.now = at(hour=7, minute=31)
        self.rows = [article(published=at(hour=7, minute=29))]
        self.cache().collect(self.now)
        version_key = next(key for key in self.storage.values if "/versions/" in key)
        identity_key = next(key for key in self.storage.values if "/identities/" in key)
        self.storage.values[version_key]["article"]["body_verified_at"] = at(hour=7, minute=29)
        self.storage.values[identity_key]["first_verified_at"] = at(hour=7, minute=29)
        # The immutable 07:31 poll/index still proves this verification was late.
        snapshot = self.cache().snapshot(self.now, through=at(hour=7, minute=30))
        self.assertEqual(snapshot["articles"], [])
        self.assertFalse(snapshot["pending"])
        with self.assertRaisesRegex(ValueError, "invalid_source_cache_verification"):
            self.cache().snapshot(self.now)

    def test_cold_restore_has_aggregate_clock_deadline(self):
        cache = self.cache()
        for number in range(9):
            self.rows = [article(body=(f"公式原文 {number * 8 + index} の経済結果です。" * 15))
                         for index in range(8)]
            cache.collect(self.now)
            self.now += POLL_SECONDS
        before = self.collector.call_count
        read = self.storage.read
        def slow_read(path, **options):
            self.now += .25
            return read(path)
        self.storage.reads.clear()
        self.storage.read = slow_read
        with self.assertRaisesRegex(ValueError, "source_cache_read_deadline"):
            self.cache().snapshot(self.now)
        self.assertLessEqual(len(self.storage.reads), 48)
        self.assertEqual(self.collector.call_count, before)

    def test_read_deadline_is_passed_to_transport_and_fixed_error_propagates(self):
        from daily_news_runtime import StorageUnavailable
        read = Mock(side_effect=StorageUnavailable("storage_deadline"))
        self.storage.read = read
        self.now = at(hour=12)
        self.storage.create(f"{PREFIX}/polls/2026-10-10/48.lock",
            {"version": 1, "day": "2026-10-10", "slot": 48, "started_at": self.now})
        with self.assertRaisesRegex(ValueError, "source_cache_read_deadline"):
            self.cache().snapshot(self.now)
        self.assertIsInstance(read.call_args.kwargs["deadline"], float)
        self.collector.assert_not_called()

    def test_collect_restoration_shares_read_budget_and_does_not_fetch_on_timeout(self):
        self.cache().collect(self.now)
        read = self.storage.read
        def slow_read(path, **options):
            self.now += 7
            return read(path, **options)
        self.storage.read = slow_read
        self.now += POLL_SECONDS
        with self.assertRaisesRegex(ValueError, "source_cache_read_deadline"):
            self.cache().collect(self.now)
        self.assertEqual(self.collector.call_count, 1)

    def test_factory_is_offline_and_boj_remains_disabled(self):
        with patch("website_news.collect_official_articles", return_value=[]) as collector:
            preparer = create_source_preparer(self.storage, clock=lambda: self.now)
            collector.assert_not_called()
            preparer.collect(self.now)
        self.assertEqual(collector.call_args.kwargs["enabled_sources"], OFFICIAL_NEWS_SOURCES)

    def test_cache_switch_restores_legacy_preparation_without_source_poll(self):
        for value in ("0", "invalid"):
            with self.subTest(value=value), patch.dict("os.environ", {"NEWS_SOURCE_CACHE_ENABLED": value}), \
                    patch("website_news.collect_official_articles") as collector:
                preparer = create_source_preparer(self.storage, clock=lambda: self.now)
                self.assertIsNone(preparer.collect(self.now))
                self.assertIsNone(preparer.source_cache)
                collector.assert_not_called()
        with self.assertRaisesRegex(ValueError, "invalid_source_cache_configuration"):
            create_source_preparer(self.storage, cache_enabled="1")


class FrozenIntegrationTests(unittest.TestCase):
    setUp = CacheTests.setUp
    collect = CacheTests.collect
    cache = CacheTests.cache

    def runtime(self, preparer):
        with TemporaryDirectory() as directory:
            runtime = DailyNewsRuntime(self.storage, None, enabled=True, generation_owner="external",
                source_preparer=preparer, clock=lambda: self.now,
                baseline_path=Path(directory) / "absent.json", cache_path=Path(directory) / "cache.json")
            return runtime.run_once()

    def test_old_healthy_cache_cannot_mask_final_legacy_feed_failure(self):
        self.now = at(hour=7, minute=15)
        self.rows = []
        cache = self.cache()
        cache.collect(self.now)
        self.now = at(hour=7, minute=29)
        failed = Mock(side_effect=RuntimeError("must not escape"))
        preparer = MorningNewsPreparer(self.storage, failed, clock=lambda: self.now, source_cache=cache)
        preparer.prepare(self.now)
        self.now = at(hour=7, minute=30)
        manifest = preparer.prepare(self.now)
        self.assertEqual(manifest["source_status"]["collection"]["feed_status"], "failed")
        self.assertEqual(self.runtime(preparer)["status"], "source_unavailable")

    def test_unchecked_cache_does_not_replace_healthy_final_legacy_poll(self):
        self.now = at(hour=7, minute=29)
        self.rows = []
        preparer = MorningNewsPreparer(self.storage, self.collector, clock=lambda: self.now,
                                       source_cache=self.cache())
        preparer.prepare(self.now)
        self.now = at(hour=7, minute=30)
        manifest = preparer.prepare(self.now)
        self.assertTrue(all(row["feed_status"] == "ok" for row in manifest["source_status"].values()))
        self.assertEqual(self.runtime(preparer)["status"], "source_empty")

    def test_stale_healthy_empty_cache_is_not_proof_of_quiet_cutoff(self):
        self.now = at("2026-10-09", 14)
        self.rows = []
        self.cache().collect(self.now)
        self.now = at(hour=7, minute=30)
        preparer = MorningNewsPreparer(self.storage, self.collector, clock=lambda: self.now,
                                       source_cache=self.cache())
        manifest = preparer.prepare(self.now)
        self.assertIn("near_cutoff_check_missing", manifest["source_status"]["preparation"]["errors"])
        self.assertEqual(self.runtime(preparer)["status"], "source_unavailable")

    def test_new_0730_cache_claim_does_not_delay_final_legacy_freeze(self):
        self.now = at(hour=7, minute=29)
        preparer = MorningNewsPreparer(self.storage, self.collector, clock=lambda: self.now,
                                       source_cache=self.cache())
        preparer.prepare(self.now)
        self.now = at(hour=7, minute=30)
        self.storage.create(f"{PREFIX}/polls/2026-10-10/30.lock",
            {"version": 1, "day": "2026-10-10", "slot": 30, "started_at": self.now})
        manifest = preparer.prepare(self.now)
        self.assertIsNotNone(manifest)
        self.assertEqual(len(manifest["articles"]), 1)

    def test_post_cutoff_revision_cannot_change_original_frozen_version(self):
        self.now = at("2026-10-09", 14)
        original = self.rows[0]["body"]
        self.cache().collect(self.now)
        self.now = at(hour=7, minute=31)
        self.rows = [article(body="締切後に訂正された公式原文です。" * 20)]
        self.cache().collect(self.now)
        preparer = MorningNewsPreparer(self.storage, self.collector, clock=lambda: self.now,
                                       source_cache=self.cache())
        manifest = preparer.prepare(self.now)
        self.assertEqual(len(manifest["articles"]), 1)
        self.assertEqual(manifest["articles"][0]["body"], original)

    def test_cache_restore_deadline_preserves_completed_legacy_original(self):
        self.now = at(hour=7, minute=29)
        cache = self.cache()
        preparer = MorningNewsPreparer(self.storage, self.collector, clock=lambda: self.now, source_cache=cache)
        preparer.prepare(self.now)
        self.now = at(hour=7, minute=30)
        with patch.object(cache, "snapshot", side_effect=ValueError("source_cache_read_deadline")):
            manifest = preparer.prepare(self.now)
        self.assertEqual(len(manifest["articles"]), 1)
        self.assertEqual(manifest["source_status"]["財務省"]["feed_status"], "ok")
        self.assertIn("source_cache_read_deadline", manifest["source_status"]["preparation"]["errors"])

    def test_prior_afternoon_cache_is_available_even_after_morning_late_start(self):
        self.now = at("2026-10-09", 14)
        self.cache().collect(self.now)
        self.now = at(hour=9)
        collector = Mock(side_effect=AssertionError("no post-cutoff original fetch"))
        preparer = MorningNewsPreparer(self.storage, collector, clock=lambda: self.now, source_cache=self.cache())
        frozen = preparer.prepare(self.now)
        self.assertEqual(len(frozen["articles"]), 1)
        collector.assert_not_called()
        self.rows = [article(body="後から公開された改訂本文です。" * 20)]
        self.now = at(hour=12)
        preparer.collect(self.now)
        self.assertEqual(preparer.prepare(self.now), frozen)

    def test_legacy_0729_final_poll_catches_announcement_after_0715_cache(self):
        self.now = at(hour=7, minute=15)
        self.rows = []
        cache = self.cache()
        cache.collect(self.now)
        self.now = at(hour=7, minute=29)
        self.rows = [article(published=at(hour=7, minute=25))]
        preparer = MorningNewsPreparer(self.storage, self.collector, clock=lambda: self.now, source_cache=cache)
        self.assertIsNone(preparer.prepare(self.now))
        self.now = at(hour=7, minute=30)
        frozen = preparer.prepare(self.now)
        self.assertEqual(len(frozen["articles"]), 1)
        self.assertEqual(frozen["articles"][0]["published_at"], at(hour=7, minute=25))
        self.assertEqual(self.collector.call_count, 2)

    def test_cache_post_cutoff_verification_defers_to_next_morning_only(self):
        self.rows = [article(published=at(hour=7, minute=29))]
        self.now = at(hour=7, minute=30, second=1)
        self.cache().collect(self.now)
        preparer = MorningNewsPreparer(self.storage, self.collector, clock=lambda: self.now, source_cache=self.cache())
        self.assertEqual(preparer.prepare(self.now)["articles"], [])
        self.now = at("2026-10-11", 7, 30)
        next_preparer = MorningNewsPreparer(self.storage, self.collector, clock=lambda: self.now, source_cache=self.cache())
        row = next_preparer.prepare(self.now)["articles"][0]
        self.assertEqual(row["selection_route"], "deferred")
        self.assertEqual(row["deferred_reason"], "late_verification")

    def test_cache_poll_crossing_cutoff_is_unavailable_not_empty_and_defers_original(self):
        self.now = at(hour=7, minute=29)
        self.rows = [article(published=at(hour=7, minute=28))]
        def slow_collection(started, **options):
            self.now = at(hour=7, minute=31)
            return self.collect(started, **options)
        self.cache(Mock(side_effect=slow_collection)).collect(self.now)
        preparer = MorningNewsPreparer(self.storage, self.collector, clock=lambda: self.now,
                                       source_cache=self.cache())
        manifest = preparer.prepare(self.now)
        self.assertEqual(manifest["articles"], [])
        self.assertIn("late_verification_pending", manifest["source_status"]["preparation"]["errors"])
        self.assertEqual(self.runtime(preparer)["status"], "source_unavailable")
        self.now = at("2026-10-11", 7, 30)
        tomorrow = MorningNewsPreparer(self.storage, self.collector, clock=lambda: self.now,
                                      source_cache=self.cache()).prepare(self.now)
        self.assertEqual(tomorrow["articles"][0]["selection_route"], "deferred")

    def test_cutoff_crossing_cached_check_is_not_hidden_by_healthy_empty_legacy_poll(self):
        self.now = at(hour=7, minute=29)
        self.rows = []
        preparer = MorningNewsPreparer(self.storage, self.collector, clock=lambda: self.now,
                                       source_cache=self.cache())
        preparer.prepare(self.now)
        self.now += 1
        self.rows = [article(published=at(hour=7, minute=28))]
        def slow_collection(started, **options):
            self.now = at(hour=7, minute=31)
            return self.collect(started, **options)
        self.cache(Mock(side_effect=slow_collection)).collect(self.now)
        self.assertEqual(self.runtime(preparer)["status"], "source_unavailable")

    def test_many_post_cutoff_polls_do_not_hide_pre_cutoff_health_or_original(self):
        self.now = at(hour=7, minute=29)
        self.cache().collect(self.now)
        self.rows = []
        for slot in range(30, 65):
            self.now = at(hour=slot // 4, minute=(slot % 4) * 15)
            self.cache().collect(self.now)
        restored = self.cache().snapshot(self.now, through=at(hour=7, minute=30))
        self.assertEqual(len(restored["articles"]), 1)
        self.assertEqual(restored["last_checked_at"], at(hour=7, minute=29))
        self.assertFalse(restored["pending"])


class CacheRuntimeTests(unittest.TestCase):
    setUp = CacheTests.setUp
    collect = CacheTests.collect
    cache = CacheTests.cache

    def test_published_edition_is_installed_before_all_day_unpaid_collection(self):
        from tests.test_daily_news_runtime import issue
        self.now = at(hour=12)
        self.storage.create("days/2026-10-10/edition.json", issue("2026-10-10"))
        generator = Mock(side_effect=AssertionError("paid writer must not run"))
        with TemporaryDirectory() as folder:
            preparer = MorningNewsPreparer(self.storage, self.collector, clock=lambda: self.now,
                                           source_cache=self.cache())
            runtime = DailyNewsRuntime(self.storage, generator, enabled=True, generation_owner="external",
                source_preparer=preparer, clock=lambda: self.now,
                baseline_path=Path(folder) / "absent.json", cache_path=Path(folder) / "reviewed.json")
            original = self.collector.side_effect
            def collect_after_install(*args, **kwargs):
                self.assertEqual(runtime.reviewed_digests()[-1]["edition_date"], "2026-10-10")
                return original(*args, **kwargs)
            self.collector.side_effect = collect_after_install
            for hour in (12, 18, 23):
                self.now = at(hour=hour)
                self.assertEqual(runtime.run_once()["status"], "ready")
            self.assertEqual(self.collector.call_count, 3)
            generator.assert_not_called()
            self.assertFalse(any("attempt-" in key for key in self.storage.values))

    def test_all_day_unpaid_collection_without_edition_never_creates_paid_claim(self):
        self.rows = []
        generator = Mock(side_effect=AssertionError("paid writer must not run"))
        with TemporaryDirectory() as folder:
            preparer = MorningNewsPreparer(self.storage, self.collector, clock=lambda: self.now,
                                           source_cache=self.cache())
            runtime = DailyNewsRuntime(self.storage, generator, enabled=True, generation_owner="external",
                source_preparer=preparer, clock=lambda: self.now,
                baseline_path=Path(folder) / "absent.json", cache_path=Path(folder) / "reviewed.json")
            self.now = at(hour=0)
            runtime.run_once()
            self.now = at(hour=6)
            runtime.run_once()
            self.now = at(hour=23)
            runtime.run_once()
            self.assertEqual(self.collector.call_count, 3)
            generator.assert_not_called()
            self.assertFalse(any("attempt-" in key or "edition.json" in key for key in self.storage.values))

    def test_poll_failure_preserves_reviewed_publication_and_has_fixed_diagnostics(self):
        from tests.test_daily_news_runtime import issue
        self.storage.create("days/2026-10-10/edition.json", issue("2026-10-10"))
        preparer = Mock()
        preparer.collect.side_effect = RuntimeError("private raw response fixture")
        with TemporaryDirectory() as folder:
            runtime = DailyNewsRuntime(self.storage, None, enabled=True, generation_owner="external",
                source_preparer=preparer, clock=lambda: self.now,
                baseline_path=Path(folder) / "absent.json", cache_path=Path(folder) / "reviewed.json")
            result = runtime.run_once()
            self.assertEqual(result["status"], "ready")
            self.assertEqual(result["source_cache"]["status"], "unavailable")
            self.assertNotIn("private raw", str(result))
            self.assertEqual(runtime.reviewed_digests()[-1]["edition_date"], "2026-10-10")

    def test_disabled_runtime_does_not_start_free_collection(self):
        preparer = Mock()
        with TemporaryDirectory() as folder:
            runtime = DailyNewsRuntime(self.storage, None, enabled=False, generation_owner="external",
                source_preparer=preparer, clock=lambda: self.now,
                baseline_path=Path(folder) / "absent.json", cache_path=Path(folder) / "reviewed.json")
            self.assertEqual(runtime.run_once()["status"], "disabled")
            preparer.collect.assert_not_called()

    def test_frozen_preparer_without_collect_remains_supported(self):
        from scripts.run_private_news_job import FrozenSources
        self.now = at(hour=7, minute=30)
        window = morning_window(self.now)
        frozen = FrozenSources({**window, "articles": [], "source_status": {
            source: {"feed_status": "ok", "status": "no_matching_candidates"}
            for source in OFFICIAL_NEWS_SOURCES}}, window)
        self.assertEqual(FrozenIntegrationTests.runtime(self, frozen)["status"], "source_empty")


if __name__ == "__main__":
    unittest.main()

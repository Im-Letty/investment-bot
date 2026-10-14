"""Late acquisition uses real timestamps and never invokes paid providers."""
from copy import deepcopy
import builtins
from datetime import datetime
from hashlib import sha256
import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from daily_news_producer import GenerationError, _official_articles, _source_window, build_issue
from daily_news_runtime import DailyNewsRuntime, StorageUnavailable
from morning_news_window import (JST, MorningNewsPreparer, manifest_window, morning_window,
    read_prepared_manifest, recovery_window, select_articles, healthy_empty_manifest)
from news_cache import _official_window, _validated_digest, OFFICIAL_NEWS_SOURCES
from scripts.check_daily_news import valid_official_delivery
from scripts.prepare_private_news_sources import run_once, _budget


def at(hour=9, minute=0, second=0, day="2026-10-12"):
    return datetime.fromisoformat(day).replace(hour=hour, minute=minute, second=second, tzinfo=JST).timestamp()


def article(*, verified=None, precision="day", published=None, body=None):
    body = body or "確認した架空の公式発表の本文です。" * 20
    url = "https://www.mof.go.jp/policy/tax_policy/tax_reform/example.html"
    return {"source": "財務省", "url": url, "evidence_url": url, "title": "架空の公式発表",
            "published_date": "2026-10-11", "publication_precision": precision,
            "published_at": None if precision == "day" else (published or at(12, day="2026-10-11")),
            "body": body, "body_sha256": sha256(body.encode()).hexdigest(),
            "body_verified_at": at() if verified is None else verified}


def diagnostics(target, collected=True):
    target.update({source: {"feed_status": "ok", "status": "collected" if collected else "no_matching_candidates"}
                   for source in OFFICIAL_NEWS_SOURCES})


class Storage:
    def __init__(self):
        self.values = {}
        self.phases = []
    def read(self, key):
        return deepcopy(self.values.get(key))
    def create(self, key, value):
        if key in self.values:
            return False
        self.values[key] = deepcopy(value)
        return True
    def reviewed_keys(self, day):
        return [key for key in self.values if key.startswith(f"days/{day}/reviewed-")]
    def recent_days(self):
        return sorted({key.split('/')[1] for key in self.values if key.startswith('days/')}, reverse=True)
    def ensure_private(self):
        pass
    def check_private(self):
        pass
    def set_phase_deadline(self, value, *, phase):
        self.phases.append((value, phase))


class RecoveryProtocolTests(unittest.TestCase):
    def setUp(self):
        self.now = at()
        self.storage = Storage()
        def collect(now, *, since, until, diagnostics):
            globals()["diagnostics"](diagnostics)
            return [article(verified=self.now)]
        self.collector = Mock(side_effect=collect)
        self.preparer = MorningNewsPreparer(self.storage, self.collector, clock=lambda: self.now)

    def test_late_acquisition_preserves_window_and_real_verification(self):
        frozen = self.preparer.prepare_recovery(self.now)
        window = manifest_window(frozen, self.now)
        self.assertEqual(window["version"], 3)
        self.assertEqual(window["kind"], "morning")
        self.assertEqual(window["cutoff_at"], at(7, 30))
        self.assertEqual(window["snapshot_at"], at())
        self.assertEqual(frozen["articles"][0]["body_verified_at"], at())
        self.assertIsNone(frozen["articles"][0]["published_at"])
        self.assertEqual(frozen["articles"][0]["published_date"], "2026-10-11")
        self.assertEqual(self.collector.call_args.kwargs["until"], at(7, 30))
        self.assertFalse(any("attempt-" in key for key in self.storage.values))
        self.now += 100
        self.assertEqual(self.preparer.prepare_recovery(self.now), frozen)
        self.assertEqual(self.collector.call_count, 1)

    def test_backup_guard_can_validate_empty_recovery_before_dependencies_install(self):
        path = Path(__file__).resolve().parents[1] / "morning_news_window.py"
        spec = importlib.util.spec_from_file_location("stdlib_morning_fixture", path)
        standalone = importlib.util.module_from_spec(spec)
        real_import = builtins.__import__
        def only_stdlib(name, *args, **kwargs):
            if name in ("news_cache", "feedparser"):
                raise AssertionError("pre-install guard imported application dependencies")
            return real_import(name, *args, **kwargs)
        status = {source: {"feed_status": "ok", "status": "no_matching_candidates", "errors": []}
                  for source in ("財務省", "総務省統計局", "日本銀行", "金融庁")}
        with patch("builtins.__import__", side_effect=only_stdlib):
            spec.loader.exec_module(standalone)
            window = standalone.recovery_window(self.now)
            manifest = {**window, "articles": [], "source_status": status}
            standalone.MorningNewsPreparer._validate_manifest(manifest, window)
            self.assertTrue(standalone.healthy_empty_manifest(manifest))
            incomplete = {**manifest, "source_status": {
                source: row for source, row in status.items() if source != "金融庁"}}
            with self.assertRaises(ValueError):
                standalone.MorningNewsPreparer._validate_manifest(incomplete, window)
            manifest["source_status"]["日本銀行"]["errors"] = ["source_time_limit"]
            with self.assertRaises(ValueError):
                standalone.MorningNewsPreparer._validate_manifest(manifest, window)

    def test_post_cutoff_publication_is_not_added_to_late_morning(self):
        row = article(precision="second", published=at(8), verified=at(9))
        row["published_date"] = "2026-10-12"
        self.assertEqual(select_articles([row], recovery_window(at(9))), [])
        row["published_at"] = at(7, 30)
        self.assertEqual(len(select_articles([row], recovery_window(at(9)))), 1)

    def test_intraday_consumed_original_is_deduplicated_at_actual_snapshot(self):
        row = article()
        issue = {"publication_mode": "curated", "publish_at": at(8, 45), "article_refs": [row]}
        frozen = self.preparer.prepare_recovery(self.now, [issue])
        self.assertEqual(frozen["articles"], [])
        self.assertEqual(frozen["source_status"]["財務省"]["feed_status"], "ok")

    def test_version_one_rejects_late_verification_but_v3_accepts(self):
        row = article()
        self.assertEqual(select_articles([row], morning_window(at())), [])
        self.assertEqual(len(select_articles([row], recovery_window(at()))), 1)
        window = recovery_window(at())
        row["selection_route"] = "date_only"
        self.assertEqual(_official_articles([row], window, at()), [row])
        with self.assertRaises(GenerationError):
            _official_articles([row], morning_window(at()), at())

    def test_invalid_window_snapshot_bounds_fail_closed(self):
        window = recovery_window(self.now)
        for change in ({"snapshot_at": at(7, 29)}, {"snapshot_at": at(day="2026-10-13")},
                       {"kind": "intraday"}, {"snapshot_at": True}, {"cutoff_at": at(8)},
                       {"snapshot_at": float("nan")}, {"version": True}, {"extra": "untrusted"}):
            mutated = {**window, **change}
            with self.subTest(change=change):
                with self.assertRaises(GenerationError):
                    _source_window(mutated, self.now)
                self.assertIsNone(_official_window(mutated, "2026-10-12"))
        with self.assertRaises(GenerationError):
            _source_window(window, self.now - 1)
        with self.assertRaises(GenerationError):
            _source_window(window, at(day="2026-10-13"))

    def test_new_body_revision_cannot_be_silently_recovered(self):
        self.preparer._remember_identity(article(verified=at(7)), at(7))
        self.collector.side_effect = lambda now, **kw: (diagnostics(kw["diagnostics"])
            or [article(body="修正された架空の本文です。" * 30)])
        with self.assertRaisesRegex(ValueError, "source_unavailable"):
            self.preparer.prepare_recovery(self.now)
        self.assertNotIn("days/2026-10-12/preparation/recovery-v3.json", self.storage.values)

    def test_empty_unavailable_is_not_frozen_or_treated_as_zero_news(self):
        self.collector.side_effect = lambda *args, **kw: []
        with self.assertRaisesRegex(ValueError, "source_unavailable"):
            self.preparer.prepare_recovery(self.now)
        self.assertNotIn("days/2026-10-12/preparation/recovery-v3.json", self.storage.values)
        self.assertEqual(self.storage.values["days/2026-10-12/preparation/recovery-v3-1.result.json"]["status"], "source_unavailable")

    def test_healthy_feed_status_cannot_mask_collection_errors_as_empty_news(self):
        def errored(now, **kw):
            diagnostics(kw["diagnostics"], False)
            kw["diagnostics"]["財務省"]["errors"] = ["source_time_limit"]
            return []
        self.collector.side_effect = errored
        status = {}
        errored(self.now, diagnostics=status)
        self.assertFalse(healthy_empty_manifest({"articles": [], "source_status": status}))
        with self.assertRaisesRegex(ValueError, "source_unavailable"):
            self.preparer.prepare_recovery(self.now)
        self.assertNotIn("days/2026-10-12/preparation/recovery-v3.json", self.storage.values)
        invalid = {**recovery_window(self.now), "articles": [], "source_status": status}
        self.storage.values["days/2026-10-12/preparation/recovery-v3.json"] = invalid
        with self.assertRaises(ValueError):
            read_prepared_manifest(self.storage, self.now)

    def test_fresh_complete_check_supersedes_expired_unpaid_slot(self):
        self.storage.values["days/2026-10-12/preparation/slot-6.lock"] = {
            "edition_date": "2026-10-12", "slot": 6, "started_at": at(7, 29)}
        def empty(now, **kw):
            diagnostics(kw["diagnostics"], False)
            return []
        self.collector.side_effect = empty
        frozen = self.preparer.prepare_recovery(self.now)
        self.assertTrue(healthy_empty_manifest(frozen))
        self.assertEqual(frozen["snapshot_at"], self.now)

    def test_lost_unpaid_lease_can_recover_without_resetting_paid_claim(self):
        prefix = "days/2026-10-12/preparation"
        self.storage.values[prefix + "/recovery-v3-1.lock"] = {"edition_date": "2026-10-12", "attempt": 1, "started_at": at(8)}
        paid = {"edition_date": "2026-10-12", "attempt": 1, "started_at": at(8, 20)}
        self.storage.values["days/2026-10-12/attempt-1.lock"] = paid
        result = self.preparer.prepare_recovery(self.now)
        self.assertEqual(result["version"], 3)
        self.assertEqual(self.storage.values["days/2026-10-12/attempt-1.lock"], paid)
        self.assertIn(prefix + "/recovery-v3-2.lock", self.storage.values)

    def test_failed_ambiguous_write_never_returns_an_unstored_snapshot(self):
        real_create = self.storage.create
        def create(path, value):
            if path.endswith("recovery-v3.json"):
                raise StorageUnavailable("storage_write")
            return real_create(path, value)
        self.storage.create = create
        with self.assertRaises(StorageUnavailable):
            self.preparer.prepare_recovery(self.now)
        self.assertFalse(any("attempt-" in key for key in self.storage.values))

    def test_v1_is_not_overwritten_and_recovery_is_preferred(self):
        old = {**morning_window(self.now), "articles": [], "source_status": {"collection": {"status": "not_prepared"}}}
        path = "days/2026-10-12/preparation/manifest.json"
        self.storage.values[path] = deepcopy(old)
        recovered = self.preparer.prepare_recovery(self.now)
        self.assertEqual(self.storage.values[path], old)
        self.assertEqual(read_prepared_manifest(self.storage, self.now), recovered)
        recovered["snapshot_at"] = at(day="2026-10-13")
        self.storage.values["days/2026-10-12/preparation/recovery-v3.json"] = recovered
        with self.assertRaises(ValueError):
            read_prepared_manifest(self.storage, self.now)
        malformed = {**recovery_window(self.now), "articles": [], "source_status": {}}
        self.storage.values["days/2026-10-12/preparation/recovery-v3.json"] = malformed
        with self.assertRaises(ValueError):
            read_prepared_manifest(self.storage, self.now)

    def test_external_recovery_supersedes_same_process_cached_unhealthy_v1(self):
        old = self.preparer.prepare(self.now)
        self.assertEqual(old["version"], 1)
        self.assertEqual(old["articles"], [])
        self.assertIn("collection", old["source_status"])
        def empty(now, **kw):
            diagnostics(kw["diagnostics"], False)
            return []
        external = MorningNewsPreparer(self.storage, empty, clock=lambda: self.now)
        new = external.prepare_recovery(self.now)
        self.assertEqual(new["version"], 3)
        observed = self.preparer.prepare(self.now)
        self.assertEqual(observed, new)
        self.collector.assert_not_called()
        self.assertEqual(set(observed["source_status"]), set(OFFICIAL_NEWS_SOURCES))
        self.storage.values["days/2026-10-12/preparation/recovery-v3.json"]["snapshot_at"] = self.now + 1
        with self.assertRaises(ValueError):
            self.preparer.prepare(self.now)

    def test_external_runtime_observes_healthy_three_source_recovery_without_ai(self):
        generator = Mock()
        with TemporaryDirectory() as folder:
            baseline = Path(folder) / "baseline.json"
            baseline.write_text("[]", encoding="utf-8")
            runtime = DailyNewsRuntime(self.storage, generator, enabled=True, generation_owner="external",
                source_preparer=self.preparer, clock=lambda: self.now, baseline_path=baseline,
                cache_path=Path(folder) / "cache.json")
            self.assertEqual(runtime.run_once()["status"], "source_unavailable")
            def empty(now, **kw):
                diagnostics(kw["diagnostics"], False)
                return []
            external = MorningNewsPreparer(self.storage, empty, clock=lambda: self.now)
            external.prepare_recovery(self.now)
            state = runtime.run_once()
            self.assertEqual(state["status"], "source_empty")
            self.assertEqual(state["attempt_count"], 0)
            generator.assert_not_called()

    def test_review_and_publication_use_actual_late_time(self):
        manifest = self.preparer.prepare_recovery(self.now)
        window = manifest_window(manifest, self.now)
        draft = {"headline": "確認した発表", "summary": "全体をまとめた短い説明です。",
                 "articles": [{"index": 0, "headline": "発表の内容", "summary": "詳細の確認できた事実です。"}]}
        now = self.now + 60
        issue = build_issue(draft, manifest["articles"], now, source_window=window, copy_length_policy="flexible-v1")
        self.assertEqual(issue["reviewed_at"], now)
        self.assertEqual(issue["publish_at"], now)
        self.assertEqual(_validated_digest(issue), issue)
        delivery = {"digest": issue, "news": deepcopy(issue["article_refs"])}
        self.assertTrue(valid_official_delivery(delivery, datetime.fromtimestamp(now, JST)))
        early = {**issue, "reviewed_at": window["snapshot_at"] - 1}
        self.assertIsNone(_validated_digest(early))

    def test_next_day_deferred_considers_recovery_snapshot(self):
        row = article(precision="second", published=at(12, day="2026-10-10"))
        row["published_date"] = "2026-10-10"
        row["body_verified_at"] = at(9, day="2026-10-11")
        previous = recovery_window(at(9, day="2026-10-11"))
        row["selection_route"] = "main"
        self.storage.values["days/2026-10-11/preparation/recovery-v3.json"] = {
            **previous, "articles": [row], "source_status": {}}
        self.storage.values["days/2026-10-11/attempt-1.lock"] = {"edition_date": "2026-10-11", "attempt": 1, "started_at": at(9, day="2026-10-11")}
        self.storage.values["days/2026-10-11/attempt-1.result.json"] = {"edition_date": "2026-10-11", "attempt": 1, "started_at": at(9, day="2026-10-11"), "status": "generation_failed"}
        self.collector.side_effect = lambda now, **kw: (diagnostics(kw["diagnostics"], False) or [])
        recovered = self.preparer.prepare_recovery(self.now)
        self.assertEqual(recovered["articles"][0]["selection_route"], "deferred")
        self.assertEqual(recovered["articles"][0]["deferred_from"], "2026-10-11")
        self.assertEqual(recovered["articles"][0]["body_verified_at"], at(9, day="2026-10-11"))

    def test_pending_unpaid_collector_and_collection_limit_do_not_start_more_work(self):
        prefix = "days/2026-10-12/preparation"
        self.storage.values[prefix + "/recovery-v3-1.lock"] = {
            "edition_date": "2026-10-12", "attempt": 1, "started_at": self.now - 1}
        self.assertIsNone(self.preparer.prepare_recovery(self.now))
        self.collector.assert_not_called()
        for number in range(1, 4):
            self.storage.values[prefix + f"/recovery-v3-{number}.lock"] = {
                "edition_date": "2026-10-12", "attempt": number, "started_at": self.now - 301}
        with self.assertRaisesRegex(ValueError, "source_collection_limit"):
            self.preparer.prepare_recovery(self.now)
        self.collector.assert_not_called()

    def test_new_collection_cannot_start_after_23_or_fake_a_future_verification(self):
        with self.assertRaisesRegex(ValueError, "outside_morning_window"):
            self.preparer.prepare_recovery(at(23))
        self.collector.assert_not_called()
        self.collector.side_effect = lambda now, **kw: (diagnostics(kw["diagnostics"])
            or [article(verified=self.now + 1)])
        with self.assertRaisesRegex(ValueError, "source_unavailable"):
            self.preparer.prepare_recovery(self.now)

    def test_recovery_freeze_and_review_can_finish_after_23_without_crossing_date(self):
        self.now = at(22, 59, 59)
        def collect(now, **kw):
            self.now = at(23, 0, 10)
            diagnostics(kw["diagnostics"])
            return [article(verified=self.now)]
        self.collector.side_effect = collect
        frozen = self.preparer.prepare_recovery(self.now)
        self.assertEqual(frozen["snapshot_at"], at(23, 0, 10))
        self.assertEqual(manifest_window(frozen, self.now)["edition_date"], "2026-10-12")

    def test_collection_expiry_does_not_freeze_or_backdate_a_snapshot(self):
        def collect(now, **kw):
            self.now += 301
            diagnostics(kw["diagnostics"])
            return [article(verified=self.now)]
        self.collector.side_effect = collect
        with self.assertRaisesRegex(ValueError, "source_preparation_deadline"):
            self.preparer.prepare_recovery(self.now)
        self.assertNotIn("days/2026-10-12/preparation/recovery-v3.json", self.storage.values)


class SourceCliTests(unittest.TestCase):
    def test_late_cli_finishes_preparation_without_any_ai_claim(self):
        storage = Storage()
        factory = Mock(return_value=storage)
        def collect(now, **kw):
            diagnostics(kw["diagnostics"])
            return [article()]
        with patch("scripts.prepare_private_news_sources.load_reviewed_digests", return_value=[]):
            result = run_once(environ={"SUPABASE_URL": "https://example.supabase.co", "SUPABASE_KEY": "not-a-real-key"},
                              wall_clock=lambda: at(), monotonic=lambda: 10, storage_factory=factory, collector=collect)
        self.assertTrue(result["success"])
        self.assertEqual(result["status"], "prepared")
        self.assertEqual(result["source_window"]["snapshot_at"], at())
        self.assertEqual(result["source_article_count"], 1)
        self.assertEqual(result["ai_attempt_count"], 0)
        self.assertEqual(result["published_count"], 0)
        self.assertNotIn(article()["body"], repr(result))
        self.assertNotIn(article()["title"], repr(result))
        self.assertNotIn("not-a-real-key", repr(result))
        self.assertFalse(any("attempt-" in key for key in storage.values))
        self.assertEqual(factory.call_args.kwargs["deadline"], 310)

    def test_start_and_midnight_budget_guards(self):
        self.assertIsNone(_budget(at(6)))
        self.assertIsNone(_budget(at(23)))
        self.assertEqual(_budget(at(7)), 35 * 60)
        self.assertEqual(_budget(at(9)), 5 * 60)
        self.assertEqual(_budget(at(22, 59)), 5 * 60)

    def test_configuration_failure_performs_no_collection_or_storage(self):
        factory, collector = Mock(), Mock()
        result = run_once(environ={}, wall_clock=lambda: at(), storage_factory=factory, collector=collector)
        self.assertEqual(result["status"], "configuration_unavailable")
        factory.assert_not_called()
        collector.assert_not_called()

    def test_collection_errors_are_not_a_successful_empty_cli_result(self):
        storage = Storage()
        def errored(now, **kw):
            diagnostics(kw["diagnostics"], False)
            kw["diagnostics"]["財務省"]["errors"] = ["source_time_limit"]
            return []
        with patch("scripts.prepare_private_news_sources.load_reviewed_digests", return_value=[]):
            result = run_once(environ={"SUPABASE_URL": "https://example.supabase.co", "SUPABASE_KEY": "not-a-real-key"},
                wall_clock=lambda: at(), monotonic=lambda: 1,
                storage_factory=lambda *args, **kw: storage, collector=errored)
        self.assertEqual(result["status"], "source_unavailable")
        self.assertFalse(result["success"])
        self.assertEqual(result["ai_attempt_count"], 0)
        self.assertNotIn("days/2026-10-12/preparation/recovery-v3.json", storage.values)

    def test_collection_spilling_past_0730_recovers_using_actual_verification(self):
        storage = Storage()
        clock = {"wall": at(7, 29, 59), "mono": 1}
        calls = []
        def advance(seconds):
            clock["wall"] += seconds
            clock["mono"] += seconds
        def collect(now, **kw):
            advance(2)
            diagnostics(kw["diagnostics"])
            calls.append(clock["wall"])
            return [article(verified=clock["wall"])]
        with patch("scripts.prepare_private_news_sources.load_reviewed_digests", return_value=[]):
            result = run_once(environ={"SUPABASE_URL": "https://example.supabase.co", "SUPABASE_KEY": "not-a-real-key"},
                wall_clock=lambda: clock["wall"], monotonic=lambda: clock["mono"], sleep=advance,
                storage_factory=lambda *args, **kw: storage, collector=collect)
        self.assertTrue(result["success"])
        self.assertEqual(result["source_window"]["version"], 3)
        self.assertGreater(result["source_window"]["snapshot_at"], at(7, 30))
        frozen = storage.values["days/2026-10-12/preparation/recovery-v3.json"]
        self.assertEqual(frozen["articles"][0]["body_verified_at"], calls[0])
        self.assertGreater(calls[0], at(7, 30))

    def test_pending_lease_wait_has_finite_operation_budget(self):
        storage = Storage()
        clock = {"wall": at(), "mono": 1}
        storage.values["days/2026-10-12/preparation/recovery-v3-1.lock"] = {
            "edition_date": "2026-10-12", "attempt": 1, "started_at": clock["wall"]}
        def advance(seconds):
            clock["wall"] += seconds
            clock["mono"] += seconds
        collector = Mock()
        with patch("scripts.prepare_private_news_sources.load_reviewed_digests", return_value=[]):
            result = run_once(environ={"SUPABASE_URL": "https://example.supabase.co", "SUPABASE_KEY": "not-a-real-key"},
                wall_clock=lambda: clock["wall"], monotonic=lambda: clock["mono"], sleep=advance,
                storage_factory=lambda *args, **kw: storage, collector=collector)
        self.assertEqual(result["status"], "source_preparation_deadline")
        self.assertEqual(clock["mono"], 301)
        collector.assert_not_called()


if __name__ == "__main__":
    unittest.main()

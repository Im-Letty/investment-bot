"""Only fake clocks, memory storage and collectors; never uses network or keys."""
from copy import deepcopy
from datetime import datetime
from hashlib import sha256
from threading import Lock
import unittest
from unittest.mock import Mock

from morning_news_window import (JST, COLLECTION_LEASE_SECONDS, MorningNewsPreparer,
                                 morning_window, select_articles)


def at(day="2026-10-06", hour=7, minute=30, second=0):
    return datetime.fromisoformat(day).replace(hour=hour, minute=minute, second=second, tzinfo=JST).timestamp()


def article(url="https://www.mof.go.jp/test/a", *, published=None, verified=None, day=None, body="確認した原文です。" * 25):
    published = at("2026-10-05", 12, 0) if published is None else published
    return {"source": "財務省", "url": url, "evidence_url": url, "title": "公式の発表",
            "body": body, "body_sha256": sha256(body.encode()).hexdigest(),
            "published_at": None if day else published,
            "published_date": day or datetime.fromtimestamp(published, JST).date().isoformat(),
            "publication_precision": "day" if day else "second",
            "body_verified_at": at(hour=7, minute=0) if verified is None else verified}


class Storage:
    def __init__(self):
        self.values = {}
        self.lock = Lock()

    def read(self, key):
        with self.lock:
            return deepcopy(self.values.get(key))

    def create(self, key, value):
        with self.lock:
            if key in self.values:
                return False
            self.values[key] = deepcopy(value)
            return True


class WindowTests(unittest.TestCase):
    def test_boundaries_keep_real_dates_and_day_precision(self):
        window = morning_window(at())
        inputs = [article(f"https://www.mof.go.jp/{name}", published=stamp) for name, stamp in
                  (("main", at("2026-10-05", 8, 0)), ("gap", at("2026-10-05", 7, 45)),
                   ("old", at("2026-10-05", 7, 30)), ("cutoff", at()),
                   ("late", at(second=1))) ]
        inputs[3]["body_verified_at"] = at()
        inputs[4]["body_verified_at"] = at(second=1)
        inputs.append(article("https://www.mof.go.jp/day", day="2026-10-05"))
        selected = select_articles(inputs, window)
        self.assertEqual({v["selection_route"] for v in selected}, {"main", "carryover", "date_only"})
        self.assertEqual({v["url"].rsplit("/", 1)[-1] for v in selected}, {"main", "gap", "cutoff", "day"})
        dated = next(v for v in selected if v["selection_route"] == "date_only")
        self.assertIsNone(dated["published_at"])
        self.assertEqual(dated["published_date"], "2026-10-05")

    def test_duplicate_revision_and_published_identity_are_not_new_news(self):
        original = article()
        repeated = {**original, "body_verified_at": at(minute=20)}
        self.assertEqual(select_articles([original, repeated], morning_window(at()))[0]["body_verified_at"], original["body_verified_at"])
        revised = article(body="訂正された本文" * 30)
        self.assertEqual(select_articles([original, revised], morning_window(at())), [])
        published = {"publication_mode": "curated", "publish_at": at("2026-10-05", 13, 0),
                     "article_refs": [{"url": original["url"], "body_sha256": original["body_sha256"],
                                       "published_at": original["published_at"], "published_date": original["published_date"]}]}
        for version in (original, revised):
            self.assertEqual(select_articles([version], morning_window(at()), [published]), [])
        unpublished = {**published, "publish_at": at(hour=8, minute=0)}
        self.assertEqual(len(select_articles([original], morning_window(at()), [unpublished])), 1)

    def test_deferred_is_only_next_morning_and_cannot_carry_gap_twice(self):
        row = article(published=at("2026-10-05", 7, 30), verified=at("2026-10-05", 7, 31))
        row.update(deferred_from="2026-10-05", deferred_reason="late_verification")
        self.assertEqual(select_articles([row], morning_window(at()))[0]["selection_route"], "deferred")
        self.assertEqual(select_articles([row], morning_window(at("2026-10-07"))), [])
        row = article(published=at("2026-10-04", 7, 45))
        row.update(deferred_from="2026-10-05", deferred_reason="omitted")
        self.assertEqual(select_articles([row], morning_window(at())), [])

    def test_repeated_body_cannot_mislabel_early_verification_as_late(self):
        early = article(day="2026-10-05", verified=at("2026-10-05", 7, 0))
        late = {**early, "body_verified_at": at("2026-10-05", 7, 31),
                "deferred_from": "2026-10-05", "deferred_reason": "late_verification"}
        selected = select_articles([early, late], morning_window(at()))[0]
        self.assertEqual(selected["selection_route"], "date_only")
        self.assertEqual(selected["body_verified_at"], early["body_verified_at"])
        self.assertNotIn("deferred_from", selected)


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.now = at(hour=6, minute=59)
        self.storage = Storage()
        self.collector = Mock(side_effect=self.collect)

    def collect(self, now, *, since, until, diagnostics):
        diagnostics.update({"財務省": {"feed_status": "ok", "status": "collected"}})
        return [article(verified=self.now)]

    def preparer(self):
        return MorningNewsPreparer(self.storage, self.collector, clock=lambda: self.now)

    def test_slots_are_finite_restart_safe_and_no_paid_material_before_cutoff(self):
        prepare = self.preparer()
        self.assertIsNone(prepare.prepare(self.now))
        self.collector.assert_not_called()
        for minute in range(30):
            self.now = at(hour=7, minute=minute)
            self.assertIsNone(self.preparer().prepare(self.now))
        self.assertEqual(self.collector.call_count, 7)
        call = self.collector.call_args
        self.assertEqual(call.kwargs["since"], at("2026-10-05", 0, 0))
        self.assertEqual(call.kwargs["until"], at())
        self.now = at()
        manifest = prepare.prepare(self.now)
        self.assertEqual(len(manifest["articles"]), 1)
        manifest["articles"][0]["body"] = "caller mutation"
        self.now = at(hour=9, minute=0)
        restored = self.preparer().prepare(self.now)
        self.assertNotEqual(restored["articles"][0]["body"], "caller mutation")
        self.assertEqual(self.collector.call_count, 7)

    def test_late_start_freezes_empty_without_new_collection(self):
        self.now = at(hour=9, minute=0)
        value = self.preparer().prepare(self.now)
        self.assertEqual(value["articles"], [])
        self.assertEqual(value["source_status"]["collection"]["status"], "not_prepared")
        self.collector.assert_not_called()

    def test_final_pending_slot_waits_boundedly_for_valid_before_cutoff_body(self):
        prefix = "days/2026-10-06/preparation"
        claim = {"version": 1, "edition_date": "2026-10-06", "slot": 6, "started_at": at(minute=29, second=59)}
        self.storage.create(prefix + "/slot-6.lock", claim)
        self.now = at()
        prepare = self.preparer()
        self.assertIsNone(prepare.prepare(self.now))
        self.now += 2
        self.storage.create(prefix + "/slot-6.json", {**claim, "finished_at": self.now,
                            "articles": [article(verified=at())], "source_status": {}})
        self.assertEqual(len(prepare.prepare(self.now)["articles"]), 1)
        self.collector.assert_not_called()

    def test_lost_collector_claim_expires_without_collecting_again(self):
        prefix = "days/2026-10-06/preparation"
        started = at(minute=29, second=59)
        self.storage.create(prefix + "/slot-6.lock", {"version": 1, "edition_date": "2026-10-06", "slot": 6, "started_at": started})
        self.now = started + COLLECTION_LEASE_SECONDS
        manifest = self.preparer().prepare(self.now)
        self.assertEqual(manifest["articles"], [])
        self.assertEqual(manifest["source_status"]["preparation"]["expired_slots"], [6])
        self.assertIn("slot_result_missing", manifest["source_status"]["preparation"]["errors"])
        self.collector.assert_not_called()

    def test_late_verification_is_saved_for_next_morning_only(self):
        self.now = at(minute=29, second=59)
        def late(now, **kwargs):
            self.now = at(second=1)
            return [article(published=at(minute=29), verified=self.now)]
        self.collector.side_effect = late
        self.preparer().prepare(self.now)
        self.assertEqual(self.preparer().prepare(self.now)["articles"], [])
        self.now = at("2026-10-07")
        next_day = self.preparer().prepare(self.now)
        self.assertEqual(next_day["articles"][0]["selection_route"], "deferred")
        self.assertEqual(next_day["articles"][0]["deferred_from"], "2026-10-06")
        self.now = at("2026-10-08")
        self.assertEqual(self.preparer().prepare(self.now)["articles"], [])
        self.assertEqual(self.collector.call_count, 1)

    def test_collection_exception_is_persisted_as_unavailable_without_retry(self):
        self.now = at(minute=0)
        self.collector.side_effect = RuntimeError("upstream body must not be saved")
        self.preparer().prepare(self.now)
        self.preparer().prepare(self.now)
        self.now = at()
        value = self.preparer().prepare(self.now)
        self.assertEqual(value["articles"], [])
        self.assertEqual(value["source_status"]["collection"]["status"], "source_unavailable")
        self.assertNotIn("upstream body", str(self.storage.values))
        self.assertEqual(self.collector.call_count, 1)

    def test_corrupt_frozen_manifest_fails_closed(self):
        self.now = at()
        window = morning_window(self.now)
        self.storage.create("days/2026-10-06/preparation/manifest.json", {**window, "articles": [article()], "source_status": {}})
        with self.assertRaisesRegex(ValueError, "invalid_source_manifest"):
            self.preparer().prepare(self.now)
        self.collector.assert_not_called()

    def test_published_omission_defers_once_and_known_revision_is_excluded(self):
        self.now = at("2026-10-05", 7, 0)
        old = article(published=at("2026-10-04", 12, 0), verified=self.now)
        self.collector.side_effect = lambda *args, **kwargs: [old]
        self.preparer().prepare(self.now)
        self.now = at("2026-10-05")
        previous = self.preparer().prepare(self.now)
        self.assertEqual(len(previous["articles"]), 1)
        published = {"edition_date": "2026-10-05", "publication_mode": "curated", "publish_at": at("2026-10-05", 8, 0),
                     "article_refs": [{"url": "https://www.mof.go.jp/another", "body_sha256": "b" * 64}]}
        self.now = at()
        current = self.preparer().prepare(self.now, [published])
        self.assertEqual(current["articles"][0]["selection_route"], "deferred")
        self.assertEqual(current["articles"][0]["deferred_reason"], "omitted")
        self.now = at("2026-10-07")
        self.assertEqual(self.preparer().prepare(self.now, [published])["articles"], [])

    def test_same_day_body_change_is_a_correction_even_across_preparations(self):
        self.now = at("2026-10-05", 7, 0)
        self.collector.side_effect = lambda *args, **kwargs: [article(published=at("2026-10-05", 6, 0), verified=self.now)]
        self.preparer().prepare(self.now)
        self.now = at(minute=0)
        self.collector.side_effect = lambda *args, **kwargs: [article(published=at("2026-10-05", 6, 0), verified=self.now, body="同じURLを更新した新しい本文" * 20)]
        self.preparer().prepare(self.now)
        self.now = at()
        manifest = self.preparer().prepare(self.now)
        self.assertEqual(manifest["articles"], [])
        self.assertIn("correction_review_required", manifest["source_status"]["preparation"]["errors"])

    def test_failed_previous_review_defers_unpublished_source_only(self):
        self.now = at("2026-10-05", 7, 0)
        old = article(published=at("2026-10-04", 12, 0), verified=self.now)
        self.collector.side_effect = lambda *args, **kwargs: [old]
        self.preparer().prepare(self.now)
        self.now = at("2026-10-05")
        self.preparer().prepare(self.now)
        claim = {"edition_date": "2026-10-05", "attempt": 1, "started_at": self.now}
        self.storage.create("days/2026-10-05/attempt-1.lock", claim)
        self.storage.create("days/2026-10-05/attempt-1.result.json", {**claim,
                            "status": "generation_failed", "last_error": "editorial_review_failed_facts"})
        self.now = at()
        current = self.preparer().prepare(self.now)
        self.assertEqual(current["articles"][0]["deferred_reason"], "review_failed")

    def test_known_unpublished_url_remains_a_revision_after_its_window_expires(self):
        self.now = at("2026-10-02", 7, 0)
        self.collector.side_effect = lambda *args, **kwargs: [article(published=at("2026-10-02", 6, 0), verified=self.now)]
        self.preparer().prepare(self.now)
        self.now = at(minute=0)
        self.collector.side_effect = lambda *args, **kwargs: [article(published=at("2026-10-02", 6, 0), verified=self.now, body="新しい本文に更新" * 30)]
        self.preparer().prepare(self.now)
        self.now = at()
        manifest = self.preparer().prepare(self.now)
        self.assertEqual(manifest["articles"], [])
        self.assertIn("correction_review_required", manifest["source_status"]["preparation"]["errors"])
        records = [value for key, value in self.storage.values.items() if key.startswith("source-identities/")]
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["published_date"], "2026-10-02")

    def test_reusable_url_with_new_verified_publication_day_is_a_new_release(self):
        self.now = at("2026-10-02", 7, 0)
        old = article(published=at("2026-10-02", 6, 0), verified=self.now)
        self.collector.side_effect = lambda *args, **kwargs: [old]
        self.preparer().prepare(self.now)
        published = {"publication_mode": "curated", "publish_at": at("2026-10-02", 8, 0), "article_refs": [old]}
        self.now = at("2026-11-02", 7, 0)
        new = article(published=at("2026-11-02", 6, 0), verified=self.now, body="翌月の新しい公式発表" * 30)
        self.collector.side_effect = lambda *args, **kwargs: [new]
        self.preparer().prepare(self.now)
        self.now = at("2026-11-02")
        current = self.preparer().prepare(self.now, [published])
        self.assertEqual(len(current["articles"]), 1)
        self.assertEqual(current["articles"][0]["published_date"], "2026-11-02")
        self.assertNotIn("requires_correction_review", current["articles"][0])
        self.assertNotIn("preparation", current["source_status"])
        records = [value for key, value in self.storage.values.items() if key.startswith("source-identities/")]
        self.assertEqual({row["published_date"] for row in records}, {"2026-10-02", "2026-11-02"})
        published_new = {"publication_mode": "curated", "publish_at": at("2026-11-02", 8, 0), "article_refs": [new]}
        self.assertEqual(select_articles([new], morning_window(at("2026-11-03")), [published_new]), [])


if __name__ == "__main__":
    unittest.main()

from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from hashlib import sha256
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Barrier, Lock
import unittest
from unittest.mock import Mock, patch

from daily_news_producer import build_issue
from intraday_news_runtime import (PREFIX, article_identity, importance, intraday_window,
                                  published_identities, run_job, select_candidate)
from morning_news_window import JST
from news_copy_policy import COPY_LENGTH_POLICY
from news_cache import OFFICIAL_NEWS_SOURCES
from news_review_receipt import completed_receipt
from tests.test_news_review_diagnostics import diagnostic


def at(hour=12, minute=0, day="2026-10-11"):
    return datetime.fromisoformat(day).replace(hour=hour, minute=minute, tzinfo=JST).timestamp()


def source(*, suffix="", precision="second", published=None, verified=None, day="2026-10-11"):
    body = "政府は新しい経済対策の実施を決定した。家計を支える財政支援を導入する。" * 5
    return {"source": "財務省", "title": "政府が経済対策を決定" + suffix,
            "url": f"https://www.mof.go.jp/public_relations/conference/my20261011{suffix}.html",
            "evidence_url": f"https://www.mof.go.jp/public_relations/conference/my20261011{suffix}.html",
            "body": body, "body_sha256": sha256(body.encode()).hexdigest(),
            "published_date": day, "publication_precision": precision,
            "published_at": None if precision == "day" else published if published is not None else at(10, day=day),
            "body_verified_at": verified if verified is not None else at(10, 1, day),
            "observed_at": verified if verified is not None else at(10, 1, day)}


def issue_for(row, window, now):
    value = build_issue({"headline": "政府が経済対策を決定", "summary": "要約の本文です。" * 25,
             "articles": [{"index": 0, "headline": "政府が経済対策を決定",
                           "summary": "詳しい説明の本文です。" * 22}]}, [row], now,
                       source_window=window, copy_length_policy=COPY_LENGTH_POLICY)
    value["reading_structure"] = "lead-plus-other-news-v1"
    value["review_receipt"] = completed_receipt(value, {"draft": "fixed reviewed draft"})
    return value


class Storage:
    def __init__(self, values=None):
        self.values, self.created = deepcopy(values or {}), []
        self.guard, self.private_checks = Lock(), 0
        self.before_create = None

    def ensure_private(self):
        self.private_checks += 1

    def read(self, path, **kwargs):
        with self.guard:
            return deepcopy(self.values.get(path))

    def create(self, path, value, **kwargs):
        if self.before_create:
            result = self.before_create(path, value)
            if result is False:
                return False
        with self.guard:
            if path in self.values:
                return False
            self.values[path] = deepcopy(value)
            self.created.append(path)
            return True

    def reviewed_keys(self, day):
        return sorted(path for path in self.values if path.startswith(f"days/{day}/reviewed-"))

    def recent_days(self):
        return sorted({path.split("/")[1] for path in self.values if path.startswith("days/")}, reverse=True)


class Cache:
    def __init__(self, rows=(), *, checked=None, pending=False, broken=False):
        self.rows, self.checked, self.pending, self.broken = list(rows), checked, pending, broken
        self.collected = []

    def collect(self, now):
        self.collected.append(now)

    def snapshot(self, now):
        return {"articles": deepcopy(self.rows), "pending": self.pending,
                "last_checked_at": self.checked if self.checked is not None else now,
                "source_status": {name: {"feed_status": "failed" if self.broken else "ok",
                    "status": "feed_failed" if self.broken else "collected", "errors": []}
                    for name in OFFICIAL_NEWS_SOURCES}}


class IntradayTests(unittest.TestCase):
    def setUp(self):
        self.folder = TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.baseline = Path(self.folder.name) / "baseline.json"
        self.baseline.write_text("[]")
        self.now = at()
        self.storage, self.cache = Storage(), Cache([source()])
        self.preflight = Mock()
        self.generator = Mock(side_effect=lambda now, *, articles, source_window:
                               issue_for(articles[0], source_window, now))

    def job(self, **options):
        return run_job(options.pop("storage", self.storage), options.pop("generator", self.generator),
                       cache=options.pop("cache", self.cache), clock=lambda: self.now,
                       preflight=options.pop("preflight", self.preflight),
                       baseline_path=self.baseline, **options)

    def test_check_only_is_eligible_without_login_ai_or_attempt_claim(self):
        report = self.job(check_only=True)
        self.assertEqual((report["status"], report["eligible_count"], report["published_count"]), ("ready", 1, 0))
        self.preflight.assert_not_called()
        self.generator.assert_not_called()
        self.assertEqual([path for path in self.storage.created if not path.startswith('news-job-observations/')], [])
        self.assertEqual(report["source_date_counts"], {"2026-10-11": 1})

    def test_real_reviewed_revision_keeps_morning_original_and_actual_source(self):
        # A valid original is separately covered by history tests; publication
        # must never write the original key regardless of whether it exists.
        report = self.job()
        self.assertEqual(report["status"], "published")
        keys = self.storage.reviewed_keys("2026-10-11")
        self.assertEqual(len(keys), 1)
        saved = self.storage.values[keys[0]]
        self.assertEqual(saved["publish_at"], self.now)
        self.assertEqual(saved["article_refs"][0]["published_at"], at(10))
        self.assertEqual(saved["article_refs"][0]["published_date"], "2026-10-11")
        self.assertNotIn("days/2026-10-11/edition.json", self.storage.created)
        self.assertTrue(report["review_receipt"]["gemini_approved"])
        self.assertTrue(report["review_receipt"]["openai_approved"])

    def test_same_source_is_not_repaid_after_restart_or_failed_review(self):
        self.generator.side_effect = ValueError("secret provider response")
        self.assertEqual(self.job()["status"], "review_failed")
        self.generator.reset_mock()
        self.cache = Cache([source()])
        self.assertEqual(self.job()["status"], "no_new_release")
        self.generator.assert_not_called()
        self.assertEqual(len([path for path in self.storage.created if "/attempt-" in path]), 1)

    def test_editorial_diagnostics_survive_failure_without_receipt_publication_or_retry(self):
        from scripts.run_intraday_news_job import IntradayProgress, safe_report
        error = ValueError('isolated_editorial_review_failed')
        value = diagnostic()
        value['raw_response'] = 'private reviewer prose'
        error.editorial_review_diagnostics = value
        self.generator.side_effect = error
        progress = IntradayProgress()
        report = self.job(progress=progress.record)
        stored = self.storage.values[f'{PREFIX}/days/2026-10-11/result-1.json']
        self.assertEqual(report['status'], 'review_failed')
        self.assertEqual(report['editorial_review_diagnostics'], diagnostic())
        self.assertEqual(stored['editorial_review_diagnostics'], diagnostic())
        self.assertEqual(progress.fields()['editorial_review_diagnostics'], diagnostic())
        fixed = safe_report(report, self.now, self.now + 1, False, progress)
        self.assertEqual(fixed['editorial_review_diagnostics'], diagnostic())
        self.assertEqual(report['published_count'], 0)
        self.assertNotIn('review_receipt', report)
        self.assertNotIn('review_receipt', stored)
        self.assertNotIn('private reviewer prose', json.dumps(stored))
        self.assertFalse(any(path.startswith('days/') for path in self.storage.created))
        report['editorial_review_diagnostics']['rounds'].clear()
        self.assertEqual(stored['editorial_review_diagnostics'], diagnostic())
        repeated = self.job()
        self.assertEqual(repeated['status'], 'no_new_release')
        self.assertNotIn('editorial_review_diagnostics', repeated)
        self.generator.assert_called_once()
        self.assertEqual(len([path for path in self.storage.created if '/attempt-' in path]), 1)

    def test_missing_invalid_or_unrelated_error_diagnostics_are_not_invented(self):
        for code, value in [('isolated_editorial_review_failed', None),
                            ('isolated_editorial_review_failed', {'raw': 'private response'}),
                            ('openai_unavailable', diagnostic())]:
            with self.subTest(code=code):
                error = ValueError(code)
                error.editorial_review_diagnostics = value
                generator = Mock(side_effect=error)
                storage = Storage()
                report = self.job(storage=storage, cache=Cache([source()]), generator=generator)
                self.assertEqual(report['status'], 'review_failed')
                self.assertNotIn('editorial_review_diagnostics', report)
                self.assertNotIn('editorial_review_diagnostics',
                    storage.values[f'{PREFIX}/days/2026-10-11/result-1.json'])

    def test_two_workers_selecting_same_story_buy_only_one_reviewed_draft(self):
        barrier = Barrier(2)
        with ThreadPoolExecutor(max_workers=2) as workers:
            results = list(workers.map(lambda _: self.job(preflight=lambda: barrier.wait(timeout=2)), range(2)))
        self.assertEqual(sorted(result["status"] for result in results), ["no_new_release", "published"])
        self.assertEqual(self.generator.call_count, 1)
        self.assertEqual(len(self.storage.reviewed_keys("2026-10-11")), 1)

    def test_source_identity_does_not_change_for_edited_body(self):
        row = source()
        changed = {**row, "body": row["body"] + "追記", "body_sha256": sha256((row["body"] + "追記").encode()).hexdigest()}
        self.assertEqual(article_identity(row), article_identity(changed))
        self.cache = Cache([row, changed])
        self.assertEqual(self.job()["status"], "no_new_release")
        self.generator.assert_not_called()

    def test_correction_flag_is_not_urgent_fresh_release(self):
        self.cache = Cache([{**source(), "requires_correction_review": True}])
        self.assertEqual(self.job()["status"], "no_new_release")
        self.generator.assert_not_called()

    def test_no_new_important_release_does_not_authenticate_or_buy_reviews(self):
        for rows in ([], [{**source(), "title": "家計調査の公表予定"}]):
            with self.subTest(rows=bool(rows)):
                self.cache = Cache(rows)
                self.assertEqual(self.job()["status"], "no_new_release")
        self.preflight.assert_not_called()
        self.generator.assert_not_called()

    def test_incomplete_stale_or_pending_feed_never_buys_reviews(self):
        for cache, status in ((Cache([source()], broken=True), "source_unavailable"),
                              (Cache([source()], checked=self.now - 1201), "source_unavailable"),
                              (Cache([source()], pending=True), "source_pending")):
            with self.subTest(status=status):
                self.assertEqual(self.job(cache=cache)["status"], status)
        self.preflight.assert_not_called()
        self.generator.assert_not_called()

    def test_yesterday_and_morning_window_releases_are_not_relabelled(self):
        self.cache = Cache([source(day="2026-10-10"), source(published=at(7, 29), verified=at(7, 30))])
        self.assertEqual(self.job()["status"], "no_new_release")
        self.generator.assert_not_called()

    def test_date_only_keeps_unknown_time_and_requires_new_daytime_verification(self):
        self.cache = Cache([source(precision="day")])
        self.assertEqual(self.job()["status"], "published")
        saved = self.storage.values[self.storage.reviewed_keys("2026-10-11")[0]]
        self.assertIsNone(saved["article_refs"][0]["published_at"])
        self.assertEqual(saved["article_refs"][0]["publication_precision"], "day")
        self.storage = Storage()
        self.cache = Cache([source(precision="day", verified=at(7, 29))])
        self.assertEqual(self.job()["status"], "no_new_release")


    def test_invalid_edition_reasons_are_durable_without_copy_or_automatic_retry(self):
        def wrong_identity(value):
            value["article_refs"][0]["title"] += "別"
            value["article_summaries"][0]["title"] += "別"
        cases = [
            ("digest_schema", lambda value: value.update(summary=""), None),
            ("source_window", lambda value: value["source_window"].update(cutoff_at=self.now - 1), None),
            ("review_before_generation", lambda value: value.update(reviewed_at=self.now - 1), None),
            ("source_reference_mismatch", wrong_identity, "title"),
        ]
        from scripts.run_intraday_news_job import IntradayProgress, safe_report
        for reason, mutate, field in cases:
            with self.subTest(reason=reason):
                storage, generator, progress = Storage(), Mock(), IntradayProgress()
                def bad(now, *, articles, source_window):
                    value = issue_for(articles[0], source_window, now)
                    value["private_draft"] = "never persist rejected copy"
                    mutate(value)
                    return value
                generator.side_effect = bad
                preflight = Mock()
                if reason == "review_before_generation":
                    # Validation permits review at cutoff; invocation may start later.
                    preflight.side_effect = lambda: setattr(self, "now", self.now + 1)
                report = self.job(storage=storage, generator=generator, progress=progress.record,
                                  preflight=preflight)
                expected = {"schema_version": 1, "stage": "edition_validation", "reason": reason}
                if field:
                    expected["reference_field"] = field
                self.assertEqual(report["last_error"], "invalid_edition")
                self.assertEqual(report["edition_validation_diagnostics"], expected)
                saved = storage.read(f"{PREFIX}/days/2026-10-11/result-1.json")
                self.assertEqual(saved["edition_validation_diagnostics"], expected)
                self.assertEqual(safe_report(report, self.now, self.now + 1, False, progress)
                                 ["edition_validation_diagnostics"], expected)
                self.assertNotIn("never persist rejected copy", json.dumps(saved))
                self.assertEqual(storage.reviewed_keys("2026-10-11"), [])
                self.assertEqual(self.job(storage=storage, generator=generator)["status"], "no_new_release")
                generator.assert_called_once()

    def test_producer_invalid_edition_is_distinguished_without_trusting_exception_metadata(self):
        error = ValueError("invalid_edition")
        error.edition_validation_diagnostics = {"raw": "private provider response"}
        self.generator.side_effect = error
        report = self.job()
        self.assertEqual(report["edition_validation_diagnostics"],
                         {"schema_version": 1, "stage": "generation", "reason": "producer_invalid_edition"})
        self.assertNotIn("private provider response", json.dumps(self.storage.values))

    def test_receipt_failure_keeps_specific_code_without_storing_rejected_copy(self):
        for mutate in (lambda value: value.pop("review_receipt"),
                       lambda value: value["review_receipt"].update(openai_approved=False),
                       lambda value: value.update(headline="政府が異なる対策を決定")):
            with self.subTest(mutate=mutate):
                storage = Storage()
                def bad(now, *, articles, source_window):
                    value = issue_for(articles[0], source_window, now)
                    mutate(value)
                    return value
                report = self.job(storage=storage, generator=bad)
                self.assertEqual(report["last_error"], "intraday_review_receipt_required")
                self.assertEqual(report["edition_validation_diagnostics"],
                                 {"schema_version": 1, "stage": "receipt_validation", "reason": "review_receipt"})
                saved = storage.read(f"{PREFIX}/days/2026-10-11/result-1.json")
                self.assertNotIn("review_receipt", saved)
                self.assertEqual(storage.reviewed_keys("2026-10-11"), [])

    def test_missing_rejected_or_tampered_same_copy_receipt_blocks_storage(self):
        for mutate in (lambda value: value.pop("review_receipt"),
                       lambda value: value["review_receipt"].update(openai_approved=False),
                       lambda value: value.update(headline="政府が異なる対策を決定"),
                       lambda value: value["review_receipt"].pop("review_payload_sha256")):
            with self.subTest(mutate=mutate):
                self.storage = Storage()
                def bad(now, *, articles, source_window):
                    value = issue_for(articles[0], source_window, now)
                    mutate(value)
                    return value
                self.assertEqual(self.job(generator=bad)["status"], "review_failed")
                self.assertEqual(self.storage.reviewed_keys("2026-10-11"), [])

    def test_three_daily_attempts_include_failures_and_do_not_reset_for_new_source(self):
        self.generator.side_effect = ValueError("invalid_edition")
        for suffix in ("a", "b", "c"):
            self.cache = Cache([source(suffix=suffix)])
            self.assertEqual(self.job()["status"], "review_failed")
        self.cache = Cache([source(suffix="d")])
        self.assertEqual(self.job()["status"], "daily_limit")
        self.assertEqual(self.generator.call_count, 3)

    def test_completed_review_may_finish_after_23_but_never_after_midnight(self):
        self.now = at(22, 59)
        def late(now, *, articles, source_window):
            self.now = at(23, 4)
            return issue_for(articles[0], source_window, self.now)
        self.assertEqual(self.job(generator=late)["status"], "published")
        self.storage = Storage()
        self.now = at(22, 59)
        def midnight(now, *, articles, source_window):
            value = issue_for(articles[0], source_window, now)
            self.now = at(0, day="2026-10-12")
            return value
        self.assertEqual(self.job(generator=midnight)["status"], "review_failed")
        self.assertEqual(self.storage.reviewed_keys("2026-10-11"), [])

    def test_uncertain_storage_save_never_restarts_ai(self):
        def conflict(path, value):
            return False if "/reviewed-" in path else None
        self.storage.before_create = conflict
        result = self.job()
        self.assertEqual(result["status"], "publication_unconfirmed")
        self.assertTrue(result["review_receipt"]["gemini_approved"])
        self.assertTrue(result["review_receipt"]["openai_approved"])
        self.assertEqual(result["reviewed_at"], self.now)
        self.assertNotIn("publish_at", result)
        self.assertEqual(self.job()["status"], "no_new_release")
        self.assertEqual(self.generator.call_count, 1)

    def test_write_before_timeout_is_confirmed_by_exact_bounded_readback(self):
        original_create, original_read = self.storage.create, self.storage.read
        readbacks = []
        def create(path, value, **kwargs):
            if "/reviewed-" in path:
                original_create(path, value, **kwargs)
                raise StorageUnavailable("never print a timeout response")
            return original_create(path, value, **kwargs)
        def read(path, **kwargs):
            if "/reviewed-" in path:
                readbacks.append(kwargs.get("deadline"))
            return original_read(path, **kwargs)
        from daily_news_runtime import StorageUnavailable
        self.storage.create, self.storage.read = create, read
        self.assertEqual(self.job()["status"], "published")
        self.assertEqual(len(readbacks), 1)
        self.assertIsInstance(readbacks[0], float)
        self.assertEqual(self.job()["status"], "no_new_release")
        self.assertEqual(self.generator.call_count, 1)

    def test_write_and_read_timeout_preserve_approval_without_claiming_publication(self):
        from daily_news_runtime import StorageUnavailable
        original_create, original_read = self.storage.create, self.storage.read
        readbacks = []
        def create(path, value, **kwargs):
            if "/reviewed-" in path:
                raise StorageUnavailable("private timeout text")
            return original_create(path, value, **kwargs)
        def read(path, **kwargs):
            if "/reviewed-" in path:
                readbacks.append(kwargs.get("deadline"))
                raise StorageUnavailable("private timeout text")
            return original_read(path, **kwargs)
        self.storage.create, self.storage.read = create, read
        report = self.job()
        self.assertEqual(report["status"], "publication_unconfirmed")
        self.assertEqual(report["published_count"], 0)
        self.assertEqual(report["reviewed_at"], self.now)
        self.assertTrue(report["review_receipt"]["gemini_approved"])
        self.assertTrue(report["review_receipt"]["openai_approved"])
        self.assertNotIn("last_error", report)
        self.assertNotIn("publish_at", report)
        self.assertEqual(len(readbacks), 1)
        self.assertEqual(self.job()["status"], "no_new_release")
        self.assertEqual(self.generator.call_count, 1)

    def test_readback_of_different_copy_is_not_publication_confirmation(self):
        def conflict(path, value):
            if "/reviewed-" in path:
                changed = deepcopy(value)
                changed["headline"] = "保存された別の文章"
                self.storage.values[path] = changed
                return False
        self.storage.before_create = conflict
        report = self.job()
        self.assertEqual(report["status"], "publication_unconfirmed")
        self.assertEqual(report["published_count"], 0)
        self.assertTrue(report["review_receipt"]["openai_approved"])
        self.assertNotIn("publish_at", report)

    def test_all_retained_revisions_are_used_for_deduplication(self):
        window = intraday_window(self.now)
        for index, suffix in enumerate(("a", "b", "c")):
            row = source(suffix=suffix)
            row["selection_route"] = "intraday"
            value = issue_for(row, window, self.now)
            self.storage.values[f"days/2026-10-11/reviewed-{index:020d}.json"] = value
        identities = published_identities(self.storage, self.now, baseline_path=self.baseline)
        self.assertEqual(len(identities), 3)
        self.cache = Cache([source(suffix="a")])
        self.assertEqual(self.job()["status"], "no_new_release")
        self.generator.assert_not_called()

    def test_paginated_history_does_not_hide_first_published_story(self):
        window = intraday_window(self.now)
        row = source(suffix="a")
        row["selection_route"] = "intraday"
        original = issue_for(row, window, self.now)
        key = "days/2026-10-11/reviewed-00000000000000000001.json"
        self.storage.values[key] = original
        calls = []
        def listing(prefix, *, offset=0, **kwargs):
            calls.append((prefix, offset))
            if prefix != "days/2026-10-11":
                return []
            return [{"name": "unrelated" + str(index)} for index in range(30)] if offset == 0 else [{"name": key.split("/")[-1]}]
        self.storage._list = listing
        self.assertIn((row["url"], row["published_date"]), published_identities(self.storage, self.now, baseline_path=self.baseline))
        self.assertIn(("days/2026-10-11", 30), calls)

    def test_public_runtime_restores_complete_intraday_revision(self):
        from daily_news_runtime import DailyNewsRuntime
        self.assertEqual(self.job()["status"], "published")
        cache_path = Path(self.folder.name) / "public-reviewed.json"
        preparer = Mock()
        preparer.prepare.return_value = None
        preparer.collect.return_value = {"status": "checked", "last_checked_at": self.now}
        runtime = DailyNewsRuntime(self.storage, None, enabled=True, generation_owner="external",
                  baseline_path=self.baseline, cache_path=cache_path, clock=lambda: self.now,
                  source_preparer=preparer)
        state = runtime.run_once()
        self.assertEqual(state["status"], "ready")
        self.assertEqual(runtime.reviewed_digests()[-1]["source_window"]["kind"], "intraday")

    def test_actual_isolated_producer_receipt_survives_normalization_and_publication(self):
        from isolated_news_producer import generate_isolated_edition
        from tests.test_isolated_news_producer import FakeProviders
        provider = FakeProviders()
        def generate(now, *, articles, source_window):
            return generate_isolated_edition(now, articles=articles, source_window=source_window,
                                             providers=provider, clock=lambda: self.now)
        with patch("requests.sessions.Session.request", side_effect=AssertionError("network disabled")):
            result = self.job(generator=generate)
        self.assertEqual(result["status"], "published")
        calls = [call for call in provider.calls if call[0] in ("gemini", "openai")]
        self.assertEqual([call[0] for call in calls], ["gemini", "openai"])
        self.assertEqual(calls[0][2], calls[1][2])
        self.assertEqual(len(self.storage.reviewed_keys("2026-10-11")), 1)

    def test_boj_intraday_uses_only_verified_facts_in_both_reviews_and_storage(self):
        from isolated_news_producer import generate_isolated_edition
        from official_boj_facts import policy_facts
        from tests.test_official_boj_facts import original
        from tests.test_isolated_news_producer import FakeProviders
        raw = original(day="2026-10-11")
        raw.update(body_verified_at=at(10), observed_at=at(10))
        fact = policy_facts(raw)
        self.cache = Cache([fact])
        provider = FakeProviders()

        def generate(now, *, articles, source_window):
            return generate_isolated_edition(now, articles=articles, source_window=source_window,
                                             providers=provider, clock=lambda: self.now)

        with patch("requests.sessions.Session.request", side_effect=AssertionError("network disabled")):
            result = self.job(generator=generate)
        self.assertEqual(result["status"], "published")
        self.assertEqual(result["category"], "monetary_policy")
        reviews = [call for call in provider.calls if call[0] in ("gemini", "openai")]
        self.assertEqual([call[0] for call in reviews], ["gemini", "openai"])
        self.assertEqual(reviews[0][2], reviews[1][2])
        self.assertNotIn("PRIVATE_BOJ_PROSE", repr(provider.calls) + repr(self.storage.values))
        saved = self.storage.values[self.storage.reviewed_keys("2026-10-11")[0]]
        self.assertEqual(saved["source_window"]["kind"], "intraday")
        self.assertEqual(saved["article_refs"][0]["body_sha256"], fact["body_sha256"])
        self.assertEqual(saved["article_refs"][0]["published_date"], "2026-10-11")
        self.assertIsNone(saved["article_refs"][0]["published_at"])
        self.assertTrue(result["review_receipt"]["gemini_approved"])
        self.assertTrue(result["review_receipt"]["openai_approved"])

    def test_empty_frozen_manifest_or_fabricated_zero_time_are_not_published(self):
        invalid = {**source(precision="day"), "published_at": at(0)}
        self.cache = Cache([invalid])
        self.assertEqual(self.job()["status"], "job_unavailable")
        self.generator.assert_not_called()

    def test_cache_validation_failure_reports_owned_code_without_false_empty(self):
        self.cache.collect = Mock(side_effect=ValueError("invalid_source_cache_poll"))
        updates = []
        result = self.job(check_only=True, progress=updates.append)
        self.assertEqual(result["status"], "job_unavailable")
        self.assertEqual(result["phase"], "source_collection")
        self.assertEqual(result["last_error"], "invalid_source_cache_poll")
        self.assertFalse(result["eligibility_checked"])
        self.assertFalse(result["source_health_verified"])
        self.assertEqual(result["attempt_count"], 0)
        self.assertEqual([path for path in self.storage.created if not path.startswith('news-job-observations/')], [])
        self.assertEqual(updates[-1], result)
        self.preflight.assert_not_called()
        self.generator.assert_not_called()

    def test_arbitrary_exception_content_never_enters_fixed_progress_or_outcome(self):
        for error in (ValueError("secret response body or key"),
                      RuntimeError("secret response body or key")):
            with self.subTest(kind=type(error).__name__):
                self.cache.snapshot = Mock(side_effect=error)
                updates = []
                result = self.job(check_only=True, progress=updates.append)
                self.assertEqual(result["status"], "job_unavailable")
                self.assertEqual(result["phase"], "source_snapshot")
                self.assertEqual(result["last_error"], "job_unavailable")
                self.assertFalse(result["eligibility_checked"])
                self.assertNotIn("secret", repr(result) + repr(updates))
        self.preflight.assert_not_called()
        self.generator.assert_not_called()

    def test_bad_history_reports_storage_phase_instead_of_healthy_no_new_release(self):
        self.storage.values["days/2026-10-11/edition.json"] = {"untrusted": "secret"}
        result = self.job(check_only=True)
        self.assertEqual(result["status"], "storage_unavailable")
        self.assertEqual(result["phase"], "published_history")
        self.assertEqual(result["last_error"], "intraday_history_invalid")
        self.assertTrue(result["source_health_verified"])
        self.assertFalse(result["eligibility_checked"])
        self.assertEqual([path for path in self.storage.created if not path.startswith('news-job-observations/')], [])
        self.assertNotIn("secret", repr(result))

    def test_healthy_empty_is_attested_only_after_eligibility_and_claim_checks(self):
        self.cache = Cache([])
        updates = []
        result = self.job(check_only=True, progress=updates.append)
        self.assertEqual(result["status"], "no_new_release")
        self.assertEqual(result["phase"], "outcome")
        self.assertTrue(result["source_health_verified"])
        self.assertTrue(result["eligibility_checked"])
        self.assertEqual(updates[-1], result)
        self.assertEqual([path for path in self.storage.created if not path.startswith('news-job-observations/')], [])
        self.preflight.assert_not_called()
        self.generator.assert_not_called()

    def test_operational_observations_are_only_bounded_owned_counts(self):
        self.cache = Cache([])
        self.cache.safe_observations = lambda: {
            "legacy_two_source_polls": 2, "concurrent_read_records": 1,
            "raw_body": "secret", "upstream_error": "secret"}
        result = self.job(check_only=True)
        self.assertEqual(result["source_cache_observations"],
                         {"legacy_two_source_polls": 2, "concurrent_read_records": 1})
        self.assertNotIn("secret", repr(result))
        self.cache.safe_observations = Mock(side_effect=RuntimeError("secret"))
        self.assertEqual(self.job(check_only=True)["status"], "no_new_release")

    def test_cold_cli_cache_uses_bounded_restore_allowance_before_authentication(self):
        with patch("intraday_news_runtime.OfficialNewsCache", return_value=self.cache) as factory:
            result = self.job(cache=None, check_only=True)
        self.assertEqual(factory.call_args.kwargs["read_seconds"], 60)
        self.assertEqual(result["status"], "ready")
        self.assertEqual([path for path in self.storage.created if not path.startswith('news-job-observations/')], [])
        self.preflight.assert_not_called()
        self.generator.assert_not_called()

    def test_cache_read_diagnostics_survive_snapshot_deadline_without_false_eligibility(self):
        safe = {"read_seconds": 60, "read_count": 48, "list_count": 3,
                "elapsed_seconds": 60.01, "deadline_exceeded": True}
        self.cache.safe_read_diagnostics = lambda: {**safe, "path": "secret", "body": "secret"}
        self.cache.snapshot = Mock(side_effect=ValueError("source_cache_read_deadline"))
        updates = []
        result = self.job(check_only=True, progress=updates.append)
        self.assertEqual(result["source_cache_reads"], safe)
        self.assertEqual(result["last_error"], "source_cache_read_deadline")
        self.assertFalse(result["eligibility_checked"])
        self.assertFalse(result["source_health_verified"])
        self.assertEqual(result["attempt_count"], 0)
        self.assertEqual(updates[-1], result)
        self.assertNotIn("secret", repr(result))
        self.preflight.assert_not_called()
        self.generator.assert_not_called()
        self.assertEqual([path for path in self.storage.created if not path.startswith('news-job-observations/')], [])

    def test_check_outside_window_expected_day_mismatch_and_private_storage_errors_are_safe(self):
        for hour in (8, 23):
            self.now = at(hour)
            self.assertEqual(self.job()["status"], "outside_intraday_window")
        self.now = at()
        self.assertEqual(self.job(expected_day="2026-10-10")["status"], "outside_intraday_window")
        self.assertEqual(self.storage.private_checks, 0)

    def test_importance_requires_actual_policy_or_statistical_result(self):
        self.assertEqual(importance(source()), "fiscal_policy")
        self.assertIsNone(importance({"title": "経済対策", "body": "経済対策に関する説明資料" * 10}))
        self.assertEqual(importance({"title": "家計調査の結果", "body": "消費支出は前年同月比2.5%減少した。"}), "economic_statistics")
        self.assertIsNone(importance({"title": "家計調査の公表予定", "body": "消費支出は前年同月比2.5%減少した。"}))


if __name__ == "__main__":
    unittest.main()

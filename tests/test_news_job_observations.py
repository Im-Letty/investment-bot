"""Offline receipts connect real job outcomes to public process-memory status."""
from copy import deepcopy
from datetime import datetime
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from news_job_observations import PREFIX, ObservationCache, project, write_once
from news_update_status import JST, company_update_status, economic_update_status


def at(hour=12, minute=0):
    return datetime(2026, 10, 11, hour, minute, tzinfo=JST).timestamp()


class Storage:
    def __init__(self):
        self.values, self.calls = {}, []
        self.fail, self.elapsed = False, 0
    def create(self, path, value):
        self.calls.append(("create", path))
        if self.fail: raise ValueError("private upstream error")
        if path in self.values: return False
        self.values[path] = deepcopy(value); return True
    def read(self, path, **kwargs):
        self.calls.append(("read", path, kwargs.get("deadline")))
        if self.fail: raise ValueError("private upstream error")
        return deepcopy(self.values.get(path))
    def _list(self, prefix, **kwargs):
        self.calls.append(("list", prefix, kwargs.get("deadline")))
        if self.fail: raise ValueError("private upstream error")
        return [{"name": path[len(prefix)+1:]} for path in sorted(self.values, reverse=True)
                if path.startswith(prefix + "/")][:30]


class JobObservationTests(unittest.TestCase):
    def test_exact_receipt_connects_publication_failure_and_healthy_empty_to_ui_status(self):
        storage = Storage()
        cases = (("company", {"status": "published", "published_count": 3, "attempt_count": 3}, "publication_confirmed"),
                 ("morning", {"status": "generation_failed", "attempt_count": 4}, "generation_failed"),
                 ("intraday", {"status": "no_new_release", "source_health_verified": True,
                               "eligibility_checked": True, "attempt_count": 0, "published_count": 0}, "no_eligible_articles"))
        for scope, report, expected in cases:
            self.assertTrue(write_once(storage, scope, report, at(), at()+3))
            self.assertFalse(write_once(storage, scope, report, at(), at()+3), "immutable record cannot be replaced")
            cache = ObservationCache(storage, (scope,), monotonic=lambda: 100)
            cache.refresh(at()+4)
            observed = cache.snapshot()[scope]
            self.assertEqual(observed["state"], expected)
            if scope == "company":
                public = company_update_status({"companies": [{}], "edition_date": "2026-10-11"}, now=at()+4, normal_result=observed)
                self.assertEqual(public["normal_result"]["published_count"], 3)
                self.assertEqual(public["normal_result"]["observed_at"], at()+3)
            else:
                public = economic_update_status({"edition_date": "2026-10-10"}, {"job_results": {scope: observed}}, now=at()+4)
                self.assertEqual(public[scope+"_result"]["state"], expected)

    def test_failed_preflight_never_attests_zero_articles_or_zero_attempts(self):
        result = project("intraday", {"status": "job_unavailable", "attempt_count": 0, "published_count": 0,
                          "eligibility_checked": False, "source_health_verified": False,
                          "last_error": "https://private.invalid key=secret", "body": "private original"}, at(), at()+1)
        self.assertEqual(result["state"], "check_failed")
        self.assertNotIn("attempt_count", result); self.assertNotIn("published_count", result)
        for value in ("private", "secret", "http", "body"):
            self.assertNotIn(value, json.dumps(result))
        self.assertEqual(project("company", {"status": "no_new_release"}, at(), at()+1)["state"], "no_publication")

    def test_failed_reader_keeps_previous_receipt_marks_failure_and_respects_poll_bound(self):
        storage = Storage(); write_once(storage, "morning", {"status": "generation_failed"}, at(), at()+1)
        cache = ObservationCache(storage, ("morning", "intraday"), monotonic=lambda: 100)
        cache.refresh(at()+2); previous = cache.snapshot()["morning"]
        count = len(storage.calls)
        cache.snapshot(); cache.refresh(at()+3)
        self.assertEqual(len(storage.calls), count, "API reads and duplicate polls never access Storage")
        storage.fail = True; cache.refresh(at()+902)
        retained = cache.snapshot()["morning"]
        self.assertEqual(retained["state"], previous["state"])
        self.assertEqual(retained["read_state"], "failed")
        public = economic_update_status({}, {"job_results": cache.snapshot()}, now=at()+902)
        self.assertTrue(public["morning_result"]["observation_failed"])
        self.assertNotIn("private", json.dumps(public))

    def test_read_scope_is_two_days_shared_four_second_deadline_and_fixed_schema(self):
        storage = Storage(); cache = ObservationCache(storage, ("morning", "intraday"), monotonic=lambda: 100)
        cache.refresh(at())
        self.assertEqual(len(storage.calls), 4)
        self.assertTrue(all(row[0] == "list" and row[-1] == 104 for row in storage.calls))
        self.assertTrue(all("2026-10-09" not in row[1] for row in storage.calls))
        write_once(storage, "morning", {"status": "source_unavailable"}, at(), at()+1)
        key = next(iter(storage.values)); storage.values[key]["raw_error"] = "private"
        cache.refresh(at()+901)
        self.assertEqual(cache.snapshot()["morning"]["read_state"], "failed")
        self.assertEqual(cache.snapshot()["morning"]["state"], "unavailable")

    def test_ordinary_intraday_job_receipt_reaches_reader_without_auth_or_claim(self):
        from tests.test_intraday_news_runtime import Storage as JobStorage, Cache, source, at as job_at
        from intraday_news_runtime import run_job
        store, cache = JobStorage(), Cache()
        cache.rows = [source()]
        generator, preflight = Mock(), Mock()
        with TemporaryDirectory() as folder:
            baseline = Path(folder)/"baseline.json"; baseline.write_text("[]")
            report = run_job(store, generator, cache=cache, clock=job_at, check_only=True,
                             preflight=preflight, baseline_path=baseline)
        self.assertEqual(report["status"], "ready")
        notes = [value for key, value in store.values.items() if key.startswith(PREFIX + "/")]
        self.assertEqual(len(notes), 1)
        self.assertEqual(notes[0]["state"], "candidate_confirmed", "eligible preflight is not publication success")
        self.assertFalse(any("attempt-" in key for key in store.values))
        generator.assert_not_called(); preflight.assert_not_called()

    def test_ordinary_company_result_is_restored_without_repeating_review_or_changing_claims(self):
        from tests.test_company_news_runtime import MemoryStorage, NOW, source, record
        from company_news_runtime import PREFIX as COMPANY_PREFIX, source_fingerprint
        from scripts.run_company_news_job import run_job
        class BoundStorage(MemoryStorage):
            def read(self, path, **kwargs): return super().read(path)
            def _list(self, prefix, **kwargs): return super()._list(prefix)
        store = BoundStorage(); row = source()
        store.create(f"{COMPANY_PREFIX}/candidates/2026-10-08/{source_fingerprint(row)}.json", row)
        generator = Mock(side_effect=lambda original, **_: record(original)["company"])
        report = run_job(store, generator, clock=lambda: NOW)
        self.assertEqual(report["published_count"], 1)
        before = deepcopy(store.values)
        cache = ObservationCache(store, ("company",), monotonic=lambda: 100)
        cache.refresh(NOW + 1)
        observed = cache.snapshot()["company"]
        self.assertEqual(observed["state"], "publication_confirmed")
        self.assertEqual(observed["published_count"], 1)
        self.assertEqual(store.values, before)
        generator.assert_called_once()
        for _ in range(3): cache.snapshot()
        self.assertEqual(store.values, before)
        self.assertEqual(len([key for key in store.values if "/attempt-" in key]), 1)

    def test_advisory_failure_cannot_change_outcome_claim_or_stored_article(self):
        storage = Storage(); storage.values["existing/attempt-1"] = {"keep": True}
        before = deepcopy(storage.values); storage.fail = True
        report = {"status": "published", "published_count": 1}
        self.assertFalse(write_once(storage, "company", report, at(), at()+1))
        self.assertEqual(report, {"status": "published", "published_count": 1})
        self.assertEqual(storage.values, before)

    def test_company_partial_upload_and_review_failures_do_not_share_a_false_review_cause(self):
        from tests.test_company_news_runtime import MemoryStorage, NOW, source, record
        from company_news_runtime import PREFIX as COMPANY_PREFIX, source_fingerprint
        from scripts.run_company_news_job import run_job
        from daily_news_producer import GenerationError
        for failure, partial, expected in (("upload", True, "partially_published"),
                ("review", True, "partially_published"), ("upload", False, "check_failed"),
                ("review", False, "review_failed")):
            with self.subTest(failure=failure, partial=partial):
                class FailStorage(MemoryStorage):
                    def create(self, path, value):
                        if failure == "upload" and path.endswith(f"/published-{2 if partial else 1}.json"):
                            return False
                        return super().create(path, value)
                store = FailStorage()
                for row in [source(), source("9433.T")] if partial else [source()]:
                    store.create(f"{COMPANY_PREFIX}/candidates/2026-10-08/{source_fingerprint(row)}.json", row)
                calls=[]
                def generate(row, **kwargs):
                    calls.append(row)
                    if failure == "review" and len(calls) == (2 if partial else 1):
                        raise GenerationError("company_review_failed_openai_facts")
                    return record(row)["company"]
                report = run_job(store, generate, clock=lambda: NOW)
                notes = [value for key, value in store.values.items() if key.startswith(PREFIX + "/")]
                self.assertEqual(notes[0]["state"], expected)
                self.assertEqual(notes[0]["published_count"], 1 if partial else 0)
                self.assertEqual(len([key for key in store.values if "/published-" in key]), 1 if partial else 0)
                self.assertEqual(len([key for key in store.values if "/attempt-" in key]), 2 if partial else 1)
                self.assertEqual(report["status"], "partially_published" if partial else "review_failed")

    def test_morning_success_requires_the_actual_normal_runner_target_edition(self):
        from tests.test_private_news_job import PrivateJobTests, Clock, at as morning_at
        case = PrivateJobTests(); case.setUp()
        try:
            case.clock = Clock(morning_at(12, 0))
            case.runtime.run_once.return_value = {"status": "ready", "edition_date": "2026-10-05",
                                                   "publish_at": morning_at(8), "attempt_count": 1}
            previous = case.run_job()
            self.assertFalse(previous["success"])
            notes = [value for key, value in case.storage.values.items() if key.startswith(PREFIX + "/")]
            self.assertEqual(notes[0]["state"], "check_failed")
            case.clock = Clock(morning_at(12, 1))
            case.runtime.run_once.return_value = {"status": "ready", "edition_date": "2026-10-06",
                                                   "publish_at": morning_at(8), "attempt_count": 1}
            current = case.run_job()
            self.assertTrue(current["success"])
            notes = [value for key, value in case.storage.values.items() if key.startswith(PREFIX + "/")]
            self.assertEqual(max(notes, key=lambda row: row["finished_at"])["state"], "publication_confirmed")
            for edition in (None, "2026-10-10"):
                self.assertEqual(project("morning", {"status": "ready", "success": True, "edition_date": edition},
                                         at(), at()+1)["state"], "check_failed")
        finally:
            case.doCleanups()


if __name__ == "__main__": unittest.main()

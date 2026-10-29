"""Offline public status contracts: publication, source and jobs stay separate."""
from datetime import datetime
import json
import unittest

from news_update_status import JST, company_update_status, economic_update_status, economic_status_lines
from news_initial import render_news_markup


def at(value="2026-10-30T05:12:00"):
    return datetime.fromisoformat(value).replace(tzinfo=JST).timestamp()


def edition():
    return {"edition_date": "2026-10-28", "delivery": "published", "news": [], "supplements": [],
            "digest": {"publication_mode": "curated", "publish_at": at("2026-10-28T08:00:00"),
                       "headline": "保存済みの見出し", "summary": "公開済みの記事を保持", "article_refs": []}}


class PublicNewsStatusTests(unittest.TestCase):
    def test_old_copy_does_not_turn_a_failed_current_job_into_success_or_no_articles(self):
        runtime = {"status": "generation_failed", "edition_date": "2026-10-29",
                   "observed_at": at("2026-10-29T17:59:03"), "last_error": "private raw provider error"}
        result = economic_update_status(edition(), runtime, now=at())
        self.assertEqual(result["publication_state"], "previous")
        self.assertEqual(result["expected_edition_date"], "2026-10-29")
        self.assertEqual(result["morning_result"]["state"], "generation_failed")
        self.assertEqual(result["intraday_result"]["state"], "unavailable")
        self.assertNotIn("private", json.dumps(result))
        data = {**edition(), "update_status": result}
        markup = render_news_markup(data, now=at())
        self.assertIn("2026/10/28版", markup)
        self.assertIn("2026/10/29 · 生成で停止（詳細未提供）", markup)
        self.assertIn("日中の通常処理", markup)
        self.assertIn("結果未提供", markup)
        self.assertNotIn("対象記事なし", markup)

    def test_source_failure_empty_and_review_failure_are_distinct(self):
        for runtime_state, error, expected in (("source_unavailable", None, "check_failed"),
                ("source_empty", None, "no_eligible_articles"),
                ("generation_failed", "isolated_editorial_review_failed", "review_failed")):
            with self.subTest(runtime_state=runtime_state):
                result = economic_update_status(edition(), {"status": runtime_state, "last_error": error,
                    "edition_date": "2026-10-29"}, now=at())
                self.assertEqual(result["morning_result"]["state"], expected)

    def test_release_boundary_is_jst_and_future_or_missing_timestamps_stay_unknown(self):
        before = economic_update_status(edition(), now=at("2026-10-30T07:59:59"))
        after = economic_update_status(edition(), now=at("2026-10-30T08:00:00"))
        self.assertEqual(before["expected_edition_date"], "2026-10-29")
        self.assertEqual(after["expected_edition_date"], "2026-10-30")
        data = edition(); data["digest"]["publish_at"] = at() + 1
        data["source_fetched_at"] = True
        result = economic_update_status(data, now=at())
        self.assertIsNone(result["published_at"])
        self.assertIsNone(result["source_checked_at"])
        self.assertEqual(result["morning_result"]["state"], "unavailable")

    def test_company_collection_and_review_times_do_not_claim_normal_job_or_publication_time(self):
        data = {"edition_date": "2026-10-29", "companies": [{"reviewed_at": at()-2}],
                "checked_at": at()-1, "publication_checked_at": at()-1, "collection_health": "partial"}
        result = company_update_status(data, now=at())
        self.assertEqual(result["publication_state"], "current")
        self.assertEqual(result["source_state"], "partial")
        self.assertIsNone(result["published_at"])
        self.assertEqual(result["normal_result"], {"state": "unavailable"})
        self.assertEqual(company_update_status(data, now=at(), error=True)["source_state"], "check_failed")
        self.assertEqual(company_update_status({**data, "companies": []}, now=at())["publication_state"], "unconfirmed")

    def test_output_is_fixed_bounded_metadata_without_keys_bodies_or_error_reflection(self):
        data = {**edition(), "source_fetched_at": float("inf"), "body": "private original", "key": "secret"}
        result = economic_update_status(data, {"status": "error https://secret.invalid", "raw": "secret"}, now=at())
        encoded = json.dumps(result, allow_nan=False)
        for private in ("secret", "private original", "http", "body"):
            self.assertNotIn(private, encoded)
        self.assertLess(len(encoded), 1500)
        lines = economic_status_lines(result)
        self.assertNotIn("0", [value for key, value in lines if key == "取得元の確認"])


if __name__ == "__main__":
    unittest.main()

"""Synthetic cases: these must never be added to the real benefits catalogue."""
from copy import deepcopy
from datetime import date
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).parent
# Same test file runs in this isolated proposal and in the planned repository
# layout (scripts/, benefits-data/, tests/), with Node supplied by the environment.
CODE_DIR = HERE if (HERE / "build_benefits_catalogue.py").is_file() else HERE.parent / "scripts"
LEGACY = HERE / "legacy-nine.json" if CODE_DIR == HERE else HERE.parent / "benefits-data" / "legacy-nine.json"
sys.path.insert(0, str(CODE_DIR))
import build_benefits_catalogue as candidate

NODE = shutil.which("node")


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        proof = b"Synthetic issuer release used only by unit tests."
        (self.root / "release.html").write_bytes(proof)
        self.legacy = candidate.load_legacy(LEGACY)
        self.identities = {"schema_version": 1, "as_of": "2026-10-16", "items": [
            {"code": "130A", "name": "試験用株式会社", "symbol": "130A.JP"},
            {"code": "131A", "name": "未確認株式会社", "symbol": "131A.T"}]}
        self.source = {"kind": "issuer_primary", "url": "https://example.com/release", "title": "Synthetic test release",
                       "security_code": "130A", "issuer_name": "試験用株式会社", "fetched_at": "2026-10-16T10:00:00+09:00",
                       "evidence_path": "release.html", "evidence_sha256": hashlib.sha256(proof).hexdigest()}
        self.version = {"id": "ordinary-2026", "status": "active", "effective_from": None, "effective_until": None,
                        "announced_on": "2026-10-01", "verified_on": "2026-10-16", "source": self.source,
                        "review": {"status": "reviewed", "reviewed_by": "synthetic-unit-test", "issuer_identity": True,
                                   "programme_status": True, "eligibility": True, "future_changes": True},
                        "period": "3月末", "conditions": "一次資料で確認した条件", "use": "対象店舗で利用",
                        "delivery": "詳細な日程は未確認", "tiers": [
                            {"id": "base", "shares_min": 100, "shares_max": 199, "holding_months_min": 0,
                             "holding_requirement": "基本分は保有期間の条件なし", "reward": "1000円分", "conditions": "申し込みが必要"},
                            {"id": "long", "shares_min": 100, "shares_max": 199, "holding_months_min": 24,
                             "holding_requirement": "同一番号で2年以上継続保有", "reward": "2000円分", "conditions": "所定の記録日を連続して満たす"}],
                        "schedules": []}
        self.company = {"code": "130A", "symbol": "130A.JP", "name": "試験用株式会社", "category": "食事", "versions": [self.version]}
        self.additions = {"schema_version": 1, "companies": [self.company]}

    def build(self, additions=None):
        return candidate.build(self.legacy, additions or self.additions, self.identities, date(2026, 10, 17), self.root)

    def rejected(self, code):
        with self.assertRaisesRegex(candidate.ValidationError, "^" + code + "$"):
            self.build()

    def test_alpha_and_regional_identity_with_all_legacy_unchanged(self):
        rows, report = self.build()
        self.assertEqual(rows[:9], self.legacy)
        self.assertEqual(rows[9]["symbol"], "130A.JP")
        self.assertEqual(rows[9]["schedules"], [])
        self.assertEqual(report["unreviewed_identity_companies"], 1)
        self.assertFalse(report["all_company_coverage"])
        self.assertFalse(report["no_benefit_inferred_from_missing_record"])

    def test_generated_js_roundtrips_exact_legacy_and_new_conditions(self):
        self.assertIsNotNone(NODE, "Put the Node runtime on PATH before running this integration check")
        rows, _ = self.build()
        generated = self.root / "candidate.js"
        generated.write_text(candidate.render_js(rows))
        actual = json.loads(subprocess.check_output([NODE, "-e", "process.stdout.write(JSON.stringify(require(process.argv[1])))", str(generated)]))
        self.assertEqual(actual[:9], self.legacy)
        self.assertIn("同一番号で2年以上", actual[9]["conditions"])
        self.assertIn("2000円分", actual[9]["conditions"])

    def test_future_change_does_not_replace_present_tier(self):
        self.version["effective_until"] = "2026-12-31"
        future = deepcopy(self.version)
        future.update(id="ordinary-2027", effective_from="2027-01-01", effective_until=None)
        future["tiers"][0]["reward"] = "3000円分"
        self.company["versions"].append(future)
        rows, _ = self.build()
        self.assertEqual(rows[9]["reward"], "1000円分")
        future_rows, _ = candidate.build(self.legacy, self.additions, self.identities, date(2027, 1, 1), self.root)
        self.assertEqual(future_rows[9]["reward"], "3000円分")

    def test_one_time_record_is_descriptive_not_an_ongoing_active_programme(self):
        self.version["one_time_record_date"] = "2026-09-30"
        self.version["grant_summary"] = "2026年11月中旬ごろ発送予定"
        self.version["tiers"][0]["holding_months_min"] = None
        original = deepcopy(self.additions)
        for as_of in (date(2026, 10, 17), date(2026, 12, 1), date(2027, 9, 30)):
            with self.subTest(as_of=as_of):
                rows, report = candidate.build(self.legacy, self.additions, self.identities, as_of, self.root)
                row = rows[9]
                self.assertEqual(row["programmeStatus"], "one_time")
                self.assertEqual(row["oneTimeRecordDate"], "2026-09-30")
                self.assertIsNone(row["programmeEffectiveFrom"])
                self.assertIsNone(row["programmeEffectiveUntil"])
                self.assertIsNone(row["tiers"][0]["holding_months_min"])
                self.assertEqual(row["grant"], "2026年11月中旬ごろ発送予定")
                self.assertEqual(row["schedules"], [])
                self.assertEqual(report["one_time_count"], 1)
                self.assertEqual(report["new_active_companies"], 0)
                self.assertEqual(report["published_total"], 10)
                self.assertEqual(rows[:9], self.legacy)
        self.assertEqual(self.additions, original)

    def test_one_time_record_requires_real_non_null_ISO_date(self):
        for invalid in (None, True, "", "2026-02-30", "2026-9-30", "2026-09-30T00:00:00Z"):
            with self.subTest(invalid=invalid):
                self.version["one_time_record_date"] = invalid
                self.rejected("one_time_record_date")

    def test_one_time_record_cannot_mix_purchase_schedules(self):
        self.version["one_time_record_date"] = "2026-09-30"
        self.version["schedules"] = [{"date": "2026-09-28", "record": "2026-09-30",
            "ex_dividend_date": "2026-09-29", "verified": "2026-10-16", "status": "confirmed",
            "holding_basis": "continuous_holding", "source": "https://example.com/trade-days",
            "basis": "Synthetic checked timetable", "holdUntil": "2026/09/28取引終了まで",
            "holdExplanation": "Synthetic long-term condition", "grant": "発送予定は本文を確認",
            "delivery": "Synthetic dispatch note"}]
        self.rejected("one_time_schedules")

    def test_one_time_record_requires_reviewed_active_version_and_matching_interval(self):
        self.version.update(one_time_record_date="2026-09-30", status="suspended", effective_from="2026-09-01")
        self.rejected("one_time_status")
        self.version.update(status="active", effective_from="2026-10-01")
        self.rejected("one_time_wrong_version")
        self.version["effective_from"] = None
        self.version["review"]["eligibility"] = False
        self.rejected("manual_review_incomplete")

    def test_optional_one_time_metadata_does_not_change_ordinary_projection(self):
        rows, report = self.build()
        self.assertEqual(rows[9]["programmeStatus"], "active")
        self.assertNotIn("oneTimeRecordDate", rows[9])
        self.assertEqual(report["new_active_companies"], 1)
        self.assertEqual(report["one_time_count"], 0)

    def test_announced_future_only_is_withheld_with_reason(self):
        self.version["effective_from"] = "2027-01-01"
        rows, report = self.build()
        self.assertEqual(len(rows), 9)
        self.assertEqual(report["withheld"], [{"code": "130A", "reason": "future_effective"}])

    def test_abolished_and_suspended_are_not_current_benefit_cards(self):
        for status in ("abolished", "suspended"):
            with self.subTest(status=status):
                self.version.update(status=status, effective_from="2026-10-01")
                rows, report = self.build()
                self.assertEqual(len(rows), 9)
                self.assertEqual(report["withheld"][0]["reason"], status)

    def test_incomplete_review_and_wrong_identity_are_rejected(self):
        self.version["review"]["eligibility"] = False
        self.rejected("manual_review_incomplete")
        self.version["review"]["eligibility"] = True
        self.source["security_code"] = "131A"
        self.rejected("source_issuer_code")

    def test_duplicate_or_legacy_company_cannot_overwrite(self):
        self.additions["companies"].append(deepcopy(self.company))
        self.rejected("duplicate_or_legacy_company")
        self.additions["companies"] = [self.company]
        code = self.legacy[0]["code"]
        self.identities["items"].append({"code": code, "name": self.company["name"], "symbol": code + ".T"})
        self.company.update(code=code, symbol=code + ".T")
        self.source["security_code"] = code
        self.rejected("duplicate_or_legacy_company")

    def test_overlapping_effective_versions_are_rejected(self):
        other = deepcopy(self.version)
        other.update(id="uncertain-change", effective_from="2026-10-01")
        self.company["versions"].append(other)
        self.rejected("version_intervals_overlap")

    def test_evidence_content_and_path_are_verified(self):
        self.source["evidence_sha256"] = "0" * 64
        self.rejected("source_evidence_mismatch")
        self.source["evidence_path"] = "../escape.html"
        self.rejected("source_evidence_missing")

    def test_primary_page_observation_note_is_distinct_from_raw_payload(self):
        self.source["evidence_kind"] = "primary_page_observation_note"
        self.source["observed_at"] = self.source.pop("fetched_at")
        rows, _ = self.build()
        metadata = rows[9]["programmeSource"]
        self.assertNotIn("fetched_at", metadata)
        self.assertEqual(metadata, {"url": self.source["url"], "title": self.source["title"], "verified_on": "2026-10-16"})
        # The reviewed input manifest retains proof semantics; the public asset
        # gets only URL/title/check date and cannot mislabel a note as raw bytes.
        self.assertEqual(self.source["evidence_kind"], "primary_page_observation_note")
        self.assertIn("observed_at", self.source)
        self.assertIn("evidence_sha256", self.source)
        self.source.pop("observed_at")
        self.rejected("source_fetch_time")

    def test_public_projection_whitelists_facts_and_keeps_private_manifest_unchanged(self):
        self.source["private_review_note"] = "private-marker-source"
        self.version["tiers"][0]["internal_reviewer"] = "private-marker-tier"
        original = deepcopy(self.additions)
        rows, _ = self.build()
        public = candidate.render_js(rows)
        for forbidden in ("evidence_path", "evidence_sha256", "reviewed_by", "private-marker", "programmeVersionId", "synthetic-unit-test"):
            self.assertNotIn(forbidden, public)
        self.assertEqual(self.additions, original)
        self.assertNotIn("id", rows[9]["tiers"][0])

    def test_reviewed_citation_homepage_replaces_only_public_source_url(self):
        self.source["url"] = "https://example.com/internal-source-deep-path/primary-release.html"
        self.source["citation_url"] = "https://example.com/"
        original = deepcopy(self.additions)
        rows, _ = self.build()
        self.assertEqual(rows[9]["url"], "https://example.com/")
        self.assertEqual(rows[9]["programmeSource"]["url"], "https://example.com/")
        public = candidate.render_js(rows)
        self.assertNotIn("internal-source-deep-path", public)
        self.assertNotIn(self.source["url"], public)
        self.assertNotIn("evidence_path", public)
        self.assertEqual(self.additions, original)
        self.source["citation_url"] = "http://example.com/"
        self.rejected("invalid_source_url")

    def test_unsafe_url_and_future_verification_are_rejected(self):
        self.source["url"] = "javascript:alert(1)"
        self.rejected("invalid_source_url")
        self.source["url"] = "https://example.com/release"
        self.version["verified_on"] = "2026-10-18"
        self.rejected("version_future_review")

    def test_schedule_requires_real_trade_and_record_dates_and_continuity(self):
        schedule = {"date": "2027-03-29", "record": "2027-03-31", "ex_dividend_date": "2027-03-30",
                    "verified": "2026-10-16", "status": "planned", "holding_basis": "continuous_holding",
                    "source": "https://example.com/verified-trading-table", "basis": "取引日程を個別に確認した予定",
                    "holdUntil": "2027/03/29の取引終了まで", "holdExplanation": "長期分は所定の継続保有条件も必要",
                    "grant": "具体的な付与日は未確認", "delivery": "会社の案内を確認"}
        self.version["schedules"] = [schedule]
        schedule["internal_evidence_path"] = "private-marker-schedule"
        rows, _ = self.build()
        self.assertEqual(rows[9]["schedules"][0]["record"], "2027-03-31")
        self.assertNotIn("internal_evidence_path", rows[9]["schedules"][0])
        schedule["holding_basis"] = "basic_no_minimum_holding"
        self.rejected("schedule_continuity_not_verified")
        schedule["holding_basis"] = "continuous_holding"
        schedule["date"] = "2027-03-31"
        self.rejected("schedule_trade_order")

    def test_json_duplicate_keys_and_nonfinite_numbers_are_rejected(self):
        path = self.root / "invalid.json"
        for content, reason in (("{\"x\":1,\"x\":2}", "duplicate_json_key"), ("{\"x\":NaN}", "invalid_json_number")):
            path.write_text(content)
            with self.assertRaisesRegex(candidate.ValidationError, reason):
                candidate.load_json(path)

    def test_legacy_file_changes_fail_before_build(self):
        path = self.root / "legacy.json"
        path.write_text(LEGACY.read_text() + " ")
        with self.assertRaisesRegex(candidate.ValidationError, "legacy_snapshot_changed"):
            candidate.load_legacy(path)

    def test_control_characters_in_evidence_paths_fail_with_fixed_code(self):
        for value in ("bad\x00path", "bad\npath", "bad\x7fpath"):
            with self.subTest(value=repr(value)):
                self.source["evidence_path"] = value
                self.rejected("source_evidence_path")


if __name__ == "__main__":
    unittest.main()

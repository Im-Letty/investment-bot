import csv
from datetime import datetime, timedelta
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts import update_nikkei225 as updater


NOW = datetime(2026, 9, 24, 15, 0, tzinfo=updater.JST)
# Stable mock membership keeps parser tests independent of the daily real file.
SEED = {
    "as_of": "2026-09-24",
    "items": [{"code": str(code), "name": f"検証会社{code}"} for code in range(1000, 1220)] + [
        {"code": "285A", "name": "キオクシアホールディングス"},
        {"code": "4902", "name": "コニカミノルタ"},
        {"code": "543A", "name": "ＡＲＣＨＩＯＮ"},
        {"code": "7004", "name": "カナデビア"},
        {"code": "7203", "name": "トヨタ自動車"},
    ],
}


def csv_bytes(items=None, *, day="2026/09/24", encoding="cp932"):
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    writer.writerow(["対象日付", "コード", "銘柄名", "株価換算係数", "業種", "セクター"])
    for item in items if items is not None else SEED["items"]:
        writer.writerow([day, item["code"], item["name"], "1.0", "機械", "技術"])
    writer.writerow(["本資料は日経の著作物であり、検証用の末尾行です。"])
    return buffer.getvalue().encode(encoding)


class ParseUniverseTests(unittest.TestCase):
    def test_verified_seed_has_current_members_and_separate_future_changes(self):
        actual = json.loads(updater.DEFAULT_OUTPUT.read_text(encoding="utf-8"))
        codes = {item["code"] for item in actual["items"]}
        expected = 226 if actual["as_of"] == "2026-09-29" and "646A" in codes else 225
        self.assertEqual(len(codes), expected)
        self.assertEqual(len(actual["items"]), expected)
        self.assertEqual(actual["source"]["url"], updater.SOURCE_URL)
        if actual["as_of"] == "2026-09-24":
            self.assertTrue({"285A", "543A", "4902", "7004"} <= codes)
            self.assertFalse({"646A", "5016", "6525", "9697"} & codes)

    def test_shift_jis_source_preserves_actual_date_and_alpha_codes(self):
        document = updater.parse_csv(csv_bytes(), now=NOW)
        self.assertEqual(document["as_of"], "2026-09-24")
        self.assertEqual(len(document["items"]), 225)
        self.assertIn("285A.T", {item["symbol"] for item in document["items"]})
        self.assertEqual(len(document["source"]["sha256"]), 64)
        self.assertNotIn("weight", document["items"][0])
        self.assertNotIn("株価換算係数", json.dumps(document, ensure_ascii=False)[
            json.dumps(document, ensure_ascii=False).index('"items"'):])

    def test_utf8_bom_and_unchanged_source_date_after_weekend(self):
        document = updater.parse_csv(csv_bytes(encoding="utf-8-sig"), now=NOW + timedelta(days=3))
        self.assertEqual(document["as_of"], "2026-09-24")
        self.assertTrue(document["retrieved_at"].startswith("2026-09-27"))

    def test_rejects_truncated_duplicate_or_blank_company_rows(self):
        cases = [
            SEED["items"][:-1],
            SEED["items"][:-1] + [SEED["items"][0]],
            [dict(SEED["items"][0], name="")] + SEED["items"][1:],
        ]
        for items in cases:
            with self.subTest(items=items[:1]), self.assertRaises(ValueError):
                updater.parse_csv(csv_bytes(items), now=NOW)

    def test_rejects_future_old_and_mixed_source_dates(self):
        for day in ("2026/09/25", "2026/09/01"):
            with self.subTest(day=day), self.assertRaises(ValueError):
                updater.parse_csv(csv_bytes(day=day), now=NOW)
        mixed = csv_bytes().replace(b'"2026/09/24"', b'"2026/09/23"', 1)
        # csv.writer's unquoted date still exercises mixed-date rejection.
        mixed = mixed.replace(b"2026/09/24", b"2026/09/23", 1)
        with self.assertRaises(ValueError):
            updater.parse_csv(mixed, now=NOW)

    def test_rejects_error_html_and_new_unrecognized_columns(self):
        for raw in (b"<html>Forbidden</html>", csv_bytes().replace("対象日付".encode("cp932"), b"date", 1)):
            with self.subTest(raw=raw[:40]), self.assertRaises(ValueError):
                updater.parse_csv(raw, now=NOW)

    def test_october_announcement_never_applied_early(self):
        replacement = updater.KNOWN_CHANGES[1]
        remove = {item["code"] for item in replacement["remove"]}
        october = [item for item in SEED["items"] if item["code"] not in remove] + replacement["add"]
        with self.assertRaisesRegex(ValueError, "Future October"):
            updater.parse_csv(csv_bytes(october), now=NOW)
        effective = NOW.replace(month=10, day=1)
        document = updater.parse_csv(csv_bytes(october, day="2026/10/01"), now=effective)
        self.assertEqual(len(document["items"]), 225)
        self.assertEqual(document["scheduled_changes"], [])
        with self.assertRaisesRegex(ValueError, "October effective"):
            updater.parse_csv(csv_bytes(day="2026/10/01"), now=effective)

    def test_226_only_allowed_for_confirmed_one_day_spinoff(self):
        temporary = SEED["items"] + [{"code": "646A", "name": "クラサスケミカル"}]
        document = updater.parse_csv(csv_bytes(temporary, day="2026/09/29"), now=NOW.replace(day=29))
        self.assertEqual(len(document["items"]), 226)
        for day in (24, 30):
            with self.subTest(day=day), self.assertRaises(ValueError):
                updater.parse_csv(csv_bytes(temporary, day=f"2026/09/{day}"), now=NOW.replace(day=day))
        unknown = SEED["items"] + [{"code": "111A", "name": "未確認の追加"}]
        with self.assertRaises(ValueError):
            updater.parse_csv(csv_bytes(unknown, day="2026/09/29"), now=NOW.replace(day=29))


class SaveUniverseTests(unittest.TestCase):
    def test_success_returns_and_saves_validated_document(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "universe.json"
            result = updater.update_universe(path, now=NOW, fetcher=csv_bytes)
            self.assertEqual(json.loads(path.read_text()), result)
            self.assertEqual(list(path.parent.glob("*.tmp")), [])

    def test_fetch_validation_and_replace_failure_preserve_previous_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "universe.json"
            original = json.dumps(SEED, ensure_ascii=False).encode("utf-8")
            path.write_bytes(original)
            for fetcher in (lambda: (_ for _ in ()).throw(TimeoutError("offline")),
                            lambda: csv_bytes(SEED["items"][:-1])):
                with self.assertRaises((ValueError, TimeoutError)):
                    updater.update_universe(path, now=NOW, fetcher=fetcher)
                self.assertEqual(path.read_bytes(), original)
            with patch.object(updater.os, "replace", side_effect=OSError("disk unavailable")):
                with self.assertRaises(OSError):
                    updater.update_universe(path, now=NOW, fetcher=csv_bytes)
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(list(path.parent.glob("*.tmp")), [])

    def test_older_source_cannot_replace_newer_saved_version(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "universe.json"
            original = json.dumps(dict(SEED, as_of="2026-09-25")).encode()
            path.write_bytes(original)
            with self.assertRaisesRegex(ValueError, "older universe"):
                updater.update_universe(path, now=NOW.replace(day=25), fetcher=csv_bytes)
            self.assertEqual(path.read_bytes(), original)


class FetchSafetyTests(unittest.TestCase):
    def test_redirect_rejects_external_local_plaintext_and_credentials(self):
        redirects = updater._OfficialRedirects()
        for url in ("https://127.0.0.1/nkave/x", "http://indexes.nikkei.co.jp/nkave/x",
                    "https://indexes.nikkei.co.jp.evil.test/nkave/x",
                    "https://user@indexes.nikkei.co.jp/nkave/x"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                redirects.redirect_request(None, None, 302, "", {}, url)

    def test_oversized_content_and_naive_clock_are_rejected(self):
        with self.assertRaises(ValueError):
            updater.parse_csv(b"x" * (updater.MAX_BYTES + 1), now=NOW)
        with self.assertRaisesRegex(ValueError, "timezone"):
            updater.parse_csv(csv_bytes(), now=NOW.replace(tzinfo=None))


if __name__ == "__main__":
    unittest.main()

import unittest
from datetime import date

from jpx_calendar_source import latest_file, parse_rows


def serial(value):
    return (date.fromisoformat(value) - date(1899, 12, 30)).days


def rows():
    return [
        ["2026/9/24公表分"], ["対象期間：2026/9/24～2026/10/8"], [],
        ["基準日", "（実質上）基準日", "権利落日\n（普通取引）", "権利落日その他", "銘柄コード", "銘柄略称", "市場", "備考", "更新フラグ"],
        [serial("2026-09-30"), serial("2026-09-30"), serial("2026-09-29"), serial("2026-10-01"), 94320.0, "ＮＴＴ", "プライム市場", "配当", ""],
    ]


class JpxCalendarSourceTests(unittest.TestCase):
    def parse(self, data, catalogue=None):
        return parse_rows(data, 0, date(2026, 9, 24), "https://www.jpx.co.jp/listing/20260924.xls", catalogue or {"9432": "NTT"})

    def test_only_ordinary_dividends_and_no_payment_or_deadline_guesses(self):
        data = rows()
        for code, note in [(72030, "分割"), (58030, "臨時総会"), ("133A0", "配当")]:
            row = data[4].copy(); row[4] = code; row[7] = note; data.append(row)
        events = self.parse(data, {"9432": "NTT", "7203": "トヨタ", "5803": "フジクラ"})["events"]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["date"], "2026-09-29")
        self.assertEqual(events[0]["record_date"], "2026-09-30")
        self.assertEqual(events[0]["kind"], "ex_dividend")
        self.assertEqual(events[0]["name"], "NTT")

    def test_alphanumeric_and_duplicate_rows(self):
        data = rows(); data[4][4] = "285A0"; data.append(data[4].copy())
        events = self.parse(data, {"285A": "キオクシア"})["events"]
        self.assertEqual([e["symbol"] for e in events], ["285A.T"])

    def test_inconsistent_date_not_published_as_valid(self):
        data = rows(); data[4][2] = serial("2026-10-01")
        with self.assertRaises(ValueError): self.parse(data)

    def test_one_bad_domestic_row_cannot_clear_other_saved_schedules(self):
        data = rows(); bad = data[4].copy(); bad[4] = 72030; bad[2] = "unknown"; data.append(bad)
        with self.assertRaises(ValueError): self.parse(data, {"9432": "NTT", "7203": "トヨタ"})

    def test_schema_change_raises_instead_of_erasing_old_data(self):
        data = rows(); data[3][2] = "別の列"
        with self.assertRaises(ValueError): self.parse(data)

    def test_no_dividend_rows_raises(self):
        data = rows(); data[4][7] = "分割"
        with self.assertRaises(ValueError): self.parse(data)

    def test_window_must_match_publication(self):
        data = rows(); data[1][0] = "対象期間：2025/9/24～2025/10/8"
        with self.assertRaises(ValueError): self.parse(data)

    def test_latest_official_not_future_or_offsite(self):
        html = ''.join(f'<a href="{u}">x</a>' for u in [
            "/listing/others/ex-rights/files/20260918.xls", "/listing/others/ex-rights/files/20260924.xls",
            "https://example.com/20260924.xls", "/listing/others/ex-rights/files/20260925.xls"])
        day, url = latest_file(html, date(2026, 9, 24))
        self.assertEqual(day, date(2026, 9, 24)); self.assertIn("www.jpx.co.jp", url)

    def test_stale_publication_rejected(self):
        with self.assertRaises(ValueError):
            latest_file('<a href="/listing/20260801.xls">x</a>', date(2026, 9, 24))


if __name__ == "__main__": unittest.main()

import unittest
from datetime import datetime
from scripts.check_daily_news import JST, check_window_seconds


class CheckWindowTests(unittest.TestCase):
    def test_early_wake_runs_past_release(self):
        now = datetime(2026, 9, 25, 6, 47, tzinfo=JST)
        self.assertEqual(check_window_seconds(now), 93 * 60)

    def test_delayed_run_keeps_retry_window(self):
        now = datetime(2026, 9, 25, 8, 17, tzinfo=JST)
        self.assertEqual(check_window_seconds(now), 65 * 60)

    def test_manual_overnight_run_is_bounded(self):
        now = datetime(2026, 9, 25, 0, 0, tzinfo=JST)
        self.assertEqual(check_window_seconds(now), 100 * 60)

import unittest
from copy import deepcopy
from datetime import datetime
import io
import json
from unittest.mock import patch
from scripts.check_daily_news import JST, check_window_seconds, current_delivery, main


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


class DeliveryCheckTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 4, 8, 0, tzinfo=JST)
        self.data = {
            'policy_version': 4, 'lang': 'ja', 'edition_date': '2026-10-04',
            'delivery': 'headlines', 'fallback_reason': 'current_edition_unavailable',
            'digest': None, 'selection_status': 'ready', 'fetched_at': self.now.timestamp(),
            'news': [{'title': '企業の新しい発表', 'source': 'NHK経済',
                      'url': 'https://example.test/article', 'published_date': '2026-10-04',
                      'published_at': self.now.timestamp() - 600}],
        }

    def test_headlines_are_confirmed_separately_from_ai_publication(self):
        self.assertEqual(current_delivery(self.data, self.now), 'headlines')
        published = {**self.data, 'delivery': 'published', 'digest': {'summary': '確認済み'}, 'fetched_at': None}
        self.assertEqual(current_delivery(published, self.now), 'published')

    def test_stale_empty_future_or_misdated_feed_is_not_reported_as_success(self):
        invalid = [
            {'edition_date': '2026-10-02'}, {'news': []}, {'stale': True},
            {'fetched_at': self.now.timestamp() - 900}, {'fetched_at': float('nan')},
            {'digest': {'summary': '古い要約'}}, {'fallback_reason': 'unknown'},
        ]
        for changes in invalid:
            with self.subTest(changes=changes):
                self.assertIsNone(current_delivery({**self.data, **changes}, self.now))
        for changes in ({'published_at': self.now.timestamp()+1}, {'published_date': '2026-10-03'},
                        {'published_at': self.now.timestamp()-86400}, {'published_at': float('inf')},
                        {'url': 'javascript:alert(1)'}):
            with self.subTest(changes=changes):
                bad = deepcopy(self.data)
                bad['news'][0].update(changes)
                self.assertIsNone(current_delivery(bad, self.now))

    def test_exhausted_or_disabled_ai_still_warms_feed_until_eight(self):
        before = self.now.replace(hour=7, minute=59)
        for state in ({'status': 'daily_limit', 'configured': True, 'enabled': True},
                      {'status': 'disabled', 'configured': False, 'enabled': False}):
            responses = [state, {**self.data, 'edition_date': '2026-10-02'}, state, self.data]
            with self.subTest(state=state), patch('scripts.check_daily_news.datetime') as date_mock, \
                    patch('scripts.check_daily_news.time.monotonic', return_value=0), \
                    patch('scripts.check_daily_news.time.sleep') as sleep, \
                    patch('scripts.check_daily_news.urlopen', side_effect=[io.BytesIO(json.dumps(x).encode()) for x in responses]) as fetch, \
                    patch('sys.stdout', new_callable=io.StringIO) as output:
                date_mock.now.side_effect = [before, before, self.now]
                date_mock.fromtimestamp.side_effect = datetime.fromtimestamp
                self.assertEqual(main(), 0)
                self.assertEqual(fetch.call_count, 4)
                sleep.assert_called_once_with(60)
                self.assertIn('::warning::AI summary is unavailable', output.getvalue())

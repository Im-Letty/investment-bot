import unittest
from copy import deepcopy
from datetime import datetime, timedelta
import io
import json
from unittest.mock import patch
from scripts.check_daily_news import JST, check_window_seconds, current_delivery, healthy_quiet_response, main


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

    def test_early_scheduler_buffer_keeps_host_awake_through_release(self):
        for hour, minutes in ((4, 213), (5, 153), (6, 93)):
            now = datetime(2026, 10, 6, hour, 47, tzinfo=JST)
            self.assertEqual(check_window_seconds(now), minutes * 60)


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
        published = self.published()
        self.assertEqual(current_delivery(published, self.now), 'published')

    def test_verified_empty_official_day_is_distinct_from_outage_and_publication(self):
        state = {'status': 'source_empty', 'source_mode': 'official', 'edition_date': '2026-10-04',
                 'sources': ['総務省統計局', '財務省'], 'last_error': None,
                 'cutoff_at': self.now.replace(hour=7, minute=30).timestamp()}
        empty = {'policy_version': 4, 'lang': 'ja', 'edition_date': '2026-10-04',
                 'news': [], 'digest': None, 'selection_status': 'unavailable'}
        for changes, success in (({}, True), ({'status': 'source_unavailable'}, False),
                                 ({'edition_date': '2026-10-03'}, False),
                                 ({'sources': ['財務省']}, False), ({'cutoff_at': 0}, False)):
            with self.subTest(changes=changes), patch('scripts.check_daily_news.datetime') as date_mock, \
                    patch('scripts.check_daily_news.check_window_seconds', return_value=1), \
                    patch('scripts.check_daily_news.time.monotonic', side_effect=[0, 0, 2]), \
                    patch('scripts.check_daily_news.time.sleep'), \
                    patch('scripts.check_daily_news.urlopen', side_effect=[
                        io.BytesIO(json.dumps({**state, **changes}).encode()), io.BytesIO(json.dumps(empty).encode())]), \
                    patch('sys.stdout', new_callable=io.StringIO) as output:
                date_mock.now.return_value = self.now
                date_mock.strptime.side_effect = datetime.strptime
                if success:
                    self.assertEqual(main(), 0)
                    self.assertIn('No AI edition was generated', output.getvalue())
                    self.assertNotIn('publicly available', output.getvalue())
                else:
                    with self.assertRaisesRegex(SystemExit, 'was not confirmed'):
                        main()

    def test_quiet_window_needs_a_healthy_public_response(self):
        for data in ({'news': []}, {'error': 'failed', 'news': []}, None, [],
                     {'policy_version': 4, 'lang': 'ja', 'edition_date': '2026-10-04',
                      'news': [], 'selection_status': 'unavailable', 'error': 'failed'}):
            self.assertFalse(healthy_quiet_response(data, self.now))
        previous = self.published()
        previous['edition_date'] = previous['digest']['edition_date'] = '2026-10-03'
        previous['news'][0]['published_date'] = '2026-10-03'
        previous['news'][0]['published_at'] -= 86400
        self.assertTrue(healthy_quiet_response(previous, self.now))

    def published(self):
        return {**self.data, 'delivery': 'published', 'fetched_at': None,
                'digest': {'publication_mode': 'curated', 'edition_date': self.data['edition_date'],
                           'summary': '確認済み'}}

    def test_published_marker_without_current_curated_digest_is_not_success(self):
        for digest in ({}, {'summary': '確認済み'},
                       {'publication_mode': 'curated', 'edition_date': '2026-10-03'},
                       {'publication_mode': 'draft', 'edition_date': '2026-10-04'}):
            with self.subTest(digest=digest):
                self.assertIsNone(current_delivery({**self.published(), 'digest': digest}, self.now))

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
            responses = [state, {**self.data, 'edition_date': '2026-10-02'}, state, self.data,
                         state, self.data]
            clock = {'elapsed': 0}
            def sleep(seconds):
                clock['elapsed'] += seconds
            with self.subTest(state=state), patch('scripts.check_daily_news.datetime') as date_mock, \
                    patch('scripts.check_daily_news.check_window_seconds', return_value=180), \
                    patch('scripts.check_daily_news.time.monotonic', side_effect=lambda: clock['elapsed']), \
                    patch('scripts.check_daily_news.time.sleep', side_effect=sleep) as sleeper, \
                    patch('scripts.check_daily_news.urlopen', side_effect=[io.BytesIO(json.dumps(x).encode()) for x in responses]) as fetch, \
                    patch('sys.stdout', new_callable=io.StringIO) as output:
                date_mock.now.side_effect = lambda tz: before + timedelta(seconds=clock['elapsed'])
                date_mock.fromtimestamp.side_effect = datetime.fromtimestamp
                with self.assertRaisesRegex(SystemExit, 'Current AI summary was not published'):
                    main()
                self.assertEqual(fetch.call_count, 6)
                self.assertEqual(sleeper.call_count, 3)
                self.assertEqual(clock['elapsed'], 180)
                self.assertEqual(output.getvalue().count('::warning::AI summary is unavailable'), 1)

    def test_headlines_keep_waiting_until_reviewed_summary_arrives(self):
        state = {'status': 'generating', 'configured': True, 'enabled': True}
        responses = [state, self.data, state, self.data, {'status': 'ready'}, self.published()]
        clock = {'elapsed': 0}
        def sleep(seconds):
            clock['elapsed'] += seconds
        with patch('scripts.check_daily_news.datetime') as date_mock, \
                patch('scripts.check_daily_news.check_window_seconds', return_value=180), \
                patch('scripts.check_daily_news.time.monotonic', side_effect=lambda: clock['elapsed']), \
                patch('scripts.check_daily_news.time.sleep', side_effect=sleep) as sleeper, \
                patch('scripts.check_daily_news.urlopen', side_effect=[io.BytesIO(json.dumps(x).encode()) for x in responses]) as fetch, \
                patch('sys.stdout', new_callable=io.StringIO) as output:
            date_mock.now.side_effect = lambda tz: self.now + timedelta(seconds=clock['elapsed'])
            date_mock.fromtimestamp.side_effect = datetime.fromtimestamp
            self.assertEqual(main(), 0)
        self.assertEqual(fetch.call_count, 6)
        self.assertEqual(sleeper.call_count, 2)
        self.assertEqual(clock['elapsed'], 120)
        self.assertEqual(output.getvalue().count('::warning::AI summary is unavailable'), 1)
        self.assertIn('Current Japan edition is publicly available.', output.getvalue())

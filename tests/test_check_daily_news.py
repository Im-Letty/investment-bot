import unittest
from copy import deepcopy
from datetime import datetime, timedelta
import io
import json
from pathlib import Path
import subprocess
import sys
from unittest.mock import patch
from news_copy_policy import COPY_LENGTH_POLICY
from scripts.check_daily_news import (JST, check_window_seconds, current_delivery,
                                     healthy_quiet_response, main, publication_observation)


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

    def official_published(self):
        previous = self.now - timedelta(days=1)
        ref = {'source': '財務省', 'title': '確認した公式発表',
               'url': 'https://www.mof.go.jp/policy/example.html',
               'published_date': previous.date().isoformat(),
               'published_at': previous.replace(hour=12).timestamp(),
               'publication_precision': 'second', 'body_sha256': 'a' * 64,
               'body_verified_at': self.now.replace(hour=7).timestamp(), 'selection_route': 'main'}
        digest = {'publication_mode': 'curated', 'lang': 'ja', 'edition_date': self.data['edition_date'],
                  'headline': '今日の公式発表', 'summary': '概' * 240,
                  'reviewed_at': self.now.replace(hour=7, minute=45).timestamp(),
                  'publish_at': self.now.timestamp(), 'article_refs': [deepcopy(ref)],
                  'article_summaries': [{**ref, 'headline': '公式発表の詳細', 'summary': '説' * 240}],
                  'source_window': {'version': 1, 'edition_date': self.data['edition_date'],
                      'window_start': previous.timestamp(),
                      'carryover_start': previous.replace(hour=7, minute=30).timestamp(),
                      'cutoff_at': self.now.replace(hour=7, minute=30).timestamp()}}
        return {**self.data, 'delivery': 'published', 'fetched_at': None,
                'digest': digest, 'news': [ref]}

    def marked_official_published(self):
        data = self.official_published()
        data['digest'].update(copy_length_policy=COPY_LENGTH_POLICY,
                              reading_structure='lead-plus-other-news-v1')
        extra = {**deepcopy(data['digest']['article_refs'][0]),
                 'title': '別の公式発表', 'url': 'https://www.mof.go.jp/policy/other.html'}
        data['news'].append(deepcopy(extra))
        data['digest']['article_refs'].append(deepcopy(extra))
        data['digest']['article_summaries'].append(
            {**extra, 'headline': '別の発表の詳細', 'summary': '別' * 240})
        return data

    def test_new_reading_structure_requires_japanese_and_reviewed_detail_order(self):
        from news_cache import _validated_digest
        base = self.marked_official_published()
        self.assertIsNotNone(_validated_digest(base['digest']))
        self.assertEqual(current_delivery(base, self.now), 'published')
        mutations = [lambda value: value['digest'].update(reading_structure='unknown'),
                     lambda value: value['digest'].update(reading_structure=None),
                     lambda value: value['digest'].pop('copy_length_policy'),
                     lambda value: value['digest'].update(lang='en'),
                     lambda value: value['digest'].pop('lang'),
                     lambda value: value['digest']['article_summaries'].reverse()]
        for mutate in mutations:
            changed = deepcopy(base)
            mutate(changed)
            with self.subTest(digest=changed['digest'].get('reading_structure')):
                self.assertIsNone(_validated_digest(changed['digest']))
                self.assertIsNone(current_delivery(changed, self.now))
        # Previously saved editions have complete coverage, but no lead/order
        # assertion. Keep their existing display and verification contract.
        old = deepcopy(base)
        old['digest'].pop('reading_structure')
        old['digest']['article_summaries'].reverse()
        self.assertIsNotNone(_validated_digest(old['digest']))
        self.assertEqual(current_delivery(old, self.now), 'published')

    def test_public_error_cannot_mask_an_otherwise_valid_reviewed_delivery(self):
        data = self.marked_official_published()
        data['error'] = 'fixture-only failure'
        self.assertIsNone(current_delivery(data, self.now))

    def test_observation_logs_actual_dates_without_copy_or_untrusted_metadata(self):
        before = self.now - timedelta(seconds=1)
        historical = self.published()
        historical['edition_date'] = historical['digest']['edition_date'] = '2026-10-03'
        historical['digest']['summary'] = 'private-copy-do-not-log'
        historical['secret'] = 'do-not-log'
        original = deepcopy(historical)
        observation = publication_observation({'status': 'prepared', 'secret': 'do-not-log'}, historical, before)
        self.assertEqual(observation['public_edition_date'], '2026-10-03')
        self.assertEqual(observation['digest_edition_date'], '2026-10-03')
        self.assertEqual(observation['public_delivery'], 'published')
        self.assertTrue(observation['public_curated_summary'])
        self.assertTrue(observation['before_scheduled_release'])
        self.assertFalse(observation['current_edition_visible_before_release'])
        self.assertNotIn('do-not-log', json.dumps(observation))
        self.assertEqual(historical, original)
        malformed = {'edition_date': '2026-02-30', 'delivery': 'do-not-log',
                     'digest': {'edition_date': '2026-1-04', 'summary': 'do-not-log'}}
        observation = publication_observation({'status': 'do-not-log'}, malformed, before)
        self.assertIsNone(observation['public_edition_date'])
        self.assertIsNone(observation['digest_edition_date'])
        self.assertEqual(observation['public_delivery'], 'unknown')
        self.assertEqual(observation['status'], 'unknown')
        self.assertNotIn('do-not-log', json.dumps(observation))

    def test_observation_flags_visible_current_curated_copy_only_before_release(self):
        current = self.marked_official_published()
        before = self.now - timedelta(seconds=1)
        self.assertTrue(publication_observation({}, current, before)['current_edition_visible_before_release'])
        self.assertFalse(publication_observation({}, current, self.now)['current_edition_visible_before_release'])
        for change_public_date in (True, False):
            mismatched = deepcopy(current)
            if change_public_date:
                mismatched['edition_date'] = '2026-10-03'
            else:
                mismatched['digest']['edition_date'] = '2026-10-03'
            self.assertTrue(publication_observation({}, mismatched, before)
                            ['current_edition_visible_before_release'])
        for changes in ({'delivery': 'rehearsal'}, {'digest': None}, {'news': []}):
            self.assertFalse(publication_observation({}, {**current, **changes}, before)
                             ['current_edition_visible_before_release'])
        current['digest']['publication_mode'] = 'draft'
        self.assertFalse(publication_observation({}, current, before)['current_edition_visible_before_release'])

    def test_observation_uses_response_time_and_reports_only_observed_delay(self):
        for seconds in (0, 21):
            clock = {'now': self.now - timedelta(seconds=1)}
            data = self.marked_official_published()
            def fetch(url, **options):
                if '/api/news-publication' in url:
                    value = {'status': 'prepared', 'private_field': 'do-not-log',
                             'articles': ['do-not-log-original']}
                else:
                    clock['now'] = self.now + timedelta(seconds=seconds)
                    value = data
                return io.BytesIO(json.dumps(value).encode())
            with self.subTest(seconds=seconds), patch('scripts.check_daily_news.datetime') as date_mock, \
                    patch('scripts.check_daily_news.check_window_seconds', return_value=1), \
                    patch('scripts.check_daily_news.time.monotonic', return_value=0), \
                    patch('scripts.check_daily_news.time.sleep') as sleeper, \
                    patch('scripts.check_daily_news.urlopen', side_effect=fetch), \
                    patch('sys.stdout', new_callable=io.StringIO) as output:
                date_mock.now.side_effect = lambda tz: clock['now']
                date_mock.strptime.side_effect = datetime.strptime
                date_mock.fromtimestamp.side_effect = datetime.fromtimestamp
                self.assertEqual(main(), 0)
                sleeper.assert_not_called()
            lines = output.getvalue().splitlines()
            observation, first = map(json.loads, lines[:2])
            self.assertEqual(observation['checked_at'], clock['now'].isoformat(timespec='seconds'))
            self.assertEqual(first['observed_at'], observation['checked_at'])
            self.assertEqual(first['seconds_since_scheduled_release'], seconds)
            self.assertFalse(first['pre_release_observed'])
            self.assertFalse(observation['before_scheduled_release'])
            self.assertEqual(observation['public_edition_date'], self.data['edition_date'])
            self.assertEqual(observation['public_delivery'], 'published')
            self.assertIn('not proof of exact 08:00 release', first['timing_note'])
            self.assertNotIn('do-not-log', output.getvalue())
            self.assertNotIn(data['digest']['summary'], output.getvalue())

    def test_pre_release_response_is_not_published_and_midnight_response_fails_closed(self):
        before = self.now - timedelta(seconds=1)
        for response_at, message in ((before, 'publicly visible before 08:00 JST'),
                (self.now + timedelta(days=1), 'Japan date changed')):
            clock = {'elapsed': 0, 'now': before}
            def fetch(url, **options):
                if '/api/news-publication' in url:
                    value = {'status': 'prepared'}
                else:
                    clock['now'] = response_at
                    value = self.marked_official_published()
                return io.BytesIO(json.dumps(value).encode())
            def sleep(seconds):
                clock['elapsed'] += seconds
            with self.subTest(response_at=response_at), patch('scripts.check_daily_news.datetime') as date_mock, \
                    patch('scripts.check_daily_news.check_window_seconds', return_value=1), \
                    patch('scripts.check_daily_news.time.monotonic', side_effect=lambda: clock['elapsed']), \
                    patch('scripts.check_daily_news.time.sleep', side_effect=sleep), \
                    patch('scripts.check_daily_news.urlopen', side_effect=fetch), \
                    patch('sys.stdout', new_callable=io.StringIO) as output:
                date_mock.now.side_effect = lambda tz: clock['now']
                date_mock.strptime.side_effect = datetime.strptime
                date_mock.fromtimestamp.side_effect = datetime.fromtimestamp
                with self.assertRaisesRegex(SystemExit, message):
                    main()
                self.assertNotIn('current_edition_first_observed', output.getvalue())
                self.assertNotIn('publicly available', output.getvalue())

    def test_first_observed_availability_records_actual_pre_release_hidden_response(self):
        before = self.now - timedelta(seconds=1)
        historical = self.published()
        historical['edition_date'] = historical['digest']['edition_date'] = '2026-10-03'
        historical['news'][0]['published_date'] = '2026-10-03'
        historical['news'][0]['published_at'] -= 86400
        current = self.marked_official_published()
        clock = {'elapsed': 0}
        def sleep(seconds):
            clock['elapsed'] += seconds
        responses = [{'status': 'prepared'}, historical, {'status': 'ready'}, current]
        with patch('scripts.check_daily_news.datetime') as date_mock, \
                patch('scripts.check_daily_news.check_window_seconds', return_value=120), \
                patch('scripts.check_daily_news.time.monotonic', side_effect=lambda: clock['elapsed']), \
                patch('scripts.check_daily_news.time.sleep', side_effect=sleep), \
                patch('scripts.check_daily_news.urlopen', side_effect=[io.BytesIO(json.dumps(x).encode()) for x in responses]), \
                patch('sys.stdout', new_callable=io.StringIO) as output:
            date_mock.now.side_effect = lambda tz: before + timedelta(seconds=clock['elapsed'])
            date_mock.strptime.side_effect = datetime.strptime
            date_mock.fromtimestamp.side_effect = datetime.fromtimestamp
            self.assertEqual(main(), 0)
        observations = [json.loads(line) for line in output.getvalue().splitlines() if line.startswith('{')]
        self.assertEqual(observations[0]['public_edition_date'], '2026-10-03')
        self.assertTrue(observations[0]['before_scheduled_release'])
        self.assertFalse(observations[0]['current_edition_visible_before_release'])
        self.assertTrue(observations[-1]['pre_release_observed'])
        self.assertEqual(observations[-1]['seconds_since_scheduled_release'], 59)

    def test_official_checker_accepts_flexible_role_bounds_without_mutating_copy(self):
        for overview_length, article_length in ((1, 1), (180, 350), (330, 440)):
            data = self.official_published()
            data['digest'].update(copy_length_policy=COPY_LENGTH_POLICY, summary='概' * overview_length)
            data['digest']['article_summaries'][0]['summary'] = '説' * article_length
            original = deepcopy(data)
            with self.subTest(overview_length=overview_length, article_length=article_length):
                self.assertEqual(current_delivery(data, self.now), 'published')
                self.assertEqual(data, original)

    def test_official_checker_preserves_legacy_limits_and_rejects_unknown_policy(self):
        legacy = self.official_published()
        self.assertEqual(current_delivery(legacy, self.now), 'published')
        for role, lengths in (('overview', (199, 301)), ('article', (199, 301))):
            for length in lengths:
                data = deepcopy(legacy)
                text = data['digest'] if role == 'overview' else data['digest']['article_summaries'][0]
                text['summary'] = '文' * length
                self.assertIsNone(current_delivery(data, self.now))
        for policy in (None, True, {}, [], 'flexible-v2'):
            data = deepcopy(legacy)
            data['digest']['copy_length_policy'] = policy
            self.assertIsNone(current_delivery(data, self.now))

    def test_flexible_checker_still_requires_nonempty_bounded_copy_and_source_contract(self):
        base = self.official_published()
        base['digest']['copy_length_policy'] = COPY_LENGTH_POLICY
        mutations = [lambda value: value['digest'].update(summary=' \n\t　'),
                     lambda value: value['digest'].update(summary='概' * 331),
                     lambda value: value['digest']['article_summaries'][0].update(summary=' \n\t　'),
                     lambda value: value['digest']['article_summaries'][0].update(summary='説' * 441),
                     lambda value: value['digest'].update(publish_at=self.now.timestamp() - 1),
                     lambda value: value['digest']['article_summaries'][0].update(body_sha256='b' * 64)]
        for mutate in mutations:
            data = deepcopy(base)
            mutate(data)
            self.assertIsNone(current_delivery(data, self.now))

    def test_direct_ci_script_can_import_shared_policy_without_running_network(self):
        path = Path(__file__).resolve().parents[1] / 'scripts' / 'check_daily_news.py'
        command = 'import runpy; runpy.run_path(' + repr(str(path)) + ', run_name="policy_import_check")'
        result = subprocess.run([sys.executable, '-I', '-B', '-c', command],
                                cwd=path.parent, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

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

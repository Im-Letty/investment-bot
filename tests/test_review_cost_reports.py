"""Job-local accounting survives failures with fixed metadata; no HTTP or AI."""
import json
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from scripts import run_intraday_news_job as intraday
from scripts import run_private_news_job as morning
from scripts.review_cost_report import safe_review_cost
from tests.test_private_news_job import Clock, ReadStorage, at
from tests.test_website_news_producer import sources
from morning_news_window import morning_window, select_articles
from news_cache import OFFICIAL_NEWS_SOURCES


PRIVATE = 'PRIVATE_COST_SENTINEL'


def summary():
    return {'scope': 'economy', 'target_jpy': 10, 'target_mode': 'soft',
        'request_count': 2, 'unknown_cost_count': 1, 'persistence_failures': 0,
        'estimated_cost_usd': '0.00125', 'estimated_cost_jpy': '0.19875',
        'usd_to_jpy': 159, 'pricing_version': '2026-10-11-text-standard',
        'estimate_complete': False, 'persistence_complete': True,
        'invoice_amount': False, 'target_state': 'unknown',
        'request_set_sha256': 'a' * 64, 'receipt_set_sha256': 'b' * 64,
        'unknown_reasons': {'usage_unavailable': 1, PRIVATE: 5},
        'providers': {'gemini': {'request_count': 1, 'unknown_cost_count': 1,
            'unknown_reasons': {'usage_unavailable': 1, PRIVATE: 1}, 'raw_response': PRIVATE},
            'openai': {'request_count': 1, 'unknown_cost_count': 0, 'estimated_cost_jpy': '0.19875',
                       'model': PRIVATE}, PRIVATE: {'request_count': 999}},
        'receipts': [{'day': '2026-10-06', 'run_context': {'github_run_id': 12345,
            'github_run_attempt': 2}, 'request_id': PRIVATE, 'tokens': {'prompt': PRIVATE},
            'model': PRIVATE, 'raw_response': PRIVATE}], 'prompt': PRIVATE}


class ReviewCostReportTests(unittest.TestCase):
    def setUp(self):
        net = patch('requests.sessions.Session.request', side_effect=AssertionError('HTTP forbidden'))
        net.start()
        self.addCleanup(net.stop)
        ai = patch('codex_news_writer.subprocess.Popen', side_effect=AssertionError('AI forbidden'))
        ai.start()
        self.addCleanup(ai.stop)

    def test_fixed_projection_keeps_unknowns_providers_and_exact_hashes_without_receipts(self):
        original = summary()
        cost = safe_review_cost(original)
        self.assertEqual(cost['unknown_cost_count'], 1)
        self.assertEqual(cost['unknown_reasons'], {'usage_unavailable': 1})
        self.assertEqual(cost['request_set_sha256'], 'a' * 64)
        self.assertEqual(cost['receipt_set_sha256'], 'b' * 64)
        self.assertEqual(cost['day'], '2026-10-06')
        self.assertEqual(cost['run_context'], {'github_run_id': 12345, 'github_run_attempt': 2})
        self.assertEqual(cost['providers']['gemini']['unknown_reasons'], {'usage_unavailable': 1})
        self.assertEqual(cost['providers']['openai']['estimated_cost_jpy'], '0.19875')
        self.assertEqual(cost['pricing_version'], '2026-10-11-text-standard')
        self.assertNotIn('receipts', cost)
        self.assertNotIn('tokens', json.dumps(cost))
        self.assertNotIn(PRIVATE, json.dumps(cost))
        cost['providers']['gemini']['request_count'] = 9
        self.assertEqual(original['providers']['gemini']['request_count'], 1)

    def test_invalid_counter_enum_date_hash_and_context_never_become_zero_or_raw(self):
        cost = safe_review_cost({'request_count': True, 'unknown_cost_count': -1,
            'estimated_cost_jpy': float('inf'), 'estimated_cost_usd': PRIVATE,
            'scope': [PRIVATE], 'pricing_version': '2026-02-30-text-standard',
            'request_set_sha256': PRIVATE, 'receipt_set_sha256': 'A' * 64,
            'run_context': {'github_run_id': PRIVATE}, 'day': '2026-02-30',
            'providers': {'gemini': {'request_count': True}}, 'raw': PRIVATE})
        self.assertEqual(cost, {'providers': {}})
        self.assertIsNone(safe_review_cost(None))
        self.assertIsNone(safe_review_cost([PRIVATE]))
        self.assertNotIn(PRIVATE, json.dumps(cost))

    def test_two_days_or_multiple_runs_are_not_invented_as_one_day_or_one_run(self):
        value = summary()
        value['receipts'].append({'day': '2026-10-07', 'run_context': {'github_run_id': 67890,
                                 'github_run_attempt': 1}})
        cost = safe_review_cost(value)
        self.assertEqual(cost['days'], ['2026-10-06', '2026-10-07'])
        self.assertNotIn('day', cost)
        self.assertTrue(cost['mixed_run_contexts'])
        self.assertNotIn('run_context', cost)

    def test_both_report_boundaries_preserve_same_aggregate_hashes_and_reason_counts(self):
        raw = {'status': 'generation_failed', 'api_review_cost': summary()}
        a = morning.safe_report(raw, at(), at() + 1)
        b = intraday.safe_report({**raw, 'status': 'review_failed'}, at(), at() + 1, False)
        self.assertEqual(a['api_review_cost'], b['api_review_cost'])
        self.assertNotIn(PRIVATE, json.dumps([a, b]))

    def morning_run(self, *, error=None, summary_error=None):
        clock = Clock(at(7, 30))
        window = morning_window(clock.now)
        manifest = {**window, 'articles': select_articles(sources(), window),
            'source_status': {name: {'feed_status': 'ok', 'status': 'collected', 'errors': []}
                              for name in OFFICIAL_NEWS_SOURCES}}
        storage = ReadStorage(manifest)
        recorder = Mock()
        recorder.safe_summary.return_value = summary()
        if summary_error is not None:
            recorder.safe_summary.side_effect = summary_error
        runtime = Mock(review_usage_recorder=recorder)
        runtime.run_once.return_value = {'status': 'prepared', 'edition_date': '2026-10-06',
                                        'publish_at': at(8), 'attempt_count': 1}
        runtime.snapshot.return_value = runtime.run_once.return_value
        if error is not None:
            runtime.run_once.side_effect = error
        env = {'SUPABASE_URL': 'https://fixture.supabase.co', 'SUPABASE_KEY': 'sb_secret_fixture',
               'GEMINI_API_KEY': 'fixture-gemini', 'OPENAI_API_KEY': 'fixture-openai'}
        progress = morning.JobProgress()
        def call():
            return morning.run_job(env, wall_clock=lambda: clock.now, monotonic=lambda: clock.mono,
                sleep=clock.sleep, storage_factory=lambda *_: storage,
                runtime_factory=lambda *_a, **_k: runtime, preflight=Mock(), progress=progress)
        with patch('scripts.run_codex_news.codex_executable', return_value='/fixture/codex'):
            if isinstance(error, morning.JobDeadline):
                with self.assertRaises(morning.JobDeadline):
                    call()
                result = morning._outcome('job_deadline', progress=progress)
            else:
                result = call()
        runtime.stop.assert_called_once()
        recorder.safe_summary.assert_called_once()
        return result, progress

    def test_morning_success_keeps_cost_without_changing_prepared_publication_outcome(self):
        result, progress = self.morning_run()
        self.assertEqual((result['status'], result['success']), ('prepared', True))
        self.assertEqual(result['api_review_cost']['request_count'], 2)
        self.assertEqual(progress.fields()['api_review_cost'], result['api_review_cost'])
        self.assertNotIn(PRIVATE, json.dumps(result))

    def test_morning_exception_and_hard_deadline_keep_run_local_cost_in_outer_progress(self):
        for error, status in ((RuntimeError(PRIVATE), 'job_unavailable'),
                              (morning.JobDeadline(), 'job_deadline')):
            with self.subTest(status=status):
                result, progress = self.morning_run(error=error)
                report = morning.safe_report(result, at(), at() + 1)
                self.assertEqual(report['status'], status)
                self.assertEqual(report['api_review_cost']['request_set_sha256'], 'a' * 64)
                self.assertEqual(progress.fields()['api_review_cost']['unknown_cost_count'], 1)
                self.assertNotIn(PRIVATE, json.dumps(report))

    def test_failed_cost_summary_does_not_change_success_or_generate_a_free_cost(self):
        for failure in (RuntimeError(PRIVATE), morning.JobDeadline()):
            with self.subTest(failure=type(failure).__name__):
                result, _progress = self.morning_run(summary_error=failure)
                self.assertEqual((result['status'], result['success']), ('prepared', True))
                self.assertEqual(result['api_review_cost'], {'status': 'cost_unavailable',
                    'scope': 'economy', 'estimate_complete': False})
                self.assertNotIn('estimated_cost_jpy', result['api_review_cost'])

    def test_intraday_failed_cost_summary_preserves_publication_status_and_progress(self):
        env = {name: 'fixture-only' for name in intraday.REQUIRED}
        env['NEWS_INTRADAY_ENABLED'] = '1'
        recorder = Mock()
        recorder.safe_summary.side_effect = RuntimeError(PRIVATE)
        progress = intraday.IntradayProgress()
        with patch('news_review_costs.ReviewUsageRecorder', return_value=recorder), \
                patch.object(intraday, 'run_intraday', return_value={'status': 'published',
                    'published_count': 1, 'eligible_count': 1}):
            result = intraday.run_job(env, clock=lambda: at(12), progress=progress,
                storage_factory=lambda *_: SimpleNamespace(), writer_factory=Mock())
        self.assertEqual(result['status'], 'published')
        self.assertEqual(result['published_count'], 1)
        self.assertEqual(result['api_review_cost']['status'], 'cost_unavailable')
        self.assertNotIn('estimated_cost_jpy', result['api_review_cost'])
        self.assertNotIn(PRIVATE, json.dumps(result))
        fields = progress.fields()
        fields['api_review_cost']['scope'] = 'company'
        self.assertEqual(progress.fields()['api_review_cost']['scope'], 'economy')


if __name__ == '__main__':
    unittest.main()

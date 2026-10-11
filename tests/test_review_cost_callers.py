"""Offline accounting injection across callers; no credentials or paid calls."""
from contextlib import redirect_stdout
from copy import deepcopy
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from codex_website_producer import CodexWebsiteProviders
from company_news_producer import CompanyProviders
from website_news_producer import WebsiteProviders
from scripts import run_codex_news as morning, run_company_news_job as company_job
from tests.test_daily_news_runtime import MemoryStorage
from tests.test_website_news_producer import ENV, MockTransport


class Recorder:
    def __init__(self):
        self.started, self.completed = [], []

    def start_request(self, **value):
        self.started.append(deepcopy(value))

    def record_request(self, **value):
        self.completed.append(deepcopy(value))

    def safe_summary(self):
        return {'scope': 'company', 'target_jpy': 10, 'target_mode': 'soft',
                'request_count': len(self.started), 'unknown_cost_count': 0,
                'estimated_cost_usd': '0.08', 'estimated_cost_jpy': '12',
                'persistence_failures': 0, 'estimate_complete': True,
                'persistence_complete': True}


class ReviewCostCallerTests(unittest.TestCase):
    def setUp(self):
        no_network = patch('requests.sessions.Session.request', side_effect=AssertionError('offline only'))
        no_network.start()
        self.addCleanup(no_network.stop)
        no_writer = patch('codex_news_writer.subprocess.Popen', side_effect=AssertionError('no AI process'))
        no_writer.start()
        self.addCleanup(no_writer.stop)

    def test_all_subclasses_record_each_review_and_token_retry_without_replaying(self):
        def usage(provider, data, response):
            if provider == 'gemini':
                response['usageMetadata'] = {'promptTokenCount': 100, 'candidatesTokenCount': 20,
                                             'thoughtsTokenCount': 5}
            else:
                response['usage'] = {'input_tokens': 100, 'output_tokens': 20}
            return response
        for cls in (WebsiteProviders, CodexWebsiteProviders, CompanyProviders):
            with self.subTest(provider=cls.__name__):
                recorder, transport = Recorder(), MockTransport(response_transform=usage)
                transport.gemini_interruptions = 1
                options = {} if cls is WebsiteProviders else {'writer': Mock()}
                provider = cls(ENV, transport.session, usage_recorder=recorder, **options)
                try:
                    provider._begin()
                    provider.gemini('offline review', {'private_body': 'not a cost field'})
                    provider.openai('offline review', {'private_body': 'not a cost field'})
                    self.assertEqual([call['provider'] for call in recorder.completed],
                                     ['gemini', 'gemini', 'openai'])
                    self.assertEqual(len({call['request_id'] for call in recorder.completed}), 3)
                    self.assertEqual([call['request_id'] for call in recorder.started],
                                     [call['request_id'] for call in recorder.completed])
                    self.assertTrue(all(call['usage'] for call in recorder.completed))
                    self.assertEqual(provider.http_counts, {'gemini': 2, 'openai': 1})
                    self.assertNotIn('private_body', json.dumps(recorder.completed))
                    self.assertEqual(len(transport.calls), 3)
                finally:
                    provider.close()

    def test_morning_reuses_its_storage_and_recorder_without_work_at_build_time(self):
        env = {'SUPABASE_URL': 'https://fixture.supabase.co', 'SUPABASE_KEY': 'sb_secret_fixture',
               'GEMINI_API_KEY': 'fixture-gemini', 'OPENAI_API_KEY': 'fixture-openai'}
        storage, recorder = MemoryStorage(), Recorder()
        with tempfile.TemporaryDirectory() as folder, \
                patch.object(morning, 'codex_executable', return_value='/fixture/codex'), \
                patch('news_review_costs.ReviewUsageRecorder', return_value=recorder) as meter, \
                patch.object(morning, 'CodexWebsiteProviders') as providers, \
                patch.object(morning, 'generate_codex_website_edition', return_value={'ready': True}):
            runtime = morning.build_runtime(env, storage=storage,
                                            cache_path=str(Path(folder) / 'cache.json'))
            meter.assert_called_once_with(storage, scope='economy')
            self.assertIs(runtime.review_usage_recorder, recorder)
            self.assertEqual(storage.created, [])
            providers.assert_not_called()
            runtime.generator(123, articles=[], source_window={})
            self.assertIs(providers.call_args.kwargs['usage_recorder'], recorder)

    def test_company_injects_same_storage_and_keeps_soft_target_summary(self):
        storage, recorder = MemoryStorage(), Recorder()
        provider = Mock(usage_recorder=recorder)
        env = {'GEMINI_API_KEY': 'fixture-gemini', 'OPENAI_API_KEY': 'fixture-openai'}
        sample = {'symbol': '9432.T'}
        def job(store, generate, **options):
            self.assertIs(store, storage)
            generate(sample, now=123, clock=lambda: 123)
            return {'status': 'no_new_release', 'published_count': 0}
        with patch.dict(os.environ, env, clear=True), \
                patch('company_news_catalogue.current_catalogue'), \
                patch.object(company_job, 'SupabaseNewsStorage', return_value=storage), \
                patch.object(company_job, 'published_economy_context', return_value=([], [])), \
                patch.object(company_job, 'run_job', side_effect=job), \
                patch('news_review_costs.ReviewUsageRecorder', return_value=recorder) as meter, \
                patch('company_news_producer.CompanyProviders', return_value=provider) as providers, \
                patch('company_news_producer.generate_company_news') as generate, \
                redirect_stdout(io.StringIO()) as output:
            self.assertEqual(company_job.main(['--run-live']), 0)
        meter.assert_called_once_with(storage, scope='company')
        providers.assert_called_once_with(usage_recorder=recorder)
        self.assertIs(generate.call_args.kwargs['providers'].usage_recorder, recorder)
        generate.assert_called_once()
        summary = json.loads(output.getvalue())['api_review_cost']
        self.assertEqual(summary, recorder.safe_summary())
        self.assertGreater(float(summary['estimated_cost_jpy']), summary['target_jpy'])


if __name__ == '__main__':
    unittest.main()

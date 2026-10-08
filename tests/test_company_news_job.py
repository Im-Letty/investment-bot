from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from company_news_runtime import PREFIX, article_id, source_fingerprint
from scripts.run_company_news_job import main, published_economy_context, run_job
from tests.test_company_news_runtime import MemoryStorage, NOW, source, record


def economy_issue(*, reviewed_at=NOW - 1800, publish_at=NOW - 1700):
    refs = [{'source': 'NHK経済', 'title': f'経済発表の記事{i}',
             'url': source()['url'] if i == 0 else f'https://example.test/economy-{i}',
             'published_at': NOW - 3600} for i in range(3)]
    return {'lang': 'ja', 'edition_date': '2026-10-08', 'headline': '朝の経済ニュースのまとめ',
            'summary': '朝の発表について説明します。' * 20,
            'publication_mode': 'curated', 'reviewed_at': reviewed_at, 'publish_at': publish_at,
            'article_refs': refs, 'article_summaries': [{**ref,
                'headline': f'独立した経済の記事{i}', 'summary': f'発表{i}について説明します。' * 22}
                for i, ref in enumerate(refs)]}


class EconomyStorage(MemoryStorage):
    def recent_days(self):
        return ['2026-10-08', '2026-10-07']
    def reviewed_keys(self, day):
        return [path for path in self.values
                if path.startswith(f'days/{day}/reviewed-')]


class CompanyJobTests(unittest.TestCase):
    def queue(self, storage, value):
        storage.create(f'{PREFIX}/candidates/2026-10-08/{source_fingerprint(value)}.json', value)

    def test_publishes_only_dually_approved_copy_once_and_retains_immutable_budget(self):
        storage, calls = MemoryStorage(), []
        self.queue(storage, source())
        def generate(src, **_):
            calls.append(src)
            return record(src)['company']
        result = run_job(storage, generate, clock=lambda: NOW)
        self.assertEqual(result['published_count'], 1)
        self.assertIsNotNone(storage.read(f'{PREFIX}/days/2026-10-08/published-1.json'))
        self.assertEqual(run_job(storage, generate, clock=lambda: NOW)['attempt_count'], 0)
        self.assertEqual(len(calls), 1)

    def test_failure_uses_one_slot_and_is_not_rebilled_later(self):
        storage, calls = MemoryStorage(), []
        self.queue(storage, source())
        def fail(src, **_):
            calls.append(src); raise RuntimeError('sk-never-output')
        result = run_job(storage, fail, clock=lambda: NOW)
        self.assertEqual(result['status'], 'review_failed')
        self.assertNotIn('sk-', str(result))
        self.assertEqual(run_job(storage, fail, clock=lambda: NOW)['attempt_count'], 0)
        self.assertEqual(run_job(storage, fail, clock=lambda: NOW + 86400)['attempt_count'], 0)
        self.assertEqual(len(calls), 1)

    def fail_first(self, storage, revision=None):
        self.queue(storage, source())
        def fail(*_, **__): raise RuntimeError('sk-never-output')
        self.assertEqual(run_job(storage, fail, clock=lambda: NOW, retry_revision=revision)['status'], 'review_failed')

    def test_normal_failed_revision_is_saved_and_same_revision_retry_is_rejected_before_ai(self):
        storage = MemoryStorage()
        self.fail_first(storage, revision='a' * 40)
        self.assertEqual(storage.read(f'{PREFIX}/days/2026-10-08/attempt-1.json')['revision'], 'a' * 40)
        self.assertEqual(storage.read(f'{PREFIX}/seen/{source_fingerprint(source())}.json')['revision'], 'a' * 40)
        def unused(*_, **__): raise AssertionError('must not invoke AI')
        result = run_job(storage, unused, clock=lambda: NOW, retry_article_id=article_id(source()),
                         retry_revision='a' * 40)
        self.assertEqual(result['retry_reason'], 'revision_unchanged')
        self.assertEqual(result['attempt_count'], 0)
        self.assertFalse(any('/retry-claims/' in path for path in storage.values))
        def corrected(src, **_): return record(src)['company']
        result = run_job(storage, corrected, clock=lambda: NOW, retry_article_id=article_id(source()),
                         retry_revision='b' * 40)
        self.assertEqual(result['published_count'], 1)

    def test_normal_claim_saves_only_valid_revision_and_legacy_claim_allows_one_corrected_retry(self):
        for invalid in (None, '', 'bad', 'A' * 40, 'a' * 41):
            with self.subTest(revision=invalid):
                storage = MemoryStorage(); self.fail_first(storage, revision=invalid)
                self.assertNotIn('revision', storage.read(f'{PREFIX}/days/2026-10-08/attempt-1.json'))
                def fail(*_, **__): raise RuntimeError('private error')
                result = run_job(storage, fail, clock=lambda: NOW, retry_article_id=article_id(source()),
                                 retry_revision='b' * 40)
                self.assertEqual(result['attempt_count'], 1)
                repeat = run_job(storage, fail, clock=lambda: NOW, retry_article_id=article_id(source()),
                                 retry_revision='b' * 40)
                self.assertEqual(repeat['retry_reason'], 'retry_already_claimed')

    def test_manual_corrected_revision_preserves_seen_and_uses_next_daily_slot(self):
        storage, calls = MemoryStorage(), []
        self.fail_first(storage)
        original_seen = storage.read(f'{PREFIX}/seen/{source_fingerprint(source())}.json')
        original_attempt = storage.read(f'{PREFIX}/days/2026-10-08/attempt-1.json')
        def generate(src, **_): calls.append(src); return record(src)['company']
        result = run_job(storage, generate, clock=lambda: NOW, retry_article_id=article_id(source()),
                         retry_revision='a' * 40)
        self.assertEqual(result['published_count'], 1)
        self.assertEqual(result['attempt_count'], 1)
        self.assertEqual(storage.read(f'{PREFIX}/seen/{source_fingerprint(source())}.json'), original_seen)
        self.assertEqual(storage.read(f'{PREFIX}/days/2026-10-08/attempt-1.json'), original_attempt)
        attempt = storage.read(f'{PREFIX}/days/2026-10-08/attempt-2.json')
        self.assertEqual(attempt['retry_of'], 1)
        self.assertEqual(attempt['revision'], 'a' * 40)
        self.assertIsNotNone(storage.read(f'{PREFIX}/days/2026-10-08/published-2.json'))
        self.assertEqual(len([key for key in storage.values if '/retry-claims/' in key]), 1)
        repeated = run_job(storage, generate, clock=lambda: NOW, retry_article_id=article_id(source()),
                           retry_revision='b' * 40)
        self.assertEqual(repeated['retry_reason'], 'already_published')
        self.assertEqual(len(calls), 1)

    def test_failed_manual_revision_is_never_rebilled_and_all_retries_share_three_slots(self):
        storage, calls = MemoryStorage(), []
        self.fail_first(storage)
        def fail(*_, **__): calls.append(1); raise RuntimeError('private error')
        args = {'clock': lambda: NOW, 'retry_article_id': article_id(source())}
        self.assertEqual(run_job(storage, fail, **args, retry_revision='a' * 40)['attempt_count'], 1)
        duplicate = run_job(storage, fail, **args, retry_revision='a' * 40)
        self.assertEqual(duplicate['retry_reason'], 'retry_already_claimed')
        self.assertEqual(run_job(storage, fail, clock=lambda: NOW)['attempt_count'], 0)
        self.assertEqual(run_job(storage, fail, **args, retry_revision='b' * 40)['attempt_count'], 1)
        capped = run_job(storage, fail, **args, retry_revision='c' * 40)
        self.assertEqual(capped['retry_reason'], 'daily_attempt_limit')
        self.assertEqual(capped['attempt_count'], 0)
        self.assertEqual(len(calls), 2)
        self.assertEqual(len([key for key in storage.values if '/attempt-' in key]), 3)

    def test_concurrent_same_revision_manual_requests_use_only_one_paid_slot(self):
        class RaceStorage(MemoryStorage):
            barrier = threading.Barrier(2)
            def create(self, path, value):
                if '/retry-claims/' in path:
                    self.barrier.wait(timeout=2)
                return super().create(path, value)
        storage, calls = RaceStorage(), []
        self.fail_first(storage)
        def generate(src, **_): calls.append(src); return record(src)['company']
        def request():
            return run_job(storage, generate, clock=lambda: NOW, retry_article_id=article_id(source()),
                           retry_revision='a' * 40)
        with ThreadPoolExecutor(max_workers=2) as pool:
            first, second = pool.submit(request), pool.submit(request)
            results = [first.result(), second.result()]
        self.assertEqual(sum(result['attempt_count'] for result in results), 1)
        self.assertEqual(sum(result['published_count'] for result in results), 1)
        self.assertEqual(len(calls), 1)
        self.assertEqual(len([key for key in storage.values if '/attempt-' in key]), 2)

    def test_failed_review_code_is_safe_reported_without_original_provider_text(self):
        from daily_news_producer import GenerationError
        storage = MemoryStorage(); self.queue(storage, source())
        def fail(*_, **__): raise GenerationError('company_review_failed_gemini_facts')
        result = run_job(storage, fail, clock=lambda: NOW)
        self.assertEqual(result['last_error'], 'company_review_failed_gemini_facts')

    def test_failure_copy_diagnostic_is_separate_from_fixed_report(self):
        from company_news_producer import CHECKS
        from daily_news_producer import GenerationError
        from tests.test_company_news_producer import COPY
        storage = MemoryStorage(); self.queue(storage, source())
        diagnostics = []
        def fail(*_, **__):
            error = GenerationError('company_review_failed_gemini_facts')
            error.company_diagnostic = {'draft': COPY,
                'checks': {name: {key: True for key in CHECKS} for name in ('gemini', 'openai')}}
            raise error
        result = run_job(storage, fail, clock=lambda: NOW, diagnostics=diagnostics)
        self.assertEqual(len(diagnostics), 1)
        self.assertEqual(diagnostics[0]['draft'], COPY)
        self.assertNotIn('draft', json.dumps(result))
        self.assertIsNone(storage.read(f'{PREFIX}/days/2026-10-08/published-1.json'))

    def test_retry_requires_today_failed_result_exact_body_and_original_seen(self):
        def unused(*_, **__): raise AssertionError('must not invoke AI')
        for change in ('no_result', 'wrong_fingerprint', 'no_seen', 'published', 'yesterday'):
            with self.subTest(change=change):
                storage = MemoryStorage(); self.fail_first(storage)
                clock = NOW
                if change == 'no_result': storage.values.pop(f'{PREFIX}/days/2026-10-08/result-1.json')
                if change == 'wrong_fingerprint':
                    storage.values[f'{PREFIX}/days/2026-10-08/attempt-1.json']['fingerprint'] = 'b' * 64
                if change == 'no_seen': storage.values.pop(f'{PREFIX}/seen/{source_fingerprint(source())}.json')
                if change == 'published': storage.create(f'{PREFIX}/days/2026-10-08/published-1.json', record())
                if change == 'yesterday': clock += 86400
                result = run_job(storage, unused, clock=lambda: clock, retry_article_id=article_id(source()),
                                 retry_revision='a' * 40)
                self.assertEqual(result['status'], 'retry_not_allowed')
                self.assertEqual(result['attempt_count'], 0)
                self.assertFalse(any('/retry-claims/' in path for path in storage.values))

    def test_invalid_retry_input_is_rejected_before_storage_or_provider_work(self):
        def unused(*_, **__): raise AssertionError('must not invoke AI')
        for identifier, revision in [('a' * 63, 'a' * 40), ('A' * 64, 'a' * 40),
                                     ('a' * 64, None), ('a' * 64, 'z' * 40), ('a' * 64, 'a' * 41)]:
            with self.subTest(identifier=identifier, revision=revision):
                storage = MemoryStorage()
                storage.ensure_private = lambda: (_ for _ in ()).throw(AssertionError('must not read storage'))
                result = run_job(storage, unused, clock=lambda: NOW, retry_article_id=identifier,
                                 retry_revision=revision)
                self.assertEqual(result['status'], 'retry_not_allowed')

    def test_cli_manual_retry_requires_explicit_workflow_input_and_trusted_revision(self):
        identifier = article_id(source())
        cases = [{}, {'GITHUB_EVENT_NAME': 'schedule'},
                 {'GITHUB_EVENT_NAME': 'workflow_dispatch', 'COMPANY_MANUAL_RETRY_ARTICLE_ID': 'b' * 64},
                 {'GITHUB_EVENT_NAME': 'workflow_dispatch', 'COMPANY_MANUAL_RETRY_ARTICLE_ID': identifier,
                  'COMPANY_NEWS_SOURCE_REVISION': 'bad'}]
        for environment in cases:
            with self.subTest(environment=environment), patch.dict(os.environ, environment, clear=True), \
                    patch('scripts.run_company_news_job.SupabaseNewsStorage') as storage, \
                    redirect_stdout(io.StringIO()) as output:
                code = main(['--run-live', '--retry-article-id', identifier])
            self.assertEqual(code, 2)
            self.assertEqual(json.loads(output.getvalue())['retry_reason'], 'workflow_input_required')
            storage.assert_not_called()

    def test_manual_workflow_input_is_passed_once_and_default_broker_has_no_retry(self):
        identifier = article_id(source())
        environment = {'GITHUB_EVENT_NAME': 'workflow_dispatch', 'COMPANY_MANUAL_RETRY_ARTICLE_ID': identifier,
                       'COMPANY_NEWS_SOURCE_REVISION': 'a' * 40}
        with patch.dict(os.environ, environment, clear=True), \
                patch('scripts.run_company_news_job.SupabaseNewsStorage'), \
                patch('scripts.run_company_news_job.published_economy_context', return_value=([], [])), \
                patch('scripts.run_company_news_job.run_job', return_value={'status': 'no_new_release'}) as job, \
                redirect_stdout(io.StringIO()):
            self.assertEqual(main(['--run-live', '--retry-article-id', identifier]), 0)
            self.assertEqual(job.call_args.kwargs['retry_article_id'], identifier)
            self.assertEqual(job.call_args.kwargs['retry_revision'], 'a' * 40)
            self.assertEqual(main(['--run-live']), 0)
            self.assertIsNone(job.call_args.kwargs['retry_article_id'])

    def test_daily_limit_counts_failures_and_successes_without_unlimited_retries(self):
        storage, calls = MemoryStorage(), []
        for symbol in ('9432.T', '9433.T', '6752.T'): self.queue(storage, source(symbol))
        def generate(src, **_): calls.append(src); return record(src)['company']
        self.assertEqual(run_job(storage, generate, clock=lambda: NOW)['attempt_count'], 3)
        self.queue(storage, source(suffix='b'))
        self.assertEqual(run_job(storage, generate, clock=lambda: NOW)['attempt_count'], 0)
        self.assertEqual(len(calls), 3)

    def test_changed_or_mismatched_copy_is_not_published(self):
        storage = MemoryStorage(); self.queue(storage, source())
        def mismatched(src, **_):
            company = record(src)['company']; company['title'] += '成功'; return company
        result = run_job(storage, mismatched, clock=lambda: NOW)
        self.assertEqual(result['published_count'], 0)
        self.assertIsNone(storage.read(f'{PREFIX}/days/2026-10-08/published-1.json'))

    def test_same_article_as_economy_section_has_no_writer_or_review_cost(self):
        storage = MemoryStorage(); self.queue(storage, source())
        def unused(*_, **__): raise AssertionError('must not invoke AI')
        result = run_job(storage, unused, clock=lambda: NOW, exclusion_urls=[source()['url']])
        self.assertEqual(result['attempt_count'], 0)

    def test_normal_edition_json_supplies_all_three_reviewed_topics_and_overlap_urls(self):
        storage, issue = EconomyStorage(), economy_issue()
        storage.create('days/2026-10-08/edition.json', issue)
        self.queue(storage, source())
        with tempfile.TemporaryDirectory() as temp:
            baseline = Path(temp) / 'news.json'; baseline.write_text('[]')
            excluded, other = published_economy_context(storage, NOW, baseline_path=baseline)
        self.assertIn(source()['url'], excluded)
        self.assertEqual(other, [{key: detail[key] for key in ('headline', 'summary')}
                                 for detail in issue['article_summaries']])
        self.assertEqual(len(other), 3)
        def unused(*_, **__): raise AssertionError('must not invoke AI')
        self.assertEqual(run_job(storage, unused, clock=lambda: NOW, exclusion_urls=excluded,
                                 other_news=other)['attempt_count'], 0)

    def test_future_or_invalid_revision_cannot_replace_actual_published_context(self):
        storage, issue = EconomyStorage(), economy_issue()
        storage.create('days/2026-10-08/edition.json', issue)
        future = economy_issue(reviewed_at=NOW - 30, publish_at=NOW + 60)
        future['article_summaries'][2]['headline'] = 'まだ公開されていない記事'
        storage.create('days/2026-10-08/reviewed-00000000000000000001.json', future)
        damaged = deepcopy(issue); damaged['article_summaries'][2]['url'] = 'https://evil.example/mismatched'
        storage.create('days/2026-10-08/reviewed-00000000000000000002.json', damaged)
        with tempfile.TemporaryDirectory() as temp:
            baseline = Path(temp) / 'news.json'; baseline.write_text('[]')
            excluded, other = published_economy_context(storage, NOW, baseline_path=baseline)
        self.assertEqual(len(excluded), 3)
        self.assertEqual(other[2]['headline'], issue['article_summaries'][2]['headline'])

    def test_latest_published_revision_wins_on_same_edition_date(self):
        storage, issue = EconomyStorage(), economy_issue()
        storage.create('days/2026-10-08/edition.json', issue)
        latest = economy_issue(reviewed_at=NOW - 300, publish_at=NOW - 200)
        latest['article_summaries'][2]['headline'] = '公開済みの修正した記事'
        storage.create('days/2026-10-08/reviewed-00000000000000000001.json', latest)
        with tempfile.TemporaryDirectory() as temp:
            baseline = Path(temp) / 'news.json'; baseline.write_text('[]')
            _, other = published_economy_context(storage, NOW, baseline_path=baseline)
        self.assertEqual(other[2]['headline'], latest['article_summaries'][2]['headline'])

    def test_overlap_storage_failure_is_safe_reported_before_any_ai(self):
        storage, output = EconomyStorage(), io.StringIO()
        storage.recent_days = lambda: (_ for _ in ()).throw(RuntimeError('sk-private-untrusted-error'))
        with patch('scripts.run_company_news_job.SupabaseNewsStorage', return_value=storage), \
                patch('company_news_producer.generate_company_news') as generate, redirect_stdout(output):
            code = main(['--run-live'])
        self.assertEqual(code, 1)
        result = json.loads(output.getvalue())
        self.assertEqual(result['status'], 'storage_unavailable')
        self.assertEqual(result['published_count'], 0)
        self.assertNotIn('sk-private', output.getvalue())
        generate.assert_not_called()

    def test_outer_deadline_also_covers_overlap_reads_and_reports_safely(self):
        from scripts.run_private_news_job import JobDeadline
        output = io.StringIO()
        with patch('scripts.run_private_news_job.process_deadline', side_effect=JobDeadline), \
                patch('scripts.run_company_news_job.SupabaseNewsStorage') as storage, \
                patch('company_news_producer.generate_company_news') as generate, redirect_stdout(output):
            code = main(['--run-live'])
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(output.getvalue())['status'], 'job_deadline')
        storage.assert_not_called(); generate.assert_not_called()


if __name__ == '__main__':
    unittest.main()

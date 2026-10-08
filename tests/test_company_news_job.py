from copy import deepcopy
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from company_news_runtime import PREFIX, source_fingerprint
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

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

    def test_publication_receipt_observes_success_after_upload_and_contains_closed_metadata_only(self):
        clock = [NOW]
        class UploadStorage(MemoryStorage):
            def create(self, path, value):
                created = super().create(path, value)
                if '/published-' in path and created:
                    clock[0] += 9
                return created
        storage = UploadStorage()
        src = source(); src['published_at'] = NOW - 3600
        self.queue(storage, src)
        def generate(src, **_):
            company = record(src)['company']
            company['private_draft'] = 'PRIVATE DRAFT MUST NOT BE REPORTED'
            for review in company['reviews'].values():
                review['raw_response'] = 'sk-PRIVATE PROVIDER RESPONSE'
            return company
        result = run_job(storage, generate, clock=lambda: clock[0])
        self.assertEqual(result['published_count'], 1)
        self.assertEqual(len(result['publication_receipts']), 1)
        receipt = result['publication_receipts'][0]
        saved = storage.read(f'{PREFIX}/days/2026-10-08/published-1.json')['company']
        self.assertEqual(set(receipt), {'article_id', 'symbol', 'source', 'source_url',
            'published_date', 'published_at', 'body_sha256', 'content_sha256', 'source_sha256',
            'reviewed_at', 'publication_confirmed_at', 'reviews'})
        self.assertEqual(receipt['publication_confirmed_at'], NOW + 9)
        self.assertEqual(receipt['source'], 'NTT')
        self.assertEqual(receipt['published_date'], '2026-10-08')
        self.assertEqual(receipt['published_at'], NOW - 3600)
        for key in ('article_id', 'symbol', 'source_url', 'body_sha256',
                    'content_sha256', 'source_sha256', 'reviewed_at'):
            self.assertEqual(receipt[key], saved[key])
        for provider in ('gemini', 'openai'):
            self.assertEqual(receipt['reviews'][provider], {'approved': True,
                'content_sha256': receipt['content_sha256'], 'source_sha256': receipt['source_sha256']})
        encoded = json.dumps(result)
        for private in (src['body'], saved['title'], saved['business'], saved['event'], saved['outlook'],
                        'PRIVATE DRAFT', 'PRIVATE PROVIDER', 'raw_response', 'collection_channel'):
            self.assertNotIn(private, encoded)

    def test_publication_receipt_keeps_verified_prtimes_identity_without_asserting_individual_feed_origin(self):
        from hashlib import sha256
        from company_news_catalogue import load_catalogue
        from tests.test_company_news_runtime import catalogue_bound_record
        saved, document = catalogue_bound_record()
        document['items'][-1] = {'code': '9531', 'symbol': '9531.T', 'name': '東京瓦斯'}
        catalogue = load_catalogue(snapshot=document, editorial_path=None, now=NOW)
        src = saved['source']
        body = '東京ガス株式会社は、検証専用の架空設備を開発すると発表しました。' + source()['body'] * 2
        src.update(symbol='9531.T', name='東京瓦斯', source='PR TIMES', company_id='21766',
            related_company='東京ガス株式会社', body=body, body_sha256=sha256(body.encode()).hexdigest(),
            business=body[:1800], url='https://prtimes.jp/main/html/rd/p/000000001.000021766.html',
            catalogue_facts_sha256=catalogue.facts_sha256)
        storage = MemoryStorage()
        storage.create(f'{PREFIX}/catalogues/{src["catalogue_facts_sha256"]}/{src["catalogue_source_sha256"]}.json', document)
        self.queue(storage, src)
        result = run_job(storage, lambda src, **_: record(src)['company'], clock=lambda: NOW)
        self.assertEqual(result['published_count'], 1)
        receipt = result['publication_receipts'][0]
        self.assertEqual(receipt['source'], 'PR TIMES')
        self.assertEqual(receipt['company_id'], '21766')
        self.assertEqual(receipt['source_url'], src['url'])
        self.assertIsNone(receipt['published_at'])
        self.assertNotIn('collection_channel', receipt)
        self.assertNotIn('feed_url', receipt)

    def test_approved_day_only_copy_without_optional_clock_keeps_successful_receipt(self):
        storage = MemoryStorage(); self.queue(storage, source())
        def generate(src, **_):
            company = record(src)['company']
            company.pop('published_at')
            return company
        result = run_job(storage, generate, clock=lambda: NOW)
        self.assertEqual(result['status'], 'published')
        self.assertEqual(result['published_count'], 1)
        self.assertNotIn('last_error', result)
        self.assertEqual(len(result['publication_receipts']), 1)
        self.assertIsNone(result['publication_receipts'][0]['published_at'])
        saved = storage.read(f'{PREFIX}/days/2026-10-08/published-1.json')
        self.assertNotIn('published_at', saved['company'])

    def test_failed_review_conflicting_upload_and_upload_failure_have_no_publication_receipt(self):
        for failure in ('review', 'mismatched_copy', 'conflict', 'upload'):
            with self.subTest(failure=failure):
                class FailStorage(MemoryStorage):
                    def create(self, path, value):
                        if '/published-' in path:
                            if failure == 'conflict':
                                return False
                            if failure == 'upload':
                                raise RuntimeError('sk-PRIVATE STORAGE ERROR')
                        return super().create(path, value)
                storage = FailStorage(); self.queue(storage, source())
                def generate(src, **_):
                    if failure == 'review':
                        raise RuntimeError('sk-PRIVATE REVIEW ERROR')
                    company = record(src)['company']
                    if failure == 'mismatched_copy':
                        company['event'] += '審査されていない変更です。'
                    return company
                result = run_job(storage, generate, clock=lambda: NOW)
                self.assertEqual(result['published_count'], 0)
                self.assertEqual(result['publication_receipts'], [])
                self.assertNotIn('sk-PRIVATE', json.dumps(result))

    def test_day_rollover_before_or_during_upload_cannot_produce_a_confirmation_receipt(self):
        for during_upload in (False, True):
            with self.subTest(during_upload=during_upload):
                clock = [NOW]
                class MidnightStorage(MemoryStorage):
                    def create(self, path, value):
                        created = super().create(path, value)
                        if '/published-' in path and created and during_upload:
                            clock[0] = NOW + 13 * 3600  # next JST day, after create
                        return created
                storage = MidnightStorage(); self.queue(storage, source())
                def generate(src, **_):
                    if not during_upload:
                        clock[0] = NOW + 13 * 3600
                    return record(src)['company']
                result = run_job(storage, generate, clock=lambda: clock[0])
                self.assertEqual(result['publication_receipts'], [])
                self.assertEqual(result['published_count'], 1 if during_upload else 0)

    def test_partial_publication_receipts_cover_only_successful_independent_copies(self):
        storage = MemoryStorage()
        for symbol in ('9432.T', '9433.T', '6752.T'):
            self.queue(storage, source(symbol))
        def generate(src, **_):
            if src['symbol'] == '9433.T':
                raise RuntimeError('sk-PRIVATE REJECTION')
            return record(src)['company']
        result = run_job(storage, generate, clock=lambda: NOW)
        self.assertEqual(result['published_count'], 2)
        self.assertEqual(result['attempt_count'], 3)
        self.assertEqual({item['symbol'] for item in result['publication_receipts']}, {'9432.T', '6752.T'})
        self.assertNotIn(article_id(source('9433.T')), json.dumps(result))

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
            self.assertEqual(json.loads(output.getvalue())['processing_kind'], 'manual_retry')
            storage.assert_not_called()

    def test_manual_workflow_input_is_passed_once_and_default_broker_has_no_retry(self):
        identifier = article_id(source())
        environment = {'GITHUB_EVENT_NAME': 'workflow_dispatch', 'COMPANY_MANUAL_RETRY_ARTICLE_ID': identifier,
                       'COMPANY_NEWS_SOURCE_REVISION': 'a' * 40}
        with patch.dict(os.environ, environment, clear=True), \
                patch('scripts.run_company_news_job.SupabaseNewsStorage'), \
                patch('scripts.run_company_news_job.published_economy_context', return_value=([], [])), \
                patch('scripts.run_company_news_job.run_job', return_value={'status': 'no_new_release'}) as job, \
                redirect_stdout(io.StringIO()) as output:
            self.assertEqual(main(['--run-live', '--retry-article-id', identifier]), 0)
            self.assertEqual(json.loads(output.getvalue())['processing_kind'], 'manual_retry')
            self.assertEqual(job.call_args.kwargs['retry_article_id'], identifier)
            self.assertEqual(job.call_args.kwargs['retry_revision'], 'a' * 40)
            output.seek(0); output.truncate(0)
            self.assertEqual(main(['--run-live']), 0)
            self.assertEqual(json.loads(output.getvalue())['processing_kind'], 'normal')
            self.assertIsNone(job.call_args.kwargs['retry_article_id'])

    def test_cli_fixed_result_reports_only_valid_source_revision_not_arbitrary_environment(self):
        valid = 'a' * 40
        for revision in (valid, None, '', 'A' * 40, 'a' * 41, 'a' * 64, 'sk-PRIVATE VERSION INPUT'):
            with self.subTest(revision=revision), tempfile.TemporaryDirectory() as temp:
                environment = {'SUPABASE_KEY': 'sk-PRIVATE STORAGE CREDENTIAL',
                               'UNRELATED_SETTING': 'PRIVATE ENV VALUE'}
                if revision is not None:
                    environment['COMPANY_NEWS_SOURCE_REVISION'] = revision
                payload = {'status': 'no_new_release', 'day': '2026-10-08', 'published_count': 0,
                           'attempt_count': 0, 'publication_receipts': []}
                path = Path(temp) / 'result.json'
                with patch.dict(os.environ, environment, clear=True), \
                        patch('scripts.run_company_news_job.SupabaseNewsStorage'), \
                        patch('scripts.run_company_news_job.published_economy_context', return_value=([], [])), \
                        patch('scripts.run_company_news_job.run_job', side_effect=lambda *_, **__: deepcopy(payload)), \
                        redirect_stdout(io.StringIO()) as output:
                    self.assertEqual(main(['--run-live', '--result-file', str(path)]), 0)
                result = json.loads(output.getvalue())
                self.assertEqual(json.loads(path.read_text()), result)
                self.assertEqual(result['processing_kind'], 'normal')
                if revision == valid:
                    self.assertEqual(result['source_revision'], valid)
                else:
                    self.assertNotIn('source_revision', result)
                for private in ('sk-PRIVATE', 'PRIVATE ENV VALUE', 'SUPABASE_KEY', 'UNRELATED_SETTING'):
                    self.assertNotIn(private, output.getvalue())

    def test_daily_limit_counts_failures_and_successes_without_unlimited_retries(self):
        storage, calls = MemoryStorage(), []
        for symbol in ('9432.T', '9433.T', '6752.T'): self.queue(storage, source(symbol))
        def generate(src, **_): calls.append(src); return record(src)['company']
        result = run_job(storage, generate, clock=lambda: NOW)
        self.assertEqual(result['attempt_count'], 3)
        self.assertEqual(result['published_count'], 3)
        self.assertEqual(len(result['publication_receipts']), 3)
        self.queue(storage, source(suffix='b'))
        self.assertEqual(run_job(storage, generate, clock=lambda: NOW)['attempt_count'], 0)
        self.assertEqual(len(calls), 3)

    def test_changed_or_mismatched_copy_is_not_published(self):
        storage = MemoryStorage(); self.queue(storage, source())
        def mismatched(src, **_):
            company = record(src)['company']; company['title'] += '成功'; return company
        result = run_job(storage, mismatched, clock=lambda: NOW)
        self.assertEqual(result['published_count'], 0)
        self.assertEqual(result['publication_receipts'], [])
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
        self.assertEqual(result['processing_kind'], 'normal')
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
        self.assertEqual(json.loads(output.getvalue())['processing_kind'], 'normal')
        storage.assert_not_called(); generate.assert_not_called()


if __name__ == '__main__':
    unittest.main()

"""Offline publication contract and full morning flow, without paid calls."""
from copy import deepcopy
from datetime import datetime
from hashlib import sha256
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from daily_news_producer import CHECKS, generate_edition
from daily_news_runtime import DailyNewsRuntime
from morning_news_window import MorningNewsPreparer, morning_window
from news_cache import JST, PUBLISHED_NEWS_SOURCES, _validated_digest, select_daily_news
from news_initial import initial_news, render_news_markup
from scripts.check_daily_news import current_delivery
from tests.test_daily_news_runtime import MemoryStorage, issue as legacy_issue
from website_news import collect_website_sources, website_news


def stamp(day='2026-10-06', hour=8, minute=0, second=0):
    return datetime.fromisoformat(day).replace(hour=hour, minute=minute, second=second, tzinfo=JST).timestamp()


def source(precision='second'):
    body = '政府が発表した内容を確認するためのテスト用の原文です。' * 20
    return {'source': '財務省', 'title': '公式発表のテスト',
            'url': 'https://www.mof.go.jp/policy/international_policy/convention/dialogue/20261005120000.html',
            'evidence_url': 'https://www.mof.go.jp/policy/international_policy/convention/dialogue/20261005120000.html',
            'published_at': stamp('2026-10-05', 12) if precision == 'second' else None,
            'published_date': '2026-10-05', 'publication_precision': precision,
            'body': body, 'body_sha256': sha256(body.encode()).hexdigest(),
            'body_verified_at': stamp(hour=7, minute=29),
            'selection_route': 'main' if precision == 'second' else 'date_only'}


def edition(precision='second'):
    ref = {key: value for key, value in source(precision).items() if key not in ('body', 'evidence_url')}
    return {'edition_date': '2026-10-06', 'publication_mode': 'curated', 'lang': 'ja',
            'headline': '経済の新しい発表', 'summary': '要' * 230,
            'reviewed_at': stamp(hour=7, minute=35), 'publish_at': stamp(),
            'source_window': morning_window(stamp()), 'article_refs': [ref],
            'article_summaries': [{**ref, 'headline': '発表のポイント', 'summary': '詳' * 250}]}


class PublicationTests(unittest.TestCase):
    def selected(self, value, now=None):
        return select_daily_news(website_news.snapshot(), now or stamp(),
                                 allowed_sources=PUBLISHED_NEWS_SOURCES, reviewed_digests=[value])

    def test_actual_dates_survive_python_html_and_ci_check(self):
        for precision in ('second', 'day'):
            with self.subTest(precision=precision):
                value = edition(precision)
                self.assertEqual(_validated_digest(value), value)
                data = initial_news(website_news.snapshot(), now=stamp(), reviewed_digests=[value])
                self.assertEqual(data['edition_date'], '2026-10-06')
                self.assertEqual(data['news'][0]['published_date'], '2026-10-05')
                self.assertEqual(current_delivery(data, datetime.fromtimestamp(stamp(), JST)), 'published')
                html = render_news_markup(data)
                self.assertIn('発表 2026/10/5', html)
                self.assertIn('当サイトが要約・編集', html)
                if precision == 'day':
                    self.assertNotIn('00:00', html)

    def test_invalid_source_provenance_is_rejected_consistently(self):
        invalid = [{'source': []}, {'source': '日本銀行'}, {'url': 'https://evil.test/news'},
                   {'url': 'https://www.mof.go.jp:bad/test'}, {'body_sha256': 'wrong'},
                   {'body_verified_at': stamp(hour=7, minute=30, second=1)},
                   {'published_date': '2026-10-06'}, {'publication_precision': 'unknown'},
                   {'selection_route': 'carryover'}, {'deferred_from': '2026-10-05'}]
        for changes in invalid:
            with self.subTest(changes=changes):
                value = edition()
                value['article_refs'][0].update(changes)
                value['article_summaries'][0].update(changes)
                self.assertIsNone(_validated_digest(value))
                data = {'policy_version': 4, 'lang': 'ja', 'delivery': 'published',
                        'selection_status': 'ready', 'edition_date': '2026-10-06',
                        'news': value['article_refs'], 'digest': value}
                self.assertIsNone(current_delivery(data, datetime.fromtimestamp(stamp(), JST)))

    def test_review_release_and_detail_are_bound_to_frozen_version(self):
        for change in ('early_review', 'early_release', 'window', 'hash'):
            with self.subTest(change=change):
                value = edition()
                if change == 'early_review': value['reviewed_at'] = stamp(hour=7, minute=29)
                if change == 'early_release': value['publish_at'] = stamp(hour=7, minute=59)
                if change == 'window': value['source_window']['cutoff_at'] += 1
                if change == 'hash': value['article_summaries'][0]['body_sha256'] = 'b' * 64
                self.assertIsNone(_validated_digest(value))

    def test_checker_requires_readable_copy_not_only_publication_metadata(self):
        for target in ('digest', 'detail'):
            for field in ('headline', 'summary'):
                with self.subTest(target=target, field=field):
                    value = edition()
                    del (value if target == 'digest' else value['article_summaries'][0])[field]
                    data = {'policy_version': 4, 'lang': 'ja', 'delivery': 'published',
                            'selection_status': 'ready', 'edition_date': '2026-10-06',
                            'news': value['article_refs'], 'digest': value}
                    self.assertIsNone(current_delivery(data, datetime.fromtimestamp(stamp(), JST)))

    def test_late_verification_cannot_be_claimed_before_previous_cutoff(self):
        value = edition()
        for ref in value['article_refs'] + value['article_summaries']:
            ref.update(published_at=stamp('2026-10-04', 12), published_date='2026-10-04',
                       body_verified_at=stamp('2026-10-05', 7), selection_route='deferred',
                       deferred_from='2026-10-05', deferred_reason='late_verification')
        self.assertIsNone(_validated_digest(value))
        for ref in value['article_refs'] + value['article_summaries']:
            ref['body_verified_at'] = stamp('2026-10-05', 7, 31)
        self.assertIsNotNone(_validated_digest(value))

    def test_collection_wrapper_never_calls_unapproved_boj_source(self):
        with patch('website_news.collect_official_articles', return_value=[]) as collector:
            collect_website_sources(stamp(hour=7), since=1, until=2, diagnostics={})
        self.assertEqual(collector.call_args.kwargs['enabled_sources'], ('総務省統計局', '財務省'))


class MorningFlowTests(unittest.TestCase):
    def test_verified_supporting_pdf_stays_in_frozen_evidence_and_out_of_public_output(self):
        now = [stamp(hour=7)]
        record = source()
        html_body = record['body']
        pdf_body = ('VERIFIED_PDF_ORIGINAL_ONLY: This fixture represents the complete signed document.\n'
                    'The parties signed this example document on 2 October 2026.\n')
        combined = html_body + '\n\n【確認済み添付PDF本文】\n' + pdf_body
        supporting = [{'url': 'https://www.mof.go.jp/policy/international_policy/convention/dialogue/test-mou.pdf',
                       'parent_url': record['url'], 'title': '確認済み覚書（英語・試験用）',
                       'body_sha256': sha256(pdf_body.encode()).hexdigest(),
                       'document_date': '2026-10-02', 'document_date_kind': 'signed'}]
        record.update(body=combined, body_sha256=sha256(combined.encode()).hexdigest(),
                      supporting_documents=supporting,
                      source_scope='official_html_with_verified_supporting_pdf')
        collected = []
        def collect(started, **options):
            collected.append(started)
            options['diagnostics'].update({name: {'feed_status': 'ok', 'status': 'collected'}
                                           for name in ('総務省統計局', '財務省')})
            return [{**deepcopy(record), 'body_verified_at': now[0]}]
        storage = MemoryStorage()
        preparer = MorningNewsPreparer(storage, collect, clock=lambda: now[0])
        provider = Mock()
        provider.claude.return_value = {'headline': '経済の新しい発表', 'summary': '要' * 230,
            'articles': [{'index': 0, 'headline': '発表のポイント', 'summary': '詳' * 250}]}
        approval = {'approved': True, 'checks': {key: True for key in CHECKS}, 'issues': []}
        provider.gemini.return_value = approval
        provider.openai.return_value = approval
        with patch('requests.sessions.Session.request', side_effect=AssertionError('network disabled')):
            for minute in (0, 5, 10, 15, 20, 25, 29):
                now[0] = stamp(hour=7, minute=minute)
                self.assertIsNone(preparer.prepare(now[0]))
            now[0] = stamp(hour=7, minute=30)
            frozen = preparer.prepare(now[0])
            self.assertEqual(frozen['articles'][0]['body'], combined)
            self.assertEqual(frozen['articles'][0]['supporting_documents'], supporting)
            self.assertEqual(frozen['articles'][0]['source_scope'], record['source_scope'])
            before = deepcopy(frozen)
            # Neither a caller mutation nor a collector's later mutable fixture
            # may change the immutable evidence used by the morning edition.
            returned = preparer.prepare(now[0])
            returned['articles'][0]['supporting_documents'][0]['document_date'] = '2050-01-01'
            record['body'] = 'changed after the preparation cutoff'
            self.assertEqual(preparer.prepare(now[0]), before)
            self.assertEqual(len(collected), 7)
            window = {name: frozen[name] for name in morning_window(now[0])}
            issue = generate_edition(now[0], articles=frozen['articles'], source_window=window,
                                     providers=provider, clock=lambda: now[0])
            self.assertEqual(frozen, before)
            expected_input = [{**before['articles'][0], 'index': 0}]
            self.assertEqual(provider.claude.call_args.args[1]['articles'], expected_input)
            for reviewer in (provider.gemini, provider.openai):
                reviewer.assert_called_once()
                submitted = reviewer.call_args.args[1]['original_articles']
                self.assertEqual(submitted, expected_input)
                self.assertEqual(submitted[0]['supporting_documents'][0]['document_date'], '2026-10-02')
                self.assertEqual(submitted[0]['published_date'], '2026-10-05')
            self.assertEqual(provider.gemini.call_args.args[1], provider.openai.call_args.args[1])
            now[0] = stamp()
            visible = initial_news(website_news.snapshot(), now=now[0], reviewed_digests=[issue])
            html = render_news_markup(visible)
            self.assertEqual(current_delivery(visible, datetime.fromtimestamp(now[0], JST)), 'published')
        for ref in issue['article_refs'] + issue['article_summaries']:
            self.assertEqual(ref['published_date'], '2026-10-05')
            self.assertEqual(ref['published_at'], stamp('2026-10-05', 12))
            self.assertEqual(ref['body_sha256'], sha256(combined.encode()).hexdigest())
            self.assertNotIn('body', ref)
            self.assertNotIn('supporting_documents', ref)
        self.assertEqual(visible['news'][0]['published_date'], '2026-10-05')
        self.assertIn('発表 2026/10/5', html)
        self.assertNotIn('発表 2026/10/2', html)
        for public in (json.dumps(issue, ensure_ascii=False), json.dumps(visible, ensure_ascii=False), html):
            self.assertNotIn('supporting_documents', public)
            self.assertNotIn('official_html_with_verified_supporting_pdf', public)
            self.assertNotIn('VERIFIED_PDF_ORIGINAL_ONLY', public)
            self.assertNotIn(html_body, public)
            self.assertNotIn(supporting[0]['url'], public)
            self.assertNotIn(supporting[0]['body_sha256'], public)

    def test_collection_generation_reviews_persistence_gate_html_and_checker(self):
        now = [stamp(hour=6, minute=47)]
        calls = []
        storage = MemoryStorage()
        def collect(started, **options):
            calls.append(started)
            options['diagnostics'].update({name: {'feed_status': 'ok', 'status': 'collected'}
                                           for name in ('総務省統計局', '財務省')})
            return [{**source('day'), 'body_verified_at': now[0]}]
        provider = Mock()
        provider.claude.return_value = {'headline': '経済の新しい発表', 'summary': '要' * 230,
            'articles': [{'index': 0, 'headline': '発表のポイント', 'summary': '詳' * 250}]}
        approval = {'approved': True, 'checks': {key: True for key in CHECKS}, 'issues': []}
        provider.gemini.return_value = approval
        provider.openai.return_value = approval
        def generate(started, **options):
            return generate_edition(started, **options, providers=provider, clock=lambda: now[0])
        with TemporaryDirectory() as folder:
            baseline, cache = Path(folder) / 'baseline.json', Path(folder) / 'cache.json'
            import json
            baseline.write_text(json.dumps([legacy_issue('2026-10-05')]))
            def runtime():
                return DailyNewsRuntime(storage, generate, enabled=True, baseline_path=baseline,
                    cache_path=cache, clock=lambda: now[0],
                    source_preparer=MorningNewsPreparer(storage, collect, clock=lambda: now[0]))
            worker = runtime()
            self.assertEqual(worker.run_once()['status'], 'waiting')
            self.assertEqual(calls, [])
            for minute in (0, 5, 10, 15, 20, 25, 29):
                now[0] = stamp(hour=7, minute=minute)
                self.assertEqual(worker.run_once()['status'], 'collecting')
            self.assertEqual(len(calls), 7)
            provider.claude.assert_not_called()
            now[0] = stamp(hour=7, minute=30)
            prepared = worker.run_once()
            self.assertEqual(prepared['status'], 'prepared', prepared)
            for method in (provider.claude, provider.gemini, provider.openai):
                method.assert_called_once()
            now[0] = stamp(hour=7, minute=59, second=59)
            visible = initial_news(website_news.snapshot(), now=now[0], reviewed_digests=worker.reviewed_digests())
            self.assertEqual(visible['edition_date'], '2026-10-05')
            now[0] = stamp()
            self.assertEqual(worker.run_once()['status'], 'ready')
            restarted = runtime()
            self.assertEqual(restarted.run_once()['status'], 'ready')
            visible = initial_news(website_news.snapshot(), now=now[0], reviewed_digests=restarted.reviewed_digests())
            self.assertEqual(visible['edition_date'], '2026-10-06')
            self.assertEqual(visible['news'][0]['published_date'], '2026-10-05')
            self.assertIn('発表 2026/10/5', render_news_markup(visible))
            self.assertEqual(current_delivery(visible, datetime.fromtimestamp(now[0], JST)), 'published')
            self.assertEqual(len(calls), 7)
            provider.claude.assert_called_once()
            public = json.dumps(visible, ensure_ascii=False)
            self.assertNotIn(source()['body'], public)
            self.assertIn(source()['body_sha256'], public)


if __name__ == '__main__':
    unittest.main()

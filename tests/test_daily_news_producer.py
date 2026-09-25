import copy
from datetime import datetime
import unittest
from unittest.mock import Mock, MagicMock, patch

from news_cache import JST
from daily_news_producer import (CHECKS, GenerationError, Providers, build_issue,
                                  configuration, generate_edition, json_object)

NOW = datetime(2026, 9, 24, 7, 50, tzinfo=JST).timestamp()


def articles():
    return [{'source': 'NHK経済', 'title': f'ニュース{i}', 'url': f'https://news.web.nhk/article/{i}',
             'published_at': NOW - 600, 'body': '確認した本文。' * 100} for i in range(3)]


def draft(count=2):
    return {'headline': '経済の動き', 'summary': '要' * 220,
            'articles': [{'index': i, 'headline': '詳しく知る', 'summary': '文' * 230} for i in range(count)]}


def approved():
    return {'approved': True, 'checks': {key: True for key in CHECKS}, 'issues': []}


class ProducerTests(unittest.TestCase):
    def test_uses_retrieved_identity_not_ai_metadata_and_releases_at_eight(self):
        d = {**draft(), 'edition_date': '2050-01-01', 'source': 'made up', 'publish_at': 0}
        issue = build_issue(d, articles(), NOW)
        self.assertEqual(issue['edition_date'], '2026-09-24')
        self.assertEqual(datetime.fromtimestamp(issue['publish_at'], JST).hour, 8)
        self.assertEqual(issue['article_refs'][0]['title'], 'ニュース0')

    def test_valid_single_story_when_no_other_topic(self):
        self.assertEqual(len(build_issue(draft(1), articles(), NOW)['article_refs']), 1)

    def test_rejects_duplicate_unknown_boolean_future_or_empty_selection(self):
        for indexes in ([0, 0], [10], [True], []):
            d = draft(0)
            d['articles'] = [{'index': i, 'headline': '記事', 'summary': '文' * 230} for i in indexes]
            with self.subTest(indexes=indexes), self.assertRaises(GenerationError):
                build_issue(d, articles(), NOW)
        a = articles(); a[0]['published_at'] = NOW + 1
        with self.assertRaises(GenerationError): build_issue(draft(), a, NOW)

    def test_requires_independent_review_with_all_checks(self):
        for result in (approved(), {'approved': True}, {**approved(), 'issues': ['間違い']},
                       {**approved(), 'checks': {**approved()['checks'], 'facts': False}}):
            provider = Mock(); provider.claude.return_value = draft(); provider.gemini.return_value = result
            if result == approved():
                issue = generate_edition(NOW, providers=provider, collector=lambda _: articles(), clock=lambda: NOW + 15)
                self.assertEqual(issue['reviewed_at'], NOW + 15)
            else:
                with self.assertRaises(GenerationError):
                    generate_edition(NOW, providers=provider, collector=lambda _: articles(), clock=lambda: NOW)

    def test_does_not_publish_search_snippets_without_article_bodies(self):
        provider = Mock(); provider.gemini.return_value = {'urls': ['https://untrusted.test/'], 'summary': '架空'}
        with self.assertRaisesRegex(GenerationError, 'no_verified_articles'):
            generate_edition(NOW, providers=provider, collector=lambda *a, **kw: [], clock=lambda: NOW)
        provider.claude.assert_not_called()

    def test_rejected_copy_is_repaired_once_and_independently_reviewed_again(self):
        provider=Mock();provider.claude.return_value=draft()
        rejection={**approved(),'approved':False,'issues':['Unsupported outlook'],
                   'checks':{**approved()['checks'],'no_invented_outlook':False}}
        provider.gemini.side_effect=[rejection,approved()]
        result=generate_edition(NOW,providers=provider,collector=lambda _:articles(),clock=lambda:NOW)
        self.assertEqual(len(result['article_refs']),2)
        self.assertEqual(provider.claude.call_count,2)
        self.assertEqual(provider.gemini.call_count,2)
        self.assertEqual(provider.claude.call_args.args[1]['editorial_feedback'],rejection)
        provider.gemini.side_effect=[rejection,rejection]
        with self.assertRaisesRegex(GenerationError,'editorial_review_failed_no_invented_outlook'):
            generate_edition(NOW,providers=provider,collector=lambda _:articles(),clock=lambda:NOW)

    def test_editorial_rewrite_length_is_repaired_using_measured_counts_then_reviewed(self):
        provider=Mock();short={**draft(),'summary':'x'*180}
        provider.claude.side_effect=[draft(),short,draft()]
        provider.gemini.side_effect=[{**approved(),'approved':False,'issues':['Simplify']},approved()]
        issue=generate_edition(NOW,providers=provider,collector=lambda _:articles(),clock=lambda:NOW)
        self.assertEqual(len(issue['summary']),220)
        self.assertEqual(provider.claude.call_count,3)
        self.assertEqual(provider.gemini.call_count,2)
        measured=provider.claude.call_args.args[1]['measured_lengths']
        self.assertEqual(measured[0]['characters'],180)
        self.assertEqual(measured[0]['required_min'],200)

    def test_search_failure_keeps_verified_article(self):
        provider = Mock(); provider.claude.return_value = draft(1)
        provider.gemini.side_effect = [GenerationError('gemini_unavailable'), approved()]
        issue = generate_edition(NOW, providers=provider, collector=lambda _: articles()[:1], clock=lambda: NOW)
        self.assertEqual(len(issue['article_refs']), 1)

    def test_repairs_length_only_once_and_rechecks(self):
        provider = Mock(); provider.claude.side_effect = [{**draft(), 'summary': '短い'}, draft()]
        provider.gemini.return_value = approved()
        generate_edition(NOW, providers=provider, collector=lambda _: articles(), clock=lambda: NOW)
        self.assertEqual(provider.claude.call_count, 2)

    def test_article_indexes_are_explicit_and_invalid_indexes_get_one_repair(self):
        provider=Mock();bad=draft();bad['articles'][0]['index']='0'
        provider.claude.side_effect=[bad,draft()];provider.gemini.return_value=approved()
        result=generate_edition(NOW,providers=provider,collector=lambda _:articles(),clock=lambda:NOW)
        self.assertEqual(len(result['article_refs']),2)
        data=provider.claude.call_args_list[0].args[1]
        self.assertEqual([a['index'] for a in data['articles']],[0,1,2])
        self.assertEqual(provider.claude.call_args.args[1]['validation_error'],'invalid_article_selection')
        self.assertEqual(provider.claude.call_count,2)
        provider.claude.side_effect=[bad,bad]
        with self.assertRaisesRegex(GenerationError,'invalid_article_selection'):
            generate_edition(NOW,providers=provider,collector=lambda _:articles(),clock=lambda:NOW)

    def test_midnight_completion_does_not_publish_as_another_day(self):
        provider = Mock(); provider.claude.return_value = draft(); provider.gemini.return_value = approved()
        with self.assertRaises(GenerationError):
            generate_edition(NOW, providers=provider, collector=lambda _: articles(), clock=lambda: NOW + 86400)

    def test_json_parser_and_configuration_do_not_return_keys(self):
        self.assertEqual(json_object('```json\n{"ok":true}\n```'), {'ok': True})
        with self.assertRaises(GenerationError): json_object('[]')
        self.assertNotIn('secret', str(configuration({'GEMINI_API_KEY': 'secret'})))

    def test_finish_reason_is_specific_but_does_not_expose_provider_text(self):
        provider=Providers({})
        with patch.object(provider, '_post', return_value={'candidates':[{'finishReason':'MAX_TOKENS'}]}):
            with self.assertRaisesRegex(GenerationError, '^gemini_discovery_max_tokens$'):
                provider.gemini('find', {}, search=True)
        with patch.object(provider, '_post', return_value={'candidates':[{'finishReason':'private secret'}]}):
            with self.assertRaisesRegex(GenerationError, '^gemini_review_other$'):
                provider.gemini('review', {})

    def test_token_limit_has_one_bounded_retry_but_safety_never_retries(self):
        provider=Providers({})
        complete={'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':'{"approved":true}'}]}}]}
        with patch.object(provider,'_post',side_effect=[{'candidates':[{'finishReason':'MAX_TOKENS'}]},complete]) as post:
            self.assertTrue(provider.gemini('review',{})['approved'])
            self.assertEqual(post.call_count,2)
            self.assertEqual(post.call_args.args[2]['generationConfig']['maxOutputTokens'],12000)
        with patch.object(provider,'_post',return_value={'candidates':[{'finishReason':'SAFETY'}]}) as post:
            with self.assertRaisesRegex(GenerationError,'gemini_review_safety'):
                provider.gemini('review',{})
            self.assertEqual(post.call_count,1)

    def test_http_errors_expose_only_status(self):
        session = MagicMock(); response = session.post.return_value.__enter__.return_value
        response.status_code = 401; response.text = 'secret invalid key'
        with self.assertRaisesRegex(GenerationError, '^gemini_http_401$'):
            Providers({}, session)._post('https://example.test', {}, {}, 'gemini')
        self.assertFalse(session.post.call_args.kwargs['allow_redirects'])

    def test_provider_rejects_oversize_and_slow_streams(self):
        session = MagicMock(); response = session.post.return_value.__enter__.return_value
        response.status_code = 200
        response.raw.read1.return_value = b'x' * 1_000_001
        with self.assertRaisesRegex(GenerationError, 'response_limit'):
            Providers({}, session)._post('https://example.test', {}, {}, 'gemini')
        response.raw.read1.return_value = b'{}'
        with patch('daily_news_producer.time.monotonic', side_effect=[0, 101]):
            with self.assertRaisesRegex(GenerationError, 'response_limit'):
                Providers({}, session)._post('https://example.test', {}, {}, 'gemini')
        session.post.return_value.__exit__.assert_called()

    def test_midnight_during_independent_review_is_rejected(self):
        provider = Mock(); provider.claude.return_value = draft(); provider.gemini.return_value = approved()
        clock = Mock(side_effect=[NOW, NOW + 86400])
        with self.assertRaises(GenerationError):
            generate_edition(NOW, providers=provider, collector=lambda _: articles(), clock=clock)
        provider.gemini.assert_called_once()


if __name__ == '__main__': unittest.main()

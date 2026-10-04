import copy
import json
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


def provider_mock():
    provider = Mock()
    provider.openai.return_value = approved()
    return provider


def openai_response(value=None):
    return {'status': 'completed', 'output': [
        {'type': 'reasoning', 'summary': []},
        {'type': 'message', 'role': 'assistant', 'status': 'completed',
         'content': [{'type': 'output_text', 'text': json.dumps(approved() if value is None else value)}]}]}


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
            provider = provider_mock(); provider.claude.return_value = draft(); provider.gemini.return_value = result
            if result == approved():
                issue = generate_edition(NOW, providers=provider, collector=lambda _: articles(), clock=lambda: NOW + 15)
                self.assertEqual(issue['reviewed_at'], NOW + 15)
            else:
                with self.assertRaises(GenerationError):
                    generate_edition(NOW, providers=provider, collector=lambda _: articles(), clock=lambda: NOW)

    def test_does_not_publish_search_snippets_without_article_bodies(self):
        provider = provider_mock(); provider.gemini.return_value = {'urls': ['https://untrusted.test/'], 'summary': '架空'}
        with self.assertRaisesRegex(GenerationError, 'no_verified_articles'):
            generate_edition(NOW, providers=provider, collector=lambda *a, **kw: [], clock=lambda: NOW)
        provider.claude.assert_not_called()

    def test_rejected_copy_is_repaired_once_and_independently_reviewed_again(self):
        provider=provider_mock();provider.claude.return_value=draft()
        rejection={**approved(),'approved':False,'issues':['Unsupported outlook'],
                   'checks':{**approved()['checks'],'no_invented_outlook':False}}
        provider.gemini.side_effect=[rejection,approved()]
        result=generate_edition(NOW,providers=provider,collector=lambda _:articles(),clock=lambda:NOW)
        self.assertEqual(len(result['article_refs']),2)
        self.assertEqual(provider.claude.call_count,2)
        self.assertEqual(provider.gemini.call_count,2)
        self.assertEqual(provider.claude.call_args.args[1]['editorial_feedback'],rejection)
        provider.gemini.side_effect=[rejection]*4
        with self.assertRaisesRegex(GenerationError,'editorial_review_failed_no_invented_outlook'):
            generate_edition(NOW,providers=provider,collector=lambda _:articles(),clock=lambda:NOW)

    def test_editorial_rewrite_length_is_repaired_using_measured_counts_then_reviewed(self):
        provider=provider_mock();short={**draft(),'summary':'x'*180}
        provider.claude.side_effect=[draft(),short,draft()]
        provider.gemini.side_effect=[{**approved(),'approved':False,'issues':['Simplify']},approved()]
        issue=generate_edition(NOW,providers=provider,collector=lambda _:articles(),clock=lambda:NOW)
        self.assertEqual(len(issue['summary']),220)
        self.assertEqual(provider.claude.call_count,3)
        self.assertEqual(provider.gemini.call_count,2)
        measured=provider.claude.call_args.args[1]['measured_lengths']
        self.assertEqual(measured[0]['characters'],180)
        self.assertEqual(measured[0]['required_min'],200)

    def test_surgical_length_repair_preserves_source_indexes_and_other_text(self):
        provider=provider_mock();short={**draft(),'summary':'x'*180}
        provider.claude.side_effect=[short,short,{'replacements':[{'field':'summary','text':'x'*250},
            {'field':'articles[0].summary','text':'bad'*80}]}]
        provider.gemini.return_value=approved()
        issue=generate_edition(NOW,providers=provider,collector=lambda _:articles(),clock=lambda:NOW)
        self.assertEqual(issue['summary'],'x'*250)
        self.assertEqual(issue['article_summaries'][0]['summary'],draft()['articles'][0]['summary'])
        self.assertEqual(provider.claude.call_count,3)
        self.assertEqual(provider.gemini.call_count,1)

    def test_overlapping_topics_rebuild_one_story_and_require_new_review(self):
        provider=provider_mock();provider.claude.side_effect=[draft(),draft(1)]
        provider.gemini.side_effect=[{**approved(),'approved':False,'issues':['Overlap'],
             'checks':{**approved()['checks'],'distinct_topics':False}},approved()]
        issue=generate_edition(NOW,providers=provider,collector=lambda _:articles(),clock=lambda:NOW)
        self.assertEqual(len(issue['article_refs']),1)
        repair=provider.claude.call_args.args[1]
        self.assertEqual(repair['maximum_articles'],1)
        self.assertEqual([row['index'] for row in repair['articles']],[0])
        self.assertEqual(provider.gemini.call_count,2)

    def test_successive_editorial_findings_are_fixed_before_final_approval(self):
        provider=provider_mock();provider.claude.side_effect=[draft(),draft(1),draft(1)]
        provider.gemini.side_effect=[{**approved(),'approved':False,'issues':['Overlap'],
             'checks':{**approved()['checks'],'distinct_topics':False}},
             {**approved(),'approved':False,'issues':['Date ambiguity'],
             'checks':{**approved()['checks'],'dates':False}},approved()]
        issue=generate_edition(NOW,providers=provider,collector=lambda _:articles(),clock=lambda:NOW)
        self.assertEqual(len(issue['article_refs']),1)
        self.assertEqual(provider.gemini.call_count,3)
        self.assertEqual(len(provider.claude.call_args.args[1]['articles']),1)

    def test_search_failure_keeps_verified_article(self):
        provider = provider_mock(); provider.claude.return_value = draft(1)
        provider.gemini.side_effect = [GenerationError('gemini_unavailable'), approved()]
        issue = generate_edition(NOW, providers=provider, collector=lambda _: articles()[:1], clock=lambda: NOW)
        self.assertEqual(len(issue['article_refs']), 1)

    def test_repairs_length_only_once_and_rechecks(self):
        provider = provider_mock(); provider.claude.side_effect = [{**draft(), 'summary': '短い'}, draft()]
        provider.gemini.return_value = approved()
        generate_edition(NOW, providers=provider, collector=lambda _: articles(), clock=lambda: NOW)
        self.assertEqual(provider.claude.call_count, 2)

    def test_article_indexes_are_explicit_and_invalid_indexes_get_one_repair(self):
        provider=provider_mock();bad=draft();bad['articles'][0]['index']='0'
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
        provider = provider_mock(); provider.claude.return_value = draft(); provider.gemini.return_value = approved()
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
        provider = provider_mock(); provider.claude.return_value = draft(); provider.gemini.return_value = approved()
        clock = Mock(side_effect=[NOW, NOW + 86400])
        with self.assertRaises(GenerationError):
            generate_edition(NOW, providers=provider, collector=lambda _: articles(), clock=clock)
        provider.gemini.assert_called_once()


class DualReviewTests(unittest.TestCase):
    def provider(self):
        provider = provider_mock()
        provider.claude.return_value = draft()
        provider.gemini.return_value = approved()
        return provider

    def generate(self, provider, **kwargs):
        return generate_edition(NOW, providers=provider, collector=lambda _: articles(),
                                clock=kwargs.get('clock', lambda: NOW))

    def test_both_reviewers_receive_same_draft_and_all_sources_without_each_others_verdict(self):
        provider = self.provider()
        result = self.generate(provider)
        self.assertEqual(result['article_refs'][0]['title'], articles()[0]['title'])
        self.assertEqual([call[0] for call in provider.method_calls], ['claude', 'gemini', 'openai'])
        gemini_data = provider.gemini.call_args.args[1]
        openai_data = provider.openai.call_args.args[1]
        self.assertEqual(openai_data, gemini_data)
        self.assertEqual(set(openai_data), {'draft', 'original_articles'})
        self.assertEqual(openai_data['draft'], draft())
        self.assertEqual(openai_data['original_articles'], [{**item, 'index': i} for i, item in enumerate(articles())])
        self.assertEqual(len(openai_data['original_articles']), 3)
        self.assertEqual(len(result['article_refs']), 2)

    def test_gemini_rejection_never_reaches_openai_until_a_rewrite_passes_gemini(self):
        provider = self.provider()
        rejection = {**approved(), 'approved': False, 'checks': {**approved()['checks'], 'facts': False}}
        provider.gemini.side_effect = [rejection, approved()]
        self.generate(provider)
        self.assertEqual([call[0] for call in provider.method_calls],
                         ['claude', 'gemini', 'claude', 'gemini', 'openai'])

    def test_openai_rejection_rewrites_then_runs_both_reviews_on_the_changed_draft(self):
        provider = self.provider()
        initial, revised = draft(), {**draft(), 'summary': '訂' * 240}
        provider.claude.side_effect = [initial, revised]
        provider.openai.side_effect = [{**approved(), 'approved': False,
                                       'checks': {**approved()['checks'], 'dates': False},
                                       'issues': ['対象日時を訂正してください。']}, approved()]
        result = self.generate(provider)
        self.assertEqual(result['summary'], revised['summary'])
        self.assertEqual([call[0] for call in provider.method_calls],
                         ['claude', 'gemini', 'openai', 'claude', 'gemini', 'openai'])
        for reviewer in (provider.gemini, provider.openai):
            self.assertEqual([call.args[1]['draft'] for call in reviewer.call_args_list], [initial, revised])

    def test_openai_overlap_uses_single_source_rebuild_then_both_reviews(self):
        provider = self.provider()
        provider.claude.side_effect = [draft(), draft(1)]
        provider.openai.side_effect = [{**approved(), 'approved': False, 'issues': ['Overlap'],
                                       'checks': {**approved()['checks'], 'distinct_topics': False}}, approved()]
        result = self.generate(provider)
        self.assertEqual(len(result['article_refs']), 1)
        repair = provider.claude.call_args.args[1]
        self.assertEqual(repair['maximum_articles'], 1)
        self.assertEqual([item['index'] for item in repair['articles']], [0])
        self.assertEqual(provider.gemini.call_count, 2)
        self.assertEqual(provider.openai.call_count, 2)

    def test_openai_rejection_after_length_repair_reviews_only_the_final_repaired_copy(self):
        provider = self.provider()
        initial, short, repaired = draft(), {**draft(), 'summary': '短' * 180}, {**draft(), 'summary': '直' * 250}
        provider.claude.side_effect = [initial, short, repaired]
        provider.openai.side_effect = [{**approved(), 'approved': False, 'issues': ['Clarify']}, approved()]
        result = self.generate(provider)
        self.assertEqual(result['summary'], repaired['summary'])
        for reviewer in (provider.gemini, provider.openai):
            self.assertEqual([call.args[1]['draft'] for call in reviewer.call_args_list], [initial, repaired])

    def test_openai_missing_checks_nonboolean_flags_and_issues_fail_closed_with_four_round_limit(self):
        invalid_reviews = [
            {'approved': True},
            {**approved(), 'approved': 'true'},
            {**approved(), 'checks': {**approved()['checks'], 'facts': 'true'}},
            {**approved(), 'checks': {key: True for key in CHECKS if key != 'dates'}},
            {**approved(), 'issues': ['Unsupported claim']},
        ]
        for review in invalid_reviews:
            with self.subTest(review=review):
                provider = self.provider()
                provider.openai.return_value = review
                with self.assertRaisesRegex(GenerationError, '^openai_review_failed_'):
                    self.generate(provider)
                self.assertEqual(provider.openai.call_count, 4)
                self.assertEqual(provider.gemini.call_count, 4)
                self.assertEqual(provider.claude.call_count, 4)

    def test_openai_provider_failure_stops_without_rewrite_or_fallback_approval(self):
        for code in ('openai_not_configured', 'openai_http_429', 'openai_unavailable',
                     'openai_response_limit', 'openai_incomplete', 'openai_refused',
                     'openai_invalid_response', 'invalid_provider_json'):
            with self.subTest(code=code):
                provider = self.provider()
                provider.openai.side_effect = GenerationError(code)
                with self.assertRaisesRegex(GenerationError, '^' + code + '$'):
                    self.generate(provider)
                self.assertEqual(provider.claude.call_count, 1)
                self.assertEqual(provider.gemini.call_count, 1)
                self.assertEqual(provider.openai.call_count, 1)

    def test_midnight_during_openai_review_does_not_publish_next_day(self):
        provider = self.provider()
        with self.assertRaises(GenerationError):
            self.generate(provider, clock=Mock(side_effect=[NOW, NOW + 86400]))
        provider.openai.assert_called_once()


class OpenAIProviderTests(unittest.TestCase):
    def test_configuration_requires_openai_without_exposing_values(self):
        keys = ('GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'SUPABASE_URL', 'SUPABASE_KEY')
        env = {key: 'test-only-private-value' for key in keys}
        configured = configuration(env)
        self.assertTrue(configured['configured'])
        self.assertEqual(configured['missing'], [])
        del env['OPENAI_API_KEY']
        missing = configuration(env)
        self.assertFalse(missing['configured'])
        self.assertEqual(missing['missing'], ['OPENAI_API_KEY'])
        self.assertNotIn('test-only-private-value', json.dumps(missing))

    def test_no_key_fails_before_http(self):
        for env in ({}, {'OPENAI_API_KEY': ''}):
            with self.subTest(env=env):
                provider = Providers(env)
                with patch.object(provider, '_post') as post:
                    with self.assertRaisesRegex(GenerationError, '^openai_not_configured$'):
                        provider.openai('review', {})
                    post.assert_not_called()

    def test_responses_request_has_bounded_strict_review_schema_and_no_storage(self):
        provider = Providers({'OPENAI_API_KEY': 'test-only-key'})
        data = {'draft': draft(), 'original_articles': articles()}
        with patch.object(provider, '_post', return_value=openai_response()) as post:
            self.assertEqual(provider.openai('Independent review', data), approved())
        url, headers, payload, stage = post.call_args.args
        self.assertEqual(url, 'https://api.openai.com/v1/responses')
        self.assertEqual(headers['Authorization'], 'Bearer test-only-key')
        self.assertEqual(stage, 'openai')
        self.assertEqual(payload['model'], 'gpt-6-luna')
        self.assertIs(payload['store'], False)
        self.assertEqual(payload['max_output_tokens'], 4000)
        self.assertEqual(payload['reasoning']['effort'], 'medium')
        self.assertIn('Independent review', json.dumps(payload, ensure_ascii=False))
        self.assertIn(articles()[0]['body'], json.dumps(payload, ensure_ascii=False))
        output_format = payload['text']['format']
        self.assertEqual(output_format['type'], 'json_schema')
        self.assertIs(output_format['strict'], True)
        schema = output_format['schema']
        self.assertEqual(set(schema['required']), {'approved', 'checks', 'issues'})
        self.assertIs(schema['additionalProperties'], False)
        self.assertEqual(schema['properties']['approved']['type'], 'boolean')
        checks = schema['properties']['checks']
        self.assertEqual(set(checks['required']), set(CHECKS))
        self.assertEqual(set(checks['properties']), set(CHECKS))
        self.assertIs(checks['additionalProperties'], False)
        self.assertTrue(all(value['type'] == 'boolean' for value in checks['properties'].values()))
        self.assertEqual(schema['properties']['issues']['type'], 'array')
        self.assertEqual(schema['properties']['issues']['items']['type'], 'string')

    def test_model_override_is_used_without_changing_the_review_contract(self):
        provider = Providers({'OPENAI_API_KEY': 'test-only-key', 'NEWS_OPENAI_MODEL': 'test-review-model'})
        with patch.object(provider, '_post', return_value=openai_response()) as post:
            self.assertEqual(provider.openai('review', {}), approved())
        self.assertEqual(post.call_args.args[2]['model'], 'test-review-model')

    def test_noncompleted_refusal_empty_or_wrong_message_never_pass(self):
        incomplete = {**openai_response(), 'status': 'incomplete'}
        refusal = openai_response()
        refusal['output'][1]['content'] = [{'type': 'refusal', 'refusal': 'private provider detail'}]
        wrong_role = openai_response()
        wrong_role['output'][1]['role'] = 'user'
        pending_message = openai_response()
        pending_message['output'][1]['status'] = 'in_progress'
        no_message_status = openai_response()
        del no_message_status['output'][1]['status']
        empty_text = openai_response()
        empty_text['output'][1]['content'][0]['text'] = ''
        cases = [(incomplete, '^openai_incomplete$'), (refusal, '^openai_refused$'),
                 ({'status': 'completed', 'output': []}, '^openai_invalid_response$'),
                 (wrong_role, '^openai_invalid_response$'),
                 (pending_message, '^openai_(?:incomplete|invalid_response)$'),
                 (no_message_status, '^openai_(?:incomplete|invalid_response)$'),
                 (empty_text, '^(?:openai_invalid_response|invalid_provider_json)$')]
        for response, code in cases:
            with self.subTest(code=code, response=response):
                provider = Providers({'OPENAI_API_KEY': 'test-only-key'})
                with patch.object(provider, '_post', return_value=response) as post:
                    with self.assertRaisesRegex(GenerationError, code) as caught:
                        provider.openai('review', {})
                    self.assertNotIn('private provider detail', str(caught.exception))
                    post.assert_called_once()

    def test_malformed_json_is_rejected_without_exposing_response_text(self):
        response = openai_response()
        response['output'][1]['content'][0]['text'] = '{ private response text'
        provider = Providers({'OPENAI_API_KEY': 'test-only-key'})
        with patch.object(provider, '_post', return_value=response):
            with self.assertRaisesRegex(GenerationError, '^invalid_provider_json$'):
                provider.openai('review', {})

    def test_http_error_exposes_status_only(self):
        session = MagicMock()
        response = session.post.return_value.__enter__.return_value
        response.status_code = 429
        response.text = 'private upstream response'
        provider = Providers({'OPENAI_API_KEY': 'test-only-key'}, session)
        with self.assertRaisesRegex(GenerationError, '^openai_http_429$'):
            provider.openai('review', {})
        self.assertFalse(session.post.call_args.kwargs['allow_redirects'])


if __name__ == '__main__': unittest.main()

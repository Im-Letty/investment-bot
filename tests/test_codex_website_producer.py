"""No CLI or sockets: verify the writer swap retains the publication contract."""
from copy import deepcopy
import unittest
from unittest.mock import patch

import daily_news_producer as shared
import codex_website_producer as codex
import website_news_producer as website
from tests.test_website_news_producer import ENV, NOW, WINDOW, MockTransport, approval, sources


class Writer:
    def __init__(self):
        self.calls, self.closed = [], False

    def write(self, instruction, data, *, timeout):
        self.calls.append((instruction, deepcopy(data), timeout))
        if data['stage'] == 'article':
            index = data['articles'][0]['index']
            return {'index': index, 'headline': f'発表{index}をやさしく読む',
                    'summary': '導入' * 55 + '\n\n' + '補足' * 60,
                    'facts': [{'text': '今回の発表の主体と出来事です。', 'evidence_ids': [f'{index}:0']},
                              {'text': '今回の発表の目的です。', 'evidence_ids': [f'{index}:0']}]}
        return {'headline': '今日の経済をやさしく読む', 'summary': '全体' * 120,
                'indexes': list(data['selected_indexes'])}

    def close(self):
        self.closed = True


class CodexWebsiteTests(unittest.TestCase):
    def setUp(self):
        blocker = patch('requests.sessions.Session.request', side_effect=AssertionError('network disabled'))
        blocker.start()
        self.addCleanup(blocker.stop)

    def provider(self, transport=None, writer=None):
        transport, writer = transport or MockTransport(), writer or Writer()
        return codex.CodexWebsiteProviders(ENV, transport.session, writer=writer), transport, writer

    def generate(self, provider):
        return codex.generate_codex_website_edition(NOW, articles=sources(),
                        source_window=WINDOW, providers=provider, clock=lambda: NOW)

    def test_swap_passes_identical_editorial_instructions_and_data(self):
        baseline_transport = MockTransport()
        baseline = website.generate_website_edition(NOW, articles=sources(), source_window=WINDOW,
                    providers=website.WebsiteProviders(ENV, baseline_transport.session), clock=lambda: NOW)
        provider, transport, writer = self.provider()
        issue = self.generate(provider)
        previous = [(payload['system'], data) for name, data, payload in baseline_transport.calls
                    if name == 'claude']
        self.assertEqual([(instruction, data) for instruction, data, _ in writer.calls], previous)
        self.assertEqual(issue, baseline)
        self.assertEqual([name for name, _, _ in transport.calls], ['gemini', 'openai'])
        self.assertEqual(provider.http_counts, {'gemini': 1, 'openai': 1})
        self.assertEqual(provider.codex_calls, 3)
        self.assertTrue(writer.closed)
        self.assertNotIn('ANTHROPIC_API_KEY', provider.env)
        overview_data = writer.calls[-1][1]
        self.assertEqual(overview_data['selected_indexes'], [0, 1])
        self.assertEqual([row['index'] for row in overview_data['article_cards']], [0])
        for _, data, _ in transport.calls:
            self.assertEqual(data['draft']['summary'], issue['summary'])
            self.assertEqual(data['copy_length_policy'], 'flexible-v1')
            self.assertEqual(data['reading_structure'], 'lead-plus-other-news-v1')
            self.assertEqual([row['index'] for row in data['draft']['articles']], [0, 1])
        self.assertEqual(issue['reading_structure'], 'lead-plus-other-news-v1')
        self.assertTrue(all(0 < timeout <= codex.WRITING_SECONDS for _, _, timeout in writer.calls))

    def test_unused_claude_key_never_retained_and_http_writer_rejected(self):
        provider, transport, _ = self.provider()
        self.addCleanup(provider.close)
        self.assertNotIn('ANTHROPIC_API_KEY', provider.env)
        with self.assertRaisesRegex(shared.GenerationError, '^codex_paid_writer_disabled$'):
            provider._post('https://api.anthropic.com/v1/messages', {}, {}, 'claude')
        self.assertFalse(transport.calls)

    def test_both_fresh_reviews_remain_required_after_subscription_repair(self):
        counts = {'gemini': 0, 'openai': 0}
        def review(name, data):
            counts[name] += 1
            result = approval()
            if name == 'openai' and counts[name] == 1:
                result['approved'] = False
                result['checks']['facts'] = False
                result['issues'] = ['fixture-only rejection']
            return result
        provider, transport, writer = self.provider(MockTransport(reviewer=review))
        issue = self.generate(provider)
        self.assertEqual(provider.codex_calls, 6)
        self.assertEqual(provider.http_counts, {'gemini': 2, 'openai': 2})
        self.assertEqual([name for name, _, _ in transport.calls], ['gemini', 'openai'] * 2)
        self.assertEqual(issue['summary'], '全体' * 120)
        self.assertTrue(writer.closed)

    def test_second_review_rejection_never_returns_publishable_issue(self):
        def review(name, data):
            result = approval()
            if name == 'openai':
                result['approved'] = False
                result['checks']['facts'] = False
                result['issues'] = ['fixture-only rejection']
            return result
        provider, transport, writer = self.provider(MockTransport(reviewer=review))
        with self.assertRaisesRegex(shared.GenerationError, '^isolated_editorial_review_failed$'):
            self.generate(provider)
        self.assertEqual(len(transport.calls), 4)
        self.assertTrue(writer.closed)

    def test_local_writing_failure_is_counted_and_never_calls_any_api(self):
        writer = Writer()
        writer.write = lambda *a, **kw: (_ for _ in ()).throw(shared.GenerationError('codex_unavailable'))
        provider, transport, _ = self.provider(writer=writer)
        with self.assertRaisesRegex(shared.GenerationError, '^codex_unavailable$'):
            self.generate(provider)
        self.assertEqual(provider.codex_calls, 1)
        self.assertFalse(transport.calls)
        self.assertTrue(writer.closed)

    def test_call_cap_and_review_preflight_stop_before_extra_writer(self):
        provider, _, writer = self.provider()
        self.addCleanup(provider.close)
        provider._codex_calls = codex.CODEX_CALL_LIMIT
        with self.assertRaisesRegex(shared.GenerationError, '^generation_call_limit$'):
            provider.claude('instruction', {'stage': 'overview'})
        self.assertFalse(writer.calls)
        provider._codex_calls = 0
        provider._counts['openai'] = website.CALL_LIMITS['openai']
        with self.assertRaisesRegex(shared.GenerationError, '^generation_call_limit$'):
            provider.reserve_drafting(1)
        self.assertFalse(writer.calls)

    def test_explicit_entry_rejects_legacy_paid_provider(self):
        transport = MockTransport()
        provider = website.WebsiteProviders(ENV, transport.session)
        self.addCleanup(provider.close)
        with self.assertRaisesRegex(shared.GenerationError, '^generation_budget_required$'):
            codex.generate_codex_website_edition(NOW, articles=sources(),
                            source_window=WINDOW, providers=provider, clock=lambda: NOW)
        self.assertFalse(transport.calls)


if __name__ == '__main__':
    unittest.main()

"""Actual website entry point, with in-memory storage and simulated HTTP only."""
import ast
from copy import deepcopy
from datetime import datetime
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from flask import Flask, jsonify, request

from daily_news_runtime import DailyNewsRuntime, _safe_generation_error
from morning_news_window import MorningNewsPreparer
from news_cache import JST
from news_initial import initial_news, render_news_markup
from scripts.check_daily_news import current_delivery
from tests.test_daily_news_runtime import MemoryStorage, issue as legacy_issue
from tests.test_isolated_news_producer import sources, article_reply, overview_reply, approved
from tests.test_official_news_publication import stamp
from website_news import website_news
from website_news_producer import WebsiteProviders, generate_website_edition, configuration_metadata


class FixtureResponse:
    status_code = 200

    def __init__(self, value):
        content = json.dumps(value, ensure_ascii=False).encode()
        buffer = io.BytesIO(content)
        self.raw = Mock()
        self.raw.read1.side_effect = lambda size, **kwargs: buffer.read(size)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


class FixtureSession:
    """Transport fixtures exercise real provider encoding/decoding and budgets."""
    def __init__(self, mode='approve'):
        self.calls = []
        self.mode = mode
        self.close = Mock()

    def post(self, url, **options):
        payload = options['json']
        if 'anthropic.com' in url:
            name = 'claude'
            data = json.loads(payload['messages'][0]['content'])
            result = article_reply(data) if data['stage'] == 'article' else overview_reply(data)
            response = {'stop_reason': 'end_turn', 'content': [{'type': 'text', 'text': json.dumps(result)}]}
        else:
            name = 'gemini' if 'googleapis.com' in url else 'openai'
            data = json.loads(payload['contents'][0]['parts'][0]['text'] if name == 'gemini'
                              else payload['input'][0]['content'])
            result = approved()
            if name == 'openai' and self.mode == 'reject':
                result.update(approved=False, issues=['架空資料の確認が不十分です。'])
                result['checks']['facts'] = False
            if name == 'gemini':
                response = {'candidates': [{'finishReason': 'STOP',
                            'content': {'parts': [{'text': json.dumps(result)}]}}]}
            else:
                response = {'status': 'completed', 'output': [{'type': 'message', 'role': 'assistant',
                            'status': 'completed', 'content': [{'type': 'output_text', 'text': json.dumps(result)}]}]}
        self.calls.append((name, deepcopy(data)))
        if name == 'openai' and self.mode == 'http_error':
            response = FixtureResponse({})
            response.status_code = 503
            return response
        if name == 'openai' and self.mode == 'invalid_json':
            response['output'][0]['content'][0]['text'] = 'not-json'
        return FixtureResponse(response)


class WebsitePublicationTests(unittest.TestCase):
    def setUp(self):
        network = patch('requests.sessions.Session.request', side_effect=AssertionError('network disabled'))
        network.start()
        self.addCleanup(network.stop)
        self.now = stamp(hour=6, minute=47)
        self.storage = MemoryStorage()
        self.collected = []
        self.sessions = []
        self.rows = sources(2)
        self.mode = 'approve'
        self.folder = TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.baseline = Path(self.folder.name) / 'baseline.json'
        self.cache = Path(self.folder.name) / 'cache.json'
        self.baseline.write_text(json.dumps([legacy_issue('2026-10-05')]))

    def collect(self, started, **options):
        self.collected.append(started)
        options['diagnostics'].update({name: {'feed_status': 'ok', 'status': 'collected'}
                                      for name in ('総務省統計局', '財務省')})
        return [{**deepcopy(row), 'body_verified_at': self.now} for row in self.rows]

    def generate(self, started, **options):
        session = FixtureSession(self.mode)
        self.sessions.append(session)
        provider = WebsiteProviders(environ={'OPENAI_API_KEY': 'synthetic-fixture'}, session=session)
        return generate_website_edition(started, **options, providers=provider, clock=lambda: self.now)

    def runtime(self):
        return DailyNewsRuntime(self.storage, self.generate, enabled=True, baseline_path=self.baseline,
            cache_path=self.cache, clock=lambda: self.now,
            source_preparer=MorningNewsPreparer(self.storage, self.collect, clock=lambda: self.now))

    def prepare(self, worker):
        self.assertEqual(worker.run_once()['status'], 'waiting')
        for minute in (0, 5, 10, 15, 20, 25, 29):
            self.now = stamp(hour=7, minute=minute)
            self.assertEqual(worker.run_once()['status'], 'collecting')
        self.assertEqual(self.sessions, [])
        self.now = stamp(hour=7, minute=30)
        return worker.run_once()

    def test_real_entry_reviews_storage_release_and_restart(self):
        worker = self.runtime()
        self.assertEqual(self.prepare(worker)['status'], 'prepared')
        session = self.sessions[0]
        self.assertEqual([name for name, _ in session.calls], ['claude'] * 3 + ['gemini', 'openai'])
        session.close.assert_called_once()
        self.assertEqual(session.calls[-2][1], session.calls[-1][1])
        self.assertEqual([len(data['articles']) for name, data in session.calls
                          if name == 'claude' and data['stage'] == 'article'], [1, 1])
        frozen = deepcopy(worker.source_preparer.prepare(self.now))
        self.now = stamp(hour=7, minute=59, second=59)
        before = initial_news(website_news.snapshot(), now=self.now, reviewed_digests=worker.reviewed_digests())
        self.assertEqual(before['edition_date'], '2026-10-05')
        self.now = stamp()
        self.assertEqual(worker.run_once()['status'], 'ready')
        restarted = self.runtime()
        self.assertEqual(restarted.run_once()['status'], 'ready')
        after = initial_news(website_news.snapshot(), now=self.now, reviewed_digests=restarted.reviewed_digests())
        self.assertEqual(after['edition_date'], '2026-10-06')
        self.assertEqual(current_delivery(after, datetime.fromtimestamp(self.now, JST)), 'published')
        self.assertEqual(worker.source_preparer.prepare(self.now), frozen)
        self.assertEqual(len(self.sessions), 1)
        self.assertEqual(len(self.collected), 7)
        html = render_news_markup(after)
        for public in (json.dumps(after, ensure_ascii=False), html):
            for row in self.rows:
                self.assertNotIn(row['body'], public)
            for field in ('evidence_passages', 'summary_alternatives', 'article_evidence', 'source_ref'):
                self.assertNotIn('"' + field + '"', public)

    def test_failed_review_transport_or_json_keeps_previous_edition(self):
        for mode in ('reject', 'http_error', 'invalid_json'):
            with self.subTest(mode=mode):
                self.storage = MemoryStorage()
                self.cache.unlink(missing_ok=True)
                self.now = stamp(hour=6, minute=47)
                self.sessions = []
                self.mode = mode
                worker = self.runtime()
                self.assertEqual(self.prepare(worker)['status'], 'generation_failed')
                self.now = stamp()
                result = initial_news(website_news.snapshot(), now=self.now,
                                      reviewed_digests=worker.reviewed_digests())
                self.assertEqual(result['edition_date'], '2026-10-05')
                self.assertNotIn('days/2026-10-06/edition.json', self.storage.values)
                self.assertLessEqual(len(self.sessions[0].calls), 8)
                self.sessions[0].close.assert_called_once()

    def test_application_wiring_uses_website_generator(self):
        tree = ast.parse((Path(__file__).parents[1] / 'line_bot.py').read_text())
        start = next(node.value for node in tree.body if isinstance(node, ast.Assign)
                     and any(isinstance(target, ast.Name) and target.id == '_daily_news' for target in node.targets))
        self.assertEqual(start.args[1].id, 'generate_website_edition')
        for code in ('generation_call_limit', 'generation_budget_required'):
            self.assertEqual(_safe_generation_error(RuntimeError(code)), code)


class OperationalStatusTests(unittest.TestCase):
    def setUp(self):
        names = ('ensure_daily_news_worker', '_ensure_stock_catalogue_worker',
                 '_ensure_dividend_warmer', 'api_news_publication')
        tree = ast.parse((Path(__file__).parents[1] / 'line_bot.py').read_text())
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
        self.app = Flask('operational-status')
        self.news, self.stocks, self.dividends = Mock(), Mock(), Mock()
        self.news.snapshot.return_value = {'status': 'prepared', 'edition_date': '2026-10-06'}
        scope = {'app': self.app, 'request': request, 'jsonify': jsonify,
                 '_daily_news': self.news, '_stock_search': self.stocks, '_dividend_snapshot': self.dividends,
                 '_news_config': {'configured': True, 'missing': []},
                 'OFFICIAL_NEWS_SOURCES': ('総務省統計局', '財務省'),
                 'configuration_metadata': lambda: configuration_metadata({})}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'operational-routes', 'exec'), scope)

    def test_existing_ci_wake_route_still_starts_all_workers(self):
        response = self.app.test_client().get('/api/news-publication?force=1&date=2030-01-01')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['edition_date'], '2026-10-06')
        self.assertEqual(response.cache_control.no_store, True)
        self.assertEqual(response.get_json()['generation_mode'], 'source_isolated')
        self.news.start.assert_called_once()
        self.stocks.ensure_refresh_worker.assert_called_once()
        self.dividends.ensure_refresh.assert_called_once()


if __name__ == '__main__':
    unittest.main()

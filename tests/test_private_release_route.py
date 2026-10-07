"""Exercise the production Flask wrapper without application startup side effects."""
import ast
import base64
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from flask import Flask, jsonify, request


ROOT = Path(__file__).resolve().parents[1]
TOKEN = base64.urlsafe_b64encode(b't' * 32).decode().rstrip('=')


class PrivateReleaseRouteTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask('private-release-wrapper')
        self.daily, self.stock, self.dividend = Mock(), Mock(), Mock()
        names = {'ensure_daily_news_worker', '_ensure_stock_catalogue_worker',
                 '_ensure_dividend_warmer', 'api_private_news_release_test'}
        tree = ast.parse((ROOT / 'line_bot.py').read_text(encoding='utf-8'))
        nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
        self.assertEqual(len(nodes), 4)
        context = {'app': self.app, 'request': request, 'jsonify': jsonify,
            '_daily_news': self.daily, '_stock_search': self.stock,
            '_dividend_snapshot': self.dividend, 'SUPABASE_URL': 'test', 'SUPABASE_KEY': 'test',
            'time': SimpleNamespace(time=lambda: 12345)}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'private-route', 'exec'), context)
        self.app.add_url_rule('/normal', 'normal', lambda: 'normal')
        self.client = self.app.test_client()

    def assert_no_workers(self):
        self.daily.start.assert_not_called()
        self.stock.ensure_refresh_worker.assert_not_called()
        self.dividend.ensure_refresh.assert_not_called()

    def test_post_uses_header_only_no_worker_or_cache(self):
        with patch('daily_news_runtime.SupabaseNewsStorage', return_value='reader') as store, \
                patch('news_release_test.private_preview_response', return_value=({'status': 'waiting'}, 200)) as read:
            response = self.client.post('/api/private-news-release-test?token=ignored',
                json={'id': 'a' * 32}, headers={'X-News-Test-Token': TOKEN})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {'status': 'waiting'})
        read.assert_called_once_with('reader', 'a' * 32, TOKEN, 12345)
        store.assert_called_once_with('test', 'test')
        self.assertEqual(response.headers['Cache-Control'], 'no-store, private')
        self.assertEqual(response.headers['X-Robots-Tag'], 'noindex, nofollow, noarchive')
        self.assert_no_workers()

    def test_json_token_or_query_token_is_not_authentication(self):
        with patch('daily_news_runtime.SupabaseNewsStorage', return_value='reader'), \
                patch('news_release_test.private_preview_response', return_value=({'status': 'not_found'}, 404)) as read:
            response = self.client.post('/api/private-news-release-test?token=secret',
                json={'id': 'a' * 32, 'token': 'secret'})
        self.assertEqual(response.status_code, 404)
        read.assert_not_called()
        self.assert_no_workers()

    def test_oversized_body_never_constructs_storage(self):
        with patch('daily_news_runtime.SupabaseNewsStorage') as store:
            response = self.client.post('/api/private-news-release-test', json={'id': 'a' * 3000})
        self.assertEqual(response.status_code, 404)
        store.assert_not_called()
        self.assert_no_workers()

    def test_storage_error_does_not_expose_message(self):
        with patch('daily_news_runtime.SupabaseNewsStorage', side_effect=RuntimeError('sensitive')):
            response = self.client.post('/api/private-news-release-test', json={'id': 'a' * 32},
                headers={'X-News-Test-Token': TOKEN})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json, {'status': 'not_found'})
        self.assert_no_workers()

    def test_get_cannot_read_test(self):
        response = self.client.get('/api/private-news-release-test')
        self.assertEqual(response.status_code, 405)

    def test_normal_requests_still_start_workers(self):
        self.assertEqual(self.client.get('/normal').status_code, 200)
        self.daily.start.assert_called_once()
        self.stock.ensure_refresh_worker.assert_called_once()
        self.dividend.ensure_refresh.assert_called_once()


if __name__ == '__main__':
    unittest.main()

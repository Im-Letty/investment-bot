"""Exercise the real public route with local state; never load production config."""
import ast
from datetime import datetime
from pathlib import Path
import unittest
from unittest.mock import Mock

from flask import Flask, jsonify, request


class MorningNewsAPITests(unittest.TestCase):
    def setUp(self):
        tree = ast.parse((Path(__file__).parents[1] / 'line_bot.py').read_text())
        route = next(n for n in tree.body if isinstance(n, ast.FunctionDef)
                     and n.name == 'api_morning_news')
        self.app = Flask('morning-news-cache')
        self.feed = Mock()
        self.feed.snapshot.return_value = {'local_only': True}
        self.select = Mock(return_value={'news': [], 'supplements': [], 'fetched_at': None})
        translations = Mock()
        translations.snapshot.return_value = ([], False)
        scope = dict(app=self.app, request=request, jsonify=jsonify, datetime=datetime,
                     website_news=self.feed, select_daily_news=self.select,
                     PUBLISHED_NEWS_SOURCES=(), load_reviewed_supplements=lambda: [],
                     load_reviewed_digests=lambda: [], news_translations=translations)
        exec(compile(ast.Module(body=[route], type_ignores=[]), 'morning-api', 'exec'), scope)

    def test_normal_read_remains_nonblocking_and_uncached(self):
        response = self.app.test_client().get('/api/morning-news?lang=ja')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['news'], [])
        self.assertTrue(response.cache_control.no_store)
        self.assertEqual(response.headers['X-KN-News-Pipeline'], '20261027-r1')
        self.feed.snapshot.assert_called_once_with(wait=False)

    def test_failed_read_is_uncached_without_upstream_error_text(self):
        self.select.side_effect = ValueError('https://fixture.invalid/private?key=fixture')
        response = self.app.test_client().get('/api/morning-news')
        self.assertTrue(response.cache_control.no_store)
        self.assertEqual(response.get_json(), {'error': 'news_unavailable', 'news': []})
        self.assertNotIn('fixture', response.get_data(as_text=True))


if __name__ == '__main__':
    unittest.main()

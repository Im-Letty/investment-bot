import ast
import gzip
import io
from pathlib import Path
from threading import Event, Lock
import unittest
from unittest.mock import Mock, patch

from flask import Flask
from news_cache import HeadlineTranslations, NEWS_FEEDS, NewsCache, fetch_feed


class NewsCacheTests(unittest.TestCase):
    def settle(self, cache):
        with cache._condition:
            self.assertTrue(cache._condition.wait_for(lambda: not cache._refreshing, timeout=2))

    def test_parallel_cold_fetch_and_immutable_fresh_snapshot(self):
        entered, release, lock, calls = Event(), Event(), Lock(), []
        def fetch(url):
            with lock:
                calls.append(url)
                if len(calls) == 4:
                    entered.set()
            self.assertTrue(release.wait(2))
            return [url + ' headline']
        cache = NewsCache(dict(zip('ABCD', 'abcd')), fetcher=fetch, clock=lambda: 1000)
        self.assertTrue(cache.snapshot(wait=False)['refreshing'])
        try:
            self.assertTrue(entered.wait(1), 'All four feeds must start before any completes')
            for _ in range(8):
                self.assertEqual(cache.snapshot(wait=False)['news'], [])
            self.assertEqual(len(calls), 4, 'Concurrent visitors must share one refresh')
        finally:
            release.set()
        self.settle(cache)
        snapshot = cache.snapshot()
        self.assertEqual([x['source'] for x in snapshot['news']], list('ABCD'))
        self.assertEqual(snapshot['fetched_at'], 1000)
        snapshot['news'][0]['title'] = 'modified by caller'
        snapshot['source_fetched_at']['A'] = 0
        self.assertEqual(cache.snapshot()['news'][0]['title'], 'a headline')
        self.assertEqual(cache.snapshot()['source_fetched_at']['A'], 1000)
        self.assertEqual(len(calls), 4)

    def test_cold_wait_is_bounded_and_stale_refresh_returns_without_waiting(self):
        release, entered, now = Event(), Event(), [1000]
        def fetch(_):
            entered.set()
            release.wait(2)
            return ['headline']
        cache = NewsCache({'A': 'a'}, fetcher=fetch, clock=lambda: now[0], cold_wait=.01, ttl=10)
        first = cache.snapshot()
        self.assertEqual(first['news'], [])
        self.assertTrue(first['refreshing'])
        release.set(); self.settle(cache)
        now[0] += 11; release.clear(); entered.clear()
        stale = cache.snapshot()
        try:
            self.assertTrue(stale['stale'])
            self.assertEqual(stale['fetched_at'], 1000)
            self.assertTrue(stale['refreshing'])
            self.assertTrue(entered.wait(1))
        finally:
            release.set()
        self.settle(cache)

    def test_partial_and_total_failures_preserve_times_backoff_and_expiry(self):
        now, failed, calls = [1000], set(), []
        def fetch(url):
            calls.append(url)
            if url in failed:
                raise OSError('upstream unavailable')
            return [url + str(now[0])]
        cache = NewsCache({'A': 'a', 'B': 'b'}, fetcher=fetch, clock=lambda: now[0], ttl=10, max_stale=30, retry_after=5)
        cache.snapshot(); self.settle(cache)
        now[0] = 1011; failed.add('b')
        cache.snapshot(); self.settle(cache)
        current = cache.snapshot()
        self.assertEqual(current['source_fetched_at'], {'A': 1011, 'B': 1000})
        self.assertEqual(current['fetched_at'], 1000)
        self.assertTrue(current['stale'])
        failed.add('a'); now[0] = 1017
        cache.snapshot(); self.settle(cache)
        count = len(calls)
        now[0] = 1018
        self.assertEqual(cache.snapshot()['fetched_at'], 1000)
        self.assertEqual(len(calls), count)
        now[0] = 1042
        cache.snapshot(); self.settle(cache)
        self.assertEqual(cache.snapshot()['news'], [])
        self.assertIsNone(cache.snapshot()['fetched_at'])

    def test_first_completed_feed_is_available_while_other_feed_is_slow(self):
        release = Event()
        def fetch(url):
            if url == 'b':
                release.wait(2)
            return [url]
        cache = NewsCache({'A': 'a', 'B': 'b'}, fetcher=fetch)
        try:
            first = cache.snapshot()
            self.assertEqual(first['news'], [{'source': 'A', 'title': 'a'}])
            self.assertTrue(first['refreshing'])
        finally:
            release.set()
        self.settle(cache)

    def test_network_fetch_uses_timeout_and_parses_response_bytes(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.headers = {}
        xml = b'<rss><channel><item><title>News</title></item></channel></rss>'
        response.read1.side_effect = io.BytesIO(xml).read1
        with patch('news_cache.urlopen', return_value=response) as get:
            self.assertEqual(fetch_feed('https://example.test/rss'), ('News',))
            request = get.call_args.args[0]
            self.assertEqual(request.full_url, 'https://example.test/rss')
            self.assertTrue(request.get_header('User-agent').startswith('feedparser/'))
            self.assertEqual(request.get_header('Accept-encoding'), 'identity')
            self.assertEqual(get.call_args.kwargs, {'timeout': 8})
        response.read1.side_effect = io.BytesIO(b'x' * 2_000_001).read1
        with patch('news_cache.urlopen', return_value=response):
            with self.assertRaises(ValueError):
                fetch_feed('https://example.test/rss')

    def test_network_fetch_bounds_gzip_and_total_read_time(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.headers = {'Content-Encoding': 'gzip'}
        xml = b'<rss><channel><item><title>News</title></item></channel></rss>'
        response.read1.side_effect = io.BytesIO(gzip.compress(xml)).read1
        with patch('news_cache.urlopen', return_value=response):
            self.assertEqual(fetch_feed('https://example.test/rss'), ('News',))
        response.read1.side_effect = io.BytesIO(gzip.compress(b'x' * 2_000_001)).read1
        with patch('news_cache.urlopen', return_value=response):
            with self.assertRaisesRegex(ValueError, 'decoded size'):
                fetch_feed('https://example.test/rss')
        response.read1.side_effect = io.BytesIO(xml).read1
        response.headers = {}
        with patch('news_cache.urlopen', return_value=response), patch('news_cache.time.monotonic', side_effect=[0, 0, 11]):
            with self.assertRaisesRegex(ValueError, 'time budget'):
                fetch_feed('https://example.test/rss')


class TranslationTests(unittest.TestCase):
    def test_pending_translation_is_shared_and_never_blocks_current_news(self):
        release, entered, calls = Event(), Event(), []
        def translate(title, lang):
            calls.append((title, lang)); entered.set(); release.wait(2)
            return 'Translated ' + title
        service = HeadlineTranslations(translate)
        news = [{'source': 'A', 'title': '今日'}]
        try:
            initial, pending = service.snapshot(news, 'en')
            self.assertEqual(initial, news)
            self.assertTrue(pending)
            self.assertTrue(entered.wait(1))
            for _ in range(5):
                service.snapshot(news, 'en')
            self.assertEqual(len(calls), 1)
            self.assertEqual(service.snapshot(news, 'ja'), (news, False))
        finally:
            release.set()
        with service._condition:
            self.assertTrue(service._condition.wait_for(lambda: not service._pending, timeout=2))
        translated, pending = service.snapshot(news, 'en')
        self.assertFalse(pending)
        self.assertEqual(translated[0]['title'], 'Translated 今日')
        self.assertEqual(news[0]['title'], '今日')

    def test_failed_translations_back_off_and_cache_is_bounded(self):
        calls = []
        def fail(title, lang):
            calls.append(title)
            raise OSError('offline')
        service = HeadlineTranslations(fail)
        for i in range(3):
            items = [{'source': 'A', 'title': str(n + i * 28)} for n in range(28)]
            service.snapshot(items, 'en')
            with service._condition:
                self.assertTrue(service._condition.wait_for(lambda: not service._pending, timeout=2))
            self.assertFalse(service.snapshot(items, 'en')[1])
        self.assertEqual(len(calls), 84)
        self.assertLessEqual(len(service._cache['en']), 64)


class RouteCompatibilityTests(unittest.TestCase):
    def test_html_revalidates_and_only_hashed_features_get_long_cache(self):
        import re
        from flask import request, send_file
        root = Path(__file__).parents[1]
        tree = ast.parse((root / 'line_bot.py').read_text())
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                 and node.name in ('index', 'cache_versioned_features')]
        app = Flask('file-cache-test', root_path=str(root), static_folder='static')
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'file-routes', 'exec'),
             dict(app=app, request=request, send_file=send_file, re=re))
        client = app.test_client()
        first = client.get('/')
        try:
            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.cache_control.max_age, 0)
            again = client.get('/', headers={'If-None-Match': first.headers['ETag']})
            self.assertEqual(again.status_code, 304)
            again.close()
        finally:
            first.close()
        for name in ('simulator-embed-55a2f12d18.html', 'pet-features-855cb201bd.js'):
            response = client.get('/static/' + name)
            self.assertEqual(response.cache_control.max_age, 31536000)
            response.close()
        response = client.get('/static/passkey-auth.js')
        self.assertNotEqual(response.cache_control.max_age, 31536000)
        response.close()

    def test_existing_report_shape_and_api_metadata(self):
        # Compile only these pure route wrappers, without application startup,
        # credentials, external SDKs or production provisioning.
        tree = ast.parse((Path(__file__).parents[1] / 'line_bot.py').read_text())
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                 and node.name in ('fetch_news', 'api_morning_news')]
        app = Flask('news-test')
        from flask import jsonify, request
        from datetime import datetime
        snapshot = {'news': [{'source': 'NHK経済', 'title': '見出し'}], 'fetched_at': 1000,
                    'source_fetched_at': {'NHK経済': 1000}, 'stale': True, 'refreshing': True}
        cache = Mock(); cache.snapshot.return_value = snapshot
        translator = Mock(); translator.snapshot.return_value = (snapshot['news'], False)
        context = dict(app=app, request=request, jsonify=jsonify, datetime=datetime,
                       news_cache=cache, news_translations=translator, NEWS_FEEDS=NEWS_FEEDS)
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'news-routes', 'exec'), context)
        self.assertEqual(context['fetch_news'](), {source: '・見出し' if source == 'NHK経済' else '' for source in NEWS_FEEDS})
        response = app.test_client().get('/api/morning-news?lang=unknown')
        data = response.get_json()
        self.assertEqual(data['lang'], 'ja')
        self.assertEqual(data['fetched_at'], 1000)
        self.assertTrue(data['refreshing'])
        self.assertTrue(data['stale'])
        translator.snapshot.assert_called_once_with(snapshot['news'], 'ja')


if __name__ == '__main__':
    unittest.main()

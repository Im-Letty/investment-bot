import ast
from copy import deepcopy
from datetime import datetime
from html.parser import HTMLParser
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from flask import Flask, request
from news_initial import (NEWS_PLACEHOLDER, initial_news,
                          news_index_response, render_initial_html, render_news_markup)


ROOT = Path(__file__).parents[1]


def timestamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


NOW = timestamp('2026-09-22T04:00:00Z')


def article(title='Original headline', published='2026-09-22T00:25:00Z'):
    return {'source': 'NHK経済', 'url': 'https://news.example/current', 'title': title,
            'published_at': timestamp(published)}


def review(items=None, **fields):
    return {'edition_date': '2026-09-22', 'lang': 'ja', 'headline': '今日の経済ニュース',
            'summary': '確認済みの記事をわかりやすく説明する文章です。' * 10,
            'article_refs': deepcopy([article()] if items is None else items), **fields}


def cold():
    return {'news': [], 'fetched_at': None, 'source_fetched_at': {},
            'source_status': {'NHK経済': 'pending'},
            'source_refreshing': {'NHK経済': True}, 'refreshing': True}


def live(items=None, **fields):
    return {'news': [article()] if items is None else items, 'fetched_at': NOW - 10,
            'source_fetched_at': {'NHK経済': NOW - 10},
            'source_status': {'NHK経済': 'ok'}, 'source_refreshing': {'NHK経済': False},
            'source_stale': {'NHK経済': False}, 'refreshing': False, **fields}


class ParsedInitial(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.ids = []
        self.json = ''
        self.script = False
        self.scripts = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            self.ids.append(attrs['id'])
        if tag == 'script':
            self.scripts.append(attrs)
            self.script = attrs.get('id') == 'knInitialNews'

    def handle_endtag(self, tag):
        if tag == 'script':
            self.script = False

    def handle_data(self, data):
        if self.script:
            self.json += data


class InitialSelectionTests(unittest.TestCase):
    def test_curated_two_article_edition_is_identical_for_cold_empty_and_partial_feeds(self):
        first = article()
        second = {**article('Second article'), 'url': 'https://reuters.example/current', 'source': 'ロイター経済'}
        authored = review([first, second], summary='文' * 250, publication_mode='curated', reviewed_at=NOW - 60)
        for raw in (cold(), live([]), live([first])):
            with self.subTest(raw=raw):
                data = initial_news(raw, now=NOW, reviewed_digests=[authored])
                self.assertEqual(data['delivery'], 'published')
                self.assertEqual(data['policy_version'], 4)
                self.assertIsNone(data['fetched_at'])
                self.assertEqual(data['digest'], authored)
                self.assertEqual(len(data['news']), 2)
                html = render_initial_html(NEWS_PLACEHOLDER, data)
                self.assertIn(authored['summary'], html)
                self.assertIn(second['url'], html)
                self.assertNotIn('読み込み中', html)

    def test_curated_conflict_or_future_review_cannot_reenter_through_cold_fallback(self):
        first = article()
        second = {**article('Second article'), 'url': 'https://reuters.example/current', 'source': 'ロイター経済'}
        authored = review([first, second], summary='文' * 250, publication_mode='curated', reviewed_at=NOW - 60)
        expired = live([article('Corrected headline')], source_fetched_at={'NHK経済': NOW - 901})
        self.assertIsNone(initial_news(expired, now=NOW, reviewed_digests=[authored]))
        self.assertIsNone(initial_news(cold(), now=NOW, reviewed_digests=[{**authored, 'reviewed_at': NOW + 1}]))
        self.assertIsNone(initial_news(cold(), now=timestamp('2026-09-22T15:00:00Z'), reviewed_digests=[authored]))

    def test_cold_publication_is_readable_without_fabricated_retrieval_time(self):
        reviews = [review()]
        data = initial_news(cold(), now=NOW, reviewed_digests=reviews)
        self.assertEqual(data['delivery'], 'published')
        self.assertIsNone(data['fetched_at'])
        self.assertEqual(data['digest']['summary'], reviews[0]['summary'])
        self.assertTrue(data['refreshing'])
        html = render_initial_html(NEWS_PLACEHOLDER, data)
        self.assertIn(reviews[0]['summary'], html)
        self.assertNotIn('読み込み中', html)
        self.assertNotIn('取得 ', html)
        self.assertIn('2026/09/22 掲載', html)
        parsed = ParsedInitial(html)
        self.assertEqual(parsed.ids.count('morning-news-content'), 1)
        self.assertEqual(parsed.ids.count('knNewsDigest'), 1)
        self.assertEqual(parsed.ids.count('knInitialNews'), 1)
        self.assertEqual(json.loads(parsed.json), data)

    def test_successful_current_feed_selection_overrides_incompatible_published_review(self):
        changed = article('New original headline')
        data = initial_news(live([changed]), now=NOW, reviewed_digests=[review()])
        self.assertNotIn('delivery', data)
        self.assertIsNone(data['digest'])
        self.assertEqual(data['news'][0]['title'], changed['title'])
        html = render_news_markup(data)
        self.assertIn(changed['title'], html)
        self.assertIn('本日のまとめはまだ掲載されていません', html)
        self.assertNotIn(review()['summary'], html)
        self.assertIn('取得 ', html)

    def test_confirmed_empty_today_is_not_replaced_by_authored_news(self):
        data = initial_news(live([]), now=NOW, reviewed_digests=[review()])
        self.assertEqual(data['selection_status'], 'empty_today')
        self.assertEqual(data['news'], [])
        self.assertIsNone(data['digest'])

    def test_expired_or_missing_live_timestamp_can_use_only_today_review(self):
        for stamp in (None, NOW - 900, NOW + 1):
            raw = live(source_fetched_at={} if stamp is None else {'NHK経済': stamp})
            data = initial_news(raw, now=NOW, reviewed_digests=[review()])
            self.assertEqual(data['delivery'], 'published')
            self.assertIsNone(data['fetched_at'])
        next_day = timestamp('2026-09-22T15:00:00Z')
        self.assertIsNone(initial_news(cold(), now=next_day, reviewed_digests=[review()]))

    def test_invalid_ambiguous_future_and_duplicate_article_publications_fail_closed(self):
        future = review([article(published='2026-09-22T05:00:00Z')])
        duplicate = review([article(), article('Changed title for same URL')])
        for values in ([], [None], [review(), review()], [future], [duplicate],
                       [review(summary='Too short')], [review(summary='文' * 199)],
                       [review(summary='文' * 301)], [review(edition_date='2026-09-21')]):
            with self.subTest(values=values):
                self.assertIsNone(initial_news(cold(), now=NOW, reviewed_digests=values))
        unsafe = article(); unsafe['url'] = 'javascript:alert(1)'
        self.assertIsNone(initial_news(cold(), now=NOW, reviewed_digests=[review([unsafe])]))

    def test_escaping_cannot_create_script_or_inject_markup_and_json_roundtrips(self):
        bad = '</script><script>alert(1)</script>\u2028\u2029'
        ref = article(bad)
        ref['url'] = 'https://news.example/?value="&other=1'
        # URL validation may reject a quote; use a valid encoded URL while
        # retaining adversarial text in headline, summary and source title.
        ref['url'] = 'https://news.example/?value=%22&other=1'
        authored = review([ref], headline=bad, summary=bad + '説明文です。' * 35)
        data = initial_news(cold(), now=NOW, reviewed_digests=[authored])
        html = render_initial_html(NEWS_PLACEHOLDER, data)
        self.assertIn('&lt;/script&gt;', html)
        self.assertNotIn('<script>alert', html)
        self.assertIn('\\u003c/script>', html)
        self.assertIn('\\u2028', html)
        self.assertIn('\\u2029', html)
        parsed = ParsedInitial(html)
        self.assertEqual(parsed.scripts, [{'type': 'application/json', 'id': 'knInitialNews'}])
        self.assertEqual(json.loads(parsed.json), data)
        self.assertEqual(len(parsed.ids), len(set(parsed.ids)))


class InitialResponseTests(unittest.TestCase):
    def setUp(self):
        self.folder = TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name) / 'index.html'
        self.path.write_text('<html><body>' + NEWS_PLACEHOLDER + '</body></html>', encoding='utf-8')
        self.cache = Mock()
        self.cache.snapshot.return_value = cold()
        self.reviews = [review()]
        self.now = NOW
        self.app = Flask('initial-news-test')
        self.app.add_url_rule('/', view_func=lambda: news_index_response(self.path, self.cache, request, now=self.now))
        self.client = self.app.test_client()
        for target, result in (('load_reviewed_digests', lambda: self.reviews), ('load_reviewed_supplements', lambda: [])):
            p = patch('news_initial.' + target, side_effect=result)
            p.start(); self.addCleanup(p.stop)

    def test_refresh_is_started_nonblocking_before_file_load(self):
        events = []
        self.cache.snapshot.side_effect = lambda **kwargs: events.append(('snapshot', kwargs)) or cold()
        read = Path.read_text
        def track_read(path, *args, **kwargs):
            events.append(('read', path))
            return read(path, *args, **kwargs)
        with patch.object(Path, 'read_text', track_read):
            response = self.client.get('/')
        self.assertEqual(events[0], ('snapshot', {'wait': False}))
        self.assertEqual(response.status_code, 200)
        self.assertIn(self.reviews[0]['summary'], response.get_data(as_text=True))

    def test_root_revalidates_and_leaves_existing_edge_compression_in_place(self):
        plain = self.client.get('/')
        self.assertNotIn('Content-Encoding', plain.headers)
        self.assertTrue(plain.cache_control.no_cache)
        self.assertEqual(plain.cache_control.max_age, 0)
        accepted = self.client.get('/', headers={'Accept-Encoding': 'gzip'})
        self.assertNotIn('Content-Encoding', accepted.headers)
        self.assertEqual(accepted.data, plain.data)
        self.assertEqual(accepted.headers['ETag'], plain.headers['ETag'])

    def test_conditional_response_changes_with_publication_and_midnight(self):
        first = self.client.get('/')
        same = self.client.get('/', headers={'If-None-Match': first.headers['ETag']})
        self.assertEqual(same.status_code, 304)
        self.reviews[0]['headline'] = '変更された見出し'
        revised = self.client.get('/', headers={'If-None-Match': first.headers['ETag']})
        self.assertEqual(revised.status_code, 200)
        self.assertIn('変更された見出し', revised.get_data(as_text=True))
        self.now = timestamp('2026-09-22T15:00:00Z')
        tomorrow = self.client.get('/', headers={'If-None-Match': revised.headers['ETag']})
        self.assertEqual(tomorrow.status_code, 200)
        self.assertNotIn('brief-summary', tomorrow.get_data(as_text=True))
        self.assertNotIn('knInitialNews', tomorrow.get_data(as_text=True))
        self.now += 86400
        empty_next = self.client.get('/', headers={'If-None-Match': tomorrow.headers['ETag']})
        self.assertEqual(empty_next.data, tomorrow.data)
        self.assertEqual(empty_next.status_code, 200)

    def test_production_index_route_wires_nonblocking_initial_response(self):
        tree = ast.parse((ROOT / 'line_bot.py').read_text(encoding='utf-8'))
        node = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'index')
        app = Flask('real-index-wrapper', root_path=str(ROOT))
        context = {'app': app, 'os': os, 'request': request, 'news_cache': self.cache,
                   'news_index_response': lambda path, cache, req: news_index_response(path, cache, req, now=NOW)}
        exec(compile(ast.Module(body=[node], type_ignores=[]), 'index-wrapper', 'exec'), context)
        response = app.test_client().get('/')
        html = response.get_data(as_text=True)
        self.assertIn(self.reviews[0]['summary'], html)
        self.assertIn('knInitialNews', html)
        self.cache.snapshot.assert_called_with(wait=False)


if __name__ == '__main__':
    unittest.main()

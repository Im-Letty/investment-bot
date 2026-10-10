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
from news_cache import LEAD_OTHER_NEWS_STRUCTURE
from news_copy_policy import COPY_LENGTH_POLICY
from news_initial import (NEWS_PLACEHOLDER, initial_news,
                          news_index_response, render_initial_html, render_news_markup, render_initial_market)


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



def official_review(precision='second'):
    ref = {'source': '財務省', 'url': 'https://www.mof.go.jp/policy/example.html',
           'title': '確認した公的発表', 'published_date': '2026-09-21',
           'published_at': None if precision == 'day' else timestamp('2026-09-21T12:00:00+09:00'),
           'publication_precision': precision, 'body_sha256': 'a' * 64,
           'body_verified_at': timestamp('2026-09-22T07:00:00+09:00'),
           'selection_route': 'date_only' if precision == 'day' else 'main'}
    return review([ref], publication_mode='curated',
                  reviewed_at=timestamp('2026-09-22T07:45:00+09:00'),
                  publish_at=timestamp('2026-09-22T08:00:00+09:00'),
                  source_window={'version': 1, 'edition_date': '2026-09-22',
                                 'window_start': timestamp('2026-09-21T08:00:00+09:00'),
                                 'carryover_start': timestamp('2026-09-21T07:30:00+09:00'),
                                 'cutoff_at': timestamp('2026-09-22T07:30:00+09:00')},
                  article_summaries=[{**ref, 'headline': '読みやすい個別の見出し',
                                      'summary': '公的な発表の内容を確認して説明する文章です。' * 10}])


class ParsedInitial(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.ids = []
        self.json = ''
        self.script = False
        self.scripts = []
        self.links = []
        self.current_link = None
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            self.ids.append(attrs['id'])
        if tag == 'a':
            self.current_link = {'attrs': attrs, 'text': ''}
            self.links.append(self.current_link)
        if tag == 'script':
            self.scripts.append(attrs)
            self.script = attrs.get('id') == 'knInitialNews'

    def handle_endtag(self, tag):
        if tag == 'script':
            self.script = False
        if tag == 'a':
            self.current_link = None

    def handle_data(self, data):
        if self.script:
            self.json += data
        if self.current_link is not None:
            self.current_link['text'] += data


class InitialSelectionTests(unittest.TestCase):
    def test_lead_and_other_news_structure_shows_only_other_stories_and_keeps_all_embedded_copy(self):
        for count in (1, 2, 3):
            with self.subTest(count=count):
                authored = official_review('day')
                ref = authored['article_refs'][0]
                authored.update(copy_length_policy=COPY_LENGTH_POLICY,
                                reading_structure=LEAD_OTHER_NEWS_STRUCTURE,
                                summary='先頭のニュースを短く紹介します。')
                authored['article_refs'] = [{**ref, 'title': f'別の公式発表{i}',
                    'source': '総務省統計局' if i % 2 else '財務省',
                    'url': f'https://{"www.stat.go.jp" if i % 2 else "www.mof.go.jp"}/policy/example{i}.html'}
                    for i in range(count)]
                authored['article_summaries'] = [{**item, 'headline': f'独立した見出し{i}<img>',
                    'summary': f'独立して読める記事{i}です。\n\n確認した内容を説明します。'}
                    for i, item in enumerate(authored['article_refs'])]
                original = deepcopy(authored)
                data = initial_news(cold(), now=NOW, reviewed_digests=[authored])
                html = render_initial_html(NEWS_PLACEHOLDER, data)
                markup = html.split('<script type="application/json"', 1)[0]
                self.assertIn(authored['summary'], markup)
                self.assertNotIn('独立した見出し0', markup)
                self.assertNotIn('独立して読める記事0', markup)
                self.assertEqual(markup.count('class="story summarized-story"'), count - 1)
                self.assertIn('class="read-more"', markup)
                for i in range(1, count):
                    self.assertIn(f'独立した見出し{i}&lt;img&gt;', markup)
                    self.assertIn(authored['article_summaries'][i]['summary'], markup)
                self.assertNotIn('<img>', markup)
                self.assertIn('datetime="2026-09-21" title="発表 2026/9/21">9/21 発表</time>', markup)
                self.assertIn('href="https://www.mof.go.jp/policy/example0.html"', markup)
                before_sources, after_sources = markup.split('class="article-sources"', 1)
                self.assertIn('<details class="read-more"', before_sources)
                self.assertEqual(ParsedInitial(before_sources).links, [])
                self.assertNotIn('class="news-info"', before_sources)
                source_row = after_sources.split('</details>', 1)[0]
                links = ParsedInitial(source_row).links
                self.assertEqual(len(links), count)
                for item in authored['article_refs']:
                    matching = [link for link in links if link['attrs'].get('href') == item['url']]
                    self.assertEqual(len(matching), 1)
                    self.assertEqual(matching[0]['text'], item['source'] + ' ↗')
                    self.assertEqual(matching[0]['attrs'].get('rel'), 'noopener noreferrer')
                    self.assertIn(item['title'], matching[0]['attrs'].get('title', ''))
                    self.assertIn(item['title'], matching[0]['attrs'].get('aria-label', ''))
                self.assertEqual(markup.count('class="news-info-note">公式発表をもとに要約</p>'), 1)
                self.assertIn('<details class="news-info"', source_row)
                self.assertIn('class="news-info-note">公式発表をもとに要約</p>', source_row)
                info_key = 'summary-info:' + authored['article_refs'][0]['url']
                self.assertIn(f'data-news-key="{info_key}"', source_row)
                self.assertIn(f'data-news-focus="{info_key}"', source_row)
                self.assertNotIn('class="news-footer"', markup)
                if count > 1:
                    self.assertIn('ほかのニュース', markup)
                    self.assertNotIn('もっと詳しく', markup)
                else:
                    self.assertIn('記事の出典', markup)
                    self.assertNotIn('ほかのニュース', markup)
                self.assertEqual(json.loads(ParsedInitial(html).json)['digest'], original)
                self.assertEqual(authored, original)
                # Existing saved official editions keep their original design.
                del authored['reading_structure']
                legacy = render_news_markup(initial_news(cold(), now=NOW, reviewed_digests=[authored]))
                self.assertEqual(legacy.count('class="story summarized-story"'), count)
                self.assertIn('もっと詳しく', legacy)

    def test_official_edition_renders_source_date_separately_from_edition_without_invented_time(self):
        for precision in ('second', 'day'):
            authored = official_review(precision)
            data = {'delivery': 'published', 'edition_date': authored['edition_date'],
                    'news': deepcopy(authored['article_refs']), 'supplements': [], 'digest': authored}
            html = render_initial_html(NEWS_PLACEHOLDER, data)
            self.assertIn('aria-label="掲載対象日 2026-09-22 ', html)
            self.assertIn('公式発表をもとに要約', html)
            self.assertIn('財務省', html)
            self.assertIn('読みやすい個別の見出し', html)
            if precision == 'day':
                self.assertIn('datetime="2026-09-21" title="発表 2026/9/21">9/21 発表</time>', html)
                self.assertNotIn('JST', html)
                self.assertNotIn('1970', html)
                self.assertIsNone(json.loads(ParsedInitial(html).json)['news'][0]['published_at'])
            else:
                self.assertIn('datetime="2026-09-21T03:00:00.000Z"', html)
                self.assertIn('発表 2026/9/21 12:00 JST', html)
            self.assertEqual(json.loads(ParsedInitial(html).json)['news'][0]['published_date'], '2026-09-21')

    def test_official_morning_edition_keeps_prior_source_day_on_cold_start(self):
        for precision in ('second', 'day'):
            authored = official_review(precision)
            data = initial_news(cold(), now=NOW, reviewed_digests=[authored])
            self.assertIsNotNone(data)
            self.assertEqual(data['delivery'], 'published')
            self.assertEqual(data['edition_date'], '2026-09-22')
            self.assertEqual(data['news'][0]['published_date'], '2026-09-21')
            self.assertEqual(data['news'][0]['published_at'], authored['article_refs'][0]['published_at'])
            self.assertIsNone(data['fetched_at'])
            self.assertEqual(data['digest']['source_window'], authored['source_window'])

    def test_flexible_reviewed_copy_is_identical_in_initial_markup_and_embedded_payload(self):
        for precision in ('second', 'day'):
            authored = official_review(precision)
            authored.update(copy_length_policy=COPY_LENGTH_POLICY, summary='概' * 330)
            authored['article_summaries'][0]['summary'] = '説' * 220 + '\n\n' + '補' * 218
            original = deepcopy(authored)
            data = initial_news(cold(), now=NOW, reviewed_digests=[authored])
            self.assertEqual(data['delivery'], 'published')
            self.assertEqual(data['digest'], authored)
            html = render_initial_html(NEWS_PLACEHOLDER, data)
            self.assertIn(authored['summary'], html)
            self.assertIn(authored['article_summaries'][0]['summary'].split('\n\n')[1], html)
            embedded = json.loads(ParsedInitial(html).json)
            self.assertEqual(embedded['digest'], authored)
            self.assertEqual(authored, original)

    def test_market_values_arrive_in_first_html_with_original_time_and_safe_json(self):
        quote = {'price': 42000, 'pct': 1, 'change_value': 420,
                 'currency': 'JPY', 'change_unit': 'currency',
                 'display': '42,000 </script><script>bad()</script>', 'fetched_at': NOW - 3600}
        data = {'market': {'日経225': quote}, 'fetched_at': NOW - 3600, 'stale': True}
        html = render_initial_market('<head></head><body></body>', data, now=NOW)
        self.assertIn('id="knInitialMarket"', html)
        self.assertNotIn('<script>bad()', html)
        payload = json.loads(html.split('id="knInitialMarket">', 1)[1].split('</script>', 1)[0])
        self.assertEqual(payload['market']['日経225']['fetched_at'], NOW - 3600)
        self.assertEqual(payload['market']['日経225']['price'], 42000)
        expired = {**data, 'market': {'日経225': {**quote, 'fetched_at': NOW - 7 * 86400}}}
        self.assertNotIn('knInitialMarket', render_initial_market('<head></head>', expired, now=NOW))

    def test_article_summaries_are_readable_together_inside_more_with_escaped_copy(self):
        first = article()
        second = {**article('Second article'), 'url': 'https://reuters.example/current', 'source': 'ロイター経済'}
        summaries = [{**item, 'headline': f'やさしい見出し{number}<img>',
                      'summary': '確認した記事をやさしく説明する文章です。' * 10 + '<script>bad()</script>'}
                     for number, item in enumerate([first, second])]
        authored = review([first, second], publication_mode='curated', reviewed_at=NOW - 60,
                          article_summaries=summaries)
        data = initial_news(cold(), now=NOW, reviewed_digests=[authored])
        html = render_initial_html(NEWS_PLACEHOLDER, data)
        detail = html.split('<details class="read-more"', 1)[1].split('</details>', 1)[0]
        self.assertEqual(detail.count('class="article-summary"'), 2)
        self.assertEqual(detail.count('class="story summarized-story" lang="ja"'), 2)
        self.assertNotIn('<details class="story"', detail)
        self.assertNotIn('stories-intro', detail)
        self.assertIn('やさしい見出し0&lt;img&gt;', detail)
        self.assertIn('&lt;script&gt;bad()&lt;/script&gt;', detail)
        self.assertNotIn('<img>', detail)
        self.assertNotIn('<script>', detail)
        for item in (first, second):
            self.assertIn(f'href="{item["url"]}"', detail)
        self.assertEqual(json.loads(ParsedInitial(html).json)['digest']['article_summaries'], summaries)

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
        retained = initial_news(cold(), now=timestamp('2026-09-22T15:00:00Z'), reviewed_digests=[authored])
        self.assertEqual(retained['edition_date'], '2026-09-22')
        self.assertIn('aria-label="掲載対象日 2026-09-22 ', render_news_markup(retained))

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
        self.assertIn('aria-label="掲載対象日 2026-09-22 ', html)
        parsed = ParsedInitial(html)
        self.assertEqual(parsed.ids.count('morning-news-content'), 1)
        self.assertEqual(parsed.ids.count('knNewsDigest'), 1)
        self.assertEqual(parsed.ids.count('knInitialNews'), 1)
        self.assertEqual(json.loads(parsed.json), data)

    def test_successful_current_feed_selection_overrides_incompatible_published_review(self):
        changed = article('New original headline')
        data = initial_news(live([changed]), now=NOW, reviewed_digests=[review()])
        self.assertEqual(data['delivery'], 'headlines')
        self.assertIsNone(data['digest'])
        self.assertEqual(data['news'][0]['title'], changed['title'])
        html = render_news_markup(data)
        self.assertIn(changed['title'], html)
        self.assertIn('本日の要約は未掲載です', html)
        self.assertNotIn(review()['summary'], html)
        self.assertIn('取得 ', html)

    def test_after_eight_initial_html_shows_today_headlines_instead_of_old_summary(self):
        old_article = {**article('Old reviewed article', '2026-09-21T03:00:00Z'),
                       'url': 'https://news.example/old'}
        authored = review([old_article], edition_date='2026-09-21', summary='前号の説明。' * 40,
                          publication_mode='curated', reviewed_at=timestamp('2026-09-21T04:00:00Z'))
        current = article('Current headline <img>')
        data = initial_news(live([current]), now=NOW, reviewed_digests=[authored])
        self.assertEqual(data['delivery'], 'headlines')
        self.assertEqual(data['edition_date'], '2026-09-22')
        self.assertEqual(data['previous_edition_date'], '2026-09-21')
        self.assertIsNone(data['digest'])
        html = render_initial_html(NEWS_PLACEHOLDER, data)
        brief = html.split('<div class="brief">', 1)[1].split('<details class="read-more"', 1)[0]
        self.assertIn('今日の見出し', brief)
        self.assertIn('2026/09/22 · 本日の要約は未掲載です。', brief)
        self.assertIn('<ul class="headline-list"><li><a class="story-title" href="https://news.example/current"', brief)
        self.assertIn('rel="noopener noreferrer">Current headline &lt;img&gt;</a>', brief)
        self.assertEqual(brief.count('Current headline &lt;img&gt;'), 1)
        self.assertNotIn('<details class="read-more"', html)
        self.assertNotIn(authored['summary'], html)
        self.assertNotIn('Old reviewed article', html)
        self.assertIn('<span class="headline-source">NHK経済</span>', html)
        self.assertIn('発表 2026/9/22 09:25 JST', html)
        self.assertIn('href="https://news.example/current"', html)
        self.assertEqual(json.loads(ParsedInitial(html).json), data)

    def test_headlines_more_contains_only_reviewed_supplements_without_duplicate_stories(self):
        data = initial_news(live(), now=NOW)
        data['supplements'] = [{**article('Earlier context', '2026-09-21T03:00:00Z'),
                                'url': 'https://news.example/context',
                                'editorial_reason': '今日の記事に関係する確認済みの補足。'}]
        html = render_news_markup(data)
        brief, more = html.split('<details class="read-more"', 1)
        self.assertIn('Original headline', brief)
        self.assertNotIn('Original headline', more)
        self.assertIn('Earlier context', more)
        self.assertIn('今日の記事に関係する確認済みの補足。', more)
        self.assertNotIn('href="https://news.example/current"', more)

    def test_expired_today_feed_cannot_become_an_initial_headlines_fallback(self):
        old_article = {**article('Old', '2026-09-21T03:00:00Z'), 'url': 'https://news.example/old'}
        authored = review([old_article], edition_date='2026-09-21', summary='前号の説明。' * 40,
                          publication_mode='curated', reviewed_at=timestamp('2026-09-21T04:00:00Z'))
        raw = live(source_fetched_at={'NHK経済': NOW - 900})
        self.assertIsNone(initial_news(raw, now=NOW, reviewed_digests=[authored]))

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
        context = {'app': app, 'os': os, 'request': request, 'website_news': self.cache,
                   'initial_market_payload': lambda: {'market': {}},
                   'news_index_response': lambda path, cache, req, **kwargs: news_index_response(path, cache, req, now=NOW, **kwargs)}
        exec(compile(ast.Module(body=[node], type_ignores=[]), 'index-wrapper', 'exec'), context)
        response = app.test_client().get('/')
        html = response.get_data(as_text=True)
        self.assertIn(self.reviews[0]['summary'], html)
        self.assertIn('knInitialNews', html)
        self.cache.snapshot.assert_called_with(wait=False)


if __name__ == '__main__':
    unittest.main()

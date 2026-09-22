import ast
import gzip
import io
import json
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event, Lock
import unittest
from unittest.mock import Mock, patch
from urllib.parse import quote

from flask import Flask
from news_cache import (HeadlineTranslations, NEWS_FEEDS, WEB_NEWS_SOURCES,
                        NewsCache, fetch_feed, load_reviewed_digests,
                        load_reviewed_supplements, select_daily_news)


def timestamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def article(title, published='2026-09-22T03:00:00Z', *, url=None, source='NHK経済'):
    return {'source': source, 'title': title, 'url': url or 'https://example.test/' + quote(title),
            'published_at': timestamp(published) if published else None}


def digest_for(items, edition='2026-09-22'):
    return {'edition_date': edition, 'lang': 'ja', 'headline': '今日の経済ニュース',
            'summary': '確認した記事の内容をやさしい日本語でまとめたテスト用の文章です。' * 6,
            'article_refs': [{field: item[field] for field in ('source', 'url', 'published_at', 'title')}
                             for item in items]}


def read_feed(xml):
    response = Mock()
    response.__enter__ = Mock(return_value=response)
    response.__exit__ = Mock(return_value=False)
    response.headers = {}
    response.read1.side_effect = io.BytesIO(xml.encode()).read1
    with patch('news_cache.urlopen', return_value=response):
        return fetch_feed('https://example.test/rss')


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
            records = fetch_feed('https://example.test/rss')
            self.assertEqual(records, ({'title': 'News', 'url': None,
                                        'published_at': None, 'published_date': None},))
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
            self.assertEqual(fetch_feed('https://example.test/rss')[0]['title'], 'News')
        response.read1.side_effect = io.BytesIO(gzip.compress(b'x' * 2_000_001)).read1
        with patch('news_cache.urlopen', return_value=response):
            with self.assertRaisesRegex(ValueError, 'decoded size'):
                fetch_feed('https://example.test/rss')
        response.read1.side_effect = io.BytesIO(xml).read1
        response.headers = {}
        with patch('news_cache.urlopen', return_value=response), patch('news_cache.time.monotonic', side_effect=[0, 0, 11]):
            with self.assertRaisesRegex(ValueError, 'time budget'):
                fetch_feed('https://example.test/rss')

    def test_structured_cache_copies_records_and_checks_more_than_seven_entries(self):
        records = [article(str(index)) for index in range(45)]
        records[0]['extra'] = {'value': 'original'}
        cache = NewsCache({'A': 'a'}, fetcher=lambda _: records, clock=lambda: 1000)
        cache.snapshot(); self.settle(cache)
        records[0]['title'] = 'fetcher mutation'
        result = cache.snapshot()
        self.assertEqual(len(result['news']), 40)
        result['news'][0]['extra']['value'] = 'caller mutation'
        result['source_status']['A'] = 'error'
        fresh = cache.snapshot()
        self.assertEqual(fresh['news'][0]['title'], '0')
        self.assertEqual(fresh['news'][0]['extra']['value'], 'original')
        self.assertEqual(fresh['source_status'], {'A': 'ok'})

    def test_successful_empty_feed_differs_from_failed_or_expired_fetch(self):
        now = [1000]
        cache = NewsCache({'A': 'a'}, fetcher=lambda _: (), clock=lambda: now[0], ttl=10, max_stale=30)
        cache.snapshot(); self.settle(cache)
        result = cache.snapshot()
        self.assertEqual(result['news'], [])
        self.assertEqual(result['source_status'], {'A': 'empty'})
        self.assertEqual(result['fetched_at'], 1000)
        self.assertEqual(select_daily_news(result, now=1000)['selection_status'], 'empty_today')
        cache.fetcher = Mock(side_effect=OSError('offline'))
        now[0] = 1040
        cache.snapshot(); self.settle(cache)
        failed = cache.snapshot()
        self.assertEqual(failed['source_status'], {'A': 'error'})
        self.assertIsNone(failed['fetched_at'])
        self.assertEqual(select_daily_news(failed, now=1040)['selection_status'], 'unavailable')


class PublicationTests(unittest.TestCase):
    def test_original_published_date_is_not_replaced_by_updated(self):
        records = read_feed('''<feed xmlns="http://www.w3.org/2005/Atom">
          <entry><title>Older</title><link href="https://example.test/old"/>
            <published>2026-09-20T03:00:00Z</published><updated>2026-09-22T03:00:00Z</updated></entry>
          <entry><title>Updated only</title><link href="https://example.test/updated"/>
            <updated>2026-09-22T03:00:00Z</updated></entry>
          <entry><title>Malformed date</title><link href="https://example.test/bad"/>
            <published>not a date</published><updated>2026-09-22T03:00:00Z</updated></entry>
          <entry><title>Impossible date</title><link href="https://example.test/impossible"/>
            <published>2026-02-30T03:00:00Z</published></entry>
          <entry><title>Unknown timezone</title><link href="https://example.test/naive"/>
            <published>2026-09-22T03:00:00</published></entry>
        </feed>''')
        self.assertEqual(records[0]['published_at'], timestamp('2026-09-20T03:00:00Z'))
        self.assertEqual(records[0]['published_date'], '2026-09-20')
        self.assertTrue(all(item['published_at'] is None for item in records[1:]))
        result = select_daily_news({'news': records}, now=timestamp('2026-09-22T04:00:00Z'))
        self.assertEqual(result['news'], [])
        self.assertEqual(result['selection_counts']['unknown_date'], 4)

    def test_rss_pubdate_timezone_and_atom_canonical_links(self):
        rss = read_feed('''<rss version="2.0"><channel><item><title>News</title>
          <link>https://example.test/news#section</link>
          <pubDate>Tue, 22 Sep 2026 00:15:00 +0900</pubDate></item></channel></rss>''')
        self.assertEqual(rss[0]['published_at'], timestamp('2026-09-21T15:15:00Z'))
        self.assertEqual(rss[0]['published_date'], '2026-09-22')
        self.assertEqual(rss[0]['url'], 'https://example.test/news')
        atom = read_feed('''<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>News</title>
          <link href="https://example.test/tracking?article=123"/>
          <link rel="canonical" href="https://EXAMPLE.test/news#section"/>
          <published>2026-09-22T00:15:00+09:00</published></entry></feed>''')
        self.assertEqual(atom[0]['url'], 'https://example.test/news')
        self.assertEqual(atom[0]['published_at'], rss[0]['published_at'])

    def test_invalid_article_links_are_not_exposed(self):
        for url in ('javascript:alert(1)', 'data:text/html,bad', 'https://user:pass@example.test/a',
                    'https://example.test:bad/a', 'https://example.test/with space'):
            records = read_feed('<rss version="2.0"><channel><item><title>News</title><link>' + url +
                                '</link></item></channel></rss>')
            self.assertIsNone(records[0]['url'], url)

    def test_feed_inspection_is_bounded_but_reaches_recent_entries_after_seven(self):
        entries = ''.join('<item><title>Item ' + str(index) + '</title><link>https://example.test/' +
                          str(index) + '</link><pubDate>' +
                          ('Tue, 22 Sep 2026 03:00:00 GMT' if index == 20 else 'Mon, 21 Sep 2026 03:00:00 GMT') +
                          '</pubDate></item>' for index in range(45))
        records = read_feed('<rss version="2.0"><channel>' + entries + '</channel></rss>')
        self.assertEqual(len(records), 40)
        selected = select_daily_news({'news': records}, now=timestamp('2026-09-22T04:00:00Z'))
        self.assertEqual([item['title'] for item in selected['news']], ['Item 20'])
        self.assertEqual(read_feed('<rss version="2.0"><channel></channel></rss>'), ())
        with self.assertRaises(ValueError):
            read_feed('<html>Upstream error</html>')


class DailySelectionTests(unittest.TestCase):
    now = timestamp('2026-09-22T04:00:00Z')

    def test_jst_midnight_and_future_unknown_dates(self):
        items = [article('Yesterday', '2026-09-21T14:59:59Z'),
                 article('Midnight', '2026-09-21T15:00:00Z'),
                 article('Future', '2026-09-22T05:00:00Z'),
                 article('Unknown', None)]
        for invalid in (float('nan'), float('inf'), True, '2026-09-22'):
            items.append({**article('Invalid'), 'published_at': invalid})
        result = select_daily_news({'news': items}, now=self.now)
        self.assertEqual(result['edition_date'], '2026-09-22')
        self.assertEqual([item['title'] for item in result['news']], ['Midnight'])
        self.assertEqual(result['news'][0]['published_date'], '2026-09-22')
        self.assertEqual(result['selection_counts']['future_date'], 1)
        self.assertEqual(result['selection_counts']['unknown_date'], 5)
        # The identical fetched cache changes edition as Japan crosses midnight.
        prior = select_daily_news({'news': items[:2]}, now=timestamp('2026-09-21T14:59:59Z'))
        self.assertEqual([item['title'] for item in prior['news']], ['Yesterday'])

    def test_today_is_newest_first_deduplicated_and_never_padded(self):
        items = [article('Older', '2026-09-21T03:00:00Z'),
                 article('Newest', '2026-09-22T03:30:00Z', url='https://example.test/shared'),
                 article('Same URL', '2026-09-22T03:20:00Z', url='https://EXAMPLE.test/shared#detail'),
                 article('ＮＥＷＥＳＴ', '2026-09-22T03:10:00Z'),
                 article('Second', '2026-09-22T02:00:00Z'),
                 article('Third', '2026-09-22T01:00:00Z'),
                 article('Fourth', '2026-09-22T00:00:00Z')]
        result = select_daily_news({'news': items}, now=self.now)
        self.assertEqual([item['title'] for item in result['news']], ['Newest', 'Second', 'Third'])
        self.assertEqual(result['supplements'], [])
        sparse = select_daily_news({'news': items[:2]}, now=self.now)
        self.assertEqual(len(sparse['news']), 1)
        empty = select_daily_news({'news': items[:1]}, now=self.now)
        self.assertEqual(empty['news'], [])
        self.assertEqual(empty['selection_status'], 'empty_today')
        self.assertEqual(empty['policy_version'], 3)

    def test_only_reviewed_obtained_recent_older_news_become_separate_supplements(self):
        old = article('Rate decision', '2026-09-21T03:00:00Z')
        boundary = article('Seven days', '2026-09-15T03:00:00Z')
        expired = article('Eight days', '2026-09-14T03:00:00Z')
        today = article('Today')
        items = [old, boundary, expired, today, article('Unreviewed important crisis', '2026-09-21T02:00:00Z')]
        approvals = [{'url': item['url'], 'reason': 'Reviewed impact remains relevant'}
                     for item in (old, boundary, expired, today)]
        approvals.append({'url': 'https://example.test/never-obtained', 'reason': 'Cannot invent articles'})
        result = select_daily_news({'news': items}, now=self.now, reviewed_supplements=approvals)
        self.assertEqual([item['title'] for item in result['news']], ['Today'])
        self.assertEqual([item['title'] for item in result['supplements']], ['Rate decision'])
        self.assertTrue(result['supplements'][0]['is_supplement'])
        self.assertEqual(result['supplements'][0]['published_date'], '2026-09-21')
        self.assertEqual(result['supplements'][0]['editorial_reason'], 'Reviewed impact remains relevant')
        boundary_only = select_daily_news({'news': items}, now=self.now, reviewed_supplements=approvals[1:])
        self.assertEqual([item['title'] for item in boundary_only['supplements']], ['Seven days'])
        for invalid in ([], [{'url': old['url'], 'reason': ' '}], [{'url': old['url']}], approvals[2:]):
            self.assertEqual(select_daily_news({'news': items}, now=self.now,
                                              reviewed_supplements=invalid)['supplements'], [])
        self.assertNotIn('published_date', old)
        self.assertNotIn('editorial_reason', old)

    def test_web_source_whitelist_also_filters_status_and_freshness(self):
        raw = {'news': [article('Politics', source='NHK株・企業')], 'fetched_at': self.now,
               'source_fetched_at': {'NHK株・企業': self.now}, 'source_stale': {'NHK株・企業': True},
               'source_refreshing': {'NHK株・企業': True}, 'refreshing': True, 'stale': True,
               'source_status': {'NHK株・企業': 'ok', 'NHK経済': 'error', 'ロイター経済': 'error'}}
        result = select_daily_news(raw, now=self.now, allowed_sources=WEB_NEWS_SOURCES)
        self.assertEqual(result['news'], [])
        self.assertEqual(result['selection_status'], 'unavailable')
        self.assertIsNone(result['fetched_at'])
        self.assertFalse(result['stale'])
        self.assertFalse(result['refreshing'])
        self.assertEqual(result['source_status'], {'NHK経済': 'error', 'ロイター経済': 'error'})
        self.assertEqual(raw['source_status']['NHK株・企業'], 'ok')

    def test_review_file_is_explicit_and_fails_closed(self):
        with TemporaryDirectory() as folder:
            path = Path(folder) / 'reviews.json'
            self.assertEqual(load_reviewed_supplements(path), [])
            approvals = [{'url': 'https://example.test/reviewed', 'reason': 'Reviewed central bank decision'}]
            path.write_text(json.dumps(approvals))
            self.assertEqual(load_reviewed_supplements(path), approvals)
            for invalid in ('invalid json', '{}', '[{"url":"javascript:alert(1)","reason":"x"}]',
                            '[{"url":"https://example.test/a","reason":" "}]'):
                path.write_text(invalid)
                self.assertEqual(load_reviewed_supplements(path), [])


class ReviewedDigestTests(unittest.TestCase):
    now = timestamp('2026-09-22T04:00:00Z')

    def select(self, items, digests):
        return select_daily_news({'news': items}, now=self.now,
                                 allowed_sources=WEB_NEWS_SOURCES, reviewed_digests=digests)

    def test_digest_covers_exact_selected_original_articles_without_mutation(self):
        items = [article('Domestic'), article('Overseas', source='ロイター経済')]
        review = digest_for(items[::-1])
        # URL normalization matches the same article; reference order is immaterial.
        review['article_refs'][0]['url'] = review['article_refs'][0]['url'].replace('example.test', 'EXAMPLE.test') + '#detail'
        result = self.select(items, [review])
        self.assertEqual(result['digest']['summary'], review['summary'])
        self.assertEqual(result['digest']['headline'], review['headline'])
        self.assertEqual(result['digest']['lang'], 'ja')
        self.assertEqual(result['digest']['article_refs'], digest_for(items[::-1])['article_refs'])
        result['digest']['article_refs'][0]['title'] = 'Caller mutation'
        self.assertEqual(review['article_refs'][0]['title'], 'Overseas')
        self.assertNotIn('digest', items[0])

    def test_changed_identity_never_reuses_reviewed_text(self):
        original = article('Original')
        review = digest_for([original])
        for changed in ({'title': 'Updated headline'}, {'url': 'https://example.test/other'},
                        {'published_at': original['published_at'] + 60}, {'source': 'ロイター経済'}):
            with self.subTest(changed=changed):
                result = self.select([{**original, **changed}], [review])
                self.assertEqual(len(result['news']), 1)
                self.assertIsNone(result['digest'])

    def test_added_removed_and_replaced_selected_articles_require_new_review(self):
        first, second, newer = article('First'), article('Second'), article('Newer', '2026-09-22T03:30:00Z')
        one, two = digest_for([first]), digest_for([first, second])
        for items, reviews in (([first, second], [one]), ([first], [two]),
                               ([first, newer], [two]), ([], [one])):
            with self.subTest(items=items):
                self.assertIsNone(self.select(items, reviews)['digest'])
        self.assertEqual(self.select([first, newer], [two, digest_for([first, newer])])['digest']['article_refs'],
                         digest_for([first, newer])['article_refs'])

    def test_yesterday_unknown_future_and_supplement_articles_cannot_fill_today(self):
        today = article('Today')
        older = article('Older', '2026-09-21T03:00:00Z')
        review = digest_for([older], '2026-09-21')
        result = select_daily_news({'news': [today, older]}, now=self.now,
                                   reviewed_digests=[review],
                                   reviewed_supplements=[{'url': older['url'], 'reason': 'Context'}])
        self.assertEqual(len(result['supplements']), 1)
        self.assertIsNone(result['digest'])
        for item in (older, article('Unknown', None), article('Future', '2026-09-22T05:00:00Z')):
            self.assertIsNone(self.select([item], [digest_for([item])])['digest'])
        wrong_edition = {**digest_for([today]), 'edition_date': '2026-09-21'}
        self.assertIsNone(self.select([today], [wrong_edition])['digest'])

    def test_missing_malformed_duplicate_and_ambiguous_reviews_fail_closed(self):
        item = article('Today')
        review = digest_for([item])
        invalid = [None, {}, {**review, 'lang': 'en'}, {**review, 'headline': ''},
                   {**review, 'headline': '見' * 81}, {**review, 'summary': '見出しだけ'},
                   {**review, 'summary': '文' * 261}, {**review, 'article_refs': []},
                   {**review, 'article_refs': review['article_refs'] * 2}]
        for value in invalid:
            with self.subTest(value=value):
                result = self.select([item], [value])
                self.assertEqual(len(result['news']), 1)
                self.assertIsNone(result['digest'])
        self.assertIsNone(self.select([item], [])['digest'])
        self.assertIsNone(self.select([item], [review, {**review, 'headline': '別の説明'}])['digest'])

    def test_digest_file_validation_and_missing_file(self):
        review = digest_for([article('Today')])
        with TemporaryDirectory() as folder:
            path = Path(folder) / 'news-digests.json'
            self.assertEqual(load_reviewed_digests(path), [])
            path.write_text(json.dumps([review]), encoding='utf-8')
            self.assertEqual(load_reviewed_digests(path), [review])
            bad_ref = {**review['article_refs'][0], 'published_at': True}
            for invalid in ('invalid json', '{}', json.dumps([review, None]),
                            json.dumps([{**review, 'article_refs': [bad_ref]}])):
                path.write_text(invalid, encoding='utf-8')
                self.assertEqual(load_reviewed_digests(path), [])


class TranslationTests(unittest.TestCase):
    def test_pending_translation_is_shared_and_never_blocks_current_news(self):
        release, entered, calls = Event(), Event(), []
        def translate(title, lang):
            calls.append((title, lang))
            if len(calls) == 2:
                entered.set()
            release.wait(2)
            return 'Translated ' + title
        service = HeadlineTranslations(translate)
        news = [{**article('今日'), 'published_date': '2026-09-22',
                 'is_supplement': True, 'editorial_reason': 'Reviewed policy impact'}]
        try:
            initial, pending = service.snapshot(news, 'en')
            self.assertEqual(initial, news)
            self.assertTrue(pending)
            self.assertTrue(entered.wait(1))
            for _ in range(5):
                service.snapshot(news, 'en')
            self.assertEqual(len(calls), 2)
            self.assertEqual(service.snapshot(news, 'ja'), (news, False))
        finally:
            release.set()
        with service._condition:
            self.assertTrue(service._condition.wait_for(lambda: not service._pending, timeout=2))
        translated, pending = service.snapshot(news, 'en')
        self.assertFalse(pending)
        self.assertEqual(translated[0]['title'], 'Translated 今日')
        self.assertEqual(translated[0]['editorial_reason'], 'Translated Reviewed policy impact')
        self.assertEqual(news[0]['title'], '今日')
        self.assertEqual(news[0]['editorial_reason'], 'Reviewed policy impact')
        self.assertEqual({key: value for key, value in translated[0].items()
                          if key not in ('title', 'editorial_reason')},
                         {key: value for key, value in news[0].items()
                          if key not in ('title', 'editorial_reason')})

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
        import os
        import re
        from flask import request, send_file
        from news_initial import news_index_response
        root = Path(__file__).parents[1]
        tree = ast.parse((root / 'line_bot.py').read_text())
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                 and node.name in ('index', 'cache_versioned_features')]
        app = Flask('file-cache-test', root_path=str(root), static_folder='static')
        cache = Mock(); cache.snapshot.return_value = {'news': []}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'file-routes', 'exec'),
             dict(app=app, request=request, send_file=send_file, re=re, os=os,
                  news_index_response=news_index_response, news_cache=cache))
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
        now = timestamp('2026-09-22T04:00:00Z')
        raw_items = [article('見出し')] + [article('Earlier ' + str(index), '2026-09-21T03:00:00Z')
                                         for index in range(6)] + [article('Undated', None)]
        snapshot = {'news': raw_items, 'fetched_at': 1000,
                    'source_fetched_at': {'NHK経済': 1000}, 'stale': True, 'refreshing': True,
                    'source_status': {'NHK経済': 'ok'}, 'source_stale': {'NHK経済': True},
                    'source_refreshing': {'NHK経済': True}}
        cache = Mock(); cache.snapshot.return_value = snapshot
        translator = Mock(); translator.snapshot.side_effect = lambda items, lang: (items, False)
        approvals = [{'url': raw_items[1]['url'], 'reason': 'Reviewed economic relevance'}]
        reviewed_digest = digest_for(raw_items[:1])
        context = dict(app=app, request=request, jsonify=jsonify, datetime=datetime,
                       news_cache=cache, news_translations=translator, NEWS_FEEDS=NEWS_FEEDS,
                       WEB_NEWS_SOURCES=WEB_NEWS_SOURCES,
                       load_reviewed_supplements=lambda: approvals,
                       load_reviewed_digests=lambda: [reviewed_digest],
                       select_daily_news=lambda data, **kwargs: select_daily_news(data, now=now, **kwargs))
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'news-routes', 'exec'), context)
        report = context['fetch_news']()
        self.assertEqual(report['NHK経済'], '\n'.join('・' + item['title'] for item in raw_items[:7]))
        self.assertTrue(all(report[source] == '' for source in NEWS_FEEDS if source != 'NHK経済'))
        cache.snapshot.reset_mock()
        response = app.test_client().get('/api/morning-news?lang=unknown')
        data = response.get_json()
        self.assertEqual(data['lang'], 'ja')
        self.assertEqual(data['fetched_at'], 1000)
        self.assertTrue(data['refreshing'])
        self.assertTrue(data['stale'])
        self.assertEqual(data['policy_version'], 3)
        self.assertEqual(data['digest'], reviewed_digest)
        self.assertEqual(data['edition_date'], '2026-09-22')
        self.assertEqual([item['title'] for item in data['news']], ['見出し'])
        self.assertEqual([item['title'] for item in data['supplements']], ['Earlier 0'])
        self.assertEqual(data['selection_counts']['received'], 8)
        cache.snapshot.assert_called_once_with(wait=False)
        translator.snapshot.assert_called_once_with(data['news'] + data['supplements'], 'ja')
        # The authored Japanese digest and its original references are never sent
        # through the headline translator, including on an English response.
        translator.snapshot.reset_mock()
        translator.snapshot.side_effect = lambda items, lang: ([{**item, 'title': 'Translated ' + item['title']}
                                                                for item in items], False)
        english = app.test_client().get('/api/morning-news?lang=en').get_json()
        self.assertEqual(english['lang'], 'en')
        self.assertEqual(english['digest'], reviewed_digest)
        self.assertEqual(english['news'][0]['title'], 'Translated 見出し')
        translated_items, translated_lang = translator.snapshot.call_args.args
        self.assertEqual(translated_lang, 'en')
        self.assertTrue(all('summary' not in item for item in translated_items))
        # A successful feed that contains no current articles is a valid empty
        # edition; the route must not translate or return the earlier stories.
        cache.snapshot.return_value = {**snapshot, 'news': raw_items[2:],
                                       'source_refreshing': {'NHK経済': False}}
        translator.snapshot.reset_mock()
        empty = app.test_client().get('/api/morning-news').get_json()
        self.assertEqual(empty['news'], [])
        self.assertEqual(empty['supplements'], [])
        self.assertEqual(empty['selection_status'], 'empty_today')
        self.assertEqual(empty['policy_version'], 3)
        self.assertIsNone(empty['digest'])
        translator.snapshot.assert_called_once_with([], 'ja')


if __name__ == '__main__':
    unittest.main()

"""Fictional article text in inspected publisher layouts; no real reporting."""
from datetime import datetime, timedelta
from email.utils import format_datetime
from hashlib import sha256
from html import escape
import json
import unittest
from unittest.mock import MagicMock, patch

import company_news_sources as sources

NOW = datetime(2026, 10, 8, 18, tzinfo=sources.JST)
PUBLISHED = '2026-10-08T15:00:00+09:00'
PANASONIC = 'パナソニック ホールディングス'
URLS = {
    'NTT': 'https://group.ntt/jp/newsrelease/2026/10/08/261008a.html',
    'KDDI': 'https://newsroom.kddi.com/news/detail/kddi_nr-1180_4736.html',
    PANASONIC: 'https://news.panasonic.com/jp/press/jn261008-1',
}
TITLES = {name: f'{name}、新しい設備の実証を開始' for name in URLS}


def feed(source, *, title=None, url=None, published=PUBLISHED, extra='', date_tag=None):
    rdf = source == 'NTT'
    tag = date_tag or ('dc:date' if rdf else 'pubDate')
    value = published
    if not rdf and published is not None and 'T' in published:
        value = format_datetime(datetime.fromisoformat(published))
    item = (f'<item><title>{escape(title or TITLES[source])}</title><link>{escape(url or URLS[source])}</link>'
            + (f'<{tag}>{escape(value)}</{tag}>' if value else '') + '</item>')
    if rdf:
        return ('<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" '
                'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns="http://purl.org/rss/1.0/">'
                '<channel><dc:date>1999-01-01</dc:date></channel>' + item + extra + '</rdf:RDF>').encode()
    return ('<rss version="2.0"><channel>' + item + extra + '</channel></rss>').encode()


def article(source, *, title=None, published=PUBLISHED, day='2026年10月8日', issuer=None,
            author=None, body=None, company_badge='', metadata=True):
    config = sources.SOURCES[source]
    title = title or TITLES[source]
    issuer = issuer or config['issuer']
    body = body if body is not None else (
        f'{issuer}は、取得処理のテスト用の架空の設備実験を開始します。実際の発表ではありません。'
        '設備の性能や使える条件を調べ、今後の利用方法を確認するための架空の文章です。'
        '実験は2026年10月13日に行う予定です。発表日と実験日は異なります。')
    obj = {'@type': 'NewsArticle', 'headline': title, 'datePublished': published,
           'dateModified': '2026-10-09T12:00:00+09:00',
           'author': {'@type': 'Organization', 'name': author or config['issuer']}}
    script = '<script type="application/ld+json">' + json.dumps(obj, ensure_ascii=False) + '</script>' if metadata else ''
    if source == 'NTT':
        content = (f'<div class="contents"><div class="c-container-1"><p class="c-navi-2__txt">{day}</p>'
                   f'<h1 class="c-ttl-1">{escape(title)}</h1>'
                   f'<div class="c-wrap-1 c-wrap-1--o-4"><p>{escape(body)}</p></div></div>'
                   '<section class="related"><p>関連記事は本文ではありません</p></section></div>')
    elif source == 'KDDI':
        content = (f'<main id="main"><time class="news-detail-heading1__date" datetime="2026-10-08">{day}</time>'
                   f'<h1 class="news-detail-heading1__title">{escape(title)}</h1>'
                   f'<div class="news-detail-main__content"><section><p>{escape(body)}</p></section>'
                   '<div class="news-detail-article-controller"><p>関連記事は本文ではありません</p></div></div></main>')
    else:
        content = (f'<main><div id="nw-contents"><p class="p-detailHeader__date">{day}</p>'
                   f'<ul class="p-detailHeader__company"><li>{escape(company_badge)}</li></ul>'
                   f'<h1 class="p-detailHeader__heading">{escape(title)}</h1>'
                   f'<div class="TextItem__text"><p>{escape(body)}</p></div></div>'
                   '<section class="p-recommend"><p>関連記事は本文ではありません</p></section></main>')
    return ('<html><head>' + script + '</head><body><nav>navigation</nav>' + content + '<footer>footer</footer></body></html>').encode()


class CompanySourceTests(unittest.TestCase):
    def item(self, source='NTT', published=PUBLISHED):
        return {'source': source, 'url': URLS[source], 'title': TITLES[source], **sources._publication(published)}

    def extract(self, source='NTT', payload=None, item=None, now=NOW, since=None, final=None):
        item = item or self.item(source)
        return sources._extract_article(payload or article(source), item, final or item['url'], now,
                                        since or now - timedelta(hours=72), observed_at=NOW.timestamp())

    def test_all_three_layouts_and_trusted_company_fields(self):
        for source in URLS:
            with self.subTest(source=source):
                result = self.extract(source)
                self.assertEqual(result['symbol'], sources.SOURCES[source]['symbol'])
                self.assertEqual(result['business_url'], sources.SOURCES[source]['business_url'])
                self.assertEqual(result['published_at'], self.item(source)['published_at'])
                self.assertEqual(result['published_date'], '2026-10-08')
                self.assertEqual(result['body_sha256'], sha256(result['body'].encode()).hexdigest())
                self.assertIn('10月13日', result['body'])
                self.assertNotIn('関連記事', result['body'])
                self.assertNotIn('footer', result['body'])

    def test_rss_and_rdf_ignore_channel_dates(self):
        for source in URLS:
            with self.subTest(source=source):
                items = sources._feed_items(feed(source), source, NOW, NOW - timedelta(hours=72))
                self.assertEqual(len(items), 1)
                self.assertEqual(items[0]['published_date'], '2026-10-08')

    def test_titles_strip_embedded_markup(self):
        title = 'NTT、新しい<br>設備の実証を開始'
        items = sources._feed_items(feed('NTT', title=title), 'NTT', NOW, NOW - timedelta(hours=72))
        self.assertEqual(items[0]['title'], 'NTT、新しい 設備の実証を開始')
        self.assertNotIn('<', items[0]['title'])

    def test_date_only_is_not_midnight(self):
        result = self.extract(payload=article('NTT', published='2026-10-08'), item=self.item(published='2026-10-08'))
        self.assertIsNone(result['published_at'])
        self.assertEqual(result['publication_precision'], 'day')

    def test_ntt_seconds_difference_preserves_only_verified_day(self):
        result = self.extract(payload=article('NTT', published='2026-10-08T15:00:30+09:00'))
        self.assertIsNone(result['published_at'])
        self.assertEqual(result['published_date'], '2026-10-08')
        self.assertEqual(result['publication_evidence']['article_published_at'], self.item(published='2026-10-08T15:00:30+09:00')['published_at'])

    def test_missing_changed_or_future_dates_are_rejected(self):
        for published in (None, '2026-10-07T15:00:00+09:00', '2026-10-08T19:00:00+09:00', '2026-10-08T15:00:00'):
            with self.subTest(published=published):
                self.assertIsNone(self.extract(payload=article('NTT', published=published)))
        self.assertIsNone(self.extract(payload=article('NTT', day='2026年10月7日')))
        self.assertIsNone(self.extract(payload=article('NTT', metadata=False)))

    def test_recent_window_exact_boundary_and_ambiguous_oldest_day(self):
        boundary = NOW - timedelta(hours=72)
        for published in ('2026-10-05T17:59:59+09:00', '2026-10-05', '2026-10-08T19:00:00+09:00'):
            self.assertEqual(sources._feed_items(feed('KDDI', published=published), 'KDDI', NOW, boundary), [])
        self.assertEqual(len(sources._feed_items(feed('KDDI', published='2026-10-05T18:00:00+09:00'), 'KDDI', NOW, boundary)), 1)

    def test_subsidiary_is_not_relabelled_as_parent_announcement(self):
        result = self.extract(PANASONIC, article(PANASONIC, issuer='パナソニック株式会社'))
        self.assertEqual(result['name'], 'パナソニック ホールディングス')
        self.assertEqual(result['related_company'], 'パナソニック株式会社')
        self.assertIsNone(self.extract(PANASONIC, article(PANASONIC, issuer='別の会社株式会社')))
        self.assertIsNone(self.extract(PANASONIC, article(PANASONIC, issuer='パナソニック株式会社',
                                                       company_badge='パナソニック エナジー株式会社')))

    def test_inspected_connect_group_actor_is_preserved_without_inventing_corporation(self):
        result = self.extract(PANASONIC, article(PANASONIC, issuer='パナソニック コネクトグループ'))
        self.assertEqual(result['related_company'], 'パナソニック コネクトグループ')
        self.assertEqual(result['name'], 'パナソニック ホールディングス')
        self.assertIsNone(self.extract(PANASONIC, article(PANASONIC, issuer='パナソニック 未確認グループ')))

    def test_issuer_in_partner_description_later_paragraph_or_footer_is_not_actor(self):
        actor = 'パナソニック コネクトグループ'
        filler = 'これは取得処理を確かめる架空の本文です。実際の会社発表ではありません。' * 5
        for body in (f'{actor}の取引先である別会社は、新しい設備を開発します。{filler}',
                     f'別会社は、新しい設備を開発します。{filler}\n{actor}は取引先です。',
                     f'{actor}\n別会社は、新しい設備を開発します。{filler}'):
            with self.subTest(body=body[:30]):
                self.assertIsNone(self.extract(PANASONIC, article(PANASONIC, body=body)))
        payload = article(PANASONIC, issuer='別の会社株式会社').replace(
            b'<footer>footer</footer>', f'<footer>{actor}は会社案内の見出しです。</footer>'.encode())
        self.assertIsNone(self.extract(PANASONIC, payload))

    def test_panasonic_body_tables_and_headings_are_not_lost(self):
        extra = ('<div class="BlockModule"><h2>実験の条件</h2><table>'
                 '<tr><th>対象</th><td>架空設備1台</td></tr></table></div>')
        payload = article(PANASONIC).replace(b'</div><section class="p-recommend">',
                                             extra.encode() + b'</div><section class="p-recommend">')
        result = self.extract(PANASONIC, payload)
        self.assertIn('実験の条件', result['body'])
        self.assertIn('架空設備1台', result['body'])
        self.assertNotIn('関連記事', result['body'])

    def test_title_author_and_narrative_subject_must_match(self):
        self.assertIsNone(self.extract(payload=article('NTT', title='別の発表')))
        self.assertIsNone(self.extract(payload=article('NTT', author='別の会社株式会社')))
        self.assertIsNone(self.extract(payload=article('NTT', issuer='別の会社株式会社')))
        self.assertIsNone(self.extract(payload=article('NTT', body='短い')))
        self.assertIsNone(self.extract(payload=article('NTT').replace(b'c-wrap-1--o-4', b'unknown')))

    def test_known_source_patterns_reject_ir_cross_host_credentials_and_private_urls(self):
        urls = ['http://group.ntt/jp/newsrelease/2026/10/08/261008a.html',
                'https://user:password@group.ntt/jp/newsrelease/2026/10/08/261008a.html',
                'https://group.ntt:444/jp/newsrelease/2026/10/08/261008a.html',
                'https://group.ntt/jp/newsrelease/2026/10/08/261008a.html?private=1',
                'https://127.0.0.1/jp/newsrelease/2026/10/08/261008a.html',
                'https://group.ntt.evil.example/jp/newsrelease/2026/10/08/261008a.html',
                'https://www.docomo.ne.jp/binary/pdf/info/news_release/topics_261008_c1.pdf',
                'https://newsroom.kddi.com/ir-news/detail/kddi_ir-1237_4750.html',
                'https://news.panasonic.com/jp/topics/206901',
                'https://group.ntt/jp/newsrelease/2026/10/08/../private.html']
        for url in urls:
            with self.subTest(url=url):
                self.assertIsNone(sources._safe_url(url))
        self.assertIsNone(sources._safe_url(URLS['KDDI'], source='NTT'))
        self.assertIsNone(self.extract(final=URLS['KDDI']))

    def test_routine_and_event_only_titles_do_not_fill_slots(self):
        for title in ('新しい事業方針に関するフォーラムを開催', '役員人事のお知らせ',
                      '自己株式の取得状況に関するお知らせ', '新製品発表セミナーへ登壇', '新製品の受賞について'):
            self.assertEqual(sources._feed_items(feed('KDDI', title=title), 'KDDI', NOW, NOW - timedelta(hours=72)), [])

    def test_feed_does_not_accept_updated_as_original_date_or_entities(self):
        self.assertEqual(sources._feed_items(feed('KDDI', date_tag='updated'), 'KDDI', NOW, NOW - timedelta(hours=72)), [])
        with self.assertRaisesRegex(ValueError, 'unsupported_feed_declaration'):
            sources._feed_items(b'<!DOCTYPE rss [<!ENTITY data SYSTEM "file:///etc/passwd">]><rss/>', 'KDDI', NOW, NOW - timedelta(hours=72))
        with self.assertRaisesRegex(ValueError, 'unsupported_feed_structure'):
            sources._feed_items(b'<html><item/></html>', 'KDDI', NOW, NOW - timedelta(hours=72))

    def test_network_redirect_type_size_and_time_limits(self):
        session = MagicMock()
        session.__enter__.return_value = session
        response = MagicMock()
        response.__enter__.return_value = response
        response.status_code = 200
        response.headers = {'Content-Type': 'text/html'}
        response.raw.read1.side_effect = [b'<html/>', b'']
        session.get.return_value = response
        with patch.object(sources.requests, 'Session', return_value=session), patch.object(sources, '_public_addresses', return_value=['93.184.216.34']), patch.object(sources, '_PinnedHTTPSAdapter'):
            result = sources._download(URLS['NTT'], sources.time.monotonic() + 20)
            self.assertEqual(result, (b'<html/>', URLS['NTT']))
            self.assertFalse(session.trust_env)
            self.assertFalse(session.get.call_args.kwargs['allow_redirects'])
            response.status_code = 302
            with self.assertRaisesRegex(ValueError, 'unapproved_redirect'):
                sources._download(URLS['NTT'], sources.time.monotonic() + 20)
            response.status_code = 200
            response.headers = {'Content-Type': 'application/pdf'}
            with self.assertRaisesRegex(ValueError, 'source_content_type'):
                sources._download(URLS['NTT'], sources.time.monotonic() + 20)
            response.headers = {'Content-Type': 'text/html', 'Content-Length': str(sources.MAX_BYTES + 1)}
            with self.assertRaisesRegex(ValueError, 'source_size_limit'):
                sources._download(URLS['NTT'], sources.time.monotonic() + 20)
            with self.assertRaisesRegex(ValueError, 'source_time_limit'):
                sources._download(URLS['NTT'], sources.time.monotonic() - 1)

    def collect(self, *, failure=None, exclude_urls=None, invalid_clock=False):
        def download(url, deadline):
            if failure == url:
                raise ValueError('source_unavailable')
            if url == sources.FEEDS['PR TIMES']:
                return (b'<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" '
                        b'xmlns="http://purl.org/rss/1.0/"><channel/></rdf:RDF>'), url
            for source in URLS:
                if url == sources.FEEDS[source]:
                    return feed(source), url
                if url == URLS[source]:
                    return article(source), url
            if url in sources.additional.FEEDS.values():
                return b'<rss><channel/></rss>', url
            raise AssertionError(url)
        diagnostics = {}
        with patch.object(sources, '_download', side_effect=download) as fetch:
            result = sources.collect_company_articles(NOW, diagnostics=diagnostics,
                clock=lambda: float('nan') if invalid_clock else NOW.timestamp(), exclude_urls=exclude_urls)
        return result, diagnostics, fetch

    def test_collector_verifies_three_bodies_and_keeps_actual_verification_clock(self):
        result, diagnostics, fetch = self.collect()
        self.assertEqual(len(result), 3)
        self.assertEqual(fetch.call_count, len(sources.FEEDS) + 3)
        self.assertEqual({item['symbol'] for item in result}, {'9432.T', '9433.T', '6752.T'})
        self.assertTrue(all(item['body_verified_at'] == NOW.timestamp() for item in result))
        self.assertTrue(all(diagnostics[name]['status'] == 'collected' for name in URLS))
        self.assertEqual(diagnostics['PR TIMES']['status'], 'no_matching_candidates')

    def test_known_urls_skip_bodies_without_claiming_unseen_site_has_no_news(self):
        result, diagnostics, fetch = self.collect(exclude_urls=set(URLS.values()))
        self.assertEqual(result, [])
        self.assertEqual(fetch.call_count, len(sources.FEEDS))
        self.assertTrue(all(diagnostics[name]['feed_status'] == 'ok' and diagnostics[name]['candidates'] == 1
                            and diagnostics[name]['selected'] == 0 for name in URLS))

    def test_failed_feed_and_failed_article_are_distinct(self):
        result, diagnostics, _ = self.collect(failure=sources.FEEDS['NTT'])
        self.assertEqual(len(result), 2)
        self.assertEqual(diagnostics['NTT']['status'], 'feed_failed')
        result, diagnostics, _ = self.collect(failure=URLS['NTT'])
        self.assertEqual(len(result), 2)
        self.assertEqual(diagnostics['NTT']['feed_status'], 'ok')
        self.assertEqual(diagnostics['NTT']['status'], 'articles_unavailable')

    def test_successfully_checked_empty_is_distinct_from_failure(self):
        def download(url, deadline):
            if url == sources.FEEDS['PR TIMES']:
                return (b'<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" '
                        b'xmlns="http://purl.org/rss/1.0/"><channel/></rdf:RDF>'), url
            return b'<rss><channel/></rss>', url
        with patch.object(sources, '_download', side_effect=download):
            diagnostics = {}
            self.assertEqual(sources.collect_company_articles(NOW, diagnostics=diagnostics), [])
        self.assertTrue(all(row['status'] == 'no_matching_candidates' and row['feed_status'] == 'ok' for row in diagnostics.values()))

    def test_invalid_verification_clock_does_not_publish_verified_body(self):
        result, diagnostics, _ = self.collect(invalid_clock=True)
        self.assertEqual(result, [])
        self.assertTrue(all('invalid_verification_clock' in diagnostics[name]['errors'] for name in URLS))

    def test_multiple_candidate_articles_never_fetch_more_than_one_per_company(self):
        original = sources._feed_items
        def duplicate_candidates(payload, source, now, since):
            item = original(payload, source, now, since)[0]
            return [item, dict(item, url=item['url'].replace('261008a', '261008b'))]
        with patch.object(sources, '_feed_items', side_effect=duplicate_candidates):
            result, diagnostics, fetch = self.collect()
        self.assertEqual(len(result), 3)
        self.assertEqual(fetch.call_count, len(sources.FEEDS) + 3)
        self.assertTrue(all(diagnostics[name]['selected'] == 1 for name in URLS))


class CompanyTransportFailoverTests(unittest.TestCase):
    """Offline pinned transport fixtures; no network or certificate weakening."""
    ADDRESSES = ['93.184.216.34', '1.1.1.1', '8.8.8.8']

    def session(self, *, failure=None, chunks=None, status=200, headers=None):
        session, response = MagicMock(), MagicMock()
        session.__enter__.return_value = session
        response.__enter__.return_value = response
        response.status_code = status
        response.headers = headers or {'Content-Type': 'text/html'}
        response.raw.read1.side_effect = chunks or [b'<html/>', b'']
        if failure is not None:
            session.get.side_effect = failure
        else:
            session.get.return_value = response
        return session, response

    def test_first_connect_read_or_connection_failure_uses_only_second_verified_ip(self):
        for error in (sources.requests.exceptions.ConnectTimeout, sources.requests.exceptions.ReadTimeout,
                      sources.requests.exceptions.ConnectionError):
            with self.subTest(error=error.__name__):
                first, _ = self.session(failure=error('simulated transport failure'))
                second, _ = self.session()
                with patch.object(sources, '_public_addresses', return_value=self.ADDRESSES) as dns, \
                        patch.object(sources.requests, 'Session', side_effect=[first, second]) as sessions, \
                        patch.object(sources, '_PinnedHTTPSAdapter') as adapter, \
                        patch.object(sources.time, 'monotonic', return_value=100):
                    self.assertEqual(sources._download(URLS['NTT'], 140), (b'<html/>', URLS['NTT']))
                dns.assert_called_once_with('group.ntt')
                self.assertEqual(sessions.call_count, 2)
                self.assertEqual(adapter.call_args_list[0].args, ('group.ntt', self.ADDRESSES[0]))
                self.assertEqual(adapter.call_args_list[1].args, ('group.ntt', self.ADDRESSES[1]))
                for session in (first, second):
                    self.assertFalse(session.trust_env)
                    kwargs = session.get.call_args.kwargs
                    self.assertTrue(kwargs['verify'])
                    self.assertFalse(kwargs['allow_redirects'])
                    self.assertEqual(kwargs['headers']['Host'], 'group.ntt')
                    self.assertEqual(session.get.call_args.args, (URLS['NTT'],))
                    session.__exit__.assert_called_once()

    def test_partial_body_read_timeout_discards_first_body_and_closes_response(self):
        timeout = sources._StreamReadTimeout(None, '/original', 'simulated timeout')
        first, first_response = self.session(chunks=[b'PARTIAL BODY', timeout])
        second, _ = self.session()
        with patch.object(sources, '_public_addresses', return_value=self.ADDRESSES), \
                patch.object(sources.requests, 'Session', side_effect=[first, second]), \
                patch.object(sources, '_PinnedHTTPSAdapter'), \
                patch.object(sources.time, 'monotonic', return_value=100):
            self.assertEqual(sources._download(URLS['NTT'], 140)[0], b'<html/>')
        first_response.__exit__.assert_called_once()
        first.__exit__.assert_called_once()

    def test_all_dns_answers_are_checked_before_any_request_even_an_unsafe_third_answer(self):
        for unsafe in ('127.0.0.1', '10.0.0.1', '169.254.169.254', '224.0.0.1', '::1', 'not-an-ip'):
            addresses = self.ADDRESSES[:2] + [unsafe]
            answers = [(sources.socket.AF_INET, sources.socket.SOCK_STREAM, 6, '', (ip, 443)) for ip in addresses]
            with self.subTest(unsafe=unsafe), patch.object(sources.socket, 'getaddrinfo', return_value=answers) as dns, \
                    patch.object(sources.requests, 'Session') as sessions, \
                    patch.object(sources, '_PinnedHTTPSAdapter') as adapter, \
                    patch.object(sources.time, 'monotonic', return_value=100):
                with self.assertRaisesRegex(ValueError, 'unapproved_source'):
                    sources._download(URLS['NTT'], 140)
                dns.assert_called_once_with('group.ntt', 443, type=sources.socket.SOCK_STREAM)
                sessions.assert_not_called()
                adapter.assert_not_called()

    def test_dns_empty_and_duplicates_are_handled_without_second_resolution(self):
        with patch.object(sources.socket, 'getaddrinfo', return_value=[]):
            with self.assertRaisesRegex(ValueError, 'unapproved_source'):
                sources._public_addresses('group.ntt')
        answers = [(sources.socket.AF_INET, sources.socket.SOCK_STREAM, 6, '', (ip, 443))
                   for ip in [self.ADDRESSES[0], self.ADDRESSES[0], self.ADDRESSES[1]]]
        with patch.object(sources.socket, 'getaddrinfo', return_value=answers) as dns:
            self.assertEqual(sources._public_addresses('group.ntt'), self.ADDRESSES[:2])
            dns.assert_called_once()

    def test_expired_shared_or_request_deadline_never_starts_second_connection(self):
        for global_deadline, exhausted_at in ((140, 111), (105, 106)):
            clock = [100]
            first, _ = self.session()
            def timeout(*args, **kwargs):
                clock[0] = exhausted_at
                raise sources.requests.exceptions.ConnectTimeout('simulated timeout')
            first.get.side_effect = timeout
            with self.subTest(deadline=global_deadline), \
                    patch.object(sources, '_public_addresses', return_value=self.ADDRESSES), \
                    patch.object(sources.requests, 'Session', return_value=first) as sessions, \
                    patch.object(sources, '_PinnedHTTPSAdapter') as adapter, \
                    patch.object(sources.time, 'monotonic', side_effect=lambda: clock[0]):
                with self.assertRaisesRegex(ValueError, 'source_time_limit'):
                    sources._download(URLS['NTT'], global_deadline)
                self.assertEqual(sessions.call_count, 1)
                self.assertEqual(adapter.call_count, 1)

    def test_second_timeout_uses_remaining_initial_budget_without_reset(self):
        clock = [100]
        first, _ = self.session()
        def timeout(*args, **kwargs):
            clock[0] = 108
            raise sources.requests.exceptions.ReadTimeout('simulated timeout')
        first.get.side_effect = timeout
        second, _ = self.session()
        with patch.object(sources, '_public_addresses', return_value=self.ADDRESSES), \
                patch.object(sources.requests, 'Session', side_effect=[first, second]), \
                patch.object(sources, '_PinnedHTTPSAdapter'), \
                patch.object(sources.time, 'monotonic', side_effect=lambda: clock[0]):
            sources._download(URLS['NTT'], 140)
        self.assertEqual(first.get.call_args.kwargs['timeout'], (3, 3))
        self.assertEqual(second.get.call_args.kwargs['timeout'], (2, 2))

    def test_header_consuming_budget_never_starts_a_body_read_or_another_ip(self):
        clock = [100]
        first, response = self.session()
        def late_headers(*args, **kwargs):
            clock[0] = 111
            return response
        first.get.side_effect = late_headers
        with patch.object(sources, '_public_addresses', return_value=self.ADDRESSES), \
                patch.object(sources.requests, 'Session', return_value=first) as sessions, \
                patch.object(sources, '_PinnedHTTPSAdapter'), \
                patch.object(sources.time, 'monotonic', side_effect=lambda: clock[0]):
            with self.assertRaisesRegex(ValueError, 'source_size_or_time_limit'):
                sources._download(URLS['NTT'], 140)
            response.raw.read1.assert_not_called()
            self.assertEqual(sessions.call_count, 1)

    def test_tls_or_certificate_failure_never_retries_even_for_connection_error_subclass(self):
        for failure, streaming in ((sources.requests.exceptions.SSLError('simulated certificate mismatch'), False),
                                   (sources._StreamSSLError('simulated certificate mismatch'), True),
                                   (sources.ssl.SSLError(1, 'simulated TLS failure'), True)):
            first, _ = self.session(chunks=[failure] if streaming else None,
                                    failure=None if streaming else failure)
            with self.subTest(streaming=streaming, error=type(failure).__name__), \
                    patch.object(sources, '_public_addresses', return_value=self.ADDRESSES), \
                    patch.object(sources.requests, 'Session', return_value=first) as sessions, \
                    patch.object(sources, '_PinnedHTTPSAdapter') as adapter, \
                    patch.object(sources.time, 'monotonic', return_value=100):
                with self.assertRaises(sources.requests.exceptions.SSLError):
                    sources._download(URLS['NTT'], 140)
                self.assertEqual(sessions.call_count, 1)
                self.assertEqual(adapter.call_count, 1)

    def test_http_redirect_content_or_size_failure_never_retries_another_ip(self):
        for status, headers, code in ((302, {'Content-Type': 'text/html'}, 'unapproved_redirect'),
                                      (403, {'Content-Type': 'text/html'}, 'source_unavailable'),
                                      (200, {'Content-Type': 'application/pdf'}, 'source_content_type'),
                                      (200, {'Content-Type': 'text/html', 'Content-Length': str(sources.MAX_BYTES + 1)}, 'source_size_limit')):
            first, _ = self.session(status=status, headers=headers)
            with self.subTest(code=code), patch.object(sources, '_public_addresses', return_value=self.ADDRESSES), \
                    patch.object(sources.requests, 'Session', return_value=first) as sessions, \
                    patch.object(sources, '_PinnedHTTPSAdapter') as adapter, \
                    patch.object(sources.time, 'monotonic', return_value=100):
                with self.assertRaisesRegex(ValueError, code):
                    sources._download(URLS['NTT'], 140)
                self.assertEqual(sessions.call_count, 1)
                self.assertEqual(adapter.call_count, 1)

    def test_only_two_verified_addresses_can_be_attempted(self):
        first, _ = self.session(failure=sources.requests.exceptions.ConnectTimeout('first simulated timeout'))
        second, _ = self.session(failure=sources.requests.exceptions.ConnectTimeout('second simulated timeout'))
        with patch.object(sources, '_public_addresses', return_value=self.ADDRESSES) as dns, \
                patch.object(sources.requests, 'Session', side_effect=[first, second]) as sessions, \
                patch.object(sources, '_PinnedHTTPSAdapter') as adapter, \
                patch.object(sources.time, 'monotonic', return_value=100):
            with self.assertRaises(sources.requests.exceptions.ConnectTimeout):
                sources._download(URLS['NTT'], 140)
            self.assertEqual(sessions.call_count, 2)
            self.assertEqual(adapter.call_count, 2)
            dns.assert_called_once()

    def test_already_expired_deadline_skips_dns_and_http(self):
        with patch.object(sources, '_public_addresses') as dns, \
                patch.object(sources.requests, 'Session') as sessions, \
                patch.object(sources.time, 'monotonic', return_value=100):
            with self.assertRaisesRegex(ValueError, 'source_time_limit'):
                sources._download(URLS['NTT'], 99)
            dns.assert_not_called()
            sessions.assert_not_called()


if __name__ == '__main__':
    unittest.main()

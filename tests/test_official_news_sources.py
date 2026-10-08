from datetime import date, datetime, timezone
from hashlib import sha256
from html import escape
from io import BytesIO
import subprocess
import unittest
from unittest.mock import MagicMock, patch

import official_news_sources as sources


NOW = datetime(2026, 10, 2, 20, 0, tzinfo=sources.JST)
STAT_URL = 'https://www.stat.go.jp/data/roudou/sokuhou/tsuki/index.html'
MOF_URL = 'https://www.mof.go.jp/public_relations/conference/my20261002.html'
BOJ_URL = 'https://www.boj.or.jp/mopo/mpmdeci/mpr_2026/k261002a.pdf'
BOJ_HTML_URL = 'https://www.boj.or.jp/mopo/mpmdeci/state_2026/k261002a.htm'
BOJ_TITLE = '金融市場調節方針の変更について'
# Entirely fictional parser fixture; never a report about an actual decision.
BOJ_BODY = '''1
２０２６年１０月２日
日 本 銀 行
金融市場調節方針の変更について
これは取得処理を確かめるための架空の本文です。実際の金融政策ではありません。
ここには判断の条件や対象、次の会合までの方針が記載されています。
新たな方針は翌営業日の１０月５日から適用します。
主な意見は２０２６年１０月９日公表予定です。末尾にも重要な条件があります。
'''
# The short public statistical-point fixture used by the private API test.
STAT_BODY = '''労働力調査（基本集計） 2026年（令和8年）8月分結果
2026年10月2日公表
<<ポイント>>
(1)
就業者数
就業者数は6849万人。前年同月に比べ14万人の増加。2か月ぶりの増加
(2)
完全失業者数
完全失業者数は180万人。前年同月に比べ2万人の減少。13か月ぶりの減少
(3)
完全失業率
完全失業率（季節調整値）は2.5％。前月に比べ0.1ポイントの上昇
'''
# Excerpt of the already inspected public Oct 2 conference, not generated copy.
MOF_BODY = '''日本版ＤＯＧＥの取組については、今後、目に見える形でこれを強化し、さらに深掘りをしていくという方針で、昨日、総理にもこの方針のご説明をして、全面的にご了解をいただきました。
具体的な取組の方向性については来週10月９日の金曜日に「租税特別措置・補助金見直しに関する関係閣僚等及び副大臣会議」を開きましてお示ししたいと考えておりますが、今後の予算編成、税制改正プロセスを通じて各府省庁間で認識を共有しつつ、施策の優先順位を洗い直して大胆に重点化していくつもりです。
基金は約200ございまして、今時点で来年度末の予想残高が７兆円ぐらいありますので、今までとは違った規模感になると思いますが、どれを幾らという目標を設定したわけではありません。'''


def rss_item(url, title, published, *, rdf=False, date_tag=None):
    tag = date_tag or ('dc:date' if rdf else 'pubDate')
    value = f'<{tag}>{escape(published)}</{tag}>' if published is not None else ''
    return f'<item><title>{escape(title)}</title><link>{escape(url)}</link>{value}</item>'


def feed(items, *, rdf=False):
    if rdf:
        return ('<?xml version="1.0" encoding="UTF-8"?>'
                '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" '
                'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns="http://purl.org/rss/1.0/">'
                '<channel><dc:date>1999-01-01</dc:date></channel>' + ''.join(items) + '</rdf:RDF>').encode()
    return ('<?xml version="1.0" encoding="UTF-8"?><rss><channel>' + ''.join(items) + '</channel></rss>').encode()


def stat_html(body=STAT_BODY, release='2026年10月2日公表', *, encoding='Shift_JIS'):
    return (f'<html><head><meta charset="{encoding}"></head><body><main id="main_contents">'
            '<article><section id="section"><article><a>skip</a></article><article>'
            '<h1>労働力調査（基本集計）2026年8月分結果</h1>'
            f'<p>{escape(release)}</p><div><p>{escape(body)}</p></div></article>'
            '<article><p>Adobe plugin boilerplate must not enter the article</p></article>'
            '</section></article></main></body></html>').encode('cp932' if encoding == 'Shift_JIS' else 'utf-8')


def mof_html(body=MOF_BODY, published='2026-10-02'):
    meta = f'<meta name="date" content="{published}">' if published is not None else ''
    return ('<html><head><meta charset="UTF-8">' + meta + '</head><body><main id="main">'
            '<header class="content-header"><div><h1 id="skipmain">財務大臣の記者会見</h1></div></header>'
            '<div class="content"><div class="content-inner"><div class="unique-block"><section><div class="inner">'
            f'<p>【質疑応答】</p><div><p>{escape(body)}</p></div></div></section></div></div></div>'
            '<footer>Footer and navigation are not evidence</footer></main></body></html>').encode()


def boj_html(title=BOJ_TITLE, dateline='2026年10月2日\n日本銀行', body=BOJ_BODY):
    return (f'<html><meta charset="utf-8"><main id="contents"><h1>{escape(title)}</h1>'
            '<div class="outline mod_outer">'
            f'<p class="txt-right">{escape(dateline)}</p><p>{escape(body)}</p>'
            '</div><footer>footer excluded</footer></main></html>').encode()


def synthetic_pdf(*, pages=1, encrypted=False, blank_last=False, page_texts=None,
                  password='test-password', permissions=None, missing_permissions=False):
    from pypdf import PdfWriter
    from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
    writer = PdfWriter()
    if page_texts is not None:
        pages = len(page_texts)
    for index in range(pages):
        page = writer.add_blank_page(width=400, height=400)
        if blank_last and index == pages - 1:
            continue
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'),
                                 NameObject('/Subtype'): NameObject('/Type1'),
                                 NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({
            NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
        stream = DecodedStreamObject()
        text = (page_texts[index] if page_texts is not None else
                f'Synthetic parser test page {index + 1}. ' +
                'This is fictional evidence for automated testing only. ' * 3)
        text = text.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
        stream.set_data(('BT /F1 10 Tf 20 380 Td (' + text + ') Tj ET').encode())
        page[NameObject('/Contents')] = writer._add_object(stream)
    if encrypted:
        options = {} if permissions is None else {'permissions_flag': permissions}
        writer.encrypt(password, owner_password='fixture-owner-password', **options)
        if missing_permissions:
            del writer._encrypt_entry[NameObject('/P')]
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


class OfficialSourceTests(unittest.TestCase):
    def stat_item(self, published='2026-10-02'):
        return {'source': '総務省統計局', 'title': '労働力調査（基本集計）2026年8月分結果',
                'url': STAT_URL, **sources._publication(published)}

    def mof_item(self, published='Fri, 02 Oct 2026 19:30:00 +0900'):
        return {'source': '財務省', 'title': '財務大臣の記者会見', 'url': MOF_URL,
                **sources._publication(published)}

    def extract(self, payload, item=None, *, now=NOW, since=date(2026, 10, 2), final=None):
        item = item or self.stat_item()
        return sources._extract_article(payload, item, final or item['url'], now, since,
                                        observed_at=NOW.timestamp() + 7)

    def test_short_shift_jis_stat_result_keeps_day_precision_and_full_text(self):
        result = self.extract(stat_html())
        self.assertIsNone(result['published_at'])
        self.assertEqual(result['published_date'], '2026-10-02')
        self.assertEqual(result['publication_precision'], 'day')
        self.assertEqual(result['observed_at'], NOW.timestamp() + 7)
        self.assertIn('6849万人', result['body'])
        self.assertIn('0.1ポイントの上昇', result['body'])
        self.assertNotIn('Adobe', result['body'])
        self.assertEqual(result['body_sha256'], sha256(result['body'].encode()).hexdigest())
        self.assertEqual(result['evidence_url'], STAT_URL)

    def test_mof_rss_exact_time_is_correlated_with_page_day_and_body(self):
        item = self.mof_item()
        result = self.extract(mof_html(), item)
        self.assertEqual(result['published_at'], item['published_at'])
        self.assertEqual(result['publication_precision'], 'second')
        self.assertIn('目標を設定したわけではありません', result['body'])
        self.assertNotIn('Footer', result['body'])
        self.assertEqual(set(result), {'source', 'title', 'url', 'body', 'body_sha256', 'evidence_url',
                                     'published_at', 'published_date', 'publication_precision', 'observed_at'})

    def test_rdf_uses_item_date_not_channel_date(self):
        data = feed([rss_item(STAT_URL, '労働力調査（基本集計）2026年8月分結果', '2026-10-02', rdf=True)], rdf=True)
        values = sources._feed_items(data, sources.FEEDS['総務省統計局'], NOW, date(2026, 10, 2))
        self.assertEqual(len(values), 1)
        self.assertEqual(values[0]['published_date'], '2026-10-02')
        self.assertIsNone(values[0]['published_at'])

    def test_original_date_required_and_updated_is_not_a_substitute(self):
        for published, tag in ((None, None), ('2026-10-02T10:00:00+09:00', 'updated'),
                               ('2026-10-02T10:00:00', 'pubDate'), ('invalid', 'pubDate')):
            with self.subTest(published=published, tag=tag):
                data = feed([rss_item(MOF_URL, '財務大臣の記者会見', published, date_tag=tag)])
                self.assertEqual(sources._feed_items(data, sources.FEEDS['財務省'], NOW, date(2026, 10, 2)), [])

    def test_missing_or_conflicting_body_date_and_missing_body_are_rejected(self):
        for payload in (mof_html(published=None), mof_html(published='2026-10-01'),
                        mof_html(body='短い'), mof_html().replace(b'unique-block', b'unknown'),
                        mof_html().replace(b'<h1', b'<h2').replace(b'</h1>', b'</h2>')):
            with self.subTest(payload_length=len(payload)):
                self.assertIsNone(self.extract(payload, self.mof_item()))
        self.assertIsNone(self.extract(stat_html(), self.stat_item('2026-10-01')))

    def test_conflicting_exact_publication_times_rejected_but_date_only_correlates(self):
        self.assertIsNone(self.extract(mof_html(published='2026-10-02T18:00:00+09:00'), self.mof_item()))
        item = self.mof_item('2026-10-02')
        result = self.extract(mof_html(published='2026-10-02T19:30:00+09:00'), item)
        self.assertEqual(result['publication_precision'], 'second')

    def test_publication_dates_and_event_months_are_not_confused(self):
        result = self.extract(stat_html())
        self.assertEqual(result['published_date'], '2026-10-02')
        self.assertIn('8月分結果', result['body'])
        self.assertIsNone(self.extract(mof_html(published='2026-10-03'), self.mof_item('2026-10-03')))

    def test_since_boundary_respects_precision_without_fabricated_times(self):
        later = datetime(2026, 10, 5, 8, tzinfo=sources.JST)
        self.assertIsNotNone(self.extract(stat_html(), now=later, since=date(2026, 10, 2)))
        self.assertIsNotNone(self.extract(stat_html(), now=later, since=datetime(2026, 10, 2, tzinfo=sources.JST)))
        self.assertIsNone(self.extract(stat_html(), now=later, since=datetime(2026, 10, 2, 8, tzinfo=sources.JST)))
        self.assertIsNotNone(self.extract(mof_html(), self.mof_item(), now=later,
                                         since=datetime(2026, 10, 2, 19, 30, tzinfo=sources.JST)))
        self.assertIsNone(self.extract(mof_html(), self.mof_item(), now=later,
                                      since=datetime(2026, 10, 2, 19, 30, 1, tzinfo=sources.JST)))
        self.assertIsNone(self.extract(stat_html(), now=later, since=later.date()))

    def test_unknown_host_non_article_path_credentials_query_and_redirect_rejected(self):
        unsafe = ('https://example.test/a.html', 'http://www.stat.go.jp/data/roudou/sokuhou/tsuki/index.html',
                  'https://www.stat.go.jp.evil.test/data/roudou/sokuhou/tsuki/index.html',
                  'https://user@www.stat.go.jp/data/roudou/sokuhou/tsuki/index.html',
                  'https://www.mof.go.jp/about_mof/recruit/index.html',
                  'https://www.mof.go.jp/jgbs/auction/20261002.html', STAT_URL + '?next=private',
                  STAT_URL.replace('.html', '.pdf'), 'https://127.0.0.1/a.html')
        for url in unsafe:
            with self.subTest(url=url):
                self.assertIsNone(sources._safe_url(url))
                with patch.object(sources, '_public_ip') as dns:
                    with self.assertRaises(ValueError):
                        sources._download(url, 10)
                    dns.assert_not_called()
        self.assertIsNone(self.extract(stat_html(), final=MOF_URL))

    def test_rss_excludes_non_economic_topics_auctions_recruitment_and_external_urls(self):
        items = [rss_item(MOF_URL, title, 'Fri, 02 Oct 2026 19:30:00 +0900') for title in
                 ('国際金融の入札結果', '財政調査員の採用', '財務大臣の会見開催予定', '税制資料の公表予定')]
        items.append(rss_item('https://example.test/economy.html', '財務大臣の記者会見', '2026-10-02'))
        self.assertEqual(sources._feed_items(feed(items), sources.FEEDS['財務省'], NOW, NOW.date()), [])

    def test_oversize_body_is_rejected_whole_not_truncated_into_partial_evidence(self):
        self.assertIsNone(self.extract(mof_html(body='あ' * (sources.MAX_BODY_CHARS + 1)), self.mof_item()))
        body = MOF_BODY + '\n末尾の重要な条件です。'
        result = self.extract(mof_html(body), self.mof_item())
        self.assertTrue(result['body'].endswith('末尾の重要な条件です。'))

    def test_complete_collection_is_fixed_bounded_and_records_actual_observation_time(self):
        fixtures = {sources.FEEDS['総務省統計局']: feed([rss_item(STAT_URL, '労働力調査（基本集計）結果', '2026-10-02', rdf=True)], rdf=True),
                    sources.FEEDS['財務省']: feed([rss_item(MOF_URL, '財務大臣の記者会見', 'Fri, 02 Oct 2026 19:30:00 +0900')]),
                    sources.FEEDS['日本銀行']: feed([]),
                    STAT_URL: stat_html(), MOF_URL: mof_html()}
        def download(url, deadline):
            self.assertIn(url, fixtures)
            return fixtures[url], url
        with patch.object(sources, '_download', side_effect=download) as get, \
                patch.object(sources.time, 'time', return_value=NOW.timestamp() + 11):
            records = sources.collect_official_articles(NOW)
        self.assertEqual(len(records), 2)
        self.assertEqual(get.call_count, 5)
        self.assertEqual({row['source'] for row in records}, {'総務省統計局', '財務省'})
        self.assertTrue(all(row['observed_at'] == NOW.timestamp() + 11 for row in records))
        self.assertTrue(all(row['body_verified_at'] == NOW.timestamp() + 11 for row in records))
        self.assertIsNone(next(row for row in records if row['source'] == '総務省統計局')['published_at'])

    def test_xml_entity_declaration_and_scanned_item_limit(self):
        with self.assertRaises(ValueError):
            sources._feed_items(b'<!DOCTYPE rss [<!ENTITY x "boom">]><rss/>', sources.FEEDS['財務省'], NOW, NOW.date())
        bad = rss_item(MOF_URL, '採用', '2026-10-02')
        good = rss_item(MOF_URL, '財務大臣の記者会見', '2026-10-02')
        data = feed([bad] * sources.MAX_FEED_ITEMS + [good])
        self.assertEqual(sources._feed_items(data, sources.FEEDS['財務省'], NOW, NOW.date()), [])

    def test_many_mof_items_do_not_crowd_out_statistics_and_return_order_is_stable(self):
        urls = [f'https://www.mof.go.jp/policy/international_policy/convention/dialogue/20261002{i:02d}.html'
                for i in range(25)]
        documents = {sources.FEEDS['総務省統計局']: feed([rss_item(STAT_URL, '労働力調査の結果', '2026-10-02', rdf=True)], rdf=True),
                     sources.FEEDS['財務省']: feed([rss_item(url, f'金融経済の発表{i}', 'Fri, 02 Oct 2026 19:30:00 +0900')
                                                 for i, url in reversed(list(enumerate(urls)))]),
                     sources.FEEDS['日本銀行']: feed([rss_item(BOJ_HTML_URL, BOJ_TITLE, '2026-10-02')]),
                     BOJ_HTML_URL: boj_html(), STAT_URL: stat_html(), **{url: mof_html() for url in urls}}
        with patch.object(sources, '_download', side_effect=lambda url, _: (documents[url], url)) as get:
            records = sources.collect_official_articles(NOW)
        fetched = [call.args[0] for call in get.call_args_list if call.args[0] not in sources.FEEDS.values()]
        self.assertEqual(len(fetched), sources.MAX_CANDIDATES)
        self.assertIn(STAT_URL, fetched)
        self.assertEqual(len(records), sources.MAX_ARTICLES)
        self.assertIn('総務省統計局', {row['source'] for row in records})
        self.assertIn('日本銀行', {row['source'] for row in records})
        self.assertEqual([(row['source'], row['url']) for row in records],
                         sorted((row['source'], row['url']) for row in records))

        expected = records
        for reorder in (lambda values: list(reversed(values)), lambda values: values[1:] + values[:1]):
            def unordered(items, function, deadline):
                return reorder([function(item) for item in items])
            with self.subTest(order=reorder), \
                    patch.object(sources, '_parallel', side_effect=unordered), \
                    patch.object(sources, '_download', side_effect=lambda url, _: (documents[url], url)):
                unordered_records = sources.collect_official_articles(NOW)
            self.assertEqual([(row['source'], row['url']) for row in unordered_records],
                             [(row['source'], row['url']) for row in expected])
            self.assertIn('総務省統計局', {row['source'] for row in unordered_records})

    def test_transport_accepts_rdf_and_rejects_cross_host_redirect(self):
        session = MagicMock()
        response = session.get.return_value.__enter__.return_value
        response.status_code = 200
        response.headers = {'Content-Type': 'application/rdf+xml'}
        response.raw.read1.side_effect = [b'<rdf/>', b'']
        with patch.object(sources.requests, 'Session') as factory, patch.object(sources, '_public_ip', return_value='8.8.8.8'), \
                patch.object(sources, '_PinnedHTTPSAdapter'), patch.object(sources.time, 'monotonic', return_value=0):
            factory.return_value.__enter__.return_value = session
            body, url = sources._download(sources.FEEDS['総務省統計局'], 55)
            self.assertEqual(body, b'<rdf/>')
            self.assertFalse(session.trust_env)
            self.assertFalse(session.get.call_args.kwargs['allow_redirects'])
            response.status_code = 302
            response.headers = {'Location': MOF_URL}
            with self.assertRaisesRegex(ValueError, 'unapproved_redirect'):
                sources._download(STAT_URL, 55)

    def test_invalid_clock_inputs_are_rejected_before_collection(self):
        for now in (True, float('nan'), datetime(2026, 10, 2), '2026-10-02'):
            with self.subTest(now=now), patch.object(sources, '_download') as get:
                with self.assertRaises(ValueError):
                    sources.collect_official_articles(now)
                get.assert_not_called()
        self.assertEqual(sources._since('2026-10-02', NOW), date(2026, 10, 2))


class MinistryConferencePublicationTests(unittest.TestCase):
    url = 'https://www.mof.go.jp/public_relations/conference/my20261006.html'
    archive_url = 'https://www.mof.go.jp/public_relations/whats_new/202610.html'
    title = '片山財務大臣兼内閣府特命担当大臣閣議後記者会見の概要(令和8年10月6日(火曜日))'
    now = datetime(2026, 10, 8, 7, 20, tzinfo=sources.JST)
    since = datetime(2026, 10, 7, tzinfo=sources.JST)

    def item(self, published='Wed, 07 Oct 2026 12:25:00 +0900'):
        return {'source': '財務省', 'title': self.title, 'url': self.url,
                **sources._publication(published)}

    def html(self, *, title=None, event='2026-10-06', extra=''):
        payload = mof_html(published=event).decode().replace('財務大臣の記者会見', escape(title or self.title))
        return payload.replace('</head>', extra + '</head>').encode()

    def archive(self, *, title=None, url='../conference/my20261006.html',
                day='令和8年10月07日（水曜日）', month='令和8年（2026年）新着情報：10月', duplicate=False):
        entry = ('<li class="information-item">'
                 f'<a class="information-item-inner" href="{escape(url)}">'
                 '<span class="information-item-label label -conference">会見等</span>'
                 f'<div class="information-item-content"><p>{escape(title or self.title)}</p></div></a></li>')
        return (f'<html><meta charset="utf-8"><main id="main"><h1>{escape(month)}</h1>'
                f'<section><h3>{escape(day)}</h3><ul class="information">{entry}{entry if duplicate else ""}'
                '</ul></section></main></html>').encode()

    def extract(self, *, html=None, archive=None, item=None, final=None, since=None):
        item = item or self.item()
        with patch.object(sources, '_download', return_value=(archive or self.archive(), self.archive_url)) as download:
            result = sources._extract_article(html or self.html(), item, final or item['url'], self.now,
                since or self.since, observed_at=self.now.timestamp(), deadline=12345)
        return result, download

    def collect(self, *, html=None, archive=None, clock=None, until=None):
        documents = {sources.FEEDS['財務省']: feed([rss_item(self.url, self.title, 'Wed, 07 Oct 2026 12:25:00 +0900')]),
                     self.url: html or self.html(), self.archive_url: archive or self.archive()}
        report = {}
        with patch.object(sources, '_download', side_effect=lambda url, *args, **kwargs: (documents[url], url)) as download:
            rows = sources.collect_official_articles(self.now, since=self.since, until=until,
                enabled_sources=('財務省',), diagnostics=report, clock=clock or (lambda: self.now.timestamp()))
        return rows, report, download

    def test_event_day_and_independently_corroborated_posting_day_are_preserved(self):
        result, download = self.extract()
        self.assertEqual(result['published_date'], '2026-10-07')
        self.assertEqual(result['published_at'], self.item()['published_at'])
        self.assertEqual(result['event_date'], '2026-10-06')
        self.assertEqual(result['event_date_kind'], 'press_conference')
        self.assertEqual(result['evidence_url'], self.url)
        self.assertEqual(result['publication_evidence'], {'url': self.archive_url, 'title': self.title,
            'published_date': '2026-10-07', 'html_sha256': sha256(self.archive()).hexdigest()})
        self.assertEqual(result['body_sha256'], sha256(result['body'].encode()).hexdigest())
        download.assert_called_once_with(self.archive_url, 12345,
            max_bytes=sources.MAX_BYTES - len(self.html()), publication_archive=True)

    def test_date_only_posting_does_not_acquire_an_invented_time(self):
        result, _ = self.extract(item=self.item('2026-10-07'))
        self.assertEqual(result['publication_precision'], 'day')
        self.assertIsNone(result['published_at'])

    def test_collection_verification_time_follows_archive_validation(self):
        readings = iter((self.now.timestamp(), self.now.timestamp() + 4))
        rows, report, download = self.collect(clock=lambda: next(readings))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['observed_at'], self.now.timestamp())
        self.assertEqual(rows[0]['body_verified_at'], self.now.timestamp() + 4)
        self.assertEqual(report['財務省']['status'], 'collected')
        self.assertEqual(download.call_count, 3)

    def test_archive_date_title_url_month_and_unique_placement_must_all_agree(self):
        payloads = (self.archive(title='財務大臣の別の記者会見'),
                    self.archive(url='../conference/my20261002.html'),
                    self.archive(url=self.url + '?unexpected=1'),
                    self.archive(url=self.url.replace('www.mof.go.jp', 'www.mof.go.jp.evil.test')),
                    self.archive(day='令和8年10月06日（火曜日）'),
                    self.archive(day='令和8年10月07日（火曜日）'),
                    self.archive(month='令和8年（2026年）新着情報：9月'),
                    self.archive(duplicate=True),
                    self.archive().replace(b'<main id="main">', b'<footer>'),
                    self.archive().replace(b'<section>', b'<nav><section>').replace(b'</section>', b'</section></nav>'),
                    self.archive().replace(b'<section>', b'<section class="related">'),
                    self.archive().replace(b'<h3>', b'<h4>'),
                    self.archive().replace(b'information-item-content', b'unverified-title'))
        for payload in payloads:
            with self.subTest(payload_length=len(payload)):
                result, _ = self.extract(archive=payload)
                self.assertIsNone(result)

    def test_page_event_metadata_heading_and_declared_identity_cannot_conflict(self):
        payloads = (self.html(event=None), self.html(event='2026-10-05'),
                    self.html(event='2026-10-06T12:00:00+09:00'),
                    self.html(title=self.title.replace('10月6日', '10月5日')),
                    self.html(extra='<meta name="date" content="2026-10-05">'),
                    self.html(extra='<meta property="date" content="2026-10-05">'),
                    self.html(extra='<meta property="article:published_time" content="2026-10-07T12:24:00+09:00">'),
                    self.html(extra='<meta name="datePublished" content="invalid">'),
                    self.html(extra='<link rel="canonical" href="my20261002.html">'),
                    self.html(extra='<meta property="og:url" content="https://example.test/changed.html">'),
                    self.html().replace(b'</h1>', b'</h1><h1>another title</h1>'))
        for payload in payloads:
            with self.subTest(payload_length=len(payload)):
                result, download = self.extract(html=payload)
                self.assertIsNone(result)
                download.assert_not_called()
        result, _ = self.extract(html=self.html(extra='<meta property="article:published_time" content="2026-10-07T12:25:00+09:00">'))
        self.assertIsNotNone(result)

    def test_future_or_later_than_posting_conference_cannot_be_reclassified(self):
        for event, title in (('2026-10-08', self.title.replace('10月6日', '10月8日')),
                             ('2026-10-09', self.title.replace('10月6日', '10月9日'))):
            item = {**self.item(), 'title': title}
            result, download = self.extract(html=self.html(title=title, event=event), item=item)
            self.assertIsNone(result)
            download.assert_not_called()

    def test_publication_window_uses_posting_time_and_never_event_day(self):
        result, _ = self.extract(since=datetime(2026, 10, 7, 12, 25, tzinfo=sources.JST))
        self.assertIsNotNone(result)
        result, download = self.extract(since=datetime(2026, 10, 7, 12, 25, 1, tzinfo=sources.JST))
        self.assertIsNone(result)
        download.assert_not_called()
        rows, _, download = self.collect(until=datetime(2026, 10, 7, 12, 24, 59, tzinfo=sources.JST))
        self.assertEqual(rows, [])
        self.assertEqual(download.call_count, 1)

    def test_month_boundary_uses_posting_month_for_archive(self):
        title = self.title.replace('10月6日(火曜日)', '9月30日(水曜日)')
        item = {**self.item('Thu, 01 Oct 2026 12:25:00 +0900'), 'title': title}
        result, download = self.extract(html=self.html(title=title, event='2026-09-30'), item=item,
            archive=self.archive(title=title, day='令和8年10月01日（木曜日）'), since=date(2026, 10, 1))
        self.assertIsNotNone(result)
        self.assertEqual(result['event_date'], '2026-09-30')
        self.assertEqual(download.call_args.args[0], self.archive_url)

    def test_nonconference_articles_and_redirected_pages_keep_strict_dates(self):
        item = {**self.item(), 'url': 'https://www.mof.go.jp/policy/budget/topics/test.html'}
        result, download = self.extract(item=item)
        self.assertIsNone(result)
        download.assert_not_called()
        result, download = self.extract(final=MOF_URL)
        self.assertIsNone(result)
        download.assert_not_called()

    def test_failed_or_inconsistent_archive_is_not_a_successful_empty_window(self):
        rows, report, _ = self.collect(archive=self.archive(day='令和8年10月06日（火曜日）'))
        self.assertEqual(rows, [])
        self.assertEqual(report['財務省']['status'], 'articles_unavailable')
        self.assertIn('body_or_date_unverified', report['財務省']['errors'])
        with patch.object(sources, '_download', side_effect=ValueError('source_unavailable')):
            with self.assertRaisesRegex(ValueError, '^source_unavailable$'):
                sources._extract_article(self.html(), self.item(), self.url, self.now, self.since,
                    observed_at=self.now.timestamp())

    def test_archive_and_article_share_size_budget_and_archive_cannot_redirect(self):
        for payload, final, error in ((b'x' * sources.MAX_BYTES, self.archive_url, 'source_size_limit'),
                                     (self.archive(), self.archive_url.replace('202610', '202609'), 'unapproved_redirect')):
            with self.subTest(error=error), patch.object(sources, '_download', return_value=(payload, final)):
                with self.assertRaisesRegex(ValueError, '^' + error + '$'):
                    sources._extract_article(self.html(), self.item(), self.url, self.now, self.since,
                        observed_at=self.now.timestamp(), deadline=12345)

    def test_archive_transport_requires_explicit_exact_allowlist_and_html(self):
        self.assertIsNone(sources._safe_url(self.archive_url))
        self.assertEqual(sources._safe_url(self.archive_url, allow_publication_archive=True), self.archive_url)
        unsafe = (self.archive_url.replace('202610', '202613'), self.archive_url.replace('202610', '202600'),
                  self.archive_url.replace('whats_new', 'conference'), self.archive_url + '?redirect=1',
                  self.archive_url.replace('https:', 'http:'), self.archive_url.replace('www.mof.go.jp', 'www.stat.go.jp'))
        for url in unsafe:
            with self.subTest(url=url), patch.object(sources, '_public_ip') as dns:
                self.assertIsNone(sources._safe_url(url, allow_publication_archive=True))
                with self.assertRaisesRegex(ValueError, '^unapproved_source$'):
                    sources._download(url, 55, publication_archive=True)
                dns.assert_not_called()
        with patch.object(sources, '_public_ip') as dns:
            with self.assertRaisesRegex(ValueError, '^unapproved_source$'):
                sources._download(self.url, 55, publication_archive=True)
            dns.assert_not_called()
        session = MagicMock()
        response = session.get.return_value.__enter__.return_value
        response.status_code = 302
        for target in (self.archive_url.replace('202610', '202609'), self.url):
            response.headers = {'Location': target}
            with self.subTest(target=target), patch.object(sources.requests, 'Session') as factory, \
                    patch.object(sources, '_public_ip', return_value='8.8.8.8'), \
                    patch.object(sources, '_PinnedHTTPSAdapter'), patch.object(sources.time, 'monotonic', return_value=0):
                factory.return_value.__enter__.return_value = session
                with self.assertRaisesRegex(ValueError, '^unapproved_redirect$'):
                    sources._download(self.archive_url, 55, publication_archive=True)
        response.status_code, response.headers = 200, {'Content-Type': 'application/rss+xml'}
        with patch.object(sources.requests, 'Session') as factory, patch.object(sources, '_public_ip', return_value='8.8.8.8'), \
                patch.object(sources, '_PinnedHTTPSAdapter'), patch.object(sources.time, 'monotonic', return_value=0):
            factory.return_value.__enter__.return_value = session
            with self.assertRaisesRegex(ValueError, '^source_content_type$'):
                sources._download(self.archive_url, 55, publication_archive=True)


class MinistrySupportingPDFTests(unittest.TestCase):
    parent = 'https://www.mof.go.jp/policy/international_policy/convention/dialogue/20260925182123.html'
    pdf_url = 'https://www.mof.go.jp/policy/international_policy/convention/dialogue/JointStrategicFinancingMemorandumofCooperation.pdf'
    title = 'Japan-Australia Joint Strategic Financing Memorandum of Cooperation'
    signature = 'Signed in duplicate at the Australian Embassy, Tokyo on 2 October 2026.'
    now = datetime(2026, 10, 5, 20, 0, tzinfo=sources.JST)

    def item(self, published='Mon, 05 Oct 2026 12:00:00 +0900', *, url=None):
        return {'source': '財務省', 'title': '日豪共同戦略金融協力覚書への署名（令和8年10月2日）',
                'url': url or self.parent, **sources._publication(published)}

    def html(self, *, link=None, location='body', published='2026-10-05'):
        link = self.pdf_url if link is None else link
        anchor = f'<a href="{escape(link)}">覚書全文（英語）</a>' if link else ''
        if location == 'footer':
            inside, outside = '', f'<footer>{anchor}</footer>'
        elif location == 'related':
            inside, outside = f'<div class="related">{anchor}</div>', ''
        elif location == 'script':
            inside, outside = f'<script>{anchor}</script>', ''
        else:
            inside, outside = anchor, ''
        return (f'<html><meta name="date" content="{published}"><main id="main">'
                f'<h1>{self.item()["title"]}</h1><div class="unique-block">'
                '<p>これは親の記事と補足資料の取得を確認するための架空の説明です。'
                '実際の発表内容として利用しないでください。</p>'
                '<p>この試験は本文を省略せずに取得することと、文書の署名日と元記事の発表日を'
                '区別することを検証します。別資料の内容を推測して埋めることはしません。</p>'
                f'{inside}</div>{outside}</main></html>').encode()

    def pdf(self, *, blank_last=False):
        return synthetic_pdf(page_texts=[self.title,
            'Synthetic page 2: this page contains a condition absent from the HTML introduction.',
            'Synthetic page 3: this fixture is not a real memorandum or a factual news source.',
            self.signature], blank_last=blank_last)

    def extract(self, payload=None, *, item=None, final=None, deadline=None):
        item = item or self.item()
        return sources._extract_article(self.html() if payload is None else payload,
            item, final or item['url'], self.now, self.now.date(),
            observed_at=self.now.timestamp(), deadline=deadline)

    def collect(self, *, html=None, pdf=None, diagnostics=None, clock=None):
        documents = {sources.FEEDS['財務省']: feed([rss_item(self.parent, self.item()['title'],
                     'Mon, 05 Oct 2026 12:00:00 +0900')]),
                     self.parent: self.html() if html is None else html,
                     self.pdf_url: self.pdf() if pdf is None else pdf}
        with patch.object(sources, '_download', side_effect=lambda url, _, **kwargs: (documents[url], url)):
            return sources.collect_official_articles(self.now, enabled_sources=('財務省',),
                diagnostics=diagnostics, clock=clock or (lambda: self.now.timestamp() + 5))

    def test_whole_pdf_extends_body_preserves_parent_publication_and_hashes(self):
        parsed = sources._pdf_text
        finished = [False]
        def parse(*args, **kwargs):
            body = parsed(*args, **kwargs)
            finished[0] = True
            return body
        with patch.object(sources, '_pdf_text', side_effect=parse):
            rows = self.collect(clock=lambda: self.now.timestamp() + (5 if finished[0] else 0))
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row['url'], self.parent)
        self.assertEqual(row['evidence_url'], self.parent)
        self.assertEqual(row['published_date'], '2026-10-05')
        self.assertEqual(row['published_at'], self.item()['published_at'])
        self.assertEqual(row['publication_precision'], 'second')
        self.assertEqual(row['observed_at'], self.now.timestamp())
        self.assertEqual(row['body_verified_at'], self.now.timestamp() + 5)
        self.assertIn('Synthetic page 2', row['body'])
        self.assertIn('Synthetic page 3', row['body'])
        self.assertIn(self.signature, row['body'])
        self.assertIn('（HTML）', row['body'])
        self.assertIn('（PDF全文）', row['body'])
        self.assertIn(self.pdf_url, row['body'])
        self.assertEqual(row['body_sha256'], sha256(row['body'].encode()).hexdigest())
        pdf_body = parsed(self.pdf())
        self.assertEqual(row['supporting_documents'], [{'url': self.pdf_url, 'parent_url': self.parent,
            'title': self.title, 'body_sha256': sha256(pdf_body.encode()).hexdigest(),
            'document_date': '2026-10-02', 'document_date_kind': 'signed'}])
        self.assertEqual(row['source_scope'], 'official_html_with_verified_supporting_pdf')

    def test_registered_pdf_must_be_linked_inside_included_body(self):
        cases = [self.html(link=''), self.html(location='footer'), self.html(location='related'),
                 self.html(location='script'), self.html(link=self.pdf_url.replace('www.mof.go.jp', 'example.org')),
                 self.html(link=self.pdf_url + '?next=unapproved'),
                 self.html(link=self.pdf_url.replace('.pdf', '-other.pdf'))]
        for payload in cases:
            with self.subTest(payload=payload[-120:]), patch.object(sources, '_download') as download:
                with self.assertRaisesRegex(ValueError, 'supporting_pdf_link_missing'):
                    self.extract(payload)
                download.assert_not_called()

    def test_relative_body_link_and_day_precision_use_shared_deadline_and_byte_budget(self):
        payload = self.html(link='JointStrategicFinancingMemorandumofCooperation.pdf')
        body = self.title + '\n' + ('Synthetic evidence. ' * 10) + self.signature
        with patch.object(sources, '_download', return_value=(b'%PDF-test', self.pdf_url)) as download, \
                patch.object(sources, '_pdf_text', return_value=body) as parser:
            row = self.extract(payload, item=self.item('2026-10-05'), deadline=123.0)
        download.assert_called_once_with(self.pdf_url, 123.0, max_bytes=sources.MAX_BYTES - len(payload),
                                         supporting_pdf=True)
        parser.assert_called_once_with(b'%PDF-test', 123.0, allow_empty_password_pdf=True)
        self.assertIsNone(row['published_at'])
        self.assertEqual(row['publication_precision'], 'day')
        self.assertEqual(row['published_date'], '2026-10-05')

    def test_pdf_failures_skip_the_article_instead_of_using_introduction(self):
        for pdf, error in [(b'not a PDF', 'pdf_invalid'), (self.pdf(blank_last=True), 'pdf_unreadable_page')]:
            diagnostics = {}
            with self.subTest(error=error):
                self.assertEqual(self.collect(pdf=pdf, diagnostics=diagnostics), [])
                self.assertEqual(diagnostics['財務省']['status'], 'articles_unavailable')
                self.assertIn(error, diagnostics['財務省']['errors'])
        with patch.object(sources, '_download', side_effect=ValueError('source_unavailable')):
            with self.assertRaisesRegex(ValueError, 'source_unavailable'):
                self.extract()
        with patch.object(sources, '_download', return_value=(b'%PDF-test', self.pdf_url)), \
                patch.object(sources, '_pdf_text', side_effect=ValueError('pdf_time_limit')):
            with self.assertRaisesRegex(ValueError, 'pdf_time_limit'):
                self.extract()

    def test_wrong_title_signing_date_or_redirected_identity_is_rejected(self):
        body = self.title + '\n' + ('Synthetic evidence. ' * 10) + self.signature
        for text in (body.replace(self.title, 'Unrelated financial document'), body.replace('2 October', '3 October')):
            with self.subTest(text=text[:80]), \
                    patch.object(sources, '_download', return_value=(b'%PDF-test', self.pdf_url)), \
                    patch.object(sources, '_pdf_text', return_value=text):
                with self.assertRaisesRegex(ValueError, 'supporting_pdf_identity_mismatch'):
                    self.extract()
        with patch.object(sources, '_download', return_value=(b'%PDF-test', MOF_URL)), \
                patch.object(sources, '_pdf_text') as parser:
            with self.assertRaisesRegex(ValueError, 'unapproved_redirect'):
                self.extract()
            parser.assert_not_called()
        with patch.object(sources, '_download') as download:
            for item, final in [(self.item(), MOF_URL), (self.item(url=MOF_URL), self.parent)]:
                with self.subTest(final=final), self.assertRaisesRegex(ValueError, 'supporting_pdf_identity_mismatch'):
                    self.extract(item=item, final=final)
            download.assert_not_called()

    def test_parent_date_must_verify_before_attachment_fetch_and_other_articles_stay_html(self):
        with patch.object(sources, '_download') as download:
            self.assertIsNone(self.extract(self.html(published='2026-10-02')))
            row = self.extract(item=self.item(url=MOF_URL))
            self.assertNotIn('supporting_documents', row)
            self.assertNotIn('PDF全文', row['body'])
            download.assert_not_called()
        self.assertIsNone(sources._safe_url(self.pdf_url.replace('.pdf', '-unknown.pdf')))
        self.assertIsNone(sources._safe_url(self.pdf_url))
        self.assertEqual(sources._safe_url(self.pdf_url, allow_supporting_pdf=True), self.pdf_url)
        self.assertIsNone(sources._safe_url(self.pdf_url.replace('.pdf', '-unknown.pdf'), allow_supporting_pdf=True))
        self.assertEqual(sources._feed_items(feed([rss_item(self.pdf_url, '金融協力覚書', '2026-10-05')]),
                         sources.FEEDS['財務省'], self.now, self.now.date()), [])

    def test_combined_download_and_text_limits_include_html_and_section_labels(self):
        html, pdf = self.html(), self.pdf()
        with patch.object(sources, 'MAX_BYTES', len(html) + len(pdf) - 1), \
                patch.object(sources, '_download', return_value=(pdf, self.pdf_url)), \
                patch.object(sources, '_pdf_text') as parser:
            with self.assertRaisesRegex(ValueError, 'source_size_limit'):
                self.extract(html)
            parser.assert_not_called()
        pdf_body = self.title + ('x' * (sources.MAX_BODY_CHARS - len(self.title) - len(self.signature))) + self.signature
        with patch.object(sources, '_download', return_value=(pdf, self.pdf_url)), \
                patch.object(sources, '_pdf_text', return_value=pdf_body):
            with self.assertRaisesRegex(ValueError, 'pdf_text_limit'):
                self.extract(html)

    def test_pdf_transport_pins_host_checks_mime_byte_budget_deadline_and_redirects(self):
        session = MagicMock()
        response = session.get.return_value.__enter__.return_value
        response.status_code = 200
        response.headers = {'Content-Type': 'application/pdf'}
        response.raw.read1.side_effect = [b'%PDF-test', b'']
        with patch.object(sources.requests, 'Session') as factory, \
                patch.object(sources, '_public_ip', return_value='8.8.8.8') as public_ip, \
                patch.object(sources, '_PinnedHTTPSAdapter') as adapter, \
                patch.object(sources.time, 'monotonic', return_value=0):
            factory.return_value.__enter__.return_value = session
            with self.assertRaisesRegex(ValueError, 'unapproved_source'):
                sources._download(self.pdf_url, 55)
            self.assertEqual(sources._download(self.pdf_url, 55, max_bytes=20, supporting_pdf=True),
                             (b'%PDF-test', self.pdf_url))
            public_ip.assert_called_with('www.mof.go.jp')
            adapter.assert_called_with('www.mof.go.jp', '8.8.8.8')
            self.assertFalse(session.trust_env)
            self.assertFalse(session.get.call_args.kwargs['allow_redirects'])
            self.assertTrue(session.get.call_args.kwargs['verify'])
            for mime in ('text/html', 'application/octet-stream'):
                response.headers = {'Content-Type': mime}
                with self.subTest(mime=mime), self.assertRaisesRegex(ValueError, 'source_content_type'):
                    sources._download(self.pdf_url, 55, supporting_pdf=True)
            response.headers = {'Content-Type': 'application/pdf', 'Content-Length': '21'}
            with self.assertRaisesRegex(ValueError, 'source_size_limit'):
                sources._download(self.pdf_url, 55, max_bytes=20, supporting_pdf=True)
            response.headers = {'Content-Type': 'application/pdf'}
            response.raw.read1.side_effect = [b'x' * 21]
            with self.assertRaisesRegex(ValueError, 'source_size_or_time_limit'):
                sources._download(self.pdf_url, 55, max_bytes=20, supporting_pdf=True)
            response.status_code = 302
            for redirect in (MOF_URL, self.pdf_url.replace('www.mof.go.jp', 'example.org'),
                             self.pdf_url.replace('.pdf', '-other.pdf')):
                response.headers = {'Location': redirect}
                with self.subTest(redirect=redirect), self.assertRaisesRegex(ValueError, 'unapproved_redirect'):
                    sources._download(self.pdf_url, 55, supporting_pdf=True)
            before = session.get.call_count
            with self.assertRaisesRegex(ValueError, 'source_time_limit'):
                sources._download(self.pdf_url, 0, supporting_pdf=True)
            self.assertEqual(session.get.call_count, before)

    def test_registered_pdf_only_accepts_empty_user_password_with_explicit_copy_permission(self):
        pages = [self.title, 'Synthetic middle page with independently readable text.',
                 'Another synthetic middle page required for the whole document.', self.signature]
        accessible = synthetic_pdf(encrypted=True, password='', permissions=16, page_texts=pages)
        with self.assertRaisesRegex(ValueError, 'pdf_encrypted'):
            sources._pdf_text(accessible)  # Existing BOJ/ordinary parser policy is unchanged.
        rows = self.collect(pdf=accessible)
        self.assertEqual(len(rows), 1)
        self.assertIn(pages[2], rows[0]['body'])
        cases = [
            (synthetic_pdf(encrypted=True, password='', permissions=4, page_texts=pages), 'pdf_extraction_forbidden'),
            (synthetic_pdf(encrypted=True, password='required-password', permissions=16, page_texts=pages), 'pdf_encrypted'),
            # pypdf rejects an encryption dictionary without /P before extraction.
            (synthetic_pdf(encrypted=True, password='', missing_permissions=True, page_texts=pages), 'pdf_parse_failed'),
            (synthetic_pdf(encrypted=True, password='', permissions=16, page_texts=pages, blank_last=True), 'pdf_unreadable_page'),
        ]
        for payload, error in cases:
            with self.subTest(error=error):
                report = {}
                self.assertEqual(self.collect(pdf=payload, diagnostics=report), [])
                self.assertIn(error, report['財務省']['errors'])

    def test_empty_password_opt_in_is_boolean_and_child_receives_only_control_enum(self):
        for control in (1, 'true', None):
            with self.subTest(control=control), patch.object(sources.subprocess, 'run') as child:
                with self.assertRaisesRegex(ValueError, 'pdf_invalid'):
                    sources._pdf_text(b'%PDF-test', allow_empty_password_pdf=control)
                child.assert_not_called()
        for control, expected in [(False, 'reject_encrypted'), (True, 'allow_empty_password_pdf')]:
            with self.subTest(control=control), \
                    patch.object(sources.subprocess, 'run', side_effect=subprocess.TimeoutExpired('pdf', 8)) as child:
                with self.assertRaisesRegex(ValueError, 'pdf_time_limit'):
                    sources._pdf_text(b'%PDF-test', allow_empty_password_pdf=control)
                self.assertEqual(child.call_args.args[0][-1], expected)
                self.assertEqual(child.call_args.kwargs['env'], {})
                self.assertIn('-I', child.call_args.args[0])


class MinistryDialogueSupportingPDFTests(unittest.TestCase):
    parent = 'https://www.mof.go.jp/policy/international_policy/convention/dialogue/20260925182036.html'
    pdf_url = 'https://www.mof.go.jp/policy/international_policy/convention/dialogue/JP_MoU.pdf'
    title = '日本財務省と豪州財務省が代表する豪州政府との間の日豪財務大臣対話に関する協力覚書'
    signature = '本覚書は、2026年10月5日に東京において、英語により2通作成された。'
    now = datetime(2026, 10, 6, 20, 0, tzinfo=sources.JST)

    def item(self, published='Mon, 05 Oct 2026 12:00:00 +0900'):
        return {'source': '財務省', 'title': '日豪財務大臣対話に関する協力覚書への署名及び第1回対話',
                'url': self.parent, **sources._publication(published)}

    def html(self, **kwargs):
        return MinistrySupportingPDFTests.html(self, **kwargs).replace(
            '覚書全文（英語）'.encode(), '覚書全文（和文仮訳）'.encode())

    def pdf_body(self):
        # Synthetic text for identity/boundary checks, not factual news copy.
        return ('（仮訳）\n' + self.title + '\n' +
                '対話の添付資料だけに属する架空の条件です。実際の発表内容ではありません。' * 3 +
                '\n' + self.signature)

    def extract(self, payload=None, *, item=None, deadline=123.0):
        item = item or self.item()
        return sources._extract_article(self.html() if payload is None else payload,
            item, item['url'], self.now, date(2026, 10, 5),
            observed_at=self.now.timestamp(), deadline=deadline)

    def test_japanese_attachment_keeps_parent_identity_dates_and_whole_body_hash(self):
        payload, body = self.html(link='JP_MoU.pdf'), self.pdf_body()
        # Extraction may split Japanese title/date text with whitespace.
        body = body.replace('2026年10月5日', '２０２６ 年 １０ 月５ 日')
        with patch.object(sources, '_download', return_value=(b'%PDF-dialogue', self.pdf_url)) as download, \
                patch.object(sources, '_pdf_text', return_value=body) as parser:
            row = self.extract(payload)
        download.assert_called_once_with(self.pdf_url, 123.0,
            max_bytes=sources.MAX_BYTES - len(payload), supporting_pdf=True)
        parser.assert_called_once_with(b'%PDF-dialogue', 123.0, allow_empty_password_pdf=True)
        self.assertEqual(row['url'], self.parent)
        self.assertEqual(row['evidence_url'], self.parent)
        self.assertEqual(row['published_date'], '2026-10-05')
        self.assertEqual(row['published_at'], self.item()['published_at'])
        self.assertEqual(row['publication_precision'], 'second')
        self.assertEqual(row['body_sha256'], sha256(row['body'].encode()).hexdigest())
        self.assertTrue(row['body'].endswith(body))
        html, pdf = row['body'].split('【発表本文からリンクされた確認済み補足資料（PDF全文）】')
        self.assertIn(self.parent, html)
        self.assertNotIn('対話の添付資料だけ', html)
        self.assertIn(self.pdf_url, pdf)
        self.assertIn('（仮訳）', pdf)
        self.assertNotIn(MinistrySupportingPDFTests.pdf_url, row['body'])
        self.assertEqual(row['supporting_documents'], [{'url': self.pdf_url, 'parent_url': self.parent,
            'title': self.title, 'body_sha256': sha256(body.encode()).hexdigest(),
            'document_date': '2026-10-05', 'document_date_kind': 'signed'}])

    def test_only_exact_japanese_attachment_link_inside_this_parent_is_accepted(self):
        links = ['', 'En_MoU.pdf', 'JP_MoU-v2.pdf', self.pdf_url + '?download=1',
                 self.pdf_url.replace('www.mof.go.jp', 'example.org'), MinistrySupportingPDFTests.pdf_url]
        payloads = [self.html(link=link) for link in links]
        payloads += [self.html(location=location) for location in ('footer', 'related', 'script')]
        for payload in payloads:
            with self.subTest(payload=payload[-120:]), patch.object(sources, '_download') as download:
                with self.assertRaisesRegex(ValueError, '^supporting_pdf_link_missing$'):
                    self.extract(payload)
                download.assert_not_called()
        old = MinistrySupportingPDFTests()
        with patch.object(sources, '_download') as download:
            with self.assertRaisesRegex(ValueError, '^supporting_pdf_link_missing$'):
                old.extract(old.html(link=self.pdf_url))
            download.assert_not_called()
        self.assertIsNone(sources._safe_url(self.pdf_url))
        self.assertEqual(sources._safe_url(self.pdf_url, allow_supporting_pdf=True), self.pdf_url)
        self.assertIsNone(sources._safe_url(self.pdf_url.replace('JP_', 'En_'), allow_supporting_pdf=True))

    def test_other_memorandum_or_wrong_signature_date_cannot_satisfy_identity(self):
        old = MinistrySupportingPDFTests()
        for body in (self.pdf_body().replace(self.title, old.title),
                     self.pdf_body().replace('10月5日', '10月2日'),
                     old.title + '\n' + 'Synthetic unrelated document. ' * 5 + old.signature):
            with self.subTest(body=body[:80]), \
                    patch.object(sources, '_download', return_value=(b'%PDF-dialogue', self.pdf_url)), \
                    patch.object(sources, '_pdf_text', return_value=body):
                with self.assertRaisesRegex(ValueError, '^supporting_pdf_identity_mismatch$'):
                    self.extract()

    def test_signing_date_does_not_replace_parent_day_or_hide_date_mismatch(self):
        with patch.object(sources, '_download', return_value=(b'%PDF-dialogue', self.pdf_url)) as download, \
                patch.object(sources, '_pdf_text', return_value=self.pdf_body()):
            row = self.extract(self.html(published='2026-10-06'), item=self.item('2026-10-06'))
            self.assertEqual(row['published_date'], '2026-10-06')
            self.assertIsNone(row['published_at'])
            self.assertEqual(row['supporting_documents'][0]['document_date'], '2026-10-05')
            download.reset_mock()
            self.assertIsNone(self.extract(self.html(published='2026-10-06')))
            download.assert_not_called()

    def test_both_memoranda_keep_separate_full_bodies_and_documents(self):
        old = MinistrySupportingPDFTests()
        documents = {sources.FEEDS['財務省']: feed([
            rss_item(self.parent, self.item()['title'], '2026-10-05'),
            rss_item(old.parent, old.item()['title'], '2026-10-05')]),
            self.parent: self.html(), old.parent: old.html(),
            self.pdf_url: b'%PDF-dialogue', old.pdf_url: b'%PDF-financing'}
        bodies = {b'%PDF-dialogue': self.pdf_body(),
                  b'%PDF-financing': old.title + '\n' + 'Synthetic financing-only fixture. ' * 5 + old.signature}
        with patch.object(sources, '_download', side_effect=lambda url, _, **kw: (documents[url], url)), \
                patch.object(sources, '_pdf_text', side_effect=lambda payload, *a, **kw: bodies[payload]):
            rows = sources.collect_official_articles(self.now, since=date(2026, 10, 5),
                enabled_sources=('財務省',), clock=lambda: self.now.timestamp() + 5)
        self.assertEqual({row['url'] for row in rows}, {self.parent, old.parent})
        for row in rows:
            current = row['url'] == self.parent
            own_pdf, other_pdf = (self.pdf_url, old.pdf_url) if current else (old.pdf_url, self.pdf_url)
            self.assertIn(own_pdf, row['body'])
            self.assertNotIn(other_pdf, row['body'])
            self.assertEqual(row['supporting_documents'][0]['parent_url'], row['url'])
            self.assertEqual(row['supporting_documents'][0]['document_date'],
                             '2026-10-05' if current else '2026-10-02')
            self.assertEqual(row['body_sha256'], sha256(row['body'].encode()).hexdigest())
            self.assertEqual(row['body_verified_at'], self.now.timestamp() + 5)

    def test_failed_new_attachment_does_not_fall_back_to_html(self):
        for code in ('pdf_unreadable_page', 'pdf_extraction_forbidden', 'pdf_time_limit'):
            with self.subTest(code=code), \
                    patch.object(sources, '_download', return_value=(b'%PDF-dialogue', self.pdf_url)), \
                    patch.object(sources, '_pdf_text', side_effect=ValueError(code)):
                with self.assertRaisesRegex(ValueError, '^' + code + '$'):
                    self.extract()

    def test_new_attachment_cannot_redirect_to_other_registered_attachment(self):
        session = MagicMock()
        response = session.get.return_value.__enter__.return_value
        response.status_code = 302
        response.headers = {'Location': MinistrySupportingPDFTests.pdf_url}
        with patch.object(sources.requests, 'Session') as factory, \
                patch.object(sources, '_public_ip', return_value='8.8.8.8'), \
                patch.object(sources, '_PinnedHTTPSAdapter'), \
                patch.object(sources.time, 'monotonic', return_value=0):
            factory.return_value.__enter__.return_value = session
            with self.assertRaisesRegex(ValueError, '^unapproved_redirect$'):
                sources._download(self.pdf_url, 55, supporting_pdf=True)


class BankOfJapanSourceTests(unittest.TestCase):
    def item(self, *, url=BOJ_URL, publication='Fri, 02 Oct 2026 12:00:00 +0900'):
        return {'source': '日本銀行', 'title': BOJ_TITLE, 'url': url,
                **sources._publication(publication)}

    def extract(self, payload, item=None):
        item = item or self.item()
        return sources._extract_article(payload, item, item['url'], NOW, NOW.date(),
                                        observed_at=NOW.timestamp() + 1)

    def test_boj_rss_http_links_upgrade_only_approved_exact_host_and_path(self):
        data = feed([rss_item(BOJ_URL.replace('https:', 'http:'), BOJ_TITLE,
                              'Fri, 02 Oct 2026 12:00:00 +0900')])
        rows = sources._feed_items(data, sources.FEEDS['日本銀行'], NOW, NOW.date())
        self.assertEqual(rows, [self.item()])
        for url in (BOJ_URL.replace('www.boj.or.jp', 'www.boj.or.jp.evil.test'),
                    BOJ_URL.replace('https://', 'http://user@'),
                    BOJ_URL.replace('https://', 'http://').replace('.jp/', '.jp:80/'),
                    BOJ_URL.replace('/mpr_2026/', '/opinion_2026/'),
                    BOJ_URL + '?token=unexpected'):
            with self.subTest(url=url):
                self.assertIsNone(sources._safe_url(url))

    def test_minutes_speeches_references_and_schedule_are_not_policy_decisions(self):
        titles = ('金融政策決定会合の主な意見', '金融政策決定会合議事要旨',
                  '金融市場調節方針の変更について公表予定',
                  '（参考）金融市場調節方針の変更について',
                  '金融政策に関する総裁講演', '補完当座預金制度の適用利率の変更について')
        data = feed([rss_item(BOJ_URL, title, '2026-10-02') for title in titles])
        self.assertEqual(sources._feed_items(data, sources.FEEDS['日本銀行'], NOW, NOW.date()), [])

    def test_pdf_dateline_preserves_original_date_not_effective_date_or_future_minutes(self):
        with patch.object(sources, '_pdf_text', return_value=BOJ_BODY):
            result = self.extract(b'%PDF-test')
        self.assertEqual(result['published_date'], '2026-10-02')
        self.assertEqual(result['published_at'], self.item()['published_at'])
        self.assertEqual(result['body'], BOJ_BODY)
        self.assertIn('１０月５日', result['body'])
        self.assertTrue(result['body'].endswith('重要な条件があります。\n'))
        self.assertEqual(result['body_sha256'], sha256(BOJ_BODY.encode()).hexdigest())

    def test_pdf_date_only_never_gets_a_fabricated_time(self):
        with patch.object(sources, '_pdf_text', return_value=BOJ_BODY):
            result = self.extract(b'%PDF-test', self.item(publication='2026-10-02'))
        self.assertIsNone(result['published_at'])
        self.assertEqual(result['publication_precision'], 'day')

    def test_pdf_missing_or_conflicting_date_publisher_and_title_are_rejected(self):
        bodies = (BOJ_BODY.replace('１０月２日', '１０月１日'),
                  BOJ_BODY.replace('２０２６年１０月２日', ''),
                  BOJ_BODY.replace('日 本 銀 行', '別の機関'),
                  BOJ_BODY.replace(BOJ_TITLE, '別の文書'))
        for body in bodies:
            with self.subTest(body=body[:40]), patch.object(sources, '_pdf_text', return_value=body):
                self.assertIsNone(self.extract(b'%PDF-test'))

    def test_html_body_and_heading_and_dateline_must_agree(self):
        item = self.item(url=BOJ_HTML_URL)
        result = self.extract(boj_html(), item)
        self.assertEqual(result['published_date'], '2026-10-02')
        self.assertNotIn('footer excluded', result['body'])
        for payload in (boj_html(title='別の文書'), boj_html(dateline='2026年10月1日\n日本銀行'),
                        boj_html(dateline=''), boj_html(body='全文はPDFをご覧ください。'),
                        boj_html().replace(b'txt-right', b'other')):
            with self.subTest(length=len(payload)):
                self.assertIsNone(self.extract(payload, item))

    def test_html_link_directory_does_not_count_as_verified_policy_body(self):
        links = ''.join(f'<li><a href="k261002{i}.pdf">金融政策決定の関連参考資料・全文はこちら {i}</a></li>'
                        for i in range(12))
        payload = (f'<html><main id="contents"><h1>{BOJ_TITLE}</h1><div class="outline mod_outer">'
                   '<p class="txt-right">2026年10月2日 日本銀行</p>'
                   f'<ul class="link-list01">{links}</ul></div></main></html>').encode()
        self.assertIsNone(self.extract(payload, self.item(url=BOJ_HTML_URL)))

    def test_well_formed_non_feed_response_is_failure_not_empty_news(self):
        for payload in (b'<html><body>Maintenance</body></html>', b'<rss/>', b'<unknown/>'):
            with self.subTest(payload=payload):
                with self.assertRaises(ValueError):
                    sources._feed_items(payload, sources.FEEDS['日本銀行'], NOW, NOW.date())
                report = {}
                with patch.object(sources, '_download', side_effect=lambda url, _: (payload,url)):
                    self.assertEqual(sources.collect_official_articles(NOW, diagnostics=report), [])
                self.assertTrue(all(row['status'] == 'feed_failed' for row in report.values()))

    def test_three_sources_collected_together_and_failures_are_distinct(self):
        documents = {sources.FEEDS['総務省統計局']: feed([rss_item(STAT_URL, '労働力調査の結果', '2026-10-02', rdf=True)], rdf=True),
                     sources.FEEDS['財務省']: feed([rss_item(MOF_URL, '財務大臣の記者会見', '2026-10-02')]),
                     sources.FEEDS['日本銀行']: feed([rss_item(BOJ_URL, BOJ_TITLE, '2026-10-02')]),
                     STAT_URL: stat_html(), MOF_URL: mof_html(), BOJ_URL: b'%PDF-test'}
        report = {}
        with patch.object(sources, '_download', side_effect=lambda url, _: (documents[url], url)), \
                patch.object(sources, '_pdf_text', return_value=BOJ_BODY):
            rows = sources.collect_official_articles(NOW, diagnostics=report)
        self.assertEqual({row['source'] for row in rows}, set(sources.FEEDS))
        self.assertTrue(all(row['status'] == 'collected' for row in report.values()))
        def failed(url, _):
            if url == sources.FEEDS['財務省']:
                raise ValueError('source_unavailable')
            if url == BOJ_URL:
                raise ValueError('pdf_unreadable_page')
            return (feed([]), url) if url == sources.FEEDS['総務省統計局'] else (documents[url], url)
        with patch.object(sources, '_download', side_effect=failed):
            self.assertEqual(sources.collect_official_articles(NOW, diagnostics=report), [])
        self.assertEqual(report['総務省統計局']['status'], 'no_matching_candidates')
        self.assertEqual(report['財務省']['status'], 'feed_failed')
        self.assertEqual(report['日本銀行']['status'], 'articles_unavailable')
        self.assertIn('pdf_unreadable_page', report['日本銀行']['errors'])

    def test_pdf_reader_reads_every_page_with_bounded_isolated_process(self):
        body = sources._pdf_text(synthetic_pdf(pages=2))
        self.assertIn('page 1', body)
        self.assertIn('page 2', body)

    def test_partial_completion_is_not_reported_as_complete_success(self):
        second_url = BOJ_HTML_URL.replace('a.htm', 'b.htm')
        documents = {url: feed([]) for url in sources.FEEDS.values()}
        documents[sources.FEEDS['日本銀行']] = feed([
            rss_item(url, BOJ_TITLE, '2026-10-02') for url in (BOJ_HTML_URL, second_url)])
        documents.update({BOJ_HTML_URL: boj_html(), second_url: boj_html()})
        def partial(items, function, deadline):
            values = list(items)
            if values and isinstance(values[0], dict):
                values = values[:1]  # Another article did not finish by the deadline.
            return [function(item) for item in values]
        report = {}
        with patch.object(sources, '_parallel', side_effect=partial), \
                patch.object(sources, '_download', side_effect=lambda url, _: (documents[url], url)):
            records = sources.collect_official_articles(NOW, diagnostics=report)
        self.assertEqual(len(records), 1)
        self.assertEqual(report['日本銀行']['status'], 'collected_partial')
        self.assertEqual(report['日本銀行']['selected'], 2)
        self.assertEqual(report['日本銀行']['completed'], 1)

    def test_pdf_reader_rejects_partial_blank_encrypted_and_oversize_documents(self):
        cases = ((synthetic_pdf(pages=2, blank_last=True), 'pdf_unreadable_page'),
                 (synthetic_pdf(encrypted=True), 'pdf_encrypted'),
                 (synthetic_pdf(pages=sources.MAX_PDF_PAGES + 1), 'pdf_page_limit'),
                 (b'%PDF-invalid', 'pdf_parse_failed'),
                 (b'not a pdf', 'pdf_invalid'),
                 (b'%PDF-' + b'x' * sources.MAX_BYTES, 'pdf_invalid'))
        for payload, expected in cases:
            with self.subTest(expected=expected), self.assertRaisesRegex(ValueError, expected):
                sources._pdf_text(payload)

    def test_pdf_timeout_cannot_return_partial_evidence(self):
        with patch.object(sources.subprocess, 'run', side_effect=subprocess.TimeoutExpired('pdf', 8)) as run:
            with self.assertRaisesRegex(ValueError, 'pdf_time_limit'):
                sources._pdf_text(b'%PDF-test')
        self.assertEqual(run.call_args.kwargs['env'], {})
        self.assertIn('-I', run.call_args.args[0])


class ProductionCollectionTests(unittest.TestCase):
    def fixtures(self):
        return {sources.FEEDS['総務省統計局']: feed([rss_item(STAT_URL, '労働力調査の結果', '2026-10-02', rdf=True)], rdf=True),
                sources.FEEDS['財務省']: feed([rss_item(MOF_URL, '財務大臣の記者会見', 'Fri, 02 Oct 2026 19:30:00 +0900')]),
                STAT_URL: stat_html(), MOF_URL: mof_html()}

    def test_explicit_two_sources_never_fetch_boj_and_keep_day_precision(self):
        documents = self.fixtures()
        report = {}
        with patch.object(sources, '_download', side_effect=lambda url, _: (documents[url], url)) as download:
            rows = sources.collect_official_articles(NOW, enabled_sources=('総務省統計局', '財務省'),
                        since=datetime(2026, 10, 1, tzinfo=sources.JST).timestamp(),
                        until=NOW.timestamp(), diagnostics=report, clock=lambda: NOW.timestamp())
        self.assertEqual(len(rows), 2)
        self.assertEqual(set(report), {'総務省統計局', '財務省'})
        self.assertTrue(all('boj.or.jp' not in call.args[0] for call in download.call_args_list))
        self.assertIn('日本銀行', sources.FEEDS)
        self.assertIsNone(next(row for row in rows if row['source'] == '総務省統計局')['published_at'])

    def test_verification_clock_is_recorded_after_extraction_not_after_download(self):
        documents = self.fixtures()
        finished = [False]
        extract = sources._extract_article
        def delayed_extract(*args, **kwargs):
            result = extract(*args, **kwargs)
            finished[0] = True
            return result
        def clock():
            return NOW.timestamp() + (2 if finished[0] else 0)
        with patch.object(sources, '_download', side_effect=lambda url, _: (documents[url], url)), \
                patch.object(sources, '_extract_article', side_effect=delayed_extract):
            rows = sources.collect_official_articles(NOW, enabled_sources=('財務省',), clock=clock)
        self.assertEqual(rows[0]['observed_at'], NOW.timestamp())
        self.assertEqual(rows[0]['body_verified_at'], NOW.timestamp() + 2)

    def test_until_excludes_later_publications_but_does_not_invent_future_now(self):
        documents = self.fixtures()
        with patch.object(sources, '_download', side_effect=lambda url, _: (documents[url], url)):
            rows = sources.collect_official_articles(NOW, enabled_sources=('財務省',),
                        until=NOW.timestamp() - 1801, clock=lambda: NOW.timestamp())
            self.assertEqual(rows, [])
            rows = sources.collect_official_articles(NOW.timestamp() - 1801, enabled_sources=('財務省',),
                        until=NOW.timestamp() + 86400, clock=lambda: NOW.timestamp())
            self.assertEqual(rows, [])

    def test_invalid_selection_rejected_before_network_and_zero_clock_not_accepted(self):
        for selection in ([], '財務省', ['財務省', '財務省'], ['unapproved']):
            with self.subTest(selection=selection), patch.object(sources, '_download') as download:
                with self.assertRaises(ValueError):
                    sources.collect_official_articles(NOW, enabled_sources=selection)
                download.assert_not_called()
        documents, report = self.fixtures(), {}
        with patch.object(sources, '_download', side_effect=lambda url, _: (documents[url], url)):
            rows = sources.collect_official_articles(NOW, enabled_sources=('財務省',), clock=lambda: 0, diagnostics=report)
        self.assertEqual(rows, [])
        self.assertIn('invalid_verification_clock', report['財務省']['errors'])


if __name__ == '__main__':
    unittest.main()

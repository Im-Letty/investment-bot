import io
import json
import socket
import threading
import time
import unittest
from datetime import datetime, timezone
from unittest.mock import Mock, patch

import daily_news_sources as sources

NOW = datetime.fromisoformat("2026-09-24T08:00:00+09:00")
PUBLISHED = "2026-09-24T07:00:00+09:00"
NHK = "https://news.web.nhk/newsweb/na/nd-test"
REUTERS = "https://www.reuters.com/business/japan-economy-2026-09-24/"
BODY = "会社は新しい工場を日本に建てる計画を発表しました。製品を作る力を増やすためです。工場では地域の人を雇う予定です。" * 5


def html(*, url=NHK, title="会社が国内の工場を増やす計画", published=PUBLISHED, body=BODY, fields=None, extra=""):
    obj = {"@type": "NewsArticle", "headline": title, "url": url, "articleBody": body}
    if published is not None:
        obj["datePublished"] = published
    obj.update(fields or {})
    return ("<html><head><script type='application/ld+json'>" + json.dumps(obj, ensure_ascii=False)
            + "</script></head><body>" + extra + "</body></html>").encode()


def extract(payload, original=NHK, final=None):
    return sources._extract_article(payload, original, final or original, NOW)


def response(body=b"<html></html>", status=200, headers=None):
    r = Mock()
    r.status_code = status
    r.headers = {"Content-Type": "text/html", **(headers or {})}
    r.__enter__ = Mock(return_value=r)
    r.__exit__ = Mock(return_value=False)
    stream = io.BytesIO(body)
    r.raw.read1.side_effect = lambda amt, decode_content=True: stream.read1(amt)
    return r


class ArticleEvidenceTests(unittest.TestCase):
    def test_jsonld_article_original_timestamp_body_and_hash(self):
        result = extract(html())
        self.assertEqual(result["source"], "NHK経済")
        self.assertEqual(result["url"], NHK)
        self.assertEqual(result["body"], BODY)
        self.assertEqual(result["published_at"], datetime.fromisoformat(PUBLISHED).timestamp())
        self.assertEqual(len(result["body_sha256"]), 64)
        self.assertEqual(result["publication_evidence"], "datePublished")
        tagged = extract(html(fields={"headline": {"@value": "日本の経済", "@language": "ja"}}))
        self.assertEqual(tagged["title"], "日本の経済")

    def test_modified_only_naive_invalid_past_and_future_dates_are_rejected(self):
        for published in (None, "2026-09-24", "2026-09-24T07:00:00", "2026-02-30T07:00:00+09:00",
                          "2026-09-23T23:59:59+09:00", "2026-09-24T08:00:01+09:00"):
            with self.subTest(published=published):
                self.assertIsNone(extract(html(published=published, fields={"dateModified": PUBLISHED})))

    def test_utc_date_is_converted_to_jst_and_conflicting_publications_fail(self):
        self.assertIsNotNone(extract(html(published="2026-09-23T22:00:00Z")))
        self.assertIsNone(extract(html(extra='<meta property="article:published_time" content="2026-09-24T07:30:00+09:00">')))

    def test_headlines_description_and_related_article_text_do_not_become_body(self):
        for body in ("", "Headline", "a" * 199):
            with self.subTest(body=body[:10]):
                extra = "<p>" + BODY + "</p><aside><article><p>" + BODY + "</p></article></aside>"
                self.assertIsNone(extract(html(body=body, fields={"description": BODY}, extra=extra)))

    def test_metadata_plus_actual_article_paragraphs_omit_navigation_and_related(self):
        page = f'''<meta property="og:title" content="会社が工場を増やす計画">
        <meta property="article:published_time" content="{PUBLISHED}">
        <p>外側の広告</p><article><p>{BODY}</p><aside><p>関連記事</p></aside>
        <div class="related-content"><p>おすすめ情報</p></div><nav><p>案内</p></nav></article>'''.encode()
        result = extract(page)
        self.assertEqual(result["body"], BODY)
        self.assertEqual(result["publication_evidence"], "publication_meta")

    def test_foreign_article_identity_and_paywall_cannot_fall_back_to_meta(self):
        self.assertIsNone(extract(html(url="https://news.web.nhk/newsweb/na/another")))
        extra = f'<meta property="article:published_time" content="{PUBLISHED}"><meta property="og:title" content="title"><article><p>{BODY}</p></article>'
        self.assertIsNone(extract(html(fields={"isAccessibleForFree": False}, extra=extra)))

    def test_distribution_requires_attribution_in_article_not_page_footer(self):
        url = "https://www.newsweekjapan.jp/articles/-/334898"
        self.assertIsNone(extract(html(url=url, extra="<footer>Reuters</footer>"), url))
        self.assertIsNone(extract(html(url=url, body="写真の提供 (Reuters)。" + BODY), url))
        for fields, body in (({"author": {"name": "Reuters"}}, BODY),
                             ({}, "［東京 ２４日 ロイター］ - " + BODY),
                             ({}, "[東京 ２４日 ロイター] - " + BODY),
                             ({}, "TOKYO (Reuters) - " + BODY)):
            with self.subTest(fields=fields):
                self.assertEqual(extract(html(url=url, fields=fields, body=body), url)["source"], "ロイター経済")

    def test_original_url_retained_after_allowed_redirect_and_publisher_change_rejected(self):
        original = "https://www.nhk.or.jp/news/html/20260924/test.html"
        record = extract(html(), original, NHK)
        self.assertEqual(record["url"], original)
        self.assertEqual(record["evidence_url"], NHK)
        self.assertIsNone(extract(html(url=REUTERS), original, REUTERS))

    def test_jsonld_graph_lists_multiple_articles_and_html_article_body(self):
        first = json.loads(html().decode().split("application/ld+json'>")[1].split("</script>")[0])
        nested = f'<script type="application/ld+json">{json.dumps({"@graph": [first]})}</script>'.encode()
        self.assertIsNotNone(extract(nested))
        first.pop("url")
        second = {**first, "headline": "別の記事"}
        self.assertIsNone(extract(f'<script type="application/ld+json">{json.dumps([first, second])}</script>'.encode()))
        self.assertEqual(extract(html(body=f"<p>{BODY}</p>"))["body"], BODY)


class SafeTransportTests(unittest.TestCase):
    def test_url_allowlist_blocks_userinfo_ports_localhost_and_deceptive_domains(self):
        for url in ("http://www.reuters.com/business/test", "https://www.reuters.com.evil.test/a",
                    "https://evilreuters.com/a", "https://www.reuters.com@127.0.0.1/a", "https://127.0.0.1/a",
                    "https://localhost/a", "https://www.reuters.com:444/a", "https://www.reuters.com\\@evil.test/a",
                    "https://www.reuters.com/a\nb", "https://www.newsweekjapan.jp/stories/test"):
            with self.subTest(url=url):
                self.assertIsNone(sources._safe_url(url))
        for url in (NHK, REUTERS, "https://sa.marketscreener.com/news/test", "https://live.euronext.com/en/news/test",
                    "https://www.newsweekjapan.jp/headlines/business/test.php", "https://www.newsweekjapan.jp/articles/-/334898"):
            self.assertEqual(sources._safe_url(url), url)

    def test_dns_rejects_private_mixed_and_ipv6_linklocal_answers(self):
        for addresses in (("127.0.0.1",), ("8.8.8.8", "10.0.0.1"), ("169.254.169.254",), ("::1",), ("fe80::1",), ("224.0.0.1",)):
            with self.subTest(addresses=addresses), patch.object(sources.socket, "getaddrinfo", return_value=[(0, 0, 0, "", (ip, 443)) for ip in addresses]):
                with self.assertRaises(ValueError):
                    sources._public_ip("www.reuters.com")

    def test_pinned_adapter_keeps_tls_hostname_at_checked_address(self):
        with patch.object(sources, "HTTPSConnectionPool") as pool:
            adapter = sources._PinnedHTTPSAdapter("www.reuters.com", "8.8.8.8")
            self.assertEqual(pool.call_args.args, ("8.8.8.8",))
            self.assertEqual(pool.call_args.kwargs["assert_hostname"], "www.reuters.com")
            self.assertEqual(pool.call_args.kwargs["server_hostname"], "www.reuters.com")
            self.assertEqual(pool.call_args.kwargs["cert_reqs"], "CERT_REQUIRED")
            self.assertIs(adapter.get_connection_with_tls_context(None, True), pool.return_value)
            adapter.close()

    def download(self, replies):
        session = Mock()
        session.__enter__ = Mock(return_value=session)
        session.__exit__ = Mock(return_value=False)
        session.get.side_effect = replies
        with patch.object(sources.requests, "Session", return_value=session), patch.object(sources, "_public_ip", return_value="8.8.8.8") as dns:
            result = sources._download(REUTERS, time.monotonic() + 30)
        return result, session, dns

    def test_fetch_uses_bounded_stream_no_proxy_no_auto_redirect_and_each_hop_checked(self):
        final = "https://jp.reuters.com/markets/test-2026-09-24/"
        (body, url), session, dns = self.download([response(status=302, headers={"Location": final}), response(b"ok")])
        self.assertEqual((body, url), (b"ok", final))
        self.assertFalse(session.trust_env)
        self.assertEqual([call.args[0] for call in dns.call_args_list], ["www.reuters.com", "jp.reuters.com"])
        for call in session.get.call_args_list:
            self.assertFalse(call.kwargs["allow_redirects"])
            self.assertTrue(call.kwargs["verify"])
            self.assertTrue(call.kwargs["stream"])
            self.assertEqual(call.kwargs["timeout"], (3, 4))

    def test_disallowed_redirect_oversize_bad_type_status_and_redirect_loop_fail(self):
        replies = ([response(status=302, headers={"Location": "http://169.254.169.254/latest/"})],
                   [response(headers={"Content-Length": str(sources.MAX_BYTES + 1)})],
                   [response(b"x" * (sources.MAX_BYTES + 1))],
                   [response(headers={"Content-Type": "application/json"})],
                   [response(status=403)], [response(status=302, headers={"Location": REUTERS})])
        for batch in replies:
            with self.subTest(batch=batch), self.assertRaises(ValueError):
                self.download(batch)

    def test_distinct_redirect_hops_and_elapsed_read_budget_are_bounded(self):
        redirects = [response(status=302, headers={"Location": REUTERS + str(i)})
                     for i in range(sources.MAX_REDIRECTS + 1)]
        with self.assertRaises(ValueError):
            self.download(redirects)
        with patch.object(sources.time, "monotonic", side_effect=[0, 0, 0, 0, 13]):
            with self.assertRaises(ValueError):
                self.download([response(b"too late")])


class CollectionTests(unittest.TestCase):
    def test_rss_discovery_is_today_only_and_never_substitutes_updated(self):
        feed = f'''<rss><channel><item><link>{NHK}</link><pubDate>Wed, 23 Sep 2026 22:00:00 GMT</pubDate></item>
        <item><link>https://news.web.nhk/newsweb/na/old</link><pubDate>Tue, 22 Sep 2026 22:00:00 GMT</pubDate></item>
        <item><link>https://news.web.nhk/newsweb/na/modified</link><updated>{PUBLISHED}</updated></item></channel></rss>'''.encode()
        with patch.object(sources, "_download", return_value=(feed, sources.NHK_FEED)):
            self.assertEqual(sources._discover(sources.NHK_FEED, NOW, time.monotonic() + 10), [NHK])

    def test_reuters_index_extracts_allowed_article_links_not_navigation_or_external(self):
        page = f'<a href="{REUTERS}">Title</a><a href="/business/">Menu</a><a href="https://evil.test/business/test-2026-09-24/">Outside</a>'.encode()
        with patch.object(sources, "_download", return_value=(page, sources.REUTERS_PAGES[0])):
            self.assertEqual(sources._discover(sources.REUTERS_PAGES[0], NOW, time.monotonic() + 10), [REUTERS])

    def test_supplied_urls_skip_seed_discovery_and_deduplicate_articles(self):
        def download(url, deadline):
            return html(url=url), url
        with patch.object(sources, "_download", side_effect=download) as fetch:
            records = sources.collect_articles(NOW.timestamp(), [NHK, NHK, REUTERS, "https://evil.test/"])
        self.assertEqual(len(records), 1)
        self.assertEqual(fetch.call_count, 2)
        self.assertTrue(all(call.args[0] not in (sources.NHK_FEED, *sources.REUTERS_PAGES) for call in fetch.call_args_list))

    def test_newsweek_full_article_request_retains_original_url(self):
        url = "https://www.newsweekjapan.jp/articles/-/334898"
        full = url + "?display=b"
        with patch.object(sources, "_download", return_value=(html(url=url, body="[東京 ２４日 ロイター] - " + BODY), full)) as fetch:
            records = sources.collect_articles(NOW, [url])
        self.assertEqual(fetch.call_args.args[0], full)
        self.assertEqual(records[0]["url"], url)
        self.assertEqual(records[0]["evidence_url"], full)

    def test_outage_and_headline_only_discovery_return_empty_without_generation(self):
        with patch.object(sources, "_download", side_effect=OSError("outage")):
            self.assertEqual(sources.collect_articles(NOW), [])
        with patch.object(sources, "_download", return_value=(html(body=""), NHK)):
            self.assertEqual(sources.collect_articles(NOW, [NHK]), [])

    def test_collection_bounds_candidates_results_and_concurrency(self):
        lock, active, peak = threading.Lock(), [0], [0]
        def download(url, deadline):
            with lock:
                active[0] += 1
                peak[0] = max(peak[0], active[0])
            try:
                time.sleep(.002)
                return html(url=url, title="会社" + url, body=BODY + url), url
            finally:
                with lock:
                    active[0] -= 1
        urls = [NHK + str(i) for i in range(50)]
        with patch.object(sources, "_download", side_effect=download) as fetch:
            result = sources.collect_articles(NOW, urls)
        self.assertEqual(fetch.call_count, sources.MAX_CANDIDATES)
        self.assertEqual(len(result), sources.MAX_ARTICLES)
        self.assertLessEqual(peak[0], sources.MAX_WORKERS)

    def test_invalid_now_is_not_silently_replaced_with_current_time(self):
        for now in (datetime(2026, 9, 24), None, True, float("nan")):
            with self.subTest(now=now), self.assertRaises(ValueError):
                sources.collect_articles(now)


if __name__ == "__main__":
    unittest.main()

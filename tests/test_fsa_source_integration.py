"""Offline checks of new FSA collection, immutable legacy caches and AI gates."""
from copy import deepcopy
from datetime import date, datetime, timedelta
from hashlib import sha256
from unittest import TestCase
from unittest.mock import Mock, patch

import official_news_sources as sources
import official_news_cache as cache
import daily_news_producer as producer
from news_cache import OFFICIAL_NEWS_SOURCES
from morning_news_window import healthy_empty_manifest, morning_window
from tests.test_official_fsa_source import fixture, item, NOW, DAY, URL
from tests.test_official_news_sources import feed, rss_item
from tests.test_official_news_cache import Storage, article


def record():
    row = sources._extract_article(fixture().encode(), item(), URL, NOW, date(2026, 10, 13),
                                   observed_at=NOW.timestamp())
    row["body_verified_at"] = NOW.timestamp()
    return row


def statuses(names=OFFICIAL_NEWS_SOURCES):
    return {source: {"feed_status": "ok", "status": "no_matching_candidates",
                     "errors": [], "candidates": 0, "selected": 0,
                     "completed": 0, "accepted": 0, "returned": 0} for source in names}


class FsaPipelineTest(TestCase):
    def test_four_fixed_sources_without_licensed_commercial_rss_change(self):
        self.assertEqual(OFFICIAL_NEWS_SOURCES, ("総務省統計局", "財務省", "日本銀行", "金融庁"))
        self.assertEqual(sources.FEEDS["金融庁"], "https://www.fsa.go.jp/fsaNewsListAll_rss2.xml")
        self.assertEqual(producer.OFFICIAL_SOURCES["金融庁"], "www.fsa.go.jp")

    def test_fixed_safe_urls_exclude_foreign_pdf_general_pages_and_ports(self):
        self.assertEqual(sources._safe_url(URL), URL)
        self.assertEqual(sources._safe_url(sources.FEEDS["金融庁"]), sources.FEEDS["金融庁"])
        for value in (URL.replace("www.fsa.go.jp", "evil.example"), URL + "?x=1",
                      URL.replace("https:", "http:"), "https://www.fsa.go.jp/ordinary/index.html",
                      URL.replace("20261013.html", "01.pdf"),
                      URL.replace("www.fsa.go.jp", "www.fsa.go.jp:444")):
            self.assertIsNone(sources._safe_url(value))

    def test_fsa_rss_jst_date_only_with_original_title_kept_for_correspondence(self):
        payload = feed([rss_item(URL, item()["title"], "Tue, 13 Oct 2026 17:00:00 JST")])
        values = sources._feed_items(payload, sources.FEEDS["金融庁"], NOW, date(2026, 10, 13))
        self.assertEqual(len(values), 1)
        self.assertIsNone(values[0]["published_at"])
        self.assertEqual(values[0]["title"], item()["title"])
        self.assertEqual(values[0]["publication_precision"], "day")
        self.assertEqual(values[0]["published_date"], DAY)
        self.assertEqual(sources._feed_items(payload, sources.FEEDS["金融庁"], NOW,
                                             datetime(2026, 10, 13, 8, tzinfo=sources.JST)), [])

    def test_rss_correction_updates_wrong_host_and_bad_date_fail_closed(self):
        for title, url, day in (
                (item()["title"].replace("公表しました", "更新しました"), URL, "Tue, 13 Oct 2026 17:00:00 JST"),
                ("金融制度の訂正について", URL, "Tue, 13 Oct 2026 17:00:00 JST"),
                (item()["title"], URL.replace("www.fsa.go.jp", "www.mof.go.jp"), "Tue, 13 Oct 2026 17:00:00 JST"),
                (item()["title"], URL, "Wed, 13 Oct 2026 17:00:00 JST")):
            payload = feed([rss_item(url, title, day)])
            self.assertEqual(sources._feed_items(payload, sources.FEEDS["金融庁"], NOW, date(2026, 10, 13)), [])

    def test_collection_tracks_actual_clock_and_capped_single_fsa_source(self):
        payload = feed([rss_item(URL, item()["title"], "Tue, 13 Oct 2026 17:00:00 JST")])
        downloads = {sources.FEEDS["金融庁"]: payload, URL: fixture().encode()}
        def download(url, deadline, **kwargs):
            return downloads[url], url
        diagnostics = {}
        with patch.object(sources, "_download", side_effect=download) as fetch:
            values = sources.collect_official_articles(NOW, since=date(2026, 10, 13),
                enabled_sources=["金融庁"], clock=lambda: NOW.timestamp(), diagnostics=diagnostics)
        self.assertEqual(fetch.call_count, 2)
        self.assertEqual(len(values), 1)
        self.assertEqual(values[0]["body_verified_at"], NOW.timestamp())
        self.assertEqual(values[0]["observed_at"], NOW.timestamp())
        self.assertEqual(values[0]["source_scope"], "fsa_official_html_v1")
        self.assertEqual(values[0]["source_adapter_scope"], "official_fsa_release_html")
        self.assertFalse(values[0]["attachments_verified"])
        self.assertEqual(diagnostics["金融庁"]["status"], "collected")

    def test_failed_fsa_feed_is_a_failure_and_no_new_article(self):
        with patch.object(sources, "_download", side_effect=ValueError("source_unavailable")):
            diagnostics = {}
            self.assertEqual(sources.collect_official_articles(NOW, enabled_sources=["金融庁"],
                                                               diagnostics=diagnostics), [])
        self.assertEqual(diagnostics["金融庁"]["feed_status"], "failed")
        self.assertEqual(diagnostics["金融庁"]["errors"], ["source_unavailable"])

    def test_fsa_private_provenance_and_date_guard_rejects_spoofed_scopes(self):
        row = record()
        self.assertTrue(sources.valid_fsa_record(row))
        for changes in ({"source_scope": "official_html"}, {"source_adapter_scope": "unknown"},
                        {"attachments_verified": True}, {"publication_evidence": "rss_only"},
                        {"published_at": NOW.timestamp()}, {"published_date": "2026-10-09"},
                        {"evidence_url": URL.replace("hoken", "sonota")},
                        {"title": "金融制度の訂正について"}):
            self.assertFalse(sources.valid_fsa_record({**row, **changes}))

    def test_cache_preserves_new_private_scope_flags(self):
        row = record()
        copied = cache._article(row, NOW.timestamp())
        self.assertEqual(copied["source_scope"], row["source_scope"])
        self.assertEqual(copied["source_adapter_scope"], row["source_adapter_scope"])
        self.assertIs(copied["attachments_verified"], False)
        self.assertEqual(copied["body_sha256"], row["body_sha256"])
        with self.assertRaisesRegex(ValueError, "invalid_source_cache_article"):
            cache._article({**row, "attachments_verified": True}, NOW.timestamp())

    def test_exact_legacy_three_is_read_but_fsa_unknown_not_healthy(self):
        storage = Storage()
        diagnostics = statuses()
        def collector(*args, **kwargs):
            kwargs["diagnostics"].update(diagnostics)
            return []
        clock = lambda: NOW.timestamp()
        current = cache.OfficialNewsCache(storage, collector, clock=clock)
        current.collect(NOW.timestamp())
        key = next(key for key in storage.values if "/polls/" in key and key.endswith(".json"))
        storage.values[key]["source_status"].pop("金融庁")
        before = deepcopy(storage.values[key])
        restored = cache.OfficialNewsCache(storage, Mock(), clock=clock).snapshot(NOW.timestamp())
        self.assertEqual(storage.values[key], before)
        self.assertEqual(restored["source_status"]["金融庁"]["feed_status"], "not_completed")
        self.assertEqual(restored["source_status"]["金融庁"]["status"], "fetch_incomplete")
        self.assertEqual(restored["source_cache_observations"]["legacy_three_source_polls"], 1)
        self.assertFalse(healthy_empty_manifest({"articles": [], "source_status": restored["source_status"]}))
        from intraday_news_runtime import _healthy_snapshot
        self.assertFalse(_healthy_snapshot(restored, NOW.timestamp()))

    def test_legacy_diagnostic_schemas_are_exact_not_arbitrary_subsets(self):
        full = statuses()
        self.assertIsNone(cache._stored_diagnostics(full))
        self.assertEqual(cache._stored_diagnostics(statuses(OFFICIAL_NEWS_SOURCES[:3])),
                         "legacy_three_source_polls")
        self.assertEqual(cache._stored_diagnostics(statuses(OFFICIAL_NEWS_SOURCES[:2])),
                         "legacy_two_source_polls")
        for names in (("財務省", "日本銀行"), ("総務省統計局", "財務省", "金融庁")):
            with self.assertRaisesRegex(ValueError, "invalid_source_cache_poll"):
                cache._stored_diagnostics(statuses(names))
        for update in ({"extra": "wrong"}, {"errors": ["https://private.example?secret=bad"]}):
            invalid = statuses(OFFICIAL_NEWS_SOURCES[:3])
            invalid["財務省"].update(update)
            with self.assertRaisesRegex(ValueError, "invalid_source_cache_poll"):
                cache._stored_diagnostics(invalid)

    def test_legacy_three_restores_original_body_hash_and_version_without_rewrite(self):
        storage = Storage()
        row = article(day=DAY, url="https://www.mof.go.jp/public_relations/conference/my20261013.html")
        row["body_verified_at"] = NOW.timestamp()
        def collector(*args, **kwargs):
            kwargs["diagnostics"].update(statuses())
            return [row]
        clock = lambda: NOW.timestamp()
        cache.OfficialNewsCache(storage, collector, clock=clock).collect(NOW.timestamp())
        key = next(key for key in storage.values if "/polls/" in key and key.endswith(".json"))
        storage.values[key]["source_status"].pop("金融庁")
        before = deepcopy(storage.values)
        restored = cache.OfficialNewsCache(storage, Mock(), clock=clock).snapshot(NOW.timestamp())
        self.assertEqual(restored["articles"][0]["body"], row["body"])
        self.assertEqual(restored["articles"][0]["body_sha256"], row["body_sha256"])
        self.assertEqual(storage.values, before, "No immutable poll/body/version/identity rewrite")
        self.assertEqual(restored["source_cache_observations"]["legacy_three_source_polls"], 1)

    def test_old_three_empty_manifest_is_not_four_source_healthy(self):
        self.assertFalse(healthy_empty_manifest({"articles": [], "source_status": statuses(OFFICIAL_NEWS_SOURCES[:3])}))
        self.assertTrue(healthy_empty_manifest({"articles": [], "source_status": statuses()}))

    def test_producer_admits_only_date_verified_fsa_scope_without_paid_calls(self):
        row = record()
        window = {"version": 2, "kind": "intraday", "edition_date": DAY,
                  "window_start": datetime(2026, 10, 13, 7, 30, tzinfo=sources.JST).timestamp(),
                  "cutoff_at": NOW.timestamp()}
        cleaned = producer._official_articles([row], window, NOW.timestamp())
        self.assertEqual(cleaned[0]["source"], "金融庁")
        self.assertIsNone(cleaned[0]["published_at"])
        for changes in ({"source_scope": "wrong"}, {"source_adapter_scope": "unknown"},
                        {"attachments_verified": True},
                        {"url": URL.replace("www.fsa.go.jp", "www.mof.go.jp")}):
            with self.assertRaisesRegex(producer.GenerationError, "invalid_official_article"):
                producer._official_articles([{**row, **changes}], window, NOW.timestamp())

    def test_public_reviewed_digest_keeps_fsa_day_and_rejects_wrong_path_and_guessed_time(self):
        from news_cache import _validated_digest
        from tests.test_official_news_publication import edition
        value = edition("day")
        url = "https://www.fsa.go.jp/news/r8/hoken/20261005/20261005.html"
        for ref in value["article_refs"] + value["article_summaries"]:
            ref.update(source="金融庁", title="金融制度の運用について", url=url)
        self.assertEqual(_validated_digest(value), value)
        for changed_url in (url.replace("www.fsa.go.jp", "www.mof.go.jp"),
                            "https://www.fsa.go.jp/ordinary/index.html",
                            url.replace("20261005.html", "01.pdf"), url + "?x=1",
                            url.replace("20261005", "20261004")):
            invalid = deepcopy(value)
            for ref in invalid["article_refs"] + invalid["article_summaries"]:
                ref["url"] = changed_url
            self.assertIsNone(_validated_digest(invalid))
        for changed in ({"title": "金融制度の訂正について"},
                        {"publication_precision": "second", "published_at": value["source_window"]["window_start"] + 3600}):
            invalid = deepcopy(value)
            for ref in invalid["article_refs"] + invalid["article_summaries"]:
                ref.update(changed)
            self.assertIsNone(_validated_digest(invalid))


"""
Legacy source bodies and review hashes remain immutable. Only their diagnostics
schema is accepted on read, with newly introduced source status explicitly
unavailable. The tests never run the paid generator, a workflow or real GET.
"""

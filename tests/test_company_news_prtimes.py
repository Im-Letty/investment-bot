"""Fictional text in the inspected PR TIMES layout; no real release archive."""
from datetime import datetime, timedelta
from hashlib import sha256
from html import escape
import json
import unittest

import company_news_prtimes as sources

NOW = datetime(2026, 10, 8, 18, tzinfo=sources.JST)
SINCE = NOW - timedelta(hours=72)
URL = "https://prtimes.jp/main/html/rd/p/000000082.000152541.html"
ISSUER = "株式会社 架空テスト工業"
TITLE = "架空テスト工業、研究用設備の開発を開始"
PUBLISHED = "2026-10-08T11:00:02+09:00"
LOCAL = "2026-10-08 11:00:02"
BODY = ("株式会社 架空テスト工業は、解析処理の確認用に架空の設備を開発しました。"
        "この文章はテスト用に作成したもので、実際の会社の発表や事業を表していません。"
        "利用する人の作業を助ける架空の仕組みについて、性能と使える条件を調べます。"
        "実験は10月13日の予定です。発表日と実験予定日を区別するための文章です。")


class Catalogue:
    def __init__(self, *, business=None):
        self.members = {"1234.T": {"symbol": "1234.T", "name": "架空テスト工業", "business": business,
                                  "business_sources": [{"title": "架空公式事業", "url": "https://example.com/business/"}] if business else []}}
        self.provenance = {"as_of": "2026-10-08", "source_sha256": "b" * 64}
        self.facts_sha256 = "a" * 64

    def match_issuer(self, raw):
        # Deliberately exact: a title, substring, partner or subsidiary cannot
        # identify the listed company. The real catalogue owns normalization.
        return self.members["1234.T"] if raw == ISSUER else None


def feed_item(*, title=TITLE, issuer=ISSUER, url=URL, precise=PUBLISHED, day="2026-10-08", extra=""):
    dates = ((f"<dc:date>{escape(precise)}</dc:date>" if precise is not None else "")
             + (f"<date>{escape(day)}</date>" if day is not None else ""))
    return (f"<item><title>{escape(title)}</title><link>{escape(url)}</link>"
            f"<dc:corp>{escape(issuer)}</dc:corp>{dates}{extra}</item>")


def feed(*items):
    return ('<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns="http://purl.org/rss/1.0/">'
            '<channel><dc:date>2099-01-01</dc:date></channel>'
            + "".join(items or [feed_item()]) + "</rdf:RDF>").encode()


def article(*, title=TITLE, author=ISSUER, company_id="152541", company_label=ISSUER,
            published=LOCAL, visible=LOCAL, modified="2099-01-01 11:00:00", body=BODY,
            metadata=True, extra_metadata=None, header_extra="", footer="", body_id="press-release-body"):
    obj = {"@type": "NewsArticle", "headline": title, "datePublished": published,
           "dateModified": modified, "author": {"@type": "Organization", "name": author},
           "publisher": {"@type": "Organization", "name": "PR TIMES"}}
    scripts = ('<script type="application/ld+json">' + json.dumps([obj, {"@type": "BreadcrumbList"}] +
               ([extra_metadata] if extra_metadata else []), ensure_ascii=False) + "</script>") if metadata else ""
    return ("<html><head>" + scripts + "</head><body><nav>navigation</nav>"
            '<article id="js-heatmap-subject-area">'
            f'<h1 id="press-release-title">{escape(title)}</h1>'
            f'<a href="/main/html/searchrlp/company_id/{company_id}">{escape(company_label)}</a>'
            f'<time datetime="{escape(visible or "")}">2026年10月8日</time>{header_extra}'
            f'<div id="{body_id}"><p>{escape(body)}</p></div></article>'
            '<section>おすすめ記事</section><footer>' + footer + "</footer></body></html>").encode()


class PRTimesTests(unittest.TestCase):
    def setUp(self):
        self.catalogue = Catalogue()

    def item(self, **kwargs):
        return sources.parse_feed(feed(feed_item(**kwargs)), NOW, SINCE, self.catalogue)[0]

    def extract(self, payload=None, item=None, final_url=URL, catalogue=None, **kwargs):
        return sources.extract_article(payload or article(), item or self.item(), final_url, NOW, SINCE,
                                       observed_at=NOW.timestamp(), catalogue=catalogue or self.catalogue, **kwargs)

    def test_rdf_dates_keep_precise_clock_and_namespace_evidence(self):
        item = self.item()
        self.assertEqual(item["company_id"], "152541")
        self.assertEqual(item["source"], "PR TIMES")
        self.assertEqual(item["symbol"], "1234.T")
        self.assertEqual(item["published_at"], datetime.fromisoformat(PUBLISHED).timestamp())
        self.assertEqual(item["feed_date_fields"][sources.DC_DATE], PUBLISHED)
        self.assertEqual(item["feed_date_fields"][sources.RSS_DATE], "2026-10-08")

    def test_only_exact_announcing_issuer_is_a_constituent(self):
        for issuer in ("別の会社株式会社", "株式会社 架空テスト工業の取引先", "架空テスト工業の子会社株式会社"):
            with self.subTest(issuer=issuer):
                self.assertEqual(sources.parse_feed(feed(feed_item(issuer=issuer)), NOW, SINCE, self.catalogue), [])

    def test_missing_duplicate_and_conflicting_dates_do_not_fill_candidates(self):
        for kwargs in ({"precise": None, "day": None}, {"precise": None}, {"day": None}, {"day": "2026-10-07"},
                       {"extra": "<dc:date>2026-10-08T12:00:00+09:00</dc:date>"},
                       {"extra": "<date>2026-10-08</date>"}):
            with self.subTest(kwargs=kwargs):
                self.assertEqual(sources.parse_feed(feed(feed_item(**kwargs)), NOW, SINCE, self.catalogue), [])

    def test_original_window_rejects_old_future_and_ambiguous_day(self):
        for precise, day in (("2026-10-05T17:59:59+09:00", "2026-10-05"),
                             ("2026-10-08T18:00:01+09:00", "2026-10-08"),
                             (None, "2026-10-05")):
            self.assertEqual(sources.parse_feed(feed(feed_item(precise=precise, day=day)), NOW, SINCE, self.catalogue), [])
        self.assertEqual(len(sources.parse_feed(feed(feed_item(precise="2026-10-05T18:00:00+09:00", day="2026-10-05")), NOW, SINCE, self.catalogue)), 1)

    def test_date_only_does_not_become_midnight_or_an_html_clock(self):
        item = self.item(precise="2026-10-08")
        result = self.extract(item=item)
        self.assertIsNone(item["published_at"])
        self.assertIsNone(result["published_at"])
        self.assertEqual(result["publication_precision"], "day")

    def test_feed_is_bounded_and_duplicate_conflicts_are_rejected(self):
        self.assertEqual(len(sources.parse_feed(feed(feed_item(), feed_item()), NOW, SINCE, self.catalogue)), 1)
        self.assertEqual(sources.parse_feed(feed(feed_item(), feed_item(title="架空テスト工業、別の設備を開発")), NOW, SINCE, self.catalogue), [])
        items = [feed_item(issuer="別の会社株式会社")] * 200 + [feed_item()]
        self.assertEqual(sources.parse_feed(feed(*items), NOW, SINCE, self.catalogue), [])

    def test_important_editorial_categories_and_routine_exclusions(self):
        for title in ("架空テスト工業、役員人事を発表", "架空テスト工業、新製品のキャンペーンを開始",
                      "架空テスト工業、研究セミナーを開催", "架空テスト工業、サイトを更新"):
            self.assertEqual(sources.parse_feed(feed(feed_item(title=title)), NOW, SINCE, self.catalogue), [])
        items = sources.parse_feed(feed(feed_item(), feed_item(title="架空テスト工業、事業買収を発表", url=URL.replace("000000082", "000000083"))), NOW, SINCE, self.catalogue)
        self.assertEqual(items[0]["category"], "business_change")

    def test_unsupported_structure_entity_and_size_are_rejected(self):
        for payload, error in ((b"<rss><channel/></rss>", "unsupported_feed_structure"),
                               (b"not xml", "unsupported_feed_structure"),
                               (b'<!DOCTYPE rdf [<!ENTITY a SYSTEM "file:///private/data">]><rdf/>', "unsupported_feed_declaration"),
                               (b"x" * (sources.MAX_BYTES + 1), "source_size_limit"),
                               (b"\xff", "unsupported_source_encoding")):
            with self.assertRaisesRegex(ValueError, error):
                sources.parse_feed(payload, NOW, SINCE, self.catalogue)

    def test_approved_url_surface_rejects_redirects_queries_and_other_hosts(self):
        self.assertEqual(sources.safe_url(URL), URL)
        self.assertEqual(sources.safe_url(sources.FEED_URL), sources.FEED_URL)
        for url in (URL + "/", URL + "?token=x", URL + "?", URL + "#fragment", URL + "#", URL.replace("https:", "http:"),
                    URL.replace("prtimes.jp", "prtimes.jp.evil.example"), URL.replace("prtimes.jp", "127.0.0.1"),
                    URL.replace("prtimes.jp", "user:secret@prtimes.jp"), URL.replace("prtimes.jp", "prtimes.jp:444"),
                    URL.replace("000000082", "82"), URL.replace("000152541", "000000000"),
                    "https://prtimes.jp/companyrdf.php?company_id=152541", "https://prtimes.jp/api/press_release.php"):
            with self.subTest(url=url):
                self.assertIsNone(sources.safe_url(url))
        self.assertIsNone(self.extract(final_url=URL.replace("000000082", "000000083")))

    def test_article_matches_feed_header_author_and_original_clock(self):
        result = self.extract()
        self.assertEqual(result["related_company"], ISSUER)
        self.assertIsNone(result["published_at"])
        self.assertEqual(result["publication_precision"], "day")
        self.assertEqual(result["body_sha256"], sha256(result["body"].encode()).hexdigest())
        self.assertEqual(result["body_verified_at"], NOW.timestamp())
        self.assertEqual(result["catalogue_as_of"], "2026-10-08")
        self.assertEqual(result["catalogue_facts_sha256"], "a" * 64)
        self.assertEqual(result["catalogue_source_sha256"], "b" * 64)
        self.assertNotIn("おすすめ", result["body"])
        self.assertNotIn("navigation", result["body"])

    def test_wrong_issuer_anchor_or_author_cannot_be_rescued_by_footer(self):
        footer = f'<a href="/main/html/searchrlp/company_id/152541">{escape(ISSUER)}</a>'
        for kwargs in ({"author": "PR TIMES"}, {"author": "別の会社株式会社"},
                       {"company_id": "999999"}, {"company_label": "別の会社株式会社"}):
            with self.subTest(kwargs=kwargs):
                self.assertIsNone(self.extract(payload=article(footer=footer, **kwargs)))

    def test_counterparty_mention_in_title_or_body_cannot_replace_issuer(self):
        item = self.item()
        item["issuer"] = "別の会社株式会社"
        self.assertIsNone(self.extract(item=item))
        self.assertIsNone(self.extract(payload=article(company_label="別の会社株式会社", body=BODY + ISSUER)))

    def test_changed_title_missing_metadata_and_ambiguous_article_are_rejected(self):
        for kwargs in ({"title": "別の発表について"}, {"metadata": False}, {"body": "短い"},
                       {"body": "架" * (sources.MAX_BODY_CHARS + 1)},
                       {"body_id": "unknown-body"}, {"extra_metadata": {"@type": "NewsArticle", "headline": TITLE}}):
            self.assertIsNone(self.extract(payload=article(**kwargs)))

    def test_changed_dates_and_clocks_are_rejected_not_downgraded(self):
        for kwargs in ({"published": "2026-10-07 11:00:02"}, {"visible": "2026-10-08 11:00:03"},
                       {"published": "2026-10-08 18:00:01"}, {"published": None}, {"visible": None}):
            self.assertIsNone(self.extract(payload=article(**kwargs)))

    def test_only_original_date_is_used_not_future_modification(self):
        self.assertIsNotNone(self.extract(payload=article(modified="2099-01-01 11:00:00")))

    def test_global_feed_discovery_clocks_do_not_replace_local_original_clocks(self):
        # Fictional regression inputs reproduce both inspected failure shapes.
        later_now = NOW + timedelta(hours=1)
        for discovery, original in (("2026-10-08T17:15:21+09:00", "2026-10-08 14:43:33"),
                                    ("2026-10-08T18:15:17+09:00", "2026-10-08 14:30:02")):
            item = sources.parse_feed(feed(feed_item(precise=discovery)), later_now, SINCE, self.catalogue)[0]
            result = sources.extract_article(article(published=original, visible=original), item, URL,
                                             later_now, SINCE, catalogue=self.catalogue)
            self.assertIsNotNone(result)
            self.assertIsNone(result["published_at"])
            self.assertEqual(result["published_date"], "2026-10-08")
            self.assertEqual(result["publication_evidence"]["feed_timestamp_role"], "discovery")
            self.assertEqual(result["publication_evidence"]["feed_reported_at"], item["published_at"])
            self.assertIsNone(result["publication_evidence"]["article_published_at"])

    def test_clock_requires_two_agreeing_explicit_timezones(self):
        explicit = "2026-10-08T14:30:02+09:00"
        result = self.extract(payload=article(published=explicit, visible=explicit))
        self.assertEqual(result["published_at"], datetime.fromisoformat(explicit).timestamp())
        self.assertEqual(result["publication_precision"], "second")
        result = self.extract(payload=article(published=explicit, visible="2026-10-08 14:30:02"))
        self.assertIsNone(result["published_at"])
        self.assertIsNone(self.extract(payload=article(published=explicit, visible="2026-10-08T14:30:03+09:00")))

    def test_future_original_clock_is_withheld_even_when_feed_is_older(self):
        for future in ("2026-10-08 18:00:01", "2026-10-08T18:00:01+09:00", "2026-10-09 01:00:00"):
            self.assertIsNone(self.extract(payload=article(published=future, visible=future)))

    def test_future_discovery_clock_remains_ineligible_at_verification(self):
        later_now = NOW + timedelta(hours=1)
        item = sources.parse_feed(feed(feed_item(precise="2026-10-08T18:15:17+09:00")),
                                  later_now, SINCE, self.catalogue)[0]
        self.assertIsNone(self.extract(item=item))

    def test_original_dates_must_agree_with_both_feed_dates(self):
        for original in ("2026-10-07 14:30:02", "2026-10-09 14:30:02"):
            self.assertIsNone(self.extract(payload=article(published=original, visible=original)))

    def test_header_identity_cannot_come_from_inside_article_body(self):
        payload = article().replace(
            f'<a href="/main/html/searchrlp/company_id/152541">{escape(ISSUER)}</a>'.encode(), b"")
        payload = payload.replace(b'<div id="press-release-body">',
                                  f'<div id="press-release-body"><a href="/main/html/searchrlp/company_id/152541">{escape(ISSUER)}</a>'.encode())
        self.assertIsNone(self.extract(payload=payload))

    def test_multiple_header_issuers_or_dates_are_ambiguous(self):
        for extra in (f'<a href="/main/html/searchrlp/company_id/999999">別の会社株式会社</a>',
                      '<time datetime="2026-10-08 11:00:02">別の日時</time>'):
            self.assertIsNone(self.extract(payload=article(header_extra=extra)))

    def test_business_requires_verified_profile_or_announcement_only_evidence(self):
        result = self.extract()
        self.assertEqual(result["business"], result["body"][:1800])
        self.assertEqual(result["business_url"], URL)
        self.assertEqual(result["business_context_mode"], "announcement_only")
        profile = Catalogue(business="これは架空テスト用に事業説明を確認した設定です。")
        result = self.extract(catalogue=profile)
        self.assertEqual(result["business"], profile.members["1234.T"]["business"])
        self.assertEqual(result["business_url"], "https://example.com/business/")
        self.assertEqual(result["business_context_mode"], "verified_profile")
        profile.members["1234.T"]["business_sources"] = []
        self.assertEqual(self.extract(catalogue=profile)["business_context_mode"], "announcement_only")

    def test_control_in_heading_is_cleaned_without_losing_letters(self):
        payload = article().replace(f'<h1 id="press-release-title">{TITLE}</h1>'.encode(),
                                    f'<h1 id="press-release-title">{TITLE.replace("開発", "開" + chr(0) + "発")}</h1>'.encode())
        self.assertIsNotNone(self.extract(payload=payload))

    def test_mutated_feed_publication_cannot_be_verified_by_article(self):
        item = self.item()
        item["published_at"] -= 1
        self.assertIsNone(self.extract(item=item))
        item = self.item()
        item["feed_date_fields"] = {"updated": PUBLISHED}
        self.assertIsNone(self.extract(item=item))

    def test_duplicate_issuer_or_html_corporate_name_is_not_a_matching_identity(self):
        for kwargs in ({"issuer": f"<b>{ISSUER}</b>"},
                       {"extra": f"<dc:corp>{escape(ISSUER)}</dc:corp>"},
                       {"extra": f"<link>{escape(URL)}</link>"}):
            self.assertEqual(sources.parse_feed(feed(feed_item(**kwargs)), NOW, SINCE, self.catalogue), [])


if __name__ == "__main__":
    unittest.main()

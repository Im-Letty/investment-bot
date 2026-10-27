from datetime import date, datetime
from html import escape
import unittest
from unittest.mock import patch

from daily_news_sources import _Document
import official_fsa_source as fsa
import official_news_sources as sources


DAY = "2026-10-13"
URL = "https://www.fsa.go.jp/news/r8/hoken/20261013/20261013.html"
TITLE = "金融制度の運用について"
NOW = datetime(2026, 10, 13, 19, 0, tzinfo=sources.JST)
# Entirely fictional text in the independently inspected release template.
# No assertion here reports a real policy, institution's action, or amount.
BODY = ("これは原文取得の検証にのみ使う架空の説明です。実際の金融制度や方針ではありません。"
        "公表された文書の本文を確認するために、内容を区切りながら読める長さにしています。"
        "対象や条件がある場合も本文に保持し、取得日時を発表日時へ置き換えません。")


def item(**changes):
    return {"source": "金融庁", "title": TITLE + "公表しました。",
            "url": URL, "published_at": None, "published_date": DAY,
            "publication_precision": "day", **changes}


def fixture(body=BODY, dateline="令和８年10月13日", issuer="金融庁",
            heading=TITLE, inner_attrs='class="inner"', contact=True):
    ending = ('<dl class="contact_box"><dt>問合せ先</dt><dd>'
              'CONTACT NOT ARTICLE 03-0000-0000</dd></dl>') if contact else ""
    return ("<html><head><meta charset=\"UTF-8\"></head><body>"
            '<header>GLOBAL NAV NOT ARTICLE</header><div id="main">'
            '<p class="MT_note" style="display:none">TRANSLATION WARNING</p>'
            '<p class="share-button">SOCIAL NOT ARTICLE</p>'
            f"<div {inner_attrs}><div style=\"text-align:right\">"
            f"<p class=\"mb0\">{escape(dateline)}</p>"
            f"<p class=\"mt0\">{escape(issuer)}</p></div>"
            f"<h1>{escape(heading)}</h1><p class=\"indent\">{body}</p>"
            f"{ending}</div></div><footer>GLOBAL FOOTER</footer></body></html>")


def extract(html=None, record=None, original=URL, final=URL, now=NOW, since=date(2026, 10, 13)):
    with patch.dict(sources.HOSTS, {"www.fsa.go.jp": "金融庁"}):
        return fsa.extract_fsa_article(
            _Document(html if html is not None else fixture()),
            record if record is not None else item(),
            original, final, now, since, 1791885600.0)


class FsaSourceTest(unittest.TestCase):
    def test_verified_template_is_html_only_day_precision(self):
        result = extract()
        self.assertEqual(result["source"], "金融庁")
        self.assertEqual(result["title"], TITLE)
        self.assertEqual(result["published_date"], DAY)
        self.assertIsNone(result["published_at"])
        self.assertEqual(result["publication_precision"], "day")
        self.assertEqual(result["source_scope"], "official_fsa_release_html")
        self.assertIs(result["attachments_verified"], False)
        self.assertEqual(result["observed_at"], 1791885600.0)
        self.assertIn(BODY, result["body"])
        self.assertNotIn("CONTACT", result["body"])
        self.assertNotIn("GLOBAL", result["body"])
        self.assertNotIn("SOCIAL", result["body"])
        self.assertNotIn("TRANSLATION", result["body"])

    def test_same_heading_without_feed_delivery_suffix(self):
        self.assertIsNotNone(extract(record=item(title=TITLE)))

    def test_jst_feed_time_is_calendar_discovery_day_only(self):
        publication = fsa.feed_publication("Tue, 13 Oct 2026 17:00:00 JST")
        self.assertEqual(publication, {"published_at": None, "published_date": DAY,
                                     "publication_precision": "day"})

    def test_feed_rejects_bad_calendar_weekday_zone_and_format(self):
        for value in ("Wed, 13 Oct 2026 17:00:00 JST",
                      "Tue, 32 Oct 2026 17:00:00 JST",
                      "Tue, 13 Oct 2026 17:00:00 PST",
                      "Tue, 13 Oct 2026 17:00:00",
                      "2026-10-13", None):
            with self.subTest(value=value):
                self.assertIsNone(fsa.feed_publication(value))

    def test_narrow_dated_html_paths(self):
        self.assertTrue(fsa.article_path("/news/r8/sonota/20261013/20261013.html"))
        self.assertTrue(fsa.article_path("/news/r8/hoken/20261009/20261009.html"))
        for path in ("/news/r8/hoken/20261013/01.pdf",
                     "/singi/transition_finance/gijiyousi/20260821.html",
                     "/inter/fsf/20261013_3/20261013_3.html",
                     "/ordinary/chuui/chuui_phishing.html", "/news/index.html",
                     "/news/r8/unknown/20261013.html"):
            self.assertFalse(fsa.article_path(path))

    def test_title_scope_and_priority(self):
        self.assertTrue(fsa.eligible_title("損害保険業界の取組について公表しました。"))
        self.assertTrue(fsa.eligible_title("保険会社に対する行政処分について公表しました。"))
        self.assertEqual(fsa.priority({"title": TITLE}), 0)
        for title in ("金融制度の公表予定", "金融会議の開催について", "金融制度の訂正について",
                      "金融制度のページを更新しました。", "採用募集について", "重要なお知らせ"):
            self.assertFalse(fsa.eligible_title(title))
            self.assertEqual(fsa.priority({"title": title}), 99)

    def test_rss_original_and_published_precision_required(self):
        for changes in ({"source": "別機関"}, {"url": URL + "?bad=1"},
                        {"published_date": "2026-10-09"},
                        {"published_date": "not-a-date"}, {"published_at": 1791882000.0},
                        {"publication_precision": "second"}):
            self.assertIsNone(extract(record=item(**changes)))

    def test_original_issuer_is_required(self):
        self.assertIsNone(extract(html=fixture(issuer="別機関")))
        self.assertIsNone(extract(html=fixture(issuer="金融庁の参考資料")))

    def test_dateline_must_be_exact_visible_date(self):
        for dateline in ("", "令和８年10月13日公表予定", "令和８年10月32日",
                         "令和８年10月９日"):
            self.assertIsNone(extract(html=fixture(dateline=dateline)))

    def test_meta_or_effective_date_cannot_repair_absent_dateline(self):
        html = fixture(dateline="").replace("<head>",
                  '<head><meta name="date" content="2026-10-13">')
        html = html.replace(BODY, BODY + "令和８年10月13日から適用する。")
        self.assertIsNone(extract(html=html))

    def test_optional_publication_metadata_must_agree_without_time_promotion(self):
        for value in ("2026-10-09", "invalid"):
            html = fixture().replace("<head>", f'<head><meta name="date" content="{value}">')
            self.assertIsNone(extract(html=html))
        html = fixture().replace("<head>",
              '<head><meta name="date" content="2026-10-13T17:00:00+09:00">')
        self.assertIsNone(extract(html=html)["published_at"])

    def test_heading_exactly_correlates_with_rss(self):
        self.assertIsNone(extract(html=fixture(heading="別の金融制度について")))
        self.assertIsNone(extract(html=fixture().replace("</h1>", "</h1><h1>別の金融制度</h1>")))

    def test_explicit_parenthetical_subtitle_matches_primary_and_preserves_original_heading(self):
        html = fixture().replace(f"<h1>{TITLE}</h1>",
                                 f"<h1>{TITLE}<br>\n  （検証用株式会社）</h1>")
        original = item()
        before = dict(original)
        result = extract(html=html, record=original)
        self.assertIsNotNone(result)
        self.assertEqual(result["title"], TITLE + "\n（検証用株式会社）")
        self.assertIn("（検証用株式会社）", result["body"])
        self.assertEqual(original, before)
        self.assertEqual(result["published_date"], DAY)
        self.assertIsNone(result["published_at"])
        self.assertFalse(result["attachments_verified"])

    def test_subtitle_correlation_requires_exact_primary_and_one_explicit_simple_break(self):
        endings = (
            f"{TITLE}（検証用株式会社）",
            f"{TITLE}追加<br>（検証用株式会社）",
            "別の金融制度について<br>（検証用株式会社）",
            f"{TITLE}<br>追加の説明です",
            f"{TITLE}<br>（）",
            f"{TITLE}<br>（検証用株式会社",
            f"{TITLE}<br>検証用株式会社）",
            f"{TITLE}<br>（検証用（子会社））",
            f"{TITLE}<br>（検証用株式会社）追加",
            f"{TITLE}<br><span>（検証用株式会社）</span>",
            f"<span>{TITLE}</span><br>（検証用株式会社）",
            f"{TITLE}<br><br>（検証用株式会社）",
            f"{TITLE}<br class=\"other\">（検証用株式会社）",
        )
        for heading in endings:
            with self.subTest(heading=heading):
                html = fixture().replace(f"<h1>{TITLE}</h1>", f"<h1>{heading}</h1>")
                self.assertIsNone(extract(html=html))

    def test_subtitle_path_keeps_visibility_date_issuer_body_contact_and_source_guards(self):
        html = fixture().replace(f"<h1>{TITLE}</h1>",
                                 f"<h1>{TITLE}<br>（検証用株式会社）</h1>")
        changes = (
            html.replace("<h1>", '<h1 hidden>'),
            html.replace("<br>", '<br aria-hidden="true">'),
            html.replace("令和８年10月13日", "令和８年10月12日"),
            html.replace('<p class="mt0">金融庁</p>', '<p class="mt0">別機関</p>'),
            html.replace(BODY, "短い説明"),
            html.replace('class="contact_box"', 'class="other"'),
            html.replace("<head>", '<head><meta name="date" content="2026-10-12">'),
        )
        for changed in changes:
            with self.subTest(changed=changed):
                self.assertIsNone(extract(html=changed))
        self.assertIsNone(extract(html=html, final=URL.replace("hoken", "sonota")))
        self.assertIsNone(extract(html=html, record=item(published_date="2026-10-12")))

    def test_hidden_issuer_heading_main_and_body_fail_closed(self):
        changes = (
            fixture().replace('<p class="mt0">', '<p class="mt0" hidden>'),
            fixture().replace("<h1>", '<h1 aria-hidden="true">'),
            fixture().replace('id="main"', 'id="main" style="display:none"'),
            fixture().replace('<p class="indent">', '<p class="indent" style="visibility:hidden">'),
        )
        for html in changes:
            self.assertIsNone(extract(html=html))

    def test_unknown_template_missing_contact_duplicate_main_rejected(self):
        for html in (fixture(inner_attrs='class="other"'), fixture(contact=False),
                     fixture().replace("</body>", '<div id="main">duplicate</div></body>'),
                     fixture().replace("</h1>", "</h1><div>unexpected heading wrapper</div>")
                                  .replace('<div style="text-align:right">', '<section>')):
            self.assertIsNone(extract(html=html))

    def test_attachments_are_not_fetched_or_counted_as_substantive_body(self):
        html = fixture(body="短い説明").replace(
            '<dl class="contact_box">',
            '<ul><li><a href="https://foreign.example/file.pdf">' +
            ("添付資料のラベル" * 30) + '</a></li></ul><dl class="contact_box">')
        self.assertIsNone(extract(html=html))

    def test_foreign_credentials_query_fragment_and_redirect_rejected(self):
        urls = (URL.replace("www.fsa.go.jp", "foreign.example"),
                URL.replace("https://", "http://"),
                URL.replace("https://", "https://user@"), URL + "?x=1", URL + "#x",
                URL.replace("www.fsa.go.jp", "www.fsa.go.jp:444"))
        for url in urls:
            self.assertIsNone(extract(original=url, final=url, record=item(url=url)))
        self.assertIsNone(extract(final=URL.replace("hoken", "sonota")))

    def test_future_day_and_exact_same_day_cutoff_are_not_inferred(self):
        self.assertIsNone(extract(now=datetime(2026, 10, 12, 23, tzinfo=sources.JST)))
        self.assertIsNone(extract(since=datetime(2026, 10, 13, 8, tzinfo=sources.JST)))
        self.assertIsNotNone(extract(since=datetime(2026, 10, 12, 8, tzinfo=sources.JST)))


if __name__ == "__main__":
    unittest.main()

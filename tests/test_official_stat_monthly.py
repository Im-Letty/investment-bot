from datetime import date, datetime
from hashlib import sha256
from html import escape
import unittest

import official_news_sources as sources
from official_stat_monthly import extract_stat_monthly


URL = "https://www.stat.go.jp/data/kakei/sokuhou/tsuki/index.html"
NOW = datetime(2026, 10, 9, 7, 30, tzinfo=sources.JST)
TITLE = "家計調査（二人以上の世帯：2026年（令和8年）8月分）"
HEADING = "家計調査（二人以上の世帯）2026年（令和8年）8月分 （2026年10月9日公表）"
# Synthetic structural fixture. Its made-up values are not actual statistics.
MONTHLY = "月次の構造検証用本文です。消費支出と実収入の変化について、対象月と比較対象を明記します。" * 3
QUARTERLY = "四半期の旧本文が月次記事に混ざらないことを確認します。"
ANNUAL = "古い年平均の本文と金額999,999円が月次記事に混ざらないことを確認します。"


def document(*, heading=HEADING, monthly=MONTHLY, extra_meta="", duplicate=False,
             boundary=True, before="", after="", monthly_extra=""):
    monthly_h2 = f'<h2><a id="tsuki" name="tsuki">{escape(heading)}</a></h2>'
    quarter_h2 = '<h2><a id="shihanki" name="shihanki">家計調査 2026年4～6月期平均（2026年8月7日公表）</a></h2>'
    payload = ('<html><head>' + extra_meta + '</head><body><main id="main_contents">'
               '<article><section id="section"><article><p>skip</p></article><article>'
               '<h1>家計調査報告 ―月・四半期・年―</h1>' + before + monthly_h2
               + (monthly_h2 if duplicate else '') + f'<div><p>{escape(monthly)}</p></div>'
               + monthly_extra
               + (quarter_h2 + f'<p>{escape(QUARTERLY)}</p>'
                  '<h2><a id="nen" name="nen">家計調査 2025年平均（2026年2月6日公表）</a></h2>'
                  f'<p>{escape(ANNUAL)}</p><p>2026年3月10日掲載</p>' if boundary else '')
               + after + '</article></section></article></main></body></html>')
    return sources._Document(payload)


class StatisticsMonthlyTests(unittest.TestCase):
    def item(self, **changes):
        return {"source": "総務省統計局", "url": URL, "title": TITLE,
                **sources._publication("2026-10-09"), **changes}

    def extract(self, doc=None, item=None, *, original=URL, final=URL, now=NOW,
                since=date(2026, 10, 8), observed_at=None):
        return extract_stat_monthly(doc or document(), item or self.item(), original, final,
                                    now, since, NOW.timestamp() if observed_at is None else observed_at)

    def test_monthly_body_and_publication_are_separate_from_old_releases(self):
        row = self.extract()
        self.assertIsNotNone(row)
        self.assertIn(MONTHLY, row["body"])
        self.assertNotIn(QUARTERLY, row["body"])
        self.assertNotIn(ANNUAL, row["body"])
        self.assertNotIn("999,999", row["body"])
        self.assertNotIn("2026年8月7日", row["body"])
        self.assertEqual(row["published_date"], "2026-10-09")
        self.assertEqual(row["publication_precision"], "day")
        self.assertIsNone(row["published_at"])
        self.assertEqual(row["result_period"], "2026-08")
        self.assertEqual(row["body_sha256"], sha256(row["body"].encode()).hexdigest())

    def test_exact_url_and_unchanged_identity_are_required(self):
        for original, final in ((URL + "?next=private", URL), (URL, URL + "?changed=1"),
                                (URL, URL.replace("kakei", "roudou")),
                                (URL.replace("https:", "http:"), URL),
                                (URL.replace("stat.go.jp", "example.test"), URL)):
            with self.subTest(original=original, final=final):
                self.assertIsNone(self.extract(original=original, final=final))

    def test_period_era_and_publication_day_must_match(self):
        headings = (HEADING.replace("8月分", "7月分"), HEADING.replace("令和8年", "令和7年"),
                    HEADING.replace("10月9日", "10月8日"), HEADING.replace("8月分", "13月分"),
                    HEADING.replace("公表", "公表予定"), HEADING.replace("二人以上", "単身"))
        for heading in headings:
            with self.subTest(heading=heading):
                self.assertIsNone(self.extract(document(heading=heading)))
        for title in (TITLE.replace("8月分", "7月分"), TITLE.replace("令和8年", "令和7年"),
                      TITLE.replace("8月分", "0月分"), "家計調査結果"):
            with self.subTest(title=title):
                self.assertIsNone(self.extract(item=self.item(title=title)))

    def test_ambiguous_or_unexpected_structure_is_rejected(self):
        for doc in (document(duplicate=True), document(boundary=False),
                    sources._Document('<main id="main_contents"><h1>家計調査報告 ―月・四半期・年―</h1></main>')):
            self.assertIsNone(self.extract(doc))
        doc = document()
        next(node for node in doc.nodes if node.tag == "a" and node.attrs.get("id") == "shihanki").attrs["id"] = "different"
        self.assertIsNone(self.extract(doc))
        doc = document()
        next(node for node in doc.nodes if node.tag == "section").attrs["class"] = "related"
        self.assertIsNone(self.extract(doc))
        doc = document()
        next(node for node in doc.nodes if node.tag == "main").tag = "nav"
        self.assertIsNone(self.extract(doc))
        doc = document()
        next(node for node in doc.nodes if node.tag == "h1").attrs["class"] = "related"
        # The parent article is still inspected; the excluded title becomes empty.
        self.assertIsNone(self.extract(doc))

    def test_other_explicit_publication_metadata_remains_strict(self):
        for extra in ('<meta name="date" content="2026-10-08">',
                      '<meta property="article:published_time" content="invalid">'):
            self.assertIsNone(self.extract(document(extra_meta=extra)))
        self.assertIsNotNone(self.extract(document(extra_meta='<meta name="date" content="2026-10-09">')))
        self.assertIsNone(self.extract(document(monthly=MONTHLY + "2026年10月8日公表")))

    def test_hidden_result_containers_and_text_cannot_supply_evidence(self):
        hidden_attrs = ({"hidden": ""}, {"aria-hidden": "true"},
                        {"style": "display: none"}, {"style": "visibility: hidden !important;"})
        targets = (
            lambda n: n.tag == "main",
            lambda n: n.tag == "h1",
            lambda n: n.tag == "h2" and "10月9日公表" in sources._body_text(n),
            lambda n: n.tag == "a" and n.attrs.get("id") == "tsuki",
            lambda n: n.tag == "h2" and "8月7日公表" in sources._body_text(n),
            lambda n: n.tag == "a" and n.attrs.get("id") == "shihanki",
            lambda n: n.tag == "p" and MONTHLY in sources._body_text(n),
            lambda n: n.tag == "div" and MONTHLY in sources._body_text(n),
        )
        for attrs in hidden_attrs:
            for target in targets:
                with self.subTest(attrs=attrs, target=targets.index(target)):
                    doc = document()
                    next(node for node in doc.nodes if target(node)).attrs.update(attrs)
                    self.assertIsNone(self.extract(doc))
        # A hidden extra paragraph must not be included even with visible points.
        self.assertIsNone(self.extract(document(monthly_extra=f'<p hidden>{ANNUAL}</p>')))

    def test_result_month_precedes_publication_month_including_year_boundary(self):
        for month in (10, 11):
            with self.subTest(month=month):
                title = TITLE.replace("8月分", f"{month}月分")
                heading = HEADING.replace("8月分", f"{month}月分")
                self.assertIsNone(self.extract(document(heading=heading), self.item(title=title)))
        title = TITLE.replace("2026年（令和8年）8月分", "2025年（令和7年）12月分")
        heading = HEADING.replace("2026年（令和8年）8月分", "2025年（令和7年）12月分")
        heading = heading.replace("2026年10月9日公表", "2026年1月9日公表")
        item = self.item(title=title, **sources._publication("2026-01-09"))
        row = self.extract(document(heading=heading), item,
                           now=datetime(2026, 1, 10, 7, 30, tzinfo=sources.JST), since=date(2026, 1, 9))
        self.assertIsNotNone(row)
        self.assertEqual(row["result_period"], "2025-12")

    def test_nested_result_sections_or_headings_are_rejected_whole(self):
        extras = (f'<section><p>{ANNUAL}</p></section>',
                  f'<div><section><p>{QUARTERLY}</p></section></div>',
                  f'<article><p>{ANNUAL}</p></article>',
                  f'<div><h2>別の結果</h2><p>{ANNUAL}</p></div>')
        for extra in extras:
            with self.subTest(extra=extra):
                self.assertIsNone(self.extract(document(monthly_extra=extra)))

    def test_labeled_historical_columns_in_monthly_comparison_table_are_retained(self):
        table = ('<div class="section"><table><tr><th>2025年平均</th><th>2026年8月</th></tr>'
                 '<tr><td>参考年平均0.9</td><td>月次架空値1.2</td></tr></table></div>')
        row = self.extract(document(monthly_extra=table))
        self.assertIsNotNone(row)
        self.assertIn("2025年平均", row["body"])
        self.assertIn("参考年平均0.9", row["body"])
        self.assertIn("2026年8月", row["body"])
        self.assertNotIn(ANNUAL, row["body"])

    def test_complete_bounded_body_and_actual_observation_time_are_preserved(self):
        actual = datetime(2026, 10, 9, 14, 21, tzinfo=sources.JST).timestamp()
        row = self.extract(document(monthly=MONTHLY + "末尾の重要な条件です。"), observed_at=actual)
        self.assertTrue(row["body"].endswith("末尾の重要な条件です。"))
        self.assertEqual(row["observed_at"], actual)
        self.assertNotIn("body_verified_at", row)
        self.assertIsNone(self.extract(document(monthly="あ" * (sources.MAX_BODY_CHARS + 1))))
        self.assertIsNone(self.extract(document(monthly="短い見出しだけ")))

    def test_original_window_rules_and_date_only_precision_are_retained(self):
        self.assertIsNone(self.extract(now=datetime(2026, 10, 8, 7, 30, tzinfo=sources.JST)))
        self.assertIsNone(self.extract(since=datetime(2026, 10, 9, 8, tzinfo=sources.JST)))
        row = self.extract(since=datetime(2026, 10, 9, 0, tzinfo=sources.JST))
        self.assertIsNotNone(row)
        self.assertIsNone(row["published_at"])


if __name__ == "__main__":
    unittest.main()

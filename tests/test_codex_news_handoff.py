"""Two workers share real publication contracts; only transports are mocked."""
from copy import deepcopy
from datetime import datetime
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from codex_website_producer import CodexWebsiteProviders, generate_codex_website_edition
from daily_news_runtime import DailyNewsRuntime
from morning_news_window import MorningNewsPreparer, morning_window, select_articles
from news_cache import JST
from news_initial import initial_news
from website_news import website_news
from tests.test_daily_news_runtime import MemoryStorage, issue as prior_issue
from tests.test_website_news_producer import ENV, NOW, WINDOW, MockTransport, approval, sources
from tests.test_codex_website_producer import Writer


class CodexHandoffTests(unittest.TestCase):
    def setUp(self):
        blocker = patch("requests.sessions.Session.request", side_effect=AssertionError("network disabled"))
        blocker.start()
        self.addCleanup(blocker.stop)
        self.now = NOW
        self.day = datetime.fromtimestamp(NOW, JST).date().isoformat()
        self.folder = TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.baseline = Path(self.folder.name) / "baseline.json"
        self.baseline.write_text(json.dumps([prior_issue("2026-10-05")]))
        window = morning_window(NOW)
        self.manifest = {**window, "articles": select_articles(sources(), window), "source_status": {
             name: {"feed_status": "ok", "status": "collected"} for name in ("総務省統計局", "財務省")}}
        self.storage = MemoryStorage({f"days/{self.day}/preparation/manifest.json": self.manifest})
        self.transports, self.writers = [], []
        self.reject = False

    def runtime(self, owner):
        def collector(*args, **kwargs):
            raise AssertionError("frozen manifest must not be recollected")
        return DailyNewsRuntime(self.storage, self.generate if owner == "local" else None,
                 enabled=True, generation_owner=owner, max_attempts=1,
                 baseline_path=self.baseline,
                 cache_path=Path(self.folder.name) / f"{owner}.json",
                 clock=lambda: self.now,
                 source_preparer=MorningNewsPreparer(self.storage, collector, clock=lambda: self.now))

    def generate(self, now, **options):
        def review(name, data):
            result = approval()
            if self.reject and name == "openai":
                result["approved"] = False
                result["checks"]["facts"] = False
                result["issues"] = ["fixture-only factual rejection"]
            return result
        transport, writer = MockTransport(reviewer=review), Writer()
        self.transports.append(transport)
        self.writers.append(writer)
        return generate_codex_website_edition(now, **options, clock=lambda: self.now,
                 providers=CodexWebsiteProviders(ENV, transport.session, writer=writer))

    def test_verified_edition_moves_from_codex_to_render_without_early_release_or_redrafting(self):
        server, local = self.runtime("external"), self.runtime("local")
        self.assertEqual(server.run_once()["status"], "waiting_for_writer")
        self.assertFalse(any("attempt-" in path for path in self.storage.values))
        self.assertEqual(local.run_once()["status"], "prepared")
        self.assertEqual(server.run_once()["status"], "prepared")
        self.assertEqual([name for name, _, _ in self.transports[0].calls], ["gemini", "openai"])
        self.assertEqual(self.transports[0].calls[0][1], self.transports[0].calls[1][1])
        self.assertEqual(len(self.writers[0].calls), 3)
        overview = self.writers[0].calls[-1][1]
        self.assertEqual(overview['selected_indexes'], [0, 1])
        self.assertEqual([row['index'] for row in overview['article_cards']], [0])
        self.assertTrue(self.writers[0].closed)
        self.now = datetime.fromtimestamp(NOW, JST).replace(hour=7, minute=59, second=59).timestamp()
        before = initial_news(website_news.snapshot(), now=self.now, reviewed_digests=server.reviewed_digests())
        self.assertEqual(before["edition_date"], "2026-10-05")
        self.now += 1
        self.assertEqual(server.run_once()["status"], "ready")
        restarted = self.runtime("external")
        self.assertEqual(restarted.run_once()["status"], "ready")
        after = initial_news(website_news.snapshot(), now=self.now, reviewed_digests=restarted.reviewed_digests())
        self.assertEqual(after["edition_date"], self.day)
        self.assertEqual(after["digest"]["reading_structure"], "lead-plus-other-news-v1")
        self.assertEqual([row["url"] for row in after["digest"]["article_summaries"]],
                         [row["url"] for row in after["digest"]["article_refs"]])
        self.assertEqual(len(after["digest"]["article_summaries"]), 2)
        self.assertEqual(len(self.transports), 1)
        for article in self.manifest["articles"]:
            self.assertNotIn(article["body"], json.dumps(after, ensure_ascii=False))

    def test_failed_fresh_review_never_hands_off_or_retries_after_restart(self):
        self.reject = True
        local = self.runtime("local")
        self.assertEqual(local.run_once()["status"], "generation_failed")
        self.assertNotIn(f"days/{self.day}/edition.json", self.storage.values)
        self.assertEqual(self.runtime("external").run_once()["status"], "waiting_for_writer")
        self.now += 20 * 60
        self.assertEqual(self.runtime("local").run_once()["status"], "daily_limit")
        self.assertEqual(len(self.transports), 1)
        self.assertEqual([name for name, _, _ in self.transports[0].calls], ["gemini", "openai"] * 2)


if __name__ == "__main__":
    unittest.main()

"""Website adapter regression tests; every HTTP request is a mock."""
from copy import deepcopy
from datetime import datetime
from hashlib import sha256
import json
import unittest
from unittest.mock import MagicMock, patch

import requests
import daily_news_producer as shared
import website_news_producer as website
from morning_news_window import morning_window
from news_cache import JST


NOW = datetime(2026, 10, 6, 7, 40, tzinfo=JST).timestamp()
WINDOW = morning_window(NOW)
ENV = {name: "fixture-only-" + name for name in website.KEY_NAMES}


def sources(count=2):
    rows = []
    for index in range(count):
        body = f"公的機関の架空の発表{index}です。別の発表と混同しないための原文です。" * 8
        url = f"https://www.mof.go.jp/policy/international_policy/convention/dialogue/test{index}.html"
        rows.append({"source": "財務省", "title": f"架空の資料{index}", "url": url,
                     "evidence_url": url, "published_at": None, "published_date": "2026-10-05",
                     "publication_precision": "day", "body": body,
                     "body_sha256": sha256(body.encode()).hexdigest(),
                     "body_verified_at": WINDOW["cutoff_at"] - 60, "selection_route": "date_only"})
    return rows


def approval():
    return {"approved": True, "checks": {name: True for name in shared.CHECKS}, "issues": []}


class MockTransport:
    """Exercises the real request construction and parsing, without sockets."""

    def __init__(self, reviewer=None):
        self.session = MagicMock()
        self.session.post.side_effect = self.post
        self.calls = []
        self.reviewer = reviewer or (lambda name, data: approval())
        self.after_post = None
        self.gemini_interruptions = 0

    def post(self, url, **options):
        payload = deepcopy(options["json"])
        if "anthropic.com" in url:
            name = "claude"
            data = json.loads(payload["messages"][0]["content"])
            if data["stage"] == "article":
                index = data["articles"][0]["index"]
                value = {"index": index, "headline": f"発表{index}をやさしく読む",
                         "summary": "導入" * 55 + "\n\n" + "補足" * 60,
                         "facts": [{"text": "今回の発表の主体と出来事です。", "evidence_ids": [f"{index}:0"]},
                                   {"text": "今回の発表の目的です。", "evidence_ids": [f"{index}:0"]}]}
            else:
                value = {"headline": "今日の経済をやさしく読む", "summary": "全体" * 120,
                         "indexes": [row["index"] for row in data["article_cards"]]}
            response = {"stop_reason": "end_turn", "content": [{"type": "text", "text": json.dumps(value)}]}
        elif "googleapis.com" in url:
            name = "gemini"
            data = json.loads(payload["contents"][0]["parts"][0]["text"])
            if self.gemini_interruptions:
                self.gemini_interruptions -= 1
                response = {"candidates": [{"finishReason": "MAX_TOKENS"}]}
            else:
                response = {"candidates": [{"finishReason": "STOP", "content": {"parts": [
                    {"text": json.dumps(self.reviewer(name, data))}]}}]}
        else:
            self.assert_openai(url)
            name = "openai"
            data = json.loads(payload["input"][0]["content"])
            response = {"status": "completed", "output": [{"type": "message", "role": "assistant",
                        "status": "completed", "content": [{"type": "output_text",
                        "text": json.dumps(self.reviewer(name, data))}]}]}
        self.calls.append((name, data, payload))
        mocked = MagicMock()
        entered = mocked.__enter__.return_value
        entered.status_code = 200
        entered.raw.read1.side_effect = [json.dumps(response).encode(), b""]
        if self.after_post:
            self.after_post()
        return mocked

    @staticmethod
    def assert_openai(url):
        if url != "https://api.openai.com/v1/responses":
            raise AssertionError("unexpected mock URL")


class WebsiteProducerTests(unittest.TestCase):
    def setUp(self):
        blocker = patch("requests.sessions.Session.request", side_effect=AssertionError("network disabled"))
        blocker.start()
        self.addCleanup(blocker.stop)

    def provider(self, transport=None, env=None):
        transport = transport or MockTransport()
        provider = website.WebsiteProviders(ENV if env is None else env, session=transport.session)
        self.addCleanup(provider.close)
        return provider, transport

    def generate(self, provider, rows=None):
        return website.generate_website_edition(NOW, articles=sources() if rows is None else rows,
                source_window=deepcopy(WINDOW), providers=provider, clock=lambda: NOW)

    def test_real_adapter_isolates_sources_and_reviews_same_final_copy(self):
        provider, transport = self.provider()
        rows = sources()
        frozen = deepcopy(rows)
        result = self.generate(provider, rows)
        self.assertEqual([name for name, _, _ in transport.calls], ["claude"] * 3 + ["gemini", "openai"])
        self.assertEqual(provider.http_counts, {"claude": 3, "gemini": 1, "openai": 1})
        self.assertEqual([data["articles"][0]["index"] for _, data, _ in transport.calls[:2]], [0, 1])
        for index, (_, data, _) in enumerate(transport.calls[:2]):
            self.assertEqual(data["articles"], [{**rows[index], "index": index}])
            self.assertNotIn(rows[1 - index]["body"], json.dumps(data, ensure_ascii=False))
        self.assertNotIn("articles", transport.calls[2][1])
        self.assertEqual(transport.calls[3][1], transport.calls[4][1])
        self.assertEqual(transport.calls[3][1]["draft"]["summary"], result["summary"])
        self.assertEqual(result["source_window"], WINDOW)
        self.assertEqual(result["publish_at"], datetime(2026, 10, 6, 8, tzinfo=JST).timestamp())
        self.assertEqual(rows, frozen)
        public = json.dumps(result, ensure_ascii=False)
        for forbidden in ("article_evidence", "evidence_passages", "summary_alternatives", "quotes", "facts"):
            self.assertNotIn('"' + forbidden + '"', public)
        for row in rows:
            self.assertNotIn(row["body"], public)
        transport.session.close.assert_called_once()
        self.assertEqual(provider.env, {})

    def test_model_defaults_and_override_do_not_mutate_or_retain_unrelated_env(self):
        env = {**ENV, "SUPABASE_KEY": "unrelated-fixture", "NEWS_CLAUDE_MODEL": "claude-override-model"}
        before = deepcopy(env)
        provider, transport = self.provider(env=env)
        self.assertNotIn("SUPABASE_KEY", provider.env)
        self.generate(provider, sources(1))
        self.assertEqual(env, before)
        self.assertEqual(transport.calls[0][2]["model"], "claude-override-model")
        self.assertIn("gemini-2.5-flash", transport.session.post.call_args_list[-2].args[0])
        self.assertEqual(transport.calls[-1][2]["model"], "gpt-6-luna")
        default, other = self.provider()
        self.generate(default, sources(1))
        self.assertEqual(other.calls[0][2]["model"], "claude-sonnet-4-6")

    def test_metadata_only_contains_safe_configuration_and_is_independent(self):
        env = {**ENV, "SUPABASE_KEY": "unrelated-fixture"}
        with patch.object(website.shared.requests, "Session", side_effect=AssertionError("no session")):
            metadata = website.configuration_metadata(env)
        self.assertEqual(metadata, {"generation_mode": "source_isolated",
            "models": {"claude": "claude-sonnet-4-6", "gemini": "gemini-2.5-flash", "openai": "gpt-6-luna"},
            "limits": {"provider_http_calls": {"claude": 4, "gemini": 3, "openai": 2},
                       "total_http_calls": 8, "generation_seconds": 720}})
        for value in env.values():
            self.assertNotIn(value, json.dumps(metadata))
        metadata["limits"]["provider_http_calls"]["claude"] = 999
        self.assertEqual(website.configuration_metadata(env)["limits"]["provider_http_calls"]["claude"], 4)
        for bad in ("sk-fixture-never-a-model", "AIzaFixtureOnly", "model\nprivate", {}, ""):
            with self.subTest(bad=bad):
                configured = {**env, "NEWS_CLAUDE_MODEL": bad}
                self.assertEqual(website.configuration_metadata(configured)["models"]["claude"], "invalid")
                with self.assertRaisesRegex(shared.GenerationError, "^invalid_model$"):
                    website.WebsiteProviders(configured)

    def test_default_entry_creates_fresh_single_use_provider_for_each_attempt(self):
        sessions = [MockTransport(), MockTransport()]
        with patch.dict(website.os.environ, ENV, clear=True), \
                patch.object(website.shared.requests, "Session", side_effect=[row.session for row in sessions]):
            for _ in range(2):
                result = website.generate_website_edition(NOW, articles=sources(1),
                    source_window=deepcopy(WINDOW), clock=lambda: NOW)
                self.assertEqual(result["edition_date"], "2026-10-06")
        for transport in sessions:
            self.assertEqual(len(transport.calls), 4)
            transport.session.close.assert_called_once()

    def test_unbounded_or_reused_provider_cannot_start_generation(self):
        with self.assertRaisesRegex(shared.GenerationError, "^generation_budget_required$"):
            self.generate(shared.Providers(ENV, session=MagicMock()))
        provider, transport = self.provider()
        self.generate(provider, sources(1))
        with self.assertRaisesRegex(shared.GenerationError, "^generation_budget_required$"):
            self.generate(provider, sources(1))
        self.assertEqual(len(transport.calls), 4)
        transport.session.close.assert_called_once()

    def test_active_provider_reuse_is_rejected_without_closing_its_owner_session(self):
        provider, transport = self.provider()
        provider._begin()
        with self.assertRaisesRegex(shared.GenerationError, "^generation_budget_required$"):
            self.generate(provider, sources(1))
        transport.session.close.assert_not_called()
        transport.session.post.assert_not_called()
        self.assertTrue(provider.env)
        provider.close()
        transport.session.close.assert_called_once()

    def test_invalid_source_and_review_rejection_close_without_fallback(self):
        provider, transport = self.provider()
        invalid = sources()
        invalid[0]["body_sha256"] = "0" * 64
        with self.assertRaisesRegex(shared.GenerationError, "^invalid_official_article$"):
            self.generate(provider, invalid)
        transport.session.post.assert_not_called()
        transport.session.close.assert_called_once()

        def reject(name, data):
            value = approval()
            if name == "openai":
                value["approved"] = False
                value["checks"]["facts"] = False
                value["issues"] = ["元の発表で確認できない内容があります。"]
            return value
        provider, transport = self.provider(MockTransport(reject))
        # There is not enough remaining Claude budget for both details and a
        # new overview. No first rewrite or old approval may escape that gate.
        with self.assertRaisesRegex(shared.GenerationError, "^generation_call_limit$"):
            self.generate(provider)
        self.assertEqual([name for name, _, _ in transport.calls], ["claude"] * 3 + ["gemini", "openai"])
        transport.session.close.assert_called_once()

    def test_http_attempts_include_gemini_token_retry_and_failed_requests(self):
        provider, transport = self.provider()
        transport.gemini_interruptions = 1
        self.generate(provider, sources(1))
        self.assertEqual(provider.http_counts, {"claude": 2, "gemini": 2, "openai": 1})
        configs = [payload["generationConfig"]["maxOutputTokens"]
                   for name, _, payload in transport.calls if name == "gemini"]
        self.assertEqual(configs, [6000, 12000])

        provider, transport = self.provider()
        transport.session.post.side_effect = requests.ConnectionError("private transport error fixture")
        with self.assertRaisesRegex(shared.GenerationError, "^claude_unavailable$"):
            self.generate(provider, sources(1))
        self.assertEqual(provider.http_counts, {"claude": 1})
        transport.session.close.assert_called_once()

    def test_per_provider_and_total_caps_stop_before_extra_transport_call(self):
        for name, limit in website.CALL_LIMITS.items():
            with self.subTest(provider=name):
                provider, _ = self.provider()
                with patch.object(shared.Providers, "_post", return_value={}) as transport:
                    for _ in range(limit):
                        provider._post("https://mock.invalid", {}, {}, name)
                    with self.assertRaisesRegex(shared.GenerationError, "^generation_call_limit$"):
                        provider._post("https://mock.invalid", {}, {}, name)
                    self.assertEqual(transport.call_count, limit)
        provider, _ = self.provider()
        with patch.object(shared.Providers, "_post", return_value={}) as transport:
            for name in ["claude"] * 3 + ["gemini"] * 3 + ["openai"] * 2:
                provider._post("https://mock.invalid", {}, {}, name)
            with self.assertRaisesRegex(shared.GenerationError, "^generation_call_limit$"):
                provider._post("https://mock.invalid", {}, {}, "claude")
            self.assertEqual(transport.call_count, 8)

    def test_preflight_reserves_pending_writing_and_both_reviews_without_consuming_http(self):
        cases = [(["claude"] * 2, 3), (["gemini"] * 3, 1), (["openai"] * 2, 1),
                 (["claude"] * 2 + ["gemini"] * 2 + ["openai"], 2)]
        for spent, wanted in cases:
            with self.subTest(spent=spent):
                provider, _ = self.provider()
                with patch.object(shared.Providers, "_post", return_value={}) as transport:
                    for name in spent:
                        provider._post("https://mock.invalid", {}, {}, name)
                    before = provider.http_counts
                    with self.assertRaisesRegex(shared.GenerationError, "^generation_call_limit$"):
                        provider.reserve_drafting(wanted)
                    self.assertEqual(provider.http_counts, before)
                    self.assertEqual(transport.call_count, len(spent))
        provider, transport = self.provider()
        provider.reserve_drafting(4)
        self.assertEqual(provider.http_counts, {})
        for invalid in (0, 5, True, 1.0, "2"):
            with self.assertRaisesRegex(shared.GenerationError, "^generation_budget_required$"):
                provider.reserve_drafting(invalid)
        transport.session.post.assert_not_called()

    def test_deadline_blocks_late_results_and_resets_context_and_closes_session(self):
        current = [0]
        with patch.object(website.time, "monotonic", side_effect=lambda: current[0]):
            provider, transport = self.provider()
            transport.after_post = lambda: current.__setitem__(0, 721)
            with self.assertRaisesRegex(shared.GenerationError, "^generation_deadline$"):
                self.generate(provider, sources(1))
            self.assertEqual(provider.http_counts, {"claude": 1})
            self.assertEqual(len(transport.calls), 1)
            transport.session.close.assert_called_once()
            self.assertIsNone(shared._generation_deadline.get())
        current = [0]
        with patch.object(website.time, "monotonic", side_effect=lambda: current[0]):
            provider, transport = self.provider()
            current[0] = 720
            with self.assertRaisesRegex(shared.GenerationError, "^generation_deadline$"):
                self.generate(provider, sources(1))
            transport.session.post.assert_not_called()
            transport.session.close.assert_called_once()

    def test_inherited_earlier_deadline_is_not_extended_by_isolated_entry(self):
        current = [0]
        with patch.object(website.time, "monotonic", side_effect=lambda: current[0]):
            provider, transport = self.provider()
            token = shared._generation_deadline.set(2)
            try:
                transport.after_post = lambda: current.__setitem__(0, 3)
                with self.assertRaisesRegex(shared.GenerationError, "^generation_deadline$"):
                    self.generate(provider, sources(1))
                self.assertEqual(transport.session.post.call_args.kwargs["timeout"], (2, 2))
                self.assertEqual(provider.http_counts, {"claude": 1})
                self.assertEqual(shared._generation_deadline.get(), 2)
                transport.session.close.assert_called_once()
            finally:
                shared._generation_deadline.reset(token)


if __name__ == "__main__":
    unittest.main()

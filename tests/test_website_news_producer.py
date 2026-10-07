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


def claude_events(response):
    """A mock of the documented SSE message, including omitted-thinking blocks."""
    events = [{"type": "message_start", "message": {"type": "message", "role": "assistant",
                "content": [], "stop_reason": None}}]
    for index, block in enumerate(response.get("content", [])):
        kind = block["type"]
        start = {"type": kind, "text": ""} if kind == "text" else deepcopy(block)
        if kind == "thinking":
            start = {"type": kind, "thinking": ""}
        events.append({"type": "content_block_start", "index": index, "content_block": start})
        if kind == "text":
            text = block["text"]
            for part in (text[:len(text)//2], text[len(text)//2:]):
                events.append({"type": "content_block_delta", "index": index,
                               "delta": {"type": "text_delta", "text": part}})
        elif kind == "thinking":
            events.extend([
                {"type": "content_block_delta", "index": index,
                 "delta": {"type": "thinking_delta", "thinking": block.get("thinking", "")}},
                {"type": "content_block_delta", "index": index,
                 "delta": {"type": "signature_delta", "signature": block.get("signature", "")}}])
        events.extend([{"type": "content_block_stop", "index": index}, {"type": "ping"}])
    events.extend([{"type": "message_delta", "delta": {"stop_reason": response.get("stop_reason"),
                    "stop_sequence": None}, "usage": {"output_tokens": 1}}, {"type": "message_stop"}])
    return events


def sse_bytes(events, newline="\n"):
    return "".join("event: " + event["type"] + newline + "data: "
                   + json.dumps(event, ensure_ascii=False) + newline * 2 for event in events).encode()


class MockTransport:
    """Exercises the real request construction and parsing, without sockets."""

    def __init__(self, reviewer=None, writer=None, response_transform=None, stream_transform=None, chunk_size=None):
        self.session = MagicMock()
        self.session.post.side_effect = self.post
        self.calls = []
        self.reviewer = reviewer or (lambda name, data: approval())
        self.writer = writer or (lambda data, value: value)
        self.response_transform = response_transform or (lambda name, data, value: value)
        self.stream_transform = stream_transform or (lambda events: events)
        self.chunk_size = chunk_size
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
                         "indexes": data.get("selected_indexes", [row["index"] for row in data["article_cards"]])}
            value = self.writer(deepcopy(data), value)
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
        response = self.response_transform(name, data, response)
        if name == "claude" and payload.get("stream") is True:
            events = self.stream_transform(claude_events(response))
            wire = events if isinstance(events, bytes) else sse_bytes(events)
        else:
            wire = json.dumps(response).encode()
        mocked = MagicMock()
        entered = mocked.__enter__.return_value
        entered.status_code = 200
        entered.raw.read1.side_effect = ([wire[i:i+self.chunk_size] for i in range(0, len(wire), self.chunk_size)]
                                       if self.chunk_size else [wire]) + [b""]
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
        self.assertEqual(transport.calls[3][2]["generationConfig"]["thinkingConfig"],
                         {"thinkingBudget": 4096})
        self.assertEqual(transport.calls[3][1]["original_articles"],
                         [{**row, "index": index} for index, row in enumerate(rows)])
        self.assertEqual(transport.calls[3][1]["draft"], {
            "headline": result["headline"], "summary": result["summary"],
            "articles": [{"index": index, "headline": row["headline"], "summary": row["summary"]}
                         for index, row in enumerate(result["article_summaries"])]})
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
        for name, _, payload in transport.calls:
            if name == "claude":
                self.assertEqual(payload["temperature"], 0)
                self.assertNotIn("thinking", payload)
                self.assertNotIn("effort", payload["output_config"])
        self.assertIn("gemini-2.5-flash", transport.session.post.call_args_list[-2].args[0])
        self.assertEqual(transport.calls[-1][2]["model"], "gpt-6-luna")
        default, other = self.provider()
        self.generate(default, sources(1))
        self.assertEqual(other.calls[0][2]["model"], "claude-sonnet-4-6")

    def test_gemini_review_budget_only_changes_exact_model_without_search(self):
        for model, search, expected in (
                ("gemini-2.5-flash", False, 4096),
                ("gemini-2.5-flash", True, 1024),
                ("gemini-2.5-flash-preview", False, 1024),
                ("gemini-2.5-flash-preview", True, 1024)):
            with self.subTest(model=model, search=search):
                provider, transport = self.provider(env={**ENV, "NEWS_GEMINI_MODEL": model})
                self.assertTrue(provider.gemini("fixture", {}, search=search)["approved"])
                config = transport.calls[0][2]["generationConfig"]
                self.assertEqual(config["thinkingConfig"], {"thinkingBudget": expected})
                self.assertEqual(config["maxOutputTokens"], 6000)
                self.assertEqual(config["temperature"], 0)
                self.assertEqual(provider.http_counts, {"gemini": 1})
                self.assertEqual(len(transport.calls), 1)

    def test_bounded_manual_thinking_streamed_json_applies_to_article_overview_and_repairs(self):
        seen = set()

        def writer(data, value):
            if data['stage'] not in seen:
                seen.add(data['stage'])
                value['summary'] = ''
            return value

        def transform(name, data, response):
            if name == 'claude':
                response['content'] = [
                    {'type': 'thinking', 'thinking': 'HIDDEN_REASONING_FIXTURE',
                     'signature': 'HIDDEN_SIGNATURE_FIXTURE', 'text': 'UNTRUSTED_NON_TEXT_BLOCK'},
                    *response['content'],
                    {'type': 'redacted_thinking', 'data': 'HIDDEN_REDACTED_FIXTURE'}]
            return response

        provider, transport = self.provider(MockTransport(writer=writer, response_transform=transform))
        result = self.generate(provider, sources(1))
        writing = [(data, payload) for name, data, payload in transport.calls if name == 'claude']
        self.assertEqual([data['stage'] for data, _ in writing], ['article', 'article', 'overview', 'overview'])
        self.assertEqual([bool(data.get('validation_error')) for data, _ in writing], [False, True, False, True])
        for data, payload in writing:
            self.assertEqual(payload['thinking'],
                             {'type': 'enabled', 'budget_tokens': 2048, 'display': 'omitted'})
            self.assertEqual(payload['output_config']['effort'], 'medium')
            self.assertIs(payload['stream'], True)
            self.assertNotIn('temperature', payload)
            self.assertEqual(payload['max_tokens'], 8000)
            self.assertEqual(payload['output_config']['format'],
                             {'type': 'json_schema', 'schema': website._claude_schema(data['stage'])})
        self.assertEqual(provider.http_counts, {'claude': 4, 'gemini': 1, 'openai': 1})
        for (name, _, _), call in zip(transport.calls, transport.session.post.call_args_list):
            self.assertEqual(call.kwargs['timeout'], (10, 90 if name == 'claude' else 45))
        self.assertEqual(transport.calls[-2][1], transport.calls[-1][1])
        self.assertEqual(transport.calls[-1][1]['draft']['summary'], result['summary'])
        # Only the parsed text JSON reaches later writing, either reviewer, or
        # the returned issue consumed by the diagnostic/publication wrappers.
        exposed = json.dumps([transport.calls, result], ensure_ascii=False)
        for marker in ('HIDDEN_REASONING_FIXTURE', 'HIDDEN_SIGNATURE_FIXTURE',
                       'HIDDEN_REDACTED_FIXTURE', 'UNTRUSTED_NON_TEXT_BLOCK'):
            self.assertNotIn(marker, exposed)
        transport.session.close.assert_called_once()

    def test_other_model_overrides_keep_existing_non_thinking_json_behavior(self):
        for model in ('claude-haiku-4-5-20251001', 'claude-sonnet-4-6-preview'):
            with self.subTest(model=model):
                env = {**ENV, 'NEWS_CLAUDE_MODEL': model}
                before = deepcopy(env)
                provider, transport = self.provider(env=env)
                self.generate(provider, sources(1))
                for name, _, payload in transport.calls:
                    if name == 'claude':
                        self.assertEqual(payload['model'], model)
                        self.assertEqual(payload['temperature'], 0)
                        self.assertNotIn('thinking', payload)
                        self.assertNotIn('effort', payload['output_config'])
                        self.assertNotIn('stream', payload)
                        self.assertEqual(payload['max_tokens'], 4500)
                self.assertEqual(env, before)
                self.assertTrue(all(call.kwargs['timeout'] == (10, 45)
                                    for call in transport.session.post.call_args_list))

    def test_streamed_utf8_crlf_and_usage_updates_keep_only_complete_text(self):
        def transform(name, data, response):
            if name == 'claude':
                text = json.dumps(json.loads(response['content'][0]['text']), ensure_ascii=False)
                response['content'] = [
                    {'type': 'thinking', 'thinking': '', 'signature': 'PRIVATE_SIGNATURE'},
                    {'type': 'redacted_thinking', 'data': 'PRIVATE_REDACTED'},
                    {'type': 'text', 'text': text}]
            return response
        def stream(events):
            events[-2:-2] = [
                {'type': 'message_delta', 'delta': {}, 'usage': {'output_tokens': 1}},
                {'type': 'message_delta', 'delta': {'stop_reason': None}, 'usage': {'output_tokens': 2}},
                {'type': 'ping'}]
            return b': keepalive\r\n\r\n' + sse_bytes(events, '\r\n')
        provider, transport = self.provider(MockTransport(response_transform=transform,
                                            stream_transform=stream, chunk_size=3))
        result = self.generate(provider, sources(1))
        self.assertEqual(provider.http_counts, {'claude': 2, 'gemini': 1, 'openai': 1})
        self.assertEqual(transport.calls[-2][1], transport.calls[-1][1])
        self.assertEqual(transport.calls[-1][1]['draft']['summary'], result['summary'])
        exposed = json.dumps([transport.calls, result], ensure_ascii=False)
        for forbidden in ('PRIVATE_SIGNATURE', 'PRIVATE_REDACTED', '"output_tokens"'):
            self.assertNotIn(forbidden, exposed)
        transport.session.close.assert_called_once()

    def test_invalid_stream_protocol_stops_once_without_reviews_or_partial_json_fallback(self):
        def change_event(events, kind, update):
            next(row for row in events if row['type'] == kind).update(update)
            return events
        cases = {
            'no message stop': (lambda e: e[:-1], 'claude_incomplete'),
            'no terminal delta': (lambda e: e[:-2] + e[-1:], 'invalid_provider_json'),
            'open block': (lambda e: [r for r in e if r['type'] != 'content_block_stop'], 'invalid_provider_json'),
            'duplicate start': (lambda e: e[:1] + e, 'invalid_provider_json'),
            'duplicate stop': (lambda e: e + e[-1:], 'invalid_provider_json'),
            'duplicate terminal delta': (lambda e: e[:-1] + [e[-2], e[-1]], 'invalid_provider_json'),
            'invalid message delta': (lambda e: change_event(e, 'message_delta', {'delta': 'PRIVATE_ERROR'}), 'invalid_provider_json'),
            'stop sequence': (lambda e: change_event(e, 'message_delta', {'delta': {'stop_sequence': 'PRIVATE_ERROR'}}), 'invalid_provider_json'),
            'block index bool': (lambda e: change_event(e, 'content_block_start', {'index': False}), 'invalid_provider_json'),
            'block index skips': (lambda e: change_event(e, 'content_block_start', {'index': 2}), 'invalid_provider_json'),
            'delta index differs': (lambda e: change_event(e, 'content_block_delta', {'index': 1}), 'invalid_provider_json'),
            'delta without block': (lambda e: [r for r in e if r['type'] != 'content_block_start'], 'invalid_provider_json'),
            'wrong role': (lambda e: change_event(e, 'message_start', {'message': {'type': 'message',
                                             'role': 'user', 'content': []}}), 'invalid_provider_json'),
            'terminal before text': (lambda e: e[:1] + [{'type': 'message_delta', 'delta': {'stop_reason': 'end_turn'}}] + e[1:], 'invalid_provider_json'),
            'output limit before text': (lambda e: e[:1] + [{'type': 'message_delta', 'delta': {'stop_reason': 'max_tokens'}}] + e[1:], 'invalid_provider_json'),
            'refusal before text': (lambda e: e[:1] + [{'type': 'message_delta', 'delta': {'stop_reason': 'refusal'}}] + e[1:], 'invalid_provider_json'),
            'premature stop after metadata': (lambda e: e[:1] + [{'type': 'message_delta', 'delta': {}, 'usage': {'output_tokens': 3}}, {'type': 'message_stop'}], 'invalid_provider_json'),
            'new block after terminal': (lambda e: e[:-1] + [{'type': 'content_block_start', 'index': 1,
                                             'content_block': {'type': 'text', 'text': 'PRIVATE_ERROR'}}] + e[-1:], 'invalid_provider_json'),
            'unknown event': (lambda e: e[:-1] + [{'type': 'unknown', 'secret': 'PRIVATE_ERROR'}] + e[-1:], 'invalid_provider_json'),
            'stream error': (lambda e: e[:-1] + [{'type': 'error', 'error': {'message': 'PRIVATE_ERROR'}}], 'claude_unavailable'),
            'refusal': (lambda e: change_event(e, 'message_delta', {'delta': {'stop_reason': 'refusal'}}), 'claude_incomplete'),
            'truncated output': (lambda e: change_event(e, 'message_delta', {'delta': {'stop_reason': 'max_tokens'}}), 'claude_incomplete'),
            'unknown terminal reason': (lambda e: change_event(e, 'message_delta', {'delta': {'stop_reason': 'PRIVATE_ERROR'}}), 'claude_incomplete'),
            'wrong delta type': (lambda e: change_event(e, 'content_block_delta',
                    {'delta': {'type': 'input_json_delta', 'partial_json': 'PRIVATE_ERROR'}}), 'invalid_provider_json'),
            'incomplete SSE frame': (lambda e: sse_bytes(e).removesuffix(b'\n\n'), 'claude_incomplete'),
            'unfinished trailing bytes': (lambda e: sse_bytes(e) + b'data: PRIVATE_ERROR', 'claude_incomplete'),
            'invalid UTF8': (lambda e: b'event: \xff\n\n', 'invalid_provider_json'),
            'malformed JSON': (lambda e: b'event: message_start\ndata: {PRIVATE_ERROR\n\n', 'invalid_provider_json'),
            'duplicate JSON key': (lambda e: b'event: ping\ndata: {"type":"ping","type":"ping"}\n\n', 'invalid_provider_json'),
            'event type mismatch': (lambda e: b'event: ping\ndata: {"type":"message_start"}\n\n', 'invalid_provider_json'),
            'duplicate SSE event field': (lambda e: b'event: ping\nevent: ping\ndata: {"type":"ping"}\n\n', 'invalid_provider_json'),
            'JSON instead of SSE': (lambda e: b'{"stop_reason":"end_turn","content":[]}', 'claude_incomplete'),
        }
        expected_phase = {
            'no message stop': 'sse_incomplete', 'no terminal delta': 'sse_message_stop',
            'open block': 'sse_message_delta', 'duplicate start': 'sse_message_start',
            'duplicate stop': 'sse_event_order', 'duplicate terminal delta': 'sse_message_delta',
            'invalid message delta': 'sse_message_delta', 'stop sequence': 'sse_message_delta',
            'block index bool': 'sse_block_index', 'block index skips': 'sse_block_index',
            'delta index differs': 'sse_block_index', 'delta without block': 'sse_block_delta',
            'wrong role': 'sse_message_start', 'terminal before text': 'sse_message_delta',
            'output limit before text': 'sse_message_delta', 'refusal before text': 'sse_message_delta',
            'premature stop after metadata': 'sse_message_stop',
            'new block after terminal': 'sse_block_index',
            'unknown event': 'sse_unknown_event', 'stream error': 'sse_provider_error',
            'refusal': 'sse_stop_reason', 'truncated output': 'sse_stop_reason',
            'unknown terminal reason': 'sse_stop_reason',
            'wrong delta type': 'sse_block_delta', 'incomplete SSE frame': 'sse_incomplete',
            'unfinished trailing bytes': 'sse_incomplete', 'invalid UTF8': 'sse_utf8',
            'malformed JSON': 'sse_json', 'duplicate JSON key': 'sse_json',
            'event type mismatch': 'sse_event_type', 'duplicate SSE event field': 'sse_frame',
            'JSON instead of SSE': 'sse_incomplete',
        }
        delta_subreasons = {'duplicate terminal delta': 'terminal_already', 'open block': 'active_block',
                           'terminal before text': 'before_text', 'output limit before text': 'before_text',
                           'refusal before text': 'before_text', 'invalid message delta': 'invalid_delta',
                           'stop sequence': 'stop_sequence'}
        for name, (transform, code) in cases.items():
            with self.subTest(case=name):
                provider, transport = self.provider(MockTransport(stream_transform=transform, chunk_size=17))
                with self.assertRaisesRegex(shared.GenerationError, '^' + code + '$') as caught:
                    self.generate(provider, sources(1))
                self.assertEqual(provider.http_counts, {'claude': 1})
                self.assertEqual(len(transport.calls), 1)
                self.assertNotIn('PRIVATE_ERROR', str(caught.exception))
                expected = {'parser_phase': expected_phase[name]}
                if name in delta_subreasons:
                    expected['parser_subreason'] = delta_subreasons[name]
                    self.assertIn(caught.exception.parser_subreason, website.CLAUDE_MESSAGE_DELTA_FAILURES)
                    if name != 'invalid message delta':
                        expected['parser_stop_reason_nonnull'] = name != 'stop sequence'
                if expected_phase[name] == 'sse_stop_reason' or delta_subreasons.get(name) == 'before_text':
                    expected['parser_output_limit_reached'] = name in ('truncated output', 'output limit before text')
                self.assertEqual(vars(caught.exception), expected)
                self.assertIn(caught.exception.parser_phase, website.CLAUDE_PARSE_PHASES)
                transport.session.close.assert_called_once()

    def test_nonterminal_usage_updates_preserve_open_blocks_and_final_review_copy(self):
        def response(name, data, value):
            if name == 'claude':
                value['content'].insert(0, {'type': 'thinking', 'thinking': '',
                                           'signature': 'PRIVATE_SIGNATURE'})
            return value
        def stream(events):
            result = []
            sequence = 0
            for event in events:
                result.append(event)
                if event['type'] in ('message_start', 'content_block_start',
                                      'content_block_delta', 'content_block_stop'):
                    sequence += 1
                    result.append({'type': 'message_delta',
                                   'delta': {} if sequence % 2 else {'stop_reason': None, 'stop_sequence': None},
                                   'usage': {'output_tokens': sequence}})
            return result
        provider, transport = self.provider(MockTransport(response_transform=response,
                                            stream_transform=stream, chunk_size=7))
        result = self.generate(provider, sources(1))
        self.assertEqual(provider.http_counts, {'claude': 2, 'gemini': 1, 'openai': 1})
        self.assertEqual(transport.calls[-2][1], transport.calls[-1][1])
        self.assertEqual(transport.calls[-1][1]['draft']['summary'], result['summary'])
        self.assertEqual(transport.calls[-1][1]['draft']['articles'][0]['summary'],
                         result['article_summaries'][0]['summary'])
        for forbidden in ('PRIVATE_SIGNATURE', '"output_tokens"', 'parser_phase'):
            self.assertNotIn(forbidden, json.dumps([transport.calls, result], ensure_ascii=False))
        transport.session.close.assert_called_once()

    def test_stream_heartbeats_do_not_reset_absolute_deadline_or_byte_limit(self):
        current = [0]
        with patch.object(website.time, 'monotonic', side_effect=lambda: current[0]):
            provider, transport = self.provider()
            def post(*args, **kwargs):
                response = MagicMock()
                response.__enter__.return_value.status_code = 200
                def heartbeat(*args, **kwargs):
                    current[0] += 26
                    return sse_bytes([{'type': 'ping'}])
                response.__enter__.return_value.raw.read1.side_effect = heartbeat
                return response
            transport.session.post.side_effect = post
            with self.assertRaisesRegex(shared.GenerationError, '^claude_response_limit$'):
                self.generate(provider, sources(1))
            self.assertEqual(provider.http_counts, {'claude': 1})
            self.assertEqual(current[0], 182)
            transport.session.post.assert_called_once()
            transport.session.close.assert_called_once()
        provider, transport = self.provider(MockTransport(stream_transform=lambda e: b':' + b'x' * 1_000_000))
        with self.assertRaisesRegex(shared.GenerationError, '^claude_response_limit$'):
            self.generate(provider, sources(1))
        self.assertEqual(provider.http_counts, {'claude': 1})
        self.assertEqual(len(transport.calls), 1)

    def test_stream_interruption_does_not_retry_or_accept_already_received_json(self):
        provider, transport = self.provider()
        original = transport.session.post.side_effect
        def interrupted(*args, **kwargs):
            response = original(*args, **kwargs)
            entered = response.__enter__.return_value
            chunks = list(entered.raw.read1.side_effect)
            entered.raw.read1.side_effect = [chunks[0], requests.ReadTimeout('PRIVATE_NETWORK_ERROR')]
            return response
        transport.session.post.side_effect = interrupted
        with self.assertRaisesRegex(shared.GenerationError, '^claude_unavailable$'):
            self.generate(provider, sources(1))
        self.assertEqual(provider.http_counts, {'claude': 1})
        self.assertEqual(len(transport.calls), 1)
        transport.session.close.assert_called_once()

    def test_website_longer_read_wait_requires_exact_streamed_model(self):
        cases = (
            ('claude', {'model': 'claude-sonnet-4-6'}),
            ('claude', {'model': 'claude-sonnet-4-6', 'stream': False}),
            ('claude', {'model': 'claude-sonnet-4-6', 'stream': 1}),
            ('claude', {'model': 'claude-sonnet-4-6', 'stream': 'true'}),
            ('claude', {'model': 'claude-other', 'stream': True}),
            ('gemini', {'model': 'claude-sonnet-4-6', 'stream': True}),
            ('openai', {'model': 'claude-sonnet-4-6', 'stream': True}),
        )
        for name, payload in cases:
            current = [0]
            with self.subTest(provider=name, payload=payload), patch.object(website.time, 'monotonic', side_effect=lambda: current[0]):
                session = MagicMock()
                response = session.post.return_value.__enter__.return_value
                response.status_code = 200
                response.raw.read1.side_effect = [b'{}', b'']
                provider = website.WebsiteProviders(ENV, session=session)
                self.addCleanup(provider.close)
                self.assertEqual(provider._post('https://example.test', {}, payload, name), {})
                self.assertEqual(session.post.call_args.kwargs['timeout'], (10, 45))
                def late_body(*args, **kwargs):
                    current[0] = 101
                    return b'{}'
                response.raw.read1.side_effect = late_body
                with self.assertRaisesRegex(shared.GenerationError, '^' + name + '_response_limit$'):
                    provider._post('https://example.test', {}, payload, name)
                self.assertEqual(session.post.call_count, 2)
                self.assertEqual(provider.http_counts, {name: 2})

    def test_native_stream_after_100_seconds_still_gets_identical_final_reviews(self):
        current = [0]
        with patch.object(website.time, 'monotonic', side_effect=lambda: current[0]):
            provider, transport = self.provider()
            def completed():
                if transport.calls[-1][0] == 'claude':
                    current[0] += 113
            transport.after_post = completed
            result = self.generate(provider, sources(1))
            self.assertEqual(current[0], 226)
            self.assertEqual(provider.http_counts, {'claude': 2, 'gemini': 1, 'openai': 1})
            self.assertEqual(transport.calls[-2][1], transport.calls[-1][1])
            self.assertEqual(transport.calls[-1][1]['draft']['summary'], result['summary'])
            transport.session.close.assert_called_once()

    def test_native_response_window_cannot_extend_an_earlier_total_deadline(self):
        current = [0]
        with patch.object(website.time, 'monotonic', side_effect=lambda: current[0]):
            provider, transport = self.provider()
            transport.after_post = lambda: current.__setitem__(0, 113)
            token = shared._generation_deadline.set(110)
            try:
                with self.assertRaisesRegex(shared.GenerationError, '^generation_deadline$'):
                    self.generate(provider, sources(1))
                self.assertEqual(shared._generation_deadline.get(), 110)
                self.assertEqual(provider.http_counts, {'claude': 1})
                self.assertEqual(len(transport.calls), 1)
                self.assertEqual(transport.session.post.call_args.kwargs['timeout'], (10, 90))
                transport.session.close.assert_called_once()
            finally:
                shared._generation_deadline.reset(token)

    def test_streamed_read_wait_is_clamped_to_remaining_deadline(self):
        with patch.object(website.time, 'monotonic', return_value=0):
            provider, transport = self.provider()
            token = shared._generation_deadline.set(55)
            try:
                self.generate(provider, sources(1))
                for (name, _, _), call in zip(transport.calls, transport.session.post.call_args_list):
                    self.assertEqual(call.kwargs['timeout'], (10, 55 if name == 'claude' else 45))
                self.assertEqual(shared._generation_deadline.get(), 55)
            finally:
                shared._generation_deadline.reset(token)

    def test_streamed_timeout_and_per_call_deadline_stop_without_retry_or_reviews(self):
        provider, transport = self.provider()
        transport.session.post.side_effect = requests.ReadTimeout('PRIVATE_TIMEOUT_DETAIL')
        with self.assertRaisesRegex(shared.GenerationError, '^claude_unavailable$'):
            self.generate(provider, sources(1))
        self.assertEqual(provider.http_counts, {'claude': 1})
        transport.session.post.assert_called_once()
        self.assertEqual(transport.session.post.call_args.kwargs['timeout'], (10, 90))
        transport.session.close.assert_called_once()

        current = [0]
        with patch.object(website.time, 'monotonic', side_effect=lambda: current[0]):
            provider, transport = self.provider()
            # The 180-second per-call limit still rejects a late body even
            # though the 12-minute generation deadline has not expired.
            transport.after_post = lambda: current.__setitem__(0, 181)
            with self.assertRaisesRegex(shared.GenerationError, '^claude_response_limit$'):
                self.generate(provider, sources(1))
            self.assertEqual(provider.http_counts, {'claude': 1})
            self.assertEqual(len(transport.calls), 1)
            self.assertEqual(transport.session.post.call_args.kwargs['timeout'], (10, 90))
            transport.session.close.assert_called_once()

    def test_three_articles_can_repair_two_oversized_details_and_still_get_both_reviews(self):
        seen = set()

        def writer(data, value):
            if data["stage"] == "article":
                index = data["articles"][0]["index"]
                if index in (0, 2) and index not in seen:
                    seen.add(index)
                    value["summary"] = "長" * 220 + "\n\n" + "文" * 219
            return value

        provider, transport = self.provider(MockTransport(writer=writer))
        result = self.generate(provider, sources(3))
        self.assertEqual(len(result["article_refs"]), 3)
        self.assertEqual(provider.http_counts, {"claude": 6, "gemini": 1, "openai": 1})
        self.assertEqual(len(transport.calls), website.TOTAL_CALL_LIMIT)
        self.assertEqual([data["articles"][0]["index"] for name, data, _ in transport.calls
                          if name == "claude" and data["stage"] == "article"], [0, 0, 1, 2, 2])
        self.assertEqual(transport.calls[-2][1], transport.calls[-1][1])
        self.assertEqual(transport.calls[-1][1]["draft"]["summary"], result["summary"])
        writing = [(data, payload) for name, data, payload in transport.calls if name == "claude"]
        self.assertTrue(any("validation_error" in data for data, _ in writing))
        for data, payload in writing:
            self.assertEqual(payload["output_config"]["format"], {
                "type": "json_schema", "schema": website._claude_schema(data["stage"])})

    def test_structured_schemas_are_static_stage_specific_and_keep_optional_alternatives(self):
        provider, transport = self.provider()
        rows = sources(2)
        self.generate(provider, rows)
        schemas = []
        for name, data, payload in transport.calls:
            if name != "claude":
                continue
            format_ = payload['output_config']['format']
            self.assertEqual(format_['type'], 'json_schema')
            schema = format_['schema']
            schemas.append(schema)
            fields = {'index', 'facts', 'headline', 'summary'} if data['stage'] == 'article' else {'headline', 'summary', 'indexes'}
            self.assertEqual(set(schema['required']), fields)
            self.assertEqual(set(schema['properties']), fields | {'summary_alternatives'})
            self.assertEqual(schema['properties']['summary_alternatives']['items'], {'type': 'string'})
            headline_guidance = schema['properties']['headline']['description']
            self.assertIn('主体と核心の動作一つだけ', headline_guidance)
            self.assertIn('別の動作を連結しない', headline_guidance)
            self.assertIn('headline_termsがあれば見出し自体を修正', headline_guidance)
            self.assertIn('専門語は括弧で説明しても使わない', headline_guidance)
            self.assertIn('前回の見出しは固定しない', headline_guidance)
            self.assertIn('同じJSON内で', schema['properties']['summary_alternatives']['description'])
            summary_guidance = schema['properties']['summary']['description']
            self.assertIn('200〜400字' if data['stage'] == 'article' else '200〜300字', summary_guidance)
            self.assertIn('440字' if data['stage'] == 'article' else '330字', summary_guidance)
            self.assertIn('一文40〜45字程度を目安', summary_guidance)
            self.assertIn('主体と条件を保つ', summary_guidance)
            if data['stage'] == 'article':
                self.assertNotIn('35字以内', headline_guidance)
                self.assertIn('空行で区切る2段落', summary_guidance)
                self.assertIn('元資料の具体的な追加情報', summary_guidance)
                self.assertIn('一つの読者の疑問', summary_guidance)
                self.assertIn('追加情報1点と必要な条件', summary_guidance)
                self.assertIn('非核心の主張は条件ごと省き', summary_guidance)
                self.assertIn('方法の一覧を詰め込まない', schema['properties']['facts']['description'])
                self.assertIn('先頭は主体と出来事、次は明記された目的', schema['properties']['facts']['description'])
                self.assertIn('最大8件は列挙の目標ではない', schema['properties']['facts']['description'])
            else:
                self.assertIn('35字以内', headline_guidance)
                self.assertIn('indexesの先頭記事の主体と核心の動作一つだけ', headline_guidance)
                self.assertIn('別の出来事・署名者・日付・文書を合成しない', headline_guidance)
                self.assertIn('主体・核心の出来事・目的', summary_guidance)
                self.assertIn('記念年や参加者数を字数合わせに足さず', summary_guidance)
                self.assertIn('詳細向けの方法や手続きの一覧を加えない', summary_guidance)
                self.assertIn('法的性質・参加者・方法は核心である場合', summary_guidance)
                self.assertIn('採用主張の意味を限定する場合だけ条件とともに残し', summary_guidance)

            def check(node):
                if isinstance(node, dict):
                    self.assertFalse(set(node) & {'minLength', 'maxLength', 'minimum', 'maximum',
                                                  'maxItems', 'uniqueItems', 'pattern', 'enum', 'const'})
                    if node.get('type') == 'object':
                        self.assertIs(node['additionalProperties'], False)
                    for child in node.values():
                        check(child)
                elif isinstance(node, list):
                    for child in node:
                        check(child)

            check(schema)
            serialized = json.dumps(schema, ensure_ascii=False)
            for value in [*ENV.values(), *[row['body'] for row in rows], *[row['url'] for row in rows]]:
                self.assertNotIn(value, serialized)
        self.assertEqual(schemas[0], schemas[1])
        schemas[0]['properties']['summary']['type'] = 'invalid-mutation'
        self.assertEqual(website._claude_schema('article')['properties']['summary']['type'], 'string')
        self.assertEqual(schemas[1]['properties']['summary']['type'], 'string')
        self.assertEqual(transport.calls[-2][1], transport.calls[-1][1])

    def test_unknown_writer_stage_stops_before_paid_transport(self):
        provider, transport = self.provider()
        for data in ({}, {'stage': 'repair'}, {'stage': 'other'}, {'stage': []}, None):
            with self.subTest(data=data), self.assertRaisesRegex(shared.GenerationError, '^invalid_provider_json$'):
                provider.claude('fixture instruction', data)
        self.assertEqual(provider.http_counts, {})
        transport.session.post.assert_not_called()

    def test_malformed_refused_or_incomplete_output_stops_without_reviews_or_fallback(self):
        cases = (("end_turn", '{"summary":', 'invalid_provider_json'),
                 ("end_turn", '[]', 'invalid_provider_json'),
                 ("refusal", '{}', 'claude_incomplete'),
                 ("max_tokens", '{"summary":', 'claude_incomplete'))
        for stop, text, error in cases:
            with self.subTest(stop=stop, text=text):
                def transform(name, data, response):
                    self.assertEqual(name, 'claude')
                    return {'stop_reason': stop, 'content': [
                        {'type': 'thinking', 'thinking': 'HIDDEN_REASONING_FIXTURE',
                         'signature': 'HIDDEN_SIGNATURE_FIXTURE'},
                        {'type': 'text', 'text': text}]}

                provider, transport = self.provider(MockTransport(response_transform=transform))
                with self.assertRaisesRegex(shared.GenerationError, '^' + error + '$') as caught:
                    self.generate(provider, sources(1))
                phase = 'final_json' if stop == 'end_turn' else 'sse_stop_reason'
                self.assertEqual(caught.exception.parser_phase, phase)
                if phase == 'final_json':
                    self.assertEqual(caught.exception.parser_text_characters, len(text))
                    self.assertEqual(caught.exception.parser_json_failure,
                                     'non_object' if text == '[]' else 'json_decode')
                self.assertEqual(provider.http_counts, {'claude': 1})
                self.assertEqual(len(transport.calls), 1)
                self.assertIn('output_config', transport.calls[0][2])
                self.assertEqual(transport.calls[0][2]['thinking'],
                                 {'type': 'enabled', 'budget_tokens': 2048, 'display': 'omitted'})
                self.assertEqual(transport.calls[0][2]['output_config']['effort'], 'medium')
                self.assertNotIn('temperature', transport.calls[0][2])
                self.assertEqual(transport.calls[0][2]['max_tokens'], 8000)
                transport.session.close.assert_called_once()
                self.assertEqual(provider.env, {})

    def test_final_json_failure_on_repair_has_only_safe_metadata_and_never_reaches_reviews(self):
        for broken, kind in ((' \n', 'empty_text'), ('{PRIVATE_TEXT_OR_KEY', 'json_decode'),
                             ('["PRIVATE_TEXT_OR_KEY"]', 'non_object')):
            with self.subTest(kind=kind):
                def writer(data, value):
                    return {**value, 'summary': 'short'}
                def transform(name, data, response):
                    if 'validation_error' in data:
                        response['content'] = [{'type': 'thinking', 'thinking': '',
                                                'signature': 'PRIVATE_SIGNATURE'},
                                               {'type': 'text', 'text': broken}]
                    return response
                provider, transport = self.provider(MockTransport(writer=writer, response_transform=transform))
                with self.assertRaisesRegex(shared.GenerationError, '^invalid_provider_json$') as caught:
                    self.generate(provider, sources(1))
                metadata = vars(caught.exception)
                self.assertEqual(metadata, {'parser_phase': 'final_json',
                    'parser_text_characters': len(broken), 'parser_json_failure': kind})
                self.assertIn(kind, website.CLAUDE_JSON_FAILURES)
                self.assertNotIn('PRIVATE', json.dumps(metadata))
                self.assertEqual(caught.exception.args, ('invalid_provider_json',))
                self.assertIsNone(caught.exception.__cause__)
                self.assertEqual(provider.http_counts, {'claude': 2})
                self.assertEqual([row[0] for row in transport.calls], ['claude', 'claude'])
                transport.session.close.assert_called_once()

    def test_three_article_overview_can_be_repaired_without_skipping_final_reviews(self):
        first = [True]

        def writer(data, value):
            if data["stage"] == "overview" and first[0]:
                first[0] = False
                value["summary"] = "長" * 331
            return value

        provider, transport = self.provider(MockTransport(writer=writer))
        result = self.generate(provider, sources(3))
        self.assertEqual(len(result["article_refs"]), 3)
        self.assertEqual(provider.http_counts, {"claude": 5, "gemini": 1, "openai": 1})
        self.assertEqual(transport.calls[-2][1], transport.calls[-1][1])

    def test_unaffordable_third_detail_repair_retains_validation_failure_and_stops(self):
        seen = set()

        def writer(data, value):
            if data["stage"] == "article":
                index = data["articles"][0]["index"]
                if index not in seen:
                    seen.add(index)
                    value["summary"] = "長" * 220 + "\n\n" + "文" * 219
            return value

        provider, transport = self.provider(MockTransport(writer=writer))
        with self.assertRaisesRegex(shared.GenerationError, "^isolated_article_length$"):
            self.generate(provider, sources(3))
        self.assertEqual(provider.http_counts, {"claude": 5})
        self.assertLess(len(transport.calls), website.TOTAL_CALL_LIMIT)
        transport.session.close.assert_called_once()

    def test_unaffordable_overview_repair_retains_its_validation_failure(self):
        seen = set()

        def writer(data, value):
            if data["stage"] == "article":
                index = data["articles"][0]["index"]
                if index in (0, 1) and index not in seen:
                    seen.add(index)
                    value["summary"] = "長" * 220 + "\n\n" + "文" * 219
            else:
                value["summary"] = "長" * 331
            return value

        provider, transport = self.provider(MockTransport(writer=writer))
        with self.assertRaisesRegex(shared.GenerationError, "^isolated_overview_length$"):
            self.generate(provider, sources(3))
        self.assertEqual(provider.http_counts, {"claude": 6})
        self.assertNotIn("gemini", provider.http_counts)
        self.assertNotIn("openai", provider.http_counts)
        transport.session.close.assert_called_once()

    def test_metadata_only_contains_safe_configuration_and_is_independent(self):
        env = {**ENV, "SUPABASE_KEY": "unrelated-fixture"}
        with patch.object(website.shared.requests, "Session", side_effect=AssertionError("no session")):
            metadata = website.configuration_metadata(env)
        self.assertEqual(metadata, {"generation_mode": "source_isolated",
            "models": {"claude": "claude-sonnet-4-6", "gemini": "gemini-2.5-flash", "openai": "gpt-6-luna"},
            "limits": {"provider_http_calls": {"claude": 6, "gemini": 3, "openai": 2},
                       "total_http_calls": 8, "generation_seconds": 720}})
        for value in env.values():
            self.assertNotIn(value, json.dumps(metadata))
        metadata["limits"]["provider_http_calls"]["claude"] = 999
        self.assertEqual(website.configuration_metadata(env)["limits"]["provider_http_calls"]["claude"], 6)
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
            self.assertEqual([name for name, _, _ in transport.calls],
                             ["claude", "claude", "gemini", "openai"])
            self.assertEqual(transport.calls[-2][1], transport.calls[-1][1])
            self.assertEqual(transport.calls[-2][2]["generationConfig"]["thinkingConfig"],
                             {"thinkingBudget": 4096})
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
        with self.assertRaisesRegex(shared.GenerationError, "^isolated_editorial_review_failed$"):
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
        reviews = [(data, payload) for name, data, payload in transport.calls if name == "gemini"]
        self.assertEqual([payload["generationConfig"]["thinkingConfig"] for _, payload in reviews],
                         [{"thinkingBudget": 4096}] * 2)
        self.assertEqual(reviews[0][0], reviews[1][0])
        self.assertEqual(reviews[1][0], transport.calls[-1][1])

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
        cases = [(["claude"] * 4, 3), (["gemini"] * 3, 1), (["openai"] * 2, 1),
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
        for invalid in (0, 7, True, 1.0, "2"):
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

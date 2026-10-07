"""Website-only adapter for the source-isolated morning news producer.

Importing this module does not create an HTTP session or read credentials.
Each edition gets one bounded provider instance; the public digest schema and
the two independent final reviews are owned by the existing isolated producer.
"""
from collections import Counter
from collections.abc import Mapping
from copy import deepcopy
import json
import os
import re
from threading import Lock
import time

import daily_news_producer as shared
from isolated_news_producer import generate_isolated_edition


# Three details plus an overview use four writing calls. Leave room for two
# local validation repairs without increasing the eight-call total ceiling.
CALL_LIMITS = {"claude": 6, "gemini": 3, "openai": 2}
TOTAL_CALL_LIMIT = 8
GENERATION_SECONDS = 12 * 60
GENERATION_MODE = "source_isolated"
MODEL_DEFAULTS = {"claude": "claude-sonnet-4-6", "gemini": "gemini-2.5-flash",
                  "openai": "gpt-6-luna"}
MODEL_KEYS = {name: "NEWS_" + name.upper() + "_MODEL" for name in MODEL_DEFAULTS}
KEY_NAMES = ("ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY")
CLAUDE_PARSE_PHASES = frozenset({
    "sse_utf8", "sse_frame", "sse_json", "sse_event_type", "sse_event_order",
    "sse_message_start", "sse_block_index", "sse_block_start", "sse_block_delta",
    "sse_block_stop", "sse_message_delta", "sse_message_stop", "sse_unknown_event",
    "sse_provider_error", "sse_refusal", "sse_stop_reason", "sse_incomplete",
    "final_stop_reason", "final_json",
})
CLAUDE_JSON_FAILURES = frozenset({"empty_text", "json_decode", "non_object", "other"})
CLAUDE_MESSAGE_DELTA_FAILURES = frozenset({
    "terminal_already", "active_block", "before_text", "invalid_delta", "stop_sequence",
})


def _claude_response_error(code, phase):
    # Diagnostic metadata is fixed code, never an event, payload, or model text.
    error = shared.GenerationError(code)
    if phase in CLAUDE_PARSE_PHASES:
        error.parser_phase = phase
    return error


# REST structured outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
# Keep these schemas static and free of source text/credentials. Unsupported
# length/count constraints stay in the isolated producer's local validators.
_SUMMARY = {"type": "string", "description": "説明・句読点・改行を含む完成稿全文。正確さと読みやすさを優先し、短くても要点が伝われば水増ししない。一文40〜45字程度を目安に一つの要点を言い切り、主体と条件を保つ。文数と一文の長さは目安で、原文の意味・必要な条件を優先する"}
_HEADLINE = {"type": "string", "description": "主体と核心の動作一つだけを日常語で示す見出し。別の動作を連結しない。専門語は括弧で説明しても使わない。headline_termsがあれば見出し自体を修正する。前回の見出しは固定しない"}
_ALTERNATIVES = {"type": "array", "items": {"type": "string"},
                 "description": "任意の独立した簡潔な完成稿1〜2本。各案も全体要約200〜300字程度（330字まで）、詳細200〜400字程度（440字まで）が目安。正確さと読みやすさを優先し、字数合わせの水増しや目安だけを理由にした書き直しはしない。一文40〜45字程度の短い完結文を目安にする。同じJSON内で見出し・facts・選んだ記事を共通にし、主稿と同じ形式・役割・必要な条件を残す。文数・一文の長さは目安で、全文の字数と原文の意味・必要な条件を優先する"}
_CLAUDE_SCHEMAS = {
    "article": {"type": "object", "additionalProperties": False,
        "properties": {
            "index": {"type": "integer"},
            "facts": {"type": "array", "description": "概要用の核心。先頭は主体と出来事、次は明記された目的（なければ核心の条件）。通常2件、最大8件は列挙の目標ではない。各1要点と必要な条件を保ち、方法の一覧を詰め込まない",
                "items": {"type": "object", "additionalProperties": False,
                    "properties": {"text": {"type": "string"},
                        "evidence_ids": {"type": "array", "items": {"type": "string"},
                                         "description": "入力の自分の記事の根拠番号1〜3個"}},
                    "required": ["text", "evidence_ids"]}},
            "headline": _HEADLINE,
            "summary": {**_SUMMARY, "description": "詳細は200〜400字程度が目安、必要なら440字まで。" + _SUMMARY["description"] + "。空行で区切る2段落が必須。短い再紹介の後、一つの読者の疑問に答える元資料の具体的な追加情報1点と必要な条件を説明する。非核心の主張は条件ごと省き、一般的な予測で埋めない"},
            "summary_alternatives": _ALTERNATIVES},
        "required": ["index", "facts", "headline", "summary"]},
    "overview": {"type": "object", "additionalProperties": False,
        "properties": {"headline": {**_HEADLINE, "description": _HEADLINE["description"] + "。35字以内。indexesの先頭記事の主体と核心の動作一つだけを示し、別の出来事・署名者・日付・文書を合成しない"},
            "summary": {**_SUMMARY, "description": "全体要約は200〜300字程度が目安、必要なら330字まで。" + _SUMMARY["description"] + "。代表ニュースである先頭1件の主体・核心の出来事・目的を伝え、他の記事を要約へ加えない。記念年や参加者数を字数合わせに足さず、詳細向けの方法や手続きの一覧を加えない。法的性質・参加者・方法は核心である場合や採用主張の意味を限定する場合だけ条件とともに残し、それ以外は主張ごと省く"},
            "indexes": {"type": "array", "items": {"type": "integer"},
                        "description": "selected_indexesの全件を同じ順で返す。先頭1件は代表ニュース、残りは開いて読む別ニュース。要約には先頭1件だけを使う"},
            "summary_alternatives": _ALTERNATIVES},
        "required": ["headline", "summary", "indexes"]},
}


def _claude_schema(stage):
    if not isinstance(stage, str) or stage not in _CLAUDE_SCHEMAS:
        raise shared.GenerationError("invalid_provider_json")
    return deepcopy(_CLAUDE_SCHEMAS[stage])


def _claude_stream_response(chunks):
    """Accept only a complete ordered message; never retain thinking/signatures.

    The shared HTTP reader bounds the total bytes and absolute call deadline.
    https://platform.claude.com/docs/en/build-with-claude/streaming
    """
    def invalid(phase, subreason=None, *, stop_reason_present=None, output_limit_reached=None):
        error = _claude_response_error("invalid_provider_json", phase)
        if phase == "sse_message_delta" and subreason in CLAUDE_MESSAGE_DELTA_FAILURES:
            error.parser_subreason = subreason
            if type(stop_reason_present) is bool:
                error.parser_stop_reason_nonnull = stop_reason_present
            if subreason == "before_text" and type(output_limit_reached) is bool:
                error.parser_output_limit_reached = output_limit_reached
        raise error from None

    def unique_object(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                invalid("sse_json")
            value[key] = item
        return value

    def events():
        pending = b""
        event, data = None, []
        for chunk in chunks:
            pending += chunk
            while b"\n" in pending:
                line, pending = pending.split(b"\n", 1)
                try:
                    line = line.removesuffix(b"\r").decode("utf-8")
                except UnicodeDecodeError:
                    invalid("sse_utf8")
                if not line:
                    if event is None and not data:
                        continue
                    if event is None or not data:
                        invalid("sse_frame")
                    try:
                        value = json.loads("\n".join(data), object_pairs_hook=unique_object)
                    except (ValueError, TypeError):
                        invalid("sse_json")
                    if not isinstance(value, dict) or value.get("type") != event:
                        invalid("sse_event_type")
                    yield event, value
                    event, data = None, []
                elif line.startswith(":"):
                    continue
                else:
                    field, separator, value = line.partition(":")
                    if not separator:
                        invalid("sse_frame")
                    value = value.removeprefix(" ")
                    if field == "event" and event is None:
                        event = value
                    elif field == "data":
                        data.append(value)
                    else:
                        invalid("sse_frame")
        if pending or event is not None or data:
            raise _claude_response_error("claude_incomplete", "sse_incomplete")

    started = finished = terminal = updating = saw_text = False
    active, next_index, texts = None, 0, []
    for event, value in events():
        if finished:
            invalid("sse_event_order")
        if event == "error":
            raise _claude_response_error("claude_unavailable", "sse_provider_error")
        if event == "ping":
            continue
        if event == "message_start":
            message = value.get("message")
            if (started or not isinstance(message, dict) or message.get("type") != "message"
                    or message.get("role") != "assistant" or message.get("content") != []
                    or message.get("stop_reason") is not None):
                invalid("sse_message_start")
            started = True
            continue
        if not started:
            invalid("sse_event_order")
        if event.startswith("content_block_"):
            index = value.get("index")
            if updating or type(index) is not int or index != next_index:
                invalid("sse_block_index")
            if event == "content_block_start":
                block = value.get("content_block")
                if active is not None or not isinstance(block, dict):
                    invalid("sse_block_start")
                active = block.get("type")
                if active == "text":
                    if not isinstance(block.get("text"), str):
                        invalid("sse_block_start")
                    saw_text = True
                    texts.append(block["text"])
                elif active == "thinking":
                    if not isinstance(block.get("thinking"), str):
                        invalid("sse_block_start")
                elif active == "redacted_thinking":
                    if not isinstance(block.get("data"), str):
                        invalid("sse_block_start")
                elif active == "refusal":
                    raise _claude_response_error("claude_incomplete", "sse_refusal")
                else:
                    invalid("sse_block_start")
            elif event == "content_block_delta":
                delta = value.get("delta")
                if active is None or not isinstance(delta, dict):
                    invalid("sse_block_delta")
                kind = delta.get("type")
                if active == "text" and kind == "text_delta" and isinstance(delta.get("text"), str):
                    texts.append(delta["text"])
                elif (active == "thinking" and kind in ("thinking_delta", "signature_delta")
                      and isinstance(delta.get("thinking" if kind == "thinking_delta" else "signature"), str)):
                    pass
                else:
                    invalid("sse_block_delta")
            elif event == "content_block_stop":
                if active is None:
                    invalid("sse_block_stop")
                active = None
                next_index += 1
            else:
                invalid("sse_unknown_event")
            continue
        if event == "message_delta":
            delta = value.get("delta")
            if not isinstance(delta, dict):
                invalid("sse_message_delta", "invalid_delta")
            reason = delta.get("stop_reason")
            if terminal:
                invalid("sse_message_delta", "terminal_already", stop_reason_present=reason is not None)
            if delta.get("stop_sequence") is not None:
                invalid("sse_message_delta", "stop_sequence", stop_reason_present=reason is not None)
            if reason is None:
                # Official SDK accumulate_event treats message deltas as
                # top-level metadata independently of content-block progress.
                # A usage update does not close a block or finish the message.
                # https://github.com/anthropics/anthropic-sdk-python/blob/main/src/anthropic/lib/streaming/_messages.py
                continue
            if active is not None:
                invalid("sse_message_delta", "active_block", stop_reason_present=True)
            if not saw_text:
                invalid("sse_message_delta", "before_text", stop_reason_present=True,
                        output_limit_reached=reason == "max_tokens")
            updating = True
            if reason != "end_turn":
                error = _claude_response_error("claude_incomplete", "sse_stop_reason")
                error.parser_output_limit_reached = reason == "max_tokens"
                raise error
            terminal = True
        elif event == "message_stop":
            if active is not None or not terminal:
                invalid("sse_message_stop")
            finished = True
        else:
            invalid("sse_unknown_event")
    if not finished:
        raise _claude_response_error("claude_incomplete", "sse_incomplete")
    return {"stop_reason": "end_turn", "content": [{"type": "text", "text": "".join(texts)}]}


def _model(value):
    # Never reflect a misplaced API key or arbitrary configuration text through
    # the public metadata endpoint. Valid model overrides still reach Providers.
    return (isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", value)
            and not value.startswith(("sk-", "sk_", "AIza")))


def configuration_metadata(environ=None):
    """Safe, side-effect-free metadata only; does not check or return API keys."""
    env = os.environ if environ is None else environ
    if not isinstance(env, Mapping):
        env = {}
    models = {}
    for name, key in MODEL_KEYS.items():
        value = env.get(key, MODEL_DEFAULTS[name])
        models[name] = value if _model(value) else "invalid"
    return {"generation_mode": GENERATION_MODE, "models": models,
            "limits": {"provider_http_calls": dict(CALL_LIMITS),
                       "total_http_calls": TOTAL_CALL_LIMIT,
                       "generation_seconds": GENERATION_SECONDS}}


class WebsiteProviders(shared.Providers):
    """Count every HTTP attempt, including the built-in Gemini token retry."""

    def __init__(self, environ=None, session=None):
        supplied = os.environ if environ is None else environ
        if not isinstance(supplied, Mapping):
            raise shared.GenerationError("generation_budget_required")
        env = {key: supplied[key] for key in KEY_NAMES if key in supplied}
        for name, key in MODEL_KEYS.items():
            value = supplied.get(key, MODEL_DEFAULTS[name])
            if not _model(value):
                raise shared.GenerationError("invalid_model")
            env[key] = value
        super().__init__(environ=env, session=session)
        self.session.trust_env = False
        self._counts = Counter()
        self._lock = Lock()
        self._deadline = time.monotonic() + GENERATION_SECONDS
        self._started = self._closed = False

    @property
    def http_counts(self):
        with self._lock:
            return dict(self._counts)

    def _check(self):
        shared._check_deadline()
        if time.monotonic() >= self._deadline:
            raise shared.GenerationError("generation_deadline")
        if self._closed:
            raise shared.GenerationError("generation_budget_required")

    def _begin(self):
        with self._lock:
            if self._started or self._closed:
                raise shared.GenerationError("generation_budget_required")
            self._started = True
            inherited = shared._generation_deadline.get()
            if inherited is not None:
                # The isolated entry establishes its own cooperative context.
                # Retain any earlier caller deadline rather than extending it.
                self._deadline = min(self._deadline, inherited)

    def reserve_drafting(self, claude_calls):
        """Preflight all pending writing plus at least one review from each AI."""
        with self._lock:
            self._check()
            if type(claude_calls) is not int or not 1 <= claude_calls <= CALL_LIMITS["claude"]:
                raise shared.GenerationError("generation_budget_required")
            if (TOTAL_CALL_LIMIT - sum(self._counts.values()) < claude_calls + 2
                    or CALL_LIMITS["claude"] - self._counts["claude"] < claude_calls
                    or any(CALL_LIMITS[name] - self._counts[name] < 1
                           for name in ("gemini", "openai"))):
                raise shared.GenerationError("generation_call_limit")

    def _post(self, url, headers, payload, provider):
        with self._lock:
            self._check()
            if provider not in CALL_LIMITS:
                raise shared.GenerationError("generation_budget_required")
            if (sum(self._counts.values()) >= TOTAL_CALL_LIMIT
                    or self._counts[provider] >= CALL_LIMITS[provider]):
                raise shared.GenerationError("generation_call_limit")
            # Failed requests and interrupted responses consume the same budget.
            self._counts[provider] += 1
        existing = shared._generation_deadline.get()
        token = shared._generation_deadline.set(
            min(existing, self._deadline) if existing is not None else self._deadline)
        try:
            result = super()._post(url, headers, payload, provider)
            self._check()
            return result
        finally:
            shared._generation_deadline.reset(token)

    def _request_seconds(self, provider, payload):
        if (provider == "claude" and isinstance(payload, dict)
                and payload.get("model") == "claude-sonnet-4-6"
                and payload.get("stream") is True):
            return 180
        return super()._request_seconds(provider, payload)

    def _request_read_timeout(self, provider, payload):
        if (provider == "claude" and isinstance(payload, dict)
                and payload.get("model") == "claude-sonnet-4-6"
                and payload.get("stream") is True):
            return 90
        return super()._request_read_timeout(provider, payload)

    def _gemini_thinking_budget(self, model, *, search):
        if model == "gemini-2.5-flash" and search is False:
            return 4096
        return super()._gemini_thinking_budget(model, search=search)

    def _decode_response(self, provider, payload, chunks):
        if (provider == "claude" and isinstance(payload, dict) and payload.get("stream") is True
                and payload.get("model") == "claude-sonnet-4-6"):
            return _claude_stream_response(chunks)
        return super()._decode_response(provider, payload, chunks)

    def claude(self, instruction, data):
        schema = _claude_schema(data.get("stage") if isinstance(data, dict) else None)
        self.reserve_drafting(1)
        payload = {"model": self.env["NEWS_CLAUDE_MODEL"], "max_tokens": 4500,
                   "temperature": 0, "system": instruction,
                   "messages": [{"role": "user", "content": json.dumps(data, ensure_ascii=False)}],
                   "output_config": {"format": {"type": "json_schema", "schema": schema}}}
        # Manual thinking uses a 2048-token target, not a strict thinking cap.
        # The 8000-token ceiling still bounds thinking plus final structured copy.
        # The decoder discards thinking/signatures; other overrides stay as-is.
        # https://platform.claude.com/docs/en/build-with-claude/extended-thinking#budget-rules-and-tuning
        if payload["model"] == "claude-sonnet-4-6":
            payload["stream"] = True
            payload["thinking"] = {"type": "enabled", "budget_tokens": 2048, "display": "omitted"}
            payload["output_config"]["effort"] = "medium"
            payload["max_tokens"] = 8000
            payload.pop("temperature")
        result = self._post("https://api.anthropic.com/v1/messages",
                            {"x-api-key": self.env.get("ANTHROPIC_API_KEY", ""),
                             "anthropic-version": "2023-06-01"}, payload, "claude")
        if result.get("stop_reason") != "end_turn":
            raise _claude_response_error("claude_incomplete", "final_stop_reason")
        text = "".join(part.get("text", "") for part in result.get("content", [])
                       if part.get("type") == "text")
        try:
            return shared.json_object(text)
        except shared.GenerationError as original:
            error = _claude_response_error("invalid_provider_json", "final_json")
            error.parser_text_characters = min(len(text), 1_000_000)
            cause = original.__cause__
            error.parser_json_failure = ("empty_text" if not text.strip() else
                "json_decode" if isinstance(cause, json.JSONDecodeError) else
                "non_object" if cause is None else "other")
            raise error from None

    def close(self):
        with self._lock:
            if self._closed:
                return
            self._closed = True
        try:
            self.session.close()
        except Exception:
            # Cleanup must not expose a transport exception or replace the
            # original safe generation outcome. This instance stays unusable.
            pass
        finally:
            self.env.clear()


def generate_website_edition(now=None, *, articles, source_window, providers=None, clock=time.time):
    """Generate from the frozen official snapshot; no discovery or legacy fallback.

    A supplied WebsiteProviders instance is consumed and closed by this call.
    The deadline is cooperative: a blocked OS call is not forcibly cancelled,
    but late results cannot begin another request or return a publishable issue.
    """
    if providers is not None and not isinstance(providers, WebsiteProviders):
        raise shared.GenerationError("generation_budget_required")
    provider = WebsiteProviders() if providers is None else providers
    provider._begin()
    try:
        provider._check()
        result = generate_isolated_edition(now, articles=articles, source_window=source_window,
                                           providers=provider, clock=clock)
        provider._check()
        return result
    finally:
        provider.close()

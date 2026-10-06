"""Website-only adapter for the source-isolated morning news producer.

Importing this module does not create an HTTP session or read credentials.
Each edition gets one bounded provider instance; the public digest schema and
the two independent final reviews are owned by the existing isolated producer.
"""
from collections import Counter
from collections.abc import Mapping
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

    def claude(self, instruction, data):
        self.reserve_drafting(1)
        return super().claude(instruction, data)

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

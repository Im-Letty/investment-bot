"""Local Codex writer, with the existing website editorial/publication gates.

This is an explicit local entry point. Importing it does not authenticate,
start a CLI process, read credentials, collect sources, or publish anything.
The Render worker must not receive a personal ChatGPT login or silently fall
back to another paid writer when local drafting is unavailable.
"""
from collections.abc import Mapping
import time

import daily_news_producer as shared
import website_news_producer as website
from codex_news_writer import CodexNewsWriter


CODEX_CALL_LIMIT = 8
REVIEW_HTTP_LIMIT = 5  # Existing Gemini 3 / OpenAI 2 ceilings, no Claude calls.
WRITING_SECONDS = 180


class CodexWebsiteProviders(website.WebsiteProviders):
    """Only the compatibility writer method changes; all checks stay shared."""

    def __init__(self, environ=None, session=None, *, writer=None):
        import os
        supplied = os.environ if environ is None else environ
        if not isinstance(supplied, Mapping):
            raise shared.GenerationError("generation_budget_required")
        # Do not retain the unused Claude key, even if the existing private
        # Keychain record still contains one for the separate LINE workflow.
        env = {key: supplied[key] for key in ("GEMINI_API_KEY", "OPENAI_API_KEY",
                    "NEWS_GEMINI_MODEL", "NEWS_OPENAI_MODEL") if key in supplied}
        super().__init__(environ=env, session=session)
        self._writer = writer if writer is not None else CodexNewsWriter()
        self._codex_calls = 0

    @property
    def codex_calls(self):
        with self._lock:
            return self._codex_calls

    def reserve_drafting(self, calls):
        """Reserve subscription writing and fresh reviews in separate budgets."""
        with self._lock:
            self._check()
            if type(calls) is not int or not 1 <= calls <= CODEX_CALL_LIMIT:
                raise shared.GenerationError("generation_budget_required")
            if (self._codex_calls + calls > CODEX_CALL_LIMIT
                    or sum(self._counts.values()) + 2 > REVIEW_HTTP_LIMIT
                    or any(self._counts[name] >= website.CALL_LIMITS[name]
                           for name in ("gemini", "openai"))):
                raise shared.GenerationError("generation_call_limit")

    def claude(self, instruction, data):
        # The shared isolated producer's method name is a compatibility seam,
        # not the invoked service. Pass its editorial instructions unchanged.
        self.reserve_drafting(1)
        with self._lock:
            self._check()
            if self._codex_calls >= CODEX_CALL_LIMIT:
                raise shared.GenerationError("generation_call_limit")
            self._codex_calls += 1  # Failures also consume the bounded allowance.
            remaining = self._deadline - time.monotonic()
        value = self._writer.write(instruction, data, timeout=min(WRITING_SECONDS, remaining))
        self._check()
        return value

    def _post(self, url, headers, payload, provider):
        if provider not in ("gemini", "openai"):
            raise shared.GenerationError("codex_paid_writer_disabled")
        with self._lock:
            self._check()
            if sum(self._counts.values()) >= REVIEW_HTTP_LIMIT:
                raise shared.GenerationError("generation_call_limit")
        return super()._post(url, headers, payload, provider)

    def close(self):
        try:
            self._writer.close()
        except Exception:
            # Cleanup must not expose a raw exception or obscure the original
            # drafting/review failure, just as in the shared website provider.
            pass
        finally:
            super().close()


def generate_codex_website_edition(now=None, *, articles, source_window,
                                 providers=None, clock=time.time):
    """Explicit opt-in to local Codex; both fresh API reviews are mandatory."""
    if providers is not None and not isinstance(providers, CodexWebsiteProviders):
        raise shared.GenerationError("generation_budget_required")
    provider = providers if providers is not None else CodexWebsiteProviders()
    return website.generate_website_edition(now, articles=articles,
                source_window=source_window, providers=provider, clock=clock)

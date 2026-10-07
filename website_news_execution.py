"""Choose the website writer without authenticating or starting any work.

The Codex role collects on the server and consumes reviewed editions produced
by the separate trusted runner. Personal ChatGPT auth is never sent to Render.
The separate LINE workflow continues to use its existing configuration.
"""
from collections.abc import Mapping
import os

import daily_news_producer as shared
import website_news_producer as website


def configuration(environ=None):
    env = os.environ if environ is None else environ
    if not isinstance(env, Mapping):
        env = {}
    writer = env.get("NEWS_WEBSITE_WRITER", "codex")
    if writer == "claude":
        return {**shared.configuration(env), "writer": "claude", "generation_owner": "local"}
    required = ("SUPABASE_URL", "SUPABASE_KEY")
    missing = [name for name in required if not env.get(name)]
    if writer != "codex":
        missing.append("NEWS_WEBSITE_WRITER")
    return {"enabled": env.get("DAILY_NEWS_ENABLED", "1") != "0",
            "configured": not missing, "missing": missing,
            "writer": "codex" if writer == "codex" else "invalid",
            "generation_owner": "external"}


def server_generator(config):
    # Explicit compatibility only: no exception or absent CLI may select this
    # branch. The Codex default deliberately has no server-side AI writer.
    if isinstance(config, Mapping) and config.get("writer") == "claude":
        return website.generate_website_edition
    return None


def configuration_metadata(environ=None):
    env = os.environ if environ is None else environ
    config = configuration(env)
    previous = website.configuration_metadata(env)
    if config["writer"] == "claude":
        return {**previous, "writer_provider": "claude_api", "generation_owner": "local"}
    reviews = {name: previous["models"][name] for name in ("gemini", "openai")}
    return {"generation_mode": website.GENERATION_MODE,
            "writer_provider": "codex_subscription" if config["writer"] == "codex" else "invalid",
            "generation_owner": "external", "models": {"writer": "codex_default", **reviews},
            "limits": {"codex_calls": 8, "provider_http_calls": {"gemini": 3, "openai": 2},
                       "total_http_calls": 5, "local_daily_attempts_default": 1,
                       "generation_seconds": website.GENERATION_SECONDS}}

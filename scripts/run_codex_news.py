"""Explicit live Mac worker: Codex drafts, review APIs check, storage hands off.

Without --run-live this script only checks configuration names, without reading
auth files, authenticating, collecting sources, running AI or writing storage.
--run-live can publish a reviewed edition through the shared private bucket.
Use only after the private end-to-end check and server cutover are approved.
The clock is always real; there is no simulated date, force or draft-upload flag.
"""
import argparse
from collections.abc import Mapping
from datetime import datetime
import json
import os
from pathlib import Path
import signal
import shutil
import sys
from threading import Event
import time

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from codex_website_producer import CodexWebsiteProviders, generate_codex_website_edition
from codex_news_writer import CodexNewsWriter
from daily_news_runtime import DailyNewsRuntime, SupabaseNewsStorage, StorageUnavailable, MAX_ATTEMPTS
from website_news import create_source_preparer
from mac_news_credentials import MacNewsCredentials, MacNewsCredentialsError
from news_cache import JST
from daily_news_producer import GenerationError


REQUIRED = ("SUPABASE_URL", "SUPABASE_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY")
APP_CODEX = "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"


def codex_executable(env):
    explicit = env.get("NEWS_CODEX_EXECUTABLE")
    candidate = explicit if explicit is not None else (
        shutil.which("codex", path=env.get("PATH", os.defpath)) or APP_CODEX)
    return candidate if (isinstance(candidate, str) and os.path.isabs(candidate)
                and "\x00" not in candidate and os.path.isfile(candidate)
                and os.access(candidate, os.X_OK)) else None


def configuration(environ=None, *, use_keychain=False, credentials=None):
    env = os.environ if environ is None else environ
    env = env if isinstance(env, Mapping) else {}
    saved = None
    if use_keychain:
        # This method requests item attributes only. A saved item is not proof
        # of valid credentials or a successful production connection.
        saved = (credentials or MacNewsCredentials()).status()
        missing = []
        for field, names in (("review_keys_saved", ("GEMINI_API_KEY", "OPENAI_API_KEY")),
                             ("storage_saved", ("SUPABASE_URL", "SUPABASE_KEY"))):
            if saved.get(field) is not True:
                missing.extend(names)
    else:
        missing = [name for name in REQUIRED if not env.get(name)]
    if codex_executable(env) is None:
        missing.append("CODEX_EXECUTABLE")
    value = {"writer_provider": "codex_subscription", "configured": not missing,
            "missing": missing, "enabled": env.get("DAILY_NEWS_ENABLED", "1") != "0",
            "schedule": "08:00 Asia/Tokyo", "preparation": "07:00 Asia/Tokyo",
            "source_cutoff": "07:30 Asia/Tokyo", "daily_attempts_default": 1,
            "publication_allowed": False, "credential_source": "mac_keychain" if use_keychain else "environment",
            "connection_checked": False}
    if saved is not None:
        value["saved_credentials"] = saved
    return value


def build_runtime(environ=None, *, storage=None, max_attempts=1,
                  cache_path="/tmp/kn-codex-news.json", use_keychain=False, credentials=None):
    env = os.environ if environ is None else environ
    credentials = credentials or (MacNewsCredentials() if use_keychain else None)
    settings = configuration(env, use_keychain=use_keychain, credentials=credentials)
    if not settings["configured"]:
        raise StorageUnavailable("codex_local_configuration")
    executable = codex_executable(env)
    if executable is None:
        raise StorageUnavailable("codex_local_configuration")
    # Retain only the two review API keys in this process closure; the Codex
    # child independently filters its environment and requires ChatGPT login.
    reviews = {name: env[name] for name in ("NEWS_GEMINI_MODEL", "NEWS_OPENAI_MODEL") if name in env}
    if use_keychain:
        pair = {}
        try:
            reviews.update(credentials.load_review_keys())
            pair = credentials.load_storage()
            if storage is None:
                storage = SupabaseNewsStorage(pair["SUPABASE_URL"], pair["SUPABASE_KEY"])
        except MacNewsCredentialsError:
            reviews.clear()
            raise StorageUnavailable("codex_local_configuration") from None
        finally:
            pair.clear()
    else:
        reviews.update({name: env[name] for name in ("GEMINI_API_KEY", "OPENAI_API_KEY")})
        if storage is None:
            storage = SupabaseNewsStorage(env["SUPABASE_URL"], env["SUPABASE_KEY"])

    def generate(now, *, articles, source_window):
        writer = CodexNewsWriter(executable=executable)
        provider = CodexWebsiteProviders(environ=reviews, writer=writer)
        return generate_codex_website_edition(now, articles=articles,
                    source_window=source_window, providers=provider)

    return DailyNewsRuntime(storage, generate, enabled=settings["enabled"],
               source_preparer=create_source_preparer(storage),
               generation_owner="local", max_attempts=max_attempts, cache_path=cache_path)


def safe_status(state):
    return {name: state[name] for name in ("status", "enabled", "edition_date", "attempt_count",
                "publish_at", "cutoff_at", "last_error") if name in state}


def preflight_subscription(environ=None):
    """Check the saved ChatGPT login without generating or claiming an issue."""
    env = os.environ if environ is None else environ
    executable = codex_executable(env)
    if executable is None:
        raise GenerationError("codex_writer_unavailable")
    with CodexNewsWriter(executable=executable, environ=env) as writer:
        writer.check_login()


def morning_end(now):
    """Real-clock morning service window, not a date override or backfill."""
    current = datetime.fromtimestamp(now, JST)
    start = current.replace(hour=6, minute=45, second=0, microsecond=0)
    end = current.replace(hour=8, minute=15, second=0, microsecond=0)
    return end.timestamp() if start <= current < end else None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-live", action="store_true",
                        help="explicitly permit review API charges and durable edition publication")
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--once", action="store_true", help="one real-clock publishing tick")
    modes.add_argument("--serve", action="store_true", help="keep collecting and checking every 30 seconds")
    parser.add_argument("--max-attempts", type=int, choices=range(1, MAX_ATTEMPTS + 1), default=1,
                        help="durable daily attempt ceiling, failures included; default one")
    parser.add_argument("--cache-path", default="/tmp/kn-codex-news.json")
    parser.add_argument("--use-keychain", action="store_true",
                        help="use the fixed saved Mac credentials, without exporting keys into the environment")
    parser.add_argument("--morning", action="store_true",
                        help="serve only in today's 06:45–08:15 JST window and stop at 08:15")
    args = parser.parse_args(argv)
    if not args.run_live:
        print(json.dumps(configuration(use_keychain=args.use_keychain), ensure_ascii=False))
        return 0
    if not (args.once or args.serve):
        parser.error("--run-live requires --once or --serve")
    if args.morning and not args.serve:
        parser.error("--morning requires --serve")
    end_at = morning_end(time.time()) if args.morning else None
    if args.morning and end_at is None:
        print(json.dumps({"status": "outside_morning_window", "publication_allowed": False}))
        return 2
    try:
        preflight_subscription()
        runtime = build_runtime(max_attempts=args.max_attempts, cache_path=args.cache_path,
                                use_keychain=args.use_keychain)
    except GenerationError:
        print(json.dumps({"status": "subscription_login_unavailable", "publication_allowed": False}))
        return 2
    except (StorageUnavailable, ValueError):
        print(json.dumps({"status": "configuration_unavailable", "publication_allowed": False}))
        return 2
    if args.once:
        result = safe_status(runtime.run_once())
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result.get("status") in ("ready", "prepared", "collecting", "waiting", "freezing",
                    "source_empty", "disabled") else 1
    stopped = Event()
    for name in (signal.SIGINT, signal.SIGTERM):
        signal.signal(name, lambda *_: stopped.set())
    previous = None
    try:
        while not stopped.is_set() and (end_at is None or time.time() < end_at):
            result = safe_status(runtime.run_once())
            if result != previous:
                print(json.dumps(result, ensure_ascii=False), flush=True)
                previous = result
            stopped.wait(30 if end_at is None else max(0, min(30, end_at - time.time())))
    finally:
        runtime.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

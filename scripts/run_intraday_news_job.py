"""Explicit private cloud entry point for independently reviewed daytime news.

Default only reports configuration names. --check-live refreshes unpaid official
originals and checks eligibility, with no writer/authentication or AI claim.
--run-live permits one bounded Codex draft, both review API charges and storage
publication. There is no date override, force-publication or paid retry option.
"""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import re
import sys
import time

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from intraday_news_runtime import JOB_SECONDS, MAX_ATTEMPTS, run_job as run_intraday
from news_cache import JST

REQUIRED = ("SUPABASE_URL", "SUPABASE_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY")


def configuration(environ=None, *, check_only=False):
    env = os.environ if environ is None else environ
    needed = REQUIRED[:2] if check_only else REQUIRED
    missing = [name for name in needed if not env.get(name)]
    return {"configured": not missing, "missing": missing,
            "enabled": env.get("NEWS_INTRADAY_ENABLED", "0") == "1",
            "writer_provider": "codex_subscription", "generation_owner": "external",
            "start_window": "09:00–23:00 Asia/Tokyo", "max_attempts": MAX_ATTEMPTS,
            "target_jpy": 10, "target_mode": "soft", "publication_allowed": False}


def _base(status, started, check_only):
    return {"schema_version": 1, "report_kind": "private_intraday_writer", "status": status,
            "edition_date": datetime.fromtimestamp(started, JST).date().isoformat(),
            "eligible_count": 0, "published_count": 0, "attempt_count": 0, "check_only": check_only}


def run_job(environ=None, *, check_only=False, clock=time.time, storage_factory=None,
            cache=None, writer_factory=None, preflight=None):
    env = os.environ if environ is None else environ
    started = clock()
    settings = configuration(env, check_only=check_only)
    if not settings["configured"]:
        return _base("configuration_unavailable", started, check_only)
    if not settings["enabled"]:
        return _base("disabled", started, check_only)
    expected = env.get("INTRADAY_EXPECTED_DAY")
    if expected is not None and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", expected):
        return _base("outside_intraday_window", started, check_only)
    storage, recorder = None, None
    from scripts.run_private_news_job import JobDeadline
    try:
        from daily_news_runtime import SupabaseNewsStorage
        factory = storage_factory if storage_factory is not None else SupabaseNewsStorage
        storage = factory(env["SUPABASE_URL"], env["SUPABASE_KEY"])
        if check_only:
            return run_intraday(storage, cache=cache, clock=clock, check_only=True, expected_day=expected)
        from codex_news_writer import CodexNewsWriter
        from codex_website_producer import CodexWebsiteProviders, generate_codex_website_edition
        from news_review_costs import ReviewUsageRecorder
        from scripts.run_codex_news import codex_executable, preflight_subscription
        executable = codex_executable(env)
        if executable is None and writer_factory is None:
            return _base("configuration_unavailable", started, False)
        recorder = ReviewUsageRecorder(storage, scope="economy", clock=clock)
        review_env = {key: env[key] for key in ("GEMINI_API_KEY", "OPENAI_API_KEY", "NEWS_GEMINI_MODEL",
                      "NEWS_OPENAI_MODEL") if key in env}

        def generate(now, *, articles, source_window):
            writer = writer_factory() if writer_factory is not None else CodexNewsWriter(executable=executable)
            provider = CodexWebsiteProviders(environ=review_env, writer=writer, usage_recorder=recorder)
            return generate_codex_website_edition(now, articles=articles, source_window=source_window,
                                                 providers=provider, clock=clock)

        result = run_intraday(storage, generate, cache=cache, clock=clock,
                     preflight=preflight if preflight is not None else lambda: preflight_subscription(env),
                     expected_day=expected)
    except JobDeadline:
        result = _base("job_deadline", started, check_only)
    except Exception:
        result = _base("job_unavailable", started, check_only)
    finally:
        if storage is not None:
            session = getattr(storage, "_session", None)
            if session is not None:
                try:
                    session.close()
                except Exception:
                    pass
    if recorder is not None:
        result["api_review_cost"] = recorder.safe_summary()
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--check-live", action="store_true")
    modes.add_argument("--run-live", action="store_true")
    parser.add_argument("--result-file")
    args = parser.parse_args(argv)
    if args.result_file and not (args.check_live or args.run_live):
        parser.error("--result-file requires --check-live or --run-live")
    if not (args.check_live or args.run_live):
        print(json.dumps(configuration(), ensure_ascii=False))
        return 0
    from scripts.run_private_news_job import JobDeadline, process_deadline, ResultFile, ResultFileUnavailable
    started, output = time.time(), None
    try:
        if args.result_file:
            output = ResultFile(args.result_file)
        with process_deadline(seconds=JOB_SECONDS):
            result = run_job(check_only=args.check_live)
    except JobDeadline:
        result = _base("job_deadline", started, args.check_live)
    except ResultFileUnavailable:
        result = _base("result_file_unavailable", started, args.check_live)
    except Exception:
        result = _base("job_unavailable", started, args.check_live)
    result["job_finished_at"] = datetime.now(JST).isoformat(timespec="seconds")
    try:
        if output is not None:
            output.write(result)
    except ResultFileUnavailable:
        result = _base("result_file_unavailable", started, args.check_live)
    finally:
        if output is not None:
            output.close()
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    return 0 if result["status"] in ("ready", "published", "no_new_release", "daily_limit", "outside_intraday_window", "disabled", "source_pending") else 1


if __name__ == "__main__":
    raise SystemExit(main())

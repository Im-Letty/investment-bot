"""Explicit private cloud entry point for independently reviewed daytime news.

Default only reports configuration names. --check-live refreshes unpaid official
originals and checks eligibility, with no writer/authentication or AI claim.
--run-live permits one bounded Codex draft, both review API charges and storage
publication. There is no date override, force-publication or paid retry option.
"""
import argparse
from collections.abc import Mapping
from datetime import datetime
import json
import math
import os
from pathlib import Path
import re
import sys
import time

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from intraday_news_runtime import JOB_SECONDS, MAX_ATTEMPTS, _safe_cache_reads, run_job as run_intraday
from news_cache import JST
from daily_news_runtime import GENERATION_ERRORS, StorageUnavailable, _safe_generation_error
from scripts.private_news_storage import PrivateNewsStorage

REQUIRED = ("SUPABASE_URL", "SUPABASE_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY")
CHECK_SECONDS = 180
PHASES = frozenset(("starting", "configuration", "storage_configuration", "storage_private_check",
    "source_collection", "source_snapshot", "source_validation", "published_history", "claim_validation",
    "candidate_selection", "subscription_login", "generation", "publication", "outcome", "completed"))
SAFE_ERROR_CODES = frozenset(("job_unavailable", "job_deadline", "storage_unavailable",
    "storage_configuration", "storage_budget", "storage_deadline", "storage_network", "storage_timeout",
    "storage_response", "storage_bucket", "storage_private_required", "storage_read", "storage_write",
    "storage_list", "storage_size", "storage_state", "storage_history_capacity",
    "invalid_source_cache_article", "invalid_source_cache_body", "invalid_source_cache_identity",
    "invalid_source_cache_version", "invalid_source_cache_verification", "invalid_source_cache_poll",
    "invalid_source_cache_index", "invalid_source_cache_configuration", "invalid_source_cache_time",
    "source_cache_read_deadline", "source_cache_capacity", "source_cache_index_unavailable",
    "source_cache_deadline", "source_unavailable", "intraday_claim_invalid", "intraday_review_receipt_required",
    "intraday_history_invalid", "intraday_history_deadline", "intraday_history_capacity"))


def _safe_error(error):
    code = str(error)
    if code in SAFE_ERROR_CODES or code in GENERATION_ERRORS:
        return code
    generated = _safe_generation_error(error)
    return generated if generated != "generation_failed" else "job_unavailable"


class IntradayProgress:
    """Fixed metadata survives a hard deadline without retaining raw errors."""

    def __init__(self):
        self.value = {"phase": "starting", "eligibility_checked": False,
                      "source_health_verified": False}

    def record(self, state):
        if not isinstance(state, dict):
            return
        phase = state.get("phase")
        if isinstance(phase, str) and phase in PHASES:
            self.value["phase"] = phase
        for key in ("eligibility_checked", "source_health_verified"):
            if type(state.get(key)) is bool:
                self.value[key] = state[key]
        for key, maximum in (("attempt_count", MAX_ATTEMPTS), ("eligible_count", 8), ("published_count", 1)):
            if type(state.get(key)) is int and 0 <= state[key] <= maximum:
                self.value[key] = state[key]
        if state.get("last_error") is not None:
            self.value["last_error"] = _safe_error(state["last_error"])
        if isinstance(state.get("source_cache_reads"), dict):
            self.value["source_cache_reads"] = _safe_cache_reads(state["source_cache_reads"])
        observations = state.get("source_cache_observations")
        if isinstance(observations, dict):
            self.value["source_cache_observations"] = {key: observations[key] for key in
                ("legacy_two_source_polls", "concurrent_read_records") if type(observations.get(key)) is int
                and 0 <= observations[key] <= 128}

    def fields(self):
        return dict(self.value)


def _number(value):
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 253402268399


def _cost(value):
    if not isinstance(value, dict):
        return None
    result = {}
    for key in ("target_jpy", "estimated_cost_usd", "estimated_cost_jpy", "usd_to_jpy",
                "request_count", "unknown_cost_count", "persistence_failures"):
        item = value.get(key)
        if _number(item) or isinstance(item, str) and re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", item):
            result[key] = item
    for key in ("persistence_complete", "estimate_complete", "scan_complete", "snapshot_guaranteed", "invoice_amount"):
        if type(value.get(key)) is bool:
            result[key] = value[key]
    for key, choices in {
        "status": ("checked", "incomplete", "cost_unavailable", "not_connected"),
        "scope": ("all", "economy", "company", "private_test"), "target_mode": ("soft",),
        "target_state": ("above_target", "within_target", "unknown"),
        "pricing_version": ("2026-10-11-text-standard",),
    }.items():
        if value.get(key) in choices:
            result[key] = value[key]
    return result


def safe_report(result, started, finished, check_only, progress=None):
    """Allow only fixed operational metadata, never arbitrary exception text."""
    statuses = frozenset(("ready", "published", "no_new_release", "daily_limit", "outside_intraday_window",
        "disabled", "source_pending", "source_unavailable", "storage_unavailable", "job_unavailable",
        "configuration_unavailable", "generation_window_exhausted", "review_failed", "publication_unconfirmed",
        "job_deadline", "result_file_unavailable", "job_deadline_unavailable"))
    result = result if isinstance(result, dict) else {}
    status = result.get("status")
    value = _base(status if isinstance(status, str) and status in statuses else "job_unavailable", started, check_only)
    edition = result.get("edition_date")
    if isinstance(edition, str):
        try:
            if datetime.fromisoformat(edition).date().isoformat() == edition:
                value["edition_date"] = edition
        except ValueError:
            pass
    progress = progress if isinstance(progress, IntradayProgress) else IntradayProgress()
    progress.record(result)
    value.update(progress.fields())
    for key, maximum in (("eligible_count", 8), ("published_count", 1), ("attempt_count", MAX_ATTEMPTS),
                         ("source_article_count", 8)):
        if type(result.get(key)) is int and 0 <= result[key] <= maximum:
            value[key] = result[key]
    for key in ("source_checked_at", "reviewed_at", "publish_at", "publication_attempted_at"):
        if _number(result.get(key)):
            value[key] = result[key]
    for key in ("article_id", "source_body_sha256"):
        if isinstance(result.get(key), str) and re.fullmatch(r"[0-9a-f]{64}", result[key]):
            value[key] = result[key]
    for key, choices in (("source_precision", ("day", "second")),
                         ("category", ("fiscal_policy", "economic_statistics", "monetary_policy"))):
        if result.get(key) in choices:
            value[key] = result[key]
    if isinstance(result.get("source_date_counts"), dict):
        value["source_date_counts"] = {day: count for day, count in result["source_date_counts"].items()
            if isinstance(day, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", day)
            and type(count) is int and 0 <= count <= 8}
    if isinstance(result.get("source_status"), dict):
        from scripts.run_private_news_job import _safe_source_diagnostics
        value["source_status"] = _safe_source_diagnostics(result["source_status"])
    receipt = result.get("review_receipt")
    if isinstance(receipt, dict):
        clean = {}
        for key in ("content_sha256", "review_payload_sha256"):
            if isinstance(receipt.get(key), str) and re.fullmatch(r"[0-9a-f]{64}", receipt[key]):
                clean[key] = receipt[key]
        for key in ("gemini_approved", "openai_approved"):
            if type(receipt.get(key)) is bool:
                clean[key] = receipt[key]
        if _number(receipt.get("reviewed_at")):
            clean["reviewed_at"] = receipt["reviewed_at"]
        hashes = receipt.get("source_body_sha256")
        if isinstance(hashes, list) and len(hashes) <= 8 and all(
                isinstance(item, str) and re.fullmatch(r"[0-9a-f]{64}", item) for item in hashes):
            clean["source_body_sha256"] = list(hashes)
        value["review_receipt"] = clean
    if "api_review_cost" in result:
        value["api_review_cost"] = _cost(result["api_review_cost"])
    if result.get("last_error") is not None:
        value["last_error"] = _safe_error(result["last_error"])
    value["job_started_at"] = datetime.fromtimestamp(started, JST).isoformat(timespec="seconds")
    original_start = result.get("job_started_at")
    if isinstance(original_start, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}", original_start):
        value["job_started_at"] = original_start
    value["job_finished_at"] = datetime.fromtimestamp(finished, JST).isoformat(timespec="seconds")
    return value


def configuration(environ=None, *, check_only=False):
    env = os.environ if environ is None else environ
    env = env if isinstance(env, Mapping) else {}
    needed = REQUIRED[:2] if check_only else REQUIRED
    missing = [name for name in needed if not env.get(name)]
    return {"configured": not missing, "missing": missing,
            "enabled": env.get("NEWS_INTRADAY_ENABLED", "0") == "1",
            "writer_provider": "codex_subscription", "generation_owner": "external",
            "start_window": "09:00–23:00 Asia/Tokyo", "max_attempts": MAX_ATTEMPTS,
            "check_seconds": CHECK_SECONDS,
            "target_jpy": 10, "target_mode": "soft", "publication_allowed": False}


def _base(status, started, check_only):
    return {"schema_version": 1, "report_kind": "private_intraday_writer", "status": status,
            "edition_date": datetime.fromtimestamp(started, JST).date().isoformat(),
            "eligible_count": 0, "published_count": 0, "attempt_count": 0, "check_only": check_only}


def run_job(environ=None, *, check_only=False, clock=time.time, storage_factory=None,
            cache=None, writer_factory=None, preflight=None, monotonic=time.monotonic, progress=None):
    env = os.environ if environ is None else environ
    env = env if isinstance(env, Mapping) else {}
    progress = progress if isinstance(progress, IntradayProgress) else IntradayProgress()
    started = clock()
    mono_started = monotonic()
    progress.value["phase"] = "configuration"
    settings = configuration(env, check_only=check_only)
    if not settings["configured"]:
        return {**_base("configuration_unavailable", started, check_only), **progress.fields()}
    if not settings["enabled"]:
        return {**_base("disabled", started, check_only), **progress.fields()}
    expected = env.get("INTRADAY_EXPECTED_DAY")
    if expected is not None and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", expected):
        return {**_base("outside_intraday_window", started, check_only), **progress.fields()}
    storage, recorder = None, None
    from scripts.run_private_news_job import JobDeadline
    try:
        progress.value["phase"] = "storage_configuration"
        if storage_factory is None:
            allowance = CHECK_SECONDS if check_only else JOB_SECONDS
            storage = PrivateNewsStorage(env["SUPABASE_URL"], env["SUPABASE_KEY"],
                deadline=mono_started + allowance, phase="source_preparation", clock=monotonic)
        else:
            # Existing explicit fake factories remain two-argument injections.
            storage = storage_factory(env["SUPABASE_URL"], env["SUPABASE_KEY"])
        if check_only:
            result = run_intraday(storage, cache=cache, clock=clock, check_only=True,
                                  expected_day=expected, progress=progress.record)
        else:
            from codex_news_writer import CodexNewsWriter
            from codex_website_producer import CodexWebsiteProviders, generate_codex_website_edition
            from news_review_costs import ReviewUsageRecorder
            from scripts.run_codex_news import codex_executable, preflight_subscription
            executable = codex_executable(env)
            if executable is None and writer_factory is None:
                return {**_base("configuration_unavailable", started, False), **progress.fields()}
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
                         expected_day=expected, progress=progress.record)
    except JobDeadline:
        progress.value["last_error"] = "job_deadline"
        result = {**_base("job_deadline", started, check_only), **progress.fields()}
    except StorageUnavailable as error:
        progress.value["last_error"] = _safe_error(error)
        result = {**_base("storage_unavailable", started, check_only), **progress.fields()}
    except Exception as error:
        progress.value["last_error"] = _safe_error(error)
        result = {**_base("job_unavailable", started, check_only), **progress.fields()}
    finally:
        if storage is not None:
            session = getattr(storage, "_session", None)
            if session is not None:
                try:
                    session.close()
                except Exception:
                    pass
    progress.record(result)
    result.update(progress.fields())
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
    from scripts.run_private_news_job import (JobDeadline, DeadlineUnavailable, process_deadline,
                                              ResultFile, ResultFileUnavailable)
    started, output, progress = time.time(), None, IntradayProgress()
    try:
        if args.result_file:
            output = ResultFile(args.result_file)
        with process_deadline(seconds=CHECK_SECONDS if args.check_live else JOB_SECONDS):
            result = run_job(check_only=args.check_live, progress=progress)
    except JobDeadline:
        result = {**_base("job_deadline", started, args.check_live), **progress.fields(),
                  "last_error": "job_deadline"}
    except DeadlineUnavailable:
        result = {**_base("job_deadline_unavailable", started, args.check_live), **progress.fields()}
    except ResultFileUnavailable:
        result = _base("result_file_unavailable", started, args.check_live)
    except Exception as error:
        result = {**_base("job_unavailable", started, args.check_live), **progress.fields(),
                  "last_error": _safe_error(error)}
    result = safe_report(result, started, time.time(), args.check_live, progress)
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

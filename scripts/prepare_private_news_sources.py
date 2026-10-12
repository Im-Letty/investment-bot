"""Explicit unpaid private-CI source acquisition; default execution performs no I/O.

The actual clock alone selects today's morning edition. This step can continue
after 08:00, records actual verification/freeze times and never creates a paid
generation claim, restores a Codex session, calls AI or publishes an edition.
"""
import argparse
from collections.abc import Mapping
from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import sys
import time

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from daily_news_runtime import StorageUnavailable, _valid_issue
from morning_news_window import (JST, MAX_ARTICLES, MorningNewsPreparer, morning_window,
    manifest_window, healthy_empty_manifest, read_prepared_manifest)
from news_cache import load_reviewed_digests
from scripts.private_news_storage import PrivateNewsStorage
from scripts.run_private_news_job import (ResultFile, ResultFileUnavailable, JobDeadline, DeadlineUnavailable,
                                         process_deadline, _safe_source_diagnostics)
from website_news import collect_website_sources

WAIT_SECONDS = 30 * 60
OPERATION_SECONDS = 5 * 60
MAX_SECONDS = WAIT_SECONDS + OPERATION_SECONDS
POLL_SECONDS = 10
STATUSES = frozenset(("prepared", "source_empty", "configuration_unavailable", "disabled",
    "outside_morning_window", "source_unavailable", "source_collection_limit", "source_preparation_deadline",
    "invalid_source_manifest", "invalid_source_snapshot", "storage_unavailable", "source_preparation_unavailable",
    "result_file_unavailable", "job_deadline_unavailable"))


def configuration(environ=None):
    env = os.environ if environ is None else environ
    env = env if isinstance(env, Mapping) else {}
    missing = [key for key in ("SUPABASE_URL", "SUPABASE_KEY") if not env.get(key)]
    return {"configured": not missing, "missing": missing,
            "enabled": env.get("DAILY_NEWS_ENABLED", "1") != "0",
            "source_cutoff": "07:30 Asia/Tokyo", "publication_target": "08:00 Asia/Tokyo",
            "start_window": "07:00–23:00 Asia/Tokyo", "max_seconds": MAX_SECONDS,
            "ai_allowed": False, "publication_allowed": False}


def _budget(now):
    current = datetime.fromtimestamp(now, JST)
    if not 7 <= current.hour < 23:
        return None
    midnight = current.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    wait = min(WAIT_SECONDS, max(0, morning_window(now)["cutoff_at"] - now))
    return min(wait + OPERATION_SECONDS, midnight.timestamp() - now)


def _history(storage, now):
    """Three real calendar days cover every eligible morning/deferred identity."""
    current = datetime.fromtimestamp(now, JST).date()
    issues = load_reviewed_digests()
    for offset in range(3):
        day = (current - timedelta(days=offset)).isoformat()
        keys = storage.reviewed_keys(day)
        if not isinstance(keys, list) or len(keys) >= 30:
            raise StorageUnavailable("storage_history_capacity")
        for path in [f"days/{day}/edition.json"] + sorted(keys):
            value = storage.read(path)
            if value is not None:
                issues.append(_valid_issue(value, now, edition=day))
    return issues


def _outcome(status, *, now=None, manifest=None, phase="source_preparation"):
    status = status if status in STATUSES else "source_preparation_unavailable"
    value = {"schema_version": 1, "status": status, "success": status in ("prepared", "source_empty"),
             "phase": phase, "ai_attempt_count": 0, "published_count": 0,
             "source_article_count": 0, "finished_at": now}
    if now is not None:
        value["edition_date"] = morning_window(now)["edition_date"]
    if manifest is not None:
        window = manifest_window(manifest, now)
        value["source_window"] = window
        value["source_status"] = _safe_source_diagnostics(manifest.get("source_status"))
        rows = manifest["articles"]
        value["source_article_count"] = len(rows)
        counts = {}
        for row in rows:
            counts[row["published_date"]] = counts.get(row["published_date"], 0) + 1
        value["source_date_counts"] = counts
        value["source_body_sha256"] = [row["body_sha256"] for row in rows]
    return value


def run_once(*, environ=None, wall_clock=time.time, monotonic=time.monotonic,
             sleep=time.sleep, storage_factory=PrivateNewsStorage, collector=collect_website_sources):
    env = os.environ if environ is None else environ
    env = env if isinstance(env, Mapping) else {}
    started = wall_clock()
    allowance = _budget(started)
    if allowance is None:
        return _outcome("outside_morning_window", now=started)
    settings = configuration(env)
    if not settings["configured"] or not settings["enabled"]:
        return _outcome("configuration_unavailable" if not settings["configured"] else "disabled", now=started)
    day, cutoff = morning_window(started)["edition_date"], morning_window(started)["cutoff_at"]
    expiry = monotonic() + allowance
    operation_started = False
    try:
        storage = storage_factory(env["SUPABASE_URL"], env["SUPABASE_KEY"], deadline=expiry,
                                  phase="source_preparation", clock=monotonic)
        storage.set_phase_deadline(expiry, phase="source_preparation")
        # Verify the already private bucket, without creating it or changing its
        # visibility. Every storage request has the caller's monotonic expiry.
        storage.check_private()
        preparer = MorningNewsPreparer(storage, collector, clock=wall_clock)
        while monotonic() < expiry:
            now = wall_clock()
            if morning_window(now)["edition_date"] != day:
                return _outcome("source_preparation_deadline", now=now)
            if now < cutoff:
                preparer.prepare(now)
            else:
                if not operation_started:
                    expiry = min(expiry, monotonic() + OPERATION_SECONDS)
                    storage.set_phase_deadline(expiry, phase="source_preparation")
                    operation_started = True
                manifest = read_prepared_manifest(storage, now)
                if manifest is None:
                    history = _history(storage, now)
                    manifest = preparer.prepare(now, history)
                    if manifest is not None and (manifest["articles"] or healthy_empty_manifest(manifest)):
                        return _outcome("prepared" if manifest["articles"] else "source_empty",
                                        now=wall_clock(), manifest=manifest)
                    manifest = preparer.prepare_recovery(wall_clock(), history)
                if manifest is not None:
                    return _outcome("prepared" if manifest["articles"] else "source_empty",
                                    now=wall_clock(), manifest=manifest)
            pause = min(POLL_SECONDS, max(0, expiry - monotonic()))
            if pause:
                sleep(pause)
        return _outcome("source_preparation_deadline", now=wall_clock())
    except StorageUnavailable:
        return _outcome("storage_unavailable", now=wall_clock())
    except ValueError as error:
        return _outcome(str(error), now=wall_clock())
    except Exception:
        return _outcome("source_preparation_unavailable", now=wall_clock())


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-live", action="store_true", help="permit bounded unpaid collection and private source storage")
    parser.add_argument("--result-file", help="write a fixed safe result to a new file")
    args = parser.parse_args(argv)
    if args.result_file and not args.run_live:
        parser.error("--result-file requires --run-live")
    if not args.run_live:
        print(json.dumps(configuration(), ensure_ascii=False))
        return 0
    report_file = None
    try:
        if args.result_file:
            report_file = ResultFile(args.result_file)
        now = time.time()
        allowance = _budget(now)
        if allowance is None:
            result = _outcome("outside_morning_window", now=now)
        else:
            with process_deadline(seconds=allowance):
                result = run_once()
        if report_file is not None:
            report_file.write(result)
    except JobDeadline:
        result = _outcome("source_preparation_deadline", now=time.time())
        if report_file is not None:
            report_file.write(result)
    except ResultFileUnavailable:
        result = _outcome("result_file_unavailable", now=time.time())
    except DeadlineUnavailable:
        result = _outcome("job_deadline_unavailable", now=time.time())
        if report_file is not None:
            report_file.write(result)
    finally:
        if report_file is not None:
            report_file.close()
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    return 0 if result["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

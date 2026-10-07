"""One bounded morning writer job for a private, trusted CI environment.

Default execution only reports configuration names. --run-live explicitly
permits Codex subscription use, both review API charges and durable publication.
Render collects and freezes the originals; this job never collects or freezes
them. The job may prepare an edition before 08:00, while the existing runtime
owns its actual publication time. There is no date, force or retry override.
"""
import argparse
from collections.abc import Mapping
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime
import json
import math
import os
from pathlib import Path
import signal
import sys
from tempfile import TemporaryDirectory
import threading
import time

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from daily_news_producer import GenerationError
from daily_news_runtime import StorageUnavailable, SupabaseNewsStorage, _safe_generation_error
from morning_news_window import MorningNewsPreparer, morning_window
from news_cache import JST, OFFICIAL_NEWS_SOURCES
from scripts.run_codex_news import build_runtime, configuration, preflight_subscription
from website_news_producer import GENERATION_SECONDS


JOB_SECONDS = 35 * 60
POLL_SECONDS = 30
# Preserve time for runtime's storage/history checks and its 16-minute claim
# lease. A late manifest must not start work with only a few seconds remaining.
GENERATION_RESERVE_SECONDS = GENERATION_SECONDS + 4 * 60
START_MINUTE = 7 * 60
LAST_START_MINUTE = 8 * 60
END_MINUTE = 8 * 60 + 15
_RUNTIME_STATUSES = frozenset(("ready", "prepared", "collecting", "waiting", "freezing",
    "waiting_for_writer", "source_empty", "source_unavailable", "daily_limit", "disabled",
    "generation_failed", "invalid_edition", "storage_unavailable", "cache_unavailable",
    "unavailable", "configuration_unavailable", "generating", "starting"))


class JobDeadline(BaseException):
    """Bypass runtime's broad Exception guards when the process budget expires."""


class DeadlineUnavailable(RuntimeError):
    pass


def _number(value):
    return type(value) in (int, float) and math.isfinite(value)


def _morning(now):
    if not _number(now):
        return None
    current = datetime.fromtimestamp(now, JST)
    minute = current.hour * 60 + current.minute
    if not START_MINUTE <= minute < LAST_START_MINUTE:
        return None
    return morning_window(now), current.replace(hour=8, minute=15, second=0, microsecond=0).timestamp()


@contextmanager
def process_deadline(*, seconds=JOB_SECONDS, monotonic=time.monotonic):
    """POSIX CI process bound, in addition to cooperative monotonic checks.

The signal exception is deliberately not caught by DailyNewsRuntime. Existing
Codex process-tree cleanup still runs when an in-flight call is interrupted.
This runner requires a main-thread POSIX process; it never silently runs without
the outer bound on an unsupported platform or over an existing alarm.
"""
    if (not _number(seconds) or not 0 < seconds <= JOB_SECONDS
            or threading.current_thread() is not threading.main_thread()
            or not all(hasattr(signal, name) for name in ("SIGALRM", "ITIMER_REAL", "setitimer", "getitimer"))):
        raise DeadlineUnavailable("job_deadline_unavailable")
    previous_timer = signal.getitimer(signal.ITIMER_REAL)
    if previous_timer != (0.0, 0.0):
        raise DeadlineUnavailable("job_deadline_unavailable")
    previous_handler = signal.getsignal(signal.SIGALRM)
    expires = monotonic() + seconds

    def expired(*_):
        raise JobDeadline()

    signal.signal(signal.SIGALRM, expired)
    try:
        signal.setitimer(signal.ITIMER_REAL, max(0.001, expires - monotonic()))
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)


class FrozenSources:
    """Immutable validated input, with no collector or storage-write path."""

    def __init__(self, manifest, window):
        MorningNewsPreparer._validate_manifest(manifest, window)
        self._manifest, self._window = deepcopy(manifest), dict(window)

    def prepare(self, now, published_issues=()):
        if morning_window(now) != self._window or now < self._window["cutoff_at"]:
            raise ValueError("invalid_source_manifest")
        return deepcopy(self._manifest)


def healthy_empty(manifest):
    """Only all enabled official sources, plus any diagnostics, can prove quiet."""
    if not isinstance(manifest, dict) or manifest.get("articles") != []:
        return False
    rows = manifest.get("source_status")
    return (isinstance(rows, dict) and set(OFFICIAL_NEWS_SOURCES).issubset(rows)
            and all(isinstance(row, dict) and row.get("feed_status") == "ok"
                    and row.get("status") in ("collected", "no_matching_candidates")
                    and row.get("errors", []) == []
                    for row in rows.values()))


def _outcome(status, day=None, *, success=False, state=None):
    value = {"status": status, "success": success}
    if day is not None:
        value["edition_date"] = day
    if isinstance(state, dict):
        count = state.get("attempt_count")
        if type(count) is int and 0 <= count <= 6:
            value["attempt_count"] = count
        publish = state.get("publish_at")
        if _number(publish):
            value["publish_at"] = publish
        if state.get("last_error") is not None:
            value["last_error"] = _safe_generation_error(state["last_error"])
    return value


def run_job(environ=None, *, wall_clock=time.time, monotonic=time.monotonic, sleep=time.sleep,
            storage_factory=SupabaseNewsStorage, runtime_factory=build_runtime,
            preflight=preflight_subscription):
    """Run once against today's frozen input; injectable transports are for tests.

The CLI adds process_deadline around this function. All clocks below are real
by default; injections are deliberately unavailable as command-line options.
Waiting uses only authenticated object reads, never ensure_private / create /
source preparation. Exactly one synchronous publishing tick follows readiness.
"""
    env = os.environ if environ is None else environ
    env = env if isinstance(env, Mapping) else {}
    started, mono_started = wall_clock(), monotonic()
    morning = _morning(started)
    if morning is None:
        return _outcome("outside_morning_window")
    window, end_at = morning
    day, deadline = window["edition_date"], mono_started + JOB_SECONDS
    settings = configuration(env)
    if not settings["configured"]:
        return _outcome("configuration_unavailable", day)
    if not settings["enabled"]:
        return _outcome("disabled", day)

    def remaining():
        now = wall_clock()
        if (not _number(now) or morning_window(now)["edition_date"] != day or now >= end_at):
            return 0
        return max(0, min(deadline - monotonic(), end_at - now))

    runtime = None
    try:
        preflight(env)  # Readonly ChatGPT login status, once before any daily claim.
        if remaining() <= 0:
            return _outcome("job_deadline", day)
        storage = storage_factory(env["SUPABASE_URL"], env["SUPABASE_KEY"])
        path = f"days/{day}/preparation/manifest.json"
        manifest = None
        while remaining() > 0:
            now = wall_clock()
            if now >= window["cutoff_at"]:
                manifest = storage.read(path)
                if manifest is not None:
                    break
            pause = min(POLL_SECONDS, remaining())
            if pause <= 0:
                break
            sleep(pause)
        if remaining() <= 0:
            return _outcome("job_deadline", day)
        if manifest is None:
            return _outcome("manifest_unavailable", day)
        try:
            frozen = FrozenSources(manifest, window)
        except (ValueError, TypeError, OverflowError):
            return _outcome("invalid_source_manifest", day)
        if not manifest["articles"] and not healthy_empty(manifest):
            return _outcome("source_unavailable", day)
        if manifest["articles"] and remaining() < GENERATION_RESERVE_SECONDS:
            return _outcome("generation_window_exhausted", day)
        # Cache contains reviewed copy only, never credentials or raw originals.
        with TemporaryDirectory(prefix="kn-private-news-job-") as folder:
            runtime = runtime_factory(env, storage=storage, max_attempts=1,
                        cache_path=str(Path(folder) / "reviewed.json"))
            runtime.source_preparer = frozen
            state = runtime.run_once()
            if remaining() <= 0:
                return _outcome("job_deadline", day, state=state)
            status = state.get("status") if isinstance(state, dict) else None
            status = status if status in _RUNTIME_STATUSES else "unavailable"
            release = window["cutoff_at"] + 30 * 60
            now = wall_clock()
            published = state.get("publish_at") if isinstance(state, dict) else None
            same_day = isinstance(state, dict) and state.get("edition_date") == day
            success = bool(same_day and (
                status == "source_empty" and healthy_empty(manifest)
                or status in ("ready", "prepared") and _number(published) and published >= release
                and ((status == "prepared" and published > now) or (status == "ready" and published <= now))))
            return _outcome(status, day, success=success, state=state)
    except GenerationError:
        return _outcome("subscription_login_unavailable", day)
    except StorageUnavailable:
        return _outcome("storage_unavailable", day)
    except Exception:
        # No upstream response, source body, credential or exception is printed.
        return _outcome("job_unavailable", day)
    finally:
        if runtime is not None:
            try:
                runtime.stop()
            except Exception:
                pass


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-live", action="store_true",
                        help="permit one durable daily attempt and review API charges")
    args = parser.parse_args(argv)
    if not args.run_live:
        settings = configuration()
        settings.update(job_seconds=JOB_SECONDS, generation_seconds=GENERATION_SECONDS,
                        generation_attempts=1, start_window="07:00–08:00 Asia/Tokyo",
                        stop_by="08:15 Asia/Tokyo", source_collection_allowed=False)
        print(json.dumps(settings, ensure_ascii=False))
        return 0
    try:
        now = time.time()
        morning = _morning(now)
        budget = min(JOB_SECONDS, morning[1] - now) if morning is not None else JOB_SECONDS
        with process_deadline(seconds=budget):
            result = run_job()
    except JobDeadline:
        result = _outcome("job_deadline")
    except DeadlineUnavailable:
        result = _outcome("job_deadline_unavailable")
    except Exception:
        result = _outcome("job_unavailable")
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    return 0 if result["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

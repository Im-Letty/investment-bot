"""One bounded morning writer job for a private, trusted CI environment.

Default execution only reports configuration names. --run-live explicitly
permits one publishing tick within the durable daily attempt limit, Codex
subscription use, both review API charges and durable publication.
The unpaid private preparation step collects and freezes originals before this
writer starts; this writer never fetches source bodies. It may prepare an
edition before 08:00, while the existing runtime
owns its actual publication time. There is no date, force or retry override.
"""
import argparse
from collections.abc import Mapping
from contextlib import contextmanager
from copy import deepcopy
from datetime import date, datetime, timedelta
import json
import math
import os
from pathlib import Path
import signal
import sys
from tempfile import TemporaryDirectory
import threading
import time
import uuid

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from daily_news_producer import GenerationError
from daily_news_runtime import MAX_ATTEMPTS, StorageUnavailable, _safe_generation_error
from news_review_diagnostics import safe_editorial_review_diagnostics
from morning_news_window import MAX_ARTICLES, MorningNewsPreparer, morning_window, manifest_window
from news_cache import JST, OFFICIAL_NEWS_SOURCES
from scripts.run_codex_news import build_runtime, configuration, preflight_subscription
from scripts.private_news_storage import PrivateNewsStorage
from website_news_producer import GENERATION_SECONDS


# Waiting for 07:30 is not part of the writer's processing allowance. The
# complete CI step is still bounded, independently of the 08:00 release target.
WAIT_SECONDS = 30 * 60
PROCESSING_SECONDS = 45 * 60
GENERATION_JOB_SECONDS = 35 * 60
JOB_SECONDS = WAIT_SECONDS + PROCESSING_SECONDS
POLL_SECONDS = 30
# A private source-preparation step now owns collection and freezing. Waiting
# for its durable handoff must not spend the writer's processing allowance.
MANIFEST_WAIT_SECONDS = 5 * 60
# Preserve time for runtime's storage/history checks and its 16-minute claim
# lease. A late manifest must not start work with only a few seconds remaining.
GENERATION_RESERVE_SECONDS = GENERATION_SECONDS + 4 * 60
START_MINUTE = 7 * 60
LAST_START_MINUTE = 23 * 60
_RUNTIME_STATUSES = frozenset(("ready", "prepared", "collecting", "waiting", "freezing",
    "waiting_for_writer", "source_empty", "source_unavailable", "daily_limit", "disabled",
    "generation_failed", "invalid_edition", "storage_unavailable", "cache_unavailable",
    "unavailable", "configuration_unavailable", "generating", "starting"))
_JOB_STATUSES = _RUNTIME_STATUSES | frozenset(("outside_morning_window", "job_deadline",
    "manifest_unavailable", "invalid_source_manifest", "generation_window_exhausted",
    "subscription_login_unavailable", "job_unavailable", "job_deadline_unavailable",
    "result_file_unavailable"))
_SOURCE_FEED_STATUSES = frozenset(("ok", "failed", "not_completed"))
_SOURCE_STATUSES = frozenset(("fetch_incomplete", "feed_failed", "no_matching_candidates",
    "collected", "collected_partial", "articles_unavailable"))
_SOURCE_ERROR_CODES = frozenset(("unapproved_source", "source_time_limit", "unapproved_redirect",
    "source_unavailable", "source_content_type", "source_size_limit", "source_size_or_time_limit",
    "source_redirect_limit", "invalid_source_bytes", "unsupported_source_encoding",
    "unsupported_feed_declaration", "unsupported_feed_structure", "invalid_verification_clock",
    "supporting_pdf_link_missing", "supporting_pdf_identity_mismatch", "pdf_invalid",
    "pdf_parser_unavailable", "pdf_encrypted", "pdf_extraction_forbidden", "pdf_page_limit",
    "pdf_unreadable_page", "pdf_text_limit", "pdf_parse_failed", "pdf_time_limit",
    "boj_policy_facts_unverified",
    "source_read_failed", "body_or_date_unverified"))
# Match the collector's current bounds without allowing upstream configuration
# to expand the private report's schema or reflect untrusted source values.
_SOURCE_COUNT_LIMITS = {"candidates": 120, "selected": 20, "completed": 20,
    "accepted": 20, "returned": MAX_ARTICLES}
_PHASES = frozenset(("starting", "configuration", "subscription_login", "manifest_wait",
    "manifest_validation", "runtime_startup", "generation", "outcome", "completed"))
_MANIFEST_STATES = frozenset(("not_checked", "missing", "present", "invalid"))


class JobProgress:
    """Fixed progress metadata retained even when SIGALRM interrupts the job."""

    def __init__(self):
        self.phase = "starting"
        self.manifest_state = "not_checked"
        self.manifest_reads = 0
        self.manifest_version = None
        self.runtime_status = None
        self.attempt_count = None
        self.editorial_review_diagnostics = None

    def runtime(self, state):
        if not isinstance(state, dict):
            return
        status = state.get("status")
        if isinstance(status, str) and status in _RUNTIME_STATUSES:
            self.runtime_status = status
        count = state.get("attempt_count")
        if type(count) is int and 0 <= count <= 6:
            self.attempt_count = count
        self.editorial_review_diagnostics = safe_editorial_review_diagnostics(
            state.get("editorial_review_diagnostics")
            if state.get("last_error") == "isolated_editorial_review_failed" else None)

    def fields(self):
        value = {"phase": self.phase if self.phase in _PHASES else "starting",
                 "manifest_state": self.manifest_state if self.manifest_state in _MANIFEST_STATES else "not_checked",
                 "manifest_reads": min(1000, max(0, self.manifest_reads))}
        if self.manifest_version in (1, 3):
            value["manifest_version"] = self.manifest_version
        if self.runtime_status is not None:
            value["runtime_status"] = self.runtime_status
        if self.attempt_count is not None:
            value["attempt_count"] = self.attempt_count
        if self.editorial_review_diagnostics is not None:
            value["editorial_review_diagnostics"] = safe_editorial_review_diagnostics(self.editorial_review_diagnostics)
        return value


class ResultFileUnavailable(RuntimeError):
    """Contains no path, upstream response or credential."""


class ResultFile:
    """Publish one complete report without replacing files or following symlinks."""

    def __init__(self, path):
        self._directory = None
        try:
            target = Path(os.path.abspath(os.fspath(path)))
            if not target.name:
                raise ResultFileUnavailable()
            flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
            directory = os.open(target.anchor, flags)
            try:
                for part in target.parts[1:-1]:
                    child = os.open(part, flags, dir_fd=directory)
                    os.close(directory)
                    directory = child
                try:
                    os.stat(target.name, dir_fd=directory, follow_symlinks=False)
                except FileNotFoundError:
                    pass
                else:
                    raise ResultFileUnavailable()
                self._directory, self._name = directory, target.name
                directory = None
            finally:
                if directory is not None:
                    os.close(directory)
        except (OSError, ValueError, TypeError):
            raise ResultFileUnavailable() from None

    def write(self, report):
        staged = ".morning-report-" + uuid.uuid4().hex + ".tmp"
        created = False
        try:
            payload = (json.dumps(report, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")
            if len(payload) > 8192:
                raise ResultFileUnavailable()
            fd = os.open(staged, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o600, dir_fd=self._directory)
            created = True
            with os.fdopen(fd, "wb") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            # link publishes the finished file atomically and refuses any
            # existing destination, including a dangling symlink or a race.
            os.link(staged, self._name, src_dir_fd=self._directory,
                    dst_dir_fd=self._directory, follow_symlinks=False)
        except (OSError, ValueError, TypeError):
            raise ResultFileUnavailable() from None
        finally:
            if created:
                try:
                    os.unlink(staged, dir_fd=self._directory)
                except OSError:
                    raise ResultFileUnavailable() from None

    def close(self):
        if self._directory is not None:
            os.close(self._directory)
            self._directory = None


def _safe_day(value):
    try:
        return value if isinstance(value, str) and date.fromisoformat(value).isoformat() == value else None
    except ValueError:
        return None


def _safe_source_diagnostics(value):
    """Only enabled source names, fixed enums and bounded integer counts."""
    value = value if isinstance(value, dict) else {}
    result = {}
    for source in OFFICIAL_NEWS_SOURCES:
        row = value.get(source)
        row = row if isinstance(row, dict) else {}
        feed, status = row.get("feed_status"), row.get("status")
        errors = row.get("errors", [])
        errors = errors if isinstance(errors, (list, tuple)) else ["source_read_failed"]
        safe = {
            "feed_status": feed if isinstance(feed, str) and feed in _SOURCE_FEED_STATUSES else "not_completed",
            "status": status if isinstance(status, str) and status in _SOURCE_STATUSES else "fetch_incomplete",
            "errors": sorted({error if isinstance(error, str) and error in _SOURCE_ERROR_CODES
                              else "source_read_failed" for error in errors[:len(_SOURCE_ERROR_CODES)]}),
        }
        for field, limit in _SOURCE_COUNT_LIMITS.items():
            count = row.get(field)
            if type(count) is int and 0 <= count <= limit:
                safe[field] = count
        result[source] = safe
    return result


def safe_report(result, started, finished):
    """Fixed metadata only. Prepared copy never attests public availability."""
    result = result if isinstance(result, dict) else {}
    status = result.get("status")
    status = status if isinstance(status, str) and status in _JOB_STATUSES else "job_unavailable"
    day = datetime.fromtimestamp(started, JST).date().isoformat()
    edition = _safe_day(result.get("edition_date"))
    success = result.get("success") is True and edition == day and status in ("ready", "prepared", "source_empty")
    report = {"schema_version": 1, "report_kind": "private_morning_writer",
        "status": status, "success": success, "expected_edition_date": day,
        "edition_date": edition, "job_started_at": datetime.fromtimestamp(started, JST).isoformat(timespec="seconds"),
        "job_finished_at": datetime.fromtimestamp(finished, JST).isoformat(timespec="seconds"),
        "new_edition_prepared": success and status in ("ready", "prepared"),
        "source_empty": success and status == "source_empty", "public_delivery_confirmed": False}
    count = result.get("attempt_count")
    if type(count) is int and 0 <= count <= 6:
        report["attempt_count"] = count
    publish = result.get("publish_at")
    if _number(publish) and 0 <= publish <= 253402268399:
        report["publish_at"] = datetime.fromtimestamp(publish, JST).isoformat(timespec="seconds")
    if result.get("last_error") is not None:
        report["last_error"] = _safe_generation_error(result["last_error"])
    diagnostics = safe_editorial_review_diagnostics(result.get("editorial_review_diagnostics")
        if report.get("last_error") == "isolated_editorial_review_failed" else None)
    if diagnostics is not None:
        report["editorial_review_diagnostics"] = diagnostics
    if "source_status" in result:
        report["source_status"] = _safe_source_diagnostics(result["source_status"])
    count, counts = result.get("source_article_count"), result.get("source_date_counts")
    if (type(count) is int and 0 <= count <= MAX_ARTICLES and isinstance(counts, dict) and len(counts) <= MAX_ARTICLES
            and all(_safe_day(key) is not None and type(value) is int and 1 <= value <= MAX_ARTICLES
                    for key, value in counts.items()) and sum(counts.values()) == count):
        report["source_count_kind"] = "frozen_candidates"
        report["source_article_count"] = count
        report["source_date_counts"] = dict(sorted(counts.items()))
    phase, manifest_state = result.get("phase"), result.get("manifest_state")
    if isinstance(phase, str) and phase in _PHASES:
        report["phase"] = phase
    if isinstance(manifest_state, str) and manifest_state in _MANIFEST_STATES:
        report["manifest_state"] = manifest_state
    reads = result.get("manifest_reads")
    if type(reads) is int and 0 <= reads <= 1000:
        report["manifest_reads"] = reads
    version = result.get("manifest_version")
    if type(version) is int and version in (1, 3):
        report["manifest_version"] = version
    runtime_status = result.get("runtime_status")
    if isinstance(runtime_status, str) and runtime_status in _RUNTIME_STATUSES:
        report["runtime_status"] = runtime_status
    return report


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
    tomorrow = current.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    return morning_window(now), tomorrow.timestamp()


def _budget(now, morning):
    if morning is None:
        return JOB_SECONDS
    window, end_at = morning
    wait = max(0, min(WAIT_SECONDS, window["cutoff_at"] - now))
    return min(wait + PROCESSING_SECONDS, end_at - now)


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

    # Publication history was applied when the durable source snapshot was
    # selected. Re-reading it cannot change this immutable input.
    published_history_frozen = True

    def __init__(self, manifest, window, *, now=None):
        frozen_window = manifest_window(manifest, now=now)
        if any(frozen_window.get(key) != window.get(key) for key in
               ("edition_date", "window_start", "carryover_start", "cutoff_at")):
            raise ValueError("invalid_source_manifest")
        MorningNewsPreparer._validate_manifest(manifest, frozen_window)
        self._manifest, self._window = deepcopy(manifest), dict(frozen_window)

    def prepare(self, now, published_issues=()):
        actual = morning_window(now)
        if (any(actual.get(key) != self._window.get(key) for key in
                ("edition_date", "window_start", "carryover_start", "cutoff_at"))
                or now < self._window.get("snapshot_at", self._window["cutoff_at"])):
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


def _outcome(status, day=None, *, success=False, state=None, manifest=None, progress=None):
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
        diagnostics = safe_editorial_review_diagnostics(state.get("editorial_review_diagnostics")
            if value.get("last_error") == "isolated_editorial_review_failed" else None)
        if diagnostics is not None:
            value["editorial_review_diagnostics"] = diagnostics
    if isinstance(manifest, dict) and "source_status" in manifest:
        value["source_status"] = _safe_source_diagnostics(manifest["source_status"])
    articles = manifest.get("articles") if isinstance(manifest, dict) else None
    if isinstance(articles, list) and len(articles) <= MAX_ARTICLES:
        counts = {}
        for article in articles:
            published = _safe_day(article.get("published_date")) if isinstance(article, dict) else None
            if published is None:
                break
            counts[published] = counts.get(published, 0) + 1
        else:
            value.update(source_article_count=len(articles), source_date_counts=counts)
    if isinstance(progress, JobProgress):
        value.update(progress.fields())
    return value


def run_job(environ=None, *, wall_clock=time.time, monotonic=time.monotonic, sleep=time.sleep,
            storage_factory=PrivateNewsStorage, runtime_factory=build_runtime,
            preflight=preflight_subscription, progress=None):
    """Run once against today's frozen input; injectable transports are for tests.

The CLI adds process_deadline around this function. All clocks below are real
by default; injections are deliberately unavailable as command-line options.
Waiting uses only authenticated object reads, never ensure_private / create /
source preparation. Exactly one synchronous publishing tick follows readiness.
"""
    env = os.environ if environ is None else environ
    env = env if isinstance(env, Mapping) else {}
    progress = progress if isinstance(progress, JobProgress) else JobProgress()
    def outcome(status, day=None, **kwargs):
        return _outcome(status, day, progress=progress, **kwargs)
    started, mono_started = wall_clock(), monotonic()
    morning = _morning(started)
    if morning is None:
        return outcome("outside_morning_window")
    window, end_at = morning
    day, deadline = window["edition_date"], mono_started + _budget(started, morning)
    progress.phase = "configuration"
    settings = configuration(env)
    if not settings["configured"]:
        return outcome("configuration_unavailable", day)
    if not settings["enabled"]:
        return outcome("disabled", day)

    def remaining():
        now = wall_clock()
        if (not _number(now) or morning_window(now)["edition_date"] != day or now >= end_at):
            return 0
        return max(0, min(deadline - monotonic(), end_at - now))

    runtime = None
    try:
        progress.phase = "subscription_login"
        preflight(env)  # Readonly ChatGPT login status, once before any daily claim.
        if remaining() <= 0:
            return outcome("job_deadline", day)
        if storage_factory is PrivateNewsStorage:
            storage = storage_factory(env["SUPABASE_URL"], env["SUPABASE_KEY"],
                                      deadline=deadline, clock=monotonic)
        else:
            storage = storage_factory(env["SUPABASE_URL"], env["SUPABASE_KEY"])
        prefix = f"days/{day}/preparation/"
        paths = (prefix + "recovery-v3.json", prefix + "manifest.json")
        handoff_deadline = min(deadline, monotonic()
            + max(0, window["cutoff_at"] - wall_clock()) + MANIFEST_WAIT_SECONDS)
        phase_deadline = getattr(storage, "set_phase_deadline", None)
        if callable(phase_deadline):
            phase_deadline(handoff_deadline, phase="manifest_wait")
        progress.phase = "manifest_wait"
        manifest = None
        manifest_path = None
        while remaining() > 0 and monotonic() < handoff_deadline:
            now = wall_clock()
            if now >= window["cutoff_at"]:
                for path in paths:
                    progress.manifest_reads += 1
                    manifest = storage.read(path)
                    if manifest is not None:
                        progress.manifest_state = "present"
                        manifest_path = path
                        break
                    progress.manifest_state = "missing"
                if manifest is not None:
                    break
            pause = min(POLL_SECONDS, remaining(), handoff_deadline - monotonic())
            if pause <= 0:
                break
            sleep(pause)
        if remaining() <= 0:
            return outcome("job_deadline", day)
        if manifest is None:
            return outcome("manifest_unavailable", day)
        if monotonic() >= handoff_deadline:
            return outcome("manifest_unavailable", day)
        # Slow source freezing may consume the processing guard, but waiting
        # before the cutoff never consumes the writer's own 35-minute allowance.
        deadline = min(deadline, monotonic() + GENERATION_JOB_SECONDS)
        if callable(phase_deadline):
            phase_deadline(deadline, phase="generation")
        progress.phase = "manifest_validation"
        try:
            if (manifest_path == paths[0]
                    and (not isinstance(manifest, dict) or manifest.get("version") != 3
                         or manifest.get("kind") != "morning")):
                raise ValueError("invalid_source_manifest")
            frozen = FrozenSources(manifest, window, now=wall_clock())
        except (ValueError, TypeError, OverflowError):
            progress.manifest_state = "invalid"
            return outcome("invalid_source_manifest", day)
        progress.manifest_version = manifest.get("version")
        if not manifest["articles"] and not healthy_empty(manifest):
            return outcome("source_unavailable", day, manifest=manifest)
        if manifest["articles"] and remaining() < GENERATION_RESERVE_SECONDS:
            return outcome("generation_window_exhausted", day, manifest=manifest)
        # Cache contains reviewed copy only, never credentials or raw originals.
        with TemporaryDirectory(prefix="kn-private-news-job-") as folder:
            progress.phase = "runtime_startup"
            # Each job runs one tick. Later jobs may resume a failed edition
            # through the existing immutable claims and retry/lease intervals;
            # a restart never grants a fresh daily budget.
            runtime = runtime_factory(env, storage=storage, max_attempts=MAX_ATTEMPTS,
                        cache_path=str(Path(folder) / "reviewed.json"))
            runtime.source_preparer = frozen
            progress.phase = "generation"
            state = runtime.run_once()
            progress.runtime(state)
            progress.phase = "outcome"
            if remaining() <= 0:
                return outcome("job_deadline", day, state=state, manifest=manifest)
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
            return outcome(status, day, success=success, state=state, manifest=manifest)
    except GenerationError:
        return outcome("subscription_login_unavailable", day)
    except StorageUnavailable:
        return outcome("storage_unavailable", day)
    except Exception:
        # No upstream response, source body, credential or exception is printed.
        return outcome("job_unavailable", day)
    finally:
        if runtime is not None:
            try:
                progress.runtime(runtime.snapshot())
                runtime.stop()
            except Exception:
                pass


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-live", action="store_true",
                        help="permit one publishing tick within the durable daily limit and review API charges")
    parser.add_argument("--result-file", help="save only a fixed private result to a new file; requires --run-live")
    args = parser.parse_args(argv)
    if args.result_file is not None and not args.run_live:
        parser.error("--result-file requires --run-live")
    if not args.run_live:
        settings = configuration()
        settings.update(job_seconds=JOB_SECONDS, processing_seconds=PROCESSING_SECONDS,
                        generation_job_seconds=GENERATION_JOB_SECONDS,
                        manifest_wait_seconds=MANIFEST_WAIT_SECONDS,
                        generation_seconds=GENERATION_SECONDS,
                        generation_ticks_per_job=1, daily_attempt_limit=MAX_ATTEMPTS,
                        daily_attempts_default=MAX_ATTEMPTS,
                        start_window="07:00–23:00 Asia/Tokyo",
                        stop_by="same-day midnight Asia/Tokyo", target_release="08:00 Asia/Tokyo",
                        source_collection_allowed=False)
        print(json.dumps(settings, ensure_ascii=False))
        return 0
    now, output, progress = time.time(), None, JobProgress()
    try:
        if args.result_file is not None:
            output = ResultFile(args.result_file)
        morning = _morning(now)
        budget = _budget(now, morning)
        with process_deadline(seconds=budget):
            result = run_job(progress=progress)
    except JobDeadline:
        result = _outcome("job_deadline", progress=progress)
    except DeadlineUnavailable:
        result = _outcome("job_deadline_unavailable")
    except ResultFileUnavailable:
        result = _outcome("result_file_unavailable")
    except Exception:
        result = _outcome("job_unavailable")
    report = safe_report(result, now, time.time())
    try:
        if output is not None:
            output.write(report)
    except ResultFileUnavailable:
        report = safe_report(_outcome("result_file_unavailable"), now, time.time())
    finally:
        if output is not None:
            output.close()
    print(json.dumps(report, ensure_ascii=False, allow_nan=False))
    return 0 if report["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

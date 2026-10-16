"""Prepare one daily website edition, persisting it before local publication.

The producer cooperatively stops starting work after 12 minutes. Pending claims
have a 16-minute recovery lease; a result arriving after that lease is rejected.
No LINE delivery or browser credentials are used by this module. Storage is a
private, server-only bucket; its immutable attempt records coordinate workers.
"""
from copy import deepcopy
from datetime import date, datetime
import base64
import json
import math
import multiprocessing
import os
from pathlib import Path
import re
import select
import signal
from threading import Event, Lock, Thread
import time
from urllib.parse import quote, urlsplit

import requests
from news_review_diagnostics import safe_editorial_review_diagnostics

from news_cache import JST, OFFICIAL_NEWS_SOURCES, _validated_digest, load_reviewed_digests
from publish_news import MAX_ISSUES, _publication_lock, _replace_atomically


BUCKET = "website-news"
CACHE_PATH = Path("/tmp/kn-daily-news.json")
BASELINE_PATH = Path(__file__).with_name("news-digests.json")
ATTEMPT_INTERVAL = 15 * 60
PENDING_ATTEMPT_SECONDS = 16 * 60
MAX_ATTEMPTS = 6
GENERATION_ERRORS = frozenset(("invalid_provider_json", "invalid_model", "gemini_incomplete",
                              "codex_chatgpt_login_required", "codex_paid_writer_disabled",
                              "codex_writer_configuration", "codex_writer_unavailable",
                              "codex_writer_invalid_output", "codex_writer_output_limit",
                              "codex_writer_timeout", "codex_writer_failed",
                              "codex_writer_tool_use", "codex_writer_closed", "codex_writer_input_limit",
                              "claude_incomplete", "no_eligible_topics", "invalid_article_selection",
                              "openai_incomplete", "openai_refused", "openai_invalid_response",
                              "openai_not_configured",
                              "future_article", "invalid_edition", "invalid_edition_date",
                              "invalid_edition_repeated_summary", "no_verified_articles",
                              "isolated_article_schema", "isolated_article_length",
                              "isolated_article_paragraphs", "isolated_article_evidence",
                              "isolated_article_readability", "isolated_overview_readability",
                              "isolated_overview_schema", "isolated_overview_selection",
                              "isolated_overview_length", "isolated_overview_repeated",
                              "isolated_editorial_review_failed",
                              "isolated_budget_required",
                              "generation_call_limit", "generation_budget_required",
                              "edition_day_changed", "editorial_review_failed", "generation_failed",
                              "generation_deadline", "invalid_source_window", "invalid_official_article"))


def _safe_generation_error(value):
    code = str(value)
    return code if (code in GENERATION_ERRORS or re.fullmatch(r'invalid_edition_lengths_[0-9]{1,5}(?:_[0-9]{1,5}){0,3}', code) or re.fullmatch(r'(?:editorial_review_failed|openai_review_failed)_(?:facts|dates|distinct_topics|japan_economy|readable|no_invented_outlook|original_wording|approval)', code) or re.fullmatch(
        r"(?:(?:gemini|claude|openai)_(?:http_[0-9]{3}|response_limit|unavailable)|gemini_(?:discovery|review)_(?:max_tokens|safety|recitation|language|other|blocklist|prohibited_content|spii|malformed_function_call|unexpected_tool_call|too_many_tool_calls|missing))", code)) else "generation_failed"


class StorageUnavailable(RuntimeError):
    """Deliberately contains no server response, credential, or private URL."""


class _StorageResponse:
    def __init__(self, status_code, content):
        self.status_code, self.content = status_code, content

    def json(self):
        return json.loads(self.content)


def _service_key(key):
    if not isinstance(key, str) or not key:
        return False
    if key.startswith("sb_secret_"):
        return True
    try:
        payload = key.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        return isinstance(claims, dict) and claims.get("role") == "service_role"
    except (ValueError, IndexError, UnicodeError, TypeError):
        return False


class SupabaseNewsStorage:
    """Small bounded REST adapter; no public URL or client-side policy needed."""

    def __init__(self, url, key, *, session=None, timeout=(5, 15)):
        parsed = urlsplit(str(url or ""))
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username
                or parsed.password or parsed.query or parsed.fragment or not _service_key(key)):
            raise StorageUnavailable("storage_configuration")
        self._url = str(url).rstrip("/") + "/storage/v1"
        self._headers = {"apikey": key, "Authorization": "Bearer " + key,
                         "Cache-Control": "no-cache"}
        self._session = session or requests.Session()
        self._timeout = timeout

    def after_fork(self):
        # Never acquire/close connection pools inherited from another process.
        # Rebuild the transport; configuration and server headers are unchanged.
        self._session = requests.Session()

    @staticmethod
    def _remaining(deadline, clock):
        if type(deadline) not in (int, float) or not math.isfinite(deadline) or not callable(clock):
            raise StorageUnavailable("storage_budget")
        try:
            now = clock()
        except Exception:
            raise StorageUnavailable("storage_budget") from None
        if type(now) not in (int, float) or not math.isfinite(now):
            raise StorageUnavailable("storage_budget")
        remaining = deadline - now
        if not math.isfinite(remaining):
            raise StorageUnavailable("storage_budget")
        if remaining <= 0:
            raise StorageUnavailable("storage_deadline")
        return remaining

    def _budget_timeout(self, remaining):
        values = self._timeout if isinstance(self._timeout, tuple) else (self._timeout, self._timeout)
        if (len(values) != 2 or any(type(value) not in (int, float) or not math.isfinite(value)
                                    or value <= 0 for value in values)):
            raise StorageUnavailable("storage_budget")
        return tuple(min(value, remaining) for value in values)

    def _budget_worker(self, writer, reader, method, path, deadline, clock, kwargs):
        # A real requests pool must never be reused after fork. Injected test
        # transports are retained; no network is started when using a mock.
        write_fd = writer.fileno()
        if reader is not None:
            reader.close()
        try:
            # An independent hard timer also closes every socket if the owner
            # is killed while this child is blocked in DNS/headers/body.
            remaining = self._remaining(deadline, clock)
            signal.signal(signal.SIGALRM, lambda *_: os._exit(0))
            signal.setitimer(signal.ITIMER_REAL, remaining)
            if isinstance(self._session, requests.sessions.Session):
                self._session = requests.Session()
            response = self._request_direct(method, path, deadline=deadline, clock=clock, **kwargs)
            self._remaining(deadline, clock)
            payload = (b"OK " + str(response.status_code).encode("ascii") + b" "
                       + str(len(response.content)).encode("ascii") + b"\n" + response.content)
        except StorageUnavailable as exc:
            code = str(exc)
            if code not in {"storage_budget", "storage_deadline", "storage_response", "storage_network"}:
                code = "storage_network"
            payload = b"ERR " + code.encode("ascii") + b"\n"
        except Exception:
            payload = b"ERR storage_network\n"
        try:
            view = memoryview(payload)
            while view:
                view = view[os.write(write_fd, view):]
        except (OSError, BrokenPipeError):
            pass
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            writer.close()

    def _request(self, method, path, *, deadline=None, clock=None, **kwargs):
        if deadline is None:
            if clock is not None:
                raise StorageUnavailable("storage_budget")
            return self._request_direct(method, path, **kwargs)
        clock = time.monotonic if clock is None else clock
        remaining = self._remaining(deadline, clock)
        # Keep the pre-existing 30s single-request ceiling as well as the
        # caller's shared deadline. Socket inactivity timeouts alone do not
        # constrain slow headers, DNS, or a body arriving one byte at a time.
        deadline = min(deadline, deadline - remaining + 30)
        self._budget_timeout(remaining)
        if multiprocessing.current_process().daemon:
            raise StorageUnavailable("storage_budget")
        real_transport = isinstance(self._session, requests.sessions.Session)
        try:
            if real_transport:
                # The website has worker threads. A clean forkserver avoids
                # inheriting locks held by them, while preloading this module
                # avoids repeating its imports for every bounded cache read.
                multiprocessing.set_forkserver_preload([__name__])
            context = multiprocessing.get_context("forkserver" if real_transport else "fork")
        except (ValueError, RuntimeError):
            raise StorageUnavailable("storage_budget") from None
        reader = writer = worker = None
        started = False
        startup = None
        try:
            reader, writer = context.Pipe(duplex=False)
            read_fd = reader.fileno()
            worker = context.Process(target=self._budget_worker,
                                     args=(writer, None if real_transport else reader,
                                           method, path, deadline, clock, kwargs), daemon=True)
            if real_transport:
                # Initial forkserver boot/import/IPC is part of the same
                # deadline, rather than an unbounded step before HTTP starts.
                startup = {"ready": Event(), "guard": Lock(), "cancelled": False,
                           "started": False, "failed": False}
                def launch():
                    try:
                        worker.start()
                        startup["started"] = True
                    except Exception:
                        startup["failed"] = True
                    finally:
                        with startup["guard"]:
                            if startup["cancelled"]:
                                if startup["started"]:
                                    try:
                                        worker.kill()
                                    except ProcessLookupError:
                                        pass
                                    worker.join(timeout=0)
                                reader.close()
                                writer.close()
                            startup["ready"].set()
                Thread(target=launch, name="news-storage-start", daemon=True).start()
                if not startup["ready"].wait(self._remaining(deadline, clock)):
                    raise StorageUnavailable("storage_deadline")
                self._remaining(deadline, clock)
                if startup["failed"]:
                    raise StorageUnavailable("storage_budget")
                started = startup["started"]
            else:
                worker.start()
                started = True
            writer.close()
            writer = None
            content = bytearray()
            while True:
                remaining = self._remaining(deadline, clock)
                readable, _, _ = select.select([read_fd], [], [], remaining)
                self._remaining(deadline, clock)
                if not readable:
                    raise StorageUnavailable("storage_deadline")
                chunk = os.read(read_fd, 64 * 1024)
                if not chunk:
                    break
                content.extend(chunk)
                if len(content) > 1_000_100:
                    raise StorageUnavailable("storage_response")
                header, separator, body = bytes(content).partition(b"\n")
                if separator:
                    if header.startswith(b"ERR "):
                        break
                    match = re.fullmatch(rb"OK [0-9]{3} ([0-9]{1,7})", header)
                    if not match or int(match[1]) > 1_000_000:
                        raise StorageUnavailable("storage_response")
                    if len(body) >= int(match[1]):
                        # An explicit frame length avoids waiting for EOF on
                        # a pipe descriptor inherited by another concurrent
                        # fork. Partial frames still wait only to the deadline.
                        break
            self._remaining(deadline, clock)
            header, separator, body = bytes(content).partition(b"\n")
            if not separator:
                raise StorageUnavailable("storage_network")
            if header.startswith(b"ERR "):
                code = header[4:].decode("ascii")
                if code not in {"storage_budget", "storage_deadline", "storage_response", "storage_network"}:
                    code = "storage_network"
                raise StorageUnavailable(code)
            match = re.fullmatch(rb"OK ([0-9]{3}) ([0-9]{1,7})", header)
            if not match or len(body) != int(match[2]) or len(body) > 1_000_000:
                raise StorageUnavailable("storage_response")
            return _StorageResponse(int(match[1]), body)
        except StorageUnavailable:
            raise
        except Exception:
            raise StorageUnavailable("storage_network" if started else "storage_budget") from None
        finally:
            deferred_cleanup = False
            if startup is not None:
                with startup["guard"]:
                    startup["cancelled"] = True
                    deferred_cleanup = not startup["ready"].is_set()
                    started = startup["started"]
            if not deferred_cleanup:
                if reader is not None:
                    reader.close()
                if writer is not None:
                    writer.close()
            if started and not deferred_cleanup:
                # kill closes the child's in-flight sockets, even during DNS,
                # connect or headers. Do not join beyond the caller's deadline.
                if worker.is_alive():
                    try:
                        worker.kill()
                    except ProcessLookupError:
                        pass
                worker.join(timeout=0)

    def _request_direct(self, method, path, *, deadline=None, clock=None, **kwargs):
        headers = {**self._headers, **kwargs.pop("headers", {})}
        budgeted = deadline is not None
        clock = time.monotonic if clock is None else clock
        deadline, response = deadline if budgeted else clock() + 30, None
        try:
            timeout = self._budget_timeout(self._remaining(deadline, clock)) if budgeted else self._timeout
            response = self._session.request(method, self._url + path, headers=headers,
                                             timeout=timeout, allow_redirects=False, stream=True, **kwargs)
            if budgeted:
                self._remaining(deadline, clock)
            length = response.headers.get("Content-Length")
            if length is not None and (not length.isdecimal() or int(length) > 1_000_000):
                raise StorageUnavailable("storage_response")
            content = bytearray()
            while True:
                if budgeted:
                    self._remaining(deadline, clock)
                elif clock() > deadline:
                    raise StorageUnavailable("storage_timeout")
                chunk = response.raw.read1(64 * 1024, decode_content=True)
                content.extend(chunk)
                if budgeted:
                    self._remaining(deadline, clock)
                if len(content) > 1_000_000 or (not budgeted and clock() > deadline):
                    raise StorageUnavailable("storage_response")
                if not chunk:
                    break
            return _StorageResponse(response.status_code, bytes(content))
        except StorageUnavailable:
            raise
        except Exception:
            raise StorageUnavailable("storage_network") from None
        finally:
            if response is not None:
                response.close()

    @staticmethod
    def _payload(response):
        try:
            return response.json()
        except (ValueError, TypeError):
            raise StorageUnavailable("storage_response") from None

    @classmethod
    def _missing(cls, response):
        if response.status_code == 404:
            return True
        if response.status_code != 400:
            return False
        value = cls._payload(response)
        return isinstance(value, dict) and (
            str(value.get("statusCode")) == "404" or value.get("code") in ("NoSuchKey", "NoSuchBucket")
            or value.get("error") in ("not_found", "Not Found")
            or value.get("message") in ("Object not found", "Bucket not found"))

    @classmethod
    def _duplicate(cls, response):
        if response.status_code == 409:
            return True
        if response.status_code != 400:
            return False
        value = cls._payload(response)
        return isinstance(value, dict) and (
            str(value.get("statusCode")) == "409" or value.get("code") in ("KeyAlreadyExists", "ResourceAlreadyExists")
            or value.get("error") in ("Duplicate", "Conflict")
            or value.get("message") in ("The resource already exists", "Bucket already exists"))

    def ensure_private(self):
        response = self._request("GET", "/bucket/" + BUCKET)
        if self._missing(response):
            created = self._request("POST", "/bucket", json={"id": BUCKET, "name": BUCKET,
                                    "public": False, "file_size_limit": 1_000_000,
                                    "allowed_mime_types": ["application/json"]})
            if not 200 <= created.status_code < 300 and not self._duplicate(created):
                raise StorageUnavailable("storage_bucket")
            # A simultaneous creator might have used a public bucket. Check it.
            response = self._request("GET", "/bucket/" + BUCKET)
        if not 200 <= response.status_code < 300:
            raise StorageUnavailable("storage_bucket")
        bucket = self._payload(response)
        if not isinstance(bucket, dict) or bucket.get("public") is not False:
            raise StorageUnavailable("storage_private_required")

    def read(self, path, *, deadline=None, clock=None):
        """Read within an optional caller-owned absolute monotonic deadline."""
        response = self._request("GET", "/object/authenticated/" + BUCKET + "/" + quote(path, safe="/"),
                                 deadline=deadline, clock=clock)
        if self._missing(response):
            if deadline is not None:
                self._remaining(deadline, time.monotonic if clock is None else clock)
            return None
        if not 200 <= response.status_code < 300:
            raise StorageUnavailable("storage_read")
        value = self._payload(response)
        if deadline is not None:
            self._remaining(deadline, time.monotonic if clock is None else clock)
        return value

    def create(self, path, value, *, deadline=None, clock=None):
        body = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
        if len(body) > 1_000_000:
            raise StorageUnavailable("storage_size")
        response = self._request("POST", "/object/" + BUCKET + "/" + quote(path, safe="/"), data=body,
                                 deadline=deadline, clock=clock,
                                 headers={"Content-Type": "application/json", "x-upsert": "false",
                                          "Cache-Control": "max-age=0"})
        if self._duplicate(response):
            return False
        if not 200 <= response.status_code < 300:
            raise StorageUnavailable("storage_write")
        return True

    def _list(self, prefix, *, deadline=None, clock=None, offset=0):
        if type(offset) is not int or not 0 <= offset <= 180:
            raise StorageUnavailable("storage_budget")
        response = self._request("POST", "/object/list/" + BUCKET,
                                 json={"prefix": prefix, "limit": MAX_ISSUES, "offset": offset,
                                       "sortBy": {"column": "name", "order": "desc"}},
                                 deadline=deadline, clock=clock)
        if not 200 <= response.status_code < 300:
            raise StorageUnavailable("storage_list")
        values = self._payload(response)
        if not isinstance(values, list):
            raise StorageUnavailable("storage_list")
        if deadline is not None:
            self._remaining(deadline, time.monotonic if clock is None else clock)
        return values

    def recent_days(self):
        days = []
        for item in self._list("days"):
            name = item.get("name") if isinstance(item, dict) else None
            try:
                if isinstance(name, str) and date.fromisoformat(name).isoformat() == name:
                    days.append(name)
            except ValueError:
                continue
        return sorted(set(days), reverse=True)

    def reviewed_keys(self, day):
        return [f"days/{day}/{item['name']}" for item in self._list(f"days/{day}")
                if isinstance(item, dict) and isinstance(item.get("name"), str)
                and re.fullmatch(r"reviewed-[0-9]{20}\.json", item["name"])]


def _valid_issue(value, now, *, edition=None):
    issue = _validated_digest(value)
    today = datetime.fromtimestamp(now, JST).date().isoformat()
    if (issue is None or issue.get("publication_mode") != "curated"
            or issue["reviewed_at"] > now or issue["edition_date"] > today
            or (edition is not None and issue["edition_date"] != edition)):
        raise ValueError("invalid_edition")
    return issue


def _attempt_started(value, day, index, now):
    """Validate durable claim/result identity without reflecting stored data."""
    started = value.get("started_at") if type(value) is dict else None
    if (type(value) is not dict or type(value.get("version")) is not int or value["version"] != 1
            or type(value.get("edition_date")) is not str or value["edition_date"] != day
            or type(value.get("attempt")) is not int or value["attempt"] != index
            or type(started) not in (int, float) or not math.isfinite(started)
            or not 0 < started <= now):
        raise StorageUnavailable("storage_state")
    try:
        actual = datetime.fromtimestamp(started, JST)
        same_day = actual.date().isoformat() == day and 7 <= actual.hour < 23
    except (ValueError, OverflowError, OSError):
        same_day = False
    if not same_day:
        raise StorageUnavailable("storage_state")
    return started


class DailyNewsRuntime:
    """All public reads are in-memory; network/AI only runs in daemon workers."""

    def __init__(self, storage, generator, *, enabled=False, baseline_path=BASELINE_PATH,
                 cache_path=CACHE_PATH, clock=time.time, interval=30, source_preparer=None,
                 generation_owner="local", max_attempts=MAX_ATTEMPTS):
        if generation_owner not in ("local", "external"):
            raise ValueError("invalid_generation_owner")
        if type(max_attempts) is not int or not 1 <= max_attempts <= MAX_ATTEMPTS:
            raise ValueError("invalid_max_attempts")
        self.storage, self.generator = storage, generator
        self.source_preparer = source_preparer
        self.generation_owner, self.max_attempts = generation_owner, max_attempts
        self._source_history = None
        self.enabled = bool(enabled and (generation_owner == "external" or callable(generator)))
        self.baseline_path, self.cache_path = Path(baseline_path), Path(cache_path)
        self.clock, self.interval = clock, max(1, interval)
        self._pid = os.getpid()
        self._state_lock, self._work_lock = Lock(), Lock()
        self._stop = Event()
        self._thread = None
        self._private = self._restored = False
        # This file contains only editions that passed durable storage before
        # a previous process wrote it. The checked-in baseline remains read-only.
        values = load_reviewed_digests(self.baseline_path) + load_reviewed_digests(self.cache_path)
        self._issues = self._merge(values)
        latest = self._issues[-1] if self._issues else {}
        self._state = {"status": "starting", "enabled": self.enabled,
                       "generation_owner": generation_owner, "max_attempts": max_attempts,
                       "attempt_count": 0, "edition_date": latest.get("edition_date"),
                       "publish_at": latest.get("publish_at", latest.get("reviewed_at")),
                       "last_error": None}
        # Gunicorn preload forks after imports. Reset while the child is still
        # single-threaded, with a PID guard as a fallback for alternate launchers.
        if hasattr(os, "register_at_fork"):
            os.register_at_fork(after_in_child=self._after_fork)

    def _after_fork(self):
        self._state_lock, self._work_lock = Lock(), Lock()
        self._stop = Event()
        self._thread = None
        self._private = self._restored = False
        self._state = {**self._state, "status": "starting", "attempt_count": 0, "last_error": None}
        self._state.pop("editorial_review_diagnostics", None)
        self._source_history = None
        reset = getattr(self.storage, "after_fork", None)
        if callable(reset):
            reset()
        self._pid = os.getpid()

    def _ensure_process(self):
        # This must precede *any* inherited lock acquisition: its owner thread
        # does not exist in the child, even when Thread.is_alive() says otherwise.
        if self._pid != os.getpid():
            self._after_fork()

    @staticmethod
    def _merge(values):
        by_date = {}
        for value in values:
            if value.get("publication_mode") != "curated":
                continue
            previous = by_date.get(value["edition_date"])
            if previous is None or value["reviewed_at"] > previous["reviewed_at"]:
                by_date[value["edition_date"]] = value
        return [by_date[key] for key in sorted(by_date)[-MAX_ISSUES:]]

    def _set(self, status, **metadata):
        replace_diagnostics = "editorial_review_diagnostics" in metadata
        diagnostics = safe_editorial_review_diagnostics(metadata.pop("editorial_review_diagnostics", None))
        if "last_error" not in metadata:
            if status in ("ready", "prepared", "generating"):
                metadata["last_error"] = None
            elif status in ("storage_unavailable", "cache_unavailable", "unavailable", "invalid_edition"):
                metadata["last_error"] = status
        with self._state_lock:
            self._state.update(status=status, **metadata)
            if replace_diagnostics or ("last_error" in metadata
                    and metadata["last_error"] != "isolated_editorial_review_failed"):
                self._state.pop("editorial_review_diagnostics", None)
                if diagnostics is not None and self._state.get("last_error") == "isolated_editorial_review_failed":
                    self._state["editorial_review_diagnostics"] = diagnostics

    def snapshot(self):
        self._ensure_process()
        with self._state_lock:
            result = dict(self._state)
            if "editorial_review_diagnostics" in result:
                result["editorial_review_diagnostics"] = safe_editorial_review_diagnostics(
                    result["editorial_review_diagnostics"])
            return result

    def reviewed_digests(self):
        self._ensure_process()
        with self._state_lock:
            return deepcopy(self._issues)

    def start(self):
        self._ensure_process()
        with self._state_lock:
            if self._thread is None or not self._thread.is_alive():
                self._stop.clear()
                self._thread = Thread(target=self._loop, name="website-daily-news", daemon=True)
                self._thread.start()
        return self

    def stop(self):
        self._ensure_process()
        self._stop.set()

    def _loop(self):
        while not self._stop.is_set():
            self.run_once()
            self._stop.wait(self.interval)

    def kick(self):
        self._ensure_process()
        # Requests never wait for a storage lookup or start overlapping work.
        if not self._stop.is_set() and self._work_lock.acquire(blocking=False):
            try:
                Thread(target=self._run_locked, name="website-news-check", daemon=True).start()
            except Exception:
                self._work_lock.release()
                self._set("unavailable")
        return self.snapshot()

    def run_once(self):
        """Synchronous tick for startup checks/tests, never called by web routes."""
        self._ensure_process()
        if self._stop.is_set() or not self._work_lock.acquire(blocking=False):
            return self.snapshot()
        self._run_locked()
        return self.snapshot()

    def _run_locked(self):
        try:
            self._tick()
        except StorageUnavailable:
            self._set("storage_unavailable")
        except OSError:
            self._set("cache_unavailable")
        except Exception:
            # Public status must not contain upstream exception text or keys.
            self._set("unavailable")
        finally:
            self._work_lock.release()

    def _install(self, editions):
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        with _publication_lock(self.cache_path):
            existing = load_reviewed_digests(self.cache_path)
            proposed = self._merge(load_reviewed_digests(self.baseline_path)
                                   + existing + self.reviewed_digests() + editions)
            if proposed != existing:
                _replace_atomically(self.cache_path, proposed)
        with self._state_lock:
            if self._issues != proposed:
                self._source_history = None
            self._issues = proposed

    def _restore(self, now):
        today = datetime.fromtimestamp(now, JST).date().isoformat()
        editions = []
        for day in self.storage.recent_days():
            if day > today:
                continue
            issue = self._read_edition(day, now)
            if issue is None:
                continue
            editions.append(issue)
            # Keep a prior published issue as well as a possible 08:00 draft.
            if len(editions) >= 2:
                break
        if editions:
            self._install(editions)
            latest = self.reviewed_digests()[-1]
            self._set("waiting", edition_date=latest["edition_date"],
                      publish_at=latest.get("publish_at", latest["reviewed_at"]))
        self._restored = True

    def _read_edition(self, day, now):
        value = self.storage.read(f"days/{day}/edition.json")
        editions = [_valid_issue(value, now, edition=day)] if value is not None else []
        # Corrections are immutable too. Their key sorts by the review timestamp.
        keys = sorted(self.storage.reviewed_keys(day), reverse=True)
        if keys:
            editions.append(_valid_issue(self.storage.read(keys[0]), now, edition=day))
        return max(editions, key=lambda issue: issue["reviewed_at"]) if editions else None

    def _ready(self, issue, now):
        self._install([issue])
        issue = next(value for value in self.reviewed_digests() if value["edition_date"] == issue["edition_date"])
        self._set("prepared" if issue.get("publish_at", issue["reviewed_at"]) > now else "ready",
                  edition_date=issue["edition_date"],
                  publish_at=issue.get("publish_at", issue["reviewed_at"]), editorial_review_diagnostics=None)

    def _result(self, path, value):
        # The immutable claim, not this advisory outcome, enforces the budget.
        try:
            self.storage.create(path, value)
        except Exception:
            pass

    def _published_history(self, now):
        """Bounded durable history for source deduplication, not only two cached days."""
        from morning_news_window import published_references
        day = datetime.fromtimestamp(now, JST).date().isoformat()
        if self._source_history is not None and self._source_history[0] == day:
            return deepcopy(self._source_history[1])
        issues = self.reviewed_digests()
        past = [value for value in self.storage.recent_days() if value <= day][:MAX_ISSUES]
        for previous in past:
            # Every retained update consumes its original, even if a later
            # daytime bulletin replaced it in the public in-memory cache.
            keys = sorted(self.storage.reviewed_keys(previous), reverse=True)
            if len(keys) >= 30:
                raise StorageUnavailable("storage_history_capacity")
            paths = [f"days/{previous}/edition.json"] + keys
            for path in paths:
                value = self.storage.read(path)
                if value is not None:
                    issues.append(_valid_issue(value, now, edition=previous))
        issues = [issue for issue in issues if published_references([issue], now)]
        self._source_history = (day, deepcopy(issues))
        return issues

    def _poll_sources(self):
        collect = getattr(self.source_preparer, "collect", None)
        if not self.enabled or not callable(collect):
            return
        try:
            result = collect(self.clock())
        except Exception:
            # An unpaid poll cannot withdraw a reviewed edition or silently
            # authorize a paid retry. Its durable claim still prevents repeats.
            result = {"status": "unavailable", "last_checked_at": None}
        if not isinstance(result, dict):
            return
        status = result.get("status")
        status = status if status in ("not_checked", "checked", "pending", "not_completed",
                                      "unavailable") else "unavailable"
        stamp = result.get("last_checked_at")
        stamp = stamp if type(stamp) in (int, float) and math.isfinite(stamp) else None
        with self._state_lock:
            self._state["source_cache"] = {"status": status, "last_checked_at": stamp}

    def _tick(self):
        if (self.generation_owner == "external"
                and not callable(getattr(self.source_preparer, "prepare", None))):
            self._set("configuration_unavailable", last_error="source_preparer_required")
            return
        if self.storage is None:
            self._set("storage_unavailable")
            return
        if not self._private:
            self.storage.ensure_private()
            self._private = True
        now = self.clock()
        if not self._restored:
            self._restore(now)
        current = datetime.fromtimestamp(now, JST)
        day, minute = current.date().isoformat(), current.hour * 60 + current.minute
        prefix = f"days/{day}"
        existing = self._read_edition(day, now)
        baseline = next((issue for issue in self._merge(load_reviewed_digests(self.baseline_path))
                         if issue["edition_date"] == day and issue["reviewed_at"] <= now), None)
        if baseline is not None and (existing is None or baseline["reviewed_at"] > existing["reviewed_at"]):
            key = prefix + ("/edition.json" if existing is None
                            else f"/reviewed-{int(baseline['reviewed_at'] * 1_000_000):020d}.json")
            if self.storage.create(key, baseline):
                existing = baseline
            else:
                existing = self._read_edition(day, now)
                if existing is None or existing["reviewed_at"] < baseline["reviewed_at"]:
                    # An in-flight AI issue won edition.json; persist the human
                    # review as a separate correction, never overwrite its lock.
                    key = prefix + f"/reviewed-{int(baseline['reviewed_at'] * 1_000_000):020d}.json"
                    self.storage.create(key, baseline)
                    existing = self._read_edition(day, now)
        if existing is not None:
            # Install reviewed copy first: a slow original fetch at 08:00 must
            # not hold an already approved edition off the in-memory website.
            self._ready(existing, now)
            self._poll_sources()
            return
        self._set("waiting", attempt_count=0, editorial_review_diagnostics=None)
        if not self.enabled:
            self._set("disabled")
            return
        self._poll_sources()
        now = self.clock()
        current = datetime.fromtimestamp(now, JST)
        if current.date().isoformat() != day:
            return
        minute = current.hour * 60 + current.minute
        if not 7 * 60 <= minute < 23 * 60:
            return
        manifest = None
        if self.source_preparer is not None:
            from morning_news_window import morning_window
            cutoff = morning_window(now)["cutoff_at"]
            history = (self._published_history(now) if now >= cutoff
                       and getattr(self.source_preparer, "published_history_frozen", False) is not True else ())
            manifest = self.source_preparer.prepare(now, history)
            if manifest is None or now < cutoff:
                self._set("collecting" if now < cutoff else "freezing", edition_date=day,
                          cutoff_at=cutoff, last_error=None)
                return
            if not manifest["articles"]:
                source_status = manifest.get("source_status", {})
                # A quiet official window is confirmed only after every
                # enabled source was checked. A missing row is an outage, even
                # when the remaining source successfully reported no stories.
                complete = (isinstance(source_status, dict)
                    and set(OFFICIAL_NEWS_SOURCES).issubset(source_status)
                    and all(isinstance(row, dict) and row.get("feed_status") == "ok"
                            and row.get("status") in ("collected", "no_matching_candidates")
                            for row in source_status.values()))
                self._set("source_empty" if complete else "source_unavailable", edition_date=day,
                          cutoff_at=cutoff, last_error=None if complete else "source_unavailable")
                return
            # Refresh after storage reads; all retries receive the same frozen
            # articles, while invocation/publication times remain actual times.
            now = self.clock()
            if datetime.fromtimestamp(now, JST).date().isoformat() != day:
                self._set("waiting")
                return
        attempts, outcomes = [], []
        for index in range(1, MAX_ATTEMPTS + 1):
            claim = self.storage.read(prefix + f"/attempt-{index}.lock")
            result = self.storage.read(prefix + f"/attempt-{index}.result.json")
            if claim is None:
                if result is not None:
                    raise StorageUnavailable("storage_state")
                continue
            started = _attempt_started(claim, day, index, self.clock())
            if (set(claim) != {"version", "edition_date", "attempt", "started_at"}
                    or index != len(attempts) + 1):
                raise StorageUnavailable("storage_state")
            if result is not None:
                # Only explicit matching failures release the shorter retry
                # interval. A persisted or unknown outcome with no readable
                # edition is ambiguous; it must never buy another generation.
                if (_attempt_started(result, day, index, self.clock()) != started
                        or set(result) - {"version", "edition_date", "attempt", "started_at", "status",
                                          "last_error", "editorial_review_diagnostics"}
                        or type(result.get("status")) is not str
                        or result["status"] not in ("generation_failed", "invalid_edition")
                        or ("last_error" in result and type(result["last_error"]) is not str)):
                    raise StorageUnavailable("storage_state")
            if attempts:
                interval = ATTEMPT_INTERVAL if outcomes[-1] is not None else PENDING_ATTEMPT_SECONDS
                if started < attempts[-1][1] + interval:
                    raise StorageUnavailable("storage_state")
            attempts.append((index, started))
            outcomes.append(result)
        self._set("waiting", attempt_count=len(attempts))
        retry_interval = ATTEMPT_INTERVAL
        finished_failure, code, diagnostics = False, None, None
        if attempts:
            result = outcomes[-1]
            finished_failure = result is not None
            if finished_failure:
                code = _safe_generation_error(result.get("last_error", result["status"]))
                diagnostics = (result.get("editorial_review_diagnostics")
                               if code == "isolated_editorial_review_failed" else None)
                self._set("waiting", last_error=code, editorial_review_diagnostics=diagnostics)
            else:
                # An absent result is not a failed attempt: another worker may
                # still be generating. Recovery is longer than the producer's
                # cooperative budget, including time to record its outcome.
                retry_interval = PENDING_ATTEMPT_SECONDS
        if self.generation_owner == "external":
            # Observe the same validated durable outcome as the trusted writer.
            # An absent result can still be another worker in flight; invalid
            # or ambiguous durable outcomes have already failed closed above.
            # This branch never claims an attempt or invokes the generator.
            if datetime.fromtimestamp(self.clock(), JST).date().isoformat() != day:
                self._set("waiting", last_error=None, editorial_review_diagnostics=None)
                return
            self._set(result["status"] if finished_failure else "waiting_for_writer",
                      edition_date=day, cutoff_at=cutoff, attempt_count=len(attempts),
                      last_error=code, editorial_review_diagnostics=diagnostics)
            return
        # Storage lookups can span a window boundary. Use the actual invocation
        # time for both the retry decision and the durable attempt lease.
        now = self.clock()
        current = datetime.fromtimestamp(now, JST)
        minute = current.hour * 60 + current.minute
        if current.date().isoformat() != day or not 7 * 60 <= minute < 23 * 60:
            return
        if len(attempts) >= self.max_attempts:
            self._set("daily_limit")
            return
        if attempts and now < max(started for _, started in attempts) + retry_interval:
            return
        number = len(attempts) + 1
        claim = {"version": 1, "edition_date": day, "attempt": number, "started_at": now}
        if not self.storage.create(prefix + f"/attempt-{number}.lock", claim):
            return
        self._set("generating", attempt_count=number, editorial_review_diagnostics=None)
        result_path = prefix + f"/attempt-{number}.result.json"
        try:
            if manifest is None:
                generated = self.generator(now)
            else:
                from morning_news_window import manifest_window
                generated = self.generator(now, articles=deepcopy(manifest["articles"]),
                                           source_window=manifest_window(manifest, now))
            # Do not let a stalled/old worker publish after another worker can
            # recover its claim. This does not cancel an in-flight provider call.
            if self.clock() >= now + PENDING_ATTEMPT_SECONDS:
                raise ValueError("generation_deadline")
        except Exception as error:
            code = _safe_generation_error(error)
            diagnostics = safe_editorial_review_diagnostics(getattr(error, "editorial_review_diagnostics", None)
                if code == "isolated_editorial_review_failed" else None)
            result = {**claim, "status": "generation_failed", "last_error": code}
            if diagnostics is not None:
                result["editorial_review_diagnostics"] = diagnostics
            self._result(result_path, result)
            self._set("generation_failed", last_error=code, editorial_review_diagnostics=diagnostics)
            return
        try:
            issue = _valid_issue(generated, self.clock(), edition=day)
            release = current.replace(hour=8, minute=0, second=0, microsecond=0).timestamp()
            issue["publish_at"] = max(release, issue["reviewed_at"], issue.get("publish_at", 0), self.clock())
            issue = _valid_issue(issue, self.clock(), edition=day)
        except (ValueError, TypeError, OverflowError):
            self._result(result_path, {**claim, "status": "invalid_edition"})
            self._set("invalid_edition")
            return
        # Exactly one durable edition can win this date. On an ambiguous upload
        # failure, the next tick reads it before considering another paid call.
        created = self.storage.create(prefix + "/edition.json", issue)
        if not created:
            issue = _valid_issue(self.storage.read(prefix + "/edition.json"), self.clock(), edition=day)
        self._result(result_path, {**claim, "status": "persisted", "publish_at": issue["publish_at"]})
        self._ready(issue, self.clock())


def start(supabase=None, generator=None, *, enabled=False, url=None, key=None, storage=None,
          autostart=True, source_preparer_factory=None, generation_owner="local",
          max_attempts=MAX_ATTEMPTS, **kwargs):
    """Start without blocking Flask. Explicit ``enabled`` gates source/generation work.

    Pass ``url`` and the server service key, or a Supabase client exposing
    ``supabase_url``/``supabase_key``. Without storage, previous copy is retained.
    The injected storage protocol is ensure_private/read/create/recent_days/reviewed_keys.
    With Gunicorn preload, use autostart=False and call runtime.start() in each
    web worker (for example before_request); no master process thread is needed.
    External generation prepares sources and polls durable editions without
    claiming attempts or invoking the supplied generator.
    """
    if storage is None:
        url = url or getattr(supabase, "supabase_url", None)
        key = key or getattr(supabase, "supabase_key", None)
        try:
            storage = SupabaseNewsStorage(url, key)
        except (StorageUnavailable, ValueError):
            storage = None
    if storage is not None and source_preparer_factory is not None:
        kwargs["source_preparer"] = source_preparer_factory(storage)
    runtime = DailyNewsRuntime(storage, generator, enabled=enabled,
                               generation_owner=generation_owner, max_attempts=max_attempts, **kwargs)
    return runtime.start() if autostart else runtime

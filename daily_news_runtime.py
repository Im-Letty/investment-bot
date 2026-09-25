"""Prepare one daily website edition, persisting it before local publication.

The injected ``generator(unix_time)`` must be bounded to less than 15 minutes.
No LINE delivery or browser credentials are used by this module. Storage is a
private, server-only bucket; its immutable attempt records coordinate workers.
"""
from copy import deepcopy
from datetime import date, datetime
import base64
import json
import math
import os
from pathlib import Path
import re
from threading import Event, Lock, Thread
import time
from urllib.parse import quote, urlsplit

import requests

from news_cache import JST, _validated_digest, load_reviewed_digests
from publish_news import MAX_ISSUES, _publication_lock, _replace_atomically


BUCKET = "website-news"
CACHE_PATH = Path("/tmp/kn-daily-news.json")
BASELINE_PATH = Path(__file__).with_name("news-digests.json")
ATTEMPT_INTERVAL = 5 * 60
MAX_ATTEMPTS = 6
GENERATION_ERRORS = frozenset(("invalid_provider_json", "invalid_model", "gemini_incomplete",
                              "claude_incomplete", "no_eligible_topics", "invalid_article_selection",
                              "future_article", "invalid_edition", "no_verified_articles",
                              "edition_day_changed", "editorial_review_failed", "generation_failed"))


def _safe_generation_error(value):
    code = str(value)
    return code if (code in GENERATION_ERRORS or re.fullmatch(
        r"(?:(?:gemini|claude)_(?:http_[0-9]{3}|response_limit|unavailable)|gemini_(?:discovery|review)_(?:max_tokens|safety|recitation|language|other|blocklist|prohibited_content|spii|malformed_function_call|unexpected_tool_call|too_many_tool_calls|missing))", code)) else "generation_failed"


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

    def _request(self, method, path, **kwargs):
        headers = {**self._headers, **kwargs.pop("headers", {})}
        deadline, response = time.monotonic() + 30, None
        try:
            response = self._session.request(method, self._url + path, headers=headers,
                                             timeout=self._timeout, allow_redirects=False, stream=True, **kwargs)
            length = response.headers.get("Content-Length")
            if length is not None and (not length.isdecimal() or int(length) > 1_000_000):
                raise StorageUnavailable("storage_response")
            content = bytearray()
            while True:
                if time.monotonic() > deadline:
                    raise StorageUnavailable("storage_timeout")
                chunk = response.raw.read1(64 * 1024, decode_content=True)
                content.extend(chunk)
                if len(content) > 1_000_000 or time.monotonic() > deadline:
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

    def read(self, path):
        response = self._request("GET", "/object/authenticated/" + BUCKET + "/" + quote(path, safe="/"))
        if self._missing(response):
            return None
        if not 200 <= response.status_code < 300:
            raise StorageUnavailable("storage_read")
        return self._payload(response)

    def create(self, path, value):
        body = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
        if len(body) > 1_000_000:
            raise StorageUnavailable("storage_size")
        response = self._request("POST", "/object/" + BUCKET + "/" + quote(path, safe="/"), data=body,
                                 headers={"Content-Type": "application/json", "x-upsert": "false",
                                          "Cache-Control": "max-age=0"})
        if self._duplicate(response):
            return False
        if not 200 <= response.status_code < 300:
            raise StorageUnavailable("storage_write")
        return True

    def _list(self, prefix):
        response = self._request("POST", "/object/list/" + BUCKET,
                                 json={"prefix": prefix, "limit": MAX_ISSUES, "offset": 0,
                                       "sortBy": {"column": "name", "order": "desc"}})
        if not 200 <= response.status_code < 300:
            raise StorageUnavailable("storage_list")
        values = self._payload(response)
        if not isinstance(values, list):
            raise StorageUnavailable("storage_list")
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


class DailyNewsRuntime:
    """All public reads are in-memory; network/AI only runs in daemon workers."""

    def __init__(self, storage, generator, *, enabled=False, baseline_path=BASELINE_PATH,
                 cache_path=CACHE_PATH, clock=time.time, interval=30):
        self.storage, self.generator = storage, generator
        self.enabled = bool(enabled and callable(generator))
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
        if "last_error" not in metadata:
            if status in ("ready", "prepared", "generating"):
                metadata["last_error"] = None
            elif status in ("storage_unavailable", "cache_unavailable", "unavailable", "invalid_edition"):
                metadata["last_error"] = status
        with self._state_lock:
            self._state.update(status=status, **metadata)

    def snapshot(self):
        self._ensure_process()
        with self._state_lock:
            return dict(self._state)

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
                  publish_at=issue.get("publish_at", issue["reviewed_at"]))

    def _result(self, path, value):
        # The immutable claim, not this advisory outcome, enforces the budget.
        try:
            self.storage.create(path, value)
        except Exception:
            pass

    def _tick(self):
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
            self._ready(existing, now)
            return
        self._set("waiting", attempt_count=0)
        if not self.enabled:
            self._set("disabled")
            return
        if not 7 * 60 + 45 <= minute < 22 * 60:
            return
        attempts = []
        for index in range(1, MAX_ATTEMPTS + 1):
            claim = self.storage.read(prefix + f"/attempt-{index}.lock")
            if claim is None:
                continue
            started = claim.get("started_at") if isinstance(claim, dict) else None
            if (not isinstance(claim, dict) or claim.get("edition_date") != day or claim.get("attempt") != index
                    or isinstance(started, bool) or not isinstance(started, (int, float))
                    or not math.isfinite(started)
                    or datetime.fromtimestamp(started, JST).date().isoformat() != day):
                raise StorageUnavailable("storage_state")
            attempts.append((index, started))
        if [index for index, _ in attempts] != list(range(1, len(attempts) + 1)):
            raise StorageUnavailable("storage_state")
        self._set("waiting", attempt_count=len(attempts))
        if attempts:
            result = self.storage.read(prefix + f"/attempt-{len(attempts)}.result.json")
            if isinstance(result, dict) and result.get("status") in ("generation_failed", "invalid_edition"):
                self._set("waiting", last_error=_safe_generation_error(result.get("last_error", result["status"])))
        if len(attempts) >= MAX_ATTEMPTS:
            self._set("daily_limit")
            return
        if attempts and now < max(started for _, started in attempts) + ATTEMPT_INTERVAL:
            return
        number = len(attempts) + 1
        claim = {"version": 1, "edition_date": day, "attempt": number, "started_at": now}
        if not self.storage.create(prefix + f"/attempt-{number}.lock", claim):
            return
        self._set("generating", attempt_count=number)
        result_path = prefix + f"/attempt-{number}.result.json"
        try:
            generated = self.generator(now)
        except Exception as error:
            code = _safe_generation_error(error)
            self._result(result_path, {**claim, "status": "generation_failed", "last_error": code})
            self._set("generation_failed", last_error=code)
            return
        try:
            issue = _valid_issue(generated, self.clock(), edition=day)
            release = current.replace(hour=8, minute=0, second=0, microsecond=0).timestamp()
            issue["publish_at"] = max(release, issue["reviewed_at"], issue.get("publish_at", 0))
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
          autostart=True, **kwargs):
    """Start without blocking Flask. Explicit ``enabled`` gates paid generation.

    Pass ``url`` and the server service key, or a Supabase client exposing
    ``supabase_url``/``supabase_key``. Without storage, previous copy is retained.
    The injected storage protocol is ensure_private/read/create/recent_days/reviewed_keys.
    With Gunicorn preload, use autostart=False and call runtime.start() in each
    web worker (for example before_request); no master process thread is needed.
    """
    if storage is None:
        url = url or getattr(supabase, "supabase_url", None)
        key = key or getattr(supabase, "supabase_key", None)
        try:
            storage = SupabaseNewsStorage(url, key)
        except (StorageUnavailable, ValueError):
            storage = None
    runtime = DailyNewsRuntime(storage, generator, enabled=enabled, **kwargs)
    return runtime.start() if autostart else runtime

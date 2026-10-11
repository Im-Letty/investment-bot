"""Unpaid, immutable official-source polling, independent of publication time.

Only the injected collector fetches public originals. A poll cannot start a
writer, create a generation claim, or publish copy. Storage retains immutable
evidence; reads are bounded to three JST days and 128 distinct versions.
"""
from copy import deepcopy
from contextlib import contextmanager
from datetime import datetime, timedelta
from hashlib import sha256
import json
import re
import time
from urllib.parse import urlsplit

from morning_news_window import JST, MAX_ARTICLES, _number, _verified_article
from news_cache import OFFICIAL_NEWS_SOURCES
from official_boj_facts import valid_policy_fact_record
from official_news_sources import HOSTS, _article_path, _safe_url

PREFIX = "official-sources/v1"
POLL_SECONDS = 15 * 60
LEASE_SECONDS = 180
READ_DAYS = 3
MAX_VERSIONS = 128
READ_SECONDS = 12
_HASH = re.compile(r"[0-9a-f]{64}")
_FIELDS = ("source", "url", "title", "body_sha256", "published_date", "published_at",
           "publication_precision", "body_verified_at", "observed_at", "evidence_url",
           "source_scope", "supporting_documents", "publication_evidence",
           "event_date", "event_date_kind", "page_metadata_date",
           "policy_rate_percent", "original_body_sha256")
_ERRORS = frozenset(("unapproved_source", "source_time_limit", "unapproved_redirect",
    "source_unavailable", "source_content_type", "source_size_limit", "source_size_or_time_limit",
    "source_redirect_limit", "invalid_source_bytes", "unsupported_source_encoding",
    "unsupported_feed_declaration", "unsupported_feed_structure", "invalid_verification_clock",
    "supporting_pdf_link_missing", "supporting_pdf_identity_mismatch", "pdf_invalid",
    "pdf_parser_unavailable", "pdf_encrypted", "pdf_extraction_forbidden", "pdf_page_limit",
    "pdf_unreadable_page", "pdf_text_limit", "pdf_parse_failed", "pdf_time_limit",
    "source_read_failed", "body_or_date_unverified", "boj_policy_facts_unverified"))


def _hash(value):
    return sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                             separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _slot(now):
    if not _number(now) or now <= 0:
        raise ValueError("invalid_source_cache_time")
    current = datetime.fromtimestamp(now, JST)
    return current.date().isoformat(), (current.hour * 60 + current.minute) // 15


def _slot_start(day, slot):
    return datetime.fromisoformat(day).replace(tzinfo=JST).timestamp() + slot * POLL_SECONDS


def _diagnostics(value):
    """Never persist upstream exception strings or arbitrary diagnostic keys."""
    value = value if isinstance(value, dict) else {}
    result = {}
    for source in OFFICIAL_NEWS_SOURCES:
        row = value.get(source)
        row = row if isinstance(row, dict) else {}
        result[source] = {
            "feed_status": row.get("feed_status") if row.get("feed_status") in
                ("ok", "failed", "not_completed") else "not_completed",
            "status": row.get("status") if row.get("status") in
                ("fetch_incomplete", "feed_failed", "no_matching_candidates", "collected",
                 "collected_partial", "articles_unavailable") else "fetch_incomplete",
            "errors": [],
        }
        errors = row.get("errors", [])
        errors = errors if isinstance(errors, (list, tuple)) else ["source_read_failed"]
        result[source]["errors"] = sorted({error if isinstance(error, str) and error in _ERRORS
            else "source_read_failed" for error in errors[:len(_ERRORS)]})
        for field, maximum in (("candidates", 120), ("selected", 20), ("completed", 20),
                               ("accepted", 20), ("returned", MAX_ARTICLES)):
            count = row.get(field)
            if type(count) is int and 0 <= count <= maximum:
                result[source][field] = count
    return result


def _article(value, now):
    if (not _verified_article(value) or value.get("source") not in OFFICIAL_NEWS_SOURCES
            or not 100 <= len(value["body"]) <= 30_000 or len(value["title"]) > 1000
            or value["body_verified_at"] > now or _safe_url(value["url"]) != value["url"]
            or HOSTS.get(urlsplit(value["url"]).hostname) != value["source"]
            or not _article_path(urlsplit(value["url"]).hostname, urlsplit(value["url"]).path)):
        raise ValueError("invalid_source_cache_article")
    if value.get('source') == '日本銀行' and not valid_policy_fact_record(value):
        raise ValueError("invalid_source_cache_article")
    row = {field: deepcopy(value[field]) for field in _FIELDS if field in value}
    row["body"] = value["body"]
    if "observed_at" in row and (not _number(row["observed_at"])
            or not 0 < row["observed_at"] <= row["body_verified_at"]):
        raise ValueError("invalid_source_cache_article")
    if "evidence_url" in row and (_safe_url(row["evidence_url"]) != row["evidence_url"]
            or urlsplit(row["evidence_url"]).hostname != urlsplit(row["url"]).hostname):
        raise ValueError("invalid_source_cache_article")
    # Collector provenance may contain inspected attachment/archive evidence.
    # Its metadata stays private and cannot expand the bounded storage record.
    if len(json.dumps({k: v for k, v in row.items() if k != "body"},
                      ensure_ascii=False, allow_nan=False).encode()) > 16_384:
        raise ValueError("invalid_source_cache_article")
    return row


def _version(row):
    return _hash({k: v for k, v in row.items() if k not in
                  ("body", "body_verified_at", "observed_at", "requires_correction_review")})


class OfficialNewsCache:
    def __init__(self, storage, collector, *, clock=time.time):
        self.storage, self.collector, self.clock = storage, collector, clock
        self._seen_slots, self._indexes, self._before_indexes = set(), {}, {}
        self._versions, self._bodies, self._identities = {}, {}, {}
        self._claims = {}
        self._read_deadline = self._monotonic_deadline = None
        self._status = {"status": "not_checked", "poll_seconds": POLL_SECONDS,
                        "read_days": READ_DAYS, "max_versions": MAX_VERSIONS,
                        "last_checked_at": None, "source_status": _diagnostics({})}

    def operational_snapshot(self):
        return deepcopy(self._status)

    def _prune(self, now):
        today = datetime.fromtimestamp(now, JST).date()
        days = {(today - timedelta(days=index)).isoformat() for index in range(READ_DAYS)}
        self._seen_slots = {key for key in self._seen_slots if key[0] in days}
        self._indexes = {key: value for key, value in self._indexes.items() if key in days}
        self._before_indexes = {key: value for key, value in self._before_indexes.items() if key[0] in days}
        for values in (self._versions, self._bodies, self._identities, self._claims):
            while len(values) > MAX_VERSIONS:
                values.pop(next(iter(values)))

    def _check_read_budget(self):
        if self._read_deadline is not None and (self.clock() >= self._read_deadline
                or time.monotonic() >= self._monotonic_deadline):
            raise ValueError("source_cache_read_deadline")

    @contextmanager
    def _read_budget(self):
        previous = self._read_deadline, self._monotonic_deadline
        self._read_deadline = self.clock() + READ_SECONDS
        self._monotonic_deadline = time.monotonic() + READ_SECONDS
        try:
            yield
        finally:
            self._read_deadline, self._monotonic_deadline = previous

    def _read_options(self):
        self._check_read_budget()
        if self._read_deadline is None:
            return {}
        remaining = min(self._read_deadline - self.clock(),
                        self._monotonic_deadline - time.monotonic())
        # The storage transport must stop in-flight I/O, not merely report
        # that an unbounded request exceeded the budget after it returns.
        return {"deadline": time.monotonic() + remaining}

    @staticmethod
    def _transport_read(operation, *args, **options):
        try:
            return operation(*args, **options)
        except Exception as error:
            if str(error) == "storage_deadline":
                raise ValueError("source_cache_read_deadline") from None
            raise

    def _read(self, path):
        value = self._transport_read(self.storage.read, path, **self._read_options())
        self._check_read_budget()
        return value

    def _list(self, prefix, *, offset=0):
        value = self._transport_read(self.storage._list, prefix, offset=offset,
                                     **self._read_options())
        self._check_read_budget()
        return value

    def _create(self, path, value):
        known = self._read(path)
        if known is None:
            known = value if self.storage.create(path, value) else self._read(path)
        return known

    def _remember(self, value, now, claim):
        row = _article(value, now)
        digest, version = row["body_sha256"], _version(row)
        if digest not in self._bodies:
            body = self._create(f"{PREFIX}/bodies/{digest}.json",
                                {"version": 1, "body_sha256": digest, "body": row["body"]})
            if body != {"version": 1, "body_sha256": digest, "body": row["body"]}:
                raise ValueError("invalid_source_cache_body")
            self._bodies[digest] = row["body"]
        if version not in self._versions:
            document = self._create(f"{PREFIX}/versions/{version}.json",
                {"version": 1, "version_id": version,
                 "first_poll": deepcopy(claim),
                 "article": {k: v for k, v in row.items() if k != "body"}})
            self._load_version(version, now, document)
        self._identity(self._versions[version], version, now, create=True)
        return version

    def _identity(self, row, version, now, *, create=False):
        identity = sha256((row["url"] + "\n" + row["published_date"]).encode()).hexdigest()
        if identity not in self._identities:
            path = f"{PREFIX}/identities/{identity}.json"
            value = {"version": 1, "url": row["url"], "published_date": row["published_date"],
                     "first_version_id": version, "first_verified_at": row["body_verified_at"]}
            known = self._create(path, value) if create else self._read(path)
            if (not isinstance(known, dict) or type(known.get("version")) is not int or known.get("version") != 1
                    or known.get("url") != row["url"] or known.get("published_date") != row["published_date"]
                    or not isinstance(known.get("first_version_id"), str)
                    or not _HASH.fullmatch(known["first_version_id"])
                    or not _number(known.get("first_verified_at"))
                    or not 0 < known["first_verified_at"] <= now):
                raise ValueError("invalid_source_cache_identity")
            self._identities[identity] = known
        return self._identities[identity]

    def _load_version(self, version, now, document=None):
        if version not in self._versions:
            document = document if document is not None else self._read(f"{PREFIX}/versions/{version}.json")
            if (not isinstance(document, dict) or type(document.get("version")) is not int or document.get("version") != 1
                    or document.get("version_id") != version or not isinstance(document.get("article"), dict)):
                raise ValueError("invalid_source_cache_version")
            row = deepcopy(document["article"])
            first_poll = document.get("first_poll")
            if not isinstance(first_poll, dict):
                raise ValueError("invalid_source_cache_verification")
            first_day, first_slot = first_poll.get("day"), first_poll.get("slot")
            if not isinstance(first_day, str) or type(first_slot) is not int or not 0 <= first_slot < 96:
                raise ValueError("invalid_source_cache_verification")
            self._validate_claim(first_poll, first_day, first_slot, now)
            path = f"{PREFIX}/polls/{first_day}/{first_slot:02d}.lock"
            if path not in self._claims:
                self._claims[path] = self._read(path)
            if self._claims[path] != first_poll:
                raise ValueError("invalid_source_cache_verification")
            digest = row.get("body_sha256")
            if not isinstance(digest, str) or not _HASH.fullmatch(digest):
                raise ValueError("invalid_source_cache_body")
            if digest not in self._bodies:
                body = self._read(f"{PREFIX}/bodies/{digest}.json")
                if (not isinstance(body, dict) or type(body.get("version")) is not int or body.get("version") != 1
                        or body.get("body_sha256") != digest or not isinstance(body.get("body"), str)
                        or sha256(body["body"].encode()).hexdigest() != digest):
                    raise ValueError("invalid_source_cache_body")
                self._bodies[digest] = body["body"]
            row["body"] = self._bodies[digest]
            row = _article(row, now)
            if _version(row) != version:
                raise ValueError("invalid_source_cache_version")
            if not first_poll["started_at"] <= row["body_verified_at"] <= first_poll["started_at"] + LEASE_SECONDS:
                raise ValueError("invalid_source_cache_verification")
            if "observed_at" in row and row["observed_at"] < first_poll["started_at"]:
                raise ValueError("invalid_source_cache_verification")
            self._versions[version] = row
        row = deepcopy(self._versions[version])
        if row["body_verified_at"] > now:
            raise ValueError("invalid_source_cache_version")
        return row

    def collect(self, now):
        """At most one unpaid poll per slot, across processes and restarts."""
        started = self.clock()
        day, slot = _slot(started)
        if _slot(now) != (day, slot):
            raise ValueError("invalid_source_cache_time")
        self._prune(started)
        if (day, slot) in self._seen_slots:
            return self.operational_snapshot()
        with self._read_budget():
            previous = self._day_index(day, started, refresh=True)
        self._seen_slots.add((day, slot))
        claim = {"version": 1, "day": day, "slot": slot, "started_at": started}
        prefix = f"{PREFIX}/polls/{day}/{slot:02d}"
        if not self.storage.create(prefix + ".lock", claim):
            self._indexes.pop(day, None)
            return self.operational_snapshot()
        self._indexes.pop(day, None)
        diagnostics = {}
        try:
            since = (datetime.fromtimestamp(started, JST).replace(hour=0, minute=0, second=0,
                     microsecond=0) - timedelta(days=READ_DAYS - 1)).timestamp()
            articles = self.collector(started, since=since, until=started, diagnostics=diagnostics)
            finished = self.clock()
            if (not isinstance(articles, list) or len(articles) > MAX_ARTICLES
                    or any(not _verified_article(row) for row in articles)):
                raise ValueError("invalid_source_cache_article")
            articles = [_article(row, finished) for row in articles]
            if any(row["body_verified_at"] < started for row in articles):
                raise ValueError("invalid_source_cache_verification")
        except Exception:
            articles = []
            diagnostics = {name: {"feed_status": "failed", "status": "articles_unavailable",
                                  "errors": ["source_read_failed"]} for name in OFFICIAL_NEWS_SOURCES}
        versions = []
        for row in articles:
            if self.clock() > started + LEASE_SECONDS:
                raise ValueError("source_cache_deadline")
            versions.append(self._remember(row, self.clock(), claim))
        finished = self.clock()
        if not started <= finished <= started + LEASE_SECONDS:
            raise ValueError("source_cache_deadline")
        day_versions = set(previous["result"]["day_version_ids"] if previous["result"] else ()) | set(versions)
        verified_at = deepcopy(previous["result"]["day_version_verified_at"] if previous["result"] else {})
        verified_at.update({version: self._versions[version]["body_verified_at"] for version in versions})
        if len(day_versions) > MAX_VERSIONS:
            raise ValueError("source_cache_capacity")
        result = {**claim, "finished_at": finished, "version_ids": sorted(set(versions)),
                  "day_version_ids": sorted(day_versions),
                  "day_version_verified_at": verified_at,
                  "source_status": _diagnostics(diagnostics)}
        if not self.storage.create(prefix + ".json", result):
            raise ValueError("invalid_source_cache_poll")
        self._indexes[day] = {"result": result, "latest": result, "checked_at": finished}
        self._status.update(status="checked", last_checked_at=finished,
                            source_status=deepcopy(result["source_status"]))
        self._prune(finished)
        return self.operational_snapshot()

    def _day_index(self, day, now, *, refresh=False, through=None):
        """Find the last completed cumulative index with bounded pagination.

        A day has at most 96 claims and 96 results. Usually one 30-entry
        page suffices; a long run of missing results must not prevent a
        fresh poll or silently lose the earlier verified originals.
        """
        indexes = self._indexes if through is None else self._before_indexes
        key = day if through is None else (day, through)
        cached = indexes.get(key)
        if cached is not None and not refresh:
            latest = cached["latest"]
            pending = latest and "finished_at" not in latest
            historical = day < _slot(now)[0]
            same_slot = _slot(cached["checked_at"]) == _slot(now)
            if ((historical or same_slot) and (not pending or now - cached["checked_at"] < 30)):
                return cached
        prefix = f"{PREFIX}/polls/{day}"
        available = []
        seen = set()
        last_name = None
        for offset in range(0, 192, 30):
            entries = self._list(prefix, offset=offset)
            if not isinstance(entries, list) or len(entries) > 30:
                raise ValueError("invalid_source_cache_index")
            for entry in entries:
                name = entry.get("name") if isinstance(entry, dict) else None
                if (not isinstance(name, str)
                        or not re.fullmatch(r"(?:[0-8][0-9]|9[0-5])\.(?:json|lock)", name)
                        or name in seen or (last_name is not None and name >= last_name)):
                    raise ValueError("invalid_source_cache_index")
                seen.add(name)
                last_name = name
                slot = int(name[:2])
                if _slot_start(day, slot) > now or len(seen) > 192:
                    raise ValueError("invalid_source_cache_index")
                if through is None or _slot_start(day, slot) < through:
                    available.append((slot, name[3:]))
            if len(entries) < 30 or any(extension == "json" for _, extension in available):
                break
        else:
            raise ValueError("source_cache_index_unavailable")
        result_slots = [slot for slot, extension in available if extension == "json"]
        result = latest = None
        if result_slots:
            slot = max(result_slots)
            path = f"{prefix}/{slot:02d}"
            result = self._read(path + ".json")
            claim = self._read(path + ".lock")
            self._validate_poll(result, claim, day, slot, now)
            if through is not None and result["started_at"] >= through:
                result = None
            latest = result
        if available:
            slot = max(slot for slot, _ in available)
            if latest is None or slot > latest["slot"]:
                latest = self._read(f"{prefix}/{slot:02d}.lock")
                self._validate_claim(latest, day, slot, now)
                if through is not None and latest["started_at"] >= through:
                    latest = None
        cached = {"result": result, "latest": latest, "checked_at": now}
        indexes[key] = cached
        return cached

    def snapshot(self, now, *, through=None):
        """Read-only originals for a frozen manifest or future reviewed updates."""
        with self._read_budget():
            return self._snapshot(now, through=through)

    def _snapshot(self, now, *, through=None):
        day, _ = _slot(now)
        if through is not None and (not _number(through) or not 0 < through <= now):
            raise ValueError("invalid_source_cache_time")
        first_day = datetime.fromisoformat(day).date() - timedelta(days=READ_DAYS - 1)
        days = [(first_day + timedelta(days=index)).isoformat() for index in range(READ_DAYS)]
        self._prune(now)
        polls, health_polls, claims = [], [], []
        for current_day in days:
            index = self._day_index(current_day, now)
            if index["result"]:
                polls.append(index["result"])
            health = index
            if through is not None and index["latest"] and index["latest"]["started_at"] >= through:
                health = self._day_index(current_day, now, through=through)
            if health["result"]:
                health_polls.append(health["result"])
            if health["latest"] and "finished_at" not in health["latest"]:
                claims.append(health["latest"])
        verified_at = {version: stamp for poll in polls for version, stamp in poll["day_version_verified_at"].items()
                       if through is None or stamp <= through}
        versions = set(verified_at)
        if len(versions) > MAX_VERSIONS:
            raise ValueError("source_cache_capacity")
        rows = []
        for version in sorted(versions):
            row = self._load_version(version, now)
            if row["body_verified_at"] != verified_at[version]:
                raise ValueError("invalid_source_cache_version")
            identity = self._identity(row, version, now)
            if identity["first_version_id"] != version:
                row["requires_correction_review"] = True
            else:
                if identity["first_verified_at"] != row["body_verified_at"]:
                    raise ValueError("invalid_source_cache_identity")
            rows.append(row)
        # Retain only evidence referenced by the bounded read window.
        self._versions = {version: self._versions[version] for version in versions}
        self._bodies = {row["body_sha256"]: row["body"] for row in rows}
        identities = {sha256((row["url"] + "\n" + row["published_date"]).encode()).hexdigest() for row in rows}
        self._identities = {key: value for key, value in self._identities.items() if key in identities}
        latest = max(health_polls + claims, key=lambda row: row["started_at"], default=None)
        pending = bool(latest and "finished_at" not in latest and now < latest["started_at"] + LEASE_SECONDS)
        status = deepcopy(latest["source_status"]) if latest and "finished_at" in latest else _diagnostics({})
        if latest and "finished_at" not in latest and not pending:
            status["preparation"] = {"feed_status": "not_completed", "status": "source_unavailable",
                                     "errors": ["cache_slot_result_missing"]}
        checked = latest.get("finished_at") if latest else None
        late_verification = bool(through is not None and any(
            poll["started_at"] < through < poll["finished_at"]
            and any(stamp > through for stamp in poll["day_version_verified_at"].values())
            for poll in health_polls))
        if through is None:
            self._status.update(status="pending" if pending else "checked" if checked else "not_completed",
                                last_checked_at=checked, source_status=deepcopy(status))
        return {"articles": rows, "source_status": status, "pending": pending,
                "last_checked_at": checked, "late_verification_pending": late_verification}

    @staticmethod
    def _validate_claim(value, day, slot, now):
        if (not isinstance(value, dict) or type(value.get("version")) is not int
                or value.get("version") != 1 or value.get("day") != day
                or value.get("slot") != slot or not _number(value.get("started_at"))
                or not _slot_start(day, slot) <= value["started_at"] < _slot_start(day, slot) + POLL_SECONDS
                or value["started_at"] > now):
            raise ValueError("invalid_source_cache_poll")

    @classmethod
    def _validate_poll(cls, value, claim, day, slot, now):
        cls._validate_claim(value, day, slot, now)
        if (not isinstance(claim, dict) or any(claim.get(k) != value[k] for k in
                ("version", "day", "slot", "started_at")) or not _number(value.get("finished_at"))
                or not value["started_at"] <= value["finished_at"] <= min(now, value["started_at"] + LEASE_SECONDS)
                or not isinstance(value.get("version_ids"), list) or len(value["version_ids"]) > MAX_ARTICLES
                or any(not isinstance(v, str) or not _HASH.fullmatch(v) for v in value["version_ids"])
                or len(set(value["version_ids"])) != len(value["version_ids"])
                or not isinstance(value.get("day_version_ids"), list)
                or len(value["day_version_ids"]) > MAX_VERSIONS
                or any(not isinstance(v, str) or not _HASH.fullmatch(v) for v in value["day_version_ids"])
                or len(set(value["day_version_ids"])) != len(value["day_version_ids"])
                or not set(value["version_ids"]).issubset(value["day_version_ids"])
                or not isinstance(value.get("day_version_verified_at"), dict)
                or set(value["day_version_verified_at"]) != set(value["day_version_ids"])
                or any(not _number(stamp) or not 0 < stamp <= value["finished_at"]
                       for stamp in value["day_version_verified_at"].values())
                or value.get("source_status") != _diagnostics(value.get("source_status"))):
            raise ValueError("invalid_source_cache_poll")

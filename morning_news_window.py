"""Freeze verified morning sources before any paid generation.

No clocks, collectors or storage are created at import time. Immutable storage
claims bound collection across restarts; no source is fetched after the cutoff.
"""
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
import math
import time
from urllib.parse import urlsplit

JST = timezone(timedelta(hours=9))
SLOT_MINUTES = (0, 5, 10, 15, 20, 25, 29)
COLLECTION_LEASE_SECONDS = 90
MAX_ARTICLES = 8
WINDOW_FIELDS = ("version", "edition_date", "window_start", "carryover_start", "cutoff_at")
DEFERRED_REASONS = ("late_verification", "review_failed", "omitted")


def _number(value):
    return type(value) in (int, float) and math.isfinite(value)


def morning_window(now):
    if not _number(now):
        raise ValueError("invalid_preparation_time")
    current = datetime.fromtimestamp(now, JST)
    previous = current - timedelta(days=1)
    return {"version": 1, "edition_date": current.date().isoformat(),
            "window_start": previous.replace(hour=8, minute=0, second=0, microsecond=0).timestamp(),
            "carryover_start": previous.replace(hour=7, minute=30, second=0, microsecond=0).timestamp(),
            "cutoff_at": current.replace(hour=7, minute=30, second=0, microsecond=0).timestamp()}


def _verified_article(row):
    try:
        if not isinstance(row, dict):
            return False
        if any(not isinstance(row.get(k), str) or not row[k].strip() for k in ("source", "url", "title", "body", "body_sha256", "published_date")):
            return False
        url = urlsplit(row["url"])
        if url.scheme != "https" or not url.hostname or url.username or url.password:
            return False
        if len(row["body"]) > 30_000 or sha256(row["body"].encode()).hexdigest() != row["body_sha256"]:
            return False
        day = date.fromisoformat(row["published_date"])
        if day.isoformat() != row["published_date"] or not _number(row.get("body_verified_at")):
            return False
        verified = row["body_verified_at"]
        if verified <= 0 or datetime.fromtimestamp(verified, JST).date() < day:
            return False
        stamp = row.get("published_at")
        if row.get("publication_precision") == "day":
            return stamp is None
        return (row.get("publication_precision") == "second" and _number(stamp)
                and stamp <= verified and datetime.fromtimestamp(stamp, JST).date() == day)
    except (ValueError, TypeError, OverflowError, OSError):
        return False


def _normal_route(article, window):
    if article["publication_precision"] == "day":
        day = date.fromisoformat(article["published_date"])
        edition = date.fromisoformat(window["edition_date"])
        return "date_only" if edition - timedelta(days=1) <= day <= edition else None
    stamp = article["published_at"]
    if window["window_start"] <= stamp <= window["cutoff_at"]:
        return "main"
    if window["carryover_start"] < stamp < window["window_start"]:
        return "carryover"
    return None


def _deferred_route(article, window):
    previous = morning_window(window["cutoff_at"] - 86400)
    if (article.get("deferred_from") != previous["edition_date"]
            or article.get("deferred_reason") not in DEFERRED_REASONS
            or not _normal_route(article, previous)
            or (article["publication_precision"] != "day"
                and article["published_at"] < previous["window_start"])):
        return False
    return (article["deferred_reason"] != "late_verification"
            or article["body_verified_at"] > previous["cutoff_at"])


def published_references(issues, now):
    """Only durably published issues count; preparation never consumes a story."""
    refs = []
    for issue in issues:
        if not isinstance(issue, dict):
            continue
        release = issue.get("publish_at", issue.get("reviewed_at"))
        if (_number(release) and release <= now and issue.get("publication_mode") == "curated"
                and isinstance(issue.get("article_refs"), list)):
            refs.extend(ref for ref in issue["article_refs"] if isinstance(ref, dict))
    return refs


def _publication_identity(row):
    day = row.get("published_date")
    if day is None and _number(row.get("published_at")):
        day = datetime.fromtimestamp(row["published_at"], JST).date().isoformat()
    return row.get("url"), day


def _revision_identities(articles):
    by_identity = {}
    flagged = set()
    for row in articles:
        if not _verified_article(row):
            continue
        identity = _publication_identity(row)
        by_identity.setdefault(identity, set()).add((row["source"], row["body_sha256"], row["published_at"], row["title"]))
        if row.get("requires_correction_review"):
            flagged.add(identity)
    return flagged | {identity for identity, versions in by_identity.items() if len(versions) > 1}


def select_articles(articles, window, published_issues=()):
    """Pure bounded selection; preserve dates, reject revisions and duplicates."""
    valid = [deepcopy(row) for row in articles if _verified_article(row)]
    by_identity = {}
    for row in valid:
        by_identity.setdefault(_publication_identity(row), []).append(row)
    revisions = _revision_identities(valid)
    published_ids = {_publication_identity(ref) for ref in published_references(published_issues, window["cutoff_at"])}
    selected = []
    for identity, versions in by_identity.items():
        # A changed body on the same publication day needs correction review.
        # Official latest-release URLs may be reused for a genuinely newer date.
        if identity in published_ids or identity in revisions:
            continue
        row = deepcopy(min(versions, key=lambda v: v["body_verified_at"]))
        # Keep the earliest verified timestamp, while retaining explicit evidence
        # for a previous edition's deferral when this version was seen again.
        row.pop("deferred_from", None)
        row.pop("deferred_reason", None)
        deferred = next((v for v in versions if _deferred_route(
            {**row, "deferred_from": v.get("deferred_from"), "deferred_reason": v.get("deferred_reason")}, window)), None)
        if deferred:
            row.update(deferred_from=deferred["deferred_from"], deferred_reason=deferred["deferred_reason"])
        if row["body_verified_at"] > window["cutoff_at"]:
            continue
        route = _normal_route(row, window)
        if route is None and _deferred_route(row, window):
            route = "deferred"
        if route:
            row["selection_route"] = route
            selected.append(row)
    # Date-only stories never acquire a guessed time merely for sorting.
    selected.sort(key=lambda row: (row["published_date"], row["source"], row["url"]), reverse=True)
    # If a reusable latest-release URL has two eligible dated versions, use its
    # latest verified publication; one public link must not stand for two bodies.
    by_url = {}
    for row in selected:
        by_url.setdefault(row["url"], row)
    return list(by_url.values())[:MAX_ARTICLES]


def _source_status(value):
    # The collector already emits enums/counts; keep only its bounded fields.
    result = {}
    if not isinstance(value, dict):
        return result
    for source, row in list(value.items())[:8]:
        if not isinstance(source, str) or len(source) > 80 or not isinstance(row, dict):
            continue
        result[source] = {key: deepcopy(row[key]) for key in
                          ("feed_status", "status", "candidates", "selected", "completed", "accepted", "returned", "errors")
                          if key in row}
    return result


class MorningNewsPreparer:
    def __init__(self, storage, collector, *, clock=time.time):
        self.storage, self.collector, self.clock = storage, collector, clock
        self._seen_slots = set()
        self._manifests = {}

    @staticmethod
    def _prefix(day):
        return f"days/{day}/preparation"

    def _remember_identity(self, article, started):
        """Remember each original publication, including reusable release URLs."""
        row = deepcopy(article)
        identity_fields = ("source", "url", "body_sha256", "published_date", "published_at", "publication_precision")
        identity = {key: row[key] for key in identity_fields}
        key = row["url"] + "\n" + row["published_date"]
        path = "source-identities/v1/" + sha256(key.encode()).hexdigest() + ".json"
        known = self.storage.read(path)
        if known is None:
            proposed = {"version": 1, **identity, "first_seen_at": started,
                        "first_verified_at": row["body_verified_at"]}
            known = proposed if self.storage.create(path, proposed) else self.storage.read(path)
        if (not isinstance(known, dict) or known.get("version") != 1 or known.get("url") != row["url"]
                or not _number(known.get("first_seen_at")) or not _number(known.get("first_verified_at"))
                or known["first_verified_at"] > self.clock()):
            raise ValueError("invalid_source_identity")
        if any(known.get(key) != value for key, value in identity.items()):
            row["requires_correction_review"] = True
        else:
            row["body_verified_at"] = min(row["body_verified_at"], known["first_verified_at"])
        return row

    def _snapshots(self, day, now, *, wait=False):
        prefix = self._prefix(day)
        snapshots, pending, expired = [], False, []
        for slot in range(len(SLOT_MINUTES)):
            claim = self.storage.read(f"{prefix}/slot-{slot}.lock")
            if claim is None:
                continue
            started = claim.get("started_at") if isinstance(claim, dict) else None
            claim_window = morning_window(started) if _number(started) else None
            offset = SLOT_MINUTES[slot] * 60
            end_offset = SLOT_MINUTES[slot + 1] * 60 if slot + 1 < len(SLOT_MINUTES) else 1800
            if (not _number(started) or claim.get("edition_date") != day or claim.get("slot") != slot
                    or claim_window["edition_date"] != day
                    or not claim_window["cutoff_at"] - 1800 + offset <= started < claim_window["cutoff_at"] - 1800 + end_offset):
                raise ValueError("invalid_source_snapshot")
            value = self.storage.read(f"{prefix}/slot-{slot}.json")
            if value is None:
                pending |= wait and now < started + COLLECTION_LEASE_SECONDS
                if now >= started + COLLECTION_LEASE_SECONDS:
                    expired.append(slot)
                continue
            if (not isinstance(value, dict) or value.get("edition_date") != day or value.get("slot") != slot
                    or value.get("started_at") != started or not _number(value.get("finished_at"))
                    or not started <= value["finished_at"] <= now or not isinstance(value.get("articles"), list)
                    or len(value["articles"]) > MAX_ARTICLES or not isinstance(value.get("source_status"), dict)
                    or any(not _verified_article(row) or row["body_verified_at"] > value["finished_at"]
                           for row in value["articles"])):
                raise ValueError("invalid_source_snapshot")
            snapshots.append(value)
        return snapshots, pending, expired

    def _deferred(self, window, issues, now):
        previous = morning_window(window["cutoff_at"] - 86400)
        day = previous["edition_date"]
        snapshots, _, _ = self._snapshots(day, now)
        # Retain old same-day versions as evidence of corrections, even when
        # those versions no longer fit the current publication window.
        rows = [deepcopy(row) for snapshot in snapshots for row in snapshot["articles"]]
        for snapshot in snapshots:
            for article in snapshot["articles"]:
                if (_verified_article(article) and not article.get("deferred_from")
                        and _normal_route(article, previous)
                        and article["body_verified_at"] > previous["cutoff_at"]):
                    rows.append({**article, "deferred_from": day, "deferred_reason": "late_verification"})
        frozen = self.storage.read(self._prefix(day) + "/manifest.json")
        if frozen is None:
            return rows
        self._validate_manifest(frozen, previous)
        rows.extend(deepcopy(frozen["articles"]))
        published_previous = any(issue.get("edition_date") == day and published_references([issue], now) for issue in issues)
        failed = False
        if not published_previous:
            for attempt in range(1, 7):
                outcome = self.storage.read(f"days/{day}/attempt-{attempt}.result.json")
                claim = self.storage.read(f"days/{day}/attempt-{attempt}.lock") if outcome is not None else None
                if (isinstance(outcome, dict) and outcome.get("edition_date") == day
                        and outcome.get("attempt") == attempt
                        and isinstance(claim, dict) and claim.get("edition_date") == day
                        and claim.get("attempt") == attempt and _number(claim.get("started_at"))
                        and claim["started_at"] == outcome.get("started_at")
                        and outcome.get("status") in ("generation_failed", "invalid_edition")):
                    failed = True
        reason = "omitted" if published_previous else "review_failed" if failed else None
        if reason:
            rows.extend({**row, "deferred_from": day, "deferred_reason": reason}
                        for row in frozen["articles"] if not row.get("deferred_from") and _normal_route(row, previous))
        return rows

    @staticmethod
    def _validate_manifest(value, window):
        if (not isinstance(value, dict) or any(value.get(k) != v for k, v in window.items())
                or not isinstance(value.get("articles"), list) or len(value["articles"]) > MAX_ARTICLES
                or not isinstance(value.get("source_status"), dict)
                or select_articles(value["articles"], window) != value["articles"]):
            raise ValueError("invalid_source_manifest")

    def prepare(self, now, published_issues=()):
        window = morning_window(now)
        day, cutoff = window["edition_date"], window["cutoff_at"]
        if now < cutoff - 30 * 60:
            return None
        if day in self._manifests:
            return deepcopy(self._manifests[day]) if now >= cutoff else None
        prefix = self._prefix(day)
        frozen = self.storage.read(prefix + "/manifest.json")
        if frozen is not None:
            self._validate_manifest(frozen, window)
            self._manifests = {day: frozen}
            return deepcopy(frozen) if now >= cutoff else None
        if now < cutoff:
            minute = int((now - (cutoff - 30 * 60)) // 60)
            slot = max(index for index, start in enumerate(SLOT_MINUTES) if minute >= start)
            if (day, slot) in self._seen_slots:
                return None
            started = self.clock()
            if not cutoff - 30 * 60 <= started < cutoff:
                return None
            claim = {"version": 1, "edition_date": day, "slot": slot, "started_at": started}
            if not self.storage.create(f"{prefix}/slot-{slot}.lock", claim):
                self._seen_slots.add((day, slot))
                return None
            self._seen_slots.add((day, slot))
            diagnostics = {}
            try:
                since = datetime.fromtimestamp(window["window_start"], JST).replace(hour=0).timestamp()
                articles = self.collector(started, since=since, until=cutoff, diagnostics=diagnostics)
                if not isinstance(articles, list) or len(articles) > MAX_ARTICLES:
                    raise ValueError("invalid_collector_output")
                articles = [deepcopy(row) for row in articles if _verified_article(row)]
            except Exception:
                articles = []
                diagnostics = {"collection": {"status": "source_unavailable", "feed_status": "failed"}}
            # A storage error here must propagate; it must not silently discard
            # identity evidence while allowing a new paid publication attempt.
            articles = [self._remember_identity(row, started) for row in articles]
            finished = self.clock()
            self.storage.create(f"{prefix}/slot-{slot}.json", {**claim, "finished_at": finished,
                                "articles": articles, "source_status": _source_status(diagnostics)})
            return None
        snapshots, pending, expired = self._snapshots(day, now, wait=True)
        if pending:
            return None
        rows = [row for snapshot in snapshots for row in snapshot["articles"]]
        rows += self._deferred(window, published_issues, now)
        status = {}
        for snapshot in snapshots:
            status.update(snapshot["source_status"])
        if not snapshots:
            status = {"collection": {"status": "not_prepared", "feed_status": "not_completed"}}
        revisions = _revision_identities(rows)
        if expired or revisions:
            # Successful earlier polls do not prove the final poll completed,
            # and a revision awaiting review is not a normal empty news day.
            status["preparation"] = {"feed_status": "not_completed", "status": "source_unavailable",
                                     "errors": (["slot_result_missing"] if expired else [])
                                               + (["correction_review_required"] if revisions else []),
                                     "expired_slots": expired, "correction_count": len(revisions)}
        manifest = {**window, "articles": select_articles(rows, window, published_issues), "source_status": status}
        if not self.storage.create(prefix + "/manifest.json", manifest):
            manifest = self.storage.read(prefix + "/manifest.json")
        self._validate_manifest(manifest, window)
        self._manifests = {day: manifest}
        return deepcopy(manifest)

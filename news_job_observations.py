"""Bounded advisory normal-job receipts, independent of claims and publication.

Writers append once inside their existing allowance. Background readers poll
only these fixed metadata objects. A public request reads memory only. Missing
or failed observations never buy a retry, hide an old article, or mean zero.
"""
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import math
import re
import time

JST = timezone(timedelta(hours=9))
PREFIX = "news-job-observations/v1"
SCOPES = ("morning", "intraday", "company")
STATES = ("publication_confirmed", "prepared", "candidate_confirmed", "no_eligible_articles", "no_publication",
          "partially_published", "review_failed", "generation_failed", "check_failed", "daily_limit", "in_progress")
MAX_LIST = 30
READ_SECONDS = 4
READ_INTERVAL = 900
_NAME = re.compile(r"run-([0-9]{20})\.json")
_COMPANY_REVIEW_FAILURE = re.compile(r"company_review_failed_(?:gemini|openai)_(?:company_identity|facts|dates|readable|distinct_topics|no_invented_outlook|original_wording|approval|schema)")


def _number(value):
    return type(value) in (int, float) and math.isfinite(value)


def _date(value):
    try:
        return value if isinstance(value, str) and date.fromisoformat(value).isoformat() == value else None
    except ValueError:
        return None


def _state(scope, value):
    status = value.get("status")
    if status == "published" and type(value.get("published_count")) is int and value["published_count"] > 0:
        return "publication_confirmed"
    if status == "partially_published":
        return "partially_published"  # The generic writer catch also includes upload failures.
    if scope == "company" and status == "review_failed":
        error = value.get("last_error")
        return ("review_failed" if isinstance(error, str) and _COMPANY_REVIEW_FAILURE.fullmatch(error)
                else "check_failed")
    if scope == "morning" and status in ("ready", "prepared") and value.get("success") is True:
        return "publication_confirmed" if status == "ready" else "prepared"
    if scope == "morning" and status == "source_empty" and value.get("success") is True:
        return "no_eligible_articles"
    if scope == "intraday" and status == "ready" and value.get("eligibility_checked") is True:
        return "candidate_confirmed"
    if status == "no_new_release":
        return ("no_eligible_articles" if scope == "intraday" and value.get("source_health_verified") is True
                and value.get("eligibility_checked") is True else "no_publication")
    if status in ("review_failed", "invalid_edition") or value.get("last_error") == "isolated_editorial_review_failed":
        return "review_failed"
    if status == "generation_failed":
        return "generation_failed"
    if status == "daily_limit":
        return "daily_limit"
    if status in ("source_pending", "collecting", "generating", "waiting_for_writer", "waiting"):
        return "in_progress"
    return "check_failed"


def project(scope, value, started, finished):
    if (scope not in SCOPES or not isinstance(value, dict) or not _number(started)
            or not _number(finished) or not 0 < started <= finished <= 253402268399
            or finished - started > 86400):
        return None
    if value.get("status") in ("outside_morning_window", "outside_intraday_window", "disabled", "retry_not_allowed"):
        return None
    day = datetime.fromtimestamp(started, JST).date().isoformat()
    state = _state(scope, value)
    # The normal morning caller already requires state.edition_date==target day
    # before reporting success. Keep the same boundary in this advisory writer:
    # an old/reused edition cannot become a current-day publication observation.
    if (scope == "morning" and state in ("publication_confirmed", "prepared", "no_eligible_articles")
            and _date(value.get("edition_date")) != day):
        state = "check_failed"
    result = {"version": 1, "scope": scope, "edition_date": day,
              "started_at": started, "finished_at": finished, "state": state}
    for field, maximum in (("attempt_count", 6 if scope == "morning" else 3), ("published_count", 3 if scope == "company" else 1)):
        number = value.get(field)
        if type(number) is int and 0 <= number <= maximum:
            result[field] = number
    # A failed source snapshot has not established zero eligible articles or
    # zero attempts, even if an internal report initialized those fields to 0.
    if scope == "intraday" and value.get("eligibility_checked") is not True:
        result.pop("attempt_count", None)
        result.pop("published_count", None)
    return result


def write_once(storage, scope, value, started, finished):
    """Best effort within the caller's existing private Storage deadline."""
    result = project(scope, value, started, finished)
    if result is None or storage is None:
        return False
    day = result["edition_date"]
    name = f"run-{int(finished * 1_000_000):020d}.json"
    try:
        return storage.create(f"{PREFIX}/{scope}/{day}/{name}", result) is True
    except Exception:
        return False  # An advisory write cannot change an actual job outcome.


def validate(value, scope, day, name, now):
    if not isinstance(value, dict) or set(value) - {"version", "scope", "edition_date", "started_at", "finished_at", "state", "attempt_count", "published_count"}:
        return None
    if (type(value.get("version")) is not int or value["version"] != 1 or value.get("scope") != scope
            or value.get("edition_date") != day or _date(day) is None
            or not isinstance(value.get("state"), str) or value["state"] not in STATES
            or not _number(value.get("started_at")) or not _number(value.get("finished_at"))
            or not 0 < value["started_at"] <= value["finished_at"] <= now
            or value["finished_at"] - value["started_at"] > 86400
            or datetime.fromtimestamp(value["started_at"], JST).date().isoformat() != day
            or name != f"run-{int(value['finished_at'] * 1_000_000):020d}.json"):
        return None
    for field, maximum in (("attempt_count", 6 if scope == "morning" else 3), ("published_count", 3 if scope == "company" else 1)):
        if field in value and (type(value[field]) is not int or not 0 <= value[field] <= maximum):
            return None
    return deepcopy(value)


class ObservationCache:
    def __init__(self, storage, scopes, *, monotonic=time.monotonic):
        self.storage = storage
        self.scopes = tuple(scope for scope in SCOPES if scope in scopes)
        self.monotonic = monotonic
        self.last_refresh = None
        self.values = {scope: {"state": "unavailable"} for scope in self.scopes}

    def snapshot(self):
        return deepcopy(self.values)

    def refresh(self, now):
        if self.last_refresh is not None and 0 <= now - self.last_refresh < READ_INTERVAL:
            return
        self.last_refresh = now
        listing = getattr(self.storage, "_list", None)
        if not callable(listing):
            return  # Explicit in-memory test adapters may have no list method.
        expiry = self.monotonic() + READ_SECONDS
        for scope in self.scopes:
            previous = self.values[scope]
            try:
                found = None
                for offset in (0, 1):
                    if self.monotonic() >= expiry:
                        raise ValueError("observation_deadline")
                    day = (datetime.fromtimestamp(now, JST).date() - timedelta(days=offset)).isoformat()
                    prefix = f"{PREFIX}/{scope}/{day}"
                    rows = listing(prefix, deadline=expiry)
                    if (not isinstance(rows, list) or len(rows) > MAX_LIST or any(
                            not isinstance(row, dict) or not isinstance(row.get("name"), str)
                            or not _NAME.fullmatch(row["name"]) for row in rows)):
                        raise ValueError("invalid_observation_list")
                    if rows:
                        name = max(row["name"] for row in rows)
                        found = validate(self.storage.read(f"{prefix}/{name}", deadline=expiry), scope, day, name, now)
                        if found is None:
                            raise ValueError("invalid_observation")
                        break
                self.values[scope] = ({**found, "read_state": "checked", "checked_at": now}
                                      if found else {"state": "unavailable", "read_state": "checked", "checked_at": now})
            except Exception:
                self.values[scope] = {**previous, "read_state": "failed", "checked_at": now}

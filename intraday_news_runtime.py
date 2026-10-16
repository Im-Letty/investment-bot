"""Bounded daytime updates from verified official originals, never web requests.

Only the private cloud CLI invokes this module. A check may refresh the unpaid
original cache, but cannot claim an AI attempt, authenticate a writer or publish.
One new important story gets the existing two independent final-copy reviews.
"""
from copy import deepcopy
from datetime import datetime, timedelta
from hashlib import sha256
import math
import re
import time

from daily_news_runtime import BASELINE_PATH, StorageUnavailable, _safe_generation_error
from morning_news_window import JST, _verified_article
from news_cache import OFFICIAL_NEWS_SOURCES, _validated_digest, load_reviewed_digests
from official_news_cache import MAX_READ_SECONDS, OfficialNewsCache, _article, _diagnostics as source_diagnostics
from website_news import collect_website_sources
from official_boj_facts import valid_policy_fact_record
from news_review_diagnostics import safe_editorial_review_diagnostics

PREFIX = "intraday-news/v1"
MAX_ATTEMPTS = 3
MAX_REVIEWED_KEYS = 12
HISTORY_DAYS = 3
FRESH_SECONDS = 20 * 60
HISTORY_SECONDS = 12
JOB_SECONDS = 18 * 60
GENERATION_SECONDS = 12 * 60
_HASH = re.compile(r"[0-9a-f]{64}")
_REVIEWED_KEY = re.compile(r"days/(\d{4}-\d{2}-\d{2})/reviewed-[0-9]{20}\.json")
_ROUTINE = re.compile(r"公表予定|発表予定|掲載予定|スケジュール|日程一覧|更新情報|サイト更新|調査へのご協力|採用情報|入札公告|講演会|説明会|イベント|統計の見方|統計の利用")
_SCHEDULE = re.compile(r"公表予定|発表予定|掲載予定|スケジュール|日程一覧")
_THEMES = (
    ("fiscal_policy", re.compile(r"減税|増税|税制|消費税|所得税|法人税|補正予算|経済対策|財政支援|緊急支援|災害支援|為替介入")),
    ("economic_statistics", re.compile(r"消費者物価|物価指数|家計調査|家計支出|消費支出|失業率|労働力調査|雇用統計|国内総生産|GDP|貿易統計")),
)
_POLICY_RESULT = re.compile(r"決定|閣議決定|実施|施行|導入|成立|可決|引き上げ|引き下げ|変更|実行|措置|発動")
_STAT_RESULT = re.compile(r"前年比|前年同月|前月比|増加|減少|上昇|低下|増え|減っ|上が|下が")
_NUMBER = re.compile(r"[0-9０-９]+(?:[.,．][0-9０-９]+)?\s*(?:[%％]|円|兆|億|万|ポイント)")
_SAFE_FAILURES = frozenset((
    "storage_budget", "storage_deadline", "storage_response", "storage_network",
    "storage_bucket", "storage_private_required", "storage_read", "storage_write",
    "storage_list", "storage_size", "intraday_history_invalid", "intraday_history_deadline",
    "intraday_history_capacity", "intraday_claim_invalid", "invalid_intraday_time",
    "invalid_intraday_snapshot", "invalid_source_cache_time", "invalid_source_cache_article",
    "invalid_source_cache_body", "invalid_source_cache_identity", "invalid_source_cache_version",
    "invalid_source_cache_verification", "invalid_source_cache_poll", "invalid_source_cache_index",
    "source_cache_read_deadline", "source_cache_deadline", "source_cache_capacity",
    "source_cache_index_unavailable"))


def _safe_cache_reads(value):
    """Only bounded numeric diagnostics; never a storage key or source body."""
    if not isinstance(value, dict):
        return {}
    result = {}
    for key, maximum in (("read_seconds", MAX_READ_SECONDS), ("elapsed_seconds", JOB_SECONDS)):
        number = value.get(key)
        if type(number) in (int, float) and math.isfinite(number) and 0 <= number <= maximum:
            result[key] = number
    for key, maximum in (("read_count", 1024), ("list_count", 32)):
        number = value.get(key)
        if type(number) is int and 0 <= number <= maximum:
            result[key] = number
    if type(value.get("deadline_exceeded")) is bool:
        result["deadline_exceeded"] = value["deadline_exceeded"]
    return result


def _failure_code(error):
    # Only codes emitted by owned validators/transports. Never reflect an
    # upstream exception, response, URL, credentials or Python traceback.
    code = str(error) if isinstance(error, (ValueError, StorageUnavailable)) else None
    return code if code in _SAFE_FAILURES else "job_unavailable"


def _number(value):
    return type(value) in (int, float) and math.isfinite(value) and value > 0


def intraday_window(now):
    if not _number(now):
        raise ValueError("invalid_intraday_time")
    current = datetime.fromtimestamp(now, JST)
    if not 9 <= current.hour < 23:
        return None
    return {"version": 2, "kind": "intraday", "edition_date": current.date().isoformat(),
            "window_start": current.replace(hour=7, minute=30, second=0, microsecond=0).timestamp(),
            "cutoff_at": now}


def article_identity(row):
    """Body changes cannot create a second paid claim for the same release."""
    return sha256((row["url"] + "\n" + row["published_date"]).encode()).hexdigest()


def importance(row):
    """A deterministic discovery hint; the original and both reviews decide copy.

    A schedule or generic notice without an actual result is never urgent. A
    meaningful result inside a notice still requires the same two final reviews.
    """
    title, body = row.get("title", ""), row.get("body", "")
    if not isinstance(title, str) or not isinstance(body, str):
        return None
    if _SCHEDULE.search(title):
        return None
    if row.get('source') == '日本銀行':
        return 'monetary_policy' if valid_policy_fact_record(row) else None
    for category, pattern in _THEMES:
        if not pattern.search(title + "\n" + body) or not pattern.search(body):
            continue
        result = (_POLICY_RESULT.search(body) if category == "fiscal_policy"
                  else _STAT_RESULT.search(body) and _NUMBER.search(body))
        if result and (not _ROUTINE.search(title) or pattern.search(title) and result):
            return category
    return None


def _healthy_snapshot(snapshot, now):
    if not isinstance(snapshot, dict) or snapshot.get("pending") is True:
        return False
    checked, rows = snapshot.get("last_checked_at"), snapshot.get("source_status")
    return (_number(checked) and 0 <= now - checked <= FRESH_SECONDS
            and datetime.fromtimestamp(checked, JST).date() == datetime.fromtimestamp(now, JST).date()
            and isinstance(rows, dict) and set(OFFICIAL_NEWS_SOURCES).issubset(rows)
            and all(isinstance(rows[name], dict) and rows[name].get("feed_status") == "ok"
                    and rows[name].get("status") in ("collected", "no_matching_candidates")
                    and rows[name].get("errors", []) == [] for name in OFFICIAL_NEWS_SOURCES))


def _references(issue):
    return {(ref["url"], ref.get("published_date") or
             datetime.fromtimestamp(ref["published_at"], JST).date().isoformat())
            for ref in issue["article_refs"]}


def published_identities(storage, now, *, baseline_path=BASELINE_PATH):
    """Read every bounded immutable revision; latest-only history loses stories."""
    today = datetime.fromtimestamp(now, JST).date()
    allowed_days = {(today - timedelta(days=index)).isoformat() for index in range(HISTORY_DAYS)}
    deadline = time.monotonic() + HISTORY_SECONDS
    identities = set()

    def add(value, day=None):
        issue = _validated_digest(value)
        if (issue is None or issue.get("publication_mode") != "curated"
                or day is not None and issue["edition_date"] != day
                or issue["reviewed_at"] > now):
            raise StorageUnavailable("intraday_history_invalid")
        if issue.get("publish_at", issue["reviewed_at"]) <= now:
            identities.update(_references(issue))

    for issue in load_reviewed_digests(baseline_path):
        if issue["edition_date"] in allowed_days:
            add(issue)
    for day in sorted(allowed_days, reverse=True):
        if time.monotonic() >= deadline:
            raise StorageUnavailable("intraday_history_deadline")
        original = storage.read(f"days/{day}/edition.json", deadline=deadline)
        if original is not None:
            add(original, day)
        listing = getattr(storage, "_list", None)
        if callable(listing):
            keys = []
            for offset in (0, 30, 60):
                items = listing(f"days/{day}", offset=offset, deadline=deadline)
                if not isinstance(items, list) or len(items) > 30:
                    raise StorageUnavailable("intraday_history_capacity")
                keys.extend(f"days/{day}/{item['name']}" for item in items
                            if isinstance(item, dict) and isinstance(item.get("name"), str)
                            and re.fullmatch(r"reviewed-[0-9]{20}\.json", item["name"]))
                if len(items) < 30:
                    break
            else:
                raise StorageUnavailable("intraday_history_capacity")
        else:
            keys = storage.reviewed_keys(day)
        if (not isinstance(keys, list) or len(keys) > MAX_REVIEWED_KEYS
                or len(set(keys)) != len(keys)
                or any(not isinstance(key, str) or not _REVIEWED_KEY.fullmatch(key)
                       or _REVIEWED_KEY.fullmatch(key)[1] != day for key in keys)):
            raise StorageUnavailable("intraday_history_capacity")
        for key in sorted(keys):
            value = storage.read(key, deadline=deadline)
            if value is None:
                raise StorageUnavailable("intraday_history_invalid")
            add(value, day)
    return identities


def select_candidate(snapshot, window, published):
    now, day = window["cutoff_at"], window["edition_date"]
    rows = snapshot.get("articles")
    if not isinstance(rows, list) or len(rows) > 128:
        raise ValueError("invalid_intraday_snapshot")
    candidates, versions = [], {}
    for original in rows:
        if not isinstance(original, dict) or not _verified_article(original):
            raise ValueError("invalid_intraday_snapshot")
        row = _article(deepcopy(original), now)
        if original.get("requires_correction_review") is True:
            row["requires_correction_review"] = True
        identity = (row["url"], row["published_date"])
        versions.setdefault(identity, set()).add(row["body_sha256"])
        if (row["published_date"] != day or identity in published
                or row.get("requires_correction_review") is True
                or row["body_verified_at"] < window["window_start"]):
            continue
        if row["publication_precision"] == "second" and row["published_at"] < window["window_start"]:
            continue
        category = importance(row)
        if category:
            row["selection_route"] = "intraday"
            candidates.append((category, row))
    candidates = [(category, row) for category, row in candidates
                  if len(versions[(row["url"], row["published_date"])]) == 1]
    # Prefer policy decisions, then newest first; no invented publication times.
    candidates.sort(key=lambda item: (0 if item[0] in ("fiscal_policy", "monetary_policy") else 1,
                    -(item[1]["published_at"] or item[1]["body_verified_at"]), item[1]["url"]))
    seen = set()
    unique = []
    for category, row in candidates:
        identifier = article_identity(row)
        if identifier not in seen:
            seen.add(identifier)
            unique.append((category, row))
    return unique


def _receipt(issue, normalized, now):
    from news_review_receipt import valid_receipt
    receipt = issue.get("review_receipt")
    if (not valid_receipt(receipt, normalized) or not _number(receipt.get("reviewed_at"))
            or receipt["reviewed_at"] > now):
        raise ValueError("intraday_review_receipt_required")
    clean = {key: receipt[key] for key in
             ("content_sha256", "gemini_approved", "openai_approved", "reviewed_at")}
    payload_hash = receipt.get("review_payload_sha256")
    if payload_hash is not None:
        if not isinstance(payload_hash, str) or not _HASH.fullmatch(payload_hash):
            raise ValueError("intraday_review_receipt_required")
        clean["review_payload_sha256"] = payload_hash
    source_hashes = receipt.get("source_body_sha256")
    if source_hashes is not None:
        if source_hashes != [ref["body_sha256"] for ref in normalized["article_refs"]]:
            raise ValueError("intraday_review_receipt_required")
        clean["source_body_sha256"] = list(source_hashes)
    return clean


def run_job(storage, generator=None, *, cache=None, clock=time.time, preflight=None,
            check_only=False, baseline_path=BASELINE_PATH, expected_day=None, progress=None):
    """One eligible article, at most three durable attempts in each JST day."""
    started, mono_started = clock(), time.monotonic()
    current = datetime.fromtimestamp(started, JST)
    day = current.date().isoformat()
    report = {"schema_version": 1, "report_kind": "private_intraday_writer",
              "edition_date": day, "status": "no_new_release", "eligible_count": 0,
              "published_count": 0, "attempt_count": 0, "check_only": bool(check_only),
              "phase": "configuration", "eligibility_checked": False,
              "source_health_verified": False,
              "job_started_at": current.isoformat(timespec="seconds")}

    def phase(value):
        report["phase"] = value
        if callable(progress):
            progress(deepcopy(report))

    def outcome(status=None, **fields):
        if status is not None:
            report["status"] = status
        report.update(fields)
        if callable(progress):
            progress(deepcopy(report))
        return deepcopy(report)

    def cache_observations():
        reader = getattr(cache, "safe_read_diagnostics", None)
        if callable(reader):
            try:
                values = _safe_cache_reads(reader())
                if values:
                    report["source_cache_reads"] = values
            except Exception:
                pass  # Advisory diagnostics cannot mask the original failure.
        observer = getattr(cache, "safe_observations", None)
        if not callable(observer):
            return
        try:
            values = observer()
        except Exception:
            return  # Advisory counters must not mask the original failure.
        if not isinstance(values, dict):
            return
        safe = {name: values[name] for name in
                ("legacy_two_source_polls", "legacy_three_source_polls", "concurrent_read_records")
                if type(values.get(name)) is int and 0 <= values[name] <= 128}
        if safe:
            report["source_cache_observations"] = safe

    phase("configuration")
    window = intraday_window(started)
    if window is None or expected_day is not None and expected_day != day:
        return outcome("outside_intraday_window")

    def same_day():
        now = clock()
        return (_number(now) and datetime.fromtimestamp(now, JST).date().isoformat() == day
                and time.monotonic() < mono_started + JOB_SECONDS)

    def save_result(path, value):
        try:
            storage.create(path, value)
        except Exception:
            pass  # Advisory only; immutable claims remain authoritative.

    try:
        phase("storage_private_check")
        storage.ensure_private()
        # A cold CLI process restores several days of immutable originals.
        # Its read budget remains inside the caller's existing 180-second
        # check deadline; interactive/morning cache readers keep 12 seconds.
        cache = cache if cache is not None else OfficialNewsCache(
            storage, collect_website_sources, clock=clock, read_seconds=MAX_READ_SECONDS)
        cache_observations()
        phase("source_collection")
        cache.collect(clock())
        cache_observations()
        now = clock()
        if not same_day() or intraday_window(now) is None:
            return outcome("outside_intraday_window")
        window = intraday_window(now)
        phase("source_snapshot")
        snapshot = cache.snapshot(now)
        cache_observations()
        phase("source_validation")
        report["source_status"] = source_diagnostics(snapshot.get("source_status"))
        if snapshot.get("pending") is True:
            return outcome("source_pending")
        if not _healthy_snapshot(snapshot, now):
            return outcome("source_unavailable")
        report["source_health_verified"] = True
        phase("published_history")
        published = published_identities(storage, now, baseline_path=baseline_path)
        phase("source_validation")
        candidates = select_candidate(snapshot, window, published)
        claims = []
        phase("claim_validation")
        for slot in range(1, MAX_ATTEMPTS + 1):
            claim = storage.read(f"{PREFIX}/days/{day}/attempt-{slot}.json")
            if claim is not None:
                if (not isinstance(claim, dict) or claim.get("edition_date") != day
                        or claim.get("attempt") != slot or not _number(claim.get("started_at"))
                        or datetime.fromtimestamp(claim["started_at"], JST).date().isoformat() != day
                        or not isinstance(claim.get("article_id"), str) or not _HASH.fullmatch(claim["article_id"])):
                    raise StorageUnavailable("intraday_claim_invalid")
                claims.append(slot)
        report["attempt_count"] = len(claims)
        if len(claims) >= MAX_ATTEMPTS:
            report["eligibility_checked"] = True
            return outcome("daily_limit")
        phase("candidate_selection")
        chosen = next(((category, row) for category, row in candidates
                       if storage.read(f"{PREFIX}/seen/{article_identity(row)}.json") is None), None)
        report["eligibility_checked"] = True
        if chosen is None:
            phase("outcome")
            return outcome()
        category, source = chosen
        report.update(eligible_count=1, source_article_count=1, source_date_counts={day: 1},
                      source_precision=source["publication_precision"], category=category,
                      article_id=article_identity(source), source_body_sha256=source["body_sha256"],
                      source_checked_at=snapshot["last_checked_at"])
        if check_only:
            phase("outcome")
            return outcome("ready")
        if not callable(generator) or not callable(preflight):
            return outcome("configuration_unavailable")
        phase("subscription_login")
        preflight()  # Read-only login status, only after an eligible new release.
        if not same_day() or intraday_window(clock()) is None:
            return outcome("outside_intraday_window")
        if time.monotonic() + GENERATION_SECONDS + 60 >= mono_started + JOB_SECONDS:
            return outcome("generation_window_exhausted")
        claim = {"schema_version": 1, "edition_date": day, "article_id": report["article_id"],
                 "source_body_sha256": source["body_sha256"], "started_at": clock()}
        slot = next((number for number in range(1, MAX_ATTEMPTS + 1)
                     if storage.create(f"{PREFIX}/days/{day}/attempt-{number}.json", {**claim, "attempt": number})), None)
        if slot is None:
            return outcome("daily_limit", attempt_count=MAX_ATTEMPTS)
        report["attempt_count"] = max(report["attempt_count"] + 1, slot)
        result_path = f"{PREFIX}/days/{day}/result-{slot}.json"
        if not storage.create(f"{PREFIX}/seen/{report['article_id']}.json", {**claim, "attempt": slot}):
            save_result(result_path, {**claim, "attempt": slot, "status": "already_claimed"})
            return outcome("no_new_release", eligible_count=0)
        generation_started = clock()
        phase("generation")
        try:
            issue = generator(generation_started, articles=[deepcopy(source)], source_window=deepcopy(window))
            now = clock()
            if not same_day() or now >= generation_started + GENERATION_SECONDS:
                raise ValueError("generation_deadline")
            normalized = _validated_digest(issue)
            ref_fields = ("source", "url", "title", "published_at", "published_date",
                          "publication_precision", "body_sha256", "body_verified_at", "selection_route")
            if (normalized is None or normalized.get("publication_mode") != "curated"
                    or normalized["edition_date"] != day or normalized.get("source_window") != window
                    or normalized["reviewed_at"] < generation_started or normalized["reviewed_at"] > now
                    or len(normalized["article_refs"]) != 1
                    or any(normalized["article_refs"][0].get(key) != source.get(key) for key in ref_fields)):
                raise ValueError("invalid_edition")
            receipt = _receipt(issue, normalized, now)
        except Exception as error:
            code = _safe_generation_error(error)
            diagnostics = safe_editorial_review_diagnostics(getattr(error, "editorial_review_diagnostics", None)
                if code == "isolated_editorial_review_failed" else None)
            fields = {"last_error": code}
            if diagnostics is not None:
                fields["editorial_review_diagnostics"] = diagnostics
            save_result(result_path, {**claim, "attempt": slot, "status": "review_failed", **fields})
            return outcome("review_failed", **fields)
        # Both approvals are complete. A storage timeout now cannot truthfully
        # be called a review failure: the remote write may already have won.
        report.update(reviewed_at=normalized["reviewed_at"], review_receipt=receipt,
                      publication_attempted_at=now)
        phase("publication")
        normalized["publish_at"] = now
        normalized["review_receipt"] = receipt
        key = f"days/{day}/reviewed-{int(normalized['reviewed_at'] * 1_000_000):020d}.json"
        midnight = (datetime.fromtimestamp(now, JST).replace(hour=0, minute=0, second=0,
                    microsecond=0) + timedelta(days=1)).timestamp()
        deadline = min(time.monotonic() + HISTORY_SECONDS, mono_started + JOB_SECONDS,
                       time.monotonic() + max(0, midnight - clock()))
        confirmed = False
        try:
            confirmed = storage.create(key, normalized, deadline=deadline) is True
        except Exception:
            pass
        if not confirmed:
            try:
                # One bounded read-back only; never replay the AI or overwrite
                # the immutable record after an ambiguous transport response.
                confirmed = storage.read(key, deadline=deadline) == normalized
            except Exception:
                pass
        if not confirmed:
            save_result(result_path, {**claim, "attempt": slot, "status": "publication_unconfirmed",
                        "reviewed_at": normalized["reviewed_at"], "review_receipt": receipt,
                        "publication_attempted_at": now})
            return outcome("publication_unconfirmed")
        save_result(result_path, {**claim, "attempt": slot, "status": "published",
                                 "publish_at": now, "review_receipt": receipt})
        phase("outcome")
        return outcome("published", published_count=1, publish_at=now)
    except StorageUnavailable as error:
        cache_observations()
        return outcome("storage_unavailable", last_error=_failure_code(error))
    except Exception as error:
        cache_observations()
        return outcome("job_unavailable", last_error=_failure_code(error))

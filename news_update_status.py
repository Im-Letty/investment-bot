"""Passive, fixed-field public observations; never collect or invoke a writer.

An available old article is not a successful run today. Source collection,
reviewed copy and externally owned job outcomes remain separate observations.
"""
from datetime import date, datetime, timedelta, timezone
import math

JST = timezone(timedelta(hours=9))


def _day(value):
    if not isinstance(value, str):
        return None
    try:
        return value if date.fromisoformat(value).isoformat() == value else None
    except ValueError:
        return None


def _stamp(value, now):
    return value if type(value) in (int, float) and math.isfinite(value) and 0 < value <= now else None


def _base(data, now, release_hour):
    edition = _day(data.get("edition_date"))
    if edition and edition > datetime.fromtimestamp(now, JST).date().isoformat():
        edition = None
    expected = (datetime.fromtimestamp(now, JST) - timedelta(hours=release_hour)).date().isoformat()
    return {"version": 1, "edition_date": edition, "expected_edition_date": expected,
            "publication_state": "current" if edition and edition >= expected else "previous" if edition else "unconfirmed",
            "display_checked_at": now}


def _job_result(value, now):
    from news_job_observations import STATES
    if not isinstance(value, dict):
        return None
    state = value.get("state")
    result = {"state": state if isinstance(state, str) and state in STATES else "unavailable"}
    day = _day(value.get("edition_date"))
    if day:
        result["edition_date"] = day
    stamp = _stamp(value.get("finished_at"), now)
    if stamp is not None:
        result["observed_at"] = stamp
    if value.get("read_state") == "failed":
        result["observation_failed"] = True
    for field, maximum in (("attempt_count", 6), ("published_count", 3)):
        if type(value.get(field)) is int and 0 <= value[field] <= maximum:
            result[field] = value[field]
    return result


def economic_update_status(data, runtime=None, *, now):
    """Project an already selected public edition and process-memory runtime.

    The external intraday writer has no job receipt in this web snapshot. Do
    not fabricate its result from a healthy feed or yesterday's public copy.
    """
    runtime = runtime if isinstance(runtime, dict) else {}
    result = _base(data, now, 8)
    digest = data.get("digest") if isinstance(data.get("digest"), dict) else {}
    published = data.get("delivery") == "published" and digest.get("publication_mode") == "curated"
    if not published:
        result["publication_state"] = "unconfirmed"
    result["published_at"] = _stamp(digest.get("publish_at"), now) if published else None
    result["source_checked_at"] = _stamp(data.get("source_fetched_at", data.get("fetched_at")), now)
    runtime_day = _day(runtime.get("edition_date"))
    status, error = runtime.get("status"), runtime.get("last_error")
    state = "unavailable"
    # Only the runtime's explicit, fully checked source_empty outcome means
    # no eligible originals. A missing/unhealthy source never takes this path.
    if status == "source_empty":
        state = "no_eligible_articles"
    elif status == "generation_failed":
        state = "review_failed" if error == "isolated_editorial_review_failed" else "generation_failed"
    elif status in ("invalid_edition",):
        state = "review_failed"
    elif status in ("source_unavailable", "storage_unavailable", "cache_unavailable", "unavailable", "configuration_unavailable"):
        state = "check_failed"
    elif status == "daily_limit":
        state = "daily_limit"
    elif status in ("collecting", "freezing", "generating", "prepared"):
        state = "in_progress"
    elif status == "ready" and runtime_day == result["edition_date"] and published:
        state = "publication_confirmed"
    # The day and observed-at qualify this state; it is not called today's
    # outcome when a worker still contains a previous day's observation.
    result["morning_result"] = {"state": state, "edition_date": runtime_day,
                                 "observed_at": _stamp(runtime.get("observed_at"), now)}
    jobs = runtime.get("job_results") if isinstance(runtime.get("job_results"), dict) else {}
    if isinstance(jobs.get("morning"), dict) and jobs["morning"].get("state") != "unavailable":
        result["morning_result"] = _job_result(jobs["morning"], now)
    elif isinstance(jobs.get("morning"), dict) and jobs["morning"].get("read_state") == "failed":
        result["morning_result"]["observation_failed"] = True
    result["intraday_result"] = _job_result(jobs.get("intraday"), now) or {"state": "unavailable"}
    return result


def company_update_status(data, *, now, error=False, normal_result=None):
    result = _base(data, now, 9)
    if not data.get("companies"):
        result["edition_date"] = None
        result["publication_state"] = "unconfirmed"
    result["published_at"] = None  # reviewed_at is not a publication receipt.
    result["source_checked_at"] = _stamp(data.get("checked_at"), now)
    result["publication_checked_at"] = _stamp(data.get("publication_checked_at"), now)
    result["source_state"] = ("check_failed" if error else "partial" if data.get("collection_health") == "partial"
                               else "checked" if result["source_checked_at"] is not None else "unavailable")
    result["normal_result"] = _job_result(normal_result, now) or {"state": "unavailable"}
    return result


RESULT_LABELS = {
    "no_eligible_articles": "対象記事なし（取得元の確認済み）",
    "review_failed": "審査で停止", "generation_failed": "生成で停止（詳細未提供）",
    "check_failed": "確認に失敗", "daily_limit": "当日の試行上限に到達",
    "in_progress": "処理中", "publication_confirmed": "掲載を確認",
    "prepared": "原稿準備済み・公開待ち", "candidate_confirmed": "掲載候補を確認（未公開）",
    "partially_published": "一部公開・残りは確認未完",
    "no_publication": "新規掲載なし（対象候補の有無は未確認）",
    "unavailable": "結果未提供",
}


def economic_status_lines(status):
    """Japanese SSR copy; the browser maps the same fixed enum contract."""
    day = _day(status.get("edition_date"))
    edition = day.replace("-", "/") + "版" if day else "掲載版は未確認"
    state = {"current": "新しい掲載を確認", "previous": "新しい掲載は未確認・前回分を表示",
             "unconfirmed": "公開記事は未確認"}.get(status.get("publication_state"), "公開記事は未確認")
    lines = [("掲載状況", edition + " · " + state)]
    for key, title in (("morning_result", "朝の通常処理"), ("intraday_result", "日中の通常処理")):
        value = status.get(key) if isinstance(status.get(key), dict) else {}
        day = _day(value.get("edition_date"))
        label = RESULT_LABELS.get(value.get("state"), RESULT_LABELS["unavailable"])
        if type(value.get("published_count")) is int and 0 < value["published_count"] <= 3:
            label += f" · {value['published_count']}件掲載"
        if value.get("observation_failed") is True:
            label += " · 最新の処理結果は確認できません"
        lines.append((title, (day.replace("-", "/") + " · " if day else "") + label))
        stamp = _stamp(value.get("observed_at"), status.get("display_checked_at", 0))
        if stamp is not None:
            lines.append((title + "の確認時刻", datetime.fromtimestamp(stamp, JST).strftime("%Y/%m/%d %H:%M JST")))
    for key, title in (("published_at", "公開開始"), ("source_checked_at", "取得元の確認"), ("display_checked_at", "表示確認")):
        stamp = _stamp(status.get(key), status.get("display_checked_at", 0))
        if stamp is not None:
            lines.append((title, datetime.fromtimestamp(stamp, JST).strftime("%Y/%m/%d %H:%M JST")))
    return lines

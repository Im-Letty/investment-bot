#!/usr/bin/env python3
"""Refresh the current Nikkei 225 members from Nikkei's dated official CSV.

Only names and security codes are retained, not index weights/adjustment factors.
Announcements are evidence metadata, never instructions to apply a future change.
Run from the repository root: python scripts/update_nikkei225.py
The backend may call update_universe(output_path=...) in its daily worker; an
exception leaves the last verified file intact.
"""

from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import re
import tempfile
from datetime import date, datetime
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from zoneinfo import ZoneInfo


JST = ZoneInfo("Asia/Tokyo")
SOURCE_URL = "https://indexes.nikkei.co.jp/nkave/archives/file/nikkei_225_price_adjustment_factor_jp.csv"
COMPONENT_URL = "https://indexes.nikkei.co.jp/nkave/index/component?idx=nk225"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "static" / "nikkei225-universe.json"
MAX_BYTES = 256 * 1024
FETCH_TIMEOUT = 12
MAX_SOURCE_AGE_DAYS = 14
CODE_RE = re.compile(r"[1-9][0-9A-Z]{3}\Z")


def _member(code: str, name: str) -> dict:
    return {"code": code, "symbol": code + ".T", "name": name}


# Verified against the linked official releases on 2026-09-24. These remain
# separate from items: only the dated current CSV can change active membership.
KNOWN_CHANGES = [
    {
        "announced_on": "2026-09-08",
        "effective_on": "2026-09-29",
        "ends_on": "2026-09-30",
        "kind": "temporary_spinoff",
        "add": [_member("646A", "クラサスケミカル")],
        "remove": [],
        "source_url": "https://indexes.nikkei.co.jp/nkave/archives/news/20260908J_2.pdf",
    },
    {
        "announced_on": "2026-09-04",
        "effective_on": "2026-10-01",
        "kind": "regular_replacement",
        "add": [
            _member("5016", "ＪＸ金属"),
            _member("6525", "ＫＯＫＵＳＡＩ ＥＬＥＣＴＲＩＣ"),
            _member("9697", "カプコン"),
        ],
        "remove": [
            _member("4902", "コニカミノルタ"),
            _member("543A", "ＡＲＣＨＩＯＮ"),
            _member("7004", "カナデビア"),
        ],
        "source_url": "https://indexes.nikkei.co.jp/nkave/archives/news/20260904J_1.pdf",
    },
]


def _now(value: datetime | None) -> datetime:
    value = value or datetime.now(JST)
    if value.tzinfo is None:
        raise ValueError("now must include a timezone")
    return value.astimezone(JST)


def _safe_source_url(url: str) -> bool:
    parts = urlsplit(url)
    return (
        parts.scheme == "https"
        and parts.hostname == "indexes.nikkei.co.jp"
        and parts.port in (None, 443)
        and not parts.username
        and not parts.password
        and parts.path.startswith("/nkave/")
    )


class _OfficialRedirects(HTTPRedirectHandler):
    max_redirections = 3

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not _safe_source_url(newurl):
            raise ValueError("Refusing a redirect outside the official Nikkei source")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_csv() -> bytes:
    """One bounded read of a fixed public official source; no alternate scraping."""
    request = Request(SOURCE_URL, headers={
        "User-Agent": "EconomicNewsCalendar/1.0 (official constituent update)",
        "Accept": "text/csv,text/plain;q=0.9",
    })
    with build_opener(_OfficialRedirects()).open(request, timeout=FETCH_TIMEOUT) as response:
        if not _safe_source_url(response.geturl()):
            raise ValueError("Unexpected source URL")
        raw = response.read(MAX_BYTES + 1)
    if not raw or len(raw) > MAX_BYTES:
        raise ValueError("Empty or oversized Nikkei CSV")
    return raw


def _decode_csv(raw: bytes) -> str:
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_BYTES:
        raise ValueError("Empty or oversized Nikkei CSV")
    for encoding in ("utf-8-sig", "cp932"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            pass
    raise ValueError("Unsupported Nikkei CSV encoding")


def parse_csv(raw: bytes, *, now: datetime | None = None) -> dict:
    """Validate the entire source before returning a replacement document."""
    checked_at = _now(now)
    reader = csv.reader(io.StringIO(_decode_csv(raw)))
    header = next(reader, [])
    if header != ["対象日付", "コード", "銘柄名", "株価換算係数", "業種", "セクター"]:
        raise ValueError("Unexpected Nikkei CSV columns")
    items, dates, seen = [], set(), set()
    footer_seen = False
    for row in reader:
        if not row or not any(cell.strip() for cell in row):
            continue
        # The published CSV has a single copyright/explanation footer row.
        if len(row) == 1 and row[0].startswith("本資料は日経の著作物") and not footer_seen:
            footer_seen = True
            continue
        if footer_seen or len(row) != len(header):
            raise ValueError("Malformed or unexpected Nikkei CSV row")
        original_date, code, name = (cell.strip() for cell in row[:3])
        if not re.fullmatch(r"\d{4}/\d{2}/\d{2}", original_date):
            raise ValueError("Invalid source date")
        source_date = date.fromisoformat(original_date.replace("/", "-"))
        dates.add(source_date)
        if not CODE_RE.fullmatch(code) or code in seen:
            raise ValueError("Invalid or duplicate security code")
        if not name or len(name) > 160 or any(ord(char) < 32 for char in name):
            raise ValueError("Invalid company name")
        seen.add(code)
        items.append(_member(code, name))
    if len(dates) != 1:
        raise ValueError("Nikkei rows must all have the same original date")
    as_of = next(iter(dates))
    age_days = (checked_at.date() - as_of).days
    if age_days < 0 or age_days > MAX_SOURCE_AGE_DAYS:
        raise ValueError("Nikkei source is future-dated or too old")
    # A documented one-day spin-off exception, not a relaxed arbitrary count.
    expected = 226 if as_of == date(2026, 9, 29) and "646A" in seen else 225
    if len(items) != expected:
        raise ValueError(f"Expected {expected} current Nikkei members; received {len(items)}")
    if date(2026, 9, 8) <= as_of < date(2026, 9, 29) and "646A" in seen:
        raise ValueError("The announced spin-off is not effective yet")
    if as_of == date(2026, 9, 30) and "646A" in seen:
        raise ValueError("The temporary spin-off membership has ended")
    replacement = KNOWN_CHANGES[1]
    if date(2026, 9, 4) <= as_of < date(2026, 10, 1):
        if any(row["code"] in seen for row in replacement["add"]) or not all(
            row["code"] in seen for row in replacement["remove"]
        ):
            raise ValueError("Future October members are mixed into the September list")
    if as_of == date(2026, 10, 1):
        if not all(row["code"] in seen for row in replacement["add"]) or any(
            row["code"] in seen for row in replacement["remove"]
        ):
            raise ValueError("October effective list does not match the official announcement")
    upcoming = [change for change in KNOWN_CHANGES if
                change["effective_on"] > as_of.isoformat() or
                change.get("ends_on", "") > as_of.isoformat()]
    return {
        "schema_version": 1,
        "index": "nikkei225",
        "as_of": as_of.isoformat(),
        "retrieved_at": checked_at.isoformat(timespec="seconds"),
        "source": {
            "title": "日経平均株価・構成銘柄（公式の株価換算係数一覧から銘柄を取得）",
            "url": SOURCE_URL,
            "component_url": COMPONENT_URL,
            "sha256": hashlib.sha256(raw).hexdigest(),
        },
        "items": sorted(items, key=lambda item: item["code"]),
        "scheduled_changes": copy.deepcopy(upcoming),
    }


def update_universe(output_path: Path | str = DEFAULT_OUTPUT, *,
                    now: datetime | None = None, fetcher=None) -> dict:
    """Fetch, validate, atomically save; failures never erase the last good file."""
    document = parse_csv((fetcher or fetch_csv)(), now=now)
    output_path = Path(output_path)
    if output_path.exists():
        previous = json.loads(output_path.read_text(encoding="utf-8"))
        if previous.get("as_of", "") > document["as_of"]:
            raise ValueError("Refusing an older universe than the saved version")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output_path.parent,
                                         prefix=output_path.name + ".", suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(document, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, output_path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return document


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    try:
        document = update_universe(args.output)
    except Exception as error:
        parser.exit(1, f"Nikkei universe update failed; saved data was preserved: {error}\n")
    print(f"Nikkei universe: {len(document['items'])} members, as of {document['as_of']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

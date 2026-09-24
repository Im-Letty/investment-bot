"""Verified JPX dividend ex-dates. No annual date extrapolation or payment guesses."""
from datetime import date, datetime
from hashlib import sha256
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
from urllib.parse import urljoin, urlparse
from zoneinfo import ZoneInfo

import requests
import xlrd

PAGE = "https://www.jpx.co.jp/listing/others/ex-rights/"
JST = ZoneInfo("Asia/Tokyo")
BASE = Path(__file__).resolve().parent


class _Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.links.extend(v for k, v in attrs if k == "href" and v)


def latest_file(html, today):
    parser = _Links()
    parser.feed(html)
    candidates = []
    for link in parser.links:
        url = urljoin(PAGE, link)
        parsed = urlparse(url)
        match = re.search(r"/(\d{8})\.xls$", parsed.path)
        if parsed.scheme != "https" or parsed.netloc != "www.jpx.co.jp" or not match:
            continue
        try:
            published = datetime.strptime(match[1], "%Y%m%d").date()
        except ValueError:
            continue
        if 0 <= (today - published).days <= 21:
            candidates.append((published, url))
    if not candidates:
        raise ValueError("No recent dated JPX dividend workbook")
    return max(candidates)


def _code(raw):
    if isinstance(raw, (int, float)) and raw == int(raw):
        raw = str(int(raw))
    value = str(raw).strip().upper()
    # JPX's five-character security code includes the ordinary-share suffix 0.
    return value[:4] if re.fullmatch(r"[0-9][0-9A-Z]{3}0", value) else None


def _day(value, datemode):
    if not isinstance(value, (float, int)) or not 40000 < value < 80000:
        return None
    try:
        return xlrd.xldate_as_datetime(value, datemode).date()
    except (ValueError, OverflowError):
        return None


def parse_rows(rows, datemode, published, file_url, catalogue):
    if len(rows) < 5:
        raise ValueError("Empty JPX workbook")
    header = [re.sub(r"\s+", "", str(x)) for x in rows[3]]
    if len(header) < 9 or header[0] != "基準日" or header[4] != "銘柄コード" or header[7] != "備考" or "普通取引" not in header[2]:
        raise ValueError("Unexpected JPX columns")
    window = re.search(r"(\d{4})/(\d{1,2})/(\d{1,2})[～〜~-](\d{4})/(\d{1,2})/(\d{1,2})", str(rows[1][0]))
    if not window:
        raise ValueError("Missing JPX publication window")
    parts = [int(v) for v in window.groups()]
    start, end = date(*parts[:3]), date(*parts[3:])
    if start != published or not 0 < (end - start).days <= 21:
        raise ValueError("Invalid JPX publication window")
    events = {}
    dividend_rows = 0
    for row in rows[4:]:
        if len(row) < 9 or str(row[7]).strip() != "配当":
            continue
        dividend_rows += 1
        code = _code(row[4])
        company = catalogue.get(code)
        if not company:
            continue
        record = _day(row[0], datemode)
        effective = _day(row[1], datemode)
        exdate = _day(row[2], datemode)
        if not record or not effective or not exdate or not start <= effective <= end:
            raise ValueError("Invalid date in a domestic dividend row")
        if not 0 < (effective - exdate).days <= 14:
            raise ValueError("Inconsistent domestic dividend dates")
        event = {
            "id": f"jpx-{code}-{record.isoformat()}-ex",
            "symbol": code + ".T", "code": code, "name": company,
            "kind": "ex_dividend", "date": exdate.isoformat(), "precision": "day",
            "record_date": record.isoformat(), "effective_record_date": effective.isoformat(),
            "status": "confirmed", "verified_on": published.isoformat(),
            "source": {"title": "JPX・配当落日一覧", "url": file_url},
        }
        events[event["id"]] = event
    if not dividend_rows:
        raise ValueError("JPX workbook contained no dividend rows")
    return {
        "version": 1, "verified_on": published.isoformat(),
        "record_window": {"start": start.isoformat(), "end": end.isoformat()},
        "source": {"title": "JPX・配当落日一覧", "url": file_url},
        "events": sorted(events.values(), key=lambda x: (x["date"], x["symbol"])),
    }


def fetch_jpx_events(now=None, session=None):
    now = now or datetime.now(JST)
    today = now.astimezone(JST).date() if isinstance(now, datetime) else now
    session = session or requests.Session()
    response = session.get(PAGE, timeout=(5, 20))
    response.raise_for_status()
    published, url = latest_file(response.text, today)
    response = session.get(url, timeout=(5, 25))
    response.raise_for_status()
    if len(response.content) > 12_000_000:
        raise ValueError("Unexpected JPX workbook size")
    book = xlrd.open_workbook(file_contents=response.content)
    sheet = book.sheet_by_index(0)
    source = json.loads((BASE / "static/jpx-company-catalogue.json").read_text())
    catalogue = {row["code"]: row["name"] for row in source["items"] if "内国株式" in row.get("market", "")}
    result = parse_rows([sheet.row_values(i) for i in range(sheet.nrows)], book.datemode, published, url, catalogue)
    result["file_sha256"] = sha256(response.content).hexdigest()
    result["checked_at"] = datetime.now(JST).isoformat()
    result["fetched_at"] = time.time()
    return result

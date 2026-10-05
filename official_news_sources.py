"""Bounded public-document collection from three fixed Japanese official sites.

No AI, publication, database, or LINE operations occur here. Callers must apply
their source-use policy before enabling collection. Date-only releases keep
published_at=None; retrieval time is never substituted for publication time.
"""
from datetime import date, datetime, time as daytime, timezone
from email.utils import parsedate_to_datetime
from hashlib import sha256
from itertools import zip_longest
import math
import json
import re
import subprocess
import sys
import time
import unicodedata
from urllib.parse import urljoin, urlsplit, urlunsplit
from xml.etree import ElementTree

import requests

from daily_news_sources import (JST, _Document, _PinnedHTTPSAdapter, _public_ip,
                                _parallel, _jsonld)

FEEDS = {
    "総務省統計局": "https://www.stat.go.jp/whatsnew/news.rdf",
    "財務省": "https://www.mof.go.jp/news.rss",
    "日本銀行": "https://www.boj.or.jp/rss/whatsnew.xml",
}
HOSTS = {"www.stat.go.jp": "総務省統計局", "www.mof.go.jp": "財務省", "www.boj.or.jp": "日本銀行"}
MAX_BYTES = 2_000_000
MAX_BODY_CHARS = 30_000
# Official statistical points can be shorter than a newspaper article (the
# verified employment release is 188 characters). A real result container,
# title and corroborated original date are required in addition to this floor.
MIN_BODY_CHARS = 100
MAX_FEED_ITEMS = 120
MAX_CANDIDATES = 20
MAX_ARTICLES = 8
COLLECTION_SECONDS = 55
REQUEST_SECONDS = 12
MAX_REDIRECTS = 3
MAX_PDF_PAGES = 20
PDF_SECONDS = 8
_EXCLUDED_TITLE = re.compile(r"入札|採用|募集|調達|公募|発行予定|公表予定|発表予定|開催予定|予定一覧|スケジュール|カレンダー")
_STATS_TOPIC = re.compile(r"労働力調査|消費者物価指数|家計調査|消費動向指数")
_MOF_TOPIC = re.compile(r"財務大臣|経済|景気|財政|予算|税制|税収|租税|国際収支|貿易|為替|金融|補助金|基金|財政投融資|法人企業")
# Deliberately exclude meeting minutes/opinions, speeches, schedules, reference
# slides and individual operation-rule amendments from policy decisions.
_BOJ_TOPIC = re.compile(r"^(?:金融市場調節方針(?:の変更)?について|当面の金融政策運営について)$")
_BLOCKED = {"script", "style", "nav", "footer", "aside", "form", "noscript", "button"}
_BLOCKS = {"p", "div", "section", "article", "h1", "h2", "h3", "h4", "li", "tr", "br", "dt", "dd"}
_EXCLUDED_CLASS = re.compile(r"(?:^|[-_\s])(?:breadcrumb|share|social|related|plugin|pagetop|print)(?:$|[-_\s])", re.I)
_JAPANESE_DATE = r"(?:(\d{4})年|令和(元|\d+)年)(\d{1,2})月(\d{1,2})日"


def _article_path(host, path):
    if host == "www.boj.or.jp":
        return bool(re.fullmatch(r"/mopo/mpmdeci/(?:state_\d{4}/k\d{6}[a-z]?\.html?|mpr_\d{4}/k\d{6}[a-z]?\.pdf)", path))
    if host == "www.stat.go.jp":
        return bool(re.fullmatch(r"/data/(?:roudou|kakei|cpi)/sokuhou/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+\.html?", path)
                    or path == "/data/kouri/doukou/3.html")
    if host != "www.mof.go.jp":
        return False
    if re.search(r"/(?:auction|procurement|recruit|schedule|calendar|application-contact)/", path):
        return False
    return bool(re.fullmatch(r"/public_relations/conference/my\d{8}[a-z]?\.html", path)
                or re.fullmatch(r"/policy/(?:budget|tax_policy|international_policy|financial_system|filp)/(?:[A-Za-z0-9_-]+/)+[A-Za-z0-9_-]+\.html?", path)
                or re.fullmatch(r"/policy/exchequer/reference/receipts_payments/[A-Za-z0-9_-]*gaiyo\.html?", path))


def _safe_url(value, *, base=None):
    if not isinstance(value, str) or not value or len(value) > 2048:
        return None
    if any(ord(c) < 33 or ord(c) == 127 for c in value) or "\\" in value:
        return None
    try:
        parsed = urlsplit(urljoin(base, value) if base else value)
        host = (parsed.hostname or "").lower()
        # BOJ's official HTTPS RSS currently supplies HTTP article links. Only
        # its exact approved host/path can be upgraded; no HTTP request is sent.
        scheme_ok = parsed.scheme.lower() == "https" or (
            parsed.scheme.lower() == "http" and host == "www.boj.or.jp"
            and parsed.port is None and _article_path(host, parsed.path))
        if (not scheme_ok or host not in HOSTS
                or parsed.username is not None or parsed.password is not None
                or parsed.port not in (None, 443) or parsed.query):
            return None
        normalized = urlunsplit(("https", host, parsed.path, "", ""))
        return normalized if normalized in FEEDS.values() or _article_path(host, parsed.path) else None
    except (ValueError, UnicodeError):
        return None


def _download(url, deadline):
    """Pinned-IP HTTPS; redirects stay on the same explicitly approved host."""
    current = _safe_url(url)
    if not current:
        raise ValueError("unapproved_source")
    host = urlsplit(current).hostname
    limit, seen = min(deadline, time.monotonic() + REQUEST_SECONDS), set()
    for hop in range(MAX_REDIRECTS + 1):
        if current in seen or time.monotonic() >= limit:
            raise ValueError("source_time_limit")
        seen.add(current)
        address = _public_ip(host)
        remaining = limit - time.monotonic()
        if remaining <= 0:
            raise ValueError("source_time_limit")
        with requests.Session() as session:
            session.trust_env = False
            session.mount("https://", _PinnedHTTPSAdapter(host, address))
            with session.get(current, allow_redirects=False, stream=True, verify=True,
                             timeout=(min(3, remaining), min(4, remaining)),
                             headers={"User-Agent": "EconomicNewsOfficialCollector/1.0",
                                      "Accept": "text/html,application/xml,application/rss+xml,application/rdf+xml,application/pdf",
                                      "Accept-Encoding": "identity", "Host": host}) as response:
                if response.status_code in (301, 302, 303, 307, 308):
                    redirect = _safe_url(response.headers.get("Location", ""), base=current)
                    if hop == MAX_REDIRECTS or not redirect or urlsplit(redirect).hostname != host:
                        raise ValueError("unapproved_redirect")
                    current = redirect
                    continue
                if response.status_code != 200:
                    raise ValueError("source_unavailable")
                mime = response.headers.get("Content-Type", "").split(";", 1)[0].lower().strip()
                is_pdf = host == "www.boj.or.jp" and urlsplit(current).path.endswith(".pdf")
                expected = {"application/pdf"} if is_pdf else {
                    "text/html", "application/xhtml+xml", "application/xml", "text/xml",
                    "application/rss+xml", "application/rdf+xml", "application/atom+xml"}
                if mime not in expected:
                    raise ValueError("source_content_type")
                length = response.headers.get("Content-Length")
                if length is not None and (not length.isdecimal() or int(length) > MAX_BYTES):
                    raise ValueError("source_size_limit")
                content = bytearray()
                while True:
                    chunk = response.raw.read1(4096, decode_content=True)
                    if time.monotonic() >= limit or len(content) + len(chunk) > MAX_BYTES:
                        raise ValueError("source_size_or_time_limit")
                    if not chunk:
                        return bytes(content), current
                    content.extend(chunk)
    raise ValueError("source_redirect_limit")


def _decode(payload):
    if not isinstance(payload, bytes) or len(payload) > MAX_BYTES:
        raise ValueError("invalid_source_bytes")
    match = re.search(rb'(?:charset|encoding)\s*=\s*[\x22\x27]?([A-Za-z0-9_-]+)', payload[:4096], re.I)
    encoding = match.group(1).decode("ascii").lower().replace("-", "_") if match else "utf_8"
    aliases = {"shift_jis": "cp932", "sjis": "cp932", "windows_31j": "cp932",
               "utf8": "utf_8", "utf_8": "utf_8", "cp932": "cp932", "euc_jp": "euc_jp"}
    if encoding not in aliases:
        raise ValueError("unsupported_source_encoding")
    return payload.decode(aliases[encoding])


def _publication(value):
    """Return explicit date/precision; never turn a date-only value into time."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    try:
        if re.fullmatch(r"\d{4}[-/]\d{2}[-/]\d{2}", value):
            day = date.fromisoformat(value.replace("/", "-"))
            return {"published_at": None, "published_date": day.isoformat(), "publication_precision": "day"}
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            parsed = parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            return None
        return {"published_at": parsed.timestamp(), "published_date": parsed.astimezone(JST).date().isoformat(),
                "publication_precision": "second"}
    except (ValueError, TypeError, OverflowError):
        return None


def _agree(values):
    if not values or any(value is None for value in values):
        return None
    if len({value["published_date"] for value in values}) != 1:
        return None
    precise = [value for value in values if value["publication_precision"] == "second"]
    if precise and len({value["published_at"] for value in precise}) != 1:
        return None
    return dict(precise[0] if precise else values[0])


def _now(value):
    if value is None:
        return datetime.now(timezone.utc)
    if type(value) in (float, int) and math.isfinite(value):
        return datetime.fromtimestamp(value, timezone.utc)
    if isinstance(value, datetime) and value.tzinfo is not None:
        return value.astimezone(timezone.utc)
    raise ValueError("now_requires_aware_time")


def _since(value, now):
    if value is None:
        return now.astimezone(JST).date()
    if type(value) is date:
        return value
    if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return date.fromisoformat(value)
    return _now(value)


def _in_window(publication, now, since):
    day = date.fromisoformat(publication["published_date"])
    today = now.astimezone(JST).date()
    if day > today:
        return False
    stamp = publication["published_at"]
    if stamp is not None and stamp > now.timestamp():
        return False
    if type(since) is date:
        return day >= since
    if stamp is not None:
        return stamp >= since.timestamp()
    boundary = since.astimezone(JST)
    # A same-day date-only release does not prove it appeared after an 08:00
    # cutoff. Include it only for an explicit whole-day boundary.
    return day > boundary.date() or (day == boundary.date() and boundary.time() == daytime())


def _feed_items(payload, feed_url, now, since):
    text = _decode(payload)
    if re.search(r"<!DOCTYPE|<!ENTITY", text, re.I):
        raise ValueError("unsupported_feed_declaration")
    root = ElementTree.fromstring(text)
    if root.tag == "rss":
        valid_feed = len(root.findall("channel")) == 1
    elif root.tag == "{http://www.w3.org/1999/02/22-rdf-syntax-ns#}RDF":
        valid_feed = len(root.findall("{http://purl.org/rss/1.0/}channel")) == 1
    else:
        valid_feed = root.tag == "{http://www.w3.org/2005/Atom}feed"
    if not valid_feed:
        raise ValueError("unsupported_feed_structure")
    items, scanned = [], 0
    for node in root.iter():
        if node.tag.rsplit("}", 1)[-1] not in ("item", "entry"):
            continue
        if scanned >= MAX_FEED_ITEMS:
            break
        scanned += 1
        fields = {}
        for child in node:
            name = child.tag.rsplit("}", 1)[-1]
            fields.setdefault(name, []).append(child)
        title = " ".join("".join(fields.get("title", [ElementTree.Element("empty")])[0].itertext()).split())
        links = fields.get("link", [])
        raw_url = next((element.attrib.get("href") or element.text for element in links
                        if element.attrib.get("rel", "alternate") == "alternate"), None)
        url = _safe_url(raw_url, base=feed_url)
        dates = ["".join(element.itertext()) for key in ("pubDate", "date", "published")
                 for element in fields.get(key, [])]
        publication = _agree([_publication(value) for value in dates])
        host = urlsplit(feed_url).hostname
        topic = {"www.stat.go.jp": _STATS_TOPIC, "www.mof.go.jp": _MOF_TOPIC,
                 "www.boj.or.jp": _BOJ_TOPIC}.get(host)
        if (not url or urlsplit(url).hostname != host or not _article_path(host, urlsplit(url).path)
                or not title or len(title) > 1000 or _EXCLUDED_TITLE.search(title)
                or topic is None or not topic.search(title)
                or not publication or not _in_window(publication, now, since)):
            continue
        items.append({"source": HOSTS[host], "title": title, "url": url, **publication})
    return items


def _descends(node, ancestor):
    while node is not None:
        if node is ancestor:
            return True
        node = node.parent
    return False


def _body_text(node, *, excluded_classes=frozenset()):
    parts, pending = [], [node]
    while pending:
        item = pending.pop()
        if isinstance(item, str):
            parts.append(item)
            continue
        if (item.tag in _BLOCKED or _EXCLUDED_CLASS.search(item.attrs.get("class", ""))
                or excluded_classes.intersection(item.attrs.get("class", "").split())):
            continue
        separator = "\n" if item.tag in _BLOCKS else " " if item.tag in ("td", "th") else ""
        parts.append(separator)
        pending.append(separator)
        pending.extend(reversed(item.children))
    return "\n".join(line for value in "".join(parts).splitlines() if (line := " ".join(value.split())))


def _html_date(document, body):
    dates = []
    for node in document.nodes:
        name = (node.attrs.get("property") or node.attrs.get("name") or "").lower()
        if node.tag == "meta" and name in ("date", "datepublished", "pubdate", "article:published_time"):
            dates.append(_publication(node.attrs.get("content", "")))
    for obj in _jsonld(document):
        if obj.get("datePublished") is not None:
            dates.append(_publication(obj["datePublished"]))
    for pattern in (_JAPANESE_DATE + r"\s*(?:公表|公開|掲載|発表)(?!予定)",
                    r"(?:公表日|公開日|掲載日|発表日)\s*[:：]?\s*" + _JAPANESE_DATE):
        for match in re.finditer(pattern, body):
            year, era, month, day = match.groups()
            try:
                year = int(year) if year else 2018 + (1 if era == "元" else int(era))
                dates.append(_publication(date(year, int(month), int(day)).isoformat()))
            except ValueError:
                return None
    return _agree(dates)


_PDF_SCRIPT = r'''
import io, json, sys
def extract():
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (7, 7))
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    except (ImportError, ValueError, OSError):
        pass
    try:
        from pypdf import PdfReader
    except ImportError:
        return {"error": "pdf_parser_unavailable"}
    maximum, pages_limit, chars_limit = map(int, sys.argv[1:])
    payload = sys.stdin.buffer.read(maximum + 1)
    if len(payload) > maximum or not payload.startswith(b"%PDF-"):
        return {"error": "pdf_invalid"}
    try:
        document = PdfReader(io.BytesIO(payload), strict=True)
        if document.is_encrypted:
            return {"error": "pdf_encrypted"}
        if not 1 <= len(document.pages) <= pages_limit:
            return {"error": "pdf_page_limit"}
        pages, total = [], 0
        for page in document.pages:
            content = page.extract_text()
            if not isinstance(content, str) or len(content.strip()) < 20:
                return {"error": "pdf_unreadable_page"}
            if "\ufffd" in content or "\x00" in content:
                return {"error": "pdf_unreadable_page"}
            total += len(content) + 1
            if total > chars_limit:
                return {"error": "pdf_text_limit"}
            pages.append(content)
        return {"pages": pages}
    except Exception:
        return {"error": "pdf_parse_failed"}
print(json.dumps(extract(), ensure_ascii=True))
'''


def _pdf_text(payload, deadline=None):
    """Parse text PDFs in a bounded child; no OCR, partial pages or PDF metadata.

    The child receives only public bytes, with an empty environment and isolated
    Python imports. It has no reason to open URLs or evaluate PDF actions. A
    parent timeout also kills a parser stuck inside one page's decompression.
    """
    if not isinstance(payload, bytes) or len(payload) > MAX_BYTES or not payload.startswith(b"%PDF-"):
        raise ValueError("pdf_invalid")
    remaining = PDF_SECONDS if deadline is None else min(PDF_SECONDS, deadline - time.monotonic())
    if remaining <= 0:
        raise ValueError("pdf_time_limit")
    try:
        result = subprocess.run(
            [sys.executable, "-I", "-B", "-c", _PDF_SCRIPT, str(MAX_BYTES),
             str(MAX_PDF_PAGES), str(MAX_BODY_CHARS)], input=payload,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env={},
            timeout=remaining, check=False)
    except subprocess.TimeoutExpired:
        raise ValueError("pdf_time_limit") from None
    if result.returncode != 0:
        raise ValueError("pdf_parse_failed")
    try:
        parsed = json.loads(result.stdout)
        if not isinstance(parsed, dict):
            raise ValueError
        if "error" in parsed:
            code = parsed["error"]
            allowed = {"pdf_parser_unavailable", "pdf_invalid", "pdf_encrypted", "pdf_page_limit",
                       "pdf_unreadable_page", "pdf_text_limit", "pdf_parse_failed"}
            raise ValueError(code if code in allowed else "pdf_parse_failed")
        pages = parsed["pages"]
        if (not isinstance(pages, list) or not 1 <= len(pages) <= MAX_PDF_PAGES
                or any(not isinstance(page, str) or len(page.strip()) < 20 for page in pages)):
            raise ValueError
        body = "\n".join(pages)
        if not MIN_BODY_CHARS <= len(body) <= MAX_BODY_CHARS:
            raise ValueError
        return body
    except (KeyError, TypeError, json.JSONDecodeError):
        raise ValueError("pdf_parse_failed") from None


def _compact(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value))


def _boj_publication(header):
    # The document's leading dateline precedes the publisher. Do not inspect
    # later meeting dates, effective dates or dates of future minutes.
    lines = [line.strip() for line in unicodedata.normalize("NFKC", header).splitlines() if line.strip()]
    if lines and re.fullmatch(r"\d{1,2}", lines[0]):
        lines.pop(0)  # PDF page number, not part of the dateline.
    text = _compact("\n".join(lines))
    match = re.match(_JAPANESE_DATE + r"日本銀行", text)
    if not match:
        return None
    year, era, month, day = match.groups()
    try:
        year = int(year) if year else 2018 + (1 if era == "元" else int(era))
        return _publication(date(year, int(month), int(day)).isoformat())
    except ValueError:
        return None


def _record(item, original, final, body, publication, observed_at, now, since):
    if (not publication or not _in_window(publication, now, since)
            or not MIN_BODY_CHARS <= len(body) <= MAX_BODY_CHARS
            or not (type(observed_at) in (int, float) and math.isfinite(observed_at))):
        return None
    return {"source": HOSTS[urlsplit(final).hostname], "title": item["title"], "url": original,
            "body": body, "body_sha256": sha256(body.encode("utf-8")).hexdigest(), "evidence_url": final,
            **{key: publication[key] for key in ("published_at", "published_date", "publication_precision")},
            "observed_at": observed_at}


def _extract_article(payload, item, final_url, now, since, *, observed_at, deadline=None):
    original, final = _safe_url(item.get("url")), _safe_url(final_url)
    if (not original or not final or urlsplit(original).hostname != urlsplit(final).hostname
            or not _article_path(urlsplit(final).hostname, urlsplit(final).path)):
        return None
    host = urlsplit(final).hostname
    if host == "www.boj.or.jp":
        if not _BOJ_TOPIC.fullmatch(item.get("title", "")):
            return None
        if urlsplit(final).path.endswith(".pdf"):
            body = _pdf_text(payload, deadline)
            if _compact(item["title"]) not in _compact(body[:1200]):
                return None
            publication = _agree([item, _boj_publication(body[:600])])
            return _record(item, original, final, body, publication, observed_at, now, since)
    document = _Document(_decode(payload))
    main_id = {"www.stat.go.jp": "main_contents", "www.mof.go.jp": "main", "www.boj.or.jp": "contents"}[host]
    main = next((node for node in document.nodes if node.tag == "main" and node.attrs.get("id") == main_id), None)
    if main is None:
        return None
    headings = [node for node in document.nodes if node.tag == "h1" and _descends(node, main)]
    if not headings or not _body_text(headings[0]):
        return None
    if host == "www.stat.go.jp":
        body_node = headings[0].parent
        while body_node is not main and body_node.tag != "article":
            body_node = body_node.parent
        if body_node is main:
            return None
    elif host == "www.mof.go.jp":
        body_node = next((node for node in document.nodes if "unique-block" in node.attrs.get("class", "").split()
                          and _descends(node, main)), None)
        if body_node is None:
            return None
    else:
        if _compact(_body_text(headings[0])) != _compact(item["title"]):
            return None
        body_node = next((node for node in document.nodes if {"outline", "mod_outer"}.issubset(
            node.attrs.get("class", "").split()) and _descends(node, main)), None)
        if body_node is None:
            return None
    boj_nonbody_classes = {"link-list01", "info-item01"} if host == "www.boj.or.jp" else frozenset()
    body = _body_text(body_node, excluded_classes=boj_nonbody_classes)
    if not MIN_BODY_CHARS <= len(body) <= MAX_BODY_CHARS:
        return None
    content = [node for node in document.nodes if node.tag in ("p", "table", "dl", "ul", "ol")
               and _descends(node, body_node)]
    content = [node for node in content if not any(other is not node and _descends(node, other) for other in content)]
    meaningful = "\n".join(_body_text(node, excluded_classes=boj_nonbody_classes) for node in content)
    if len(meaningful) < MIN_BODY_CHARS:
        return None
    if host == "www.boj.or.jp":
        dateline = next((node for node in document.nodes if node.tag == "p"
                        and _descends(node, body_node)), None)
        if dateline is None or "txt-right" not in dateline.attrs.get("class", "").split():
            return None
        html_publication = _boj_publication(_body_text(dateline))
        # Datelines/headings/download links do not constitute decision text.
        narrative = "\n".join(_body_text(node, excluded_classes=boj_nonbody_classes)
                              for node in content if node is not dateline)
        if len(narrative.strip()) < MIN_BODY_CHARS:
            return None
    else:
        html_publication = _html_date(document, body)
    publication = _agree([item, html_publication])
    return _record(item, original, final, body, publication, observed_at, now, since)


def collect_official_articles(now=None, *, since=None, until=None, diagnostics=None,
                              enabled_sources=None, clock=None):
    """Collect 0..8 public releases, defaulting to the current JST calendar day.

    `now`: aware datetime or Unix seconds, default current time. `since`: aware
    datetime/Unix seconds for an exact inclusive boundary, or date/ISO date for
    a whole-day inclusive boundary. An ambiguous date-only release on the day
    of a non-midnight exact boundary is excluded. Retrieval time is recorded
    separately using the actual clock. Missing/contradictory evidence is skipped.
    `until` optionally narrows the publication-time upper bound; it never makes
    future announcements eligible. `enabled_sources` selects a fixed subset of
    FEEDS without mutating the shared source configuration. Production uses the
    Statistics Bureau and Ministry of Finance explicitly; BOJ remains opt-in
    at the caller's policy boundary. `body_verified_at` is the actual positive
    clock reading after extraction and date validation, not the supplied `now`.
    Optional `diagnostics` is an output dict of per-source status/counts/error
    codes. No matches in a limited RSS feed do not prove no announcement exists.
    """
    if diagnostics is not None and not isinstance(diagnostics, dict):
        raise ValueError("diagnostics_requires_dict")
    if enabled_sources is None:
        active_feeds = dict(FEEDS)
    else:
        if (not isinstance(enabled_sources, (tuple, list)) or not enabled_sources
                or any(not isinstance(source, str) or source not in FEEDS for source in enabled_sources)
                or len(set(enabled_sources)) != len(enabled_sources)):
            raise ValueError("invalid_enabled_sources")
        active_feeds = {source: FEEDS[source] for source in enabled_sources}
    clock = clock or time.time
    now = _now(now)
    if until is not None:
        now = min(now, _now(until))
    since = _since(since, now)
    deadline = time.monotonic() + COLLECTION_SECONDS
    allowed_errors = {"unapproved_source", "source_time_limit", "unapproved_redirect", "source_unavailable",
                      "source_content_type", "source_size_limit", "source_size_or_time_limit", "source_redirect_limit",
                      "invalid_source_bytes", "unsupported_source_encoding", "unsupported_feed_declaration",
                      "unsupported_feed_structure", "invalid_verification_clock",
                      "pdf_invalid", "pdf_parser_unavailable", "pdf_encrypted", "pdf_page_limit",
                      "pdf_unreadable_page", "pdf_text_limit", "pdf_parse_failed", "pdf_time_limit"}
    def error_code(exc):
        return str(exc) if isinstance(exc, ValueError) and str(exc) in allowed_errors else "source_read_failed"
    def feed(url):
        source = HOSTS[urlsplit(url).hostname]
        try:
            payload, final = _download(url, deadline)
            if final != url:
                raise ValueError("unapproved_redirect")
            return {"source": source, "items": _feed_items(payload, url, now, since), "error": None}
        except Exception as exc:
            return {"source": source, "items": [], "error": error_code(exc)}
    batches = _parallel(list(active_feeds.values()), feed, deadline)
    def stable_order(item):
        # Within one publication day use a deterministic identity order, not a
        # guessed midnight timestamp for releases whose time is unknown.
        return (-date.fromisoformat(item["published_date"]).toordinal(), item["source"], item["url"])
    by_source = {source: [] for source in active_feeds}
    report = {source: {"feed_status": "not_completed", "status": "fetch_incomplete", "candidates": 0,
                       "selected": 0, "completed": 0, "accepted": 0, "errors": []} for source in active_feeds}
    for batch in batches:
        row = report[batch["source"]]
        row["feed_status"] = "failed" if batch["error"] else "ok"
        row["status"] = "feed_failed" if batch["error"] else "no_matching_candidates"
        if batch["error"]:
            row["errors"].append(batch["error"])
        for item in batch["items"]:
            by_source[item["source"]].append(item)
        row["candidates"] = len(batch["items"])
    for items in by_source.values():
        items.sort(key=stable_order)
    candidates = [item for pair in zip_longest(*by_source.values()) for item in pair if item is not None]
    seen, selected = set(), []
    for item in candidates:
        key = (item["url"], item["published_date"])
        if key not in seen:
            selected.append(item)
            seen.add(key)
            report[item["source"]]["selected"] += 1
        if len(selected) >= MAX_CANDIDATES:
            break
    def fetch(item):
        try:
            payload, final = _download(item["url"], deadline)
            article = _extract_article(payload, item, final, now, since, observed_at=clock(), deadline=deadline)
            if article is not None:
                verified = clock()
                if (type(verified) not in (int, float) or not math.isfinite(verified) or verified <= 0
                        or verified < article['observed_at']):
                    raise ValueError("invalid_verification_clock")
                article["body_verified_at"] = verified
            return {"item": item, "article": article, "error": None if article else "body_or_date_unverified"}
        except Exception as exc:
            return {"item": item, "article": None, "error": error_code(exc)}
    completed = {}
    for result in _parallel(selected, fetch, deadline):
        item, article = result["item"], result["article"]
        row = report[item["source"]]
        row["completed"] += 1
        if article:
            completed[(item["url"], item["published_date"])] = article
            row["accepted"] += 1
        elif result["error"] not in row["errors"]:
            row["errors"].append(result["error"])
    # Completion order must not determine which publisher survives the return
    # cap. Reapply the fair candidate order before selecting successful records.
    records = [completed[(item["url"], item["published_date"])] for item in selected
               if (item["url"], item["published_date"]) in completed][:MAX_ARTICLES]
    for source, row in report.items():
        if row["selected"]:
            if row["accepted"]:
                row["status"] = ("collected_partial" if row["errors"] or row["completed"] < row["selected"]
                                 else "collected")
            else:
                row["status"] = "fetch_incomplete" if row["completed"] < row["selected"] else "articles_unavailable"
        row["returned"] = sum(record["source"] == source for record in records)
        row["errors"].sort()
    if diagnostics is not None:
        diagnostics.clear()
        diagnostics.update(report)
    return sorted(records, key=stable_order)

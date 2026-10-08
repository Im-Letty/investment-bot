"""Read a bounded set of corporate announcements from three official feeds.

Bodies are private, short-lived writing inputs, never public archive content.
The listed company is a trusted catalogue identity; related_company identifies
the actual announcing subsidiary and must be respected by the writer.
"""
from datetime import date, datetime, timedelta
from hashlib import sha256
from itertools import zip_longest
import math
import re
import time
import unicodedata
from urllib.parse import urljoin, urlsplit, urlunsplit
from xml.etree import ElementTree

import requests

from daily_news_sources import JST, _Document, _PinnedHTTPSAdapter, _public_ip, _parallel, _jsonld
from official_news_sources import _publication, _now, _in_window, _body_text, _descends

SOURCES = {
    "NTT": {
        "feed": "https://group.ntt/jp/newsrelease/rss/release.rdf",
        "host": "group.ntt", "symbol": "9432.T", "name": "NTT", "sector": "通信",
        "issuer": "NTT株式会社",
        "business": "スマホやインターネットの通信、企業の情報を管理する仕組みなどを支える会社です。",
        "business_url": "https://group.ntt/jp/business/",
    },
    "KDDI": {
        "feed": "https://newsroom.kddi.com/news/newsrelease.xml",
        "host": "newsroom.kddi.com", "symbol": "9433.T", "name": "KDDI", "sector": "通信",
        "issuer": "KDDI株式会社",
        "business": "auなどのスマホ通信やインターネットを提供し、企業の通信や仕事の仕組みも支える会社です。",
        "business_url": "https://www.kddi.com/corporate/ir/individual/operation/",
    },
    "パナソニック ホールディングス": {
        "feed": "https://news.panasonic.com/jp/rss/press/index.xml",
        "host": "news.panasonic.com", "symbol": "6752.T",
        "name": "パナソニック ホールディングス", "sector": "電機",
        "issuer": "パナソニック ホールディングス株式会社",
        "business": "家電や電池、工場・店舗向けの機器などを扱うグループをまとめる会社です。",
        "business_url": "https://holdings.panasonic/jp/corporate/about/group-strategy/business-segments.html",
        "related_issuers": ("パナソニック ホールディングス株式会社", "パナソニック株式会社",
                            "パナソニック エナジー株式会社", "パナソニック インダストリー株式会社",
                            "パナソニック コネクト株式会社", "パナソニック エレクトリックワークス株式会社",
                            "パナソニック HVAC&CC株式会社"),
    },
}
FEEDS = {name: config["feed"] for name, config in SOURCES.items()}
MAX_BYTES = 1_000_000
MAX_FEED_ITEMS = 120
MAX_CANDIDATES = 8
MAX_ARTICLES = 3
MIN_BODY_CHARS = 100
MAX_BODY_CHARS = 20_000
COLLECTION_SECONDS = 40
REQUEST_SECONDS = 10
_EXCLUDED = re.compile(r"人事|役員|定款|株主名簿|株主総会|自己株式|株式取得状況|社債|配当|決算説明会|"
                       r"開催|登壇|講演|出展|フォーラム|Forum|受賞|表彰|キャンペーン|セミナー|募集|採用", re.I)
_TOPIC = re.compile(r"提供|発売|開発|実証|稼働|開始|提携|協業|契約|供給|増産|新設|生産|設備|買収|導入|共同|事業|サービス|製品|研究")
_DATE = re.compile(r"(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日")
_ERROR_CODES = frozenset({"unapproved_source", "source_time_limit", "source_unavailable",
    "unapproved_redirect", "source_content_type", "source_size_limit", "source_size_or_time_limit",
    "unsupported_feed_declaration", "unsupported_feed_structure", "unsupported_source_encoding",
    "invalid_verification_clock"})


def _compact(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value))


def _plain(value):
    return " ".join(_body_text(_Document(value).root).split()) if isinstance(value, str) else ""


def _article_path(source, path):
    if source == "NTT":
        return bool(re.fullmatch(r"/jp/newsrelease/\d{4}/\d{2}/\d{2}/[a-z0-9_-]+\.html", path))
    if source == "KDDI":
        return bool(re.fullmatch(r"/news/detail/kddi_nr-\d+_\d+\.html", path))
    return source == "パナソニック ホールディングス" and bool(re.fullmatch(r"/jp/press/jn\d{6}-\d+", path))


def _safe_url(value, *, source=None, base=None):
    if not isinstance(value, str) or not value or len(value) > 2048:
        return None
    if any(ord(char) < 33 or ord(char) == 127 for char in value) or "\\" in value:
        return None
    try:
        parsed = urlsplit(urljoin(base, value) if base else value)
        host = (parsed.hostname or "").lower()
        if (parsed.scheme.lower() != "https" or parsed.username is not None
                or parsed.password is not None or parsed.port not in (None, 443) or parsed.query):
            return None
        candidates = [source] if source in SOURCES else list(SOURCES) if source is None else []
        normalized = urlunsplit(("https", host, parsed.path, "", ""))
        for name in candidates:
            config = SOURCES[name]
            if host == config["host"] and (normalized == config["feed"] or _article_path(name, parsed.path)):
                return normalized
    except (ValueError, UnicodeError):
        pass
    return None


def _download(url, deadline):
    """Pinned public-IP HTTPS, no redirects, credentials, or arbitrary hosts."""
    safe = _safe_url(url)
    if safe != url:
        raise ValueError("unapproved_source")
    host = urlsplit(safe).hostname
    limit = min(deadline, time.monotonic() + REQUEST_SECONDS)
    address = _public_ip(host)
    remaining = limit - time.monotonic()
    if remaining <= 0:
        raise ValueError("source_time_limit")
    with requests.Session() as session:
        session.trust_env = False
        session.mount("https://", _PinnedHTTPSAdapter(host, address))
        with session.get(url, allow_redirects=False, stream=True, verify=True,
                         timeout=(min(3, remaining), min(3, remaining)),
                         headers={"User-Agent": "CompanyNewsOfficialCollector/1.0",
                                  "Accept": "text/html,application/xml,application/rss+xml,application/rdf+xml",
                                  "Accept-Encoding": "identity", "Host": host}) as response:
            if 300 <= response.status_code < 400:
                raise ValueError("unapproved_redirect")
            if response.status_code != 200:
                raise ValueError("source_unavailable")
            mime = response.headers.get("Content-Type", "").split(";", 1)[0].lower().strip()
            is_feed = url in FEEDS.values()
            allowed = ({"text/xml", "application/xml", "application/rss+xml", "application/rdf+xml"}
                       if is_feed else {"text/html", "application/xhtml+xml"})
            if mime not in allowed:
                raise ValueError("source_content_type")
            length = response.headers.get("Content-Length")
            if length is not None and (not length.isdecimal() or int(length) > MAX_BYTES):
                raise ValueError("source_size_limit")
            payload = bytearray()
            while True:
                chunk = response.raw.read1(4096, decode_content=True)
                if time.monotonic() >= limit or len(payload) + len(chunk) > MAX_BYTES:
                    raise ValueError("source_size_or_time_limit")
                if not chunk:
                    return bytes(payload), url
                payload.extend(chunk)


def _decode(payload):
    if not isinstance(payload, bytes) or len(payload) > MAX_BYTES:
        raise ValueError("source_size_limit")
    try:
        return payload.decode("utf-8-sig", errors="strict")
    except UnicodeDecodeError as exc:
        raise ValueError("unsupported_source_encoding") from exc


def _agree(values):
    """Date evidence must agree. Conflicting clocks may prove only a day."""
    if not values or any(value is None for value in values):
        return None
    days = {value["published_date"] for value in values}
    if len(days) != 1:
        return None
    precise = [value for value in values if value["published_at"] is not None]
    if precise and len({value["published_at"] for value in precise}) == 1:
        return dict(precise[0])
    return _publication(next(iter(days)))


def _feed_items(payload, source, now, since):
    content = _decode(payload)
    if re.search(r"<!DOCTYPE|<!ENTITY", content, re.I):
        raise ValueError("unsupported_feed_declaration")
    root = ElementTree.fromstring(content)
    if root.tag == "rss" and len(root.findall("channel")) == 1:
        items = root.find("channel").findall("item")
    elif (root.tag == "{http://www.w3.org/1999/02/22-rdf-syntax-ns#}RDF"
          and len(root.findall("{http://purl.org/rss/1.0/}channel")) == 1):
        items = root.findall("{http://purl.org/rss/1.0/}item")
    else:
        raise ValueError("unsupported_feed_structure")
    records = []
    for item in items[:MAX_FEED_ITEMS]:
        fields = {}
        for child in item:
            fields.setdefault(child.tag.rsplit("}", 1)[-1], []).append("".join(child.itertext()))
        if len(fields.get("title", [])) != 1 or len(fields.get("link", [])) != 1:
            continue
        title = _plain(fields["title"][0])
        url = _safe_url(fields["link"][0], source=source, base=FEEDS[source])
        dates = [_publication(value) for key in ("pubDate", "date") for value in fields.get(key, [])]
        publication = _agree(dates)
        # Any explicit future clock is ineligible, even if other evidence only
        # establishes a day or two publisher clocks disagree.
        if (not url or url == FEEDS[source] or not 1 <= len(title) <= 1000
                or _EXCLUDED.search(title) or not _TOPIC.search(title) or not publication
                or any(value and value["published_at"] is not None and value["published_at"] > now.timestamp()
                       for value in dates) or not _in_window(publication, now, since)):
            continue
        records.append({"source": source, "title": title, "url": url, **publication})
    unique = {(item["url"], item["published_date"]): item for item in records}
    return sorted(unique.values(), key=_order)


def _order(item):
    return (-date.fromisoformat(item["published_date"]).toordinal(),
            -(item.get("published_at") or 0), item["source"], item["url"])


def _with_class(document, name, ancestor=None, tag=None):
    return [node for node in document.nodes if name in node.attrs.get("class", "").split()
            and (tag is None or node.tag == tag) and (ancestor is None or _descends(node, ancestor))]


def _day(value):
    match = _DATE.fullmatch(" ".join(value.split()))
    if not match:
        return None
    try:
        return _publication(date(*(int(part) for part in match.groups())).isoformat())
    except ValueError:
        return None


def _extract_article(payload, item, final_url, now, since, *, observed_at):
    source = item["source"]
    config = SOURCES[source]
    if _safe_url(item["url"], source=source) != item["url"] or final_url != item["url"]:
        return None
    document = _Document(_decode(payload))
    related_company = config["issuer"]
    if source == "NTT":
        containers = _with_class(document, "contents")
        if len(containers) != 1:
            return None
        container = containers[0]
        headings = _with_class(document, "c-ttl-1", container, "h1")
        datelines = _with_class(document, "c-navi-2__txt", container, "p")
        roots = [node for node in _with_class(document, "c-wrap-1", container)
                 if "c-wrap-1--o-4" in node.attrs.get("class", "").split()]
        if len(headings) != 1 or len(datelines) != 1 or not roots:
            return None
        publication_day = _day(_body_text(datelines[0]))
        path = urlsplit(item["url"]).path.split("/")
        if publication_day is None or "/".join(path[3:6]) != publication_day["published_date"].replace("-", "/"):
            return None
    elif source == "KDDI":
        containers = [node for node in document.nodes if node.tag == "main" and node.attrs.get("id") == "main"]
        if len(containers) != 1:
            return None
        container = containers[0]
        headings = _with_class(document, "news-detail-heading1__title", container, "h1")
        datelines = _with_class(document, "news-detail-heading1__date", container, "time")
        content = _with_class(document, "news-detail-main__content", container)
        if len(headings) != 1 or len(datelines) != 1 or len(content) != 1:
            return None
        publication_day = _publication(datelines[0].attrs.get("datetime", ""))
        roots = [child for child in content[0].children if not isinstance(child, str) and child.tag == "section"]
    else:
        containers = [node for node in document.nodes if node.attrs.get("id") == "nw-contents"]
        if len(containers) != 1:
            return None
        container = containers[0]
        headings = _with_class(document, "p-detailHeader__heading", container, "h1")
        datelines = _with_class(document, "p-detailHeader__date", container, "p")
        companies = _with_class(document, "p-detailHeader__company", container)
        if len(headings) != 1 or len(datelines) != 1 or len(companies) != 1:
            return None
        related_company = " / ".join(_body_text(companies[0]).splitlines())
        publication_day = _day(_body_text(datelines[0]))
        roots = _with_class(document, "TextItem__text", container)
        modules = _with_class(document, "BlockModule", container)
        roots.extend(node for node in document.nodes if node.tag in ("table", "h2", "h3", "ul", "ol")
                     and any(_descends(node, module) for module in modules))
    if not roots or _compact(_plain(_body_text(headings[0]))) != _compact(item["title"]):
        return None
    roots = [node for node in roots if not any(other is not node and _descends(node, other) for other in roots)]
    positions = {id(node): index for index, node in enumerate(document.nodes)}
    roots.sort(key=lambda node: positions[id(node)])
    body = "\n".join(_body_text(node) for node in roots)
    if not MIN_BODY_CHARS <= len(body) <= MAX_BODY_CHARS:
        return None
    if source == "パナソニック ホールディングス":
        # Current pages can contain an empty company badge. The legal issuer
        # at the start of the press-release narrative is the evidence then;
        # the newsroom publisher alone is not evidence that the HD announced.
        issuer = next((name for name in config["related_issuers"]
                       if _compact(body).startswith(_compact(name))), None)
        if not issuer or (related_company and _compact(issuer) not in _compact(related_company)):
            return None
        related_company = issuer
    # A feed title or footer alone cannot establish the announcing company.
    if not any(_compact(name) in _compact(body[:1500]) for name in
               ([config["issuer"]] if source != "パナソニック ホールディングス" else related_company.split(" / "))):
        return None
    objects = [obj for obj in _jsonld(document) if obj.get("@type") in ("Article", "NewsArticle")
               and _compact(_plain(obj.get("headline", ""))) == _compact(item["title"])]
    if len(objects) != 1:
        return None
    article = objects[0]
    authors = article.get("author", [])
    if isinstance(authors, dict):
        authors = [authors]
    if not isinstance(authors, list) or not any(isinstance(author, dict) and
            _compact(author.get("name", "")) == _compact(config["issuer"]) for author in authors):
        return None
    metadata_date = _publication(article.get("datePublished", ""))
    values = [item, publication_day, metadata_date]
    if any(value and value["published_at"] is not None and value["published_at"] > now.timestamp() for value in values):
        return None
    publication = _agree(values)
    if not publication or not _in_window(publication, now, since):
        return None
    return {key: config[key] for key in ("symbol", "name", "business", "sector")} | {
        "title": item["title"], "url": item["url"], "source": source,
        "related_company": related_company, "business_url": config["business_url"],
        "body": body, "body_sha256": sha256(body.encode()).hexdigest(),
        "observed_at": observed_at, "evidence_url": final_url, **publication,
        "publication_evidence": {"feed_published_at": item["published_at"],
                                  "article_published_at": metadata_date["published_at"]}}


def collect_company_articles(now=None, *, since=None, until=None, diagnostics=None, clock=None, exclude_urls=None):
    """Collect up to three verified announcements, defaulting to the last 72h.

    A failed feed/body is distinguishable from a successfully checked empty
    window. A short feed does not establish absence across the whole website.
    Publication dates are original source dates; current time is never used to
    relabel an old announcement. Date-only evidence keeps published_at=None.
    """
    if diagnostics is not None and not isinstance(diagnostics, dict):
        raise ValueError("diagnostics_requires_dict")
    clock = clock or time.time
    if exclude_urls is None:
        excluded = set()
    elif isinstance(exclude_urls, (set, frozenset, tuple, list)) and all(isinstance(url, str) for url in exclude_urls):
        excluded = set(exclude_urls)
    else:
        raise ValueError("exclude_urls_requires_strings")
    now = _now(now)
    if until is not None:
        now = min(now, _now(until))
    if since is None:
        since = now - timedelta(hours=72)
    elif type(since) is not date:
        since = date.fromisoformat(since) if isinstance(since, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", since) else _now(since)
    deadline = time.monotonic() + COLLECTION_SECONDS
    report = {source: {"feed_status": "not_completed", "status": "fetch_incomplete", "candidates": 0,
                      "selected": 0, "completed": 0, "accepted": 0, "errors": []} for source in SOURCES}

    def error_code(exc):
        return str(exc) if isinstance(exc, ValueError) and str(exc) in _ERROR_CODES else "source_read_failed"

    def read_feed(source):
        try:
            payload, final = _download(FEEDS[source], deadline)
            if final != FEEDS[source]:
                raise ValueError("unapproved_redirect")
            return source, _feed_items(payload, source, now, since), None
        except Exception as exc:
            return source, [], error_code(exc)

    batches = _parallel(list(SOURCES), read_feed, deadline)
    by_source = {source: [] for source in SOURCES}
    for source, items, error in batches:
        row = report[source]
        row.update(feed_status="failed" if error else "ok",
                   status="feed_failed" if error else "no_matching_candidates", candidates=len(items))
        if error:
            row["errors"].append(error)
        by_source[source] = [item for item in items if item["url"] not in excluded][:MAX_CANDIDATES]
    candidates = [item for group in zip_longest(*by_source.values()) for item in group if item is not None][:MAX_CANDIDATES]
    selected, selected_sources = [], set()
    for item in candidates:
        if item["source"] not in selected_sources:
            selected.append(item)
            selected_sources.add(item["source"])
        if len(selected) == MAX_ARTICLES:
            break
    for item in selected:
        report[item["source"]]["selected"] += 1

    def read_article(item):
        try:
            payload, final = _download(item["url"], deadline)
            observed = clock()
            article = _extract_article(payload, item, final, now, since, observed_at=observed)
            if article:
                verified = clock()
                if (type(observed) not in (int, float) or not math.isfinite(observed) or observed <= 0
                        or type(verified) not in (int, float) or not math.isfinite(verified)
                        or verified <= 0 or verified < observed):
                    raise ValueError("invalid_verification_clock")
                article["body_verified_at"] = verified
            return item, article, None if article else "body_or_date_unverified"
        except Exception as exc:
            return item, None, error_code(exc)

    records = []
    for item, article, error in _parallel(selected, read_article, deadline):
        row = report[item["source"]]
        row["completed"] += 1
        if article:
            row["accepted"] += 1
            records.append(article)
        elif error not in row["errors"]:
            row["errors"].append(error)
    for source, row in report.items():
        if row["selected"]:
            if row["accepted"]:
                row["status"] = "collected_partial" if row["errors"] or row["completed"] < row["selected"] else "collected"
            else:
                row["status"] = "fetch_incomplete" if row["completed"] < row["selected"] else "articles_unavailable"
        row["returned"] = sum(item["source"] == source for item in records)
        row["errors"].sort()
    if diagnostics is not None:
        diagnostics.clear()
        diagnostics.update(report)
    return sorted(records, key=_order)

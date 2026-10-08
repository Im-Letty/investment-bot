"""Validate issuer-published PR TIMES announcements against the 225 catalogue.

The public feed is a discovery source, not coverage of every constituent's
announcements. This module performs no requests, AI calls, or persistence.
Original text is a private writing input; it is not a public article archive.
"""
from datetime import date, datetime, timedelta
from hashlib import sha256
import math
import re
import unicodedata
from urllib.parse import urlsplit, urlunsplit
from xml.etree import ElementTree

from daily_news_sources import JST, _Document, _jsonld
from official_news_sources import _agree, _body_text, _descends, _in_window, _now, _publication
from company_news_selection import candidate_order, priority


FEED_URL = "https://prtimes.jp/index.rdf"
SOURCE = "PR TIMES"
MAX_BYTES = 1_000_000
MAX_FEED_ITEMS = 200
MIN_BODY_CHARS = 100
MAX_BODY_CHARS = 20_000
RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
RSS = "http://purl.org/rss/1.0/"
DC = "http://purl.org/dc/elements/1.1/"
DC_DATE = "{" + DC + "}date"
RSS_DATE = "{" + RSS + "}date"
_ARTICLE_PATH = re.compile(r"/main/html/rd/p/(\d{9})\.(\d{9})\.html")
_PROFILE_PATH = re.compile(r"/main/html/searchrlp/company_id/([1-9]\d*)")
_LOCAL_TIME = re.compile(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}")


def safe_url(value):
    """Accept only the public global RSS and inspected article URL format."""
    if not isinstance(value, str) or not value or len(value) > 2048:
        return None
    if any(char in value for char in ("\\", "?", "#")) or any(ord(char) < 33 or ord(char) == 127 for char in value):
        return None
    try:
        parsed = urlsplit(value)
        if (parsed.scheme.lower() != "https" or (parsed.hostname or "").lower() != "prtimes.jp"
                or parsed.username is not None or parsed.password is not None
                or parsed.port not in (None, 443) or parsed.query or parsed.fragment):
            return None
        path = parsed.path
        match = _ARTICLE_PATH.fullmatch(path)
        if path != "/index.rdf" and (not match or not all(int(part) > 0 for part in match.groups())):
            return None
        return urlunsplit(("https", "prtimes.jp", path, "", ""))
    except (ValueError, UnicodeError):
        return None


def _decode(payload):
    if not isinstance(payload, bytes) or len(payload) > MAX_BYTES:
        raise ValueError("source_size_limit")
    try:
        return payload.decode("utf-8-sig", errors="strict")
    except UnicodeDecodeError as exc:
        raise ValueError("unsupported_source_encoding") from exc


def _clean(value):
    if not isinstance(value, str):
        return ""
    # An inspected heading contains a NUL between ordinary Japanese letters.
    # Remove controls consistently without changing the words or their order.
    return " ".join("".join(char for char in value if ord(char) >= 32 or char in "\n\r\t").split())


def _plain(value):
    return _clean(_body_text(_Document(value).root)) if isinstance(value, str) else ""


def _compact(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", _clean(value)))


def _company_id(url):
    if safe_url(url) != url:
        return None
    match = _ARTICLE_PATH.fullmatch(urlsplit(url).path)
    return str(int(match.group(2))) if match else None


def _one(item, tag):
    values = item.findall(tag)
    return "".join(values[0].itertext()) if len(values) == 1 else None


def _window(now, since):
    current = _now(now)
    boundary = current - timedelta(hours=72) if since is None else since
    if type(boundary) is not date:
        boundary = _now(boundary)
    return current, boundary


def parse_feed(payload, now, since, catalogue):
    """Return important current candidates whose announcing issuer matches.

    Namespace-qualified feed dates are retained. A precise dc:date is a
    discovery hint: inspected global-feed clocks differ from datePublished.
    It never establishes the article's original publication clock.
    """
    now, since = _window(now, since)
    text = _decode(payload)
    if re.search(r"<!DOCTYPE|<!ENTITY", text, re.I):
        raise ValueError("unsupported_feed_declaration")
    try:
        root = ElementTree.fromstring(text)
    except ElementTree.ParseError as exc:
        raise ValueError("unsupported_feed_structure") from exc
    if root.tag != "{" + RDF + "}RDF" or len(root.findall("{" + RSS + "}channel")) != 1:
        raise ValueError("unsupported_feed_structure")
    records, conflicted = {}, set()
    for node in root.findall("{" + RSS + "}item")[:MAX_FEED_ITEMS]:
        raw_title = _one(node, "{" + RSS + "}title")
        raw_url = _one(node, "{" + RSS + "}link")
        raw_issuer = _one(node, "{" + DC + "}corp")
        if raw_issuer is None or "<" in raw_issuer or ">" in raw_issuer:
            continue
        issuer = _clean(raw_issuer)
        member = catalogue.match_issuer(issuer)
        title, url = _plain(raw_title), safe_url(raw_url)
        score, category = priority(title)
        if (not isinstance(member, dict) or not member.get("symbol") or not member.get("name")
                or not url or url == FEED_URL or not 1 <= len(title) <= 1000 or score <= 0):
            continue
        fields = {tag: _one(node, tag) for tag in (DC_DATE, RSS_DATE) if node.findall(tag)}
        if set(fields) != {DC_DATE, RSS_DATE}:
            continue
        values = [_publication(value) for value in fields.values()]
        publication = _agree(values)
        if not publication or not _in_window(publication, now, since):
            continue
        item = {"source": SOURCE, "symbol": member["symbol"], "name": member["name"],
                "issuer": issuer, "company_id": _company_id(url), "title": title, "url": url,
                "feed_date_fields": fields, "editorial_priority": score, "category": category,
                **publication}
        if url in records and records[url] != item:
            conflicted.add(url)
        records[url] = item
    return sorted((item for url, item in records.items() if url not in conflicted), key=candidate_order)


def _profile_id(value):
    if (not isinstance(value, str) or any(char in value for char in ("\\", "?", "#"))
            or any(ord(c) < 33 or ord(c) == 127 for c in value)):
        return None
    try:
        parsed = urlsplit(value)
        if (parsed.query or parsed.fragment or parsed.username is not None or parsed.password is not None
                or parsed.port not in (None, 443)):
            return None
        if parsed.netloc and (parsed.scheme != "https" or parsed.hostname != "prtimes.jp"):
            return None
        if not parsed.netloc and parsed.scheme:
            return None
        match = _PROFILE_PATH.fullmatch(parsed.path)
        return match.group(1) if match else None
    except (ValueError, UnicodeError):
        return None


def _article_date(value):
    publication = _publication(value)
    if publication or not isinstance(value, str) or not _LOCAL_TIME.fullmatch(value):
        return publication
    # The inspected page uses this local format without an explicit timezone.
    # Preserve its date; do not infer a publication timestamp from the locale.
    try:
        return _publication(datetime.fromisoformat(value).date().isoformat())
    except ValueError:
        return None


def _local_clock(value):
    if not isinstance(value, str) or not _LOCAL_TIME.fullmatch(value):
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _future_clock(value, publication, now):
    if publication and publication["published_at"] is not None:
        return publication["published_at"] > now.timestamp()
    clock = _local_clock(value)
    # Conservative eligibility only. A local clock ahead of the Japanese
    # observation is withheld; no timezone or timestamp is added to the output.
    return clock is not None and clock > now.astimezone(JST).replace(tzinfo=None)


def _article_objects(document):
    result = []
    for obj in _jsonld(document):
        types = obj.get("@type", [])
        types = types if isinstance(types, list) else [types]
        if any(value in ("Article", "NewsArticle", "https://schema.org/NewsArticle",
                         "https://schema.org/Article") for value in types):
            result.append(obj)
    return result


def _business_context(member, body, article_url):
    sources = member.get("business_sources")
    business = member.get("business")
    if isinstance(business, str) and 1 <= len(business.strip()) <= 2000 and isinstance(sources, list) and sources:
        first = sources[0]
        url = first.get("url") if isinstance(first, dict) else None
        if isinstance(url, str) and url.startswith("https://"):
            return business, url, "verified_profile"
    # This is evidence for the writer, not a claim that it describes the whole
    # company. Only work explicitly attributed to the issuer may be explained.
    return body[:1800], article_url, "announcement_only"


def extract_article(payload, item, final_url, now, since, *, observed_at=None, catalogue):
    """Verify the inspected article layout, identity and original publication."""
    now, since = _window(now, since)
    if not isinstance(item, dict) or item.get("source") != SOURCE:
        return None
    url, issuer = item.get("url"), item.get("issuer")
    company_id = _company_id(url)
    member = catalogue.match_issuer(issuer)
    if (not company_id or final_url != url or str(item.get("company_id")) != company_id
            or not isinstance(member, dict) or member.get("symbol") != item.get("symbol")
            or member.get("name") != item.get("name") or priority(item.get("title"))[0] <= 0):
        return None
    fields = item.get("feed_date_fields")
    if not isinstance(fields, dict) or set(fields) != {DC_DATE, RSS_DATE}:
        return None
    feed_publication = _agree([_publication(value) for value in fields.values()])
    if (not feed_publication or not _in_window(feed_publication, now, since)
            or any(item.get(key) != feed_publication[key] for key in
                                   ("published_date", "published_at", "publication_precision"))):
        return None
    observed_at = now.timestamp() if observed_at is None else observed_at
    if type(observed_at) not in (int, float) or not math.isfinite(observed_at) or observed_at <= 0:
        raise ValueError("invalid_verification_clock")
    document = _Document(_decode(payload))
    containers = [n for n in document.nodes if n.tag == "article" and n.attrs.get("id") == "js-heatmap-subject-area"]
    bodies = [n for n in document.nodes if n.tag == "div" and n.attrs.get("id") == "press-release-body"]
    headings = [n for n in document.nodes if n.tag == "h1" and n.attrs.get("id") == "press-release-title"]
    if len(containers) != 1 or len(bodies) != 1 or len(headings) != 1:
        return None
    container, body_root, heading = containers[0], bodies[0], headings[0]
    if not _descends(body_root, container) or not _descends(heading, container):
        return None
    if _compact(_plain(_body_text(heading))) != _compact(item.get("title")):
        return None
    positions = {id(n): i for i, n in enumerate(document.nodes)}
    header = [n for n in document.nodes if _descends(n, container)
              and positions[id(n)] < positions[id(body_root)] and not _descends(n, body_root)]
    anchors = [n for n in header if n.tag == "a" and _profile_id(n.attrs.get("href"))]
    datelines = [n for n in header if n.tag == "time"]
    if (len(anchors) != 1 or _profile_id(anchors[0].attrs.get("href")) != company_id
            or _compact(_body_text(anchors[0])) != _compact(issuer) or len(datelines) != 1):
        return None
    body = _body_text(body_root)
    if not MIN_BODY_CHARS <= len(body) <= MAX_BODY_CHARS:
        return None
    objects = _article_objects(document)
    if len(objects) != 1:
        return None
    article = objects[0]
    if _compact(_plain(article.get("headline"))) != _compact(item.get("title")):
        return None
    authors = article.get("author")
    authors = [authors] if isinstance(authors, dict) else authors
    if (not isinstance(authors, list) or len(authors) != 1 or not isinstance(authors[0], dict)
            or authors[0].get("@type") != "Organization"
            or _compact(authors[0].get("name")) != _compact(issuer)):
        return None
    if article.get("url") is not None and safe_url(article["url"]) != url:
        return None
    metadata_raw = article.get("datePublished")
    visible_raw = datelines[0].attrs.get("datetime")
    metadata_date, visible_date = _article_date(metadata_raw), _article_date(visible_raw)
    if (_future_clock(metadata_raw, metadata_date, now) or _future_clock(visible_raw, visible_date, now)):
        return None
    metadata_clock, visible_clock = _local_clock(metadata_raw), _local_clock(visible_raw)
    if metadata_clock is not None and visible_clock is not None and metadata_clock != visible_clock:
        return None
    # The RSS day, the visible original date, and datePublished must agree.
    # Global RSS dc:date is not a verified original clock and is not compared
    # to the article clock; dateModified is deliberately never consulted.
    values = [_publication(item["published_date"]), metadata_date, visible_date]
    publication = _agree(values)
    if not publication:
        return None
    if metadata_date["published_at"] is None or visible_date["published_at"] is None:
        publication = _publication(publication["published_date"])
    if not _in_window(publication, now, since):
        return None
    business, business_url, context_mode = _business_context(member, body, url)
    provenance = catalogue.provenance
    return {"symbol": member["symbol"], "name": member["name"], "business": business,
            "business_url": business_url, "business_context_mode": context_mode,
            "sector": member.get("sector") or "企業の取り組み", "source": SOURCE,
            "related_company": issuer, "company_id": company_id, "title": item["title"], "url": url,
            "catalogue_as_of": provenance["as_of"], "catalogue_facts_sha256": catalogue.facts_sha256,
            "catalogue_source_sha256": provenance["source_sha256"],
            "body": body, "body_sha256": sha256(body.encode()).hexdigest(),
            "body_verified_at": observed_at, "observed_at": observed_at, "evidence_url": final_url,
            "publication_evidence": {"feed_published_at": None,
                                     "feed_reported_at": item["published_at"],
                                     "feed_timestamp_role": "discovery",
                                     "article_published_at": metadata_date["published_at"],
                                     "visible_published_at": visible_date["published_at"],
                                     "article_original_date": metadata_raw,
                                     "visible_original_date": visible_raw,
                                     "feed_date_fields": dict(item.get("feed_date_fields", {}))},
            **publication}

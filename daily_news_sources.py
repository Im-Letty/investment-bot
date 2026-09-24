"""Bounded, read-only source collection for the website's daily edition.

This module never generates or publishes copy. Untrusted pages are evidence,
not instructions. A headline, search snippet or dateModified is not an article.
Failure to verify today's original publication date and body returns no record.
"""
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from hashlib import sha256
from html import unescape
from html.parser import HTMLParser
from itertools import islice
import ipaddress
import json
import math
import re
import socket
import time
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import feedparser
import requests
from requests.adapters import HTTPAdapter
from urllib3 import HTTPSConnectionPool

JST = timezone(timedelta(hours=9))
NHK_FEED = "https://www.nhk.or.jp/rss/news/cat5.xml"
REUTERS_PAGES = ("https://www.reuters.com/business/", "https://www.reuters.com/world/japan/")
MAX_ARTICLES = 8
MAX_CANDIDATES = 24
MAX_WORKERS = 3
MAX_BYTES = 2_000_000
MAX_REDIRECTS = 3
MAX_BODY_CHARS = 30_000
MIN_BODY_CHARS = 200
COLLECTION_SECONDS = 55
REQUEST_SECONDS = 12
_ARTICLE_TYPES = {"Article", "NewsArticle", "ReportageNewsArticle", "AnalysisNewsArticle"}
_VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
_BLOCKED = {"script", "style", "nav", "footer", "header", "aside", "form", "noscript", "button"}
_EXCLUDED_CLASS = re.compile(r"(?:^|[-_\s])(related|recommend\w*|advert\w*|share|social|caption|byline|copyright|subscription|paywall|breadcrumb)(?:$|[-_\s])", re.I)
_BODY_CLASS = re.compile(r"(?:article|story|news)[-_]?(?:body|content)|body[-_]?text", re.I)
_REUTERS_CREDIT = re.compile(r"(?:\(\s*Reuters\s*\)\s*[-–—]|（\s*ロイター\s*）\s*[-–—]|[［\[][^］\]\n]{0,100}ロイター\s*[］\]]\s*[-–—]|(?:Source|提供|配信|出典)\s*[:：]\s*(?:Reuters|ロイター))", re.I)


def _family(host):
    if host == "nhk.or.jp" or host.endswith(".nhk.or.jp") or host == "news.web.nhk":
        return "nhk"
    if host == "reuters.com" or host.endswith(".reuters.com"):
        return "reuters"
    if host == "marketscreener.com" or host.endswith(".marketscreener.com"):
        return "distribution"
    if host == "live.euronext.com" or host in ("newsweekjapan.jp", "www.newsweekjapan.jp"):
        return "distribution"
    return None


def _safe_url(value):
    if not isinstance(value, str) or len(value) > 2048:
        return None
    value = value.strip()
    if not value or any(ord(c) < 33 or ord(c) == 127 for c in value) or "\\" in value:
        return None
    try:
        p = urlsplit(value)
        host = (p.hostname or "").lower()
        if (p.scheme.lower() != "https" or not _family(host) or p.username is not None
                or p.password is not None or p.port not in (None, 443)):
            return None
        if host in ("newsweekjapan.jp", "www.newsweekjapan.jp"):
            if not (p.path.startswith("/headlines/") or re.fullmatch(r"/articles/-/\d+/?", p.path)):
                return None
        return urlunsplit(("https", host, p.path or "/", p.query, ""))
    except (ValueError, UnicodeError):
        return None


def _public_ip(host):
    addresses = list(dict.fromkeys(row[4][0] for row in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)))
    if not addresses or any(not ipaddress.ip_address(ip).is_global or ipaddress.ip_address(ip).is_multicast for ip in addresses):
        raise ValueError("Source resolved to a non-public address")
    return addresses[0]


class _PinnedHTTPSAdapter(HTTPAdapter):
    """Connect to the checked IP, keeping the original TLS SNI and hostname.

    Pinning closes the DNS check/request gap. Environment proxies are disabled by
    the caller; no cookies or authorization are forwarded between redirect hops.
    """
    def __init__(self, host, address):
        super().__init__(max_retries=0)
        self._source_pool = HTTPSConnectionPool(address, port=443, assert_hostname=host,
                                                server_hostname=host, maxsize=1,
                                                cert_reqs="CERT_REQUIRED", ca_certs=requests.certs.where())

    def get_connection_with_tls_context(self, request, verify, proxies=None, cert=None):
        return self._source_pool

    def get_connection(self, url, proxies=None):  # Requests before 2.32
        return self._source_pool

    def close(self):
        self._source_pool.close()
        super().close()


def _download(url, deadline):
    current = _safe_url(url)
    if current is None:
        raise ValueError("Unapproved source URL")
    limit = min(deadline, time.monotonic() + REQUEST_SECONDS)
    seen = set()
    for hop in range(MAX_REDIRECTS + 1):
        if current in seen or time.monotonic() >= limit:
            raise ValueError("Source redirect/time limit")
        seen.add(current)
        host = urlsplit(current).hostname
        address = _public_ip(host)
        remaining = limit - time.monotonic()
        if remaining <= 0:
            raise ValueError("Source time limit")
        with requests.Session() as session:
            session.trust_env = False
            session.mount("https://", _PinnedHTTPSAdapter(host, address))
            with session.get(current, allow_redirects=False, stream=True, verify=True,
                             timeout=(min(3, remaining), min(4, remaining)),
                             headers={"User-Agent": "EconomicNewsSourceCollector/1.0",
                                      "Accept": "text/html,application/xhtml+xml,application/xml,text/xml",
                                      "Accept-Encoding": "identity", "Host": host}) as response:
                if response.status_code in (301, 302, 303, 307, 308):
                    if hop == MAX_REDIRECTS:
                        raise ValueError("Source redirect limit")
                    current = _safe_url(urljoin(current, response.headers.get("Location", "")))
                    if current is None:
                        raise ValueError("Unapproved redirect destination")
                    continue
                if response.status_code != 200:
                    raise ValueError("Source unavailable")
                content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower().strip()
                if content_type not in ("text/html", "application/xhtml+xml", "application/xml", "text/xml", "application/rss+xml", "application/atom+xml"):
                    raise ValueError("Unsupported source content type")
                length = response.headers.get("Content-Length", "")
                if length and (not length.isdigit() or int(length) > MAX_BYTES):
                    raise ValueError("Source size limit")
                payload = bytearray()
                while True:
                    # read1 returns available bytes instead of waiting to fill
                    # a chunk, so a trickling response cannot reset our budget.
                    chunk = response.raw.read1(4096, decode_content=True)
                    if time.monotonic() >= limit or len(payload) + len(chunk) > MAX_BYTES:
                        raise ValueError("Source size/time limit")
                    if not chunk:
                        break
                    payload.extend(chunk)
                if time.monotonic() >= limit:
                    raise ValueError("Source time limit")
                return bytes(payload), current
    raise ValueError("Source redirect limit")


class _Node:
    def __init__(self, tag="root", attrs=None, parent=None):
        self.tag, self.attrs, self.parent, self.children = tag, attrs or {}, parent, []


class _Document(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.root = _Node()
        self.stack = [self.root]
        self.nodes = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        node = _Node(tag, dict(attrs), self.stack[-1])
        self.stack[-1].children.append(node)
        self.nodes.append(node)
        if tag not in _VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in _VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def _text(node, exclude=True):
    # Iterative traversal avoids recursion on malformed/deep source HTML.
    parts, pending = [], [node]
    while pending:
        item = pending.pop()
        if isinstance(item, str):
            parts.append(item)
        elif not exclude or (item.tag not in _BLOCKED and not _EXCLUDED_CLASS.search(item.attrs.get("class", ""))):
            pending.extend(reversed(item.children))
    return re.sub(r"\s+", " ", unescape("".join(parts))).strip()


def _clean(value):
    if isinstance(value, dict):
        value = value.get("@value")  # NHK uses JSON-LD language-tagged strings.
    return re.sub(r"\s+", " ", unescape(value)).strip() if isinstance(value, str) else ""


def _published(value):
    # Date-only values and timezone-free local times cannot establish a JST day.
    if not isinstance(value, str):
        return None
    try:
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            parsed = parsedate_to_datetime(value)
        return parsed.astimezone(timezone.utc) if parsed.tzinfo is not None else None
    except (ValueError, TypeError, OverflowError):
        return None


def _objects(value):
    pending, count = [(value, 0)], 0
    while pending and count < 1000:
        item, depth = pending.pop()
        count += 1
        if depth > 20:
            continue
        if isinstance(item, dict):
            yield item
            pending.extend((v, depth + 1) for v in item.values() if isinstance(v, (dict, list)))
        elif isinstance(item, list):
            pending.extend((v, depth + 1) for v in item[:100] if isinstance(v, (dict, list)))


def _jsonld(document):
    result = []
    for node in document.nodes:
        if node.tag == "script" and node.attrs.get("type", "").split(";", 1)[0].lower() == "application/ld+json":
            try:
                result.extend(_objects(json.loads(_text(node, exclude=False))))
            except (ValueError, TypeError, RecursionError):
                continue
    return result


def _article_object(obj):
    types = obj.get("@type", [])
    return any(str(t).rsplit("/", 1)[-1] in _ARTICLE_TYPES for t in (types if isinstance(types, list) else [types]))


def _paragraphs(document):
    roots = [n for n in document.nodes if "articleBody" in n.attrs.get("itemprop", "").split()
             or _BODY_CLASS.search(n.attrs.get("class", "") + " " + n.attrs.get("id", ""))]
    if not roots:
        roots = [n for n in document.nodes if n.tag == "article"]
    chunks = []
    for node in document.nodes:
        if node.tag != "p":
            continue
        ancestor, in_body, excluded = node, False, False
        while ancestor is not None:
            in_body = in_body or ancestor in roots
            excluded = excluded or ancestor.tag in _BLOCKED or bool(_EXCLUDED_CLASS.search(ancestor.attrs.get("class", "")))
            ancestor = ancestor.parent
        if in_body and not excluded:
            text = _text(node)
            if text and text not in chunks:
                chunks.append(text)
    return "\n\n".join(chunks)


def _identity(url):
    parsed = urlsplit(url)
    return parsed.hostname, parsed.path.rstrip("/")


def _attributed_to_reuters(obj, body):
    for field in ("author", "creator", "copyrightHolder", "sourceOrganization", "provider", "publisher"):
        data = obj.get(field)
        names = [data] if isinstance(data, str) else [v.get("name") for v in _objects(data)]
        if any(isinstance(name, str) and re.fullmatch(r"\s*(?:Reuters|ロイター)(?:\s+(?:News\s+Agency|Staff))?\s*", name, re.I) for name in names):
            return True
    return bool(_REUTERS_CREDIT.search(body[:500]))


def _extract_article(payload, original_url, final_url, now):
    document = _Document(payload.decode("utf-8", errors="replace"))
    metadata = {}
    for node in document.nodes:
        if node.tag == "meta":
            key = (node.attrs.get("property") or node.attrs.get("name") or node.attrs.get("itemprop") or "").lower()
            if node.attrs.get("content"):
                metadata.setdefault(key, []).append(node.attrs["content"])
    identities = {_identity(original_url), _identity(final_url)}
    for node in document.nodes:
        if node.tag == "link" and "canonical" in node.attrs.get("rel", "").split():
            canonical = _safe_url(urljoin(final_url, node.attrs.get("href", "")))
            if canonical and _family(urlsplit(canonical).hostname) == _family(urlsplit(final_url).hostname):
                identities.add(_identity(canonical))
    objects = []
    for obj in _jsonld(document):
        if not _article_object(obj):
            continue
        identity = obj.get("url") or obj.get("mainEntityOfPage")
        if isinstance(identity, dict):
            identity = identity.get("@id") or identity.get("url")
        if isinstance(identity, str) and _identity(urljoin(final_url, identity)) not in identities:
            continue
        if obj.get("isAccessibleForFree") in (False, "False", "false"):
            return None
        objects.append(obj)
    # Multiple unrelated Article nodes on a list page are not a single article.
    if len(objects) > 1:
        signatures = {(_clean(o.get("headline")), str(o.get("datePublished"))) for o in objects}
        if len(signatures) != 1:
            return None
    obj = max(objects, key=lambda o: len(_clean(o.get("articleBody"))), default={})
    dates = [obj["datePublished"]] if obj.get("datePublished") is not None else []
    for key in ("article:published_time", "og:article:published_time", "datepublished", "pubdate", "publishdate", "parsely-pub-date"):
        dates.extend(metadata.get(key, []))
    times = [_published(value) for value in dates]
    if not times or any(value is None for value in times) or len({value.timestamp() for value in times}) != 1:
        return None
    published = times[0]
    if published > now or published.astimezone(JST).date() != now.astimezone(JST).date():
        return None
    title = _clean(obj.get("headline")) or _clean(next(iter(metadata.get("og:title", [])), ""))
    body = _clean(obj.get("articleBody")) or _paragraphs(document)
    if "<" in body and re.search(r"</?[A-Za-z][^>]*>", body):
        body = _text(_Document(body).root)
    if (not title or len(title) > 1000 or not MIN_BODY_CHARS <= len(body) <= MAX_BODY_CHARS
            or body == title or body.count("�") > 2):
        return None
    family = _family(urlsplit(final_url).hostname)
    if family == "distribution" and not _attributed_to_reuters(obj, body):
        return None
    # A publisher changing during a redirect must not relabel another outlet.
    if _family(urlsplit(original_url).hostname) == "nhk" and family != "nhk":
        return None
    if _family(urlsplit(original_url).hostname) != "nhk" and family == "nhk":
        return None
    return {"source": "NHK経済" if family == "nhk" else "ロイター経済",
            "title": title, "url": original_url, "published_at": published.timestamp(), "body": body,
            "body_sha256": sha256(body.encode("utf-8")).hexdigest(),
            "evidence_url": final_url, "publication_evidence": "datePublished" if obj.get("datePublished") else "publication_meta"}


def _discover(url, now, deadline):
    payload, final_url = _download(url, deadline)
    candidates = []
    if url == NHK_FEED:
        for raw_entry in feedparser.parse(payload).entries[:60]:
            entry = dict(raw_entry)  # Do not alias an updated date to published.
            published = _published(entry.get("published"))
            link = _safe_url(entry.get("link"))
            if (link and _family(urlsplit(link).hostname) == "nhk" and published and published <= now
                    and published.astimezone(JST).date() == now.astimezone(JST).date()):
                candidates.append(link)
    else:
        document = _Document(payload.decode("utf-8", errors="replace"))
        links = [node.attrs.get("href") for node in document.nodes if node.tag == "a"]
        for obj in _jsonld(document):
            links.extend([obj.get("url"), obj.get("@id")])
        for raw in links:
            if not isinstance(raw, str):
                continue
            link = _safe_url(urljoin(final_url, raw))
            if (link and _family(urlsplit(link).hostname) == "reuters"
                    and re.search(r"/\d{4}-\d{2}-\d{2}/?$|-\d{4}-\d{2}-\d{2}/?$", urlsplit(link).path)
                    and urlsplit(link).path.startswith(("/business/", "/markets/", "/world/japan/"))):
                candidates.append(link)
    return list(dict.fromkeys(candidates))[:MAX_CANDIDATES]


def _parallel(items, function, deadline):
    if not items or time.monotonic() >= deadline:
        return []
    pool = ThreadPoolExecutor(max_workers=MAX_WORKERS, thread_name_prefix="website-news-source")
    futures = [pool.submit(function, item) for item in items]
    try:
        completed, _ = wait(futures, timeout=max(0, deadline - time.monotonic()))
        results = []
        for future in futures:  # Stable order regardless of network timing.
            if future in completed:
                try:
                    results.append(future.result())
                except Exception:
                    # Source rejection/outage is an absence of verified evidence.
                    pass
        return results
    finally:
        pool.shutdown(wait=False, cancel_futures=True)


def collect_articles(now, candidate_urls=None):
    """Return 0..8 verified current-JST-day articles, never headline-only items.

    ``now`` is a timezone-aware datetime or Unix seconds. Caller-supplied search
    results contribute URL candidates only, never facts or publication dates.
    Network failures and insufficient source evidence are deliberately skipped.
    """
    if isinstance(now, datetime):
        if now.tzinfo is None:
            raise ValueError("now requires a timezone")
        now = now.astimezone(timezone.utc)
    elif isinstance(now, (float, int)) and not isinstance(now, bool) and math.isfinite(now):
        now = datetime.fromtimestamp(now, timezone.utc)
    else:
        raise ValueError("now requires a timezone-aware datetime or Unix seconds")
    deadline = time.monotonic() + COLLECTION_SECONDS
    supplied = []
    for value in islice(candidate_urls or [], MAX_CANDIDATES):
        if safe := _safe_url(value):
            supplied.append(safe)
    discoveries = [] if supplied else _parallel([NHK_FEED, *REUTERS_PAGES], lambda url: _discover(url, now, deadline), deadline)
    urls = list(dict.fromkeys(supplied + [url for batch in discoveries for url in batch]))[:MAX_CANDIDATES]

    def fetch(url):
        parsed = urlsplit(url)
        fetch_url = url
        if parsed.hostname in ("newsweekjapan.jp", "www.newsweekjapan.jp"):
            # The publisher's full-article view prevents collecting page 1 only.
            query = [(k, v) for k, v in parse_qsl(parsed.query) if k != "display"]
            fetch_url = urlunsplit(parsed._replace(query=urlencode(query + [("display", "b")])))
        payload, final_url = _download(fetch_url, deadline)
        return _extract_article(payload, url, final_url, now)

    records = [record for record in _parallel(urls, fetch, deadline) if record]
    records.sort(key=lambda record: (-record["published_at"], record["url"]))
    unique, urls_seen, titles_seen, bodies_seen = [], set(), set(), set()
    for record in records:
        identity = _identity(record["evidence_url"])
        title = re.sub(r"\W", "", record["title"]).casefold()
        if identity in urls_seen or title in titles_seen or record["body_sha256"] in bodies_seen:
            continue
        urls_seen.add(identity)
        titles_seen.add(title)
        bodies_seen.add(record["body_sha256"])
        unique.append(record)
    return unique[:MAX_ARTICLES]

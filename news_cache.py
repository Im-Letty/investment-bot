"""Shared public RSS snapshots; slow feeds never block an existing snapshot."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from threading import Condition, Thread
import gzip
import io
import json
import logging
import math
import time
import unicodedata
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen

import feedparser

logger = logging.getLogger(__name__)
JST = timezone(timedelta(hours=9))
MAX_FEED_ENTRIES = 40


NEWS_FEEDS = {
    "NHK経済": "https://www.nhk.or.jp/rss/news/cat5.xml",
    "NHK株・企業": "https://www.nhk.or.jp/rss/news/cat4.xml",
    "ロイター経済": "https://feeds.reuters.com/reuters/businessNews",
    "ロイター米国株": "https://feeds.reuters.com/reuters/companyNews",
}
WEB_NEWS_SOURCES = ("NHK経済", "ロイター経済")


def _safe_url(value):
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value or any(ord(char) < 33 or ord(char) == 127 for char in value) or "\\" in value:
        return None
    try:
        parsed = urlsplit(value)
        if (parsed.scheme.lower() not in ("http", "https") or not parsed.hostname
                or parsed.username is not None or parsed.password is not None):
            return None
        # Accessing port also rejects malformed ports before exposing a link.
        parsed.port
        return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(),
                           parsed.path or "/", parsed.query, ""))
    except ValueError:
        return None


def _publication_time(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    try:
        published = datetime.fromtimestamp(value, timezone.utc)
        published.astimezone(JST)
        return published
    except (ValueError, OverflowError, OSError):
        return None


def _feed_record(entry):
    # FeedParserDict aliases a missing published key to updated. A plain dict
    # prevents an article's edit time being mistaken for its original date.
    entry = dict(entry)
    title = str(entry.get("title") or "").strip()[:1000]
    if not title:
        return None
    links = entry.get("links") or []
    candidates = [link.get("href") for link in links if link.get("rel") == "canonical"]
    candidates.extend((entry.get("canonical"), entry.get("link")))
    candidates.extend(link.get("href") for link in links if link.get("rel") == "alternate")
    url = next((safe for candidate in candidates if (safe := _safe_url(candidate))), None)
    published = None
    raw_date = entry.get("published")
    if isinstance(raw_date, str):
        # Feedparser normalizes impossible ISO dates (for example February 30).
        # Validate the original RSS/Atom date strictly and require its timezone.
        try:
            try:
                published = datetime.fromisoformat(raw_date.strip().replace("Z", "+00:00"))
            except ValueError:
                published = parsedate_to_datetime(raw_date)
            published = published.astimezone(timezone.utc) if published.tzinfo else None
        except (TypeError, ValueError, OverflowError):
            published = None
    if published:
        published = _publication_time(published.timestamp())
    return {"title": title, "url": url,
            "published_at": published.timestamp() if published else None,
            "published_date": published.astimezone(JST).date().isoformat() if published else None}


def fetch_feed(url):
    # Parse bytes so feedparser cannot make an unbounded network request.
    deadline = time.monotonic() + 10
    request = Request(url, headers={"User-Agent": feedparser.USER_AGENT,
                                   "Accept-Encoding": "identity"})
    # Keep the original feedparser urllib transport and feed client identity.
    # read1 returns available buffered bytes without filling a large chunk or
    # paying Python iteration overhead for every byte on a small server.
    with urlopen(request, timeout=8) as response:
        content = bytearray()
        while True:
            if time.monotonic() > deadline:
                raise ValueError("RSS response exceeded its time budget")
            chunk = response.read1(64 * 1024)
            content.extend(chunk)
            if len(content) > 2_000_000 or time.monotonic() > deadline:
                raise ValueError("RSS response exceeded its size/time budget")
            if not chunk:
                break
        # identity was requested, but tolerate a server returning gzip anyway.
        if response.headers.get("Content-Encoding", "").lower() == "gzip":
            with gzip.GzipFile(fileobj=io.BytesIO(content)) as compressed:
                content = compressed.read(2_000_001)
            if len(content) > 2_000_000:
                raise ValueError("RSS response exceeded its decoded size budget")
    parsed = feedparser.parse(bytes(content))
    records = tuple(record for entry in parsed.entries[:MAX_FEED_ENTRIES]
                    if (record := _feed_record(entry)))
    if not records and not parsed.get("version"):
        raise ValueError("RSS response contained no usable headlines")
    return records


class NewsCache:
    def __init__(self, feeds=None, fetcher=fetch_feed, *, ttl=120,
                 max_stale=900, retry_after=30, cold_wait=4, clock=time.time):
        self.feeds = dict(NEWS_FEEDS if feeds is None else feeds)
        self.fetcher = fetcher
        self.ttl, self.max_stale = ttl, max_stale
        self.retry_after, self.cold_wait = retry_after, cold_wait
        self.clock = clock
        self._condition = Condition()
        self._values = {}
        self._source_status = {label: "pending" for label in self.feeds}
        self._pending_sources = set()
        self._refreshing = False
        self._next_attempt = 0

    def _snapshot(self):
        now, items, times = self.clock(), [], {}
        for label in self.feeds:
            records, fetched_at = self._values.get(label, ((), 0))
            if label in self._values and 0 <= now - fetched_at <= self.max_stale:
                items.extend({**deepcopy(record), "source": label} for record in records)
                times[label] = fetched_at
        fetched_at = min(times.values()) if times else None
        statuses = {label: ("expired" if status in ("ok", "empty") and label not in times else status)
                    for label, status in self._source_status.items()}
        return {"news": items, "fetched_at": fetched_at,
                "source_fetched_at": times, "refreshing": self._refreshing,
                "source_status": statuses,
                "source_stale": {label: now - stamp >= self.ttl for label, stamp in times.items()},
                "source_refreshing": {label: label in self._pending_sources for label in self.feeds},
                "stale": any(now - stamp >= self.ttl for stamp in times.values())}

    def snapshot(self, *, wait=True):
        with self._condition:
            if not self._refreshing and self.clock() >= self._next_attempt:
                self._refreshing = True
                self._pending_sources = set(self.feeds)
                try:
                    Thread(target=self._refresh, daemon=True).start()
                except Exception:
                    self._refreshing = False
                    self._pending_sources.clear()
                    self._next_attempt = self.clock() + self.retry_after
                    self._condition.notify_all()
            # A cold visitor can use the first completed feed. Other visitors
            # immediately receive a copy of the most recent usable snapshot.
            if wait and not self._snapshot()["news"] and self._refreshing:
                self._condition.wait_for(
                    lambda: bool(self._snapshot()["news"]) or not self._refreshing,
                    timeout=self.cold_wait)
            return self._snapshot()

    def _refresh(self):
        successes = 0
        try:
            with ThreadPoolExecutor(max_workers=max(1, len(self.feeds))) as pool:
                pending = {pool.submit(self.fetcher, url): label
                           for label, url in self.feeds.items()}
                for future in as_completed(pending):
                    try:
                        records = []
                        for item in future.result()[:MAX_FEED_ENTRIES]:
                            # Test fetchers and older integrations may still
                            # provide title strings; their raw report remains usable.
                            record = deepcopy(item) if isinstance(item, dict) else {"title": item}
                            record["title"] = str(record.get("title") or "").strip()[:1000]
                            if record["title"]:
                                records.append(record)
                    except Exception as error:
                        logger.warning("RSS refresh failed source=%s error=%s status=%s",
                                       pending[future], type(error).__name__,
                                       getattr(error, "code", "-"))
                        with self._condition:
                            self._source_status[pending[future]] = "error"
                            self._pending_sources.discard(pending[future])
                        continue
                    with self._condition:
                        self._values[pending[future]] = (tuple(records), self.clock())
                        self._source_status[pending[future]] = "ok" if records else "empty"
                        self._pending_sources.discard(pending[future])
                        successes += 1
                        self._condition.notify_all()
        finally:
            with self._condition:
                delay = self.ttl if successes == len(self.feeds) else self.retry_after
                self._next_attempt = self.clock() + delay
                self._refreshing = False
                self._pending_sources.clear()
                self._condition.notify_all()


news_cache = NewsCache()


def load_reviewed_supplements(path=None):
    """Read explicit editorial approvals; missing or invalid files approve none."""
    try:
        approvals = json.loads(Path(path or Path(__file__).with_name("news-supplements.json")).read_text(encoding="utf-8"))
        if not isinstance(approvals, list) or any(
                not isinstance(item, dict) or not _safe_url(item.get("url"))
                or not isinstance(item.get("reason"), str) or not item["reason"].strip()
                for item in approvals):
            return []
        return [{"url": _safe_url(item["url"]), "reason": item["reason"].strip()[:1000]}
                for item in approvals]
    except (OSError, ValueError, TypeError):
        return []


def _validated_digest(value):
    """Validate authored Japanese copy and the original articles it summarizes."""
    if not isinstance(value, dict) or value.get("lang") != "ja":
        return None
    edition, headline, summary = (value.get(field) for field in ("edition_date", "headline", "summary"))
    refs = value.get("article_refs")
    mode = value.get("publication_mode")
    if mode not in (None, "curated"):
        return None
    curated = mode == "curated"
    if (not isinstance(edition, str) or not isinstance(headline, str)
            or not 1 <= len(headline.strip()) <= 80 or not isinstance(summary, str)
            or not 200 <= len(summary.strip()) <= 300
            or not isinstance(refs, list) or not (2 if curated else 1) <= len(refs) <= 3):
        return None
    articles, identities = [], set()
    for ref in refs:
        if not isinstance(ref, dict):
            return None
        source, title = ref.get("source"), ref.get("title")
        url, published = _safe_url(ref.get("url")), _publication_time(ref.get("published_at"))
        if (source not in WEB_NEWS_SOURCES or not isinstance(title, str)
                or not title.strip() or len(title) > 1000 or not url or published is None
                or published.astimezone(JST).date().isoformat() != edition):
            return None
        identity = (source, url, published.timestamp(), title)
        if identity in identities:
            return None
        identities.add(identity)
        articles.append(dict(zip(("source", "url", "published_at", "title"), identity)))
    result = {"edition_date": edition, "lang": "ja", "headline": headline.strip(),
              "summary": summary.strip(), "article_refs": articles}
    if curated:
        reviewed = _publication_time(value.get("reviewed_at"))
        titles = {" ".join(unicodedata.normalize("NFKC", ref["title"]).casefold().split())
                  for ref in articles}
        if (reviewed is None or reviewed.astimezone(JST).date().isoformat() != edition
                or reviewed.timestamp() < max(ref["published_at"] for ref in articles)
                or len({ref["url"] for ref in articles}) != len(articles)
                or len(titles) != len(articles)):
            return None
        result.update(publication_mode="curated", reviewed_at=reviewed.timestamp())
    return result


def load_reviewed_digests(path=None):
    """Read reviewed copy; a missing or malformed file supplies no daily digest."""
    try:
        values = json.loads(Path(path or Path(__file__).with_name("news-digests.json")).read_text(encoding="utf-8"))
        if not isinstance(values, list):
            return []
        digests = [_validated_digest(value) for value in values]
        return digests if all(digest is not None for digest in digests) else []
    except (OSError, ValueError, TypeError):
        return []


def _select_reviewed_digest(news, edition, reviewed_digests):
    # A changing feed must never attach yesterday's copy, or a summary of only
    # part of the selected news, to a new set of articles. Match before translation.
    if not news or not reviewed_digests or any(not isinstance(item.get("source"), str) for item in news):
        return None
    fields = ("source", "url", "published_at", "title")
    selected = {tuple(item[field] for field in fields) for item in news}
    matches = []
    for value in reviewed_digests:
        digest = _validated_digest(value)
        if (digest is None or digest.get("publication_mode") == "curated"
                or digest["edition_date"] != edition):
            continue
        refs = {tuple(ref[field] for field in fields) for ref in digest["article_refs"]}
        if refs == selected and len(digest["article_refs"]) == len(news):
            matches.append(digest)
    # Multiple matching reviews are ambiguous rather than an implicit override.
    return matches[0] if len(matches) == 1 else None


def _select_curated_digest(news, edition, now, reviewed_digests):
    """Keep an explicitly published edition independent of an RSS list window.

    Editorial review records the original source facts, including articles a
    feed no longer exposes. Absence from a feed is not a contradiction. An
    observed change to a referenced article's identity does require re-review.
    """
    candidates = []
    for value in reviewed_digests:
        digest = _validated_digest(value)
        if (digest is not None and digest.get("publication_mode") == "curated"
                and digest["edition_date"] == edition and digest["reviewed_at"] <= now):
            candidates.append(digest)
    if len(candidates) != 1:
        return None
    digest = candidates[0]
    by_url = {ref["url"]: ref for ref in digest["article_refs"]}
    for item in news:
        ref = by_url.get(_safe_url(item.get("url")))
        if ref is not None:
            published = _publication_time(item.get("published_at"))
            if (item.get("source") != ref["source"] or item.get("title") != ref["title"]
                    or published is None or published.timestamp() != ref["published_at"]):
                return None
    return digest


def select_daily_news(snapshot, now=None, *, reviewed_supplements=(), max_items=3,
                      max_supplements=1, allowed_sources=None, reviewed_digests=()):
    """Select today's original publications in JST, plus explicit dated reviews.

    ``now`` accepts a Unix timestamp or datetime (naive datetimes mean UTC).
    Approvals contain an obtained article URL and a nonempty editorial reason;
    approvals cannot supply or override an article's title or publication date.
    An unmarked reviewed digest must cover exactly the live selection. An
    explicitly curated edition publishes its own reviewed two or three current
    articles, retaining source-fetch diagnostics separately from publication.
    """
    if isinstance(now, datetime):
        now = now.replace(tzinfo=timezone.utc) if now.tzinfo is None else now
        now = now.timestamp()
    now = time.time() if now is None else now
    current = _publication_time(now)
    if current is None:
        raise ValueError("now must be a valid publication timestamp")
    snapshot = deepcopy(snapshot)
    if allowed_sources is not None:
        allowed_sources = set(allowed_sources)
        snapshot["news"] = [item for item in snapshot.get("news", []) if item.get("source") in allowed_sources]
        for field in ("source_status", "source_fetched_at", "source_stale", "source_refreshing"):
            snapshot[field] = {label: value for label, value in snapshot.get(field, {}).items()
                               if label in allowed_sources}
        snapshot["fetched_at"] = min(snapshot["source_fetched_at"].values(), default=None)
        snapshot["stale"] = any(snapshot["source_stale"].values())
        snapshot["refreshing"] = any(snapshot["source_refreshing"].values())
    edition = current.astimezone(JST).date()
    counts = dict(received=0, valid_dated=0, today=0, older=0,
                  unknown_date=0, future_date=0, invalid_url=0)
    today, earlier = [], []
    for original in snapshot.get("news", []):
        counts["received"] += 1
        item = deepcopy(original)
        url = _safe_url(item.get("url"))
        if not url:
            counts["invalid_url"] += 1
            continue
        published = _publication_time(item.get("published_at"))
        if published is None:
            counts["unknown_date"] += 1
            continue
        if published > current:
            counts["future_date"] += 1
            continue
        counts["valid_dated"] += 1
        published_date = published.astimezone(JST).date()
        item.update(url=url, published_at=published.timestamp(), published_date=published_date.isoformat())
        if published_date == edition:
            counts["today"] += 1
            today.append(item)
        else:
            counts["older"] += 1
            if timedelta(0) < edition - published_date <= timedelta(days=7):
                earlier.append(item)

    seen_urls, seen_titles = set(), set()
    def unique(items, limit):
        selected = []
        for item in sorted(items, key=lambda item: item["published_at"], reverse=True):
            title_key = " ".join(unicodedata.normalize("NFKC", item["title"]).casefold().split())
            if not title_key or item["url"] in seen_urls or title_key in seen_titles:
                continue
            seen_urls.add(item["url"])
            seen_titles.add(title_key)
            if len(selected) < limit:
                selected.append(item)
        return selected

    news = unique(today, max(0, min(3, max_items)))
    approvals = {}
    for approval in reviewed_supplements:
        if not isinstance(approval, dict):
            continue
        url, reason = _safe_url(approval.get("url")), approval.get("reason")
        if url and isinstance(reason, str) and reason.strip():
            approvals[url] = reason.strip()[:1000]
    reviewed = [{**item, "is_supplement": True, "editorial_reason": approvals[item["url"]]}
                for item in earlier if item["url"] in approvals]
    supplements = unique(reviewed, max(0, min(1, max_supplements)))
    source_status = snapshot.get("source_status", {})
    if news or supplements:
        status = "ready"
    elif counts["received"] or any(value in ("ok", "empty") for value in source_status.values()):
        status = "empty_today"
    elif snapshot.get("refreshing"):
        status = "refreshing"
    else:
        status = "unavailable"
    result = {**deepcopy(snapshot), "news": news, "supplements": supplements,
              "policy_version": 4, "edition_date": edition.isoformat(),
              "digest": _select_reviewed_digest(news, edition.isoformat(), reviewed_digests),
              "selection_status": status, "selection_counts": counts}
    curated = _select_curated_digest(snapshot.get("news", []), edition.isoformat(), now, reviewed_digests)
    if (curated is not None and len(curated["article_refs"]) <= max(0, min(3, max_items))
            and (allowed_sources is None or all(ref["source"] in allowed_sources
                                                for ref in curated["article_refs"]))):
        # These articles were checked for publication, not obtained by this RSS
        # request. Retain source-level fetch diagnostics without fabricating a
        # combined retrieval timestamp or saving this as a fresh feed snapshot.
        result.update(delivery="published", fetched_at=None, stale=False,
                      news=[{**deepcopy(ref), "published_date": edition.isoformat()}
                            for ref in curated["article_refs"]],
                      digest=curated, selection_status="ready")
    return result


class HeadlineTranslations:
    """Show current headlines immediately while missing translations finish."""
    def __init__(self, translate, clock=time.time):
        self.translate, self.clock = translate, clock
        self._condition = Condition()
        self._cache = {lang: {} for lang in ("en", "ko", "zh")}
        self._pending = set()

    def snapshot(self, items, lang):
        if lang not in self._cache:
            return [dict(item) for item in items], False
        with self._condition:
            cache, now = self._cache[lang], self.clock()
            fields = ("title", "editorial_reason")
            texts = list(dict.fromkeys(item[field] for item in items for field in fields
                                       if isinstance(item.get(field), str) and item[field].strip()))
            missing = [text for text in texts
                       if text not in cache or cache[text][1] <= now]
            if missing and lang not in self._pending:
                self._pending.add(lang)
                try:
                    Thread(target=self._translate, args=(missing, lang), daemon=True).start()
                except Exception:
                    self._pending.discard(lang)
            result = [{**item, **{field: cache.get(item[field], (item[field], 0))[0]
                                 for field in fields if isinstance(item.get(field), str)}}
                      for item in items]
            return result, bool(missing)

    def _translate(self, texts, lang):
        try:
            with ThreadPoolExecutor(max_workers=4) as pool:
                pending = {pool.submit(self.translate, text, lang): text for text in texts}
                for future in as_completed(pending):
                    title = pending[future]
                    try:
                        result = str(future.result() or title)[:2000]
                    except Exception:
                        result = title
                    with self._condition:
                        cache = self._cache[lang]
                        cache[title] = (result, self.clock() + (3600 if result != title else 120))
                        while len(cache) > 64:
                            del cache[next(iter(cache))]
        finally:
            with self._condition:
                self._pending.discard(lang)
                self._condition.notify_all()

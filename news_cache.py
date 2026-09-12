"""Shared public RSS snapshots; slow feeds never block an existing snapshot."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Condition, Thread
import time

import feedparser
import requests


NEWS_FEEDS = {
    "NHK経済": "https://www.nhk.or.jp/rss/news/cat5.xml",
    "NHK株・企業": "https://www.nhk.or.jp/rss/news/cat4.xml",
    "ロイター経済": "https://feeds.reuters.com/reuters/businessNews",
    "ロイター米国株": "https://feeds.reuters.com/reuters/companyNews",
}


def fetch_feed(url):
    # Parse bytes so feedparser cannot make an unbounded network request.
    deadline = time.monotonic() + 6
    with requests.get(url, timeout=(2, 3), stream=True) as response:
        response.raise_for_status()
        content = bytearray()
        if time.monotonic() > deadline:
            raise ValueError("RSS response exceeded its time budget")
        # RSS is small. Check each yielded byte so a trickling body cannot keep
        # a large chunk incomplete forever despite the socket's read timeout.
        for chunk in response.iter_content(1):
            content.extend(chunk)
            if len(content) > 2_000_000 or time.monotonic() > deadline:
                raise ValueError("RSS response exceeded its size/time budget")
    parsed = feedparser.parse(bytes(content))
    titles = [str(entry.get("title", "")).strip()[:1000]
              for entry in parsed.entries[:7] if entry.get("title")]
    if not titles:
        raise ValueError("RSS response contained no usable headlines")
    return tuple(titles)


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
        self._refreshing = False
        self._next_attempt = 0

    def _snapshot(self):
        now, items, times = self.clock(), [], {}
        for label in self.feeds:
            titles, fetched_at = self._values.get(label, ((), 0))
            if titles and 0 <= now - fetched_at <= self.max_stale:
                items.extend({"source": label, "title": title} for title in titles)
                times[label] = fetched_at
        fetched_at = min(times.values()) if times else None
        return {"news": items, "fetched_at": fetched_at,
                "source_fetched_at": times, "refreshing": self._refreshing,
                "stale": any(now - stamp >= self.ttl for stamp in times.values())}

    def snapshot(self, *, wait=True):
        with self._condition:
            if not self._refreshing and self.clock() >= self._next_attempt:
                self._refreshing = True
                try:
                    Thread(target=self._refresh, daemon=True).start()
                except Exception:
                    self._refreshing = False
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
                        titles = tuple(str(t).strip()[:1000] for t in future.result()[:7] if t)
                        if not titles:
                            continue
                    except Exception:
                        continue
                    with self._condition:
                        self._values[pending[future]] = (titles, self.clock())
                        successes += 1
                        self._condition.notify_all()
        finally:
            with self._condition:
                delay = self.ttl if successes == len(self.feeds) else self.retry_after
                self._next_attempt = self.clock() + delay
                self._refreshing = False
                self._condition.notify_all()


news_cache = NewsCache()


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
            titles = list(dict.fromkeys(item["title"] for item in items))
            missing = [title for title in titles
                       if title not in cache or cache[title][1] <= now]
            if missing and lang not in self._pending:
                self._pending.add(lang)
                try:
                    Thread(target=self._translate, args=(missing, lang), daemon=True).start()
                except Exception:
                    self._pending.discard(lang)
            result = [{**item, "title": cache.get(item["title"], (item["title"], 0))[0]}
                      for item in items]
            return result, bool(missing)

    def _translate(self, titles, lang):
        try:
            with ThreadPoolExecutor(max_workers=4) as pool:
                pending = {pool.submit(self.translate, title, lang): title for title in titles}
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

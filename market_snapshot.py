"""Serve the last real market prices immediately; refresh outside web requests."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import threading
import time


JST = timezone(timedelta(hours=9))
CORE_MARKETS = {
    "日経225": "^N225", "ドル円": "JPY=X", "米10年金利": "^TNX",
    "S&P500": "^GSPC", "NYダウ": "^DJI", "VIX恐怖指数": "^VIX",
}
TTL = 60
RETAIN = 7 * 86400


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validated_market(data, now):
    """Reject missing/future timestamps and invalid prices, preserving quote ages."""
    if not isinstance(data, dict) or not isinstance(data.get("market"), dict):
        return {}
    result = {}
    for label, source in data["market"].items():
        if label not in CORE_MARKETS or not isinstance(source, dict):
            continue
        stamp = source.get("fetched_at", data.get("fetched_at"))
        if not _number(stamp) or not 0 <= now - stamp < RETAIN:
            continue
        price = source.get("price", source.get("value"))
        if not _number(price) or price <= 0:
            continue
        if any(source.get(key) is not None and not _number(source[key])
               for key in ("pct", "change_value")):
            continue
        if not isinstance(source.get("display"), str) or source["display"] in ("", "--"):
            continue
        clean = {key: deepcopy(source[key]) for key in (
            "price", "value", "pct", "change_value", "currency", "change_unit", "change", "display"
        ) if key in source}
        clean.update(price=price, value=price, fetched_at=stamp)
        result[label] = clean
    return result


class MarketSnapshot:
    def __init__(self, loader, *, seed_path=None, cache_path=None, now=time.time, ttl=TTL, retry=30):
        self.loader = loader
        self.now = now
        self.ttl = ttl
        self.retry = retry
        self.cache_path = Path(cache_path) if cache_path else None
        self._lock = threading.Lock()
        self._market = {}
        self._running = False
        self._last_attempt = None
        self._thread = None
        # Both are local files. Reading a homepage never contacts a price provider.
        for path in (seed_path, cache_path):
            if not path:
                continue
            try:
                incoming = validated_market(json.loads(Path(path).read_text(encoding="utf-8")), self.now())
                self._merge(incoming)
            except (OSError, ValueError, TypeError):
                pass

    def _merge(self, incoming):
        for label, quote in incoming.items():
            if label not in self._market or quote["fetched_at"] >= self._market[label]["fetched_at"]:
                self._market[label] = quote

    def _refresh(self):
        try:
            data = self.loader()
            incoming = validated_market(data, self.now())
            with self._lock:
                self._merge(incoming)
                saved = deepcopy(self._market)
            if incoming and self.cache_path:
                try:
                    self.cache_path.parent.mkdir(parents=True, exist_ok=True)
                    temporary = self.cache_path.with_name(self.cache_path.name + "." + str(os.getpid()) + ".tmp")
                    temporary.write_text(json.dumps({"market": saved}, ensure_ascii=False, allow_nan=False), encoding="utf-8")
                    temporary.replace(self.cache_path)
                except (OSError, ValueError):
                    pass  # Memory cache still works on read-only or ephemeral hosts.
        except Exception:
            pass  # Provider failures keep the last valid values and their timestamps.
        finally:
            with self._lock:
                self._running = False

    def payload(self, *, refresh=True):
        now = self.now()
        with self._lock:
            market = validated_market({"market": self._market}, now)
            self._market = market
            stale = len(market) < len(CORE_MARKETS) or any(now - q["fetched_at"] >= self.ttl for q in market.values())
            if (refresh and stale and not self._running
                    and (self._last_attempt is None or now - self._last_attempt >= self.retry)):
                self._running = True
                self._last_attempt = now
                self._thread = threading.Thread(target=self._refresh, name="market-refresh", daemon=True)
                self._thread.start()
            stamps = [q["fetched_at"] for q in market.values()]
            stamp = max(stamps) if stamps else None
            today = datetime.fromtimestamp(now, JST)
            return {"date": f"{today:%Y/%m/%d}({'月火水木金土日'[today.weekday()]})",
                    "market": deepcopy(market), "fetched_at": stamp,
                    "updated": datetime.fromtimestamp(stamp, JST).strftime("%H:%M") if stamp else "--",
                    "refreshing": self._running, "stale": stale}

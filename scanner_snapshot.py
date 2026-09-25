"""Keep real, dated company quotes available while providers refresh in the background."""
from copy import deepcopy
from datetime import date, datetime, timezone
import json
import math
import os
from pathlib import Path
import re
import threading
import time


RETAIN = 7 * 86400


def valid_quotes(rows, now):
    if not isinstance(rows, list):
        return {}
    valid = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        symbol = row.get("symbol", "")
        if not isinstance(symbol, str) or not re.fullmatch(r"[A-Z0-9][A-Z0-9.\-]{0,15}", symbol):
            continue
        values = [row.get(key) for key in ("price", "prev", "fetched_at")]
        if any(not isinstance(n, (int, float)) or isinstance(n, bool) or not math.isfinite(n) for n in values):
            continue
        price, previous, stamp = values
        if price <= 0 or previous <= 0 or not 0 <= now - stamp < RETAIN:
            continue
        try:
            day = date.fromisoformat(row["trade_date"])
            # The date labels the source bar, never the time this response was generated.
            fetched_day = datetime.fromtimestamp(stamp, timezone.utc).date()
            if not -1 <= (fetched_day - day).days <= 7:
                continue
        except (KeyError, ValueError, TypeError, OverflowError):
            continue
        quote = dict(symbol=symbol, name=str(row.get("name") or symbol),
                     price=price, prev=previous, change_value=round(price - previous, 4),
                     pct=round((price - previous) / previous * 100, 2),
                     currency="JPY" if symbol.endswith(".T") else "USD",
                     trade_date=day.isoformat(), fetched_at=stamp)
        volume = row.get("volume")
        if isinstance(volume, (int, float)) and not isinstance(volume, bool) and math.isfinite(volume) and volume >= 0:
            quote["volume"] = volume
        if symbol not in valid or stamp >= valid[symbol]["fetched_at"]:
            valid[symbol] = quote
    return valid


class ScannerSnapshot:
    def __init__(self, loader, *, seed_path=None, cache_path=None, now=time.time, ttl=600, retry=60):
        self.loader, self.now, self.ttl, self.retry = loader, now, ttl, retry
        self.cache_path = Path(cache_path) if cache_path else None
        self._lock = threading.Lock()
        self._quotes = {}
        self._running = False
        self._last_attempt = None
        self._thread = None
        for path in (seed_path, cache_path):
            if path:
                try:
                    self._merge(valid_quotes(json.loads(Path(path).read_text(encoding="utf-8"))["items"], self.now()))
                except (OSError, ValueError, KeyError, TypeError):
                    pass

    def _merge(self, incoming):
        for symbol, row in incoming.items():
            old = self._quotes.get(symbol)
            if old is None or row["fetched_at"] >= old["fetched_at"]:
                self._quotes[symbol] = row

    def _refresh(self):
        try:
            incoming = valid_quotes(self.loader(), self.now())
            with self._lock:
                self._merge(incoming)
                saved = deepcopy(list(self._quotes.values()))
            if incoming and self.cache_path:
                try:
                    self.cache_path.parent.mkdir(parents=True, exist_ok=True)
                    temporary = self.cache_path.with_name(self.cache_path.name + "." + str(os.getpid()) + ".tmp")
                    temporary.write_text(json.dumps({"items": saved}, ensure_ascii=False, allow_nan=False), encoding="utf-8")
                    temporary.replace(self.cache_path)
                except (OSError, ValueError):
                    pass
        except Exception:
            pass  # A failed provider must not erase the previous successful snapshot.
        finally:
            with self._lock:
                self._running = False

    def payload(self, *, refresh=True):
        now = self.now()
        with self._lock:
            self._quotes = valid_quotes(list(self._quotes.values()), now)
            rows = list(self._quotes.values())
            stale = not rows or any(now - row["fetched_at"] >= self.ttl for row in rows)
            if refresh and stale and not self._running and (
                    self._last_attempt is None or now - self._last_attempt >= self.retry):
                self._running = True
                self._last_attempt = now
                self._thread = threading.Thread(target=self._refresh, name="scanner-refresh", daemon=True)
                self._thread.start()
            stamp = max((row["fetched_at"] for row in rows), default=None)
            return {"items": deepcopy(rows), "updated_at": stamp,
                    "cache_age_sec": int(now - stamp) if stamp is not None else None,
                    "stale": stale, "refreshing": self._running}

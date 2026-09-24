"""Dated dividend snapshots: web requests never wait for a market-data scan."""
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from collections import deque
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import fcntl
import json
import math
import os
from pathlib import Path
import re
import threading
import time

import requests

JST = timezone(timedelta(hours=9))
TTL = 6 * 3600
RETAIN = 30 * 86400
SEED_PATH = Path(__file__).with_name('static') / 'dividend-snapshot.json'


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def parse_chart(data, ticker, name, now):
    """Use recorded dividends and a dated price, never missing-value zeroes.

    Yahoo may already adjust historical dividends for splits. Do not apply a
    second split adjustment. A split inside the calculation window requires
    further verification, so its calculated yield is deliberately withheld.
    """
    chart = data.get('chart') or {}
    results = chart.get('result')
    if chart.get('error') or not isinstance(results, list) or not results:
        return None
    result = results[0]
    meta = result.get('meta') or {}
    if meta.get('symbol') != ticker or meta.get('currency') != 'JPY':
        return None
    price, price_at = meta.get('regularMarketPrice'), meta.get('regularMarketTime')
    if not number(price) or price <= 0 or not number(price_at) or not 0 <= now - price_at < RETAIN:
        price = price_at = None
    events = result.get('events') or {}
    dividends = events.get('dividends') or {}
    splits = events.get('splits') or {}
    if not isinstance(dividends, dict) or not isinstance(splits, dict):
        return None
    # A successful chart needs actual dated quote/history evidence; an empty
    # response is not evidence that a company pays zero dividend.
    if price is None and not dividends:
        return None
    today = datetime.fromtimestamp(now, JST).date()
    try:
        cutoff = today.replace(year=today.year - 1)
    except ValueError:
        cutoff = today.replace(year=today.year - 1, day=28)
    history, annual, recorded_dates = {}, 0.0, []
    for event in dividends.values():
        if not isinstance(event, dict) or not number(event.get('date')) or not number(event.get('amount')):
            return None
        stamp, amount = event['date'], event['amount']
        if stamp <= 0 or amount < 0:
            return None
        day = datetime.fromtimestamp(stamp, JST).date()
        recorded_dates.append(day.isoformat())
        if stamp > now:
            continue  # An announced future payment is not a past payment.
        history[day.year] = history.get(day.year, 0) + amount
        if cutoff < day <= today:
            annual += amount
    split_in_period = any(isinstance(event, dict) and number(event.get('date'))
                          and cutoff < datetime.fromtimestamp(event['date'], JST).date() <= today
                          for event in splits.values())
    annual = None if split_in_period else round(annual, 4)
    yield_pct = round(annual / price * 100, 2) if price is not None and annual is not None else None
    return dict(ticker=ticker, code=ticker[:-2], name=name, currency='JPY',
                price=price, price_updated_at=price_at, annual_dividend=annual,
                annual_dividend_basis='trailing_12m', yield_pct=yield_pct,
                payout_ratio=None, ex_dividend_date=max(recorded_dates, default=None),
                ex_dividend_dates=sorted(set(recorded_dates)),
                history=[{'year': year, 'total': round(history[year], 4)} for year in sorted(history)[-5:]],
                fetched_at=now, source='Yahoo Finance',
                calculation_status='split_review' if split_in_period else 'calculated')


def fetch_dividend_info(ticker, name, *, now=time.time, get=requests.get):
    """One small, bounded chart request; no slow quoteSummary/crumb waterfall."""
    if not re.fullmatch(r'[0-9][A-Z0-9]{3}\.T', ticker):
        return None
    url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + ticker
    started = time.monotonic()
    with get(url, params={'range': '5y', 'interval': '1mo', 'events': 'div,splits'},
             headers={'User-Agent': 'Mozilla/5.0'}, timeout=(2, 4), stream=True,
             allow_redirects=False) as response:
        response.raise_for_status()
        chunks, size = [], 0
        for chunk in response.iter_content(4096):
            size += len(chunk)
            if size > 500_000 or time.monotonic() - started > 8:
                raise ValueError('dividend response exceeds limit')
            chunks.append(chunk)
        data = json.loads(b''.join(chunks))
    result = parse_chart(data, ticker, name, now())
    if result:
        result['source_url'] = url
    return result


def validated(rows, now):
    clean = {}
    if not isinstance(rows, list):
        return clean
    for source in rows[:5000]:
        if not isinstance(source, dict):
            continue
        ticker, stamp = source.get('ticker'), source.get('fetched_at')
        if not isinstance(ticker, str) or not re.fullmatch(r'[0-9][A-Z0-9]{3}\.T', ticker):
            continue
        if not number(stamp) or not 0 <= now - stamp < RETAIN:
            continue
        if not isinstance(source.get('name'), str) or not source['name'] or source.get('currency') != 'JPY':
            continue
        if source.get('annual_dividend_basis') != 'trailing_12m':
            continue
        row = deepcopy(source)
        if any(row.get(key) is not None and (not number(row[key]) or row[key] < 0)
               for key in ('price', 'annual_dividend', 'yield_pct')):
            continue
        if row.get('price') is not None:
            price_at = row.get('price_updated_at')
            if row['price'] <= 0 or not number(price_at) or not 0 <= stamp - price_at < RETAIN:
                continue
        annual, price = row.get('annual_dividend'), row.get('price')
        # Recompute from validated operands, never trust a saved derived value.
        row['yield_pct'] = round(annual / price * 100, 2) if annual is not None and price is not None else None
        if row.get('calculation_status') == 'split_review':
            row['annual_dividend'] = row['yield_pct'] = None
        try:
            dates = row.get('ex_dividend_dates', [])
            if not isinstance(dates, list) or len(dates) > 100:
                continue
            dates = sorted(set(date.fromisoformat(value).isoformat() for value in dates))
            row['ex_dividend_dates'] = dates
            row['ex_dividend_date'] = max(dates, default=None)
            history = row.get('history', [])
            if not isinstance(history, list) or len(history) > 5 or any(
                    not isinstance(entry, dict) or not isinstance(entry.get('year'), int)
                    or not 1900 <= entry['year'] <= datetime.fromtimestamp(stamp, JST).year
                    or not number(entry.get('total')) or entry['total'] < 0 for entry in history):
                continue
        except (ValueError, TypeError, OverflowError):
            continue
        row['code'] = ticker[:-2]
        if ticker not in clean or stamp >= clean[ticker]['fetched_at']:
            clean[ticker] = row
    return clean


class DividendSnapshot:
    def __init__(self, companies, loader=fetch_dividend_info, *, seed_path=SEED_PATH,
                 cache_path=None, now=time.time, ttl=TTL, retry=300, startup_delay=1):
        self.companies = dict(companies)
        self.loader, self.now = loader, now
        self.cache_path = Path(cache_path) if cache_path else None
        self.ttl, self.retry, self.startup_delay = ttl, retry, startup_delay
        self._rows = {}
        self._file_mtime = None
        self._reset_process()
        if seed_path:
            self._load(Path(seed_path))
        self._read_disk()
        if hasattr(os, 'register_at_fork'):
            os.register_at_fork(after_in_child=self._reset_process)

    def _reset_process(self):
        self._pid = os.getpid()
        self._lock = threading.Lock()
        self._running = False
        self._last_attempt = None
        self._failed = False
        self._thread = None
        self._pending = {}  # Extra individually requested companies share the same pool.
        self._symbol_attempts = {}

    def _check_pid(self):
        if self._pid != os.getpid():
            self._reset_process()

    def _merge(self, incoming):
        for ticker, row in incoming.items():
            old = self._rows.get(ticker)
            if old is None or row['fetched_at'] >= old['fetched_at']:
                # A partial provider response cannot replace a known price with
                # an unknown value and make it appear freshly fetched.
                if old and old.get('price') is not None and row.get('price') is None:
                    continue
                self._rows[ticker] = row

    def _load(self, path):
        try:
            if path.stat().st_size > 2_000_000:
                return
            data = json.loads(path.read_text(encoding='utf-8'))
            self._merge(validated(data.get('items'), self.now()))
        except (OSError, ValueError, TypeError, AttributeError):
            pass

    def _read_disk(self):
        if not self.cache_path:
            return
        try:
            mtime = self.cache_path.stat().st_mtime_ns
            if mtime != self._file_mtime:
                self._load(self.cache_path)
                self._file_mtime = mtime
        except OSError:
            pass

    def _save(self):
        if not self.cache_path:
            return
        with self._lock:
            data = {'items': deepcopy(list(self._rows.values()))}
        try:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            temp = self.cache_path.with_name(self.cache_path.name + '.' + str(os.getpid()) + '.tmp')
            temp.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False), encoding='utf-8')
            temp.replace(self.cache_path)
        except (OSError, ValueError):
            pass

    def _stale(self, now):
        return any(ticker + '.T' not in self._rows or
                   now - self._rows[ticker + '.T']['fetched_at'] >= self.ttl for ticker in self.companies)

    def ensure_refresh(self):
        self._check_pid()
        with self._lock:
            self._read_disk()
            now = self.now()
            if self._running or not (self._stale(now) or self._pending):
                return
            new_request = any(code + '.T' not in self._symbol_attempts or
                              now - self._symbol_attempts[code + '.T'] >= self.retry for code in self._pending)
            if self._last_attempt is not None and now - self._last_attempt < self.retry and not new_request:
                return
            self._running = True
            self._last_attempt = now
            self._thread = threading.Thread(target=self._refresh, name='dividend-refresh', daemon=True)
            try:
                self._thread.start()
            except Exception:
                self._running = False
                self._failed = True

    def _refresh(self):
        shared_lock = None
        successes, failures = 0, 0
        try:
            if self.startup_delay:
                time.sleep(self.startup_delay)
            # Across Gunicorn workers, only one provider scan may run. Other
            # processes consume its atomic disk checkpoints on their next read.
            if self.cache_path:
                self.cache_path.parent.mkdir(parents=True, exist_ok=True)
                shared_lock = open(str(self.cache_path) + '.lock', 'a')
                try:
                    fcntl.flock(shared_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    return
            with self._lock:
                self._read_disk()
                requested = dict(self._pending)
                self._pending.clear()
                requested.update(self.companies)
                jobs = [(code + '.T', name) for code, name in requested.items()
                        if (code + '.T' not in self._rows or
                            self.now() - self._rows[code + '.T']['fetched_at'] >= self.ttl)
                        and (code + '.T' not in self._symbol_attempts or
                             self.now() - self._symbol_attempts[code + '.T'] >= self.retry)]
            # Only two jobs are submitted at a time, so a newly searched
            # company can go next instead of waiting behind the whole universe.
            queue = deque(jobs)
            queued = {ticker for ticker, _ in jobs}
            with ThreadPoolExecutor(max_workers=2, thread_name_prefix='dividend-fetch') as pool:
                futures = {}
                while queue or futures:
                    with self._lock:
                        for code, name in self._pending.items():
                            ticker = code + '.T'
                            if ticker not in self._symbol_attempts or self.now() - self._symbol_attempts[ticker] >= self.retry:
                                if ticker in queued:
                                    queue = deque(job for job in queue if job[0] != ticker)
                                else:
                                    queued.add(ticker)
                                queue.appendleft((ticker, name))
                        self._pending.clear()
                    while queue and len(futures) < 2:
                        ticker, name = queue.popleft()
                        with self._lock:
                            self._symbol_attempts[ticker] = self.now()
                        futures[pool.submit(self.loader, ticker, name)] = ticker
                    if not futures:
                        break
                    done, _ = wait(futures, return_when=FIRST_COMPLETED)
                    for future in done:
                        futures.pop(future)
                        try:
                            incoming = validated([future.result()], self.now())
                        except Exception:
                            incoming = {}
                        if incoming:
                            with self._lock:
                                self._merge(incoming)
                            successes += 1
                            self._save()  # First valid result is visible immediately.
                        else:
                            failures += 1

        except Exception:
            failures += 1
        finally:
            if shared_lock:
                shared_lock.close()
            with self._lock:
                self._failed = failures > 0
                self._running = False
                self._last_attempt = self.now()

    def payload(self, *, refresh=True):
        self._check_pid()
        if refresh:
            self.ensure_refresh()
        with self._lock:
            self._read_disk()
            now = self.now()
            self._rows = validated(list(self._rows.values()), now)
            rows = deepcopy(list(self._rows.values()))
            stale = self._stale(now)
            stamp = max((row['fetched_at'] for row in rows), default=None)
            return dict(items=rows, updated_at=stamp, refreshing=self._running,
                        status=('stale' if stale or self._failed else 'ready') if rows else
                        ('loading' if self._running else 'unavailable'),
                        stale=stale, cached=bool(rows), partial=stale,
                        coverage_count=sum(code + '.T' in self._rows for code in self.companies),
                        universe_count=len(self.companies), annual_dividend_basis='trailing_12m')

    def lookup(self, ticker, name):
        self._check_pid()
        with self._lock:
            row = self._rows.get(ticker)
            if row is None or self.now() - row['fetched_at'] >= self.ttl:
                self._pending[ticker[:-2]] = name
        payload = self.payload()
        row = next((row for row in payload.pop('items') if row['ticker'] == ticker), None)
        if row:
            return dict(row, updated_at=row['fetched_at'], refreshing=payload['refreshing'],
                        stale=self.now() - row['fetched_at'] >= self.ttl,
                        status='stale' if self.now() - row['fetched_at'] >= self.ttl else 'ready')
        payload['status'] = 'loading' if payload['refreshing'] else 'unavailable'
        payload['updated_at'] = None
        return dict(payload, ticker=ticker, code=ticker[:-2], name=name)

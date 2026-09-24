"""Source-labelled company facts, fetched off-request and never invented.

The caller must authorize a symbol against the JPX catalogue. This module also
validates Japanese stock-symbol syntax. Forward dividend rate is an annualized
estimate, not a fiscal-year forecast or the dividend actually paid last year.
"""
from collections import OrderedDict, deque
from copy import deepcopy
from datetime import datetime, timedelta, timezone
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
PROFILE_URL = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary/'
MODULES = 'price,summaryDetail,financialData,calendarEvents,assetProfile'
FIELDS = ('market_cap', 'forward_annual_dividend_per_share', 'analyst_target',
          'ex_dividend_date', 'dividend_payment_date', 'price')


def safe_symbol(symbol):
    return isinstance(symbol, str) and bool(re.fullmatch(r'[0-9][0-9A-Z]{3}\.T', symbol))


def _raw(value):
    return value.get('raw') if isinstance(value, dict) else value


def _number(value, *, zero=False):
    value = _raw(value)
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) \
        and math.isfinite(value) and (value >= 0 if zero else value > 0) else None


def _day(value):
    stamp = _number(value)
    if stamp is None:
        return None
    try:
        day = datetime.fromtimestamp(stamp, JST).date()
        return day.isoformat() if 1970 <= day.year <= 2100 else None
    except (ValueError, OverflowError, OSError):
        return None


def parse_profile(payload, symbol, name, fetched_at):
    """Normalize quoteSummary, retaining unknown dates and missing values."""
    if not safe_symbol(symbol) or not isinstance(payload, dict):
        return None
    body = payload.get('quoteSummary') or {}
    results = body.get('result')
    if body.get('error') or not isinstance(results, list) or len(results) != 1 or not isinstance(results[0], dict):
        return None
    result = results[0]
    price = result.get('price') or {}
    detail = result.get('summaryDetail') or {}
    financial = result.get('financialData') or {}
    calendar = result.get('calendarEvents') or {}
    asset = result.get('assetProfile') or {}
    if not all(isinstance(value, dict) for value in (price, detail, financial, calendar, asset)):
        return None
    if price.get('symbol') not in (None, symbol) or price.get('currency') != 'JPY':
        return None
    mean, low, high = (_number(financial.get(key)) for key in ('targetMeanPrice', 'targetLowPrice', 'targetHighPrice'))
    count = _number(financial.get('numberOfAnalystOpinions'))
    count = int(count) if count is not None and count == int(count) and count <= 10000 else None
    targets = None
    # financialCurrency is the accounts' currency, not necessarily the target
    # share-price currency. Targets use the listing's explicit price currency.
    if any(value is not None for value in (mean, low, high)):
        consistent = not ((low is not None and high is not None and low > high)
                         or (mean is not None and low is not None and mean < low)
                         or (mean is not None and high is not None and mean > high))
        if consistent:
            targets = dict(mean=mean, low=low, high=high, analyst_count=count, currency='JPY', as_of=None)
    observed_quote_at = _number(price.get('regularMarketTime'))
    if observed_quote_at is not None and not 0 <= fetched_at - observed_quote_at < RETAIN:
        observed_quote_at = None
    data = dict(currency='JPY', market_cap=_number(price.get('marketCap')),
                forward_annual_dividend_per_share=_number(detail.get('dividendRate'), zero=True),
                forward_dividend_basis='annualized', analyst_target=targets,
                ex_dividend_date=_day(calendar.get('exDividendDate')) or _day(detail.get('exDividendDate')),
                dividend_payment_date=_day(calendar.get('dividendDate')),
                price=_number(price.get('regularMarketPrice')), price_updated_at=observed_quote_at)
    if not any(data[key] is not None for key in FIELDS):
        return None
    # The quote's time does NOT establish the analyst forecast's date, the
    # company's forecast date, or the observation time for its market cap.
    metadata = {key: dict(fetched_at=fetched_at, as_of=observed_quote_at if key == 'price' else None)
                for key in FIELDS if data[key] is not None}
    source = dict(name='Yahoo Finance', url='https://finance.yahoo.com/quote/' + symbol + '/',
                  api_url=PROFILE_URL + symbol, fetched_at=fetched_at, fields=metadata)
    summary = asset.get('longBusinessSummary')
    summary = summary[:20000] if isinstance(summary, str) else None
    return dict(symbol=symbol, name=name, data=data, source=source,
                updated_at=fetched_at, _business_summary=summary)


class YahooProfileProvider:
    """Public Yahoo session handshake, isolated per worker; tokens stay private."""
    def __init__(self, *, session_factory=requests.Session, now=time.time,
                 monotonic=time.monotonic, deadline=20):
        self.session_factory, self.now, self.monotonic = session_factory, now, monotonic
        self.deadline = deadline
        self._local = threading.local()

    def _state(self):
        state = getattr(self._local, 'state', None)
        if state is None or state['pid'] != os.getpid():
            session = self.session_factory()
            session.headers.update({'User-Agent': 'Mozilla/5.0'})
            state = self._local.state = dict(session=session, crumb=None, pid=os.getpid())
        return state

    def _read(self, state, url, deadline, *, params=None, max_bytes=250000):
        remaining = deadline - self.monotonic()
        if remaining <= 0:
            raise TimeoutError('profile deadline')
        connect = min(2, max(.05, remaining / 3))
        read = min(4, max(.05, remaining - connect))
        with state['session'].get(url, params=params, timeout=(connect, read),
                                  allow_redirects=False, stream=True) as response:
            # read1 performs at most one upstream read, so slow trickling data
            # cannot hide the deadline inside iter_content's large buffer.
            chunks, size = [], 0
            while True:
                if self.monotonic() >= deadline:
                    raise TimeoutError('profile deadline')
                chunk = response.raw.read1(4096, decode_content=True)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_bytes:
                    raise ValueError('profile response limit')
                chunks.append(chunk)
            return response.status_code, b''.join(chunks)

    def __call__(self, symbol, name):
        if not safe_symbol(symbol):
            return None
        state = self._state()
        deadline = self.monotonic() + self.deadline
        params = dict(modules=MODULES, formatted='false')
        if state['crumb']:
            params['crumb'] = state['crumb']
        status, body = self._read(state, PROFILE_URL + symbol, deadline, params=params)
        if status in (401, 403):
            # The public cookie endpoint intentionally returns 404 with a
            # cookie. No account login, stored credentials or consent bypass.
            state['crumb'] = None
            self._read(state, 'https://fc.yahoo.com', deadline, max_bytes=50000)
            code, raw_crumb = self._read(state, 'https://query1.finance.yahoo.com/v1/test/getcrumb',
                                         deadline, max_bytes=200)
            crumb = raw_crumb.decode('utf-8').strip()
            if code != 200 or not crumb or len(crumb) > 100 or any(c.isspace() or c in '<>{}' for c in crumb):
                return None
            state['crumb'] = crumb
            status, body = self._read(state, PROFILE_URL + symbol, deadline,
                                      params=dict(params, crumb=crumb))
        if status != 200 or self.monotonic() >= deadline:
            return None
        return parse_profile(json.loads(body), symbol, name, self.now())


def _valid_record(record, now):
    if not isinstance(record, dict) or not safe_symbol(record.get('symbol')):
        return None
    stamp = _number(record.get('updated_at'))
    data, source = record.get('data'), record.get('source')
    if stamp is None or not 0 <= now - stamp < RETAIN or not isinstance(data, dict) or not isinstance(source, dict):
        return None
    if data.get('currency') != 'JPY' or data.get('forward_dividend_basis') != 'annualized':
        return None
    fields = source.get('fields')
    if not isinstance(fields, dict) or source.get('name') != 'Yahoo Finance':
        return None
    value = deepcopy(record)
    price_at = value['data'].get('price_updated_at')
    if price_at is not None and (_number(price_at) is None or not 0 <= stamp - price_at < RETAIN):
        return None
    for key in FIELDS:
        field = value['data'].get(key)
        if field is None:
            continue
        meta = fields.get(key)
        observed = _number(meta.get('fetched_at')) if isinstance(meta, dict) else None
        if observed is None or not 0 <= now - observed < RETAIN:
            value['data'][key] = None
            value['source']['fields'].pop(key, None)
            continue
        if key in ('market_cap', 'price', 'forward_annual_dividend_per_share'):
            if _number(field, zero=key == 'forward_annual_dividend_per_share') is None:
                return None
        elif key in ('ex_dividend_date', 'dividend_payment_date'):
            try:
                if datetime.strptime(field, '%Y-%m-%d').strftime('%Y-%m-%d') != field:
                    return None
            except (TypeError, ValueError):
                return None
        elif key == 'analyst_target':
            if not isinstance(field, dict) or field.get('currency') != 'JPY' or field.get('as_of') is not None:
                return None
            if not any(_number(field.get(part)) is not None for part in ('mean', 'low', 'high')):
                return None
            if any(field.get(part) is not None and _number(field[part]) is None for part in ('mean', 'low', 'high')):
                return None
    if not any(value['data'].get(key) is not None for key in FIELDS):
        return None
    return value


class CompanyProfiles:
    """Immediate get(); a bounded two-worker queue performs refreshes.

    All returned facts retain their own retrieval timestamp. On partial/failing
    responses the previous known facts survive with their original timestamps.
    """
    def __init__(self, loader=None, *, cache_path=None, seed_path=None, now=time.time,
                 ttl=TTL, retry=180, max_pending=64):
        self.loader = loader or YahooProfileProvider(now=now)
        self.now, self.ttl, self.retry = now, ttl, retry
        self.max_pending = max_pending
        self.cache_path = Path(cache_path) if cache_path else None
        self._records = OrderedDict()
        self._file_mtime = None
        self._reset_process()
        for path in (seed_path, cache_path):
            if path:
                self._load(Path(path))
        if hasattr(os, 'register_at_fork'):
            os.register_at_fork(after_in_child=self._reset_process)

    def _reset_process(self):
        self._pid = os.getpid()
        self._condition = threading.Condition()
        self._persist_lock = threading.Lock()
        self._queue = deque()
        self._pending = set()
        self._attempts = {}
        self._errors = set()
        self._threads = []

    def _check_pid(self):
        if self._pid != os.getpid():
            self._reset_process()

    def _load(self, path):
        try:
            if path.stat().st_size > 4_000_000:
                return
            data = json.loads(path.read_text(encoding='utf-8'))
            rows = data.get('items')
            if not isinstance(rows, list):
                return
            for row in rows[:512]:
                valid = _valid_record(row, self.now())
                if valid:
                    self._merge(valid)
        except (OSError, ValueError, TypeError, AttributeError):
            pass

    def _merge(self, incoming):
        symbol = incoming['symbol']
        old = self._records.get(symbol)
        if old:
            # Merge known fields independently, preserving every old fact's
            # timestamp when the latest provider response omits that field.
            merged = deepcopy(incoming)
            for key in FIELDS:
                previous = old['source']['fields'].get(key, {})
                latest = incoming['source']['fields'].get(key, {})
                if old['data'].get(key) is not None and (incoming['data'].get(key) is None or
                        previous.get('fetched_at', 0) > latest.get('fetched_at', 0)):
                    merged['data'][key] = deepcopy(old['data'][key])
                    merged['source']['fields'][key] = deepcopy(previous)
                    if key == 'price':
                        merged['data']['price_updated_at'] = old['data'].get('price_updated_at')
            if not incoming.get('_business_summary'):
                merged['_business_summary'] = old.get('_business_summary')
            merged['updated_at'] = max(old['updated_at'], incoming['updated_at'])
            merged['source']['fetched_at'] = merged['updated_at']
            self._records[symbol] = merged
        else:
            self._records[symbol] = deepcopy(incoming)
        self._records.move_to_end(symbol)
        while len(self._records) > 512:
            self._records.popitem(last=False)

    def _read_disk(self):
        if not self.cache_path:
            return
        try:
            stamp = self.cache_path.stat().st_mtime_ns
            if stamp != self._file_mtime:
                self._load(self.cache_path)
                self._file_mtime = stamp
        except OSError:
            pass

    def _save(self):
        if not self.cache_path:
            return
        # Serialize threads AND processes. Merge the current disk snapshot while
        # holding the file lock so workers cannot erase one another's new rows.
        with self._persist_lock:
            try:
                self.cache_path.parent.mkdir(parents=True, exist_ok=True)
                with open(str(self.cache_path) + '.lock', 'a') as shared_lock:
                    fcntl.flock(shared_lock, fcntl.LOCK_EX)
                    with self._condition:
                        self._read_disk()
                        rows = deepcopy(list(self._records.values()))
                    temp = self.cache_path.with_name(self.cache_path.name + '.' + str(os.getpid()) + '.tmp')
                    temp.write_text(json.dumps({'items': rows}, ensure_ascii=False, allow_nan=False), encoding='utf-8')
                    temp.replace(self.cache_path)
            except (OSError, ValueError):
                pass

    def _worker(self):
        while True:
            with self._condition:
                while not self._queue:
                    self._condition.wait()
                symbol, name = self._queue.popleft()
            try:
                row = _valid_record(self.loader(symbol, name), self.now())
            except Exception:
                row = None  # Do not put upstream messages, URLs with tokens or secrets into an API response.
            with self._condition:
                if row and row['symbol'] == symbol:
                    self._merge(row)
                    self._errors.discard(symbol)
                else:
                    self._errors.add(symbol)
                self._attempts[symbol] = self.now()
                self._pending.discard(symbol)
            if row:
                self._save()

    def _stale(self, row, now):
        return any(now - meta['fetched_at'] >= self.ttl for meta in row['source']['fields'].values())

    def get(self, symbol, name):
        if not safe_symbol(symbol):
            return dict(symbol=symbol if isinstance(symbol, str) else None, status='unavailable',
                        refreshing=False, updated_at=None, data=None, source=None)
        self._check_pid()
        with self._condition:
            self._read_disk()
            now = self.now()
            row = _valid_record(self._records.get(symbol), now)
            if row:
                self._records[symbol] = row
            stale = not row or self._stale(row, now)
            if stale and symbol not in self._pending and len(self._pending) < self.max_pending and (
                    symbol not in self._attempts or now - self._attempts[symbol] >= self.retry):
                self._pending.add(symbol)
                self._queue.append((symbol, str(name or symbol)[:200]))
                while len(self._threads) < 2:
                    thread = threading.Thread(target=self._worker, name='company-profile', daemon=True)
                    self._threads.append(thread)
                    thread.start()
                self._condition.notify_all()
            refreshing = symbol in self._pending
            status = ('stale' if stale or symbol in self._errors else 'ready') if row else (
                'pending' if refreshing else 'unavailable')
            if row:
                public = {key: deepcopy(row[key]) for key in ('symbol', 'name', 'updated_at', 'data', 'source')}
                return dict(public, status=status, refreshing=refreshing)
            return dict(symbol=symbol, name=str(name or symbol)[:200], status=status,
                        refreshing=refreshing, updated_at=None, data=None, source=None)

    def get_business_summary_for_review(self, symbol):
        """Internal editorial input only; never returned by the public get()."""
        self._check_pid()
        with self._condition:
            row = self._records.get(symbol)
            return row.get('_business_summary') if row else None

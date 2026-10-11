"""Small on-demand Japanese quotes, separate from six-hour financial profiles.

Yahoo's Tokyo data is delayed by 20 minutes. A successful retrieval is not proof
that a trade just occurred: the provider's quote time is kept independently from
the retrieval time. Nothing here infers market opening, holidays or a new trade.
"""
from collections import OrderedDict, deque
from copy import deepcopy
from email.utils import parsedate_to_datetime
import fcntl
import json
import math
import os
from pathlib import Path
import re
import threading
import time

import requests
from urllib3.exceptions import HTTPError as UpstreamReadError


CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/'
TTL = 60
RETRY = 60
RETAIN = 30 * 86400
DELAY_MINUTES = 20
RECENT_QUOTE_SECONDS = 30 * 60
MAX_RECORDS = 8192
MAX_CACHE_BYTES = 16_000_000
MAX_PENDING = 64
MAX_BACKOFF_SECONDS = 900
MIN_BACKOFF_SECONDS = 30
DEFAULT_BACKOFF_SECONDS = 60
FIELDS = ('price', 'market_cap')


def safe_symbol(symbol):
    return isinstance(symbol, str) and bool(re.fullmatch(r'[0-9][A-Z0-9]{3}\.T', symbol))


def _positive(value):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and value > 0)


def retry_after_delay(value, now):
    """Only a bounded delay escapes; an arbitrary upstream header never does."""
    seconds = DEFAULT_BACKOFF_SECONDS
    if isinstance(value, str) and len(value) <= 128:
        value = value.strip()
        if re.fullmatch(r'[0-9]{1,10}', value):
            seconds = int(value)
        else:
            try:
                parsed = parsedate_to_datetime(value)
                if parsed.tzinfo is not None:
                    seconds = math.ceil(parsed.timestamp() - now)
            except (ValueError, TypeError, OverflowError, OSError):
                pass
    return max(MIN_BACKOFF_SECONDS, min(MAX_BACKOFF_SECONDS, seconds))


class QuoteFailure:
    """Fixed reason and bounded cooldown, without response bodies or secrets."""
    def __init__(self, reason='unconfirmed', *, retry_after_seconds=0):
        self.reason = reason if reason in ('fetch_error', 'invalid', 'rate_limited') else 'unconfirmed'
        self.retry_after_seconds = (max(1, min(MAX_BACKOFF_SECONDS,
                                     int(retry_after_seconds)))
                                    if self.reason == 'rate_limited' else 0)


def parse_quote(payload, symbol, name, fetched_at):
    """Read direct chart metadata only; do not derive capitalization or dates."""
    if not safe_symbol(symbol) or not isinstance(payload, dict) or not _positive(fetched_at):
        return None
    chart = payload.get('chart')
    results = chart.get('result') if isinstance(chart, dict) and not chart.get('error') else None
    if not isinstance(results, list) or len(results) != 1 or not isinstance(results[0], dict):
        return None
    meta = results[0].get('meta')
    if not isinstance(meta, dict) or meta.get('symbol') != symbol or meta.get('currency') != 'JPY':
        return None
    raw_price, raw_time, raw_cap = (meta.get(key) for key in
                                    ('regularMarketPrice', 'regularMarketTime', 'marketCap'))
    price_at = raw_time if _positive(raw_time) and 0 <= fetched_at - raw_time < RETAIN else None
    price = raw_price if _positive(raw_price) and price_at is not None else None
    cap = raw_cap if _positive(raw_cap) else None
    if price is None and cap is None:
        return None
    fields = {}
    if price is not None:
        fields['price'] = dict(fetched_at=fetched_at, as_of=price_at)
    if cap is not None:
        # The stock's trading time is not the observation date of market cap.
        fields['market_cap'] = dict(fetched_at=fetched_at, as_of=None)
    states = dict(price='available' if price is not None else
                  'invalid' if raw_price is not None or raw_time is not None else 'source_missing',
                  market_cap='available' if cap is not None else
                  'invalid' if raw_cap is not None else 'source_missing')
    return dict(symbol=symbol, name=str(name or symbol)[:200], updated_at=fetched_at,
                data=dict(currency='JPY', price=price, price_updated_at=price_at if price is not None else None,
                          market_cap=cap), field_status=states,
                source=dict(name='Yahoo Finance', url='https://finance.yahoo.com/quote/' + symbol + '/',
                            fetched_at=fetched_at, fields=fields, kind='delayed',
                            delay_minutes=DELAY_MINUTES))


class YahooQuoteProvider:
    """One bounded chart read, with cooldown shared by this provider's workers."""
    def __init__(self, *, session_factory=requests.Session, now=time.time,
                 monotonic=time.monotonic, deadline=8):
        self.session_factory, self.now, self.monotonic = session_factory, now, monotonic
        self.deadline = max(.1, min(8, deadline))
        self._reset_process()
        if hasattr(os, 'register_at_fork'):
            os.register_at_fork(after_in_child=self._reset_process)

    def _reset_process(self):
        self._pid = os.getpid()
        self._local = threading.local()
        self._cooldown_lock = threading.Lock()
        self._retry_at = 0

    def _check_pid(self):
        if self._pid != os.getpid():
            self._reset_process()

    @property
    def retry_after_seconds(self):
        self._check_pid()
        with self._cooldown_lock:
            return max(0, math.ceil(self._retry_at - self.now()))

    def __call__(self, symbol, name):
        if not safe_symbol(symbol):
            return QuoteFailure('invalid')
        self._check_pid()
        cooldown = self.retry_after_seconds
        if cooldown:
            return QuoteFailure('rate_limited', retry_after_seconds=cooldown)
        session = getattr(self._local, 'session', None)
        if session is None:
            session = self._local.session = self.session_factory()
            session.headers.update({'User-Agent': 'Mozilla/5.0'})
        deadline = self.monotonic() + self.deadline
        try:
            # No quoteSummary, cookie handshake, account or stored credential.
            with session.get(CHART_URL + symbol, params={'range': '1d', 'interval': '1d'},
                             timeout=(min(2, self.deadline / 3), min(4, self.deadline * 2 / 3)),
                             allow_redirects=False, stream=True) as response:
                if response.status_code == 429:
                    delay = retry_after_delay(response.headers.get('Retry-After'), self.now())
                    with self._cooldown_lock:
                        self._retry_at = max(self._retry_at, self.now() + delay)
                    return QuoteFailure('rate_limited', retry_after_seconds=delay)
                if response.status_code != 200:
                    return QuoteFailure('fetch_error')
                chunks, size = [], 0
                while True:
                    if self.monotonic() >= deadline:
                        return QuoteFailure('fetch_error')
                    chunk = response.raw.read1(4096, decode_content=True)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > 50_000:
                        return QuoteFailure('invalid')
                    chunks.append(chunk)
                result = parse_quote(json.loads(b''.join(chunks)), symbol, name, self.now())
                return result if result is not None else QuoteFailure('invalid')
        except (requests.RequestException, UpstreamReadError, TimeoutError, OSError):
            return QuoteFailure('fetch_error')
        except (ValueError, TypeError, AttributeError):
            return QuoteFailure('invalid')


def _valid_record(record, now):
    if not isinstance(record, dict) or not safe_symbol(record.get('symbol')):
        return None
    fetched_at, data, source = (record.get(key) for key in ('updated_at', 'data', 'source'))
    if (not _positive(fetched_at) or not 0 <= now - fetched_at < RETAIN
            or not isinstance(data, dict) or data.get('currency') != 'JPY'
            or not isinstance(source, dict) or source.get('name') != 'Yahoo Finance'
            or source.get('url') != 'https://finance.yahoo.com/quote/' + record['symbol'] + '/'):
        return None
    metadata = source.get('fields')
    if not isinstance(metadata, dict):
        return None
    # Reconstruct the allowlisted record; persisted extras never reach the API.
    clean_data = dict(currency='JPY', price=None, price_updated_at=None, market_cap=None)
    clean_fields, clean_states = {}, {}
    supplied = record.get('field_status')
    supplied = supplied if isinstance(supplied, dict) else {}
    for field in FIELDS:
        value, observed = data.get(field), metadata.get(field)
        if value is None:
            state = supplied.get(field)
            clean_states[field] = state if state in ('source_missing', 'invalid') else 'unconfirmed'
            continue
        stamp = observed.get('fetched_at') if isinstance(observed, dict) else None
        if not _positive(value) or not _positive(stamp):
            return None
        if not 0 <= now - stamp < RETAIN:
            clean_states[field] = 'unconfirmed'
            continue
        as_of = observed.get('as_of')
        if field == 'price':
            quote_at = data.get('price_updated_at')
            if not _positive(quote_at) or not 0 <= stamp - quote_at < RETAIN or as_of != quote_at:
                return None
            if now - quote_at >= RETAIN:
                clean_states[field] = 'unconfirmed'
                continue
            clean_data['price_updated_at'] = quote_at
        elif as_of is not None:
            return None
        clean_data[field] = value
        clean_fields[field] = dict(fetched_at=stamp, as_of=as_of)
        clean_states[field] = 'available'
    if not clean_fields:
        return None
    return dict(symbol=record['symbol'], name=str(record.get('name') or record['symbol'])[:200],
                updated_at=fetched_at, data=clean_data, field_status=clean_states,
                source=dict(name='Yahoo Finance', url=source['url'], fetched_at=fetched_at,
                            fields=clean_fields, kind='delayed', delay_minutes=DELAY_MINUTES))


class CompanyQuotes:
    """Immediate saved values; only selected symbols enter a bounded queue."""
    def __init__(self, loader=None, *, cache_path=None, now=time.time, ttl=TTL,
                 retry=RETRY, max_pending=MAX_PENDING, max_records=MAX_RECORDS, workers=1):
        self.now, self.ttl, self.retry = now, ttl, retry
        self.loader = loader or YahooQuoteProvider(now=now)
        self.cache_path = Path(cache_path) if cache_path else None
        self.max_pending = max(1, min(MAX_PENDING, int(max_pending)))
        self.max_records = max(1, min(MAX_RECORDS, int(max_records)))
        self.workers = max(1, min(2, int(workers)))
        self._records = OrderedDict()
        self._file_mtime = None
        self._reset_process()
        if self.cache_path:
            self._load(self.cache_path)
        if hasattr(os, 'register_at_fork'):
            os.register_at_fork(after_in_child=self._reset_process)

    def _reset_process(self):
        self._pid = os.getpid()
        self._condition = threading.Condition()
        self._persist_lock = threading.Lock()
        self._queue = deque()
        self._pending = set()
        self._threads = []
        self._attempts = {}
        self._failures = {}
        self._retry_at = 0

    def _check_pid(self):
        if self._pid != os.getpid():
            self._reset_process()

    def _cooldown(self, now):
        provider_delay = getattr(self.loader, 'retry_after_seconds', 0)
        if not isinstance(provider_delay, (int, float)) or isinstance(provider_delay, bool):
            provider_delay = 0
        return max(0, math.ceil(self._retry_at - now), self._read_shared_backoff(now),
                   min(MAX_BACKOFF_SECONDS, math.ceil(provider_delay)))

    def _read_shared_backoff(self, now):
        if not self.cache_path:
            return 0
        path = self.cache_path.with_name(self.cache_path.name + '.backoff.json')
        try:
            if path.stat().st_size > 1024:
                return 0
            value = json.loads(path.read_text(encoding='utf-8'))
            observed, retry_at = value.get('observed_at'), value.get('retry_at')
            if (value.get('version') != 1 or not _positive(observed) or not _positive(retry_at)
                    or not 0 <= now - observed <= MAX_BACKOFF_SECONDS
                    or not 0 < retry_at - observed <= MAX_BACKOFF_SECONDS):
                return 0
            return max(0, math.ceil(retry_at - now))
        except (OSError, ValueError, TypeError, AttributeError):
            return 0

    def _save_shared_backoff(self, delay):
        """Gunicorn processes sharing the quote cache also share 429 cooldown."""
        if not self.cache_path:
            return
        path = self.cache_path.with_name(self.cache_path.name + '.backoff.json')
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(str(path) + '.lock', 'a') as shared_lock:
                fcntl.flock(shared_lock, fcntl.LOCK_EX)
                now = self.now()
                seconds = min(MAX_BACKOFF_SECONDS, max(delay, self._read_shared_backoff(now)))
                temporary = path.with_name(path.name + '.' + str(os.getpid()) + '.tmp')
                temporary.write_text(json.dumps(dict(version=1, observed_at=now,
                                                     retry_at=now + seconds)), encoding='utf-8')
                temporary.replace(path)
        except (OSError, ValueError, TypeError):
            pass

    def _merge(self, incoming):
        symbol = incoming['symbol']
        previous = self._records.get(symbol)
        merged = deepcopy(incoming)
        if previous:
            for field in FIELDS:
                old_meta = previous['source']['fields'].get(field, {})
                new_meta = incoming['source']['fields'].get(field, {})
                # A provider that repeats an older trade must not replace a
                # newer saved trade just because its HTTP response is newer.
                older_trade = (field == 'price' and previous['data'].get('price_updated_at') is not None
                               and incoming['data'].get('price_updated_at') is not None
                               and incoming['data']['price_updated_at'] < previous['data']['price_updated_at'])
                if previous['data'].get(field) is not None and (incoming['data'].get(field) is None
                        or new_meta.get('fetched_at', 0) < old_meta.get('fetched_at', 0) or older_trade):
                    merged['data'][field] = previous['data'][field]
                    merged['source']['fields'][field] = deepcopy(old_meta)
                    merged['field_status'][field] = 'available'
                    if field == 'price':
                        merged['data']['price_updated_at'] = previous['data']['price_updated_at']
            merged['updated_at'] = max(previous['updated_at'], incoming['updated_at'])
            merged['source']['fetched_at'] = merged['updated_at']
        self._records[symbol] = merged
        self._records.move_to_end(symbol)
        while len(self._records) > self.max_records:
            self._records.popitem(last=False)

    def _load(self, path):
        try:
            if path.stat().st_size > MAX_CACHE_BYTES:
                return
            document = json.loads(path.read_text(encoding='utf-8'))
            rows = document.get('items')
            if not isinstance(rows, list):
                return
            for row in rows[:self.max_records]:
                valid = _valid_record(row, self.now())
                if valid:
                    self._merge(valid)
        except (OSError, ValueError, TypeError, AttributeError):
            pass

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
        with self._persist_lock:
            try:
                self.cache_path.parent.mkdir(parents=True, exist_ok=True)
                with open(str(self.cache_path) + '.lock', 'a') as shared_lock:
                    fcntl.flock(shared_lock, fcntl.LOCK_EX)
                    with self._condition:
                        self._read_disk()
                        rows = deepcopy(list(self._records.values()))
                    encoded = json.dumps({'version': 1, 'items': rows}, ensure_ascii=False, allow_nan=False)
                    if len(encoded.encode('utf-8')) > MAX_CACHE_BYTES:
                        return
                    temporary = self.cache_path.with_name(self.cache_path.name + '.' + str(os.getpid()) + '.tmp')
                    temporary.write_text(encoded, encoding='utf-8')
                    temporary.replace(self.cache_path)
            except (OSError, ValueError):
                pass

    def _worker(self):
        while True:
            with self._condition:
                while not self._queue:
                    self._condition.wait()
                symbol, name = self._queue.popleft()
                cooldown = self._cooldown(self.now())
            failure, incoming = QuoteFailure(), None
            try:
                result = (QuoteFailure('rate_limited', retry_after_seconds=cooldown) if cooldown
                          else self.loader(symbol, name))
                if isinstance(result, QuoteFailure):
                    failure = result
                else:
                    incoming = _valid_record(result, self.now())
                    if result is not None and (not incoming or incoming['symbol'] != symbol):
                        failure, incoming = QuoteFailure('invalid'), None
            except (requests.RequestException, UpstreamReadError, TimeoutError, OSError):
                failure = QuoteFailure('fetch_error')
            except (ValueError, TypeError):
                failure = QuoteFailure('invalid')
            except Exception:
                pass  # No arbitrary provider detail escapes in the API.
            with self._condition:
                if incoming:
                    self._merge(incoming)
                    self._failures.pop(symbol, None)
                else:
                    self._failures[symbol] = failure.reason
                    if failure.reason == 'rate_limited' and not cooldown:
                        self._retry_at = max(self._retry_at, self.now() + failure.retry_after_seconds)
            try:
                if failure.reason == 'rate_limited' and not cooldown:
                    self._save_shared_backoff(failure.retry_after_seconds)
                if incoming:
                    self._save()
            except (OSError, ValueError):
                pass  # An unavailable disk must not discard the good value.
            finally:
                # A completed refresh includes its persistence attempt. Keep
                # single-flight active while saving, without holding the
                # condition across _save's own lock acquisition.
                with self._condition:
                    self._attempts[symbol] = self.now()
                    self._pending.discard(symbol)
                    self._condition.notify_all()

    def get(self, symbol, name):
        if not safe_symbol(symbol):
            return dict(symbol=symbol if isinstance(symbol, str) else None, name=str(name or '')[:200],
                        status='unavailable', refreshing=False, updated_at=None, data=None, source=None,
                        field_status={field: 'invalid' for field in FIELDS}, retry_after_seconds=0,
                        market_data=dict(kind='delayed', delay_minutes=DELAY_MINUTES, quote_as_of=None,
                                         quote_age_seconds=None, quote_is_recent=False))
        self._check_pid()
        with self._condition:
            self._read_disk()
            now = self.now()
            row = _valid_record(self._records.get(symbol), now)
            if row:
                self._records[symbol] = row
            elif symbol in self._records:
                del self._records[symbol]
            due = row is None or now - row['updated_at'] >= self.ttl
            cooldown = self._cooldown(now)
            if (due and not cooldown and symbol not in self._pending and len(self._pending) < self.max_pending
                    and (symbol not in self._attempts or now - self._attempts[symbol] >= self.retry)):
                self._pending.add(symbol)
                self._queue.append((symbol, str(name or symbol)[:200]))
                while len(self._threads) < self.workers:
                    worker = threading.Thread(target=self._worker, name='company-quote', daemon=True)
                    self._threads.append(worker)
                    worker.start()
                self._condition.notify_all()
            refreshing = symbol in self._pending
            quote_at = row['data'].get('price_updated_at') if row else None
            age = int(now - quote_at) if quote_at is not None else None
            recent = age is not None and 0 <= age <= RECENT_QUOTE_SECONDS
            states = {field: 'available' if row and row['data'].get(field) is not None else
                      'loading' if refreshing else
                      'fetch_error' if cooldown or self._failures.get(symbol) == 'rate_limited' else
                      self._failures.get(symbol, row['field_status'][field] if row else 'unconfirmed')
                      for field in FIELDS}
            status = (('stale' if due or not recent or symbol in self._failures else 'ready') if row
                      else 'pending' if refreshing else 'unavailable')
            return dict(symbol=symbol, name=str(name or symbol)[:200], status=status, refreshing=refreshing,
                        updated_at=row['updated_at'] if row else None,
                        data=deepcopy(row['data']) if row else None,
                        source=deepcopy(row['source']) if row else None, field_status=states,
                        retry_after_seconds=cooldown,
                        market_data=dict(kind='delayed', delay_minutes=DELAY_MINUTES, quote_as_of=quote_at,
                                         quote_age_seconds=age, quote_is_recent=recent))

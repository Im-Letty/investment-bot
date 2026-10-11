"""On-demand CC0 Wikidata company facts, verified against official identity.

Only short Japanese structured descriptions/labels are used. No Wikipedia
article, business-summary prose, AI request or paid data source is accessed.
Names AND the stock-exchange/ticker pair must match before any facts are used.
"""
from collections import OrderedDict, deque
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import fcntl
import json
import math
import os
from pathlib import Path
import re
import threading
import time
import unicodedata

import requests
from urllib3.exceptions import HTTPError as UpstreamReadError


API_URL = 'https://www.wikidata.org/w/api.php'
EXCHANGES = {'Tokyo': 'Q217475', 'Nagoya': 'Q1188840',
             'Sapporo': 'Q11093491', 'Fukuoka': 'Q5507703'}
TTL = 7 * 86400
RETRY = 3600
RETAIN = 90 * 86400
MAX_RECORDS = 8192
MAX_CACHE_BYTES = 32_000_000
MAX_FACTS = 8
KINDS = ('available', 'loading', 'source_missing', 'identity_unconfirmed',
         'fetch_error', 'invalid', 'unconfirmed')


def normalize_name(value):
    if not isinstance(value, str) or not 0 < len(value) <= 200:
        return None
    value = unicodedata.normalize('NFKC', value).replace('株式会社', '')
    # The official exchange masters use both full corporate forms and (株).
    # Remove that legal form only; never fuzzy-match abbreviated brand names.
    value = re.sub(r'^\s*\(株\)\s*|\s*\(株\)\s*$', '', value)
    value = re.sub(r'\s+', '', value)
    return value if value else None


def _qid(value):
    return isinstance(value, str) and bool(re.fullmatch(r'Q[1-9][0-9]{0,10}', value))


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def official_identity(symbol, company):
    if not isinstance(symbol, str) or not re.fullmatch(r'[0-9][A-Z0-9]{3}\.(T|JP)', symbol):
        return None
    if not isinstance(company, dict):
        return None
    code = symbol.split('.')[0]
    exchange = company.get('exchange', 'Tokyo' if symbol.endswith('.T') else None)
    name = normalize_name(company.get('name'))
    if (exchange not in EXCHANGES or not name or company.get('code') != code
            or company.get('symbol', symbol) != symbol
            or symbol.endswith('.T') != (exchange == 'Tokyo')):
        return None
    identity = dict(symbol=symbol, code=code, name=name, exchange=exchange,
                    exchange_id=EXCHANGES[exchange])
    others = company.get('other_listings', [])
    if not isinstance(others, list) or len(others) > len(EXCHANGES) - 1:
        return None
    pairs = set()
    for row in others:
        # Only official, same-company secondary listings are usable proof.
        # A same ticker on another exchange is not an identity match by itself.
        if (not isinstance(row, dict) or row.get('exchange') not in EXCHANGES
                or row.get('code') != code or normalize_name(row.get('name')) != name):
            continue
        if row['exchange'] != exchange:
            pairs.add(row['exchange'])
    if pairs:
        identity['listings'] = [dict(exchange=key, exchange_id=EXCHANGES[key])
                                for key in sorted(pairs)]
    return identity


def _identity_exchanges(identity):
    return {row['exchange_id']: row['exchange'] for row in
            [identity, *identity.get('listings', [])]}


def _stored_identity(supplied):
    if not isinstance(supplied, dict):
        return None
    listings = supplied.get('listings', [])
    if (not isinstance(listings, list) or len(listings) > len(EXCHANGES) - 1
            or any(not isinstance(item, dict) for item in listings)):
        return None
    clean = official_identity(supplied.get('symbol'), dict(code=supplied.get('code'), name=supplied.get('name'),
        exchange=supplied.get('exchange'), symbol=supplied.get('symbol'),
        other_listings=[dict(code=supplied.get('code'), name=supplied.get('name'), exchange=item.get('exchange'))
                        for item in listings]))
    return clean if clean == supplied else None


def read_candidate_hints(path, now):
    """A discovery QID is a search shortcut, never proof or displayable facts."""
    if not path:
        return {}
    try:
        path = Path(path)
        if path.stat().st_size > MAX_CACHE_BYTES:
            return {}
        document = json.loads(path.read_text(encoding='utf-8'))
        discovered = document.get('discovered_at')
        if (document.get('version') != 1 or not _number(discovered)
                or not 0 <= now - discovered < RETAIN):
            return {}
        rows = document.get('candidate_hints')
        if not isinstance(rows, list) or len(rows) > MAX_RECORDS:
            return {}
        result, repeated = {}, set()
        for row in rows:
            if not isinstance(row, dict):
                continue
            symbol, identity, ids = (row.get(key) for key in ('symbol', 'identity', 'entity_ids'))
            if (not _stored_identity(identity) or symbol != identity['symbol']
                    or not isinstance(ids, list) or not 0 < len(ids) <= 5
                    or any(not _qid(qid) for qid in ids) or len(set(ids)) != len(ids)):
                continue
            if symbol in result or symbol in repeated:
                repeated.add(symbol); result.pop(symbol, None)
                continue
            result[symbol] = dict(identity=identity, entity_ids=ids)
        return result
    except (OSError, ValueError, TypeError, AttributeError):
        return {}


def _japanese(value, limit=400, *, require_script=False):
    if not isinstance(value, dict) or value.get('language') != 'ja':
        return None
    text = value.get('value')
    if (not isinstance(text, str) or not 0 < len(text) <= limit
            or any(unicodedata.category(char) == 'Cc' for char in text)
            or require_script and not re.search(r'[\u3040-\u30ff\u3400-\u9fff]', text)):
        return None
    return text.strip() or None


def _snak_value(snak, property_name):
    if (not isinstance(snak, dict) or snak.get('snaktype') != 'value'
            or snak.get('property', property_name) != property_name):
        return None
    value = snak.get('datavalue')
    return value.get('value') if isinstance(value, dict) else None


def _start_not_future(snak, today, now=None):
    value = _snak_value(snak, 'P580')
    if not isinstance(value, dict) or value.get('calendarmodel') not in (
            None, 'http://www.wikidata.org/entity/Q1985727'):
        return False
    raw, precision = value.get('time'), value.get('precision')
    if not isinstance(raw, str) or not isinstance(precision, int) or isinstance(precision, bool):
        return False
    match = re.fullmatch(r'\+(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}Z', raw)
    if not match:
        return False
    year, month, day = map(int, match.groups())
    if not 1 <= year <= 2100:
        return False
    try:
        # An imprecise start in the current year/month cannot establish that
        # the listing has already started. No missing day is invented.
        if precision == 9:
            return date(year, 12, 31) <= today
        if precision == 10:
            return (year, month) < (today.year, today.month) and 1 <= month <= 12
        if precision == 11:
            return date(year, month, day) <= today
        if 12 <= precision <= 14:
            observed = (now if now is not None else
                        datetime(today.year, today.month, today.day,
                                 tzinfo=timezone(timedelta(hours=9))).timestamp())
            starts = datetime.strptime(raw[1:], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc).timestamp()
            return starts <= observed
    except ValueError:
        pass
    return False


def _current_claim(claim, today, now=None):
    if not isinstance(claim, dict) or claim.get('rank', 'normal') not in ('normal', 'preferred'):
        return False
    qualifiers = claim.get('qualifiers', {})
    if not isinstance(qualifiers, dict) or qualifiers.get('P582'):
        return False
    starts = qualifiers.get('P580', [])
    if not isinstance(starts, list) or len(starts) > 8:
        return False
    return all(_start_not_future(start, today, now) for start in starts)


def verify_entity(entity, identity, today, now=None):
    """No name-only/code-only/entity-description match is sufficient."""
    if not isinstance(entity, dict) or not _qid(entity.get('id')):
        return None
    labels, aliases, claims = (entity.get(key, {}) for key in ('labels', 'aliases', 'claims'))
    if not all(isinstance(value, dict) for value in (labels, aliases, claims)):
        return None
    names = []
    label = _japanese(labels.get('ja'), 200)
    if label:
        names.append(label)
    japanese_aliases = aliases.get('ja', [])
    if not isinstance(japanese_aliases, list) or len(japanese_aliases) > 100:
        return None
    names.extend(value for alias in japanese_aliases if (value := _japanese(alias, 200)))
    matched = next((name for name in names if normalize_name(name) == identity['name']), None)
    if matched is None:
        return None
    listings = claims.get('P414', [])
    if not isinstance(listings, list) or len(listings) > 100:
        return None
    for claim in listings:
        if not _current_claim(claim, today, now):
            continue
        value = _snak_value(claim.get('mainsnak'), 'P414')
        exchange_id = value.get('id') if isinstance(value, dict) else None
        exchanges = _identity_exchanges(identity)
        if exchange_id not in exchanges:
            continue
        tickers = claim.get('qualifiers', {}).get('P249', [])
        if not isinstance(tickers, list) or len(tickers) > 32:
            continue
        for snak in tickers:
            code = _snak_value(snak, 'P249')
            if not isinstance(code, str) or len(code) > 10:
                continue
            if unicodedata.normalize('NFKC', code).strip().upper() == identity['code']:
                return dict(entity_id=entity['id'], matched_name=matched,
                            exchange=exchanges[exchange_id], exchange_id=exchange_id,
                            code=identity['code'], rank=claim.get('rank', 'normal'),
                            current_listing=True)
    return None


def fact_ids(entity, today, now=None):
    found, total = {}, []
    for property_name, field in (('P452', 'industries'), ('P1056', 'products')):
        found[field] = []
        claims = entity.get('claims', {}).get(property_name, [])
        if not isinstance(claims, list):
            continue
        for claim in claims[:100]:
            if not _current_claim(claim, today, now):
                continue
            value = _snak_value(claim.get('mainsnak'), property_name)
            qid = value.get('id') if isinstance(value, dict) else None
            if not _qid(qid) or qid in found[field]:
                continue
            if qid not in total:
                if len(total) == MAX_FACTS:
                    continue
                total.append(qid)
            found[field].append(qid)
    return found, total


class BusinessFailure:
    def __init__(self, reason='unconfirmed', *, retry_after_seconds=0):
        self.reason = reason if reason in KINDS and reason not in ('available', 'loading') else 'unconfirmed'
        self.retry_after_seconds = max(0, int(retry_after_seconds))


class WikidataBusinessProvider:
    """Verified QID hints skip search; entities are always checked afresh."""
    def __init__(self, *, session_factory=requests.Session, now=time.time,
                 monotonic=time.monotonic, deadline=15, interactive=False, cooldown_path=None,
                 candidate_hints=None):
        self.session_factory, self.now, self.monotonic = session_factory, now, monotonic
        self.deadline = max(.1, min(15, deadline))
        # MediaWiki explicitly permits omitting maxlag while a user waits for
        # an interactive result. Automated refreshes retain maxlag=5.
        self.interactive = interactive is True
        self.cooldown_path = Path(cooldown_path) if cooldown_path else None
        self.candidate_hints = deepcopy(candidate_hints) if isinstance(candidate_hints, dict) else {}
        self._reset_process()
        if hasattr(os, 'register_at_fork'):
            os.register_at_fork(after_in_child=self._reset_process)

    def _reset_process(self):
        self._pid = os.getpid()
        self._local = threading.local()
        self._retry_at = 0
        self._backoff_lock = threading.Lock()

    def _read_shared_cooldown(self):
        if self.cooldown_path:
            try:
                if self.cooldown_path.stat().st_size > 512:
                    return
                value = json.loads(self.cooldown_path.read_text(encoding='utf-8')).get('retry_at')
                if _number(value):
                    self._retry_at = max(self._retry_at, value)
            except (OSError, ValueError, TypeError, AttributeError):
                pass

    def _save_shared_cooldown(self):
        if not self.cooldown_path:
            return
        with self._backoff_lock:
            try:
                self.cooldown_path.parent.mkdir(parents=True, exist_ok=True)
                with open(str(self.cooldown_path) + '.lock', 'a') as shared_lock:
                    fcntl.flock(shared_lock, fcntl.LOCK_EX)
                    self._read_shared_cooldown()
                    temporary = self.cooldown_path.with_name(self.cooldown_path.name + '.' + str(os.getpid()) + '.tmp')
                    temporary.write_text(json.dumps({'retry_at': self._retry_at}, allow_nan=False), encoding='utf-8')
                    temporary.replace(self.cooldown_path)
            except (OSError, ValueError):
                pass  # This process still respects its in-memory pause.

    @property
    def retry_after_seconds(self):
        if self._pid != os.getpid():
            self._reset_process()
        self._read_shared_cooldown()
        return max(0, math.ceil(self._retry_at - self.now()))

    def _backoff(self, raw):
        """Wikimedia HTTP 429 and HTTP-200 maxlag share the same pause."""
        delay = 60
        if isinstance(raw, str) and len(raw) <= 128:
            try:
                delay = int(raw) if raw.isdigit() else math.ceil(parsedate_to_datetime(raw).timestamp() - self.now())
            except (ValueError, TypeError, OverflowError, OSError):
                pass
        # Retry-After is a minimum, including values longer than 15 minutes.
        delay = max(30, delay)
        self._retry_at = max(self._retry_at, self.now() + delay)
        self._save_shared_cooldown()
        return BusinessFailure('fetch_error', retry_after_seconds=self.retry_after_seconds)

    def _read(self, params, deadline, limit):
        if self.retry_after_seconds:
            return BusinessFailure('fetch_error', retry_after_seconds=self.retry_after_seconds)
        remaining = deadline - self.monotonic()
        if remaining <= 0:
            return BusinessFailure('fetch_error')
        session = getattr(self._local, 'session', None)
        if session is None:
            session = self._local.session = self.session_factory()
            session.headers.update({'User-Agent': 'InvestmentLetterCompanyFacts/1.0 (+https://investment-bot-ta24.onrender.com/)',
                                    'Accept-Encoding': 'gzip,deflate'})
        query = dict(params, format='json')
        if not self.interactive:
            query['maxlag'] = '5'
        with session.get(API_URL, params=query,
                         timeout=(min(2, remaining / 3), min(4, remaining * 2 / 3)),
                         allow_redirects=False, stream=True) as response:
            retry_header = response.headers.get('Retry-After')
            if response.status_code == 429 or response.status_code == 503 and retry_header:
                return self._backoff(retry_header)
            if response.status_code != 200:
                return BusinessFailure('fetch_error')
            chunks, size = [], 0
            while True:
                if self.monotonic() >= deadline:
                    return BusinessFailure('fetch_error')
                chunk = response.raw.read1(4096, decode_content=True)
                if not chunk:
                    break
                size += len(chunk)
                if size > limit:
                    return BusinessFailure('invalid')
                chunks.append(chunk)
        value = json.loads(b''.join(chunks))
        if not isinstance(value, dict):
            return BusinessFailure('invalid')
        if value.get('error'):
            error = value['error']
            if isinstance(error, dict) and error.get('code') in ('maxlag', 'ratelimited', 'ratelimit'):
                return self._backoff(retry_header)
            return BusinessFailure('fetch_error')
        return value

    def __call__(self, symbol, company):
        identity = official_identity(symbol, company)
        if identity is None:
            return BusinessFailure('identity_unconfirmed')
        deadline = self.monotonic() + self.deadline
        try:
            hint = self.candidate_hints.get(symbol)
            using_hint = isinstance(hint, dict) and hint.get('identity') == identity
            if using_hint:
                ids = hint.get('entity_ids', [])
                if (not isinstance(ids, list) or not 0 < len(ids) <= 5
                        or any(not _qid(qid) for qid in ids)):
                    return BusinessFailure('invalid')
            else:
                search = self._read(dict(action='wbsearchentities', search=company['name'], language='ja',
                                         uselang='ja', type='item', limit='5'), deadline, 40_000)
                if isinstance(search, BusinessFailure):
                    return search
                rows = search.get('search')
                if not isinstance(rows, list):
                    return BusinessFailure('invalid')
                ids = list(dict.fromkeys(row.get('id') for row in rows[:5]
                                         if isinstance(row, dict) and _qid(row.get('id'))))
            if not ids:
                return BusinessFailure('source_missing')
            result = self._read(dict(action='wbgetentities', ids='|'.join(ids), languages='ja',
                                     props='labels|aliases|descriptions|claims'), deadline, 800_000)
            if isinstance(result, BusinessFailure):
                return result
            entities = result.get('entities')
            if not isinstance(entities, dict):
                return BusinessFailure('invalid')
            today = datetime.fromtimestamp(self.now(), timezone(timedelta(hours=9))).date()
            verified = []
            for qid in ids:
                entity = entities.get(qid)
                proof = verify_entity(entity, identity, today, self.now()) if isinstance(entity, dict) and entity.get('id') == qid else None
                if proof:
                    verified.append((entity, proof))
            if len(verified) != 1:
                if using_hint and not verified:
                    # The QID discovery can age independently of the issuer.
                    # Discard obsolete hints, so the next bounded attempt does
                    # a fresh name search rather than repeating a dead entity.
                    self.candidate_hints.pop(symbol, None)
                    return BusinessFailure('identity_unconfirmed', retry_after_seconds=30)
                return BusinessFailure('identity_unconfirmed')
            entity, proof = verified[0]
            description = _japanese(entity.get('descriptions', {}).get('ja'), require_script=True)
            facts, fact_qids = fact_ids(entity, today, self.now())
            fact_labels = {}
            if fact_qids:
                result = self._read(dict(action='wbgetentities', ids='|'.join(fact_qids),
                                         languages='ja', props='labels'), deadline, 100_000)
                if isinstance(result, BusinessFailure):
                    # A verified description remains useful if optional fact
                    # labels are unavailable; no missing labels are invented.
                    if not description:
                        return result
                else:
                    values = result.get('entities')
                    if isinstance(values, dict):
                        for qid in fact_qids:
                            item = values.get(qid)
                            if isinstance(item, dict) and item.get('id') == qid:
                                label = _japanese(item.get('labels', {}).get('ja'), 100)
                                if label:
                                    fact_labels[qid] = label
            industries = [dict(id=qid, label=fact_labels[qid]) for qid in facts['industries'] if qid in fact_labels]
            products = [dict(id=qid, label=fact_labels[qid]) for qid in facts['products'] if qid in fact_labels]
            if not description and not industries and not products:
                return BusinessFailure('source_missing')
            return dict(symbol=symbol, identity=identity, proof=proof, fetched_at=self.now(),
                        facts=dict(description=description, industries=industries, products=products))
        except (requests.RequestException, UpstreamReadError, TimeoutError, OSError):
            return BusinessFailure('fetch_error')
        except (ValueError, TypeError, AttributeError, KeyError):
            return BusinessFailure('invalid')


def _valid_record(row, now, identity=None):
    if not isinstance(row, dict):
        return None
    supplied = row.get('identity')
    if not isinstance(supplied, dict):
        return None
    verified_identity = _stored_identity(supplied)
    fetched, proof, facts = (row.get(key) for key in ('fetched_at', 'proof', 'facts'))
    if (verified_identity is None or row.get('symbol') != supplied['symbol']
            or identity is not None and identity != supplied
            or not _number(fetched) or not 0 <= now - fetched < RETAIN
            or not isinstance(proof, dict) or not isinstance(facts, dict)
            or not _qid(proof.get('entity_id')) or proof.get('current_listing') is not True
            or proof.get('rank') not in ('normal', 'preferred')
            or normalize_name(proof.get('matched_name')) != supplied['name']
            or proof.get('code') != supplied['code']
            or _identity_exchanges(supplied).get(proof.get('exchange_id')) != proof.get('exchange')):
        return None
    description = facts.get('description')
    if description is not None and _japanese(dict(language='ja', value=description), require_script=True) is None:
        return None
    clean_facts = dict(description=description)
    for field in ('industries', 'products'):
        values = facts.get(field)
        if not isinstance(values, list) or len(values) > MAX_FACTS:
            return None
        clean_facts[field] = []
        for item in values:
            if (not isinstance(item, dict) or not _qid(item.get('id'))
                    or _japanese(dict(language='ja', value=item.get('label')), 100) is None):
                return None
            clean_facts[field].append(dict(id=item['id'], label=item['label']))
    if (len({item['id'] for field in ('industries', 'products') for item in clean_facts[field]}) > MAX_FACTS
            or not description and not any(clean_facts[field] for field in ('industries', 'products'))):
        return None
    return dict(symbol=row['symbol'], identity=deepcopy(supplied),
                proof={key: proof[key] for key in ('entity_id', 'matched_name', 'exchange', 'exchange_id', 'code', 'rank', 'current_listing')},
                fetched_at=fetched, facts=clean_facts)


def public_facts(row, *, state='unconfirmed', refreshing=False):
    description = row['facts']['description'] if row else None
    industries = [item['label'] for item in row['facts']['industries']] if row else []
    products = [item['label'] for item in row['facts']['products']] if row else []
    lines = []
    if not description:
        if industries:
            lines.append('業種：' + '・'.join(industries))
        if products:
            lines.append('主な製品・サービス：' + '・'.join(products))
    return dict(text=description or '。'.join(lines) or None,
                source_url='https://www.wikidata.org/wiki/' + row['proof']['entity_id'] if row else None,
                source_title='Wikidata', fetched_at=row['fetched_at'] if row else None,
                kind='structured_company_facts', field_status='available' if row else state,
                products=products, industry_labels=industries, refreshing=refreshing)


class CompanyBusinesses:
    """Return preverified facts immediately; one worker refreshes selected firms."""
    def __init__(self, loader=None, *, cache_path=None, seed_path=None, now=time.time, ttl=TTL, retry=RETRY,
                 max_pending=64, max_records=MAX_RECORDS, interactive=False):
        self.now, self.ttl, self.retry = now, ttl, retry
        self.cache_path = Path(cache_path) if cache_path else None
        self.loader = loader or WikidataBusinessProvider(now=now, interactive=interactive,
            cooldown_path=str(self.cache_path) + '.backoff.json' if self.cache_path else None,
            candidate_hints=read_candidate_hints(seed_path, now()))
        self.max_pending = max(1, min(64, int(max_pending)))
        self.max_records = max(1, min(MAX_RECORDS, int(max_records)))
        self._records = OrderedDict(); self._seed_records = {}; self._file_mtime = None
        self._reset_process()
        if seed_path:
            self._load(Path(seed_path), seed=True)
        if self.cache_path:
            self._load(self.cache_path)
        if hasattr(os, 'register_at_fork'):
            os.register_at_fork(after_in_child=self._reset_process)

    def _reset_process(self):
        self._pid = os.getpid()
        self._condition = threading.Condition(); self._persist_lock = threading.Lock()
        self._queue = deque(); self._pending = set(); self._attempts = {}; self._failures = {}; self._retry_delays = {}
        self._thread = None

    def _merge(self, row):
        previous = self._records.get(row['symbol'])
        if previous is None or row['fetched_at'] >= previous['fetched_at']:
            self._records[row['symbol']] = deepcopy(row)
            self._records.move_to_end(row['symbol'])
        while len(self._records) > self.max_records:
            self._records.popitem(last=False)

    def _load(self, path, *, seed=False):
        try:
            if path.stat().st_size > MAX_CACHE_BYTES:
                return
            document = json.loads(path.read_text(encoding='utf-8'))
            rows = document.get('items')
            if isinstance(rows, list):
                for row in rows[:self.max_records]:
                    clean = _valid_record(row, self.now())
                    if clean:
                        self._merge(clean)
                        if seed:
                            self._seed_records[clean['symbol']] = clean
        except (OSError, ValueError, TypeError, AttributeError):
            pass

    def _read_disk(self):
        if self.cache_path:
            try:
                mtime = self.cache_path.stat().st_mtime_ns
                if mtime != self._file_mtime:
                    self._load(self.cache_path); self._file_mtime = mtime
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
                        self._read_disk(); rows = deepcopy(list(self._records.values()))
                    text = json.dumps({'version': 1, 'items': rows}, ensure_ascii=False, allow_nan=False)
                    if len(text.encode('utf-8')) > MAX_CACHE_BYTES:
                        return
                    temporary = self.cache_path.with_name(self.cache_path.name + '.' + str(os.getpid()) + '.tmp')
                    temporary.write_text(text, encoding='utf-8'); temporary.replace(self.cache_path)
            except (OSError, ValueError):
                pass

    def _worker(self):
        while True:
            with self._condition:
                while not self._queue:
                    self._condition.wait()
                symbol, company, identity = self._queue.popleft()
            clean, failure, retry_delay = None, 'unconfirmed', self.retry
            try:
                result = self.loader(symbol, company)
                if isinstance(result, BusinessFailure):
                    failure = result.reason
                    if result.retry_after_seconds:
                        retry_delay = max(30, result.retry_after_seconds)
                else:
                    clean = _valid_record(result, self.now(), identity)
                    if result is not None and not clean:
                        failure = 'invalid'
            except (requests.RequestException, UpstreamReadError, TimeoutError, OSError):
                failure = 'fetch_error'
            except (ValueError, TypeError):
                failure = 'invalid'
            except Exception:
                pass
            with self._condition:
                if clean:
                    self._merge(clean); self._failures.pop(symbol, None)
                    self._retry_delays.pop(symbol, None)
                else:
                    self._failures[symbol] = failure
                    self._retry_delays[symbol] = retry_delay
            try:
                if clean:
                    self._save()
            except (OSError, ValueError):
                pass  # Preserve verified in-memory facts if saving fails.
            finally:
                # Persistence belongs to this refresh. _save acquires the
                # condition itself, so call it outside the condition lock.
                with self._condition:
                    self._attempts[symbol] = self.now(); self._pending.discard(symbol)
                    self._condition.notify_all()

    def get(self, symbol, official_company_row):
        identity = official_identity(symbol, official_company_row)
        if identity is None:
            return public_facts(None, state='identity_unconfirmed')
        if self._pid != os.getpid():
            self._reset_process()
        with self._condition:
            self._read_disk(); now = self.now()
            row = _valid_record(self._records.get(symbol), now, identity)
            seeded = _valid_record(self._seed_records.get(symbol), now, identity)
            if seeded and (not row or seeded['fetched_at'] > row['fetched_at']):
                row = seeded
            previous = self._records.get(symbol)
            if not row and previous and previous.get('identity') != identity:
                self._attempts.pop(symbol, None); self._failures.pop(symbol, None); self._retry_delays.pop(symbol, None)
            stale = not row or now - row['fetched_at'] >= self.ttl
            cooldown = getattr(self.loader, 'retry_after_seconds', 0)
            cooldown = cooldown if isinstance(cooldown, (int, float)) and not isinstance(cooldown, bool) else 0
            if (stale and not cooldown and symbol not in self._pending and len(self._pending) < self.max_pending
                    and (symbol not in self._attempts or now - self._attempts[symbol] >= self._retry_delays.get(symbol, self.retry))):
                self._pending.add(symbol)
                self._queue.append((symbol, deepcopy(official_company_row), identity))
                if self._thread is None:
                    self._thread = threading.Thread(target=self._worker, name='company-business', daemon=True)
                    self._thread.start()
                self._condition.notify_all()
            refreshing = symbol in self._pending
            state = 'loading' if refreshing else self._failures.get(symbol, 'fetch_error' if cooldown else 'unconfirmed')
            return public_facts(row, state=state, refreshing=refreshing)

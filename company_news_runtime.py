"""Company releases: private source queue, reviewed public cache, no server AI."""
from copy import deepcopy
from datetime import date, datetime, timedelta
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import re
import tempfile
import threading
import time
from urllib.parse import urlsplit

from news_cache import JST
from daily_news_runtime import StorageUnavailable, SupabaseNewsStorage

PREFIX = 'company-news/v1'
SOURCES = {
    '9432.T': ('NTT', 'group.ntt', r'/jp/newsrelease/\d{4}/\d{2}/\d{2}/[^/]+\.html'),
    '9433.T': ('KDDI', 'newsroom.kddi.com', r'/news/detail/kddi_nr-[^/]+\.html'),
    '6752.T': ('パナソニック ホールディングス', 'news.panasonic.com', r'/jp/press/jn\d{6}-\d+'),
}
COPY_KEYS = ('title', 'business', 'event', 'outlook')
SOURCE_HASH_KEYS = ('symbol', 'name', 'business', 'title', 'url', 'published_date',
                    'published_at', 'body_sha256', 'body_verified_at', 'source',
                    'sector', 'business_url', 'related_company', 'other_news')
PUBLIC_KEYS = ('symbol', 'name', 'sector', 'title', 'business', 'event', 'outlook',
               'source_url', 'published_date', 'published_at', 'article_id', 'reviewed_at')


def canonical_hash(value):
    return sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                             separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def article_id(source):
    return sha256((source['symbol'] + '\n' + source['url']).encode()).hexdigest()


def source_hash(source):
    return canonical_hash({key: source.get(key) for key in SOURCE_HASH_KEYS})


def source_fingerprint(source):
    return sha256((article_id(source) + '\n' + source['body_sha256']).encode()).hexdigest()


def _day(value):
    try:
        return isinstance(value, str) and date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def _stamp(value):
    return type(value) in (int, float) and math.isfinite(value) and 0 < value < 253402268399


def valid_source(source, now):
    if not isinstance(source, dict) or source.get('symbol') not in SOURCES or not _stamp(now):
        return False
    name, host, pattern = SOURCES[source['symbol']]
    parsed = urlsplit(str(source.get('url', '')))
    if (source.get('name') != name or parsed.scheme != 'https' or parsed.hostname != host
            or parsed.netloc != host or parsed.query or parsed.fragment
            or not re.fullmatch(pattern, parsed.path) or not _day(source.get('published_date'))):
        return False
    for key, minimum, maximum in [('title', 3, 500), ('business', 8, 250), ('body', 100, 30000)]:
        value = source.get(key)
        if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum:
            return False
    if source.get('body_sha256') != sha256(source['body'].encode()).hexdigest():
        return False
    verified = source.get('body_verified_at')
    today = datetime.fromtimestamp(now, JST).date()
    publication = date.fromisoformat(source['published_date'])
    if (not _stamp(verified) or verified > now + 30 or publication > today
            or publication > datetime.fromtimestamp(verified, JST).date()):
        return False
    stamp = source.get('published_at')
    return stamp is None or (_stamp(stamp) and stamp <= verified + 30
        and datetime.fromtimestamp(stamp, JST).date() == publication)


def valid_record(record, now):
    if not isinstance(record, dict) or record.get('schema') != 'company-reviewed-v1':
        return False
    source, company = record.get('source'), record.get('company')
    if not valid_source(source, now) or not isinstance(company, dict):
        return False
    if any(company.get(key) != source.get(key) for key in
           ('symbol', 'name', 'published_date', 'published_at', 'body_sha256', 'body_verified_at')):
        return False
    if company.get('source_url') != source['url'] or company.get('article_id') != article_id(source):
        return False
    for key in COPY_KEYS:
        if not isinstance(company.get(key), str) or not company[key].strip():
            return False
    if (not 8 <= len(company['title']) <= 60 or
            not 60 <= sum(len(company[key]) for key in COPY_KEYS[1:]) <= 440):
        return False
    content_hash = canonical_hash({key: company[key] for key in COPY_KEYS})
    input_hash = source_hash(source)
    if company.get('content_sha256') != content_hash or company.get('source_sha256') != input_hash:
        return False
    reviewed = company.get('reviewed_at')
    if not _stamp(reviewed) or not source['body_verified_at'] <= reviewed <= now:
        return False
    reviews = company.get('reviews')
    if (not isinstance(reviews, dict) or set(reviews) != {'gemini', 'openai'}
            or any(not isinstance(review, dict) or review.get('approved') is not True
                   or review.get('content_sha256') != content_hash
                   or review.get('source_sha256') != input_hash for review in reviews.values())):
        return False
    until = (date.fromisoformat(source['published_date']) + timedelta(days=7)).isoformat()
    return company.get('valid_until') == until


def public_snapshot(records, now, status='ready', checked_at=None):
    valid = [item['company'] for item in records if valid_record(item, now)
             and item['company']['valid_until'] >= datetime.fromtimestamp(now, JST).date().isoformat()]
    valid.sort(key=lambda item: (item['published_date'], item.get('published_at') or 0,
                                item['reviewed_at']), reverse=True)
    selected, symbols, ids = [], set(), set()
    for company in valid:
        if company['symbol'] in symbols or company['article_id'] in ids:
            continue
        symbols.add(company['symbol']); ids.add(company['article_id'])
        selected.append({**{key: company.get(key) for key in PUBLIC_KEYS}, 'valid_until': company['valid_until']})
        if len(selected) == 3:
            break
    today = datetime.fromtimestamp(now, JST).date().isoformat()
    return {'edition_date': max((datetime.fromtimestamp(item['reviewed_at'], JST).date().isoformat()
                                for item in selected), default=today),
            'valid_until': max((item['valid_until'] for item in selected), default=today),
            'companies': selected, 'status': status, 'checked_at': checked_at,
            'source_interval_seconds': 900, 'max_companies_per_day': 3}


def read_records(storage, now, *, today_only=False, cache=None):
    records = []
    today = datetime.fromtimestamp(now, JST).date()
    for offset in range(1 if today_only else 8):
        day = (today - timedelta(days=offset)).isoformat()
        for slot in range(1, 4):
            path = f'{PREFIX}/days/{day}/published-{slot}.json'
            # Published slots are immutable. Remember only successful reads;
            # missing slots remain eligible for the next minute's check.
            record = cache.get(path) if cache is not None else None
            if record is None:
                record = storage.read(path)
            if record is not None:
                if not valid_record(record, now):
                    raise StorageUnavailable('company_record_invalid')
                if cache is not None:
                    cache[path] = deepcopy(record)
                records.append(deepcopy(record))
    return records


def candidate_records(storage, now):
    candidates = []
    today = datetime.fromtimestamp(now, JST).date()
    for offset in range(3):
        day = (today - timedelta(days=offset)).isoformat()
        prefix = f'{PREFIX}/candidates/{day}'
        for item in storage._list(prefix):
            name = item.get('name') if isinstance(item, dict) else None
            if not isinstance(name, str) or not re.fullmatch(r'[0-9a-f]{64}\.json', name):
                continue
            source = storage.read(prefix + '/' + name)
            if valid_source(source, now) and (today - date.fromisoformat(source['published_date'])).days <= 2:
                candidates.append(source)
    return sorted(candidates, key=lambda x: (x['published_date'], x.get('published_at') or 0), reverse=True)


def pending_candidates(storage, now, *, candidates=None):
    candidates = candidate_records(storage, now) if candidates is None else candidates
    if not candidates:
        return []
    day = datetime.fromtimestamp(now, JST).date().isoformat()
    claims = [storage.read(f'{PREFIX}/days/{day}/attempt-{slot}.json') for slot in range(1, 4)]
    if all(claim is not None for claim in claims):
        return []
    selected = set(claim['symbol'] for claim in claims if isinstance(claim, dict) and claim.get('symbol') in SOURCES)
    pending = []
    for source in candidates:
        if (not valid_source(source, now)
                or (datetime.fromtimestamp(now, JST).date() - date.fromisoformat(source['published_date'])).days > 2):
            continue
        if source['symbol'] in selected:
            continue
        fingerprint = source_fingerprint(source)
        if storage.read(f'{PREFIX}/seen/{fingerprint}.json') is None:
            pending.append(source)
            selected.add(source['symbol'])
    return pending[:sum(claim is None for claim in claims)]


class CompanyNewsRuntime:
    def __init__(self, storage, *, collector=None, clock=time.time,
                 cache_path='/tmp/kn-company-news.json'):
        self.storage, self.collector, self.clock = storage, collector, clock
        self.cache_path = Path(cache_path)
        self._records, self._status, self._checked, self._pending = [], 'refreshing', None, []
        self._candidates = []
        self._published_cache = {}
        self._lock = threading.Lock()
        self._thread, self._pid, self._source_check = None, os.getpid(), 0
        self._source_status = 'refreshing'
        self._last_restore, self._restore_day = 0, None
        self._candidate_check, self._candidate_day = 0, None
        try:
            raw = json.loads(self.cache_path.read_text())
            if isinstance(raw, list):
                self._records = [item for item in raw if valid_record(item, self.clock())]
        except (OSError, ValueError, TypeError):
            pass

    def start(self):
        if self._pid != os.getpid():
            self._lock, self._thread, self._pid = threading.Lock(), None, os.getpid()
            self.storage.after_fork()
        with self._lock:
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(target=self._loop, daemon=True, name='company-news-reader')
                self._thread.start()

    def _loop(self):
        while True:
            self.run_once()
            time.sleep(60)

    def _persist(self, records):
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix='.company-news-', dir=self.cache_path.parent)
        try:
            with os.fdopen(fd, 'w') as stream:
                json.dump(records, stream, ensure_ascii=False, allow_nan=False)
                stream.flush(); os.fsync(stream.fileno())
            os.replace(name, self.cache_path)
        finally:
            if os.path.exists(name):
                os.unlink(name)

    def run_once(self):
        now = self.clock()
        try:
            self.storage.ensure_private()
            collected = False
            collected_candidates = None
            if self.collector and now - self._source_check >= 900:
                self._source_check = now
                self._source_status = 'refreshing'
                known_sources = candidate_records(self.storage, now)
                known = [source['url'] for source in known_sources]
                result = self.collector(now=now, exclude_urls=known)
                sources = result['articles']
                # Verification timestamps are recorded after HTTP completes.
                # A slow successful fetch is not a future source relative to
                # the clock captured before collection began.
                now = self.clock()
                day = datetime.fromtimestamp(now, JST).date().isoformat()
                combined = {source_fingerprint(source): source for source in known_sources}
                for source in sources:
                    if valid_source(source, now):
                        self.storage.create(f'{PREFIX}/candidates/{day}/{source_fingerprint(source)}.json', source)
                        combined[source_fingerprint(source)] = source
                self._source_status = result.get('status')
                self._source_check = now
                collected = True
                collected_candidates = sorted(combined.values(), key=lambda item:
                    (item['published_date'], item.get('published_at') or 0), reverse=True)
            now = self.clock()
            day = datetime.fromtimestamp(now, JST).date().isoformat()
            with self._lock:
                previous = deepcopy(self._records)
                waiting = deepcopy(self._candidates)
            restored = self._restore_day != day or now - self._last_restore >= 900
            if restored:
                records = read_records(self.storage, now, cache=self._published_cache)
                active_days = {(datetime.fromtimestamp(now, JST).date() - timedelta(days=offset)).isoformat()
                               for offset in range(8)}
                self._published_cache = {path: record for path, record in self._published_cache.items()
                                         if path.split('/')[-2] in active_days}
            else:
                today = read_records(self.storage, now, today_only=True, cache=self._published_cache)
                records = [item for item in previous
                    if datetime.fromtimestamp(item['company']['reviewed_at'], JST).date().isoformat() != day] + today
            refreshed_candidates = collected or self._candidate_day != day or now - self._candidate_check >= 900
            if refreshed_candidates:
                waiting = collected_candidates if collected_candidates is not None else candidate_records(self.storage, now)
            # Only cached waiting candidates need claim/seen checks each minute;
            # old queue manifests and historical editions are read periodically.
            pending = pending_candidates(self.storage, now, candidates=waiting)
            if records != previous:
                self._persist(records)
            with self._lock:
                self._records, self._pending = records, pending
                self._candidates = waiting
                if restored:
                    self._last_restore, self._restore_day = now, day
                if refreshed_candidates:
                    self._candidate_check, self._candidate_day = now, day
                self._status = 'ready' if self._source_status in ('ready', 'source_empty') else 'error'
                self._checked = self._source_check or None
        except Exception:
            with self._lock:
                self._status = 'error'

    def snapshot(self):
        with self._lock:
            return public_snapshot(deepcopy(self._records), self.clock(), self._status, self._checked)

    def operational_snapshot(self):
        with self._lock:
            pending = [source for source in self._pending if valid_source(source, self.clock())]
            fingerprints = sorted(source_fingerprint(source) for source in pending)
            return {'status': self._status, 'checked_at': self._checked,
                    'pending_count': len(pending),
                    'batch_id': canonical_hash(fingerprints) if fingerprints else None,
                    'sources': ['NTT', 'KDDI', 'パナソニック'],
                    'writer_provider': 'codex_subscription', 'generation_owner': 'external',
                    'source_interval_seconds': 900, 'max_companies_per_day': 3}

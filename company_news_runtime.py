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
from daily_news_runtime import BUCKET, StorageUnavailable, SupabaseNewsStorage

PREFIX = 'company-news/v1'
# A single collector can persist at most 3 sources per 15-minute poll: 288/day.
# Enumerate the entire bounded queue before choosing articles, never an arbitrary
# first page. Immutable bodies are cached and retained for only these 3 days.
CANDIDATE_PAGE_SIZE = 100
MAX_CANDIDATES_PER_DAY = 300
CANDIDATE_SCAN_SECONDS = 60
SOURCES = {
    '9432.T': ('NTT', 'group.ntt', r'/jp/newsrelease/\d{4}/\d{2}/\d{2}/[^/]+\.html'),
    '9433.T': ('KDDI', 'newsroom.kddi.com', r'/news/detail/kddi_nr-[^/]+\.html'),
    '6752.T': ('パナソニック ホールディングス', 'news.panasonic.com', r'/jp/press/jn\d{6}-\d+'),
}
COPY_KEYS = ('title', 'business', 'event', 'outlook')
SOURCE_HASH_KEYS = ('symbol', 'name', 'business', 'title', 'url', 'published_date',
                    'published_at', 'body_sha256', 'body_verified_at', 'source',
                    'sector', 'business_url', 'related_company', 'other_news')
OPTIONAL_SOURCE_KEYS = ('company_id', 'business_context_mode', 'catalogue_as_of',
                       'catalogue_facts_sha256', 'catalogue_source_sha256')
CHANNEL_NAMES = tuple(value[0] for value in SOURCES.values()) + ('PR TIMES',)
PUBLIC_KEYS = ('symbol', 'name', 'sector', 'title', 'business', 'event', 'outlook',
               'source_url', 'published_date', 'published_at', 'article_id', 'reviewed_at')
FEED_STATES = frozenset({'ok', 'failed', 'not_completed'})
COLLECTION_STATES = frozenset({'fetch_incomplete', 'feed_failed', 'no_matching_candidates',
                              'collected', 'collected_partial', 'articles_unavailable'})
SOURCE_ERROR_CODES = frozenset({'unapproved_source', 'source_time_limit', 'source_unavailable',
    'unapproved_redirect', 'source_content_type', 'source_size_limit', 'source_size_or_time_limit',
    'unsupported_feed_declaration', 'unsupported_feed_structure', 'unsupported_source_encoding',
    'invalid_verification_clock', 'source_read_failed', 'body_or_date_unverified'})
STORAGE_ERROR_CODES = frozenset({'storage_configuration', 'storage_response', 'storage_timeout',
    'storage_network', 'storage_bucket', 'storage_private_required', 'storage_read', 'storage_size',
    'storage_write', 'storage_list', 'storage_state', 'company_record_invalid',
    'company_queue_limit', 'company_queue_timeout'})


def _safe_source_diagnostics(value):
    value = value if isinstance(value, dict) else {}
    result = {}
    for name in CHANNEL_NAMES:
        row = value.get(name)
        row = row if isinstance(row, dict) else {}
        feed, status = row.get('feed_status'), row.get('status')
        errors = row.get('errors', [])
        errors = errors if isinstance(errors, (list, tuple)) else ['source_read_failed']
        result[name] = {
            'feed_status': feed if isinstance(feed, str) and feed in FEED_STATES else 'not_completed',
            'status': status if isinstance(status, str) and status in COLLECTION_STATES else 'fetch_incomplete',
            'errors': sorted({error if isinstance(error, str) and error in SOURCE_ERROR_CODES
                              else 'source_read_failed' for error in errors[:len(SOURCE_ERROR_CODES)]}),
        }
    return result


def canonical_hash(value):
    return sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                             separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def article_id(source):
    return sha256((source['symbol'] + '\n' + source['url']).encode()).hexdigest()


def source_hash(source):
    # Keep the hashes of already reviewed legacy records unchanged.
    return canonical_hash({key: source.get(key) for key in SOURCE_HASH_KEYS} |
                          {key: source[key] for key in OPTIONAL_SOURCE_KEYS if key in source})


def _catalogue_path(facts_digest, source_digest):
    return f'{PREFIX}/catalogues/{facts_digest}/{source_digest}.json'


def source_catalogue(storage, source, *, deadline=None):
    """One immutable membership snapshot per source generation, no body/index weights."""
    digest = source.get('catalogue_facts_sha256') if isinstance(source, dict) else None
    source_digest = source.get('catalogue_source_sha256') if isinstance(source, dict) else None
    if any(not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{64}', value)
           for value in (digest, source_digest)):
        return None
    cache = getattr(storage, '_company_catalogue_cache', None)
    if cache is None:
        cache = storage._company_catalogue_cache = {}
    cache_key = (digest, source_digest)
    document = cache.get(cache_key)
    if document is None:
        if deadline is not None:
            _candidate_time(deadline)
        document = storage.read(_catalogue_path(digest, source_digest))
        if document is None:
            # The original archive used a facts-only key. It is usable only
            # when its exact official CSV proof also matches this source.
            if deadline is not None:
                _candidate_time(deadline)
            document = storage.read(f'{PREFIX}/catalogues/{digest}.json')
    if document is None:
        return None
    try:
        from company_news_catalogue import load_catalogue
        catalogue = load_catalogue(snapshot=document,
            now=datetime.fromtimestamp(source['body_verified_at'], JST))
        if (catalogue.facts_sha256 != digest
                or catalogue.provenance['source_sha256'] != source_digest):
            return None
        cache[cache_key] = deepcopy(document)
        return catalogue
    except (ValueError, KeyError, TypeError, OverflowError):
        return None


def _membership_source(source, now, catalogue=None):
    from company_news_prtimes import safe_url
    if catalogue is None:
        return False
    try:
        member = catalogue.members.get(source['symbol'])
        actor = catalogue.match_issuer(source.get('related_company'))
        parsed = urlsplit(source['url'])
        company_id = source.get('company_id')
        return bool(member and actor and actor['symbol'] == member['symbol']
            and source['name'] == member['name'] and source.get('source') == 'PR TIMES'
            and safe_url(source['url']) == source['url'] and source['url'] != 'https://prtimes.jp/index.rdf'
            and isinstance(company_id, str) and re.fullmatch(r'[1-9][0-9]{0,8}', company_id)
            and parsed.path.endswith('.' + company_id.zfill(9) + '.html')
            and source.get('catalogue_as_of') == catalogue.provenance['as_of']
            and source.get('catalogue_facts_sha256') == catalogue.facts_sha256
            and source.get('catalogue_source_sha256') == catalogue.provenance['source_sha256']
            and source.get('business_context_mode') in ('verified_profile', 'announcement_only'))
    except (ValueError, KeyError, TypeError, OverflowError):
        return False


def source_fingerprint(source):
    return sha256((article_id(source) + '\n' + source['body_sha256']).encode()).hexdigest()


def _day(value):
    try:
        return isinstance(value, str) and date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def _stamp(value):
    return type(value) in (int, float) and math.isfinite(value) and 0 < value < 253402268399


def valid_source(source, now, *, catalogue=None):
    if not isinstance(source, dict) or not _stamp(now):
        return False
    distribution = source.get('source') == 'PR TIMES'
    if distribution:
        if not _membership_source(source, now, catalogue):
            return False
        name, host, pattern = source['name'], 'prtimes.jp', r'/main/html/rd/p/[0-9]{9}\.[0-9]{9}\.html'
    elif source.get('symbol') in SOURCES:
        name, host, pattern = SOURCES[source['symbol']]
    else:
        return False
    parsed = urlsplit(str(source.get('url', '')))
    if (source.get('name') != name or parsed.scheme != 'https' or parsed.hostname != host
            or parsed.netloc != host or parsed.query or parsed.fragment
            or not re.fullmatch(pattern, parsed.path) or not _day(source.get('published_date'))):
        return False
    for key, minimum, maximum in [('title', 3, 500), ('business', 8, 2000), ('body', 100, 30000)]:
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


def valid_record(record, now, *, catalogue=None):
    if not isinstance(record, dict) or record.get('schema') != 'company-reviewed-v1':
        return False
    source, company = record.get('source'), record.get('company')
    if not valid_source(source, now, catalogue=catalogue) or not isinstance(company, dict):
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


def public_snapshot(records, now, status='ready', checked_at=None, *, storage=None):
    valid = [item['company'] for item in records if valid_record(item, now,
                catalogue=source_catalogue(storage, item.get('source')) if storage else None)
             and item['company']['valid_until'] >= datetime.fromtimestamp(now, JST).date().isoformat()]
    valid.sort(key=lambda item: (item['published_date'], item.get('published_at') or 0,
                                item['reviewed_at']), reverse=True)
    selected, symbols, ids = [], set(), set()
    for company in valid:
        if company['symbol'] in symbols or company['article_id'] in ids:
            continue
        symbols.add(company['symbol']); ids.add(company['article_id'])
        selected.append({**{key: company.get(key) for key in PUBLIC_KEYS}, 'valid_until': company['valid_until']})
        if len(selected) == 225:
            break
    today = datetime.fromtimestamp(now, JST).date().isoformat()
    return {'edition_date': max((datetime.fromtimestamp(item['reviewed_at'], JST).date().isoformat()
                                for item in selected), default=today),
            'valid_until': max((item['valid_until'] for item in selected), default=today),
            'companies': selected, 'status': status, 'checked_at': checked_at,
            'source_interval_seconds': 900, 'max_generation_attempts_per_day': 3}


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
                if not valid_record(record, now, catalogue=source_catalogue(storage, record.get('source'))):
                    raise StorageUnavailable('company_record_invalid')
                if cache is not None:
                    cache[path] = deepcopy(record)
                records.append(deepcopy(record))
    return records


def _candidate_time(deadline):
    if time.monotonic() >= deadline:
        raise StorageUnavailable('company_queue_timeout')


def _candidate_names(storage, prefix, deadline):
    """Company-only pagination; the morning reader's 30-item limit is unchanged."""
    if not isinstance(storage, SupabaseNewsStorage):
        _candidate_time(deadline)
        values = storage._list(prefix)
        _candidate_time(deadline)
        if not isinstance(values, list):
            raise StorageUnavailable('storage_list')
        if len(values) > MAX_CANDIDATES_PER_DAY:
            raise StorageUnavailable('company_queue_limit')
        return values
    items = []
    for offset in range(0, MAX_CANDIDATES_PER_DAY + 1, CANDIDATE_PAGE_SIZE):
        _candidate_time(deadline)
        limit = min(CANDIDATE_PAGE_SIZE, MAX_CANDIDATES_PER_DAY + 1 - offset)
        response = storage._request('POST', '/object/list/' + BUCKET,
            json={'prefix': prefix, 'limit': limit, 'offset': offset,
                  'sortBy': {'column': 'name', 'order': 'desc'}})
        if not 200 <= response.status_code < 300:
            raise StorageUnavailable('storage_list')
        values = storage._payload(response)
        _candidate_time(deadline)
        if not isinstance(values, list) or len(values) > limit:
            raise StorageUnavailable('storage_list')
        items.extend(values)
        if len(items) > MAX_CANDIDATES_PER_DAY:
            raise StorageUnavailable('company_queue_limit')
        if len(values) < limit:
            return items
    raise StorageUnavailable('company_queue_limit')


def _current_catalogue(now):
    from company_news_catalogue import load_current_snapshot
    try:
        return load_current_snapshot(now=datetime.fromtimestamp(now, JST))
    except ValueError:
        return None


def candidate_records(storage, now):
    candidates = []
    deadline = time.monotonic() + CANDIDATE_SCAN_SECONDS
    today = datetime.fromtimestamp(now, JST).date()
    current = _current_catalogue(now)
    if current is None:
        return []
    cache = getattr(storage, '_company_candidate_cache', None)
    if cache is None:
        cache = storage._company_candidate_cache = {}
    prefixes = [f'{PREFIX}/candidates/{(today - timedelta(days=offset)).isoformat()}'
                for offset in range(3)]
    for path in list(cache):
        if path.rsplit('/', 1)[0] not in prefixes:
            del cache[path]
    # Fail before any selection or paid generation if a whole day exceeds the
    # documented cap. A partial page must never look like the complete queue.
    manifests = [(prefix, _candidate_names(storage, prefix, deadline)) for prefix in prefixes]
    for prefix, items in manifests:
        for item in items:
            _candidate_time(deadline)
            name = item.get('name') if isinstance(item, dict) else None
            if not isinstance(name, str) or not re.fullmatch(r'[0-9a-f]{64}\.json', name):
                continue
            path = prefix + '/' + name
            source = deepcopy(cache.get(path))
            if source is None:
                source = storage.read(path)
            if (isinstance(source, dict) and current.is_member(source.get('symbol'))
                    and valid_source(source, now, catalogue=source_catalogue(storage, source, deadline=deadline))
                    and (today - date.fromisoformat(source['published_date'])).days <= 2):
                cache[path] = deepcopy(source)
                candidates.append(source)
            _candidate_time(deadline)
    from company_news_selection import candidate_order
    return sorted(candidates, key=candidate_order)


def pending_candidates(storage, now, *, candidates=None):
    day = datetime.fromtimestamp(now, JST).date().isoformat()
    claims = [storage.read(f'{PREFIX}/days/{day}/attempt-{slot}.json') for slot in range(1, 4)]
    if all(claim is not None for claim in claims):
        return []
    candidates = candidate_records(storage, now) if candidates is None else candidates
    if not candidates:
        return []
    current = _current_catalogue(now)
    if current is None:
        return []
    selected = set(claim['symbol'] for claim in claims if isinstance(claim, dict) and isinstance(claim.get('symbol'), str))
    pending = []
    for source in candidates:
        if (not isinstance(source, dict) or not current.is_member(source.get('symbol'))
                or not valid_source(source, now, catalogue=source_catalogue(storage, source))
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
        self._source_diagnostics = _safe_source_diagnostics(None)
        self._coverage = {'universe': 'nikkei225', 'candidate_company_count': None,
                          'membership_as_of': None, 'direct_feed_company_count': 3,
                          'source_channel_count': len(CHANNEL_NAMES),
                          'distribution_scope': 'issuer_published_releases',
                          'all_company_announcements_covered': False}
        self._collection_health = 'unknown'
        self._last_error_phase, self._last_error_code = None, None
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
        phase = 'storage_check'
        try:
            self.storage.ensure_private()
            collected = False
            collected_candidates = None
            if self.collector and now - self._source_check >= 900:
                self._source_check = now
                self._source_status = 'refreshing'
                phase = 'candidate_read'
                known_sources = candidate_records(self.storage, now)
                known = [source['url'] for source in known_sources]
                phase = 'source_collect'
                result = self.collector(now=now, exclude_urls=known)
                with self._lock:
                    self._source_diagnostics = _safe_source_diagnostics(result.get('diagnostics'))
                sources = result['articles']
                # Verification timestamps are recorded after HTTP completes.
                # A slow successful fetch is not a future source relative to
                # the clock captured before collection began.
                now = self.clock()
                day = datetime.fromtimestamp(now, JST).date().isoformat()
                combined = {source_fingerprint(source): source for source in known_sources}
                phase = 'candidate_write'
                catalogue = result.get('catalogue')
                if catalogue is not None:
                    from company_news_catalogue import load_catalogue
                    verified_catalogue = load_catalogue(snapshot=catalogue, now=datetime.fromtimestamp(now, JST))
                    self.storage.create(_catalogue_path(verified_catalogue.facts_sha256,
                        verified_catalogue.provenance['source_sha256']), catalogue)
                    with self._lock:
                        self._coverage.update(candidate_company_count=len(verified_catalogue.members),
                            membership_as_of=verified_catalogue.provenance['as_of'])
                with self._lock:
                    health = result.get('collection_health')
                    self._collection_health = health if health in ('complete', 'partial') else 'unknown'
                for source in sources:
                    if valid_source(source, now, catalogue=source_catalogue(self.storage, source)):
                        self.storage.create(f'{PREFIX}/candidates/{day}/{source_fingerprint(source)}.json', source)
                        combined[source_fingerprint(source)] = source
                self._source_status = result.get('status')
                self._source_check = now
                collected = True
                from company_news_selection import candidate_order
                collected_candidates = sorted(combined.values(), key=candidate_order)
            now = self.clock()
            day = datetime.fromtimestamp(now, JST).date().isoformat()
            with self._lock:
                previous = deepcopy(self._records)
                waiting = deepcopy(self._candidates)
            restored = self._restore_day != day or now - self._last_restore >= 900
            phase = 'publication_read'
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
                phase = 'candidate_read'
                waiting = collected_candidates if collected_candidates is not None else candidate_records(self.storage, now)
            # Only cached waiting candidates need claim/seen checks each minute;
            # old queue manifests and historical editions are read periodically.
            phase = 'claim_read'
            pending = pending_candidates(self.storage, now, candidates=waiting)
            if records != previous:
                phase = 'cache_write'
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
                self._last_error_phase = None if self._status == 'ready' else 'source_collect'
                self._last_error_code = None if self._status == 'ready' else 'source_collection_failed'
        except Exception as error:
            with self._lock:
                self._status = 'error'
                self._last_error_phase = phase
                self._last_error_code = (str(error) if isinstance(error, StorageUnavailable)
                    and str(error) in STORAGE_ERROR_CODES else 'runtime_failed')

    def snapshot(self):
        with self._lock:
            return {**public_snapshot(deepcopy(self._records), self.clock(), self._status, self._checked,
                                   storage=self.storage), 'coverage': deepcopy(self._coverage),
                    'collection_health': self._collection_health}

    def operational_snapshot(self):
        with self._lock:
            now = self.clock()
            current = _current_catalogue(now)
            pending = [source for source in self._pending if current is not None
                        and current.is_member(source.get('symbol')) and valid_source(source, now,
                        catalogue=source_catalogue(self.storage, source))]
            fingerprints = sorted(source_fingerprint(source) for source in pending)
            return {'status': self._status, 'checked_at': self._checked,
                    'source_diagnostics': deepcopy(self._source_diagnostics),
                    'coverage': deepcopy(self._coverage), 'collection_health': self._collection_health,
                    'last_error_phase': self._last_error_phase, 'last_error_code': self._last_error_code,
                    'pending_count': len(pending),
                    'batch_id': canonical_hash(fingerprints) if fingerprints else None,
                    'sources': list(CHANNEL_NAMES),
                    'writer_provider': 'codex_subscription', 'generation_owner': 'external',
                    'source_interval_seconds': 900, 'max_generation_attempts_per_day': 3}

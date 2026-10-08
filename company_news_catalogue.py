"""Verified Nikkei constituent identities and explicitly registered news routes.

Membership is independent of news coverage. An absent reviewed business stays
unknown, and a company name never grants permission to fetch an arbitrary URL.
"""
from copy import deepcopy
from datetime import date, datetime
from hashlib import sha256
import ipaddress
import json
import math
from pathlib import Path
import re
from threading import RLock
import unicodedata
from urllib.parse import urlsplit

from news_cache import JST


ROOT = Path(__file__).resolve().parent
UNIVERSE_PATH = ROOT / 'static' / 'nikkei225-universe.json'
EDITORIAL_PATH = ROOT / 'static' / 'company-profile-editorial.json'
CURRENT_UNIVERSE_PATH = Path('/tmp/kn-company-news-universe.json')
_CURRENT_CACHE, _SNAPSHOT_CACHE = {}, {}
_CATALOGUE_LOCK, _CURRENT_LOCK = RLock(), RLock()
SOURCE_URL = 'https://indexes.nikkei.co.jp/nkave/archives/file/nikkei_225_price_adjustment_factor_jp.csv'
COMPONENT_URL = 'https://indexes.nikkei.co.jp/nkave/index/component?idx=nk225'
CODE_RE = re.compile(r'[1-9][0-9A-Z]{3}')
SYMBOL_RE = re.compile(r'[1-9][0-9A-Z]{3}\.T')
HOST_RE = re.compile(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+'
                     r'[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?')


def _day(value):
    try:
        parsed = date.fromisoformat(value)
        return parsed if parsed.isoformat() == value else None
    except (TypeError, ValueError):
        return None


def _today(now):
    if now is None:
        return datetime.now(JST).date()
    if type(now) is date:
        return now
    if isinstance(now, datetime):
        if now.tzinfo is None:
            raise ValueError('company_catalogue_clock_invalid')
        return now.astimezone(JST).date()
    if type(now) in (int, float) and math.isfinite(now) and 0 < now < 253402268399:
        return datetime.fromtimestamp(now, JST).date()
    raise ValueError('company_catalogue_clock_invalid')


def normalize_issuer_name(value):
    """Normalize formatting and edge corporate markers, never a guessed alias."""
    if (not isinstance(value, str) or not 1 <= len(value) <= 300
            or any(ord(char) < 32 and not char.isspace() for char in value)
            or any(0xD800 <= ord(char) <= 0xDFFF for char in value)):
        return None
    name = re.sub(r'\s+', '', unicodedata.normalize('NFKC', value))
    if re.match(r'^(?:株式会社|\(株\))', name):
        name = re.sub(r'^(?:株式会社|\(株\))', '', name, count=1)
    else:
        name = re.sub(r'(?:株式会社|\(株\))$', '', name, count=1)
    return name or None


def _closed_https_url(value):
    if (not isinstance(value, str) or not 1 <= len(value) <= 2048
            or any(ord(char) < 33 or ord(char) == 127 for char in value) or '\\' in value):
        return None
    try:
        parsed = urlsplit(value)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.netloc != parsed.hostname
                or parsed.username is not None or parsed.password is not None
                or not HOST_RE.fullmatch(parsed.hostname)
                or parsed.query or parsed.fragment or not parsed.path.startswith('/')):
            return None
        return parsed
    except ValueError:
        return None


def _read_editorial(path, today, names):
    if path is None:
        return {}
    try:
        raw = json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError, TypeError):
        return {}
    if not isinstance(raw, dict) or raw.get('schema_version') != 1 or not isinstance(raw.get('items'), list):
        return {}
    reviewed, duplicates = {}, set()
    for row in raw['items']:
        if not isinstance(row, dict):
            continue
        symbol, business, day = row.get('symbol'), row.get('business'), _day(row.get('reviewed_on'))
        sources = row.get('sources')
        if (not isinstance(symbol, str) or not SYMBOL_RE.fullmatch(symbol)
                or ('name' in row and normalize_issuer_name(row['name']) != normalize_issuer_name(names.get(symbol)))
                or not isinstance(business, str) or not 8 <= len(business.strip()) <= 2000
                or '\x00' in business or any(0xD800 <= ord(char) <= 0xDFFF for char in business)
                or day is None or day > today or not isinstance(sources, list) or not 1 <= len(sources) <= 20):
            continue
        clean_sources = []
        for source in sources:
            if (not isinstance(source, dict) or _closed_https_url(source.get('url')) is None
                    or not isinstance(source.get('title'), str) or not 1 <= len(source['title'].strip()) <= 400):
                break
            clean_sources.append({'title': source['title'].strip(), 'url': source['url']})
        if len(clean_sources) != len(sources):
            continue
        if symbol in reviewed:
            duplicates.add(symbol)
        reviewed[symbol] = {'business': business.strip(), 'business_url': clean_sources[0]['url'],
                            'business_sources': clean_sources, 'business_reviewed_on': day.isoformat()}
    return {symbol: value for symbol, value in reviewed.items() if symbol not in duplicates}


class CompanyNewsCatalogue:
    def __init__(self, members, provenance):
        self._members, self._provenance = deepcopy(members), deepcopy(provenance)
        self._issuers = {}
        for symbol, member in self._members.items():
            name = normalize_issuer_name(member['name'])
            if name:
                self._issuers.setdefault(name, set()).add(symbol)

    @property
    def members(self):
        return deepcopy(self._members)

    @property
    def provenance(self):
        return deepcopy(self._provenance)

    def is_member(self, symbol):
        return isinstance(symbol, str) and symbol in self._members

    def match_issuer(self, issuer):
        symbols = self._issuers.get(normalize_issuer_name(issuer), set())
        return deepcopy(self._members[next(iter(symbols))]) if len(symbols) == 1 else None

    def _facts(self):
        return {'index': 'nikkei225', 'as_of': self._provenance['as_of'],
                'items': [{key: self._members[symbol][key] for key in ('code', 'symbol', 'name')}
                          for symbol in sorted(self._members)]}

    @property
    def facts_sha256(self):
        return sha256(json.dumps(self._facts(), ensure_ascii=False, sort_keys=True,
                                 separators=(',', ':'), allow_nan=False).encode()).hexdigest()

    def snapshot(self):
        return {'schema_version': 1, **self._facts(), 'retrieved_at': self._provenance['retrieved_at'],
                'source': {'url': SOURCE_URL, 'component_url': COMPONENT_URL,
                           'sha256': self._provenance['source_sha256']}}


def load_catalogue(universe_path=UNIVERSE_PATH, editorial_path=EDITORIAL_PATH, *, now=None, grace_days=14,
                   snapshot=None):
    """Load constituent facts, preserving their original dated provenance."""
    today = _today(now)
    if type(grace_days) is not int or not 0 <= grace_days <= 366:
        raise ValueError('company_catalogue_grace_invalid')
    if snapshot is not None:
        raw = deepcopy(snapshot)
    else:
        try:
            raw = json.loads(Path(universe_path).read_text(encoding='utf-8'))
        except (OSError, ValueError, TypeError):
            raise ValueError('company_universe_unavailable') from None
    if not isinstance(raw, dict) or raw.get('schema_version') != 1 or raw.get('index') != 'nikkei225':
        raise ValueError('company_universe_invalid')
    as_of = _day(raw.get('as_of'))
    if as_of is None or as_of > today:
        raise ValueError('company_universe_date_invalid')
    if (today - as_of).days > grace_days:
        raise ValueError('company_universe_stale')
    try:
        retrieved = datetime.fromisoformat(raw['retrieved_at'].replace('Z', '+00:00'))
        if retrieved.tzinfo is None or not as_of <= retrieved.astimezone(JST).date() <= today:
            raise ValueError()
    except (KeyError, AttributeError, TypeError, ValueError):
        raise ValueError('company_universe_provenance_invalid') from None
    source, items = raw.get('source'), raw.get('items')
    if (not isinstance(source, dict) or source.get('url') != SOURCE_URL
            or source.get('component_url') != COMPONENT_URL
            or not isinstance(source.get('sha256'), str) or not re.fullmatch(r'[0-9a-f]{64}', source['sha256'])
            or not isinstance(items, list) or len(items) != 225):
        raise ValueError('company_universe_invalid')
    names = {row['symbol']: row.get('name') for row in items
             if isinstance(row, dict) and isinstance(row.get('symbol'), str)}
    editorial = _read_editorial(editorial_path, today, names)
    members = {}
    for row in items:
        if not isinstance(row, dict):
            raise ValueError('company_universe_member_invalid')
        code, symbol, name = row.get('code'), row.get('symbol'), row.get('name')
        if (not isinstance(code, str) or not CODE_RE.fullmatch(code) or symbol != code + '.T'
                or symbol in members or not isinstance(name, str) or not 1 <= len(name.strip()) <= 160
                or any(ord(char) < 32 or ord(char) == 127 for char in name)
                or normalize_issuer_name(name) is None):
            raise ValueError('company_universe_member_invalid')
        member = {'code': code, 'symbol': symbol, 'name': name.strip(), 'business': None,
                  'business_url': None, 'business_sources': [], 'business_reviewed_on': None}
        member.update(editorial.get(symbol, {}))
        members[symbol] = member
    provenance = {'index': 'nikkei225', 'as_of': as_of.isoformat(), 'retrieved_at': raw['retrieved_at'],
                  'source_url': SOURCE_URL, 'source_sha256': source['sha256'], 'member_count': len(members)}
    return CompanyNewsCatalogue(members, provenance)


def _file_version(path):
    if path is None:
        return None
    try:
        item = Path(path).stat()
        return str(Path(path)), item.st_mtime_ns, item.st_size
    except OSError:
        return str(Path(path)), None


def load_current_snapshot(now=None, *, cache_path=CURRENT_UNIVERSE_PATH, seed_path=UNIVERSE_PATH,
                          editorial_path=EDITORIAL_PATH, grace_days=14):
    """Read the latest fresh local facts without ever fetching a source."""
    today = _today(now)
    if type(grace_days) is not int or not 0 <= grace_days <= 366:
        raise ValueError('company_catalogue_grace_invalid')
    key = (_file_version(cache_path), _file_version(seed_path), _file_version(editorial_path),
           today.isoformat(), grace_days)
    with _CATALOGUE_LOCK:
        if key in _SNAPSHOT_CACHE:
            return _SNAPSHOT_CACHE[key]
        candidates = []
        for path in (cache_path, seed_path):
            if path is None:
                continue
            try:
                candidates.append(load_catalogue(path, editorial_path, now=now, grace_days=grace_days))
            except ValueError:
                continue
        if not candidates:
            raise ValueError('company_universe_unavailable')
        selected = max(candidates, key=lambda candidate:
            (candidate.provenance['as_of'], candidate.provenance['retrieved_at']))
        _SNAPSHOT_CACHE.clear()
        _SNAPSHOT_CACHE[key] = selected
        return selected


def current_catalogue(now=None, *, cache_path=CURRENT_UNIVERSE_PATH, seed_path=UNIVERSE_PATH,
                      editorial_path=EDITORIAL_PATH, grace_days=14, updater=None):
    """At most one bounded official refresh per JST date in this process."""
    today = _today(now)
    if type(grace_days) is not int or not 0 <= grace_days <= 366:
        raise ValueError('company_catalogue_grace_invalid')
    key = (str(cache_path), str(seed_path), str(editorial_path), grace_days)
    with _CURRENT_LOCK:
        cached = _CURRENT_CACHE.get(key)
        if cached and cached[0] == today:
            if cached[1] is None:
                raise ValueError('company_universe_unavailable')
            return cached[1]
        try:
            previous = load_current_snapshot(now, cache_path=cache_path, seed_path=seed_path,
                                             editorial_path=editorial_path, grace_days=grace_days)
        except ValueError:
            previous = None
        current = previous
        verified_today = bool(previous and (previous.provenance['as_of'] == today.isoformat()
            or datetime.fromisoformat(previous.provenance['retrieved_at'].replace('Z', '+00:00'))
                .astimezone(JST).date() == today))
        if not verified_today:
            if updater is None:
                from scripts.update_nikkei225 import update_universe
                updater = update_universe
            stamp = (now.astimezone(JST) if isinstance(now, datetime) else
                     datetime.fromtimestamp(now, JST) if type(now) in (int, float) else
                     datetime.combine(today, datetime.min.time(), JST) if type(now) is date else datetime.now(JST))
            try:
                updater(output_path=cache_path, now=stamp)
                updated = load_catalogue(cache_path, editorial_path, now=now, grace_days=grace_days)
                if (datetime.fromisoformat(updated.provenance['retrieved_at'].replace('Z', '+00:00'))
                        .astimezone(JST).date() != today
                        or previous and updated.provenance['as_of'] < previous.provenance['as_of']):
                    raise ValueError('company_universe_refresh_invalid')
                current = updated
                verified_today = True
            except Exception:
                # update_universe validates before an atomic replace. Neither an
                # outage nor an invalid response can erase the previous facts.
                current = previous
        if current is None:
            _CURRENT_CACHE[key] = (today, None)
            raise ValueError('company_universe_unavailable')
        result = CompanyNewsCatalogue(current.members,
                                      {**current.provenance, 'verified_today': verified_today})
        for old_key in list(_CURRENT_CACHE):
            if _CURRENT_CACHE[old_key][0] != today:
                del _CURRENT_CACHE[old_key]
        _CURRENT_CACHE[key] = (today, result)
        return result


def validate_source_config(config, catalogue=None):
    """Validate a trusted registered route; membership alone grants no URL."""
    if not isinstance(config, dict):
        raise ValueError('company_source_config_invalid')
    source_id, symbol, host, pattern = (config.get(key) for key in ('source_id', 'symbol', 'host', 'path_pattern'))
    if (not isinstance(source_id, str) or not re.fullmatch(r'[a-z][a-z0-9_-]{0,49}', source_id)
            or not isinstance(symbol, str) or not SYMBOL_RE.fullmatch(symbol)
            or not isinstance(host, str) or len(host) > 253 or not HOST_RE.fullmatch(host)
            or not isinstance(pattern, str) or not 1 <= len(pattern) <= 500 or not pattern.startswith('/')):
        raise ValueError('company_source_config_invalid')
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ValueError('company_source_config_invalid')
    if catalogue is not None and (not isinstance(catalogue, CompanyNewsCatalogue) or not catalogue.is_member(symbol)):
        raise ValueError('company_source_not_member')
    try:
        re.compile(pattern)
    except re.error:
        raise ValueError('company_source_config_invalid') from None
    return {'source_id': source_id, 'symbol': symbol, 'host': host, 'path_pattern': pattern}


def source_url_matches(url, config, *, source_id, symbol):
    try:
        registered = validate_source_config(config)
    except ValueError:
        return False
    if source_id != registered['source_id'] or symbol != registered['symbol']:
        return False
    parsed = _closed_https_url(url)
    return bool(parsed and parsed.hostname == registered['host']
                and re.fullmatch(registered['path_pattern'], parsed.path))

"""Fixed private evidence of normal collection, never publication approval.

Projection and paths are pure. registered_context reads only the fixed local
registry/parser files; read_slots is an explicit, small private-monitor read.
Nothing here starts a collector, downloads a source, or invokes a reviewer.
"""
from copy import deepcopy
from datetime import date, datetime
from hashlib import sha256
import inspect
import json
import math
from pathlib import Path
import re
import time

from news_cache import JST
from company_news_route_schedule import select_route_schedule

PREFIX = 'company-news/v1/collection-checks'
MAX_BYTES = 128_000
MAX_ROUTES = 227
MAX_SCHEDULED = 39
MAX_READ_SLOTS = 8
READ_SECONDS = 4
WRITE_SECONDS = 2
COUNTERS = ('candidates', 'selected', 'completed', 'accepted', 'returned')
FEED_STATES = frozenset({'ok', 'failed', 'not_completed'})
STATES = frozenset({'fetch_incomplete', 'feed_failed', 'no_matching_candidates',
                    'collected', 'collected_partial', 'articles_unavailable'})
ERRORS = frozenset({'unapproved_source', 'source_time_limit', 'source_unavailable',
    'unapproved_redirect', 'source_content_type', 'source_size_limit', 'source_size_or_time_limit',
    'unsupported_feed_declaration', 'unsupported_feed_structure', 'unsupported_source_encoding',
    'invalid_verification_clock', 'source_read_failed', 'body_or_date_unverified',
    'source_dns_failed', 'source_tls_failed', 'source_timeout', 'source_connection_failed',
    'source_rate_wait', 'source_refused', 'source_backoff_unavailable'})
SOURCE_FILES = (
    'company_news_collection_checks.py', 'company_news_runtime.py', 'company_news_sources.py',
    'company_news_additional.py', 'company_news_official_html.py', 'company_news_issuer_feeds.py',
    'company_news_prtimes.py', 'company_news_route_schedule.py', 'company_news_selection.py',
    'company_news_catalogue.py', 'company_news_expanded_routes.py', 'daily_news_sources.py',
    'official_news_sources.py', 'company_news_nintendo.py', 'company_news_kline_mmc.py',
    'company_news_cyberagent.py', 'company_news_komatsu.py', 'company_news_mitsubishi_corp.py',
    'company_news_suzuki.py', 'company_news_yokohama.py',
    'company_news_isuzu.py',
    'static/company-news-expanded-routes.json',
)
OPTIONAL_ADAPTER_FILES = frozenset({'company_news_nintendo.py', 'company_news_kline_mmc.py',
    'company_news_cyberagent.py', 'company_news_komatsu.py', 'company_news_mitsubishi_corp.py',
    'company_news_suzuki.py', 'company_news_yokohama.py'})
_HASH = re.compile(r'[0-9a-f]{64}')


def _encoded(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':'),
                      allow_nan=False).encode()


def _hash(value):
    return sha256(_encoded(value)).hexdigest()


def _stamp(value):
    return type(value) in (int, float) and math.isfinite(value) and 0 < value < 253402268399


def context_from_registry(routes, *, source_sha256, catalogue_sha256, catalogue_source_sha256):
    """Bind trusted descriptors, not fields supplied by collector diagnostics."""
    from urllib.parse import urlsplit
    if (type(routes) is not dict or not 1 <= len(routes) <= MAX_ROUTES
            or any(type(v) is not str or not _HASH.fullmatch(v) for v in
                   (source_sha256, catalogue_sha256, catalogue_source_sha256))):
        raise ValueError('collection_check_registry')
    clean = {}
    for label, row in sorted(routes.items()):
        if (type(label) is not str or not 1 <= len(label) <= 200 or label != label.strip()
                or any(ord(c) < 32 or ord(c) == 127 for c in label) or type(row) is not dict
                or set(row) != {'symbol', 'feed_url', 'config_sha256', 'expansion'}
                or type(row['expansion']) is not bool
                or type(row['config_sha256']) is not str or not _HASH.fullmatch(row['config_sha256'])
                or row['symbol'] is not None and (type(row['symbol']) is not str
                    or not re.fullmatch(r'[1-9][0-9A-Z]{3}\.T', row['symbol']))
                or row['symbol'] is None and label != 'PR TIMES'):
            raise ValueError('collection_check_registry')
        url = row['feed_url']
        if (type(url) is not str or not 1 <= len(url) <= 2048 or '\\' in url
                or any(ord(c) < 33 or ord(c) == 127 for c in url)):
            raise ValueError('collection_check_registry')
        parsed = urlsplit(url)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username is not None
                or parsed.password is not None or parsed.port not in (None, 443) or parsed.fragment):
            raise ValueError('collection_check_registry')
        clean[label] = dict(row)
    manifest = dict(routes=clean, source_sha256=source_sha256, catalogue_sha256=catalogue_sha256,
                    catalogue_source_sha256=catalogue_source_sha256, schema_version=1)
    return {**manifest, 'registry_sha256': _hash(clean), 'fingerprint': _hash(manifest)}


def local_registry():
    """Registry/parser identity without membership refresh or collection I/O.

    These module imports define parsers/config and an in-memory backoff object;
    no worker, source collector, catalogue updater or paid writer is started.
    """
    from company_news_sources import FEEDS, SOURCES
    from company_news_additional import SOURCES as additional
    from company_news_issuer_feeds import SOURCES as issuers, EXPANSION_CHANNELS
    root = Path(__file__).resolve().parent
    hashes = {}
    for name in SOURCE_FILES:
        try:
            with (root / name).open('rb') as stream:
                payload = stream.read(1_000_001)
        except FileNotFoundError:
            if name not in OPTIONAL_ADAPTER_FILES:
                raise
            hashes[name] = None  # Explicitly absent optional adapter is a distinct version.
            continue
        if len(payload) > 1_000_000:
            raise ValueError('collection_check_registry')
        hashes[name] = sha256(payload).hexdigest()
    routes = {}
    for label, url in FEEDS.items():
        config = SOURCES.get(label) or additional.get(label) or issuers.get(label)
        if config is None and label != 'PR TIMES':
            raise ValueError('collection_check_registry')
        routes[label] = dict(symbol=config['symbol'] if config else None, feed_url=url,
            config_sha256=_hash(config or {'provider': 'PR TIMES', 'scope': 'global_multiple_issuers'}),
            expansion=label in EXPANSION_CHANNELS or additional.get(label, {}).get('expansion_route') is True)
    return {'routes': routes, 'source_sha256': _hash(hashes)}


def registered_context(reference_at):
    """Read only fixed local parser/config bytes and the current membership."""
    from company_news_catalogue import load_current_snapshot
    if not _stamp(reference_at):
        raise ValueError('collection_check_clock')
    registry = local_registry()
    catalogue = load_current_snapshot(now=reference_at)
    return context_from_registry(registry['routes'], source_sha256=registry['source_sha256'],
        catalogue_sha256=catalogue.facts_sha256,
        catalogue_source_sha256=catalogue.provenance['source_sha256'])


def context_for_result(registry, result, *, reference_at):
    """Bind the collector's actual membership, including its normal refresh.

    Use the same reference day as collection. A later finish clock must not
    authorize a next-day membership snapshot for a prior-day collection.
    This validates saved bytes only; it never refreshes the local catalogue.
    """
    from company_news_catalogue import load_catalogue
    if (type(registry) is not dict or type(result) is not dict or not _stamp(reference_at)
            or type(result.get('catalogue')) is not dict):
        raise ValueError('collection_check_catalogue')
    catalogue = load_catalogue(snapshot=result['catalogue'], editorial_path=None, now=reference_at)
    return context_from_registry(registry.get('routes'), source_sha256=registry.get('source_sha256'),
        catalogue_sha256=catalogue.facts_sha256,
        catalogue_source_sha256=catalogue.provenance['source_sha256'])


def _context(context):
    if type(context) is not dict:
        raise ValueError('collection_check_registry')
    rebuilt = context_from_registry(context.get('routes'),
        source_sha256=context.get('source_sha256'), catalogue_sha256=context.get('catalogue_sha256'),
        catalogue_source_sha256=context.get('catalogue_source_sha256'))
    if context != rebuilt:
        raise ValueError('collection_check_registry')
    return rebuilt


def slot_path(fingerprint, started_at):
    if type(fingerprint) is not str or not _HASH.fullmatch(fingerprint) or not _stamp(started_at):
        raise ValueError('collection_check_path')
    stamp = datetime.fromtimestamp(started_at, JST)
    slot = (stamp.hour * 60 + stamp.minute) // 15
    return f'{PREFIX}/{fingerprint}/{stamp.date().isoformat()}/slot-{slot:02d}.json'


def _scheduled(context, reference_at):
    base, extra = {}, {}
    for label, row in context['routes'].items():
        (extra if row['expansion'] else base)[label] = row['feed_url']
    labels = sorted(select_route_schedule(base, extra, reference_at)['feeds'])
    if len(labels) > MAX_SCHEDULED:
        raise ValueError('collection_check_registry')
    return labels


def _empty_row():
    return dict(feed_status='not_completed', status='fetch_incomplete',
                **dict.fromkeys(COUNTERS, 0), errors=['source_read_failed'], diagnostics_valid=False)


def _row(value):
    if type(value) is not dict:
        return _empty_row()
    feed, status, errors = value.get('feed_status'), value.get('status'), value.get('errors')
    counts = [value.get(key) for key in COUNTERS]
    if (type(feed) is not str or feed not in FEED_STATES or type(status) is not str or status not in STATES
            or any(type(v) is not int or v < 0 or v > maximum for v, maximum in zip(counts, (200, 8, 8, 3, 3)))
            or not counts[4] <= counts[3] <= counts[2] <= counts[1]
            or counts[1] > counts[0] or type(errors) not in (list, tuple) or len(errors) > len(ERRORS)
            or feed != 'ok' and any(counts)
            or feed == 'not_completed' and status != 'fetch_incomplete'
            or feed == 'failed' and status != 'feed_failed'
            or feed == 'ok' and status in ('feed_failed',)):
        return _empty_row()
    clean_errors = sorted({code if type(code) is str and code in ERRORS else 'source_read_failed'
                           for code in errors})
    return dict(feed_status=feed, status=status, **dict(zip(COUNTERS, counts)),
                errors=clean_errors, diagnostics_valid=True)


def project(context, result, *, reference_at, started_at, finished_at):
    """Use real collection clocks and only the scheduled fixed registry rows."""
    context = _context(context)
    if (not all(_stamp(v) for v in (reference_at, started_at, finished_at))
            or not reference_at <= started_at <= finished_at):
        raise ValueError('collection_check_clock')
    result = result if type(result) is dict else {}
    diagnostics = result.get('diagnostics')
    diagnostics = diagnostics if type(diagnostics) is dict else {}
    rows = []
    for label in _scheduled(context, reference_at):
        rows.append(dict(source=label, **{k: v for k, v in context['routes'][label].items() if k != 'expansion'},
                         **_row(diagnostics.get(label))))
    if sum(row['selected'] for row in rows) > 8 or sum(row['returned'] for row in rows) > 3:
        rows = [dict(source=row['source'], **{k: row[k] for k in ('symbol', 'feed_url', 'config_sha256')},
                     **_empty_row()) for row in rows]
    stamp = datetime.fromtimestamp(started_at, JST)
    status = result.get('status')
    value = dict(schema_version=1, record_kind='company_collection_check',
        **{key: context[key] for key in ('fingerprint', 'registry_sha256', 'source_sha256',
            'catalogue_sha256', 'catalogue_source_sha256')},
        reference_at=reference_at, started_at=started_at, finished_at=finished_at,
        day=stamp.date().isoformat(), slot=(stamp.hour * 60 + stamp.minute) // 15,
        registered_route_count=len(context['routes']), scheduled_route_count=len(rows),
        invalid_row_count=sum(not row['diagnostics_valid'] for row in rows), rows=rows,
        collection_status=status if type(status) is str and status in ('ready', 'source_empty', 'error') else 'error')
    if len(_encoded(value)) > MAX_BYTES:
        raise ValueError('collection_check_size')
    return value


def _call(method, path, value=None, *, deadline, clock):
    """No timeout thread and no TypeError retry that could duplicate a write."""
    parameters = inspect.signature(method).parameters
    variadic = any(p.kind == p.VAR_KEYWORD for p in parameters.values())
    options = {}
    if variadic or 'deadline' in parameters:
        options['deadline'] = deadline
    if variadic or 'clock' in parameters:
        options['clock'] = clock
    return method(path, **options) if value is None else method(path, value, **options)


def write_once(storage, record, *, context, clock=time.monotonic):
    """Optional advisory write; its failure never changes the article result."""
    try:
        if not validate(record, context, record.get('finished_at') if type(record) is dict else None):
            return 'unavailable'
        path = slot_path(record['fingerprint'], record['started_at'])
        result = _call(storage.create, path, record, deadline=clock() + WRITE_SECONDS, clock=clock)
        return 'stored' if result is True else 'duplicate_unconfirmed' if result is False else 'unavailable'
    except Exception:
        return 'unavailable'


def validate(record, context, now):
    """Strictly authenticate a saved slot to the supplied current local context."""
    try:
        context = _context(context)
        if (type(record) is not dict or not _stamp(now) or len(_encoded(record)) > MAX_BYTES
                or any(type(record.get(key)) is not int for key in ('schema_version', 'slot',
                    'registered_route_count', 'scheduled_route_count', 'invalid_row_count'))
                or not _stamp(record.get('finished_at')) or record['finished_at'] > now):
            return False
        rows = record['rows']
        if type(rows) is not list or len(rows) > MAX_SCHEDULED:
            return False
        diagnostics = {}
        for row in rows:
            if (type(row) is not dict or type(row.get('source')) is not str or row['source'] in diagnostics
                    or type(row.get('diagnostics_valid')) is not bool
                    or any(type(row.get(key)) is not int for key in COUNTERS)):
                return False
            diagnostics[row['source']] = row
        rebuilt = project(context, dict(status=record['collection_status'], diagnostics=diagnostics),
            reference_at=record['reference_at'], started_at=record['started_at'], finished_at=record['finished_at'])
        for original, expected in zip(rows, rebuilt['rows']):
            if original.get('diagnostics_valid') is False:
                expected.update(_empty_row())
        rebuilt['invalid_row_count'] = sum(not row['diagnostics_valid'] for row in rebuilt['rows'])
        return record == rebuilt
    except (KeyError, TypeError, ValueError, OverflowError):
        return False


def read_slots(storage, context, day, slots, *, now, deadline, clock=time.monotonic):
    """Explicit private-monitor batch: at most eight fixed keys, no listing."""
    context = _context(context)
    if not _stamp(now) or type(day) is not str:
        raise ValueError('collection_check_path')
    try:
        dated = date.fromisoformat(day)
    except ValueError:
        raise ValueError('collection_check_path') from None
    if (dated.isoformat() != day or not 0 <= (datetime.fromtimestamp(now, JST).date() - dated).days < 3
            or type(slots) not in (list, tuple) or not 1 <= len(slots) <= MAX_READ_SLOTS
            or any(type(slot) is not int or not 0 <= slot < 96 for slot in slots)
            or len(set(slots)) != len(slots) or type(deadline) not in (int, float) or not math.isfinite(deadline)):
        raise ValueError('collection_check_path')
    end = min(deadline, clock() + READ_SECONDS)
    result = dict(records=[], missing_slots=[], invalid_slots=[], unread_slots=[], read_count=0)
    for slot in slots:
        if clock() >= end:
            result['unread_slots'].append(slot)
            continue
        path = f'{PREFIX}/{context["fingerprint"]}/{day}/slot-{slot:02d}.json'
        try:
            result['read_count'] += 1
            value = _call(storage.read, path, deadline=min(end, clock() + WRITE_SECONDS), clock=clock)
            if clock() > end:
                result['unread_slots'].append(slot)
            elif value is None:
                result['missing_slots'].append(slot)
            elif not validate(value, context, now) or value['day'] != day or value['slot'] != slot:
                result['invalid_slots'].append(slot)
            else:
                result['records'].append(deepcopy(value))
        except Exception:
            result['unread_slots'].append(slot)
    return result


def read_expected_slots(storage, registry, fingerprint, day, slots, *, now, deadline, clock=time.monotonic):
    """CI reader: opaque catalogue hashes bind the expected version, not freshness.

    The private monitor supplies the observed server fingerprint. Local fixed
    registry/parser identity must match; a stale CI membership seed is never
    refreshed or used to fabricate a current membership verification.
    """
    if (type(fingerprint) is not str or not _HASH.fullmatch(fingerprint)
            or not _stamp(now) or type(day) is not str or type(registry) is not dict):
        raise ValueError('collection_check_path')
    try:
        dated = date.fromisoformat(day)
    except ValueError:
        raise ValueError('collection_check_path') from None
    today = datetime.fromtimestamp(now, JST)
    current_slot = (today.hour * 60 + today.minute) // 15
    if (dated.isoformat() != day or not 0 <= (today.date() - dated).days < 3
            or type(slots) not in (list, tuple) or not 1 <= len(slots) <= MAX_READ_SLOTS
            or any(type(slot) is not int or not 0 <= slot < 96 for slot in slots)
            or len(set(slots)) != len(slots) or dated == today.date() and max(slots) > current_slot
            or type(deadline) not in (int, float) or not math.isfinite(deadline)):
        raise ValueError('collection_check_path')
    # Validate local descriptors before any authenticated reads.
    context_from_registry(registry.get('routes'), source_sha256=registry.get('source_sha256'),
                          catalogue_sha256='0' * 64, catalogue_source_sha256='0' * 64)
    end = min(deadline, clock() + READ_SECONDS)
    result = dict(records=[], missing_slots=[], invalid_slots=[], unread_slots=[], read_count=0)
    for slot in slots:
        if clock() >= end:
            result['unread_slots'].append(slot)
            continue
        path = f'{PREFIX}/{fingerprint}/{day}/slot-{slot:02d}.json'
        try:
            result['read_count'] += 1
            value = _call(storage.read, path, deadline=min(end, clock() + WRITE_SECONDS), clock=clock)
            if clock() > end:
                result['unread_slots'].append(slot)
            elif value is None:
                result['missing_slots'].append(slot)
            elif type(value) is not dict:
                result['invalid_slots'].append(slot)
            else:
                context = context_from_registry(registry['routes'], source_sha256=registry['source_sha256'],
                    catalogue_sha256=value.get('catalogue_sha256'),
                    catalogue_source_sha256=value.get('catalogue_source_sha256'))
                if (context['fingerprint'] != fingerprint or not validate(value, context, now)
                        or value['day'] != day or value['slot'] != slot):
                    result['invalid_slots'].append(slot)
                else:
                    result['records'].append(deepcopy(value))
        except (KeyError, TypeError, ValueError, OverflowError):
            result['invalid_slots'].append(slot)
        except Exception:
            result['unread_slots'].append(slot)
    return result

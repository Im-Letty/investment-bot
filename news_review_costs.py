"""Private review usage receipts. Ten yen is a target, never a delivery gate.

No prompts, responses, credentials or provider request IDs enter this store.
USD estimates use the published text rates checked on 2026-10-11. JPY is an
internal estimate at October's BOJ reference rate, not the card's exchange rate
or a tax-inclusive invoice. Unknown usage remains unknown across restarts.
"""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from hashlib import sha256
import json
import math
import os
import re
from threading import RLock
import time

JST = timezone(timedelta(hours=9))
PREFIX = 'review-usage/v1'
PRICING_VERSION = '2026-10-11-text-standard'
TARGET_JPY = 10
USD_TO_JPY = 159
RATE_SOURCES = {
    'openai': 'https://developers.openai.com/api/docs/models/gpt-6-luna',
    'gemini': 'https://ai.google.dev/gemini-api/docs/pricing',
    'fx': 'https://www.boj.or.jp/about/services/tame/tame_rate/kijun/kiju2610.htm',
}
_SCOPES = {'economy', 'company', 'private_test'}
_ID = re.compile(r'[0-9a-f]{32}')
_MODEL = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,99}')
_PROVIDERS = ('gemini', 'openai')
_PRICED_MODELS = {'gemini': 'gemini-2.5-flash', 'openai': 'gpt-6-luna'}
_REASONS = frozenset(('usage_unavailable', 'usage_invalid', 'usage_incomplete',
                     'usage_inconsistent', 'pricing_unavailable', 'usage_not_recorded',
                     'unclassified_unknown'))
_BASES = frozenset(('unknown', 'standard_text', 'conservative_cache_write'))
_TIERS = {'gemini': frozenset(('STANDARD', 'FLEX', 'PRIORITY', 'SERVICE_TIER_UNSPECIFIED')),
          'openai': frozenset(('default', 'standard', 'auto', 'flex', 'priority', 'scale'))}
# generateContent's ServiceTier wire values are lowercase. Retain the existing
# receipt canonical form and the historical standard rates; other tiers remain
# explicitly unpriced. https://ai.google.dev/api/generate-content#ServiceTier
_GEMINI_TIER_ALIASES = {'unspecified': 'SERVICE_TIER_UNSPECIFIED', 'standard': 'STANDARD',
                       'flex': 'FLEX', 'priority': 'PRIORITY'}
_USAGE_FIELDS = {'gemini': ('promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount',
                          'cachedContentTokenCount', 'toolUsePromptTokenCount', 'totalTokenCount'),
                 'openai': ('input_tokens', 'output_tokens', 'total_tokens')}
_USAGE_DETAILS = {'input_tokens_details': ('cached_tokens', 'cache_write_tokens'),
                  'output_tokens_details': ('reasoning_tokens',)}


def _count(value):
    return type(value) is int and 0 <= value <= 100_000_000


def _money(units):
    return format(Decimal(units) / Decimal(1_000_000_000), 'f')


def _numeric_tokens(provider, usage):
    """Keep independently valid counters even when pricing is unavailable.

    This is a projection, not a claim that a partial/inconsistent usage is billable.
    Missing or invalid counters are absent, never invented as zero.
    """
    if provider not in _PROVIDERS or not isinstance(usage, dict):
        return {}
    result = {key: usage[key] for key in _USAGE_FIELDS[provider] if _count(usage.get(key))}
    if provider == 'openai':
        for group, names in _USAGE_DETAILS.items():
            detail = usage.get(group)
            if isinstance(detail, dict):
                result[group] = {key: detail[key] for key in names if _count(detail.get(key))}
    return result


def normalize_service_tier(provider, value):
    """Normalize documented enum aliases only; never retain arbitrary text."""
    if value is None:
        return None
    if provider == 'gemini' and isinstance(value, str):
        value = _GEMINI_TIER_ALIASES.get(value, value)
    return value if isinstance(value, str) and value in _TIERS.get(provider, ()) else 'unknown'


def _safe_tier(provider, value):
    return normalize_service_tier(provider, value)


def _safe_run_context(value=None):
    if value is None:
        value = {'github_run_id': os.environ.get('GITHUB_RUN_ID'),
                 'github_run_attempt': os.environ.get('GITHUB_RUN_ATTEMPT')}
    if not isinstance(value, dict):
        return {}
    result = {}
    for key in ('github_run_id', 'github_run_attempt'):
        item = value.get(key)
        if isinstance(item, str) and re.fullmatch(r'[0-9]{1,20}', item):
            item = int(item)
        if type(item) is int and 0 < item < 10 ** 20:
            result[key] = item
    return result


def _timestamp(value, *, day=None):
    if not isinstance(value, str) or len(value) > 35:
        return None
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None or parsed.utcoffset() != timedelta(hours=9):
            return None
        if day is not None and parsed.date().isoformat() != day:
            return None
        return parsed.isoformat(timespec='seconds')
    except (TypeError, ValueError, OverflowError):
        return None


def _safe_pricing_version(value):
    return value if isinstance(value, str) and re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}-text-standard', value) else None


def estimate_cost(provider, model, usage, service_tier=None):
    """Return nano-USD plus numeric usage only, or an explicit unknown reason.

    Thinking is included once: OpenAI output_tokens includes reasoning;
    Gemini total-prompt includes both candidates and thoughts. Cache fields
    are subsets of input, not additional input. An absent OpenAI cache-write
    breakdown uses the conservative write rate and is labelled accordingly.
    """
    unknown = {'usd_nanos': None, 'tokens': _numeric_tokens(provider, usage), 'basis': 'unknown'}
    service_tier = normalize_service_tier(provider, service_tier)
    if not isinstance(usage, dict):
        return {**unknown, 'reason': 'usage_unavailable'}
    if provider == 'gemini' and model == 'gemini-2.5-flash':
        if service_tier not in (None, 'STANDARD', 'SERVICE_TIER_UNSPECIFIED'):
            return {**unknown, 'reason': 'pricing_unavailable'}
        allowed = ('promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount',
                   'cachedContentTokenCount', 'toolUsePromptTokenCount', 'totalTokenCount')
        if any(key in usage and not _count(usage[key]) for key in allowed):
            return {**unknown, 'reason': 'usage_invalid'}
        input_, total = usage.get('promptTokenCount'), usage.get('totalTokenCount')
        if not _count(input_) or not _count(total) or total < input_:
            return {**unknown, 'reason': 'usage_incomplete'}
        output = total - input_
        candidate, thought = usage.get('candidatesTokenCount'), usage.get('thoughtsTokenCount')
        if ((candidate is not None and candidate > output)
                or (thought is not None and thought > output)
                or (candidate is not None and thought is not None and candidate + thought != output)
                or usage.get('toolUsePromptTokenCount', 0) != 0):
            return {**unknown, 'reason': 'usage_inconsistent'}
        cached = usage.get('cachedContentTokenCount', 0)
        if cached > input_:
            return {**unknown, 'reason': 'usage_inconsistent'}
        tokens = {key: usage[key] for key in allowed if key in usage}
        return {'usd_nanos': (input_ - cached) * 300 + cached * 30 + output * 2500,
                'tokens': tokens, 'basis': 'standard_text', 'reason': None}
    if provider == 'openai' and model == 'gpt-6-luna':
        if service_tier not in (None, 'default', 'standard'):
            return {**unknown, 'reason': 'pricing_unavailable'}
        input_, output, total = (usage.get(key) for key in ('input_tokens', 'output_tokens', 'total_tokens'))
        if not all(_count(value) for value in (input_, output, total)):
            return {**unknown, 'reason': 'usage_incomplete'}
        details, output_details = usage.get('input_tokens_details', {}), usage.get('output_tokens_details', {})
        if not isinstance(details, dict) or not isinstance(output_details, dict):
            return {**unknown, 'reason': 'usage_invalid'}
        cached, written = details.get('cached_tokens', 0), details.get('cache_write_tokens')
        reasoning = output_details.get('reasoning_tokens')
        if (not _count(cached) or (written is not None and not _count(written))
                or (reasoning is not None and not _count(reasoning))):
            return {**unknown, 'reason': 'usage_invalid'}
        if (total != input_ + output or cached + (written or 0) > input_
                or (reasoning is not None and reasoning > output)):
            return {**unknown, 'reason': 'usage_inconsistent'}
        long = input_ > 272_000
        ordinary_rate, cached_rate, write_rate, output_rate = ((200, 20, 250, 750) if long else (100, 10, 125, 500))
        basis = 'standard_text'
        if written is None:
            # Never silently claim unknown cache writes were free.
            written = input_ - cached
            basis = 'conservative_cache_write'
        ordinary = input_ - cached - written
        tokens = {'input_tokens': input_, 'output_tokens': output, 'total_tokens': total,
                  'input_tokens_details': {key: details[key] for key in ('cached_tokens', 'cache_write_tokens') if key in details},
                  'output_tokens_details': {key: output_details[key] for key in ('reasoning_tokens',) if key in output_details}}
        return {'usd_nanos': ordinary * ordinary_rate + cached * cached_rate + written * write_rate + output * output_rate,
                'tokens': tokens, 'basis': basis, 'reason': None}
    return {**unknown, 'reason': 'pricing_unavailable'}


def _valid_amount(value):
    return type(value) is int and 0 <= value <= 1_000_000_000_000_000


def _receipt_projection(identifier, start, finish):
    provider = start['provider']
    amount = finish.get('usd_nanos') if isinstance(finish, dict) else None
    amount = amount if _valid_amount(amount) else None
    reason = None if amount is not None else (finish.get('reason') if finish else 'usage_not_recorded')
    if reason is not None and (not isinstance(reason, str) or reason not in _REASONS):
        reason = 'unclassified_unknown'
    basis = finish.get('basis') if finish else 'unknown'
    if not isinstance(basis, str) or basis not in _BASES or amount is None:
        basis = 'unknown'
    return {'request_sha256': sha256(identifier.encode('ascii')).hexdigest(),
            'day': start['day'], 'scope': start['scope'], 'provider': provider,
            'model': start['model'] if start['model'] == _PRICED_MODELS.get(provider) else 'unlisted_model',
            'started_at': _timestamp(start.get('started_at'), day=start['day']),
            'finished_at': _timestamp(finish.get('finished_at')) if finish else None,
            'state': 'usage_known' if amount is not None else ('usage_unknown' if finish else 'started'),
            'usd_nanos': amount, 'basis': basis, 'reason': reason,
            'tokens': _numeric_tokens(provider, finish.get('tokens')) if finish else {},
            'service_tier': _safe_tier(provider, finish.get('service_tier')) if finish else None,
            'pricing_version': _safe_pricing_version(finish.get('pricing_version')) if finish else None,
            'run_context': _safe_run_context(start.get('run_context', {}))}


def _digest(value):
    return sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('ascii')).hexdigest()


def _summary(starts, finishes, *, scope, persistence_failures=0, persistence_complete=True,
             include_providers=True, include_receipts=True):
    amount, unknown = 0, 0
    reasons = {}
    receipts = []
    for identifier in sorted(starts):
        value = finishes.get(identifier, {}).get('usd_nanos')
        receipt = _receipt_projection(identifier, starts[identifier], finishes.get(identifier))
        receipts.append(receipt)
        if not _valid_amount(value):
            unknown += 1
            reason = receipt['reason']
            reasons[reason] = reasons.get(reason, 0) + 1
        else:
            amount += value
    yen = Decimal(amount) * USD_TO_JPY / 1_000_000_000
    complete = unknown == 0 and persistence_complete
    result = {'target_jpy': TARGET_JPY, 'target_mode': 'soft', 'scope': scope,
            'estimated_cost_usd': _money(amount), 'estimated_cost_jpy': format(yen, 'f'),
            'usd_to_jpy': USD_TO_JPY, 'pricing_version': PRICING_VERSION,
            'request_count': len(starts), 'unknown_cost_count': unknown,
            'persistence_failures': persistence_failures, 'persistence_complete': persistence_complete,
            'estimate_complete': complete,
            'target_state': 'above_target' if yen > TARGET_JPY else ('within_target' if complete else 'unknown'),
            'invoice_amount': False, 'unknown_reasons': dict(sorted(reasons.items())),
            'request_set_sha256': _digest([value['request_sha256'] for value in receipts]),
            'receipt_set_sha256': _digest(receipts)}
    if include_receipts:
        result['receipts'] = receipts
    if include_providers:
        result['providers'] = {provider: _summary(
            {key: value for key, value in starts.items() if value['provider'] == provider},
            finishes, scope=scope, persistence_failures=persistence_failures,
            persistence_complete=persistence_complete, include_providers=False,
            include_receipts=False) for provider in _PROVIDERS}
    return result


class ReviewUsageRecorder:
    def __init__(self, storage=None, *, scope, clock=time.time, run_context=None):
        if scope not in _SCOPES:
            raise ValueError('invalid_cost_scope')
        self.storage, self.scope, self.clock = storage, scope, clock
        self.run_context = _safe_run_context(run_context)
        self._starts, self._finishes = {}, {}
        self._failures, self._lock = 0, RLock()

    def _save(self, value, suffix):
        if self.storage is None:
            self._failures += 1
            return
        path = f"{PREFIX}/{value['day']}/{value['request_id']}.{suffix}.json"
        try:
            # No retry of an uncertain write and, especially, no AI retry.
            deadline = time.monotonic() + 3
            if not self.storage.create(path, value, deadline=deadline):
                if self.storage.read(path, deadline=deadline) != value:
                    self._failures += 1
        except Exception:
            self._failures += 1

    def start_request(self, *, provider, model, request_id):
        with self._lock:
            if (provider not in {'gemini', 'openai'} or not isinstance(model, str)
                    or not _MODEL.fullmatch(model) or model.startswith(('sk-', 'sk_', 'AIza'))
                    or not isinstance(request_id, str) or not _ID.fullmatch(request_id)):
                raise ValueError('invalid_cost_request')
            if request_id in self._starts:
                return
            now = datetime.fromtimestamp(self.clock(), JST)
            value = {'schema_version': 1, 'scope': self.scope, 'request_id': request_id,
                     'provider': provider, 'model': model, 'day': now.date().isoformat(),
                     'started_at': now.isoformat(timespec='seconds'), 'state': 'started'}
            if self.run_context:
                value['run_context'] = dict(self.run_context)
            self._starts[request_id] = value
            self._save(value, 'start')

    def record_request(self, *, provider, model, request_id, usage=None, service_tier=None):
        with self._lock:
            if request_id in self._finishes:
                return
            if request_id not in self._starts:
                # Never assign a restarted/late response to a new send day.
                # The old durable start remains unknown; this API deliberately
                # does not replay requests or infer missing start context.
                raise ValueError('cost_start_unavailable')
            start = self._starts[request_id]
            if start['provider'] != provider or start['model'] != model:
                raise ValueError('invalid_cost_request')
            calculated = estimate_cost(provider, model, usage, service_tier)
            value = {**start, **calculated, 'state': 'usage_known' if calculated['usd_nanos'] is not None else 'usage_unknown',
                     'pricing_version': PRICING_VERSION, 'usd_to_jpy': USD_TO_JPY,
                     'finished_at': datetime.fromtimestamp(self.clock(), JST).isoformat(timespec='seconds')}
            value['service_tier'] = _safe_tier(provider, service_tier)
            self._finishes[request_id] = value
            self._save(value, 'usage')

    def safe_summary(self):
        with self._lock:
            return _summary(self._starts, self._finishes, scope=self.scope,
                            persistence_failures=self._failures,
                            persistence_complete=self.storage is not None and self._failures == 0)


def _valid_stored_receipt(value, day, identifier, kind):
    if (not isinstance(value, dict) or type(value.get('schema_version')) is not int
            or value['schema_version'] != 1 or value.get('day') != day
            or value.get('request_id') != identifier
            or not isinstance(value.get('scope'), str) or value['scope'] not in _SCOPES
            or value.get('provider') not in _PROVIDERS):
        return False
    model = value.get('model')
    if (not isinstance(model, str) or not _MODEL.fullmatch(model)
            or model.startswith(('sk-', 'sk_', 'AIza'))
            or _timestamp(value.get('started_at'), day=day) is None):
        return False
    if 'run_context' in value and (not isinstance(value['run_context'], dict)
                                  or _safe_run_context(value['run_context']) != value['run_context']):
        return False
    if kind == 'start':
        return value.get('state') == 'started'
    finished = _timestamp(value.get('finished_at'))
    if finished is None or finished < _timestamp(value['started_at']):
        return False
    amount, state = value.get('usd_nanos'), value.get('state')
    if not ((state == 'usage_known' and _valid_amount(amount))
            or (state == 'usage_unknown' and amount is None)):
        return False
    if (_safe_pricing_version(value.get('pricing_version')) is None
            or not isinstance(value.get('basis'), str) or value['basis'] not in _BASES
            or not isinstance(value.get('tokens'), dict)
            or _numeric_tokens(value['provider'], value['tokens']) != value['tokens']):
        return False
    reason = value.get('reason')
    if amount is None:
        if not isinstance(reason, str) or reason not in _REASONS or value['basis'] != 'unknown':
            return False
    elif reason is not None:
        return False
    elif (value['basis'] == 'unknown' or estimate_cost(
            value['provider'], _PRICED_MODELS[value['provider']], value['tokens'])['usd_nanos'] is None):
        # Validate the numeric relationships without changing a historical
        # saved amount, its rate version, or its actual service tier.
        return False
    if 'service_tier' in value and _safe_tier(value['provider'], value['service_tier']) != value['service_tier']:
        return False
    if amount is not None and value['pricing_version'] == PRICING_VERSION:
        calculated = estimate_cost(value['provider'], value['model'], value['tokens'], value.get('service_tier'))
        if calculated['usd_nanos'] != amount or calculated['basis'] != value['basis']:
            return False
    return True


def collect_daily_cost(storage, day, *, seconds=120, max_objects=210, clock=None, cancelled=None):
    """Read-only finite scan. Partial reads retain facts and never claim a total.

    Legacy Storage supports seven thirty-object pages. An audit adapter may
    explicitly permit more pages; its caller can request at most 1,200 objects.
    The 120-second default covers ordinary daily scans without changing AI or
    publication limits. A finite deadline, cancellation and item cap all apply.
    """
    if not isinstance(day, str) or date.fromisoformat(day).isoformat() != day:
        raise ValueError('invalid_cost_day')
    if (type(seconds) not in (int, float) or not math.isfinite(seconds) or not 0 < seconds <= 300
            or type(max_objects) is not int or not 2 <= max_objects <= 1200
            or cancelled is not None and not callable(cancelled)):
        raise ValueError('invalid_cost_scan_budget')
    clock = time.monotonic if clock is None else clock
    if not callable(clock):
        raise ValueError('invalid_cost_scan_budget')
    starts, finishes, complete = {}, {}, True
    seen_names = set()
    begun = clock()
    if type(begun) not in (int, float) or not math.isfinite(begun):
        raise ValueError('invalid_cost_scan_budget')
    deadline = begun + seconds
    scan = {'listed_object_count': 0, 'read_object_count': 0, 'list_pages': 0,
            'invalid_record_count': 0, 'duplicate_name_count': 0,
            'orphan_usage_count': 0, 'context_mismatch_count': 0,
            'max_objects': max_objects, 'time_budget_seconds': seconds}
    reasons = set()
    phase = 'list'

    def check():
        if cancelled is not None and cancelled():
            raise ValueError('scan_cancelled')
        now = clock()
        if type(now) not in (int, float) or not math.isfinite(now):
            raise ValueError('scan_clock_invalid')
        if now >= deadline:
            raise ValueError('scan_deadline')

    try:
        for offset in range(0, max_objects, 30):
            phase = 'list'
            check()
            items = storage._list(f'{PREFIX}/{day}', offset=offset, deadline=deadline)
            scan['list_pages'] += 1
            if not isinstance(items, list) or len(items) > 30:
                reasons.add('invalid_listing')
                complete = False
                break
            scan['listed_object_count'] += len(items)
            check()
            for item in items:
                if scan['read_object_count'] >= max_objects:
                    reasons.add('object_limit')
                    complete = False
                    break
                name = item.get('name') if isinstance(item, dict) else None
                match = re.fullmatch(r'([0-9a-f]{32})\.(start|usage)\.json', name) if isinstance(name, str) else None
                if not match:
                    complete = False
                    scan['invalid_record_count'] += 1
                    reasons.add('invalid_name')
                    continue
                if name in seen_names:
                    complete = False
                    scan['duplicate_name_count'] += 1
                    reasons.add('duplicate_name')
                    continue
                seen_names.add(name)
                phase = 'read'
                check()
                value = storage.read(f'{PREFIX}/{day}/{name}', deadline=deadline)
                scan['read_object_count'] += 1
                check()
                if not _valid_stored_receipt(value, day, match[1], match[2]):
                    complete = False
                    scan['invalid_record_count'] += 1
                    reasons.add('invalid_record')
                    continue
                if match[2] == 'start':
                    starts[match[1]] = value
                else:
                    finishes[match[1]] = value
            if len(items) < 30:
                break
        else:
            complete = False
            reasons.add('object_limit')
    except Exception as error:
        complete = False
        code = error.args[0] if error.args else None
        if isinstance(code, str) and code in ('scan_cancelled', 'scan_clock_invalid', 'scan_deadline', 'storage_deadline'):
            reasons.add('scan_deadline' if code == 'storage_deadline' else code)
        else:
            reasons.add('storage_list_failed' if phase == 'list' else 'storage_read_failed')
    orphaned = set(finishes) - set(starts)
    if orphaned:
        complete = False
        scan['orphan_usage_count'] = len(orphaned)
        reasons.add('orphan_usage')
    for identifier, start in starts.items():
        finish = finishes.get(identifier)
        if finish is not None and any(finish.get(key) != start.get(key)
                                     for key in ('day', 'scope', 'provider', 'model', 'started_at')):
            finishes.pop(identifier)
            complete = False
            scan['context_mismatch_count'] += 1
            reasons.add('context_mismatch')
        elif finish is not None and finish.get('run_context', {}) != start.get('run_context', {}):
            finishes.pop(identifier)
            complete = False
            scan['context_mismatch_count'] += 1
            reasons.add('context_mismatch')
    ended = clock()
    elapsed = ended - begun if type(ended) in (int, float) and math.isfinite(ended) else 0
    scan.update(reason_codes=sorted(reasons), elapsed_seconds=round(max(0, elapsed), 3),
                valid_start_count=len(starts), valid_usage_count=len(finishes),
                unread_listed_count=max(0, scan['listed_object_count'] - scan['read_object_count']))
    result = _summary(starts, finishes, scope='all', persistence_complete=complete)
    result.update(day=day, scan_complete=complete, snapshot_guaranteed=False, scan=scan,
                  scopes={scope: _summary({k: v for k, v in starts.items() if v['scope'] == scope},
                                        finishes, scope=scope, persistence_complete=complete,
                                        include_receipts=False) for scope in sorted(_SCOPES)})
    return result

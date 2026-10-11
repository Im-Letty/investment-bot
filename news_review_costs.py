"""Private review usage receipts. Ten yen is a target, never a delivery gate.

No prompts, responses, credentials or provider request IDs enter this store.
USD estimates use the published text rates checked on 2026-10-11. JPY is an
internal estimate at October's BOJ reference rate, not the card's exchange rate
or a tax-inclusive invoice. Unknown usage remains unknown across restarts.
"""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
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


def _count(value):
    return type(value) is int and 0 <= value <= 100_000_000


def _money(units):
    return format(Decimal(units) / Decimal(1_000_000_000), 'f')


def estimate_cost(provider, model, usage, service_tier=None):
    """Return nano-USD plus numeric usage only, or an explicit unknown reason.

    Thinking is included once: OpenAI output_tokens includes reasoning;
    Gemini total-prompt includes both candidates and thoughts. Cache fields
    are subsets of input, not additional input. An absent OpenAI cache-write
    breakdown uses the conservative write rate and is labelled accordingly.
    """
    unknown = {'usd_nanos': None, 'tokens': {}, 'basis': 'unknown'}
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


def _summary(starts, finishes, *, scope, persistence_failures=0, persistence_complete=True):
    amount, unknown = 0, 0
    for identifier in starts:
        value = finishes.get(identifier, {}).get('usd_nanos')
        if type(value) is not int or not 0 <= value <= 1_000_000_000_000_000:
            unknown += 1
        else:
            amount += value
    yen = Decimal(amount) * USD_TO_JPY / 1_000_000_000
    complete = unknown == 0 and persistence_complete
    return {'target_jpy': TARGET_JPY, 'target_mode': 'soft', 'scope': scope,
            'estimated_cost_usd': _money(amount), 'estimated_cost_jpy': format(yen, 'f'),
            'usd_to_jpy': USD_TO_JPY, 'pricing_version': PRICING_VERSION,
            'request_count': len(starts), 'unknown_cost_count': unknown,
            'persistence_failures': persistence_failures, 'persistence_complete': persistence_complete,
            'estimate_complete': complete,
            'target_state': 'above_target' if yen > TARGET_JPY else ('within_target' if complete else 'unknown'),
            'invoice_amount': False}


class ReviewUsageRecorder:
    def __init__(self, storage=None, *, scope, clock=time.time):
        if scope not in _SCOPES:
            raise ValueError('invalid_cost_scope')
        self.storage, self.scope, self.clock = storage, scope, clock
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
            self._finishes[request_id] = value
            self._save(value, 'usage')

    def safe_summary(self):
        with self._lock:
            return _summary(self._starts, self._finishes, scope=self.scope,
                            persistence_failures=self._failures,
                            persistence_complete=self.storage is not None and self._failures == 0)


def collect_daily_cost(storage, day, *, seconds=12):
    """Read-only bounded aggregation across all three scopes, with no AI calls."""
    if not isinstance(day, str) or date.fromisoformat(day).isoformat() != day:
        raise ValueError('invalid_cost_day')
    starts, finishes, complete = {}, {}, True
    seen_names = set()
    deadline = time.monotonic() + seconds
    try:
        for offset in range(0, 181, 30):
            items = storage._list(f'{PREFIX}/{day}', offset=offset, deadline=deadline)
            for item in items:
                name = item.get('name') if isinstance(item, dict) else None
                match = re.fullmatch(r'([0-9a-f]{32})\.(start|usage)\.json', name or '')
                if not match:
                    complete = False
                    continue
                if name in seen_names:
                    complete = False
                seen_names.add(name)
                value = storage.read(f'{PREFIX}/{day}/{name}', deadline=deadline)
                if (not isinstance(value, dict) or value.get('day') != day
                        or value.get('request_id') != match[1] or value.get('scope') not in _SCOPES):
                    complete = False
                    continue
                if match[2] == 'start':
                    starts[match[1]] = value
                else:
                    finishes[match[1]] = value
            if len(items) < 30:
                break
        else:
            complete = False
    except Exception:
        complete = False
    if set(finishes) - set(starts):
        complete = False
    for identifier, start in starts.items():
        finish = finishes.get(identifier)
        if finish is not None and any(finish.get(key) != start.get(key)
                                     for key in ('day', 'scope', 'provider', 'model', 'started_at')):
            finishes.pop(identifier)
            complete = False
    result = _summary(starts, finishes, scope='all', persistence_complete=complete)
    result.update(day=day, scan_complete=complete, snapshot_guaranteed=False,
                  scopes={scope: _summary({k: v for k, v in starts.items() if v['scope'] == scope},
                                        finishes, scope=scope, persistence_complete=complete) for scope in sorted(_SCOPES)})
    return result

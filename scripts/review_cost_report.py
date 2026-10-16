"""Small fixed cost metadata for private job outcomes; no receipt payloads.

The recorder owns numeric evidence. This projection never recalculates or fills
missing usage, reads credentials, writes Storage, or affects publication.
"""
from datetime import date
import math
import re

REASONS = frozenset(('usage_unavailable', 'usage_invalid', 'usage_incomplete',
    'usage_inconsistent', 'pricing_unavailable', 'usage_not_recorded', 'unclassified_unknown'))
COUNTS = ('target_jpy', 'usd_to_jpy', 'request_count', 'unknown_cost_count', 'persistence_failures')
FLAGS = ('persistence_complete', 'estimate_complete', 'scan_complete', 'snapshot_guaranteed', 'invoice_amount')
MONEY = ('estimated_cost_usd', 'estimated_cost_jpy')
HASHES = ('request_set_sha256', 'receipt_set_sha256')


def _day(value):
    try:
        return value if isinstance(value, str) and date.fromisoformat(value).isoformat() == value else None
    except ValueError:
        return None


def _context(value):
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


def _numeric(value, *, integer=False):
    if integer:
        return type(value) is int and 0 <= value <= 1_000_000_000
    return ((type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 10 ** 15)
            or (isinstance(value, str) and len(value) <= 48
                and re.fullmatch(r'[0-9]{1,18}(?:\.[0-9]{1,24})?', value) is not None))


def _reasons(value):
    if not isinstance(value, dict):
        return {}
    return {reason: value[reason] for reason in sorted(REASONS)
            if type(value.get(reason)) is int and 0 <= value[reason] <= 1_000_000}


def _provider(value):
    if not isinstance(value, dict):
        return None
    result = {key: value[key] for key in ('request_count', 'unknown_cost_count', 'persistence_failures')
              if _numeric(value.get(key), integer=True)}
    result.update({key: value[key] for key in MONEY if _numeric(value.get(key))})
    result.update({key: value[key] for key in ('persistence_complete', 'estimate_complete')
                   if type(value.get(key)) is bool})
    if isinstance(value.get('unknown_reasons'), dict):
        result['unknown_reasons'] = _reasons(value['unknown_reasons'])
    return result or None


def safe_review_cost(value):
    """Keep aggregate counts/reasons, correlation hashes and fixed run context.

    Request IDs, individual receipt hashes, token counters, model names, raw
    responses and arbitrary fields never enter an ordinary writer artifact.
    """
    if not isinstance(value, dict):
        return None
    result = {key: value[key] for key in COUNTS if _numeric(value.get(key), integer=True)}
    result.update({key: value[key] for key in MONEY if _numeric(value.get(key))})
    result.update({key: value[key] for key in FLAGS if type(value.get(key)) is bool})
    for key, choices in {
            'status': ('checked', 'incomplete', 'cost_unavailable', 'not_connected'),
            'scope': ('all', 'economy', 'company', 'private_test'), 'target_mode': ('soft',),
            'target_state': ('above_target', 'within_target', 'unknown')}.items():
        item = value.get(key)
        if isinstance(item, str) and item in choices:
            result[key] = item
    version = value.get('pricing_version')
    if isinstance(version, str) and version.endswith('-text-standard') and _day(version[:-14]) is not None:
        result['pricing_version'] = version
    for key in HASHES:
        item = value.get(key)
        if isinstance(item, str) and re.fullmatch(r'[0-9a-f]{64}', item):
            result[key] = item
    if isinstance(value.get('unknown_reasons'), dict):
        result['unknown_reasons'] = _reasons(value['unknown_reasons'])
    providers = value.get('providers')
    if isinstance(providers, dict):
        result['providers'] = {name: safe for name in ('gemini', 'openai')
                               if (safe := _provider(providers.get(name))) is not None}
    days = set()
    if _day(value.get('day')) is not None:
        days.add(value['day'])
    if isinstance(value.get('days'), list) and len(value['days']) <= 31:
        days.update(day for day in value['days'] if _day(day) is not None)
    contexts = []
    direct = _context(value.get('run_context'))
    if direct:
        contexts.append(direct)
    receipts = value.get('receipts')
    if isinstance(receipts, list) and len(receipts) <= 1200:
        for receipt in receipts:
            if not isinstance(receipt, dict):
                continue
            day = _day(receipt.get('day'))
            if day is not None:
                days.add(day)
            context = _context(receipt.get('run_context'))
            if context and context not in contexts:
                contexts.append(context)
    if len(days) == 1:
        result['day'] = next(iter(days))
    elif 1 < len(days) <= 31:
        result['days'] = sorted(days)
    if len(contexts) == 1:
        result['run_context'] = contexts[0]
    elif len(contexts) > 1:
        result['mixed_run_contexts'] = True
    return result or None

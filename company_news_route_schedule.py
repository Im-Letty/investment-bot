"""Pure bounded scheduling for independently verified company feed routes.

The caller supplies the existing channels and already verified extra routes.
This module discovers nothing and does not grant permission to fetch a URL.
It performs no I/O, membership lookup, storage, clock lookup or generation.
The existing collector still owns its 40-second total, three workers, eight
body candidates, three returned bodies and the separate daily review limit.

Every base channel is scheduled in each poll. At most six additional routes
are selected from stable sorted chunks, rotating by the UTC 15-minute slot.
Selected additional routes enter the bounded worker queue first; base routes
rotate within that queue so the same channels are not always at its tail.
The full-cycle value describes scheduled coverage; transport failures and the
collector deadline mean it cannot promise successful retrieval in that time.
"""
from collections.abc import Mapping
import math
from urllib.parse import urlsplit


POLL_SECONDS = 900
DEFAULT_ADDITIONAL_LIMIT = 6
MAX_ADDITIONAL_LIMIT = 6
MAX_BASE_CHANNELS = 33
MAX_ADDITIONAL_ROUTES = 194
# datetime's first unrepresentable year, exclusive; no platform clock needed.
MAX_NOW_EXCLUSIVE = 253402300800
_ERROR = 'company_route_schedule_invalid'


def _invalid():
    raise ValueError(_ERROR)


def _feeds(value, maximum, *, required):
    if not isinstance(value, Mapping) or len(value) > maximum or required and not value:
        _invalid()
    result = {}
    for label, url in value.items():
        if (not isinstance(label, str) or not 1 <= len(label) <= 200
                or label != label.strip()
                or any(ord(char) < 32 or ord(char) == 127 for char in label)
                or not isinstance(url, str) or not 1 <= len(url) <= 2048
                or '\\' in url or any(ord(char) < 33 or ord(char) == 127 for char in url)):
            _invalid()
        try:
            parsed = urlsplit(url)
            if (parsed.scheme != 'https' or not parsed.hostname
                    or parsed.username is not None or parsed.password is not None
                    or parsed.port not in (None, 443) or parsed.fragment):
                _invalid()
        except (ValueError, UnicodeError):
            _invalid()
        if label in result or url in result.values():
            _invalid()
        result[label] = url
    return result


def _feed_dispatch_order(base_labels, selected_additional_labels, slot):
    """Order validated scheduled labels without changing their selection."""
    base = sorted(base_labels)
    offset = slot % len(base)
    return [*selected_additional_labels, *base[offset:], *base[:offset]]


def select_route_schedule(base_feeds, additional_feeds, now, *,
                          additional_limit=DEFAULT_ADDITIONAL_LIMIT):
    """Return selected feeds and compact counts, without fetching anything.

    Inputs are explicit trusted label-to-URL mappings. An empty additional
    registry retains the base routes; an empty base registry is invalid.
    Validation rejects the entire plan on ambiguous labels/URLs or bad time,
    rather than partially enabling unverified routes. UTC slots and sorted
    chunks give the same selection after a process restart or mapping reorder.
    """
    if (type(now) not in (int, float) or not 0 < now < MAX_NOW_EXCLUSIVE
            or not math.isfinite(now)
            or type(additional_limit) is not int
            or not 1 <= additional_limit <= MAX_ADDITIONAL_LIMIT):
        _invalid()
    base = _feeds(base_feeds, MAX_BASE_CHANNELS, required=True)
    additional = _feeds(additional_feeds, MAX_ADDITIONAL_ROUTES, required=False)
    if set(base).intersection(additional) or set(base.values()).intersection(additional.values()):
        _invalid()

    labels = sorted(additional)
    batch_count = (len(labels) + additional_limit - 1) // additional_limit
    slot = int(now // POLL_SECONDS)
    batch_index = slot % batch_count if batch_count else 0
    start = batch_index * additional_limit
    selected = labels[start:start + additional_limit]
    scheduled = {label: additional[label] if label in additional else base[label]
                 for label in _feed_dispatch_order(base, selected, slot)}
    coverage = {
        'base_channel_count': len(base),
        'additional_registered_channel_count': len(additional),
        'additional_scheduled_channel_count': len(selected),
        'additional_unscheduled_channel_count': len(additional) - len(selected),
        'registered_channel_count': len(base) + len(additional),
        'scheduled_channel_count': len(scheduled),
        'additional_limit_per_poll': additional_limit,
        'rotation_interval_seconds': POLL_SECONDS,
        'rotation_batch_count': batch_count,
        'rotation_batch_index': batch_index,
        'rotation_full_cycle_seconds': batch_count * POLL_SECONDS,
        'all_registered_routes_scheduled_this_poll': len(selected) == len(additional),
        'all_company_announcements_covered': False,
    }
    return {'feeds': scheduled, 'coverage': coverage}

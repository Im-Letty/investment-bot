"""Capacity policy for the existing, consented assistant summary."""
import os
import re

import community_api

FREE_LIMIT = 1200
PAID_LIMIT = 3600
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def verified_owner(authorization, url, key):
    token = authorization[7:]
    if (not authorization.startswith("Bearer ") or not 1 <= len(token) <= 8192
            or any(ord(c) <= 32 or ord(c) >= 127 for c in token)):
        raise community_api.CommunityError("auth_required")
    return community_api.SupabaseCommunityRepository(url, key).verify_user(token)


def memory_limit(owner):
    """Only a server-managed list can grant more capacity to a verified UUID."""
    configured = os.environ.get("ASSISTANT_MEMORY_PAID_MEMBER_IDS", "")
    if len(configured) > 40_000 or not isinstance(owner, str) or not _UUID.fullmatch(owner):
        return FREE_LIMIT
    return PAID_LIMIT if owner in (item.strip() for item in configured.split(",")) else FREE_LIMIT


def summary_units(value):
    """Use the same UTF-16 units as the browser and reject broken surrogates."""
    try:
        return len(value.encode("utf-16-le")) // 2
    except UnicodeEncodeError:
        return PAID_LIMIT + 1


def within_limit(value, limit):
    # Drop an unmatched surrogate at the clipping boundary.
    return value.encode("utf-16-le")[:limit * 2].decode("utf-16-le", errors="ignore")

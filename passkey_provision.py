"""Provision this site's Supabase OAuth provider once, after an explicit DB request.

REST contract: https://github.com/supabase/supabase-js/blob/master/packages/core/
auth-js/src/GoTrueAdminApi.ts (_getCustomProvider / _createCustomProvider).
Provider fields: https://supabase.com/docs/guides/auth/custom-oauth-providers

No existing provider is updated or deleted. If the external create succeeds but
the database commit is lost, leave setup unavailable for administrator recovery;
never replace that provider with a different secret on the next process start.
"""

import hashlib
import logging
import re
import secrets
from urllib.parse import urlsplit
from uuid import UUID

import requests


_LOG = logging.getLogger(__name__)
_IDENTIFIER = "custom:passkey"
_CLIENT_ID = "economic-news-passkey"
_SITE = "https://investment-bot-ta24.onrender.com"
_TIMEOUT = (3.05, 15)
_HASH_RE = re.compile(r"[0-9a-f]{64}\Z")


def _operation(supabase, action, data):
    return supabase.rpc(
        "passkey_auth_operation", {"p_action": action, "p_data": data}
    ).execute().data


def _fail(supabase, lease_token, reason):
    # The SQL RPC checks the exact lease token and expiry, and cannot disable a
    # provider already committed by another worker. Do not log exception text:
    # HTTP/SDK exceptions can contain request bodies or authorization headers.
    try:
        _operation(
            supabase, "fail_provision", {"lease_token": lease_token, "reason": reason}
        )
    except Exception:
        pass
    _LOG.warning("Passkey provider setup needs administrator review (%s).", reason)
    return False


def _admin_url(supa_url):
    if not isinstance(supa_url, str):
        return None
    parsed = urlsplit(supa_url)
    # This deployment uses a Supabase-hosted project. Never send its admin key
    # to a redirect, an embedded username/password, or an unrelated hostname.
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or not parsed.hostname.endswith(".supabase.co")
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port not in (None, 443)
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        return None
    return f"https://{parsed.netloc}/auth/v1/admin/custom-providers"


def _is_missing(response):
    if response.status_code != 404:
        return False
    try:
        data = response.json()
    except (ValueError, TypeError):
        return False
    return isinstance(data, dict) and (
        data.get("code") == "custom_provider_not_found"
        or data.get("error_code") == "custom_provider_not_found"
    )


def _created_id(response, expected):
    if response.status_code != 201:
        return None
    data = response.json()
    if not isinstance(data, dict):
        return None
    for field in (
        "identifier", "provider_type", "client_id", "authorization_url",
        "token_url", "userinfo_url", "pkce_enabled", "email_optional", "enabled",
    ):
        if data.get(field) != expected[field]:
            return None
    value = data.get("id")
    if not isinstance(value, str):
        return None
    try:
        return str(UUID(value))
    except (ValueError, AttributeError):
        return None


def ensure_passkey_provider(supabase, supa_url, supa_key):
    """Return readiness without propagating failures into application startup.

    ``claim_provision`` must atomically require provision_requested, not ready,
    and no active lease; it records p_data.lease_token for five minutes.
    ``finish_provision`` and ``fail_provision`` must require the same unexpired
    lease. Only finish stores the SHA-256 client-secret hash and enables auth.
    The plain client secret exists only in memory and in the HTTPS create call.
    """
    lease_token = None
    try:
        admin_url = _admin_url(supa_url)
        if not admin_url or not isinstance(supa_key, str) or not supa_key:
            return False
        config = _operation(supabase, "config", {})
        if not isinstance(config, dict):
            return False
        if config.get("enabled") is True:
            secret_hash = config.get("client_secret_hash")
            return isinstance(secret_hash, str) and bool(_HASH_RE.fullmatch(secret_hash))

        candidate_token = secrets.token_urlsafe(32)
        if _operation(supabase, "claim_provision", {"lease_token": candidate_token}) is not True:
            return False
        lease_token = candidate_token

        # No retries or redirect following: POST completion can be ambiguous.
        with requests.Session() as http:
            http.trust_env = False
            http.headers.update({
                "Authorization": f"Bearer {supa_key}",
                "apikey": supa_key,
                "Content-Type": "application/json",
                "Accept": "application/json",
            })
            existing = http.get(
                f"{admin_url}/{_IDENTIFIER}", timeout=_TIMEOUT, allow_redirects=False
            )
            if existing.status_code == 200:
                return _fail(supabase, lease_token, "provider_conflict")
            if not _is_missing(existing):
                return _fail(supabase, lease_token, "provider_lookup_failed")

            client_secret = secrets.token_urlsafe(48)
            client_secret_hash = hashlib.sha256(client_secret.encode("ascii")).hexdigest()
            body = {
                "provider_type": "oauth2",
                "identifier": _IDENTIFIER,
                "name": "経済NEWSパスキー",
                "client_id": _CLIENT_ID,
                "client_secret": client_secret,
                "scopes": ["profile"],
                "authorization_url": f"{_SITE}/auth/passkey/authorize",
                "token_url": f"{_SITE}/auth/passkey/token",
                "userinfo_url": f"{_SITE}/auth/passkey/userinfo",
                "pkce_enabled": True,
                "email_optional": True,
                "enabled": True,
            }
            created = http.post(
                admin_url, json=body, timeout=_TIMEOUT, allow_redirects=False
            )
            provider_id = _created_id(created, body)
            if not provider_id:
                return _fail(supabase, lease_token, "provider_create_failed")

        finished = _operation(supabase, "finish_provision", {
            "lease_token": lease_token,
            "client_secret_hash": client_secret_hash,
            "provider_id": provider_id,
        })
        if finished is not True:
            return _fail(supabase, lease_token, "provider_commit_rejected")
        return True
    except Exception:
        if lease_token is not None:
            return _fail(supabase, lease_token, "provider_setup_incomplete")
        # Missing migration/config or transient DB failure must leave other
        # authentication methods and application startup working normally.
        _LOG.warning("Passkey provider setup is unavailable.")
        return False

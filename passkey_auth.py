"""A narrow, email-free OAuth2 issuer backed by discoverable WebAuthn credentials.

Supabase is the OAuth2 client and remains the application's session issuer. All
mutable authentication state lives in the service-role-only Postgres RPC; this
module deliberately has no process-local challenge, account or token cache.
"""

import base64
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import uuid
from urllib.parse import unquote_plus, urlencode

from flask import Blueprint, g, jsonify, make_response, render_template, request
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers.structs import (
    AttestationConveyancePreference,
    AuthenticatorSelectionCriteria,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)


ORIGIN = "https://investment-bot-ta24.onrender.com"
RP_ID = "investment-bot-ta24.onrender.com"
CLIENT_ID = "economic-news-passkey"
REDIRECT_URI = "https://bvfndgjiahjqdlnyygnx.supabase.co/auth/v1/callback"
PREFIX = "/auth/passkey"
COOKIE_NAME = "__Host-passkey_flow"
MAX_BODY = 32768
GENERIC_ERROR = "認証を完了できませんでした。もう一度お試しください。"
TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_-]{43}\Z")
PKCE_PATTERN = re.compile(r"[A-Za-z0-9._~-]{43,128}\Z")
HASH_PATTERN = re.compile(r"[0-9a-f]{64}\Z")


class AuthenticationError(Exception):
    def __init__(self, status=400, oauth_error="invalid_request"):
        self.status = status
        self.oauth_error = oauth_error


class SupabasePasskeyRepository:
    """The only production storage adapter. RPC enforces expiry and atomicity."""

    def __init__(self, supabase):
        self.supabase = supabase

    def call(self, action, data=None):
        return self.supabase.rpc(
            "passkey_auth_operation", {"p_action": action, "p_data": data or {}}
        ).execute().data


def _hash(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _encode(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode(value, max_length=8192):
    if not isinstance(value, str) or not 1 <= len(value) <= max_length:
        raise AuthenticationError()
    if re.fullmatch(r"[A-Za-z0-9_-]+", value) is None:
        raise AuthenticationError()
    try:
        result = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
    except (ValueError, TypeError):
        raise AuthenticationError() from None
    if _encode(result) != value:
        raise AuthenticationError()
    return result


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise AuthenticationError()
        result[key] = value
    return result


def _json(value):
    try:
        return json.loads(value, object_pairs_hook=_unique_object)
    except (ValueError, TypeError, UnicodeError):
        raise AuthenticationError() from None


def _field(values, key, max_length=2048, required=True):
    entries = values.getlist(key)
    if not entries and not required:
        return ""
    if len(entries) != 1 or not 1 <= len(entries[0]) <= max_length:
        raise AuthenticationError()
    if any(ord(char) < 32 or ord(char) == 127 for char in entries[0]):
        raise AuthenticationError()
    return entries[0]


def create_passkey_blueprint(supabase, *, repository=None):
    """Create the issuer routes. ``repository`` is an explicit test seam only."""
    repo = repository if repository is not None else SupabasePasskeyRepository(supabase)
    blueprint = Blueprint("passkey_auth", __name__, url_prefix=PREFIX)

    def config():
        value = repo.call("config")
        if (not isinstance(value, dict) or value.get("enabled") is not True
                or not isinstance(value.get("client_secret_hash"), str)
                or HASH_PATTERN.fullmatch(value["client_secret_hash"]) is None):
            raise AuthenticationError(503, "temporarily_unavailable")
        return value

    def rate_limit(scope, limit, seconds, identity=None):
        peer = request.remote_addr or "unknown"
        # Render's public ingress overwrites CF-Connecting-IP. Its WSGI peer is a
        # shared proxy, which would otherwise throttle every user in one bucket.
        # Outside Render no forwarded header is trusted; X-Forwarded-For is never used.
        if os.environ.get("RENDER") == "true":
            try:
                peer = str(ipaddress.ip_address(request.headers.get("CF-Connecting-IP", "")))
            except ValueError:
                pass
        key = _hash(scope + ":" + (identity or peer))
        if repo.call("rate_limit", {"key": key, "limit": limit, "window_seconds": seconds}) is not True:
            raise AuthenticationError(429, "temporarily_unavailable")

    @blueprint.before_request
    def guard_request():
        if request.endpoint == "passkey_auth.status":
            return None
        if request.method == "POST":
            if request.content_length is None or request.content_length > MAX_BODY:
                raise AuthenticationError(413)
        if len(request.query_string) > 8192:
            raise AuthenticationError(413)
        g.passkey_config = config()

    @blueprint.after_request
    def secure_response(response):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; connect-src 'self'; font-src 'self'; "
            "base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'"
        )
        response.headers["Permissions-Policy"] = (
            "publickey-credentials-create=(self), publickey-credentials-get=(self)"
        )
        # Some applications apply global CORS headers; credentials must stay same-origin.
        for name in ("Access-Control-Allow-Origin", "Access-Control-Allow-Credentials"):
            response.headers.pop(name, None)
        return response

    @blueprint.errorhandler(AuthenticationError)
    def authentication_error(error):
        if request.endpoint in ("passkey_auth.token", "passkey_auth.userinfo"):
            response = jsonify(error=error.oauth_error, error_description=GENERIC_ERROR)
            if error.status == 401:
                scheme = "Basic" if request.endpoint == "passkey_auth.token" else "Bearer"
                response.headers["WWW-Authenticate"] = scheme + ' realm="passkey"'
        else:
            response = jsonify(error=GENERIC_ERROR)
        response.status_code = error.status
        return response

    @blueprint.errorhandler(Exception)
    def unexpected_error(_error):
        # Neither library exceptions nor database responses may expose credentials.
        return authentication_error(AuthenticationError(503, "temporarily_unavailable"))

    @blueprint.get("/status")
    def status():
        try:
            config()
            enabled = True
        except Exception:
            enabled = False
        return jsonify(enabled=enabled)

    @blueprint.get("/authorize")
    def authorize():
        client_id = _field(request.args, "client_id")
        redirect_uri = _field(request.args, "redirect_uri")
        response_type = _field(request.args, "response_type")
        state = _field(request.args, "state")
        code_challenge = _field(request.args, "code_challenge", 43)
        method = _field(request.args, "code_challenge_method", 10)
        if (client_id != CLIENT_ID or redirect_uri != REDIRECT_URI or response_type != "code"
                or method != "S256" or TOKEN_PATTERN.fullmatch(code_challenge) is None):
            raise AuthenticationError()
        # Decode too: noncanonical base64url must never create a valid OAuth flow.
        if len(_decode(code_challenge)) != 32:
            raise AuthenticationError()
        hint = _field(request.args, "screen_hint", 32, required=False)
        mode = "signup" if hint == "signup" else "login"
        rate_limit("authorize", 60, 600)
        flow_token, csrf_token = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        if repo.call("create_flow", {
            "flow_hash": _hash(flow_token), "csrf_hash": _hash(csrf_token), "mode": mode,
            "account_id": str(uuid.uuid4()), "client_id": client_id,
            "redirect_uri": redirect_uri, "state": state, "code_challenge": code_challenge,
        }) is not True:
            raise AuthenticationError(503, "temporarily_unavailable")
        response = make_response(render_template("passkey_auth.html", csrf_token=csrf_token, mode=mode))
        response.set_cookie(COOKIE_NAME, flow_token, max_age=600, secure=True, httponly=True,
                            samesite="Lax", path="/")
        return response

    def browser_request(mode):
        if request.headers.get("Origin") != ORIGIN or request.mimetype != "application/json":
            raise AuthenticationError(403)
        flow_token = request.cookies.get(COOKIE_NAME, "")
        csrf_token = request.headers.get("X-CSRF-Token", "")
        if TOKEN_PATTERN.fullmatch(flow_token) is None or TOKEN_PATTERN.fullmatch(csrf_token) is None:
            raise AuthenticationError(403)
        flow_hash = _hash(flow_token)
        rate_limit("ceremony", 30, 600, identity=flow_hash)
        flow = repo.call("get_flow", {"flow_hash": flow_hash})
        if (not isinstance(flow, dict) or flow.get("mode") != mode
                or not hmac.compare_digest(flow.get("csrf_hash", ""), _hash(csrf_token))):
            raise AuthenticationError(403)
        body = _json(request.get_data(cache=False))
        if not isinstance(body, dict):
            raise AuthenticationError()
        return flow, {"flow_hash": flow_hash, "csrf_hash": _hash(csrf_token)}, body

    def save_options(mode, kind):
        flow, binding, _body = browser_request(mode)
        challenge = secrets.token_bytes(32)
        if kind == "registration":
            account_id = uuid.UUID(flow["account_id"])
            options = generate_registration_options(
                rp_id=RP_ID, rp_name="経済NEWS", user_id=account_id.bytes,
                user_name="経済NEWS " + str(account_id)[:8], user_display_name="経済NEWSユーザー",
                challenge=challenge, timeout=60000, attestation=AttestationConveyancePreference.NONE,
                authenticator_selection=AuthenticatorSelectionCriteria(
                    resident_key=ResidentKeyRequirement.REQUIRED,
                    user_verification=UserVerificationRequirement.REQUIRED,
                ),
            )
        else:
            options = generate_authentication_options(
                rp_id=RP_ID, challenge=challenge, timeout=60000,
                user_verification=UserVerificationRequirement.REQUIRED,
            )
        binding.update(kind=kind, challenge=_encode(challenge), challenge_version=secrets.token_urlsafe(32))
        if repo.call("set_challenge", binding) is not True:
            raise AuthenticationError()
        return jsonify(json.loads(options_to_json(options)))

    @blueprint.post("/registration/options")
    def registration_options():
        return save_options("signup", "registration")

    @blueprint.post("/authentication/options")
    def authentication_options():
        return save_options("login", "authentication")

    def claim_response(mode, kind):
        _flow, binding, body = browser_request(mode)
        binding["kind"] = kind
        flow = repo.call("claim_challenge", binding)
        if not isinstance(flow, dict):
            raise AuthenticationError()
        credential = body.get("credential")
        if not isinstance(credential, dict) or not isinstance(credential.get("response"), dict):
            raise AuthenticationError()
        credential_id = _decode(credential.get("id"), 2048)
        if credential_id != _decode(credential.get("rawId"), 2048):
            raise AuthenticationError()
        client_data = _json(_decode(credential["response"].get("clientDataJSON"), 16384))
        if (not isinstance(client_data, dict) or client_data.get("crossOrigin", False) is not False
                or client_data.get("topOrigin") is not None):
            raise AuthenticationError()
        return flow, binding, credential

    def complete(flow, binding, action, details):
        code = secrets.token_urlsafe(32)
        payload = {"flow_hash": binding["flow_hash"], "challenge_version": flow["challenge_version"],
                   "code_hash": _hash(code), **details}
        if repo.call(action, payload) is not True:
            raise AuthenticationError()
        # The callback is a constant, never a client-controlled return URL.
        response = jsonify(redirect_url=REDIRECT_URI + "?" + urlencode({"code": code, "state": flow["state"]}))
        response.delete_cookie(COOKIE_NAME, path="/", secure=True, httponly=True, samesite="Lax")
        return response

    @blueprint.post("/registration/verify")
    def registration_verify():
        flow, binding, credential = claim_response("signup", "registration")
        try:
            verified = verify_registration_response(
                credential=credential, expected_challenge=_decode(flow["challenge"]),
                expected_rp_id=RP_ID, expected_origin=ORIGIN, require_user_verification=True,
                require_user_presence=True,
            )
        except Exception:
            raise AuthenticationError() from None
        return complete(flow, binding, "finish_registration", {
            "credential_id": _encode(verified.credential_id),
            "public_key": _encode(verified.credential_public_key), "sign_count": verified.sign_count,
        })

    @blueprint.post("/authentication/verify")
    def authentication_verify():
        flow, binding, credential = claim_response("login", "authentication")
        stored = repo.call("get_credential", {"credential_id": credential["id"]})
        if not isinstance(stored, dict):
            raise AuthenticationError()
        # A discoverable credential must identify its durable owner; do not trust any
        # browser-provided user ID or look up an account by display name/email.
        handle = _decode(credential["response"].get("userHandle"), 128)
        if not hmac.compare_digest(handle, uuid.UUID(stored["account_id"]).bytes):
            raise AuthenticationError()
        try:
            verified = verify_authentication_response(
                credential=credential, expected_challenge=_decode(flow["challenge"]),
                expected_rp_id=RP_ID, expected_origin=ORIGIN,
                credential_public_key=_decode(stored["public_key"]),
                credential_current_sign_count=stored["sign_count"], require_user_verification=True,
            )
        except Exception:
            raise AuthenticationError() from None
        return complete(flow, binding, "finish_authentication", {
            "credential_id": _encode(verified.credential_id), "credential_version": stored["version"],
            "previous_sign_count": stored["sign_count"], "sign_count": verified.new_sign_count,
        })

    @blueprint.post("/token")
    def token():
        if request.mimetype != "application/x-www-form-urlencoded":
            raise AuthenticationError()
        rate_limit("token", 180, 60)
        form = request.form
        for key in form:
            if len(form.getlist(key)) != 1:
                raise AuthenticationError()
        authorization = request.headers.get("Authorization", "")
        if authorization:
            if (len(authorization) > 2048 or not authorization.startswith("Basic ")
                    or "client_secret" in form or "client_id" in form):
                raise AuthenticationError(401, "invalid_client")
            try:
                value = base64.b64decode(authorization[6:], validate=True).decode("utf-8")
                client_id, client_secret = value.split(":", 1)
                client_id, client_secret = unquote_plus(client_id), unquote_plus(client_secret)
            except (ValueError, UnicodeError):
                raise AuthenticationError(401, "invalid_client") from None
        else:
            client_id = _field(form, "client_id", 256)
            client_secret = _field(form, "client_secret", 512)
        if not 1 <= len(client_secret) <= 512:
            raise AuthenticationError(401, "invalid_client")
        valid_client = hmac.compare_digest(client_id.encode("utf-8"), CLIENT_ID.encode("utf-8"))
        valid_secret = hmac.compare_digest(_hash(client_secret), g.passkey_config["client_secret_hash"])
        if not (valid_client and valid_secret):
            raise AuthenticationError(401, "invalid_client")
        if _field(form, "grant_type", 32) != "authorization_code":
            raise AuthenticationError(400, "unsupported_grant_type")
        code = _field(form, "code", 43)
        verifier = _field(form, "code_verifier", 128)
        redirect_uri = _field(form, "redirect_uri")
        if TOKEN_PATTERN.fullmatch(code) is None or PKCE_PATTERN.fullmatch(verifier) is None or redirect_uri != REDIRECT_URI:
            raise AuthenticationError(400, "invalid_grant")
        access_token = secrets.token_urlsafe(32)
        exchanged = repo.call("exchange_code", {
            "code_hash": _hash(code), "client_id": client_id, "redirect_uri": redirect_uri,
            "code_challenge": _encode(hashlib.sha256(verifier.encode("ascii")).digest()),
            "access_token_hash": _hash(access_token),
        })
        if not isinstance(exchanged, dict) or not exchanged.get("account_id"):
            raise AuthenticationError(400, "invalid_grant")
        return jsonify(access_token=access_token, token_type="Bearer", expires_in=300)

    @blueprint.get("/userinfo")
    def userinfo():
        rate_limit("userinfo", 240, 60)
        authorization = request.headers.get("Authorization", "")
        if not authorization.startswith("Bearer ") or TOKEN_PATTERN.fullmatch(authorization[7:]) is None:
            raise AuthenticationError(401, "invalid_token")
        owner = repo.call("userinfo", {"access_token_hash": _hash(authorization[7:])})
        if not isinstance(owner, dict) or not owner.get("account_id"):
            raise AuthenticationError(401, "invalid_token")
        return jsonify(sub=str(uuid.UUID(owner["account_id"])), name="経済NEWSユーザー")

    return blueprint

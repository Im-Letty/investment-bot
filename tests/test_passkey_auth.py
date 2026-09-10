"""Exercise the real WebAuthn verifier with a software test authenticator.

The fake repository models the SQL transaction contract and has a controllable
clock. These tests do not claim to replace integration testing the SQL grants,
locking or the configured Supabase OAuth provider.
"""

import base64
import copy
import hashlib
import json
import re
import secrets
import struct
import threading
import uuid
from urllib.parse import parse_qs, urlsplit

import cbor2
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from flask import Flask
from jinja2 import DictLoader
from werkzeug.datastructures import MultiDict

from passkey_auth import (
    CLIENT_ID, COOKIE_NAME, GENERIC_ERROR, MAX_BODY, ORIGIN, PREFIX,
    REDIRECT_URI, RP_ID, SupabasePasskeyRepository, create_passkey_blueprint,
)


def b64(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def sha(value):
    return hashlib.sha256(value.encode()).hexdigest()


class FakeRepository:
    def __init__(self):
        self.now = 1000
        self.config = {"enabled": True, "client_secret_hash": sha("test-secret")}
        self.flows = {}
        self.credentials = {}
        self.accounts = set()
        self.tokens = {}
        self.calls = []
        self.rates = {}
        self.fail = False
        self.lock = threading.Lock()

    def call(self, action, data=None):
        with self.lock:
            if self.fail:
                raise RuntimeError("database-secret-must-not-leak")
            data = data or {}
            self.calls.append((action, copy.deepcopy(data)))
            return copy.deepcopy(self._call(action, data))

    def _call(self, action, data):
        if action == "config":
            return self.config
        if action == "rate_limit":
            key = (data["key"], self.now // data["window_seconds"])
            self.rates[key] = self.rates.get(key, 0) + 1
            return self.rates[key] <= data["limit"]
        if action == "create_flow":
            self.flows[data["flow_hash"]] = dict(data, expires=self.now + 600, completed=False)
            return True
        if action == "get_credential":
            return self.credentials.get(data["credential_id"])
        if action == "exchange_code":
            for flow in self.flows.values():
                if (flow.get("code_hash") == data["code_hash"] and flow["completed"]
                        and not flow.get("consumed") and flow["code_expires"] > self.now
                        and all(flow[field] == data[field] for field in ("client_id", "redirect_uri", "code_challenge"))):
                    flow["consumed"] = True
                    self.tokens[data["access_token_hash"]] = {"account_id": flow["account_id"], "expires": self.now + 300}
                    return {"account_id": flow["account_id"]}
            return None
        if action == "userinfo":
            token = self.tokens.get(data["access_token_hash"])
            return {"account_id": token["account_id"]} if token and token["expires"] > self.now else None
        flow = self.flows.get(data.get("flow_hash"))
        if not flow or flow["completed"] or flow["expires"] <= self.now:
            return None
        if action == "get_flow":
            return flow
        if action in ("set_challenge", "claim_challenge"):
            expected_kind = "registration" if flow["mode"] == "signup" else "authentication"
            if data["csrf_hash"] != flow["csrf_hash"] or data["kind"] != expected_kind:
                return None
            if action == "set_challenge":
                flow.update({key: data[key] for key in ("challenge", "challenge_version", "kind")})
                flow.update(challenge_expires=self.now + 300, claimed=False)
                return True
            if flow.get("claimed", True) or flow["challenge_expires"] <= self.now or flow["kind"] != data["kind"]:
                return None
            flow["claimed"] = True
            return flow
        if action in ("finish_registration", "finish_authentication"):
            if (not flow.get("claimed") or flow["challenge_expires"] <= self.now
                    or flow["challenge_version"] != data["challenge_version"]):
                return False
            if action == "finish_registration":
                if flow["mode"] != "signup" or data["credential_id"] in self.credentials:
                    return False
                self.accounts.add(flow["account_id"])
                self.credentials[data["credential_id"]] = {
                    "credential_id": data["credential_id"], "account_id": flow["account_id"],
                    "public_key": data["public_key"], "sign_count": data["sign_count"], "version": 0,
                }
            else:
                credential = self.credentials.get(data["credential_id"])
                if (flow["mode"] != "login" or not credential
                        or credential["version"] != data["credential_version"]
                        or credential["sign_count"] != data["previous_sign_count"]
                        or not (data["sign_count"] == credential["sign_count"] == 0
                                or data["sign_count"] > credential["sign_count"])):
                    return False
                credential["sign_count"] = data["sign_count"]
                credential["version"] += 1
                flow["account_id"] = credential["account_id"]
            flow.update(completed=True, code_hash=data["code_hash"], code_expires=self.now + 60)
            return True
        raise AssertionError("unexpected operation: " + action)


class Authenticator:
    def __init__(self):
        self.private_key = ec.generate_private_key(ec.SECP256R1())
        self.credential_id = secrets.token_bytes(32)
        key = self.private_key.public_key().public_numbers()
        self.public_key = cbor2.dumps({1: 2, 3: -7, -1: 1, -2: key.x.to_bytes(32, "big"), -3: key.y.to_bytes(32, "big")})
        self.handle = None

    def client_data(self, options, ceremony, origin, **overrides):
        return json.dumps({"type": ceremony, "challenge": options["challenge"],
                           "origin": origin, "crossOrigin": False, **overrides}).encode()

    def registration(self, options, *, origin=ORIGIN, rp=RP_ID, flags=0x45, **overrides):
        self.handle = options["user"]["id"]
        client_data = self.client_data(options, "webauthn.create", origin, **overrides)
        auth_data = (hashlib.sha256(rp.encode()).digest() + bytes([flags]) + struct.pack(">I", 0)
                     + b"\x00" * 16 + struct.pack(">H", len(self.credential_id))
                     + self.credential_id + self.public_key)
        attestation = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
        return {"id": b64(self.credential_id), "rawId": b64(self.credential_id), "type": "public-key",
                "response": {"clientDataJSON": b64(client_data), "attestationObject": b64(attestation)}}

    def authentication(self, options, *, origin=ORIGIN, rp=RP_ID, flags=0x05, count=1, **overrides):
        client_data = self.client_data(options, "webauthn.get", origin, **overrides)
        auth_data = hashlib.sha256(rp.encode()).digest() + bytes([flags]) + struct.pack(">I", count)
        signature = self.private_key.sign(auth_data + hashlib.sha256(client_data).digest(), ec.ECDSA(hashes.SHA256()))
        return {"id": b64(self.credential_id), "rawId": b64(self.credential_id), "type": "public-key",
                "response": {"clientDataJSON": b64(client_data), "authenticatorData": b64(auth_data),
                             "signature": b64(signature), "userHandle": self.handle}}


@pytest.fixture
def issuer():
    repo = FakeRepository()
    app = Flask(__name__)
    app.config.update(TESTING=True)
    app.jinja_loader = DictLoader({"passkey_auth.html": '<meta name="csrf" content="{{ csrf_token }}"><div>{{ mode }}</div>'})
    app.register_blueprint(create_passkey_blueprint(None, repository=repo))
    return app, app.test_client(), repo


def begin(client, mode="signup", **overrides):
    verifier = secrets.token_urlsafe(32)
    params = {"client_id": CLIENT_ID, "redirect_uri": REDIRECT_URI, "response_type": "code",
              "state": "state-with&escaped=value", "code_challenge_method": "S256",
              "code_challenge": b64(hashlib.sha256(verifier.encode()).digest()), "screen_hint": mode}
    params.update(overrides)
    response = client.get(PREFIX + "/authorize", query_string=params, base_url=ORIGIN)
    assert response.status_code == 200, response.json
    csrf = re.search(r'content="([^"]+)"', response.text).group(1)
    return csrf, verifier, response


def post(client, route, csrf, data=None, **kwargs):
    headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf}
    headers.update(kwargs.pop("headers", {}))
    return client.post(PREFIX + route, json=data if data is not None else {}, headers=headers, base_url=ORIGIN, **kwargs)


def register(client, authenticator=None):
    authenticator = authenticator or Authenticator()
    csrf, verifier, _ = begin(client)
    options = post(client, "/registration/options", csrf).json
    response = post(client, "/registration/verify", csrf, {"credential": authenticator.registration(options)})
    assert response.status_code == 200, response.json
    return authenticator, verifier, response


def code_from(response):
    parsed = urlsplit(response.json["redirect_url"])
    assert parsed.scheme + "://" + parsed.netloc + parsed.path == REDIRECT_URI
    values = parse_qs(parsed.query)
    assert values["state"] == ["state-with&escaped=value"]
    return values["code"][0]


def exchange(client, code, verifier, *, basic=True, secret="test-secret", **overrides):
    form = {"grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT_URI, "code_verifier": verifier}
    form.update(overrides)
    headers = {}
    if basic:
        headers["Authorization"] = "Basic " + base64.b64encode((CLIENT_ID + ":" + secret).encode()).decode()
    else:
        form.update(client_id=CLIENT_ID, client_secret=secret)
    return client.post(PREFIX + "/token", data=form, headers=headers, base_url=ORIGIN)


def test_first_use_creates_nothing_until_verified_and_uses_hardened_options(issuer):
    _app, client, repo = issuer
    csrf, _verifier, response = begin(client)
    cookie = response.headers["Set-Cookie"]
    assert COOKIE_NAME in cookie and "Secure" in cookie and "HttpOnly" in cookie and "SameSite=Lax" in cookie
    assert "Domain=" not in cookie and "Path=/" in cookie
    options = post(client, "/registration/options", csrf).json
    assert options["rp"]["id"] == RP_ID
    assert options["authenticatorSelection"] == {"residentKey": "required", "requireResidentKey": True, "userVerification": "required"}
    assert options["attestation"] == "none"
    assert len(base64.urlsafe_b64decode(options["user"]["id"] + "==")) == 16
    assert repo.accounts == set() and repo.credentials == {} and repo.tokens == {}
    repo.now += 601  # cancellation/abandonment expires without creating an account
    assert post(client, "/registration/options", csrf).status_code == 403
    assert repo.accounts == set()


def test_real_registration_login_oauth_exchange_returns_same_email_free_subject(issuer):
    _app, client, repo = issuer
    authenticator, verifier, response = register(client)
    code = code_from(response)
    assert len(repo.accounts) == len(repo.credentials) == 1
    assert client.get_cookie(COOKIE_NAME, domain=RP_ID) is None
    token = exchange(client, code, verifier)
    assert token.status_code == 200
    assert token.json["token_type"] == "Bearer" and token.json["expires_in"] == 300
    user = client.get(PREFIX + "/userinfo", headers={"Authorization": "Bearer " + token.json["access_token"]}, base_url=ORIGIN)
    assert user.json == {"sub": next(iter(repo.accounts)), "name": "経済NEWSユーザー"}
    csrf, verifier, _response = begin(client, "login")
    options = post(client, "/authentication/options", csrf).json
    assert not options.get("allowCredentials") and options["userVerification"] == "required"
    response = post(client, "/authentication/verify", csrf, {"credential": authenticator.authentication(options)})
    assert response.status_code == 200
    token = exchange(client, code_from(response), verifier, basic=False)
    assert token.status_code == 200
    owner = client.get(PREFIX + "/userinfo", headers={"Authorization": "Bearer " + token.json["access_token"]}, base_url=ORIGIN)
    assert owner.json == user.json
    assert len(repo.accounts) == 1
    # The database sees hashes only for all bearer secrets and codes.
    serialized_calls = json.dumps(repo.calls)
    assert code not in serialized_calls and token.json["access_token"] not in serialized_calls and "test-secret" not in serialized_calls


@pytest.mark.parametrize("overrides", [
    {"origin": "https://attacker.example"}, {"rp": "attacker.example"}, {"flags": 0x41},
    {"flags": 0x44}, {"challenge": b64(b"bad-challenge")}, {"crossOrigin": True},
    {"topOrigin": "https://attacker.example"},
])
def test_registration_rejects_wrong_origin_rp_uv_presence_challenge_or_frame(issuer, overrides):
    _app, client, repo = issuer
    csrf, _verifier, _ = begin(client)
    options = post(client, "/registration/options", csrf).json
    authenticator = Authenticator()
    credential = authenticator.registration(options, **overrides)
    assert post(client, "/registration/verify", csrf, {"credential": credential}).status_code == 400
    assert not repo.accounts and not repo.credentials
    # An attempted verification consumes the challenge, even if cryptography fails.
    good = authenticator.registration(options)
    assert post(client, "/registration/verify", csrf, {"credential": good}).status_code == 400


@pytest.mark.parametrize("change", ["signature", "handle", "missing_handle", "unknown_id", "counter", "uv", "origin", "rp", "challenge"])
def test_authentication_rejects_unbound_or_invalid_assertions(issuer, change):
    _app, client, repo = issuer
    authenticator, _verifier, _response = register(client)
    csrf, _verifier, _ = begin(client, "login")
    options = post(client, "/authentication/options", csrf).json
    kwargs = {"flags": 0x01} if change == "uv" else {}
    if change in ("origin", "rp"):
        kwargs[change] = "https://evil.example" if change == "origin" else "evil.example"
    if change == "challenge":
        kwargs["challenge"] = b64(b"wrong")
    credential = authenticator.authentication(options, **kwargs)
    if change == "signature":
        credential["response"]["signature"] = b64(b"invalid")
    elif change == "handle":
        credential["response"]["userHandle"] = b64(uuid.uuid4().bytes)
    elif change == "missing_handle":
        credential["response"].pop("userHandle")
    elif change == "unknown_id":
        credential["id"] = credential["rawId"] = b64(secrets.token_bytes(32))
    elif change == "counter":
        repo.credentials[b64(authenticator.credential_id)]["sign_count"] = 1
    before = len([flow for flow in repo.flows.values() if flow["completed"]])
    assert post(client, "/authentication/verify", csrf, {"credential": credential}).status_code == 400
    assert len([flow for flow in repo.flows.values() if flow["completed"]]) == before


def test_zero_counter_passkey_allowed_but_credential_version_race_rejected(issuer, monkeypatch):
    _app, client, repo = issuer
    authenticator, _verifier, _response = register(client)
    csrf, _verifier, _ = begin(client, "login")
    options = post(client, "/authentication/options", csrf).json
    response = post(client, "/authentication/verify", csrf, {"credential": authenticator.authentication(options, count=0)})
    assert response.status_code == 200
    csrf, _verifier, _ = begin(client, "login")
    options = post(client, "/authentication/options", csrf).json
    original = repo.call

    def racing_call(action, data=None):
        if action == "finish_authentication":
            repo.credentials[b64(authenticator.credential_id)]["version"] += 1
        return original(action, data)

    monkeypatch.setattr(repo, "call", racing_call)
    assert post(client, "/authentication/verify", csrf, {"credential": authenticator.authentication(options, count=0)}).status_code == 400


@pytest.mark.parametrize("overrides", [{"secret": "wrong"}, {"code_verifier": "x" * 43},
    {"redirect_uri": "https://evil.example/callback"}, {"grant_type": "refresh_token"}])
def test_bad_token_exchange_does_not_consume_code(issuer, overrides):
    _app, client, _repo = issuer
    _authenticator, verifier, response = register(client)
    code = code_from(response)
    assert exchange(client, code, verifier, **overrides).status_code in (400, 401)
    assert exchange(client, code, verifier).status_code == 200
    assert exchange(client, code, verifier).status_code == 400


def test_code_and_access_token_expiry(issuer):
    _app, client, repo = issuer
    _authenticator, verifier, response = register(client)
    repo.now += 61
    assert exchange(client, code_from(response), verifier).status_code == 400
    _authenticator, verifier, response = register(client)
    token = exchange(client, code_from(response), verifier).json["access_token"]
    repo.now += 301
    assert client.get(PREFIX + "/userinfo", headers={"Authorization": "Bearer " + token}, base_url=ORIGIN).status_code == 401
    assert client.get(PREFIX + "/userinfo", query_string={"access_token": token}, base_url=ORIGIN).status_code == 401


@pytest.mark.parametrize("overrides", [{"client_id": "evil"}, {"redirect_uri": REDIRECT_URI + "/"},
    {"response_type": "token"}, {"state": ""}, {"code_challenge_method": "plain"}, {"code_challenge": "bad"}])
def test_authorization_validation_never_redirects_or_creates_account(issuer, overrides):
    _app, client, repo = issuer
    params = {"client_id": CLIENT_ID, "redirect_uri": REDIRECT_URI, "response_type": "code", "state": "state",
              "code_challenge_method": "S256", "code_challenge": b64(b"x" * 32), **overrides}
    response = client.get(PREFIX + "/authorize", query_string=params, base_url=ORIGIN)
    assert response.status_code == 400 and "Location" not in response.headers
    assert not repo.flows and not repo.accounts


def test_csrf_cookie_origin_purpose_body_size_and_rate_limits(issuer):
    app, client, repo = issuer
    csrf, _verifier, _ = begin(client)
    assert post(client, "/registration/options", csrf, headers={"Origin": "https://evil.example"}).status_code == 403
    assert post(client, "/registration/options", "x" * 43).status_code == 403
    assert post(app.test_client(), "/registration/options", csrf).status_code == 403
    assert post(client, "/authentication/options", csrf).status_code == 403
    assert post(client, "/registration/options", csrf, {"padding": "x" * MAX_BODY}).status_code == 413
    for _ in range(30):
        last = post(client, "/registration/options", csrf)
    assert last.status_code == 429
    assert not repo.accounts


def test_new_options_invalidate_old_challenge_and_expire(issuer):
    _app, client, repo = issuer
    csrf, _verifier, _ = begin(client)
    first = post(client, "/registration/options", csrf).json
    second = post(client, "/registration/options", csrf).json
    assert first["challenge"] != second["challenge"]
    assert post(client, "/registration/verify", csrf, {"credential": Authenticator().registration(first)}).status_code == 400
    third = post(client, "/registration/options", csrf).json
    repo.now += 301
    assert post(client, "/registration/verify", csrf, {"credential": Authenticator().registration(third)}).status_code == 400
    assert not repo.accounts


def test_duplicate_credential_cannot_create_second_account(issuer):
    _app, client, repo = issuer
    authenticator, _verifier, _response = register(client)
    csrf, _verifier, _ = begin(client)
    options = post(client, "/registration/options", csrf).json
    assert post(client, "/registration/verify", csrf, {"credential": authenticator.registration(options)}).status_code == 400
    assert len(repo.accounts) == len(repo.credentials) == 1


def test_malformed_json_and_duplicate_parameters(issuer):
    _app, client, _repo = issuer
    csrf, _verifier, _ = begin(client)
    headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf}
    response = client.post(PREFIX + "/registration/options", data='{"credential":{},"credential":{}}',
                           content_type="application/json", headers=headers, base_url=ORIGIN)
    assert response.status_code == 400
    response = client.post(PREFIX + "/token", data=MultiDict([("client_id", CLIENT_ID), ("client_id", "evil")]), base_url=ORIGIN)
    assert response.status_code == 400
    response = client.post(PREFIX + "/token", data={"client_id": CLIENT_ID},
                           headers={"Authorization": "Basic " + base64.b64encode((CLIENT_ID + ":test-secret").encode()).decode()}, base_url=ORIGIN)
    assert response.status_code == 401


def test_database_failure_or_disabled_config_fails_closed_without_details(issuer):
    _app, client, repo = issuer
    assert client.get(PREFIX + "/status", base_url=ORIGIN).json == {"enabled": True}
    repo.config["enabled"] = False
    assert client.get(PREFIX + "/status", base_url=ORIGIN).json == {"enabled": False}
    repo.config["enabled"] = True
    repo.fail = True
    assert client.get(PREFIX + "/status", base_url=ORIGIN).json == {"enabled": False}
    response = client.get(PREFIX + "/authorize", base_url=ORIGIN)
    assert response.status_code == 503 and response.json == {"error": GENERIC_ERROR}
    assert "database-secret" not in response.text
    assert response.headers["Cache-Control"] == "no-store"
    assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]
    assert "Access-Control-Allow-Origin" not in response.headers


def test_production_repository_uses_only_service_rpc():
    class Client:
        def rpc(self, name, payload):
            assert name == "passkey_auth_operation"
            assert payload == {"p_action": "config", "p_data": {}}
            return self

        def execute(self):
            self.data = {"enabled": False}
            return self

    assert SupabasePasskeyRepository(Client()).call("config") == {"enabled": False}


@pytest.mark.parametrize("render,header,expected", [
    (False, "203.0.113.8", "127.0.0.1"), (True, "203.0.113.8", "203.0.113.8"),
    (True, "203.0.113.8, 203.0.113.9", "127.0.0.1"), (True, "malformed", "127.0.0.1"),
])
def test_client_ip_headers_only_trusted_at_render_ingress(issuer, monkeypatch, render, header, expected):
    _app, client, repo = issuer
    if render:
        monkeypatch.setenv("RENDER", "true")
    else:
        monkeypatch.delenv("RENDER", raising=False)
    response = client.get(PREFIX + "/userinfo", headers={"CF-Connecting-IP": header, "X-Forwarded-For": "192.0.2.111"}, base_url=ORIGIN)
    assert response.status_code == 401
    rate = next(data for action, data in repo.calls if action == "rate_limit")
    assert rate["key"] == sha("userinfo:" + expected)


def test_challenge_survives_worker_restart_with_shared_repository(issuer):
    _app, client, repo = issuer
    csrf, _verifier, _ = begin(client)
    options = post(client, "/registration/options", csrf).json
    saved_cookie = client.get_cookie(COOKIE_NAME, domain=RP_ID).value
    restarted = Flask("restarted")
    restarted.config.update(TESTING=True)
    restarted.register_blueprint(create_passkey_blueprint(None, repository=repo))
    other_client = restarted.test_client()
    other_client.set_cookie(COOKIE_NAME, saved_cookie, domain=RP_ID, secure=True, httponly=True)
    response = post(other_client, "/registration/verify", csrf, {"credential": Authenticator().registration(options)})
    assert response.status_code == 200 and len(repo.accounts) == 1

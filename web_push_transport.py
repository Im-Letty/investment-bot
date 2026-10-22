"""Bounded Web Push transport: RFC 8291 aes128gcm and RFC 8292 VAPID.

Configuration is supplied by the caller. This module never reads environment
values, creates a persistent signing key, or reads a provider response body.
"""
import base64
import hashlib
import hmac
import ipaddress
import json
import math
import os
import re
import struct
import time
from urllib.parse import urlsplit

import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, utils
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_P256_ORDER = int("ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551", 16)
_HOSTS = frozenset(("fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"))
_ERRORS = frozenset(("invalid_subscription", "invalid_payload", "invalid_configuration", "push_unavailable"))
_B64 = re.compile(r"[A-Za-z0-9_-]+={0,2}\Z")
_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\Z")


class PushError(Exception):
    def __init__(self, reason):
        self.reason = reason if reason in _ERRORS else "push_unavailable"
        super().__init__(self.reason)


def _encode(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode(value, size):
    try:
        if type(value) is not str or len(value) > 200 or not _B64.fullmatch(value):
            raise ValueError()
        bare = value.rstrip("=")
        result = base64.b64decode(bare + "=" * (-len(bare) % 4), altchars=b"-_", validate=True)
        padded = base64.urlsafe_b64encode(result).decode("ascii")
        if len(result) != size or value not in (padded, padded.rstrip("=")):
            raise ValueError()
        return result
    except Exception:
        raise PushError("invalid_subscription") from None


def _endpoint(value):
    try:
        if (type(value) is not str or not 1 <= len(value) <= 2048
                or any(ord(c) <= 32 or ord(c) >= 127 for c in value) or "#" in value):
            raise ValueError()
        parsed = urlsplit(value)
        host = parsed.hostname
        if (parsed.scheme != "https" or not host or parsed.username is not None
                or parsed.password is not None or parsed.port not in (None, 443)
                or parsed.netloc.lower() not in (host, host + ":443")):
            raise ValueError()
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            raise ValueError()
        windows = (host.endswith(".notify.windows.com") and host != "notify.windows.com"
                   and len(host) <= 253 and all(_LABEL.fullmatch(x) for x in host.split(".")))
        if host not in _HOSTS and not windows:
            raise ValueError()
        # Canonical HTTPS authority also makes the JWT origin independent of :443.
        return parsed._replace(netloc=host).geturl(), "https://" + host
    except Exception:
        raise PushError("invalid_subscription") from None


def validate_subscription(value):
    """Return a detached canonical subscription or a fixed-code PushError."""
    try:
        if type(value) is not dict or set(value) != {"endpoint", "keys"}:
            raise ValueError()
        keys = value["keys"]
        if type(keys) is not dict or set(keys) != {"p256dh", "auth"}:
            raise ValueError()
        endpoint, _ = _endpoint(value["endpoint"])
        public = _decode(keys["p256dh"], 65)
        auth = _decode(keys["auth"], 16)
        if public[0] != 4:
            raise ValueError()
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), public)
        return {"endpoint": endpoint, "keys": {"p256dh": _encode(public), "auth": _encode(auth)}}
    except Exception:
        raise PushError("invalid_subscription") from None


def _public(key):
    return key.public_key().public_bytes(serialization.Encoding.X962,
                                          serialization.PublicFormat.UncompressedPoint)


def _expand(prk, info, length):
    # These derivations each need only the first SHA-256 HKDF expansion block.
    return hmac.new(prk, info + b"\x01", hashlib.sha256).digest()[:length]


def _encrypt(payload, receiver_public, auth):
    ephemeral = ec.generate_private_key(ec.SECP256R1())
    sender_public = _public(ephemeral)
    shared = ephemeral.exchange(ec.ECDH(),
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), receiver_public))
    authenticated = hmac.new(auth, shared, hashlib.sha256).digest()
    ikm = _expand(authenticated, b"WebPush: info\x00" + receiver_public + sender_public, 32)
    salt = os.urandom(16)
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    cek = _expand(prk, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _expand(prk, b"Content-Encoding: nonce\x00", 12)
    ciphertext = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)
    return salt + struct.pack("!IB", 4096, 65) + sender_public + ciphertext


def _subject(value):
    if (type(value) is not str or not 1 <= len(value) <= 512
            or any(ord(c) <= 32 or ord(c) >= 127 for c in value)):
        return False
    try:
        parsed = urlsplit(value)
        if parsed.scheme == "mailto":
            return bool(re.fullmatch(r"[^@/?#]+@[^@/?#]+\.[^@/?#]+", parsed.path)
                        and not parsed.netloc and not parsed.query and not parsed.fragment)
        return bool(parsed.scheme == "https" and parsed.hostname and parsed.port in (None, 443)
                    and parsed.username is None and parsed.password is None and not parsed.fragment)
    except ValueError:
        return False


class WebPushSender:
    def __init__(self, private_key, subject, transport=None, clock=time.time):
        self._key = None
        self._subject = ""
        self._transport = transport if transport is not None else requests
        self._clock = clock
        self.public_key = ""
        self.configured = False
        try:
            raw = _decode(private_key, 32)
            scalar = int.from_bytes(raw, "big")
            if not 0 < scalar < _P256_ORDER or not _subject(subject):
                return
            self._key = ec.derive_private_key(scalar, ec.SECP256R1())
            self._subject = subject
            self.public_key = _encode(_public(self._key))
            self.configured = True
        except Exception:
            pass

    def _authorization(self, audience):
        now = self._clock()
        if type(now) not in (int, float) or not math.isfinite(now) or now <= 0:
            raise PushError("push_unavailable")
        header = _encode(b'{"typ":"JWT","alg":"ES256"}')
        claims = _encode(json.dumps({"aud": audience, "exp": int(now) + 12 * 3600,
                                    "sub": self._subject}, separators=(",", ":")).encode("utf-8"))
        signed = (header + "." + claims).encode("ascii")
        r, s = utils.decode_dss_signature(self._key.sign(signed, ec.ECDSA(hashes.SHA256())))
        token = signed.decode("ascii") + "." + _encode(r.to_bytes(32, "big") + s.to_bytes(32, "big"))
        return "vapid t=" + token + ",k=" + self.public_key

    def send(self, subscription, payload, ttl=300):
        """One POST only. Provider bodies and raw transport exceptions are ignored."""
        if not self.configured:
            return "unavailable"
        response = None
        try:
            clean = validate_subscription(subscription)
            if type(ttl) is not int or not 60 <= ttl <= 86400 or type(payload) is not dict:
                raise PushError("invalid_payload")
            raw = json.dumps(payload, ensure_ascii=False, allow_nan=False,
                             separators=(",", ":"), sort_keys=True).encode("utf-8")
            if not 0 < len(raw) <= 2000:
                raise PushError("invalid_payload")
            body = _encrypt(raw, _decode(clean["keys"]["p256dh"], 65),
                            _decode(clean["keys"]["auth"], 16))
            # RFC8292 requires distinct key agreement and signing keys.
            if body[21:86] == _decode(self.public_key, 65):
                return "unavailable"
            _, audience = _endpoint(clean["endpoint"])
            headers = {"Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
                       "Authorization": self._authorization(audience), "TTL": str(ttl)}
            response = self._transport.post(clean["endpoint"], data=body, headers=headers,
                                            timeout=(2, 5), allow_redirects=False, stream=True)
            status = response.status_code
            if status in (201, 202):
                return "sent"
            if status in (404, 410):
                return "expired"
            return "unavailable"
        except Exception:
            return "unavailable"
        finally:
            if response is not None:
                try:
                    response.close()
                except Exception:
                    pass

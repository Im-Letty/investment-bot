"""Synthetic-only Web Push tests: no configuration, environment, or live HTTP."""
import base64
import copy
import hashlib
import hmac
import json
import struct
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, utils
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF, HKDFExpand

from web_push_transport import PushError, WebPushSender, validate_subscription, _encrypt


def enc(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def dec(value):
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def public(key):
    return key.public_key().public_bytes(serialization.Encoding.X962,
                                        serialization.PublicFormat.UncompressedPoint)


class Response:
    def __init__(self, status):
        self.status_code = status
        self.closed = False

    @property
    def content(self):
        raise AssertionError("Provider body must never be read")

    @property
    def text(self):
        raise AssertionError("Provider text must never be read")

    def json(self):
        raise AssertionError("Provider JSON must never be read")

    def close(self):
        self.closed = True


class Transport:
    def __init__(self, status=201, error=None):
        self.calls = []
        self.response = Response(status)
        self.error = error

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if self.error:
            raise RuntimeError(self.error)
        return self.response


class WebPushTests(unittest.TestCase):
    def setUp(self):
        # Fixed synthetic scalars are public test fixtures, never deployed keys.
        self.ua = ec.derive_private_key(7, ec.SECP256R1())
        self.subscription = {"endpoint": "https://fcm.googleapis.com/fcm/send/synthetic",
                             "keys": {"p256dh": enc(public(self.ua)), "auth": enc(b"0123456789abcdef")}}
        self.transport = Transport()
        self.sender = WebPushSender(enc((11).to_bytes(32, "big")), "mailto:notify@example.test",
                                    self.transport, clock=lambda: 1792648800)

    def test_configuration_public_key_and_fail_closed(self):
        self.assertTrue(self.sender.configured)
        self.assertEqual(dec(self.sender.public_key), public(ec.derive_private_key(11, ec.SECP256R1())))
        for key in (None, "", enc(b"\0" * 32), enc(b"\xff" * 32), "private/key", enc(b"x" * 31)):
            with self.subTest(key_kind=type(key).__name__):
                sender = WebPushSender(key, "mailto:notify@example.test", self.transport)
                self.assertFalse(sender.configured)
                self.assertEqual(sender.public_key, "")
                self.assertEqual(sender.send(self.subscription, {}), "unavailable")
        self.assertEqual(self.transport.calls, [])

    def test_contact_validation(self):
        for subject in ("", None, "http://example.test", "mailto:no-at", "https://u:p@example.test",
                        "mailto:a@example.test\r\nX: y", "https://example.test:444/contact"):
            self.assertFalse(WebPushSender(enc((11).to_bytes(32, "big")), subject).configured)
        self.assertTrue(WebPushSender(enc((11).to_bytes(32, "big")), "https://example.test/contact").configured)

    def test_subscription_allowlist_and_copy(self):
        for endpoint in ("https://fcm.googleapis.com/x", "https://updates.push.services.mozilla.com/wpush/v2/x",
                         "https://web.push.apple.com/x", "https://db5.notify.windows.com/?token=x",
                         "https://FCM.GOOGLEAPIS.COM:443/x"):
            with self.subTest(endpoint=endpoint):
                raw = copy.deepcopy(self.subscription); raw["endpoint"] = endpoint
                clean = validate_subscription(raw)
                self.assertIsNot(clean, raw)
                self.assertIsNot(clean["keys"], raw["keys"])
                self.assertIn("https://", clean["endpoint"])
        self.assertNotIn(":443", validate_subscription(dict(self.subscription,
                                                          endpoint="https://fcm.googleapis.com:443/x"))["endpoint"])

    def test_endpoint_rejects_ssrf_redirect_lookalikes_and_control_characters(self):
        bad = ["http://fcm.googleapis.com/x", "https://evil.test/x",
               "https://fcm.googleapis.com.evil.test/x", "https://evilfcm.googleapis.com/x",
               "https://fcm.googleapis.com@127.0.0.1/x", "https://u@fcm.googleapis.com/x",
               "https://fcm.googleapis.com:444/x", "https://127.0.0.1/x", "https://[::1]/x",
               "https://fcm.googleapis.com/x#", "https://fcm.googleapis.com/x#f",
               "https://notify.windows.com/x", "https://bad-.notify.windows.com/x",
               "https://fcm.googleapis.com./x", "https://fcm.googleapis.com:/x",
               "https://fcm.googleapis.com/\nX", "https://fcm.googleapis.com/" + "a" * 2048]
        for endpoint in bad:
            with self.subTest(kind=endpoint[:60]):
                self.assert_invalid(dict(self.subscription, endpoint=endpoint))

    def assert_invalid(self, value):
        with self.assertRaises(PushError) as raised:
            validate_subscription(value)
        self.assertEqual(raised.exception.reason, "invalid_subscription")
        self.assertEqual(str(raised.exception), "invalid_subscription")

    def test_subscription_shape_and_key_validation(self):
        for value in (None, [], {}, dict(self.subscription, owner_id="synthetic"),
                      dict(self.subscription, expirationTime=None),
                      dict(self.subscription, keys={"p256dh": self.subscription["keys"]["p256dh"]})):
            self.assert_invalid(value)
        for key, value in (("auth", enc(b"x" * 15)), ("auth", self.subscription["keys"]["auth"] + " "),
                           ("p256dh", enc(b"\x04" + b"\0" * 64)),
                           ("p256dh", enc(b"\x03" + b"\0" * 64)),
                           ("p256dh", enc(b"\x04" + b"\0" * 63)),
                           ("p256dh", "not+url/safe")):
            raw = copy.deepcopy(self.subscription); raw["keys"][key] = value
            self.assert_invalid(raw)

    def test_encryption_roundtrip_and_fresh_key_and_salt(self):
        payload = {"title": "お知らせ", "body": "やることがあります", "tag": "synthetic"}
        self.assertEqual(self.sender.send(self.subscription, payload), "sent")
        _, options = self.transport.calls[0]
        body = options["data"]; salt = body[:16]
        record_size, key_size = struct.unpack("!IB", body[16:21])
        sender_public = body[21:21 + key_size]
        self.assertEqual((record_size, key_size), (4096, 65))
        self.assertNotEqual(sender_public, dec(self.sender.public_key))
        shared = self.ua.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), sender_public))
        # Independent receiver uses cryptography's HKDF implementation.
        ikm = HKDF(algorithm=hashes.SHA256(), length=32, salt=dec(self.subscription["keys"]["auth"]),
                   info=b"WebPush: info\0" + public(self.ua) + sender_public).derive(shared)
        cek = HKDF(algorithm=hashes.SHA256(), length=16, salt=salt, info=b"Content-Encoding: aes128gcm\0").derive(ikm)
        nonce = HKDF(algorithm=hashes.SHA256(), length=12, salt=salt, info=b"Content-Encoding: nonce\0").derive(ikm)
        plain = AESGCM(cek).decrypt(nonce, body[86:], None)
        self.assertEqual(plain[-1:], b"\x02")
        self.assertEqual(json.loads(plain[:-1]), payload)
        self.assertEqual(self.sender.send(self.subscription, payload), "sent")
        body2 = self.transport.calls[1][1]["data"]
        self.assertNotEqual(body[:16], body2[:16])
        self.assertNotEqual(sender_public, body2[21:86])

    def test_RFC8291_section5_published_encryption_vector(self):
        # Published interoperable fixture, not a real endpoint or configuration.
        ua_public = dec("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4")
        auth = dec("BTBZMqHH6r4Tts7J_aSIgg")
        sender = ec.derive_private_key(int.from_bytes(dec("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"), "big"), ec.SECP256R1())
        expected = dec("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml"
                       "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT"
                       "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN")
        with patch("web_push_transport.ec.generate_private_key", return_value=sender), patch("web_push_transport.os.urandom", return_value=expected[:16]):
            actual = _encrypt(b"When I grow up, I want to be a watermelon", ua_public, auth)
        self.assertEqual(actual, expected)

    def test_VAPID_signature_origin_expiry_subject_and_HTTP_bounds(self):
        self.subscription["endpoint"] = "https://fcm.googleapis.com:443/fcm/send/synthetic"
        self.assertEqual(self.sender.send(self.subscription, {"title": "Reminder"}), "sent")
        endpoint, options = self.transport.calls[0]
        authorization = options["headers"]["Authorization"]
        token, public_key = authorization[len("vapid t="):].split(",k=")
        head, claims, signature = token.split(".")
        self.assertEqual(json.loads(dec(head)), {"typ": "JWT", "alg": "ES256"})
        claims = json.loads(dec(claims))
        self.assertEqual(claims, {"aud": "https://fcm.googleapis.com", "exp": 1792692000,
                                  "sub": "mailto:notify@example.test"})
        signature = dec(signature)
        self.assertEqual(len(signature), 64)
        pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), dec(public_key))
        pub.verify(utils.encode_dss_signature(int.from_bytes(signature[:32], "big"),
                                             int.from_bytes(signature[32:], "big")),
                   (head + "." + token.split(".")[1]).encode(), ec.ECDSA(hashes.SHA256()))
        self.assertEqual(options["timeout"], (2, 5))
        self.assertFalse(options["allow_redirects"])
        self.assertTrue(options["stream"])
        self.assertEqual(options["headers"]["Content-Encoding"], "aes128gcm")
        self.assertEqual(options["headers"]["Content-Type"], "application/octet-stream")
        self.assertEqual(options["headers"]["TTL"], "300")
        self.assertTrue(self.transport.response.closed)

    def test_provider_status_mapping_no_body_access_and_always_close(self):
        for code, outcome in ((201, "sent"), (202, "sent"), (404, "expired"), (410, "expired"),
                              (200, "unavailable"), (302, "unavailable"), (429, "unavailable"),
                              (500, "unavailable")):
            with self.subTest(code=code):
                transport = Transport(code)
                sender = WebPushSender(enc((11).to_bytes(32, "big")), "mailto:a@example.test", transport)
                self.assertEqual(sender.send(self.subscription, {}), outcome)
                self.assertEqual(len(transport.calls), 1)
                self.assertTrue(transport.response.closed)

    def test_invalid_payload_ttl_clock_and_error_redaction_no_retry(self):
        for payload, ttl in (([], 300), ({"text": "a" * 2000}, 300), ({"x": float("nan")}, 300),
                             ({"x": "\ud800"}, 300), ({}, 59), ({}, 86401), ({}, True), ({}, 300.0)):
            self.assertEqual(self.sender.send(self.subscription, payload, ttl), "unavailable")
        self.assertEqual(self.transport.calls, [])
        for clock in (lambda: float("nan"), lambda: -1, lambda: True):
            sender = WebPushSender(enc((11).to_bytes(32, "big")), "mailto:a@example.test", self.transport, clock)
            self.assertEqual(sender.send(self.subscription, {}), "unavailable")
        self.assertEqual(self.transport.calls, [])
        transport = Transport(error="SECRET_ENDPOINT_AND_KEY")
        sender = WebPushSender(enc((11).to_bytes(32, "big")), "mailto:a@example.test", transport)
        self.assertEqual(sender.send(self.subscription, {}), "unavailable")
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(str(PushError("SECRET_ENDPOINT_AND_KEY")), "push_unavailable")


if __name__ == "__main__":
    unittest.main()

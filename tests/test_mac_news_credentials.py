"""Offline tests: no real Keychain reads/writes, processes or network."""
import base64
from contextlib import nullcontext
import ctypes
import json
import pickle
import unittest
from unittest.mock import Mock, patch

from mac_news_credentials import (MacNewsCredentials, MacNewsCredentialsError,
                REVIEW_KEYS, STORAGE_KEYS, _NativeKeychain, validated_storage)


REVIEWS = {"ANTHROPIC_API_KEY": "fake-unused-claude", "GEMINI_API_KEY": "fake-gemini",
           "OPENAI_API_KEY": "fake-openai"}
STORAGE = {"SUPABASE_URL": "https://example-project.supabase.co", "SUPABASE_KEY": "sb_secret_fake-server"}


class Backend:
    def __init__(self, value=None):
        self.blob = json.dumps(value).encode() if value is not None else None
        self.reads, self.writes, self.attributes = 0, 0, 0

    def has(self):
        self.attributes += 1
        return self.blob is not None

    def read(self):
        self.reads += 1
        if self.blob is None:
            raise MacNewsCredentialsError("missing")
        return self.blob

    def write(self, blob):
        self.writes += 1
        self.blob = blob


class MacNewsCredentialsTests(unittest.TestCase):
    def setUp(self):
        self.review, self.storage = Backend(REVIEWS), Backend()
        self.value = MacNewsCredentials(review_backend=self.review, storage_backend=self.storage)

    def test_lazy_construct_does_not_initialize_native_framework(self):
        with patch("mac_news_credentials._NativeKeychain") as native:
            value = MacNewsCredentials()
            self.assertEqual(repr(value), "<MacNewsCredentials>")
            native.assert_not_called()

    def test_dry_status_only_requests_attributes(self):
        self.assertEqual(self.value.status(), {"review_keys_saved": True, "storage_saved": False, "errors": {}})
        self.assertEqual((self.review.reads, self.storage.reads, self.storage.writes), (0, 0, 0))
        self.assertEqual((self.review.attributes, self.storage.attributes), (1, 1))

    def test_live_review_load_returns_only_two_keys_and_no_claude(self):
        keys = self.value.load_review_keys()
        self.assertEqual(keys, {name: REVIEWS[name] for name in REVIEW_KEYS})
        self.assertNotIn("ANTHROPIC_API_KEY", keys)
        self.assertEqual((self.review.reads, self.review.writes, self.storage.reads), (1, 0, 0))
        self.assertNotIn(REVIEWS["ANTHROPIC_API_KEY"], repr(self.value))

    def test_save_atomic_pair_without_read_network_or_review_keys(self):
        self.value.save_storage(STORAGE)
        self.assertEqual(json.loads(self.storage.blob), STORAGE)
        self.assertEqual((self.storage.writes, self.storage.reads, self.review.reads), (1, 0, 0))
        self.assertEqual(self.value.load_storage(), STORAGE)
        self.assertEqual(self.storage.reads, 1)

    def test_no_credential_serialization(self):
        with self.assertRaisesRegex(TypeError, "^credential_serialization_disabled$"):
            pickle.dumps(self.value)

    def test_storage_url_is_exact_https_supabase_project_root(self):
        addresses = ("http://example.supabase.co", "https://supabase.co", "https://x.supabase.co.evil",
          "https://x.y.supabase.co", "https://x.supabase.co/path", "https://x.supabase.co:443",
          "https://x.supabase.co?query=a", "https://x.supabase.co#fragment", "https://me@x.supabase.co",
          "https://x.supabase.co/\n", "https://X.supabase.co", "https://x_supabase.co", "https://-x.supabase.co")
        for address in addresses:
            with self.subTest(address=address), self.assertRaisesRegex(MacNewsCredentialsError, "^invalid_connection$"):
                self.value.save_storage({**STORAGE, "SUPABASE_URL": address})
        self.assertEqual(self.storage.writes, 0)
        self.assertEqual(validated_storage({**STORAGE, "SUPABASE_URL": STORAGE["SUPABASE_URL"] + "/"}), STORAGE)

    def test_anonymous_and_masked_keys_rejected_before_native_backend(self):
        def jwt(role):
            return "a." + base64.urlsafe_b64encode(json.dumps({"role": role}).encode()).decode().rstrip("=") + ".c"
        bad = ("", "sb_publishable_fake", "sb_secret_", jwt("anon"), "●●●", "sb_secret_...",
               "SUPABASE_KEY=sb_secret_fake", "sb_secret_fake\n", "sb_secret_fake secret", "sb_secret_f*ke")
        for key in bad:
            with self.subTest(key=key), patch("mac_news_credentials._NativeKeychain") as native:
                with self.assertRaises(MacNewsCredentialsError):
                    MacNewsCredentials().save_storage({**STORAGE, "SUPABASE_KEY": key})
                native.assert_not_called()
        self.assertEqual(validated_storage({**STORAGE, "SUPABASE_KEY": jwt("service_role")})["SUPABASE_KEY"], jwt("service_role"))

    def test_malformed_duplicate_and_oversize_records_rejected(self):
        blobs = (b'{"SUPABASE_URL":"x","SUPABASE_URL":"y"}', b'[]', b'{"SUPABASE_URL":NaN}',
                 b'no json', b'x' * 16385, b'')
        for blob in blobs:
            with self.subTest(length=len(blob)):
                self.storage.blob = blob
                with self.assertRaisesRegex(MacNewsCredentialsError, "^invalid_record$"):
                    self.value.load_storage()

    def test_reviews_reject_duplicates_masked_and_cross_provider_keys(self):
        for changes in ({"OPENAI_API_KEY": REVIEWS["GEMINI_API_KEY"]}, {"GEMINI_API_KEY": "sk-ant-other"},
                        {"OPENAI_API_KEY": "AIza-fake"}, {"OPENAI_API_KEY": "●●"}):
            self.review.blob = json.dumps({**REVIEWS, **changes}).encode()
            with self.assertRaisesRegex(MacNewsCredentialsError, "^invalid_record$"):
                self.value.load_review_keys()

    def test_upstream_exception_is_safe_and_status_is_unknown(self):
        backend = Mock()
        backend.has.side_effect = RuntimeError("fake-secret-http://private")
        backend.read.side_effect = RuntimeError("fake-secret-http://private")
        backend.write.side_effect = RuntimeError("fake-secret-http://private")
        value = MacNewsCredentials(review_backend=backend, storage_backend=backend)
        status = value.status()
        self.assertIsNone(status["review_keys_saved"])
        self.assertEqual(status["errors"]["storage_saved"], "unavailable")
        for action in (value.load_review_keys, value.load_storage, lambda: value.save_storage(STORAGE)):
            with self.assertRaises(MacNewsCredentialsError) as context:
                action()
            self.assertNotIn("fake-secret", str(context.exception))
            self.assertNotIn("private", str(context.exception))

    def test_error_codes_allowlist_and_native_namespace_restriction(self):
        self.assertEqual(str(MacNewsCredentialsError("secret")), "unavailable")
        with patch("mac_news_credentials.sys.platform", "darwin"), patch("mac_news_credentials.ctypes.CDLL") as library:
            with self.assertRaises(MacNewsCredentialsError):
                _NativeKeychain("arbitrary-service")
            library.assert_not_called()

    def test_native_metadata_query_is_attributes_only_noninteractive(self):
        native = object.__new__(_NativeKeychain)
        native._arena = lambda: nullcontext([])
        native._query = lambda arena: 1
        native._constant = lambda name, **kw: name
        fields = []
        native._set = lambda q, key, val: fields.append((key, val))
        native.cf = Mock()
        native.cf.CFDictionaryGetTypeID.return_value = 9
        native.cf.CFGetTypeID.return_value = 9
        native.security = Mock()
        def copy(query, result):
            result._obj.value = 88
            return 0
        native.security.SecItemCopyMatching.side_effect = copy
        self.assertTrue(native.has())
        self.assertIn(("kSecReturnAttributes", "kCFBooleanTrue"), fields)
        self.assertIn(("kSecUseAuthenticationUI", "kSecUseAuthenticationUIFail"), fields)
        self.assertFalse(any(key == "kSecReturnData" for key, _ in fields))
        native.cf.CFDataGetLength.assert_not_called()
        native.cf.CFDataGetBytePtr.assert_not_called()
        native.cf.CFRelease.assert_called_once()

    def test_native_metadata_missing_is_false_not_zero_balance_or_read(self):
        native = object.__new__(_NativeKeychain)
        native._arena = lambda: nullcontext([])
        native._query = lambda arena: 1
        native._constant = lambda name, **kw: name
        native._set = lambda *args: None
        native.cf, native.security = Mock(), Mock()
        native.security.SecItemCopyMatching.return_value = -25300
        self.assertFalse(native.has())
        native.cf.CFDataGetBytePtr.assert_not_called()

    def test_native_storage_replace_uses_single_update_after_duplicate(self):
        native = object.__new__(_NativeKeychain)
        native._writable = True
        native._arena = lambda: nullcontext([])
        native._query = Mock(side_effect=[1, 2])
        native._dictionary = lambda arena: 3
        native._constant = lambda name, **kw: name
        fields = []
        native._set = lambda q, key, val: fields.append((q, key, val))
        native.cf, native.security = Mock(), Mock()
        native.cf.CFDataCreate.return_value = 9
        native.security.SecItemAdd.return_value = -25299
        native.security.SecItemUpdate.return_value = 0
        native.write(b"fake-pair")
        native.security.SecItemAdd.assert_called_once_with(1, None)
        native.security.SecItemUpdate.assert_called_once_with(2, 3)
        self.assertEqual(fields, [(1, "kSecValueData", 9), (3, "kSecValueData", 9)])

    def test_native_review_namespace_cannot_be_written(self):
        native = object.__new__(_NativeKeychain)
        native._writable = False
        native.security = Mock()
        with self.assertRaisesRegex(MacNewsCredentialsError, "^write_failed$"):
            native.write(b"fake-secret")
        native.security.SecItemAdd.assert_not_called()


if __name__ == "__main__":
    unittest.main()

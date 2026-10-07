"""Offline auth-cache handoff tests: synthetic tokens, no login or network."""
import base64
from contextlib import redirect_stdout
from copy import deepcopy
import io
import json
import os
from pathlib import Path
import pickle
import tempfile
import unittest
from unittest.mock import Mock, patch

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from cloud_news_auth import (AUTH_FILE, AUTH_OBJECT, AUTH_SCHEMA, CHECKPOINT_FILE,
    KEY_ENV, MAX_AUTH_BYTES, CloudNewsAuthError, CloudNewsAuthVault,
    SupabaseAuthStore, configuration, encryption_key, main)


FAKE_KEY = b"0" * 32
FAKE_KEY_B64 = base64.b64encode(FAKE_KEY).decode("ascii")
AUTH = {"auth_mode": "chatgpt", "OPENAI_API_KEY": None,
        "tokens": {"access_token": "fake-access-token", "id_token": "fake-id-token",
                   "refresh_token": "fake-refresh-token", "account_id": "fake-account"},
        "last_refresh": "2026-10-07T00:00:00Z"}


def blob(value=AUTH):
    return json.dumps(value, separators=(",", ":")).encode("utf-8")


class Store:
    def __init__(self):
        self.value, self.reads, self.writes = None, [], []
        self.fail_write = False

    def read(self, path):
        self.reads.append(path)
        return deepcopy(self.value)

    def write(self, path, value):
        if self.fail_write:
            raise RuntimeError("fake-access-token https://private.example/secret")
        self.writes.append((path, deepcopy(value)))
        self.value = deepcopy(value)


class Response:
    def __init__(self, code=200, value=None):
        self.status_code, self.value = code, value

    def json(self):
        return self.value


class CloudNewsAuthTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.store = Store()
        self.vault = CloudNewsAuthVault(self.store, FAKE_KEY)
        self.addCleanup(self.vault.close)
        self.seed_home = self.root / "dedicated-seed"
        self.write_auth(self.seed_home)
        self.run_home = self.root / "dedicated-run"

    def write_auth(self, home, value=AUTH):
        home.mkdir(mode=0o700, exist_ok=True)
        home.chmod(0o700)
        path = home / AUTH_FILE
        path.write_bytes(value if isinstance(value, bytes) else blob(value))
        path.chmod(0o600)
        return path

    def seeded(self):
        self.assertEqual(self.vault.seed(self.seed_home), {"status": "auth_seeded"})
        return deepcopy(self.store.value)

    def test_round_trip_stores_ciphertext_only_and_restricts_permissions(self):
        envelope = self.seeded()
        serialized = json.dumps(envelope)
        for value in AUTH["tokens"].values():
            self.assertNotIn(value, serialized)
            self.assertNotIn(value, repr(self.vault))
        self.assertEqual(set(envelope), {"schema", "nonce", "ciphertext"})
        self.assertEqual(self.vault.restore(self.run_home), {"status": "auth_restored"})
        self.assertEqual((self.run_home / AUTH_FILE).read_bytes(), blob())
        self.assertEqual(self.run_home.stat().st_mode & 0o777, 0o700)
        for name in (AUTH_FILE, CHECKPOINT_FILE):
            self.assertEqual((self.run_home / name).stat().st_mode & 0o777, 0o600)
        self.assertTrue(all(path == AUTH_OBJECT for path in self.store.reads))
        self.assertTrue(all(path == AUTH_OBJECT for path, _ in self.store.writes))

    def test_seeding_existing_record_never_overwrites_it(self):
        original = self.seeded()
        with self.assertRaisesRegex(CloudNewsAuthError, "^auth_seed_exists$"):
            self.vault.seed(self.seed_home)
        self.assertEqual(self.store.value, original)
        self.assertEqual(len(self.store.writes), 1)

    def test_missing_record_is_not_login_success_and_creates_no_files(self):
        with self.assertRaisesRegex(CloudNewsAuthError, "^auth_record_missing$"):
            self.vault.restore(self.run_home)
        self.assertFalse(self.run_home.exists())

    def test_encryption_key_requires_exact_canonical_base64_256_bits(self):
        self.assertEqual(encryption_key(FAKE_KEY_B64), FAKE_KEY)
        bad = (None, b"x", "", " " + FAKE_KEY_B64, FAKE_KEY_B64 + "\n",
               base64.b64encode(b"x" * 16).decode(), "!" * 44,
               FAKE_KEY_B64.rstrip("="))
        for value in bad:
            with self.subTest(value_type=type(value).__name__), self.assertRaisesRegex(
                    CloudNewsAuthError, "^auth_configuration_invalid$"):
                encryption_key(value)
        with self.assertRaises(CloudNewsAuthError):
            CloudNewsAuthVault(self.store, b"x" * 16)

    def test_tampering_wrong_key_and_other_object_aad_fail_before_restore(self):
        envelope = self.seeded()
        changed = deepcopy(envelope)
        ciphertext = bytearray(base64.b64decode(changed["ciphertext"]))
        ciphertext[0] ^= 1
        changed["ciphertext"] = base64.b64encode(ciphertext).decode()
        self.store.value = changed
        with self.assertRaisesRegex(CloudNewsAuthError, "^auth_decryption_failed$"):
            self.vault.restore(self.run_home)
        self.assertFalse(self.run_home.exists())
        self.store.value = envelope
        other = CloudNewsAuthVault(self.store, b"y" * 32)
        with self.assertRaisesRegex(CloudNewsAuthError, "^auth_decryption_failed$"):
            other.restore(self.run_home)
        other.close()
        nonce = b"0" * 12
        self.store.value = {"schema": AUTH_SCHEMA,
            "nonce": base64.b64encode(nonce).decode(),
            "ciphertext": base64.b64encode(AESGCM(FAKE_KEY).encrypt(
                nonce, blob(), b"other-bucket/other-object")).decode()}
        with self.assertRaisesRegex(CloudNewsAuthError, "^auth_decryption_failed$"):
            self.vault.restore(self.run_home)

    def test_malformed_envelope_never_creates_local_auth(self):
        good = self.seeded()
        cases = ([], {}, {**good, "schema": "other"}, {**good, "secret": "not-allowed"},
                 {**good, "nonce": "invalid"}, {**good, "nonce": base64.b64encode(b"x").decode()},
                 {**good, "ciphertext": "x" * 102401})
        for value in cases:
            with self.subTest(kind=type(value).__name__), self.assertRaisesRegex(
                    CloudNewsAuthError, "^auth_record_invalid$"):
                self.store.value = value
                self.vault.restore(self.run_home)
            self.assertFalse(self.run_home.exists())

    def test_api_key_auth_external_tokens_and_invalid_managed_auth_rejected(self):
        cases = ({**AUTH, "auth_mode": "apikey"},
                 {**AUTH, "auth_mode": "chatgptAuthTokens"},
                 {**AUTH, "OPENAI_API_KEY": "fake-api-key"},
                 {**AUTH, "extra": "not-allowed"},
                 {**AUTH, "last_refresh": "2026-10-07"},
                 {**AUTH, "tokens": {**AUTH["tokens"], "refresh_token": ""}},
                 {**AUTH, "tokens": {**AUTH["tokens"], "refresh_token": "line\nbreak"}},
                 {**AUTH, "tokens": {**AUTH["tokens"], "unknown": "bad"}},
                 b'{"auth_mode":"chatgpt","auth_mode":"chatgpt"}',
                 b'{"auth_mode":NaN}', b"not-json", b"x" * (MAX_AUTH_BYTES + 1))
        for value in cases:
            self.write_auth(self.seed_home, value)
            with self.subTest(kind=type(value).__name__), self.assertRaisesRegex(
                    CloudNewsAuthError, "^auth_invalid$"):
                self.vault.seed(self.seed_home)
        self.assertEqual(self.store.reads, [])
        self.assertEqual(self.store.writes, [])

    def test_null_api_key_is_allowed_but_no_api_auth_fallback_exists(self):
        without_api = {name: value for name, value in AUTH.items() if name != "OPENAI_API_KEY"}
        self.write_auth(self.seed_home, without_api)
        self.seeded()
        self.vault.restore(self.run_home)
        self.assertEqual(json.loads((self.run_home / AUTH_FILE).read_bytes()), without_api)

    def test_restore_refuses_existing_auth_without_altering_it(self):
        self.seeded()
        self.write_auth(self.run_home, b"existing-auth-is-untouched")
        with self.assertRaisesRegex(CloudNewsAuthError, "^auth_exists$"):
            self.vault.restore(self.run_home)
        self.assertEqual((self.run_home / AUTH_FILE).read_bytes(), b"existing-auth-is-untouched")
        self.assertFalse((self.run_home / CHECKPOINT_FILE).exists())

    def test_home_symlink_insecure_directory_and_default_profile_are_rejected(self):
        self.seeded()
        self.run_home.symlink_to(self.seed_home, target_is_directory=True)
        with self.assertRaisesRegex(CloudNewsAuthError, "^auth_home_invalid$"):
            self.vault.restore(self.run_home)
        self.run_home.unlink()
        self.run_home.mkdir(mode=0o755)
        self.run_home.chmod(0o755)
        with self.assertRaisesRegex(CloudNewsAuthError, "^auth_home_invalid$"):
            self.vault.restore(self.run_home)
        with patch("cloud_news_auth.Path.home", return_value=self.root):
            with self.assertRaisesRegex(CloudNewsAuthError, "^auth_home_invalid$"):
                self.vault.restore(self.root / ".codex")
            alias = self.root / "home-alias"
            alias.symlink_to(self.root, target_is_directory=True)
            with self.assertRaisesRegex(CloudNewsAuthError, "^auth_home_invalid$"):
                self.vault.restore(alias / ".codex")
        self.assertFalse((self.root / ".codex").exists())

    def test_checkpoint_rejects_symlinks_hardlinks_insecure_mode_and_oversize(self):
        self.seeded()
        self.vault.restore(self.run_home)
        path = self.run_home / AUTH_FILE
        path.unlink()
        path.symlink_to(self.seed_home / AUTH_FILE)
        with self.assertRaisesRegex(CloudNewsAuthError, "^auth_invalid$"):
            self.vault.checkpoint(self.run_home)
        path.unlink()
        os.link(self.seed_home / AUTH_FILE, path)
        with self.assertRaisesRegex(CloudNewsAuthError, "^auth_invalid$"):
            self.vault.checkpoint(self.run_home)
        path.unlink()
        self.write_auth(self.run_home)
        path.chmod(0o644)
        with self.assertRaisesRegex(CloudNewsAuthError, "^auth_invalid$"):
            self.vault.checkpoint(self.run_home)
        self.write_auth(self.run_home, b"x" * (MAX_AUTH_BYTES + 1))
        with self.assertRaisesRegex(CloudNewsAuthError, "^auth_invalid$"):
            self.vault.checkpoint(self.run_home)
        self.assertEqual(len(self.store.writes), 1)

    def test_checkpoint_saves_refreshed_tokens_and_rejects_second_old_snapshot(self):
        self.seeded()
        self.vault.restore(self.run_home)
        updated = deepcopy(AUTH)
        updated["tokens"]["refresh_token"] = "fake-new-refresh-token"
        updated["last_refresh"] = "2026-10-08T00:00:00Z"
        self.write_auth(self.run_home, updated)
        self.assertEqual(self.vault.checkpoint(self.run_home), {"status": "auth_checkpointed"})
        next_home = self.root / "next-run"
        self.vault.restore(next_home)
        self.assertEqual(json.loads((next_home / AUTH_FILE).read_bytes()), updated)
        with self.assertRaisesRegex(CloudNewsAuthError, "^auth_checkpoint_stale$"):
            self.vault.checkpoint(self.run_home)
        self.assertEqual(len(self.store.writes), 2)

    def test_stale_job_cannot_overwrite_newer_record(self):
        self.seeded()
        self.vault.restore(self.run_home)
        newer = self.vault._seal(blob())
        self.store.value = newer
        with self.assertRaisesRegex(CloudNewsAuthError, "^auth_checkpoint_stale$"):
            self.vault.checkpoint(self.run_home)
        self.assertEqual(self.store.value, newer)
        self.assertEqual(len(self.store.writes), 1)

    def test_invalid_or_missing_checkpoint_never_writes(self):
        self.seeded()
        self.vault.restore(self.run_home)
        path = self.run_home / CHECKPOINT_FILE
        for value in (b"[]", b'{"schema":"x","snapshot":"bad"}', b"x" * 513):
            path.write_bytes(value)
            path.chmod(0o600)
            with self.assertRaises(CloudNewsAuthError):
                self.vault.checkpoint(self.run_home)
        path.unlink()
        with self.assertRaisesRegex(CloudNewsAuthError, "^auth_checkpoint_missing$"):
            self.vault.checkpoint(self.run_home)
        self.assertEqual(len(self.store.writes), 1)

    def test_failed_generation_still_checkpoints_refresh_and_removes_local_auth(self):
        self.seeded()
        with self.assertRaisesRegex(RuntimeError, "generation-stopped"):
            with self.vault.session(self.run_home):
                updated = deepcopy(AUTH)
                updated["tokens"]["refresh_token"] = "fake-refresh-after-failed-generation"
                self.write_auth(self.run_home, updated)
                raise RuntimeError("generation-stopped")
        self.assertFalse((self.run_home / AUTH_FILE).exists())
        self.assertFalse((self.run_home / CHECKPOINT_FILE).exists())
        self.vault.restore(self.root / "next-run")
        self.assertEqual(json.loads((self.root / "next-run" / AUTH_FILE).read_bytes()), updated)

    def test_failed_checkpoint_fails_job_with_fixed_error_and_removes_local_auth(self):
        original = self.seeded()
        with self.assertRaisesRegex(CloudNewsAuthError, "^auth_checkpoint_failed$") as context:
            with self.vault.session(self.run_home):
                self.store.fail_write = True
        self.assertEqual(self.store.value, original)
        self.assertFalse((self.run_home / AUTH_FILE).exists())
        self.assertNotIn("fake-access-token", repr(context.exception))
        self.assertNotIn("private.example", repr(context.exception))

    def test_unexpected_store_errors_do_not_leak_values_or_url(self):
        backend = Mock()
        backend.read.side_effect = RuntimeError("fake-access-token https://private.example/secret")
        value = CloudNewsAuthVault(backend, FAKE_KEY)
        with self.assertRaisesRegex(CloudNewsAuthError, "^auth_storage_unavailable$") as context:
            value.restore(self.run_home)
        self.assertNotIn("fake-access-token", repr(context.exception))
        self.assertNotIn("private.example", repr(context.exception))
        value.close()

    def test_sensitive_objects_are_not_serializable(self):
        for value in (self.vault, SupabaseAuthStore(Mock())):
            with self.assertRaisesRegex(TypeError, "^credential_serialization_disabled$"):
                pickle.dumps(value)
        self.assertEqual(str(CloudNewsAuthError("fake-secret")), "auth_configuration_invalid")

    def test_cli_without_live_is_presence_only_and_never_builds_transport(self):
        env = {name: "fake-sensitive-value" for name in ("SUPABASE_URL", "SUPABASE_KEY", KEY_ENV)}
        factory = Mock(side_effect=AssertionError("must not access backend"))
        output = io.StringIO()
        with redirect_stdout(output), patch("cloud_news_auth._home", side_effect=AssertionError("no fs")):
            self.assertEqual(main(["restore", "--auth-home", str(self.seed_home)],
                                  environ=env, store_factory=factory), 0)
        factory.assert_not_called()
        self.assertEqual(json.loads(output.getvalue()), {"status": "dry_run", "live": False,
                                                        "configured": True, "missing": []})
        self.assertNotIn("fake-sensitive-value", output.getvalue())
        self.assertEqual(configuration({})["missing"], ["SUPABASE_URL", "SUPABASE_KEY", KEY_ENV])

    def test_cli_explicit_live_seed_restore_checkpoint_and_cleanup(self):
        env = {KEY_ENV: FAKE_KEY_B64}
        factory = Mock(return_value=self.store)
        for operation, home in (("seed", self.seed_home), ("restore", self.run_home),
                                ("checkpoint", self.run_home), ("cleanup", self.run_home)):
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(main([operation, "--live", "--auth-home", str(home)],
                                      environ=env, store_factory=factory), 0)
            result = json.loads(output.getvalue())
            self.assertTrue(result["live"])
            self.assertEqual(set(result), {"status", "live"})
            self.assertNotIn(FAKE_KEY_B64, output.getvalue())
            self.assertNotIn("fake-refresh-token", output.getvalue())
        self.assertFalse((self.run_home / AUTH_FILE).exists())

    def test_cli_live_validation_error_is_safe_and_no_factory_runs(self):
        factory = Mock()
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(main(["restore", "--live", "--auth-home", str(self.run_home)],
                    environ={KEY_ENV: "fake-private-secret"}, store_factory=factory), 1)
        factory.assert_not_called()
        self.assertEqual(json.loads(output.getvalue()),
                         {"status": "auth_configuration_invalid", "live": True})
        self.assertNotIn("fake-private-secret", output.getvalue())


class SupabaseAuthStoreTests(unittest.TestCase):
    def setUp(self):
        self.backend = Mock()
        self.backend._request.return_value = Response(value={"id": "website-news", "public": False})
        self.value = SupabaseAuthStore(self.backend)

    def test_read_checks_existing_private_bucket_and_only_fixed_object(self):
        self.backend.read.return_value = None
        self.assertIsNone(self.value.read(AUTH_OBJECT))
        self.backend._request.assert_called_once_with("GET", "/bucket/website-news")
        self.backend.read.assert_called_once_with(AUTH_OBJECT)
        self.backend.ensure_private.assert_not_called()
        self.backend.create.assert_not_called()

    def test_public_missing_or_other_bucket_never_reads_or_writes(self):
        for response in (Response(404), Response(value={"id": "website-news", "public": True}),
                         Response(value={"id": "other", "public": False}), Response(value=[])):
            self.backend._request.return_value = response
            with self.assertRaises(CloudNewsAuthError):
                self.value.read(AUTH_OBJECT)
        self.backend.read.assert_not_called()
        self.backend.create.assert_not_called()
        self.backend.ensure_private.assert_not_called()

    def test_arbitrary_paths_are_rejected_before_transport(self):
        for path in ("days/2026-10-07/edition.json", "../auth.json", "", "ops/codex-auth/v2.json"):
            with self.assertRaisesRegex(CloudNewsAuthError, "^auth_configuration_invalid$"):
                self.value.read(path)
            with self.assertRaisesRegex(CloudNewsAuthError, "^auth_configuration_invalid$"):
                self.value.write(path, {})
        self.backend._request.assert_not_called()

    def test_write_uses_one_fixed_json_upsert_and_does_not_create_bucket(self):
        fake_vault = CloudNewsAuthVault(Store(), FAKE_KEY)
        envelope = fake_vault._seal(blob())
        self.backend._request.side_effect = [Response(value={"id": "website-news", "public": False}),
                                            Response(200)]
        self.value.write(AUTH_OBJECT, envelope)
        calls = self.backend._request.call_args_list
        self.assertEqual(calls[0].args, ("GET", "/bucket/website-news"))
        self.assertEqual(calls[1].args, ("POST", "/object/website-news/" + AUTH_OBJECT))
        self.assertEqual(json.loads(calls[1].kwargs["data"]), envelope)
        self.assertEqual(calls[1].kwargs["headers"]["x-upsert"], "true")
        self.assertEqual(calls[1].kwargs["headers"]["Content-Type"], "application/json")
        self.backend.ensure_private.assert_not_called()
        self.backend.create.assert_not_called()
        fake_vault.close()

    def test_network_response_and_exception_never_surface_raw_details(self):
        for error in (RuntimeError("fake-refresh-token https://private.example"), None):
            if error:
                self.backend._request.side_effect = error
            else:
                self.backend._request.side_effect = None
                self.backend._request.return_value = Response(401, {"detail": "fake-refresh-token"})
            with self.assertRaisesRegex(CloudNewsAuthError, "^auth_storage_unavailable$") as context:
                self.value.read(AUTH_OBJECT)
            self.assertNotIn("fake-refresh-token", repr(context.exception))
            self.assertNotIn("private.example", repr(context.exception))


if __name__ == "__main__":
    unittest.main()

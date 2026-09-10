"""Failure-boundary tests; no external requests or real credentials."""

import hashlib
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import requests

import passkey_provision as provision


PROJECT = "https://exampleproject.supabase.co"
ADMIN_KEY = "test-service-key-not-real"
CLIENT_SECRET = "test-client-secret-not-real"
LEASE = "test-lease-token"
PROVIDER_ID = "9cd091a1-33e9-4ac8-9371-f34df12673ea"
SECRET_HASH = hashlib.sha256(CLIENT_SECRET.encode("ascii")).hexdigest()


def response(status, data):
    return SimpleNamespace(status_code=status, json=lambda: data)


class Store:
    def __init__(self, *, enabled=False, claim=True, finish=True):
        self.calls = []
        self.enabled = enabled
        self.claim = claim
        self.finish = finish

    def rpc(self, name, params):
        assert name == "passkey_auth_operation"
        action, data = params["p_action"], params["p_data"]
        self.calls.append((action, data.copy()))
        values = {
            "config": {"enabled": self.enabled, "client_secret_hash": SECRET_HASH},
            "claim_provision": self.claim,
            "finish_provision": self.finish,
            "fail_provision": True,
        }
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=values[action]))


class ProvisionTests(unittest.TestCase):
    def setUp(self):
        self.http = Mock()
        self.http.headers = {}
        self.http.__enter__ = Mock(return_value=self.http)
        self.http.__exit__ = Mock(return_value=False)
        self.http.get.return_value = response(404, {"code": "custom_provider_not_found"})
        self.http.post.side_effect = lambda url, **kw: response(
            201, {**kw["json"], "id": PROVIDER_ID}
        )
        self.session_patch = patch.object(provision.requests, "Session", return_value=self.http)
        self.session = self.session_patch.start()
        self.addCleanup(self.session_patch.stop)
        self.secret_patch = patch.object(
            provision.secrets, "token_urlsafe", side_effect=[LEASE, CLIENT_SECRET]
        )
        self.tokens = self.secret_patch.start()
        self.addCleanup(self.secret_patch.stop)

    def run_setup(self, store=None, url=PROJECT):
        return provision.ensure_passkey_provider(store or Store(), url, ADMIN_KEY)

    def test_ready_provider_is_never_changed(self):
        store = Store(enabled=True)
        self.assertTrue(self.run_setup(store))
        self.session.assert_not_called()
        self.assertEqual([a for a, _ in store.calls], ["config"])

    def test_unclaimed_lease_performs_no_http(self):
        self.assertFalse(self.run_setup(Store(claim=False)))
        self.session.assert_not_called()

    def test_non_boolean_claim_response_is_not_authorization(self):
        self.assertFalse(self.run_setup(Store(claim={"ok": True})))
        self.session.assert_not_called()

    def test_success_preserves_secret_boundary_and_fences_commit(self):
        store = Store()
        self.assertTrue(self.run_setup(store))
        self.assertEqual([a for a, _ in store.calls], ["config", "claim_provision", "finish_provision"])
        self.assertEqual(store.calls[-1][1], {
            "lease_token": LEASE, "client_secret_hash": SECRET_HASH, "provider_id": PROVIDER_ID
        })
        self.assertNotIn(CLIENT_SECRET, str(store.calls))
        self.assertNotIn(ADMIN_KEY, str(store.calls))
        self.assertEqual(self.tokens.call_args_list[0].args, (32,))
        self.assertEqual(self.tokens.call_args_list[1].args, (48,))
        sent = self.http.post.call_args.kwargs["json"]
        self.assertEqual(sent["client_secret"], CLIENT_SECRET)
        self.assertEqual(sent["identifier"], "custom:passkey")
        self.assertEqual(sent["scopes"], ["profile"])
        self.assertTrue(sent["email_optional"])
        self.assertTrue(sent["pkce_enabled"])
        self.assertTrue(sent["enabled"])
        self.assertEqual(self.http.get.call_count, 1)
        self.assertEqual(self.http.post.call_count, 1)
        for call in (self.http.get.call_args, self.http.post.call_args):
            self.assertFalse(call.kwargs["allow_redirects"])
            self.assertEqual(call.kwargs["timeout"], (3.05, 15))
        self.assertFalse(self.http.trust_env)

    def test_existing_provider_is_not_overwritten_or_rotated(self):
        self.http.get.return_value = response(200, {"identifier": "custom:passkey"})
        store = Store()
        with self.assertLogs(provision._LOG, "WARNING"):
            self.assertFalse(self.run_setup(store))
        self.http.post.assert_not_called()
        self.assertEqual(self.tokens.call_count, 1)
        self.assertEqual(store.calls[-1], ("fail_provision", {
            "lease_token": LEASE, "reason": "provider_conflict"
        }))
        self.http.put.assert_not_called()
        self.http.delete.assert_not_called()

    def test_unknown_not_found_does_not_create(self):
        self.http.get.return_value = response(404, {"message": "Route not found"})
        with self.assertLogs(provision._LOG, "WARNING"):
            self.assertFalse(self.run_setup())
        self.http.post.assert_not_called()

    def test_redirect_cannot_forward_admin_key(self):
        self.http.get.return_value = response(302, {})
        with self.assertLogs(provision._LOG, "WARNING"):
            self.assertFalse(self.run_setup())
        self.http.post.assert_not_called()
        self.assertFalse(self.http.get.call_args.kwargs["allow_redirects"])

    def test_ambiguous_create_failure_is_not_retried_and_logs_no_secrets(self):
        self.http.post.side_effect = requests.Timeout(f"{ADMIN_KEY} {CLIENT_SECRET}")
        store = Store()
        with self.assertLogs(provision._LOG, "WARNING") as captured:
            self.assertFalse(self.run_setup(store))
        self.assertEqual(self.http.post.call_count, 1)
        self.assertNotIn("finish_provision", [a for a, _ in store.calls])
        self.assertNotIn(CLIENT_SECRET, str(captured.output))
        self.assertNotIn(ADMIN_KEY, str(captured.output))
        self.http.put.assert_not_called()
        self.http.delete.assert_not_called()

    def test_create_conflict_does_not_try_update(self):
        self.http.post.side_effect = None
        self.http.post.return_value = response(400, {"code": "conflict"})
        store = Store()
        with self.assertLogs(provision._LOG, "WARNING"):
            self.assertFalse(self.run_setup(store))
        self.assertNotIn("finish_provision", [a for a, _ in store.calls])
        self.http.put.assert_not_called()
        self.http.delete.assert_not_called()

    def test_lost_or_expired_lease_cannot_enable_provider(self):
        store = Store(finish=False)
        with self.assertLogs(provision._LOG, "WARNING"):
            self.assertFalse(self.run_setup(store))
        self.assertEqual(store.calls[-1][1]["lease_token"], LEASE)
        self.assertEqual(store.calls[-1][1]["reason"], "provider_commit_rejected")
        self.assertEqual(self.http.post.call_count, 1)
        self.http.put.assert_not_called()
        self.http.delete.assert_not_called()

    def test_malformed_create_response_never_commits(self):
        self.http.post.side_effect = None
        self.http.post.return_value = response(201, {"id": PROVIDER_ID})
        store = Store()
        with self.assertLogs(provision._LOG, "WARNING"):
            self.assertFalse(self.run_setup(store))
        self.assertNotIn("finish_provision", [a for a, _ in store.calls])

    def test_database_failure_does_not_crash_startup(self):
        store = Mock()
        store.rpc.side_effect = RuntimeError(ADMIN_KEY)
        with self.assertLogs(provision._LOG, "WARNING") as captured:
            self.assertFalse(self.run_setup(store))
        self.assertNotIn(ADMIN_KEY, str(captured.output))
        self.session.assert_not_called()

    def test_invalid_destinations_receive_no_admin_key(self):
        for url in (
            "http://exampleproject.supabase.co", "https://example.com",
            "https://exampleproject.supabase.co.evil.test",
            "https://user:password@exampleproject.supabase.co",
            "https://exampleproject.supabase.co/other",
            "https://exampleproject.supabase.co?redirect=evil",
        ):
            with self.subTest(url=url):
                store = Store()
                self.assertFalse(self.run_setup(store, url))
                self.assertEqual(store.calls, [])
        self.session.assert_not_called()


if __name__ == "__main__":
    unittest.main()

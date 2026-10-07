import contextlib
import io
import json
import unittest
from unittest.mock import patch

from daily_news_producer import GenerationError
from mac_news_credentials import MacNewsCredentialsError
from scripts import check_cloud_news_connection as cloud


class CloudNewsConnectionTests(unittest.TestCase):
    def test_invalid_storage_never_passes_native_auth(self):
        def storage(credentials):
            with self.assertRaises(MacNewsCredentialsError):
                credentials.load_storage()
            return {"connection_verified": False, "status": "configuration_invalid"}
        def login(_env):
            self.fail("No native auth before a valid private connection")
        result = cloud.check_cloud_connection({}, storage_check=storage, login_check=login)
        self.assertEqual(result["ai_calls"], 0)
        self.assertFalse(result["subscription_login_verified"])

    def test_private_connection_without_current_objects_is_distinct_from_release(self):
        calls = []
        result = cloud.check_cloud_connection({},
            storage_check=lambda _c: {"connection_verified": True, "status": "manifest_missing",
                                      "publication_allowed": False},
            login_check=lambda env: calls.append(env))
        self.assertEqual(calls, [{}])
        self.assertTrue(result["subscription_login_verified"])
        self.assertFalse(result["publication_allowed"])
        self.assertEqual(result["status"], "manifest_missing")

    def test_login_error_does_not_disclose_details(self):
        def login(_env):
            raise GenerationError("confidential upstream text")
        result = cloud.check_cloud_connection({},
            storage_check=lambda _c: {"connection_verified": True, "status": "edition_missing"},
            login_check=login)
        self.assertEqual(result["status"], "subscription_login_unavailable")
        self.assertNotIn("confidential", json.dumps(result))

    def test_default_never_loads_auth_or_uses_network(self):
        output = io.StringIO()
        with patch.object(cloud, "configuration", return_value={"publication_allowed": False}), \
             patch.object(cloud, "check_cloud_connection", side_effect=AssertionError("live call")), \
             contextlib.redirect_stdout(output):
            self.assertEqual(cloud.main([]), 0)
        result = json.loads(output.getvalue())
        self.assertFalse(result["checked"])
        self.assertEqual(result["ai_calls"], 0)

    def test_success_does_not_assert_morning_edition_exists(self):
        for status in ("manifest_missing", "edition_missing", "connection_ready"):
            with self.subTest(status=status), patch.object(cloud, "check_cloud_connection",
                    return_value={"connection_verified": True, "subscription_login_verified": True,
                                  "status": status}), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(cloud.main(["--check-live"]), 0)

    def test_invalid_manifest_never_accepted_as_connection_success(self):
        with patch.object(cloud, "check_cloud_connection", return_value={
                "connection_verified": True, "subscription_login_verified": True,
                "status": "manifest_invalid"}), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cloud.main(["--check-live"]), 1)


if __name__ == "__main__":
    unittest.main()

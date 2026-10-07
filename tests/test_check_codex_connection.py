"""Readonly connection diagnostics: synthetic credentials/HTTP, never sockets."""
from contextlib import redirect_stdout
from copy import deepcopy
import io
import json
import unittest
from unittest.mock import Mock, patch

import requests

from daily_news_producer import build_issue
from mac_news_credentials import MacNewsCredentialsError
from morning_news_window import select_articles
from scripts import check_codex_connection as checker
from tests.test_website_news_producer import NOW, WINDOW, sources


PAIR = {"SUPABASE_URL": "https://fixture.supabase.co", "SUPABASE_KEY": "sb_secret_fixture-server"}
DAY = WINDOW["edition_date"]
BUCKET = {"id": "website-news", "public": False}


def manifest():
    return {**WINDOW, "articles": select_articles(sources(), WINDOW),
            "source_status": {"財務省": {"status": "collected"}}}


def edition():
    rows = sources()
    return build_issue({"headline": "架空の代表ニュース", "summary": "独立した代表の記事です。",
        "articles": [{"index": i, "headline": f"架空の記事{i}",
                      "summary": f"架空の資料{i}を単独で説明する文章です。"} for i in range(len(rows))]},
        rows, NOW, source_window=WINDOW, copy_length_policy="flexible-v1")


class Response:
    def __init__(self, value, status=200, *, wire=None, headers=None, on_read=None):
        self.status_code = status
        self.headers = headers or {}
        self.raw = self
        self.wire = wire if wire is not None else json.dumps(value).encode()
        self.closed = False
        self.on_read = on_read

    def read1(self, size, decode_content=False):
        if self.on_read:
            self.on_read()
        value, self.wire = self.wire[:size], self.wire[size:]
        return value

    def close(self):
        self.closed = True


class Session:
    def __init__(self, responses=None, failure=None):
        self.responses = list(responses or ())
        self.failure = failure
        self.calls = []
        self.closed = False

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, deepcopy(kwargs)))
        if self.failure:
            raise self.failure
        return self.responses.pop(0)

    def close(self):
        self.closed = True


class ConnectionCheckTests(unittest.TestCase):
    def setUp(self):
        self.credentials = Mock()
        self.credentials.load_storage.return_value = PAIR.copy()
        self.credentials.status.return_value = {"storage_saved": True, "review_keys_saved": True, "errors": {}}
        blocker = patch("requests.sessions.Session.request", side_effect=AssertionError("network disabled"))
        blocker.start()
        self.addCleanup(blocker.stop)

    def check(self, session):
        result = checker.check_connection(self.credentials, session=session, now=NOW)
        self.credentials.load_review_keys.assert_not_called()
        self.credentials.save_storage.assert_not_called()
        for secret in PAIR.values():
            self.assertNotIn(secret, json.dumps(result))
        return result

    def test_default_is_metadata_only_even_with_both_records_saved(self):
        with patch.object(checker, "MacNewsCredentials", return_value=self.credentials), \
                patch.object(checker, "check_connection") as live, \
                patch.object(checker.requests, "Session") as network, redirect_stdout(io.StringIO()) as out:
            self.assertEqual(checker.main([]), 0)
        live.assert_not_called()
        network.assert_not_called()
        self.credentials.load_storage.assert_not_called()
        self.credentials.load_review_keys.assert_not_called()
        self.assertEqual(json.loads(out.getvalue())["status"], "dry_run")

    def test_live_needs_both_explicit_flags_and_dry_keychain_flag_cannot_load_values(self):
        with patch.object(checker, "check_connection") as live, patch("sys.stderr", io.StringIO()):
            with self.assertRaises(SystemExit):
                checker.main(["--check-live"])
            live.assert_not_called()
        with patch.object(checker, "MacNewsCredentials", return_value=self.credentials), \
                patch.object(checker, "check_connection") as live, redirect_stdout(io.StringIO()):
            self.assertEqual(checker.main(["--use-keychain"]), 0)
            live.assert_not_called()
        self.credentials.load_storage.assert_not_called()

    def test_private_connection_checks_only_three_fixed_get_paths_and_does_not_publish_early(self):
        responses = [Response(BUCKET), Response(manifest()), Response(edition())]
        session = Session(responses)
        result = self.check(session)
        self.assertEqual(result["status"], "connection_ready")
        self.assertTrue(result["connection_verified"])
        self.assertEqual(result["source_count"], 2)
        self.assertEqual(result["article_count"], 2)
        self.assertFalse(result["edition_released"])
        self.assertFalse(result["publication_allowed"])
        self.assertEqual(result["request_count"], 3)
        self.assertEqual([url.removeprefix(PAIR["SUPABASE_URL"] + "/storage/v1")
                          for _, url, _ in session.calls], ["/bucket/website-news",
                         f"/object/authenticated/website-news/days/{DAY}/preparation/manifest.json",
                         f"/object/authenticated/website-news/days/{DAY}/edition.json"])
        for method, _, options in session.calls:
            self.assertEqual(method, "GET")
            self.assertFalse(options["allow_redirects"])
            self.assertTrue(options["stream"])
            self.assertLessEqual(options["timeout"][0], 3)
            self.assertLessEqual(options["timeout"][1], 4)
        self.assertTrue(all(response.closed for response in responses))
        self.assertTrue(session.closed)

    def test_invalid_pair_cannot_construct_transport_or_send_secret_to_any_host(self):
        for changes in ({"SUPABASE_URL": "http://fixture.supabase.co"},
                        {"SUPABASE_URL": "https://fixture.supabase.co.evil"},
                        {"SUPABASE_KEY": "sb_publishable_fixture"}):
            self.credentials.load_storage.return_value = {**PAIR, **changes}
            session = Session()
            with patch.object(checker.requests, "Session") as constructor:
                result = self.check(session)
                constructor.assert_not_called()
            self.assertEqual(result["status"], "configuration_invalid")
            self.assertEqual(session.calls, [])

    def test_missing_private_bucket_is_not_created(self):
        for status, payload in ((404, {}), (400, {"message": "Bucket not found"})):
            session = Session([Response(payload, status)])
            result = self.check(session)
            self.assertEqual(result["status"], "bucket_missing")
            self.assertFalse(result["connection_verified"])
            self.assertEqual(len(session.calls), 1)
            self.assertTrue(all(method == "GET" for method, _, _ in session.calls))

    def test_public_or_wrong_bucket_stops_before_manifest_and_edition(self):
        for bucket, expected in (({**BUCKET, "public": True}, "bucket_not_private"),
                                 ({"id": "wrong", "public": False}, "connection_invalid")):
            session = Session([Response(bucket)])
            result = self.check(session)
            self.assertEqual(result["status"], expected)
            self.assertEqual(len(session.calls), 1)

    def test_absent_objects_are_present_false_not_empty_sources_or_successful_update(self):
        session = Session([Response(BUCKET), Response({}, 404), Response({}, 404)])
        result = self.check(session)
        self.assertEqual(result["status"], "manifest_missing")
        self.assertTrue(result["connection_verified"])
        self.assertFalse(result["manifest_present"])
        self.assertFalse(result["edition_present"])
        self.assertNotIn("source_count", result)
        self.assertNotIn("article_count", result)

    def test_valid_manifest_without_edition_is_distinguished_from_missing_manifest(self):
        result = self.check(Session([Response(BUCKET), Response(manifest()), Response({}, 404)]))
        self.assertEqual(result["status"], "edition_missing")
        self.assertTrue(result["manifest_present"])
        self.assertFalse(result["edition_present"])

    def test_manifest_wrong_day_unverified_body_or_unapproved_host_cannot_be_reported_as_ready(self):
        for mutate in (lambda row: row.update(edition_date="2026-10-05"),
                       lambda row: row["articles"][0].update(body="forged"),
                       lambda row: row["articles"][0].update(url="https://unapproved.example/body")):
            value = manifest()
            mutate(value)
            result = self.check(Session([Response(BUCKET), Response(value)]))
            self.assertEqual(result["status"], "manifest_invalid")
            self.assertEqual(result["request_count"], 2)
            self.assertIsNone(result["edition_present"])
            self.assertNotIn("source_count", result)

    def test_invalid_edition_is_not_reported_as_reviewed_or_published(self):
        value = edition()
        value["article_refs"][0]["body_sha256"] = "invalid"
        result = self.check(Session([Response(BUCKET), Response(manifest()), Response(value)]))
        self.assertEqual(result["status"], "edition_invalid")
        self.assertTrue(result["edition_present"])
        self.assertNotIn("article_count", result)
        self.assertNotIn("edition_released", result)

    def test_auth_network_timeout_and_malformed_response_never_echo_upstream_text(self):
        cases = ((Session([Response({"message": "secret upstream body"}, 401)]), "authentication_failed"),
                 (Session([Response({}, 403)]), "authentication_failed"),
                 (Session(failure=requests.ConnectionError("secret private url")), "network_unavailable"),
                 (Session(failure=requests.Timeout("secret private url")), "connection_timeout"),
                 (Session([Response({}, wire=b"secret non-json")]), "connection_invalid"),
                 (Session([Response({}, 302)]), "connection_invalid"))
        for session, expected in cases:
            result = self.check(session)
            self.assertEqual(result["status"], expected)
            self.assertNotIn("secret", json.dumps(result))

    def test_auth_failure_on_object_keeps_presence_unknown(self):
        result = self.check(Session([Response(BUCKET), Response({}, 401)]))
        self.assertEqual(result["status"], "authentication_failed")
        self.assertIsNone(result["manifest_present"])
        self.assertIsNone(result["edition_present"])

    def test_stream_byte_limit_and_total_deadline_stop_further_requests(self):
        session = Session([Response(BUCKET, headers={"Content-Length": "1000001"})])
        result = self.check(session)
        self.assertEqual(result["status"], "connection_invalid")
        current = [0.0]
        response = Response(BUCKET, on_read=lambda: current.__setitem__(0, 21.0))
        session = Session([response])
        result = checker.check_connection(self.credentials, session=session, now=NOW,
                                          monotonic=lambda: current[0])
        self.assertEqual(result["status"], "connection_timeout")
        self.assertEqual(result["request_count"], 1)
        self.assertTrue(response.closed)

    def test_storage_credentials_errors_are_fixed_and_do_not_start_http(self):
        for code, expected in (("missing", "credentials_missing"), ("locked", "credentials_unavailable"),
                               ("invalid_record", "configuration_invalid")):
            self.credentials.load_storage.side_effect = MacNewsCredentialsError(code)
            session = Session()
            self.assertEqual(self.check(session)["status"], expected)
            self.assertEqual(session.calls, [])

    def test_transport_rejects_write_extra_paths_or_fourth_request(self):
        session = Session([Response(BUCKET)] * 3)
        storage = checker._ReadOnlyStorage(PAIR, DAY, session=session)
        for method, path in (("POST", "/bucket/website-news"), ("GET", "/bucket/other")):
            with self.assertRaisesRegex(checker.StorageUnavailable, "^connection_invalid$"):
                storage._request(method, path)
        self.assertEqual(session.calls, [])
        for _ in range(3):
            storage._request("GET", "/bucket/website-news")
        with self.assertRaisesRegex(checker.StorageUnavailable, "^connection_invalid$"):
            storage._request("GET", "/bucket/website-news")
        self.assertEqual(len(session.calls), 3)
        storage.close()


if __name__ == "__main__":
    unittest.main()

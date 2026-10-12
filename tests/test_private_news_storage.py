"""Offline regression checks for private-job storage phase budgets."""
import json
import time
import unittest
from unittest.mock import patch

from daily_news_runtime import StorageUnavailable, SupabaseNewsStorage, _StorageResponse
from scripts.private_news_storage import PrivateNewsStorage
from tests.test_source_cache_transport_budget import OfflineSession


class Clock:
    def __init__(self, now=100.0):
        self.now = now

    def __call__(self):
        return self.now


class ForkserverPrivateStorage(PrivateNewsStorage):
    """Importable real-session fixture whose worker never performs HTTP."""

    def __init__(self, deadline):
        super().__init__("https://fixture.supabase.test", "sb_secret_fixture",
                         deadline=deadline, phase="generation")
        self._session.headers["X-parent-fixture"] = "fixture"

    def _request_direct(self, method, path, **kwargs):
        return _StorageResponse(200, json.dumps({
            "fresh_session": "X-parent-fixture" not in self._session.headers,
            "phase": self.phase,
            "private_total_deadline": self.total_deadline,
            "transport_deadline": kwargs["deadline"],
        }).encode())


class PrivateNewsStorageTests(unittest.TestCase):
    def make(self, *, deadline=110, clock=None, session=None):
        clock = clock or Clock()
        return PrivateNewsStorage("https://fixture.supabase.test", "sb_secret_fixture",
                                  deadline=deadline, clock=clock, session=session), clock

    def response(self, method, path, **kwargs):
        if path.startswith("/bucket/"):
            value = {"public": False}
        elif path == "/object/list/website-news":
            value = [{"name": "2026-10-12"}] if kwargs["json"]["prefix"] == "days" else [
                {"name": "reviewed-00000000000000000001.json"}]
        else:
            value = {"fixture": True}
        return _StorageResponse(200, json.dumps(value).encode())

    def test_every_inherited_operation_uses_same_phase_absolute_deadline(self):
        storage, clock = self.make()
        storage.set_phase_deadline(108, phase="generation")
        with patch.object(SupabaseNewsStorage, "_request", side_effect=self.response) as request:
            storage.ensure_private()
            storage.read("fixture")
            storage.create("attempt-fixture.lock", {"fixture": True})
            storage._list("days", offset=30)
            storage.recent_days()
            storage.reviewed_keys("2026-10-12")
        self.assertEqual(request.call_count, 6)
        self.assertTrue(all(call.kwargs["deadline"] == 108 for call in request.call_args_list))
        self.assertTrue(all(call.kwargs["clock"] is clock for call in request.call_args_list))
        self.assertEqual(request.call_args_list[2].kwargs["headers"]["x-upsert"], "false")
        self.assertEqual(request.call_args_list[3].kwargs["json"]["offset"], 30)

    def test_per_call_budget_is_never_extended_by_phase_or_total(self):
        storage, clock = self.make()
        storage.set_phase_deadline(108, phase="source_preparation")
        with patch.object(SupabaseNewsStorage, "_request", side_effect=self.response) as request:
            storage.read("fixture", deadline=103, clock=clock)
            storage.read("fixture", deadline=120)
        self.assertEqual([call.kwargs["deadline"] for call in request.call_args_list], [103, 108])

    def test_successive_operations_share_expiry_instead_of_getting_fresh_time(self):
        storage, clock = self.make()
        def elapsed_response(method, path, **kwargs):
            clock.now += 4
            return self.response(method, path, **kwargs)
        with patch.object(SupabaseNewsStorage, "_request", side_effect=elapsed_response) as request:
            storage.read("first")
            storage.read("second")
            clock.now = 110
            with self.assertRaisesRegex(StorageUnavailable, "^storage_deadline$"):
                storage.create("attempt-fixture.lock", {"fixture": True})
        self.assertEqual(request.call_count, 2)
        self.assertEqual([call.kwargs["deadline"] for call in request.call_args_list], [110, 110])

    def test_next_phase_can_replace_expired_short_phase_but_not_overall_cap(self):
        storage, clock = self.make()
        storage.set_phase_deadline(102, phase="manifest_wait")
        clock.now = 103
        with patch.object(SupabaseNewsStorage, "_request", side_effect=self.response) as request:
            with self.assertRaisesRegex(StorageUnavailable, "^storage_deadline$"):
                storage.read("expired-wait")
            storage.set_phase_deadline(109, phase="generation")
            storage.read("allowed-generation")
            storage.set_phase_deadline(999, phase="outcome")
            self.assertEqual(storage.phase_deadline, 110)
            clock.now = 110
            with self.assertRaisesRegex(StorageUnavailable, "^storage_deadline$"):
                storage.create("expired-outcome", {"fixture": True})
        self.assertEqual(request.call_count, 1)
        self.assertEqual(storage.phase, "outcome")

    def test_total_expiry_can_only_shorten_and_also_caps_current_phase(self):
        storage, _ = self.make()
        self.assertEqual(storage.set_deadline(120), 110)
        self.assertEqual(storage.set_deadline(106), 106)
        self.assertEqual(storage.phase_deadline, 106)
        self.assertEqual(storage.set_phase_deadline(109, phase="publication"), 106)

    def test_missing_or_invalid_budget_fails_before_any_transport(self):
        storage, clock = self.make(deadline=None)
        with patch.object(SupabaseNewsStorage, "_request") as request:
            with self.assertRaisesRegex(StorageUnavailable, "^storage_budget$"):
                storage.read("fixture")
            with self.assertRaisesRegex(StorageUnavailable, "^storage_budget$"):
                storage.set_phase_deadline(110, phase="generation")
            for value in (True, None, 0, -1, float("nan"), float("inf"), "110"):
                with self.subTest(value=str(value)):
                    with self.assertRaisesRegex(StorageUnavailable, "^storage_budget$"):
                        storage.set_deadline(value)
            storage.set_deadline(110)
            with self.assertRaisesRegex(StorageUnavailable, "^storage_budget$"):
                storage.set_phase_deadline(108, phase="arbitrary_private_error")
            with self.assertRaisesRegex(StorageUnavailable, "^storage_budget$"):
                storage.read("fixture", deadline=108, clock=lambda: clock.now)
            request.assert_not_called()

    def test_phase_setup_and_construction_do_not_read_or_write_storage(self):
        with patch.object(SupabaseNewsStorage, "_request") as request:
            storage, _ = self.make()
            storage.set_phase_deadline(108, phase="generation")
            storage.set_deadline(109)
            request.assert_not_called()

    def test_missing_bucket_cannot_create_bucket_for_either_entry(self):
        for method in ("check_private", "ensure_private"):
            with self.subTest(method=method):
                storage, _ = self.make()
                with patch.object(SupabaseNewsStorage, "_request",
                                  return_value=_StorageResponse(404, b"{}")) as request:
                    with self.assertRaisesRegex(StorageUnavailable, "^storage_bucket$"):
                        getattr(storage, method)()
                self.assertEqual(request.call_count, 1)
                self.assertEqual(request.call_args.args, ("GET", "/bucket/website-news"))
                self.assertEqual(request.call_args.kwargs["deadline"], 110)

    def test_bucket_privacy_is_strict_and_never_modified(self):
        for value in ({"public": True}, {"public": 0}, {"public": None}, {}, []):
            with self.subTest(value=value):
                storage, _ = self.make()
                with patch.object(SupabaseNewsStorage, "_request",
                                  return_value=_StorageResponse(200, json.dumps(value).encode())) as request:
                    with self.assertRaisesRegex(StorageUnavailable, "^storage_private_required$"):
                        storage.ensure_private()
                self.assertEqual(request.call_count, 1)
                self.assertEqual(request.call_args.args, ("GET", "/bucket/website-news"))

    def test_blocked_headers_or_body_are_forcibly_stopped_at_private_expiry(self):
        for blocked in ("headers", "body"):
            with self.subTest(blocked=blocked):
                session = OfflineSession(blocked=blocked)
                started = time.monotonic()
                storage = PrivateNewsStorage("https://fixture.supabase.test", "sb_secret_fixture",
                    deadline=started + 0.15, phase="manifest_wait", session=session)
                with self.assertRaisesRegex(StorageUnavailable, "^storage_deadline$"):
                    storage.read("fixture")
                self.assertLess(time.monotonic() - started, 1)
                self.assertEqual(session.calls.value, 1)

    def test_stricter_call_expiry_also_stops_inflight_transport(self):
        session = OfflineSession(blocked="headers")
        started = time.monotonic()
        storage = PrivateNewsStorage("https://fixture.supabase.test", "sb_secret_fixture",
            deadline=started + 5, phase="source_preparation", session=session)
        with self.assertRaisesRegex(StorageUnavailable, "^storage_deadline$"):
            storage.read("fixture", deadline=started + 0.15)
        self.assertLess(time.monotonic() - started, 1)

    def test_create_keeps_conflict_response_as_no_new_claim(self):
        storage, _ = self.make()
        with patch.object(SupabaseNewsStorage, "_request", return_value=_StorageResponse(409, b"{}")):
            self.assertFalse(storage.create("attempt-fixture.lock", {"fixture": True}))

    def test_private_subclass_works_with_actual_forkserver_and_fresh_session(self):
        expiry = time.monotonic() + 3
        storage = ForkserverPrivateStorage(expiry)
        result = storage.read("fixture")
        self.assertTrue(result["fresh_session"])
        self.assertEqual(result["phase"], "generation")
        self.assertEqual(result["private_total_deadline"], expiry)
        self.assertLessEqual(result["transport_deadline"], expiry)


if __name__ == "__main__":
    unittest.main()

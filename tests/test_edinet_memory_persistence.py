"""Persistence regressions under concurrent publication and existing size caps."""
import base64
from copy import deepcopy
from hashlib import sha256
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import zlib

from regional_edinet_service import RegionalEdinetDividends
from regional_edinet_storage import EdinetCheckpointStore
from tests.test_regional_edinet import NOW, IDENTITY
from tests.test_regional_edinet_service import FixtureProvider, descriptor, snapshot
from tests.test_regional_edinet_storage import Transport


class MemoryPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name) / 'index.json'

    def service(self, **kwargs):
        service = RegionalEdinetDividends(self.path, identities=(IDENTITY,),
                    provider=FixtureProvider(), clock=lambda: NOW, **kwargs)
        self.addCleanup(service.close)
        return service

    def test_save_retains_all_400_days_while_another_thread_replaces_a_day(self):
        service = self.service(window_days=400)
        original = {day: snapshot(day) for day in service._days()}
        service._snapshots = deepcopy(original)
        entered, release = threading.Event(), threading.Event()
        write = service._write_local_cache

        def blocked_write(cache):
            entered.set()
            if not release.wait(2):
                raise AssertionError('fixture publication timed out')
            write(cache)

        service._write_local_cache = blocked_write
        worker = threading.Thread(target=service._save)
        worker.start()
        try:
            self.assertTrue(entered.wait(2))
            day = service._days()[0]
            with service._condition:
                service._snapshots[day] = snapshot(day, [descriptor()])
        finally:
            release.set()
            worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(json.loads(self.path.read_bytes())['snapshots'], original)
        self.assertEqual(len(service._snapshots[day]['rows']), 1)
        self.assertEqual(len(service._snapshots), 400)

    def test_injected_mutating_store_cannot_modify_published_snapshots(self):
        class MutatingStore:
            def save(self, cache):
                cache['snapshots'][day]['rows'].clear()
                cache['snapshots'].clear()
                return True

        service = self.service(checkpoint_store=MutatingStore(), window_days=3)
        day = service._days()[0]
        expected = snapshot(day, [descriptor()])
        service._snapshots = {day: deepcopy(expected)}
        service._checkpoint_save_allowed = True
        service._save()
        self.assertEqual(service._snapshots, {day: expected})
        self.assertEqual(json.loads(self.path.read_bytes())['snapshots'], {day: expected})

    def test_unchanged_file_skips_merge_but_atomic_external_replace_is_read(self):
        service = self.service(window_days=3)
        day = service._days()[0]
        service._snapshots = {day: snapshot(day)}
        service._save()
        stat = self.path.stat()
        with patch.object(service, '_merge_cache', wraps=service._merge_cache) as merge:
            service._load()
            self.assertEqual(merge.call_count, 0)
            external = self.path.with_suffix('.external')
            external.write_bytes(self.path.read_bytes())
            os.utime(external, ns=(stat.st_atime_ns, stat.st_mtime_ns))
            external.replace(self.path)
            service._load()
            self.assertEqual(merge.call_count, 1)
            service._load()
            self.assertEqual(merge.call_count, 1)
        self.assertEqual(service._snapshots[day]['fetched_at'], NOW)
        self.assertEqual(service._checkpoint_restored_at, None)
        self.assertEqual(service.provider.calls, [])

    def test_failed_bounded_local_save_keeps_previous_readable_index(self):
        service = self.service(window_days=3)
        day = service._days()[0]
        service._snapshots = {day: snapshot(day)}
        service._save()
        before = self.path.read_bytes()
        service._snapshots[day] = snapshot(day, [descriptor()])
        with patch('regional_edinet_service.MAX_CACHE_BYTES', 80):
            service._save()
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(service._local_save_status, 'save_failed')
        self.assertTrue(service._persistence_failed)
        self.assertEqual(list(self.path.parent.glob('*.tmp')), [])

    def test_checkpoint_encoding_is_byte_compatible_with_existing_reader(self):
        transport = Transport()
        store = EdinetCheckpointStore(transport, clock=lambda: NOW)
        cache = {'version': 1, 'snapshots': {'2026-10-11':
                 snapshot('2026-10-11', [descriptor()])}, 'records': {}, 'next_request': NOW + 3600}
        before = deepcopy(cache)
        raw = json.dumps(cache, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
        expected = {'version': 1, 'encoding': 'zlib-base64', 'sha256': sha256(raw).hexdigest(),
                    'data': base64.b64encode(zlib.compress(raw)).decode('ascii')}
        self.assertTrue(store.save(cache))
        post = next(call for call in transport.calls if call[0] == 'POST')
        self.assertEqual(post[2]['data'], json.dumps(expected, separators=(',', ':')).encode())
        self.assertEqual(store.load(), before)
        self.assertEqual(cache, before)

    def test_raw_and_stored_caps_reject_before_any_transport(self):
        cache = {'version': 1, 'snapshots': {}, 'records': {}, 'next_request': 60}
        for limit, value in [('MAX_RAW_BYTES', 24), ('MAX_STORED_BYTES', 80)]:
            with self.subTest(limit=limit):
                transport = Transport()
                store = EdinetCheckpointStore(transport, clock=lambda: NOW)
                with patch('regional_edinet_storage.' + limit, value):
                    self.assertFalse(store.save(cache))
                self.assertEqual(store.last_save_error, 'checkpoint_size_limit')
                self.assertEqual(transport.calls, [])

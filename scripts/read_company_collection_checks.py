"""Read explicit private normal-collection slots; never collect or generate.

--read-live is required for authenticated GETs. No credentials, raw source
payloads or errors are emitted. This checks a bounded batch, not all companies.
"""
from datetime import date, datetime
import argparse
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.parse import quote

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import company_news_collection_checks as checks
from daily_news_runtime import BUCKET, StorageUnavailable, SupabaseNewsStorage, _StorageResponse
from news_cache import JST


class _GetClient(SupabaseNewsStorage):
    """Keep the existing killable deadline transport, narrow its child to GET."""
    def __init__(self, url, key, paths):
        super().__init__(url, key)
        self._allowed = frozenset('/object/authenticated/' + BUCKET + '/' + quote(path, safe='/')
                                  for path in paths)

    def _request_direct(self, method, path, *, deadline=None, clock=None, **options):
        if method != 'GET' or path not in self._allowed or options:
            raise StorageUnavailable('storage_read')
        clock = time.monotonic if clock is None else clock
        if deadline is None:
            raise StorageUnavailable('storage_read')
        response = None
        try:
            remaining = self._remaining(deadline, clock)
            response = self._session.request('GET', self._url + path, headers=self._headers,
                timeout=self._budget_timeout(remaining), allow_redirects=False, stream=True)
            length = response.headers.get('Content-Length')
            if length is not None and (not length.isdecimal() or int(length) > checks.MAX_BYTES):
                raise StorageUnavailable('storage_response')
            body = bytearray()
            while True:
                self._remaining(deadline, clock)
                chunk = response.raw.read1(4096, decode_content=True)
                self._remaining(deadline, clock)
                body.extend(chunk)
                if len(body) > checks.MAX_BYTES:
                    raise StorageUnavailable('storage_response')
                if not chunk:
                    break
            return _StorageResponse(response.status_code, bytes(body))
        except StorageUnavailable:
            raise
        except Exception:
            raise StorageUnavailable('storage_read') from None
        finally:
            if response is not None:
                response.close()


class ReadOnlyStorage:
    def __init__(self, environ, paths):
        self._paths = frozenset(paths)
        self._client = _GetClient(environ.get('SUPABASE_URL'), environ.get('SUPABASE_KEY'), paths)

    def read(self, path, *, deadline, clock):
        if path not in self._paths:
            raise StorageUnavailable('storage_read')
        return self._client.read(path, deadline=deadline, clock=clock)


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise ValueError('invalid_request')


def request_args(args, now):
    if (not checks._stamp(now) or type(args.fingerprint) is not str
            or re.fullmatch(r'[0-9a-f]{64}', args.fingerprint) is None
            or type(args.slots) is not str or re.fullmatch(r'(?:[0-8][0-9]|9[0-5])(?:,(?:[0-8][0-9]|9[0-5])){0,7}', args.slots) is None):
        raise ValueError('invalid_request')
    try:
        day = date.fromisoformat(args.day)
    except (TypeError, ValueError):
        raise ValueError('invalid_request') from None
    slots = [int(value) for value in args.slots.split(',')]
    today = datetime.fromtimestamp(now, JST)
    if (day.isoformat() != args.day or not 0 <= (today.date() - day).days < 3 or len(set(slots)) != len(slots)
            or day == today.date() and max(slots) > (today.hour * 60 + today.minute) // 15):
        raise ValueError('invalid_request')
    return slots


def run(args, *, environ=None, clock=time.time, monotonic=time.monotonic,
        registry_factory=checks.local_registry, storage_factory=ReadOnlyStorage):
    now = clock()
    slots = request_args(args, now)
    report = dict(schema_version=1, report_kind='private_company_collection_checks',
        status='not_requested', success=False, read_only=True, source_collection_started=False,
        generation_started=False, publication_verified=False, membership_freshness_verified=False,
        expected_fingerprint=args.fingerprint, day=args.day, requested_slots=slots,
        checked_at=now, read_count=0, records=[], missing_slots=[], invalid_slots=[], unread_slots=[],
        admitted_route_rows=0, feed_ok_route_count=0, feed_failed_route_count=0,
        feed_not_completed_route_count=0, body_accepted_route_count=0,
        dedicated_company_feed_ok_count=0, all_registered_routes_verified=False)
    try:
        registry = registry_factory()
        checks.context_from_registry(registry['routes'], source_sha256=registry['source_sha256'],
            catalogue_sha256='0' * 64, catalogue_source_sha256='0' * 64)
    except Exception:
        report['status'] = 'registry_unavailable'
        return report
    report['local_source_sha256'] = registry['source_sha256']
    if not args.read_live:
        return report
    paths = [f'{checks.PREFIX}/{args.fingerprint}/{args.day}/slot-{slot:02d}.json' for slot in slots]
    try:
        storage = storage_factory(os.environ if environ is None else environ, paths)
    except Exception:
        report['status'] = 'configuration_unavailable'
        return report
    try:
        batch = checks.read_expected_slots(storage, registry, args.fingerprint, args.day, slots,
            now=now, deadline=monotonic() + checks.READ_SECONDS, clock=monotonic)
    except Exception:
        report['status'] = 'storage_unavailable'
        return report
    # Only regenerated, fixed-schema records survive the helper's validation.
    report.update(batch)
    latest = {}
    for record in batch['records']:
        for row in record['rows']:
            if row['source'] not in latest or latest[row['source']][0] < record['started_at']:
                latest[row['source']] = (record['started_at'], row)
    rows = [value[1] for value in latest.values()]
    report.update(admitted_route_rows=len(rows),
        feed_ok_route_count=sum(row['feed_status'] == 'ok' for row in rows),
        feed_failed_route_count=sum(row['feed_status'] == 'failed' for row in rows),
        feed_not_completed_route_count=sum(row['feed_status'] == 'not_completed' for row in rows),
        body_accepted_route_count=sum(row['accepted'] > 0 for row in rows),
        dedicated_company_feed_ok_count=len({row['symbol'] for row in rows
            if row['symbol'] is not None and row['feed_status'] == 'ok'}))
    report['success'] = len(batch['records']) == len(slots)
    report['status'] = 'complete' if report['success'] else 'partial'
    return report


def write_result(path, report):
    """New 0600 file only; no symlink component and no existing-file overwrite."""
    target = Path(os.path.abspath(os.fspath(path)))
    directory = os.open(target.anchor, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in target.parts[1:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
        payload = json.dumps(report, ensure_ascii=True, sort_keys=True, separators=(',', ':'),
                             allow_nan=False).encode() + b'\n'
        if len(payload) > checks.MAX_BYTES * checks.MAX_READ_SLOTS + 8192:
            raise ValueError('result_file_unavailable')
        descriptor = os.open(target.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=directory)
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        os.close(directory)


def main(argv=None):
    parser = _Parser(description=__doc__)
    parser.add_argument('--read-live', action='store_true')
    parser.add_argument('--fingerprint', required=True)
    parser.add_argument('--day', required=True)
    parser.add_argument('--slots', required=True)
    parser.add_argument('--result-file')
    try:
        args = parser.parse_args(argv)
        report = run(args)
    except Exception:
        report = dict(schema_version=1, report_kind='private_company_collection_checks',
                      status='invalid_request', success=False, read_only=True)
        args = None
    if args is not None and args.result_file is not None:
        try:
            write_result(args.result_file, report)
        except Exception:
            report = dict(schema_version=1, report_kind='private_company_collection_checks',
                          status='result_file_unavailable', success=False, read_only=True)
    print(json.dumps(report, ensure_ascii=True, separators=(',', ':'), allow_nan=False))
    return 0 if report.get('success') or report['status'] == 'not_requested' else 1


if __name__ == '__main__':
    raise SystemExit(main())

"""Reconcile two bounded reads of private numeric receipts, without running AI.

This is a separate, read-only cloud operation. It never loads Mac credentials,
creates a bucket, writes Storage, restores a login or starts news production.
"""
import argparse
from datetime import date, datetime
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.parse import quote

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from daily_news_runtime import BUCKET, StorageUnavailable, SupabaseNewsStorage, _StorageResponse
from news_review_costs import JST, PREFIX, collect_daily_cost

MAX_OBJECTS = 1200
SCAN_SECONDS = 150
MAX_RESPONSE_BYTES = 32768
MAX_OUTPUT_BYTES = 4_000_000


class _CostClient(SupabaseNewsStorage):
    def __init__(self, url, key, day):
        super().__init__(url, key, timeout=(3, 8))
        self.day = day
        self.prefix = f'{PREFIX}/{day}'

    def _allowed(self, method, path, options):
        if method == 'GET' and not options:
            if path == '/bucket/' + BUCKET:
                return
            base = '/object/authenticated/' + BUCKET + '/' + self.prefix + '/'
            if path.startswith(base) and re.fullmatch(r'[0-9a-f]{32}\.(?:start|usage)\.json', path[len(base):]):
                return
        if method == 'POST' and path == '/object/list/' + BUCKET and set(options) == {'json'}:
            payload = options['json']
            if (isinstance(payload, dict) and set(payload) == {'prefix', 'limit', 'offset', 'sortBy'}
                    and payload['prefix'] == self.prefix and payload['limit'] == 30
                    and type(payload['offset']) is int and 0 <= payload['offset'] < MAX_OBJECTS
                    and payload['offset'] % 30 == 0
                    and payload['sortBy'] == {'column': 'name', 'order': 'desc'}):
                return
        raise StorageUnavailable('storage_read')

    def _request(self, method, path, *, deadline=None, clock=None, **options):
        self._allowed(method, path, options)
        if deadline is None:
            raise StorageUnavailable('storage_budget')
        return super()._request(method, path, deadline=deadline, clock=clock, **options)

    def _request_direct(self, method, path, *, deadline=None, clock=None, **options):
        self._allowed(method, path, options)
        if deadline is None:
            raise StorageUnavailable('storage_budget')
        clock = time.monotonic if clock is None else clock
        response = None
        try:
            remaining = self._remaining(deadline, clock)
            response = self._session.request(method, self._url + path, headers=self._headers,
                timeout=self._budget_timeout(remaining), allow_redirects=False, stream=True, **options)
            length = response.headers.get('Content-Length')
            if length is not None and (not length.isdecimal() or int(length) > MAX_RESPONSE_BYTES):
                raise StorageUnavailable('storage_response')
            body = bytearray()
            while True:
                self._remaining(deadline, clock)
                chunk = response.raw.read1(4096, decode_content=True)
                self._remaining(deadline, clock)
                body.extend(chunk)
                if len(body) > MAX_RESPONSE_BYTES:
                    raise StorageUnavailable('storage_response')
                if not chunk:
                    break
            return _StorageResponse(response.status_code, bytes(body))
        except StorageUnavailable:
            raise
        except Exception:
            raise StorageUnavailable('storage_network') from None
        finally:
            if response is not None:
                response.close()

    def _list(self, prefix, *, offset=0, deadline=None, clock=None):
        if prefix != self.prefix:
            raise StorageUnavailable('storage_read')
        response = self._request('POST', '/object/list/' + BUCKET,
            json={'prefix': prefix, 'limit': 30, 'offset': offset,
                  'sortBy': {'column': 'name', 'order': 'desc'}}, deadline=deadline, clock=clock)
        if response.status_code != 200:
            raise StorageUnavailable('storage_list')
        values = self._payload(response)
        if not isinstance(values, list) or len(values) > 30:
            raise StorageUnavailable('storage_list')
        return values


class ReadOnlyCostStorage:
    def __init__(self, environ, day):
        self._client = _CostClient(environ.get('SUPABASE_URL'), environ.get('SUPABASE_KEY'), day)

    def check_private(self, *, deadline):
        response = self._client._request('GET', '/bucket/' + BUCKET, deadline=deadline)
        value = self._client._payload(response)
        if response.status_code != 200 or not isinstance(value, dict) or value.get('public') is not False:
            raise StorageUnavailable('storage_private_required')

    def read(self, path, *, deadline=None):
        return self._client.read(path, deadline=deadline)

    def _list(self, prefix, *, offset=0, deadline=None):
        return self._client._list(prefix, offset=offset, deadline=deadline)

    def close(self):
        self._client._session.close()


def run(args, *, environ=None, storage_factory=ReadOnlyCostStorage,
        clock=time.time, monotonic=time.monotonic):
    now = datetime.fromtimestamp(clock(), JST)
    requested = date.fromisoformat(args.day)
    if requested.isoformat() != args.day or not 0 <= (now.date() - requested).days <= 31:
        raise ValueError('invalid_cost_day')
    report = {'schema_version': 1, 'report_kind': 'private_review_cost_reconciliation',
        'day': args.day, 'timezone': 'Asia/Tokyo', 'checked_at': now.isoformat(timespec='seconds'),
        'status': 'not_requested', 'read_only': True, 'ai_started': False,
        'publication_started': False, 'storage_write_started': False,
        'snapshot_guaranteed': False, 'invoice_amount': False,
        'scan_complete': False, 'stable_receipts': False, 'full_amount_known': False,
        'historical_run_attribution_complete': False,
        'limits': {'scan_seconds': SCAN_SECONDS, 'passes': 2, 'max_objects_per_pass': MAX_OBJECTS,
                   'max_response_bytes': MAX_RESPONSE_BYTES}, 'passes': []}
    if not args.live:
        return report
    env = os.environ if environ is None else environ
    revision = env.get('COST_SOURCE_REVISION')
    if isinstance(revision, str) and re.fullmatch(r'[0-9a-f]{40}', revision):
        report['reader_source_revision'] = revision
    for source, target in (('GITHUB_RUN_ID', 'reader_run_id'), ('GITHUB_RUN_ATTEMPT', 'reader_run_attempt')):
        value = env.get(source)
        if isinstance(value, str) and re.fullmatch(r'[1-9][0-9]{0,17}', value):
            report[target] = int(value)
    storage = None
    try:
        storage = storage_factory(env, args.day)
        storage.check_private(deadline=monotonic() + 20)
        for _ in range(2):
            begin = datetime.fromtimestamp(clock(), JST).isoformat(timespec='seconds')
            result = collect_daily_cost(storage, args.day, seconds=SCAN_SECONDS, max_objects=MAX_OBJECTS)
            report['passes'].append({'read_started_at': begin,
                'read_finished_at': datetime.fromtimestamp(clock(), JST).isoformat(timespec='seconds'),
                **result})
        one, two = report['passes']
        report['scan_complete'] = all(value['scan_complete'] for value in report['passes'])
        report['stable_receipts'] = (report['scan_complete']
            and one['receipt_set_sha256'] == two['receipt_set_sha256']
            and one['request_set_sha256'] == two['request_set_sha256'])
        report['full_amount_known'] = report['stable_receipts'] and two['estimate_complete']
        report['status'] = ('complete' if report['full_amount_known'] else
                            'reconciled_with_unknown_costs' if report['stable_receipts'] else 'incomplete')
        # The latest pass is a cumulative daily snapshot; passes are never added.
        report['daily'] = two
        # Keep each safe receipt once. Repeating full snapshots would exceed
        # the output bound even though the object's read budget was respected.
        pass_fields = ('read_started_at', 'read_finished_at', 'day', 'scan_complete',
                       'request_count', 'unknown_cost_count', 'estimated_cost_usd',
                       'estimated_cost_jpy', 'estimate_complete', 'persistence_complete',
                       'request_set_sha256', 'receipt_set_sha256', 'scan')
        report['passes'] = [{key: value[key] for key in pass_fields if key in value}
                            for value in report['passes']]
        return report
    except Exception:
        report['status'] = 'storage_unavailable'
        return report
    finally:
        if storage is not None:
            try:
                storage.close()
            except Exception:
                pass


def write_result(path, report):
    target = Path(os.path.abspath(os.fspath(path)))
    directory = os.open(target.anchor, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in target.parts[1:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
        payload = json.dumps(report, ensure_ascii=True, sort_keys=True, allow_nan=False).encode() + b'\n'
        if len(payload) > MAX_OUTPUT_BYTES:
            raise ValueError('result_file_unavailable')
        descriptor = os.open(target.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=directory)
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        os.close(directory)


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise ValueError('invalid_request')


def main(argv=None):
    parser = _Parser(description=__doc__)
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--day', required=True)
    parser.add_argument('--output')
    args = None
    try:
        args = parser.parse_args(argv)
        report = run(args)
        if args.output is not None:
            write_result(args.output, report)
    except Exception:
        report = {'schema_version': 1, 'report_kind': 'private_review_cost_reconciliation',
                  'status': 'invalid_request', 'read_only': True, 'ai_started': False,
                  'scan_complete': False, 'full_amount_known': False}
    # Numeric output only. Provider bodies, private URLs and exceptions are never printed.
    print(json.dumps(report, ensure_ascii=True, separators=(',', ':'), allow_nan=False))
    return 0 if report['status'] in {'not_requested', 'complete', 'reconciled_with_unknown_costs'} else 1


if __name__ == '__main__':
    raise SystemExit(main())

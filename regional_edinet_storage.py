"""Compact public filing checkpoints in the existing private application bucket.

No bucket creation, policy changes, credentials in objects, or startup reads.
The service validates restored issuer/fiscal facts before accepting them.
"""
import base64
from datetime import date
from hashlib import sha256
import json
import math
import re
import time
import zlib

from daily_news_runtime import BUCKET, StorageUnavailable
from regional_edinet import _DESCRIPTOR_FIELDS

CHECKPOINT_PATH = 'regional-edinet/v1/checkpoint.json'
MAX_RAW_BYTES = 16_000_000
MAX_STORED_BYTES = 1_000_000
FACT_KEYS = {'value', 'currency', 'unit', 'fiscal_period', 'tag', 'context_id', 'unit_id',
             'filing_submitted_at', 'fetched_at', 'doc_id', 'edinet_code', 'security_code',
             'source_url', 'source_title', 'kind', 'split_adjustment', 'latest_filing_guaranteed',
             'doc_type_code', 'base_doc_id'}


def _keys(value, allowed):
    return isinstance(value, dict) and set(value) <= set(allowed)


def _descriptor(value, depth=0):
    if depth > 1 or not _keys(value, set(_DESCRIPTOR_FIELDS) | {'_annual_base', '_correction_chain'}):
        return False
    for key, leaf in value.items():
        if key == '_annual_base':
            if not _descriptor(leaf, depth + 1):
                return False
        elif key == '_correction_chain':
            if not isinstance(leaf, list) or len(leaf) > 16 or not all(_descriptor(row, depth + 1) for row in leaf):
                return False
        elif leaf is not None and (not isinstance(leaf, str) or len(leaf) > 250):
            return False
    return True


def _cache(value):
    """Reject extra fields that could carry logs, prose or credentials."""
    if not _keys(value, {'version', 'snapshots', 'records', 'next_request'}) or value.get('version') != 1:
        return False
    if 'next_request' in value and (type(value['next_request']) not in (int, float)
                                  or not math.isfinite(value['next_request']) or value['next_request'] < 0):
        return False
    snapshots, records = value.get('snapshots'), value.get('records')
    if not isinstance(snapshots, dict) or len(snapshots) > 400 or not isinstance(records, dict) or len(records) > 110:
        return False
    for day, item in snapshots.items():
        if (not isinstance(day, str) or len(day) != 10 or not _keys(item, {'date', 'process_at', 'fetched_at', 'rows', 'removed_doc_ids'})
                or not isinstance(item.get('rows'), list) or not all(_descriptor(row) for row in item['rows'])):
            return False
    for code, item in records.items():
        if not isinstance(code, str) or len(code) != 4 or not _keys(item, {'company', 'status', 'invalidated', 'last_attempt_at', 'attempted_doc_id', 'descriptor', 'fact', 'warm_progress', 'warm_finished_at', 'warm_resume_after', 'updated_at'}):
            return False
        if not _keys(item.get('company'), {'code', 'symbol', 'name', 'provider_symbol'}):
            return False
        if 'descriptor' in item and not _descriptor(item['descriptor']):
            return False
        if 'fact' in item and (not _keys(item['fact'], FACT_KEYS)
                               or not _keys(item['fact'].get('fiscal_period'), {'start', 'end'})):
            return False
        if 'fact' in item and not re.fullmatch(r'https://disclosure2dl\.edinet-fsa\.go\.jp/searchdocument/pdf/S[A-Z0-9]{7}\.pdf', str(item['fact'].get('source_url', ''))):
            return False
        for key in ('last_attempt_at', 'warm_finished_at', 'warm_resume_after', 'updated_at'):
            if key in item and (type(item[key]) not in (int, float) or not math.isfinite(item[key]) or item[key] < 0):
                return False
        if 'warm_progress' in item:
            progress = item['warm_progress']
            if (not _keys(progress, {'from', 'to', 'started_at', 'operations', 'status', 'last_date'})
                    or type(progress.get('started_at')) not in (int, float)
                    or not math.isfinite(progress['started_at']) or progress['started_at'] <= 0
                    or type(progress.get('operations')) is not int or not 0 <= progress['operations'] <= 420
                    or progress.get('status') not in ('pending', 'complete', 'interrupted')):
                return False
            try:
                for key in ('from', 'to', 'last_date'):
                    if key in progress and date.fromisoformat(progress[key]).isoformat() != progress[key]:
                        return False
                if 'from' not in progress or 'to' not in progress or progress['from'] > progress['to']:
                    return False
            except (ValueError, TypeError):
                return False
    # Do not allow arbitrarily long text in any other whitelisted field.
    def small(node):
        if isinstance(node, dict):
            return all(small(part) for part in node.values())
        if isinstance(node, list):
            return all(small(part) for part in node)
        return not isinstance(node, str) or len(node) <= 400
    return small(value)


class EdinetCheckpointStore:
    def __init__(self, transport, *, clock=time.monotonic):
        self.transport, self.clock = transport, clock
        self._private = False

    def after_fork(self):
        self._private = False
        self.transport.after_fork()

    def _check_private(self, deadline):
        if not self._private:
            response = self.transport._request('GET', '/bucket/' + BUCKET,
                                               deadline=deadline, clock=self.clock)
            if (not 200 <= response.status_code < 300 or not isinstance(response.json(), dict)
                    or response.json().get('public') is not False):
                raise StorageUnavailable('storage_private_required')
            self._private = True

    def load(self):
        deadline = self.clock() + 8
        self._check_private(deadline)
        wrapper = self.transport.read(CHECKPOINT_PATH, deadline=deadline, clock=self.clock)
        if wrapper is None:
            return None
        if (not _keys(wrapper, {'version', 'encoding', 'sha256', 'data'}) or wrapper.get('version') != 1
                or wrapper.get('encoding') != 'zlib-base64' or not isinstance(wrapper.get('data'), str)
                or len(wrapper['data']) > MAX_STORED_BYTES):
            raise ValueError('invalid_checkpoint')
        packed = base64.b64decode(wrapper['data'], validate=True)
        inflater = zlib.decompressobj()
        raw = inflater.decompress(packed, MAX_RAW_BYTES + 1)
        if len(raw) > MAX_RAW_BYTES or inflater.unconsumed_tail or not inflater.eof or inflater.unused_data:
            raise ValueError('invalid_checkpoint')
        if sha256(raw).hexdigest() != wrapper.get('sha256'):
            raise ValueError('invalid_checkpoint')
        cache = json.loads(raw)
        if not _cache(cache):
            raise ValueError('invalid_checkpoint')
        return cache

    def save(self, cache):
        if not _cache(cache):
            return False
        try:
            raw = json.dumps(cache, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
            if len(raw) > MAX_RAW_BYTES:
                return False
            wrapper = {'version': 1, 'encoding': 'zlib-base64', 'sha256': sha256(raw).hexdigest(),
                       'data': base64.b64encode(zlib.compress(raw)).decode('ascii')}
            body = json.dumps(wrapper, separators=(',', ':')).encode()
            if len(body) > MAX_STORED_BYTES:
                return False
            deadline = self.clock() + 8
            self._check_private(deadline)
            response = self.transport._request('POST', '/object/' + BUCKET + '/' + CHECKPOINT_PATH,
                    data=body, headers={'Content-Type': 'application/json', 'x-upsert': 'true',
                                        'Cache-Control': 'max-age=0'}, deadline=deadline, clock=self.clock)
            return 200 <= response.status_code < 300
        except Exception:
            return False

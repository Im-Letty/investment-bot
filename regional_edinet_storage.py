"""Compact public filing checkpoints in the existing private application bucket.

No bucket creation, policy changes, credentials in objects, or startup reads.
The service validates restored issuer/fiscal facts before accepting them.
"""
import base64
from copy import deepcopy
from datetime import date
from hashlib import sha256
import json
import math
import re
import time
import zlib

from daily_news_runtime import BUCKET, StorageUnavailable
from regional_edinet import _DESCRIPTOR_FIELDS, _date, _stamp, safe_edinet_diagnostic

CHECKPOINT_PATH = 'regional-edinet/v1/checkpoint.json'
FACT_PREFIX = 'regional-edinet/v1/facts'
MAX_FACT_RECORDS = 3
MAX_FACT_BYTES = 32_000
MAX_RAW_BYTES = 16_000_000
MAX_STORED_BYTES = 1_000_000
CHECKPOINT_ERROR_CODES = frozenset({
    'storage_configuration', 'storage_budget', 'storage_deadline', 'storage_response',
    'storage_network', 'storage_timeout', 'storage_bucket', 'storage_private_required',
    'storage_read', 'storage_write', 'storage_size', 'checkpoint_wrapper_invalid',
    'checkpoint_encoding_invalid', 'checkpoint_compression_invalid', 'checkpoint_digest_mismatch',
    'checkpoint_schema_invalid', 'checkpoint_size_limit', 'checkpoint_read_failed',
    'checkpoint_save_failed'})
FACT_KEYS = {'value', 'currency', 'unit', 'fiscal_period', 'tag', 'context_id', 'unit_id',
             'filing_submitted_at', 'fetched_at', 'doc_id', 'edinet_code', 'security_code',
             'source_url', 'source_title', 'kind', 'split_adjustment', 'latest_filing_guaranteed',
             'doc_type_code', 'base_doc_id', 'xbrl_body_sha256'}


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
        if not isinstance(code, str) or len(code) != 4 or not _keys(item, {'company', 'status', 'invalidated', 'last_attempt_at', 'attempted_doc_id', 'descriptor', 'fact', 'warm_progress', 'warm_finished_at', 'warm_resume_after', 'updated_at', 'diagnostic'}):
            return False
        if not _keys(item.get('company'), {'code', 'symbol', 'name', 'provider_symbol'}):
            return False
        if 'diagnostic' in item:
            diagnostic = item['diagnostic']
            if (not isinstance(diagnostic, dict) or not isinstance(diagnostic.get('phase'), str)
                    or not isinstance(diagnostic.get('reason'), str)
                    or safe_edinet_diagnostic(diagnostic) != diagnostic):
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


def _fact_record(record):
    """A small immutable public fact, independently of the mutable index."""
    if (not _keys(record, {'company', 'status', 'invalidated', 'descriptor', 'fact'})
            or record.get('status') != 'available' or record.get('invalidated') is not False):
        return None
    company, descriptor, fact = record.get('company'), record.get('descriptor'), record.get('fact')
    if not isinstance(company, dict) or not isinstance(descriptor, dict) or not isinstance(fact, dict):
        return None
    code = company.get('code')
    if (not isinstance(code, str) or not re.fullmatch(r'[0-9][A-Z0-9]{3}', code)
            or company.get('symbol') != code + '.JP' or company.get('provider_symbol') is not None
            or not _cache({'version': 1, 'snapshots': {}, 'records': {code: record}})):
        return None
    period, submitted = fact.get('fiscal_period'), _stamp(fact.get('filing_submitted_at'))
    if not isinstance(period, dict) or not submitted:
        return None
    start, end = _date(period.get('start')), _date(period.get('end'))
    doc_id = fact.get('doc_id')
    if (not start or not end or not 0 <= (end - start).days <= 550 or end > submitted.date()
            or period['start'] != start.isoformat() or period['end'] != end.isoformat()
            or not isinstance(doc_id, str) or not re.fullmatch(r'S[A-Z0-9]{7}', doc_id)
            or descriptor.get('docID') != doc_id or descriptor.get('secCode') != code + '0'
            or fact.get('security_code') != code + '0'
            or fact.get('edinet_code') != descriptor.get('edinetCode')
            or fact.get('fiscal_period') != {'start': descriptor.get('periodStart'), 'end': descriptor.get('periodEnd')}
            or fact.get('filing_submitted_at') != descriptor.get('submitDateTime')
            or fact.get('doc_type_code') != descriptor.get('docTypeCode')
            or fact.get('base_doc_id') != descriptor.get('_annual_base', descriptor).get('docID')
            or type(fact.get('value')) not in (int, float) or not math.isfinite(fact['value'])
            or not 0 <= fact['value'] <= 1_000_000_000
            or fact.get('currency') != 'JPY' or fact.get('unit') != 'JPY/share'
            or fact.get('kind') != 'filed_fiscal_period_dividend'
            or fact.get('split_adjustment') != 'as_reported' or fact.get('latest_filing_guaranteed') is not False
            or not isinstance(fact.get('xbrl_body_sha256'), str)
            or not re.fullmatch(r'[a-f0-9]{64}', fact['xbrl_body_sha256'])
            or type(fact.get('fetched_at')) not in (int, float) or not math.isfinite(fact['fetched_at'])
            or fact['fetched_at'] < submitted.timestamp()):
        return None
    return FACT_PREFIX + '/' + code + '/' + end.isoformat() + '-' + submitted.strftime('%Y%m%d%H%M') + '-' + doc_id + '.json'


def _fact_wrapper(wrapper, path):
    if not _keys(wrapper, {'version', 'sha256', 'record'}) or wrapper.get('version') != 1:
        return None
    record = wrapper.get('record')
    if _fact_record(record) != path:
        return None
    try:
        raw = json.dumps(record, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
    except (ValueError, TypeError, OverflowError):
        return None
    if len(raw) > MAX_FACT_BYTES or wrapper.get('sha256') != sha256(raw).hexdigest():
        return None
    return record


def _fact_content(record):
    # An immutable journal keeps its original observation timestamp. Only a
    # re-observation timestamp and the catalogue's display name may differ;
    # issuer codes, filed dates, original XBRL digest and all fact content remain
    # exact. The service independently validates the stored issuer name again.
    fact = {key: value for key, value in record['fact'].items() if key != 'fetched_at'}
    company = {key: record['company'].get(key) for key in ('code', 'symbol', 'provider_symbol')}
    return {'company': company, 'descriptor': record['descriptor'], 'fact': fact}


class EdinetCheckpointStore:
    def __init__(self, transport, *, clock=time.monotonic):
        self.transport, self.clock = transport, clock
        self._private = False
        self.last_load_error = self.last_save_error = None
        self.last_saved_fact_record = None
        self.last_fact_created = False

    def after_fork(self):
        self._private = False
        self.transport.after_fork()
        self.last_load_error = self.last_save_error = None
        self.last_saved_fact_record = None
        self.last_fact_created = False

    def _check_private(self, deadline):
        if not self._private:
            response = self.transport._request('GET', '/bucket/' + BUCKET,
                                               deadline=deadline, clock=self.clock)
            if not 200 <= response.status_code < 300:
                raise StorageUnavailable('storage_bucket')
            try:
                value = response.json()
            except Exception:
                raise StorageUnavailable('storage_response') from None
            if not isinstance(value, dict) or value.get('public') is not False:
                raise StorageUnavailable('storage_private_required')
            self._private = True

    def load(self):
        self.last_load_error = None
        try:
            deadline = self.clock() + 8
            self._check_private(deadline)
            wrapper = self.transport.read(CHECKPOINT_PATH, deadline=deadline, clock=self.clock)
            if wrapper is None:
                return None
            if (not _keys(wrapper, {'version', 'encoding', 'sha256', 'data'}) or wrapper.get('version') != 1
                    or wrapper.get('encoding') != 'zlib-base64' or not isinstance(wrapper.get('data'), str)):
                self.last_load_error = 'checkpoint_wrapper_invalid'
                raise ValueError('invalid_checkpoint')
            if len(wrapper['data']) > MAX_STORED_BYTES:
                self.last_load_error = 'checkpoint_size_limit'
                raise ValueError('invalid_checkpoint')
            try:
                packed = base64.b64decode(wrapper['data'], validate=True)
            except (ValueError, TypeError):
                self.last_load_error = 'checkpoint_encoding_invalid'
                raise ValueError('invalid_checkpoint') from None
            inflater = zlib.decompressobj()
            try:
                raw = inflater.decompress(packed, MAX_RAW_BYTES + 1)
            except zlib.error:
                self.last_load_error = 'checkpoint_compression_invalid'
                raise ValueError('invalid_checkpoint') from None
            if len(raw) > MAX_RAW_BYTES or inflater.unconsumed_tail:
                self.last_load_error = 'checkpoint_size_limit'
                raise ValueError('invalid_checkpoint')
            if not inflater.eof or inflater.unused_data:
                self.last_load_error = 'checkpoint_compression_invalid'
                raise ValueError('invalid_checkpoint')
            if sha256(raw).hexdigest() != wrapper.get('sha256'):
                self.last_load_error = 'checkpoint_digest_mismatch'
                raise ValueError('invalid_checkpoint')
            try:
                cache = json.loads(raw)
                valid = _cache(cache)
            except (ValueError, TypeError, KeyError, OverflowError, AttributeError):
                valid = False
            if not valid:
                self.last_load_error = 'checkpoint_schema_invalid'
                raise ValueError('invalid_checkpoint')
            return cache
        except Exception as error:
            if self.last_load_error is None:
                code = str(error) if isinstance(error, StorageUnavailable) else None
                self.last_load_error = code if code in CHECKPOINT_ERROR_CODES else 'checkpoint_read_failed'
            raise

    def save(self, cache):
        self.last_save_error = None
        if not _cache(cache):
            self.last_save_error = 'checkpoint_schema_invalid'
            return False
        try:
            raw = json.dumps(cache, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
            if len(raw) > MAX_RAW_BYTES:
                self.last_save_error = 'checkpoint_size_limit'
                return False
            wrapper = {'version': 1, 'encoding': 'zlib-base64', 'sha256': sha256(raw).hexdigest(),
                       'data': base64.b64encode(zlib.compress(raw)).decode('ascii')}
            body = json.dumps(wrapper, separators=(',', ':')).encode()
            if len(body) > MAX_STORED_BYTES:
                self.last_save_error = 'checkpoint_size_limit'
                return False
            deadline = self.clock() + 8
            self._check_private(deadline)
            response = self.transport._request('POST', '/object/' + BUCKET + '/' + CHECKPOINT_PATH,
                    data=body, headers={'Content-Type': 'application/json', 'x-upsert': 'true',
                                        'Cache-Control': 'max-age=0'}, deadline=deadline, clock=self.clock)
            success = 200 <= response.status_code < 300
            if not success:
                self.last_save_error = 'storage_write'
            return success
        except Exception as error:
            code = str(error) if isinstance(error, StorageUnavailable) else None
            self.last_save_error = code if code in CHECKPOINT_ERROR_CODES else 'checkpoint_save_failed'
            return False

    def save_fact(self, record):
        """Create once. A competing different fact can never overwrite it."""
        self.last_save_error = None
        self.last_saved_fact_record = None
        self.last_fact_created = False
        try:
            path = _fact_record(record)
            if path is None:
                self.last_save_error = 'checkpoint_schema_invalid'
                return False
            raw = json.dumps(record, sort_keys=True, ensure_ascii=False,
                             separators=(',', ':'), allow_nan=False).encode()
            if len(raw) > MAX_FACT_BYTES:
                self.last_save_error = 'checkpoint_size_limit'
                return False
            wrapper = {'version': 1, 'sha256': sha256(raw).hexdigest(), 'record': record}
            deadline = self.clock() + 8
            self._check_private(deadline)
            if self.transport.create(path, wrapper, deadline=deadline, clock=self.clock):
                self.last_saved_fact_record = deepcopy(record)
                self.last_fact_created = True
                return True
            # A duplicate means only that an object exists, not that this fact
            # was persisted. Compare the exact accepted fact and original dates.
            existing = self.transport.read(path, deadline=deadline, clock=self.clock)
            valid = _fact_wrapper(existing, path)
            if valid is not None and _fact_content(valid) == _fact_content(record):
                self.last_saved_fact_record = deepcopy(valid)
                return True
            self.last_save_error = 'checkpoint_digest_mismatch'
            return False
        except Exception as error:
            code = str(error) if isinstance(error, StorageUnavailable) else None
            self.last_save_error = code if code in CHECKPOINT_ERROR_CODES else 'checkpoint_save_failed'
            return False

    def load_facts(self, code, *, from_date, to_date):
        """Read at most three selected-issuer facts in the current 400-day range.

        Unknown or excessive matching records fail closed. This is supplemental
        recovery, not a guarantee that a latest filing or atomic snapshot exists.
        """
        self.last_load_error = None
        try:
            start, end = _date(from_date), _date(to_date)
            if (not isinstance(code, str) or not re.fullmatch(r'[0-9][A-Z0-9]{3}', code)
                    or not start or not end or not 0 <= (end - start).days < 400):
                self.last_load_error = 'checkpoint_schema_invalid'
                raise ValueError('invalid_checkpoint')
            deadline = self.clock() + 8
            self._check_private(deadline)
            prefix = FACT_PREFIX + '/' + code
            rows = self.transport._list(prefix, deadline=deadline, clock=self.clock)
            if not isinstance(rows, list) or len(rows) >= 30:
                self.last_load_error = 'checkpoint_size_limit'
                raise ValueError('invalid_checkpoint')
            names = []
            pattern = r'(\d{4}-\d{2}-\d{2})-(\d{8})\d{4}-S[A-Z0-9]{7}\.json'
            for row in rows:
                name = row.get('name') if isinstance(row, dict) else None
                matched = re.fullmatch(pattern, name) if isinstance(name, str) else None
                if not matched:
                    self.last_load_error = 'checkpoint_schema_invalid'
                    raise ValueError('invalid_checkpoint')
                try:
                    submitted = date.fromisoformat(matched[2][:4] + '-' + matched[2][4:6] + '-' + matched[2][6:])
                except ValueError:
                    self.last_load_error = 'checkpoint_schema_invalid'
                    raise ValueError('invalid_checkpoint') from None
                if start <= submitted <= end:
                    names.append(name)
            if len(names) > MAX_FACT_RECORDS or len(set(names)) != len(names):
                self.last_load_error = 'checkpoint_size_limit'
                raise ValueError('invalid_checkpoint')
            records = []
            for name in sorted(names, reverse=True):
                path = prefix + '/' + name
                wrapper = self.transport.read(path, deadline=deadline, clock=self.clock)
                record = _fact_wrapper(wrapper, path)
                if record is None:
                    self.last_load_error = 'checkpoint_schema_invalid'
                    raise ValueError('invalid_checkpoint')
                records.append(record)
            return records
        except Exception as error:
            if self.last_load_error is None:
                code = str(error) if isinstance(error, StorageUnavailable) else None
                self.last_load_error = code if code in CHECKPOINT_ERROR_CODES else 'checkpoint_read_failed'
            raise

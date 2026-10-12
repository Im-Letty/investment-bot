"""Optional regional fiscal-dividend discovery. No startup or keyless requests.

A selected company starts a bounded warm job: newest to oldest, at most 400
inclusive days / 420 provider operations / eight hours. EDINET metadata and
filing downloads share the provider's 60-second cross-process gate. A complete
index is an observed range, never an atomic or guaranteed latest-filing snapshot.
The cache can be ephemeral (for example /tmp on Render).
"""
from collections import OrderedDict
from copy import deepcopy
from datetime import datetime, timedelta
import fcntl
from hashlib import sha256
import json
import math
import os
import re
from pathlib import Path
import threading
import time

from regional_edinet import (EdinetAnnualDividends, JST, _date, _descriptor_valid,
                            _issuer_valid, _active, _stamp, _DESCRIPTOR_FIELDS, TAG, load_identity_seed, load_filing_hints, match_identity,
                            parse_daily_filings, select_annual_filing)
from regional_edinet_storage import CHECKPOINT_ERROR_CODES

MAX_CACHE_BYTES = 16_000_000
MAX_CACHE_ROWS = 25_000
MAX_FACTS = 8192
MAX_QUEUE = 64
INVALIDATED = {'filing_invalidated', 'correction_unconfirmed', 'identity_unconfirmed'}
FACT_KEYS = {'value', 'currency', 'unit', 'fiscal_period', 'tag', 'context_id', 'unit_id',
             'filing_submitted_at', 'fetched_at', 'doc_id', 'edinet_code', 'security_code',
             'source_url', 'source_title', 'kind', 'split_adjustment', 'latest_filing_guaranteed',
             'doc_type_code', 'base_doc_id', 'xbrl_body_sha256'}


class RegionalEdinetDividends:
    def __init__(self, cache_path, *, api_key=None, identities=None, provider=None,
                 clock=time.time, monotonic=time.monotonic, window_days=400,
                 max_warm_operations=420, max_warm_seconds=8 * 3600, checkpoint_store=None,
                 filing_hint_path=None):
        self.cache_path, self.clock, self.monotonic = Path(cache_path), clock, monotonic
        self.checkpoint_store = checkpoint_store
        self.identities = tuple(load_identity_seed(observed_at=clock()) if identities is None else identities)
        hint_options = {'identities': self.identities, 'observed_at': clock()}
        if filing_hint_path is not None:
            hint_options['path'] = filing_hint_path
        self.filing_hints = {row['code']: row for row in load_filing_hints(**hint_options)}
        self.window_days = min(400, max(1, int(window_days)))
        self.max_warm_operations = min(420, max(1, int(max_warm_operations)))
        self.max_warm_seconds = min(8 * 3600, max(1, float(max_warm_seconds)))
        self.provider = provider or EdinetAnnualDividends(api_key, identities=self.identities,
                            cooldown_path=str(self.cache_path) + '.request-state.json', clock=clock,
                            monotonic=monotonic)
        self.configured = bool(self.provider.configured)
        self._reset_process()
        if hasattr(os, 'register_at_fork'):
            os.register_at_fork(after_in_child=self._reset_process)

    def _reset_process(self):
        self._pid = os.getpid()
        self._condition = threading.Condition()
        self._snapshots, self._records = {}, OrderedDict()
        self._jobs, self._worker, self._closed = OrderedDict(), None, False
        self._last_load, self._persistence_failed = 0, False
        self._checkpoint_restored = False
        self._checkpoint_restore_retry_at = 0
        self._checkpoint_save_allowed = False
        self._checkpoint_status = 'disabled' if self.checkpoint_store is None else 'pending'
        self._checkpoint_retry_at = 0
        self._restored_next_request = 0
        self._local_save_status = 'pending'
        self._checkpoint_restore_status = self._checkpoint_status
        self._checkpoint_restored_at = self._checkpoint_saved_at = None
        self._checkpoint_restored_days = 0
        self._checkpoint_restored_facts = {}
        self._checkpoint_saved_facts = {}
        self._checkpoint_restore_error = self._checkpoint_save_error = None
        self._journal_restore_done, self._journal_retry_at = set(), {}
        self._journal_saved_facts = {}
        self._journal_existing_facts = {}
        self._journal_pending_records, self._journal_pending_dates = {}, {}
        self._journal_created_facts = {}
        self._load()

    @staticmethod
    def _fact_hash(fact):
        """Compare only validated public filing facts, never transport data."""
        return sha256(json.dumps(fact, sort_keys=True, separators=(',', ':'),
                                 ensure_ascii=False, allow_nan=False).encode()).hexdigest()

    def _days(self):
        today = datetime.fromtimestamp(self.clock(), JST).date()
        return [(today - timedelta(days=offset)).isoformat() for offset in range(self.window_days)]

    @staticmethod
    def _clean_descriptor(row, depth=0):
        if not isinstance(row, dict) or depth > 1:
            return None
        output = {key: row.get(key) for key in _DESCRIPTOR_FIELDS}
        if any(value is not None and (not isinstance(value, str) or len(value) > 250)
               for value in output.values()):
            return None
        if row.get('_annual_base') is not None:
            output['_annual_base'] = RegionalEdinetDividends._clean_descriptor(row['_annual_base'], depth + 1)
        if row.get('_correction_chain') is not None:
            chain = row['_correction_chain']
            if not isinstance(chain, list) or not 0 < len(chain) <= 16:
                return None
            output['_correction_chain'] = [RegionalEdinetDividends._clean_descriptor(item, depth + 1) for item in chain]
        return output

    def _clean_record(self, code, record):
        if not isinstance(record, dict):
            return None
        company = record.get('company')
        identity = match_identity(company, self.identities)
        if not identity or identity.code != code:
            return None
        output = {'company': {key: company.get(key) for key in ('code', 'symbol', 'name', 'provider_symbol')},
                  'status': record.get('status') if record.get('status') in
                  {'available', 'pending', 'source_missing', 'fetch_error', 'rate_limited', 'provider_waiting',
                   'invalid_source', 'filing_invalidated', 'correction_unconfirmed', 'identity_unconfirmed',
                   'warm_budget_exhausted'} else 'pending',
                  'invalidated': record.get('invalidated') is True}
        for key in ('last_attempt_at', 'warm_finished_at', 'warm_resume_after', 'updated_at'):
            stamp = record.get(key)
            if type(stamp) in (int, float) and math.isfinite(stamp) and stamp >= 0:
                output[key] = stamp
        doc_id = record.get('attempted_doc_id')
        if isinstance(doc_id, str) and re.fullmatch(r'S[A-Z0-9]{7}', doc_id):
            output['attempted_doc_id'] = doc_id
        cleaned_descriptor = self._clean_descriptor(record.get('descriptor'))
        if cleaned_descriptor is not None:
            output['descriptor'] = cleaned_descriptor
        progress = record.get('warm_progress')
        if (isinstance(progress, dict) and _date(progress.get('from')) and _date(progress.get('to'))
                and type(progress.get('started_at')) in (int, float)
                and math.isfinite(progress['started_at']) and 0 < progress['started_at'] <= self.clock()
                and type(progress.get('operations')) is int and 0 <= progress['operations'] <= 420
                and progress.get('status') in ('pending', 'complete', 'interrupted')):
            output['warm_progress'] = {key: progress[key] for key in ('from', 'to', 'started_at', 'operations', 'status')}
            if _date(progress.get('last_date')):
                output['warm_progress']['last_date'] = progress['last_date']
        fact = record.get('fact')
        descriptor = cleaned_descriptor
        try:
            valid = (_descriptor_valid(descriptor, identity, datetime.fromtimestamp(self.clock(), JST))
                     and isinstance(fact, dict) and set(fact) <= FACT_KEYS
                     and type(fact.get('value')) in (int, float) and math.isfinite(fact['value'])
                     and 0 <= fact['value'] <= 1e9 and fact.get('currency') == 'JPY'
                     and fact.get('unit') == 'JPY/share'
                     and fact.get('kind') == 'filed_fiscal_period_dividend'
                     and fact.get('source_title') == 'EDINET 有価証券報告書'
                     and fact.get('tag') == 'jpcrp_cor:' + TAG
                     and all(isinstance(fact.get(key), str) and 0 < len(fact[key]) <= 250
                             for key in ('context_id', 'unit_id'))
                     and fact.get('split_adjustment') == 'as_reported'
                     and fact.get('latest_filing_guaranteed') is False
                     and ('xbrl_body_sha256' not in fact or isinstance(fact['xbrl_body_sha256'], str)
                          and re.fullmatch(r'[a-f0-9]{64}', fact['xbrl_body_sha256']))
                     and fact.get('doc_id') == descriptor['docID']
                     and fact.get('doc_type_code', descriptor['docTypeCode']) == descriptor['docTypeCode']
                     and fact.get('base_doc_id', descriptor.get('_annual_base', descriptor)['docID'])
                         == descriptor.get('_annual_base', descriptor)['docID']
                     and fact.get('security_code') == identity.security_code
                     and fact.get('edinet_code') == identity.edinet_code
                     and fact.get('fiscal_period') == {'start': descriptor['periodStart'], 'end': descriptor['periodEnd']}
                     and fact.get('filing_submitted_at') == descriptor['submitDateTime']
                     and type(fact.get('fetched_at')) in (int, float)
                     and 0 < fact['fetched_at'] <= self.clock()
                     and fact.get('source_url') == 'https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/' + descriptor['docID'] + '.pdf')
        except (TypeError, ValueError, OverflowError, KeyError):
            valid = False
        if valid and not output['invalidated']:
            output['fact'] = deepcopy(fact)
        # Never persist arbitrary provider error strings, URLs, response bodies or keys.
        return output

    def _merge_cache(self, cache, *, checkpoint_observation=None):
        try:
            if not isinstance(cache, dict) or set(cache) - {'version', 'snapshots', 'records', 'next_request'}:
                return False
            if (cache.get('version') != 1 or not isinstance(cache.get('snapshots'), dict)
                    or not isinstance(cache.get('records'), dict) or len(cache['snapshots']) > 400
                    or len(cache['records']) > MAX_FACTS):
                return False
            cooldown = cache.get('next_request', 0)
            if type(cooldown) not in (int, float) or not math.isfinite(cooldown) or cooldown < 0:
                return False
            days, row_count = set(self._days()), 0
            snapshots = {}
            for day, snapshot in cache.get('snapshots', {}).items():
                if day not in days or not isinstance(snapshot, dict):
                    continue
                rows = snapshot.get('rows')
                stamp = snapshot.get('fetched_at')
                if not isinstance(rows, list) or type(stamp) not in (int, float) or not 0 < stamp <= self.clock():
                    continue
                envelope = {'metadata': {'status': '200', 'parameter': {'date': day, 'type': '2'},
                              'resultset': {'count': len(rows)}, 'processDateTime': snapshot.get('process_at')},
                            'results': rows}
                cleaned = parse_daily_filings(envelope, day, stamp)
                removed = snapshot.get('removed_doc_ids', [])
                if (not isinstance(removed, list) or any(not isinstance(doc, str) or len(doc) != 8
                                                        or not re.fullmatch(r'S[A-Z0-9]{7}', doc) for doc in removed)):
                    continue
                if removed:
                    cleaned['removed_doc_ids'] = list(set(removed))
                row_count += len(cleaned['rows'])
                if row_count > MAX_CACHE_ROWS:
                    return False
                snapshots[day] = cleaned
            records = OrderedDict()
            for code, record in list(cache.get('records', {}).items())[-MAX_FACTS:]:
                cleaned = self._clean_record(code, record)
                if cleaned:
                    records[code] = cleaned
            # Existing in-memory newer observations always win over an old file.
            for day, snapshot in snapshots.items():
                old = self._snapshots.get(day)
                if not old or (snapshot['process_at'], snapshot['fetched_at']) >= (old['process_at'], old['fetched_at']):
                    if old and (snapshot['process_at'], snapshot['fetched_at']) == (old['process_at'], old['fetched_at']) and old['rows'] != snapshot['rows']:
                        previous_rows = {row['docID']: row for row in old['rows']}
                        current_rows = {row['docID']: row for row in snapshot['rows']}
                        conflicting = {doc for doc in previous_rows.keys() | current_rows.keys()
                                       if previous_rows.get(doc) != current_rows.get(doc)}
                        snapshot['removed_doc_ids'] = sorted(conflicting | set(old.get('removed_doc_ids', ())))
                    self._snapshots[day] = snapshot
            for code, record in records.items():
                old = self._records.get(code)
                if (not old or record.get('updated_at', record.get('last_attempt_at', 0)) > old.get('updated_at', old.get('last_attempt_at', 0))
                        or record.get('invalidated') and record.get('updated_at', 0) >= old.get('updated_at', 0)):
                    self._records[code] = record
            self._restored_next_request = max(self._restored_next_request, cooldown)
            for current in self._records.values():
                selection = self._selection(current)
                if selection.get('invalidated'):
                    current.update(status=selection['status'], invalidated=True)
                    current.pop('fact', None)
            if checkpoint_observation is not None:
                # Count validated remote observations, independent of whether a
                # newer local observation wins. Only the exact accepted fact can
                # later be marked as restored for the selected issuer.
                checkpoint_observation['indexed_days'] = len(snapshots)
                checkpoint_observation['facts'] = {
                    code: self._fact_hash(record['fact']) for code, record in records.items()
                    if record.get('fact') and self._records.get(code, {}).get('fact') == record['fact']}
            self._last_load = self.clock()
            return True
        except (OSError, ValueError, TypeError, AttributeError, OverflowError):
            return False

    def _load(self):
        try:
            if self.cache_path.exists() and self.cache_path.stat().st_size <= MAX_CACHE_BYTES:
                self._merge_cache(json.loads(self.cache_path.read_bytes()))
        except (OSError, ValueError, TypeError):
            pass

    def _restore_checkpoint(self):
        if (self._checkpoint_restored or not self.checkpoint_store or not self.configured
                or self.clock() < self._checkpoint_restore_retry_at):
            return
        try:
            cache = self.checkpoint_store.load()
            if cache is None:
                self._checkpoint_status = 'missing'
                self._checkpoint_restored = self._checkpoint_save_allowed = True
                self._checkpoint_restore_status = 'missing'
                self._checkpoint_restore_error = None
            else:
                observation = {}
                with self._condition:
                    valid = self._merge_cache(cache, checkpoint_observation=observation)
                self._checkpoint_status = 'restored' if valid else 'invalid'
                self._checkpoint_restored = self._checkpoint_save_allowed = valid
                self._checkpoint_restore_status = self._checkpoint_status
                self._checkpoint_restore_error = None if valid else 'checkpoint_schema_invalid'
                if valid:
                    self._checkpoint_restored_at = self.clock()
                    self._checkpoint_restored_days = observation['indexed_days']
                    self._checkpoint_restored_facts = observation['facts']
        except Exception:
            self._checkpoint_status = 'load_failed'
            self._checkpoint_restore_status = 'load_failed'
            code = getattr(self.checkpoint_store, 'last_load_error', None)
            self._checkpoint_restore_error = (code if isinstance(code, str) and code in CHECKPOINT_ERROR_CODES
                                               else 'checkpoint_read_failed')
        if not self._checkpoint_restored:
            self._checkpoint_restore_retry_at = self.clock() + 60

    def _restore_selected_fact(self, code, job):
        store = self.checkpoint_store
        if (not self.configured or store is None or not callable(getattr(type(store), 'load_facts', None))
                or code in self._journal_restore_done or self.clock() < self._journal_retry_at.get(code, 0)):
            return
        current = self._records[code]
        if current.get('invalidated') is True or current.get('status') in INVALIDATED:
            self._journal_restore_done.add(code)
            return
        if current.get('fact'):
            self._journal_restore_done.add(code)
            return
        today = self._days()[0]
        snapshot = self._snapshots.get(today)
        # Never bring back a historical journal fact before today's metadata has
        # been successfully observed. Existing retained facts keep their dates.
        if not snapshot or snapshot['fetched_at'] < job['started_at']:
            return
        try:
            days = self._days()
            records = self._journal_pending_records.get(code)
            if records is None:
                records = store.load_facts(code, from_date=days[-1], to_date=days[0])
                self._journal_pending_records[code] = records
            if not isinstance(records, list) or len(records) > 3:
                raise ValueError('invalid_checkpoint')
            candidates, evidence, required_rows = {}, list(self._snapshots.values()), []
            for item in records:
                cleaned = self._clean_record(code, item)
                if not cleaned or not cleaned.get('fact'):
                    raise ValueError('invalid_checkpoint')
                fact, descriptor = cleaned['fact'], cleaned['descriptor']
                rows = ([descriptor['_annual_base'], *descriptor['_correction_chain']]
                        if descriptor.get('_annual_base') else [descriptor])
                required_rows.extend(rows)
                candidates[fact['doc_id']] = cleaned
            identity = match_identity(current['company'], self.identities)
            required_dates = sorted({row['submitDateTime'][:10] for row in required_rows}, reverse=True)
            self._journal_pending_dates[code] = required_dates
            for day in required_dates:
                if day not in days:
                    self._journal_restore_done.add(code)
                    return  # Original metadata outside the bounded window remains unconfirmed.
                current_snapshot = self._snapshots.get(day)
                if not current_snapshot or current_snapshot['fetched_at'] < job['started_at']:
                    return  # _action schedules this exact date through the provider's existing gate.
            for expected in required_rows:
                live = [row for row in self._snapshots[expected['submitDateTime'][:10]]['rows']
                        if row['docID'] == expected['docID']]
                if (len(live) != 1 or not _issuer_valid(live[0], identity) or not _active(live[0])
                        or any(live[0].get(key) != expected.get(key) for key in
                               ('docTypeCode', 'submitDateTime', 'parentDocID'))
                        or any(live[0].get(key) not in (None, '', expected.get(key))
                               for key in ('periodStart', 'periodEnd'))):
                    self._journal_restore_done.add(code)
                    return  # An absent/revoked/changed original is never revived from the archive.
            selected = select_annual_filing(evidence, identity, self.clock())
            candidate = candidates.get(selected.get('descriptor', {}).get('docID'))
            # Metadata from the current index wins over old journal observations:
            # withdrawals, corrections, ambiguity and a newer known filing never
            # fall back to an older persisted amount.
            if candidate is not None and not selected.get('invalidated'):
                candidate['descriptor'] = selected['descriptor']
                candidate = self._clean_record(code, candidate)
                if candidate and candidate.get('fact') and not self._selection(candidate, evidence=evidence).get('invalidated'):
                    with self._condition:
                        current.update(status='available', invalidated=False,
                                       fact=candidate['fact'], descriptor=candidate['descriptor'])
                        fingerprint = self._fact_hash(candidate['fact'])
                        self._checkpoint_restored_facts[code] = fingerprint
                        self._journal_existing_facts[code] = fingerprint
                        self._checkpoint_restored_at = self.clock()
                        self._checkpoint_restore_status = self._checkpoint_status = 'restored'
                        self._checkpoint_restore_error = None
            self._journal_restore_done.add(code)
        except Exception:
            error = getattr(store, 'last_load_error', None)
            self._checkpoint_restore_error = (error if isinstance(error, str) and error in CHECKPOINT_ERROR_CODES
                                               else 'checkpoint_schema_invalid')
            self._journal_retry_at[code] = self.clock() + 60

    def _write_local_cache(self, cache):
        try:
            raw = json.dumps(cache, ensure_ascii=False, separators=(',', ':'))
            if len(raw.encode()) > MAX_CACHE_BYTES or sum(len(value['rows']) for value in cache['snapshots'].values()) > MAX_CACHE_ROWS:
                raise ValueError('cache_full')
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.cache_path.with_name(self.cache_path.name + '.' + str(os.getpid()) + '.tmp')
            try:
                temporary.write_text(raw)
                os.replace(temporary, self.cache_path)
            finally:
                temporary.unlink(missing_ok=True)
            self._persistence_failed = False
            self._local_save_status = 'saved'
        except (OSError, ValueError, TypeError):
            self._persistence_failed = True
            self._local_save_status = 'save_failed'

    def _save(self):
        with self._condition:
            days = set(self._days())
            self._snapshots = {day: value for day, value in self._snapshots.items() if day in days}
            cache = {'version': 1, 'snapshots': deepcopy(self._snapshots),
                     'records': {code: cleaned for code, record in list(self._records.items())[-MAX_FACTS:]
                                for cleaned in [self._clean_record(code, record)] if cleaned},
                     'next_request': self.provider.next_request_at() if hasattr(self.provider, 'next_request_at') else 0}
        journal_error = None
        if (self.checkpoint_store and self.configured and self.clock() >= self._checkpoint_retry_at
                and callable(getattr(type(self.checkpoint_store), 'save_fact', None))):
            for code, record in cache['records'].items():
                fact = record.get('fact')
                if not fact or not fact.get('xbrl_body_sha256') or self._journal_existing_facts.get(code) == self._fact_hash(fact):
                    continue
                immutable = {'company': record['company'], 'status': 'available', 'invalidated': False,
                             'descriptor': record['descriptor'], 'fact': fact}
                try:
                    saved = self.checkpoint_store.save_fact(deepcopy(immutable)) is True
                except Exception:
                    saved = False
                if saved:
                    saved_record = self._clean_record(code, getattr(self.checkpoint_store, 'last_saved_fact_record', None))
                    old = saved_record.get('fact') if saved_record else None
                    # A repeated fetch may only adopt the original stored time
                    # after independent issuer validation and exact content /
                    # original XBRL hash equality. Never mark a different
                    # in-memory fingerprint as saved.
                    if (old and {k: v for k, v in old.items() if k != 'fetched_at'} ==
                            {k: v for k, v in fact.items() if k != 'fetched_at'}):
                        with self._condition:
                            current = self._records[code]
                            if current.get('fact') == fact:
                                current['fact'] = deepcopy(old)
                                cache['records'][code]['fact'] = deepcopy(old)
                        self._journal_existing_facts[code] = self._fact_hash(old)
                        self._journal_saved_facts[code] = self._fact_hash(old)
                        if getattr(self.checkpoint_store, 'last_fact_created', False) is True:
                            self._journal_created_facts[code] = self._fact_hash(old)
                            self._checkpoint_saved_at = self.clock()
                            self._checkpoint_status = 'saved'
                    else:
                        saved = False
                        journal_error = 'checkpoint_schema_invalid'
                else:
                    error = getattr(self.checkpoint_store, 'last_save_error', None)
                    journal_error = (error if isinstance(error, str) and error in CHECKPOINT_ERROR_CODES
                                     else 'checkpoint_save_failed')
        self._write_local_cache(cache)
        if (self.checkpoint_store and self.configured and self._checkpoint_save_allowed
                and self.clock() >= self._checkpoint_retry_at):
            try:
                success = self.checkpoint_store.save(deepcopy(cache)) is True
                self._checkpoint_status = 'saved' if success else 'save_failed'
                code = getattr(self.checkpoint_store, 'last_save_error', None)
                self._checkpoint_save_error = (None if success else
                    code if isinstance(code, str) and code in CHECKPOINT_ERROR_CODES else 'checkpoint_save_failed')
                if success:
                    self._checkpoint_saved_at = self.clock()
                    self._checkpoint_saved_facts = {
                        code: self._fact_hash(record['fact']) for code, record in cache['records'].items()
                        if record.get('fact')}
            except Exception:
                success, self._checkpoint_status = False, 'save_failed'
                self._checkpoint_save_error = 'checkpoint_save_failed'
            self._checkpoint_retry_at = 0 if success else self.clock() + 60
        if journal_error:
            self._checkpoint_save_error = journal_error
            self._checkpoint_retry_at = self.clock() + 60

    def _persistence(self, code=None, fact=None):
        fingerprint = self._fact_hash(fact) if fact and fact.get('xbrl_body_sha256') else None
        journal = self.checkpoint_store is not None and callable(getattr(type(self.checkpoint_store), 'save_fact', None))
        saved = (self._journal_saved_facts.get(code) == fingerprint and
                 (self._journal_created_facts.get(code) == fingerprint or
                  self._checkpoint_saved_facts.get(code) == fingerprint)) if journal else self._checkpoint_saved_facts.get(code) == fingerprint
        return {'local_status': self._local_save_status,
                'durable_status': self._checkpoint_status,
                'restore_status': self._checkpoint_restore_status,
                'restore_error': self._checkpoint_restore_error,
                'save_error': self._checkpoint_save_error,
                'restored_at': self._checkpoint_restored_at,
                'saved_at': self._checkpoint_saved_at,
                'restored_indexed_days': self._checkpoint_restored_days,
                'restored_facts': len(self._checkpoint_restored_facts),
                'selected_fact_restored': bool(fingerprint and
                    self._checkpoint_restored_facts.get(code) == fingerprint),
                'selected_fact_saved': bool(fingerprint and saved),
                'snapshot_guaranteed': False, 'cross_instance_cas': False}

    def _coverage(self):
        days = self._days()
        present = [day for day in days if day in self._snapshots]
        stale = sum(self.clock() - self._snapshots[day]['fetched_at'] > (3600 if day == days[0] else 86400)
                    for day in present)
        return {'window_days': self.window_days, 'from': days[-1], 'to': days[0],
                'indexed_days': len(present), 'missing_days': self.window_days - len(present),
                'stale_days': stale, 'complete': len(present) == self.window_days,
                'snapshot_guaranteed': False, 'latest_filing_guaranteed': False,
                'observed_at': max((self._snapshots[day]['fetched_at'] for day in present), default=None)}

    def get(self, company):
        if self._pid != os.getpid():
            self._reset_process()
        with self._condition:
            coverage = self._coverage()
            if not self.configured:
                return {'configured': False, 'status': 'not_configured', 'refreshing': False,
                        'data': {}, 'dividend_fact': None, 'invalidated': False,
                        'field_status': {'historical_dividend_per_share': 'unconfirmed'}, 'coverage': coverage,
                        'persistence': self._persistence()}
            identity = match_identity(company, self.identities)
            if identity is None or _date(identity.as_of) > datetime.fromtimestamp(self.clock(), JST).date():
                return {'configured': True, 'status': 'identity_unconfirmed', 'refreshing': False,
                        'invalidated': True, 'data': {}, 'dividend_fact': None,
                        'field_status': {'historical_dividend_per_share': 'unconfirmed'}, 'coverage': coverage,
                        'persistence': self._persistence()}
            if self.clock() - self._last_load >= 2:
                self._load()
            code = identity.code
            record = self._records.setdefault(code, {'company': {key: company.get(key) for key in
                           ('code', 'name', 'symbol', 'provider_symbol')}, 'status': 'pending', 'invalidated': False})
            if match_identity(record['company'], self.identities) != identity:
                record = self._records[code] = {'company': {key: company.get(key) for key in
                           ('code', 'name', 'symbol', 'provider_symbol')}, 'status': 'identity_unconfirmed', 'invalidated': True}
            fact = record.get('fact')
            needs_work = (coverage['missing_days'] or coverage['stale_days']
                          or not fact or self.clock() - fact['fetched_at'] >= 7 * 86400
                          or self._needs_fact_hash(fact))
            if (needs_work and code not in self._jobs and not self._closed and len(self._jobs) < MAX_QUEUE
                    and self.clock() >= record.get('warm_resume_after', 0)):
                self._jobs[code] = {'company': deepcopy(record['company']), 'started_at': self.clock(),
                                   'started_mono': self.monotonic(), 'operations': 0,
                                   'fresh_after': self.clock() - 86400, 'visited': set()}
                record['warm_progress'] = {'started_at': self.clock(), 'operations': 0,
                                           'from': coverage['from'], 'to': coverage['to'], 'status': 'pending'}
                if not self._worker or not self._worker.is_alive():
                    self._worker = threading.Thread(target=self._run, name='regional-edinet', daemon=True)
                    self._worker.start()
                self._condition.notify_all()
            invalidated = record.get('invalidated') is True
            fact = None if invalidated else record.get('fact')
            status = record.get('status', 'pending')
            if fact and status not in INVALIDATED:
                field_status = 'available'
            elif status in ('fetch_error', 'rate_limited', 'invalid_source'):
                field_status = 'fetch_error'
            elif status == 'source_missing':
                field_status = 'source_missing'
            else:
                field_status = 'loading' if code in self._jobs and not invalidated else 'unconfirmed'
            coverage = self._coverage()
            coverage['selection_status'] = status
            result = {'configured': True, 'status': status, 'refreshing': code in self._jobs,
                      'invalidated': invalidated, 'data': {'historical_dividend_per_share': fact['value']} if fact else {},
                      'dividend_fact': deepcopy(fact), 'field_status': {'historical_dividend_per_share': field_status},
                      'coverage': coverage, 'retry_after_seconds': self.provider.retry_after_seconds(),
                      'persistence_complete': not self._persistence_failed,
                      'warm_progress': deepcopy(record.get('warm_progress')),
                      'durable_checkpoint_status': self._checkpoint_status,
                      'persistence': self._persistence(code, fact)}
            return result

    def _selection(self, record, *, evidence=None):
        identity = match_identity(record['company'], self.identities)
        selection = select_annual_filing(self._snapshots.values() if evidence is None else evidence,
                                        identity, self.clock())
        fact = record.get('fact')
        if fact:
            doc_ids = {fact['doc_id'], fact.get('base_doc_id')}
            for snapshot in self._snapshots.values():
                if doc_ids & set(snapshot.get('removed_doc_ids', ())):
                    return {'status': 'filing_invalidated', 'invalidated': True}
                for row in snapshot['rows']:
                    if (row['docID'] in doc_ids and (not _issuer_valid(row, identity)
                            or row.get('withdrawalStatus') in ('1', '2') or row.get('legalStatus') == '0'
                            or row.get('docInfoEditStatus') == '2' or row.get('disclosureStatus') == '2')
                            or row.get('withdrawalStatus') == '1' and row.get('parentDocID') in doc_ids):
                        return {'status': 'filing_invalidated', 'invalidated': True}
        return selection

    def _needs_fact_hash(self, fact):
        return bool(fact and not fact.get('xbrl_body_sha256') and self.checkpoint_store is not None
                    and callable(getattr(type(self.checkpoint_store), 'save_fact', None)))

    def _action(self, code, job):
        record = self._records[code]
        selection = self._selection(record)
        if selection.get('invalidated'):
            record.update(status=selection['status'], invalidated=True)
            record.pop('fact', None)
        days = self._days()
        # Observe today's edits/withdrawals before using a historical discovery
        # hint. The original metadata and XBRL checks still supply every amount.
        today = days[0]
        snapshot = self._snapshots.get(today)
        restore_pending = (code not in self._journal_restore_done and not record.get('fact')
                           and self.checkpoint_store is not None
                           and callable(getattr(type(self.checkpoint_store), 'load_facts', None)))
        today_threshold = job['started_at'] if restore_pending else job['started_at'] - 3600
        if (today not in job['visited'] and
                (not snapshot or snapshot['fetched_at'] < today_threshold)):
            return ('day', today)
        if restore_pending:
            for day in self._journal_pending_dates.get(code, ()):
                snapshot = self._snapshots.get(day)
                if day in days and day not in job['visited'] and (not snapshot or snapshot['fetched_at'] < job['started_at']):
                    return ('day', day)
        # A partial legacy checkpoint can retain a valid numeric record while
        # losing its source-day rows. Do not let that amount skip the discovery
        # hint and force a full 400-day scan before its XML hash can be upgraded.
        # Refresh only the known actual submitted dates, then select from the
        # current metadata as usual; the old descriptor never bypasses it.
        fact = record.get('fact')
        legacy_descriptor = record.get('descriptor')
        if self._needs_fact_hash(fact) and _descriptor_valid(
                legacy_descriptor, match_identity(record['company'], self.identities),
                datetime.fromtimestamp(self.clock(), JST)):
            rows = ([legacy_descriptor['_annual_base'], *legacy_descriptor['_correction_chain']]
                    if legacy_descriptor.get('_annual_base') else [legacy_descriptor])
            for day in sorted({row['submitDateTime'][:10] for row in rows}, reverse=True):
                snapshot = self._snapshots.get(day)
                if day in days and day not in job['visited'] and (not snapshot or snapshot['fetched_at'] < job['started_at']):
                    return ('day', day)
        hint = self.filing_hints.get(code)
        if hint and (not fact or fact['fiscal_period']['end'] < hint['fiscal_period']['end']):
            day = hint['submitted_date']
            snapshot = self._snapshots.get(day)
            if (day in days and day not in job['visited'] and
                    (not snapshot or snapshot['fetched_at'] < job['started_at'] - 86400)):
                return ('day', day)
        descriptor = selection.get('descriptor')
        if descriptor:
            fact = record.get('fact')
            attempted = record.get('attempted_doc_id') == descriptor['docID'] and self.clock() - record.get('last_attempt_at', 0) < 3600
            needs_hash = self._needs_fact_hash(fact)
            if needs_hash and record.get('status') not in {'fetch_error', 'invalid_source', 'rate_limited',
                                                         'provider_waiting', 'source_missing'}:
                attempted = False  # Upgrade a successful legacy observation once, within the same budgets.
            if ((not fact or fact['doc_id'] != descriptor['docID'] or self.clock() - fact['fetched_at'] >= 7 * 86400 or needs_hash)
                    and not attempted):
                return ('filing', descriptor)
        for day in days:
            snapshot = self._snapshots.get(day)
            threshold = job['started_at'] - (3600 if day == today else 86400)
            if day not in job['visited'] and (not snapshot or snapshot['fetched_at'] < threshold):
                return ('day', day)
        if not record.get('fact') and not record.get('invalidated'):
            if self._coverage()['complete']:
                record['status'] = 'source_missing'
            elif record.get('status') not in ('fetch_error', 'invalid_source', 'rate_limited', 'warm_budget_exhausted'):
                record['status'] = 'pending'
        return None

    def _perform(self, code, action):
        kind, value = action
        company = deepcopy(self._records[code]['company'])
        try:
            result = self.provider.fetch_day(value) if kind == 'day' else self.provider.fetch(company, value)
        except Exception:
            result = {'status': 'fetch_error'}
        with self._condition:
            record = self._records[code]
            status = result.get('status', 'fetch_error')
            if kind == 'day' and status == 'indexed':
                snapshot = result.get('snapshot')
                # Validate injected providers / restored payloads through the same parser.
                try:
                    envelope = {'metadata': {'status': '200', 'parameter': {'date': value, 'type': '2'},
                                'resultset': {'count': len(snapshot['rows'])}, 'processDateTime': snapshot['process_at']},
                                'results': snapshot['rows']}
                    cleaned = parse_daily_filings(envelope, value, snapshot['fetched_at'])
                    known_codes = {identity.edinet_code for identity in self.identities}
                    cleaned['rows'] = [row for row in cleaned['rows'] if row.get('edinetCode') in known_codes
                                       or row.get('withdrawalStatus') in ('1', '2') or row.get('legalStatus') == '0'
                                       or row.get('docInfoEditStatus') == '2' or row.get('disclosureStatus') == '2']
                    previous = self._snapshots.get(value)
                    if not previous or cleaned['process_at'] >= previous['process_at']:
                        removed = set(previous.get('removed_doc_ids', ())) if previous else set()
                        if previous:
                            removed.update({row['docID'] for row in previous['rows']} - {row['docID'] for row in cleaned['rows']})
                        if removed:
                            cleaned['removed_doc_ids'] = sorted(removed)
                        self._snapshots[value] = cleaned
                    self._jobs[code]['visited'].add(value)
                    # Recheck every requested company immediately after revocation metadata arrives.
                    for current in self._records.values():
                        selection = self._selection(current)
                        if selection.get('invalidated'):
                            current.update(status=selection['status'], invalidated=True)
                            current.pop('fact', None)
                except (ValueError, TypeError, KeyError, OverflowError):
                    record['status'] = 'invalid_source'
                    self._jobs[code]['visited'].add(value)
            elif kind == 'filing':
                record.update(last_attempt_at=self.clock(), attempted_doc_id=value['docID'])
                if status == 'available':
                    candidate = {**record, 'fact': result.get('dividend_fact'), 'descriptor': value,
                                 'status': 'available', 'invalidated': False}
                    cleaned = self._clean_record(code, candidate)
                    if cleaned and cleaned.get('fact'):
                        self._records[code] = cleaned
                    else:
                        record['status'] = 'invalid_source'
                elif status in ('correction_unconfirmed', 'filing_unconfirmed', 'identity_unconfirmed'):
                    record.update(status='correction_unconfirmed' if value['docTypeCode'] == '130' else 'filing_invalidated', invalidated=True)
                    record.pop('fact', None)
                else:
                    record['status'] = status if status in {'source_missing', 'fetch_error', 'rate_limited', 'provider_waiting', 'invalid_source'} else 'fetch_error'
            else:
                record['status'] = status if status in {'fetch_error', 'rate_limited', 'provider_waiting', 'invalid_source'} else 'fetch_error'
                # A failed date remains a hole. Move on for this bounded job; a later request resumes it.
                if status not in ('provider_waiting', 'rate_limited'):
                    self._jobs[code]['visited'].add(value)
            if code in self._jobs:
                self._jobs[code]['operations'] += 1
                current = self._records[code]
                current.setdefault('warm_progress', {}).update(operations=self._jobs[code]['operations'],
                                                  last_date=value if kind == 'day' else None)
                current['updated_at'] = self.clock()
                self._jobs.move_to_end(code)
        self._save()

    def _run(self):
        guard = None
        try:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            guard = open(str(self.cache_path) + '.warm.lock', 'a')
            while True:
                with self._condition:
                    if self._closed or not self._jobs:
                        return
                    if all(self.monotonic() - job['started_mono'] >= self.max_warm_seconds for job in self._jobs.values()):
                        for code in self._jobs:
                            self._records[code]['status'] = 'warm_budget_exhausted'
                        self._jobs.clear()
                        self._condition.notify_all()
                        return
                try:
                    fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    self._restore_checkpoint()
                    if self.configured and hasattr(self.provider, 'restore_cooldown'):
                        if not self.provider.restore_cooldown(self._restored_next_request):
                            raise ValueError('gate_unavailable')
                    break
                except BlockingIOError:
                    with self._condition:
                        self._load()
                        self._condition.wait(timeout=60)
            while True:
                self._restore_checkpoint()
                if self.configured and hasattr(self.provider, 'restore_cooldown'):
                    if not self.provider.restore_cooldown(self._restored_next_request):
                        raise ValueError('gate_unavailable')
                with self._condition:
                    if self._closed or not self._jobs:
                        return
                    code = next(iter(self._jobs))
                    job = self._jobs[code]
                self._restore_selected_fact(code, job)
                with self._condition:
                    if (self.monotonic() - job['started_mono'] >= self.max_warm_seconds
                            or job['operations'] >= self.max_warm_operations):
                        self._records[code]['status'] = 'warm_budget_exhausted'
                        action = None
                    else:
                        action = self._action(code, job)
                if action is None:
                    with self._condition:
                        record = self._records[code]
                        record['warm_finished_at'] = self.clock()
                        record['warm_resume_after'] = self.clock() + 3600
                        record.setdefault('warm_progress', {})['status'] = 'complete' if self._coverage()['complete'] else 'interrupted'
                    self._save()
                    with self._condition:
                        self._jobs.pop(code, None)  # completion only after persistence has finished
                        self._condition.notify_all()
                    continue
                delay = self.provider.retry_after_seconds()
                if delay > 0:
                    with self._condition:
                        self._condition.wait(timeout=min(60, delay))
                    continue
                self._perform(code, action)
        except (OSError, ValueError, TypeError):
            with self._condition:
                for code in self._jobs:
                    self._records[code]['status'] = 'fetch_error'
                self._jobs.clear()
                self._condition.notify_all()
        finally:
            if guard:
                guard.close()
            with self._condition:
                if self._closed:
                    self._jobs.clear()
                # A get can enqueue after the worker decides to exit but before
                # is_alive becomes false. Hand off that queue under this lock.
                if self._worker is threading.current_thread():
                    self._worker = None
                    if self._jobs and not self._closed:
                        self._worker = threading.Thread(target=self._run, name='regional-edinet', daemon=True)
                        self._worker.start()
                self._condition.notify_all()

    def wait_idle(self, timeout=5):
        """Deterministic fixture / graceful shutdown helper; no network triggers."""
        end = time.monotonic() + timeout
        with self._condition:
            while self._jobs:
                remaining = end - time.monotonic()
                if remaining <= 0:
                    return False
                self._condition.wait(remaining)
        if self._worker:
            self._worker.join(max(0, end - time.monotonic()))
        return not self._worker or not self._worker.is_alive()

    def close(self):
        with self._condition:
            self._closed = True
            self._condition.notify_all()
        if self._worker and self._worker is not threading.current_thread():
            self._worker.join(10)

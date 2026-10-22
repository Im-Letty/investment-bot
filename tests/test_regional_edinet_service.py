"""No-key and authenticated fixture tests; never contact EDINET."""
from copy import deepcopy
from datetime import datetime, timedelta
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock

from regional_edinet import (EdinetAnnualDividends, JST, parse_daily_filings,
                            select_annual_filing, load_identity_seed)
from regional_edinet_service import RegionalEdinetDividends
from tests.test_regional_edinet import (NOW, IDENTITY, COMPANY, DESCRIPTOR, Response, zipped)


def descriptor(**updates):
    return {**DESCRIPTOR, 'opeDateTime': DESCRIPTOR['submitDateTime'], 'parentDocID': None, **updates}


def envelope(day='2026-10-11', rows=(), **updates):
    metadata = {'status': '200', 'parameter': {'date': day, 'type': '2'},
                'resultset': {'count': len(rows)}, 'processDateTime': '2026-10-11 21:00'}
    metadata.update(updates)
    return {'metadata': metadata, 'results': list(rows)}


def snapshot(day, rows=()):
    return parse_daily_filings(envelope(day, rows), day, NOW)


def correction(**updates):
    return descriptor(**{'docID': 'S100CORR', 'docTypeCode': '130', 'submitDateTime': '2026-07-01 09:00',
                      'opeDateTime': '2026-07-01 09:00', 'parentDocID': DESCRIPTOR['docID'], **updates})


class ListSelectionTests(unittest.TestCase):
    def select(self, rows):
        return select_annual_filing([snapshot('2026-10-11', rows)], IDENTITY, NOW)

    def test_envelope_status_count_dates_and_times_are_required(self):
        bad = [envelope(status='500'), envelope(resultset={'count': 1}),
               envelope(parameter={'date': '2026-10-10', 'type': '2'}),
               envelope(processDateTime='2026-10-11 21:00:00'),
               envelope(processDateTime='2026-10-11 23:00')]
        for payload in bad:
            with self.assertRaises(ValueError):
                parse_daily_filings(payload, '2026-10-11', NOW)

    def test_only_fixed_identity_metadata_saved_not_descriptions(self):
        row = descriptor(docDescription='private prose', api_key='secret')
        parsed = snapshot('2026-10-11', [row])
        self.assertNotIn('private', json.dumps(parsed))
        self.assertNotIn('secret', json.dumps(parsed))
        self.assertEqual(self.select([row])['descriptor']['docID'], 'S100TEST')

    def test_same_doc_id_events_use_operation_time_and_ambiguity_fails_closed(self):
        old = descriptor()
        new = descriptor(opeDateTime='2026-07-01 09:00', docInfoEditStatus='1')
        self.assertEqual(snapshot('2026-10-11', [old, new])['rows'][0]['docInfoEditStatus'], '1')
        with self.assertRaises(ValueError):
            snapshot('2026-10-11', [old, descriptor(disclosureStatus='1')])

    def test_latest_fiscal_period_selected_before_late_old_correction(self):
        old = descriptor(docID='S100OLD1', periodStart='2024-04-01', periodEnd='2025-03-31',
                         submitDateTime='2025-06-26 09:00', opeDateTime='2025-06-26 09:00')
        changed = correction(parentDocID=old['docID'], periodStart=old['periodStart'], periodEnd=old['periodEnd'],
                             submitDateTime='2026-08-01 09:00', opeDateTime='2026-08-01 09:00')
        selected = self.select([descriptor(), old, changed])
        self.assertEqual(selected['descriptor']['docID'], 'S100TEST')
        self.assertEqual(selected['correction_count'], 0)

    def test_explicit_correction_chain_is_selected_but_unlinked_or_branch_is_not(self):
        selected = self.select([descriptor(), correction()])
        self.assertEqual(selected['descriptor']['docID'], 'S100CORR')
        self.assertEqual(selected['descriptor']['periodEnd'], '2026-03-31')
        self.assertEqual(selected['correction_count'], 1)
        for rows in [[descriptor(), correction(parentDocID=None)],
                     [descriptor(), correction(parentDocID='S100MISS')],
                     [descriptor(), correction(), correction(docID='S100COR2')]]:
            result = self.select(rows)
            self.assertTrue(result['invalidated'])
            self.assertEqual(result['status'], 'correction_unconfirmed')

    def test_withdrawal_notice_null_fields_invalidates_parent_immediately(self):
        notice = {key: None for key in descriptor()}
        notice.update(docID='S100WITH', parentDocID='S100TEST', withdrawalStatus='1')
        self.assertTrue(self.select([descriptor(), notice])['invalidated'])
        for key, value in [('legalStatus', '0'), ('docInfoEditStatus', '2'),
                           ('disclosureStatus', '2'), ('withdrawalStatus', '2')]:
            self.assertTrue(self.select([descriptor(**{key: value})])['invalidated'])

    def test_newer_snapshot_revocation_not_revived_by_older_snapshot(self):
        old = snapshot('2026-06-26', [descriptor()])
        old['process_at'] = '2026-10-11 20:00'
        revoked = snapshot('2026-10-11', [descriptor(legalStatus='0')])
        result = select_annual_filing([revoked, old], IDENTITY, NOW)
        self.assertTrue(result['invalidated'])

    def test_nullable_correction_period_must_still_match_xbrl_parent_year(self):
        selected = self.select([descriptor(), correction(periodStart=None, periodEnd=None)])
        provider = EdinetAnnualDividends('fixture', identities=(IDENTITY,), clock=lambda: NOW)
        provider._request = Mock(return_value={'status': 'downloaded', 'payload': zipped()})
        fact = provider.fetch(COMPANY, selected['descriptor'])
        self.assertEqual(fact['dividend_fact']['doc_type_code'], '130')
        self.assertEqual(fact['dividend_fact']['base_doc_id'], 'S100TEST')
        provider._request.return_value = {'status': 'downloaded', 'payload': zipped(b'<partial/>')}
        self.assertEqual(provider.fetch(COMPANY, selected['descriptor'])['status'], 'correction_unconfirmed')

    def test_shared_gate_metadata_and_document_use_one_minute_and_full_retry_after(self):
        with tempfile.TemporaryDirectory() as folder:
            now = [NOW]
            session = Mock()
            session.__enter__ = Mock(return_value=session)
            session.__exit__ = Mock(return_value=False)
            session.get.return_value = Response(json.dumps(envelope()).encode(), content_type='application/json')
            factory = Mock(return_value=session)
            a = EdinetAnnualDividends('fixture', identities=(IDENTITY,), clock=lambda: now[0],
                                     session_factory=factory, cooldown_path=Path(folder) / 'gate.json')
            b = EdinetAnnualDividends('fixture', identities=(IDENTITY,), clock=lambda: now[0],
                                     session_factory=factory, cooldown_path=Path(folder) / 'gate.json')
            self.assertEqual(a.fetch_day('2026-10-11')['status'], 'indexed')
            self.assertEqual(session.get.call_args.args[0], 'https://api.edinet-fsa.go.jp/api/v2/documents.json')
            self.assertEqual(b.fetch(COMPANY, DESCRIPTOR)['status'], 'provider_waiting')
            now[0] += 60
            session.get.return_value = Response(b'', status=429, headers={'Retry-After': '1000'})
            self.assertEqual(b.fetch(COMPANY, DESCRIPTOR)['status'], 'rate_limited')
            now[0] += 999
            self.assertEqual(a.fetch_day('2026-10-11')['status'], 'provider_waiting')
            self.assertEqual(a.retry_after_seconds(), 1)
            self.assertNotIn('fixture', Path(folder, 'gate.json').read_text())

    def test_http_and_json_503_honor_server_retry_after_minimum(self):
        for status in (503, 200):
            now = [NOW]
            session = Mock()
            session.__enter__ = Mock(return_value=session)
            session.__exit__ = Mock(return_value=False)
            session.get.return_value = Response(b'{"metadata":{"status":"503"}}', status=status,
                    content_type='application/json', headers={'Retry-After': '3600'})
            provider = EdinetAnnualDividends('fixture', identities=(IDENTITY,), clock=lambda: now[0],
                                             session_factory=Mock(return_value=session))
            self.assertEqual(provider.fetch_day('2026-10-11')['status'], 'fetch_error')
            self.assertEqual(provider.retry_after_seconds(), 3600)
            now[0] += 60
            self.assertEqual(provider.fetch(COMPANY, DESCRIPTOR)['status'], 'provider_waiting')
            self.assertEqual(provider.retry_after_seconds(), 3540)

    def test_same_year_duplicate_base_does_not_fallback_after_newer_withdrawal(self):
        changed = descriptor(docID='S100NEW1', submitDateTime='2026-07-01 09:00',
                             opeDateTime='2026-07-01 09:00', withdrawalStatus='2')
        self.assertTrue(self.select([descriptor(), changed])['invalidated'])

    def test_deployment_seed_is_public_bounded_and_strictly_dated(self):
        rows = load_identity_seed(observed_at=NOW + 86400)
        self.assertEqual(len(rows), 110)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'seed.json'
            path.write_text('{"version":1,"source_url":"evil","identities":[]}')
            self.assertEqual(load_identity_seed(path, observed_at=NOW), ())

    def test_all_regional_identities_match_the_bundled_catalogue_without_provider_aliases(self):
        from stock_search import StockSearch
        from regional_edinet import match_identity
        with tempfile.TemporaryDirectory() as folder:
            catalogue = StockSearch(runtime_path=Path(folder) / 'catalogue.json',
                                    national_runtime_path=Path(folder) / 'national.json')
            identities = load_identity_seed(observed_at=NOW + 86400)
            self.assertEqual(len(identities), 110)
            for identity in identities:
                company = catalogue.company(identity.code)
                self.assertIsNotNone(company)
                self.assertEqual(match_identity(company, identities), identity)
                self.assertIsNone(company['provider_symbol'])


class FixtureProvider:
    configured = True
    def __init__(self, rows=None, fail_day=None, fact_status='available'):
        self.calls, self.rows = [], rows or {}
        self.fail_day, self.fact_status = fail_day, fact_status
    def retry_after_seconds(self): return 0
    def fetch_day(self, day):
        self.calls.append(('day', day))
        if day == self.fail_day: return {'status': 'fetch_error'}
        return {'status': 'indexed', 'snapshot': snapshot(day, self.rows.get(day, []))}
    def fetch(self, company, selected):
        self.calls.append(('filing', selected['docID']))
        if self.fact_status != 'available': return {'status': self.fact_status}
        from regional_edinet import parse_annual_zip
        fact = parse_annual_zip(zipped(), IDENTITY, selected, NOW)
        return {'status': 'available', 'dividend_fact': fact}


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.path = Path(self.folder.name) / 'cache.json'
        self.services = []
    def tearDown(self):
        for service in self.services: service.close()
        self.folder.cleanup()
    def service(self, provider=None, **kwargs):
        service = RegionalEdinetDividends(self.path, identities=(IDENTITY,), provider=provider,
                    clock=lambda: NOW, window_days=3, **kwargs)
        self.services.append(service)
        return service
    def test_constructor_and_keyless_get_never_start_worker_or_session(self):
        service = self.service()
        self.assertIsNone(service._worker)
        self.assertEqual(service.get(COMPANY)['status'], 'not_configured')
        self.assertIsNone(service._worker)
        self.assertFalse(self.path.exists())
    def test_selected_company_auto_progresses_newest_to_oldest_once_without_reopening(self):
        provider = FixtureProvider({'2026-10-10': [descriptor()]})
        service = self.service(provider)
        service.get(COMPANY)
        self.assertTrue(service.wait_idle())
        self.assertEqual(provider.calls, [('day', '2026-10-11'), ('day', '2026-10-10'),
                         ('filing', 'S100TEST'), ('day', '2026-10-09')])
        result = service.get(COMPANY)
        self.assertEqual(result['data'], {'historical_dividend_per_share': 20})
        self.assertTrue(result['coverage']['complete'])
        self.assertFalse(result['coverage']['latest_filing_guaranteed'])
        self.assertEqual(result['coverage']['indexed_days'] + result['coverage']['missing_days'], 3)
        self.assertEqual(result['dividend_fact']['fetched_at'], NOW)
        self.assertEqual(result['warm_progress']['operations'], 4)
    def test_missing_date_not_zero_or_complete_and_poll_does_not_restart(self):
        provider = FixtureProvider(fail_day='2026-10-10')
        service = self.service(provider)
        service.get(COMPANY)
        self.assertTrue(service.wait_idle())
        calls = len(provider.calls)
        result = service.get(COMPANY)
        self.assertEqual(result['data'], {})
        self.assertFalse(result['coverage']['complete'])
        self.assertEqual(result['coverage']['missing_days'], 1)
        self.assertEqual(result['status'], 'fetch_error')
        self.assertEqual(result['field_status']['historical_dividend_per_share'], 'fetch_error')
        self.assertFalse(result['refreshing'])
        self.assertEqual(len(provider.calls), calls)
    def test_bounded_job_resumes_saved_range_without_boot_requests(self):
        first = self.service(FixtureProvider(), max_warm_operations=1)
        first.get(COMPANY)
        self.assertTrue(first.wait_idle())
        first.close()
        second = self.service(FixtureProvider())
        self.assertEqual(second.provider.calls, [])
        self.assertEqual(second._coverage()['indexed_days'], 1)
        # Expiration of the retry interval resumes the remaining dates.
        second._records['6147']['warm_resume_after'] = 0
        second.get(COMPANY)
        self.assertTrue(second.wait_idle())
        self.assertEqual(second.provider.calls, [('day', '2026-10-10'), ('day', '2026-10-09')])
    def test_one_operation_fills_an_old_400_day_hole_before_refreshing_stale_dates(self):
        provider = FixtureProvider()
        service = RegionalEdinetDividends(self.path, identities=(IDENTITY,), provider=provider,
                    clock=lambda: NOW, window_days=400, max_warm_operations=1)
        self.services.append(service)
        service.filing_hints = {}
        days = service._days()
        service._snapshots = {day: snapshot(day) for day in days[:-1]}
        stale_day = days[1]
        service._snapshots[stale_day]['fetched_at'] = NOW - 86401
        before = deepcopy(service._snapshots)
        self.assertEqual(service._coverage()['missing_days'], 1)
        self.assertEqual(service._coverage()['stale_days'], 1)
        service.get(COMPANY); self.assertTrue(service.wait_idle())
        self.assertEqual(provider.calls, [('day', days[-1])])
        result = service.get(COMPANY)
        self.assertEqual(result['coverage']['indexed_days'], 400)
        self.assertEqual(result['coverage']['missing_days'], 0)
        self.assertTrue(result['coverage']['complete'])
        self.assertEqual(result['coverage']['stale_days'], 1)
        self.assertEqual(result['warm_progress']['operations'], 1)
        self.assertEqual(result['warm_progress']['status'], 'complete')
        self.assertEqual(service._snapshots[stale_day], before[stale_day])
        self.assertTrue(all(service._snapshots[day] == row for day, row in before.items()))
        self.assertEqual(result['data'], {})
        self.assertEqual(result['persistence']['local_status'], 'saved')

    def test_missing_dates_keep_newest_to_oldest_order_before_the_stale_pass(self):
        service = self.service(FixtureProvider())
        service.filing_hints = {}
        service._records['6147'] = {'company': COMPANY, 'status': 'pending', 'invalidated': False}
        service._snapshots = {'2026-10-11': snapshot('2026-10-11')}
        job = {'started_at': NOW, 'visited': set()}
        self.assertEqual(service._action('6147', job), ('day', '2026-10-10'))
        job['visited'].add('2026-10-10')
        self.assertEqual(service._action('6147', job), ('day', '2026-10-09'))
        job['visited'].add('2026-10-09')
        self.assertIsNone(service._action('6147', job))

    def test_today_observation_still_precedes_an_older_missing_day(self):
        provider = FixtureProvider()
        service = self.service(provider, max_warm_operations=1)
        service.filing_hints = {}
        service._snapshots = {day: snapshot(day) for day in ('2026-10-11', '2026-10-10')}
        service._snapshots['2026-10-11']['fetched_at'] = NOW - 3601
        service._snapshots['2026-10-10']['fetched_at'] = NOW - 86401
        service.get(COMPANY); self.assertTrue(service.wait_idle())
        self.assertEqual(provider.calls, [('day', '2026-10-11')])
        coverage = service.get(COMPANY)['coverage']
        self.assertEqual(coverage['missing_days'], 1)
        self.assertEqual(coverage['stale_days'], 1)
        self.assertFalse(coverage['complete'])

    def test_exact_filing_hint_still_precedes_an_unrelated_missing_date(self):
        provider = FixtureProvider()
        service = self.service(provider, filing_hint_path=self.filing_hint(), max_warm_operations=1)
        service._snapshots = {day: snapshot(day) for day in ('2026-10-11', '2026-10-09')}
        service._snapshots['2026-10-09']['fetched_at'] = NOW - 86401
        service.get(COMPANY); self.assertTrue(service.wait_idle())
        self.assertEqual(provider.calls, [('day', '2026-10-09')])
        self.assertNotIn('2026-10-10', service._snapshots)
        self.assertEqual(service.get(COMPANY)['coverage']['missing_days'], 1)

    def test_journal_restore_today_and_exact_source_dates_keep_priority_over_general_holes(self):
        class PendingJournalStore:
            def load_facts(self, *args, **kwargs):
                raise AssertionError('This selection-only fixture must not read storage')
        service = self.service(FixtureProvider(), checkpoint_store=PendingJournalStore(),
                               filing_hint_path=self.filing_hint())
        service._records['6147'] = {'company': COMPANY, 'status': 'pending', 'invalidated': False}
        service._journal_pending_dates['6147'] = ['2026-10-10']
        service._snapshots = {day: snapshot(day) for day in ('2026-10-11', '2026-10-10')}
        for row in service._snapshots.values(): row['fetched_at'] = NOW - 1
        job = {'started_at': NOW, 'visited': set()}
        self.assertEqual(service._action('6147', job), ('day', '2026-10-11'))
        job['visited'].add('2026-10-11')
        service._snapshots['2026-10-11']['fetched_at'] = NOW
        self.assertEqual(service._action('6147', job), ('day', '2026-10-10'))
        job['visited'].add('2026-10-10')
        self.assertEqual(service._action('6147', job), ('day', '2026-10-09'))
        self.assertEqual(service.provider.calls, [])

    def test_failed_hole_is_not_repeated_in_the_same_job_and_stale_refresh_can_continue(self):
        provider = FixtureProvider(fail_day='2026-10-09')
        service = self.service(provider, max_warm_operations=3)
        service.filing_hints = {}
        service._snapshots = {day: snapshot(day) for day in ('2026-10-11', '2026-10-10')}
        service._snapshots['2026-10-10']['fetched_at'] = NOW - 86401
        service.get(COMPANY); self.assertTrue(service.wait_idle())
        self.assertEqual(provider.calls, [('day', '2026-10-09'), ('day', '2026-10-10')])
        result = service.get(COMPANY)
        self.assertEqual(result['coverage']['missing_days'], 1)
        self.assertEqual(result['coverage']['stale_days'], 0)
        self.assertEqual(result['warm_progress']['operations'], 2)
        self.assertEqual(result['warm_progress']['status'], 'interrupted')
        self.assertEqual(result['status'], 'fetch_error')
        self.assertNotIn('2026-10-09', service._snapshots)
        self.assertFalse(result['coverage']['complete'])
        self.assertFalse(result['refreshing'])
        self.assertEqual(provider.calls.count(('day', '2026-10-09')), 1)
        self.assertEqual(len(provider.calls), 2, 'ordinary polling keeps the existing resume wait')

    def test_identity_mismatch_is_invalidated_and_never_queued(self):
        provider = FixtureProvider()
        service = self.service(provider)
        result = service.get({**COMPANY, 'name': '別会社'})
        self.assertTrue(result['invalidated'])
        self.assertEqual(result['status'], 'identity_unconfirmed')
        self.assertEqual(provider.calls, [])
    def test_failed_refresh_retains_old_actual_fact_and_original_time(self):
        provider = FixtureProvider({'2026-10-11': [descriptor()]})
        service = self.service(provider)
        service.get(COMPANY); self.assertTrue(service.wait_idle())
        old = deepcopy(service.get(COMPANY)['dividend_fact'])
        provider.rows = {}; provider.fail_day = '2026-10-11'
        with service._condition:
            service._snapshots['2026-10-11']['fetched_at'] -= 7200
            service._records['6147']['warm_resume_after'] = 0
        service.get(COMPANY); self.assertTrue(service.wait_idle())
        result = service.get(COMPANY)
        self.assertEqual(result['dividend_fact'], old)
        self.assertFalse(result['invalidated'])
        self.assertEqual(result['data']['historical_dividend_per_share'], 20)
    def test_known_revocation_or_partial_correction_clears_old_value_not_just_status(self):
        for row in [descriptor(legalStatus='0'), correction(parentDocID=None), correction()]:
            provider = FixtureProvider({'2026-10-11': [descriptor()]})
            service = self.service(provider)
            service.get(COMPANY); self.assertTrue(service.wait_idle())
            self.assertEqual(service.get(COMPANY)['data']['historical_dividend_per_share'], 20)
            provider.rows['2026-10-11'] = [row] if row['docTypeCode'] == '120' else [descriptor(), row]
            provider.fact_status = 'correction_unconfirmed'
            with service._condition:
                service._snapshots['2026-10-11']['fetched_at'] -= 7200
                service._records['6147']['warm_resume_after'] = 0
            service.get(COMPANY); self.assertTrue(service.wait_idle())
            result = service.get(COMPANY)
            self.assertTrue(result['invalidated'])
            self.assertEqual(result['data'], {})
            self.assertIsNone(result['dividend_fact'])
            service.close(); self.path.unlink(missing_ok=True)
    def test_pending_coalesces_and_completion_is_after_atomic_save(self):
        provider = FixtureProvider()
        service = self.service(provider)
        entered, release = threading.Event(), threading.Event()
        original = service._save
        def blocked_save():
            entered.set(); release.wait(3); original()
        service._save = blocked_save
        service.get(COMPANY)
        self.assertTrue(entered.wait(3))
        self.assertTrue(service.get(COMPANY)['refreshing'])
        service.get(COMPANY)
        self.assertEqual(len(service._jobs), 1)
        release.set()
        self.assertTrue(service.wait_idle())
        self.assertTrue(self.path.exists())
        self.assertEqual(len(provider.calls), 3)
    def test_multi_process_warm_lock_prevents_duplicate_progress(self):
        import fcntl
        guard = open(str(self.path) + '.warm.lock', 'a')
        fcntl.flock(guard, fcntl.LOCK_EX)
        provider = FixtureProvider()
        service = self.service(provider)
        waiting = threading.Event()
        original_wait = service._condition.wait
        def observed_wait(timeout=None):
            waiting.set()
            return original_wait(timeout)
        service._condition.wait = observed_wait
        try:
            service.get(COMPANY)
            self.assertTrue(waiting.wait(3))
            self.assertEqual(provider.calls, [])
            self.assertTrue(service.get(COMPANY)['refreshing'])
        finally:
            guard.close()
        with service._condition:
            service._condition.notify_all()
        self.assertTrue(service.wait_idle())
        self.assertEqual(len(provider.calls), 3)

    def test_new_request_after_worker_completion_starts_another_bounded_job(self):
        provider = FixtureProvider()
        service = self.service(provider)
        service.get(COMPANY); self.assertTrue(service.wait_idle())
        self.assertIsNone(service._worker)
        with service._condition:
            service._records['6147']['warm_resume_after'] = 0
            service._snapshots.pop('2026-10-09')
        service.get(COMPANY); self.assertTrue(service.wait_idle())
        self.assertEqual(provider.calls[-1], ('day', '2026-10-09'))
        self.assertIsNone(service._worker)

    def test_checkpoint_restores_after_selection_not_constructor_and_skips_saved_days(self):
        source = self.service(FixtureProvider({'2026-10-10': [descriptor()]}), max_warm_operations=3)
        source.get(COMPANY); self.assertTrue(source.wait_idle())
        cache = json.loads(self.path.read_text())
        source.close(); self.path.unlink()
        store = Mock()
        store.load.return_value = cache
        store.save.return_value = True
        provider = FixtureProvider()
        target = self.service(provider, checkpoint_store=store)
        store.load.assert_not_called()
        target.get(COMPANY); self.assertTrue(target.wait_idle())
        store.load.assert_called_once()
        self.assertEqual(provider.calls, [('day', '2026-10-09')])
        self.assertEqual(target.get(COMPANY)['data']['historical_dividend_per_share'], 20)
        self.assertEqual(target.get(COMPANY)['durable_checkpoint_status'], 'saved')
        self.assertEqual(store.save.call_args.args[0]['version'], 1)
        self.assertIn('next_request', store.save.call_args.args[0])
        persistence = target.get(COMPANY)['persistence']
        self.assertEqual(persistence['restore_status'], 'restored')
        self.assertEqual(persistence['restored_at'], NOW)
        self.assertEqual(persistence['saved_at'], NOW)
        self.assertEqual(persistence['restored_indexed_days'], 2)
        self.assertEqual(persistence['restored_facts'], 1)
        self.assertTrue(persistence['selected_fact_restored'])
        self.assertTrue(persistence['selected_fact_saved'])
        self.assertFalse(persistence['snapshot_guaranteed'])
        self.assertFalse(persistence['cross_instance_cas'])

    def test_restored_fact_observation_does_not_follow_a_changed_amount(self):
        source = self.service(FixtureProvider({'2026-10-10': [descriptor()]}))
        source.get(COMPANY); self.assertTrue(source.wait_idle())
        cache = json.loads(self.path.read_text())
        source.close(); self.path.unlink()
        store = Mock()
        store.load.return_value = cache
        store.save.return_value = True
        target = self.service(FixtureProvider(), checkpoint_store=store)
        target.get(COMPANY); self.assertTrue(target.wait_idle())
        self.assertTrue(target.get(COMPANY)['persistence']['selected_fact_restored'])
        target._records['6147']['fact']['value'] = 21
        changed = target.get(COMPANY)['persistence']
        self.assertFalse(changed['selected_fact_restored'])
        self.assertFalse(changed['selected_fact_saved'])
        target._save()
        self.assertTrue(target.get(COMPANY)['persistence']['selected_fact_saved'])
        self.assertFalse(target.get(COMPANY)['persistence']['selected_fact_restored'])

    def test_checkpoint_with_revoked_fact_never_claims_fact_was_restored(self):
        source = self.service(FixtureProvider({'2026-10-11': [descriptor()]}))
        source.get(COMPANY); self.assertTrue(source.wait_idle())
        cache = json.loads(self.path.read_text())
        source.close(); self.path.unlink()
        cache['snapshots']['2026-10-11']['rows'] = [descriptor(legalStatus='0')]
        store = Mock()
        store.load.return_value = cache
        store.save.return_value = True
        target = self.service(FixtureProvider(), checkpoint_store=store)
        target.get(COMPANY); self.assertTrue(target.wait_idle())
        result = target.get(COMPANY)
        self.assertTrue(result['invalidated'])
        self.assertEqual(result['persistence']['restore_status'], 'restored')
        self.assertEqual(result['persistence']['restored_facts'], 0)
        self.assertFalse(result['persistence']['selected_fact_restored'])
        self.assertFalse(result['persistence']['selected_fact_saved'])

    def filing_hint(self, **updates):
        row = {'code': IDENTITY.code, 'edinet_code': IDENTITY.edinet_code,
               'security_code': IDENTITY.security_code, 'name': IDENTITY.name,
               'corporate_number': IDENTITY.corporate_number, 'identity_as_of': IDENTITY.as_of,
               'submitted_date': '2026-10-09',
               'fiscal_period': {'start': '2025-04-01', 'end': '2026-03-31'},
               'source_url': 'https://www.yamazaki-iron.co.jp/ir/library/pdf/securitiesreport_2026_full.pdf',
               'verified_at': '2026-10-11T21:00:00+09:00', **updates}
        path = Path(self.folder.name) / 'hints.json'
        path.write_text(json.dumps({'version': 1, 'hints': [row]}))
        return path

    def test_exact_filing_hint_discovers_amount_before_whole_range_is_indexed(self):
        row = descriptor(submitDateTime='2026-10-09 09:00', opeDateTime='2026-10-09 09:00')
        provider = FixtureProvider({'2026-10-09': [row]})
        service = self.service(provider, filing_hint_path=self.filing_hint(), max_warm_operations=3)
        service.get(COMPANY); self.assertTrue(service.wait_idle())
        self.assertEqual(provider.calls, [('day', '2026-10-11'), ('day', '2026-10-09'),
                                          ('filing', 'S100TEST')])
        result = service.get(COMPANY)
        self.assertEqual(result['data']['historical_dividend_per_share'], 20)
        self.assertEqual(result['coverage']['missing_days'], 1)
        self.assertFalse(result['dividend_fact']['latest_filing_guaranteed'])

    def test_hint_cannot_provide_amount_when_metadata_has_no_matching_issuer(self):
        provider = FixtureProvider({'2026-10-09': [descriptor(edinetCode='E99999')]})
        service = self.service(provider, filing_hint_path=self.filing_hint())
        service.get(COMPANY); self.assertTrue(service.wait_idle())
        self.assertEqual(provider.calls[:2], [('day', '2026-10-11'), ('day', '2026-10-09')])
        self.assertFalse(any(kind == 'filing' for kind, value in provider.calls))
        self.assertEqual(service.get(COMPANY)['data'], {})

    def test_future_or_wrong_identity_hint_cannot_change_normal_discovery_order(self):
        for updates in ({'submitted_date': '2026-10-12'}, {'edinet_code': 'E99999'},
                        {'identity_as_of': '2026-10-10'}, {'verified_at': '2026-10-12T21:00:00+09:00'}):
            provider = FixtureProvider()
            service = self.service(provider, filing_hint_path=self.filing_hint(**updates))
            service.get(COMPANY); self.assertTrue(service.wait_idle())
            self.assertEqual(provider.calls, [('day', '2026-10-11'), ('day', '2026-10-10'),
                                              ('day', '2026-10-09')])
            service.close()
            self.path.unlink()

    def test_keyless_checkpoint_never_calls_load_or_save(self):
        store = Mock()
        service = self.service(checkpoint_store=store)
        service.get(COMPANY)
        store.load.assert_not_called(); store.save.assert_not_called()

    def test_checkpoint_revocation_invalidates_old_fact_before_it_can_be_returned(self):
        provider = FixtureProvider({'2026-10-11': [descriptor()]})
        source = self.service(provider)
        source.get(COMPANY); self.assertTrue(source.wait_idle())
        cache = json.loads(self.path.read_text())
        cache['snapshots']['2026-10-11']['rows'] = [descriptor(legalStatus='0')]
        # Restored metadata has to invalidate a previously valid numeric record.
        target = self.service(FixtureProvider())
        self.assertTrue(target._merge_cache(cache))
        self.assertEqual(target.get(COMPANY)['data'], {})
        self.assertTrue(target.get(COMPANY)['invalidated'])
        target.close()

    def test_checkpoint_rejects_unknown_fields_and_strips_nested_descriptor_prose(self):
        provider = FixtureProvider({'2026-10-11': [descriptor()]})
        service = self.service(provider)
        service.get(COMPANY); self.assertTrue(service.wait_idle())
        cache = json.loads(self.path.read_text())
        self.assertFalse(service._merge_cache({**cache, 'credential': 'never copy'}))
        record = cache['records']['6147']
        record['descriptor']['docDescription'] = 'never copy'
        clean = service._clean_record('6147', record)
        self.assertNotIn('never copy', json.dumps(clean))
        cache['next_request'] = float('nan')
        self.assertFalse(service._merge_cache(cache))

    def test_failed_checkpoint_load_never_overwrites_unknown_remote_progress(self):
        store = Mock()
        store.load.side_effect = RuntimeError('never expose credential or URL')
        store.save.return_value = True
        service = self.service(FixtureProvider({'2026-10-11': [descriptor()]}), checkpoint_store=store)
        service.get(COMPANY); self.assertTrue(service.wait_idle())
        store.save.assert_not_called()
        self.assertEqual(store.load.call_count, 1)
        self.assertEqual(service.get(COMPANY)['durable_checkpoint_status'], 'load_failed')
        self.assertEqual(service.get(COMPANY)['data']['historical_dividend_per_share'], 20)
        persistence = service.get(COMPANY)['persistence']
        self.assertEqual(persistence['local_status'], 'saved')
        self.assertEqual(persistence['restore_status'], 'load_failed')
        self.assertIsNone(persistence['saved_at'])
        self.assertFalse(persistence['selected_fact_saved'])
        # A later background attempt can resume saves only after verified load/missing.
        store.load.side_effect = None
        store.load.return_value = None
        service.clock = lambda: NOW + 59
        service._restore_checkpoint()
        self.assertEqual(store.load.call_count, 1)
        service.clock = lambda: NOW + 60
        service._restore_checkpoint()
        service._save()
        self.assertEqual(store.load.call_count, 2)
        store.save.assert_called_once()

    def test_invalid_checkpoint_load_never_overwrites_existing_object(self):
        store = Mock()
        store.load.return_value = {'version': 1, 'credential': 'never copy'}
        store.save.return_value = True
        service = self.service(FixtureProvider(), checkpoint_store=store)
        service.get(COMPANY); self.assertTrue(service.wait_idle())
        store.save.assert_not_called()
        self.assertEqual(service.get(COMPANY)['durable_checkpoint_status'], 'invalid')

    def test_checkpoint_failure_does_not_erase_fact_or_restart_rapidly(self):
        store = Mock()
        store.load.return_value = None
        store.save.return_value = False
        service = self.service(FixtureProvider({'2026-10-11': [descriptor()]}), checkpoint_store=store)
        service.get(COMPANY); self.assertTrue(service.wait_idle())
        result = service.get(COMPANY)
        self.assertEqual(result['data']['historical_dividend_per_share'], 20)
        self.assertEqual(result['durable_checkpoint_status'], 'save_failed')
        self.assertEqual(store.save.call_count, 1)
        self.assertEqual(result['persistence']['restore_status'], 'missing')
        self.assertIsNone(result['persistence']['restored_at'])
        self.assertIsNone(result['persistence']['saved_at'])
        self.assertFalse(result['persistence']['selected_fact_saved'])

    def test_cache_is_whitelisted_no_raw_prose_or_credentials_and_fork_does_not_boot(self):
        provider = FixtureProvider({'2026-10-11': [descriptor(docDescription='secret prose')]})
        service = self.service(provider)
        service.get(COMPANY); self.assertTrue(service.wait_idle())
        raw = self.path.read_text()
        self.assertNotIn('secret prose', raw)
        self.assertNotIn('Subscription-Key', raw)
        previous = service._condition
        service._reset_process()
        self.assertIsNot(previous, service._condition)
        self.assertIsNone(service._worker)
        self.assertEqual(service.get(COMPANY)['data']['historical_dividend_per_share'], 20)


if __name__ == '__main__': unittest.main()

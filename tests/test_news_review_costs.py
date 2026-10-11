"""Offline receipts/cost estimates: fake storage, no providers or real network."""
from copy import deepcopy
from datetime import datetime
from decimal import Decimal
import json
from threading import Barrier, Lock, Thread
import unittest
from unittest.mock import patch

from news_review_costs import (JST, PREFIX, ReviewUsageRecorder,
                               collect_daily_cost, estimate_cost)


def at(day="2026-10-11", hour=12, minute=0, second=0):
    return datetime.fromisoformat(day).replace(hour=hour, minute=minute,
        second=second, tzinfo=JST).timestamp()


def identifier(number):
    return format(number, '032x')


def gemini_usage(input_=1000, output=100, *, cached=0):
    return {'promptTokenCount': input_, 'totalTokenCount': input_ + output,
            'candidatesTokenCount': output, 'thoughtsTokenCount': 0,
            'cachedContentTokenCount': cached}


def openai_usage(input_=1000, output=100, *, cached=0, written=0, reasoning=0):
    return {'input_tokens': input_, 'output_tokens': output,
            'total_tokens': input_ + output,
            'input_tokens_details': {'cached_tokens': cached, 'cache_write_tokens': written},
            'output_tokens_details': {'reasoning_tokens': reasoning}}


class MemoryStorage:
    def __init__(self):
        self.values, self.operations = {}, []
        self.fail_create = self.fail_read = self.fail_list = False
        self.lock = Lock()

    def create(self, path, value, *, deadline=None):
        with self.lock:
            self.operations.append(('create', path, deadline))
            if self.fail_create:
                raise RuntimeError('private storage error fixture')
            if path in self.values:
                return False
            self.values[path] = deepcopy(value)
            return True

    def read(self, path, *, deadline=None):
        with self.lock:
            self.operations.append(('read', path, deadline))
            if self.fail_read:
                raise RuntimeError('private storage error fixture')
            return deepcopy(self.values.get(path))

    def _list(self, prefix, *, offset=0, deadline=None):
        with self.lock:
            self.operations.append(('list', offset, deadline))
            if self.fail_list:
                raise RuntimeError('private storage error fixture')
            names = sorted((key[len(prefix) + 1:] for key in self.values
                            if key.startswith(prefix + '/')), reverse=True)
            return [{'name': name} for name in names[offset:offset + 30]]


class OfflineCase(unittest.TestCase):
    def setUp(self):
        self.now = at()
        self.storage = MemoryStorage()
        network = patch('socket.socket.connect', side_effect=AssertionError('network disabled'))
        network.start()
        self.addCleanup(network.stop)

    def recorder(self, scope='economy'):
        return ReviewUsageRecorder(self.storage, scope=scope, clock=lambda: self.now)

    def record(self, recorder, number=1, *, provider='gemini', model=None, usage=None):
        model = model or ('gemini-2.5-flash' if provider == 'gemini' else 'gpt-6-luna')
        usage = gemini_usage() if usage is None else usage
        recorder.start_request(provider=provider, model=model, request_id=identifier(number))
        recorder.record_request(provider=provider, model=model, request_id=identifier(number), usage=usage)


class EstimateTests(OfflineCase):
    def test_gemini_thinking_is_charged_once_in_total_minus_prompt(self):
        result = estimate_cost('gemini', 'gemini-2.5-flash', {
            'promptTokenCount': 1000, 'totalTokenCount': 1150,
            'candidatesTokenCount': 100, 'thoughtsTokenCount': 50})
        self.assertEqual(result['usd_nanos'], 1000 * 300 + 150 * 2500)

    def test_gemini_cache_is_a_partition_of_input(self):
        result = estimate_cost('gemini', 'gemini-2.5-flash', gemini_usage(cached=400))
        self.assertEqual(result['usd_nanos'], 600 * 300 + 400 * 30 + 100 * 2500)

    def test_gemini_total_can_account_for_output_without_optional_breakdown(self):
        result = estimate_cost('gemini', 'gemini-2.5-flash',
            {'promptTokenCount': 1000, 'totalTokenCount': 1100})
        self.assertEqual(result['usd_nanos'], 550000)

    def test_gemini_inconsistent_output_cache_or_tool_tokens_are_unknown(self):
        changes = [{'thoughtsTokenCount': 1}, {'cachedContentTokenCount': 1001},
                   {'totalTokenCount': 999}, {'toolUsePromptTokenCount': 1}]
        for change in changes:
            with self.subTest(change=change):
                self.assertIsNone(estimate_cost('gemini', 'gemini-2.5-flash',
                    {**gemini_usage(), **change})['usd_nanos'])

    def test_gemini_invalid_token_values_never_become_zero(self):
        for value in (True, -1, 1.5, '1000', None, 100000001):
            with self.subTest(value=value):
                result = estimate_cost('gemini', 'gemini-2.5-flash',
                    {**gemini_usage(), 'promptTokenCount': value})
                self.assertIsNone(result['usd_nanos'])

    def test_openai_reasoning_is_already_part_of_output(self):
        result = estimate_cost('openai', 'gpt-6-luna', openai_usage(reasoning=75))
        self.assertEqual(result['usd_nanos'], 1000 * 100 + 100 * 500)

    def test_openai_ordinary_read_and_write_cache_partitions(self):
        result = estimate_cost('openai', 'gpt-6-luna',
            openai_usage(cached=200, written=300))
        self.assertEqual(result['usd_nanos'], 500 * 100 + 200 * 10 + 300 * 125 + 100 * 500)
        self.assertEqual(result['basis'], 'standard_text')

    def test_openai_missing_cache_write_breakdown_is_conservative(self):
        usage = openai_usage(cached=200)
        del usage['input_tokens_details']['cache_write_tokens']
        result = estimate_cost('openai', 'gpt-6-luna', usage)
        self.assertEqual(result['usd_nanos'], 200 * 10 + 800 * 125 + 100 * 500)
        self.assertEqual(result['basis'], 'conservative_cache_write')

    def test_openai_long_context_boundary_and_cache_rates(self):
        for input_, rates in [(272000, (100, 10, 125, 500)),
                              (272001, (200, 20, 250, 750))]:
            with self.subTest(input_=input_):
                result = estimate_cost('openai', 'gpt-6-luna',
                    openai_usage(input_, cached=200, written=300))
                ordinary, read, write, output = rates
                self.assertEqual(result['usd_nanos'],
                    (input_ - 500) * ordinary + 200 * read + 300 * write + 100 * output)

    def test_openai_inconsistent_usage_or_breakdowns_are_unknown(self):
        values = [None, {}, {**openai_usage(), 'total_tokens': 999},
            {**openai_usage(), 'input_tokens_details': []},
            openai_usage(cached=600, written=500), openai_usage(reasoning=101),
            openai_usage(written=True), openai_usage(cached=-1)]
        for usage in values:
            with self.subTest(usage=usage):
                self.assertIsNone(estimate_cost('openai', 'gpt-6-luna', usage)['usd_nanos'])

    def test_unknown_provider_model_and_tier_remain_explicitly_unknown(self):
        for provider, model, usage, tier in [
            ('gemini', 'unlisted-model', gemini_usage(), None),
            ('openai', 'unlisted-model', openai_usage(), None),
            ('openai', 'gpt-6-luna', openai_usage(), 'priority'),
            ('gemini', 'gemini-2.5-flash', gemini_usage(), 'FLEX'),
            ('unknown', 'gpt-6-luna', openai_usage(), None)]:
            with self.subTest(provider=provider, model=model, tier=tier):
                result = estimate_cost(provider, model, usage, tier)
                self.assertIsNone(result['usd_nanos'])
                self.assertEqual(result['reason'], 'pricing_unavailable')

    def test_verified_zero_usage_is_distinct_from_missing_usage(self):
        self.assertEqual(estimate_cost('gemini', 'gemini-2.5-flash', gemini_usage(0, 0))['usd_nanos'], 0)
        self.assertIsNone(estimate_cost('gemini', 'gemini-2.5-flash', None)['usd_nanos'])

    def test_usage_output_contains_only_approved_numeric_fields(self):
        usage = {**openai_usage(), 'api_key': 'private-secret-fixture',
            'raw_response': {'private': 'private-secret-fixture'}}
        usage['input_tokens_details']['private'] = 'private-secret-fixture'
        result = estimate_cost('openai', 'gpt-6-luna', usage)
        self.assertNotIn('private-secret-fixture', json.dumps(result))
        self.assertEqual(set(result['tokens']), {'input_tokens', 'output_tokens', 'total_tokens',
                                               'input_tokens_details', 'output_tokens_details'})


class RecorderTests(OfflineCase):
    def test_each_http_has_private_immutable_start_and_usage_receipts(self):
        recorder = self.recorder()
        self.record(recorder)
        paths = list(self.storage.values)
        self.assertEqual(len(paths), 2)
        self.assertTrue(all(path.startswith(PREFIX + '/2026-10-11/') for path in paths))
        self.assertEqual({v['state'] for v in self.storage.values.values()}, {'started', 'usage_known'})
        self.assertTrue(all(op[2] is not None for op in self.storage.operations if op[0] == 'create'))

    def test_same_uuid_repeated_in_one_recorder_is_idempotent(self):
        recorder = self.recorder()
        self.record(recorder)
        before = deepcopy(self.storage.values)
        self.now += 10
        self.record(recorder)
        self.assertEqual(self.storage.values, before)
        self.assertEqual(recorder.safe_summary()['request_count'], 1)
        self.assertEqual(recorder.safe_summary()['persistence_failures'], 0)

    def test_same_uuid_same_receipt_after_recorder_restart_is_idempotent(self):
        self.record(self.recorder())
        restarted = self.recorder()
        self.record(restarted)
        result = restarted.safe_summary()
        self.assertEqual(result['request_count'], 1)
        self.assertTrue(result['persistence_complete'])
        self.assertEqual(result['persistence_failures'], 0)
        self.assertEqual(collect_daily_cost(self.storage, '2026-10-11')['request_count'], 1)

    def test_conflicting_existing_receipt_is_not_overwritten_or_counted_as_saved(self):
        self.record(self.recorder())
        original = deepcopy(self.storage.values)
        self.now += 1
        restarted = self.recorder()
        self.record(restarted)
        self.assertEqual(self.storage.values, original)
        self.assertGreater(restarted.safe_summary()['persistence_failures'], 0)
        self.assertFalse(restarted.safe_summary()['persistence_complete'])
        # Each collision's comparison uses that create attempt's same budget.
        operations = self.storage.operations[2:]
        for index in (0, 2):
            self.assertEqual(operations[index][0], 'create')
            self.assertEqual(operations[index + 1][0], 'read')
            self.assertEqual(operations[index][2], operations[index + 1][2])

    def test_known_http_usage_above_one_hundred_million_nanos_is_not_unknown(self):
        recorder = self.recorder()
        self.record(recorder, usage=gemini_usage(80000, 100000))
        result = recorder.safe_summary()
        self.assertEqual(Decimal(result['estimated_cost_usd']), Decimal('0.274'))
        self.assertEqual(result['unknown_cost_count'], 0)

    def test_ten_yen_target_is_soft_and_does_not_reject_more_receipts(self):
        recorder = self.recorder()
        self.record(recorder, usage=gemini_usage(30000, 30000))
        self.record(recorder, 2, usage=gemini_usage())
        result = recorder.safe_summary()
        self.assertGreater(Decimal(result['estimated_cost_jpy']), 10)
        self.assertEqual(result['target_mode'], 'soft')
        self.assertEqual(result['target_state'], 'above_target')
        self.assertEqual(result['request_count'], 2)

    def test_finish_after_jst_midnight_retains_original_dispatch_day(self):
        self.now = at(hour=23, minute=59, second=59)
        recorder = self.recorder()
        recorder.start_request(provider='gemini', model='gemini-2.5-flash', request_id=identifier(1))
        self.now += 2
        recorder.record_request(provider='gemini', model='gemini-2.5-flash',
            request_id=identifier(1), usage=gemini_usage())
        usage = next(v for k, v in self.storage.values.items() if k.endswith('.usage.json'))
        self.assertEqual(usage['day'], '2026-10-11')
        self.assertTrue(usage['finished_at'].startswith('2026-10-12'))
        self.assertEqual(collect_daily_cost(self.storage, '2026-10-11')['request_count'], 1)
        self.assertEqual(collect_daily_cost(self.storage, '2026-10-12')['request_count'], 0)

    def test_communication_unknown_has_unknown_receipt_not_zero(self):
        recorder = self.recorder()
        recorder.start_request(provider='gemini', model='gemini-2.5-flash', request_id=identifier(1))
        recorder.record_request(provider='gemini', model='gemini-2.5-flash', request_id=identifier(1))
        result = recorder.safe_summary()
        self.assertEqual(result['unknown_cost_count'], 1)
        self.assertFalse(result['estimate_complete'])
        self.assertEqual(result['target_state'], 'unknown')
        self.assertEqual(next(v['state'] for k, v in self.storage.values.items()
                              if k.endswith('.usage.json')), 'usage_unknown')

    def test_crash_after_start_survives_as_unknown_across_restart(self):
        self.recorder().start_request(provider='gemini', model='gemini-2.5-flash', request_id=identifier(1))
        result = collect_daily_cost(self.storage, '2026-10-11')
        self.assertEqual(result['request_count'], 1)
        self.assertEqual(result['unknown_cost_count'], 1)
        self.assertFalse(result['estimate_complete'])

    def test_restarted_finish_without_start_context_does_not_guess_a_new_send_day(self):
        self.recorder().start_request(provider='gemini', model='gemini-2.5-flash', request_id=identifier(1))
        original = deepcopy(self.storage.values)
        self.now = at('2026-10-12')
        with self.assertRaisesRegex(ValueError, '^cost_start_unavailable$'):
            self.recorder().record_request(provider='gemini', model='gemini-2.5-flash',
                request_id=identifier(1), usage=gemini_usage())
        self.assertEqual(self.storage.values, original)
        old = collect_daily_cost(self.storage, '2026-10-11')
        self.assertEqual(old['request_count'], 1)
        self.assertEqual(old['unknown_cost_count'], 1)
        self.assertEqual(collect_daily_cost(self.storage, '2026-10-12')['request_count'], 0)

    def test_unknown_model_or_tier_persists_as_unknown_instead_of_a_free_request(self):
        for number, model, tier in [(1, 'unlisted-model', None),
                                   (2, 'gemini-2.5-flash', 'FLEX')]:
            recorder = self.recorder()
            recorder.start_request(provider='gemini', model=model, request_id=identifier(number))
            recorder.record_request(provider='gemini', model=model, request_id=identifier(number),
                usage=gemini_usage(), service_tier=tier)
        result = collect_daily_cost(self.storage, '2026-10-11')
        self.assertEqual(result['request_count'], 2)
        self.assertEqual(result['unknown_cost_count'], 2)
        self.assertFalse(result['estimate_complete'])
        self.assertEqual(result['target_state'], 'unknown')

    def test_storage_failure_does_not_raise_or_prevent_following_record(self):
        recorder = self.recorder()
        self.storage.fail_create = True
        self.record(recorder)
        self.record(recorder, 2)
        result = recorder.safe_summary()
        self.assertEqual(result['request_count'], 2)
        self.assertEqual(result['unknown_cost_count'], 0)
        self.assertGreater(result['persistence_failures'], 0)
        self.assertFalse(result['estimate_complete'])
        self.assertNotIn('private storage error', json.dumps(result))

    def test_failed_finish_save_keeps_durable_start_unknown(self):
        recorder = self.recorder()
        recorder.start_request(provider='gemini', model='gemini-2.5-flash', request_id=identifier(1))
        self.storage.fail_create = True
        recorder.record_request(provider='gemini', model='gemini-2.5-flash',
            request_id=identifier(1), usage=gemini_usage())
        self.assertFalse(recorder.safe_summary()['persistence_complete'])
        result = collect_daily_cost(self.storage, '2026-10-11')
        self.assertEqual(result['request_count'], 1)
        self.assertEqual(result['unknown_cost_count'], 1)
        self.assertFalse(result['estimate_complete'])

    def test_no_storage_remains_explicitly_incomplete_but_does_not_stop(self):
        recorder = ReviewUsageRecorder(scope='private_test', clock=lambda: self.now)
        self.record(recorder)
        self.assertFalse(recorder.safe_summary()['persistence_complete'])
        self.assertEqual(recorder.safe_summary()['request_count'], 1)

    def test_secret_values_do_not_enter_private_receipt_or_summary(self):
        recorder = self.recorder()
        usage = {**gemini_usage(), 'prompt': 'private-secret-fixture',
                 'headers': {'Authorization': 'private-secret-fixture'}}
        self.record(recorder, usage=usage)
        serialized = json.dumps([self.storage.values, recorder.safe_summary()])
        self.assertNotIn('private-secret-fixture', serialized)
        self.assertNotIn('Authorization', serialized)

    def test_invalid_scope_request_id_or_key_shaped_model_is_rejected_without_storage(self):
        with self.assertRaises(ValueError):
            self.recorder('unlisted')
        for model, request_id in [('sk-private-fixture', identifier(1)),
                                  ('gemini-2.5-flash', 'private-secret-fixture')]:
            with self.subTest(model=model):
                with self.assertRaises(ValueError):
                    self.recorder().start_request(provider='gemini', model=model, request_id=request_id)
        self.assertEqual(self.storage.values, {})


class AggregationTests(OfflineCase):
    def test_three_scopes_share_one_daily_total(self):
        for number, scope in enumerate(('economy', 'company', 'private_test'), 1):
            self.record(self.recorder(scope), number)
        result = collect_daily_cost(self.storage, '2026-10-11')
        self.assertEqual(result['request_count'], 3)
        self.assertEqual(Decimal(result['estimated_cost_usd']), Decimal('0.00165'))
        self.assertEqual({scope: v['request_count'] for scope, v in result['scopes'].items()},
                         {'economy': 1, 'company': 1, 'private_test': 1})
        self.assertTrue(result['scan_complete'])
        self.assertIs(result['snapshot_guaranteed'], False)

    def test_gemini_http_retry_has_distinct_receipt_and_both_costs(self):
        recorder = self.recorder()
        self.record(recorder, 1, usage=gemini_usage(1000, 6000))
        self.record(recorder, 2, usage=gemini_usage(1000, 12000))
        result = collect_daily_cost(self.storage, '2026-10-11')
        self.assertEqual(result['request_count'], 2)
        self.assertEqual(Decimal(result['estimated_cost_usd']), Decimal('0.0456'))

    def test_parallel_different_uuid_receipts_are_not_lost_or_double_counted(self):
        barrier = Barrier(8)
        errors = []
        def write(number):
            try:
                recorder = self.recorder(('economy', 'company', 'private_test')[number % 3])
                barrier.wait()
                self.record(recorder, number)
            except Exception as error:
                errors.append(type(error).__name__)
        workers = [Thread(target=write, args=(number,)) for number in range(1, 9)]
        for worker in workers: worker.start()
        for worker in workers: worker.join(2)
        self.assertEqual(errors, [])
        self.assertTrue(all(not worker.is_alive() for worker in workers))
        result = collect_daily_cost(self.storage, '2026-10-11')
        self.assertEqual(result['request_count'], 8)
        self.assertEqual(Decimal(result['estimated_cost_usd']), Decimal('0.0044'))

    def test_pagination_beyond_thirty_receipts_is_complete_with_shared_deadline(self):
        recorder = self.recorder()
        for number in range(1, 22):
            self.record(recorder, number)
        self.storage.operations.clear()
        result = collect_daily_cost(self.storage, '2026-10-11')
        self.assertEqual(result['request_count'], 21)
        self.assertTrue(result['scan_complete'])
        lists = [operation for operation in self.storage.operations if operation[0] == 'list']
        self.assertEqual([operation[1] for operation in lists], [0, 30])
        self.assertEqual(len({operation[2] for operation in self.storage.operations}), 1)

    def test_scan_limit_reports_incomplete_instead_of_claiming_total(self):
        recorder = self.recorder()
        for number in range(1, 112):
            self.record(recorder, number)
        result = collect_daily_cost(self.storage, '2026-10-11')
        self.assertFalse(result['scan_complete'])
        self.assertFalse(result['estimate_complete'])
        offsets = [operation[1] for operation in self.storage.operations if operation[0] == 'list']
        self.assertEqual(offsets, [0, 30, 60, 90, 120, 150, 180])

    def test_persistence_failure_during_aggregation_is_explicit_and_private_detail_free(self):
        self.record(self.recorder())
        for field in ('fail_read', 'fail_list'):
            with self.subTest(field=field):
                setattr(self.storage, field, True)
                result = collect_daily_cost(self.storage, '2026-10-11')
                self.assertFalse(result['scan_complete'])
                self.assertNotIn('private storage error', json.dumps(result))
                setattr(self.storage, field, False)

    def test_orphan_usage_and_unrecognized_file_are_incomplete(self):
        self.record(self.recorder())
        del self.storage.values[f'{PREFIX}/2026-10-11/{identifier(1)}.start.json']
        self.storage.values[f'{PREFIX}/2026-10-11/unrecognized.json'] = {'private': 'private-secret-fixture'}
        result = collect_daily_cost(self.storage, '2026-10-11')
        self.assertFalse(result['scan_complete'])
        self.assertNotIn('private-secret-fixture', json.dumps(result))

    def test_start_usage_context_mismatch_is_not_known_cost(self):
        for field, value in [('scope', 'company'), ('provider', 'openai'), ('model', 'unlisted-model'),
                             ('started_at', '2026-10-11T12:00:01+09:00')]:
            with self.subTest(field=field):
                self.storage = MemoryStorage()
                self.record(self.recorder())
                usage_key = f'{PREFIX}/2026-10-11/{identifier(1)}.usage.json'
                self.storage.values[usage_key][field] = value
                result = collect_daily_cost(self.storage, '2026-10-11')
                self.assertFalse(result['scan_complete'])
                self.assertEqual(result['unknown_cost_count'], 1)
                self.assertEqual(Decimal(result['estimated_cost_usd']), 0)

    def test_repeated_page_names_are_incomplete_even_if_uuid_deduplicates(self):
        recorder = self.recorder()
        for number in range(1, 17):
            self.record(recorder, number)
        listing = self.storage._list
        def repeated(prefix, *, offset=0, deadline=None):
            first = listing(prefix, offset=0, deadline=deadline)
            return first if offset == 0 else first[:2]
        self.storage._list = repeated
        result = collect_daily_cost(self.storage, '2026-10-11')
        self.assertFalse(result['scan_complete'])
        self.assertFalse(result['estimate_complete'])

    def test_empty_day_is_zero_complete_without_provider_calls(self):
        result = collect_daily_cost(self.storage, '2026-10-11')
        self.assertEqual(result['request_count'], 0)
        self.assertEqual(Decimal(result['estimated_cost_usd']), 0)
        self.assertTrue(result['estimate_complete'])
        self.assertEqual(result['target_state'], 'within_target')

    def test_bad_calendar_date_is_rejected_before_storage(self):
        for day in ('2026-02-30', '2026-10-1', 'private-secret-fixture'):
            with self.subTest(day=day), self.assertRaises(ValueError):
                collect_daily_cost(self.storage, day)
        self.assertEqual(self.storage.operations, [])


if __name__ == '__main__':
    unittest.main()

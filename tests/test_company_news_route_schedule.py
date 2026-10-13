"""Fictional routes verify bounded fair scheduling without external I/O."""
from copy import deepcopy
import importlib
import json
import math
import unittest
from unittest.mock import patch

import company_news_route_schedule as schedule


NOW = 1791882000


def feeds(count, prefix):
    return {f'{prefix}-{index:03d}': f'https://fixture.example/{prefix}/{index}.xml'
            for index in range(count)}


class CompanyRouteScheduleTests(unittest.TestCase):
    def setUp(self):
        self.base = feeds(33, 'base')
        self.extra = feeds(194, 'extra')

    def test_all_194_routes_are_scheduled_once_per_cycle_and_all_base_routes_each_poll(self):
        seen, selected_sizes = [], []
        first_slot = int(NOW // 900) * 900
        for offset in range(33):
            plan = schedule.select_route_schedule(self.base, self.extra, first_slot + offset * 900)
            self.assertEqual({key: plan['feeds'][key] for key in self.base}, self.base)
            chosen = set(plan['feeds']) - set(self.base)
            seen.extend(chosen)
            selected_sizes.append(len(chosen))
            self.assertLessEqual(len(plan['feeds']), 39)
            coverage = plan['coverage']
            self.assertEqual(coverage['registered_channel_count'], 227)
            self.assertEqual(coverage['additional_scheduled_channel_count'], len(chosen))
            self.assertEqual(coverage['additional_unscheduled_channel_count'], 194 - len(chosen))
            self.assertEqual(coverage['rotation_full_cycle_seconds'], 29700)
            self.assertFalse(coverage['all_registered_routes_scheduled_this_poll'])
            self.assertFalse(coverage['all_company_announcements_covered'])
        self.assertEqual(len(seen), 194)
        self.assertEqual(set(seen), set(self.extra))
        self.assertEqual(len(set(seen)), len(seen))
        self.assertEqual(sorted(selected_sizes), [2] + [6] * 32)

    def test_restart_reorder_and_within_slot_time_do_not_change_selection(self):
        first = schedule.select_route_schedule(self.base, self.extra, NOW)
        reloaded = importlib.reload(schedule)
        reordered_base, reordered_extra = dict(reversed(list(self.base.items()))), dict(reversed(list(self.extra.items())))
        slot_start = int(NOW // 900) * 900
        for now in (slot_start, slot_start + 899.999):
            plan = reloaded.select_route_schedule(reordered_base, reordered_extra, now)
            self.assertEqual(plan, first)
        repeated = reloaded.select_route_schedule(self.base, self.extra, slot_start + 33 * 900)
        self.assertEqual(repeated, first)

    def test_next_utc_slot_selects_next_disjoint_chunk_and_no_local_timezone_is_read(self):
        before = schedule.select_route_schedule(self.base, self.extra, 900 * 100 + 899.9)
        after = schedule.select_route_schedule(self.base, self.extra, 900 * 101)
        old = set(before['feeds']) - set(self.base)
        new = set(after['feeds']) - set(self.base)
        self.assertFalse(old.intersection(new))
        self.assertEqual(after['coverage']['rotation_batch_index'],
                         (before['coverage']['rotation_batch_index'] + 1) % 33)

    def test_empty_additional_registry_keeps_base_and_does_not_promise_company_coverage(self):
        plan = schedule.select_route_schedule(self.base, {}, NOW)
        self.assertEqual(plan['feeds'], self.base)
        self.assertEqual(plan['coverage']['rotation_full_cycle_seconds'], 0)
        self.assertEqual(plan['coverage']['additional_scheduled_channel_count'], 0)
        self.assertTrue(plan['coverage']['all_registered_routes_scheduled_this_poll'])
        self.assertFalse(plan['coverage']['all_company_announcements_covered'])

    def test_single_and_partial_batches_do_not_duplicate_or_drop_routes(self):
        for count in (1, 5, 6, 7, 12, 13, 193, 194):
            with self.subTest(count=count):
                extra = feeds(count, 'extra')
                batches = math.ceil(count / 6)
                seen = []
                for slot in range(1, batches + 1):
                    plan = schedule.select_route_schedule(self.base, extra, slot * 900)
                    seen.extend(set(plan['feeds']) - set(self.base))
                self.assertEqual(sorted(seen), sorted(extra))
                self.assertEqual(len(set(seen)), count)

    def test_lower_limit_can_reduce_calls_but_cannot_increase_bound(self):
        plan = schedule.select_route_schedule(self.base, self.extra, NOW, additional_limit=1)
        self.assertEqual(plan['coverage']['additional_scheduled_channel_count'], 1)
        self.assertEqual(plan['coverage']['rotation_full_cycle_seconds'], 194 * 900)
        for value in (0, -1, 7, 194, True, 6.0, None):
            with self.subTest(limit=value):
                with self.assertRaisesRegex(ValueError, '^company_route_schedule_invalid$'):
                    schedule.select_route_schedule(self.base, self.extra, NOW, additional_limit=value)

    def test_invalid_timestamp_fails_before_any_route_is_returned(self):
        for value in (None, True, False, '', '1791882000', 0, -1,
                      math.nan, math.inf, -math.inf, 253402300800, 10 ** 400):
            with self.subTest(now=str(value)[:40]):
                with self.assertRaisesRegex(ValueError, '^company_route_schedule_invalid$'):
                    schedule.select_route_schedule(self.base, self.extra, value)

    def test_invalid_or_oversized_registry_fails_closed(self):
        bad_pairs = [({}, self.extra), (None, self.extra), (self.base, None),
                     (list(self.base.items()), self.extra),
                     (feeds(34, 'base'), self.extra), (self.base, feeds(195, 'extra'))]
        for pair in bad_pairs:
            with self.subTest(pair_type=str(type(pair[0]))):
                with self.assertRaisesRegex(ValueError, '^company_route_schedule_invalid$'):
                    schedule.select_route_schedule(*pair, NOW)

    def test_duplicate_labels_or_exact_urls_across_registries_are_rejected(self):
        for extra in ({'base-000': 'https://fixture.example/new.xml'},
                      {'new': self.base['base-000']},
                      {'a': 'https://fixture.example/same.xml', 'b': 'https://fixture.example/same.xml'}):
            with self.subTest(extra=extra):
                with self.assertRaisesRegex(ValueError, '^company_route_schedule_invalid$'):
                    schedule.select_route_schedule(self.base, extra, NOW)

    def test_unusable_labels_or_urls_are_not_partially_scheduled(self):
        good = {'good': 'https://fixture.example/good.xml'}
        bad = [('', good['good']), (' padded ', good['good']), ('x' * 201, good['good']),
               ('line\nlabel', good['good']), (1, good['good']),
               ('bad', None), ('bad', 'http://fixture.example/a.xml'),
               ('bad', 'https://user:private@fixture.example/a.xml'),
               ('bad', 'https://fixture.example/a.xml#fragment'),
               ('bad', 'https://fixture.example:bad/a.xml'),
               ('bad', 'https://fixture.example/a xml'),
               ('bad', 'https://fixture.example/\\a.xml'),
               ('bad', 'https://fixture.example/' + 'x' * 2048)]
        for label, url in bad:
            with self.subTest(label=str(label)[:10]):
                with self.assertRaisesRegex(ValueError, '^company_route_schedule_invalid$'):
                    schedule.select_route_schedule(self.base, {**good, label: url}, NOW)

    def test_inputs_are_not_modified_and_compact_counts_do_not_leak_route_labels_or_urls(self):
        base, extra = deepcopy(self.base), deepcopy(self.extra)
        plan = schedule.select_route_schedule(base, extra, NOW)
        plan['feeds'].clear()
        self.assertEqual(base, self.base)
        self.assertEqual(extra, self.extra)
        encoded = json.dumps(plan['coverage'], ensure_ascii=True).encode()
        self.assertLess(len(encoded), 700)
        self.assertNotIn(b'fixture.example', encoded)
        self.assertNotIn(b'extra-', encoded)
        self.assertTrue(all(type(value) in (int, bool) for value in plan['coverage'].values()))

    def test_import_and_schedule_use_no_system_clock_network_or_storage(self):
        with patch('socket.socket', side_effect=AssertionError('network forbidden')), \
             patch('builtins.open', side_effect=AssertionError('storage forbidden')), \
             patch('time.time', side_effect=AssertionError('clock forbidden')):
            module = importlib.reload(schedule)
            self.assertEqual(len(module.select_route_schedule(self.base, self.extra, NOW)['feeds']), 39)


if __name__ == '__main__':
    unittest.main()

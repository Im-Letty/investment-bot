from copy import deepcopy
import json
import unittest

from news_review_diagnostics import safe_editorial_review_diagnostics


CHECK_NAMES = (
    'facts', 'dates', 'distinct_topics', 'japan_economy', 'readable',
    'no_invented_outlook', 'original_wording',
)


def review(*, approved=True, failed_checks=(), issue_count=0):
    return {
        'approved': approved,
        'passed': approved and not failed_checks and issue_count == 0,
        'failed_checks': list(failed_checks),
        'issue_count': issue_count,
    }


def diagnostic(stage='second_review_rejected'):
    rounds = [{
        'round': 1,
        'gemini': review(),
        'openai': review(approved=False, failed_checks=('facts',), issue_count=1),
    }]
    if stage == 'second_review_rejected':
        rounds.append({
            'round': 2,
            'gemini': review(failed_checks=('dates',)),
            'openai': review(),
        })
    return {
        'schema_version': 1,
        'failure_stage': stage,
        'rounds': rounds,
        'call_counts': {
            'writer_calls': 8,
            'gemini_requests': 3,
            'openai_requests': 2,
        },
    }


class SafeEditorialReviewDiagnosticsTests(unittest.TestCase):
    def test_each_failure_stage_preserves_only_the_safe_projection(self):
        for stage in (
            'second_review_rejected',
            'repair_reservation_denied',
            'overview_repair_budget_denied',
        ):
            with self.subTest(stage=stage):
                value = diagnostic(stage)
                self.assertEqual(safe_editorial_review_diagnostics(value), value)

    def test_counts_are_optional_and_zero_counts_are_valid(self):
        value = diagnostic()
        del value['call_counts']
        self.assertEqual(safe_editorial_review_diagnostics(value), value)
        value['call_counts'] = dict.fromkeys(
            ('writer_calls', 'gemini_requests', 'openai_requests'), 0)
        self.assertEqual(safe_editorial_review_diagnostics(value), value)

    def test_approved_reviewer_with_issues_still_records_rejection(self):
        value = diagnostic('repair_reservation_denied')
        value['rounds'][0]['openai'] = review(issue_count=20)
        self.assertEqual(safe_editorial_review_diagnostics(value), value)

    def test_approval_denial_and_all_fixed_failed_checks_are_valid(self):
        for rejected in (
            review(approved=False),
            review(failed_checks=CHECK_NAMES),
        ):
            with self.subTest(rejected=rejected):
                value = diagnostic('overview_repair_budget_denied')
                value['rounds'][0]['gemini'] = rejected
                value['rounds'][0]['openai'] = review()
                self.assertEqual(safe_editorial_review_diagnostics(value), value)

    def test_unknown_free_text_is_removed_at_every_depth(self):
        expected = diagnostic()
        value = deepcopy(expected)
        marker = 'untrusted-free-text-marker'
        value.update(message=marker, source_body=marker, secret=marker)
        value['call_counts']['exception'] = marker
        for item in value['rounds']:
            item['draft'] = marker
            for provider in ('gemini', 'openai'):
                item[provider].update(issues=[marker], raw_response=marker)
        result = safe_editorial_review_diagnostics(value)
        self.assertEqual(result, expected)
        self.assertNotIn(marker, json.dumps(result))
        self.assertEqual(value['source_body'], marker)

    def test_result_and_input_do_not_share_mutable_values(self):
        value = diagnostic()
        expected = deepcopy(value)
        result = safe_editorial_review_diagnostics(value)
        value['rounds'][0]['openai']['failed_checks'].append('dates')
        value['call_counts']['writer_calls'] = 0
        self.assertEqual(result, expected)
        result['rounds'][1]['gemini']['failed_checks'].append('facts')
        result['call_counts']['openai_requests'] = 0
        self.assertEqual(value['rounds'][1], expected['rounds'][1])
        self.assertEqual(value['call_counts']['openai_requests'], 2)

    def test_non_objects_and_invalid_top_level_values_are_rejected(self):
        for value in (None, [], '', 1, True):
            with self.subTest(value=value):
                self.assertIsNone(safe_editorial_review_diagnostics(value))
        for key, bad in (
            ('schema_version', True), ('schema_version', 1.0),
            ('schema_version', 2), ('schema_version', '1'),
            ('failure_stage', 'untrusted-free-text-marker'),
            ('failure_stage', None), ('failure_stage', []),
        ):
            with self.subTest(key=key, bad=bad):
                value = diagnostic()
                value[key] = bad
                self.assertIsNone(safe_editorial_review_diagnostics(value))
        for key in ('schema_version', 'failure_stage', 'rounds'):
            with self.subTest(missing=key):
                value = diagnostic()
                del value[key]
                self.assertIsNone(safe_editorial_review_diagnostics(value))

    def test_dict_subclasses_cannot_run_custom_accessors(self):
        class UntrustedDict(dict):
            def get(self, *args):
                raise AssertionError('untrusted accessor must not run')

        self.assertIsNone(safe_editorial_review_diagnostics(UntrustedDict(diagnostic())))
        for location in ('round', 'review', 'counts'):
            with self.subTest(location=location):
                value = diagnostic()
                if location == 'round':
                    value['rounds'][0] = UntrustedDict(value['rounds'][0])
                elif location == 'review':
                    value['rounds'][0]['gemini'] = UntrustedDict(value['rounds'][0]['gemini'])
                else:
                    value['call_counts'] = UntrustedDict(value['call_counts'])
                self.assertIsNone(safe_editorial_review_diagnostics(value))

    def test_rounds_require_bounded_sequential_failure_history(self):
        cases = [None, {}, (), [], [None], [diagnostic()['rounds'][0]] * 3]
        for rounds in cases:
            with self.subTest(rounds=rounds):
                value = diagnostic()
                value['rounds'] = rounds
                self.assertIsNone(safe_editorial_review_diagnostics(value))
        for bad in (True, 1.0, '1', 0, 2, 3):
            with self.subTest(first_round=bad):
                value = diagnostic()
                value['rounds'][0]['round'] = bad
                self.assertIsNone(safe_editorial_review_diagnostics(value))
        for stage in ('repair_reservation_denied', 'overview_repair_budget_denied'):
            value = diagnostic()
            value['failure_stage'] = stage
            self.assertIsNone(safe_editorial_review_diagnostics(value))
        value = diagnostic()
        value['rounds'].pop()
        self.assertIsNone(safe_editorial_review_diagnostics(value))
        value = diagnostic()
        value['rounds'][1]['round'] = 1
        self.assertIsNone(safe_editorial_review_diagnostics(value))
        for index in (0, 1):
            with self.subTest(all_passed_round=index + 1):
                value = diagnostic()
                value['rounds'][index]['gemini'] = review()
                value['rounds'][index]['openai'] = review()
                self.assertIsNone(safe_editorial_review_diagnostics(value))

    def test_provider_shape_and_review_fields_are_strict(self):
        for bad in (None, [], 'untrusted-free-text-marker'):
            value = diagnostic()
            value['rounds'][0]['gemini'] = bad
            self.assertIsNone(safe_editorial_review_diagnostics(value))
        for key in ('round', 'gemini', 'openai'):
            value = diagnostic()
            del value['rounds'][0][key]
            self.assertIsNone(safe_editorial_review_diagnostics(value))
        for key in ('approved', 'passed', 'failed_checks', 'issue_count'):
            value = diagnostic()
            del value['rounds'][0]['gemini'][key]
            self.assertIsNone(safe_editorial_review_diagnostics(value))
        for key in ('approved', 'passed'):
            for bad in (0, 1, 'true', None):
                with self.subTest(key=key, bad=bad):
                    value = diagnostic()
                    value['rounds'][0]['gemini'][key] = bad
                    self.assertIsNone(safe_editorial_review_diagnostics(value))

    def test_passed_flag_must_match_all_three_rejection_conditions(self):
        for rejected in (
            review(approved=False), review(issue_count=1),
            review(failed_checks=('facts',)),
        ):
            value = diagnostic()
            rejected['passed'] = True
            value['rounds'][0]['openai'] = rejected
            self.assertIsNone(safe_editorial_review_diagnostics(value))
        value = diagnostic()
        value['rounds'][0]['gemini']['passed'] = False
        self.assertIsNone(safe_editorial_review_diagnostics(value))

    def test_failed_checks_accept_only_bounded_fixed_enum_lists(self):
        for bad in (
            None, 'facts', ('facts',), {}, [None], [True], [1],
            ['untrusted-free-text-marker'], ['facts', 'facts'], ['facts'] * 8,
        ):
            with self.subTest(bad=bad):
                value = diagnostic()
                value['rounds'][0]['openai']['failed_checks'] = bad
                self.assertIsNone(safe_editorial_review_diagnostics(value))

    def test_issue_count_rejects_noninteger_and_out_of_range_values(self):
        for bad in (True, False, 1.0, '1', None, -1, 21, 10**100):
            with self.subTest(bad=bad):
                value = diagnostic()
                value['rounds'][0]['openai']['issue_count'] = bad
                self.assertIsNone(safe_editorial_review_diagnostics(value))

    def test_call_counts_require_bounded_strict_integers(self):
        for bad in (None, [], 'untrusted-free-text-marker'):
            value = diagnostic()
            value['call_counts'] = bad
            self.assertIsNone(safe_editorial_review_diagnostics(value))
        for key, maximum in (
            ('writer_calls', 8), ('gemini_requests', 3), ('openai_requests', 2),
        ):
            value = diagnostic()
            del value['call_counts'][key]
            self.assertIsNone(safe_editorial_review_diagnostics(value))
            for bad in (True, False, 1.0, '1', None, -1, maximum + 1, 10**100):
                with self.subTest(key=key, bad=bad):
                    value = diagnostic()
                    value['call_counts'][key] = bad
                    self.assertIsNone(safe_editorial_review_diagnostics(value))


if __name__ == '__main__':
    unittest.main()

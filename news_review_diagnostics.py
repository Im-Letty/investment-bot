"""Text-free failure evidence for the bounded, exact-copy editorial reviews.

This projection never contains copy, source identities, provider prose or keys.
It describes a failed invocation; it cannot approve content or authorize a retry.
"""

REVIEW_CHECKS = ('facts', 'dates', 'distinct_topics', 'japan_economy', 'readable',
                 'no_invented_outlook', 'original_wording')
FAILURE_STAGES = frozenset(('second_review_rejected', 'repair_reservation_denied',
                            'overview_repair_budget_denied'))


def safe_editorial_review_diagnostics(value):
    """Revalidate every fixed field when crossing runtime/storage/report edges."""
    if (type(value) is not dict or type(value.get('schema_version')) is not int
            or value['schema_version'] != 1 or type(value.get('failure_stage')) is not str
            or value['failure_stage'] not in FAILURE_STAGES):
        return None
    rounds = value.get('rounds')
    expected_rounds = 2 if value['failure_stage'] == 'second_review_rejected' else 1
    if type(rounds) is not list or len(rounds) != expected_rounds:
        return None
    result = {'schema_version': 1, 'failure_stage': value['failure_stage'], 'rounds': []}
    for number, row in enumerate(rounds, 1):
        if type(row) is not dict or type(row.get('round')) is not int or row['round'] != number:
            return None
        safe = {'round': number}
        for name in ('gemini', 'openai'):
            review = row.get(name)
            if type(review) is not dict:
                return None
            approved, passed = review.get('approved'), review.get('passed')
            checks, count = review.get('failed_checks'), review.get('issue_count')
            if (type(approved) is not bool or type(passed) is not bool
                    or type(count) is not int or not 0 <= count <= 20
                    or type(checks) is not list or len(checks) > len(REVIEW_CHECKS)
                    or any(type(check) is not str or check not in REVIEW_CHECKS for check in checks)
                    or len(set(checks)) != len(checks)
                    or passed != (approved and not checks and count == 0)):
                return None
            safe[name] = {'approved': approved, 'passed': passed,
                          'failed_checks': [check for check in REVIEW_CHECKS if check in checks],
                          'issue_count': count}
        if all(safe[name]['passed'] for name in ('gemini', 'openai')):
            return None
        result['rounds'].append(safe)
    if 'call_counts' in value:
        counts = value['call_counts']
        limits = {'writer_calls': 8, 'gemini_requests': 3, 'openai_requests': 2}
        if (type(counts) is not dict or any(type(counts.get(key)) is not int
                or not 0 <= counts[key] <= limit for key, limit in limits.items())):
            return None
        result['call_counts'] = {key: counts[key] for key in limits}
    return result

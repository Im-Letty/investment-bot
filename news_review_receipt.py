"""Trusted, hash-only evidence emitted after both exact-copy reviews pass.

No model is allowed to supply this receipt. Publication timestamps may move
forward after storage completes; the reviewed words and references may not.
"""
from hashlib import sha256
import json
import math
import re

CONTENT_FIELDS = ('publication_mode', 'edition_date', 'lang', 'headline', 'summary',
                  'article_refs', 'article_summaries', 'source_window',
                  'copy_length_policy', 'reading_structure')


def _hash(value):
    return sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                             separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def content_hash(issue):
    if not isinstance(issue, dict):
        raise ValueError('invalid_reviewed_content')
    return _hash({key: issue[key] for key in CONTENT_FIELDS if key in issue})


def completed_receipt(issue, review_payload):
    """Called by the trusted producer only after both approvals, never on input."""
    return {'content_sha256': content_hash(issue),
            'review_payload_sha256': _hash(review_payload),
            'source_body_sha256': [ref['body_sha256'] for ref in issue['article_refs']],
            'gemini_approved': True, 'openai_approved': True,
            'reviewed_at': issue['reviewed_at']}


def valid_receipt(receipt, issue):
    try:
        stamp = receipt.get('reviewed_at') if isinstance(receipt, dict) else None
        return (isinstance(receipt, dict)
                and receipt.get('gemini_approved') is True
                and receipt.get('openai_approved') is True
                and receipt.get('content_sha256') == content_hash(issue)
                and isinstance(receipt.get('review_payload_sha256'), str)
                and re.fullmatch(r'[0-9a-f]{64}', receipt['review_payload_sha256']) is not None
                and receipt.get('source_body_sha256') == [ref['body_sha256'] for ref in issue['article_refs']]
                and type(stamp) in (int, float) and math.isfinite(stamp)
                and stamp == issue['reviewed_at'])
    except (KeyError, TypeError, ValueError):
        return False

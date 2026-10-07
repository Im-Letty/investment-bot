"""A private real-clock storage/release/render probe, separate from daily news.

This module never generates, publishes, claims, collects or sends news. Only an
already-approved historical short copy can be read from the dedicated prefix.
Importing this module does not construct a storage client or perform I/O.
"""
import base64
from copy import deepcopy
from datetime import date, datetime
from hashlib import sha256
import hmac
import json
import math
import os
import re
from urllib.parse import urlsplit

from daily_news_producer import OFFICIAL_SOURCES, _official_url
from daily_news_runtime import SupabaseNewsStorage
from news_cache import JST, LEAD_OTHER_NEWS_STRUCTURE
from news_copy_policy import COPY_LENGTH_POLICY
from news_initial import render_news_markup


SCHEMA = 'private-news-release-test-v1'
PREFIX = 'ops/news-flow-test/v1/'
LIFETIME_SECONDS = 15 * 60
RECORD_FIELDS = frozenset(('schema', 'created_at', 'test_release_at', 'expires_at',
    'token_sha256', 'draft', 'source_refs', 'final_copy_sha256'))
REF_FIELDS = frozenset(('index', 'source', 'title', 'url', 'published_at',
    'published_date', 'publication_precision', 'body_sha256', 'body_verified_at'))
ID_PATTERN = re.compile(r'[0-9a-f]{32}')
TOKEN_PATTERN = re.compile(r'[A-Za-z0-9_-]{43}')  # secrets.token_urlsafe(32)
HASH_PATTERN = re.compile(r'[0-9a-f]{64}')


def fingerprint(value):
    return sha256(json.dumps(value, ensure_ascii=False, allow_nan=False,
                            sort_keys=True, separators=(',', ':')).encode('utf-8')).hexdigest()


def _number(value):
    return type(value) in (int, float) and math.isfinite(value) and value > 0


def _text(value, limit):
    return type(value) is str and 1 <= len(value.strip()) <= limit


def valid_request(identifier, token):
    """Shape/canonical-encoding check only; no credential read or storage I/O."""
    if (type(identifier) is not str or ID_PATTERN.fullmatch(identifier) is None
            or type(token) is not str or TOKEN_PATTERN.fullmatch(token) is None):
        return False
    try:
        raw = base64.b64decode(token + '=', altchars=b'-_', validate=True)
        return len(raw) == 32 and base64.urlsafe_b64encode(raw).decode('ascii').rstrip('=') == token
    except (ValueError, UnicodeError):
        return False


def _validate(record, now):
    if (type(record) is not dict or set(record) != RECORD_FIELDS or record['schema'] != SCHEMA
            or not _number(now) or any(not _number(record[key]) for key in
                ('created_at', 'test_release_at', 'expires_at'))
            or not record['created_at'] <= now < record['expires_at']
            or not record['created_at'] <= record['test_release_at'] < record['expires_at']
            or record['expires_at'] > record['created_at'] + LIFETIME_SECONDS
            or type(record['token_sha256']) is not str or HASH_PATTERN.fullmatch(record['token_sha256']) is None
            or type(record['final_copy_sha256']) is not str or HASH_PATTERN.fullmatch(record['final_copy_sha256']) is None):
        return None
    draft, refs = record['draft'], record['source_refs']
    if (type(draft) is not dict or set(draft) != {'headline', 'summary', 'articles'}
            or not _text(draft['headline'], 35) or not _text(draft['summary'], 330)
            or type(draft['articles']) is not list or not 1 <= len(draft['articles']) <= 3
            or type(refs) is not list or len(refs) != len(draft['articles'])
            or fingerprint(draft) != record['final_copy_sha256']):
        return None
    indexes, urls = set(), set()
    for article, ref in zip(draft['articles'], refs):
        if (type(article) is not dict or set(article) != {'index', 'headline', 'summary'}
                or type(article['index']) is not int or not 0 <= article['index'] <= 2
                or article['index'] in indexes or not _text(article['headline'], 80)
                or not _text(article['summary'], 440)
                or type(ref) is not dict or set(ref) != REF_FIELDS or ref['index'] != article['index']
                or type(ref['index']) is not int or ref['source'] not in OFFICIAL_SOURCES
                or not _text(ref['title'], 1000) or _official_url(ref['url']) != ref['url']
                or ref['url'] in urls or not _number(ref['body_verified_at'])
                or ref['body_verified_at'] > record['created_at']
                or type(ref['body_sha256']) is not str or HASH_PATTERN.fullmatch(ref['body_sha256']) is None):
            return None
        if urlsplit(ref['url']).hostname != OFFICIAL_SOURCES[ref['source']]:
            return None
        published_day = date.fromisoformat(ref['published_date'])
        if (published_day.isoformat() != ref['published_date']
                or published_day > datetime.fromtimestamp(ref['body_verified_at'], JST).date()):
            return None
        if ref['publication_precision'] == 'day':
            if ref['published_at'] is not None:
                return None
        elif ref['publication_precision'] == 'second':
            if (not _number(ref['published_at']) or ref['published_at'] > ref['body_verified_at']
                    or datetime.fromtimestamp(ref['published_at'], JST).date() != published_day):
                return None
        else:
            return None
        indexes.add(article['index'])
        urls.add(ref['url'])
    return deepcopy(record)


def _presentation(record, now):
    """Presentation only; deliberately never validated as a curated edition."""
    refs, draft = record['source_refs'], record['draft']
    historical_day = max(ref['published_date'] for ref in refs)
    return {'delivery': 'rehearsal', 'edition_date': historical_day, 'lang': 'ja',
        'news': deepcopy(refs), 'supplements': [], 'fetched_at': record['created_at'],
        'refreshing': False, 'stale': False, 'selection_status': 'ready',
        'translation_pending': False,
        'digest': {'headline': draft['headline'], 'summary': draft['summary'],
            'article_refs': deepcopy(refs), 'article_summaries': [
                {**deepcopy(ref), 'headline': article['headline'], 'summary': article['summary']}
                for ref, article in zip(refs, draft['articles'])],
            'reading_structure': LEAD_OTHER_NEWS_STRUCTURE,
            'copy_length_policy': COPY_LENGTH_POLICY}}


def _unavailable():
    return {'status': 'not_found'}, 404


def private_preview_response(storage, identifier, token, now):
    """Read one fixed test object; reject invalid headers before any storage I/O.

    The caller obtains token only from X-News-Test-Token, never query/body data.
    All missing, invalid, expired or unauthorized cases have the same response.
    """
    if not valid_request(identifier, token) or not _number(now):
        return _unavailable()
    try:
        record = _validate(storage.read(PREFIX + identifier + '.json'), now)
        if record is None or not hmac.compare_digest(
                record['token_sha256'], sha256(token.encode('ascii')).hexdigest()):
            return _unavailable()
        metadata = {'private_test': True, 'historical_copy_only': True, 'publication_allowed': False,
            'test_scope': 'private_storage_release_render', 'scheduled_08_verified': False,
            'created_at': record['created_at'], 'test_release_at': record['test_release_at'],
            'expires_at': record['expires_at'], 'observed_at': now}
        if now < record['test_release_at']:
            return {**metadata, 'status': 'waiting'}, 200
        data = _presentation(record, now)
        markup = ('<p class="private-news-test-label">非公開テスト · 過去の公式発表を使った表示確認です。'
                  '朝8時の本番配信ではありません。</p>' + render_news_markup(data))
        # A secret cannot be returned even if a malformed saved copy contains it.
        wire = json.dumps(data, ensure_ascii=False, allow_nan=False)
        if (token in wire or re.search(r'(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{12,}|'
                r'AIza[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{12,})', wire)):
            return _unavailable()
        return {**metadata, 'status': 'available', 'final_copy_sha256': record['final_copy_sha256'],
            'data_sha256': fingerprint(data), 'source_dates': sorted({ref['published_date'] for ref in record['source_refs']}),
            'markup': markup}, 200
    except Exception:
        return _unavailable()


def storage_from_environment(environ=None):
    """Construct the ordinary private client only for an explicitly handled test.

    The caller still authenticates the header shape before construction. No
    ensure_private, create, collector or runtime operation occurs here.
    """
    env = os.environ if environ is None else environ
    return SupabaseNewsStorage(env.get('SUPABASE_URL'), env.get('SUPABASE_KEY'))

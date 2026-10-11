"""Shared worldwide conversations, independent of stock comments.

Supabase issues the existing application's sessions. Only a verified Auth user
ID reaches the service-role RPC; display names never establish ownership. This
module does not change a shared Supabase client's session or log remote errors.
"""

from datetime import datetime
import json
import re
import uuid

from flask import Blueprint, jsonify, request
import requests


CATEGORIES = frozenset(('economy', 'news', 'life', 'learn', 'chat'))
LANGUAGES = frozenset(('ja', 'en', 'ko', 'zh', 'other'))
REPORT_REASONS = frozenset(('spam', 'abuse', 'privacy', 'misinformation', 'other'))
MAX_REQUEST_BYTES = 8192
MAX_ID = 9_007_199_254_740_991  # Exact JSON/JavaScript integer range.
RPC_NAME = 'world_community_operation'
ERROR_STATUSES = {
    'auth_required': 401, 'auth_unavailable': 503, 'storage_unavailable': 503,
    'invalid_request': 400, 'invalid_category': 400, 'invalid_language': 400,
    'invalid_name': 400, 'empty': 400, 'too_long': 400, 'invalid_parent': 400,
    'invalid_cursor': 400, 'invalid_reason': 400, 'invalid_request_id': 400,
    'request_conflict': 409, 'not_found': 404, 'post_unavailable': 410,
    'rate_limited': 429, 'forbidden': 403,
}


class CommunityError(Exception):
    def __init__(self, reason, retry_after=None):
        self.reason = reason if isinstance(reason, str) and reason in ERROR_STATUSES else 'storage_unavailable'
        self.retry_after = retry_after


class SupabaseCommunityRepository:
    """Fixed endpoints only, with bounded transport and no credential logging."""

    def __init__(self, url, key, *, transport=None):
        self.url = str(url or '').rstrip('/')
        self.key = str(key or '')
        self.transport = transport or requests

    def _json(self, response, unavailable):
        try:
            if len(response.content) > 512_000:
                raise ValueError('response too large')
            return response.json()
        except Exception:
            raise CommunityError(unavailable) from None

    def verify_user(self, token):
        if not self.url or not self.key:
            raise CommunityError('auth_unavailable')
        try:
            response = self.transport.get(
                self.url + '/auth/v1/user',
                headers={'apikey': self.key, 'Authorization': 'Bearer ' + token},
                timeout=(2, 5), allow_redirects=False)
        except Exception:
            raise CommunityError('auth_unavailable') from None
        if response.status_code in (400, 401, 403):
            raise CommunityError('auth_required')
        if response.status_code != 200:
            raise CommunityError('auth_unavailable')
        user = self._json(response, 'auth_unavailable')
        try:
            if not isinstance(user, dict) or not isinstance(user.get('id'), str):
                raise ValueError('missing user')
            return str(uuid.UUID(user['id']))
        except (ValueError, TypeError, AttributeError):
            raise CommunityError('auth_unavailable') from None

    def call(self, action, actor=None, data=None):
        if not self.url or not self.key:
            raise CommunityError('storage_unavailable')
        try:
            response = self.transport.post(
                self.url + '/rest/v1/rpc/' + RPC_NAME,
                headers={'apikey': self.key, 'Authorization': 'Bearer ' + self.key,
                         'Content-Type': 'application/json'},
                json={'p_action': action, 'p_actor': actor, 'p_data': data or {}},
                timeout=(2, 8), allow_redirects=False)
        except Exception:
            raise CommunityError('storage_unavailable') from None
        if response.status_code != 200:
            # Missing migration, denied RPC, database failures: never an empty feed.
            raise CommunityError('storage_unavailable')
        result = self._json(response, 'storage_unavailable')
        if not isinstance(result, dict) or not isinstance(result.get('ok'), bool):
            raise CommunityError('storage_unavailable')
        if not result['ok']:
            raise CommunityError(result.get('reason'), result.get('retry_after'))
        return result


def _integer(value, reason, *, optional=False):
    if optional and value is None:
        return None
    if isinstance(value, bool):
        raise CommunityError(reason)
    if isinstance(value, str):
        if not re.fullmatch(r'[1-9][0-9]{0,15}', value):
            raise CommunityError(reason)
        value = int(value)
    if not isinstance(value, int) or not 1 <= value <= MAX_ID:
        raise CommunityError(reason)
    return value


def _payload():
    if (request.content_length is not None and request.content_length > MAX_REQUEST_BYTES
            or request.mimetype != 'application/json'):
        raise CommunityError('invalid_request')
    raw = request.stream.read(MAX_REQUEST_BYTES + 1)
    if len(raw) > MAX_REQUEST_BYTES:
        raise CommunityError('invalid_request')
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeError):
        raise CommunityError('invalid_request') from None
    if not isinstance(data, dict):
        raise CommunityError('invalid_request')
    return data


def _text(value, reason):
    if not isinstance(value, str) or any(ord(c) < 32 and c not in '\n\t' for c in value):
        raise CommunityError(reason)
    return value.strip()


def _public_post(raw, actor):
    """Whitelist all public fields, including responses from a future RPC version."""
    if not isinstance(raw, dict):
        raise CommunityError('storage_unavailable')
    try:
        post_id = _integer(raw.get('id'), 'storage_unavailable')
        parent = _integer(raw.get('parent_id'), 'storage_unavailable', optional=True)
        name, body = raw['name'], raw['body']
        if not (isinstance(name, str) and 1 <= len(name) <= 20
                and isinstance(body, str) and 1 <= len(body) <= 200
                and raw.get('category') in CATEGORIES and raw.get('language') in LANGUAGES):
            raise ValueError('bad post')
        created = raw['created_at']
        stamp = datetime.fromisoformat(created.replace('Z', '+00:00')) if isinstance(created, str) else None
        if stamp is None or stamp.tzinfo is None:
            raise ValueError('missing timestamp')
        counts = {key: raw[key] for key in ('reply_count', 'like_count')}
        if any(isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= MAX_ID
               for value in counts.values()):
            raise ValueError('bad count')
        return dict(id=post_id, name=name, body=body, category=raw['category'],
                    language=raw['language'], created_at=created, parent_id=parent,
                    **counts, is_mine=bool(actor) and raw.get('is_mine') is True,
                    liked_by_me=bool(actor) and raw.get('liked_by_me') is True)
    except (KeyError, ValueError, TypeError, OverflowError):
        raise CommunityError('storage_unavailable') from None


def create_community_blueprint(supabase_url, supabase_key, *, repository=None, check_admin=None):
    """``repository`` is an offline test seam; no process-local post storage."""
    repo = repository or SupabaseCommunityRepository(supabase_url, supabase_key)
    blueprint = Blueprint('world_community', __name__)

    def actor(required=False):
        header = request.headers.get('Authorization', '')
        if not header:
            if required:
                raise CommunityError('auth_required')
            return None
        if (not header.startswith('Bearer ') or not 1 <= len(header[7:]) <= 8192
                or any(ord(c) <= 32 or ord(c) >= 127 for c in header[7:])):
            raise CommunityError('auth_required')
        try:
            return repo.verify_user(header[7:])
        except CommunityError:
            raise
        except Exception:
            raise CommunityError('auth_unavailable') from None

    def operation(action, owner=None, data=None):
        try:
            value = repo.call(action, owner, data or {})
        except CommunityError:
            raise
        except Exception:
            raise CommunityError('storage_unavailable') from None
        if not isinstance(value, dict) or value.get('ok') is not True:
            if isinstance(value, dict) and value.get('ok') is False:
                raise CommunityError(value.get('reason'), value.get('retry_after'))
            raise CommunityError('storage_unavailable')
        return value

    def feed(value, owner, cap):
        if (not isinstance(value.get('posts'), list) or len(value['posts']) > cap
                or not isinstance(value.get('has_more'), bool)):
            raise CommunityError('storage_unavailable')
        posts = [_public_post(post, owner) for post in value['posts']]
        cursor = _integer(value.get('next_cursor'), 'storage_unavailable', optional=True)
        if value['has_more'] and (not posts or cursor != posts[-1]['id']):
            raise CommunityError('storage_unavailable')
        return jsonify(ok=True, posts=posts, has_more=value['has_more'], next_cursor=cursor)

    @blueprint.errorhandler(CommunityError)
    def failed(error):
        payload = {'ok': False, 'reason': error.reason}
        retry = error.retry_after
        if error.reason == 'rate_limited' and isinstance(retry, int) and not isinstance(retry, bool):
            payload['retry_after'] = min(10, max(1, retry))
        response = jsonify(payload)
        response.status_code = ERROR_STATUSES[error.reason]
        if 'retry_after' in payload:
            response.headers['Retry-After'] = str(payload['retry_after'])
        return response

    @blueprint.after_request
    def private_response(response):
        response.headers['Cache-Control'] = 'no-store'
        return response

    @blueprint.route('/api/community/posts', methods=['GET', 'POST'])
    def posts():
        owner = actor(request.method == 'POST')
        if request.method == 'GET':
            category = request.args.get('category', 'all')
            if category != 'all' and category not in CATEGORIES:
                raise CommunityError('invalid_category')
            before = _integer(request.args.get('before'), 'invalid_cursor', optional=True)
            limit = _integer(request.args.get('limit', '20'), 'invalid_request')
            if limit > 20:
                raise CommunityError('invalid_request')
            return feed(operation('list', owner, dict(category=category, before=before, limit=limit)), owner, limit)
        data = _payload()
        body = _text(data.get('body'), 'empty')
        if not body:
            raise CommunityError('empty')
        if len(body) > 200:
            raise CommunityError('too_long')
        name = _text(data.get('name', ''), 'invalid_name') or '名無しさん'
        if len(name) > 20:
            raise CommunityError('invalid_name')
        category, language = data.get('category'), data.get('language', 'other')
        if not isinstance(category, str) or category not in CATEGORIES:
            raise CommunityError('invalid_category')
        if not isinstance(language, str) or language not in LANGUAGES:
            raise CommunityError('invalid_language')
        parent = _integer(data.get('parent_id'), 'invalid_parent', optional=True)
        try:
            raw_id = data.get('request_id')
            if not isinstance(raw_id, str):
                raise ValueError('missing request id')
            request_id = str(uuid.UUID(raw_id))
        except (ValueError, TypeError, AttributeError):
            raise CommunityError('invalid_request_id') from None
        value = operation('create', owner, dict(name=name, body=body, category=category,
                                               language=language, parent_id=parent, request_id=request_id))
        return jsonify(ok=True, post=_public_post(value.get('post'), owner))

    @blueprint.get('/api/community/posts/<int:post_id>/replies')
    def replies(post_id):
        _integer(post_id, 'invalid_parent')
        owner = actor()
        after = _integer(request.args.get('after'), 'invalid_cursor', optional=True)
        limit = _integer(request.args.get('limit', '50'), 'invalid_request')
        if limit > 50:
            raise CommunityError('invalid_request')
        return feed(operation('replies', owner, dict(post_id=post_id, after=after, limit=limit)), owner, limit)

    @blueprint.delete('/api/community/posts/<int:post_id>')
    def delete(post_id):
        _integer(post_id, 'invalid_parent')
        operation('delete', actor(True), {'post_id': post_id})
        return jsonify(ok=True)

    @blueprint.post('/api/community/posts/<int:post_id>/report')
    def report(post_id):
        _integer(post_id, 'invalid_parent')
        owner = actor(True)
        reason = _payload().get('reason')
        if not isinstance(reason, str) or reason not in REPORT_REASONS:
            raise CommunityError('invalid_reason')
        operation('report', owner, dict(post_id=post_id, reason=reason))
        return jsonify(ok=True)

    @blueprint.post('/api/community/posts/<int:post_id>/like')
    def like(post_id):
        _integer(post_id, 'invalid_parent')
        owner = actor(True)
        liked = _payload().get('liked')
        if not isinstance(liked, bool):
            raise CommunityError('invalid_request')
        value = operation('like', owner, dict(post_id=post_id, liked=liked))
        count = value.get('like_count')
        if (value.get('liked') is not liked or isinstance(count, bool)
                or not isinstance(count, int) or not 0 <= count <= MAX_ID):
            raise CommunityError('storage_unavailable')
        return jsonify(ok=True, liked=liked, like_count=count)

    if check_admin is not None:
        def require_admin():
            # This new interface accepts the administrator secret only in a
            # header. The legacy callback's body/query fallback must not consume
            # the JSON payload or put a secret in a URL.
            header = request.headers.get('X-Admin-Pass', '')
            if not header or len(header) > 1024:
                raise CommunityError('forbidden')
            try:
                allowed = check_admin(request)
            except Exception:
                allowed = False
            if not allowed:
                raise CommunityError('forbidden')

        @blueprint.get('/api/community/moderation/reports')
        def reports():
            require_admin()
            value = operation('report_list', data={'limit': 50})
            rows = value.get('reports')
            if not isinstance(rows, list) or len(rows) > 50:
                raise CommunityError('storage_unavailable')
            clean = []
            for row in rows:
                if (not isinstance(row, dict) or not isinstance(row.get('reason'), str)
                        or row['reason'] not in REPORT_REASONS):
                    raise CommunityError('storage_unavailable')
                raw_post = row.get('post')
                if (not isinstance(raw_post, dict) or not isinstance(raw_post.get('hidden'), bool)
                        or not isinstance(raw_post.get('deleted'), bool)):
                    raise CommunityError('storage_unavailable')
                safe = _public_post(dict(raw_post, parent_id=None, reply_count=0, like_count=0), None)
                post_id = _integer(row.get('post_id'), 'storage_unavailable')
                if safe['id'] != post_id:
                    raise CommunityError('storage_unavailable')
                clean.append(dict(id=_integer(row.get('id'), 'storage_unavailable'), post_id=post_id,
                                  reason=row['reason'], created_at=row.get('created_at'),
                                  post={**{key:safe[key] for key in ('id','name','body','category','language','created_at')},
                                        'hidden':raw_post['hidden'], 'deleted':raw_post['deleted']}))
            return jsonify(ok=True, reports=clean)

        @blueprint.post('/api/community/posts/<int:post_id>/moderate')
        def moderate(post_id):
            _integer(post_id, 'invalid_parent')
            require_admin()
            hidden = _payload().get('hidden')
            if not isinstance(hidden, bool):
                raise CommunityError('invalid_request')
            operation('moderate', data=dict(post_id=post_id, hidden=hidden))
            return jsonify(ok=True)

    return blueprint


def register_community_routes(app, supabase_url, supabase_key, **options):
    app.register_blueprint(create_community_blueprint(supabase_url, supabase_key, **options))

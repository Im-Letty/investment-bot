"""Private guest-owned ledgers; ownership comes only from verified Auth."""
import json
import re
from flask import Blueprint, request, jsonify
from community_api import SupabaseCommunityRepository, CommunityError

KEY = re.compile(r'^(?:kb2(?:_[A-Za-z0-9_-]+)?|kbday_[A-Za-z0-9_-]+|kk_custom_cats|pg_kakeibo_day)$')
MAX_BYTES = 2_000_000

def create_ledger_blueprint(url, key, *, repository=None):
    repo = repository or SupabaseCommunityRepository(url, key)
    bp = Blueprint('private_ledger', __name__)

    def owner():
        h = request.headers.get('Authorization', '')
        if not h.startswith('Bearer ') or not 1 <= len(h[7:]) <= 8192 or any(ord(c) <= 32 or ord(c) >= 127 for c in h[7:]):
            raise CommunityError('auth_required')
        return repo.verify_user(h[7:])

    def storage(method, actor, data=None):
        headers = {'apikey': repo.key, 'Authorization': 'Bearer ' + repo.key}
        kwargs = dict(headers=headers, timeout=(2, 8), allow_redirects=False)
        endpoint = repo.url + '/rest/v1/private_household_ledgers'
        if method == 'get':
            kwargs['params'] = {'owner_id': 'eq.' + actor, 'select': 'data'}
        else:
            kwargs['params'] = {'on_conflict': 'owner_id'}
            headers['Prefer'] = 'resolution=merge-duplicates,return=minimal'
            kwargs['json'] = {'owner_id': actor, 'data': data}
        try:
            result = getattr(repo.transport, method)(endpoint, **kwargs)
            if result.status_code not in (200, 201, 204):
                raise ValueError()
            if method == 'get':
                rows = result.json()
                if not isinstance(rows, list) or len(rows) > 1:
                    raise ValueError()
                return rows[0]['data'] if rows else None
        except Exception:
            raise CommunityError('storage_unavailable') from None

    @bp.errorhandler(CommunityError)
    def error(e):
        return jsonify(error=e.reason), {'auth_required':401, 'auth_unavailable':503, 'invalid_request':400}.get(e.reason,503)

    @bp.after_request
    def private(response):
        response.headers['Cache-Control'] = 'no-store'
        return response

    @bp.route('/api/kakeibo/load')
    def load():
        actor = owner()
        if request.args:
            raise CommunityError('invalid_request')
        return jsonify(data=storage('get', actor))

    @bp.route('/api/kakeibo/save', methods=['POST'])
    def save():
        actor = owner()
        if request.mimetype != 'application/json' or (request.content_length or 0) > MAX_BYTES:
            raise CommunityError('invalid_request')
        raw = request.stream.read(MAX_BYTES + 1)
        try:
            body = json.loads(raw)
            data = body['data']
            if len(raw) > MAX_BYTES or set(body) != {'data'} or not isinstance(data, dict) or len(data) > 5000:
                raise ValueError()
            for k,v in data.items():
                if not KEY.fullmatch(k) or not isinstance(v, str):
                    raise ValueError()
        except (ValueError, KeyError, TypeError):
            raise CommunityError('invalid_request') from None
        storage('post', actor, data)
        return jsonify(ok=True)
    return bp

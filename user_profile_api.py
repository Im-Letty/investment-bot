"""Self-profile saves bound to one frozen caller token, never an admin user ID.

Only the public display-profile namespace is updated through Auth's self-user
endpoint. This adapter does not create accounts, alter login settings, expose
private metadata, or follow redirects. No remote error body is logged or returned.
"""

import json
import unicodedata
import uuid

from flask import Blueprint, jsonify, request
import requests

MAX_JSON_BYTES = 4096
MAX_AUTH_BYTES = 8192
MAX_RESPONSE_BYTES = 65536
PROFILE_KEY = 'kn_profile_v1'
AVATARS = frozenset(('leaf', 'star', 'flower', 'moon', 'sun'))
ERROR_STATUSES = {
    'invalid_request': 400, 'invalid_name': 400, 'invalid_bio': 400,
    'invalid_avatar': 400, 'login_required': 401, 'account_changed': 409,
    'auth_unavailable': 503, 'storage_unavailable': 503,
}
# ECMAScript trim whitespace, matching the browser profile's normalizer.
TRIM_CHARACTERS = ''.join(chr(c) for c in (
    *range(9, 14), 32, 160, 5760, *range(8192, 8203), 8232, 8233,
    8239, 8287, 12288, 65279))
BIDI_CONTROLS = frozenset((*range(0x202a, 0x202f), *range(0x2066, 0x206a)))


class ProfileError(Exception):
    def __init__(self, reason, retry_after=None):
        self.reason = reason if reason in ERROR_STATUSES else 'storage_unavailable'
        self.retry_after = retry_after
        super().__init__(self.reason)


def normalize_profile(value):
    if not isinstance(value, dict) or set(value) != {'username', 'bio', 'avatar'}:
        raise ProfileError('invalid_request')
    name, bio, avatar = (value.get(k) for k in ('username', 'bio', 'avatar'))
    if not isinstance(name, str):
        raise ProfileError('invalid_name')
    if not isinstance(bio, str):
        raise ProfileError('invalid_bio')
    name = name.strip(TRIM_CHARACTERS)
    bio = bio.replace('\r\n', '\n').replace('\r', '\n').strip(TRIM_CHARACTERS)
    if len(name) > 20 or any(unicodedata.category(c) in ('Cc', 'Cs')
                              or ord(c) in BIDI_CONTROLS for c in name):
        raise ProfileError('invalid_name')
    if len(bio) > 160 or any(unicodedata.category(c) in ('Cc', 'Cs')
                               and c != '\n' for c in bio):
        raise ProfileError('invalid_bio')
    if not isinstance(avatar, str) or avatar not in AVATARS:
        raise ProfileError('invalid_avatar')
    return dict(username=name, bio=bio, avatar=avatar)


def _unique_object(pairs):
    result = {}
    for name, value in pairs:
        if name in result:
            raise ValueError('duplicate')
        result[name] = value
    return result


def _reject_constant(_value):
    raise ValueError('constant')


def _json_bytes(raw, reason):
    try:
        if not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_RESPONSE_BYTES:
            raise ValueError('size')
        return json.loads(raw.decode('utf-8'), object_pairs_hook=_unique_object,
                          parse_constant=_reject_constant)
    except Exception:
        raise ProfileError(reason) from None


def _payload():
    if (request.mimetype != 'application/json'
            or request.content_length is not None and request.content_length > MAX_JSON_BYTES):
        raise ProfileError('invalid_request')
    try:
        raw = request.stream.read(MAX_JSON_BYTES + 1)
    except Exception:
        raise ProfileError('invalid_request') from None
    if len(raw) > MAX_JSON_BYTES:
        raise ProfileError('invalid_request')
    return normalize_profile(_json_bytes(raw, 'invalid_request'))


def _bearer():
    header = request.headers.get('Authorization', '')
    if not header.startswith('Bearer '):
        raise ProfileError('login_required')
    token = header[7:]
    if not 1 <= len(token) <= MAX_AUTH_BYTES or any(not 33 <= ord(c) <= 126 for c in token):
        raise ProfileError('login_required')
    return token


def _owner(value):
    try:
        if (not isinstance(value, dict) or value.get('is_anonymous') is not False
                or not isinstance(value.get('id'), str)):
            raise ValueError('user')
        owner = uuid.UUID(value['id'])
        if owner.int == 0:
            raise ValueError('user')
        return str(owner)
    except Exception:
        raise ProfileError('login_required') from None


class SelfProfileRepository:
    def __init__(self, url, key, *, transport=None):
        self.endpoint = str(url or '').rstrip('/') + '/auth/v1/user'
        self.configured = bool(url and key)
        self.key = str(key or '')
        self.transport = transport or requests

    def _call(self, method, token, *, profile=None):
        reason = 'auth_unavailable' if method == 'get' else 'storage_unavailable'
        if not self.configured:
            raise ProfileError(reason)
        # Both requests use this same supplied token. There is no shared SDK
        # session, target-user input, service-role Authorization, or admin URL.
        headers = {'apikey': self.key, 'Authorization': 'Bearer ' + token,
                   'Accept': 'application/json'}
        options = dict(headers=headers, timeout=(2, 5 if method == 'get' else 8),
                       allow_redirects=False, stream=True)
        if method == 'put':
            options['json'] = {'data': {PROFILE_KEY: profile}}
        response = None
        try:
            response = getattr(self.transport, method)(self.endpoint, **options)
            if response.status_code in (401, 403):
                raise ProfileError('login_required')
            if method == 'get' and response.status_code == 400:
                raise ProfileError('login_required')
            if response.status_code != 200:
                retry = response.headers.get('Retry-After', '') if response.status_code == 429 else ''
                retry = int(retry) if isinstance(retry, str) and retry.isascii() and retry.isdigit() and len(retry) <= 5 else None
                raise ProfileError(reason, retry if retry is not None and 1 <= retry <= 86400 else None)
            chunks, length = [], 0
            for chunk in response.iter_content(chunk_size=4096):
                if not isinstance(chunk, bytes):
                    raise ProfileError(reason)
                length += len(chunk)
                if length > MAX_RESPONSE_BYTES:
                    raise ProfileError(reason)
                chunks.append(chunk)
            return _json_bytes(b''.join(chunks), reason)
        except ProfileError:
            raise
        except Exception:
            raise ProfileError(reason) from None
        finally:
            if response is not None:
                try:
                    response.close()
                except Exception:
                    pass

    def save(self, token, profile):
        # token is an immutable request-local string. A browser account change
        # while these calls run cannot choose a different write target.
        verified = self._call('get', token)
        owner = _owner(verified)
        result = self._call('put', token, profile=profile)
        try:
            result_owner = _owner(result)
        except ProfileError:
            raise ProfileError('account_changed') from None
        if result_owner != owner:
            raise ProfileError('account_changed')
        metadata = result.get('user_metadata')
        saved = metadata.get(PROFILE_KEY) if isinstance(metadata, dict) else None
        if saved != profile:
            raise ProfileError('storage_unavailable')
        return dict(ok=True, user_id=owner, profile=dict(profile))


def create_user_profile_blueprint(supabase_url, supabase_key, *, repository=None, transport=None):
    repo = repository or SelfProfileRepository(supabase_url, supabase_key, transport=transport)
    bp = Blueprint('website_user_profile', __name__)

    @bp.after_request
    def private_response(response):
        response.headers['Cache-Control'] = 'no-store'
        return response

    @bp.errorhandler(ProfileError)
    def profile_error(error):
        response = jsonify(ok=False, reason=error.reason)
        response.status_code = ERROR_STATUSES[error.reason]
        if error.retry_after is not None:
            response.headers['Retry-After'] = str(error.retry_after)
        return response

    @bp.put('/api/user-profile')
    def save_profile():
        token = _bearer()
        profile = _payload()
        return jsonify(repo.save(token, profile))

    return bp

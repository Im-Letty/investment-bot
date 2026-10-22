"""Self-profile saves bound to one frozen caller token, never an admin user ID.

Only the public display-profile namespace is updated through Auth's self-user
endpoint. This adapter does not create accounts, alter login settings, expose
private metadata, or follow redirects. No remote error body is logged or returned.
"""

import base64
import hashlib
import io
import json
import re
import time
import unicodedata
import uuid
import warnings

from flask import Blueprint, Response, jsonify, request
from PIL import Image, ImageOps
import requests

MAX_JSON_BYTES = 73728
MAX_AUTH_BYTES = 8192
MAX_RESPONSE_BYTES = 65536
MAX_AVATAR_BYTES = 49152
MAX_AVATAR_DIMENSION = 256
MAX_AVATAR_BASE64 = ((MAX_AVATAR_BYTES + 2) // 3) * 4
AVATAR_DATA_PREFIX = 'data:image/jpeg;base64,'
AVATAR_BUCKET = 'website-profile-avatars'
AVATAR_REFERENCE = re.compile(r'[0-9a-f]{64}\Z')
PROFILE_KEY = 'kn_profile_v1'
AVATARS = frozenset(('leaf', 'star', 'flower', 'moon', 'sun'))
ERROR_STATUSES = {
    'invalid_request': 400, 'invalid_name': 400, 'invalid_bio': 400,
    'invalid_avatar': 400, 'login_required': 401, 'account_changed': 409,
    'auth_unavailable': 503, 'storage_unavailable': 503,
    'invalid_avatar_image': 400, 'avatar_not_found': 404,
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
    required = {'username', 'bio', 'avatar'}
    if (not isinstance(value, dict) or not required.issubset(value)
            or set(value) - required - {'avatar_image'}):
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
    result = dict(username=name, bio=bio, avatar=avatar)
    if 'avatar_image' in value:
        image = value['avatar_image']
        if not isinstance(image, str):
            raise ProfileError('invalid_avatar_image')
        if image and not AVATAR_REFERENCE.fullmatch(image):
            if (not image.startswith(AVATAR_DATA_PREFIX)
                    or len(image) > len(AVATAR_DATA_PREFIX) + MAX_AVATAR_BASE64):
                raise ProfileError('invalid_avatar_image')
            # Reject noncanonical base64 before any Auth or Storage request.
            _avatar_bytes(image)
        result['avatar_image'] = image
    return result


def _avatar_bytes(value):
    try:
        encoded = value[len(AVATAR_DATA_PREFIX):]
        raw = base64.b64decode(encoded, validate=True)
        if (not 0 < len(raw) <= MAX_AVATAR_BYTES
                or base64.b64encode(raw).decode('ascii') != encoded):
            raise ValueError('image')
        return raw
    except Exception:
        raise ProfileError('invalid_avatar_image') from None


def _canonical_jpeg(value):
    """Bound decoding before pixels load, then remove all source metadata."""
    raw = _avatar_bytes(value)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                if (source.format != 'JPEG' or getattr(source, 'n_frames', 1) != 1
                        or not all(1 <= dimension <= MAX_AVATAR_DIMENSION
                                   for dimension in source.size)):
                    raise ValueError('image')
                source.load()
                rotated = ImageOps.exif_transpose(source).convert('RGB')
                clean = Image.new('RGB', rotated.size)
                clean.paste(rotated)
                output = io.BytesIO()
                clean.save(output, format='JPEG', quality=85, optimize=True,
                           progressive=False, subsampling=2)
                result = output.getvalue()
                if not 0 < len(result) <= MAX_AVATAR_BYTES:
                    raise ValueError('image')
                return result
    except Exception:
        raise ProfileError('invalid_avatar_image') from None


def _profile_metadata(user):
    metadata = user.get('user_metadata') if isinstance(user, dict) else None
    return metadata.get(PROFILE_KEY) if isinstance(metadata, dict) else None


def _stored_reference(user):
    profile = _profile_metadata(user)
    value = profile.get('avatar_image') if isinstance(profile, dict) else None
    return value if isinstance(value, str) and AVATAR_REFERENCE.fullmatch(value) else ''


def _unique_object(pairs):
    result = {}
    for name, value in pairs:
        if name in result:
            raise ValueError('duplicate')
        result[name] = value
    return result


def _reject_constant(_value):
    raise ValueError('constant')


def _json_bytes(raw, reason, maximum=MAX_RESPONSE_BYTES):
    try:
        if not isinstance(raw, bytes) or not 0 < len(raw) <= maximum:
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
    return normalize_profile(_json_bytes(raw, 'invalid_request', MAX_JSON_BYTES))


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
        self.url = str(url or '').rstrip('/')
        self.endpoint = self.url + '/auth/v1/user'
        self.configured = bool(url and key)
        self.key = str(key or '')
        self.transport = transport or requests

    def _call(self, method, token, *, profile=None):
        reason = 'auth_unavailable' if method == 'get' else 'storage_unavailable'
        if not self.configured:
            raise ProfileError(reason)
        # Auth requests always use this same supplied token, never a service
        # credential, shared SDK session, caller-selected user ID or admin URL.
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

    def _storage_headers(self):
        return {'apikey': self.key, 'Authorization': 'Bearer ' + self.key,
                'Accept': 'image/jpeg', 'Accept-Encoding': 'identity'}

    def _read_avatar(self, owner, reference):
        response = None
        started = time.monotonic()
        try:
            response = self.transport.get(
                self.url + '/storage/v1/object/' + AVATAR_BUCKET + '/' + owner + '/' + reference + '.jpg',
                headers=self._storage_headers(), timeout=(2, 5), allow_redirects=False, stream=True)
            if response.status_code == 404:
                raise ProfileError('avatar_not_found')
            if response.status_code != 200:
                raise ProfileError('storage_unavailable')
            if response.headers.get('Content-Type', '').split(';', 1)[0].strip().lower() != 'image/jpeg':
                raise ProfileError('storage_unavailable')
            content_length = response.headers.get('Content-Length')
            if content_length is not None and (not isinstance(content_length, str)
                    or not content_length.isascii() or not content_length.isdigit()
                    or len(content_length) > 5 or not 0 < int(content_length) <= MAX_AVATAR_BYTES):
                raise ProfileError('storage_unavailable')
            if response.headers.get('Content-Encoding', 'identity').lower() not in ('', 'identity'):
                raise ProfileError('storage_unavailable')
            chunks, length = [], 0
            for chunk in response.iter_content(chunk_size=4096):
                if not isinstance(chunk, bytes) or time.monotonic() - started > 10:
                    raise ProfileError('storage_unavailable')
                length += len(chunk)
                if length > MAX_AVATAR_BYTES:
                    raise ProfileError('storage_unavailable')
                chunks.append(chunk)
            raw = b''.join(chunks)
            if (not raw or content_length is not None and int(content_length) != len(raw)
                    or hashlib.sha256(raw).hexdigest() != reference):
                raise ProfileError('storage_unavailable')
            # Only our normalized JPEG is expected, but never return corrupted
            # or wrongly typed pre-existing data through an image endpoint.
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter('error', Image.DecompressionBombWarning)
                    with Image.open(io.BytesIO(raw)) as source:
                        if (source.format != 'JPEG' or getattr(source, 'n_frames', 1) != 1
                                or not all(1 <= size <= MAX_AVATAR_DIMENSION for size in source.size)):
                            raise ValueError('image')
                        source.load()
            except Exception:
                raise ProfileError('storage_unavailable') from None
            return raw
        except ProfileError:
            raise
        except Exception:
            raise ProfileError('storage_unavailable') from None
        finally:
            if response is not None:
                try:
                    response.close()
                except Exception:
                    pass

    def _upload_avatar(self, owner, reference, raw):
        response = None
        try:
            response = self.transport.post(
                self.url + '/storage/v1/object/' + AVATAR_BUCKET + '/' + owner + '/' + reference + '.jpg',
                headers=dict(self._storage_headers(), **{'Content-Type': 'image/jpeg', 'x-upsert': 'false'}),
                data=raw, timeout=(2, 8), allow_redirects=False, stream=True)
            if response.status_code not in (200, 201, 400, 409):
                raise ProfileError('storage_unavailable')
            chunks, length = [], 0
            for chunk in response.iter_content(chunk_size=4096):
                if not isinstance(chunk, bytes):
                    raise ProfileError('storage_unavailable')
                length += len(chunk)
                if length > MAX_RESPONSE_BYTES:
                    raise ProfileError('storage_unavailable')
                chunks.append(chunk)
            if response.status_code in (400, 409):
                # Supabase can report an immutable-object conflict as HTTP400
                # with a JSON409 code. Verify the exact owner/hash bytes before
                # reusing it; another error or a corrupt object is never success.
                if response.status_code == 400:
                    result = _json_bytes(b''.join(chunks), 'storage_unavailable')
                    if (not isinstance(result, dict) or str(result.get('statusCode')) != '409'
                            or result.get('error') != 'Duplicate'):
                        raise ProfileError('storage_unavailable')
                if self._read_avatar(owner, reference) != raw:
                    raise ProfileError('storage_unavailable')
        except ProfileError as error:
            if error.reason == 'avatar_not_found':
                raise ProfileError('storage_unavailable') from None
            raise
        except Exception:
            raise ProfileError('storage_unavailable') from None
        finally:
            if response is not None:
                try:
                    response.close()
                except Exception:
                    pass

    def avatar(self, token):
        user = self._call('get', token)
        owner = _owner(user)
        reference = _stored_reference(user)
        if not reference:
            raise ProfileError('avatar_not_found')
        return self._read_avatar(owner, reference), reference

    def save(self, token, profile):
        # token is an immutable request-local string. A browser account change
        # while these calls run cannot choose a different write target.
        verified = self._call('get', token)
        owner = _owner(verified)
        previous = _stored_reference(verified)
        profile = dict(profile)
        if 'avatar_image' not in profile:
            if previous:
                profile['avatar_image'] = previous
        elif profile['avatar_image'].startswith(AVATAR_DATA_PREFIX):
            raw = _canonical_jpeg(profile['avatar_image'])
            reference = hashlib.sha256(raw).hexdigest()
            self._upload_avatar(owner, reference, raw)
            profile['avatar_image'] = reference
        elif profile['avatar_image'] and profile['avatar_image'] != previous:
            raise ProfileError('invalid_avatar_image')
        # Immutable older images are deliberately retained. Auth metadata has
        # no compare-and-swap, so deleting a superseded hash after readback can
        # race a later request reusing it. Never delete on an uncertain write.
        result = self._call('put', token, profile=profile)
        try:
            result_owner = _owner(result)
        except ProfileError:
            raise ProfileError('account_changed') from None
        if result_owner != owner:
            raise ProfileError('account_changed')
        saved = _profile_metadata(result)
        if saved != profile:
            raise ProfileError('storage_unavailable')
        return dict(ok=True, user_id=owner, profile=dict(profile))


def create_user_profile_blueprint(supabase_url, supabase_key, *, repository=None, transport=None):
    repo = repository or SelfProfileRepository(supabase_url, supabase_key, transport=transport)
    bp = Blueprint('website_user_profile', __name__)

    @bp.after_request
    def private_response(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
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

    @bp.get('/api/user-profile/avatar')
    def profile_avatar():
        # No URL, owner, path, ref or query parameter can select a different
        # account's image. Read the authenticated owner's current ref only.
        if request.args:
            raise ProfileError('invalid_request')
        raw, reference = repo.avatar(_bearer())
        response = Response(raw, content_type='image/jpeg')
        response.headers['X-Avatar-Image'] = reference
        return response

    return bp

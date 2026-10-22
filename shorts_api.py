"""Owner-checked Shorts metadata and bounded private video upload API.

The existing Auth project verifies tokens but this feature creates no login
method, account, key or setting. A dedicated reviewed migration/bucket must be
installed before persistence becomes available; unavailable storage fails closed.
"""

from datetime import datetime
from dataclasses import asdict
import json
import re
import uuid
import unicodedata

from flask import Blueprint, jsonify, make_response, redirect, render_template_string, request
import requests

from shorts_contract import (
    SubmissionError, editorial_metadata, verified_login_owner, youtube_video_id, TOPICS,
)
from shorts_media import MediaError, MAX_FILE_BYTES, inspect_mp4
from shorts_mp4 import normalize_mp4

RPC_NAME = 'website_shorts_operation'
BUCKET = 'website-shorts'
MAX_JSON_BYTES = 8192
MAX_MULTIPART_BYTES = MAX_FILE_BYTES + 16_384
MAX_ID = 9_007_199_254_740_991
OBJECT_PATH = re.compile(r'[0-9a-f-]{36}/[0-9a-f-]{36}\.(?:mp4|mov)')
VIEWER_TEMPLATE = '''<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="origin"><title>{{ post.title if post else '動画を開けません' }} | ショート</title>
<link rel="stylesheet" href="/static/shorts-sharing.css?v=20261022-hybrid1">
<script defer src="/static/shorts-sharing.js?v=20261022-hybrid1"></script></head>
<body class="ks-share-page"><main class="ks-share-viewer">
<header class="ks-share-viewer-head"><a href="/">サイトへ戻る</a><span>ショート</span></header>
{% if post %}
<div class="ks-share-viewer-media">
{% if post.provider == 'upload' %}<video controls playsinline preload="metadata" src="/api/shorts/posts/{{ post.id }}/media" aria-label="{{ post.title }}">このブラウザでは動画を再生できません。</video>
{% else %}<iframe src="https://www.youtube-nocookie.com/embed/{{ post.video_id }}?playsinline=1" title="{{ post.title }}" allow="fullscreen; picture-in-picture" allowfullscreen referrerpolicy="origin"></iframe>{% endif %}
</div><section class="ks-share-viewer-info"><h1>{{ post.title }}</h1>
{% if post.author_name %}<p class="ks-share-viewer-author">{{ post.author_name }}</p>{% endif %}
{% if post.caption %}<p class="ks-share-viewer-caption">{{ post.caption }}</p>{% endif %}
<p class="ks-share-viewer-topic">{{ post.topic }}</p>
<button type="button" class="ks-share-button" data-share-provider="post" data-post-id="{{ post.id }}" data-share-title="{{ post.title }}">共有</button>
</section>
{% else %}<section class="ks-share-viewer-info"><h1>動画を開けません</h1><p role="status">{{ error_message }}</p></section>{% endif %}
</main></body></html>'''
STATUSES = {
    'login_required': 401, 'auth_unavailable': 503, 'storage_unavailable': 503,
    'invalid_request': 400, 'invalid_metadata': 400, 'invalid_request_id': 400,
    'invalid_topic': 400, 'invalid_url': 400, 'invalid_file': 400,
    'unsupported_file': 415, 'file_too_large': 413, 'file_too_long': 400,
    'quota_exceeded': 409, 'request_conflict': 409, 'not_found': 404,
    'rate_limited': 429, 'forbidden': 403, 'post_unavailable': 410,
}


class ShortsError(Exception):
    def __init__(self, reason, retry_after=None):
        self.reason = reason if isinstance(reason, str) and reason in STATUSES else 'storage_unavailable'
        self.retry_after = retry_after


class SupabaseShortsRepository:
    def __init__(self, url, key, *, transport=None):
        self.url, self.key = str(url or '').rstrip('/'), str(key or '')
        self.transport = transport or requests

    def headers(self):
        return {'apikey': self.key, 'Authorization': 'Bearer ' + self.key}

    def _json(self, response, reason='storage_unavailable'):
        try:
            if len(response.content) > 512_000:
                raise ValueError('large response')
            return response.json()
        except Exception:
            raise ShortsError(reason) from None

    def verify_login(self, token):
        if not self.url or not self.key:
            raise ShortsError('auth_unavailable')
        try:
            response = self.transport.get(self.url + '/auth/v1/user',
                headers={'apikey': self.key, 'Authorization': 'Bearer ' + token},
                timeout=(2, 5), allow_redirects=False)
        except Exception:
            raise ShortsError('auth_unavailable') from None
        if response.status_code in (400, 401, 403):
            raise ShortsError('login_required')
        if response.status_code != 200:
            raise ShortsError('auth_unavailable')
        try:
            return verified_login_owner(self._json(response, 'auth_unavailable'))
        except SubmissionError:
            raise ShortsError('login_required') from None

    def call(self, action, actor=None, data=None):
        if not self.url or not self.key:
            raise ShortsError('storage_unavailable')
        try:
            response = self.transport.post(self.url + '/rest/v1/rpc/' + RPC_NAME,
                headers=dict(self.headers(), **{'Content-Type': 'application/json'}),
                json={'p_action': action, 'p_actor': actor, 'p_data': data or {}},
                timeout=(2, 8), allow_redirects=False)
        except Exception:
            raise ShortsError('storage_unavailable') from None
        if response.status_code != 200:
            raise ShortsError('storage_unavailable')
        result = self._json(response)
        if not isinstance(result, dict) or not isinstance(result.get('ok'), bool):
            raise ShortsError('storage_unavailable')
        if not result['ok']:
            raise ShortsError(result.get('reason'), result.get('retry_after'))
        return result

    def upload(self, path, data, content_type='video/mp4'):
        if not OBJECT_PATH.fullmatch(path) or content_type not in ('video/mp4', 'video/quicktime'):
            raise ShortsError('storage_unavailable')
        try:
            response = self.transport.post(self.url + '/storage/v1/object/' + BUCKET + '/' + path,
                headers=dict(self.headers(), **{'Content-Type': content_type, 'x-upsert': 'false'}),
                data=data, timeout=(2, 30), allow_redirects=False)
        except Exception:
            raise ShortsError('storage_unavailable') from None
        # A retry only reaches the same server-generated path after the RPC has
        # compared the SHA256 and all metadata. Concurrent duplicates are safe.
        if response.status_code in (200, 201):
            return
        if response.status_code in (400, 409):
            result = self._json(response)
            if isinstance(result, dict) and (str(result.get('statusCode')) == '409'
                    or result.get('error') == 'Duplicate'):
                return
        raise ShortsError('storage_unavailable')

    def purge(self, path):
        if not OBJECT_PATH.fullmatch(path):
            raise ShortsError('storage_unavailable')
        try:
            response = self.transport.delete(self.url + '/storage/v1/object/' + BUCKET,
                headers=dict(self.headers(), **{'Content-Type': 'application/json'}),
                json={'prefixes': [path]}, timeout=(2, 8), allow_redirects=False)
        except Exception:
            raise ShortsError('storage_unavailable') from None
        if response.status_code not in (200, 204):
            raise ShortsError('storage_unavailable')

    def signed_url(self, path):
        if not OBJECT_PATH.fullmatch(path):
            raise ShortsError('storage_unavailable')
        try:
            response = self.transport.post(self.url + '/storage/v1/object/sign/' + BUCKET + '/' + path,
                headers=dict(self.headers(), **{'Content-Type': 'application/json'}),
                json={'expiresIn': 300}, timeout=(2, 5), allow_redirects=False)
        except Exception:
            raise ShortsError('storage_unavailable') from None
        if response.status_code != 200:
            raise ShortsError('storage_unavailable')
        value = self._json(response)
        signed = value.get('signedURL') if isinstance(value, dict) else None
        prefix = '/object/sign/' + BUCKET + '/' + path + '?token='
        if not isinstance(signed, str) or not signed.startswith(prefix) or len(signed) > 8192 or any(ord(c) <= 32 for c in signed):
            raise ShortsError('storage_unavailable')
        return self.url + '/storage/v1' + signed


def _integer(value, reason='invalid_request', *, optional=False):
    if optional and value is None:
        return None
    if isinstance(value, str) and re.fullmatch(r'[1-9][0-9]{0,15}', value):
        value = int(value)
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= MAX_ID:
        raise ShortsError(reason)
    return value


def _timestamp(value, *, optional=False):
    if optional and value is None:
        return None
    try:
        if not isinstance(value, str) or len(value) > 64:
            raise ValueError('timestamp')
        if datetime.fromisoformat(value.replace('Z', '+00:00')).tzinfo is None:
            raise ValueError('missing zone')
        return value
    except (ValueError, TypeError):
        raise ShortsError('storage_unavailable') from None


def _post(raw, owner=None, *, private=False):
    if not isinstance(raw, dict):
        raise ShortsError('storage_unavailable')
    post_id = _integer(raw.get('id'), 'storage_unavailable')
    title, caption, topic, provider = (raw.get(key) for key in ('title', 'caption', 'topic', 'provider'))
    if not isinstance(title, str) or not 1 <= len(title) <= 120 or not isinstance(caption, str) or len(caption) > 280 or not isinstance(topic, str) or topic not in TOPICS or not isinstance(provider, str) or provider not in ('youtube', 'upload'):
        raise ShortsError('storage_unavailable')
    published = _timestamp(raw.get('published_at'), optional=private)
    out = dict(id=post_id, title=title, caption=caption, topic=topic, provider=provider,
        created_at=_timestamp(raw.get('created_at')), published_at=published,
        is_mine=bool(owner) and raw.get('is_mine') is True)
    # Only the bounded public snapshot crosses the API boundary. Account
    # metadata, profile details and ownership IDs never enter this projection.
    author_name = raw.get('author_name')
    if author_name is not None:
        if (not isinstance(author_name, str) or not 1 <= len(author_name) <= 20
                or any(unicodedata.category(c) in ('Cc', 'Cs') for c in author_name)):
            raise ShortsError('storage_unavailable')
        out['author_name'] = author_name
    else:
        out['author_name'] = None
    if private:
        state = raw.get('state')
        if state not in ('pending', 'published', 'hidden', 'deleted'):
            raise ShortsError('storage_unavailable')
        out['state'] = state
    if provider == 'youtube':
        if not isinstance(raw.get('video_id'), str) or not re.fullmatch(r'[A-Za-z0-9_-]{11}', raw['video_id']):
            raise ShortsError('storage_unavailable')
        out['video_id'] = raw['video_id']
    else:
        if raw.get('content_type') not in ('video/mp4', 'video/quicktime'):
            raise ShortsError('storage_unavailable')
        out['content_type'] = raw['content_type']
        for key, cap in [('file_bytes', MAX_FILE_BYTES), ('duration_ms', 180_000), ('width', 3840), ('height', 3840)]:
            out[key] = _integer(raw.get(key), 'storage_unavailable')
            if out[key] > cap:
                raise ShortsError('storage_unavailable')
        if published:
            out['media_url'] = '/api/shorts/posts/' + str(post_id) + '/media'
    return out


def create_shorts_blueprint(supabase_url, supabase_key, *, repository=None, check_admin=None, allow_file_uploads=False):
    repo = repository or SupabaseShortsRepository(supabase_url, supabase_key)
    bp = Blueprint('website_shorts', __name__)

    def actor(required=False):
        header = request.headers.get('Authorization', '')
        if not header and not required:
            return None
        if not header.startswith('Bearer ') or not 1 <= len(header[7:]) <= 8192 or any(ord(c) <= 32 or ord(c) >= 127 for c in header[7:]):
            raise ShortsError('login_required')
        try:
            return repo.verify_login(header[7:])
        except ShortsError:
            raise
        except Exception:
            raise ShortsError('auth_unavailable') from None

    def operation(action, owner=None, data=None):
        try:
            value = repo.call(action, owner, data or {})
        except ShortsError:
            raise
        except Exception:
            raise ShortsError('storage_unavailable') from None
        if not isinstance(value, dict) or value.get('ok') is not True:
            if isinstance(value, dict) and value.get('ok') is False:
                raise ShortsError(value.get('reason'), value.get('retry_after'))
            raise ShortsError('storage_unavailable')
        return value

    def safe_path(value, owner=None):
        path = value.get('object_path')
        if not isinstance(path, str) or not OBJECT_PATH.fullmatch(path) or owner and not path.startswith(owner + '/'):
            raise ShortsError('storage_unavailable')
        return path

    def viewer_response(post=None, *, error_message=None, status=200):
        response = make_response(render_template_string(VIEWER_TEMPLATE,
            post=post, error_message=error_message), status)
        response.headers['Content-Security-Policy'] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "media-src 'self' https:; frame-src https://www.youtube-nocookie.com; "
            "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
        # Identify the embedding origin for YouTube without sending query/hash
        # data (or the individual video's path) in subresource referrers.
        response.headers['Referrer-Policy'] = 'origin'
        return response

    def public_post(post_id):
        target = _integer(post_id)
        # Reuse the deployed public-list predicate: visible, complete rows only.
        # The next greater integer is an internal bigint cursor, never a browser
        # number or public identifier. Even MAX_ID + 1 fits PostgreSQL bigint.
        value = operation('list', None, dict(topic='all', limit=1, before=target + 1))
        rows = value.get('posts')
        if not isinstance(rows, list) or len(rows) > 1 or not isinstance(value.get('has_more'), bool):
            raise ShortsError('storage_unavailable')
        cursor = _integer(value.get('next_cursor'), 'storage_unavailable', optional=True)
        if value['has_more'] and (not rows or not isinstance(rows[0], dict) or cursor != rows[0].get('id')):
            raise ShortsError('storage_unavailable')
        if not value['has_more'] and cursor is not None:
            raise ShortsError('storage_unavailable')
        if not rows:
            raise ShortsError('not_found')
        row = rows[0]
        row_id = _integer(row.get('id') if isinstance(row, dict) else None, 'storage_unavailable')
        if row_id > target:
            raise ShortsError('storage_unavailable')
        if row_id != target:
            raise ShortsError('not_found')
        return _post(row)

    @bp.errorhandler(SubmissionError)
    @bp.errorhandler(ShortsError)
    def failed(error):
        reason = error.reason if error.reason in STATUSES else 'storage_unavailable'
        if request.path.startswith('/shorts/'):
            return viewer_response(error_message=(
                'この動画は見つからないか、公開されていません。' if reason == 'not_found'
                else '今は動画を開けません。少し後にもう一度お試しください。'), status=STATUSES[reason])
        payload = dict(ok=False, reason=reason)
        retry = getattr(error, 'retry_after', None)
        if reason == 'rate_limited' and isinstance(retry, int) and not isinstance(retry, bool):
            payload['retry_after'] = max(1, min(10, retry))
        response = jsonify(payload)
        response.status_code = STATUSES[reason]
        if 'retry_after' in payload:
            response.headers['Retry-After'] = str(payload['retry_after'])
        return response

    @bp.after_request
    def no_cache(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    @bp.route('/api/shorts/posts', methods=['GET', 'POST'])
    def posts():
        if request.method == 'GET':
            topic = request.args.get('topic', 'all')
            if topic != 'all' and topic not in TOPICS:
                raise ShortsError('invalid_topic')
            limit = _integer(request.args.get('limit', '20'))
            before = _integer(request.args.get('before'), optional=True)
            if limit > 20:
                raise ShortsError('invalid_request')
            value = operation('list', None, dict(topic=topic, limit=limit, before=before))
            return feed(value, None, limit)
        owner = actor(True)
        if request.mimetype == 'application/json':
            # Existing YouTube feed rows remain readable. New authors submit
            # their recorded/edited file, never an external link.
            raise ShortsError('invalid_request')
        if request.mimetype != 'multipart/form-data' or request.content_length is None:
            raise ShortsError('invalid_request')
        if allow_file_uploads is not True:
            # Explicit enablement follows the current free-plan/capacity and
            # dedicated bucket review. Auth remains required before this gate.
            raise ShortsError('storage_unavailable')
        if request.content_length > MAX_MULTIPART_BYTES:
            raise ShortsError('file_too_large')
        try:
            if set(request.form) - {'request_id', 'title', 'caption', 'topic'} or set(request.files) != {'file'} or any(len(request.form.getlist(key)) != 1 for key in request.form) or len(request.files.getlist('file')) != 1:
                raise ShortsError('invalid_request')
            meta = asdict(editorial_metadata(request.form.to_dict()))
            upload = request.files['file']
            if upload.mimetype not in ('video/mp4', 'video/quicktime', 'application/octet-stream'):
                raise ShortsError('unsupported_file')
            data = upload.stream.read(MAX_FILE_BYTES + 1)
        except ShortsError:
            raise
        except SubmissionError:
            raise
        except Exception:
            raise ShortsError('invalid_request') from None
        if len(data) > MAX_FILE_BYTES:
            raise ShortsError('file_too_large')
        try:
            data = normalize_mp4(data)
            info = asdict(inspect_mp4(data))
        except MediaError as error:
            raise ShortsError(str(error) if str(error) in STATUSES else 'invalid_file') from None
        reservation = operation('reserve_file', owner, dict(meta, **info))
        if reservation.get('published') is True:
            return jsonify(ok=True, post=_post(reservation.get('post'), owner)), 201
        path = safe_path(reservation, owner)
        post_id = _integer(reservation.get('post_id'), 'storage_unavailable')
        try:
            repo.upload(path, data, info['content_type'])
        except Exception:
            # A timed-out remote upload may still commit. Keep its lease and
            # reserved bytes until expiry so delete cannot release quota while
            # that late write is in flight; the same request remains retryable.
            raise ShortsError('storage_unavailable') from None
        value = operation('complete_file', owner, dict(post_id=post_id, sha256=info['sha256']))
        if value.get('cancelled') is True:
            cleanup(value, owner, post_id)
            raise ShortsError('post_unavailable')
        return jsonify(ok=True, post=_post(value.get('post'), owner)), 201

    def feed(value, owner, limit, *, private=False):
        rows = value.get('posts')
        if not isinstance(rows, list) or len(rows) > limit or not isinstance(value.get('has_more'), bool):
            raise ShortsError('storage_unavailable')
        cursor = _integer(value.get('next_cursor'), 'storage_unavailable', optional=True)
        if value['has_more'] and (not rows or cursor != rows[-1].get('id')):
            raise ShortsError('storage_unavailable')
        return jsonify(ok=True, posts=[_post(row, owner, private=private) for row in rows],
                       has_more=value['has_more'], next_cursor=cursor)

    @bp.route('/api/shorts/mine')
    def mine():
        owner = actor(True)
        limit = _integer(request.args.get('limit', '20'))
        before = _integer(request.args.get('before'), optional=True)
        if limit > 20:
            raise ShortsError('invalid_request')
        return feed(operation('mine', owner, dict(limit=limit, before=before)), owner, limit, private=True)

    @bp.route('/api/shorts/posts/<post_id>', methods=['GET'])
    def public_single(post_id):
        return jsonify(ok=True, post=public_post(post_id))

    @bp.route('/shorts/<post_id>', methods=['GET'])
    def public_viewer(post_id):
        return viewer_response(public_post(post_id))

    @bp.route('/api/shorts/posts/<post_id>', methods=['DELETE'])
    def delete(post_id):
        owner = actor(True)
        value = operation('delete', owner, dict(post_id=_integer(post_id)))
        return jsonify(ok=True, cleanup_pending=cleanup(value, owner, _integer(post_id)))

    def cleanup(value, owner, post_id):
        if value.get('object_path') is not None:
            path = safe_path(value, owner)
            try:
                repo.purge(path)
                operation('purged', owner, dict(post_id=post_id))
            except Exception:
                # Feed removal is already durable. The next own delete retries
                # purge; unpurged bytes continue counting towards the quota.
                return True
        return value.get('cleanup_pending') is True

    @bp.route('/api/shorts/cleanup', methods=['POST'])
    def stale_upload_cleanup():
        owner = actor(True)
        value = operation('expired', owner)
        assets = value.get('assets')
        if not isinstance(assets, list) or len(assets) > 2:
            raise ShortsError('storage_unavailable')
        remaining = False
        for item in assets:
            if not isinstance(item, dict):
                raise ShortsError('storage_unavailable')
            post_id = _integer(item.get('post_id'), 'storage_unavailable')
            # The delete operation checks ownership again and waits for active
            # upload leases, so cleanup cannot race an in-progress upload.
            remaining = cleanup(operation('delete', owner, dict(post_id=post_id)), owner, post_id) or remaining
        return jsonify(ok=True, cleanup_pending=remaining)

    @bp.route('/api/shorts/posts/<post_id>/media')
    def media(post_id):
        value = operation('media', None, dict(post_id=_integer(post_id)))
        path = safe_path(value)
        try:
            signed = repo.signed_url(path)
        except ShortsError:
            raise
        except Exception:
            raise ShortsError('storage_unavailable') from None
        return redirect(signed, code=307)

    @bp.route('/api/shorts/admin/posts/<post_id>/visibility', methods=['POST'])
    def moderation(post_id):
        if not request.headers.get('X-Admin-Pass') or not check_admin or not check_admin(request):
            raise ShortsError('forbidden')
        if request.mimetype != 'application/json' or request.content_length is None or request.content_length > 1024:
            raise ShortsError('invalid_request')
        raw = request.stream.read(1025)
        try:
            data = json.loads(raw)
        except (ValueError, UnicodeError):
            raise ShortsError('invalid_request') from None
        if not isinstance(data, dict) or set(data) != {'hidden'} or not isinstance(data['hidden'], bool):
            raise ShortsError('invalid_request')
        operation('moderate', None, dict(post_id=_integer(post_id), hidden=data['hidden']))
        return jsonify(ok=True)

    return bp

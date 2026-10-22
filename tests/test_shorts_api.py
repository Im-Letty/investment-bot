"""Offline auth/media/ownership boundaries, with no live posts or storage calls.

The fake RPC exercises the HTTP protocol. SQL assertions do not prove deployed
schema, actual PostgreSQL locking, remaining storage capacity or media decoding.
"""

from copy import deepcopy
from io import BytesIO
import json
from pathlib import Path
import struct
import unittest

from flask import Flask
from shorts_api import create_shorts_blueprint, ShortsError, SupabaseShortsRepository, MAX_ID
from shorts_contract import SubmissionError, verified_login_owner, youtube_video_id
from shorts_media import inspect_mp4, MediaError, MAX_FILE_BYTES

ALICE = '11111111-1111-4111-8111-111111111111'
BOB = '33333333-3333-4333-8333-333333333333'
REQUEST = '22222222-2222-4222-8222-222222222222'
STAMP = '2026-10-14T11:00:00+00:00'


def atom(kind, payload):
    return struct.pack('>I4s', len(payload) + 8, kind) + payload


def fixture_mp4(*, duration=1000, offset=None, nal=b'\x65\x88\x84', declared_size=None,
                movie_duration=None, track_duration=None, composition_offset=None,
                edit_duration=None, sps_width=640, external_reference=False):
    """Small structural fixture; does not claim that a browser can decode it."""
    ftyp = atom(b'ftyp', b'isom' + struct.pack('>I', 0) + b'isom')
    sample = struct.pack('>I', len(nal)) + nal
    mdat = atom(b'mdat', sample)
    def ue(value):
        binary = bin(value + 1)[2:]
        return '0' * (len(binary) - 1) + binary
    sps_bits = ('01000010' + '00000000' + '00011110' + ue(0) + ue(0) + ue(0) + ue(0)
                + ue(1) + '0' + ue(sps_width // 16 - 1) + ue(22) + '11' + '1'
                + ue(0) + ue(0) + ue(0) + ue(4) + '0' + '1')
    sps_bits += '0' * (-len(sps_bits) % 8)
    sps = b'\x67' + int(sps_bits, 2).to_bytes(len(sps_bits) // 8, 'big')
    pps = b'\x68\xce\x3c\x80'
    avcc = b'\x01\x42\xc0\x1e\xff\xe1' + struct.pack('>H', len(sps)) + sps + b'\x01' + struct.pack('>H', len(pps)) + pps
    visual = bytearray(78)
    struct.pack_into('>H', visual, 6, 1)
    struct.pack_into('>HH', visual, 24, 640, 360)
    stsd = atom(b'stsd', b'\0' * 4 + struct.pack('>I', 1) + atom(b'avc1', bytes(visual) + atom(b'avcC', avcc)))
    stts = atom(b'stts', b'\0' * 4 + struct.pack('>III', 1, 1, duration))
    stsc = atom(b'stsc', b'\0' * 4 + struct.pack('>IIII', 1, 1, 1, 1))
    stsz = atom(b'stsz', b'\0' * 4 + struct.pack('>III', 0, 1, len(sample) if declared_size is None else declared_size))
    stco = atom(b'stco', b'\0' * 4 + struct.pack('>II', 1, len(ftyp) + 8 if offset is None else offset))
    ctts = b'' if composition_offset is None else atom(b'ctts', b'\0' * 4 + struct.pack('>III', 1, 1, composition_offset))
    mdhd = atom(b'mdhd', b'\0' * 12 + struct.pack('>IIHH', 1000, duration, 0, 0))
    hdlr = atom(b'hdlr', b'\0' * 8 + b'vide' + b'\0' * 12)
    reference = b'\0\0\0\0https://evil.invalid/media\0' if external_reference else b'\0\0\0\1'
    dinf = atom(b'dinf', atom(b'dref', b'\0' * 4 + struct.pack('>I', 1) + atom(b'url ', reference)))
    mdia = atom(b'mdia', mdhd + hdlr + atom(b'minf', dinf + atom(b'stbl', stsd + stts + stsc + stsz + stco + ctts)))
    tkhd = bytearray(84)
    struct.pack_into('>I', tkhd, 20, duration if track_duration is None else track_duration)
    struct.pack_into('>II', tkhd, 76, 640 << 16, 360 << 16)
    mvhd = bytearray(100)
    struct.pack_into('>II', mvhd, 12, 1000, duration if movie_duration is None else movie_duration)
    edts = b'' if edit_duration is None else atom(b'edts', atom(b'elst', b'\0' * 4 + struct.pack('>IIihh', 1, edit_duration, 0, 1, 0)))
    return ftyp + mdat + atom(b'moov', atom(b'mvhd', mvhd) + atom(b'trak', atom(b'tkhd', tkhd) + mdia + edts))


def payload(**overrides):
    out = dict(request_id=REQUEST, title='経済の基本', caption='説明', topic='#経済入門',
               url='https://youtu.be/AAAAAAAAAAA')
    out.update(overrides)
    return out


class FakeRepository:
    def __init__(self):
        self.rows, self.requests, self.calls, self.auth_calls, self.uploads, self.purges = {}, {}, [], [], [], []
        self.fail = None
        self.purge_fail = False
        self.upload_fail = False
        self.sign_fail = False
        self.override = None
        self.last_id = 0
        self.profile_names = {}

    def verify_login(self, token):
        self.auth_calls.append(token)
        if token == 'offline':
            raise ShortsError('auth_unavailable')
        users = {'alice': dict(id=ALICE, is_anonymous=False), 'bob': dict(id=BOB, is_anonymous=False),
                 'guest': dict(id=ALICE, is_anonymous=True), 'ambiguous': dict(id=ALICE)}
        try:
            return verified_login_owner(users.get(token))
        except SubmissionError:
            raise ShortsError('login_required') from None

    def public(self, row, actor):
        return dict(deepcopy(row), is_mine=row['owner_id'] == actor,
                    token='private-fixture', email='private@example.invalid',
                    state='deleted' if row.get('deleted') else 'published' if row['published_at'] else 'pending')

    def call(self, action, actor=None, data=None):
        data = data or {}
        self.calls.append((action, actor, deepcopy(data)))
        if self.fail:
            raise self.fail
        if self.override is not None:
            return deepcopy(self.override)
        if action in ('create_youtube', 'reserve_file'):
            key = actor, data['request_id']
            if key in self.requests:
                row = self.rows[self.requests[key]]
                if row.get('deleted'):
                    return dict(ok=False, reason='post_unavailable')
                if row['input'] != data:
                    return dict(ok=False, reason='request_conflict')
                return dict(ok=True, published=bool(row['published_at']), post_id=row['id'], object_path=row['object_path'], post=self.public(row, actor))
            self.last_id += 1
            row = dict(deepcopy(data), id=self.last_id, provider='youtube' if action == 'create_youtube' else 'upload',
                       owner_id=actor, author_name=self.profile_names.get(actor), created_at=STAMP, published_at=STAMP if action == 'create_youtube' else None,
                       object_path=None if action == 'create_youtube' else actor + '/44444444-4444-4444-8444-444444444444.' + ('mov' if data['content_type'] == 'video/quicktime' else 'mp4'), input=deepcopy(data))
            self.rows[row['id']], self.requests[key] = row, row['id']
            return dict(ok=True, published=bool(row['published_at']), post_id=row['id'], object_path=row['object_path'], post=self.public(row, actor))
        if action in ('list', 'mine'):
            rows = [r for r in self.rows.values() if (action == 'mine' and r['owner_id'] == actor)
                    or (action == 'list' and r['published_at'] and not r.get('deleted') and not r.get('hidden')
                        and (data['topic'] == 'all' or r['topic'] == data['topic']))]
            rows = sorted([r for r in rows if not data['before'] or r['id'] < data['before']], key=lambda r:r['id'], reverse=True)
            more = len(rows) > data['limit']
            rows = rows[:data['limit']]
            return dict(ok=True, posts=[self.public(r, actor) for r in rows], has_more=more, next_cursor=rows[-1]['id'] if more else None)
        if action == 'expired':
            return dict(ok=True, assets=[])
        row = self.rows.get(data['post_id'])
        if not row or (action in ('complete_file', 'delete', 'purged') and row['owner_id'] != actor):
            return dict(ok=False, reason='not_found')
        if action == 'complete_file':
            if row.get('deleted'):
                return dict(ok=True, cancelled=True, object_path=row['object_path'])
            row['published_at'] = STAMP
            return dict(ok=True, post=self.public(row, actor))
        if action == 'delete':
            row['deleted'] = True
            return dict(ok=True, object_path=row['object_path'] if not row.get('purged') else None)
        if action == 'purged':
            row['purged'] = True
            return dict(ok=True)
        if action == 'media':
            if not row['published_at'] or row.get('deleted') or row.get('hidden') or row['provider'] != 'upload':
                return dict(ok=False, reason='not_found')
            return dict(ok=True, object_path=row['object_path'])
        if action == 'moderate':
            row['hidden'] = data['hidden']
            return dict(ok=True)
        raise AssertionError(action)

    def upload(self, path, data, content_type):
        self.uploads.append((path, data, content_type))
        if self.upload_fail:
            raise ShortsError('storage_unavailable')

    def purge(self, path):
        self.purges.append(path)
        if self.purge_fail:
            raise ShortsError('storage_unavailable')

    def signed_url(self, path):
        if self.sign_fail:
            raise ShortsError('storage_unavailable')
        return 'https://example.invalid/signed-media'


class ShortsAPITests(unittest.TestCase):
    def setUp(self):
        self.repo = FakeRepository()
        self.app = Flask(__name__)
        self.app.register_blueprint(create_shorts_blueprint('https://fixture.invalid', 'fixture-key', repository=self.repo,
            check_admin=lambda req:req.headers.get('X-Admin-Pass') == 'fixture-admin', allow_file_uploads=True))
        self.client = self.app.test_client()

    def auth(self, owner='alice'):
        return {'Authorization': 'Bearer ' + owner}

    def upload(self, data=None, owner='alice', **changes):
        meta = payload(**changes)
        meta.pop('url')
        meta['file'] = (BytesIO(fixture_mp4() if data is None else data), 'video.mp4', 'video/mp4')
        response = self.client.post('/api/shorts/posts', data=meta, headers=self.auth(owner), content_type='multipart/form-data')
        response.request.environ['wsgi.input'].close()
        return response

    def test_no_login_or_anonymous_identity_cannot_write_or_read_mine(self):
        for token in [None, 'guest', 'ambiguous', 'unverified']:
            headers = {} if token is None else self.auth(token)
            for method, path in [('post', '/api/shorts/posts'), ('delete', '/api/shorts/posts/1'), ('get', '/api/shorts/mine')]:
                response = getattr(self.client, method)(path, json=payload() if method == 'post' else None, headers=headers)
                self.assertEqual(401, response.status_code)
                self.assertEqual('login_required', response.json['reason'])
        self.assertEqual([], self.repo.calls)
        self.assertEqual([], self.repo.uploads)

    def test_public_single_post_reuses_visible_list_and_public_projection_without_auth(self):
        self.repo.profile_names[ALICE] = 'はる'
        self.upload()
        self.repo.calls.clear()
        self.repo.auth_calls.clear()
        result = self.client.get('/api/shorts/posts/1', headers=self.auth('offline'))
        self.assertEqual(200, result.status_code)
        post = result.json['post']
        self.assertEqual(1, post['id'])
        self.assertEqual('はる', post['author_name'])
        self.assertEqual('/api/shorts/posts/1/media', post['media_url'])
        self.assertFalse(post['is_mine'])
        self.assertEqual([('list', None, {'topic': 'all', 'limit': 1, 'before': 2})], self.repo.calls)
        self.assertEqual([], self.repo.auth_calls)
        for private in ['object_path', 'owner_id', 'token', 'email', 'state', 'sha256', 'request_id']:
            self.assertNotIn(private, post)
        self.assertEqual('no-store', result.headers['Cache-Control'])

    def test_public_single_never_substitutes_nearest_post_or_returns_nonpublic_post(self):
        self.upload()
        for path in ['/api/shorts/posts/2', '/shorts/2']:
            self.assertEqual(404, self.client.get(path).status_code)
        for state in ['pending', 'hidden', 'deleted']:
            with self.subTest(state=state):
                row = self.repo.rows[1]
                row.update(published_at=None if state == 'pending' else STAMP,
                           hidden=state == 'hidden', deleted=state == 'deleted')
                for path in ['/api/shorts/posts/1', '/shorts/1']:
                    response = self.client.get(path)
                    self.assertEqual(404, response.status_code)
                    self.assertNotIn('/api/shorts/posts/1/media', response.get_data(as_text=True))
                    self.assertEqual('no-store', response.headers['Cache-Control'])

    def test_public_single_invalid_ids_fail_before_any_repository_or_auth_call(self):
        for post_id in ['0', '-1', '01', '1.0', 'NaN', 'true', str(MAX_ID + 1), '9' * 100]:
            with self.subTest(post_id=post_id):
                for prefix in ['/api/shorts/posts/', '/shorts/']:
                    self.assertEqual(400, self.client.get(prefix + post_id).status_code)
        self.assertEqual([], self.repo.calls)
        self.assertEqual([], self.repo.auth_calls)

    def test_public_single_max_safe_id_uses_exact_internal_bigint_cursor(self):
        self.upload()
        row = self.repo.rows.pop(1)
        row['id'] = MAX_ID
        self.repo.rows[MAX_ID] = row
        result = self.client.get('/api/shorts/posts/' + str(MAX_ID))
        self.assertEqual(200, result.status_code)
        self.assertEqual(MAX_ID, result.json['post']['id'])
        self.assertEqual(MAX_ID + 1, self.repo.calls[-1][2]['before'])

    def test_public_single_malformed_repository_responses_fail_closed(self):
        self.upload()
        row = self.repo.public(self.repo.rows[1], None)
        cases = [
            {'ok': True, 'posts': [], 'has_more': True, 'next_cursor': None},
            {'ok': True, 'posts': [row, row], 'has_more': False, 'next_cursor': None},
            {'ok': True, 'posts': [row], 'has_more': 1, 'next_cursor': None},
            {'ok': True, 'posts': [row], 'has_more': True, 'next_cursor': 2},
            {'ok': True, 'posts': [row], 'has_more': False, 'next_cursor': 1},
            {'ok': True, 'posts': [dict(row, id=True)], 'has_more': False, 'next_cursor': None},
            {'ok': True, 'posts': [dict(row, id=2)], 'has_more': False, 'next_cursor': None},
            {'ok': True, 'posts': [dict(row, published_at=None)], 'has_more': False, 'next_cursor': None},
            {'ok': True, 'posts': [dict(row, provider='https://evil.invalid')], 'has_more': False, 'next_cursor': None},
        ]
        for value in cases:
            with self.subTest(value=value):
                self.repo.override = value
                for prefix in ['/api/shorts/posts/', '/shorts/']:
                    response = self.client.get(prefix + '1')
                    self.assertEqual(503, response.status_code)
                    self.assertNotIn('private-fixture', response.get_data(as_text=True))
                    self.assertNotIn('evil.invalid', response.get_data(as_text=True))

    def test_public_viewer_escapes_metadata_and_never_serializes_request_or_storage_secrets(self):
        self.repo.profile_names[ALICE] = '<b>なまえ</b>'
        self.upload(title='</title><script>alert(1)</script>"', caption='<img src=x onerror=alert(1)>')
        self.repo.sign_fail = True
        self.repo.calls.clear()
        response = self.client.get('/shorts/1?token=private-query-token#private-fragment',
                                   headers={'Host': 'untrusted-host.invalid'})
        self.assertEqual(200, response.status_code)
        body = response.get_data(as_text=True)
        self.assertIn('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;&#34;', body)
        self.assertNotIn('<script>alert', body)
        self.assertNotIn('<img src=x', body)
        self.assertNotIn('<b>なまえ</b>', body)
        self.assertIn('<video controls playsinline preload="metadata" src="/api/shorts/posts/1/media"', body)
        self.assertIn('data-share-provider="post" data-post-id="1"', body)
        self.assertIn('/static/shorts-sharing.js?v=20261022-hybrid2', body)
        for private in ['private-query-token', 'private-fragment', 'untrusted-host.invalid',
                        'private-fixture', 'private@example.invalid', ALICE, 'object_path', 'signed-media']:
            self.assertNotIn(private, body)
        self.assertEqual([('list', None, {'topic': 'all', 'limit': 1, 'before': 2})], self.repo.calls)
        self.assertEqual('origin', response.headers['Referrer-Policy'])
        self.assertIn("script-src 'self'", response.headers['Content-Security-Policy'])
        self.assertIn("frame-src https://www.youtube-nocookie.com", response.headers['Content-Security-Policy'])
        self.assertEqual('nosniff', response.headers['X-Content-Type-Options'])

    def test_public_viewer_legacy_youtube_is_fixed_nocookie_embed_with_validated_id(self):
        values = payload()
        values.pop('url')
        values['video_id'] = 'AAAAAAAAAAA'
        self.repo.call('create_youtube', ALICE, values)
        response = self.client.get('/shorts/1')
        self.assertEqual(200, response.status_code)
        body = response.get_data(as_text=True)
        self.assertIn('https://www.youtube-nocookie.com/embed/AAAAAAAAAAA?playsinline=1', body)
        self.assertIn('referrerpolicy="origin"', body)
        self.assertNotIn('<video', body)
        self.assertNotIn('autoplay', body)
        row = self.repo.public(self.repo.rows[1], None)
        self.repo.override = dict(ok=True, posts=[dict(row, video_id='../../evil')],
                                  has_more=False, next_cursor=None)
        self.assertEqual(503, self.client.get('/shorts/1').status_code)

    def test_public_viewer_errors_are_honest_html_while_api_errors_remain_json(self):
        response = self.client.get('/shorts/1')
        self.assertEqual(404, response.status_code)
        self.assertEqual('text/html', response.mimetype)
        self.assertIn('公開されていません', response.get_data(as_text=True))
        self.repo.fail = RuntimeError('private-storage-url-token')
        response = self.client.get('/shorts/1')
        self.assertEqual(503, response.status_code)
        self.assertIn('少し後に', response.get_data(as_text=True))
        self.assertNotIn('private-storage', response.get_data(as_text=True))
        response = self.client.get('/api/shorts/posts/1')
        self.assertEqual(503, response.status_code)
        self.assertEqual({'ok': False, 'reason': 'storage_unavailable'}, response.json)

    def test_file_uploads_default_closed_until_existing_capacity_review(self):
        app = Flask('default-closed')
        app.register_blueprint(create_shorts_blueprint('https://fixture.invalid', 'fixture-key', repository=self.repo))
        meta = payload()
        meta.pop('url')
        meta['file'] = (BytesIO(fixture_mp4()), 'video.mp4', 'video/mp4')
        response = app.test_client().post('/api/shorts/posts', data=meta, headers=self.auth(), content_type='multipart/form-data')
        self.assertEqual(503, response.status_code)
        self.assertEqual([], self.repo.calls)
        self.assertEqual([], self.repo.uploads)

    def test_public_metadata_excludes_owner_and_remote_extra_fields(self):
        result = self.upload()
        self.assertEqual(201, result.status_code)
        self.assertEqual(ALICE, self.repo.calls[0][1])
        result = self.client.get('/api/shorts/posts')
        self.assertEqual(200, result.status_code)
        post = result.json['posts'][0]
        for key in ['owner_id', 'user_id', 'email', 'token', 'sha256', 'object_path', 'request_id', 'input', 'state']:
            self.assertNotIn(key, post)
        self.assertFalse(post['is_mine'])
        self.assertEqual('no-store', result.headers['Cache-Control'])

    def test_public_author_snapshot_is_shared_without_exposing_profile_fields(self):
        self.repo.profile_names[ALICE] = 'Public name'
        result = self.upload()
        self.assertEqual(201, result.status_code)
        self.assertEqual('Public name', result.json['post']['author_name'])
        self.repo.rows[1]['kn_profile_v1'] = dict(username='not-the-snapshot',
            bio='private fixture', email='private@example.invalid')
        self.repo.rows[1]['raw_user_meta_data'] = dict(name='provider legal name')
        post = self.client.get('/api/shorts/posts').json['posts'][0]
        self.assertEqual('Public name', post['author_name'])
        for key in ('kn_profile_v1', 'raw_user_meta_data', 'email', 'bio', 'owner_id', 'user_id'):
            self.assertNotIn(key, post)
        self.assertNotIn('author_name', self.repo.calls[0][2])

    def test_old_posts_and_accounts_without_public_name_remain_readable(self):
        self.assertIsNone(self.upload().json['post']['author_name'])
        del self.repo.rows[1]['author_name']  # pre-migration RPC or older row fixture
        result = self.client.get('/api/shorts/posts')
        self.assertEqual(200, result.status_code)
        self.assertIsNone(result.json['posts'][0]['author_name'])

    def test_snapshot_comes_from_verified_owner_and_cannot_be_injected(self):
        for changes in [dict(author_name='Forged'), dict(kn_profile_v1='Forged'),
                        dict(raw_user_meta_data='Forged')]:
            self.assertEqual(400, self.upload(**changes).status_code)
        self.assertEqual([], self.repo.calls)
        self.repo.profile_names.update({ALICE: 'Alice public', BOB: 'Bob public'})
        alice = self.upload()
        bob = self.upload(owner='bob')
        self.assertEqual('Alice public', alice.json['post']['author_name'])
        self.assertEqual('Bob public', bob.json['post']['author_name'])
        self.assertEqual(ALICE, self.repo.rows[1]['owner_id'])
        self.assertEqual(BOB, self.repo.rows[2]['owner_id'])

    def test_retry_keeps_first_reserved_name_after_profile_change(self):
        self.repo.profile_names[ALICE] = 'First name'
        self.repo.upload_fail = True
        self.assertEqual(503, self.upload().status_code)
        self.assertEqual('First name', self.repo.rows[1]['author_name'])
        self.repo.profile_names[ALICE] = 'Changed name'
        self.repo.upload_fail = False
        retry = self.upload()
        self.assertEqual(201, retry.status_code)
        self.assertEqual(1, retry.json['post']['id'])
        self.assertEqual('First name', retry.json['post']['author_name'])
        next_post = self.upload(request_id='55555555-5555-4555-8555-555555555555')
        self.assertEqual('Changed name', next_post.json['post']['author_name'])
        self.assertEqual(2, len(self.repo.rows))
        self.assertEqual('First name', self.repo.rows[1]['author_name'])

    def test_public_author_is_bounded_by_unicode_characters_and_fails_closed(self):
        self.upload()
        accepted = ['<b>plain text</b>', '\U0001f423' * 20]
        for name in accepted:
            with self.subTest(name=name):
                self.repo.rows[1]['author_name'] = name
                response = self.client.get('/api/shorts/posts')
                self.assertEqual(200, response.status_code)
                self.assertEqual(name, response.json['posts'][0]['author_name'])
        for name in ['', 'a' * 21, '\U0001f423' * 21, 'a\x00b', 'a\tb',
                     'a\nb', 'a\x7fb', 'a\x85b', '\ud800', False, 123, {}]:
            with self.subTest(name=repr(name)):
                self.repo.rows[1]['author_name'] = name
                response = self.client.get('/api/shorts/posts')
                self.assertEqual(503, response.status_code)
                self.assertEqual(dict(ok=False, reason='storage_unavailable'), response.json)

    def test_owner_cannot_be_injected_or_other_user_deleted(self):
        response = self.upload(owner_id=BOB)
        self.assertEqual(400, response.status_code)
        self.assertEqual([], self.repo.calls)
        self.upload()
        self.assertEqual([], self.client.get('/api/shorts/mine', headers=self.auth('bob')).json['posts'])
        self.assertEqual(404, self.client.delete('/api/shorts/posts/1', headers=self.auth('bob')).status_code)
        self.assertEqual(200, self.client.delete('/api/shorts/posts/1', headers=self.auth()).status_code)
        self.assertEqual([], self.client.get('/api/shorts/posts').json['posts'])

    def test_same_request_is_idempotent_but_changed_retry_conflicts(self):
        first = self.upload()
        same = self.upload()
        self.assertEqual(first.json['post']['id'], same.json['post']['id'])
        changed = self.upload(title='変更')
        self.assertEqual(409, changed.status_code)
        self.assertEqual(1, len(self.repo.rows))

    def test_valid_file_upload_is_private_then_published_without_exposing_object_path(self):
        result = self.upload()
        self.assertEqual(201, result.status_code)
        post = result.json['post']
        self.assertEqual('upload', post['provider'])
        self.assertEqual('/api/shorts/posts/1/media', post['media_url'])
        self.assertNotIn('object_path', post)
        self.assertEqual('reserve_file', self.repo.calls[0][0])
        self.assertEqual('complete_file', self.repo.calls[1][0])
        self.assertEqual(1, len(self.repo.uploads))
        retry = self.upload()
        self.assertEqual(201, retry.status_code)
        self.assertEqual(1, len(self.repo.uploads))
        media = self.client.get('/api/shorts/posts/1/media')
        self.assertEqual(307, media.status_code)
        self.assertEqual('https://example.invalid/signed-media', media.headers['Location'])

    def test_h264_mov_retains_actual_container_mime_and_extension(self):
        data = fixture_mp4().replace(b'isom', b'qt  ')
        response = self.upload(data)
        self.assertEqual(201, response.status_code)
        self.assertEqual('video/quicktime', response.json['post']['content_type'])
        self.assertTrue(self.repo.uploads[0][0].endswith('.mov'))
        self.assertEqual('video/quicktime', self.repo.uploads[0][2])

    def test_false_mime_corrupt_data_and_oversize_are_rejected_before_reservation(self):
        self.assertEqual(400, self.upload(b'not a video').status_code)
        self.assertEqual(400, self.upload(fixture_mp4(offset=1)).status_code)
        self.assertEqual(413, self.upload(b'x' * (MAX_FILE_BYTES + 1)).status_code)
        self.assertEqual([], self.repo.calls)
        self.assertEqual([], self.repo.uploads)

    def test_failed_upload_stays_pending_and_retry_uses_same_reserved_path(self):
        self.repo.upload_fail = True
        self.assertEqual(503, self.upload().status_code)
        self.assertEqual([], self.client.get('/api/shorts/posts').json['posts'])
        self.assertEqual(404, self.client.get('/api/shorts/posts/1/media').status_code)
        self.assertEqual('pending', self.client.get('/api/shorts/mine', headers=self.auth()).json['posts'][0]['state'])
        self.repo.upload_fail = False
        self.assertEqual(201, self.upload().status_code)
        self.assertEqual(self.repo.uploads[0][0], self.repo.uploads[1][0])
        self.assertEqual(1, len(self.repo.rows))

    def test_delete_hides_immediately_but_failed_purge_is_retryable(self):
        self.upload()
        self.repo.purge_fail = True
        result = self.client.delete('/api/shorts/posts/1', headers=self.auth())
        self.assertTrue(result.json['cleanup_pending'])
        self.assertEqual([], self.client.get('/api/shorts/posts').json['posts'])
        self.assertEqual(404, self.client.get('/api/shorts/posts/1/media').status_code)
        self.repo.purge_fail = False
        self.assertFalse(self.client.delete('/api/shorts/posts/1', headers=self.auth()).json['cleanup_pending'])
        self.assertTrue(self.repo.rows[1]['purged'])

    def test_unavailable_schema_and_raw_errors_are_not_empty_success(self):
        self.repo.fail = RuntimeError('private-fixture-token remote error')
        response = self.client.get('/api/shorts/posts')
        self.assertEqual(503, response.status_code)
        self.assertEqual({'ok': False, 'reason': 'storage_unavailable'}, response.json)
        self.assertNotIn('private-fixture', response.get_data(as_text=True))

    def test_admin_gate_is_header_only_and_body_cannot_supply_password(self):
        self.upload()
        path = '/api/shorts/admin/posts/1/visibility'
        self.assertEqual(403, self.client.post(path + '?pass=fixture-admin', json={'hidden': True}).status_code)
        self.assertEqual(403, self.client.post(path, json={'hidden': True, 'pass': 'fixture-admin'}).status_code)
        self.assertEqual(200, self.client.post(path, json={'hidden': True}, headers={'X-Admin-Pass': 'fixture-admin'}).status_code)
        self.assertEqual([], self.client.get('/api/shorts/posts').json['posts'])

    def test_link_post_creation_retired_but_existing_youtube_rows_remain_readable(self):
        response = self.client.post('/api/shorts/posts', json=payload(), headers=self.auth())
        self.assertEqual(400, response.status_code)
        self.assertEqual('invalid_request', response.json['reason'])
        self.assertEqual([], self.repo.calls)
        old = payload()
        old.pop('url')
        self.repo.call('create_youtube', ALICE, dict(old, video_id='AAAAAAAAAAA'))
        result = self.client.get('/api/shorts/posts')
        self.assertEqual(200, result.status_code)
        self.assertEqual('youtube', result.json['posts'][0]['provider'])
        self.assertEqual('AAAAAAAAAAA', result.json['posts'][0]['video_id'])

    def test_fragmented_recording_stored_hash_size_match_normalized_actual_bytes(self):
        from tests.test_shorts_mp4 import fixture_fragmented
        from shorts_mp4 import normalize_mp4
        source = fixture_fragmented()
        stored = normalize_mp4(source)
        result = self.upload(source)
        self.assertEqual(201, result.status_code)
        self.assertEqual(stored, self.repo.uploads[0][1])
        info = inspect_mp4(stored)
        self.assertEqual(info.sha256, self.repo.calls[0][2]['sha256'])
        self.assertEqual(info.file_bytes, self.repo.calls[0][2]['file_bytes'])


class URLAndMediaTests(unittest.TestCase):
    def test_recognised_urls_extract_only_id(self):
        for value in ['https://youtu.be/AAAAAAAAAAA?si=share', 'https://www.youtube.com/watch?v=AAAAAAAAAAA&t=10',
                      'https://m.youtube.com/shorts/AAAAAAAAAAA', 'https://youtube.com/watch?v=AAAAAAAAAAA']:
            self.assertEqual('AAAAAAAAAAA', youtube_video_id(value))

    def test_url_cannot_direct_transport_to_other_host_or_ambiguous_id(self):
        for value in ['http://youtu.be/AAAAAAAAAAA', 'https://youtu.be.evil.invalid/AAAAAAAAAAA',
                      'https://user@youtu.be/AAAAAAAAAAA', 'https://youtu.be:443/AAAAAAAAAAA',
                      'https://www.youtube.com/watch?v=AAAAAAAAAAA&v=BBBBBBBBBBB',
                      'https://youtube.com/shorts/AAAAAAAAAAA/other', 'file:///tmp/video',
                      'https://youtu.be/AAAAAAAAAAA\nX-Admin-Pass: secret']:
            with self.assertRaises(SubmissionError):
                youtube_video_id(value)

    def test_media_sample_bounds_codec_nal_and_duration_are_authoritative(self):
        valid = inspect_mp4(fixture_mp4())
        self.assertEqual((640, 360, 1000), (valid.width, valid.height, valid.duration_ms))
        for media in [fixture_mp4(offset=1), fixture_mp4(declared_size=100000), fixture_mp4(duration=180001),
                      fixture_mp4(nal=b'\xe5bad'), fixture_mp4().replace(b'avc1', b'hvc1'),
                      fixture_mp4()[:-3], fixture_mp4().replace(b'\x67\x42', b'\x68\x42'),
                      fixture_mp4(movie_duration=600000), fixture_mp4(track_duration=600000),
                      fixture_mp4(composition_offset=600000), fixture_mp4(edit_duration=600000),
                      fixture_mp4(sps_width=4096), fixture_mp4(external_reference=True)]:
            with self.assertRaises(MediaError):
                inspect_mp4(media)

    def test_migration_keeps_browser_and_news_boundaries_and_upload_leases(self):
        sql = (Path(__file__).parents[1] / 'migrations/20261014_shorts_posts.sql').read_text()
        self.assertNotIn("values('website-news'", sql)
        self.assertIn("values('website-shorts','website-shorts',false,20000000", sql)
        self.assertIn("using(bucket_id<>'website-shorts')", sql)
        self.assertIn('and is_anonymous=false', sql)
        self.assertIn('where id=v_id and owner_id=p_actor for update', sql)
        self.assertIn("pg_advisory_xact_lock(hashtextextended('website-shorts:quota',0))", sql)
        self.assertIn('purged_at is null)+v_bytes>500000000', sql)
        self.assertIn('upload_count>0 and v_row.upload_lease_until>=clock_timestamp()', sql)
        self.assertIn('revoke all on function public.website_shorts_operation', sql)


    def test_author_migration_snapshots_only_explicit_name_after_retry_return(self):
        sql = (Path(__file__).parents[1] / 'migrations/20261022_shorts_author_profile.sql').read_text()
        self.assertIn('add column if not exists author_name text', sql)
        self.assertIn('check(author_name is null or (char_length(author_name) between 1 and 20', sql)
        self.assertIn("jsonb_typeof(raw_user_meta_data->'kn_profile_v1'->'username')='string'", sql)
        self.assertIn("from auth.users where id=p_actor and is_anonymous=false", sql)
        self.assertIn("'author_name',author_name,'is_mine'", sql)
        self.assertNotIn("p_data->>'author_name'", sql)
        self.assertNotIn("p_data->'kn_profile_v1'", sql)
        self.assertNotIn('update auth.users', sql.lower())
        self.assertNotIn('update public.shorts_posts set author_name', sql.lower())
        retry_start = sql.index('    if found then', sql.index("where owner_id=p_actor and request_id=v_request;"))
        snapshot_start = sql.index('    -- Snapshot only')
        retry = sql[retry_start:snapshot_start]
        self.assertIn("'post',public.website_shorts_public_post(v_row.id,p_actor)", retry)
        self.assertNotIn('v_author_name', retry)
        insert = sql[sql.index('    insert into public.shorts_posts('):sql.index('    insert into public.shorts_post_limits')]
        self.assertIn('video_id,author_name,', insert)
        self.assertIn('v_video,v_author_name,', insert)

    def test_author_migration_preserves_original_authorization_quotas_and_storage(self):
        sql = (Path(__file__).parents[1] / 'migrations/20261022_shorts_author_profile.sql').read_text()
        self.assertIn('and is_anonymous=false', sql)
        self.assertIn('where id=v_id and owner_id=p_actor for update', sql)
        self.assertIn("pg_advisory_xact_lock(hashtextextended('website-shorts:quota',0))", sql)
        self.assertIn('purged_at is null)+v_bytes>500000000', sql)
        self.assertIn('owner_id=p_actor and purged_at is null)+v_bytes>100000000', sql)
        self.assertIn('upload_count>0 and v_row.upload_lease_until>=clock_timestamp()', sql)
        self.assertIn('revoke all on function public.website_shorts_operation(text,uuid,jsonb) from public,anon,authenticated;', sql)
        self.assertIn('grant execute on function public.website_shorts_operation(text,uuid,jsonb) to service_role;', sql)
        self.assertIn('revoke all on function public.website_shorts_public_post(bigint,uuid) from public,anon,authenticated;', sql)
        self.assertNotIn('storage.buckets', sql)
        self.assertNotIn('storage.objects', sql)
        self.assertNotIn('create table', sql.lower())


class RepositoryTransportTests(unittest.TestCase):
    def test_auth_checks_nonanonymous_response_without_shared_session_mutation(self):
        class Response:
            status_code = 200
            content = b'{}'
            def json(self):
                return dict(id=ALICE, is_anonymous=True, access_token='untrusted-fixture')
        class Transport:
            def __init__(self):
                self.calls = []
            def get(self, url, **options):
                self.calls.append((url, options))
                return Response()
        transport = Transport()
        repo = SupabaseShortsRepository('https://fixture.invalid', 'fixture-service', transport=transport)
        with self.assertRaises(ShortsError) as error:
            repo.verify_login('fixture-bearer')
        self.assertEqual('login_required', error.exception.reason)
        self.assertEqual('https://fixture.invalid/auth/v1/user', transport.calls[0][0])
        self.assertFalse(transport.calls[0][1]['allow_redirects'])
        self.assertEqual((2, 5), transport.calls[0][1]['timeout'])


if __name__ == '__main__':
    unittest.main()

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
from shorts_api import create_shorts_blueprint, ShortsError, SupabaseShortsRepository
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
                       owner_id=actor, created_at=STAMP, published_at=STAMP if action == 'create_youtube' else None,
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
        result = self.client.post('/api/shorts/posts', json=payload(), headers=self.auth())
        self.assertEqual(201, result.status_code)
        self.assertEqual(ALICE, self.repo.calls[0][1])
        result = self.client.get('/api/shorts/posts')
        self.assertEqual(200, result.status_code)
        post = result.json['posts'][0]
        for key in ['owner_id', 'user_id', 'email', 'token', 'sha256', 'object_path', 'request_id', 'input', 'state']:
            self.assertNotIn(key, post)
        self.assertFalse(post['is_mine'])
        self.assertEqual('no-store', result.headers['Cache-Control'])

    def test_owner_cannot_be_injected_or_other_user_deleted(self):
        response = self.client.post('/api/shorts/posts', json=payload(owner_id=BOB), headers=self.auth())
        self.assertEqual(400, response.status_code)
        self.assertEqual([], self.repo.calls)
        self.client.post('/api/shorts/posts', json=payload(), headers=self.auth())
        self.assertEqual([], self.client.get('/api/shorts/mine', headers=self.auth('bob')).json['posts'])
        self.assertEqual(404, self.client.delete('/api/shorts/posts/1', headers=self.auth('bob')).status_code)
        self.assertEqual(200, self.client.delete('/api/shorts/posts/1', headers=self.auth()).status_code)
        self.assertEqual([], self.client.get('/api/shorts/posts').json['posts'])

    def test_same_request_is_idempotent_but_changed_retry_conflicts(self):
        first = self.client.post('/api/shorts/posts', json=payload(), headers=self.auth())
        same = self.client.post('/api/shorts/posts', json=payload(), headers=self.auth())
        self.assertEqual(first.json['post']['id'], same.json['post']['id'])
        changed = self.client.post('/api/shorts/posts', json=payload(title='変更'), headers=self.auth())
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
        self.client.post('/api/shorts/posts', json=payload(), headers=self.auth())
        path = '/api/shorts/admin/posts/1/visibility'
        self.assertEqual(403, self.client.post(path + '?pass=fixture-admin', json={'hidden': True}).status_code)
        self.assertEqual(403, self.client.post(path, json={'hidden': True, 'pass': 'fixture-admin'}).status_code)
        self.assertEqual(200, self.client.post(path, json={'hidden': True}, headers={'X-Admin-Pass': 'fixture-admin'}).status_code)
        self.assertEqual([], self.client.get('/api/shorts/posts').json['posts'])


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

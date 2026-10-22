"""Offline self-profile identity, input, privacy and transport boundaries."""

from copy import deepcopy
import base64
import hashlib
import io
import json
from pathlib import Path
import unittest

from flask import Flask
from PIL import Image

from user_profile_api import (create_user_profile_blueprint, normalize_profile,
                              ProfileError, MAX_RESPONSE_BYTES, MAX_JSON_BYTES,
                              MAX_AVATAR_BYTES, AVATAR_BUCKET, AVATAR_DATA_PREFIX)

ALICE = '11111111-1111-4111-8111-111111111111'
BOB = '33333333-3333-4333-8333-333333333333'
PROFILE = dict(username='Public name', bio='A short introduction', avatar='leaf')


class Response:
    def __init__(self, payload=None, status=200, *, raw=None, headers=None, fail_read=False):
        self.status_code = status
        self.raw = json.dumps(payload).encode('utf-8') if raw is None else raw
        self.headers = headers or {}
        self.fail_read = fail_read
        self.closed = False

    def iter_content(self, chunk_size):
        if self.fail_read:
            raise RuntimeError('fixture-token https://private.invalid/detail')
        for start in range(0, len(self.raw), chunk_size):
            yield self.raw[start:start + chunk_size]

    def close(self):
        self.closed = True


class Transport:
    def __init__(self):
        self.calls = []
        self.browser_token = 'alice-token'
        self.change_browser_after_get = False
        self.users = {
            'alice-token': dict(id=ALICE, is_anonymous=False, email='alice@private.invalid',
                                user_metadata={'provider_name': 'Private legal name'}),
            'bob-token': dict(id=BOB, is_anonymous=False, user_metadata={}),
            'guest-token': dict(id=ALICE, is_anonymous=True, user_metadata={}),
        }
        self.get_response = self.put_response = None
        self.get_error = self.put_error = False
        self.responses = []

    def get(self, endpoint, **options):
        self.calls.append(('get', endpoint, deepcopy(options)))
        if self.get_error:
            raise RuntimeError('fixture-token https://private.invalid/detail')
        token = options['headers']['Authorization'].removeprefix('Bearer ')
        result = self.get_response or Response(deepcopy(self.users.get(token)), 200 if token in self.users else 401)
        self.responses.append(result)
        if self.change_browser_after_get:
            self.browser_token = 'bob-token'
        return result

    def put(self, endpoint, **options):
        self.calls.append(('put', endpoint, deepcopy(options)))
        if self.put_error:
            raise RuntimeError('fixture-token https://private.invalid/detail')
        if self.put_response is not None:
            result = self.put_response
        else:
            token = options['headers']['Authorization'].removeprefix('Bearer ')
            user = self.users.get(token)
            if user is None:
                result = Response({}, 401)
            else:
                user['user_metadata'].update(deepcopy(options['json']['data']))
                result = Response(deepcopy(user))
        self.responses.append(result)
        return result


class UserProfileAPITests(unittest.TestCase):
    def setUp(self):
        self.transport = Transport()
        self.app = Flask(__name__)
        self.app.register_blueprint(create_user_profile_blueprint(
            'https://fixture.invalid/', 'existing-api-key', transport=self.transport))
        self.client = self.app.test_client()

    def save(self, profile=None, token='alice-token', **options):
        headers = {} if token is None else {'Authorization': 'Bearer ' + token}
        return self.client.put('/api/user-profile', json=PROFILE if profile is None else profile,
                               headers=headers, **options)

    def assert_fixed_error(self, response, status, reason):
        self.assertEqual(status, response.status_code)
        self.assertEqual(dict(ok=False, reason=reason), response.json)
        self.assertEqual('no-store', response.headers['Cache-Control'])
        self.assertNotIn('private.invalid', response.get_data(as_text=True))
        self.assertNotIn('fixture-token', response.get_data(as_text=True))

    def test_frozen_bearer_targets_same_self_user_when_browser_switches_accounts(self):
        self.transport.change_browser_after_get = True
        response = self.save()
        self.assertEqual(200, response.status_code)
        self.assertEqual(dict(ok=True, user_id=ALICE, profile=PROFILE), response.json)
        self.assertEqual('bob-token', self.transport.browser_token)
        self.assertEqual(['get', 'put'], [call[0] for call in self.transport.calls])
        for method, endpoint, options in self.transport.calls:
            self.assertEqual('https://fixture.invalid/auth/v1/user', endpoint)
            self.assertEqual('Bearer alice-token', options['headers']['Authorization'])
            self.assertEqual('existing-api-key', options['headers']['apikey'])
            self.assertFalse(options['allow_redirects'])
            self.assertTrue(options['stream'])
            self.assertEqual((2, 5 if method == 'get' else 8), options['timeout'])
        self.assertEqual({'data': {'kn_profile_v1': PROFILE}}, self.transport.calls[1][2]['json'])
        self.assertEqual('Private legal name', self.transport.users['alice-token']['user_metadata']['provider_name'])
        self.assertNotIn('kn_profile_v1', self.transport.users['bob-token']['user_metadata'])
        self.assertNotIn('email', response.json)
        self.assertNotIn('user_metadata', response.json)
        self.assertEqual('no-store', response.headers['Cache-Control'])
        self.assertTrue(all(response.closed for response in self.transport.responses))

    def test_client_cannot_choose_another_target_or_change_private_metadata(self):
        for key in ('user_id', 'id', 'owner_id', 'email', 'password', 'data', 'user_metadata', 'kn_profile_v1'):
            with self.subTest(key=key):
                self.assert_fixed_error(self.save(dict(PROFILE, **{key: BOB})), 400, 'invalid_request')
        self.assertEqual([], self.transport.calls)

    def test_cookie_does_not_authenticate_or_select_target(self):
        self.client.set_cookie('user_id', BOB)
        self.client.set_cookie('access_token', 'bob-token')
        self.assert_fixed_error(self.save(token=None), 401, 'login_required')
        self.assertEqual([], self.transport.calls)
        self.assertEqual(ALICE, self.save().json['user_id'])

    def test_invalid_headers_do_not_make_remote_calls(self):
        for value in ('', 'Basic alice-token', 'Bearer ', 'Bearer a b', 'Bearer a\t',
                      'Bearer ' + 'a' * 8193, 'Bearer nonascii-\u00e9'):
            with self.subTest(header=repr(value)):
                response = self.client.put('/api/user-profile', json=PROFILE, headers={'Authorization': value})
                self.assert_fixed_error(response, 401, 'login_required')
        self.assertEqual([], self.transport.calls)

    def test_unverified_guest_ambiguous_or_zero_identity_never_writes(self):
        for user in (None, {}, dict(id=ALICE), dict(id=ALICE, is_anonymous=True),
                     dict(id=ALICE, is_anonymous=0), dict(id='not-a-uuid', is_anonymous=False),
                     dict(id='00000000-0000-0000-0000-000000000000', is_anonymous=False)):
            with self.subTest(user=user):
                self.transport.calls.clear()
                self.transport.get_response = Response(user)
                self.assert_fixed_error(self.save(), 401, 'login_required')
                self.assertEqual(['get'], [call[0] for call in self.transport.calls])
        self.transport.get_response = None
        self.assert_fixed_error(self.save(token='guest-token'), 401, 'login_required')

    def test_invalid_json_content_type_size_duplicate_and_unknown_fields_never_write(self):
        headers = {'Authorization': 'Bearer alice-token'}
        cases = [('text/plain', '{}'), ('application/json', '{"username":"a","username":"b","bio":"","avatar":"leaf"}'),
                 ('application/json', '[]'), ('application/json', 'null'), ('application/json', '{'),
                 ('application/json', '{"username":NaN,"bio":"","avatar":"leaf"}'),
                 ('application/json', json.dumps(dict(PROFILE, bio='x' * MAX_JSON_BYTES)))]
        for content_type, body in cases:
            with self.subTest(body=body[:40]):
                result = self.client.put('/api/user-profile', data=body, content_type=content_type, headers=headers)
                self.assert_fixed_error(result, 400, 'invalid_request')
        for payload in ({}, {'username': 'name'}, {'username': 'name', 'bio': ''}):
            self.assert_fixed_error(self.save(payload), 400, 'invalid_request')
        self.assertEqual([], self.transport.calls)

    def test_normalizes_unicode_name_newlines_and_preserves_public_only_fields(self):
        value = dict(username='\ufeff \U0001f423' * 0, bio='', avatar='sun')
        value['username'] = '\ufeff  ' + '\U0001f423' * 20 + '\u00a0'
        value['bio'] = '  first\r\nsecond\rthird  '
        response = self.save(value)
        self.assertEqual(200, response.status_code)
        expected = dict(username='\U0001f423' * 20, bio='first\nsecond\nthird', avatar='sun')
        self.assertEqual(expected, response.json['profile'])
        self.assertEqual({'data': {'kn_profile_v1': expected}}, self.transport.calls[-1][2]['json'])
        empty = self.save(dict(username='  ', bio='', avatar='moon'))
        self.assertEqual('', empty.json['profile']['username'])

    def test_invalid_unicode_controls_lengths_and_avatars_never_write(self):
        invalid = [
            ('username', 12, 'invalid_name'), ('username', 'a' * 21, 'invalid_name'),
            ('username', '\U0001f423' * 21, 'invalid_name'), ('username', 'a\x00b', 'invalid_name'),
            ('username', 'a\x85b', 'invalid_name'), ('username', 'a\ud800b', 'invalid_name'),
            ('username', 'a\u202eb', 'invalid_name'), ('username', 'a\u2067b', 'invalid_name'),
            ('bio', None, 'invalid_bio'), ('bio', 'x' * 161, 'invalid_bio'),
            ('bio', 'a\tb', 'invalid_bio'), ('bio', 'a\x7fb', 'invalid_bio'),
            ('bio', 'a\udfffb', 'invalid_bio'), ('avatar', '__proto__', 'invalid_avatar'),
            ('avatar', {}, 'invalid_avatar'),
        ]
        for key, value, reason in invalid:
            with self.subTest(key=key, value=repr(value)):
                self.assert_fixed_error(self.save(dict(PROFILE, **{key: value})), 400, reason)
        self.assertEqual([], self.transport.calls)

    def test_redirect_refusal_outages_and_remote_errors_are_fixed(self):
        for status in (301, 307, 404, 500):
            self.transport.calls.clear()
            self.transport.get_response = Response({'message': 'fixture-token https://private.invalid/detail'}, status)
            self.assert_fixed_error(self.save(), 503, 'auth_unavailable')
            self.assertEqual(['get'], [call[0] for call in self.transport.calls])
        self.transport.get_response = None
        self.transport.get_error = True
        self.assert_fixed_error(self.save(), 503, 'auth_unavailable')
        self.transport.get_error = False
        self.transport.put_error = True
        self.assert_fixed_error(self.save(), 503, 'storage_unavailable')
        self.transport.put_error = False
        self.transport.put_response = Response({'message': 'fixture-token'}, 403)
        self.assert_fixed_error(self.save(), 401, 'login_required')

    def test_put_response_must_match_verified_identity_and_exact_saved_profile(self):
        for result in (dict(id=BOB, is_anonymous=False, user_metadata={'kn_profile_v1': PROFILE}),
                       dict(id=ALICE, is_anonymous=True, user_metadata={'kn_profile_v1': PROFILE})):
            self.transport.put_response = Response(result)
            self.assert_fixed_error(self.save(), 409, 'account_changed')
        for saved in (None, {}, dict(PROFILE, username='stale'), dict(PROFILE, email='private@invalid')):
            self.transport.put_response = Response(dict(id=ALICE, is_anonymous=False,
                                                       user_metadata={'kn_profile_v1': saved}))
            self.assert_fixed_error(self.save(), 503, 'storage_unavailable')

    def test_response_reads_are_bounded_and_closed_on_invalid_or_failed_data(self):
        for response in (Response(raw=b'x' * (MAX_RESPONSE_BYTES + 1)), Response(raw=b'not-json'),
                         Response(raw=b'{}', fail_read=True)):
            self.transport.get_response = response
            self.assert_fixed_error(self.save(), 503, 'auth_unavailable')
            self.assertTrue(response.closed)
        self.transport.get_response = None
        response = Response(raw=b'x' * (MAX_RESPONSE_BYTES + 1))
        self.transport.put_response = response
        self.assert_fixed_error(self.save(), 503, 'storage_unavailable')
        self.assertTrue(response.closed)

    def test_retry_after_is_bounded_and_no_automatic_retry_occurs(self):
        for value, expected in [('60', '60'), ('999999', None), ('-1', None), ('https://private.invalid', None)]:
            self.transport.calls.clear()
            self.transport.get_response = Response({}, 429, headers={'Retry-After': value})
            response = self.save()
            self.assert_fixed_error(response, 503, 'auth_unavailable')
            self.assertEqual(expected, response.headers.get('Retry-After'))
            self.assertEqual(1, len(self.transport.calls))

    def test_normalizer_returns_new_dictionary_and_does_not_mutate_input(self):
        original = dict(PROFILE, username=' Public name ')
        expected = deepcopy(original)
        result = normalize_profile(original)
        self.assertEqual(expected, original)
        self.assertEqual('Public name', result['username'])
        result['username'] = 'different'
        self.assertEqual(expected, original)

    def test_registration_is_present_once_beside_existing_shorts_route(self):
        source = (Path(__file__).parents[1] / 'line_bot.py').read_text()
        self.assertEqual(1, source.count('from user_profile_api import create_user_profile_blueprint'))
        self.assertEqual(1, source.count('app.register_blueprint(create_user_profile_blueprint(SUPABASE_URL, SUPABASE_KEY))'))


def jpeg_data(width=192, height=192, *, exif=False):
    output = io.BytesIO()
    image = Image.new('RGB', (width, height), (112, 150, 177))
    options = {}
    if exif:
        metadata = Image.Exif()
        metadata[315] = 'Private original photographer'
        metadata[274] = 1
        options['exif'] = metadata
    image.save(output, format='JPEG', **options)
    return output.getvalue()


def data_url(raw):
    return AVATAR_DATA_PREFIX + base64.b64encode(raw).decode('ascii')


class ImageTransport(Transport):
    def __init__(self):
        super().__init__()
        self.objects = {}
        self.storage_get_response = self.upload_response = None
        self.storage_get_error = self.upload_error = False

    def get(self, endpoint, **options):
        if endpoint.endswith('/auth/v1/user'):
            return super().get(endpoint, **options)
        self.calls.append(('get', endpoint, deepcopy(options)))
        if self.storage_get_error:
            raise RuntimeError('fixture-token https://private.invalid/detail')
        raw = self.objects.get(endpoint)
        result = self.storage_get_response or Response(
            raw=raw or b'', status=200 if raw is not None else 404,
            headers={'Content-Type': 'image/jpeg', 'Content-Length': str(len(raw or b''))})
        self.responses.append(result)
        return result

    def post(self, endpoint, **options):
        self.calls.append(('post', endpoint, deepcopy(options)))
        if self.upload_error:
            raise RuntimeError('fixture-token https://private.invalid/detail')
        if self.upload_response is not None:
            result = self.upload_response
        elif endpoint in self.objects:
            result = Response({'statusCode': '409', 'error': 'Duplicate'}, 400)
        else:
            self.objects[endpoint] = bytes(options['data'])
            result = Response({'Key': 'private-owner-object'}, 200)
        self.responses.append(result)
        return result


class ProfileAvatarTests(UserProfileAPITests):
    def setUp(self):
        self.transport = ImageTransport()
        self.app = Flask(__name__)
        self.app.register_blueprint(create_user_profile_blueprint(
            'https://fixture.invalid/', 'existing-api-key', transport=self.transport))
        self.client = self.app.test_client()

    def image(self, token='alice-token', **options):
        return self.client.get('/api/user-profile/avatar',
                               headers={'Authorization': 'Bearer ' + token}, **options)

    def object_url(self, reference, owner=ALICE):
        return 'https://fixture.invalid/storage/v1/object/' + AVATAR_BUCKET + '/' + owner + '/' + reference + '.jpg'

    def install_image(self, raw=None, owner=ALICE, token='alice-token'):
        raw = jpeg_data() if raw is None else raw
        reference = hashlib.sha256(raw).hexdigest()
        self.transport.objects[self.object_url(reference, owner)] = raw
        self.transport.users[token]['user_metadata']['kn_profile_v1'] = dict(PROFILE, avatar_image=reference)
        return reference, raw

    def test_photo_is_owner_bound_reencoded_metadata_free_and_never_sent_to_auth(self):
        original = jpeg_data(exif=True)
        self.transport.change_browser_after_get = True
        result = self.save(dict(PROFILE, avatar_image=data_url(original)))
        self.assertEqual(200, result.status_code)
        reference = result.json['profile']['avatar_image']
        self.assertRegex(reference, r'^[0-9a-f]{64}$')
        self.assertEqual(['get', 'post', 'put'], [call[0] for call in self.transport.calls])
        upload = self.transport.calls[1]
        self.assertEqual(self.object_url(reference), upload[1])
        self.assertEqual('Bearer existing-api-key', upload[2]['headers']['Authorization'])
        self.assertEqual('false', upload[2]['headers']['x-upsert'])
        self.assertEqual('image/jpeg', upload[2]['headers']['Content-Type'])
        self.assertFalse(upload[2]['allow_redirects'])
        self.assertTrue(upload[2]['stream'])
        raw = upload[2]['data']
        self.assertEqual(hashlib.sha256(raw).hexdigest(), reference)
        self.assertLessEqual(len(raw), MAX_AVATAR_BYTES)
        with Image.open(io.BytesIO(raw)) as image:
            self.assertEqual('JPEG', image.format)
            self.assertEqual((192, 192), image.size)
            self.assertEqual({}, dict(image.getexif()))
            self.assertNotIn('icc_profile', image.info)
        auth_write = self.transport.calls[-1][2]
        self.assertEqual('Bearer alice-token', auth_write['headers']['Authorization'])
        self.assertEqual({'data': {'kn_profile_v1': dict(PROFILE, avatar_image=reference)}}, auth_write['json'])
        self.assertNotIn('data:image', json.dumps(auth_write['json']))
        self.assertNotIn('kn_profile_v1', self.transport.users['bob-token']['user_metadata'])
        self.assertTrue(all(response.closed for response in self.transport.responses))

    def test_legacy_put_preserves_existing_reference_and_clear_only_changes_metadata(self):
        reference, raw = self.install_image()
        result = self.save(dict(PROFILE, username='Changed name'))
        self.assertEqual(dict(PROFILE, username='Changed name', avatar_image=reference), result.json['profile'])
        self.assertEqual(['get', 'put'], [call[0] for call in self.transport.calls])
        result = self.save(dict(PROFILE, avatar='flower', avatar_image=''))
        self.assertEqual(dict(PROFILE, avatar='flower', avatar_image=''), result.json['profile'])
        self.assertEqual(raw, self.transport.objects[self.object_url(reference)])
        self.assertFalse(any(call[0] == 'delete' for call in self.transport.calls))
        self.assert_fixed_error(self.image(), 404, 'avatar_not_found')

    def test_legacy_put_discards_invalid_old_raw_image_instead_of_forwarding_to_auth(self):
        self.transport.users['alice-token']['user_metadata']['kn_profile_v1'] = dict(
            PROFILE, avatar_image=data_url(jpeg_data()))
        result = self.save()
        self.assertEqual(PROFILE, result.json['profile'])
        self.assertNotIn('data:image', json.dumps(self.transport.calls[-1][2]['json']))

    def test_reference_can_only_retain_current_owners_reference(self):
        reference, _ = self.install_image()
        self.assertEqual(200, self.save(dict(PROFILE, avatar_image=reference)).status_code)
        self.transport.calls.clear()
        self.assert_fixed_error(self.save(dict(PROFILE, avatar_image='a' * 64)), 400, 'invalid_avatar_image')
        self.assertEqual(['get'], [call[0] for call in self.transport.calls])
        self.transport.calls.clear()
        self.assert_fixed_error(self.save(dict(PROFILE, avatar_image=reference), token='bob-token'),
                                400, 'invalid_avatar_image')
        self.assertEqual(['get'], [call[0] for call in self.transport.calls])

    def test_invalid_image_fields_are_rejected_before_auth_or_storage(self):
        for value in (None, {}, 1, 'A' * 64, '../' + 'a' * 64,
                      'https://private.invalid/image.jpg', 'data:image/png;base64,YQ==',
                      AVATAR_DATA_PREFIX, AVATAR_DATA_PREFIX + 'not-base64',
                      AVATAR_DATA_PREFIX + 'YQ==\n', AVATAR_DATA_PREFIX + 'YR==',
                      data_url(b'x' * (MAX_AVATAR_BYTES + 1))):
            with self.subTest(value=repr(value)[:80]):
                self.assert_fixed_error(self.save(dict(PROFILE, avatar_image=value)),
                                        400, 'invalid_avatar_image')
        self.assertEqual([], self.transport.calls)

    def test_png_animated_gif_truncation_and_excessive_pixel_dimensions_never_upload(self):
        png, gif = io.BytesIO(), io.BytesIO()
        image = Image.new('RGB', (16, 16))
        image.save(png, format='PNG')
        image.save(gif, format='GIF', save_all=True,
                   append_images=[Image.new('RGB', (16, 16), 'red')])
        bomb = bytearray(jpeg_data(16, 16))
        marker = bomb.index(b'\xff\xc0')
        bomb[marker + 5:marker + 9] = b'\xff\xff\xff\xff'
        for raw in (png.getvalue(), gif.getvalue(), jpeg_data()[:100],
                    jpeg_data(257, 1), jpeg_data(1, 257), bytes(bomb), b'not an image'):
            with self.subTest(size=len(raw)):
                self.transport.calls.clear()
                self.assert_fixed_error(self.save(dict(PROFILE, avatar_image=data_url(raw))),
                                        400, 'invalid_avatar_image')
                self.assertEqual(['get'], [call[0] for call in self.transport.calls])

    def test_guest_or_wrong_identity_never_reaches_avatar_storage(self):
        result = self.save(dict(PROFILE, avatar_image=data_url(jpeg_data())), token='guest-token')
        self.assert_fixed_error(result, 401, 'login_required')
        self.assertEqual(['get'], [call[0] for call in self.transport.calls])
        self.transport.calls.clear()
        self.assert_fixed_error(self.image(token='guest-token'), 401, 'login_required')
        self.assertEqual(['get'], [call[0] for call in self.transport.calls])

    def test_failed_upload_does_not_update_profile_or_report_success(self):
        for response in (Response({}, 302), Response({}, 500), Response({}, 403),
                         Response({}, 400), Response(raw=b'x' * (MAX_RESPONSE_BYTES + 1))):
            with self.subTest(status=response.status_code):
                self.transport.calls.clear()
                self.transport.upload_response = response
                self.assert_fixed_error(self.save(dict(PROFILE, avatar_image=data_url(jpeg_data()))),
                                        503, 'storage_unavailable')
                self.assertEqual(['get', 'post'], [call[0] for call in self.transport.calls])
                self.assertTrue(response.closed)
        self.transport.upload_response = None
        self.transport.upload_error = True
        self.assert_fixed_error(self.save(dict(PROFILE, avatar_image=data_url(jpeg_data()))),
                                503, 'storage_unavailable')

    def test_metadata_write_failure_or_owner_mismatch_retains_uploaded_objects_without_success(self):
        old_ref, _ = self.install_image()
        for response, status, reason in (
                (Response({}, 500), 503, 'storage_unavailable'),
                (Response(dict(id=BOB, is_anonymous=False, user_metadata={})), 409, 'account_changed'),
                (Response(dict(id=ALICE, is_anonymous=False, user_metadata={'kn_profile_v1': PROFILE})),
                 503, 'storage_unavailable')):
            with self.subTest(reason=reason):
                self.transport.put_response = response
                self.assert_fixed_error(self.save(dict(PROFILE, avatar_image=data_url(jpeg_data(exif=True)))),
                                        status, reason)
                self.assertIn(self.object_url(old_ref), self.transport.objects)
                self.assertEqual(2, len(self.transport.objects))
                self.assertFalse(any(call[0] == 'delete' for call in self.transport.calls))

    def test_immutable_duplicate_reuse_requires_exact_existing_object_readback(self):
        first = self.save(dict(PROFILE, avatar_image=data_url(jpeg_data())))
        reference = first.json['profile']['avatar_image']
        self.transport.calls.clear()
        self.assertEqual(200, self.save(dict(PROFILE, avatar_image=data_url(jpeg_data()))).status_code)
        self.assertEqual(['get', 'post', 'get', 'put'], [call[0] for call in self.transport.calls])
        self.assertEqual(self.object_url(reference), self.transport.calls[2][1])
        self.transport.objects[self.object_url(reference)] = b'wrong object'
        self.transport.calls.clear()
        self.assert_fixed_error(self.save(dict(PROFILE, avatar_image=data_url(jpeg_data()))),
                                503, 'storage_unavailable')
        self.assertEqual(['get', 'post', 'get'], [call[0] for call in self.transport.calls])

    def test_avatar_get_uses_current_owner_ref_private_headers_and_fixed_bounds(self):
        reference, raw = self.install_image()
        result = self.image()
        self.assertEqual(200, result.status_code)
        self.assertEqual(raw, result.data)
        self.assertEqual('image/jpeg', result.headers['Content-Type'])
        self.assertEqual('no-store', result.headers['Cache-Control'])
        self.assertEqual('nosniff', result.headers['X-Content-Type-Options'])
        self.assertEqual(reference, result.headers['X-Avatar-Image'])
        self.assertEqual(['get', 'get'], [call[0] for call in self.transport.calls])
        self.assertEqual('Bearer alice-token', self.transport.calls[0][2]['headers']['Authorization'])
        method, endpoint, options = self.transport.calls[1]
        self.assertEqual(self.object_url(reference), endpoint)
        self.assertEqual('Bearer existing-api-key', options['headers']['Authorization'])
        self.assertFalse(options['allow_redirects'])
        self.assertTrue(options['stream'])
        self.assertTrue(all(response.closed for response in self.transport.responses))
        self.transport.calls.clear()
        self.assert_fixed_error(self.image(token='bob-token'), 404, 'avatar_not_found')
        self.assertEqual(['get'], [call[0] for call in self.transport.calls])
        self.assert_fixed_error(self.image(query_string={'owner_id': ALICE}), 400, 'invalid_request')

    def test_get_does_not_accept_other_owners_object_even_when_hash_is_known(self):
        reference, _ = self.install_image()
        self.transport.users['bob-token']['user_metadata']['kn_profile_v1'] = dict(PROFILE, avatar_image=reference)
        self.assert_fixed_error(self.image(token='bob-token'), 404, 'avatar_not_found')
        self.assertEqual(self.object_url(reference, BOB), self.transport.calls[-1][1])

    def test_avatar_get_rejects_redirect_wrong_mime_hash_size_length_and_read_errors(self):
        reference, raw = self.install_image()
        for response in (
                Response(raw=raw, status=302, headers={'Content-Type': 'image/jpeg'}),
                Response(raw=raw, headers={'Content-Type': 'text/html'}),
                Response(raw=b'other', headers={'Content-Type': 'image/jpeg'}),
                Response(raw=raw, headers={'Content-Type': 'image/jpeg', 'Content-Length': '49153'}),
                Response(raw=raw, headers={'Content-Type': 'image/jpeg', 'Content-Length': '1'}),
                Response(raw=raw, headers={'Content-Type': 'image/jpeg', 'Content-Length': 'not-a-number'}),
                Response(raw=raw, headers={'Content-Type': 'image/jpeg', 'Content-Encoding': 'gzip'}),
                Response(raw=b'x' * (MAX_AVATAR_BYTES + 1), headers={'Content-Type': 'image/jpeg'}),
                Response(raw=raw, fail_read=True, headers={'Content-Type': 'image/jpeg'})):
            with self.subTest(headers=response.headers):
                self.transport.storage_get_response = response
                self.assert_fixed_error(self.image(), 503, 'storage_unavailable')
                self.assertTrue(response.closed)
        self.transport.storage_get_response = None
        self.transport.storage_get_error = True
        self.assert_fixed_error(self.image(), 503, 'storage_unavailable')

    def test_get_rejects_hash_matching_non_jpeg_or_oversized_pixels(self):
        for raw in (b'not-jpeg', jpeg_data(257, 1)):
            self.install_image(raw)
            self.assert_fixed_error(self.image(), 503, 'storage_unavailable')

    def test_migration_is_private_restrictive_jpeg_only_and_does_not_change_other_buckets(self):
        sql = (Path(__file__).parents[1] / 'migrations/20261022_profile_avatars.sql').read_text()
        self.assertIn("false,49152,array['image/jpeg']", sql)
        self.assertIn('as restrictive', sql)
        self.assertIn('for all to anon, authenticated', sql)
        self.assertIn("using(bucket_id<>'website-profile-avatars')", sql)
        self.assertIn("with check(bucket_id<>'website-profile-avatars')", sql)
        self.assertIn('profile_avatar_bucket_configuration_mismatch', sql)
        self.assertNotIn('update storage.buckets', sql.lower())


if __name__ == '__main__':
    unittest.main()

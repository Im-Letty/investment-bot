"""Offline self-profile identity, input, privacy and transport boundaries."""

from copy import deepcopy
import json
from pathlib import Path
import unittest

from flask import Flask

from user_profile_api import (create_user_profile_blueprint, normalize_profile,
                              ProfileError, MAX_RESPONSE_BYTES)

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
                 ('application/json', json.dumps(dict(PROFILE, bio='x' * 5000)))]
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


if __name__ == '__main__':
    unittest.main()

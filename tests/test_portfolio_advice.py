"""Offline personal-advice contracts; every provider and owner is synthetic."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch

from flask import Flask
from community_api import CommunityError
from portfolio_advice import (AdviceError, GeminiPortfolioProvider, SQLiteAttemptStore,
                              asset_snapshot, create_portfolio_advice_blueprint, validate_response)


ANSWER = {'summary': '登録された金額の構成を確認しました。',
          'risks': [{'title': '確認できる情報の範囲', 'detail': '分類だけでは投資先の重複は分かりません。'}],
          'actions': ['生活費として必要な金額を整理してください。'],
          'questions': ['資産を使う予定はいつですか？']}


class Response:
    def __init__(self, value, status=200, raw=None):
        self.content = raw if raw is not None else json.dumps(value, ensure_ascii=False).encode()
        self.status_code, self.closed = status, False

    def iter_content(self, chunk_size):
        for offset in range(0, len(self.content), chunk_size):
            yield self.content[offset:offset + chunk_size]

    def close(self):
        self.closed = True


class Repository:
    url = 'https://synthetic-storage.invalid'
    key = 'synthetic-server-only'

    def __init__(self):
        self.transport, self.calls = self, []
        self.rows = {owner: {'kb2_assets': '[{"name":"private account label","cat":"現金","amount":1000}]'}
                     for owner in ('alice', 'bob')}

    def verify_user(self, token):
        if token not in self.rows:
            raise CommunityError('auth_required')
        return token

    def get(self, url, **kwargs):
        owner = kwargs['params']['owner_id'][3:]
        self.calls.append((owner, url, kwargs))
        return Response([{'data': self.rows[owner]}])


class PortfolioAdviceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = str(Path(self.temp.name) / 'attempts.db')
        self.env = {'PORTFOLIO_AI_ENABLED': '1', 'PORTFOLIO_AI_PAID_CONFIRMED': '1',
                    'PORTFOLIO_AI_QUOTA_PERSISTENT_CONFIRMED': '1',
                    'GEMINI_API_KEY': 'synthetic-never-used', 'PORTFOLIO_AI_QUOTA_DB': self.path,
                    'PORTFOLIO_AI_GLOBAL_MONTHLY_ATTEMPT_CAP': '100'}
        self.repo, self.calls = Repository(), []
        self.now = [datetime(2026, 10, 18, 3, tzinfo=timezone.utc).timestamp()]
        self.answer = deepcopy(ANSWER)
        self.failure = False
        self.client = self.make_client()

    def provider(self, payload):
        self.calls.append(deepcopy(payload))
        if self.failure:
            raise RuntimeError('private prompt https://secret.invalid/key=private')
        return deepcopy(self.answer)

    def make_client(self, env=None, store=None):
        app = Flask(__name__)
        app.register_blueprint(create_portfolio_advice_blueprint('', '', repository=self.repo,
                               provider=self.provider, store=store, environ=self.env if env is None else env,
                               clock=lambda: self.now[0]))
        return app.test_client()

    def headers(self, owner='alice'):
        return {'Authorization': 'Bearer ' + owner}

    def payload(self, owner='alice'):
        raw = self.repo.rows[owner].get('kb2_assets')
        return {'lang': 'ja', 'consent': True,
                'expected_assets_sha256': sha256(('null' if raw is None else raw).encode()).hexdigest(),
                'context': {'monthly_expense': None, 'horizon': 'unknown', 'loss_tolerance': 'unknown'}}

    def post(self, body=None, owner='alice', client=None):
        return (client or self.client).post('/api/portfolio-advice', headers=self.headers(owner),
                                           json=self.payload(owner) if body is None else body)

    def count(self):
        with sqlite3.connect(self.path) as connection:
            return connection.execute('SELECT count(*) FROM portfolio_attempts').fetchone()[0]

    def test_auth_required_before_configuration_or_storage(self):
        for route in ('/api/portfolio-advice/status', '/api/portfolio-advice'):
            result = self.client.get(route) if route.endswith('status') else self.client.post(route, json=self.payload())
            self.assertEqual(result.status_code, 401)
            self.assertEqual(result.json['error'], 'auth_required')
            self.assertEqual(result.headers['Cache-Control'], 'no-store')
        self.assertEqual(self.repo.calls, [])
        self.assertEqual(self.calls, [])
        self.assertFalse(Path(self.path).exists())
        self.assertEqual(self.post(owner='invalid', body=self.payload()).status_code, 401)

    def test_disabled_default_never_creates_store_or_calls_provider(self):
        disabled = self.make_client({})
        with patch('portfolio_advice.requests.post', side_effect=AssertionError('network forbidden')):
            status = disabled.get('/api/portfolio-advice/status', headers=self.headers())
            self.assertEqual(status.json, {'ok': True, 'ready': False, 'reason': 'disabled'})
            self.assertEqual(self.post(client=disabled).json['error'], 'disabled')
        self.assertFalse(Path(self.path).exists())
        self.assertEqual(self.repo.calls, [])
        self.assertEqual(self.calls, [])

    def test_paid_confirmation_and_all_configuration_fields_are_required(self):
        for field in ('PORTFOLIO_AI_PAID_CONFIRMED', 'PORTFOLIO_AI_QUOTA_PERSISTENT_CONFIRMED',
                      'GEMINI_API_KEY', 'PORTFOLIO_AI_QUOTA_DB',
                      'PORTFOLIO_AI_GLOBAL_MONTHLY_ATTEMPT_CAP'):
            env = dict(self.env); env.pop(field)
            result = self.make_client(env).get('/api/portfolio-advice/status', headers=self.headers())
            self.assertFalse(result.json['ready'])
        for cap in ('0', '-1', '1.5', 'many', ''):
            env = dict(self.env, PORTFOLIO_AI_GLOBAL_MONTHLY_ATTEMPT_CAP=cap)
            self.assertFalse(self.make_client(env).get('/api/portfolio-advice/status', headers=self.headers()).json['ready'])
        env = dict(self.env, PORTFOLIO_AI_QUOTA_DB='relative.db')
        self.assertFalse(self.make_client(env).get('/api/portfolio-advice/status', headers=self.headers()).json['ready'])
        self.assertFalse(Path(self.path).exists())

    def test_ready_status_does_not_reserve_or_generate(self):
        result = self.client.get('/api/portfolio-advice/status', headers=self.headers())
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.json['ready'])
        self.assertEqual(result.json['daily_attempt_limit'], 1)
        self.assertEqual(result.json['monthly_attempt_limit'], 20)
        self.assertEqual(self.count(), 0)
        self.assertEqual(self.calls, [])

    def test_strict_request_refuses_owner_selection_arbitrary_input_and_no_consent(self):
        for extra in ('user_id', 'summary', 'assets'):
            body = self.payload(); body[extra] = 'bob'
            self.assertEqual(self.post(body).status_code, 400)
        for change in ({'consent': False}, {'consent': 1}, {'lang': 'en'},
                       {'expected_assets_sha256': 'bad'}, {'context': []}):
            body = self.payload(); body.update(change)
            self.assertEqual(self.post(body).status_code, 400)
        for context in ({'monthly_expense': True, 'horizon': 'unknown', 'loss_tolerance': 'unknown'},
                        {'monthly_expense': -1, 'horizon': 'unknown', 'loss_tolerance': 'unknown'},
                        {'monthly_expense': '100', 'horizon': 'unknown', 'loss_tolerance': 'unknown'},
                        {'monthly_expense': None, 'horizon': 'tomorrow', 'loss_tolerance': 'unknown'},
                        {'monthly_expense': None, 'horizon': 'unknown', 'loss_tolerance': 'high', 'note': 'private'}):
            body = self.payload(); body['context'] = context
            self.assertEqual(self.post(body).status_code, 400)
        self.assertEqual(self.client.post('/api/portfolio-advice', headers=self.headers(), data='x' * 4097,
                                          content_type='application/json').status_code, 400)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.repo.calls, [])

    def test_duplicate_json_keys_and_nonfinite_request_are_rejected(self):
        valid = json.dumps(self.payload())
        for raw in ('{"lang":"ja",' + valid[1:], valid.replace('null', 'NaN')):
            result = self.client.post('/api/portfolio-advice', headers=self.headers(), data=raw,
                                      content_type='application/json')
            self.assertEqual(result.status_code, 400)
        self.assertEqual(self.calls, [])

    def test_owner_scoped_fetch_and_private_projection_only(self):
        self.repo.rows['alice'] = {'kb2_assets': json.dumps([
            {'name': 'private security name', 'cat': '現金', 'amount': 0.1},
            {'name': 'private bank', 'cat': '現金', 'amount': 0.2},
            {'name': 'private fund', 'cat': 'custom secret category', 'amount': 1.7}]),
            'kb2_mypage_planner': '{"notes":"private free memo"}'}
        result = self.post()
        self.assertEqual(result.status_code, 200)
        self.assertFalse(result.json['cached'])
        self.assertEqual(self.count(), 1)
        owner, url, kwargs = self.repo.calls[0]
        self.assertEqual(owner, 'alice')
        self.assertTrue(url.endswith('/rest/v1/private_household_ledgers'))
        self.assertFalse(kwargs['allow_redirects'])
        payload = self.calls[0]
        self.assertEqual(payload['portfolio']['total_jpy'], '2')
        self.assertEqual(payload['portfolio']['categories'][0],
                         {'category': 'cash', 'amount_jpy': '0.3', 'share_percent': '15', 'asset_count': 2})
        self.assertEqual(payload['context'], {'monthly_expense': None, 'horizon': 'unknown', 'loss_tolerance': 'unknown'})
        text = json.dumps(payload)
        for private in ('alice', 'private', 'custom secret category', 'synthetic-server-only', 'Bearer'):
            self.assertNotIn(private, text)
        self.assertEqual(result.headers['Vary'], 'Authorization')

    def test_stale_raw_assets_hash_fails_before_attempt_even_for_identical_values(self):
        body = self.payload()
        self.repo.rows['alice']['kb2_assets'] += ' '
        result = self.post(body)
        self.assertEqual(result.status_code, 409)
        self.assertEqual(result.json['error'], 'stale_assets')
        self.assertEqual(self.count(), 0)
        self.assertEqual(self.calls, [])

    def test_missing_zero_negative_or_corrupt_assets_do_not_generate(self):
        cases = [(None, 'assets_required'), ('[]', 'assets_required'),
                 ('[{"amount":0}]', 'assets_required'), ('[{"amount":-1}]', 'negative_assets'),
                 ('[{"amount":false}]', 'assets_unreadable'), ('[{"amount":"100"}]', 'assets_unreadable'),
                 ('[{"amount":NaN}]', 'assets_unreadable'), ('[{"amount":Infinity}]', 'assets_unreadable'),
                 ('[{"amount":1e100000}]', 'assets_unreadable'), ('[{"amount":1e-100000}]', 'assets_unreadable'),
                 ('[{"amount":9007199254740991},{"amount":1}]', 'assets_unreadable'),
                 ('[{"amount":1,"amount":2}]', 'assets_unreadable'), ('{', 'assets_unreadable')]
        for raw, reason in cases:
            self.repo.rows['alice']['kb2_assets'] = raw
            result = self.post()
            self.assertEqual(result.status_code, 422, raw)
            self.assertEqual(result.json['error'], reason, raw)
        self.assertEqual(self.count(), 0)
        self.assertEqual(self.calls, [])

    def test_cache_is_owner_and_snapshot_context_separated(self):
        self.assertEqual(self.post().status_code, 200)
        self.assertTrue(self.post().json['cached'])
        self.assertEqual(self.post(owner='bob').status_code, 200)
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(self.count(), 2)
        body = self.payload(); body['context']['horizon'] = 'under_3'
        self.assertEqual(self.post(body).json['error'], 'daily_limit')
        self.now[0] += 86400
        self.assertFalse(self.post(body).json['cached'])
        self.assertEqual(len(self.calls), 3)
        body = self.payload(); self.repo.rows['alice']['kb2_assets'] = '[{"amount":2000,"cat":"現金"}]'
        self.assertEqual(self.post(body).json['error'], 'stale_assets')
        self.assertEqual(len(self.calls), 3)

    def test_failure_consumes_attempt_and_raw_errors_do_not_escape(self):
        self.failure = True
        first = self.post()
        self.assertEqual(first.status_code, 503)
        self.assertEqual(first.json, {'ok': False, 'error': 'provider_unavailable'})
        self.assertNotIn('private', first.text)
        second = self.post()
        self.assertEqual(second.status_code, 429)
        self.assertEqual(second.json['error'], 'daily_limit')
        self.assertGreater(int(second.headers['Retry-After']), 0)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.count(), 1)

    def test_invalid_provider_response_is_not_cached_and_consumes_attempt(self):
        self.answer['score'] = 100
        self.assertEqual(self.post().json['error'], 'invalid_ai_response')
        self.assertEqual(self.post().json['error'], 'daily_limit')
        self.assertEqual(self.count(), 1)

    def test_store_or_storage_failure_is_closed_without_provider_contact(self):
        class BrokenStore:
            def ensure(self):
                raise RuntimeError('secret path https://private.invalid')
        client = self.make_client(store=BrokenStore())
        self.assertEqual(self.post(client=client).json, {'ok': False, 'error': 'quota_unavailable'})
        def fail(*args, **kwargs):
            raise RuntimeError('private owner record https://key.invalid')
        self.repo.get = fail
        self.assertEqual(self.post().json, {'ok': False, 'error': 'storage_unavailable'})
        self.assertEqual(self.calls, [])

    def test_global_cap_applies_across_verified_owners(self):
        client = self.make_client(dict(self.env, PORTFOLIO_AI_GLOBAL_MONTHLY_ATTEMPT_CAP='1'))
        self.assertEqual(self.post(client=client).status_code, 200)
        result = self.post(owner='bob', client=client)
        self.assertEqual(result.status_code, 429)
        self.assertEqual(result.json['error'], 'global_limit')
        self.assertEqual(len(self.calls), 1)

    def test_persistent_cap_survives_new_blueprint_and_monthly_rollover(self):
        self.assertEqual(self.post().status_code, 200)
        self.assertEqual(self.post(client=self.make_client()).json['error'], 'daily_limit')
        self.now[0] = datetime(2026, 11, 1, 3, tzinfo=timezone.utc).timestamp()
        self.assertEqual(self.post(client=self.make_client()).status_code, 200)
        self.assertEqual(self.count(), 2)

    def test_attempt_day_changes_at_jst_midnight(self):
        store = SQLiteAttemptStore(self.path); store.ensure()
        before = datetime(2026, 10, 18, 14, 59, 59, tzinfo=timezone.utc).timestamp()
        store.reserve('alice', before, 100)
        with self.assertRaises(AdviceError) as result:
            store.reserve('alice', before + 0.5, 100)
        self.assertEqual(result.exception.reason, 'daily_limit')
        store.reserve('alice', before + 1, 100)
        self.assertEqual(self.count(), 2)

    def test_cache_expiry_requires_a_new_attempt_instead_of_silent_refresh(self):
        self.assertEqual(self.post().status_code, 200)
        self.now[0] += 6 * 3600
        result = self.post()
        self.assertEqual(result.status_code, 429)
        self.assertEqual(result.json['error'], 'daily_limit')
        self.assertEqual(len(self.calls), 1)

    def test_raw_storage_shape_and_response_size_fail_closed(self):
        for response in (Response({'data': {}}), Response([{'data': []}]),
                         Response([{'data': {}}, {'data': {}}]), Response({}, raw=b'x' * 2_100_001)):
            self.repo.get = lambda *args, _response=response, **kwargs: _response
            result = self.post()
            self.assertEqual(result.status_code, 503)
            self.assertEqual(result.json['error'], 'storage_unavailable')
        self.assertEqual(self.calls, [])
        self.assertEqual(self.count(), 0)

    def test_atomic_reservation_across_instances_and_failure_independent_counting(self):
        stores = [SQLiteAttemptStore(self.path) for _ in range(8)]
        stores[0].ensure()
        barrier = threading.Barrier(len(stores))
        def reserve(store):
            barrier.wait()
            try:
                store.reserve('alice', self.now[0], 100)
                return 'reserved'
            except AdviceError as error:
                return error.reason
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(reserve, stores))
        self.assertEqual(results.count('reserved'), 1)
        self.assertEqual(results.count('daily_limit'), 7)
        self.assertEqual(self.count(), 1)

    def test_monthly_user_cap_includes_each_reserved_day(self):
        store = SQLiteAttemptStore(self.path); store.ensure()
        first = datetime(2026, 10, 1, 3, tzinfo=timezone.utc).timestamp()
        for day in range(20):
            store.reserve('alice', first + day * 86400, 100)
        with self.assertRaises(AdviceError) as result:
            store.reserve('alice', first + 20 * 86400, 100)
        self.assertEqual(result.exception.reason, 'monthly_limit')
        self.assertEqual(self.count(), 20)


class ProviderContractTests(unittest.TestCase):
    def test_fixed_rest_adapter_key_header_bounds_and_no_retry(self):
        calls = []
        response = Response({'candidates': [{'finishReason': 'STOP', 'content': {
            'parts': [{'text': json.dumps(ANSWER, ensure_ascii=False)}]}}]})
        class Transport:
            def post(self, url, **kwargs):
                calls.append((url, kwargs)); return response
        provider = GeminiPortfolioProvider('synthetic-secret', transport=Transport())
        self.assertEqual(provider({'portfolio': {'total_jpy': '100'}}), ANSWER)
        self.assertEqual(len(calls), 1)
        url, kwargs = calls[0]
        self.assertNotIn('synthetic-secret', url)
        self.assertEqual(kwargs['headers'], {'x-goog-api-key': 'synthetic-secret'})
        self.assertEqual(kwargs['timeout'], (3, 20))
        self.assertFalse(kwargs['allow_redirects'])
        self.assertEqual(kwargs['json']['generationConfig']['maxOutputTokens'], 2048)
        self.assertTrue(response.closed)

    def test_provider_rejection_oversize_and_bad_json_are_safe(self):
        for response in (Response({}, status=429), Response({}, raw=b'x' * 32769), Response({}, raw=b'not json'),
                         Response({'candidates': [{'finishReason': 'SAFETY'}]})):
            class Transport:
                def post(self, *args, **kwargs):
                    return response
            provider = GeminiPortfolioProvider('synthetic-secret', transport=Transport())
            with self.assertRaises(AdviceError) as result:
                provider({'safe': True})
            self.assertEqual(result.exception.reason, 'provider_unavailable')
            self.assertTrue(response.closed)

    def test_response_schema_requires_text_limits_and_refuses_score_markup_and_orders(self):
        self.assertEqual(validate_response(ANSWER), ANSWER)
        cases = [dict(ANSWER, score=99), dict(ANSWER, summary='x' * 401), dict(ANSWER, summary='<script>alert(1)</script>'),
                 dict(ANSWER, actions=['https://private.invalid']), dict(ANSWER, actions=['この銘柄を購入してください。']),
                 dict(ANSWER, actions=['Buy ABC shares now.']), dict(ANSWER, risks=[{'title': 'x', 'detail': 'y', 'extra': 1}]),
                 dict(ANSWER, questions=[None]), dict(ANSWER, actions=['x'] * 4), dict(ANSWER, summary=''),
                 dict(ANSWER, risks=[]), dict(ANSWER, actions=[])]
        for answer in cases:
            with self.assertRaises(AdviceError):
                validate_response(answer)

    def test_exact_fraction_and_custom_group_without_security_inference(self):
        result = asset_snapshot('[{"amount":0.000000000000000001,"cat":"未分類の個人口座"},'
                                '{"amount":0.000000000000000002,"cat":"未分類の別口座"}]')
        self.assertEqual(result['total_jpy'], '0.000000000000000003')
        self.assertEqual(result['categories'][0]['category'], 'other')
        self.assertEqual(result['categories'][0]['asset_count'], 2)


if __name__ == '__main__':
    unittest.main()

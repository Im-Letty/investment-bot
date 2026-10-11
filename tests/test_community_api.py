"""Offline API/auth/storage boundaries; no real posts or Supabase requests.

The fake RPC exercises the app protocol. The SQL contract checks protect grants
and invariants but do not claim to prove live Postgres locking or installation.
"""

from copy import deepcopy
import json
from pathlib import Path
import threading
import unittest
import uuid

from flask import Flask

from community_api import (
    CommunityError, MAX_REQUEST_BYTES, SupabaseCommunityRepository,
    register_community_routes,
)


ALICE = '76a634a5-f088-4141-9a30-09320f3a99cc'
BOB = 'f6b0c69e-8042-4730-a5d7-802d3096a075'


def example(**overrides):
    value = dict(id=1, name='テスト', body='物価のニュースをどう見ていますか？', category='economy',
                 language='ja', created_at='2026-10-12T00:00:00+00:00', parent_id=None,
                 reply_count=0, like_count=0, is_mine=False, liked_by_me=False)
    value.update(overrides)
    return value


class FakeRPC:
    def __init__(self):
        self.calls, self.auth_calls = [], []
        self.rows, self.requests, self.limits, self.reports, self.likes = {}, {}, {}, set(), set()
        self.now = 1000
        self.lock = threading.Lock()
        self.failure = None
        self.override = None

    def verify_user(self, token):
        self.auth_calls.append(token)
        if token == 'auth-offline':
            raise CommunityError('auth_unavailable')
        if token not in ('alice', 'bob'):
            raise CommunityError('auth_required')
        return ALICE if token == 'alice' else BOB

    def public(self, row, actor):
        item = example(**deepcopy(row))
        item.update(is_mine=row['user_id'] == actor,
                    liked_by_me=(row['id'], actor) in self.likes,
                    reply_count=sum(r.get('parent_id') == row['id'] and not r.get('deleted') for r in self.rows.values()),
                    like_count=sum(post == row['id'] for post, _ in self.likes))
        # Deliberately adversarial extra fields: the app must remove these.
        item.update(email='private@example.invalid', phone='private-phone', token='private-token')
        return item

    def call(self, action, actor=None, data=None):
        with self.lock:
            data = data or {}
            self.calls.append((action, actor, deepcopy(data)))
            if self.failure:
                raise self.failure
            if self.override is not None:
                return deepcopy(self.override)
            if action == 'create':
                parent = self.rows.get(data['parent_id']) if data['parent_id'] else None
                if data['parent_id'] and (not parent or parent.get('deleted') or parent['parent_id']):
                    return dict(ok=False, reason='invalid_parent')
                item = deepcopy(data)
                if parent:
                    item['category'] = parent['category']
                key = actor, item['request_id']
                if key in self.requests:
                    stored = self.rows[self.requests[key]]
                    if any(stored[field] != item[field] for field in data):
                        return dict(ok=False, reason='request_conflict')
                    return dict(ok=True, post=self.public(stored, actor))
                if self.now - self.limits.get(actor, 0) < 10:
                    return dict(ok=False, reason='rate_limited', retry_after=10)
                item.update(id=len(self.rows)+1, user_id=actor)
                self.rows[item['id']] = item
                self.requests[key], self.limits[actor] = item['id'], self.now
                return dict(ok=True, post=self.public(item, actor))
            if action in ('list', 'replies'):
                parent = data.get('post_id')
                if action == 'replies' and (parent not in self.rows or self.rows[parent].get('deleted')):
                    return dict(ok=False, reason='not_found')
                rows = [r for r in self.rows.values() if not r.get('deleted') and r['parent_id'] == parent]
                if action == 'list':
                    rows = [r for r in rows if (data['category'] == 'all' or r['category'] == data['category'])
                            and (not data['before'] or r['id'] < data['before'])]
                else:
                    rows = [r for r in rows if not data['after'] or r['id'] > data['after']]
                rows.sort(key=lambda r:r['id'], reverse=action == 'list')
                more = len(rows) > data['limit']
                rows = rows[:data['limit']]
                return dict(ok=True, posts=[self.public(r, actor) for r in rows], has_more=more,
                            next_cursor=rows[-1]['id'] if more else None)
            if action == 'delete':
                row = self.rows.get(data['post_id'])
                if not row or row['user_id'] != actor:
                    return dict(ok=False, reason='not_found')
                row['deleted'] = True
                return dict(ok=True)
            if action in ('report', 'like'):
                row = self.rows.get(data['post_id'])
                if not row or row.get('deleted'):
                    return dict(ok=False, reason='not_found')
                pair = data['post_id'], actor
                if action == 'report':
                    self.reports.add(pair)
                    return dict(ok=True)
                self.likes.add(pair) if data['liked'] else self.likes.discard(pair)
                return dict(ok=True, liked=data['liked'], like_count=sum(p == pair[0] for p, _ in self.likes))
            if action == 'report_list':
                return dict(ok=True, reports=[dict(id=1, post_id=1, reason='spam',
                    created_at='2026-10-12T00:00:00+00:00', user_id=ALICE, secret='not-public',
                    post=example(hidden=True,deleted=False,user_id=BOB,secret='not-public'))])
            if action == 'moderate':
                return dict(ok=True)
            raise AssertionError(action)


class CommunityAPITests(unittest.TestCase):
    def setUp(self):
        self.repo = FakeRPC()
        self.app = Flask(__name__)
        register_community_routes(self.app, '', '', repository=self.repo,
                                  check_admin=lambda req:req.headers.get('X-Admin-Pass') == 'test-admin')
        self.client = self.app.test_client()

    def write(self, body=None, token='alice', **overrides):
        data = dict(name='テスト', body=body if body is not None else '経済の話をしよう', category='economy',
                    language='ja', parent_id=None, request_id=str(uuid.uuid4()))
        data.update(overrides)
        response = self.client.post('/api/community/posts', json=data,
                                    headers={'Authorization':'Bearer '+token} if token else {})
        return response, data

    def test_public_browsing_does_not_contact_auth_or_expose_identity(self):
        self.write()
        self.repo.auth_calls.clear()
        response = self.client.get('/api/community/posts')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.repo.auth_calls, [])
        post = response.json['posts'][0]
        self.assertFalse(post['is_mine'])
        self.assertFalse(post['liked_by_me'])
        for key in ('user_id','request_id','email','phone','token'):
            self.assertNotIn(key, post)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_all_writes_require_verified_identity_and_ignore_client_user_id(self):
        response, _ = self.write(token=None)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.repo.calls, [])
        response, _ = self.write(user_id=BOB)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.repo.calls[-1][1], ALICE)
        self.assertNotIn('user_id', self.repo.calls[-1][2])
        self.assertTrue(response.json['post']['is_mine'])
        for method, suffix, data in (('delete','',None), ('post','/report',{'reason':'spam'}),
                                     ('post','/like',{'liked':True})):
            response = getattr(self.client, method)('/api/community/posts/1'+suffix, json=data)
            self.assertEqual(response.status_code, 401)

    def test_expired_token_and_auth_outage_are_distinct(self):
        for token, status, reason in (('invalid',401,'auth_required'), ('auth-offline',503,'auth_unavailable')):
            response, _ = self.write(token=token)
            self.assertEqual((response.status_code,response.json['reason']), (status,reason))
        response = self.client.get('/api/community/posts', headers={'Authorization':'Bearer invalid'})
        self.assertEqual(response.status_code, 401)

    def test_supplemental_names_never_grant_delete_permission(self):
        self.write(name='同じ名前')
        response = self.client.delete('/api/community/posts/1', headers={'Authorization':'Bearer bob'})
        self.assertEqual(response.status_code,404)
        response = self.client.delete('/api/community/posts/1', headers={'Authorization':'Bearer alice'})
        self.assertEqual(response.status_code,200)
        self.assertEqual(self.client.get('/api/community/posts').json['posts'], [])
        self.assertIn(1,self.repo.rows)  # Soft deletion; storage record remains.

    def test_post_idempotency_and_payload_conflict(self):
        response, data = self.write()
        first = response.json['post']['id']
        repeat = self.client.post('/api/community/posts', json=data, headers={'Authorization':'Bearer alice'})
        self.assertEqual(repeat.json['post']['id'],first)
        self.assertEqual(len(self.repo.rows),1)
        data['body']='別の文章'
        response = self.client.post('/api/community/posts', json=data, headers={'Authorization':'Bearer alice'})
        self.assertEqual((response.status_code,response.json['reason']), (409,'request_conflict'))

    def test_limit_does_not_block_another_person_and_sends_retry_after(self):
        self.write()
        response, _ = self.write()
        self.assertEqual((response.status_code,response.json['reason']), (429,'rate_limited'))
        self.assertEqual(response.headers['Retry-After'],'10')
        response, _ = self.write(token='bob')
        self.assertEqual(response.status_code,200)
        self.repo.now += 10
        self.assertEqual(self.write()[0].status_code,200)

    def test_reply_inherits_root_category_and_cannot_form_second_layer(self):
        self.write(category='news')
        self.repo.now += 10
        response, _ = self.write(parent_id=1,category='chat')
        self.assertEqual(response.json['post']['category'],'news')
        self.repo.now += 10
        response, _ = self.write(parent_id=2)
        self.assertEqual((response.status_code,response.json['reason']), (400,'invalid_parent'))
        root = self.client.get('/api/community/posts').json['posts']
        self.assertEqual(len(root),1)
        self.assertEqual(root[0]['reply_count'],1)
        replies = self.client.get('/api/community/posts/1/replies').json['posts']
        self.assertEqual([p['id'] for p in replies],[2])

    def test_likes_are_explicit_idempotent_set_and_reports_private(self):
        self.write()
        for _ in range(2):
            response=self.client.post('/api/community/posts/1/like',json={'liked':True},
                                      headers={'Authorization':'Bearer bob'})
            self.assertEqual(response.json,dict(ok=True,liked=True,like_count=1))
            response=self.client.post('/api/community/posts/1/report',json={'reason':'privacy'},
                                      headers={'Authorization':'Bearer bob'})
            self.assertEqual(response.json,dict(ok=True))
        self.assertEqual(len(self.repo.reports),1)
        response=self.client.get('/api/community/posts',headers={'Authorization':'Bearer bob'})
        self.assertTrue(response.json['posts'][0]['liked_by_me'])
        self.assertNotIn('reports',response.json['posts'][0])
        response=self.client.post('/api/community/posts/1/like',json={'liked':False},
                                  headers={'Authorization':'Bearer bob'})
        self.assertEqual(response.json['like_count'],0)

    def test_root_and_reply_pagination_have_correct_directions(self):
        for _ in range(3):
            self.write(); self.repo.now += 10
        response=self.client.get('/api/community/posts?limit=2')
        self.assertEqual([p['id'] for p in response.json['posts']],[3,2])
        self.assertEqual(response.json['next_cursor'],2)
        response=self.client.get('/api/community/posts?before=2&limit=2')
        self.assertEqual([p['id'] for p in response.json['posts']],[1])
        self.assertFalse(response.json['has_more'])
        for _ in range(3):
            self.write(parent_id=1); self.repo.now += 10
        response=self.client.get('/api/community/posts/1/replies?limit=2')
        self.assertEqual([p['id'] for p in response.json['posts']],[4,5])
        response=self.client.get('/api/community/posts/1/replies?after=5&limit=2')
        self.assertEqual([p['id'] for p in response.json['posts']],[6])

    def test_incomplete_storage_is_never_a_successful_empty_feed(self):
        for bad in ({'ok':True}, {'ok':True,'posts':[],'has_more':'false'},
                    {'ok':True,'posts':[example(body='')],'has_more':False,'next_cursor':None},
                    {'ok':True,'posts':[example()],'has_more':True,'next_cursor':7}):
            self.repo.override=bad
            response=self.client.get('/api/community/posts')
            self.assertEqual((response.status_code,response.json),
                             (503,{'ok':False,'reason':'storage_unavailable'}))
        self.repo.override=None
        self.repo.failure=RuntimeError('private-secret-token')
        response=self.client.get('/api/community/posts')
        self.assertEqual(response.status_code,503)
        self.assertNotIn('private-secret',response.get_data(as_text=True))

    def test_invalid_input_types_lengths_and_cursors_do_not_reach_rpc(self):
        cases=[({'body':[]},'empty'), ({'body':' '},'empty'), ({'body':'x'*201},'too_long'),
               ({'name':'x'*21},'invalid_name'), ({'name':{}},'invalid_name'),
               ({'category':[]},'invalid_category'), ({'category':'stocks'},'invalid_category'),
               ({'language':{}},'invalid_language'), ({'parent_id':True},'invalid_parent'),
               ({'request_id':'not-uuid'},'invalid_request_id')]
        for data,reason in cases:
            with self.subTest(data=data):
                response,_=self.write(**data)
                self.assertEqual((response.status_code,response.json['reason']),(400,reason))
        self.assertEqual(self.repo.calls,[])
        for query in ('before=0','before=-1','before=9007199254740992','limit=21','limit=0'):
            self.assertEqual(self.client.get('/api/community/posts?'+query).status_code,400)
        for data in (None, [], True, 'body'):
            response=self.client.post('/api/community/posts', data=json.dumps(data),
                                      content_type='application/json',headers={'Authorization':'Bearer alice'})
            self.assertEqual(response.status_code,400)
        response=self.client.post('/api/community/posts',data=b'x'*(MAX_REQUEST_BYTES+1),
                                  content_type='application/json',headers={'Authorization':'Bearer alice'})
        self.assertEqual(response.status_code,400)

    def test_multibyte_character_limit_is_not_a_byte_limit(self):
        response,_=self.write(body='😀'*200)
        self.assertEqual(response.status_code,200)
        self.repo.now+=10
        response,_=self.write(body='😀'*201)
        self.assertEqual(response.status_code,400)

    def test_admin_routes_are_protected_and_strip_reporter_identity(self):
        response=self.client.get('/api/community/moderation/reports')
        self.assertEqual(response.status_code,403)
        self.assertEqual(self.repo.calls,[])
        response=self.client.get('/api/community/moderation/reports',headers={'X-Admin-Pass':'test-admin'})
        self.assertEqual(response.status_code,200)
        self.assertNotIn('user_id',response.json['reports'][0])
        self.assertNotIn('secret',response.json['reports'][0])
        self.assertNotIn('user_id',response.json['reports'][0]['post'])
        self.assertNotIn('secret',response.json['reports'][0]['post'])
        self.assertEqual(response.json['reports'][0]['post']['body'],example()['body'])
        self.assertTrue(response.json['reports'][0]['post']['hidden'])
        response=self.client.post('/api/community/posts/1/moderate',json={'hidden':True})
        self.assertEqual(response.status_code,403)
        response=self.client.post('/api/community/posts/1/moderate',json={'hidden':True},
                                  headers={'X-Admin-Pass':'test-admin'})
        self.assertEqual(response.status_code,200)

    def test_admin_body_and_query_secrets_are_rejected_before_legacy_callback(self):
        app=Flask('legacy-admin')
        calls=[]
        def legacy_check(req):
            calls.append(True)
            return req.headers.get('X-Admin-Pass')=='test-admin' or (req.get_json(silent=True) or {}).get('pass')=='test-admin'
        register_community_routes(app,'','',repository=self.repo,check_admin=legacy_check)
        client=app.test_client()
        for url in ('/api/community/posts/1/moderate','/api/community/posts/1/moderate?pass=test-admin'):
            response=client.post(url,json={'pass':'test-admin','hidden':True})
            self.assertEqual(response.status_code,403)
        self.assertEqual(calls,[])
        response=client.post('/api/community/posts/1/moderate',json={'hidden':True},
                             headers={'X-Admin-Pass':'test-admin'})
        self.assertEqual(response.status_code,200)


class Response:
    def __init__(self,status=200,value=None):
        self.status_code=status; self.value=value; self.content=json.dumps(value).encode()
    def json(self): return deepcopy(self.value)


class Transport:
    def __init__(self):
        self.calls=[]; self.response=Response(value={'id':ALICE,'email':'must-not-return','phone':'must-not-return'})
    def get(self,url,**options):
        self.calls.append(('GET',url,options)); return self.response
    def post(self,url,**options):
        self.calls.append(('POST',url,options)); return self.response


class RepositoryBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.transport=Transport()
        self.repo=SupabaseCommunityRepository('https://example.supabase.co/','test-service-key',transport=self.transport)

    def test_auth_uses_bearer_token_without_shared_session_and_returns_uuid_only(self):
        self.assertEqual(self.repo.verify_user('test-user-token'),ALICE)
        method,url,options=self.transport.calls[0]
        self.assertEqual((method,url),('GET','https://example.supabase.co/auth/v1/user'))
        self.assertEqual(options['headers']['Authorization'],'Bearer test-user-token')
        self.assertEqual(options['timeout'],(2,5))
        self.assertFalse(options['allow_redirects'])

    def test_auth_invalid_outage_redirect_and_bad_result_are_distinct(self):
        for status,value,reason in ((401,{},'auth_required'),(500,{},'auth_unavailable'),
                                    (302,{},'auth_unavailable'),(200,{'id':'bad'},'auth_unavailable')):
            self.transport.response=Response(status,value)
            with self.assertRaises(CommunityError) as caught:self.repo.verify_user('user-token')
            self.assertEqual(caught.exception.reason,reason)

    def test_rpc_endpoint_and_authorization_do_not_use_user_token_as_service_key(self):
        self.transport.response=Response(value={'ok':True,'posts':[],'has_more':False,'next_cursor':None})
        self.repo.call('list',ALICE,{'category':'all'})
        method,url,options=self.transport.calls[0]
        self.assertEqual((method,url),('POST','https://example.supabase.co/rest/v1/rpc/world_community_operation'))
        self.assertEqual(options['headers']['Authorization'],'Bearer test-service-key')
        self.assertEqual(options['json']['p_actor'],ALICE)
        self.assertEqual(options['timeout'],(2,8))
        self.assertFalse(options['allow_redirects'])

    def test_missing_migration_or_rpc_error_never_leaks_response_or_returns_empty(self):
        for status,value in ((404,{'message':'secret schema'}),(500,{'secret':'private'}),
                             (200,{'ok':False,'reason':['private-error']})):
            self.transport.response=Response(status,value)
            with self.assertRaises(CommunityError) as caught:self.repo.call('list')
            self.assertEqual(caught.exception.reason,'storage_unavailable')


class SQLContractTests(unittest.TestCase):
    def test_new_private_tables_rpc_grants_and_concurrency_contract(self):
        sql=(Path(__file__).parents[1]/'migrations/20261012_world_community.sql').read_text()
        lowered=sql.lower()
        for table in ('community_posts','community_reports','community_reactions','community_post_limits'):
            self.assertIn('alter table public.'+table+' enable row level security',lowered)
        self.assertNotRegex(lowered,r'(?:alter|insert into|update|delete from)\s+(?:public\.)?(?:messages|stock_comments)\b')
        self.assertIn('unique(user_id, request_id)',lowered)
        self.assertIn('primary key(post_id,user_id)',lowered)
        self.assertIn('unique(post_id,user_id)',lowered)
        self.assertIn('pg_advisory_xact_lock',lowered)
        self.assertIn("interval '10 seconds'",lowered)
        self.assertIn('v_category:=v_parent.category',lowered)
        self.assertIn('parent_id is null and deleted_at is null and hidden_at is null for share',lowered)
        self.assertIn('where id=v_id and user_id=p_actor for update',lowered)
        self.assertIn('set search_path = public, pg_temp',lowered)
        self.assertIn('revoke all on function public.world_community_operation(text,uuid,jsonb) from public, anon, authenticated',lowered)
        self.assertIn('grant execute on function public.world_community_operation(text,uuid,jsonb) to service_role',lowered)
        self.assertNotRegex(lowered,r'grant\s+(?:all|execute|insert|update|delete).*to\s+(?:public|anon|authenticated)')


if __name__=='__main__':
    unittest.main()

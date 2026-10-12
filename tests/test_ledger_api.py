import unittest
from flask import Flask
from ledger_api import create_ledger_blueprint
from community_api import CommunityError

class Response:
    status_code=200
    def __init__(self, data): self.data=data
    def json(self): return self.data
class Repository:
    url='https://storage.test';key='server-only'
    def __init__(self): self.transport=self;self.rows={};self.calls=[]
    def verify_user(self, token):
        if token not in ('alice','bob'): raise CommunityError('auth_required')
        return token
    def get(self,url,**kw):
        actor=kw['params']['owner_id'][3:];self.calls.append(actor)
        return Response([{'data':self.rows[actor]}] if actor in self.rows else [])
    def post(self,url,**kw):
        self.rows[kw['json']['owner_id']]=kw['json']['data'];return Response(None)
class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.repo=Repository();app=Flask(__name__);app.register_blueprint(create_ledger_blueprint('', '',repository=self.repo));self.c=app.test_client()
    def headers(self,user): return {'Authorization':'Bearer '+user}
    def test_no_auth_cannot_read_or_write_even_with_uid(self):
        self.assertEqual(self.c.get('/api/kakeibo/load?uid=alice').status_code,401)
        self.assertEqual(self.c.post('/api/kakeibo/save',json={'uid':'alice','data':{}}).status_code,401)
        self.assertEqual(self.repo.calls,[])
    def test_verified_owners_are_isolated(self):
        data={'kb2_2026_10':'[{"name":"synthetic","amount":1}]'}
        self.assertEqual(self.c.post('/api/kakeibo/save',headers=self.headers('alice'),json={'data':data}).status_code,200)
        self.assertIsNone(self.c.get('/api/kakeibo/load',headers=self.headers('bob')).json['data'])
        self.c.post('/api/kakeibo/save',headers=self.headers('bob'),json={'data':{'kb2_assets':'[]'}})
        r=self.c.get('/api/kakeibo/load',headers=self.headers('alice'));self.assertEqual(r.json['data'],data)
        self.assertEqual(r.headers['Cache-Control'],'no-store')
    def test_cannot_choose_another_owner(self):
        self.assertEqual(self.c.get('/api/kakeibo/load?uid=alice',headers=self.headers('bob')).status_code,400)
        self.assertEqual(self.c.post('/api/kakeibo/save',headers=self.headers('bob'),json={'uid':'alice','data':{}}).status_code,400)
        self.assertEqual(self.repo.rows,{})
    def test_invalid_token_and_payload_fail_closed(self):
        self.assertEqual(self.c.get('/api/kakeibo/load',headers=self.headers('invalid')).status_code,401)
        for data in [{'userId':'alice'},{'kb2_2026_10':[]},['bad']]:
            self.assertEqual(self.c.post('/api/kakeibo/save',headers=self.headers('alice'),json={'data':data}).status_code,400)
    def test_transport_errors_are_not_leaked(self):
        def fail(*a,**k): raise RuntimeError('secret')
        self.repo.get=fail
        r=self.c.get('/api/kakeibo/load',headers=self.headers('alice'));self.assertEqual(r.status_code,503);self.assertNotIn('secret',r.text)
if __name__=='__main__':unittest.main()

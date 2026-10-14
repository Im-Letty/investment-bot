import unittest
from flask import Flask
from stock_talk import create_stock_talk_blueprint,StockRooms,legacy_symbol_allowed
from tests.test_community_api import FakeRPC,ALICE
import uuid
class Catalogue:
    def company(self,code):
        code=code.removesuffix('.JP') if isinstance(code,str) else code
        return {'code':code,'name':'会社'+code} if code in ('7203','1832','6758') else None
    def _local(self,q):return [{'symbol':q+'.JP','name':'会社'+q}] if self.company(q) else []
class StockTests(unittest.TestCase):
    def setUp(self):
        self.repo=FakeRPC();self.app=Flask(__name__);self.app.register_blueprint(create_stock_talk_blueprint('','',Catalogue(),repository=self.repo,check_admin=lambda r:r.headers.get('X-Admin-Pass')=='manager'));self.c=self.app.test_client()
    def test_only_known_canonical_rooms_and_retained_indexes_are_accepted(self):
        rooms=StockRooms(Catalogue())
        for good in ['stock:7203','stock:1832','index:N225']:self.assertIn(good,rooms)
        for bad in ['stock:9999','7203.T','1832.JP','stock:7203.T','chat',None]:self.assertNotIn(bad,rooms)
        self.assertEqual(self.c.get('/api/stock-talk/posts?category=all').status_code,400)
        self.assertEqual(self.c.get('/api/stock-talk/posts?category=stock:9999').status_code,400)
    def test_search_exposes_only_catalogue_room_and_company_label(self):
        r=self.c.get('/api/stock-talk/rooms?q=1832');self.assertEqual(r.json['rooms'],[{'category':'stock:1832','name':'会社1832','code':'1832'}])
    def test_real_catalogue_search_returns_verified_regional_and_tokyo_room_ids(self):
        from stock_search import StockSearch
        catalogue=StockSearch(runtime_path=None)
        app=Flask('real_catalogue');app.register_blueprint(create_stock_talk_blueprint('','',catalogue,repository=self.repo))
        for code in ['1832','7203']:
            r=app.test_client().get('/api/stock-talk/rooms?q='+code)
            self.assertEqual(r.status_code,200)
            self.assertTrue(any(room['category']=='stock:'+code for room in r.json['rooms']))
    def test_regional_legacy_read_accepts_valid_symbol_alias_without_inventing_unknown_rooms(self):
        for symbol in ['1832.T','1832.JP','7203.T','N225']:self.assertTrue(legacy_symbol_allowed(symbol,Catalogue()))
        for symbol in ['9999.T','1832.BAD','stock:1832']:self.assertFalse(legacy_symbol_allowed(symbol,Catalogue()))
    def test_write_and_management_remain_verified(self):
        self.assertEqual(self.c.post('/api/stock-talk/posts',json={'category':'stock:7203','body':'x'}).status_code,401)
        self.assertEqual(self.c.get('/api/stock-talk/moderation/reports').status_code,403)
    def test_room_feeds_are_passed_to_isolated_repository(self):
        self.assertEqual(self.c.get('/api/stock-talk/posts?category=stock:7203').status_code,200)
        self.assertEqual(self.repo.calls[-1][2]['category'],'stock:7203')

    def test_keyword_and_reply_search_stay_in_the_verified_selected_company(self):
        def write(category, body, parent_id=None):
            response=self.c.post('/api/stock-talk/posts',json=dict(category=category,body=body,
                name='同じ名前',language='ja',parent_id=parent_id,request_id=str(uuid.uuid4())),
                headers={'Authorization':'Bearer alice'})
            self.assertEqual(response.status_code,200)
            self.repo.now+=10
            return response.json['post']['id']
        first=write('stock:7203','親の投稿')
        reply=write('stock:7203','電気自動車の話',first)
        write('stock:6758','電気自動車の別の話')
        response=self.c.get('/api/stock-talk/posts',query_string={'category':'stock:7203','q':'電気 自動車'})
        self.assertEqual(response.status_code,200)
        self.assertEqual([post['id'] for post in response.json['posts']],[first])
        self.assertEqual(response.json['posts'][0]['reply_preview']['id'],reply)
        self.assertEqual(self.repo.calls[-1][2]['kind'],'stock')
        self.assertEqual(self.repo.calls[-1][2]['category'],'stock:7203')
        self.assertEqual(self.c.get('/api/stock-talk/posts?category=stock:1832&q=電気').json['posts'],[])

    def test_stock_search_never_accepts_all_or_unknown_rooms_or_cross_room_projection(self):
        for category in ('all','stock:9999','7203.T','stock:7203.T'):
            self.assertEqual(self.c.get('/api/stock-talk/posts',query_string={'category':category,'q':'投稿'}).status_code,400)
        self.assertEqual(self.repo.calls,[])
        from tests.test_community_api import example
        self.repo.override=dict(ok=True,query='投稿',search_version=1,
            posts=[example(category='stock:6758',body='投稿',reply_preview=None)],has_more=False,next_cursor=None)
        self.assertEqual(self.c.get('/api/stock-talk/posts?category=stock:7203&q=投稿').status_code,503)
if __name__=='__main__':unittest.main()

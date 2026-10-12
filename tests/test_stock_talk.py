import unittest
from flask import Flask
from stock_talk import create_stock_talk_blueprint,StockRooms
from tests.test_community_api import FakeRPC,ALICE
class Catalogue:
    def company(self,code):return {'code':code,'name':'会社'+code} if code in ('7203','1832','6758') else None
    def _local(self,q):return [{'code':q,'name':'会社'+q}] if self.company(q) else []
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
    def test_write_and_management_remain_verified(self):
        self.assertEqual(self.c.post('/api/stock-talk/posts',json={'category':'stock:7203','body':'x'}).status_code,401)
        self.assertEqual(self.c.get('/api/stock-talk/moderation/reports').status_code,403)
    def test_room_feeds_are_passed_to_isolated_repository(self):
        self.assertEqual(self.c.get('/api/stock-talk/posts?category=stock:7203').status_code,200)
        self.assertEqual(self.repo.calls[-1][2]['category'],'stock:7203')
if __name__=='__main__':unittest.main()

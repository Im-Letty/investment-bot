"""Catalogue-owned stock rooms on the verified conversation foundation."""
import re
from flask import jsonify,request
from community_api import create_community_blueprint
INDEX_ROOMS={'index:N225':'日経平均','index:SP500':'S&P500','index:DJI':'ダウ平均','index:IXIC':'ナスダック'}
class StockRooms:
    def __init__(self,catalogue):self.catalogue=catalogue
    def __contains__(self,value):
        if not isinstance(value,str):return False
        if value in INDEX_ROOMS:return True
        return bool(re.fullmatch(r'stock:[0-9][0-9A-Z]{3}',value) and self.catalogue.company(value[6:]))
def create_stock_talk_blueprint(url,key,catalogue,*,repository=None,check_admin=None):
    bp=create_community_blueprint(url,key,repository=repository,check_admin=check_admin,categories=StockRooms(catalogue),api_prefix='/api/stock-talk',blueprint_name='stock_talk',rpc_name='stock_talk_operation',allow_all=False)
    @bp.get('/api/stock-talk/rooms')
    def rooms():
        q=request.args.get('q','').strip()
        rows=catalogue._local(q) if 1<=len(q)<=80 and not any(ord(c)<32 for c in q) else []
        return jsonify(ok=True,rooms=[{'category':'stock:'+row['code'],'name':row['name'],'code':row['code']} for row in rows if catalogue.company(row['code'])][:20])
    return bp

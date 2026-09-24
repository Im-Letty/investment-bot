"""Verified company lookup must work without a quote service or network."""
import ast
from datetime import datetime
from io import BytesIO
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
from zipfile import ZipFile, ZIP_DEFLATED

from flask import Flask, jsonify, request
import requests
import stock_search as module
from stock_search import StockSearch, SEED_PATH, normalize, safe_symbol, parse_jpx_xlsx

ROOT = Path(__file__).parents[1]


class Response:
    def __init__(self, value):
        self.content = json.dumps(value).encode()
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def raise_for_status(self): pass
    def iter_content(self, size): yield self.content


def fixture_workbook(extra=''):
    labels = ['日付', 'コード', '銘柄名', '市場・商品区分', 'テスト会社', 'プライム（内国株式）']
    ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    shared = '<sst xmlns="'+ns+'">'+''.join('<si><t>'+x+'</t></si>' for x in labels)+'</sst>'
    rows = ['<row>'+''.join(f'<c r="{c}1" t="s"><v>{i}</v></c>' for i,c in enumerate('ABCD'))+'</row>']
    for i in range(1000):
        n=i+2
        rows.append(f'<row><c r="A{n}"><v>20260831</v></c><c r="B{n}"><v>{1000+i}</v></c><c r="C{n}" t="s"><v>4</v></c><c r="D{n}" t="s"><v>5</v></c></row>')
    out=BytesIO()
    with ZipFile(out,'w',ZIP_DEFLATED) as z:
        z.writestr('xl/sharedStrings.xml',shared)
        z.writestr('xl/worksheets/sheet1.xml','<worksheet xmlns="'+ns+'"><sheetData>'+''.join(rows)+extra+'</sheetData></worksheet>')
    return out.getvalue()


class StockSearchTests(unittest.TestCase):
    def setUp(self):
        self.session=Mock()
        self.now=1000
        self.search=StockSearch(runtime_path=None,session=self.session,clock=lambda:self.now)

    def test_seed_provenance_and_current_company_mapping(self):
        value=json.loads(SEED_PATH.read_text())
        self.assertEqual(value['source_url'],module.JPX_PAGE)
        self.assertTrue(value['file_url'].endswith('/data_j.xlsx'))
        self.assertEqual(len(value['file_sha256']),64)
        self.assertGreater(len(value['items']),1000)
        self.assertEqual(self.search.search('285A')['results'][0]['name'],'キオクシアホールディングス')
        self.assertNotIn('9437', {row['code'] for row in value['items']})

    def test_normalized_names_and_codes_need_no_external_calls(self):
        for query,symbol in [('7203','7203.T'),('７２０３','7203.T'),('７２０３．ｔ','7203.T'),
                             ('２８５ａ','285A.T'),('NTT','9432.T'),('ｎｔｔ','9432.T'),('KDDI','9433.T')]:
            with self.subTest(query=query):
                hit=self.search.search(query)['results'][0]
                self.assertEqual(hit['symbol'],symbol);self.assertTrue(hit['verified'])
                self.assertEqual(hit['source'],'JPX');self.assertEqual(hit['currency'],'JPY')
        for query in ['とよた','トヨタ','ﾄﾖﾀ','ト ヨ タ']:
            self.assertIn('7203.T',{x['symbol'] for x in self.search.search(query)['results']})
        self.session.get.assert_not_called()

    def test_company_list_and_search_have_same_verified_identity(self):
        data=self.search.all_items()
        self.assertEqual(data['count'],len(data['items']))
        self.assertEqual(len({x['code'] for x in data['items']}),data['count'])
        self.assertEqual(next(x['name'] for x in data['items'] if x['code']=='9432'),self.search.search('NTT')['results'][0]['name'])
        self.assertLessEqual(len(self.search.search('日')['results']),20)

    def test_remote_symbols_are_validated_and_cached_without_quotes(self):
        self.session.get.return_value=Response({'quotes':[
            {'symbol':'AAPL','shortname':'Apple Inc.','quoteType':'EQUITY','exchDisp':'NASDAQ'},
            {'symbol':'AAPL','shortname':'Duplicate','quoteType':'EQUITY'},
            {'symbol':'<script>','shortname':'Unsafe','quoteType':'EQUITY'},
            {'symbol':'BAD','shortname':'Unknown product','quoteType':'OPTION'}]})
        value=self.search.search('AAPL')
        self.assertEqual(len(value['results']),1)
        self.assertEqual(value['results'][0]['symbol'],'AAPL')
        self.assertTrue(value['results'][0]['verified'])
        self.assertEqual(self.search.search('ａａｐｌ'),value)
        self.assertEqual(self.session.get.call_count,1)
        args=self.session.get.call_args
        self.assertEqual(args.kwargs['timeout'],(3,4));self.assertFalse(args.kwargs['allow_redirects'])

    def test_remote_failure_is_distinct_from_no_match_and_shortly_cached(self):
        self.session.get.side_effect=requests.Timeout('private upstream details')
        failed=self.search.search('AAPL')
        self.assertEqual(failed,{'results':[],'unavailable':True})
        self.assertEqual(self.search.search('aapl'),failed);self.assertEqual(self.session.get.call_count,1)
        self.now+=16;self.search.search('AAPL');self.assertEqual(self.session.get.call_count,2)
        self.assertEqual(self.search.search('7203')['results'][0]['symbol'],'7203.T')

    def test_short_invalid_queries_do_not_call_remote(self):
        for query in ['', ' ', '\x00AAPL','X'*81,None,1,'Q']:
            self.search.search(query)
        self.session.get.assert_not_called()
        self.assertIsNone(safe_symbol('../x'));self.assertIsNone(safe_symbol('AAPL<script>'))
        self.assertEqual(safe_symbol('ｂｒｋ－ｂ'),'BRK-B')

    def test_code_missing_from_catalogue_uses_japanese_symbol_query(self):
        self.session.get.return_value=Response({'quotes':[]})
        self.assertEqual(self.search.search('9999')['results'],[])
        self.assertEqual(self.session.get.call_args.kwargs['params']['q'],'9999.T')

    def test_parallel_identical_remote_queries_do_not_overlap(self):
        entered,released=threading.Event(),threading.Event()
        def get(*a,**kw):entered.set();released.wait(2);return Response({'quotes':[]})
        self.session.get.side_effect=get
        worker=threading.Thread(target=lambda:self.search.search('AAPL'));worker.start()
        try:
            self.assertTrue(entered.wait(1))
            self.assertEqual(self.search.search('AAPL'),{'results':[],'unavailable':True})
            self.assertEqual(self.session.get.call_count,1)
        finally:released.set();worker.join(2)

    def test_failed_background_refresh_preserves_offline_catalogue(self):
        before=self.search.all_items()
        with patch.object(module,'download_catalogue',side_effect=ValueError('bad download')):
            self.assertFalse(self.search.refresh())
        self.assertEqual(self.search.all_items(),before)
        with tempfile.TemporaryDirectory() as temp:
            corrupt=Path(temp)/'cache.json';corrupt.write_text('{broken')
            recovered=StockSearch(runtime_path=corrupt,session=Mock())
            self.assertEqual(recovered.search('7203')['results'][0]['symbol'],'7203.T')

    def test_xlsx_filename_and_date_are_not_truncated_or_relabelled(self):
        workbook=fixture_workbook()
        page=('<p>東証上場銘柄一覧（2026年8月末）</p><a href="/markets/statistics-equities/misc/example/data_j.xlsx">Excel</a>').encode()
        with patch.object(module,'_download',side_effect=[page,workbook]) as download:
            value=module.download_catalogue()
        self.assertTrue(download.call_args_list[1].args[0].endswith('/data_j.xlsx'))
        self.assertEqual(value['as_of'],'2026-08-31')
        self.assertEqual(len(value['items']),1000)
        with patch.object(module,'_download',side_effect=[page.replace(b'8',b'7'),workbook]):
            with self.assertRaises(ValueError):module.download_catalogue()

    def test_refresh_worker_starts_in_serving_process_once_and_resets_after_fork(self):
        with patch.object(module,'Thread') as thread:
            self.search.ensure_refresh_worker();self.search.ensure_refresh_worker()
            self.assertEqual(thread.call_count,1)
            thread.return_value.start.assert_called_once()
            old_state,old_refresh=self.search._state_lock,self.search._refresh_lock
            old_session=self.search.session
            self.search._pending.add('aapl')
            self.search._after_fork()
            self.assertIsNot(self.search._state_lock,old_state)
            self.assertIsNot(self.search._refresh_lock,old_refresh)
            self.assertIsNot(self.search.session,old_session)
            self.assertFalse(self.search._pending)
            self.search.ensure_refresh_worker()
            self.assertEqual(thread.call_count,2)
            self.assertEqual(self.search.search('7203')['results'][0]['symbol'],'7203.T')

    def test_refresh_worker_waits_before_first_network_call(self):
        with patch.object(self.search,'refresh') as refresh:
            stop=Mock();stop.wait.side_effect=[False,True];stop.is_set.return_value=False
            self.search._worker_stop=stop
            self.search._refresh_loop()
            refresh.assert_called_once()
            self.assertEqual([call.args[0] for call in stop.wait.call_args_list],[20,86400])

    def test_lookup_routes_keep_compatible_json_contract(self):
        tree=ast.parse((ROOT/'line_bot.py').read_text())
        nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ('api_lookup','api_lookup_all')]
        app=Flask('stock-lookup-test')
        exec(compile(ast.Module(body=nodes,type_ignores=[]),str(ROOT/'line_bot.py'),'exec'),
             {'app':app,'request':request,'jsonify':jsonify,'_stock_search':self.search})
        client=app.test_client()
        data=client.get('/api/lookup?q=7203').get_json()
        self.assertEqual(data['results'][0]['symbol'],'7203.T')
        all_data=client.get('/api/lookup_all').get_json()
        self.assertIn({'code':'7203','name':'トヨタ自動車'},all_data['items'])
        self.session.get.assert_not_called()


if __name__=='__main__':unittest.main()

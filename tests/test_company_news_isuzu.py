"""Synthetic Isuzu production-hook tests; no publisher prose or network."""
from copy import deepcopy
from datetime import date, datetime
from html import escape
import socket
import unittest
from unittest.mock import patch
import company_news_additional as common
import company_news_isuzu as adapter

CONFIG=adapter.ISUZU_CONFIG
LABEL=CONFIG['name']
URL='https://www.isuzu-global.com/ja/newsroom/20261016_1.html'
TITLE='架空の物流技術を共同開発'
NOW=datetime(2026,10,17,3,tzinfo=common.JST)
SINCE=date(2026,10,14)
BODY=('いすゞ自動車株式会社（所在地は架空の検証専用設定）は、架空の物流技術を共同開発する計画を発表したという設定です。'
      'この文章は実際の企業の発表を引用したものではなく、解析と日付の確認のため独立して作成しました。'
      '導入先や費用も実在せず、実用化と業績への寄与は未確定という仮定の検証専用データです。')

class Catalogue:
    def __init__(self):
        self.members={'7202.T':dict(symbol='7202.T',name=LABEL,business=None,business_sources=[])}
        self.provenance={'as_of':'2026-10-01','source_sha256':'b'*64}
        self.facts_sha256='a'*64

def row(url=URL,stated='2026/10/16',visible='2026年10月16日',title=TITLE,hidden=''):
    return ('<li entrydate="'+escape(stated)+'" '+hidden+'><div class="item"><a href="'+escape(url)+'">'
      '<span class="n_img">PRIVATE IMAGE</span><span class="date">'+escape(visible)+'</span>'
      '<span class="news_tx">'+escape(title)+'</span></a></div></li>')

def index(rows=None,extra=''):
    return ('<div id="basic-list2-2" class="basic-list2 tabbox thumnail"><ul class="tabItems" data-term="30">'
            +(row() if rows is None else rows)+'</ul></div>'+extra).encode()

def original(body=BODY,visible='2026年10月16日',stated='2026年10月16日',title=TITLE,hidden='',extra=''):
    return ('<html><body id="multi3" entrydate="'+escape(stated)+'"><nav>PRIVATE HEADER</nav><div id="wrapper-3">'
      '<div id="page-intro"><h1>'+escape(title)+'</h1><div class="text-meta" role="contentinfo"><ul><li>'
      +escape(visible)+'</li></ul></div></div><div id="sharewithmain" role="main"><div class="multiColumn">'
      '<div class="column"><div class="text-section"><div class="rich-text"><p '+hidden+'>'+escape(body)+'</p></div></div>'
      '<table><tr><td class="rich-text">PRIVATE TABLE</td></tr></table>'
      '<div class="text-section"><div class="rich-text"><p>限定された条件による結果であり、実用化は未確定です。</p>'
      '<p>以上</p><p>PRIVATE CONTACT</p></div></div></div></div></div></div>'
      +extra+'<footer>いすゞ自動車株式会社 PRIVATE FOOTER</footer></body></html>').encode()

class IsuzuTests(unittest.TestCase):
    def setUp(self):
        self.catalogue=Catalogue()
        network=patch.object(socket.socket,'connect',side_effect=AssertionError('network forbidden'))
        network.start();self.addCleanup(network.stop)

    def item(self):return common.parse_feed(index(),LABEL,NOW,SINCE,self.catalogue)[0]
    def extract(self,payload=None,final=URL):
        return common.extract_article(original() if payload is None else payload,self.item(),final,NOW,SINCE,catalogue=self.catalogue)

    def test_real_extractor_keeps_qualified_narrative_day_only_and_identity(self):
        result=self.extract()
        self.assertIsNotNone(result)
        self.assertTrue(common.valid_identity(result,self.catalogue))
        self.assertEqual(result['published_date'],'2026-10-16')
        self.assertIsNone(result['published_at'])
        self.assertIn('実用化は未確定',result['body'])
        self.assertNotIn('PRIVATE',result['body'])

    def test_full_news_panel_is_required_and_pickup_duplicates_are_not_used(self):
        pickup=index().replace(b'basic-list2-2',b'basic-list2-1')
        with self.assertRaises(ValueError):adapter.parse_index(pickup,LABEL,NOW,SINCE,self.catalogue)
        self.assertEqual(len(adapter.parse_index(index(extra=pickup.decode()),LABEL,NOW,SINCE,self.catalogue)),1)
        with self.assertRaises(ValueError):adapter.parse_index(index(extra=index().decode()),LABEL,NOW,SINCE,self.catalogue)

    def test_index_date_fields_url_and_visibility_must_agree(self):
        for options in ({'stated':'2026/10/15'},{'visible':'2026年10月15日'},{'stated':'2026-10-16'},
                        {'stated':'2026/10/16T12:00'},{'visible':'2026年10月16日 更新'},{'hidden':'hidden'},
                        {'url':URL+'?x=1'},{'url':URL.replace('www.isuzu-global.com','example.test')}):
            self.assertEqual(adapter.parse_index(index(row(**options)),LABEL,NOW,SINCE,self.catalogue),[])

    def test_duplicate_url_conflicts_and_bound_are_enforced(self):
        self.assertEqual(adapter.parse_index(index(row()+row(title='架空の別製品を開発')),LABEL,NOW,SINCE,self.catalogue),[])
        old=row(url=URL.replace('20261016','20260901'),stated='2026/09/01',visible='2026年9月1日')
        self.assertEqual(adapter.parse_index(index(old*120+row()),LABEL,NOW,SINCE,self.catalogue),[])

    def test_original_visible_day_body_day_heading_and_final_url_must_match(self):
        for options in ({'visible':'2026年10月15日'},{'stated':'2026年10月15日'},{'visible':'2026年10月16日 更新'},
                        {'title':'別の架空製品を開発'},{'hidden':'style="display:none"'}):
            self.assertIsNone(self.extract(original(**options)))
        self.assertIsNone(self.extract(final=URL.replace('20261016','20261015')))

    def test_optional_original_metadata_cannot_contradict_exact_transport_url(self):
        self.assertIsNone(self.extract(original(extra='<meta property="og:url" content="https://example.test/">')))
        self.assertIsNone(self.extract(original(extra='<link rel="canonical" href="'+URL+'?x=1">')))
        self.assertIsNotNone(self.extract(original(extra='<meta property="og:url" content="'+URL+'">')))

    def test_subsidiary_possessive_later_mention_and_footer_do_not_supply_parent(self):
        for body in ('株式会社架空子会社は、'+BODY,'いすゞ自動車株式会社の子会社は、'+BODY,
                     'いすゞ自動車株式会社\n株式会社架空子会社は、'+BODY,
                     'いすゞ自動車株式会社　架空会社株式会社\n株式会社架空子会社は、'+BODY,
                     '架空会社は、いすゞ自動車株式会社と共同開発しました。'+BODY):
            self.assertIsNone(self.extract(original(body=body)))

    def test_wrong_structure_encoding_size_catalogue_and_old_day_fail_closed(self):
        self.assertIsNone(self.extract(original().replace(b'role="main"',b'role="complementary"')))
        for payload in (b'\xff',b'x'*1_000_001):
            with self.assertRaises(ValueError):adapter.parse_index(payload,LABEL,NOW,SINCE,self.catalogue)
        old=row(url=URL.replace('20261016','20261008'),stated='2026/10/08',visible='2026年10月8日')
        self.assertEqual(adapter.parse_index(index(old),LABEL,NOW,SINCE,self.catalogue),[])
        self.catalogue.members['7202.T']['name']='別会社'
        self.assertEqual(adapter.parse_index(index(),LABEL,NOW,SINCE,self.catalogue),[])

if __name__=='__main__':unittest.main()

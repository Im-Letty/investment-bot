'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../static/morning-feed.js'),'utf8');
const dates=fs.readFileSync(path.join(__dirname,'../static/date-display.js'),'utf8');
const stamp=value=>Date.parse(value+'+09:00')/1000;
const clone=value=>JSON.parse(JSON.stringify(value));
async function flush(){for(let i=0;i<30;i++)await Promise.resolve();}

function app(saved={},initial=null,now=stamp('2026-10-11T18:00:00')){
  const storage=new Map(Object.entries(saved)),requests=[],listeners={},nodes={};
  let clock=now*1000;
  class FakeDate extends Date{static now(){return clock;}}
  function node(){return {innerHTML:'',textContent:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;},
    getAttribute(k){return this.attrs[k];},querySelectorAll(){return [];},querySelector(){return null;},contains(){return false;}};}
  for(const id of ['morning-news-content','morning-analysis','morning-points','morning-countdown','morning-update-time'])nodes[id]=node();
  if(initial)nodes.knInitialNews={textContent:JSON.stringify(initial)};
  const context={console,Promise,Date:FakeDate,Number,URL,AbortController,
    document:{readyState:'loading',hidden:false,documentElement:{lang:'ja'},getElementById:id=>nodes[id]||null,
      addEventListener(name,fn){(listeners[name]||=[]).push(fn);}},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},
    fetch(url){let resolve,reject;const pending=new Promise((a,b)=>{resolve=a;reject=b;});requests.push({url,resolve,reject});return pending;},
    setTimeout(){return 1;},clearTimeout(){},setInterval(){return 1;},clearInterval(){},
    _mktCache:null,_mktLastFetch:0,_mktFetchSec:10,_mktCountdown:10,_mktInterval:null,
    renderMorningGrid(){},translateNewsSource:s=>s,t:s=>s};
  context.window=context;
  vm.runInNewContext(dates,context);vm.runInNewContext(source,context);
  return {storage,requests,nodes,context,start(){for(const fn of listeners.DOMContentLoaded||[])fn();},
    advance(seconds){clock+=seconds*1000;},
    async reply(index,payload){requests[index].resolve({ok:true,json:async()=>payload});await flush();},
    html(){return nodes['morning-news-content'].innerHTML;}};
}

function publication({kind='intraday',precise=true,cutoff=stamp('2026-10-11T13:20:11'),headline='日中の新しい公式発表'}={}){
  const window=kind==='intraday'?{version:2,kind:'intraday',edition_date:'2026-10-11',window_start:stamp('2026-10-11T07:30:00'),cutoff_at:cutoff}:
    {version:1,edition_date:'2026-10-11',window_start:stamp('2026-10-10T08:00:00'),carryover_start:stamp('2026-10-10T07:30:00'),cutoff_at:stamp('2026-10-11T07:30:00')};
  const ref={source:'財務省',title:'公式資料の原題',url:'https://www.mof.go.jp/policy/tax_policy/tax_reform/example.html',
    published_at:precise?stamp('2026-10-11T12:00:00'):null,published_date:kind==='intraday'?'2026-10-11':'2026-10-10',
    publication_precision:precise?'second':'day',body_sha256:'a'.repeat(64),body_verified_at:window.cutoff_at,
    selection_route:kind==='intraday'?'intraday':'date_only'};
  const release=kind==='intraday'?cutoff:stamp('2026-10-11T08:00:00');
  const digest={publication_mode:'curated',lang:'ja',edition_date:'2026-10-11',source_window:window,
    reviewed_at:window.cutoff_at,publish_at:release,headline,summary:'確認した本文をやさしく要約した内容です。',
    copy_length_policy:'flexible-v1',reading_structure:'lead-plus-other-news-v1',article_refs:[clone(ref)],
    article_summaries:[{...clone(ref),headline,summary:'詳細にも元の発表にある事実だけを記載します。'}]};
  return {lang:'ja',policy_version:4,edition_date:'2026-10-11',selection_status:'ready',delivery:'published',
    fetched_at:null,news:[ref],supplements:[],digest,refreshing:false,translation_pending:false};
}
function changeRef(data,key,value){for(const item of [data.news[0],data.digest.article_refs[0],data.digest.article_summaries[0]])item[key]=value;}

test('published intraday JSON is rendered immediately and persisted from API',async()=>{
  const a=app();a.start();const data=publication();await a.reply(0,data);
  assert.match(a.html(),/日中の新しい公式発表/);
  const saved=JSON.parse(a.storage.get('kn_published_news_v1_ja'));
  assert.deepEqual(saved.digest.source_window,data.digest.source_window);
  assert.equal(saved.digest.publish_at,data.digest.source_window.cutoff_at,'No artificial 30 minute morning delay');
  assert.equal(a.storage.has('kn_news_v4_ja'),false,'Published copy is not an RSS fetch record');
});

test('BOJ intraday decision renders after review and stays bound to its official host and path',async()=>{
  const data=publication({precise:false});
  changeRef(data,'source','日本銀行');
  changeRef(data,'url','https://www.boj.or.jp/mopo/mpmdeci/mpr_2026/k261011a.pdf');
  const a=app();a.start();await a.reply(0,data);
  assert.match(a.html(),/日中の新しい公式発表/);assert.match(a.html(),/日本銀行/);
  assert.equal(JSON.parse(a.storage.get('kn_published_news_v1_ja')).news[0].published_at,null);
  for(const url of ['https://www.mof.go.jp/policy/tax_policy/tax_reform/example.html',
    'https://www.boj.or.jp/about/press/koen_2026/ko261011a.htm',
    'https://www.boj.or.jp.evil.test/mopo/mpmdeci/mpr_2026/k261011a.pdf']){
    const changed=clone(data);changeRef(changed,'url',url);
    const rejected=app({},changed);rejected.start();
    assert.doesNotMatch(rejected.html(),/日中の新しい公式発表/);
    assert.equal(rejected.storage.has('kn_published_news_v1_ja'),false);
  }
});

test('date-only intraday publication preserves unknown time in embedded and cached copy',()=>{
  const data=publication({precise:false}),a=app({},data);a.start();
  assert.match(a.html(),/日中の新しい公式発表/);
  assert.match(a.html(),/datetime="2026-10-11"/);
  assert.doesNotMatch(a.html(),/2026\/10\/11 00:00/);
  const saved=JSON.parse(a.storage.get('kn_published_news_v1_ja'));
  assert.equal(saved.news[0].published_at,null);
  const restored=app({'kn_published_news_v1_ja':JSON.stringify(saved)});restored.start();
  assert.match(restored.html(),/日中の新しい公式発表/);
  assert.match(restored.html(),/datetime="2026-10-11"/);
});

test('date-only body verified before the intraday window is rejected at bootstrap and API',async()=>{
  const data=publication({precise:false});changeRef(data,'body_verified_at',data.digest.source_window.window_start-1);
  const early=app({},data);early.start();
  assert.doesNotMatch(early.html(),/日中の新しい公式発表/);
  assert.equal(early.storage.has('kn_published_news_v1_ja'),false);
  await early.reply(0,data);
  assert.doesNotMatch(early.html(),/日中の新しい公式発表/);
  assert.equal(early.storage.has('kn_published_news_v1_ja'),false);
  changeRef(data,'body_verified_at',data.digest.source_window.window_start);
  const valid=app({},data);valid.start();assert.match(valid.html(),/日中の新しい公式発表/);
});

test('same-day newer intraday release replaces morning copy and resists stale response',async()=>{
  const morning=publication({kind:'morning',precise:false,headline:'朝の審査済み記事'});
  const a=app({'kn_published_news_v1_ja':JSON.stringify(morning)});a.start();
  assert.match(a.html(),/朝の審査済み記事/);
  const current=publication();await a.reply(0,current);
  assert.match(a.html(),/日中の新しい公式発表/);assert.doesNotMatch(a.html(),/朝の審査済み記事/);
  a.advance(121);a.context.loadMorningNews(true);await a.reply(2,morning);
  assert.match(a.html(),/日中の新しい公式発表/);
  assert.equal(JSON.parse(a.storage.get('kn_published_news_v1_ja')).digest.headline,current.digest.headline);
});

test('a later intraday revision wins over an earlier same-day intraday edition',async()=>{
  const early=publication(),later=publication({cutoff:stamp('2026-10-11T14:00:37'),headline:'後から審査した記事'});
  const a=app({'kn_published_news_v1_ja':JSON.stringify(early)});a.start();await a.reply(0,later);
  assert.match(a.html(),/後から審査した記事/);
  a.advance(121);a.context.loadMorningNews(true);await a.reply(2,early);
  assert.match(a.html(),/後から審査した記事/);
});

test('malformed v2 windows cannot be rendered or cached',()=>{
  const variants=[w=>w.kind='morning',w=>w.version=true,w=>w.version=3,w=>w.window_start++,
    w=>w.cutoff_at=stamp('2026-10-11T08:59:59'),w=>w.cutoff_at=stamp('2026-10-11T23:00:00'),
    w=>w.cutoff_at=stamp('2026-10-10T13:20:11'),w=>w.cutoff_at=stamp('2026-10-12T13:20:11'),
    w=>w.edition_date='2026-10-10',w=>w.edition_date='2026-02-30',w=>w.cutoff_at=null,
    w=>w.carryover_start=w.window_start,w=>delete w.kind,w=>w.extra='untrusted'];
  for(const mutate of variants){const data=publication();mutate(data.digest.source_window);const a=app({},data);a.start();
    assert.doesNotMatch(a.html(),/日中の新しい公式発表/);assert.equal(a.storage.has('kn_published_news_v1_ja'),false);}
});

test('invalid dates, invented time, correction routes and deferrals cannot bypass intraday provenance',()=>{
  const variants=[d=>changeRef(d,'published_date','2026-10-10'),d=>changeRef(d,'published_date','2026-10-12'),
    d=>changeRef(d,'published_at',d.digest.source_window.window_start-1),
    d=>changeRef(d,'published_at',d.digest.source_window.cutoff_at+1),
    d=>changeRef(d,'body_verified_at',d.digest.source_window.cutoff_at+1),
    d=>changeRef(d,'selection_route','main'),d=>changeRef(d,'selection_route','date_only'),
    d=>changeRef(d,'selection_route','correction'),d=>changeRef(d,'selection_route','deferred'),
    d=>changeRef(d,'deferred_from','2026-10-10'),d=>changeRef(d,'deferred_reason','omitted'),
    d=>{changeRef(d,'publication_precision','day');changeRef(d,'published_at',stamp('2026-10-11T00:00:00'));},
    d=>changeRef(d,'body_sha256','a'.repeat(63)),d=>changeRef(d,'url','https://example.test/item'),
    d=>changeRef(d,'title','原'.repeat(1001))];
  for(const mutate of variants){const data=publication();mutate(data);const a=app({},data);a.start();
    assert.doesNotMatch(a.html(),/日中の新しい公式発表/);assert.equal(a.storage.has('kn_published_news_v1_ja'),false);}
});

test('early review, early publication, changed detail metadata and oversized article count are rejected',()=>{
  const variants=[d=>d.digest.reviewed_at=d.digest.source_window.cutoff_at-1,
    d=>d.digest.publish_at=d.digest.source_window.cutoff_at-1,d=>delete d.digest.publish_at,
    d=>d.digest.publish_at=stamp('2026-10-12T00:00:00'),
    d=>d.digest.article_summaries[0].body_sha256='b'.repeat(64),
    d=>{for(let i=1;i<4;i++){const ref={...d.news[0],url:d.news[0].url+'#'+i};d.news.push(ref);d.digest.article_refs.push(ref);d.digest.article_summaries.push({...ref,headline:'記事'+i,summary:'内容'});}}];
  for(const mutate of variants){const data=publication();mutate(data);const a=app({},data);a.start();
    assert.doesNotMatch(a.html(),/日中の新しい公式発表/);assert.equal(a.storage.has('kn_published_news_v1_ja'),false);}
});

test('intraday nine and last daytime second are accepted with precise publication boundaries',()=>{
  for(const cutoff of [stamp('2026-10-11T09:00:00'),stamp('2026-10-11T22:59:59')]){
    const data=publication({cutoff});changeRef(data,'published_at',data.digest.source_window.window_start);
    const a=app({},data,stamp('2026-10-11T23:00:00'));a.start();assert.match(a.html(),/日中の新しい公式発表/);
    changeRef(data,'published_at',cutoff);const b=app({},data,stamp('2026-10-11T23:00:00'));b.start();
    assert.match(b.html(),/日中の新しい公式発表/);
  }
});

test('morning v1 retains source precision and eight oclock minimum release',()=>{
  const data=publication({kind:'morning',precise:false,headline:'朝版の公式記事'}),a=app({},data);a.start();
  assert.match(a.html(),/朝版の公式記事/);
  data.digest.publish_at=stamp('2026-10-11T07:59:59');const b=app({},data);b.start();
  assert.doesNotMatch(b.html(),/朝版の公式記事/);assert.equal(b.storage.has('kn_published_news_v1_ja'),false);
});

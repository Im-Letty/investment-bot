'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/morning-feed.js'), 'utf8');

function deferred(){let resolve, reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
async function flush(){for(let i=0;i<30;i++)await Promise.resolve();}
function harness(saved={}){
  const requests=[], storage=new Map(Object.entries(saved)), listeners={}, timers=new Map(), intervals=new Map(), nodes={}, renders=[];
  let timerId=0, clock=Date.UTC(2026,8,12,0,0);
  class FakeDate extends Date{static now(){return clock;}}
  function element(){
    let html='';
    const node={textContent:'',attrs:{},details:[],summaries:[],replacements:0,
      setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];},
      querySelector(){return this.button||(this.button={});},
      querySelectorAll(selector){return selector==='details[data-news-key]'?this.details:selector==='[data-news-focus]'?this.summaries:[];},
      contains(child){return this.summaries.includes(child);}};
    const decode=s=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
    Object.defineProperty(node,'innerHTML',{get(){
      let index=0;
      // Match the browser: opening a native details element adds its open
      // attribute to innerHTML without changing the rendered article source.
      return html.replace(/<details\b[^>]*data-news-key="[^"]*"[^>]*>/g,tag=>node.details[index++].open?tag.slice(0,-1)+' open="">':tag);
    },set(value){
      html=value;node.replacements++;
      node.details=[...html.matchAll(/<details\b[^>]*data-news-key="([^"]*)"/g)].map(m=>({open:false,getAttribute:k=>k==='data-news-key'?decode(m[1]):null}));
      node.summaries=[...html.matchAll(/<summary\b[^>]*data-news-focus="([^"]*)"/g)].map(m=>({getAttribute:k=>k==='data-news-focus'?decode(m[1]):null,focus(options){this.focusOptions=options;context.document.activeElement=this;}}));
    }});
    return node;
  }
  ['morning-news-content','morning-analysis','morning-points','morning-countdown','morning-update-time'].forEach(id=>nodes[id]=element());
  const context={console,Promise,Date:FakeDate,Number,URL,AbortController,
    document:{readyState:'loading',hidden:false,documentElement:{lang:'ja'},getElementById:id=>nodes[id]||null,addEventListener:(name,fn)=>(listeners[name]||=[]).push(fn)},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    fetch(url,options){const d=deferred();requests.push({url,options,...d});return d.promise;},
    setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    setInterval:(fn,ms)=>{const id=++timerId;intervals.set(id,{fn,ms});return id;},clearInterval:id=>intervals.delete(id),
    _mktCache:null,_mktLastFetch:0,_mktFetchSec:10,_mktCountdown:10,_mktInterval:null,
    renderMorningGrid:data=>renders.push(data),translateNewsSource:s=>s,t:s=>s};
  context.window=context;vm.runInNewContext(source,context);
  return {context,requests,storage,nodes,timers,intervals,renders,
    now:()=>clock,advance:ms=>clock+=ms,
    event:name=>(listeners[name]||[]).forEach(fn=>fn()),
    language(l){storage.set('app_lang',l);context.document.documentElement.lang=l;},
    reply(request,data){request.resolve({ok:true,json:async()=>data});return flush();},
    news(l='ja',extra={}){
      const date=new Date(clock+9*3600000).toISOString().slice(0,10);
      const data={lang:l,policy_version:4,edition_date:date,selection_status:'ready',news:[{source:'NHK経済',title:'今日のニュース'}],supplements:[],fetched_at:clock/1000,updated:'09:00',refreshing:false,stale:false,translation_pending:false,...extra};
      data.news=data.news.map((item,i)=>({url:'https://news.example/item-'+i,published_at:clock/1000,published_date:date,...item}));
      return data;
    },
    market(){return {market:{'日経225':{display:'100 ▲1%'}},updated:'09:00',fetched_at:clock/1000};}
  };
}

test('news starts without waiting for market; repeated startup shares requests',async()=>{
  const app=harness();app.event('DOMContentLoaded');
  assert.deepEqual(app.requests.map(r=>r.url),['/api/morning-news?lang=ja','/api/morning-data']);
  app.context.startMorningInterval();app.context.loadMorningData();app.context.loadMorningNews();
  assert.equal(app.requests.length,2);assert.equal(app.intervals.size,1);
  await app.reply(app.requests[0],app.news());
  assert.match(app.nodes['morning-news-content'].innerHTML,/今日のニュース/);
  assert.equal(app.renders.length,0,'News is readable while market is pending');
  await app.reply(app.requests[1],app.market());assert.equal(app.renders.length,1);
});

test('cached news appears immediately, refresh does not blank it, and titles are escaped',async()=>{
  const app=harness();const old=app.news('ja',{news:[{source:'<feed>',title:'<img src=x onerror=bad()>'}]});
  app.storage.set('kn_news_v4_ja',JSON.stringify(old));app.event('DOMContentLoaded');
  const content=app.nodes['morning-news-content'];
  assert.match(content.innerHTML,/&lt;img/);assert.ok(!content.innerHTML.includes('<img'));
  assert.ok(!content.innerHTML.includes('skeleton'));assert.match(content.innerHTML,/取得/);
  app.requests[0].reject(new Error('offline'));await flush();
  assert.match(content.innerHTML,/&lt;img/);assert.match(content.innerHTML,/いま更新できません/);
});

test('late old-language response cannot replace the current language',async()=>{
  const app=harness();app.event('DOMContentLoaded');app.language('en');app.event('langChanged');
  const en=app.requests.find(r=>r.url.endsWith('=en'));
  await app.reply(en,app.news('en',{news:[{source:'NHK',title:'English headline'}]}));
  await app.reply(app.requests[0],app.news());
  assert.match(app.nodes['morning-news-content'].innerHTML,/English headline/);
  assert.ok(!app.nodes['morning-news-content'].innerHTML.includes('今日のニュース'));
});

test('returning to pending translation bypasses freshness delay',async()=>{
  const app=harness();app.language('en');app.event('DOMContentLoaded');
  await app.reply(app.requests[0],app.news('en',{translation_pending:true}));
  app.language('ja');
  for(const [id,timer] of [...app.timers])if(timer.ms===1500){app.timers.delete(id);timer.fn();}
  app.language('en');app.event('langChanged');
  assert.equal(app.requests.filter(r=>r.url.endsWith('=en')).length,2);
});

test('late old-language pending response cannot replace rendered current-language news with a skeleton',async()=>{
  const app=harness();app.event('DOMContentLoaded');app.language('en');app.event('langChanged');
  await app.reply(app.requests.find(r=>r.url.endsWith('=en')),app.news('en',{news:[{source:'NHK',title:'Current headline'}]}));
  await app.reply(app.requests[0],app.news('ja',{news:[],fetched_at:null,refreshing:true,selection_status:'refreshing'}));
  assert.match(app.nodes['morning-news-content'].innerHTML,/Current headline/);
  assert.ok(!app.nodes['morning-news-content'].innerHTML.includes('skeleton'));
});

test('fresh complete data is reused and hidden tabs do not poll',async()=>{
  const app=harness();app.event('DOMContentLoaded');
  await app.reply(app.requests[0],app.news());await app.reply(app.requests[1],app.market());
  app.context.loadMorningNews();assert.equal(app.requests.length,2);
  app.context.document.hidden=true;app.advance(130000);
  for(let i=0;i<20;i++)for(const timer of app.intervals.values())timer.fn();
  assert.equal(app.requests.length,2);
  app.context.document.hidden=false;app.event('visibilitychange');
  assert.equal(app.requests.length,4);
});

test('empty pending cold response is not persisted as a successful cache',async()=>{
  const app=harness();app.event('DOMContentLoaded');
  await app.reply(app.requests[0],app.news('ja',{news:[],fetched_at:null,refreshing:true}));
  assert.equal(app.storage.has('kn_news_v4_ja'),false);
  assert.match(app.nodes['morning-news-content'].innerHTML,/skeleton/);
  for(const [id,timer] of [...app.timers])if(timer.ms===1500){app.timers.delete(id);timer.fn();}
  assert.equal(app.requests.filter(r=>r.url.includes('morning-news')).length,2);
});

test('expired saved headlines are not shown; cold failure exposes a working retry',async()=>{
  const app=harness();app.storage.set('kn_news_v4_ja',JSON.stringify(app.news('ja',{fetched_at:(app.now()-901000)/1000})));
  app.event('DOMContentLoaded');assert.match(app.nodes['morning-news-content'].innerHTML,/skeleton/);
  app.requests[0].reject(new Error('offline'));await flush();
  assert.match(app.nodes['morning-news-content'].innerHTML,/もう一度読み込む/);
  app.nodes['morning-news-content'].button.onclick();
  assert.equal(app.requests.filter(r=>r.url.includes('morning-news')).length,2);
});

test('market failure does not prevent successfully loaded headlines',async()=>{
  const app=harness();app.event('DOMContentLoaded');
  app.requests[1].reject(new Error('offline'));await flush();
  await app.reply(app.requests[0],app.news());
  assert.match(app.nodes['morning-news-content'].innerHTML,/今日のニュース/);
  assert.match(app.nodes['morning-analysis'].textContent,/ニュースはそのまま/);
});

function reviewed(data,extra={}){
  return {edition_date:data.edition_date,lang:'ja',headline:'AIの会社などの株に、買いが集まる',summary:'内容を確認した今日のニュースです。'.repeat(12),article_refs:data.news.map(({source,url,published_at,title})=>({source,url,published_at,title})),...extra};
}

function published(app){
  const data=app.news('ja',{delivery:'published',fetched_at:null,refreshing:true});data.digest=reviewed(data);
  app.nodes.knInitialNews={textContent:JSON.stringify(data)};
  return data;
}

test('first visit reads the embedded publication before any API or market response',()=>{
  const app=harness(),data=published(app);app.event('DOMContentLoaded');
  const html=app.nodes['morning-news-content'].innerHTML;
  assert.ok(html.includes(data.digest.summary));assert.ok(!html.includes('skeleton'));
  assert.match(html,/2026\/09\/12 掲載/);assert.ok(!html.includes('1970'));assert.ok(!html.includes('取得 '));
  assert.equal(app.requests.length,2,'Live checks still begin in the background');
  assert.equal(app.storage.has('kn_news_v4_ja'),false,'Published copy must not impersonate a fresh RSS cache');
});

test('first hydration preserves panels and focus opened before deferred scripts finish',()=>{
  const app=harness();published(app);
  const content=app.nodes['morning-news-content'];
  content.innerHTML='<details data-news-key="more"><summary data-news-focus="more">もっと詳しく</summary><details data-news-key="article:https://news.example/item-0"><summary data-news-focus="article:https://news.example/item-0">今日のニュース</summary></details></details>';
  content.details.forEach(node=>node.open=true);content.summaries[1].focus();
  app.event('DOMContentLoaded');
  assert.ok(content.details.every(node=>node.open));
  assert.equal(app.context.document.activeElement,content.summaries[1]);
  assert.equal(content.summaries[1].focusOptions.preventScroll,true);
});

test('published edition remains readable during cold refresh, network failure and a long same-day visit',async()=>{
  const app=harness(),data=published(app);app.event('DOMContentLoaded');
  await app.reply(app.requests[0],app.news('ja',{news:[],digest:null,fetched_at:null,selection_status:'refreshing',refreshing:true}));
  assert.ok(app.nodes['morning-news-content'].innerHTML.includes(data.digest.summary));
  assert.ok(!app.nodes['morning-news-content'].innerHTML.includes('確認できませんでした'));
  app.advance(3600000);app.context.loadMorningNews(true);
  app.requests.at(-1).reject(new Error('offline'));await flush();
  const html=app.nodes['morning-news-content'].innerHTML;
  assert.ok(html.includes(data.digest.summary));assert.match(html,/最新情報を確認できませんでした/);
  assert.ok(!html.includes('skeleton'));assert.ok(!html.includes('morning-news-error'));
});

test('fresh embedded live data is immediately usable and newer than a saved snapshot',()=>{
  const app=harness(),old=app.news('ja',{fetched_at:app.now()/1000-100,news:[{source:'NHK経済',title:'保存されていた古い見出し'}]});
  app.storage.set('kn_news_v4_ja',JSON.stringify(old));
  const current=app.news();current.digest=reviewed(current);app.nodes.knInitialNews={textContent:JSON.stringify(current)};
  app.event('DOMContentLoaded');
  const html=app.nodes['morning-news-content'].innerHTML;
  assert.ok(html.includes(current.digest.summary));assert.ok(!html.includes('保存されていた古い見出し'));
});

test('successful live selection replaces published copy and does not revive it after expiry',async()=>{
  const app=harness(),data=published(app);app.event('DOMContentLoaded');
  await app.reply(app.requests[0],app.news('ja',{digest:null,news:[],selection_status:'empty_today'}));
  assert.ok(!app.nodes['morning-news-content'].innerHTML.includes(data.digest.summary));
  assert.match(app.nodes['morning-news-content'].innerHTML,/まだ確認できていません/);
  app.advance(901000);app.context.loadMorningNews();app.requests.at(-1).reject(new Error('offline'));await flush();
  assert.ok(!app.nodes['morning-news-content'].innerHTML.includes(data.digest.summary));
});

test('legacy unmarked published edition expires at JST midnight even when the network fails',async()=>{
  const app=harness();app.advance(Date.UTC(2026,8,12,14,59,59)-app.now());
  const data=published(app);app.event('DOMContentLoaded');
  app.advance(2000);for(const timer of app.intervals.values())timer.fn();
  assert.ok(!app.nodes['morning-news-content'].innerHTML.includes(data.digest.summary));
  app.requests[0].reject(new Error('offline'));await flush();
  assert.ok(!app.nodes['morning-news-content'].innerHTML.includes(data.digest.summary));
});

test('malformed, mismatched, prior-day or future legacy published bootstrap is ignored',()=>{
  for(const mutate of [
    d=>d.edition_date='2026-09-11', d=>d.digest=null,
    d=>d.fetched_at=0, d=>d.digest.article_refs[0].title='別の原題',
    d=>d.news[0].published_at+=10, d=>d.news[0].url='javascript:alert(1)',
    d=>d.policy_version=2
  ]){
    const app=harness(),data=published(app);mutate(data);app.nodes.knInitialNews.textContent=JSON.stringify(data);
    app.event('DOMContentLoaded');assert.match(app.nodes['morning-news-content'].innerHTML,/skeleton/);
  }
  const app=harness();app.nodes.knInitialNews={textContent:'bad json'};app.event('DOMContentLoaded');
  assert.match(app.nodes['morning-news-content'].innerHTML,/skeleton/);
});

test('E front shows one reviewed daily digest and A details preserve all selected headlines',async()=>{
  const app=harness();app.event('DOMContentLoaded');
  const news=[
    {source:'国内経済',title:'見出し1'},{source:'会社',title:'見出し2'},
    {source:'海外',title:'見出し3'}
  ];
  const data=app.news('ja',{news});data.digest=reviewed(data);
  await app.reply(app.requests[0],data);
  const html=app.nodes['morning-news-content'].innerHTML;
  const front=html.split('<details class="read-more"')[0];
  assert.match(front,/class="news-card journal"/);
  assert.equal((front.match(/class="brief-summary"/g)||[]).length,1);
  assert.ok(front.includes(data.digest.headline));
  assert.ok(front.includes(data.digest.summary));
  news.forEach(item=>assert.ok(!front.includes(item.title)));
  assert.ok(!html.includes('本日発表された経済ニュースを優先'));
  assert.ok(!html.includes('news-period'));
  assert.match(html,/class="stories editorial-detail"/);
  assert.equal((html.match(/<details class="story"/g)||[]).length,3);
  news.forEach(item=>assert.ok(html.includes('<span class="story-title">'+item.title+'</span>')));
  assert.ok(!html.includes('サンマルク'));
});

test('calendar and publication dates use the JST edition',async()=>{
  const app=harness();app.advance(Date.UTC(2026,8,21,15,1)-app.now());app.event('DOMContentLoaded');
  await app.reply(app.requests[0],app.news());
  const html=app.nodes['morning-news-content'].innerHTML;
  assert.match(html,/掲載対象日 2026-09-22/);
  assert.match(html,/<strong>22<\/strong>/);
  assert.ok(!html.includes('本日発表された経済ニュースを優先'));
  assert.match(html,/JST/);
});

test('summary text and headline are escaped; original references stay inside details',async()=>{
  const app=harness();app.event('DOMContentLoaded');
  const data=app.news();
  data.digest=reviewed(data,{headline:'<img src=x onerror=bad()>',summary:'<script>bad()</script>'+ '確認した本文です。'.repeat(20)});
  await app.reply(app.requests[0],data);
  const html=app.nodes['morning-news-content'].innerHTML;
  assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);
  assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));
  assert.match(html,/href="https:\/\/news.example\/item-0"/);
});

test('unbound or invalid summaries are hidden without losing current article links',async()=>{
  for(const alter of [
    d=>d.digest.edition_date='2026-09-11',
    d=>d.digest.summary='短すぎる本文',
    d=>d.digest.article_refs[0].title='別の原題',
    d=>d.digest.article_refs[0].published_at-=1,
    d=>d.digest.article_refs[0].url='https://news.example/other',
    d=>d.digest.article_refs[0].source='別の配信元',
    d=>d.digest.article_refs=[],
    d=>d.news.push({...d.news[0],url:'https://news.example/new',title:'新しい記事'}),
    d=>{d.news.push({...d.news[0],url:'https://news.example/new',title:'新しい記事'});d.digest.article_refs.push({...d.digest.article_refs[0]});}
  ]){
    const app=harness();app.event('DOMContentLoaded');const data=app.news();data.digest=reviewed(data);alter(data);
    await app.reply(app.requests[0],data);
    const html=app.nodes['morning-news-content'].innerHTML,front=html.split('<details class="read-more"')[0];
    assert.ok(!front.includes('brief-summary'));
    assert.match(front,/本日のまとめはまだ掲載されていません/);
    assert.match(html,/今日のニュース/);
  }
});

test('refresh removes the previous digest when newly selected articles have no review',async()=>{
  const app=harness();app.event('DOMContentLoaded');const data=app.news();data.digest=reviewed(data);
  await app.reply(app.requests[0],data);
  assert.match(app.nodes['morning-news-content'].innerHTML,/brief-summary/);
  app.advance(121000);app.context.loadMorningNews();
  await app.reply(app.requests.at(-1),app.news('ja',{digest:null,news:[{source:'NHK経済',title:'別の新しい記事'}]}));
  const html=app.nodes['morning-news-content'].innerHTML;
  assert.ok(!html.includes(data.digest.summary));assert.ok(!html.includes('brief-summary'));
  assert.match(html,/別の新しい記事/);
});

test('same-day v2 headline cache is not reused as a reviewed digest',()=>{
  for(const version of [2,3]){
    const app=harness(),old=app.news('ja',{policy_version:version});old.digest=reviewed(old);
    app.storage.set('kn_news_v'+version+'_ja',JSON.stringify(old));
    app.storage.set('kn_news_v4_ja',JSON.stringify(old));
    app.event('DOMContentLoaded');
    assert.match(app.nodes['morning-news-content'].innerHTML,/skeleton/);
  }
});

function curated(app,lang='ja'){
  const data=app.news(lang,{delivery:'published',fetched_at:null,refreshing:false,news:[{source:'NHK経済',title:'株の動き'},{source:'ロイター経済',title:'円の動き'}]});
  data.digest=reviewed(data,{publication_mode:'curated',reviewed_at:app.now()/1000});return data;
}

test('curated September 22 edition stays dated September 22 after midnight, empty live checks and offline refresh',async()=>{
  const app=harness();app.advance(Date.parse('2026-09-22T23:59:59+09:00')-app.now());
  const data=curated(app);data.digest.headline='九月二十二日の掲載版';
  app.nodes.knInitialNews={textContent:JSON.stringify(data)};app.event('DOMContentLoaded');
  await app.reply(app.requests[0],data);
  app.advance(2000);for(const timer of app.intervals.values())timer.fn();
  let html=app.nodes['morning-news-content'].innerHTML;
  assert.ok(html.includes(data.digest.headline));assert.match(html,/2026\/09\/22 掲載/);
  assert.match(html,/掲載対象日 2026-09-22/);
  assert.equal(app.requests.filter(r=>r.url.includes('morning-news')).length,1);
  app.context.loadMorningNews(true);
  await app.reply(app.requests.at(-1),app.news('ja',{news:[],digest:null,selection_status:'empty_today'}));
  html=app.nodes['morning-news-content'].innerHTML;
  assert.ok(html.includes(data.digest.headline));assert.match(html,/2026\/09\/22 掲載/);
  assert.ok(!html.includes('2026/09/23 掲載'));
  assert.equal(JSON.parse(app.storage.get('kn_news_v4_ja')).news.length,0);
  assert.equal(JSON.parse(app.storage.get('kn_published_news_v1_ja')).edition_date,'2026-09-22');
  app.advance(121000);app.context.loadMorningNews();app.requests.at(-1).reject(new Error('offline'));await flush();
  html=app.nodes['morning-news-content'].innerHTML;
  assert.ok(html.includes(data.digest.headline));assert.match(html,/最新情報を確認できませんでした/);
  assert.match(html,/2026\/09\/22 掲載/);
});

test('a retained curated edition is restored independently of the live cache and a stale embedded edition',async()=>{
  const seed=harness(),older=curated(seed);older.digest.headline='古い掲載版';
  seed.advance(86400000);const newer=curated(seed);newer.digest.headline='保存済みの新しい掲載版';
  const app=harness({'kn_published_news_v1_ja':JSON.stringify(newer)});app.advance(2*86400000);
  app.nodes.knInitialNews={textContent:JSON.stringify(older)};app.event('DOMContentLoaded');
  assert.ok(app.nodes['morning-news-content'].innerHTML.includes(newer.digest.headline));
  assert.ok(!app.nodes['morning-news-content'].innerHTML.includes(older.digest.headline));
  app.requests[0].reject(new Error('offline'));await flush();
  assert.ok(app.nodes['morning-news-content'].innerHTML.includes(newer.digest.headline));
  assert.match(app.nodes['morning-news-content'].innerHTML,/2026\/09\/13 掲載/);
  assert.equal(JSON.parse(app.storage.get('kn_published_news_v1_ja')).edition_date,'2026-09-13');
});

test('new unreviewed live articles keep the last curated edition until a new curated release is valid',async()=>{
  const app=harness(),old=curated(app);old.digest.headline='確認済みの掲載版';
  app.nodes.knInitialNews={textContent:JSON.stringify(old)};app.advance(86400000);app.event('DOMContentLoaded');
  await app.reply(app.requests[0],app.news('ja',{news:[{source:'NHK経済',title:'まだ要約未確認の新記事'}]}));
  assert.ok(app.nodes['morning-news-content'].innerHTML.includes(old.digest.headline));
  assert.ok(!app.nodes['morning-news-content'].innerHTML.includes('まだ要約未確認の新記事'));
  const fresh=curated(app);fresh.digest.headline='新しい確認済み掲載版';
  app.context.loadMorningNews(true);await app.reply(app.requests.at(-1),fresh);
  assert.ok(app.nodes['morning-news-content'].innerHTML.includes(fresh.digest.headline));
  assert.ok(!app.nodes['morning-news-content'].innerHTML.includes(old.digest.headline));
  assert.match(app.nodes['morning-news-content'].innerHTML,/2026\/09\/13 掲載/);
  app.context.loadMorningNews(true);await app.reply(app.requests.at(-1),old);
  assert.ok(app.nodes['morning-news-content'].innerHTML.includes(fresh.digest.headline));
  assert.equal(JSON.parse(app.storage.get('kn_published_news_v1_ja')).edition_date,'2026-09-13');
});

test('a delayed same-day publication cannot replace a later released edition',async()=>{
  const app=harness(),earlier=curated(app);earlier.digest.headline='先に出た掲載版';earlier.digest.publish_at=app.now()/1000;
  app.advance(60000);const later=curated(app);later.digest.headline='後に出た掲載版';later.digest.publish_at=app.now()/1000;
  app.nodes.knInitialNews={textContent:JSON.stringify(later)};app.event('DOMContentLoaded');
  await app.reply(app.requests[0],earlier);
  assert.ok(app.nodes['morning-news-content'].innerHTML.includes(later.digest.headline));
  assert.equal(JSON.parse(app.storage.get('kn_published_news_v1_ja')).digest.publish_at,later.digest.publish_at);
});

test('an explicit live identity conflict clears the retained publication and its persistent copy',async()=>{
  const app=harness(),data=curated(app);app.nodes.knInitialNews={textContent:JSON.stringify(data)};
  app.advance(86400000);app.event('DOMContentLoaded');
  assert.ok(app.storage.has('kn_published_news_v1_ja'));
  await app.reply(app.requests[0],app.news('ja',{news:[],selection_status:'empty_today',publication_revoked:true}));
  assert.ok(!app.nodes['morning-news-content'].innerHTML.includes(data.digest.summary));
  assert.match(app.nodes['morning-news-content'].innerHTML,/まだ確認できていません/);
  assert.equal(app.storage.has('kn_published_news_v1_ja'),false);
  app.advance(901000);app.context.loadMorningNews();app.requests.at(-1).reject(new Error('offline'));await flush();
  assert.ok(!app.nodes['morning-news-content'].innerHTML.includes(data.digest.summary));
  assert.equal(app.storage.has('kn_published_news_v1_ja'),false);
});

test('prepared 08:00 edition cannot appear early from bootstrap, persistent storage or an API response',async()=>{
  for(const location of ['bootstrap','storage','api']){
    const app=harness();app.advance(Date.parse('2026-09-12T07:59:00+09:00')-app.now());
    const data=curated(app);data.digest.publish_at=Date.parse('2026-09-12T08:00:00+09:00')/1000;
    if(location==='bootstrap')app.nodes.knInitialNews={textContent:JSON.stringify(data)};
    if(location==='storage')app.storage.set('kn_published_news_v1_ja',JSON.stringify(data));
    app.event('DOMContentLoaded');
    if(location==='api')await app.reply(app.requests[0],data);
    assert.ok(!app.nodes['morning-news-content'].innerHTML.includes(data.digest.summary),location);
    app.advance(60000);
    if(location!=='api')await app.reply(app.requests[0],data);
    else {app.context.loadMorningNews();await app.reply(app.requests.at(-1),data);}
    assert.ok(app.nodes['morning-news-content'].innerHTML.includes(data.digest.summary),location);
    assert.equal(JSON.parse(app.storage.get('kn_published_news_v1_ja')).digest.publish_at,data.digest.publish_at);
  }
});

test('invalid release timestamps and tomorrow editions cannot enter the published cache',async()=>{
  for(const mutate of [
    d=>d.digest.publish_at=null,
    d=>d.digest.publish_at=d.digest.reviewed_at-1,
    d=>d.digest.publish_at=d.digest.reviewed_at+1,
    d=>{d.digest.reviewed_at-=86400;d.digest.publish_at=d.digest.reviewed_at;},
    d=>{d.edition_date='2026-09-13';d.digest.edition_date=d.edition_date;}
  ]){
    const app=harness(),data=curated(app);mutate(data);app.event('DOMContentLoaded');await app.reply(app.requests[0],data);
    assert.ok(!app.nodes['morning-news-content'].innerHTML.includes(data.digest.summary));
    assert.equal(app.storage.has('kn_published_news_v1_ja'),false);
  }
});

test('out-of-range dates in saved publications cannot block news or market startup',()=>{
  for(const mutate of [d=>d.news[0].published_at=-1e100,d=>d.digest.reviewed_at=-1e100]){
    const app=harness(),data=curated(app);mutate(data);
    app.storage.set('kn_published_news_v1_ja',JSON.stringify(data));
    app.storage.set('kn_market_v1',JSON.stringify(app.market()));
    assert.doesNotThrow(()=>app.event('DOMContentLoaded'));
    assert.equal(app.renders.length,1);
    assert.equal(app.requests.length,2);
    assert.ok(!app.nodes['morning-news-content'].innerHTML.includes(data.digest.summary));
  }
});

test('a revocation in initial HTML clears saved copy before any API response',async()=>{
  const app=harness(),old=curated(app);
  app.storage.set('kn_published_news_v1_ja',JSON.stringify(old));
  const corrected=app.news('ja',{publication_revoked:true,news:[{source:'NHK経済',title:'訂正後の見出し'}]});
  app.nodes.knInitialNews={textContent:JSON.stringify(corrected)};app.event('DOMContentLoaded');
  assert.ok(!app.nodes['morning-news-content'].innerHTML.includes(old.digest.summary));
  assert.ok(app.nodes['morning-news-content'].innerHTML.includes('訂正後の見出し'));
  assert.equal(app.storage.has('kn_published_news_v1_ja'),false);
  app.requests[0].reject(new Error('offline'));await flush();
  assert.ok(!app.nodes['morning-news-content'].innerHTML.includes(old.digest.summary));
});

test('08:00 JST triggers one check despite a fresh prior edition, then keeps the normal 120-second TTL',async()=>{
  const app=harness(),old=curated(app);app.advance(Date.parse('2026-09-13T07:59:59+09:00')-app.now());
  app.nodes.knInitialNews={textContent:JSON.stringify(old)};app.event('DOMContentLoaded');await app.reply(app.requests[0],old);
  const count=()=>app.requests.filter(r=>r.url.includes('morning-news')).length;
  assert.equal(count(),1);
  app.advance(1000);for(const timer of app.intervals.values())timer.fn();
  assert.equal(count(),2,'Release boundary bypasses fresh fetch TTL');
  await app.reply(app.requests.findLast(r=>r.url.includes('morning-news')),old);
  for(let i=0;i<30;i++)for(const timer of app.intervals.values())timer.fn();
  assert.equal(count(),2,'An older displayed calendar date does not poll each second');
  app.advance(119000);app.context.loadMorningNews();assert.equal(count(),2);
  app.advance(1000);app.context.loadMorningNews();assert.equal(count(),3);
  const next=curated(app);next.digest.headline='八時に公開された掲載版';
  await app.reply(app.requests.at(-1),next);
  assert.ok(app.nodes['morning-news-content'].innerHTML.includes(next.digest.headline));
  assert.match(app.nodes['morning-news-content'].innerHTML,/2026\/09\/13 掲載/);
});

test('a pending pre-08:00 request is followed by one release check after it completes',async()=>{
  const app=harness(),old=curated(app);app.advance(Date.parse('2026-09-13T07:59:59+09:00')-app.now());
  app.nodes.knInitialNews={textContent:JSON.stringify(old)};app.event('DOMContentLoaded');
  app.advance(1000);for(const timer of app.intervals.values())timer.fn();
  assert.equal(app.requests.filter(r=>r.url.includes('morning-news')).length,1);
  await app.reply(app.requests[0],old);for(const timer of app.intervals.values())timer.fn();
  assert.equal(app.requests.filter(r=>r.url.includes('morning-news')).length,2);
  await app.reply(app.requests.findLast(r=>r.url.includes('morning-news')),old);
  for(const timer of app.intervals.values())timer.fn();
  assert.equal(app.requests.filter(r=>r.url.includes('morning-news')).length,2);
});

test('returning from a hidden tab at 08:00 checks publication even inside the fetch TTL',async()=>{
  const app=harness(),old=curated(app);app.advance(Date.parse('2026-09-13T07:59:59+09:00')-app.now());
  app.nodes.knInitialNews={textContent:JSON.stringify(old)};app.event('DOMContentLoaded');await app.reply(app.requests[0],old);
  app.context.document.hidden=true;app.advance(1000);for(const timer of app.intervals.values())timer.fn();
  assert.equal(app.requests.filter(r=>r.url.includes('morning-news')).length,1);
  app.context.document.hidden=false;app.event('visibilitychange');
  assert.equal(app.requests.filter(r=>r.url.includes('morning-news')).length,2);
});

function withArticleSummaries(data){
  data.digest.article_summaries=data.digest.article_refs.map((ref,i)=>({...ref,headline:'やさしい見出し'+i,summary:('ニュース'+i+'の出来事と暮らしへの影響を説明します。').repeat(10)}));
  return data;
}

test('Read more reveals each reviewed article summary without another click and keeps original links',async()=>{
  const app=harness(),data=withArticleSummaries(curated(app));
  app.event('DOMContentLoaded');await app.reply(app.requests[0],data);
  const html=app.nodes['morning-news-content'].innerHTML;
  const detail=html.split('<details class="read-more"')[1].split('</details>')[0];
  assert.equal((detail.match(/class="article-summary"/g)||[]).length,2);
  assert.ok(!detail.includes('<details class="story"'));
  assert.ok(!detail.includes('stories-intro'));
  data.digest.article_summaries.forEach(item=>{
    assert.ok(detail.includes('<span class="story-title">'+item.headline+'</span>'));
    assert.ok(detail.includes(item.summary));assert.ok(detail.includes('href="'+item.url+'"'));
  });
  assert.ok(html.split('<details class="read-more"')[0].includes(data.digest.summary));
});

test('article copy cannot be shown with incomplete, duplicate or mismatched original references',async()=>{
  for(const mutate of [
    d=>d.digest.article_summaries.pop(),
    d=>d.digest.article_summaries[1]={...d.digest.article_summaries[0]},
    d=>d.digest.article_summaries[0].title='別の原題',
    d=>d.digest.article_summaries[0].url='https://news.example/wrong',
    d=>d.digest.article_summaries[0].source='別の配信元',
    d=>d.digest.article_summaries[0].published_at-=1,
    d=>d.digest.article_summaries[0].headline=' ',
    d=>d.digest.article_summaries[0].summary='文'.repeat(199),
    d=>d.digest.article_summaries[0].summary='文'.repeat(301),
    d=>d.digest.article_summaries=null,
  ]){
    const app=harness(),data=withArticleSummaries(curated(app));mutate(data);
    app.event('DOMContentLoaded');await app.reply(app.requests[0],data);
    const html=app.nodes['morning-news-content'].innerHTML;
    assert.ok(!html.includes('article-summary'));assert.ok(!html.includes('brief-summary'));
  }
});

test('reviewed article copy is escaped and retains Japanese language under a translated interface',async()=>{
  const app=harness(),data=withArticleSummaries(curated(app,'en'));app.language('en');
  data.news=data.news.map(item=>({...item,title:'Translated original headline'}));
  data.digest.article_summaries[0].headline='<img src=x onerror=bad()>';
  data.digest.article_summaries[0].summary='<script>bad()</script>'+'確認した記事の説明です。'.repeat(17);
  app.event('DOMContentLoaded');await app.reply(app.requests[0],data);
  const html=app.nodes['morning-news-content'].innerHTML;
  assert.equal((html.match(/class="story summarized-story" lang="ja"/g)||[]).length,2);
  assert.ok(html.includes('&lt;img'));assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));
});

test('API delivers one 200–300 character published summary from two or three articles without a fake feed timestamp',async()=>{
  for(const count of [2,3]){
    const app=harness(),data=curated(app);
    if(count===3){data.news.push({...data.news[0],url:'https://news.example/third',title:'第三の話題'});data.digest.article_refs.push({...data.news[2]});}
    data.digest.summary='確認した事実と暮らしへの影響をわかりやすくまとめた文章です。'.repeat(8);
    assert.ok(data.digest.summary.length>=200&&data.digest.summary.length<=300);
    app.event('DOMContentLoaded');await app.reply(app.requests[0],data);
    const html=app.nodes['morning-news-content'].innerHTML;
    assert.equal((html.match(/class="brief-summary"/g)||[]).length,1);
    assert.equal((html.match(/<details class="story"/g)||[]).length,count);
    assert.ok(html.includes(data.digest.summary));assert.match(html,/掲載/);
    assert.ok(!html.includes('morning-news-error'));assert.equal(app.storage.has('kn_news_v4_ja'),false);
    app.context.loadMorningNews();assert.equal(app.requests.length,2,'Published edition is reused between refreshes');
  }
});

test('curated publication with no articles, invalid review time or wrong length cannot render',async()=>{
  for(const mutate of [
    d=>{d.news=[];d.digest.article_refs=[];},
    d=>d.digest.reviewed_at+=1,
    d=>d.digest.reviewed_at-=86400,
    d=>d.digest.reviewed_at-=1,
    d=>d.digest.summary='文'.repeat(199),
    d=>d.digest.summary='文'.repeat(301)
  ]){
    const app=harness(),data=curated(app);mutate(data);app.event('DOMContentLoaded');await app.reply(app.requests[0],data);
    assert.ok(!app.nodes['morning-news-content'].innerHTML.includes('brief-summary'));
  }
});

test('published editions are kept per language while original Japanese summary stays attributed',async()=>{
  const app=harness(),ja=curated(app);app.nodes.knInitialNews={textContent:JSON.stringify(ja)};app.event('DOMContentLoaded');
  app.language('en');app.event('langChanged');const en=curated(app,'en');en.news.forEach(item=>item.title='Translated '+item.title);
  await app.reply(app.requests.find(r=>r.url.endsWith('=en')),en);
  assert.match(app.nodes['morning-news-content'].innerHTML,/Published/);
  assert.match(app.nodes['morning-news-content'].innerHTML,/class="daily-digest" lang="ja"/);
  app.language('ja');app.event('langChanged');
  assert.ok(app.nodes['morning-news-content'].innerHTML.includes(ja.digest.summary));
  assert.match(app.nodes['morning-news-content'].innerHTML,/掲載/);
});

test('an approved dated supplement stays separate from the two-topic published summary',async()=>{
  const app=harness(),data=curated(app),old=app.now()/1000-86400;
  data.supplements=[{source:'NHK経済',title:'以前の補足',url:'https://news.example/context',published_at:old,published_date:'2026-09-11',is_supplement:true,editorial_reason:'仕組みを理解するための補足'}];
  app.event('DOMContentLoaded');await app.reply(app.requests[0],data);
  const html=app.nodes['morning-news-content'].innerHTML;
  assert.ok(html.includes(data.digest.summary));assert.match(html,/日付付きの補足/);
  assert.ok(!html.split('<details class="read-more"')[0].includes('以前の補足'));
});

test('authored Japanese digest remains explicitly Japanese when reference headlines are translated',async()=>{
  const app=harness();app.language('en');app.event('DOMContentLoaded');const data=app.news('en');data.digest=reviewed(data);
  data.news[0].title='Translated headline';
  await app.reply(app.requests[0],data);
  const html=app.nodes['morning-news-content'].innerHTML;
  assert.match(html,/class="daily-digest" lang="ja"/);
  assert.ok(html.includes(data.digest.summary));assert.match(html,/Translated headline/);
});

test('refresh preserves open articles and keyboard focus; language change resets them',async()=>{
  const app=harness();app.event('DOMContentLoaded');
  await app.reply(app.requests[0],app.news());
  const content=app.nodes['morning-news-content'];
  content.details.forEach(node=>node.open=true);
  const oldSummary=content.summaries[1];oldSummary.focus();
  app.advance(121000);app.context.loadMorningNews();
  await app.reply(app.requests.at(-1),app.news('ja',{news:[{source:'NHK経済',title:'更新された見出し'}]}));
  assert.ok(content.details.every(node=>node.open));
  assert.equal(app.context.document.activeElement,content.summaries[1]);
  assert.notEqual(app.context.document.activeElement,oldSummary);
  assert.equal(content.summaries[1].focusOptions.preventScroll,true);
  app.language('en');app.event('langChanged');
  await app.reply(app.requests.at(-1),app.news('en'));
  assert.ok(content.details.every(node=>!node.open));
});

test('unchanged news keeps the same open detail and focused summary DOM nodes',async()=>{
  const app=harness();app.event('DOMContentLoaded');const data=app.news();
  await app.reply(app.requests[0],data);
  const content=app.nodes['morning-news-content'];
  content.details.forEach(node=>node.open=true);content.summaries[1].focus();
  const detail=content.details[1],summary=content.summaries[1],replacements=content.replacements;
  assert.match(content.innerHTML,/open=""/,'The harness serializes reader interaction like a browser');
  app.context.loadMorningNews();
  assert.equal(content.replacements,replacements,'Cached refresh does not rebuild reader state');
  app.context.loadMorningNews(true);await app.reply(app.requests.at(-1),data);
  assert.equal(content.replacements,replacements,'An unchanged successful response does not replace DOM');
  assert.equal(content.details[1],detail);assert.equal(content.summaries[1],summary);
  assert.equal(app.context.document.activeElement,summary);assert.equal(detail.open,true);
});

test('background retries keep a failed-refresh notice until a successful response',async()=>{
  const app=harness();app.event('DOMContentLoaded');const data=app.news();
  await app.reply(app.requests[0],data);
  app.context.loadMorningNews(true);app.requests.at(-1).reject(new Error('offline'));await flush();
  const content=app.nodes['morning-news-content'];
  content.details.forEach(node=>node.open=true);content.summaries[1].focus();
  const summary=content.summaries[1],replacements=content.replacements;
  assert.match(content.innerHTML,/いま更新できません/);
  app.context.loadMorningNews(true);
  assert.equal(content.replacements,replacements,'Starting a background request keeps the failed notice');
  await app.reply(app.requests.at(-1),app.news('ja',{news:[],fetched_at:null,refreshing:true,selection_status:'refreshing'}));
  assert.equal(content.replacements,replacements,'A pending response also keeps the failed notice');
  const retry=[...app.timers].find(([,timer])=>timer.ms===3000);assert.ok(retry);
  app.timers.delete(retry[0]);retry[1].fn();
  app.requests.at(-1).reject(new Error('still offline'));await flush();
  assert.equal(content.replacements,replacements,'Repeated failure does not rebuild the article');
  assert.equal(app.context.document.activeElement,summary);
  app.context.loadMorningNews(true);await app.reply(app.requests.at(-1),data);
  assert.equal(content.replacements,replacements+1,'Success clears the notice once');
  assert.ok(!content.innerHTML.includes('いま更新できません'));
  assert.ok(content.details.every(node=>node.open));
});

test('automatic cold retries retain the error view while an explicit retry shows loading',async()=>{
  const app=harness();app.event('DOMContentLoaded');
  app.requests[0].reject(new Error('offline'));await flush();
  const content=app.nodes['morning-news-content'],replacements=content.replacements;
  const retry=[...app.timers].find(([,timer])=>timer.ms===1500);assert.ok(retry);
  app.timers.delete(retry[0]);retry[1].fn();
  assert.equal(content.replacements,replacements);assert.match(content.innerHTML,/morning-news-error/);
  await app.reply(app.requests.at(-1),app.news('ja',{news:[],fetched_at:null,refreshing:true,selection_status:'refreshing'}));
  assert.equal(content.replacements,replacements);assert.match(content.innerHTML,/morning-news-error/);
  content.button.onclick();assert.match(content.innerHTML,/skeleton/);
  await app.reply(app.requests.at(-1),app.news());
  assert.match(content.innerHTML,/今日のニュース/);assert.ok(!content.innerHTML.includes('skeleton'));
});

test('returning from another language loading view restores an identical cached article',async()=>{
  const app=harness();app.event('DOMContentLoaded');await app.reply(app.requests[0],app.news());
  const content=app.nodes['morning-news-content'];
  app.language('en');app.event('langChanged');assert.match(content.innerHTML,/Preparing headlines/);
  app.language('ja');app.event('langChanged');
  assert.match(content.innerHTML,/今日のニュース/);assert.ok(!content.innerHTML.includes('skeleton'));
  assert.equal(content.attrs['aria-busy'],'false');
});

test('failed refresh retains expanded content and escapes unsafe titles and source labels',async()=>{
  const app=harness();app.event('DOMContentLoaded');
  await app.reply(app.requests[0],app.news('ja',{news:[{source:'\" onclick=\"bad()',title:'<script>bad()</script>'}]}));
  const content=app.nodes['morning-news-content'];
  content.details.forEach(node=>node.open=true);
  assert.ok(!content.innerHTML.includes('" onclick="'));
  assert.ok(!content.innerHTML.includes('<script>'));
  app.advance(121000);app.context.loadMorningNews();
  app.requests.at(-1).reject(new Error('offline'));await flush();
  assert.ok(content.details.every(node=>node.open));
  assert.match(content.innerHTML,/いま更新できません/);
});

test('an article disappearing during refresh returns keyboard focus to Read more',async()=>{
  const app=harness();app.event('DOMContentLoaded');
  await app.reply(app.requests[0],app.news());
  const content=app.nodes['morning-news-content'];
  content.details.forEach(node=>node.open=true);content.summaries[1].focus();
  app.advance(121000);app.context.loadMorningNews();
  await app.reply(app.requests.at(-1),app.news('ja',{news:[{source:'別の配信元',title:'見出し',url:'https://news.example/replacement'}]}));
  assert.equal(app.context.document.activeElement,content.summaries[0]);
  assert.equal(content.details[0].open,true);
  assert.equal(content.details[1].open,false);
});

test('saved recent market data renders before the first network response',()=>{
  const app=harness();app.storage.set('kn_market_v1',JSON.stringify(app.market()));
  app.event('DOMContentLoaded');assert.equal(app.renders.length,1);assert.equal(app.requests.length,2);
});

test('first visitor gets embedded market prices before network and a returning visitor uses the newer snapshot',()=>{
  const app=harness();const embedded=app.market();
  app.nodes.knInitialMarket={textContent:JSON.stringify(embedded)};
  app.event('DOMContentLoaded');
  assert.equal(app.renders.length,1);assert.equal(app.context.__knHomeABase.fetched_at,embedded.fetched_at);
  const returning=harness();const older={...returning.market(),fetched_at:returning.now()/1000-3600};
  returning.nodes.knInitialMarket={textContent:JSON.stringify(older)};
  returning.storage.set('kn_market_v1',JSON.stringify(returning.market()));returning.event('DOMContentLoaded');
  assert.equal(returning.context.__knHomeABase.fetched_at,returning.now()/1000);
});

test('previous real market prices survive a day away while out-of-range snapshots are rejected',()=>{
  const app=harness();const old={...app.market(),fetched_at:app.now()/1000-86400};
  app.storage.set('kn_market_v1',JSON.stringify(old));app.event('DOMContentLoaded');
  assert.equal(app.renders.length,1);assert.equal(app.context.__knHomeABase.fetched_at,old.fetched_at);
  for(const age of [-10,7*86400]){
    const invalid=harness();invalid.nodes.knInitialMarket={textContent:JSON.stringify({...invalid.market(),fetched_at:invalid.now()/1000-age})};
    invalid.event('DOMContentLoaded');assert.equal(invalid.renders.length,0);
  }
});

test('hidden tabs cancel core-market retries and visibility restoration shares one fresh request',async()=>{
  const app=harness();app.event('DOMContentLoaded');
  await app.reply(app.requests[1],{market:{},fetched_at:null,refreshing:true});
  assert.ok([...app.timers.values()].some(timer=>timer.ms===2000));
  app.context.document.hidden=true;app.event('visibilitychange');
  assert.ok(![...app.timers.values()].some(timer=>timer.ms===2000));
  await app.context.loadMorningData();
  assert.equal(app.requests.filter(request=>request.url==='/api/morning-data').length,1);
  app.context.document.hidden=false;app.event('visibilitychange');app.event('visibilitychange');
  assert.equal(app.requests.filter(request=>request.url==='/api/morning-data').length,2);
  await app.reply(app.requests.findLast(request=>request.url==='/api/morning-data'),app.market());
  assert.equal(app.renders.length,1);
});

test('a market response finishing after hiding cannot restart background retries',async()=>{
  for(const fails of [false,true]){
    const app=harness();app.event('DOMContentLoaded');app.context.document.hidden=true;app.event('visibilitychange');
    if(fails){app.requests[1].reject(new Error('offline'));await flush();}
    else await app.reply(app.requests[1],{market:{},fetched_at:null,refreshing:true});
    assert.ok(![...app.timers.values()].some(timer=>timer.ms<12000),'No market backoff timer while hidden');
    await app.context.loadMorningData();assert.equal(app.requests.filter(request=>request.url==='/api/morning-data').length,1);
  }
});

test('empty background refresh keeps the visible market and retries without a failed state',async()=>{
  const app=harness();app.storage.set('kn_market_v1',JSON.stringify(app.market()));
  let failed=0;app.context.knHomeA={acceptBase(){},baseFailed(){failed++;}};
  app.event('DOMContentLoaded');await app.reply(app.requests[1],{market:{},fetched_at:null,refreshing:true});
  assert.equal(app.renders.length,1);assert.equal(failed,0);
  assert.ok([...app.timers.values()].some(t=>t.ms===2000));
});

function useActualMarketGrid(app){
  const grid=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').split('\n').find(line=>line.startsWith('function renderMorningGrid('));
  app.context.getSelIndices=()=>['日経225'];app.context._allIndices=[];
  app.nodes['morning-idx-grid']={innerHTML:'',querySelectorAll:()=>[]};
  vm.runInNewContext(grid,app.context);
}

test('malformed saved or embedded market rows cannot interrupt news and market startup',async()=>{
  for(const origin of ['saved','embedded']){
    for(const market of [[],42,{'日経225':null},{'日経225':{display:123}},{'日経225':{display:{text:'123'}}}]){
      const app=harness();useActualMarketGrid(app);
      const bad={...app.market(),market};
      if(origin==='saved')app.storage.set('kn_market_v1',JSON.stringify(bad));
      else app.nodes.knInitialMarket={textContent:JSON.stringify(bad)};
      assert.doesNotThrow(()=>app.event('DOMContentLoaded'));
      assert.deepEqual(app.requests.map(r=>r.url),['/api/morning-news?lang=ja','/api/morning-data']);
      assert.equal(app.context._mktCache,null);
      await app.reply(app.requests[0],app.news());await app.reply(app.requests[1],app.market());
      assert.match(app.nodes['morning-news-content'].innerHTML,/今日のニュース/);
      assert.match(app.nodes['morning-idx-grid'].innerHTML,/100 ▲1%/);
    }
  }
});

test('market normalization retains valid rows and quote dates while discarding invalid siblings',()=>{
  const app=harness();useActualMarketGrid(app);
  const stamp=app.now()/1000,valid={display:'100 ▲1%',price:100,pct:1,currency:'JPY',fetched_at:stamp-3600};
  app.storage.set('kn_market_v1',JSON.stringify({fetched_at:stamp,updated:{bad:true},market:{
    '日経225':valid,'ドル円':{display:123},'NYダウ':{display:'40,000',price:'40000'},
    'S&P500':{display:'5,000',fetched_at:stamp+1},'VIX恐怖指数':{display:'20',fetched_at:null},
    '米10年金利':{display:'<img src=x onerror=bad()>'}
  }}));
  app.event('DOMContentLoaded');
  assert.equal(Object.keys(app.context._mktCache).join(','),'日経225');
  assert.equal(app.context._mktCache['日経225'].fetched_at,stamp-3600);
  assert.equal(app.context._mktCache['日経225'].price,100);
  assert.equal(app.context.__knHomeABase.fetched_at,stamp-3600);
  assert.equal(app.nodes['morning-update-time'].textContent,'--');
  assert.match(app.nodes['morning-idx-grid'].innerHTML,/100 ▲1%/);
  assert.equal(app.requests.length,2);
});

test('API market rows are normalized before rendering and persistent storage',async()=>{
  const app=harness();useActualMarketGrid(app);app.event('DOMContentLoaded');
  const stamp=app.now()/1000;
  await app.reply(app.requests[1],{fetched_at:stamp,updated:'09:00',market:{
    '日経225':{display:'100 ▲1%',price:100,fetched_at:stamp-60},
    'ドル円':{display:123},'米10年金利':{display:'4.2',pct:'unknown'}
  }});
  const stored=JSON.parse(app.storage.get('kn_market_v1'));
  assert.deepEqual(Object.keys(stored.market),['日経225']);
  assert.equal(stored.fetched_at,stamp-60);assert.equal(stored.market['日経225'].fetched_at,stamp-60);
  assert.equal(Object.keys(app.context._mktCache).join(','),'日経225');
  assert.match(app.nodes['morning-idx-grid'].innerHTML,/100 ▲1%/);
});

test('entirely malformed API market data preserves valid prices and leaves news usable',async()=>{
  for(const payload of [null,{market:[]},{market:{'日経225':{display:123}},fetched_at:Date.UTC(2026,8,12)/1000}]){
    const app=harness();useActualMarketGrid(app);app.storage.set('kn_market_v1',JSON.stringify(app.market()));
    app.event('DOMContentLoaded');await app.reply(app.requests[1],payload);await app.reply(app.requests[0],app.news());
    assert.equal(app.context._mktCache['日経225'].display,'100 ▲1%');
    assert.match(app.nodes['morning-idx-grid'].innerHTML,/100 ▲1%/);
    assert.match(app.nodes['morning-news-content'].innerHTML,/今日のニュース/);
    assert.equal(JSON.parse(app.storage.get('kn_market_v1')).market['日経225'].display,'100 ▲1%');
  }
});

test('pre-policy cache is never used, even when its retrieval time is recent',()=>{
  const app=harness();
  const legacy=app.news('ja',{policy_version:1,news:[{source:'NHK経済',title:'日付未確認の旧見出し'}]});
  app.storage.set('kn_news_v1_ja',JSON.stringify(legacy));
  app.storage.set('kn_news_v4_ja',JSON.stringify(legacy));
  app.event('DOMContentLoaded');
  assert.match(app.nodes['morning-news-content'].innerHTML,/skeleton/);
  assert.ok(!app.nodes['morning-news-content'].innerHTML.includes('日付未確認の旧見出し'));
});

test('successfully checked empty day replaces old headlines without adding filler or retry errors',async()=>{
  const app=harness();app.event('DOMContentLoaded');
  await app.reply(app.requests[0],app.news());
  app.advance(121000);app.context.loadMorningNews();
  await app.reply(app.requests.at(-1),app.news('ja',{news:[],selection_status:'empty_today'}));
  const html=app.nodes['morning-news-content'].innerHTML;
  assert.match(html,/まだ確認できていません/);
  assert.ok(!html.includes('今日のニュース'));
  assert.ok(!html.includes('morning-news-error'));
  assert.equal(JSON.parse(app.storage.get('kn_news_v4_ja')).news.length,0);
});

test('reviewed older news stays in a separately dated supplement and never fills today',async()=>{
  const app=harness();app.event('DOMContentLoaded');
  const old=app.now()/1000-86400;
  const supplement={source:'NHK経済',title:'確認済みの補足',url:'https://news.example/older',published_at:old,published_date:new Date(old*1000+9*3600000).toISOString().slice(0,10),is_supplement:true,editorial_reason:'今日の制度変更を理解するための補足です。'};
  await app.reply(app.requests[0],app.news('ja',{news:[],supplements:[supplement]}));
  const html=app.nodes['morning-news-content'].innerHTML;
  assert.match(html,/日付付きの補足/);
  assert.match(html,/2026\/9\/11/);
  assert.match(html,/まだ確認できていません/);
  assert.ok(!html.split('<details class="read-more"')[0].includes('確認済みの補足'));
  assert.ok(html.includes(supplement.editorial_reason));
});

test('yesterday cannot reappear from cache when the network fails after JST midnight',async()=>{
  const app=harness();app.advance(Date.UTC(2026,8,12,14,59,59)-app.now());app.event('DOMContentLoaded');
  await app.reply(app.requests[0],app.news());
  app.advance(2000);
  for(const timer of app.intervals.values())timer.fn();
  assert.ok(!app.nodes['morning-news-content'].innerHTML.includes('今日のニュース'));
  app.context.loadMorningNews();
  const request=app.requests.findLast(r=>r.url.includes('morning-news'));
  assert.notEqual(request,app.requests[0]);
  assert.ok(!app.nodes['morning-news-content'].innerHTML.includes('今日のニュース'));
  request.reject(new Error('offline'));await flush();
  assert.ok(!app.nodes['morning-news-content'].innerHTML.includes('今日のニュース'));
  assert.match(app.nodes['morning-news-content'].innerHTML,/もう一度/);
});

test('a response requested yesterday is discarded if it arrives after JST midnight',async()=>{
  const app=harness();app.advance(Date.UTC(2026,8,12,14,59,59)-app.now());app.event('DOMContentLoaded');
  const yesterday=app.news();app.advance(2000);
  await app.reply(app.requests[0],yesterday);
  assert.ok(!app.nodes['morning-news-content'].innerHTML.includes('今日のニュース'));
  assert.match(app.nodes['morning-news-content'].innerHTML,/skeleton/);
  assert.equal(app.storage.has('kn_news_v4_ja'),false);
});

test('missing, future and noncurrent publication dates never display as today',async()=>{
  for(const metadata of [{published_at:null},{published_at:9999999999},{published_date:'2026-09-11'},{url:'javascript:alert(1)'}]){
    const app=harness();app.event('DOMContentLoaded');
    await app.reply(app.requests[0],app.news('ja',{news:[{source:'NHK経済',title:'採用しない見出し',...metadata}]}));
    assert.ok(!app.nodes['morning-news-content'].innerHTML.includes('採用しない見出し'));
  }
});

test('intro visuals and animation timeline remain byte-identical to the approved release',()=>{
  const child=require('node:child_process');
  const before=child.execFileSync('git',['show','77ec036:index.html'],{cwd:path.join(__dirname,'..'),encoding:'utf8',maxBuffer:2e6});
  const after=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  function intro(html){const start=html.indexOf('    <!-- Approved mint glass intro');const end=html.indexOf('<!-- LP -->',start);return html.slice(start,end);}
  assert.equal(intro(after),intro(before));
});

test('simulator loads once on demand and keeps a retry after failure',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const marker=html.indexOf('  if(window.__KN_SIM_EMBED4_BOOTED)');
  const end=html.indexOf('})();',marker);
  const code='(function(){'+html.slice(marker,end+5);
  const callbacks={},timers=new Map();let seq=0,loads=0;
  const frame={contentDocument:null,set src(value){this.url=value;loads++;}},status={hidden:true,querySelector(){return this.button||(this.button={});}},classes=new Set();
  const overlay={classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}};
  const nav={addEventListener:(name,fn)=>callbacks.nav=fn},ham={classList:{add(){},remove(){}},addEventListener(){}},drawer={addEventListener(){}};
  const nodes={knSimEmbedFrame:frame,knSimEmbedOv:overlay,knSimLoadState:status,knBottomNav:nav,knFloatHam:ham,sideDrawer:drawer};
  const context={document:{readyState:'complete',getElementById:id=>nodes[id]},location:{},setTimeout:(fn,ms)=>{timers.set(++seq,{fn,ms});return seq;},clearTimeout:id=>timers.delete(id)};
  context.window=context;vm.runInNewContext(code,context);
  assert.equal(loads,0,'No simulator document at startup');
  context.openSimulator();context.openSimulator();assert.equal(loads,1);assert.equal(status.hidden,false);
  assert.match(frame.url,/^\/static\/simulator-embed-[a-f0-9]+\.html$/);
  frame.contentDocument={URL:frame.url,getElementById:id=>id==='tab-daily'?{}:null};frame.onload();
  assert.equal(status.hidden,true);context.openSimulator();assert.equal(loads,1);
  frame.onerror();assert.equal(status.hidden,false);assert.match(status.innerHTML,/もう一度/);
  status.button.onclick();assert.equal(loads,2);frame.onload();assert.equal(status.hidden,true);
  assert.ok(!html.includes('loop(20); openSimBody();'));
  const asset=fs.readFileSync(path.join(__dirname,'..',frame.url),'utf8');
  assert.ok(asset.includes('id="tab-daily"'));assert.ok(!asset.includes('id="sw-register"'));
});

test('extended game code is preserved in order and loads only when opened',async()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const before=require('node:child_process').execFileSync('git',['show','77ec036:index.html'],{cwd:path.join(__dirname,'..'),encoding:'utf8',maxBuffer:2e6});
  const marker=before.indexOf('if(window.__PETGAME_BOOTED)');
  const block=before.slice(before.lastIndexOf('<script>',marker),before.indexOf('<!-- ===== Release #9:',marker));
  const original=[...block.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  const assetPath=html.match(/script.src='(\/static\/pet-features-[a-f0-9]+\.js)'/)[1];
  assert.equal(fs.readFileSync(path.join(__dirname,'..',assetPath),'utf8'),original.join('\n;\n')+'\n');
  const start=html.indexOf('var petLoading=null;'),end=html.indexOf('window.closePetTab=',start);
  const scripts=[],card={inert:false},body={insertBefore:()=>{}},nodes={},timers=new Map();let seq=0;
  const overlay={classList:{add(){}}};
  const context={Promise,moveCard(){},setTimeout:fn=>{timers.set(++seq,fn);return seq;},clearTimeout:id=>timers.delete(id),document:{
    getElementById:id=>id==='pet-card'?card:id==='petOvBody'?body:id==='petOv'?overlay:nodes[id],
    createElement(tag){if(tag==='script')return {remove(){}};const el={setAttribute(){},style:{},remove(){delete nodes.petLoadState;},querySelector(){return this.button||(this.button={});}};nodes.petLoadState=el;return el;},
    head:{appendChild:s=>scripts.push(s)}
  }};context.window=context;vm.runInNewContext(html.slice(start,end),context);
  assert.equal(scripts.length,0);
  context.openPetTab();context.openPetTab();assert.equal(scripts.length,1);assert.equal(card.inert,true);
  [...timers.values()][0]();await flush();assert.match(nodes.petLoadState.innerHTML,/もう一度/);
  nodes.petLoadState.button.onclick();assert.equal(scripts.length,2);
  scripts[0].onload();await flush();assert.equal(card.inert,true,'Late result must not finish a newer attempt');
  scripts[1].onerror();await flush();nodes.petLoadState.button.onclick();assert.equal(scripts.length,3);
  context.__PG={open(){}};scripts[2].onload();await flush();assert.equal(card.inert,false);
  context.openPetTab();assert.equal(scripts.length,3);assert.equal(timers.size,0);
  // Login and news-view rewards belong to the original small card runtime.
  assert.ok(html.includes('render(false);dailyLogin();startStroll()'));
});


test('a verified one-topic edition remains readable on quiet news days',async()=>{
  const app=harness(),data=curated(app);
  data.news=data.news.slice(0,1);data.digest.article_refs=data.digest.article_refs.slice(0,1);
  if(data.digest.article_summaries)data.digest.article_summaries=data.digest.article_summaries.slice(0,1);
  app.event('DOMContentLoaded');await app.reply(app.requests[0],data);
  assert.ok(app.nodes['morning-news-content'].innerHTML.includes(data.digest.summary));
});

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
  function element(){return {innerHTML:'',textContent:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];},querySelector(){return this.button||(this.button={});}};}
  ['morning-news-content','morning-analysis','morning-points','morning-countdown','morning-update-time'].forEach(id=>nodes[id]=element());
  const context={console,Promise,Date:FakeDate,Number,AbortController,
    document:{readyState:'loading',hidden:false,documentElement:{lang:'ja'},getElementById:id=>nodes[id]||null,addEventListener:(name,fn)=>(listeners[name]||=[]).push(fn)},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v))},
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
    news(l='ja',extra={}){return {lang:l,news:[{source:'NHK経済',title:'今日のニュース'}],fetched_at:clock/1000,updated:'09:00',refreshing:false,stale:false,translation_pending:false,...extra};},
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
  app.storage.set('kn_news_v1_ja',JSON.stringify(old));app.event('DOMContentLoaded');
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
  assert.equal(app.storage.has('kn_news_v1_ja'),false);
  assert.match(app.nodes['morning-news-content'].innerHTML,/skeleton/);
  for(const [id,timer] of [...app.timers])if(timer.ms===1500){app.timers.delete(id);timer.fn();}
  assert.equal(app.requests.filter(r=>r.url.includes('morning-news')).length,2);
});

test('expired saved headlines are not shown; cold failure exposes a working retry',async()=>{
  const app=harness();app.storage.set('kn_news_v1_ja',JSON.stringify(app.news('ja',{fetched_at:(app.now()-901000)/1000})));
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

test('saved recent market data renders before the first network response',()=>{
  const app=harness();app.storage.set('kn_market_v1',JSON.stringify(app.market()));
  app.event('DOMContentLoaded');assert.equal(app.renders.length,1);assert.equal(app.requests.length,2);
});

test('intro markup and timing remain byte-identical to the approved release',()=>{
  const child=require('node:child_process');
  const before=child.execFileSync('git',['show','77ec036:index.html'],{cwd:path.join(__dirname,'..'),encoding:'utf8',maxBuffer:2e6});
  const after=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  function intro(html){const start=html.indexOf('    <!-- Approved mint glass intro');const end=html.indexOf('// ===== SIMULATOR OPEN/CLOSE =====',start);return html.slice(start,end);}
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

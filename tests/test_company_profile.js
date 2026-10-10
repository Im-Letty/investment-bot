const {test}=require('node:test');
const assert=require('node:assert/strict');
const profile=require('../static/company-profile.js');
const NOW=Date.parse('2026-09-24T06:00:00Z'),KEY='7203.T',PREFIX='kn_company_profile_v1:';
const IDENTITY={market:'プライム（内国株式）',industry:'輸送用機器',source_url:'https://www.jpx.co.jp/markets/statistics-equities/misc/01.html',date:'2026-09-23',source_title:'日本取引所グループ（JPX）'};
function fixture(changes={}){
  return {symbol:KEY,name:'トヨタ自動車',status:'ready',refreshing:false,updated_at:NOW/1000,
    data:{currency:'JPY',price:3210,price_updated_at:(NOW-60000)/1000,market_cap:42000000000000,annual_dividend:95,annual_dividend_basis:'trailing_12m',dividend_fetched_at:(NOW-3600000)/1000,forward_annual_dividend_per_share:100,forward_dividend_basis:'annualized',analyst_target:{mean:3600,low:2900,high:4100,analyst_count:12,currency:'JPY',as_of:null},ex_dividend_date:'2026-09-29',dividend_payment_date:'2026-11-26'},
    source:{name:'Yahoo Finance',url:'https://finance.yahoo.com/quote/7203.T/',fields:Object.fromEntries(['price','market_cap','forward_annual_dividend_per_share','analyst_target','ex_dividend_date','dividend_payment_date'].map((name,i)=>[name,{fetched_at:(NOW-i*3600000)/1000,as_of:null}]))},
    editorial:{business:'車を作り、世界中で販売する会社です。',life:'通勤や買い物で使う車を支えています。',watch:'車の売れ行きや材料の値段に注目です。',reviewed_on:'2026-09-24',sources:[{title:'会社の公式サイト',url:'https://global.toyota/jp/'}]},
    sources:[{title:'Yahoo Finance',url:'https://finance.yahoo.com/quote/7203.T/',fetched_at:NOW/1000}],...changes};
}
function storage(initial={}){const map=new Map(Object.entries(initial));return {map,getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)};}
async function flush(){for(let n=0;n<30;n++)await Promise.resolve();}
function clock(){let now=NOW,next=0;const timers=new Map();return {now:()=>now,timers,setTimeout(fn,ms){timers.set(++next,{at:now+ms,fn});return next;},clearTimeout(id){timers.delete(id);},async advance(ms){const end=now+ms;for(;;){const found=[...timers.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!found)break;now=found[1].at;timers.delete(found[0]);found[1].fn();await flush();}now=end;await flush();}};}
function loaderHarness(saved=storage()){
  const time=clock(),requests=[],states=[];
  const env={...time,AbortController,storage:saved,fetch(url,options){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});requests.push({url,options,resolve,reject});return promise;}};
  const loader=profile.createLoader(env,state=>states.push(state));
  return {time,requests,states,loader,storage:saved,async reply(index,payload,status=200){requests[index].resolve({ok:status===200,status,json:async()=>payload});await flush();},async load(key=KEY){loader.load(key);await flush();}};
}
test('Japanese company codes normalize; malformed symbols and mismatched company responses are rejected',()=>{
  assert.equal(profile.symbol('７２０３'),'7203.T');assert.equal(profile.symbol('285a.t'),'285A.T');
  for(const value of ['AAPL','7203.T/other','<script>','１２３',null])assert.equal(profile.symbol(value),'');
  assert.equal(profile.normalize(fixture({symbol:'9432.T'}),KEY,NOW),null);
  assert.equal(profile.normalize(fixture({status:'made-up'}),KEY,NOW),null);
});
test('unknowns remain unknown, actual zero dividends survive, and forecast basis/currency are explicit',()=>{
  const raw=fixture();Object.assign(raw.data,{price:'3210',market_cap:true,annual_dividend:0,forward_dividend_basis:'company_forecast'});raw.data.analyst_target.currency='USD';
  const clean=profile.normalize(raw,KEY,NOW);
  assert.equal(clean.data.price,null);assert.equal(clean.data.market_cap,null);assert.equal(clean.data.annual_dividend,0);assert.equal(clean.data.forward_annual_dividend_per_share,null);assert.equal(clean.data.analyst_target,null);
  assert.equal(profile.money(0),'0円');assert.equal(profile.money(null),null);assert.equal(profile.money(-5),null);assert.equal(profile.money(42000000000000,'JPY',true),'42兆円');
  raw.data.annual_dividend_basis='unknown';assert.equal(profile.normalize(raw,KEY,NOW).data.annual_dividend,null);
  raw.data.analyst_target={mean:4000,low:2000,high:3000,currency:'JPY'};assert.equal(profile.normalize(raw,KEY,NOW).data.analyst_target,null);
});
test('unsafe URLs and invalid dates never become navigable sources; field dates are independent',()=>{
  const raw=fixture();raw.sources.push(...['javascript:alert(1)','data:text/html,x','https://user:pass@example.com/','https://example.com/\n'].map(url=>({title:'bad',url})));
  raw.editorial.business='<img src=x onerror=alert(1)>';raw.data.ex_dividend_date='2026-02-30';raw.data.price_updated_at=(NOW+61000)/1000;
  const clean=profile.normalize(raw,KEY,NOW);assert.equal(clean.sources.length,1);assert.equal(clean.data.ex_dividend_date,null);assert.equal(clean.data.price_updated_at,null);
  assert.equal(clean.editorial.business,'<img src=x onerror=alert(1)>');assert.equal(clean.source.fields.analyst_target.fetched_at,NOW-3*3600000);assert.equal(clean.updated_at,NOW);
  assert.equal(profile.day('2024-02-29'),'2024-02-29');assert.equal(profile.day('2026-02-29'),null);assert.equal(profile.timestamp('2026-09-24T14:00:00',NOW),null);assert.equal(profile.timestamp((NOW+30000)/1000,NOW),NOW+30000);
});
test('opening emits immediately, deduplicates requests, and polls multiple times without overlapping',async()=>{
  const h=loaderHarness();h.loader.load(KEY);assert.equal(h.states[0].status,'loading');h.loader.load(KEY);await flush();assert.equal(h.requests.length,1);
  const partial=fixture({status:'pending',refreshing:true,updated_at:null});partial.data.market_cap=null;
  await h.reply(0,partial);assert.equal(h.states.at(-1).data.data.price,3210);assert.equal(h.states.at(-1).data.updated_at,null);
  await h.time.advance(2999);assert.equal(h.requests.length,1);await h.time.advance(1);assert.equal(h.requests.length,2);
  await h.reply(1,partial);await h.time.advance(3000);assert.equal(h.requests.length,3);
  await h.reply(2,fixture());assert.equal(h.states.at(-1).status,'ready');await h.time.advance(60000);assert.equal(h.requests.length,3);assert.equal(h.time.timers.size,0);
});
test('pending polling stops at 90 seconds and never relabels old observations as fresh',async()=>{
  const h=loaderHarness();await h.load();const pending=fixture({status:'pending',refreshing:true});
  for(let i=0;i<30;i++){assert.equal(h.requests.length,i+1);await h.reply(i,pending);await h.time.advance(3000);}
  assert.equal(h.requests.length,30);assert.equal(h.states.at(-1).reason,'pending_timeout');assert.equal(h.states.at(-1).data.data.price_updated_at,NOW-60000);assert.equal(h.time.timers.size,0);
});
test('stalled requests abort within 12 seconds, retry twice, and then allow explicit retry',async()=>{
  const h=loaderHarness();await h.load();await h.time.advance(12000);assert.equal(h.requests[0].options.signal.aborted,true);assert.equal(h.states.at(-1).reason,'retrying');
  await h.time.advance(1000);assert.equal(h.requests.length,2);await h.time.advance(12000);await h.time.advance(3000);assert.equal(h.requests.length,3);await h.time.advance(12000);
  assert.equal(h.states.at(-1).reason,'timeout');assert.equal(h.states.at(-1).updating,false);assert.equal(h.time.timers.size,0);
  await h.load();await h.reply(3,fixture());assert.equal(h.states.at(-1).status,'ready');assert.equal(h.requests.length,4);
});
test('transient failures recover automatically, while invalid and unknown companies are not retried',async()=>{
  const h=loaderHarness();await h.load();await h.reply(0,{},503);assert.equal(h.states.at(-1).reason,'retrying');
  await h.time.advance(1000);await h.reply(1,fixture());assert.equal(h.states.at(-1).status,'ready');await h.time.advance(20000);assert.equal(h.requests.length,2);
  for(const [status,body] of [[404,{error:'company_not_found'}],[400,{error:'invalid_symbol'}],[200,fixture({symbol:'9432.T'})]]){
    const bad=loaderHarness();await bad.load();await bad.reply(0,body,status);assert.equal(bad.states.at(-1).updating,false);await bad.time.advance(90000);assert.equal(bad.requests.length,1);
  }
});
test('closing during retry cancels backoff and never starts another request',async()=>{
  const h=loaderHarness();await h.load();await h.reply(0,{},429);h.loader.cancel();const count=h.states.length;await h.time.advance(90000);assert.equal(h.requests.length,1);assert.equal(h.states.length,count);assert.equal(h.time.timers.size,0);
});
test('closing and switching companies ignore late replies and cancel pending timers',async()=>{
  const h=loaderHarness();await h.load();await h.load('9432.T');assert.equal(h.requests[0].options.signal.aborted,true);
  await h.reply(1,fixture({symbol:'9432.T',name:'NTT'}));const count=h.states.length;await h.reply(0,fixture());assert.equal(h.states.length,count);assert.equal(h.states.at(-1).symbol,'9432.T');
  await h.load();h.loader.cancel();const afterCancel=h.states.length;await h.reply(2,fixture({status:'pending',refreshing:true}));assert.equal(h.states.length,afterCancel);assert.equal(h.time.timers.size,0);
});
test('persisted last-good data survives failure and incomplete pending responses',async()=>{
  const saved=storage(),first=loaderHarness(saved);await first.load();await first.reply(0,fixture());
  const h=loaderHarness(saved);await h.load();assert.equal(h.states[0].fromCache,true);assert.equal(h.states[0].data.data.price,3210);
  const partial=fixture({updated_at:null,status:'pending',refreshing:true,data:{currency:'JPY'},editorial:{...fixture().editorial,business:'新しい説明です。'}});
  await h.reply(0,partial);assert.equal(h.states.at(-1).data.data.price,3210);assert.equal(h.states.at(-1).data.editorial.business,'新しい説明です。');assert.equal(h.states.at(-1).fromCache,true);
  await h.time.advance(3000);h.requests[1].reject(new Error('offline'));await flush();assert.equal(h.states.at(-1).reason,'retrying');assert.equal(h.states.at(-1).data.data.price,3210);
  await h.time.advance(1000);h.requests[2].reject(new Error('offline'));await flush();await h.time.advance(3000);h.requests[3].reject(new Error('offline'));await flush();assert.equal(h.states.at(-1).status,'stale');assert.equal(h.states.at(-1).data.updated_at,NOW);
});
test('an older server seed cannot roll back saved profile fields or their dates',async()=>{
  const h=loaderHarness();await h.load();await h.reply(0,fixture());await h.load();
  const older=fixture({updated_at:(NOW-86400000)/1000});older.data.market_cap=1;older.data.price=1200;older.data.price_updated_at=(NOW-86400000)/1000;older.data.annual_dividend=1;older.data.dividend_fetched_at=(NOW-86400000)/1000;
  for(const field of Object.values(older.source.fields))field.fetched_at=(NOW-86400000)/1000;
  await h.reply(1,older);const kept=h.states.at(-1);assert.equal(kept.fromCache,true);assert.equal(kept.data.data.market_cap,42000000000000);assert.equal(kept.data.data.price,3210);assert.equal(kept.data.source.fields.market_cap.fetched_at,NOW-3600000);assert.equal(kept.data.updated_at,NOW);
  await h.load();older.data.price=3300;older.data.price_updated_at=NOW/1000;older.source.fields.price.fetched_at=NOW/1000;older.data.annual_dividend=96;older.data.dividend_fetched_at=NOW/1000;
  await h.reply(2,older);assert.equal(h.states.at(-1).data.data.price,3300);assert.equal(h.states.at(-1).data.data.annual_dividend,96);assert.equal(h.states.at(-1).data.data.market_cap,42000000000000);
  const restored=loaderHarness(h.storage);await restored.load();assert.equal(restored.states[0].data.data.price,3300);
});
test('expired cache, inaccessible storage, and not-found responses are handled safely',async()=>{
  const old=fixture({updated_at:(NOW-8*86400000)/1000});old.data.price_updated_at=old.updated_at;old.data.dividend_fetched_at=old.updated_at;
  for(const field of Object.values(old.source.fields))field.fetched_at=old.updated_at;
  const h=loaderHarness(storage({[PREFIX+KEY]:JSON.stringify(old)}));await h.load();assert.equal(h.states[0].data,null);await h.reply(0,{error:'unknown'},404);assert.equal(h.states.at(-1).reason,'not_found');
  const failing=loaderHarness({getItem(){throw new Error('storage disabled');},setItem(){throw new Error('quota');}});await failing.load();await failing.reply(0,fixture());assert.equal(failing.states.at(-1).status,'ready');assert.equal(failing.loader.peek(KEY).data.price,3210);
});
test('dated end-of-day prices cache without an invented market timestamp and cannot roll back',async()=>{
  const h=loaderHarness(),close=fixture({updated_at:null});close.data.price_updated_at=null;close.data.price_trade_date='2026-09-23';close.data.annual_dividend=null;close.data.dividend_fetched_at=null;
  await h.load();await h.reply(0,close);assert.equal(h.loader.peek(KEY).data.price_updated_at,null);assert.equal(h.loader.peek(KEY).data.price_trade_date,'2026-09-23');
  await h.load();const older=structuredClone(close);older.data.price=1;older.data.price_trade_date='2026-09-22';older.source.fields.price.fetched_at=NOW/1000;await h.reply(1,older);assert.equal(h.states.at(-1).data.data.price,3210);assert.equal(h.states.at(-1).data.data.price_trade_date,'2026-09-23');
  await h.load();const newer=structuredClone(close);newer.data.price=3300;newer.data.price_trade_date='2026-09-24';await h.reply(2,newer);assert.equal(h.states.at(-1).data.data.price,3300);assert.equal(h.states.at(-1).data.data.price_updated_at,null);
  const reloaded=loaderHarness(h.storage);await reloaded.load();assert.equal(reloaded.states[0].data.data.price,3300);
});
test('official identity is accepted only with a safe source and an actual nonfuture catalogue date',()=>{
  const clean=profile.normalize(fixture({identity:IDENTITY}),KEY,NOW);assert.equal(clean.identity.industry,'輸送用機器');assert.equal(clean.identity.date,'2026-09-23');
  for(const identity of [{...IDENTITY,source_url:'javascript:alert(1)'},{...IDENTITY,date:'2026-02-30'},{...IDENTITY,date:'2026-09-25'},{market:'プライム',industry:'輸送用機器'}])assert.equal(profile.normalize(fixture({identity}),KEY,NOW).identity,null);
});
test('field statuses accept only known reasons and rejected values never masquerade as available numbers',()=>{
  const clean=profile.normalize(fixture({data:{currency:'JPY',price:'3210'},field_status:{price:'available',market_cap:'source_missing',annual_dividend:'unpublished',made_up:'loading'}}),KEY,NOW);
  assert.deepEqual(clean.field_status,{price:'invalid',market_cap:'source_missing'});
  assert.equal(profile.fieldReason({data:clean},'price'),'内容を確認中');assert.equal(profile.fieldReason({data:clean},'market_cap'),'提供元に情報なし');assert.equal(profile.fieldReason({data:clean},'annual_dividend'),'未確認');
});
test('a valid target range without a mean is unconfirmed rather than malformed',()=>{
  const raw=fixture({field_status:{analyst_target:'available'}});raw.data.analyst_target={mean:null,low:2900,high:4100,analyst_count:12,currency:'JPY'};
  const clean=profile.normalize(raw,KEY,NOW);assert.equal(clean.field_status.analyst_target,'available');assert.equal(profile.fieldReason({data:clean},'analyst_target'),'未確認');assert.equal(clean.data.analyst_target.low,2900);
  raw.data.analyst_target={mean:3600,low:4100,high:2900,currency:'JPY'};const bad=profile.normalize(raw,KEY,NOW);assert.equal(bad.field_status.analyst_target,'invalid');assert.equal(profile.fieldReason({data:bad},'analyst_target'),'内容を確認中');
});
test('each empty field explains its own state and unrelated annual loading does not override a completed source',()=>{
  const field_status={price:'loading',market_cap:'source_missing',annual_dividend:'loading',forward_annual_dividend_per_share:'fetch_error',ex_dividend_date:'invalid',dividend_payment_date:'unconfirmed',analyst_target:'source_missing'};
  const record=profile.normalize(fixture({data:{currency:'JPY'},field_status,status:'pending',refreshing:true}),KEY,NOW),pending={data:record,status:'pending',updating:true};
  assert.equal(profile.fieldReason(pending,'price'),'取得中');assert.equal(profile.fieldReason(pending,'annual_dividend'),'取得中');assert.equal(profile.fieldReason(pending,'market_cap'),'提供元に情報なし');assert.equal(profile.fieldReason(pending,'forward_annual_dividend_per_share'),'通信エラー');assert.equal(profile.fieldReason(pending,'ex_dividend_date'),'内容を確認中');assert.equal(profile.fieldReason(pending,'dividend_payment_date'),'未確認');assert.equal(profile.fieldReason(pending,'analyst_target'),'提供元に情報なし');
  assert.equal(profile.fieldReason({status:'loading',updating:true,data:null},'price'),'取得中');assert.equal(profile.fieldReason({...pending,reason:'retrying'},'market_cap'),'提供元に情報なし');assert.equal(profile.fieldReason({...pending,reason:'fetch_error',updating:false},'ex_dividend_date'),'内容を確認中');
  assert.equal(profile.fieldReason({...pending,reason:'pending_timeout',updating:false},'annual_dividend'),'未確認');
});
test('browser failures are distinct from unknown companies and malformed responses',async()=>{
  const h=loaderHarness();await h.load();await h.reply(0,{},503);assert.equal(profile.fieldReason(h.states.at(-1),'market_cap'),'通信エラー');
  const unknown=loaderHarness();await unknown.load();await unknown.reply(0,{},404);assert.equal(unknown.states.at(-1).reason,'not_found');assert.equal(profile.fieldReason(unknown.states.at(-1),'price'),'未確認');
  const malformed=loaderHarness();await malformed.load();await malformed.reply(0,fixture({symbol:'9432.T'}));assert.equal(malformed.states.at(-1).reason,'invalid');assert.equal(profile.fieldReason(malformed.states.at(-1),'price'),'内容を確認中');
  const invalid=loaderHarness();await invalid.load();await invalid.reply(0,{},400);assert.equal(profile.fieldReason(invalid.states.at(-1),'price'),'未確認');
});
test('current response field reasons replace cached failures even when older numeric records are retained',async()=>{
  const saved=fixture({field_status:{market_cap:'fetch_error',annual_dividend:'loading'}});saved.data.market_cap=null;saved.data.annual_dividend=null;
  const h=loaderHarness();await h.load();await h.reply(0,saved);
  const later=fixture({updated_at:null,data:{currency:'JPY'},field_status:{market_cap:'source_missing',annual_dividend:'loading'},status:'pending',refreshing:true});await h.load();await h.reply(1,later);
  assert.equal(h.states.at(-1).fromCache,true);assert.equal(h.states.at(-1).data.data.price,3210);assert.equal(profile.fieldReason(h.states.at(-1),'market_cap'),'提供元に情報なし');assert.equal(profile.fieldReason(h.states.at(-1),'annual_dividend'),'取得中');
  h.loader.cancel();const reloaded=loaderHarness(h.storage);await reloaded.load();assert.equal(reloaded.states[0].data.field_status.annual_dividend,'unconfirmed');assert.equal(profile.fieldReason({...reloaded.states[0],updating:false},'annual_dividend'),'未確認');assert.equal(profile.fieldReason(reloaded.states[0],'annual_dividend'),'取得中');assert.equal(profile.fieldReason(reloaded.states[0],'market_cap'),'提供元に情報なし');
});
test('valid saved values, zero dividends, and month-precise schedules do not become missing on later failure',()=>{
  const raw=fixture({field_status:Object.fromEntries(['price','market_cap','annual_dividend','forward_annual_dividend_per_share','ex_dividend_date','dividend_payment_date','analyst_target'].map(key=>[key,'fetch_error']))});raw.data.annual_dividend=0;raw.data.dividend_payment_date=null;raw.data.dividend_payment_period='2026-11';
  const state={data:profile.normalize(raw,KEY,NOW),status:'stale',updating:false,reason:'fetch_error'};
  for(const key of Object.keys(raw.field_status))assert.equal(profile.fieldReason(state,key),'',key);
});

class Element {
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.doc=doc;this.children=[];this.dataset={};this.attributes={};this.listeners={};this.hidden=false;this.disabled=false;this.inert=false;this.open=false;this.scrollTop=0;this.scrollLeft=0;this.className='';this.style={overflow:'',position:'',top:'',left:'',right:'',width:'',paddingRight:'',setProperty(k,v){this[k]=v;}};this._text='';}
  get parentElement(){return this.parentNode||null;}
  get isConnected(){return this===this.doc.body||!!this.parentNode&&this.parentNode.isConnected;}
  get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}set textContent(value){this._text=String(value);this.children.forEach(n=>n.parentNode=null);this.children=[];}
  set innerHTML(value){throw new Error('HTML interpolation must not be used');}
  appendChild(node){if(node.parentNode)node.parentNode.children=node.parentNode.children.filter(n=>n!==node);node.parentNode=this;this.children.push(node);return node;}
  replaceChildren(...nodes){this.children.forEach(n=>n.parentNode=null);this.children=[];nodes.forEach(n=>this.appendChild(n));}
  setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}removeAttribute(key){delete this.attributes[key];}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}dispatch(type,event={}){for(const fn of this.listeners[type]||[])fn({target:this,...event});}
  focus(){this.doc.activeElement=this;}
  matches(selector){if(selector==='[hidden]')return this.hidden;if(selector==='[inert]')return this.inert;if(selector==='[data-company-profile]')return !!this.dataset.companyProfile;if(selector==='[tabindex="0"]')return this.tabIndex===0;if(selector==='a[href]')return this.tagName==='A'&&!!this.href;if(selector.includes(':not([disabled])'))return this.tagName===selector.split(':')[0].toUpperCase()&&!this.disabled;return selector[0]==='.'?this.className.split(' ').includes(selector.slice(1)):this.tagName===selector.toUpperCase();}
  closest(selector){let node=this;while(node){if(node.matches(selector))return node;node=node.parentNode;}return null;}
  contains(node){while(node){if(node===this)return true;node=node.parentNode;}return false;}
  querySelectorAll(selector){const parts=selector.split(',').map(s=>s.trim()),results=[];function walk(node){for(const child of node.children){if(parts.some(s=>child.matches(s)))results.push(child);walk(child);}}walk(this);return results;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  getClientRects(){let node=this,child=null;while(node){if(node.hidden||node.inert)return [];if(node.tagName==='DETAILS'&&!node.open&&child&&child.tagName!=='SUMMARY')return [];child=node;node=node.parentNode;}return this.isConnected?[{}]:[];}
}
function dialogHarness({reduced=true}={}){
  const time=clock(),events={};const doc={activeElement:null,documentElement:{clientWidth:400},createElement(tag){return new Element(tag,this);},addEventListener(type,fn){(events[type]??=[]).push(fn);},getElementById(id){function find(node){return node.id===id?node:node.children.map(find).find(Boolean);}return find(this.body)||null;},querySelector(){return this.fallback;}};
  doc.body=doc.createElement('body');const home=doc.createElement('main');home.id='morning-section';home.scrollTop=480;doc.body.appendChild(home);const trigger=doc.createElement('button');home.appendChild(trigger);trigger.focus();const nav=doc.createElement('nav');nav.inert=true;nav.setAttribute('aria-hidden','true');doc.body.appendChild(nav);doc.fallback=doc.createElement('button');home.appendChild(doc.fallback);
  const vv={height:780,offsetTop:0,events:{},addEventListener(type,fn){this.events[type]=fn;}};
  const w={KNDividendDates:require('../static/dividend-dates.js'),...time,document:doc,innerWidth:400,scrollY:95,scrollTo(value){this.restoredScroll=value.top;},visualViewport:vv,matchMedia:()=>({matches:reduced}),getComputedStyle:()=>({paddingRight:'0px'}),AbortController,localStorage:storage()};let retries=0;const view=profile.createDialog(w,()=>retries++);
  return {w,doc,home,nav,trigger,time,events,vv,view,get retries(){return retries;},key(key,shiftKey=false){const event={key,shiftKey,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};for(const fn of events.keydown||[])fn(event);return event;}};
}
function state(raw=fixture(),extra={}){return {symbol:KEY,status:raw.status,data:profile.normalize(raw,KEY,NOW),updating:false,fromCache:false,...extra};}
test('sheet opens immediately and restores body, background accessibility, focus and scroll after close',()=>{
  const h=dialogHarness();h.view.open(KEY,'トヨタ',h.trigger);const refs=h.view.elements;
  assert.equal(refs.overlay.hidden,false);assert.equal(refs.name.textContent,'トヨタ');assert.equal(refs.code.textContent,'7203');assert.equal(h.doc.activeElement,refs.panel);assert.equal(h.home.inert,true);assert.equal(h.home.getAttribute('aria-hidden'),'true');assert.equal(h.doc.body.style.position,'fixed');
  h.home.scrollTop=0;h.view.close();assert.equal(refs.overlay.hidden,true);assert.equal(h.home.inert,false);assert.equal(h.home.getAttribute('aria-hidden'),null);assert.equal(h.nav.inert,true);assert.equal(h.nav.getAttribute('aria-hidden'),'true');assert.equal(h.doc.body.style.position,'');assert.equal(h.home.scrollTop,480);assert.equal(h.w.restoredScroll,95);assert.equal(h.doc.activeElement,h.trigger);
});
test('render preserves an open disclosure, uses each actual field date and inserts untrusted copy as text',()=>{
  const h=dialogHarness(),raw=fixture();raw.editorial.business='<img src=x onerror=alert(1)>';h.view.open(KEY,'トヨタ',h.trigger);h.view.render(state(raw));const refs=h.view.elements;
  assert.equal(refs.name.textContent,'トヨタ自動車');assert.equal(refs.business.body.textContent,raw.editorial.business);assert.equal(refs.business.body.children.length,0);assert.equal(refs.price.value.textContent,'3,210円');assert.match(refs.price.time.textContent,/14:59/);assert.match(refs.cap.time.textContent,/14:00/);assert.match(refs.target.time.textContent,/12:00/);assert.equal(refs.targetDate.textContent,'予想が出された日は提供元に記載がありません。');assert.match(refs.targetRange.textContent,/12人/);
  refs.numbers.open=true;refs.content.scrollTop=510;const firstSource=refs.sources.children[0];h.view.render(state(raw));assert.equal(refs.numbers.open,true);assert.equal(refs.content.scrollTop,510);assert.equal(refs.sources.children[0],firstSource);assert.equal(firstSource.children[0].rel,'noopener noreferrer');
});
test('missing prices, timestamps and editorials are explicit, while zero dividends and separate dates remain meaningful',()=>{
  const h=dialogHarness();h.view.open(KEY,'トヨタ',h.trigger);h.view.render({symbol:KEY,status:'loading',data:null,updating:true});const refs=h.view.elements;assert.equal(refs.business.body.textContent,'会社の説明を確認しています…');
  const raw=fixture({editorial:null});raw.data.price_updated_at=null;raw.data.annual_dividend=0;raw.data.ex_dividend_date='2020-09-29';raw.data.dividend_payment_date='2099-11-26';h.view.render(state(raw));
  assert.equal(refs.business.body.textContent,'この会社の説明はまだ掲載されていません');assert.equal(refs.life.section.hidden,true);assert.match(refs.price.time.textContent,/株価の時点：未確認/);assert.equal(refs.annual.value.textContent,'0円');assert.equal(refs.annual.unknown.hidden,true);assert.equal(refs.exDate.value.textContent,'次回未確認（過去の記録：2020/09/29）');assert.equal(refs.paymentDate.value.textContent,'2099/11/26（予定）');
  raw.data.price=null;h.view.render(state(raw));assert.equal(refs.price.value.textContent,'—');assert.equal(refs.price.unknown.hidden,false);assert.equal(refs.price.time.hidden,true);
});
test('company basics remain usable when financial data or editorial is missing, with the source date intact',()=>{
  const h=dialogHarness();h.view.open(KEY,'トヨタ自動車',h.trigger);
  const raw=fixture({name:KEY,identity:IDENTITY,status:'pending',refreshing:true,data:{currency:'JPY'},editorial:null,updated_at:null,sources:[]});h.view.render(state(raw,{updating:true}));const refs=h.view.elements;
  assert.equal(refs.name.textContent,'トヨタ自動車');assert.equal(refs.basic.hidden,false);assert.equal(refs.market.value.textContent,'プライム（内国株式）');assert.equal(refs.industry.value.textContent,'輸送用機器');assert.equal(refs.business.section.hidden,true);assert.equal(refs.price.value.textContent,'—');assert.equal(refs.price.unknown.hidden,false);assert.equal(refs.identityDate.textContent,'会社一覧の基準日 2026/09/23');assert.equal(refs.sources.children[0].children[0].href,IDENTITY.source_url);
  h.view.render(state(raw,{status:'error',updating:false}));assert.match(refs.status.textContent,/会社の基本情報を表示/);assert.equal(refs.retry.hidden,false);assert.equal(refs.basic.hidden,false);
  h.view.render({symbol:KEY,status:'error',data:null,updating:false});assert.equal(refs.name.textContent,'トヨタ自動車');assert.equal(refs.basic.hidden,true);assert.match(refs.business.body.textContent,/今は確認できません/);
});
test('scanner closing-price dates are explicit; precise quote times take precedence when present',()=>{
  const h=dialogHarness();h.view.open(KEY,'トヨタ',h.trigger);const raw=fixture();raw.data.price_updated_at=null;raw.data.price_trade_date='2026-09-23';h.view.render(state(raw));const refs=h.view.elements;
  assert.match(refs.price.time.textContent,/株価 2026\/09\/23 の終値/);assert.doesNotMatch(refs.price.time.textContent,/株価の時点：未確認/);
  raw.data.price_updated_at=(NOW-60000)/1000;h.view.render(state(raw));assert.match(refs.price.time.textContent,/株価の時点.*14:59/);assert.doesNotMatch(refs.price.time.textContent,/終値/);
});
test('empty metric labels change individually and explain source omissions without claiming nonpublication',()=>{
  const h=dialogHarness();h.view.open(KEY,'トヨタ',h.trigger);const refs=h.view.elements;
  const raw=fixture({data:{currency:'JPY'},field_status:{price:'loading',market_cap:'source_missing',annual_dividend:'fetch_error',forward_annual_dividend_per_share:'invalid',ex_dividend_date:'unconfirmed',dividend_payment_date:'source_missing',analyst_target:'unconfirmed'},status:'pending',refreshing:true});
  h.view.render(state(raw,{updating:true}));assert.equal(refs.price.unknown.textContent,'取得中');assert.equal(refs.cap.unknown.textContent,'提供元に情報なし');assert.equal(refs.annual.unknown.textContent,'通信エラー');assert.equal(refs.forward.unknown.textContent,'内容を確認中');assert.equal(refs.exDate.unknown.textContent,'未確認');assert.equal(refs.paymentDate.unknown.textContent,'提供元に情報なし');assert.equal(refs.target.unknown.textContent,'未確認');
  assert.equal(refs.reasonHelp.hidden,false);assert.equal(refs.reasonHelp.open,false);assert.match(refs.reasonHelp.textContent,/会社が未公表とは限りません/);assert.equal(refs.reasonHelp.querySelector('summary').textContent,'表示の意味');
  refs.numbers.open=true;refs.reasonHelp.open=true;refs.content.scrollTop=230;h.view.render(state(fixture()));assert.equal(refs.reasonHelp.hidden,true);assert.equal(refs.numbers.open,true);assert.equal(refs.content.scrollTop,230);assert.equal(refs.price.unknown.hidden,true);
});
test('missing dividend dates show their actual reason instead of a generic date-helper placeholder',()=>{
  const h=dialogHarness();h.view.open(KEY,'トヨタ',h.trigger);const calls=[];h.w.KNDividendDates={describe(value){calls.push(value);return '次回未確認';}};
  const raw=fixture({data:{currency:'JPY'},field_status:{ex_dividend_date:'source_missing',dividend_payment_date:'fetch_error'}});h.view.render(state(raw));const refs=h.view.elements;
  assert.deepEqual(calls,[]);assert.equal(refs.exDate.value.textContent,'—');assert.equal(refs.exDate.unknown.hidden,false);assert.equal(refs.exDate.unknown.textContent,'提供元に情報なし');assert.equal(refs.paymentDate.value.textContent,'—');assert.equal(refs.paymentDate.unknown.hidden,false);assert.equal(refs.paymentDate.unknown.textContent,'通信エラー');
});
test('an average target can be unconfirmed while a valid low-to-high forecast remains visible',()=>{
  const h=dialogHarness();h.view.open(KEY,'トヨタ',h.trigger);const raw=fixture({field_status:{analyst_target:'available'}});raw.data.analyst_target={mean:null,low:2900,high:4100,analyst_count:12,currency:'JPY'};h.view.render(state(raw));const refs=h.view.elements;
  assert.equal(refs.target.value.textContent,'—');assert.equal(refs.target.unknown.hidden,false);assert.equal(refs.target.unknown.textContent,'未確認');assert.equal(refs.targetRange.hidden,false);assert.match(refs.targetRange.textContent,/2,900円〜4,100円/);
});
test('a payment month stays month-precise and never invents a payment day',()=>{
  const h=dialogHarness();h.view.open(KEY,'トヨタ',h.trigger);const raw=fixture();raw.data.dividend_payment_date=null;raw.data.dividend_payment_period='2099-11';raw.source.fields.dividend_payment_period={fetched_at:(NOW-2*3600000)/1000};h.view.render(state(raw));
  const refs=h.view.elements;assert.equal(refs.paymentDate.value.textContent,'2099/11（予定）');assert.match(refs.paymentDate.time.textContent,/日付は未確認/);assert.match(refs.paymentDate.time.textContent,/13:00/);assert.equal(refs.paymentDate.unknown.hidden,true);
  raw.data.dividend_payment_period='2026-13';h.view.render(state(raw));assert.equal(refs.paymentDate.value.textContent,'—');assert.equal(refs.paymentDate.unknown.hidden,false);
  raw.data.dividend_payment_period='2099-11';raw.data.dividend_payment_date='2099-11-26';h.view.render(state(raw));assert.equal(refs.paymentDate.value.textContent,'2099/11/26（予定）');
});
test('focus cycles only visible controls, keyboard viewport changes are respected and Escape closes',()=>{
  const h=dialogHarness();h.view.open(KEY,'トヨタ',h.trigger);h.view.render(state());const refs=h.view.elements;
  const links=refs.panel.querySelectorAll('a[href]'),last=links.at(-1);refs.closeButton.focus();assert.equal(h.key('Tab',true).prevented,true);assert.equal(h.doc.activeElement,last);assert.equal(h.key('Tab').prevented,true);assert.equal(h.doc.activeElement,refs.closeButton);
  h.doc.activeElement=h.trigger;for(const fn of h.events.focusin)fn({target:h.trigger});assert.equal(h.doc.activeElement,refs.closeButton);
  h.vv.height=390;h.vv.offsetTop=35;h.vv.events.resize();assert.equal(refs.overlay.style['--cp-viewport-height'],'390px');assert.equal(refs.overlay.style['--cp-viewport-top'],'35px');
  const event=h.key('Escape');assert.equal(event.prevented,true);assert.equal(event.stopped,true);assert.equal(refs.overlay.hidden,true);
});
test('backdrop close, removed opener fallback and reopening mid-animation preserve state',async()=>{
  const h=dialogHarness({reduced:false});h.view.open(KEY,'トヨタ',h.trigger);const refs=h.view.elements;refs.overlay.dispatch('click',{target:refs.backdrop});assert.equal(refs.overlay.dataset.closing,'true');h.view.open(KEY,'トヨタ',h.trigger);assert.equal(refs.overlay.dataset.closing,undefined);await h.time.advance(180);assert.equal(refs.overlay.hidden,false);
  h.home.children=h.home.children.filter(n=>n!==h.trigger);h.trigger.parentNode=null;h.view.close();await h.time.advance(180);assert.equal(refs.overlay.hidden,true);assert.equal(h.home.inert,false);assert.equal(h.doc.activeElement,h.doc.fallback);
});
test('closing after company cards refresh returns focus to the same company in the news frame',()=>{
  const h=dialogHarness(),stories=h.doc.createElement('section');stories.id='knCompanyFocus';h.home.appendChild(stories);stories.appendChild(h.trigger);h.trigger.dataset.companyProfile=KEY;
  h.view.open(KEY,'トヨタ',h.trigger);const replacement=h.doc.createElement('button');replacement.dataset.companyProfile=KEY;stories.replaceChildren(replacement);
  assert.equal(h.trigger.isConnected,false);h.view.close();assert.equal(h.doc.activeElement,replacement);assert.equal(h.home.inert,false);
});
test('removed news openers use the existing fallback when their replacement is absent or unavailable',()=>{
  for(const unavailable of ['different company','hidden','disabled','aria disabled','removed frame']){
    const h=dialogHarness(),stories=h.doc.createElement('section');stories.id='knCompanyFocus';h.home.appendChild(stories);stories.appendChild(h.trigger);h.trigger.dataset.companyProfile=KEY;
    const outside=h.doc.createElement('button');outside.dataset.companyProfile=KEY;h.home.appendChild(outside);
    h.view.open(KEY,'トヨタ',h.trigger);const replacement=h.doc.createElement('button');replacement.dataset.companyProfile=unavailable==='different company'?'9432.T':KEY;stories.replaceChildren(replacement);
    if(unavailable==='hidden')stories.hidden=true;if(unavailable==='disabled')replacement.disabled=true;if(unavailable==='aria disabled')replacement.setAttribute('aria-disabled','true');
    if(unavailable==='removed frame'){h.home.children=h.home.children.filter(node=>node!==stories);stories.parentNode=null;}
    h.view.close();assert.equal(h.doc.activeElement,h.doc.fallback,unavailable+' must not focus a different, hidden or outside company button');
  }
});
test('delegated company button does not toggle its article, closes cancel requests and late data stays hidden',async()=>{
  const h=dialogHarness(),requests=[];h.w.fetch=(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}));const api=profile.start(h.w);h.trigger.dataset.companyProfile=KEY;h.trigger.dataset.companyName='トヨタ';let prevented=false,stopped=false;
  for(const fn of h.events.click)fn({target:h.trigger,preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});await flush();assert.equal(prevented,true);assert.equal(stopped,true);assert.equal(requests.length,1);const overlay=h.doc.body.children.at(-1);assert.equal(overlay.hidden,false);
  api.close();assert.equal(requests[0].options.signal.aborted,true);assert.equal(overlay.hidden,true);requests[0].resolve({ok:true,json:async()=>fixture()});await flush();assert.equal(overlay.hidden,true);assert.equal(h.home.inert,false);
});

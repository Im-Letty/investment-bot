'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {create,formatChange}=require('../static/market-data.js');
const catalogContext={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static/market-catalog.js'),'utf8'),catalogContext);
const catalog=JSON.parse(JSON.stringify(catalogContext.window.KN_MARKET_CATALOG));
async function flush(){for(let i=0;i<15;i++)await Promise.resolve();}
function harness(saved={}){
  const storage=new Map(Object.entries(saved)),requests=[],timers=new Map();let now=1789250000000,timerId=0;
  const model=create({catalog,custom:[{key:'SHOP',label:'Shopify'}],now:()=>now,storage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id),
    fetch(url,options){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});requests.push({url,options,resolve,reject});return promise;}});
  return {model,storage,requests,timers,now:()=>now,advance(ms){now+=ms;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}},reply:async(request,quote={price:100,pct:1,change:'▲1.00%',name:'Example'})=>{
    if(quote&&!Object.hasOwn(quote,'fetched_at'))quote={...quote,fetched_at:now/1000};
    request.resolve({ok:true,json:async()=>quote});await flush();
  }};
}
test('catalog has the approved 239 choices, unique IDs and no saved preview prices',()=>{
  assert.equal(catalog.length,239);assert.equal(new Set(catalog.map(c=>c.id)).size,239);
  assert.equal(catalog.filter(c=>c.category==='jp').length,213);
  assert.equal(catalog.find(c=>c.id==='ナスダック').symbol,'^IXIC');
  assert.ok(catalog.every(c=>!('quote'in c)&&!('price'in c)));
});
test('retains legacy selections and custom names, without fetching the catalog',async()=>{
  const app=harness({morn_sel:JSON.stringify(['日経225','SHOP','^IXIC','ドル円'])});
  assert.deepEqual(app.model.selection(),['日経225','SHOP','ナスダック','ドル円']);
  assert.equal(app.model.find('SHOP').label,'Shopify');assert.equal(app.requests.length,0);
  const refresh=app.model.refresh();await flush();
  assert.equal(app.requests.length,2);assert.ok(app.requests.every(r=>r.url.includes('light=1')));
  for(const request of app.requests)await app.reply(request);await refresh;
});
test('rejects empty and over-limit commits, and accepts four categories',async()=>{
  const app=harness();const before=app.model.selection();
  assert.equal(app.model.commit([]),false);assert.equal(app.model.commit(['日経225','ドル円','S&P500','NYダウ','AAPL']),false);assert.deepEqual(app.model.selection(),before);
  assert.equal(app.model.commit(['EURJPY=X','GC=F','7203.T','BTC-JPY']),true);await flush();assert.equal(app.requests.length,4);
  assert.equal(JSON.parse(app.storage.get('morn_sel')).length,4);
  for(const request of app.requests)await app.reply(request);
});
test('concurrent refreshes share requests, reuse fresh quotes, and refresh after TTL',async()=>{
  const app=harness({morn_sel:'["AAPL","GC=F"]'});
  const a=app.model.refresh(),b=app.model.refresh();await flush();assert.equal(app.requests.length,2);
  for(const request of app.requests)await app.reply(request);await Promise.all([a,b]);
  await app.model.refresh();assert.equal(app.requests.length,2);
  app.advance(61000);const c=app.model.refresh();await flush();assert.equal(app.requests.length,4);
  for(const request of app.requests.slice(2))await app.reply(request);await c;
});
test('a late response from a removed selection cannot replace the current market',async()=>{
  const app=harness({morn_sel:'["AAPL"]'});const first=app.model.refresh();await flush();
  app.model.commit(['GC=F']);await flush();assert.equal(app.requests.length,2);
  await app.reply(app.requests[1],{price:3000,pct:2});await app.reply(app.requests[0],{price:200,pct:1});await first;
  assert.deepEqual(app.model.rows().map(row=>row.item.id),['GC=F']);assert.equal(app.model.rows()[0].quote.price,3000);
});
test('base-market refresh never discards selected non-base prices',async()=>{
  const app=harness({morn_sel:'["日経225","GC=F"]'});const loading=app.model.refresh();await flush();await app.reply(app.requests[0]);await loading;
  app.model.acceptBase({market:{'日経225':{display:'42,000　▲1%'}},fetched_at:1789250000});
  app.model.acceptBase({market:{'日経225':{display:'42,100　▲1.2%'}},fetched_at:1789250060});
  const rows=app.model.rows();assert.equal(rows[0].display,'42,100　▲1.2%');assert.equal(rows[1].quote.price,100);assert.equal(app.requests.length,1);
});
test('a partial base response retains the last price and reports the missing update',()=>{
  const app=harness({morn_sel:'["日経225","ドル円"]'});
  app.model.acceptBase({market:{'日経225':{display:'42,000 ▲1%'}},fetched_at:1789250000});
  let rows=app.model.rows();assert.equal(rows[0].failed,false);assert.equal(rows[1].failed,true);assert.equal(rows[1].pending,false);
  app.model.acceptBase({market:{'ドル円':{display:'150 ▲0.2%'}},fetched_at:1789250060});
  rows=app.model.rows();assert.equal(rows[0].display,'42,000 ▲1%');assert.equal(rows[0].at,1789250000000);assert.equal(rows[0].failed,true);assert.equal(rows[1].failed,false);
});
test('partial failure preserves other quotes, and avoids immediate retry storms',async()=>{
  const app=harness({morn_sel:'["AAPL","GC=F"]'});const loading=app.model.refresh();await flush();
  app.requests[0].reject(new Error('offline'));await app.reply(app.requests[1]);await loading;
  assert.equal(app.model.rows()[0].failed,true);assert.equal(app.model.rows()[1].quote.price,100);
  await app.model.refresh();assert.equal(app.requests.length,2);
  app.advance(31000);const retry=app.model.refresh();await flush();assert.equal(app.requests.length,3);await app.reply(app.requests[2]);await retry;
  assert.equal(app.model.rows()[0].failed,false);
});
test('malformed cached prices are rejected and restored quotes remain separate from base',async()=>{
  const cache={AAPL:{at:1789249990000,quote:{price:123,pct:1}},'GC=F':{at:1789249990000,quote:{price:-1,pct:0}}};
  const app=harness({morn_sel:'["AAPL","GC=F"]',kn_market_quotes_v2:JSON.stringify(cache)});
  assert.equal(app.model.rows()[0].quote.price,123);assert.equal(app.model.rows()[1].quote,undefined);
  const loading=app.model.refresh();await flush();assert.equal(app.requests.length,1);await app.reply(app.requests[0]);await loading;
});
test('rendering and selection reads do not invoke legacy grid/watch fetching',async()=>{
  const app=harness();app.model.rows();app.model.rows();app.model.selection();await app.model.refresh();assert.equal(app.requests.length,0);
});
test('custom lookup validates ticker syntax and does not commit automatically',async()=>{
  const app=harness();await assert.rejects(app.model.lookup('<script>'));assert.equal(app.requests.length,0);
  const before=app.model.selection();const lookup=app.model.lookup('ＣＯＳＴ');await flush();assert.equal(app.requests.length,1);assert.match(app.requests[0].url,/symbol=COST$/);
  await app.reply(app.requests[0],{price:950,pct:1,name:'Costco'});const candidate=await lookup;
  assert.equal(candidate.label,'Costco');assert.deepEqual(app.model.selection(),before);
});
test('B displays the real movement and signed percentage for all four default markets',()=>{
  const examples=[
    ['日経225',420,1.01,'JPY','currency','+420.00円','+1.01%','up'],
    ['ドル円',0.45,0.30,'JPY','currency','+0.45円','+0.30%','up'],
    ['S&P500',-28,-0.50,'USD','points','−28.00ポイント','−0.50%','down'],
    ['NYダウ',100,0.25,'USD','points','+100.00ポイント','+0.25%','up']
  ];
  for(const [id,change_value,pct,currency,change_unit,amount,percent,direction] of examples){
    assert.deepEqual(formatChange({change_value,pct,currency,change_unit},catalog.find(x=>x.id===id),'ja'),{amount,percent,direction});
  }
});
test('rate points, currency pairs, stocks, commodities and crypto retain their own units',()=>{
  const examples=[
    ['米10年金利',0.025,'percentage_points','USD','+0.025ポイント'],
    ['EURUSD=X',-0.0023,'currency','USD','−0.0023米ドル'],
    ['7203.T',35,'currency','JPY','+35.00円'],
    ['AAPL',1.5,'currency','USD','+1.50米ドル'],
    ['GC=F',14.5,'currency','USD','+14.50米ドル'],
    ['BTC-JPY',125000,'currency','JPY','+125,000.00円']
  ];
  for(const [id,change_value,change_unit,currency,expected] of examples){
    assert.equal(formatChange({change_value,change_unit,currency,pct:1},catalog.find(x=>x.id===id),'ja').amount,expected);
  }
  assert.equal(formatChange({change_value:0.25,currency:'GBp',pct:1},{symbol:'TEST.L',category:'custom'},'en').amount,'+0.25 GBp');
  assert.equal(formatChange({change_value:1,pct:1},{symbol:'UNKNOWN',category:'custom'},'ja').amount,'+1.00');
});
test('missing and nonnumeric absolute values never synthesize a change from rounded percentages',()=>{
  const item=catalog.find(x=>x.id==='日経225');
  for(const change_value of [undefined,null,NaN,Infinity,'420',false]){
    assert.deepEqual(formatChange({price:42000,change_value,pct:1.01},item,'ja'),{amount:'',percent:'+1.01%',direction:'up'});
  }
  assert.deepEqual(formatChange({price:42000,change_value:null,pct:null,change:'--'},item,'ja'),{amount:'',percent:'',direction:'flat'});
  assert.deepEqual(formatChange({change_value:0,pct:0},item,'ja'),{amount:'0.00円',percent:'0.00%',direction:'flat'});
});
test('legacy cache percent is retained without fabricating an amount, then enriched on refresh',()=>{
  const app=harness({morn_sel:'["日経225"]'});
  app.model.acceptBase({market:{'日経225':{display:'42,000 ▲1.01%'}},fetched_at:1789250000});
  let row=app.model.rows()[0];assert.equal(row.quote,undefined);
  assert.deepEqual(formatChange(row.quote,row.item,'ja','▲1.01%'),{amount:'',percent:'▲1.01%',direction:'up'});
  const fresh={display:'42,000 ▲1.01%',price:42000,change_value:420,pct:1.01,currency:'JPY',change_unit:'currency'};
  app.model.acceptBase({market:{'日経225':fresh},fetched_at:1789250060});
  row=app.model.rows()[0];assert.equal(row.quote,fresh);assert.equal(row.display,fresh.display);
  assert.equal(formatChange(row.quote,row.item,'ja').amount,'+420.00円');
});
test('partial core updates keep price and absolute movement from the same snapshot',()=>{
  const app=harness({morn_sel:'["日経225","ドル円"]'});
  const initial={display:'42,000 ▲1.01%',price:42000,change_value:420,pct:1.01,currency:'JPY'};
  app.model.acceptBase({market:{'日経225':initial},fetched_at:1789250000});
  app.model.acceptBase({market:{'ドル円':{display:'150.25 ▲0.30%',price:150.25,change_value:0.45,pct:0.30,currency:'JPY'}},fetched_at:1789250060});
  const row=app.model.rows()[0];assert.equal(row.failed,true);assert.equal(row.quote,initial);assert.equal(row.at,1789250000000);
  // A legacy update must not borrow yesterday's absolute movement.
  app.model.acceptBase({market:{'日経225':{display:'41,000 ▼1.00%'}},fetched_at:1789250120});
  assert.equal(app.model.rows()[0].quote,undefined);
});
test('selected extra quotes retain structured movement through the storage cache',async()=>{
  const app=harness({morn_sel:'["AAPL"]'});const request=app.model.refresh();await flush();
  const quote={price:250.5,pct:0.2,change_value:0.5,currency:'USD',change_unit:'currency'};
  await app.reply(app.requests[0],quote);await request;
  const cached=harness(Object.fromEntries(app.storage));
  assert.deepEqual(cached.model.rows()[0].quote,{...quote,fetched_at:app.now()/1000});
  assert.equal(formatChange(cached.model.rows()[0].quote,catalog.find(x=>x.id==='AAPL'),'ja').amount,'+0.50米ドル');
});
test('small FX moves remain visible and localization keeps a numeric sign without negative zero',()=>{
  assert.equal(formatChange({change_value:0.00001,pct:0.0001,currency:'USD'},catalog.find(x=>x.id==='EURUSD=X'),'ja').amount,'+0.00001米ドル');
  assert.equal(formatChange({change_value:-0,pct:-0},catalog.find(x=>x.id==='S&P500'),'en').percent,'0.00%');
  assert.equal(formatChange({change_value:-28,pct:-0.5},catalog.find(x=>x.id==='S&P500'),'en').amount,'−28.00 pt');
  assert.equal(formatChange({change_value:0.025,pct:0.5},catalog.find(x=>x.id==='米10年金利'),'zh').amount,'+0.025个百分点');
});
test('core prices render from persistent storage on a new visit before a network response',()=>{
  const app=harness({morn_sel:'["日経225","ドル円"]'});
  const quote={price:42000,pct:1,change_value:420,currency:'JPY',display:'42,000 ▲1%'};
  app.model.acceptBase({market:{'日経225':quote},fetched_at:1789250000});
  const reopened=harness(Object.fromEntries(app.storage));
  assert.equal(reopened.requests.length,0);
  assert.equal(reopened.model.rows()[0].quote.price,42000);
  assert.equal(reopened.model.rows()[0].quote.change_value,420);
  assert.equal(reopened.model.rows()[0].at,1789250000000);
});
test('saved prices older than a day remain visible with their real timestamp until a week',()=>{
  const saved={AAPL:{at:1789250000000-3*86400000,quote:{price:123,pct:1}}};
  const app=harness({morn_sel:'["AAPL"]',kn_market_quotes_v2:JSON.stringify(saved)});
  assert.equal(app.model.rows()[0].quote.price,123);
  assert.equal(app.model.rows()[0].stale,true);
  saved.AAPL.at=1789250000000-7*86400000;
  const expired=harness({morn_sel:'["AAPL"]',kn_market_quotes_v2:JSON.stringify(saved)});
  assert.equal(expired.model.rows()[0].quote,undefined);
});
test('partial background updates retain separate quote timestamps',()=>{
  const app=harness({morn_sel:'["日経225","ドル円"]'});
  app.model.acceptBase({market:{
    '日経225':{price:42000,pct:1,display:'42,000 ▲1%',fetched_at:1789250000},
    'ドル円':{price:150,pct:0,display:'150',fetched_at:1789249800}
  },fetched_at:1789250000,refreshing:true});
  assert.equal(app.model.rows()[0].at,1789250000000);
  assert.equal(app.model.rows()[0].stale,false);
  assert.equal(app.model.rows()[1].at,1789249800000);
  assert.equal(app.model.rows()[1].stale,true);
  assert.equal(app.model.rows()[1].failed,false);
});
test('an older HTML snapshot cannot replace newer local prices',()=>{
  const cache={'^N225':{at:1789250000000,quote:{price:43000,pct:1,change_value:400}}};
  const app=harness({morn_sel:'["日経225"]',kn_market_quotes_v2:JSON.stringify(cache)});
  app.model.acceptBase({market:{'日経225':{price:42000,pct:1,display:'42,000 ▲1%',change_value:420}},fetched_at:1789249800});
  const row=app.model.rows()[0];
  assert.equal(row.quote.price,43000);
  assert.equal(row.quote.change_value,400);
  assert.equal(row.at,1789250000000);
  assert.equal(JSON.parse(app.storage.get('kn_market_quotes_v2'))['^N225'].at,1789250000000);
});
test('an empty refreshing server response is pending, not a failed update',()=>{
  const app=harness();
  app.model.acceptBase({market:{},fetched_at:null,refreshing:true});
  assert.ok(app.model.rows().every(row=>row.pending&&!row.failed));
  app.model.acceptBase({market:{},fetched_at:null,refreshing:false});
  assert.ok(app.model.rows().every(row=>!row.pending&&row.failed));
});


test('one-minute quote checks use request start even when the response takes several seconds',async()=>{
  const app=harness({morn_sel:'["AAPL"]'});
  const first=app.model.refresh();await flush();app.advance(3500);await app.reply(app.requests[0]);await first;
  app.advance(56500);const second=app.model.refresh();await flush();assert.equal(app.requests.length,2);
  app.advance(2000);await app.reply(app.requests[1]);await second;
  app.advance(58000);const third=app.model.refresh();await flush();assert.equal(app.requests.length,3);
  await app.reply(app.requests[2]);await third;
  assert.ok(app.requests.every(request=>request.options.cache==='no-store'));
});

test('a server-cached quote keeps its acquisition time and failures never freshen saved prices',async()=>{
  const app=harness({morn_sel:'["AAPL"]'}),stamp=app.now()/1000-35;
  const first=app.model.refresh();await flush();await app.reply(app.requests[0],{price:150,pct:1,fetched_at:stamp});await first;
  assert.equal(app.model.rows()[0].at,stamp*1000);
  app.advance(60000);const failed=app.model.refresh();await flush();app.requests[1].reject(new Error('offline'));await failed;
  const old=app.model.rows()[0];assert.equal(old.quote.price,150);assert.equal(old.at,stamp*1000);assert.equal(old.failed,true);
  app.advance(30000);const recovery=app.model.refresh();await flush();await app.reply(app.requests[2],{price:151,pct:2});await recovery;
  assert.equal(app.model.rows()[0].failed,false);assert.equal(app.model.rows()[0].at,app.now());
});

test('missing, future or expired quote timestamps cannot invent a fresh acquisition',async()=>{
  for(const fetched_at of [undefined,null,0,1789250061,1789250000-7*86400]){
    const saved={AAPL:{quote:{price:150,pct:1},at:1789249999000}},app=harness({morn_sel:'["AAPL"]',kn_market_quotes_v2:JSON.stringify(saved)});
    const pending=app.model.refresh(true);await flush();await app.reply(app.requests[0],{price:999,pct:2,fetched_at});await pending;
    assert.equal(app.model.rows()[0].quote.price,150);assert.equal(app.model.rows()[0].at,saved.AAPL.at);assert.equal(app.model.rows()[0].failed,true);
  }
});

test('quote timeout releases the pending request and late results cannot overwrite a newer recovery',async()=>{
  const app=harness({morn_sel:'["AAPL"]'}),first=app.model.refresh();await flush();
  const concurrent=app.model.refresh(true);await flush();assert.equal(app.requests.length,1);
  app.advance(12000);await Promise.all([first,concurrent]);assert.equal(app.requests[0].options.signal.aborted,true);assert.equal(app.model.rows()[0].failed,true);
  const recovery=app.model.refresh(true);await flush();assert.equal(app.requests.length,2);
  await app.reply(app.requests[1],{price:151,pct:1});await recovery;
  await app.reply(app.requests[0],{price:999,pct:1});
  assert.equal(app.model.rows()[0].quote.price,151);assert.equal(app.model.rows()[0].failed,false);assert.equal(app.timers.size,0);
});


test('small server clock skew keeps the true timestamp, including when restored from storage',async()=>{
  const app=harness({morn_sel:'["AAPL"]'}),fetched_at=app.now()/1000+15;
  const first=app.model.refresh();await flush();await app.reply(app.requests[0],{price:150,pct:1,fetched_at});await first;
  assert.equal(app.model.rows()[0].at,fetched_at*1000);assert.equal(app.model.rows()[0].failed,false);
  const restored=harness(Object.fromEntries(app.storage));assert.equal(restored.model.rows()[0].at,fetched_at*1000);
});

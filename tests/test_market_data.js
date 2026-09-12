'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {create}=require('../static/market-data.js');
const catalogContext={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static/market-catalog.js'),'utf8'),catalogContext);
const catalog=JSON.parse(JSON.stringify(catalogContext.window.KN_MARKET_CATALOG));
async function flush(){for(let i=0;i<15;i++)await Promise.resolve();}
function harness(saved={}){
  const storage=new Map(Object.entries(saved)),requests=[];let now=1789250000000;
  const model=create({catalog,custom:[{key:'SHOP',label:'Shopify'}],now:()=>now,storage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},fetch(url){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});requests.push({url,resolve,reject});return promise;}});
  return {model,storage,requests,advance:ms=>now+=ms,reply:async(request,quote={price:100,pct:1,change:'▲1.00%',name:'Example'})=>{request.resolve({ok:true,json:async()=>quote});await flush();}};
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

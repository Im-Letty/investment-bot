'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const market=require('../static/market-data.js');
const source=fs.readFileSync(path.join(__dirname,'../static/home-a.js'),'utf8');
function harness(){
 let clock=Date.parse('2026-09-24T00:00:00Z'),timerId=0;const timers=new Map(),listeners={};
 class FakeDate extends Date {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 function element(grid=false){
  let html='';const node={children:[],writes:0,scrollLeft:0,title:'',className:''};
  Object.defineProperty(node,'innerHTML',{get(){return html;},set(value){html=value;node.writes++;if(grid)node.children=[...value.matchAll(/class="kn-a-quote"/g)].map(()=>({title:'',children:Array.from({length:4},()=>element())}));}});
  return node;
 }
 const nodes={knHomeMarketGrid:element(true),knHomeMarketTimeText:element(),knMarketRetry:{hidden:true}};
 const context={window:{KNMarketData:market,addEventListener:(name,fn)=>(listeners[name]||=[]).push(fn)},Date:FakeDate,Promise,
  document:{hidden:false,documentElement:{lang:'ja'},getElementById:id=>nodes[id]||null,addEventListener:(name,fn)=>(listeners[name]||=[]).push(fn)},
  localStorage:{getItem:()=>null},setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,at:clock+ms});return id;},clearTimeout:id=>timers.delete(id)};
 // Exercise the real renderer and polling controller without browser or picker code.
 vm.runInNewContext(source.slice(0,source.indexOf('  function renderSelected()'))+'window.renderForTest=function(rows){model={rows:function(){return rows;}};renderMarkets();};window.paintForTest=renderMarkets;window.startPollingForTest=function(activeModel){model=activeModel;return startMarketRefresh();};})();',context);
 return {nodes,context,timers,now:()=>clock,render:context.window.renderForTest,paint:context.window.paintForTest,start:context.window.startPollingForTest,
  advance(ms){clock+=ms;for(const [id,timer] of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();}},
  visibility(hidden){context.document.hidden=hidden;(listeners.visibilitychange||[]).forEach(fn=>fn());},online(){(listeners.online||[]).forEach(fn=>fn());}};
}
const at=Date.parse('2026-09-23T16:38:00Z');
const row=(id='日経225',extra={})=>({item:{id,symbol:id==='日経225'?'^N225':'JPY=X',label:id,category:id==='日経225'?'index':'fx',currency:'JPY'},quote:{price:100,change_value:1,pct:1,currency:'JPY'},at,stale:false,failed:false,...extra});
test('retrieval times remain visible across freshness changes without rebuilding quote cards',()=>{
 const h=harness();h.render([row()]);const grid=h.nodes.knHomeMarketGrid,card=grid.children[0],cells=card.children;
 grid.scrollLeft=83;const timestamp=h.nodes.knHomeMarketTimeText.innerHTML,writes=cells.map(c=>c.writes);
 assert.match(timestamp,/取得 9\/24 01:38 JST/);assert.equal(grid.writes,1);
 h.render([row('日経225',{stale:true})]);assert.equal(h.nodes.knHomeMarketTimeText.innerHTML,timestamp);assert.equal(grid.children[0],card);assert.equal(grid.scrollLeft,83);assert.deepEqual(cells.map(c=>c.writes),writes);
 h.render([row('日経225',{at:at+60000})]);assert.match(h.nodes.knHomeMarketTimeText.innerHTML,/01:39 JST/);assert.equal(grid.writes,1);assert.deepEqual(cells.map(c=>c.writes),writes);
 for(const cell of cells)assert.doesNotMatch(cell.innerHTML,/取得|JST/);
});
test('shared timestamps are concise and mixed timestamps stay associated with their markets',()=>{
 const h=harness();h.render([row(),row('ドル円')]);assert.equal((h.nodes.knHomeMarketTimeText.innerHTML.match(/<time /g)||[]).length,1);
 h.render([row(),row('ドル円',{at:at+60000})]);const html=h.nodes.knHomeMarketTimeText.innerHTML;
 assert.match(html,/日経225<\/span><time[^>]*>取得 9\/24 01:38 JST/);assert.match(html,/ドル円<\/span><time[^>]*>取得 9\/24 01:39 JST/);
});
test('background failure preserves the known price and its time; unknown times are never invented',()=>{
 const h=harness();h.render([row()]);const card=h.nodes.knHomeMarketGrid.children[0];
 h.render([row('日経225',{failed:true,stale:true})]);assert.equal(h.nodes.knHomeMarketGrid.children[0],card);assert.match(card.children[1].innerHTML,/100/);assert.equal(h.nodes.knMarketRetry.hidden,false);assert.match(h.nodes.knHomeMarketTimeText.innerHTML,/01:38 JST/);
 h.render([row('日経225',{quote:null,at:undefined,failed:true})]);assert.match(h.nodes.knHomeMarketTimeText.innerHTML,/取得時刻 —/);assert.doesNotMatch(h.nodes.knHomeMarketTimeText.innerHTML,/<time/);
});


async function flush(){for(let i=0;i<40;i++)await Promise.resolve();}
function pollingApp(){
 const app=harness(),requests=[],storage=new Map([['morn_sel','["日経225","AAPL"]']]);let baseCalls=0,baseFails=false;
 const model=market.create({catalog:[{id:'日経225',symbol:'^N225',label:'日経225',category:'index',currency:'JPY',baseKey:'日経225'},{id:'AAPL',symbol:'AAPL',label:'Apple',category:'us',currency:'USD'}],
  storage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},now:app.now,onChange:app.paint,
  setTimeout:app.context.setTimeout,clearTimeout:app.context.clearTimeout,
  fetch(url,options){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});requests.push({url,options,resolve,reject});return promise;}});
 app.context.window.loadMorningData=()=>{baseCalls++;if(baseFails){model.baseFailed();return Promise.resolve();}model.acceptBase({market:{'日経225':{display:String(100+baseCalls),price:100+baseCalls,pct:1,change_value:1,fetched_at:app.now()/1000}},fetched_at:app.now()/1000});return Promise.resolve();};
 return {...app,model,requests,baseCalls:()=>baseCalls,failBase:value=>baseFails=value,
  async reply(request,price){request.resolve({ok:true,json:async()=>({price,pct:1,change_value:1,currency:'USD',fetched_at:app.now()/1000})});await flush();}};
}

test('visible markets check core and selected extra quotes every minute for multiple cycles without replacing cards',async()=>{
 const app=pollingApp();app.start(app.model);await flush();assert.equal(app.requests.length,1);assert.equal(app.baseCalls(),1);
 await app.reply(app.requests[0],200);
 const grid=app.nodes.knHomeMarketGrid,cards=grid.children.slice(),began=app.now();grid.scrollLeft=73;
 for(let cycle=1;cycle<=2;cycle++){
  app.advance(began+cycle*60000-app.now());await flush();assert.equal(app.requests.length,cycle+1);assert.equal(app.baseCalls(),cycle+1);
  app.advance(2000);await app.reply(app.requests[cycle],200+cycle);
  assert.equal(grid.writes,1);assert.equal(grid.children[0],cards[0]);assert.equal(grid.children[1],cards[1]);assert.equal(grid.scrollLeft,73);
  assert.equal(app.model.rows()[0].quote.price,101+cycle);assert.equal(app.model.rows()[1].quote.price,200+cycle);
 }
 assert.ok(app.nodes.knHomeMarketTimeText.innerHTML.includes('09:02 JST'));
});

test('market polling stops in hidden tabs and resumes immediately with no overlapping request',async()=>{
 const app=pollingApp(),refresh=app.start(app.model);await flush();await app.reply(app.requests[0],200);
 app.advance(10000);app.visibility(true);assert.equal(app.timers.size,0);
 app.advance(130000);await flush();assert.equal(app.requests.length,1);assert.equal(app.baseCalls(),1);
 app.visibility(false);app.visibility(false);refresh(true);await flush();
 assert.equal(app.requests.length,2);assert.equal(app.baseCalls(),2);
 app.visibility(true);await app.reply(app.requests[1],201);assert.equal(app.timers.size,0,'Hidden completion does not restart polling');
 app.advance(60000);await flush();assert.equal(app.requests.length,2);
 app.visibility(false);await flush();assert.equal(app.requests.length,3);assert.equal(app.baseCalls(),3);await app.reply(app.requests[2],202);
});

test('background market failures keep displayed values and original times until the next successful minute',async()=>{
 const app=pollingApp();app.start(app.model);await flush();await app.reply(app.requests[0],200);
 const initial=app.model.rows().map(row=>({price:row.quote.price,at:row.at})),grid=app.nodes.knHomeMarketGrid,cards=grid.children.slice();
 app.failBase(true);app.advance(60000);await flush();app.requests[1].reject(new Error('offline'));await flush();
 assert.equal(app.nodes.knMarketRetry.hidden,false);assert.deepEqual(app.model.rows().map(row=>({price:row.quote.price,at:row.at})),initial);
 assert.equal(grid.writes,1);assert.equal(grid.children[0],cards[0]);assert.equal(grid.children[1],cards[1]);
 app.failBase(false);app.advance(60000);await flush();await app.reply(app.requests[2],202);
 assert.equal(app.baseCalls(),3);assert.equal(app.nodes.knMarketRetry.hidden,true);assert.equal(grid.writes,1);
 assert.ok(app.model.rows().every(row=>row.at===app.now()));
});


test('network reconnection checks visible markets immediately without duplicate or hidden requests',async()=>{
 const app=pollingApp();app.start(app.model);await flush();await app.reply(app.requests[0],200);
 app.advance(1000);app.online();app.online();await flush();assert.equal(app.requests.length,2);assert.equal(app.baseCalls(),2);
 await app.reply(app.requests[1],201);
 app.visibility(true);app.online();await flush();assert.equal(app.requests.length,2);assert.equal(app.baseCalls(),2);assert.equal(app.timers.size,0);
});

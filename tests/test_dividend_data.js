const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../static/dividend-data.js');
async function flush(){for(let i=0;i<20;i++)await Promise.resolve();}
function harness(storage=new Map()){
 let now=1790200000000,next=0;const requests=[],timers=new Map();
 const options={now:()=>now,storage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},setTimeout(fn,ms){timers.set(++next,{fn,at:now+ms});return next;},clearTimeout:id=>timers.delete(id),fetch(url,opts){let resolve,reject;const p=new Promise((a,b)=>{resolve=a;reject=b;});requests.push({url,opts,resolve,reject});return p;}};
 return {model:create(options),storage,requests,timers,now:()=>now,async reply(i,data){requests[i].resolve({ok:true,json:async()=>data});await flush();},advance(ms){now+=ms;for(const [id,t]of [...timers])if(t.at<=now){timers.delete(id);t.fn();}}};
}
function snapshot(h,extra={}){return {items:[{code:'7203',name:'トヨタ',price:3000,annual_dividend:90,yield_pct:3}],updated_at:h.now()/1000,status:'ready',refreshing:false,...extra};}
test('simultaneous tab loads share one request, with a bounded fresh cache',async()=>{
 const h=harness(),a=h.model.get('top'),b=h.model.get('top');await flush();assert.equal(h.requests.length,1);
 await h.reply(0,snapshot(h));assert.deepEqual(await a,await b);await h.model.get('top');assert.equal(h.requests.length,1);
 h.advance(300001);const again=h.model.get('top');await flush();assert.equal(h.requests.length,2);await h.reply(1,snapshot(h));await again;
});
test('a revisit displays the saved result synchronously before fetching',async()=>{
 const h=harness(),a=h.model.get('top');await flush();await h.reply(0,snapshot(h));await a;
 const next=harness(h.storage),events=[];next.model.watch('top',(d,saved)=>events.push({d,saved}));
 assert.equal(events.length,1);assert.equal(events[0].saved,true);assert.equal(events[0].d.items[0].yield_pct,3);
 await flush();assert.equal(next.requests.length,1);await next.reply(0,snapshot(next));assert.equal(events.length,2);
});
test('missing and failed updates retain good values and the original timestamp',async()=>{
 const h=harness(),a=h.model.get('top');await flush();const first=snapshot(h);await h.reply(0,first);await a;
 h.advance(500000);const b=h.model.get('top',true);await flush();await h.reply(1,{items:[],updated_at:null,status:'loading',refreshing:true});
 const kept=await b;assert.equal(kept.items[0].yield_pct,3);assert.equal(kept.updated_at,first.updated_at);assert.equal(kept.status,'stale');
 const c=h.model.get('top',true);await flush();h.requests[2].reject(Error('offline'));await assert.rejects(c);assert.equal(h.model.peek('top').updated_at,first.updated_at);
});
test('pending refreshes are polled, but cancel and inactive views suppress late updates',async()=>{
 const h=harness(),events=[];let active=true;const stop=h.model.watch('top',d=>events.push(d),null,()=>active);await flush();
 await h.reply(0,{items:[],updated_at:null,status:'loading',refreshing:true});h.advance(3000);await flush();assert.equal(h.requests.length,2);
 active=false;await h.reply(1,snapshot(h));assert.equal(events.length,1);assert.ok(h.model.peek('top'));
 stop();h.advance(10000);await flush();assert.equal(h.requests.length,2);
});
test('a stalled network request times out, aborts, and can be retried',async()=>{
 const h=harness(),a=h.model.get('top');await flush();const rejection=assert.rejects(a,/Timeout/);h.advance(10000);await rejection;
 assert.equal(h.requests[0].opts.signal.aborted,true);const b=h.model.get('top');await flush();await h.reply(1,snapshot(h));await b;
});
test('calendar months stay independent and an empty known month is a valid snapshot',async()=>{
 const h=harness(),sept=h.model.get('calendar?month=2026-09'),oct=h.model.get('calendar?month=2026-10');await flush();
 await h.reply(1,snapshot(h,{items:undefined,days:[]}));await oct;assert.deepEqual(h.model.peek('calendar?month=2026-10').days,[]);
 await h.reply(0,snapshot(h,{items:undefined,days:[{date:'2026-09-24',items:[]}]}));await sept;
 assert.equal(h.model.peek('calendar?month=2026-09').days.length,1);
});
test('old, unproven, or future snapshots are not relabelled as current',async()=>{
 const h=harness();for(const [key,at]of [['top',null],['yearly',h.now()/1000-8*86400],['calendar?month=2026-09',h.now()/1000+86400]]){
 h.storage.set('kn_dividend_snapshot_v1:'+key,JSON.stringify(snapshot(h,{updated_at:at,days:[]})));assert.equal(h.model.peek(key),null);}
 await assert.rejects(h.model.get('calendar?month=2026-99'));
});
test('an individual search waits for a real row, then keeps zero dividends distinct from unknowns',async()=>{
 const h=harness(),events=[];h.model.watch('search?q=7203',d=>events.push(d));await flush();
 await h.reply(0,{ticker:'7203.T',status:'loading',refreshing:true,updated_at:null});assert.equal(h.model.peek('search?q=7203'),null);
 h.advance(3000);await flush();await h.reply(1,{ticker:'7203.T',status:'ready',refreshing:false,price:3000,annual_dividend:0,yield_pct:0,updated_at:h.now()/1000});
 assert.equal(events.at(-1).annual_dividend,0);assert.equal(h.model.peek('search?q=7203').yield_pct,0);
});
test('an extended cold refresh ends with a retry state instead of polling forever',async()=>{
 const h=harness(),errors=[];h.model.watch('top',()=>{},e=>errors.push(e));await flush();
 h.advance(90001);await flush(); // A network timeout is also a bounded failure.
 assert.equal(errors.length,1);assert.equal(h.timers.size,0);
});

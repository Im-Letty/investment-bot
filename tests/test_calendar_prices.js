const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../static/calendar-prices.js');
const KEY='kn_calendar_prices_v1',DAY=86400000;
async function flush(){for(let i=0;i<15;i++)await Promise.resolve();}
function harness(options={}){
 let time=options.time||1790200000000,seq=0;
 const timers=new Map(),requests=[],updates=[],saved=options.saved||new Map();
 const env={now:()=>time,AbortController,storage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)},
  setTimeout(fn,ms){timers.set(++seq,{fn,at:time+ms});return seq;},clearTimeout:id=>timers.delete(id),
  fetch(url,opts){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});requests.push({url,opts,resolve,reject,at:time});return promise;}};
 const model=create({...env,...options.env},(symbol,state)=>updates.push({symbol,...state}));
 return {model,requests,updates,timers,saved,now:()=>time,
  async advance(ms){const end=time+ms;let count=0;while(true){
   let due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
   if(!due)break;if(++count>2000)throw new Error('Timer loop');
   time=due[1].at;timers.delete(due[0]);due[1].fn();await flush();
  }time=end;await flush();},
  async reply(index,data){requests[index].resolve({ok:true,json:async()=>data});await flush();},
  async reject(index){requests[index].reject(new Error('Offline internal secret'));await flush();}};
}
function quote(h,symbol='7203.T',extra={}){return {symbol,price:3000,currency:'JPY',fetched_at:h.now()/1000,
 price_updated_at:h.now()/1000-1200,source:'Yahoo Finance',delay_minutes:20,...extra};}

test('starts only selected symbols, normalizes safe codes and limits concurrency to three',async()=>{
 const h=harness();h.model.setSymbols(['７２０３','7203.T','285a','9432.T','5803.T','evil/../x','AAPL']);await flush();
 assert.equal(h.requests.length,3);assert.deepEqual(h.requests.map(r=>new URL(r.url,'https://example.test').searchParams.get('symbol')),['7203.T','285A.T','9432.T']);
 assert.equal(h.updates.filter(row=>row.symbol==='5803.T').at(-1).pending,true);
 h.model.refresh(true);await flush();assert.equal(h.requests.length,3);
 await h.reply(0,quote(h));assert.equal(h.requests.length,4);assert.match(h.requests[3].url,/5803.T&light=1$/);
 assert.equal(h.model.peek('7203').quote.price,3000);assert.equal(h.model.peek('5803').pending,true);
 h.model.pause();
});
test('refresh starts one minute after request start, not after its slow completion',async()=>{
 const h=harness();h.model.setSymbols(['7203']);await flush();const start=h.now();
 await h.advance(10000);await h.reply(0,quote(h));await h.advance(49999);assert.equal(h.requests.length,1);
 await h.advance(1);assert.equal(h.requests.length,2);assert.equal(h.requests[1].at-start,60000);
 h.model.pause();
});
test('timeouts abort both stuck fetches and stuck response bodies, free slots and retry later',async()=>{
 const h=harness();h.model.setSymbols(['7203','9432','285A','5803']);await flush();
 h.requests[1].resolve({ok:true,json:()=>new Promise(()=>{})});await flush();
 await h.advance(12000);assert.equal(h.requests.length,4);
 assert.equal(h.requests[0].opts.signal.aborted,true);assert.equal(h.requests[1].opts.signal.aborted,true);
 assert.equal(h.model.peek('7203').error,'timeout');assert.equal(h.model.peek('7203').pending,false);
 await h.advance(48000);assert.ok(h.requests.length>=7);h.model.pause();assert.equal(h.timers.size,0);
});
test('changing symbols cancels removed requests and late replies cannot alter a reselected symbol',async()=>{
 const h=harness();h.model.setSymbols(['7203']);await flush();
 h.model.setSymbols(['9432']);await flush();assert.equal(h.requests[0].opts.signal.aborted,true);
 h.model.setSymbols(['7203']);await flush();assert.equal(h.requests[1].opts.signal.aborted,true);assert.equal(h.requests.length,3);
 await h.reply(2,quote(h,'7203.T',{price:3100}));const count=h.updates.length;
 await h.reply(0,quote(h,'7203.T',{price:2900}));await h.reply(1,quote(h,'9432.T'));
 assert.equal(h.model.peek('7203').quote.price,3100);assert.equal(h.model.peek('9432').quote,null);assert.equal(h.updates.length,count);
 h.model.pause();
});
test('pause stops requests and timers; resume checks freshness immediately without overlapping',async()=>{
 const h=harness();h.model.setSymbols(['7203']);await flush();await h.reply(0,quote(h));h.model.pause();
 assert.equal(h.timers.size,0);await h.advance(10000);h.model.resume();await flush();assert.equal(h.requests.length,1);
 h.model.pause();await h.advance(60000);h.model.resume();await flush();assert.equal(h.requests.length,2);
 h.model.pause();assert.equal(h.requests[1].opts.signal.aborted,true);assert.equal(h.timers.size,0);
 await h.reply(1,quote(h,'7203.T',{price:4000}));assert.equal(h.model.peek('7203').quote.price,3000);
 h.model.resume();await flush();assert.equal(h.requests.length,3);h.model.pause();
});
test('failure retains the last quote and original timestamps, with a stale error state that recovers',async()=>{
 const h=harness();h.model.setSymbols(['7203']);await flush();const original=quote(h);await h.reply(0,original);
 await h.advance(60000);await h.reject(1);
 assert.deepEqual(h.model.peek('7203'),{quote:original,pending:false,error:'unavailable',stale:true});
 assert.ok(!JSON.stringify(h.updates).includes('internal secret'));
 h.model.refresh(true);await flush();const fresh=quote(h,'7203.T',{price:3010});await h.reply(2,fresh);
 assert.deepEqual(h.model.peek('7203'),{quote:fresh,pending:false,error:null,stale:false});h.model.pause();
});
test('missing, invalid, future, expired and mismatched quote fields never become prices',async()=>{
 const h=harness();h.model.setSymbols(['7203']);await flush();
 const invalid=[{price:0},{price:-1},{price:NaN},{price:Infinity},{price:'3000'},{currency:'USD'},{symbol:'9432.T'},
  {price_updated_at:null},{price_updated_at:h.now()/1000+1},{fetched_at:h.now()/1000+1},
  {price_updated_at:(h.now()-7*DAY)/1000},{fetched_at:(h.now()-8*DAY)/1000},{source:'unknown'}];
 for(let i=0;i<invalid.length;i++){
  if(i){h.model.refresh(true);await flush();}
  await h.reply(i,quote(h,'7203.T',invalid[i]));assert.equal(h.model.peek('7203').quote,null);assert.equal(h.model.peek('7203').error,'unavailable');
 }
 h.model.pause();
});
test('older server values and conflicting prices at the same market timestamp cannot roll back a quote',async()=>{
 const h=harness();h.model.setSymbols(['7203']);await flush();const first=quote(h);await h.reply(0,first);await h.advance(1000);
 for(const extra of [{price:2900,price_updated_at:first.price_updated_at-1},
  {price:2900,price_updated_at:first.price_updated_at},
  {price:2900,price_updated_at:first.price_updated_at+1,fetched_at:first.fetched_at-1}]){
  h.model.refresh(true);await flush();await h.reply(h.requests.length-1,quote(h,'7203.T',extra));assert.deepEqual(h.model.peek('7203').quote,first);
 }
 h.model.refresh(true);await flush();const rechecked=quote(h,'7203.T',{price_updated_at:first.price_updated_at});await h.reply(h.requests.length-1,rechecked);
 assert.equal(h.model.peek('7203').quote.fetched_at,rechecked.fetched_at);assert.equal(h.model.peek('7203').error,null);h.model.pause();
});
test('saved prices appear immediately, recent cache waits until due, and unrelated favorites storage is untouched',async()=>{
 const h=harness();h.saved.set('alert_watchlist_v1','["9432.T"]');h.model.setSymbols(['7203']);await flush();const first=quote(h);await h.reply(0,first);h.model.pause();
 const next=harness({saved:h.saved,time:h.now()+30000});next.model.setSymbols(['7203']);
 assert.equal(next.updates[0].quote.price,3000);await flush();assert.equal(next.requests.length,0);
 await next.advance(30000);assert.equal(next.requests.length,1);assert.equal(next.saved.get('alert_watchlist_v1'),'["9432.T"]');next.model.pause();
});
test('cache and selection are bounded to 100, corrupted storage and storage exceptions are harmless',async()=>{
 const saved=new Map([[KEY,'broken']]);const h=harness({saved});assert.equal(h.model.peek('7203').quote,null);
 h.model.setSymbols(Array.from({length:110},(_,i)=>String(1000+i)));await flush();
 for(let index=0;index<100;index++)await h.reply(index,quote(h,(1000+index)+'.T'));
 assert.equal(h.requests.length,100);assert.equal(JSON.parse(saved.get(KEY)).quotes.length,100);h.model.pause();
 const faulty=harness({env:{storage:{getItem(){throw Error();},setItem(){throw Error();}}}});
 faulty.model.setSymbols(['7203']);await flush();await faulty.reply(0,quote(faulty));assert.equal(faulty.model.peek('7203').quote.price,3000);faulty.model.pause();
});
test('expired cache is not displayed and changing callback data cannot mutate the saved quote',async()=>{
 const h=harness();h.saved.set(KEY,JSON.stringify({version:1,quotes:[quote(h,'7203.T',{price_updated_at:(h.now()-7*DAY)/1000})]}));
 const next=harness({saved:h.saved});assert.equal(next.model.peek('7203').quote,null);
 next.model.setSymbols(['7203']);await flush();await next.reply(0,quote(next));next.updates.at(-1).quote.price=1;
 assert.equal(next.model.peek('7203').quote.price,3000);next.model.pause();
});
test('empty selection and paused selections never fetch and keep no polling timer',async()=>{
 const h=harness();h.model.setSymbols(['7203']);h.model.pause();await flush();assert.equal(h.requests.length,0);
 h.model.setSymbols(['9432']);await h.advance(60000);assert.equal(h.requests.length,0);
 h.model.resume();await flush();assert.equal(h.requests.length,1);h.model.setSymbols([]);
 assert.equal(h.requests[0].opts.signal.aborted,true);assert.equal(h.timers.size,0);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const dividends=require('../static/watch-dividends.js'),profile=require('../static/company-profile.js'),stock=require('../static/stock-focus.js');
const now=Date.parse('2026-10-10T16:00:00Z'); // 10/11 in Japan
const state=data=>({symbol:'7203.T',status:'ready',updating:false,data:{data:{currency:'JPY',...data}}});
const raw=(symbol,data={},extra={})=>({symbol,status:'ready',updated_at:now/1000,data:{currency:'JPY',annual_dividend:95,annual_dividend_basis:'trailing_12m',dividend_fetched_at:now/1000,...data},...extra});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
test('annual amounts identify trailing per-share figures, trim zero padding and retain actual fractions',()=>{
 for(const [amount,text]of [[1000,'1,000円'],[116.5,'116.5円'],[0,'0円']])assert.equal(dividends.lines(state({annual_dividend:amount,annual_dividend_basis:'trailing_12m'}),now).annual,'過去1年の配当（1株） '+text);
 for(const amount of [null,undefined,-1,NaN,Infinity,'100'])assert.match(dividends.lines(state({annual_dividend:amount,annual_dividend_basis:'trailing_12m'}),now).annual,/未確認/);
 assert.match(dividends.lines(state({annual_dividend:100,annual_dividend_basis:'annualized',forward_annual_dividend_per_share:100}),now).annual,/未確認/);
});
test('only nonpast valid payment dates are planned; ex-dividend days never substitute for payment',()=>{
 assert.equal(dividends.lines(state({dividend_payment_date:'2026-10-11'}),now).payment,'2026/10/11 支払予定');
 assert.equal(dividends.lines(state({dividend_payment_date:'2026-12-01'}),now).payment,'2026/12/01 支払予定');
 for(const date of ['2026-10-10','2026-02-30','2026-12-01T00:00:00Z',null])assert.equal(dividends.lines(state({dividend_payment_date:date,ex_dividend_date:'2026-12-01'}),now).payment,'支払予定 未確認');
});
test('month-only schedules keep their actual precision and never override a known past day in that month',()=>{
 assert.equal(dividends.lines(state({dividend_payment_period:'2026-11'}),now).payment,'2026/11 支払予定（日付未確認）');
 for(const period of ['2026-09','2026-13','2026-11-01'])assert.equal(dividends.lines(state({dividend_payment_period:period}),now).payment,'支払予定 未確認');
 assert.equal(dividends.lines(state({dividend_payment_date:'2026-10-10',dividend_payment_period:'2026-10'}),now).payment,'支払予定 未確認');
 assert.match(dividends.lines(state({dividend_payment_date:'2026-09-10',dividend_payment_period:'2026-11'}),now).payment,/2026\/11/);
});
test('loading, unavailable and saved facts remain distinct and HTML cannot inject source content',()=>{
 assert.match(dividends.markup({updating:true}),/確認中/);
 assert.match(dividends.markup(null),/未確認/);
 const cached={...state({annual_dividend:95,annual_dividend_basis:'trailing_12m',dividend_payment_date:'<script>'}),status:'stale',updating:true};
 assert.match(dividends.markup(cached,now),/95円/);assert.doesNotMatch(dividends.markup(cached,now),/script|undefined|null/);
});
test('explicit invalidation withholds retained amounts and dates while their contents are reviewed',()=>{
 const kept=state({annual_dividend:95,annual_dividend_basis:'trailing_12m',dividend_payment_date:'2026-11-26'});
 kept.data.field_status={annual_dividend:'invalid',dividend_payment_date:'invalid'};
 assert.equal(dividends.lines(kept,now).annual,'過去1年の配当（1株） 未確認');assert.equal(dividends.lines(kept,now).payment,'支払予定 未確認');
});
test('dividend display survives an unavailable price and retains existing company information links',()=>{
 const html=stock.watchRow({name:'トヨタ'},'7203.T',null,state({annual_dividend:95,annual_dividend_basis:'trailing_12m',dividend_payment_date:'2099-12-01'}));
 assert.match(html,/株価を確認できませんでした/);assert.match(html,/95円/);assert.match(html,/2099\/12\/01 支払予定/);assert.match(html,/data-company-profile="7203.T"/);
 assert.doesNotMatch(stock.watchRow({},'AAPL'),/0円/);
});
function harness(){
 let clock=now;const requests=[],changes=[],timers=new Map();let sequence=0;
 const storage=new Map();
 const env={now:()=>clock,AbortController,storage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},setTimeout(fn,ms){timers.set(++sequence,{fn,at:clock+ms});return sequence;},clearTimeout(id){timers.delete(id);},fetch(url,options){let resolve;const pending=new Promise(r=>resolve=r);requests.push({url,options,resolve});return pending;}};
 const queue=dividends.createQueue(callback=>profile.createLoader(env,callback),(key,result)=>changes.push({key,result}),()=>clock);
 return {queue,requests,changes,storage,async respond(request,body,status=200){request.resolve({ok:status===200,status,json:async()=>body});await flush();},async advance(ms){const end=clock+ms;while(true){const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;clock=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}clock=end;},timers};
}
test('favorites enrichment uses two workers, filters foreign symbols and never fetches while the view is hidden',async()=>{
 const h=harness(),symbols=['7203.T','9432.T','6758.T','AAPL'];
 h.queue.select(symbols,false);await flush();assert.equal(h.requests.length,0);
 h.queue.select(symbols,true);await flush();assert.equal(h.requests.length,2);
 await h.respond(h.requests[0],raw('7203.T'));assert.equal(h.requests.length,3);
 await h.respond(h.requests[1],raw('9432.T'));await h.respond(h.requests[2],raw('6758.T'));
 assert.ok(h.requests.every(r=>!r.url.includes('AAPL')));assert.equal(h.queue.peek('AAPL'),null);
 h.queue.select(symbols,true);await flush();assert.equal(h.requests.length,3);
});
test('completed dividends are not fetched on minute price updates, but can refresh after six hours',async()=>{
 const h=harness();h.queue.select(['7203.T'],true);await flush();await h.respond(h.requests[0],raw('7203.T'));
 for(let i=0;i<6;i++){await h.advance(60000);h.queue.select(['7203.T'],true);await flush();}
 assert.equal(h.requests.length,1);assert.equal(h.queue.peek('7203.T').data.data.annual_dividend,95);
 await h.advance(dividends.FRESH_MS);h.queue.select(['7203.T'],true);await flush();assert.equal(h.requests.length,2);
});
test('pending facts poll within a fixed limit and preserve available amounts',async()=>{
 const h=harness();h.queue.select(['7203.T'],true);await flush();await h.respond(h.requests[0],raw('7203.T',{}, {status:'pending',refreshing:true}));
 assert.equal(h.queue.peek('7203.T').updating,true);assert.match(dividends.markup(h.queue.peek('7203.T'),now),/95円/);
 await h.advance(3000);assert.equal(h.requests.length,2);await h.respond(h.requests[1],raw('7203.T'));
 assert.equal(h.queue.peek('7203.T').updating,false);await h.advance(90000);assert.equal(h.requests.length,2);
});
test('hiding or removing favorites cancels pending work and prevents late results from leaking into a new selection',async()=>{
 const h=harness();h.queue.select(['7203.T','9432.T','6758.T'],true);await flush();
 h.queue.select(['9432.T'],false);assert.ok(h.requests.every(r=>r.options.signal.aborted));
 await h.respond(h.requests[0],raw('7203.T'));assert.equal(h.queue.peek('7203.T').data,null);
 h.queue.select(['9432.T'],true);await flush();assert.equal(h.requests.length,3);
 await h.respond(h.requests[1],raw('9432.T',{annual_dividend:999}));assert.equal(h.queue.peek('9432.T').data,null);
 await h.respond(h.requests[2],raw('9432.T',{annual_dividend:5.3}));assert.equal(h.queue.peek('9432.T').data.data.annual_dividend,5.3);
});
test('failed lookup releases its worker, retains saved facts and has a short bounded retry interval',async()=>{
 const h=harness();h.queue.select(['7203.T'],true);await flush();await h.respond(h.requests[0],raw('7203.T'));
 await h.advance(dividends.FRESH_MS);h.queue.select(['7203.T'],true);await flush();await h.respond(h.requests[1],{},404);
 assert.equal(h.queue.peek('7203.T').status,'stale');assert.match(dividends.markup(h.queue.peek('7203.T'),now),/95円/);
 h.queue.select(['7203.T'],true);await flush();assert.equal(h.requests.length,2);
 await h.advance(dividends.RETRY_MS);h.queue.select(['7203.T'],true);await flush();assert.equal(h.requests.length,3);
});
test('mismatched data never acquires a different favorite company’s numbers',async()=>{
 const h=harness();h.queue.select(['7203.T'],true);await flush();await h.respond(h.requests[0],raw('9432.T'));
 assert.equal(h.queue.peek('7203.T').data,null);assert.match(dividends.markup(h.queue.peek('7203.T'),now),/未確認/);
});
test('the browser adapter pauses facts when the whole stock screen is hidden even if favorites is still selected',()=>{
 const calls=[],events={};let visible=true,observe;
 const row={dataset:{watchDividend:'7203.T'},innerHTML:''},wrap={dataset:{stockMain:'favorites'}},section={querySelectorAll:()=>[row],getClientRects:()=>visible?[{}]:[]},main={};
 const doc={body:{},hidden:false,getElementById:id=>({knTabWrap:wrap,knWatchSec:section,'morning-section':main})[id],addEventListener:(name,fn)=>events[name]=fn};
 const w={document:doc,setTimeout:fn=>fn(),KNCompanyProfile:{createFactsLoader:()=>({peek:()=>null,load:key=>calls.push('load:'+key),cancel:()=>calls.push('cancel')})},MutationObserver:class{constructor(fn){observe=fn;}observe(){}}};
 const adapter=dividends.start(w);adapter.refresh();assert.deepEqual(calls,['load:7203.T']);
 visible=false;observe();assert.deepEqual(calls,['load:7203.T','cancel']);
 visible=true;observe();assert.deepEqual(calls,['load:7203.T','cancel','load:7203.T']);
});

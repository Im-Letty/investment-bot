const {test}=require('node:test');
const assert=require('node:assert/strict');
const calendar=require('../static/dividend-calendar.js');
const NOW=Date.parse('2026-09-24T06:00:00Z'),MONTH='2026-09',WATCH='alert_watchlist_v1',OLD='myDividendStocks',DONE='dividend_calendar_migrated_v1';
function event(changes={}){return {id:'test',symbol:'7203.T',code:'7203',name:'トヨタ自動車',date:'2026-09-28',kind:'holding_deadline',precision:'day',status:'confirmed',source:{title:'会社の公式サイト',url:'https://global.toyota/jp/ir/'},verified_on:'2026-09-24',...changes};}
function fixture(changes={}){return {events:[event(),event({date:'2026-09-29',kind:'ex_dividend'}),event({symbol:'9432.T',code:'9432',name:'NTT',kind:'payment',precision:'month',period:MONTH,date:null,status:'planned'})],coverage:{universe:206,known:2,unknown:204},range:{start:'2026-09-01',end:'2026-11-30'},updated_at:NOW/1000,universe_as_of:'2026-09-24',status:'ready',refreshing:false,...changes};}
function storage(initial={}){const map=new Map(Object.entries(initial));return {map,getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)};}
async function flush(){for(let i=0;i<30;i++)await Promise.resolve();}
function clock(){let now=NOW,next=0;const timers=new Map();return {now:()=>now,timers,setTimeout(fn,ms){timers.set(++next,{at:now+ms,fn});return next;},clearTimeout(id){timers.delete(id);},async advance(ms){const end=now+ms;for(;;){const pair=[...timers.entries()].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!pair)break;now=pair[1].at;timers.delete(pair[0]);pair[1].fn();await flush();}now=end;await flush();}};}
function harness(saved=storage()){
  const time=clock(),requests=[],states=[],env={...time,storage:saved,AbortController,fetch(url,options){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});requests.push({url,options,resolve,reject});return promise;}};
  const loader=calendar.createLoader(env,state=>states.push(state));return {loader,time,requests,states,storage:saved,load(query={month:MONTH,scope:'all',symbols:[]}){const promise=loader.load(query);return promise;},async reply(index,payload,status=200){requests[index].resolve({ok:status===200,status,json:async()=>payload});await flush();}};
}
test('JST month bounds cover exactly current month and two following months across the year',()=>{
  assert.deepEqual(calendar.bounds(Date.parse('2026-12-31T15:00:00Z')),{start:'2027-01-01',end:'2027-03-31',months:['2027-01','2027-02','2027-03']});
  assert.equal(calendar.shift('2026-12',1),'2027-01');assert.equal(calendar.day('2026-02-29'),null);assert.equal(calendar.day('2024-02-29'),'2024-02-29');assert.equal(calendar.month('2026-13'),null);
});
test('month-only payment plans never acquire days and are excluded from date dots and upcoming day lists',()=>{
  const data=calendar.normalize(fixture(),MONTH,'all',[],NOW);assert.equal(data.events.length,3);const plan=data.events.find(row=>row.precision==='month');assert.equal(plan.date,null);assert.equal(plan.period,MONTH);
  const days=calendar.calendarDays(MONTH,data.events,'2026-09-24');assert.equal(days.length,42);assert.equal(days.filter(Boolean).length,30);assert.equal(days.find(row=>row&&row.day===28).count,1);assert.equal(days.reduce((sum,row)=>sum+(row?row.count:0),0),2);
  assert.equal(calendar.visibleEvents(data,null,'2026-09-24').length,2);assert.equal(calendar.visibleEvents(data,'2026-09-29','2026-09-24')[0].kind,'ex_dividend');assert.equal(calendar.visibleEvents(data,null,'2026-09-30').length,0);
});
test('normalization rejects invented dates, unsafe sources, wrong months and mismatched favorite companies',()=>{
  const raw=fixture();raw.events.push(event({date:'2026-09-31'}),event({date:'2026-10-01'}),event({kind:'holding_deadline',precision:'month',period:MONTH}),event({date:'2026-09-25',source:{title:'bad',url:'javascript:alert(1)'}}),event({date:'2026-09-26',verified_on:'2026-09-25'}),event());
  const all=calendar.normalize(raw,MONTH,'all',[],NOW);assert.equal(all.events.length,3);const mine=calendar.normalize(raw,MONTH,'favorites',['9432.T'],NOW);assert.equal(mine.events.length,1);assert.equal(mine.events[0].symbol,'9432.T');
  assert.equal(calendar.normalize(fixture({coverage:{universe:1,known:2,unknown:0}}),MONTH,'all',[],NOW),null);assert.equal(calendar.normalize(fixture(),'2026-12','all',[],NOW),null);
});
test('record dates retain the published date and are never inferred from deadlines or effective record dates',()=>{
  const rows=[
    event({symbol:'1000.T',record_date:'2026-09-30',effective_record_date:'2026-09-29'}),
    event({symbol:'1001.T',effective_record_date:'2026-09-30'}),
    event({symbol:'1002.T',record_date:'2026-09-31'}),
    event({symbol:'1003.T',record_date:'2026-09-27'}),
    event({symbol:'1004.T',kind:'payment',precision:'month',period:MONTH,date:null,record_date:'2026-09-30'})
  ];
  const result=calendar.normalize(fixture({events:rows}),MONTH,'all',[],NOW);
  assert.equal(result.events.length,5);
  assert.equal(result.events.find(row=>row.symbol==='1000.T').record_date,'2026-09-30');
  assert.ok(result.events.filter(row=>row.symbol!=='1000.T').every(row=>row.record_date===null));
  assert.equal(calendar.normalize(result,MONTH,'all',[],NOW).events.find(row=>row.symbol==='1000.T').record_date,'2026-09-30');
});
test('legacy shares migrate after gate readiness without deleting original data or existing foreign favorites',async()=>{
  const old=JSON.stringify([{code:'７２０３',name:'トヨタ'},{code:'9432',name:'NTT'}]),saved=storage({[WATCH]:'["AAPL","9432.T"]',[OLD]:old});let ready;const promise=new Promise(resolve=>ready=resolve),writes=[];
  const migration=calendar.migrate(saved,async(key,value)=>{writes.push(key);saved.setItem(key,value);},promise);await flush();assert.equal(writes.length,0);ready();const result=await migration;
  assert.deepEqual(JSON.parse(saved.getItem(WATCH)),['AAPL','9432.T','7203.T']);assert.equal(saved.getItem(OLD),old);assert.equal(result.legacyCount,0);assert.deepEqual(result.symbols,['9432.T','7203.T']);
  saved.setItem(WATCH,'["AAPL","9432.T"]');assert.deepEqual(calendar.selection(saved).symbols,['9432.T']);await calendar.migrate(saved);assert.deepEqual(JSON.parse(saved.getItem(WATCH)),['AAPL','9432.T']);
});
test('legacy overflow remains in calendar favorites up to 100, and failed migration never loses the originals',async()=>{
  const watched=Array.from({length:20},(_,i)=>(1000+i)+'.T'),old=JSON.stringify([{code:'7203',name:'トヨタ'},{code:'9432',name:'NTT'}]),saved=storage({[WATCH]:JSON.stringify(watched),[OLD]:old});const result=await calendar.migrate(saved);
  assert.equal(result.symbols.length,22);assert.equal(result.legacyCount,2);assert.deepEqual(JSON.parse(saved.getItem(WATCH)),watched);assert.equal(saved.getItem(OLD),old);
  const failing=storage({[OLD]:old});const failure=await calendar.migrate(failing,async()=>{throw new Error('quota');});assert.equal(failure.migrationError,true);assert.deepEqual(failure.symbols,['7203.T','9432.T']);assert.equal(failing.getItem(OLD),old);assert.equal(failing.getItem(DONE),null);
});
test('saving migration markers makes later favorite deletion stick without resurrecting old selections',async()=>{
  const saved=storage({[OLD]:'[{"code":"7203","name":"トヨタ"}]'});await calendar.migrate(saved);saved.setItem(WATCH,'[]');const result=await calendar.migrate(saved);assert.deepEqual(result.symbols,[]);assert.deepEqual(JSON.parse(saved.getItem(WATCH)),[]);assert.equal(JSON.parse(saved.getItem(OLD)).length,1);
});
test('empty favorites show an empty selection without a network request or a false no-dividend claim',async()=>{
  const h=harness();await h.load({month:MONTH,scope:'favorites',symbols:[]});assert.equal(h.requests.length,0);assert.equal(h.states.at(-1).status,'ready');assert.equal(h.states.at(-1).data.coverage.universe,0);assert.equal(h.states.at(-1).data.updated_at,null);
});
test('network requests deduplicate, cache immediately reappears and failed refresh retains its true date',async()=>{
  const saved=storage(),first=harness(saved);const p=first.load(),same=first.load();assert.equal(p,same);assert.equal(first.requests.length,1);await first.reply(0,fixture());await p;
  const h=harness(saved);const again=h.load();assert.equal(h.states[0].status,'refreshing');assert.equal(h.states[0].data.events.length,3);h.requests[0].reject(new Error('offline'));await again;assert.equal(h.states.at(-1).status,'error');assert.equal(h.states.at(-1).data.updated_at,NOW);
});
test('switching months or cancelling guards against late responses and aborts outstanding work',async()=>{
  const h=harness();h.load();h.load({month:'2026-10',scope:'all',symbols:[]});assert.equal(h.requests[0].options.signal.aborted,true);await h.reply(1,fixture({events:[event({date:'2026-10-05'})]}));const count=h.states.length;await h.reply(0,fixture());assert.equal(h.states.length,count);assert.equal(h.states.at(-1).query.month,'2026-10');
  h.load();h.loader.cancel();const last=h.states.length;await h.reply(2,fixture());assert.equal(h.states.length,last);assert.equal(h.time.timers.size,0);
});
test('stalled responses are bounded at 12 seconds; older server snapshots cannot roll back the cache',async()=>{
  const h=harness();const loading=h.load();await h.time.advance(12000);await loading;assert.equal(h.requests[0].options.signal.aborted,true);assert.equal(h.states.at(-1).reason,'timeout');
  h.load();await h.reply(1,fixture());h.load();await h.reply(2,fixture({updated_at:(NOW-86400000)/1000,events:[]}));assert.equal(h.states.at(-1).status,'stale');assert.equal(h.states.at(-1).data.events.length,3);assert.equal(h.states.at(-1).data.updated_at,NOW);
});
test('unknown legacy symbols are reported and excluded from a single retry without altering saved favorites',async()=>{
  const saved=storage({[WATCH]:'["7203.T","9999.T"]'}),h=harness(saved);h.load({month:MONTH,scope:'favorites',symbols:['7203.T','9999.T']});await h.reply(0,{error:'invalid_symbols',invalid_symbols:['9999.T']},400);assert.equal(h.requests.length,2);assert.match(h.requests[1].url,/symbols=7203.T$/);await h.reply(1,fixture({events:[event()],coverage:{universe:1,known:1,unknown:0}}));assert.deepEqual(h.states.at(-1).excluded,['9999.T']);assert.equal(saved.getItem(WATCH),'["7203.T","9999.T"]');
});
test('server stale state and unknown symbols in a successful response remain visible without deleting registrations',async()=>{
  const h=harness();h.load({month:MONTH,scope:'favorites',symbols:['7203.T','9437.T']});await h.reply(0,fixture({status:'stale',invalid_symbols:['9437.T'],events:[event()]}));assert.equal(h.states.at(-1).status,'stale');assert.deepEqual(h.states.at(-1).excluded,['9437.T']);assert.equal(h.states.at(-1).data.events.length,1);assert.equal(h.requests.length,1);
});
test('backend loading status is not mistaken for a confirmed empty schedule',async()=>{
  const h=harness();h.load();await h.reply(0,fixture({status:'loading',refreshing:true,events:[],updated_at:null}));assert.equal(h.states.at(-1).status,'pending');assert.equal(h.states.at(-1).data.refreshing,true);assert.equal(h.states.at(-1).data.updated_at,null);
});
class Element{
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.doc=doc;this.children=[];this.dataset={};this.attributes={};this.listeners={};this.className='';this.hidden=false;this.disabled=false;this.open=false;this._text='';}
  get textContent(){return this._text+this.children.map(row=>row.textContent).join('');}set textContent(value){this._text=String(value);this.children=[];}set innerHTML(value){throw new Error('Unsafe HTML');}
  appendChild(node){if(node.parentNode)node.parentNode.children=node.parentNode.children.filter(child=>child!==node);node.parentNode=this;this.children.push(node);return node;}
  replaceChildren(...nodes){this.children=[];nodes.forEach(node=>this.appendChild(node));}
  setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}removeAttribute(key){delete this.attributes[key];}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}dispatch(type,event={}){for(const fn of this.listeners[type]||[])fn({target:this,...event});}
  find(cls){return this.all().find(node=>node.className.split(' ').includes(cls));}all(){return [this,...this.children.flatMap(child=>child.all())];}focus(){this.doc.activeElement=this;}getClientRects(){return this.hidden?[]:[{}];}
}
function uiHarness({saved=storage(),gate=Promise.resolve(),prices=null}={}){
  const time=clock(),events={},requests=[],doc={readyState:'complete',hidden:false,createElement(tag){return new Element(tag,this);},getElementById(id){return id==='knDividendCalendar'?this.mount:null;},addEventListener(type,fn){(events[type]??=[]).push(fn);}};doc.mount=doc.createElement('div');const winEvents={};
  const w={...time,document:doc,localStorage:saved,AbortController,__knGateReady:gate,addEventListener(type,fn){(winEvents[type]??=[]).push(fn);},Event:class{constructor(type){this.type=type;}},dispatchEvent(event){for(const fn of winEvents[event.type]||[])fn(event);},fetch(url,options){return new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}));},openStockWatchManager(){this.managed=true;}};
  if(prices)w.KNCalendarPrices=prices;calendar.start(w);return {w,doc,mount:doc.mount,time,events,winEvents,requests,saved,async reply(index,raw){requests[index].resolve({ok:true,status:200,json:async()=>raw});await flush();}};
}
test('calendar UI renders 42 cells, limits navigation and preserves unchanged list/disclosure nodes',async()=>{
  const h=uiHarness();await flush();const realMonth=calendar.today().slice(0,7),range=calendar.bounds(),date=calendar.today(),raw=fixture({events:[event({date,verified_on:calendar.today()})],range,updated_at:Date.now()/1000});await h.reply(0,raw);
  const grid=h.mount.find('dc-grid');assert.equal(grid.children.length,42);assert.equal(h.mount.find('dc-month-navigation').children[0].disabled,true);const first=h.mount.find('dc-events').children[0];assert.ok(first);const disclosure=first.find('dc-evidence');disclosure.open=true;h.w.KNDividendCalendar.refresh();await h.reply(1,raw);assert.equal(h.mount.find('dc-events').children[0],first);assert.equal(disclosure.open,true);assert.equal(grid.children.length,42);
  h.mount.find('dc-month-navigation').children[2].dispatch('click');assert.match(h.requests.at(-1).url,new RegExp(calendar.shift(realMonth,1)));h.mount.find('dc-month-navigation').children[2].dispatch('click');assert.equal(h.mount.find('dc-month-navigation').children[2].disabled,true);
});
test('day selection, five-item pagination and month plans are separate and company buttons carry safe identifiers',async()=>{
  const h=uiHarness();await flush();const realMonth=calendar.today().slice(0,7),date=calendar.today(),raw=fixture({range:calendar.bounds(),updated_at:Date.now()/1000,events:Array.from({length:7},(_,i)=>event({symbol:(1000+i)+'.T',date,name:i===0?'<img src=x>':'会社'+i,verified_on:date})).concat(event({symbol:'9432.T',kind:'payment',precision:'month',period:realMonth,date:null,verified_on:date}))});await h.reply(0,raw);
  const list=h.mount.find('dc-events');assert.equal(list.children.length,5);assert.equal(h.mount.find('dc-month-plans').hidden,false);assert.equal(h.mount.find('dc-plan-heading').textContent,Number(realMonth.slice(5))+'月の支払い予定');const link=list.children[0].find('dc-company');assert.equal(list.children[0].find('dc-profile').dataset.companyProfile,'1000.T');assert.equal(link.textContent,'<img src=x>');assert.equal(link.children.length,0);
  h.mount.find('dc-more').dispatch('click');assert.equal(list.children.length,7);h.mount.find('dc-grid').children.find(node=>node.dataset.date===date).dispatch('click');assert.match(h.mount.find('dc-list-heading').textContent,/の予定/);assert.equal(list.children.length,5);assert.equal(h.mount.find('dc-reset').hidden,false);
  h.mount.find('dc-reset').dispatch('click');assert.equal(h.mount.find('dc-reset').hidden,true);assert.equal(h.mount.find('dc-list-heading').children[0].textContent,'これからの予定');
});
test('favorite filter shares storage updates and keyboard arrows move to the neighboring day',async()=>{
  const h=uiHarness();await flush();await h.reply(0,fixture({range:calendar.bounds(),events:[],updated_at:Date.now()/1000}));h.mount.find('dc-filters').children[1].dispatch('click');assert.equal(h.requests.length,1);assert.match(h.mount.find('dc-empty').textContent,/お気に入りに日本株/);
  h.saved.setItem(WATCH,'["7203.T"]');h.w.dispatchEvent(new h.w.Event('kn:watchlist-change'));assert.equal(h.requests.length,2);assert.match(h.requests[1].url,/scope=favorites/);assert.match(h.requests[1].url,/7203.T/);
  const cells=h.mount.find('dc-grid').children.filter(node=>node.dataset.date);let prevented=false;cells[3].dispatch('keydown',{key:'ArrowRight',preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(h.doc.activeElement,cells[4]);h.mount.find('dc-manage').dispatch('click');assert.equal(h.w.managed,true);
});
test('hiding the page cancels outstanding work and resuming requests fresh data',async()=>{
  const h=uiHarness();await flush();h.doc.hidden=true;for(const fn of h.events.visibilitychange)fn();assert.equal(h.requests[0].options.signal.aborted,true);assert.equal(h.time.timers.size,0);h.doc.hidden=false;for(const fn of h.events.visibilitychange)fn();assert.equal(h.requests.length,2);
});
test('saved favorites are the default, including after decryption, while a manual filter choice wins',async()=>{
  const saved=storage({[WATCH]:'["7203.T"]'}),first=uiHarness({saved});assert.match(first.requests[0].url,/scope=favorites/);await flush();
  let unlock;const gate=new Promise(resolve=>unlock=resolve),delayed=storage(),h=uiHarness({saved:delayed,gate});assert.match(h.requests[0].url,/scope=all/);delayed.setItem(WATCH,'["9432.T"]');unlock();await flush();assert.match(h.requests.at(-1).url,/scope=favorites/);assert.match(h.requests.at(-1).url,/9432.T/);
  let release;const chosen=storage(),other=uiHarness({saved:chosen,gate:new Promise(resolve=>release=resolve)});other.mount.find('dc-filters').children[0].dispatch('click');chosen.setItem(WATCH,'["7203.T"]');release();await flush();assert.match(other.requests.at(-1).url,/scope=all/);assert.equal(other.mount.find('dc-filters').children[0].getAttribute('aria-pressed'),'true');
});

test('holding dates survive cache normalization and cannot be invented from a record date',()=>{
  const base=event({record_date:'2026-09-30',holding_deadline:'2026-09-28',ex_dividend_date:'2026-09-29'});
  const raw=fixture({events:[base,event({...base,symbol:'1001.T',holding_deadline:undefined}),event({...base,symbol:'1002.T',ex_dividend_date:'2026-09-27'}),event({...base,symbol:'1003.T',holding_deadline:'2026-09-25'}),event({...base,symbol:'1004.T',kind:'payment'})]});
  const normalized=calendar.normalize(raw,MONTH,'all',[],NOW);
  assert.deepEqual(normalized.events.find(e=>e.symbol==='7203.T').holding_window,{deadline:'2026-09-28',ex_dividend:'2026-09-29'});
  assert.ok(normalized.events.filter(e=>e.symbol!=='7203.T').every(e=>e.holding_window===null));
  assert.deepEqual(calendar.normalize(normalized,MONTH,'all',[],NOW).events.find(e=>e.symbol==='7203.T').holding_window,{deadline:'2026-09-28',ex_dividend:'2026-09-29'});
});
test('only sourced forecasts for the matching record date are displayed as this dividend',()=>{
  const dividend={record_date:'2026-09-30',per_share:19,currency:'JPY',status:'forecast',announced_on:'2026-08-07',verified_on:'2026-09-24',source:{title:'会社の中間配当予想',url:'https://www.fujikura.co.jp/ir/'}};
  const variants=[dividend,{...dividend,record_date:'2027-03-31'},{...dividend,per_share:-1},{...dividend,currency:'USD'},{...dividend,status:'annual'},{...dividend,source:{title:'bad',url:'javascript:alert(1)'}},{...dividend,verified_on:'2026-09-25'}];
  const raw=fixture({events:variants.map((amount,i)=>event({symbol:(1000+i)+'.T',record_date:'2026-09-30',dividend:amount}))});
  const rows=calendar.normalize(raw,MONTH,'all',[],NOW).events;
  assert.equal(rows.find(e=>e.symbol==='1000.T').dividend.per_share,19);
  assert.ok(rows.filter(e=>e.symbol!=='1000.T').every(e=>e.dividend===null));
});
test('A displays actual deadlines, 100-share forecasts and safe broker disclosures without duplicate guidance',async()=>{
  const h=uiHarness();await flush();const date=calendar.today(),plus=n=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10),record=plus(2);
  const dividend={record_date:record,per_share:2.7,currency:'JPY',status:'forecast',announced_on:date,verified_on:date,source:{title:'中間配当の会社予想',url:'https://group.ntt/jp/ir/'}};
  const raw=fixture({range:calendar.bounds(),updated_at:Date.now()/1000,events:[event({symbol:'9432.T',date,verified_on:date,record_date:record,holding_deadline:date,ex_dividend_date:plus(1),dividend})]});
  await h.reply(0,raw);
  const row=h.mount.find('dc-events').children[0],story=row.find('dc-holding-story');assert.ok(story);assert.equal(story.parentNode,row.__disclosure);
  assert.equal(story.find('dc-dividend-values').textContent,'1株保有した場合2.7円100株保有した場合270円');assert.match(story.textContent,/税引前・会社予想/);
  assert.equal(story.find('dc-holding-range').children.length,3);
  assert.equal(story.find('dc-range-start').find('dc-range-value').textContent,story.find('dc-range-end').find('dc-range-value').textContent);
  assert.match(story.find('dc-after-deadline').textContent,/今回の配当の権利は残ります/);
  assert.ok(story.find('dc-record-note'));assert.equal(h.mount.find('dc-guidance'),undefined);
  const brokers=story.find('dc-brokers');assert.equal(brokers.children[0].textContent,'1株で買えるか確認する');
  assert.equal(story.find('dc-broker-links').children.length,3);
  for(const li of story.find('dc-broker-links').children){const a=li.children[0];assert.match(a.href,/^https:\/\//);assert.equal(a.rel,'noopener noreferrer');}
  brokers.open=true;h.w.KNDividendCalendar.refresh();await h.reply(1,raw);assert.equal(h.mount.find('dc-events').children[0],row);assert.equal(brokers.open,true);
});
test('unknown amounts stay unknown while Fujikura has a specifically verified broker list',async()=>{
  const h=uiHarness();await flush();const date=calendar.today(),ex=new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  const raw=fixture({range:calendar.bounds(),updated_at:Date.now()/1000,events:[event({symbol:'5803.T',name:'フジクラ',date,verified_on:date,holding_deadline:date,ex_dividend_date:ex})]});
  await h.reply(0,raw);const story=h.mount.find('dc-holding-story');assert.equal(story.find('dc-dividend-values').textContent,'1株保有した場合金額未確認100株保有した場合金額未確認');assert.equal(story.find('dc-dividend-unit'),undefined);assert.match(story.find('dc-record-note').textContent,/権利確定日：日程未確認/);
  assert.equal(story.find('dc-brokers').children[0].textContent,'1株から買える証券会社');assert.match(story.find('dc-broker-stock').textContent,/フジクラ（5803）の取扱例/);
});

test('each event date has the shared detail card and only validated deadlines are displayed',async t=>{
  t.mock.method(Date,'now',()=>NOW);
  const h=uiHarness();await flush();
  const rows=[
    event({date:'2026-09-24',kind:'ex_dividend',holding_deadline:'2026-09-18',ex_dividend_date:'2026-09-24',record_date:'2026-09-25'}),
    event({date:'2026-09-25'}),
    event({date:'2026-09-26',status:'planned',holding_deadline:'2026-09-26',ex_dividend_date:'2026-09-29'}),
    event({date:'2026-09-29',kind:'ex_dividend',holding_deadline:'2026-09-28',ex_dividend_date:'2026-09-29',record_date:'2026-09-30'}),
    event({date:'2026-09-30',kind:'payment',holding_deadline:'2026-09-28',ex_dividend_date:'2026-09-29',record_date:'2026-09-30'})
  ];
  await h.reply(0,fixture({events:rows}));
  for(const item of rows){
    h.mount.find('dc-grid').children.find(cell=>cell.dataset.date===item.date).dispatch('click');
    const row=h.mount.find('dc-events').children[0],story=row.find('dc-holding-story');
    assert.ok(story);assert.equal(story.find('dc-dividend-values').children.length,2);assert.equal(story.find('dc-price-values').children.length,2);assert.equal(story.find('dc-broker-links').children.length,3);
    assert.match(story.textContent,/購入はいつまで？/);assert.match(story.textContent,/保有はいつまで？/);assert.match(story.find('dc-price-heading').textContent,/現在の購入金額の目安/);
    assert.ok(story.find('dc-evidence'));assert.equal(h.mount.find('dc-date-guide'),undefined);
    const start=story.find('dc-range-start').find('dc-range-value').textContent,end=story.find('dc-range-end').find('dc-range-value').textContent;
    assert.equal(start,end);
    if(item.date==='2026-09-24'){assert.match(start,/9\/18/);assert.match(story.find('dc-holding-note').textContent,/持っていた株が対象/);assert.doesNotMatch(story.textContent,/当日に買っても対象です/);}
    else if(item.date==='2026-09-25'){assert.match(start,/9\/25/);assert.match(story.find('dc-after-deadline').textContent,/日程未確認/);}
    else if(item.date==='2026-09-29'){assert.match(start,/9\/28/);assert.match(story.find('dc-after-deadline').textContent,/9\/29/);}
    else assert.equal(start,'日程未確認');
    if(item.kind==='payment'){assert.match(story.find('dc-holding-note').textContent,/支払日や支払予定月は、購入・保有の締切とは別/);assert.match(story.find('dc-after-deadline').textContent,/日程未確認/);}
  }
});

test('past ex-date cards distinguish historical forecasts and dates from current share prices',async t=>{
  t.mock.method(Date,'now',()=>NOW);
  const h=uiHarness();await flush();
  const dividend={record_date:'2026-09-18',per_share:19,currency:'JPY',status:'forecast',announced_on:'2026-09-01',verified_on:'2026-09-24',source:{title:'当時の会社予想',url:'https://example.com/forecast'}};
  const history=event({symbol:'6861.T',date:'2026-09-17',kind:'ex_dividend',source:{title:'記録済みの権利落ち日',url:'https://finance.yahoo.com/quote/6861.T/'}});
  const official=event({date:'2026-09-17',kind:'ex_dividend',holding_deadline:'2026-09-16',ex_dividend_date:'2026-09-17',record_date:'2026-09-18',dividend});
  await h.reply(0,fixture({events:[history,official]}));
  h.mount.find('dc-grid').children.find(cell=>cell.dataset.date==='2026-09-17').dispatch('click');
  const cards=h.mount.find('dc-events').children;
  assert.equal(cards.length,2);
  for(const row of cards){
    const story=row.find('dc-holding-story');assert.match(story.find('dc-past-event').textContent,/過去の配当日程/);assert.match(story.find('dc-dividend-heading').textContent,/当時の配当予想/);assert.match(story.find('dc-price-heading').textContent,/現在の購入金額の目安/);assert.match(story.find('dc-after-deadline').textContent,/9\/17（木） 権利落ち日/);assert.doesNotMatch(story.textContent,/当日に買っても対象です/);assert.equal(story.find('dc-price-note'),undefined);
  }
  const unknown=cards.find(row=>row.__priceSymbol==='6861.T').find('dc-holding-story');
  assert.equal(unknown.find('dc-range-value').textContent,'日程未確認');assert.doesNotMatch(unknown.textContent,/9\/16/);assert.match(unknown.find('dc-dividend-values').textContent,/金額未確認/);assert.match(unknown.find('dc-evidence').textContent,/記録済みの権利落ち日/);
  const known=cards.find(row=>row.__priceSymbol==='7203.T').find('dc-holding-story');
  assert.match(known.find('dc-range-value').textContent,/9\/16/);assert.equal(known.find('dc-dividend-values').textContent,'1株保有した場合19円100株保有した場合1,900円');assert.match(known.find('dc-dividend-note').textContent,/当時の会社予想/);assert.match(known.find('dc-evidence').textContent,/配当予想の発表 2026\/09\/01/);
});

test('month-only payments share the full card and live prices with day cards without inventing deadlines',async t=>{
  t.mock.method(Date,'now',()=>NOW);
  let notify,instance;const states=new Map(),prices={create(env,onUpdate){notify=onUpdate;return instance={selected:[],setSymbols(list){this.selected=list;},peek(key){return states.get(key)||{quote:null};},pause(){},resume(){}};}};
  const h=uiHarness({prices});await flush();
  const dayPayment=event({date:'2026-09-24',kind:'payment'}),plan=event({kind:'payment',precision:'month',date:null,period:MONTH,status:'planned',holding_deadline:'2026-09-28',ex_dividend_date:'2026-09-29'});
  const raw=fixture({events:[dayPayment,plan,{...plan,symbol:'9432.T'}]});await h.reply(0,raw);
  const dayRow=h.mount.find('dc-events').children[0],planList=h.mount.find('dc-month-plans').find('dc-events'),planRow=planList.children.find(row=>row.__priceSymbol==='7203.T');
  assert.deepEqual(instance.selected,[]);for(const row of [dayRow,...planList.children]){row.__disclosure.open=true;row.__disclosure.dispatch('toggle');}
  assert.deepEqual(instance.selected,['7203.T','9432.T']);assert.equal(planList.children.length,2);
  for(const row of [dayRow,...planList.children]){
    const story=row.find('dc-holding-story');assert.ok(story);assert.equal(story.find('dc-range-value').textContent,'日程未確認');assert.match(story.find('dc-dividend-values').textContent,/金額未確認/);assert.match(story.find('dc-dividend-heading').textContent,/この支払いの配当額/);assert.equal(story.find('dc-broker-links').children.length,3);assert.doesNotMatch(story.find('dc-holding-range').textContent,/9\/28/);
  }
  assert.equal(planRow.find('dc-event-date').textContent,'9月');
  const brokers=planRow.find('dc-brokers');brokers.open=true;
  const price={quote:{symbol:'7203.T',price:2500,currency:'JPY',price_updated_at:NOW/1000,fetched_at:NOW/1000},pending:false};states.set('7203.T',price);notify('7203.T',price);
  for(const row of [dayRow,planRow]){const cells=row.find('dc-price-values').children;assert.equal(cells[0].find('dc-price-value').textContent,'2,500');assert.equal(cells[1].find('dc-price-value').textContent,'250,000');}
  h.w.KNDividendCalendar.refresh();await h.reply(1,raw);assert.equal(planList.children.find(row=>row.__priceSymbol==='7203.T'),planRow);assert.equal(brokers.open,true);
});


test('share and lot prices update in place without closing the broker disclosure or replacing dates',async()=>{
  let notify,instance;const states=new Map(),prices={create(env,onUpdate){notify=onUpdate;return instance={selected:[],paused:true,setSymbols(list){this.selected=list;},peek(key){return states.get(key)||{quote:null,pending:false,error:null};},pause(){this.paused=true;},resume(){this.paused=false;},refresh(){}};}};
  const h=uiHarness({prices});await flush();const date=calendar.today(),ex=new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  await h.reply(0,fixture({range:calendar.bounds(),updated_at:Date.now()/1000,events:[event({symbol:'5803.T',name:'フジクラ',date,verified_on:date,holding_deadline:date,ex_dividend_date:ex})]}));
  assert.deepEqual(instance.selected,[]);const disclosure=h.mount.find('dc-disclosure');assert.equal(disclosure.open,false);disclosure.open=true;disclosure.dispatch('toggle');
  assert.deepEqual(instance.selected,['5803.T']);assert.equal(instance.paused,false);
  const row=h.mount.find('dc-events').children[0],panel=row.find('dc-price-panel'),range=row.find('dc-holding-range'),brokers=row.find('dc-brokers');brokers.open=true;
  const value={quote:{symbol:'5803.T',price:4952.1,currency:'JPY',fetched_at:Date.now()/1000,price_updated_at:Date.now()/1000-1200,delay_minutes:20},pending:false,error:null};states.set('5803.T',value);notify('5803.T',value);
  const cells=panel.find('dc-price-values').children;
  assert.equal(cells[0].find('dc-price-value').textContent,'4,952.1');assert.equal(cells[1].find('dc-price-value').textContent,'495,210');
  assert.match(panel.find('dc-price-time').textContent,/JST 時点/);assert.equal(panel.find('dc-price-note'),undefined);
  notify('5803.T',{...value,quote:{...value.quote,price:4952.2}});assert.equal(cells[1].find('dc-price-value').textContent,'495,220');
  assert.equal(h.mount.find('dc-events').children[0],row);assert.equal(row.find('dc-holding-range'),range);assert.equal(brokers.open,true);
  notify('5803.T',{...value,error:'network'});assert.match(panel.find('dc-price-status').textContent,/前回の価格/);assert.equal(cells[0].find('dc-price-value').textContent,'4,952.1');
  row.__disclosure.open=false;row.__disclosure.dispatch('toggle');assert.deepEqual(instance.selected,[]);
  h.doc.hidden=true;for(const fn of h.events.visibilitychange)fn();assert.equal(instance.paused,true);
});

test('disclosures stay closed initially and favorites precede pagination without changing day counts',async t=>{
  t.mock.method(Date,'now',()=>NOW);
  const h=uiHarness();await flush();
  const rows=Array.from({length:7},(_,i)=>event({symbol:(1000+i)+'.T',name:'会社'+i}));
  const raw=fixture({events:rows.concat(event({symbol:'9999.T',date:'2026-09-29'}))});await h.reply(0,raw);
  const list=h.mount.find('dc-events'),first=list.children[0];
  assert.equal(first.__disclosure.open,false);assert.equal(first.find('dc-company').tagName,'SPAN');
  const count=h.mount.find('dc-grid').children.find(x=>x.dataset.date==='2026-09-28').find('dc-day-count');assert.equal(count.textContent,'7');
  first.__disclosure.open=true;first.__disclosure.dispatch('toggle');
  h.saved.setItem(WATCH,'["1006.T","9999.T"]');h.w.dispatchEvent(new h.w.Event('kn:watchlist-change'));
  assert.equal(list.children[0].__priceSymbol,'1006.T');assert.equal(list.children[0].__favorite.hidden,false);
  assert.equal(list.children[1],first);assert.equal(first.__disclosure.open,true);assert.equal(count.textContent,'7');assert.equal(list.children.length,5);
  h.mount.find('dc-more').dispatch('click');assert.equal(list.children.length,7);
  h.mount.find('dc-reset').dispatch('click');assert.equal(list.children[0].__priceSymbol,'1006.T');
  h.mount.find('dc-more').dispatch('click');assert.equal(list.children.at(-1).__priceSymbol,'9999.T');
  h.saved.setItem(WATCH,'[]');h.w.dispatchEvent(new h.w.Event('kn:watchlist-change'));
  assert.equal(list.children[0],first);assert.equal(first.__disclosure.open,true);assert.equal(list.children.find(x=>x.__priceSymbol==='1006.T').__favorite.hidden,true);
});

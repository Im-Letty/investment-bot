'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {create}=require('../static/dividend-data.js');
const source=fs.readFileSync(path.join(__dirname,'../static/dividend-view.js'),'utf8');
const NOW=Date.parse('2026-09-24T03:00:00Z');
const row=(extra={})=>({code:'7203',name:'トヨタ',yield_pct:3.25,annual_dividend:90,price:2769.23,...extra});
const snapshot=(items=[row()],extra={})=>({items,updated_at:NOW/1000,status:'ready',refreshing:false,...extra});
const calendar=(month,extra={})=>({days:[{date:month+'-24',items:[row({code:month,name:month+'の会社'})]}],updated_at:NOW/1000,status:'ready',refreshing:false,...extra});
async function flush(){for(let i=0;i<25;i++)await Promise.resolve();}

// Only the DOM operations used by the view are provided. Row markup is kept as
// rendered so assertions inspect the output instead of reimplementing rendering.
class Element {
  constructor(tag='div') {
    this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.style={};
    this.className='';this.attrs={};this.htmlWrites=0;this._html='';this._text='';
    this.classList={contains:name=>this.className.split(/\s+/).includes(name)};
  }
  set innerHTML(value){this.htmlWrites++;this._html=String(value);this._text='';this.children=[];}
  get innerHTML(){return this._html;}
  set textContent(value){this._text=String(value);this._html='';this.children=[];}
  get textContent(){return this._text+this._html.replace(/<[^>]*>/g,'')+this.children.map(child=>child.textContent).join('');}
  setAttribute(name,value){this.attrs[name]=String(value);}
  appendChild(child){child.parentNode=this;this.children.push(child);return child;}
  insertBefore(child,before){const i=this.children.indexOf(before);assert.notEqual(i,-1);child.parentNode=this;this.children.splice(i,0,child);return child;}
  querySelector(selector){
    for(const child of this.children){
      if(selector.startsWith('.')&&child.classList.contains(selector.slice(1)))return child;
      if(child.tagName.toLowerCase()===selector)return child;
      const nested=child.querySelector(selector);if(nested)return nested;
    }
    return null;
  }
  getClientRects(){return this.style.display==='none'?[]:[{}];}
}

function harness(saved={}) {
  const elements=new Map(),panes={},requests=[],timers=new Map();
  const storage=new Map(Object.entries(saved).map(([key,data])=>['kn_dividend_snapshot_v1:'+key,JSON.stringify(data)]));
  let now=NOW,timerId=0;
  for(const key of ['top','yearly','cal']) {
    const pane=new Element();pane.dataset.pane=key;pane.className='dividend-pane active';
    const loading=new Element();loading.className='dividend-loading';pane.appendChild(loading);
    const list=new Element();pane.appendChild(list);panes[key]=pane;
    elements.set(key==='cal'?'dividend-cal-body':'dividend-'+key+'-list',list);
  }
  const document={hidden:false,documentElement:{lang:'ja'},createElement:tag=>new Element(tag),getElementById:id=>elements.get(id)||null,
    querySelector(selector){const match=selector.match(/^\.dividend-pane\[data-pane="([^"]+)"\]$/);return match?panes[match[1]]||null:null;}};
  const model=create({now:()=>now,storage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    setTimeout(fn,delay){timers.set(++timerId,{fn,at:now+delay});return timerId;},clearTimeout:id=>timers.delete(id),
    fetch(url,options){return new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}));}});
  const window={document,KNDividendData:model,_topCodes:new Set(),_yrCodes:new Set(),_allStocksData:{},_stockName:(_,name)=>name,
    _divT(key,fallback){return document.documentElement.lang==='en'?({div_yen:' yen',div_annual:'Annual dividend',div_yield:'Yield',div_kabuka:'Price'}[key]||fallback):fallback;}};
  vm.runInNewContext(source,{window,document,Intl,Date,Set,Number,console},{filename:'dividend-view.js'});
  return {window,document,panes,elements,requests,timers,storage,
    list:key=>elements.get('dividend-'+key+'-list'),
    request(part){const request=requests.find(item=>item.url.includes(part)&&!item.settled);assert.ok(request,'pending request for '+part);return request;},
    async reply(request,data){request.settled=true;request.resolve({ok:true,json:async()=>data});await flush();},
    async fail(request){request.settled=true;request.reject(new Error('offline'));await flush();},
    advance(ms){now+=ms;for(const [id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}}
  };
}

test('high dividend rows omit missing/non-numeric yields instead of inventing 0%',async()=>{
  const h=harness();h.window.KNDividendView.list('top');await flush();
  const invalid=[undefined,null,NaN,Infinity,'4.2'].map((value,index)=>row({code:'missing'+index,yield_pct:value}));
  await h.reply(h.request('/top?'),snapshot([...invalid,row({name:'表示する会社',annual_dividend:null,price:null})]));
  const html=h.list('top').innerHTML;
  assert.equal((html.match(/class="div-item"/g)||[]).length,1);
  assert.match(html,/表示する会社/);assert.match(html,/3\.25%/);assert.match(h.list('top').textContent,/年間配当 —円/);
  assert.doesNotMatch(html,/missing|0\.00%|株価 0/);
});

test('a completed response with no valid yields shows an empty message, not a zero-valued company',async()=>{
  const h=harness();h.window.KNDividendView.list('top');await flush();
  await h.reply(h.request('/top?'),snapshot([row({yield_pct:null})]));
  assert.equal(h.list('top').dataset.loaded,undefined);
  assert.match(h.list('top').textContent,/表示できる配当情報がありません/);
  assert.doesNotMatch(h.list('top').innerHTML,/div-item|0\.00%/);
});

test('saved rows appear synchronously while the refresh is still unresolved',async()=>{
  const saved=snapshot();const h=harness({top:saved});h.window.KNDividendView.list('top');
  assert.match(h.list('top').innerHTML,/トヨタ/);assert.match(h.list('top').innerHTML,/3\.25%/);
  assert.equal(h.list('top').dataset.loaded,'1');
  assert.equal(h.panes.top.querySelector('.dividend-loading').style.display,'none');
  assert.match(h.panes.top.querySelector('.dividend-snapshot-status').textContent,/保存済み/);
  await flush();assert.equal(h.requests.length,1);assert.equal(h.requests[0].settled,undefined);
});
test('an empty cold snapshot shows pending status without inventing a date',async()=>{
  const h=harness();h.window.KNDividendView.list('top');await flush();
  await h.reply(h.request('/top?'),{items:[],updated_at:null,status:'loading',refreshing:true});
  assert.match(h.panes.top.querySelector('.dividend-snapshot-status').textContent,/確認しています/);
  assert.doesNotMatch(h.panes.top.querySelector('.dividend-snapshot-status').textContent,/JST|取得 /);
  assert.equal(h.list('top').innerHTML,'');
});

test('failed refresh retains dated rows and retry replaces them only when fresh data arrives',async()=>{
  const h=harness({top:snapshot()});h.window.KNDividendView.list('top');await flush();
  const previous=h.list('top').innerHTML,writes=h.list('top').htmlWrites;
  await h.fail(h.request('/top?'));
  assert.equal(h.list('top').innerHTML,previous);assert.equal(h.list('top').htmlWrites,writes);
  const status=h.panes.top.querySelector('.dividend-snapshot-status');assert.match(status.textContent,/保存済み/);
  const retry=status.querySelector('.dividend-retry');assert.ok(retry);retry.onclick();await flush();
  assert.equal(h.list('top').innerHTML,previous);
  await h.reply(h.request('/top?'),snapshot([row({yield_pct:4.5})],{updated_at:NOW/1000+30}));
  assert.match(h.list('top').innerHTML,/4\.50%/);assert.doesNotMatch(h.list('top').innerHTML,/3\.25%/);
  assert.equal(h.list('top').htmlWrites,writes+1);
});

test('an incomplete background snapshot does not erase already rendered rows',async()=>{
  const h=harness({top:snapshot()});h.window.KNDividendView.list('top');await flush();
  const previous=h.list('top').innerHTML,writes=h.list('top').htmlWrites;
  await h.reply(h.request('/top?'),{items:[],updated_at:null,status:'loading',refreshing:true});
  assert.equal(h.list('top').innerHTML,previous);assert.equal(h.list('top').htmlWrites,writes);
  assert.match(h.panes.top.querySelector('.dividend-snapshot-status').textContent,/保存済み/);
});

test('identical rows are not replaced when only the fetch timestamp changes',async()=>{
  const h=harness({top:snapshot()});h.window.KNDividendView.list('top');await flush();
  const previous=h.list('top').innerHTML,writes=h.list('top').htmlWrites;
  await h.reply(h.request('/top?'),snapshot([row()],{updated_at:NOW/1000+30}));
  assert.equal(h.list('top').innerHTML,previous);assert.equal(h.list('top').htmlWrites,writes);
  assert.match(h.panes.top.querySelector('.dividend-snapshot-status').textContent,/取得 /);
  h.document.documentElement.lang='en';h.window.KNDividendView.list('top');
  assert.equal(h.list('top').htmlWrites,writes+1);assert.match(h.list('top').textContent,/Annual dividend 90\.00 yen/);
});

test('company and code text from a dividend response cannot introduce executable markup',async()=>{
  const h=harness();h.window.KNDividendView.list('yearly');await flush();
  await h.reply(h.request('/yearly?'),snapshot([row({name:'<img src=x onerror=alert(1)>',code:'<script>alert(1)</script>',annual_dividend:125.5,yield_pct:null,price:null})]));
  const html=h.list('yearly').innerHTML;
  assert.match(html,/125\.50円/);assert.match(h.list('yearly').textContent,/利回り —%/);assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/<img|<script|0\.00%/);
});

test('calendar data renders while both auxiliary ranking requests are still pending',async()=>{
  const h=harness(),rendered=[];h.window.KNDividendView.calendar('2026-09',data=>rendered.push(data));await flush();
  assert.equal(h.requests.length,3);
  await h.reply(h.request('/calendar?month=2026-09'),calendar('2026-09'));
  assert.equal(rendered.at(-1).days[0].date,'2026-09-24');
  assert.equal(h.request('/top?').settled,undefined);assert.equal(h.request('/yearly?').settled,undefined);
  assert.equal(h.window._allStocksData['2026-09'].name,'2026-09の会社');
  const count=rendered.length;await h.fail(h.request('/yearly?'));assert.equal(rendered.length,count);
  await h.reply(h.request('/top?'),snapshot([row({code:'2026-09'})]));
  assert.ok(h.window._topCodes.has('2026-09'));assert.equal(rendered.at(-1).days[0].date,'2026-09-24');
  assert.equal(rendered.length,count+1,'successful badges may repaint the same calendar');
});

test('saved calendar is immediately visible without waiting for its request or ranking badges',()=>{
  const saved=calendar('2026-09');const h=harness({'calendar?month=2026-09':saved}),rendered=[];
  h.window.KNDividendView.calendar('2026-09',data=>rendered.push(data));
  assert.equal(rendered.length,1);assert.equal(rendered[0].days[0].date,'2026-09-24');
  assert.match(h.panes.cal.querySelector('.dividend-snapshot-status').textContent,/保存済み/);
});

test('late previous-month data and badge responses cannot replace the selected month',async()=>{
  const h=harness(),rendered=[];
  h.window.KNDividendView.calendar('2026-09',data=>rendered.push({month:'09',data}));await flush();
  const oldRequest=h.request('/calendar?month=2026-09');
  h.window.KNDividendView.calendar('2026-10',data=>rendered.push({month:'10',data}));await flush();
  await h.reply(h.request('/calendar?month=2026-10'),calendar('2026-10'));
  const count=rendered.length;await h.reply(oldRequest,calendar('2026-09'));
  assert.equal(rendered.length,count);assert.equal(rendered.at(-1).data.days[0].date,'2026-10-24');
  assert.equal(h.window._allStocksData['2026-09'],undefined);
  await h.reply(h.request('/top?'),snapshot());await h.reply(h.request('/yearly?'),snapshot());
  assert.ok(rendered.slice(count).every(entry=>entry.month==='10'&&entry.data.days[0].date==='2026-10-24'));
});

for(const key of ['top','yearly'])test(key+' shows five initially and retains expansion across refreshes',async()=>{
 const items=Array.from({length:20},(_,i)=>row({code:String(1000+i),name:'会社'+i}));
 const h=harness({[key]:snapshot(items)});h.window.KNDividendView.list(key);
 const more=h.panes[key].querySelector('.dividend-more');
 assert.equal((h.list(key).innerHTML.match(/class="div-item"/g)||[]).length,5);
 assert.equal((more.querySelector('.dividend-list').innerHTML.match(/class="div-item"/g)||[]).length,15);
 assert.equal(more.querySelector('summary').textContent,'もっと見る（残り15社）');
 assert.match(more.querySelector('.dividend-list').innerHTML,/div-rank">6</);
 more.open=true;more.ontoggle();assert.equal(more.querySelector('summary').textContent,'閉じる');
 await flush();await h.reply(h.request('/'+key+'?'),snapshot(items.map(it=>({...it,price:3000})),{updated_at:NOW/1000+1}));
 assert.equal(h.panes[key].querySelector('.dividend-more'),more);assert.equal(more.open,true);
 assert.equal(more.querySelector('summary').textContent,'閉じる');
});
test('five or fewer entries do not show a more control',()=>{
 const h=harness({top:snapshot(Array.from({length:5},(_,i)=>row({code:String(1000+i)})))});
 h.window.KNDividendView.list('top');assert.equal(h.panes.top.querySelector('.dividend-more').hidden,true);
});

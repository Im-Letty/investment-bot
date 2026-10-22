'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const stock=require('../static/stock-focus.js');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const source=html.match(/<script>\s*(\/\* knWatchSection v2[\s\S]*?)<\/script>/)[1];
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};

test('a held favorite defers new quote work until the interaction releases it',async()=>{
  const h=harness();await h.advance(2000);let held=true,deferred=0;
  h.w.KNWatchInteractions={isBusy:()=>held,deferRefresh(){deferred++;},decorate(){}};
  h.view(true);await flush();assert.equal(h.requests.length,0);assert.ok(deferred>0);
  held=false;h.w.__knRefreshWatch();await flush();assert.equal(h.requests.length,1);
});

test('an in-flight quote cannot replace the held row and the next refresh paints normally',async()=>{
  const h=harness();await h.advance(2000);h.view(true);await flush();
  let held=true,deferred=0;
  h.w.KNWatchInteractions={isBusy:()=>held,deferRefresh(){deferred++;},decorate(){}};
  const box=h.document.getElementById('knWatchList'),before=box.innerHTML;
  await h.respond(h.requests[0],{name:'Toyota',price:100,currency:'JPY'});
  assert.equal(box.innerHTML,before);assert.ok(deferred>0);
  held=false;h.w.__knRefreshWatch();await flush();
  assert.equal(h.requests.length,2);
  await h.respond(h.requests[1],{name:'Toyota',price:101,currency:'JPY'});
  assert.match(box.innerHTML,/101/);assert.match(box.innerHTML,/data-watch-remove="7203.T"/);
  assert.doesNotMatch(source,/textContent='お気に入りを管理'/);
});

function harness(symbols=['7203.T'],{shown=false,wrapperReady=true}={}){
  let now=100000,timerId=0,screenShown=true;
  const requests=[],timers=new Map(),listeners=new Map(),windowListeners=new Map(),observers=[];
  class Element{
    constructor(tag,id=''){this.tagName=tag.toUpperCase();this.id=id;this.children=[];this.dataset={};this.style={};this._html='';}
    set innerHTML(value){this._html=value;this.children.forEach(child=>{child.parentNode=null;});this.children=[];
      const list=value.match(/^<div id="knWatchList">([\s\S]*)<\/div>$/);
      if(list){const box=new Element('div','knWatchList');box.innerHTML=list[1];this.appendChild(box);}
      if(value.includes('id="knWatchAddBtn"'))this.appendChild(new Element('button','knWatchAddBtn'));
    }
    get innerHTML(){return this._html;}
    setAttribute(name,value){this[name]=String(value);}
    appendChild(child){if(child.parentNode)child.parentNode.children.splice(child.parentNode.children.indexOf(child),1);this.children.push(child);child.parentNode=this;return child;}
    get previousElementSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)-1]||null;}
    contains(child){return this===child||this.children.some(node=>node.contains(child));}
    insertAdjacentElement(position,child){assert.equal(position,'afterend');if(child.parentNode)child.parentNode.children.splice(child.parentNode.children.indexOf(child),1);this.parentNode.children.splice(this.parentNode.children.indexOf(this)+1,0,child);child.parentNode=this.parentNode;}
    getClientRects(){if(!screenShown)return [];for(let node=this;node;node=node.parentNode)if(node.style.display==='none'||node.hidden)return [];return [{}];}
  }
  const body=new Element('body'),main=new Element('main','morning-section'),grid=new Element('div','morning-idx-grid'),wrap=new Element('div','knTabWrap'),panels=new Element('div'),movers=new Element('div','homeMoversCard');
  body.appendChild(main);main.appendChild(grid);if(wrapperReady)main.appendChild(wrap);wrap.appendChild(panels);panels.appendChild(movers);wrap.dataset.stockMain=shown?'favorites':'stock';
  const find=(node,id)=>node.id===id?node:node.children.map(child=>find(child,id)).find(Boolean);
  const storage=new Map([['alert_watchlist_v1',JSON.stringify(symbols)]]);
  function listen(map,type,callback){const callbacks=map.get(type)||[];callbacks.push(callback);map.set(type,callbacks);}
  function dispatch(map,event){for(const callback of map.get(event.type)||[])callback(event);}
  const document={readyState:'complete',hidden:false,body,createElement:tag=>new Element(tag),getElementById:id=>find(body,id)||null,addEventListener:(type,callback)=>listen(listeners,type,callback)};
  class Observer{constructor(callback){this.callback=callback;this.targets=[];observers.push(this);}observe(target){this.targets.push(target);}}
  const w={document,__KN_HOME_A:true,StockFocus:stock,KNMarketData:require('../static/market-data.js'),renderMorningGrid(){},dispatchEvent:event=>dispatch(windowListeners,event),addEventListener:(type,callback)=>listen(windowListeners,type,callback)};
  class ClockDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const context={window:w,document,MutationObserver:Observer,Event:class{constructor(type){this.type=type;}},Date:ClockDate,AbortController,localStorage:{getItem:key=>storage.get(key)||null},setTimeout(callback,ms){const id=++timerId;timers.set(id,{callback,ms,at:now+ms});return id;},clearTimeout:id=>timers.delete(id),fetch(url,options){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});requests.push({url,options,resolve,reject});return promise;}};
  vm.runInNewContext(source,context);
  function notify(){for(const observer of observers)observer.callback();}
  function view(shown){wrap.dataset.stockMain=shown?'favorites':'stock';const section=document.getElementById('knWatchSec');if(section)section.style.display=shown?'':'none';dispatch(listeners,{type:'knStockViewChanged'});notify();}
  function placeCurrentSection(){const section=document.getElementById('knWatchSec');if(section)panels.appendChild(section);}
  return {w,document,storage,requests,timers,wrap,notify,view,
    prepareWrapper(){main.appendChild(wrap);placeCurrentSection();notify();},
    async advance(ms){const deadline=now+ms;while(true){const next=[...timers].filter(([,timer])=>timer.at<=deadline).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].callback();await flush();}now=deadline;},
    async respond(request,quote,ok=true){request.resolve({ok,json:async()=>quote});await flush();},
    screen(shown){screenShown=shown;main.style.display=shown?'':'none';notify();},
    visibility(hidden){document.hidden=hidden;dispatch(listeners,{type:'visibilitychange'});},
    saveSelection(list){storage.set('alert_watchlist_v1',JSON.stringify(list));dispatch(windowListeners,{type:'storage',key:'alert_watchlist_v1'});},
    watchlist(list){storage.set('alert_watchlist_v1',JSON.stringify(list));dispatch(windowListeners,{type:'kn:watchlist-change'});},
    online(){dispatch(windowListeners,{type:'online'});}
  };
}

test('twenty saved favorites make no quote requests or polling while the startup ranking is shown',async()=>{
  const selected=Array.from({length:20},(_,i)=>String(1000+i)+'.T'),h=harness(selected);
  await h.advance(130000);
  h.w.renderMorningGrid();h.w.__knRefreshWatch();h.online();h.notify();await flush();
  assert.equal(h.requests.length,0);
  assert.equal([...h.timers.values()].filter(timer=>timer.ms===60000).length,0);
  assert.equal(h.storage.get('alert_watchlist_v1'),JSON.stringify(selected));
  assert.equal(h.document.getElementById('knWatchSec').style.display,'none');
});

test('first favorites visit starts the saved company quotes immediately without a second startup wait',async()=>{
  const h=harness(['7203.T','AAPL']);await h.advance(2000);assert.equal(h.requests.length,0);
  h.view(true);await flush();assert.equal(h.requests.length,2);
  assert.ok(h.requests.every(request=>!request.url.includes('light=1')));
  await h.respond(h.requests[0],{name:'Toyota',price:100,currency:'JPY'});
  await h.respond(h.requests[1],{name:'Apple',price:200,currency:'USD'});
  assert.match(h.document.getElementById('knWatchList').innerHTML,/Toyota/);
  h.notify();h.view(true);await flush();assert.equal(h.requests.length,2);
});

test('startup rows before the stock-tab wrapper is built are not mistaken for a favorites visit',async()=>{
  const h=harness(['7203.T'],{wrapperReady:false});await h.advance(2000);
  assert.ok(h.document.getElementById('knWatchSec').getClientRects().length);
  assert.equal(h.requests.length,0);
  h.prepareWrapper();h.w.renderMorningGrid();await flush();assert.equal(h.requests.length,0);
  h.view(true);await flush();assert.equal(h.requests.length,1);
});

test('hiding favorites cancels polling, and reopening keeps good values while immediately checking light prices',async()=>{
  const h=harness();await h.advance(2000);h.view(true);await flush();
  await h.respond(h.requests[0],{name:'Toyota',price:100,currency:'JPY'});
  const box=h.document.getElementById('knWatchList'),saved=box.innerHTML;
  h.view(false);await h.advance(180000);assert.equal(h.requests.length,1);
  h.view(true);await flush();assert.equal(h.requests.length,2);assert.match(h.requests[1].url,/light=1/);
  assert.equal(box.innerHTML,saved);
  await h.respond(h.requests[1],{name:'7203.T',price:101,currency:'JPY'});
  assert.match(box.innerHTML,/Toyota/);assert.match(box.innerHTML,/101/);
});

test('navigation before a queued quote starts postpones the request rather than showing an acquisition failure',async()=>{
  const h=harness();await h.advance(2000);h.view(true);h.view(false);await flush();
  assert.equal(h.requests.length,0);
  assert.doesNotMatch(h.document.getElementById('knWatchList').innerHTML,/株価を確認できませんでした/);
  await h.advance(60000);assert.equal(h.requests.length,0);
  h.view(true);await flush();assert.equal(h.requests.length,1);
});

test('reopening during a postponed batch resumes it immediately rather than waiting for the next minute',async()=>{
  const h=harness();await h.advance(2000);h.view(true);h.view(false);
  await Promise.resolve(); // The queued send sees hidden; the whole batch is not settled yet.
  h.view(true);await flush();assert.equal(h.requests.length,1);
  assert.ok(!h.requests[0].url.includes('light=1'));
  assert.doesNotMatch(h.document.getElementById('knWatchList').innerHTML,/株価を確認できませんでした/);
});

test('a late callback from a canceled minute timer cannot fetch in another stock tab',async()=>{
  const h=harness();await h.advance(2000);h.view(true);await flush();
  await h.respond(h.requests[0],{name:'Toyota',price:100,currency:'JPY'});
  const timer=[...h.timers.values()].find(timer=>timer.ms===60000);assert.ok(timer);
  h.view(false);timer.callback();await flush();assert.equal(h.requests.length,1);
  await h.advance(120000);assert.equal(h.requests.length,1);
});

test('an already issued quote may finish while hidden but cannot arm another hidden refresh',async()=>{
  const h=harness();await h.advance(2000);h.view(true);await flush();assert.equal(h.requests.length,1);
  h.view(false);await h.respond(h.requests[0],{name:'Toyota',price:100,currency:'JPY'});
  await h.advance(180000);assert.equal(h.requests.length,1);
  h.view(true);await flush();assert.equal(h.requests.length,2);assert.match(h.requests[1].url,/light=1/);
  assert.match(h.document.getElementById('knWatchList').innerHTML,/Toyota/);
});

test('whole-screen navigation pauses even when the favorites tab remains selected and observers resume it',async()=>{
  const h=harness();await h.advance(2000);h.view(true);await flush();
  await h.respond(h.requests[0],{name:'Toyota',price:100,currency:'JPY'});
  h.screen(false);await h.advance(120000);assert.equal(h.requests.length,1);
  assert.equal(h.wrap.dataset.stockMain,'favorites');
  h.screen(true);await flush();assert.equal(h.requests.length,2);
  h.visibility(true);await h.respond(h.requests[1],{price:101,currency:'JPY'});
  await h.advance(120000);assert.equal(h.requests.length,2);
  h.visibility(false);await flush();assert.equal(h.requests.length,3);
});

test('favorite edits while hidden preserve the saved selection and only request the current companies on return',async()=>{
  const h=harness(['OLD.T']);await h.advance(2000);
  h.saveSelection(['NEW.T']);h.watchlist(['NEW.T','1738.JP']);await flush();
  assert.equal(h.requests.length,0);
  h.view(true);await flush();assert.equal(h.requests.length,1);assert.match(h.requests[0].url,/NEW/);
  await h.respond(h.requests[0],{name:'New company',price:222,currency:'JPY'});
  const text=h.document.getElementById('knWatchList').innerHTML;
  assert.match(text,/New company/);assert.match(text,/1738\.JP/);assert.doesNotMatch(text,/OLD\.T/);
  assert.equal(h.storage.get('alert_watchlist_v1'),'["NEW.T","1738.JP"]');
});

test('visible favorites keep the one-minute cycle and reuse an active request across navigation events',async()=>{
  const h=harness();await h.advance(2000);h.view(true);await flush();
  await h.respond(h.requests[0],{name:'Toyota',price:100,currency:'JPY'});
  await h.advance(59999);assert.equal(h.requests.length,1);
  await h.advance(1);assert.equal(h.requests.length,2);assert.match(h.requests[1].url,/light=1/);
  h.online();h.w.__knRefreshWatch();h.notify();await flush();assert.equal(h.requests.length,2);
  await h.respond(h.requests[1],{price:101,currency:'JPY'});
  await h.advance(60000);assert.equal(h.requests.length,3);
});

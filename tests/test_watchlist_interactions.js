'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const interactions=require('../static/watchlist-interactions.js');
const watch=require('../static/stock-watch.js');
const KEY='alert_watchlist_v1';
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};

// A delegated-event DOM: events really visit document capture, the target and
// document bubble. Geometry follows the current row order rather than a fixed
// symbol order, so previews and the durable store can be compared independently.
function harness(symbols=['7203.T','6758.T','AAPL']){
  const timers=new Map(),frames=new Map(),observers=[],writes=[],captureLosses=[],storage=new Map([[KEY,JSON.stringify(symbols)]]);
  let now=0,nextId=0,failNext=false,holdPersist=null,refreshCalls=0,rendered=0,companyOpens=0,api;
  class Target{
    constructor(){this.listeners=new Map();}
    addEventListener(type,callback,options){const list=this.listeners.get(type)||[];list.push({callback,capture:options===true||!!(options&&options.capture),options});this.listeners.set(type,list);}
    removeEventListener(type,callback,options){const capture=options===true||!!(options&&options.capture);this.listeners.set(type,(this.listeners.get(type)||[]).filter(item=>item.callback!==callback||item.capture!==capture));}
  }
  class Element extends Target{
    constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes=new Map();this.style={};this.className='';this.id='';this.textContent='';this.disabled=false;this.hidden=false;this.scrollTop=0;this.scrollHeight=700;this.clientHeight=700;}
    get parentElement(){return this.parentNode||null;}
    get isConnected(){return doc.body.contains(this);}
    get nextElementSibling(){const list=this.parentNode&&this.parentNode.children;return list?list[list.indexOf(this)+1]||null:null;}
    setAttribute(key,value){value=String(value);this.attributes.set(key,value);if(key==='id')this.id=value;else if(key==='class')this.className=value;else if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;}
    getAttribute(key){if(key==='id')return this.id||null;if(key==='class')return this.className||null;if(key.startsWith('data-'))return this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]??null;return this.attributes.get(key)??null;}
    removeAttribute(key){this.attributes.delete(key);if(key.startsWith('data-'))delete this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())];}
    contains(node){return this===node||this.children.some(child=>child.contains(node));}
    appendChild(node){return this.insertBefore(node,null);}
    insertBefore(node,before){if(node===before)return node;const reparenting=!!node.parentNode;if(node.parentNode)node.parentNode.children.splice(node.parentNode.children.indexOf(node),1);const index=before===null?this.children.length:this.children.indexOf(before);assert.ok(index>=0,'the insertion anchor belongs to its parent');this.children.splice(index,0,node);node.parentNode=this;
      // Native DOM insertion removes and reinserts the dragged row. A pointer
      // captured by that row (or its child) is then lost; capture on a stationary
      // ancestor survives. This reproduces the real-browser preview regression.
      if(reparenting)for(const holder of [node,...node.querySelectorAll('*')])if(holder.capture!==undefined&&holder.capture!==null)holder.releasePointerCapture(holder.capture);
      return node;}
    remove(){if(this.contains(doc.activeElement))doc.activeElement=doc.body;if(this.parentNode)this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}
    matches(selector){return selector.split(',').some(part=>{part=part.trim();if(part==='*')return true;if(part.startsWith('.'))return this.className.split(/\s+/).includes(part.slice(1));if(part.startsWith('#'))return this.id===part.slice(1);const attr=part.match(/^\[([^=\]]+)(?:=['"]?([^'"]+)['"]?)?\]$/);if(attr)return this.getAttribute(attr[1])!==null&&(attr[2]===undefined||this.getAttribute(attr[1])===attr[2]);return this.tagName.toLowerCase()===part;});}
    closest(selector){for(let node=this;node;node=node.parentNode)if(node.matches(selector))return node;return null;}
    querySelectorAll(selector){return this.children.flatMap(node=>[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]);}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    getClientRects(){for(let node=this;node;node=node.parentNode)if(node.hidden||node.style.display==='none')return [];return this.isConnected?[this.getBoundingClientRect()]:[];}
    getBoundingClientRect(){if(this.dataset.watchSymbol){const index=box.children.filter(row=>row.dataset.watchSymbol).indexOf(this);return {left:0,right:400,top:100+100*index,bottom:200+100*index,height:100,width:400};}return {left:0,right:400,top:80,bottom:420,height:340,width:400};}
    focus(){doc.activeElement=this;}
    setPointerCapture(id){this.capture=id;}
    releasePointerCapture(id){if(this.capture===id){this.capture=null;captureLosses.push({holder:this,pointerId:id});event(this,'lostpointercapture',{pointerId:id});}}
  }
  const doc=new Target();doc.hidden=false;doc.activeElement=null;doc.createElement=tag=>new Element(tag);doc.body=new Element('body');doc.scrollingElement=doc.body;
  const wrap=new Element('div');wrap.id='knTabWrap';wrap.dataset.stockMain='favorites';doc.body.appendChild(wrap);
  const section=new Element('section');section.id='knWatchSec';wrap.appendChild(section);
  const box=new Element('div');box.id='knWatchList';section.appendChild(box);
  doc.getElementById=id=>{if(doc.body.id===id)return doc.body;return doc.body.querySelector('#'+id);};
  const w=new Target();Object.assign(w,{document:doc,StockWatch:watch,innerHeight:700,localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value))},__knGateReady:Promise.resolve(),setTimeout(callback,ms){const id=++nextId;timers.set(id,{callback,at:now+ms});return id;},clearTimeout:id=>timers.delete(id),requestAnimationFrame(callback){const id=++nextId;frames.set(id,callback);return id;},cancelAnimationFrame:id=>frames.delete(id),getComputedStyle:()=>({overflowY:'visible'}),MutationObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}}});
  w.__knPersistLocalSetting=async(key,value)=>{writes.push({key,value});if(holdPersist){const pending=holdPersist;holdPersist=null;await pending.promise;}if(failNext){failNext=false;throw new Error('test persistence failure');}storage.set(key,value);};
  function paint(){
    for(const child of [...box.children])child.remove();
    const current=JSON.parse(storage.get(KEY));
    for(const symbol of current){
      const row=new Element('div');row.className='sf-watch-row';row.dataset.watchSymbol=symbol;row.setAttribute('tabindex','0');
      const content=new Element('div');content.className='sf-watch-content';const company=new Element('button');company.className='cp-company-link';company.addEventListener('click',()=>companyOpens++);content.appendChild(company);row.appendChild(content);
      const heart=new Element('button');heart.dataset.watchRemove=symbol;row.appendChild(heart);box.appendChild(row);
    }
    const oldAdd=doc.getElementById('knWatchAddBtn');if(oldAdd)oldAdd.remove();if(!current.length){const add=new Element('button');add.id='knWatchAddBtn';section.appendChild(add);}
    rendered++;if(api)api.decorate();
  }
  w.__knRefreshWatch=()=>{refreshCalls++;if(api&&api.isBusy()){api.deferRefresh();return Promise.resolve();}paint();return Promise.resolve();};
  paint();api=interactions.create(w);
  function event(target,type,values={}){
    const e={type,target,button:0,isPrimary:true,pointerId:7,pointerType:'mouse',clientX:100,clientY:150,detail:1,cancelable:true,defaultPrevented:false,stopped:false,immediate:false,preventDefault(){if(this.cancelable)this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.stopped=this.immediate=true;},...values};
    const path=[];for(let node=target;node;node=node.parentNode)path.push(node);if(!path.includes(doc)&&target!==w)path.push(doc);
    for(const node of [...path].reverse()){for(const item of node.listeners.get(type)||[])if(item.capture){item.callback(e);if(e.immediate)break;}if(e.stopped)return e;}
    for(const node of path){for(const item of node.listeners.get(type)||[])if(!item.capture){item.callback(e);if(e.immediate)break;}if(e.stopped)break;}
    return e;
  }
  const row=key=>box.children.find(item=>item.dataset.watchSymbol===key),heart=key=>row(key).querySelector('[data-watch-remove]'),company=key=>row(key).querySelector('.cp-company-link');
  function touch(target,type,x=100,y=150,extra={}){const t={identifier:19,clientX:x,clientY:y};return event(target,type,{touches:type==='touchend'||type==='touchcancel'?[]:[t],changedTouches:[t],...extra});}
  return {api,w,doc,section,box,wrap,row,heart,company,event,touch,writes,timers,frames,storage,captureLosses,
    get order(){return box.children.filter(item=>item.dataset.watchSymbol).map(item=>item.dataset.watchSymbol);},get saved(){return JSON.parse(storage.get(KEY));},get refreshCalls(){return refreshCalls;},get rendered(){return rendered;},get companyOpens(){return companyOpens;},
    status(){return doc.getElementById('knWatchActionStatus').textContent;},
    async advance(ms){const until=now+ms;while(true){const next=[...timers].filter(([,timer])=>timer.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].callback();await flush();}now=until;},
    failNext(){failNext=true;},blockNext(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});holdPersist={promise};return {resolve,reject};},notify(){for(const observer of observers)if(!observer.disconnected)observer.callback();},
    hide(){wrap.dataset.stockMain='stock';event(doc,'knStockViewChanged');},
    refresh(){return w.__knRefreshWatch();}
  };
}

test('a quick company tap keeps its ordinary action and never writes order',async()=>{
  const h=harness(),target=h.company('7203.T');h.event(target,'pointerdown');await h.advance(interactions.HOLD_MS-1);h.event(target,'pointerup');const click=h.event(target,'click');await flush();
  assert.equal(click.defaultPrevented,false);assert.equal(h.companyOpens,1);assert.equal(h.writes.length,0);assert.equal(h.api.isBusy(),false);
});

test('a swipe before activation and normal scrolling cancel a hold without preventing scroll',async()=>{
  for(const mode of ['move','scroll']){
    const h=harness(),target=h.row('7203.T');h.event(target,'pointerdown');
    if(mode==='move'){const move=h.event(target,'pointermove',{clientY:150+interactions.MOVE_TOLERANCE+1});assert.equal(move.defaultPrevented,false);}else h.event(h.doc,'scroll');
    await h.advance(interactions.HOLD_MS+10);h.event(target,'pointerup');await flush();assert.equal(h.api.isBusy(),false,mode);assert.equal(h.writes.length,0,mode);assert.equal(target.getAttribute('data-watch-reordering'),null,mode);
  }
});

test('a stationary hold followed by drag and drop saves the displayed order once',async()=>{
  const h=harness(),target=h.row('7203.T');h.event(target,'pointerdown');await h.advance(interactions.HOLD_MS);assert.equal(target.getAttribute('data-watch-dragging'),'true');
  const move=h.event(target,'pointermove',{clientY:390});assert.equal(move.defaultPrevented,true);assert.deepEqual(h.order,['6758.T','AAPL','7203.T']);
  h.event(target,'pointerup',{clientY:390});await flush();assert.deepEqual(h.saved,['6758.T','AAPL','7203.T']);assert.deepEqual(h.order,h.saved);assert.equal(h.writes.filter(item=>item.key===KEY).length,1);assert.match(h.status(),/保存しました/);assert.equal(h.api.isBusy(),false);
});

test('touch scroll is allowed before a hold and touch movement is prevented only after activation',async()=>{
  const h=harness(),target=h.row('7203.T');h.touch(target,'touchstart');const still=h.touch(target,'touchmove',101,151);assert.equal(still.defaultPrevented,false);
  await h.advance(interactions.HOLD_MS);const move=h.touch(target,'touchmove',100,390);assert.equal(move.defaultPrevented,true);h.touch(target,'touchend',100,390);await flush();assert.deepEqual(h.saved,['6758.T','AAPL','7203.T']);
  const listeners=h.doc.listeners.get('touchmove');assert.ok(listeners.some(item=>item.options&&item.options.passive===false));
});

test('touch pointer cancellation does not cancel the independently tracked native touch gesture',async()=>{
  const h=harness(),target=h.row('7203.T');h.event(target,'pointerdown',{pointerType:'touch'});h.touch(target,'touchstart');await h.advance(interactions.HOLD_MS);h.event(target,'pointercancel',{pointerType:'touch'});
  assert.equal(h.api.isBusy(),true);h.touch(target,'touchmove',100,390);h.touch(target,'touchend',100,390);await flush();assert.deepEqual(h.saved,['6758.T','AAPL','7203.T']);
});

test('the compatibility click after a drag cannot remove a favorite or open its company',async()=>{
  for(const finalTarget of ['heart','company']){
    const h=harness(),target=h.row('7203.T');h.event(target,'pointerdown');await h.advance(interactions.HOLD_MS);h.event(target,'pointermove',{clientY:390});h.event(target,'pointerup',{clientY:390});await flush();
    const click=h.event(h[finalTarget]('7203.T'),'click');await flush();assert.equal(click.defaultPrevented,true,finalTarget);assert.equal(click.immediate,true,finalTarget);assert.deepEqual(h.saved,['6758.T','AAPL','7203.T'],finalTarget);assert.equal(h.companyOpens,0,finalTarget);assert.equal(h.writes.length,1,finalTarget);
  }
});

test('a new deliberate heart tap after a drag can remove normally',async()=>{
  const h=harness(),target=h.row('7203.T');h.event(target,'pointerdown');await h.advance(interactions.HOLD_MS);h.event(target,'pointermove',{clientY:390});h.event(target,'pointerup',{clientY:390});await flush();
  const heart=h.heart('7203.T');h.event(heart,'pointerdown');h.event(heart,'pointerup');h.event(heart,'click');await flush();assert.deepEqual(h.saved,['6758.T','AAPL']);assert.match(h.status(),/外しました/);
});

test('failed order persistence restores the canonical order and never announces success',async()=>{
  const h=harness(),target=h.row('7203.T');h.failNext();h.event(target,'pointerdown');await h.advance(interactions.HOLD_MS);h.event(target,'pointermove',{clientY:390});h.event(target,'pointerup',{clientY:390});await flush();
  assert.deepEqual(h.saved,['7203.T','6758.T','AAPL']);assert.deepEqual(h.order,h.saved);assert.match(h.status(),/保存できません/);assert.doesNotMatch(h.status(),/保存しました/);assert.equal(h.api.isBusy(),false);
});

test('a failed heart removal keeps the favorite and makes the heart usable again',async()=>{
  const h=harness(),heart=h.heart('6758.T');h.failNext();h.event(heart,'click');await flush();assert.deepEqual(h.saved,['7203.T','6758.T','AAPL']);assert.deepEqual(h.order,h.saved);assert.equal(heart.disabled,false);assert.match(h.status(),/解除できません/);assert.equal(h.api.isBusy(),false);
});

test('a successful removal restores focus to the next heart, and the final removal focuses Add',async()=>{
  const h=harness();h.event(h.heart('6758.T'),'click');await flush();assert.deepEqual(h.saved,['7203.T','AAPL']);assert.equal(h.doc.activeElement,h.heart('AAPL'));
  const last=harness(['7203.T']);last.event(last.heart('7203.T'),'click');await flush();assert.deepEqual(last.saved,[]);assert.equal(last.doc.activeElement,last.doc.getElementById('knWatchAddBtn'));assert.match(last.status(),/外しました/);
});

test('keyboard Alt+arrows reorder without a permanent management action',async()=>{
  const h=harness(),target=h.row('6758.T');const up=h.event(target,'keydown',{altKey:true,key:'ArrowUp'});assert.equal(up.defaultPrevented,true);await flush();assert.deepEqual(h.saved,['6758.T','7203.T','AAPL']);
  const down=h.event(h.row('6758.T'),'keydown',{altKey:true,key:'ArrowDown'});assert.equal(down.defaultPrevented,true);await flush();assert.deepEqual(h.saved,['7203.T','6758.T','AAPL']);assert.equal(h.section.textContent.includes('お気に入りを管理'),false);
});

test('hold release keeps temporary step buttons, which save in order and Done exits',async()=>{
  const h=harness(),target=h.row('6758.T');h.event(target,'pointerdown',{clientY:250});await h.advance(interactions.HOLD_MS);h.event(target,'pointerup',{clientY:250});
  assert.equal(h.writes.length,0);assert.equal(h.api.isBusy(),true);const up=target.querySelectorAll('[data-watch-move]').find(button=>button.dataset.watchMove==='up');h.event(up,'pointerdown');h.event(up,'pointerup');h.event(up,'click');await flush();
  assert.deepEqual(h.saved,['6758.T','7203.T','AAPL']);assert.equal(h.api.isBusy(),true);const done=h.row('6758.T').querySelectorAll('[data-watch-move]').find(button=>button.dataset.watchMove==='done');h.event(done,'pointerdown');h.event(done,'pointerup');h.event(done,'click');await flush();assert.equal(h.api.isBusy(),false);assert.equal(h.section.querySelector('.sf-watch-move-controls'),null);
});

test('screen hiding, a second touch, blur and row replacement cancel without saving',async()=>{
  for(const mode of ['hide','second touch','blur','replacement']){
    const h=harness(),target=h.row('7203.T');h.touch(target,'touchstart');await h.advance(interactions.HOLD_MS);h.touch(target,'touchmove',100,390);
    if(mode==='hide')h.hide();else if(mode==='second touch')h.touch(target,'touchstart',100,390,{touches:[{identifier:19,clientX:100,clientY:390},{identifier:20,clientX:130,clientY:390}]});else if(mode==='blur')h.event(h.w,'blur');else{target.remove();h.notify();}
    h.touch(target,'touchend',100,390);await flush();assert.equal(h.writes.length,0,mode);assert.equal(h.api.isBusy(),false,mode);assert.equal(h.section.querySelector('.sf-watch-move-controls'),null,mode);
  }
});

test('refresh deferred during an active drag runs after the saved drop',async()=>{
  const h=harness(),target=h.row('7203.T');h.event(target,'pointerdown');await h.advance(interactions.HOLD_MS);const rendered=h.rendered;await h.refresh();assert.equal(h.rendered,rendered);h.event(target,'pointermove',{clientY:390});h.event(target,'pointerup',{clientY:390});await flush();assert.equal(h.rendered,rendered+1);assert.deepEqual(h.saved,h.order);
});

test('refresh deferred during a pending hold is flushed when ordinary movement or scrolling cancels it',async()=>{
  for(const mode of ['move','scroll']){
    const h=harness(),target=h.row('7203.T');h.event(target,'pointerdown');const rendered=h.rendered;await h.refresh();assert.equal(h.rendered,rendered);
    if(mode==='move')h.event(target,'pointermove',{clientY:190});else h.event(h.doc,'scroll');await flush();assert.equal(h.api.isBusy(),false,mode);assert.equal(h.rendered,rendered+1,mode);assert.equal(h.writes.length,0,mode);
  }
});

test('a failed removal flushes a refresh that arrived while persistence was pending',async()=>{
  const h=harness(),pending=h.blockNext(),heart=h.heart('7203.T');h.event(heart,'click');await flush();const rendered=h.rendered;await h.refresh();assert.equal(h.rendered,rendered);pending.reject(new Error('storage refused'));await flush();assert.equal(h.api.isBusy(),false);assert.equal(h.rendered,rendered+1);assert.match(h.status(),/解除できません/);assert.deepEqual(h.saved,['7203.T','6758.T','AAPL']);
});

test('a final release outside the section cancels even without a final move event',async()=>{
  for(const kind of ['pointer','touch']){
    const h=harness(),target=h.row('7203.T');
    if(kind==='pointer'){h.event(target,'pointerdown');await h.advance(interactions.HOLD_MS);h.event(target,'pointermove',{clientY:390});h.event(target,'pointerup',{clientX:900,clientY:900});}
    else{h.touch(target,'touchstart');await h.advance(interactions.HOLD_MS);h.touch(target,'touchmove',100,390);h.touch(target,'touchend',900,900);}
    await flush();assert.equal(h.writes.length,0,kind);assert.deepEqual(h.saved,['7203.T','6758.T','AAPL'],kind);assert.deepEqual(h.order,h.saved,kind);assert.equal(h.api.isBusy(),false,kind);
  }
});

test('cancel and destroy discard previews, clear timers, and remove every listener',async()=>{
  const h=harness(),target=h.row('7203.T');h.event(target,'pointerdown');await h.advance(interactions.HOLD_MS);h.event(target,'pointermove',{clientY:390});h.api.destroy();await flush();assert.deepEqual(h.order,h.saved);assert.equal(h.writes.length,0);assert.equal(h.timers.size,0);assert.equal(h.frames.size,0);assert.equal([...h.doc.listeners.values()].flat().length,0);assert.equal([...h.w.listeners.values()].flat().length,0);
});

test('after a stationary hold, another short drag on that row moves without another hold',async()=>{
  const h=harness(),target=h.row('7203.T');h.touch(target,'touchstart');await h.advance(interactions.HOLD_MS);h.touch(target,'touchend');assert.equal(h.api.isBusy(),true);
  h.touch(target,'touchstart');const move=h.touch(target,'touchmove',100,390);assert.equal(move.defaultPrevented,true);h.touch(target,'touchend',100,390);await flush();assert.deepEqual(h.saved,['6758.T','AAPL','7203.T']);assert.equal(h.writes.length,1);
});

test('non-primary buttons and invalid coordinates never activate or write, and an unrelated release is ignored',async()=>{
  for(const values of [{button:2},{isPrimary:false},{clientX:NaN},{clientY:Infinity}]){
    const h=harness(),target=h.row('7203.T');h.event(target,'pointerdown',values);await h.advance(interactions.HOLD_MS);h.event(target,'pointerup');await flush();assert.equal(h.api.isBusy(),false);assert.equal(h.writes.length,0);
  }
  const h=harness(),target=h.row('7203.T');h.event(target,'pointerdown');await h.advance(interactions.HOLD_MS);h.event(target,'pointermove',{pointerId:99,clientY:390});h.event(target,'pointerup',{pointerId:99,clientY:390});assert.equal(h.api.isBusy(),true);assert.deepEqual(h.order,h.saved);h.event(target,'pointercancel');await flush();assert.equal(h.api.isBusy(),false);assert.equal(h.writes.length,0);
});

test('a missing source at drop cannot restore an externally removed favorite',async()=>{
  const h=harness(),target=h.row('7203.T');h.event(target,'pointerdown');await h.advance(interactions.HOLD_MS);h.event(target,'pointermove',{clientY:390});h.storage.set(KEY,JSON.stringify(['6758.T','AAPL']));h.event(target,'pointerup',{clientY:390});await flush();assert.deepEqual(h.saved,['6758.T','AAPL']);assert.deepEqual(h.order,h.saved);assert.equal(h.writes.length,0);assert.match(h.status(),/やり直してください/);
});

test('pending step persistence blocks repeated moves and hearts until the outcome is known',async()=>{
  const h=harness(),target=h.row('6758.T');h.event(target,'keydown',{key:'Enter'});const up=target.querySelectorAll('[data-watch-move]').find(button=>button.dataset.watchMove==='up'),pending=h.blockNext();h.event(up,'click',{detail:0});await flush();
  assert.equal(h.api.isBusy(),true);assert.ok(h.box.querySelectorAll('[data-watch-remove]').every(heart=>heart.disabled));assert.ok(target.querySelectorAll('[data-watch-move]').every(button=>button.disabled));h.event(target,'keydown',{altKey:true,key:'ArrowUp'});await flush();assert.equal(h.writes.length,1);pending.resolve();await flush();assert.deepEqual(h.saved,['6758.T','7203.T','AAPL']);
  h.event(target,'keydown',{key:'Escape'});await flush();assert.equal(h.api.isBusy(),false);
});

test('keyboard sorting preserves focus on the same company row after the list refreshes',async()=>{
  const h=harness(),target=h.row('6758.T');target.focus();h.event(target,'keydown',{altKey:true,key:'ArrowUp'});await flush();assert.deepEqual(h.saved,['6758.T','7203.T','AAPL']);assert.ok(h.doc.activeElement===h.row('6758.T'),'focus stays with the sorted company so the next arrow works');
});

test('a user who moves focus elsewhere during order persistence keeps that new focus',async()=>{
  const h=harness(),target=h.row('6758.T'),outside=h.doc.createElement('input'),pending=h.blockNext();h.doc.body.appendChild(outside);target.focus();h.event(target,'keydown',{altKey:true,key:'ArrowUp'});await flush();outside.focus();pending.resolve();await flush();assert.deepEqual(h.saved,['6758.T','7203.T','AAPL']);assert.ok(h.doc.activeElement===outside,'completion never steals focus from another active control');
});

test('keyboard sorting from a heart preserves the matching heart after refreshed rows replace it',async()=>{
  const h=harness(),target=h.heart('6758.T');target.focus();h.event(target,'keydown',{altKey:true,key:'ArrowUp'});await flush();assert.deepEqual(h.saved,['6758.T','7203.T','AAPL']);assert.ok(h.doc.activeElement===h.heart('6758.T'),'the replacement heart keeps the original keyboard position');
});

test('the actual release position determines the destination even when the last move had another anchor',async()=>{
  for(const kind of ['pointer','touch']){
    const h=harness(),target=h.row('7203.T');
    if(kind==='pointer'){h.event(target,'pointerdown');await h.advance(interactions.HOLD_MS);h.event(target,'pointermove',{clientY:390});h.event(target,'pointerup',{clientY:240});}
    else{h.touch(target,'touchstart');await h.advance(interactions.HOLD_MS);h.touch(target,'touchmove',100,390);h.touch(target,'touchend',100,240);}
    await flush();assert.deepEqual(h.saved,['6758.T','7203.T','AAPL'],kind);assert.deepEqual(h.order,h.saved,kind);assert.equal(h.writes.length,1,kind);
  }
});

test('native capture loss on reparenting a captured element is reproduced by the event harness',()=>{
  const h=harness(),target=h.row('7203.T');let losses=0;target.addEventListener('lostpointercapture',()=>losses++);target.setPointerCapture(88);h.box.appendChild(target);assert.equal(losses,1);assert.equal(target.capture,null);assert.equal(h.captureLosses.length,1);
});

test('drag previews can reparent the row without losing capture and canceling the intended drop',async()=>{
  const h=harness(),target=h.row('7203.T');h.event(target,'pointerdown');await h.advance(interactions.HOLD_MS);h.event(target,'pointermove',{clientY:390});
  assert.deepEqual(h.order,['6758.T','AAPL','7203.T']);assert.equal(h.captureLosses.length,0,'moving the row cannot prematurely release its gesture capture');assert.equal(target.getAttribute('data-watch-dragging'),'true');h.event(target,'pointerup',{clientY:390});await flush();assert.deepEqual(h.saved,['6758.T','AAPL','7203.T']);assert.equal(h.writes.length,1);assert.equal(h.api.isBusy(),false);assert.equal(h.captureLosses.length,1,'the deliberate release still delivers native lostpointercapture safely');
});

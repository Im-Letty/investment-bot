'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const factory=require('../static/mypage-view-picker.js');
const loader=fs.readFileSync(path.join(__dirname,'../static/mypage-ledger-loader.js'),'utf8');
const theme=fs.readFileSync(path.join(__dirname,'../static/mypage-theme.js'),'utf8');
const routes=[...loader.matchAll(/(?:personal|ledger)\.addEventListener\('click',(function\(\)\{show\([01]\);\})\)/g)].map(m=>m[1]);
assert.equal(routes.length,2,'exercise the actual two existing tab handlers');
function fixture({late=false}={}){
 let doc,owner='A';
 const observers=[],timers=[],routesCalled=[],frame={id:'one existing frame',pending:'pending restore',draft:'unsaved amount',selected:'assets'},scroll={personal:150,ledger:42};
 class Node{
  constructor(tag){
   this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attrs={};this.events={};this.hidden=false;this.inert=false;this.disabled=false;this._text='';this.className='';
   this.classList={contains:name=>this.className.split(' ').includes(name),toggle:(name,force)=>{
    const on=force===undefined?!this.classList.contains(name):force;
    this.className=this.className.split(' ').filter(v=>v&&v!==name).concat(on?[name]:[]).join(' ');return on;
   }};
  }
  get id(){return this.attrs.id||'';}set id(v){this.attrs.id=v;}
  set textContent(s){this._text=String(s);this.children=[];}get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
  appendChild(n){this.children.push(n);n.parentNode=this;return n;}
  setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}
  matches(sel){return sel[0]==='.'?this.classList.contains(sel.slice(1)):sel[0]==='#'?this.id===sel.slice(1):this.tagName.toLowerCase()===sel;}
  querySelectorAll(sel){let result=[];const choices=sel.split(',');const walk=n=>n.children.forEach(c=>{if(choices.some(s=>c.matches(s)))result.push(c);walk(c);});walk(this);return result;}
  querySelector(sel){return this.querySelectorAll(sel)[0]||null;}
  closest(sel){for(let n=this;n;n=n.parentNode)if(n.matches(sel))return n;return null;}
  addEventListener(type,fn){(this.events[type]??=[]).push(fn);}
  click(){(this.events.click||[]).forEach(fn=>fn({target:this}));}
  focus(options){doc.activeElement=this;this.lastFocus=options;}
 }
 doc={body:new Node('body'),documentElement:new Node('html'),activeElement:null,createElement:t=>new Node(t),getElementById:id=>doc.body.querySelector('#'+id),querySelector:sel=>doc.body.querySelector(sel),addEventListener(){}};
 const page=new Node('section');page.id='myPageOv';page.className='open';page.setAttribute('data-mp-view','assets');
 const top=new Node('div');top.className='mp-toptabs';page.appendChild(top);
 const personal=new Node('div');personal.className='mp-toptab on';personal.textContent='ポートフォリオ';
 const ledger=new Node('div');ledger.className='mp-toptab';ledger.textContent='家計簿';top.appendChild(personal);top.appendChild(ledger);if(!late)doc.body.appendChild(page);
 const show=index=>{
  if(index===1&&!owner)return;routesCalled.push(index);
  personal.classList.toggle('on',index===0);ledger.classList.toggle('on',index===1);
  page.setAttribute('data-mp-view',index===0?'assets':'ledger');frame.selected=index===0?'assets':'ledger';
 };
 personal.addEventListener('click',vm.runInNewContext('('+routes[0]+')',{show}));ledger.addEventListener('click',vm.runInNewContext('('+routes[1]+')',{show}));
 const w={document:doc,getComputedStyle:()=>({display:page.classList.contains('open')?'flex':'none'}),setTimeout:fn=>timers.push(fn),MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}}};
 Object.defineProperty(w,'localStorage',{get(){throw Error('tabs must never touch storage');}});
 // Exercise the existing shared Enter/Space support, including later hydration.
 vm.runInNewContext(theme,w);
 const api=factory(w);
 return {doc,page,top,personal,ledger,frame,scroll,api,observers,routesCalled,show,hydrate:()=>timers[0](),setOwner:v=>owner=v,
  click(button){button.focus();button.click();api.sync();},
  key(button,key){let prevented=false;button.focus();(button.events.keydown||[]).forEach(fn=>fn({key,preventDefault(){prevented=true;}}));api.sync();return prevented;}
 };
}
test('round tabs retain exactly the original two controls and route listeners across repeated mounts',()=>{
 const h=fixture(),nodes=[...h.top.children];h.api.mount();h.api.mount();
 assert.deepEqual(h.top.children,nodes);assert.equal(h.top.querySelectorAll('select').length,0);
 assert.equal(h.top.getAttribute('data-mp-tabs-ready'),'true');assert.deepEqual(h.routesCalled,[]);
 assert.equal(h.personal.events.click.length,1);assert.equal(h.ledger.events.click.length,1);
 assert.equal(h.personal.getAttribute('role'),'button');assert.equal(h.personal.getAttribute('aria-pressed'),'true');assert.equal(h.ledger.getAttribute('aria-pressed'),'false');
});
test('clicks use the actual existing controllers while retaining focus, pending restore, drafts, scroll and frame identity',()=>{
 const h=fixture();h.api.mount();const frame=h.frame,scroll=JSON.stringify(h.scroll);
 h.click(h.ledger);assert.deepEqual(h.routesCalled,[1]);assert.equal(h.ledger.getAttribute('aria-pressed'),'true');assert.equal(h.personal.getAttribute('aria-pressed'),'false');
 assert.equal(h.doc.activeElement,h.ledger);assert.equal(h.frame,frame);assert.equal(h.frame.pending,'pending restore');assert.equal(h.frame.draft,'unsaved amount');assert.equal(JSON.stringify(h.scroll),scroll);
 h.click(h.personal);assert.deepEqual(h.routesCalled,[1,0]);assert.equal(h.frame.selected,'assets');assert.equal(h.doc.activeElement,h.personal);
});
test('controller and owner changes remain authoritative and translated labels stay on the original controls',()=>{
 const h=fixture();h.api.mount();h.show(1);h.api.sync();assert.equal(h.ledger.getAttribute('aria-pressed'),'true');
 h.setOwner('B');h.show(0);
 for(const labels of [['Portfolio','Budget'],['포트폴리오','가계부'],['投资组合','家庭账本'],['ポートフォリオ','家計簿']]){
  h.personal.textContent=labels[0];h.ledger.textContent=labels[1];h.api.sync();
  assert.deepEqual(h.top.children.map(n=>n.textContent),labels);assert.equal(h.personal.getAttribute('aria-pressed'),'true');
 }
 h.setOwner('');h.click(h.ledger);assert.equal(h.personal.getAttribute('aria-pressed'),'true','the original controller refused the inaccessible view');assert.equal(h.ledger.getAttribute('aria-pressed'),'false');
});
test('memo, hidden, inert and closed states stay under the original controller without a replacement control',()=>{
 const h=fixture();h.api.mount();h.page.setAttribute('data-mp-view','memo');h.top.hidden=true;h.top.inert=true;h.top.setAttribute('aria-hidden','true');h.api.sync();
 assert.equal(h.top.hidden,true);assert.equal(h.top.inert,true);assert.equal(h.top.getAttribute('aria-hidden'),'true');assert.equal(h.top.children.length,2);assert.deepEqual(h.routesCalled,[]);
 h.page.setAttribute('data-mp-view','assets');h.top.hidden=false;h.top.inert=false;h.top.setAttribute('aria-hidden','false');h.api.sync();
 assert.equal(h.top.hidden,false);assert.equal(h.top.inert,false);assert.equal(h.personal.getAttribute('aria-pressed'),'true');h.page.className='';h.api.sync();assert.equal(h.page.className,'');assert.deepEqual(h.routesCalled,[]);
});
test('original availability and accessibility metadata are retained rather than replaced',()=>{
 const h=fixture();h.ledger.setAttribute('aria-disabled','true');h.ledger.disabled=true;h.api.mount();h.api.sync();
 assert.equal(h.ledger.disabled,true);assert.equal(h.ledger.getAttribute('aria-disabled'),'true');assert.equal(h.ledger.getAttribute('tabindex'),'0');assert.equal(h.ledger.getAttribute('role'),'button');assert.deepEqual(h.routesCalled,[]);
});
test('existing keyboard activation fires one controller and respects focus moved into an editor',()=>{
 const h=fixture();h.api.mount();h.hydrate();
 assert.equal(h.personal.events.keydown.length,1);assert.equal(h.ledger.events.keydown.length,1);
 assert.equal(h.key(h.ledger,'Enter'),true);assert.deepEqual(h.routesCalled,[1]);assert.equal(h.doc.activeElement,h.ledger);
 assert.equal(h.key(h.personal,' '),true);assert.deepEqual(h.routesCalled,[1,0]);assert.equal(h.doc.activeElement,h.personal);
 assert.equal(h.key(h.personal,'ArrowRight'),false);assert.deepEqual(h.routesCalled,[1,0]);
 const editor=h.doc.createElement('input');h.ledger.addEventListener('click',()=>editor.focus());h.key(h.ledger,'Enter');assert.deepEqual(h.routesCalled,[1,0,1]);assert.equal(h.doc.activeElement,editor);
});
test('late original tab creation is discovered idempotently without adding route or keyboard handlers',()=>{
 const h=fixture({late:true});assert.equal(h.api.mount(),false);const discovery=h.observers.at(-1);
 assert.equal(h.top.getAttribute('data-mp-tabs-ready'),null);h.doc.body.appendChild(h.page);discovery.fn();assert.equal(discovery.disconnected,true);
 h.api.mount();h.hydrate();assert.equal(h.top.children.length,2);assert.equal(h.personal.events.click.length,1);assert.equal(h.ledger.events.click.length,1);assert.equal(h.personal.events.keydown.length,1);
});
test('the adopted segment uses theme and type tokens, two shrinkable columns and wrapping labels without moving the menu',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../static/mypage-view-picker.css'),'utf8');
 assert.match(css,/grid-template-columns:minmax\(0,1\.35fr\) minmax\(0,1fr\)/);assert.match(css,/min-height:44px/);assert.match(css,/border:0;border-radius:999px/);
 assert.match(css,/background:var\(--kn-sh-chip/);assert.match(css,/background:var\(--kn-sh-paper/);assert.match(css,/var\(--kn-type-scale,1\)/);assert.match(css,/white-space:normal;overflow-wrap:anywhere/);
 assert.match(css,/\[hidden\] \{display:none!important\}/);assert.doesNotMatch(css,/select|display:none!important[^\n]*mp-toptab|#knFloatHam|position:fixed|--kn-a-menu-left\s*:/);
});

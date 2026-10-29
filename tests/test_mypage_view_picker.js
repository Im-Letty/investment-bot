'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const factory=require('../static/mypage-view-picker.js');
const loader=fs.readFileSync(path.join(__dirname,'../static/mypage-ledger-loader.js'),'utf8');
const routes=[...loader.matchAll(/(?:personal|ledger)\.addEventListener\('click',(function\(\)\{show\([01]\);\})\)/g)].map(m=>m[1]);assert.equal(routes.length,2,'delegate through the actual two existing tab handlers');
function fixture({late=false}={}){
 let doc,owner='A';const observers=[],routesCalled=[],frame={id:'one existing frame',pending:'pending restore',draft:'unsaved amount',selected:'assets'},scroll={personal:150,ledger:42};
 class Node{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attrs={};this.events={};this.hidden=false;this.inert=false;this.disabled=false;this._text='';this.value='';this.className='';this.classList={contains:name=>this.className.split(' ').includes(name)};}
  get id(){return this.attrs.id||'';}set id(v){this.attrs.id=v;}
  set textContent(s){this._text=String(s);this.children=[];}get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
  appendChild(n){this.children.push(n);n.parentNode=this;return n;}setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}
  querySelectorAll(sel){let result=[];const match=n=>sel[0]==='.'?n.className.split(' ').includes(sel.slice(1)):sel[0]==='#'?n.id===sel.slice(1):n.tagName.toLowerCase()===sel;const walk=n=>n.children.forEach(c=>{if(match(c))result.push(c);walk(c);});walk(this);return result;}querySelector(sel){return this.querySelectorAll(sel)[0]||null;}
  addEventListener(type,fn){(this.events[type]??=[]).push(fn);}click(){(this.events.click||[]).forEach(fn=>fn({target:this}));}focus(options){doc.activeElement=this;this.lastFocus=options;}
 }
 doc={body:new Node('body'),activeElement:null,createElement:t=>new Node(t),getElementById:id=>doc.body.querySelector('#'+id)};
 const page=new Node('section');page.id='myPageOv';page.className='open';page.setAttribute('data-mp-view','assets');const top=new Node('div');top.className='mp-toptabs';page.appendChild(top);const personal=new Node('div');personal.className='mp-toptab on';personal.textContent='ポートフォリオ';const ledger=new Node('div');ledger.className='mp-toptab';ledger.textContent='家計簿';top.appendChild(personal);top.appendChild(ledger);if(!late)doc.body.appendChild(page);
 const show=index=>{if(index===1&&!owner)return;routesCalled.push(index);personal.className='mp-toptab'+(index===0?' on':'');ledger.className='mp-toptab'+(index===1?' on':'');page.setAttribute('data-mp-view',index===0?'assets':'ledger');frame.selected=index===0?'assets':'ledger';};
 personal.addEventListener('click',vm.runInNewContext('('+routes[0]+')',{show}));ledger.addEventListener('click',vm.runInNewContext('('+routes[1]+')',{show}));
 const w={document:doc,MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}}};Object.defineProperty(w,'localStorage',{get(){throw Error('picker must never touch storage');}});
 const api=factory(w);return {doc,page,top,personal,ledger,frame,scroll,api,observers,routesCalled,setOwner:v=>owner=v,select:()=>doc.getElementById('mpViewPicker'),change(value){const select=this.select();select.value=value;doc.activeElement=select;select.events.change.forEach(fn=>fn({target:select}));},show};
}
test('heading selector is mounted once and reuses original route nodes without new account or view state',()=>{
 const h=fixture(),nodes=[...h.top.children];h.api.mount();h.api.mount();assert.equal(h.top.querySelectorAll('select').length,1);assert.equal(h.top.children[0],nodes[0]);assert.equal(h.top.children[1],nodes[1]);assert.equal(h.select().value,'portfolio');assert.deepEqual(h.routesCalled,[]);assert.equal(h.top.getAttribute('data-mp-picker-ready'),'true');assert.equal(h.select().getAttribute('aria-label'),'表示を選ぶ');
});
test('native change clicks the actual existing controller once, keeping pending restore, drafts, scroll and frame identity',()=>{
 const h=fixture();h.api.mount();const frame=h.frame,scroll=JSON.stringify(h.scroll);h.change('ledger');assert.deepEqual(h.routesCalled,[1]);assert.equal(h.select().value,'ledger');assert.equal(h.frame,frame);assert.equal(h.frame.pending,'pending restore');assert.equal(h.frame.draft,'unsaved amount');assert.equal(JSON.stringify(h.scroll),scroll);assert.equal(h.doc.activeElement,h.select());assert.equal(h.select().lastFocus.preventScroll,true);
 h.change('ledger');assert.deepEqual(h.routesCalled,[1]);h.change('portfolio');assert.deepEqual(h.routesCalled,[1,0]);assert.equal(h.frame.selected,'assets');
});
test('external controller, owner and translated label changes update the same selector rather than restoring stale choice',()=>{
 const h=fixture();h.api.mount();h.show(1);h.api.sync();assert.equal(h.select().value,'ledger');h.setOwner('B');h.show(0);h.personal.textContent='Portfolio';h.ledger.textContent='Budget';h.api.sync();assert.equal(h.select().value,'portfolio');assert.equal(h.select().children[0].textContent,'Portfolio');assert.equal(h.select().children[1].textContent,'Budget');
 h.setOwner('');h.change('ledger');assert.equal(h.select().value,'portfolio','the existing controller refused the inaccessible view');
});
test('memo, hidden or closed states disable the picker and cannot trigger a route or leak a pending choice',()=>{
 const h=fixture();h.api.mount();h.page.setAttribute('data-mp-view','memo');h.top.hidden=true;h.top.inert=true;h.api.sync();assert.equal(h.select().disabled,true);assert.equal(h.select().parentNode.hidden,true);h.change('ledger');assert.deepEqual(h.routesCalled,[]);
 h.page.setAttribute('data-mp-view','assets');h.top.hidden=false;h.top.inert=false;h.api.sync();assert.equal(h.select().disabled,false);assert.equal(h.select().value,'portfolio');h.page.className='';h.api.sync();h.change('ledger');assert.deepEqual(h.routesCalled,[]);
});
test('source-disabled choices and invalid native values cannot bypass controller availability',()=>{
 const h=fixture();h.api.mount();h.ledger.setAttribute('aria-disabled','true');h.api.sync();assert.equal(h.select().children[1].disabled,true);h.change('ledger');h.change('untrusted');assert.deepEqual(h.routesCalled,[]);assert.equal(h.select().value,'portfolio');
});
test('native keyboard is retained and a source controller moving focus into an editor is respected',()=>{
 const h=fixture();h.api.mount();assert.equal(h.select().events.keydown,undefined);const editor=h.doc.createElement('input');h.ledger.addEventListener('click',()=>editor.focus());h.change('ledger');assert.equal(h.doc.activeElement,editor);
});
test('late existing tab creation is discovered idempotently and original controls remain a fallback',()=>{
 const h=fixture({late:true});assert.equal(h.api.mount(),false);assert.equal(h.top.getAttribute('data-mp-picker-ready'),null);h.doc.body.appendChild(h.page);h.observers[0].fn();assert.equal(h.observers[0].disconnected,true);h.api.mount();assert.equal(h.top.querySelectorAll('select').length,1);assert.equal(h.personal.events.click.length,1);assert.equal(h.ledger.events.click.length,1);
});
test('the chosen heading has native options and theme tokens, no large outlined tabs and no menu coordinate change',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../static/mypage-view-picker.css'),'utf8');assert.match(css,/\[data-mp-picker-ready="true"\] > \.mp-toptab \{display:none!important\}/);assert.match(css,/select\s*\{[\s\S]*?min-height:48px[\s\S]*?border:0/);assert.match(css,/font:500 calc\(22px/);assert.match(css,/var\(--kn-sh-bg/);assert.doesNotMatch(css,/#knFloatHam|--kn-a-menu-left|position:fixed/);
});

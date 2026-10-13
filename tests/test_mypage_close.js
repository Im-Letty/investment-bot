'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');

function extractAt(start){
  assert.ok(start>=0);let braces=0,quote=null,escaped=false;
  for(let i=html.indexOf('{',start);i<html.length;i++){
    const c=html[i];
    if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote=null;continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='{')braces++;
    else if(c==='}'&&--braces===0)return html.slice(start,i+1);
  }
  throw new Error('Unclosed actual UI handler');
}
const closeSource=extractAt(html.indexOf('function closeMy('));
const openSource=extractAt(html.indexOf('function openMy('));
assert.ok(html.includes('x.onclick=closeMy;'),'The real MyPage close button must use this handler');
assert.ok(html.includes('card.onclick=openMy;'),'The real MyPage card must use this opener');
const primaryNavigation=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).find(s=>s.includes('function go(sel)')&&s.includes('nav.querySelectorAll(".bn-item")'));
assert.ok(primaryNavigation,'Use the existing navigation selection controller');
const capturePosition=html.indexOf("var act=btn.getAttribute('data-act')");
const captureNavigation=extractAt(html.lastIndexOf('function(){',capturePosition));

// Only synthetic values are used. The retained storage and ledger iframe below
// are fixture objects; no personal data, accounts or real frames are inspected.
function harness({withNav=true,withMorning=true,withSync=true,withAuthHelper=true,overflow=''}={}){
  let document;const events=[],storage=new Map([['fixture-portfolio','saved fixture'],['fixture-memo','unsent fixture']]);
  const counters={storageReads:0,storageWrites:0,authChecks:0,authPrompts:0,ledgerPrepare:0,sync:0,network:0,srcWrites:0};
  class Node{
    constructor(tag,id){this.tagName=tag.toUpperCase();this.id=id||'';this.children=[];this.parentNode=null;this.attrs={};this.classes=new Set();this.style={};this.listeners=[];this.value='';this.scrollTop=0;
      this.classList={add:(...names)=>names.forEach(n=>this.classes.add(n)),remove:(...names)=>names.forEach(n=>this.classes.delete(n)),contains:n=>this.classes.has(n)};
    }
    get isConnected(){return this===document.body||!!this.parentNode?.isConnected;}
    get parentElement(){return this.parentNode;}
    set className(value){this.classes=new Set(String(value).split(/\s+/).filter(Boolean));}get className(){return [...this.classes].join(' ');}
    set src(value){counters.srcWrites++;this._src=String(value);}get src(){return this._src||'';}
    set innerHTML(_){throw new Error('Closing MyPage must not rebuild its saved DOM');}
    appendChild(child){this.children.push(child);child.parentNode=this;return child;}
    remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;}}
    getAttribute(name){return this.attrs[name]??null;}setAttribute(name,value){this.attrs[name]=String(value);}
    matches(selector){if(selector[0]==='#')return this.id===selector.slice(1);if(selector[0]==='.')return this.classList.contains(selector.slice(1));return this.tagName.toLowerCase()===selector;}
    querySelectorAll(selector){const nodes=[];function walk(n){for(const child of n.children){if(child.matches(selector))nodes.push(child);walk(child);}}walk(this);return nodes;}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    addEventListener(type,fn,capture=false){this.listeners.push({type,fn,capture});}
    click(){events.push(['click',this.id]);for(const listener of this.listeners.filter(n=>n.type==='click').sort((a,b)=>Number(b.capture)-Number(a.capture)))listener.fn({target:this});if(this.onclick)this.onclick();}
    focus(options){document.activeElement=this;events.push(['focus',this.id,options]);}
    scrollIntoView(options){events.push(['scrollIntoView',this.id,options]);}
  }
  document={body:new Node('body'),activeElement:null,getElementById(id){return this.body.querySelector('#'+id);},querySelector(selector){if(selector==='#knBottomNav [data-act="morning"]')return withNav?morningButton:null;return this.body.querySelector(selector);}};
  document.body.classList.add('kn-home-visible','view-asaletter');document.body.style.overflow=overflow;
  const morning=new Node('section','morning-section');morning.style.display='none';morning.scrollTop=233;if(withMorning)document.body.appendChild(morning);
  const overlay=new Node('section','myPageOv');document.body.appendChild(overlay);
  const close=new Node('button','fixture-mypage-x');close.className='mo-x';overlay.appendChild(close);
  const portfolio=new Node('textarea','mpPortfolio');portfolio.value='fixture portfolio draft';overlay.appendChild(portfolio);
  const memo=new Node('textarea','mpMemo');memo.value='fixture unsent memo';overlay.appendChild(memo);
  const frame=new Node('iframe','fixture-ledger-frame');frame.src='/fixture-ledger-only';overlay.appendChild(frame);
  const card=new Node('button','myPageCard');document.body.appendChild(card);
  const nav=new Node('nav','knBottomNav');if(withNav)document.body.appendChild(nav);
  const morningButton=new Node('button','fixture-morning-button'),myButton=new Node('button','fixture-mypage-button');
  for(const [button,act]of [[morningButton,'morning'],[myButton,'mypage']]){button.className='bn-item';button.setAttribute('data-act',act);nav.appendChild(button);}
  const window={document,knPrepareLedger(){counters.ledgerPrepare++;},openAuth(){counters.authPrompts++;},fetch(){counters.network++;throw new Error('The close path must not request an API');},localStorage:{getItem(key){counters.storageReads++;return storage.get(key)||null;},setItem(key,value){counters.storageWrites++;storage.set(key,String(value));}},scrollTo(){throw new Error('Closing MyPage must use the morning navigation');}};
  if(withAuthHelper)window.knRequireAuth=()=>{counters.authChecks++;return true;};
  if(withSync)window.knNavScreenSync=()=>{counters.sync++;};
  const context={window,document,x:close,card,ms:morning};vm.runInNewContext(closeSource+'\n'+openSource+'\nx.onclick=closeMy;card.onclick=openMy;',context);
  if(withNav){vm.runInNewContext(primaryNavigation,context);for(const btn of [morningButton,myButton]){const callback=vm.runInNewContext('('+captureNavigation+')',{window,document,btn,ms:morning});btn.addEventListener('click',callback,true);}}
  return{window,document,overlay,morning,close,card,nav,morningButton,myButton,portfolio,memo,frame,storage,counters,events,
    open(){if(withNav)myButton.click();else card.click();document.body.classList.add('kn-mypage-active');document.activeElement=close;}};
}

test('the actual MyPage close button restores morning through the real existing navigation controllers',()=>{
  const h=harness();h.open();assert.equal(h.overlay.classList.contains('open'),true);assert.equal(h.document.body.classList.contains('view-asaletter'),false);assert.equal(h.myButton.classList.contains('active'),true);
  const authBefore=h.counters.authChecks;h.close.click();
  assert.equal(h.overlay.classList.contains('open'),false);assert.equal(h.document.body.classList.contains('kn-mypage-active'),false);assert.equal(h.document.body.classList.contains('view-asaletter'),true);
  assert.equal(h.morningButton.classList.contains('active'),true);assert.equal(h.myButton.classList.contains('active'),false);assert.equal(h.morning.scrollTop,0);
  assert.equal(h.document.activeElement,h.morningButton);const focus=h.events.at(-1);
  assert.equal(focus[0],'focus');assert.equal(focus[1],'fixture-morning-button');assert.equal(focus[2].preventScroll,true);
  assert.equal(h.counters.authChecks,authBefore);assert.equal(h.counters.authPrompts,0);assert.equal(h.counters.sync,1);assert.equal(h.counters.network,0);
});

test('missing navigation uses the visible morning fallback and tolerates absent optional sync',()=>{
  const h=harness({withNav:false,withSync:false});h.open();h.document.body.classList.remove('view-asaletter');h.close.click();
  assert.equal(h.overlay.classList.contains('open'),false);assert.equal(h.document.body.classList.contains('view-asaletter'),true);assert.equal(h.morning.style.display,'block');
  assert.equal(h.document.body.classList.contains('kn-mypage-active'),false);assert.equal(h.counters.authPrompts,0);assert.equal(h.counters.network,0);
});

test('closing is safe without navigation or the optional morning element',()=>{
  const h=harness({withNav:false,withMorning:false});h.open();assert.doesNotThrow(()=>h.close.click());
  assert.equal(h.document.body.classList.contains('view-asaletter'),true);assert.equal(h.overlay.classList.contains('open'),false);assert.equal(h.counters.sync,1);assert.equal(h.counters.network,0);
});

test('opening and closing repeatedly keeps saved fields, storage and the existing ledger iframe',()=>{
  const h=harness(),saved=new Map(h.storage),portfolio=h.portfolio,memo=h.memo,frame=h.frame,src=frame.src,initialWrites=h.counters.srcWrites;
  for(let i=0;i<2;i++){h.open();h.close.click();assert.equal(h.document.getElementById('mpPortfolio'),portfolio);assert.equal(h.document.getElementById('mpMemo'),memo);assert.equal(h.document.getElementById('fixture-ledger-frame'),frame);}
  assert.equal(portfolio.value,'fixture portfolio draft');assert.equal(memo.value,'fixture unsent memo');assert.equal(frame.src,src);assert.equal(h.counters.srcWrites,initialWrites);
  assert.deepEqual(h.storage,saved);assert.equal(h.counters.storageReads,0);assert.equal(h.counters.storageWrites,0);assert.equal(h.counters.ledgerPrepare,2);assert.equal(h.counters.network,0);
});

test('MyPage close does not overwrite an existing body overflow value',()=>{
  for(const overflow of ['','auto','hidden']){const h=harness({overflow});h.open();h.close.click();assert.equal(h.document.body.style.overflow,overflow);assert.equal(h.document.body.classList.contains('view-asaletter'),true);}
});

test('the existing guest-compatible opener still works without introducing an auth requirement on close',()=>{
  const h=harness({withAuthHelper:false});h.open();assert.equal(h.overlay.classList.contains('open'),true);h.close.click();
  assert.equal(h.counters.authChecks,0);assert.equal(h.counters.authPrompts,0);assert.equal(h.counters.ledgerPrepare,1);assert.equal(h.document.body.classList.contains('view-asaletter'),true);assert.equal(h.counters.network,0);
});

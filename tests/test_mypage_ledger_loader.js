'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function closeMySource(){
  const html=read('index.html'),start=html.indexOf('function closeMy(');
  assert.ok(start>=0);let braces=0,quote=null,escaped=false;
  for(let i=html.indexOf('{',start);i<html.length;i++){
    const c=html[i];
    if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote=null;continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='{')braces++;else if(c==='}'&&--braces===0)return html.slice(start,i+1);
  }
  throw Error('The actual MyPage close handler must be complete');
}
function fixture(user={id:'account-A'}) {
  const events={},messages={},mutations=[],navigations=[];let refreshes=0,closes=0;
  class Element {
    constructor(){this.children=[];this.dataset={};this.style={};this.attributes={};this.listeners={};this.srcChanges=[];this.scrollTop=0;}
    set className(value){this.classes=new Set(value.split(' '));}
    get classList(){return {contains:k=>this.classes?.has(k),add:k=>this.classes.add(k),remove:k=>this.classes.delete(k),toggle:(k,on)=>on?this.classes.add(k):this.classes.delete(k)};}
    appendChild(el){el.parentNode=this;this.children.push(el);return el;}
    removeChild(el){this.children.splice(this.children.indexOf(el),1);el.parentNode=null;}
    insertBefore(el,other){el.parentNode=this;this.children.splice(this.children.indexOf(other),0,el);}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    querySelectorAll(selector){let descendants=this.children.flatMap(el=>[el,...el.querySelectorAll('*')]);return descendants.filter(el=>selector==='*'||(selector==='.mo-pane:not(.kb-pane)'?el.classList.contains('mo-pane')&&!el.classList.contains('kb-pane'):el.classList.contains(selector.slice(1))));}
    addEventListener(name,fn){this.listeners[name]=fn;}
    click(){this.listeners.click?.();this.onclick?.();}
    setAttribute(name,value){this.attributes[name]=value;if(name==='src'){this.srcChanges.push(value);navigations.push(value);}}
    getAttribute(name){return this.attributes[name]??null;}
    removeAttribute(name){delete this.attributes[name];}
  }
  const el=cls=>{const n=new Element();n.className=cls;return n;};
  const page=el(''),tabs=page.appendChild(el('mo-tabs')),body=page.appendChild(el('mo-body'));
  const close=page.appendChild(el('mo-x'));
  tabs.appendChild(el('mo-tab on'));tabs.appendChild(el('mo-tab'));
  body.appendChild(el('mo-pane on'));body.appendChild(el('mo-pane'));
  const card=el('');
  function documentInFrame(n){n.contentDocument={readyState:'complete',documentElement:{getAttribute:()=> 'true'}};n.contentWindow={location:{origin:'https://local.test',protocol:'https:',pathname:'/kakeibo'},kkRefreshRecords(){refreshes++;}};}
  const doc={readyState:'complete',body:el(''),querySelector:()=>null,getElementById:id=>({myPageOv:page,myPageCard:card}[id]),createElement:tag=>{const n=el('');if(tag==='iframe')documentInFrame(n);return n;},addEventListener:(name,fn)=>events[name]=fn};
  const context={document:doc,knUser:user,location:{origin:'https://local.test'},setTimeout(){throw Error('setup should be immediate');},MutationObserver:class {constructor(fn){mutations.push(fn);}observe(){}},addEventListener:(name,fn)=>messages[name]=fn};context.window=context;
  vm.runInNewContext(read('static/mypage-ledger-loader.js'),context);
  vm.runInNewContext(closeMySource(),context);
  close.onclick=()=>{closes++;context.closeMy();};
  const frame=page.querySelector('.kb-frame'),top=page.querySelector('.mp-toptabs'),personal=top.children[0],ledger=top.children[1];
  documentInFrame(frame);
  card.listeners.click=()=>{if(context.knUser&&!context.knUser.is_anonymous){page.classList.add('open');context.knPrepareLedger();}};
  return {context,page,tabs,body,close,get frame(){return page.querySelector('.kb-frame');},personal,ledger,mutations,navigations,refreshes:()=>refreshes,closes:()=>closes,auth(user){context.knUser=user;events.knAuthChange();},ready(event={}){messages.message({origin:context.location.origin,source:page.querySelector('.kb-frame').contentWindow,data:{type:'kn-kakeibo-ready'},...event});}};
}
test('no household ledger request before an authorized MyPage visit',()=>{
  const h=fixture();assert.equal(h.frame.getAttribute('src'),null);h.context.knPrepareLedger();assert.equal(h.frame.getAttribute('src'),null);
  const anonymous=fixture(null);anonymous.context.knOpenLedger();assert.equal(anonymous.frame.getAttribute('src'),null);assert.equal(anonymous.page.classList.contains('open'),false);
});
test('same-account tab and screen changes preserve one document, its draft and scroll',()=>{
  const h=fixture();h.context.knOpenLedger();assert.deepEqual(h.frame.srcChanges,['/kakeibo']);
  h.frame.draft='unfinished';h.frame.scroll=400;h.ready();
  h.personal.click();h.ledger.click();h.page.classList.remove('open');h.mutations.forEach(fn=>fn());h.context.knOpenLedger();
  assert.deepEqual(h.frame.srcChanges,['/kakeibo']);assert.equal(h.frame.draft,'unfinished');assert.equal(h.frame.scroll,400);assert.ok(h.refreshes()>0);
  assert.equal(h.frame.getAttribute('loading'),'eager');
});
test('switching groups reserves the personal subtab row while disabling its hidden controls only in the ledger',()=>{
  const h=fixture(),subtabs=h.tabs.children.slice();
  h.body.scrollTop=960;h.context.knOpenLedger();
  assert.equal(h.tabs.style.display,'');assert.equal(h.tabs.style.visibility,'hidden');assert.equal(h.tabs.getAttribute('inert'),'');assert.equal(h.tabs.getAttribute('aria-hidden'),'true');
  assert.deepEqual(h.tabs.children,subtabs);assert.equal(h.body.scrollTop,0);assert.equal(h.personal.classList.contains('on'),false);assert.equal(h.ledger.classList.contains('on'),true);
  h.personal.click();assert.equal(h.tabs.style.display,'');assert.equal(h.tabs.style.visibility,'');assert.equal(h.tabs.getAttribute('inert'),null);assert.equal(h.tabs.getAttribute('aria-hidden'),null);assert.equal(h.body.scrollTop,960);
  assert.deepEqual(h.tabs.children,subtabs);assert.equal(h.tabs.children[0].classList.contains('on'),true);assert.equal(h.tabs.children[1].classList.contains('on'),false);
});
test('long personal-page scroll is restored after repeated switches without reloading or changing the ledger document, draft or child scroll',()=>{
  const h=fixture();h.body.scrollTop=740;h.context.knOpenLedger();h.ready();
  const frame=h.frame,doc=frame.contentDocument,child=frame.contentWindow;doc.draft={amount:'12345.67',memo:'synthetic unfinished memo'};doc.documentElement.scrollTop=415;child.scrollY=415;
  assert.equal(h.body.scrollTop,0);h.ledger.click();h.ledger.click();assert.equal(h.body.scrollTop,0);
  h.personal.click();assert.equal(h.body.scrollTop,740);h.body.scrollTop=1065;h.personal.click();assert.equal(h.body.scrollTop,1065,'reselecting Personal must not restore a stale position');
  for(let i=0;i<3;i++){h.ledger.click();assert.equal(h.body.scrollTop,0);h.ledger.click();h.personal.click();assert.equal(h.body.scrollTop,1065);}
  assert.equal(h.frame,frame);assert.equal(frame.contentDocument,doc);assert.equal(frame.contentWindow,child);assert.deepEqual(doc.draft,{amount:'12345.67',memo:'synthetic unfinished memo'});assert.equal(doc.documentElement.scrollTop,415);assert.equal(child.scrollY,415);assert.deepEqual(h.navigations,['/kakeibo']);assert.ok(h.refreshes()>0);
});
test('account changes reset the remembered parent position while replacing the private ledger context',()=>{
  const h=fixture();h.body.scrollTop=1230;h.context.knOpenLedger();const old=h.frame;old.contentDocument.draft='account A only';
  h.auth({id:'account-B'});assert.notEqual(h.frame,old);assert.equal(old.parentNode,null);assert.equal(h.body.scrollTop,0);assert.equal(h.personal.classList.contains('on'),true);assert.equal(h.tabs.style.visibility,'');assert.equal(h.tabs.getAttribute('inert'),null);assert.equal(h.tabs.getAttribute('aria-hidden'),null);
  h.ledger.click();h.personal.click();assert.equal(h.body.scrollTop,0,'the new account must not inherit the previous personal scroll');assert.notEqual(h.frame.contentDocument.draft,'account A only');assert.deepEqual(h.navigations,['/kakeibo','/kakeibo']);
  h.body.scrollTop=530;h.ledger.click();h.personal.click();assert.equal(h.body.scrollTop,530,'new-account positions are remembered independently');
});
test('token refresh retains the document, signout destroys it and closes private view',()=>{
  const h=fixture();h.context.knOpenLedger();h.auth({id:'account-A'});assert.deepEqual(h.frame.srcChanges,['/kakeibo']);
  h.auth(null);assert.deepEqual(h.navigations,['/kakeibo']);assert.equal(h.frame.getAttribute('src'),null);assert.equal(h.page.classList.contains('open'),false);assert.equal(h.personal.classList.contains('on'),true);
  h.context.knPrepareLedger();assert.equal(h.navigations.length,1);
});
test('account switch destroys the old document before the next account can load',()=>{
  const h=fixture();h.context.knOpenLedger();const old=h.frame;h.auth({id:'account-B'});
  assert.notEqual(h.frame,old);assert.equal(old.parentNode,null);assert.deepEqual(h.navigations,['/kakeibo','/kakeibo']);assert.equal(h.personal.classList.contains('on'),true);
});
test('readiness accepts only the owned same-origin household-ledger frame',()=>{
  const h=fixture();h.frame.contentDocument.documentElement.getAttribute=()=>null;h.context.knOpenLedger();assert.equal(h.frame.getAttribute('aria-busy'),'true');
  h.ready({origin:'https://other.test'});h.ready({source:{}});assert.equal(h.frame.getAttribute('aria-busy'),'true');
  h.frame.contentDocument.documentElement.getAttribute=()=> 'true';h.ready();assert.equal(h.frame.getAttribute('aria-busy'),null);
});
test('home navigation does not remove the ledger source and drawer opens it without a timer',()=>{
  const html=read('index.html');
  assert.match(html,/mypage-ledger-loader\.js\?v=20261016-stable1/);
  assert.doesNotMatch(html,/__kf2.*removeAttribute\('src'\)/);
  assert.match(html,/var kakeibo=mkItem\("📒 家計簿",function\(\)\{CD\(\);if\(window\.knOpenLedger\)window\.knOpenLedger\(\);\}\)/);
});
test('owned ledger return invokes the existing close button and reopening retains the document and draft',()=>{
  const h=fixture();h.context.knOpenLedger();const frame=h.frame;
  frame.draft='synthetic unsaved input';frame.scroll=400;
  assert.equal(h.context.knReturnFromLedger(frame.contentWindow),true);
  assert.equal(h.closes(),1);assert.equal(h.page.classList.contains('open'),false);
  assert.equal(h.context.document.body.classList.contains('view-asaletter'),true);
  h.mutations.forEach(fn=>fn());h.context.knOpenLedger();
  assert.equal(h.frame,frame);assert.equal(frame.draft,'synthetic unsaved input');assert.equal(frame.scroll,400);
  assert.deepEqual(h.navigations,['/kakeibo']);
});
test('return rejects foreign or absent sources, a closed page, missing close control, and unprepared owners',()=>{
  const unopened=fixture();assert.equal(unopened.context.knReturnFromLedger(unopened.frame.contentWindow),false);
  const h=fixture();h.context.knOpenLedger();
  for(const source of [undefined,null,{}, {location:{origin:'https://local.test'}}])assert.equal(h.context.knReturnFromLedger(source),false);
  h.page.classList.remove('open');assert.equal(h.context.knReturnFromLedger(h.frame.contentWindow),false);
  h.page.classList.add('open');h.close.parentNode.removeChild(h.close);
  assert.equal(h.context.knReturnFromLedger(h.frame.contentWindow),false);assert.equal(h.closes(),0);
});
test('return rejects stale account ownership and the old detached browsing context after account change',()=>{
  const h=fixture();h.context.knOpenLedger();const previous=h.frame.contentWindow;
  h.context.knUser={id:'account-B'};
  assert.equal(h.context.knReturnFromLedger(previous),false);assert.equal(h.closes(),0);
  h.auth({id:'account-B'});assert.notEqual(h.frame.contentWindow,previous);
  assert.equal(h.context.knReturnFromLedger(previous),false);assert.equal(h.closes(),0);
  assert.equal(h.context.knReturnFromLedger(h.frame.contentWindow),true);assert.equal(h.closes(),1);
  const signedOut=fixture();signedOut.context.knOpenLedger();const source=signedOut.frame.contentWindow;
  signedOut.context.knUser=null;
  assert.equal(signedOut.context.knReturnFromLedger(source),false);assert.equal(signedOut.closes(),0);
});
test('return rejects a current frame that has not declared household-ledger readiness',()=>{
  const h=fixture();h.context.knOpenLedger();h.frame.contentDocument.documentElement.getAttribute=()=>null;
  assert.equal(h.context.knReturnFromLedger(h.frame.contentWindow),false);assert.equal(h.closes(),0);
  assert.equal(h.page.classList.contains('open'),true);
});
test('opening a retained frame that completed on the wrong same-origin page recovers a fresh household ledger',()=>{
  const h=fixture();h.context.knOpenLedger();const wrong=h.frame;
  wrong.contentDocument={readyState:'complete',documentElement:{getAttribute:()=>null}};
  wrong.contentWindow.location.pathname='/';
  wrong.listeners.load();
  h.personal.click();h.ledger.click();
  assert.notEqual(h.frame,wrong);assert.equal(wrong.parentNode,null);
  assert.equal(h.frame.getAttribute('src'),'/kakeibo');assert.deepEqual(h.navigations,['/kakeibo','/kakeibo']);
  assert.equal(h.ledger.classList.contains('on'),true);
});
test('same-owner wrong-document recovery retains the personal scroll position whether recovered from Personal or Ledger',()=>{
  for(const recoverFromPersonal of [true,false]){
    const h=fixture();h.body.scrollTop=740;h.context.knOpenLedger();const wrong=h.frame;
    wrong.contentDocument={readyState:'complete',documentElement:{getAttribute:()=>null}};wrong.contentWindow.location.pathname='/';wrong.listeners.load();
    if(recoverFromPersonal){h.personal.click();assert.equal(h.body.scrollTop,740);}
    h.ledger.click();assert.notEqual(h.frame,wrong);assert.equal(wrong.parentNode,null);assert.equal(h.body.scrollTop,0);assert.equal(h.frame.getAttribute('src'),'/kakeibo');
    h.personal.click();assert.equal(h.body.scrollTop,740,'same-account recovery must retain the long personal-page position');assert.deepEqual(h.navigations,['/kakeibo','/kakeibo']);
  }
});
test('an account change observed before its auth event resets parent scroll during either ordinary opening or wrong-document recovery',()=>{
  for(const wrongDocument of [false,true]){
    const h=fixture();h.body.scrollTop=740;h.context.knOpenLedger();const old=h.frame;h.personal.click();assert.equal(h.body.scrollTop,740);
    if(wrongDocument){old.contentDocument={readyState:'complete',documentElement:{getAttribute:()=>null}};old.contentWindow.location.pathname='/';old.listeners.load();}
    h.context.knUser={id:'account-B'};h.ledger.click();assert.notEqual(h.frame,old);assert.equal(old.parentNode,null);assert.equal(h.body.scrollTop,0);assert.equal(h.frame.getAttribute('src'),'/kakeibo');
    h.personal.click();assert.equal(h.body.scrollTop,0,'an unannounced new owner must not inherit the previous personal position');assert.deepEqual(h.navigations,['/kakeibo','/kakeibo']);
    h.body.scrollTop=415;h.ledger.click();h.personal.click();assert.equal(h.body.scrollTop,415,'the new owner can still retain its own position');
  }
});
test('opening a pending, auth-waiting, initial blank or correct ready ledger preserves its browsing context and source',()=>{
  for(const state of [{readyState:'loading',path:'/',ready:false,loaded:true},{readyState:'interactive',path:'/',ready:false,loaded:true},{readyState:'complete',path:'/',ready:false,loaded:false},{readyState:'complete',path:'blank',protocol:'about:',ready:false,loaded:true},{readyState:'complete',path:'/kakeibo',ready:false,loaded:true},{readyState:'complete',path:'/kakeibo',ready:true,loaded:true}]){
    const h=fixture();h.context.knOpenLedger();const frame=h.frame;frame.draft='synthetic waiting draft';
    frame.contentDocument={readyState:state.readyState,documentElement:{getAttribute:()=>state.ready?'true':null}};
    frame.contentWindow.location.pathname=state.path;
    frame.contentWindow.location.protocol=state.protocol||'https:';
    if(state.loaded)frame.listeners.load();
    h.personal.click();h.ledger.click();
    assert.equal(h.frame,frame,JSON.stringify(state));assert.equal(frame.draft,'synthetic waiting draft');assert.deepEqual(h.navigations,['/kakeibo']);
  }
});

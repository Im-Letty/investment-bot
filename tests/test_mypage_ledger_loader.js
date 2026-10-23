'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function pageFunctionSource(name){
  const html=read('index.html'),start=html.indexOf('function '+name+'(');
  assert.ok(start>=0);let braces=0,quote=null,escaped=false;
  for(let i=html.indexOf('{',start);i<html.length;i++){
    const c=html[i];
    if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote=null;continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='{')braces++;else if(c==='}'&&--braces===0)return html.slice(start,i+1);
  }
  throw Error('The actual MyPage '+name+' handler must be complete');
}
function fixture(user={id:'account-A'},options={}) {
  const events={},messages={},mutations=[],navigations=[],views=[],registrations=[],fallbacks=[];let refreshes=0,closes=0,pageAvailable=!options.deferPage;
  class Element {
    constructor(){this.children=[];this.dataset={};this.style={};this.attributes={};this.listeners={};this.listenerCounts={};this.srcChanges=[];this.scrollTop=0;this.hidden=false;this.inert=false;this.tagName='DIV';}
    set className(value){this.classes=new Set(value.split(' '));}
    get classList(){return {contains:k=>this.classes?.has(k),add:k=>this.classes.add(k),remove:k=>this.classes.delete(k),toggle:(k,on)=>on?this.classes.add(k):this.classes.delete(k)};}
    appendChild(el){el.parentNode=this;this.children.push(el);return el;}
    removeChild(el){this.children.splice(this.children.indexOf(el),1);el.parentNode=null;}
    insertBefore(el,other){el.parentNode=this;this.children.splice(this.children.indexOf(other),0,el);}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    querySelectorAll(selector){
      const descendants=this.children.flatMap(el=>[el,...el.querySelectorAll('*')]),parts=selector.split(/\s+/);
      const matches=(el,part)=>part==='*'||(part==='.mo-pane:not(.kb-pane)'?el.classList.contains('mo-pane')&&!el.classList.contains('kb-pane'):part.startsWith('.')?el.classList.contains(part.slice(1)):el.tagName===part.toUpperCase());
      return descendants.filter(el=>{if(!matches(el,parts.at(-1)))return false;let parent=el.parentNode;for(let i=parts.length-2;i>=0;i--){while(parent&&!matches(parent,parts[i]))parent=parent.parentNode;if(!parent)return false;parent=parent.parentNode;}return true;});
    }
    addEventListener(name,fn){this.listeners[name]=fn;this.listenerCounts[name]=(this.listenerCounts[name]||0)+1;}
    click(){this.onclick?.();this.listeners.click?.();}
    focus(){doc.activeElement=this;}
    setAttribute(name,value){this.attributes[name]=value;if(name==='inert')this.inert=true;if(name==='hidden')this.hidden=true;if(name==='src'){this.srcChanges.push(value);navigations.push(value);}}
    getAttribute(name){return this.attributes[name]??null;}
    removeAttribute(name){delete this.attributes[name];if(name==='inert')this.inert=false;if(name==='hidden')this.hidden=false;}
  }
  const el=cls=>{const n=new Element();n.className=cls;return n;};
  const page=el(''),tabs=page.appendChild(el('mo-tabs')),body=page.appendChild(el('mo-body'));
  const close=page.appendChild(el('mo-x'));
  for(let index=0;index<4;index++){tabs.appendChild(el('mo-tab'+(index===0?' on':'')));body.appendChild(el('mo-pane'+(index===0?' on':'')));}
  tabs.children[3].hidden=true;tabs.children[3].inert=true;tabs.children[3].tabIndex=-1;
  const noteLibrary=body.children[3].appendChild(el('mp-note-library')),noteHeading=noteLibrary.appendChild(el('mp-heading'));
  tabs.children.forEach((tab,index)=>{tab.onclick=()=>{
    tabs.children.forEach((item,i)=>item.classList.toggle('on',i===index));
    body.querySelectorAll('.mo-pane:not(.kb-pane)').forEach((item,i)=>item.classList.toggle('on',i===index));
  };});
  const card=el('');
  function documentInFrame(n){n.contentDocument={readyState:'complete',documentElement:{getAttribute:()=> 'true'}};n.contentWindow={location:{origin:'https://local.test',protocol:'https:',pathname:'/kakeibo'},kkRefreshRecords(){refreshes++;},kkSetMyPageView(view){views.push(view);}};}
  const doc={readyState:options.readyState||'complete',body:el(''),querySelector:()=>null,getElementById:id=>({myPageOv:pageAvailable?page:null,myPageCard:card}[id]),createElement:tag=>{const n=el('');n.tagName=tag.toUpperCase();if(tag==='iframe')documentInFrame(n);return n;},addEventListener:(name,fn,settings)=>{events[name]=fn;registrations.push({target:'document',name,settings});}};
  const context={document:doc,knUser:user,location:{origin:'https://local.test',search:options.search||''},URLSearchParams,setTimeout(fn,ms){if(!options.deferPage)throw Error('setup should be immediate');fallbacks.push({fn,ms});return fallbacks.length;},MutationObserver:class {constructor(fn){mutations.push(fn);}observe(){}},addEventListener:(name,fn)=>{messages[name]=fn;registrations.push({target:'window',name});}};context.window=context;
  context.knRequireAuth=()=>!!(context.knUser&&(!context.knUser.is_anonymous||options.allowAnonymous));
  card.listeners.click=()=>context.openMy();
  vm.runInNewContext(pageFunctionSource('openMy')+'\n'+pageFunctionSource('closeMy'),context);
  vm.runInNewContext(read('static/mypage-ledger-loader.js'),context);
  close.onclick=()=>{closes++;context.closeMy();};
  const frame=page.querySelector('.kb-frame');if(frame)documentInFrame(frame);
  return {context,page,tabs,body,close,card,noteLibrary,noteHeading,get frame(){return page.querySelector('.kb-frame');},get personal(){return page.querySelector('.mp-toptabs')?.children[0]||null;},get ledger(){return page.querySelector('.mp-toptabs')?.children[1]||null;},mutations,navigations,views,registrations,fallbacks,refreshes:()=>refreshes,closes:()=>closes,publishPage(){pageAvailable=true;},domReady(){doc.readyState='interactive';const listener=events.DOMContentLoaded;if(listener){const registration=registrations.find(item=>item.target==='document'&&item.name==='DOMContentLoaded');if(registration?.settings?.once)delete events.DOMContentLoaded;listener();}},runFallbacks(){while(fallbacks.length)fallbacks.shift().fn();},auth(user){context.knUser=user;events.knAuthChange();},ready(event={}){messages.message({origin:context.location.origin,source:page.querySelector('.kb-frame').contentWindow,data:{type:'kn-kakeibo-ready'},...event});}};
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
test('home navigation retains the existing MyPage entry and never removes the private ledger source',()=>{
  const html=read('index.html');
  assert.match(html,/mypage-ledger-loader\.js\?v=[^"'&<\s]+/);
  assert.doesNotMatch(html,/__kf2.*removeAttribute\('src'\)/);
  assert.match(html,/card\.id="myPageCard"/);assert.match(html,/card\.onclick=openMy/);assert.match(html,/data-act="mypage"/);
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
test('portfolio opens assets in the same private document and other personal tabs hide it',()=>{
  const h=fixture();
  assert.equal(h.context.knOpenAssets(),true);
  const frame=h.frame;frame.draft='unfinished asset';h.ready();
  assert.equal(h.page.getAttribute('data-mp-view'),'assets');assert.equal(h.views.at(-1),'assets');
  assert.equal(frame.parentNode.classList.contains('on'),true);
  h.tabs.children[3].click();
  assert.equal(h.page.getAttribute('data-mp-view'),'personal');assert.equal(frame.parentNode.classList.contains('on'),false);
  h.tabs.children[0].click();
  assert.equal(h.page.getAttribute('data-mp-view'),'assets');assert.equal(h.views.at(-1),'assets');
  h.ledger.click();assert.equal(h.views.at(-1),'ledger');h.personal.click();assert.equal(h.views.at(-1),'assets');
  assert.equal(h.frame,frame);assert.equal(frame.draft,'unfinished asset');assert.deepEqual(h.navigations,['/kakeibo']);
});
test('household assets navigation reports acceptance and selects portfolio without a top-level reload',()=>{
  const h=fixture();h.context.knOpenLedger();const frame=h.frame;frame.draft='unfinished household entry';
  h.tabs.children[3].click();h.ledger.click();
  assert.equal(h.context.knOpenAssets(),true);
  assert.equal(h.personal.classList.contains('on'),true);assert.equal(h.tabs.children[0].classList.contains('on'),true);
  assert.equal(h.views.at(-1),'assets');assert.equal(h.frame,frame);assert.equal(frame.draft,'unfinished household entry');assert.deepEqual(h.navigations,['/kakeibo']);
});
test('pending assets entry waits for authorized opening and never loads a private document while signed out',()=>{
  const h=fixture(null);assert.equal(h.context.knOpenAssets(),false);
  assert.equal(h.frame.getAttribute('src'),null);assert.equal(h.page.classList.contains('open'),false);
  h.auth({id:'account-A'});
  assert.equal(h.page.classList.contains('open'),true);assert.equal(h.context.knOpenAssets(),true);
  assert.equal(h.views.at(-1),'assets');assert.deepEqual(h.navigations,['/kakeibo']);
});
test('standalone asset links open the portfolio for the existing anonymous owner without bypassing the normal entry',()=>{
  const h=fixture({id:'guest-A',is_anonymous:true},{allowAnonymous:true,search:'?mypage=assets'});
  assert.equal(h.page.classList.contains('open'),true);assert.equal(h.page.getAttribute('data-mp-view'),'assets');
  assert.equal(h.views.at(-1),'assets');assert.deepEqual(h.navigations,['/kakeibo']);
  h.context.knOpenAssets();assert.deepEqual(h.navigations,['/kakeibo']);
});
test('the standalone link waits for the existing auth event before opening an anonymous private portfolio',()=>{
  const h=fixture(null,{allowAnonymous:true,search:'?mypage=assets'});
  assert.equal(h.page.classList.contains('open'),false);assert.deepEqual(h.navigations,[]);
  h.auth({id:'guest-A',is_anonymous:true});assert.equal(h.page.classList.contains('open'),true);
  assert.equal(h.views.at(-1),'assets');assert.deepEqual(h.navigations,['/kakeibo']);
});

test('interactive startup catches a MyPage created at DOM ready before the 300ms fallback',()=>{
  const h=fixture({id:'account-A'},{readyState:'interactive',deferPage:true});
  assert.equal(h.frame,null);assert.equal(h.fallbacks.length,1);assert.equal(h.fallbacks[0].ms,300);
  const ready=h.registrations.filter(item=>item.target==='document'&&item.name==='DOMContentLoaded');
  assert.equal(ready.length,1);assert.equal(ready[0].settings.once,true);
  h.publishPage();h.domReady();assert.ok(h.frame,'DOM ready initializes the newly created page without waiting for the retry timer');
  const frame=h.frame;assert.equal(frame.getAttribute('src'),null);assert.equal(h.fallbacks.length,1);
  h.context.knOpenLedger();frame.draft='synthetic unfinished input';h.runFallbacks();h.domReady();
  assert.equal(h.frame,frame);assert.equal(frame.draft,'synthetic unfinished input');assert.deepEqual(h.navigations,['/kakeibo']);
  assert.equal(h.page.querySelectorAll('.kb-frame').length,1);assert.equal(h.page.querySelectorAll('.kb-pane').length,1);assert.equal(h.page.querySelectorAll('.mp-toptabs').length,1);
  assert.equal(h.mutations.length,1);assert.equal(h.registrations.filter(item=>item.target==='document'&&item.name==='knAuthChange').length,1);
  assert.equal(h.registrations.filter(item=>item.target==='window'&&item.name==='message').length,1);
  assert.ok(h.tabs.children.every(tab=>tab.listenerCounts.click===1));
});

test('interactive startup uses an existing MyPage immediately and DOM ready does not duplicate its document or handlers',()=>{
  const h=fixture({id:'account-A'},{readyState:'interactive'}),frame=h.frame;
  assert.ok(frame);assert.equal(h.fallbacks.length,0);h.context.knOpenLedger();frame.draft='existing draft';h.domReady();
  assert.equal(h.frame,frame);assert.equal(frame.draft,'existing draft');assert.deepEqual(h.navigations,['/kakeibo']);
  assert.equal(h.page.querySelectorAll('.mp-toptabs').length,1);assert.equal(h.mutations.length,1);
  assert.equal(h.registrations.filter(item=>item.target==='document'&&item.name==='knAuthChange').length,1);
  assert.ok(h.tabs.children.every(tab=>tab.listenerCounts.click===1));
});

test('loading startup waits for DOM ready without starting a private iframe request',()=>{
  const h=fixture({id:'account-A'},{readyState:'loading'});
  assert.equal(h.frame,null);assert.equal(h.fallbacks.length,0);assert.deepEqual(h.navigations,[]);
  h.domReady();assert.ok(h.frame);assert.equal(h.frame.getAttribute('src'),null);assert.equal(h.mutations.length,1);
  assert.equal(h.registrations.find(item=>item.target==='document'&&item.name==='DOMContentLoaded').settings.once,true);
});

test('the compatibility goal entry returns to portfolio while preserving the same private ledger document',()=>{
  const h=fixture();h.context.knOpenAssets();const frame=h.frame;frame.draft='unfinished asset';
  assert.equal(h.context.knOpenGoals(),true);assert.equal(h.page.classList.contains('open'),true);assert.equal(h.tabs.children[0].classList.contains('on'),true);assert.equal(h.tabs.children[1].classList.contains('on'),false);
  assert.equal(h.page.getAttribute('data-mp-view'),'assets');assert.equal(h.frame,frame);assert.equal(frame.draft,'unfinished asset');assert.deepEqual(h.navigations,['/kakeibo']);
});
test('old standalone goal deep links wait for normal authorization and then open portfolio',()=>{
  const h=fixture(null,{allowAnonymous:true,search:'?mypage=goals'});assert.equal(h.page.classList.contains('open'),false);assert.deepEqual(h.navigations,[]);
  h.auth({id:'guest-A',is_anonymous:true});assert.equal(h.page.classList.contains('open'),true);assert.equal(h.tabs.children[0].classList.contains('on'),true);assert.equal(h.tabs.children[1].classList.contains('on'),false);assert.equal(h.page.getAttribute('data-mp-view'),'assets');assert.deepEqual(h.navigations,['/kakeibo']);
});

test('pending portfolio and compatibility goal entries both open portfolio after normal sign-in',()=>{
 const goals=fixture(null);assert.equal(goals.context.knOpenAssets(),false);assert.equal(goals.context.knOpenGoals(),false);goals.auth({id:'account-A'});assert.equal(goals.tabs.children[0].classList.contains('on'),true);assert.equal(goals.tabs.children[1].classList.contains('on'),false);assert.equal(goals.page.getAttribute('data-mp-view'),'assets');
 const assets=fixture(null);assert.equal(assets.context.knOpenGoals(),false);assert.equal(assets.context.knOpenAssets(),false);assets.auth({id:'account-A'});assert.equal(assets.tabs.children[0].classList.contains('on'),true);assert.equal(assets.page.getAttribute('data-mp-view'),'assets');
});

test('the dedicated memo entry warms the same private connection while exposing only the original note pane',()=>{
  const h=fixture(),frame=h.frame,panes=h.body.querySelectorAll('.mo-pane:not(.kb-pane)');
  const editor=h.context.document.createElement('section');editor.className='mp-note-editor';editor.hidden=true;panes[3].appendChild(editor);
  assert.equal(h.context.knOpenMemo(),true);assert.equal(h.page.classList.contains('open'),true);
  assert.equal(h.page.getAttribute('data-mp-view'),'memo');assert.deepEqual(panes.map(p=>p.classList.contains('on')),[false,false,false,true]);
  assert.equal(h.frame,frame);assert.equal(frame.parentNode.classList.contains('on'),false);assert.deepEqual(h.navigations,['/kakeibo']);
  assert.equal(frame.getAttribute('loading'),'eager');assert.equal(h.page.querySelectorAll('.kb-frame').length,1);
  const top=h.page.querySelector('.mp-toptabs');
  for(const row of [top,h.tabs]){assert.equal(row.hidden,true);assert.equal(row.inert,true);assert.equal(row.getAttribute('aria-hidden'),'true');}
  assert.equal(h.tabs.style.display,'none');assert.equal(h.context.document.activeElement,h.noteHeading);
  assert.equal(h.tabs.children.length,4);assert.equal(h.tabs.children[3].hidden,true);assert.equal(h.tabs.children[3].inert,true);
  editor.hidden=false;h.noteLibrary.hidden=true;editor.draft='編集途中の本文';
  h.context.knOpenAssets();assert.equal(h.context.knOpenMemo(),true);
  assert.equal(h.context.document.activeElement,editor,'reopening an active note editor must focus the visible editor instead of the hidden library heading');
  assert.equal(editor.draft,'編集途中の本文');assert.equal(h.frame,frame);assert.deepEqual(h.navigations,['/kakeibo']);
});

test('memo, assets and household navigation retain one browsing context, its staged note data and unfinished inputs',()=>{
  const h=fixture();h.context.knOpenMemo();h.ready();const frame=h.frame,doc=frame.contentDocument,child=frame.contentWindow;
  const staged={notes:[{id:'memo',body:'未同期の本文\n末尾  ',pinned:true,future:{keep:true}}],assetTarget:1000000};
  const store={staged:JSON.stringify(staged),pending:{owner:'account-A',body:JSON.stringify(staged)}};
  child.kkMyPageStore=store;doc.draft={assetKind:'入力途中',amount:'１２３．',memo:'日本語の書きかけ'};doc.documentElement.scrollTop=415;
  for(let i=0;i<3;i++){
    assert.equal(h.context.knOpenAssets(),true);assert.equal(h.page.getAttribute('data-mp-view'),'assets');
    assert.equal(h.frame.parentNode.classList.contains('on'),true);assert.equal(h.tabs.hidden,false);
    h.ledger.click();assert.equal(h.page.getAttribute('data-mp-view'),'ledger');
    assert.equal(h.context.knOpenMemo(),true);assert.equal(h.page.getAttribute('data-mp-view'),'memo');
    assert.equal(h.frame,frame);assert.equal(frame.contentDocument,doc);assert.equal(frame.contentWindow,child);assert.equal(child.kkMyPageStore,store);
    assert.deepEqual(JSON.parse(store.staged),staged);assert.equal(store.pending.body,JSON.stringify(staged));
    assert.deepEqual(doc.draft,{assetKind:'入力途中',amount:'１２３．',memo:'日本語の書きかけ'});assert.equal(doc.documentElement.scrollTop,415);
  }
  assert.deepEqual(h.navigations,['/kakeibo']);assert.ok(h.views.every(view=>view==='assets'||view==='ledger'));
});

test('the actual ordinary MyPage opener leaves memo mode and returns to assets without discarding its document',()=>{
  const h=fixture();h.context.knOpenMemo();const frame=h.frame;frame.contentDocument.noteDraft='閉じても残す書きかけ';
  h.close.click();assert.equal(h.page.classList.contains('open'),false);h.card.click();
  assert.equal(h.page.classList.contains('open'),true);assert.equal(h.page.getAttribute('data-mp-view'),'assets');
  assert.equal(h.tabs.children[0].classList.contains('on'),true);assert.equal(h.body.querySelectorAll('.mo-pane:not(.kb-pane)')[3].classList.contains('on'),false);
  const top=h.page.querySelector('.mp-toptabs');
  for(const row of [top,h.tabs]){assert.equal(row.hidden,false);assert.equal(row.inert,false);assert.equal(row.getAttribute('aria-hidden'),null);}
  assert.equal(h.tabs.style.display,'');assert.equal(h.frame,frame);assert.equal(frame.contentDocument.noteDraft,'閉じても残す書きかけ');assert.deepEqual(h.navigations,['/kakeibo']);
  h.context.knOpenMemo();assert.equal(h.page.getAttribute('data-mp-view'),'memo');assert.equal(h.frame,frame);
});

test('a denied memo entry starts no iframe request and creates no deferred memo intent after authentication',()=>{
  for(const user of [null,{id:'guest-A',is_anonymous:true},{id:'account-A'}]){
    const h=fixture(user),frame=h.frame;h.context.knRequireAuth=()=>false;
    assert.equal(h.context.knOpenMemo(),false);assert.equal(h.page.classList.contains('open'),false);assert.equal(h.frame,frame);
    assert.equal(frame.getAttribute('src'),null);assert.deepEqual(h.navigations,[]);assert.equal(h.page.querySelectorAll('.kb-frame').length,1);assert.deepEqual(h.fallbacks,[]);
    h.auth({id:'account-A'});assert.equal(h.page.classList.contains('open'),false);assert.notEqual(h.page.getAttribute('data-mp-view'),'memo');assert.deepEqual(h.navigations,[]);
    h.context.knRequireAuth=()=>true;assert.equal(h.context.knOpenMemo(),true);assert.equal(h.page.getAttribute('data-mp-view'),'memo');assert.deepEqual(h.navigations,['/kakeibo']);
  }
});

test('memo mode survives a same-owner refresh but signout destroys its private frame without queuing a reopen',()=>{
  const h=fixture();h.context.knOpenMemo();const frame=h.frame;frame.contentDocument.noteDraft='所有者Aの下書き';
  h.auth({id:'account-A'});assert.equal(h.page.getAttribute('data-mp-view'),'memo');assert.equal(h.frame,frame);assert.equal(frame.contentDocument.noteDraft,'所有者Aの下書き');assert.deepEqual(h.navigations,['/kakeibo']);
  h.auth(null);assert.equal(h.page.classList.contains('open'),false);assert.notEqual(h.frame,frame);assert.equal(frame.parentNode,null);assert.equal(h.frame.getAttribute('src'),null);
  assert.equal(h.context.knOpenMemo(),false);h.auth({id:'account-A'});
  assert.equal(h.page.classList.contains('open'),false);assert.notEqual(h.page.getAttribute('data-mp-view'),'memo');assert.deepEqual(h.navigations,['/kakeibo']);
});

test('changing owners from memo mode detaches the old save context and returns the new owner to ordinary MyPage',()=>{
  const h=fixture();h.context.knOpenMemo();const previous=h.frame,oldChild=previous.contentWindow;
  previous.contentDocument.noteDraft='所有者Aだけの未保存本文';oldChild.kkMyPageStore={pending:'Aの保存待ち'};
  h.auth({id:'account-B'});assert.notEqual(h.frame,previous);assert.equal(previous.parentNode,null);assert.notEqual(h.frame.contentWindow,oldChild);
  assert.equal(h.page.getAttribute('data-mp-view'),'assets');assert.equal(h.personal.classList.contains('on'),true);assert.equal(h.tabs.children[0].classList.contains('on'),true);
  assert.equal(h.page.querySelector('.mp-toptabs').hidden,false);assert.equal(h.tabs.inert,false);assert.equal(h.tabs.hidden,false);
  assert.equal(h.frame.contentDocument.noteDraft,undefined);assert.equal(h.frame.contentWindow.kkMyPageStore,undefined);assert.deepEqual(h.navigations,['/kakeibo','/kakeibo']);
  const current=h.frame;h.ready({source:oldChild});assert.equal(h.frame,current);assert.equal(h.page.getAttribute('data-mp-view'),'assets');
  assert.equal(h.context.knOpenMemo(),true);assert.equal(h.frame,current);assert.equal(h.page.getAttribute('data-mp-view'),'memo');assert.deepEqual(h.navigations,['/kakeibo','/kakeibo']);
});

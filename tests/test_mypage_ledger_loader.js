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
  const events={},messages={},mutations=[],navigations=[],views=[],registrations=[],fallbacks=[];let refreshes=0,closes=0,menuOpens=0,morningOpens=0,pageAvailable=!options.deferPage;
  class Element {
    constructor(){this.children=[];this.dataset={};this.style={overflow:''};this.attributes={};this.listeners={};this.captureListeners={};this.listenerCounts={};this.srcChanges=[];this.scrollTop=0;this.hidden=false;this.inert=false;this.tagName='DIV';}
    set className(value){this.classes=new Set(value.split(' '));}
    get classList(){return {contains:k=>this.classes?.has(k),add:k=>this.classes.add(k),remove:k=>this.classes.delete(k),toggle:(k,on)=>on?this.classes.add(k):this.classes.delete(k)};}
    appendChild(el){el.parentNode=this;this.children.push(el);return el;}
    contains(el){return el===this||this.children.some(child=>child.contains(el));}
    get isConnected(){return this===doc.body||!!this.parentNode?.isConnected;}
    get parentElement(){return this.parentNode;}
    getBoundingClientRect(){return {left:0,top:0,right:320,bottom:44,width:this.isConnected?320:0,height:this.isConnected?44:0};}
    removeChild(el){this.children.splice(this.children.indexOf(el),1);el.parentNode=null;}
    insertBefore(el,other){el.parentNode=this;this.children.splice(this.children.indexOf(other),0,el);}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    querySelectorAll(selector){
      const descendants=this.children.flatMap(el=>[el,...el.querySelectorAll('*')]),parts=selector.split(/\s+/);
      const matches=(el,part)=>part==='*'||(part==='.mo-pane:not(.kb-pane)'?el.classList.contains('mo-pane')&&!el.classList.contains('kb-pane'):part.startsWith('.')?el.classList.contains(part.slice(1)):el.tagName===part.toUpperCase());
      return descendants.filter(el=>{if(!matches(el,parts.at(-1)))return false;let parent=el.parentNode;for(let i=parts.length-2;i>=0;i--){while(parent&&!matches(parent,parts[i]))parent=parent.parentNode;if(!parent)return false;parent=parent.parentNode;}return true;});
    }
    addEventListener(name,fn,capture){if(capture)(this.captureListeners[name]||(this.captureListeners[name]=[])).push(fn);else this.listeners[name]=fn;this.listenerCounts[name]=(this.listenerCounts[name]||0)+1;}
    emit(name,more={}){let stopped=false;const event={target:this,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.propagationStopped=true;},stopImmediatePropagation(){stopped=true;this.propagationStopped=true;},...more};for(const listener of this.captureListeners[name]||[]){listener(event);if(stopped)return event;}if(name==='click')this.onclick?.(event);if(!stopped)this.listeners[name]?.(event);return event;}
    click(){return this.emit('click');}
    focus(){doc.activeElement=this;}
    setAttribute(name,value){this.attributes[name]=value;if(name==='id')this.id=value;if(name==='inert')this.inert=true;if(name==='hidden')this.hidden=true;if(name==='src'){this.srcChanges.push(value);navigations.push(value);}}
    getAttribute(name){return name==='id'?(this.id??null):this.attributes[name]??null;}
    removeAttribute(name){delete this.attributes[name];if(name==='id')delete this.id;if(name==='inert')this.inert=false;if(name==='hidden')this.hidden=false;}
  }
  const el=cls=>{const n=new Element();n.className=cls;return n;};
  const page=el(''),head=page.appendChild(el('mo-head')),title=head.appendChild(el('')),tabs=page.appendChild(el('mo-tabs')),body=page.appendChild(el('mo-body'));
  title.tagName='SPAN';title.textContent='マイページ';
  const close=head.appendChild(el('mo-x'));close.tagName='BUTTON';
  for(let index=0;index<4;index++){tabs.appendChild(el('mo-tab'+(index===0?' on':'')));body.appendChild(el('mo-pane'+(index===0?' on':'')));}
  tabs.children[3].hidden=true;tabs.children[3].inert=true;tabs.children[3].tabIndex=-1;
  const noteLibrary=body.children[3].appendChild(el('mp-note-library')),noteHeading=noteLibrary.appendChild(el('mp-heading'));noteHeading.tagName='H2';noteHeading.setAttribute('tabindex','-1');
  tabs.children.forEach((tab,index)=>{tab.onclick=()=>{
    tabs.children.forEach((item,i)=>item.classList.toggle('on',i===index));
    body.querySelectorAll('.mo-pane:not(.kb-pane)').forEach((item,i)=>item.classList.toggle('on',i===index));
  };});
  const card=el('');card.tagName='BUTTON';
  const morning=el(''),drawer=el(''),menuClose=drawer.appendChild(el('kn-menu-close')),morningButton=el('');morning.id='morning-section';morning.style.display='block';drawer.id='sideDrawer';drawer.inert=true;drawer.dataset.menuView='display';menuClose.tagName=morningButton.tagName='BUTTON';
  morningButton.onclick=()=>{morningOpens++;doc.body.classList.remove('kn-mypage-active');doc.body.classList.add('view-asaletter');morning.style.display='block';};
  function documentInFrame(n){n.contentDocument={readyState:'complete',documentElement:{getAttribute:()=> 'true'}};n.contentWindow={location:{origin:'https://local.test',protocol:'https:',pathname:'/kakeibo'},kkRefreshRecords(){refreshes++;},kkSetMyPageView(view){views.push(view);}};}
  const doc={readyState:options.readyState||'complete',body:el(''),querySelector:selector=>selector==='#knBottomNav [data-act="morning"]'&&!options.noMorningControl?morningButton:null,getElementById:id=>({myPageOv:pageAvailable?page:null,myPageCard:card,'morning-section':morning,sideDrawer:drawer}[id]),createElement:tag=>{const n=el('');n.tagName=tag.toUpperCase();if(tag==='iframe')documentInFrame(n);return n;},addEventListener:(name,fn,settings)=>{events[name]=fn;registrations.push({target:'document',name,settings});}};
  doc.body.appendChild(morning);doc.body.appendChild(drawer);doc.body.appendChild(morningButton);doc.body.appendChild(page);doc.body.appendChild(card);doc.body.classList.add('view-asaletter');
  const context={document:doc,knUser:user,location:{origin:'https://local.test',search:options.search||''},URLSearchParams,getComputedStyle(node){return {display:node.style.display||((node.classList.contains('mo-pane')&&!node.classList.contains('on'))?'none':'block'),visibility:node.style.visibility||'visible'};},setTimeout(fn,ms){if(!options.deferPage)throw Error('setup should be immediate');fallbacks.push({fn,ms});return fallbacks.length;},MutationObserver:class {constructor(fn){mutations.push(fn);}observe(){}},addEventListener:(name,fn)=>{messages[name]=fn;registrations.push({target:'window',name});}};context.window=context;
  context.knRequireAuth=()=>!!(context.knUser&&(!context.knUser.is_anonymous||options.allowAnonymous));
  context.KNMenuSheet={openMain(){menuOpens++;drawer.dataset.menuView='main';drawer.classList.add('open');drawer.inert=false;menuClose.focus();}};
  card.listeners.click=()=>context.openMy();
  vm.runInNewContext(pageFunctionSource('openMy')+'\n'+pageFunctionSource('closeMy'),context);
  vm.runInNewContext(read('static/mypage-ledger-loader.js'),context);
  close.onclick=()=>{closes++;context.closeMy();};
  const frame=page.querySelector('.kb-frame');if(frame)documentInFrame(frame);
  return {context,page,head,title,tabs,body,close,card,noteLibrary,noteHeading,morning,morningButton,drawer,menuClose,menuOpens:()=>menuOpens,morningOpens:()=>morningOpens,get backdrop(){return doc.body.querySelector('.mp-memo-backdrop');},get frame(){return page.querySelector('.kb-frame');},get personal(){return page.querySelector('.mp-toptabs')?.children[0]||null;},get ledger(){return page.querySelector('.mp-toptabs')?.children[1]||null;},mutations,navigations,views,registrations,fallbacks,refreshes:()=>refreshes,closes:()=>closes,publishPage(){pageAvailable=true;},domReady(){doc.readyState='interactive';const listener=events.DOMContentLoaded;if(listener){const registration=registrations.find(item=>item.target==='document'&&item.name==='DOMContentLoaded');if(registration?.settings?.once)delete events.DOMContentLoaded;listener();}},runFallbacks(){while(fallbacks.length)fallbacks.shift().fn();},auth(user){context.knUser=user;events.knAuthChange();},ready(event={}){messages.message({origin:context.location.origin,source:page.querySelector('.kb-frame').contentWindow,data:{type:'kn-kakeibo-ready'},...event});}};
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
  let isReady=false;frame.contentDocument.documentElement.getAttribute=()=>isReady?'true':null;
  const editor=h.context.document.createElement('section');editor.className='mp-note-editor';editor.hidden=true;panes[3].appendChild(editor);
  assert.equal(h.context.knOpenMemo(),true);assert.equal(h.page.classList.contains('open'),true);
  assert.equal(h.page.getAttribute('data-mp-view'),'memo');assert.deepEqual(panes.map(p=>p.classList.contains('on')),[false,false,false,true]);
  assert.equal(h.frame,frame);assert.equal(frame.parentNode.classList.contains('on'),false);assert.deepEqual(h.navigations,['/kakeibo']);
  assert.equal(frame.getAttribute('loading'),'eager');assert.equal(h.page.querySelectorAll('.kb-frame').length,1);
  const privatePane=frame.parentNode;
  assert.equal(privatePane.classList.contains('mp-memo-warming'),true);assert.equal(privatePane.inert,true);assert.equal(privatePane.getAttribute('aria-hidden'),'true');assert.equal(frame.getAttribute('aria-busy'),'true');
  h.ready({origin:'https://other.test'});h.ready({source:{}});h.ready();
  assert.equal(privatePane.classList.contains('mp-memo-warming'),true,'untrusted messages or a frame without its readiness marker must not finish warming');
  h.context.knOpenAssets();assert.equal(privatePane.classList.contains('mp-memo-warming'),false);assert.equal(privatePane.inert,false);assert.equal(privatePane.getAttribute('aria-hidden'),null);
  h.context.knOpenMemo();assert.equal(privatePane.classList.contains('mp-memo-warming'),true);
  h.ledger.click();assert.equal(privatePane.classList.contains('mp-memo-warming'),false);assert.equal(privatePane.inert,false);assert.equal(privatePane.getAttribute('aria-hidden'),null);
  h.context.knOpenMemo();assert.equal(privatePane.classList.contains('mp-memo-warming'),true);
  isReady=true;h.ready();
  assert.equal(privatePane.classList.contains('mp-memo-warming'),false);assert.equal(privatePane.inert,true);assert.equal(privatePane.getAttribute('aria-hidden'),'true');assert.equal(privatePane.classList.contains('on'),false);assert.equal(frame.getAttribute('aria-busy'),null);
  assert.equal(h.frame,frame);assert.equal(h.page.querySelectorAll('.kb-frame').length,1);assert.deepEqual(h.navigations,['/kakeibo']);
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
    assert.equal(frame.parentNode.classList.contains('mp-memo-warming'),false);assert.equal(frame.parentNode.inert,false);assert.equal(frame.parentNode.getAttribute('aria-hidden'),null);
    h.ledger.click();assert.equal(h.page.getAttribute('data-mp-view'),'ledger');
    assert.equal(frame.parentNode.classList.contains('mp-memo-warming'),false);assert.equal(frame.parentNode.inert,false);assert.equal(frame.parentNode.getAttribute('aria-hidden'),null);
    assert.equal(h.context.knOpenMemo(),true);assert.equal(h.page.getAttribute('data-mp-view'),'memo');
    assert.equal(frame.parentNode.classList.contains('mp-memo-warming'),false);assert.equal(frame.parentNode.inert,true);assert.equal(frame.parentNode.getAttribute('aria-hidden'),'true');
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
  const h=fixture();h.frame.contentDocument.documentElement.getAttribute=()=>null;h.context.knOpenMemo();const previous=h.frame,oldChild=previous.contentWindow;
  assert.equal(previous.parentNode.classList.contains('mp-memo-warming'),true);assert.equal(previous.parentNode.inert,true);
  previous.contentDocument.noteDraft='所有者Aだけの未保存本文';oldChild.kkMyPageStore={pending:'Aの保存待ち'};
  h.auth({id:'account-B'});assert.notEqual(h.frame,previous);assert.equal(previous.parentNode,null);assert.notEqual(h.frame.contentWindow,oldChild);
  assert.equal(h.page.getAttribute('data-mp-view'),'assets');assert.equal(h.personal.classList.contains('on'),true);assert.equal(h.tabs.children[0].classList.contains('on'),true);
  assert.equal(h.page.querySelector('.mp-toptabs').hidden,false);assert.equal(h.tabs.inert,false);assert.equal(h.tabs.hidden,false);
  assert.equal(h.frame.parentNode.classList.contains('mp-memo-warming'),false);assert.equal(h.frame.parentNode.inert,false);assert.equal(h.frame.parentNode.getAttribute('aria-hidden'),null);
  assert.equal(h.frame.contentDocument.noteDraft,undefined);assert.equal(h.frame.contentWindow.kkMyPageStore,undefined);assert.deepEqual(h.navigations,['/kakeibo','/kakeibo']);
  const current=h.frame;h.ready({source:oldChild});assert.equal(h.frame,current);assert.equal(h.page.getAttribute('data-mp-view'),'assets');
  assert.equal(h.context.knOpenMemo(),true);assert.equal(h.frame,current);assert.equal(h.page.getAttribute('data-mp-view'),'memo');assert.deepEqual(h.navigations,['/kakeibo','/kakeibo']);
});

test('only memo entry applies dialog semantics, a sibling backdrop and scroll locking, restoring exact previous presentation on a view switch',()=>{
  const h=fixture(),doc=h.context.document;
  h.page.setAttribute('role','region');h.page.setAttribute('aria-modal','false');h.page.setAttribute('aria-label','以前のラベル');h.page.setAttribute('aria-labelledby','existing-title');h.page.setAttribute('tabindex','3');h.title.setAttribute('id','existing-title');h.title.setAttribute('data-i18n','g2_mp_title');doc.body.style.overflow='auto';h.card.focus();
  const body=h.body,frame=h.frame,parent=frame.parentNode;h.context.knOpenMemo();
  assert.equal(h.page.getAttribute('role'),'dialog');assert.equal(h.page.getAttribute('aria-modal'),'true');assert.equal(h.page.getAttribute('aria-labelledby'),'existing-title');assert.equal(h.page.getAttribute('aria-label'),null);assert.equal(h.title.textContent,'自由メモ');assert.equal(h.title.getAttribute('data-i18n'),'g2_mp_tab_memo');h.title.textContent='Notes';
  assert.equal(doc.body.classList.contains('kn-memo-dialog-active'),true);assert.equal(doc.body.style.overflow,'hidden');assert.equal(h.backdrop.hidden,false);assert.equal(h.backdrop.inert,false);assert.equal(h.backdrop.parentNode,doc.body);assert.equal(h.page.contains(h.backdrop),false);
  h.ledger.click();assert.equal(h.page.getAttribute('data-mp-view'),'ledger');assert.equal(h.page.getAttribute('role'),'region');assert.equal(h.page.getAttribute('aria-modal'),'false');assert.equal(h.page.getAttribute('aria-label'),'以前のラベル');assert.equal(h.page.getAttribute('aria-labelledby'),'existing-title');assert.equal(h.page.getAttribute('tabindex'),'3');assert.equal(h.title.textContent,'マイページ');assert.equal(h.title.id,'existing-title');assert.equal(h.title.getAttribute('data-i18n'),'g2_mp_title');
  assert.equal(doc.body.style.overflow,'auto');assert.equal(doc.body.classList.contains('kn-memo-dialog-active'),false);assert.equal(h.backdrop.hidden,true);assert.equal(h.backdrop.inert,true);assert.equal(h.body,body);assert.equal(h.frame,frame);assert.equal(h.frame.parentNode,parent);assert.equal(doc.body.querySelectorAll('.mp-memo-backdrop').length,1);
  h.close.click();assert.equal(h.closes(),1,'ordinary MyPage keeps its original closeMy handler');assert.equal(doc.body.classList.contains('view-asaletter'),true);
});

test('memo X, backdrop and Escape close once through ordinary navigation then open the hamburger main menu',()=>{
  for(const mode of ['x','backdrop','escape']){
    const h=fixture(),doc=h.context.document,opener=doc.createElement('button');doc.body.appendChild(opener);opener.focus();doc.body.style.overflow='scroll';doc.body.classList.add('underlying-screen');h.morning.style.display='none';doc.body.classList.remove('view-asaletter');doc.body.classList.add('kn-mypage-active');h.context.knOpenMemo();const frame=h.frame,privateDoc=frame.contentDocument;assert.equal(h.morning.style.display,'none');assert.equal(doc.body.classList.contains('view-asaletter'),false);assert.equal(h.drawer.classList.contains('open'),false);
    if(mode==='x'){h.close.focus();h.close.click();}else if(mode==='backdrop')h.backdrop.click();else{const event=h.page.emit('keydown',{key:'Escape',target:h.noteHeading});assert.equal(event.defaultPrevented,true);assert.equal(event.propagationStopped,true);}
    assert.equal(h.page.classList.contains('open'),false);assert.equal(h.closes(),1);assert.equal(h.morningOpens(),1);assert.equal(h.morning.style.display,'block');assert.equal(doc.body.classList.contains('view-asaletter'),true);assert.equal(doc.body.classList.contains('kn-mypage-active'),false);assert.equal(doc.body.classList.contains('underlying-screen'),true);assert.equal(h.drawer.classList.contains('open'),true);assert.equal(h.drawer.dataset.menuView,'main');assert.equal(h.drawer.inert,false);assert.equal(h.menuOpens(),1);assert.equal(doc.activeElement,h.menuClose);assert.equal(doc.body.style.overflow,'scroll');assert.equal(h.backdrop.hidden,true);assert.equal(h.page.getAttribute('role'),null);assert.equal(h.title.textContent,'マイページ');assert.equal(h.title.getAttribute('id'),null);assert.equal(h.frame,frame);assert.equal(frame.contentDocument,privateDoc);
    h.backdrop.click();h.page.emit('keydown',{key:'Escape',target:h.noteHeading});assert.equal(h.closes(),1,'the detached memo session cannot close the page twice');assert.equal(h.menuOpens(),1);
  }
});

test('assets to memo to explicit close preserves assets state and scroll while closing the page and opening the menu',()=>{
  const h=fixture();h.context.knOpenAssets();h.body.scrollTop=418;const frame=h.frame,doc=frame.contentDocument,child=frame.contentWindow;doc.draft='資産の入力途中';h.personal.focus();
  h.context.knOpenMemo();h.body.scrollTop=827;h.close.focus();h.close.click();assert.equal(h.page.classList.contains('open'),false);assert.equal(h.page.getAttribute('data-mp-view'),'assets');assert.equal(h.body.scrollTop,418);assert.equal(h.frame,frame);assert.equal(frame.contentDocument,doc);assert.equal(frame.contentWindow,child);assert.equal(doc.draft,'資産の入力途中');assert.equal(h.context.document.activeElement,h.menuClose);assert.equal(h.closes(),1);assert.equal(h.menuOpens(),1);assert.equal(h.drawer.classList.contains('open'),true);assert.equal(h.backdrop.hidden,true);
  h.context.knOpenAssets();h.context.knOpenMemo();h.auth({id:'account-A'});assert.equal(h.page.getAttribute('data-mp-view'),'memo','same-owner refresh must not apply a deferred assets intent');h.backdrop.click();assert.equal(h.page.getAttribute('data-mp-view'),'assets');assert.equal(h.body.scrollTop,418);assert.equal(h.page.classList.contains('open'),false);assert.equal(h.closes(),2);assert.equal(h.menuOpens(),2);assert.deepEqual(h.navigations,['/kakeibo']);
});

test('ledger to memo close preserves its context and scroll histories behind the reopened menu',()=>{
  const h=fixture();h.context.knOpenAssets();h.body.scrollTop=760;h.ledger.click();h.body.scrollTop=312;const frame=h.frame,doc=frame.contentDocument,child=frame.contentWindow;doc.draft={amount:'１２３．',memo:'家計簿の入力途中'};h.ledger.focus();
  h.context.knOpenMemo();h.body.scrollTop=950;h.page.emit('keydown',{key:'Escape',target:h.noteHeading});assert.equal(h.page.classList.contains('open'),false);assert.equal(h.page.getAttribute('data-mp-view'),'ledger');assert.equal(h.body.scrollTop,312);assert.equal(h.ledger.classList.contains('on'),true);assert.equal(h.frame,frame);assert.equal(frame.contentDocument,doc);assert.equal(frame.contentWindow,child);assert.deepEqual(doc.draft,{amount:'１２３．',memo:'家計簿の入力途中'});assert.equal(h.context.document.activeElement,h.menuClose);assert.equal(h.drawer.classList.contains('open'),true);
  h.personal.click();assert.equal(h.body.scrollTop,760,'memo scroll must not replace the remembered personal-page scroll');assert.equal(h.page.getAttribute('data-mp-view'),'assets');assert.deepEqual(h.navigations,['/kakeibo']);assert.equal(h.closes(),1);assert.equal(h.menuOpens(),1);
});

test('memo opened over a closed page stays closed on local close and external close or auth loss never restores a former open view',()=>{
  const closed=fixture();closed.context.knOpenMemo();closed.backdrop.click();assert.equal(closed.page.classList.contains('open'),false);
  for(const reason of ['external-close','signout']){const h=fixture();h.context.knOpenAssets();h.body.scrollTop=418;h.context.knOpenMemo();
    if(reason==='external-close'){h.page.classList.remove('open');h.mutations.forEach(fn=>fn());}else{h.auth(null);h.auth({id:'account-A'});}
    assert.equal(h.page.classList.contains('open'),false);assert.equal(h.backdrop.hidden,true);assert.equal(h.context.document.body.classList.contains('kn-memo-dialog-active'),false);
  }
});

test('memo Tab boundaries include current nested controls and exclude hidden, inert, disabled and warming-frame controls',()=>{
  const h=fixture(),doc=h.context.document,search=doc.createElement('input'),last=doc.createElement('div');last.setAttribute('contenteditable','true');h.noteLibrary.appendChild(search);
  for(const kind of ['hidden','inert','style','disabled','negative']){const wrapper=doc.createElement('div'),button=doc.createElement('button');wrapper.appendChild(button);h.noteLibrary.appendChild(wrapper);if(kind==='hidden')wrapper.hidden=true;if(kind==='inert')wrapper.inert=true;if(kind==='style')wrapper.style.display='none';if(kind==='disabled')button.disabled=true;if(kind==='negative')button.setAttribute('tabindex','-1');}
  h.noteLibrary.appendChild(last);const privateButton=doc.createElement('button');h.frame.parentNode.appendChild(privateButton);h.frame.contentDocument.documentElement.getAttribute=()=>null;
  h.context.knOpenMemo();assert.equal(doc.activeElement,h.noteHeading);const firstTab=h.page.emit('keydown',{key:'Tab',target:h.noteHeading});assert.equal(firstTab.defaultPrevented,true);assert.equal(doc.activeElement,h.close);
  h.page.emit('keydown',{key:'Tab',shiftKey:true,target:h.close});assert.equal(doc.activeElement,last);h.page.emit('keydown',{key:'Tab',target:last});assert.equal(doc.activeElement,h.close);
  search.focus();const middle=h.page.emit('keydown',{key:'Tab',target:search});assert.notEqual(middle.defaultPrevented,true,'ordinary browser traversal inside the dialog is retained');
  const composing=h.page.emit('keydown',{key:'Escape',isComposing:true,target:search});assert.notEqual(composing.defaultPrevented,true);assert.equal(h.page.classList.contains('open'),true);
});

test('memo tab order retains rendered note controls below the scroll fold while offscreen opener restoration stays guarded',()=>{
  const h=fixture(),doc=h.context.document,before=doc.createElement('button'),last=doc.createElement('button'),opener=doc.createElement('button');h.context.innerHeight=600;h.context.innerWidth=390;
  h.noteLibrary.appendChild(before);h.noteLibrary.appendChild(last);doc.body.appendChild(opener);
  last.getBoundingClientRect=opener.getBoundingClientRect=()=>({left:24,top:1000,right:344,bottom:1044,width:320,height:44});opener.focus();h.context.knOpenMemo();before.focus();
  const forward=h.page.emit('keydown',{key:'Tab',target:before});assert.notEqual(forward.defaultPrevented,true,'browser traversal must reach and scroll to the next real note instead of wrapping at the current viewport fold');assert.equal(doc.activeElement,before);
  last.focus();const end=h.page.emit('keydown',{key:'Tab',target:last});assert.equal(end.defaultPrevented,true);assert.equal(doc.activeElement,h.close);
  const reverse=h.page.emit('keydown',{key:'Tab',shiftKey:true,target:h.close});assert.equal(reverse.defaultPrevented,true);assert.equal(doc.activeElement,last,'the true last rendered control remains the reverse boundary even below the fold');
  h.close.focus();h.close.click();assert.equal(doc.activeElement,h.menuClose,'closing memo focuses the visible menu instead of restoring an offscreen opener');assert.equal(h.menuOpens(),1);
});

test('memo Tab boundaries include the rich editing host but never its inherited editable paragraphs or spans',()=>{
  const h=fixture(),doc=h.context.document,host=doc.createElement('div'),paragraph=doc.createElement('p'),span=doc.createElement('span');
  host.setAttribute('contenteditable','true');host.isContentEditable=paragraph.isContentEditable=span.isContentEditable=true;paragraph.appendChild(span);host.appendChild(paragraph);h.noteLibrary.appendChild(host);
  paragraph.focus=span.focus=()=>assert.fail('inherited editable descendants are not actual sequential focus stops');
  h.context.knOpenMemo();h.close.focus();const reverse=h.page.emit('keydown',{key:'Tab',shiftKey:true,target:h.close});assert.equal(reverse.defaultPrevented,true);assert.equal(doc.activeElement,host);
  const end=h.page.emit('keydown',{key:'Tab',target:host});assert.equal(end.defaultPrevented,true);assert.equal(doc.activeElement,h.close);
  span.setAttribute('tabindex','0');let explicitFocus=0;span.focus=()=>{explicitFocus++;doc.activeElement=span;};h.page.emit('keydown',{key:'Tab',shiftKey:true,target:h.close});assert.equal(explicitFocus,1,'an explicit tabindex may opt a descendant into keyboard traversal');assert.equal(doc.activeElement,span);
});

test('closing and reopening memo during pending sync preserves exact editor, selection, text, frame documents and pending store data',()=>{
  const h=fixture(),doc=h.context.document,editor=doc.createElement('section'),input=doc.createElement('textarea');editor.className='mp-note-editor';editor.setAttribute('tabindex','-1');editor.appendChild(input);h.body.children[3].appendChild(editor);h.noteLibrary.hidden=true;
  input.value='未同期の本文\n末尾  ';input.selectionStart=2;input.selectionEnd=6;input.scrollTop=113;
  h.card.focus();h.context.knOpenMemo();const frame=h.frame,privateDoc=frame.contentDocument,child=frame.contentWindow,parent=frame.parentNode,originalBody=h.body,staged={notes:[{id:'same',body:input.value,richText:{keep:'unknown metadata'}}],assetTarget:1000000};
  let writes=0;child.kkMyPageStore={pending:JSON.stringify(staged),stage(){writes++;},save(){writes++;}};privateDoc.draft={amount:'１２３．',memo:'別画面の下書き'};input.focus();h.page.emit('focusin',{target:input});h.close.focus();h.close.click();
  assert.equal(h.context.knOpenMemo(),true);assert.equal(doc.activeElement,input);assert.equal(h.body,originalBody);assert.equal(h.page.querySelector('.mp-note-editor'),editor);assert.equal(editor.children[0],input);assert.equal(input.value,staged.notes[0].body);assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,6);assert.equal(input.scrollTop,113);
  assert.equal(h.frame,frame);assert.equal(frame.parentNode,parent);assert.equal(frame.contentDocument,privateDoc);assert.equal(frame.contentWindow,child);assert.deepEqual(JSON.parse(child.kkMyPageStore.pending),staged);assert.deepEqual(privateDoc.draft,{amount:'１２３．',memo:'別画面の下書き'});assert.equal(writes,0);assert.deepEqual(h.navigations,['/kakeibo']);assert.equal(doc.body.querySelectorAll('.mp-memo-backdrop').length,1);
});

test('auth loss and externally changed views restore memo presentation without stealing an external modal focus',()=>{
  for(const reason of ['signout','owner','view','closed']){const h=fixture(),doc=h.context.document,auth=doc.createElement('input');doc.body.appendChild(auth);doc.body.style.overflow='auto';h.context.knOpenMemo();auth.focus();
    if(reason==='signout')h.auth(null);else if(reason==='owner')h.auth({id:'account-B'});else{if(reason==='view')h.page.setAttribute('data-mp-view','assets');else h.page.classList.remove('open');h.mutations.forEach(fn=>fn());}
    assert.equal(doc.activeElement,auth);assert.equal(h.backdrop.hidden,true);assert.equal(h.backdrop.inert,true);assert.equal(doc.body.style.overflow,'auto');assert.equal(doc.body.classList.contains('kn-memo-dialog-active'),false);assert.equal(h.page.getAttribute('role'),null);assert.equal(h.title.textContent,'マイページ');assert.equal(h.menuOpens(),0,'auth loss or external navigation must never reopen the hamburger');assert.equal(h.drawer.classList.contains('open'),false);
  }
});

test('denied memo entry and repeated setup create no modal lock or extra backdrop and same-owner refresh retains the active dialog',()=>{
  const h=fixture(),doc=h.context.document;doc.body.style.overflow='auto';h.context.knRequireAuth=()=>false;h.card.focus();assert.equal(h.context.knOpenMemo(),false);assert.equal(h.backdrop.hidden,true);assert.equal(doc.body.style.overflow,'auto');assert.equal(h.page.getAttribute('role'),null);assert.equal(doc.activeElement,h.card);
  h.context.knRequireAuth=()=>true;h.context.knOpenMemo();const backdrop=h.backdrop,frame=h.frame;h.auth({id:'account-A'});h.context.knOpenMemo();h.domReady();h.runFallbacks();
  assert.equal(h.backdrop,backdrop);assert.equal(h.frame,frame);assert.equal(doc.body.querySelectorAll('.mp-memo-backdrop').length,1);assert.equal(h.page.getAttribute('role'),'dialog');assert.equal(h.title.textContent,'自由メモ');assert.equal(doc.body.style.overflow,'hidden');
});


test('memo close without an ordinary close control restores the hidden background and opens the menu once',()=>{
  const h=fixture(undefined,{noMorningControl:true}),doc=h.context.document;h.morning.style.display='none';doc.body.classList.remove('view-asaletter');doc.body.classList.add('kn-mypage-active');h.context.knOpenMemo();const frame=h.frame;assert.equal(h.morning.style.display,'none');h.head.removeChild(h.close);
  h.backdrop.click();assert.equal(h.page.classList.contains('open'),false);assert.equal(h.morning.style.display,'block');assert.equal(doc.body.classList.contains('view-asaletter'),true);assert.equal(doc.body.classList.contains('kn-mypage-active'),false);assert.equal(h.closes(),0);assert.equal(h.menuOpens(),1);assert.equal(h.drawer.classList.contains('open'),true);assert.equal(doc.activeElement,h.menuClose);assert.equal(h.frame,frame);assert.equal(h.backdrop.hidden,true);
});

test('explicit memory preparation warms the same private document without opening MyPage or changing views',()=>{
 const h=fixture();const frame=h.frame,group=h.page.getAttribute('data-mp-view'),scroll=h.body.scrollTop;assert.equal(h.frame.getAttribute('src'),null);h.context.knPrepareAssistantMemory();assert.equal(h.frame,frame);assert.deepEqual(h.navigations,['/kakeibo']);assert.equal(h.page.classList.contains('open'),false);assert.equal(h.body.scrollTop,scroll);assert.equal(h.page.getAttribute('data-mp-view'),group);assert.equal(h.morning.style.display,'block');
 h.context.knPrepareAssistantMemory();assert.equal(h.frame,frame);assert.deepEqual(h.navigations,['/kakeibo']);h.card.click();assert.equal(h.frame,frame);assert.deepEqual(h.navigations,['/kakeibo']);
});
test('memory preparation never creates an account and owner change discards its old frame before another explicit warm',()=>{
 const absent=fixture(null);absent.context.knPrepareAssistantMemory();assert.equal(absent.frame.getAttribute('src'),null);assert.deepEqual(absent.navigations,[]);assert.equal(absent.page.classList.contains('open'),false);
 const h=fixture();h.context.knPrepareAssistantMemory();const old=h.frame;h.auth({id:'account-B'});assert.notEqual(h.frame,old);assert.equal(h.frame.getAttribute('src'),null);assert.equal(h.page.classList.contains('open'),false);h.context.knPrepareAssistantMemory();assert.deepEqual(h.navigations,['/kakeibo','/kakeibo']);assert.equal(h.page.classList.contains('open'),false);
});

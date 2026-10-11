'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function fixture(user={id:'account-A'}) {
  const events={},messages={},mutations=[],navigations=[];let refreshes=0;
  class Element {
    constructor(){this.children=[];this.dataset={};this.style={};this.attributes={};this.listeners={};this.srcChanges=[];}
    set className(value){this.classes=new Set(value.split(' '));}
    get classList(){return {contains:k=>this.classes?.has(k),add:k=>this.classes.add(k),remove:k=>this.classes.delete(k),toggle:(k,on)=>on?this.classes.add(k):this.classes.delete(k)};}
    appendChild(el){el.parentNode=this;this.children.push(el);return el;}
    removeChild(el){this.children.splice(this.children.indexOf(el),1);el.parentNode=null;}
    insertBefore(el,other){el.parentNode=this;this.children.splice(this.children.indexOf(other),0,el);}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    querySelectorAll(selector){let descendants=this.children.flatMap(el=>[el,...el.querySelectorAll('*')]);return descendants.filter(el=>selector==='*'||(selector==='.mo-pane:not(.kb-pane)'?el.classList.contains('mo-pane')&&!el.classList.contains('kb-pane'):el.classList.contains(selector.slice(1))));}
    addEventListener(name,fn){this.listeners[name]=fn;}
    click(){this.listeners.click?.();}
    setAttribute(name,value){this.attributes[name]=value;if(name==='src'){this.srcChanges.push(value);navigations.push(value);}}
    getAttribute(name){return this.attributes[name]??null;}
    removeAttribute(name){delete this.attributes[name];}
  }
  const el=cls=>{const n=new Element();n.className=cls;return n;};
  const page=el(''),tabs=page.appendChild(el('mo-tabs')),body=page.appendChild(el('mo-body'));
  tabs.appendChild(el('mo-tab on'));tabs.appendChild(el('mo-tab'));
  body.appendChild(el('mo-pane on'));body.appendChild(el('mo-pane'));
  const card=el('');
  const doc={readyState:'complete',getElementById:id=>({myPageOv:page,myPageCard:card}[id]),createElement:tag=>{const n=el('');if(tag==='iframe'){n.contentDocument={documentElement:{getAttribute:()=> 'true'}};n.contentWindow={kkRefreshRecords(){refreshes++;}};}return n;},addEventListener:(name,fn)=>events[name]=fn};
  const context={document:doc,knUser:user,location:{origin:'https://local.test'},setTimeout(){throw Error('setup should be immediate');},MutationObserver:class {constructor(fn){mutations.push(fn);}observe(){}},addEventListener:(name,fn)=>messages[name]=fn};context.window=context;
  vm.runInNewContext(read('static/mypage-ledger-loader.js'),context);
  const frame=page.querySelector('.kb-frame'),top=page.querySelector('.mp-toptabs'),personal=top.children[0],ledger=top.children[1];
  frame.contentDocument={documentElement:{getAttribute:()=> 'true'}};frame.contentWindow={kkRefreshRecords(){refreshes++;}};
  card.listeners.click=()=>{if(context.knUser&&!context.knUser.is_anonymous){page.classList.add('open');context.knPrepareLedger();}};
  return {context,page,get frame(){return page.querySelector('.kb-frame');},personal,ledger,mutations,navigations,refreshes:()=>refreshes,auth(user){context.knUser=user;events.knAuthChange();},ready(event={}){messages.message({origin:context.location.origin,source:page.querySelector('.kb-frame').contentWindow,data:{type:'kn-kakeibo-ready'},...event});}};
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
  assert.match(html,/mypage-ledger-loader\.js\?v=20261012-fast1/);
  assert.doesNotMatch(html,/__kf2.*removeAttribute\('src'\)/);
  assert.match(html,/var kakeibo=mkItem\("📒 家計簿",function\(\)\{CD\(\);if\(window\.knOpenLedger\)window\.knOpenLedger\(\);\}\)/);
});

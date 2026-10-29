'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {install}=require('../static/guide-hub.js');

// This fixture models DOM identity, native listener dispatch and focus. It does
// not recreate the hub's selection, opening or closing implementation.
function harness({ready=true,chatReady=true,language='ja'}={}) {
  const events=new Map(),scheduled=[],log=[],storage=new Map([
    ['bg_guide_v1','{"s0":true}'],
    ['knChatHist_v1','[{"role":"user","content":"existing question"}]'],
    ['knChatInterests_v1','[{"t":"existing interest","ts":1}]'],
    ['kn_home_motion_paused','1'],
    ['kn_community_drafts_v1','{"all":{"body":"community draft"}}'],
    ['kn_stock_talk_drafts_v1','{"stock:7203":{"body":"stock draft"}}']
  ]);
  let document,window,network=0,storageWrites=0,oldOpenCalls=0,oldCloseCalls=0;
  function matches(node,selector){
    const tag=selector.match(/^[a-z]+/i)?.[0];if(tag&&node.tagName!==tag.toUpperCase())return false;
    for(const [,id] of selector.matchAll(/#([\w-]+)/g))if(node.id!==id)return false;
    for(const [,cls] of selector.matchAll(/\.([\w-]+)/g))if(!node.classList.contains(cls))return false;
    for(const [,name,,value] of selector.matchAll(/\[([\w-]+)(?:=(['"]?)([^\]'"\s]+)\2)?\]/g)){
      if(value===undefined?node.getAttribute(name)===null:node.getAttribute(name)!==value)return false;
    }
    return true;
  }
  class Node {
    constructor(tag){
      this.tagName=tag.toUpperCase();this.nodeType=1;this.children=[];this.parentNode=null;
      this.attributes={};this.dataset={};this.events=new Map();this.classes=new Set();this._text='';
      this.style={setProperty(name,value){this[name]=String(value);},getPropertyValue(name){return this[name]||'';},removeProperty(name){delete this[name];}};
      this.hidden=false;this.value='';this.scrollTop=0;this.scrollLeft=0;this.tabIndex=-1;
      this.classList={add:(...names)=>names.forEach(name=>this.classes.add(name)),remove:(...names)=>names.forEach(name=>this.classes.delete(name)),contains:name=>this.classes.has(name),toggle:(name,force)=>{const yes=force===undefined?!this.classes.has(name):!!force;if(yes)this.classes.add(name);else this.classes.delete(name);return yes;}};
    }
    get ownerDocument(){return document;}get parentElement(){return this.parentNode;}
    get childNodes(){return this.children;}get firstChild(){return this.children[0]||null;}
    get firstElementChild(){return this.firstChild;}get lastChild(){return this.children.at(-1)||null;}
    get isConnected(){return this===document.body||!!this.parentNode?.isConnected;}
    set id(value){this.attributes.id=String(value);}get id(){return this.attributes.id||'';}
    set className(value){this.classes=new Set(String(value).split(/\s+/).filter(Boolean));}get className(){return [...this.classes].join(' ');}
    set textContent(value){this._text=String(value);this.replaceChildren();}get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
    set innerHTML(value){this._html=String(value);this._text='';this.replaceChildren();}get innerHTML(){return this._html||'';}
    setAttribute(name,value){this.attributes[name]=String(value);if(name==='tabindex')this.tabIndex=Number(value);}
    getAttribute(name){return this.attributes[name]??null;}hasAttribute(name){return name in this.attributes;}
    removeAttribute(name){delete this.attributes[name];}
    appendChild(child){child.parentNode?.removeChild(child);this.children.push(child);child.parentNode=this;return child;}
    append(...children){children.forEach(child=>this.appendChild(typeof child==='string'?document.createTextNode(child):child));}
    insertBefore(child,before){child.parentNode?.removeChild(child);const index=this.children.indexOf(before);this.children.splice(index<0?this.children.length:index,0,child);child.parentNode=this;return child;}
    removeChild(child){const index=this.children.indexOf(child);assert.ok(index>=0,'Only attached children can be removed');this.children.splice(index,1);child.parentNode=null;return child;}
    replaceChildren(...children){this.children.forEach(child=>child.parentNode=null);this.children=[];children.forEach(child=>this.appendChild(child));}
    remove(){this.parentNode?.removeChild(this);}
    contains(child){return child===this||this.children.some(node=>node.contains(child));}
    matches(selector){return selector.split(',').some(part=>matches(this,part.trim()));}
    closest(selector){for(let node=this;node;node=node.parentNode)if(node.matches(selector))return node;return null;}
    querySelectorAll(selector){const result=[];const parts=selector.split(',').map(part=>part.trim());function walk(node){for(const child of node.children){if(parts.some(part=>matches(child,part)))result.push(child);walk(child);}}walk(this);return result;}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    addEventListener(type,fn){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(fn);}
    removeEventListener(type,fn){this.events.get(type)?.delete(fn);}
    emit(type,detail={}){const event={type,target:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...detail};for(let node=this;node;node=node.parentNode){for(const fn of [...(node.events.get(type)||[])])fn(event);if(event.stopped)break;}if(!event.stopped)dispatch(type,event);return event;}
    click(){this.emit('click');}
    focus(options){document.activeElement=this;log.push(['focus',this.id,options]);}
    getBoundingClientRect(){for(let node=this;node;node=node.parentNode)if(node.hidden||(node.id==='bgModal'&&!node.classList.contains('bg-open'))||(node.id==='knChatPanel'&&!node.classList.contains('open')))return{width:0,height:0};return{width:280,height:44};}
  }
  function dispatch(type,detail={}){const event={type,preventDefault(){this.defaultPrevented=true;},...detail};for(const fn of [...(events.get(type)||[])])fn(event);return event;}
  document={readyState:ready?'complete':'loading',activeElement:null,createElement:tag=>new Node(tag),createTextNode(text){const n=new Node('text');n.nodeType=3;n.textContent=text;return n;},
    addEventListener(type,fn){if(!events.has(type))events.set(type,new Set());events.get(type).add(fn);},removeEventListener(type,fn){events.get(type)?.delete(fn);},
    getElementById(id){return this.body.id===id?this.body:this.body.querySelector('#'+id);},querySelector(selector){return this.body.querySelector(selector);},querySelectorAll(selector){return this.body.querySelectorAll(selector);}};
  document.body=new Node('body');document.documentElement=new Node('html');document.documentElement.lang=language;
  const make=(tag,id,parent)=>{const n=new Node(tag);if(id)n.id=id;if(parent)parent.appendChild(n);return n;};
  const entrance=make('button','question-entry',document.body);entrance.className='kn-orbit-guide';document.activeElement=entrance;
  const morning=make('section','morning-section',document.body);morning.scrollTop=431;
  const modal=make('div','bgModal',document.body),sheet=make('div','bgSheet',modal);
  const oldClose=make('button','',sheet);oldClose.className='bg-close';oldClose.textContent='✕';
  const heading=make('h2','existing-guide-title',sheet);heading.textContent='🧭 はじめてガイド';
  const intro=make('div','existing-guide-intro',sheet);intro.className='bg-sub';intro.textContent='existing guide intro';
  const quiz=make('div','existing-guide-quiz',sheet);quiz.className='bg-box';
  for(const id of ['bgQ','bgBtns','bgResult','bgTip','bgCta'])make('div',id,quiz);
  const checklist=make('div','existing-guide-checklist',sheet);checklist.className='bg-box';
  for(const id of ['bgBar','bgPct','bgList'])make('div',id,checklist);
  const faq=make('div','existing-guide-faq',sheet);faq.className='bg-box';for(let i=0;i<23;i++){const d=make('details','existing-faq-'+i,faq);d.className='bg-q';}
  const originalGuideNodes=[heading,intro,quiz,checklist,faq];
  const panel=make('div','knChatPanel',document.body);panel.className='kn-chat-panel';panel.setAttribute('role','dialog');
  const input=make('textarea','knChatInput',panel);input.value='unfinished existing question';
  make('button','knChatSend',panel);make('button','knChatX',panel);make('div','knChatBody',panel);
  const chatCalls=[];const chatAPI={open(options){chatCalls.push({action:'open',options});panel.classList.add('open');if(options?.focusInput)input.focus();},close(){chatCalls.push({action:'close'});panel.classList.remove('open');}};
  function forbidden(){network++;throw new Error('Guide integration must not fetch or send public AI');}
  window={document,localStorage:{getItem:key=>storage.get(key)||null,setItem(key,value){storageWrites++;storage.set(key,String(value));}},fetch:forbidden,
    setTimeout(fn){scheduled.push(fn);return scheduled.length;},clearTimeout(){},requestAnimationFrame(fn){scheduled.push(fn);return scheduled.length;},
    getComputedStyle(node){return{display:node.hidden?'none':'block',visibility:'visible'};}};
  window.window=window;
  // Execute the actual retained beginner-guide controller, then count its
  // invocations as an integration dependency rather than reimplementing it.
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const oldGuide=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match=>match[1]).find(source=>source.includes('window.openBeginnerGuide=function()'));
  assert.ok(oldGuide,'Retain the original beginner-guide controller');
  vm.runInNewContext(oldGuide,window);
  const originalOpen=window.openBeginnerGuide,originalClose=window.closeBeginnerGuide;
  window.openBeginnerGuide=function(){oldOpenCalls++;return originalOpen.apply(window,arguments);};
  window.closeBeginnerGuide=function(){oldCloseCalls++;return originalClose.apply(window,arguments);};
  if(chatReady)window.KNAssistChat=chatAPI;
  return {window,document,modal,sheet,panel,input,entrance,morning,chatAPI,chatCalls,storage,originalGuideNodes,log,
    node(id){const n=document.getElementById(id);assert.ok(n,id);return n;},nodes(selector){return document.querySelectorAll(selector);},
    dispatch,flush(){for(let i=0;scheduled.length&&i<20;i++){const jobs=scheduled.splice(0);jobs.forEach(fn=>fn());}assert.equal(scheduled.length,0,'No unbounded initialization loop');},
    oldOpenCalls:()=>oldOpenCalls,oldCloseCalls:()=>oldCloseCalls,network:()=>network,storageWrites:()=>storageWrites,
    eventListeners:type=>(events.get(type)||new Set()).size};
}

test('installation reuses the original guide and single assistant DOM without initializing either feature',()=>{
  const h=harness(),saved=new Map(h.storage),api=install(h.window);
  assert.equal(api.installed,true);assert.equal(h.window.KNSiteGuide,api);
  assert.equal(h.node('knChatPanel'),h.panel);assert.equal(h.node('knChatInput'),h.input);
  assert.equal(h.panel.parentNode,h.node('knGuideChatHost'));
  for(const node of h.originalGuideNodes)assert.ok(h.node('knGuideContent').contains(node));
  assert.equal(h.nodes('#knChatPanel').length,1);assert.equal(h.nodes('#knGuideContent').length,1);
  assert.equal(h.node('knGuideChatHost').hidden,true);assert.equal(h.node('knGuideContent').hidden,false);
  assert.equal(h.modal.getAttribute('role'),'dialog');assert.equal(h.modal.getAttribute('aria-modal'),'true');
  assert.equal(h.modal.getAttribute('aria-hidden'),'true');assert.equal(h.oldOpenCalls(),0);assert.equal(h.chatCalls.length,0);
  assert.deepEqual(h.storage,saved);assert.equal(h.storageWrites(),0);assert.equal(h.network(),0);
});

test('a closed select does nothing and actual guide opens only once during guide and chat tab changes',()=>{
  const h=harness(),api=install(h.window),saved=new Map(h.storage);
  assert.equal(api.select('chat'),false);assert.equal(h.chatCalls.length,0);
  h.window.openBeginnerGuide();assert.equal(h.oldOpenCalls(),1);assert.equal(h.modal.classList.contains('bg-open'),true);
  assert.equal(h.node('bgList').children.length,5);assert.equal(h.node('bgList').children[0].children[0].checked,true);
  assert.match(h.node('bgQ').textContent,/収入と支出/);assert.equal(h.node('bgBar').style.width,'20%');
  const checklistNodes=[...h.node('bgList').children];h.node('bgQ').textContent='current quiz position';
  h.node('knGuideTabChat').click();h.node('knGuideTabGuide').click();h.node('knGuideTabChat').click();
  assert.equal(h.oldOpenCalls(),1);assert.equal(h.node('bgQ').textContent,'current quiz position');
  assert.deepEqual(h.node('bgList').children,checklistNodes);assert.equal(h.nodes('.bg-q').length,23);
  assert.equal(h.node('knChatInput'),h.input);assert.equal(h.input.value,'unfinished existing question');
  assert.deepEqual(h.storage,saved);assert.equal(h.storageWrites(),0);assert.equal(h.network(),0);
});

test('native view controls reflect selected tab, panel accessibility and keyboard focus without duplicate chat opening',()=>{
  const h=harness(),api=install(h.window);api.open('guide');
  const guide=h.node('knGuideTabGuide'),chat=h.node('knGuideTabChat');
  for(const button of [guide,chat])assert.equal(button.type,'button');
  assert.equal(guide.getAttribute('role'),'tab');assert.equal(chat.getAttribute('role'),'tab');
  assert.equal(guide.getAttribute('aria-controls'),'knGuideContent');assert.equal(chat.getAttribute('aria-controls'),'knGuideChatHost');
  chat.click();assert.equal(chat.getAttribute('aria-selected'),'true');assert.equal(chat.getAttribute('tabindex'),'0');
  assert.equal(guide.getAttribute('aria-selected'),'false');assert.equal(guide.getAttribute('tabindex'),'-1');
  assert.equal(h.node('knGuideContent').hidden,true);assert.equal(h.node('knGuideChatHost').hidden,false);
  assert.equal(h.document.activeElement,chat);assert.deepEqual(h.chatCalls,[{action:'open',options:{focusInput:false}}]);
  chat.click();assert.equal(h.chatCalls.length,1,'Same active tab must not reopen or request suggestions');
  assert.equal(chat.emit('keydown',{key:'ArrowLeft'}).defaultPrevented,true);assert.equal(h.document.activeElement,guide);
  assert.equal(h.node('knGuideContent').getAttribute('role'),'tabpanel');assert.equal(h.node('knGuideChatHost').getAttribute('aria-labelledby'),'knGuideTabChat');
  guide.emit('keydown',{key:'End'});assert.equal(h.document.activeElement,chat);
  chat.emit('keydown',{key:'Home'});assert.equal(h.document.activeElement,guide);
  assert.equal(h.oldOpenCalls(),1);assert.equal(h.network(),0);
});

test('chat scroll, textarea identity and draft survive actual guide view switches and another opening cycle',()=>{
  const h=harness(),api=install(h.window);api.open('chat');
  assert.deepEqual(h.chatCalls[0],{action:'open',options:{focusInput:true}});assert.equal(h.document.activeElement,h.input);
  h.input.value='typed but not sent';const body=h.node('knChatBody');body.scrollTop=217;
  h.node('knGuideTabGuide').click();body.scrollTop=0;h.node('knGuideTabChat').click();
  assert.equal(body.scrollTop,217);assert.equal(h.document.activeElement,h.node('knGuideTabChat'));
  assert.equal(h.node('knChatInput'),h.input);assert.equal(h.input.value,'typed but not sent');
  body.scrollTop=319;api.close();assert.equal(h.modal.classList.contains('bg-open'),false);
  api.open('chat');assert.equal(h.oldOpenCalls(),2);assert.equal(body.scrollTop,319);assert.equal(h.input.value,'typed but not sent');
  assert.equal(h.network(),0);assert.equal(h.storageWrites(),0);
});

test('Escape and the existing global backdrop close route clean up chat and restore the original native opener',()=>{
  const h=harness(),api=install(h.window);api.open('chat');
  const event=h.input.emit('keydown',{key:'Escape'});assert.equal(event.defaultPrevented,true);
  assert.equal(h.modal.classList.contains('bg-open'),false);assert.equal(h.modal.getAttribute('aria-hidden'),'true');
  assert.equal(h.oldCloseCalls(),1);assert.equal(h.chatCalls.at(-1).action,'close');assert.equal(h.document.activeElement,h.entrance);
  assert.deepEqual(h.log.at(-1),['focus','question-entry',{preventScroll:true}]);assert.equal(h.morning.scrollTop,431);
  api.open('guide');h.window.closeBeginnerGuide();assert.equal(h.oldCloseCalls(),2);assert.equal(h.document.activeElement,h.entrance);
  assert.equal(h.chatCalls.filter(call=>call.action==='close').length,2);assert.equal(h.network(),0);
});

test('dialog keyboard focus loops only over visible controls and closing has a safe connected question fallback',()=>{
  const h=harness(),api=install(h.window);api.open('chat');
  const exit=h.node('knGuideHubClose'),last=h.node('knChatX');last.focus();
  assert.equal(last.emit('keydown',{key:'Tab'}).defaultPrevented,true);assert.equal(h.document.activeElement,exit);
  assert.equal(exit.emit('keydown',{key:'Tab',shiftKey:true}).defaultPrevented,true);assert.equal(h.document.activeElement,last);
  h.entrance.remove();const fallback=h.document.createElement('button');fallback.id='replacement-question';fallback.className='kn-orbit-guide';h.document.body.appendChild(fallback);
  api.close();assert.equal(h.document.activeElement,fallback);assert.deepEqual(h.log.at(-1),['focus','replacement-question',{preventScroll:true}]);
  assert.equal(h.network(),0);
});

test('language events change guide labels but preserve the original input, checklist and privacy stores',()=>{
  const h=harness(),api=install(h.window);api.open('chat');const saved=new Map(h.storage),checked=h.node('bgList').children[0].children[0];
  const labels=[['en','Getting started','Ask the assistant'],['ko','시작 가이드','로봇에게 질문'],['zh','入门指南','向机器人提问'],['ja','はじめてガイド','ロボットに相談']];
  for(const [language,guide,chat] of labels){h.document.documentElement.lang=language;h.dispatch('langChanged');assert.equal(h.node('knGuideTabGuide').textContent,guide);assert.equal(h.node('knGuideTabChat').textContent,chat);assert.equal(h.panel.getAttribute('aria-label'),chat);}
  assert.equal(h.node('knChatInput'),h.input);assert.equal(h.input.value,'unfinished existing question');assert.equal(checked.checked,true);
  assert.deepEqual(h.storage,saved);assert.equal(h.storageWrites(),0);assert.equal(h.chatCalls.length,1);assert.equal(h.network(),0);
});

test('repeat installation returns the same API and does not move nodes or duplicate global and native listeners',()=>{
  const h=harness(),api=install(h.window);const children=[...h.sheet.children],guide=h.node('knGuideTabGuide'),chat=h.node('knGuideTabChat');
  assert.equal(install(h.window),api);assert.deepEqual(h.sheet.children,children);assert.equal(h.eventListeners('langChanged'),1);
  assert.equal(chat.events.get('click').size,1);assert.equal(guide.events.get('click').size,1);assert.equal(h.modal.events.get('keydown').size,1);
  h.window.openSiteGuide('guide');chat.click();assert.equal(h.chatCalls.length,1);assert.equal(h.oldOpenCalls(),1);assert.equal(h.nodes('#knChatPanel').length,1);
});

test('missing assistant or native guide support leaves old controls unchanged and can be installed after the dependency arrives',()=>{
  const h=harness({chatReady:false}),children=[...h.sheet.children],open=h.window.openBeginnerGuide;
  assert.equal(install(h.window),null);assert.deepEqual(h.sheet.children,children);assert.equal(h.panel.parentNode,h.document.body);assert.equal(h.window.openBeginnerGuide,open);assert.equal(h.eventListeners('langChanged'),0);
  h.window.KNAssistChat=h.chatAPI;const api=install(h.window);assert.equal(api.installed,true);assert.equal(h.panel.parentNode,h.node('knGuideChatHost'));
  const other=harness();delete other.window.openBeginnerGuide;const original=[...other.sheet.children];assert.equal(install(other.window),null);assert.deepEqual(other.sheet.children,original);
  assert.equal(h.network(),0);assert.equal(other.network(),0);
});

test('the browser module boots after DOM readiness and repeated initialization keeps one shared container',()=>{
  const h=harness({ready:false});const source=fs.readFileSync(path.join(__dirname,'../static/guide-hub.js'),'utf8');
  vm.runInNewContext(source,{window:h.window});assert.equal(h.window.KNSiteGuide,undefined);
  assert.equal(h.eventListeners('DOMContentLoaded'),1);assert.equal(h.panel.parentNode,h.document.body);
  h.document.readyState='complete';h.dispatch('DOMContentLoaded');const api=h.window.KNSiteGuide;
  assert.equal(api.installed,true);assert.equal(h.nodes('#knGuideContent').length,1);assert.equal(h.panel.parentNode,h.node('knGuideChatHost'));
  vm.runInNewContext(source,{window:h.window});assert.equal(h.window.KNSiteGuide,api);
  assert.equal(h.nodes('#knGuideContent').length,1);assert.equal(h.eventListeners('langChanged'),1);
  assert.equal(h.oldOpenCalls(),0);assert.equal(h.network(),0);assert.equal(h.storageWrites(),0);
});

test('the actual retained checklist writes only its original key and stays checked after view switches and reopening',()=>{
  const h=harness(),saved=new Map(h.storage),api=install(h.window);api.open('guide');
  const second=h.node('bgList').children[1].children[0];second.checked=true;second.onchange();
  assert.equal(h.storageWrites(),1);assert.equal(h.storage.get('bg_guide_v1'),'{"s0":true,"s1":true}');
  const guide=h.node('knGuideContent');guide.scrollTop=188;
  h.node('knGuideTabChat').click();h.node('knGuideTabGuide').click();assert.equal(guide.scrollTop,188);
  assert.equal(h.node('bgList').children[1].children[0].checked,true);assert.equal(h.node('bgBar').style.width,'40%');
  api.close();h.window.openBeginnerGuide();assert.equal(h.oldOpenCalls(),2);
  assert.equal(h.node('bgList').children[1].children[0].checked,true);assert.equal(h.node('bgBar').style.width,'40%');
  for(const [key,value] of saved)if(key!=='bg_guide_v1')assert.equal(h.storage.get(key),value);
  assert.equal(h.storageWrites(),1);assert.equal(h.network(),0);
});

test('closing a guide entered from an offscreen drawer skips the hidden question and focuses the visible floating menu',()=>{
  const h=harness(),api=install(h.window),saved=new Map(h.storage);
  h.window.innerWidth=390;h.window.innerHeight=844;h.entrance.hidden=true;
  const drawerEntry=h.document.createElement('button');drawerEntry.id='closed-drawer-guide';h.document.body.appendChild(drawerEntry);
  drawerEntry.getBoundingClientRect=()=>({left:-240,right:-20,top:50,bottom:94,width:220,height:44});
  const menu=h.document.createElement('button');menu.id='knFloatHam';h.document.body.appendChild(menu);
  menu.getBoundingClientRect=()=>({left:336,right:388,top:12,bottom:64,width:52,height:52});
  h.document.activeElement=drawerEntry;api.open('guide');api.close();
  assert.equal(h.document.activeElement,menu);assert.deepEqual(h.log.at(-1),['focus','knFloatHam',{preventScroll:true}]);
  assert.equal(h.oldCloseCalls(),1);assert.equal(h.modal.classList.contains('bg-open'),false);assert.equal(h.morning.scrollTop,431);
  assert.deepEqual(h.storage,saved);assert.equal(h.storageWrites(),0);assert.equal(h.network(),0);
});

test('the keyboard trap keeps lower rendered guide controls in order and wraps only after the actual last control',()=>{
  const h=harness(),api=install(h.window);h.window.innerWidth=390;h.window.innerHeight=844;api.open('guide');
  const guide=h.node('knGuideContent'),visibleLast=h.document.createElement('button'),lower=h.document.createElement('button');
  visibleLast.id='last-control-in-viewport';lower.id='next-control-below-viewport';guide.appendChild(visibleLast);guide.appendChild(lower);
  visibleLast.getBoundingClientRect=()=>({left:20,right:200,top:600,bottom:644,width:180,height:44});
  lower.getBoundingClientRect=()=>({left:20,right:200,top:1000,bottom:1044,width:180,height:44});
  visibleLast.focus();const onward=visibleLast.emit('keydown',{key:'Tab'});
  assert.equal(onward.defaultPrevented,false,'The browser must be allowed to reach and scroll to the next lower control');
  assert.equal(h.document.activeElement,visibleLast,'The fixture does not simulate native Tab navigation');
  lower.focus();const wrap=lower.emit('keydown',{key:'Tab'});assert.equal(wrap.defaultPrevented,true);
  assert.equal(h.document.activeElement,h.node('knGuideHubClose'));
  assert.equal(h.oldOpenCalls(),1);assert.equal(h.network(),0);
});


// Use the same retained guide controller and DOM fixture for the concern entrance.
const {install:installConcern}=require('../static/guide-concern.js');
function concernHarness({beforeConcernInstall}={}){
  const h=harness();install(h.window);
  const foot=h.document.createElement('div');foot.className='kn-chat-foot';h.panel.appendChild(foot);
  foot.appendChild(h.input);foot.appendChild(h.node('knChatSend'));
  const hint=h.document.createElement('button');hint.id='knChatSuggestRefresh';h.panel.insertBefore(hint,h.node('knChatBody'));
  const guide=h.node('knGuideContent'),faq=h.node('existing-guide-faq');
  const dictionary=h.document.createElement('div'),feelings=h.document.createElement('div');
  dictionary.className=feelings.className='bg-box';guide.appendChild(dictionary);guide.appendChild(feelings);
  const details=[...faq.children];
  details.slice(8,18).forEach(n=>dictionary.appendChild(n));details.slice(18).forEach(n=>feelings.appendChild(n));
  for(const [box,title] of [[faq,'③ よくある疑問'],[dictionary,'④ ことばの意味'],[feelings,'⑤ こんな気持ちのときは？']]){
    const heading=h.document.createElement('h3');heading.textContent=title;box.insertBefore(heading,box.firstChild);
  }
  const sourceDetails=[...h.nodes('.bg-q')];if(beforeConcernInstall)beforeConcernInstall(h);
  const api=installConcern(h.window);
  return{...h,api,sourceDetails};
}
test('concern entrance and navigation retain four topics and three examples without automatic sending',()=>{
  const sent=[];
  const h=concernHarness({beforeConcernInstall(h){h.node('knChatSend').addEventListener('click',()=>sent.push(h.input.value));}});
  const saved=new Map(h.storage),draft=h.input.value;
  assert.equal(sent.length,0,'Installing must not send the existing draft');
  h.window.openBeginnerGuide();
  assert.equal(h.node('knConcernHome').hidden,false);assert.equal(h.node('knChatBody').hidden,true);
  assert.equal(h.document.activeElement,h.node('knConcernTitle'),'Opening must not focus the input and open a mobile keyboard');
  assert.equal(h.nodes('.kn-concern-topic').length,4);assert.equal(h.nodes('.kn-concern-question').length,3);
  for(let i=0;i<4;i++){
    h.node('knConcernTopic'+i).click();assert.equal(h.node('knConcernTopic'+i).getAttribute('aria-pressed'),'true');
  }
  for(const language of ['en','ko','zh','ja']){h.document.documentElement.lang=language;h.dispatch('langChanged');}
  assert.equal(installConcern(h.window),h.api);
  h.node('knConcernRead').click();h.node('knConcernBack').click();h.api.close();h.api.open();
  assert.equal(sent.length,0,'Topics, translations, guide navigation, reinstall and reopening must not send');
  assert.equal(h.input.value,draft);assert.equal(h.nodes('#knChatInput').length,1);
  assert.equal(h.network(),0);assert.equal(h.storageWrites(),0);assert.deepEqual(h.storage,saved);
});
test('an example tap sends exactly once through the existing button with the current topic and language',()=>{
  const h=concernHarness(),saved=new Map(h.storage),sent=[];let inputKeyEvents=0;
  h.input.addEventListener('keydown',()=>inputKeyEvents++);
  // This test double observes the retained button boundary after the concern
  // capture handler; it does not send AI requests or implement example selection.
  h.node('knChatSend').addEventListener('click',()=>{
    sent.push({text:h.input.value,homeHidden:h.node('knConcernHome').hidden,bodyHidden:h.node('knChatBody').hidden});
    h.input.value='';
  });
  const cases=[
    ['ja',0,0,'家計は何から見直せばいい？'],
    ['ja',2,2,'投資の言葉がわかりません'],
    ['en',1,1,'I want to understand NISA'],
    ['ko',3,0,'자산을 한곳에서 보고 싶어요'],
    ['zh',2,1,'正在犹豫是否继续定期投资'],
    ['fr',1,2,'まだ投資しなくても大丈夫？']
  ];
  for(const [language,topic,index,text] of cases){
    h.document.documentElement.lang=language;h.dispatch('langChanged');h.api.open();h.node('knConcernTopic'+topic).click();
    const before=sent.length;h.node('knConcernQuestion'+index).click();
    assert.equal(sent.length,before+1,'One example activation must dispatch one send');
    assert.deepEqual(sent.at(-1),{text,homeHidden:true,bodyHidden:false});
    assert.equal(h.input.value,'','The retained sender can clear the original input');
    assert.equal(h.node('knConcernBack').hidden,false);assert.equal(h.nodes('#knChatInput').length,1);
  }
  assert.equal(inputKeyEvents,0,'Example activation must not synthesize Enter or composition input events');
  assert.equal(h.network(),0);assert.equal(h.storageWrites(),0);assert.deepEqual(h.storage,saved);
});
test('busy and disabled example taps preserve an unfinished draft and cannot duplicate an in-flight send',()=>{
  const h=concernHarness(),send=h.node('knChatSend'),sent=[];h.api.open();
  send.addEventListener('click',()=>{sent.push(h.input.value);h.input.value='';send.disabled=true;});
  send.disabled=true;h.input.value='keep before pending finishes';h.node('knConcernQuestion0').click();
  assert.equal(sent.length,0);assert.equal(h.input.value,'keep before pending finishes');assert.equal(h.node('knConcernHome').hidden,false);
  send.disabled=false;h.node('knConcernQuestion0').click();
  assert.deepEqual(sent,['家計は何から見直せばいい？']);assert.equal(send.disabled,true);
  h.node('knConcernBack').click();h.input.value='new draft while reply is pending';
  h.node('knConcernQuestion1').click();h.node('knConcernQuestion1').click();
  assert.equal(sent.length,1);assert.equal(h.input.value,'new draft while reply is pending');assert.equal(h.node('knConcernHome').hidden,false);
  send.disabled=false;h.node('knConcernQuestion1').click();
  assert.deepEqual(sent,['家計は何から見直せばいい？','毎月、いくら使っているか知りたい']);
  assert.equal(h.network(),0);assert.equal(h.storageWrites(),0);
});
test('queued example clicks from a closed or hidden landing view never send or overwrite the draft',()=>{
  const h=concernHarness(),sent=[],draft=h.input.value;
  h.node('knChatSend').addEventListener('click',()=>sent.push(h.input.value));
  const question=h.node('knConcernQuestion0');
  question.click();assert.equal(sent.length,0);assert.equal(h.input.value,draft);
  h.api.open();h.node('knConcernRead').click();question.click();
  assert.equal(sent.length,0);assert.equal(h.input.value,draft);
  h.api.select('chat');question.click();assert.equal(sent.length,0);assert.equal(h.input.value,draft);
  h.api.close();question.click();assert.equal(sent.length,0);assert.equal(h.input.value,draft);
  assert.equal(h.network(),0);assert.equal(h.storageWrites(),0);
});
test('reading the guide retains all 8/10/5 source details and returns without losing an unsent draft',()=>{
  const h=concernHarness();h.api.open();h.input.value='an unsent question';h.node('knConcernRead').click();
  assert.equal(h.node('knGuideContent').hidden,false);assert.equal(h.node('knConcernHome').hidden,true);
  assert.deepEqual([h.node('existing-guide-faq'),h.node('knConcernSection4'),h.node('knConcernSection5')].map(n=>n.querySelectorAll('.bg-q').length),[8,10,5]);
  assert.deepEqual(h.nodes('.bg-q'),h.sourceDetails);
  assert.equal(h.node('bgList').children.length,5);assert.equal(h.node('bgBar').style.width,'20%');
  h.node('knConcernBack').click();assert.equal(h.node('knConcernHome').hidden,false);assert.equal(h.input.value,'an unsent question');
  assert.equal(h.oldOpenCalls(),1);assert.equal(h.network(),0);assert.equal(h.storageWrites(),0);
});
test('only a nonempty explicit send enters the retained conversation and back keeps the draft and nodes',()=>{
  const h=concernHarness();h.api.open();h.input.value=' ';h.node('knChatSend').click();assert.equal(h.node('knConcernHome').hidden,false);
  h.input.value='edited question';h.node('knChatSend').click();
  assert.equal(h.node('knConcernHome').hidden,true);assert.equal(h.node('knChatBody').hidden,false);
  assert.equal(h.node('knConcernBack').hidden,false);h.node('knConcernBack').click();
  h.input.value='question with a newline';h.input.emit('keydown',{key:'Enter',shiftKey:true});assert.equal(h.node('knConcernHome').hidden,false);
  h.input.emit('keydown',{key:'Enter',shiftKey:false,isComposing:true});assert.equal(h.node('knConcernHome').hidden,false);
  h.input.emit('keydown',{key:'Enter',shiftKey:false});assert.equal(h.node('knConcernHome').hidden,true);
  assert.equal(h.network(),0,'The fixture has no assistant sender; this verifies presentation only');
});
test('concern locale changes refresh examples and labels without replacing a typed draft or saved data',()=>{
  const h=concernHarness();h.api.open();h.node('knConcernTopic3').click();h.input.value='keep this exact draft';const saved=new Map(h.storage);
  for(const [lang,title] of [['en','What is on your mind?'],['ko','무엇이 궁금한가요?'],['zh','你在关心什么？'],['ja','何が気になっていますか？']]){
    h.document.documentElement.lang=lang;h.dispatch('langChanged');assert.equal(h.node('knConcernTitle').textContent,title);
    assert.equal(h.input.value,'keep this exact draft');assert.equal(h.node('knConcernTopic3').getAttribute('aria-pressed'),'true');
  }
  assert.deepEqual(h.storage,saved);assert.equal(h.storageWrites(),0);assert.equal(h.network(),0);
});
test('concern return, native Escape, reopening and repeated install reuse one modal and preserve source progress',()=>{
  const h=concernHarness();assert.equal(installConcern(h.window),h.api);assert.equal(h.nodes('#knConcernHome').length,1);
  h.api.open();h.input.value='keep after closing';h.node('knConcernRead').click();
  const cb=h.node('bgList').children[1].children[0];cb.checked=true;cb.onchange();
  h.input.emit('keydown',{key:'Escape'});assert.equal(h.modal.classList.contains('bg-open'),false);assert.equal(h.document.activeElement,h.entrance);
  h.window.openBeginnerGuide();assert.equal(h.node('knConcernHome').hidden,false);assert.equal(h.input.value,'keep after closing');
  assert.equal(h.node('bgBar').style.width,'40%');assert.equal(h.storageWrites(),1);assert.equal(h.network(),0);
});
test('new concern attachment is inert when required original controls are unavailable',()=>{
  const h=harness();const children=[...h.panel.children];assert.equal(installConcern(h.window),null);
  assert.deepEqual(h.panel.children,children);assert.equal(h.network(),0);assert.equal(h.storageWrites(),0);
});

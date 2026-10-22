'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const planner = require('../static/mypage-planner.js');

const goal = (extra = {}) => ({id:'goal-1',title:'学ぶ・記録する',details:'',target:null,monthly:null,deadline:'',...extra});
const note = (extra = {}) => ({id:'note-1',title:'',body:'',groupId:'',...extra});
const encode = (extra = {}) => JSON.stringify({...planner.empty(),...extra});

test('an absent record starts separately from malformed or unsupported saved data', () => {
  const first = planner.decode(null), other = planner.decode(null);
  first.goals.push(goal());
  assert.deepEqual(other.goals, []);
  for (const raw of ['', '{', 'null', 'false', '[]', '{}', encode({version:2}), encode({goals:{}})])
    assert.throws(() => planner.decode(raw), undefined, raw);
});

test('decode rejects corrupt records instead of silently dropping successful rows', () => {
  for (const extra of [
    {goals:[goal(),goal()]},
    {goals:[goal({target:0})]}, {goals:[goal({target:-1})]},
    {goals:[goal({monthly:-1})]}, {goals:[goal({title:null})]},
    {goals:[goal({deadline:'2026-02-30'})]},
    {todos:[{id:'todo-1',text:'確認する',done:1,goalId:''}]},
    {todos:[{id:'todo-1',text:'確認する',done:false,goalId:null}]},
    {notes:[note({body:null})]}, {groups:[{id:'group-1',name:null}]}
  ]) assert.throws(() => planner.decode(encode(extra)), undefined, JSON.stringify(extra));
});

test('decode preserves literal saved text and additive data in the current schema', () => {
  const literal = '  自由な内容\n\n<b>文字として保存</b>\n\t末尾  ';
  const raw = encode({goals:[goal({details:literal})],notes:[note({body:literal})],futureOptional:{retained:true}});
  const decoded = planner.decode(raw);
  assert.equal(decoded.goals[0].details, literal);
  assert.equal(decoded.notes[0].body, literal);
  assert.deepEqual(decoded.futureOptional, {retained:true});
  assert.equal(JSON.stringify(decoded), raw);
});

test('corrupt persisted drafts cannot enter an editable document', () => {
  for (const extra of [
    {todoDraft:null}, {todoDraft:{text:null,goalId:''}},
    {goalDraft:{id:'',title:7,details:'',target:'',deadline:'',monthly:''}},
    {goals:[goal({deadline:null})]}, {selectedGoalId:4}, {selectedNoteId:{}}
  ]) assert.throws(() => planner.decode(encode(extra)), undefined, JSON.stringify(extra));
});

test('legacy import retains every original character and leaves original records intact', () => {
  const oldGoal = '  以前の目標\n'+ '長い自由文。'.repeat(40) + '\n末尾  ';
  const oldMemo = '\n  日記\n\n<b>そのまま</b> 😀\t\n';
  const existing = planner.empty();
  existing.goals.push(goal()); existing.notes.push(note({body:'既存の記録'}));
  const before = JSON.stringify(existing);
  const imported = planner.importLegacy(existing,{goal:oldGoal,memo:oldMemo,todos:JSON.stringify([{text:'完了済み',done:true},{text:'次にする',done:false}])});
  assert.equal(JSON.stringify(existing), before);
  assert.equal(imported.goals.length, 2);
  assert.equal(imported.notes.length, 2);
  assert.equal(imported.goals[1].details, oldGoal);
  assert.equal(imported.notes[1].body, oldMemo);
  assert.deepEqual(imported.todos.map(t=>({text:t.text,done:t.done,goalId:t.goalId})),[
    {text:'完了済み',done:true,goalId:''}, {text:'次にする',done:false,goalId:''}
  ]);
  assert.equal(imported.legacyImported,true);
  assert.equal(planner.decode(JSON.stringify(imported)).notes[1].body,oldMemo);
});

test('legacy decode failure is atomic and does not mark data as imported or alter the original', () => {
  for (const todos of ['{', '{}', '[{"text":"valid","done":true},{"text":"bad","done":"false"}]']) {
    const existing = planner.empty(), before = JSON.stringify(existing);
    assert.throws(()=>planner.importLegacy(existing,{goal:'保持',memo:'元メモ',todos}));
    assert.equal(JSON.stringify(existing),before);
    assert.equal(existing.legacyImported,false);
  }
});

test('an already completed legacy import is idempotent', () => {
  const imported = planner.importLegacy(planner.empty(),{goal:'原文',memo:'原文',todos:'[]'});
  assert.deepEqual(planner.importLegacy(imported,{goal:'重複追加しない',memo:'重複追加しない',todos:'malformed'}),imported);
});

test('optional amounts distinguish an empty input, explicit zero and fractional yen', () => {
  assert.equal(planner.amount('',true),null);
  assert.equal(planner.amount(' \t　',false),null);
  assert.equal(planner.amount('0',false),0);
  assert.throws(()=>planner.amount('0',true));
  assert.equal(planner.amount('12345.67',true),12345.67);
  assert.equal(planner.amount('１，２３４．５６',false),1234.56);
  assert.equal(planner.amount(' 1,234,567.125 ',true),1234567.125);
  for (const invalid of ['-1','−1','1e3','NaN','Infinity','1.2.3','１２円']) assert.throws(()=>planner.amount(invalid,false));
});

test('asset totals preserve fractions, custom categories and recorded negative amounts', () => {
  const raw = JSON.stringify([
    {amount:0.1,cat:'現金'}, {amount:0.2,cat:'現金'},
    {amount:12345.67,cat:'投資信託'}, {amount:-20.5,cat:'独自の区分'}, {amount:10,cat:''}
  ]);
  const result = planner.assets(raw);
  assert.equal(result.total,12335.47);
  assert.equal(result.count,5);
  assert.deepEqual(result.groups,[
    {name:'現金',amount:0.3}, {name:'投資信託',amount:12345.67},
    {name:'独自の区分',amount:-20.5}, {name:'未分類',amount:10}
  ]);
});

test('unreadable assets are not fabricated as an empty portfolio', () => {
  assert.deepEqual(planner.assets(null),{total:0,groups:[],count:0});
  for (const raw of ['', '{}','null','[{}]','[{"amount":"12"}]','[{"amount":null}]'])
    assert.throws(()=>planner.assets(raw),undefined,raw);
  assert.throws(()=>planner.assets('[{"amount":1e309}]'));
});

test('money display keeps meaningful fractions and omits empty decimal zeroes', () => {
  assert.equal(planner.money(12345), '12,345円');
  assert.equal(planner.money(12345.67), '12,345.67円');
  assert.equal(planner.money(-20.5), '-20.5円');
  assert.equal(planner.money(0), '0円');
});

test('task progress and asset progress stay independent for each goal', () => {
  const g = goal({target:1000}), todos = [
    {id:'a',goalId:g.id,text:'最初',done:true},
    {id:'b',goalId:g.id,text:'次の一歩',done:false},
    {id:'c',goalId:'another',text:'別の目標',done:true},
    {id:'d',goalId:'',text:'目標未指定',done:true}
  ];
  const result = planner.progress(g,{total:250},todos);
  assert.equal(result.tasks,2); assert.equal(result.done,1);
  assert.equal(result.next.text,'次の一歩'); assert.equal(result.assetRate,'25%'); assert.equal(result.gap,750);
  assert.equal(planner.progress(g,{total:1200},todos).done,1);
  const noTarget = planner.progress(goal(),{total:250},todos);
  assert.equal(noTarget.assetRate,null); assert.equal(noTarget.gap,null);
  const unavailable = planner.progress(g,null,todos);
  assert.equal(unavailable.assetRate,null); assert.equal(unavailable.gap,null);
});

test('empty and all-completed task lists do not invent a next task', () => {
  const g = goal();
  assert.equal(planner.progress(g,null,[]).next,null);
  assert.equal(planner.progress(g,null,[]).tasks,0);
  const completed = planner.progress(g,null,[{id:'t',goalId:g.id,text:'完了',done:true}]);
  assert.equal(completed.tasks,1); assert.equal(completed.done,1); assert.equal(completed.next,null);
});

test('asset rates distinguish tiny progress, unfinished near-target values and surplus', () => {
  assert.equal(planner.percent(0,100), '0%');
  assert.equal(planner.percent(1,1000000000), '0.1%未満');
  assert.equal(planner.percent(999999999,1000000000), '99.9%');
  assert.equal(planner.percent(1000,1000),'100%');
  assert.equal(planner.percent(1250,1000),'125%');
  assert.equal(planner.percent(-25,100),'-25%');
  assert.equal(planner.percent(1,0),null);
  assert.equal(planner.percent(NaN,100),null);
  const negative = planner.progress(goal({target:100}),{total:-25},[]);
  assert.equal(negative.gap,125);
  assert.equal(negative.assetRate,'-25%');
});

test('saved deadlines reject impossible dates and accept real leap days', () => {
  assert.equal(planner.decode(encode({goals:[goal({deadline:'2028-02-29'})]})).goals[0].deadline,'2028-02-29');
  for (const deadline of ['2027-02-29','2026-04-31','2026-00-01','2026-13-01','2026-10','2026/10/17'])
    assert.throws(()=>planner.decode(encode({goals:[goal({deadline})]})),undefined,deadline);
});

test('monthly arithmetic uses the current JST month and starts the following month', () => {
  const g = goal({deadline:'2026-12-31',monthly:100.25});
  const beforeJstNovember = Date.UTC(2026,9,31,14,59,59);
  const atJstNovember = Date.UTC(2026,9,31,15,0,0);
  assert.deepEqual(planner.plan(g,123.45,beforeJstNovember),{months:2,total:323.95});
  assert.deepEqual(planner.plan(g,123.45,atJstNovember),{months:1,total:223.7});
  assert.deepEqual(planner.plan(goal({deadline:'2026-12-31',monthly:0}),0,atJstNovember),{months:1,total:0});
  assert.deepEqual(planner.plan(goal({deadline:'2026-12-31',monthly:0.1}),0.2,beforeJstNovember),{months:2,total:0.4});
});

test('missing optional planning fields and current or past deadlines do not invent future additions', () => {
  const now = Date.UTC(2026,9,17);
  assert.equal(planner.plan(goal({monthly:100}),1000,now),null);
  assert.equal(planner.plan(goal({deadline:'2026-12-31'}),1000,now),null);
  assert.equal(planner.plan(goal({deadline:'2026-10-31',monthly:100}),1000,now),null);
  assert.equal(planner.plan(goal({deadline:'2026-09-30',monthly:100}),1000,now),null);
});

// A small controller fixture exercises actual mount handlers and save promises.
// Geometry and real browser input behavior are checked separately by the parent.
function controller({raw=null,stageOK=true,autoSave=false,ready=true,restoreOK=true,readyState='complete',pagePresent=true,richEditor=false,notifications=null}={}) {
  const documentEvents = {}, documentOptions = {}, childEvents = {}, windowEvents = {}, saves = [], stages = [];
  const timers=new Map(),intervals=[];let clock=0,timerId=0,stored = raw,loads=0,focused=null;
  function flushTimers(ms=1500) {
    const through=clock+ms;
    while(true){
      const next=[...timers].filter(([,timer])=>timer.at<=through).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
      if(!next)break;
      clock=next[1].at;timers.delete(next[0]);next[1].fn();
    }
    clock=through;
  }
  class Element {
    constructor(tag='div') {this.nodeType=1;this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attributes={};this.listeners={};this.classes=new Set();this.value='';this.disabled=false;this.hidden=false;this._text='';}
    get childNodes() {return this.children;}
    set className(value) {this.classes=new Set(String(value).split(/\s+/).filter(Boolean));}
    get className() {return [...this.classes].join(' ');}
    get classList() {return {contains:k=>this.classes.has(k),add:k=>this.classes.add(k),remove:k=>this.classes.delete(k),toggle:(k,on)=>{if(on===undefined)on=!this.classes.has(k);on?this.classes.add(k):this.classes.delete(k);return on;}};}
    set textContent(value) {this._text=String(value);this.children=[];}
    get textContent() {return this._text+this.children.map(c=>c.textContent).join('');}
    appendChild(node) {node.parentNode=this;this.children.push(node);return node;}
    prepend(node) {node.parentNode=this;this.children.unshift(node);}
    insertBefore(node,before) {node.parentNode=this;const i=this.children.indexOf(before);i<0?this.children.push(node):this.children.splice(i,0,node);}
    replaceChildren(...nodes) {this.children.forEach(n=>n.parentNode=null);this.children=[];this._text='';nodes.forEach(n=>this.appendChild(n));}
    get nextSibling() {const a=this.parentNode?.children||[];return a[a.indexOf(this)+1]||null;}
    setAttribute(k,v) {this.attributes[k]=String(v);}
    getAttribute(k) {return Object.hasOwn(this.attributes,k)?this.attributes[k]:null;}
    addEventListener(type,fn) {(this.listeners[type]??=[]).push(fn);}
    dispatch(type,extra={}) {const event={target:this,preventDefault(){this.defaultPrevented=true;},...extra};for(const fn of this.listeners[type]||[])fn(event);return event;}
    click() {if(!this.disabled)this.dispatch('click');}
    focus() {focused=this;}
    matches(selector) {
      if(selector==='.mo-pane:not(.kb-pane)')return this.classes.has('mo-pane')&&!this.classes.has('kb-pane');
      if(selector.startsWith('[data-'))return Object.hasOwn(this.attributes,selector.slice(1,-1));
      const parts=selector.split(/\s+/),simple=parts.pop();
      const own=simple.startsWith('.')?this.classes.has(simple.slice(1)):this.tagName===simple.toUpperCase();
      if(!own)return false;
      if(!parts.length)return true;
      let parent=this.parentNode;while(parent){if(parent.matches(parts.join(' ')))return true;parent=parent.parentNode;}return false;
    }
    querySelectorAll(selector) {const choices=selector.split(',').map(s=>s.trim()),all=[];for(const c of this.children){all.push(c,...c.querySelectorAll('*'));}return all.filter(n=>selector==='*'||choices.some(s=>n.matches(s)));}
    querySelector(selector) {return this.querySelectorAll(selector)[0]||null;}
  }
  const node=(tag,cls)=>{const n=new Element(tag);if(cls)n.className=cls;return n;};
  const page=node('section','open'),body=page.appendChild(node('div','mo-body'));
  const tabs=page.appendChild(node('div','mo-tabs'));
  for(let i=0;i<4;i++){tabs.appendChild(node('button','mo-tab'));body.appendChild(node('section','mo-pane'));}
  const frame=page.appendChild(node('iframe','kb-frame'));
  const bridge={
    async load(){loads++;if(!restoreOK)throw Error('fixture_restore_unavailable');return {raw:stored,assetsRaw:'[{"amount":12.5,"cat":"現金"}]'};},
    stage(owner,value){stages.push({owner,raw:value});if(stageOK)stored=value;return stageOK;},
    save(owner,value){const operation={owner,raw:value};saves.push(operation);if(autoSave)return Promise.resolve(true);operation.promise=new Promise(resolve=>operation.resolve=resolve);return operation.promise;}
  };
  frame.contentWindow={kkMyPageStore:bridge,knLedgerSession:ready?{user:{id:'owner-A'}}:null,localStorage:{getItem:()=> 'owner-A'},addEventListener:(type,fn)=>childEvents[type]=fn};
  const w={
    document:{readyState,getElementById:k=>k==='myPageOv'&&pagePresent?page:null,createElement:tag=>new Element(tag),addEventListener(type,fn,options){documentEvents[type]=fn;documentOptions[type]=options;}},
    knUser:{id:'owner-A'},localStorage:{getItem:()=>null},location:{origin:'https://planner.fixture.test'},
    confirm:()=>true,prompt:()=>null,MutationObserver:class {observe(){}},
    addEventListener:(type,fn)=>windowEvents[type]=fn,setInterval(fn,ms){intervals.push({fn,ms});},
    setTimeout(fn,ms=0){timers.set(++timerId,{fn,at:clock+ms});return timerId;},
    clearTimeout(id){timers.delete(id);},
  };
  if(notifications)w.KNNotifications=notifications;
  if(richEditor){
    w.KNMyPageNoteEditor=require('../static/mypage-note-editor.js');
    const selection={anchorNode:null,focusNode:null,anchorOffset:0,focusOffset:0,removeAllRanges(){this.anchorNode=this.focusNode=null;},addRange(r){this.anchorNode=r.startContainer;this.anchorOffset=r.startOffset;this.focusNode=r.endContainer;this.focusOffset=r.endOffset;}};
    w.getSelection=()=>selection;
    w.document.createTextNode=text=>{const n=new Element('#text');n.nodeType=3;n.textContent=text;Object.defineProperty(n,'nodeValue',{get(){return n.textContent;},set(value){n.textContent=value;}});return n;};
    w.document.createRange=()=>({setStart(n,i){this.startContainer=n;this.startOffset=i;},setEnd(n,i){this.endContainer=n;this.endOffset=i;}});
  }
  const lookup=text=>page.querySelectorAll('button').find(n=>n.textContent===text);
  planner.mount(w);
  return {w,page,body,bridge,saves,stages,documentEvents,documentOptions,childEvents,lookup,flushTimers,intervals,
    showPage(){pagePresent=true;},
    domReady(){w.document.readyState='interactive';const listener=documentEvents.DOMContentLoaded;if(documentOptions.DOMContentLoaded?.once)delete documentEvents.DOMContentLoaded;listener?.();},
    get frame(){return page.querySelector('.kb-frame');},
    get loads(){return loads;},get elapsed(){return clock;},get focused(){return focused;},
    recordsReady(event={}){windowEvents.message({origin:w.location.origin,source:page.querySelector('.kb-frame').contentWindow,data:{type:'kn-mypage-records-ready'},...event});},
    replaceFrame(){const next=node('iframe','kb-frame');next.contentWindow={...page.querySelector('.kb-frame').contentWindow};const old=page.querySelector('.kb-frame');page.children.splice(page.children.indexOf(old),1,next);next.parentNode=page;old.parentNode=null;return next;},
    get memo(){return page.querySelectorAll('textarea').find(n=>n.id==='mpMemo');},
    get status(){return page.querySelector('.mp-status').textContent;},
    get raw(){return stored;},
    type(element,value){element.value=value;element.dispatch('input');},
    auth(user){w.knUser=user;documentEvents.knAuthChange();}};
}
const settle = async()=>{for(let i=0;i<6;i++)await Promise.resolve();};

test('interactive startup builds a later MyPage at DOMContentLoaded without waiting for the 200ms fallback',async()=>{
  const raw=encode({notes:[note({body:'DOM準備後に復元する架空の本文'})]});
  const h=controller({raw,readyState:'interactive',pagePresent:false});await settle();const frame=h.frame;
  assert.equal(h.page.querySelectorAll('.mp-planner').length,0);assert.equal(h.loads,0);assert.equal(h.intervals.length,0);
  assert.equal(h.documentOptions.DOMContentLoaded.once,true);
  h.showPage();h.domReady();await settle();
  assert.equal(h.elapsed,0);assert.equal(h.loads,1);assert.equal(h.memo.value,'DOM準備後に復元する架空の本文');
  const bar=h.page.querySelector('.mp-planner-bar');
  assert.equal(h.page.querySelectorAll('.mp-planner').length,3);assert.equal(h.intervals.length,1);
  h.flushTimers(200);await settle();
  assert.equal(h.page.querySelector('.mp-planner-bar'),bar);assert.equal(h.page.querySelectorAll('.mp-planner-bar').length,1);
  assert.equal(h.page.querySelectorAll('.mp-planner').length,3);assert.equal(h.loads,1);assert.equal(h.intervals.length,1);
  assert.equal(h.frame,frame);assert.equal(h.stages.length,0);assert.equal(h.saves.length,0);
});

test('interactive startup mounts an existing MyPage immediately and DOMContentLoaded cannot mount it twice',async()=>{
  const h=controller({readyState:'interactive'});await settle();
  const bar=h.page.querySelector('.mp-planner-bar'),frame=h.frame;
  assert.ok(bar);assert.equal(h.loads,1);assert.equal(h.elapsed,0);assert.equal(h.intervals.length,1);
  assert.equal(h.documentOptions.DOMContentLoaded.once,true);
  h.domReady();await settle();h.flushTimers(200);await settle();
  assert.equal(h.page.querySelector('.mp-planner-bar'),bar);assert.equal(h.page.querySelectorAll('.mp-planner-bar').length,1);
  assert.equal(h.page.querySelectorAll('.mp-planner').length,3);assert.equal(h.loads,1);assert.equal(h.intervals.length,1);
  assert.equal(h.frame,frame);assert.equal(h.stages.length,0);assert.equal(h.saves.length,0);
});

test('loading documents still wait for one DOMContentLoaded while complete documents build immediately',async()=>{
  const loading=controller({readyState:'loading'});await settle();
  assert.equal(loading.page.querySelectorAll('.mp-planner').length,0);assert.equal(loading.loads,0);
  assert.equal(loading.documentOptions.DOMContentLoaded.once,true);
  loading.domReady();await settle();loading.domReady();await settle();
  assert.equal(loading.loads,1);assert.equal(loading.intervals.length,1);
  assert.equal(loading.page.querySelectorAll('.mp-planner-bar').length,1);
  const complete=controller();await settle();
  assert.equal(complete.loads,1);assert.equal(complete.documentEvents.DOMContentLoaded,undefined);
});

test('a successful private restore notification enables a cold planner before its 1500ms fallback',async()=>{
  const raw=encode({notes:[note({body:'復元された架空のメモ'})]});
  const h=controller({raw,ready:false});await settle();const frame=h.frame;
  assert.equal(h.loads,0);assert.equal(h.lookup('メモを追加').disabled,true);
  assert.deepEqual(h.intervals.map(timer=>timer.ms),[1500]);
  assert.equal(Object.keys(h.childEvents).length,0,'the cold child has not been subscribed yet');
  h.frame.contentWindow.knLedgerSession={user:{id:'owner-A'}};
  h.recordsReady();await settle();
  assert.equal(h.elapsed,0,'no polling timer has advanced');assert.equal(h.loads,1);
  assert.equal(h.status,'');assert.equal(h.lookup('メモを追加').disabled,false);
  assert.equal(h.memo.value,'復元された架空のメモ');assert.equal(h.frame,frame);
  assert.equal(h.stages.length,0);assert.equal(h.saves.length,0);
});

test('private restore notifications reject foreign origins, unrelated or replaced frames and other types',async()=>{
  const h=controller({ready:false});await settle();
  const oldFrame=h.frame,oldSource=oldFrame.contentWindow;
  oldSource.knLedgerSession={user:{id:'owner-A'}};
  for(const event of [{origin:'https://foreign.fixture.test'},{source:{}},{data:{type:'kn-kakeibo-ready'}},{data:null}])h.recordsReady(event);
  await settle();assert.equal(h.loads,0);assert.equal(h.lookup('メモを追加').disabled,true);
  const frame=h.replaceFrame();assert.notEqual(frame,oldFrame);assert.equal(oldFrame.parentNode,null);
  h.recordsReady({source:oldSource});await settle();
  assert.equal(h.loads,0,'a detached frame cannot trigger a read for the replacement');
  h.recordsReady();await settle();assert.equal(h.loads,1);assert.equal(h.lookup('メモを追加').disabled,false);
});

test('a restore notification cannot bypass missing identity or turn a failed restore into editable empty records',async()=>{
  const raw=encode({notes:[note({body:'失敗時にも保持する架空の記録'})]});
  const h=controller({raw,ready:false,restoreOK:false});await settle();
  h.recordsReady();await settle();assert.equal(h.loads,0);assert.equal(h.lookup('メモを追加').disabled,true);
  h.frame.contentWindow.knLedgerSession={user:{id:'owner-A'}};
  h.recordsReady();await settle();
  assert.equal(h.loads,1);assert.equal(h.lookup('メモを追加').disabled,true);assert.equal(h.lookup('目標を追加').disabled,true);
  assert.match(h.status,/空の記録では上書きしません/);assert.equal(h.raw,raw);
  assert.equal(h.stages.length,0);assert.equal(h.saves.length,0);
});

test('a restore notification from a previous owner cannot reveal that owner after an account change or signout',async()=>{
  const raw=encode({notes:[note({body:'owner-A だけの架空の本文'})]});
  const h=controller({raw});await settle();assert.equal(h.memo.value,'owner-A だけの架空の本文');
  const loads=h.loads;h.auth({id:'owner-B'});await settle();h.recordsReady();await settle();
  assert.equal(h.loads,loads);assert.equal(h.memo.value,'');assert.equal(h.memo.disabled,true);
  assert.doesNotMatch(h.page.textContent,/owner-A だけ/);
  h.auth(null);await settle();h.recordsReady();await settle();
  assert.equal(h.loads,loads);assert.equal(h.memo.value,'');assert.equal(h.lookup('メモを追加').disabled,true);
});

test('restore notifications preserve a pending local draft, its save and the same private frame',async()=>{
  const raw=encode({notes:[note({body:'以前に保存した本文'})]});
  const h=controller({raw});await settle();const frame=h.frame;
  h.type(h.memo,'通信待ち中に書いた最新の本文');h.flushTimers();
  assert.equal(h.saves.length,1);const staged=h.raw,loads=h.loads,stages=h.stages.length;
  h.recordsReady();await settle();
  assert.equal(h.loads,loads,'the existing unsaved-revision guard must still skip reloads');
  assert.equal(h.frame,frame);assert.equal(h.memo.value,'通信待ち中に書いた最新の本文');
  assert.equal(h.raw,staged);assert.equal(h.stages.length,stages);assert.equal(h.saves.length,1);
  h.saves[0].resolve(false);await settle();
  assert.equal(h.memo.value,'通信待ち中に書いた最新の本文');assert.doesNotMatch(h.status,/保存しました/);
});

test('every keystroke is staged while an earlier cloud save is pending', async () => {
  const h=controller();await settle();
  h.lookup('メモを追加').click();
  h.type(h.memo,'最初\n');
  assert.equal(h.saves.length,0,'local staging does not immediately start a cloud save');
  h.flushTimers();
  h.type(h.memo,'最初\n通信待ち中の最後の入力');
  assert.equal(h.saves.length,1,'one cloud save can remain pending');
  assert.equal(JSON.parse(h.raw).notes[0].body,'最初\n通信待ち中の最後の入力');
  assert.equal(JSON.parse(h.stages.at(-1).raw).notes[0].body,'最初\n通信待ち中の最後の入力');
  h.saves[0].resolve(false);await settle();
  assert.equal(h.saves.length,1,'a revised draft still waits for the next idle flush');
  h.flushTimers();
  assert.equal(h.saves.length,2,'latest staged revision is subsequently synchronized');
  h.saves[1].resolve(false);await settle();
  assert.equal(h.memo.value,'最初\n通信待ち中の最後の入力');
  assert.doesNotMatch(h.status,/保存しました/);
});

test('many keystrokes stage every latest character but share one cloud save after 1500 idle milliseconds', async () => {
  const h=controller({autoSave:true});await settle();h.lookup('メモを追加').click();
  const before=h.stages.length,values=[];
  for(let i=1;i<=10;i++){
    const value='自由なメモ'.repeat(i);values.push(value);h.type(h.memo,value);
    assert.equal(JSON.parse(h.raw).notes[0].body,value,'each input is already retained locally');
    h.flushTimers(100);
    assert.equal(h.saves.length,0,'typing resets the cloud idle period');
  }
  assert.deepEqual(h.stages.slice(before).map(stage=>JSON.parse(stage.raw).notes[0].body),values);
  h.flushTimers(1399);assert.equal(h.saves.length,0);
  h.flushTimers(1);await settle();
  assert.equal(h.saves.length,1);
  assert.equal(JSON.parse(h.saves[0].raw).notes[0].body,values.at(-1));
});

test('same-owner token refresh retains a locally failed draft and never claims success', async () => {
  const h=controller({stageOK:false});await settle();
  h.lookup('メモを追加').click();h.type(h.memo,'ローカル保存失敗でも保持する本文');
  h.auth({id:'owner-A'});await settle();
  assert.equal(h.memo.value,'ローカル保存失敗でも保持する本文');
  assert.equal(h.saves.length,0);
  assert.match(h.status,/保存できません/);
});

test('an invalid stored document stays read-only and cannot be overwritten by an empty planner', async () => {
  const h=controller({raw:'{"version":2,"notes":[]}'});await settle();
  assert.equal(h.lookup('メモを追加').disabled,true);
  h.lookup('メモを追加').click();
  assert.equal(h.stages.length,0);assert.equal(h.saves.length,0);
  assert.equal(h.raw,'{"version":2,"notes":[]}');
  assert.match(h.status,/空の記録では上書きしません/);
});

test('signing out clears the editor and an older save completion cannot reveal private text', async () => {
  const h=controller();await settle();h.lookup('メモを追加').click();h.type(h.memo,'owner-A の架空本文');
  h.flushTimers();
  h.auth(null);await settle();
  assert.equal(h.memo.value,'');assert.equal(h.memo.disabled,true);
  h.saves[0].resolve(true);await settle();
  assert.equal(h.memo.value,'');assert.doesNotMatch(h.status,/保存しました/);
  assert.doesNotMatch(h.page.textContent,/owner-A の架空本文/);
});

test('signout cancels a not-yet-started owner cloud save while keeping staged bytes', async () => {
  const h=controller();await settle();h.lookup('メモを追加').click();h.type(h.memo,'owner-A の端末保存途中');
  const staged=h.raw;h.auth(null);await settle();h.flushTimers(3000);await settle();
  assert.equal(h.raw,staged);assert.equal(h.saves.length,0);assert.equal(h.memo.value,'');
});

test('existing todo edit drafts survive another task checkbox and a fresh controller', async () => {
  const raw=encode({todos:[
    {id:'first',text:'保存済みの本文',done:false,goalId:''},
    {id:'second',text:'別のやること',done:false,goalId:''}
  ]});
  const h=controller({raw});await settle();
  const firstEditor=h.page.querySelector('.mp-tasks').children[0].querySelector('.mp-task-edit input');
  h.type(firstEditor,'編集途中の本文\n');
  const secondCheck=h.page.querySelector('.mp-tasks').children[1].querySelector('input');
  secondCheck.checked=true;secondCheck.dispatch('change');
  assert.equal(h.page.querySelector('.mp-tasks').children[0].querySelector('.mp-task-edit input').value,'編集途中の本文\n');
  const staged=JSON.parse(h.raw);
  assert.equal(staged.todos[0].text,'保存済みの本文');
  assert.equal(staged.todoEdits.first.text,'編集途中の本文\n');
  const restored=controller({raw:h.raw});await settle();
  assert.equal(restored.page.querySelector('.mp-tasks').children[0].querySelector('.mp-task-edit input').value,'編集途中の本文\n');
});

test('signout removes private goal drafts and names from every remaining form control', async () => {
  const raw=encode({
    goals:[goal({title:'owner-A の目標名'})],
    groups:[{id:'group-1',name:'owner-A のまとめ名'}],
    notes:[note({title:'owner-A の題名',body:'owner-A の本文',groupId:'group-1'})],
    todoDraft:{text:'owner-A の追加途中',goalId:'goal-1'},
    goalDraft:{id:'goal-1',title:'owner-A の目標編集途中',details:'owner-A の詳細途中',target:'987.65',monthly:'12.3',deadline:'2027-12-31'}
  });
  const h=controller({raw});await settle();
  h.auth(null);await settle();
  for(const field of h.page.querySelectorAll('input,textarea,select')) {
    assert.equal(field.value,'','old owner form values must be cleared');
    assert.doesNotMatch(field.textContent,/owner-A/,'old owner option labels must be cleared');
  }
});

test('a later unsupported restore cannot be overwritten through an older valid editable document', async () => {
  const original=encode({notes:[note({body:'最後に確認できた本文'})]});
  const h=controller({raw:original,autoSave:true});await settle();
  assert.equal(h.memo.value,'最後に確認できた本文');
  h.bridge.load=async()=>({raw:'{"version":2,"new_format":{"preserve":true}}',assetsRaw:null});
  h.auth({id:'owner-A'});await settle();
  assert.equal(h.memo.value,'最後に確認できた本文','keep the last confirmed text visible');
  assert.equal(h.memo.disabled,true,'failed newer restore must make the old document read-only');
  assert.equal(h.lookup('メモを追加').disabled,true);
  assert.equal(h.lookup('目標を追加').disabled,true,'goal actions must also respect the failed restore');
  h.lookup('目標を追加').click();
  h.lookup('メモを追加').click();
  assert.equal(h.stages.length,0);
  h.bridge.load=async()=>({raw:original,assetsRaw:null});h.lookup('再試行').click();await settle();
  assert.equal(h.memo.disabled,false,'successful explicit restore allows editing again');
});

test('an identical owner refresh keeps existing todo handlers connected to the saved document', async () => {
  const raw=encode({todos:[{id:'todo-1',text:'更新後に完了する',done:false,goalId:''}]});
  const h=controller({raw,autoSave:true});await settle();
  const originalCheck=h.page.querySelector('.mp-tasks').children[0].querySelector('input');
  h.auth({id:'owner-A'});await settle();
  assert.equal(h.page.querySelector('.mp-tasks').children[0].querySelector('input'),originalCheck,'same data retains the mounted row');
  originalCheck.checked=true;originalCheck.dispatch('change');await settle();
  h.flushTimers();await settle();
  assert.equal(JSON.parse(h.raw).todos[0].done,true,'the handler must update the live document, not a detached clone');
  assert.equal(h.page.querySelector('.mp-completed-tasks').children[0].querySelector('input').checked,true);
});

test('an identical tab restore keeps existing group rename handlers connected to the saved document', async () => {
  const raw=encode({groups:[{id:'group-1',name:'元のまとめ'}],notes:[note({body:'本文はそのまま\n',groupId:'group-1'})]});
  const h=controller({raw,autoSave:true});await settle();
  const rename=h.lookup('名前を変更');
  h.page.querySelectorAll('.mo-tab')[3].click();await settle();
  assert.equal(h.lookup('名前を変更'),rename,'same data retains the mounted group controls');
  h.w.prompt=()=> '名前を変えたまとめ';rename.click();await settle();
  h.flushTimers();await settle();
  const saved=JSON.parse(h.raw);
  assert.equal(saved.groups[0].name,'名前を変えたまとめ','the retained handler must update the live group');
  assert.equal(saved.notes[0].body,'本文はそのまま\n');
  assert.equal(saved.notes[0].groupId,'group-1');
  assert.ok(h.lookup('名前を変えたまとめ'));
});

test('large valid fractional yen are retained without a 15-digit rounding rule',()=>{
  assert.equal(planner.assets(JSON.stringify([{amount:999999999999999.5,cat:'現金'}])).total,999999999999999.5);
  assert.equal(planner.progress(goal({target:1000000000000000}),{total:999999999999999.5},[]).gap,0.5);
});
test('planned deposits use decimal addition without binary multiplication artifacts',()=>{
  const result=planner.plan(goal({deadline:'2027-01-31',monthly:0.1}),0,Date.UTC(2026,9,17));
  assert.equal(result.months,3);assert.equal(result.total,0.3);
});

const reminder=(id,extra={})=>({id,text:id,done:false,goalId:'',...extra});
function reminderEditor(row){
  const edit=row.querySelector('.mp-task-edit'),inputs=edit.querySelectorAll('input');
  return {edit,title:edit.querySelector('summary'),text:inputs.find(n=>n.type==='text'),due:inputs.find(n=>n.type==='date'),flag:inputs.find(n=>n.type==='checkbox'),goal:edit.querySelector('select'),save:edit.querySelectorAll('button').find(n=>n.textContent==='変更を保存')};
}
const reminderInput=(h,id)=>h.page.querySelectorAll('input').find(n=>n.id===id);
const taskRows=(h,completed=false)=>h.page.querySelector(completed?'.mp-completed-tasks':'.mp-tasks').children.filter(n=>n.classList.contains('mp-task'));

test('legacy reminder rows and additive fields remain byte-for-byte unchanged when merely restored',async()=>{
  const raw=encode({todos:[reminder('old',{extension:{preserve:'row'}})],todoDraft:{text:'書きかけ',goalId:'',extension:{preserve:'composer'}},todoEdits:{old:{text:'編集途中',goalId:'',extension:{preserve:'editor'}}}});
  const decoded=planner.decode(raw);assert.equal(JSON.stringify(decoded),raw);
  assert.equal(Object.hasOwn(decoded.todos[0],'dueDate'),false);assert.equal(Object.hasOwn(decoded.todoDraft,'flagged'),false);
  const h=controller({raw});await settle();
  assert.equal(h.raw,raw);assert.equal(h.stages.length,0);assert.equal(h.saves.length,0);assert.equal(h.focused,null);
  assert.equal(reminderInput(h,'mpTodoInput').value,'書きかけ');
  assert.equal(reminderEditor(taskRows(h)[0]).text.value,'編集途中');
});

test('optional reminder dates and flags reject invalid saved rows and both kinds of draft atomically',()=>{
  const places=value=>[
    {todos:[reminder('valid'),reminder('invalid',value)]},
    {todoDraft:{text:'新規',goalId:'',...value}},
    {todoEdits:{draft:{text:'編集',goalId:'',...value}}}
  ];
  for(const value of [{dueDate:null},{dueDate:7},{dueDate:'2026-02-29'},{dueDate:'2026-04-31'},{dueDate:'2026/10/18'},{flagged:'true'},{flagged:1},{flagged:null}])
    for(const extra of places(value))assert.throws(()=>planner.decode(encode(extra)),undefined,JSON.stringify(extra));
  for(const dueDate of ['', '2028-02-29'])for(const flagged of [false,true])
    assert.equal(planner.decode(encode({todos:[reminder('valid',{dueDate,flagged})]})).todos[0].dueDate,dueDate);
});

test('reminder today follows the device calendar across time zones rather than a fixed financial timezone',()=>{
  const modulePath=JSON.stringify(require.resolve('../static/mypage-planner.js'));
  const code='process.stdout.write(require('+modulePath+').localDateKey("2026-10-17T15:30:00Z"))';
  for(const [zone,expected] of [['Asia/Tokyo','2026-10-18'],['America/Los_Angeles','2026-10-17'],['Pacific/Honolulu','2026-10-17']]){
    const run=spawnSync(process.execPath,['-e',code],{encoding:'utf8',env:{TZ:zone}});
    assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,expected,zone);
  }
  assert.throws(()=>planner.localDateKey('invalid'));
});

test('smart reminder filters preserve order, combine literal search and exclude completed items outside All',()=>{
  const today='2026-10-18',rows=Object.freeze([
    reminder('undated',{text:'税金の確認'}),reminder('overdue',{text:'Tax review',dueDate:'2026-10-17'}),
    reminder('today',{text:'税金の支払',dueDate:today,flagged:true}),
    reminder('future',{text:'Tax plan',dueDate:'2026-10-19',flagged:true}),
    reminder('completed',{text:'Tax done',done:true,dueDate:today,flagged:true})
  ].map(Object.freeze));
  const before=JSON.stringify(rows),ids=(filter,search='')=>planner.filterTodos(rows,filter,search,today).map(t=>t.id);
  assert.deepEqual(ids('all'),['undated','overdue','today','future','completed']);
  assert.deepEqual(ids('today'),['today']);assert.deepEqual(ids('scheduled'),['overdue','today','future']);
  assert.deepEqual(ids('flagged'),['today','future']);assert.deepEqual(ids('scheduled',' TAX '),['overdue','future']);
  assert.deepEqual(ids('flagged','税金'),['today']);assert.deepEqual(ids('today','plan'),[]);
  assert.equal(JSON.stringify(rows),before);assert.equal(planner.filterTodos(rows,'today','',today)[0],rows[2]);
  assert.throws(()=>planner.filterTodos(rows,'unknown','',today));assert.throws(()=>planner.filterTodos(rows,'all','','2026-02-30'));
});

test('reminder row titles open native editing independently from completion and completed items start folded',async()=>{
  const raw=encode({todos:[reminder('first',{text:'  <b>文字のまま</b>  '}),reminder('done',{done:true}),reminder('last')]});
  const h=controller({raw});await settle();const rows=taskRows(h),row=rows[0],editor=reminderEditor(row),check=row.querySelector('.mp-task-check input');
  assert.equal(rows.length,2);assert.equal(taskRows(h,true).length,1);
  assert.equal(h.page.querySelector('.mp-completed').open,false);assert.equal(h.page.querySelector('.mp-completed').hidden,false);
  assert.equal(h.page.querySelector('.mp-reminders-count').textContent,'2');
  assert.equal(editor.edit.tagName,'DETAILS');assert.equal(editor.title.tagName,'SUMMARY');assert.equal(check.type,'checkbox');
  assert.equal(row.querySelector('.mp-task-circle').getAttribute('aria-hidden'),'true');
  assert.equal(editor.title.querySelector('.mp-task-text').textContent,'  <b>文字のまま</b>  ');
  editor.title.click();assert.equal(editor.edit.open,true);assert.equal(h.focused,editor.text);
  assert.equal(check.checked,false);assert.equal(h.raw,raw);assert.equal(h.stages.length,0);
});

test('completing and restoring a reminder keeps its identity, original order and goal progress',async()=>{
  const raw=encode({goals:[goal()],todos:[reminder('first',{goalId:'goal-1'}),reminder('already-done',{done:true,goalId:'goal-1'}),reminder('last')]});
  const h=controller({raw,autoSave:true});await settle();
  const firstCheck=taskRows(h)[0].querySelector('.mp-task-check input');firstCheck.checked=true;firstCheck.dispatch('change');
  let saved=JSON.parse(h.raw);assert.deepEqual(saved.todos.map(t=>t.id),['first','already-done','last']);
  assert.equal(saved.todos[0].done,true);assert.equal(taskRows(h).length,1);assert.equal(taskRows(h,true).length,2);
  assert.equal(planner.progress(saved.goals[0],null,saved.todos).done,2);
  const completed=h.page.querySelector('.mp-completed');completed.open=true;completed.dispatch('toggle');
  const restore=taskRows(h,true)[0].querySelector('.mp-task-check input');restore.checked=false;restore.dispatch('change');
  saved=JSON.parse(h.raw);assert.equal(saved.todos[0].done,false);assert.equal(saved.todos[0].goalId,'goal-1');
  assert.equal(taskRows(h)[0].querySelector('.mp-task-text').textContent,'first');assert.equal(completed.open,true);
  assert.equal(planner.progress(saved.goals[0],null,saved.todos).done,1);
});

test('reminder edit metadata and unknown draft fields survive another completion and a fresh controller',async()=>{
  const raw=encode({goals:[goal(),goal({id:'goal-2',title:'別の目標'})],todos:[reminder('first',{text:'確定本文',goalId:'goal-1',dueDate:'2027-01-01',extension:{retain:'row'}}),reminder('second')],todoEdits:{first:{text:'編集中',goalId:'goal-1',dueDate:'2027-01-02',flagged:false,extension:{retain:'draft'}}}});
  const h=controller({raw});await settle();let fields=reminderEditor(taskRows(h)[0]);assert.equal(h.focused,null);
  h.type(fields.text,'途中の本文\n末尾  ');fields.goal.value='goal-2';fields.goal.dispatch('change');fields.due.value='2027-03-05';fields.due.dispatch('input');fields.flag.checked=true;fields.flag.dispatch('change');
  const other=taskRows(h)[1].querySelector('.mp-task-check input');other.checked=true;other.dispatch('change');
  fields=reminderEditor(taskRows(h)[0]);assert.equal(fields.edit.open,true);assert.equal(fields.text.value,'途中の本文\n末尾  ');
  assert.equal(fields.goal.value,'goal-2');assert.equal(fields.due.value,'2027-03-05');assert.equal(fields.flag.checked,true);
  const staged=JSON.parse(h.raw);assert.equal(staged.todos[0].text,'確定本文');assert.deepEqual(staged.todos[0].extension,{retain:'row'});assert.deepEqual(staged.todoEdits.first.extension,{retain:'draft'});
  const restored=controller({raw:h.raw});await settle();const fresh=reminderEditor(taskRows(restored)[0]);
  assert.equal(fresh.text.value,fields.text.value);assert.equal(fresh.due.value,'2027-03-05');assert.equal(fresh.flag.checked,true);assert.equal(restored.focused,null);
  fresh.save.click();const saved=JSON.parse(restored.raw);
  assert.equal(saved.todos[0].text,'途中の本文\n末尾  ');assert.equal(saved.todos[0].goalId,'goal-2');assert.equal(saved.todos[0].dueDate,'2027-03-05');assert.equal(saved.todos[0].flagged,true);assert.deepEqual(saved.todos[0].extension,{retain:'row'});assert.equal(saved.todoEdits.first,undefined);
  restored.flushTimers();assert.equal(restored.saves.length,1);restored.saves[0].resolve(false);await settle();
  assert.equal(JSON.parse(restored.raw).todos[0].dueDate,'2027-03-05');assert.equal(JSON.parse(restored.raw).todos[0].flagged,true);assert.doesNotMatch(restored.status,/保存しました/);
});

test('a completed reminder edit draft is discoverable on restore without moving focus into its editor',async()=>{
  const h=controller({raw:encode({todos:[reminder('done',{done:true})],todoEdits:{done:{text:'完了後の編集途中',goalId:'',dueDate:'2027-03-05',flagged:true}}})});await settle();
  assert.equal(h.page.querySelector('.mp-completed').open,true);const edit=reminderEditor(taskRows(h,true)[0]);
  assert.equal(edit.edit.open,true);assert.equal(edit.text.value,'完了後の編集途中');assert.equal(edit.flag.checked,true);assert.equal(h.focused,null);
});

test('the new reminder line retains its draft fields and adds the exact text with goal, optional date and flag',async()=>{
  const raw=encode({goals:[goal()],todoDraft:{text:'初期草稿',goalId:'goal-1',dueDate:'2027-01-02',flagged:true,extension:{retain:'composer'}}});
  const h=controller({raw});await settle();const input=reminderInput(h,'mpTodoInput'),due=reminderInput(h,'mpTodoDueDate'),flag=reminderInput(h,'mpTodoFlagged');
  assert.equal(input.value,'初期草稿');assert.equal(due.value,'2027-01-02');assert.equal(flag.checked,true);
  h.type(input,'  追加する本文\n末尾  ');due.value='2027-05-06';due.dispatch('input');flag.checked=false;flag.dispatch('change');
  assert.deepEqual(JSON.parse(h.raw).todoDraft.extension,{retain:'composer'});
  const fresh=controller({raw:h.raw});await settle();assert.equal(reminderInput(fresh,'mpTodoInput').value,'  追加する本文\n末尾  ');assert.equal(reminderInput(fresh,'mpTodoDueDate').value,'2027-05-06');
  fresh.page.querySelector('.mp-reminder-add').dispatch('submit');const saved=JSON.parse(fresh.raw),added=saved.todos[0];
  assert.ok(added.id);assert.equal(added.text,'  追加する本文\n末尾  ');assert.equal(added.goalId,'goal-1');assert.equal(added.dueDate,'2027-05-06');assert.equal(added.flagged,false);assert.equal(added.done,false);
  assert.equal(saved.todoDraft.text,'');assert.equal(saved.todoDraft.dueDate,'');assert.equal(saved.todoDraft.flagged,false);assert.deepEqual(saved.todoDraft.extension,{retain:'composer'});assert.equal(fresh.focused,reminderInput(fresh,'mpTodoInput'));
});

test('smart filters and search change only the view while an unrelated new reminder is always revealed',async()=>{
  const today=planner.localDateKey(),raw=encode({todos:[reminder('today',{text:'今日の税金',dueDate:today}),reminder('future',{text:'Tax plan',dueDate:'2099-01-01',flagged:true}),reminder('undated')]});
  const h=controller({raw});await settle();h.lookup('今日').click();assert.equal(taskRows(h).length,1);assert.equal(h.lookup('今日').getAttribute('aria-pressed'),'true');
  h.lookup('予定あり').click();const search=h.page.querySelector('.mp-reminder-search');h.type(search,' TAX ');assert.equal(taskRows(h).length,1);assert.equal(taskRows(h)[0].querySelector('.mp-task-text').textContent,'Tax plan');
  assert.equal(h.raw,raw);assert.equal(h.stages.length,0);assert.equal(h.saves.length,0);
  h.type(reminderInput(h,'mpTodoInput'),'期限を決めない新規');h.page.querySelector('.mp-reminder-add').dispatch('submit');
  assert.equal(h.lookup('すべて').getAttribute('aria-pressed'),'true');assert.equal(search.value,'');
  const added=JSON.parse(h.raw).todos.at(-1);assert.equal(added.dueDate,'');assert.equal(added.flagged,false);assert.ok(taskRows(h).some(row=>row.querySelector('.mp-task-text').textContent==='期限を決めない新規'));
});

test('overdue dates are named in text and invalid composer or edit dates cannot alter saved records',async()=>{
  const raw=encode({todos:[reminder('old',{dueDate:'2001-01-01'})]});const h=controller({raw});await settle();
  assert.match(taskRows(h)[0].querySelector('.mp-task-overdue').textContent,/期限切れ/);
  const input=reminderInput(h,'mpTodoInput'),due=reminderInput(h,'mpTodoDueDate');input.value='無効な期限';due.value='2026-02-30';due.dispatch('input');h.page.querySelector('.mp-reminder-add').dispatch('submit');
  assert.equal(h.raw,raw);assert.equal(h.stages.length,0);assert.match(h.status,/期限の日付/);
  const fields=reminderEditor(taskRows(h)[0]);fields.due.value='2026-02-30';fields.due.dispatch('input');fields.save.click();
  assert.equal(h.raw,raw);assert.equal(h.stages.length,0);
});

test('new reminder controls stay read-only after restore failure and clear private drafts, filters and completed counts on signout',async()=>{
  const raw=encode({todos:[reminder('private',{text:'owner-A の予定',done:true})],todoDraft:{text:'owner-A の草稿',goalId:'',dueDate:'2027-01-01',flagged:true}});
  const failed=controller({raw,restoreOK:false});await settle();
  for(const input of failed.page.querySelectorAll('.mp-reminders input'))assert.equal(input.disabled,true);
  failed.page.querySelector('.mp-reminder-add').dispatch('submit');assert.equal(failed.raw,raw);assert.equal(failed.stages.length,0);
  const h=controller({raw});await settle();h.lookup('フラグ').click();h.type(h.page.querySelector('.mp-reminder-search'),'owner-A');h.auth(null);await settle();
  assert.equal(reminderInput(h,'mpTodoInput').value,'');assert.equal(reminderInput(h,'mpTodoDueDate').value,'');assert.equal(reminderInput(h,'mpTodoFlagged').checked,false);
  assert.equal(h.page.querySelector('.mp-reminder-search').value,'');assert.equal(h.lookup('すべて').getAttribute('aria-pressed'),'true');
  assert.equal(h.page.querySelector('.mp-reminders-count').textContent,'0');assert.equal(h.page.querySelector('.mp-completed').hidden,true);assert.equal(h.page.querySelector('.mp-completed').open,false);
  assert.equal(taskRows(h).length,0);assert.equal(taskRows(h,true).length,0);assert.doesNotMatch(h.page.textContent,/owner-A/);assert.equal(h.raw,raw);
});

test('a queued reminder search or filter event cannot re-enable rows after a later restore failure',async()=>{
  const raw=encode({todos:[reminder('retained',{text:'確認済みの本文',dueDate:'2027-01-01',flagged:true})]});
  const h=controller({raw});await settle();const row=taskRows(h)[0];
  h.bridge.load=async()=>{throw Error('fixture_restore_failed');};h.auth({id:'owner-A'});await settle();
  assert.equal(h.lookup('今日').disabled,true);assert.equal(reminderEditor(row).due.disabled,true);
  h.type(h.page.querySelector('.mp-reminder-search'),'該当しない検索');h.lookup('今日').dispatch('click');
  assert.equal(taskRows(h)[0],row,'read-only events cannot rebuild fresh enabled controls');
  assert.equal(reminderEditor(row).due.disabled,true);assert.equal(row.querySelector('.mp-task-check input').disabled,true);
  assert.equal(h.raw,raw);assert.equal(h.stages.length,0);assert.equal(h.saves.length,0);
});


test('note excerpts are display-only and never normalise the saved text or additive fields',()=>{
  const original=note({title:'  ',body:'\n  最初の行  \n\n二行目\n 三行目  ',extension:{keep:'yes'}});
  const before=JSON.stringify(original);
  assert.deepEqual(planner.notePreview(original),{title:'最初の行',excerpt:'二行目 三行目'});
  assert.equal(JSON.stringify(original),before);
  assert.deepEqual(planner.notePreview(note({title:' 別の題名 ',body:' 本文の先頭\n続き'})),{title:'別の題名',excerpt:'本文の先頭 続き'});
  assert.deepEqual(planner.notePreview(note()),{title:'無題のメモ',excerpt:''});
});

test('notes start in a readable list and opening and returning retain the same plain text editor',async()=>{
  const raw=encode({notes:[note({title:'旅の記録',body:'行きたい場所\n神戸と京都'})]});
  const h=controller({raw});await settle();
  const library=h.page.querySelector('.mp-note-library'),editor=h.page.querySelector('.mp-note-editor'),body=h.memo;
  assert.equal(library.hidden,false);assert.equal(editor.hidden,true);
  assert.equal(h.page.querySelector('.mp-note-name').textContent,'旅の記録');
  assert.equal(h.page.querySelector('.mp-note-excerpt').textContent,'行きたい場所 神戸と京都');
  assert.equal(h.raw,raw);assert.equal(h.stages.length,0);
  h.page.querySelector('.mp-note-pick').click();
  assert.equal(library.hidden,true);assert.equal(editor.hidden,false);
  assert.equal(h.focused,editor,'opening is accessible without forcing a phone keyboard');
  h.type(body,'行きたい場所\n神戸と京都\n奈良');
  const saved=JSON.parse(h.raw),stageCount=h.stages.length;
  h.lookup('メモ一覧').click();
  assert.equal(library.hidden,false);assert.equal(editor.hidden,true);
  assert.equal(h.stages.length,stageCount,'returning is view-only');
  h.page.querySelector('.mp-note-pick').click();
  assert.equal(h.memo,body);assert.equal(body.value,saved.notes[0].body);
});

test('literal search filters title and body without saving or clearing another note',async()=>{
  const raw=encode({notes:[note({id:'a',title:'投資',body:'NISAを学ぶ'}),note({id:'b',title:'旅行',body:'京都での予定'})]});
  const h=controller({raw});await settle();
  const find=h.page.querySelector('.mp-note-search');
  h.type(find,' 京都 ');
  assert.equal(h.page.querySelectorAll('.mp-note-pick').length,1);
  assert.equal(h.page.querySelector('.mp-note-name').textContent,'旅行');
  assert.equal(h.page.querySelector('.mp-note-count').textContent,'1件のメモ');
  h.type(find,'<img src=x onerror=alert(1)>');
  assert.equal(h.page.querySelectorAll('.mp-note-pick').length,0);
  assert.match(h.page.querySelector('.mp-note-empty').textContent,/見つかりません/);
  assert.equal(h.raw,raw);assert.equal(h.stages.length,0);
});

test('new notes clear both search state and input and keep the chosen existing folder',async()=>{
  const h=controller({raw:encode({groups:[{id:'g',name:'旅のフォルダ'}],notes:[note({groupId:'g',body:'既存の本文'})]})});await settle();
  h.lookup('旅のフォルダ').click();
  h.type(h.page.querySelector('.mp-note-search'),'見つからない言葉');
  h.lookup('メモを追加').click();
  const saved=JSON.parse(h.raw);
  assert.equal(saved.notes.length,2);assert.equal(saved.notes[0].body,'既存の本文');
  assert.equal(saved.notes[1].groupId,'g');
  assert.equal(h.page.querySelector('.mp-note-search').value,'');
  assert.equal(h.page.querySelector('.mp-note-editor').hidden,false);
  assert.equal(h.memo.value,'');assert.equal(h.focused,h.memo);
  h.type(h.memo,'新しい本文');
  h.lookup('メモ一覧').click();
  assert.equal(h.page.querySelectorAll('.mp-note-pick').length,2);
});

test('Japanese note typing preserves the live input node and does not assign its value again',async()=>{
  const h=controller({raw:encode({notes:[note({body:'前の行\n続き'})]})});await settle();
  h.page.querySelector('.mp-note-pick').click();
  const input=h.memo;let value=input.value,writes=0;
  Object.defineProperty(input,'value',{get:()=>value,set:v=>{writes++;value=v;}});
  input.selectionStart=2;input.selectionEnd=2;
  h.type(input,'前の行\nにほんご入力途中');
  assert.equal(writes,1,'the input event must not rewrite textarea.value while composing');
  assert.equal(h.memo,input);assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,2);
  assert.equal(JSON.parse(h.raw).notes[0].body,'前の行\nにほんご入力途中');
});

test('confirmed notes remain readable after a failed newer restore without enabling any save',async()=>{
  const raw=encode({notes:[note({id:'a',title:'一つ目',body:'確認済み本文A'}),note({id:'b',title:'二つ目',body:'確認済み本文B'})]});
  const h=controller({raw});await settle();
  h.bridge.load=async()=>{throw Error('fixture_unavailable');};
  h.auth({id:'owner-A'});await settle();
  const picks=h.page.querySelectorAll('.mp-note-pick');
  assert.equal(picks[1].disabled,false);
  picks[1].click();
  assert.equal(h.page.querySelector('.mp-note-editor').hidden,false);assert.equal(h.memo.value,'確認済み本文B');
  assert.equal(h.memo.disabled,true);assert.equal(h.lookup('このメモを削除').disabled,true);
  assert.equal(h.lookup('メモを追加').disabled,true);
  assert.equal(h.lookup('メモ一覧').disabled,false);h.lookup('メモ一覧').click();
  assert.equal(h.page.querySelector('.mp-note-library').hidden,false);
  assert.equal(h.stages.length,0);assert.equal(h.saves.length,0);assert.equal(h.raw,raw);
});

test('note deletion still requires confirmation and returns to a list without touching other notes',async()=>{
  const h=controller({raw:encode({notes:[note({id:'a',body:'残す本文'}),note({id:'b',body:'対象本文'})]})});await settle();
  h.page.querySelectorAll('.mp-note-pick')[1].click();
  h.w.confirm=()=>false;const staged=h.raw;
  h.lookup('このメモを削除').click();assert.equal(h.raw,staged);
  h.w.confirm=()=>true;h.lookup('このメモを削除').click();
  assert.deepEqual(JSON.parse(h.raw).notes.map(n=>n.body),['残す本文']);
  assert.equal(h.page.querySelector('.mp-note-editor').hidden,true);
  assert.equal(h.page.querySelectorAll('.mp-note-pick').length,1);
});

test('signout clears private note excerpts, folder heading, search and editor view as well as form values',async()=>{
  const h=controller({raw:encode({groups:[{id:'g',name:'private-owner-folder'}],notes:[note({title:'private-owner-title',body:'private-owner-body',groupId:'g'})]})});await settle();
  h.lookup('private-owner-folder').click();
  h.type(h.page.querySelector('.mp-note-search'),'private-owner');
  h.page.querySelector('.mp-note-pick').click();
  h.auth(null);await settle();
  assert.doesNotMatch(h.page.textContent,/private-owner/);
  assert.equal(h.page.querySelector('.mp-note-search').value,'');
  assert.equal(h.page.querySelector('.mp-note-editor').hidden,true);
  assert.equal(h.page.querySelector('.mp-note-library').hidden,false);
  assert.equal(h.page.querySelector('.mp-note-count').textContent,'0件のメモ');
  assert.equal(h.memo.value,'');
});

test('readonly recovery can clear earlier search and folder filters while folder mutation stays disabled',async()=>{
  const raw=encode({groups:[{id:'g',name:'選んだフォルダ'}],notes:[note({id:'a',title:'一つ目',body:'確認済み本文A',groupId:'g'}),note({id:'b',title:'二つ目',body:'確認済み本文B'})]});
  const h=controller({raw});await settle();
  h.lookup('選んだフォルダ').click();h.type(h.page.querySelector('.mp-note-search'),'一つ目');
  h.bridge.load=async()=>{throw Error('fixture_unavailable');};h.auth({id:'owner-A'});await settle();
  assert.equal(h.page.querySelectorAll('.mp-note-pick').length,1);
  assert.equal(h.page.querySelector('.mp-note-search').disabled,false);
  h.type(h.page.querySelector('.mp-note-search'),'');
  h.lookup('すべてのメモ').click();
  assert.equal(h.page.querySelectorAll('.mp-note-pick').length,2);
  h.page.querySelectorAll('.mp-note-pick')[1].click();
  assert.equal(h.memo.value,'確認済み本文B');assert.equal(h.memo.disabled,true);
  assert.equal(h.lookup('名前を変更').disabled,true);assert.equal(h.lookup('まとめを解除').disabled,true);
  assert.equal(h.lookup('まとめを作る').disabled,true);
  h.lookup('メモ一覧').click();assert.equal(h.lookup('選んだフォルダ').disabled,false);
  h.lookup('選んだフォルダ').click();assert.equal(h.page.querySelectorAll('.mp-note-pick').length,1);
  assert.equal(h.stages.length,0);assert.equal(h.saves.length,0);assert.equal(h.raw,raw);
});

const format=(h,label)=>h.page.querySelectorAll('button').find(n=>n.getAttribute('aria-label')===label);
test('the formatted editor restores plain bytes without migrating or writing rich metadata',async()=>{
  const body='  本文\r\n\r\n<script>文字</script> 😀\t  ',raw=encode({notes:[note({body})]});
  const h=controller({raw,richEditor:true});await settle();const host=h.page.querySelector('.mp-note-rich');
  assert.ok(host);assert.equal(h.memo.hidden,true);assert.equal(h.memo.value,body);assert.equal(h.raw,raw);assert.equal(h.stages.length,0);assert.equal(h.saves.length,0);assert.equal(host.querySelectorAll('script').length,0);
  const live=host.children[0].children[0].children[0];format(h,'太字').click();const data=planner.decode(h.stages.at(-1).raw);assert.equal(data.notes[0].body,body);assert.equal(data.notes[0].richText.blocks[0].runs[0].bold,true);assert.equal(data.notes[0].title,'');assert.equal(h.frame.contentWindow.kkMyPageStore,h.bridge);assert.notEqual(host.children[0].children[0].children[0],live,'explicit formatting may rebuild; ordinary input must not');
});
test('formatted typing stages each keystroke, mirrors exact text and shares the existing debounce',async()=>{
  const h=controller({raw:encode({notes:[note({body:'もと'})]}),richEditor:true});await settle();const host=h.page.querySelector('.mp-note-rich'),node=host.children[0].children[0].children[0];
  for(const value of ['もとあ','もとあい','もとあいう']){node.nodeValue=value;host.dispatch('input',{inputType:'insertText'});assert.equal(host.children[0].children[0].children[0],node);assert.equal(h.memo.value,value);assert.equal(planner.decode(h.stages.at(-1).raw).notes[0].body,value);}
  assert.equal(h.stages.length,3);assert.equal(h.saves.length,0);h.flushTimers(1499);assert.equal(h.saves.length,0);h.flushTimers(1);assert.equal(h.saves.length,1);assert.equal(planner.decode(h.saves[0].raw).notes[0].body,'もとあいう');
});
test('a failed newer restore makes rich text read-only while keeping known formatted content',async()=>{
  const E=require('../static/mypage-note-editor.js'),rich=E.blockType(E.plain('既知のチェック'),{start:0,end:0},'check');
  const h=controller({raw:encode({notes:[note({body:E.project(rich),richText:rich})]}),richEditor:true});await settle();const host=h.page.querySelector('.mp-note-rich');
  h.bridge.load=async()=>{throw Error('fixture_restore_failed');};h.childEvents.knMyPageStoreChange();await settle();assert.equal(host.contentEditable,'false');assert.equal(host.querySelector('input').disabled,true);assert.equal(format(h,'太字').disabled,true);assert.match(host.textContent,/既知のチェック/);host.dispatch('beforeinput',{inputType:'formatBold'});assert.equal(h.stages.length,0);assert.match(h.status,/読み込めません/);
});
test('switching owners clears rich DOM, composition and undo history before another restore',async()=>{
  const h=controller({raw:encode({notes:[note({body:'所有者Aの内容'})]}),richEditor:true});await settle();const host=h.page.querySelector('.mp-note-rich');format(h,'太字').click();host.dispatch('compositionstart');const count=h.stages.length;
  h.auth({id:'owner-B'});await settle();assert.equal(host.textContent,'');assert.equal(h.memo.value,'');assert.equal(host.contentEditable,'false');host.dispatch('compositionend');host.dispatch('keydown',{key:'z',metaKey:true});assert.equal(h.stages.length,count);assert.equal(host.textContent,'');assert.equal(h.page.textContent.includes('所有者Aの内容'),false);
});
test('unknown rich versions remain readable and cannot be replaced by plaintext fallback events',async()=>{
  const raw=encode({notes:[note({body:'保持する本文',richText:{version:99,blocks:[]}})]});
  const h=controller({raw,richEditor:true});await settle();const host=h.page.querySelector('.mp-note-rich');assert.equal(host.contentEditable,'false');assert.equal(host.textContent,'保持する本文');assert.equal(h.page.querySelector('.mp-note-editor-notice').hidden,false);h.type(h.memo,'上書き');format(h,'太字').click();assert.equal(h.stages.length,0);assert.equal(h.raw,raw);
});
test('rich data preserves notes, exact body bytes and unknown additive fields through a fresh restore',async()=>{
  const h=controller({raw:encode({notes:[note({body:'a\r\nb',futureField:{kept:true}}),note({id:'other',body:'別の本文'})]}),richEditor:true});await settle();format(h,'チェックリスト').click();let data=planner.decode(h.raw);const first=data.notes[0],checks=h.page.querySelector('.mp-note-rich').querySelectorAll('input');checks[0].checked=true;checks[0].dispatch('change');data=planner.decode(h.raw);assert.equal(data.notes[0].body,'a\r\nb');assert.equal(data.notes[0].richText.blocks[0].checked,true);assert.deepEqual(data.notes[0].futureField,{kept:true});assert.equal(data.notes[1].body,'別の本文');
  const next=controller({raw:h.raw,richEditor:true});await settle();assert.deepEqual(planner.decode(next.raw).notes,data.notes);assert.equal(next.page.querySelector('.mp-note-rich').querySelector('input').checked,true);assert.equal(next.stages.length,0);assert.equal(first.body,'a\r\nb');
});
test('a long note crossing the unchanged one-million-character store limit keeps the saved bytes and visibly unsaved draft',async()=>{
  const body='長'.repeat(600000),raw=encode({notes:[note({body})]});assert.ok(raw.length<1000000);
  const h=controller({raw,richEditor:true});await settle();const stage=h.bridge.stage;h.bridge.stage=(owner,value)=>value.length<=1000000&&stage(owner,value);
  const title=h.page.querySelector('.mp-note-title');h.type(title,'保存できる小さな変更');const saved=h.raw;assert.match(h.status,/この端末に保存しました/);
  format(h,'太字').click();assert.equal(h.raw,saved);assert.match(h.status,/保存できません/);assert.match(h.status,/書きかけを保持/);assert.equal(h.memo.value,body);assert.ok(h.page.querySelector('.mp-note-rich').querySelector('strong'));
  h.flushTimers(1500);await settle();assert.equal(h.saves.length,0,'the previous debounce cannot send a draft rejected by local staging');assert.equal(h.raw,saved);h.recordsReady();await settle();assert.ok(h.page.querySelector('.mp-note-rich').querySelector('strong'),'a same-owner refresh cannot replace the unsaved draft');assert.match(h.status,/保存できません/);
});

test('late native IME events on a retired owner host cannot enter a newly restored owner document',async()=>{
  const h=controller({raw:encode({notes:[note({body:'Aのみの本文'})]}),richEditor:true});await settle();const old=h.page.querySelector('.mp-note-rich');old.dispatch('compositionstart');
  h.auth({id:'owner-B'});h.frame.contentWindow.knLedgerSession={user:{id:'owner-B'}};h.frame.contentWindow.localStorage.getItem=()=> 'owner-B';h.bridge.load=async()=>({raw:encode({notes:[note({body:'Bのみの本文'})]}),assetsRaw:null});h.recordsReady();await settle();
  const current=h.page.querySelector('.mp-note-rich');assert.notEqual(current,old);assert.equal(current.textContent,'Bのみの本文');const count=h.stages.length;
  const staleText=old.children[0].children[0].children[0];staleText.nodeValue='遅れて来たAの秘密';old.dispatch('input',{inputType:'insertCompositionText',isComposing:true});old.dispatch('compositionend');old.dispatch('keydown',{key:'z',metaKey:true});
  assert.equal(current.textContent,'Bのみの本文');assert.equal(h.memo.value,'Bのみの本文');assert.equal(h.stages.length,count);assert.equal(old.textContent,'');
});
test('switching between notes uses fresh native hosts while retaining saved rich data and isolating undo',async()=>{
  const h=controller({raw:encode({notes:[note({body:'一番目'}),note({id:'second',body:'二番目'})]}),richEditor:true});await settle();const first=h.page.querySelector('.mp-note-rich');format(h,'太字').click();const pick=h.page.querySelectorAll('.mp-note-pick').find(n=>n.textContent.includes('二番目'));pick.click();const second=h.page.querySelector('.mp-note-rich');assert.notEqual(first,second);assert.equal(second.textContent,'二番目');assert.equal(format(h,'元に戻す').disabled,true);const saved=h.raw;first.dispatch('beforeinput',{inputType:'historyUndo'});first.dispatch('input',{inputType:'insertText'});assert.equal(h.raw,saved);assert.equal(second.textContent,'二番目');assert.equal(first.textContent,'');
});

test('a UTF-8-sized rich snapshot rejected by remote storage stays staged and never claims sync success',async()=>{
  const body='記'.repeat(400000),raw=encode({notes:[note({body})]});const h=controller({raw,richEditor:true});await settle();format(h,'太字').click();const staged=h.raw;
  assert.ok(staged.length<1000000);assert.ok(Buffer.byteLength(JSON.stringify({mypage:staged}),'utf8')>2000000);const saves=[];h.bridge.save=async(owner,value)=>{saves.push({owner,raw:value});return false;};h.flushTimers(1500);await settle();
  assert.equal(saves.length,1);assert.equal(saves[0].raw,staged);assert.equal(h.raw,staged);assert.equal(h.memo.value,body);assert.match(h.status,/同期できません/);assert.match(h.status,/書きかけを保持/);assert.ok(h.page.querySelector('.mp-note-rich').querySelector('strong'));h.recordsReady();await settle();assert.equal(h.raw,staged);assert.match(h.status,/同期できません/);
});

test('notification marker is additive and completing waits for durable cancellation',async()=>{
  let resolve,calls=0,context;
  const notifications={attachPlanner:value=>context=value,refreshTodos(){},cancelTodo:()=>{calls++;return new Promise(r=>resolve=r);}};
  const h=controller({raw:encode({todos:[reminder('scheduled',{notificationScheduled:true})]}),notifications});await settle();
  const check=taskRows(h)[0].querySelector('input');check.checked=true;check.dispatch('change');
  assert.equal(calls,1);assert.equal(JSON.parse(h.raw).todos[0].done,false);assert.equal(check.disabled,true);
  resolve(true);await settle();
  assert.equal(JSON.parse(h.raw).todos[0].done,true);assert.equal(JSON.parse(h.raw).todos[0].notificationScheduled,false);
  assert.ok(context);
});

test('notification cancellation failure preserves pending task and deletion',async()=>{
  const notifications={attachPlanner(){},refreshTodos(){},cancelTodo:async()=>{throw Error('fixture-private-error');}};
  const raw=encode({todos:[reminder('scheduled',{notificationScheduled:true})]});
  const h=controller({raw,notifications});await settle();
  const check=taskRows(h)[0].querySelector('input');check.checked=true;check.dispatch('change');await settle();
  assert.equal(h.raw,raw);assert.equal(check.checked,false);assert.match(h.status,/完了への変更は保留/);
  taskRows(h)[0].querySelectorAll('button').find(n=>n.textContent==='削除').click();await settle();
  assert.equal(h.raw,raw);assert.match(h.status,/削除せず残して/);assert.equal(h.status.includes('fixture-private-error'),false);
});

test('late notification cancellation cannot mutate a different owner after signout',async()=>{
  let resolve;
  const notifications={attachPlanner(){},refreshTodos(){},cancelTodo:()=>new Promise(r=>resolve=r)};
  const h=controller({raw:encode({todos:[reminder('scheduled',{notificationScheduled:true})]}),notifications});await settle();
  const check=taskRows(h)[0].querySelector('input');check.checked=true;check.dispatch('change');
  h.auth(null);resolve(true);await settle();
  assert.equal(h.stages.length,0);assert.equal(h.page.querySelectorAll('.mp-task').length,0);
});

test('a notification schedule callback only marks a live pending task of its current owner',async()=>{
  let context;const notifications={attachPlanner:value=>context=value,refreshTodos(){},cancelTodo:async()=>true};
  const h=controller({raw:encode({todos:[reminder('pending'),reminder('done',{done:true})]}),notifications});await settle();
  context.markScheduled('pending',true);
  assert.equal(JSON.parse(h.raw).todos[0].notificationScheduled,true);
  context.markScheduled('done',true);assert.equal(JSON.parse(h.raw).todos[1].notificationScheduled,undefined);
  h.auth(null);const count=h.stages.length;context.markScheduled('pending',false);assert.equal(h.stages.length,count);
});

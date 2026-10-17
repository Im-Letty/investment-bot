'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
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
function controller({raw=null,stageOK=true,autoSave=false}={}) {
  const documentEvents = {}, childEvents = {}, windowEvents = {}, saves = [], stages = [];
  const timers=new Map();let clock=0,timerId=0,stored = raw;
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
    constructor(tag='div') {this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attributes={};this.listeners={};this.classes=new Set();this.value='';this.disabled=false;this.hidden=false;this._text='';}
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
    dispatch(type) {for(const fn of this.listeners[type]||[])fn({target:this,preventDefault(){}});}
    click() {if(!this.disabled)this.dispatch('click');}
    focus() {}
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
    async load(){return {raw:stored,assetsRaw:'[{"amount":12.5,"cat":"現金"}]'};},
    stage(owner,value){stages.push({owner,raw:value});if(stageOK)stored=value;return stageOK;},
    save(owner,value){const operation={owner,raw:value};saves.push(operation);if(autoSave)return Promise.resolve(true);operation.promise=new Promise(resolve=>operation.resolve=resolve);return operation.promise;}
  };
  frame.contentWindow={kkMyPageStore:bridge,knLedgerSession:{user:{id:'owner-A'}},localStorage:{getItem:()=> 'owner-A'},addEventListener:(type,fn)=>childEvents[type]=fn};
  const w={
    document:{readyState:'complete',getElementById:k=>k==='myPageOv'?page:null,createElement:tag=>new Element(tag),addEventListener:(type,fn)=>documentEvents[type]=fn},
    knUser:{id:'owner-A'},localStorage:{getItem:()=>null},
    confirm:()=>true,prompt:()=>null,MutationObserver:class {observe(){}},
    addEventListener:(type,fn)=>windowEvents[type]=fn,setInterval(){},
    setTimeout(fn,ms=0){timers.set(++timerId,{fn,at:clock+ms});return timerId;},
    clearTimeout(id){timers.delete(id);},
  };
  const lookup=text=>page.querySelectorAll('button').find(n=>n.textContent===text);
  planner.mount(w);
  return {w,page,body,bridge,saves,stages,documentEvents,childEvents,lookup,flushTimers,
    get memo(){return page.querySelectorAll('textarea').find(n=>n.id==='mpMemo');},
    get status(){return page.querySelector('.mp-status').textContent;},
    get raw(){return stored;},
    type(element,value){element.value=value;element.dispatch('input');},
    auth(user){w.knUser=user;documentEvents.knAuthChange();}};
}
const settle = async()=>{for(let i=0;i<6;i++)await Promise.resolve();};

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
  assert.equal(h.lookup('目標を追加する').disabled,true,'overview actions must also respect the failed restore');
  h.lookup('目標を追加する').click();
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
  assert.equal(h.page.querySelector('.mp-tasks').children[0].querySelector('input').checked,true);
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

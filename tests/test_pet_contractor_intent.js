'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../static/pet-game-core.js');
const Intent = require('../static/pet-contractor-intent.js');

const MAX_REVISION=9000000000000,MAX_JSON_CHARS=1000000;
const copy = value => JSON.parse(JSON.stringify(value));
const layout = () => Core.defaultVillageLayout();
function snapshot(revision,currentLayout) {
  return {revision:arguments.length>0?revision:7,currentLayout:arguments.length>1?currentLayout:layout()};
}
function proposal(expectedRevision,requestedLayout) {
  return {version:1,expectedRevision:arguments.length>0?expectedRevision:7,requestedLayout:arguments.length>1?requestedLayout:layout()};
}
const json = value => JSON.stringify(value);
const inspect = (s=snapshot(),p=proposal()) => Intent.inspect(json(s),json(p));
function frozenTree(value) {
  if(value&&typeof value==='object') {
    assert.equal(Object.isFrozen(value),true,'every returned object and array is frozen');
    for(const child of Object.values(value)) frozenTree(child);
  }
}
function rejection(result,error) {
  assert.deepEqual(result,{ok:false,error});frozenTree(result);
}
function changedLayout(updates) {
  const result=layout();
  for(const item of result.items) if(updates[item.id]) Object.assign(item,updates[item.id]);
  return result;
}

test('the exported contract produces a deeply frozen unsubmitted no-op draft with no extra authority',()=>{
  assert.equal(Intent.version,1);assert.equal(typeof Intent.inspect,'function');
  const expected=layout(),result=inspect();
  assert.deepEqual(result,{ok:true,stage:'unsubmitted',draft:{version:1,expectedRevision:7,requestedLayout:expected},changes:[]});
  frozenTree(result);
  assert.throws(()=>{result.stage='accepted';},TypeError);
  assert.throws(()=>{result.draft.requestedLayout.items[0].x=99;},TypeError);
  assert.throws(()=>{result.changes.push({id:'fake'});},TypeError);
});

test('coordinate differences join by actual ID and follow requested order rather than current order or sorted IDs',()=>{
  const current=layout();current.items=[...current.items.slice(2),...current.items.slice(0,2)];
  const requested=changedLayout({home:{x:0,y:100},flowers:{x:100},tree:{y:0}});
  const order=['flowers','shop','home','cafe','tree','playground'];
  requested.items=order.map(id=>requested.items.find(item=>item.id===id));
  const result=inspect(snapshot(31,current),proposal(31,requested));
  assert.equal(result.ok,true);assert.equal(result.stage,'unsubmitted');
  assert.deepEqual(result.draft.requestedLayout,Core.getVillageLayout({villageLayout:requested}));
  assert.deepEqual(result.changes,[
    {id:'flowers',from:{x:48,y:83},to:{x:100,y:83}},
    {id:'home',from:{x:22,y:23},to:{x:0,y:100}},
    {id:'tree',from:{x:48,y:44},to:{x:48,y:0}}
  ]);
  frozenTree(result);
});

test('reordering otherwise identical items is a valid no-op, not a fabricated move',()=>{
  const requested=layout();requested.items.reverse();const result=inspect(snapshot(),proposal(7,requested));
  assert.equal(result.ok,true);assert.deepEqual(result.changes,[]);
  assert.deepEqual(result.draft.requestedLayout.items.map(item=>item.id),requested.items.map(item=>item.id));
});

test('schema-valid overlap stays only an unsubmitted data draft, without simulated placement or commissioning',()=>{
  const requested=layout();for(const row of requested.items){row.x=50;row.y=50;}
  const result=inspect(snapshot(),proposal(7,requested));
  assert.equal(result.ok,true);assert.equal(result.stage,'unsubmitted');assert.equal(result.changes.length,requested.items.length);
  assert.deepEqual(Object.keys(result).sort(),['changes','draft','ok','stage']);
  assert.deepEqual(Object.keys(result.draft).sort(),['expectedRevision','requestedLayout','version']);
  frozenTree(result);
});

test('independent calls return detached results and never mutate their source descriptions or Core defaults',()=>{
  const s=snapshot(),p=proposal(7,changedLayout({shop:{x:99}})),beforeS=copy(s),beforeP=copy(p),defaults=layout();
  const first=inspect(s,p),second=inspect(s,p);assert.deepEqual(first,second);
  assert.notEqual(first,second);assert.notEqual(first.draft,second.draft);
  assert.notEqual(first.draft.requestedLayout,second.draft.requestedLayout);
  assert.notEqual(first.draft.requestedLayout.items[0],second.draft.requestedLayout.items[0]);
  assert.notEqual(first.changes[0].from,second.changes[0].from);
  assert.deepEqual(s,beforeS);assert.deepEqual(p,beforeP);assert.deepEqual(layout(),defaults);
  s.currentLayout.items[0].x=88;p.requestedLayout.items[0].y=99;
  assert.equal(first.draft.requestedLayout.items[0].y,beforeP.requestedLayout.items[0].y);
  assert.deepEqual(first.changes[0].from,{x:22,y:65});
});

test('snapshot and proposal inputs must be primitive JSON strings with exact object schemas',()=>{
  const goodS=json(snapshot()),goodP=json(proposal());
  for(const raw of [undefined,null,true,1,{},[],new String(goodS),()=>goodS,Symbol('snapshot')]) {
    rejection(Intent.inspect(raw,goodP),'invalid_snapshot');
  }
  for(const raw of [undefined,null,false,1,{},[],new String(goodP),()=>goodP,Symbol('proposal')]) {
    rejection(Intent.inspect(goodS,raw),'invalid_proposal');
  }
  for(const raw of ['', '{','null','[]','1','true','"text"','{}','{"revision":7}',
    json({...snapshot(),extra:true}),json({revision:7,layout:layout()}),json({...snapshot(),__proto_marker__:true})]) {
    rejection(Intent.inspect(raw,goodP),'invalid_snapshot');
  }
  for(const raw of ['', '{','null','[]','1','false','"text"','{}',
    json({expectedRevision:7,requestedLayout:layout()}),json({version:1,requestedLayout:layout()}),json({version:1,expectedRevision:7}),
    json({...proposal(),extra:true}),json({...proposal(),stage:'accepted'}),json({...proposal(),jobId:'not-accepted'})]) {
    rejection(Intent.inspect(goodS,raw),'invalid_proposal');
  }
});

test('explicit missing or malformed layouts reject rather than using Core default layout fallback',()=>{
  assert.deepEqual(Core.getVillageLayout({}),layout(),'the underlying Core has a legacy default, making this guard meaningful');
  for(const value of [undefined,null,false,0,'',[],{}, {version:1,theme:'cafe'}]) {
    rejection(inspect(snapshot(7,value),proposal()),'invalid_snapshot');
    rejection(inspect(snapshot(),proposal(7,value)),'invalid_proposal');
  }
  rejection(Intent.inspect(json({revision:7}),json(proposal())),'invalid_snapshot');
  rejection(Intent.inspect(json(snapshot()),json({version:1,expectedRevision:7})),'invalid_proposal');
});

test('revisions accept the inclusive existing Core bounds and reject coercion, unsafe or oversized values',()=>{
  for(const revision of [0,1,MAX_REVISION]) {
    const result=inspect(snapshot(revision),proposal(revision));assert.equal(result.ok,true);assert.equal(result.draft.expectedRevision,revision);
  }
  for(const revision of [undefined,null,false,true,'7',-1,.5,MAX_REVISION+1,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1,NaN,Infinity,-Infinity]) {
    rejection(inspect(snapshot(revision),proposal()),'invalid_snapshot');
    rejection(inspect(snapshot(),proposal(revision)),'invalid_proposal');
  }
  for(const version of [undefined,null,false,true,0,2,'1',1.5,NaN,Infinity]) {
    rejection(inspect(snapshot(),{...proposal(),version}),'invalid_proposal');
  }
});

test('a valid but different supplied revision returns only stale_revision without a draft',()=>{
  for(const pair of [[0,1],[7,6],[7,8],[MAX_REVISION,0]]) {
    rejection(inspect(snapshot(pair[0]),proposal(pair[1])),'stale_revision');
  }
});

test('both JSON input lengths independently enforce the exact one-million UTF16-code-unit limit',()=>{
  const s=json(snapshot()),p=json(proposal());
  const sAtLimit=' '.repeat(MAX_JSON_CHARS-s.length)+s;
  const pAtLimit=p+' '.repeat(MAX_JSON_CHARS-p.length);
  assert.equal(sAtLimit.length,MAX_JSON_CHARS);assert.equal(pAtLimit.length,MAX_JSON_CHARS);
  assert.equal(Intent.inspect(sAtLimit,p).ok,true);assert.equal(Intent.inspect(s,pAtLimit).ok,true);
  assert.equal(Intent.inspect(sAtLimit,pAtLimit).ok,true);
  rejection(Intent.inspect(' '+sAtLimit,p),'invalid_snapshot');
  rejection(Intent.inspect(s,pAtLimit+' '),'invalid_proposal');
});

test('unsupported layout schemas and keys are rejected at both explicit layout boundaries',()=>{
  const variants=[];
  for(const version of [undefined,null,false,true,0,2,'1']) variants.push({...layout(),version});
  for(const theme of [undefined,null,false,'','beach','cafe ']) variants.push({...layout(),theme});
  variants.push({...layout(),extra:true},{...layout(),accepted:true});
  const missingItems=layout();delete missingItems.items;variants.push(missingItems);
  for(const value of [null,{},'',false]) variants.push({...layout(),items:value});
  for(const value of variants) {
    rejection(inspect(snapshot(7,value),proposal()),'invalid_snapshot');
    rejection(inspect(snapshot(),proposal(7,value)),'invalid_proposal');
  }
});

test('duplicate, unknown, missing and extra place identities cannot turn into a partial accepted draft',()=>{
  const variants=[];
  const duplicate=layout();duplicate.items[1]=copy(duplicate.items[0]);variants.push(duplicate);
  const unknown=layout();unknown.items[0].id='unregistered-contractor';variants.push(unknown);
  const proto=layout();proto.items[0].id='__proto__';variants.push(proto);
  const missing=layout();missing.items.pop();variants.push(missing);
  const extra=layout();extra.items.push({id:'extra',x:0,y:0});variants.push(extra);
  for(const id of [undefined,null,1,true,'','home ']) {
    const bad=layout();bad.items[0].id=id;variants.push(bad);
  }
  for(const value of variants) {
    rejection(inspect(snapshot(7,value),proposal()),'invalid_snapshot');
    rejection(inspect(snapshot(),proposal(7,value)),'invalid_proposal');
  }
});

test('place coordinates and item keys reuse the actual Core integer schema without coercion',()=>{
  for(const coordinate of [0,100]) {
    const valid=changedLayout({home:{x:coordinate,y:coordinate}});
    assert.equal(inspect(snapshot(7,valid),proposal(7,valid)).ok,true);
  }
  const variants=[];
  for(const coordinate of [undefined,null,false,true,'50',-1,.5,100.0001,101,NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER+1]) {
    for(const axis of ['x','y']) {const bad=layout();bad.items[0][axis]=coordinate;variants.push(bad);}
  }
  for(const item of [null,[],{}, {id:'home',x:22}, {id:'home',x:22,y:23,extra:true}, {id:'home',x:22,y:23,price:0}]) {
    const bad=layout();bad.items[0]=item;variants.push(bad);
  }
  for(const value of variants) {
    assert.throws(()=>Core.getVillageLayout({villageLayout:value}),{code:'corrupt_data'});
    rejection(inspect(snapshot(7,value),proposal()),'invalid_snapshot');
    rejection(inspect(snapshot(),proposal(7,value)),'invalid_proposal');
  }
});

test('malformed and nonfinite numeric JSON never escapes as an exception or a valid schema',()=>{
  const goodS=json(snapshot()),goodP=json(proposal());
  for(const raw of ['{"revision":NaN,"currentLayout":{}}','{"revision":Infinity,"currentLayout":{}}',
    goodS.replace('"revision":7','"revision":1e400'),goodS.replace('"x":22','"x":1e400')]) {
    rejection(Intent.inspect(raw,goodP),'invalid_snapshot');
  }
  for(const raw of ['{"version":1,"expectedRevision":NaN}','{"version":1,"expectedRevision":Infinity}',
    goodP.replace('"expectedRevision":7','"expectedRevision":1e400'),goodP.replace('"x":22','"x":1e400')]) {
    rejection(Intent.inspect(goodS,raw),'invalid_proposal');
  }
});

const moduleSource=()=>fs.readFileSync(require.resolve('../static/pet-contractor-intent.js'),'utf8');
test('the real browser UMD branch matches Node using only explicit Core layout validation',()=>{
  const calls=[],forbidden=[],context={PetGameCore:{getVillageLayout(input){
    assert.deepEqual(Object.keys(input),['villageLayout']);calls.push(copy(input));return Core.getVillageLayout(input);
  }}};
  for(const name of ['localStorage','sessionStorage','fetch','XMLHttpRequest','WebSocket','document','navigator','setTimeout','requestAnimationFrame']) {
    Object.defineProperty(context,name,{get(){forbidden.push(name);throw Error('forbidden ambient capability: '+name);}});
  }
  vm.runInNewContext(moduleSource(),context,{filename:'pet-contractor-intent.js'});
  const browser=context.PetContractorIntent;assert.equal(browser.version,1);
  const s=json(snapshot()),p=json(proposal(7,changedLayout({cafe:{y:0}})));
  const result=browser.inspect(s,p);assert.deepEqual(copy(result),Intent.inspect(s,p));frozenTree(result);
  assert.equal(calls.length,2);assert.deepEqual(calls[0],{villageLayout:layout()});
  assert.deepEqual(calls[1],{villageLayout:changedLayout({cafe:{y:0}})});
  const before=calls.length;assert.deepEqual(copy(browser.inspect(json({revision:7}),p)),{ok:false,error:'invalid_snapshot'});
  assert.equal(calls.length,before,'missing layout never invokes Core default getter');assert.deepEqual(forbidden,[]);
});

test('the browser factory fails closed if its required real Core layout capability is missing',()=>{
  for(const PetGameCore of [undefined,null,{}, {getVillageLayout:null}]) {
    const context={PetGameCore};
    assert.throws(()=>vm.runInNewContext(moduleSource(),context),/contractor_intent_dependency_unavailable/);
    assert.equal(Object.hasOwn(context,'PetContractorIntent'),false);
  }
});

async function syntheticCore() {
  const values=new Map(),writes=[],now=()=>Date.UTC(2026,10,1,5);
  const storage={getItem:key=>values.get(key)??null,async setItem(key,value){values.set(key,value);writes.push([key,value]);return true;}};
  const first=Core.create({storage,now,random:()=>.5});assert.equal((await first.ready).ok,true);
  assert.equal((await first.dispatch({type:'chooseEgg',eggOrigin:'mint'})).ok,true);
  const saved=JSON.parse(values.get(Core.KEY));saved.villageLayout=changedLayout({home:{x:29},tree:{y:40}});
  saved.futureCompatibilityField={version:4,values:[true,1,'preserved']};
  values.set(Core.KEY,json(saved));
  const app=Core.create({storage,now,random:()=>.5});assert.equal((await app.ready).ok,true);
  return {app,values,writes,raw:()=>values.get(Core.KEY)};
}

test('valid and rejected inspections preserve the actual synthetic Core state, backup and durable layout byte for byte',async()=>{
  const g=await syntheticCore(),before=g.app.getState(),raw=g.raw(),backup=g.app.exportBackup(),writes=g.writes.length;
  const current=Core.getVillageLayout(before),requested=copy(current);requested.items[1].x=0;
  const s=snapshot(before.revision,current),p=proposal(before.revision,requested);
  assert.equal(inspect(s,p).ok,true);assert.deepEqual(inspect(s,p),inspect(s,p),'repeated pure inspection creates no durable request identity');
  rejection(inspect(s,{...p,expectedRevision:before.revision+1}),'stale_revision');
  rejection(inspect({...s,currentLayout:null},p),'invalid_snapshot');
  rejection(inspect(s,{...p,requestedLayout:null}),'invalid_proposal');
  assert.equal(g.raw(),raw);assert.equal(g.app.exportBackup(),backup);assert.equal(g.writes.length,writes);
  assert.deepEqual(g.app.getState(),before);assert.deepEqual(g.app.getVillageLayout(),current);
  assert.deepEqual(g.app.getState().futureCompatibilityField,before.futureCompatibilityField);
});

test('a validated unsubmitted draft cannot re-enable the retired real Core saveVillageLayout action',async()=>{
  const g=await syntheticCore(),before=g.app.getState(),raw=g.raw(),backup=g.app.exportBackup(),writes=g.writes.length;
  const requested=changedLayout({home:{x:99}}),result=inspect(snapshot(before.revision,g.app.getVillageLayout()),proposal(before.revision,requested));
  assert.equal(result.ok,true);
  const denied=await g.app.dispatch({type:'saveVillageLayout',expectedRevision:before.revision,layout:copy(result.draft.requestedLayout)});
  assert.equal(denied.ok,false);assert.equal(denied.error.code,'village_construction_required');
  assert.equal(g.raw(),raw);assert.equal(g.app.exportBackup(),backup);assert.equal(g.writes.length,writes);
  assert.equal(g.app.getState().revision,before.revision);assert.deepEqual(g.app.getVillageLayout(),before.villageLayout);
  for(const key of ['pet','coins','inventory','wardrobe','decorations','care','market','achievements','villageLife','futureCompatibilityField']) {
    assert.deepEqual(g.app.getState()[key],before[key],key);
  }
});

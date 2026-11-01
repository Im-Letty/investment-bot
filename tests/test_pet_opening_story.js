'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../static/pet-game-core.js');

const CANDIDATE = 'quiet-arrival-v1';
const copy = value => JSON.parse(JSON.stringify(value));
const view = readThrough => ({version:1,candidateId:CANDIDATE,readThrough,pageCount:3,complete:readThrough===3});
const record = readThrough => ({version:1,candidateId:CANDIDATE,readThrough});
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve=yes; });
  return {promise,resolve};
}

// Every adapter and every record in this file is synthetic and private to a test.
async function fixture(seed) {
  let now=Date.UTC(2026,10,1,4),mode='ok',pending=null,attempts=0;
  const data=new Map(seed||[]),writes=[];
  const storage={
    getItem:key=>data.get(key)??null,
    async setItem(key,value) {
      attempts++;
      if(pending) await pending;
      if(mode==='throw') throw Error('synthetic storage failure');
      if(mode==='false') return false;
      if(mode==='object') return {ok:false};
      data.set(key,value);writes.push([key,value]);
    }
  };
  const options={storage,now:()=>now,random:()=>.5};
  const app=Core.create(options),ready=await app.ready;
  return {app,ready,data,writes,storage,options,
    raw:()=>data.get(Core.KEY),state:()=>JSON.parse(data.get(Core.KEY)),
    confirmed:()=>JSON.parse(app.exportBackup()).state,
    get attempts(){return attempts;},
    advance:ms=>now+=ms,clock:value=>now=value,
    mode:value=>mode=value,pending:value=>pending=value,
    read(page,extra={},expectedRevision=app.getState().revision) {
      return app.dispatch({type:'readOpeningStory',expectedRevision,candidateId:CANDIDATE,page,...extra});
    }
  };
}
function onlyOpeningStory(before,after) {
  const a=copy(before),b=copy(after);
  delete a.openingStory;delete b.openingStory;
  b.revision=a.revision;b.updatedAt=a.updatedAt;
  assert.deepEqual(b,a,'all preexisting saved fields are preserved');
}
async function assertRejectedWithoutWrite(g,action,code) {
  const raw=g.raw(),before=g.confirmed(),attempts=g.attempts;
  const result=await g.app.dispatch(action);
  assert.equal(result.ok,false);
  assert.equal(result.error.code,code);
  assert.equal(g.raw(),raw,'durable bytes did not change');
  assert.equal(g.attempts,attempts,'rejected actions never attempt a save');
  assert.deepEqual(g.confirmed(),before,'confirmed state did not change');
}
const action = (revision,page,extra={}) => ({type:'readOpeningStory',expectedRevision:revision,candidateId:CANDIDATE,page,...extra});

test('old saves and both getters project the candidate without initializing or writing a field',async()=>{
  const g=await fixture();assert.equal(g.ready.ok,true);
  assert.equal(Object.hasOwn(g.state(),'openingStory'),false);
  const raw=g.raw(),attempts=g.attempts,writes=g.writes.length;
  const second=Core.create(g.options);assert.equal((await second.ready).ok,true);
  for(const app of [g.app,second]) {
    const projected=app.getOpeningStoryView();assert.deepEqual(projected,view(0));
    projected.readThrough=3;projected.complete=true;projected.candidateId='changed';
    assert.deepEqual(app.getOpeningStoryView(),view(0));
  }
  const detached=g.app.getState();assert.deepEqual(Core.getOpeningStoryView(detached),view(0));
  assert.equal(Object.hasOwn(detached,'openingStory'),false);
  assert.equal(g.raw(),raw);assert.equal(g.attempts,attempts);assert.equal(g.writes.length,writes);
  assert.equal(Object.hasOwn(g.state(),'openingStory'),false);
});

test('all four valid saved read states hydrate unchanged and getters are detached',async()=>{
  const initial=await fixture(),seed=initial.state();
  for(let page=0;page<=3;page++) {
    const saved={...copy(seed),openingStory:record(page)},raw=JSON.stringify(saved);
    const g=await fixture([[Core.KEY,raw]]);assert.equal(g.ready.ok,true);
    assert.equal(g.attempts,0);assert.equal(g.raw(),raw);
    assert.deepEqual(g.app.getOpeningStoryView(),view(page));
    const detached=g.app.getState(),projection=Core.getOpeningStoryView(detached);
    projection.readThrough=99;projection.complete=!projection.complete;
    detached.openingStory.readThrough=0;
    assert.deepEqual(g.app.getOpeningStoryView(),view(page));assert.equal(g.raw(),raw);
  }
});

test('an unrelated legacy action preserves unknown fields without materializing story progress',async()=>{
  const initial=await fixture(),seed=initial.state();seed.futureField={version:7,values:[true,1,'kept']};
  const g=await fixture([[Core.KEY,JSON.stringify(seed)]]);assert.equal(g.ready.ok,true);
  const backup=JSON.parse(g.app.exportBackup());assert.equal(Object.hasOwn(backup.state,'openingStory'),false);
  assert.equal((await g.app.dispatch({type:'chooseEgg',eggOrigin:'mint'})).ok,true);
  assert.equal(Object.hasOwn(g.state(),'openingStory'),false);assert.deepEqual(g.state().futureField,seed.futureField);
  const raw=g.raw(),attempts=g.attempts;assert.deepEqual(g.app.getOpeningStoryView(),view(0));
  assert.equal(g.raw(),raw);assert.equal(g.attempts,attempts);
});

test('three manual acknowledgments work before egg choice and mutate only read state and transaction metadata',async()=>{
  const g=await fixture(),before=g.state(),start=g.writes.length;
  assert.equal(Core.needsEggChoice(before),true);
  for(let page=1;page<=3;page++) {
    const prior=g.state();g.advance(1);
    const result=await g.read(page);assert.equal(result.ok,true);
    assert.equal(Object.hasOwn(result,'reward'),false);
    assert.deepEqual(g.state().openingStory,record(page));
    assert.deepEqual(g.app.getOpeningStoryView(),view(page));
    assert.equal(g.state().revision,prior.revision+1);
    assert.equal(g.state().updatedAt,prior.updatedAt+1);
    onlyOpeningStory(prior,g.state());
    assert.equal(Core.needsEggChoice(g.app.getState()),true);
  }
  onlyOpeningStory(before,g.state());assert.equal(g.writes.length,start+3);
  for(const flag of ['story_design_adopted','story_runtime_complete','normal_game_integration_verified']) {
    assert.equal(Object.hasOwn(g.state(),flag),false,'reading adds no adoption or integration authority');
  }
});

test('reading never triggers generic achievements, rewards, growth, ownership or economy at reward thresholds',async()=>{
  const base=await fixture(),seed=base.state();
  seed.pet.exp=110;seed.pet.eggOrigin='lilac';seed.coins=100;seed.achievements=[];
  seed.decorations.owned=Object.fromEntries(['house','tree','flower','fountain','sunflower','mushroom','lantern'].map(id=>[id,{}]));
  const g=await fixture([[Core.KEY,JSON.stringify(seed)]]);assert.equal(g.ready.ok,true);
  const before=g.state();
  for(let page=1;page<=3;page++) {
    const result=await g.read(page);assert.equal(result.ok,true);assert.equal(Object.hasOwn(result,'reward'),false);
    onlyOpeningStory(before,g.state());assert.deepEqual(g.state().achievements,[]);
  }
  assert.equal(g.state().pet.exp,110);assert.equal(g.state().coins,100);
  assert.deepEqual(g.state().decorations.owned,before.decorations.owned);
});

test('missing, extra and wrong-typed opening-story action fields reject without a save attempt',async()=>{
  const g=await fixture(),revision=g.state().revision,valid=action(revision,1);
  const invalid=[];
  for(const key of ['expectedRevision','candidateId','page']) {
    const missing={...valid};delete missing[key];invalid.push(missing);
  }
  for(const page of [undefined,null,true,false,'1',0,-1,1.5,4,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) invalid.push({...valid,page});
  for(const expectedRevision of [undefined,null,true,false,'0',-1,.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) invalid.push({...valid,expectedRevision});
  for(const candidateId of [undefined,null,true,0,'','quiet-arrival-v2','quiet-arrival-v1 ']) invalid.push({...valid,candidateId});
  invalid.push({...valid,extra:true},{...valid,version:1},{...valid,readThrough:1});
  const hidden={...valid};Object.defineProperty(hidden,'extra',{value:true});invalid.push(hidden);
  const symbol={...valid};symbol[Symbol('extra')]=true;invalid.push(symbol);
  for(const item of invalid) await assertRejectedWithoutWrite(g,item,'invalid_opening_story');
});

test('only the immediate next page can be acknowledged; repeats, backwards pages and skips never write',async()=>{
  const g=await fixture();
  await assertRejectedWithoutWrite(g,action(g.state().revision,2),'invalid_opening_story');
  await assertRejectedWithoutWrite(g,action(g.state().revision,3),'invalid_opening_story');
  assert.equal((await g.read(1)).ok,true);
  for(const page of [1,3]) await assertRejectedWithoutWrite(g,action(g.state().revision,page),'invalid_opening_story');
  assert.equal((await g.read(2)).ok,true);
  for(const page of [1,2]) await assertRejectedWithoutWrite(g,action(g.state().revision,page),'invalid_opening_story');
  assert.equal((await g.read(3)).ok,true);
  for(const page of [1,2,3]) await assertRejectedWithoutWrite(g,action(g.state().revision,page),'invalid_opening_story');
  assert.deepEqual(g.app.getOpeningStoryView(),view(3));
});

test('valid stale revisions and backwards clocks preserve the entire confirmed record',async()=>{
  const g=await fixture();
  await assertRejectedWithoutWrite(g,action(g.state().revision+1,1),'stale_state');
  const revision=g.state().revision;assert.equal((await g.read(1)).ok,true);
  await assertRejectedWithoutWrite(g,action(revision,2),'stale_state');
  g.clock(g.state().updatedAt-1);
  await assertRejectedWithoutWrite(g,action(g.state().revision,2),'clock_moved_back');
});

test('invalid clock values cannot turn an acknowledgment into a persisted read',async()=>{
  const g=await fixture(),raw=g.raw(),before=g.confirmed(),attempts=g.attempts;
  for(const time of [NaN,Infinity,-1]) {
    g.clock(time);const result=await g.read(1);
    assert.equal(result.ok,false);assert.equal(result.error.code,'invalid_clock');
    assert.equal(g.raw(),raw);assert.equal(g.attempts,attempts);
    for(const key of Object.keys(before)) assert.deepEqual(g.app.getState()[key],before[key],key);
    assert.deepEqual(g.app.getOpeningStoryView(),view(0));
  }
});

test('confirmed getters, durable bytes and subscribers wait for asynchronous persistence acknowledgment',async()=>{
  const g=await fixture(),hold=deferred(),raw=g.raw(),before=g.confirmed(),notifications=[];
  const unsubscribe=g.app.subscribe(state=>notifications.push(state));g.pending(hold.promise);
  const writing=g.read(1);let settled=false;writing.then(()=>{settled=true;});
  await new Promise(setImmediate);
  assert.equal(settled,false);assert.equal(g.raw(),raw);assert.deepEqual(g.confirmed(),before);
  assert.deepEqual(g.app.getOpeningStoryView(),view(0));assert.deepEqual(notifications,[]);
  hold.resolve();assert.equal((await writing).ok,true);
  assert.deepEqual(g.app.getOpeningStoryView(),view(1));assert.equal(notifications.length,1);
  assert.deepEqual(notifications[0].openingStory,record(1));unsubscribe();
});

for(const mode of ['false','throw','object']) test('a '+mode+' persistence failure rolls back exact bytes and confirmed state and permits one retry',async()=>{
  const g=await fixture();assert.equal((await g.read(1)).ok,true);
  const raw=g.raw(),before=g.confirmed(),writes=g.writes.length;g.mode(mode);
  const result=await g.read(2);assert.equal(result.ok,false);assert.equal(result.error.code,'storage_failed');
  assert.equal(g.raw(),raw);assert.deepEqual(g.confirmed(),before);assert.equal(g.writes.length,writes);
  assert.deepEqual(g.app.getOpeningStoryView(),view(1));
  g.mode('ok');assert.equal((await g.read(2)).ok,true);
  assert.equal(g.writes.length,writes+1);assert.equal(g.state().revision,before.revision+1);
  assert.deepEqual(g.app.getOpeningStoryView(),view(2));
});

test('a delayed storage rejection never exposes the candidate as a confirmed read',async()=>{
  const g=await fixture(),hold=deferred(),raw=g.raw(),before=g.confirmed();
  g.pending(hold.promise);const writing=g.read(1);await new Promise(setImmediate);
  assert.deepEqual(g.app.getOpeningStoryView(),view(0));g.mode('throw');hold.resolve();
  assert.equal((await writing).error.code,'storage_failed');assert.equal(g.raw(),raw);
  assert.deepEqual(g.confirmed(),before);assert.deepEqual(g.app.getOpeningStoryView(),view(0));
});

test('two concurrent same-revision acknowledgments publish exactly one winning transition',async()=>{
  const g=await fixture(),revision=g.state().revision,writes=g.writes.length,attempts=g.attempts;
  const results=await Promise.all([g.read(1,{},revision),g.read(1,{},revision)]);
  assert.equal(results[0].ok,true);assert.equal(results[1].error.code,'stale_state');
  assert.equal(g.writes.length,writes+1);assert.equal(g.attempts,attempts+1);
  assert.equal(g.state().revision,revision+1);assert.deepEqual(g.app.getOpeningStoryView(),view(1));
});

test('a stale second Core store cannot overwrite the winning durable record through CAS',async()=>{
  const g=await fixture();
  // A separate adapter object exercises durable-record CAS, not the shared-adapter queue.
  const secondStorage={getItem:key=>g.storage.getItem(key),setItem:(key,value)=>g.storage.setItem(key,value)};
  const second=Core.create({...g.options,storage:secondStorage});assert.equal((await second.ready).ok,true);
  const staleRevision=second.getState().revision;assert.equal((await g.read(1)).ok,true);
  const raw=g.raw(),attempts=g.attempts,writes=g.writes.length;
  const result=await second.dispatch(action(staleRevision,1));
  assert.equal(result.error.code,'stale_state');assert.equal(g.raw(),raw);
  assert.equal(g.attempts,attempts);assert.equal(g.writes.length,writes);
  assert.deepEqual(second.getOpeningStoryView(),view(0));assert.deepEqual(g.app.getOpeningStoryView(),view(1));
  const reopened=Core.create(g.options);assert.equal((await reopened.ready).ok,true);
  assert.deepEqual(reopened.getOpeningStoryView(),view(1));assert.equal(g.raw(),raw);
});

test('reopening and backup round-trip keep read state and every other saved field intact',async()=>{
  const g=await fixture();await g.read(1);g.advance(50);await g.read(2);
  const saved=g.state(),raw=g.raw(),writes=g.writes.length,backup=g.app.exportBackup();
  const reopened=Core.create(g.options);assert.equal((await reopened.ready).ok,true);
  assert.equal(g.raw(),raw);assert.equal(g.writes.length,writes);
  assert.deepEqual(reopened.getOpeningStoryView(),view(2));
  const target=await fixture();assert.equal((await target.app.importBackup(backup)).ok,true);
  onlyOpeningStory(saved,target.state());assert.deepEqual(target.state().openingStory,saved.openingStory);
  assert.deepEqual(target.app.getOpeningStoryView(),view(2));
  assert.equal((await target.read(3)).ok,true);assert.deepEqual(target.app.getOpeningStoryView(),view(3));
});

test('an explicitly imported old backup remains valid without manufacturing an openingStory field',async()=>{
  const g=await fixture(),oldState=g.state(),backup=g.app.exportBackup();
  assert.equal(Object.hasOwn(JSON.parse(backup).state,'openingStory'),false);
  await g.read(1);g.advance(10);assert.equal((await g.app.importBackup(backup)).ok,true);
  assert.equal(Object.hasOwn(g.state(),'openingStory'),false);
  assert.deepEqual(g.app.getOpeningStoryView(),view(0));onlyOpeningStory(oldState,g.state());
  assert.equal(g.state().revision,oldState.revision+2);
});

const corruptRecords=[null,[],{},
  {version:2,candidateId:CANDIDATE,readThrough:1},
  {version:true,candidateId:CANDIDATE,readThrough:1},
  {version:1,candidateId:'other-candidate',readThrough:1},
  {version:1,candidateId:CANDIDATE},
  {version:1,readThrough:1},
  {...record(1),extra:true},
  ...[-1,4,.5,true,false,'1',null].map(readThrough=>({...record(1),readThrough}))];

test('corrupt optional saved read state blocks loading without repairing or replacing durable bytes',async()=>{
  const initial=await fixture(),seed=initial.state();
  for(const openingStory of corruptRecords) {
    const raw=JSON.stringify({...copy(seed),openingStory}),g=await fixture([[Core.KEY,raw]]);
    assert.equal(g.ready.ok,false,JSON.stringify(openingStory));
    assert.equal(g.ready.error.code,'corrupt_data');assert.equal(g.app.getState().readOnly,true);
    assert.equal(g.raw(),raw);assert.equal(g.attempts,0);
    assert.equal((await g.read(1)).error.code,'read_only');assert.equal(g.raw(),raw);assert.equal(g.attempts,0);
  }
});

test('corrupt imported read-state extensions fail before a save and do not erase a valid current record',async()=>{
  const g=await fixture();await g.read(1);const raw=g.raw(),before=g.confirmed(),attempts=g.attempts;
  const backup=JSON.parse(g.app.exportBackup());
  for(const openingStory of corruptRecords) {
    const bad={...copy(backup),state:{...copy(backup.state),openingStory}};
    const result=await g.app.importBackup(JSON.stringify(bad));assert.equal(result.ok,false);
    assert.equal(result.error.code,'corrupt_data');assert.equal(g.raw(),raw);
    assert.equal(g.attempts,attempts);assert.deepEqual(g.confirmed(),before);
    assert.deepEqual(g.app.getOpeningStoryView(),view(1));
  }
  assert.equal((await g.read(2)).ok,true,'rejected backups do not permanently block valid actions');
});

function encryptedGate(seed={},deny=false) {
  const values=new Map(Object.entries(seed));
  const storage={getItem:key=>values.get(key)??null,
    setItem(key,value){if(deny)throw Error('synthetic quota');values.set(key,String(value));},
    removeItem:key=>values.delete(key)};
  const context={localStorage:storage,crypto:require('node:crypto').webcrypto,TextEncoder,TextDecoder,
    btoa:value=>Buffer.from(value,'binary').toString('base64'),
    atob:value=>Buffer.from(value,'base64').toString('binary')};context.window=context;
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
  const start=html.indexOf('/* knGate: encrypted localStorage gate');assert.ok(start>0);
  vm.runInNewContext(html.slice(start,html.indexOf('</script>',start)),context);
  return {context,values,storage:{getItem:key=>context.__knReadGameStorage(key),
    setItem:(key,value)=>context.__knPersistLocalSetting(key,value)}};
}

test('read state uses the real encrypted awaited boundary without plaintext, extra keys or denied-write adoption',async()=>{
  const first=encryptedGate({pg_exp:'110',private_account:'synthetic-unchanged'});await first.context.__knGateReady;
  const now=()=>Date.UTC(2026,10,1,4),app=Core.create({storage:first.storage,now});assert.equal((await app.ready).ok,true);
  const before=copy(app.getState()),keys=[...first.values.keys()].sort();
  assert.equal((await app.dispatch(action(before.revision,1))).ok,true);
  const ciphertext=first.values.get('knenc:'+Core.KEY);assert.match(ciphertext,/^knv1:/);
  assert.equal(first.values.has(Core.KEY),false);assert.equal(ciphertext.includes('openingStory'),false);
  assert.deepEqual([...first.values.keys()].sort(),keys);
  const restored=encryptedGate(Object.fromEntries(first.values));await restored.context.__knGateReady;
  const reopened=Core.create({storage:restored.storage,now});assert.equal((await reopened.ready).ok,true);
  assert.deepEqual(reopened.getOpeningStoryView(),view(1));assert.equal(restored.values.get('knenc:'+Core.KEY),ciphertext);
  for(const key of ['pet','coins','inventory','wardrobe','decorations','care','market','achievements','villageLife']) {
    assert.deepEqual(reopened.getState()[key],before[key],key);
  }
  const denied=encryptedGate(Object.fromEntries(first.values),true);await denied.context.__knGateReady;
  const blocked=Core.create({storage:denied.storage,now});assert.equal((await blocked.ready).ok,true);
  assert.equal((await blocked.dispatch(action(blocked.getState().revision,2))).error.code,'storage_failed');
  assert.equal(denied.values.get('knenc:'+Core.KEY),ciphertext);assert.deepEqual(blocked.getOpeningStoryView(),view(1));
  assert.equal(denied.values.get('private_account'),'synthetic-unchanged');
});

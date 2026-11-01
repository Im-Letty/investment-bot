'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const Core=require('../static/pet-game-core.js');
const Intent=require('../static/pet-contractor-intent.js');
const Journal=require('../static/pet-contractor-draft-journal.js');
const clone=value=>JSON.parse(JSON.stringify(value));
function input(id='fixture-request-1',revision=7){
  const current=Core.defaultVillageLayout(),requested=clone(current);
  requested.items[0].x=requested.items[0].x===100?99:requested.items[0].x+1;
  return {requestId:id,snapshotJson:JSON.stringify({revision,currentLayout:current}),
    proposalJson:JSON.stringify({version:1,expectedRevision:revision,requestedLayout:requested})};
}
function memory(initial=null){
  const map=new Map(initial===null?[]:[['slot',initial]]),events=[];
  return {map,events,client(){return {
    async read(){events.push('read');return map.has('slot')?map.get('slot'):null;},
    async compareAndSwap(expected,next){
      events.push('cas');
      const current=map.has('slot')?map.get('slot'):null;
      if(current!==expected)return 'conflict';
      map.set('slot',next);events.push('commit');return 'committed';
    }
  };}};
}
const count=(store,event)=>store.events.filter(x=>x===event).length;
function frozen(value){
  if(value&&typeof value==='object'){
    assert.equal(Object.isFrozen(value),true);
    Object.values(value).forEach(frozen);
  }
}
function error(value,code){assert.deepEqual(value,{ok:false,error:code});frozen(value);}

test('creation requires an explicit read and atomic-CAS repository and performs no default reads or writes',()=>{
  let calls=0;
  for(const options of [undefined,null,{}, {repository:null}, {repository:{read(){calls++;},setItem(){calls++;}}},
    {repository:{compareAndSwap(){calls++;}}}, {repository:{read(){},compareAndSwap(){}},extra:true}]){
    assert.throws(()=>Journal.create(options),/journal_repository_unavailable/);
  }
  const store=memory(),api=Journal.create({repository:store.client()});
  assert.equal(Journal.version,1);assert.deepEqual(Object.keys(api),['readDraft','recordDraft']);frozen(api);
  assert.equal(calls,0);assert.deepEqual(store.events,[]);
});

test('an empty read is detached evidence of an empty dedicated slot, never an initialization write',async()=>{
  const store=memory(),api=Journal.create({repository:store.client()});
  const result=await api.readDraft();
  assert.deepEqual(result,{ok:true,status:'empty',record:null});frozen(result);
  assert.deepEqual(store.events,['read']);assert.equal(store.map.size,0);
});

test('first acknowledged CAS records the full validated base and proposal as an unsubmitted one-slot receipt',async()=>{
  const store=memory(),api=Journal.create({repository:store.client()}),request=input();
  const result=await api.recordDraft(request);
  assert.equal(result.ok,true);assert.equal(result.status,'recorded');frozen(result);
  assert.deepEqual(result.record.receipt,{version:1,requestId:request.requestId,stage:'unsubmitted',journalRevision:1});
  assert.deepEqual(result.record.payload.snapshot,JSON.parse(request.snapshotJson));
  assert.deepEqual(result.record.payload.proposal,Intent.inspect(request.snapshotJson,request.proposalJson).draft);
  assert.deepEqual(JSON.parse(store.map.get('slot')),result.record);
  assert.deepEqual(store.events,['read','cas','commit']);
  assert.deepEqual(Object.keys(result.record).sort(),['payload','receipt','requestId','version']);
  for(const forbidden of ['price','duration','days','quote','NPC','unlock','reward','accepted'])assert.equal(forbidden in result.record,false);
});

test('same caller ID and canonical full payload replays the identical receipt after a new client opens, without CAS',async()=>{
  const store=memory(),request=input(),first=await Journal.create({repository:store.client()}).recordDraft(request);
  const snapshot=JSON.parse(request.snapshotJson),proposal=JSON.parse(request.proposalJson);
  const reordered={requestId:request.requestId,
    snapshotJson:JSON.stringify({currentLayout:{items:snapshot.currentLayout.items.map(x=>({y:x.y,id:x.id,x:x.x})),theme:snapshot.currentLayout.theme,version:1},revision:snapshot.revision},null,3),
    proposalJson:JSON.stringify({requestedLayout:{items:proposal.requestedLayout.items.map(x=>({x:x.x,y:x.y,id:x.id})),version:1,theme:proposal.requestedLayout.theme},expectedRevision:proposal.expectedRevision,version:1},null,2)};
  const raw=store.map.get('slot'),api=Journal.create({repository:store.client()}),again=await api.recordDraft(reordered);
  assert.equal(again.status,'replayed');assert.deepEqual(again.record,first.record);frozen(again);
  assert.equal(count(store,'cas'),1);assert.equal(count(store,'commit'),1);assert.equal(store.map.get('slot'),raw);
  assert.equal((await api.readDraft()).status,'recorded_unsubmitted');
});

test('same ID with changed requested coordinates conflicts without replacing or deleting the occupied slot',async()=>{
  const store=memory(),api=Journal.create({repository:store.client()}),request=input();
  await api.recordDraft(request);const raw=store.map.get('slot'),changed=clone(request),proposal=JSON.parse(changed.proposalJson);
  proposal.requestedLayout.items[1].y=proposal.requestedLayout.items[1].y===100?99:100;
  changed.proposalJson=JSON.stringify(proposal);error(await api.recordDraft(changed),'journal_conflict');
  assert.equal(store.map.get('slot'),raw);assert.equal(count(store,'cas'),1);assert.equal(count(store,'commit'),1);
});

test('same ID and proposed layout cannot reuse a receipt with a different supplied base even at the same revision',async()=>{
  const store=memory(),api=Journal.create({repository:store.client()}),request=input();await api.recordDraft(request);
  const changed=clone(request),snapshot=JSON.parse(changed.snapshotJson);
  snapshot.currentLayout.items[1].x=snapshot.currentLayout.items[1].x===100?99:100;
  changed.snapshotJson=JSON.stringify(snapshot);const raw=store.map.get('slot');
  error(await api.recordDraft(changed),'journal_conflict');assert.equal(store.map.get('slot'),raw);assert.equal(count(store,'cas'),1);
});

test('a different caller ID cannot silently replace the one occupied slot',async()=>{
  const store=memory(),api=Journal.create({repository:store.client()});await api.recordDraft(input());const raw=store.map.get('slot');
  error(await api.recordDraft(input('fixture-request-2')),'journal_conflict');
  assert.equal(store.map.get('slot'),raw);assert.equal(count(store,'cas'),1);assert.equal(typeof api.clear,'undefined');assert.equal(typeof api.remove,'undefined');
});

test('strict request shape and stable caller-ID bounds reject invalid data before any repository call',async()=>{
  const invalid=[undefined,null,[],{},input(''),input('x'.repeat(129)),input('id\n'),input(' id'),input('é'),input(1),
    {...input(),price:0}, {...input(),requestId:true}];
  for(const request of invalid){
    const store=memory(),result=await Journal.create({repository:store.client()}).recordDraft(request);
    error(result,'invalid_request');assert.deepEqual(store.events,[]);
  }
  const store=memory();assert.equal((await Journal.create({repository:store.client()}).recordDraft(input('a'.repeat(128)))).ok,true);
  // Accessors are part of the same strict-input boundary: a field must not
  // change between validation and persistence, and every committed record
  // must remain readable by the actual journal decoder.
  const capturedStore=memory(),capturedClient=Journal.create({repository:capturedStore.client()}),original=input();
  const reads={requestId:0,snapshotJson:0,proposalJson:0},unstable={};
  Object.defineProperties(unstable,{
    requestId:{enumerable:true,get(){reads.requestId++;return reads.requestId===1?original.requestId:'changed-id';}},
    snapshotJson:{enumerable:true,get(){reads.snapshotJson++;const snapshot=JSON.parse(original.snapshotJson);snapshot.revision=reads.snapshotJson===1?7:8;return JSON.stringify(snapshot);}},
    proposalJson:{enumerable:true,get(){reads.proposalJson++;return reads.proposalJson===1?original.proposalJson:'{';}}
  });
  const captured=await capturedClient.recordDraft(unstable);assert.equal(captured.status,'recorded');
  assert.deepEqual(reads,{requestId:1,snapshotJson:1,proposalJson:1});
  assert.equal(captured.record.requestId,original.requestId);
  assert.equal(captured.record.payload.snapshot.revision,captured.record.payload.proposal.expectedRevision);
  assert.equal((await capturedClient.readDraft()).status,'recorded_unsubmitted');assert.equal(count(capturedStore,'commit'),1);
  const throwingStore=memory(),throwing={requestId:'throwing-input',proposalJson:original.proposalJson};
  Object.defineProperty(throwing,'snapshotJson',{enumerable:true,get(){throw Error('unstable_caller');}});
  error(await Journal.create({repository:throwingStore.client()}).recordDraft(throwing),'invalid_request');assert.deepEqual(throwingStore.events,[]);
});

test('the existing actual Core/inspector schema rejects absent layouts, duplicate IDs, unsupported fields and stale revisions before storage',async()=>{
  const cases=[];
  const missing=input();missing.snapshotJson=JSON.stringify({revision:7});cases.push([missing,'invalid_snapshot']);
  const missingRequest=input();missingRequest.proposalJson=JSON.stringify({version:1,expectedRevision:7});cases.push([missingRequest,'invalid_proposal']);
  for(const change of [p=>p.requestedLayout.items[1].id=p.requestedLayout.items[0].id,
    p=>p.requestedLayout.items[0].x=101,p=>p.requestedLayout.items[0].x=-1,
    p=>p.requestedLayout.items[0].id='unsupported-place',p=>p.requestedLayout.extra=true,
    p=>p.price=0,p=>p.expectedRevision=true]){
    const request=input(),p=JSON.parse(request.proposalJson);change(p);request.proposalJson=JSON.stringify(p);cases.push([request,'invalid_proposal']);
  }
  const stale=input(),p=JSON.parse(stale.proposalJson);p.expectedRevision--;stale.proposalJson=JSON.stringify(p);cases.push([stale,'stale_revision']);
  for(const [request,code]of cases){const store=memory();error(await Journal.create({repository:store.client()}).recordDraft(request),code);assert.deepEqual(store.events,[]);}
});

test('existing JSON size and numeric boundaries are enforced without silently creating default layouts',async()=>{
  const over=input();over.snapshotJson=' '.repeat(1000001);const store=memory();
  error(await Journal.create({repository:store.client()}).recordDraft(over),'invalid_snapshot');assert.deepEqual(store.events,[]);
  const valid=input('max-revision',9000000000000);valid.snapshotJson+=' '.repeat(1000000-valid.snapshotJson.length);
  assert.equal((await Journal.create({repository:memory().client()}).recordDraft(valid)).ok,true);
  const invalid=input('over-revision',9000000000001);error(await Journal.create({repository:memory().client()}).recordDraft(invalid),'invalid_snapshot');
  const nonfinite=input();assert.match(nonfinite.proposalJson,/"x":\d+/);
  nonfinite.proposalJson=nonfinite.proposalJson.replace(/"x":\d+/,'"x":NaN');
  error(await Journal.create({repository:memory().client()}).recordDraft(nonfinite),'invalid_proposal');
});

test('malformed or over-authoritative stored records fail closed on both read and record and are never reset',async()=>{
  const seed=memory(),saved=await Journal.create({repository:seed.client()}).recordDraft(input());
  const corrupt=['{','null','{}',' '.repeat(1000001),JSON.stringify({...saved.record,version:true}),
    JSON.stringify({...saved.record,accepted:true}),JSON.stringify({...saved.record,receipt:{...saved.record.receipt,stage:'accepted'}}),
    JSON.stringify({...saved.record,receipt:{...saved.record.receipt,requestId:'different'}}),
    JSON.stringify({...saved.record,payload:{...saved.record.payload,proposal:{...saved.record.payload.proposal,price:0}}})];
  for(const raw of corrupt){const store=memory(raw),api=Journal.create({repository:store.client()});
    error(await api.readDraft(),'corrupt_journal');error(await api.recordDraft(input()),'corrupt_journal');
    assert.equal(count(store,'cas'),0);assert.equal(store.map.get('slot'),raw);
  }
});

test('two independent clients with different IDs share one genuinely atomic backing store and exactly one can commit',async()=>{
  const store=memory(),a=Journal.create({repository:store.client()}),b=Journal.create({repository:store.client()});
  const results=await Promise.all([a.recordDraft(input('client-a')),b.recordDraft(input('client-b'))]);
  assert.equal(results.filter(x=>x.ok).length,1);assert.equal(results.filter(x=>x.error==='journal_conflict').length,1);
  assert.equal(count(store,'cas'),2);assert.equal(count(store,'commit'),1);
  const record=JSON.parse(store.map.get('slot'));assert.equal(record.requestId,results.find(x=>x.ok).record.requestId);
});

test('a losing simultaneous same-ID call does not retry CAS; its later explicit retry finds the original receipt',async()=>{
  const store=memory(),a=Journal.create({repository:store.client()}),b=Journal.create({repository:store.client()}),request=input();
  const first=await Promise.all([a.recordDraft(request),b.recordDraft(request)]);
  assert.equal(first.filter(x=>x.ok).length,1);assert.equal(first.filter(x=>x.error==='journal_conflict').length,1);
  const before=count(store,'cas'),retry=await b.recordDraft(request);
  assert.equal(retry.status,'replayed');assert.deepEqual(retry.record,first.find(x=>x.ok).record);
  assert.equal(count(store,'cas'),before);assert.equal(count(store,'commit'),1);
});

test('a delayed persistence acknowledgement cannot publish a recorded result before it resolves',async()=>{
  const store=memory(),base=store.client();let release,entered;
  const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
  const api=Journal.create({repository:{read:base.read,async compareAndSwap(expected,next){entered();await gate;return base.compareAndSwap(expected,next);}}});
  let settled=false;const pending=api.recordDraft(input()).then(value=>{settled=true;return value;});
  await started;await Promise.resolve();assert.equal(settled,false);assert.equal(store.map.size,0);
  release();const result=await pending;assert.equal(result.status,'recorded');assert.equal(count(store,'commit'),1);
});

test('an exception after the actual commit reports unknown outcome; manual read and exact retry reconcile with no second write',async()=>{
  const store=memory(),base=store.client();
  const api=Journal.create({repository:{read:base.read,async compareAndSwap(expected,next){await base.compareAndSwap(expected,next);throw Error('synthetic_ack_lost');}}});
  const request=input();error(await api.recordDraft(request),'write_outcome_unknown');assert.equal(count(store,'commit'),1);
  const raw=store.map.get('slot'),reopened=Journal.create({repository:store.client()}),read=await reopened.readDraft();
  assert.equal(read.status,'recorded_unsubmitted');assert.equal(read.record.receipt.stage,'unsubmitted');
  const retry=await reopened.recordDraft(request);assert.equal(retry.status,'replayed');assert.deepEqual(retry.record,read.record);
  assert.equal(count(store,'cas'),1);assert.equal(store.map.get('slot'),raw);
});

test('an exception before commit still reports unknown, never an invented zero-write guarantee, and a later manual retry reads first',async()=>{
  const store=memory(),base=store.client();let fail=true;
  const api=Journal.create({repository:{read:base.read,async compareAndSwap(expected,next){if(fail){store.events.push('attempt_before_throw');throw Error('synthetic_before_commit');}return base.compareAndSwap(expected,next);}}});
  error(await api.recordDraft(input()),'write_outcome_unknown');assert.equal(store.map.size,0);
  assert.equal((await api.readDraft()).status,'empty');fail=false;
  const result=await api.recordDraft(input());assert.equal(result.status,'recorded');
  assert.deepEqual(store.events,['read','attempt_before_throw','read','read','cas','commit']);
});

test('unrecognized acknowledgement values are unknown, not truthy success or automatic repeated CAS',async()=>{
  for(const ack of [undefined,null,true,{ok:true},'ok']){
    const store=memory(),base=store.client(),api=Journal.create({repository:{read:base.read,async compareAndSwap(expected,next){await base.compareAndSwap(expected,next);return ack;}}});
    error(await api.recordDraft(input()),'write_outcome_unknown');assert.equal(count(store,'cas'),1);assert.equal(count(store,'commit'),1);
    assert.equal((await api.recordDraft(input())).status,'replayed');assert.equal(count(store,'cas'),1);
  }
});

test('read failure does not become empty storage or permit CAS, and corrupt non-string storage also fails closed',async()=>{
  let cas=0;
  const api=Journal.create({repository:{async read(){throw Error('synthetic_unavailable');},async compareAndSwap(){cas++;return 'committed';}}});
  error(await api.readDraft(),'repository_read_failed');error(await api.recordDraft(input()),'repository_read_failed');assert.equal(cas,0);
  const malformed=Journal.create({repository:{async read(){return {};},async compareAndSwap(){cas++;return 'committed';}}});
  error(await malformed.readDraft(),'corrupt_journal');error(await malformed.recordDraft(input()),'corrupt_journal');assert.equal(cas,0);
});

test('returned records and receipts are deeply frozen detached snapshots across successive reads and caller mutations',async()=>{
  const store=memory(),api=Journal.create({repository:store.client()}),request=input(),first=await api.recordDraft(request);
  const raw=store.map.get('slot');request.proposalJson='{';const second=await api.readDraft();frozen(first);frozen(second);
  assert.notEqual(first.record,second.record);assert.notEqual(first.record.payload,second.record.payload);assert.deepEqual(first.record,second.record);
  assert.throws(()=>{second.record.payload.proposal.requestedLayout.items[0].x=0;},TypeError);
  assert.throws(()=>{second.record.receipt.stage='accepted';},TypeError);assert.equal(store.map.get('slot'),raw);
});

test('array request order is part of exact payload identity while reordering object keys is not',async()=>{
  const store=memory(),api=Journal.create({repository:store.client()}),request=input();await api.recordDraft(request);
  const p=JSON.parse(request.proposalJson);p.requestedLayout.items.reverse();request.proposalJson=JSON.stringify(p);
  error(await api.recordDraft(request),'journal_conflict');assert.equal(count(store,'cas'),1);
});

test('browser UMD uses the same actual inspector and injected repository without ambient storage, network, clocks or Core creation',async()=>{
  let forbidden=0;const sandbox={PetGameCore:Core,PetContractorIntent:Intent};
  for(const key of ['localStorage','sessionStorage','fetch','XMLHttpRequest','Date','crypto'])Object.defineProperty(sandbox,key,{get(){forbidden++;throw Error('forbidden_ambient_'+key);}});
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/pet-contractor-draft-journal.js'),'utf8'),sandbox);
  const store=memory(),api=sandbox.PetContractorDraftJournal.create({repository:store.client()}),result=await api.recordDraft(input());
  assert.deepEqual(JSON.parse(JSON.stringify(result)),await Journal.create({repository:memory().client()}).recordDraft(input()));
  frozen(result);assert.equal(forbidden,0);assert.equal(count(store,'commit'),1);
});

test('journal valid, invalid, conflict and unknown-ACK calls preserve actual synthetic Core state, layout, backup and save bytes',async()=>{
  const map=new Map(),gameStorage={getItem(key){return map.has(key)?map.get(key):null;},setItem(key,value){map.set(key,value);return true;}};
  const game=Core.create({storage:gameStorage,legacy:gameStorage,now:()=>Date.UTC(2026,10,1,7),random:()=>0.25});assert.equal((await game.ready).ok,true);
  assert.equal((await game.dispatch({type:'chooseEgg',eggOrigin:'lilac'})).ok,true);
  const beforeRaw=map.get(Core.KEY),beforeState=game.getState(),beforeLayout=game.getVillageLayout(),beforeBackup=game.exportBackup();
  const store=memory(),api=Journal.create({repository:store.client()});await api.recordDraft(input());await api.recordDraft(input());
  error(await api.recordDraft({...input(),requestId:'other'}),'journal_conflict');error(await api.recordDraft({...input(),proposalJson:'{'}),'invalid_proposal');
  const unknown=Journal.create({repository:{async read(){return null;},async compareAndSwap(){throw Error('fixture_unknown');}}});error(await unknown.recordDraft(input()),'write_outcome_unknown');
  assert.equal(map.get(Core.KEY),beforeRaw);assert.deepEqual(game.getState(),beforeState);assert.deepEqual(game.getVillageLayout(),beforeLayout);assert.equal(game.exportBackup(),beforeBackup);
  const retired=await game.dispatch({type:'saveVillageLayout',expectedRevision:beforeState.revision,layout:Core.defaultVillageLayout()});
  assert.equal(retired.ok,false);assert.equal(retired.error.code,'village_construction_required');
  assert.equal(map.get(Core.KEY),beforeRaw);assert.deepEqual(game.getVillageLayout(),beforeLayout);assert.equal(game.exportBackup(),beforeBackup);
});

function proofContext(journal=Journal){
  const elements={};
  for(const id of ['record','replay','conflict','reopen','compete','unknown','reconcile','status','report']){
    elements[id]={disabled:true,textContent:'',dataset:{observations:'0'},listeners:{},addEventListener(name,fn){this.listeners[name]=fn;}};
  }
  const sandbox={window:{PetGameCore:Core,PetContractorDraftJournal:journal},document:{getElementById(id){return elements[id];}}};
  for(const key of ['localStorage','sessionStorage','fetch','XMLHttpRequest'])Object.defineProperty(sandbox,key,{get(){throw Error('forbidden_proof_ambient_'+key);}});
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/pet-contractor-draft-journal-proof-20261101/proof.js'),'utf8'),sandbox);
  return {elements,sandbox,async click(id){assert.equal(elements[id].disabled,false,'button '+id+' must be enabled');await elements[id].listeners.click();},report(){return JSON.parse(JSON.stringify(sandbox.window.__contractorDraftJournalProof.getReport()));}};
}

test('the actual proof handlers exercise record/replay/conflict/reopen/independent race/unknown ACK/manual reconciliation, using fresh memory after reinitialization',async()=>{
  const proof=proofContext();assert.equal(proof.elements.record.disabled,false);assert.equal(proof.elements.replay.disabled,true);
  for(const id of ['record','replay','conflict','reopen','compete','unknown','reconcile'])await proof.click(id);
  const report=proof.report();assert.equal(report.observations.length,7);assert.equal(report.observations.every(x=>x.verified===true),true);
  assert.equal(proof.elements.record.disabled,true);assert.equal(proof.elements.unknown.disabled,true);
  const replay=report.observations.find(x=>x.caseId==='replay').result;assert.equal(replay.counts.CAS,replay.before.CAS);
  const unknown=report.observations.find(x=>x.caseId==='unknown_ack').result;
  assert.equal(unknown.reply.error,'write_outcome_unknown');assert.equal(unknown.fixtureCounts.commits,1);
  const reconciled=report.observations.find(x=>x.caseId==='manual_unknown_reconciliation').result;
  assert.equal(reconciled.retry.status,'replayed');assert.equal(reconciled.counts.CAS,reconciled.before.CAS);
  const freshDocument=proofContext();await freshDocument.click('reopen');
  assert.equal(freshDocument.report().observations[0].result.reply.status,'empty');
  assert.equal(freshDocument.report().observations[0].result.counts.commits,0);
});

test('actual proof initialization and async handler failures stay unverified and restore controls without a false success',async()=>{
  const absent=proofContext({version:1,create(){throw Error('fixture_missing_capability');}});
  assert.equal(absent.elements.record.disabled,true);assert.match(absent.elements.status.textContent,/未確認/);
  assert.equal(absent.elements.report.dataset.observations,'0');
  const throwing=proofContext({version:1,create(){return {async readDraft(){throw Error('fixture_unavailable');},async recordDraft(){throw Error('fixture_unknown');}};}});
  await throwing.click('record');assert.equal(throwing.elements.record.disabled,false);assert.equal(throwing.elements.replay.disabled,true);
  assert.match(throwing.elements.status.textContent,/未確認/);const observations=throwing.report().observations;
  assert.equal(observations.length,1);assert.equal(observations[0].verified,false);
  assert.deepEqual(observations[0].result,{error:'proof_observation_failed'});
  const noCommit=proofContext({version:1,create(){return {async readDraft(){return {ok:true,status:'empty',record:null};},async recordDraft(){return {ok:false,error:'write_outcome_unknown'};}};}});
  await noCommit.click('unknown');const unproven=noCommit.report().observations[0];
  assert.equal(unproven.result.reply.error,'write_outcome_unknown');
  assert.deepEqual(unproven.result.fixtureCounts,{reads:0,CAS:0,commits:0});
  assert.equal(unproven.verified,false,'an error label alone cannot prove the post-commit-loss fixture');
});

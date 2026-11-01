'use strict';
// New consumer criteria: explicit supplied context, full base identity, one external
// read, detached fail-closed responses, no CAS, manual synthetic proof handlers.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Core=require('../static/pet-game-core.js');
const Journal=require('../static/pet-contractor-draft-journal.js');
const Review=require('../static/pet-contractor-draft-review.js');
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(revision=7){
  const base=Core.defaultVillageLayout(),requested=clone(base);
  requested.items[0].x=requested.items[0].x===100?99:requested.items[0].x+1;
  return {version:1,requestId:'review-fixture',payload:{snapshot:{revision,currentLayout:base},
    proposal:{version:1,expectedRevision:revision,requestedLayout:requested}},
    receipt:{version:1,requestId:'review-fixture',stage:'unsubmitted',journalRevision:1}};
}
function request(record=fixture()){return {snapshotJson:JSON.stringify(record.payload.snapshot)};}
function harness(raw){
  if(arguments.length===0)raw=JSON.stringify(fixture());
  const map=new Map(raw===null?[]:[['slot',raw]]),counts={reads:0,CAS:0};
  const repository={async read(){counts.reads++;return map.has('slot')?map.get('slot'):null;},
    async compareAndSwap(){counts.CAS++;throw Error('forbidden_review_CAS');}};
  const journal=Journal.create({repository});return {map,counts,journal,api:Review.create({journal})};
}
function frozen(value){if(value&&typeof value==='object'){assert.equal(Object.isFrozen(value),true);Object.values(value).forEach(frozen);}}
function error(value,code,journal=1,revalidation=0){assert.deepEqual(clone(value),{ok:false,error:code,reads:{journal,revalidation}});frozen(value);}
function reply(record=fixture()){return {ok:true,status:'recorded_unsubmitted',record};}
function injected(value){let reads=0;return {api:Review.create({journal:{readDraft(){reads++;return value;}}}),count:()=>reads};}

test('frozen API requires an explicit journal and exposes only the read-only review method',()=>{
  assert.equal(Review.version,1);frozen(Review);
  for(const options of [undefined,null,{},[],{journal:null},{journal:{}},{journal:{readDraft:true}},{journal:{readDraft(){}},extra:true}])
    assert.throws(()=>Review.create(options),/^Error: draft_review_journal_unavailable$/);
  const h=harness();assert.deepEqual(Object.keys(h.api),['review']);frozen(h.api);assert.deepEqual(h.counts,{reads:0,CAS:0});
});

test('option and readDraft getters are captured once at create, retain their receiver, and are not reread',async()=>{
  let optionGets=0,methodGets=0,calls=0;
  const journal={marker:true,get readDraft(){methodGets++;return function(){assert.equal(this,journal);calls++;return reply();};}};
  const api=Review.create({get journal(){optionGets++;return optionGets===1?journal:null;}});
  await api.review(request());await api.review(request());assert.deepEqual([optionGets,methodGets,calls],[1,1,2]);
  assert.throws(()=>Review.create({get journal(){throw Error('private_option');}}),/^Error: draft_review_journal_unavailable$/);
  assert.throws(()=>Review.create({journal:{get readDraft(){throw Error('private_method');}}}),/^Error: draft_review_journal_unavailable$/);
});

test('actual unchanged journal record read matches the explicitly supplied base and remains unsubmitted',async()=>{
  const h=harness(),answer=await h.api.review(request());
  assert.equal(answer.ok,true);assert.equal(answer.status,'matches_provided_context');assert.equal(answer.stage,'unsubmitted');
  assert.deepEqual(answer.record,fixture());assert.deepEqual(answer.providedContext,fixture().payload.snapshot);
  assert.deepEqual(answer.reads,{journal:1,revalidation:1});assert.deepEqual(h.counts,{reads:1,CAS:0});frozen(answer);
  for(const key of ['accepted','quote','price','days','NPC','unlock','reward','construction','currentGameFresh'])assert.equal(key in answer,false);
});

test('invalid request shape and a throwing snapshot accessor reject before any injected read',async()=>{
  const bad=[undefined,null,[],{}, {snapshotJson:request().snapshotJson,extra:true}, {[Symbol('extra')]:true,...request()}];
  const throwing={get snapshotJson(){throw Error('private_snapshot');}};bad.push(throwing);
  for(const input of bad){const h=harness();error(await h.api.review(input),'invalid_request',0);assert.deepEqual(h.counts,{reads:0,CAS:0});}
});

test('invalid or absent explicit snapshot layouts, revisions and JSON bounds reject before reading',async()=>{
  const valid=fixture().payload.snapshot,cases=[undefined,null,1,'{','null','{}',' '.repeat(1000001),JSON.stringify({revision:7}),
    JSON.stringify({...valid,extra:true}),JSON.stringify({...valid,revision:-1}),JSON.stringify({...valid,revision:true}),
    JSON.stringify({...valid,revision:9000000000001}),JSON.stringify({...valid,revision:0.5})];
  for(const mutate of [s=>s.currentLayout=null,s=>s.currentLayout.theme='other',s=>s.currentLayout.items[0].x=101,
    s=>s.currentLayout.items[0].x=-1,s=>s.currentLayout.items[0].id='unknown',s=>s.currentLayout.items[1].id=s.currentLayout.items[0].id,
    s=>s.currentLayout.extra=true,s=>s.currentLayout.items.reverse().pop()]){const value=clone(valid);mutate(value);cases.push(JSON.stringify(value));}
  for(const snapshotJson of cases){const h=harness();error(await h.api.review({snapshotJson}),'invalid_snapshot',0);assert.equal(h.counts.reads,0);}
});

test('valid numeric and serialized bounds include zero and the existing maximum',async()=>{
  for(const revision of [0,9000000000000]){
    const record=fixture(revision),h=harness(JSON.stringify(record)),input=request(record);
    input.snapshotJson+=' '.repeat(1000000-input.snapshotJson.length);
    assert.equal((await h.api.review(input)).status,'matches_provided_context');assert.equal(h.counts.reads,1);
  }
});

test('snapshot getter is captured once before journal invocation and remains stable across its await',async()=>{
  let gets=0,release,entered;const base=request().snapshotJson;
  const wait=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
  const input={get snapshotJson(){gets++;return gets===1?base:'{';}};
  const api=Review.create({journal:{async readDraft(){assert.equal(gets,1);entered();await wait;return reply();}}});
  const pending=api.review(input);await started;
  Object.defineProperty(input,'snapshotJson',{value:JSON.stringify({...fixture().payload.snapshot,revision:8})});
  release();const answer=await pending;assert.equal(answer.status,'matches_provided_context');assert.equal(gets,1);
  assert.equal(answer.providedContext.revision,7);frozen(answer.providedContext);
});

test('canonical object-key order and formatting changes preserve full base identity',async()=>{
  const snapshot=fixture().payload.snapshot;
  const reordered={currentLayout:{items:snapshot.currentLayout.items.map(row=>({y:row.y,id:row.id,x:row.x})),theme:'cafe',version:1},revision:7};
  const h=harness();assert.equal((await h.api.review({snapshotJson:JSON.stringify(reordered,null,3)})).status,'matches_provided_context');
});

test('same revision with a different base coordinate is detected even when supplied layout equals the requested proposal',async()=>{
  const record=fixture(),h=harness(JSON.stringify(record)),provided={revision:7,currentLayout:clone(record.payload.proposal.requestedLayout)};
  assert.equal((await h.api.review({snapshotJson:JSON.stringify(provided)})).status,'base_layout_changed');
  assert.deepEqual(h.counts,{reads:1,CAS:0});
});

test('array order is part of complete layout identity and is not normalized into a match',async()=>{
  const provided=clone(fixture().payload.snapshot);provided.currentLayout.items.reverse();const h=harness();
  assert.equal((await h.api.review({snapshotJson:JSON.stringify(provided)})).status,'base_layout_changed');
});

test('different supplied revisions report stale_revision and take precedence over simultaneous layout differences',async()=>{
  for(const revision of [6,8]){
    const provided=clone(fixture().payload.snapshot);provided.revision=revision;provided.currentLayout.items[1].x=100;
    const h=harness(),answer=await h.api.review({snapshotJson:JSON.stringify(provided)});
    assert.equal(answer.status,'stale_revision');assert.equal(answer.record.payload.snapshot.revision,7);assert.equal(answer.providedContext.revision,revision);
  }
});

test('empty is distinct, exact, read-only, and skips isolated record revalidation',async()=>{
  const h=harness(null),answer=await h.api.review(request());assert.equal(answer.status,'empty');assert.equal(answer.record,null);
  assert.deepEqual(answer.reads,{journal:1,revalidation:0});assert.deepEqual(h.counts,{reads:1,CAS:0});assert.equal(h.map.size,0);frozen(answer);
});

test('synchronous and asynchronous injected read failures redact private errors and never claim empty',async()=>{
  for(const readDraft of [()=>{throw Error('private_sync_read');},async()=>{throw Error('private_async_read');}]){
    const answer=await Review.create({journal:{readDraft}}).review(request());error(answer,'repository_read_failed');assert.doesNotMatch(JSON.stringify(answer),/private/);
  }
});

test('only the two exact old-journal read error replies are preserved',async()=>{
  for(const code of ['repository_read_failed','corrupt_journal']){const value=injected({ok:false,error:code});error(await value.api.review(request()),code);assert.equal(value.count(),1);}
  for(const value of [{ok:false,error:'write_outcome_unknown'},{ok:false,error:'private_error'}, {ok:false,error:'corrupt_journal',raw:'private'}])
    error(await injected(value).api.review(request()),'corrupt_journal');
});

test('malformed or over-authoritative journal response shapes fail closed before record revalidation',async()=>{
  const cases=[undefined,null,true,[],{}, {ok:1,status:'empty',record:null},{ok:true,status:'empty',record:{}},
    {ok:true,status:'recorded',record:fixture()},{ok:true,status:'replayed',record:fixture()},
    {ok:true,status:'recorded_unsubmitted',record:null},{...reply(),accepted:true},{ok:true,status:'empty',record:null,extra:undefined}];
  for(const value of cases){const h=injected(value);error(await h.api.review(request()),'corrupt_journal');assert.equal(h.count(),1);}
});

test('journal reply accessors are rejected without invocation, including nested record accessors',async()=>{
  let gets=0;const top={ok:true,status:'recorded_unsubmitted',get record(){gets++;return fixture();}};
  const nested=reply();Object.defineProperty(nested.record.receipt,'stage',{enumerable:true,get(){gets++;return 'unsubmitted';}});
  for(const value of [top,nested])error(await injected(value).api.review(request()),'corrupt_journal');assert.equal(gets,0);
});

test('non-JSON values, symbols, sparse arrays, cycles and hidden properties cannot be silently coerced into a valid response',async()=>{
  const sparse=reply();delete sparse.record.payload.snapshot.currentLayout.items[1];
  const symbol=reply();symbol.record[Symbol('authority')]=true;
  const hidden=reply();Object.defineProperty(hidden.record,'hidden',{value:1});
  const cycle=reply();cycle.record.payload.loop=cycle;
  const cases=[sparse,symbol,hidden,cycle];
  for(const bad of [NaN,Infinity,undefined,()=>{},1n]){const value=reply();value.record.payload.snapshot.currentLayout.items[0].x=bad;cases.push(value);}
  for(const value of cases)error(await injected(value).api.review(request()),'corrupt_journal');
});

test('response toJSON hooks do not execute and cannot hide extra authority',async()=>{
  let calls=0;const value=reply();value.record.toJSON=function(){calls++;return fixture();};
  error(await injected(value).api.review(request()),'corrupt_journal');assert.equal(calls,0);
});

test('corrupt stored records are revalidated by the actual unchanged journal decoder',async()=>{
  const cases=[];
  for(const mutate of [r=>r.version=2,r=>r.requestId='',r=>r.receipt.stage='accepted',r=>r.receipt.requestId='other',
    r=>r.receipt.journalRevision=2,r=>r.payload.snapshot.revision=8,r=>r.payload.proposal.price=0,
    r=>r.payload.proposal.requestedLayout.items[0].x=101,r=>r.accepted=true]){const record=fixture();mutate(record);cases.push(record);}
  for(const record of cases)error(await injected(reply(record)).api.review(request()),'corrupt_journal',1,1);
});

test('actual raw corruption and repository read failure remain separate from an empty Map slot',async()=>{
  for(const raw of ['{','null','{}',42,undefined]){const h=harness(raw);error(await h.api.review(request()),'corrupt_journal');assert.equal(h.counts.CAS,0);}
  const journal=Journal.create({repository:{async read(){throw Error('private_raw_failure');},async compareAndSwap(){throw Error('forbidden');}}});
  error(await Review.create({journal}).review(request()),'repository_read_failed');
});

test('mutable injected responses are copied before isolated validation awaits and outputs stay detached and deeply frozen',async()=>{
  const value=reply(),api=injected(value).api;
  const pending=api.review(request());
  // The first continuation captures the response; the next mutates the original
  // while the unchanged journal validator is awaiting its isolated repository read.
  await Promise.resolve();value.record.payload.snapshot.revision=8;value.record.receipt.stage='accepted';
  const answer=await pending;assert.equal(answer.status,'matches_provided_context');assert.equal(answer.record.payload.snapshot.revision,7);
  assert.equal(answer.record.receipt.stage,'unsubmitted');frozen(answer);
  assert.throws(()=>{answer.record.payload.proposal.requestedLayout.items[0].x=0;},TypeError);
});

test('successive reviews perform a new external read and return independent detached record trees',async()=>{
  const h=harness(),first=await h.api.review(request()),second=await h.api.review(request());
  assert.notEqual(first.record,second.record);assert.notEqual(first.providedContext,second.providedContext);assert.deepEqual(first.record,second.record);
  assert.deepEqual(h.counts,{reads:2,CAS:0});
});

test('browser UMD counts one isolated validation read per nonempty review and never invokes CAS or ambient capabilities',async()=>{
  let external=0,validation=0,CAS=0,ambient=0;
  const sandbox={PetGameCore:Core,PetContractorDraftJournal:{create({repository}){return Journal.create({repository:{
    async read(){validation++;return repository.read();},async compareAndSwap(){CAS++;return repository.compareAndSwap();}}});}}};
  for(const key of ['localStorage','sessionStorage','indexedDB','fetch','XMLHttpRequest','Date','crypto'])
    Object.defineProperty(sandbox,key,{get(){ambient++;throw Error('forbidden_ambient');}});
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/pet-contractor-draft-review.js'),'utf8'),sandbox);
  const api=sandbox.PetContractorDraftReview.create({journal:{readDraft(){external++;return reply();}}});
  const answer=await api.review(request());assert.equal(answer.status,'matches_provided_context');assert.deepEqual([external,validation,CAS,ambient],[1,1,0,0]);
  assert.deepEqual(clone(answer.reads),{journal:1,revalidation:1});frozen(answer);
});

test('review preserves actual synthetic Core state, layout, backup and serialized game bytes',async()=>{
  const map=new Map(),storage={getItem(key){return map.has(key)?map.get(key):null;},setItem(key,value){map.set(key,value);return true;}};
  const game=Core.create({storage,legacy:storage,now:()=>Date.UTC(2026,10,1,7),random:()=>0.25});assert.equal((await game.ready).ok,true);
  assert.equal((await game.dispatch({type:'chooseEgg',eggOrigin:'lilac'})).ok,true);
  const before={state:game.getState(),layout:game.getVillageLayout(),backup:game.exportBackup(),raw:map.get(Core.KEY)};
  const h=harness();await h.api.review(request());const changed=clone(fixture().payload.snapshot);changed.revision=8;await h.api.review({snapshotJson:JSON.stringify(changed)});
  await h.api.review({snapshotJson:'{'});await harness(null).api.review(request());await harness('{').api.review(request());
  assert.deepEqual(game.getState(),before.state);assert.deepEqual(game.getVillageLayout(),before.layout);assert.equal(game.exportBackup(),before.backup);assert.equal(map.get(Core.KEY),before.raw);
  assert.equal(h.counts.CAS,0);
});

function proofContext(review=Review){
  const elements={};for(const id of ['match','stale','layoutchanged','empty','corrupt','readfail','malformed','status','report'])
    elements[id]={disabled:true,textContent:'',dataset:{},listeners:{},addEventListener(event,fn){this.listeners[event]=fn;}};
  const sandbox={window:{PetGameCore:Core,PetContractorDraftJournal:Journal,PetContractorDraftReview:review},document:{getElementById(id){return elements[id];}}};
  for(const key of ['localStorage','sessionStorage','indexedDB','fetch','XMLHttpRequest'])Object.defineProperty(sandbox,key,{get(){throw Error('forbidden_proof_ambient');}});
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/pet-contractor-draft-review-proof-20261101/proof.js'),'utf8'),sandbox);
  return {elements,async click(id){assert.equal(elements[id].disabled,false);await elements[id].listeners.click();},
    report(){return clone(sandbox.window.__contractorDraftReviewProof.getReport());}};
}

test('actual manual proof handlers observe seven cases with measured reads, zero CAS and actual unbounded observation count',async()=>{
  const p=proofContext();assert.equal(p.report().actualObservationCount,0);
  const ids=['match','stale','layoutchanged','empty','corrupt','readfail','malformed'];for(const id of ids)await p.click(id);
  let report=p.report();assert.equal(report.actualObservationCount,7);assert.equal(report.formalTestCreditFromThisUI,0);assert.equal(report.CAS_calls,0);
  assert.deepEqual(report.observations.map(row=>row.caseId),ids);assert.ok(report.observations.every(row=>row.verified));
  assert.ok(report.observations.every(row=>row.result.external_injected_reads===1));
  assert.deepEqual(report.observations.map(row=>row.result.isolated_validation_reads),[1,1,1,0,0,0,0]);
  assert.equal(report.ownerGameSaveAccessed,false);assert.equal(report.currentGameFreshnessGuaranteed,false);
  for(let i=0;i<18;i++)await p.click('match');report=p.report();assert.equal(report.actualObservationCount,25);assert.equal(report.observations.length,25);
  assert.equal(proofContext().report().actualObservationCount,0);
});

test('proof initialization and handler failures remain unverified, redact raw errors and restore usable controls',async()=>{
  const missing=proofContext({});assert.equal(missing.elements.match.disabled,true);assert.match(missing.elements.status.textContent,/未確認/);
  const p=proofContext({create(){throw Error('private_proof_failure');}});await p.click('match');
  assert.equal(p.report().actualObservationCount,1);assert.equal(p.report().observations[0].verified,false);assert.equal(p.elements.match.disabled,false);
  assert.doesNotMatch(JSON.stringify(p.report()),/private_proof_failure/);
});

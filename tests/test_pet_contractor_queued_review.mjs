import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const Core=require('../static/pet-game-core.js');
const Review=require('../static/pet-contractor-draft-review.js');
const Outbox=require('../static/pet-contractor-request-outbox.js');
const QueuedReview=require('../static/pet-contractor-queued-review.js');
const source=()=>fs.readFileSync(new URL('../static/pet-contractor-queued-review.js',import.meta.url),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
function canonical(v){return Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);}
function fixture(revision=7,id='queued-review-fixture'){
  const currentLayout=Core.defaultVillageLayout(),requested=clone(currentLayout);requested.items[0].x=requested.items[0].x===100?99:requested.items[0].x+1;
  const record={version:1,requestId:id,payload:{snapshot:{revision,currentLayout},proposal:{version:1,expectedRevision:revision,requestedLayout:requested}},receipt:{version:1,requestId:id,stage:'unsubmitted',journalRevision:1}};
  return {version:1,record,receipt:{version:1,requestId:id,stage:'queued_for_review',scope:'explicit_local_preparation',outboxRevision:1,baseRevision:revision}};
}
const input=(q=fixture())=>({snapshotJson:JSON.stringify(q.record.payload.snapshot)});
const readCounts=(n=1)=>({draftReviewCalls:0,journalReads:0,reviewRevalidationReads:0,outboxReads:1,outboxRevalidationReads:n,outboxCAS:0});
const stored=(q=fixture())=>({ok:true,status:'stored_local',queued:q,scope:'explicit_local_preparation',freshness:'not_checked',counts:readCounts()});
function frozen(value){if(value&&typeof value==='object'){assert.equal(Object.isFrozen(value),true);Object.values(value).forEach(frozen);}}
function counts(reply,values){assert.deepEqual(Object.values(reply.counts),values);}
function failure(reply,error){assert.equal(reply.ok,false);assert.equal(reply.error,error);assert.equal(reply.scope,'explicit_local_preparation');frozen(reply);}
function injected(value){let calls=0;return {api:QueuedReview.create({outbox:{readQueued(){calls++;return typeof value==='function'?value():value;}}}),calls:()=>calls};}
function harness(initial=canonical(fixture())){
  let raw=initial;const seen={external:0,sourceReads:0,currentJournal:0,CAS:0};
  const original=Outbox.create({journal:{readDraft(){seen.currentJournal++;throw Error('current_journal_forbidden');}},repository:{async read(){seen.sourceReads++;return raw;},async compareAndSwap(){seen.CAS++;throw Error('CAS_forbidden');}}});
  const api=QueuedReview.create({outbox:{readQueued(){seen.external++;return original.readQueued();}}});
  return {api,seen,getRaw:()=>raw,setRaw:value=>{raw=value;}};
}

test('explicit capability and frozen read-only API, no implicit queue or game source',()=>{
  assert.equal(QueuedReview.version,1);frozen(QueuedReview);
  for(const options of [undefined,null,{},[],{outbox:null},{outbox:{}},{outbox:{readQueued:3}},{outbox:{readQueued(){}},extra:true}])assert.throws(()=>QueuedReview.create(options),/^Error: queued_review_outbox_unavailable$/);
  const h=harness();assert.deepEqual(Object.keys(h.api),['review']);frozen(h.api);assert.deepEqual(h.seen,{external:0,sourceReads:0,currentJournal:0,CAS:0});
});
test('option and method getters captured once with original receiver and no later reread',async()=>{
  let optionGets=0,methodGets=0,calls=0;const outbox={get readQueued(){methodGets++;return function(){assert.equal(this,outbox);calls++;return stored();};}};
  const api=QueuedReview.create({get outbox(){optionGets++;return outbox;}});
  Object.defineProperty(outbox,'readQueued',{get(){throw Error('method_reread');}});
  assert.equal((await api.review(input())).status,'matches_provided_context');assert.deepEqual([optionGets,methodGets,calls],[1,1,1]);
});
test('throwing option or method getter is a fixed capability error',()=>{
  assert.throws(()=>QueuedReview.create({get outbox(){throw Error('private');}}),/^Error: queued_review_outbox_unavailable$/);
  assert.throws(()=>QueuedReview.create({outbox:{get readQueued(){throw Error('private');}}}),/^Error: queued_review_outbox_unavailable$/);
});
test('stored queue matches newly provided context and preserves the whole local receipt',async()=>{
  const q=fixture(),h=harness(canonical(q)),reply=await h.api.review(input(q));assert.equal(reply.status,'matches_provided_context');assert.equal(reply.stage,'queued_for_review');assert.equal(reply.freshness,'provided_context_only');assert.deepEqual(reply.queued,q);assert.deepEqual(reply.providedContext,q.record.payload.snapshot);counts(reply,[1,1,1,1,1,1]);frozen(reply);
  assert.deepEqual(h.seen,{external:1,sourceReads:1,currentJournal:0,CAS:0});assert.equal(h.getRaw(),canonical(q));
});
test('empty queue retains explicit validated context but claims no queued stage or receipt',async()=>{
  const h=harness(null),reply=await h.api.review(input());assert.equal(reply.status,'empty');assert.equal(reply.queued,null);assert.equal(reply.stage,undefined);assert.deepEqual(reply.providedContext,fixture().record.payload.snapshot);counts(reply,[1,1,0,1,0,0]);frozen(reply);assert.equal(h.seen.CAS+h.seen.currentJournal,0);
});
test('changed supplied revision is stale even when all layout coordinates are equal',async()=>{
  const q=fixture(),provided=clone(q.record.payload.snapshot);provided.revision++;const h=harness(canonical(q)),reply=await h.api.review({snapshotJson:JSON.stringify(provided)});assert.equal(reply.status,'stale_revision');assert.deepEqual(reply.queued,q);assert.equal(h.seen.CAS,0);
});
test('same revision with one changed base coordinate is a complete-layout difference',async()=>{
  const q=fixture(),provided=clone(q.record.payload.snapshot);provided.currentLayout.items[1].y=provided.currentLayout.items[1].y===100?99:provided.currentLayout.items[1].y+1;
  const reply=await harness(canonical(q)).api.review({snapshotJson:JSON.stringify(provided)});assert.equal(reply.status,'base_layout_changed');assert.deepEqual(reply.queued,q);
});
test('object member order and JSON whitespace do not change context identity',async()=>{
  const q=fixture(),s=q.record.payload.snapshot,provided={currentLayout:{items:s.currentLayout.items.map(x=>({y:x.y,id:x.id,x:x.x})),theme:s.currentLayout.theme,version:s.currentLayout.version},revision:s.revision};
  assert.equal((await harness(canonical(q)).api.review({snapshotJson:JSON.stringify(provided,null,2)})).status,'matches_provided_context');
});
test('array order remains part of complete context identity',async()=>{
  const q=fixture(),provided=clone(q.record.payload.snapshot);provided.currentLayout.items.reverse();assert.equal((await harness(canonical(q)).api.review({snapshotJson:JSON.stringify(provided)})).status,'base_layout_changed');
});
test('malformed request shape and throwing snapshot getter fail before any review or host read',async()=>{
  for(const request of [undefined,null,{},[],{snapshotJson:input().snapshotJson,extra:true},{get snapshotJson(){throw Error('private');}}]){const h=harness(),reply=await h.api.review(request);failure(reply,'invalid_request');counts(reply,[0,0,0,0,0,0]);assert.equal(h.seen.external,0);}
});
test('invalid or oversized snapshot and wrong revision bounds fail before external queue read',async()=>{
  const q=fixture();const values=[null,undefined,{},'{','x'.repeat(1000001),JSON.stringify({}),JSON.stringify({revision:7}),JSON.stringify({revision:-1,currentLayout:Core.defaultVillageLayout()}),JSON.stringify({revision:9000000000001,currentLayout:Core.defaultVillageLayout()}),JSON.stringify({revision:1.5,currentLayout:Core.defaultVillageLayout()})];
  for(const snapshotJson of values){const h=harness(canonical(q)),reply=await h.api.review({snapshotJson});failure(reply,'invalid_snapshot');counts(reply,[1,0,0,0,0,0]);assert.equal(h.seen.external,0);}
});
test('unknown, duplicate or absent place IDs and invalid coordinates never default the layout',async()=>{
  const q=fixture();for(const mutate of [s=>s.currentLayout=null,s=>delete s.currentLayout.items,s=>s.currentLayout.items[0].id='unknown',s=>s.currentLayout.items[1].id=s.currentLayout.items[0].id,s=>s.currentLayout.items[0].x=101,s=>s.currentLayout.items[0].y=-1,s=>s.currentLayout.items[0].x=1.5]){const s=clone(q.record.payload.snapshot);mutate(s);const h=harness(),reply=await h.api.review({snapshotJson:JSON.stringify(s)});failure(reply,'invalid_snapshot');assert.equal(h.seen.external,0);}
});
test('changing snapshot getter captured once before external await; caller mutation cannot replace context',async()=>{
  let gets=0,release;const h=injected(()=>new Promise(resolve=>{release=resolve;}));const request={get snapshotJson(){gets++;return gets===1?input().snapshotJson:'{';}};const pending=h.api.review(request);assert.equal(gets,1);assert.equal(h.calls(),1);release(stored());const reply=await pending;assert.equal(reply.status,'matches_provided_context');assert.equal(gets,1);
});
test('thrown external read is fixed queue_read_failed, never empty or provider raw error',async()=>{
  const h=injected(()=>{throw Error('private https://not-to-be-disclosed.invalid/?key=hidden');}),reply=await h.api.review(input());failure(reply,'queue_read_failed');counts(reply,[1,1,0,1,0,0]);assert.equal(JSON.stringify(reply).includes('hidden'),false);assert.equal(h.calls(),1);
});
test('explicit reported read failure and corrupt queue preserve distinct failure rather than empty',async()=>{
  for(const error of ['queue_read_failed','corrupt_queue']){const h=injected({ok:false,error,scope:'explicit_local_preparation',counts:readCounts(0)});failure(await h.api.review(input()),error);assert.equal(h.calls(),1);}
});
test('malformed reply flags, status, freshness, scope, fields and self-reported write counts fail closed',async()=>{
  const values=[undefined,null,3,'stored',[],{},stored(),stored(),stored(),stored(),stored(),stored(),stored()];
  values[6].ok=1;values[7].status='queued';values[8].freshness='provided_context_only';values[9].scope='external';values[10].extra=true;values[11].counts.outboxCAS=1;values[12].counts.outboxReads=2;
  for(const value of values){const h=injected(value);failure(await h.api.review(input()),'corrupt_queue');assert.equal(h.calls(),1);}
});
test('wrong empty combinations and unfamiliar error names cannot become success',async()=>{
  const values=[{ok:true,status:'empty',queued:fixture(),scope:'explicit_local_preparation',freshness:'not_checked',counts:readCounts(0)},{ok:true,status:'empty',queued:null,scope:'explicit_local_preparation',freshness:'not_checked',counts:readCounts(1)},{ok:false,error:'accepted',scope:'explicit_local_preparation',counts:readCounts(0)}];
  for(const value of values)failure(await injected(value).api.review(input()),'corrupt_queue');
});
test('receipt identity, local scope, revision and queued stage are revalidated independently',async()=>{
  for(const mutate of [q=>q.version=2,q=>q.receipt.requestId='another',q=>q.receipt.baseRevision++,q=>q.receipt.outboxRevision=2,q=>q.receipt.stage='accepted',q=>q.receipt.scope='external',q=>q.receipt.extra=true]){const q=fixture();mutate(q);const reply=await injected(stored(q)).api.review(input());failure(reply,'corrupt_queue');assert.equal(reply.counts.outboxRevalidationReads,1);}
});
test('original draft ID, unsubmitted receipt and full proposal/base bindings are independently checked',async()=>{
  for(const mutate of [q=>q.record.requestId='different',q=>q.record.receipt.stage='submitted',q=>q.record.payload.proposal.expectedRevision++,q=>q.record.payload.proposal.requestedLayout.items[0].id='bad',q=>q.record.payload.extra=true,q=>q.record.version=2]){const q=fixture();mutate(q);failure(await injected(stored(q)).api.review(input()),'corrupt_queue');}
});
test('own response getters and toJSON hooks are rejected without invoking data accessors',async()=>{
  let gets=0,toJSONCalls=0;const a=stored();Object.defineProperty(a,'queued',{enumerable:true,get(){gets++;return fixture();}});failure(await injected(a).api.review(input()),'corrupt_queue');assert.equal(gets,0);
  const b=stored();b.toJSON=()=>{toJSONCalls++;return stored();};failure(await injected(b).api.review(input()),'corrupt_queue');assert.equal(toJSONCalls,0);
});
test('symbols, hidden fields, holes and prototype-injection own keys cannot be silently discarded',async()=>{
  const values=[];let v=stored();v[Symbol('extra')]=1;values.push(v);v=stored();Object.defineProperty(v,'hidden',{value:1});values.push(v);v=stored();delete v.queued.record.payload.snapshot.currentLayout.items[0];values.push(v);v=stored();Object.defineProperty(v,'__proto__',{value:{polluted:true},enumerable:true});values.push(v);
  for(const value of values)failure(await injected(value).api.review(input()),'corrupt_queue');assert.equal({}.polluted,undefined);
});
test('inherited throwing hooks are ignored by the detached own-data projection',async()=>{
  let hooks=0;const reply=stored();Object.setPrototypeOf(reply,{get toJSON(){hooks++;throw Error('inherited hook');},get secret(){hooks++;throw Error('inherited data');}});assert.equal((await injected(reply).api.review(input())).status,'matches_provided_context');assert.equal(hooks,0);
});
test('cycles, undefined, functions, bigint and nonfinite values fail before isolated serialization',async()=>{
  const values=[];let v=stored();v.extra=v;values.push(v);for(const extra of [undefined,()=>{},1n,NaN,Infinity,-Infinity])values.push({...stored(),extra});
  for(const value of values){const reply=await injected(value).api.review(input());failure(reply,'corrupt_queue');assert.equal(reply.counts.outboxRevalidationReads,0);}
});
test('escaped strings, deeply nested and oversized node graphs are bounded before queue decoder',async()=>{
  const values=[{...stored(),extra:'x'.repeat(1000001)},{...stored(),extra:'\u0000'.repeat(170000)}];let nested={};for(let i=0;i<18;i++)nested={nested};values.push({...stored(),extra:nested});values.push({...stored(),extra:Array.from({length:10000},()=>({x:1}))});
  for(const value of values){const reply=await injected(value).api.review(input());failure(reply,'corrupt_queue');assert.equal(reply.counts.outboxRevalidationReads,0);}
});
test('provider aliases and returned objects are detached and deeply frozen',async()=>{
  const original=stored(),h=injected(original),reply=await h.api.review(input());original.queued.record.requestId='mutated';original.queued.record.payload.snapshot.currentLayout.items[0].x=999;
  assert.equal(reply.queued.record.requestId,'queued-review-fixture');assert.notEqual(reply.queued.record.payload.snapshot.currentLayout.items[0].x,999);frozen(reply);assert.throws(()=>{reply.queued.receipt.stage='accepted';},TypeError);
});
test('each manual review rereads the slot and never caches a former match',async()=>{
  const h=harness();assert.equal((await h.api.review(input())).status,'matches_provided_context');h.setRaw(null);assert.equal((await h.api.review(input())).status,'empty');assert.equal(h.seen.external,2);assert.equal(h.seen.CAS+h.seen.currentJournal,0);
});
test('different valid queued request ID and proposal are retained as data, not relabeled or overwritten',async()=>{
  const q=fixture(7,'separate-valid-local-id');q.record.payload.proposal.requestedLayout.items[1].x=80;const h=harness(canonical(q)),before=h.getRaw(),reply=await h.api.review(input(q));assert.equal(reply.status,'matches_provided_context');assert.deepEqual(reply.queued,q);assert.equal(h.getRaw(),before);assert.equal(h.seen.CAS,0);
});
test('concurrent manual reviews each have one independent read and no shared report state',async()=>{
  const pending=[];const h=injected(()=>new Promise(resolve=>pending.push(resolve)));const a=h.api.review(input(fixture(7))),b=h.api.review(input(fixture(8)));assert.equal(h.calls(),2);pending[1](stored(fixture(8)));pending[0](stored(fixture(7)));const [one,two]=await Promise.all([a,b]);assert.equal(one.status,'matches_provided_context');assert.equal(two.status,'matches_provided_context');assert.equal(one.queued.receipt.baseRevision,7);assert.equal(two.queued.receipt.baseRevision,8);counts(one,[1,1,1,1,1,1]);counts(two,[1,1,1,1,1,1]);
});
test('browser UMD uses explicit capabilities and cannot reach owner storage, sending or game creation',async()=>{
  let forbidden=0;const context={PetContractorDraftReview:Review,PetContractorRequestOutbox:Outbox,localStorage:{getItem(){forbidden++;throw Error('owner storage');},setItem(){forbidden++;throw Error('owner write');}},fetch(){forbidden++;throw Error('network');},indexedDB:{open(){forbidden++;throw Error('owner database');}}};vm.runInNewContext(source(),context);const api=context.PetContractorQueuedReview.create({outbox:{readQueued(){return stored();}}});assert.equal((await api.review(input())).status,'matches_provided_context');assert.equal(forbidden,0);assert.deepEqual(Object.keys(api),['review']);
  for(const sandbox of [{},{PetContractorDraftReview:Review},{PetContractorRequestOutbox:Outbox}])assert.throws(()=>vm.runInNewContext(source(),sandbox),/queued_review_dependency_unavailable/);
});

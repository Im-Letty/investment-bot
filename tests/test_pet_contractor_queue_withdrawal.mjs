import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const Core=require('../static/pet-game-core.js');
const Journal=require('../static/pet-contractor-draft-journal.js');
const Outbox=require('../static/pet-contractor-request-outbox.js');
const Withdrawal=require('../static/pet-contractor-queue-withdrawal.js');
const plain=value=>JSON.parse(JSON.stringify(value));
function canonical(v){return Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);}
function frozen(v){if(v&&typeof v==='object'){assert.equal(Object.isFrozen(v),true);Object.values(v).forEach(frozen);}}
function failure(reply,error){assert.equal(reply.ok,false);assert.equal(reply.error,error);assert.equal(reply.scope,'explicit_local_preparation');assert.equal(reply.status,undefined);frozen(reply);}
function counts(reply,values){assert.deepEqual(Object.values(reply.counts),values);}
async function fixture(id='withdrawal-fixture',revision=7){
  let journalRaw=null,raw=null;
  const initialization={journalReads:0,journalWrites:0,queueReads:0,queueWrites:0};
  const consumer={reads:0,CAS:0,seen:[]};
  const snapshot={revision,currentLayout:Core.defaultVillageLayout()},requested=plain(snapshot.currentLayout);
  requested.items[0].x=requested.items[0].x===100?99:requested.items[0].x+1;
  const proposal={version:1,expectedRevision:revision,requestedLayout:requested};
  const journal=Journal.create({repository:{async read(){initialization.journalReads++;return journalRaw;},async compareAndSwap(expected,next){if(journalRaw!==expected)return 'conflict';initialization.journalWrites++;journalRaw=next;return 'committed';}}});
  assert.equal((await journal.recordDraft({requestId:id,snapshotJson:JSON.stringify(snapshot),proposalJson:JSON.stringify(proposal)})).status,'recorded');
  const outbox=Outbox.create({journal,repository:{async read(){initialization.queueReads++;return raw;},async compareAndSwap(expected,next){if(raw!==expected)return 'conflict';initialization.queueWrites++;raw=next;return 'committed';}}});
  const queued=await outbox.enqueue({snapshotJson:JSON.stringify(snapshot)});
  assert.equal(queued.status,'queued');assert.equal(canonical(queued.queued),raw);
  assert.deepEqual([initialization.journalWrites,initialization.queueWrites],[1,1]);
  const baseline={journalRaw,initialization:plain(initialization)};
  let reader=null,cas=null;
  const repository={async read(){consumer.reads++;return reader?reader():raw;},async compareAndSwap(expected,next){consumer.CAS++;consumer.seen.push([expected,next]);if(cas)return cas(expected,next);if(raw!==expected)return 'conflict';raw=next;return 'committed';}};
  const api=Withdrawal.create({repository});
  return {api,repository,consumer,initialization,baseline,outbox,queued:queued.queued,expected:raw,snapshot,
    raw:()=>raw,journalRaw:()=>journalRaw,setRaw:value=>{raw=value;},setReader:value=>{reader=value;},setCAS:value=>{cas=value;},
    untouchedJournal(){assert.equal(journalRaw,baseline.journalRaw);assert.deepEqual(initialization,baseline.initialization);}};
}

test('only explicit nullable-CAS capabilities create a frozen API, without fixture work credit',async()=>{
  assert.equal(Withdrawal.version,1);frozen(Withdrawal);
  for(const options of [undefined,null,{},[],{repository:null},{repository:{}},{repository:{read(){},compareAndSwap:4}},{repository:{read(){},compareAndSwap(){}},extra:true}])assert.throws(()=>Withdrawal.create(options),/^Error: queue_withdrawal_repository_unavailable$/);
  const h=await fixture();assert.deepEqual(Object.keys(h.api),['inspect','withdraw']);frozen(h.api);
  assert.deepEqual(h.consumer,{reads:0,CAS:0,seen:[]});h.untouchedJournal();
});
test('inspect reads a real Journal-to-Outbox fixture once and provides a canonical detached target',async()=>{
  const h=await fixture(),r=await h.api.inspect();assert.equal(r.ok,true);assert.equal(r.status,'stored_local');assert.equal(r.freshness,'not_checked');assert.equal(r.expectedQueuedJson,h.expected);assert.deepEqual(plain(r.queued),plain(h.queued));assert.notEqual(r.queued,h.queued);counts(r,[1,0,0,1,1,0]);frozen(r);assert.equal(h.raw(),h.expected);assert.deepEqual([h.consumer.reads,h.consumer.CAS],[1,0]);h.untouchedJournal();
});
test('committed withdrawal compares exact whole raw to null, preserves Journal and returns this-call target only',async()=>{
  const h=await fixture(),r=await h.api.withdraw({expectedQueuedJson:h.expected});assert.equal(r.ok,true);assert.equal(r.status,'withdrawn_local');assert.deepEqual(plain(r.target),plain(h.queued));assert.equal(r.freshness,undefined);assert.equal(r.queued,undefined);counts(r,[1,1,1,1,1,1]);assert.deepEqual(h.consumer.seen,[[h.expected,null]]);assert.equal(h.raw(),null);frozen(r);h.untouchedJournal();
});
test('empty inspect is unattributed read success, while empty withdraw cannot claim withdrawal or replay',async()=>{
  const h=await fixture();h.setRaw(null);const read=await h.api.inspect();assert.equal(read.ok,true);assert.equal(read.status,'empty_unattributed');assert.equal(read.queued,null);assert.equal(read.expectedQueuedJson,null);assert.equal(read.freshness,'not_checked');counts(read,[1,0,0,0,0,0]);
  const r=await h.api.withdraw({expectedQueuedJson:h.expected});failure(r,'queue_empty_unattributed');counts(r,[1,1,1,0,0,0]);assert.equal(h.consumer.CAS,0);h.untouchedJournal();
});
test('invalid request shape and throwing getter stop before all validation and repository I/O',async()=>{
  for(const input of [undefined,null,[],{}, {expectedQueuedJson:'x',extra:true},{get expectedQueuedJson(){throw Error('private');}}]){const h=await fixture(),r=await h.api.withdraw(input);failure(r,'invalid_request');counts(r,[0,0,0,0,0,0]);assert.deepEqual([h.consumer.reads,h.consumer.CAS],[0,0]);}
});
test('ID-only, malformed and invalid expected queues are rejected before the external read',async()=>{
  const h=await fixture();for(const expectedQueuedJson of [undefined,null,7,{},'{',JSON.stringify({requestId:'withdrawal-fixture'}),'x'.repeat(1000001),JSON.stringify(JSON.parse(h.expected),null,2)]){const r=await h.api.withdraw({expectedQueuedJson});failure(r,'invalid_expected_queue');assert.equal(r.counts.repositoryReads,0);assert.equal(r.counts.repositoryCAS,0);}assert.equal(h.consumer.reads+h.consumer.CAS,0);h.untouchedJournal();
});
test('forged expected receipts or altered schema never reach external repository access',async()=>{
  const h=await fixture();for(const change of [q=>q.version=2,q=>q.receipt.scope='external',q=>q.receipt.stage='accepted',q=>q.receipt.baseRevision++,q=>q.record.receipt.stage='submitted',q=>q.record.payload.proposal.expectedRevision++,q=>q.record.payload.snapshot.currentLayout.items[0].id='unknown']){const q=plain(h.queued);change(q);failure(await h.api.withdraw({expectedQueuedJson:canonical(q)}),'invalid_expected_queue');}assert.equal(h.consumer.reads+h.consumer.CAS,0);
});
test('repository option and method getters are captured once and retain their original receiver',async()=>{
  const h=await fixture();let options=0,reads=0,writes=0,calls=0;const repository={get read(){reads++;return function(){assert.equal(this,repository);calls++;return h.raw();};},get compareAndSwap(){writes++;return function(expected,next){assert.equal(this,repository);assert.equal(expected,h.expected);assert.equal(next,null);h.setRaw(next);return 'committed';};}};
  const api=Withdrawal.create({get repository(){options++;return repository;}});Object.defineProperty(repository,'read',{get(){throw Error('reread');}});Object.defineProperty(repository,'compareAndSwap',{get(){throw Error('reread');}});
  assert.equal((await api.withdraw({expectedQueuedJson:h.expected})).status,'withdrawn_local');assert.deepEqual([options,reads,writes,calls],[1,1,1,1]);
});
test('throwing capability getters become one fixed constructor error',()=>{
  assert.throws(()=>Withdrawal.create({get repository(){throw Error('private');}}),/^Error: queue_withdrawal_repository_unavailable$/);
  for(const key of ['read','compareAndSwap']){const repository={read(){},compareAndSwap(){}};Object.defineProperty(repository,key,{get(){throw Error('private');}});assert.throws(()=>Withdrawal.create({repository}),/^Error: queue_withdrawal_repository_unavailable$/);}
});
test('changing expected getter is captured once before the first asynchronous validation',async()=>{
  const h=await fixture();let gets=0,release;h.setReader(()=>new Promise(resolve=>{release=resolve;}));const request={get expectedQueuedJson(){gets++;return gets===1?h.expected:'{';}};const pending=h.api.withdraw(request);assert.equal(gets,1);await new Promise(resolve=>setImmediate(resolve));assert.equal(h.consumer.reads,1);Object.defineProperty(request,'expectedQueuedJson',{value:'{'});release(h.expected);assert.equal((await pending).status,'withdrawn_local');assert.equal(gets,1);
});
test('read failure stays a fixed failed observation, not empty or a provider error disclosure',async()=>{
  const h=await fixture();h.setReader(()=>{throw Error('private https://invalid.example/?token=hidden');});for(const call of [()=>h.api.inspect(),()=>h.api.withdraw({expectedQueuedJson:h.expected})]){const r=await call();failure(r,'queue_read_failed');assert.equal(r.counts.repositoryReads,1);assert.equal(r.counts.repositoryCAS,0);assert.equal(JSON.stringify(r).includes('hidden'),false);}assert.equal(h.consumer.CAS,0);h.untouchedJournal();
});
test('host object replies are not traversed and cannot execute data getters or toJSON',async()=>{
  const h=await fixture();let gets=0,hooks=0;const raw={get record(){gets++;return h.queued.record;},toJSON(){hooks++;return h.expected;}};h.setRaw(raw);for(const call of [()=>h.api.inspect(),()=>h.api.withdraw({expectedQueuedJson:h.expected})])failure(await call(),'corrupt_queue');assert.deepEqual([gets,hooks,h.consumer.CAS],[0,0,0]);
});
test('corrupt actual strings, noncanonical envelopes and forged full records are never cleared',async()=>{
  const h=await fixture(),bad=plain(h.queued);bad.receipt.requestId='other';for(const raw of ['{','null','x'.repeat(1000001),JSON.stringify(plain(h.queued),null,2),canonical(bad)]){h.setRaw(raw);failure(await h.api.inspect(),'corrupt_queue');failure(await h.api.withdraw({expectedQueuedJson:h.expected}),'corrupt_queue');assert.equal(h.raw(),raw);}assert.equal(h.consumer.CAS,0);h.untouchedJournal();
});
test('different valid ID conflicts instead of replacing a separately prepared queue',async()=>{
  const h=await fixture(),other=await fixture('other-request');h.setRaw(other.expected);failure(await h.api.withdraw({expectedQueuedJson:h.expected}),'queue_conflict');assert.equal(h.raw(),other.expected);assert.equal(h.consumer.CAS,0);h.untouchedJournal();
});
test('same ID with a different complete base revision conflicts, rather than ID-only withdrawal',async()=>{
  const h=await fixture(),other=await fixture('withdrawal-fixture',8);h.setRaw(other.expected);failure(await h.api.withdraw({expectedQueuedJson:h.expected}),'queue_conflict');assert.equal(h.raw(),other.expected);assert.equal(h.consumer.CAS,0);
});
test('same ID and revision with a different valid proposal remain different full targets',async()=>{
  const h=await fixture(),q=plain(h.queued);q.record.payload.proposal.requestedLayout.items[1].x=80;const other=canonical(q);h.setRaw(other);const inspection=await h.api.inspect();assert.equal(inspection.status,'stored_local');failure(await h.api.withdraw({expectedQueuedJson:h.expected}),'queue_conflict');assert.equal(h.raw(),other);assert.equal(h.consumer.CAS,0);
});
test('an actual competing CAS change keeps the winner and never retries internally',async()=>{
  const h=await fixture(),other=await fixture('winning-request');h.setCAS((expected,next)=>{assert.equal(expected,h.expected);assert.equal(next,null);h.setRaw(other.expected);return 'conflict';});const r=await h.api.withdraw({expectedQueuedJson:h.expected});failure(r,'queue_conflict');counts(r,[1,1,1,1,1,1]);assert.equal(h.raw(),other.expected);assert.deepEqual([h.consumer.reads,h.consumer.CAS],[1,1]);h.untouchedJournal();
});
test('unknown ACK values never become successful withdrawals and are not inspected',async()=>{
  let hooks=0;for(const ack of [undefined,null,true,'ok',1,{get committed(){hooks++;return true;}}]){const h=await fixture();h.setCAS(()=>ack);const r=await h.api.withdraw({expectedQueuedJson:h.expected});failure(r,'write_outcome_unknown');assert.equal(h.raw(),h.expected);assert.deepEqual([h.consumer.reads,h.consumer.CAS],[1,1]);}assert.equal(hooks,0);
});
test('commit then thrown ACK stays unknown; later manual empty reads never identify a successful withdrawal',async()=>{
  const h=await fixture();h.setCAS((expected,next)=>{assert.equal(expected,h.expected);h.setRaw(next);throw Error('ACK lost');});const first=await h.api.withdraw({expectedQueuedJson:h.expected});failure(first,'write_outcome_unknown');assert.equal(h.raw(),null);assert.deepEqual([h.consumer.reads,h.consumer.CAS],[1,1]);
  const read=await h.api.inspect();assert.equal(read.status,'empty_unattributed');counts(read,[1,0,0,0,0,0]);const again=await h.api.withdraw({expectedQueuedJson:h.expected});failure(again,'queue_empty_unattributed');counts(again,[1,1,1,0,0,0]);assert.deepEqual([h.consumer.reads,h.consumer.CAS],[3,1]);h.untouchedJournal();
});
test('noncommitting thrown ACK allows only a new explicit manual operation with a new read',async()=>{
  const h=await fixture();h.setCAS(()=>{throw Error('unsupported write');});failure(await h.api.withdraw({expectedQueuedJson:h.expected}),'write_outcome_unknown');assert.equal(h.raw(),h.expected);h.setCAS(null);assert.equal((await h.api.withdraw({expectedQueuedJson:h.expected})).status,'withdrawn_local');assert.deepEqual([h.consumer.reads,h.consumer.CAS],[2,2]);
});
test('string-only CAS host cannot support nullable deletion and never receives a false success',async()=>{
  const h=await fixture();h.setCAS((expected,next)=>{if(typeof next!=='string')throw Error('idb_invalid_raw_value');throw Error('unused');});const r=await h.api.withdraw({expectedQueuedJson:h.expected});failure(r,'write_outcome_unknown');assert.equal(h.raw(),h.expected);assert.deepEqual([h.consumer.reads,h.consumer.CAS],[1,1]);
  // Controlled host contract negative only: old native IndexedDB integration is not exercised.
});
test('a later separately explicit old-Outbox enqueue into null remains possible, with no tombstone claim',async()=>{
  const h=await fixture();assert.equal((await h.api.withdraw({expectedQueuedJson:h.expected})).status,'withdrawn_local');const before=plain(h.initialization);const queued=await h.outbox.enqueue({snapshotJson:JSON.stringify(h.snapshot)});assert.equal(queued.status,'queued');assert.equal(h.raw(),h.expected);assert.equal(h.initialization.queueWrites,before.queueWrites+1);assert.equal(h.journalRaw(),h.baseline.journalRaw);assert.equal(h.consumer.CAS,1);
});
test('every manual inspect starts a new read and never caches a former presence or withdrawal result',async()=>{
  const h=await fixture();assert.equal((await h.api.inspect()).status,'stored_local');h.setRaw(null);assert.equal((await h.api.inspect()).status,'empty_unattributed');h.setRaw(h.expected);assert.equal((await h.api.inspect()).status,'stored_local');assert.deepEqual([h.consumer.reads,h.consumer.CAS],[3,0]);
});
test('returned targets and counts are detached deeply frozen data, never host or Journal aliases',async()=>{
  const h=await fixture(),read=await h.api.inspect();assert.notEqual(read.queued,h.queued);frozen(read);assert.throws(()=>{read.queued.receipt.stage='accepted';},TypeError);assert.throws(()=>{read.counts.repositoryCAS=99;},TypeError);const r=await h.api.withdraw({expectedQueuedJson:read.expectedQueuedJson});frozen(r);assert.notEqual(r.target,read.queued);assert.equal(r.target.record.requestId,'withdrawal-fixture');assert.equal(h.journalRaw(),h.baseline.journalRaw);
});
test('two concurrent explicit withdrawals obtain separate reads and only one matching atomic clear commits',async()=>{
  const h=await fixture(),pending=[];h.setReader(()=>new Promise(resolve=>pending.push(resolve)));const a=h.api.withdraw({expectedQueuedJson:h.expected}),b=h.api.withdraw({expectedQueuedJson:h.expected});await new Promise(resolve=>setImmediate(resolve));assert.equal(pending.length,2);pending.forEach(resolve=>resolve(h.expected));const replies=await Promise.all([a,b]);assert.deepEqual(replies.map(r=>r.status||r.error).sort(),['queue_conflict','withdrawn_local']);assert.equal(h.raw(),null);assert.deepEqual([h.consumer.reads,h.consumer.CAS],[2,2]);replies.forEach(r=>{assert.equal(r.counts.repositoryReads,1);assert.equal(r.counts.repositoryCAS,1);});
});
test('browser UMD uses only explicit repository capabilities and cannot invoke owner storage or sending',async()=>{
  const h=await fixture();let forbidden=0;const context={PetContractorRequestOutbox:Outbox};for(const key of ['localStorage','indexedDB','fetch','XMLHttpRequest','PetGameCore'])Object.defineProperty(context,key,{get(){forbidden++;throw Error('forbidden host');}});
  vm.runInNewContext(fs.readFileSync(new URL('../static/pet-contractor-queue-withdrawal.js',import.meta.url),'utf8'),context);const api=context.PetContractorQueueWithdrawal.create({repository:h.repository});assert.equal((await api.inspect()).status,'stored_local');assert.equal((await api.withdraw({expectedQueuedJson:h.expected})).status,'withdrawn_local');assert.equal(forbidden,0);h.untouchedJournal();
});

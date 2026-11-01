import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const Core=require('../static/pet-game-core.js');
const Journal=require('../static/pet-contractor-draft-journal.js');
const Review=require('../static/pet-contractor-draft-review.js');
const Outbox=require('../static/pet-contractor-request-outbox.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function fixture(id='outbox-fixture',revision=7){
  const base=Core.defaultVillageLayout(),requested=clone(base);
  requested.items[0].x=requested.items[0].x===100?99:requested.items[0].x+1;
  return {version:1,requestId:id,payload:{snapshot:{revision,currentLayout:base},proposal:{version:1,expectedRevision:revision,requestedLayout:requested}},
    receipt:{version:1,requestId:id,stage:'unsubmitted',journalRevision:1}};
}
const input=(record=fixture())=>({snapshotJson:JSON.stringify(record.payload.snapshot)});
function envelope(record=fixture()){
  return {version:1,record:clone(record),receipt:{version:1,requestId:record.requestId,stage:'queued_for_review',
    scope:'explicit_local_preparation',outboxRevision:1,baseRevision:record.payload.snapshot.revision}};
}
function frozen(value){if(value&&typeof value==='object'){assert.equal(Object.isFrozen(value),true);Object.values(value).forEach(frozen);}}
function error(reply,code){assert.equal(reply.ok,false);assert.equal(reply.error,code);assert.equal(reply.scope,'explicit_local_preparation');frozen(reply);}
function counts(reply,values){assert.deepEqual(Object.values(reply.counts),values);}
function harness(options={}){
  let record=clone(options.record||fixture()),draftRaw=own(options,'draftRaw')?options.draftRaw:JSON.stringify(record);
  let queueRaw=own(options,'queueRaw')?options.queueRaw:null,mode=options.mode||'normal';
  const seen={journalReads:0,journalCAS:0,outboxReads:0,outboxCAS:0};
  const legacy=Journal.create({repository:{
    async read(){seen.journalReads++;if(options.journalFailure)throw Error('synthetic_journal_read');return draftRaw;},
    async compareAndSwap(){seen.journalCAS++;throw Error('source_journal_write_forbidden');}
  }});
  const journal={readDraft(){return legacy.readDraft();},get recordDraft(){throw Error('source_journal_writer_must_not_be_read');}};
  const repository={
    async read(){seen.outboxReads++;if(options.queueFailure)throw Error('synthetic_queue_read');return queueRaw;},
    async compareAndSwap(expected,next){
      seen.outboxCAS++;
      if(mode==='reject')throw Error('synthetic_write_unknown');
      if(mode==='conflict'||queueRaw!==expected)return 'conflict';
      queueRaw=next;
      if(mode==='unknown')return undefined;
      if(mode==='throw_after_commit')throw Error('synthetic_lost_ACK');
      if(mode==='object')return {get ok(){throw Error('ACK_object_getter_forbidden');}};
      return 'committed';
    }
  };
  return {api:Outbox.create({journal,repository}),journal,repository,seen,getRaw:()=>queueRaw,
    setRaw:value=>{queueRaw=value;},setMode:value=>{mode=value;},replaceDraft:value=>{record=clone(value);draftRaw=JSON.stringify(record);}};
}

test('explicit capabilities only; frozen API captures option and method getters once with original receivers',async()=>{
  assert.equal(Outbox.version,1);frozen(Outbox);
  for(const options of [undefined,null,{},[],{journal:{}},{journal:{readDraft(){}},repository:{}},
    {journal:{readDraft(){}},repository:{read(){},compareAndSwap(){}},extra:true}])assert.throws(()=>Outbox.create(options),/request_outbox_options_unavailable/);
  const calls={j:0,r:0,jm:0,rm:0,cm:0},record=fixture();let raw=null;
  const journal={get readDraft(){calls.jm++;return function(){assert.equal(this,journal);return {ok:true,status:'recorded_unsubmitted',record};};}};
  const repository={get read(){calls.rm++;return function(){assert.equal(this,repository);return raw;};},
    get compareAndSwap(){calls.cm++;return function(expected,next){assert.equal(this,repository);assert.equal(expected,null);raw=next;return 'committed';};}};
  const api=Outbox.create({get journal(){calls.j++;return calls.j===1?journal:null;},get repository(){calls.r++;return calls.r===1?repository:null;}});
  assert.deepEqual(Object.keys(api),['enqueue','readQueued']);frozen(api);
  assert.equal((await api.enqueue(input(record))).status,'queued');assert.equal((await api.readQueued()).status,'stored_local');
  assert.deepEqual(calls,{j:1,r:1,jm:1,rm:1,cm:1});
});

test('manual new enqueue stores the original unsubmitted record and distinct canonical local receipt after one CAS',async()=>{
  const h=harness(),reply=await h.api.enqueue(input());assert.equal(reply.status,'queued');assert.equal(reply.freshness,'provided_context_only');
  assert.deepEqual(reply.queued,envelope());assert.equal(h.getRaw(),canonical(envelope()));
  assert.equal(reply.queued.record.receipt.stage,'unsubmitted');assert.equal(reply.queued.receipt.stage,'queued_for_review');
  counts(reply,[1,1,1,1,0,1]);assert.deepEqual(h.seen,{journalReads:1,journalCAS:0,outboxReads:1,outboxCAS:1});frozen(reply);
});

test('readQueued empty is a local read without draft review, journal access or CAS',async()=>{
  const h=harness(),reply=await h.api.readQueued();assert.equal(reply.status,'empty');assert.equal(reply.queued,null);assert.equal(reply.freshness,'not_checked');
  counts(reply,[0,0,0,1,0,0]);assert.equal(h.seen.journalReads,0);assert.equal(h.seen.outboxCAS,0);frozen(reply);
});

test('readQueued validates the stored original record and receipt without asserting current-context freshness',async()=>{
  const h=harness({queueRaw:canonical(envelope())}),reply=await h.api.readQueued();assert.equal(reply.status,'stored_local');assert.equal(reply.freshness,'not_checked');
  assert.deepEqual(reply.queued,envelope());counts(reply,[0,0,0,1,1,0]);assert.equal(h.seen.journalReads,0);assert.equal(h.seen.journalCAS,0);frozen(reply);
});

test('same ID and payload manually replay only after review and return the exact original local receipt without CAS',async()=>{
  const h=harness({queueRaw:canonical(envelope())}),before=h.getRaw(),reply=await h.api.enqueue(input());
  assert.equal(reply.status,'replayed');assert.equal(h.getRaw(),before);assert.deepEqual(reply.queued,envelope());counts(reply,[1,1,1,1,1,0]);assert.equal(h.seen.outboxCAS,0);
});

test('a stale explicit context cannot bypass review through an already recorded receipt',async()=>{
  const h=harness({queueRaw:canonical(envelope())}),snapshot=clone(fixture().payload.snapshot);snapshot.revision++;
  const reply=await h.api.enqueue({snapshotJson:JSON.stringify(snapshot)});error(reply,'stale_revision');counts(reply,[1,1,1,0,0,0]);
  assert.equal((await h.api.readQueued()).status,'stored_local');assert.equal(h.seen.outboxCAS,0);
});

test('same revision but changed complete layout blocks replay before any outbox read',async()=>{
  const h=harness({queueRaw:canonical(envelope())}),snapshot=clone(fixture().payload.snapshot);snapshot.currentLayout.items[1].y++;
  const reply=await h.api.enqueue({snapshotJson:JSON.stringify(snapshot)});error(reply,'base_layout_changed');assert.equal(h.seen.outboxReads,0);assert.equal(h.seen.outboxCAS,0);
});

test('different request ID conflicts even when its validated payload is identical',async()=>{
  const other=fixture('different-id'),h=harness({record:other,queueRaw:canonical(envelope())}),before=h.getRaw();
  error(await h.api.enqueue(input(other)),'queue_conflict');assert.equal(h.getRaw(),before);assert.equal(h.seen.outboxCAS,0);
});

test('same request ID with a different validated proposal conflicts rather than overwriting',async()=>{
  const changed=fixture();changed.payload.proposal.requestedLayout.items[1].x++;
  const h=harness({record:changed,queueRaw:canonical(envelope())}),before=h.getRaw();
  error(await h.api.enqueue(input(changed)),'queue_conflict');assert.equal(h.getRaw(),before);assert.equal(h.seen.outboxCAS,0);
});

test('invalid explicit snapshot JSON, absent layout and typed revision failures precede journal and outbox reads',async()=>{
  for(const snapshotJson of [undefined,null,1,'{','{}',' '.repeat(1000001),JSON.stringify({revision:7}),
    JSON.stringify({...fixture().payload.snapshot,revision:true}),JSON.stringify({...fixture().payload.snapshot,revision:-1})]){
    const h=harness(),reply=await h.api.enqueue({snapshotJson});error(reply,'invalid_snapshot');counts(reply,[1,0,0,0,0,0]);
    assert.equal(h.seen.journalReads+h.seen.outboxReads+h.seen.outboxCAS,0);
  }
});

test('request shape rejects extra keys and throwing getters; a changing snapshot getter is captured once before await',async()=>{
  for(const value of [null,[],{}, {...input(),extra:true},{...input(),[Symbol('extra')]:true},{get snapshotJson(){throw Error('private');}}]){
    const h=harness(),reply=await h.api.enqueue(value);error(reply,'invalid_request');counts(reply,[0,0,0,0,0,0]);
  }
  const h=harness();let gets=0;const reply=await h.api.enqueue({get snapshotJson(){gets++;return gets===1?input().snapshotJson:'{';}});
  assert.equal(reply.status,'queued');assert.equal(gets,1);
});

test('empty source journal never becomes an empty successful request or creates an outbox record',async()=>{
  const h=harness({draftRaw:null}),reply=await h.api.enqueue(input());error(reply,'draft_empty');counts(reply,[1,1,0,0,0,0]);assert.equal(h.getRaw(),null);
});

test('corrupt source journal fails closed and leaves even an existing outbox unread and unchanged',async()=>{
  const raw=canonical(envelope()),h=harness({draftRaw:'{',queueRaw:raw});error(await h.api.enqueue(input()),'corrupt_journal');
  assert.equal(h.getRaw(),raw);assert.equal(h.seen.outboxReads+h.seen.outboxCAS,0);
});

test('untrusted source replies with accessors or malformed shape are rejected without executing response data getters',async()=>{
  let getters=0;
  const malformed={ok:true,status:'recorded_unsubmitted',get record(){getters++;return fixture();}};
  const repository={read(){throw Error('outbox_read_forbidden');},compareAndSwap(){throw Error('write_forbidden');}};
  const api=Outbox.create({journal:{readDraft(){return malformed;}},repository});error(await api.enqueue(input()),'corrupt_journal');assert.equal(getters,0);
});

test('journal provider read failure is distinct from draft empty and cannot access outbox',async()=>{
  const h=harness({journalFailure:true});error(await h.api.enqueue(input()),'journal_read_failed');assert.equal(h.seen.outboxReads+h.seen.outboxCAS,0);
});

test('outbox read failure is distinct from empty and cannot attempt CAS',async()=>{
  const h=harness({queueFailure:true});error(await h.api.enqueue(input()),'queue_read_failed');assert.equal(h.seen.outboxCAS,0);
  error(await h.api.readQueued(),'queue_read_failed');assert.equal(h.seen.outboxCAS,0);
});

test('nonstring outbox data including getter-bearing objects is rejected without reading data properties',async()=>{
  let gets=0;const object={get payload(){gets++;throw Error('private');},get toJSON(){gets++;throw Error('private');}};
  for(const queueRaw of [undefined,false,0,object,[]]){
    const h=harness({queueRaw});error(await h.api.readQueued(),'corrupt_queue');error(await h.api.enqueue(input()),'corrupt_queue');assert.equal(h.seen.outboxCAS,0);
  }
  assert.equal(gets,0);
});

test('malformed, noncanonical, duplicate-member and oversized queue strings are never overwritten',async()=>{
  const valid=canonical(envelope());
  for(const queueRaw of ['{','null','[]','{}',' '.repeat(1000001),JSON.stringify(envelope(),null,2),valid.replace('"version":1','"version":1,"version":1')]){
    const h=harness({queueRaw});error(await h.api.readQueued(),'corrupt_queue');error(await h.api.enqueue(input()),'corrupt_queue');
    assert.equal(h.getRaw(),queueRaw);assert.equal(h.seen.outboxCAS,0);
  }
});

test('strict stored schemas and original-record/context receipt bindings cannot be relabeled as accepted or replayed',async()=>{
  const mutations=[q=>q.version=2,q=>q.extra=true,q=>q.receipt.requestId='other',q=>q.receipt.baseRevision++,
    q=>q.receipt.stage='accepted',q=>q.receipt.scope='external',q=>q.receipt.outboxRevision=2,q=>q.record.payload.proposal.expectedRevision++];
  for(const mutate of mutations){const value=envelope();mutate(value);const raw=canonical(value),h=harness({queueRaw:raw});
    error(await h.api.enqueue(input()),'corrupt_queue');assert.equal(h.getRaw(),raw);assert.equal(h.seen.outboxCAS,0);
  }
});

test('explicit CAS conflict gives one failed attempt and no automatic retry or overwrite',async()=>{
  const h=harness({mode:'conflict'}),reply=await h.api.enqueue(input());error(reply,'queue_conflict');counts(reply,[1,1,1,1,0,1]);
  assert.equal(h.seen.outboxReads,1);assert.equal(h.seen.outboxCAS,1);assert.equal(h.getRaw(),null);
});

test('rejected, lost, object and other unfamiliar acknowledgements never claim queue success',async()=>{
  for(const mode of ['reject','unknown','throw_after_commit','object']){
    const h=harness({mode}),reply=await h.api.enqueue(input());error(reply,'write_outcome_unknown');assert.equal(h.seen.outboxCAS,1);assert.equal(h.seen.outboxReads,1);
  }
});

test('manual retry after an unknown committed ACK reviews and rereads before resolving the preserved receipt',async()=>{
  const h=harness({mode:'unknown'});error(await h.api.enqueue(input()),'write_outcome_unknown');const saved=h.getRaw();h.setMode('normal');
  const replay=await h.api.enqueue(input());assert.equal(replay.status,'replayed');assert.equal(h.getRaw(),saved);counts(replay,[1,1,1,1,1,0]);
  assert.equal(h.seen.journalReads,2);assert.equal(h.seen.outboxReads,2);assert.equal(h.seen.outboxCAS,1);
});

test('two independent clients sharing an atomic slot cannot both commit concurrent manual requests',async()=>{
  let raw=null,writes=0,reads=0;const repository={async read(){reads++;return raw;},async compareAndSwap(expected,next){if(raw!==expected)return 'conflict';raw=next;writes++;return 'committed';}};
  const a=harness({record:fixture('client-a')}),b=harness({record:fixture('client-b')});
  const left=Outbox.create({journal:a.journal,repository}),right=Outbox.create({journal:b.journal,repository});
  const replies=await Promise.all([left.enqueue(input(fixture('client-a'))),right.enqueue(input(fixture('client-b')))]);
  assert.equal(replies.filter(x=>x.ok&&x.status==='queued').length,1);assert.equal(replies.filter(x=>!x.ok&&x.error==='queue_conflict').length,1);
  assert.equal(writes,1);assert.equal(reads,2);assert.ok(['client-a','client-b'].includes(JSON.parse(raw).record.requestId));
});

test('detached canonical records, preserved array order and browser UMD invariants keep game, owner storage and external sending untouched',async()=>{
  const record=fixture(),before=clone(record);let queueRaw=null,forbidden=0;
  const deny=()=>{forbidden++;throw Error('forbidden_external_or_game_action');};
  const context={PetContractorDraftReview:Review,PetContractorDraftJournal:Journal,fetch:deny,XMLHttpRequest:deny,
    PetGameCore:{create:deny},localStorage:{getItem:deny,setItem:deny},indexedDB:{open:deny},send:deny};
  vm.runInNewContext(fs.readFileSync(new URL('../static/pet-contractor-request-outbox.js',import.meta.url),'utf8'),context);
  const journal={readDraft(){return {ok:true,status:'recorded_unsubmitted',record};},recordDraft:deny};
  const repository={read(){return queueRaw;},compareAndSwap(expected,next){assert.equal(expected,null);queueRaw=next;return 'committed';}};
  const api=context.PetContractorRequestOutbox.create({journal,repository}),reply=await api.enqueue(input(record));
  assert.equal(reply.status,'queued');assert.deepEqual(record,before);frozen(reply);
  assert.throws(()=>{reply.queued.record.payload.snapshot.revision=99;},TypeError);
  record.requestId='mutated-provider';assert.equal(reply.queued.record.requestId,'outbox-fixture');assert.equal(JSON.parse(queueRaw).record.requestId,'outbox-fixture');
  const reordered=clone(envelope());reordered.record.payload.proposal.requestedLayout.items.reverse();
  const h=harness({queueRaw:canonical(reordered)});error(await h.api.enqueue(input()),'queue_conflict');
  assert.equal(forbidden,0);assert.equal(reply.queued.receipt.stage,'queued_for_review');
  for(const key of ['accepted','price','days','NPC','unlock','reward','construction','development','ownerFreshness'])assert.equal(key in reply.queued.receipt,false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const Provider=require('../static/pet-contractor-outbox-indexeddb-repository.js');
const Core=require('../static/pet-game-core.js');
const Journal=require('../static/pet-contractor-draft-journal.js');
const Outbox=require('../static/pet-contractor-request-outbox.js');
const Withdrawal=require('../static/pet-contractor-queue-withdrawal.js');
const NAME='pet-contractor-outbox-idb-qa-controlled-20261102',TOKEN='a'.repeat(64);
const STORE='queued_local_qa',META='ownership',SLOT='queued',SECRET='sensitive-host-error-must-not-escape';
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const metadata=()=>({version:1,kind:'contractor-outbox-qa',dbName:NAME,ownerToken:TOKEN});
const tick=()=>Promise.resolve();
function rejects(p,code){return assert.rejects(p,e=>e instanceof Error&&e.message==='outbox_idb_'+code&&!e.message.includes(SECRET));}

// A deterministic event/fault model. It serializes modeled transactions and
// applies its staged map only on complete. These are not native-IDB proofs.
function harness({exists=true,slot,slotPresent=false}={}){
  const h={state:{exists,names:exists?[STORE]:[],data:new Map(exists?[[META,metadata()]]:[])},fault:{},opens:[],deletes:[],transactions:[],createdStores:[],closes:0};
  if(slotPresent)h.state.data.set(SLOT,slot);
  function database(openRequest){
    const db={name:NAME,version:1,
      get objectStoreNames(){const names=openRequest.upgradeNames||h.state.names;return Object.assign([...names],{contains(k){return this.includes(k);}});},
      close(){h.closes++;},
      createObjectStore(name){
        h.createdStores.push(name);openRequest.upgradeNames.push(name);
        return {add(value,key){openRequest.upgradeData.set(key,value);return {};}};
      },
      transaction(scope,mode,options){
        if(h.fault.transactionThrow)throw Error(SECRET);
        assert.deepEqual(scope,[STORE]);
        const tx={scope,mode,options,pending:[],calls:[],view:null,done:false,aborted:false,
          get durability(){if(h.fault.durabilityGetterThrow)throw Error(SECRET);return own(h.fault,'durability')?h.fault.durability:'strict';},
          abort(){this.aborted=true;this.done=true;if(typeof this.onabort==='function')this.onabort();},
          complete(){
            if(this.done)return;this.done=true;
            if(mode==='readwrite'&&this.view)h.state.data=new Map(this.view);
            if(typeof this.oncomplete==='function')this.oncomplete();
          },
          objectStore(name){
            assert.equal(name,STORE);if(h.fault.objectStoreThrow)throw Error(SECRET);
            function request(kind,key,value){
              if(h.fault.methodThrow===kind)throw Error(SECRET);
              const r={kind,key,value,tx};tx.pending.push(r);tx.calls.push({kind,key,value});return r;
            }
            return {get:key=>request('get',key),count:key=>request('count',key),put:(value,key)=>request('put',key,value),
              get delete(){if(h.fault.deleteGetterThrow)throw Error(SECRET);return key=>request('delete',key);}};
          }
        };
        if(h.fault.handlerSetterThrow)Object.defineProperty(tx,'oncomplete',{set(){throw Error(SECRET);}});
        h.transactions.push(tx);return tx;
      }
    };
    h.lastDB=db;return db;
  }
  const factory={
    open(name,version){
      assert.equal(this,factory);const r={name,version,processed:false,upgradeAborted:false};r.result=database(r);
      r.transaction={abort(){r.upgradeAborted=true;if(r.onerror)r.onerror();}};h.opens.push(r);return r;
    },
    deleteDatabase(name){assert.equal(this,factory);const r={name,processed:false};h.deletes.push(r);return r;}
  };
  h.factory=factory;h.options={indexedDBFactory:factory,dbName:NAME,ownerToken:TOKEN};
  h.openSuccess=(r=h.opens.at(-1))=>{
    r.processed=true;
    if(!h.state.exists){
      r.upgradeNames=[];r.upgradeData=new Map();r.onupgradeneeded({oldVersion:0});
      if(r.upgradeAborted)return;
      h.state.exists=true;h.state.names=r.upgradeNames;h.state.data=r.upgradeData;
    }
    r.onsuccess();
  };
  h.step=tx=>{
    assert.equal(tx.done,false);if(!tx.view)tx.view=new Map(h.state.data);
    const r=tx.pending.shift();assert.ok(r,'pending request');
    if(h.fault.requestError===r.kind){if(r.onerror)r.onerror();return r;}
    let result;
    if(r.kind==='get')result=tx.view.get(r.key);
    else if(r.kind==='count')result=tx.view.has(r.key)?1:0;
    else if(r.kind==='put'){tx.view.set(r.key,r.value);result=r.key;}
    else if(r.kind==='delete'){tx.view.delete(r.key);result=undefined;}
    if(h.fault.resultGetterThrow===r.key)Object.defineProperty(r,'result',{get(){throw Error(SECRET);}});
    else r.result=result;
    if(r.onsuccess)r.onsuccess();return r;
  };
  h.finish=(tx=h.transactions.at(-1),complete=true)=>{
    let steps=0;while(!tx.done&&tx.pending.length){assert.ok(++steps<20);h.step(tx);}
    if(complete&&!tx.done)tx.complete();return tx;
  };
  h.pump=async p=>{
    let done=false,result,failure;p.then(v=>{done=true;result=v;},e=>{done=true;failure=e;});
    for(let i=0;i<100&&!done;i++){
      await tick();
      const open=h.opens.find(r=>!r.processed),tx=h.transactions.find(t=>!t.done),del=h.deletes.find(r=>!r.processed);
      if(open)h.openSuccess(open);
      else if(tx)h.finish(tx);
      else if(del){del.processed=true;h.state.exists=false;h.state.names=[];h.state.data.clear();del.onsuccess();}
      else await tick();
    }
    assert.equal(done,true,'bounded controlled operation completion');if(failure)throw failure;return result;
  };
  return h;
}
async function opened(options){const h=harness(options);h.handle=await h.pump(Provider.openOwned(h.options));return h;}
function draftRecord(){
  const layout=Core.defaultVillageLayout(),next=JSON.parse(JSON.stringify(layout));next.items[0].x++;
  return {version:1,requestId:'owned-outbox-controlled',payload:{snapshot:{revision:7,currentLayout:layout},
    proposal:{version:1,expectedRevision:7,requestedLayout:next}},receipt:{version:1,requestId:'owned-outbox-controlled',stage:'unsubmitted',journalRevision:1}};
}

test('frozen explicit API has no implicit storage entry point',()=>{
  assert.equal(Provider.version,1);assert.ok(Object.isFrozen(Provider));
  assert.deepEqual(Object.keys(Provider).sort(),['createOwned','deleteOwned','openOwned','version']);
});
test('only exact own-data options and the separate QA prefix are accepted',async()=>{
  const h=harness();let getterCalls=0;
  for(const value of [undefined,{}, {...h.options,extra:true},{...h.options,dbName:'pet-contractor-idb-qa-old'},
    {...h.options,dbName:'pet-game-save'},{...h.options,ownerToken:'owner'},
    {indexedDBFactory:h.factory,get dbName(){getterCalls++;return NAME;},ownerToken:TOKEN}])await rejects(Provider.openOwned(value),'invalid_options');
  assert.equal(getterCalls,0);assert.equal(h.opens.length,0);
});
test('deleteOwned captures options and factory methods once with original receiver',async()=>{
  const h=harness();let opens=0,deletes=0;const originalOpen=h.factory.open,originalDelete=h.factory.deleteDatabase;
  Object.defineProperty(h.factory,'open',{configurable:true,get(){opens++;return opens===1?originalOpen:()=>{throw Error(SECRET);};}});
  Object.defineProperty(h.factory,'deleteDatabase',{get(){deletes++;return deletes===1?originalDelete:()=>{throw Error(SECRET);};}});
  const input={...h.options},p=Provider.deleteOwned(input);input.dbName='pet-game-save';input.ownerToken='b'.repeat(64);
  const reply=await h.pump(p);assert.equal(reply.status,'deleted_owned_outbox_qa');assert.equal(opens,1);assert.equal(deletes,1);
  assert.equal(h.deletes[0].name,NAME);assert.equal(h.closes,1);assert.equal(h.state.exists,false);
});
test('createOwned installs exactly one dedicated store and ownership record',async()=>{
  const h=harness({exists:false}),handle=await h.pump(Provider.createOwned(h.options));
  assert.deepEqual(h.createdStores,[STORE]);assert.deepEqual(h.state.names,[STORE]);assert.deepEqual(h.state.data.get(META),metadata());
  assert.equal(h.state.data.has(SLOT),false);assert.equal(handle.diagnostics().ownershipTransactions,1);assert.equal(handle.diagnostics().readTransactions,0);
});
test('existing create and missing open never reset or initialize a database',async()=>{
  const existing=harness({slotPresent:true,slot:'kept'}),p=Provider.createOwned(existing.options);existing.openSuccess();
  await rejects(p,'already_exists');assert.equal(existing.state.data.get(SLOT),'kept');assert.equal(existing.transactions.length,0);
  const missing=harness({exists:false});await rejects(missing.pump(Provider.openOwned(missing.options)),'missing_database');
  assert.equal(missing.state.exists,false);assert.equal(missing.opens[0].upgradeAborted,true);assert.deepEqual(missing.createdStores,[]);
});
test('schema and ownership mismatch close validation handles before raw-slot access',async()=>{
  const schema=harness();schema.state.names=['unsubmitted_qa'];await rejects(schema.pump(Provider.openOwned(schema.options)),'schema_mismatch');
  assert.equal(schema.transactions.length,0);assert.equal(schema.closes,1);
  const owner=harness();owner.state.data.set(META,{...metadata(),ownerToken:'b'.repeat(64)});
  await rejects(owner.pump(Provider.openOwned(owner.options)),'ownership_mismatch');assert.equal(owner.closes,1);
  assert.deepEqual(owner.transactions[0].calls.map(x=>x.key),[META]);
});
test('late database capture failure uses close captured once and never retries a throwing close getter',async()=>{
  const late=harness();let closeReads=0,transactionReads=0,closeCalls=0;
  const p=Provider.openOwned(late.options),db=late.lastDB;
  Object.defineProperty(db,'close',{get(){closeReads++;return function(){assert.equal(this,db);closeCalls++;};}});
  Object.defineProperty(db,'transaction',{get(){transactionReads++;throw Error(SECRET);}});
  late.openSuccess();await rejects(p,'schema_mismatch');
  assert.equal(closeReads,1);assert.equal(transactionReads,1);assert.equal(closeCalls,1);assert.equal(late.transactions.length,0);
  const throwing=harness();let failedCloseReads=0;const q=Provider.openOwned(throwing.options);
  Object.defineProperty(throwing.lastDB,'close',{get(){failedCloseReads++;throw Error(SECRET);}});
  throwing.openSuccess();await rejects(q,'schema_mismatch');assert.equal(failedCloseReads,1);assert.equal(throwing.closes,0);
});
test('read preserves exact raw Unicode and waits for readonly completion',async()=>{
  const raw=' { "note" : "雪" }\n',h=await opened({slotPresent:true,slot:raw});let settled=false;
  const p=h.handle.repository.read().then(v=>{settled=true;return v;}),tx=h.finish(h.transactions.at(-1),false);
  await tick();assert.equal(settled,false);assert.equal(tx.mode,'readonly');tx.complete();assert.equal(await p,raw);
});
test('absence requires count0 and stored undefined/null/object/oversize remains corrupt',async()=>{
  const empty=await opened();assert.equal(await empty.pump(empty.handle.repository.read()),null);
  assert.deepEqual(empty.transactions.at(-1).calls.map(x=>x.kind),['get','get','count']);
  for(const slot of [undefined,null,{},42,'x'.repeat(1000001)]){
    const h=await opened({slotPresent:true,slot});await rejects(h.pump(h.handle.repository.read()),'corrupt_slot');
    assert.equal(h.state.data.has(SLOT),true);assert.equal(h.handle.diagnostics().deleteRequestSuccesses,0);
  }
});
test('enqueue CAS uses one strict transaction and request success is not an ACK',async()=>{
  const h=await opened();let settled=false;const p=h.handle.repository.compareAndSwap(null,'raw-next').then(v=>{settled=true;return v;});
  const tx=h.finish(h.transactions.at(-1),false);await tick();assert.equal(settled,false);
  assert.equal(tx.mode,'readwrite');assert.deepEqual(tx.options,{durability:'strict'});
  assert.deepEqual(tx.calls.map(x=>[x.kind,x.key]),[['get',META],['get',SLOT],['count',SLOT],['put',SLOT]]);
  assert.equal(h.handle.diagnostics().putRequestSuccesses,1);assert.equal(h.handle.diagnostics().committedAcknowledgements,0);
  assert.equal(h.state.data.has(SLOT),false);tx.complete();assert.equal(await p,'committed');assert.equal(h.state.data.get(SLOT),'raw-next');
});
test('nullable CAS deletes the key, not a stored null, and waits for completion',async()=>{
  const h=await opened({slotPresent:true,slot:'queued'});let settled=false;
  const p=h.handle.repository.compareAndSwap('queued',null).then(v=>{settled=true;return v;}),tx=h.finish(h.transactions.at(-1),false);
  await tick();assert.equal(settled,false);assert.equal(h.state.data.get(SLOT),'queued');
  assert.deepEqual(tx.calls.filter(x=>['put','delete'].includes(x.kind)),[{kind:'delete',key:SLOT,value:undefined}]);
  tx.complete();assert.equal(await p,'committed');assert.equal(h.state.data.has(SLOT),false);assert.equal(await h.pump(h.handle.repository.read()),null);
});
test('same-value and empty-to-empty CAS are transaction outcomes, not changed-record counts',async()=>{
  const h=await opened();assert.equal(await h.pump(h.handle.repository.compareAndSwap(null,null)),'committed');
  assert.equal(h.state.data.has(SLOT),false);assert.equal(h.handle.diagnostics().deleteRequestSuccesses,1);
  assert.equal(await h.pump(h.handle.repository.compareAndSwap(null,'same')),'committed');
  assert.equal(await h.pump(h.handle.repository.compareAndSwap('same','same')),'committed');assert.equal(h.state.data.get(SLOT),'same');
});
test('exact-raw mismatch completes conflict with no put/delete or early result',async()=>{
  const h=await opened({slotPresent:true,slot:'{ "a":1 }'});let settled=false;
  const p=h.handle.repository.compareAndSwap('{"a":1}',null).then(v=>{settled=true;return v;}),tx=h.finish(h.transactions.at(-1),false);
  assert.equal(tx.calls.filter(x=>['put','delete'].includes(x.kind)).length,0);await tick();assert.equal(settled,false);
  tx.complete();assert.equal(await p,'conflict');assert.equal(h.handle.diagnostics().conflictCompletions,1);assert.equal(h.handle.diagnostics().committedAcknowledgements,0);
});
test('abort after put request success never yields committed or changes backing state',async()=>{
  const h=await opened(),p=h.handle.repository.compareAndSwap(null,'candidate'),tx=h.finish(h.transactions.at(-1),false);tx.abort();
  await rejects(p,'transaction_aborted');assert.equal(h.handle.diagnostics().putRequestSuccesses,1);
  assert.equal(h.handle.diagnostics().committedAcknowledgements,0);assert.equal(h.state.data.has(SLOT),false);
});
test('abort after delete request success preserves the previous record and no ACK',async()=>{
  const h=await opened({slotPresent:true,slot:'queued'}),p=h.handle.repository.compareAndSwap('queued',null),tx=h.finish(h.transactions.at(-1),false);tx.abort();
  await rejects(p,'transaction_aborted');assert.equal(h.handle.diagnostics().deleteRequestSuccesses,1);
  assert.equal(h.handle.diagnostics().committedAcknowledgements,0);assert.equal(h.state.data.get(SLOT),'queued');
});
test('transaction complete without a validated operation outcome rejects',async()=>{
  const h=await opened(),p=h.handle.repository.compareAndSwap(null,'candidate');h.transactions.at(-1).complete();
  await rejects(p,'transaction_outcome_missing');assert.equal(h.handle.diagnostics().committedAcknowledgements,0);
  const read=h.handle.repository.read();h.transactions.at(-1).complete();await rejects(read,'transaction_outcome_missing');
});
test('strict durability is both requested and checked without relaxed fallback',async()=>{
  for(const value of ['relaxed','default',undefined]){
    const h=await opened();h.fault.durability=value;await rejects(h.handle.repository.compareAndSwap(null,'x'),'strict_durability_unavailable');
    assert.deepEqual(h.transactions.at(-1).options,{durability:'strict'});assert.equal(h.transactions.at(-1).calls.length,0);
  }
  const h=await opened();h.fault.durabilityGetterThrow=true;await rejects(h.handle.repository.compareAndSwap(null,'x'),'transaction_failed');
});
test('asynchronous native getters and write methods fail with static sanitized errors',async()=>{
  for(const key of [META,SLOT]){
    const h=await opened({slotPresent:true,slot:'raw'});h.fault.resultGetterThrow=key;
    await rejects(h.pump(h.handle.repository.read()),key===META?'ownership_read_failed':'read_failed');assert.equal(h.state.data.get(SLOT),'raw');
  }
  const h=await opened({slotPresent:true,slot:'raw'});h.fault.deleteGetterThrow=true;
  await rejects(h.pump(h.handle.repository.compareAndSwap('raw',null)),'write_failed');assert.equal(h.state.data.get(SLOT),'raw');
});
test('request errors abort reads/writes without false empty, conflict or committed',async()=>{
  const read=await opened();read.fault.requestError='get';await rejects(read.pump(read.handle.repository.read()),'ownership_read_failed');
  const write=await opened();write.fault.requestError='put';await rejects(write.pump(write.handle.repository.compareAndSwap(null,'x')),'write_failed');
  assert.equal(write.handle.diagnostics().committedAcknowledgements,0);assert.equal(write.state.data.has(SLOT),false);
});
test('closed/versionchange handles reject and a close during open cannot return a usable handle',async()=>{
  const h=await opened();h.lastDB.onversionchange();assert.equal(h.handle.diagnostics().closed,true);h.handle.close();assert.equal(h.closes,1);
  await rejects(h.handle.repository.read(),'connection_closed');await rejects(h.handle.repository.compareAndSwap(null,'x'),'connection_closed');
  const pending=harness(),p=Provider.openOwned(pending.options);pending.openSuccess();pending.lastDB.onversionchange();pending.finish();await rejects(p,'connection_closed');
});
test('owned cleanup checks metadata only and can delete a corrupt raw queue',async()=>{
  const h=harness({slotPresent:true,slot:null}),reply=await h.pump(Provider.deleteOwned(h.options));
  assert.equal(reply.status,'deleted_owned_outbox_qa');assert.deepEqual(h.transactions[0].calls.map(x=>x.key),[META]);assert.equal(h.state.exists,false);
  const wrong=harness({slotPresent:true,slot:null});wrong.state.data.set(META,{...metadata(),ownerToken:'b'.repeat(64)});
  await rejects(wrong.pump(Provider.deleteOwned(wrong.options)),'ownership_mismatch');assert.equal(wrong.deletes.length,0);assert.equal(wrong.state.exists,true);
});
test('cleanup failure and blocked callbacks reject once without changing another namespace',async()=>{
  for(const event of ['onerror','onblocked']){
    const h=harness(),p=Provider.deleteOwned(h.options);h.openSuccess();h.finish();await tick();await tick();
    assert.equal(h.deletes.length,1);h.deletes[0][event]();await rejects(p,event==='onblocked'?'delete_blocked':'delete_failed');
    h.deletes[0].onsuccess();assert.equal(h.state.exists,true);assert.equal(h.deletes[0].name,NAME);
  }
});
test('late open success after blocked is closed and host callback failures are sanitized',async()=>{
  const h=harness(),p=Provider.openOwned(h.options);h.opens[0].onblocked();await rejects(p,'open_blocked');h.openSuccess();assert.equal(h.closes,1);assert.equal(h.transactions.length,0);
  const bad=harness();bad.fault.handlerSetterThrow=true;await rejects(bad.pump(Provider.openOwned(bad.options)),'transaction_failed');assert.equal(bad.closes,1);
});
test('invalid raw inputs are rejected before transactions and diagnostics are frozen detached data',async()=>{
  const h=await opened(),n=h.transactions.length;
  for(const pair of [[undefined,'x'],[null,undefined],[{},null],[null,{}],['x'.repeat(1000001),null],[null,'x'.repeat(1000001)]])await rejects(h.handle.repository.compareAndSwap(...pair),'invalid_raw_value');
  assert.equal(h.transactions.length,n);const d=h.handle.diagnostics();assert.ok(Object.isFrozen(d));assert.equal('ownerToken' in d,false);
  assert.throws(()=>{d.casTransactions=99;},TypeError);assert.equal(h.handle.diagnostics().casTransactions,0);assert.ok(Object.isFrozen(h.handle.repository));
});
test('two handles under serialized controlled host yield one delete ACK and one conflict',async()=>{
  const h=await opened({slotPresent:true,slot:'queued'}),other=await h.pump(Provider.openOwned(h.options));
  const a=h.handle.repository.compareAndSwap('queued',null),b=other.repository.compareAndSwap('queued',null);
  h.finish(h.transactions.at(-2));h.finish(h.transactions.at(-1));assert.deepEqual(await Promise.all([a,b]),['committed','conflict']);
  assert.equal(h.state.data.has(SLOT),false);assert.equal(h.handle.diagnostics().deleteRequestSuccesses,1);assert.equal(other.diagnostics().deleteRequestSuccesses,0);
});
test('existing Outbox and Withdrawal integrate while the original Journal stays unsubmitted and unchanged',async()=>{
  const h=await opened(),record=draftRecord(),raw=JSON.stringify(record);let journalWrites=0;
  const journal=Journal.create({repository:{async read(){return raw;},async compareAndSwap(){journalWrites++;throw Error('journal_write_forbidden');}}});
  const outbox=Outbox.create({journal,repository:h.handle.repository});const queued=await h.pump(outbox.enqueue({snapshotJson:JSON.stringify(record.payload.snapshot)}));
  assert.equal(queued.status,'queued');assert.equal(queued.queued.record.receipt.stage,'unsubmitted');
  const removal=Withdrawal.create({repository:h.handle.repository}),inspected=await h.pump(removal.inspect());
  assert.equal(inspected.status,'stored_local');const result=await h.pump(removal.withdraw({expectedQueuedJson:inspected.expectedQueuedJson}));
  assert.equal(result.status,'withdrawn_local');assert.equal(result.scope,'explicit_local_preparation');assert.equal(journalWrites,0);assert.equal(JSON.stringify(record),raw);
});
test('unknown ACK and later empty read/retry do not attribute prior deletion or add a second CAS',async()=>{
  const h=await opened(),record=draftRecord(),journal=Journal.create({repository:{async read(){return JSON.stringify(record);},async compareAndSwap(){throw Error('journal_write_forbidden');}}});
  const queued=await h.pump(Outbox.create({journal,repository:h.handle.repository}).enqueue({snapshotJson:JSON.stringify(record.payload.snapshot)}));assert.equal(queued.status,'queued');
  const plain=Withdrawal.create({repository:h.handle.repository}),before=await h.pump(plain.inspect());
  const unknown=Withdrawal.create({repository:{read:()=>h.handle.repository.read(),async compareAndSwap(expected,next){await h.handle.repository.compareAndSwap(expected,next);throw Error(SECRET);}}});
  const result=await h.pump(unknown.withdraw({expectedQueuedJson:before.expectedQueuedJson}));assert.equal(result.error,'write_outcome_unknown');
  const count=h.handle.diagnostics().casTransactions;assert.equal((await h.pump(plain.inspect())).status,'empty_unattributed');
  assert.equal((await h.pump(plain.withdraw({expectedQueuedJson:before.expectedQueuedJson}))).error,'queue_empty_unattributed');assert.equal(h.handle.diagnostics().casTransactions,count);
});

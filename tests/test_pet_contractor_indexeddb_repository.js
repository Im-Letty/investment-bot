'use strict';
// Controlled event/fault stubs test the adapter contract, not real IndexedDB isolation.
// Actual cross-tab atomicity, reopen and reload require separate browser observations.
const test=require('node:test');
const assert=require('node:assert/strict');
const Provider=require('../static/pet-contractor-indexeddb-repository.js');
const Journal=require('../static/pet-contractor-draft-journal.js');
const Core=require('../static/pet-game-core.js');
const NAME='pet-contractor-idb-qa-20261101-0123456789abcdef0123456789abcdef';
const TOKEN='a'.repeat(64),STORE='unsubmitted_qa';
const metadata=()=>({version:1,kind:'contractor-unsubmitted-qa',dbName:NAME,ownerToken:TOKEN});
function harness(){
  const all={opens:[],deletes:[],transactions:[],closes:0,upgrades:[],createdStores:[]};
  const db={name:NAME,version:1,objectStoreNames:Object.assign([STORE],{contains(x){return this.includes(x);}}),
    close(){all.closes++;},
    createObjectStore(name){all.createdStores.push(name);return {add(value,key){all.upgrades.push({value,key});}};},
    transaction(scope,mode,options){
      if(all.transactionThrow)throw Error('private_raw_failure_do_not_leak');
      const tx={scope,mode,options,gets:[],puts:[],aborted:false,durability:all.durability||'strict',
        abort(){this.aborted=true;if(this.onabort)this.onabort();},
        objectStore(name){assert.equal(name,STORE);return {
          get(key){if(all.getThrow)throw Error('private_get_failure');const r={key};tx.gets.push(r);return r;},
          put(value,key){if(all.putThrow)throw Error('private_put_failure');const r={value,key};tx.puts.push(r);return r;}
        };},
        successGet(number,value){const r=this.gets[number];assert.ok(r);r.result=value;r.onsuccess();},
        complete(){this.oncomplete();}
      };
      all.transactions.push(tx);return tx;
    }};
  const factory={
    open(name,version){const r={name,version,result:db,transaction:{abort(){r.upgradeAborted=true;if(r.onerror)r.onerror();}}};all.opens.push(r);return r;},
    deleteDatabase(name){const r={name};all.deletes.push(r);return r;}
  };
  all.db=db;all.factory=factory;all.options={indexedDBFactory:factory,dbName:NAME,ownerToken:TOKEN};
  return all;
}
function finishRead(h,value=undefined,meta=metadata()){
  const tx=h.transactions.at(-1);tx.successGet(0,meta);
  if(!tx.aborted){tx.successGet(1,value);if(!tx.aborted)tx.complete();}
  return tx;
}
async function opened(){
  const h=harness(),pending=Provider.openOwned(h.options);
  h.opens[0].onsuccess();finishRead(h);h.handle=await pending;return h;
}
function fixture(){const layout=Core.defaultVillageLayout();return {requestId:'idb-fault-fixture',
  snapshotJson:JSON.stringify({revision:7,currentLayout:layout}),
  proposalJson:JSON.stringify({version:1,expectedRevision:7,requestedLayout:layout})};}
const tick=()=>Promise.resolve();

test('exports are frozen and have no implicit storage entry point',()=>{
  assert.ok(Object.isFrozen(Provider));assert.equal(Provider.version,1);
  assert.deepEqual(Object.keys(Provider).sort(),['createOwned','deleteOwned','openOwned','version']);
});
test('missing factory/name/capability rejects before open',async()=>{
  for(const opts of [undefined,{}, {indexedDBFactory:{},dbName:NAME,ownerToken:TOKEN}])
    await assert.rejects(Provider.openOwned(opts),/idb_invalid_options/);
});
test('non-QA names, wrong token and unknown option fields fail closed',async()=>{
  const h=harness();
  for(const opts of [{...h.options,dbName:'pet-game-save'},{...h.options,ownerToken:'owner'},
    {...h.options,extra:true}])await assert.rejects(Provider.createOwned(opts),/idb_invalid_options/);
  assert.equal(h.opens.length,0);
});
test('option accessors are captured once and invalid accessor failure is sanitized',async()=>{
  const h=harness();let calls=0;
  const opts={indexedDBFactory:h.factory,get dbName(){calls++;return NAME;},ownerToken:TOKEN};
  const p=Provider.openOwned(opts);h.opens[0].onsuccess();finishRead(h);const owned=await p;
  assert.equal(calls,1);owned.close();
  await assert.rejects(Provider.openOwned({get indexedDBFactory(){throw Error('sensitive');},dbName:NAME,ownerToken:TOKEN}),/idb_invalid_options/);
});
test('new-only creation uses one versioned dedicated store and ownership metadata',async()=>{
  const h=harness(),p=Provider.createOwned(h.options),r=h.opens[0];
  r.onupgradeneeded({oldVersion:0});r.onsuccess();finishRead(h);const owned=await p;
  assert.equal(r.name,NAME);assert.equal(r.version,1);assert.deepEqual(h.createdStores,[STORE]);
  assert.deepEqual(h.upgrades,[{value:metadata(),key:'ownership'}]);owned.close();
});
test('createOwned cannot adopt an existing database',async()=>{
  const h=harness(),p=Provider.createOwned(h.options);h.opens[0].onsuccess();
  await assert.rejects(p,/idb_already_exists/);assert.equal(h.transactions.length,0);assert.equal(h.closes,1);
});
test('openOwned missing database aborts upgrade without creating metadata',async()=>{
  const h=harness(),p=Provider.openOwned(h.options);h.opens[0].onupgradeneeded({oldVersion:0});
  await assert.rejects(p,/idb_missing_database/);assert.equal(h.opens[0].upgradeAborted,true);
  assert.deepEqual(h.upgrades,[]);assert.deepEqual(h.createdStores,[]);
});
test('unexpected upgrade is aborted, never migrated',async()=>{
  const h=harness(),p=Provider.createOwned(h.options);h.opens[0].onupgradeneeded({oldVersion:1});
  await assert.rejects(p,/idb_unexpected_upgrade/);assert.deepEqual(h.createdStores,[]);
});
test('wrong database schema rejects before reading journal',async()=>{
  const h=harness();h.db.objectStoreNames=Object.assign(['other'],{contains(){return false;}});
  const p=Provider.openOwned(h.options);h.opens[0].onsuccess();
  await assert.rejects(p,/idb_schema_mismatch/);assert.equal(h.transactions.length,0);assert.equal(h.closes,1);
});
test('wrong owner metadata aborts validation and closes the handle',async()=>{
  const h=harness(),p=Provider.openOwned(h.options);h.opens[0].onsuccess();
  finishRead(h,undefined,{...metadata(),ownerToken:'b'.repeat(64)});
  await assert.rejects(p,/idb_ownership_mismatch/);assert.equal(h.closes,1);
  assert.equal(h.transactions[0].gets.length,1);
});
test('read resolves absence only after readonly transaction complete',async()=>{
  const h=await opened();let settled=false;
  const p=h.handle.repository.read().then(x=>{settled=true;return x;});
  const tx=h.transactions.at(-1);tx.successGet(0,metadata());tx.successGet(1,undefined);
  await tick();assert.equal(settled,false);assert.equal(tx.mode,'readonly');
  tx.complete();assert.equal(await p,null);
});
test('read preserves exact stored string rather than parsing or reserializing it',async()=>{
  const h=await opened(),p=h.handle.repository.read(),raw=' { "x" : 1 }\n';finishRead(h,raw);
  assert.equal(await p,raw);
});
test('stored null or object is corrupt, never converted to empty',async()=>{
  for(const bad of [null,{},42]){
    const h=await opened(),p=h.handle.repository.read();finishRead(h,bad);
    await assert.rejects(p,/idb_corrupt_slot/);
  }
});
test('CAS read compare and put use one readwrite transaction with strict durability',async()=>{
  const h=await opened(),before=h.transactions.length,p=h.handle.repository.compareAndSwap(null,'raw-next');
  const tx=h.transactions.at(-1);tx.successGet(0,metadata());tx.successGet(1,undefined);
  assert.equal(h.transactions.length,before+1);assert.deepEqual(tx.scope,[STORE]);assert.equal(tx.mode,'readwrite');
  assert.deepEqual(tx.options,{durability:'strict'});assert.deepEqual(tx.puts.map(x=>[x.value,x.key]),[['raw-next','draft']]);
  tx.complete();assert.equal(await p,'committed');
});
test('put request success is not a commit acknowledgement',async()=>{
  const h=await opened();let settled=false;
  const p=h.handle.repository.compareAndSwap(null,'candidate').then(x=>{settled=true;return x;});
  const tx=h.transactions.at(-1);tx.successGet(0,metadata());tx.successGet(1,undefined);tx.puts[0].onsuccess();
  await tick();assert.equal(settled,false);assert.equal(h.handle.diagnostics().writeRequestSuccesses,1);
  assert.equal(h.handle.diagnostics().committedAcknowledgements,0);
  tx.complete();assert.equal(await p,'committed');assert.equal(h.handle.diagnostics().committedAcknowledgements,1);
});
test('abort after put success never returns committed',async()=>{
  const h=await opened(),p=h.handle.repository.compareAndSwap(null,'candidate');
  const tx=h.transactions.at(-1);tx.successGet(0,metadata());tx.successGet(1,undefined);tx.puts[0].onsuccess();tx.abort();
  await assert.rejects(p,/idb_transaction_aborted/);assert.equal(h.handle.diagnostics().committedAcknowledgements,0);
  assert.equal(h.handle.diagnostics().aborts,1);
});
test('exact raw mismatch returns conflict only on complete without a put',async()=>{
  const h=await opened();let settled=false;
  const p=h.handle.repository.compareAndSwap('{"a":1}','other').then(x=>{settled=true;return x;});
  const tx=h.transactions.at(-1);tx.successGet(0,metadata());tx.successGet(1,'{ "a":1 }');
  assert.equal(tx.puts.length,0);await tick();assert.equal(settled,false);
  tx.complete();assert.equal(await p,'conflict');assert.equal(h.handle.diagnostics().conflictCompletions,1);
});
test('invalid CAS values and oversized strings do not create a transaction',async()=>{
  const h=await opened(),n=h.transactions.length;
  for(const pair of [[undefined,'x'],[null,null],[null,{}],[null,'x'.repeat(1000001)],['x'.repeat(1000001),'x']])
    await assert.rejects(h.handle.repository.compareAndSwap(...pair),/idb_invalid_raw_value/);
  assert.equal(h.transactions.length,n);
});
test('strict durability unavailable aborts rather than silently falling back',async()=>{
  const h=await opened();h.durability='relaxed';const p=h.handle.repository.compareAndSwap(null,'x');
  await assert.rejects(p,/idb_strict_durability_unavailable/);assert.equal(h.transactions.at(-1).aborted,true);
  assert.equal(h.transactions.at(-1).gets.length,0);
});
test('synchronous transaction failure is sanitized and creates no acknowledgement',async()=>{
  const h=await opened();h.transactionThrow=true;
  await assert.rejects(h.handle.repository.compareAndSwap(null,'x'),/^Error: idb_transaction_unavailable$/);
  assert.equal(h.handle.diagnostics().committedAcknowledgements,0);
});
test('synchronous put failure aborts with no success acknowledgement',async()=>{
  const h=await opened();h.putThrow=true;const p=h.handle.repository.compareAndSwap(null,'x');
  const tx=h.transactions.at(-1);tx.successGet(0,metadata());tx.successGet(1,undefined);
  await assert.rejects(p,/idb_write_failed/);assert.equal(tx.aborted,true);
});
test('transaction error then abort is sanitized and does not claim an empty read',async()=>{
  const h=await opened(),p=h.handle.repository.read(),tx=h.transactions.at(-1);tx.onerror();tx.abort();
  await assert.rejects(p,/idb_transaction_failed/);
});
test('closed handle refuses new work and close is idempotent',async()=>{
  const h=await opened();h.handle.close();h.handle.close();const n=h.transactions.length;
  await assert.rejects(h.handle.repository.read(),/idb_connection_closed/);
  await assert.rejects(h.handle.repository.compareAndSwap(null,'x'),/idb_connection_closed/);
  assert.equal(h.transactions.length,n);assert.equal(h.closes,1);
});
test('versionchange closes the connection and prevents new transactions',async()=>{
  const h=await opened();h.db.onversionchange();assert.equal(h.closes,1);
  await assert.rejects(h.handle.repository.read(),/idb_connection_closed/);
});
test('blocked open rejects and any late result is closed',async()=>{
  const h=harness(),p=Provider.openOwned(h.options),r=h.opens[0];r.onblocked();
  await assert.rejects(p,/idb_open_blocked/);r.onsuccess();assert.equal(h.closes,1);assert.equal(h.transactions.length,0);
});
test('deleteOwned validates exact existing ownership and closes before deleting',async()=>{
  const h=harness(),p=Provider.deleteOwned(h.options);assert.equal(h.deletes.length,0);
  h.opens[0].onsuccess();finishRead(h);await tick();await tick();
  assert.equal(h.closes,1);assert.equal(h.deletes.length,1);assert.equal(h.deletes[0].name,NAME);
  h.deletes[0].onsuccess();assert.deepEqual(await p,{status:'deleted_owned_qa',dbName:NAME});
});
test('deleteOwned wrong ownership never invokes deleteDatabase',async()=>{
  const h=harness(),p=Provider.deleteOwned(h.options);h.opens[0].onsuccess();
  finishRead(h,undefined,{...metadata(),ownerToken:'b'.repeat(64)});
  await assert.rejects(p,/idb_ownership_mismatch/);assert.equal(h.deletes.length,0);
});
test('deleteOwned missing namespace aborts creation and never deletes',async()=>{
  const h=harness(),p=Provider.deleteOwned(h.options);h.opens[0].onupgradeneeded({oldVersion:0});
  await assert.rejects(p,/idb_missing_database/);assert.equal(h.deletes.length,0);assert.equal(h.upgrades.length,0);
});
test('blocked deletion remains an error rather than a successful cleanup',async()=>{
  const h=harness(),p=Provider.deleteOwned(h.options);h.opens[0].onsuccess();finishRead(h);
  await tick();await tick();h.deletes[0].onblocked();await assert.rejects(p,/idb_delete_blocked/);
});
test('unchanged journal maps post-write abort to unknown and reads again before reconciliation',async()=>{
  const h=await opened(),journal=Journal.create({repository:h.handle.repository});
  const p=journal.recordDraft(fixture());finishRead(h);await tick();await tick();
  const tx=h.transactions.at(-1);assert.equal(tx.mode,'readwrite');tx.successGet(0,metadata());tx.successGet(1,undefined);
  const committedRaw=tx.puts[0].value;tx.puts[0].onsuccess();tx.abort();
  assert.deepEqual(await p,{ok:false,error:'write_outcome_unknown'});
  const transactionsBefore=h.transactions.length,reconcile=journal.recordDraft(fixture());finishRead(h,committedRaw);
  const answer=await reconcile;assert.equal(answer.status,'replayed');assert.equal(answer.record.receipt.stage,'unsubmitted');
  assert.equal(h.transactions.length,transactionsBefore+1);
  // This supplies an explicitly controlled later read; it does not assert abort persisted data.
});

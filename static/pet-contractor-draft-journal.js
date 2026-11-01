/* One unsubmitted draft slot. No game action, quote, layout write or default storage. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./pet-game-core.js'),require('./pet-contractor-intent.js'));
  else root.PetContractorDraftJournal=factory(root.PetGameCore,root.PetContractorIntent);
}(typeof globalThis!=='undefined'?globalThis:this,function(Core,Intent){
  'use strict';
  if(!Core||typeof Core.getVillageLayout!=='function'||!Intent||typeof Intent.inspect!=='function')throw Error('draft_journal_dependency_unavailable');
  var MAX_JSON_CHARS=1000000;
  function exact(value,keys){
    return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
      Reflect.ownKeys(value).length===keys.length&&keys.every(function(key){return Object.prototype.hasOwnProperty.call(value,key);});
  }
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function freeze(value){
    if(value&&typeof value==='object'){Object.keys(value).forEach(function(key){freeze(value[key]);});Object.freeze(value);}
    return value;
  }
  function canonical(value){
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(function(key){return JSON.stringify(key)+':'+canonical(value[key]);}).join(',')+'}';
    return JSON.stringify(value);
  }
  function failure(code){return Object.freeze({ok:false,error:code});}
  function result(status,record){return freeze({ok:true,status:status,record:record===null?null:clone(record)});}
  function requestId(value){return typeof value==='string'&&value.length>=1&&value.length<=128&&/^[A-Za-z0-9]/.test(value)&&!/[^A-Za-z0-9._:-]/.test(value);}
  function normalize(input){
    try{
      if(!exact(input,['requestId','snapshotJson','proposalJson']))return failure('invalid_request');
      // A caller may supply accessors. Capture each field once, then validate
      // and persist only these values rather than rereading changing getters.
      var id=input.requestId,snapshotJson=input.snapshotJson,proposalJson=input.proposalJson;
      if(!requestId(id))return failure('invalid_request');
      var inspection=Intent.inspect(snapshotJson,proposalJson);
      if(!inspection.ok)return failure(inspection.error);
      var snapshot=JSON.parse(snapshotJson);
      // Explicit caller-supplied base only. This never reads the owner's current game.
      var current=Core.getVillageLayout({villageLayout:snapshot.currentLayout});
      return {ok:true,requestId:id,payload:{
        snapshot:{revision:snapshot.revision,currentLayout:current},
        proposal:clone(inspection.draft)
      }};
    }catch(error){return failure('invalid_request');}
  }
  function validateStored(raw){
    if(typeof raw!=='string'||raw.length>MAX_JSON_CHARS)throw Error('corrupt_journal');
    var value=JSON.parse(raw);
    if(!exact(value,['version','requestId','payload','receipt'])||value.version!==1||!requestId(value.requestId)||
      !exact(value.payload,['snapshot','proposal'])||
      !exact(value.receipt,['version','requestId','stage','journalRevision'])||value.receipt.version!==1||
      value.receipt.requestId!==value.requestId||value.receipt.stage!=='unsubmitted'||value.receipt.journalRevision!==1)throw Error('corrupt_journal');
    var checked=normalize({requestId:value.requestId,snapshotJson:JSON.stringify(value.payload.snapshot),proposalJson:JSON.stringify(value.payload.proposal)});
    if(!checked.ok||canonical(checked.payload)!==canonical(value.payload))throw Error('corrupt_journal');
    return value;
  }
  function create(options){
    if(!exact(options,['repository'])||!options.repository||typeof options.repository.read!=='function'||
      typeof options.repository.compareAndSwap!=='function')throw Error('journal_repository_unavailable');
    var repository=options.repository;
    // The host MUST implement one atomic operation across every client of this
    // dedicated repository: compare the exact raw value and write only if equal.
    // A get-then-set wrapper is not this capability. 'committed' is the host's
    // acknowledgement; its durability/namespace/lifetime remain the host contract.
    async function read(){
      var raw;
      try{raw=await repository.read();}catch(error){return failure('repository_read_failed');}
      if(raw===null)return {ok:true,raw:null,record:null};
      try{return {ok:true,raw:raw,record:validateStored(raw)};}
      catch(error){return failure('corrupt_journal');}
    }
    async function readDraft(){
      var current=await read();
      if(!current.ok)return current;
      return result(current.record===null?'empty':'recorded_unsubmitted',current.record);
    }
    async function recordDraft(input){
      var checked=normalize(input);
      if(!checked.ok)return checked;
      // Always read first, including after an earlier unknown acknowledgement.
      // There is no cached success, automatic overwrite, delete or CAS retry loop.
      var current=await read();
      if(!current.ok)return current;
      if(current.record!==null){
        if(current.record.requestId===checked.requestId&&canonical(current.record.payload)===canonical(checked.payload))return result('replayed',current.record);
        return failure('journal_conflict');
      }
      var record={version:1,requestId:checked.requestId,payload:checked.payload,
        receipt:{version:1,requestId:checked.requestId,stage:'unsubmitted',journalRevision:1}};
      var next=canonical(record);
      if(next.length>MAX_JSON_CHARS)return failure('invalid_request');
      var acknowledgement;
      try{acknowledgement=await repository.compareAndSwap(current.raw,next);}
      catch(error){return failure('write_outcome_unknown');}
      if(acknowledgement==='conflict')return failure('journal_conflict');
      if(acknowledgement!=='committed')return failure('write_outcome_unknown');
      return result('recorded',record);
    }
    return Object.freeze({readDraft:readDraft,recordDraft:recordDraft});
  }
  return Object.freeze({version:1,create:create});
}));

/* Read-only comparison with explicit caller-supplied context. No owner freshness authority. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./pet-game-core.js'),require('./pet-contractor-draft-journal.js'));
  else root.PetContractorDraftReview=factory(root.PetGameCore,root.PetContractorDraftJournal);
}(typeof globalThis!=='undefined'?globalThis:this,function(Core,Journal){
  'use strict';
  if(!Core||typeof Core.getVillageLayout!=='function'||!Journal||typeof Journal.create!=='function')throw Error('draft_review_dependency_unavailable');
  var MAX_JSON_CHARS=1000000,MAX_REVISION=9000000000000;
  function exact(value,keys){
    return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
      Reflect.ownKeys(value).length===keys.length&&keys.every(function(key){return Object.prototype.hasOwnProperty.call(value,key);});
  }
  function freeze(value){
    if(value&&typeof value==='object'){Object.keys(value).forEach(function(key){freeze(value[key]);});Object.freeze(value);}
    return value;
  }
  function canonical(value){
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(function(key){return JSON.stringify(key)+':'+canonical(value[key]);}).join(',')+'}';
    return JSON.stringify(value);
  }
  function failure(code,reads){return freeze({ok:false,error:code,reads:reads});}
  function snapshot(raw){
    if(typeof raw!=='string'||raw.length>MAX_JSON_CHARS)throw Error('invalid_snapshot');
    var value=JSON.parse(raw);
    if(!exact(value,['revision','currentLayout'])||!Number.isSafeInteger(value.revision)||value.revision<0||value.revision>MAX_REVISION||
      !exact(value.currentLayout,['version','theme','items']))throw Error('invalid_snapshot');
    // The explicit wrapper prevents Core's absent-input/default projection.
    return freeze({revision:value.revision,currentLayout:Core.getVillageLayout({villageLayout:value.currentLayout})});
  }
  function captureReply(value){
    var nodes=0,active=new Set();
    function copy(current,depth){
      if(++nodes>10000||depth>16)throw Error('corrupt_journal');
      if(current===null||typeof current==='string'||typeof current==='boolean')return current;
      if(typeof current==='number'&&Number.isFinite(current))return current;
      if(!current||typeof current!=='object'||active.has(current))throw Error('corrupt_journal');
      active.add(current);
      var keys=Reflect.ownKeys(current),target=Array.isArray(current)?[]:{};
      if(Array.isArray(current)){
        var length=Object.getOwnPropertyDescriptor(current,'length').value;
        if(keys.length!==length+1||length>10000)throw Error('corrupt_journal');
        for(var i=0;i<length;i++)if(!Object.prototype.hasOwnProperty.call(current,i))throw Error('corrupt_journal');
      }
      keys.forEach(function(key){
        if(Array.isArray(current)&&key==='length')return;
        var descriptor=Object.getOwnPropertyDescriptor(current,key);
        // Do not execute response accessors, toJSON hooks, or lossy JSON coercions.
        if(typeof key!=='string'||!descriptor||!descriptor.enumerable||!Object.prototype.hasOwnProperty.call(descriptor,'value'))throw Error('corrupt_journal');
        Object.defineProperty(target,key,{value:copy(descriptor.value,depth+1),enumerable:true,writable:true,configurable:true});
      });
      active.delete(current);return target;
    }
    var result=copy(value,0);
    if(JSON.stringify(result).length>MAX_JSON_CHARS)throw Error('corrupt_journal');
    return result;
  }
  function create(options){
    var journal,readDraft;
    try{
      if(!exact(options,['journal']))throw Error('invalid_options');
      journal=options.journal;
      if(!journal||typeof journal!=='object')throw Error('invalid_journal');
      readDraft=journal.readDraft;
      if(typeof readDraft!=='function')throw Error('invalid_journal');
    }catch(error){throw Error('draft_review_journal_unavailable');}
    async function review(input){
      var reads={journal:0,revalidation:0},providedContext,rawSnapshot;
      try{
        if(!exact(input,['snapshotJson']))return failure('invalid_request',reads);
        // Capture once and validate synchronously before the first await.
        rawSnapshot=input.snapshotJson;
      }catch(error){return failure('invalid_request',reads);}
      try{providedContext=snapshot(rawSnapshot);}
      catch(error){return failure('invalid_snapshot',reads);}
      var reply;
      try{reads.journal++;reply=await readDraft.call(journal);}
      catch(error){return failure('repository_read_failed',reads);}
      try{reply=captureReply(reply);}
      catch(error){return failure('corrupt_journal',reads);}
      if(exact(reply,['ok','error'])&&reply.ok===false&&['repository_read_failed','corrupt_journal'].indexOf(reply.error)>=0)return failure(reply.error,reads);
      if(!exact(reply,['ok','status','record'])||reply.ok!==true)return failure('corrupt_journal',reads);
      if(reply.status==='empty'&&reply.record===null)return freeze({ok:true,status:'empty',record:null,providedContext:providedContext,reads:reads});
      if(reply.status!=='recorded_unsubmitted'||reply.record===null)return failure('corrupt_journal',reads);
      // Reuse the unchanged journal decoder with one isolated, explicitly injected
      // raw-string read. This adapter cannot write and never reaches host storage.
      var validated;
      try{
        var raw=JSON.stringify(reply.record),validator=Journal.create({repository:{
          async read(){reads.revalidation++;return raw;},
          async compareAndSwap(){throw Error('draft_review_write_forbidden');}
        }});
        validated=await validator.readDraft();
      }catch(error){return failure('corrupt_journal',reads);}
      if(!validated.ok||validated.status!=='recorded_unsubmitted'||!validated.record)return failure('corrupt_journal',reads);
      var record=validated.record,saved=record.payload.snapshot;
      var status=saved.revision!==providedContext.revision?'stale_revision':
        canonical(saved.currentLayout)!==canonical(providedContext.currentLayout)?'base_layout_changed':'matches_provided_context';
      return freeze({ok:true,status:status,stage:'unsubmitted',record:record,providedContext:providedContext,reads:reads});
    }
    return Object.freeze({review:review});
  }
  return Object.freeze({version:1,create:create});
}));

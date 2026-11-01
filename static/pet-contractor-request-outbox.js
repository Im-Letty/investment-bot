/* One explicit local preparation slot. No external submission or game action. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./pet-contractor-draft-review.js'),require('./pet-contractor-draft-journal.js'));
  else root.PetContractorRequestOutbox=factory(root.PetContractorDraftReview,root.PetContractorDraftJournal);
}(typeof globalThis!=='undefined'?globalThis:this,function(Review,Journal){
  'use strict';
  if(!Review||typeof Review.create!=='function'||!Journal||typeof Journal.create!=='function')throw Error('request_outbox_dependency_unavailable');
  var MAX_JSON_CHARS=1000000,SCOPE='explicit_local_preparation';
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
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function capture(value){
    var nodes=0,active=new Set();
    function copy(current,depth){
      if(++nodes>10000||depth>16)throw Error('invalid_data');
      if(current===null||typeof current==='string'||typeof current==='boolean')return current;
      if(typeof current==='number'&&Number.isFinite(current))return current;
      if(!current||typeof current!=='object'||active.has(current))throw Error('invalid_data');
      active.add(current);
      var keys=Reflect.ownKeys(current),array=Array.isArray(current),target=array?[]:{};
      if(array){
        var length=Object.getOwnPropertyDescriptor(current,'length').value;
        if(keys.length!==length+1||length>10000)throw Error('invalid_data');
        for(var i=0;i<length;i++)if(!Object.prototype.hasOwnProperty.call(current,i))throw Error('invalid_data');
      }
      keys.forEach(function(key){
        if(array&&key==='length')return;
        var descriptor=Object.getOwnPropertyDescriptor(current,key);
        if(typeof key!=='string'||!descriptor||!descriptor.enumerable||!Object.prototype.hasOwnProperty.call(descriptor,'value'))throw Error('invalid_data');
        Object.defineProperty(target,key,{value:copy(descriptor.value,depth+1),enumerable:true,writable:true,configurable:true});
      });
      active.delete(current);return target;
    }
    return copy(value,0);
  }
  function counts(){return {draftReviewCalls:0,journalReads:0,reviewRevalidationReads:0,outboxReads:0,outboxRevalidationReads:0,outboxCAS:0};}
  function failure(code,steps){return freeze({ok:false,error:code,scope:SCOPE,counts:clone(steps)});}
  function success(status,queued,freshness,steps){
    return freeze({ok:true,status:status,queued:queued===null?null:clone(queued),scope:SCOPE,freshness:freshness,counts:clone(steps)});
  }
  function receipt(record){return {version:1,requestId:record.requestId,stage:'queued_for_review',scope:SCOPE,
    outboxRevision:1,baseRevision:record.payload.snapshot.revision};}
  function create(options){
    var journal,repository,readDraft,read,compareAndSwap;
    try{
      if(!exact(options,['journal','repository']))throw Error('invalid_options');
      journal=options.journal;repository=options.repository;
      if(!journal||typeof journal!=='object'||!repository||typeof repository!=='object')throw Error('invalid_options');
      readDraft=journal.readDraft;read=repository.read;compareAndSwap=repository.compareAndSwap;
      if(typeof readDraft!=='function'||typeof read!=='function'||typeof compareAndSwap!=='function')throw Error('invalid_options');
    }catch(error){throw Error('request_outbox_options_unavailable');}
    // The caller must supply atomic CAS across every client of this separate
    // slot. A committed ACK describes that host contract, not proven durability.
    async function validateQueued(raw,steps){
      if(typeof raw!=='string'||raw.length>MAX_JSON_CHARS)throw Error('corrupt_queue');
      var value=capture(JSON.parse(raw));
      if(!exact(value,['version','record','receipt'])||value.version!==1||
        !exact(value.receipt,['version','requestId','stage','scope','outboxRevision','baseRevision'])||canonical(value)!==raw)throw Error('corrupt_queue');
      var validator=Journal.create({repository:{
        async read(){steps.outboxRevalidationReads++;return JSON.stringify(value.record);},
        async compareAndSwap(){throw Error('outbox_validation_write_forbidden');}
      }});
      var checked=await validator.readDraft();
      if(!checked.ok||checked.status!=='recorded_unsubmitted'||!checked.record||
        canonical(checked.record)!==canonical(value.record)||canonical(value.receipt)!==canonical(receipt(checked.record)))throw Error('corrupt_queue');
      return value;
    }
    async function readSlot(steps){
      var raw;
      try{steps.outboxReads++;raw=await read.call(repository);}
      catch(error){return {error:'queue_read_failed'};}
      if(raw===null)return {raw:null,queued:null};
      // Never inspect an object response, its getters or toJSON hooks.
      if(typeof raw!=='string')return {error:'corrupt_queue'};
      try{return {raw:raw,queued:await validateQueued(raw,steps)};}
      catch(error){return {error:'corrupt_queue'};}
    }
    async function readQueued(){
      var steps=counts(),current=await readSlot(steps);
      if(current.error)return failure(current.error,steps);
      return success(current.queued===null?'empty':'stored_local',current.queued,'not_checked',steps);
    }
    async function enqueue(input){
      var steps=counts(),snapshotJson;
      try{
        if(!exact(input,['snapshotJson']))return failure('invalid_request',steps);
        snapshotJson=input.snapshotJson;
      }catch(error){return failure('invalid_request',steps);}
      var reviewed;
      try{
        var reviewer=Review.create({journal:{readDraft:function(){steps.journalReads++;return readDraft.call(journal);}}});
        steps.draftReviewCalls++;
        reviewed=capture(await reviewer.review({snapshotJson:snapshotJson}));
      }catch(error){return failure('corrupt_journal',steps);}
      if(!reviewed||!exact(reviewed.reads,['journal','revalidation'])||
        reviewed.reads.journal!==steps.journalReads||![0,1].includes(reviewed.reads.revalidation))return failure('corrupt_journal',steps);
      steps.reviewRevalidationReads=reviewed.reads.revalidation;
      if(exact(reviewed,['ok','error','reads'])&&reviewed.ok===false){
        var code=reviewed.error==='repository_read_failed'?'journal_read_failed':reviewed.error;
        return failure(['invalid_request','invalid_snapshot','journal_read_failed','corrupt_journal'].includes(code)?code:'corrupt_journal',steps);
      }
      if(exact(reviewed,['ok','status','record','providedContext','reads'])&&reviewed.ok===true&&reviewed.status==='empty'&&reviewed.record===null)return failure('draft_empty',steps);
      if(!exact(reviewed,['ok','status','stage','record','providedContext','reads'])||reviewed.ok!==true||reviewed.stage!=='unsubmitted'||!reviewed.record)return failure('corrupt_journal',steps);
      if(['stale_revision','base_layout_changed'].includes(reviewed.status))return failure(reviewed.status,steps);
      if(reviewed.status!=='matches_provided_context'||canonical(reviewed.record.payload.snapshot)!==canonical(reviewed.providedContext))return failure('corrupt_journal',steps);
      // Review precedes every outbox read, even when the next result is replay.
      // Equality concerns this captured explicit context, never owner freshness.
      var current=await readSlot(steps),record=reviewed.record;
      if(current.error)return failure(current.error,steps);
      if(current.queued!==null){
        if(current.queued.record.requestId===record.requestId&&canonical(current.queued.record.payload)===canonical(record.payload))return success('replayed',current.queued,'provided_context_only',steps);
        return failure('queue_conflict',steps);
      }
      var queued={version:1,record:clone(record),receipt:receipt(record)},next=canonical(queued);
      if(next.length>MAX_JSON_CHARS)return failure('queue_record_too_large',steps);
      var acknowledgement;
      try{steps.outboxCAS++;acknowledgement=await compareAndSwap.call(repository,current.raw,next);}
      catch(error){return failure('write_outcome_unknown',steps);}
      if(acknowledgement==='conflict')return failure('queue_conflict',steps);
      if(acknowledgement!=='committed')return failure('write_outcome_unknown',steps);
      return success('queued',queued,'provided_context_only',steps);
    }
    return Object.freeze({enqueue:enqueue,readQueued:readQueued});
  }
  return Object.freeze({version:1,create:create});
}));

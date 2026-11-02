/* Explicit removal of one local queued preparation. No external cancellation. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./pet-contractor-request-outbox.js'));
  else root.PetContractorQueueWithdrawal=factory(root.PetContractorRequestOutbox);
}(typeof globalThis!=='undefined'?globalThis:this,function(Outbox){
  'use strict';
  var createOutbox;
  try{createOutbox=Outbox&&Outbox.create;}catch(error){}
  if(typeof createOutbox!=='function')throw Error('queue_withdrawal_dependency_unavailable');
  var MAX_JSON_CHARS=1000000,SCOPE='explicit_local_preparation';
  var OUTBOX_COUNTS=['draftReviewCalls','journalReads','reviewRevalidationReads','outboxReads','outboxRevalidationReads','outboxCAS'];
  function exact(value,keys){
    return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
      Reflect.ownKeys(value).length===keys.length&&keys.every(function(key){return Object.prototype.hasOwnProperty.call(value,key);});
  }
  function canonical(value){
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(function(key){return JSON.stringify(key)+':'+canonical(value[key]);}).join(',')+'}';
    return JSON.stringify(value);
  }
  function freeze(value){
    if(value&&typeof value==='object'){Object.keys(value).forEach(function(key){freeze(value[key]);});Object.freeze(value);}
    return value;
  }
  function capture(value,maximumCharacters){
    var active=new Set(),nodes=0,characters=0;
    maximumCharacters=maximumCharacters||MAX_JSON_CHARS+4096;
    function charge(size){characters+=size;if(characters>maximumCharacters)throw Error('invalid_data');}
    function stringSize(text){
      if(text.length>maximumCharacters)throw Error('invalid_data');
      charge(2);
      for(var i=0;i<text.length;i++){
        var c=text.charCodeAt(i);
        if(c===34||c===92)charge(2);
        else if(c<32)charge([8,9,10,12,13].indexOf(c)>=0?2:6);
        else if(c>=0xD800&&c<=0xDBFF){
          var next=text.charCodeAt(i+1);
          if(next>=0xDC00&&next<=0xDFFF){charge(2);i++;}else charge(6);
        }else if(c>=0xDC00&&c<=0xDFFF)charge(6);
        else charge(1);
      }
    }
    function copy(current,depth){
      if(++nodes>10064||depth>18)throw Error('invalid_data');
      if(current===null){charge(4);return null;}
      if(typeof current==='string'){stringSize(current);return current;}
      if(typeof current==='boolean'){charge(current?4:5);return current;}
      if(typeof current==='number'&&Number.isFinite(current)){charge(String(current).length);return current;}
      if(!current||typeof current!=='object'||active.has(current))throw Error('invalid_data');
      active.add(current);
      var keys=Reflect.ownKeys(current),array=Array.isArray(current),target=array?[]:Object.create(null),length=keys.length;
      if(keys.length>10001)throw Error('invalid_data');
      if(array){
        var descriptor=Object.getOwnPropertyDescriptor(current,'length');
        if(!descriptor||!Object.prototype.hasOwnProperty.call(descriptor,'value'))throw Error('invalid_data');
        length=descriptor.value;
        if(!Number.isSafeInteger(length)||length<0||length>10000||keys.length!==length+1)throw Error('invalid_data');
        for(var i=0;i<length;i++)if(!Object.prototype.hasOwnProperty.call(current,i))throw Error('invalid_data');
      }
      charge(2+Math.max(0,length-1));
      keys.forEach(function(key){
        if(array&&key==='length')return;
        var item=Object.getOwnPropertyDescriptor(current,key);
        if(typeof key!=='string'||!item||!item.enumerable||!Object.prototype.hasOwnProperty.call(item,'value'))throw Error('invalid_data');
        if(!array){stringSize(key);charge(1);}
        Object.defineProperty(target,key,{value:copy(item.value,depth+1),enumerable:true,writable:true,configurable:true});
      });
      active.delete(current);return target;
    }
    // Only own data is projected. Arbitrary host Proxy/thenable effects are not proved.
    return copy(value,0);
  }
  function counts(){return {repositoryReads:0,expectedValidationReads:0,expectedRecordRevalidationReads:0,actualValidationReads:0,actualRecordRevalidationReads:0,repositoryCAS:0};}
  // Inspect carries the same bounded envelope both as data and as an explicit raw target.
  function result(value){return freeze(capture(value,MAX_JSON_CHARS*2+8192));}
  function failure(error,steps){return result({ok:false,error:error,scope:SCOPE,counts:steps});}
  function validCounts(value){
    return exact(value,OUTBOX_COUNTS)&&value.draftReviewCalls===0&&value.journalReads===0&&
      value.reviewRevalidationReads===0&&value.outboxReads===1&&value.outboxRevalidationReads===1&&value.outboxCAS===0;
  }
  function create(options){
    var repository,read,compareAndSwap;
    try{
      if(!exact(options,['repository']))throw Error('invalid_options');
      repository=options.repository;
      if(!repository||typeof repository!=='object')throw Error('invalid_options');
      read=repository.read;compareAndSwap=repository.compareAndSwap;
      if(typeof read!=='function'||typeof compareAndSwap!=='function')throw Error('invalid_options');
    }catch(error){throw Error('queue_withdrawal_repository_unavailable');}
    // Required host contract: atomic exact-raw compare AND nullable next target.
    // The old string-only IndexedDB adapter does not implement this deletion contract.
    // A committed ACK is the injected host's claim, not a proof of durable storage.
    async function validate(raw,which,steps){
      if(typeof raw!=='string'||raw.length>MAX_JSON_CHARS)throw Error('invalid_queue');
      var validator=createOutbox.call(Outbox,{journal:{readDraft(){throw Error('withdrawal_journal_forbidden');}},repository:{
        async read(){steps[which+'ValidationReads']++;return raw;},
        async compareAndSwap(){throw Error('withdrawal_validation_write_forbidden');}
      }});
      var reply=capture(await validator.readQueued());
      if(reply&&reply.counts&&exact(reply.counts,OUTBOX_COUNTS)&&[0,1].includes(reply.counts.outboxRevalidationReads))
        steps[which+'RecordRevalidationReads']=reply.counts.outboxRevalidationReads;
      if(!exact(reply,['ok','status','queued','scope','freshness','counts'])||reply.ok!==true||
        reply.status!=='stored_local'||reply.queued===null||reply.scope!==SCOPE||reply.freshness!=='not_checked'||
        !validCounts(reply.counts)||canonical(reply.queued)!==raw)throw Error('invalid_queue');
      return reply.queued;
    }
    async function readSlot(steps){
      var raw;
      try{steps.repositoryReads++;raw=await read.call(repository);}
      catch(error){return {error:'queue_read_failed'};}
      if(raw===null)return {raw:null,queued:null};
      // Never inspect a host object response or its accessors/toJSON hooks.
      if(typeof raw!=='string')return {error:'corrupt_queue'};
      try{return {raw:raw,queued:await validate(raw,'actual',steps)};}
      catch(error){return {error:'corrupt_queue'};}
    }
    async function inspect(){
      var steps=counts(),current=await readSlot(steps);
      if(current.error)return failure(current.error,steps);
      return result({ok:true,status:current.raw===null?'empty_unattributed':'stored_local',queued:current.queued,
        expectedQueuedJson:current.raw,scope:SCOPE,freshness:'not_checked',counts:steps});
    }
    async function withdraw(input){
      var steps=counts(),expectedQueuedJson,expected;
      try{
        if(!exact(input,['expectedQueuedJson']))return failure('invalid_request',steps);
        expectedQueuedJson=input.expectedQueuedJson;
      }catch(error){return failure('invalid_request',steps);}
      try{expected=await validate(expectedQueuedJson,'expected',steps);}
      catch(error){return failure('invalid_expected_queue',steps);}
      var current=await readSlot(steps);
      if(current.error)return failure(current.error,steps);
      if(current.raw===null)return failure('queue_empty_unattributed',steps);
      if(current.raw!==expectedQueuedJson)return failure('queue_conflict',steps);
      var acknowledgement;
      try{steps.repositoryCAS++;acknowledgement=await compareAndSwap.call(repository,current.raw,null);}
      catch(error){return failure('write_outcome_unknown',steps);}
      if(acknowledgement==='conflict')return failure('queue_conflict',steps);
      if(acknowledgement!=='committed')return failure('write_outcome_unknown',steps);
      // This receipt concerns only this call. A later null cannot identify its cause.
      return result({ok:true,status:'withdrawn_local',target:expected,scope:SCOPE,counts:steps});
    }
    return Object.freeze({inspect:inspect,withdraw:withdraw});
  }
  return Object.freeze({version:1,create:create});
}));

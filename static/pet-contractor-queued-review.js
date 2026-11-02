/* Read-only review of one queued local preparation against explicit supplied context. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./pet-contractor-draft-review.js'),require('./pet-contractor-request-outbox.js'));
  else root.PetContractorQueuedReview=factory(root.PetContractorDraftReview,root.PetContractorRequestOutbox);
}(typeof globalThis!=='undefined'?globalThis:this,function(Review,Outbox){
  'use strict';
  var createReview,createOutbox;
  try{createReview=Review&&Review.create;createOutbox=Outbox&&Outbox.create;}catch(error){}
  if(typeof createReview!=='function'||typeof createOutbox!=='function')throw Error('queued_review_dependency_unavailable');
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
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function freeze(value){
    if(value&&typeof value==='object'){Object.keys(value).forEach(function(key){freeze(value[key]);});Object.freeze(value);}
    return value;
  }
  function capture(value){
    var nodes=0,characters=0,active=new Set();
    function charge(size){characters+=size;if(characters>MAX_JSON_CHARS)throw Error('corrupt_queue');}
    function stringSize(text){
      if(text.length>MAX_JSON_CHARS)throw Error('corrupt_queue');
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
      if(++nodes>10000||depth>16)throw Error('corrupt_queue');
      if(current===null){charge(4);return current;}
      if(typeof current==='string'){stringSize(current);return current;}
      if(typeof current==='boolean'){charge(current?4:5);return current;}
      if(typeof current==='number'&&Number.isFinite(current)){charge(String(current).length);return current;}
      if(!current||typeof current!=='object'||active.has(current))throw Error('corrupt_queue');
      active.add(current);
      var keys=Reflect.ownKeys(current),array=Array.isArray(current),target=array?[]:Object.create(null),length=keys.length;
      if(keys.length>10001)throw Error('corrupt_queue');
      if(array){
        var lengthDescriptor=Object.getOwnPropertyDescriptor(current,'length');
        if(!lengthDescriptor||!Object.prototype.hasOwnProperty.call(lengthDescriptor,'value'))throw Error('corrupt_queue');
        length=lengthDescriptor.value;
        if(!Number.isSafeInteger(length)||length<0||length>10000||keys.length!==length+1)throw Error('corrupt_queue');
        for(var i=0;i<length;i++)if(!Object.prototype.hasOwnProperty.call(current,i))throw Error('corrupt_queue');
      }
      charge(2+Math.max(0,length-1));
      keys.forEach(function(key){
        if(array&&key==='length')return;
        var descriptor=Object.getOwnPropertyDescriptor(current,key);
        if(typeof key!=='string'||!descriptor||!descriptor.enumerable||!Object.prototype.hasOwnProperty.call(descriptor,'value'))throw Error('corrupt_queue');
        if(!array){stringSize(key);charge(1);}
        Object.defineProperty(target,key,{value:copy(descriptor.value,depth+1),enumerable:true,writable:true,configurable:true});
      });
      active.delete(current);return target;
    }
    // Plain data projection ignores inherited hooks/prototypes. Own accessors are
    // rejected, not invoked; arbitrary host Proxy/thenable behaviour is not proved.
    return copy(value,0);
  }
  function counts(){return {draftReviewCalls:0,reviewAdapterReads:0,reviewRecordRevalidationReads:0,outboxReads:0,outboxRevalidationReads:0,outboxRecordRevalidationReads:0};}
  function failure(code,steps){return freeze({ok:false,error:code,scope:SCOPE,counts:clone(steps)});}
  function countShape(value,revalidation){
    return exact(value,OUTBOX_COUNTS)&&value.draftReviewCalls===0&&value.journalReads===0&&
      value.reviewRevalidationReads===0&&value.outboxReads===1&&value.outboxCAS===0&&
      (revalidation===null?[0,1].includes(value.outboxRevalidationReads):value.outboxRevalidationReads===revalidation);
  }
  function storedReply(value){
    return exact(value,['ok','status','queued','scope','freshness','counts'])&&value.ok===true&&
      value.status==='stored_local'&&value.queued!==null&&value.scope===SCOPE&&value.freshness==='not_checked'&&countShape(value.counts,1);
  }
  function create(options){
    var outbox,readQueued;
    try{
      if(!exact(options,['outbox']))throw Error('invalid_options');
      outbox=options.outbox;
      if(!outbox||typeof outbox!=='object')throw Error('invalid_outbox');
      readQueued=outbox.readQueued;
      if(typeof readQueued!=='function')throw Error('invalid_outbox');
    }catch(error){throw Error('queued_review_outbox_unavailable');}
    async function review(input){
      var steps=counts(),snapshotJson,queued=null,queueState='unread',queueError=null;
      try{
        if(!exact(input,['snapshotJson']))return failure('invalid_request',steps);
        snapshotJson=input.snapshotJson;
      }catch(error){return failure('invalid_request',steps);}
      function stop(code){queueError=code;throw Error('queued_review_adapter_failed');}
      var result;
      try{
        // The unchanged context reviewer validates the captured snapshot before
        // calling this isolated adapter. It never reads the current Journal.
        var reviewer=createReview.call(Review,{journal:{async readDraft(){
          steps.reviewAdapterReads++;
          if(steps.reviewAdapterReads!==1)return stop('corrupt_queue');
          var reply;
          try{steps.outboxReads++;reply=await readQueued.call(outbox);}
          catch(error){return stop('queue_read_failed');}
          try{reply=capture(reply);}catch(error){return stop('corrupt_queue');}
          if(exact(reply,['ok','error','scope','counts'])&&reply.ok===false&&reply.scope===SCOPE&&countShape(reply.counts,null)){
            if(reply.error==='queue_read_failed'&&reply.counts.outboxRevalidationReads===0)return stop('queue_read_failed');
            if(reply.error==='corrupt_queue')return stop('corrupt_queue');
          }
          if(exact(reply,['ok','status','queued','scope','freshness','counts'])&&reply.ok===true&&
            reply.status==='empty'&&reply.queued===null&&reply.scope===SCOPE&&reply.freshness==='not_checked'&&countShape(reply.counts,0)){
            queueState='empty';return {ok:true,status:'empty',record:null};
          }
          if(!storedReply(reply))return stop('corrupt_queue');
          var raw=canonical(reply.queued),checked;
          try{
            // Reuse the unchanged Outbox decoder with one private raw read.
            // Both extra capabilities are local throwing stubs, never owner I/O.
            var validator=createOutbox.call(Outbox,{journal:{readDraft(){throw Error('queued_review_current_journal_forbidden');}},repository:{
              async read(){steps.outboxRevalidationReads++;return raw;},
              async compareAndSwap(){throw Error('queued_review_write_forbidden');}
            }});
            checked=capture(await validator.readQueued());
          }catch(error){return stop('corrupt_queue');}
          if(checked&&countShape(checked.counts,null))steps.outboxRecordRevalidationReads=checked.counts.outboxRevalidationReads;
          if(!storedReply(checked)||canonical(checked.queued)!==raw)return stop('corrupt_queue');
          queued=checked.queued;queueState='stored';
          return {ok:true,status:'recorded_unsubmitted',record:queued.record};
        }}});
        steps.draftReviewCalls++;
        result=capture(await reviewer.review({snapshotJson:snapshotJson}));
      }catch(error){return failure(queueError||'corrupt_queue',steps);}
      if(!result||!exact(result.reads,['journal','revalidation'])||result.reads.journal!==steps.reviewAdapterReads||
        ![0,1].includes(result.reads.revalidation))return failure('corrupt_queue',steps);
      steps.reviewRecordRevalidationReads=result.reads.revalidation;
      if(queueError!==null)return failure(queueError,steps);
      if(exact(result,['ok','error','reads'])&&result.ok===false){
        return failure(['invalid_request','invalid_snapshot'].includes(result.error)?result.error:'corrupt_queue',steps);
      }
      if(exact(result,['ok','status','record','providedContext','reads'])&&result.ok===true&&
        result.status==='empty'&&result.record===null&&queueState==='empty'&&queued===null){
        // No queued stage or receipt exists in an empty slot.
        return freeze({ok:true,status:'empty',queued:null,providedContext:clone(result.providedContext),scope:SCOPE,freshness:'provided_context_only',counts:clone(steps)});
      }
      if(!exact(result,['ok','status','stage','record','providedContext','reads'])||result.ok!==true||
        result.stage!=='unsubmitted'||queueState!=='stored'||queued===null||
        !['matches_provided_context','stale_revision','base_layout_changed'].includes(result.status)||
        canonical(result.record)!==canonical(queued.record))return failure('corrupt_queue',steps);
      return freeze({ok:true,status:result.status,stage:'queued_for_review',queued:clone(queued),
        providedContext:clone(result.providedContext),scope:SCOPE,freshness:'provided_context_only',counts:clone(steps)});
    }
    return Object.freeze({review:review});
  }
  return Object.freeze({version:1,create:create});
}));

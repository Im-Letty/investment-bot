/* Owned QA outbox raw CAS only. No default storage, game action or transport. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.PetContractorOutboxIndexedDBRepository=factory();
}(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var VERSION=1,STORE='queued_local_qa',META='ownership',SLOT='queued',MAX=1000000;
  var PREFIX='outbox_idb_';
  var CODES=['invalid_options','invalid_raw_value','open_failed','open_blocked','missing_database',
    'unexpected_upgrade','already_exists','schema_creation_failed','schema_mismatch','ownership_mismatch',
    'open_validation_failed','connection_closed','transaction_unavailable','transaction_failed',
    'transaction_aborted','transaction_outcome_missing','strict_durability_unavailable',
    'ownership_read_failed','read_failed','corrupt_slot','write_failed','close_failed','delete_failed','delete_blocked'];
  function error(code){return new Error(PREFIX+code);}
  function exact(value,keys){
    return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
      Reflect.ownKeys(value).length===keys.length&&keys.every(function(key){return Object.prototype.hasOwnProperty.call(value,key);});
  }
  function data(value,key){
    var descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor||!descriptor.enumerable||!Object.prototype.hasOwnProperty.call(descriptor,'value'))throw error('invalid_options');
    return descriptor.value;
  }
  function capture(input,needsDelete){
    if(!exact(input,['indexedDBFactory','dbName','ownerToken']))throw error('invalid_options');
    var factory=data(input,'indexedDBFactory'),name=data(input,'dbName'),token=data(input,'ownerToken');
    if(!factory||(typeof factory!=='object'&&typeof factory!=='function')||
      typeof name!=='string'||!/^pet-contractor-outbox-idb-qa-[a-z0-9-]{1,80}$/.test(name)||
      typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw error('invalid_options');
    var open=factory.open,remove=needsDelete?factory.deleteDatabase:null;
    if(typeof open!=='function'||(needsDelete&&typeof remove!=='function'))throw error('invalid_options');
    return Object.freeze({factory:factory,name:name,token:token,open:open,remove:remove});
  }
  function ownership(o){return {version:VERSION,kind:'contractor-outbox-qa',dbName:o.name,ownerToken:o.token};}
  function owns(value,o){
    if(!exact(value,['version','kind','dbName','ownerToken']))return false;
    return data(value,'version')===VERSION&&data(value,'kind')==='contractor-outbox-qa'&&
      data(value,'dbName')===o.name&&data(value,'ownerToken')===o.token;
  }
  function safeError(value,fallback){
    try{
      var descriptor=value&&Object.getOwnPropertyDescriptor(value,'message'),message=descriptor&&descriptor.value;
      if(typeof message==='string'&&CODES.some(function(code){return message===PREFIX+code;}))return new Error(message);
    }catch(ignored){}
    return error(fallback);
  }
  function captureDatabase(native,o){
    var db=native.db,name=db.name,version=db.version,names=db.objectStoreNames,transaction=db.transaction;
    var contains=names&&names.contains,length=names&&names.length;
    if(name!==o.name||version!==VERSION||length!==1||typeof contains!=='function'||!contains.call(names,STORE)||
      typeof native.close!=='function'||typeof transaction!=='function')throw error('schema_mismatch');
    native.transaction=transaction;return native;
  }
  function closeQuietly(native){try{if(typeof native.close==='function')native.close.call(native.db);}catch(ignored){}}
  function handle(native,o){
    var closed=false,stats={ownershipTransactions:0,ownershipCompletions:0,readTransactions:0,readCompletions:0,
      casTransactions:0,casTransactionCompletions:0,putRequestSuccesses:0,deleteRequestSuccesses:0,
      committedAcknowledgements:0,conflictCompletions:0,aborts:0,lastActualWriteDurability:null};
    function close(){
      if(closed)return;
      closed=true;
      try{native.close.call(native.db);}catch(ignored){throw error('close_failed');}
    }
    native.db.onversionchange=function(){try{close();}catch(ignored){}};
    function transact(kind,expected,next){
      return new Promise(function(resolve,reject){
        if(closed){reject(error('connection_closed'));return;}
        var tx,settled=false,ready=false,outcome,reason='transaction_aborted',abortSeen=false,completeSeen=false;
        function fail(code){if(!settled){settled=true;reject(error(code));}}
        function abort(code){reason=code;try{var stop=tx&&tx.abort;if(typeof stop!=='function')throw error(code);stop.call(tx);}catch(ignored){fail(code);}}
        function guard(fn,code){return function(){if(settled)return;try{fn();}catch(ignored){abort(code);}};}
        try{
          tx=kind==='cas'?native.transaction.call(native.db,[STORE],'readwrite',{durability:'strict'}):
            native.transaction.call(native.db,[STORE],'readonly');
          if(kind==='cas')stats.casTransactions++;else if(kind==='read')stats.readTransactions++;else stats.ownershipTransactions++;
          tx.onabort=function(){if(!abortSeen){abortSeen=true;stats.aborts++;}fail(reason);};
          tx.onerror=function(){reason='transaction_failed';};
          tx.oncomplete=function(){
            if(completeSeen)return;
            completeSeen=true;
            if(kind==='cas')stats.casTransactionCompletions++;else if(kind==='read')stats.readCompletions++;else stats.ownershipCompletions++;
            if(settled)return;
            if(!ready){fail('transaction_outcome_missing');return;}
            if(kind==='cas'){
              if(outcome==='committed')stats.committedAcknowledgements++;
              else if(outcome==='conflict')stats.conflictCompletions++;
              else{fail('transaction_outcome_missing');return;}
            }
            settled=true;resolve(outcome);
          };
          if(kind==='cas'){
            var actual=tx.durability;
            stats.lastActualWriteDurability=['strict','relaxed','default'].indexOf(actual)>=0?actual:'unexposed';
            if(actual!=='strict'){abort('strict_durability_unavailable');return;}
          }
          var getStore=tx.objectStore;
          if(typeof getStore!=='function')throw error('transaction_failed');
          var store=getStore.call(tx,STORE),get=store.get;
          if(typeof get!=='function')throw error('read_failed');
          function accepted(current){
            if(kind==='read'){outcome=current;ready=true;return;}
            if(current!==expected){outcome='conflict';ready=true;return;}
            try{
              var method=next===null?store.delete:store.put;
              if(typeof method!=='function')throw error('write_failed');
              var request=next===null?method.call(store,SLOT):method.call(store,next,SLOT),succeeded=false;
              request.onerror=guard(function(){abort('write_failed');},'write_failed');
              request.onsuccess=guard(function(){
                if(succeeded)return;succeeded=true;
                if(next===null)stats.deleteRequestSuccesses++;else stats.putRequestSuccesses++;
                outcome='committed';ready=true;
              },'write_failed');
            }catch(ignored){abort('write_failed');}
          }
          var meta=get.call(store,META);
          meta.onerror=guard(function(){abort('ownership_read_failed');},'ownership_read_failed');
          meta.onsuccess=guard(function(){
            if(!owns(meta.result,o)){abort('ownership_mismatch');return;}
            if(kind==='ownership'){outcome=true;ready=true;return;}
            var slot=get.call(store,SLOT);
            slot.onerror=guard(function(){abort('read_failed');},'read_failed');
            slot.onsuccess=guard(function(){
              var value=slot.result;
              if(value===undefined){
                // get(undefined) alone cannot distinguish absence from a stored undefined value.
                var count=store.count;
                if(typeof count!=='function')throw error('read_failed');
                var presence=count.call(store,SLOT);
                presence.onerror=guard(function(){abort('read_failed');},'read_failed');
                presence.onsuccess=guard(function(){if(presence.result!==0){abort('corrupt_slot');return;}accepted(null);},'read_failed');
              }else if(typeof value==='string'&&value.length<=MAX)accepted(value);
              else abort('corrupt_slot');
            },'read_failed');
          },'ownership_read_failed');
        }catch(ignored){if(tx)abort('transaction_failed');else fail('transaction_unavailable');}
      });
    }
    var repository=Object.freeze({read:function(){return transact('read');},compareAndSwap:function(expected,next){
      if((expected!==null&&(typeof expected!=='string'||expected.length>MAX))||
        (next!==null&&(typeof next!=='string'||next.length>MAX)))return Promise.reject(error('invalid_raw_value'));
      return transact('cas',expected,next);
    }});
    return {verify:function(){return transact('ownership');},isClosed:function(){return closed;},close:close,public:Object.freeze({repository:repository,close:close,
      diagnostics:function(){return Object.freeze(Object.assign({dbName:o.name,version:VERSION,closed:closed,requestedWriteDurability:'strict'},stats));}})};
  }
  function openCaptured(o,create){
    return new Promise(function(resolve,reject){
      var request,created=false,settled=false,upgradeReason=null;
      function fail(code){if(!settled){settled=true;reject(error(code));}}
      function abortUpgrade(code){
        upgradeReason=code;
        try{var tx=request.transaction,stop=tx&&tx.abort;if(typeof stop!=='function')throw error(code);stop.call(tx);}catch(ignored){fail(code);}
      }
      try{
        request=o.open.call(o.factory,o.name,VERSION);
        request.onblocked=function(){fail('open_blocked');};
        request.onerror=function(){fail(upgradeReason||'open_failed');};
        request.onupgradeneeded=function(event){
          try{
            if(settled||!create||event.oldVersion!==0){abortUpgrade(!create&&event.oldVersion===0?'missing_database':'unexpected_upgrade');return;}
            var db=request.result,name=db.name,version=db.version,names=db.objectStoreNames,make=db.createObjectStore;
            if(name!==o.name||version!==VERSION||!names||names.length!==0||typeof make!=='function')throw error('schema_creation_failed');
            var store=make.call(db,STORE),add=store.add;
            if(typeof add!=='function')throw error('schema_creation_failed');
            var added=add.call(store,ownership(o),META);
            added.onerror=function(){abortUpgrade('schema_creation_failed');};created=true;
          }catch(ignored){abortUpgrade('schema_creation_failed');}
        };
        request.onsuccess=function(){
          var db,owned,native={db:null,close:null};
          try{
            db=request.result;native.db=db;
            // Capture close first, including on rejected/late opens. A later
            // getter failure must not cause another read of a hostile close.
            native.close=db.close;
            if(settled){closeQuietly(native);return;}
            if(create&&!created){closeQuietly(native);fail('already_exists');return;}
            owned=handle(captureDatabase(native,o),o);
            owned.verify().then(function(){
              if(settled){try{owned.close();}catch(ignored){}return;}
              if(owned.isClosed()){fail('connection_closed');return;}
              settled=true;resolve(owned.public);
            },function(value){
              try{owned.close();}catch(ignored){}
              if(!settled){settled=true;reject(safeError(value,'open_validation_failed'));}
            });
          }catch(ignored){if(owned){try{owned.close();}catch(other){}}else closeQuietly(native);fail('schema_mismatch');}
        };
      }catch(ignored){fail('open_failed');}
    });
  }
  function open(input,create){
    var o;try{o=capture(input,false);}catch(ignored){return Promise.reject(error('invalid_options'));}
    return openCaptured(o,create);
  }
  function deleteOwned(input){
    var o;try{o=capture(input,true);}catch(ignored){return Promise.reject(error('invalid_options'));}
    // Never re-read original options or methods. Open validates schema/meta only,
    // so an owned corrupt queue can still be cleaned up in this exact QA namespace.
    return openCaptured(o,false).then(function(owned){
      try{owned.close();}catch(ignored){return Promise.reject(error('close_failed'));}
      return new Promise(function(resolve,reject){
        var request,settled=false;
        function fail(code){if(!settled){settled=true;reject(error(code));}}
        try{
          request=o.remove.call(o.factory,o.name);
          request.onerror=function(){fail('delete_failed');};
          request.onblocked=function(){fail('delete_blocked');};
          request.onsuccess=function(){if(!settled){settled=true;resolve(Object.freeze({status:'deleted_owned_outbox_qa',dbName:o.name}));}};
        }catch(ignored){fail('delete_failed');}
      });
    });
  }
  return Object.freeze({version:VERSION,createOwned:function(input){return open(input,true);},
    openOwned:function(input){return open(input,false);},deleteOwned:deleteOwned});
}));

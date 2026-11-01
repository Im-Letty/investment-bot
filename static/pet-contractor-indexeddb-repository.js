/* Dedicated QA IndexedDB repository. No default factory, game save or layout action. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.PetContractorIndexedDBRepository=factory();
}(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var STORE='unsubmitted_qa',META='ownership',SLOT='draft',VERSION=1,MAX=1000000;
  function error(code){return new Error(code);}
  function exact(x,keys){return x!==null&&typeof x==='object'&&!Array.isArray(x)&&
    Reflect.ownKeys(x).length===keys.length&&keys.every(function(k){return Object.prototype.hasOwnProperty.call(x,k);});}
  function options(input,needsDelete){
    if(!exact(input,['indexedDBFactory','dbName','ownerToken']))throw error('idb_invalid_options');
    var f=input.indexedDBFactory,n=input.dbName,t=input.ownerToken;
    if(!f||typeof f.open!=='function'||(needsDelete&&typeof f.deleteDatabase!=='function')||
      typeof n!=='string'||!/^pet-contractor-idb-qa-[a-z0-9-]{1,80}$/.test(n)||
      typeof t!=='string'||!/^[a-f0-9]{64}$/.test(t))throw error('idb_invalid_options');
    return {factory:f,name:n,token:t};
  }
  function ownership(o){return {version:VERSION,kind:'contractor-unsubmitted-qa',dbName:o.name,ownerToken:o.token};}
  function owns(value,o){return exact(value,['version','kind','dbName','ownerToken'])&&
    value.version===VERSION&&value.kind==='contractor-unsubmitted-qa'&&value.dbName===o.name&&value.ownerToken===o.token;}
  function raw(value){
    if(value===undefined)return null;
    if(typeof value!=='string'||value.length>MAX)throw error('idb_corrupt_slot');
    return value;
  }
  function handle(db,o){
    var closed=false,stats={readTransactions:0,readCompletions:0,casTransactions:0,
      writeRequestSuccesses:0,casCommitEvents:0,committedAcknowledgements:0,conflictCompletions:0,aborts:0};
    db.onversionchange=function(){closed=true;db.close();};
    function transact(mode,expected,next){
      return new Promise(function(resolve,reject){
        if(closed){reject(error('idb_connection_closed'));return;}
        var tx,settled=false,outcome,reason='idb_transaction_aborted';
        function fail(code){if(!settled){settled=true;reject(error(code));}}
        function abort(code){reason=code;try{tx.abort();}catch(e){fail(code);}}
        try{
          tx=mode==='readwrite'?db.transaction([STORE],mode,{durability:'strict'}):db.transaction([STORE],mode);
          if(mode==='readwrite')stats.casTransactions++;else stats.readTransactions++;
          tx.onabort=function(){stats.aborts++;fail(reason);};
          tx.onerror=function(){reason='idb_transaction_failed';};
          tx.oncomplete=function(){
            if(settled)return;
            settled=true;
            if(mode==='readwrite'){
              stats.casCommitEvents++;
              if(outcome==='committed')stats.committedAcknowledgements++;else stats.conflictCompletions++;
            }else stats.readCompletions++;
            resolve(outcome);
          };
          if(mode==='readwrite'&&tx.durability!=='strict'){abort('idb_strict_durability_unavailable');return;}
          var store=tx.objectStore(STORE),meta=store.get(META);
          meta.onsuccess=function(){
            if(!owns(meta.result,o)){abort('idb_ownership_mismatch');return;}
            var get;
            try{get=store.get(SLOT);}catch(e){abort('idb_read_failed');return;}
            get.onsuccess=function(){
              var current;
              try{current=raw(get.result);}catch(e){abort('idb_corrupt_slot');return;}
              if(mode==='readonly'){outcome=current;return;}
              if(current!==expected){outcome='conflict';return;}
              try{
                var put=store.put(next,SLOT);
                put.onsuccess=function(){stats.writeRequestSuccesses++;};
                outcome='committed';
              }catch(e){abort('idb_write_failed');}
            };
          };
        }catch(e){
          if(tx)abort('idb_transaction_failed');else fail('idb_transaction_unavailable');
        }
      });
    }
    var repository=Object.freeze({
      read:function(){return transact('readonly');},
      compareAndSwap:function(expected,next){
        if((expected!==null&&(typeof expected!=='string'||expected.length>MAX))||typeof next!=='string'||next.length>MAX)
          return Promise.reject(error('idb_invalid_raw_value'));
        return transact('readwrite',expected,next);
      }
    });
    return Object.freeze({repository:repository,
      close:function(){if(!closed){closed=true;db.close();}},
      diagnostics:function(){return Object.freeze(Object.assign({dbName:o.name,version:VERSION,closed:closed,
        requestedWriteDurability:'strict'},stats));}
    });
  }
  function open(input,create){
    var o;
    try{o=options(input,false);}catch(e){return Promise.reject(error('idb_invalid_options'));}
    return new Promise(function(resolve,reject){
      var request,created=false,settled=false,upgradeReason=null;
      function fail(code){if(!settled){settled=true;reject(error(code));}}
      try{request=o.factory.open(o.name,VERSION);}catch(e){fail('idb_open_failed');return;}
      request.onblocked=function(){fail('idb_open_blocked');};
      request.onerror=function(){fail(upgradeReason||'idb_open_failed');};
      request.onupgradeneeded=function(event){
        if(settled||!create||event.oldVersion!==0){
          upgradeReason=!create&&event.oldVersion===0?'idb_missing_database':'idb_unexpected_upgrade';
          try{request.transaction.abort();}catch(e){fail(upgradeReason);}return;
        }
        try{
          var store=request.result.createObjectStore(STORE);
          store.add(ownership(o),META);created=true;
        }catch(e){upgradeReason='idb_schema_creation_failed';try{request.transaction.abort();}catch(x){fail(upgradeReason);}}
      };
      request.onsuccess=function(){
        var db=request.result;
        if(settled){db.close();return;}
        if(create&&!created){db.close();fail('idb_already_exists');return;}
        if(db.name!==o.name||db.version!==VERSION||db.objectStoreNames.length!==1||!db.objectStoreNames.contains(STORE)){
          db.close();fail('idb_schema_mismatch');return;
        }
        var h=handle(db,o);
        h.repository.read().then(function(){
          if(settled){h.close();return;}settled=true;resolve(h);
        },function(e){h.close();fail(e.message==='idb_ownership_mismatch'?'idb_ownership_mismatch':'idb_open_validation_failed');});
      };
    });
  }
  function deleteOwned(input){
    var o;
    try{o=options(input,true);}catch(e){return Promise.reject(error('idb_invalid_options'));}
    // First validate this exact existing namespace. Missing DB creation is aborted.
    return open(input,false).then(function(h){
      h.close();
      return new Promise(function(resolve,reject){
        var request,settled=false;
        function fail(code){if(!settled){settled=true;reject(error(code));}}
        try{request=o.factory.deleteDatabase(o.name);}catch(e){fail('idb_delete_failed');return;}
        request.onerror=function(){fail('idb_delete_failed');};
        request.onblocked=function(){fail('idb_delete_blocked');};
        request.onsuccess=function(){if(!settled){settled=true;resolve(Object.freeze({status:'deleted_owned_qa',dbName:o.name}));}};
      });
    });
  }
  return Object.freeze({version:VERSION,createOwned:function(o){return open(o,true);},
    openOwned:function(o){return open(o,false);},deleteOwned:deleteOwned});
}));

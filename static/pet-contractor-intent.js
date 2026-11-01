/* Unsubmitted contractor intent only. No game action, storage or construction. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./pet-game-core.js'));
  else root.PetContractorIntent=factory(root.PetGameCore);
}(typeof globalThis!=='undefined'?globalThis:this,function(Core){
  'use strict';
  if(!Core||typeof Core.getVillageLayout!=='function')throw Error('contractor_intent_dependency_unavailable');
  // Same numeric / serialized-string bounds as the existing Core save contract.
  var MAX_REVISION=9000000000000,MAX_JSON_CHARS=1000000;
  function exact(value,keys){
    return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
      Reflect.ownKeys(value).length===keys.length&&keys.every(function(key){
        return Object.prototype.hasOwnProperty.call(value,key);
      });
  }
  function revision(value){return Number.isSafeInteger(value)&&value>=0&&value<=MAX_REVISION;}
  function parse(raw){
    if(typeof raw!=='string'||raw.length>MAX_JSON_CHARS)throw Error('invalid_json');
    return JSON.parse(raw);
  }
  function freeze(value){
    if(value&&typeof value==='object'){
      Object.keys(value).forEach(function(key){freeze(value[key]);});Object.freeze(value);
    }
    return value;
  }
  function failure(code){return Object.freeze({ok:false,error:code});}
  function explicitLayout(layout){
    // Never call Core's no-argument/default projection for an absent request.
    // The original validator supplies exact IDs/theme/coordinates and a clone.
    if(!exact(layout,['version','theme','items']))throw Error('invalid_layout');
    return Core.getVillageLayout({villageLayout:layout});
  }
  function inspect(snapshotJson,proposalJson){
    var snapshot,current,proposal,requested;
    try{
      snapshot=parse(snapshotJson);
      if(!exact(snapshot,['revision','currentLayout'])||!revision(snapshot.revision))return failure('invalid_snapshot');
      current=explicitLayout(snapshot.currentLayout);
    }catch(error){return failure('invalid_snapshot');}
    try{
      proposal=parse(proposalJson);
      if(!exact(proposal,['version','expectedRevision','requestedLayout'])||proposal.version!==1||
        !revision(proposal.expectedRevision))return failure('invalid_proposal');
      requested=explicitLayout(proposal.requestedLayout);
    }catch(error){return failure('invalid_proposal');}
    if(proposal.expectedRevision!==snapshot.revision)return failure('stale_revision');
    var positions=new Map(current.items.map(function(row){return [row.id,row];}));
    var changes=[];
    requested.items.forEach(function(row){
      var previous=positions.get(row.id);
      if(row.x!==previous.x||row.y!==previous.y)changes.push({id:row.id,
        from:{x:previous.x,y:previous.y},to:{x:row.x,y:row.y}});
    });
    // This is data to discuss later, never a save command, accepted commission,
    // job identifier, placement/collision approval or durable deduplication receipt.
    return freeze({ok:true,stage:'unsubmitted',draft:{version:1,
      expectedRevision:proposal.expectedRevision,requestedLayout:requested},changes:changes});
  }
  return Object.freeze({version:1,inspect:inspect});
}));

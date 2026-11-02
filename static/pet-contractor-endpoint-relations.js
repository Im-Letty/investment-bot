/* Relations of supplied rectangles in saved-layout coordinates, never world clearance. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./pet-contractor-intent.js'));
  else root.PetContractorEndpointRelations=factory(root.PetContractorIntent);
}(typeof globalThis!=='undefined'?globalThis:this,function(Intent){
  'use strict';
  var inspectIntent;
  try{inspectIntent=Intent&&Intent.inspect;}catch(error){}
  if(typeof inspectIntent!=='function')throw Error('endpoint_relations_dependency_unavailable');
  var SPACE='provided_saved_layout_xy',SCOPE='provided_endpoint_relations',MAX_CHARS=1000000;
  var INVALID={},UNSAFE={};
  function exact(value,keys){
    return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
      Reflect.ownKeys(value).length===keys.length&&keys.every(function(k){return Object.prototype.hasOwnProperty.call(value,k);});
  }
  function freeze(value){
    if(value&&typeof value==='object'){Object.keys(value).forEach(function(k){freeze(value[k]);});Object.freeze(value);}
    return value;
  }
  function failure(error){return Object.freeze({ok:false,error:error});}
  function canonical(value){
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(function(k){return JSON.stringify(k)+':'+canonical(value[k]);}).join(',')+'}';
    return JSON.stringify(value);
  }
  // The real dependency returns data. Refuse accessors or oversized/malformed
  // replacement replies without invoking their getters, including in VM tests.
  function capture(value){
    var nodes=0,characters=0;
    function copy(v,depth){
      if(++nodes>512||depth>24)throw INVALID;
      if(v===null||typeof v==='boolean')return v;
      if(typeof v==='string'){characters+=v.length;if(characters>MAX_CHARS)throw INVALID;return v;}
      if(typeof v==='number'){if(!Number.isSafeInteger(v))throw INVALID;return v;}
      if(typeof v!=='object')throw INVALID;
      var keys=Reflect.ownKeys(v),out;
      if(Array.isArray(v)){
        var length=Object.getOwnPropertyDescriptor(v,'length');
        if(!length||!Number.isSafeInteger(length.value)||length.value<0||length.value>32||keys.length!==length.value+1)throw INVALID;
        out=[];
        for(var i=0;i<length.value;i++){
          var entry=Object.getOwnPropertyDescriptor(v,String(i));
          if(!entry||!Object.prototype.hasOwnProperty.call(entry,'value'))throw INVALID;
          out.push(copy(entry.value,depth+1));
        }
        return out;
      }
      if(keys.length>32)throw INVALID;
      out=Object.create(null);
      keys.forEach(function(k){
        if(typeof k!=='string')throw INVALID;
        characters+=k.length;if(characters>MAX_CHARS)throw INVALID;
        var property=Object.getOwnPropertyDescriptor(v,k);
        if(!property||!Object.prototype.hasOwnProperty.call(property,'value'))throw INVALID;
        out[k]=copy(property.value,depth+1);
      });
      return out;
    }
    return copy(value,0);
  }
  function layout(value){
    if(!exact(value,['version','theme','items'])||value.version!==1||value.theme!=='cafe'||!Array.isArray(value.items)||value.items.length!==6)throw INVALID;
    var ids=new Set();
    value.items.forEach(function(row){
      if(!exact(row,['id','x','y'])||typeof row.id!=='string'||ids.has(row.id)||
        !Number.isSafeInteger(row.x)||row.x<0||row.x>100||!Number.isSafeInteger(row.y)||row.y<0||row.y>100)throw INVALID;
      ids.add(row.id);
    });
    return ids;
  }
  function context(snapshotJson,proposalJson,reply){
    if(typeof snapshotJson!=='string'||snapshotJson.length>MAX_CHARS||typeof proposalJson!=='string'||proposalJson.length>MAX_CHARS)throw INVALID;
    var snapshot=JSON.parse(snapshotJson),proposal=JSON.parse(proposalJson);
    if(!exact(snapshot,['revision','currentLayout'])||!exact(proposal,['version','expectedRevision','requestedLayout'])||proposal.version!==1||
      !Number.isSafeInteger(snapshot.revision)||snapshot.revision<0||snapshot.revision>9000000000000||proposal.expectedRevision!==snapshot.revision||
      !exact(reply,['ok','stage','draft','changes'])||reply.ok!==true||reply.stage!=='unsubmitted'||
      !exact(reply.draft,['version','expectedRevision','requestedLayout'])||reply.draft.version!==1||reply.draft.expectedRevision!==snapshot.revision||
      canonical(reply.draft.requestedLayout)!==canonical(proposal.requestedLayout)||!Array.isArray(reply.changes))throw INVALID;
    var ids=layout(snapshot.currentLayout),requestedIds=layout(reply.draft.requestedLayout);
    if(ids.size!==requestedIds.size||!Array.from(ids).every(function(id){return requestedIds.has(id);}))throw INVALID;
    var original=new Map(snapshot.currentLayout.items.map(function(row){return [row.id,row];})),changes=[];
    reply.draft.requestedLayout.items.forEach(function(row){
      var previous=original.get(row.id);
      if(row.x!==previous.x||row.y!==previous.y)changes.push({id:row.id,from:{x:previous.x,y:previous.y},to:{x:row.x,y:row.y}});
    });
    if(canonical(reply.changes)!==canonical(changes))throw INVALID;
    return {revision:snapshot.revision,current:snapshot.currentLayout,requested:reply.draft.requestedLayout,ids:Array.from(ids).sort()};
  }
  function add(a,b){var value=a+b;if(!Number.isSafeInteger(value))throw UNSAFE;return value;}
  function subtract(a,b){var value=a-b;if(!Number.isSafeInteger(value))throw UNSAFE;return value;}
  function multiply(a,b){var value=a*b;if(!Number.isSafeInteger(value))throw UNSAFE;return value;}
  function footprints(raw,ids){
    if(typeof raw!=='string'||raw.length>MAX_CHARS)throw INVALID;
    var value=JSON.parse(raw);
    if(!exact(value,['version','coordinateSpace','items'])||value.version!==1||value.coordinateSpace!==SPACE||!Array.isArray(value.items)||value.items.length!==ids.length)throw INVALID;
    var rows=new Map();
    value.items.forEach(function(row){
      if(!exact(row,['id','minX','minY','maxX','maxY'])||!ids.includes(row.id)||rows.has(row.id)||
        !['minX','minY','maxX','maxY'].every(function(k){return Number.isSafeInteger(row[k]);})||row.minX>=row.maxX||row.minY>=row.maxY)throw INVALID;
      subtract(row.maxX,row.minX);subtract(row.maxY,row.minY);
      rows.set(row.id,row);
    });
    return rows;
  }
  function endpoint(layoutValue,provided,ids){
    var positions=new Map(layoutValue.items.map(function(row){return [row.id,row];}));
    var rectangles=ids.map(function(id){
      var at=positions.get(id),f=provided.get(id);
      return {id:id,minX:add(at.x,f.minX),minY:add(at.y,f.minY),maxX:add(at.x,f.maxX),maxY:add(at.y,f.maxY)};
    });
    var pairs=[];
    for(var i=0;i<rectangles.length;i++)for(var j=i+1;j<rectangles.length;j++){
      var a=rectangles[i],b=rectangles[j];
      // Check negative gaps too: unsafe subtraction cannot become a harmless0.
      var dx=subtract(Math.min(a.maxX,b.maxX),Math.max(a.minX,b.minX));
      var dy=subtract(Math.min(a.maxY,b.maxY),Math.max(a.minY,b.minY));
      var width=Math.max(0,dx),height=Math.max(0,dy),area=multiply(width,height);
      pairs.push({ids:[a.id,b.id],relation:dx<0||dy<0?'separate':dx===0||dy===0?'touch':'overlap',
        overlapWidth:width,overlapHeight:height,overlapArea:area});
    }
    return {rectangles:rectangles,pairs:pairs};
  }
  function inspect(snapshotJson,proposalJson,footprintJson){
    var reply,basis;
    try{
      reply=capture(inspectIntent.call(Intent,snapshotJson,proposalJson));
      if(exact(reply,['ok','error'])&&reply.ok===false&&['invalid_snapshot','invalid_proposal','stale_revision'].includes(reply.error))return failure(reply.error);
      basis=context(snapshotJson,proposalJson,reply);
    }catch(error){return failure('invalid_dependency');}
    try{
      var provided=footprints(footprintJson,basis.ids);
      var before=endpoint(basis.current,provided,basis.ids),after=endpoint(basis.requested,provided,basis.ids),changes=[];
      before.pairs.forEach(function(pair,i){
        var next=after.pairs[i];
        if(pair.relation!==next.relation||pair.overlapWidth!==next.overlapWidth||pair.overlapHeight!==next.overlapHeight||pair.overlapArea!==next.overlapArea)
          changes.push({ids:pair.ids.slice(),before:pair,after:next});
      });
      return freeze({ok:true,scope:SCOPE,coordinateSpace:SPACE,expectedRevision:basis.revision,before:before,after:after,changes:changes});
    }catch(error){return failure(error===UNSAFE?'unsafe_arithmetic':'invalid_footprint');}
  }
  return Object.freeze({version:1,inspect:inspect});
}));

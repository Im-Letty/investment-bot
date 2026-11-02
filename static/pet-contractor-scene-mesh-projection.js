/* Read-only projection of actual captured source Mesh buffers, never clearance. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.PetContractorSceneMeshProjection=factory();
}(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var IDS=['home','cafe','shop','playground','tree','flowers'];
  var LIMITS=Object.freeze({meshes:2048,positions:1000000,indices:3000000,nodes:16000,batchRows:100000});
  var FAIL={};
  function refuse(code){FAIL.code=code;throw FAIL;}
  function finite(n){return typeof n==='number'&&Number.isFinite(n);}
  function integer(n){return Number.isSafeInteger(n)&&n>=0;}
  function plain(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
  function exact(value,keys){return plain(value)&&Reflect.ownKeys(value).length===keys.length&&keys.every(function(k){var p=Object.getOwnPropertyDescriptor(value,k);return p&&Object.prototype.hasOwnProperty.call(p,'value');});}
  function text(value){return typeof value==='string'?value:'';}
  function freeze(value){
    if(value&&typeof value==='object'){Object.keys(value).forEach(function(k){freeze(value[k]);});Object.freeze(value);}
    return value;
  }
  function point(value){
    if(!plain(value))refuse('invalid_context');
    var x=value.x,y=value.y;if(!finite(x)||!finite(y))refuse('invalid_context');
    return{x:x,y:y};
  }
  function place(value){
    if(!plain(value)||!IDS.includes(value.id))refuse('invalid_context');
    var p=point(value),f=value.footprint,e=value.entrance;
    if(!plain(f))refuse('invalid_context');
    var fp=point(f),rx=f.rx,ry=f.ry;
    if(!finite(rx)||!finite(ry)||rx<=0||ry<=0)refuse('invalid_context');
    return{id:value.id,x:p.x,y:p.y,footprint:{x:fp.x,y:fp.y,rx:rx,ry:ry},entrance:point(e)};
  }
  function placeMap(value){
    if(!plain(value)||!Array.isArray(value.places)||value.places.length!==IDS.length)refuse('invalid_context');
    var out=new Map();value.places.forEach(function(p){var c=place(p);if(out.has(c.id))refuse('invalid_context');out.set(c.id,c);});
    if(!IDS.every(function(id){return out.has(id);}))refuse('invalid_context');
    return out;
  }
  function provided(value){
    if(!exact(value,['version','theme','items'])||value.version!==1||value.theme!=='cafe'||!Array.isArray(value.items)||value.items.length!==IDS.length)refuse('invalid_context');
    var out=new Map();value.items.forEach(function(p){
      if(!exact(p,['id','x','y'])||!IDS.includes(p.id)||out.has(p.id)||!integer(p.x)||p.x>100||!integer(p.y)||p.y>100)refuse('invalid_context');
      out.set(p.id,{x:p.x,y:p.y});
    });return out;
  }
  function matrix(value){
    var a=value&&value.elements;
    if(!a||a.length!==16)refuse('invalid_matrix');
    var out=Array.from(a);if(!out.every(finite)||out[3]!==0||out[7]!==0||out[11]!==0||out[15]!==1)refuse('invalid_matrix');
    return out;
  }
  function identity(a){return a.every(function(v,i){return v===(i%5===0?1:0);});}
  function counts(){return{meshCount:0,positionCount:0,triangleCount:0,spriteCount:0,batchedOriginalCount:0,nonSolidWaterMeshCount:0,nonSolidWindowMeshCount:0,otherObjectCount:0};}
  function capture(options){
    try{
      if(!exact(options,['THREE','built','world','providedLayout','townBefore']))refuse('invalid_context');
      var T=options.THREE,built=options.built,world=options.world,before=options.townBefore,layout=options.providedLayout;
      var Vector3=T&&T.Vector3;if(typeof Vector3!=='function'||!plain(built)||!built.scene||built.scene.isScene!==true)refuse('invalid_context');
      var vector=new Vector3(),set=vector.set,apply=vector.applyMatrix4;
      if(typeof set!=='function'||typeof apply!=='function')refuse('invalid_context');
      var width=world&&world.width,height=world&&world.height;
      if(!finite(width)||!finite(height)||width<=0||height<=0||before.width!==width||before.height!==height)refuse('invalid_context');
      var current=placeMap(world),prior=placeMap(before),saved=provided(layout);
      var groups=built.placeGroups,batches=built.batches;
      if(!Array.isArray(groups)||groups.length!==IDS.length||!Array.isArray(batches)||batches.length>LIMITS.batchRows)refuse('invalid_context');
      var groupMap=new Map(),batchMap=new Map(),batchRows=0;
      groups.forEach(function(g){
        var id=g&&g.userData&&g.userData.placeId;
        if(!g||g.isGroup!==true||!IDS.includes(id)||groupMap.has(id))refuse('invalid_context');
        groupMap.set(id,g);
      });
      batches.forEach(function(b){
        if(!b||!Array.isArray(b.rows)||!b.mesh||b.mesh.isInstancedMesh!==true||b.rows.length!==b.mesh.count)refuse('invalid_batch');
        batchRows+=b.rows.length;if(batchRows>LIMITS.batchRows)refuse('size_limit');
        b.rows.forEach(function(row,i){if(!row||row.isMesh!==true||batchMap.has(row))refuse('invalid_batch');batchMap.set(row,{batch:b,index:i});});
      });
      var totals=counts(),globalNodes=0,seenNodes=new Set(),seenMeshes=new Set(),places=[];
      IDS.forEach(function(id){
        var group=groupMap.get(id),origin=matrix(group.matrixWorld),post=current.get(id),old=prior.get(id),percent=saved.get(id);
        if(Math.abs(origin[12]-(post.footprint.x-width/2)/100)>1e-10||Math.abs(origin[14]-(post.footprint.y-height/2)/100)>1e-10)refuse('mapping_mismatch');
        var meshes=[],sprites=[],coverage=counts(),stack=[group];
        while(stack.length){
          var node=stack.pop();if(!node||seenNodes.has(node))refuse('invalid_scene_tree');seenNodes.add(node);
          if(++globalNodes>LIMITS.nodes)refuse('size_limit');
          if(!Array.isArray(node.children))refuse('invalid_scene_tree');
          for(var c=node.children.length-1;c>=0;c--)stack.push(node.children[c]);
          if(node.isSkinnedMesh||node.isInstancedMesh||node.isLine||node.isPoints)refuse('unsupported_object');
          if(node.isSprite){
            var sm=matrix(node.matrixWorld),su=node.userData||{};
            sprites.push({name:text(node.name),kind:text(su.originalArtKind||su.kind),visibleAtCapture:node.visible===true,
              originalArt:su.originalArt===true,sourceSHA256:typeof su.sourceSHA256==='string'?su.sourceSHA256:null,
              worldOrigin:{x:sm[12],y:sm[13],z:sm[14]}});coverage.spriteCount++;continue;
          }
          if(!node.isMesh){if(node!==group&&node.isGroup!==true)coverage.otherObjectCount++;continue;}
          if(seenMeshes.has(node))refuse('duplicate_mesh');seenMeshes.add(node);
          var g=node.geometry,a=g&&g.attributes&&g.attributes.position,index=g&&g.index;
          if(!g||g.isBufferGeometry!==true||!a||a.isBufferAttribute!==true||a.isInterleavedBufferAttribute||a.itemSize!==3||a.normalized||!integer(a.count)||a.count===0||
              !ArrayBuffer.isView(a.array)||a.array.length!==a.count*3||!['Float32Array','Float64Array'].includes(a.array.constructor.name))refuse('unsupported_geometry');
          if(g.morphAttributes&&Object.keys(g.morphAttributes).some(function(k){return g.morphAttributes[k]&&g.morphAttributes[k].length;}))refuse('unsupported_geometry');
          var indexCount=index?index.count:a.count;
          if(!integer(indexCount)||indexCount===0||indexCount%3!==0||index&&(index.isBufferAttribute!==true||index.itemSize!==1||index.normalized||!ArrayBuffer.isView(index.array)||index.array.length!==indexCount||!['Uint8Array','Uint16Array','Uint32Array'].includes(index.array.constructor.name)))refuse('invalid_index');
          coverage.meshCount++;coverage.positionCount+=a.count;coverage.triangleCount+=indexCount/3;
          if(totals.meshCount+coverage.meshCount>LIMITS.meshes||totals.positionCount+coverage.positionCount>LIMITS.positions||
              (totals.triangleCount+coverage.triangleCount)*3>LIMITS.indices)refuse('size_limit');
          var indices=[];
          for(var i=0;i<indexCount;i++){
            var n=index?index.array[i]:i;if(!integer(n)||n>=a.count)refuse('invalid_index');indices.push(n);
          }
          var m=matrix(node.matrixWorld),positions=[],xz=[];
          for(var p=0;p<a.count;p++){
            var x=a.array[p*3],y=a.array[p*3+1],z=a.array[p*3+2];if(!finite(x)||!finite(y)||!finite(z))refuse('nonfinite_geometry');
            set.call(vector,x,y,z);apply.call(vector,{elements:m});
            var vx=vector.x,vy=vector.y,vz=vector.z;if(!finite(vx)||!finite(vy)||!finite(vz))refuse('nonfinite_geometry');
            positions.push(vx,vy,vz);xz.push(vx,vz);
          }
          var range=g.drawRange,geometryGroups=g.groups,drawRange;
          if(!range||!integer(range.start)||range.start>indexCount||!(range.count===Infinity||integer(range.count)))refuse('unsupported_geometry');
          drawRange={start:range.start,count:range.count===Infinity?null:range.count};
          if(!Array.isArray(geometryGroups))refuse('unsupported_geometry');
          var copiedGroups=geometryGroups.map(function(r){if(!r||!integer(r.start)||!integer(r.count)||!integer(r.materialIndex)||r.start+r.count>indexCount)refuse('unsupported_geometry');return{start:r.start,count:r.count,materialIndex:r.materialIndex};});
          var bm=batchMap.get(node),packed=null,batchName=null,batchIndex=null;
          if(bm){
            var bmesh=bm.batch.mesh,ba=bmesh.instanceMatrix&&bmesh.instanceMatrix.array;
            if(!ba||ba.length!==bm.batch.rows.length*16||!identity(matrix(bmesh.matrixWorld)))refuse('invalid_batch');
            packed=Array.from(ba.slice(bm.index*16,bm.index*16+16));
            if(!packed.every(finite)||!packed.every(function(v,k){return v===Math.fround(m[k]);}))refuse('batch_transform_mismatch');
            batchName=text(bmesh.name);batchIndex=bm.index;coverage.batchedOriginalCount++;
          }
          var ud=node.userData||{},water=ud.nonSolidWater===true,windowPart=ud.nonSolidWindow===true;
          if(water)coverage.nonSolidWaterMeshCount++;if(windowPart)coverage.nonSolidWindowMeshCount++;
          meshes.push({id:id+':mesh:'+String(meshes.length).padStart(4,'0'),name:text(node.name),geometryType:text(g.type),
            positionArrayType:a.array.constructor.name,indexArrayType:index?index.array.constructor.name:null,
            worldPositions:positions,xzPositions:xz,indices:indices,positionCount:a.count,triangleCount:indexCount/3,indexWasPresent:!!index,
            matrixWorld:m,visibleAtCapture:node.visible===true,batchedOriginal:!!bm,batchName:batchName,batchInstanceIndex:batchIndex,batchInstanceMatrix:packed,
            nonSolidWater:water,nonSolidWindow:windowPart,drawRange:drawRange,geometryGroups:copiedGroups});
        }
        if(['home','cafe','shop','playground'].includes(id)&&coverage.meshCount===0)refuse('missing_place_meshes');
        Object.keys(totals).forEach(function(k){totals[k]+=coverage[k];});
        coverage.renderedCoverageComplete=false;
        places.push({id:id,mapping:{providedPercent:percent,townBefore:old,sceneEffective:post,worldOrigin:{x:origin[12],y:origin[13],z:origin[14]}},
          meshes:meshes,sprites:sprites,coverage:coverage});
      });
      if(totals.meshCount===0)refuse('missing_place_meshes');
      return freeze({ok:true,version:1,scope:'actual_scene_place_mesh_projection',coordinateSpace:'scene_world_xyz_and_xz',worldSize:{width:width,height:height},
        originalArtState:text(built.scene.userData&&built.scene.userData.originalArtState),originalArtResourceState:text(built.originalArt&&built.originalArt.state),
        mappingValidation:'Captured caller context and effective group origins; provided layout is not independently rebuilt or authenticated by this reader.',
        geometryScope:'All stored triangles/positions of supported original Mesh objects under the six place groups, including render-hidden batch originals once. Not renderer draw coverage.',
        batchMatrixScope:'Original Mesh matrixWorld is projected in JavaScript precision; recorded render-instance matrices are Float32-packed copies, not a pixel or GPU round-trip proof.',
        drawScope:'drawRange and geometry groups are retained metadata; complete stored buffer projection does not assert that every triangle is currently drawn.',
        places:places,totals:totals,gaps:['Original Sprite art is not a measured closed volume; unloaded Sprite structure is not decoded artwork.',
          'Environment, roads, shores, water beyond these place groups, seasonal accents and all other scene objects are outside this report.',
          'Non-solid water/window tags are reported, not silently removed or interpreted as contractor collision policy.',
          'Projection is not intersection, clearance, a swept path, navigation, physics, body fit or construction permission.'],
        collisionOrClearanceAssessed:false,gameOrStorageConnected:false,mutationsPerformed:false});
    }catch(error){return Object.freeze({ok:false,error:error===FAIL?FAIL.code:'capture_failed'});}
  }
  return Object.freeze({capture:capture,limits:LIMITS});
}));

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Town from '../static/pet-town-walk.js';
import Scene from '../static/pet-town-scene.js';
import Projection from '../static/pet-contractor-scene-mesh-projection.js';

const IDS=['home','cafe','shop','playground','tree','flowers'];
const BASE={version:1,theme:'cafe',items:[{id:'home',x:0,y:0},{id:'cafe',x:72,y:23},{id:'shop',x:22,y:65},{id:'playground',x:72,y:65},{id:'tree',x:48,y:44},{id:'flowers',x:48,y:83}]};
const clone=x=>JSON.parse(JSON.stringify(x));
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const bytes=x=>Buffer.from(x.buffer,x.byteOffset,x.byteLength);
function meshSignature(built){
  const out=[];
  for(const g of built.placeGroups)g.traverse(m=>{if(!m.isMesh)return;out.push({name:m.name,matrix:m.matrixWorld.toArray(),position:hash(bytes(m.geometry.attributes.position.array)),index:m.geometry.index?hash(bytes(m.geometry.index.array)):null,visible:m.visible});});
  return JSON.stringify(out);
}
function read(built,world,providedLayout,townBefore,T=THREE){return Projection.capture({THREE:T,built,world,providedLayout,townBefore});}
function frozen(value){assert.ok(Object.isFrozen(value));for(const v of Object.values(value))if(v&&typeof v==='object')frozen(v);}
function mapping(p){return{id:p.id,x:p.x,y:p.y,footprint:clone(p.footprint),entrance:clone(p.entrance)};}
let actual;
function actualFixture(){
  if(actual)return actual;
  const layout=clone(BASE),layoutBefore=JSON.stringify(layout),world=Town.createWorld(layout),before=clone(world),counts={TextureLoader:0,fetch:0,Image:0};
  const priorFetch=globalThis.fetch,priorImage=globalThis.Image;
  class ForbiddenLoader{constructor(){counts.TextureLoader++;throw Error('fixture forbids art loader');}}
  const T={...THREE,TextureLoader:ForbiddenLoader};
  globalThis.fetch=()=>{counts.fetch++;throw Error('fixture forbids network');};
  globalThis.Image=class{constructor(){counts.Image++;throw Error('fixture forbids image construction');}};
  let built;
  try{built=Scene.buildWorld(T,world,{},null,null,'summer');built.scene.updateMatrixWorld(true);}
  finally{globalThis.fetch=priorFetch;if(priorImage===undefined)delete globalThis.Image;else globalThis.Image=priorImage;}
  const stateBefore=JSON.stringify(world),signatureBefore=meshSignature(built),report=read(built,world,layout,before,T);
  actual={layout,layoutBefore,world,before,built,counts,stateBefore,signatureBefore,report};
  return actual;
}
function synthetic(){
  const layout=clone(BASE),world=Town.createWorld(layout),before=clone(world),scene=new THREE.Scene(),groups=[],geometry=new THREE.BoxGeometry(.8,1,.6),material=new THREE.MeshBasicMaterial();
  scene.userData.originalArtState='pending';
  for(const p of world.places){
    const g=new THREE.Group(),q=Scene.groundPoint(world,p.footprint);g.userData.placeId=p.id;g.position.set(q.x,.025,q.z);scene.add(g);groups.push(g);
    if(['tree','flowers'].includes(p.id)){const s=new THREE.Sprite(new THREE.SpriteMaterial());s.name=p.id+'-unloaded-sprite';s.visible=false;s.userData={originalArt:true,originalArtKind:p.id};g.add(s);}
    else{const m=new THREE.Mesh(geometry.clone(),material);m.name=p.id+'-controlled-box';g.add(m);}
  }
  scene.updateMatrixWorld(true);
  const built={scene,placeGroups:groups,batches:[],originalArt:{state:'idle'}};
  return{layout,world,before,built,mesh:groups[0].children[0],capture(){return read(built,world,layout,before);}};
}
function fail(f,error){assert.deepEqual(f.capture(),{ok:false,error});}
test.after(()=>{
  if(actual&&process.env.SCENE_MESH_PROJECTION_EVIDENCE_DIR){
    const f=actual,rows=[];
    for(const place of f.report.places){
      const source=[];f.built.placeGroups.find(g=>g.userData.placeId===place.id).traverse(m=>{if(m.isMesh)source.push(m);});
      rows.push({id:place.id,mapping:place.mapping,coverage:place.coverage,sprites:place.sprites,meshes:place.meshes.map((m,i)=>{
        const a=source[i].geometry.attributes.position,index=source[i].geometry.index;
        return{id:m.id,name:m.name,positionCount:m.positionCount,triangleCount:m.triangleCount,
          originalPositionArrayType:a.array.constructor.name,originalPositionBytes:a.array.byteLength,originalPositionSHA256:hash(bytes(a.array)),
          originalIndexArrayType:index?index.array.constructor.name:null,originalIndexBytes:index?index.array.byteLength:0,originalIndexSHA256:index?hash(bytes(index.array)):null,
          capturedMatrixFloat64SHA256:hash(bytes(new Float64Array(m.matrixWorld))),capturedWorldPositionsFloat64SHA256:hash(bytes(new Float64Array(m.worldPositions))),
          capturedXZPositionsFloat64SHA256:hash(bytes(new Float64Array(m.xzPositions))),capturedIndexStreamUint32SHA256:hash(bytes(new Uint32Array(m.indices))),
          originalPositionNegativeZeroCount:Array.from(a.array).filter(x=>Object.is(x,-0)).length,
          capturedWorldPositionNegativeZeroCount:m.worldPositions.filter(x=>Object.is(x,-0)).length,
          nonSolidWater:m.nonSolidWater,nonSolidWindow:m.nonSolidWindow,batchedOriginal:m.batchedOriginal,visibleAtCapture:m.visibleAtCapture,
          drawRange:m.drawRange,geometryGroups:m.geometryGroups};
      })});
    }
    const out={schema_version:1,status:'ACTUAL_CURRENT_SOURCE_MESH_OBSERVATION_NOT_FORMAL_PASS_RECEIPT',observed_at_utc:new Date().toISOString(),PID:process.pid,
      fixture_layout:f.layout,fixture_layout_JSON_SHA256:hash(JSON.stringify(f.layout)),scope:f.report.scope,coordinateSpace:f.report.coordinateSpace,
      originalArtState:f.report.originalArtState,originalArtResourceState:f.report.originalArtResourceState,forbiddenLoaderAndNetworkCalls:f.counts,
      totals:f.report.totals,places:rows,worldAndSourceBuffersUnchangedByCapture:JSON.stringify(f.world)===f.stateBefore&&meshSignature(f.built)===f.signatureBefore,
      digest_semantics:'originalPosition/Index SHA hashes captured original typed-array byte views. Computed world/XZ SHA hashes explicit Float64 copies of captured JavaScript number arrays; captured index stream SHA is an explicit Uint32 copy. None is a raw page, JSON geometry round-trip or GPU/pixel hash.',
      JSON_serialization_preserves_original_negative_zero_bytes_claimed:false,new_geometry_or_body_fit_library_credit:0,
      formal_pass_requires_separate_complete_test_transcript:true};
    const file=path.join(path.resolve(process.env.SCENE_MESH_PROJECTION_EVIDENCE_DIR),'engine-source-geometry-observation.json');
    fs.writeFileSync(file,JSON.stringify(out,null,2)+'\n',{flag:'wx',mode:0o600});
  }
  actual?.built.dispose();
});

test('normal current source builder yields six-place Mesh evidence without art loaders or network',()=>{
  const f=actualFixture(),r=f.report;
  assert.equal(r.ok,true);assert.deepEqual(r.places.map(p=>p.id),IDS);
  assert.deepEqual(f.counts,{TextureLoader:0,fetch:0,Image:0});
  assert.equal(r.originalArtState,'pending');assert.equal(r.originalArtResourceState,'idle');
  assert.ok(r.totals.meshCount>20);assert.ok(r.totals.triangleCount>100);assert.ok(r.totals.spriteCount>0);
  assert.equal(r.collisionOrClearanceAssessed,false);assert.equal(r.gameOrStorageConnected,false);
});
test('actual position and index buffers project to world XYZ and XZ using each real matrix',()=>{
  const f=actualFixture();
  for(const place of f.report.places){
    const group=f.built.placeGroups.find(g=>g.userData.placeId===place.id),source=[];group.traverse(m=>{if(m.isMesh)source.push(m);});
    assert.equal(place.meshes.length,source.length);
    for(let j=0;j<source.length;j++){
      const mesh=source[j],row=place.meshes[j],a=mesh.geometry.attributes.position,idx=mesh.geometry.index;
      assert.equal(row.positionCount,a.count);assert.equal(row.triangleCount,(idx?idx.count:a.count)/3);
      assert.deepEqual(row.indices,idx?Array.from(idx.array):Array.from({length:a.count},(_,i)=>i));
      for(const i of new Set([0,Math.floor(a.count/2),a.count-1])){
        const v=new THREE.Vector3().fromBufferAttribute(a,i).applyMatrix4(mesh.matrixWorld);
        assert.deepEqual(row.worldPositions.slice(i*3,i*3+3),v.toArray());assert.deepEqual(row.xzPositions.slice(i*2,i*2+2),[v.x,v.z]);
      }
    }
  }
});
test('mapping separates saved percentages, TownWalk clamps, and Scene-effective tree translation',()=>{
  const f=actualFixture(),home=f.report.places.find(p=>p.id==='home');
  assert.deepEqual(home.mapping.providedPercent,{x:0,y:0});assert.ok(home.mapping.townBefore.x>0&&home.mapping.townBefore.y>0);
  for(const p of f.report.places){
    const current=f.world.places.find(v=>v.id===p.id),old=f.before.places.find(v=>v.id===p.id),q=Scene.groundPoint(f.world,current.footprint);
    assert.deepEqual(p.mapping.townBefore,mapping(old));assert.deepEqual(p.mapping.sceneEffective,mapping(current));
    assert.deepEqual(p.mapping.worldOrigin,{x:q.x,y:.025,z:q.z});
    if(p.id!=='tree')assert.deepEqual(current,old);
  }
  assert.equal(JSON.stringify(f.layout),f.layoutBefore);
  assert.ok(['relocated','already-clear'].includes(f.built.treeRoadClearance.status));
});
test('hidden original Mesh parts are included once while render batches are not added as extra geometry',()=>{
  const f=actualFixture(),source=[];
  for(const g of f.built.placeGroups)g.traverse(m=>{if(m.isMesh)source.push(m);});
  const hidden=source.filter(m=>!m.visible),reported=f.report.places.flatMap(p=>p.meshes);
  assert.ok(hidden.length>0);assert.equal(reported.length,source.length);assert.equal(new Set(reported.map(r=>r.id)).size,reported.length);
  assert.equal(reported.filter(r=>r.batchedOriginal).length,f.report.totals.batchedOriginalCount);
  assert.ok(f.report.totals.batchedOriginalCount>0);
  assert.ok(reported.filter(r=>r.batchedOriginal).every(r=>r.visibleAtCapture===false&&r.batchInstanceMatrix.length===16));
});
test('capture never updates scene matrices or writes source buffers, placements, or original visibility',()=>{
  const f=actualFixture();assert.equal(JSON.stringify(f.world),f.stateBefore);assert.equal(meshSignature(f.built),f.signatureBefore);
  const s=synthetic();s.built.scene.updateMatrixWorld=()=>{throw Error('reader must not update');};
  const world=JSON.stringify(s.world),before=meshSignature(s.built);assert.equal(s.capture().ok,true);
  assert.equal(JSON.stringify(s.world),world);assert.equal(meshSignature(s.built),before);
});
test('returned data are detached and recursively frozen after later caller mutations',()=>{
  const f=synthetic(),r=f.capture();assert.equal(r.ok,true);frozen(r);
  const original=r.places[0].meshes[0].worldPositions[0],mapping=r.places[0].mapping.sceneEffective.x;
  f.mesh.geometry.attributes.position.array[0]+=10;f.world.places[0].x+=50;f.layout.items[0].x=80;
  assert.equal(r.places[0].meshes[0].worldPositions[0],original);assert.equal(r.places[0].mapping.sceneEffective.x,mapping);
  assert.throws(()=>r.places[0].meshes[0].indices.push(0),TypeError);
});
test('full stored geometry and non-solid classification remain separate from draw ranges and material groups',()=>{
  const f=synthetic();f.mesh.geometry.setDrawRange(1,2);f.mesh.geometry.clearGroups();f.mesh.geometry.addGroup(0,3,2);
  f.mesh.userData.nonSolidWater=true;f.mesh.userData.nonSolidWindow=true;
  const r=f.capture(),m=r.places[0].meshes[0];assert.equal(r.ok,true);
  assert.equal(m.triangleCount,12);assert.deepEqual(m.drawRange,{start:1,count:2});assert.deepEqual(m.geometryGroups,[{start:0,count:3,materialIndex:2}]);
  assert.equal(m.nonSolidWater,true);assert.equal(m.nonSolidWindow,true);assert.equal(r.places[0].coverage.renderedCoverageComplete,false);
  assert.equal(r.totals.nonSolidWaterMeshCount,1);assert.equal(r.totals.nonSolidWindowMeshCount,1);
});
test('missing, duplicate, or mismatched place contexts fail without defaulting to an empty result',()=>{
  const a=synthetic();a.world.places.pop();fail(a,'invalid_context');
  const b=synthetic();b.built.placeGroups[1].userData.placeId='home';fail(b,'invalid_context');
  const c=synthetic();c.built.placeGroups[0].matrixWorld.elements[12]+=1;fail(c,'mapping_mismatch');
});
test('provided input shape is strict and option accessors are refused without invocation',()=>{
  const f=synthetic();f.layout.items[1].id='home';fail(f,'invalid_context');
  let reads=0;const options={THREE,built:f.built,world:f.world,providedLayout:BASE,townBefore:f.before};
  Object.defineProperty(options,'world',{get(){reads++;return f.world;},enumerable:true});
  assert.deepEqual(Projection.capture(options),{ok:false,error:'invalid_context'});assert.equal(reads,0);
});
test('index arity, out-of-range indices and unsupported index storage fail closed',()=>{
  const a=synthetic();a.mesh.geometry.index.array[0]=65535;fail(a,'invalid_index');
  const b=synthetic();b.mesh.geometry.setIndex([0,1]);fail(b,'invalid_index');
  const c=synthetic();c.mesh.geometry.setIndex(new THREE.BufferAttribute(new Float32Array([0,1,2]),1));fail(c,'invalid_index');
});
test('a nonfinite unused stored vertex is refused rather than ignored through the active index range',()=>{
  const f=synthetic(),a=f.mesh.geometry.attributes.position,raw=new Float32Array(a.array.length+3);raw.set(a.array);raw[raw.length-3]=NaN;
  f.mesh.geometry.setAttribute('position',new THREE.BufferAttribute(raw,3));fail(f,'nonfinite_geometry');
});
test('nonfinite and projective world matrices are refused',()=>{
  const a=synthetic();a.mesh.matrixWorld.elements[4]=Infinity;fail(a,'invalid_matrix');
  const b=synthetic();b.mesh.matrixWorld.elements[3]=.01;fail(b,'invalid_matrix');
});
test('skinned, morph, instanced, and line objects are explicitly unsupported inside place groups',()=>{
  const a=synthetic();a.mesh.isSkinnedMesh=true;fail(a,'unsupported_object');
  const b=synthetic();b.mesh.geometry.morphAttributes.position=[b.mesh.geometry.attributes.position.clone()];fail(b,'unsupported_geometry');
  const c=synthetic();c.built.placeGroups[0].add(new THREE.InstancedMesh(c.mesh.geometry,c.mesh.material,1));fail(c,'unsupported_object');
  const d=synthetic();d.built.placeGroups[0].add(new THREE.Line(d.mesh.geometry,d.mesh.material));fail(d,'unsupported_object');
});
test('normalized and interleaved position formats are not silently misread as direct position buffers',()=>{
  const a=synthetic();a.mesh.geometry.attributes.position.normalized=true;fail(a,'unsupported_geometry');
  const b=synthetic();b.mesh.geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(new Float32Array(9),3),3,0));fail(b,'unsupported_geometry');
});
test('shared or cyclic scene-tree ownership is refused instead of duplicating geometry',()=>{
  const a=synthetic();a.built.placeGroups[1].children.push(a.mesh);fail(a,'invalid_scene_tree');
  const b=synthetic();b.built.placeGroups[0].children.push(b.built.placeGroups[0]);fail(b,'invalid_scene_tree');
});
function installBatch(f){
  const mesh=new THREE.InstancedMesh(f.mesh.geometry,f.mesh.material,1);mesh.setMatrixAt(0,f.mesh.matrixWorld);mesh.name='controlled-batch';f.built.scene.add(mesh);mesh.updateMatrixWorld(true);f.mesh.visible=false;
  f.built.batches=[{mesh,rows:[f.mesh],dynamic:false}];return mesh;
}
test('batch row ownership and instance cardinality must be unambiguous',()=>{
  const a=synthetic();installBatch(a);a.built.batches.push(a.built.batches[0]);fail(a,'invalid_batch');
  const b=synthetic(),batch=installBatch(b);batch.count=2;fail(b,'invalid_batch');
});
test('packed render-instance transforms must agree with the original Mesh world matrix at Float32 precision',()=>{
  const a=synthetic(),batch=installBatch(a);assert.equal(a.capture().ok,true);batch.instanceMatrix.array[12]+=1;fail(a,'batch_transform_mismatch');
  const b=synthetic(),m=installBatch(b);m.matrixWorld.elements[12]=1;fail(b,'invalid_batch');
});
test('bounded position work is enforced before allocating the projected result',()=>{
  const f=synthetic();f.mesh.geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array((Projection.limits.positions+1)*3),3));fail(f,'size_limit');
});
test('unexpected host getter exceptions produce a safe error without exposing thrown contents',()=>{
  const f=synthetic();Object.defineProperty(f.world,'width',{get(){throw Error('private host detail');}});
  assert.deepEqual(f.capture(),{ok:false,error:'capture_failed'});
});
test('repeated explicit capture is deterministic and unsupported empty building coverage is rejected',()=>{
  const f=synthetic();assert.deepEqual(f.capture(),f.capture());f.built.placeGroups[0].clear();fail(f,'missing_place_meshes');
});

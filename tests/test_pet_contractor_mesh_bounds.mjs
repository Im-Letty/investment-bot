import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Town from '../static/pet-town-walk.js';
import Scene from '../static/pet-town-scene.js';
import Projection from '../static/pet-contractor-scene-mesh-projection.js';
import Bounds from '../static/pet-contractor-mesh-bounds.js';

const IDS=['home','cafe','shop','playground','tree','flowers'];
const C_KEYS=['meshCount','positionCount','triangleCount','spriteCount','batchedOriginalCount','nonSolidWaterMeshCount','nonSolidWindowMeshCount','otherObjectCount'];
const IDENTITY=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const clone=x=>JSON.parse(JSON.stringify(x));
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const byteView=x=>Buffer.from(x.buffer,x.byteOffset,x.byteLength);
const counts=()=>Object.fromEntries(C_KEYS.map(k=>[k,0]));
function recalc(f){
  f.totals=counts();
  for(const p of f.places){
    p.coverage={...counts(),renderedCoverageComplete:false};
    for(const m of p.meshes){p.coverage.meshCount++;p.coverage.positionCount+=m.positionCount;p.coverage.triangleCount+=m.triangleCount;for(const [flag,k] of [['batchedOriginal','batchedOriginalCount'],['nonSolidWater','nonSolidWaterMeshCount'],['nonSolidWindow','nonSolidWindowMeshCount']])if(m[flag])p.coverage[k]++;}
    p.coverage.spriteCount=p.sprites.length;
    for(const k of C_KEYS)f.totals[k]+=p.coverage[k];
  }
  return f;
}
function setPoints(m,points){m.worldPositions=points.flatMap(([x,z])=>[x,0,z]);m.xzPositions=points.flat();m.positionCount=points.length;return m;}
function fixture(){
  const f={ok:true,version:1,scope:'actual_scene_place_mesh_projection',coordinateSpace:'scene_world_xyz_and_xz',worldSize:{width:2880,height:1920},originalArtState:'controlled_no_art',originalArtResourceState:'idle',mappingValidation:'Controlled explicit fixture only.',geometryScope:'Stored numeric triangles.',batchMatrixScope:'No batches.',drawScope:'Metadata is not draw coverage.',places:[],totals:counts(),gaps:['Unmeasured objects remain outside.'],collisionOrClearanceAssessed:false,gameOrStorageConnected:false,mutationsPerformed:false};
  for(let i=0;i<IDS.length;i++){
    const id=IDS[i],position={id,x:1,y:1,footprint:{x:1,y:1,rx:1,ry:1},entrance:{x:1,y:1}};
    const p={id,mapping:{providedPercent:{x:22,y:23},townBefore:clone(position),sceneEffective:clone(position),worldOrigin:{x:0,y:0,z:0}},meshes:[],sprites:[],coverage:{...counts(),renderedCoverageComplete:false}};
    if(i<4){
      const m={id:id+':mesh:0000',name:'known-triangle',geometryType:'BufferGeometry',positionArrayType:'Float64Array',indexArrayType:'Uint32Array',worldPositions:[],xzPositions:[],indices:[0,1,2],positionCount:3,triangleCount:1,indexWasPresent:true,matrixWorld:IDENTITY.slice(),visibleAtCapture:true,batchedOriginal:false,batchName:null,batchInstanceIndex:null,batchInstanceMatrix:null,nonSolidWater:false,nonSolidWindow:false,drawRange:{start:0,count:null},geometryGroups:[]};
      setPoints(m,[[i*3,0],[i*3+1,0],[i*3,1]]);p.meshes.push(m);
    }else p.sprites.push({name:'not-measured',kind:id,visibleAtCapture:false,originalArt:true,sourceSHA256:null,worldOrigin:{x:0,y:0,z:0}});
    f.places.push(p);
  }
  return recalc(f);
}
function read(f){return Bounds.inspect(JSON.stringify(f));}
function pair(r,a='home',b='cafe'){return r.pairs.find(p=>p.ids[0]===a&&p.ids[1]===b);}
function deepFrozen(value){assert.equal(Object.isFrozen(value),true);for(const v of Object.values(value))if(v&&typeof v==='object')deepFrozen(v);}
function signature(built){
  const rows=[];
  for(const g of built.placeGroups)g.traverse(m=>{if(m.isMesh)rows.push({name:m.name,matrix:m.matrixWorld.toArray(),position:hash(byteView(m.geometry.attributes.position.array)),index:m.geometry.index?hash(byteView(m.geometry.index.array)):null,visible:m.visible});});
  return JSON.stringify(rows);
}
let actual;
function actualFixture(){
  if(actual)return actual;
  const providedLayout={version:1,theme:'cafe',items:IDS.map((id,i)=>({id,x:[22,72,22,72,48,48][i],y:[23,23,65,65,44,83][i]}))};
  const layoutBefore=JSON.stringify(providedLayout),world=Town.createWorld(providedLayout),townBefore=clone(world),calls={TextureLoader:0,fetch:0,Image:0};
  const priorFetch=globalThis.fetch,priorImage=globalThis.Image;
  const T={...THREE,TextureLoader:class{constructor(){calls.TextureLoader++;throw Error('forbidden_art_loader');}}};
  globalThis.fetch=()=>{calls.fetch++;throw Error('forbidden_network');};globalThis.Image=class{constructor(){calls.Image++;throw Error('forbidden_image');}};
  let built;
  try{
    built=Scene.buildWorld(T,world,{},null,null,'summer');built.scene.updateMatrixWorld(true);
    const sourceBefore=signature(built),worldBefore=JSON.stringify(world);
    const projection=Projection.capture({THREE:T,built,world,providedLayout,townBefore});assert.equal(projection.ok,true);
    const projectionJSON=JSON.stringify(projection),result=Bounds.inspect(projectionJSON);
    assert.equal(result.ok,true);assert.equal(signature(built),sourceBefore);assert.equal(JSON.stringify(world),worldBefore);assert.equal(JSON.stringify(providedLayout),layoutBefore);
    actual={projection,result,calls,projectionJSONCharacters:projectionJSON.length,projectionJSONSHA256:hash(projectionJSON),sourceBeforeSHA256:hash(sourceBefore),sourceAfterSHA256:hash(signature(built)),worldBeforeSHA256:hash(worldBefore),worldAfterSHA256:hash(JSON.stringify(world)),providedLayout};
  }finally{globalThis.fetch=priorFetch;if(priorImage===undefined)delete globalThis.Image;else globalThis.Image=priorImage;built?.dispose();}
  return actual;
}
test.after(()=>{
  if(actual&&process.env.MESH_BOUNDS_EVIDENCE_DIR){
    const f=actual,v={schema_version:1,status:'ACTUAL_CURRENT_SOURCE_OBSERVATION_REQUIRES_SEPARATE_FORMAL_TRANSCRIPT',observed_at_utc:new Date().toISOString(),scope:f.result.scope,coordinateSpace:f.result.coordinateSpace,providedLayout:f.providedLayout,projectionJSONCharacters:f.projectionJSONCharacters,projectionJSONSHA256:f.projectionJSONSHA256,projectionJSONSHAIsExplicitNumericSerializationNotOriginalBufferSHA:true,sourceMeshSignatureBeforeSHA256:f.sourceBeforeSHA256,sourceMeshSignatureAfterSHA256:f.sourceAfterSHA256,worldBeforeSHA256:f.worldBeforeSHA256,worldAfterSHA256:f.worldAfterSHA256,forbiddenCalls:f.calls,sourceProjectionTotals:f.projection.totals,derivedTotals:f.result.totals,places:f.result.places.map(p=>({...p,meshes:p.meshes.map(m=>({id:m.id,bounds:m.bounds,storedVertexCount:m.storedVertexCount,referencedVertexCount:m.referencedVertexCount,unreferencedVertexCount:m.unreferencedVertexCount,triangleCount:m.triangleCount,visibleAtCapture:m.visibleAtCapture,batchedOriginal:m.batchedOriginal,nonSolidWater:m.nonSolidWater,nonSolidWindow:m.nonSolidWindow,drawRange:m.drawRange,geometryGroupCount:m.geometryGroupCount}))})),pairs:f.result.pairs,collisionOrClearanceAssessed:false,gameOrStorageConnected:false,newGeometryBodyFitLibraryCredit:0};
    fs.writeFileSync(path.join(path.resolve(process.env.MESH_BOUNDS_EVIDENCE_DIR),'engine-mesh-bounds-observation.json'),JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});
  }
});

test('current source builds once and yields6places15pairs without art/network or source mutation',()=>{
  const f=actualFixture();assert.deepEqual(f.calls,{TextureLoader:0,fetch:0,Image:0});assert.deepEqual(f.result.places.map(p=>p.id),IDS);assert.equal(f.result.pairs.length,15);assert.equal(f.result.collisionOrClearanceAssessed,false);assert.equal(f.result.gameOrStorageConnected,false);assert.equal(f.sourceBeforeSHA256,f.sourceAfterSHA256);assert.equal(f.worldBeforeSHA256,f.worldAfterSHA256);
});
test('every actual envelope is independently derived from exactly the referenced stored vertices',()=>{
  const f=actualFixture();
  for(const p of f.projection.places){
    const out=f.result.places.find(x=>x.id===p.id);let stored=0,referenced=0;const all=[];
    for(const m of p.meshes){
      const unique=[...new Set(m.indices)],points=unique.map(n=>[m.xzPositions[n*2],m.xzPositions[n*2+1]]),r=out.meshes.find(x=>x.id===m.id);
      const minX=Math.min(...points.map(x=>x[0])),maxX=Math.max(...points.map(x=>x[0])),minZ=Math.min(...points.map(x=>x[1])),maxZ=Math.max(...points.map(x=>x[1]));
      assert.deepEqual(r.bounds,{minX,minZ,maxX,maxZ});assert.equal(r.referencedVertexCount,unique.length);assert.equal(r.unreferencedVertexCount,m.positionCount-unique.length);stored+=m.positionCount;referenced+=unique.length;all.push([minX,minZ],[maxX,maxZ]);
    }
    assert.equal(out.storedVertexCount,stored);assert.equal(out.referencedVertexCount,referenced);assert.equal(out.unreferencedVertexCount,stored-referenced);
    assert.deepEqual(out.measuredMeshBounds,all.length?{minX:Math.min(...all.map(x=>x[0])),minZ:Math.min(...all.map(x=>x[1])),maxX:Math.max(...all.map(x=>x[0])),maxZ:Math.max(...all.map(x=>x[1]))}:null);
  }
});
test('separate known unit envelopes report exact negative spans and positive axis gaps',()=>{
  const r=read(fixture());assert.deepEqual(pair(r),{ids:['home','cafe'],relation:'bounds_separate',axisSpans:{signedOverlapX:-2,signedOverlapZ:1,gapX:2,gapZ:0,overlapX:0,overlapZ:1}});
});
test('one exact coincident edge is bounds_touch without a collision claim',()=>{
  const f=fixture();setPoints(f.places[1].meshes[0],[[1,0],[2,0],[1,1]]);const r=read(f);assert.equal(pair(r).relation,'bounds_touch');assert.equal(pair(r).axisSpans.signedOverlapX,0);assert.equal(r.collisionOrClearanceAssessed,false);
});
test('positive envelope spans produce bounds_overlap with no epsilon',()=>{
  const f=fixture();setPoints(f.places[1].meshes[0],[[.5,.5],[1.5,.5],[.5,1.5]]);const r=read(f);assert.equal(pair(r).relation,'bounds_overlap');assert.equal(pair(r).axisSpans.overlapX,.5);assert.equal(pair(r).axisSpans.overlapZ,.5);
});
test('negative coordinates and enclosure have the expected finite axis spans',()=>{
  const f=fixture();setPoints(f.places[0].meshes[0],[[-3,-3],[3,-3],[-3,3]]);setPoints(f.places[1].meshes[0],[[-1,-1],[1,-1],[-1,1]]);const r=read(f);assert.equal(pair(r).relation,'bounds_overlap');assert.equal(pair(r).axisSpans.overlapX,2);assert.equal(pair(r).axisSpans.overlapZ,2);
});
test('far stored but unreferenced vertex never expands the triangle envelope',()=>{
  const f=fixture();setPoints(f.places[0].meshes[0],[[0,0],[1,0],[0,1],[10000,-10000]]);recalc(f);const r=read(f),p=r.places[0];assert.deepEqual(p.measuredMeshBounds,{minX:0,minZ:0,maxX:1,maxZ:1});assert.equal(p.storedVertexCount,4);assert.equal(p.referencedVertexCount,3);assert.equal(p.unreferencedVertexCount,1);assert.equal(pair(r).relation,'bounds_separate');
});
test('unreferenced malformed positions are rejected instead of skipped',()=>{
  const f=fixture();setPoints(f.places[0].meshes[0],[[0,0],[1,0],[0,1],[99,99]]);recalc(f);f.places[0].meshes[0].worldPositions[9]=null;assert.deepEqual(read(f),{ok:false,error:'invalid_projection'});
});
test('collinear and point projections remain measured and point enclosure is bounds_touch',()=>{
  const f=fixture();setPoints(f.places[0].meshes[0],[[.75,.75],[.75,.75],[.75,.75]]);setPoints(f.places[1].meshes[0],[[.5,.5],[1.5,.5],[.5,1.5]]);setPoints(f.places[2].meshes[0],[[2,2],[3,3],[4,4]]);const r=read(f);assert.equal(pair(r).relation,'bounds_touch');assert.deepEqual(r.places[0].measuredMeshBounds,{minX:.75,minZ:.75,maxX:.75,maxZ:.75});assert.deepEqual(r.places[2].measuredMeshBounds,{minX:2,minZ:2,maxX:4,maxZ:4});assert.equal(r.places[0].triangleCount,1);
});
test('disjoint triangles with overlapping envelopes are explicitly only broad-phase candidates',()=>{
  const f=fixture();setPoints(f.places[0].meshes[0],[[0,0],[2,0],[0,2]]);setPoints(f.places[1].meshes[0],[[1.5,1.5],[3,1.5],[1.5,3]]);const r=read(f);
  // Every point ofhome satisfies x+z<=2; every point ofcafe satisfies x+z>=3.
  assert.ok(f.places[0].meshes[0].xzPositions.every(Number.isFinite));assert.equal(pair(r).relation,'bounds_overlap');assert.equal(r.collisionOrClearanceAssessed,false);assert.match(r.relationScope,/not triangle contact/);
});
test('two Sprite-only places are unavailable rather than empty or separate',()=>{
  const r=read(fixture());assert.equal(r.places[4].measuredMeshBounds,null);assert.equal(r.places[4].unmeasuredSpriteCount,1);assert.equal(r.pairs.filter(p=>p.relation==='unavailable_no_mesh').length,9);assert.deepEqual(pair(r,'tree','flowers'),{ids:['tree','flowers'],relation:'unavailable_no_mesh',axisSpans:null});
});
test('water window and hidden batching Meshes remain included with explicit provenance',()=>{
  const f=fixture(),m=f.places[0].meshes[0];m.nonSolidWater=true;m.nonSolidWindow=true;m.batchedOriginal=true;m.visibleAtCapture=false;m.batchName='controlled-batch';m.batchInstanceIndex=0;m.batchInstanceMatrix=IDENTITY.slice();recalc(f);const r=read(f);assert.deepEqual(r.places[0].measuredMeshBounds,{minX:0,minZ:0,maxX:1,maxZ:1});assert.equal(r.totals.nonSolidWaterMeshCount,1);assert.equal(r.totals.nonSolidWindowMeshCount,1);assert.equal(r.totals.batchedOriginalCount,1);assert.equal(r.places[0].meshes[0].visibleAtCapture,false);
});
test('non-indexed sequential triangles are accepted but shuffled implicit indices refuse',()=>{
  const f=fixture(),m=f.places[0].meshes[0];m.indexWasPresent=false;m.indexArrayType=null;assert.equal(read(f).ok,true);m.indices=[2,1,0];assert.deepEqual(read(f),{ok:false,error:'invalid_projection'});
  m.indices=[0,1,2];setPoints(m,[[0,0],[1,0],[0,1],[99,99]]);recalc(f);assert.deepEqual(read(f),{ok:false,error:'invalid_projection'});
});
test('negative fractional out-of-range and missing triangle indices refuse',()=>{
  for(const bad of [-1,.5,3,null]){const f=fixture();f.places[0].meshes[0].indices[1]=bad;assert.deepEqual(read(f),{ok:false,error:'invalid_projection'});}const f=fixture();f.places[0].meshes[0].indices.pop();assert.deepEqual(read(f),{ok:false,error:'invalid_projection'});
  for(const [type,count] of [['Uint8Array',257],['Uint16Array',65537]]){const g=fixture(),m=g.places[0].meshes[0];setPoints(m,Array.from({length:count},(_,i)=>[i,0]));m.indexArrayType=type;m.indices=[0,1,count-1];recalc(g);assert.deepEqual(read(g),{ok:false,error:'invalid_projection'});}
});
test('position lengths counts and aggregate counters must agree',()=>{
  for(const change of [f=>f.places[0].meshes[0].worldPositions.pop(),f=>f.places[0].meshes[0].positionCount++,f=>f.places[0].coverage.positionCount++,f=>f.totals.triangleCount++]){const f=fixture();change(f);assert.deepEqual(read(f),{ok:false,error:'invalid_projection'});}
});
test('stored XYZ and supplied XZ must be identical finite coordinate values',()=>{
  const f=fixture();f.places[0].meshes[0].xzPositions[0]=.01;assert.deepEqual(read(f),{ok:false,error:'invalid_projection'});
});
test('failed wrong-scope or unknown-field projection input refuses',()=>{
  assert.deepEqual(Bounds.inspect('{"ok":false,"error":"capture_failed"}'),{ok:false,error:'invalid_projection'});for(const change of [f=>f.scope='clearance',f=>f.coordinateSpace='provided_saved_layout_xy',f=>f.extra=true,f=>f.collisionOrClearanceAssessed=true]){const f=fixture();change(f);assert.deepEqual(read(f),{ok:false,error:'invalid_projection'});}
});
test('JSON overflow numbers and null numeric values are not treated as zero',()=>{
  const f=fixture();f.places[0].meshes[0].worldPositions[0]='NONFINITE';f.places[0].meshes[0].xzPositions[0]='NONFINITE';const raw=JSON.stringify(f).replaceAll('"NONFINITE"','1e309');assert.deepEqual(Bounds.inspect(raw),{ok:false,error:'invalid_projection'});assert.deepEqual(read(f),{ok:false,error:'invalid_projection'});
});
test('six unique identities are required while valid input order does not affect pair order',()=>{
  const f=fixture();f.places.reverse();assert.deepEqual(read(f).places.map(p=>p.id),IDS);f.places[0].id=f.places[1].id;assert.deepEqual(read(f),{ok:false,error:'invalid_projection'});
});
test('individual-envelope and inter-envelope subtraction overflow fail closed',()=>{
  const f=fixture();setPoints(f.places[0].meshes[0],[[Number.MAX_VALUE,0],[-Number.MAX_VALUE,0],[0,0]]);assert.deepEqual(read(f),{ok:false,error:'unsafe_arithmetic'});
  const g=fixture();setPoints(g.places[0].meshes[0],Array.from({length:3},()=>[Number.MAX_VALUE,0]));setPoints(g.places[1].meshes[0],Array.from({length:3},()=>[-Number.MAX_VALUE,0]));assert.deepEqual(read(g),{ok:false,error:'unsafe_arithmetic'});
});
test('cardinality limits reject oversized claims before iterating their data',()=>{
  const f=fixture();f.totals.positionCount=Bounds.limits.positions+1;assert.deepEqual(read(f),{ok:false,error:'size_limit'});const g=fixture();g.places[0].meshes[0].positionCount=Bounds.limits.positions+1;assert.deepEqual(read(g),{ok:false,error:'size_limit'});assert.deepEqual(Bounds.inspect(' '.repeat(Bounds.limits.jsonCharacters+1)),{ok:false,error:'size_limit'});
});
test('result is detached recursively frozen and input JSON remains unchanged',()=>{
  const f=fixture(),raw=JSON.stringify(f),r=Bounds.inspect(raw);deepFrozen(r);f.places[0].meshes[0].worldPositions[0]=999;assert.equal(r.places[0].measuredMeshBounds.minX,0);assert.throws(()=>{r.places[0].meshes[0].bounds.minX=999;},TypeError);assert.equal(Bounds.inspect(raw).places[0].measuredMeshBounds.minX,0);assert.equal(raw,JSON.stringify(fixture()));
});
test('nonstring objects are rejected without executing caller conversion or getters',()=>{
  let calls=0;const x={get scope(){calls++;throw Error('must_not_read');},toString(){calls++;throw Error('must_not_convert');}};assert.deepEqual(Bounds.inspect(x),{ok:false,error:'invalid_projection'});assert.equal(calls,0);assert.deepEqual(Bounds.inspect('{'),{ok:false,error:'invalid_projection'});
});
test('draw metadata is preserved while its range does not filter stored triangle envelopes',()=>{
  const f=fixture(),m=f.places[0].meshes[0];m.drawRange={start:0,count:0};m.geometryGroups=[{start:0,count:3,materialIndex:0}];const r=read(f);assert.equal(r.ok,true);assert.deepEqual(r.places[0].meshes[0].drawRange,{start:0,count:0});assert.equal(r.places[0].meshes[0].geometryGroupCount,1);assert.equal(r.places[0].triangleCount,1);assert.deepEqual(r.places[0].measuredMeshBounds,{minX:0,minZ:0,maxX:1,maxZ:1});assert.equal(r.places[0].provenance.drawCoverageComplete,false);
});
test('malformed mappings matrices provenance groups and unexpected Mesh fields refuse',()=>{
  for(const change of [f=>f.places[0].mapping.sceneEffective.footprint.rx=0,f=>f.places[0].meshes[0].matrixWorld.pop(),f=>f.places[0].meshes[0].batchName='not-batched',f=>f.places[0].meshes[0].geometryGroups=[{start:2,count:3,materialIndex:0}],f=>f.places[0].meshes[0].extra=true]){const f=fixture();change(f);assert.deepEqual(read(f),{ok:false,error:'invalid_projection'});}
});
test('a wholly Meshless report is unavailable as a projection basis rather than a clear world',()=>{
  const f=fixture();for(const p of f.places)p.meshes=[];recalc(f);assert.deepEqual(read(f),{ok:false,error:'invalid_projection'});
});

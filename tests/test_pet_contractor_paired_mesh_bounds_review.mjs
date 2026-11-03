import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Town from '../static/pet-town-walk.js';
import Scene from '../static/pet-town-scene.js';
import Projection from '../static/pet-contractor-scene-mesh-projection.js';
import Intent from '../static/pet-contractor-intent.js';
import Bounds from '../static/pet-contractor-mesh-bounds.js';
import Review from '../static/pet-contractor-paired-mesh-bounds-review.js';

const DIR=path.dirname(fileURLToPath(import.meta.url));
const H=path.resolve(DIR,'../..');
const SOURCE=fs.readFileSync(path.resolve(DIR,'../static/pet-contractor-paired-mesh-bounds-review.js'),'utf8');
const IDS=['home','cafe','shop','playground','tree','flowers'];
const COUNT_KEYS=['meshCount','positionCount','triangleCount','spriteCount','batchedOriginalCount','nonSolidWaterMeshCount','nonSolidWindowMeshCount','otherObjectCount'];
const MATRIX=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const clone=x=>JSON.parse(JSON.stringify(x));
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const bytes=x=>Buffer.from(x.buffer,x.byteOffset,x.byteLength);
const counts=()=>Object.fromEntries(COUNT_KEYS.map(k=>[k,0]));
function layout(){return {version:1,theme:'cafe',items:IDS.map((id,i)=>({id,x:[22,72,22,72,48,48][i],y:[23,23,65,65,44,83][i]}))};}
function recalc(f){
  f.totals=counts();
  for(const p of f.places){
    p.coverage={...counts(),renderedCoverageComplete:false};
    for(const m of p.meshes){p.coverage.meshCount++;p.coverage.positionCount+=m.positionCount;p.coverage.triangleCount+=m.triangleCount;for(const [flag,key]of[['batchedOriginal','batchedOriginalCount'],['nonSolidWater','nonSolidWaterMeshCount'],['nonSolidWindow','nonSolidWindowMeshCount']])if(m[flag])p.coverage[key]++;}
    p.coverage.spriteCount=p.sprites.length;for(const k of COUNT_KEYS)f.totals[k]+=p.coverage[k];
  }return f;
}
function setPoints(m,points){m.worldPositions=points.flatMap(([x,z])=>[x,0,z]);m.xzPositions=points.flat();m.positionCount=points.length;return m;}
function fixture(explicit,homeOffset=0){
  const f={ok:true,version:1,scope:'actual_scene_place_mesh_projection',coordinateSpace:'scene_world_xyz_and_xz',worldSize:{width:2880,height:1920},originalArtState:'controlled_no_art',originalArtResourceState:'idle',mappingValidation:'Explicit controlled mapping only.',geometryScope:'Stored triangles only.',batchMatrixScope:'No batches.',drawScope:'Not complete draw coverage.',places:[],totals:counts(),gaps:['Unmeasured objects remain outside.'],collisionOrClearanceAssessed:false,gameOrStorageConnected:false,mutationsPerformed:false};
  for(let i=0;i<6;i++){
    const id=IDS[i],provided=explicit.items.find(x=>x.id===id),position={id,x:1,y:1,footprint:{x:1,y:1,rx:1,ry:1},entrance:{x:1,y:1}};
    const p={id,mapping:{providedPercent:{x:provided.x,y:provided.y},townBefore:clone(position),sceneEffective:clone(position),worldOrigin:{x:0,y:0,z:0}},meshes:[],sprites:[],coverage:{...counts(),renderedCoverageComplete:false}};
    if(i<4){
      const m={id:id+':mesh:0000',name:'controlled-triangle',geometryType:'BufferGeometry',positionArrayType:'Float64Array',indexArrayType:'Uint32Array',worldPositions:[],xzPositions:[],indices:[0,1,2],positionCount:3,triangleCount:1,indexWasPresent:true,matrixWorld:MATRIX.slice(),visibleAtCapture:true,batchedOriginal:false,batchName:null,batchInstanceIndex:null,batchInstanceMatrix:null,nonSolidWater:false,nonSolidWindow:false,drawRange:{start:0,count:null},geometryGroups:[]};
      const x=i===0?homeOffset:i*3;setPoints(m,[[x,0],[x+1,0],[x,1]]);p.meshes.push(m);
    }else p.sprites.push({name:'unmeasured',kind:id,visibleAtCapture:false,originalArt:true,sourceSHA256:null,worldOrigin:{x:0,y:0,z:0}});
    f.places.push(p);
  }return recalc(f);
}
function input(same=false){const current=layout(),requested=clone(current);if(!same)requested.items[0].x=30;return {snapshot:{revision:7,currentLayout:current},proposal:{version:1,expectedRevision:7,requestedLayout:requested},current:fixture(current),requested:fixture(requested,2.5)};}
function args(f){return [f.snapshot,f.proposal,f.current,f.requested].map(JSON.stringify);}
function read(f,api=Review){return api.inspect(...args(f));}
function fail(f,error,endpoint=null,api=Review){assert.deepEqual(clone(read(f,api)),{ok:false,error,endpoint});}
function injected(intent=Intent,bounds=Bounds){const c={PetContractorIntent:intent,PetContractorMeshBounds:bounds};vm.runInNewContext(SOURCE,c,{filename:'paired-consumer-controlled-dependencies.js'});return c.PetContractorPairedMeshBoundsReview;}
function counted(){const calls={intent:0,bounds:0};const api=injected({inspect(...a){calls.intent++;return Intent.inspect(...a);}},{inspect(...a){calls.bounds++;return Bounds.inspect(...a);}});return {api,calls};}
function frozen(v){assert.equal(Object.isFrozen(v),true);for(const x of Object.values(v))if(x&&typeof x==='object')frozen(x);}
function alteredBounds(change){return injected(Intent,{inspect(json){const r=clone(Bounds.inspect(json));if(r.ok)change(r);return r;}});}

test('valid explicit changed layouts produce two bounded endpoint reports and boolean comparisons',()=>{
  const r=read(input());assert.equal(r.ok,true);assert.equal(r.expectedRevision,7);assert.equal(r.stage,'unsubmitted_readonly_review');assert.equal(r.endpoints.current.places.length,6);assert.equal(r.endpoints.requested.pairs.length,15);assert.equal(r.pairComparisons.length,15);
  assert.deepEqual(r.changes,[{id:'home',from:{x:22,y:23},to:{x:30,y:23}}]);assert.equal(r.perPlace[0].layoutChanged,true);assert.equal(r.perPlace[0].providedPercentEqual,false);assert.equal(r.perPlace[0].measuredBoundsEqual,false);assert.equal(r.pairComparisons[0].currentRelation,'bounds_separate');assert.equal(r.pairComparisons[0].requestedRelation,'bounds_overlap');assert.equal(r.pairComparisons[0].relationChanged,true);
  assert.equal(r.binding.mappingOnly,true);for(const key of ['sourceAuthenticated','ownerSaveAuthenticated','endpointRoleAuthenticated','projectionRevisionSignature'])assert.equal(r.binding[key],false);assert.equal(r.collisionOrClearanceAssessed,false);assert.equal(r.gameOrStorageConnected,false);assert.equal(r.mutationsPerformed,false);
});
test('swapping projections of changed layouts rejects the current endpoint mapping',()=>{const f=input();[f.current,f.requested]=[f.requested,f.current];fail(f,'mapping_mismatch','current');});
test('all six mappings are checked including IDs unchanged by the intent',()=>{const f=input();f.requested.places[5].mapping.providedPercent.x++;fail(f,'mapping_mismatch','requested');});
test('equal-layout swapped geometry reports may be indistinguishable by mapping and never authenticate roles',()=>{
  const f=input(true),a=read(f);[f.current,f.requested]=[f.requested,f.current];const b=read(f);assert.equal(a.ok,true);assert.equal(b.ok,true);assert.deepEqual(a.changes,[]);assert.equal(b.binding.endpointRoleAuthenticated,false);assert.equal(b.perPlace[0].providedPercentEqual,true);assert.equal(b.perPlace[0].measuredBoundsEqual,false);assert.match(b.limits[0],/swapped projections may be indistinguishable/);
});
test('shared world size and exact coordinate scope are required',()=>{
  const f=input();f.requested.worldSize.width++;fail(f,'world_size_mismatch');const g=input();g.current.coordinateSpace='layout_xy';fail(g,'invalid_projection','current');
});
test('explicit Intent schema, six IDs and revision gates remain strict with no default layout',()=>{
  for(const mutate of [f=>delete f.snapshot.currentLayout,f=>f.snapshot.revision=-1,f=>f.snapshot.revision=9000000000001,f=>f.proposal.requestedLayout.items.pop(),f=>f.proposal.requestedLayout.items[1].id='home',f=>f.proposal.requestedLayout.items[1].x=101,f=>f.proposal.requestedLayout.theme='other']){const f=input();mutate(f);assert.equal(read(f).ok,false);}
  const f=input(),c=counted();f.proposal.expectedRevision=8;fail(f,'stale_revision',null,c.api);assert.deepEqual(c.calls,{intent:0,bounds:0});
});
test('failed projection, duplicate IDs and extra root members reject before any Bounds call',()=>{
  for(const mutate of [f=>f.current={ok:false,error:'capture_failed'},f=>f.current.places[1].id='home',f=>f.current.places[0].id='unknown',f=>f.current.extra=true,f=>f.current.collisionOrClearanceAssessed=true]){const f=input(),c=counted();mutate(f);assert.equal(read(f,c.api).ok,false);assert.equal(c.calls.bounds,0);}
});
test('full old Bounds validation still rejects malformed numeric geometry, indices, counters and metadata',()=>{
  const cases=[f=>f.current.places[0].meshes[0].indices[1]=-1,f=>f.current.places[0].meshes[0].worldPositions[1]=null,f=>f.current.places[0].meshes[0].xzPositions[0]=.1,f=>f.current.places[0].coverage.positionCount++,f=>f.current.places[0].meshes[0].matrixWorld[4]=null,f=>f.current.places[0].meshes[0].indexArrayType='Float32Array',f=>f.current.places[0].meshes[0].drawRange.start=-1,f=>f.current.places[4].sprites[0].sourceSHA256='not-a-sha'];
  for(const mutate of cases){const f=input();mutate(f);assert.equal(Bounds.inspect(JSON.stringify(f.current)).ok,false);const r=read(f);assert.equal(r.ok,false);assert.equal(r.endpoint,'current');}
});
test('JSON overflow and old intra-endpoint subtraction overflow fail closed',()=>{
  const f=input();setPoints(f.current.places[0].meshes[0],[[Number.MAX_VALUE,0],[-Number.MAX_VALUE,0],[0,0]]);fail(f,'unsafe_arithmetic','current');
  const a=args(input());a[2]=a[2].replace('"controlled_no_art"','1e309');assert.equal(Review.inspect(...a).ok,false);
});
test('Sprite-only, hidden batching and water/window provenance remain measured or unavailable honestly',()=>{
  const f=input(),m=f.current.places[0].meshes[0];m.batchedOriginal=true;m.batchName='controlled';m.batchInstanceIndex=0;m.batchInstanceMatrix=MATRIX.slice();m.visibleAtCapture=false;m.nonSolidWater=true;m.nonSolidWindow=true;recalc(f.current);const r=read(f);assert.equal(r.ok,true);assert.equal(r.endpoints.current.places[4].measuredMeshBounds,null);assert.equal(r.endpoints.current.places[4].unmeasuredSpriteCount,1);assert.equal(r.endpoints.current.places[0].provenance.batchedOriginalCount,1);assert.equal(r.endpoints.current.totals.nonSolidWaterMeshCount,1);assert.equal(r.endpoints.current.totals.nonSolidWindowMeshCount,1);assert.equal(r.endpoints.current.pairs.filter(p=>p.relation==='unavailable_no_mesh').length,9);
});
test('four string and combined character limits stop before dependency calls',()=>{
  const c=counted(),a=args(input());assert.equal(c.api.inspect(null,...a.slice(1)).error,'invalid_arguments');assert.equal(c.api.inspect(' '.repeat(1000001),...a.slice(1)).error,'size_limit');assert.equal(c.api.inspect(a[0],a[1],' '.repeat(64000001),a[3]).error,'size_limit');assert.equal(c.api.inspect(a[0],a[1],' '.repeat(48000000),' '.repeat(48000000)).error,'size_limit');assert.deepEqual(c.calls,{intent:0,bounds:0});
});
test('per-endpoint mesh,position,index and Sprite work limits are checked before either Bounds allocation',()=>{
  for(const [key,value]of[['meshCount',2049],['positionCount',1000001],['triangleCount',1000001],['spriteCount',16001]]){const f=input(),c=counted();f.requested.totals[key]=value;fail(f,'size_limit','requested',c.api);assert.equal(c.calls.bounds,0);}
});
test('group length work limits in either endpoint stop before the first Bounds call',()=>{
  for(const endpoint of ['current','requested']){const f=input(),c=counted();f[endpoint].places[0].meshes[0].geometryGroups=Array(50001).fill(null);fail(f,'size_limit',endpoint,c.api);assert.equal(c.calls.bounds,0);}
});
test('two exact50000 group endpoints are accepted at the100000 aggregate guard without relaxing old validation',()=>{
  const f=input(),c=counted();for(const endpoint of ['current','requested'])f[endpoint].places[0].meshes[0].geometryGroups=Array.from({length:50000},()=>({start:0,count:3,materialIndex:0}));assert.equal(read(f,c.api).ok,true);assert.deepEqual(c.calls,{intent:1,bounds:2});
});
test('dependency method getters are captured once and later property changes are not reread',()=>{
  const calls={intent:0,bounds:0},i={},b={};Object.defineProperty(i,'inspect',{configurable:true,get(){calls.intent++;return Intent.inspect;}});Object.defineProperty(b,'inspect',{configurable:true,get(){calls.bounds++;return Bounds.inspect;}});const api=injected(i,b);Object.defineProperty(i,'inspect',{get(){throw Error('reread');}});Object.defineProperty(b,'inspect',{get(){throw Error('reread');}});assert.equal(read(input(),api).ok,true);assert.equal(read(input(),api).ok,true);assert.deepEqual(calls,{intent:1,bounds:1});
});
test('a getter-bearing imported Intent reply is refused without invoking its getter',()=>{
  let calls=0;const api=injected({inspect(){return Object.defineProperty({},'ok',{get(){calls++;throw Error('must-not-read');}});}},Bounds);fail(input(),'dependency_reply_invalid',null,api);assert.equal(calls,0);
});
test('forged Intent drafts and opaque change IDs are not trusted or stringified',()=>{
  let calls=0;const api=injected({inspect(...a){const r=clone(Intent.inspect(...a));r.changes[0].id={toJSON(){calls++;throw Error('must-not-stringify');}};return r;}},Bounds);fail(input(),'dependency_reply_invalid',null,api);assert.equal(calls,0);
  const wrong=injected({inspect(...a){const r=clone(Intent.inspect(...a));r.draft.expectedRevision++;return r;}},Bounds);fail(input(),'dependency_reply_invalid',null,wrong);
});
test('a getter-bearing imported Bounds reply fails closed without invoking accessors',()=>{
  let calls=0;const api=injected(Intent,{inspect(json){const r=clone(Bounds.inspect(json));Object.defineProperty(r.worldSize,'width',{get(){calls++;throw Error('must-not-read');}});return r;}});fail(input(),'dependency_reply_invalid','current',api);assert.equal(calls,0);
});
test('ok-only,unknown failure and throwing Bounds dependencies cannot approve a result',()=>{
  for(const inspect of [()=>({ok:true}),()=>({ok:false,error:'RAW_SECRET'}),()=>{throw Error('RAW_SECRET');}]){const api=injected(Intent,{inspect});const r=read(input(),api);assert.deepEqual(clone(r),{ok:false,error:'dependency_reply_invalid',endpoint:'current'});assert.equal(JSON.stringify(r).includes('RAW_SECRET'),false);}
});
test('finite invented mesh envelopes are detected against the supplied referenced vertices',()=>{
  const api=alteredBounds(r=>{r.places[0].meshes[0].bounds.minX+=.25;});fail(input(),'dependency_reply_invalid','current',api);
});
test('forged counts,pairs,place envelopes and provenance are independently rejected',()=>{
  for(const change of [r=>r.totals.storedVertexCount++,r=>r.places[0].referencedVertexCount++,r=>r.places[0].measuredMeshBounds.maxX++,r=>r.pairs[0].relation='bounds_overlap',r=>r.pairs[0].axisSpans.gapX++,r=>r.places[0].provenance.drawCoverageComplete=true])fail(input(),'dependency_reply_invalid','current',alteredBounds(change));
});
test('unused opaque dependency prose is neither copied,stringified nor recursively frozen',()=>{
  let calls=0,last;const bomb={toJSON(){calls++;throw Error('must-not-copy');}};const api=injected(Intent,{inspect(json){last=clone(Bounds.inspect(json));last.geometryScope=bomb;return last;}});const r=read(input(),api);assert.equal(r.ok,true);assert.equal(JSON.stringify(r).includes('must-not-copy'),false);assert.equal(Object.isFrozen(last),false);assert.equal(Object.isFrozen(bomb),false);assert.equal(calls,0);
});
test('opaque thrown values do not expose marker getters or raw exception text',()=>{
  let calls=0;const opaque=Object.defineProperty({},'marker',{get(){calls++;throw Error('RAW_SECRET');}});const api=injected(Intent,{inspect(){throw opaque;}});fail(input(),'dependency_reply_invalid','current',api);assert.equal(calls,0);
});
test('results are detached,deeply frozen,deterministic and do not freeze dependency-owned replies',()=>{
  let last;const api=injected(Intent,{inspect(json){last=clone(Bounds.inspect(json));return last;}}),f=input(),before=JSON.stringify(f),r=read(f,api),snapshot=JSON.stringify(r);frozen(r);assert.equal(Object.isFrozen(last),false);last.places[0].measuredMeshBounds.minX=-99;assert.equal(JSON.stringify(r),snapshot);assert.equal(JSON.stringify(f),before);assert.equal(JSON.stringify(read(f,api)),snapshot);assert.throws(()=>{r.endpoints.current.places[0].measuredMeshBounds.minX=99;},TypeError);
});
test('opposite finite extreme endpoint envelopes use equality,never cross-endpoint subtraction',()=>{
  const f=input();for(const endpoint of ['current','requested'])for(const p of f[endpoint].places)for(const m of p.meshes)setPoints(m,Array.from({length:3},()=>[endpoint==='current'?Number.MAX_VALUE:-Number.MAX_VALUE,0]));const r=read(f);assert.equal(r.ok,true);assert.equal(r.perPlace[0].measuredBoundsEqual,false);assert.equal(r.endpoints.current.pairs[0].relation,'bounds_touch');assert.equal(r.collisionOrClearanceAssessed,false);
});
test('projection place ordering is independent while output six IDs and fifteen pairs are canonical',()=>{
  const f=input();f.current.places.reverse();f.requested.places.reverse();const r=read(f);assert.equal(r.ok,true);assert.deepEqual(r.endpoints.current.places.map(x=>x.id),IDS);assert.deepEqual(r.pairComparisons[0].ids,['home','cafe']);
});
test('malformed imported arrays or opaque pair values fail before invoking their accessors or serializers',()=>{
  let calls=0;for(const change of [r=>Object.defineProperty(r.places,'0',{get(){calls++;throw Error('must-not-read');}}),r=>r.places.length=100000,r=>r.pairs[0].relation={toJSON(){calls++;throw Error('must-not-stringify');}},r=>r.places[0].meshes[0].drawRange.count={toJSON(){calls++;throw Error('must-not-stringify');}}])fail(input(),'dependency_reply_invalid','current',alteredBounds(change));assert.equal(calls,0);
});

function signature(built){
  const rows=[];for(const group of built.placeGroups)group.traverse(node=>{if(node.isMesh)rows.push({name:node.name,matrix:node.matrixWorld.toArray(),position:hash(bytes(node.geometry.attributes.position.array)),index:node.geometry.index?hash(bytes(node.geometry.index.array)):null,drawRange:node.geometry.drawRange,groups:node.geometry.groups,visible:node.visible});});
  return JSON.stringify({rows,batches:built.batches.map(b=>hash(bytes(b.mesh.instanceMatrix.array))),art:built.scene.userData.originalArtState});
}
let actual;
test('two new actual current-source scenes are captured once per endpoint and reviewed without buffers,context,art or storage mutation',()=>{
  const f=input(),priorFetch=globalThis.fetch,priorImage=globalThis.Image,storageKeys=['localStorage','sessionStorage'],priorStorage=storageKeys.map(k=>Object.getOwnPropertyDescriptor(globalThis,k)),forbidden={fetch:0,Image:0,TextureLoader:0,storage:0};
  const T={...THREE,TextureLoader:class{constructor(){forbidden.TextureLoader++;throw Error('forbidden-art-loader');}}};
  globalThis.fetch=()=>{forbidden.fetch++;throw Error('forbidden-network');};globalThis.Image=class{constructor(){forbidden.Image++;throw Error('forbidden-image');}};for(const k of storageKeys)Object.defineProperty(globalThis,k,{configurable:true,get(){forbidden.storage++;throw Error('forbidden-storage');}});
  const made=[];let report;
  try{
    for(const [role,providedLayout]of[['current',f.snapshot.currentLayout],['requested',f.proposal.requestedLayout]]){
      const beforeLayout=JSON.stringify(providedLayout),world=Town.createWorld(providedLayout),townBefore=clone(world),built=Scene.buildWorld(T,world,{},null,null,'summer');made.push({role,built,providedLayout,world,beforeLayout,townBefore,disposeReturned:false});built.scene.updateMatrixWorld(true);
      const row=made.at(-1);row.beforeSignature=signature(built);row.beforeWorld=JSON.stringify(world);row.beforeTown=JSON.stringify(townBefore);row.projection=Projection.capture({THREE:T,built,world,providedLayout,townBefore});assert.equal(row.projection.ok,true);row.json=JSON.stringify(row.projection);row.jsonCharacters=row.json.length;
    }
    report=Review.inspect(JSON.stringify(f.snapshot),JSON.stringify(f.proposal),made[0].json,made[1].json);assert.equal(report.ok,true);assert.deepEqual(forbidden,{fetch:0,Image:0,TextureLoader:0,storage:0});
    for(const row of made){
      row.afterSignature=signature(row.built);assert.equal(row.afterSignature,row.beforeSignature);assert.equal(JSON.stringify(row.world),row.beforeWorld);assert.equal(JSON.stringify(row.townBefore),row.beforeTown);assert.equal(JSON.stringify(row.providedLayout),row.beforeLayout);
      const endpoint=report.endpoints[row.role];assert.equal(endpoint.totals.measuredMeshCount,row.projection.totals.meshCount);assert.equal(endpoint.totals.storedVertexCount,row.projection.totals.positionCount);assert.equal(endpoint.totals.triangleCount,row.projection.totals.triangleCount);assert.equal(endpoint.places.length,6);assert.equal(endpoint.pairs.length,15);
      for(const p of row.projection.places){const out=endpoint.places.find(x=>x.id===p.id);let b=null;for(const m of p.meshes){for(const index of new Set(m.indices)){const x=m.xzPositions[index*2],z=m.xzPositions[index*2+1];b=b?{minX:Math.min(b.minX,x),minZ:Math.min(b.minZ,z),maxX:Math.max(b.maxX,x),maxZ:Math.max(b.maxZ,z)}:{minX:x,minZ:z,maxX:x,maxZ:z};}}assert.deepEqual(out.measuredMeshBounds,b);}
    }
  }finally{
    for(const row of made){row.built.dispose();row.disposeReturned=true;}
    globalThis.fetch=priorFetch;if(priorImage===undefined)delete globalThis.Image;else globalThis.Image=priorImage;for(let i=0;i<storageKeys.length;i++){if(priorStorage[i])Object.defineProperty(globalThis,storageKeys[i],priorStorage[i]);else delete globalThis[storageKeys[i]];}
  }
  actual={report,forbidden,sourceBuilds:made.length,projectionCaptures:made.length,endpointObservations:made.map(row=>({role:row.role,providedLayout:row.providedLayout,projectionJSONCharacters:row.jsonCharacters,sourceProjectionTotals:row.projection.totals,sourceMeshSignatureBeforeSHA256:hash(row.beforeSignature),sourceMeshSignatureAfterSHA256:hash(row.afterSignature),worldBeforeSHA256:hash(row.beforeWorld),worldAfterSHA256:hash(JSON.stringify(row.world)),townBeforeSHA256:hash(row.beforeTown),townAfterSHA256:hash(JSON.stringify(row.townBefore)),providedLayoutBeforeSHA256:hash(row.beforeLayout),providedLayoutAfterSHA256:hash(JSON.stringify(row.providedLayout)),disposeReturned:row.disposeReturned}))};
  assert.equal(actual.sourceBuilds,2);assert.equal(actual.projectionCaptures,2);assert.ok(actual.endpointObservations.every(x=>x.disposeReturned));assert.equal(report.collisionOrClearanceAssessed,false);assert.equal(report.binding.sourceAuthenticated,false);
});
test.after(()=>{
  const manifestPath=path.join(H,'current-source-input-manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  for(const row of manifest.rows){const b=fs.readFileSync(row.path);assert.equal(hash(b),row.sha256,row.repository_path);assert.equal(b.length,row.bytes,row.repository_path);}
  if(actual&&process.env.PAIRED_BOUNDS_EVIDENCE_DIR){
    const output=path.resolve(process.env.PAIRED_BOUNDS_EVIDENCE_DIR),source=fs.readFileSync(path.join(H,'current-source-input-manifest.json'));
    fs.writeFileSync(path.join(output,'paired-actual-report.json'),JSON.stringify(actual.report,null,2)+'\n',{flag:'wx',mode:0o600});
    const reportBytes=fs.readFileSync(path.join(output,'paired-actual-report.json'));
    const observation={schema_version:1,status:'NEW_TWO_SYNTHETIC_SOURCE_ENDPOINTS_OBSERVED_FORMAL_TRANSCRIPT_SEPARATE',observed_at_utc:new Date().toISOString(),sourceManifest:{path:manifestPath,sha256:hash(source),bytes:source.length},sourceBuilds:actual.sourceBuilds,projectionCaptures:actual.projectionCaptures,pairedReviewCalls:1,all29ExistingDependencyBytesPreserved:true,forbiddenCalls:actual.forbidden,endpoints:actual.endpointObservations,actualReport:{path:path.join(output,'paired-actual-report.json'),sha256:hash(reportBytes),bytes:reportBytes.length},projectionJSONBodiesPersisted:0,scope:actual.report.scope,stage:actual.report.stage,collisionOrClearanceAssessed:false,gameOrStorageConnected:false,newGeometryBodyFitLibraryCredit:0};
    fs.writeFileSync(path.join(output,'paired-engine-geometry-observation.json'),JSON.stringify(observation,null,2)+'\n',{flag:'wx',mode:0o600});
  }
});

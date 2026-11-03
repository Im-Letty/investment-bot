import * as THREE from '../vendor/three-0.160.1.module.js';
import '../pet-town-walk.js';
import '../pet-frame-fit.js';
import '../pet-river-fishing.js';
import '../pet-japan-seasons.js';
import '../pet-town-style.js';
import '../pet-town-layout-art.js';
import '../pet-town-placement-originals.js';
import '../pet-town-water-life.js';
import '../pet-town-ocean-life.js';
import '../pet-town-shore-transition.js';
import '../pet-town-tree-variety.js';
import '../pet-town-meadow-sites.js';
import '../pet-town-meadow-flowers.js';
import '../pet-town-ground-finish.js';
import '../pet-town-water-finish.js';
import '../pet-town-environment.js';
import '../pet-ocean-discoveries.js';
import '../pet-ocean-snorkeling.js';
import '../pet-ocean-snorkeling-world.js';
import '../pet-still-step.js';
import '../pet-town-scene.js';
import '../pet-village-economy.js';
import '../pet-shop-layout.js';
import '../pet-game-core.js';
import '../pet-contractor-intent.js';
import '../pet-contractor-scene-mesh-projection.js';
import '../pet-contractor-mesh-bounds.js';
import '../pet-contractor-paired-mesh-bounds-review.js';

const $ = id => document.getElementById(id);
const IDS = ['home','cafe','shop','playground','tree','flowers'];
const names = {home:'家',cafe:'カフェ',shop:'店',playground:'広場',tree:'木の場所',flowers:'花の場所'};
const labels = {actual:'現在と変更案',swapped:'変更前後の入れ替え',mapping:'変更しない場所の不一致',stale:'古い版の案',world:'世界の寸法の不一致',same:'同じ配置と役割の限界',separate:'離れた範囲',touch:'接する範囲',overlap:'重なる範囲',sprite:'立体範囲なし',index:'不正な三角形の指定',limit:'読取上限を超える入力'};
const clone = value => JSON.parse(JSON.stringify(value));
const currentLayout = {version:1,theme:'cafe',items:IDS.map((id,i)=>({id,x:[22,72,22,72,48,48][i],y:[23,23,65,65,44,83][i]}))};
const requestedLayout = clone(currentLayout); requestedLayout.items[0].x = 30;
const snapshotJSON = JSON.stringify({revision:42,currentLayout});
const proposalJSON = JSON.stringify({version:1,expectedRevision:42,requestedLayout});
const calls = {actualSourceBuilds:0,projectionCaptures:0,pairedInspections:0,TextureLoader:0,fetch:0,Image:0};
let actual = null, actualEvidence = null, latest = null, lastCase = null, runs = 0, resetCount = 0;

function captureEndpoint(providedLayout,role) {
  const layout = clone(providedLayout), layoutBefore = JSON.stringify(layout);
  const world = globalThis.PetTownWalk.createWorld(layout), townBefore = clone(world);
  const priorFetch = globalThis.fetch, priorImage = globalThis.Image;
  const T = {...THREE,TextureLoader:class {constructor(){calls.TextureLoader++;throw Error('diagnostic_art_loader_blocked');}}};
  let built = null, serialized = null, evidence = null;
  globalThis.fetch = () => {calls.fetch++;throw Error('diagnostic_network_blocked');};
  globalThis.Image = class {constructor(){calls.Image++;throw Error('diagnostic_image_blocked');}};
  try {
    calls.actualSourceBuilds++;
    built = globalThis.PetTownScene.buildWorld(T,world,{},null,null,'summer');
    built.scene.updateMatrixWorld(true);
    const worldBefore = JSON.stringify(world), source = [];
    for(const group of built.placeGroups) group.traverse(m=>{
      if(m.isMesh) source.push({m,positions:m.geometry.attributes.position.array.slice(),indices:m.geometry.index?.array.slice() ?? null,matrix:m.matrixWorld.toArray(),visible:m.visible});
    });
    calls.projectionCaptures++;
    const projection = globalThis.PetContractorSceneMeshProjection.capture({THREE:T,built,world,providedLayout:layout,townBefore});
    if(!projection.ok) throw Error('projection_capture_failed');
    const unchanged = source.every(({m,positions,indices,matrix,visible})=>
      positions.length===m.geometry.attributes.position.array.length && positions.every((v,i)=>Object.is(v,m.geometry.attributes.position.array[i])) &&
      (indices===null?m.geometry.index===null:indices.length===m.geometry.index.array.length&&indices.every((v,i)=>v===m.geometry.index.array[i])) &&
      matrix.every((v,i)=>Object.is(v,m.matrixWorld.elements[i])) && visible===m.visible);
    if(!unchanged || JSON.stringify(world)!==worldBefore || JSON.stringify(layout)!==layoutBefore) throw Error('explicit_fixture_changed');
    serialized = JSON.stringify(projection);
    evidence = {role,providedLayout:clone(layout),sourceWorldAndLayoutUnchanged:true,sourcePositionsIndicesMatricesVisibilityUnchanged:true,
      sourceComparisonBaseline:'after source build and matrix update, immediately before capture',
      sourceMeshRowsCompared:source.length,inputJSONCharacters:serialized.length,sourceProjectionTotals:projection.totals,
      typedArrayBytesPreservedByJSONClaimed:false,originalArtLoaded:false,WebGLRendererCreated:false};
  } finally {
    globalThis.fetch = priorFetch; globalThis.Image = priorImage;
    if(built) built.dispose();
  }
  evidence.fixtureDisposed = true;
  return {serialized,evidence};
}
function captureBoth() {
  if(actual!==null) return actual;
  // Publish the cache only after both independent fixtures have been disposed.
  const a = captureEndpoint(currentLayout,'current');
  const b = captureEndpoint(requestedLayout,'requested');
  actualEvidence = {current:a.evidence,requested:b.evidence,sourceAuthenticationClaimed:false,ownerSaveReadOrWritten:false};
  actual = {current:a.serialized,requested:b.serialized};
  return actual;
}
function counts(){return {meshCount:0,positionCount:0,triangleCount:0,spriteCount:0,batchedOriginalCount:0,nonSolidWaterMeshCount:0,nonSolidWindowMeshCount:0,otherObjectCount:0};}
function controlled(layout,kind='separate') {
  const report={ok:true,version:1,scope:'actual_scene_place_mesh_projection',coordinateSpace:'scene_world_xyz_and_xz',worldSize:{width:2880,height:1920},
    originalArtState:'controlled_no_art',originalArtResourceState:'idle',mappingValidation:'Controlled supplied mapping only; not source authentication.',geometryScope:'Controlled stored triangle positions.',batchMatrixScope:'No batching.',drawScope:'Stored triangles; no rendered coverage.',places:[],totals:counts(),gaps:['Controlled fixture only.'],collisionOrClearanceAssessed:false,gameOrStorageConnected:false,mutationsPerformed:false};
  const at={home:[0,0],cafe:[3,0],shop:[10,0],playground:[13,0]};
  if(kind==='touch') at.cafe=[1,0];
  if(kind==='overlap') at.cafe=[.5,.5];
  for(const row of layout.items){
    const id=row.id,position={id,x:1,y:1,footprint:{x:1,y:1,rx:1,ry:1},entrance:{x:1,y:1}};
    const p={id,mapping:{providedPercent:{x:row.x,y:row.y},townBefore:clone(position),sceneEffective:clone(position),worldOrigin:{x:0,y:0,z:0}},meshes:[],sprites:[],coverage:{...counts(),renderedCoverageComplete:false}};
    if(at[id] && !(kind==='sprite'&&id==='home')){
      const points=[[0,0],[1,0],[0,1]].map(([x,z])=>[x+at[id][0],z+at[id][1]]);
      const m={id:id+':mesh:0000',name:'controlled-triangle',geometryType:'BufferGeometry',positionArrayType:'Float64Array',indexArrayType:'Uint32Array',
        worldPositions:points.flatMap(([x,z])=>[x,0,z]),xzPositions:points.flat(),indices:[0,1,2],positionCount:3,triangleCount:1,indexWasPresent:true,
        matrixWorld:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],visibleAtCapture:true,batchedOriginal:false,batchName:null,batchInstanceIndex:null,batchInstanceMatrix:null,
        nonSolidWater:false,nonSolidWindow:false,drawRange:{start:0,count:null},geometryGroups:[]};
      p.meshes.push(m);p.coverage.meshCount=1;p.coverage.positionCount=3;p.coverage.triangleCount=1;
    } else {
      p.sprites.push({name:id+'-unmeasured',kind:id,visibleAtCapture:false,originalArt:true,sourceSHA256:null,worldOrigin:{x:0,y:0,z:0}});p.coverage.spriteCount=1;
    }
    report.places.push(p);for(const k of Object.keys(report.totals)) report.totals[k]+=p.coverage[k];
  }
  return report;
}
function inputs(kind){
  if(kind==='actual'||kind==='swapped'||kind==='stale'){
    const pair=captureBoth();
    return [snapshotJSON,kind==='stale'?JSON.stringify({version:1,expectedRevision:41,requestedLayout}):proposalJSON,
      pair[kind==='swapped'?'requested':'current'],pair[kind==='swapped'?'current':'requested']];
  }
  if(kind==='same'){
    const sameProposal=JSON.stringify({version:1,expectedRevision:42,requestedLayout:currentLayout});
    // Both maps match. Swapping different geometry is intentionally not authenticated.
    return [snapshotJSON,sameProposal,JSON.stringify(controlled(currentLayout,'overlap')),JSON.stringify(controlled(currentLayout,'separate'))];
  }
  const a=controlled(currentLayout,'separate'),b=controlled(requestedLayout,['touch','overlap','sprite'].includes(kind)?kind:'separate');
  if(kind==='mapping') a.places.find(p=>p.id==='cafe').mapping.providedPercent.y++;
  if(kind==='world') b.worldSize.width++;
  if(kind==='index') b.places[0].meshes[0].indices[2]=999;
  if(kind==='limit') b.totals.positionCount=1000001;
  return [snapshotJSON,proposalJSON,JSON.stringify(a),JSON.stringify(b)];
}
function numeric(n){return Number.isFinite(n)?String(Number(n.toPrecision(7))):'—';}
function boundsText(b){return b===null?'未測定':`X ${numeric(b.minX)}〜${numeric(b.maxX)} / Z ${numeric(b.minZ)}〜${numeric(b.maxZ)}`;}
function td(value){const cell=document.createElement('td');cell.textContent=value;return cell;}
function present(result){
  $('place-rows').replaceChildren();
  if(result.ok){
    const a=result.endpoints.current,b=result.endpoints.requested;
    $('summary').textContent=`提供された6か所の配置が対応しています。現在と変更案を各15組ずつ読み取りました。変更した場所：${result.changes.length}か所。`;
    for(const id of IDS){
      const x=a.places.find(p=>p.id===id),y=b.places.find(p=>p.id===id),row=document.createElement('tr');
      row.append(td(names[id]),td(boundsText(x.measuredMeshBounds)),td(boundsText(y.measuredMeshBounds)),td(`${x.measuredMeshCount} → ${y.measuredMeshCount}`));$('place-rows').append(row);
    }
  } else $('summary').textContent=`照合結果を返しませんでした：${result.error}${result.endpoint?' / '+result.endpoint:''}`;
  $('report').textContent=JSON.stringify({scenario:lastCase,scenarioLabel:labels[lastCase],runs,resetCount,calls:{...calls},
    actualEvidence:['actual','swapped','stale'].includes(lastCase)?actualEvidence:null,
    displayIsFixedSummaryNotRawProjection:true,result},null,2);
}
function run(kind){
  const buttons=[...document.querySelectorAll('[data-case]')];buttons.forEach(b=>b.disabled=true);
  latest=null;lastCase=kind;$('place-rows').replaceChildren();$('summary').textContent='配置と範囲を照合しています…';$('report').textContent='読取中';$('status').textContent='照合中です。';
  try{
    const args=inputs(kind);calls.pairedInspections++;runs++;
    latest=globalThis.PetContractorPairedMeshBoundsReview.inspect(...args);present(latest);
    buttons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.case===kind)));
    $('status').textContent=`${labels[kind]}を表示しました。提供された配置の一致と範囲だけの見本です。`;
  } catch(error){
    latest=null;$('place-rows').replaceChildren();$('summary').textContent='見本の準備を完了できませんでした。';
    $('report').textContent=JSON.stringify({scenario:kind,setupError:'diagnostic_preparation_failed',calls:{...calls}},null,2);$('status').textContent='準備の失敗を記録しました。';
  } finally{buttons.forEach(b=>b.disabled=false);}
}
for(const button of document.querySelectorAll('[data-case]')) button.addEventListener('click',()=>run(button.dataset.case));
$('reset').addEventListener('click',()=>{latest=null;lastCase=null;resetCount++;$('place-rows').replaceChildren();$('summary').textContent='例を選ぶと照合結果を表示します。';$('report').textContent='未読取';document.querySelectorAll('[data-case]').forEach(b=>b.setAttribute('aria-pressed','false'));$('status').textContent='表示を戻しました。2つの架空の控えは、このページの中だけで保持します。';});
globalThis.PetPairedMeshBoundsProof=Object.freeze({getState:()=>({lastCase,runs,resetCount,calls:{...calls},actualEvidence,latest})});
$('status').textContent='照合する例を選んでください。';

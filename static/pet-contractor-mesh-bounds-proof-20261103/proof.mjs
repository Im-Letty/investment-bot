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
import '../pet-contractor-scene-mesh-projection.js';
import '../pet-contractor-mesh-bounds.js';

const $ = id => document.getElementById(id);
const IDS = ['home','cafe','shop','playground','tree','flowers'];
const names = {home:'家',cafe:'カフェ',shop:'店',playground:'広場',tree:'木の場所',flowers:'花の場所'};
const cases = {actual:'現在のsource',separate:'離れた包絡',touch:'端が接する包絡',overlap:'重なる包絡',unreferenced:'未参照の遠い頂点',flat:'点になる投影',sprite:'Meshなしの場所',malformed:'不正な添字',nonfinite:'有限でない座標',overflow:'差が範囲を超える座標'};
const relationNames = {bounds_separate:'包絡は離れている',bounds_touch:'包絡の端が接している',bounds_overlap:'包絡が重なる',unavailable_no_mesh:'Meshの範囲なし・未確認'};
const clone = v => JSON.parse(JSON.stringify(v));
const layoutBase = {version:1,theme:'cafe',items:IDS.map((id,i)=>({id,x:[22,72,22,72,48,48][i],y:[23,23,65,65,44,83][i]}))};
let actualJSON = null, actualEvidence = null, latest = null, lastCase = null, runs = 0, resetCount = 0;
const calls = {actualSourceBuilds:0,projectionCaptures:0,boundsInspections:0,TextureLoader:0,fetch:0,Image:0};

function captureActual() {
  if (actualJSON !== null) return actualJSON;
  const layout = clone(layoutBase), layoutBefore = JSON.stringify(layout), world = globalThis.PetTownWalk.createWorld(layout), townBefore = clone(world);
  const priorFetch = globalThis.fetch, priorImage = globalThis.Image;
  const T = {...THREE,TextureLoader:class {constructor(){calls.TextureLoader++;throw Error('outside_diagnostic_art_loader');}}};
  let built = null, pendingJSON = null, pendingEvidence = null;
  globalThis.fetch = () => {calls.fetch++;throw Error('outside_diagnostic_network');};
  globalThis.Image = class {constructor(){calls.Image++;throw Error('outside_diagnostic_image');}};
  try {
    calls.actualSourceBuilds++;
    built = globalThis.PetTownScene.buildWorld(T,world,{},null,null,'summer');
    built.scene.updateMatrixWorld(true);
    const worldBefore = JSON.stringify(world), source = [];
    for (const group of built.placeGroups) group.traverse(m=>{
      if(m.isMesh) source.push({m,positions:m.geometry.attributes.position.array.slice(),indices:m.geometry.index?.array.slice() ?? null,matrix:m.matrixWorld.toArray(),visible:m.visible});
    });
    calls.projectionCaptures++;
    const projection = globalThis.PetContractorSceneMeshProjection.capture({THREE:T,built,world,providedLayout:layout,townBefore});
    if(!projection.ok) throw Error(projection.error);
    const unchanged = source.every(({m,positions,indices,matrix,visible})=>
      positions.length===m.geometry.attributes.position.array.length && positions.every((v,i)=>Object.is(v,m.geometry.attributes.position.array[i])) &&
      (indices===null?m.geometry.index===null:indices.length===m.geometry.index.array.length&&indices.every((v,i)=>v===m.geometry.index.array[i])) &&
      matrix.every((v,i)=>Object.is(v,m.matrixWorld.elements[i])) && visible===m.visible);
    if(!unchanged || JSON.stringify(world)!==worldBefore || JSON.stringify(layout)!==layoutBefore) throw Error('explicit_fixture_changed');
    pendingJSON = JSON.stringify(projection);
    pendingEvidence = {sourceWorldAndLayoutUnchanged:true,allSourcePositionsIndicesMatricesVisibilityUnchanged:true,
      sourceMeshRowsCompared:source.length,inputJSONCharacters:pendingJSON.length,sourceProjectionTotals:projection.totals,
      typedArrayBytesPreservedByJSONClaimed:false,originalArtLoaded:false,WebGLRendererCreated:false};
  } finally {
    globalThis.fetch = priorFetch; globalThis.Image = priorImage;
    if(built) built.dispose();
  }
  pendingEvidence.fixtureDisposed = true;
  actualJSON = pendingJSON;
  actualEvidence = pendingEvidence;
  return actualJSON;
}
function counts() {return {meshCount:0,positionCount:0,triangleCount:0,spriteCount:0,batchedOriginalCount:0,nonSolidWaterMeshCount:0,nonSolidWindowMeshCount:0,otherObjectCount:0};}
function controlled(kind) {
  const report = {ok:true,version:1,scope:'actual_scene_place_mesh_projection',coordinateSpace:'scene_world_xyz_and_xz',worldSize:{width:2880,height:1920},
    originalArtState:'controlled_no_art',originalArtResourceState:'idle',mappingValidation:'Controlled numeric fixture; no game context.',geometryScope:'Controlled stored triangle positions.',batchMatrixScope:'No batching.',drawScope:'Stored triangles; no rendered coverage.',places:[],totals:counts(),gaps:['Controlled fixture only.'],collisionOrClearanceAssessed:false,gameOrStorageConnected:false,mutationsPerformed:false};
  const unit = [[0,0],[1,0],[0,1]], at = {home:[0,0],cafe:[3,0],shop:[10,0],playground:[13,0]};
  if(kind==='touch') at.cafe=[1,0];
  if(kind==='overlap' || kind==='flat') at.cafe=[.5,.5];
  for(const id of IDS) {
    const mapping = {providedPercent:{x:22,y:23},townBefore:{id,x:1,y:1,footprint:{x:1,y:1,rx:1,ry:1},entrance:{x:1,y:1}},sceneEffective:{id,x:1,y:1,footprint:{x:1,y:1,rx:1,ry:1},entrance:{x:1,y:1}},worldOrigin:{x:0,y:0,z:0}};
    const p = {id,mapping,meshes:[],sprites:[],coverage:{...counts(),renderedCoverageComplete:false}};
    if(at[id]) {
      let points=unit.map(([x,z])=>[x+at[id][0],z+at[id][1]]);
      if(kind==='flat'&&id==='home') points=[[.75,.75],[.75,.75],[.75,.75]];
      if(kind==='overflow'&&(id==='home'||id==='cafe')) points=unit.map(()=>[id==='home'?Number.MAX_VALUE:-Number.MAX_VALUE,0]);
      if(kind==='unreferenced'&&id==='home') points.push([10000,10000]);
      const m={id:id+':mesh:0000',name:'controlled-triangle',geometryType:'BufferGeometry',positionArrayType:'Float64Array',indexArrayType:'Uint32Array',
        worldPositions:points.flatMap(([x,z])=>[x,0,z]),xzPositions:points.flat(),indices:[0,1,2],positionCount:points.length,triangleCount:1,indexWasPresent:true,
        matrixWorld:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],visibleAtCapture:true,batchedOriginal:false,batchName:null,batchInstanceIndex:null,batchInstanceMatrix:null,
        nonSolidWater:false,nonSolidWindow:false,drawRange:{start:0,count:null},geometryGroups:[]};
      p.meshes.push(m);p.coverage.meshCount=1;p.coverage.positionCount=points.length;p.coverage.triangleCount=1;
    } else {
      p.sprites.push({name:id+'-unmeasured',kind:id,visibleAtCapture:false,originalArt:true,sourceSHA256:null,worldOrigin:{x:0,y:0,z:0}});p.coverage.spriteCount=1;
    }
    report.places.push(p);for(const k of Object.keys(report.totals))report.totals[k]+=p.coverage[k];
  }
  if(kind==='malformed') report.places[0].meshes[0].indices[2]=999;
  if(kind==='nonfinite') {
    report.places[0].meshes[0].worldPositions[0]='NONFINITE';report.places[0].meshes[0].xzPositions[0]='NONFINITE';
    return JSON.stringify(report).replaceAll('"NONFINITE"','1e309');
  }
  return JSON.stringify(report);
}
function numeric(n) {return Number.isFinite(n)?String(Number(n.toPrecision(7))):'—';}
function boundsText(b) {return b===null?'未測定':`X ${numeric(b.minX)}〜${numeric(b.maxX)} / Z ${numeric(b.minZ)}〜${numeric(b.maxZ)}`;}
function td(text) {const x=document.createElement('td');x.textContent=text;return x;}
function present(report) {
  $('place-rows').replaceChildren();$('pair-rows').replaceChildren();
  if(report.ok) {
    $('summary').textContent=`${report.places.length}か所・${report.pairs.length}組 / Mesh ${report.totals.measuredMeshCount} / 三角形 ${report.totals.triangleCount.toLocaleString('ja-JP')}`;
    for(const p of report.places) {const row=document.createElement('tr');row.append(td(names[p.id]),td(boundsText(p.measuredMeshBounds)),td(`${p.referencedVertexCount} / ${p.unreferencedVertexCount}`),td(String(p.unmeasuredSpriteCount)));$('place-rows').append(row);}
    for(const p of report.pairs) {const row=document.createElement('tr');row.append(td(p.ids.map(id=>names[id]).join('・')),td(relationNames[p.relation]),td(p.axisSpans?`X ${numeric(p.axisSpans.signedOverlapX)} / Z ${numeric(p.axisSpans.signedOverlapZ)}`:'—'));$('pair-rows').append(row);}
  } else $('summary').textContent=`読取を返しませんでした：${report.error}`;
  const display = report.ok ? {...report,places:report.places.map(p=>({...p,meshes:p.meshes.slice(0,2),meshRowsInFullResult:p.meshes.length,displayedMeshRows:Math.min(2,p.meshes.length)}))}:report;
  $('report').textContent=JSON.stringify({scenario:lastCase,scenarioLabel:cases[lastCase],runs,resetCount,calls:{...calls},actualEvidence:lastCase==='actual'?actualEvidence:null,
    displayIsSummaryNotFullRawInputOrResult:true,meshSummaryLimitPerPlace:2,result:display},null,2);
}
function run(kind) {
  const buttons=[...document.querySelectorAll('[data-case]')];buttons.forEach(b=>b.disabled=true);
  latest=null;lastCase=kind;
  $('place-rows').replaceChildren();$('pair-rows').replaceChildren();
  $('summary').textContent='範囲を読んでいます…';$('report').textContent='読取中';
  $('status').textContent='範囲を読んでいます…';
  try {
    const json=kind==='actual'?captureActual():controlled(kind);
    calls.boundsInspections++;runs++;lastCase=kind;
    latest=globalThis.PetContractorMeshBounds.inspect(json);
    present(latest);$('status').textContent=`${cases[kind]}を表示しました。包絡の関係だけの見本です。`;
  } catch(error) {
    latest=null;lastCase=kind;$('summary').textContent='見本の準備を完了できませんでした。';$('report').textContent=JSON.stringify({scenario:kind,setupError:String(error?.message||error),calls},null,2);$('status').textContent='準備の失敗を記録しました。';
  } finally {buttons.forEach(b=>b.disabled=false);}
}
for(const button of document.querySelectorAll('[data-case]'))button.addEventListener('click',()=>run(button.dataset.case));
$('reset').addEventListener('click',()=>{latest=null;lastCase=null;resetCount++;$('place-rows').replaceChildren();$('pair-rows').replaceChildren();$('summary').textContent='見本を選ぶと範囲を表示します。';$('report').textContent='未読取';$('status').textContent='表示を戻しました。実sourceの控えは同じページ内だけで保持します。';});
globalThis.PetMeshBoundsProof=Object.freeze({getState:()=>({lastCase,runs,resetCount,calls:{...calls},actualEvidence,latest})});
$('status').textContent='見本を選んでください。';

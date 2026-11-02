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
import '../pet-town-scene.js';
import '../pet-contractor-scene-mesh-projection.js';

const $ = (id) => document.getElementById(id);
const names = {home:'家',cafe:'カフェ',shop:'店',playground:'広場',tree:'木の場所',flowers:'花の場所'};
const layoutBase = {version:1,theme:'cafe',items:[
  {id:'home',x:22,y:23},{id:'cafe',x:72,y:23},{id:'shop',x:22,y:65},
  {id:'playground',x:72,y:65},{id:'tree',x:48,y:44},{id:'flowers',x:48,y:83}
]};
const DiagnosticTHREE = Object.freeze({...THREE,TextureLoader:class {
  load(){throw new Error('original_art_loading_is_outside_this_diagnostic');}
  loadAsync(){throw new Error('original_art_loading_is_outside_this_diagnostic');}
}});
let captured = null;
let lastScenario = null;
let captures = 0;
let invalidCalls = 0;
let selectionChanges = 0;
let currentSummary = null;
let cleanupSucceeded = null;
const clone = (x) => JSON.parse(JSON.stringify(x));
const rounded = (x) => Number.isFinite(x) ? Number(x.toFixed(5)) : x;
const point = (x) => x && Object.fromEntries(Object.entries(x).map(([k,v]) => [k,typeof v==='number' ? rounded(v) : v]));

function fixture(kind){
  const layout = clone(layoutBase);
  if(kind==='edge'){
    Object.assign(layout.items[0],{x:0,y:100});
    Object.assign(layout.items[1],{x:100,y:0});
  }
  if(kind==='tree') Object.assign(layout.items[4],{x:50,y:50});
  return layout;
}
function clearPlot(){
  const canvas=$('plot'),ctx=canvas.getContext('2d');
  if(!ctx){
    canvas.width=canvas.width;
    canvas.setAttribute('aria-label','平面投影の描画を利用できません');
    return null;
  }
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#f0f4ec';ctx.fillRect(0,0,canvas.width,canvas.height);
  canvas.setAttribute('aria-label','読取前の平面投影');
  return ctx;
}
function clearPresentation(){
  captured=null;currentSummary=null;lastScenario=null;cleanupSucceeded=null;
  $('stats').replaceChildren();$('coverage').replaceChildren();
  $('mapping').textContent='位置の対応は読取後に表示します。';
  $('plot-description').textContent='読取後に、選んだ場所の X/Z 座標を表示します。';
  $('report').textContent='未読取';clearPlot();
}
function makeStat(label,value){
  const div=document.createElement('div');div.className='stat';
  const strong=document.createElement('strong');strong.textContent=String(value);
  const text=document.createElement('span');text.textContent=label;
  div.append(strong,text);return div;
}
function describeReport(report){
  return {
    ok:report.ok,scope:report.scope,coordinateSpace:report.coordinateSpace,
    scenario:lastScenario,captures,invalidCalls,selectionChanges,selectedPlace:$('place').value,cleanupSucceeded,
    worldSize:report.worldSize,originalArtState:report.originalArtState,
    originalArtResourceState:report.originalArtResourceState,totals:report.totals,
    places:report.places.map(p=>({
      id:p.id,mapping:p.mapping,coverage:p.coverage,
      meshRowsInFullCapture:p.meshes.length,meshRowsDisplayed:Math.min(3,p.meshes.length),
      meshes:p.meshes.slice(0,3).map(m=>({
        id:m.id,name:m.name,positionCount:m.positionCount,triangleCount:m.triangleCount,
        indexWasPresent:m.indexWasPresent,visibleAtCapture:m.visibleAtCapture,
        batchedOriginal:m.batchedOriginal,batchInstanceIndex:m.batchInstanceIndex,
        nonSolidWater:m.nonSolidWater,nonSolidWindow:m.nonSolidWindow,
        drawRange:m.drawRange,geometryGroupCount:m.geometryGroups.length,geometryGroups:m.geometryGroups.slice(0,3),
        firstWorldXYZ:m.worldPositions.slice(0,9),firstXZ:m.xzPositions.slice(0,6),firstIndices:m.indices.slice(0,6)
      })),sprites:p.sprites
    })),
    gaps:report.gaps,collisionOrClearanceAssessed:report.collisionOrClearanceAssessed,
    gameOrStorageConnected:report.gameOrStorageConnected,
    fullTriangleDataPresentInDetachedResult:true,summaryIsNotFullRawGeometry:true,
    summaryMeshLimitPerPlace:3,summaryGeometryGroupLimitPerMesh:3
  };
}
function render(){
  const ctx=clearPlot();if(!captured)return;
  if(!ctx)throw new Error('projection_canvas_unavailable');
  const selected=captured.places.find(p=>p.id===$('place').value);
  if(!selected)throw new Error('selected_place_missing');
  const canvas=$('plot'),meshes=selected.meshes;
  let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;
  for(const mesh of meshes) for(let i=0;i<mesh.xzPositions.length;i+=2){
    minX=Math.min(minX,mesh.xzPositions[i]);maxX=Math.max(maxX,mesh.xzPositions[i]);
    minZ=Math.min(minZ,mesh.xzPositions[i+1]);maxZ=Math.max(maxZ,mesh.xzPositions[i+1]);
  }
  if(meshes.length){
    const spanX=Math.max(maxX-minX,.25),spanZ=Math.max(maxZ-minZ,.25),pad=50;
    const scale=Math.min((canvas.width-pad*2)/spanX,(canvas.height-pad*2)/spanZ);
    const cx=(minX+maxX)/2,cz=(minZ+maxZ)/2;
    const xy=(x,z)=>[canvas.width/2+(x-cx)*scale,canvas.height/2+(z-cz)*scale];
    ctx.lineWidth=1;ctx.globalAlpha=.38;
    for(const mesh of meshes){
      ctx.strokeStyle=mesh.nonSolidWater?'#246c96':mesh.nonSolidWindow?'#80511c':'#385e4f';
      ctx.beginPath();
      for(let j=0;j<mesh.indices.length;j+=3){
        for(let k=0;k<3;k++){
          const n=mesh.indices[j+k]*2,uv=xy(mesh.xzPositions[n],mesh.xzPositions[n+1]);
          if(k===0)ctx.moveTo(uv[0],uv[1]);else ctx.lineTo(uv[0],uv[1]);
        }ctx.closePath();
      }ctx.stroke();
    }ctx.globalAlpha=1;
  }
  canvas.setAttribute('aria-label',names[selected.id]+'の平面投影。三角形'+selected.coverage.triangleCount+'。絵の要素'+selected.coverage.spriteCount+'。');
  $('plot-description').textContent=meshes.length
    ? names[selected.id]+'：X '+rounded(minX)+' 〜 '+rounded(maxX)+'、Z '+rounded(minZ)+' 〜 '+rounded(maxZ)+'。高さ Y は記録に含みます。'
    : names[selected.id]+'：Mesh はありません。絵の要素は読取範囲の一覧に残します。';
  const c=selected.coverage;
  $('stats').replaceChildren(makeStat('Mesh',c.meshCount),makeStat('格納三角形',c.triangleCount),
    makeStat('格納頂点',c.positionCount),makeStat('絵の要素',c.spriteCount));
  $('mapping').textContent='元の配置 '+JSON.stringify(point(selected.mapping.providedPercent))+
    ' → 村の座標 '+JSON.stringify(point(selected.mapping.townBefore))+
    ' → 調整後 '+JSON.stringify(point(selected.mapping.sceneEffective))+
    '。立体の原点 '+JSON.stringify(point(selected.mapping.worldOrigin))+'。';
  const items=[
    'まとめ描画用の元 Mesh：'+c.batchedOriginalCount+'。元データを1回ずつ数えます。',
    '水の区分：'+c.nonSolidWaterMeshCount+'、窓の区分：'+c.nonSolidWindowMeshCount+'。',
    '絵の要素：'+c.spriteCount+'。閉じた体積として数えません。',
    '格納バッファ全体の読取です。描画範囲や材質の区分は、記録に別々に残します。'
  ];
  $('coverage').replaceChildren(...items.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
  currentSummary=describeReport(captured);
  $('report').textContent=JSON.stringify(currentSummary,null,2);
}
function runCapture(){
  const restoreFocus=document.activeElement===$('capture');
  clearPresentation();$('capture').disabled=true;
  let built=null;
  try{
    const providedLayout=fixture($('scenario').value);
    const world=window.PetTownWalk.createWorld(providedLayout);
    const townBefore=clone(world);
    built=window.PetTownScene.buildWorld(DiagnosticTHREE,world,{},null,null,'summer');
    built.scene.updateMatrixWorld(true);
    const result=window.PetContractorSceneMeshProjection.capture({THREE:DiagnosticTHREE,built,world,providedLayout,townBefore});
    if(!result || result.ok!==true)throw new Error(result && result.error || 'capture_failed');
    captured=result;captures++;lastScenario=$('scenario').value;render();
    $('status').textContent='6か所の立体データを読みました。原画は未読込、干渉・移設の可否は未判定です。';
  }catch(error){
    clearPresentation();$('status').textContent='読取を止めました：'+String(error && error.message || 'unknown');
    currentSummary={ok:false,error:String(error && error.message || 'unknown'),captures,invalidCalls};
    $('report').textContent=JSON.stringify(currentSummary,null,2);
  }finally{
    try{
      if(built && typeof built.dispose==='function')built.dispose();
      cleanupSucceeded=true;
      if(captured){currentSummary=describeReport(captured);$('report').textContent=JSON.stringify(currentSummary,null,2);}
    }catch(error){
      cleanupSucceeded=false;
      currentSummary={...(currentSummary || {ok:false}),cleanupSucceeded:false,cleanupError:'owned_scene_dispose_failed'};
      $('report').textContent=JSON.stringify(currentSummary,null,2);
      $('status').textContent=captured
        ? '読取結果は得ましたが、見本の後片付けを確認できませんでした。'
        : '読取を完了できず、見本の後片付けも確認できませんでした。';
    }finally{
      $('capture').disabled=false;
      if(restoreFocus)$('capture').focus({preventScroll:true});
    }
  }
}
$('capture').addEventListener('click',runCapture);
$('scenario').addEventListener('change',()=>{
  clearPresentation();
  $('status').textContent='配置の例を変えました。「立体データを読む」を押してください。';
});
$('place').addEventListener('change',()=>{
  if(captured){selectionChanges++;try{render();}catch(e){clearPresentation();$('status').textContent='表示を止めました。';}}
});
$('invalid').addEventListener('click',()=>{
  clearPresentation();invalidCalls++;
  try{
    const result=window.PetContractorSceneMeshProjection.capture({THREE:DiagnosticTHREE});
    const rejected=!!result && result.ok===false;
    currentSummary={ok:result && result.ok,error:result && result.error,invalidInputRejected:rejected,captures,invalidCalls};
    $('report').textContent=JSON.stringify(currentSummary,null,2);
    $('status').textContent=rejected?'欠けた入力を拒否し、前の図をクリアしました。':'欠けた入力の拒否を確認できませんでした。';
  }catch(e){
    currentSummary={ok:false,error:String(e && e.message || 'unknown'),invalidInputRejected:false,captures,invalidCalls};
    $('report').textContent=JSON.stringify(currentSummary,null,2);
    $('status').textContent='例外で停止しました。入力拒否の応答は未確認です。';
  }
});
$('reset').addEventListener('click',()=>{
  clearPresentation();$('scenario').value='base';$('place').value='home';
  $('status').textContent='表示をクリアしました。例を選んで読み直せます。';
});
if(!clearPlot())throw new Error('projection_canvas_unavailable');
function clearOnLeave(){
  clearPresentation();
  $('status').textContent='表示をクリアしました。例を選んで読み直せます。';
}
window.addEventListener('pagehide',clearOnLeave);
window.addEventListener('pageshow',(event)=>{if(event.persisted)clearOnLeave();});
for(const id of ['capture','invalid','reset'])$(id).disabled=false;
document.documentElement.dataset.moduleState='ready';
$('status').textContent='例を選び「立体データを読む」を押してください。';

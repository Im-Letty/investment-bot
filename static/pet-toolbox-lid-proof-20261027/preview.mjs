import * as T from '/static/vendor/three-0.160.1.module.js';
import {build,spec} from './mechanism.mjs';
import {auditPose} from './inspection.mjs';
import {probePlacement} from './placement.mjs';
import {fitView} from '../pet-toolbox-mesh-proof-20261026/framing.mjs';
const $=id=>document.getElementById(id),hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
const response=await fetch('./input-manifest.json');if(!response.ok)throw Error('manifest_unavailable');const manifestBytes=await response.arrayBuffer(),manifest=JSON.parse(new TextDecoder().decode(manifestBytes)),manifestSha=await hash(manifestBytes);
for(const row of [...manifest.files,...manifest.dependencies]){const response=await fetch(row.path.startsWith('/')?row.path:'./'+row.path);if(!response.ok)throw Error('proof_source_unavailable');if(await hash(await response.arrayBuffer())!==row.sha256)throw Error('proof_source_SHA_mismatch');}
const world=PetTownWalk.createWorld(),saved=JSON.stringify(world),season=PetJapanSeasons.resolve(Date.now()),model=PetTownScene.buildWorld(T,world,{},null,document,season.key);
await model.loadOriginalArt();
const baseChildren=model.scene.children.slice(),visibility=new Map(),item=build(T,{document,style:PetTownStyle}),placement=probePlacement(T,PetTownScene,PetTownWalk,world,model,item);
item.group.position.set(placement.worldPosition.x,placement.worldPosition.y,placement.worldPosition.z);model.scene.add(item.group);item.setCarrierAngle(62.5);item.setAngle(50);
const stage=$('stage'),renderer=new T.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:false}),canvas=renderer.domElement;canvas.className='scene';stage.appendChild(canvas);renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.outputColorSpace=T.SRGBColorSpace;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
const camera=new T.PerspectiveCamera(46,1,.04,90),media=matchMedia('(prefers-reduced-motion:reduce)'),center=item.bounds.min.map((n,i)=>(n+item.bounds.max[i])/2),framingBounds={min:item.bounds.min.map((n,i)=>n-center[i]+(i===1?.54:0)),max:item.bounds.max.map((n,i)=>n-center[i]+(i===1?.54:0))};
let dead=false,isolated=false,dirty=true,raf=null,last=0,width=0,height=0,drag=null,framing=null,captureBusy=false,captureGeneration=0;
let actualGeometry=auditPose(T,item);
const view=()=>Object.fromEntries(['yaw','pitch','roll','distance'].map(k=>[k,Number($(k).value)]));
function proof(){return{scope:'bounded-single-tray-rigid-lid-hinge-only',manifest_sha256:manifestSha,spec,state:item.getState(),actualGeometry,placement,budget:item.budget,camera:view(),framing,context:isolated?'isolated-part-inspection':'current-originals1-town-floor-and-light',
 originalArtState:model.scene.userData.originalArtState,inspectionVisibility:{hingePinRetainersHidden:$('bores').checked,sourceGeometryChanged:false},authoredUniformInstanceScale:item.authoredScale,anatomicallyCalibratedScale:false,
 renderer:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,preserveDrawingBuffer:renderer.getContext().getContextAttributes().preserveDrawingBuffer},
 worldUnchanged:JSON.stringify(world)===saved,season:season.key,storageReads:0,storageWrites:0,newRaw:0,newDesign:0,fullToolboxClosure:false,sealedStorage:false,physicalLoadFriction:false,continuousCollisionGuarantee:false,normalPlacement:false,unlock:false,save:false};}
function paint(ms=performance.now()){
 if(dead)return;const box=stage.getBoundingClientRect();if(!(box.width>0&&box.height>0))return;if(width!==box.width||height!==box.height){width=box.width;height=box.height;renderer.setSize(width,height,false);}
 camera.aspect=width/height;camera.updateProjectionMatrix();const v=view();framing=fitView(T,framingBounds,v,camera.aspect);
 const yaw=v.yaw*Math.PI/180,pitch=v.pitch*Math.PI/180,target=new T.Vector3(...center).add(item.group.position);camera.up.set(0,1,0);camera.position.copy(target).add(new T.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)).multiplyScalar(framing.actualDistance));camera.lookAt(target);camera.rotateZ(v.roll*Math.PI/180);camera.updateMatrixWorld(true);
 model.animate(ms,media.matches);renderer.render(model.scene,camera);dirty=false;$('proof').textContent=JSON.stringify(proof(),null,2);stage.dataset.ready='true';
 $('status').textContent=(isolated?'単体で内側・底を表示':'村の床に置いた限定見本')+' ／ ふた '+item.getState().lidAngleDegrees+'°';
 $('checks').textContent='軸の半径方向の余白 '+actualGeometry.minimumBoreClearance.toFixed(4)+' ／ 軸の最小かかり '+actualGeometry.minimumPinOverhang.toFixed(4)+' ／ 凸包の未分離 '+actualGeometry.collisions.length+'件。現在の一姿勢の幾何値です。';

}
function schedule(){if(!dead&&!document.hidden&&raf===null)raf=requestAnimationFrame(tick);}
function tick(ms){raf=null;if(dead||document.hidden)return;if(dirty||!media.matches&&ms-last>=50){paint(ms);last=ms;}if(!media.matches||dirty)schedule();}
function refresh(){dirty=true;schedule();}
function pose(){drag=null;item.setCarrierAngle(Number($('carrier').value));item.setAngle(Number($('angle').value));actualGeometry=auditPose(T,item);renderer.shadowMap.needsUpdate=true;refresh();}
$('angle').addEventListener('input',pose);$('carrier').addEventListener('input',pose);
for(const button of document.querySelectorAll('[data-pose]'))button.onclick=()=>{$('angle').value=String({min:0,mid:50,max:100}[button.dataset.pose]);pose();};
function context(){for(const o of baseChildren){if(isolated&&!o.isLight){visibility.set(o,o.visible);o.visible=false;}else if(!isolated&&visibility.has(o))o.visible=visibility.get(o);}if(!isolated)visibility.clear();renderer.shadowMap.needsUpdate=true;refresh();}
$('context').onclick=()=>{isolated=!isolated;drag=null;context();$('context').textContent=isolated?'村の床に戻る':'単体・底を見る';};
$('bores').onchange=()=>{for(const part of item.lidParts)if(['hinge-pin','hinge-collar','hinge-cap'].includes(part.role))part.mesh.visible=!$('bores').checked;renderer.shadowMap.needsUpdate=true;refresh();};
for(const id of['yaw','pitch','roll','distance'])$(id).addEventListener('input',()=>{drag=null;refresh();});
const views={front:[0,15,0],side:[90,15,0],back:[180,15,0],top:[0,88,0],bottom:[0,-80,0]};
for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>{['yaw','pitch','roll'].forEach((key,i)=>$(key).value=String(views[button.dataset.view][i]));if(button.dataset.view==='bottom'&&!isolated){isolated=true;context();$('context').textContent='村の床に戻る';}refresh();};
$('reset').onclick=()=>{['yaw','pitch','roll','distance'].forEach((key,i)=>$(key).value=String([25,24,0,4][i]));refresh();};
stage.addEventListener('pointerdown',e=>{if(e.button!==0||e.isPrimary===false||captureBusy)return;stage.focus({preventScroll:true});drag={id:e.pointerId,x:e.clientX,y:e.clientY,yaw:Number($('yaw').value),pitch:Number($('pitch').value)};stage.setPointerCapture(e.pointerId);});
stage.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;$('yaw').value=String(Math.max(-360,Math.min(360,drag.yaw+(e.clientX-drag.x)*.4)));$('pitch').value=String(Math.max(-89,Math.min(89,drag.pitch+(e.clientY-drag.y)*.3)));refresh();});
for(const kind of['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(kind,()=>drag=null);window.addEventListener('blur',()=>drag=null);window.addEventListener('resize',refresh);media.addEventListener('change',refresh);
document.addEventListener('visibilitychange',()=>{drag=null;if(document.hidden){if(raf!==null)cancelAnimationFrame(raf);raf=null;}else refresh();});
// Export the canvas immediately after its real render. No original image is edited.
$('capture').onclick=async()=>{
 if(dead||captureBusy)return;captureBusy=true;drag=null;$('capture').disabled=true;const generation=++captureGeneration;
 try{paint();const png=canvas.toDataURL('image/png'),metadata=JSON.parse(JSON.stringify(proof())),blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('canvas_export_failed');
  $('snapshot').src=png;$('snapshot').hidden=false;const download=$('download');if(download.dataset.blobURL)URL.revokeObjectURL(download.dataset.blobURL);download.href=URL.createObjectURL(blob);download.dataset.blobURL=download.href;download.download='toolbox-lid.png';download.hidden=false;
  let receipt={scope:'unmodified-current-WebGL-canvas-only',metadata};
  if(['localhost','127.0.0.1','[::1]'].includes(location.hostname)){
   const response=await fetch('/__capture/toolbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:'lid-'+Math.round(item.getState().lidAngleDegrees)+(isolated?'-isolated':'-town'),png,manifest_sha256:manifestSha,metadata})});
   if(!response.ok)throw Error('capture_rejected');receipt=await response.json();
  }
  if(!dead&&generation===captureGeneration){$('receipt').textContent=JSON.stringify(receipt,null,2);$('receipt').hidden=false;}
 }catch(_){if(!dead){$('receipt').textContent='ローカル保存は未確認です。画像のダウンロードを利用できます。';$('receipt').hidden=false;}}
 finally{if(!dead){captureBusy=false;$('capture').disabled=false;}}
};
window.addEventListener('pagehide',()=>{if(dead)return;dead=true;captureGeneration++;if(raf!==null)cancelAnimationFrame(raf);if($('download').dataset.blobURL)URL.revokeObjectURL($('download').dataset.blobURL);item.dispose();model.dispose();renderer.dispose();},{once:true});
paint();schedule();

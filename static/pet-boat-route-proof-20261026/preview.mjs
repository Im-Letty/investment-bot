import * as THREE from './runtime/vendor/three-0.160.1.module.js';
const $=id=>document.getElementById(id),API=window.PetBoatLandingProof,Scene=window.PetTownScene,Town=window.PetTownWalk,Seasons=window.PetJapanSeasons;
const manifestResponse=await fetch('./input-manifest.json'),manifestText=await manifestResponse.text(),manifest=JSON.parse(manifestText);
const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),n=>n.toString(16).padStart(2,'0')).join('');
const manifestSha=await hash(new TextEncoder().encode(manifestText)),world=Town.createWorld(),worldBefore=JSON.stringify(world);
const actual=Seasons.resolve(Date.now()),model=Scene.buildWorld(THREE,world,{},null,document,actual.key),input=API.extract(THREE,Scene,model,world,PetRiverFishing.site());
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:false});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
const stage=$('stage'),canvas=renderer.domElement;canvas.setAttribute('aria-hidden','true');stage.append(canvas);
const camera=new THREE.PerspectiveCamera(50,1,.05,80),baseChildren=model.scene.children.slice(),baseVisibility=new Map();
let lastWidth=0,lastHeight=0,dock=null,proposal=null,isolated=false,routeView=false,dead=false,raf=null,last=0,captureBusy=false,seasonKey=actual.key,drag=null,dirty=true;
const media=matchMedia('(prefers-reduced-motion:reduce)');
const view=()=>Object.fromEntries(['yaw','pitch','roll','distance'].map(k=>[k,Number($(k).value)]));
function restoreContext(){baseVisibility.forEach((v,o)=>{o.visible=v;});baseVisibility.clear();}
function applyContext(){if(isolated)baseChildren.forEach(o=>{if(!o.isLight){if(!baseVisibility.has(o))baseVisibility.set(o,o.visible);o.visible=false;}});}
function targetPoint(){const p=proposal?.candidate;if(!p)return{point:new THREE.Vector3(0,.3,0),distance:10};const q=routeView?{x:(p.route[0].x+p.route.at(-1).x)/2,y:(p.route[0].y+p.route.at(-1).y)/2}:p.shore;
 return{point:new THREE.Vector3((q.x-input.origin.x)/input.scale,.20,(q.y-input.origin.y)/input.scale),distance:routeView?Math.max(9,Number($('distance').value)):Number($('distance').value)};}
function proof(){return{technicalScope:'landing-route-only',sourceMerge:manifest.source_merge,sourceManifestSha:manifestSha,normalDrawingBufferRetention:renderer.getContext().getContextAttributes().preserveDrawingBuffer,season:seasonKey,actualJST:actual.dateJst,valid:proposal?.ok??false,report:proposal?.report,envelopeRadius:Number($('radius').value),margin24_is_provisional:true,worldUnchanged:JSON.stringify(world)===worldBefore,gameCoreLoaded:false,storageReads:0,storageWrites:0,characterOrHullOrBoardingOrSailing:false,isolate:isolated,camera:view(),rendererInfo:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles},canvas:{width:canvas.width,height:canvas.height}};}
function publish(){const r=proof();$('proof').textContent=JSON.stringify(r,null,2);stage.dataset.routeValid=String(r.valid);stage.dataset.sceneState='ready';$('contextLabel').textContent=(isolated?'桟橋だけ':'現在の村に置いた技術候補')+'・'+Seasons.profile(seasonKey).label;}
function paint(ms=performance.now()){if(dead)return;const box=stage.getBoundingClientRect();if(!(box.width>0&&box.height>0))return;
 if(lastWidth!==box.width||lastHeight!==box.height){renderer.setSize(box.width,box.height,false);lastWidth=box.width;lastHeight=box.height;}
 camera.aspect=box.width/box.height;camera.updateProjectionMatrix();const c=view(),target=targetPoint(),yaw=c.yaw*Math.PI/180,pitch=c.pitch*Math.PI/180,d=target.distance;
 camera.up.set(0,1,0);camera.position.copy(target.point).add(new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch)*d,Math.sin(pitch)*d,Math.cos(yaw)*Math.cos(pitch)*d));camera.lookAt(target.point);camera.rotateZ(c.roll*Math.PI/180);
 model.animate(ms,media.matches);renderer.render(model.scene,camera);dirty=false;publish();}
function schedule(){if(!dead&&!document.hidden&&raf===null)raf=requestAnimationFrame(tick);}
function tick(ms){raf=null;if(dead||document.hidden)return;if(dirty||!media.matches&&ms-last>=40){paint(ms);last=ms;}if(!media.matches||dirty)schedule();}
function refresh(){dirty=true;schedule();}
function rebuild(){dock?.dispose();dock=null;proposal=API.propose(input,{vesselRadius:Number($('radius').value)});if(proposal.ok){dock=API.buildDock(THREE,input,proposal.candidate);model.scene.add(dock.group);}
 $('status').dataset.valid=String(proposal.ok);$('status').textContent=proposal.ok?'この仮寸法で必要な余白を確認しました':'この仮寸法では航路に余白が足りません';
 renderer.shadowMap.needsUpdate=true;refresh();}
for(const k of ['yaw','pitch','roll','distance'])$(k).addEventListener('input',refresh);
$('radius').addEventListener('change',rebuild);
$('dockView').onclick=()=>{routeView=false;$('distance').value='7.5';refresh();};$('routeView').onclick=()=>{routeView=true;$('distance').value='11';refresh();};
$('isolate').onclick=()=>{restoreContext();isolated=!isolated;applyContext();$('isolate').textContent=isolated?'村の景色に戻る':'桟橋単体・底面も見る';renderer.shadowMap.needsUpdate=true;refresh();};
document.querySelectorAll('[data-season]').forEach(b=>b.onclick=()=>{restoreContext();seasonKey=b.dataset.season==='actual'?Seasons.resolve(Date.now()).key:b.dataset.season;model.setSeason(seasonKey);applyContext();renderer.shadowMap.needsUpdate=true;refresh();});
stage.addEventListener('pointerdown',e=>{if(e.button!==0||e.isPrimary===false)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,yaw:Number($('yaw').value),pitch:Number($('pitch').value)};stage.setPointerCapture(e.pointerId);});
stage.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;$('yaw').value=String((((drag.yaw+(e.clientX-drag.x)*.35)+180)%360+360)%360-180);$('pitch').value=String(Math.max(-40,Math.min(80,drag.pitch+(e.clientY-drag.y)*.24)));refresh();});
function stopDrag(){drag=null;}stage.addEventListener('pointerup',stopDrag);stage.addEventListener('pointercancel',stopDrag);window.addEventListener('blur',stopDrag);window.addEventListener('resize',refresh);
document.addEventListener('visibilitychange',()=>{stopDrag();if(raf!==null)cancelAnimationFrame(raf);raf=null;if(!document.hidden)refresh();});media.addEventListener('change',refresh);
$('export').onclick=()=>{if(dead||captureBusy)return;captureBusy=true;$('export').disabled=true;paint();const state=Object.freeze({version:1,nonce:Array.from(crypto.getRandomValues(new Uint8Array(12)),n=>n.toString(16).padStart(2,'0')).join(''),scope:'landing-route-technical-only',manifestSha,season:seasonKey,view:Object.freeze(view()),isolate:isolated,envelopeRadius:Number($('radius').value),routeValid:proposal.ok,normalBuffer:renderer.getContext().getContextAttributes().preserveDrawingBuffer===false});
 canvas.toBlob(async blob=>{try{if(!blob)throw Error('PNG unavailable');const url=URL.createObjectURL(blob);$('snapshot').src=url;$('snapshot').hidden=false;$('download').href=url;$('download').download='boat-route-'+state.nonce+'.png';$('download').hidden=false;
 if(location.hostname==='127.0.0.1'&&location.protocol==='http:'){const response=await fetch('/__qa__/capture',{method:'POST',headers:{'Content-Type':'image/png','X-QA-Capture':btoa(JSON.stringify(state))},body:blob,credentials:'omit'}),r=await response.json();if(!response.ok||!r.ok||r.nonce!==state.nonce)throw Error('capture not saved');$('receipt').textContent=JSON.stringify(r,null,2);$('receipt').dataset.state='saved';}
 else{$('receipt').textContent='PNGの準備ができました。ダウンロードから保存できます。';$('receipt').dataset.state='download_ready';}
 }catch(_){$('receipt').textContent='PNGの保存は未確認です。';$('receipt').dataset.state='failed';}finally{captureBusy=false;$('export').disabled=false;}},'image/png');};
window.addEventListener('pagehide',()=>{dead=true;if(raf!==null)cancelAnimationFrame(raf);dock?.dispose();model.dispose();renderer.dispose();renderer.forceContextLoss();});
rebuild();paint();schedule();

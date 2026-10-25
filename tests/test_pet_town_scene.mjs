import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Scene from '../static/pet-town-scene.js';
import Town from '../static/pet-town-walk.js';
import Fishing from '../static/pet-river-fishing.js';
import FrameFit from '../static/pet-frame-fit.js';
import Seasons from '../static/pet-japan-seasons.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

class Events {
 constructor(){this.events=new Map();}
 addEventListener(name,fn){if(!this.events.has(name))this.events.set(name,new Set());this.events.get(name).add(fn);}
 removeEventListener(name,fn){this.events.get(name)?.delete(fn);}
 emit(name,extra={}){const e={target:this,button:0,isPrimary:true,cancelable:true,preventDefault(){},...extra};for(const fn of [...this.events.get(name)||[]])fn(e);return e;}
 count(){return [...this.events.values()].reduce((n,s)=>n+s.size,0);}
}
class Element extends Events {
 constructor(doc,tag='DIV'){super();this.ownerDocument=doc;this.tagName=tag;this.dataset={};this.style={};this.children=[];this.isConnected=true;this.width=16;this.height=16;}
 appendChild(child){child.parentNode=this;this.children.push(child);return child;}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(x=>x!==this);this.isConnected=false;}
 setAttribute(){}
 getBoundingClientRect(){return {left:0,top:0,width:390,height:700};}
}
async function fixture(options={}){
 const doc=new Events(),win=new Events(),host=new Element(doc),media=new Events(),frames=new Map(),renderers=[],images=[],observers=[],timers=new Map();
 let stamp=0,seq=0,allowed=true,ready=0;const failures=[];
 doc.defaultView=win;doc.hidden=false;media.matches=!!options.reduced;
 Object.assign(win,{setTimeout:(fn,delay)=>{timers.set(++seq,{fn,delay});return seq;},clearTimeout:id=>timers.delete(id),devicePixelRatio:3,performance:{now:()=>stamp},matchMedia:()=>media,requestAnimationFrame:fn=>{frames.set(++seq,fn);return seq;},cancelAnimationFrame:id=>frames.delete(id),Image:class{constructor(){images.push(this);this.width=this.height=this.naturalWidth=this.naturalHeight=1254;this.tagName='IMG';this.complete=true;}removeAttribute(){this.src='';}}});
 win.ResizeObserver=class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
 class Renderer{
  constructor(){this.domElement=new Element(doc,'CANVAS');this.shadowMap={};this.renderLists={dispose:()=>{this.listsDisposed=true;}};this.calls=[];this.uploads=[];renderers.push(this);}
  setPixelRatio(v){this.ratio=v;}
  setSize(w,h){this.domElement.width=w;this.domElement.height=h;}
  initTexture(texture){if(this.failUpload)throw Error('synthetic GPU upload failure');this.allocations=this.allocations||new WeakMap();const size=[texture.image.naturalWidth||texture.image.width,texture.image.naturalHeight||texture.image.height],allocated=this.allocations.get(texture);if(allocated&&(allocated[0]!==size[0]||allocated[1]!==size[1]))throw Error('synthetic immutable GPU texture dimensions changed');this.allocations.set(texture,size);this.uploads.push({version:texture.version,source:texture.image});}
  render(scene,camera){if(this.fail)throw Error('synthetic GPU render failure');if(scene.matrixWorldAutoUpdate)scene.updateMatrixWorld();camera.updateMatrixWorld(true);this.calls.push({camera,scene,sourceVersion:scene.getObjectByName('current-pet-2d-frame')?.material.map?.version});}
  dispose(){this.disposed=true;}
  forceContextLoss(){this.lost=true;}
 }
 if(options.configureHost)options.configureHost(host);
 const world=options.world||Town.createWorld(),controller=await (options.sceneAPI||Scene).mount({viewport:host,world,position:options.position||{x:1100,y:1100},camera:options.camera,view:options.view,canRun:()=>allowed,three:{...THREE,WebGLRenderer:Renderer},onReady:()=>ready++,onFailure:c=>failures.push(c),onFacing:options.onFacing,seasonNow:options.seasonNow,seasonSubscribe:options.seasonSubscribe});
 const source=new Element(doc,'CANVAS');source.getContext=()=>({RGBA:1,UNSIGNED_BYTE:2,readPixels(x,y,w,h,format,type,pixels){pixels[(2*w+8)*4+3]=255;}});
 return {doc,win,host,media,frames,renderers,images,observers,timers,world,source,controller,failures,get ready(){return ready;},get now(){return stamp;},allow:v=>{allowed=v;},time:v=>{stamp=v;},frame(ms=16){stamp+=ms;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(stamp));},project(p){const camera=renderers[0].calls.at(-1).camera,g=Scene.groundPoint(world,p),v=new THREE.Vector3(g.x,Scene.heightAt(p),g.z).project(camera);return {clientX:(v.x+1)*195,clientY:(1-v.y)*350};}};
}

test('world coordinates round-trip and camera settings are bounded without touching the input',()=>{
 const world=Town.createWorld();for(const p of [{x:28,y:28},{x:1500,y:1100},{x:2770,y:1160}]){const back=Scene.townPoint(world,Scene.groundPoint(world,p));assert.ok(Math.hypot(p.x-back.x,p.y-back.y)<1e-9);}
 const raw={yaw:8,pitch:-Infinity,distance:100},before=JSON.stringify(raw),c=Scene.cameraState(raw);assert.equal(JSON.stringify(raw),before);assert.equal(c.distance,10);assert.equal(c.pitch,Math.PI/6);assert.ok(c.yaw>=-Math.PI&&c.yaw<=Math.PI);
 for(const y of [-100,100])assert.ok(Scene.cameraState({pitch:y}).pitch>=22*Math.PI/180&&Scene.cameraState({pitch:y}).pitch<=56*Math.PI/180);
 const d=Scene.cameraDirection(0,-1,Math.PI/2);assert.ok(Math.abs(d.x+1)<1e-8&&Math.abs(d.y)<1e-8);
 assert.equal(Scene.cameraDistance(8,null),8);assert.ok(Scene.cameraDistance(8,.02)<.02);assert.equal(Scene.cameraDistance(8,4),3.88);
});

test('browser registration can precede the visual-only helper and mount adopts the later shared contract',async()=>{
 const context=vm.createContext({PetTownWalk:Town});vm.runInContext(readFileSync(new URL('../static/pet-town-scene.js',import.meta.url),'utf8'),context);
 assert.equal(context.PetFrameFit,undefined);assert.equal(typeof context.PetTownScene.mount,'function');
 const size=context.PetTownScene.sourceSize({tagName:'IMG',complete:true,naturalWidth:64,naturalHeight:32});assert.equal(size.width,64);assert.equal(size.height,32);
 assert.equal(context.PetTownScene.sourceSize({tagName:'CANVAS',width:Infinity,height:16}),null);
 assert.equal(context.PetTownScene.alphaAnchor({tagName:'CANVAS',width:16,height:16,getContext:()=>null}),null);
 const painted={tagName:'CANVAS',width:16,height:16,getContext:()=>({RGBA:1,UNSIGNED_BYTE:2,readPixels(x,y,w,h,a,b,p){p[(2*w+8)*4+3]=255;}})};
 assert.equal(context.PetTownScene.alphaAnchor(painted),.125,'the existing public diagnostics work synchronously before any mount or helper import');
 context.PetFrameFit=FrameFit;context.PetJapanSeasons=Seasons;
 const f=await fixture({sceneAPI:context.PetTownScene});try{assert.equal(f.controller.setFrame(f.source,{anchor:.3}),true);assert.equal(f.renderers[0].calls.at(-1).scene.getObjectByName('current-pet-2d-frame').center.y,.3);assert.deepEqual(f.failures,[]);}finally{f.controller.destroy();}
});

test('actual geometry uses the six saved facilities and funding/open economy sites, without a terrain painting',()=>{
 const world=Town.createWorld({items:[{id:'home',x:30,y:40}]}),snapshot=JSON.stringify(world);
 world.places.push({id:'economy-tea',shopId:'tea',status:'funding',label:'お茶のお店',x:1400,y:500,entrance:{x:1400,y:590},footprint:{x:1400,y:452,rx:94,ry:66}});
 const before=JSON.stringify(world),m=Scene.buildWorld(THREE,world,{});m.scene.updateMatrixWorld(true);
 assert.equal(m.placeGroups.length,7);assert.deepEqual(m.placeGroups.map(g=>g.userData.placeId),world.places.map(p=>p.id));
 assert.equal(JSON.stringify(world),before);assert.notEqual(before,snapshot);assert.equal(m.surfaces.length,2);assert.ok(m.occluders.length>30);
 assert.ok([...m.materials].every(x=>!x.map),'the terrain is geometry, not the old house-painted image');
 const ray=new THREE.Raycaster();for(const p of [{x:500,y:1100},{x:2200,y:1500},{x:2770,y:1160}]){const q=Scene.groundPoint(world,p);ray.set(new THREE.Vector3(q.x,5,q.z),new THREE.Vector3(0,-1,0));const hits=ray.intersectObjects(m.surfaces);assert.ok(hits.length);assert.ok(Math.abs(hits[0].point.y-Scene.heightAt(p))<1e-6);}
 const wet=Scene.groundPoint(world,{x:2750,y:1550});ray.set(new THREE.Vector3(wet.x,5,wet.z),new THREE.Vector3(0,-1,0));assert.equal(ray.intersectObjects(m.surfaces).length,0,'water has no tap-walkable floor');
 let disposed=0;for(const g of m.geometries)g.addEventListener('dispose',()=>disposed++);const n=m.geometries.size;m.dispose();m.dispose();assert.equal(disposed,n);
});

test('the initial population gate returns no appearances and never mutates populated economy records',()=>{
 const world=Town.createWorld(),view={residents:Array.from({length:10},(_,i)=>({id:'r'+i,name:'住人'+i})),visitors:Array.from({length:5},(_,i)=>({id:'v'+i,name:'旅人'+i}))},before=JSON.stringify(view);
 assert.deepEqual(Scene.people(world,view),[]);assert.equal(JSON.stringify(view),before);
 assert.notEqual(Scene.natureFrame(0,false).wind,Scene.natureFrame(1200,false).wind);assert.deepEqual(Scene.natureFrame(0,true),Scene.natureFrame(10000,true));
});

test('instanced foliage receives real transform updates, freezes in reduced motion and releases its resources',()=>{
 const world=Town.createWorld(),m=Scene.buildWorld(THREE,world,{}),batch=m.batches.find(b=>b.dynamic&&b.rows.some(row=>row.parent.name==='overlapping-leaf-crown'));
 assert.ok(batch);assert.ok(batch.rows.every(row=>!row.visible));assert.equal(m.scene.matrixWorldAutoUpdate,false);
 const snapshot=()=>Array.from(batch.mesh.instanceMatrix.array);m.animate(0,true);const initial=snapshot();m.animate(1100,false);assert.notDeepEqual(snapshot(),initial);m.animate(2000,true);assert.deepEqual(snapshot(),initial);m.animate(8000,true);assert.deepEqual(snapshot(),initial);
 let disposed=0;batch.mesh.addEventListener('dispose',()=>disposed++);m.dispose();m.dispose();assert.equal(disposed,1);
});

test('only a real loaded static image or a painted nonempty canvas can activate the scene',async()=>{
 assert.equal(Scene.sourceSize({tagName:'IMG',complete:true,width:240,height:240,naturalWidth:0,naturalHeight:0}),null);
 assert.equal(Scene.sourceSize({tagName:'IMG',complete:false,naturalWidth:200,naturalHeight:200}),null);
 assert.equal(Scene.alphaAnchor({width:512,height:512,getContext:()=>null}),null);
 const f=await fixture(),r=f.renderers[0];assert.equal(f.ready,0);assert.equal(f.frames.size,0,'no idle ambient RAF before a visible character');
 const empty=new Element(f.doc,'CANVAS');empty.getContext=()=>({RGBA:1,UNSIGNED_BYTE:2,readPixels(){}});assert.equal(f.controller.setFrame(empty),false);assert.equal(f.ready,0);
 assert.equal(f.controller.setFrame(f.source),true);assert.equal(f.ready,1);assert.equal(f.host.dataset.visualMode,'three');assert.equal(r.ratio,1.5);assert.equal(r.calls.at(-1).sourceVersion,2);assert.equal(f.frames.size,1);
 const sprite=r.calls.at(-1).scene.getObjectByName('current-pet-2d-frame');assert.equal(sprite.center.y,2/16);assert.equal(sprite.material.depthWrite,true);assert.equal(sprite.material.depthTest,true);f.controller.destroy();
});

test('source buffers upload synchronously while position, source and ambient changes share one world cadence',async()=>{
 const f=await fixture();f.controller.setFrame(f.source);const r=f.renderers[0],first=r.calls.at(-1).sourceVersion;
 for(let i=0;i<20;i++){f.time(i*16+16);f.controller.setPosition({x:1100+i,y:1100});f.controller.setFrame(f.source);f.frame(1);}
 assert.ok(r.uploads.at(-1).version>first+5,'world rendering cannot starve source uploads');assert.ok(r.calls.length<=12,'20 position+source pairs do not each render a whole world');
 const before=r.calls.length,uploads=r.uploads.length;f.time(1000);assert.equal(f.controller.setFrame(f.source),true);assert.equal(r.uploads.length,uploads+1,'the source buffer is consumed synchronously');assert.equal(r.calls.length,before,'world drawing waits for the one shared cadence');
 f.frame(16);assert.ok(r.calls.at(-1).sourceVersion>first+5);f.controller.destroy();
});

test('explicit contact metadata and resized dimensions update the same canvas before the upload cadence',async()=>{
 const f=await fixture();try{
  let scans=0;const context=f.source.getContext();f.source.getContext=()=>{scans++;return context;};
  assert.equal(f.controller.setFrame(f.source),true);const r=f.renderers[0],sprite=r.calls.at(-1).scene.getObjectByName('current-pet-2d-frame'),texture=sprite.material.map;
  assert.equal(scans,1);const uploads=r.uploads.length;
  f.time(1);f.source.width=32;assert.equal(f.controller.setFrame(f.source,{anchor:.25}),true);
  assert.equal(sprite.center.y,.25,'the explicit foot stays on the ground even when the canvas identity is unchanged');
  assert.equal(sprite.scale.x,3.3);assert.equal(sprite.scale.y,1.65);assert.equal(r.uploads.length,uploads+1);assert.notEqual(sprite.material.map,texture);const resizedTexture=sprite.material.map;
  f.time(2);assert.equal(f.controller.setFrame(f.source,{anchor:.4}),true);assert.equal(sprite.center.y,.4);assert.equal(sprite.material.map,resizedTexture);
  f.time(40);assert.equal(f.controller.setFrame(f.source),true);assert.equal(sprite.center.y,.4);assert.equal(scans,2,'one resize refreshes picking coverage; ordinary animation frames do not rescan or cancel their bob');
 }finally{f.controller.destroy();}
});

test('invalid frame dimensions or explicit contact metadata leave the last good town frame intact',async()=>{
 const f=await fixture();try{
  assert.equal(f.controller.setFrame(f.source,{anchor:.2}),true);const r=f.renderers[0],sprite=r.calls.at(-1).scene.getObjectByName('current-pet-2d-frame'),texture=sprite.material.map,uploads=r.uploads.length;
  for(const anchor of [-.01,1.01,NaN,Infinity,'0.3',undefined]){f.time(f.now+40);assert.equal(f.controller.setFrame(f.source,{anchor}),false);assert.equal(sprite.center.y,.2);assert.equal(sprite.material.map,texture);}
  for(const width of [Infinity,NaN,-1,0]){f.source.width=width;assert.equal(f.controller.setFrame(f.source),false);}
  f.source.width=16;assert.equal(r.uploads.length,uploads);assert.deepEqual(f.failures,[]);assert.equal(f.ready,1);
  f.time(f.now+40);assert.equal(f.controller.setFrame(f.source,{anchor:0}),true);assert.equal(sprite.center.y,0);assert.equal(f.controller.setFrame(f.source,{anchor:1}),true);assert.equal(sprite.center.y,1);
 }finally{f.controller.destroy();}
});

test('reduced motion coalesces explicit changes without an ambient loop, and a source upload failure restores fallback',async()=>{
 const f=await fixture({reduced:true});f.controller.setFrame(f.source);const r=f.renderers[0],before=r.calls.length;assert.equal(f.frames.size,0);
 f.time(40);f.controller.setPosition({x:1120,y:1100});f.controller.setFrame(f.source);f.controller.setPosition({x:1140,y:1100});assert.equal(r.calls.length,before);assert.equal(f.frames.size,1);
 f.frame(16);assert.equal(r.calls.length,before+1);assert.equal(f.frames.size,0);r.failUpload=true;f.time(100);assert.equal(f.controller.setFrame(f.source),false);assert.equal(f.host.dataset.visualMode,'flat');assert.deepEqual(f.failures,['town_frame_unavailable']);assert.equal(f.frames.size,0);
});

test('even a populated economy view cannot load or duplicate NPCs while the selected pet and nature keep drawing',async()=>{
 const view={residents:[{id:'n1',name:'住人'},{id:'n2',name:'住人2'}],visitors:[{id:'v1',name:'旅人'}],coins:500,holdings:{tea:2}},before=JSON.stringify(view);
 const f=await fixture({view});f.controller.setFrame(f.source);const scene=f.renderers[0].calls.at(-1).scene;
 for(let i=0;i<80;i++){f.frame(16);f.controller.setPosition({x:1100,y:1100});f.controller.setFrame(f.source);}
 const sprites=[];scene.traverse(o=>{if(o.isSprite)sprites.push(o);});assert.equal(sprites.length,1);assert.equal(sprites[0].name,'current-pet-2d-frame');assert.equal(f.images.length,0,'no NPC image is even requested');
 assert.equal(JSON.stringify(view),before);assert.ok(scene.getObjectByName('pet-contact-shadow').visible);assert.ok(f.renderers[0].calls.length>10);f.controller.destroy();
});

test('screen tap ray resets camera collision range and finds visible distant ground',async()=>{
 const f=await fixture({position:{x:1100,y:1100}});f.controller.setFrame(f.source);
 for(const p of [{x:1100,y:1100},{x:1100,y:800},{x:1300,y:800}]){
  const screen=f.project(p);assert.ok(screen.clientX>=0&&screen.clientX<=390&&screen.clientY>=0&&screen.clientY<=700);
  const hit=f.controller.resolveTap(screen);assert.ok(hit&&!hit.placeId);assert.ok(Math.hypot(hit.x-p.x,hit.y-p.y)<.01);
 }f.controller.destroy();
});

test('only a painted pet pixel opens care while transparent sprite padding remains a normal ground hit',async()=>{
 const f=await fixture();f.controller.setFrame(f.source);const {scene,camera}=f.renderers[0].calls.at(-1),sprite=scene.getObjectByName('current-pet-2d-frame');
 function screenUV(x,y){const p=sprite.position.clone().applyMatrix4(camera.matrixWorldInverse);p.x+=(x-sprite.center.x)*sprite.scale.x;p.y+=(y-sprite.center.y)*sprite.scale.y;p.applyMatrix4(camera.projectionMatrix);return {clientX:(p.x+1)*195,clientY:(1-p.y)*350};}
 assert.equal(f.controller.resolveTap(screenUV(8.5/16,2.5/16)).pet,true,'actual opaque source pixel is selectable');
 const empty=f.controller.resolveTap(screenUV(3.5/16,3.5/16));assert.notEqual(empty?.pet,true,'transparent pixels do not capture a floor tap');f.controller.destroy();
});

test('camera segments stop before actual roofs, walls and foliage for every bounded orbit sample',async()=>{
 const world=Town.createWorld(),home=world.places[0];let restricted=0;
 for(const yaw of [0,.7,1.4,2.1,2.8,3.5,4.2,4.9,5.6]){
  const f=await fixture({world,position:home.entrance,camera:{yaw,pitch:Math.PI/6,distance:8}});f.controller.setFrame(f.source);
  const info=JSON.parse(f.host.dataset.townCamera),{camera,scene}=f.renderers[0].calls.at(-1),g=Scene.groundPoint(world,home.entrance);
  const start=new THREE.Vector3(g.x,Scene.heightAt(home.entrance)+.8,g.z),direction=camera.position.clone().sub(start).normalize(),ray=new THREE.Raycaster(start,direction,.01,8);
  const obstacles=[];scene.traverse(o=>{if(o.isMesh&&o.userData.placeId)obstacles.push(o);});const hits=ray.intersectObjects(obstacles);
  if(hits.length)assert.ok(info.distance<hits[0].distance);if(Math.abs(info.actualYaw-info.yaw)>.01||Math.abs(info.actualPitch-info.pitch)>.01||info.distance<7.99)restricted++;
  assert.ok(Number.isFinite(camera.position.x)&&Number.isFinite(camera.position.y)&&info.distance>=5.5);f.controller.destroy();
 }assert.ok(restricted>=2,'test actually samples blocked views');
});

test('the observed home-approach orbit cannot zoom the pet into a screen-filling close-up',async()=>{
 const f=await fixture({position:{x:633.6,y:511.6},camera:{yaw:2.26,pitch:.6835987756,distance:8}});f.controller.setFrame(f.source);
 const view=JSON.parse(f.host.dataset.townCamera);assert.ok(view.distance>=5.5);assert.equal(view.yaw,2.26);assert.equal(view.pitch,.6835987756);assert.ok(Math.abs(view.actualYaw-view.yaw)>.01||Math.abs(view.actualPitch-view.pitch)>.01);
 const {scene,camera}=f.renderers[0].calls.at(-1),sprite=scene.getObjectByName('current-pet-2d-frame'),up=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion);
 const top=sprite.position.clone().addScaledVector(up,(1-sprite.center.y)*sprite.scale.y).project(camera),bottom=sprite.position.clone().addScaledVector(up,-sprite.center.y*sprite.scale.y).project(camera);
 assert.ok(Math.abs(top.y-bottom.y)/2<.4,'the real Sprite shader billboard cannot fill most of the viewport height');
 const forward=f.controller.direction(0,-1);assert.ok(Math.abs(Math.hypot(forward.x,forward.y)-1)<1e-8);
 f.controller.setMotion({walking:true,dx:forward.x,dy:forward.y});const facing=f.host.dataset.townFacing;assert.equal(facing,'away');f.controller.setMotion({walking:false,dx:0,dy:0});assert.equal(f.host.dataset.townFacing,facing);
 f.controller.destroy();
});

test('camera-relative four-way directions round-trip and their last facing survives idle',async()=>{
 for(const yaw of [0,.9,2.26,-2.7]){
  const f=await fixture({camera:{yaw,pitch:.5,distance:8}});f.controller.setFrame(f.source);
  for(const [x,y,name] of [[0,-1,'away'],[0,1,'toward'],[-1,0,'left'],[1,0,'right']]){
   const d=f.controller.direction(x,y);f.controller.setMotion({walking:true,dx:d.x,dy:d.y});assert.equal(f.host.dataset.townFacing,name);
   f.controller.setMotion({walking:false,dx:0,dy:0});assert.equal(f.host.dataset.townFacing,name);
  }f.controller.destroy();
 }
});

test('camera drag changes a finite view, canceled and looped drags cannot become walk taps',async()=>{
 const f=await fixture();f.controller.setFrame(f.source);const before=f.controller.camera();
 f.host.emit('pointerdown',{pointerId:1,clientX:100,clientY:100});f.host.emit('pointermove',{pointerId:1,clientX:250,clientY:160});
 assert.notDeepEqual(f.controller.camera(),before);f.host.emit('pointermove',{pointerId:1,clientX:100,clientY:100});assert.equal(f.controller.resolveTap({clientX:195,clientY:400}),null);
 f.win.emit('pointercancel',{pointerId:1});assert.ok(f.controller.resolveTap(f.project({x:1100,y:1100})));f.controller.destroy();
});

test('reduced motion has no ambient RAF; hidden, context loss, and destroyed frames cannot resurrect a canvas',async()=>{
 const f=await fixture({reduced:true});f.controller.setFrame(f.source);assert.equal(f.frames.size,0);
 f.controller.setMotion({walking:true,dx:1,dy:0});f.controller.setPosition({x:1101,y:1100});assert.equal(f.renderers[0].calls.at(-1).scene.getObjectByName('current-pet-2d-frame').material.rotation,0);
 f.media.matches=false;f.media.emit('change');assert.equal(f.frames.size,1);f.doc.hidden=true;f.doc.emit('visibilitychange');assert.equal(f.frames.size,0);
 f.doc.hidden=false;f.doc.emit('visibilitychange');assert.equal(f.frames.size,1);const old=[...f.frames.values()];
 f.renderers[0].domElement.emit('webglcontextlost');assert.equal(f.frames.size,0);assert.equal(f.host.children.length,0);assert.deepEqual(f.failures,['town_context_lost']);
 old.forEach(fn=>fn(100));assert.equal(f.controller.setFrame(f.source),false);assert.equal(f.host.children.length,0);assert.ok(f.renderers[0].disposed&&f.renderers[0].lost);assert.equal(f.win.count()+f.doc.count()+f.host.count()+f.media.count(),0);assert.ok(f.observers[0].disconnected);
});

test('a denied host may not allocate a renderer or mount late after its owner closes',async()=>{
 const doc=new Events(),win=new Events(),host=new Element(doc);doc.defaultView=win;let allocated=0;
 const result=await Scene.mount({viewport:host,world:Town.createWorld(),canRun:()=>false,three:{...THREE,WebGLRenderer:class{constructor(){allocated++;}}}});
 assert.equal(result,null);assert.equal(allocated,0);assert.equal(host.children.length,0);
});

test('a renderer failure during ambient animation restores the flat view and cannot be revived by a late source frame',async()=>{
 const f=await fixture();f.controller.setFrame(f.source);f.renderers[0].fail=true;f.frame(100);
 assert.deepEqual(f.failures,['town_render_failed']);assert.equal(f.host.dataset.visualMode,'flat');assert.equal(f.host.children.length,0);assert.equal(f.frames.size,0);
 assert.equal(f.controller.setFrame(f.source),false);assert.equal(f.host.dataset.visualMode,'flat');
});


test('village facing packets use the rendered camera at arbitrary yaw, including a blocked requested camera', async t => {
 const cases = [
  {yaw:0,position:{x:1100,y:1100}}, {yaw:.731,position:{x:1100,y:1100}},
  {yaw:-2.413,position:{x:1100,y:1100}}, {yaw:13*Math.PI/16,pitch:22*Math.PI/180,position:{x:633.6,y:511.6}}
 ];
 let blockedYawObserved=false;
 for(const {yaw,pitch=.6835987756,position} of cases){
  const packets=[],f=await fixture({position,camera:{yaw,pitch,distance:8},onFacing:p=>packets.push(p)});
  t.after(()=>f.controller.destroy()); f.controller.setFrame(f.source); f.frame(40);
  const actual=JSON.parse(f.host.dataset.townCamera);
  if(Math.abs(actual.actualYaw-actual.yaw)>.01)blockedYawObserved=true;
  for(const [x,y,expected,label] of [[0,-1,180,'away/back'],[0,1,0,'toward/front'],[-1,0,270,'left'],[1,0,90,'right']]){
   const d=f.controller.direction(x,y);f.controller.setMotion({walking:true,dx:d.x,dy:d.y});f.frame(40);
   const p=packets.at(-1),error=((p.yawDeg-expected+540)%360)-180;
   assert.ok(Math.abs(error)<1e-8,label+' must use actual camera yaw, requested '+yaw);
   assert.equal(p.walking,true);assert.ok(Number.isFinite(p.distance));
   f.controller.setMotion({walking:false,dx:0,dy:0});f.frame(40);
   assert.ok(Math.abs(((packets.at(-1).yawDeg-expected+540)%360)-180)<1e-8,'idle retains the heading');
   assert.equal(packets.at(-1).walking,false);
  }
  f.controller.destroy();
 }
 assert.equal(blockedYawObserved,true,'fixture must actually exercise an adjusted yaw');
});

test('village gait distance counts accepted ground displacement and does not advance while idle or on rejected positions',async t=>{
 const packets=[],f=await fixture({onFacing:p=>packets.push(p)});t.after(()=>f.controller.destroy());
 f.controller.setFrame(f.source);f.controller.setMotion({walking:true,dx:1,dy:0});
 f.controller.setPosition({x:1110,y:1100});f.frame(40);
 assert.ok(Math.abs(packets.at(-1).distance-.1)<1e-10);
 f.controller.setPosition({x:1110,y:1110});f.frame(40);
 assert.ok(Math.abs(packets.at(-1).distance-.2)<1e-10);
 f.controller.setMotion({walking:false,dx:0,dy:0});f.controller.setPosition({x:1110,y:1110});
 for(const p of [null,{x:NaN,y:1100},{x:Infinity,y:1100},{x:2700,y:1600}])f.controller.setPosition(p);
 f.frame(400);const idle=packets.at(-1);assert.ok(Math.abs(idle.distance-.2)<1e-10);assert.equal(idle.walking,false);
 f.frame(400);assert.equal(packets.at(-1).distance,idle.distance);
});

test('zero and malformed village vectors cannot replace the last finite heading',async t=>{
 const packets=[],f=await fixture({onFacing:p=>packets.push(p)});t.after(()=>f.controller.destroy());f.controller.setFrame(f.source);
 const right=f.controller.direction(1,0);f.controller.setMotion({walking:true,dx:right.x,dy:right.y});f.frame(40);const held=packets.at(-1).yawDeg;
 for(const motion of [{walking:true,dx:0,dy:0},{walking:true,dx:NaN,dy:1},{walking:true,dx:Infinity,dy:Infinity},{walking:true,dx:1,dy:-Infinity},null,undefined]){
  assert.doesNotThrow(()=>f.controller.setMotion(motion));f.frame(40);
  assert.ok(Number.isFinite(packets.at(-1).yawDeg));assert.equal(packets.at(-1).yawDeg,held);
 }
});

test('facing callbacks obey reduced motion and cannot continue from hidden or destroyed world frames',async t=>{
 const packets=[],f=await fixture({reduced:true,onFacing:p=>packets.push(p)});t.after(()=>f.controller.destroy());
 f.controller.setFrame(f.source);assert.equal(f.frames.size,0);
 f.controller.setMotion({walking:true,dx:0,dy:-1});assert.equal(f.frames.size,1);f.frame(40);
 assert.equal(packets.at(-1).yawDeg,((Math.PI-JSON.parse(f.host.dataset.townCamera).actualYaw)*180/Math.PI+360)%360);
 assert.equal(f.frames.size,0,'one explicit reduced-motion facing update has no ambient loop');
 const count=packets.length;f.doc.hidden=true;f.doc.emit('visibilitychange');f.controller.setMotion({walking:true,dx:1,dy:0});f.frame(100);assert.equal(packets.length,count);
 f.doc.hidden=false;f.doc.emit('visibilitychange');const late=[...f.frames.values()];f.controller.destroy();
 late.forEach(fn=>fn(1000));f.controller.setMotion({walking:true,dx:1,dy:0});f.controller.setPosition({x:1120,y:1100});f.controller.setFrame(f.source);f.frame(100);
 assert.equal(packets.length,count);assert.equal(f.frames.size,0);assert.equal(f.host.children.length,0);
});


test('a reduced-motion facing paint at t64 replaces the t50 source in that same world draw without another RAF',async t=>{
 let f;const facingPackets=[],facingUploads=[];
 f=await fixture({reduced:true,onFacing:frame=>{
  facingPackets.push(frame);
  facingUploads.push(f.controller.setFrame(f.source));
 }});
 t.after(()=>f.controller.destroy());
 f.controller.setFrame(f.source);const renderer=f.renderers[0],initialDraws=renderer.calls.length;
 assert.equal(f.frames.size,0);assert.equal(facingPackets.length,0);
 f.time(50);const away=f.controller.direction(0,-1);f.controller.setMotion({walking:true,dx:away.x,dy:away.y});f.controller.setFrame(f.source);
 const t50Version=renderer.uploads.at(-1).version,uploads=renderer.uploads.length;
 assert.equal(renderer.calls.length,initialDraws,'the ordinary source paint at t50 still shares the world cadence');assert.equal(f.frames.size,1);
 f.frame(14);
 assert.equal(f.now,64);assert.equal(facingPackets.length,1);assert.equal(facingPackets[0].walking,true);assert.ok(Math.abs(facingPackets[0].yawDeg-180)<1e-8);assert.deepEqual(facingUploads,[true]);
 assert.equal(renderer.uploads.length,uploads+1,'a source painted 14ms after the preceding upload must not be discarded in reduced motion');
 assert.ok(renderer.uploads.at(-1).version>t50Version);
 assert.equal(renderer.calls.at(-1).sourceVersion,renderer.uploads.at(-1).version,'this world draw sees the new facing rather than the t50 texture');
 assert.equal(renderer.calls.length,initialDraws+1);assert.equal(f.frames.size,0,'a synchronous facing upload must not schedule a redundant or continuous world loop');
 f.frame(1000);assert.equal(renderer.calls.length,initialDraws+1);assert.equal(facingPackets.length,1);assert.equal(f.frames.size,0);
});

test('manual fishing shows holder geometry, idle water-facing returns to manual heading, and dedicated GPU resources release',async()=>{
 const positions=[],site=Fishing.site(),f=await fixture({position:site.position,onFacing:frame=>positions.push(frame)});
 try{
  assert.equal(f.controller.setFrame(f.source),true);f.controller.setFishing({phase:'waiting'});f.frame(50);
  const scene=f.renderers[0].calls.at(-1).scene,rod=scene.getObjectByName('fishing-rod'),holder=scene.getObjectByName('river-rod-holder');
  assert.equal(rod.visible,true);assert.equal(holder.visible,true);assert.equal(f.host.dataset.fishingPhase,'waiting');
  const waterYaw=Math.atan2(site.target.x-site.position.x,site.target.y-site.position.y),actual=JSON.parse(f.host.dataset.townCamera).actualYaw;
  assert.ok(Math.abs(positions.at(-1).yawDeg-Scene.facingFrame(waterYaw,actual,false,0).yawDeg)<1e-6);
  f.controller.setFishing(null);f.frame(50);assert.ok(Math.abs(positions.at(-1).yawDeg)<1e-6,'ordinary heading is preserved rather than overwritten by casting');
  const target=f.renderers[0].calls.at(-1).scene.getObjectByName('manual-river-fishing'),geometries=new Set(),materials=new Set();
  target.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});
  let g=0,m=0;geometries.forEach(x=>x.addEventListener('dispose',()=>g++));materials.forEach(x=>x.addEventListener('dispose',()=>m++));
  f.controller.destroy();f.controller.destroy();assert.equal(g,geometries.size);assert.equal(m,materials.size);
 }finally{f.controller.destroy();}
});

test('portrait fishing frames both visible pet and float, without altering saved user camera or player position',async()=>{
 const pos={x:2340.29,y:1545.59},f=await fixture({position:pos,camera:{yaw:.18,pitch:Math.PI/6,distance:8}});
 try{
  f.controller.setFrame(f.source);const before=f.controller.camera();f.controller.setFishing({phase:'waiting'});f.frame(50);
  const r=f.renderers[0].calls.at(-1),sprite=r.scene.getObjectByName('current-pet-2d-frame'),bobber=r.scene.getObjectByName('fishing-float');
  const a=new THREE.Vector3().setFromMatrixPosition(sprite.matrixWorld).project(r.camera),b=new THREE.Vector3().setFromMatrixPosition(bobber.matrixWorld).project(r.camera);
  assert.ok(Math.abs(a.x)<.96&&Math.abs(b.x)<.96,'both subjects stay inside the portrait viewport');assert.ok(Math.abs(b.y)<.96);
  assert.deepEqual(f.controller.camera(),before);assert.equal(JSON.parse(f.host.dataset.townCamera).activityFraming,true);
  f.controller.setFishing(null);f.frame(50);assert.equal(JSON.parse(f.host.dataset.townCamera).activityFraming,false);assert.deepEqual(f.controller.camera(),before);
 }finally{f.controller.destroy();}
});

test('intrinsic shrink/grow/aspect changes reallocate immutable GPU textures exactly once; same-size metadata and rejected frames keep allocation',async()=>{
 const f=await fixture(),textures=[],disposed=new Map();
 try{
  assert.equal(f.controller.setFrame(f.source,{anchor:.2}),true);
  const r=f.renderers[0],sprite=r.calls.at(-1).scene.getObjectByName('current-pet-2d-frame');
  function track(t){textures.push(t);disposed.set(t,0);t.addEventListener('dispose',()=>disposed.set(t,disposed.get(t)+1));}
  track(sprite.material.map);
  for(const [width,height]of [[8,8],[32,16],[64,32],[16,32],[64,64]]){
   const old=sprite.material.map;f.source.width=width;f.source.height=height;f.time(100+textures.length);
   assert.equal(f.controller.setFrame(f.source,{anchor:.2}),true);
   assert.notEqual(sprite.material.map,old);assert.equal(disposed.get(old),1);track(sprite.material.map);
   assert.equal(sprite.scale.x,1.65*width/height);assert.equal(sprite.center.y,.2);
   const current=sprite.material.map;assert.equal(f.controller.setFrame(f.source,{anchor:.3}),true);assert.equal(sprite.material.map,current);
   f.time(200+textures.length);assert.equal(f.controller.setFrame(f.source),true);assert.equal(sprite.material.map,current);
  }
  const current=sprite.material.map,count=textures.length,uploads=r.uploads.length;
  f.source.width=0;assert.equal(f.controller.setFrame(f.source,{anchor:.4}),false);assert.equal(sprite.material.map,current);
  f.source.width=64;assert.equal(f.controller.setFrame(f.source,{anchor:NaN}),false);assert.equal(sprite.material.map,current);assert.equal(r.uploads.length,uploads);
  assert.equal(textures.length,count);assert.deepEqual(f.failures,[]);
  f.controller.destroy();f.controller.destroy();for(const t of textures)assert.equal(disposed.get(t),1,'each retired/current texture is disposed once');
 }finally{f.controller.destroy();}
});

test('resized Town coverage uses the new buffer for pet-only picking and normal animation does not rescan it',async()=>{
 const f=await fixture();let scans=0;const original=f.source.getContext();f.source.getContext=()=>{scans++;return original;};
 try{
  assert.equal(f.controller.setFrame(f.source),true);assert.equal(scans,1);
  f.source.width=32;f.time(50);assert.equal(f.controller.setFrame(f.source),true);f.frame(50);assert.equal(scans,2);
  const r=f.renderers[0].calls.at(-1),sprite=r.scene.getObjectByName('current-pet-2d-frame');
  function uv(u,v){const right=new THREE.Vector3(1,0,0).applyQuaternion(r.camera.quaternion),up=new THREE.Vector3(0,1,0).applyQuaternion(r.camera.quaternion),q=sprite.position.clone().addScaledVector(right,(u-sprite.center.x)*sprite.scale.x).addScaledVector(up,(v-sprite.center.y)*sprite.scale.y).project(r.camera);return{clientX:(q.x+1)*195,clientY:(1-q.y)*350};}
  assert.equal(f.controller.resolveTap(uv(8.5/32,2.5/16)).pet,true,'new opaque cell is hittable after buffer resize');
  assert.notEqual(f.controller.resolveTap(uv(8.5/16,2.5/16))?.pet,true,'old normalized opaque cell cannot stay in stale coverage');
  f.time(150);assert.equal(f.controller.setFrame(f.source),true);assert.equal(scans,2);
  f.source.width=0;assert.equal(f.controller.setFrame(f.source),false);assert.equal(scans,2);
 }finally{f.controller.destroy();}
});

function textureDocument(){
 const canvases=[];
 return {canvases,createElement(){
  const colors=[],canvas={width:0,height:0};
  const ctx={fillStyle:'',fillRect(){colors.push(this.fillStyle);},createRadialGradient(){return{addColorStop(){}};},beginPath(){},ellipse(){},fill(){},fillText(){}};
  canvas.getContext=()=>ctx;canvas.colors=colors;canvases.push(canvas);return canvas;
 }};
}
test('four seasons share exact facility, surface and collision geometry while changing only tagged outdoor finishes',()=>{
 const world=Town.createWorld(),before=JSON.stringify(world),doc=textureDocument(),m=Scene.buildWorld(THREE,world,{},null,doc,'spring');
 const matrices=m.occluders.map(o=>Array.from(o.matrixWorld.elements)),geos=[...m.geometries],materials=[...m.materials];
 const placeColors=materials.filter(x=>['wood','ceramic','plaster','water'].includes(x.userData.surfaceRole)).map(x=>x.color.getHex());
 const land=m.scene.getObjectByName('dry-land'),surfaceIds=m.surfaces.map(x=>x.uuid),textureHistory=[],disposed=[];
 for(const key of ['spring','summer','autumn','winter','spring']){
  const old=land.material.map;if(old&&!textureHistory.includes(old)){textureHistory.push(old);old.addEventListener('dispose',()=>disposed.push(old));}
  assert.equal(m.setSeason(key),true);assert.equal(m.scene.userData.season,key);assert.equal(m.scene.fog,null);
  assert.equal(land.material.map.image.colors[0],Seasons.profile(key).ground,'ground canvas is generated in the intended hue, not a white tint over green');
  assert.deepEqual(m.surfaces.map(x=>x.uuid),surfaceIds);assert.deepEqual(m.occluders.map(o=>Array.from(o.matrixWorld.elements)),matrices);
  assert.deepEqual([...m.geometries],geos);assert.deepEqual([...m.materials],materials);
  assert.deepEqual(materials.filter(x=>['wood','ceramic','plaster','water'].includes(x.userData.surfaceRole)).map(x=>x.color.getHex()),placeColors);
  assert.deepEqual(Object.entries(m.seasonGroups).filter(([,g])=>g.visible).map(([k])=>k),[key]);
  const count=doc.canvases.length,tex=land.material.map;assert.equal(m.setSeason(key),true);assert.equal(doc.canvases.length,count);assert.equal(land.material.map,tex);
 }
 assert.equal(m.setSeason('rainy'),false);assert.equal(JSON.stringify(world),before);assert.ok(m.seasonGroups.spring.children.length>0);assert.ok(m.seasonGroups.spring.children.filter(o=>o.visible&&o.isMesh).length<=3,'spring accents have a three-draw-call budget rather than 48 individual meshes');assert.ok(m.seasonGroups.winter.children.every(o=>o.isMesh&&o.geometry.attributes.position));
 assert.equal(m.seasonGroups.summer.children.length,0,'existing summer flowers are retained without extra weather particles');
 for(const key of ['spring','autumn','winter'])assert.ok(new THREE.Box3().setFromObject(m.seasonGroups[key]).min.y>=.0249,key+' decorative stem/leaf/snow base meets the .025 floor instead of floating or sinking');
 const current=land.material.map;current.addEventListener('dispose',()=>disposed.push(current));m.dispose();m.dispose();assert.equal(new Set(disposed).size,disposed.length);assert.ok(textureHistory.every(t=>disposed.includes(t)));assert.ok(disposed.includes(current));
});
test('same-scene JST changes preserve the selected frame, player position, camera, fishing and reduced-motion cadence without daily texture churn',async()=>{
 let now=Date.parse('2026-05-31T14:59:59.999Z'),notify,unsubscribed=0;
 const f=await fixture({reduced:true,seasonNow:()=>now,seasonSubscribe:fn=>{notify=fn;return()=>{unsubscribed++;};}});
 try{
  f.controller.setFrame(f.source);f.controller.setFishing({phase:'waiting'});f.frame(40);
  const r=f.renderers[0],oldScene=r.calls.at(-1).scene,pet=oldScene.getObjectByName('current-pet-2d-frame'),map=pet.material.map,position=pet.position.clone(),camera=f.controller.camera(),calls=r.calls.length;
  assert.equal(f.host.dataset.townSeason,'spring');assert.equal(f.host.dataset.townSeasonDate,'2026-05-31');assert.equal(f.timers.size,1);
  now=Date.parse('2026-05-31T15:00:00Z');notify();assert.equal(f.host.dataset.townSeason,'summer');assert.equal(f.host.dataset.townSeasonDate,'2026-06-01');f.frame(40);
  assert.equal(r.calls.at(-1).scene,oldScene);assert.equal(pet.material.map,map);assert.deepEqual(pet.position,position);assert.deepEqual(f.controller.camera(),camera);assert.equal(f.host.dataset.fishingPhase,'waiting');assert.equal(r.calls.length,calls+1);assert.equal(f.frames.size,0);
  now+=86400000;const after=r.calls.length;notify();assert.equal(f.host.dataset.townSeasonDate,'2026-06-02');assert.equal(f.frames.size,0);assert.equal(r.calls.length,after,'a new day in one season does not redraw or allocate decorative geometry');
  f.doc.hidden=true;now=Date.parse('2026-11-30T15:00:00Z');notify();assert.equal(f.host.dataset.townSeason,'summer');f.doc.hidden=false;f.doc.emit('visibilitychange');assert.equal(f.host.dataset.townSeason,'winter');f.frame(40);
  now=NaN;notify();assert.equal(f.host.dataset.townSeason,'winter');assert.equal(f.failures.length,0);
 }finally{f.controller.destroy();}const last=f.timers.size;notify();assert.equal(last,0);assert.equal(f.timers.size,0);assert.equal(unsubscribed,1);
});

test('a synchronous initial season presentation failure clears its just-created watcher and every borrowed scene resource',async()=>{
 const f=await fixture({configureHost:host=>Object.defineProperty(host.dataset,'townSeason',{set(){throw Error('synthetic failed presentation target');},configurable:true})});
 assert.equal(f.controller,null);assert.deepEqual(f.failures,['town_season_unavailable']);assert.equal(f.timers.size,0);assert.equal(f.frames.size,0);assert.equal(f.host.children.length,0);
 assert.equal(f.renderers[0].disposed,true);assert.equal(f.win.count(),0);assert.equal(f.doc.count(),0);
});

test('public geometry builder still works before the newly lazy calendar module is registered',()=>{
 const context=vm.createContext({PetTownWalk:Town});
 vm.runInContext(readFileSync(new URL('../static/pet-town-scene.js',import.meta.url),'utf8'),context);
 assert.equal(context.PetJapanSeasons,undefined);
 const doc=textureDocument(),model=context.PetTownScene.buildWorld(THREE,Town.createWorld(),{},null,doc);
 try{
  const land=model.scene.getObjectByName('dry-land');assert.equal(land.material.map.image.colors[0],'#b1cf83');
  assert.equal(model.scene.background.getHexString(),'cbe7e8');assert.equal(model.setSeason('winter'),false);
  context.PetJapanSeasons=Seasons;assert.equal(model.setSeason('winter'),true);assert.equal(land.material.map.image.colors[0],Seasons.profile('winter').ground);
 }finally{model.dispose();}
});

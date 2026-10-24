import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Scene from '../static/pet-town-scene.js';
import Town from '../static/pet-town-walk.js';

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
 const doc=new Events(),win=new Events(),host=new Element(doc),media=new Events(),frames=new Map(),renderers=[],images=[],observers=[];
 let stamp=0,seq=0,allowed=true,ready=0;const failures=[];
 doc.defaultView=win;doc.hidden=false;media.matches=!!options.reduced;
 Object.assign(win,{devicePixelRatio:3,performance:{now:()=>stamp},matchMedia:()=>media,requestAnimationFrame:fn=>{frames.set(++seq,fn);return seq;},cancelAnimationFrame:id=>frames.delete(id),Image:class{constructor(){images.push(this);this.width=this.height=this.naturalWidth=this.naturalHeight=1254;this.tagName='IMG';this.complete=true;}removeAttribute(){this.src='';}}});
 win.ResizeObserver=class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
 class Renderer{
  constructor(){this.domElement=new Element(doc,'CANVAS');this.shadowMap={};this.renderLists={dispose:()=>{this.listsDisposed=true;}};this.calls=[];this.uploads=[];renderers.push(this);}
  setPixelRatio(v){this.ratio=v;}
  setSize(w,h){this.domElement.width=w;this.domElement.height=h;}
  initTexture(texture){if(this.failUpload)throw Error('synthetic GPU upload failure');this.uploads.push({version:texture.version,source:texture.image});}
  render(scene,camera){if(this.fail)throw Error('synthetic GPU render failure');if(scene.matrixWorldAutoUpdate)scene.updateMatrixWorld();camera.updateMatrixWorld(true);this.calls.push({camera,scene,sourceVersion:scene.getObjectByName('current-pet-2d-frame')?.material.map?.version});}
  dispose(){this.disposed=true;}
  forceContextLoss(){this.lost=true;}
 }
 const world=options.world||Town.createWorld(),controller=await Scene.mount({viewport:host,world,position:options.position||{x:1100,y:1100},camera:options.camera,view:options.view,canRun:()=>allowed,three:{...THREE,WebGLRenderer:Renderer},onReady:()=>ready++,onFailure:c=>failures.push(c)});
 const source=new Element(doc,'CANVAS');source.getContext=()=>({RGBA:1,UNSIGNED_BYTE:2,readPixels(x,y,w,h,format,type,pixels){pixels[(2*w+8)*4+3]=255;}});
 return {doc,win,host,media,frames,renderers,images,observers,world,source,controller,failures,get ready(){return ready;},get now(){return stamp;},allow:v=>{allowed=v;},time:v=>{stamp=v;},frame(ms=16){stamp+=ms;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(stamp));},project(p){const camera=renderers[0].calls.at(-1).camera,g=Scene.groundPoint(world,p),v=new THREE.Vector3(g.x,Scene.heightAt(p),g.z).project(camera);return {clientX:(v.x+1)*195,clientY:(1-v.y)*350};}};
}

test('world coordinates round-trip and camera settings are bounded without touching the input',()=>{
 const world=Town.createWorld();for(const p of [{x:28,y:28},{x:1500,y:1100},{x:2770,y:1160}]){const back=Scene.townPoint(world,Scene.groundPoint(world,p));assert.ok(Math.hypot(p.x-back.x,p.y-back.y)<1e-9);}
 const raw={yaw:8,pitch:-Infinity,distance:100},before=JSON.stringify(raw),c=Scene.cameraState(raw);assert.equal(JSON.stringify(raw),before);assert.equal(c.distance,10);assert.equal(c.pitch,Math.PI/6);assert.ok(c.yaw>=-Math.PI&&c.yaw<=Math.PI);
 for(const y of [-100,100])assert.ok(Scene.cameraState({pitch:y}).pitch>=22*Math.PI/180&&Scene.cameraState({pitch:y}).pitch<=56*Math.PI/180);
 const d=Scene.cameraDirection(0,-1,Math.PI/2);assert.ok(Math.abs(d.x+1)<1e-8&&Math.abs(d.y)<1e-8);
 assert.equal(Scene.cameraDistance(8,null),8);assert.ok(Scene.cameraDistance(8,.02)<.02);assert.equal(Scene.cameraDistance(8,4),3.88);
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

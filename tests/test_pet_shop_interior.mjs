import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import FrameFit from '../static/pet-frame-fit.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import Interior from '../static/pet-shop-interior.js';
import Layout from '../static/pet-shop-layout.js';

class Events {
 constructor(){this.events=new Map();}
 addEventListener(k,f){if(!this.events.has(k))this.events.set(k,new Set());this.events.get(k).add(f);}
 removeEventListener(k,f){this.events.get(k)?.delete(f);}
 emit(k,more={}){const e={target:this,button:0,isPrimary:true,cancelable:true,preventDefault(){},...more};for(const f of [...this.events.get(k)||[]])f(e);return e;}
 count(){return [...this.events.values()].reduce((n,s)=>n+s.size,0);}
}
class Element extends Events {
 constructor(doc,tag='DIV'){super();Object.assign(this,{ownerDocument:doc,tagName:tag.toUpperCase(),children:[],dataset:{},style:{},attrs:{},isConnected:true,width:16,height:16});}
 appendChild(c){c.parentNode=this;this.children.push(c);return c;}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(c=>c!==this);this.isConnected=false;}
 setAttribute(k,v){this.attrs[k]=v;}
 getBoundingClientRect(){return {left:0,top:0,width:this.ownerDocument.viewport?.width||600,height:this.ownerDocument.viewport?.height||600};}
 focus(){} contains(el){return el===this||this.children.some(c=>c.contains?.(el));}
 setPointerCapture(id){this.capture=id;}hasPointerCapture(id){return this.capture===id;}releasePointerCapture(id){if(this.capture===id)this.capture=null;}
}
async function fixture(opts={}){
 const doc=new Events(),win=new Events(),media=new Events(),host=new Element(doc),scope=new Element(doc,'SECTION'),frames=new Map(),renderers=[],observers=[],packets=[],drafts=[],failures=[],manual=[];let stamp=0,seq=0,allowed=true,walkAllowed=opts.walkAllowed!==false,ready=0,exits=0;scope.appendChild(host);
 Object.assign(doc,{defaultView:win,hidden:false,viewport:opts.viewport,createElement:tag=>new Element(doc,tag)});media.matches=!!opts.reduced;
 Object.assign(win,{devicePixelRatio:3,performance:{now:()=>stamp},matchMedia:()=>media,requestAnimationFrame:f=>{frames.set(++seq,f);return seq;},cancelAnimationFrame:id=>frames.delete(id)});
 win.ResizeObserver=class{constructor(f){this.fn=f;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
 class Renderer {
  constructor(){this.domElement=new Element(doc,'CANVAS');this.shadowMap={};this.calls=[];this.uploads=[];this.renderLists={dispose:()=>{this.listsDisposed=true;}};renderers.push(this);}
  setPixelRatio(n){this.ratio=n;}setSize(w,h){this.domElement.width=w;this.domElement.height=h;}
  initTexture(t){if(this.failUpload)throw Error('synthetic failure');this.allocations=this.allocations||new WeakMap();const size=[t.image.naturalWidth||t.image.width,t.image.naturalHeight||t.image.height],allocated=this.allocations.get(t);if(allocated&&(allocated[0]!==size[0]||allocated[1]!==size[1]))throw Error('synthetic immutable GPU texture dimensions changed');this.allocations.set(t,size);this.uploads.push(t.version);}
  render(scene,camera){if(this.fail)throw Error('synthetic failure');scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);this.calls.push({scene,camera,sourceVersion:scene.getObjectByName('canonical-shop-pet-frame')?.material.map?.version});}
  dispose(){this.disposed=true;}forceContextLoss(){this.lost=true;}
 }
 let controller;
 controller=await (opts.interiorAPI||Interior).mount({host,roomId:opts.roomId||'shop',layout:opts.layout,camera:opts.camera,position:opts.position,editing:opts.editing,canRun:()=>allowed,canWalk:()=>walkAllowed,keyboardScope:opts.keyboardScope?scope:undefined,onManualInput:intent=>{manual.push(intent);if(opts.resumeOnManual)walkAllowed=true;opts.onManualInput?.(intent);},three:{...THREE,WebGLRenderer:Renderer},onReady(){ready++;},onFailure:c=>failures.push(c),onPosition:opts.onPosition,onExit(){exits++;},onDraft:d=>drafts.push(d),onFacing:p=>{packets.push(p);if(opts.coupled&&controller)controller.setFrame(source);}});
 const source=new Element(doc,'CANVAS');source.getContext=()=>({RGBA:1,UNSIGNED_BYTE:2,readPixels(x,y,w,h,format,type,p){p[(2*w+8)*4+3]=255;}});
 const stage=host.children[0]?.children[0];
 return {doc,win,media,host,scope,stage,source,controller,frames,renderers,observers,packets,drafts,failures,manual,get ready(){return ready;},get exits(){return exits;},allow:v=>allowed=v,walkAllow:v=>walkAllowed=v,time:v=>stamp=v,
  frame(ms=40){stamp+=ms;const f=[...frames.values()];frames.clear();f.forEach(fn=>fn(stamp));},
  project(x,z,y=.04){const c=renderers[0].calls.at(-1).camera,v=new THREE.Vector3(x,y,z).project(c);return {clientX:(v.x+1)*300,clientY:(1-v.y)*300};},
  key(k,down=true,target=stage){win.emit(down?'keydown':'keyup',{key:k,target});}
 };
}

test('browser shop registration tolerates a later shared frame helper without making it a game boot dependency',async()=>{
 const context=vm.createContext({});vm.runInContext(readFileSync(new URL('../static/pet-shop-layout.js',import.meta.url),'utf8'),context);vm.runInContext(readFileSync(new URL('../static/pet-shop-interior.js',import.meta.url),'utf8'),context);
 assert.equal(context.PetFrameFit,undefined);assert.equal(typeof context.PetShopInterior.mount,'function');context.PetFrameFit=FrameFit;
 const f=await fixture({interiorAPI:context.PetShopInterior});try{assert.ok(f.controller);assert.equal(f.controller.setFrame(f.source,{anchor:.3}),true);assert.equal(f.renderers[0].calls.at(-1).scene.getObjectByName('canonical-shop-pet-frame').center.y,.3);assert.deepEqual(f.failures,[]);}finally{f.controller?.destroy();}
});

test('furniture uses actual bounded geometry and stable shared GPU resources without mutating layouts',()=>{
 for(const room of ['shop','cafe']){
  const layout=Layout.defaultLayout(room),before=JSON.stringify(layout),m=Interior.buildWorld(THREE,layout,Layout);m.scene.updateMatrixWorld(true);
  assert.equal(m.fixtures.size,9);assert.equal(JSON.stringify(layout),before);assert.equal(m.scene.fog,null);assert.ok([...m.materials].every(x=>!x.map));
  for(const item of layout.items){const bounds=new THREE.Box3().setFromObject(m.fixtures.get(item.id)),fp=Layout.footprint(item);assert.ok(Math.abs(bounds.min.x-fp.minX)<1e-5);assert.ok(Math.abs(bounds.max.x-fp.maxX)<1e-5);assert.ok(Math.abs(bounds.min.z-fp.minZ)<1e-5);assert.ok(Math.abs(bounds.max.z-fp.maxZ)<1e-5);assert.ok(Math.abs(bounds.min.y-.04)<1e-5);}
  const count=m.geometries.size;let released=0;m.fixtures.forEach(g=>g.traverse(o=>{if(o.isInstancedMesh)o.addEventListener('dispose',()=>released++);}));m.draw(layout);assert.ok(released>0);for(let i=0;i<20;i++)m.draw(layout);assert.equal(m.geometries.size,count,'editing does not allocate another geometry per drag');
  let disposed=0;for(const g of m.geometries)g.addEventListener('dispose',()=>disposed++);m.dispose();m.dispose();assert.equal(disposed,count);
 }
});
test('paths delegate to the shared collision model and every accepted waypoint remains walkable',()=>{
 const layout=Layout.defaultLayout('shop'),start={x:0,z:2.6},goal={x:-2,z:1.5},p=Interior.route(Layout,layout,start,goal,'shop');assert.ok(p.length);assert.ok(p.every(q=>Interior.walkable(Layout,layout,q.x,q.z,'shop')));
 const block=layout.items.find(x=>x.id==='counter');assert.deepEqual(Interior.route(Layout,layout,start,block,'shop'),[]);assert.equal(Interior.walkable(Layout,layout,NaN,0,'shop'),false);
});
test('normal phone camera keeps the player legible and follows locally without fitting the whole room',async()=>{
 for(const viewport of [{width:390,height:490},{width:320,height:640}]){
  const f=await fixture({viewport,camera:{yaw:0}});f.controller.setFrame(f.source);const r=f.renderers[0],c=r.calls.at(-1).camera,sprite=r.calls.at(-1).scene.getObjectByName('canonical-shop-pet-frame'),up=new THREE.Vector3(0,1,0).applyQuaternion(c.quaternion);
  const top=sprite.position.clone().addScaledVector(up,(1-sprite.center.y)*sprite.scale.y).project(c),bottom=sprite.position.clone().addScaledVector(up,-sprite.center.y*sprite.scale.y).project(c),height=Math.abs(top.y-bottom.y)/2;
  assert.ok(height>.15&&height<.3,'player occupies a readable bounded share of the phone view');assert.ok(Math.abs(top.x)<.9&&Math.abs(bottom.x)<.9&&Math.abs(top.y)<.95&&Math.abs(bottom.y)<.95);
  const before=c.position.clone(),p0=f.controller.position();f.key('w');for(let i=0;i<12;i++)f.frame();f.key('w',false);f.frame();const p1=f.controller.position();assert.ok(Math.abs((c.position.z-before.z)-(p1.z-p0.z))<1e-8,'camera follows accepted local travel');
  const actual=JSON.parse(f.stage.dataset.camera);assert.ok(actual.renderDistance<=11.5,'phone view does not pull back to fit the entire10x8 floor');assert.equal(r.toneMappingExposure,1);const hemi=r.calls.at(-1).scene.children.find(o=>o.isHemisphereLight);assert.equal(hemi.intensity,1.15);f.controller.destroy();
 }
});
test('top editor camera has stable grid orientation and keeps every room edge selectable across viewports',async()=>{
 for(const viewport of [{width:600,height:600},{width:390,height:680},{width:900,height:420}]){
  const f=await fixture({editing:true,viewport}),c=f.renderers[0].calls.at(-1).camera;
  for(const x of [-5,5])for(const z of [-4,4]){const p=new THREE.Vector3(x,.04,z).project(c);assert.ok(Math.abs(p.x)<.96&&Math.abs(p.y)<.96,'whole editing floor remains in view');}
  const origin=new THREE.Vector3(0,0,0).project(c),right=new THREE.Vector3(1,0,0).project(c),back=new THREE.Vector3(0,0,-1).project(c);assert.ok(right.x>origin.x&&Math.abs(right.y-origin.y)<1e-9);assert.ok(back.y>origin.y&&Math.abs(back.x-origin.x)<1e-9);f.controller.destroy();
 }
});
test('a real canonical frame alone activates a single depth-tested player and soft contact shadow',async()=>{
 const f=await fixture(),r=f.renderers[0];assert.equal(f.ready,0);assert.equal(f.frames.size,0);const empty=new Element(f.doc,'CANVAS');empty.getContext=()=>({RGBA:1,UNSIGNED_BYTE:2,readPixels(){}});assert.equal(f.controller.setFrame(empty),false);
 assert.equal(f.controller.setFrame(f.source),true);assert.equal(f.ready,1);assert.equal(r.ratio,1.5);assert.equal(r.calls.at(-1).sourceVersion,2);assert.equal(f.frames.size,0);
 const scene=r.calls.at(-1).scene,sprites=[];scene.traverse(o=>{if(o.isSprite)sprites.push(o);});assert.equal(sprites.length,1);assert.equal(sprites[0].center.y,2/16);assert.equal(sprites[0].material.depthTest,true);assert.equal(sprites[0].material.depthWrite,true);assert.ok(scene.getObjectByName('shop-pet-contact-shadow').material.map);
 f.controller.destroy();assert.equal(f.host.children.length,0);assert.equal(f.win.count()+f.doc.count()+f.stage.count()+f.media.count(),0);assert.ok(r.disposed&&r.lost&&f.observers[0].disconnected);
});

test('shop contact metadata and resized dimensions follow the same canonical canvas without per-frame scans',async()=>{
 const f=await fixture();try{
  let scans=0;const context=f.source.getContext();f.source.getContext=()=>{scans++;return context;};
  assert.equal(f.controller.setFrame(f.source),true);const r=f.renderers[0],sprite=r.calls.at(-1).scene.getObjectByName('canonical-shop-pet-frame'),texture=sprite.material.map,uploads=r.uploads.length;
  f.time(1);f.source.width=32;assert.equal(f.controller.setFrame(f.source,{anchor:.25}),true);assert.equal(sprite.center.y,.25);assert.equal(sprite.scale.x,3.3);assert.equal(sprite.scale.y,1.65);assert.equal(r.uploads.length,uploads+1);assert.notEqual(sprite.material.map,texture);const resizedTexture=sprite.material.map;
  f.time(2);assert.equal(f.controller.setFrame(f.source,{anchor:.4}),true);assert.equal(sprite.center.y,.4);assert.equal(sprite.material.map,resizedTexture);
  f.time(40);assert.equal(f.controller.setFrame(f.source),true);assert.equal(sprite.center.y,.4);assert.equal(scans,1,'a normal animated frame retains the original ground reference');
 }finally{f.controller.destroy();}
});

test('bad shop dimensions or explicit anchor reject only that frame and preserve the last good texture',async()=>{
 const f=await fixture();try{
  assert.equal(f.controller.setFrame(f.source,{anchor:.2}),true);const r=f.renderers[0],sprite=r.calls.at(-1).scene.getObjectByName('canonical-shop-pet-frame'),texture=sprite.material.map,uploads=r.uploads.length;
  for(const anchor of [-.01,1.01,NaN,Infinity,'0.3',undefined]){f.time(40);assert.equal(f.controller.setFrame(f.source,{anchor}),false);assert.equal(sprite.center.y,.2);assert.equal(sprite.material.map,texture);}
  for(const width of [Infinity,NaN,-1,0]){f.source.width=width;assert.equal(f.controller.setFrame(f.source),false);}
  f.source.width=16;assert.equal(r.uploads.length,uploads);assert.deepEqual(f.failures,[]);assert.equal(f.ready,1);
  f.time(80);assert.equal(f.controller.setFrame(f.source,{anchor:0}),true);assert.equal(sprite.center.y,0);assert.equal(f.controller.setFrame(f.source,{anchor:1}),true);assert.equal(sprite.center.y,1);
 }finally{f.controller.destroy();}
});
test('keyboard locomotion counts accepted distance, collides with the counter, and releases keys after focus moves',async()=>{
 const f=await fixture({camera:{yaw:0}});f.controller.setFrame(f.source);f.key('w');for(let i=0;i<100;i++)f.frame();const pos=f.controller.position();assert.ok(pos.z<1);assert.ok(pos.z>-2.2,'counter blocks walking through it');assert.ok(f.packets.some(p=>p.walking&&p.yawDeg===180));
 const t=f.packets.at(-1).distance;for(let i=0;i<10;i++)f.frame();assert.equal(f.packets.at(-1).distance,t,'blocked movement cannot advance gait');assert.equal(f.packets.at(-1).walking,false);
 f.key('w',false,new Element(f.doc,'BUTTON'));f.frame();assert.equal(f.frames.size,0);f.controller.destroy();
});
test('a floor tap walks a routed path and pushing through the front doorway exits once',async()=>{
 const f=await fixture({camera:{yaw:0}});f.controller.setFrame(f.source);const p=f.project(0,1);f.stage.emit('pointerdown',{pointerId:1,...p});f.win.emit('pointerup',{pointerId:1,...p});for(let i=0;i<40;i++)f.frame();assert.ok(Math.abs(f.controller.position().z-1)<.07);assert.equal(f.exits,0);
 f.key('s');for(let i=0;i<60;i++)f.frame();assert.equal(f.exits,1);for(let i=0;i<20;i++)f.frame();assert.equal(f.exits,1);f.controller.destroy();
});
test('layout editing stays transient and bounded: cancel, rotate, remove, undo, add and detached drafts',async()=>{
 const f=await fixture({editing:true}),initial=f.controller.getLayout();assert.equal(f.ready,1);assert.equal(f.controller.select('plant'),true);assert.equal(f.controller.rotateSelected(),true);assert.equal(f.drafts.length,1);assert.equal(f.controller.undo(),true);assert.deepEqual(f.controller.getLayout(),initial);
 assert.equal(f.controller.select('plant'),true);assert.equal(f.controller.removeSelected(),true);assert.equal(f.controller.getLayout().items.length,8);assert.equal(f.controller.add('plant'),true);assert.equal(f.controller.getLayout().items.length,9);f.drafts.at(-1).items.length=0;assert.equal(f.controller.getLayout().items.length,9);
 f.frame();const beforeDrag=f.controller.getLayout(),from=f.project(-4,2.5,.7);f.stage.emit('pointerdown',{pointerId:2,...from});assert.equal(f.controller.getSelection(),'plant');const to=f.project(-3.5,2.5,.7);f.stage.emit('pointermove',{pointerId:2,...to});f.win.emit('pointercancel',{pointerId:2});assert.deepEqual(f.controller.getLayout(),beforeDrag);assert.equal(f.stage.capture,null);
 f.key('s');for(let i=0;i<10;i++)f.frame();assert.deepEqual(f.controller.position(),{x:0,z:2.6});f.controller.destroy();
});
test('coupled reduced-motion frames consume every buffer synchronously without a self-sustaining draw loop',async()=>{
 const f=await fixture({reduced:true,coupled:true});f.controller.setFrame(f.source);const r=f.renderers[0],first=r.uploads.length;assert.equal(f.frames.size,0);f.controller.setFrame(f.source);assert.equal(r.uploads.length,first+1);assert.equal(f.frames.size,1);f.frame();assert.equal(f.frames.size,0);assert.equal(f.ready,1);
 f.doc.hidden=true;f.doc.emit('visibilitychange');assert.equal(f.controller.setFrame(f.source),false);f.doc.hidden=false;f.doc.emit('visibilitychange');const late=[...f.frames.values()];f.controller.destroy();late.forEach(fn=>fn(1000));assert.equal(f.controller.setFrame(f.source),false);assert.equal(f.frames.size,0);
});
test('context loss or upload failure cleans all resources and cannot revive a destroyed room',async()=>{
 const f=await fixture();f.controller.setFrame(f.source);f.renderers[0].domElement.emit('webglcontextlost');assert.deepEqual(f.failures,['shop_context_lost']);assert.equal(f.host.children.length,0);assert.equal(f.controller.setFrame(f.source),false);
 const g=await fixture();g.renderers[0].failUpload=true;assert.equal(g.controller.setFrame(g.source),false);assert.deepEqual(g.failures,['shop_frame_unavailable']);assert.equal(g.host.children.length,0);
});

test('the first manual key works from a neutral entry heading in the owning section without automatic wandering',async()=>{
 const f=await fixture({keyboardScope:true,camera:{yaw:0}}),heading=new Element(f.doc,'H3');f.scope.appendChild(heading);f.controller.setFrame(f.source);const initial=f.controller.position();
 for(let i=0;i<25;i++)f.frame();assert.deepEqual(f.controller.position(),initial);assert.deepEqual(f.manual,[]);
 f.key('w',true,heading);for(let i=0;i<8;i++)f.frame();f.key('w',false,heading);f.frame();const moved=f.controller.position();assert.ok(moved.z<initial.z);assert.deepEqual(f.manual,[{kind:'keyboard',key:'w'}]);
 for(let i=0;i<25;i++)f.frame();assert.deepEqual(f.controller.position(),moved);assert.equal(f.frames.size,0);f.controller.destroy();
});

test('neutral keyboard scope never steals movement keys from forms, interactive ancestors or outside content',async()=>{
 const f=await fixture({keyboardScope:true,camera:{yaw:0}});f.controller.setFrame(f.source);const initial=f.controller.position();
 const targets=[];for(const tag of ['INPUT','TEXTAREA','SELECT','BUTTON','FORM','A','SUMMARY']){const parent=new Element(f.doc,tag),child=new Element(f.doc,'SPAN');parent.appendChild(child);f.scope.appendChild(parent);targets.push(parent,child);}
 const editable=new Element(f.doc);editable.isContentEditable=true;const child=new Element(f.doc,'SPAN');editable.appendChild(child);f.scope.appendChild(editable);targets.push(editable,child,new Element(f.doc,'H3'));
 for(const target of targets){f.key('w',true,target);for(let i=0;i<3;i++)f.frame();f.key('w',false,target);assert.deepEqual(f.controller.position(),initial);}
 assert.deepEqual(f.manual,[]);f.controller.destroy();
 const noScope=await fixture({camera:{yaw:0}}),heading=new Element(noScope.doc,'H3');noScope.scope.appendChild(heading);noScope.controller.setFrame(noScope.source);noScope.key('w',true,heading);for(let i=0;i<5;i++)noScope.frame();assert.deepEqual(noScope.controller.position(),{x:0,z:2.6});assert.deepEqual(noScope.manual,[]);noScope.controller.destroy();
});

test('pre-ready keys and stale repeats cannot begin travel or invoke the manual interruption callback',async()=>{
 const f=await fixture({keyboardScope:true,camera:{yaw:0}}),heading=new Element(f.doc,'H3');f.scope.appendChild(heading);const initial=f.controller.position();f.key('w',true,heading);assert.deepEqual(f.manual,[]);
 f.controller.setFrame(f.source);f.win.emit('keydown',{key:'w',target:heading,repeat:true});for(let i=0;i<12;i++)f.frame();assert.deepEqual(f.controller.position(),initial);assert.deepEqual(f.manual,[]);
 f.key('w',false,heading);f.key('w',true,heading);for(let i=0;i<6;i++)f.frame();assert.ok(f.controller.position().z<initial.z);assert.equal(f.manual.length,1);f.controller.destroy();
});

test('fresh manual intent can dismiss a transient walk gate before input is checked while source frames remain live',async()=>{
 const f=await fixture({keyboardScope:true,camera:{yaw:0},walkAllowed:false,resumeOnManual:true}),heading=new Element(f.doc,'H3');f.scope.appendChild(heading);assert.equal(f.controller.setFrame(f.source),true);const initial=f.controller.position();
 f.key('w',true,heading);for(let i=0;i<6;i++)f.frame();assert.ok(f.controller.position().z<initial.z);assert.deepEqual(f.manual,[{kind:'keyboard',key:'w'}]);f.key('w',false,heading);
 f.walkAllow(false);const position=f.controller.position(),camera=f.controller.camera(),p=f.project(0,1);f.stage.emit('pointerdown',{pointerId:3,...p});f.win.emit('pointerup',{pointerId:3,...p});for(let i=0;i<30;i++)f.frame();assert.ok(f.controller.position().z<position.z);assert.deepEqual(f.manual.at(-1),{kind:'pointer',pointerId:3});assert.deepEqual(f.controller.camera(),camera);f.controller.destroy();
});

test('denied manual input clears held travel and routes without reviving them when the gate reopens',async()=>{
 const f=await fixture({keyboardScope:true,camera:{yaw:0},walkAllowed:false});f.controller.setFrame(f.source);const start=f.controller.position();f.key('w');for(let i=0;i<5;i++)f.frame();assert.deepEqual(f.controller.position(),start);assert.equal(f.manual.length,1);
 f.walkAllow(true);f.win.emit('keydown',{key:'w',target:f.stage,repeat:true});for(let i=0;i<6;i++)f.frame();assert.deepEqual(f.controller.position(),start);assert.equal(f.manual.length,1);
 f.key('w');for(let i=0;i<6;i++)f.frame();f.walkAllow(false);f.frame();const paused=f.controller.position();assert.equal(f.controller.setFrame(f.source),true,'walk denial does not disable the canonical frame bridge');f.walkAllow(true);f.win.emit('keydown',{key:'w',target:f.stage,repeat:true});for(let i=0;i<15;i++)f.frame();assert.deepEqual(f.controller.position(),paused);assert.equal(f.packets.at(-1).walking,false);
 const p=f.project(0,.4);f.stage.emit('pointerdown',{pointerId:4,...p});f.win.emit('pointerup',{pointerId:4,...p});for(let i=0;i<5;i++)f.frame();assert.ok(f.controller.position().z<paused.z);f.walkAllow(false);f.frame();const stopped=f.controller.position();f.walkAllow(true);f.win.emit('focus');for(let i=0;i<20;i++)f.frame();assert.deepEqual(f.controller.position(),stopped);assert.equal(f.frames.size,0);f.controller.destroy();
});

test('a pointer release after a walk gate closes cannot queue a later route or change the camera',async()=>{
 const f=await fixture({camera:{yaw:0}});f.controller.setFrame(f.source);const initial=f.controller.position(),camera=f.controller.camera(),p=f.project(0,.5);f.stage.emit('pointerdown',{pointerId:8,...p});assert.equal(f.stage.capture,8);f.walkAllow(false);f.win.emit('pointerup',{pointerId:8,...p});assert.equal(f.stage.capture,null);f.walkAllow(true);f.win.emit('focus');for(let i=0;i<30;i++)f.frame();assert.deepEqual(f.controller.position(),initial);assert.deepEqual(f.controller.camera(),camera);assert.equal(f.manual.length,1);f.controller.destroy();
});

test('blur and hidden lifecycles discard manual travel and reset partial doorway exit intent',async()=>{
 for(const reason of ['blur','pagehide','visibilitychange']){const f=await fixture({camera:{yaw:0}});f.controller.setFrame(f.source);f.key('w');for(let i=0;i<5;i++)f.frame();const paused=f.controller.position();if(reason==='visibilitychange'){f.doc.hidden=true;f.doc.emit(reason);f.doc.hidden=false;f.doc.emit(reason);}else f.win.emit(reason);f.win.emit('focus');f.win.emit('keydown',{key:'w',target:f.stage,repeat:true});for(let i=0;i<20;i++)f.frame();assert.deepEqual(f.controller.position(),paused);assert.equal(f.frames.size,0);f.controller.destroy();}
 const f=await fixture({camera:{yaw:0},position:{x:0,z:3.5}});f.controller.setFrame(f.source);f.key('s');for(let i=0;i<5;i++)f.frame();assert.equal(f.exits,0);f.walkAllow(false);f.frame();f.walkAllow(true);f.win.emit('keydown',{key:'s',target:f.stage,repeat:true});for(let i=0;i<10;i++)f.frame();assert.equal(f.exits,0);f.key('s');for(let i=0;i<5;i++)f.frame();assert.equal(f.exits,0,'the old partial push must not shorten a fresh exit');for(let i=0;i<10;i++)f.frame();assert.equal(f.exits,1);for(let i=0;i<10;i++)f.frame();assert.equal(f.exits,1);f.controller.destroy();
});

test('intrinsic shrink/grow/aspect changes reallocate immutable GPU textures exactly once; same-size metadata and rejected frames keep allocation',async()=>{
 const f=await fixture(),textures=[],disposed=new Map();
 try{
  assert.equal(f.controller.setFrame(f.source,{anchor:.2}),true);
  const r=f.renderers[0],sprite=r.calls.at(-1).scene.getObjectByName('canonical-shop-pet-frame');
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

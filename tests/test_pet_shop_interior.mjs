import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
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
 const doc=new Events(),win=new Events(),media=new Events(),host=new Element(doc),frames=new Map(),renderers=[],observers=[],packets=[],drafts=[],failures=[];let stamp=0,seq=0,allowed=true,ready=0,exits=0;
 Object.assign(doc,{defaultView:win,hidden:false,viewport:opts.viewport,createElement:tag=>new Element(doc,tag)});media.matches=!!opts.reduced;
 Object.assign(win,{devicePixelRatio:3,performance:{now:()=>stamp},matchMedia:()=>media,requestAnimationFrame:f=>{frames.set(++seq,f);return seq;},cancelAnimationFrame:id=>frames.delete(id)});
 win.ResizeObserver=class{constructor(f){this.fn=f;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
 class Renderer {
  constructor(){this.domElement=new Element(doc,'CANVAS');this.shadowMap={};this.calls=[];this.uploads=[];this.renderLists={dispose:()=>{this.listsDisposed=true;}};renderers.push(this);}
  setPixelRatio(n){this.ratio=n;}setSize(w,h){this.domElement.width=w;this.domElement.height=h;}
  initTexture(t){if(this.failUpload)throw Error('synthetic failure');this.uploads.push(t.version);}
  render(scene,camera){if(this.fail)throw Error('synthetic failure');scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);this.calls.push({scene,camera,sourceVersion:scene.getObjectByName('canonical-shop-pet-frame')?.material.map?.version});}
  dispose(){this.disposed=true;}forceContextLoss(){this.lost=true;}
 }
 let controller;
 controller=await Interior.mount({host,roomId:opts.roomId||'shop',layout:opts.layout,camera:opts.camera,position:opts.position,editing:opts.editing,canRun:()=>allowed,three:{...THREE,WebGLRenderer:Renderer},onReady(){ready++;},onFailure:c=>failures.push(c),onPosition:opts.onPosition,onExit(){exits++;},onDraft:d=>drafts.push(d),onFacing:p=>{packets.push(p);if(opts.coupled&&controller)controller.setFrame(source);}});
 const source=new Element(doc,'CANVAS');source.getContext=()=>({RGBA:1,UNSIGNED_BYTE:2,readPixels(x,y,w,h,format,type,p){p[(2*w+8)*4+3]=255;}});
 const stage=host.children[0]?.children[0];
 return {doc,win,media,host,stage,source,controller,frames,renderers,observers,packets,drafts,failures,get ready(){return ready;},get exits(){return exits;},allow:v=>allowed=v,time:v=>stamp=v,
  frame(ms=40){stamp+=ms;const f=[...frames.values()];frames.clear();f.forEach(fn=>fn(stamp));},
  project(x,z,y=.04){const c=renderers[0].calls.at(-1).camera,v=new THREE.Vector3(x,y,z).project(c);return {clientX:(v.x+1)*300,clientY:(1-v.y)*300};},
  key(k,down=true,target=stage){win.emit(down?'keydown':'keyup',{key:k,target});}
 };
}

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

import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Scene from '../static/pet-town-scene.js';
import Town from '../static/pet-town-walk.js';
import Fishing from '../static/pet-river-fishing.js';
const require=createRequire(import.meta.url),B=require('../static/pet-boat-boarding-proof-20261026/manual-boarding.js'),Route=require('../static/pet-boat-route-proof-20261026/dock-route.js'),Hull=require('../static/pet-boat-hull-proof-20261026/hull.js'),stage1=JSON.parse(readFileSync(new URL('../static/pet-boat-route-proof-20261026/landing-route.json',import.meta.url)));
const clone=x=>JSON.parse(JSON.stringify(x)),near=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,String(a)+' != '+String(b)),plan=()=>({start:{x:0,y:0,z:0},end:{x:0,y:0,z:1},width:.4}),support=q=>({...q,normalY:1,surface:'synthetic-flat'}),fixture=opts=>B.create(plan(),{sampleSupport:support,...opts});
test('idle has no autonomous movement or game/save capabilities, and stale calls after destruction cannot notify or move',()=>{
 const events=[],c=fixture({onChange:s=>events.push(s)});for(let n=0;n<20;n++)assert.equal(c.tick(50),false);near(c.snapshot().progress,0);near(c.snapshot().distance,0);assert.equal(c.hasIntent(),false);assert.equal(c.snapshot().save,false);assert.equal(c.snapshot().sailing,false);assert.equal(c.snapshot().anatomicalFootFit,false);
 c.keyDown('w',false);c.tick(50);c.destroy();const before=c.snapshot(),count=events.length;assert.equal(before.dead,true);c.keyDown('w',false);c.keyUp('w');c.tap(plan().end);c.tick(50);c.cancel('late_blur');c.destroy();assert.equal(events.length,count);assert.deepEqual(c.snapshot(),before);assert.equal(c.hasIntent(),false);
});
test('fresh held direction travels at the capped speed and clamps at both endpoints without crossing the stern stop',()=>{
 const c=fixture();try{assert.equal(c.keyDown('w',false),true);c.tick(50);near(c.snapshot().progress,.0225);for(let n=0;n<100;n++)c.tick(50);near(c.snapshot().progress,1);assert.equal(c.snapshot().phase,'aboard');assert.equal(c.hasIntent(),false);const end=c.snapshot();for(let n=0;n<20;n++)c.tick(50);near(c.snapshot().distance,end.distance);c.keyUp('w');c.keyDown('s',false);for(let n=0;n<100;n++)c.tick(50);near(c.snapshot().progress,0);assert.equal(c.snapshot().phase,'dock');near(c.snapshot().distance,2);}finally{c.destroy();}
});
test('independent physical direction keys release independently and opposite directions cancel',()=>{
 const c=fixture();try{c.keyDown('w',false);c.keyDown('ArrowUp',false);c.keyUp('w');assert.equal(c.hasIntent(),true);c.tick(50);near(c.snapshot().progress,.0225);c.keyDown('s',false);assert.equal(c.hasIntent(),false);const p=c.snapshot().progress;c.tick(50);near(c.snapshot().progress,p);c.keyUp('s');assert.equal(c.hasIntent(),true);c.keyUp('ArrowUp');assert.equal(c.hasIntent(),false);c.keyDown('W',false);c.keyUp('w');assert.equal(c.hasIntent(),false);}finally{c.destroy();}
});
test('pre-ready and paused input never restarts from OS repeat, elapsed time or a stale held key',()=>{
 let allowed=false;const c=fixture({inputAllowed:()=>allowed});try{assert.equal(c.keyDown('ArrowUp',false),false);allowed=true;assert.equal(c.keyDown('ArrowUp',true),false);c.tick(50);near(c.snapshot().progress,0);assert.equal(c.keyDown('ArrowUp',false),true);c.tick(50);const p=c.snapshot().progress;allowed=false;c.tick(50);allowed=true;assert.equal(c.hasIntent(),false);assert.equal(c.keyDown('ArrowUp',true),false);c.tick(50);near(c.snapshot().progress,p);assert.equal(c.keyDown('ArrowUp',false),true);c.tick(50);assert.ok(c.snapshot().progress>p);}finally{c.destroy();}
});
test('blur, hidden and cancellation clear both held keys and tap destinations until fresh user intent',()=>{
 const c=fixture();try{for(const reason of ['blur','hidden','pointer_cancel']){c.keyDown('w',false);c.tick(50);c.cancel(reason);const p=c.snapshot().progress;assert.equal(c.hasIntent(),false);assert.equal(c.keyDown('w',true),false);c.tick(50);near(c.snapshot().progress,p);assert.equal(c.tap(plan().end),true);c.cancel(reason);assert.equal(c.snapshot().destination,null);c.tick(50);near(c.snapshot().progress,p);}}finally{c.destroy();}
});
test('invalid/large dt cancels atomically, while a finite 250ms frame is capped at 50ms rather than teleporting',()=>{
 for(const dt of [NaN,Infinity,-1,251,100000]){const c=fixture();try{c.keyDown('w',false);assert.equal(c.tick(dt),false);near(c.snapshot().progress,0);near(c.snapshot().distance,0);assert.equal(c.hasIntent(),false);assert.equal(c.snapshot().reason,'invalid_dt');}finally{c.destroy();}}
 const c=fixture();try{c.keyDown('w',false);c.tick(0);near(c.snapshot().progress,0);assert.equal(c.hasIntent(),true);c.tick(250);near(c.snapshot().progress,.0225);}finally{c.destroy();}
});
test('a support gap between valid endpoints is sampled continuously and rejects the whole advance',()=>{
 const seen=[],c=fixture({sampleSupport:q=>{seen.push(q.z);return q.z>.012&&q.z<.019?null:support(q);}});try{c.keyDown('w',false);assert.equal(c.tick(50),false);near(c.snapshot().progress,0);near(c.snapshot().distance,0);assert.equal(c.snapshot().reason,'unsupported_surface');assert.ok(seen.some(z=>z>.012&&z<.019));assert.equal(c.hasIntent(),false);}finally{c.destroy();}
});
test('off-position, wrong-height, steep, nonfinite and throwing support cannot be treated as a safe floor',()=>{
 for(const sample of [q=>({...support(q),x:q.x+.006}),q=>({...support(q),y:q.y+.031}),q=>({...support(q),normalY:.79}),q=>({...support(q),z:NaN}),()=>{throw Error('ray unavailable');}])assert.throws(()=>fixture({sampleSupport:sample}),/unsupported_boarding_plan/);
 let unsafe=false;const c=fixture({sampleSupport:q=>({...support(q),normalY:unsafe?.5:1})});try{unsafe=true;c.keyDown('w',false);assert.equal(c.tick(50),false);near(c.snapshot().progress,0);}finally{c.destroy();}
});
test('tap is an in-lane destination, not teleportation; lateral/water/out-of-height coordinates are refused',()=>{
 const c=fixture();try{assert.equal(c.tap(plan().end),true);near(c.snapshot().progress,0);near(c.snapshot().destination,1);c.tick(50);near(c.snapshot().progress,.0225);for(const q of [{x:.17,y:0,z:.5},{x:0,y:0,z:1.01},{x:0,y:.061,z:.5},{x:0,y:0,z:-.01},{x:NaN,y:0,z:.5}])assert.equal(c.tap(q),false);for(let n=0;n<100;n++)c.tick(50);near(c.snapshot().progress,1);assert.equal(c.snapshot().destination,null);assert.equal(c.tap(plan().start),true);for(let n=0;n<100;n++)c.tick(50);near(c.snapshot().progress,0);}finally{c.destroy();}
});
test('keyboard scope permits neutral stage content and rejects interactive ancestors and outside controls',()=>{
 const scope={tagName:'SECTION',parentElement:null,contains(t){for(let n=t;n;n=n.parentElement)if(n===this)return true;return false;}},span={tagName:'SPAN',parentElement:scope},canvas={tagName:'CANVAS',parentElement:scope};assert.equal(B.allowsKeyboardTarget(scope,scope),true);assert.equal(B.allowsKeyboardTarget(span,scope),true);assert.equal(B.allowsKeyboardTarget(canvas,scope),true);
 for(const tagName of ['INPUT','TEXTAREA','SELECT','BUTTON','A','SUMMARY']){const parent={tagName,parentElement:scope},child={tagName:'SPAN',parentElement:parent};assert.equal(B.allowsKeyboardTarget(child,scope),false);}
 const edit={tagName:'DIV',isContentEditable:true,parentElement:scope};assert.equal(B.allowsKeyboardTarget({tagName:'SPAN',parentElement:edit},scope),false);assert.equal(B.allowsKeyboardTarget({tagName:'DIV',parentElement:null},scope),false);assert.equal(B.allowsKeyboardTarget(null,scope),false);
});
test('invalid plans/speed fail closed and snapshots/original inputs cannot overwrite controller coordinates',()=>{
 for(const p of [{...plan(),width:.19},{...plan(),width:.81},{...plan(),end:{x:0,y:0,z:.09}},{...plan(),end:{x:0,y:0,z:2.01}},{...plan(),end:{x:0,y:1,z:1}},{...plan(),start:{x:NaN,y:0,z:0}}]){assert.equal(B.validatePlan(p),null);assert.throws(()=>B.create(p,{sampleSupport:support}),/invalid_manual_boarding/);}
 for(const speed of [NaN,0,.099,1.001])assert.throws(()=>fixture({speed}),/invalid_manual_boarding/);assert.throws(()=>B.create(plan(),{}),/invalid_manual_boarding/);
 const p=plan(),c=B.create(p,{sampleSupport:support});try{p.start.z=99;p.end.z=100;const snap=c.snapshot();snap.position.z=500;near(c.snapshot().position.z,0);near(c.plan.start.z,0);near(c.plan.end.z,1);assert.ok(Object.isFrozen(c.plan.start)&&Object.isFrozen(c.plan.end));assert.throws(()=>{c.plan.start.z=99;},TypeError);assert.throws(()=>{c.plan.end.z=100;},TypeError);near(c.plan.start.z,0);near(c.plan.end.z,1);}finally{c.destroy();}
});
test('real current Town surfaces, saved pier/plank and measured hull rays carry manual footsteps to the stern floor and back, before the bench',()=>{
 const world=Town.createWorld(),worldJSON=JSON.stringify(world),model=Scene.buildWorld(THREE,world,{},null,null,'autumn'),g=Route.extract(THREE,Scene,model,world,Fishing.site());assert.deepEqual(g,stage1.input);
 const hull=Hull.buildHull(THREE),p=Hull.validatePlacement(THREE,Route,g,stage1.proposal.candidate,hull);assert.equal(p.ok,true);const dock=Route.buildDock(THREE,g,p.candidate),board=Hull.createBoarding(THREE,p);model.scene.add(dock.group,hull.group,board.group);model.scene.updateMatrixWorld(true);
 const supports=[];for(const root of [dock.group,board.group,hull.group])root.traverse(o=>{if(o.isMesh&&['closed-pier-plank','closed-contact-boarding-plank','technical-hull-shell','closed-wooden-thwart'].includes(o.name))supports.push(o);});const ray=new THREE.Raycaster(),sample=q=>{ray.set(new THREE.Vector3(q.x,q.y+.2,q.z),new THREE.Vector3(0,-1,0));ray.far=.4;const hit=ray.intersectObjects(supports,true)[0];if(!hit)return null;const normal=hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();return{x:hit.point.x,y:hit.point.y,z:hit.point.z,normalY:normal.y,surface:hit.object.name};};
 let c;try{c=B.create({start:p.boarding.start,end:p.boarding.end,width:p.boarding.width},{sampleSupport:sample});c.keyDown('ArrowUp',false);for(let n=0;n<100;n++){c.tick(50);const q=c.snapshot();assert.ok(q.progress<=q.length);const actual=sample(q.position);assert.ok(actual);near(q.position.y,actual.y,1e-6);}const aboard=c.snapshot(),local=hull.group.worldToLocal(new THREE.Vector3(aboard.position.x,aboard.position.y,aboard.position.z));assert.equal(aboard.phase,'aboard');near(local.z,-.5,1e-5);near(local.y,hull.floorY,1e-5);const bench=hull.group.children.filter(o=>o.name==='closed-wooden-thwart').map(o=>new THREE.Box3().setFromObject(o)),point=new THREE.Vector3(aboard.position.x,aboard.position.y,aboard.position.z);assert.ok(bench.every(b=>!b.containsPoint(point)));const distance=aboard.distance;for(let n=0;n<20;n++)c.tick(50);near(c.snapshot().distance,distance);near(c.snapshot().progress,c.plan.length);
 c.keyUp('ArrowUp');c.keyDown('ArrowDown',false);for(let n=0;n<100;n++)c.tick(50);assert.equal(c.snapshot().phase,'dock');near(c.snapshot().position.y,p.boarding.start.y,.004);assert.equal(c.snapshot().sailing,false);assert.equal(c.snapshot().save,false);assert.equal(JSON.stringify(world),worldJSON);
 }finally{c?.destroy();board.dispose();dock.dispose();hull.dispose();model.dispose();}
});

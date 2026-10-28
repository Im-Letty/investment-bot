import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Scene from '../static/pet-town-scene.js';
import Town from '../static/pet-town-walk.js';
import Originals from '../static/pet-town-placement-originals.js';
import {assertDerivedWorld} from './helpers/pet-town-derived-world.mjs';

const roadNames=new Set(['layout-plaza-border','layout-plaza-floor','layout-plaza-border-paver',
 'layout-curved-path-edge','layout-curved-cream-path','layout-porch-cream-connector','bridge-deck']);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,a+' != '+b);
function paving(model) {
 const rows=[];model.scene.updateMatrixWorld(true);
 model.scene.traverse(o=>{
  if(!o.isMesh||!roadNames.has(o.name))return;
  const p=o.geometry.attributes.position,index=o.geometry.index;
  for(let i=0;i<(index?index.count:p.count);i+=3){const tri=[];
   for(let j=0;j<3;j++){const v=new THREE.Vector3().fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(o.matrixWorld);tri.push(new THREE.Vector3(v.x,0,v.z));}
   rows.push(tri);
  }
 });return rows;
}
// Independent closest-point witnesses do not call the placement distance API.
function distance(p,tri) {
 const cross=new THREE.Vector3().subVectors(tri[1],tri[0]).cross(new THREE.Vector3().subVectors(tri[2],tri[0]));
 if(cross.lengthSq()>1e-20)return p.distanceTo(new THREE.Triangle(...tri).closestPointToPoint(p,new THREE.Vector3()));
 return Math.min(...tri.map((a,i)=>{const b=tri[(i+1)%3];return a.distanceToSquared(b)===0?p.distanceTo(a):p.distanceTo(new THREE.Line3(a,b).closestPointToPoint(p,true,new THREE.Vector3()));}));
}
function clearance(model) {
 const d=model.treeRoadClearance,p=new THREE.Vector3(d.to.x,0,d.to.z),triangles=paving(model);
 assert.equal(triangles.length,d.roadTriangleCount);
 const measured=Math.min(...triangles.map(tri=>distance(p,tri)));
 near(measured,d.afterPavingDistance);assert.ok(measured>=d.radius+d.margin-1e-7);
 return {d,triangles,measured};
}
function withModel(layout,fn,avoid,prepare) {
 const raw=layout&&JSON.stringify(layout),world=Town.createWorld(layout);if(prepare)prepare(world);
 const before=JSON.stringify(world),model=Scene.buildWorld(THREE,world,{},avoid);
 try{return fn(model,world,before);}finally{model.dispose();if(layout)assert.equal(JSON.stringify(layout),raw);}
}
function roadDigest(model) {
 const rows=paving(model).map(tri=>tri.map(v=>v.toArray()));
 return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

test('the saved grove leaves the actual paved oval using its unchanged original envelope',()=>withModel(null,(m,world,before)=>{
 const {d,triangles,measured}=clearance(m);
 assert.equal(d.revision,'tree-road-clearance1');assert.equal(d.status,'relocated');assert.equal(d.applied,true);
 assert.equal(d.criterion,'conservative-original-horizontal-envelope-not-measured-root-depth');
 assert.ok(Object.isFrozen(d)&&Object.isFrozen(d.from)&&Object.isFrozen(d.to));
 const from=new THREE.Vector3(d.from.x,0,d.from.z);assert.equal(Math.min(...triangles.map(t=>distance(from,t))),0,'old root was inside actual paving');
 const spec=Originals.resolve('treeGrove'),radius=3.25*1.08*Math.max(spec.groundAnchor[0]-spec.alphaBounds[0]/spec.width,spec.alphaBounds[2]/spec.width-spec.groundAnchor[0]);
 near(d.radius,radius);assert.equal(d.sourceSHA256,spec.sha256);assert.ok(measured-d.radius>=.30-1e-7);
 assert.ok(d.candidatesChecked>0&&d.candidatesChecked<=2048);assert.equal(d.candidateLimit,2048);
 assertDerivedWorld(world,before,m);
}));

test('derived tree position, footprint, approach and actual sprite stay coherent without an old invisible wall',()=>withModel(null,(m,world,before)=>{
 const previous=JSON.parse(before).places.find(p=>p.id==='tree'),tree=world.places.find(p=>p.id==='tree'),d=m.treeRoadClearance;
 let sprite;m.scene.traverse(o=>{if(o.isSprite&&o.userData.treeVarietyIndex===0)sprite=o;});m.scene.updateMatrixWorld(true);
 const actual=sprite.getWorldPosition(new THREE.Vector3()),center=Scene.groundPoint(world,tree.footprint);
 near(actual.x,center.x);near(actual.z,center.z);near(actual.y,.025);
 near(tree.x-previous.x,tree.footprint.x-previous.footprint.x);near(tree.y-previous.y,tree.entrance.y-previous.entrance.y);
 assert.equal(Town.isWalkable(world,tree.footprint.x,tree.footprint.y),false);
 assert.equal(Town.isWalkable(world,previous.footprint.x,previous.footprint.y),true,'the former road location is no longer blocked');
 assert.equal(Town.isWalkable(world,tree.entrance.x,tree.entrance.y),true);
 assert.ok(Town.route(world,world.spawn,tree.entrance));near(center.x,d.to.x);near(center.z,d.to.z);
}));

test('saved layout objects remain immutable; facilities, map, species and image dimensions retain their values',()=>{
 const layout=Object.freeze({items:Object.freeze([Object.freeze({id:'tree',x:48,y:44}),Object.freeze({id:'home',x:26,y:26})])});
 withModel(layout,(m,world,before)=>{
  assertDerivedWorld(world,before,m);clearance(m);const beforePlaces=JSON.parse(before).places;
  for(const p of world.places.filter(p=>p.id!=='tree'))assert.deepEqual(p,beforePlaces.find(old=>old.id===p.id));
  const trees=[];m.scene.traverse(o=>{if(o.isSprite&&Number.isInteger(o.userData.treeVarietyIndex))trees.push(o);});
  assert.equal(trees.length,27);
  for(const sprite of trees){const spec=Originals.resolve(sprite.userData.originalArtKind),index=sprite.userData.treeVarietyIndex,border=index-1,scale=index===0?1.08:.75+(border*7%9)*.055;
   near(sprite.scale.x,3.25*scale);near(sprite.scale.y,sprite.scale.x*spec.height/spec.width);assert.equal(sprite.userData.sourceSHA256,spec.sha256);
   if(index){const actual=sprite.getWorldPosition(new THREE.Vector3()),ex=border<13?-world.width/200-.45:-world.width/200+(border-13)*1.55,ez=border<13?-world.height/200+border*1.55:-world.height/200-.45;
    near(actual.x,ex+Math.sin(border*2.7)*.4);near(actual.z,ez+Math.cos(border*1.7)*.4);}
  }
 });
});

test('moving only the saved tree leaves every actual road triangle unchanged',()=>{
 const a=Town.createWorld({items:[{id:'tree',x:48,y:44}]}),b=Town.createWorld({items:[{id:'tree',x:48,y:20}]}),m=Scene.buildWorld(THREE,a,{}),n=Scene.buildWorld(THREE,b,{});
 try{assert.equal(roadDigest(m),roadDigest(n));assert.equal(m.scene.userData.meadowFlowers.roadTriangleCount,2154);assert.equal(m.meadowLife.summary().sites,40);assert.equal(m.people.length,0);}finally{m.dispose();n.dispose();}
});

test('an already safe saved tree is preserved with no search or cumulative shifts',()=>{
 withModel({items:[{id:'tree',x:48,y:20}]},(m,world,before)=>{
  assert.equal(m.treeRoadClearance.status,'already-clear');assert.equal(m.treeRoadClearance.applied,false);assert.equal(m.treeRoadClearance.candidatesChecked,0);
  assert.equal(JSON.stringify(world),before);
 });
 const world=Town.createWorld(),first=Scene.buildWorld(THREE,world,{}),settled=JSON.stringify(world),second=Scene.buildWorld(THREE,world,{});
 try{assert.equal(second.treeRoadClearance.status,'already-clear');assert.equal(JSON.stringify(world),settled);
  for(const season of ['spring','summer','autumn','winter']){first.setSeason(season);first.animate(7000,false);assert.equal(JSON.stringify(world),settled);}
 }finally{first.dispose();second.dispose();}
});

test('current actor, initial spawn, all extra shop solids and entrances are excluded from sampled sites',()=>{
 const avoid={x:1382.4,y:750};
 withModel(null,(m,world,before)=>{
  const {d}=clearance(m),actor=Scene.groundPoint(world,avoid);assert.ok(Math.hypot(d.to.x-actor.x,d.to.z-actor.z)>=d.radius+.50-1e-7);
  assert.equal(Town.isWalkable(world,avoid.x,avoid.y),true);assert.equal(d.obstacleCount,world.places.length-1);
  for(const p of world.places.filter(p=>p.id!=='tree')){
   const b=Town.collisionBounds(p),lo=Scene.groundPoint(world,{x:b.minX,y:b.minY}),hi=Scene.groundPoint(world,{x:b.maxX,y:b.maxY}),center=new THREE.Vector3(d.to.x,0,d.to.z);
   const box=new THREE.Box3(new THREE.Vector3(lo.x,0,lo.z),new THREE.Vector3(hi.x,0,hi.z));assert.ok(center.distanceTo(box.clampPoint(center,new THREE.Vector3()))>=d.radius+d.margin-1e-7);
   const door=Scene.groundPoint(world,p.entrance);assert.ok(Math.hypot(d.to.x-door.x,d.to.z-door.z)>=d.radius+.50-1e-7);
  }
  assertDerivedWorld(world,before,m);
 },avoid,world=>{
  const base=world.places.find(p=>p.id==='home');
  for(let i=0;i<3;i++){const x=1382.4+(i-1)*480,y=564.8;world.places.push({...base,id:'extra-shop-'+i,shopId:'cafe',label:'shop',x,y,entrance:{x,y:y+120},footprint:{x,y,rx:80,ry:60}});}
 });
});

class Events {
 constructor(){this.listeners=new Map();}
 addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
 removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
}
class Element extends Events {
 constructor(doc){super();this.ownerDocument=doc;this.style={};this.isConnected=true;this.children=[];this.tagName='DIV';}
 append(c){c.parentNode=this;this.children.push(c);return c;}
 contains(c){return this===c||this.children.some(child=>child.contains(c));}
 focus(){this.ownerDocument.activeElement=this;}
 getBoundingClientRect(){return {left:0,top:0,width:390,height:740};}
}
test('an already mounted manual controller keeps its position and approaches the corrected tree using the shared world',()=>{
 const world=Town.createWorld(),win=new Events(),doc=new Events(),raf=new Map();let id=0,stamp=0;
 doc.hidden=false;doc.defaultView=win;win.requestAnimationFrame=fn=>{const k=++id;raf.set(k,fn);return k;};win.cancelAnimationFrame=k=>raf.delete(k);
 const viewport=new Element(doc),surface=viewport.append(new Element(doc)),avatar=surface.append(new Element(doc));doc.activeElement=viewport;
 const requested={x:1382.4,y:564.8},controller=Town.mount({viewport,worldElement:surface,avatar,world,position:requested}),start=controller.position(),model=Scene.buildWorld(THREE,world,{},start);
 try{
  assert.deepEqual(controller.position(),start,'placement correction cannot move the actor');
  assert.equal(Town.isWalkable(world,start.x,start.y),true);
  assert.equal(controller.approach('tree'),true);
  for(let i=0;i<1200&&raf.size;i++){stamp+=50;const jobs=[...raf.values()];raf.clear();for(const job of jobs)job(stamp);}
  assert.equal(raf.size,0);const p=controller.position(),tree=world.places.find(p=>p.id==='tree');
  near(p.x,tree.entrance.x);near(p.y,tree.entrance.y);
 }finally{controller.destroy();model.dispose();}
});

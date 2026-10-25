import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync}from'node:fs';import{createHash}from'node:crypto';
import * as THREE from '../static/pet-boat-route-proof-20261026/runtime/vendor/three-0.160.1.module.js';import Scene from '../static/pet-boat-route-proof-20261026/runtime/pet-town-scene.js';import Town from '../static/pet-boat-route-proof-20261026/runtime/pet-town-walk.js';import Fishing from '../static/pet-boat-route-proof-20261026/runtime/pet-river-fishing.js';import API from '../static/pet-boat-route-proof-20261026/dock-route.js';
function fixture(){const world=Town.createWorld(),model=Scene.buildWorld(THREE,world,{},null,null,'autumn'),input=API.extract(THREE,Scene,model,world,Fishing.site());return{world,model,input,p:API.propose(input).candidate};}
function clone(x){return JSON.parse(JSON.stringify(x));}
function closed(geo){const a=geo.attributes.position,index=geo.index,edges=new Map(),key=i=>[a.getX(i),a.getY(i),a.getZ(i)].map(x=>Math.round(x*1e6)).join(':');for(let i=0;i<index.count;i+=3){const v=[0,1,2].map(k=>key(index.getX(i+k)));if(new Set(v).size<3)continue;for(let k=0;k<3;k++){const e=[v[k],v[(k+1)%3]].sort().join('/');edges.set(e,(edges.get(e)||0)+1);}}assert.ok(edges.size);assert.ok([...edges.values()].every(n=>n===2));for(const role of ['position','normal'])for(const n of geo.attributes[role].array)assert.ok(Number.isFinite(n));}
test('all seven copied runtime inputs plus license retain exact source SHA; no Core/storage module enters this proof',()=>{
 const manifestURL=new URL('../static/pet-boat-route-proof-20261026/input-manifest.json',import.meta.url),manifest=JSON.parse(readFileSync(manifestURL,'utf8'));assert.equal(manifest.runtime_files.length,8);
 for(const row of manifest.runtime_files){const b=readFileSync(new URL(row.path,manifestURL));assert.equal(createHash('sha256').update(b).digest('hex'),row.sha256);assert.equal(b.length,row.bytes);}
 assert.ok(!manifest.runtime_files.some(r=>/pet-game-core|pet-game\.js/.test(r.source_repo_path)));
});
test('extracts a closed boundary from actual dry-land triangles and the real bridge; proposal is water-clear and unchanged source walking stays authoritative',()=>{
 const f=fixture(),before=JSON.stringify(f.world),surfaces=f.model.surfaces.map(s=>s.matrixWorld.elements.slice());
 try{const r=API.propose(f.input);assert.equal(r.ok,true);assert.ok(Object.isFrozen(f.input.land));assert.ok(Math.abs(API.bankAt(f.input,1680)-2255.5319)<.001);assert.ok(Math.abs(f.input.bridge.top-.19)<1e-6);assert.equal(Town.isWalkable(f.world,r.candidate.approach.x,r.candidate.approach.y),true);assert.equal(Town.isWalkable(f.world,r.candidate.socket.x,r.candidate.socket.y),false);
  for(const d of Object.values(r.report.metrics))assert.ok(d+1e-6>=r.report.requiredClearance);for(const k of ['boardingEnabled','sailingEnabled','boatHullCreated','gameCollisionChanged','saveConnected'])assert.equal(r.candidate[k],false);
  assert.equal(JSON.stringify(f.world),before);assert.deepEqual(f.model.surfaces.map(s=>s.matrixWorld.elements),surfaces);
 }finally{f.model.dispose();}
});
test('seasonal colors do not change derived bank, bridge, route or world records',()=>{
 const f=fixture(),before=JSON.stringify(f.world),s=JSON.stringify(f.input),p=JSON.stringify(API.propose(f.input));try{for(const k of ['spring','summer','winter','autumn']){f.model.setSeason(k);const g=API.extract(THREE,Scene,f.model,f.world,Fishing.site());assert.equal(JSON.stringify(g),s);assert.equal(JSON.stringify(API.propose(g)),p);}assert.equal(JSON.stringify(f.world),before);}finally{f.model.dispose();}
});
test('malformed geometry/candidates, nonfinite values, unbound shoreline and oversize envelopes fail rather than filling safe defaults',()=>{
 const f=fixture();try{
  for(const n of [NaN,Infinity,-1,0,201]){const p=clone(f.p);p.vesselRadius=n;assert.equal(API.validate(f.input,p).valid,false);}
  assert.equal(API.validate(f.input,undefined).valid,false);const bad=clone(f.input);bad.land[0].x=Infinity;assert.equal(API.geometryOK(bad),false);assert.equal(API.propose(bad).ok,false);
  const duplicate=clone(f.input);duplicate.places.push(clone(duplicate.places[0]));assert.equal(API.geometryOK(duplicate),false);
  const shore=clone(f.p);shore.shore=clone(f.input.land[1]);assert.ok(API.validate(f.input,shore).reasons.includes('shore_not_on_pier'));
  assert.equal(API.propose(f.input,{vesselRadius:160}).ok,false);
 }finally{f.model.dispose();}
});
test('continuous capsule clearance catches a land tongue between two water endpoints',()=>{
 const g={version:1,width:1000,height:1000,scale:100,origin:{x:500,y:500},floorHeight:.025,waterHeight:-.05,land:[{x:0,y:0},{x:400,y:0},{x:400,y:350},{x:850,y:500},{x:400,y:650},{x:400,y:1000},{x:0,y:1000}],bridge:{x0:50,y0:50,x1:100,y1:100,top:.19},places:[],fishing:{position:{x:50,y:100},target:{x:100,y:100},radius:10}};
 const p={approach:{x:350,y:900},shore:{x:400,y:900},head:{x:450,y:900},socket:{x:600,y:900},route:[{x:600,y:900},{x:900,y:100}],vesselRadius:30,margin:24,width:84,deckTop:.043};assert.equal(API.geometryOK(g),true);assert.ok(p.route.every(q=>!API.inside(q,g.land)));assert.ok(API.validate(g,p).reasons.includes('bank_clearance'));
});
test('bridge, fishing zone, world edge and a relocated facility are separate explicit rejection reasons',()=>{
 const f=fixture();try{
  const b=clone(f.p);b.route.push({x:2645,y:1160});assert.ok(API.validate(f.input,b).reasons.includes('bridge_clearance'));
  const fish=clone(f.p);fish.route.push(clone(f.input.fishing.target));assert.ok(API.validate(f.input,fish).reasons.includes('fishing_clearance'));
  const edge=clone(f.p);edge.route.push({x:2879,y:1919});assert.ok(API.validate(f.input,edge).reasons.includes('world_edge_clearance'));
  const g=clone(f.input);g.places.push({id:'hypothetical',x:f.p.route[1].x,y:f.p.route[1].y,rx:90,ry:60,entrance:clone(f.p.route[1])});assert.ok(API.validate(g,f.p).reasons.includes('building_clearance'));
 }finally{f.model.dispose();}
});
test('technical dock is closed finite geometry at a measured floor step; guides are not a hull and disposal does not own the actual town',()=>{
 const f=fixture(),world=JSON.stringify(f.world);let dock;try{
  dock=API.buildDock(THREE,f.input,f.p);let planks=0,supports=0;dock.group.traverse(o=>{if(!o.isMesh)return;closed(o.geometry);if(o.name==='closed-pier-plank'){planks++;const b=new THREE.Box3().setFromObject(o);assert.ok(Math.abs(b.max.y-f.p.deckTop)<1e-6);}if(o.name==='closed-pier-support')supports++;assert.ok(!/hull|character/.test(o.name));});assert.ok(planks>=8);assert.equal(supports,4);assert.ok(f.p.deckTop-f.input.floorHeight<.04);
  const count=new Map();for(const x of [...dock.geometries,...dock.materials]){count.set(x,0);x.addEventListener('dispose',()=>count.set(x,count.get(x)+1));}let baseDisposed=0;for(const g of f.model.geometries)g.addEventListener('dispose',()=>baseDisposed++);
  dock.dispose();dock.dispose();assert.ok([...count.values()].every(n=>n===1));assert.equal(baseDisposed,0);assert.equal(JSON.stringify(f.world),world);
  const bad=clone(f.p);bad.route[1]={x:10,y:10};assert.throws(()=>API.buildDock(THREE,f.input,bad),/invalid_landing/);
 }finally{dock?.dispose();f.model.dispose();}
});
test('ambiguous or nonplanar source surfaces cannot produce an adopted route',()=>{
 const f=fixture();try{f.model.surfaces.push(f.model.surfaces[0]);assert.throws(()=>API.extract(THREE,Scene,f.model,f.world,Fishing.site()),/ambiguous/);f.model.surfaces.pop();
  const land=f.model.surfaces[0];land.geometry.attributes.position.setZ(0,.12);land.updateMatrixWorld(true);assert.throws(()=>API.extract(THREE,Scene,f.model,f.world,Fishing.site()),/nonplanar/);
 }finally{f.model.dispose();}
});

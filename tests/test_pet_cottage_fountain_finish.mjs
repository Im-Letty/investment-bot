import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Scene from '../static/pet-town-scene.js';
import Town from '../static/pet-town-walk.js';
test('existing two-tier fountain keeps its bowl/rim poses with authored cream and muted lilac pigments',()=>{
 const world=Town.createWorld(),saved=JSON.stringify(world),m=Scene.buildWorld(THREE,world,{});
 try{
  const f=m.scene.getObjectByName('market-photo-fountain');assert.ok(f);
  const low=f.getObjectByName('fountain-lower-bowl'),high=f.getObjectByName('fountain-upper-bowl');
  assert.deepEqual(low.scale.toArray(),[.74,.42,.74*.75]);assert.deepEqual(high.scale.toArray(),[.37,.27,.37*.75]);
  assert.equal(low.position.y,.12);assert.equal(high.position.y,.77);
  assert.deepEqual(f.getObjectByName('fountain-foot').material.map(m=>m.color.getHexString()),['ad9bb7','c6ad76','c6ad76']);
  assert.equal(low.material.color.getHexString(),'d6c4a3');assert.equal(low.material.roughness,.62);
  const rims=[],panels=[];f.traverse(o=>{if(o.name==='lilac-glazed-fountain-rim')rims.push(o);if(o.name==='fountain-raised-petal-panel')panels.push(o);});
  assert.equal(rims.length,2);assert.equal(panels.length,20);
  for(const r of rims){assert.equal(r.material.color.getHexString(),'ad9bb7');assert.equal(r.material.roughness,.30);assert.equal(r.material.metalness,0);}
  for(const p of panels)assert.equal(p.material.color.getHexString(),'e3d4b8');
  const poses=[];f.traverse(o=>{if(o.isMesh)poses.push([...o.matrixWorld.elements]);});
  for(const season of ['spring','summer','winter','autumn']){m.setSeason(season);let i=0;f.traverse(o=>{if(o.isMesh)assert.deepEqual([...o.matrixWorld.elements],poses[i++]);});}
  assert.equal(JSON.stringify(world),saved);
 }finally{m.dispose();}
});
test('pearl water remains translucent across the eight existing cascades and uses only fountain-local materials',()=>{
 const m=Scene.buildWorld(THREE,Town.createWorld(),{});try{
  const f=m.scene.getObjectByName('market-photo-fountain'),streams=[];f.traverse(o=>{if(o.name==='fountain-cascade')streams.push(o);});
  assert.equal(streams.length,8);
  for(const name of ['fountain-lower-water','fountain-upper-water'])assert.equal(f.getObjectByName(name).material.color.getHexString(),'dce4df');
  for(const s of streams){assert.equal(s.material.color.getHexString(),'eef1e7');assert.ok(s.material.transparent);assert.ok(s.material.opacity>=.30&&s.material.opacity<=.45);assert.equal(s.material.depthWrite,false);}
  const local=new Set();f.traverse(o=>{if(o.isMesh)for(const mat of (Array.isArray(o.material)?o.material:[o.material]))if(mat.userData.fountainReferenceFinish)local.add(mat);});
  assert.ok(local.size>=5&&local.size<=8);
  const home=m.placeGroups.find(g=>g.userData.placeId==='home');home.traverse(o=>{if(o.isMesh)assert.ok(!local.has(o.material),'house roof and wood do not inherit a fountain override');});
  for(const mat of local)assert.ok(m.materials.has(mat),'local copies are owned and released by the world');
 }finally{m.dispose();}
});

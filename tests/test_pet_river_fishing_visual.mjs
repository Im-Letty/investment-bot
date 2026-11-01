import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Fishing from '../static/pet-river-fishing.js';
import Town from '../static/pet-town-walk.js';
test('holder, rod, real line, float, fish shadow and ripple update in the actual Town coordinate system with explicit matrices',()=>{
 const w=Town.createWorld(),visual=Fishing.createVisual(THREE,w),before=JSON.stringify(w),pos=Fishing.site().position;
 try{
  const names=['river-rod-holder','fishing-rod','fishing-grip','fishing-line','fishing-float','fishing-shadow','fishing-ripple','reeled-fish','river-bank-marker'];
  for(const name of names)assert.ok(visual.group.getObjectByName(name),name);
  visual.update({phase:'waiting'},pos,1000,false);
  const rod=visual.group.getObjectByName('fishing-rod'),float=visual.group.getObjectByName('fishing-float'),line=visual.group.getObjectByName('fishing-line'),fish=visual.group.getObjectByName('reeled-fish');
  assert.equal(rod.visible,true);assert.equal(fish.visible,false);const old=float.position.y;visual.update({phase:'bite'},pos,1100,false);assert.notEqual(float.position.y,old);
  visual.group.traverse(o=>{if(o.isMesh||o.isLine){assert.ok(o.matrixWorld.elements.every(Number.isFinite));const p=o.geometry.attributes.position;for(const v of p.array)assert.ok(Number.isFinite(v));}});
  const data=Array.from(line.geometry.attributes.position.array);assert.ok(Math.hypot(data[3]-data[0],data[4]-data[1],data[5]-data[2])>1);
  visual.update({phase:'caught'},pos,1200,false);assert.equal(fish.visible,true);assert.equal(visual.group.getObjectByName('fishing-shadow').visible,false);
  visual.update({phase:'bite'},pos,2000,true);const stable=float.position.clone();visual.update({phase:'bite'},pos,9999,true);assert.deepEqual(float.position,stable);
  visual.update({phase:'waiting'},w.spawn,1000,false);assert.equal(rod.visible,false);assert.equal(JSON.stringify(w),before);
 }finally{visual.dispose();}
});
test('all dedicated geometries and materials are disposed once without modifying existing Town resources',()=>{
 const v=Fishing.createVisual(THREE,Town.createWorld());let g=0,m=0;v.geometries.forEach(x=>x.addEventListener('dispose',()=>g++));v.materials.forEach(x=>x.addEventListener('dispose',()=>m++));const n=v.geometries.size,k=v.materials.size;
 v.dispose();v.dispose();assert.equal(g,n);assert.equal(m,k);
});

test('the existing caught-fish mesh uses each pinned species palette without creating or disposing a second visual',()=>{
 const world=Town.createWorld(),v=Fishing.createVisual(THREE,world),caught=v.group.getObjectByName('reeled-fish'),geometry=caught.geometry,n=v.geometries.size;
 try{for(const row of Fishing.catalogue){v.update({phase:'caught',fishId:row.id},Fishing.site().position,1000,true);assert.equal(caught.visible,true);assert.equal(caught.material.color.getHexString(),row.color.slice(1));assert.equal(caught.geometry,geometry);assert.equal(v.geometries.size,n);}}
 finally{v.dispose();}
});

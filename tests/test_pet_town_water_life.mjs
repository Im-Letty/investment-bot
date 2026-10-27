import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Water from '../static/pet-town-water-life.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function fixture(withJet=true) {
  const fountain=new THREE.Group(),materials=new Set(),geometries=new Set();
  if(withJet){
    const jet=new THREE.Mesh(new THREE.SphereGeometry(1,8,6),new THREE.MeshStandardMaterial({color:'#eef1e7'}));
    jet.name='fountain-top-jet';jet.position.set(0,1.075,0);jet.scale.set(.045,.10,.045);fountain.add(jet);
  }
  const before=fountain.children.length,water=Water.create(THREE,{fountain,materials,geometries});
  return {fountain,materials,geometries,water,before,jet:fountain.getObjectByName('fountain-top-jet')};
}
function rings(f) {return f.water.group.children.filter(x=>x.isMesh);}
function snapshot(f) {return rings(f).map(x=>[...x.position.toArray(),...x.scale.toArray(),x.material.opacity]).concat(f.jet?[f.jet.scale.toArray()]:[]);}

test('UMD registers without browser timers, storage or network dependencies',()=>{
  const context=vm.createContext({});
  vm.runInContext(readFileSync(new URL('../static/pet-town-water-life.js',import.meta.url),'utf8'),context);
  assert.equal(context.PetTownWaterLife.revision,'fountain-water-life1');
  assert.equal(typeof context.PetTownWaterLife.create,'function');
  assert.equal(context.setTimeout,undefined);assert.equal(context.localStorage,undefined);
});

test('missing context fails before allocating or changing a fountain',()=>{
  const fountain=new THREE.Group(),materials=new Set(),geometries=new Set();
  assert.throws(()=>Water.create(THREE,{fountain,materials}),/town_water_context_unavailable/);
  assert.equal(fountain.children.length,0);assert.equal(materials.size,0);assert.equal(geometries.size,0);
});

test('three surface rings share one geometry and register scene-owned transparent resources',()=>{
  const f=fixture(),rows=rings(f);
  assert.equal(f.fountain.children.length,f.before+1);assert.equal(rows.length,3);
  assert.equal(f.materials.size,3);assert.equal(f.geometries.size,1);
  assert.equal(new Set(rows.map(x=>x.geometry)).size,1);assert.equal(new Set(rows.map(x=>x.material)).size,3);
  assert.equal(f.water.addedTriangles,432);assert.equal(f.water.resourceOwner,'scene');
  assert.deepEqual(f.water.dynamicRoots,[f.water.group]);
  assert.equal(f.water.dispose,undefined,'the scene retains the only resource-disposal authority');
  for(const mesh of [...rows,f.jet]){
    assert.equal(mesh.userData.noStaticBatch,true);assert.equal(mesh.userData.nonSolidWater,true);
    assert.equal(mesh.castShadow,false);
  }
  for(const mesh of rows){
    assert.equal(mesh.material.transparent,true);assert.equal(mesh.material.depthWrite,false);
    assert.equal(mesh.material.color.getHexString(),'eff2e9');
    assert.ok(f.materials.has(mesh.material));assert.ok(f.geometries.has(mesh.geometry));
  }
});

test('water visibly changes on elapsed time while bowl parent and existing droplet remain untouched',()=>{
  const fountain=new THREE.Group(),drop=new THREE.Object3D();
  drop.name='existing-falling-droplet';drop.position.set(.315,1.01,.1);fountain.add(drop);
  const baseParent=fountain.matrix.toArray(),baseDrop=drop.position.toArray();
  const water=Water.create(THREE,{fountain,materials:new Set(),geometries:new Set()}),f={water};
  water.animate(0,false);const before=snapshot(f);water.animate(725,false);
  assert.notDeepEqual(snapshot(f),before);
  assert.deepEqual(fountain.matrix.toArray(),baseParent);assert.deepEqual(drop.position.toArray(),baseDrop);
  assert.equal(fountain.children.filter(x=>x.name==='existing-falling-droplet').length,1);
});

test('finite sampled wave poses remain inside both existing elliptical water discs',()=>{
  const f=fixture();
  // Independent limits come from the existing visible fountain's water discs.
  for(let ms=0;ms<=12000;ms+=137){
    f.water.animate(ms,false);f.fountain.updateMatrixWorld(true);
    for(const mesh of rings(f)){
      const upper=mesh.name.includes('-upper-'),rx=upper?.28:.61,rz=rx*.75;
      const box=new THREE.Box3().setFromObject(mesh);
      assert.ok(box.min.x>=-rx&&box.max.x<=rx);assert.ok(box.min.z>=-rz&&box.max.z<=rz);
      assert.ok(box.min.y>(upper?1.001:.475));assert.ok(box.max.y<(upper?1.038:.536));
      assert.ok(mesh.material.opacity>=0&&mesh.material.opacity<=.34);
    }
    const box=new THREE.Box3().setFromObject(f.jet);
    assert.ok(box.min.x>=-.045000001&&box.max.x<=.045000001);
    assert.ok(box.min.z>=-.045000001&&box.max.z<=.045000001);
    assert.ok(box.min.y>=.97499999&&box.max.y<=1.17500001);
  }
});

test('reduced motion restores a stable exact pose after animation, with an unchanged jet envelope',()=>{
  const f=fixture();f.water.animate(0,true);const reduced=snapshot(f);
  f.water.animate(5000,false);assert.notDeepEqual(snapshot(f),reduced);
  for(const ms of [0,500,90000,NaN,Infinity,-40]){
    f.water.animate(ms,true);assert.deepEqual(snapshot(f),reduced);
  }
  assert.deepEqual(f.jet.scale.toArray(),[.045,.10,.045]);
});

test('nonfinite and negative elapsed times yield the defined finite initial pose',()=>{
  const f=fixture();f.water.animate(0,false);const initial=snapshot(f);
  for(const ms of [NaN,Infinity,-1,undefined]){
    f.water.animate(ms,false);assert.deepEqual(snapshot(f),initial);
  }
});

test('resource allocations remain fixed during playback and owner disposal emits once per resource',()=>{
  const f=fixture(),materials=[...f.materials],geometries=[...f.geometries],counts=new Map();
  for(const resource of [...materials,...geometries])resource.addEventListener('dispose',()=>counts.set(resource,(counts.get(resource)||0)+1));
  for(let i=0;i<120;i++)f.water.animate(i*33,false);
  assert.deepEqual([...f.materials],materials);assert.deepEqual([...f.geometries],geometries);assert.equal(counts.size,0);
  for(const resource of [...f.materials,...f.geometries])resource.dispose();
  assert.ok([...materials,...geometries].every(x=>counts.get(x)===1));
});

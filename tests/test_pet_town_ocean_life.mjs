import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Ocean from '../static/pet-town-ocean-life.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const COAST=[[0,2880],[550,2840],[1050,2720],[1450,2510],[1920,1990]];
function fixture(three=THREE) {
  const group=new THREE.Group(),geometries=new Set(),materials=new Set();
  const world={width:2880,height:1920,places:[{id:'home',x:633.6,y:441.6}]};
  const shoreline=COAST.map(x=>x.slice()),before=JSON.stringify({world,shoreline});
  const colliders=[],pickables=[],occluders=[];
  const ocean=Ocean.create(three,{group,world,shoreline,geometries,materials,colliders,pickables,occluders});
  return {group,geometries,materials,world,shoreline,before,ocean,colliders,pickables,occluders};
}
function foam(f){return f.ocean.group.children.filter(x=>x.name.startsWith('incoming-shore-foam-'));}
function glints(f){return f.ocean.group.getObjectByName('ocean-surface-glints');}
function snapshot(f) {
  return {foam:foam(f).map(x=>[...x.position.toArray(),x.material.opacity]),
    glints:Array.from(glints(f).instanceMatrix.array),glintOpacity:glints(f).material.opacity};
}
function edgeAt(y) {
  for(let i=1;i<COAST.length;i++)if(y<=COAST[i][0]){
    const a=COAST[i-1],b=COAST[i];return a[1]+(b[1]-a[1])*(y-a[0])/(b[0]-a[0]);
  }
  return COAST.at(-1)[1];
}
function assertWaterVertex(v) {
  assert.ok(Number.isFinite(v.x)&&Number.isFinite(v.y)&&Number.isFinite(v.z));
  assert.ok(v.x>-24&&v.x<24&&v.z>-24&&v.z<24,'actual vertex remains inside the existing sea');
  assert.ok(v.y>-.05&&v.y<.025,'water detail stays above the sea and below land/bridge');
  const y=v.z*100+960,edge=(edgeAt(y)-1440)/100;
  assert.ok(v.x>edge+.01,'actual vertex stays strictly seaward without an inland clamp');
}
function vertices(f) {
  const out=[],point=new THREE.Vector3(),matrix=new THREE.Matrix4(),combined=new THREE.Matrix4();
  f.group.updateMatrixWorld(true);
  for(const mesh of foam(f)){
    const p=mesh.geometry.attributes.position;
    for(let i=0;i<p.count;i++)out.push(new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld));
    const index=mesh.geometry.index;
    for(let i=0;i<index.count;i+=3){
      const center=new THREE.Vector3();
      for(let k=0;k<3;k++)center.add(point.fromBufferAttribute(p,index.getX(i+k)).applyMatrix4(mesh.matrixWorld));
      out.push(center.multiplyScalar(1/3));
    }
  }
  const g=glints(f),p=g.geometry.attributes.position;
  for(let row=0;row<g.count;row++){
    g.getMatrixAt(row,matrix);combined.multiplyMatrices(g.matrixWorld,matrix);
    for(let i=0;i<p.count;i++){
      const v=new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(combined);out.push(v);
      assert.ok(g.boundingSphere.containsPoint(new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(matrix)),'fixed instance bounds cover the moving glint');
    }
  }
  return out;
}

test('UMD registration has no timer, network, texture or storage dependency',()=>{
  const context=vm.createContext({});
  vm.runInContext(readFileSync(new URL('../static/pet-town-ocean-life.js',import.meta.url),'utf8'),context);
  assert.equal(context.PetTownOceanLife.revision,'ocean-motion1');
  assert.equal(typeof context.PetTownOceanLife.create,'function');
  assert.equal(context.fetch,undefined);assert.equal(context.setInterval,undefined);assert.equal(context.localStorage,undefined);
});

test('invalid coast/world contexts fail before resource allocation or graph changes',()=>{
  for(const settings of [
    {world:{width:2880,height:0},shoreline:COAST},
    {world:{width:2880,height:1920},shoreline:[[0,2880],[550,2840],[550,2720],[1920,1990]]},
    {world:{width:2880,height:1920},shoreline:[[10,2880],[1920,1990]]},
    {world:{width:2880,height:1920},shoreline:[[0,NaN],[1920,1990]]},
    {world:{width:2880,height:1920},shoreline:[[0,2881],[1920,1990]]},
    {world:{width:5000,height:1920},shoreline:[[0,5000],[1920,4900]]},
  ]){
    const group=new THREE.Group(),materials=new Set(),geometries=new Set();
    assert.throws(()=>Ocean.create(THREE,{group,materials,geometries,...settings}),/town_ocean_/);
    assert.equal(group.children.length,0);assert.equal(materials.size,0);assert.equal(geometries.size,0);
  }
});

test('all actual shore bends are included, with three curved ribbons and one instanced glint object',()=>{
  const f=fixture(),rows=foam(f),g=glints(f),p=rows[0].geometry.attributes.position;
  assert.equal(rows.length,3);assert.equal(g.count,12);assert.equal(f.ocean.group.children.length,4);
  assert.equal(new Set(rows.map(x=>x.geometry)).size,1);
  assert.equal(f.geometries.size,2);assert.equal(f.materials.size,4);
  assert.equal(f.ocean.metrics.triangles,186);assert.equal(f.ocean.metrics.drawObjects,4);
  const ys=Array.from({length:p.count},(_,i)=>p.getZ(i)*100+960);
  for(const [y] of COAST)assert.ok(ys.some(v=>Math.abs(v-y)<.001),'each actual coast bend is a geometry row');
  assert.ok(p.count>COAST.length*2,'curved wave detail extends between the actual bends');
});

test('foam visibly approaches the shore and fades, while surface glints vary on the same elapsed clock',()=>{
  const f=fixture(),first=foam(f)[0];f.ocean.animate(0,false);
  const a=snapshot(f),startX=first.position.x;assert.equal(first.material.opacity,0);
  f.ocean.animate(700,false);
  assert.ok(first.position.x<startX);assert.ok(first.material.opacity>0);
  assert.notDeepEqual(snapshot(f),a);
  f.ocean.animate(5900,false);assert.ok(first.material.opacity<.01);
  assert.equal(JSON.stringify({world:f.world,shoreline:f.shoreline}),f.before);
  assert.deepEqual(f.colliders,[]);assert.deepEqual(f.pickables,[]);assert.deepEqual(f.occluders,[]);
});

test('finite sampled poses and triangle interiors stay strictly seaward through every coastal bend',()=>{
  const f=fixture(),times=Array.from({length:88},(_,i)=>i*137).concat([5999,6000,Number.MAX_VALUE]);
  for(const ms of times){
    f.ocean.animate(ms,false);
    for(const v of vertices(f))assertWaterVertex(v);
  }
});

test('reduced motion restores one exact stable pose and avoids repeated instance uploads',()=>{
  const f=fixture();f.ocean.animate(0,true);const initial=snapshot(f);
  f.ocean.animate(1700,false);assert.notDeepEqual(snapshot(f),initial);
  f.ocean.animate(90000,true);assert.deepEqual(snapshot(f),initial);
  const version=glints(f).instanceMatrix.version;
  for(const ms of [0,200,Number.MAX_VALUE,Infinity,NaN,-1]){
    f.ocean.animate(ms,true);assert.deepEqual(snapshot(f),initial);
    assert.equal(glints(f).instanceMatrix.version,version);
  }
});

test('nonfinite/negative times use the defined initial pose and large finite times stay periodic',()=>{
  const f=fixture();f.ocean.animate(0,false);const initial=snapshot(f);
  for(const ms of [undefined,NaN,Infinity,-50]){
    f.ocean.animate(ms,false);assert.deepEqual(snapshot(f),initial);
  }
  f.ocean.animate(Number.MAX_VALUE,false);for(const v of vertices(f))assertWaterVertex(v);
  f.ocean.animate(3500,false);const later=snapshot(f);f.ocean.animate(9500,false);assert.deepEqual(snapshot(f),later);
});

test('fixed allocations and diagnostics are reused during playback',()=>{
  const calls={},tracked={...THREE};
  for(const name of ['Group','BufferGeometry','Float32BufferAttribute','PlaneGeometry','MeshBasicMaterial','Mesh','InstancedMesh','Matrix4','Vector3']){
    const Constructor=THREE[name];tracked[name]=class extends Constructor{constructor(...args){super(...args);calls[name]=(calls[name]||0)+1;}};
  }
  const f=fixture(tracked),before={...calls},materialRefs=[...f.materials],geometryRefs=[...f.geometries];
  const state=f.ocean.animate(0,false);
  for(let i=0;i<180;i++)assert.equal(f.ocean.animate(i*33,false),state,'diagnostic object is reused');
  assert.deepEqual(calls,before);assert.deepEqual([...f.materials],materialRefs);assert.deepEqual([...f.geometries],geometryRefs);
});

test('water z-order and resource ownership preserve scene-controlled disposal',()=>{
  const f=fixture(),counts=new Map();
  assert.equal(f.ocean.resourceOwner,'scene');assert.equal(f.ocean.dispose,undefined);
  assert.deepEqual(f.ocean.dynamicRoots,[f.ocean.group]);
  assert.deepEqual(f.ocean.instanceMeshes,[glints(f)],'scene explicitly owns the instanced-matrix buffer');
  for(const mesh of f.ocean.group.children){
    assert.equal(mesh.renderOrder,-2);assert.equal(mesh.userData.noStaticBatch,true);assert.equal(mesh.userData.nonSolidWater,true);
    assert.equal(mesh.castShadow,false);assert.equal(mesh.receiveShadow,false);
    assert.equal(mesh.material.transparent,true);assert.equal(mesh.material.depthWrite,false);assert.equal(mesh.material.depthTest,true);
    assert.equal(mesh.material.map,null);
  }
  const owned=[...f.materials,...f.geometries,...f.ocean.instanceMeshes];
  for(const resource of owned)resource.addEventListener('dispose',()=>counts.set(resource,(counts.get(resource)||0)+1));
  f.ocean.animate(1000,false);assert.equal(counts.size,0);
  for(const resource of owned)resource.dispose();
  assert.ok(owned.every(r=>counts.get(r)===1));
});

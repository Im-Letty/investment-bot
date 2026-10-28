// Actual-geometry, authored-envelope and resource-ownership regressions.
// These checks do not certify physical body fit or normal-game acquisition.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Meadow from '../static/pet-town-meadow-flowers.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const EPS=2e-6;
function sites(count=12) {
  return Array.from({length:count},(_,i)=>Object.freeze({
    id:'approved-meadow-'+i,x:(i%4)*1.8-2.7,y:.026,z:Math.floor(i/4)*1.8-1.8,seed:i*101+17
  }));
}
function fixture(input=sites(),overrides={}) {
  const group=new THREE.Group(),geometries=new Set(),materials=new Set();
  const ctx={group,sites:input,geometries,materials,
    mat(color){return new THREE.MeshStandardMaterial({color});},...overrides};
  const meadow=Meadow.create(overrides.THREE||THREE,ctx);
  return {group,geometries,materials,ctx,meadow};
}
function vertexRows(geometry) {
  const p=geometry.attributes.position,idx=geometry.index,rows=[];
  for(let i=0;i<(idx?idx.count:p.count);i+=3)rows.push([0,1,2].map(j=>{
    const k=idx?idx.getX(i+j):i+j;
    return new THREE.Vector3(p.getX(k),p.getY(k),p.getZ(k));
  }));
  return rows;
}
function closedPositive(geometry) {
  const edges=new Map();let signed=0,faces=0;
  const key=v=>[v.x,v.y,v.z].map(n=>Math.round(n*1e6)).join(',');
  for(const [a,b,c] of vertexRows(geometry)){
    if(new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).lengthSq()<1e-20)continue;
    assert.ok([...a.toArray(),...b.toArray(),...c.toArray()].every(Number.isFinite));
    signed+=a.dot(new THREE.Vector3().crossVectors(b,c))/6;faces++;
    for(const [u,v] of [[a,b],[b,c],[c,a]]){
      const x=key(u),y=key(v);assert.notEqual(x,y);
      const k=x<y?x+'|'+y:y+'|'+x;edges.set(k,(edges.get(k)||0)+1);
    }
  }
  assert.ok(faces>=8,'actual geometry must contain a nonempty solid');
  for(const count of edges.values())assert.equal(count,2,'every welded nondegenerate edge has two incident faces');
  assert.ok(Number.isFinite(signed)&&signed>1e-7,'outward-wound actual mesh has positive finite enclosed volume');
}
function eachVertex(f,callback) {
  const matrix=new THREE.Matrix4(),point=new THREE.Vector3();
  for(const batch of f.meadow.batches){
    const p=batch.mesh.geometry.attributes.position;
    for(let i=0;i<batch.rows.length;i++){
      batch.mesh.getMatrixAt(i,matrix);
      assert.ok(matrix.elements.every(Number.isFinite));
      for(let k=0;k<p.count;k++){
        point.fromBufferAttribute(p,k).applyMatrix4(matrix);
        callback(point,batch.rows[i].plant,batch.rows[i],batch.mesh);
      }
    }
  }
}
function matrices(f) {return f.meadow.batches.map(b=>Array.from(b.mesh.instanceMatrix.array));}
function cleanup(f) {
  f.meadow.dispose();
  for(const g of f.geometries)g.dispose();
  for(const m of f.materials)m.dispose();
}

test('UMD registers in a timerless empty realm and recipes preserve caller identity and deterministic structure',()=>{
  const realm=vm.createContext({});
  vm.runInContext(readFileSync(new URL('../static/pet-town-meadow-flowers.js',import.meta.url),'utf8'),realm);
  assert.equal(realm.PetTownMeadowFlowers.revision,'meadow-flowers3');
  assert.equal(realm.setTimeout,undefined);assert.equal(realm.localStorage,undefined);
  const input=Object.freeze(sites()),before=JSON.stringify(input);
  const a=input.map(x=>Meadow.recipe(x)),b=input.map(x=>Meadow.recipe({...x}));
  assert.deepEqual(a,b);assert.equal(JSON.stringify(input),before);
  const kinds=new Set(a.flatMap(x=>x.plants.map(p=>p.kind)));
  for(const name of ['daisy','tulip','bell','spike','leaf'])assert.ok(kinds.has(name),name+' fixture is represented');
  assert.ok(new Set(a.map(x=>JSON.stringify(x.plants.map(p=>[p.kind,p.height,p.x,p.z])))).size>4);
});

test('invalid contexts, duplicate site IDs and nonfinite transforms fail before mutating caller resources',()=>{
  for(const input of [[{id:'bad',x:NaN,y:.026,z:0}],[{id:'a',x:0,y:0,z:0},{id:'a',x:1,y:0,z:1}],sites(46)]){
    const group=new THREE.Group(),geometries=new Set(),materials=new Set();
    assert.throws(()=>Meadow.create(THREE,{group,sites:input,geometries,materials,
      mat:()=>new THREE.MeshStandardMaterial()}),/meadow_/);
    assert.equal(group.children.length,0);assert.equal(geometries.size,0);assert.equal(materials.size,0);
  }
  assert.throws(()=>Meadow.create(THREE,{group:new THREE.Group(),sites:[]}),/meadow_context_invalid/);
});

test('shared actual solids are closed outward volumes, while rendered species have distinct silhouettes and visible parts',()=>{
  const f=fixture();
  try{
    for(const geometry of f.geometries){
      closedPositive(geometry);
      const normal=geometry.attributes.normal,position=geometry.attributes.position,samePosition=new Map();
      for(let k=0;k<normal.count;k++){
        const n=new THREE.Vector3().fromBufferAttribute(normal,k);
        assert.ok(n.toArray().every(Number.isFinite));
        assert.ok(Math.abs(n.length()-1)<2e-6,'every stored shading normal is finite and unit length');
        if(geometry.userData.normalPolicy==='analytic-inverse-transpose'){
          const key=[position.getX(k),position.getY(k),position.getZ(k)].map(v=>Math.round(v*1e6)).join(':');
          if(samePosition.has(key))assert.ok(n.distanceTo(samePosition.get(key))<2e-6,'duplicate seam and pole normals agree');
          else samePosition.set(key,n);
        }
      }
      if(geometry.userData.botanicalRole==='closed-padded-midrib-leaf'){
        // Only the padded poles may share an XZ point at different heights.
        // The visible outline is one fine ring, without an extruded side band.
        const outline=new Map();
        for(let k=0;k<position.count;k++){
          const x=position.getX(k),z=position.getZ(k);
          if(Math.hypot(x,z)<1e-6)continue;
          const key=[x,z].map(v=>Math.round(v*1e6)).join(':');
          if(outline.has(key))assert.ok(Math.abs(outline.get(key)-position.getY(k))<2e-6,'leaf outline has no vertical side strip');
          else outline.set(key,position.getY(k));
        }
        assert.ok(outline.size>=24,'leaf outline is sufficiently fine beside the tree artwork');
      }
    }
    const signatures=new Map();
    for(const plant of f.meadow.plants){
      const rows=f.meadow.batches.flatMap(b=>b.rows.filter(r=>r.plant===plant).map(r=>[r,b.mesh.geometry]));
      assert.ok(rows.length>=3);
      const signature=rows.map(([r])=>r.role).sort().join('|');
      if(!signatures.has(plant.kind))signatures.set(plant.kind,signature);
    }
    assert.equal(signatures.size,5);assert.equal(new Set(signatures.values()).size,5);
    for(const batch of f.meadow.batches){
      assert.equal(batch.mesh.userData.noStaticBatch,true);
      assert.equal(batch.mesh.userData.nonSolidDecoration,true);
      assert.equal(batch.mesh.castShadow,false);assert.equal(batch.mesh.receiveShadow,true);
      assert.ok(f.geometries.has(batch.mesh.geometry));assert.ok(f.materials.has(batch.mesh.material));
      assert.equal(batch.mesh.material.map,null);
    }
    assert.equal(f.meadow.group.children.some(x=>x.isLight),false);
  }finally{cleanup(f);}
});

test('rest poses keep actual stem or leaf-only roots on the authored ground with visible volume above it',()=>{
  const f=fixture();
  try{
    f.meadow.animate(0,true);
    const byPlant=new Map(f.meadow.plants.map(p=>[p,{min:Infinity,max:-Infinity}]));
    eachVertex(f,(v,p)=>{const b=byPlant.get(p);b.min=Math.min(b.min,v.y);b.max=Math.max(b.max,v.y);});
    let leafy=0;
    for(const [p,b] of byPlant){
      assert.ok(b.min<=p.base[1]+.003,p.id+' has no visible gap above the ground');
      assert.ok(b.min>=p.base[1]-.025,p.id+' is not hidden substantially beneath the ground');
      assert.ok(b.max>=p.base[1]+.065,p.id+' has visible above-ground volume');
      if(p.kind==='leaf')leafy++;
    }
    assert.ok(leafy>0,'leaf-only case actually checked');
  }finally{cleanup(f);}
});

test('continuous bounded sway moves tips while each authored root pivot and parent transform remain fixed',()=>{
  const f=fixture();
  try{
    const parent=f.group.matrix.toArray(),rest=f.meadow.plants.map(p=>p.restMatrix.toArray());
    const plant=f.meadow.plants.find(p=>p.kind!=='leaf'),tip=new THREE.Vector3(0,plant.height,0);
    const a=tip.clone().applyMatrix4(plant.restMatrix);
    let moved=false,positive=false,negative=false;
    for(let t=0;t<=14000;t+=173){
      f.meadow.animate(t,false);
      for(let i=0;i<f.meadow.plants.length;i++){
        const p=f.meadow.plants[i],e=p.pivotMatrix.elements;
        assert.deepEqual(p.restMatrix.toArray(),rest[i]);
        assert.ok(Math.abs(e[12]-p.base[0])<1e-12&&Math.abs(e[13]-p.base[1])<1e-12&&Math.abs(e[14]-p.base[2])<1e-12);
        assert.ok(Number.isFinite(p.sway)&&Math.abs(p.sway)<=.025+1e-12);
        positive ||= p.sway>.024;negative ||= p.sway<-.024;
      }
      moved ||= tip.clone().applyMatrix4(plant.pivotMatrix).distanceTo(a)>.002;
    }
    assert.ok(moved&&positive&&negative);assert.deepEqual(f.group.matrix.toArray(),parent);
  }finally{cleanup(f);}
});

test('actual instance vertices stay within each safe site envelope and the fixed culling bounds across finite sampled phases',()=>{
  const input=sites(),f=fixture(input),byId=new Map(input.map(s=>[s.id,s]));
  try{
    const phases=[0,117,829,2340,5760,11993,1e8];
    for(const p of f.meadow.plants.slice(0,5)){
      for(const angle of [Math.PI/2,Math.PI*1.5])phases.push(((angle-p.phase+Math.PI*4)%(Math.PI*2))/.85*1000);
    }
    for(const t of phases){
      f.meadow.animate(t,false);
      eachVertex(f,(v,p,row,mesh)=>{
        const site=byId.get(p.siteId);
        assert.ok(Math.hypot(v.x-site.x,v.z-site.z)<=.48+EPS,p.id+' actual radius');
        assert.ok(v.y-site.y<=.50+EPS&&v.y-site.y>=-.025-EPS,p.id+' actual height');
        assert.ok(mesh.boundingBox.containsPoint(v),'fixed Box3 includes all observed vertex positions');
        assert.ok(v.distanceTo(mesh.boundingSphere.center)<=mesh.boundingSphere.radius+EPS,'fixed sphere includes all observed vertices');
      });
    }
  }finally{cleanup(f);}
});

test('invalid and large finite times remain finite and reduced motion restores exactly the same rest matrices',()=>{
  const f=fixture();
  try{
    f.meadow.animate(0,true);const rest=matrices(f);
    for(const t of [1,10000,Number.MAX_VALUE,NaN,Infinity,-Infinity,-1000,undefined]){
      assert.equal(f.meadow.animate(t,false),true);
      assert.ok(f.meadow.plants.every(p=>Number.isFinite(p.sway)&&p.pivotMatrix.elements.every(Number.isFinite)));
      eachVertex(f,v=>assert.ok(v.toArray().every(Number.isFinite)));
      f.meadow.animate(t,true);assert.deepEqual(matrices(f),rest);
      assert.ok(f.meadow.plants.every(p=>p.sway===0));
    }
  }finally{cleanup(f);}
});

test('forty accepted sites use bounded shared resources with stable instance buffers and no frame allocations of geometry/materials',()=>{
  const f=fixture(sites(40));
  try{
    const summary=f.meadow.summary(),geometry=[...f.geometries],materials=[...f.materials];
    const buffers=f.meadow.batches.map(b=>b.mesh.instanceMatrix.array);
    assert.ok(summary.plants>=80&&summary.plants<=200);assert.ok(summary.parts<=2000);
    // This fixed 40-site generic fixture has 122 plants. Actual Town has 107;
    // its independent Scene integration keeps the tighter 45k budget.
    assert.ok(summary.triangles<=52000);assert.ok(summary.batches<=20);
    assert.ok(f.geometries.size<=4&&f.materials.size<=10);
    for(const t of [0,300,6000,Number.MAX_VALUE]){
      f.meadow.animate(t,false);
      assert.deepEqual([...f.geometries],geometry);assert.deepEqual([...f.materials],materials);
      f.meadow.batches.forEach((b,i)=>assert.equal(b.mesh.instanceMatrix.array,buffers[i]));
    }
    assert.equal(summary.geometryMaterialDisposalOwner,'scene');
    assert.equal(summary.instanceBufferDisposalOwner,'meadow-helper');
  }finally{cleanup(f);}
});

test('dispose releases each owned instance buffer once, detaches only its group and leaves Scene resources to their owner',()=>{
  const f=fixture(),sentinel=new THREE.Group();f.group.add(sentinel);
  let buffers=0,geometries=0,materials=0;
  for(const b of f.meadow.batches)b.mesh.addEventListener('dispose',()=>buffers++);
  for(const g of f.geometries)g.addEventListener('dispose',()=>geometries++);
  for(const m of f.materials)m.addEventListener('dispose',()=>materials++);
  assert.equal(f.meadow.dispose(),true);assert.equal(f.meadow.dispose(),false);
  assert.equal(buffers,f.meadow.batches.length);assert.equal(geometries,0);assert.equal(materials,0);
  assert.deepEqual(f.group.children,[sentinel]);assert.equal(f.meadow.animate(77,false),false);
  for(const g of f.geometries)g.dispose();for(const m of f.materials)m.dispose();
  assert.equal(geometries,f.geometries.size);assert.equal(materials,f.materials.size);
});

test('material setup failures leave no attached meadow and keep allocated Scene resources registered without disposing them',()=>{
  for(const invalid of [false,true]){
    const group=new THREE.Group(),geometries=new Set(),materials=new Set();let calls=0,disposed=0;
    assert.throws(()=>Meadow.create(THREE,{group,sites:sites(2),geometries,materials,mat(color){
      if(++calls===4){if(invalid)return null;throw Error('synthetic_material_failure');}
      const m=new THREE.MeshStandardMaterial({color});m.addEventListener('dispose',()=>disposed++);return m;
    }}),invalid?/meadow_material_invalid/:/synthetic_material_failure/);
    assert.equal(group.children.length,0);assert.equal(disposed,0);assert.equal(materials.size,3);
    assert.ok(geometries.size>0);
    for(const g of geometries)g.dispose();for(const m of materials)m.dispose();
  }
});

test('a partial instance-buffer setup failure disposes already-owned buffers and leaves the caller group unchanged',()=>{
  let created=0,disposed=0;
  function FailingMesh(...args){
    if(created===1)throw Error('synthetic_instance_failure');
    const mesh=new THREE.InstancedMesh(...args);created++;
    mesh.addEventListener('dispose',()=>disposed++);return mesh;
  }
  const T={...THREE,InstancedMesh:FailingMesh},group=new THREE.Group(),geometries=new Set(),materials=new Set();
  assert.throws(()=>Meadow.create(T,{group,sites:sites(),geometries,materials,
    mat:color=>new THREE.MeshStandardMaterial({color})}),/synthetic_instance_failure/);
  assert.equal(created,1);assert.equal(disposed,1);assert.equal(group.children.length,0);
  for(const g of geometries)g.dispose();for(const m of materials)m.dispose();
});

test('finite rest-pose representatives have actual common-solid interior witnesses from every leaf and petal to their ground stem',()=>{
  // Five authored specimens only. This is a finite closed-mesh contact witness,
  // not a guarantee about every future recipe, continuous poses or physical fit.
  const f=fixture();
  try{
    const selected=new Map();
    for(const p of f.meadow.plants)if(!selected.has(p.kind))selected.set(p.kind,p);
    assert.equal(selected.size,5);
    const ray=new THREE.Ray(),direction=new THREE.Vector3(1,.347,.129).normalize();
    const local=new THREE.Vector3(),hit=new THREE.Vector3(),closest=new THREE.Vector3();
    function part(row,g){
      const triangles=vertexRows(g).map(v=>new THREE.Triangle(...v)).filter(t=>t.getArea()>1e-12);
      const vertices=[];
      for(let k=0;k<g.attributes.position.count;k++)vertices.push(new THREE.Vector3().fromBufferAttribute(g.attributes.position,k).applyMatrix4(row.localMatrix));
      return {role:row.role,triangles,inverse:row.localMatrix.clone().invert(),
        box:new THREE.Box3().setFromPoints(vertices),minY:Math.min(...vertices.map(v=>v.y)),maxY:Math.max(...vertices.map(v=>v.y))};
    }
    function inside(point,shape){
      local.copy(point).applyMatrix4(shape.inverse);
      ray.origin.copy(local);ray.direction.copy(direction);
      const hits=[];
      for(const triangle of shape.triangles){
        triangle.closestPointToPoint(local,closest);
        if(closest.distanceToSquared(local)<1e-14)return false; // a surface touch is insufficient
        if(ray.intersectTriangle(triangle.a,triangle.b,triangle.c,false,hit)){
          const distance=hit.distanceTo(local);if(distance>1e-7)hits.push(distance);
        }
      }
      hits.sort((a,b)=>a-b);let count=0,last=-Infinity;
      for(const distance of hits)if(distance-last>1e-6){count++;last=distance;}
      return count%2===1;
    }
    function commonPoint(a,b){
      const overlap=a.box.clone().intersect(b.box);if(overlap.isEmpty())return null;
      const point=new THREE.Vector3();
      for(let i=0;i<9;i++)for(let j=0;j<9;j++)for(let k=0;k<9;k++){
        point.set(overlap.min.x+(overlap.max.x-overlap.min.x)*(i+.5)/9,
          overlap.min.y+(overlap.max.y-overlap.min.y)*(j+.5)/9,
          overlap.min.z+(overlap.max.z-overlap.min.z)*(k+.5)/9);
        if(inside(point,a)&&inside(point,b))return point.clone();
      }
      return null;
    }
    for(const [kind,plant] of selected){
      const parts=f.meadow.batches.flatMap(b=>b.rows.filter(r=>r.plant===plant).map(r=>part(r,b.mesh.geometry)));
      const edges=parts.map(()=>[]);
      for(let i=0;i<parts.length;i++)for(let j=i+1;j<parts.length;j++){
        const witness=commonPoint(parts[i],parts[j]);
        if(witness){assert.ok(witness.toArray().every(Number.isFinite));edges[i].push(j);edges[j].push(i);}
      }
      const reached=new Set(),pending=[];
      parts.forEach((p,i)=>{if(p.minY<=.003&&p.maxY>.003){reached.add(i);pending.push(i);}});
      assert.ok(reached.size>0,kind+' actual geometry reaches the authored ground');
      while(pending.length){for(const n of edges[pending.shift()])if(!reached.has(n)){reached.add(n);pending.push(n);}}
      assert.equal(reached.size,parts.length,kind+' all visible parts have a common-interior connection to a grounded part');
      if(kind==='tulip')assert.ok(parts.some(p=>p.role==='tulip-receptacle'),'the authored contact remedy is present');
    }
  }finally{cleanup(f);}
});


test('local seasonal pigments and soft finishes preserve recipes, roots, buffers and every outside material',()=>{
  const input=sites(),recipes=input.map(s=>Meadow.recipe(s)),f=fixture(input);
  const outside=new THREE.MeshStandardMaterial({color:'#abcdef'}),outsideBefore=outside.color.getHexString();
  f.materials.add(outside);
  try{
    const resources=[...f.geometries,...f.materials],buffers=f.meadow.batches.map(b=>b.mesh.instanceMatrix.array);
    const roots=f.meadow.plants.map(p=>p.base.slice()),signatures=new Set();
    for(const season of ['spring','summer','autumn','winter']){
      assert.equal(f.meadow.setSeason({key:season}),true);
      assert.equal(f.meadow.summary().season,season);
      signatures.add(f.meadow.batches.map(b=>b.mesh.material.color.getHexString()).join(':'));
      for(const m of f.meadow.batches.map(b=>b.mesh.material)){
        assert.equal(m.userData.meadowSeason,season);assert.equal(m.userData.seasonRole,undefined);
        assert.equal(m.metalness,0);assert.equal(m.flatShading,false);assert.equal(m.bumpScale,0);
        assert.ok(m.roughness>=.68&&m.roughness<=.83);
      }
      f.meadow.animate(1773,false);
      assert.deepEqual(f.meadow.plants.map(p=>p.base),roots);
      assert.deepEqual(input.map(s=>Meadow.recipe(s)),recipes);
      assert.deepEqual([...f.geometries,...f.materials],resources);
      f.meadow.batches.forEach((b,i)=>assert.equal(b.mesh.instanceMatrix.array,buffers[i]));
      assert.equal(outside.color.getHexString(),outsideBefore);
    }
    assert.equal(signatures.size,4);
    for(const invalid of [null,{},'bad',0,[]])assert.throws(()=>f.meadow.setSeason(invalid),/meadow_season_invalid/);
    f.meadow.dispose();assert.equal(f.meadow.setSeason('summer'),false);
  }finally{cleanup(f);}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Layout from '../static/pet-town-layout-art.js';
import Town from '../static/pet-town-walk.js';
import Scene from '../static/pet-town-scene.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const close=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
function fixture(world=Town.createWorld(),moduleThree=THREE){
 const group=new THREE.Group(),geometries=new Set(),materials=new Set(),cache=new Map(),surfaces=[],occluders=[];
 const boxGeometry=new THREE.BoxGeometry(1,1,1),ballGeometry=new THREE.SphereGeometry(1,16,10);
 geometries.add(boxGeometry);geometries.add(ballGeometry);
 const ctx={group,surfaces,occluders,groundPoint:Scene.groundPoint,townPoint:Scene.townPoint,doorContact:Town.doorContact,
  mat(color,transparent,role){const key=color+':'+role;if(!cache.has(key)){const m=new THREE.MeshStandardMaterial({color,roughness:.8});materials.add(m);cache.set(key,m);}return cache.get(key);},
  mesh(geo,material,parent,x=0,y=0,z=0){geometries.add(geo);const m=new THREE.Mesh(geo,material);m.position.set(x,y,z);parent.add(m);return m;},
  box(parent,w,h,d,material,x,y,z){const m=this.mesh(boxGeometry,material,parent,x,y,z);m.scale.set(w,h,d);return m;},
  ball(parent,material,x,y,z,rx,ry,rz){const m=this.mesh(ballGeometry,material,parent,x,y,z);m.scale.set(rx,ry,rz);return m;}
 };
 ctx.groundMaterial=ctx.mat('#a3bf89',false,'grass');
 ctx.groundMaterial.userData.seasonRole='ground';
 let dead=false;
 function dispose(){if(dead)return;dead=true;for(const g of geometries)g.dispose();for(const m of materials)m.dispose();group.clear();}
 const saved=JSON.stringify(world),out=Layout.build(moduleThree,world,ctx);
 group.updateMatrixWorld(true);assert.equal(JSON.stringify(world),saved);
 return {world,group,ctx,out,geometries,materials,dispose};
}
function rayHeight(objects,x,z){
 const ray=new THREE.Raycaster(new THREE.Vector3(x,5,z),new THREE.Vector3(0,-1,0));
 const hits=ray.intersectObjects(objects,false);assert.ok(hits.length);return hits[0].point.y;
}
test('UMD registers the same bounded API without any DOM or game dependency',()=>{
 const context=vm.createContext({});vm.runInContext(readFileSync(new URL('../static/pet-town-layout-art.js',import.meta.url),'utf8'),context);
 assert.equal(context.PetTownLayoutArt.revision,'layout-art-3d1');
 assert.equal(typeof context.PetTownLayoutArt.build,'function');
 assert.throws(()=>Layout.build(THREE,Town.createWorld(),{}),/layout_art_context_unavailable/);
});
test('actual plaza is a horizontal24%x22% oval at saved48/52 with a shared full paver border',()=>{
 const f=fixture();
 try{
  const {out,world}=f,b=new THREE.Box3().setFromObject(out.plaza,true),at=Scene.groundPoint(world,{x:world.width*.48,y:world.height*.52});
  close((b.min.x+b.max.x)/2,at.x);close((b.min.z+b.max.z)/2,at.z);
  close(b.max.x-b.min.x,world.width*.24/100);close(b.max.z-b.min.z,world.height*.22/100);
  assert.ok(b.min.y>=.0269&&b.max.y<=.0351);
  const pavers=out.plaza.children.filter(o=>o.name==='layout-plaza-border-paver');
  assert.equal(pavers.length,48);assert.equal(new Set(pavers.map(o=>o.geometry)).size,1);
  assert.equal(new Set(pavers.map(o=>o.material)).size,3);
  for(const p of pavers){const box=new THREE.Box3().setFromObject(p,true);assert.ok(box.min.x>=b.min.x-1e-6&&box.max.x<=b.max.x+1e-6);assert.ok(box.min.z>=b.min.z-1e-6&&box.max.z<=b.max.z+1e-6);}
  assert.equal(f.ctx.surfaces.length,1,'decorative floors leave the ground height contract to the existing land');
  close(rayHeight([out.plaza.getObjectByName('layout-plaza-floor')],at.x,at.z),.035);
  const floor=out.plaza.getObjectByName('layout-plaza-floor'),rim=out.plaza.getObjectByName('layout-plaza-border');
  assert.ok(floor.position.y-rim.position.y>=.0079);
  const radius=g=>{const a=g.attributes.position;return [...Array(a.count)].map((_,i)=>Math.hypot(a.getX(i),a.getY(i)));};
  close(Math.max(...radius(floor.geometry)),.90);close(Math.min(...radius(rim.geometry)),.90);
  assert.ok(pavers.every(p=>Math.abs(p.position.y-floor.position.y)<1e-8));
  // Their equal-height floor/paver triangles have disjoint normalized radii.
  const geometry=pavers[0].geometry,position=geometry.attributes.position,index=geometry.index;
  function segmentRadius(i,j){const ax=position.getX(i),ay=position.getY(i),dx=position.getX(j)-ax,dy=position.getY(j)-ay,t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));return Math.hypot(ax+t*dx,ay+t*dy);}
  for(let i=0;i<index.count;i+=3)for(let e=0;e<3;e++)assert.ok(segmentRadius(index.getX(i+e),index.getX(i+(e+1)%3))>.903,'paver triangles do not overlap the cream disk');
 }finally{f.dispose();}
});
test('five continuous curved native lanes meet48/54 and their actual saved entrances without stepping stones',()=>{
 const f=fixture();
 try{
  assert.deepEqual(f.out.junction,{x:1382.3999999999999,y:1036.8000000000002});
  assert.equal(f.out.paths.length,5);assert.ok(!f.out.paths.some(p=>p.placeId==='tree'));
  const joined=Scene.groundPoint(f.world,f.out.junction);
  for(const p of f.out.paths){
   const place=f.world.places.find(row=>row.id===p.placeId),end=Scene.groundPoint(f.world,place.entrance);
   const a=p.curve.getPoint(0),b=p.curve.getPoint(1);close(a.x,joined.x);close(a.z,joined.z);close(b.x,end.x);close(b.z,end.z);
   assert.deepEqual(p.entrance,place.entrance);
   const vertices=p.fill.geometry.attributes.position;
   for(const [row,q] of [[0,a],[vertices.count-2,b]]){close((vertices.getX(row)+vertices.getX(row+1))/2,q.x);close((vertices.getZ(row)+vertices.getZ(row+1))/2,q.z);}
   // Interior rays avoid floating-point misses on the exact terminal triangle edge.
   for(const t of [.0001,.1,.25,.5,.75,.9,.9999]){const q=p.curve.getPoint(t);close(rayHeight([p.fill],q.x,q.z),.033);}
   assert.ok(p.fill.geometry.index.count>200);assert.equal(p.fill.material.color.getHexString(),'e4cfa6');
  }
  assert.ok(!f.group.getObjectByName('rounded-path-stone'));
 }finally{f.dispose();}
});
test('each dark lane edge contains only two side bands without a horizontal color plane under its cream center',()=>{
 const f=fixture();
 try{
  for(const p of f.out.paths){
   const a=p.edge.geometry.attributes.position,index=p.edge.geometry.index,rows=49,bandVertices=rows*2;
   assert.equal(a.count,bandVertices*2);
   for(let i=0;i<a.count;i++){
    const row=Math.floor((i%bandVertices)/2),point=p.curve.getPoint(row/48),tangent=p.curve.getTangent(row/48),n=new THREE.Vector3(-tangent.z,0,tangent.x).normalize();
    const lateral=(a.getX(i)-point.x)*n.x+(a.getZ(i)-point.z)*n.z;
    assert.ok(Math.abs(lateral)>=.455-1e-6&&Math.abs(lateral)<=.515+1e-6);
   }
   for(let i=0;i<index.count;i+=3){const side=[0,1,2].map(j=>index.getX(i+j)<bandVertices);assert.ok(side.every(x=>x===side[0]),'no triangle spans across the cream band');}
   for(const t of [.01,.1,.5,.9,.99]){
    const q=p.curve.getPoint(t),ray=new THREE.Raycaster(new THREE.Vector3(q.x,5,q.z),new THREE.Vector3(0,-1,0));
    assert.equal(ray.intersectObject(p.edge,false).length,0,'dark edges must leave the center empty');
    close(rayHeight([p.fill],q.x,q.z),.033);
   }
  }
 }finally{f.dispose();}
});
test('a real cafe/playground branch crossing always renders cream above the other road grout',()=>{
 const f=fixture();
 try{
  const cafe=f.out.paths.find(p=>p.placeId==='cafe'),other=f.out.paths.find(p=>p.placeId==='playground'),q=cafe.curve.getPoint(.25),t=cafe.curve.getTangent(.25),n=new THREE.Vector3(-t.z,0,t.x).normalize();
  q.addScaledVector(n,.485);
  const p=f.out.plaza.position,radial=Math.pow((q.x-p.x)/f.out.plazaRadii.x,2)+Math.pow((q.z-p.z)/f.out.plazaRadii.z,2);
  assert.ok(radial>1,'the contact witness is outside the plaza, where the branch crossing is visible');
  const ray=new THREE.Raycaster(new THREE.Vector3(q.x,5,q.z),new THREE.Vector3(0,-1,0));
  const dark=ray.intersectObject(cafe.edge,false),cream=ray.intersectObject(other.fill,false);
  assert.ok(dark.length&&cream.length,'two different branch color surfaces really overlap at this point');
  close(dark[0].point.y,.027);close(cream[0].point.y,.033);assert.ok(cream[0].point.y-dark[0].point.y>=.00599);
  assert.equal(ray.intersectObjects([cafe.edge,other.fill],false)[0].object,other.fill);
  const creamBatch=f.out.renderBatches[0].mesh,groutBatch=f.out.renderBatches[1].mesh;
  assert.equal(ray.intersectObjects([groutBatch,creamBatch],false)[0].object,creamBatch);
  const cb=new THREE.Box3().setFromObject(creamBatch,true),gb=new THREE.Box3().setFromObject(groutBatch,true);
  assert.ok(cb.min.y-gb.max.y>=.00599,'every cream surface is separated from all grout');
  assert.ok(cb.max.y-.025<=.010001,'decorative contact remains within one centimeter of existing ground');
 }finally{f.dispose();}
});
test('short native porch connectors close the visible door gap while canonical walk entrances and paths remain exact',()=>{
 const f=fixture();
 try{
  assert.deepEqual(f.out.porchConnectors.map(c=>c.placeId),['home','cafe','shop']);
  for(const c of f.out.porchConnectors){
   const place=f.world.places.find(p=>p.id===c.placeId),canonical=f.out.paths.find(p=>p.placeId===c.placeId);
   assert.deepEqual(c.entrance,place.entrance);assert.deepEqual(canonical.entrance,place.entrance);
   assert.deepEqual(c.porchPoint,Town.doorContact(place));
   const start=Scene.groundPoint(f.world,place.entrance),end=Scene.groundPoint(f.world,c.porchPoint),a=c.curve.getPoint(0),b=c.curve.getPoint(1);
   close(a.x,start.x);close(a.z,start.z);close(b.x,end.x);close(b.z,end.z);
   close(canonical.curve.getPoint(1).x,start.x);close(canonical.curve.getPoint(1).z,start.z);
   const vertices=c.fill.geometry.attributes.position;assert.equal(vertices.count,4);assert.equal(c.fill.geometry.index.count,6);
   close((vertices.getX(2)+vertices.getX(3))/2,end.x);close((vertices.getZ(2)+vertices.getZ(3))/2,end.z);
   const center=c.curve.getPoint(.5);close(rayHeight([c.fill],center.x,center.z),.033);
   assert.equal(c.fill.material,canonical.fill.material);assert.equal(Town.isWalkable(f.world,c.porchPoint.x,c.porchPoint.y),true);
  }
 }finally{f.dispose();}
});
test('saved rearrangements and an added economic facility retain exact door endpoints and input state',()=>{
 const world=Town.createWorld({items:[{id:'home',x:33,y:38},{id:'cafe',x:63,y:54}]});
 world.places.push({id:'economy-tea',entrance:{x:1300,y:580},footprint:{x:1300,y:450,rx:94,ry:68}});
 const saved=JSON.stringify(world),walkSamples=[];
 for(let y=40;y<1920;y+=103)for(let x=40;x<2880;x+=109)walkSamples.push([x,y,Town.isWalkable(world,x,y)]);
 const f=fixture(world);
 try{
  assert.equal(JSON.stringify(world),saved);assert.equal(f.out.paths.length,6);
  for(const p of f.out.paths){const a=p.curve.getPoint(1),b=Scene.groundPoint(world,p.entrance);close(a.x,b.x);close(a.z,b.z);}
  for(const [x,y,walkable] of walkSamples)assert.equal(Town.isWalkable(world,x,y),walkable);
 }finally{f.dispose();}
});
test('a saved entrance exactly at the junction omits only its zero-length lane and keeps finite geometry',()=>{
 const world=Town.createWorld();world.places[0].entrance={x:world.width*.48,y:world.height*.54};
 const f=fixture(world);
 try{
  assert.equal(f.out.paths.length,4);assert.ok(!f.out.paths.some(p=>p.placeId==='home'));
  for(const geo of f.geometries)for(const a of Object.values(geo.attributes))assert.ok([...a.array].every(Number.isFinite));
 }finally{f.dispose();}
});
test('eleven real boards have the exact old3.3x1.8 deck and.19 top across the complete walking corridor',()=>{
 const f=fixture();
 try{
  const deck=f.out.bridgeDeck,b=new THREE.Box3().setFromObject(deck),at=Scene.groundPoint(f.world,{x:2645,y:1160});
  assert.equal(deck.name,'bridge-deck');assert.equal(deck.userData.layoutBoardCount,11);assert.equal(deck.geometry.groups.length,11);
  close(b.max.x-b.min.x,3.3);close(b.max.z-b.min.z,1.8);close(b.max.y,.19);close(b.min.y,.05);
  assert.deepEqual(f.ctx.surfaces,[deck]);
  for(let ix=0;ix<=22;ix++)for(const z of [-.89,-.6,0,.6,.89])close(rayHeight([deck],at.x-1.64+ix*3.28/22,at.z+z),.19);
  for(const x of [2500,2600,2700,2790])for(const y of [1090,1160,1230])assert.equal(Town.isWalkable(f.world,x,y),true);
  assert.equal(Scene.heightAt({x:2645,y:1160}),.19);
 }finally{f.dispose();}
});
test('solid bridge rails, curved side beams and rounded posts stay outside the original1.8-wide clear deck',()=>{
 const f=fixture();
 try{
  const at=Scene.groundPoint(f.world,{x:2645,y:1160});
  assert.equal(f.out.bridgeDetails.length,16);
  assert.equal(f.out.bridgeDetails.filter(m=>m.name==='layout-bridge-arched-side-beam').length,2);
  assert.equal(f.out.bridgeDetails.filter(m=>m.name==='layout-bridge-rounded-post').length,6);
  for(const m of f.out.bridgeDetails){
   const b=new THREE.Box3().setFromObject(m);
   assert.ok(b.max.z<at.z-.9||b.min.z>at.z+.9,m.name+' enters the walk corridor');
   assert.ok(f.ctx.occluders.includes(m));assert.ok(m.castShadow);assert.ok(m.geometry.attributes.position.count>0);
  }
 }finally{f.dispose();}
});
test('all bank stones are water-side over their full bounds and leave the bridge approaches open',()=>{
 const f=fixture();
 const bank=[[0,2880],[550,2840],[1050,2720],[1450,2510],[1920,1990]];
 function bankAt(y){y=Math.max(0,Math.min(1920,y));for(let i=1;i<bank.length;i++)if(y<=bank[i][0]){const a=bank[i-1],b=bank[i];return a[1]+(b[1]-a[1])*(y-a[0])/(b[0]-a[0]);}return 1990;}
 try{
  assert.equal(f.out.bankStones.length,21);
  for(const m of f.out.bankStones){
   const b=new THREE.Box3().setFromObject(m),north=Scene.townPoint(f.world,{x:b.min.x,z:b.min.z}),south=Scene.townPoint(f.world,{x:b.min.x,z:b.max.z});
   assert.ok(north.x>bankAt(north.y)+11.9);assert.ok(south.x>bankAt(south.y)+11.9);
   assert.ok(south.y<1070||north.y>1250,'stone intrudes into bridge width');
   assert.ok(!f.ctx.surfaces.includes(m)&&!f.ctx.occluders.includes(m));
   for(const x of [b.min.x,b.max.x])for(const z of [b.min.z,b.max.z]){const p=Scene.townPoint(f.world,{x,z});assert.equal(Town.isWalkable(f.world,p.x,p.y),false);}
  }
 }finally{f.dispose();}
});
test('fences are wholly beyond the saved map and add neither hidden walking collisions nor surfaces',()=>{
 const f=fixture();
 try{
  assert.equal(f.out.fences.length,4);
  for(const fence of f.out.fences){
   const b=new THREE.Box3().setFromObject(fence),w=f.world.width/200,h=f.world.height/200;
   assert.ok(b.max.x<-w||b.min.x>w||b.max.z<-h||b.min.z>h);
   fence.traverse(m=>{if(m.isMesh){assert.ok(!f.ctx.surfaces.includes(m)&&!f.ctx.occluders.includes(m));assert.equal(m.visible,true);}});
  }
 }finally{f.dispose();}
});
test('north and west aprons visibly support every fence foot with the exact seasonal land material outside saved ground',()=>{
 const f=fixture();
 try{
  const a=f.out.groundAprons,w=f.world.width/200,h=f.world.height/200;
  assert.equal(a.length,2);assert.equal(a[0].geometry,a[1].geometry,'reuse the existing shared box geometry');
  const boxes=a.map(m=>new THREE.Box3().setFromObject(m));
  close(boxes[0].min.x,-w-1.2);close(boxes[0].max.x,-w);close(boxes[0].min.z,-h-1.2);close(boxes[0].max.z,h);
  close(boxes[1].min.x,-w);close(boxes[1].max.x,w);close(boxes[1].min.z,-h-1.2);close(boxes[1].max.z,-h);
  const intersection=boxes[0].clone().intersect(boxes[1]);assert.ok(intersection.isEmpty()||intersection.max.x-intersection.min.x<1e-6,'strips do not overlap over an area');
  for(const [i,m] of a.entries()){
   assert.equal(m.material,f.ctx.groundMaterial);close(boxes[i].max.y,.025);
   assert.ok(boxes[i].max.x<=-w+1e-6||boxes[i].max.z<=-h+1e-6);
   assert.ok(!f.ctx.surfaces.includes(m)&&!f.ctx.occluders.includes(m));
  }
  for(const fence of f.out.fences)fence.traverse(m=>{if(m.name==='layout-fence-rounded-post'){
   const p=m.getWorldPosition(new THREE.Vector3());close(rayHeight(a,p.x,p.z),.025);
   const saved=Scene.townPoint(f.world,{x:p.x,z:p.z});assert.equal(Town.isWalkable(f.world,saved.x,saved.y),false);
  }});
  const seasonalMap=new THREE.Texture();f.ctx.groundMaterial.map=seasonalMap;f.ctx.groundMaterial.color.set('#e4e9e0');f.ctx.groundMaterial.needsUpdate=true;
  for(const m of a){assert.equal(m.material.map,seasonalMap);assert.equal(m.material.color.getHexString(),'e4e9e0');}
  seasonalMap.dispose();assert.deepEqual(f.ctx.surfaces,[f.out.bridgeDeck]);
 }finally{f.dispose();}
});
test('six static render meshes preserve every transformed diagnostic vertex and triangle with all three paver colors',()=>{
 const f=fixture();
 try{
  const batches=f.out.renderBatches;assert.equal(batches.length,6);
  assert.deepEqual(batches.map(b=>b.rows.length),[9,6,48,8,6,7]);
  const seen=new Set();
  for(const b of batches){
   assert.equal(b.mesh.visible,true);assert.ok(b.mesh.userData.layoutStaticBatch);
   const out=b.mesh.geometry.attributes.position,outNormal=b.mesh.geometry.attributes.normal,outUv=b.mesh.geometry.attributes.uv;let vertex=0,triangles=0;
   for(const row of b.rows){
    assert.equal(row.visible,false);assert.ok(row.userData.layoutDiagnosticOnly);assert.ok(!seen.has(row));seen.add(row);
    const input=row.geometry.attributes.position,inputNormal=row.geometry.attributes.normal,inputUv=row.geometry.attributes.uv;triangles+=(row.geometry.index?row.geometry.index.count:input.count)/3;
    for(let i=0;i<input.count;i++,vertex++){
     const a=new THREE.Vector3().fromBufferAttribute(input,i).applyMatrix4(row.matrixWorld),c=new THREE.Vector3().fromBufferAttribute(out,vertex).applyMatrix4(b.mesh.matrixWorld);
     close(a.x,c.x,2e-6);close(a.y,c.y,2e-6);close(a.z,c.z,2e-6);
     const n=new THREE.Vector3().fromBufferAttribute(inputNormal,i).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(row.matrixWorld));
     const mergedNormal=new THREE.Vector3().fromBufferAttribute(outNormal,vertex).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(b.mesh.matrixWorld));
     close(n.x,mergedNormal.x);close(n.y,mergedNormal.y);close(n.z,mergedNormal.z);
     close(outUv.getX(vertex),inputUv?inputUv.getX(i):0);close(outUv.getY(vertex),inputUv?inputUv.getY(i):0);
    }
   }
   assert.equal(vertex,out.count);assert.equal(b.mesh.geometry.index.count/3,triangles);
  }
  assert.equal(seen.size,84);
  assert.ok(batches.slice(3).every(b=>b.mesh.castShadow));
  const pavers=batches[2].mesh;assert.equal(pavers.material.length,3);assert.equal(pavers.geometry.groups.length,3);
  assert.deepEqual(pavers.geometry.groups.map(g=>g.count),[288,288,288]);
  for(const p of f.out.paths)assert.ok(seen.has(p.fill)&&seen.has(p.edge));
 }finally{f.dispose();}
});
test('every allocated resource is reused or released through the existing scene owner exactly once',()=>{
 const allocated=new Map(),instrumented={...THREE};
 for(const type of ['BoxGeometry','BufferGeometry','RingGeometry','CircleGeometry','ExtrudeGeometry']){
  instrumented[type]=class extends THREE[type]{constructor(...args){super(...args);allocated.set(this,0);this.addEventListener('dispose',()=>allocated.set(this,allocated.get(this)+1));}};
 }
 const f=fixture(Town.createWorld(),instrumented),allMaterials=new Set(),incoming=[...f.geometries].filter(g=>!allocated.has(g)),disposed=new Map();
 try{
  assert.ok(allocated.size<=50);assert.ok(f.geometries.size<=50);
  f.group.traverse(m=>{if(!m.isMesh)return;assert.ok(f.geometries.has(m.geometry));for(const mat of Array.isArray(m.material)?m.material:[m.material]){assert.ok(f.materials.has(mat));allMaterials.add(mat);}});
  assert.equal(allMaterials.size,f.materials.size);
  for(const [g,n] of allocated)assert.equal(n,f.geometries.has(g)?0:1,'temporary boards release before shared scene ownership');
  for(const r of [...incoming,...f.materials]){disposed.set(r,0);r.addEventListener('dispose',()=>disposed.set(r,disposed.get(r)+1));}
  assert.equal(f.out.resourceOwnership,'scene-context');assert.equal(f.out.walkSurfacePolicy,'existing-ground-plus-exact-bridge');
 }finally{f.dispose();f.dispose();}
 assert.ok([...allocated.values()].every(n=>n===1));assert.ok([...disposed.values()].every(n=>n===1));
});

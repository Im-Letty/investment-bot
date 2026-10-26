import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const base=process.env.BOTANICAL_BASE_ROOT||fileURLToPath(new URL('../static/',import.meta.url));
const candidate=process.env.BOTANICAL_CANDIDATE_ROOT||base;
const vendor=process.env.BOTANICAL_VENDOR_ROOT||base;
const THREE=await import(pathToFileURL(path.join(vendor,'vendor/three-0.160.1.module.js')));
const requireBase=createRequire(path.join(base,'pet-town-scene.js'));
const Town=requireBase('./pet-town-walk.js');
const Fit=requireBase('./pet-frame-fit.js');
function load(file,require){
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,require});
 return module.exports;
}
const Style=load(path.join(candidate,'pet-town-style.js'));
const Scene=load(path.join(candidate,'pet-town-scene.js'),n=>n==='./pet-town-style.js'?Style:requireBase(n));
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/pet-botanical-envelopes-968f5980.json',import.meta.url)));
const oldLeafProfile=JSON.parse(fs.readFileSync(new URL('./fixtures/pet-botanical-leaf-profile-968f5980.json',import.meta.url)));
function trees(m){const a=[];m.scene.traverse(o=>{if(o.name==='market-style-branching-tree')a.push(o);});return a;}
function box(o,filter){
 const b=new THREE.Box3();o.updateWorldMatrix(true,true);
 o.traverse(x=>{if(x.isMesh&&(!filter||filter(x)))b.union(new THREE.Box3().setFromObject(x,true));});return b;
}
function cost(m){
 let draws=0,triangles=0;m.scene.traverse(o=>{if(!o.isMesh)return;for(let p=o;p;p=p.parent)if(!p.visible)return;
 draws++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);});return{draws,triangles};
}
function geometry(g,maxTriangles){
 const p=g.attributes.position,n=g.attributes.normal,index=g.index,edges=new Map();
 for(const name of ['position','normal','uv'])for(const v of g.attributes[name].array)assert.ok(Number.isFinite(v));
 for(let i=0;i<n.count;i++)assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-5);
 const key=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(x=>Math.round(x*1e5)).join(',');
 const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3(),shade=new THREE.Vector3(),temp=new THREE.Vector3();
 let signedVolume=0;
 for(let k=0;k<index.count;k+=3){
  const ids=[index.getX(k),index.getX(k+1),index.getX(k+2)],keys=ids.map(key);
  if(new Set(keys).size!==3)continue;
  a.fromBufferAttribute(p,ids[0]);b.fromBufferAttribute(p,ids[1]);c.fromBufferAttribute(p,ids[2]);
  signedVolume+=a.dot(temp.crossVectors(b,c))/6;
  normal.crossVectors(b.clone().sub(a),c.clone().sub(a));if(normal.lengthSq()<1e-20)continue;
  normal.normalize();shade.set(0,0,0);for(const id of ids)shade.add(temp.fromBufferAttribute(n,id));shade.normalize();
  assert.ok(normal.dot(shade)>=-1e-6,'actual geometric/shading normal orientation must agree');
  for(let i=0;i<3;i++){const x=keys[i],y=keys[(i+1)%3],name=[x,y].sort().join('/'),e=edges.get(name)||[0,0];e[0]++;e[1]+=x<y?1:-1;edges.set(name,e);}
 }
 assert.ok(signedVolume>0,'closed authored part has positive volume');
 assert.ok(edges.size>0);for(const e of edges.values())assert.deepEqual(e,[2,0],'actual welded boundary closes with opposite edge use');
 assert.ok(index.count/3<=maxTriangles);
}
test('broad pointed leaves and rounded bark remain closed finite volumes with consistent shading normals',()=>{
 for(const [g,max] of [[Style.leafGeometry(THREE),64],[Style.branchGeometry(THREE,'trunk'),180],[Style.branchGeometry(THREE,'branch'),180]]){
  try{geometry(g,max);}finally{g.dispose();}
 }
 const leaf=Style.leafGeometry(THREE);try{assert.equal(leaf.boundingBox.min.y,-1);assert.equal(leaf.boundingBox.max.y,1);
 const size=leaf.boundingBox.getSize(new THREE.Vector3());
 // Exact frozen main geometry supplies the old dimensions. Broad foliage
 // keeps at least90% of that width while remaining thinner and inside it.
 assert.ok(size.x>=oldLeafProfile.size[0]*.9&&size.x<=oldLeafProfile.size[0], 'shop-like broad blade stays within actual old leaf width');
 assert.ok(size.z<oldLeafProfile.size[2], 'soft bowed blade stays thinner than actual old leaf profile');}finally{leaf.dispose();}
});
test('all27 saved tree poses retain exact roots and safe approaches with closed broad rounded dome crowns',()=>{
 const world=Town.createWorld(),saved=JSON.stringify(world),m=Scene.buildWorld(THREE,world,{}),pointedStyle={...Style};delete pointedStyle.roundedLeafGeometry;
 const historical=load(path.join(candidate,'pet-town-scene.js'),n=>n==='./pet-town-style.js'?pointedStyle:requireBase(n)).buildWorld(THREE,world,{});
 try{
 const actual=trees(m);assert.equal(actual.length,27);assert.equal(fixture.trees.length,27);
 const sharedRounded=new Set(),crowns=[],rootMatrices=[];
 for(let i=0;i<actual.length;i++){
  const t=actual[i],before=fixture.trees[i];assert.deepEqual(t.matrixWorld.elements,before.matrix);
  assert.equal(t.userData.artDirection,'rounded-layout-reference');assert.equal(t.userData.leafCount,54);assert.equal(t.userData.twigCount,3);
  const trunk=t.getObjectByName('rounded-tree-trunk'),seed=i===0?.4:(i-1)*2.4,origin=t.getWorldPosition(new THREE.Vector3()),inverse=t.matrixWorld.clone().invert();
  assert.deepEqual(trunk.position.toArray(),[0,0,0]);assert.deepEqual(trunk.scale.toArray(),[.18,1.38,.18]);
  assert.equal(trunk.rotation.x,0);assert.equal(trunk.rotation.y,seed);assert.equal(trunk.rotation.z,0);
  const trunkBounds=new THREE.Box3();
  for(let j=0;j<trunk.geometry.attributes.position.count;j++){
   const worldPoint=new THREE.Vector3().fromBufferAttribute(trunk.geometry.attributes.position,j).applyMatrix4(trunk.matrixWorld),local=worldPoint.clone().applyMatrix4(inverse);
   trunkBounds.expandByPoint(local);assert.ok(Math.abs(local.x)<=.4&&Math.abs(local.z)<=.4,'stout trunk stays inside its fixed normalized radial cap');
   assert.ok(Math.hypot((worldPoint.x-origin.x)/.66,(worldPoint.z-origin.z)/.50)<=1+1e-6,'every actual trunk vertex stays inside the unchanged tree collision ellipse plus player radius');
  }
  assert.ok(Math.abs(trunkBounds.min.y)<1e-6);assert.ok(Math.abs(trunkBounds.max.y-1.38)<1e-6);
  const crown=t.children.find(x=>x.name==='overlapping-leaf-crown');
  const foliage=crown.children.filter(x=>x.name==='rounded-overlapping-tree-leaf');assert.equal(foliage.length,54);
  for(const leaf of foliage){assert.equal(leaf.geometry.userData.styleRole,'closed-plump-rounded-leaf');sharedRounded.add(leaf.geometry);crowns.push(leaf);}
  const roots=t.children.filter(x=>x.name==='plump-flared-tree-root');assert.equal(roots.length,5);rootMatrices.push(roots.map(x=>Array.from(x.matrixWorld.elements)));
  for(const root of roots)assert.ok(box(root).min.y>=t.getWorldPosition(new THREE.Vector3()).y-1e-6,'root volume stays above its fixed ground footpoint');
  const forks=t.children.filter(x=>x.name==='visible-tree-fork');
  assert.equal(forks.length,3);
  const leafBounds=box(crown,x=>x.name==='rounded-overlapping-tree-leaf');
  for(let j=0;j<forks.length;j++){
   const tip=new THREE.Vector3(0,1,0).applyMatrix4(forks[j].matrixWorld);
   assert.ok(leafBounds.containsPoint(tip),'structural fork endpoint stays inside the actual dome leaf envelope; not a leaf surface-contact proof');
  }
  const cores=crown.children.filter(x=>x.name==='hidden-rounded-canopy-heart');assert.equal(cores.length,1);crowns.push(...cores);
  assert.ok(leafBounds.containsBox(box(cores[0])),'the single supporting heart stays inside the individual rounded leaves');
 }
 assert.equal(sharedRounded.size,1);for(const g of sharedRounded)geometry(g,80);
 const doors=model=>{const rows=[];model.scene.traverse(o=>{if(o.userData.door)rows.push([o.userData.placeId,o.name,Array.from(o.matrixWorld.elements)]);});return rows;};
 const oldDoors=doors(historical);assert.ok(oldDoors.length>0);
 for(const ms of [0,1000,3200]){
  m.animate(ms,false);
  for(let i=0;i<actual.length;i++){
   const t=actual[i];assert.deepEqual(t.matrixWorld.elements,fixture.trees[i].matrix,'saved tree root and scale stay exact at every wind pose');
   assert.deepEqual(t.children.filter(x=>x.name==='plump-flared-tree-root').map(x=>Array.from(x.matrixWorld.elements)),rootMatrices[i]);
   const local=box(t.getObjectByName('overlapping-leaf-crown')).applyMatrix4(t.matrixWorld.clone().invert()),size=local.getSize(new THREE.Vector3());
   assert.ok(size.x/size.y>=1.45&&size.z/size.y>=1.30,'real crown vertices retain a broad oval dome at finite wind poses');
   assert.ok(size.x>=1.45&&size.x<=1.9&&size.z>=1.35&&size.z<=1.8&&size.y>=1.0&&size.y<=1.2,'real crown vertex dimensions stay physically bounded');
   assert.ok(local.min.y>=1.04&&local.max.y<=2.2,'canopy stays above its unchanged ground region');
  }
  assert.deepEqual(doors(m),oldDoors,'all facility door-part transforms stay exact');
  for(const p of [...world.places.map(p=>p.entrance),{x:world.width*.48,y:world.height*.54}]){
   assert.ok(Town.isWalkable(world,p.x,p.y));const g=Scene.groundPoint(world,p),ray=new THREE.Raycaster(new THREE.Vector3(g.x,Scene.heightAt(p)+.001,g.z),new THREE.Vector3(0,1,0),0,Fit.worldHeight);
   assert.equal(ray.intersectObjects(crowns,false).length,0,'existing frame head column clears real foliage at saved entrances and junction');
  }
 }
 let restricted=0,samples=0;
 for(const id of ['home','shop','cafe'])for(const yaw of [0,.7,1.4,2.1,2.8,3.5,4.2,4.9,5.6]){
  const p=world.places.find(p=>p.id===id).entrance,g=Scene.groundPoint(world,p),center=new THREE.Vector3(g.x,Scene.heightAt(p)+.8,g.z),v=Scene.safeCamera(THREE,m.occluders,center,{yaw,pitch:Math.PI/6,distance:8});
  assert.ok(v);assert.ok([v.yaw,v.pitch,v.distance].every(Number.isFinite));assert.ok(v.distance>=5.5&&v.distance<=8);
  const direction=new THREE.Vector3(Math.sin(v.yaw)*Math.cos(v.pitch),Math.sin(v.pitch),Math.cos(v.yaw)*Math.cos(v.pitch));
  assert.equal(new THREE.Raycaster(center,direction,.01,v.distance).intersectObjects(m.occluders,false).length,0,'real camera segment clears all solid foliage and buildings');
  if(Math.abs(v.yaw-yaw)>.01||Math.abs(v.pitch-Math.PI/6)>.01||v.distance<7.99)restricted++;samples++;
 }
 assert.equal(samples,27);assert.ok(restricted>=2,'camera samples exercise genuinely blocked requests');assert.equal(JSON.stringify(world),saved);
 }finally{historical.dispose();m.dispose();}
});
test('botanical construction leaves saved world state and established ground/bridge surfaces intact',()=>{
 const w=Town.createWorld(),saved=JSON.stringify(w),m=Scene.buildWorld(THREE,w,{});
 try{assert.equal(JSON.stringify(w),saved);assert.deepEqual(Array.from(m.surfaces,s=>s.name),['dry-land','bridge-deck']);
 const land=m.surfaces[0],bridge=m.surfaces[1];assert.equal(land.position.y,.025);assert.equal(bridge.position.y,.12);
 const bounds=new THREE.Box3().setFromObject(bridge,true),size=bounds.getSize(new THREE.Vector3()),at=Scene.groundPoint(w,{x:2645,y:1160});
 const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
 close(size.x,3.3);close(size.y,.14);close(size.z,1.8);close(bounds.min.y,.05);close(bounds.max.y,.19);
 close(bounds.min.x,at.x-1.65);close(bounds.max.x,at.x+1.65);close(bounds.min.z,at.z-.9);close(bounds.max.z,at.z+.9);
 assert.equal(bridge.userData.layoutBoardCount,11);
 for(let ix=0;ix<=44;ix++)for(let iz=0;iz<=10;iz++){
  const x=at.x-1.649+ix*3.298/44,z=at.z-.899+iz*1.798/10;
  for(const [y,direction,height] of [[5,-1,.19],[-1,1,.05]]){
   const hits=new THREE.Raycaster(new THREE.Vector3(x,y,z),new THREE.Vector3(0,direction,0)).intersectObject(bridge,false);
   assert.ok(hits.length,`real bridge contact ${ix},${iz},${direction}`);close(hits[0].point.y,height);
  }
 }
 }finally{m.dispose();}
});
test('flowers have distinct cupped/open forms, thin shared petals and centres connected to their stems',()=>{
 const m=Scene.buildWorld(THREE,Town.createWorld(),{}),flowers=[];m.scene.traverse(x=>{if(x.name==='botanical-soft-meadow-flower')flowers.push(x);});
 try{assert.ok(flowers.length>10);const counts=new Set(),variants=new Set(),petals=new Set();
 for(const f of flowers){
  counts.add(f.userData.petalCount);variants.add(f.userData.blossomVariant);
  const stem=f.children.find(x=>x.geometry?.type==='CylinderGeometry'),head=f.children.filter(x=>x.name==='thin-botanical-flower-petal');
  assert.ok(stem);assert.equal(head.length,f.userData.petalCount);
  for(const p of head){petals.add(p.geometry);assert.ok(p.scale.y<.035*Math.max(.1,stem.scale.y/.17));}
  const core=f.children.find(x=>x.geometry?.type==='SphereGeometry'&&x.name!=='thin-botanical-flower-petal'&&x.geometry.userData.styleRole!=='closed-pointed-leaf');
  assert.ok(core);assert.ok(core.position.y-core.scale.y<=stem.position.y+stem.scale.y/2,'actual centre ellipsoid overlaps the coaxial closed stem');
 }
 assert.deepEqual([...counts].sort(),[6,7]);assert.equal(variants.size,3);assert.equal(petals.size,1);
 }finally{m.dispose();}
});
test('the finite default world keeps draw/triangle and wind-upload budgets with shared botanical geometry',()=>{
 const m=Scene.buildWorld(THREE,Town.createWorld(),{});try{
 const c=cost(m);assert.ok(c.draws<=fixture.cost.draws*1.1);assert.ok(c.triangles<=fixture.cost.triangles*1.1);
 assert.ok(m.batches.filter(b=>b.dynamic).reduce((n,b)=>n+b.rows.length,0)<=4500);
 for(const role of ['closed-pointed-leaf','curved-tapered-trunk','curved-tapered-branch']){
  const matching=[...m.geometries].filter(g=>g.userData.styleRole===role);assert.equal(matching.length,1,'one shared '+role+' allocation');
 }
 }finally{m.dispose();}
});
test('season switches reuse botanical buffers and the model releases shared resources exactly once',()=>{
 const m=Scene.buildWorld(THREE,Town.createWorld(),{}),g=[...m.geometries],materials=[...m.materials],counts=new Map();
 for(const resource of [...g,...materials]){counts.set(resource,0);resource.addEventListener('dispose',()=>counts.set(resource,counts.get(resource)+1));}
 for(const key of ['spring','summer','autumn','winter']){m.setSeason(key);assert.deepEqual([...m.geometries],g);}
 m.dispose();m.dispose();for(const n of counts.values())assert.equal(n,1);
});

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
test('all27 saved tree poses retain their exact origins and fit old whole, trunk and leaf envelopes',()=>{
 const m=Scene.buildWorld(THREE,Town.createWorld(),{});try{
 const actual=trees(m);assert.equal(actual.length,27);assert.equal(fixture.trees.length,27);
 for(let i=0;i<actual.length;i++){
  const t=actual[i],before=fixture.trees[i];assert.deepEqual(t.matrixWorld.elements,before.matrix);
  assert.equal(t.userData.leafCount,126);assert.equal(t.userData.twigCount,9);
  for(const [key,filter] of [['whole',null],['trunk',x=>x.name==='rounded-tree-trunk'],['leaf',x=>x.name==='small-pointed-tree-leaf']]){
   const old=new THREE.Box3(new THREE.Vector3(...before[key][0]),new THREE.Vector3(...before[key][1])).expandByScalar(1e-4);
   assert.ok(old.containsBox(box(t,filter)),'saved tree'+i+' '+key+' stays inside former precise Mesh bounds');
  }
  const crown=t.children.find(x=>x.name==='overlapping-leaf-crown');
  const foliage=crown.children.filter(x=>x.name==='small-pointed-tree-leaf');
  const forks=t.children.filter(x=>x.name==='visible-tree-fork');
  assert.equal(forks.length,3);
  for(let j=0;j<forks.length;j++){
   const tip=new THREE.Vector3(0,1,0).applyMatrix4(forks[j].matrixWorld),spray=new THREE.Box3();
   for(const leaf of foliage.slice((3+j)*14,(4+j)*14))spray.union(new THREE.Box3().setFromObject(leaf,true));
   assert.ok(spray.containsPoint(tip),'structural fork endpoint stays inside actual middle spray envelope; not a leaf surface-contact proof');
  }
  let cores=0;t.traverse(x=>{if(x.parent?.name==='overlapping-leaf-crown'&&x.geometry?.type==='SphereGeometry'&&x.geometry.userData.styleRole!=='closed-pointed-leaf')cores++;});
  assert.equal(cores,0,'no opaque round canopy core replaces the individual leaves');
 }
 }finally{m.dispose();}
});
test('botanical construction leaves saved world state and established ground/bridge surfaces intact',()=>{
 const w=Town.createWorld(),saved=JSON.stringify(w),m=Scene.buildWorld(THREE,w,{});
 try{assert.equal(JSON.stringify(w),saved);assert.deepEqual(Array.from(m.surfaces,s=>s.name),['dry-land','bridge-deck']);
 const land=m.surfaces[0],bridge=m.surfaces[1];assert.equal(land.position.y,.025);assert.equal(bridge.position.y,.12);
 assert.equal(bridge.geometry.parameters.width,3.3);assert.equal(bridge.geometry.parameters.height,.14);assert.equal(bridge.geometry.parameters.depth,1.8);
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

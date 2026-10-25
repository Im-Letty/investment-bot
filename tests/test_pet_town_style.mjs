import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Style from '../static/pet-town-style.js';
import Scene from '../static/pet-town-scene.js';
import Town from '../static/pet-town-walk.js';
import Seasons from '../static/pet-japan-seasons.js';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function closed(g){
 const p=g.attributes.position,index=g.index,edges=new Map();
 const v=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(n=>Math.round(n*1e5)).join(',');
 const count=index?index.count:p.count;
 for(let t=0;t<count;t+=3){const ids=[0,1,2].map(n=>index?index.getX(t+n):t+n),keys=ids.map(v);if(new Set(keys).size!==3)continue;
  for(let n=0;n<3;n++){const a=keys[n],b=keys[(n+1)%3],key=[a,b].sort().join('/');edges.set(key,(edges.get(key)||0)+1);}
 }
 assert.ok(edges.size>0);assert.ok([...edges.values()].every(n=>n===2),'every welded nondegenerate edge has two faces');
 for(const key of ['position','normal','uv'])for(const n of g.attributes[key].array)assert.ok(Number.isFinite(n),key+' finite');
 const normal=g.attributes.normal;for(let i=0;i<normal.count;i++)assert.ok(Math.abs(Math.hypot(normal.getX(i),normal.getY(i),normal.getZ(i))-1)<1e-5);
 for(const n of g.attributes.uv.array)assert.ok(n>=-1e-6&&n<=1+1e-6);
}
test('pointed foliage is a closed thin bowed volume with finite smooth normals and bounded UVs',()=>{
 const g=Style.leafGeometry(THREE);try{closed(g);assert.equal(g.boundingBox.min.y,-1);assert.equal(g.boundingBox.max.y,1);
  assert.ok(g.boundingBox.max.x-g.boundingBox.min.x<1.5);assert.ok(g.boundingBox.max.z-g.boundingBox.min.z<.3);assert.ok(g.index.count/3<=64);
 }finally{g.dispose();}
});
for(const kind of ['trunk','branch'])test(kind+' is a closed tapered curved mesh with independently capped ends',()=>{
 const g=Style.branchGeometry(THREE,kind);try{closed(g);const p=g.attributes.position,rings=kind==='trunk'?9:5,sides=kind==='trunk'?8:6;
  assert.ok(Math.abs(p.getX(Math.floor(rings/2)*(sides+1)))-1>.1,'the centerline visibly curves');
  assert.ok(g.index.count/3<=180);assert.equal(g.boundingBox.min.y,0);assert.equal(g.boundingBox.max.y,1);
 }finally{g.dispose();}
});
test('scalloped ceramic roof stays inside the same normalized tile envelope and is closed from below',()=>{
 const g=Style.tileGeometry(THREE);try{closed(g);const size=g.boundingBox.getSize(new THREE.Vector3());for(const n of size.toArray())assert.ok(Math.abs(n-2)<1e-5);}finally{g.dispose();}
});
function document(){
 const canvases=[];return{canvases,createElement(){const c={width:0,height:0},ctx={createImageData(w,h){return{data:new Uint8ClampedArray(w*h*4)};},putImageData(image){c.pixels=image.data;},fillRect(){},createRadialGradient(){return{addColorStop(){}};},beginPath(){},ellipse(){},fill(){},fillText(){}};c.getContext=()=>ctx;canvases.push(c);return c;}};
}
test('six neutral microtextures are bounded, deterministic, grayscale and opaque without embedding any source raster',()=>{
 const doc=document(),textures=[];
 try{for(const role of ['wood','bark','plaster','ceramic','foliage','stone']){const a=Style.surfaceTexture(THREE,doc,role),b=Style.surfaceTexture(THREE,doc,role);textures.push(a,b);
  assert.equal(a.image.width,128);assert.equal(a.image.height,128);assert.deepEqual(a.image.pixels,b.image.pixels);
  const colors=new Set();for(let p=0;p<a.image.pixels.length;p+=4){assert.equal(a.image.pixels[p],a.image.pixels[p+1]);assert.equal(a.image.pixels[p],a.image.pixels[p+2]);assert.equal(a.image.pixels[p+3],255);colors.add(a.image.pixels[p]);}assert.ok(colors.size>4);assert.equal(a.colorSpace,THREE.NoColorSpace);
 }}finally{textures.forEach(t=>t.dispose());}
 assert.equal(Style.surfaceTexture(THREE,doc,'water'),null);assert.equal(Style.surfaceTexture(THREE,null,'wood'),null);assert.equal(Object.isFrozen(Style.limits),true);
});
test('a real Town shares at most six surface maps and releases them once while season changes only replace grass',()=>{
 const doc=document(),world=Town.createWorld(),saved=JSON.stringify(world),m=Scene.buildWorld(THREE,world,{},null,doc,'spring'),maps=[...m.textures].filter(t=>t.userData.styleRole),disposed=new Map();
 for(const t of maps){disposed.set(t,0);t.addEventListener('dispose',()=>disposed.set(t,disposed.get(t)+1));}
 assert.equal(maps.length,6);assert.equal(new Set(maps.map(t=>t.userData.styleRole)).size,6);
 const materialMaps=[...m.materials].filter(m=>m.bumpMap).map(m=>m.bumpMap),geo=[...m.geometries];assert.ok(materialMaps.length>6);
 for(const key of ['summer','autumn','winter','spring']){m.setSeason(key);assert.deepEqual([...m.materials].filter(m=>m.bumpMap).map(m=>m.bumpMap),materialMaps);assert.deepEqual([...m.geometries],geo);}
 m.dispose();m.dispose();assert.ok([...disposed.values()].every(n=>n===1));assert.equal(JSON.stringify(world),saved);
});

test('all new tree volumes fit the historical tree envelopes and preserve exact terrain/bridge transforms',()=>{
 const context=vm.createContext({PetTownWalk:Town,PetJapanSeasons:Seasons});vm.runInContext(readFileSync(new URL('../static/pet-town-scene.js',import.meta.url),'utf8'),context);
 const world=Town.createWorld(),saved=JSON.stringify(world),old=context.PetTownScene.buildWorld(THREE,world,{}),now=Scene.buildWorld(THREE,world,{});
 function trees(m){const rows=[];m.scene.traverse(o=>{if(o.name==='rounded-tree-trunk')rows.push(o.parent);});return rows;}
 try{
  const a=trees(old),b=trees(now);assert.equal(a.length,27);assert.equal(b.length,a.length);
  for(let i=0;i<b.length;i++){const before=new THREE.Box3().setFromObject(a[i]).expandByScalar(1e-4),after=new THREE.Box3().setFromObject(b[i]);assert.ok(before.containsBox(after),'tree '+i+' cannot grow into the old route/roof envelope');}
  assert.equal(now.surfaces.length,old.surfaces.length);
  for(let i=0;i<now.surfaces.length;i++){assert.deepEqual(Array.from(now.surfaces[i].geometry.attributes.position.array),Array.from(old.surfaces[i].geometry.attributes.position.array));assert.deepEqual(now.surfaces[i].matrixWorld.elements,old.surfaces[i].matrixWorld.elements);}
  const cost=m=>{let draws=0,triangles=0; m.scene.traverse(o=>{if(!o.isMesh)return;for(let p=o;p;p=p.parent)if(!p.visible)return;draws++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);});return{draws,triangles};};
  const before=cost(old),after=cost(now);assert.ok(after.draws<=before.draws*1.1);assert.ok(after.triangles<=before.triangles*1.1);
  assert.ok(now.batches.filter(b=>b.dynamic).reduce((n,b)=>n+b.rows.length,0)<=4500,'default wind upload count stays explicitly bounded; lower triangles do not prove lower CPU cost');
  assert.equal(JSON.stringify(world),saved);
 }finally{old.dispose();now.dispose();}
});

test('scalloped tile ends point downhill toward each eave while keeping the established tile box',()=>{
 const m=Scene.buildWorld(THREE,Town.createWorld(),{}),tiles=[];m.scene.traverse(o=>{if(o.name==='overlapping-round-roof-tile')tiles.push(o);});
 try{
  assert.ok(tiles.length>60);
  for(const tile of tiles){
   const side=Math.sign(tile.position.x),forward=new THREE.Vector3(0,0,-1).applyQuaternion(tile.quaternion),normal=new THREE.Vector3(0,1,0).applyQuaternion(tile.quaternion);
   assert.ok(Math.abs(forward.z)<1e-8,'scallops must face the roof slope, not run parallel to its ridge');assert.ok(forward.x*side>0);assert.ok(forward.y<0);assert.ok(normal.y>0);
   const angle=Math.atan2(Math.abs(normal.x),normal.y),oldQ=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),-side*angle);
   const oldScale=new THREE.Vector3(tile.scale.z,tile.scale.y,tile.scale.x),matrix=new THREE.Matrix4().compose(tile.position,oldQ,oldScale);matrix.premultiply(tile.parent.matrixWorld);
   const before=tile.geometry.boundingBox.clone().applyMatrix4(matrix),after=new THREE.Box3().setFromObject(tile);
   assert.ok(before.min.distanceTo(after.min)<1e-6);assert.ok(before.max.distanceTo(after.max)<1e-6,'swapping X/Z scale preserves the old normalized box');
  }
 }finally{m.dispose();}
});

test('shared near-white detail maps add only mild albedo shade and share one allocation with height',()=>{
 const doc=document(),m=Scene.buildWorld(THREE,Town.createWorld(),{},null,doc,'summer');
 try{
  const maps=[...m.textures].filter(t=>t.userData.styleRole);assert.equal(maps.length,6);
  for(const map of maps){let sum=0,min=255,max=0;const a=map.image.pixels;for(let i=0;i<a.length;i+=4){sum+=a[i];min=Math.min(min,a[i]);max=Math.max(max,a[i]);}
   assert.ok(min>=220&&max<=255,'linear multiplier stays near white without brightening the authored color');assert.ok(sum/(a.length/4)>238);
  }
  for(const mat of m.materials)if(['wood','bark','plaster','ceramic','stone'].includes(mat.userData.surfaceRole)){
   assert.equal(mat.map,mat.bumpMap);assert.ok(mat.map);assert.equal(mat.color.getHexString(),new THREE.Color(mat.userData.baseColor).getHexString(),'authored palette remains the material color');
  }
 }finally{m.dispose();}
});
test('roof crown is a real convex volume with separate edge shade and a closed underside',()=>{
 const g=Style.tileGeometry(THREE),mat=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),mesh=new THREE.Mesh(g,mat),ray=new THREE.Raycaster();
 try{
  mesh.updateMatrixWorld(true);function top(x,z){ray.set(new THREE.Vector3(x,3,z),new THREE.Vector3(0,-1,0));return ray.intersectObject(mesh,false)[0]?.point.y;}
  const center=top(0,0),edge=top(.8,0);assert.ok(Number.isFinite(center)&&Number.isFinite(edge));assert.ok(center-edge>.25,'cross-section crown must exist in geometry, not only normals');
  assert.ok(center<=1+1e-6&&edge>=-1);closed(g);assert.ok(g.index.count/3<=224,'rounded geometry cannot exceed the former per-tile triangle budget');
 }finally{g.dispose();mat.dispose();}
});

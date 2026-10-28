import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Style from '../static/pet-town-style.js';
import Originals from '../static/pet-town-placement-originals.js';
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
 const g=Style.branchGeometry(THREE,kind);try{
  closed(g);
  // Derive cross-section centroids from actual unique position vertices.
  // This checks the curve without assuming one particular ring/side indexing.
  const p=g.attributes.position,levels=new Map();
  for(let i=0;i<p.count;i++){
   const y=p.getY(i),key=Math.round(y*1e8),row=levels.get(key)||{y,points:new Map()};
   const x=p.getX(i),z=p.getZ(i);row.points.set([x,z].map(n=>Math.round(n*1e6)).join(','),[x,z]);levels.set(key,row);
  }
  const centers=[...levels.values()].sort((a,b)=>a.y-b.y).map(r=>{
   const pts=[...r.points.values()];return{y:r.y,x:pts.reduce((n,p)=>n+p[0],0)/pts.length,z:pts.reduce((n,p)=>n+p[1],0)/pts.length};
  });
  const first=centers[0],last=centers.at(-1);
  assert.ok(centers.length>=5);
  const bend=Math.max(...centers.map(c=>{const t=(c.y-first.y)/(last.y-first.y);return Math.hypot(c.x-first.x-(last.x-first.x)*t,c.z-first.z-(last.z-first.z)*t);}));
  assert.ok(bend>.1,'actual section centroids curve away from the endpoint line');
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
test('a real Town shares bounded surface maps and releases them once while seasons replace grass and sky',()=>{
 const doc=document(),world=Town.createWorld(),saved=JSON.stringify(world),m=Scene.buildWorld(THREE,world,{},null,doc,'spring'),maps=[...m.textures].filter(t=>t.userData.styleRole),disposed=new Map();
 for(const t of maps){disposed.set(t,0);t.addEventListener('dispose',()=>disposed.set(t,disposed.get(t)+1));}
 assert.equal(maps.length,5);assert.deepEqual(maps.map(t=>t.userData.styleRole).sort(),['ceramic','foliage','plaster','stone','wood']);
 const land=m.scene.getObjectByName('dry-land'),nonGroundMaps=()=>[...m.materials].filter(value=>value!==land.material&&value.bumpMap).map(value=>value.bumpMap);
 const materialMaps=nonGroundMaps(),geo=[...m.geometries];assert.ok(materialMaps.length>6);
 for(const key of ['summer','autumn','winter','spring']){
  const previousGrass=land.material.map;let grassDisposals=0;previousGrass.addEventListener('dispose',()=>grassDisposals++);
  m.setSeason(key);assert.notEqual(land.material.map,previousGrass);assert.equal(land.material.bumpMap,land.material.map);assert.equal(land.material.bumpScale,.012);assert.equal(grassDisposals,1);
  assert.deepEqual(nonGroundMaps(),materialMaps);assert.deepEqual([...m.geometries],geo);
 }
 m.dispose();m.dispose();assert.ok([...disposed.values()].every(n=>n===1));assert.equal(JSON.stringify(world),saved);
});

test('original 2D tree artwork preserves saved roots, doors, camera clearance and exact terrain/bridge transforms',()=>{
 const context=vm.createContext({PetTownWalk:Town,PetJapanSeasons:Seasons});vm.runInContext(readFileSync(new URL('../static/pet-town-scene.js',import.meta.url),'utf8'),context);
 const world=Town.createWorld(),saved=JSON.stringify(world),old=context.PetTownScene.buildWorld(THREE,world,{}),now=Scene.buildWorld(THREE,world,{});
 function oldTrees(m){const rows=[];m.scene.traverse(o=>{if(o.name==='rounded-tree-trunk')rows.push(o.parent);});return rows;}
 function originalTrees(m){const rows=[];m.scene.traverse(o=>{if(o.isGroup&&o.name==='placement-original-tree')rows.push(o);});return rows;}
 try{
  const a=oldTrees(old),b=originalTrees(now);assert.equal(a.length,27);assert.equal(b.length,a.length);
  for(let i=0;i<b.length;i++){
   const root=b[i],scale=i===0?1.08:.75+((i-1)*7%9)*.055;
   // Artwork width is independent of the unchanged world/collision placement.
   // These camera-facing sprites are explicitly not closed volume tree models.
   assert.deepEqual(root.matrixWorld.elements,a[i].matrixWorld.elements,'tree '+i+' saved root matrix');
   assert.deepEqual(root.parent.matrixWorld.elements,a[i].matrixWorld.elements,'tree '+i+' outer placement matrix');
   assert.ok(root.getWorldPosition(new THREE.Vector3()).distanceTo(a[i].getWorldPosition(new THREE.Vector3()))<1e-12,'tree '+i+' footpoint');
   assert.equal(root.children.length,1);const sprite=root.children[0],spec=Originals.resolve(sprite.userData.originalArtKind);assert.ok(sprite.isSprite);assert.equal(sprite.isMesh,undefined);
   assert.equal(sprite.userData.originalArt,true);assert.equal(sprite.userData.collisionIndependent,true);
   assert.equal(sprite.userData.artRepresentation,'original-2d-in-world-space');
   assert.equal(sprite.userData.sourceUrl,spec.url);assert.equal(sprite.userData.sourceSHA256,spec.sha256);
   assert.deepEqual(sprite.position.toArray(),[0,0,0]);
   assert.ok(Math.abs(sprite.scale.x-3.25*scale)<1e-12);
   assert.ok(Math.abs(sprite.scale.y-sprite.scale.x*spec.height/spec.width)<1e-12);
   assert.equal(sprite.center.x,spec.groundAnchor?spec.groundAnchor[0]:(spec.alphaBounds[0]+spec.alphaBounds[2])/(2*spec.width));
   assert.equal(sprite.center.y,spec.groundAnchor?1-spec.groundAnchor[1]:1-spec.alphaBounds[3]/spec.height);
   assert.equal(root.getObjectByName('overlapping-leaf-crown'),undefined);
   assert.equal(root.getObjectByName('rounded-tree-trunk'),undefined);
  }
  assert.deepEqual(Array.from(now.placeGroups,g=>[g.userData.placeId,g.matrixWorld.elements]),Array.from(old.placeGroups,g=>[g.userData.placeId,g.matrixWorld.elements]));
  function doors(model){
   const rows=new Map(),counts=new Map();model.scene.traverse(o=>{if(!o.userData.door||o.userData.originalArt)return;const label=o.userData.placeId+':'+o.name,n=counts.get(label)||0;counts.set(label,n+1);rows.set(label+':'+n,Array.from(o.matrixWorld.elements));});return rows;
  }
  const oldDoors=doors(old),newDoors=doors(now);assert.ok(oldDoors.size>0);assert.deepEqual(newDoors,oldDoors,'all facility door-part world transforms stay exact');
  const facilities=['home','shop','cafe'].map(id=>world.places.find(p=>p.id===id)),treePlace=world.places.find(p=>p.id==='tree');
  const poses=facilities.flatMap(p=>[p.entrance,{x:p.entrance.x,y:p.entrance.y+70}]).concat([-100,0,100].map(dx=>({x:treePlace.entrance.x+dx,y:treePlace.entrance.y+35})));
  let blocked=0,adjusted=0,samples=0;
  for(const point of poses){
   assert.ok(Town.isWalkable(world,point.x,point.y),'camera sample remains on a real walking approach');
   const at=Scene.groundPoint(world,point),center=new THREE.Vector3(at.x,Scene.heightAt(point)+.8,at.z);
   for(const yaw of [0,2*Math.PI/3,4*Math.PI/3,Math.PI]){
    const requested={yaw,pitch:Math.PI/6,distance:8},direction=view=>new THREE.Vector3(Math.sin(view.yaw)*Math.cos(view.pitch),Math.sin(view.pitch),Math.cos(view.yaw)*Math.cos(view.pitch));
    if(new THREE.Raycaster(center,direction(requested),.01,8).intersectObjects(now.occluders,false).length)blocked++;
    const safe=Scene.safeCamera(THREE,now.occluders,center,requested);assert.ok(safe,'bounded camera pose '+samples);
    assert.ok([safe.yaw,safe.pitch,safe.distance].every(Number.isFinite));assert.ok(safe.distance>=5.5&&safe.distance<=8);assert.ok(safe.pitch>=requested.pitch&&safe.pitch<=56*Math.PI/180);
    assert.equal(new THREE.Raycaster(center,direction(safe),.01,safe.distance).intersectObjects(now.occluders,false).length,0,'actual camera segment clears all solid foliage and buildings');
    if(Math.abs(safe.yaw-yaw)>.01||Math.abs(safe.pitch-requested.pitch)>.01||safe.distance<7.99)adjusted++;samples++;
   }
  }
  assert.equal(samples,36);assert.ok(blocked>0&&adjusted>0,'camera witnesses exercise retained solid building proxies');
  assert.equal(now.surfaces.length,old.surfaces.length);
  for(let i=0;i<now.surfaces.length;i++){
   const current=now.surfaces[i],historical=old.surfaces[i];
   assert.deepEqual(current.matrixWorld.elements,historical.matrixWorld.elements);
   if(historical.name!=='bridge-deck'){
    assert.deepEqual(Array.from(current.geometry.attributes.position.array),Array.from(historical.geometry.attributes.position.array));
    continue;
   }
   assert.equal(current.name,'bridge-deck');assert.equal(current.userData.layoutBoardCount,11);
   const before=new THREE.Box3().setFromObject(historical),after=new THREE.Box3().setFromObject(current);
   const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
   for(const end of ['min','max'])for(const axis of ['x','y','z'])close(after[end][axis],before[end][axis]);
   close(after.max.x-after.min.x,3.3);close(after.max.z-after.min.z,1.8);close(after.max.y,.19);close(after.min.y,.05);
   // Geometry now contains eleven real boards. Compare their actual walk/contact
   // surfaces with the old box throughout the same full-width bridge corridor.
   for(let ix=0;ix<=44;ix++)for(let iz=0;iz<=10;iz++){
    const x=before.min.x+.001+ix*(3.3-.002)/44,z=before.min.z+.001+iz*(1.8-.002)/10;
    for(const [y,direction,height] of [[5,-1,.19],[-1,1,.05]]){
     const ray=new THREE.Raycaster(new THREE.Vector3(x,y,z),new THREE.Vector3(0,direction,0));
     const oldHits=ray.intersectObject(historical,false),newHits=ray.intersectObject(current,false);
     assert.ok(oldHits.length&&newHits.length,`bridge contact witness ${ix},${iz},${direction}`);
     close(newHits[0].point.y,oldHits[0].point.y);close(newHits[0].point.y,height);
    }
   }
  }
  const cost=m=>{let draws=0,triangles=0; m.scene.traverse(o=>{
   const pendingOriginal=o.isSprite&&o.userData.originalArt;if(!o.isMesh&&!pendingOriginal)return;
   // Count original-art quads even before preload makes them visible, so a
   // hidden pending bitmap cannot artificially lower the final draw budget.
   for(let p=pendingOriginal?o.parent:o;p;p=p.parent)if(!p.visible)return;
   draws++;triangles+=pendingOriginal?2:(o.geometry.index?.count||o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);
  });return{draws,triangles};};
  const before=cost(old),after=cost(now);assert.ok(after.draws<=before.draws*1.1,`draw budget: ${after.draws} <= ${before.draws} * 1.1`);assert.ok(after.triangles<=before.triangles*1.1,`triangle budget: ${after.triangles} <= ${before.triangles} * 1.1`);
  const windUploads=now.batches.filter(b=>b.dynamic).reduce((n,b)=>n+b.rows.length,0);
  assert.ok(windUploads<=4500,`default wind upload count ${windUploads} stays <= 4500; lower triangles do not prove lower CPU cost`);
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
  const maps=[...m.textures].filter(t=>t.userData.styleRole);assert.equal(maps.length,5);assert.deepEqual(maps.map(t=>t.userData.styleRole).sort(),['ceramic','foliage','plaster','stone','wood']);
  for(const map of maps){let sum=0,min=255,max=0;const a=map.image.pixels;for(let i=0;i<a.length;i+=4){sum+=a[i];min=Math.min(min,a[i]);max=Math.max(max,a[i]);}
   assert.ok(min>=220&&max<=255,'linear multiplier stays near white without brightening the authored color');assert.ok(sum/(a.length/4)>238);
  }
  for(const mat of m.materials)if(['wood','bark','plaster','ceramic','stone'].includes(mat.userData.surfaceRole)){
   assert.equal(mat.map,mat.bumpMap);assert.ok(mat.map);assert.equal(mat.color.getHexString(),new THREE.Color(mat.userData.paletteColor||mat.userData.baseColor).getHexString(),'resolved palette remains the material color');assert.equal(mat.userData.paletteColor,Style.paletteColor(mat.userData.baseColor,mat.userData.paletteRole||mat.userData.surfaceRole),'role is mapped once, while the original pigment metadata is retained');
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

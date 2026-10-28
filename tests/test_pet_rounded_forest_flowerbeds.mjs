import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Scene from '../static/pet-town-scene.js';
import Style from '../static/pet-town-style.js';
import Town from '../static/pet-town-walk.js';
import Fit from '../static/pet-frame-fit.js';
import Fishing from '../static/pet-river-fishing.js';
import Seasons from '../static/pet-japan-seasons.js';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

function closed(g) {
  const p=g.attributes.position,ix=g.index,edges=new Map(),count=ix?ix.count:p.count;
  const vertex=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e5)).join(',');
  for(let t=0;t<count;t+=3) {
    const ids=[0,1,2].map(n=>ix?ix.getX(t+n):t+n),keys=ids.map(vertex);
    if(new Set(keys).size!==3)continue;
    for(let n=0;n<3;n++){const k=[keys[n],keys[(n+1)%3]].sort().join('/');edges.set(k,(edges.get(k)||0)+1);}
  }
  assert.ok(edges.size>0);assert.ok([...edges.values()].every(n=>n===2),'each welded edge has two faces');
  for(const key of ['position','normal','uv'])for(const n of g.attributes[key].array)assert.ok(Number.isFinite(n));
  const n=g.attributes.normal;for(let i=0;i<n.count;i++)assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-5);
}
function legacyNativeScene(pointed=false) {
  // These historical native recipes remain available to isolated synchronous
  // previews. The normal game now uses original tree/bed art plus meadow v2;
  // those paths have their own current integration and original-art tests.
  const oldStyle={...Style};if(pointed)delete oldStyle.roundedLeafGeometry;
  const c={PetTownWalk:Town,PetFrameFit:Fit,PetRiverFishing:Fishing,PetJapanSeasons:Seasons,PetTownStyle:oldStyle};c.window=c;
  vm.runInNewContext(readFileSync(new URL('../static/pet-town-scene.js',import.meta.url),'utf8'),c);
  return c.PetTownScene;
}
const nativeFallback=legacyNativeScene();
function treeGroups(model) {const rows=[];model.scene.traverse(o=>{if(o.name==='rounded-tree-trunk')rows.push(o.parent);});return rows;}
function eachLocalVertex(root,visit) {
  root.updateWorldMatrix(true,true);const inverse=root.matrixWorld.clone().invert();
  root.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++)visit(new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld).applyMatrix4(inverse),o);});
}

test('rounded crown leaves are a separately authored closed padded volume and retain the earlier pointed recipe',()=>{
  const g=Style.roundedLeafGeometry(THREE),old=Style.leafGeometry(THREE),material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(g,material);
  try {
    closed(g);closed(old);assert.equal(g.userData.styleRole,'closed-plump-rounded-leaf');assert.equal(old.userData.styleRole,'closed-pointed-leaf');
    const size=g.boundingBox.getSize(new THREE.Vector3());assert.ok(size.x>1.5&&size.z>.35&&size.y>1.6&&size.y<1.7);assert.ok(size.x/size.y>.9,'the broad padded leaf is nearly round, not an upright narrow blade');assert.ok(g.index.count/3<=80);
    mesh.updateMatrixWorld(true);
    for(const axis of ['x','y','z'])for(const sign of [-1,1]){
      const from=new THREE.Vector3(.02,.03,.01),direction=new THREE.Vector3();from[axis]=sign*3;direction[axis]=-sign;
      const ray=new THREE.Raycaster(from,direction);
      assert.ok(ray.intersectObject(mesh,false).length>0,'actual geometry has a face from '+axis+sign);
    }
  } finally {g.dispose();old.dispose();material.dispose();}
});

test('legacy native fallback keeps all 27 rounded crowns and finite wind poses while saved roots and doors stay fixed',()=>{
  const world=Town.createWorld(),saved=JSON.stringify(world),before=legacyNativeScene(true).buildWorld(THREE,world,{}),after=nativeFallback.buildWorld(THREE,world,{});
  try {
    const old=treeGroups(before),now=treeGroups(after);assert.equal(old.length,27);assert.equal(now.length,27);
    for(const ms of [0,1000,3200]){
      before.animate(ms,false);after.animate(ms,false);
      for(let i=0;i<now.length;i++){
        assert.deepEqual(now[i].matrixWorld.elements,old[i].matrixWorld.elements,'saved footpoint and authored tree scale stay fixed');
        const crown=now[i].getObjectByName('overlapping-leaf-crown'),box=new THREE.Box3();
        eachLocalVertex(now[i],(p,o)=>{for(let at=o;at&&at!==now[i];at=at.parent)if(at===crown){box.expandByPoint(p);break;}});
        const size=box.getSize(new THREE.Vector3());
        assert.ok(size.x/size.y>=1.45&&size.z/size.y>=1.30,'tree '+i+' at '+ms+' has a broad oval dome with real depth, not a vertical cone');
        assert.ok(size.x>=1.45&&size.x<=1.9&&size.z>=1.35&&size.z<=1.8&&size.y>=1.0&&size.y<=1.2,'bounded real crown vertices, rather than loose rotated-box corners');
        assert.ok(box.min.y>=1.04&&box.max.y<=2.2,'canopy remains above its fixed root region');
      }
    }
    for(const tree of now){
      const leaves=[];tree.traverse(o=>{if(o.name==='rounded-overlapping-tree-leaf')leaves.push(o);});
      assert.equal(tree.userData.artDirection,'rounded-layout-reference');assert.equal(leaves.length,54);assert.equal(tree.userData.leafCount,54);
      assert.deepEqual([...new Set(leaves.map(o=>o.userData.tier))],[0,1,2,3,4,5]);
      assert.equal(tree.children.filter(o=>o.name==='plump-flared-tree-root').length,5);
      assert.ok(leaves.every(o=>o.geometry.userData.styleRole==='closed-plump-rounded-leaf'));
    }
    const doors=m=>{const rows=[];m.scene.traverse(o=>{if(o.userData.door)rows.push({name:o.name,matrix:o.matrixWorld.elements.slice()});});return rows;};
    assert.deepEqual(doors(after),doors(before),'building doorway geometry transforms do not follow the new crowns');
    assert.equal(JSON.stringify(world),saved);
  } finally {before.dispose();after.dispose();}
});

test('current layout reference SHA metadata is immutable and leaves the historical market reference intact',()=>{
  assert.equal(Object.isFrozen(Style.layoutReferences),true);assert.equal(Style.collection.references.tree,'60cb702d2cac8ad22b09ad01621f55d24ddb4d3876f1f550f21cbfcdbaf8c7b9');
  for(const [name,file] of [['tree','tree-v2.webp'],['flowerbed','flowerbed-v2.webp'],['terrain','terrain-v2.webp']]){
    const digest=createHash('sha256').update(readFileSync(new URL('../static/pet-village-art/'+file,import.meta.url))).digest('hex');assert.equal(Style.layoutReferences[name],digest);
  }
});

test('legacy native fallback has clear existing-frame approach columns at all six entrances and the central junction',()=>{
  const world=Town.createWorld(),m=nativeFallback.buildWorld(THREE,world,{}),crowns=[];
  try {
    m.animate(1400,false);
    for(const tree of treeGroups(m))tree.getObjectByName('overlapping-leaf-crown').traverse(o=>{if(o.isMesh)crowns.push(o);});
    for(const p of [...world.places.map(p=>p.entrance),{x:world.width*.48,y:world.height*.54}]){
      assert.equal(Town.isWalkable(world,p.x,p.y),true);const g=Scene.groundPoint(world,p);
      const ray=new THREE.Raycaster(new THREE.Vector3(g.x,Scene.heightAt(p)+.001,g.z),new THREE.Vector3(0,1,0),0,Fit.worldHeight);
      assert.equal(ray.intersectObjects(crowns,false).length,0,'no new crown intrudes into this existing-frame approach column');
    }
  } finally {m.dispose();}
});

test('legacy native fallback retains its mixed bed inside the unchanged collision ellipse',()=>{
  const world=Town.createWorld(),saved=JSON.stringify(world),m=nativeFallback.buildWorld(THREE,world,{}),place=world.places.find(p=>p.id==='flowers'),bed=m.placeGroups.find(p=>p.userData.placeId==='flowers');
  try {
    assert.ok(bed.getObjectByName('mixed-planted-flowerbed'));assert.equal(bed.getObjectByName('rounded-ivory-tulip-pot'),undefined);
    let tulips=0,cream=0,rocks=0,leafShapes=new Set(),maxEllipse=0;
    bed.traverse(o=>{if(o.name==='planted-pink-tulip')tulips++;if(o.name==='botanical-soft-meadow-flower')cream++;if(o.name==='flowerbed-rounded-stone')rocks++;if(o.name==='plump-ground-leaf')leafShapes.add(o.geometry);});
    eachLocalVertex(bed,(p,o)=>{maxEllipse=Math.max(maxEllipse,Math.hypot(p.x/(place.footprint.rx/100),p.z/(place.footprint.ry/100)));assert.notEqual(o.geometry.type,'PlaneGeometry');});
    assert.equal(tulips,3);assert.equal(cream,5);assert.equal(rocks,3);assert.equal(leafShapes.size,1);assert.ok(maxEllipse<=1,'actual vertices stay within the old ellipse');
    assert.equal(JSON.stringify(world),saved);
  } finally {m.dispose();}
});

test('legacy native fallback retains bounded meadow clusters and the 27 existing tree positions',()=>{
  const world=Town.createWorld(),m=nativeFallback.buildWorld(THREE,world,{});try{
    const clusters=[];m.scene.traverse(o=>{if(o.name==='clustered-meadow-flowerbed')clusters.push(o);});
    assert.ok(clusters.length>=6&&clusters.length<=13);assert.equal(treeGroups(m).length,27);
    for(const bed of clusters){const p=Scene.townPoint(world,bed.position);assert.ok(Town.isWalkable(world,p.x,p.y));assert.ok(world.places.every(place=>Math.hypot(place.x-p.x,place.y-p.y)>=155));assert.ok(bed.getObjectByName('planted-pink-tulip'));}
  } finally {m.dispose();}
});

test('legacy native planting keeps finite clear camera segments for sampled approaches and orbit angles',()=>{
  const world=Town.createWorld(),m=nativeFallback.buildWorld(THREE,world,{});let restricted=0,samples=0;
  try{
    m.animate(1400,false);
    for(const id of ['home','shop','cafe'])for(const yaw of [0,.7,1.4,2.1,2.8,3.5,4.2,4.9,5.6]){
      const p=world.places.find(p=>p.id===id).entrance,g=Scene.groundPoint(world,p),center=new THREE.Vector3(g.x,Scene.heightAt(p)+.8,g.z);
      const v=Scene.safeCamera(THREE,m.occluders,center,{yaw,pitch:Math.PI/6,distance:8});assert.ok(v);assert.ok(v.distance>=5.5);
      const direction=new THREE.Vector3(Math.sin(v.yaw)*Math.cos(v.pitch),Math.sin(v.pitch),Math.cos(v.yaw)*Math.cos(v.pitch));
      const ray=new THREE.Raycaster(center,direction,.01,v.distance),hits=ray.intersectObjects(m.occluders,false);assert.equal(hits.length,0,'rendered camera stops before actual geometry');
      if(Math.abs(v.yaw-yaw)>.01||Math.abs(v.pitch-Math.PI/6)>.01||v.distance<7.99)restricted++;samples++;
    }
    assert.equal(samples,27);assert.ok(restricted>=2,'the finite sample includes genuinely blocked requests');
  } finally {m.dispose();}
});

test('legacy native rounded-leaf shadows, seasons and one-time disposal remain intact',()=>{
  const world=Town.createWorld(),saved=JSON.stringify(world),m=nativeFallback.buildWorld(THREE,world,{}),counts=new Map();
  const rounded=[...m.geometries].filter(g=>g.userData.styleRole==='closed-plump-rounded-leaf');assert.equal(rounded.length,1);
  const smooth=[...m.materials].filter(m=>m.userData.normalPolicy==='smooth-analytic-rounded-volume');assert.equal(smooth.length,5);
  for(const material of smooth){assert.equal(material.bumpMap,null);assert.equal(material.bumpScale,0);assert.equal(material.flatShading,false);assert.equal(material.userData.seasonRole,'foliage');}
  const leafMeshes=[];m.scene.traverse(o=>{if(o.isMesh&&o.geometry.userData.styleRole==='closed-plump-rounded-leaf')leafMeshes.push(o);});
  assert.ok(leafMeshes.length>100);assert.ok(leafMeshes.some(o=>o.isInstancedMesh));assert.ok(leafMeshes.every(o=>o.receiveShadow===false));
  const placedTree=m.placeGroups.find(g=>g.userData.placeId==='tree'),castLeaves=[];placedTree.traverse(o=>{if(o.name==='rounded-overlapping-tree-leaf')castLeaves.push(o);});
  assert.equal(castLeaves.length,54);assert.ok(castLeaves.every(o=>o.castShadow===true),'the selected tree still casts its real silhouette');
  assert.ok(leafMeshes.some(o=>o.isInstancedMesh&&o.castShadow),'casting remains enabled through batching');
  assert.equal(m.scene.getObjectByName('dry-land').receiveShadow,true);assert.equal(m.scene.getObjectByName('bridge-deck').receiveShadow,true);
  const house=m.placeGroups.find(g=>g.userData.placeId==='home'),houseReceivers=[],windowNonReceivers=[];house.traverse(o=>{if(!o.isMesh)return;if(o.userData.nonSolidWindow)windowNonReceivers.push(o);else if(o.geometry.userData.styleRole!=='closed-plump-rounded-leaf')houseReceivers.push(o);});assert.ok(houseReceivers.length>20);assert.ok(houseReceivers.every(o=>o.receiveShadow));assert.ok(windowNonReceivers.length>0);assert.ok(windowNonReceivers.every(o=>!o.receiveShadow),'existing window-room lighting remains deliberately independent of ground shadows');
  for(const batch of m.batches)assert.equal(batch.mesh.receiveShadow,batch.rows.some(o=>o.receiveShadow),'each batch preserves its rows shadow policy');
  for(const resource of [...m.geometries,...m.materials,...m.textures,...m.batches.map(b=>b.mesh)]){counts.set(resource,0);resource.addEventListener('dispose',()=>counts.set(resource,counts.get(resource)+1));}
  const dynamic=m.batches.filter(b=>b.dynamic),initial=dynamic.map(b=>Array.from(b.mesh.instanceMatrix.array));
  assert.ok(dynamic.length>0);assert.ok(dynamic.reduce((n,b)=>n+b.rows.length,0)<=4500);m.animate(1400,false);
  assert.ok(dynamic.some((b,i)=>JSON.stringify(Array.from(b.mesh.instanceMatrix.array))!==JSON.stringify(initial[i])));
  const geometries=[...m.geometries],matrices=m.placeGroups.map(g=>g.matrixWorld.elements.slice());
  const colors=[];
  for(const key of ['spring','summer','autumn','winter']){assert.equal(m.setSeason(key),true);assert.deepEqual([...m.geometries],geometries);assert.deepEqual(m.placeGroups.map(g=>g.matrixWorld.elements.slice()),matrices);colors.push(smooth.map(m=>m.color.getHexString()));}
  assert.notDeepEqual(colors[1],colors[3],'the shared smooth clones follow the existing summer/winter palette without new allocation');
  assert.equal(JSON.stringify(world),saved);m.dispose();m.dispose();assert.ok([...counts.values()].every(n=>n===1));
});

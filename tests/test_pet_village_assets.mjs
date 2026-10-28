import {assertDerivedWorld} from './helpers/pet-town-derived-world.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Assets from '../static/pet-village-assets.js';
import Town from '../static/pet-town-walk.js';
import TownScene from '../static/pet-town-scene.js';

const ids=['autumn-chrysanthemum-planter-v1','pearl-garden-lantern-v1'];
function renderNodes(asset){const rows=[];asset.group.traverse(o=>{if(o.isMesh)rows.push(o);});return rows;}
function transformedVertices(asset,visit){asset.group.updateMatrixWorld(true);for(const mesh of renderNodes(asset)){const positions=mesh.geometry.getAttribute('position'),matrix=new THREE.Matrix4(),world=new THREE.Matrix4();for(let i=0;i<(mesh.isInstancedMesh?mesh.count:1);i++){if(mesh.isInstancedMesh){mesh.getMatrixAt(i,matrix);world.multiplyMatrices(mesh.matrixWorld,matrix);}else world.copy(mesh.matrixWorld);for(let n=0;n<positions.count;n++)visit(new THREE.Vector3().fromBufferAttribute(positions,n).applyMatrix4(world));}}}
function triangles(geometry){const p=geometry.getAttribute('position'),index=geometry.index,count=index?index.count:p.count,rows=[];for(let i=0;i<count;i+=3)rows.push([0,1,2].map(n=>new THREE.Vector3().fromBufferAttribute(p,index?index.getX(i+n):i+n)));return rows;}
function closedPrimitive(geometry){const edges=new Map();let volume=0;for(const [a,b,c]of triangles(geometry)){const area=b.clone().sub(a).cross(c.clone().sub(a)).length();assert.ok(area>1e-12,geometry.type+': nondegenerate triangle');volume+=a.dot(b.clone().cross(c))/6;const keys=[a,b,c].map(p=>[p.x,p.y,p.z].map(n=>Math.round(n*1e6)).join(','));for(let i=0;i<3;i++){const pair=[keys[i],keys[(i+1)%3]].sort().join('|');edges.set(pair,(edges.get(pair)||0)+1);}}assert.ok(Math.abs(volume)>1e-9,geometry.type+': nonzero solid volume');assert.ok([...edges.values()].every(n=>n===2),geometry.type+': every welded edge closes exactly twice');}

test('two separate immutable original recipes carry actual candidate scope and no runtime adoption flags',()=>{
 assert.deepEqual(Assets.catalogue.map(s=>s.id),ids);assert.equal(Object.isFrozen(Assets.catalogue),true);
 for(const spec of Assets.catalogue){assert.equal(Object.isFrozen(spec),true);assert.equal(Object.isFrozen(spec.verification),true);assert.equal(spec.units,'game-world-units');assert.equal(spec.recipe,'static/pet-village-assets-v1.js');assert.equal(spec.representation,'real_mesh_geometry');for(const k of['allAngles','villagePlacement','interaction','saveUnlock','production'])assert.equal(spec.verification[k],false);}
 assert.deepEqual(Assets.get(ids[0]).season,['autumn']);assert.notEqual(Assets.get(ids[0]).purpose,Assets.get(ids[1]).purpose);assert.equal(Assets.get('unknown'),null);assert.throws(()=>Assets.build(THREE,'unknown'),/unknown_village_asset/);
});

test('the browser loads the same frozen bank and registry without game, storage, network or UI dependencies',()=>{
 const context=vm.createContext({});for(const name of['pet-village-assets-v1.js','pet-village-assets.js'])vm.runInContext(readFileSync(new URL('../static/'+name,import.meta.url),'utf8'),context);
 assert.equal(context.PetVillageAssets.catalogue.length,2);assert.equal(context.PetVillageAssets.get(ids[1]).version,1);
 const asset=context.PetVillageAssets.build(THREE,ids[0]);assert.equal(asset.group.userData.candidateOnly,true);asset.dispose();
});

test('every component uses a closed solid primitive with finite normals and UVs, without alpha cards',()=>{
 for(const id of ids){const asset=Assets.build(THREE,id);try{
  assert.ok(asset.resources.geometries.size>3);
  for(const geometry of asset.resources.geometries){
   assert.notEqual(geometry.type,'PlaneGeometry');
   for(const name of['position','normal','uv']){const a=geometry.getAttribute(name);assert.ok(a&&a.count>0,name);assert.ok([...a.array].every(Number.isFinite));}
   const positions=geometry.getAttribute('position'),normals=geometry.getAttribute('normal'),uv=geometry.getAttribute('uv');
   for(let i=0;i<normals.count;i++)assert.ok(Math.abs(Math.hypot(normals.getX(i),normals.getY(i),normals.getZ(i))-1)<1e-5);
   for(let i=0;i<uv.count;i++){
    // Three's closed sphere intentionally wraps U by half a segment at its
    // degenerate longitude poles. All non-pole UVs remain in the unit square.
    const pole=geometry.type==='SphereGeometry'&&Math.abs(positions.getY(i))>1-1e-7;
    const padding=pole ? .5/geometry.parameters.widthSegments : 0;
    assert.ok(uv.getX(i)>=-padding-1e-6&&uv.getX(i)<=1+padding+1e-6&&uv.getY(i)>=-1e-6&&uv.getY(i)<=1.000001);
   }
   closedPrimitive(geometry);
  }
  for(const material of asset.resources.materials){assert.equal(material.map,null);assert.equal(material.alphaMap,null);}
 }finally{asset.dispose();}}
});

test('actual vertex bounds sit on the floor and fit their conservative game-world footprint at native scale',()=>{
 for(const id of ids){const asset=Assets.build(THREE,id);try{const s=asset.spec,b=asset.bounds;assert.ok(Math.abs(b.min[1])<1e-7);assert.ok(b.max[1]<=s.envelope.height+1e-6);assert.ok(b.max[1]>s.envelope.height-.008);assert.ok(b.size[0]<=s.envelope.width+1e-6&&b.size[2]<=s.envelope.depth+1e-6);assert.deepEqual(asset.group.scale.toArray(),[1,1,1]);transformedVertices(asset,p=>{assert.ok(p.y>=-1e-6&&p.y<=s.envelope.height+1e-6);assert.ok(Math.hypot(p.x,p.z)<=s.footprint.radius+1e-6);});assert.deepEqual(asset.group.getObjectByName(id+'/anchor/ground').position.toArray(),[0,0,0]);}finally{asset.dispose();}}
});

test('actual solid geometry is ray-pickable from front/back/sides/above/below; this is not a visual-review certificate',()=>{
 for(const id of ids){const asset=Assets.build(THREE,id);try{asset.group.updateMatrixWorld(true);const center=new THREE.Vector3(0,asset.spec.envelope.height*.48,0);for(const elevation of[-Math.PI/3,0,Math.PI/3])for(let n=0;n<12;n++){const yaw=n*Math.PI/6,origin=new THREE.Vector3(Math.sin(yaw)*Math.cos(elevation)*2,center.y+Math.sin(elevation)*2,Math.cos(yaw)*Math.cos(elevation)*2),ray=new THREE.Raycaster(origin,center.clone().sub(origin).normalize());const hits=ray.intersectObject(asset.group,true);assert.ok(hits.length>0,id+': elevation'+elevation+' yaw'+yaw);assert.ok(hits.every(h=>Number.isFinite(h.distance)&&h.distance>0));}}finally{asset.dispose();}}
});

test('stable component identities and bounded instancing preserve deterministic repeated builds',()=>{
 for(const id of ids){const a=Assets.build(THREE,id),b=Assets.build(THREE,id);try{const names=g=>{const rows=[];g.traverse(o=>{rows.push(o.name);});return rows;};assert.deepEqual(names(a.group),names(b.group));assert.equal(new Set(names(a.group)).size,names(a.group).length);assert.deepEqual(a.bounds,b.bounds);const rows=renderNodes(a);assert.ok(rows.length<=48,'bounded static draw components');let count=0;for(const mesh of rows){count+=(mesh.geometry.index?mesh.geometry.index.count:mesh.geometry.getAttribute('position').count)/3*(mesh.isInstancedMesh?mesh.count:1);if(mesh.isInstancedMesh){assert.equal(mesh.userData.instancePartIds.length,mesh.count);assert.equal(new Set(mesh.userData.instancePartIds).size,mesh.count);}}assert.ok(count<(id===ids[0]?60000:20000),'bounded triangle budget');assert.ok(a.resources.instancedMeshes.size>0);}finally{a.dispose();b.dispose();}}
});

test('planter flowers and lantern light/glass are different constructed purposes with one local shadow-free light at most',()=>{
 const planter=Assets.build(THREE,ids[0]),lantern=Assets.build(THREE,ids[1]);try{const find=(a,p)=>{const rows=[];a.group.traverse(o=>{if(p(o))rows.push(o);});return rows;};assert.equal(find(planter,o=>o.isLight).length,0);assert.equal(find(lantern,o=>o.isPointLight).length,1);assert.equal(find(lantern,o=>o.isPointLight)[0].castShadow,false);assert.equal(find(lantern,o=>o.isMesh&&o.material.transparent).length,4);assert.ok(planter.group.getObjectByName(ids[0]+'/flower-0/pollen'));assert.ok(lantern.group.getObjectByName(ids[1]+'/lantern/closed-pearl-hood'));assert.equal(find(planter,o=>o.name.includes('/flower-')).length,102);}finally{planter.dispose();lantern.dispose();}
});

test('analytic collision includes clearance, rejects malformed coordinates and does not change a world',()=>{
 for(const id of ids){const spec=Assets.get(id),r=spec.footprint.radius+spec.footprint.clearance;assert.equal(Assets.intersects(id,0,0),true);assert.equal(Assets.intersects(id,r,0),true);assert.equal(Assets.intersects(id,r+.001,0),false);assert.equal(Assets.intersects(id,10+r,20,10,20),true);assert.throws(()=>Assets.intersects(id,NaN,0),/invalid_village_asset_position/);assert.throws(()=>Assets.intersects(id,0,0,0,0,-.1),/invalid_village_asset_position/);}
});

test('two candidate props can be placed on real existing town geometry with clear ground/navigation envelopes without mutating layout or saves',()=>{
 const world=Town.createWorld(),before=JSON.stringify(world),model=TownScene.buildWorld(THREE,world,{}),placements=[{id:ids[0],x:1100,y:1100},{id:ids[1],x:1550,y:1100}],built=[];try{for(const placement of placements){const asset=Assets.build(THREE,placement.id);built.push(asset);const p=TownScene.groundPoint(world,placement),ground=TownScene.heightAt(placement);asset.group.position.set(p.x,ground,p.z);model.scene.add(asset.group);const r=(asset.footprint.radius+asset.footprint.clearance+.18)*100;for(let n=0;n<24;n++){const angle=n*Math.PI/12;assert.equal(Town.isWalkable(world,placement.x+Math.cos(angle)*r,placement.y+Math.sin(angle)*r),true);}const ray=new THREE.Raycaster(new THREE.Vector3(p.x,5,p.z),new THREE.Vector3(0,-1,0)),hits=ray.intersectObjects(model.surfaces);assert.ok(hits.length&&Math.abs(hits[0].point.y-ground)<1e-6);}assertDerivedWorld(world,before,model);assert.equal(world.places.length,6);}finally{built.forEach(a=>a.dispose());model.dispose();}
});

test('disposal releases each owned geometry/material/instance once and never releases a different build',()=>{
 for(const id of ids){const a=Assets.build(THREE,id),b=Assets.build(THREE,id);let geometries=0,materials=0,instances=0;for(const g of a.resources.geometries)g.addEventListener('dispose',()=>geometries++);for(const m of a.resources.materials)m.addEventListener('dispose',()=>materials++);for(const i of a.resources.instancedMeshes)i.addEventListener('dispose',()=>instances++);let other=0;for(const g of b.resources.geometries)g.addEventListener('dispose',()=>other++);const parent=new THREE.Group();parent.add(a.group);a.dispose();a.dispose();assert.equal(a.group.parent,null);assert.equal(a.group.children.length,0);assert.equal(geometries,a.resources.geometries.size);assert.equal(materials,a.resources.materials.size);assert.equal(instances,a.resources.instancedMeshes.size);assert.equal(other,0);assert.ok(b.group.children.length>0);b.dispose();}
});

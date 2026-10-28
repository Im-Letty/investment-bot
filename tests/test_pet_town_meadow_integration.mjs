import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Scene from '../static/pet-town-scene.js';
import Town from '../static/pet-town-walk.js';
import FrameFit from '../static/pet-frame-fit.js';
import Fishing from '../static/pet-river-fishing.js';
import Seasons from '../static/pet-japan-seasons.js';
import Style from '../static/pet-town-style.js';
import Layout from '../static/pet-town-layout-art.js';
import Originals from '../static/pet-town-placement-originals.js';
import Water from '../static/pet-town-water-life.js';
import Ocean from '../static/pet-town-ocean-life.js';
import Shore from '../static/pet-town-shore-transition.js';
import Trees from '../static/pet-town-tree-variety.js';

const ground=.025;
const roadNames=new Set(['layout-plaza-border','layout-plaza-floor','layout-plaza-border-paver',
 'layout-curved-path-edge','layout-curved-cream-path','layout-porch-cream-connector','bridge-deck']);
function withModel(fn){const world=Town.createWorld(),before=JSON.stringify(world),m=Scene.buildWorld(THREE,world,{});try{return fn(m,world,before);}finally{m.dispose();}}
function actualTriangles(m){
 const rows=[];m.scene.updateMatrixWorld(true);
 m.scene.traverse(mesh=>{
  if(!mesh.isMesh||!roadNames.has(mesh.name))return;
  const p=mesh.geometry.attributes.position,index=mesh.geometry.index;
  for(let i=0;i<(index?index.count:p.count);i+=3){const triangle=[];for(let j=0;j<3;j++){const v=new THREE.Vector3().fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(mesh.matrixWorld);triangle.push(new THREE.Vector3(v.x,0,v.z));}rows.push(triangle);}
 });return rows;
}
// Independent Three closest-point witnesses, including vertically projected
// bridge faces that collapse to lines. This does not call the planner helpers.
function triangleDistance(point,vertices){
 const cross=new THREE.Vector3().subVectors(vertices[1],vertices[0]).cross(new THREE.Vector3().subVectors(vertices[2],vertices[0]));
 if(cross.lengthSq()>1e-20)return point.distanceTo(new THREE.Triangle(...vertices).closestPointToPoint(point,new THREE.Vector3()));
 return Math.min(...vertices.map((v,i)=>{const other=vertices[(i+1)%3];return v.distanceToSquared(other)===0?point.distanceTo(v):point.distanceTo(new THREE.Line3(v,other).closestPointToPoint(point,true,new THREE.Vector3()));}));
}
function named(m,predicate){const rows=[];m.scene.traverse(o=>{if(predicate(o))rows.push(o);});return rows;}

test('full scene plans finite irregular sites clear of every actual road and bridge triangle',()=>withModel((m,world,before)=>{
 const d=m.scene.userData.meadowFlowers,triangles=actualTriangles(m);
 assert.equal(d.revision,'meadow-flowers3');assert.equal(d.summary.sites,d.sitePlan.length);assert.ok(d.summary.triangles<=45000,'actual accepted town planting stays within its authored45k budget');
 assert.ok(d.sitePlan.length>0&&d.sitePlan.length<=40);assert.equal(triangles.length,d.roadTriangleCount);assert.ok(triangles.length>2000);
 for(const site of d.sitePlan){const p=new THREE.Vector3(site.x,0,site.z);assert.equal(site.radius,.55);assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.z));
  for(const tri of triangles)assert.ok(triangleDistance(p,tri)>=.65-1e-7,'whole swept cluster clears actual paving');
  for(const other of d.sitePlan)if(other!==site)assert.ok(Math.hypot(site.x-other.x,site.z-other.z)>=1.25-1e-10);
 }
 assert.equal(JSON.stringify(world),before);
}));

test('full cluster discs avoid current solid building unions, round fountain, river bank and map edges',()=>withModel((m,world)=>{
 const sites=m.scene.userData.meadowFlowers.sitePlan;
 const knots=[[0,2880],[550,2840],[1050,2720],[1450,2510],[1920,1990]].map(([y,x])=>Scene.groundPoint(world,{x,y}));
 for(const site of sites){const p=new THREE.Vector3(site.x,0,site.z),town=Scene.townPoint(world,site);
  assert.ok(Town.isWalkable(world,town.x,town.y));assert.equal(Scene.heightAt(town),ground);
  assert.ok(Math.abs(site.x)<=world.width/200-.65+1e-8);assert.ok(Math.abs(site.z)<=world.height/200-.65+1e-8);
  for(const place of world.places){const b=Town.collisionBounds(place),lo=Scene.groundPoint(world,{x:b.minX,y:b.minY}),hi=Scene.groundPoint(world,{x:b.maxX,y:b.maxY});
   const box=new THREE.Box3(new THREE.Vector3(lo.x,0,lo.z),new THREE.Vector3(hi.x,0,hi.z));assert.ok(p.distanceTo(box.clampPoint(p,new THREE.Vector3()))>=.65-1e-7);
  }
  for(let i=1;i<knots.length;i++){const a=knots[i-1],b=knots[i],line=new THREE.Line3(new THREE.Vector3(a.x,0,a.z),new THREE.Vector3(b.x,0,b.z));assert.ok(p.distanceTo(line.closestPointToPoint(p,true,new THREE.Vector3()))>=.65-1e-7);}
 }
}));

test('ambient replacements retain the saved flower artwork, six shop tulips and all twenty-seven tree roots',()=>withModel((m,world,before)=>{
 const originals=named(m,o=>o.isSprite&&o.userData.originalArt);
 assert.equal(originals.filter(o=>o.userData.originalArtKind==='flowers').length,1,'only the saved flowerbed keeps the unchanged original');
 assert.equal(originals.filter(o=>o.userData.originalArtKind==='shopTulip').length,6);
 assert.equal(originals.filter(o=>/^tree/.test(o.userData.originalArtKind)).length,27);
 assert.equal(m.scene.userData.shopStyleRevision,'shop-style1');assert.equal(m.scene.userData.fountainReferenceRevision,'fountain-reference1');
 assert.equal(m.scene.userData.shoreTransitionRevision,'shore-transition1');assert.equal(m.treeVarietyKinds.length,27);
 assert.equal(named(m,o=>/^placement-original-meadow-flowers$|^clustered-meadow-flowerbed$/.test(o.name)).length,0);
 assert.equal(m.people.length,0);assert.equal(JSON.stringify(world),before);
}));

test('decorative instances never become walking, picking, occlusion or duplicate static batches',()=>withModel(m=>{
 const flowers=m.meadowLife;assert.ok(flowers);assert.equal(flowers.batches.length,7);assert.equal(flowers.summary().geometries,3);
 assert.ok(m.batches.length+flowers.batches.length<=120,'combined native scene and meadow instance batches remain bounded');
 const meshes=new Set(flowers.batches.map(b=>b.mesh));
 for(const mesh of meshes){assert.equal(mesh.userData.noStaticBatch,true);assert.equal(mesh.userData.nonSolidDecoration,true);assert.equal(mesh.castShadow,false);assert.equal(mesh.receiveShadow,true);
  for(const rows of [m.surfaces,m.pickables,m.occluders])assert.equal(rows.includes(mesh),false);
  assert.equal(m.batches.some(b=>b.mesh===mesh||b.rows?.includes(mesh)),false);
 }
 assert.equal(flowers.summary().textures,0);assert.equal(flowers.summary().lights,0);
}));

test('scene animation and all four seasons keep site roots, resources, original art and saved world stable',()=>withModel((m,world,before)=>{
 const flowers=m.meadowLife,roots=flowers.plants.map(p=>p.base.slice()),sites=JSON.stringify(m.scene.userData.meadowFlowers.sitePlan);
 const geometries=[...m.geometries],materials=[...m.materials],art=named(m,o=>o.isSprite&&o.userData.originalArt),positions=art.map(o=>o.getWorldPosition(new THREE.Vector3()).toArray());
 for(const season of ['spring','summer','autumn','winter']){m.setSeason(season);for(const ms of [0,735,5000]){m.animate(ms,false);m.animate(ms,true);}
  assert.deepEqual(flowers.plants.map(p=>p.base),roots);assert.deepEqual([...m.geometries],geometries);assert.deepEqual([...m.materials],materials);
  assert.deepEqual(art.map(o=>o.getWorldPosition(new THREE.Vector3()).toArray()),positions);assert.equal(JSON.stringify(m.scene.userData.meadowFlowers.sitePlan),sites);
 }
 assert.equal(JSON.stringify(world),before);
}));

test('scene destruction releases flower instance buffers and scene-owned resources once',()=>{
 const m=Scene.buildWorld(THREE,Town.createWorld(),{}),flowers=m.meadowLife,resources=new Set([...m.geometries,...m.materials,...flowers.batches.map(b=>b.mesh)]),counts=new Map();
 for(const r of resources){counts.set(r,0);r.addEventListener('dispose',()=>counts.set(r,counts.get(r)+1));}
 m.dispose();m.dispose();assert.equal(flowers.summary().disposed,true);assert.equal(flowers.animate(1000,false),false);
 for(const count of counts.values())assert.equal(count,1);
});

test('historical synchronous previews without meadow helpers keep their original fallback',()=>{
 const context=vm.createContext({PetTownWalk:Town,PetFrameFit:FrameFit,PetRiverFishing:Fishing,PetJapanSeasons:Seasons,PetTownStyle:Style,
  PetTownLayoutArt:Layout,PetTownPlacementOriginals:Originals,PetTownWaterLife:Water,PetTownOceanLife:Ocean,PetTownShoreTransition:Shore,PetTownTreeVariety:Trees});
 vm.runInContext(readFileSync(new URL('../static/pet-town-scene.js',import.meta.url),'utf8'),context);
 const m=context.PetTownScene.buildWorld(THREE,Town.createWorld(),{});try{
  assert.equal(m.meadowLife,null);assert.equal(m.scene.userData.meadowFlowersRevision,null);
  assert.ok(named(m,o=>o.isSprite&&o.userData.originalArtKind==='flowers').length>1);
  assert.equal(m.scene.userData.shopStyleRevision,'shop-style1');assert.equal(m.scene.userData.fountainReferenceRevision,'fountain-reference1');
 }finally{m.dispose();}
});


test('actual autumn fallen-leaf volumes rest just above their sampled real floor',()=>withModel((m,world,before)=>{
 m.setSeason('autumn');m.scene.updateMatrixWorld(true);
 const leaves=named(m,o=>o.name==='autumn-fallen-leaf');assert.ok(leaves.length>0);
 for(const leaf of leaves){
  const bounds=new THREE.Box3().setFromObject(leaf),center=bounds.getCenter(new THREE.Vector3());
  const hits=new THREE.Raycaster(new THREE.Vector3(center.x,bounds.min.y+.1,center.z),new THREE.Vector3(0,-1,0),0,1).intersectObjects(m.surfaces,false);
  assert.ok(hits.length,'real floor ray below each fallen leaf');
  const gap=bounds.min.y-hits[0].point.y;assert.ok(gap>.001&&gap<.003,'no visible hover or floor penetration');
 }
 assert.equal(JSON.stringify(world),before);
}));

import {assertDerivedWorld} from './helpers/pet-town-derived-world.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../static/vendor/three-0.160.1.module.js';
import Scene from '../static/pet-town-scene.js';
import Town from '../static/pet-town-walk.js';
const world=Town.createWorld(),before=JSON.stringify(world),model=Scene.buildWorld(T,world,{},null,null);
const fountain=model.scene.getObjectByName('market-photo-fountain'),place=world.places.find(p=>p.id==='playground');
model.scene.updateMatrixWorld(true);
const solids=[],waters=[];fountain.traverse(m=>{if(m.isMesh)(m.userData.nonSolidWater?waters:solids).push(m);});
const inverse=fountain.matrixWorld.clone().invert(),material=new T.MeshBasicMaterial({side:T.DoubleSide}),copies=new Map(),bounds=new Map();
for(const m of solids){const copy=new T.Mesh(m.geometry,material);copy.matrixWorld.multiplyMatrices(inverse,m.matrixWorld);copy.matrixAutoUpdate=false;copies.set(m,copy);bounds.set(m,new T.Box3().setFromBufferAttribute(m.geometry.attributes.position).applyMatrix4(copy.matrixWorld));}
const find=name=>fountain.getObjectByName(name),near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,a+' != '+b);
const direction=new T.Vector3(1,.237,.413).normalize();
function inside(mesh,point){
 if(!bounds.get(mesh).containsPoint(point))return false;
 const hits=new T.Raycaster(point,direction).intersectObject(copies.get(mesh),false),unique=[];
 for(const hit of hits)if(hit.distance>1e-8&&!unique.some(d=>Math.abs(d-hit.distance)<1e-7))unique.push(hit.distance);
 return unique.length%2===1;
}
function localVertex(mesh,i){return new T.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,i).applyMatrix4(new T.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld));}
function geometryFacts(g){
 const p=g.attributes.position,n=g.attributes.normal,ix=g.index,edges=new Map();let volume=0;
 const key=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e6)).join(',');
 for(let i=0;i<(ix?ix.count:p.count);i+=3){
  const ids=[0,1,2].map(j=>ix?ix.getX(i+j):i+j),a=new T.Vector3().fromBufferAttribute(p,ids[0]),b=new T.Vector3().fromBufferAttribute(p,ids[1]),c=new T.Vector3().fromBufferAttribute(p,ids[2]);
  assert.ok(b.clone().sub(a).cross(c.clone().sub(a)).lengthSq()>1e-18,'no degenerate material face');
  volume+=a.dot(b.clone().cross(c))/6;
  for(let j=0;j<3;j++){const a=key(ids[j]),b=key(ids[(j+1)%3]),pair=[a,b].sort(),k=pair.join('/'),e=edges.get(k)||[0,0];e[0]++;e[1]+=a===pair[0]?1:-1;edges.set(k,e);}
 }
 for(const value of p.array)assert.ok(Number.isFinite(value));
 for(let i=0;i<n.count;i++)near(Math.hypot(n.getX(i),n.getY(i),n.getZ(i)),1,1e-5);
 assert.ok([...edges.values()].every(([count,orientation])=>count===2&&orientation===0),'each welded edge has two opposite faces');
 assert.ok(volume>1e-8,'outward material winding has positive signed volume');return volume;
}
test.after(()=>{material.dispose();model.dispose();});

test('reference fountain has circular layered bowls, broader lower petals and unchanged saved centre',()=>{
 assert.equal(fountain.userData.referenceFormRevision,'fountain-reference1');assert.equal(model.scene.userData.fountainReferenceRevision,'fountain-reference1');
 near(fountain.scale.y,1.12);const d=Town.solidDimensions(place);assert.equal(d.radiusX,.76);assert.equal(d.radiusZ,.76);
 for(const name of ['fountain-lower-bowl','fountain-upper-bowl']){const b=find(name).geometry.boundingBox;near(b.max.x,-b.min.x);near(b.max.z,-b.min.z);near(b.max.x,b.max.z);}
 assert.equal(fountain.children.filter(m=>m.name==='fountain-raised-petal-panel'&&m.userData.bowlTier==='lower').length,12);
 const lower=fountain.children.find(m=>m.name==='fountain-raised-petal-panel'&&m.userData.bowlTier==='lower').geometry.boundingBox;
 assert.ok(lower.max.y-lower.min.y>.34);
 for(const m of solids)for(let i=0;i<m.geometry.attributes.position.count;i++){const p=localVertex(m,i);assert.ok(Math.hypot(p.x,p.z)<=.760001,'real solid inside circular blocker');}
 const p=fountain.getWorldPosition(new T.Vector3()),target=Scene.groundPoint(world,place.footprint);near(p.x,target.x);near(p.z,target.z);near(p.y,.025);
 assertDerivedWorld(world,before,model);
});
test('closed bowls, turned pedestal, broad panels and every band have nondegenerate outward manifold surfaces',()=>{
 const checked=new Set();for(const m of solids)if(m.userData.referenceFormPart&&!checked.has(m.geometry)){checked.add(m.geometry);geometryFacts(m.geometry);}
 assert.ok(checked.size>=10);
 const rim=fountain.children.filter(m=>m.name==='lilac-glazed-fountain-rim');assert.equal(rim.length,2);for(const m of rim)assert.ok(geometryFacts(m.geometry)>0);
});
test('both basins have actual inner depressions and closed material floors rather than opaque caps',()=>{
 for(const [name,x,floorY,rimY,under] of [['fountain-lower-bowl',.40,.40,.55,.20],['fountain-upper-bowl',.20,1.0,1.105,.85]]){
  const mesh=find(name),ray=new T.Raycaster(new T.Vector3(x,2,0),new T.Vector3(0,-1,0)),hit=ray.intersectObject(copies.get(mesh),false)[0];
  assert.ok(hit&&hit.point.y<floorY&&hit.point.y<rimY-.08);
  assert.equal(inside(mesh,new T.Vector3(0,under,0)),true);assert.equal(inside(mesh,new T.Vector3(0,rimY-.025,0)),false);
 }
});
test('foot, basin, underwater stem and upper bowl have strict common-solid support witnesses',()=>{
 const foot=find('fountain-foot'),lower=find('fountain-lower-bowl'),stem=find('fountain-turned-stem'),upper=find('fountain-upper-bowl');
 for(const [a,b,p] of [[foot,lower,[.10,.115,0]],[lower,stem,[.05,.242,0]],[stem,upper,[.10,.83,0]]]){
  const point=new T.Vector3(...p);assert.equal(inside(a,point),true,a.name);assert.equal(inside(b,point),true,b.name);
 }
 for(const panel of fountain.children.filter(m=>m.name==='fountain-raised-petal-panel')){
  const body=panel.userData.bowlTier==='lower'?lower:upper,p=panel.geometry.attributes.position;let overlap=false;
  for(let i=0;i<p.count&&!overlap;i++)overlap=inside(body,localVertex(panel,i));
  assert.ok(overlap,'actual '+panel.userData.bowlTier+' panel joins its vessel');
 }
});
test('all water is separate from camera/feet blockers and its curved spills connect real surfaces',()=>{
 assert.equal(fountain.children.filter(m=>m.name==='fountain-cascade').length,8);assert.equal(fountain.children.filter(m=>m.name==='fountain-falling-drop').length,8);
 assert.equal(fountain.children.filter(m=>m.name==='fountain-spill-contact-ring').length,8);assert.equal(model.waterLife.ringCount,3);
 for(const m of waters){assert.equal(m.userData.noStaticBatch,true);assert.equal(m.castShadow,false);assert.equal(model.occluders.includes(m),false);assert.equal(model.pickables.includes(m),false);}
 const surfaces=fountain.userData.fountainWaterSurfaces;assert.equal(model.waterLife.surfaceMode,'authored');
 for(const tier of ['lower','upper']){const m=find('fountain-'+tier+'-water');m.geometry.computeBoundingBox();const top=m.geometry.boundingBox.max.y*m.scale.y+m.position.y;near(top,surfaces[tier].y);near(m.scale.x,surfaces[tier].radius);}
 for(const m of fountain.children.filter(m=>m.name==='fountain-cascade')){
  const curve=m.userData.cascadeCurve,start=curve.getPointAt(0),end=curve.getPointAt(1);near(start.y,surfaces.upper.y);assert.ok(Math.hypot(start.x,start.z)<surfaces.upper.radius);
  assert.ok(end.y>surfaces.lower.y&&end.y<surfaces.lower.y+.02);assert.ok(Math.hypot(end.x,end.z)+.04<surfaces.lower.radius);
  let lifted=false;for(let i=0;i<=64;i++){const p=curve.getPointAt(i/64);if(p.y>surfaces.upper.rimY+.005)lifted=true;for(const solid of solids)assert.equal(inside(solid,p),false,'flow centre clears '+solid.name);}
  assert.ok(lifted,'flow rises over the upper lip before descending');
 }
});
test('actual spill tube vertices clear ceramic material, including the upper rim and stem',()=>{
 for(const m of fountain.children.filter(m=>m.name==='fountain-cascade'))for(let i=0;i<m.geometry.attributes.position.count;i++){
  const point=localVertex(m,i);for(const solid of solids)assert.equal(inside(solid,point),false,'tube penetrates '+solid.name);
 }
});
test('circle perimeter and the existing facility approaches stay manually reachable without changing saved layout',()=>{
 const isolated={width:world.width,height:world.height,places:[place]},c=place.footprint;
 for(let i=0;i<72;i++){const a=i/72*Math.PI*2;assert.equal(Town.isWalkable(isolated,c.x+Math.cos(a)*93.99,c.y+Math.sin(a)*93.99),false);assert.equal(Town.isWalkable(isolated,c.x+Math.cos(a)*94.01,c.y+Math.sin(a)*94.01),true);}
 for(const p of world.places){assert.equal(Town.isWalkable(world,p.entrance.x,p.entrance.y),true);assert.ok(Town.route(world,world.spawn,p.entrance));}
 assertDerivedWorld(world,before,model);
});
test('motion reuses fixed resources, reduced motion is stable, and scene disposal owns every new resource once',()=>{
 const geometries=[...model.geometries],materials=[...model.materials],drops=fountain.children.filter(m=>m.name==='fountain-falling-drop'),snap=()=>drops.map(m=>m.position.toArray()).concat(model.waterLife.group.children.map(m=>m.matrixWorld.toArray()));
 const reflection=[...model.textures].filter(t=>t.userData.fountainWaterReflection);assert.equal(reflection.length,1);const texture=reflection[0],pixels=texture.image.data.slice(),version=texture.version;assert.equal(texture.image.width,128);assert.equal(find('fountain-lower-water').material.map,find('fountain-upper-water').material.map);
 model.animate(0,true);const fixed=snap(),fixedDrops=drops.map(m=>m.position.toArray());model.animate(900,false);assert.notDeepEqual(snap(),fixed);for(let i=0;i<drops.length;i++)assert.notDeepEqual(drops[i].position.toArray(),fixedDrops[i],'each existing drop follows its curve');model.animate(60000,true);assert.deepEqual(snap(),fixed);
 for(let i=0;i<60;i++)model.animate(i*71,false);assert.deepEqual([...model.geometries],geometries);assert.deepEqual([...model.materials],materials);
 assert.deepEqual(texture.image.data,pixels);assert.equal(texture.version,version,'UV motion cannot re-upload pixel data');assert.ok(texture.offset.x>0&&Math.abs(texture.offset.y)<=.016);model.animate(90000,true);assert.deepEqual(texture.offset.toArray(),[0,0]);
 let triangles=0;fountain.traverse(m=>{if(m.isMesh)triangles+=(m.geometry.index?.count||m.geometry.attributes.position.count)/3;});assert.ok(triangles<27000,'bounded detailed fountain');
 const owned=new Set([...solids,...waters].flatMap(m=>[m.geometry,m.material]).filter(r=>model.geometries.has(r)||model.materials.has(r))),counts=new Map();
 for(const r of owned)r.addEventListener('dispose',()=>counts.set(r,(counts.get(r)||0)+1));model.dispose();model.dispose();for(const r of owned)assert.equal(counts.get(r),1);
});

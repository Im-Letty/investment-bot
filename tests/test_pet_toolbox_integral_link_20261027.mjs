import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as T from '../static/vendor/three-0.160.1.module.js';
import {build,spec,dimensions,validatePose} from '../static/pet-toolbox-integral-link-proof-20261027/mechanism.mjs';
import Town from '../static/pet-town-walk.js';
import Scene from '../static/pet-town-scene.js';
import {probePlacement,inspectOriginalSprites} from '../static/pet-toolbox-integral-link-proof-20261027/placement.mjs';
import {auditPose,auditSweep} from '../static/pet-toolbox-integral-link-proof-20261027/inspection.mjs';
const close=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<=tolerance,a+' != '+b);
function closed(geometry){
 const position=geometry.attributes.position,normal=geometry.attributes.normal,index=geometry.index,edges=new Map();let volume=0,triangles=0;
 for(const attribute of[position,normal])for(const n of attribute.array)assert.ok(Number.isFinite(n));
 for(let i=0;i<normal.count;i++)close(Math.hypot(normal.getX(i),normal.getY(i),normal.getZ(i)),1,1e-5);
 const key=v=>v.toArray().map(n=>Math.round(n*1e6)).join(',');
 for(let i=0;i<(index?.count||position.count);i+=3){
  const ids=[0,1,2].map(n=>index?index.getX(i+n):i+n),vertices=ids.map(n=>new T.Vector3().fromBufferAttribute(position,n));
  const area=vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0])).lengthSq();if(area<1e-18)continue;
  triangles++;volume+=vertices[0].dot(vertices[1].clone().cross(vertices[2]))/6;
  for(let j=0;j<3;j++){const k=[key(vertices[j]),key(vertices[(j+1)%3])].sort().join('/');edges.set(k,(edges.get(k)||0)+1);}
 }
 assert.ok(triangles>0);assert.ok(volume>0,'actual closed shell faces outwards');
 assert.ok([...edges.values()].every(n=>n===2),'all welded nondegenerate shell edges have exactly two incident faces');
}
function rayLocal(mesh,root,from,direction){root.updateMatrixWorld(true);const origin=new T.Vector3(...from).applyMatrix4(root.matrixWorld),dir=new T.Vector3(...direction).transformDirection(root.matrixWorld);return new T.Raycaster(origin,dir,.0001,5).intersectObject(mesh,false);}

test('bounded manual two-revolute unit reuses the immutable PR88 bored-pin source without claiming a whole toolbox',async()=>{
 const source=await readFile(new URL('../static/pet-toolbox-joint-proof-20261026/joint.mjs',import.meta.url));
 assert.equal(createHash('sha256').update(source).digest('hex'),'d078d5997e7dfd7a7aed73cadf3b76e4ad74b17eb2c3d20313e0169ab3e3f1f8');
 assert.equal(spec.sourceImageSHA256,'6afc65a45e78a938b018987a85037a9bbbd4b63905aca1438927ea13d76db070');
 assert.equal(spec.externalGuideStand,false);assert.equal(spec.fullToolboxStandaloneOpening,false);assert.equal(spec.physicalLoadFriction,false);assert.equal(spec.normalPlacement,false);assert.equal(spec.save,false);
 assert.ok(Object.isFrozen(spec));assert.ok(Object.isFrozen(dimensions.angleARange));
 for(const args of [[19,0],[51,0],[35,-21],[35,1],[NaN,0],[30,'0']])assert.throws(()=>validatePose(...args),/invalid_manual_two_joint_pose/);
 const item=build(T);try{item.setPose(35,-10);const state=item.getState();assert.equal(state.trayAttitudeDegrees,25);assert.equal(state.automaticLevelTrayConstraint,false);assert.equal(state.twoIndependentRevoluteCoordinates,true);}finally{item.dispose();}
});

test('actual two-bored link, both clevises, pin shafts and retention shells are watertight indexed outward meshes',()=>{
 const item=build(T);try{
  const geos=new Set(item.parts.map(p=>p.mesh.geometry));assert.ok(geos.size>=7);
  for(const geometry of geos)closed(geometry);
  assert.equal(item.link.geometry.userData.bores.length,2);
  assert.notStrictEqual(item.link.geometry,item.byId.get('A-integral-bored-cheek--0.125').geometry);
  assert.equal(item.parts.filter(p=>p.role==='pin').length,2);assert.equal(item.parts.filter(p=>p.role==='bored-cheek').length,4);
 }finally{item.dispose();}
});

test('both link bores are genuine empty through holes with solid surrounding walls at actual joint positions',()=>{
 const item=build(T);try{
  for(const [a,b] of [[20,-20],[35,-10],[50,0]]){
   item.setPose(a,b);
   for(const x of[0,dimensions.linkLength]){
    for(const offset of[0,.030])assert.equal(rayLocal(item.link,item.linkRoot,[x+offset,0,1],[0,0,-1]).length,0,'inside real bore remains empty');
    const wall=rayLocal(item.link,item.linkRoot,[x+.065,0,1],[0,0,-1]);assert.ok(wall.length);close(new T.Vector3().copy(wall[0].point).applyMatrix4(item.linkRoot.matrixWorld.clone().invert()).z,.06);
   }
  }
 }finally{item.dispose();}
});

test('finite two-coordinate sweep closes both endpoints, keeps fixed link length and coaxial real bores with explicit endplay',()=>{
 const item=build(T);try{
  const audit=auditSweep(T,item,10,8);assert.equal(audit.finitePoses,99);assert.equal(audit.uniqueTests,0);assert.ok(audit.maximumClosure<1e-12);assert.ok(audit.maximumBoreOffAxis<1e-12);assert.ok(audit.minimumRadialChordClearance>.0058);
  for(const row of audit.rows){
   close(row.actualPivotDistance,dimensions.linkLength,1e-12);assert.equal(row.boreRows.length,6);
   for(const bore of row.boreRows){assert.ok(bore.innerVertexSamples>=96);close(bore.axisDot,1,1e-12);assert.ok(bore.radialChordClearance>.0058);}
   for(const joint of row.endplay){assert.equal(joint.boardTongueAxialGaps.length,2);for(const gap of joint.boardTongueAxialGaps)close(gap,.02,1e-7);
    for(const collar of joint.collars){close(collar.boardToCollarAxialGap,.0145,1e-7);close(collar.collarToEndcapAxialGap,.0205,1e-7);close(collar.shaftEndToCapGap,0,1e-7);}
   }
  }
  item.setPose(35,-10);item.byId.get('B-through-pin').position.x+=.01;
  const displaced=auditPose(T,item);assert.ok(displaced.linkEndpointClosure[1]>.0099);assert.ok(displaced.boreRows.filter(r=>r.joint==='B').every(r=>r.offAxis>.0099));
 }finally{item.dispose();}
});

test('actual cross-assembly convex profile/Z-slab interference checks pass the finite domain, with bore pairs checked separately',()=>{
 const item=build(T);try{
  const sweep=auditSweep(T,item,10,8);assert.equal(sweep.collisionCount,0);
  assert.ok(sweep.rows.every(row=>row.checkedCrossAssemblyPairs>300&&row.finiteMeshPrismSAT));assert.ok(sweep.rows.every(row=>row.physicalLoadFriction===false&&row.continuousCollisionGuarantee===false));
  item.setPose(35,-10);item.trayRoot.position.set(0,-.4,0);
  assert.ok(auditPose(T,item).collisions.length>0);
 }finally{item.dispose();}
});

test('four integral travel stops make real endpoint contact and obstruct geometric overtravel',()=>{
 const item=build(T);try{
  for(const [joint,endpoint,other] of[['A',20,-10],['A',50,-10],['B',-20,35],['B',0,35]]){
   item.setPose(joint==='A'?endpoint:other,joint==='B'?endpoint:other);
   let row=auditPose(T,item).stops.find(s=>s.joint===joint&&s.endpoint===endpoint);assert.equal(row.separated,false);assert.ok(row.minOverlap<1e-7);assert.ok(Math.abs(row.maxSeparation)<1e-7);
   if(joint==='A')item.linkRoot.rotation.z=(endpoint+(endpoint===20?-.2:.2))*Math.PI/180;
   else item.trayRoot.rotation.z=(endpoint+(endpoint===-20?-.2:.2))*Math.PI/180;
   item.group.updateMatrixWorld(true);row=auditPose(T,item).stops.find(s=>s.joint===joint&&s.endpoint===endpoint);
   assert.equal(row.separated,false);assert.ok(row.minOverlap>.0005,'actual stop has a positive geometric overtravel witness');
  }
 }finally{item.dispose();}
});

test('both bored clevises attach to their own actual floor faces and four real body soles share the ground plane',()=>{
 const item=build(T);try{
  item.setPose(35,-10);
  for(const z of[-.125,.125]){
   const body=item.byId.get('A-integral-bored-cheek-'+z),floor=item.byId.get('integral-body-bottom');
   const underside=rayLocal(body,item.group,[.02,0,z],[0,1,0])[0],top=rayLocal(floor,item.group,[.02,.30,z],[0,-1,0])[0];assert.ok(underside&&top);close(underside.point.y,top.point.y);
   const cheek=item.byId.get('B-integral-bored-cheek-'+z),trayFloor=item.byId.get('integral-tray-bottom');
   const bottom=rayLocal(cheek,item.trayRoot,[.02,-.4,z],[0,1,0])[0],surface=rayLocal(trayFloor,item.trayRoot,[.02,-.05,z],[0,-1,0])[0];assert.ok(bottom&&surface);assert.ok(bottom.point.distanceTo(surface.point)<1e-7);
  }
  assert.equal(item.footprint.contactPartIds.length,4);for(const id of item.footprint.contactPartIds){const foot=item.byId.get(id),p=foot.position;const hit=rayLocal(foot,item.group,[p.x,-1,p.z],[0,1,0])[0];assert.ok(hit);close(hit.point.y,0);}
 }finally{item.dispose();}
});

test('conservative analytic vertex envelope contains sampled actual geometry without clamping or per-pose allocations',()=>{
 const item=build(T);try{
  const identities=item.parts.map(p=>p.mesh.geometry),count=item.geometries.length;
  for(let ia=0;ia<=10;ia++)for(let ib=0;ib<=8;ib++){
   item.setPose(20+ia*3,-20+ib*2.5);
   for(const part of item.parts){const p=part.mesh.geometry.attributes.position;
    for(let i=0;i<p.count;i++){const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(part.mesh.matrixWorld);for(const [axis,n]of[['x',0],['y',1],['z',2]])assert.ok(v[axis]>=item.bounds.min[n]-1e-7&&v[axis]<=item.bounds.max[n]+1e-7);}
   }
  }
  assert.deepEqual(item.parts.map(p=>p.mesh.geometry),identities);assert.equal(item.geometries.length,count);assert.equal(item.budget.geometryAllocationsPerPose,0);assert.ok(item.bounds.min[1]>=-1e-7);assert.match(item.bounds.method,/not collision proof/);
 }finally{item.dispose();}
});

test('every rendered resource is tracked and idempotent disposal releases all owned resources once',()=>{
 const item=build(T),geometries=new Set(item.geometries),materials=new Set(item.materials),textures=new Set(item.textures),counts=new Map();
 for(const part of item.parts){assert.ok(geometries.has(part.mesh.geometry));assert.ok(materials.has(part.mesh.material));}
 for(const object of[...geometries,...materials,...textures]){counts.set(object,0);object.addEventListener('dispose',()=>counts.set(object,counts.get(object)+1));}
 item.dispose();item.dispose();assert.ok([...counts.values()].every(n=>n===1));assert.throws(()=>item.setPose(35,-10),/disposed/);
});

test('new synthetic preview spot clears actual current original-card envelopes while old lantern-overlap spot is rejected',()=>{
 const world=Town.createWorld(),saved=JSON.stringify(world),model=Scene.buildWorld(T,world,{}),item=build(T);
 try{
  const placement=probePlacement(T,Scene,Town,world,model,item),clearance=placement.originalSpriteEnvelopeClearance;
  assert.deepEqual(placement.townPoint,{x:1200,y:1300});assert.equal(clearance.checkedCards,141);
  assert.deepEqual(Object.keys(clearance.kinds).sort(),['cafe','flowers','fountain','home','lantern','shop','tree']);
  assert.ok(clearance.minimumGap>.90);assert.equal(clearance.requiredMargin,.20);
  assert.equal(clearance.physicalFixtureVolumes,false);assert.equal(clearance.allCameraProjectionOcclusionGuaranteed,false);
  assert.equal(placement.otherDecorationCollisionVerified,false);assert.equal(placement.normalPlacement,false);
  assert.equal(placement.finiteFootprintGrid.blocked,0);assert.equal(placement.feet.length,4);
  for(const foot of placement.feet)assert.ok(Math.abs(foot.soleMinusFloor)<1e-7);
  assert.throws(()=>probePlacement(T,Scene,Town,world,model,item,{x:780,y:700}),/original_fixture_visual_envelope_overlap/);
  const old=Scene.groundPoint(world,{x:780,y:700}),former=inspectOriginalSprites(T,model,item,{x:old.x,y:.025,z:old.z});
  assert.ok(former.nearest.some(row=>row.kind==='lantern'&&row.gap<0));
  // Geometry-driven negative witness: adding a card at the candidate forces a
  // failure rather than trusting an anchor name or old source coordinates.
  let original;model.scene.traverse(o=>{if(!original&&o.isSprite&&o.userData.originalArtKind==='lantern')original=o;});
  const intruder=original.clone();intruder.position.set(placement.worldPosition.x,placement.worldPosition.y,placement.worldPosition.z);model.scene.add(intruder);
  assert.throws(()=>probePlacement(T,Scene,Town,world,model,item),/original_fixture_visual_envelope_overlap/);
  assert.equal(JSON.stringify(world),saved);
 }finally{item.dispose();model.dispose();}
});

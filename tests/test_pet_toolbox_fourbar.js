import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as T from '../static/vendor/three-0.160.1.module.js';
import {build,spec,dimensions,validateAngle,solveClosure} from '../static/pet-toolbox-fourbar-proof-20261027/mechanism.mjs';
import {auditPose,auditSweep} from '../static/pet-toolbox-fourbar-proof-20261027/inspection.mjs';
import {probePlacement} from '../static/pet-toolbox-fourbar-proof-20261027/placement.mjs';
import Town from '../static/pet-town-walk.js';
import Scene from '../static/pet-town-scene.js';
const close=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<=t,a+' != '+b);
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


test('one-coordinate circle closure preserves immutable ancestry and derives level from equal physical spans',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../static/pet-toolbox-fourbar-proof-20261027/input-manifest.json',import.meta.url)));
 for(const row of[...manifest.files,...manifest.dependencies]){const file=row.path.startsWith('/')?new URL('..'+row.path,import.meta.url):new URL('../static/pet-toolbox-fourbar-proof-20261027/'+row.path,import.meta.url),bytes=await readFile(file);assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256,row.path);assert.equal(bytes.length,row.bytes);}
 assert.equal(spec.sourceImageSHA256,'6afc65a45e78a938b018987a85037a9bbbd4b63905aca1438927ea13d76db070');
 assert.equal(spec.precedingRecipeSHA256,'5d0b6380e40a6585f5fae90a9b662ac5f3d442371f521890ed551df5587f074d');assert.equal(spec.manualCoordinates,1);assert.equal(spec.externalGuideStand,false);assert.equal(spec.fullToolboxClosure,false);assert.equal(spec.physicalLoadFriction,false);assert.equal(spec.save,false);
 for(const a of[44.9,80.1,NaN,Infinity,'60',null])assert.throws(()=>validateAngle(a),/invalid_manual_fourbar_angle/);
 const nominal=solveClosure(60),changed=solveClosure(60,{couplerLength:1.05});close(nominal.trayRadians,0,1e-12);assert.ok(Math.abs(changed.trayRadians)>.02,'changing the actual coupler length changes the solved attitude');assert.ok(Math.max(...changed.closureResiduals)<1e-12);assert.throws(()=>solveClosure(60,{couplerLength:4}),/cannot_close/);
 assert.ok(Object.isFrozen(dimensions.angleRange));
});

test('all actual base/tray boards, two-bored links, cheek holes and pin retention parts are closed outward indexed shells',()=>{
 const item=build(T);try{for(const g of new Set(item.parts.map(p=>p.mesh.geometry)))closed(g);
  assert.equal(item.links.length,4);assert.equal(item.joints.length,8);assert.equal(item.parts.filter(p=>p.role==='pin').length,8);assert.equal(item.parts.filter(p=>p.role==='bored-cheek').length,16);
  for(const link of item.links)assert.equal(link.mesh.geometry.userData.bores.length,2);
  assert.ok(item.byId.has('closed-base-bottom'));assert.ok(item.byId.has('closed-tray-bottom'));assert.equal(item.parts.filter(p=>p.role==='wall').length,8);
 }finally{item.dispose();}
});

test('both holes of all four physical links and the attached clevises are actual empty-through geometry with surrounding solid walls',()=>{
 const item=build(T);try{for(const a of[45,62.5,80]){item.setAngle(a);for(const link of item.links)for(const x of[0,1]){
   for(const offset of[0,.025])assert.equal(rayLocal(link.mesh,link.root,[x+offset,0,1],[0,0,-1]).length,0);
   const hit=rayLocal(link.mesh,link.root,[x+.065,0,1],[0,0,-1])[0];assert.ok(hit);close(hit.point.clone().applyMatrix4(link.root.matrixWorld.clone().invert()).z,.04);
  }
  for(const joint of item.joints)for(const cheek of joint.cheeks){assert.equal(rayLocal(cheek,cheek,[0,0,1],[0,0,-1]).length,0);assert.ok(rayLocal(cheek,cheek,[.065,0,1],[0,0,-1]).length);}
 }}finally{item.dispose();}
});

test('finite single-coordinate poses close all eight actual pins and retain level using real coaxial bores and authored axial engagement',()=>{
 const item=build(T);try{const sweep=auditSweep(T,item);assert.equal(sweep.finitePoses,36);assert.equal(sweep.uniqueTests,0);assert.ok(sweep.maximumActualPinClosure<1e-12);assert.ok(sweep.maximumTrayRise<1e-12);assert.ok(sweep.maximumBoreOffAxis<1e-12);assert.ok(sweep.minimumRadialChordClearance>.0069);
  for(const row of sweep.rows){assert.equal(row.boreRows.length,24);assert.equal(row.manualCoordinates,1);close(row.actualTrayPivotSpan,1,1e-12);close(row.actualTrayUpDot,1,1e-12);
   for(const bore of row.boreRows){assert.ok(bore.innerVertexSamples>=96);close(bore.axisDot,1,1e-12);assert.ok(bore.radialChordClearance>.0069);}
   for(const joint of row.jointRows){for(const gap of joint.linkToCheekGaps)close(gap,.02);for(const gap of joint.shaftOverhang)close(gap,.045);for(const gap of joint.boardToCollarGaps)close(gap,.008);for(const gap of joint.collarToCapGaps)close(gap,.017);for(const gap of joint.shaftEndToCapGaps)close(gap,0);assert.ok(joint.endcapRetentionMargin>.0158);assert.ok(joint.actualEndcapChordRadius>joint.maximumCheekBoreVertexRadius);}
  }
  item.setAngle(60);const upper=item.joints.find(j=>j.endpoint===1);upper.caps[0].scale.set(.5,.5,1);assert.ok(auditPose(T,item).jointRows.find(j=>j.joint===upper.id).endcapRetentionMargin<0,'shrinking an actual cap loses geometric capture');upper.pin.position.x+=.01;const displaced=auditPose(T,item);assert.ok(displaced.maximumActualPinClosure>.0099);assert.ok(displaced.boreRows.some(b=>b.offAxis>.0099));
 }finally{item.dispose();}
});

test('finite actual cross-assembly convex profiles/Z slabs reject interpenetration rather than assuming the solver implies collision freedom',()=>{
 const item=build(T);try{const sweep=auditSweep(T,item);assert.equal(sweep.collisionCount,0);assert.ok(sweep.rows.every(r=>r.checkedCrossAssemblyPairs>1000&&r.finiteMeshPrismSAT&&r.continuousCollisionGuarantee===false));
  item.setAngle(60);item.trayRoot.position.y-=1;assert.ok(auditPose(T,item).collisions.length>0,'a displaced real tray produces a negative collision witness');
 }finally{item.dispose();}
});

test('both mirrored integral stops contact actual link faces at each finite endpoint and block geometric overtravel',()=>{
 const item=build(T);try{for(const endpoint of[45,80]){item.setAngle(endpoint);let rows=auditPose(T,item).stops.filter(s=>s.endpoint===endpoint);assert.equal(rows.length,2);for(const r of rows){assert.equal(r.separated,false);assert.ok(r.minOverlap<1e-7);assert.ok(Math.abs(r.maxSeparation)<1e-7);}
  for(const l of item.links.filter(l=>l.arm===0))l.root.rotation.z=(endpoint+(endpoint===45?-.2:.2))*Math.PI/180;
  rows=auditPose(T,item).stops.filter(s=>s.endpoint===endpoint);assert.ok(rows.every(r=>!r.separated&&r.minOverlap>.0005));
 }}finally{item.dispose();}
});

test('the base supports its own lower cheeks and each tray clevis joins its own crossbar; four actual sole surfaces share y zero',()=>{
 const item=build(T);try{for(const joint of item.joints)for(const cheek of joint.cheeks){
  if(joint.endpoint===0){const c=cheek.getWorldPosition(new T.Vector3()),hit=new T.Raycaster(new T.Vector3(c.x+.055,-1,c.z),new T.Vector3(0,1,0)).intersectObject(cheek,false)[0],floor=new T.Raycaster(new T.Vector3(c.x+.055,.40,c.z),new T.Vector3(0,-1,0)).intersectObject(item.byId.get('closed-base-bottom'),false)[0];assert.ok(hit&&floor);close(hit.point.y,floor.point.y);}
  else{const p=cheek.position;const hit=rayLocal(cheek,item.trayRoot,[p.x+.055,.5,p.z],[0,-1,0])[0],floor=rayLocal(item.byId.get('tray-integral-bearing-crossbar-'+joint.arm),item.trayRoot,[p.x+.055,.5,p.z],[0,-1,0])[0];assert.ok(hit&&floor);assert.ok(hit.point.distanceTo(floor.point)<1e-7);}
 }
 for(const id of item.footprint.contactPartIds){const foot=item.byId.get(id),p=foot.position,hit=rayLocal(foot,item.group,[p.x,-1,p.z],[0,1,0])[0];assert.ok(hit);close(hit.point.y,0);}
 assert.equal(item.footprint.contactPartIds.length,4);
 }finally{item.dispose();}
});

test('the analytic actual-vertex envelope encloses the sampled solved sweep and pose changes allocate no new geometry',()=>{
 const item=build(T);try{const identities=item.parts.map(p=>p.mesh.geometry),count=item.geometries.length;for(const a of dimensions.finiteAngles){item.setAngle(a);for(const part of item.parts){const p=part.mesh.geometry.attributes.position;for(let i=0;i<p.count;i++){const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(part.mesh.matrixWorld);for(const [axis,n]of[['x',0],['y',1],['z',2]])assert.ok(v[axis]>=item.bounds.min[n]-1e-7&&v[axis]<=item.bounds.max[n]+1e-7);}}}
 assert.deepEqual(item.parts.map(p=>p.mesh.geometry),identities);assert.equal(item.geometries.length,count);assert.equal(item.budget.geometryAllocationsPerPose,0);assert.ok(item.budget.triangles<19000);assert.ok(item.budget.parts<100);assert.equal(item.bounds.min[1],0);assert.match(item.bounds.method,/not continuous collision proof/);
 }finally{item.dispose();}
});

test('every rendered resource is owned and repeated disposal releases each exactly once',()=>{
 const item=build(T),resources=[...new Set(item.geometries),...new Set(item.materials),...new Set(item.textures)],counts=new Map(resources.map(r=>[r,0]));for(const p of item.parts){assert.ok(item.geometries.includes(p.mesh.geometry));assert.ok(item.materials.includes(p.mesh.material));}
 for(const r of resources)r.addEventListener('dispose',()=>counts.set(r,counts.get(r)+1));item.dispose();item.dispose();assert.ok([...counts.values()].every(n=>n===1));assert.throws(()=>item.setAngle(60),/disposed/);
});

test('current original-card meadow placement has actual zero sole/floor gaps and a conservative card envelope, with an intrusive-card negative witness',()=>{
 const world=Town.createWorld(),saved=JSON.stringify(world),model=Scene.buildWorld(T,world,{}),item=build(T);try{const p=probePlacement(T,Scene,Town,world,model,item),c=p.originalSpriteEnvelopeClearance;
 assert.equal(p.actualWorldSolesChecked,true);assert.equal(p.feet.length,4);for(const foot of p.feet)assert.ok(Math.abs(foot.actualWorldSoleMinusFloor)<1e-7);assert.equal(p.finiteFootprintGrid.blocked,0);assert.equal(c.checkedCards,141);assert.ok(c.minimumGap>.45);assert.equal(c.requiredMargin,.2);assert.equal(c.physicalFixtureVolumes,false);assert.equal(c.allCameraProjectionOcclusionGuaranteed,false);assert.equal(p.normalPlacement,false);
 assert.throws(()=>probePlacement(T,Scene,Town,world,model,item,{x:780,y:700}),/original_fixture_visual_envelope_overlap/);
 let original;model.scene.traverse(o=>{if(!original&&o.isSprite&&o.userData.originalArtKind==='lantern')original=o;});const intruder=original.clone();intruder.position.set(p.worldPosition.x,p.worldPosition.y,p.worldPosition.z);model.scene.add(intruder);assert.throws(()=>probePlacement(T,Scene,Town,world,model,item),/original_fixture_visual_envelope_overlap/);assert.equal(JSON.stringify(world),saved);
 }finally{item.dispose();model.dispose();}
});

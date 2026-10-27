import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as T from '../static/vendor/three-0.160.1.module.js';
import {build,spec,validateAngle,dimensions} from '../static/pet-toolbox-lid-proof-20261027/mechanism.mjs';
import {auditPose,auditSweep,obb,separate} from '../static/pet-toolbox-lid-proof-20261027/inspection.mjs';
import {probePlacement} from '../static/pet-toolbox-lid-proof-20261027/placement.mjs';
import Town from '../static/pet-town-walk.js';
import Scene from '../static/pet-town-scene.js';
const near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<=t,a+' != '+b);
const ray=(mesh,origin,dir)=>new T.Raycaster(origin,dir,1e-6,20).intersectObject(mesh,false);
function shell(g){
 const p=g.attributes.position,n=g.attributes.normal,index=g.index,edges=new Map();let volume=0,triangles=0;
 for(const a of[p,n])assert.ok([...a.array].every(Number.isFinite));for(let i=0;i<n.count;i++)near(Math.hypot(n.getX(i),n.getY(i),n.getZ(i)),1,1e-5);
 const key=v=>v.toArray().map(x=>Math.round(x*1e6)).join(',');
 for(let i=0;i<(index?.count||p.count);i+=3){const v=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(p,index?index.getX(i+k):i+k));if(v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).lengthSq()<1e-18)continue;triangles++;volume+=v[0].dot(v[1].clone().cross(v[2]))/6;
 for(let k=0;k<3;k++){const a=key(v[k]),b=key(v[(k+1)%3]),id=[a,b].sort().join('/');const r=edges.get(id)||{count:0,orientation:0};r.count++;r.orientation+=a<b?1:-1;edges.set(id,r);}}
 assert.ok(volume>0,'positive outward signed volume');assert.ok([...edges.values()].every(e=>e.count===2&&e.orientation===0),'closed consistently oriented welded shell');return{volume,triangles,edges:edges.size};
}
test('source ancestry remains immutable and every final new/dependency file matches exact manifest bytes',async()=>{
 const base=new URL('../static/pet-toolbox-lid-proof-20261027/',import.meta.url),m=JSON.parse(await readFile(new URL('input-manifest.json',base)));
 for(const row of[...m.files,...m.dependencies]){const file=row.path.startsWith('/')?new URL('..'+row.path,import.meta.url):new URL(row.path,base),b=await readFile(file);assert.equal(createHash('sha256').update(b).digest('hex'),row.sha256,row.path);assert.equal(b.length,row.bytes);}
 assert.equal(spec.sourceImageSHA256,'6afc65a45e78a938b018987a85037a9bbbd4b63905aca1438927ea13d76db070');assert.equal(spec.predecessorManifestSHA256,'ef45f09cb30dd09e48e5edf341a9f321195f616c023a065bb73175ed03c1226e');assert.equal(spec.authoredUniformInstanceScale,.6);
 for(const v of[-.1,100.1,NaN,Infinity,'10',null])assert.throws(()=>validateAngle(v),/invalid_manual_lid_angle/);
 for(const k of['fullToolboxClosure','sealedStorage','loadFriction','continuousCollisionSafety','grip','body360','normalPlacement','unlock','save'])assert.equal(spec[k],false);
});
test('new boards, real bored barrels, retaining rings, through-pin and caps are closed outward shells',()=>{
 const item=build(T);try{for(const g of new Set(item.lidParts.map(p=>p.mesh.geometry)))shell(g);assert.equal(item.bores.length,5);assert.equal(item.lidParts.filter(p=>p.role==='moving-bore').length,3);assert.equal(item.lidParts.filter(p=>p.role==='fixed-bore').length,2);
 const b=item.bores[0].mesh,center=b.getWorldPosition(new T.Vector3()),dir=new T.Vector3(0,-1,0).transformDirection(b.matrixWorld),from=new T.Vector3(0,.2,0).applyMatrix4(b.matrixWorld);assert.ok(ray(b,from,dir).length,'actual outward exterior barrel wall is visible to a real ray');
 }finally{item.dispose();}
});
test('all five hinge barrels retain a real through-hole including the attached webs and bearing feet at finite radial probes',()=>{
 const item=build(T);try{for(const c of[45,62.5,80])for(const a of[0,50,100]){item.setCarrierAngle(c);item.setAngle(a);const center=item.shaft.getWorldPosition(new T.Vector3()),axis=new T.Vector3(1,0,0).transformDirection(item.shaft.matrixWorld),y=new T.Vector3(0,1,0).transformDirection(item.shaft.matrixWorld),z=new T.Vector3(0,0,1).transformDirection(item.shaft.matrixWorld);
 for(let k=0;k<8;k++){const phi=k*Math.PI/4,from=center.clone().addScaledVector(axis,-1.2).addScaledVector(y,.033*.6*Math.cos(phi)).addScaledVector(z,.033*.6*Math.sin(phi));
 for(const p of item.parts.filter(p=>!['hinge-pin','hinge-collar','hinge-cap'].includes(p.role)))assert.equal(ray(p.mesh,from,axis).length,0,p.id+' obstructs the authored bore probe');}}
 }finally{item.dispose();}
});
test('actual scaled pin radius, coaxial barrels, cap capture and shaft engagement are measured and negative defects rejected',()=>{
 const item=build(T);try{const p=auditPose(T,item);assert.ok(p.minimumBoreClearance>.0053);assert.ok(p.minimumPinOverhang>.0839);assert.ok(p.capRetentionMargin>.0185);assert.ok(p.maximumOffAxis<1e-12);
 for(const b of p.boreRows){assert.ok(b.innerVertexSamples>=128);near(b.actualPinRadius,.015,1e-7);near(b.axisDot,1,1e-12);}
 item.caps[0].scale.set(1,.4,.4);assert.ok(auditPose(T,item).capRetentionMargin<0,'shrinking a real endcap loses capture');item.caps[0].scale.set(1,1,1);
 item.shaft.position.y+=.02;assert.ok(auditPose(T,item).maximumOffAxis>.0119,'displaced physical pin is not coaxial');
 }finally{item.dispose();}
});
test('finite lid/carrier combinations have separating actual convex outer covers; an intrusive slab gives a negative witness',()=>{
 const item=build(T);try{const s=auditSweep(T,item);assert.equal(s.finitePoses,33);assert.equal(s.uniqueTests,0);assert.equal(s.collisionCount,0);assert.ok(s.rows.every(r=>r.checkedMovingFixedPairs>500&&r.finitePoseOnly&&r.continuousCollisionSafety===false));assert.ok(s.minimumBoreClearance>.0053);
 item.setAngle(0);item.byId.get('lid-board').position.y-=.15;assert.ok(auditPose(T,item).collisions.length>0,'lowered actual slab intersects tray side walls');
 }finally{item.dispose();}
});
test('both closed rests and the integral open stop make exact geometric endpoint contact and oppose overtravel',()=>{
 const item=build(T);try{for(const endpoint of[0,100]){item.setAngle(endpoint);const rows=auditPose(T,item).stopRows.filter(r=>r.endpoint===endpoint);assert.equal(rows.length,endpoint===0?2:1);for(const r of rows){assert.equal(r.separated,false);assert.ok(Math.abs(r.maxSeparation)<1e-7);}}
 item.setAngle(100);item.lidRoot.rotation.x=-100.2*Math.PI/180;item.group.updateMatrixWorld(true);let r=separate(T,obb(T,item.finger),obb(T,item.openStop));assert.ok(r.minimumOverlap>.0002);
 item.setAngle(0);item.lidRoot.rotation.x=.2*Math.PI/180;item.group.updateMatrixWorld(true);assert.ok(separate(T,obb(T,item.byId.get('lid-board')),obb(T,item.closedStops[0])).minimumOverlap>.0002);
 }finally{item.dispose();}
});
test('both fixed bearings physically connect through an integral bridge to the existing tray floor, not merely the scene parent',()=>{
 const item=build(T);try{for(const x of[.21,.79]){
  const foot=item.byId.get('fixed-knuckle-foot-'+x),bridge=item.byId.get('fixed-bearing-integral-bridge-'+x),floor=item.byId.get('closed-tray-bottom');
  let r=separate(T,obb(T,foot),obb(T,bridge));assert.ok(r.minimumOverlap>.02);r=separate(T,obb(T,bridge),obb(T,floor));assert.ok(r.minimumOverlap>.02);
  const from=new T.Vector3(x,.8,-.46).applyMatrix4(item.carrier.trayRoot.matrixWorld),down=new T.Vector3(0,-1,0).transformDirection(item.carrier.trayRoot.matrixWorld);
  const fh=ray(foot,from,down)[0],bh=ray(bridge,from,down)[0];assert.ok(fh&&bh);assert.ok(fh.point.distanceTo(bh.point)>.08);
  bridge.position.z-=.4;assert.equal(separate(T,obb(T,bridge),obb(T,floor)).separated,true,'detached bridge loses actual tray contact');bridge.position.z+=.4;
 }
 }finally{item.dispose();}
});
test('analytic actual-vertex envelope encloses finite combined poses without reallocating geometry or stretching the world',()=>{
 const item=build(T);try{const ids=item.parts.map(p=>p.mesh.geometry),count=item.geometries.length;for(const c of[45,51.3,62.5,73.9,80])for(const a of[0,17.8,50,83.7,100]){item.setCarrierAngle(c);item.setAngle(a);for(const p of item.parts){const ps=p.mesh.geometry.attributes.position;for(let j=0;j<ps.count;j++){const v=new T.Vector3().fromBufferAttribute(ps,j).applyMatrix4(p.mesh.matrixWorld);for(let i=0;i<3;i++)assert.ok(v.getComponent(i)>=item.bounds.min[i]-1e-7&&v.getComponent(i)<=item.bounds.max[i]+1e-7);}}}
 assert.deepEqual(item.parts.map(p=>p.mesh.geometry),ids);assert.equal(item.geometries.length,count);near(item.authoredScale,.6);assert.ok(item.bounds.size[1]<1.68);assert.equal(item.budget.geometryAllocationsPerPose,0);assert.ok(item.budget.triangles<25000);
 }finally{item.dispose();}
});
test('actual twenty floor witnesses, current road triangles and unchanged original-card envelopes pass one authored-scale preview placement',()=>{
 const item=build(T),world=Town.createWorld(),saved=JSON.stringify(world),model=Scene.buildWorld(T,world,{});try{const p=probePlacement(T,Scene,Town,world,model,item);assert.equal(p.feet.length,20);assert.ok(p.feet.every(f=>Math.abs(f.actualWorldSoleMinusFloor)<1e-7));assert.equal(p.finiteFootprintGrid.blocked,0);assert.ok(p.minimumRoadGap>.38);assert.ok(p.roads.reduce((n,r)=>n+r.triangles,0)>2000);assert.equal(p.originalSpriteEnvelopeClearance.checkedCards,141);assert.ok(p.originalSpriteEnvelopeClearance.minimumGap>.78);assert.equal(p.anatomicallyCalibratedScale,false);assert.equal(JSON.stringify(world),saved);
 assert.throws(()=>probePlacement(T,Scene,Town,world,model,item,{x:1300,y:1300}),/road_clearance/);
 let sprite;model.scene.traverse(o=>{if(!sprite&&o.isSprite&&o.userData.originalArt)sprite=o;});const bad=sprite.clone();bad.position.set(p.worldPosition.x,p.worldPosition.y,p.worldPosition.z);model.scene.add(bad);assert.throws(()=>probePlacement(T,Scene,Town,world,model,item),/original_card_overlap/);
 }finally{item.dispose();model.dispose();}
});
test('all inherited and new render resources release once; disposed manual input cannot move the assembly',()=>{
 const item=build(T),all=[...new Set(item.geometries),...new Set(item.materials),...new Set(item.textures)],counts=new Map(all.map(x=>[x,0]));for(const p of item.parts){assert.ok(item.geometries.includes(p.mesh.geometry));assert.ok(item.materials.includes(p.mesh.material));}
 for(const r of all)r.addEventListener('dispose',()=>counts.set(r,counts.get(r)+1));item.dispose();item.dispose();assert.ok([...counts.values()].every(n=>n===1));assert.throws(()=>item.setAngle(10),/disposed/);assert.throws(()=>item.setCarrierAngle(60),/disposed/);
});

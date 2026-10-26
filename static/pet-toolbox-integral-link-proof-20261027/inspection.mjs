/* Finite prismatic mesh checks. Not physical/friction or continuous collision certification. */
import {polygonSAT} from '../pet-toolbox-joint-proof-20261026/inspection.mjs';
import {dimensions} from './mechanism.mjs';
function hull(points){const unique=[...new Map(points.map(p=>[p.map(v=>Math.round(v*1e8)).join(','),p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);const lower=[],upper=[];for(const p of unique){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),p)<=1e-12)lower.pop();lower.push(p);}for(const p of unique.slice().reverse()){while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),p)<=1e-12)upper.pop();upper.push(p);}return lower.slice(0,-1).concat(upper.slice(0,-1));}
function prism(T,mesh){const p=mesh.geometry.attributes.position,xy=[];let minZ=Infinity,maxZ=-Infinity;for(let i=0;i<p.count;i++){const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);xy.push([v.x,v.y]);minZ=Math.min(minZ,v.z);maxZ=Math.max(maxZ,v.z);}return{polygon:hull(xy),minZ,maxZ};}
function separation(a,b){const zGap=Math.max(b.minZ-a.maxZ,a.minZ-b.maxZ);if(zGap>1e-7)return{separated:true,maxSeparation:zGap,minOverlap:0,axis:'z'};const result=polygonSAT(a.polygon,b.polygon);return{...result,minOverlap:result.separated?0:Math.min(result.minOverlap,-zGap),axis:'actual-XY-convex-profile-plus-Z-prism'};}
function coveredJointPair(a,b){const pin=p=>['pin','collar','endcap'].includes(p.role);return(pin(a)&&b.joints.some(j=>a.joints.includes(j))&&['rigid-link','bored-cheek'].includes(b.role))||(pin(b)&&a.joints.some(j=>b.joints.includes(j))&&['rigid-link','bored-cheek'].includes(a.role));}
export function auditPose(T,item){
 item.group.updateMatrixWorld(true);const profiles=new Map(item.parts.map(p=>[p.id,prism(T,p.mesh)])),collisions=[],tested=[];
 for(let i=0;i<item.parts.length;i++)for(let j=i+1;j<item.parts.length;j++){const a=item.parts[i],b=item.parts[j];if(a.assembly===b.assembly||coveredJointPair(a,b))continue;const result=separation(profiles.get(a.id),profiles.get(b.id));tested.push({a:a.id,b:b.id,...result});if(!result.separated&&result.minOverlap>2e-6)collisions.push({a:a.id,b:b.id,...result});}
 const rows=[],axis=new T.Vector3(0,0,1),pinCenters={},endplay=[];
 for(const joint of['A','B']){
  const pin=item.byId.get(joint+'-through-pin'),center=pin.getWorldPosition(new T.Vector3());pinCenters[joint]=center;const pp=pin.geometry.attributes.position;let actualPinRadius=0;
  for(let i=0;i<pp.count;i++){const v=new T.Vector3().fromBufferAttribute(pp,i).applyMatrix4(pin.matrixWorld);actualPinRadius=Math.max(actualPinRadius,Math.hypot(v.x-center.x,v.y-center.y));}
  for(const part of item.parts.filter(p=>['rigid-link','bored-cheek'].includes(p.role)&&p.joints.includes(joint))){
   const entries=part.mesh.geometry.userData.bores||[part.mesh.geometry.userData.bore],bore=part.role==='rigid-link'?entries[joint==='A'?0:1]:entries[0],localCenter=bore.center;
   const worldCenter=new T.Vector3(...localCenter,0).applyMatrix4(part.mesh.matrixWorld),p=part.mesh.geometry.attributes.position;let minimum=Infinity,samples=0;
   for(let i=0;i<p.count;i++){const v=new T.Vector3().fromBufferAttribute(p,i);if(Math.abs(Math.hypot(v.x-localCenter[0],v.y-localCenter[1])-bore.nominalRadius)<1e-6){v.applyMatrix4(part.mesh.matrixWorld);minimum=Math.min(minimum,Math.hypot(v.x-center.x,v.y-center.y));samples++;}}
   rows.push({joint,id:part.id,innerVertexSamples:samples,offAxis:Math.hypot(worldCenter.x-center.x,worldCenter.y-center.y),axisDot:Math.abs(new T.Vector3(0,0,1).transformDirection(part.mesh.matrixWorld).dot(axis)),actualPinRadius,minimumBoreVertexRadius:minimum,radialChordClearance:minimum*Math.cos(Math.PI/48)-actualPinRadius});
  }
  const cheek=item.parts.filter(p=>p.role==='bored-cheek'&&p.joints.includes(joint)).map(p=>profiles.get(p.id)).sort((a,b)=>a.minZ-b.minZ),bar=profiles.get('two-bored-rigid-link'),shaft=profiles.get(joint+'-through-pin');
  const collars=[-1,1].map(sign=>{const collar=profiles.get(joint+'-retaining-collar-'+sign),cap=profiles.get(joint+'-closed-endcap-'+sign),board=cheek[sign<0?0:1];
   return{side:sign,boardToCollarAxialGap:sign<0?board.minZ-collar.maxZ:collar.minZ-board.maxZ,collarToEndcapAxialGap:sign<0?collar.minZ-cap.maxZ:cap.minZ-collar.maxZ,shaftEndToCapGap:sign<0?shaft.minZ-cap.maxZ:cap.minZ-shaft.maxZ};});
  endplay.push({joint,boardTongueAxialGaps:[bar.minZ-cheek[0].maxZ,cheek[1].minZ-bar.maxZ],collars});
 }
 const linkEndpoints=[new T.Vector3(0,0,0).applyMatrix4(item.link.matrixWorld),new T.Vector3(dimensions.linkLength,0,0).applyMatrix4(item.link.matrixWorld)];
 const stops=item.stopRecords.map(s=>({joint:s.joint,endpoint:s.endpoint,id:s.mesh.name,...separation(profiles.get('two-bored-rigid-link'),profiles.get(s.mesh.name))}));
 return{...item.getState(),linkEndpointClosure:[linkEndpoints[0].distanceTo(pinCenters.A),linkEndpoints[1].distanceTo(pinCenters.B)],actualPivotDistance:pinCenters.A.distanceTo(pinCenters.B),boreRows:rows,endplay,stops,collisions,checkedCrossAssemblyPairs:tested.length,finiteMeshPrismSAT:true,
  method:'actual transformed vertex convex XY silhouettes and real Z slabs; bored pin pairs excluded only after separate bore/axis/endplay checks',physicalLoadFriction:false,continuousCollisionGuarantee:false};
}
export function auditSweep(T,item,aSteps=10,bSteps=8){
 if(!Number.isInteger(aSteps)||!Number.isInteger(bSteps)||aSteps<1||bSteps<1||aSteps>100||bSteps>100)throw Error('invalid_finite_steps');
 const before=item.getState(),rows=[];for(let ia=0;ia<=aSteps;ia++)for(let ib=0;ib<=bSteps;ib++){item.setPose(20+30*ia/aSteps,-20+20*ib/bSteps);rows.push(auditPose(T,item));}item.setPose(before.angleADegrees,before.angleBDegrees);
 return{finitePoses:rows.length,uniqueTests:0,maximumClosure:Math.max(...rows.flatMap(r=>r.linkEndpointClosure)),minimumRadialChordClearance:Math.min(...rows.flatMap(r=>r.boreRows.map(b=>b.radialChordClearance))),maximumBoreOffAxis:Math.max(...rows.flatMap(r=>r.boreRows.map(b=>b.offAxis))),collisionCount:rows.reduce((n,r)=>n+r.collisions.length,0),rows,scope:'finite two-coordinate samples only; not that many unique tests and not a continuous collision/physical guarantee'};
}

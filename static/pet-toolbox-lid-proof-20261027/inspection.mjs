/* Conservative oriented-box separation witnesses of actual meshes at finite poses. */
import {dimensions} from './mechanism.mjs';
export function obb(T,mesh){mesh.updateWorldMatrix(true,false);const b=mesh.geometry.boundingBox|| (mesh.geometry.computeBoundingBox(),mesh.geometry.boundingBox),center=b.getCenter(new T.Vector3()).applyMatrix4(mesh.matrixWorld),half=b.getSize(new T.Vector3()).multiplyScalar(.5),axes=[new T.Vector3(1,0,0),new T.Vector3(0,1,0),new T.Vector3(0,0,1)],e=[];
 for(let i=0;i<3;i++){const raw=axes[i].clone().applyMatrix3(new T.Matrix3().setFromMatrix4(mesh.matrixWorld));e.push(half.getComponent(i)*raw.length());axes[i]=raw.normalize();}return{center,half:e,axes};}
export function separate(T,a,b){const delta=b.center.clone().sub(a.center),axes=[...a.axes,...b.axes];for(const u of a.axes)for(const v of b.axes){const w=u.clone().cross(v);if(w.lengthSq()>1e-18)axes.push(w.normalize());}
 let greatest=-Infinity;for(const axis of axes){const ra=a.axes.reduce((n,u,i)=>n+a.half[i]*Math.abs(u.dot(axis)),0),rb=b.axes.reduce((n,u,i)=>n+b.half[i]*Math.abs(u.dot(axis)),0);greatest=Math.max(greatest,Math.abs(delta.dot(axis))-ra-rb);}
 return{separated:greatest>1e-7,maxSeparation:greatest,minimumOverlap:Math.max(0,-greatest),method:'15-axis conservative OBB of actual local bounds and world transforms'};}
function hull2(points){const p=[...new Map(points.map(v=>[v.map(n=>Math.round(n*1e8)).join(','),v])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]),cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),lo=[],hi=[];for(const v of p){while(lo.length>1&&cross(lo.at(-2),lo.at(-1),v)<=1e-12)lo.pop();lo.push(v);}for(const v of p.slice().reverse()){while(hi.length>1&&cross(hi.at(-2),hi.at(-1),v)<=1e-12)hi.pop();hi.push(v);}return lo.slice(0,-1).concat(hi.slice(0,-1));}
function profile(T,row){
 const mesh=row.mesh,axisX=mesh.geometry.userData.annularX||row.role.startsWith('hinge-'),p=mesh.geometry.attributes.position,xy=[];let low=Infinity,high=-Infinity;
 for(let i=0;i<p.count;i++){const v=new T.Vector3().fromBufferAttribute(p,i);xy.push(axisX?[v.y,v.z]:[v.x,v.y]);low=Math.min(low,axisX?v.x:v.z);high=Math.max(high,axisX?v.x:v.z);}
 const loop=hull2(xy),local=(a,b,c)=>axisX?new T.Vector3(c,a,b):new T.Vector3(a,b,c),points=[];
 for(const n of[low,high])for(const v of loop)points.push(local(v[0],v[1],n).applyMatrix4(mesh.matrixWorld));
 const axis=(axisX?new T.Vector3(1,0,0):new T.Vector3(0,0,1)).transformDirection(mesh.matrixWorld),normals=[axis],edges=[axis];
 for(let i=0;i<loop.length;i++){const a=loop[i],b=loop[(i+1)%loop.length],edge=local(b[0]-a[0],b[1]-a[1],0).transformDirection(mesh.matrixWorld);edges.push(edge);normals.push(edge.clone().cross(axis).normalize());}
 return{points,normals,edges,solidConvexCover:true};}
export function convexSeparation(T,a,b){
 const axes=[...a.normals,...b.normals],seen=new Set();let best=-Infinity;
 function inspect(raw){if(raw.lengthSq()<1e-18)return false;const axis=raw.clone().normalize(),key=[axis.x,axis.y,axis.z].map(n=>Math.round(Math.abs(n)*1e8)).join(',')+'/'+Math.sign(axis.x*axis.y)+'/'+Math.sign(axis.y*axis.z);if(seen.has(key))return false;seen.add(key);
  let alo=Infinity,ahi=-Infinity,blo=Infinity,bhi=-Infinity;for(const p of a.points){const d=p.dot(axis);alo=Math.min(alo,d);ahi=Math.max(ahi,d);}for(const p of b.points){const d=p.dot(axis);blo=Math.min(blo,d);bhi=Math.max(bhi,d);}const gap=Math.max(blo-ahi,alo-bhi);best=Math.max(best,gap);return gap>1e-7;}
 for(const axis of axes)if(inspect(axis))return{separated:true,maxSeparation:best,minimumOverlap:0,method:'actual transformed convex outer-prism SAT; through-bore pin exclusions measured separately'};
 for(const u of a.edges)for(const v of b.edges)if(inspect(u.clone().cross(v)))return{separated:true,maxSeparation:best,minimumOverlap:0,method:'actual transformed convex outer-prism SAT'};
 return{separated:false,maxSeparation:best,minimumOverlap:Math.max(0,-best),method:'convex outer covers overlap; not a positive solid intersection proof through holes'};}

function throughPair(a,b){const roles=new Set([a.role,b.role]);return(roles.has('moving-bore')||roles.has('fixed-bore'))&&roles.has('hinge-pin');}
export function auditPose(T,item){
 item.group.updateMatrixWorld(true);const boxes=new Map(item.parts.map(p=>[p.id,obb(T,p.mesh)])),profiles=new Map(item.parts.map(p=>[p.id,profile(T,p)])),moving=item.lidParts.filter(p=>p.assembly==='lid'),fixed=item.parts.filter(p=>p.assembly!=='lid'),collisions=[];let checked=0;
 for(const a of moving)for(const b of fixed){if(throughPair(a,b))continue;checked++;let s=separate(T,boxes.get(a.id),boxes.get(b.id));if(!s.separated)s=convexSeparation(T,profiles.get(a.id),profiles.get(b.id));if(!s.separated&&s.minimumOverlap>2e-6)collisions.push({a:a.id,b:b.id,...s});}
 const center=item.shaft.getWorldPosition(new T.Vector3()),axis=new T.Vector3(1,0,0).transformDirection(item.shaft.matrixWorld),shaftBox=boxes.get(item.shaft.name),shaftEnds=[-1,1].map(sign=>center.clone().addScaledVector(axis,sign*shaftBox.half[0]));
 let actualPinRadius=0;{const ps=item.shaft.geometry.attributes.position;for(let i=0;i<ps.count;i++){const v=new T.Vector3().fromBufferAttribute(ps,i).applyMatrix4(item.shaft.matrixWorld).sub(center);actualPinRadius=Math.max(actualPinRadius,v.addScaledVector(axis,-v.dot(axis)).length());}}
 const boreRows=item.bores.map(row=>{const mesh=row.mesh,g=mesh.geometry,p=g.attributes.position,c=mesh.getWorldPosition(new T.Vector3()),offset=c.clone().sub(center),offAxis=offset.clone().addScaledVector(axis,-offset.dot(axis)).length();let inner=Infinity,outer=0,samples=0;
  for(let i=0;i<p.count;i++){const local=new T.Vector3().fromBufferAttribute(p,i);if(Math.abs(Math.hypot(local.y,local.z)-g.userData.innerRadius)<1e-7){const w=local.applyMatrix4(mesh.matrixWorld).sub(center),rad=w.addScaledVector(axis,-w.dot(axis)).length();inner=Math.min(inner,rad);outer=Math.max(outer,rad);samples++;}}
  const pos=c.clone().sub(center).dot(axis),length=g.userData.length*new T.Vector3(1,0,0).applyMatrix3(new T.Matrix3().setFromMatrix4(mesh.matrixWorld)).length(),half=length/2;
  return{id:row.id,offAxis,axisDot:Math.abs(new T.Vector3(1,0,0).transformDirection(mesh.matrixWorld).dot(axis)),innerVertexSamples:samples,minimumInnerVertexRadius:inner,maximumInnerVertexRadius:outer,
   chordRadialClearance:inner*Math.cos(Math.PI/64)-actualPinRadius,actualPinRadius,axialOverhang:[pos-half+shaftBox.half[0],shaftBox.half[0]-pos-half]};});
 const capRadii=item.caps.map(mesh=>{let r=0;const p=mesh.geometry.attributes.position;for(let i=0;i<p.count;i++){const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld).sub(center);r=Math.max(r,v.addScaledVector(axis,-v.dot(axis)).length());}return r;});
 const capRetentionMargin=Math.min(...capRadii)*Math.cos(Math.PI/64)-Math.max(...boreRows.map(b=>b.maximumInnerVertexRadius));
 const stopRows=item.closedStops.map(mesh=>({id:mesh.name,endpoint:0,...separate(T,boxes.get('lid-board'),boxes.get(mesh.name))}));stopRows.push({id:item.openStop.name,endpoint:100,...separate(T,boxes.get(item.finger.name),boxes.get(item.openStop.name))});
 return{...item.getState(),checkedMovingFixedPairs:checked,collisions,boreRows,minimumBoreClearance:Math.min(...boreRows.map(b=>b.chordRadialClearance)),maximumOffAxis:Math.max(...boreRows.map(b=>b.offAxis)),minimumPinOverhang:Math.min(...boreRows.flatMap(b=>b.axialOverhang)),capRetentionMargin,stopRows,
  finitePoseOnly:true,conservativeUnmatchedSolidBounds:true,matchingThroughPinSeparatelyAudited:true,continuousCollisionSafety:false,physicalLoadFriction:false};}
export function auditSweep(T,item,{carrierAngles=dimensions.finiteCarrierAngles,lidAngles=dimensions.finiteLidAngles}={}){
 if(!Array.isArray(carrierAngles)||!Array.isArray(lidAngles)||!carrierAngles.length||!lidAngles.length||carrierAngles.length*lidAngles.length>500)throw Error('invalid_finite_pose_set');
 const before=item.getState(),rows=[];try{for(const c of carrierAngles){item.setCarrierAngle(c);for(const a of lidAngles){item.setAngle(a);rows.push(auditPose(T,item));}}}finally{item.setCarrierAngle(before.carrierAngleDegrees);item.setAngle(before.lidAngleDegrees);}
 return{finitePoses:rows.length,carrierAngles:carrierAngles.slice(),lidAngles:lidAngles.slice(),uniqueTests:0,collisionCount:rows.reduce((n,r)=>n+r.collisions.length,0),maximumOffAxis:Math.max(...rows.map(r=>r.maximumOffAxis)),minimumBoreClearance:Math.min(...rows.map(r=>r.minimumBoreClearance)),minimumPinOverhang:Math.min(...rows.map(r=>r.minimumPinOverhang)),minimumCapRetentionMargin:Math.min(...rows.map(r=>r.capRetentionMargin)),rows,
  scope:'3 carrier poses ×11 lid poses, not33 unique tests or a continuous no-collision/load certificate'};}

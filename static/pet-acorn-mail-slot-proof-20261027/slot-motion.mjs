import {build as buildMailbox,spec as mailboxSpec} from '../pet-acorn-mailbox-proof-20261027/mailbox.mjs';
export const spec=Object.freeze({id:'acorn-mail-slot-clearance-v1',unit:'wardrobe:item:acorn-mailbox:manual-mail-slot-clearance:v1',mailboxSourceSHA:'da25e37cc641fbafb01ffe7025e7300e86870e10a7fbb1b0d82026fcddbdd6fb',originalSHA:mailboxSpec.sourceSHA,dimensions:Object.freeze({width:.44,thickness:.010,depth:.24}),centerX:0,centerY:1.565,startZ:.62,endZ:-.05,finiteProgressSamples:21,dimensionsAuthoredNotMeasured:true,bodyBinding:null,actualDelivery:false,physicalPaperSimulation:false,characterGrip:false,normalPlacement:false,ownershipUnlockSave:false,continuousCollisionCertified:false,initialBlankCauseEstablished:false,initializationConsistencyVerified:false});
const finite=n=>typeof n==='number'&&Number.isFinite(n),clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function segmentDistance(T,a,b,c,d){
 const u=b.clone().sub(a),v=d.clone().sub(c),w=a.clone().sub(c),aa=u.dot(u),bb=u.dot(v),cc=v.dot(v),dd=u.dot(w),ee=v.dot(w),den=aa*cc-bb*bb;let s=0,t=0;
 if(aa<1e-24&&cc<1e-24)return a.distanceTo(c);
 if(aa<1e-24)t=clamp(ee/cc,0,1);
 else if(cc<1e-24)s=clamp(-dd/aa,0,1);
 else{s=den>1e-24?clamp((bb*ee-cc*dd)/den,0,1):0;t=(bb*s+ee)/cc;if(t<0){t=0;s=clamp(-dd/aa,0,1);}else if(t>1){t=1;s=clamp((bb-dd)/aa,0,1);}}
 return w.addScaledVector(u,s).addScaledVector(v,-t).length();
}
function boxPoints(T,b){return [0,1,2,3,4,5,6,7].map(i=>new T.Vector3(i&1?b.max.x:b.min.x,i&2?b.max.y:b.min.y,i&4?b.max.z:b.min.z));}
const edges=[[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];
const boxGap=(a,b)=>Math.hypot(...['x','y','z'].map(k=>Math.max(0,a.min[k]-b.max[k],b.min[k]-a.max[k])));
export function triangleBoxDistance(T,triangle,box){
 if(box.intersectsTriangle(triangle))return 0;
 const points=boxPoints(T,box),vs=[triangle.a,triangle.b,triangle.c],closest=new T.Vector3();let gap=Math.min(...vs.map(v=>box.distanceToPoint(v)));
 for(const p of points)gap=Math.min(gap,p.distanceTo(triangle.closestPointToPoint(p,closest)));
 for(let i=0;i<3;i++)for(const [a,b]of edges)gap=Math.min(gap,segmentDistance(T,vs[i],vs[(i+1)%3],points[a],points[b]));
 return gap;
}
function insideSolid(T,triangles,p){let angle=0;for(const row of triangles){const a=row.triangle.a.clone().sub(p),b=row.triangle.b.clone().sub(p),c=row.triangle.c.clone().sub(p),la=a.length(),lb=b.length(),lc=c.length();angle+=2*Math.atan2(a.dot(b.clone().cross(c)),la*lb*lc+a.dot(b)*lc+b.dot(c)*la+c.dot(a)*lb);}return Math.abs(angle)>3.5*Math.PI;}
function cacheParts(T,mailbox){mailbox.group.updateMatrixWorld(true);return mailbox.parts.map(part=>{const mesh=part.mesh,p=mesh.geometry.attributes.position,index=mesh.geometry.index,triangles=[];for(let i=0;i<(index?index.count:p.count);i+=3){const points=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(p,index?index.getX(i+k):i+k).applyMatrix4(mesh.matrixWorld));triangles.push({triangle:new T.Triangle(...points),bounds:new T.Box3().setFromPoints(points)});}return{id:part.id,role:part.role,bounds:new T.Box3().setFromObject(mesh,true),triangles};});}
export function build(T){
 const mailbox=buildMailbox(T);mailbox.setAngle(0);const cached=cacheParts(T,mailbox),own={geometries:new Set(),materials:new Set(),textures:new Set()},geometry=new T.BoxGeometry(spec.dimensions.width,spec.dimensions.thickness,spec.dimensions.depth),material=new T.MeshStandardMaterial({color:'#f6e7c8',roughness:.91,metalness:0}),body=new T.Mesh(geometry,material);own.geometries.add(geometry);own.materials.add(material);body.name='authored-rigid-envelope';body.castShadow=true;body.receiveShadow=true;mailbox.group.add(body);
 let progress=0,disposed=false,last=null;
 function candidateBox(p,changes={}){
  if(!finite(p)||p<0||p>1)throw Error('slot_progress_invalid');
  const d={...spec.dimensions,x:spec.centerX,y:spec.centerY,startZ:spec.startZ,endZ:spec.endZ,...changes};
  if(!['width','thickness','depth','x','y','startZ','endZ'].every(k=>finite(d[k]))||d.width<=0||d.thickness<=0||d.depth<=0)throw Error('slot_candidate_invalid');
  const center=new T.Vector3(d.x,d.y,d.startZ+(d.endZ-d.startZ)*p),half=new T.Vector3(d.width,d.thickness,d.depth).multiplyScalar(.5);
  return{box:new T.Box3(center.clone().sub(half),center.clone().add(half)),center,dimensions:d};
 }
 function evaluate(p,changes={}){
  if(disposed)throw Error('slot_disposed');if(mailbox.angle!==0)throw Error('slot_hatch_not_closed');
  const c=candidateBox(p,changes),surfaceIntersections=[],containedByParts=[];let minimumGap=Infinity,nearTriangles=0,triangleCount=0;
  for(const part of cached){
   triangleCount+=part.triangles.length;const coarse=boxGap(part.bounds,c.box);
   if(part.bounds.containsPoint(c.center)&&insideSolid(T,part.triangles,c.center))containedByParts.push(part.id);
   if(coarse>minimumGap)continue;
   for(const row of part.triangles){
    if(boxGap(row.bounds,c.box)>minimumGap)continue;nearTriangles++;
    const gap=triangleBoxDistance(T,row.triangle,c.box);minimumGap=Math.min(minimumGap,gap);
    if(gap===0&&!surfaceIntersections.includes(part.id))surfaceIntersections.push(part.id);
   }
  }
  return{progress:p,center:c.center.toArray(),box:{min:c.box.min.toArray(),max:c.box.max.toArray()},dimensions:c.dimensions,clear:surfaceIntersections.length===0&&containedByParts.length===0,minimumTriangleBoxGap:minimumGap,surfaceIntersections,containedByParts,actualMailboxParts:cached.length,actualMailboxTriangles:triangleCount,narrowTriangles:nearTriangles,hatchAngle:mailbox.angle,finiteSinglePoseOnly:true,continuousCollisionCertified:false};
 }
 function setProgress(p){
  const result=evaluate(p);if(!result.clear)throw Error('slot_actual_mesh_obstructed');
  progress=p;body.position.set(...result.center);mailbox.group.updateMatrixWorld(true);last=result;return result;
 }
 function certificate(changes={}){
  const poses=Array.from({length:spec.finiteProgressSamples},(_,i)=>evaluate(i/(spec.finiteProgressSamples-1),changes));
  return{samples:poses.length,allFinitePosesClear:poses.every(p=>p.clear),minimumTriangleBoxGap:Math.min(...poses.map(p=>p.minimumTriangleBoxGap)),poses,finiteSamplesAreNotUniqueTests:true,continuousCollisionCertified:false,physicalPaperOrFrictionVerified:false};
 }
 const resources=Object.fromEntries(Object.keys(own).map(k=>[k,new Set([...mailbox.resources[k],...own[k]])]));
 const start=candidateBox(0).box,end=candidateBox(1).box,full=new T.Box3(new T.Vector3(...mailbox.restBounds.min),new T.Vector3(...mailbox.restBounds.max)).union(start).union(end),bounds={min:full.min.toArray(),max:full.max.toArray(),size:full.getSize(new T.Vector3()).toArray()};
 function budget(){return{meshes:mailbox.budget.meshes+1,geometries:resources.geometries.size,materials:resources.materials.size,textures:resources.textures.size,triangles:mailbox.budget.triangles+12,lights:0};}
 setProgress(0);
 return{group:mailbox.group,feet:mailbox.feet,parts:[...mailbox.parts,{id:body.name,role:'diagnostic-envelope',mesh:body}],mailbox,body,bounds,resources,spec,evaluate,certificate,setProgress,
 step(delta){if(!finite(delta))throw Error('slot_step_invalid');return setProgress(clamp(progress+delta,0,1));},reset(){return setProgress(0);},
 addTexture(texture){if(disposed)throw Error('slot_disposed');own.textures.add(texture);resources.textures.add(texture);material.map=texture;material.needsUpdate=true;},
 inspect(){return{model_id:spec.id,unit_id:spec.unit,progress,budget:budget(),bounds,currentPose:last,mailboxAngle:mailbox.angle,unchangedMailboxSourceSHA:spec.mailboxSourceSHA,unchangedOriginalSHA:spec.originalSHA,envelopeWorldDimensionsAuthored:spec.dimensions,dimensionsNotPaperOrBodyMeasurements:true,bodyBinding:null,actualDelivery:false,dropGravityFriction:false,characterGrip:false,normalPlacement:false,ownershipUnlockSave:false,continuousCollisionCertified:false,initialBlankCauseEstablished:false,initializationConsistencyVerified:false};},
 get progress(){return progress;},get disposed(){return disposed;},
 dispose(){if(disposed)return;disposed=true;for(const set of Object.values(own))for(const resource of set)resource.dispose();mailbox.dispose();}
 };
}

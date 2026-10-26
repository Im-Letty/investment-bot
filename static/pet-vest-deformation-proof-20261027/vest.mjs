import {build as buildFrozen,fitCamera} from '../pet-vest-volume-proof-20261026/vest.mjs';
export {fitCamera};
export const SPEC=Object.freeze({
 id:'komorebi-vest-local-deformation-v1',
 unit:'wardrobe:fit-prerequisite:komorebi-vest:local-deformation-socket-transport:v1',
 sourceRecipeSHA:'07d2ab9a87c29ffc8bc2cfb56c55760c482d5041e6b8f17b3d02db888e97566f',
 sourceManifestSHA:'e31b1f19b5a3b931d2eaf18c92ced3d47e76569f2c23cc04a76a3351f41db60e',
 sourceAsset:'prepared_clothing_01_v1',sourceAssetSHA:'9f47ad550c0925db40f04f1be0071dff87c54431e393d44f6a5c98fd80d08bba',
 maxAmplitude:.045,pinnedAboveY:.82,units:'existing authored garment-local units',
 deformation:'x += amplitude * smoothstep(clamp((.82-y)/.82)); y,z unchanged; inverse subtracts the same shift; analytic Jacobian determinant 1',
 scope:'standalone authored garment-local deformation and socket transport only; no material elasticity measurement or body evidence',
 bodyBinding:null,characterRig:false,calibrationApproved:false,wearingFit:false,allGrowthFit:false,characterBody360:false,
 functionalFastenerVerified:false,normalGame:false,unlock:false,save:false,newDesigns:0,newRawVersions:0,imagegenCalls:0
});
const weight=y=>{const t=Math.max(0,Math.min(1,(SPEC.pinnedAboveY-y)/SPEC.pinnedAboveY));return t*t*(3-2*t);};
export function deformPoint(point,amplitude,inverse=false){
 if(!Number.isFinite(amplitude)||Math.abs(amplitude)>SPEC.maxAmplitude||point.length!==3||!point.every(Number.isFinite))throw Error('invalid_deformation');
 return[point[0]+(inverse?-1:1)*amplitude*weight(point[1]),point[1],point[2]];
}
function signedVolume(T,mesh){
 const g=mesh.geometry,p=g.attributes.position,ix=g.index.array,a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();let v=0;
 for(let i=0;i<ix.length;i+=3){a.fromBufferAttribute(p,ix[i]);b.fromBufferAttribute(p,ix[i+1]);c.fromBufferAttribute(p,ix[i+2]);v+=a.dot(b.cross(c))/6;}return v;
}
export function build(T){
 const frozen=buildFrozen(T),restSockets=frozen.sockets,records=frozen.parts.map(part=>{
  part.updateMatrix();const matrix=part.matrix.clone(),inverse=matrix.clone().invert(),local=new Float32Array(part.geometry.attributes.position.array),world=[];
  for(let i=0;i<local.length;i+=3)world.push(...new T.Vector3(...local.slice(i,i+3)).applyMatrix4(matrix).toArray());
  return{part,matrix,inverse,local,world:new Float64Array(world)};
 });
 const envelope=structuredClone(frozen.bounds);envelope.min[0]-=SPEC.maxAmplitude;envelope.max[0]+=SPEC.maxAmplitude;
 envelope.size=envelope.max.map((x,i)=>x-envelope.min[i]);envelope.center=envelope.max.map((x,i)=>(x+envelope.min[i])/2);
 let amplitude=0,dead=false,sockets={},bounds=structuredClone(frozen.bounds),revision=0;
 function live(){if(dead)throw Error('disposed');}
 function updateSockets(){
  const p=frozen.shell.geometry.attributes.position,n=frozen.shell.geometry.attributes.normal;const next={};
  for(const[name,rest]of Object.entries(restSockets)){
   const position=new T.Vector3().fromBufferAttribute(p,rest.outerSurfaceVertex),z=new T.Vector3().fromBufferAttribute(n,rest.outerSurfaceVertex).normalize(),y=new T.Vector3(0,1,0).addScaledVector(z,-z.y);
   if(y.lengthSq()<.001)y.set(0,0,1).addScaledVector(z,-z.z);y.normalize();const x=y.clone().cross(z).normalize();y.copy(z).cross(x).normalize();
   next[name]=Object.freeze({...rest,actualSurfacePosition:Object.freeze(position.toArray()),actualSurfaceNormal:Object.freeze(z.toArray()),localMatrix:Object.freeze(new T.Matrix4().makeBasis(x,y,z).setPosition(position).toArray()),restSurfacePosition:rest.actualSurfacePosition,amplitude,revision,bodyBinding:null,bodySourceSHA:null});
  }sockets=Object.freeze(next);
 }
 function setAmplitude(value){
  live();if(!Number.isFinite(value)||Math.abs(value)>SPEC.maxAmplitude)throw Error('invalid_deformation');
  amplitude=value;revision++;
  for(const r of records){const p=r.part.geometry.attributes.position;
   if(value===0)p.array.set(r.local);else for(let i=0;i<r.world.length;i+=3){const q=deformPoint([r.world[i],r.world[i+1],r.world[i+2]],value),v=new T.Vector3(...q).applyMatrix4(r.inverse);p.array[i]=v.x;p.array[i+1]=v.y;p.array[i+2]=v.z;}
   p.needsUpdate=true;r.part.geometry.computeVertexNormals();r.part.geometry.computeBoundingBox();r.part.geometry.computeBoundingSphere();
  }
  frozen.group.updateMatrixWorld(true);const box=new T.Box3().setFromObject(frozen.group);bounds={min:box.min.toArray(),max:box.max.toArray(),size:box.getSize(new T.Vector3()).toArray(),center:box.getCenter(new T.Vector3()).toArray()};updateSockets();return amplitude;
 }
 function openCorridors(){
  frozen.group.updateMatrixWorld(true);
  const cases={neck:[[0,2,0],[0,-1,0]],leftArm:[[-2,.61*1.05,0],[1,0,0]],rightArm:[[2,.61*1.05,0],[-1,0,0]],hem:[[0,-1,0],[0,1,0]]};
  return Object.fromEntries(Object.entries(cases).map(([name,[o,d]])=>[name,new T.Raycaster(new T.Vector3(...o),new T.Vector3(...d),0,10).intersectObject(frozen.group,true).length===0]));
 }
 function snapshot(){
  live();let maxDisplacement=0,movedVertices=0,socketSurfaceGap=0;
  for(const r of records){const p=r.part.geometry.attributes.position;for(let i=0;i<p.count;i++){const q=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(r.matrix),d=q.distanceTo(new T.Vector3(...r.world.slice(i*3,i*3+3)));maxDisplacement=Math.max(maxDisplacement,d);if(d>1e-7)movedVertices++;}}
  for(const s of Object.values(sockets)){const p=new T.Vector3().fromBufferAttribute(frozen.shell.geometry.attributes.position,s.outerSurfaceVertex);socketSurfaceGap=Math.max(socketSurfaceGap,p.distanceTo(new T.Vector3(...s.actualSurfacePosition)));}
  return{spec:SPEC,amplitude,revision,maxDisplacement,movedVertices,socketSurfaceGap,shellSignedVolume:signedVolume(T,frozen.shell),openCorridors:openCorridors(),sockets,bounds,envelope,parts:frozen.parts.map(p=>p.name),triangles:frozen.budget.triangles,bodyBinding:null,characterRig:false,wearingFit:false,continuousCollisionSafetyVerified:false};
 }
 updateSockets();
 return{...frozen,spec:SPEC,envelope,restRecords:records,setAmplitude,snapshot,openCorridors,
  get amplitude(){return amplitude;},get sockets(){return sockets;},get bounds(){return bounds;},get disposed(){return dead;},
  resolveSocket(name){live();if(!sockets[name])throw Error('unknown_garment_socket');return sockets[name];},
  dispose(){if(dead)return false;dead=true;return frozen.dispose();}
 };
}

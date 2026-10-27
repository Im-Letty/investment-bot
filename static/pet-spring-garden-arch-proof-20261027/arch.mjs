/* Freestanding spring trellis candidate. The dimensions are authored, not anatomy. */
export const spec=Object.freeze({id:'spring-garden-arch-v1',unit:'village:asset-library:spring-garden-arch:v1',revision:1,category:'trees_and_landscape',style:'soft_pearl_elegant',season:'spring',innerRadius:.83,outerRadius:.96,springHeight:1.54,frameDepth:.10,frameZ:.24,baseY:.06,passage:Object.freeze({halfWidth:.65,height:1.90,entryZ:.58,exitZ:-.58}),bodyBinding:null,normalPlacement:false,ownershipUnlockSave:false});
export function build(T){
 const group=new T.Group();group.name=spec.id;
 const resources={geometries:new Set(),materials:new Set(),textures:new Set()},parts=[],frames=[],feet=[],rungs=[],flowers=[],joints=[];
 const mat=(color)=>{const m=new T.MeshStandardMaterial({color,roughness:.83,metalness:0});resources.materials.add(m);return m;};
 const cream=mat('#eadcc6'),wood=mat('#a88c69'),stone=mat('#c8c1ae'),pink=mat('#e5b9c2'),pollen=mat('#d8bd83'),leaf=mat('#87a276');
 const geometries={box:new T.BoxGeometry(1,1,1),sphere:new T.SphereGeometry(1,8,6),cylinder:new T.CylinderGeometry(1,1,1,8,1,false)};
 for(const g of Object.values(geometries))resources.geometries.add(g);
 function part(id,g,m,position,scale=[1,1,1],role='detail'){
  const mesh=new T.Mesh(g,m);mesh.name=id;mesh.position.fromArray(position);mesh.scale.fromArray(scale);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);parts.push({id,role,mesh});return mesh;
 }
 const box=(id,size,p,m,role)=>part(id,geometries.box,m,p,size,role);
 const ball=(id,p,size,m,role)=>part(id,geometries.sphere,m,p,size,role);
 function rod(id,a,b,r,m,role){
  const va=new T.Vector3(...a),vb=new T.Vector3(...b),delta=vb.clone().sub(va),mesh=part(id,geometries.cylinder,m,va.clone().add(vb).multiplyScalar(.5).toArray(),[r,delta.length(),r],role);
  mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());return mesh;
 }
 // One simple closed N-shaped outline: both leg bottoms cap the reversed inner curve.
 const shape=new T.Shape(),R=spec.outerRadius,r=spec.innerRadius,h=spec.springHeight;
 shape.moveTo(-R,spec.baseY);shape.lineTo(-R,h);
 for(let i=1;i<=32;i++){const a=Math.PI-i*Math.PI/32;shape.lineTo(R*Math.cos(a),h+R*Math.sin(a));}
 shape.lineTo(R,spec.baseY);shape.lineTo(r,spec.baseY);shape.lineTo(r,h);
 for(let i=1;i<=32;i++){const a=i*Math.PI/32;shape.lineTo(r*Math.cos(a),h+r*Math.sin(a));}
 shape.lineTo(-r,spec.baseY);shape.closePath();
 const frameGeometry=new T.ExtrudeGeometry(shape,{depth:spec.frameDepth,bevelEnabled:false,steps:1});resources.geometries.add(frameGeometry);
 for(const z of[-spec.frameZ,spec.frameZ])frames.push(part('closed-arched-frame-'+z,frameGeometry,cream,[0,0,z-spec.frameDepth/2],[1,1,1],'arched-frame'));
 for(const x of[-.895,.895])for(const z of[-.24,.24]){
  const foot=box('stone-pad-'+x+'-'+z,[.30,.10,.28],[x,.05,z],stone,'foot');feet.push(foot);
  joints.push({id:'foot-to-frame-'+x+'-'+z,point:[x,.08,z],a:foot.name,b:'closed-arched-frame-'+z,expected:'point inside both closed solids'});
 }
 const mid=(r+R)/2;
 const centers=[];
 for(const x of[-mid,mid])for(const y of[.52,1.08])centers.push([x,y]);
 for(const degree of[0,30,60,90,120,150,180]){const a=degree*Math.PI/180;centers.push([mid*Math.cos(a),h+mid*Math.sin(a)]);}
 for(let i=0;i<centers.length;i++){
  const [x,y]=centers[i],bar=rod('depth-rung-'+i,[x,y,-.24],[x,y,.24],.025,wood,'depth-rung');rungs.push(bar);
  for(const z of[-.24,.24])joints.push({id:'rung-end-'+i+'-'+z,point:[x,y,z<0?-.225:.225],a:bar.name,b:'closed-arched-frame-'+z,expected:'rung cap center enters frame'});
 }
 // Each new blossom has a real stem root in the frame, overlapping petals and two attached leaves.
 for(const degree of[12,34,56,78,102,124,146,168]){
  const angle=degree*Math.PI/180,x=mid*Math.cos(angle),y=h+mid*Math.sin(angle),id='blossom-'+degree;
  const root=[x,y,.265],core=[x,y,.365],stem=rod(id+'-stem',root,core,.016,leaf,'flower-stem');
  const center=ball(id+'-heart',core,[.043,.043,.036],pollen,'flower-center'),petals=[];
  for(let j=0;j<5;j++){const a=j*Math.PI*2/5,petal=ball(id+'-petal-'+j,[x+Math.sin(a)*.056,y+Math.cos(a)*.056,.362],[.037,.073,.025],pink,'solid-petal');petal.rotation.z=-a;petals.push(petal);}
  const leaves=[];
  for(const side of[-1,1]){
   const pos=[x+side*.058,y-.050,.335],branch=rod(id+'-leaf-stem-'+side,[x,y,.29],pos,.010,leaf,'leaf-stem');
   const blade=ball(id+'-leaf-'+side,pos,[.057,.017,.025],leaf,'solid-leaf');blade.rotation.z=side*.45;leaves.push({branch,blade});
  }
  flowers.push({id,stem,center,petals,leaves,root});
  joints.push({id:id+'-root',point:[x,y,.28],a:stem.name,b:'closed-arched-frame-0.24',expected:'flower root enters front frame'});
 }
 group.updateMatrixWorld(true);
 const measured=new T.Box3().setFromObject(group,true),bounds={min:measured.min.toArray(),max:measured.max.toArray(),size:measured.getSize(new T.Vector3()).toArray()};
 const triangleCount=g=>(g.index?g.index.count:g.attributes.position.count)/3;
 const budget={meshes:parts.length,geometries:resources.geometries.size,materials:resources.materials.size,textures:0,triangles:parts.reduce((n,p)=>n+triangleCount(p.mesh.geometry),0),lights:0};
 let disposed=false;
 function inspect(){let invalidPositions=0,invalidNormals=0;for(const g of resources.geometries){const p=g.attributes.position,n=g.attributes.normal;for(let i=0;i<p.count;i++){if(![p.getX(i),p.getY(i),p.getZ(i)].every(Number.isFinite))invalidPositions++;const len=Math.hypot(n.getX(i),n.getY(i),n.getZ(i));if(!Number.isFinite(len)||Math.abs(len-1)>1e-5)invalidNormals++;}}
  return{bounds,budget,invalidPositions,invalidNormals,frameCount:frames.length,footCount:feet.length,rungCount:rungs.length,blossomCount:flowers.length,closedSolidPetalCount:flowers.reduce((n,f)=>n+f.petals.length,0),passage:spec.passage,opening:'actual empty volume, not a transparent painted opening',dimensions:'authored world dimensions, not body measurements',bodyBinding:null,physicalLoadStrength:false,normalPlacement:false,ownershipUnlockSave:false};}
 return{group,resources,parts,frames,feet,rungs,flowers,joints,bounds,budget,spec,inspect,get disposed(){return disposed;},dispose(){if(disposed)return;disposed=true;for(const set of Object.values(resources))for(const o of set)o.dispose();group.removeFromParent();group.clear();}};
}
export function inspectPassage(T,item){
 item.group.updateMatrixWorld(true);const inverse=item.group.matrixWorld.clone().invert(),origin=new T.Vector3(),direction=new T.Vector3(0,0,-1).transformDirection(item.group.matrixWorld),ray=new T.Raycaster(),rows=[];
 const oldSides=item.parts.map(p=>[p.mesh.material,p.mesh.material.side]);for(const [m]of oldSides)m.side=T.DoubleSide;
 try{
  for(let ix=0;ix<=10;ix++)for(let iy=0;iy<=19;iy++){
   const x=-spec.passage.halfWidth+2*spec.passage.halfWidth*ix/10,y=.04+(spec.passage.height-.08)*iy/19;
   origin.set(x,y,spec.passage.entryZ).applyMatrix4(item.group.matrixWorld);ray.set(origin,direction);
   const hits=ray.intersectObjects(item.parts.map(p=>p.mesh),false).filter(hit=>{const p=hit.point.clone().applyMatrix4(inverse);return p.z>=spec.passage.exitZ-1e-6&&p.z<=spec.passage.entryZ+1e-6;});
   rows.push({x,y,hits:hits.map(h=>h.object.name)});
  }
  const occupied=[];
  for(const x of[-.895,.895]){origin.set(x,.8,.58).applyMatrix4(item.group.matrixWorld);ray.set(origin,direction);occupied.push({x,hitParts:ray.intersectObjects(item.frames,false).map(h=>h.object.name)});}
  origin.set(0,spec.springHeight+(spec.outerRadius+spec.innerRadius)/2,.58).applyMatrix4(item.group.matrixWorld);ray.set(origin,direction);occupied.push({x:0,role:'header',hitParts:ray.intersectObjects(item.frames,false).map(h=>h.object.name)});
  return{scope:'finite straight local-Z diagnostic rays through the authored opening; not all bodies or normal navigation',sampleCount:rows.length,blocked:rows.filter(r=>r.hits.length).length,rows,occupiedWitnesses:occupied,bodyBinding:null,anatomicalFit:false,continuousCollisionGuarantee:false};
 }finally{for(const [m,side]of oldSides)m.side=side;}
}
export function inspectJoints(T,item){
 item.group.updateMatrixWorld(true);const meshes=new Map(item.parts.map(p=>[p.id,p.mesh]));
 function pointInside(mesh,point){const local=mesh.worldToLocal(point.clone()),ray=new T.Raycaster(local,new T.Vector3(.931,.217,.294).normalize()),probe=mesh.clone();probe.position.set(0,0,0);probe.quaternion.identity();probe.scale.set(1,1,1);probe.updateMatrixWorld(true);const old=mesh.material.side;mesh.material.side=T.DoubleSide;try{const hits=[...new Set(ray.intersectObject(probe,false).filter(h=>h.distance>1e-7).map(h=>Math.round(h.distance*1e7)))];return hits.length%2===1;}finally{mesh.material.side=old;}}
 return item.joints.map(j=>{const p=new T.Vector3(...j.point).applyMatrix4(item.group.matrixWorld);return{...j,insideA:pointInside(meshes.get(j.a),p),insideB:pointInside(meshes.get(j.b),p)};});
}

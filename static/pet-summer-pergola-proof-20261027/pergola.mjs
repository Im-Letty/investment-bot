/* Authored small coastal pergola. Solid parts and finite witnesses; no body calibration. */
export const spec=Object.freeze({id:'summer-open-pergola-v1',unit:'village:asset-library:summer-open-pergola:v1',version:1,
 feet:{x:.98,z:.63,width:.32,height:.14},post:{width:.14,bottom:.12,top:2.14},
 longitudinal:{width:.18,height:.16,length:1.68,y:2.17},cross:{length:2.42,height:.16,width:.18,y:2.25},
 roof:{slats:7,width:.095,height:.10,length:1.96,y:2.35,step:.33},
 passages:{frontBack:{halfWidth:.70,height:1.90,entry:1.10,exit:-1.10},sideSide:{halfWidth:.38,height:1.90,entry:1.35,exit:-1.35}},
 passage:{halfWidth:.70,height:1.90,entryZ:1.10,exitZ:-1.10},
 authoredDimensionsNotBodyFit:true,bodyBinding:null,physicalLoadVerified:false,continuousCollisionGuarantee:false});
const vec=(T,p)=>new T.Vector3(...p);
export function containsPoint(T,mesh,point){
 const p=mesh.worldToLocal(point.clone()),ray=new T.Ray(p,new T.Vector3(.913,.287,.291).normalize()),pos=mesh.geometry.attributes.position,ix=mesh.geometry.index,hits=[];
 for(let i=0;i<(ix?ix.count:pos.count);i+=3){const vs=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(pos,ix?ix.getX(i+k):i+k)),hit=ray.intersectTriangle(...vs,false,new T.Vector3());if(hit){const distance=hit.distanceTo(p);if(distance>1e-7&&!hits.some(v=>Math.abs(v-distance)<1e-7))hits.push(distance);}}
 return hits.length%2===1;
}
export function build(T){
 const group=new T.Group();group.name='summer-open-pergola-candidate';const geometry=new T.BoxGeometry(1,1,1);
 const materials={stone:new T.MeshStandardMaterial({color:'#dbd5c4',roughness:.93}),cream:new T.MeshStandardMaterial({color:'#f4e9cd',roughness:.82}),wood:new T.MeshStandardMaterial({color:'#b48c64',roughness:.83}),paleWood:new T.MeshStandardMaterial({color:'#dbc49b',roughness:.86})};
 const resources={geometries:new Set([geometry]),materials:new Set(Object.values(materials))},parts=[],feet=[],posts=[],slats=[],braces=[],joints=[];
 function box(id,size,position,material){const mesh=new T.Mesh(geometry,materials[material]);mesh.name=id;mesh.scale.set(...size);mesh.position.set(...position);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);parts.push({id,mesh});return mesh;}
 function joint(kind,a,b,p){joints.push({kind,a,b,point:p});}
 for(const sx of[-1,1])for(const sz of[-1,1]){
  const x=sx*spec.feet.x,z=sz*spec.feet.z,id=(sx<0?'west':'east')+'-'+(sz<0?'rear':'front');
  const foot=box('stone-foot-'+id,[.32,.14,.32],[x,.07,z],'stone'),post=box('cream-post-'+id,[.14,2.02,.14],[x,1.13,z],'cream');
  feet.push(foot);posts.push(post);joint('post-inside-foot',foot,post,[x,.13,z]);
 }
 const long=new Map(),cross=new Map();
 for(const sx of[-1,1])long.set(sx,box('side-roof-beam-'+sx,[.18,.16,1.68],[sx*.98,2.17,0],'cream'));
 for(const sz of[-1,1])cross.set(sz,box('cross-roof-beam-'+sz,[2.42,.16,.18],[0,2.25,sz*.63],'wood'));
 for(const post of posts){const sx=Math.sign(post.position.x),sz=Math.sign(post.position.z);joint('post-to-side-beam',post,long.get(sx),[post.position.x,2.12,post.position.z]);joint('side-to-cross-beam',long.get(sx),cross.get(sz),[post.position.x,2.21,post.position.z]);}
 for(let i=0;i<7;i++){const x=(i-3)*.33,m=box('separate-roof-slat-'+i,[.095,.10,1.96],[x,2.35,0],'paleWood');slats.push(m);for(const sz of[-1,1])joint('slat-to-cross-beam',m,cross.get(sz),[x,2.315,sz*.63]);}
 function brace(id,a,b,post,beam){
  const start=vec(T,a),end=vec(T,b),d=end.clone().sub(start),m=box(id,[.075,d.length(),.075],start.clone().add(end).multiplyScalar(.5).toArray(),'wood');
  m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.clone().normalize());braces.push(m);
  joint('brace-to-post',m,post,start.clone().addScaledVector(d.clone().normalize(),.025).toArray());
  joint('brace-to-roof-beam',m,beam,end.clone().addScaledVector(d.clone().normalize(),-.025).toArray());
 }
 for(const post of posts){const x=post.position.x,z=post.position.z,sx=Math.sign(x),sz=Math.sign(z),id=(sx<0?'west':'east')+'-'+(sz<0?'rear':'front');
  brace('depth-knee-'+id,[x,1.78,z],[x,2.14,sz*.27],post,long.get(sx));
  brace('width-knee-'+id,[x,1.84,z],[sx*.62,2.26,z],post,cross.get(sz));
 }
 group.updateMatrixWorld(true);const boundsBox=new T.Box3().setFromObject(group,true),bounds={min:boundsBox.min.toArray(),max:boundsBox.max.toArray(),size:boundsBox.getSize(new T.Vector3()).toArray()};
 let disposed=false;
 const budget={meshes:parts.length,geometries:resources.geometries.size,materials:resources.materials.size,textures:0,triangles:parts.reduce((n,p)=>n+(p.mesh.geometry.index?p.mesh.geometry.index.count:p.mesh.geometry.attributes.position.count)/3,0),lights:0};
 return{group,parts,feet,posts,slats,braces,joints,spec,bounds,budget,resources,get disposed(){return disposed;},
 inspect(){let invalidPositions=0,invalidNormals=0;for(const p of parts){const g=p.mesh.geometry;for(const v of g.attributes.position.array)if(!Number.isFinite(v))invalidPositions++;for(let i=0;i<g.attributes.normal.count;i++){const n=new T.Vector3().fromBufferAttribute(g.attributes.normal,i);if(!Number.isFinite(n.length())||Math.abs(n.length()-1)>1e-6)invalidNormals++;}}return{parts:parts.length,closedComponentGeometry:'actual shared six-face box solid with positive mesh scales',bounds,budget,invalidPositions,invalidNormals,bodyBinding:null,authoredDimensionsNotBodyFit:true};},
 dispose(){if(disposed)return;disposed=true;for(const g of resources.geometries)g.dispose();for(const m of resources.materials)m.dispose();group.clear();}};
}
export function inspectJoints(T,item){
 item.group.updateMatrixWorld(true);return item.joints.map(j=>{const point=item.group.localToWorld(vec(T,j.point));return{kind:j.kind,a:j.a.name,b:j.b.name,point:point.toArray(),insideA:containsPoint(T,j.a,point),insideB:containsPoint(T,j.b,point)};});
}
function rayHits(T,item,start,end){
 const a=item.group.localToWorld(vec(T,start)),b=item.group.localToWorld(vec(T,end)),d=b.clone().sub(a),ray=new T.Raycaster(a,d.clone().normalize(),0,d.length());
 return ray.intersectObjects(item.parts.map(p=>p.mesh),false).map(h=>({part:h.object.name,point:h.point.toArray(),distance:h.distance}));
}
export function inspectPassages(T,item){
 item.group.updateMatrixWorld(true);const rows=[];
 for(const axis of['frontBack','sideSide']){const p=spec.passages[axis];for(const reverse of[false,true])for(let w=0;w<=8;w++)for(let h=0;h<=6;h++){
  const across=-p.halfWidth+2*p.halfWidth*w/8,y=.08+(p.height-.08)*h/6,s=reverse?p.exit:p.entry,e=reverse?p.entry:p.exit,start=axis==='frontBack'?[across,y,s]:[s,y,across],end=axis==='frontBack'?[across,y,e]:[e,y,across],hits=rayHits(T,item,start,end);rows.push({axis,start,end,hitParts:[...new Set(hits.map(z=>z.part))]});
 }}
 const occupied=[{start:[.98,.70,1.1],end:[.98,.70,-1.1]},{start:[1.4,.70,.63],end:[-1.4,.70,.63]}].map(r=>({...r,hitParts:[...new Set(rayHits(T,item,r.start,r.end).map(h=>h.part))]}));
 return{sampleCount:rows.length,blocked:rows.filter(r=>r.hitParts.length).length,rows,occupiedWitnesses:occupied,scope:'finite rays through two authored opening corridors; diagnostic dimensions, no actor traversal or body fit',bodyFit:false,continuousCollisionGuarantee:false};
}
export function inspectRoof(T,item){
 item.group.updateMatrixWorld(true);const occupied=[],gaps=[];
 for(const z of[-.24,0,.24]){for(let i=0;i<7;i++){const x=(i-3)*.33;occupied.push({x,z,hits:rayHits(T,item,[x,2.8,z],[x,2.28,z]).map(h=>h.part)});}for(let i=0;i<6;i++){const x=(i-2.5)*.33;gaps.push({x,z,hits:rayHits(T,item,[x,2.8,z],[x,2.28,z]).map(h=>h.part)});}}
 return{occupiedRays:occupied.length,clearGapRays:gaps.length,occupied,gaps,scope:'finite actual beam/gap ray occlusion; rendered shadow inspected separately, not thermal shade or continuous sun simulation'};
}

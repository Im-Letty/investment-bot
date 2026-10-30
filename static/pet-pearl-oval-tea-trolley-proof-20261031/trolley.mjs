/* Authored fixed furniture candidate. Dimensions are prop design values, not body calibration. */
import {strictContainment} from '../pet-breeze-cape-proof-20261029/geometry-audit.mjs';

export const spec=Object.freeze({id:'pearl-oval-tea-trolley-v1',unit_id:'village:asset-library:pearl-oval-tea-trolley:v1',category:'interior_furniture',style:'soft_pearl_elegant',season:'all_season',authored_on_jst:'2026-10-31',bodyBinding:null,physics:false,rolling:false,steering:false,serving:false,loadOrStability:false,rig:false,wearingFit:false,normalGame:false,ownershipUnlockSave:false,newOriginalDesign:false});

function finish(T,g){
 if(!g.index)g.setIndex(Array.from({length:g.attributes.position.count},(_,i)=>i));
 const p=g.attributes.position,index=g.index;let volume=0;
 for(let k=0;k<index.count;k+=3){const a=new T.Vector3().fromBufferAttribute(p,index.getX(k)),b=new T.Vector3().fromBufferAttribute(p,index.getX(k+1)),c=new T.Vector3().fromBufferAttribute(p,index.getX(k+2));volume+=a.dot(b.cross(c))/6;}
 if(volume<0)for(let k=0;k<index.count;k+=3){const a=index.getX(k+1);index.setX(k+1,index.getX(k+2));index.setX(k+2,a);}
 g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();return g;
}
function geometry(T,position,index){const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(position,3));g.setIndex(index);return finish(T,g);}
function roundedSection(a,b,r,steps=4){const points=[];for(const[x,y,start]of[[a-r,b-r,0],[-a+r,b-r,90],[-a+r,-b+r,180],[a-r,-b+r,270]])for(let k=0;k<=steps;k++){const angle=(start+k/steps*90)*Math.PI/180;points.push([x+r*Math.cos(angle),y+r*Math.sin(angle)]);}return points;}
function ovalSolid(T,a,b,halfHeight,N=72){
 const levels=[[-halfHeight,.955],[-halfHeight+.013,1],[halfHeight-.013,1],[halfHeight,.955]],p=[],index=[];
 for(const[y,scale]of levels)for(let k=0;k<N;k++){const angle=k/N*Math.PI*2;p.push(a*scale*Math.cos(angle),y,b*scale*Math.sin(angle));}
 for(let j=0;j<levels.length-1;j++)for(let k=0;k<N;k++){const A=j*N+k,B=j*N+(k+1)%N,C=(j+1)*N+(k+1)%N,D=(j+1)*N+k;index.push(A,B,C,A,C,D);}
 for(const[j,reverse]of[[0,true],[levels.length-1,false]]){const center=p.length/3;p.push(0,levels[j][0],0);for(let k=0;k<N;k++)index.push(center,...(reverse?[j*N+(k+1)%N,j*N+k]:[j*N+k,j*N+(k+1)%N]));}
 return geometry(T,p,index);
}
function ovalRing(T,a,b,radial,vertical,round,N=72){
 const section=roundedSection(radial,vertical,round),Q=section.length,p=[],index=[];
 for(let k=0;k<N;k++){const angle=k/N*Math.PI*2,c=Math.cos(angle),s=Math.sin(angle),normal=new T.Vector3(c/a,0,s/b).normalize();for(const[r,y]of section)p.push(a*c+normal.x*r,y,b*s+normal.z*r);}
 for(let k=0;k<N;k++)for(let j=0;j<Q;j++){const A=k*Q+j,B=((k+1)%N)*Q+j,C=((k+1)%N)*Q+(j+1)%Q,D=k*Q+(j+1)%Q;index.push(A,B,C,A,C,D);}
 return geometry(T,p,index);
}
function turned(T,profile,N=32){
 const p=[],rows=[],index=[];
 for(const[r,y]of profile){if(r===0){rows.push([p.length/3]);p.push(0,y,0);}else{const row=[];for(let k=0;k<N;k++){const angle=k/N*Math.PI*2;row.push(p.length/3);p.push(r*Math.cos(angle),y,r*Math.sin(angle));}rows.push(row);}}
 for(let j=0;j<rows.length-1;j++)for(let k=0;k<N;k++){const a=rows[j],b=rows[j+1],n=(k+1)%N;if(a.length===1)index.push(a[0],b[n],b[k]);else if(b.length===1)index.push(a[k],a[n],b[0]);else index.push(a[k],a[n],b[n],a[k],b[n],b[k]);}
 return geometry(T,p,index);
}
function fixedWheel(T){
 const radius=.18,centerY=.16,width=.12,segments=56,start=-Math.asin(centerY/radius),end=Math.PI+Math.asin(centerY/radius),contour=Array.from({length:segments+1},(_,k)=>{const a=start+(end-start)*k/segments;return[radius*Math.cos(a),k===0||k===segments?0:centerY+radius*Math.sin(a)];}),levels=[[-width/2,.90],[-width/2+.014,1],[width/2-.014,1],[width/2,.90]],p=[],index=[],N=contour.length;
 for(const[x,scale]of levels)for(const[z,y]of contour)p.push(x,centerY+(y-centerY)*scale,z*scale);
 for(let j=0;j<levels.length-1;j++)for(let k=0;k<N;k++){const A=j*N+k,B=j*N+(k+1)%N,C=(j+1)*N+(k+1)%N,D=(j+1)*N+k;index.push(A,B,C,A,C,D);}
 const triangles=T.ShapeUtils.triangulateShape(contour.map(p=>new T.Vector2(...p)),[]);
 for(const f of triangles){index.push(f[2],f[1],f[0]);index.push(...f.map(i=>(levels.length-1)*N+i));}
 return geometry(T,p,index);
}
function cappedTube(T,points,radius,segments=64,radialSegments=12){
 const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)),false,'centripetal'),tube=new T.TubeGeometry(curve,segments,radius,radialSegments,false),p=Array.from(tube.attributes.position.array),index=Array.from(tube.index.array),Q=radialSegments+1;
 for(const[row,reverse]of[[0,false],[segments,true]]){const center=p.length/3;p.push(...curve.getPointAt(row/segments).toArray());for(let k=0;k<radialSegments;k++)index.push(center,...(reverse?[row*Q+k+1,row*Q+k]:[row*Q+k,row*Q+k+1]));}
 tube.dispose();return{geometry:geometry(T,p,index),curve,sections:Array.from({length:segments+1},(_,k)=>({center:curve.getPointAt(k/segments).toArray(),vertices:Array.from({length:radialSegments},(_,j)=>k*Q+j)})),radius,radialSegments};
}

export function build(T){
 if(!T?.ShapeUtils||!T?.BufferGeometry)throw Error('trolley_three_required');
 const group=new T.Group();group.name=spec.id;const parts=[],geometries=new Set(),materials=new Set(),contactWitnesses=[];let disposed=false;
 const material=(name,color,roughness=.88,metalness=0)=>{const m=new T.MeshStandardMaterial({name,color,roughness,metalness});materials.add(m);return m;};
 const pearl=material('warm-pearl-cream','#f4ead6'),wood=material('rounded-honey-wood','#c8a477'),woodEdge=material('soft-wood-edge','#d6b88e'),metal=material('muted-champagne-fixed-metal','#bba17e',.6,.12),wheelMaterial=material('warm-fixed-wheel-wood','#bfa588'),hubMaterial=material('pearl-fixed-wheel-inlay','#eee4d1');
 const add=(name,g,mat,position=[0,0,0])=>{geometries.add(g);const mesh=new T.Mesh(g,mat);mesh.name=name;mesh.position.fromArray(position);group.add(mesh);parts.push(mesh);return mesh;};
 function join(part,target,seed,scope='One finite fixed shared-material witness'){
  group.updateMatrixWorld(true);let chosen=null;
  const offsets=[[0,0,0]];for(const radius of[.002,.006,.012,.022])for(const d of[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,1,1],[-1,-1,-1]])offsets.push(new T.Vector3(...d).normalize().multiplyScalar(radius).toArray());
  for(const o of offsets){const p=new T.Vector3(...seed).add(new T.Vector3(...o)).toArray(),a=strictContainment(T,part,p);if(!a.inside)continue;const b=strictContainment(T,target,p);if(b.inside){chosen={point:p,producerClearance:Math.min(a.minimumSurfaceClearance,b.minimumSurfaceClearance)};break;}}
  contactWitnesses.push({part:part.name,target:target.name,point:chosen?.point||seed,sourceSeed:seed,producerFound:!!chosen,producerClearance:chosen?.producerClearance??null,finitePointOnly:true,scope});
 }
 const tiers=[],rims=[],bands=[];
 for(const[label,y,a,b]of[['lower',.46,1.10,.59],['upper',1.30,1.08,.57]]){
  const tier=add(label+'-thick-pearl-oval-tier',ovalSolid(T,a,b,.055),pearl,[0,y,0]);tiers.push(tier);
  const rim=add(label+'-rounded-raised-pearl-rim',ovalRing(T,a-.025,b-.025,.043,.042,.014),pearl,[0,y+.066,0]);rims.push(rim);for(const angle of[0,Math.PI*.5,Math.PI,Math.PI*1.5])join(rim,tier,[(a-.025)*Math.cos(angle),y+.040,(b-.025)*Math.sin(angle)],'Finite embedded raised rim-to-actual closed tier material');
  const band=add(label+'-warmwood-lower-edge',ovalRing(T,a-.016,b-.016,.022,.022,.009),woodEdge,[0,y-.023,0]);bands.push(band);join(band,tier,[a-.016,y-.023,0]);
 }
 const[lowerTier,upperTier]=tiers,uprights=[],collars=[],feet=[],wheelAxles=[],wheelHubs=[],wheelMounts=[];
 const uprightG=turned(T,[[0,-.57],[.043,-.57],[.059,-.554],[.065,-.53],[.063,-.49],[.050,-.44],[.047,-.14],[.054,0],[.047,.14],[.050,.44],[.063,.49],[.065,.53],[.059,.554],[.043,.57],[0,.57]]),collarG=turned(T,[[0,-.034],[.056,-.034],[.075,-.024],[.081,-.006],[.081,.006],[.075,.024],[.056,.034],[0,.034]]),mountG=turned(T,[[0,-.16],[.033,-.16],[.044,-.145],[.045,.12],[.040,.145],[.03,.16],[0,.16]]),wheelG=fixedWheel(T),axleG=turned(T,[[0,-.095],[.023,-.095],[.029,-.080],[.029,.080],[.023,.095],[0,.095]]),hubG=new T.SphereGeometry(1,24,14);
 for(const x of[-.82,.82])for(const z of[-.38,.38]){
  const n=uprights.length,upright=add('shaped-warmwood-upright-'+n,uprightG,wood,[x,.90,z]);uprights.push(upright);join(upright,lowerTier,[x,.46,z]);join(upright,upperTier,[x,1.30,z]);
  for(const y of[.50,1.32]){const collar=add('pearl-upright-collar-'+collars.length,collarG,pearl,[x,y,z]);collars.push(collar);join(collar,upright,[x,y,z]);}
  const mount=add('fixed-wheel-neck-'+n,mountG,metal,[x,.29,z]);wheelMounts.push(mount);join(mount,lowerTier,[x,.43,z]);
  const wheel=add('fixed-flat-sole-wheel-'+n,wheelG,wheelMaterial,[x,0,z]);wheel.userData.contactPadHalfExtents=[.035,.055];wheel.userData.fixedDecorativeWheel=true;feet.push(wheel);join(wheel,mount,[x,.20,z],'Fixed decorative wheel material attached to its stationary neck; no wheel rig');
  const axle=add('fixed-wheel-axle-'+n,axleG,metal,[x,.16,z]);axle.rotation.z=Math.PI/2;wheelAxles.push(axle);join(axle,wheel,[x,.16,z]);
  const hub=add('fixed-pearl-wheel-hub-'+n,hubG,hubMaterial,[x+Math.sign(x)*.067,.16,z]);hub.scale.set(.026,.064,.064);wheelHubs.push(hub);join(hub,axle,[x+Math.sign(x)*.066,.16,z]);
 }
 const a=1.08-.025,b=.57-.025,theta=.48,endpoints=[[-a*Math.cos(theta),1.366,-b*Math.sin(theta)],[-a*Math.cos(theta),1.366,b*Math.sin(theta)]],handlePoints=[endpoints[0],[-1.16,1.45,-.38],[-1.33,1.65,-.43],[-1.39,1.76,-.27],[-1.39,1.79,0],[-1.39,1.76,.27],[-1.33,1.65,.43],[-1.16,1.45,.38],endpoints[1]],handleData=cappedTube(T,handlePoints,.044),handle=add('one-continuous-fixed-curved-push-handle',handleData.geometry,wood);handle.userData.tubeProfile={...handleData,geometry:undefined,curve:undefined};
 const handleMounts=[];for(const p of endpoints){const mount=add('pearl-curved-handle-mount-'+handleMounts.length,hubG,pearl,p);mount.scale.set(.082,.073,.082);handleMounts.push(mount);join(mount,rims[1],p);join(handle,mount,p,'One finite fixed curved-handle end embedded in its mount');}
 const gripData=cappedTube(T,[[-1.39,1.78,-.19],[-1.395,1.79,0],[-1.39,1.78,.19]],.055,32,12),grip=add('fixed-pearl-handle-grip',gripData.geometry,pearl);grip.userData.tubeProfile={...gripData,geometry:undefined,curve:undefined};join(grip,handle,[-1.39,1.79,0]);
 group.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(group,true);
 function inspect(){if(disposed)throw Error('trolley_disposed');return{spec,closedParts:parts.length,triangles:parts.reduce((n,p)=>n+p.geometry.index.count/3,0),geometryObjectCount:geometries.size,materialCount:materials.size,textures:0,ovalTiers:2,raisedRims:2,shapedUprights:4,continuousPushHandles:1,fixedWheelAssemblies:4,authoredFlatWheelContactPatches:4,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},bodyBinding:null,rolling:false,steering:false,serving:false,physics:false,loadOrStability:false,rig:false,wearingFit:false,normalGame:false,ownershipUnlockSave:false,scope:'Fixed authored library furniture only. Finite material, contact and clearance witnesses; no continuous collision, wheel dynamics, body dimensions, serving or storage mechanism.'};}
 return{group,parts,tiers,lowerTier,upperTier,rims,bands,uprights,collars,feet,wheelAxles,wheelHubs,wheelMounts,handle,handleMounts,grip,body:lowerTier,plinth:lowerTier,contactWitnesses,bounds,resources:{geometries:[...geometries],materials:[...materials]},inspectionViews:{shelf:{eye:[2.65,1.00,2.65],target:[0,.86,0]},handle:{eye:[-2.20,1.80,1.55],target:[-1.23,1.48,0]}},inspect,dispose(){if(disposed)return false;disposed=true;for(const g of geometries)g.dispose();for(const m of materials)m.dispose();group.clear();return true;}};
}

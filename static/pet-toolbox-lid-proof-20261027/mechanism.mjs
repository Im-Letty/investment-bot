/* A rigid lid on the existing single tray. Authored geometry; no physical hinge/load simulation. */
import {build as buildCarrier} from '../pet-toolbox-fourbar-proof-20261027/mechanism.mjs';
export const spec=Object.freeze({unit:'wardrobe:other:storybook-sewing-toolbox:standalone-lid-hinge-envelope:v1',revision:1,
 sourceImageSHA256:'6afc65a45e78a938b018987a85037a9bbbd4b63905aca1438927ea13d76db070',
 predecessorManifestSHA256:'ef45f09cb30dd09e48e5edf341a9f321195f616c023a065bb73175ed03c1226e',
 authoredUniformInstanceScale:.6,anatomicallyCalibratedScale:false,
 scope:'one rigid lid attached to the existing single-tray carrier; two independent authored manual coordinates',
 fullToolboxClosure:false,sealedStorage:false,loadFriction:false,continuousCollisionSafety:false,grip:false,body360:false,normalPlacement:false,unlock:false,save:false});
export const dimensions=Object.freeze({hingeY:.43,hingeZ:-.46,outerRadius:.065,boreRadius:.034,pinRadius:.025,
 barrelLength:.18,pinLength:1.62,angleRange:Object.freeze([0,100]),finiteLidAngles:Object.freeze(Array.from({length:11},(_,i)=>10*i)),finiteCarrierAngles:Object.freeze([45,62.5,80])});
const R=Math.PI/180;
export function validateAngle(a){if(typeof a!=='number'||!Number.isFinite(a)||a<0||a>100)throw Error('invalid_manual_lid_angle');return a;}
function annulus(T,{inner=.034,outer=.065,length=.18}={}){
 const N=64,p=[],ix=[];for(const x of[-length/2,length/2])for(const r of[outer,inner])for(let i=0;i<N;i++){const a=2*Math.PI*i/N;p.push(x,r*Math.cos(a),r*Math.sin(a));}
 // Coordinate order is X,Y,Z, so the YZ loops use X-axis extrusion.
 for(let i=0;i<N;i++){const j=(i+1)%N,a=i,b=j,c=N+i,d=N+j,A=2*N+i,B=2*N+j,C=3*N+i,D=3*N+j;
  ix.push(a,d,c,a,b,d,A,C,D,A,D,B,a,A,B,a,B,b,c,D,C,c,d,D);
 }
 for(let i=0;i<ix.length;i+=3)[ix[i+1],ix[i+2]]=[ix[i+2],ix[i+1]];
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();g.userData={annularX:true,innerRadius:inner,outerRadius:outer,length,steps:N};return g;
}
export function build(T,{document=null,style=null}={}){
 const carrier=buildCarrier(T,{document,style}),group=carrier.group,lidRoot=new T.Group();lidRoot.name='real-hinge-rigid-lid';lidRoot.position.set(0,.43,-.46);carrier.trayRoot.add(lidRoot);
 const geometries=[],materials=[],parts=[],byId=new Map();let dead=false,angle=50;
 const geo=g=>{g.computeBoundingBox();g.computeBoundingSphere();geometries.push(g);return g;};
 const wood=new T.MeshStandardMaterial({color:0xbc9465,roughness:.8}),cream=new T.MeshStandardMaterial({color:0xe9dfc8,roughness:.82}),brass=new T.MeshStandardMaterial({color:0xbfa56c,roughness:.55,metalness:.32}),sage=new T.MeshStandardMaterial({color:0x9ba789,roughness:.85});
 materials.push(wood,cream,brass,sage);
 const box=geo(new T.BoxGeometry(1,1,1)),barrel=geo(annulus(T)),collar=geo(annulus(T,{inner:.026,outer:.065,length:.02})),pin=geo(new T.CylinderGeometry(.025,.025,1.62,64)),cap=geo(new T.CylinderGeometry(.065,.065,.025,64));pin.rotateZ(-Math.PI/2);cap.rotateZ(-Math.PI/2);pin.computeBoundingBox();cap.computeBoundingBox();
 function add(id,g,m,parent,pos,scale,role,assembly,rotation=0){
  const mesh=new T.Mesh(g,m);mesh.name=id;mesh.position.set(...pos);mesh.scale.set(...scale);mesh.rotation.x=rotation;mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);
  const row={id,mesh,role,assembly};parts.push(row);byId.set(id,mesh);return mesh;
 }
 const bx=(id,parent,pos,size,role,assembly,m=wood,rotation=0)=>add(id,box,m,parent,pos,size,role,assembly,rotation);
 bx('lid-board',lidRoot,[.5,.03,.4775],[1.46,.06,.805],'lid-board','lid',wood);
 bx('lid-linen-panel',lidRoot,[.5,.066,.48],[1.17,.012,.62],'lid-detail','lid',cream);
 for(const x of[-.08,.5,1.08]){
  add('moving-bored-knuckle-'+x,barrel,brass,lidRoot,[x,0,0],[1,1,1],'moving-bore','lid');
  bx('lid-knuckle-web-'+x,lidRoot,[x,.052,.052],[.16,.03,.13],'lid-web','lid');
 }
 for(const x of[.21,.79]){
  add('fixed-bored-knuckle-'+x,barrel,brass,carrier.trayRoot,[x,.43,-.46],[1,1,1],'fixed-bore','tray');
  bx('fixed-knuckle-foot-'+x,carrier.trayRoot,[x,.285,-.46],[.16,.21,.11],'bearing-foot','tray');
  bx('fixed-bearing-integral-bridge-'+x,carrier.trayRoot,[x,.20,-.40],[.16,.08,.28],'bearing-bridge','tray');
 }
 const shaft=add('lid-through-pin',pin,brass,carrier.trayRoot,[.5,.43,-.46],[1,1,1],'hinge-pin','tray'),caps=[],collars=[];
 for(const x of[-.25,1.25])collars.push(add('lid-retaining-collar-'+x,collar,brass,carrier.trayRoot,[x,.43,-.46],[1,1,1],'hinge-collar','tray'));
 for(const x of[-.3225,1.3225])caps.push(add('lid-pin-closed-cap-'+x,cap,brass,carrier.trayRoot,[x,.43,-.46],[1,1,1],'hinge-cap','tray'));
 const closedStops=[];
 for(const x of[-.1,1.1])closedStops.push(bx('closed-lid-rest-'+x,carrier.trayRoot,[x,.405,.355],[.16,.05,.06],'closed-stop','tray',sage));
 // An integral outrigger holds the open stop. No external inspection stand.
 bx('open-stop-integral-foot',carrier.trayRoot,[-.25,.20,-.46],[.36,.08,.36],'stop-support','tray');
 bx('open-stop-integral-tower',carrier.trayRoot,[-.38,.3775,-.58],[.08,.355,.08],'stop-support','tray');
 const a=-100*R,cy=.04*Math.cos(a)-.18*Math.sin(a),cz=.04*Math.sin(a)+.18*Math.cos(a);
 const openStop=bx('open-lid-positive-stop',carrier.trayRoot,[-.38,.43+cy,-.46+cz],[.12,.04,.10],'open-stop','tray',sage,a);
 const finger=bx('lid-stop-finger',lidRoot,[-.38,0,.18],[.10,.04,.08],'stop-finger','lid',brass);
 bx('lid-stop-finger-web',lidRoot,[-.295,.01,.18],[.27,.02,.16],'lid-web','lid');
 const bores=parts.filter(p=>p.role==='moving-bore'||p.role==='fixed-bore');
 function state(){return{lidAngleDegrees:angle,lidRangeDegrees:[0,100],carrierAngleDegrees:carrier.getState().angleDegrees,
   rigidLid:true,realThroughBoreBarrels:5,realHingePins:1,manualCoordinates:2,externalGuideStand:false,singleTrayLidOnly:true,
   fullToolboxClosure:false,sealedStorage:false,loadFriction:false,continuousCollisionSafety:false,normalPlacement:false,save:false};}
 function setAngle(v){if(dead)throw Error('disposed');angle=validateAngle(v);lidRoot.rotation.x=-angle*R;group.updateMatrixWorld(true);return state();}
 function setCarrierAngle(v){if(dead)throw Error('disposed');carrier.setAngle(v);group.updateMatrixWorld(true);return state();}
 setAngle(angle);
 // Analytic component extrema of each actual lid vertex over the authored
 // 0..100 degree interval. This is an enclosure, not collision certification.
 function trigRange(A,B){const ts=[0,100*R],c=Math.atan2(B,A);for(let k=-2;k<=2;k++){const t=c+k*Math.PI;if(t>0&&t<100*R)ts.push(t);}const vs=ts.map(t=>A*Math.cos(t)+B*Math.sin(t));return[Math.min(...vs),Math.max(...vs)];}
 const old=carrier.getState().angleDegrees,orig=group.position.clone();group.position.set(0,0,0);
 const tx=[-.5+Math.cos(80*R),-.5+Math.cos(45*R)],ty=[.5+Math.sin(45*R),.5+Math.sin(80*R)];
 const lo=carrier.bounds.min.slice(),hi=carrier.bounds.max.slice();
 for(const part of parts.filter(p=>p.assembly==='lid')){part.mesh.updateMatrix();const ps=part.mesh.geometry.attributes.position;for(let i=0;i<ps.count;i++){const v=new T.Vector3().fromBufferAttribute(ps,i).applyMatrix4(part.mesh.matrix),yr=trigRange(v.y,v.z),zr=trigRange(v.z,-v.y);
  lo[0]=Math.min(lo[0],tx[0]+v.x);hi[0]=Math.max(hi[0],tx[1]+v.x);lo[1]=Math.min(lo[1],ty[0]+.43+yr[0]);hi[1]=Math.max(hi[1],ty[1]+.43+yr[1]);lo[2]=Math.min(lo[2],-.46+zr[0]);hi[2]=Math.max(hi[2],-.46+zr[1]);
 }}
 // Fixed new tray parts translated over the same authored carrier range.
 const trayInverse=carrier.trayRoot.matrixWorld.clone().invert();
 for(const p of parts.filter(p=>p.assembly==='tray')){const a=p.mesh.geometry.attributes.position;for(let i=0;i<a.count;i++){const v=new T.Vector3().fromBufferAttribute(a,i).applyMatrix4(p.mesh.matrixWorld).applyMatrix4(trayInverse);lo[0]=Math.min(lo[0],tx[0]+v.x);hi[0]=Math.max(hi[0],tx[1]+v.x);lo[1]=Math.min(lo[1],ty[0]+v.y);hi[1]=Math.max(hi[1],ty[1]+v.y);lo[2]=Math.min(lo[2],v.z);hi[2]=Math.max(hi[2],v.z);}}
 lo[1]=Math.min(0,lo[1]);group.position.copy(orig);setCarrierAngle(old);
 const authoredScale=.6;group.scale.setScalar(authoredScale);group.updateMatrixWorld(true);
 const bounds={min:lo.map(n=>n*authoredScale),max:hi.map(n=>n*authoredScale),size:hi.map((x,i)=>(x-lo[i])*authoredScale),method:'predecessor envelope union actual lid-vertex analytic sine/cosine extrema over0..100deg and solved-tray translation envelope; not continuous collision proof'};
 const allParts=[...carrier.parts,...parts],allById=new Map([...carrier.byId,...byId]);
 const budget={parts:allParts.length,newParts:parts.length,triangles:allParts.reduce((n,p)=>n+(p.mesh.geometry.index?.count||p.mesh.geometry.attributes.position.count)/3,0),
  geometries:carrier.geometries.length+geometries.length,materials:carrier.materials.length+materials.length,textures:carrier.textures.length,geometryAllocationsPerPose:0};
 return{group,carrier,lidRoot,authoredScale,parts:allParts,lidParts:parts,byId:allById,bores,shaft,caps,collars,closedStops,openStop,finger,spec,dimensions,bounds,budget,
  geometries:[...carrier.geometries,...geometries],materials:[...carrier.materials,...materials],textures:carrier.textures,footprint:carrier.footprint,
  setAngle,setCarrierAngle,getState:state,dispose(){if(dead)return;dead=true;for(const g of geometries)g.dispose();for(const m of materials)m.dispose();carrier.dispose();}};
}

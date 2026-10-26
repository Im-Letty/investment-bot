/* One body/tray cutaway and a two-bored rigid link. Not a complete toolbox mechanism. */
import {build as buildCoupon,spec as couponSpec} from '../pet-toolbox-joint-proof-20261026/joint.mjs';
export const spec=Object.freeze({unit:'wardrobe:other:storybook-sewing-toolbox:integral-two-pivot-link:v1',revision:1,
 sourceImageSHA256:couponSpec.sourceSHA,sourceJoint:'/static/pet-toolbox-joint-proof-20261026/joint.mjs',
 representation:'one-integral-body-link-tray-cutaway-with-two-real-pin-joints',externalGuideStand:false,
 fullToolboxStandaloneOpening:false,physicalLoadFriction:false,continuousCollisionGuarantee:false,
 closedStorage:false,grip:false,allGrowthFit:false,body360:false,normalPlacement:false,unlock:false,save:false});
export const dimensions=Object.freeze({pivotHeight:.61,linkLength:1.05,linkThickness:.12,boreRadius:.041,pinRadius:.035,
 angleARange:Object.freeze([20,50]),angleBRange:Object.freeze([-20,0])});
const DEG=Math.PI/180,P=dimensions.pivotHeight,L=dimensions.linkLength;
export function validatePose(a,b){if(![a,b].every(n=>typeof n==='number'&&Number.isFinite(n))||a<20||a>50||b< -20||b>0)throw Error('invalid_manual_two_joint_pose');return[a,b];}
function clean(T,points){const result=[];for(const p of points){const v=new T.Vector2(Math.round(p[0]*1e10)/1e10,Math.round(p[1]*1e10)/1e10);if(!result.length||v.distanceTo(result.at(-1))>1e-9)result.push(v);}if(result[0].distanceTo(result.at(-1))<1e-9)result.pop();return result;}
function circle(radius,steps=48){return Array.from({length:steps},(_,i)=>[radius*Math.cos(-2*Math.PI*i/steps),radius*Math.sin(-2*Math.PI*i/steps)]);}
// PR88's explicit closed bored extrusion extended to two separate through holes.
// Every front/back contour, outer wall and bore wall is an actual indexed face.
function bored(T,outerPoints,bores,depth){
 const outer=clean(T,outerPoints),holes=bores.map(b=>clean(T,circle(b.radius).map(p=>[p[0]+b.center[0],p[1]+b.center[1]])));
 if(T.ShapeUtils.isClockWise(outer))outer.reverse();for(const hole of holes)if(!T.ShapeUtils.isClockWise(hole))hole.reverse();
 const loops=[outer,...holes],all=loops.flat(),n=all.length,tri=T.ShapeUtils.triangulateShape(outer,holes),positions=[],indices=[];
 for(const z of[-depth/2,depth/2])for(const p of all)positions.push(p.x,p.y,z);
 for(const face of tri){let[a,b,c]=face;const p=all[a],q=all[b],r=all[c];if((q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x)<0)[b,c]=[c,b];indices.push(a,c,b,a+n,b+n,c+n);}
 let offset=0;for(const loop of loops){for(let i=0;i<loop.length;i++){const a=offset+i,b=offset+(i+1)%loop.length;indices.push(a,b,b+n,a,b+n,a+n);}offset+=loop.length;}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
 g.userData={outline:outer.map(p=>p.toArray()),bores:bores.map(b=>({center:b.center.slice(),nominalRadius:b.radius,axis:'z'})),closedBoredPrism:true};return g;
}
function closedCollar(T){
 const steps=48,pos=[],ix=[],n=steps*2;
 for(const z of[-.0175,.0175])for(const radius of[.073,.0365])for(let i=0;i<steps;i++){const a=i*2*Math.PI/steps;pos.push(radius*Math.cos(a),radius*Math.sin(a),z);}
 for(let i=0;i<steps;i++){
  const j=(i+1)%steps,a=i,b=j,c=steps+i,d=steps+j;
  ix.push(a,c,d,a,d,b,a+n,d+n,c+n,a+n,b+n,d+n);
  ix.push(a,b,b+n,a,b+n,a+n,c,d+n,d,c,c+n,d+n);
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setIndex(ix);g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
 g.userData={closedAnnularPrism:true,outerRadius:.073,innerRadius:.0365,thickness:.035,sourcePrescription:'PR88 collar dimensions; explicit annular topology avoids its coplanar triangulation T junctions'};return g;
}
export function build(T,{document=null,style=null}={}){
 const stock=buildCoupon(T,{document,style}),group=new T.Group();group.name='integral-body-two-pivot-link-tray-cutaway-v1';
 const geometries=[...stock.geometries],materials=[...stock.materials],textures=[...stock.textures],parts=[],byId=new Map(),stopRecords=[];let dead=false,a=20,b=-20;
 const wood=materials.find(m=>m.name==='honey-wood'),cream=materials.find(m=>m.name==='cream-board'),sage=materials.find(m=>m.name==='sage-edge'),brass=materials.find(m=>m.name==='muted-brass');
 const box=stock.byId.get('integral-base-board').geometry,pinGeo=stock.byId.get('through-axle').geometry,
 capGeo=stock.parts.find(p=>p.role==='endcap').mesh.geometry,collarGeo=closedCollar(T),
 bodyCheek=stock.parts.find(p=>p.role==='bearing-board').mesh.geometry;
 geometries.push(collarGeo);
 function geometry(g){geometries.push(g);return g;}
 const linkRoot=new T.Group();linkRoot.name='body-pivot-A';linkRoot.position.y=P;group.add(linkRoot);
 const trayRoot=new T.Group();trayRoot.name='tray-pivot-B';trayRoot.position.x=L;linkRoot.add(trayRoot);
 function add(id,geometry,material,parent,position,role,assembly,scale=[1,1,1],rotation=0,joints=[]){
  const mesh=new T.Mesh(geometry,material);mesh.name=id;mesh.position.set(...position);mesh.scale.set(...scale);mesh.rotation.z=rotation;mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);
  const part={id,mesh,role,assembly,joints};parts.push(part);byId.set(id,mesh);return mesh;
 }
 function bx(id,material,parent,x,y,z,w,h,d,role,assembly,rotation=0){return add(id,box,material,parent,[x,y,z],role,assembly,[w,h,d],rotation);}
 for(const x of[-.45,.55])for(const z of[-.30,.30])bx('body-foot-'+x+'-'+z,wood,group,x,.04,z,.13,.08,.13,'sole','body');
 bx('integral-body-bottom',wood,group,.05,.13,0,1.20,.10,.80,'bottom','body');
 for(const z of[-.365,.365])bx('body-cutaway-wall-'+z,cream,group,.05,.30,z,1.20,.24,.07,'bay-wall','body');
 for(const z of[-.125,.125])add('A-integral-bored-cheek-'+z,bodyCheek,wood,group,[0,P,z],'bored-cheek','body',[1,1,1],0,['A']);
 const outline=[[0,-.115],[L,-.115]];for(let i=1;i<=24;i++)outline.push([L+.115*Math.cos(-Math.PI/2+Math.PI*i/24),.115*Math.sin(-Math.PI/2+Math.PI*i/24)]);
 outline.push([0,.115]);for(let i=1;i<=24;i++)outline.push([.115*Math.cos(Math.PI/2+Math.PI*i/24),.115*Math.sin(Math.PI/2+Math.PI*i/24)]);
 const linkGeometry=geometry(bored(T,outline,[{center:[0,0],radius:.041},{center:[L,0],radius:.041}],.12));
 const link=add('two-bored-rigid-link',linkGeometry,wood,linkRoot,[0,0,0],'rigid-link','link',[1,1,1],0,['A','B']);
 const trayOutline=[[-.14,-.20],[.14,-.20],[.14,0]];for(let i=1;i<=24;i++)trayOutline.push([.14*Math.cos(Math.PI*i/24),.14*Math.sin(Math.PI*i/24)]);
 const trayCheek=geometry(bored(T,trayOutline,[{center:[0,0],radius:.044}],.09));
 for(const z of[-.125,.125])add('B-integral-bored-cheek-'+z,trayCheek,wood,trayRoot,[0,0,z],'bored-cheek','tray',[1,1,1],0,['B']);
 bx('integral-tray-bottom',wood,trayRoot,.38,-.24,0,1.02,.08,.80,'tray-bottom','tray');
 for(const z of[-.365,.365])bx('tray-cutaway-wall-'+z,cream,trayRoot,.38,-.14,z,1.02,.12,.07,'bay-wall','tray');
 // Two ears are real parts of the tray floor. They support its stops outside
 // the moving link's Z slab, without a stand, rail or prescribed level-tray guide.
 for(const z of[-.30,.30])bx('integral-tray-stop-ear-'+z,wood,trayRoot,-.28,-.24,z,.36,.08,.10,'stop-ear','tray');
 function pinJoint(joint,parent,assembly,pivot){
  add(joint+'-through-pin',pinGeo,brass,parent,pivot,'pin',assembly,[1,1,1],0,[joint]);
  for(const sign of[-1,1]){
   add(joint+'-retaining-collar-'+sign,collarGeo,brass,parent,[pivot[0],pivot[1],sign*.202],'collar',assembly,[1,1,1],0,[joint]);
   add(joint+'-closed-endcap-'+sign,capGeo,brass,parent,[pivot[0],pivot[1],sign*.2475],'endcap',assembly,[1,1,1],0,[joint]);
  }
 }
 pinJoint('A',group,'body',[0,P,0]);pinJoint('B',trayRoot,'tray',[0,0,0]);
 function stop(joint,endpoint,angle,x,y,parent,assembly,floorY){
  const c=Math.cos(angle*DEG),s=Math.sin(angle*DEG),px=c*x-s*y,py=s*x+c*y,base=joint==='A'?P:0;
  const block=bx(joint+'-integral-positive-stop-'+endpoint,sage,parent,px,base+py,0,.18,.05,.68,'positive-stop',assembly,angle*DEG);
  for(const z of[-.30,.30]){
   const bottom=Math.min(floorY,base+py),top=Math.max(floorY,base+py);
   bx(joint+'-integral-stop-bolster-'+endpoint+'-'+z,wood,parent,px,(bottom+top)/2,z,.075,Math.max(.035,top-bottom),.075,'stop-bolster',assembly);
  }
  stopRecords.push({joint,endpoint,mesh:block,role:'integral-positive-travel-stop'});
 }
 stop('A',20,20,.42,-.14,group,'body',.18);stop('A',50,50,.42,.14,group,'body',.18);
 // In tray coordinates the incoming link is at delta=-B: zero or +20 degrees.
 stop('B',0,0,-.30,.14,trayRoot,'tray',-.20);stop('B',-20,20,-.30,-.14,trayRoot,'tray',-.20);
 function state(){return{angleADegrees:a,angleBDegrees:b,trayAttitudeDegrees:a+b,manualOnly:true,twoIndependentRevoluteCoordinates:true,
  automaticLevelTrayConstraint:false,linkLength:L,rangeA:[20,50],rangeB:[-20,0],externalGuideStand:false,
  oneBodyTrayBayOnly:true,fullToolboxStandaloneOpening:false,physicalLoadFriction:false,normalGame:false,save:false};}
 function setPose(nextA,nextB){if(dead)throw Error('disposed');[a,b]=validatePose(nextA,nextB);linkRoot.rotation.z=a*DEG;trayRoot.rotation.z=b*DEG;group.updateMatrixWorld(true);return state();}
 setPose(a,b);
 function interval(A,B,low,high){const angles=[low*DEG,high*DEG],critical=Math.atan2(B,A);for(let k=-3;k<=3;k++){const t=critical+k*Math.PI;if(t>angles[0]&&t<angles[1])angles.push(t);}const values=angles.map(t=>A*Math.cos(t)+B*Math.sin(t));return[Math.min(...values),Math.max(...values)];}
 // Conservative continuous envelope only: tray-center and tray-angle extrema
 // are summed independently. This is not a continuous interference certificate.
 const boundsBox=new T.Box3();
 for(const part of parts){part.mesh.updateMatrix();const p=part.mesh.geometry.attributes.position;
  for(let i=0;i<p.count;i++){const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(part.mesh.matrix);let xr,yr;
   if(part.assembly==='body'){boundsBox.expandByPoint(v);continue;}
   if(part.assembly==='link'){xr=interval(v.x,-v.y,20,50);yr=interval(v.y,v.x,20,50);}
   else{const cx=interval(L,0,20,50),cy=interval(0,L,20,50),rx=interval(v.x,-v.y,0,50),ry=interval(v.y,v.x,0,50);xr=[cx[0]+rx[0],cx[1]+rx[1]];yr=[cy[0]+ry[0],cy[1]+ry[1]];}
   boundsBox.expandByPoint(new T.Vector3(xr[0],P+yr[0],v.z));boundsBox.expandByPoint(new T.Vector3(xr[1],P+yr[1],v.z));
  }
 }
 const bounds={min:boundsBox.min.toArray(),max:boundsBox.max.toArray(),size:boundsBox.getSize(new T.Vector3()).toArray(),method:'actual local rigid vertices; analytic separate trig extrema; conservative tray-center plus attitude envelope, not collision proof'};
 return{group,linkRoot,trayRoot,link,parts,byId,geometries,materials,textures,stopRecords,spec,bounds,setPose,getState:state,
  budget:{parts:parts.length,triangles:parts.reduce((n,p)=>n+(p.mesh.geometry.index?.count||p.mesh.geometry.attributes.position.count)/3,0),geometries:geometries.length,materials:materials.length,textures:textures.length,geometryAllocationsPerPose:0},
  footprint:{contactPartIds:parts.filter(p=>p.role==='sole').map(p=>p.id)},
  dispose(){if(dead)return;dead=true;for(const g of geometries)if(!stock.geometries.includes(g))g.dispose();stock.dispose();group.removeFromParent();}};
}

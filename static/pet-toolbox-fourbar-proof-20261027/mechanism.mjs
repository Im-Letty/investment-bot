/* Bounded, self-supported single tray carrier. Kinematic geometry, not a load simulation. */
export const spec=Object.freeze({unit:'wardrobe:other:storybook-sewing-toolbox:standalone-fourbar-tray:v1',revision:1,
 sourceImageSHA256:'6afc65a45e78a938b018987a85037a9bbbd4b63905aca1438927ea13d76db070',
 precedingRecipeSHA256:'5d0b6380e40a6585f5fae90a9b662ac5f3d442371f521890ed551df5587f074d',
 representation:'single-tray-carrier-two-mirrored-physical-parallelogram-link-pairs',manualCoordinates:1,
 externalGuideStand:false,fullToolboxClosure:false,sealedStorage:false,physicalLoadFriction:false,
 continuousCollisionGuarantee:false,grip:false,allGrowthFit:false,body360:false,normalPlacement:false,unlock:false,save:false});
export const dimensions=Object.freeze({basePivotHeight:.50,pivotSpan:1,linkLength:1,linkRadius:.09,linkThickness:.08,
 boreRadius:.034,pinRadius:.027,sideCenters:Object.freeze([-.50,.50]),angleRange:Object.freeze([45,80]),finiteAngles:Object.freeze(Array.from({length:36},(_,i)=>45+i))});
const D=Math.PI/180,L=dimensions.linkLength,S=dimensions.pivotSpan,P=dimensions.basePivotHeight;
export function validateAngle(a){if(typeof a!=='number'||!Number.isFinite(a)||a<45||a>80)throw Error('invalid_manual_fourbar_angle');return a;}
// Intersect the follower-link circle about the second base pin with the rigid
// tray's second-pin circle about B. Select the elevated assembly branch. The
// tray attitude is DERIVED from B->C; there is no prescribed level-tray guide.
export function solveClosure(angle,{linkLength=L,pivotSpan=S,couplerLength=S}={}){
 if(![angle,linkLength,pivotSpan,couplerLength].every(Number.isFinite)||Math.min(linkLength,pivotSpan,couplerLength)<=0)throw Error('invalid_fourbar_dimensions');
 const A=[-pivotSpan/2,P],D0=[pivotSpan/2,P],B=[A[0]+linkLength*Math.cos(angle*D),P+linkLength*Math.sin(angle*D)],
 dx=B[0]-D0[0],dy=B[1]-D0[1],distance=Math.hypot(dx,dy);
 if(distance<1e-10||distance>linkLength+couplerLength||distance<Math.abs(linkLength-couplerLength))throw Error('fourbar_cannot_close');
 const along=(linkLength**2-couplerLength**2+distance**2)/(2*distance),height2=linkLength**2-along**2;
 if(height2< -1e-12)throw Error('fourbar_cannot_close');
 const h=Math.sqrt(Math.max(0,height2)),cx=D0[0]+along*dx/distance,cy=D0[1]+along*dy/distance,
 candidates=[[cx-h*dy/distance,cy+h*dx/distance],[cx+h*dy/distance,cy-h*dx/distance]],
 C=candidates.sort((a,b)=>b[1]-a[1])[0],follower=Math.atan2(C[1]-D0[1],C[0]-D0[0]),tray=Math.atan2(C[1]-B[1],C[0]-B[0]);
 return{A,D:D0,B,C,crankRadians:angle*D,followerRadians:follower,trayRadians:tray,circleDistance:distance,
  closureResiduals:[Math.abs(Math.hypot(C[0]-D0[0],C[1]-D0[1])-linkLength),Math.abs(Math.hypot(C[0]-B[0],C[1]-B[1])-couplerLength)],
  assemblyBranch:'elevated-circle-intersection',solvedCoordinates:1};
}
function interval(A,B,lo=45,hi=80){const a=[lo*D,hi*D],critical=Math.atan2(B,A);for(let k=-3;k<=3;k++){const t=critical+k*Math.PI;if(t>a[0]&&t<a[1])a.push(t);}const v=a.map(t=>A*Math.cos(t)+B*Math.sin(t));return[Math.min(...v),Math.max(...v)];}
// Explicit triangulated extrusion recipe retained from PR98. Bores have front,
// back and inner wall faces. They are not dark discs painted onto solid boards.
function bored(T,outline,bores,depth){
 const clean=points=>{const a=[];for(const p of points){const v=new T.Vector2(...p.map(n=>Math.round(n*1e10)/1e10));if(!a.length||v.distanceTo(a.at(-1))>1e-9)a.push(v);}if(a[0].distanceTo(a.at(-1))<1e-9)a.pop();return a;},
 outer=clean(outline),holes=bores.map(b=>clean(Array.from({length:48},(_,i)=>[b.center[0]+b.radius*Math.cos(-2*Math.PI*i/48),b.center[1]+b.radius*Math.sin(-2*Math.PI*i/48)])));
 if(T.ShapeUtils.isClockWise(outer))outer.reverse();for(const h of holes)if(!T.ShapeUtils.isClockWise(h))h.reverse();
 const loops=[outer,...holes],all=loops.flat(),n=all.length,pos=[],ix=[];
 for(const z of[-depth/2,depth/2])for(const p of all)pos.push(p.x,p.y,z);
 for(const f of T.ShapeUtils.triangulateShape(outer,holes)){let[a,b,c]=f;const p=all[a],q=all[b],r=all[c];if((q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x)<0)[b,c]=[c,b];ix.push(a,c,b,a+n,b+n,c+n);}
 let o=0;for(const loop of loops){for(let i=0;i<loop.length;i++){const a=o+i,b=o+(i+1)%loop.length;ix.push(a,b,b+n,a,b+n,a+n);}o+=loop.length;}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setIndex(ix);g.computeVertexNormals();g.userData={outline:outer.map(p=>p.toArray()),bores:bores.map(b=>({center:b.center.slice(),nominalRadius:b.radius,axis:'z'})),closedBoredPrism:true};return g;
}
function collar(T){const steps=48,p=[],ix=[],n=96;for(const z of[-.01,.01])for(const r of[.057,.0285])for(let i=0;i<steps;i++){const a=i*2*Math.PI/steps;p.push(r*Math.cos(a),r*Math.sin(a),z);}for(let i=0;i<steps;i++){const j=(i+1)%steps,a=i,b=j,c=48+i,d=48+j;ix.push(a,c,d,a,d,b,a+n,d+n,c+n,a+n,b+n,d+n,a,b,b+n,a,b+n,a+n,c,d+n,d,c,c+n,d+n);}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();g.userData={closedAnnularPrism:true,innerRadius:.0285,outerRadius:.057};return g;}
export function build(T,{document=null,style=null}={}){
 const group=new T.Group(),trayRoot=new T.Group();group.name='standalone-fourbar-single-tray-carrier-v1';trayRoot.name='circle-closure-derived-tray';group.add(trayRoot);
 const geometries=[],materials=[],textures=[],parts=[],byId=new Map(),links=[],joints=[],stopRecords=[];let dead=false,angle=62.5,solution;
 function geo(g){g.computeBoundingBox();g.computeBoundingSphere();geometries.push(g);return g;}
 let tex=null;if(document&&style?.surfaceTexture){tex=style.surfaceTexture(T,document,'wood');if(tex)textures.push(tex);}
 function mat(name,color,map=null){const m=new T.MeshStandardMaterial({name,color,map,roughness:.79,metalness:name==='muted-brass'?.38:0});materials.push(m);return m;}
 const wood=mat('honey-wood',0xb98c58,tex),cream=mat('cream-board',0xe5dbc3),sage=mat('sage-edge',0x9ba886),lilac=mat('lilac-detail',0xbca3c7),brass=mat('muted-brass',0xb59a55),box=geo(new T.BoxGeometry(1,1,1)),shaft=geo(new T.CylinderGeometry(.027,.027,.33,48)),cap=geo(new T.CylinderGeometry(.052,.052,.015,48)),ring=geo(collar(T));
 shaft.rotateX(Math.PI/2);cap.rotateX(Math.PI/2);shaft.computeBoundingBox();cap.computeBoundingBox();
 function add(id,g,m,parent,pos,role,assembly,scale=[1,1,1],rotation=0,jointIds=[]){const mesh=new T.Mesh(g,m);mesh.name=id;mesh.position.set(...pos);mesh.scale.set(...scale);mesh.rotation.z=rotation;mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);parts.push({id,mesh,role,assembly,joints:jointIds});byId.set(id,mesh);return mesh;}
 const bx=(id,m,parent,x,y,z,w,h,d,role,assembly,rot=0)=>add(id,box,m,parent,[x,y,z],role,assembly,[w,h,d],rot);
 for(const x of[-1.22,1.22])for(const z of[-.55,.55])bx('base-sole-'+x+'-'+z,wood,group,x,.04,z,.18,.08,.18,'sole','base');
 bx('closed-base-bottom',wood,group,0,.14,0,2.94,.12,1.40,'bottom','base');
 for(const z of[-.66,.66])bx('base-side-wall-'+z,cream,group,0,.27,z,2.94,.14,.08,'wall','base');
 for(const x of[-1.43,1.43])bx('base-end-wall-'+x,cream,group,x,.27,0,.08,.14,1.24,'wall','base');
 bx('base-linen-inlay',cream,group,0,.14,.706,2.56,.065,.012,'inlay','base');
 for(const x of[-.18,0,.18])bx('lilac-stitch-'+x,lilac,group,x,.14,.715,.055,.035,.008,'inlay','base');
 bx('closed-tray-bottom',wood,trayRoot,.5,.16,0,1.40,.08,.78,'tray-bottom','tray');
 for(const z of[-.355,.355])bx('tray-side-wall-'+z,cream,trayRoot,.5,.29,z,1.40,.18,.07,'wall','tray');
 for(const x of[-.165,1.165])bx('tray-end-wall-'+x,cream,trayRoot,x,.29,0,.07,.18,.64,'wall','tray');
 // Attached crossbars connect both upper clevis pairs to the tray's own floor.
 for(const x of[0,1])bx('tray-integral-bearing-crossbar-'+x,wood,trayRoot,x,.16,0,.20,.08,1.24,'bearing-crossbar','tray');
 const outline=[[0,-.09],[L,-.09]];for(let i=1;i<=24;i++)outline.push([L+.09*Math.cos(-Math.PI/2+Math.PI*i/24),.09*Math.sin(-Math.PI/2+Math.PI*i/24)]);outline.push([0,.09]);for(let i=1;i<=24;i++)outline.push([.09*Math.cos(Math.PI/2+Math.PI*i/24),.09*Math.sin(Math.PI/2+Math.PI*i/24)]);
 const linkGeo=geo(bored(T,outline,[{center:[0,0],radius:.034},{center:[1,0],radius:.034}],.08)),baseOutline=[[-.10,-.30],[.10,-.30],[.10,0]],trayOutline=[[-.10,.20],[-.10,0]];
 for(let i=1;i<=24;i++)baseOutline.push([.10*Math.cos(Math.PI*i/24),.10*Math.sin(Math.PI*i/24)]);
 for(let i=1;i<=24;i++)trayOutline.push([.10*Math.cos(Math.PI+Math.PI*i/24),.10*Math.sin(Math.PI+Math.PI*i/24)]);trayOutline.push([.10,.20]);
 const baseCheek=geo(bored(T,baseOutline,[{center:[0,0],radius:.036}],.06)),trayCheek=geo(bored(T,trayOutline,[{center:[0,0],radius:.036}],.06));
 for(const side of[-1,1])for(const arm of[0,1]){
  const z=side*.50,x=-.5+arm,root=new T.Group();root.name='physical-link-root-'+side+'-'+arm;root.position.set(x,P,z);group.add(root);
  const low='s'+side+'-a'+arm+'-lower',upper='s'+side+'-a'+arm+'-upper',link=add('two-bored-link-'+side+'-'+arm,linkGeo,wood,root,[0,0,0],'rigid-link','link-'+side+'-'+arm,[1,1,1],0,[low,upper]);links.push({side,arm,root,mesh:link,lower:low,upper});
  function joint(id,parent,position,cheekGeo,assembly,endpoint){
   const [x,y,z]=position,cheeks=[];
   for(const sign of[-1,1])cheeks.push(add(id+'-bored-cheek-'+sign,cheekGeo,wood,parent,[x,y,z+sign*.09],'bored-cheek',assembly,[1,1,1],0,[id]));
   const pin=add(id+'-through-pin',shaft,brass,parent,position,'pin',assembly,[1,1,1],0,[id]),collars=[],caps=[];
   for(const sign of[-1,1]){collars.push(add(id+'-retaining-collar-'+sign,ring,brass,parent,[x,y,z+sign*.138],'collar',assembly,[1,1,1],0,[id]));caps.push(add(id+'-closed-endcap-'+sign,cap,brass,parent,[x,y,z+sign*.1725],'endcap',assembly,[1,1,1],0,[id]));}
   joints.push({id,pin,cheeks,collars,caps,link,endpoint,side,arm});
  }
  joint(low,group,[x,P,z],baseCheek,'base',0);joint(upper,trayRoot,[arm,0,z],trayCheek,'tray',1);
 }
 // Only the first crank needs positive limits. Both mirrored crank links have
 // pads and attached outboard bolsters; no support lies under a moving link.
 for(const side of[-1,1])for(const endpoint of[45,80]){
  const a=endpoint*D,sign=endpoint===45?-1:1,q=[.44,sign*(.09+.025)],x=-.5+q[0]*Math.cos(a)-q[1]*Math.sin(a),y=P+q[0]*Math.sin(a)+q[1]*Math.cos(a),z=side*.5,
  pad=bx('integral-stop-'+side+'-'+endpoint,sage,group,x,y,z,.12,.05,.32,'positive-stop','base',a);
  for(const dz of[-.14,.14])bx('stop-bolster-'+side+'-'+endpoint+'-'+dz,wood,group,x,(.20+y)/2,z+dz,.05,y-.20,.04,'stop-bolster','base');
  stopRecords.push({side,endpoint,mesh:pad,link:links.find(l=>l.side===side&&l.arm===0).mesh});
 }
 function state(){return{angleDegrees:angle,rangeDegrees:[45,80],manualOnly:true,manualCoordinates:1,pairedSides:2,physicalLinks:4,realPinJoints:8,
  closureMethod:'second-upper-pin from follower-circle / rigid-tray-circle intersection',trayAttitudeDegrees:solution.trayRadians/D,maximumSolverResidual:Math.max(...solution.closureResiduals),
  trayPoseDerivedFromTwoSolvedPins:true,externalGuideStand:false,singleTrayCarrierOnly:true,fullToolboxClosure:false,sealedStorage:false,physicalLoadFriction:false,continuousCollisionGuarantee:false,normalGame:false,save:false};}
 function setAngle(a){if(dead)throw Error('disposed');angle=validateAngle(a);solution=solveClosure(a);for(const link of links)link.root.rotation.z=link.arm===0?solution.crankRadians:solution.followerRadians;trayRoot.position.set(solution.B[0],solution.B[1],0);trayRoot.rotation.z=solution.trayRadians;group.updateMatrixWorld(true);return state();}
 setAngle(angle);
 // Equal opposite link lengths make the selected solved branch a parallelogram.
 // This conservative vertex envelope follows that exact closure identity. It
 // encloses the sweep, and does not certify continuous collision freedom.
 const envelope=new T.Box3();for(const part of parts){part.mesh.updateMatrix();const p=part.mesh.geometry.attributes.position;for(let i=0;i<p.count;i++){
  const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(part.mesh.matrix);let xr,yr,z=v.z;
  if(part.assembly==='base'){envelope.expandByPoint(v);continue;}
  if(part.assembly==='tray'){const tx=interval(L,0),ty=interval(0,L);xr=[-.5+tx[0]+v.x,-.5+tx[1]+v.x];yr=[P+ty[0]+v.y,P+ty[1]+v.y];}
  else{const row=links.find(l=>l.mesh===part.mesh),xx=interval(v.x,-v.y),yy=interval(v.y,v.x);xr=[row.root.position.x+xx[0],row.root.position.x+xx[1]];yr=[P+yy[0],P+yy[1]];z+=row.root.position.z;}
  envelope.expandByPoint(new T.Vector3(xr[0],yr[0],z));envelope.expandByPoint(new T.Vector3(xr[1],yr[1],z));
 }}
 const bounds={min:envelope.min.toArray(),max:envelope.max.toArray(),size:envelope.getSize(new T.Vector3()).toArray(),method:'actual rigid vertices; analytic trig extrema over45..80deg on circle-solved equal-length parallelogram branch; envelope, not continuous collision proof'},
 budget={parts:parts.length,triangles:parts.reduce((n,p)=>n+(p.mesh.geometry.index?.count||p.mesh.geometry.attributes.position.count)/3,0),geometries:geometries.length,materials:materials.length,textures:textures.length,geometryAllocationsPerPose:0};
 return{group,trayRoot,parts,byId,links,joints,geometries,materials,textures,stopRecords,spec,bounds,budget,footprint:{contactPartIds:parts.filter(p=>p.role==='sole').map(p=>p.id)},setAngle,getState:state,getSolution:()=>structuredClone(solution),
  dispose(){if(dead)return;dead=true;for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();group.removeFromParent();}};
}

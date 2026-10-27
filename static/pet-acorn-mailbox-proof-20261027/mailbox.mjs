/* Existing-art mailbox: authored hidden construction, isolated manual hatch prerequisite. */
export const spec=Object.freeze({id:'acorn-mailbox-shell-door-v1',unit:'wardrobe:item:acorn-mailbox:shell-door-prerequisite:v1',sourceSHA:'3d7a9773655f9a64536635c319c59b0e00f03dab8a9937af0d6d43daeb69e54a',revision:2,pinLength:.90,fixedCollarInnerRadius:.0105,angleMin:0,angleMax:95,hingeAxis:Object.freeze([0,1.435,.405]),hingeInnerRadius:.016,hingeOuterRadius:.038,pinRadius:.012,authoredWorldDimensions:true,hiddenBackAndInterior:'Authored technical construction; not observed from the single original image',bodyBinding:null,newDesign:false,newRaw:false,newMeshLibraryCandidate:false,normalPlacement:false,ownershipUnlockSave:false,deliverOrRewards:false});
export function build(T){
 const group=new T.Group();group.name=spec.id;const parts=[],feet=[],knuckles=[],mounts=[],tiles=[],resources={geometries:new Set(),materials:new Set(),textures:new Set()};
 const mat=(color,more={})=>{const m=new T.MeshStandardMaterial({color,roughness:.78,metalness:0,...more});resources.materials.add(m);return m;},cream=mat('#eee1c2'),oak=mat('#d5ac68'),gold=mat('#c4a163',{metalness:.15,roughness:.56}),leaf=mat('#a9c2a1'),stone=mat('#bbb7a8'),inner=mat('#d3c2a1');
 const moving=new T.Group();moving.name='hinged-door';moving.position.set(...spec.hingeAxis);group.add(moving);
 function part(id,g,m,x,y,z,role,parent=group){resources.geometries.add(g);const mesh=new T.Mesh(g,m);mesh.name=id;mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);parts.push({id,role,mesh});return mesh;}
 function box(id,w,h,d,x,y,z,m,role,parent=group){return part(id,new T.BoxGeometry(w,h,d),m,x,y,z,role,parent);}
 function round(w,h,r,ox=0,oy=0){const s=new T.Shape();s.moveTo(ox-w/2+r,oy-h/2);s.lineTo(ox+w/2-r,oy-h/2);s.quadraticCurveTo(ox+w/2,oy-h/2,ox+w/2,oy-h/2+r);s.lineTo(ox+w/2,oy+h/2-r);s.quadraticCurveTo(ox+w/2,oy+h/2,ox+w/2-r,oy+h/2);s.lineTo(ox-w/2+r,oy+h/2);s.quadraticCurveTo(ox-w/2,oy+h/2,ox-w/2,oy+h/2-r);s.lineTo(ox-w/2,oy-h/2+r);s.quadraticCurveTo(ox-w/2,oy-h/2,ox-w/2+r,oy-h/2);s.closePath();return s;}
 function extrusion(shape,d){return new T.ExtrudeGeometry(shape,{depth:d,bevelEnabled:false,steps:1,curveSegments:6});}
 function panel(id,w,h,r,d,x,y,z,m,role,parent=group){return part(id,extrusion(round(w,h,r),d),m,x,y,z-d/2,role,parent);}
 function ring(id,w,h,r,iw,ih,ir,d,x,y,z,m,role,parent=group){const s=round(w,h,r);s.holes.push(round(iw,ih,ir));return part(id,extrusion(s,d),m,x,y,z-d/2,role,parent);}
 function ellipsoid(id,rx,ry,rz,x,y,z,m,role,parent=group){const g=new T.SphereGeometry(1,12,8);g.scale(rx,ry,rz);return part(id,g,m,x,y,z,role,parent);}
 function rod(id,a,b,r,m,role,parent=group){const av=new T.Vector3(...a),bv=new T.Vector3(...b),delta=bv.clone().sub(av),mesh=part(id,new T.CylinderGeometry(r,r,delta.length(),10),m,...av.clone().add(bv).multiplyScalar(.5).toArray(),role,parent);mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());return mesh;}
 // A closed revolution with single axis poles, no zero-area cap triangles.
 function revolve(points,segments=20){
  const positions=[],rings=[],indices=[];
  for(const [r,y]of points){const row=[];if(r===0){row.push(positions.length/3);positions.push(0,y,0);}else for(let j=0;j<segments;j++){const a=j*2*Math.PI/segments;row.push(positions.length/3);positions.push(r*Math.cos(a),y,r*Math.sin(a));}rings.push(row);}
  for(let i=0;i<rings.length;i++){const a=rings[i],b=rings[(i+1)%rings.length];if(a.length===1&&b.length===1)continue;for(let j=0;j<segments;j++){const k=(j+1)%segments;if(a.length===1)indices.push(a[0],b[j],b[k]);else if(b.length===1)indices.push(a[j],b[0],a[k]);else indices.push(a[j],b[j],b[k],a[j],b[k],a[k]);}}
  let volume=0;for(let i=0;i<indices.length;i+=3){const a=new T.Vector3().fromArray(positions,indices[i]*3),b=new T.Vector3().fromArray(positions,indices[i+1]*3),c=new T.Vector3().fromArray(positions,indices[i+2]*3);volume+=a.dot(b.cross(c))/6;}
  if(volume<0)for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();return g;
 }
 for(const x of[-.25,.25])for(const z of[-.20,.20])feet.push(box('stone-foot-'+x+'-'+z,.14,.07,.14,x,.035,z,stone,'foot'));
 const base=panel('stone-leaf-base-core',.76,.61,.18,.08,0,.09,0,stone,'base');base.rotation.x=-Math.PI/2; // reset below: X/Y plate becomes X/Z, vertical min .05
 base.position.set(0,.05,0);
 const baseLeaves=[];for(const [i,x,z,a]of [[0,-.26,.05,-.6],[1,.25,.07,.6],[2,0,-.19,0]]){const p=ellipsoid('base-leaf-'+i,.23,.065,.32,x,.15,z,leaf,'base-leaf');p.rotation.y=a;baseLeaves.push(p);}
 const post=part('tapered-leaf-post',new T.CylinderGeometry(.10,.15,.79,12),leaf,0,.50,0,'post');
 const postBase=part('post-base-collar',new T.CylinderGeometry(.17,.18,.055,14),gold,0,.17,0,'collar');
 const neck=part('body-support-collar',new T.CylinderGeometry(.17,.12,.09,14),gold,0,.88,0,'collar');
 const cy=1.29,outer=round(1.10,.80,.22),voidShape=round(.94,.64,.15);
 outer.holes.push(voidShape);
 const shell=part('closed-thick-perimeter-shell',extrusion(outer,.58),cream,0,cy,-.29,'shell');
 const back=panel('closed-authored-back-wall',1.10,.80,.22,.055,0,cy,-.3125,cream,'back-wall');
 const frontShape=round(1.10,.80,.22);frontShape.holes.push(round(.66,.44,.09,0,1.185-cy));frontShape.holes.push(round(.53,.075,.035,0,1.565-cy));
 const front=part('front-wall-actual-door-and-slot-holes',extrusion(frontShape,.06),cream,0,cy,.29,'front-wall');
 const floor=box('inner-closed-floor',.87,.035,.52,0,.9775,-.005,inner,'inner-floor');
 const hatchRim=ring('gold-hatch-rim',.70,.48,.11,.66,.44,.09,.018,0,1.185,.359,gold,'door-rim');
 const slotRim=ring('gold-mail-slot-rim',.575,.115,.05,.53,.075,.035,.020,0,1.565,.3595,gold,'slot-rim');
 const door=panel('solid-hatch-panel',.63,.415,.078,.035,0,1.185-spec.hingeAxis[1],-.025,cream,'door',moving);
 const doorRim=ring('hatch-panel-gold-inlay',.60,.385,.070,.582,.367,.061,.008,0,1.185-spec.hingeAxis[1],-.004,gold,'door-decoration',moving);
 const badge=ring('letter-envelope-badge-outline',.245,.145,.018,.223,.123,.009,.009,0,-.250,-.004,gold,'door-decoration',moving);
 rod('envelope-fold-left',[-.107,-.197,-.005],[0,-.268,-.005],.006,gold,'door-decoration',moving);rod('envelope-fold-right',[0,-.268,-.005],[.107,-.197,-.005],.006,gold,'door-decoration',moving);
 const knob=ellipsoid('hatch-round-knob',.034,.034,.026,0,-.388,.014,gold,'knob',moving);
 const hingeProfile=[[spec.hingeOuterRadius,-.067],[spec.hingeOuterRadius,.067],[spec.hingeInnerRadius,.067],[spec.hingeInnerRadius,-.067]];
 for(let i=0;i<5;i++){const fixed=i%2===0,x=(i-2)*.16,knuckle=part((fixed?'fixed':'moving')+'-bored-knuckle-'+i,revolve(hingeProfile,16),gold,x,fixed?spec.hingeAxis[1]:0,fixed?spec.hingeAxis[2]:0,'hinge-knuckle',fixed?group:moving);knuckle.rotation.z=Math.PI/2;knuckles.push(knuckle);
  if(fixed)mounts.push(box('fixed-exterior-hinge-web-'+i,.075,.045,.105,x,1.4925,.3625,gold,'fixed-web'));
  else mounts.push(box('moving-exterior-hinge-web-'+i,.075,.045,.060,x,-.055,-.025,gold,'moving-web',moving));
 }
 const pin=part('single-through-hinge-pin',new T.CylinderGeometry(spec.pinRadius,spec.pinRadius,spec.pinLength,12),gold,...spec.hingeAxis,'hinge-pin');pin.rotation.z=Math.PI/2;
 for(const x of[-.422,.422]){const r=part('pin-retainer-'+x,revolve([[.025,-.008],[.025,.008],[spec.fixedCollarInnerRadius,.008],[spec.fixedCollarInnerRadius,-.008]],16),gold,x,spec.hingeAxis[1],spec.hingeAxis[2],'fixed-shaft-collar');r.rotation.z=Math.PI/2;}
 const roofProfile=[[0,1.655],[.62,1.655],[.64,1.69],[.62,1.75],[.55,1.84],[.44,1.94],[.30,2.005],[.13,2.04],[0,2.045]];
 const roof=part('closed-solid-acorn-roof',revolve(roofProfile,24),oak,0,0,0,'roof');
 for(const [level,n,r,y,rx,rz]of [[0,8,.48,1.812,.18,.22],[1,6,.28,1.972,.17,.19]]){
  for(let j=0;j<n;j++){const a=2*Math.PI*(j+(level?.5:0))/n,t=ellipsoid('acorn-shingle-'+level+'-'+j,rx,.043,rz,r*Math.cos(a),y,r*Math.sin(a),oak,'roof-shingle');t.rotation.y=-a+Math.PI/2;t.rotation.z=level?-.32*Math.cos(a):-.52*Math.cos(a);t.rotation.x=level?.32*Math.sin(a):.52*Math.sin(a);tiles.push(t);}
 }
 const stemA=rod('acorn-stem-lower',[0,2.02,0],[.045,2.16,0],.052,oak,'roof-stem'),stemB=rod('acorn-stem-tip',[.04,2.145,0],[.12,2.205,0],.043,oak,'roof-stem');
 const stemJoint=ellipsoid('acorn-stem-rounded-joint',.05,.05,.05,.04,2.15,0,oak,'roof-stem');
 const stemTip=ellipsoid('acorn-stem-rounded-tip',.043,.043,.043,.12,2.205,0,oak,'roof-stem');
 const topLeaf=ellipsoid('acorn-stem-leaf',.19,.028,.095,.22,2.115,.012,leaf,'roof-leaf');topLeaf.rotation.z=-.35;topLeaf.rotation.y=.2;
 rod('leaf-center-vein',[.064,2.173,.015],[.37,2.058,.015],.007,gold,'roof-leaf-vein');
 let angle=0,disposed=false;
 function setAngle(degrees){if(disposed)throw Error('mailbox_disposed');if(typeof degrees!=='number'||!Number.isFinite(degrees)||degrees<spec.angleMin||degrees>spec.angleMax)throw Error('mailbox_angle_invalid');angle=degrees;moving.rotation.x=-degrees*Math.PI/180;group.updateMatrixWorld(true);return angle;}
 group.updateMatrixWorld(true);
 const restBox=new T.Box3().setFromObject(group,true),envelope=restBox.clone(),poseWitnesses=[];
 // This sampled swept envelope is a finite diagnostic witness, not continuous collision certification.
 for(let a=0;a<=95;a+=5){setAngle(a);const bounds=new T.Box3().setFromObject(group,true);envelope.union(bounds);poseWitnesses.push({angle:a,doorBounds:new T.Box3().setFromObject(moving,true).min.toArray().concat(new T.Box3().setFromObject(moving,true).max.toArray())});}
 setAngle(0);
 const bounds={min:envelope.min.toArray(),max:envelope.max.toArray(),size:envelope.getSize(new T.Vector3()).toArray()},restBounds={min:restBox.min.toArray(),max:restBox.max.toArray()},budget={meshes:parts.length,geometries:resources.geometries.size,materials:resources.materials.size,textures:0,triangles:parts.reduce((n,p)=>n+(p.mesh.geometry.index?p.mesh.geometry.index.count:p.mesh.geometry.attributes.position.count)/3,0),lights:0};
 function inspect(){let invalidPositions=0,invalidNormals=0;for(const g of resources.geometries){const p=g.attributes.position,n=g.attributes.normal;for(let i=0;i<p.count;i++){if(![p.getX(i),p.getY(i),p.getZ(i)].every(Number.isFinite))invalidPositions++;const len=Math.hypot(n.getX(i),n.getY(i),n.getZ(i));if(!Number.isFinite(len)||Math.abs(len-1)>1e-5)invalidNormals++;}}return{angle,bounds,restBounds,budget,invalidPositions,invalidNormals,realFrontOpenings:2,hinge:{knuckles:5,throughPins:1,axis:spec.hingeAxis,innerRadius:spec.hingeInnerRadius,pinRadius:spec.pinRadius,pinLength:spec.pinLength,collarInnerRadius:spec.fixedCollarInnerRadius,collarAttachment:'authored fixed overlap with shaft; not friction or load certification',radialClearance:spec.hingeInnerRadius-spec.pinRadius},sampledPoseWitnesses:poseWitnesses.length,backAndCavityAuthored:true,bodyBinding:null,wearingFit:false,delivery:false,rewards:false,normalPlacement:false,ownershipUnlockSave:false,physicalLoadFrictionSealVerified:false,continuousCollisionCertified:false};}
 return{group,parts,feet,resources,moving,door,doorRim,front,shell,back,floor,hatchRim,slotRim,knuckles,mounts,pin,roof,tiles,post,neck,base,postBase,baseLeaves,bounds,restBounds,poseWitnesses,budget,spec,inspect,setAngle,get angle(){return angle;},get disposed(){return disposed;},dispose(){if(disposed)return;disposed=true;for(const set of Object.values(resources))for(const x of set)x.dispose();group.removeFromParent();group.clear();}};
}

/* One new authored open-front cape. No body dimensions or reconstructed backside. */
import {inspectTopology,inspectFaceNormalAgreement,segmentHits,strictContainment,contactProbeDirections,inspectCrossings} from './geometry-audit.mjs';
export {inspectTopology,inspectFaceNormalAgreement,segmentHits,strictContainment,contactProbeDirections,inspectCrossings};
export const spec=Object.freeze({id:'breeze-cape-garment-volume-v1',unit:'wardrobe:fit-prerequisite:breeze-cape:garment-volume-openings:v1',sourceSHA:'e9ad18c4b38fbd1db5336d93be771f1eb74490fcf136ff0f9d87c4ab3f5caa0f',bodyBinding:null,bodyMeasurements:false,wearingFit:false,rig:false,clothPhysics:false,normalGame:false,unlockSave:false,newRaw:false,newDesign:false,newVillageLibraryCandidate:false,dimensions:'Authored garment-local trial values only. Neither body measurements nor fit calibration.',rear:'New authored mantle back and interior, not recovered source artwork or hidden anatomy.',fastening:'Fixed padded bow and connected cloth; no opening animation or fastening mechanics.'});
const DELTA=.22,THICKNESS=.035,ANGULAR=56,RADIAL=12;
function pointAt(T,theta,t){
 const radialT=Math.max(0,t),fold=Math.cos(theta*8)*Math.sin(Math.PI*radialT/2)*.035;
 const rx=.32+.91*Math.pow(radialT,.84)+fold,rz=.30+.40*Math.pow(radialT,.9)+fold*.6;
 const hemWave=.045*Math.cos(theta*8)*Math.pow(t,5);
 return new T.Vector3(Math.sin(theta)*rx,1.62-1.35*t+hemWave,Math.cos(theta)*rz);
}
function clothNormal(T,theta,t){
 t=Math.max(0,Math.min(1,t));
 const e=1e-4,dTheta=pointAt(T,theta+e,t).sub(pointAt(T,theta-e,t)),lo=Math.max(0,t-e),hi=Math.min(1,t+e),dT=pointAt(T,theta,hi).sub(pointAt(T,theta,lo));
 return dTheta.cross(dT).normalize();
}
function patch(T,{theta0=DELTA,theta1=2*Math.PI-DELTA,t0=0,t1=1,outerOffset=0,thickness=THICKNESS,angular=ANGULAR,radial=RADIAL,name='patch'}){
 const outer=[],inner=[],uv=[],faces=[],stride=radial+1;
 for(let a=0;a<=angular;a++)for(let r=0;r<=radial;r++){
  const u=a/angular,v=r/radial,theta=theta0+(theta1-theta0)*u,low=typeof t0==='function'?t0(theta):t0,high=typeof t1==='function'?t1(theta):t1,t=low+(high-low)*v;
  if(!(high>low&&t>=-.025&&t<=1.025))throw Error('cape_invalid_patch_domain');
  const offsetValue=typeof outerOffset==='function'?outerOffset(theta,t):outerOffset,thicknessValue=typeof thickness==='function'?thickness(theta,t):thickness;if(!Number.isFinite(offsetValue)||!Number.isFinite(thicknessValue)||!(thicknessValue>0))throw Error('cape_invalid_material_profile');const n=clothNormal(T,theta,t),p=pointAt(T,theta,t).addScaledVector(n,offsetValue);outer.push(p);inner.push(p.clone().addScaledVector(n,-thicknessValue));uv.push([theta,t]);
 }
 for(let a=0;a<angular;a++)for(let r=0;r<radial;r++){const i=a*stride+r,j=(a+1)*stride+r;faces.push([i,j,j+1],[i,j+1,i+1]);}
 const n=outer.length,all=[...outer,...inner],indices=faces.flat();
 for(const f of faces)indices.push(f[2]+n,f[1]+n,f[0]+n);
 const boundary=[];
 for(let a=0;a<angular;a++)boundary.push([a*stride,(a+1)*stride]);
 for(let r=0;r<radial;r++)boundary.push([angular*stride+r,angular*stride+r+1]);
 for(let a=angular;a>0;a--)boundary.push([a*stride+radial,(a-1)*stride+radial]);
 for(let r=radial;r>0;r--)boundary.push([r,r-1]);
 for(const[a,b]of boundary)indices.push(b,a,a+n,b,a+n,b+n);
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(all.flatMap(p=>p.toArray()),3));g.setIndex(indices);g.computeVertexNormals();
 // Keep the actual triangles and orient every closed material consistently.
 let vol=0;for(let j=0;j<indices.length;j+=3){const[a,b,c]=indices.slice(j,j+3).map(i=>all[i]);vol+=a.dot(b.clone().cross(c))/6;}
 if(vol<0){for(let j=0;j<indices.length;j+=3)[indices[j+1],indices[j+2]]=[indices[j+2],indices[j+1]];g.setIndex(indices);}
 // Cloth panels share vertex normals within each continuous outer/inner surface.
 // The four boundary strips remain separate normal groups, preserving real
 // outer/inner thickness edges and the two open-front corner creases.
 const original=g.attributes.position,positions=[],renderIndices=[],maps=Array.from({length:6},()=>new Map()),outerIndexCount=faces.length*3;
 for(let j=0;j<indices.length;j+=3){
  let region;
  if(j<outerIndexCount)region=0;
  else if(j<outerIndexCount*2)region=1;
  else{const edge=Math.floor((j-outerIndexCount*2)/6);region=edge<angular?2:edge<angular+radial?3:edge<angular*2+radial?4:5;}
  const map=maps[region];
  for(let k=0;k<3;k++){const sourceIndex=indices[j+k];let renderIndex=map.get(sourceIndex);if(renderIndex===undefined){renderIndex=positions.length/3;positions.push(original.getX(sourceIndex),original.getY(sourceIndex),original.getZ(sourceIndex));map.set(sourceIndex,renderIndex);}renderIndices.push(renderIndex);}
 }
 const smooth=new T.BufferGeometry();smooth.setAttribute('position',new T.Float32BufferAttribute(positions,3));smooth.setIndex(renderIndices);smooth.computeVertexNormals();smooth.computeBoundingBox();smooth.computeBoundingSphere();
 for(let j=0;j<indices.length;j++)for(let axis=0;axis<3;axis++)if(original.array[indices[j]*3+axis]!==smooth.attributes.position.array[renderIndices[j]*3+axis])throw Error('cape_normal_repair_changed_triangle');
 g.dispose();
 return{geometry:smooth,outerFaceCount:faces.length,normalConstruction:{outerAndInnerSharedWithinTheirOwnClothSurface:true,separateRimStrips:4,openFrontCreasesPreserved:true,actualTrianglePositionsAndWindingUnchanged:true,comparisonScope:'normal sharing preserves the input triangles of this same build'},domain:{name,theta0,theta1,angular,radial,thickness,outerOffset},sample(theta,t){const offsetValue=typeof outerOffset==='function'?outerOffset(theta,t):outerOffset;return pointAt(T,theta,t).addScaledVector(clothNormal(T,theta,t),offsetValue);}};
}
function nearestOuter(T,data,desired){
 const p=data.geometry.attributes.position,i=data.geometry.index,closest=new T.Vector3();let best=null;
 for(let j=0;j<data.outerFaceCount*3;j+=3){const v=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(p,i.getX(j+k))),tri=new T.Triangle(...v);tri.closestPointToPoint(desired,closest);const distance=closest.distanceToSquared(desired);if(!best||distance<best.distance)best={distance,point:closest.clone(),normal:tri.getNormal(new T.Vector3()),face:j/3};}
 return best;
}
export function build(T){
 if(!T?.BufferGeometry||!T?.Ray)throw Error('cape_three_required');
 const group=new T.Group();group.name=spec.id;const geometries=new Set(),materials=[],parts=[],contacts=[],patches={};let disposed=false;
 const material=(name,color,roughness=.88,metalness=0)=>{const m=new T.MeshStandardMaterial({name,color,roughness,metalness,side:T.FrontSide});materials.push(m);return m;};
 const mint=material('soft-mint-cloth','#afd4c2'),layerMint=material('shoulder-mint-cloth','#badbca'),cream=material('rounded-warm-ivory-cloth','#f0e6d3'),lining=material('warm-cream-lining','#dfd3bd'),gold=material('restrained-soft-gold-binding','#bf9e62',.64,.12),leafMat=material('cream-leaf-relief','#e8ddc7');
 const add=(name,g,m)=>{geometries.add(g);const mesh=new T.Mesh(g,m);mesh.name=name;group.add(mesh);parts.push(mesh);return mesh;};
 function addPatch(name,opts,m){const data=patch(T,{...opts,name});patches[name]=data;const mesh=add(name,data.geometry,m);return{mesh,data};}
 const shell=addPatch('open-front-mantle-shell',{},mint);
 const collar=addPatch('rounded-scalloped-cream-collar',{theta0:DELTA-.018,theta1:2*Math.PI-DELTA+.018,t0:.004,t1:theta=>.22+.024*Math.cos(theta*6),outerOffset:.024,thickness:.068,radial:5},cream);
 const shoulder=addPatch('short-layered-shoulder-cape',{t0:.17,t1:theta=>.48+.024*Math.cos(theta*6),outerOffset:.031,thickness:.068,radial:5},layerMint);
 const lower=addPatch('cream-lined-lower-hem',{t0:.905,t1:1,outerOffset:.011,thickness:.056,radial:3},lining);
 const hemGold=addPatch('gold-lower-hem-binding',{t0:.980,t1:1.018,outerOffset:.035,thickness:.090,radial:3},gold);
 const collarGold=addPatch('gold-scalloped-collar-binding',{t0:theta=>(.22+.024*Math.cos(theta*6))-.015,t1:theta=>(.22+.024*Math.cos(theta*6))+.010,outerOffset:.042,thickness:.096,radial:3},gold);
 const shoulderGold=addPatch('gold-shoulder-layer-binding',{t0:theta=>(.48+.024*Math.cos(theta*6))-.014,t1:theta=>(.48+.024*Math.cos(theta*6))+.012,outerOffset:.047,thickness:.099,radial:3},gold);
 function contact(part,target,seed,meaning){
  group.updateMatrixWorld(true);let selected=null;
  const offsets=[[0,0,0]];for(const distance of[.002,.005,.009,.014,.020])for(const dx of[-1,0,1])for(const dy of[-1,0,1])for(const dz of[-1,0,1])if(dx||dy||dz)offsets.push(new T.Vector3(dx,dy,dz).normalize().multiplyScalar(distance).toArray());
  for(const offset of offsets){const point=seed.clone().add(new T.Vector3(...offset)),a=strictContainment(T,part,point.toArray());if(!a.inside)continue;const b=strictContainment(T,target,point.toArray());if(b.inside){selected={point:point.toArray(),part:a,target:b};break;}}
  if(!selected)throw Error('cape_strict_attachment_missing:'+part.name+'->'+target.name);
  contacts.push({part:part.name,target:target.name,point:selected.point,meaning,strictValidation:{part:selected.part,target:selected.target,probeDirections:contactProbeDirections,finitePointOnly:true}});return selected.point;
 }
 const endpointBlend=t=>{const x=Math.max(0,Math.min(1,(t-.055)/.125));return x*x*(3-2*x);};
 const clothSeed=(theta,t,offset=-.012)=>pointAt(T,theta,t).addScaledVector(clothNormal(T,theta,t),offset);
 contact(collar.mesh,shell.mesh,clothSeed(Math.PI,.10),'Actual shared cloth material, not neck/body attachment');
 contact(shoulder.mesh,shell.mesh,clothSeed(Math.PI,.31),'Fixed short-layer overlap on mantle');
 contact(lower.mesh,shell.mesh,clothSeed(Math.PI,.95),'Hem lining overlaps actual mantle material');
 contact(hemGold.mesh,lower.mesh,clothSeed(Math.PI,.992,-.005),'Binding intersects hem lining');
 contact(collarGold.mesh,collar.mesh,clothSeed(Math.PI,.236,.010),'Scalloped collar binding is connected cloth-side material');
 contact(shoulderGold.mesh,shoulder.mesh,clothSeed(Math.PI,.495,.014),'Short-layer binding is connected cloth-side material');
 for(const sign of[-1,1]){
  const theta0=sign===1?DELTA-.014:2*Math.PI-DELTA-.036,theta1=theta0+.050;
  const binding=addPatch('gold-front-edge-'+sign,{theta0,theta1,t0:.012,t1:1.024,outerOffset:(_theta,t)=>.015+.047*endpointBlend(t),thickness:(_theta,t)=>.055+.072*endpointBlend(t),angular:3,radial:18},gold);
  contact(binding.mesh,shell.mesh,clothSeed((theta0+theta1)/2,.60,-.008),'Open front edge binding never spans the passage');
  const tail=addPatch('cream-bow-tail-'+sign,{theta0:sign===1?DELTA+.035:2*Math.PI-DELTA-.105,theta1:sign===1?DELTA+.105:2*Math.PI-DELTA-.035,t0:.065,t1:.34,outerOffset:.047,thickness:.075,angular:3,radial:7},cream);
  contact(tail.mesh,shell.mesh,clothSeed(sign===1?DELTA+.07:2*Math.PI-DELTA-.07,.22,-.010),'Fixed bow tail overlaps front cloth, no fastening mechanics');
 }
 const sphere=new T.SphereGeometry(1,20,12);geometries.add(sphere);
 const wings=[];
 for(const sign of[-1,1]){
  const theta=sign===1?DELTA+.15:2*Math.PI-DELTA-.15,center=clothSeed(theta,.10,.002);
  const wing=add('padded-bow-wing-'+sign,sphere,cream);wing.position.copy(center);wing.scale.set(.17,.070,.060);wing.rotation.z=sign*.20;
  contact(wing,collar.mesh,center.clone().addScaledVector(clothNormal(T,theta,.10),-.012),'Padded bow wing intersects rounded collar');
  wings.push(wing);
 }
 const center=wings[0].position.clone().add(wings[1].position).multiplyScalar(.5),knot=add('rounded-bow-knot',sphere,cream);knot.position.copy(center);knot.scale.set(.078,.090,.065);
 for(const wing of wings)contact(knot,wing,center.clone().lerp(wing.position,.28),'The central knot and each bow wing share strict material');
 for(const sign of[-1,1])for(const leafIndex of[0,1]){
  const theta=sign===1?.72:.0+(2*Math.PI-.72),t=.72+leafIndex*.075,n=clothNormal(T,theta,t),leaf=add('front-leaf-relief-'+sign+'-'+leafIndex,sphere,leafMat);
  leaf.position.copy(clothSeed(theta,t,-.012));leaf.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),n);leaf.rotateZ(sign*(leafIndex?.55:-.55));leaf.scale.set(.060,.115,.026);
  contact(leaf,shell.mesh,leaf.position,'Relief grows from actual front cloth surface, not a body anchor');
 }
 group.updateMatrixWorld(true);
 // Exact target rim triangles are buried strictly inside the enclosing binding,
 // rather than left as coplanar exposed faces. These are finite centroids only.
 const bindingCoverageWitnesses=[];
 function buryRim(bindingName,targetName,rim){
  const data=patches[targetName],target=parts.find(p=>p.name===targetName),binding=parts.find(p=>p.name===bindingName),a=data.domain.angular,r=data.domain.radial;
  const ranges={neck:[0,a],end_front:[a,a+r],hem:[a+r,2*a+r],start_front:[2*a+r,2*a+2*r]},range=ranges[rim],g=data.geometry,p=g.attributes.position,idx=g.index;
  for(let edge=range[0];edge<range[1];edge++)for(let tri=0;tri<2;tri++){
   const face=data.outerFaceCount*2+edge*2+tri,point=new T.Vector3();
   for(let k=0;k<3;k++)point.add(new T.Vector3().fromBufferAttribute(p,idx.getX(face*3+k)).applyMatrix4(target.matrixWorld).multiplyScalar(1/3));
   const burial=strictContainment(T,binding,point.toArray());
   if(!burial.inside)throw Error('cape_binding_rim_not_buried:'+bindingName+'->'+targetName+':'+rim+':'+face);
   bindingCoverageWitnesses.push({binding:bindingName,target:targetName,targetRim:rim,targetFace:face,point:point.toArray(),bindingStrictContainment:burial,scope:'finite exact target-rim triangle centroid inside binding, not a continuous enclosure proof'});
  }
 }
 buryRim('gold-scalloped-collar-binding','rounded-scalloped-cream-collar','hem');
 buryRim('gold-shoulder-layer-binding','short-layered-shoulder-cape','hem');
 for(const target of['open-front-mantle-shell','cream-lined-lower-hem'])buryRim('gold-lower-hem-binding',target,'hem');
 for(const target of['open-front-mantle-shell','short-layered-shoulder-cape','cream-lined-lower-hem','gold-scalloped-collar-binding','gold-shoulder-layer-binding','gold-lower-hem-binding']){
  buryRim('gold-front-edge-1',target,'start_front');buryRim('gold-front-edge--1',target,'end_front');
 }
 for(const target of['gold-front-edge-1','gold-front-edge--1'])buryRim('rounded-scalloped-cream-collar',target,'neck');
 const capVertices=new Map(),frontCapLapVertices=[];
 for(const w of bindingCoverageWitnesses.filter(w=>w.targetRim==='neck'&&w.target.startsWith('gold-front-edge-'))){
  const target=parts.find(p=>p.name===w.target),g=target.geometry;
  for(let k=0;k<3;k++){const point=new T.Vector3().fromBufferAttribute(g.attributes.position,g.index.getX(w.targetFace*3+k)).applyMatrix4(target.matrixWorld).toArray();capVertices.set(w.target+'|'+point.join(','),{target:w.target,point});}
 }
 for(const v of capVertices.values()){const check=strictContainment(T,collar.mesh,v.point);if(!check.inside)throw Error('cape_front_cap_not_under_collar');frontCapLapVertices.push({...v,coveringPart:collar.mesh.name,strictContainment:check});}
 const rimRequests={neck_edge:[Math.PI,.004],left_front_edge:[2*Math.PI-DELTA-.005,.5],right_front_edge:[DELTA+.005,.5],lower_hem:[Math.PI,.995]};
 const garmentRims=Object.fromEntries(Object.entries(rimRequests).map(([name,[theta,t]])=>{const actual=nearestOuter(T,shell.data,pointAt(T,theta,t));return[name,{name,actualSurfacePosition:actual.point.toArray(),actualSurfaceNormal:actual.normal.toArray(),actualFace:actual.face,scope:'finite garment-side triangle sample beside an opening; no body anchor'}];}));
 const definitions=[
  {name:'neck-center-to-interior',kind:'neck',from:[0,1.95,0],to:[0,.20,0]},
  {name:'neck-left-clearance',kind:'neck',from:[-.10,1.95,0],to:[-.10,.20,0]},
  {name:'neck-right-clearance',kind:'neck',from:[.10,1.95,0],to:[.10,.20,0]},
  {name:'neck-rear-clearance',kind:'neck',from:[0,1.95,-.10],to:[0,.20,-.10]},
  ...[.35,.65,.95].map(y=>({name:'front-to-cavity-'+y,kind:'front',from:[0,y,1.5],to:[0,y,0]})),
  {name:'bottom-interior',kind:'hem',from:[0,-.1,0],to:[0,.25,0]}
 ];
 const passages=definitions.map(d=>({...d,hits:parts.flatMap(mesh=>{const inv=mesh.matrixWorld.clone().invert(),a=new T.Vector3(...d.from).applyMatrix4(inv),b=new T.Vector3(...d.to).applyMatrix4(inv);return segmentHits(T,mesh.geometry,a.toArray(),b.toArray()).map(h=>({...h,part:mesh.name}));})}));
 if(passages.some(p=>p.hits.length))throw Error('cape_authored_passage_blocked');
 const measuredBounds=new T.Box3().setFromObject(group),bounds={min:measuredBounds.min.toArray(),max:measuredBounds.max.toArray()},budget={parts:parts.length,geometries:geometries.size,materials:materials.length,textures:0,triangles:parts.reduce((n,m)=>n+m.geometry.index.count/3,0)};
 const inspect=()=>{if(disposed)throw Error('cape_disposed');return{spec,topology:inspectTopology(T,shell.mesh.geometry),parts:parts.map(m=>({name:m.name,topology:inspectTopology(T,m.geometry),faceNormals:inspectFaceNormalAgreement(T,m.geometry)})),bounds:{min:bounds.min.slice(),max:bounds.max.slice()},budget,normalConstruction:shell.data.normalConstruction,openings:{neck:true,front:true,lowerHem:true,frontBowFixed:true},passages:{count:passages.length,blocked:passages.filter(p=>p.hits.length).length,segments:passages},contactWitnesses:contacts,bindingCoverage:{count:bindingCoverageWitnesses.length,minimumSurfaceClearance:Math.min(...bindingCoverageWitnesses.map(w=>w.bindingStrictContainment.minimumSurfaceClearance)),failed:0,frontTopCapVertices:frontCapLapVertices.length,frontTopCapMaximumY:Math.max(...frontCapLapVertices.map(v=>v.point[1])),scope:'finite actual target-rim centroids and all front top-cap vertices inside covering gold or cream lap; full witness data in certificate'},bodyBinding:null,authoredGarmentDepthNotBodyDepth:true,wearing:false,rig:false,clothPhysics:false,normalGamePlacement:false,ownershipUnlockSave:false,finiteScope:'Finite fixed-pose passages and strict material witnesses only; no load/friction, continuous safety, body fitting or original backside recovery.'};};
 return{group,shell:shell.mesh,parts,resources:{geometries,materials,textures:[]},garmentRims,passages,contactWitnesses:contacts,bindingCoverageWitnesses,frontCapLapVertices,bounds,budget,construction:{pattern:'New C-sector mantle with open front, real neck space, outward closed cloth solids and authored layering',angularSegments:ANGULAR,radialSegments:RADIAL,thickness:THICKNESS,frontGapHalfAngleRadians:DELTA,bodyBinding:null},inspect,resolveRim(name){if(disposed)throw Error('cape_disposed');if(!Object.hasOwn(garmentRims,name))throw Error('cape_unknown_rim');return garmentRims[name];},dispose(){if(disposed)return false;disposed=true;for(const g of geometries)g.dispose();for(const m of materials)m.dispose();group.clear();return true;}};
}

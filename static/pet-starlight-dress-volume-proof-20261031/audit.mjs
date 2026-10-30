/* Finite probes of rendered dress triangles. Authored garment dimensions are not anatomy. */
import {inspectTopology,inspectCrossings,inspectFaceNormalAgreement} from '../pet-breeze-cape-proof-20261029/geometry-audit.mjs';
import {independentPointAudit,independentSegmentAudit} from '../pet-breeze-cape-proof-20261029/audit.mjs';
import {conditionedClothAudit} from '../pet-komorebi-overalls-volume-proof-20261030/audit.mjs';

export function dressChartAudit(T,chart){
 const measured=conditionedClothAudit(T,chart);
 return{...measured,pass:measured.triangles>0&&measured.adjacentPairs>0&&measured.minimumPlanarTriangleQuality>.20&&measured.maximumAdjacentFaceDihedralDegrees<25,criterion:{minimumPlanarQuality:.20,maximumAdjacentDihedralDegrees:25},scope:'Actual finite front/back graph triangles, excluding connecting side charts. Puff sleeves and rounded skirt graphs may have steep normals: normal-z is diagnostic, not a flat-front requirement. The finite triangle-quality and adjacent-fold criteria do not establish global smoothness or cloth physics.'};
}

export function triangleBufferValidity(geometry){
 const p=geometry?.attributes?.position,n=geometry?.attributes?.normal,index=geometry?.index;
 const positionItemSize3=p?.itemSize===3,allPositionValuesFinite=Boolean(p?.array)&&Array.from(p.array).every(Number.isFinite),normalBufferValid=n?.itemSize===3&&n.count===p?.count&&Array.from(n.array).every(Number.isFinite),indexCountMultipleOfThree=Boolean(index)&&index.itemSize===1&&index.count>=3&&index.count%3===0,allIndicesIntegerAndInRange=Boolean(index)&&Array.from(index.array).every(i=>Number.isInteger(i)&&i>=0&&i<p?.count);
 return{positionItemSize3,allPositionValuesFinite,normalBufferValid,indexCountMultipleOfThree,allIndicesIntegerAndInRange,positionCount:p?.count??null,indexCount:index?.count??null,pass:positionItemSize3&&allPositionValuesFinite&&normalBufferValid&&indexCountMultipleOfThree&&allIndicesIntegerAndInRange,scope:'All stored position values, including unused vertices, and every stored index are checked before triangle topology or ray probes.'};
}

export function weldedComplex(geometry){
 const p=geometry.attributes.position,index=geometry.index,keys=new Map(),ids=[];
 for(let j=0;j<p.count;j++){
  const key=[p.getX(j),p.getY(j),p.getZ(j)].map(v=>Math.round(v*1e6)).join(',');
  if(!keys.has(key))keys.set(key,keys.size);ids.push(keys.get(key));
 }
 const edges=new Set(),neighbors=Array.from({length:keys.size},()=>new Set());
 for(let j=0;j<index.count;j+=3)for(let k=0;k<3;k++){
  const a=ids[index.getX(j+k)],b=ids[index.getX(j+(k+1)%3)];
  edges.add(a<b?a+':'+b:b+':'+a);neighbors[a].add(b);neighbors[b].add(a);
 }
 let components=0;const seen=new Set();
 for(let start=0;start<neighbors.length;start++)if(!seen.has(start)){
  components++;const queue=[start];seen.add(start);
  for(const a of queue)for(const b of neighbors[a])if(!seen.has(b)){seen.add(b);queue.push(b);}
 }
 return{weldTolerance:1e-6,weldedVertices:keys.size,edges:edges.size,faces:index.count/3,components,eulerCharacteristic:keys.size-edges.size+index.count/3,scope:'Finite indexed triangle complex after position welding; does not establish a continuous deformation or wearing gate.'};
}

export function tubeProfile(T,mesh){
 const tube=mesh.userData.tube;if(!tube?.sections?.length)throw Error('dress_tube_sections_missing');
 const p=mesh.geometry.attributes.position,centers=tube.sections.map(s=>new T.Vector3(...s.center)),radii=[];
 for(const section of tube.sections)for(const id of section.vertices){
  if(!Number.isInteger(id)||id<0||id>=p.count)throw Error('dress_tube_vertex_invalid');
  radii.push(new T.Vector3().fromBufferAttribute(p,id).distanceTo(new T.Vector3(...section.center)));
 }
 let maximumAdjacentCenterlineTurnDegrees=0;
 for(let j=1;j<centers.length-1;j++){
  const a=centers[j].clone().sub(centers[j-1]),b=centers[j+1].clone().sub(centers[j]);
  if(!(a.length()>0&&b.length()>0))throw Error('dress_tube_degenerate_centerline');
  maximumAdjacentCenterlineTurnDegrees=Math.max(maximumAdjacentCenterlineTurnDegrees,a.angleTo(b)*180/Math.PI);
 }
 const minimumActualSectionRadius=Math.min(...radii),maximumActualSectionRadius=Math.max(...radii);
 return{name:mesh.name,closed:tube.closed===true,sections:centers.length,radialSegments:tube.radialSegments,minimumActualSectionRadius,maximumActualSectionRadius,radiusRange:maximumActualSectionRadius-minimumActualSectionRadius,maximumAdjacentCenterlineTurnDegrees,endpointCenterGap:centers[0].distanceTo(centers.at(-1)),scope:'Actual finite cross-section vertices around authored centers and adjacent centerline turns. No continuous radius or cloth-physics proof.'};
}

function vertexBuckets(T,mesh){const buckets=new Map(),p=mesh.geometry.attributes.position;for(let j=0;j<p.count;j++){const v=new T.Vector3().fromBufferAttribute(p,j).applyMatrix4(mesh.matrixWorld),key=v.toArray().map(x=>Math.round(x*1e6)).join(',');if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(v);}return buckets;}
function actualPointMembership(T,buckets,point){const q=new T.Vector3(...point),key=point.map(x=>Math.round(x*1e6));let nearest=Infinity;for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const v of buckets.get([key[0]+x,key[1]+y,key[2]+z].join(','))||[])nearest=Math.min(nearest,v.distanceTo(q));return nearest;}

export function attachmentAudit(T,model){
 const byName=new Map(model.parts.map(m=>[m.name,m]));
 const contacts=model.contactWitnesses.map(c=>{
  const part=byName.get(c.part),target=byName.get(c.target);
  if(!part||!target)throw Error('dress_contact_part_missing');
  return{part:c.part,target:c.target,point:c.point,partAudit:independentPointAudit(T,part,c.point),targetAudit:independentPointAudit(T,target,c.point)};
 });
 const connected=new Set([model.shell.name]);
 for(let iteration=0;iteration<model.parts.length;iteration++)for(const c of contacts)
  if(c.partAudit.strictInside&&c.targetAudit.strictInside&&(connected.has(c.part)||connected.has(c.target))){connected.add(c.part);connected.add(c.target);}
 return{count:contacts.length,failed:contacts.filter(c=>!c.partAudit.strictInside||!c.targetAudit.strictInside).length,minimumClearance:Math.min(...contacts.flatMap(c=>[c.partAudit.minimumSurfaceClearance,c.targetAudit.minimumSurfaceClearance])),connectedPartCount:connected.size,totalPartCount:model.parts.length,contacts,scope:'Each authored witness is independently checked against actual world triangles with three parity directions and positive surface clearance. These finite shared solids do not establish strength or continuous cloth attachment.'};
}

export function planeTriangleWallHits(T,mesh,from,to){
 mesh.updateMatrixWorld(true);const origin=new T.Vector3(...from),direction=new T.Vector3(...to).sub(origin),length=direction.length();if(!(length>0))throw Error('dress_invalid_layer_ray');direction.divideScalar(length);
 const p=mesh.geometry.attributes.position,index=mesh.geometry.index,hits=[],barycentricTolerance=1e-10;
 for(let j=0;j<index.count;j+=3){
  const v=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(p,index.getX(j+k)).applyMatrix4(mesh.matrixWorld)),normal=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).normalize(),normalDotOutward=normal.dot(direction);
  if(Math.abs(normalDotOutward)<1e-12)continue;
  const distance=normal.dot(v[0].clone().sub(origin))/normalDotOutward;if(distance<=1e-6||distance>=length-1e-6)continue;
  const point=origin.clone().addScaledVector(direction,distance),barycentric=T.Triangle.getBarycoord(point,...v,new T.Vector3()),minimumBarycentric=Math.min(barycentric.x,barycentric.y,barycentric.z);
  if(minimumBarycentric < -barycentricTolerance || Math.max(barycentric.x,barycentric.y,barycentric.z)>1+barycentricTolerance)continue;
  hits.push({distance,face:j/3,normalDotOutward,barycentric:barycentric.toArray(),minimumBarycentric,planeResidual:Math.abs(normal.dot(point.clone().sub(v[0])))});
 }
 hits.sort((a,b)=>a.distance-b.distance);
 return hits.filter((h,k)=>!k||h.distance-hits[k-1].distance>1e-5);
}

export function layerSeparationAudit(T,model,{heights=[.60,.85,1.05,1.22],angles=[0,45,90,135,180,225,270,315]}={}){
 const profiles=[];
 const strictWall=(mesh,from,to,direction)=>{
  const hits=independentSegmentAudit(T,[mesh],from,to).sort((a,b)=>a.distance-b.distance),unique=hits.filter((h,k)=>!k||h.distance-hits[k-1].distance>1e-5),p=mesh.geometry.attributes.position,index=mesh.geometry.index;
  return unique.map(hit=>{const v=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(p,index.getX(hit.face*3+k)).applyMatrix4(mesh.matrixWorld)),normal=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).normalize();return{distance:hit.distance,face:hit.face,normalDotOutward:normal.dot(direction)};});
 };
 model.group?.updateMatrixWorld(true);model.shell.updateMatrixWorld(true);model.underskirt.updateMatrixWorld(true);
 for(const y of heights)for(const angleDegrees of angles){
  const a=angleDegrees*Math.PI/180,direction=new T.Vector3(Math.cos(a),0,Math.sin(a)),from=[0,y,0],to=direction.clone().multiplyScalar(4).add(new T.Vector3(...from)).toArray(),main=planeTriangleWallHits(T,model.shell,from,to),under=planeTriangleWallHits(T,model.underskirt,from,to),signedClearance=main.length>=2&&under.length>=2?main[0].distance-under[1].distance:null,strictMain=strictWall(model.shell,from,to,direction),strictUnder=strictWall(model.underskirt,from,to,direction);
  const pass=main.length===2&&under.length===2&&main[0].normalDotOutward<0&&main[1].normalDotOutward>0&&under[0].normalDotOutward<0&&under[1].normalDotOutward>0&&signedClearance>.005;
  profiles.push({y,angleDegrees,from,to,mainMaterialWalls:main,underlayerMaterialWalls:under,strictTriangleRayObservation:{mainMaterialWalls:strictMain,underlayerMaterialWalls:strictUnder,wallCountAgrees:strictMain.length===main.length&&strictUnder.length===under.length,scored:false,scope:'Original strict edge hit/miss observations retained. A missing strict-reader wall is not reclassified as its success.'},signedClearance,pass});
 }
 return{count:profiles.length,failed:profiles.filter(p=>!p.pass).length,minimumSignedClearance:Math.min(...profiles.map(p=>p.signedClearance??-Infinity)),requiredFiniteClearance:.005,scoredIntersectionMethod:'Actual triangle-plane intersection at the same nominal coordinates; barycentric tolerance 1e-10, parallel-dot cutoff 1e-12, distance deduplication 1e-5.',strictReaderWallCountDisagreements:profiles.filter(p=>!p.strictTriangleRayObservation.wallCountAgrees).length,profiles,scope:'Finite horizontal radial cuts through actual main-cloth and underlayer triangles at four covered heights, front/back/sides/diagonals. Underlayer outer wall must precede main inner wall. Strict triangle-ray misses remain separate unscored reader observations; paired small probes, when recorded, are additional evidence and do not replace nominal rays. The intentionally visible lower cream hem and fixed waist overlap are excluded. No continuous global layer or cloth-contact guarantee.'};
}

export function openingSegments(){
 const definitions=[];
 for(const x of[-.17,-.05,.06,.17])for(const z of[-.075,.015,.075])definitions.push({kind:'neck',from:[x,2.92,z],to:[x,1.80,z]});
 for(const x of[-.40,-.12,.13,.40])for(const z of[-.11,.015,.11])definitions.push({kind:'hem',from:[x,-.20,z],to:[x,1.65,z]});
 for(const side of[-1,1])for(const z of[-.045,.005,.045])for(const dy of[-.028,0,.028])definitions.push({kind:side<0?'left_cuff_to_torso':'right_cuff_to_torso',from:[side*1.86,1.43+dy,z],to:[side*.33,2.06+dy,z]});
 return definitions;
}

export function finiteAudit(T,model){
 model.group.updateMatrixWorld(true);
 const buffers=model.parts.map(m=>({name:m.name,...triangleBufferValidity(m.geometry)}));
 if(buffers.some(b=>!b.pass))throw Error('dress_invalid_triangle_buffer');
 const topology=model.parts.map((m,k)=>({name:m.name,triangleBuffers:buffers[k],...inspectTopology(T,m.geometry),faceNormals:inspectFaceNormalAgreement(T,m.geometry),positiveFiniteTransform:m.matrixWorld.elements.every(Number.isFinite)&&m.matrixWorld.determinant()>0}));
 const unique=new Map(model.parts.map(m=>[m.geometry,m])),crossings=[...unique.values()].map(m=>({name:m.name,...inspectCrossings(T,m.geometry)}));
 const passages=openingSegments().map(d=>({...d,hits:independentSegmentAudit(T,model.parts,d.from,d.to)}));
 const declaredPassages=model.passages.map(({kind,from,to})=>({kind,from,to,hits:independentSegmentAudit(T,model.parts,from,to)}));
 const attachments=attachmentAudit(T,model),shellWeldedTopology=weldedComplex(model.shell.geometry);
 const layerSeparation=layerSeparationAudit(T,model);
 const definitions=[
  {name:'left-front-torso',part:model.shell.name,from:[-.4,1.85,1.4],to:[-.4,1.85,0]},
  {name:'right-front-skirt',part:model.shell.name,from:[.50,.9,1.5],to:[.50,.9,0]},
  {name:'rear-torso',part:model.shell.name,from:[.2,1.85,-1.4],to:[.2,1.85,0]},
  {name:'rear-skirt',part:model.shell.name,from:[-.40,.9,-1.5],to:[-.40,.9,0]},
  ...[-1,1].map(side=>({name:side<0?'left-sleeve-wall':'right-sleeve-wall',part:model.shell.name,from:[side*1.28,2.05,1.4],to:[side*1.28,2.05,0]})),
  ...[-1,1].map(side=>({name:side<0?'left-side-skirt-wall':'right-side-skirt-wall',part:model.shell.name,from:[side*2.3,.65,0],to:[side*.4,.65,0]})),
  {name:'hollow-underskirt-wall',part:model.underskirt.name,from:[.3,.25,1.5],to:[.3,.25,0]}
 ];
 const materialControls=definitions.map(d=>{const hits=independentSegmentAudit(T,[model.parts.find(m=>m.name===d.part)],d.from,d.to),distances=hits.map(h=>h.distance).sort((a,b)=>a-b),unique=distances.filter((d,k)=>!k||d-distances[k-1]>1e-5);return{...d,hits,uniqueWallDistances:unique,firstWallThicknessAlongRay:unique.length>=2?unique[1]-unique[0]:null};});
 const byName=new Map(model.parts.map(m=>[m.name,m])),buckets=new Map(),pairs=model.thicknessSamples.map(sample=>{
  const name=sample.part||model.shell.name,part=byName.get(name);if(!part)throw Error('dress_thickness_part_missing');
  if(!buckets.has(name))buckets.set(name,vertexBuckets(T,part));
  return{part:name,distance:new T.Vector3(...sample.outer).distanceTo(new T.Vector3(...sample.inner)),outerVertexDistance:actualPointMembership(T,buckets.get(name),sample.outer),innerVertexDistance:actualPointMembership(T,buckets.get(name),sample.inner)};
 });
 const nonVertexEndpoints=pairs.reduce((n,p)=>n+Number(!(p.outerVertexDistance<1e-6))+Number(!(p.innerVertexDistance<1e-6)),0);
 const bindingProfiles=model.parts.filter(m=>m.userData.tube?.closed).map(m=>tubeProfile(T,m));
 const conditionedCloth={outer:dressChartAudit(T,model.chartGeometry),lining:dressChartAudit(T,model.chartGeometry.lining)};
 const tests={
  triangleBuffersValid:buffers.every(b=>b.pass),
  closedPositiveSolids:topology.length>0&&topology.every(p=>p.closedEdges&&!p.badEdges&&!p.degenerateTriangles&&!p.invalidNormals&&p.signedVolume>0&&!p.faceNormals.nonpositiveFaces&&p.positiveFiniteTransform),
  noStrictEdgeInteriorCrossing:crossings.length>0&&crossings.every(p=>p.strictEdgeInteriorCrossings===0),
  connectedFourBoundaryShell:shellWeldedTopology.components===1&&shellWeldedTopology.eulerCharacteristic===-4,
  finiteOpeningsClear:passages.length===42&&passages.every(p=>p.hits.length===0),
  declaredOpeningClaimsRechecked:declaredPassages.length>0&&declaredPassages.every(p=>p.hits.length===0),
  allPartsJoined:attachments.count>=model.parts.length-1&&attachments.failed===0&&attachments.connectedPartCount===model.parts.length,
  occupiedWalls:materialControls.every(c=>c.firstWallThicknessAlongRay>.005&&c.firstWallThicknessAlongRay<.12),
  actualThicknessVertexPairs:pairs.length>100&&nonVertexEndpoints===0&&pairs.every(p=>Number.isFinite(p.distance)&&p.distance>.005),
  closedConstantRoundedTrim:bindingProfiles.length>=4&&bindingProfiles.every(p=>p.closed&&p.radiusRange<1e-6&&p.endpointCenterGap<1e-6&&p.maximumAdjacentCenterlineTurnDegrees<25),
  conditionedGraphSurfaces:Object.values(conditionedCloth).every(c=>c.pass),
  finiteCoveredLayerSeparation:layerSeparation.count===32&&layerSeparation.failed===0
 };
 return{schema_version:1,result:Object.values(tests).every(Boolean)?'pass':'fail',criteria:tests,scope:'Fixed authored dress material only. Finite topology, nonadjacent strict edge/interior crossings, literal all-visible-part neck/cuff/hem routes, actual occupied wall rays and sampled fixed seams. No continuous whole-domain safety, measured anatomy, recovered source back, wearing, cloth/load/contact physics or all-growth fit.',topology,crossings,shellWeldedTopology,conditionedCloth,bindingProfiles,layerSeparation,independentPassages:{count:passages.length,blocked:passages.filter(p=>p.hits.length).length,segments:passages},modelDeclaredPassagesRechecked:{count:declaredPassages.length,blocked:declaredPassages.filter(p=>p.hits.length).length,segments:declaredPassages,scope:'Producer-authored route definitions re-intersected with actual world triangles; additional finite cases, not additional distinct tests.'},independentAttachments:attachments,materialControls,liningPairDistances:{count:pairs.length,minimum:Math.min(...pairs.map(p=>p.distance)),maximum:Math.max(...pairs.map(p=>p.distance)),nonVertexEndpoints,maximumVertexEndpointDistance:Math.max(...pairs.flatMap(p=>[p.outerVertexDistance,p.innerVertexDistance])),scope:'Only the listed outer/inner pairs are checked against actual vertices; no global minimum material thickness.'},connectedPartCount:attachments.connectedPartCount,totalPartCount:model.parts.length,bodyBinding:null,wearingFit:false,rig:false,clothPhysics:false,normalGame:false,ownershipUnlockSave:false,sourceCutoutQualityNewlyApproved:false};
}
export const audit=finiteAudit;

import {inspectTopology,inspectFaceNormalAgreement,inspectCrossings} from '../pet-breeze-cape-proof-20261029/geometry-audit.mjs';
import {independentPointAudit,independentSegmentAudit} from '../pet-breeze-cape-proof-20261029/audit.mjs';

export function inspectBuffers(g){
 const p=g?.attributes?.position,n=g?.attributes?.normal,ix=g?.index,errors=[];
 if(!p||p.itemSize!==3||!Number.isInteger(p.count)||p.count<4||p.array.length!==p.count*3||!Array.from(p.array).every(Number.isFinite))errors.push('position');
 if(!n||n.itemSize!==3||n.count!==p?.count||!Array.from(n.array).every(Number.isFinite))errors.push('normal');
 for(const[name,a]of Object.entries(g?.attributes||{}))if(!Number.isInteger(a.count)||a.count!==p?.count||a.array.length!==a.count*a.itemSize||!Array.from(a.array).every(Number.isFinite)){if(!errors.includes(name))errors.push(name);}
 if(!ix||ix.itemSize!==1||!Number.isInteger(ix.count)||ix.count%3||!Array.from(ix.array).every(v=>Number.isInteger(v)&&v>=0&&v<p?.count))errors.push('index');
 return{valid:errors.length===0,errors,positionCount:p?.count??null,indexCount:ix?.count??null};
}
const uniqueDistances=rows=>rows.map(q=>q.distance).sort((a,b)=>a-b).filter((x,i,a)=>!i||x-a[i-1]>1e-6);
function key(g){
 const p=g.attributes.position,ix=g.index,hex=a=>Array.from(new Uint8Array(a.buffer,a.byteOffset,a.byteLength),v=>v.toString(16).padStart(2,'0')).join('');
 return JSON.stringify({positionType:p.array.constructor.name,positionItemSize:p.itemSize,positionCount:p.count,indexType:ix.array.constructor.name,indexItemSize:ix.itemSize,indexCount:ix.count})+hex(p.array)+hex(ix.array);
}
export function geometryIdentity(item){
 const groups=new Map();for(const p of item.parts){const k=key(p.geometry);if(!groups.has(k))groups.set(k,{group:groups.size,parts:[]});groups.get(k).parts.push(p.name);}
 return{geometryObjects:new Set(item.parts.map(p=>p.geometry)).size,exactTypedContentGroups:groups.size,groups:[...groups.values()],method:'Full exact typed position/index layout and bytes; geometry objects, content and rendered parts are distinct counts'};
}

export function occupiedChord(T,part,row){
 const hits=independentSegmentAudit(T,[part],row.from,row.to),ds=uniqueDistances(hits),direction=new T.Vector3(...row.to).sub(new T.Vector3(...row.from)).normalize();
 const midpoint=ds.length===2?new T.Vector3(...row.from).addScaledVector(direction,(ds[0]+ds[1])/2).toArray():null,actualThickness=ds.length===2?ds[1]-ds[0]:null,inside=midpoint?independentPointAudit(T,part,midpoint).strictInside:false;
 return{...row,hits,uniqueDistances:ds,actualThickness,strictOccupiedMidpoint:inside,pass:ds.length===2&&inside&&actualThickness>=row.minimum&&actualThickness<=row.maximum};
}

export function channelAudit(T,item){
 const routes=item.passages.map(q=>({...q,hits:independentSegmentAudit(T,item.parts,q.from,q.to)}));
 const restrictions=item.restrictions.map(q=>{const hits=independentSegmentAudit(T,item.parts,q.from,q.to);return{...q,hits,pass:hits.length>0&&hits.every(h=>h.part===q.part)};});
 const sections=item.channelSections.flatMap(q=>q.xSamples.map(x=>{
  const from=[x,q.y,q.fromZ-.04],to=[x,q.y,q.toZ+.04],parts=[q.leftPart,q.rightPart].map(name=>item.parts.find(p=>p.name===name));
  const hits=independentSegmentAudit(T,parts,from,to),ds=uniqueDistances(hits),width=ds.length===2?ds[1]-ds[0]:null;
  return{channel:q.channel,x,from,to,hits,actualGapWidth:width,pass:ds.length===2&&width>=q.minimum&&width<=q.maximum};
 }));
 return{pass:routes.length>0&&routes.every(r=>r.hits.length===0)&&restrictions.length>0&&restrictions.every(r=>r.pass)&&sections.length>0&&sections.every(r=>r.pass),routes,restrictions,sections,scope:'Selected all-part empty-channel segments and measured actual wood-wall gaps. The two stone bearers deliberately block other downward segments; no claim of water transport or universal open drainage.'};
}

export function recessAudit(T,item){
 const rows=item.recessProfiles.map(q=>{
  const part=item.parts.find(p=>p.name===q.part),peg=item.parts.find(p=>p.name===q.peg),p=part.geometry.attributes.position,used=new Set(Array.from(part.geometry.index.array));
  const world=id=>new T.Vector3().fromBufferAttribute(p,id).applyMatrix4(part.matrixWorld),rim=q.rimVertexIndices.map(world),floor=q.floorVertexIndices.map(world),allIDs=[...q.rimVertexIndices,...q.floorVertexIndices];
  const distinctIDs=new Set(allIDs),rimXZ=new Set(rim.map(v=>v.x.toFixed(7)+':'+v.z.toFixed(7))),bins=new Set(rim.map(v=>Math.floor(((Math.atan2(v.z-q.centerXZ[1],v.x-q.centerXZ[0])+Math.PI*2)%(Math.PI*2))/(Math.PI/4))));
  const minR=Math.min(...rim.map(v=>Math.hypot(v.x-q.centerXZ[0],v.z-q.centerXZ[1]))),maxR=Math.max(...rim.map(v=>Math.hypot(v.x-q.centerXZ[0],v.z-q.centerXZ[1]))),topY=rim.reduce((s,v)=>s+v.y,0)/rim.length,floorY=floor.reduce((s,v)=>s+v.y,0)/floor.length;
  const pegVertices=Array.from({length:peg.geometry.attributes.position.count},(_,i)=>new T.Vector3().fromBufferAttribute(peg.geometry.attributes.position,i).applyMatrix4(peg.matrixWorld));
  const pegTop=Math.max(...pegVertices.map(v=>v.y)),pegBottom=Math.min(...pegVertices.map(v=>v.y)),pegRadius=Math.max(...pegVertices.map(v=>Math.hypot(v.x-q.centerXZ[0],v.z-q.centerXZ[1])));
  const from=[q.centerXZ[0],topY+.12,q.centerXZ[1]],to=[q.centerXZ[0],.15,q.centerXZ[1]],woodHits=independentSegmentAudit(T,[part],from,to),ds=uniqueDistances(woodHits),firstWoodY=ds.length?from[1]-ds[0]:null;
  const cavityPoint=[q.centerXZ[0],(topY+floorY)/2,q.centerXZ[1]],woodVoid=!independentPointAudit(T,part,cavityPoint).strictInside,pegOccupied=independentPointAudit(T,peg,cavityPoint).strictInside;
  const pass=rim.length>=24&&floor.length===rim.length&&distinctIDs.size===allIDs.length&&allIDs.every(id=>Number.isInteger(id)&&used.has(id))&&rimXZ.size===rim.length&&bins.size===8&&maxR-minR<2e-6&&Math.abs(minR-q.radius)<2e-6&&Math.abs(topY-q.topY)<1e-6&&Math.abs(floorY-q.floorY)<1e-6&&topY-floorY>.07&&pegTop<topY-.008&&pegBottom<floorY-.002&&pegRadius<minR-.008&&ds.length===2&&Math.abs(firstWoodY-floorY)<1e-6&&woodVoid&&pegOccupied;
  return{part:q.part,peg:q.peg,pass,actualDistinctRimXZ:rimXZ.size,actualAngularBins:bins.size,actualDistinctUsedIndices:distinctIDs.size,minimumRimRadius:minR,maximumRimRadius:maxR,actualRimY:topY,actualBlindFloorY:floorY,actualPegTopY:pegTop,actualPegBottomY:pegBottom,actualPegRadius:pegRadius,woodOnlyVerticalHits:woodHits,firstWoodY,woodVoidAtCupMidpoint:woodVoid,fixedPegOccupiesCupMidpoint:pegOccupied};
 });
 return{pass:rows.length>0&&rows.length===item.pegs.length&&rows.every(r=>r.pass),rows,scope:'True closed-material blind cups and fixed recessed pegs. Wood-only cup voids are intentionally occupied by those pegs; no working fastener or installation claim.'};
}

export function planarCapAudit(T,item){
 const rows=[...item.slats,...item.bearers].map(part=>{
  const g=part.geometry,p=g.attributes.position,n=g.attributes.normal,ix=g.index,ys=Array.from({length:p.count},(_,i)=>p.getY(i)),bottom=Math.min(...ys),top=Math.max(...ys),caps=[];
  for(const[y,direction]of[[bottom,-1],[top,1]]){
   const triangles=[],vertices=new Set();
   for(let k=0;k<ix.count;k+=3){const ids=[0,1,2].map(j=>ix.getX(k+j)),v=ids.map(i=>new T.Vector3().fromBufferAttribute(p,i)),face=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).normalize();
    if(v.every(v=>Math.abs(v.y-y)<1e-7)&&face.y*direction>.999999){const dots=ids.map(id=>{vertices.add(id);return new T.Vector3().fromBufferAttribute(n,id).normalize().dot(face);});triangles.push({face:k/3,minimumVertexNormalDot:Math.min(...dots)});}}
   const minimum=triangles.length?Math.min(...triangles.map(r=>r.minimumVertexNormalDot)):null;
   caps.push({planeY:y,direction,triangles:triangles.length,actualUsedVertices:vertices.size,minimumStoredNormalDot:minimum,pass:triangles.length>=16&&vertices.size>=24&&minimum>1-1e-6});
  }
  return{part:part.name,caps,pass:part.material.flatShading===false&&caps.every(c=>c.pass)};
 });
 return{pass:rows.length>0&&rows.every(r=>r.pass),rows,scope:'Every actual used top/bottom planar-cap vertex normal. Separate bevel shading seams avoid cap fan artefacts without flattening the entire material.'};
}

export function roundedProfileAudit(T,item){
 const rows=item.slabProfiles.map(q=>{
  const part=item.parts.find(p=>p.name===q.part),p=part.geometry.attributes.position,used=new Set(Array.from(part.geometry.index.array));
  const sections=q.sections.map(s=>{const points=s.vertices.map(i=>new T.Vector3().fromBufferAttribute(p,i)),xs=points.map(v=>v.x),zs=points.map(v=>v.z),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs),cornerGaps=[];
   for(const x of[minX,maxX])for(const z of[minZ,maxZ])cornerGaps.push(Math.min(...points.map(v=>Math.hypot(v.x-x,v.z-z))));
   return{y:s.y,indexedVertices:s.vertices.length,distinctIDs:new Set(s.vertices).size,actualYMinimum:Math.min(...points.map(v=>v.y)),actualYMaximum:Math.max(...points.map(v=>v.y)),width:maxX-minX,depth:maxZ-minZ,minimumCornerGap:Math.min(...cornerGaps),pass:s.vertices.length>=24&&new Set(s.vertices).size===s.vertices.length&&s.vertices.every(i=>Number.isInteger(i)&&used.has(i))&&points.every(v=>Math.abs(v.y-s.y)<1e-6)&&maxX-minX>.25&&maxZ-minZ>.25&&Math.min(...cornerGaps)>.015};
  });
  return{part:q.part,sections,pass:sections.length===4&&sections.every(s=>s.pass)&&sections.every((s,i)=>!i||s.y>sections[i-1].y)};
 });
 return{pass:rows.length>0&&rows.every(r=>r.pass),rows,scope:'Finite actual rounded-rectangle bevel rings; not a continuous curvature, slip or weather guarantee.'};
}

export function diagnosticFloorPairs(T,item){
 const floor=new T.Mesh(new T.PlaneGeometry(10,10),new T.MeshBasicMaterial({side:T.DoubleSide}));floor.rotation.x=-Math.PI/2;floor.updateMatrixWorld(true);const rows=[];
 for(const q of item.supportFaces){const part=item.parts.find(p=>p.name===q.part);
  for(const point of q.samples){const up=new T.Raycaster(new T.Vector3(point[0],-.25,point[2]),new T.Vector3(0,1,0),0,.5),sole=up.intersectObject(part,false)[0],down=new T.Raycaster(new T.Vector3(point[0],.5,point[2]),new T.Vector3(0,-1,0),0,1),land=down.intersectObject(floor,false)[0],normal=sole?.face.normal.clone().applyMatrix3(new T.Matrix3().getNormalMatrix(part.matrixWorld)).normalize();rows.push({part:q.part,sample:point,actualBearerBottomTriangle:sole?.faceIndex??null,diagnosticFloorTriangle:land?.faceIndex??null,actualBottomY:sole?.point.y??null,diagnosticFloorY:land?.point.y??null,normal:normal?.toArray()??null,pass:!!sole&&!!land&&normal.y<-.999999&&Math.abs(sole.point.y-land.point.y)<1e-6});}
 }
 floor.geometry.dispose();floor.material.dispose();
 const minimumStoredWorldY=Math.min(...item.parts.flatMap(part=>Array.from({length:part.geometry.attributes.position.count},(_,i)=>new T.Vector3().fromBufferAttribute(part.geometry.attributes.position,i).applyMatrix4(part.matrixWorld).y)));
 return{pass:item.bearers.length===2&&item.supportFaces.length===2&&rows.length===10&&new Set(item.supportFaces.map(r=>r.part)).size===2&&rows.every(r=>r.pass)&&minimumStoredWorldY>=-1e-6,bearers:2,rows,minimumStoredWorldY,scope:'Ten finite actual bearer-bottom/diagnostic-plane triangle pairs and authored lower half-space only; actual Scene placement, installed contact, load and stability remain separate.'};
}

export function finiteAudit(T,item){
 item.group.updateMatrixWorld(true);
 const topology=item.resources.geometries.map((g,k)=>({geometryObject:k,parts:item.parts.filter(p=>p.geometry===g).map(p=>p.name),buffers:inspectBuffers(g),...inspectTopology(T,g),normals:inspectFaceNormalAgreement(T,g)})),crossings=item.resources.geometries.map((g,k)=>({geometryObject:k,...inspectCrossings(T,g)}));
 const contacts=item.contactWitnesses.map(q=>({...q,partAudit:independentPointAudit(T,item.parts.find(p=>p.name===q.part),q.point),targetAudit:independentPointAudit(T,item.parts.find(p=>p.name===q.target),q.point)})),connected=new Set([item.base.name]);
 for(let k=0;k<item.parts.length;k++)for(const q of contacts)if(q.partAudit.strictInside&&q.targetAudit.strictInside&&(connected.has(q.part)||connected.has(q.target))){connected.add(q.part);connected.add(q.target);}
 const occupied=item.thicknessSamples.map(q=>occupiedChord(T,item.parts.find(p=>p.name===q.part),q));
 const pairs=item.thicknessPairs.map(q=>{const part=item.parts.find(p=>p.name===q.part),p=part.geometry.attributes.position,outer=new T.Vector3().fromBufferAttribute(p,q.outerVertexIndex).applyMatrix4(part.matrixWorld),inner=new T.Vector3().fromBufferAttribute(p,q.innerVertexIndex).applyMatrix4(part.matrixWorld),mid=outer.clone().add(inner).multiplyScalar(.5),distance=outer.distanceTo(inner);return{...q,actualDistance:distance,actualOccupiedMidpoint:independentPointAudit(T,part,mid.toArray()).strictInside,pass:outer.distanceTo(new T.Vector3(...q.outer))<1e-7&&inner.distanceTo(new T.Vector3(...q.inner))<1e-7&&Math.abs(distance-q.distance)<1e-7&&distance>.21&&independentPointAudit(T,part,mid.toArray()).strictInside};});
 const channels=channelAudit(T,item),recesses=recessAudit(T,item),caps=planarCapAudit(T,item),profiles=roundedProfileAudit(T,item),floor=diagnosticFloorPairs(T,item),identity=geometryIdentity(item),transformsFinitePositive=item.parts.every(p=>p.matrixWorld.elements.every(Number.isFinite)&&p.matrixWorld.determinant()>0);
 const pass=topology.every(q=>q.buffers.valid&&q.closedEdges&&!q.badEdges&&!q.degenerateTriangles&&!q.invalidNormals&&q.signedVolume>0&&!q.normals.nonpositiveFaces)&&crossings.every(q=>q.strictEdgeInteriorCrossings===0)&&transformsFinitePositive&&contacts.length>0&&contacts.every(q=>q.partAudit.strictInside&&q.targetAudit.strictInside)&&connected.size===item.parts.length&&occupied.every(q=>q.pass)&&pairs.every(q=>q.pass)&&channels.pass&&recesses.pass&&caps.pass&&profiles.pass&&floor.pass;
 return{schema_version:1,result:pass?'pass':'fail',pass,parts:item.parts.length,triangles:item.parts.reduce((n,p)=>n+p.geometry.index.count/3,0),actualStoredVertices:item.parts.reduce((n,p)=>n+p.geometry.attributes.position.count,0),geometryIdentity:identity,topology,crossings,transformsFinitePositive,contacts,connectedParts:connected.size,occupiedChords:occupied,actualStoredThicknessPairs:pairs,channels,recesses,planarCaps:caps,roundedProfiles:profiles,diagnosticFloor:floor,slats:item.slats.length,bearers:item.bearers.length,fixedPegs:item.pegs.length,bodyBinding:null,drainageWalkingLoadSlipInstallationPhysicsGameSaveVerified:false,scope:'One finite saved slatted panel assembly. Clear selected channels, intentionally blocked bearer segments, blind fixed peg recesses and diagnostic floor witnesses only. No hydrology, walking/navigation, installation, weather/load/slip, all-world/body or ordinary gameplay/ownership/save guarantee.'};
}

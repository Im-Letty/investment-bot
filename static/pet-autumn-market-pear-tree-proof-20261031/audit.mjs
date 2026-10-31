import {inspectTopology,inspectFaceNormalAgreement,inspectCrossings} from '../pet-breeze-cape-proof-20261029/geometry-audit.mjs';
import {independentPointAudit,independentSegmentAudit} from '../pet-breeze-cape-proof-20261029/audit.mjs';

export function inspectBuffers(g){
  const p=g?.attributes?.position,n=g?.attributes?.normal,i=g?.index,errors=[];
  if(!p||p.itemSize!==3||!Number.isInteger(p.count)||p.count<4||p.array.length!==p.count*3||!Array.from(p.array).every(Number.isFinite))errors.push('position');
  if(!n||n.itemSize!==3||n.count!==p?.count||n.array.length!==n.count*3||!Array.from(n.array).every(Number.isFinite))errors.push('normal');
  if(!i||i.itemSize!==1||!Number.isInteger(i.count)||i.count%3!==0||!Array.from(i.array).every(v=>Number.isInteger(v)&&v>=0&&v<p?.count))errors.push('index');
  return{valid:errors.length===0,errors,positionCount:p?.count??null,indexCount:i?.count??null};
}

function byteKey(g){
  const p=g.attributes.position,i=g.index,hex=a=>Array.from(new Uint8Array(a.buffer,a.byteOffset,a.byteLength),v=>v.toString(16).padStart(2,'0')).join('');
  return JSON.stringify({positionType:p.array.constructor.name,positionItemSize:p.itemSize,positionCount:p.count,indexType:i.array.constructor.name,indexItemSize:i.itemSize,indexCount:i.count})+':'+hex(p.array)+':'+hex(i.array);
}
export function geometryIdentity(item){
  const groups=new Map();
  for(const p of item.parts){const k=byteKey(p.geometry);if(!groups.has(k))groups.set(k,{group:groups.size,parts:[],positionBytes:p.geometry.attributes.position.array.byteLength,indexBytes:p.geometry.index.array.byteLength});groups.get(k).parts.push(p.name);}
  return{geometryObjects:new Set(item.parts.map(p=>p.geometry)).size,exactTypedContentGroups:groups.size,groups:[...groups.values()],method:'Groups compare full exact typed position/index layout and byte strings, not UUIDs, decimal JSON, transforms or mathematical congruence'};
}

export function pearProfileAudit(T,item){
  const rows=item.pears.map(part=>{
    const g=part.geometry,p=g.attributes.position,used=new Set(Array.from(g.index.array)),byY=new Map();
    for(const id of used){const y=p.getY(id),key=Math.round(y*1e7),r=Math.hypot(p.getX(id),p.getZ(id));if(!byY.has(key))byY.set(key,{y,radii:[],ids:[]});byY.get(key).radii.push(r);byY.get(key).ids.push(id);}
    const sections=[...byY.values()].sort((a,b)=>a.y-b.y).map(q=>({y:q.y,usedVertices:q.ids.length,minimumRadius:Math.min(...q.radii),maximumRadius:Math.max(...q.radii)}));
    const belly=sections.reduce((a,b)=>a.maximumRadius>b.maximumRadius?a:b),neck=sections.filter(q=>q.y>=.10&&q.y<=.145),height=sections.at(-1).y-sections[0].y;
    const neckMaximum=neck.length?Math.max(...neck.map(q=>q.maximumRadius)):Infinity;
    const pass=used.size===p.count&&sections.length>=20&&height>.319&&height<.321&&belly.y<-.01&&belly.maximumRadius>.11&&neck.length>=3&&neckMaximum<.065&&neckMaximum<belly.maximumRadius*.55;
    return{part:part.name,pass,actualUsedVertices:used.size,actualSections:sections.length,height,lowerBellyY:belly.y,bellyMaximumRadius:belly.maximumRadius,upperNeckMaximumRadius:neckMaximum,sections};
  });
  return{pass:rows.length===6&&rows.every(q=>q.pass),rows,scope:'Actual indexed six lower-bulb/upper-neck pear silhouettes; not fruit biology, ripeness, growth, picking or edibility'};
}

export function curvedSectionAudit(T,item){
  const rows=item.curvedProfiles.map(q=>{
    const part=item.parts.find(p=>p.name===q.part),g=part.geometry,p=g.attributes.position,used=new Set(Array.from(g.index.array)),seen=new Set(),sections=[];
    let valid=true;
    for(const s of q.sections){
      const c=new T.Vector3(...s.center),radii=[];
      for(const id of s.vertices){if(!Number.isInteger(id)||id<0||id>=p.count||!used.has(id)||seen.has(id)){valid=false;continue;}seen.add(id);radii.push(new T.Vector3().fromBufferAttribute(p,id).distanceTo(c));}
      const minimum=radii.length?Math.min(...radii):null,maximum=radii.length?Math.max(...radii):null;
      if(radii.length<8||minimum===null||minimum<=.015||maximum-minimum>1e-5||Math.abs(minimum-s.radius)>1e-5)valid=false;
      sections.push({center:s.center,vertices:radii.length,minimumRadius:minimum,maximumRadius:maximum});
    }
    const turns=[];
    for(let k=1;k<sections.length-1;k++)turns.push(new T.Vector3(...sections[k].center).sub(new T.Vector3(...sections[k-1].center)).angleTo(new T.Vector3(...sections[k+1].center).sub(new T.Vector3(...sections[k].center)))*180/Math.PI);
    const maximumTurn=Math.max(...turns);
    return{part:q.part,pass:valid&&sections.length>=20&&Number.isFinite(maximumTurn)&&maximumTurn<30,actualIndexedSections:sections.length,distinctSectionVertices:seen.size,maximumAdjacentTurnDegrees:maximumTurn,minimumSectionRadius:Math.min(...sections.map(s=>s.minimumRadius??0))};
  });
  return{pass:rows.length===13&&rows.every(q=>q.pass),rows,scope:'Finite saved wood cross-sections and adjacent centerline turns; no continuous-curvature or wind/load claim'};
}

export function gapAudit(T,item){
  const frame=[item.base,...item.trainingRibs,...item.backrails],rows=item.passages.map(q=>({from:q.from,to:q.to,frameHits:independentSegmentAudit(T,frame,q.from,q.to),allPartHits:independentSegmentAudit(T,item.parts,q.from,q.to)}));
  return{pass:rows.length===4&&rows.every(q=>q.frameHits.length===0&&q.allPartHits.length===0),rows,scope:'Four selected finite rays checked against both wood frame and all saved parts separately; leaves/pears elsewhere may intentionally occupy other fan cells'};
}

export function occupiedChord(T,part,row){
  const hits=independentSegmentAudit(T,[part],row.from,row.to),distances=hits.map(x=>x.distance).sort((a,b)=>a-b).filter((x,k,a)=>!k||x-a[k-1]>1e-6);
  const origin=new T.Vector3(...row.from),direction=new T.Vector3(...row.to).sub(origin).normalize(),midpoint=distances.length===2?origin.addScaledVector(direction,(distances[0]+distances[1])/2).toArray():null;
  const actualThickness=distances.length===2?distances[1]-distances[0]:null,inside=midpoint?independentPointAudit(T,part,midpoint).strictInside:false;
  return{...row,hits,uniqueDistances:distances,actualThickness,strictOccupiedMidpoint:inside,pass:distances.length===2&&inside&&actualThickness>=row.minimum&&actualThickness<=row.maximum};
}

export function rootCapAudit(T,item){
  const rows=item.rootPads.map(part=>{
    const g=part.geometry,p=g.attributes.position,n=g.attributes.normal,ix=g.index,bottom=Math.min(...Array.from({length:p.count},(_,i)=>p.getY(i))),triangles=[],vertices=new Set();
    for(let k=0;k<ix.count;k+=3){
      const ids=[0,1,2].map(j=>ix.getX(k+j)),v=ids.map(i=>new T.Vector3().fromBufferAttribute(p,i)),face=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).normalize();
      if(v.every(v=>Math.abs(v.y-bottom)<1e-7)&&face.y<-.999999){const dots=ids.map(id=>{vertices.add(id);return new T.Vector3().fromBufferAttribute(n,id).normalize().dot(face);});triangles.push({face:k/3,minimumVertexNormalDot:Math.min(...dots)});}
    }
    const minimum=triangles.length?Math.min(...triangles.map(q=>q.minimumVertexNormalDot)):null;
    return{part:part.name,actualBottomPlaneLocalY:bottom,actualFlatCapTriangles:triangles.length,actualUsedCapVertices:vertices.size,minimumCapVertexNormalDotFace:minimum,pass:triangles.length>=16&&vertices.size>=16&&minimum>1-1e-6&&part.material.flatShading===false};
  });
  return{pass:rows.length===3&&rows.every(q=>q.pass),rows,scope:'Every indexed vertex of each true flat bottom cap; bevel shading seams are separate, not flatShading material or a physical support guarantee'};
}

export function diagnosticFloorPairs(T,item){
  const floor=new T.Mesh(new T.PlaneGeometry(20,20),new T.MeshBasicMaterial({side:T.DoubleSide}));floor.rotation.x=-Math.PI/2;floor.updateMatrixWorld(true);
  const rows=[];
  for(const q of item.supportFaces){const part=item.parts.find(p=>p.name===q.part);
    for(const point of q.samples){const up=new T.Raycaster(new T.Vector3(point[0],-.25,point[2]),new T.Vector3(0,1,0),0,.50),sole=up.intersectObject(part,false)[0],down=new T.Raycaster(new T.Vector3(point[0],.50,point[2]),new T.Vector3(0,-1,0),0,1),land=down.intersectObject(floor,false)[0],normal=sole?.face.normal.clone().applyMatrix3(new T.Matrix3().getNormalMatrix(part.matrixWorld)).normalize();rows.push({part:q.part,sample:point,actualSoleTriangle:sole?.faceIndex??null,diagnosticFloorTriangle:land?.faceIndex??null,actualSoleY:sole?.point.y??null,diagnosticFloorY:land?.point.y??null,normal:normal?.toArray()??null,pass:!!sole&&!!land&&normal.y<-.999&&Math.abs(sole.point.y-land.point.y)<1e-6});}
  }
  floor.geometry.dispose();floor.material.dispose();
  return{pass:item.rootPads.length===3&&item.supportFaces.length===3&&rows.length===15&&rows.every(r=>r.pass),rootPads:3,rows,scope:'15 finite actual root-pad/diagnostic-plane triangle pairs. Current Scene placement is a separate finite probe; no full contact area or load/stability/physics proof.'};
}

export function finiteAudit(T,item){
  item.group.updateMatrixWorld(true);
  const topology=item.resources.geometries.map((g,k)=>({geometryObject:k,parts:item.parts.filter(p=>p.geometry===g).map(p=>p.name),buffers:inspectBuffers(g),...inspectTopology(T,g),normals:inspectFaceNormalAgreement(T,g)}));
  const crossings=item.resources.geometries.map((g,k)=>({geometryObject:k,...inspectCrossings(T,g)}));
  const contacts=item.contactWitnesses.map(q=>({...q,partAudit:independentPointAudit(T,item.parts.find(p=>p.name===q.part),q.point),targetAudit:independentPointAudit(T,item.parts.find(p=>p.name===q.target),q.point)}));
  const connected=new Set([item.base.name]);
  for(let k=0;k<item.parts.length;k++)for(const q of contacts)if(q.partAudit.strictInside&&q.targetAudit.strictInside&&(connected.has(q.part)||connected.has(q.target))){connected.add(q.part);connected.add(q.target);}
  const thickness=item.thicknessSamples.map(q=>occupiedChord(T,item.parts.find(p=>p.name===q.part),q)),pearProfiles=pearProfileAudit(T,item),curvedSections=curvedSectionAudit(T,item),gaps=gapAudit(T,item),rootCaps=rootCapAudit(T,item),floor=diagnosticFloorPairs(T,item),identity=geometryIdentity(item);
  const transformsFinitePositive=item.parts.every(p=>p.matrixWorld.elements.every(Number.isFinite)&&p.matrixWorld.determinant()>0);
  const pass=topology.every(q=>q.buffers.valid&&q.closedEdges&&q.badEdges===0&&q.degenerateTriangles===0&&q.invalidNormals===0&&q.signedVolume>0&&q.normals.nonpositiveFaces===0)&&crossings.every(q=>q.strictEdgeInteriorCrossings===0)&&transformsFinitePositive&&contacts.every(q=>q.partAudit.strictInside&&q.targetAudit.strictInside)&&connected.size===item.parts.length&&thickness.every(q=>q.pass)&&pearProfiles.pass&&curvedSections.pass&&gaps.pass&&rootCaps.pass&&floor.pass;
  return{pass,parts:item.parts.length,triangles:item.parts.reduce((n,p)=>n+p.geometry.index.count/3,0),actualStoredVertices:item.parts.reduce((n,p)=>n+p.geometry.attributes.position.count,0),geometryIdentity:identity,topology,crossings,transformsFinitePositive,contacts,connectedParts:connected.size,occupiedChords:thickness,pearProfiles,curvedSections,gaps,actualRootCapNormals:rootCaps,diagnosticFloor:floor,rootPads:item.rootPads.length,fixedPears:item.pears.length,paddedLeaves:item.leaves.length,trainingRibs:item.trainingRibs.length,backrails:item.backrails.length,bodyBinding:null,horticultureGrowthHarvestPhysicsRigGameSaveVerified:false,scope:'One finite saved low-fan tree assembly; actual triangles/material witnesses only. No all-world, all-angle/pixel, real horticulture or physical/ordinary gameplay guarantee.'};
}

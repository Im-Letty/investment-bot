/* One standalone authored garment shell; prototype dimensions never measure a body. */
export const spec=Object.freeze({id:'leaf-sleep-sack-garment-volume-v1',unit:'wardrobe:fit-prerequisite:leaf-sleep-sack:garment-volume-openings:v1',sourceSHA:'5f37214445824793c193eb9ddb4be15be3ff6e24a725f16416671016d41eaa88',thickness:.032,bodyBinding:null,bodyMeasurements:false,wearingFit:false,rig:false,clothPhysics:false,stretchCalibrated:false,normalGame:false,unlockSave:false,newRaw:false,newDesign:false,newVillageLibraryCandidate:false,frontSeam:'closed decorative overlap cue, not an operable fastening',backAndInterior:'Authored pouch depth, backside quilting and interior, not recovered original backside or body anatomy.'});
export function inspectTopology(T,g){
 const p=g.attributes.position,i=g.index,n=g.attributes.normal,edges=new Map();let volume=0,degenerate=0,invalidNormals=0;const keys=Array.from({length:p.count},(_,j)=>[p.getX(j),p.getY(j),p.getZ(j)].map(v=>Math.round(v*1e6)).join(','));
 for(let j=0;j<i.count;j+=3){const ids=[i.getX(j),i.getX(j+1),i.getX(j+2)],[a,b,c]=ids.map(k=>new T.Vector3().fromBufferAttribute(p,k));if(b.clone().sub(a).cross(c.clone().sub(a)).length()<1e-10)degenerate++;volume+=a.dot(b.clone().cross(c))/6;for(let k=0;k<3;k++){const a=keys[ids[k]],b=keys[ids[(k+1)%3]],key=a<b?a+'|'+b:b+'|'+a,r=edges.get(key)||{count:0,balance:0};r.count++;r.balance+=a<b?1:-1;edges.set(key,r);}}
 for(let j=0;j<n.count;j++){const v=new T.Vector3().fromBufferAttribute(n,j);if(!Number.isFinite(v.length())||Math.abs(v.length()-1)>.002)invalidNormals++;}
 const badEdges=[...edges.values()].filter(r=>r.count!==2||r.balance!==0).length;return{vertices:p.count,triangles:i.count/3,closedEdges:badEdges===0,badEdges,degenerateTriangles:degenerate,invalidNormals,signedVolume:volume};
}
export function segmentHits(T,g,from,to){
 const a=new T.Vector3(...from),d=new T.Vector3(...to).sub(a),length=d.length();if(!(length>0))throw Error('sleep_invalid_segment');const ray=new T.Ray(a,d.divideScalar(length)),p=g.attributes.position,i=g.index,out=new T.Vector3(),hits=[];
 for(let j=0;j<i.count;j+=3)if(ray.intersectTriangle(...[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(p,i.getX(j+k))),false,out)){const distance=out.distanceTo(a);if(distance>1e-6&&distance<length-1e-6)hits.push({face:j/3,distance,point:out.toArray()});}return hits;
}
export function containsPoint(T,mesh,point){
 const local=new T.Vector3(...point).applyMatrix4(mesh.matrixWorld.clone().invert()),far=local.clone().add(new T.Vector3(.731,.239,.641).normalize().multiplyScalar(30));const hits=segmentHits(T,mesh.geometry,local.toArray(),far.toArray()).map(h=>h.distance).sort((a,b)=>a-b),unique=hits.filter((d,i)=>i===0||d-hits[i-1]>1e-6);return unique.length%2===1;
}
export function inspectCrossings(T,g){
 const p=g.attributes.position,i=g.index,triangles=[];for(let j=0;j<i.count;j+=3){const ids=[i.getX(j),i.getX(j+1),i.getX(j+2)],v=ids.map(k=>new T.Vector3().fromBufferAttribute(p,k));triangles.push({ids,v,box:new T.Box3().setFromPoints(v)});}
 let candidateNonadjacentAABBPairs=0,strictEdgeInteriorCrossings=0;const witnesses=[];
 const crosses=(a,b,other)=>{const delta=b.clone().sub(a),length=delta.length(),ray=new T.Ray(a,delta.divideScalar(length)),hit=new T.Vector3();if(!ray.intersectTriangle(...other,false,hit))return false;const distance=hit.distanceTo(a);if(distance<=1e-7||distance>=length-1e-7)return false;const bary=T.Triangle.getBarycoord(hit,...other,new T.Vector3());return Math.min(bary.x,bary.y,bary.z)>1e-6;};
 for(let a=0;a<triangles.length;a++)for(let b=a+1;b<triangles.length;b++){const x=triangles[a],y=triangles[b];if(x.ids.some(k=>y.ids.includes(k))||!x.box.intersectsBox(y.box))continue;candidateNonadjacentAABBPairs++;let crossing=false;for(let k=0;k<3;k++)if(crosses(x.v[k],x.v[(k+1)%3],y.v)||crosses(y.v[k],y.v[(k+1)%3],x.v))crossing=true;if(crossing){strictEdgeInteriorCrossings++;if(witnesses.length<8)witnesses.push([a,b]);}}
 return{triangles:triangles.length,candidateNonadjacentAABBPairs,strictEdgeInteriorCrossings,witnesses,scope:'fixed-pose strict nonadjacent edge/interior crossings; coplanar/adjacent contacts excluded, no continuous or physical guarantee'};
}



export const STRICT_WITNESS_CLEARANCE=1e-5;
export const contactProbeDirections=Object.freeze([[.731,.239,.641],[-.371,.817,.439],[.553,-.389,.737]].map(v=>Object.freeze(v)));
const strictSurfaceCache=new WeakMap();
/* Three noncollinear world-space rays and actual world-triangle distance.
   This checks finite points only; it is not a continuous contact/load proof. */
export function strictContainment(T,mesh,point){
 if(!Array.isArray(point)||point.length!==3||!point.every(Number.isFinite))throw Error('sleep_invalid_strict_point');
 mesh.updateMatrixWorld(true);const g=mesh.geometry,key=mesh.matrixWorld.elements.join(',')+'|'+g.attributes.position.version+'|'+g.index.version;let data=strictSurfaceCache.get(mesh);
 if(!data||data.key!==key){const p=g.attributes.position,i=g.index,triangles=[];for(let j=0;j<i.count;j+=3)triangles.push(new T.Triangle(...[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(p,i.getX(j+k)).applyMatrix4(mesh.matrixWorld))));data={key,triangles};strictSurfaceCache.set(mesh,data);}
 const p=new T.Vector3(...point),closest=new T.Vector3();let minimumSquared=Infinity;
 for(const tri of data.triangles){tri.closestPointToPoint(p,closest);minimumSquared=Math.min(minimumSquared,closest.distanceToSquared(p));}
 const minimumSurfaceClearance=Math.sqrt(minimumSquared),uniqueRayHitCounts=[];
 if(minimumSurfaceClearance>STRICT_WITNESS_CLEARANCE)for(const vector of contactProbeDirections){const ray=new T.Ray(p,new T.Vector3(...vector).normalize()),hit=new T.Vector3(),distances=[];for(const tri of data.triangles)if(ray.intersectTriangle(tri.a,tri.b,tri.c,false,hit)){const d=hit.distanceTo(p);if(d>1e-7)distances.push(d);}distances.sort((a,b)=>a-b);const unique=distances.filter((d,i)=>i===0||d-distances[i-1]>1e-6);uniqueRayHitCounts.push(unique.length);}
 return{inside:minimumSurfaceClearance>STRICT_WITNESS_CLEARANCE&&uniqueRayHitCounts.length===3&&uniqueRayHitCounts.every(n=>n%2===1),minimumSurfaceClearance,requiredSurfaceClearance:STRICT_WITNESS_CLEARANCE,uniqueRayHitCounts,directionCount:3};
}


export function inspectFaceNormalAgreement(T,g){
 const p=g.attributes.position,n=g.attributes.normal,idx=g.index;let minimumDot=Infinity,nonpositiveFaces=0;
 for(let j=0;j<idx.count;j+=3){const ids=[0,1,2].map(k=>idx.getX(j+k)),v=ids.map(i=>new T.Vector3().fromBufferAttribute(p,i)),face=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).normalize(),normal=ids.reduce((a,i)=>a.add(new T.Vector3().fromBufferAttribute(n,i)),new T.Vector3()).normalize(),dot=face.dot(normal);minimumDot=Math.min(minimumDot,dot);if(!(dot>0))nonpositiveFaces++;}
 return{triangles:idx.count/3,minimumFaceAverageNormalDot:minimumDot,nonpositiveFaces,scope:'actual indexed oriented face normal vs normalized average of its stored vertex normals'};
}
/* Render-only normal creases; all actual triangle corners and winding remain exact. */
function creaseMaterialNormals(T,g,maxSharedFaceAngleDegrees=65){
 const p=g.attributes.position,oldIndices=Array.from(g.index.array),threshold=Math.cos(maxSharedFaceAngleDegrees*Math.PI/180),faces=[],incident=Array.from({length:p.count},()=>[]);
 for(let j=0;j<oldIndices.length;j+=3){const ids=oldIndices.slice(j,j+3),v=ids.map(i=>new T.Vector3().fromBufferAttribute(p,i)),raw=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])),material=g.groups.find(x=>j>=x.start&&j<x.start+x.count)?.materialIndex??0;const f={ids,raw,unit:raw.clone().normalize(),material};faces.push(f);for(const i of ids)incident[i].push(faces.length-1);}
 const positions=[],normals=[],indices=new Array(oldIndices.length),firstRenderVertex=[];
 for(let original=0;original<p.count;original++){const clusters=[];for(const fi of incident[original]){const f=faces[fi];let cluster=clusters.find(c=>c.material===f.material&&c.members.every(j=>faces[j].unit.dot(f.unit)>=threshold));if(!cluster){cluster={material:f.material,members:[]};clusters.push(cluster);}cluster.members.push(fi);}
  for(const cluster of clusters){const at=positions.length/3;if(firstRenderVertex[original]===undefined)firstRenderVertex[original]=at;positions.push(p.getX(original),p.getY(original),p.getZ(original));const normal=cluster.members.reduce((a,j)=>a.add(faces[j].raw),new T.Vector3()).normalize();normals.push(...normal.toArray());for(const fi of cluster.members){const k=faces[fi].ids.indexOf(original);indices[fi*3+k]=at;}}
 }
 for(let j=0;j<oldIndices.length;j++)for(let axis=0;axis<3;axis++){const before=p.array[oldIndices[j]*3+axis],after=positions[indices[j]*3+axis];if(before!==after)throw Error('sleep_crease_geometry_changed');}
 g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));g.setIndex(indices);g.computeBoundingBox();g.computeBoundingSphere();
 const agreement=inspectFaceNormalAgreement(T,g);if(agreement.nonpositiveFaces)throw Error('sleep_invalid_crease_normals');
 return{firstRenderVertex,certificate:{maxSharedFaceAngleDegrees,materialGroupsSeparated:true,originalWeldedPositionCount:p.count,renderVertexCount:positions.length/3,actualTriangleCornersAndWindingUnchanged:true,agreement}};
}

function pouchPattern(T){
 // Front / back are sewn around shoulders, side flanks and the closed foot.
 // Three unsewn boundary loops remain actual neck / left-arm / right-arm apertures.
 const xy=[[-.25,1.83],[-.43,1.79],[-.62,1.63],[-.66,1.30],[-.58,1.08],[-.63,.91],[-.74,.61],[-.75,.36],[-.69,.18],[-.54,.07],[-.32,.025],[0,0],[.32,.025],[.54,.07],[.69,.18],[.75,.36],[.74,.61],[.63,.91],[.58,1.08],[.66,1.30],[.62,1.63],[.43,1.79],[.25,1.83],[.265,1.70],[.20,1.59],[0,1.55],[-.20,1.59],[-.265,1.70]];
 const boundaryCount=xy.length,backXY=xy.map(p=>p.slice()),frontXY=xy.map(p=>p.slice()),centroidParents=[];
 const frontZ=(x,y)=>.29+.095*Math.pow(Math.max(0,Math.sin(Math.PI*y/1.86)),.8)-.075*x*x,backZ=(x,y)=>-.265-.067*Math.max(0,Math.sin(Math.PI*y/1.86))+.05*x*x;
 let frontFaces=T.ShapeUtils.triangulateShape(xy.map(p=>new T.Vector2(...p)),[]).map(t=>{const f=t.slice(),a=xy[f[0]],b=xy[f[1]],c=xy[f[2]];if((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])<0)f.reverse();return f;});
 // Interior-only centroid refinement keeps the exact shared sewn boundary indices.
 // Both panels remain graphs, so projected detail cannot add folded-over UV patches.
 for(let level=0;level<2;level++){const next=[];for(const f of frontFaces){const center=frontXY.length,mean=arr=>f.reduce((p,i)=>[p[0]+arr[i][0]/3,p[1]+arr[i][1]/3],[0,0]);frontXY.push(mean(frontXY));backXY.push(mean(backXY));centroidParents.push(f.slice());next.push([f[0],f[1],center],[f[1],f[2],center],[f[2],f[0],center]);}frontFaces=next;}
 const front=frontXY.map(([x,y])=>[x,y,frontZ(x,y)]),back=backXY.map(([x,y])=>[x,y,backZ(x,y)]),count=front.length,outer=[...front,...back],faces=frontFaces.map(f=>f.slice());
 frontFaces.forEach(f=>faces.push([f[2]+count,f[1]+count,f[0]+count]));
 const unsewn=new Set([2,3,18,19,22,23,24,25,26,27]);
 for(let a=0;a<boundaryCount;a++){const b=(a+1)%boundaryCount;if(!unsewn.has(a))faces.push([a,a+count,b+count],[a,b+count,b]);}
 const inset=points=>points.map((p,k)=>{const before=points[(k+points.length-1)%points.length],after=points[(k+1)%points.length],a=new T.Vector2(p[0]-before[0],p[1]-before[1]).normalize(),b=new T.Vector2(after[0]-p[0],after[1]-p[1]).normalize(),na=new T.Vector2(-a.y,a.x),nb=new T.Vector2(-b.y,b.x),sum=na.clone().add(nb),den=sum.dot(na);if(!(den>.02))throw Error('sleep_invalid_inset');return[p[0]+sum.x*spec.thickness/den,p[1]+sum.y*spec.thickness/den];});
 const fi=inset(xy),bi=inset(backXY.slice(0,boundaryCount));for(const f of centroidParents){const mean=arr=>f.reduce((p,i)=>[p[0]+arr[i][0]/3,p[1]+arr[i][1]/3],[0,0]);fi.push(mean(fi));bi.push(mean(bi));}const inner=outer.map((p,k)=>{const j=k%count,q=(k<count?fi:bi)[j];return[q[0],q[1],p[2]+(k<count?-spec.thickness:spec.thickness)];});
 const edgeMap=new Map();for(const f of faces)for(let k=0;k<3;k++){const a=f[k],b=f[(k+1)%3],key=a<b?a+':'+b:b+':'+a,r=edgeMap.get(key)||[];r.push([a,b]);edgeMap.set(key,r);}
 const next=new Map([...edgeMap.values()].filter(r=>r.length===1).map(r=>r[0])),loops=[];
 while(next.size){const start=next.keys().next().value,loop=[];let a=start;do{loop.push(a);const b=next.get(a);next.delete(a);if(b===undefined)throw Error('sleep_open_boundary');a=b;}while(a!==start);loops.push(loop);}
 const n=outer.length,positions=[...outer,...inner].flat(),indices=[],groups=[];
 const append=(f,m)=>{const start=indices.length;indices.push(...f);const last=groups.at(-1);if(last?.materialIndex===m)last.count+=3;else groups.push({start,count:3,materialIndex:m});};
 faces.forEach(f=>append(f,0));faces.forEach(f=>append([f[2]+n,f[1]+n,f[0]+n],2));
 for(const l of loops)for(let k=0;k<l.length;k++){const a=l[k],b=l[(k+1)%l.length];append([b,a,a+n],1);append([b,a+n,b+n],1);}
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);groups.forEach(g=>geometry.addGroup(g.start,g.count,g.materialIndex));geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
 const openings={neck:loops.find(l=>l.includes(25)),left_arm:loops.find(l=>l.includes(3)),right_arm:loops.find(l=>l.includes(19))};if(loops.length!==3||Object.values(openings).some(x=>!x))throw Error('sleep_three_openings_missing');
 return{geometry,openings,outerVertexCount:n,outerFaces:faces,construction:{pattern:'rounded closed-foot front/back pouch, matching rounded front/back neck seams; coordinate-welded sewn shoulders, flanks and base; render-only normal creases',outerTriangles:faces.length,innerTriangles:faces.length,rimWallTriangles:loops.reduce((n,l)=>n+l.length*2,0),passageRims:3,closedFoot:true,frontFasteningOperable:false,centroidRefinementLevels:2,bodyBinding:null}};
}
export function build(T){
 if(!T?.BufferGeometry||!T?.ShapeUtils)throw Error('sleep_three_required');
 const group=new T.Group();group.name=spec.id;const geometries=new Set(),materials=[],parts=[],contacts=[];
 const mat=(name,color,roughness=.9,metalness=0)=>{const m=new T.MeshStandardMaterial({name,color,roughness,metalness,side:T.FrontSide});materials.push(m);return m;};
 const cream=mat('warm-ivory-quilted-cloth','#ede2c9'),sage=mat('muted-sage-cotton-binding','#a4b18e'),inside=mat('warm-authored-cloth-lining','#c8b998'),gold=mat('restrained-warm-brass-piping','#b99455',.62,.15),stitch=mat('cream-quilt-relief','#e0d2b4'),leaf=mat('sage-leaf-embroidery','#879c74'),bud=mat('muted-peach-bud','#d8ae98');
 const add=(name,g,m)=>{geometries.add(g);const mesh=new T.Mesh(g,m);mesh.name=name;group.add(mesh);parts.push(mesh);return mesh;};
 const shellData=pouchPattern(T),shell=add('joined-closed-foot-sleep-sack-material-shell',shellData.geometry,[cream,sage,inside]);
 const cylinder=new T.CylinderGeometry(1,1,1,10,1,false),sphere=new T.SphereGeometry(1,12,8);geometries.add(cylinder);geometries.add(sphere);
 const surfaceAt=(x,y,side=1)=>{const hits=segmentHits(T,shell.geometry,[x,y,side*2],[x,y,-side*2]).sort((a,b)=>a.distance-b.distance);if(!hits.length)throw Error('sleep_surface_anchor_missing');return new T.Vector3(...hits[0].point);};
 function strictContact(part,target,seed,scope){
  group.updateMatrixWorld(true);
  const offsets=[[0,0,0]],ds=[.002,.005,.009,.014,.020,.027];
  for(const d of ds)for(const dx of[-1,0,1])for(const dy of[-1,0,1])for(const dz of[-1,0,1])if(dx||dy||dz){const v=new T.Vector3(dx,dy,dz).normalize().multiplyScalar(d);offsets.push(v.toArray());}
  let selected=null;
  for(const offset of offsets){const point=seed.clone().add(new T.Vector3(...offset)),partCheck=strictContainment(T,part,point.toArray());if(!partCheck.inside)continue;const targetCheck=strictContainment(T,target,point.toArray());if(targetCheck.inside){selected={point,partCheck,targetCheck};break;}}
  if(!selected)throw Error('sleep_attachment_witness_missing:'+part.name);
  contacts.push({part:part.name,target:target.name,point:selected.point.toArray(),scope,strictValidation:{part:selected.partCheck,target:selected.targetCheck,probeDirections:contactProbeDirections,finitePointOnly:true}});return part;
 }
 function rod(name,a,b,r,material,target=shell,seed=null){const d=b.clone().sub(a),mesh=add(name,cylinder,material);mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.scale.set(r,d.length(),r);mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());if(target)strictContact(mesh,target,seed||a.clone().add(b).multiplyScalar(.5),'strict actual common-solid attachment witness, not load/friction');return mesh;}
 // Sage piping surrounds exactly the three genuine openings, never across them.
 for(const[name,loop]of Object.entries(shellData.openings))for(let k=0;k<loop.length;k++){
  const a=loop[k],b=loop[(k+1)%loop.length],p=shell.geometry.attributes.position,n=shellData.outerVertexCount,va=new T.Vector3().fromBufferAttribute(p,a),vb=new T.Vector3().fromBufferAttribute(p,b),ia=new T.Vector3().fromBufferAttribute(p,a+n),ib=new T.Vector3().fromBufferAttribute(p,b+n),ca=va.clone().add(ia).multiplyScalar(.5),cb=vb.clone().add(ib).multiplyScalar(.5);
  rod('sage-'+name+'-rim-'+k,ca,cb,.027,sage);
 }
 function path(name,xy,material,r,side=1){
  class ClothCurve extends T.Curve{getPoint(t,target=new T.Vector3()){const at=Math.min(xy.length-1-1e-9,Math.max(0,t)*(xy.length-1)),i=Math.floor(at),u=at-i,x=xy[i][0]*(1-u)+xy[i+1][0]*u,y=xy[i][1]*(1-u)+xy[i+1][1]*u;return target.copy(surfaceAt(x,y,side)).add(new T.Vector3(0,0,-side*.002));}}
  const curve=new ClothCurve(),g=new T.TubeGeometry(curve,Math.max(12,(xy.length-1)*7),r,6,false),p=g.attributes.position,positions=Array.from(p.array),idx=Array.from(g.index.array),edgeMap=new Map();
  const key=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(x=>Math.round(x*1e7)).join(',');
  for(let j=0;j<idx.length;j+=3)for(let k=0;k<3;k++){const a=idx[j+k],b=idx[j+(k+1)%3],ka=key(a),kb=key(b),id=ka<kb?ka+'|'+kb:kb+'|'+ka,old=edgeMap.get(id)||[];old.push([a,b]);edgeMap.set(id,old);}
  const ends=[[],[]];for(const edges of edgeMap.values())if(edges.length===1){const edge=edges[0];ends[edge[0]<7&&edge[1]<7?0:1].push(edge);}
  for(const edges of ends){if(edges.length!==6)throw Error('sleep_tube_cap_boundary');const center=edges.reduce((sum,[a])=>sum.add(new T.Vector3().fromBufferAttribute(p,a)),new T.Vector3()).divideScalar(edges.length),n=positions.length/3;positions.push(...center.toArray());for(const[a,b]of edges)idx.push(b,a,n);}
  const solid=new T.BufferGeometry();solid.setAttribute('position',new T.Float32BufferAttribute(positions,3));solid.setIndex(idx);solid.computeVertexNormals();g.dispose();const mesh=add(name,solid,material);strictContact(mesh,shell,curve.getPoint(.51),'finite strict cloth-following capped relief / material witness');
 }
 // The front overlap is closed cloth with raised sage binding; no untested opening.
 path('closed-overlap-binding',[[-.19,1.565],[-.08,1.50],[.02,1.40],[.075,1.21],[.10,1.03],[.065,.85],[-.015,.66],[-.07,.47],[-.055,.29],[0,.055]],sage,.026);
 path('front-lower-sage-band',[[-.69,.27],[-.47,.24],[-.22,.21],[0,.20],[.22,.22],[.47,.27],[.69,.33]],sage,.023);
 path('back-lower-sage-band',[[-.69,.27],[-.47,.24],[-.22,.21],[0,.20],[.22,.22],[.47,.27],[.69,.33]],sage,.023,-1);
 const veins=[
 [[0,.08],[.04,.31],[.10,.55],[.10,.80],[.08,1.02]],
 [[.02,.27],[-.16,.40],[-.36,.47],[-.60,.51],[-.71,.56]],
 [[.08,.51],[-.11,.67],[-.31,.76],[-.56,.82],[-.62,.87]],
 [[.10,.78],[-.08,.93],[-.26,1.02],[-.47,1.10],[-.55,1.16]],
 [[.07,1.01],[-.10,1.15],[-.28,1.25],[-.49,1.35],[-.58,1.41]],
 [[.025,.25],[.22,.38],[.42,.46],[.63,.50],[.71,.56]],
 [[.08,.50],[.25,.65],[.43,.73],[.60,.78],[.66,.81]],
 [[.10,.77],[.27,.90],[.43,.98],[.56,1.06]],
 [[.08,1.02],[.26,1.13],[.43,1.22],[.57,1.32]]
 ];
 veins.forEach((p,i)=>path('front-warm-gold-leaf-quilt-'+i,p,gold,.0055));
 for(const sign of[-1,1])for(let j=0;j<3;j++){const y=.47+j*.31;path('back-soft-quilt-'+sign+'-'+j,[[0,y-.2],[sign*.17,y-.06],[sign*.37,y+.06],[sign*.57,y+.10]],stitch,.0055,-1);}
 function relief(name,points,material,depth=.025){
  const front=points.map(([x,y])=>surfaceAt(x,y)),base=front.map(p=>[p.x,p.y,p.z-.012]),top=front.map(p=>[p.x,p.y,p.z+depth]),n=points.length,idx=[],tris=T.ShapeUtils.triangulateShape(points.map(p=>new T.Vector2(...p)),[]);
  for(const t of tris){const f=t.slice(),a=points[f[0]],b=points[f[1]],c=points[f[2]];if((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])<0)f.reverse();idx.push(f[0]+n,f[1]+n,f[2]+n,f[2],f[1],f[0]);}
  const area=points.reduce((a,p,i)=>{const q=points[(i+1)%n];return a+p[0]*q[1]-q[0]*p[1];},0);
  for(let a=0;a<n;a++){const b=(a+1)%n;if(area>0)idx.push(a,b,b+n,a,b+n,a+n);else idx.push(b,a,a+n,b,a+n,b+n);}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([...base,...top].flat(),3));g.setIndex(idx);g.computeVertexNormals();const mesh=add(name,g,material),center=front.reduce((p,x)=>p.add(x),new T.Vector3()).divideScalar(n),seed=surfaceAt(center.x,center.y).add(new T.Vector3(0,0,-.005));strictContact(mesh,shell,seed,'strict embroidery / actual shell common-solid witness');return mesh;
 }
 relief('warm-brass-leaf-clasp',[[.035,1.355],[.14,1.415],[.27,1.36],[.17,1.28],[.07,1.30]],gold,.032);
 relief('sage-leaf-clasp-inlay',[[.071,1.353],[.145,1.389],[.237,1.357],[.17,1.307],[.095,1.322]],sage,.039);
 path('leaf-clasp-vein',[[.055,1.345],[.145,1.355],[.237,1.357]],gold,.005);
 const buttonPos=surfaceAt(-.002,1.345),button=add('round-brass-closed-overlap-button',sphere,gold);button.position.copy(buttonPos).add(new T.Vector3(0,0,.012));button.scale.set(.035,.035,.028);strictContact(button,shell,buttonPos.clone().add(new T.Vector3(0,0,-.005)),'strict brass button / cloth common-solid witness');
 relief('small-sage-embroidered-leaf-a',[[.30,.96],[.26,1.045],[.33,1.018],[.37,.958]],leaf,.012);
 relief('small-sage-embroidered-leaf-b',[[.36,.94],[.40,1.035],[.45,1.075],[.44,.99]],leaf,.012);
 relief('small-muted-peach-embroidered-bud',[[.30,1.045],[.255,1.10],[.255,1.15],[.32,1.14],[.35,1.08]],bud,.014);
 path('small-bud-stem',[[.40,.91],[.36,.98],[.31,1.07]],gold,.005);
 group.updateMatrixWorld(true);
 const normalCreases=creaseMaterialNormals(T,shell.geometry);shellData.construction.normalConstruction=normalCreases.certificate;
 const garmentRims={};for(const[name,loop]of Object.entries(shellData.openings)){const vertex=normalCreases.firstRenderVertex[loop[0]],p=new T.Vector3().fromBufferAttribute(shell.geometry.attributes.position,vertex),n=new T.Vector3().fromBufferAttribute(shell.geometry.attributes.normal,vertex).normalize();let up=new T.Vector3(0,1,0).addScaledVector(n,-n.y);if(up.lengthSq()<.001)up=new T.Vector3(0,0,1).addScaledVector(n,-n.z);up.normalize();const x=up.clone().cross(n).normalize();up.copy(n).cross(x).normalize();garmentRims[name]={space:'garment_local',surfaceMesh:shell.name,outerVertex:vertex,actualSurfacePosition:p.toArray(),actualSurfaceNormal:n.toArray(),localFrame:new T.Matrix4().makeBasis(x,up,n).setPosition(p).toArray(),boundaryOuterVertexIndices:loop.map(i=>normalCreases.firstRenderVertex[i]),bodyBinding:null,anatomicalSocket:false};}
 const segments=[];for(const[x,z]of[[0,0],[.05,0],[-.05,0],[0,.05],[0,-.05]])segments.push({opening:'neck',from:[x,2,z],to:[x,1.40,z]});
 for(const side of[-1,1])for(const dy of[-.08,0,.08])segments.push({opening:side<0?'left_arm':'right_arm',from:[side*.95,1.35+dy,0],to:[side*.37,1.35+dy,0]});
 const passages=segments.map(s=>({...s,hits:parts.flatMap(p=>{const inv=p.matrixWorld.clone().invert(),a=new T.Vector3(...s.from).applyMatrix4(inv),b=new T.Vector3(...s.to).applyMatrix4(inv);return segmentHits(T,p.geometry,a.toArray(),b.toArray()).map(h=>({part:p.name,...h}));})}));
 const box=new T.Box3().setFromObject(group,true),bounds={min:box.min.toArray(),max:box.max.toArray(),size:box.getSize(new T.Vector3()).toArray()},budget={meshes:parts.length,geometries:geometries.size,materials:materials.length,textures:0,lights:0,triangles:parts.reduce((n,p)=>n+p.geometry.index.count/3,0)};let disposed=false;
 function inspect(){return{model_id:spec.id,sourceSHA:spec.sourceSHA,topology:inspectTopology(T,shell.geometry),construction:shellData.construction,budget,bounds,garmentRims,passages:{count:passages.length,blocked:passages.filter(s=>s.hits.length).length,segments:passages},contactWitnesses:contacts,closedFoot:true,frontSeamIsNotOpening:true,bodyBinding:null,authoredGarmentDepthNotBodyDepth:true,wearing:false,rig:false,clothPhysics:false,normalGamePlacement:false,ownershipUnlockSave:false};}
 return{group,shell,parts,resources:{geometries,materials,textures:[]},garmentRims,passages,contactWitnesses:contacts,bounds,budget,construction:shellData.construction,inspect,resolveRim(name){if(disposed)throw Error('sleep_disposed');if(!Object.hasOwn(garmentRims,name))throw Error('sleep_unknown_rim');return garmentRims[name];},dispose(){if(disposed)return false;disposed=true;for(const g of geometries)g.dispose();for(const m of materials)m.dispose();group.clear();return true;}};
}

/* Generic actual-triangle topology, normal and finite strict-overlap audits reused without the prior garment recipe. */
export function inspectTopology(T,g){
 const p=g.attributes.position,i=g.index,n=g.attributes.normal,edges=new Map();let volume=0,degenerate=0,invalidNormals=0;const keys=Array.from({length:p.count},(_,j)=>[p.getX(j),p.getY(j),p.getZ(j)].map(v=>Math.round(v*1e6)).join(','));
 for(let j=0;j<i.count;j+=3){const ids=[i.getX(j),i.getX(j+1),i.getX(j+2)],[a,b,c]=ids.map(k=>new T.Vector3().fromBufferAttribute(p,k));if(b.clone().sub(a).cross(c.clone().sub(a)).length()<1e-10)degenerate++;volume+=a.dot(b.clone().cross(c))/6;for(let k=0;k<3;k++){const a=keys[ids[k]],b=keys[ids[(k+1)%3]],key=a<b?a+'|'+b:b+'|'+a,r=edges.get(key)||{count:0,balance:0};r.count++;r.balance+=a<b?1:-1;edges.set(key,r);}}
 for(let j=0;j<n.count;j++){const v=new T.Vector3().fromBufferAttribute(n,j);if(!Number.isFinite(v.length())||Math.abs(v.length()-1)>.002)invalidNormals++;}
 const badEdges=[...edges.values()].filter(r=>r.count!==2||r.balance!==0).length;return{vertices:p.count,triangles:i.count/3,closedEdges:badEdges===0,badEdges,degenerateTriangles:degenerate,invalidNormals,signedVolume:volume};
}
export function segmentHits(T,g,from,to){
 const a=new T.Vector3(...from),d=new T.Vector3(...to).sub(a),length=d.length();if(!(length>0))throw Error('cape_invalid_segment');const ray=new T.Ray(a,d.divideScalar(length)),p=g.attributes.position,i=g.index,out=new T.Vector3(),hits=[];
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
 if(!Array.isArray(point)||point.length!==3||!point.every(Number.isFinite))throw Error('cape_invalid_strict_point');
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

/* Authored smock construction in garment-local prototype units; never body measurements. */
export const spec=Object.freeze({id:'morning-garden-smock-garment-volume-v1',unit:'wardrobe:fit-prerequisite:morning-garden-smock:garment-volume-openings:v1',sourceSHA:'da52a67002f533630dfc7720eb78258fce056a06a762aa340a3fd8cefbfd4e6a',thickness:.026,bodyBinding:null,bodyMeasurements:false,wearingFit:false,rig:false,clothPhysics:false,stretchCalibrated:false,normalGame:false,unlockSave:false,newRaw:false,newDesign:false,newVillageLibraryCandidate:false,backAndInterior:'Authored smock pattern, back crossing straps, depth and interior; not body measurement or recovered original backside.'});
export function inspectTopology(T,g){
 const p=g.attributes.position,i=g.index,n=g.attributes.normal,edges=new Map();let volume=0,degenerate=0,invalidNormals=0;const keys=Array.from({length:p.count},(_,j)=>[p.getX(j),p.getY(j),p.getZ(j)].map(v=>Math.round(v*1e6)).join(','));
 for(let j=0;j<i.count;j+=3){const ids=[i.getX(j),i.getX(j+1),i.getX(j+2)],[a,b,c]=ids.map(k=>new T.Vector3().fromBufferAttribute(p,k));if(b.clone().sub(a).cross(c.clone().sub(a)).length()<1e-10)degenerate++;volume+=a.dot(b.clone().cross(c))/6;for(let k=0;k<3;k++){const a=keys[ids[k]],b=keys[ids[(k+1)%3]],key=a<b?a+'|'+b:b+'|'+a,r=edges.get(key)||{count:0,balance:0};r.count++;r.balance+=a<b?1:-1;edges.set(key,r);}}
 for(let j=0;j<n.count;j++){const v=new T.Vector3().fromBufferAttribute(n,j);if(!Number.isFinite(v.length())||Math.abs(v.length()-1)>.002)invalidNormals++;}
 const badEdges=[...edges.values()].filter(r=>r.count!==2||r.balance!==0).length;return{vertices:p.count,triangles:i.count/3,closedEdges:badEdges===0,badEdges,degenerateTriangles:degenerate,invalidNormals,signedVolume:volume};
}
export function segmentHits(T,g,from,to){
 const a=new T.Vector3(...from),d=new T.Vector3(...to).sub(a),length=d.length();if(!(length>0))throw Error('smock_invalid_segment');const ray=new T.Ray(a,d.divideScalar(length)),p=g.attributes.position,i=g.index,out=new T.Vector3(),hits=[];
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

function garmentPattern(T){
 // New flared smock outline, short sleeves, low rounded front neck, and higher
 // authored back neck. Each sewn shoulder/underarm/side is shared by indices.
 const xy=[[-.30,1.66],[-.54,1.60],[-.89,1.38],[-1.02,1.18],[-.82,.96],[-.55,1.15],[-.57,.88],[-.78,.18],[-.77,.10],[-.65,.04],[-.47,.06],[-.29,.015],[-.12,.04],[0,0],[.12,.04],[.29,.015],[.47,.06],[.65,.04],[.77,.10],[.78,.18],[.57,.88],[.55,1.15],[.82,.96],[1.02,1.18],[.89,1.38],[.54,1.60],[.30,1.66],[.28,1.47],[.19,1.31],[0,1.255],[-.19,1.31],[-.28,1.47]];
 const count=xy.length,front=xy.map(([x,y])=>[x,y,.27+.05*(1-y/1.66)-.025*x*x]),back=xy.map(([x,y],k)=>[x,k>=27?1.60+.06*Math.abs(x)/.30:y,-.235-.045*(1-y/1.66)+.020*x*x]);
 const outer=[...front,...back],faces=[],shape=xy.map(p=>new T.Vector2(...p));
 for(const tri of T.ShapeUtils.triangulateShape(shape,[])){const f=tri.slice();if(new T.Vector3(...front[f[1]]).sub(new T.Vector3(...front[f[0]])).cross(new T.Vector3(...front[f[2]]).sub(new T.Vector3(...front[f[0]]))).z<0)f.reverse();faces.push(f);}
 const frontFaces=faces.slice();frontFaces.forEach(f=>faces.push([f[2]+count,f[1]+count,f[0]+count]));
 const unsewn=new Set([3,22,...Array.from({length:12},(_,i)=>i+7),...Array.from({length:6},(_,i)=>i+26)]);
 for(let a=0;a<count;a++){const b=(a+1)%count;if(!unsewn.has(a)){faces.push([a,a+count,b+count],[a,b+count,b]);}}
 const inset=points=>points.map((p,k)=>{const before=points[(k+points.length-1)%points.length],after=points[(k+1)%points.length],a=new T.Vector2(p[0]-before[0],p[1]-before[1]).normalize(),b=new T.Vector2(after[0]-p[0],after[1]-p[1]).normalize(),na=new T.Vector2(-a.y,a.x),nb=new T.Vector2(-b.y,b.x),sum=na.add(nb),den=sum.dot(new T.Vector2(-a.y,a.x));return[p[0]+sum.x*spec.thickness/den,p[1]+sum.y*spec.thickness/den];});
 const fi=inset(front),bi=inset(back),inner=outer.map((p,k)=>{const q=(k<count?fi:bi)[k%count];return[q[0],q[1],p[2]+(k<count?-spec.thickness:spec.thickness)];});
 const edgeMap=new Map();for(const f of faces)for(let k=0;k<3;k++){const a=f[k],b=f[(k+1)%3],key=a<b?a+':'+b:b+':'+a,r=edgeMap.get(key)||[];r.push([a,b]);edgeMap.set(key,r);}
 const next=new Map([...edgeMap.values()].filter(r=>r.length===1).map(r=>r[0])),loops=[];
 while(next.size){const start=next.keys().next().value,loop=[];let a=start;do{loop.push(a);const b=next.get(a);next.delete(a);if(b===undefined)throw Error('smock_open_boundary');a=b;}while(a!==start);loops.push(loop);}
 const n=outer.length,positions=[...outer,...inner].flat(),indices=[],groups=[];
 const append=(f,m)=>{const start=indices.length;indices.push(...f);const last=groups.at(-1);if(last?.materialIndex===m)last.count+=3;else groups.push({start,count:3,materialIndex:m});};
 faces.forEach(f=>append(f,0));faces.forEach(f=>append([f[2]+n,f[1]+n,f[0]+n],2));for(const l of loops)for(let k=0;k<l.length;k++){const a=l[k],b=l[(k+1)%l.length];append([b,a,a+n],1);append([b,a+n,b+n],1);}
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);groups.forEach(g=>geometry.addGroup(g.start,g.count,g.materialIndex));geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
 const openings={neck:loops.find(l=>l.includes(29)),left_cuff:loops.find(l=>l.includes(3)),right_cuff:loops.find(l=>l.includes(22)),hem:loops.find(l=>l.includes(13))};if(loops.length!==4||Object.values(openings).some(x=>!x))throw Error('smock_four_openings_missing');
 return{geometry,openings,outerVertexCount:n,outerFaces:faces,construction:{pattern:'new rounded-U-front / high-back flared smock panels with shared-index shoulder, underarm and side seams',outerTriangles:faces.length,innerTriangles:faces.length,rimWallTriangles:loops.reduce((n,l)=>n+l.length*2,0),passageRims:4,sleevesShareTorsoBoundaryIndices:true,authoredBackCrossStraps:true,bodyBinding:null}};
}

export function build(T){
 if(!T?.BufferGeometry||!T?.ShapeUtils)throw Error('smock_three_required');const group=new T.Group();group.name=spec.id;const geometries=new Set(),materials=[],parts=[],contacts=[];
 const mat=(name,color)=>{const m=new T.MeshStandardMaterial({name,color,roughness:.9,metalness:0,side:T.FrontSide});materials.push(m);return m;};
 const sage=mat('sage-smock-cotton','#9cac8f'),cream=mat('cream-boundaries','#e9dfc6'),inside=mat('authored-sage-lining','#82936c'),leaf=mat('leaf-embroidery','#bdd2b1'),wood=mat('wood-toggles','#b98c53');
 const add=(name,g,m)=>{geometries.add(g);const mesh=new T.Mesh(g,m);mesh.name=name;group.add(mesh);parts.push(mesh);return mesh;};
 const shellData=garmentPattern(T),shell=add('joined-smock-material-shell',shellData.geometry,[sage,cream,inside]);
 const surfaceAt=(x,y,side=1,target=shell)=>{const hits=segmentHits(T,target.geometry,[x,y,side*2],[x,y,-side*2]).sort((a,b)=>a.distance-b.distance);if(!hits.length)throw Error('smock_surface_anchor_missing');return new T.Vector3(...hits[0].point);};
 function relief(name,points,material,depth=.020,side=1){
  const front=points.map(([x,y])=>surfaceAt(x,y,side)),base=front.map(p=>[p.x,p.y,p.z-side*.010]),top=front.map(p=>[p.x,p.y,p.z+side*depth]),count=points.length,idx=[],tris=T.ShapeUtils.triangulateShape(points.map(p=>new T.Vector2(...p)),[]);
  for(const t of tris){const a=t.slice();if(new T.Vector2(...points[a[1]]).sub(new T.Vector2(...points[a[0]])).cross(new T.Vector2(...points[a[2]]).sub(new T.Vector2(...points[a[0]])))*side<0)a.reverse();idx.push(a[0]+count,a[1]+count,a[2]+count,a[2],a[1],a[0]);}
  const area=points.reduce((sum,p,i)=>{const q=points[(i+1)%count];return sum+p[0]*q[1]-q[0]*p[1];},0);
  for(let a=0;a<count;a++){const b=(a+1)%count;if(area*side>0)idx.push(a,b,b+count,a,b+count,a+count);else idx.push(b,a,a+count,b,a+count,b+count);}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([...base,...top].flat(),3));g.setIndex(idx);g.computeVertexNormals();const mesh=add(name,g,material),center=front.reduce((v,p)=>v.add(p),new T.Vector3()).divideScalar(front.length),w=surfaceAt(center.x,center.y,side).add(new T.Vector3(0,0,-side*.004));contacts.push({part:name,target:shell.name,point:w.toArray(),scope:'strict common-solid witness with authored smock material'});return mesh;
 }
 const cylinder=new T.CylinderGeometry(1,1,1,8,1,false),sphere=new T.SphereGeometry(1,12,8);geometries.add(cylinder);geometries.add(sphere);
 function rod(name,a,b,r,material){const d=b.clone().sub(a),mesh=add(name,cylinder,material);mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.scale.set(r,d.length(),r);mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());return mesh;}
 // Cream piping follows the actual four opening rims, rather than sealing them.
 for(const[name,loop]of Object.entries(shellData.openings))for(let k=0;k<loop.length;k++){
  const a=loop[k],b=loop[(k+1)%loop.length],p=shell.geometry.attributes.position,n=shellData.outerVertexCount,va=new T.Vector3().fromBufferAttribute(p,a),vb=new T.Vector3().fromBufferAttribute(p,b),ia=new T.Vector3().fromBufferAttribute(p,a+n),ib=new T.Vector3().fromBufferAttribute(p,b+n),ca=va.clone().add(ia).multiplyScalar(.5),cb=vb.clone().add(ib).multiplyScalar(.5),mesh=rod('cream-'+name+'-edge-'+k,ca,cb,.023,cream),f=shellData.outerFaces.find(f=>f.includes(a)&&f.includes(b)),c=f.find(i=>i!==a&&i!==b),cloth=new T.Vector3().fromBufferAttribute(p,c).sub(va.clone().add(vb).multiplyScalar(.5)).normalize(),w=ca.clone().add(cb).multiplyScalar(.5).addScaledVector(cloth,.004);
  let witness=w;if(!containsPoint(T,shell,w.toArray())){const center=ca.clone().add(cb).multiplyScalar(.5),offsets=[];for(const distance of[.004,.008,.012,.016])for(const dx of[-1,0,1])for(const dy of[-1,0,1])for(const dz of[-1,0,1])if(dx||dy||dz)offsets.push(center.clone().add(new T.Vector3(dx,dy,dz).normalize().multiplyScalar(distance)));witness=offsets.find(p=>containsPoint(T,shell,p.toArray()));if(!witness)throw Error('smock_rim_contact_missing');}
  contacts.push({part:mesh.name,target:shell.name,point:witness.toArray(),scope:'strict rim piping / actual cloth common-solid witness'});
 }
 for(const sign of[-1,1]){
  const x=sign*.365,name=sign<0?'left-pocket':'right-pocket';
  relief(name+'-cream-edge',[[x-.16,.72],[x-.155,.405],[x-.11,.345],[x,.33],[x+.11,.345],[x+.155,.405],[x+.16,.72]],cream,.028);
  const patch=relief(name+'-sage-patch',[[x-.132,.715],[x-.13,.42],[x-.09,.375],[x,.36],[x+.09,.375],[x+.13,.42],[x+.132,.715]],sage,.040);
  relief(name+'-cream-flap',[[x-.153,.735],[x-.145,.64],[x-.085,.605],[x,.625],[x+.085,.605],[x+.145,.64],[x+.153,.735]],cream,.052);
  const p=surfaceAt(x,.59),toggle=add(name+'-wood-toggle',sphere,wood);toggle.position.copy(p).add(new T.Vector3(0,0,.061));toggle.scale.set(.040,.060,.045);contacts.push({part:toggle.name,target:patch.name,point:[x,.59,p.z+.030],scope:'strict pocket toggle / patch common-solid witness'});
 }
 // Source strap cue becomes two newly constructed closed cloth ribbons on back.
 relief('back-cross-strap-left',[[ -.39,1.53],[-.30,1.61],[.39,1.10],[.30,1.01]],cream,.026,-1);
 relief('back-cross-strap-right',[[.39,1.53],[.30,1.61],[-.39,1.10],[-.30,1.01]],cream,.039,-1);
 // Two small shoulder tabs and wooden toggles follow the front cloth surface.
 for(const sign of[-1,1]){const x=sign*.43,name=sign<0?'left-shoulder':'right-shoulder';const tab=relief(name+'-tab',[[x-.065,1.52],[x-.06,1.36],[x,1.325],[x+.06,1.36],[x+.065,1.52]],cream,.025);const p=surfaceAt(x,1.41),t=add(name+'-wood-toggle',sphere,wood);t.position.copy(p).add(new T.Vector3(0,0,.042));t.scale.set(.035,.052,.042);contacts.push({part:t.name,target:tab.name,point:[x,1.41,p.z+.016],scope:'strict shoulder toggle / tab common-solid witness'});}
 relief('leaf-embroidery-left',[[0,1.025],[-.09,1.035],[-.17,1.16],[-.065,1.14],[.01,1.055]],leaf,.015);
 relief('leaf-embroidery-right',[[0,1.035],[.03,1.12],[.17,1.19],[.145,1.095],[.045,1.035]],leaf,.015);
 const path=[[0,.93],[.01,.99],[.015,1.055],[.045,1.11]];
 for(let i=0;i<path.length-1;i++){const a=surfaceAt(...path[i]).add(new T.Vector3(0,0,.002)),b=surfaceAt(...path[i+1]).add(new T.Vector3(0,0,.002)),r=rod('embroidery-stem-'+i,a,b,.008,leaf),mid=a.clone().add(b).multiplyScalar(.5);mid.z=surfaceAt(mid.x,mid.y).z-.001;contacts.push({part:r.name,target:shell.name,point:mid.toArray(),scope:'strict embroidery stem / cloth common-solid witness'});}
 group.updateMatrixWorld(true);
 const garmentRims={};for(const[name,loop]of Object.entries(shellData.openings)){const vertex=loop[0],p=new T.Vector3().fromBufferAttribute(shell.geometry.attributes.position,vertex),n=new T.Vector3().fromBufferAttribute(shell.geometry.attributes.normal,vertex).normalize();let up=new T.Vector3(0,1,0).addScaledVector(n,-n.y);if(up.lengthSq()<.001)up=new T.Vector3(0,0,1).addScaledVector(n,-n.z);up.normalize();const x=up.clone().cross(n).normalize();up.copy(n).cross(x).normalize();garmentRims[name]={space:'garment_local',surfaceMesh:shell.name,outerVertex:vertex,actualSurfacePosition:p.toArray(),actualSurfaceNormal:n.toArray(),localFrame:new T.Matrix4().makeBasis(x,up,n).setPosition(p).toArray(),boundaryOuterVertexIndices:loop,bodyBinding:null,anatomicalSocket:false};}
 const segments=[];for(const[x,z]of[[0,0],[.07,0],[-.07,0],[0,.07],[0,-.07]])segments.push({opening:'neck',from:[x,1.8,z],to:[x,-.15,z]});for(const[x,z]of[[0,0],[.18,0],[-.18,0],[0,.10],[0,-.10]])segments.push({opening:'hem',from:[x,-.15,z],to:[x,1.8,z]});for(const side of[-1,1])for(const dy of[-.035,0,.035])segments.push({opening:side<0?'left_cuff':'right_cuff',from:[side*1.14,1.01+dy,0],to:[side*.61,1.35+dy,0]});
 const passageSegments=segments.map(s=>({...s,hits:parts.flatMap(p=>{const inv=p.matrixWorld.clone().invert(),a=new T.Vector3(...s.from).applyMatrix4(inv),b=new T.Vector3(...s.to).applyMatrix4(inv);return segmentHits(T,p.geometry,a.toArray(),b.toArray()).map(h=>({part:p.name,...h}));})}));
 const box=new T.Box3().setFromObject(group,true),bounds={min:box.min.toArray(),max:box.max.toArray(),size:box.getSize(new T.Vector3()).toArray()},budget={meshes:parts.length,geometries:geometries.size,materials:materials.length,textures:0,lights:0,triangles:parts.reduce((n,p)=>n+p.geometry.index.count/3,0)};let disposed=false;
 function inspect(){return{model_id:spec.id,sourceSHA:spec.sourceSHA,topology:inspectTopology(T,shell.geometry),construction:shellData.construction,budget,bounds,garmentRims,passages:{count:passageSegments.length,blocked:passageSegments.filter(s=>s.hits.length).length,segments:passageSegments},contactWitnesses:contacts,bodyBinding:null,authoredGarmentDepthNotBodyDepth:true,wearing:false,rig:false,clothPhysics:false,normalGamePlacement:false,ownershipUnlockSave:false};}
 return{group,shell,parts,resources:{geometries,materials,textures:[]},garmentRims,passages:passageSegments,contactWitnesses:contacts,bounds,budget,construction:shellData.construction,inspect,resolveRim(name){if(disposed)throw Error('smock_disposed');if(!Object.hasOwn(garmentRims,name))throw Error('smock_unknown_rim');return garmentRims[name];},dispose(){if(disposed)return false;disposed=true;for(const g of geometries)g.dispose();for(const m of materials)m.dispose();group.clear();return true;}};
}

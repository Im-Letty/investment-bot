/* Authored garment pattern construction. No body, recovered depth, fit or rig. */
export const spec=Object.freeze({id:'coastal-sailor-tunic-garment-volume-v1',unit:'wardrobe:fit-prerequisite:coastal-sailor-tunic:garment-volume-openings:v1',sourceSHA:'0a845475fcd03c1c7fae659b99fe557986a87502ef17827bfd3a9dbeb824ff1c',thickness:.024,bodyBinding:null,bodyMeasurements:false,wearingFit:false,rig:false,stretchCalibrated:false,normalGame:false,unlockSave:false,newRaw:false,newDesign:false,newVillageLibraryCandidate:false,backAndInterior:'Authored garment pattern, depth, back and interior; no recovered anatomy or original backside.'});

export function inspectTopology(T,g){
 const p=g.attributes.position,i=g.index,n=g.attributes.normal,edges=new Map();let volume=0,degenerate=0,invalidNormals=0;const keys=Array.from({length:p.count},(_,j)=>[p.getX(j),p.getY(j),p.getZ(j)].map(v=>Math.round(v*1e6)).join(','));
 for(let j=0;j<i.count;j+=3){const ids=[i.getX(j),i.getX(j+1),i.getX(j+2)],[a,b,c]=ids.map(k=>new T.Vector3().fromBufferAttribute(p,k));if(b.clone().sub(a).cross(c.clone().sub(a)).length()<1e-10)degenerate++;volume+=a.dot(b.clone().cross(c))/6;for(let k=0;k<3;k++){const a=keys[ids[k]],b=keys[ids[(k+1)%3]],key=a<b?a+'|'+b:b+'|'+a,r=edges.get(key)||{count:0,balance:0};r.count++;r.balance+=a<b?1:-1;edges.set(key,r);}}
 for(let j=0;j<n.count;j++){const v=new T.Vector3().fromBufferAttribute(n,j);if(!Number.isFinite(v.length())||Math.abs(v.length()-1)>.002)invalidNormals++;}
 const badEdges=[...edges.values()].filter(r=>r.count!==2||r.balance!==0).length;return{vertices:p.count,triangles:i.count/3,closedEdges:badEdges===0,badEdges,degenerateTriangles:degenerate,invalidNormals,signedVolume:volume};
}
export function segmentHits(T,g,from,to){
 const a=new T.Vector3(...from),d=new T.Vector3(...to).sub(a),length=d.length();if(!(length>0))throw Error('tunic_invalid_segment');const ray=new T.Ray(a,d.divideScalar(length)),p=g.attributes.position,i=g.index,out=new T.Vector3(),hits=[];
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
 // CCW flat pattern, with two explicit cuff strips. Front and back share every
 // sewn edge index; omitted seams make four actual garment boundary loops.
 const xy=[[-.29,1.55],[-.57,1.48],[-1.02,1.15],[-1.14,1.00],[-.97,.73],[-.84,.81],[-.54,1.00],[-.56,.18],[-.59,0],[.59,0],[.56,.18],[.54,1.00],[.84,.81],[.97,.73],[1.14,1.00],[1.02,1.15],[.57,1.48],[.29,1.55],[0,1.04]];
 const front=xy.map(([x,y])=>[x,y,.255-.035*x*x]),back=xy.map(([x,y],k)=>[x,k===18?1.45:y,-.225+.025*x*x]);
 const vertices=[...front,...back],count=xy.length,faces=[],labels=[];
 const add=(a,b,c,m=0)=>{faces.push([a,b,c]);labels.push(m);};
 const main=[0,1,2,5,6,7,8,9,10,11,12,15,16,17,18],mainShape=main.map(k=>new T.Vector2(...xy[k]));
 for(const tri of T.ShapeUtils.triangulateShape(mainShape,[])){const f=tri.map(k=>main[k]);if(new T.Vector3(...front[f[1]]).sub(new T.Vector3(...front[f[0]])).cross(new T.Vector3(...front[f[2]]).sub(new T.Vector3(...front[f[0]]))).z<0)f.reverse();add(...f);}
 for(const [a,b,c,d]of [[2,3,4,5],[12,13,14,15]]){add(a,b,c,1);add(a,c,d,1);}
 const frontFaces=faces.slice();const frontLabels=labels.slice();frontFaces.forEach((f,k)=>add(f[2]+count,f[1]+count,f[0]+count,frontLabels[k]));
 // These continuous unsewn chains are neck, two cuffs and hem with side vents.
 const unsewn=new Set([3,7,8,9,13,17,18]);
 for(let a=0;a<count;a++){const b=(a+1)%count;if(!unsewn.has(a)){add(a,a+count,b+count);add(a,b+count,b);}}
 // A planar pattern miter keeps the concave underarm seam inside the pattern.
 // A vertex-normal average alone folds its inner wall through that seam.
 const inset=points=>points.map((p,k)=>{const before=points[(k+points.length-1)%points.length],after=points[(k+1)%points.length],a=new T.Vector2(p[0]-before[0],p[1]-before[1]).normalize(),b=new T.Vector2(after[0]-p[0],after[1]-p[1]).normalize(),na=new T.Vector2(-a.y,a.x),nb=new T.Vector2(-b.y,b.x),sum=na.add(nb),den=sum.dot(new T.Vector2(-a.y,a.x));return[p[0]+sum.x*spec.thickness/den,p[1]+sum.y*spec.thickness/den];});
 const frontInset=inset(front),backInset=inset(back),inner=vertices.map((p,k)=>{const xy=(k<count?frontInset:backInset)[k%count];return[xy[0],xy[1],p[2]+(k<count?-spec.thickness:spec.thickness)];});
 const edgeMap=new Map();for(const f of faces)for(let k=0;k<3;k++){const a=f[k],b=f[(k+1)%3],key=a<b?a+':'+b:b+':'+a,r=edgeMap.get(key)||[];r.push([a,b]);edgeMap.set(key,r);}
 const next=new Map([...edgeMap.values()].filter(r=>r.length===1).map(r=>r[0])),loops=[];while(next.size){const start=next.keys().next().value,loop=[];let a=start;do{loop.push(a);const b=next.get(a);next.delete(a);if(b===undefined)throw Error('tunic_open_boundary');a=b;}while(a!==start);loops.push(loop);}
 const n=vertices.length,positions=[...vertices,...inner].flat(),indices=[],groups=[];
 function append(f,m){const start=indices.length;indices.push(...f);const last=groups.at(-1);if(last?.materialIndex===m)last.count+=3;else groups.push({start,count:3,materialIndex:m});}
 faces.forEach((f,k)=>append(f,labels[k]));faces.forEach(f=>append([f[2]+n,f[1]+n,f[0]+n],2));for(const loop of loops)for(let k=0;k<loop.length;k++){const a=loop[k],b=loop[(k+1)%loop.length];append([b,a,a+n],1);append([b,a+n,b+n],1);}
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);groups.forEach(g=>geometry.addGroup(g.start,g.count,g.materialIndex));geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
 const openings={neck:loops.find(l=>l.includes(18)),left_cuff:loops.find(l=>l.includes(3)),right_cuff:loops.find(l=>l.includes(13)),hem_with_side_vents:loops.find(l=>l.includes(8))};if(loops.length!==4||Object.values(openings).some(x=>!x))throw Error('tunic_four_openings_missing');
 return{geometry,openings,outerVertexCount:n,construction:{pattern:'new paired front-V / high-back panels, two shared-index cuff strips, sewn shoulder/underarm/side strips',outerTriangles:faces.length,innerTriangles:faces.length,rimWallTriangles:loops.reduce((n,l)=>n+l.length*2,0),passageRims:4,sleevesShareTorsoBoundaryIndices:true,hemIncludesTwoUnsewnSideVents:true,bodyBinding:null}};
}

export function build(T){
 if(!T?.BufferGeometry||!T?.ShapeUtils)throw Error('tunic_three_required');const group=new T.Group();group.name=spec.id;const geometries=new Set(),materials=[],parts=[],contacts=[];
 const mat=(name,color)=>{const m=new T.MeshStandardMaterial({name,color,roughness:.9,metalness:0,side:T.FrontSide});materials.push(m);return m;},sage=mat('seafoam-cotton','#91aaa1'),cream=mat('cream-sailor-cloth','#e9dfc6'),inside=mat('authored-inner-cotton','#77938c'),lilac=mat('muted-lilac-stitch','#ad99b3'),wood=mat('shell-shaped-wood','#b98c53');
 const add=(name,g,m)=>{geometries.add(g);const mesh=new T.Mesh(g,m);mesh.name=name;group.add(mesh);parts.push(mesh);return mesh;};
 const shellData=garmentPattern(T),shell=add('joined-tunic-material-shell',shellData.geometry,[sage,cream,inside]);
 function frontAt(x,y){const hits=segmentHits(T,shell.geometry,[x,y,2],[x,y,-1]);if(!hits.length)throw Error('tunic_front_anchor_missing');return new T.Vector3(...hits.sort((a,b)=>a.distance-b.distance)[0].point);}
 function relief(name,points,material,depth=.018){
  const front=points.map(([x,y])=>frontAt(x,y)),base=front.map(p=>[p.x,p.y,p.z-.009]),top=front.map(p=>[p.x,p.y,p.z+depth]),count=points.length,idx=[];const tris=T.ShapeUtils.triangulateShape(points.map(p=>new T.Vector2(...p)),[]);
  for(const t of tris){const a=t.slice();if(new T.Vector2(...points[a[1]]).sub(new T.Vector2(...points[a[0]])).cross(new T.Vector2(...points[a[2]]).sub(new T.Vector2(...points[a[0]])))<0)a.reverse();idx.push(a[0]+count,a[1]+count,a[2]+count,a[2],a[1],a[0]);}
  const signedArea=points.reduce((sum,p,i)=>{const q=points[(i+1)%count];return sum+p[0]*q[1]-q[0]*p[1];},0);for(let a=0;a<count;a++){const b=(a+1)%count;if(signedArea>0)idx.push(a,b,b+count,a,b+count,a+count);else idx.push(b,a,a+count,b,a+count,b+count);}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([...base,...top].flat(),3));g.setIndex(idx);g.computeVertexNormals();const mesh=add(name,g,material);const center=front.reduce((v,p)=>v.add(p),new T.Vector3()).divideScalar(front.length),w=frontAt(center.x,center.y).add(new T.Vector3(0,0,-.004));contacts.push({part:name,point:w.toArray(),target:shell.name,scope:'strict common-solid witness with actual tunic material'});return mesh;
 }
 // Each collar leaf is a separate padded piece attached beside the actual V.
 for(const sign of [-1,1]){const side=sign<0?'left':'right',points=[[-.295,1.515],[-.545,1.455],[-.402,1.105],[-.065,1.085],[-.145,1.225]].map(([x,y])=>[x*sign,y]);relief(side+'-sailor-collar',points,cream,.024);}
 const cylinder=new T.CylinderGeometry(1,1,1,8,1,false),sphere=new T.SphereGeometry(1,12,8);geometries.add(cylinder);geometries.add(sphere);
 function rod(name,a,b,r,material){const delta=b.clone().sub(a),p=add(name,cylinder,material);p.position.copy(a).add(b).multiplyScalar(.5);p.scale.set(r,delta.length(),r);p.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());return p;}
 function lineOn(name,points,material,r=.006,target=shell){
  const projected=points.map(([x,y])=>{let p=frontAt(x,y);if(target!==shell){const h=segmentHits(T,target.geometry,[x,y,2],[x,y,-1]).sort((a,b)=>a.distance-b.distance);if(!h.length)throw Error('tunic_relief_anchor_missing');p=new T.Vector3(...h[0].point);}return p.add(new T.Vector3(0,0,.002));});
  for(let k=0;k<projected.length-1;k++){const p=rod(name+'-'+k,projected[k],projected[k+1],r,material),mid=projected[k].clone().add(projected[k+1]).multiplyScalar(.5);let z=frontAt(mid.x,mid.y).z;if(target!==shell)z=segmentHits(T,target.geometry,[mid.x,mid.y,2],[mid.x,mid.y,-1]).sort((a,b)=>a.distance-b.distance)[0].point[2];contacts.push({part:p.name,target:target.name,point:[mid.x,mid.y,z-.0005],scope:'strict common-solid witness on attached cloth'});}
 }
 for(const sign of[-1,1]){const side=sign<0?'left':'right',leaf=parts.find(p=>p.name===side+'-sailor-collar');for(const offset of[0,.020])lineOn(side+'-collar-line-'+offset,[[-.43+offset,1.43],[-.34+offset,1.17],[-.16+offset,1.155]].map(([x,y])=>[x*sign,y]),lilac,.004,leaf);}
 for(const sign of[-1,1]){const x=sign*.31,name=sign<0?'left-pocket-patch':'right-pocket-patch';const patch=relief(name,[[x-.135,.59],[x-.13,.31],[x-.09,.275],[x+.10,.275],[x+.13,.31],[x+.135,.59]],sage,.018);relief(name+'-cream-band',[[x-.13,.59],[x-.13,.545],[x+.13,.545],[x+.13,.59]],cream,.029);const p=frontAt(x,.51),button=add(name+'-wood-toggle',sphere,wood);button.position.copy(p).add(new T.Vector3(0,0,.045));button.scale.set(.035,.045,.045);contacts.push({part:button.name,target:patch.name,point:[x,.51,p.z+.009],scope:'strict common-solid witness with pocket patch'});}
 // The cream tie has two authored tails and a joined wooden central knot.
 for(const sign of[-1,1])relief((sign<0?'left':'right')+'-tie-tail',[[.006,.99],[.12,.87],[.07,.74],[-.025,.81]].map(([x,y])=>[x*sign,y]),cream,.030);
 const knotPoint=frontAt(0,.985),knot=add('wood-shell-knot',sphere,wood);knot.position.copy(knotPoint).add(new T.Vector3(0,0,.039));knot.scale.set(.043,.044,.047);contacts.push({part:knot.name,target:shell.name,point:[0,.985,knotPoint.z-.003],scope:'strict common-solid witness with front material'});
 const wave=parts.find(p=>p.name==='right-pocket-patch');lineOn('one-pocket-wave',Array.from({length:13},(_,i)=>[.20+i*.018,.36+Math.sin(i*Math.PI/3)*.017]),lilac,.006,wave);
 group.updateMatrixWorld(true);
 const garmentRims={};for(const[name,loop]of Object.entries(shellData.openings)){const vertex=loop[0],p=new T.Vector3().fromBufferAttribute(shell.geometry.attributes.position,vertex),n=new T.Vector3().fromBufferAttribute(shell.geometry.attributes.normal,vertex).normalize();let up=new T.Vector3(0,1,0).addScaledVector(n,-n.y);if(up.lengthSq()<.001)up=new T.Vector3(0,0,1).addScaledVector(n,-n.z);up.normalize();const x=up.clone().cross(n).normalize();up.copy(n).cross(x).normalize();garmentRims[name]={space:'garment_local',surfaceMesh:shell.name,outerVertex:vertex,actualSurfacePosition:p.toArray(),actualSurfaceNormal:n.toArray(),localFrame:new T.Matrix4().makeBasis(x,up,n).setPosition(p).toArray(),boundaryOuterVertexIndices:loop,bodyBinding:null,anatomicalSocket:false};}
 const segments=[];for(const[x,z]of[[0,0],[.055,0],[-.055,0],[0,.055],[0,-.055]])segments.push({opening:'neck',from:[x,1.7,z],to:[x,-.15,z]});for(const[x,z]of[[0,0],[.13,0],[-.13,0]])segments.push({opening:'hem_with_side_vents',from:[x,-.15,z],to:[x,1.7,z]});
 for(const side of[-1,1])for(const offset of[-.035,0,.035])segments.push({opening:side<0?'left_cuff':'right_cuff',from:[side*1.22,.77+offset,0],to:[side*.67,1.03+offset,0]});
 for(const side of[-1,1])for(const z of[-.055,0,.055])segments.push({opening:side<0?'left_side_vent':'right_side_vent',from:[side*.75,.08,z],to:[side*.40,.08,z]});
 const passageSegments=segments.map(s=>({...s,hits:parts.flatMap(p=>{const inv=p.matrixWorld.clone().invert(),a=new T.Vector3(...s.from).applyMatrix4(inv),b=new T.Vector3(...s.to).applyMatrix4(inv);return segmentHits(T,p.geometry,a.toArray(),b.toArray()).map(h=>({part:p.name,...h}));})}));
 const box=new T.Box3().setFromObject(group,true),bounds={min:box.min.toArray(),max:box.max.toArray(),size:box.getSize(new T.Vector3()).toArray()},budget={meshes:parts.length,geometries:geometries.size,materials:materials.length,textures:0,lights:0,triangles:parts.reduce((n,p)=>n+p.geometry.index.count/3,0)};let disposed=false;
 function inspect(){return{model_id:spec.id,sourceSHA:spec.sourceSHA,topology:inspectTopology(T,shell.geometry),construction:shellData.construction,budget,bounds,garmentRims,passages:{count:passageSegments.length,blocked:passageSegments.filter(s=>s.hits.length).length,segments:passageSegments},contactWitnesses:contacts,bodyBinding:null,authoredGarmentDepthNotBodyDepth:true,wearing:false,rig:false,normalGamePlacement:false,ownershipUnlockSave:false};}
 return{group,shell,parts,resources:{geometries,materials,textures:[]},garmentRims,passages:passageSegments,contactWitnesses:contacts,bounds,budget,construction:shellData.construction,inspect,resolveRim(name){if(disposed)throw Error('tunic_disposed');if(!garmentRims[name])throw Error('tunic_unknown_rim');return garmentRims[name];},dispose(){if(disposed)return false;disposed=true;for(const g of geometries)g.dispose();for(const m of materials)m.dispose();group.clear();return true;}};
}

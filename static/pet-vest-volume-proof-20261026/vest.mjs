/* Garment-local volume prerequisite. No character body, fitting, rig or save integration. */
export const SPEC=Object.freeze({id:'komorebi-vest-volume-socket-prerequisite-v1',geometryRevision:2,functionalFastenerVerified:false,unit:'wardrobe:fit-prerequisite:komorebi-vest:volume-socket-interface:v1',sourceAsset:'prepared_clothing_01_v1',sourceSHA:'9f47ad550c0925db40f04f1be0071dff87c54431e393d44f6a5c98fd80d08bba',bodyReferences:Object.freeze({milneBaby:'e7024c2baabfb2fc9fa75620df6015cf0de1c6c645e4ce099e02f9d657033e21',milneAdult:'35b04839b39e50839a6a1734e8919c6d499ececf6b0aba9b766788e399deb404'}),unitScale:'authored garment-local game units, not calibrated body measurements',unseenBackAndDepth:'technical inference from front source only',bodyBinding:null,anatomicalSockets:false,calibrationApproved:false,rig:false,wearingFit:false,allGrowthFit:false,characterBody360:false,normalGame:false,unlock:false,save:false,newDesign:false,newRaw:false});
const LIMIT=Math.PI-.055,HEIGHT=1.05,THICKNESS=.024;
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const top=t=>.97-.46*smooth(.65,1,Math.abs(t)/Math.PI);
function dimensions(v){return[.47+.10*(1-v)+.03*Math.sin(Math.PI*v),.30+.045*(1-v)];}
function point(T,u,v,inner=false,offset=0){const [rx,rz]=dimensions(v),d=(inner?-THICKNESS:0)+offset;return new T.Vector3((rx+d)*Math.sin(u),v*HEIGHT,-(rz+d)*Math.cos(u));}
function contour(){const p=[];for(let i=0;i<=48;i++)p.push([-LIMIT+2*LIMIT*i/48,0]);for(let i=48;i>=0;i--){const u=-LIMIT+2*LIMIT*i/48;p.push([u,top(u)]);}return p;}
function holes(){return[-1,1].map(sign=>Array.from({length:40},(_,i)=>{const a=-2*Math.PI*i/40;return[sign*Math.PI/2+.34*Math.cos(a),.61+.23*Math.sin(a)];}));}
function improveFaces(points,faces){
 const orient=(a,b,c)=>{const p=points[a],q=points[b],r=points[c];return(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);};
 const canonical=f=>orient(...f)>0?f:[f[0],f[2],f[1]];
 const quality=f=>{const[a,b,c]=f.map(i=>points[i]),area=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])),sum=(a[0]-b[0])**2+(a[1]-b[1])**2+(b[0]-c[0])**2+(b[1]-c[1])**2+(c[0]-a[0])**2+(c[1]-a[1])**2;return area/sum;};
 for(let i=0;i<faces.length;i++)faces[i]=canonical(faces[i]);
 let flips=0;
 for(let pass=0;pass<3000;pass++){const edges=new Map();let changed=false;for(let i=0;i<faces.length;i++){const f=faces[i];for(let j=0;j<3;j++){const a=f[j],b=f[(j+1)%3],c=f[(j+2)%3],k=[Math.min(a,b),Math.max(a,b)].join(',');if(!edges.has(k))edges.set(k,[]);edges.get(k).push({face:i,a,b,c});}}
  for(const pair of edges.values()){if(pair.length!==2)continue;const[a,b]=[pair[0].a,pair[0].b],[c,d]=[pair[0].c,pair[1].c];if(c===d||orient(a,b,c)*orient(a,b,d)>=-1e-14||orient(c,d,a)*orient(c,d,b)>=-1e-14)continue;const first=canonical([c,d,a]),second=canonical([d,c,b]);if(Math.min(quality(first),quality(second))>Math.min(quality(faces[pair[0].face]),quality(faces[pair[1].face]))+1e-7){faces[pair[0].face]=first;faces[pair[1].face]=second;flips++;changed=true;break;}}
  if(!changed)break;
 }
 return flips;
}
function cloth(T){
 const outline=contour(),voids=holes(),base=[...outline,...voids.flat()],faces=T.ShapeUtils.triangulateShape(outline.map(p=>new T.Vector2(...p)),voids.map(h=>h.map(p=>new T.Vector2(...p)))),uv=[],map=new Map(),tris=[];
 const qualityFlips=improveFaces(base,faces);
 const get=p=>{const k=p.map(x=>Math.round(x*1e10)).join(',');if(!map.has(k)){map.set(k,uv.length);uv.push(p);}return map.get(k);};
 const mid=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
 function subdiv(a,b,c,n){if(n){const ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);subdiv(a,ab,ca,n-1);subdiv(ab,b,bc,n-1);subdiv(ca,bc,c,n-1);subdiv(ab,bc,ca,n-1);}else tris.push([get(a),get(b),get(c)]);}
 for(const f of faces)subdiv(base[f[0]],base[f[1]],base[f[2]],3);
 const count=uv.length,positions=[],tex=[],outer=[],inner=[],walls=[];
 for(const isInner of[false,true])for(const p of uv){const q=point(T,...p,isInner);positions.push(...q.toArray());tex.push((p[0]+LIMIT)/(2*LIMIT)*5,p[1]*7);}
 const read=i=>new T.Vector3().fromArray(positions,i*3);
 for(const tri of tris){let[a,b,c]=tri;const A=uv[a],B=uv[b],C=uv[c],signed=(B[0]-A[0])*(C[1]-A[1])-(B[1]-A[1])*(C[0]-A[0]);if(signed>0)[b,c]=[c,b];outer.push(a,b,c);inner.push(c+count,b+count,a+count);}
 const edges=new Map();for(let i=0;i<outer.length;i+=3)for(const[a,b]of[[outer[i],outer[i+1]],[outer[i+1],outer[i+2]],[outer[i+2],outer[i]]]){const key=[Math.min(a,b),Math.max(a,b)].join(',');const x=edges.get(key);edges.set(key,x?{...x,n:x.n+1}:{a,b,n:1});}
 for(const e of edges.values())if(e.n===1)walls.push(e.b,e.a,e.a+count,e.b,e.a+count,e.b+count);
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(tex,2));g.setIndex([...outer,...inner,...walls]);g.addGroup(0,outer.length,0);g.addGroup(outer.length,inner.length,1);g.addGroup(outer.length+inner.length,walls.length,2);g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
 return{geometry:g,UV:uv,outerVertexCount:count,topology:{outerTriangles:outer.length/3,innerTriangles:inner.length/3,edgeWallTriangles:walls.length/3,boundaryEdgesCapped:walls.length/6,thickness:THICKNESS,UVqualityEdgeFlips:qualityFlips}};
}
function texture(T){const data=new Uint8Array(128*128*4);for(let y=0;y<128;y++)for(let x=0;x<128;x++){const i=(y*128+x)*4,n=243+((x*17+y*29)%7)-((x%8===0||y%8===0)?7:0);data[i]=data[i+1]=data[i+2]=n;data[i+3]=255;}const t=new T.DataTexture(data,128,128,T.RGBAFormat);t.name='shared-code-native-soft-weave';t.colorSpace=T.SRGBColorSpace;t.wrapS=t.wrapT=T.RepeatWrapping;t.magFilter=T.LinearFilter;t.minFilter=T.LinearFilter;t.generateMipmaps=false;t.needsUpdate=true;return t;}
export function build(T){
 if(!T?.BufferGeometry||!T?.ShapeUtils)throw Error('three_required');
 const group=new T.Group();group.name=SPEC.id;const geos=[],mats=[],tex=texture(T),parts=[],sharedMap=tex;
 const mat=(color,roughness=.78,metalness=0)=>{const m=new T.MeshStandardMaterial({color,roughness,metalness,side:T.FrontSide,map:metalness?null:sharedMap});mats.push(m);return m;};
 const cream=mat('#f0e6cc'),sage=mat('#a7bba0'),mint=mat('#bdd2b1'),gold=mat('#bf9a5a',.42,.34),leaf=mat('#8dab82');
 function add(id,g,m){geos.push(g);const o=new T.Mesh(g,m);o.name=id;o.castShadow=true;o.receiveShadow=true;group.add(o);parts.push(o);return o;}
 const shell=cloth(T),body=add('thick_cloth_shell',shell.geometry,[cream,sage,mint]);
 function tube(id,points,radius,segments,material,closed=true){const curve=new T.CatmullRomCurve3(points,closed,'centripetal');return add(id,new T.TubeGeometry(curve,segments,radius,6,closed),material);}
 const loops=[contour(),...holes()];
 loops.forEach((loop,i)=>{tube('mint_bound_opening_'+i,loop.map(p=>point(T,...p,false,.002)),.014,i?80:144,mint);tube('gold_piping_'+i,loop.map(p=>point(T,...p,false,.017)),.0035,i?80:144,gold);});
 const leafShape=new T.Shape();leafShape.moveTo(0,0);leafShape.quadraticCurveTo(-.075,.13,.075,.16);leafShape.quadraticCurveTo(.19,.075,0,0);
 const leafPart=add('leaf_fastener',new T.ExtrudeGeometry(leafShape,{depth:.017,bevelEnabled:true,bevelSize:.004,bevelThickness:.004,bevelSegments:2,steps:1,curveSegments:12}),leaf);leafPart.position.set(-.045,.38,.354);leafPart.rotation.z=-.38;
 leafPart.updateMatrixWorld(true);
 function frontSurface(mesh,x,y){mesh.updateMatrixWorld(true);const hit=new T.Raycaster(new T.Vector3(x,y,2),new T.Vector3(0,0,-1),.001,4).intersectObject(mesh,false).find(h=>h.face&&h.face.normal.z>.5);if(!hit)throw Error('fastener_surface_anchor_missing');const normal=hit.face.normal.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize();return{point:hit.point.clone(),normal,faceIndex:hit.faceIndex};}
 const embroideryAnchors=[[-.027,.407],[.001,.448],[.033,.494]].map(([x,y])=>frontSurface(leafPart,x,y));
 const stitch=tube('leaf_vein',embroideryAnchors.map(a=>a.point.clone().addScaledVector(a.normal,.001)),.0035,12,gold,false);
 const loop=add('fastener_loop',new T.TorusGeometry(.021,.007,6,24),mint);loop.position.set(.083,.425,.363);
 const fastenerMounts=[];
 for(const[y,id]of[[.413,'fastener_mount_lower'],[.437,'fastener_mount_upper']]){const surface=frontSurface(body,.118,y),start=surface.point.clone().addScaledVector(surface.normal,-.004),end=new T.Vector3(.0998,y,.363),axis=end.clone().sub(start),part=add(id,new T.CylinderGeometry(.007,.007,axis.length(),8,1,false),mint);part.position.copy(start).add(end).multiplyScalar(.5);part.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),axis.normalize());fastenerMounts.push({id,clothSurfaceMesh:body.name,clothFaceIndex:surface.faceIndex,clothSurfacePosition:surface.point.toArray(),clothSurfaceNormal:surface.normal.toArray(),closedTabStart:start.toArray(),loopVolumeEnd:end.toArray(),bodyBinding:null,functionalFastenerVerified:false});}

 group.updateMatrixWorld(true);
 const socketRequests={left_shoulder:[-1.10,.91],right_shoulder:[1.10,.91],back_neck:[0,.96],front_fastener:[LIMIT-.11,.39],back_hem:[0,.08]};
 const sockets={};
 for(const[name,target]of Object.entries(socketRequests)){let best=0,score=Infinity;for(let i=0;i<shell.UV.length;i++){const[u,v]=shell.UV[i],d=(u-target[0])**2+(v-target[1])**2;if(d<score){score=d;best=i;}}
  const p=new T.Vector3().fromBufferAttribute(shell.geometry.attributes.position,best),z=new T.Vector3().fromBufferAttribute(shell.geometry.attributes.normal,best).normalize(),up=new T.Vector3(0,1,0),y=up.addScaledVector(z,-up.dot(z));if(y.lengthSq()<.001)y.set(0,0,1).addScaledVector(z,-z.z);y.normalize();const x=y.clone().cross(z).normalize();y.copy(z).cross(x).normalize();const matrix=new T.Matrix4().makeBasis(x,y,z).setPosition(p);
  sockets[name]=Object.freeze({name,space:'garment_local',surfaceMesh:body.name,outerSurfaceVertex:best,actualSurfacePosition:Object.freeze(p.toArray()),actualSurfaceNormal:Object.freeze(z.toArray()),localMatrix:Object.freeze(matrix.toArray()),UV:Object.freeze(shell.UV[best].slice()),requestedUV:Object.freeze(target.slice()),UVdistance:Math.sqrt(score),bodySourceSHA:null,bodyBinding:null,anatomicalCalibration:false});
 }
 const box=new T.Box3().setFromObject(group),bounds={min:box.min.toArray(),max:box.max.toArray(),size:box.getSize(new T.Vector3()).toArray(),center:box.getCenter(new T.Vector3()).toArray()},triangles=parts.reduce((n,p)=>n+(p.geometry.index?p.geometry.index.count:p.geometry.attributes.position.count)/3,0);
 const budget=Object.freeze({parts:parts.length,triangles,geometries:geos.length,materials:mats.length,textures:1,textureSide:128});let dead=false;
 return{group,shell:body,parts,geometries:geos,materials:mats,textures:[tex],bounds,budget,topology:shell.topology,fastenerMounts,embroiderySurfaceAnchors:embroideryAnchors.map(a=>({point:a.point.toArray(),normal:a.normal.toArray(),faceIndex:a.faceIndex})),outerVertexCount:shell.outerVertexCount,sockets:Object.freeze(sockets),spec:SPEC,resolveSocket(name){if(dead)throw Error('disposed');if(!sockets[name])throw Error('unknown_garment_socket');return sockets[name];},dispose(){if(dead)return false;dead=true;group.removeFromParent();geos.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());tex.dispose();group.clear();return true;},get disposed(){return dead;}};
}
export function fitCamera(T,bounds,aspect,view){
 if(!Number.isFinite(aspect)||aspect<=0||![...bounds.min,...bounds.max,view.distance,view.yaw,view.pitch,view.roll].every(Number.isFinite))throw Error('invalid_framing');
 const center=new T.Vector3(...bounds.center),radius=new T.Vector3(...bounds.size).length()/2,verticalFov=46,halfV=verticalFov*Math.PI/360,halfH=Math.atan(Math.tan(halfV)*aspect),minimumDistance=radius/Math.sin(Math.min(halfV,halfH))*1.10;
 return{requestedDistance:view.distance,minimumDistance,actualDistance:Math.max(view.distance,minimumDistance),verticalFov,aspect,center:center.toArray(),scope:'standalone authored garment bounds only; not wearing/body fit'};
}

export function validCaptureReceipt(v){return !!v&&v.saved===true&&typeof v.PNG_sha256==='string'&&/^[0-9a-f]{64}$/.test(v.PNG_sha256)&&Number.isInteger(v.width)&&Number.isInteger(v.height)&&v.width>0&&v.height>0&&v.width<=4096&&v.height<=4096;}

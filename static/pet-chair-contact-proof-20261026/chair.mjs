/* Cloud reading chair: versioned authored volume and chair-side surface interfaces.
 * Raw illustration is a style reference only. Fourth foot/rear/underside are authored
 * geometry hypotheses, not recovered unseen source art or a calibrated seated body. */
export const spec=Object.freeze({
 id:'cloud-reading-chair-contact-v1',revision:1,units:'world-units',origin:'floor-center-y0',
 reference:{assetId:'prepared_decoration_01b_reading_chair_v1',sha256:'81cfce2470abb2e6f55ce5d9d251ec9404e9796ce4cc9db8644b3036002956e0'},
 palette:{cream:'#eee2cb',mint:'#a8cdb4',lavender:'#baa6ce',gold:'#c9a46a'},
 bodyBinding:null,authoredFourthFootAndRear:true,
 supportedScope:'one solid-component chair model and chair-side surface basis; no seated body binding, physical load, rig, normal placement, unlock or save',
});
const rad=d=>d*Math.PI/180;
function finite(v){return typeof v==='number'&&Number.isFinite(v);}
export function build(T,{document:doc=null}={}){
 if(!T?.Group||!T?.Raycaster)throw Error('chair_three_required');
 const group=new T.Group();group.name=spec.id;group.userData={assetId:spec.id,candidateOnly:true,bodyBinding:null};
 const geometries=new Set(),materials=new Set(),textures=new Set(),byId=new Map(),parts=[];let disposed=false;
 function finish(g){
  g.computeVertexNormals();const p=g.attributes.position,n=g.attributes.normal,pool=new Map();
  for(let i=0;i<p.count;i++){const k=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e6)).join(':');let v=pool.get(k);if(!v){v=new T.Vector3();pool.set(k,v);}v.add(new T.Vector3(n.getX(i),n.getY(i),n.getZ(i)));}
  for(let i=0;i<p.count;i++){const k=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e6)).join(':'),v=pool.get(k);if(v.lengthSq()<1e-15)v.set(0,1,0);v.normalize();n.setXYZ(i,v.x,v.y,v.z);}
  g.computeBoundingBox();g.computeBoundingSphere();geometries.add(g);return g;
 }
 const sphere=finish(new T.SphereGeometry(1,32,20));
 let weave=null;
 if(doc?.createElement){
  const c=doc.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');
  if(x){x.fillStyle='#faf9f5';x.fillRect(0,0,64,64);for(let i=0;i<64;i+=4){x.fillStyle='rgba(119,112,99,.045)';x.fillRect(i,0,1,64);x.fillStyle='rgba(255,255,255,.45)';x.fillRect(0,i,64,1);}weave=new T.CanvasTexture(c);weave.wrapS=weave.wrapT=T.RepeatWrapping;weave.repeat.set(4,4);weave.colorSpace=T.SRGBColorSpace;textures.add(weave);}
 }
 function mat(color,extra={}){const m=new T.MeshPhysicalMaterial({color,roughness:.88,metalness:.015,clearcoat:.025,map:weave,...extra});materials.add(m);return m;}
 const cream=mat(spec.palette.cream),mint=mat(spec.palette.mint),lilac=mat(spec.palette.lavender),gold=mat(spec.palette.gold,{map:null,roughness:.52,metalness:.25,clearcoat:.08});
 function piece(id,g,m,pos=[0,0,0],scale=[1,1,1],rot=[0,0,0],role='upholstery'){
  const mesh=new T.Mesh(g,m);mesh.name=spec.id+'/'+id;mesh.position.fromArray(pos);mesh.scale.fromArray(scale);mesh.rotation.set(...rot);mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData={partId:id,role,solidComponent:true};group.add(mesh);byId.set(id,mesh);parts.push({id,role,mesh});return mesh;
 }
 function ball(id,m,pos,scale,rot,role){return piece(id,sphere,m,pos,scale,rot,role);}
 function pillowGeometry(tuft=false){
  const g=new T.SphereGeometry(1,40,24),p=g.attributes.position;
  const signed=(n,e)=>Math.sign(n)*Math.pow(Math.abs(n),e);
  for(let i=0;i<p.count;i++){
   let x=p.getX(i),y=p.getY(i),z=p.getZ(i);x=signed(x,.56);z=signed(z,.56);y=signed(y,.59);
   if(tuft&&y>.05){
    const dip=.27*Math.exp(-((x/.22)**2+(z/.22)**2));
    const stitch=.045*Math.exp(-((x/.048)**2))*(1-z*z)+.035*Math.exp(-((z/.05)**2))*(1-x*x);
    y-=Math.max(0,y)*(dip+stitch);
   }p.setXYZ(i,x,y,z);
  }return finish(g);
 }
 const seatGeo=pillowGeometry(true),leafGeo=(()=>{const g=new T.SphereGeometry(1,32,20),p=g.attributes.position;for(let i=0;i<p.count;i++){const ox=p.getX(i),oy=p.getY(i),z=p.getZ(i),x=Math.sign(ox)*Math.pow(Math.abs(ox),.84)*(.90-.13*z),y=Math.sign(oy)*Math.pow(Math.abs(oy),.86)-.17*Math.max(0,z)**2;p.setXYZ(i,x,y,z);}return finish(g);})();
 const supportConnections=[];
 ball('foundation',cream,[0,.335,.015],[.70,.165,.565],[0,0,0],'foundation');
 const seat=piece('seat-cushion',seatGeo,lilac,[0,.545,.07],[.555,.118,.465],[0,0,0],'seat');
 for(const side of[-1,1]){
  ball('side-support-'+side,cream,[side*.595,.445,-.005],[.17,.245,.425],[0,0,side*-.10],'side-support');
  piece('arm-'+(side<0?'left':'right'),leafGeo,mint,[side*.635,.775,.04],[.168,.165,.465],[rad(-5),0,side*rad(-9)],'arm');
 }
 // Closed scalloped shell. Extrusion has a real rear, rim, thickness and underside.
 const shape=new T.Shape();shape.moveTo(-.66,.41);shape.lineTo(.66,.41);
 shape.bezierCurveTo(.70,.61,.72,.90,.64,1.10);
 shape.bezierCurveTo(.60,1.31,.38,1.39,.23,1.22);
 shape.bezierCurveTo(.15,1.59,-.15,1.59,-.23,1.22);
 shape.bezierCurveTo(-.38,1.39,-.60,1.31,-.64,1.10);
 shape.bezierCurveTo(-.72,.90,-.70,.61,-.66,.41);
 const backGeo=finish(new T.ExtrudeGeometry(shape,{depth:.18,steps:1,bevelEnabled:true,bevelSegments:5,bevelSize:.035,bevelThickness:.035,curveSegments:14}));
 const back=piece('back-shell',backGeo,cream,[0,0,-.55],[1,1,1],[0,0,0],'back-shell');
 const backCenter=ball('back-center-padding',cream,[0,.985,-.335],[.278,.367,.093],[rad(-3),0,0],'back');
 ball('back-left-padding',cream,[-.355,.877,-.327],[.270,.282,.09],[rad(-4),0,rad(-9)],'back');
 ball('back-right-padding',cream,[.355,.877,-.327],[.270,.282,.09],[rad(-4),0,rad(9)],'back');
 // Authored four-point support: the illustration shows only three feet.
 const footGeo=finish(new T.LatheGeometry([[0,0],[.095,0],[.123,.018],[.132,.046],[.125,.084],[.095,.136],[.071,.177],[.073,.205],[0,.205]].map(p=>new T.Vector2(...p)),32));
 for(const [id,x,z]of[['foot-left-front',-.535,.405],['foot-right-front',.535,.405],['foot-left-back',-.535,-.405],['foot-right-back',.535,-.405]]){
  piece(id,footGeo,cream,[x,0,z],[1,1,1],[0,0,0],'foot');
  group.updateMatrixWorld(true);const foundation=byId.get('foundation'),r=new T.Raycaster(new T.Vector3(x-Math.sign(x)*.12,-1,z-Math.sign(z)*.10),new T.Vector3(0,1,0)),hit=r.intersectObject(foundation,false)[0];if(!hit)throw Error('chair_leg_foundation_surface_missing');
  const outward=hit.face.normal.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(foundation.matrixWorld)).normalize(),end=hit.point.clone().addScaledVector(outward,-.045),start=new T.Vector3(x,.18,z),delta=end.clone().sub(start),neck=piece(id+'-neck',finish(new T.CylinderGeometry(.075,.058,delta.length(),24,1,false)),cream,start.clone().add(end).multiplyScalar(.5).toArray(),[1,1,1],[0,0,0],'support-neck');neck.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.clone().normalize());
  supportConnections.push({footId:id,neckId:id+'-neck',footInteriorPoint:start.toArray(),foundationSurfacePoint:hit.point.toArray(),foundationSurfaceTriangleIndex:hit.faceIndex,foundationSurfaceOutwardNormal:outward.toArray(),foundationInteriorEnd:end.toArray(),authoredEmbedDistance:.045,geometryOnlyNotPhysicalLoad:true});
  const ring=finish(new T.TorusGeometry(.074,.008,8,32));piece(id+'-collar',ring,gold,[x,.183,z],[1,1,1],[Math.PI/2,0,0],'trim');
 }
 function tube(id,points,radius=.009,closed=false,segmentCount=null){
  const clean=[];for(const p of points){const v=new T.Vector3(...p);if(!clean.length||v.distanceTo(clean.at(-1))>1e-6)clean.push(v);}if(closed&&clean.length>2&&clean[0].distanceTo(clean.at(-1))<1e-6)clean.pop();if(clean.length<2)throw Error('chair_trim_path_too_short');
  const curve=new T.CatmullRomCurve3(clean,closed,'centripetal');
  const segments=segmentCount??Math.max(20,points.length*3),radial=6,g=new T.TubeGeometry(curve,segments,radius,radial,closed);
  if(!closed){const positions=Array.from(g.attributes.position.array),indices=Array.from(g.index.array),first=curve.getPointAt(0),last=curve.getPointAt(1),start=positions.length/3;positions.push(...first.toArray(),...last.toArray());
   for(let i=0;i<radial;i++){indices.push(start,i,i+1);const a=segments*(radial+1)+i;indices.push(start+1,a+1,a);}g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.deleteAttribute('normal');g.deleteAttribute('uv');}
  return piece(id,finish(g),gold,[0,0,0],[1,1,1],[0,0,0],'trim');
 }
 // Seat piping crosses the cushion equator and overlaps its actual closed surface.
 const seatPipe=[];for(let i=0;i<48;i++){const a=i*Math.PI*2/48;seatPipe.push([.553*Math.sign(Math.cos(a))*Math.pow(Math.abs(Math.cos(a)),.56),.545,.07+.463*Math.sign(Math.sin(a))*Math.pow(Math.abs(Math.sin(a)),.56)]);}tube('seat-piping',seatPipe,.008,true);
 group.updateMatrixWorld(true);
 // Trim follows ray hits on the shell. Only a radius-overlap offset is added.
 const ray=new T.Raycaster(),backPipe=[];let outline=shape.getSpacedPoints(80).slice(0,-1);
 // Equal arc spacing and two small corner-cutting passes round only the gold seam.
 // Dense uneven source outline sampling made the old pipe fold at bottom corners
 // and scallop notches. The cream shell is unchanged; all seam points still ray-hit it.
 for(let pass=0;pass<2;pass++){const rounded=[];for(let i=0;i<outline.length;i++){const a=outline[i],b=outline[(i+1)%outline.length];rounded.push(a.clone().lerp(b,.25),a.clone().lerp(b,.75));}outline=rounded;}
 for(const p of outline){const x=p.x*.972,y=.94+(p.y-.94)*.974;ray.set(new T.Vector3(x,y,2),new T.Vector3(0,0,-1));const h=ray.intersectObject(back,false)[0];if(h)backPipe.push([h.point.x,h.point.y,h.point.z+.004]);}
 if(backPipe.length>30)tube('back-scallop-piping',backPipe,.009,true,640);
 for(const side of[-1,1]){
  const m=byId.get('arm-'+(side<0?'left':'right')),pts=[];
  for(let i=0;i<=18;i++){const z=-.34+i*.74/18;ray.set(new T.Vector3(side*.635,2,z),new T.Vector3(0,-1,0));const h=ray.intersectObject(m,false)[0];if(h)pts.push([h.point.x,h.point.y+.004,h.point.z]);}
  if(pts.length>3)tube('arm-vein-'+side,pts,.007);
  const seam=[];for(let i=0;i<=20;i++){const t=i/20,z=-.28+t*.63,x=side*.635+side*.095*Math.sin(t*Math.PI);ray.set(new T.Vector3(x,2,z),new T.Vector3(0,-1,0));const h=ray.intersectObject(m,false)[0];if(h)seam.push([h.point.x,h.point.y+.003,h.point.z]);}if(seam.length>5)tube('arm-leaf-seam-'+side,seam,.007);
 }
 // Small raised leaf motif on the front padding; this is authored, not raster projection.
 const motifStem=[];for(let i=0;i<=12;i++){const y=.83+i*.39/12,x=.105*Math.sin(i/12*Math.PI);ray.set(new T.Vector3(x,y,2),new T.Vector3(0,0,-1));const h=ray.intersectObjects([backCenter,back],false)[0];if(h)motifStem.push([h.point.x,h.point.y,h.point.z+.003]);}tube('back-leaf-stem',motifStem,.007);
 ball('back-leaf-mint',mint,[.050,1.085,-.233],[.047,.088,.015],[0,0,rad(35)],'applique');
 ball('back-leaf-lilac',lilac,[.136,1.188,-.239],[.050,.080,.015],[0,0,rad(-25)],'applique');
 group.updateMatrixWorld(true);
 function hitBasis(id,origin,direction){
  const mesh=byId.get(id);ray.set(new T.Vector3(...origin),new T.Vector3(...direction));const hit=ray.intersectObject(mesh,false)[0];if(!hit)throw Error('chair_surface_missing_'+id);
  const g=mesh.geometry,ind=g.index?.array,p=g.attributes.position,face=hit.faceIndex,ids=ind?[ind[face*3],ind[face*3+1],ind[face*3+2]]:[face*3,face*3+1,face*3+2];
  const tri=ids.map(i=>new T.Vector3().fromBufferAttribute(p,i)),local=mesh.worldToLocal(hit.point.clone()),bary=new T.Vector3();
  T.Triangle.getBarycoord(local,...tri,bary);
  const normal=hit.face.normal.clone().applyMatrix3(new T.Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize();
  return{partId:id,triangleIndex:face,triangleVertexIndices:ids,triangleMeshLocal:tri.map(v=>v.toArray()),barycentric:bary.toArray(),pointChairLocal:hit.point.toArray(),normalChairLocal:normal.toArray(),basis:'actual indexed triangle ray hit, chair-side interface only',bodyBinding:null};
 }
 const contacts={
  seatCenter:hitBasis('seat-cushion',[0,2,.07],[0,-1,0]),
  seatLeft:hitBasis('seat-cushion',[-.28,2,.07],[0,-1,0]),
  seatRight:hitBasis('seat-cushion',[.28,2,.07],[0,-1,0]),
  backSupport:hitBasis('back-center-padding',[0,1.04,2],[0,0,-1]),
  armLeft:hitBasis('arm-left',[-.635,2,.04],[0,-1,0]),
  armRight:hitBasis('arm-right',[.635,2,.04],[0,-1,0]),
 };
 const measured=new T.Box3().setFromObject(group),bounds={min:measured.min.toArray(),max:measured.max.toArray(),size:measured.getSize(new T.Vector3()).toArray()};
 const soleIds=['foot-left-front','foot-right-front','foot-left-back','foot-right-back'];
 const footContacts=soleIds.map(id=>hitBasis(id,[byId.get(id).position.x+.02,-.2,byId.get(id).position.z+.02],[0,1,0]));
 const triangleCount=parts.reduce((n,p)=>n+(p.mesh.geometry.index?.count??p.mesh.geometry.attributes.position.count)/3,0);
 const footprint={type:'conservative-circle',radius:0,clearance:.08,contactPartIds:soleIds};
 // Use both actual horizontal extrema; the radius encloses every corner of this model.
 footprint.radius=Math.hypot(Math.max(Math.abs(bounds.min[0]),Math.abs(bounds.max[0])),Math.max(Math.abs(bounds.min[2]),Math.abs(bounds.max[2])));
 const budget={components:parts.length,geometries:geometries.size,materials:materials.size,textures:textures.size,triangles:triangleCount,lights:0,geometryVertices:[...geometries].reduce((n,g)=>n+g.attributes.position.count,0)};
 function inspect(){
  let invalidPositions=0,invalidNormals=0,minNormal=Infinity,maxNormal=0;
  for(const g of geometries){const p=g.attributes.position,n=g.attributes.normal;for(let i=0;i<p.count;i++){if(![p.getX(i),p.getY(i),p.getZ(i)].every(finite))invalidPositions++;const len=Math.hypot(n.getX(i),n.getY(i),n.getZ(i));if(!finite(len))invalidNormals++;minNormal=Math.min(minNormal,len);maxNormal=Math.max(maxNormal,len);}}
  return{invalidPositions,invalidNormals,minNormal,maxNormal,bounds,budget,chairSideContacts:contacts,footContacts,supportConnections,bodyBinding:null,authoredFourthFootAndRear:true,physicalLoadFriction:false,seatedFit:false,character360:false,normalGamePlacement:false,unlockOrSave:false};
 }
 return{spec,group,parts,byId,bounds,footprint,contacts,footContacts,supportConnections,budget,inspect,resources:{geometries,materials,textures},get disposed(){return disposed;},
  dispose(){if(disposed)return;disposed=true;if(group.parent)group.parent.remove(group);for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();group.clear();}
 };
}

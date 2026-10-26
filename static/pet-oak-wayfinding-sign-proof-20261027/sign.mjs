/* New isolated village-library candidate. The current game's scene and ownership stay external. */
export const spec=Object.freeze({id:'oak-wayfinding-sign-v1',unit:'village:asset-library:oak-wayfinding-sign:v1',revision:1,category:'signs_and_wayfinding',style:'atelier_market',season:'all_season',units:'world-units',boardWidth:1.30,boardHeight:.74,boardDepth:.095,stoneHeight:.09,postBottom:.075,postTop:1.13,height:1.83,bodyBinding:null,normalPlacement:false,ownershipUnlockSave:false,scope:'one closed carved oak wayfinding candidate; bounded sample placement, not general collision adoption or interaction'});
export const labels=Object.freeze([{text:'マルシェ',direction:'left',y:1.58},{text:'カフェ',direction:'right',y:1.27}]);
export function build(T,{document:doc=null}={}){
 const group=new T.Group();group.name=spec.id;const resources={geometries:new Set(),materials:new Set(),textures:new Set()},parts=[],symbolRecords=[];
 function mat(color){const m=new T.MeshStandardMaterial({color,roughness:.84,metalness:0});resources.materials.add(m);return m;}
 const oak=mat('#af8053'),edge=mat('#825b3a'),cream=mat('#fff0cc'),dark=mat('#64482e'),stone=mat('#c3bdac'),brass=mat('#b99a57');
 function solid(points,depth,slots=[]){const s=new T.Shape();s.moveTo(...points[0]);points.slice(1).forEach(p=>s.lineTo(...p));s.closePath();for(const r of slots){const h=new T.Path();h.moveTo(r[0],r[1]);h.lineTo(r[0],r[3]);h.lineTo(r[2],r[3]);h.lineTo(r[2],r[1]);h.closePath();s.holes.push(h);}const g=new T.ExtrudeGeometry(s,{depth,bevelEnabled:false,steps:1});g.computeVertexNormals();resources.geometries.add(g);return g;}
 function part(id,g,m,x,y,z,role){resources.geometries.add(g);const mesh=new T.Mesh(g,m);mesh.name=id;mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);parts.push({id,role,mesh});return mesh;}
 function box(id,w,h,d,x,y,z,m,role){return part(id,new T.BoxGeometry(w,h,d),m,x,y,z,role);}
 const boardShape=[[-.65,0],[.65,0],[.65,.62],[.53,.74],[-.53,.74],[-.65,.62]];
 const board=part('closed-chamfered-oak-core',solid(boardShape,.079),oak,0,1.09,-.0395,'board');
 const slots=labels.map(row=>[-.295,row.y-1.09-.137,.515,row.y-1.09-.113]);
 for(const face of[1,-1]){const veneer=part('carved-oak-face-'+face,solid(boardShape,.008,slots),oak,0,1.09,face*.0395,'carved-board-face');if(face<0)veneer.rotation.y=Math.PI;}
 const feet=[],posts=[],rails=[];
 for(const [n,x]of [[0,-.43],[1,.43]]){
  feet.push(box('solid-stone-foot-'+n,.31,.09,.31,x,.045,-.10,stone,'foot'));
  posts.push(box('oak-post-'+n,.105,spec.postTop-spec.postBottom,.105,x,(spec.postTop+spec.postBottom)/2,-.10,edge,'post'));
 }
 for(const y of[1.12,1.78])rails.push(box('rear-crossrail-'+y,1.12,.08,.075,0,y,-.085,edge,'rear-rail'));
 // Closed veneer solids contain real shallow channels; dark core floors sit below their rim.
 for(const face of[1,-1]){
  const root=new T.Group();root.name=face===1?'front-readable-face':'rear-readable-face';root.rotation.y=face===1?0:Math.PI;group.add(root);
  for(const row of labels){
   const arrowPoints=[[-.21,-.035],[.02,-.035],[.02,-.10],[.19,0],[.02,.10],[.02,.035],[-.21,.035]];
   const localDirection=face===1?row.direction:row.direction==='left'?'right':'left';
   const geo=solid(arrowPoints,.014),arrow=new T.Mesh(geo,cream);arrow.position.set(-.38,row.y,.0475);if(localDirection==='left')arrow.rotation.z=Math.PI;arrow.name=(face===1?'front':'rear')+'-'+localDirection+'-solid-arrow';root.add(arrow);arrow.castShadow=true;parts.push({id:arrow.name,role:'solid-symbol',mesh:arrow});
   const groove=new T.Mesh(new T.BoxGeometry(.81,.024,.0005),dark);resources.geometries.add(groove.geometry);groove.position.set(.11,row.y-.125,.03975);groove.name='recessed-channel-floor-'+face+'-'+row.y;root.add(groove);parts.push({id:groove.name,role:'carved-floor',mesh:groove});
   let material=cream;
   if(doc){const canvas=doc.createElement('canvas');canvas.width=512;canvas.height=144;const c=canvas.getContext('2d');if(!c)throw Error('sign_label_canvas_missing');c.fillStyle='#fff0cc';c.fillRect(0,0,512,144);c.fillStyle='#513a25';c.textAlign='center';c.textBaseline='middle';c.font='bold 88px system-ui,sans-serif';c.fillText(row.text,256,75,480);const t=new T.CanvasTexture(canvas);t.colorSpace=T.SRGBColorSpace;t.generateMipmaps=true;resources.textures.add(t);material=new T.MeshStandardMaterial({map:t,color:'#ffffff',roughness:.9});resources.materials.add(material);}
   const plaque=new T.Mesh(new T.BoxGeometry(.69,.21,.010),material);resources.geometries.add(plaque.geometry);plaque.position.set(.20,row.y,.0525);plaque.name=(face===1?'front':'rear')+'-text-'+row.text;root.add(plaque);parts.push({id:plaque.name,role:'closed-text-plaque',mesh:plaque});
   symbolRecords.push({face:face===1?'front':'back',text:row.text,localDirection,worldDirection:row.direction,solidArrow:arrow.name,closedPlaque:plaque.name,backFaceRotated:true});
  }
 }
 for(const x of[-.43,.43])for(const y of[1.12,1.78]){const g=new T.CylinderGeometry(.022,.022,.22,10);g.rotateX(Math.PI/2);part('through-bolt-'+x+'-'+y,g,brass,x,y,-.055,'through-bolt');}
 group.updateMatrixWorld(true);const b=new T.Box3().setFromObject(group,true),bounds={min:b.min.toArray(),max:b.max.toArray(),size:b.getSize(new T.Vector3()).toArray()};
 const triangles=[...resources.geometries].reduce((n,g)=>n+(g.index?g.index.count:g.attributes.position.count)/3,0),budget={meshes:parts.length,geometries:resources.geometries.size,materials:resources.materials.size,textures:resources.textures.size,triangles,lights:0};let disposed=false;
 return{group,parts,board,feet,posts,rails,resources,bounds,budget,spec,symbolRecords,inspect(){let invalidPositions=0,invalidNormals=0;for(const g of resources.geometries){const p=g.attributes.position,n=g.attributes.normal;for(let i=0;i<p.count;i++){if(![p.getX(i),p.getY(i),p.getZ(i)].every(Number.isFinite))invalidPositions++;const l=Math.hypot(n.getX(i),n.getY(i),n.getZ(i));if(!Number.isFinite(l)||Math.abs(l-1)>1e-5)invalidNormals++;}}return{bounds,budget,invalidPositions,invalidNormals,symbols:symbolRecords,stoneTop:.09,postBottom:.075,postStonePenetration:.015,bodyBinding:null,normalPlacement:false,ownershipUnlockSave:false};},get disposed(){return disposed;},dispose(){if(disposed)return;disposed=true;for(const set of Object.values(resources))for(const o of set)o.dispose();group.removeFromParent();group.clear();}};
}

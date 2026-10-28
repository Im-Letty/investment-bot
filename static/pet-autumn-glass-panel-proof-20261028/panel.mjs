export const spec=Object.freeze({id:'autumn-glass-garden-panel-v1',unit:'village:asset-library:autumn-glass-garden-panel:v1',bodyBinding:null,authoredDimensionsNotBodyFit:true,feet:{x:.66,width:.40,height:.16,depth:.50},frame:{halfWidth:.82,innerHalfWidth:.67,bottom:.27,lowerTop:.43,upperBottom:1.96,top:2.12,depth:.14},glass:{halfWidth:.67,bottom:.43,top:1.96,depth:.056},physicalLoadVerified:false,windResistanceVerified:false,normalPlacement:false,ownershipUnlockSave:false});
export function leafPath(T,reverse=false){
 const p=new T.Path();p.moveTo(0,.84);p.bezierCurveTo(-.12,.93,-.21,1.02,-.19,1.11);p.lineTo(-.28,1.15);p.lineTo(-.16,1.21);p.lineTo(-.21,1.32);p.lineTo(-.07,1.29);p.lineTo(0,1.48);p.lineTo(.07,1.29);p.lineTo(.21,1.32);p.lineTo(.16,1.21);p.lineTo(.28,1.15);p.lineTo(.19,1.11);p.bezierCurveTo(.21,1.02,.12,.93,0,.84);p.closePath();
 if(!reverse)return p;const pts=p.getPoints(10).reverse(),q=new T.Path();q.setFromPoints(pts);q.closePath();return q;
}
export function build(T){
 const group=new T.Group();group.name=spec.id;const boxG=new T.BoxGeometry(1,1,1),geometries=new Set([boxG]);
 const materials={stone:new T.MeshStandardMaterial({color:'#d9ccb5',roughness:.88}),wood:new T.MeshStandardMaterial({color:'#bc9469',roughness:.75}),cream:new T.MeshStandardMaterial({color:'#e7d6ad',roughness:.78}),lilac:new T.MeshStandardMaterial({color:'#a98fc0',roughness:.70}),glass:new T.MeshStandardMaterial({color:'#d2e9dc',roughness:.28,transparent:true,opacity:.34,depthWrite:false}),amber:new T.MeshStandardMaterial({color:'#c98a45',roughness:.40,transparent:true,opacity:.82}),gold:new T.MeshStandardMaterial({color:'#c9a268',metalness:.18,roughness:.6})};
 const parts=[],feet=[],posts=[],rails=[],retainers=[];
 function mesh(id,g,m,position=[0,0,0]){const o=new T.Mesh(g,materials[m]);o.name=id;o.position.set(...position);o.castShadow=m!=='glass';o.receiveShadow=true;group.add(o);parts.push({id,mesh:o});return o;}
 function box(id,size,p,m){const o=mesh(id,boxG,m,p);o.scale.set(...size);return o;}
 for(const sign of[-1,1]){
  feet.push(box('stone-foot-'+sign,[.40,.16,.50],[sign*.66,.08,0],'stone'));
  posts.push(box('post-rear-half-'+sign,[.15,2,.07],[sign*.745,1.12,-.035],'wood'));
  posts.push(box('post-front-lower-'+sign,[.15,.15,.07],[sign*.745,.195,.035],'wood'));
  posts.push(box('post-front-middle-'+sign,[.15,1.53,.07],[sign*.745,1.195,.035],'wood'));
 }
 rails.push(box('lower-front-lap-rail',[1.64,.16,.07],[0,.35,.035],'cream'));
 rails.push(box('upper-front-lap-rail',[1.64,.16,.07],[0,2.04,.035],'wood'));
 // Rear inner rails butt the posts; front rails occupy actual front-half post notches.
 rails.push(box('lower-rear-butt-rail',[1.34,.16,.07],[0,.35,-.035],'wood'));
 rails.push(box('upper-rear-butt-rail',[1.34,.16,.07],[0,2.04,-.035],'wood'));
 for(const z of[-.037,.037]){
  for(const sign of[-1,1])retainers.push(box('glass-side-retainer-'+z+'-'+sign,[.035,1.55,.025],[sign*.6575,1.195,z],'cream'));
  for(const y of[.445,1.945])retainers.push(box('glass-end-retainer-'+z+'-'+y,[1.28,.030,.025],[0,y,z],'cream'));
 }
 const clearShape=new T.Shape();clearShape.moveTo(-.67,.43);clearShape.lineTo(.67,.43);clearShape.lineTo(.67,1.96);clearShape.lineTo(-.67,1.96);clearShape.closePath();clearShape.holes.push(leafPath(T));
 const opts={depth:.056,bevelEnabled:false,curveSegments:10,steps:1},glassG=new T.ExtrudeGeometry(clearShape,opts);geometries.add(glassG);const glass=mesh('thick-clear-pane-with-real-leaf-void',glassG,'glass',[0,0,-.028]);
 const leafShape=new T.Shape();leafShape.curves=leafPath(T).curves;const amberG=new T.ExtrudeGeometry(leafShape,opts);geometries.add(amberG);const amber=mesh('matching-thick-amber-leaf-inset',amberG,'amber',[0,0,-.028]);
 const stemPoints=[new T.Vector3(-.06,.74,.033),new T.Vector3(0,.88,.033),new T.Vector3(0,1.34,.033)];
 for(let i=0;i<2;i++){const a=stemPoints[i],b=stemPoints[i+1],d=b.clone().sub(a),g=new T.CylinderGeometry(.007,.007,d.length()+.008,6);geometries.add(g);const m=mesh('closed-leaf-face-stem-'+i,g,'gold',a.clone().add(b).multiplyScalar(.5).toArray());m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());}

 for(const sign of[-1,1])box('lilac-foot-shoulder-'+sign,[.24,.075,.20],[sign*.66,.1775,0],'lilac');
 group.updateMatrixWorld(true);const b=new T.Box3().setFromObject(group,true),bounds={min:b.min.toArray(),max:b.max.toArray(),size:b.getSize(new T.Vector3()).toArray()};
 const budget={meshes:parts.length,geometries:geometries.size,materials:Object.keys(materials).length,textures:0,lights:0,triangles:parts.reduce((s,p)=>s+(p.mesh.geometry.index?.count??p.mesh.geometry.attributes.position.count)/3,0)};
 let disposed=false;return{group,parts,feet,posts,rails,retainers,glass,amber,bounds,budget,spec,resources:{geometries,materials:new Set(Object.values(materials))},get disposed(){return disposed;},
 inspect(){let invalidPositions=0,invalidNormals=0;for(const {mesh:m} of parts){for(const n of m.geometry.attributes.position.array)if(!Number.isFinite(n))invalidPositions++;for(let i=0;i<m.geometry.attributes.normal.count;i++){const n=new T.Vector3().fromBufferAttribute(m.geometry.attributes.normal,i);if(!Number.isFinite(n.length())||Math.abs(n.length()-1)>1e-5)invalidNormals++;}}return{bounds,budget,invalidPositions,invalidNormals,bodyBinding:null,authoredDimensionsNotBodyFit:true,joinery:'two real front-half post notches per side occupied by lower/upper front rails; rear halves remain continuous',glass:'thick clear pane with leaf-shaped cutout and matching thick amber inset, both have side walls',windLoadOrFrictionVerified:false};},
 dispose(){if(disposed)return;disposed=true;for(const g of geometries)g.dispose();for(const m of Object.values(materials))m.dispose();group.clear();}};
}
function hitParts(T,item,a,b){item.group.updateMatrixWorld(true);const start=item.group.localToWorld(new T.Vector3(...a)),end=item.group.localToWorld(new T.Vector3(...b)),delta=end.clone().sub(start);return [...new Set(new T.Raycaster(start,delta.clone().normalize(),0,delta.length()).intersectObjects(item.parts.map(x=>x.mesh),false).map(h=>h.object.name))];}
export function inspectPanel(T,item){
 const leafHole=hitParts(T,item,[0,1.14,.3],[0,1.14,-.3]),clear=hitParts(T,item,[.40,1.14,.3],[.40,1.14,-.3]),leafHoleReverse=hitParts(T,item,[.10,1.14,-.3],[.10,1.14,.3]),clearReverse=hitParts(T,item,[.40,1.14,-.3],[.40,1.14,.3]);
 const lap=[];
 for(const sign of[-1,1])for(const y of[.35,2.04]){const x=sign*.745;lap.push({sign,y,front:hitParts(T,item,[x,y,.3],[x,y,.001]),rear:hitParts(T,item,[x,y,-.3],[x,y,-.001])});}
 const footContact=item.feet.map(f=>{const b=new T.Box3().setFromObject(f,true);return{id:f.name,minY:b.min.y-item.group.position.y,maxY:b.max.y-item.group.position.y};});
 return{leafHole,leafHoleReverse,clear,clearReverse,lap,footContact,scope:'finite real triangle rays through clear pane, matching leaf inset, and both halves of four lap joints; not wind/strength/continuous traversal proof',bodyBinding:null};
}

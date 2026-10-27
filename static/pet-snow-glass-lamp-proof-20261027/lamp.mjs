/* A new isolated winter lamp; no ordinary placement, ownership or body binding. */
export const spec=Object.freeze({id:'snow-sheltered-glass-lamp-v1',unit:'village:asset-library:snow-sheltered-glass-lamp:v1',revision:1,category:'seasonal_and_event_props',style:'winter_glass_and_wood',season:'winter',height:1.765,footprint:.96,paneThickness:.016,paneHeight:.82,roofSnowThickness:.045,lightMode:'emissive material only; no dynamic light',bodyBinding:null,normalPlacement:false,ownershipUnlockSave:false});
export function build(T){
 const group=new T.Group();group.name=spec.id;const resources={geometries:new Set(),materials:new Set(),textures:new Set()},parts=[],feet=[],panes=[],posts=[],roof=[],snow=[];
 const material=(color,more={})=>{const m=new T.MeshStandardMaterial({color,roughness:.8,metalness:0,...more});resources.materials.add(m);return m;};
 const wood=material('#a77950'),trim=material('#694d37'),stone=material('#beb8aa'),brass=material('#bc9d60',{metalness:.15,roughness:.6}),white=material('#eef0ed'),glass=material('#bfd6cb',{transparent:true,opacity:.25,roughness:.2,depthWrite:false}),glow=material('#ffe7b4',{emissive:'#ffd796',emissiveIntensity:.75,roughness:.55});
 function part(id,g,m,x,y,z,role){resources.geometries.add(g);const mesh=new T.Mesh(g,m);mesh.name=id;mesh.position.set(x,y,z);mesh.castShadow=m!==glass;mesh.receiveShadow=m!==glass;group.add(mesh);parts.push({id,role,mesh});return mesh;}
 function box(id,w,h,d,x,y,z,m,role){return part(id,new T.BoxGeometry(w,h,d),m,x,y,z,role);}
 function prism(id,points,depth,m,role){const s=new T.Shape();s.moveTo(...points[0]);for(const p of points.slice(1))s.lineTo(...p);s.closePath();const g=new T.ExtrudeGeometry(s,{depth,bevelEnabled:false,steps:1});return part(id,g,m,0,0,-depth/2,role);}
 for(const x of[-.29,.29])for(const z of[-.29,.29])feet.push(box('stone-foot-'+x+'-'+z,.18,.11,.18,x,.055,z,stone,'foot'));
 const base=box('wood-pedestal-base',.78,.07,.78,0,.135,0,wood,'base');
 const stem=box('square-pedestal-stem',.26,.29,.26,0,.285,0,trim,'stem');
 const trayFloor=box('snow-tray-closed-floor',.88,.045,.88,0,.36,0,wood,'tray-floor'),trayRails=[];
 for(const z of[-.415,.415])trayRails.push(box('snow-tray-front-back-'+z,.88,.09,.05,0,.405,z,wood,'tray-rail'));
 for(const x of[-.415,.415])trayRails.push(box('snow-tray-side-'+x,.05,.09,.78,x,.405,0,wood,'tray-rail'));
 const chamberBase=box('raised-chamber-floor',.64,.075,.64,0,.445,0,brass,'chamber-floor');
 // The collector is a real pocket around the raised chamber, with a solid floor and four separate rails.
 for(const x of[-.365,.365])for(const z of[-.365,.365]){
  const g=new T.CylinderGeometry(.040,.047,.035,8);snow.push(part('tray-snow-'+x+'-'+z,g,white,x,.40,z,'tray-snow'));
 }
 for(const x of[-.285,.285])for(const z of[-.285,.285])posts.push(box('wood-corner-post-'+x+'-'+z,.07,1.02,.07,x,.98,z,trim,'post'));
 for(const z of[-.285,.285])box('upper-front-back-rail-'+z,.64,.075,.07,0,1.305,z,wood,'upper-rail');
 for(const x of[-.285,.285])box('upper-side-rail-'+x,.07,.075,.50,x,1.305,0,wood,'upper-rail');
 for(const z of[-.285,.285]){const m=box('thick-glass-front-back-'+z,.50,spec.paneHeight,spec.paneThickness,0,.89,z,glass,'glass-pane');panes.push(m);}
 for(const x of[-.285,.285]){const m=box('thick-glass-side-'+x,spec.paneThickness,spec.paneHeight,.50,x,.89,0,glass,'glass-pane');panes.push(m);}
 // Each slope and each cap is a closed extrusion with a real underside, back edge and finite thickness.
 roof.push(prism('wood-pitched-roof-left',[[-.47,1.345],[0,1.655],[0,1.715],[-.47,1.405]],.90,wood,'roof'));
 roof.push(prism('wood-pitched-roof-right',[[0,1.655],[.47,1.345],[.47,1.405],[0,1.715]],.90,wood,'roof'));
 snow.push(prism('snow-cap-left',[[-.48,1.398404255319149],[0,1.715],[0,1.760],[-.48,1.443404255319149]],.94,white,'roof-snow'));
 snow.push(prism('snow-cap-right',[[0,1.715],[.48,1.398404255319149],[.48,1.443404255319149],[0,1.760]],.94,white,'roof-snow'));
 const ridge=part('closed-ridge-cap',new T.CylinderGeometry(.025,.025,.94,8),white,0,1.74,0,'ridge-snow');ridge.rotation.x=Math.PI/2;snow.push(ridge);
 const saucer=part('inner-lamp-saucer',new T.CylinderGeometry(.14,.16,.035,12),brass,0,.505,0,'lamp-saucer');
 const luminousInsert=part('warm-luminous-insert',new T.CylinderGeometry(.070,.105,.42,12),glow,0,.7325,0,'emissive-insert');
 const top=part('insert-top',new T.CylinderGeometry(.035,.070,.07,12),glow,0,.9775,0,'emissive-insert-top');
 const cap=part('brass-insert-cap',new T.CylinderGeometry(.042,.042,.025,12),brass,0,1.025,0,'insert-cap');
 group.updateMatrixWorld(true);const b=new T.Box3().setFromObject(group,true),bounds={min:b.min.toArray(),max:b.max.toArray(),size:b.getSize(new T.Vector3()).toArray()};
 const triangles=[...resources.geometries].reduce((n,g)=>n+(g.index?g.index.count:g.attributes.position.count)/3,0),budget={meshes:parts.length,geometries:resources.geometries.size,materials:resources.materials.size,textures:resources.textures.size,triangles,lights:0};let disposed=false,lit=true;
 function inspect(){let invalidPositions=0,invalidNormals=0;for(const g of resources.geometries){const p=g.attributes.position,n=g.attributes.normal;for(let i=0;i<p.count;i++){if(![p.getX(i),p.getY(i),p.getZ(i)].every(Number.isFinite))invalidPositions++;const len=Math.hypot(n.getX(i),n.getY(i),n.getZ(i));if(!Number.isFinite(len)||Math.abs(len-1)>1e-5)invalidNormals++;}}return{bounds,budget,invalidPositions,invalidNormals,paneThickness:spec.paneThickness,paneCount:panes.length,glassIsSolidBoxGeometry:true,roofSnowThickness:spec.roofSnowThickness,snowTray:{floorTop:.3825,railTop:.45,pocketDepth:.0675,raisedChamberBaseBottom:.4075,snowIsAuthoredRigidGeometry:true,snowSimulation:false},lit,emissiveIntensity:glow.emissiveIntensity,physicalLighting:false,bodyBinding:null,normalPlacement:false,ownershipUnlockSave:false};}
 return{group,resources,parts,feet,panes,posts,roof,snow,base,stem,trayFloor,trayRails,chamberBase,luminousInsert,bounds,budget,spec,inspect,setLit(value){if(typeof value!=='boolean')throw Error('lamp_lit_requires_boolean');if(disposed)throw Error('lamp_disposed');lit=value;glow.emissiveIntensity=value?.75:0;glow.color.set(value?'#ffe7b4':'#d4b87c');return lit;},get lit(){return lit;},get disposed(){return disposed;},dispose(){if(disposed)return;disposed=true;for(const set of Object.values(resources))for(const o of set)o.dispose();group.removeFromParent();group.clear();}};
}

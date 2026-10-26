/* Fixture-assisted inferred compaction v2. Exact static v1 source remains a dependency.
 * Not standalone working equipment, a fully enclosed case, fit, unlock or save. */
(function(root,factory){'use strict';var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PetToolboxLinkageProof=api;}(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
const L=Math.hypot(.35,.30),OPEN=Math.atan2(.30,.35),COMPACT=Math.acos(-.075/L);
const spec=Object.freeze({unit:'wardrobe:other:storybook-sewing-toolbox:hinged-compaction:v2',revision:2,sourceSHA:'6afc65a45e78a938b018987a85037a9bbbd4b63905aca1438927ea13d76db070',baseRecipeSHA:'8e4d65f59698f2f336f46d4ecb0a5daff13830941e8d96239dece6dc6c0ea05d',representation:'fixture-assisted manual slide-fold-fourbar',externalTestJig:true,standaloneMechanism:false,fullyEnclosedStorage:false,adoptedArt:false,grip:false,allGrowthFit:false,fullBody360:false,normalPlacement:false,unlock:false,save:false});
function clamp(v,a,b){return Math.min(b,Math.max(a,v));}
function plan(progress){if(!Number.isFinite(progress)||progress<0||progress>1)throw Error('invalid_progress');const s=clamp(progress/.28,0,1),f=clamp((progress-.28)/.28,0,1),t=clamp((progress-.56)/.44,0,1),theta=OPEN+(COMPACT-OPEN)*t;return{progress,slide:s,fold:f,tray:t,theta,handleAngle:-f*Math.PI/2,hingeY:.45,hingeZ:-.055-.46*s,trayCenter:.335+L*Math.cos(theta),trayBottom:.180+L*Math.sin(theta),phase:progress===0?'expanded':progress===1?'compact-fixture-only':progress<.28?'sliding-external-carriage':progress<.56?'folding-handle-behind-arms':'moving-fourbar-trays'};}
function build(T,Base,options){
 if(!T||!Base||typeof Base.build!=='function')throw Error('base_recipe_required');const base=Base.build(T,options||{}),group=base.group,rest=new Map(),parts=[],ownedGeometries=[],newBatches=[],feet=[],byId=new Map();let dead=false,current=plan(0),bounds=null;
 group.name='fixture-assisted-toolbox-hinged-compaction-v2';base.batches.forEach(b=>group.remove(b));
 const material=name=>base.materials.find(m=>m.name===name),wood=material('honey-wood'),edge=material('wood-edge'),gold=material('muted-brass'),sage=material('sage-lining');
 const fixtureBox=new T.BoxGeometry(1,1,1);fixtureBox.computeBoundingBox();ownedGeometries.push(fixtureBox);
 const box=base.parts.find(x=>x.id==='base-box-bottom').mesh.geometry,cyl=base.parts.find(x=>x.id.startsWith('brass-pivot-')).mesh.geometry,torus=base.parts.find(x=>x.id.startsWith('scissors-finger-loop')).mesh.geometry;
 function register(id,mesh,role){mesh.name=id;mesh.castShadow=mesh.receiveShadow=true;parts.push({id,mesh,role});byId.set(id,mesh);rest.set(id,{position:mesh.position.clone(),quaternion:mesh.quaternion.clone(),scale:mesh.scale.clone()});if(id.startsWith('foot-')||id.startsWith('fixture-foot-'))feet.push(id);return mesh;}
 function add(id,g,m,pos,scale,rotation,role){const a=new T.Mesh(g,m);a.position.set(...pos);if(scale)a.scale.set(...scale);if(rotation)a.rotation.set(...rotation);base.group.children[0].add(a);return register(id,a,role);}
 function bx(id,m,x,y,z,w,h,d,role){return add(id,fixtureBox,m,[x,y,z],[w,h,d],null,role);}
 function cylinder(id,m,x,y,z,r,len,axis,role){return add(id,cyl,m,[x,y,z],[r,len,r],axis==='x'?[0,0,Math.PI/2]:[Math.PI/2,0,0],role);}
 const left=id=>id.startsWith('left-tray-')||id.startsWith('left-embroidered-')||id.startsWith('spool-')||id.startsWith('thread-ridge-'),right=id=>id.startsWith('right-tray-')||id.startsWith('right-embroidered-')||id.startsWith('rolled-ivory-')||id.startsWith('fabric-roll-')||id==='sage-fabric-strap'||id.startsWith('strap-flower-');
 const handle=id=>id==='sage-handle-grip'||id.startsWith('brass-grip-collar-')||id.startsWith('grip-embroidered-flower-');
 const content=id=>id==='closed-pincushion'||id.startsWith('pin-')||id.startsWith('scissor');
 for(const row of base.parts){const id=row.id;if(id.startsWith('cantilever-arm-')||id.startsWith('brass-pivot-')||id==='solid-arch-handle')continue;register(id,row.mesh,left(id)?'left-tray':right(id)?'right-tray':handle(id)?'handle':content(id)?'base-content':'base-fixed');}
 // Real closed strap with two through-holes. Nominal .018 bore, .012 shaft.
 const armShape=new T.Shape();armShape.moveTo(0,-.037);armShape.lineTo(L,-.037);armShape.absarc(L,0,.037,-Math.PI/2,Math.PI/2,false);armShape.lineTo(0,.037);armShape.absarc(0,0,.037,Math.PI/2,3*Math.PI/2,false);armShape.closePath();for(const x of [0,L]){const h=new T.Path();h.absarc(x,0,.018,0,Math.PI*2,true);armShape.holes.push(h);}
 const armGeo=new T.ExtrudeGeometry(armShape,{depth:.034,steps:1,curveSegments:12,bevelEnabled:false});armGeo.translate(0,0,-.017);armGeo.computeBoundingBox();ownedGeometries.push(armGeo);
 // Derivative handle ends use genuine x-axis bearing rings; upper arch keeps v1 outline.
 const archShape=new T.Shape();archShape.moveTo(-.36,.307);archShape.lineTo(-.36,.72);archShape.bezierCurveTo(-.36,1.17,.36,1.17,.36,.72);archShape.lineTo(.36,.307);archShape.lineTo(.285,.307);archShape.lineTo(.285,.72);archShape.bezierCurveTo(.285,1.065,-.285,1.065,-.285,.72);archShape.lineTo(-.285,.307);archShape.closePath();
 const archGeo=new T.ExtrudeGeometry(archShape,{depth:.065,bevelEnabled:true,bevelSize:.008,bevelThickness:.008,bevelSegments:2,curveSegments:18});archGeo.translate(0,0,-.0325);archGeo.computeBoundingBox();ownedGeometries.push(archGeo);
 add('v2-bearing-ended-arch',archGeo,wood,[0,0,-.055],null,null,'handle');
 const bearingGeo=new T.TorusGeometry(.029,.014,8,20);bearingGeo.rotateY(Math.PI/2);bearingGeo.computeBoundingBox();ownedGeometries.push(bearingGeo);
 for(const side of [-1,1])add('handle-bearing-'+side,bearingGeo,wood,[side*.32,.27,-.055],null,null,'handle');
 for(const side of [-1,1])for(const zsign of [-1,1])for(let j=0;j<2;j++){
  add('arm-'+side+'-'+zsign+'-'+j,armGeo,wood,[0,0,0],null,null,'arm');
  for(const end of ['base','tray']){cylinder('axle-'+side+'-'+zsign+'-'+j+'-'+end,gold,0,0,0,.012,end==='base'?.132:.170,'z','pivot-contact');cylinder('cap-'+side+'-'+zsign+'-'+j+'-'+end,gold,0,0,0,.028,.018,'z','pivot-contact');}
 }
 // Warm-wood external test apparatus, not part of the adopted item design.
 for(const side of [-1,1]){
  bx('fixture-guide-'+side,edge,side*1.02,.435,-.305,.070,.050,.75,'fixture-static');
  for(const z of [-.65,.04])bx('fixture-foot-'+side+'-'+z,wood,side*1.02,.205,z,.085,.410,.085,'fixture-static');
  bx('fixture-rear-crossbrace-'+side,wood,side*.73,.105,-.65,.64,.075,.060,'fixture-static');
  bx('fixture-base-clamp-'+side,edge,side*.44,.105,-.48,.075,.075,.34,'fixture-joint');
  bx('carrier-outer-'+side,wood,side*1.02,.665,-.055,.045,.310,.045,'carrier');
  bx('carrier-top-'+side,wood,side*.71625,.82,-.055,.6525,.045,.045,'carrier');
  bx('carrier-inner-'+side,wood,side*.39,.635,-.055,.018,.370,.045,'carrier');
  bx('carrier-guide-block-'+side,sage,side*1.02,.485,-.055,.100,.050,.110,'carrier-guide-contact');
  cylinder('handle-axle-'+side,gold,side*.345,.45,-.055,.012,.110,'x','handle-joint');
  cylinder('handle-inner-cap-'+side,gold,side*.29,.45,-.055,.027,.012,'x','handle-joint');
  cylinder('handle-outer-cap-'+side,gold,side*.40,.45,-.055,.027,.012,'x','handle-joint');
 }
 // New external apparatus feet are closed solids whose soles share original foot Y=0.
 const buckets=new Map();for(const r of parts){const k=r.mesh.geometry.uuid+':'+r.mesh.material.uuid;if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(r);}
 for(const rows of buckets.values()){const m=new T.InstancedMesh(rows[0].mesh.geometry,rows[0].mesh.material,rows.length);m.name='v2-linkage-visible-batch-'+newBatches.length;m.userData.partIds=rows.map(r=>r.id);m.castShadow=m.receiveShadow=true;group.add(m);newBatches.push(m);}
 const matrix=new T.Matrix4(),q=new T.Quaternion(),v=new T.Vector3(),axis=new T.Vector3(1,0,0),pivot=new T.Vector3(0,.45,-.055),inv=new T.Matrix4();
 function setProgress(n){
  if(dead)throw Error('disposed');current=plan(n);
  for(const r of parts){const m=r.mesh,a=rest.get(r.id);m.position.copy(a.position);m.quaternion.copy(a.quaternion);m.scale.copy(a.scale);
   if(r.role==='left-tray'||r.role==='right-tray'){const side=r.role==='left-tray'?-1:1;m.position.x+=side*(current.trayCenter-.685);m.position.y+=current.trayBottom-.48;}
   else if(r.role==='handle'){m.position.y+=.18;v.copy(m.position).sub(pivot).applyAxisAngle(axis,current.handleAngle).add(pivot);m.position.copy(v);m.position.z-=.46*current.slide;q.setFromAxisAngle(axis,current.handleAngle);m.quaternion.premultiply(q);}
   else if(r.role==='carrier'||r.role==='carrier-guide-contact'||r.role==='handle-joint')m.position.z-=.46*current.slide;
   // A tiny documented rigid shift resolves the old scissors/handle lower-edge overlap.
   else if(r.id.startsWith('scissor'))m.position.x-=.04;
   if(r.id==='base-embroidered-spray-leaf--1-1'||r.id==='base-embroidered-spray-leaf-1-1'){m.rotation.z=0;}
  }
  for(const side of [-1,1])for(const sign of [-1,1])for(let j=0;j<2;j++){
   const a=new T.Vector3(side*(.285+.12*j),.255,sign*.36),b=new T.Vector3(a.x+side*L*Math.cos(current.theta),a.y+L*Math.sin(current.theta),a.z),arm=byId.get('arm-'+side+'-'+sign+'-'+j);
   arm.position.copy(a);arm.rotation.set(0,0,Math.atan2(b.y-a.y,b.x-a.x));
   for(const end of ['base','tray']){const p=end==='base'?a:b,axle=byId.get('axle-'+side+'-'+sign+'-'+j+'-'+end),cap=byId.get('cap-'+side+'-'+sign+'-'+j+'-'+end);axle.position.set(p.x,p.y,sign*(end==='base'?.339:.320));cap.position.set(p.x,p.y,sign*.393);}
  }
  group.updateMatrixWorld(true);inv.copy(group.matrixWorld).invert();
  for(const b of newBatches){b.userData.partIds.forEach((id,i)=>{matrix.multiplyMatrices(inv,byId.get(id).matrixWorld);b.setMatrixAt(i,matrix);});b.instanceMatrix.needsUpdate=true;b.computeBoundingBox();b.computeBoundingSphere();}
  bounds=measureBounds();return getState();
 }
 function measureBounds(){group.updateMatrixWorld(true);const b=new T.Box3();for(const r of parts){r.mesh.geometry.computeBoundingBox();const m=matrix.clone().multiplyMatrices(inv,r.mesh.matrixWorld);b.union(r.mesh.geometry.boundingBox.clone().applyMatrix4(m));}return{min:b.min.toArray(),max:b.max.toArray(),size:b.getSize(new T.Vector3()).toArray()};}
 function getState(){return{...current,armCount:8,fixedArmLength:L,pivotClosureMaximum:Math.max(...pivotPairs().map(p=>p.closure)),rigidTrayContents:true,externalTestJig:true,guideTranslation:-.46*current.slide,sourceScissorsShiftX:-.04,baseTwoLeafClearanceRotationZ:0,handleBearingBoreRadius:.015,handleAxleRadius:.012,armBoreRadius:.018,armAxleRadius:.012,standaloneMechanism:false,fullyEnclosedStorage:false,normalPlacement:false,grip:false,allGrowthFit:false,save:false};}
 function pivotPairs(){const out=[];for(const side of [-1,1])for(const sign of [-1,1])for(let j=0;j<2;j++){const m=byId.get('arm-'+side+'-'+sign+'-'+j);m.updateMatrix();const a=new T.Vector3(0,0,0).applyMatrix4(m.matrix),b=new T.Vector3(L,0,0).applyMatrix4(m.matrix),aa=byId.get('axle-'+side+'-'+sign+'-'+j+'-base').position,bb=byId.get('axle-'+side+'-'+sign+'-'+j+'-tray').position;out.push({id:m.name,centres:[a.toArray(),b.toArray()],axleXY:[aa.toArray(),bb.toArray()],length:a.distanceTo(b),closure:Math.max(Math.hypot(a.x-aa.x,a.y-aa.y),Math.hypot(b.x-bb.x,b.y-bb.y))});}return out;}
 setProgress(0);
 function extrema(A,B,lo,hi){const a=[lo,hi],v=Math.atan2(B,A);for(let k=-2;k<=2;k++){const t=v+k*Math.PI;if(t>lo&&t<hi)a.push(t);}const values=a.map(t=>A*Math.cos(t)+B*Math.sin(t));return[Math.min(...values),Math.max(...values)];}
 const sweep=new T.Box3();for(const r of parts){const m=localFor(r),g=r.mesh.geometry.boundingBox,b=new T.Box3().copy(g).applyMatrix4(m);
  if(r.role==='left-tray'||r.role==='right-tray'||r.role==='pivot-contact'&&r.id.endsWith('-tray')){const side=r.role==='left-tray'?-1:r.role==='right-tray'?1:Number(r.id.match(/^(?:axle|cap)-(-1|1)-/)[1]),dx=side*(.26-.685);b.min.x+=Math.min(0,dx);b.max.x+=Math.max(0,dx);b.max.y+=L-.30;sweep.union(b);}
  else if(r.role==='carrier'||r.role==='carrier-guide-contact'||r.role==='handle-joint'){b.min.z-=.46;sweep.union(b);}
  else if(r.role==='handle'){for(const x of[g.min.x,g.max.x])for(const y of[g.min.y,g.max.y])for(const z of[g.min.z,g.max.z]){const a=new T.Vector3(x,y,z).applyMatrix4(m),u=a.y-.45,w=a.z+.055,yy=extrema(u,w,0,Math.PI/2),zz=extrema(w,-u,0,Math.PI/2);sweep.expandByPoint(new T.Vector3(a.x,.45+yy[0],Math.min(a.z-.46,-.515+zz[0])));sweep.expandByPoint(new T.Vector3(a.x,.45+yy[1],Math.max(a.z,-.515+zz[1])));}}
  else if(r.role==='arm'){const z=r.mesh.position.z,match=r.id.match(/^arm-(-1|1)-(-1|1)-(0|1)$/),sg=Number(match[1]),j=Number(match[3]),ax=sg*(.285+.12*j);for(const x of[g.min.x,g.max.x])for(const y of[g.min.y,g.max.y])for(const zz of[g.min.z,g.max.z]){const xx=extrema(sg*x,-y,OPEN,COMPACT),yy=extrema(sg*y,x,OPEN,COMPACT);sweep.expandByPoint(new T.Vector3(ax+xx[0],.255+yy[0],z+zz));sweep.expandByPoint(new T.Vector3(ax+xx[1],.255+yy[1],z+zz));}}
  else sweep.union(b);
 }
 function localFor(r){return new T.Matrix4().copy(group.matrixWorld).invert().multiply(r.mesh.matrixWorld);}
 const sweepBounds=Object.freeze({min:Object.freeze(sweep.min.toArray()),max:Object.freeze(sweep.max.toArray()),size:Object.freeze(sweep.getSize(new T.Vector3()).toArray()),method:'conservative analytic rigid-part intervals and rotated box corners over full0..1, not finite screenshots'});
 const triangles=parts.reduce((n,r)=>n+(r.mesh.geometry.index?r.mesh.geometry.index.count:r.mesh.geometry.attributes.position.count)/3,0);
 const budget=Object.freeze({parts:parts.length,visibleBatches:newBatches.length,triangles,ownedNewGeometries:ownedGeometries.length,reusedBaseGeometries:base.geometries.length,materials:base.materials.length,textures:base.textures.length,textureSide:128,oldVisibleBatchesRemoved:base.batches.length,geometryAllocationsAfterBuild:0});
 return{group,parts,batches:newBatches,base,ownedGeometries,materials:base.materials,textures:base.textures,spec,budget,get bounds(){return sweepBounds;},get poseBounds(){return bounds;},footprint:{minX:sweepBounds.min[0],maxX:sweepBounds.max[0],minZ:sweepBounds.min[2],maxZ:sweepBounds.max[2],groundY:0,contactPartIds:feet.slice()},setProgress,getState,pivotPairs,rest,byId,dispose(){if(dead)return;dead=true;newBatches.forEach(b=>b.dispose());ownedGeometries.forEach(g=>g.dispose());base.dispose();group.removeFromParent();}};
}
return Object.freeze({spec,plan,build});
}));

/* Fixed-open sewing-toolbox geometry prerequisite. Original raster remains unmodified.
 * No state/inventory/placement integration; authored sizes are game world units. */
(function(root,factory){'use strict';var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PetToolboxMeshProof=api;}(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
var spec=Object.freeze({id:'storybook-sewing-toolbox-closed-mesh-prerequisite-v1',revision:1,sourceSHA:'6afc65a45e78a938b018987a85037a9bbbd4b63905aca1438927ea13d76db070',sizeUnit:'game world units',fixedOpen:true,mechanism:false,grip:false,fit:false,fullBody360:false,normalPlacement:false,unlock:false,save:false});
function build(T,options){
 if(!T||!T.Group||!T.InstancedMesh)throw Error('three_required');options=options||{};
 var group=new T.Group();group.name=spec.id;var sources=new T.Group();sources.name='stable-part-source-graph';sources.visible=false;group.add(sources);
 var geometries=[],materials=[],textures=[],parts=[],cache={},disposed=false;
 function geo(key,make){if(!cache[key]){var g=make();g.normalizeNormals();g.computeBoundingBox();g.computeBoundingSphere();geometries.push(g);cache[key]=g;}return cache[key];}
 function rounded(){var s=new T.Shape(),r=.105,b=.025,w=.5-b,h=.5-b;s.moveTo(-w+r,-h);s.lineTo(w-r,-h);s.quadraticCurveTo(w,-h,w,-h+r);s.lineTo(w,h-r);s.quadraticCurveTo(w,h,w-r,h);s.lineTo(-w+r,h);s.quadraticCurveTo(-w,h,-w,h-r);s.lineTo(-w,-h+r);s.quadraticCurveTo(-w,-h,-w+r,-h);var g=new T.ExtrudeGeometry(s,{depth:1-2*b,steps:1,curveSegments:5,bevelEnabled:true,bevelThickness:b,bevelSize:b,bevelSegments:2});g.translate(0,0,-.5+b);return g;}
 var box=geo('rounded',rounded),sphere=geo('sphere',()=>new T.SphereGeometry(1,12,8)),cyl=geo('cylinder',()=>new T.CylinderGeometry(1,1,1,12,1,false)),torus=geo('torus',()=>new T.TorusGeometry(1,.15,6,20));
 var style=options.style||(typeof globalThis!=='undefined'&&globalThis.PetTownStyle),maps={};
 if(style&&options.document)for(var kind of ['wood','plaster']){var tx=style.surfaceTexture(T,options.document,kind);if(tx){maps[kind]=tx;textures.push(tx);}}
 function mat(name,color,rough,metal,map){var m=new T.MeshStandardMaterial({color:color,roughness:rough,metalness:metal||0});m.name=name;m.userData.surfaceRole=name;if(maps[map]){m.map=maps[map];m.bumpMap=maps[map];m.bumpScale=map==='wood'?.012:.003;}materials.push(m);return m;}
 var wood=mat('honey-wood','#c79561',.68,0,'wood'),woodDark=mat('wood-edge','#ad7f4e',.70,0,'wood'),cream=mat('cream-textile','#f0e4c9',.91,0,'plaster'),sage=mat('sage-lining','#9ca98d',.91,0,'plaster'),lilac=mat('lilac-thread-flower','#b49ac7',.91,0,'plaster'),green=mat('botanical-embroidery','#78906a',.87),gold=mat('muted-brass','#c3a052',.35,.48),pin=mat('pearl-pins','#e7d4aa',.45,.05),blade=mat('warm-steel','#c7c5b7',.34,.52);
 function part(id,g,m,pos,scale,rotation){if(parts.some(p=>p.id===id))throw Error('duplicate_part_id');var mesh=new T.Mesh(g,m);mesh.name=id;mesh.position.set(...pos);if(scale)mesh.scale.set(...scale);if(rotation)mesh.rotation.set(...rotation);mesh.castShadow=true;mesh.receiveShadow=true;sources.add(mesh);parts.push({id:id,mesh:mesh});return mesh;}
 function bx(id,m,x,y,z,w,h,d,r){return part(id,box,m,[x,y,z],[w,h,d],r);}
 function sp(id,m,x,y,z,a,b,c){return part(id,sphere,m,[x,y,z],[a,b,c]);}
 function rod(id,m,a,b,r){var v=new T.Vector3().subVectors(new T.Vector3(...b),new T.Vector3(...a)),o=part(id,cyl,m,[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2],[r,v.length(),r]);o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),v.normalize());return o;}
 function loop(id,m,x,y,z,sx,sy,sz,rot){return part(id,torus,m,[x,y,z],[sx,sy,sz],rot);}
 function tray(id,x,y,w,d,h){
  bx(id+'-bottom',wood,x,y+.025,0,w,.05,d);
  bx(id+'-front',wood,x,y+h/2,.5*d-.022,w,h,.045);
  bx(id+'-back',wood,x,y+h/2,-.5*d+.022,w,h,.045);
  bx(id+'-left',wood,x-w/2+.022,y+h/2,0,.045,h,d-.035);
  bx(id+'-right',wood,x+w/2-.022,y+h/2,0,.045,h,d-.035);
  bx(id+'-lining-floor',sage,x,y+.058,0,w-.085,.018,d-.085);
  bx(id+'-lining-back',sage,x,y+h/2,-d/2+.051,w-.085,h-.048,.014);
  bx(id+'-face-inlay',cream,x,y+h*.52,d/2+.003,w-.08,h*.69,.016);
 }
 tray('base-box',0,.055,.94,.62,.29);tray('left-tray',-.685,.48,.50,.50,.21);tray('right-tray',.685,.48,.50,.50,.21);
 bx('sage-bottom-edge',sage,0,.075,0,.965,.075,.635);
 for(var x of [-.35,.35])for(var z of [-.22,.22])sp('foot-'+x+'-'+z,woodDark,x,.025,z,.065,.025,.05);
 for(var side of [-1,1])for(var z of [-.286,.286]){
  var a=[side*.30,.235,z],b=[side*.65,.535,z],v=new T.Vector3().subVectors(new T.Vector3(...b),new T.Vector3(...a));
  bx('cantilever-arm-'+side+'-'+z,wood,(a[0]+b[0])/2,(a[1]+b[1])/2,z,v.length()+.06,.074,.034,[0,0,Math.atan2(v.y,v.x)]);
  for(var k=0;k<2;k++){var p=k?b:a;part('brass-pivot-'+side+'-'+z+'-'+k,cyl,gold,[p[0],p[1],p[2]+Math.sign(z)*.023],[.034,.020,.034],[Math.PI/2,0,0]);}
 }
 var arch=geo('arch',function(){var s=new T.Shape();s.moveTo(-.36,.27);s.lineTo(-.36,.72);s.bezierCurveTo(-.36,1.17,.36,1.17,.36,.72);s.lineTo(.36,.27);s.lineTo(.285,.27);s.lineTo(.285,.72);s.bezierCurveTo(.285,1.065,-.285,1.065,-.285,.72);s.lineTo(-.285,.27);s.closePath();var g=new T.ExtrudeGeometry(s,{depth:.065,bevelEnabled:true,bevelSize:.008,bevelThickness:.008,bevelSegments:2,curveSegments:18});g.translate(0,0,-.0325);return g;});
 part('solid-arch-handle',arch,wood,[0,0,-.055]);bx('sage-handle-grip',sage,0,1.075,-.055,.30,.082,.092);
 for(var x of [-.155,.155])bx('brass-grip-collar-'+x,gold,x,1.071,-.055,.014,.093,.10);
 function flower(id,x,y,z,s,petals){
  for(var i=0;i<petals;i++){var a=i*Math.PI*2/petals;var o=sp(id+'-petal-'+i,lilac,x+Math.cos(a)*s*.48,y+Math.sin(a)*s*.48,z,s*.35,s*.19,.006);o.rotation.z=a;}
  sp(id+'-center',pin,x,y,z+.004,s*.16,s*.16,.007);
 }
 function motif(id,x,y,z,s){
  rod(id+'-stem',green,[x-s*.85,y-s*.17,z],[x+s*.85,y-s*.17,z],s*.017);
  flower(id+'-flower',x,y+s*.13,z+.002,s*.58,5);
  for(var side of [-1,1])for(var j=0;j<2;j++){var o=sp(id+'-leaf-'+side+'-'+j,green,x+side*s*(.35+j*.27),y-s*.03+j*s*.14,z,.12*s,.29*s,.006);o.rotation.z=-side*.65;}
 }
 motif('base-embroidered-spray',0,.203,.324,.36);motif('left-embroidered-spray',-.685,.59,.258,.18);motif('right-embroidered-spray',.685,.59,.258,.18);flower('grip-embroidered-flower',0,1.074,-.002,.04,5);
 // Closed hollow spindle profiles preserve visible holes without alpha planes.
 function lathe(key,points){return geo(key,()=>new T.LatheGeometry(points.map(p=>new T.Vector2(...p)),20));}
 var spindle=lathe('spindle',[[.025,0],[.078,0],[.080,.012],[.074,.026],[.035,.029],[.035,.174],[.075,.178],[.080,.19],[.076,.205],[.025,.205],[.025,0]]);
 var thread=lathe('thread',[[.034,.032],[.061,.032],[.064,.045],[.064,.164],[.061,.176],[.034,.176],[.034,.032]]);
 for(var j=0;j<2;j++){var x=-.685+(j-.5)*.18,z=j*.08-.04;part('spool-'+j+'-closed-wood',spindle,wood,[x,.545,z]);part('spool-'+j+'-closed-thread',thread,j? sage:lilac,[x,.545,z]);for(var k=0;k<4;k++)loop('thread-ridge-'+j+'-'+k,j?sage:lilac,x,.60+k*.024,z,.060,.060,.017,[Math.PI/2,0,0]);}
 sp('closed-pincushion',cream,-.105,.305,-.005,.17,.115,.16);
 for(var j=0;j<5;j++){var a=j*.8-1.6,p=[-.105+Math.sin(a)*.075,.38+Math.cos(a)*.035,-.025];var top=[p[0]+Math.sin(a)*.025,p[1]+.095,p[2]-.016];rod('pin-stem-'+j,gold,p,top,.003);sp('pin-head-'+j,j%3===0?lilac:j%3===1?sage:pin,...top,.015,.015,.015);}
 // Scissor holes, pivot, and capped blades are identifiable static contents.
 for(var side of [-1,1])loop('scissors-finger-loop-'+side,gold,.215+side*.045,.425,-.06,.034,.052,.025,[0,0,side*-.2]);
 var scissorBlade=geo('blade',function(){var s=new T.Shape();s.moveTo(-.014,0);s.lineTo(.014,0);s.lineTo(.006,-.18);s.quadraticCurveTo(0,-.205,-.006,-.18);s.closePath();var g=new T.ExtrudeGeometry(s,{depth:.009,bevelEnabled:false});g.translate(0,0,-.0045);return g;});
 for(var side of [-1,1]){rod('scissor-neck-'+side,gold,[.215+side*.027,.40,-.06],[.215,.345,-.06],.009);part('scissor-blade-'+side,scissorBlade,blade,[.215,.35,-.06],[1,1,1],[0,0,side*.15]);}
 sp('scissors-pivot',gold,.215,.348,-.047,.017,.017,.012);
 // Rolled textile is a thick solid roll with separately closed end seams.
 part('rolled-ivory-fabric',cyl,cream,[.685,.603,0],[.087,.34,.087],[0,0,Math.PI/2]);
 for(var side of [-1,1])loop('fabric-roll-end-'+side,cream,.685+side*.172,.603,0,.072,.072,.024,[0,Math.PI/2,0]);
 bx('sage-fabric-strap',sage,.685,.675,0,.055,.026,.155);flower('strap-flower-button',.685,.675,.083,.022,5);
 group.updateMatrixWorld(true);
 var buckets={};for(var p of parts){var key=p.mesh.geometry.uuid+':'+p.mesh.material.uuid;(buckets[key]||(buckets[key]=[])).push(p);}
 var batches=[];for(var key of Object.keys(buckets)){var rows=buckets[key],m=new T.InstancedMesh(rows[0].mesh.geometry,rows[0].mesh.material,rows.length);m.name='static-toolbox-batch-'+batches.length;m.userData.partIds=rows.map(p=>p.id);rows.forEach((p,i)=>m.setMatrixAt(i,p.mesh.matrixWorld));m.castShadow=m.receiveShadow=true;m.computeBoundingBox();m.computeBoundingSphere();group.add(m);batches.push(m);}
 group.updateMatrixWorld(true);var box3=new T.Box3().setFromObject(group),min=box3.min.toArray(),max=box3.max.toArray(),triangles=parts.reduce((n,p)=>n+(p.mesh.geometry.index?p.mesh.geometry.index.count:p.mesh.geometry.attributes.position.count)/3,0);
 var bounds=Object.freeze({min:Object.freeze(min),max:Object.freeze(max),size:Object.freeze(max.map((v,i)=>v-min[i]))});
 var footprint=Object.freeze({minX:min[0],maxX:max[0],minZ:min[2],maxZ:max[2],groundY:0,contactPartIds:Object.freeze(parts.filter(p=>p.id.startsWith('foot-')).map(p=>p.id))});
 var budget=Object.freeze({parts:parts.length,renderBatches:batches.length,triangles:triangles,geometries:geometries.length,materials:materials.length,textures:textures.length,textureSide:128});
 return {group:group,parts:parts,batches:batches,geometries:geometries,materials:materials,textures:textures,bounds:bounds,footprint:footprint,budget:budget,spec:spec,
  intersects:function(x,z,r){if(![x,z,r].every(Number.isFinite)||r<0)throw Error('invalid_collision_query');return x+r>min[0]&&x-r<max[0]&&z+r>min[2]&&z-r<max[2];},
  dispose:function(){if(disposed)return;disposed=true;geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());batches.forEach(m=>m.dispose());group.removeFromParent();}
 };
}
return Object.freeze({spec:spec,build:build});
}));

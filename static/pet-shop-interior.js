/* Original elegant village shop. Caller owns durable layout, economy and canonical pet. */
(function(root,factory){
 'use strict';
 var api=factory(typeof module==='object'&&module.exports?require('./pet-shop-layout.js'):root.PetShopLayout);
 if(typeof module==='object'&&module.exports)module.exports=api;else root.PetShopInterior=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Layout){
 'use strict';
 var loading=null,TAU=Math.PI*2;
 function finite(n){return typeof n==='number'&&Number.isFinite(n);}
 function clamp(n,a,b){return Math.max(a,Math.min(b,n));}
 function clone(x){return JSON.parse(JSON.stringify(x));}
 function cameraState(v){v=v||{};return {yaw:finite(v.yaw)?((v.yaw+Math.PI)%TAU+TAU)%TAU-Math.PI:.12,pitch:clamp(finite(v.pitch)?v.pitch:.61,.38,.91),distance:clamp(finite(v.distance)?v.distance:8.8,7.2,10.5)};}
 function direction(x,z,yaw){return {x:Math.cos(yaw)*x+Math.sin(yaw)*z,z:-Math.sin(yaw)*x+Math.cos(yaw)*z};}
 function catalog(api){var rows=api.fixtures||api.FIXTURES||[];return Array.isArray(rows)?rows:Object.keys(rows).map(function(id){return Object.assign({id:id},rows[id]);});}
 function fixtureSpec(api,id){var row=catalog(api).find(function(r){return r.id===id;})||{};return {id:id,name:row.name||row.label||id,w:row.width||row.w||1,d:row.depth||row.d||1,h:row.height||1,flat:!!row.flat};}
 function validLayout(api,value,roomId){try{var result=api.validateLayout(value,roomId);return result!==false;}catch(_){return false;}}
 function walkable(api,layout,x,z,roomId){
  if(!finite(x)||!finite(z)||Math.abs(x)>4.7||z< -3.7||z>3.72)return false;
  var fn=api.isWalkable||api.walkable;if(typeof fn==='function')try{return !!fn(layout,x,z,api.radius);}catch(_){return false;}
  return !layout.items.some(function(o){var b=fixtureSpec(api,o.id);if(b.flat)return false;var w=o.turn%2?b.d:b.w,d=o.turn%2?b.w:b.d;return Math.abs(x-o.x)<w/2+.24&&Math.abs(z-o.z)<d/2+.24;});
 }
 function route(api,layout,start,goal,roomId){
  if(typeof api.path==='function')return api.path(layout,start,goal,api.radius)||[];
  var step=.25,nx=39,nz=31,originX=-4.75,originZ=-3.75;
  function point(key){return {x:originX+(key%nx)*step,z:originZ+Math.floor(key/nx)*step};}
  function key(p){return clamp(Math.round((p.x-originX)/step),0,nx-1)+clamp(Math.round((p.z-originZ)/step),0,nz-1)*nx;}
  function usable(k){var p=point(k);return walkable(api,layout,p.x,p.z,roomId);}
  var begin=key(start),end=key(goal);
  if(!usable(end))return [];
  var open=[begin],seen=new Set([begin]),parent=new Map(),cost=new Map([[begin,0]]),score=new Map();
  function heuristic(k){var p=point(k);return Math.hypot(p.x-goal.x,p.z-goal.z);}
  score.set(begin,heuristic(begin));var reached=false,iterations=0;
  while(open.length&&iterations++<nx*nz){
   var best=0;for(var i=1;i<open.length;i++)if(score.get(open[i])<score.get(open[best]))best=i;
   var at=open.splice(best,1)[0];if(at===end){reached=true;break;}
   var ax=at%nx,az=Math.floor(at/nx);
   for(var dz=-1;dz<=1;dz++)for(var dx=-1;dx<=1;dx++){
    if(!dx&&!dz)continue;var xx=ax+dx,zz=az+dz;if(xx<0||xx>=nx||zz<0||zz>=nz)continue;
    var to=xx+zz*nx;if(!usable(to))continue;
    if(dx&&dz&&(!usable(ax+dx+az*nx)||!usable(ax+(az+dz)*nx)))continue;
    var next=cost.get(at)+Math.hypot(dx,dz)*step;
    if(!cost.has(to)||next<cost.get(to)){cost.set(to,next);parent.set(to,at);score.set(to,next+heuristic(to));if(!seen.has(to)){seen.add(to);open.push(to);}}
   }
  }
  if(!reached)return [];
  var out=[],cursor=end;while(cursor!==begin){out.push(point(cursor));cursor=parent.get(cursor);if(cursor===undefined)return [];}out.reverse();out.push({x:goal.x,z:goal.z});return out;
 }
 function loadThree(){if(!loading)loading=import('/static/vendor/three-0.160.1.module.js').catch(function(e){loading=null;throw e;});return loading;}
 function buildWorld(THREE,layout,api,doc){
  var scene=new THREE.Scene(),architecture=new THREE.Group(),objects=new THREE.Group(),geometries=new Set(),materials=new Set(),textures=new Set(),fixtures=new Map(),pickables=[],disposed=false;
  scene.add(architecture,objects);scene.background=new THREE.Color('#e9e9dc');
  var cache={},shapeCache={},sphere=new THREE.SphereGeometry(1,20,14),cylinder=new THREE.CylinderGeometry(1,1,1,20);geometries.add(sphere);geometries.add(cylinder);
  function mat(color,role){var key=color+':'+role;if(!cache[key]){var rough=role==='ceramic'?.42:role==='gold'?.4:role==='cloth'?.9:.76;cache[key]=new THREE.MeshStandardMaterial({color:color,roughness:rough,metalness:role==='gold'?.23:0});materials.add(cache[key]);}return cache[key];}
  function own(g){geometries.add(g);return g;}
  function mesh(g,m,parent,x,y,z){var o=new THREE.Mesh(g,typeof m==='string'?mat(m):m);o.position.set(x||0,y||0,z||0);o.castShadow=true;o.receiveShadow=true;(parent||architecture).add(o);return o;}
  function rounded(w,h,d,r){var key=['box',w,h,d,r||.06].join(':');if(shapeCache[key])return shapeCache[key];var g=new THREE.BoxGeometry(w,h,d,4,4,4),a=g.attributes.position,v=new THREE.Vector3(),p=new THREE.Vector3(),rad=Math.min(r||.06,w/2,h/2,d/2);
   for(var i=0;i<a.count;i++){v.fromBufferAttribute(a,i);p.set(clamp(v.x,-w/2+rad,w/2-rad),clamp(v.y,-h/2+rad,h/2-rad),clamp(v.z,-d/2+rad,d/2-rad));v.sub(p).normalize().multiplyScalar(rad).add(p);a.setXYZ(i,v.x,v.y,v.z);}g.computeVertexNormals();shapeCache[key]=own(g);return g;}
  function box(parent,w,h,d,color,x,y,z,r,role){return mesh(rounded(w,h,d,r),mat(color,role),parent,x,y,z);}
  function ball(parent,color,x,y,z,rx,ry,rz,role){var o=mesh(sphere,mat(color,role),parent,x,y,z);o.scale.set(rx,ry,rz);return o;}
  function cyl(parent,color,x,y,z,r,h,role){var o=mesh(cylinder,mat(color,role),parent,x,y,z);o.scale.set(r,h,r);return o;}
  function torus(r,tube,arc){var key=['torus',r,tube,arc||TAU].join(':');return shapeCache[key]||(shapeCache[key]=own(new THREE.TorusGeometry(r,tube,8,32,arc||TAU)));}
  function ring(parent,color,x,y,z,r,tube,role){var o=mesh(torus(r,tube),mat(color,role),parent,x,y,z);return o;}
  // Decorative repetitions share GPU geometry and one instanced draw per material.
  function batch(group){group.updateMatrixWorld(true);var sets=new Map();group.traverse(function(o){if(!o.isMesh)return;var flag=o.userData.cameraWall||'',key=o.geometry.uuid+':'+o.material.uuid+':'+flag;if(!sets.has(key))sets.set(key,{geometry:o.geometry,material:o.material,flag:flag,matrices:[]});sets.get(key).matrices.push(o.matrixWorld.clone());});while(group.children.length)group.remove(group.children[0]);sets.forEach(function(s){var m=new THREE.InstancedMesh(s.geometry,s.material,s.matrices.length);s.matrices.forEach(function(matrix,i){m.setMatrixAt(i,matrix);});m.instanceMatrix.needsUpdate=true;m.castShadow=true;m.receiveShadow=true;if(s.flag)m.userData.cameraWall=s.flag;group.add(m);});}
  function disposeInstances(group){group.traverse(function(o){if(o.isInstancedMesh)o.dispose();});}
  function flower(parent,x,y,z,s){var colors=['#e6b9c8','#f5e7cb','#d6bfdc'];cyl(parent,'#83a181',x,y+s*.25,z,s*.018,s*.5);for(var i=0;i<5;i++){var a=i*TAU/5;ball(parent,colors[i%3],x+Math.sin(a)*s*.1,y+s*.54,z+Math.cos(a)*s*.1,s*.09,s*.05,s*.09,'cloth');}ball(parent,'#d2b478',x,y+s*.57,z,s*.05,s*.04,s*.05);}
  function jar(parent,x,y,z,color,s){cyl(parent,color,x,y+s*.2,z,s*.16,s*.35,'ceramic');cyl(parent,'#cfb47e',x,y+s*.4,z,s*.17,s*.06,'gold');ball(parent,'#f6ecd8',x,y+s*.26,z+s*.158,s*.085,s*.07,s*.012);}
  function teacup(parent,x,y,z,s){cyl(parent,'#fff0d9',x,y+s*.08,z,s*.12,s*.15,'ceramic');cyl(parent,'#c4d8ca',x,y+s*.16,z,s*.115,s*.025,'ceramic');var h=ring(parent,'#eed8ae',x+s*.16,y+s*.09,z,s*.065,s*.015,'gold');h.rotation.y=Math.PI/2;}
  function vase(parent,x,y,z,s){cyl(parent,'#dce6d7',x,y+s*.2,z,s*.2,s*.35,'ceramic');for(var i=0;i<3;i++)flower(parent,x+Math.sin(i*2.4)*s*.12,y+s*.35,z+Math.cos(i*2.4)*s*.12,s*.6);}
  function geometryFloor(){
   box(architecture,10.2,.22,8.2,'#c5a47c',0,-.14,0,.09);box(architecture,10,.07,8,'#eee4ce',0,-.015,0,.03);
   for(var x=-4.5;x<5;x+=1)for(var z=-3.5;z<4;z+=1){box(architecture,.985,.012,.985,(Math.round(x+z)%2)?'#f0e5cf':'#e7d9bc',x,.026,z,.025);}
   box(architecture,10,.09,.12,'#cdb47d',0,.03,-3.91,.025,'gold');box(architecture,.12,.09,8,'#cdb47d',-4.91,.03,0,.025,'gold');box(architecture,.12,.09,8,'#cdb47d',4.91,.03,0,.025,'gold');
   var back=box(architecture,10.1,3.2,.16,'#f4eada',0,1.6,-4.03,.04);back.name='shop-back-wall';back.userData.cameraWall='back';
   var side=box(architecture,.16,3.2,8.1,'#e8ded0',-5.03,1.6,0,.04);side.name='shop-left-wall';side.userData.cameraWall='left';
   box(architecture,10.1,.12,.22,'#e1c99e',0,3.16,-3.96,.03,'gold');box(architecture,.22,.12,8.1,'#e1c99e',-4.96,3.16,0,.03,'gold');
   for(var wx=-3.3;wx<=3.4;wx+=3.3){var window=new THREE.Group();window.position.set(wx,1.95,-3.9);architecture.add(window);box(window,1.3,1.55,.08,'#bed8cb',0,0,0,.07);box(window,1.42,.09,.11,'#cfb582',0,.79,.05,.03,'gold');box(window,1.42,.09,.11,'#cfb582',0,-.79,.05,.03,'gold');box(window,.05,1.5,.12,'#f8eedb',0,0,.06,.02);box(window,1.3,.05,.12,'#f8eedb',0,.08,.06,.02);
    for(var sign=-1;sign<=1;sign+=2){for(var fold=0;fold<4;fold++)cyl(window,fold%2?'#f0ded5':'#f7eadd',sign*(.74+fold*.055),-.015,.11,.05,1.7,'cloth');ball(window,'#dbc292',sign*.84,-.25,.18,.18,.04,.055,'gold');}}
   // Front doorway is open and its landing remains clear for walking.
   box(architecture,.12,.08,.45,'#d5b984',-.7,.06,3.76,.03,'gold');box(architecture,.12,.08,.45,'#d5b984',.7,.06,3.76,.03,'gold');box(architecture,1.5,.03,.55,'#e3cbbb',0,.039,3.72,.09,'cloth');
   for(var sign=-1;sign<=1;sign+=2){var lamp=new THREE.Group();lamp.position.set(sign*4.35,0,-3.5);architecture.add(lamp);cyl(lamp,'#c0a476',0,.05,0,.27,.08,'gold');cyl(lamp,'#bca178',0,1.05,0,.025,2,'gold');cyl(lamp,'#f4e6ce',0,2.06,0,.36,.4,'cloth');cyl(lamp,'#d5bd8e',0,1.85,0,.35,.035,'gold');}
  }
  function buildCounter(){var g=new THREE.Group();box(g,2.35,1.05,.91,'#f1e3d2',0,.54,0,.08);for(var x=-1.02;x<=1.03;x+=.17)box(g,.035,.8,.035,'#dec6a6',x,.54,.47,.014);box(g,2.52,.055,1.02,'#d2b079',0,1.1,0,.04,'gold');box(g,2.56,.12,1.06,'#f6ecda',0,1.18,0,.1,'ceramic');box(g,.75,.04,.45,'#c7aa7c',-.55,1.265,.02,.08,'gold');for(var p=0;p<3;p++)ball(g,['#d7a877','#dfb18e','#e1c38b'][p],-.77+p*.23,1.35,.02,.12,.09,.09);jar(g,.58,1.25,-.14,'#c8dcca',.75);jar(g,.83,1.25,.12,'#e6c4cf',.55);vase(g,-.97,1.26,-.18,.4);return g;}
  function buildDisplay(){var g=new THREE.Group();box(g,1.55,2.45,.68,'#f1e2cb',0,1.23,0,.12);box(g,1.35,1.75,.05,'#c5d8c9',0,1.48,-.29,.06);mesh(torus(.61,.042,Math.PI),mat('#cfb080','gold'),g,0,2.0,.35);for(var side=-1;side<=1;side+=2)box(g,.075,1.45,.08,'#cfb080',side*.61,1.28,.35,.025,'gold');
   for(var y=.58;y<2.15;y+=.55){box(g,1.33,.065,.64,'#e4cdab',0,y,.04,.035);for(var j=0;j<3;j++)jar(g,-.4+j*.4,y+.04,0,['#d5e0cb','#e5c0ca','#f0dfb8'][j],.74);}box(g,1.69,.13,.79,'#ddc49d',0,2.5,.01,.08);return g;}
  function buildShelf(){var g=new THREE.Group();for(var side=-1;side<=1;side+=2)box(g,.08,2.22,.64,'#d8bd95',side*.72,1.14,0,.04);for(var y=.14;y<2.3;y+=.54){box(g,1.53,.08,.65,'#ead7b5',0,y,0,.035);for(var j=0;j<4;j++)if(y<1.8)jar(g,-.52+j*.35,y+.05,.02,['#c7d7c4','#e8c4cd','#e6d6b4','#d4c4dc'][j],.67);}box(g,1.48,.075,.06,'#d0b181',0,2.34,.33,.025,'gold');return g;}
  function buildTeaTable(){var g=new THREE.Group();cyl(g,'#d2b887',0,.45,0,.095,.83,'gold');for(var i=0;i<3;i++){var a=i*TAU/3;var foot=ball(g,'#cfb584',Math.sin(a)*.25,.12,Math.cos(a)*.25,.1,.07,.35,'gold');foot.rotation.y=a;}cyl(g,'#d5ba83',0,.9,0,.84,.045,'gold');cyl(g,'#f7eee0',0,.96,0,.87,.095,'ceramic');teacup(g,-.35,1.015,.05,.7);teacup(g,.31,1.015,.19,.7);vase(g,.05,1.015,-.23,.35);return g;}
  function buildChair(){var g=new THREE.Group();for(var x=-.25;x<=.25;x+=.5)for(var z=-.24;z<=.24;z+=.48)cyl(g,'#ceb58c',x,.34,z,.035,.64,'gold');box(g,.69,.1,.66,'#e7d2ac',0,.68,0,.14);box(g,.59,.08,.55,'#ead0d6',0,.76,.02,.14,'cloth');for(var side=-1;side<=1;side+=2)cyl(g,'#cdb285',side*.29,.99,-.25,.03,.68,'gold');var back=ring(g,'#d1b481',0,1.21,-.26,.3,.038,'gold');back.scale.y=1.15;box(g,.49,.44,.075,'#d5e2d4',0,1.18,-.26,.14,'cloth');return g;}
  function buildPlant(){var g=new THREE.Group();cyl(g,'#e9dcc3',0,.28,0,.34,.54,'ceramic');cyl(g,'#c8ad79',0,.54,0,.35,.045,'gold');for(var i=0;i<7;i++){var a=i*2.4,leaf=ball(g,i%2?'#89aa82':'#a5c197',Math.sin(a)*.22,.95+(i%3)*.14,Math.cos(a)*.22,.2,.4,.065);leaf.rotation.set(.2,a,-Math.sin(a)*.5);}return g;}
  function buildConsole(){var g=new THREE.Group();box(g,1.3,.13,.55,'#e9d4b3',0,.9,0,.08);for(var side=-1;side<=1;side+=2)box(g,.08,.85,.44,'#d1b28a',side*.53,.43,0,.05);vase(g,-.4,.99,0,.4);box(g,.36,.06,.28,'#b8cebe',.3,1.01,0,.05);return g;}
  function buildRug(){var g=new THREE.Group();box(g,2.8,.025,2.2,'#d9b9c7',0,.051,0,.28,'cloth');box(g,2.58,.026,1.98,'#efe0d7',0,.065,0,.25,'cloth');return g;}
  function buildShowcase(){var g=new THREE.Group();box(g,1.65,.55,.9,'#d0dfd0',0,.28,0,.08);box(g,1.65,.06,.9,'#d0b27e',0,.59,0,.04,'gold');for(var y=.65;y<1.05;y+=.3){box(g,1.5,.035,.78,'#f8edde',0,y,0,.04,'ceramic');for(var i=0;i<4;i++){ball(g,i%2?'#e6b7bc':'#d7ad7e',-.54+i*.36,y+.085,.04,.13,.08,.13);}}for(var side=-1;side<=1;side+=2)box(g,.035,.5,.035,'#c2a775',side*.78,.84,.4,.015,'gold');box(g,1.65,.05,.9,'#efe4cd',0,1.13,0,.08,'ceramic');return g;}
  var builders={counter:buildCounter,display:buildShowcase,shelf:buildDisplay,teaTable:buildTeaTable,chairA:buildChair,chairB:buildChair,plant:buildPlant,console:buildConsole,rug:buildRug};
  geometryFloor();batch(architecture);
  function draw(next){fixtures.forEach(function(g){disposeInstances(g);objects.remove(g);});fixtures.clear();pickables=[];
   next.items.forEach(function(o){var build=builders[o.id];if(!build)return;var g=build(),spec=fixtureSpec(api,o.id),bounds=new THREE.Box3().setFromObject(g),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());var contents=new THREE.Group();while(g.children.length)contents.add(g.children[0]);contents.position.set(-center.x,-bounds.min.y,-center.z);g.add(contents);batch(g);g.scale.set(spec.w/size.x,spec.h/size.y,spec.d/size.z);g.name='shop-fixture-'+o.id;g.position.set(o.x,.04,o.z);g.rotation.y=o.turn*Math.PI/2;g.traverse(function(m){if(m.isMesh){m.userData.fixtureId=o.id;pickables.push(m);}});objects.add(g);fixtures.set(o.id,g);g.userData.bounds=spec;});objects.updateMatrixWorld(true);}
  draw(layout);
  scene.add(new THREE.HemisphereLight('#fff7eb','#c3cbb6',1.15));var sun=new THREE.DirectionalLight('#fff5e6',2.05);sun.position.set(-4,8,6);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.radius=3;Object.assign(sun.shadow.camera,{left:-8,right:8,top:8,bottom:-8,near:.1,far:25});sun.shadow.normalBias=.025;scene.add(sun);
  var fill=new THREE.DirectionalLight('#e9e4ff',.3);fill.position.set(5,4,-3);scene.add(fill);
  return {scene:scene,fixtures:fixtures,get pickables(){return pickables;},draw:draw,geometries:geometries,materials:materials,textures:textures,
   dispose:function(){if(disposed)return;disposed=true;disposeInstances(scene);geometries.forEach(function(g){g.dispose();});materials.forEach(function(m){m.dispose();});textures.forEach(function(t){t.dispose();});sun.shadow.dispose();scene.clear();}};
 }
 async function mount(options){
  var opts=options||{},host=opts.host,doc=host&&host.ownerDocument,win=doc&&doc.defaultView,api=opts.layoutAPI||Layout;
  if(!host||!doc||!win||!api)return null;
  var roomId=opts.roomId==='cafe'?'cafe':'shop',layout=clone(opts.layout||api.defaultLayout(roomId));
  if(!validLayout(api,layout,roomId))return null;
  var dead=false,failed=false,ready=false,rendering=false,dirty=false,raf=null,renderer=null,model=null,observer=null,source=null,sourceTexture=null,lastUpload=-Infinity,lastPaint=-Infinity,lastTick=null,sourceAnchor=.08;
  var root=doc.createElement('section');root.className='ipg-shop-interior';root.setAttribute('aria-label',roomId==='cafe'?'カフェの店内':'マルシェの店内');
  var stage=doc.createElement('div');stage.className='ipg-shop-room-stage';stage.tabIndex=0;stage.setAttribute('role','region');stage.setAttribute('aria-label','店内。地面をタップ、または矢印キーやWASDで歩けます。入口へ進むと外へ戻れます。');root.appendChild(stage);host.appendChild(root);
  var removers=[],editing=!!opts.editing,cameraView=cameraState(opts.camera),position={x:0,z:2.6},heading=cameraView.yaw,travelled=0,walkingNow=false,held=new Set(),path=[],exitIntent=false,exitDwell=0,exited=false,drag=null,selected=null,undoStack=[],initial=clone(layout),sprite,shadow,camera,topCamera,ray,pointer,selection,selectionGeo;
  var media=win.matchMedia?win.matchMedia('(prefers-reduced-motion: reduce)'):null,reduced=!!(media&&media.matches);
  if(opts.position&&walkable(api,layout,opts.position.x,opts.position.z,roomId))position={x:opts.position.x,z:opts.position.z};
  function active(){if(dead||failed||!root.isConnected||doc.hidden)return false;try{return !opts.canRun||!!opts.canRun();}catch(_){return false;}}
  function inputAllowed(){if(!active())return false;if(editing)return true;try{return !opts.canWalk||!!opts.canWalk();}catch(_){return false;}}
  function report(k,v){if(typeof opts[k]==='function')try{opts[k](v);}catch(_){}}
  function interactive(target){for(var at=target;at;at=at.parentNode)if(/^(INPUT|TEXTAREA|SELECT|BUTTON|FORM|A|SUMMARY)$/.test(at.tagName)||at.isContentEditable)return true;return false;}
  function keyboardTarget(target){var scope=opts.keyboardScope;return !!target&&!interactive(target)&&(target===stage||stage.contains&&stage.contains(target)||scope&&scope.contains&&scope.contains(stage)&&(target===scope||scope.contains(target)));}
  function manualInput(intent){if(!editing)report('onManualInput',intent);if(inputAllowed())return true;cancelDrag();stop();requestRender();return false;}
  function listen(t,n,f){if(t&&t.addEventListener){t.addEventListener(n,f);removers.push(function(){t.removeEventListener(n,f);});}}
  function moving(){return !editing&&!exited&&inputAllowed()&&(held.size>0||path.length>0||exitIntent);}
  function cancelFrame(){if(raf!==null){win.cancelAnimationFrame(raf);raf=null;}lastTick=null;}
  function stop(){held.clear();path=[];exitIntent=false;exitDwell=0;walkingNow=false;}
  function sourceSize(c){return c&&c.tagName==='IMG'?c.complete&&c.naturalWidth>0&&c.naturalHeight>0?{w:c.naturalWidth,h:c.naturalHeight}:null:c&&c.tagName==='CANVAS'&&c.width>0&&c.height>0?{w:c.width,h:c.height}:null;}
  function anchor(c){var gl=c.getContext&&c.getContext('webgl');if(!gl)return null;var w=c.width,h=c.height,data=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,data);for(var y=0;y<h;y++)for(var x=0;x<w;x++)if(data[(y*w+x)*4+3]>=31)return y/h;return null;}
  function syncSelection(){var o=layout.items.find(function(x){return x.id===selected;});selection.visible=!!(editing&&o);if(o){var spec=fixtureSpec(api,o.id),w=o.turn%2?spec.d:spec.w,d=o.turn%2?spec.w:spec.d;selection.position.set(o.x,.095,o.z);selection.scale.set(w+.13,d+.13,1);}stage.dataset.selectedId=selected||'';report('onSelection',selected);}
  function currentCamera(){return editing?topCamera:camera;}
  function syncCamera(){if(editing){var box=stage.getBoundingClientRect(),aspect=box.width/Math.max(1,box.height),v=Math.max(8.8,10.6/aspect);topCamera.left=-v*aspect/2;topCamera.right=v*aspect/2;topCamera.top=v/2;topCamera.bottom=-v/2;topCamera.up.set(0,0,-1);topCamera.position.set(0,15,0);topCamera.lookAt(0,0,0);topCamera.updateProjectionMatrix();topCamera.updateMatrixWorld(true);return;}
   var target=new THREE.Vector3(clamp(position.x,-3.5,3.5),.75,clamp(position.z,-2.6,2.6));var v=cameraView,renderDistance=v.distance/Math.min(1,camera.aspect/.65);
   camera.position.set(target.x+Math.sin(v.yaw)*Math.cos(v.pitch)*renderDistance,target.y+Math.sin(v.pitch)*renderDistance,target.z+Math.cos(v.yaw)*Math.cos(v.pitch)*renderDistance);camera.lookAt(target);camera.updateMatrixWorld(true);
   model.scene.traverse(function(o){if(o.userData.cameraWall==='left')o.visible=camera.position.x>-3.7;else if(o.userData.cameraWall==='back')o.visible=camera.position.z>-2.8;});
   stage.dataset.camera=JSON.stringify(Object.assign({},cameraView,{renderDistance:renderDistance}));
  }
  function render(stamp){if(!active()||!renderer)return false;try{rendering=true;syncCamera();if(sprite){sprite.position.set(position.x,.04,position.z);sprite.visible=!!sourceTexture&&!editing;sprite.updateMatrixWorld(true);shadow.position.set(position.x,.045,position.z);shadow.visible=sprite.visible;shadow.updateMatrixWorld(true);}
    if(ready&&!editing)report('onFacing',{yawDeg:((heading-cameraView.yaw)*180/Math.PI%360+360)%360,walking:walkingNow&&inputAllowed(),distance:travelled});
    renderer.render(model.scene,currentCamera());if(renderer.info){stage.dataset.renderCalls=String(renderer.info.render.calls);stage.dataset.triangles=String(renderer.info.render.triangles);}
    stage.dataset.position=JSON.stringify(position);stage.dataset.walking=String(walkingNow);stage.dataset.editing=String(editing);dirty=false;lastPaint=finite(stamp)?stamp:0;return true;
   }catch(_){fail('shop_render_failed');return false;}finally{rendering=false;}}
  function schedule(){if(active()&&ready&&raf===null&&(dirty||moving()))raf=win.requestAnimationFrame(tick);}
  function requestRender(){dirty=true;schedule();}
  function safeStep(dx,dz){if(typeof api.move==='function'){var next=api.move(layout,position,dx,dz,api.radius);if(next){position={x:next.x,z:next.z};return !next.blocked;}return false;}var length=Math.hypot(dx,dz),steps=Math.max(1,Math.ceil(length/.06)),moved=false;for(var i=0;i<steps;i++){var nx=position.x+dx/steps,nz=position.z+dz/steps;if(walkable(api,layout,nx,nz,roomId)){position={x:nx,z:nz};moved=true;}else if(walkable(api,layout,nx,position.z,roomId)){position.x=nx;moved=true;}else if(walkable(api,layout,position.x,nz,roomId)){position.z=nz;moved=true;}}return moved;}
  function advance(dt){if(!active()||editing||exited)return;var dx=0,dz=0,wasWalking=walkingNow;walkingNow=false;if(!inputAllowed()){cancelDrag();stop();if(wasWalking)dirty=true;return;}
   if(held.size){dx=(held.has('right')?1:0)-(held.has('left')?1:0);dz=(held.has('front')?1:0)-(held.has('back')?1:0);var projected=direction(dx,dz,cameraView.yaw);dx=projected.x;dz=projected.z;}
   else if(path.length){while(path.length&&Math.hypot(path[0].x-position.x,path[0].z-position.z)<.06)path.shift();if(path.length){dx=path[0].x-position.x;dz=path[0].z-position.z;}}
   if(!held.size&&!path.length&&exitIntent){dx=-position.x;dz=3.95-position.z;}
   var length=Math.hypot(dx,dz);if(length>.001){dx/=length;dz/=length;heading=Math.atan2(dx,dz);var old={x:position.x,z:position.z},step=held.size||exitIntent?2*dt:Math.min(length,2*dt);safeStep(dx*step,dz*step);var dist=Math.hypot(position.x-old.x,position.z-old.z);travelled+=dist;walkingNow=dist>.0001;if(dist>0){report('onPosition',clone(position));dirty=true;}
    if(position.z>=3.42&&Math.abs(position.x)<.59&&dz>.45){exitDwell+=dt;if(exitDwell>=.35){exited=true;stop();report('onExit',{roomId:roomId,position:clone(position)});return;}}else exitDwell=0;
   }else{exitDwell=0;if(!held.size&&!path.length)exitIntent=false;}if(wasWalking!==walkingNow)dirty=true;
  }
  function tick(stamp){raf=null;if(!active()){stop();cancelFrame();return;}var dt=lastTick===null?0:clamp((stamp-lastTick)/1000,0,.05);lastTick=stamp;advance(dt);if(dirty&&stamp-lastPaint>=32)render(stamp);schedule();}
  function resize(){if(!active()||!renderer)return;var b=stage.getBoundingClientRect();if(!(b.width>0&&b.height>0))return;renderer.setSize(b.width,b.height,false);camera.aspect=b.width/b.height;camera.updateProjectionMatrix();requestRender();}
  function fail(code){if(dead||failed)return;failed=true;destroy();report('onFailure',code);}
  function destroy(){if(dead)return;cancelDrag();dead=true;cancelFrame();stop();if(observer)observer.disconnect();removers.forEach(function(fn){try{fn();}catch(_){}});removers=[];if(sourceTexture)sourceTexture.dispose();if(model)model.dispose();if(renderer){try{renderer.renderLists.dispose();renderer.dispose();renderer.forceContextLoss();}catch(_){}}root.remove();}
  function remember(){undoStack.push(clone(layout));if(undoStack.length>30)undoStack.shift();}
  function emitDraft(){report('onDraft',clone(layout));}
  function redrawLayout(){model.draw(layout);if(renderer)renderer.shadowMap.needsUpdate=true;}
  function replaceLayout(next,rememberBefore){if(!validLayout(api,next,roomId))return false;if(rememberBefore)remember();layout=clone(next);if(!layout.items.some(function(x){return x.id===selected;}))selected=null;redrawLayout();syncSelection();emitDraft();requestRender();return true;}
  function releasePointer(id){try{if(stage.hasPointerCapture&&stage.hasPointerCapture(id))stage.releasePointerCapture(id);}catch(_){}}
  function cancelDrag(){if(!drag)return;var d=drag;drag=null;releasePointer(d.id);if(d.kind==='edit'&&d.before){layout=d.before;redrawLayout();syncSelection();requestRender();}}
  function groundEvent(e){var b=stage.getBoundingClientRect();if(!b.width||!b.height)return null;pointer.set((e.clientX-b.left)/b.width*2-1,-((e.clientY-b.top)/b.height)*2+1);ray.setFromCamera(pointer,currentCamera());var plane=new THREE.Plane(new THREE.Vector3(0,1,0),-.04),p=new THREE.Vector3();return ray.ray.intersectPlane(plane,p)?p:null;}
  var controller={destroy:destroy,setFrame:function(c,metadata){var size=sourceSize(c);if(!active()||!renderer||!size)return false;try{var stamp=win.performance?win.performance.now():Date.now(),changed=source!==c;if(!changed&&!reduced&&stamp-lastUpload<32)return true;if(changed){var foot=metadata&&finite(metadata.anchor)?metadata.anchor:c.tagName==='CANVAS'?anchor(c):.08;if(foot===null)return false;if(sourceTexture)sourceTexture.dispose();sourceTexture=new THREE.CanvasTexture(c);sourceTexture.colorSpace=THREE.SRGBColorSpace;sourceTexture.generateMipmaps=false;sourceTexture.minFilter=THREE.LinearFilter;source=c;sourceAnchor=foot;sprite.material.map=sourceTexture;sprite.material.needsUpdate=true;}sprite.center.set(.5,sourceAnchor);sprite.scale.set(1.65*size.w/size.h,1.65,1);sourceTexture.needsUpdate=true;renderer.initTexture(sourceTexture);lastUpload=stamp;if(!ready){ready=true;render(stamp);root.dataset.ready='true';report('onReady',controller);schedule();}else if(!rendering)requestRender();return true;}catch(_){fail('shop_frame_unavailable');return false;}},
   setEditing:function(value){if(!active())return false;cancelDrag();stop();editing=!!value;if(!editing&&!walkable(api,layout,position.x,position.z,roomId)){position={x:0,z:2.6};report('onPosition',clone(position));}syncSelection();stage.setAttribute('aria-label',editing?'お店の配置。家具を押したまま動かせます。':'店内。地面をタップ、または矢印キーやWASDで歩けます。入口へ進むと外へ戻れます。');requestRender();return true;},
   getLayout:function(){return clone(layout);},getSelection:function(){return selected;},
   rotateSelected:function(){if(!active()||!editing||!selected)return false;cancelDrag();var next=clone(layout),item=next.items.find(function(o){return o.id===selected;});item.turn=(item.turn+1)%4;return replaceLayout(next,true);},
   removeSelected:function(){if(!active()||!editing||!selected)return false;cancelDrag();var next=clone(layout);next.items=next.items.filter(function(o){return o.id!==selected;});return replaceLayout(next,true);},
   add:function(id){if(!active()||!editing||layout.items.some(function(o){return o.id===id;})||!catalog(api).some(function(o){return o.id===id;}))return false;cancelDrag();var home=api.defaultLayout(roomId).items.find(function(o){return o.id===id;});if(!home)return false;var next=clone(layout);next.items.push(home);if(validLayout(api,next,roomId)){selected=id;return replaceLayout(next,true);}for(var z=-3.5;z<=3.5;z+=.25)for(var x=-4.5;x<=4.5;x+=.25){home.x=x;home.z=z;if(validLayout(api,next,roomId)){selected=id;return replaceLayout(next,true);}}return false;},
   undo:function(){if(!active()||!editing||!undoStack.length)return false;cancelDrag();return replaceLayout(undoStack.pop(),false);},
   reset:function(){if(!active()||!editing)return false;cancelDrag();return replaceLayout(initial,true);},
   select:function(id){if(!active()||!editing||!layout.items.some(function(o){return o.id===id;}))return false;cancelDrag();selected=id;syncSelection();requestRender();return true;},
   camera:function(){return clone(cameraView);},position:function(){return clone(position);},stop:function(){stop();requestRender();}
  };
  var THREE;
  try{THREE=opts.three||await loadThree();}catch(_){fail('shop_module_unavailable');return null;}
  if(!active()){destroy();return null;}
  try{
   model=buildWorld(THREE,layout,api,doc);renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:false});renderer.setPixelRatio(Math.min(win.devicePixelRatio||1,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;
   var canvas=renderer.domElement;canvas.className='ipg-shop-room-canvas';canvas.setAttribute('aria-hidden','true');stage.appendChild(canvas);
   camera=new THREE.PerspectiveCamera(48,1,.05,45);topCamera=new THREE.OrthographicCamera(-6,6,6,-6,.05,40);ray=new THREE.Raycaster();pointer=new THREE.Vector2();
   var sm=new THREE.SpriteMaterial({transparent:true,alphaTest:.12,depthTest:true,depthWrite:true});model.materials.add(sm);sprite=new THREE.Sprite(sm);sprite.name='canonical-shop-pet-frame';sprite.visible=false;model.scene.add(sprite);
   var shade=new Uint8Array(32*32*4);for(var sy=0;sy<32;sy++)for(var sx=0;sx<32;sx++){var si=(sy*32+sx)*4,fade=Math.max(0,1-Math.hypot((sx-15.5)/15.5,(sy-15.5)/15.5));shade[si]=shade[si+1]=shade[si+2]=255;shade[si+3]=Math.round(255*fade*fade);}var shadowMap=new THREE.DataTexture(shade,32,32,THREE.RGBAFormat);shadowMap.needsUpdate=true;model.textures.add(shadowMap);
   var shadowMaterial=new THREE.MeshBasicMaterial({color:'#656c57',map:shadowMap,transparent:true,opacity:.29,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});model.materials.add(shadowMaterial);var sg=new THREE.PlaneGeometry(.95,.62);model.geometries.add(sg);shadow=new THREE.Mesh(sg,shadowMaterial);shadow.name='shop-pet-contact-shadow';shadow.rotation.x=-Math.PI/2;shadow.visible=false;model.scene.add(shadow);
   var selectionMaterial=new THREE.MeshBasicMaterial({color:'#8ab9ad',transparent:true,opacity:.22,depthWrite:false,side:THREE.DoubleSide});model.materials.add(selectionMaterial);selectionGeo=new THREE.PlaneGeometry(1,1);model.geometries.add(selectionGeo);selection=new THREE.Mesh(selectionGeo,selectionMaterial);selection.rotation.x=-Math.PI/2;model.scene.add(selection);syncSelection();
   function focus(){try{stage.focus({preventScroll:true});}catch(_){}}
   listen(stage,'pointerdown',function(e){if(!active()||!ready||e.button!==0||e.isPrimary===false||!finite(e.clientX)||!finite(e.clientY)||interactive(e.target))return;if(!manualInput({kind:'pointer',pointerId:e.pointerId}))return;focus();var p=groundEvent(e);if(!p)return;stop();drag={id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false,kind:editing?'edit':'camera'};if(editing){var hits=ray.intersectObjects(model.pickables,false),hit=hits.find(function(h){return !!h.object.userData.fixtureId;});if(!hit){selected=null;syncSelection();drag=null;requestRender();return;}selected=hit.object.userData.fixtureId;syncSelection();var obj=layout.items.find(function(o){return o.id===selected;});drag.before=clone(layout);drag.offsetX=obj.x-p.x;drag.offsetZ=obj.z-p.z;}try{stage.setPointerCapture(e.pointerId);}catch(_){}});
   listen(stage,'pointermove',function(e){if(!inputAllowed()){cancelDrag();stop();requestRender();return;}if(!drag||e.pointerId!==drag.id)return;if(!drag.moved&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<8)return;drag.moved=true;if(editing&&drag.kind==='edit'){var p=groundEvent(e);if(!p)return;var next=clone(layout),o=next.items.find(function(x){return x.id===selected;});if(!o)return;o.x=Math.round((p.x+drag.offsetX)*4)/4;o.z=Math.round((p.z+drag.offsetZ)*4)/4;if(validLayout(api,next,roomId)){layout=next;redrawLayout();syncSelection();requestRender();}}
    else if(drag.kind==='camera'){cameraView=cameraState({yaw:cameraView.yaw-(e.clientX-drag.x)*.007,pitch:cameraView.pitch+(e.clientY-drag.y)*.003,distance:cameraView.distance});report('onCamera',clone(cameraView));requestRender();}drag.x=e.clientX;drag.y=e.clientY;if(e.cancelable)e.preventDefault();});
   function end(e,cancelled){if(!drag||e.pointerId!==undefined&&drag.id!==e.pointerId)return;var d=drag;if(cancelled||!ready||!inputAllowed()){cancelDrag();stop();requestRender();return;}drag=null;releasePointer(d.id);if(d.kind==='edit'){if(d.before&&JSON.stringify(d.before)!==JSON.stringify(layout)){undoStack.push(d.before);if(undoStack.length>30)undoStack.shift();emitDraft();}return;}if(d.moved||editing)return;var p=groundEvent(e);if(!p)return;stop();var goal={x:clamp(p.x,-4.6,4.6),z:clamp(p.z,-3.6,3.6)};exitIntent=Math.abs(p.x)<.6&&p.z>3.3;if(exitIntent)goal={x:0,z:3.6};path=route(api,layout,position,goal,roomId);if(!path.length)exitIntent=false;requestRender();}
   listen(win,'pointerup',function(e){end(e,false);});listen(win,'pointercancel',function(e){end(e,true);});
   function key(e,down){var k={ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right',ArrowUp:'back',w:'back',W:'back',ArrowDown:'front',s:'front',S:'front'}[e.key];if(!k)return;if(!down){if(held.has(k)){held.delete(k);if(!held.size)walkingNow=false;requestRender();}return;}if(!active()||!ready||editing||e.isComposing||e.altKey||e.ctrlKey||e.metaKey||!keyboardTarget(e.target))return;if(e.repeat&&!held.has(k)){if(e.cancelable)e.preventDefault();return;}if(!held.has(k)){if(!manualInput({kind:'keyboard',key:e.key}))return;}else if(!inputAllowed()){cancelDrag();stop();requestRender();return;}path=[];exitIntent=false;held.add(k);requestRender();if(e.cancelable)e.preventDefault();}
   listen(win,'keydown',function(e){key(e,true);});listen(win,'keyup',function(e){key(e,false);});
   function suspend(){cancelDrag();stop();cancelFrame();}
   listen(stage,'lostpointercapture',function(e){if(drag&&e.pointerId===drag.id)cancelDrag();});
   listen(win,'blur',suspend);listen(win,'pagehide',suspend);listen(doc,'visibilitychange',function(){suspend();if(!doc.hidden)requestRender();});
   listen(win,'focus',requestRender);listen(win,'pageshow',requestRender);
   if(media)listen(media,'change',function(){reduced=!!media.matches;suspend();requestRender();});
   listen(canvas,'webglcontextlost',function(e){e.preventDefault();fail('shop_context_lost');});
   if(win.ResizeObserver){observer=new win.ResizeObserver(resize);observer.observe(stage);}else listen(win,'resize',resize);
   resize();if(editing){ready=true;render(0);root.dataset.ready='true';report('onReady',controller);}return controller;
  }catch(_){fail('shop_renderer_unavailable');return null;}
 }
 return Object.freeze({mount:mount,buildWorld:buildWorld,route:route,walkable:walkable,cameraState:cameraState,direction:direction});
});

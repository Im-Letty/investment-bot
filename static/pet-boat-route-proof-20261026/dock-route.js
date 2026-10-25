/* Technical river landing/route proof. No game state, storage, prices or collision writes. */
(function(root,factory){'use strict';var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PetBoatLandingProof=api;}(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
var EPS=.002,MAX_POINTS=256;
function finite(n){return typeof n==='number'&&Number.isFinite(n);}
function point(p){return !!p&&finite(p.x)&&finite(p.y);}
function copy(p){return{x:p.x,y:p.y};}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
function freeze(o){if(o&&typeof o==='object'){Object.keys(o).forEach(function(k){freeze(o[k]);});Object.freeze(o);}return o;}
function segmentPoint(p,a,b){var dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)):0;return Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t);}
function cross(a,b,c){return(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);}
function intersects(a,b,c,d){
 var ab1=cross(a,b,c),ab2=cross(a,b,d),cd1=cross(c,d,a),cd2=cross(c,d,b);
 if(ab1*ab2<0&&cd1*cd2<0)return true;
 return Math.abs(ab1)<EPS&&segmentPoint(c,a,b)<EPS||Math.abs(ab2)<EPS&&segmentPoint(d,a,b)<EPS||Math.abs(cd1)<EPS&&segmentPoint(a,c,d)<EPS||Math.abs(cd2)<EPS&&segmentPoint(b,c,d)<EPS;
}
function segmentDistance(a,b,c,d){return intersects(a,b,c,d)?0:Math.min(segmentPoint(a,c,d),segmentPoint(b,c,d),segmentPoint(c,a,b),segmentPoint(d,a,b));}
function inside(p,polygon){
 var hit=false;
 for(var i=0,j=polygon.length-1;i<polygon.length;j=i++){
  var a=polygon[i],b=polygon[j];if(segmentPoint(p,a,b)<EPS)return true;
  if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;
 }
 return hit;
}
function edges(poly){return poly.map(function(p,i){return[p,poly[(i+1)%poly.length]];});}
function rectangle(b){return[{x:b.x0,y:b.y0},{x:b.x1,y:b.y0},{x:b.x1,y:b.y1},{x:b.x0,y:b.y1}];}
function geometryOK(g){
 if(!g||g.version!==1||!finite(g.width)||!finite(g.height)||g.width<100||g.height<100||g.width>100000||g.height>100000||!finite(g.scale)||g.scale<=0||!point(g.origin)||!finite(g.floorHeight)||!finite(g.waterHeight)||g.floorHeight<=g.waterHeight)return false;
 if(!Array.isArray(g.land)||g.land.length<3||g.land.length>MAX_POINTS||!g.land.every(function(p){return point(p)&&p.x>=-EPS&&p.y>=-EPS&&p.x<=g.width+EPS&&p.y<=g.height+EPS;}))return false;
 if(!g.bridge||!['x0','y0','x1','y1','top'].every(function(k){return finite(g.bridge[k]);})||g.bridge.x1<=g.bridge.x0||g.bridge.y1<=g.bridge.y0)return false;
 if(!Array.isArray(g.places)||g.places.length>64||!g.places.every(function(p){return typeof p.id==='string'&&point(p)&&finite(p.rx)&&finite(p.ry)&&p.rx>0&&p.ry>0&&point(p.entrance);}))return false;
 if(new Set(g.places.map(function(p){return p.id;})).size!==g.places.length)return false;
 if(!g.fishing||!point(g.fishing.position)||!point(g.fishing.target)||!finite(g.fishing.radius)||g.fishing.radius<0)return false;
 var e=edges(g.land);
 for(var i=0;i<e.length;i++){if(dist(e[i][0],e[i][1])<EPS)return false;for(var j=i+1;j<e.length;j++)if(j!==i+1&&!(i===0&&j===e.length-1)&&intersects(e[i][0],e[i][1],e[j][0],e[j][1]))return false;}
 return true;
}
function extract(THREE,Scene,model,world,fishing){
 if(!THREE||!Scene||!model||!world||!Array.isArray(model.surfaces))throw Error('missing_source_geometry');
 var lands=model.surfaces.filter(function(s){return s.name==='dry-land';}),bridges=model.surfaces.filter(function(s){return s.name==='bridge-deck';});
 if(lands.length!==1||bridges.length!==1)throw Error('ambiguous_source_surface');
 model.scene.updateMatrixWorld(true);
 var land=lands[0],p=land.geometry.attributes.position,index=land.geometry.index;if(!p||p.count>MAX_POINTS||!index||index.count%3||index.count>4096)throw Error('unbounded_land_geometry');
 var vertices=[],ids=[],unique=new Map(),v=new THREE.Vector3(),floor=null;
 for(var i=0;i<p.count;i++){
  v.fromBufferAttribute(p,i).applyMatrix4(land.matrixWorld);var q=Scene.townPoint(world,v);
  if(!point(q)||!finite(v.y))throw Error('nonfinite_land_geometry');
  if(floor!==null&&Math.abs(v.y-floor)>1e-4)throw Error('nonplanar_land_geometry');floor=v.y;
  var key=Math.round(q.x*1000)+':'+Math.round(q.y*1000);
  if(!unique.has(key)){unique.set(key,vertices.length);vertices.push(copy(q));}ids.push(unique.get(key));
 }
 var boundary=new Map();
 for(var t=0;t<index.count;t+=3){
  var a=[0,1,2].map(function(k){return ids[index.getX(t+k)];});if(a.some(function(n){return n===undefined;}))throw Error('invalid_land_index');
  if(new Set(a).size<3)continue;
  for(var j=0;j<3;j++){var x=a[j],y=a[(j+1)%3],key=Math.min(x,y)+':'+Math.max(x,y),row=boundary.get(key)||{a:x,b:y,count:0};row.count++;boundary.set(key,row);}
 }
 var graph=new Map(),outer=[];
 boundary.forEach(function(e){if(e.count>2)throw Error('nonmanifold_land');if(e.count===1){outer.push(e);[e.a,e.b].forEach(function(k){if(!graph.has(k))graph.set(k,[]);});graph.get(e.a).push(e.b);graph.get(e.b).push(e.a);}});
 if(!outer.length||Array.from(graph.values()).some(function(a){return a.length!==2;}))throw Error('invalid_land_boundary');
 var start=Math.min.apply(null,Array.from(graph.keys())),current=start,previous=-1,polygon=[];
 do{polygon.push(copy(vertices[current]));var next=graph.get(current).filter(function(k){return k!==previous;})[0];previous=current;current=next;if(polygon.length>graph.size)throw Error('land_boundary_cycle');}while(current!==start);
 if(polygon.length!==graph.size)throw Error('multiple_land_boundaries');
 function box(o){var b=new THREE.Box3().setFromObject(o),a=Scene.townPoint(world,b.min),z=Scene.townPoint(world,b.max);return{x0:Math.min(a.x,z.x),y0:Math.min(a.y,z.y),x1:Math.max(a.x,z.x),y1:Math.max(a.y,z.y),top:b.max.y};}
 var water=model.scene.getObjectByName('water');if(!water)throw Error('missing_water_geometry');
 var zero=Scene.townPoint(world,{x:0,z:0}),one=Scene.townPoint(world,{x:1,z:0});
 var g={version:1,width:world.width,height:world.height,scale:one.x-zero.x,origin:copy(zero),floorHeight:floor,waterHeight:box(water).top,land:polygon,bridge:box(bridges[0]),places:world.places.map(function(p){return{id:p.id,x:p.footprint.x,y:p.footprint.y,rx:p.footprint.rx,ry:p.footprint.ry,entrance:copy(p.entrance)};}),fishing:{position:copy(fishing.position),target:copy(fishing.target),radius:fishing.radius}};
 if(!geometryOK(g))throw Error('invalid_source_geometry');return freeze(g);
}
function bankAt(g,y){
 if(!geometryOK(g)||!finite(y)||y<=0||y>=g.height)return null;
 var xs=[];
 edges(g.land).forEach(function(e){var a=e[0],b=e[1];if((a.y<=y&&b.y>y)||(b.y<=y&&a.y>y))xs.push(a.x+(b.x-a.x)*(y-a.y)/(b.y-a.y));});
 return xs.length>=2?Math.max.apply(null,xs):null;
}
function validate(g,p){
 var reasons=[],metrics={minimumWaterClearance:null,minimumBridgeClearance:null,minimumFishingClearance:null,minimumPierClearance:null};
 function fail(k){if(reasons.indexOf(k)<0)reasons.push(k);}
 if(!geometryOK(g))return{valid:false,reasons:['invalid_geometry'],metrics:metrics};
 if(!p||!point(p.approach)||!point(p.shore)||!point(p.head)||!point(p.socket)||!Array.isArray(p.route)||p.route.length<2||p.route.length>32||!p.route.every(point)||!finite(p.vesselRadius)||p.vesselRadius<=0||p.vesselRadius>200||!finite(p.margin)||p.margin<12||p.margin>100||!finite(p.width)||p.width<48||p.width>180||!finite(p.deckTop))return{valid:false,reasons:['invalid_candidate'],metrics:metrics};
 var required=p.vesselRadius+p.margin,landEdges=edges(g.land),bridge=rectangle(g.bridge),bridgeEdges=edges(bridge),headDirection={x:p.head.x-p.approach.x,y:p.head.y-p.approach.y},length=Math.hypot(headDirection.x,headDirection.y);
 if(length<80||length>500)fail('invalid_pier_length');
 if(!inside(p.approach,g.land))fail('approach_not_land');
 if(Math.min.apply(null,landEdges.map(function(e){return segmentPoint(p.approach,e[0],e[1]);}))<p.margin)fail('approach_bank_clearance');
 if(Math.min.apply(null,landEdges.map(function(e){return segmentPoint(p.shore,e[0],e[1]);}))>EPS)fail('shore_not_actual_boundary');
 if(segmentPoint(p.shore,p.approach,p.head)>EPS||dist(p.approach,p.shore)+dist(p.shore,p.head)>length+EPS)fail('shore_not_on_pier');
 if(inside(p.head,g.land)||inside(p.socket,g.land))fail('head_or_socket_not_water');
 if(dist(p.route[0],p.socket)>EPS)fail('route_not_bound_to_socket');
 if(Math.abs(p.deckTop-g.floorHeight)>.04)fail('deck_ground_step');
 if(length>0){
  var n={x:-headDirection.y/length*p.width/2,y:headDirection.x/length*p.width/2};
  var pier=[{x:p.approach.x+n.x,y:p.approach.y+n.y},{x:p.head.x+n.x,y:p.head.y+n.y},{x:p.head.x-n.x,y:p.head.y-n.y},{x:p.approach.x-n.x,y:p.approach.y-n.y}],pe=edges(pier);
  if(pier.some(function(q){return q.x<0||q.y<0||q.x>g.width||q.y>g.height;}))fail('pier_world_bounds');
  if(inside(p.approach,bridge)||inside(p.head,bridge))fail('pier_bridge_clearance');
  for(var i=0;i<p.route.length-1;i++){
   var a=p.route[i],b=p.route[i+1];if(dist(a,b)<1||dist(a,b)>1500)fail('route_segment_length');
   if([a,b].some(function(q){return q.x<required||q.y<required||q.x>g.width-required||q.y>g.height-required;}))fail('world_edge_clearance');
   if(inside(a,g.land)||inside(b,g.land))fail('route_on_land');
   var coast=Math.min.apply(null,landEdges.map(function(e){return segmentDistance(a,b,e[0],e[1]);}));
   var br=inside(a,bridge)||inside(b,bridge)?0:Math.min.apply(null,bridgeEdges.map(function(e){return segmentDistance(a,b,e[0],e[1]);}));
   var fish=segmentDistance(a,b,g.fishing.position,g.fishing.target)-g.fishing.radius;
   var pierClear=inside(a,pier)||inside(b,pier)?0:Math.min.apply(null,pe.map(function(e){return segmentDistance(a,b,e[0],e[1]);}));
   [['minimumWaterClearance',coast],['minimumBridgeClearance',br],['minimumFishingClearance',fish],['minimumPierClearance',pierClear]].forEach(function(row){metrics[row[0]]=metrics[row[0]]===null?row[1]:Math.min(metrics[row[0]],row[1]);});
   if(coast+EPS<required)fail('bank_clearance');if(br+EPS<required)fail('bridge_clearance');if(fish+EPS<required)fail('fishing_clearance');if(pierClear+EPS<required)fail('pier_clearance');
   g.places.forEach(function(place){if(segmentPoint(place,a,b)<Math.max(place.rx,place.ry)+required)fail('building_clearance');});
  }
  g.places.forEach(function(place){var r=Math.max(place.rx,place.ry)+p.margin;if(segmentPoint(place,p.approach,p.head)<r||segmentPoint(place.entrance,p.approach,p.head)<p.width/2+p.margin+18)fail('pier_building_or_door_clearance');});
  bridgeEdges.forEach(function(e){if(segmentDistance(p.approach,p.head,e[0],e[1])<p.width/2+p.margin)fail('pier_bridge_clearance');});
 }
 return{valid:reasons.length===0,reasons:reasons,metrics:metrics,requiredClearance:required};
}
function propose(g,options){
 options=options||{};if(!geometryOK(g))return{ok:false,report:{valid:false,reasons:['invalid_geometry']}};
 var y=options.bankY===undefined?1680:options.bankY,r=options.vesselRadius===undefined?90:options.vesselRadius,margin=options.margin===undefined?24:options.margin;
 var x=bankAt(g,y),left=bankAt(g,y-5),right=bankAt(g,y+5);if(!finite(x)||!finite(left)||!finite(right))return{ok:false,report:{valid:false,reasons:['invalid_bank_station']}};
 var slope=(right-left)/10,n={x:1/Math.hypot(1,slope),y:-slope/Math.hypot(1,slope)},shore={x:x,y:y},at=function(d){return{x:x+n.x*d,y:y+n.y*d};},socket=at(165),gap=socket.x-bankAt(g,socket.y);
 var p={id:'south-landing-route-v1',version:1,approach:at(-110),shore:shore,head:at(45),socket:socket,route:[socket,{x:bankAt(g,1750)+gap,y:1750},{x:bankAt(g,1690)+gap,y:1690}],vesselRadius:r,margin:margin,width:84,deckTop:g.floorHeight+.018,boardingEnabled:false,sailingEnabled:false,boatHullCreated:false,gameCollisionChanged:false,saveConnected:false};
 var report=validate(g,p);return{ok:report.valid,candidate:freeze(p),report:report};
}
function buildDock(THREE,g,p){
 var report=validate(g,p);if(!report.valid)throw Error('invalid_landing_candidate');
 var root=new THREE.Group();root.name='technical-landing-route-proof';var geometries=new Set(),materials=new Set(),disposed=false;
 var wood=new THREE.MeshStandardMaterial({color:'#b98856',roughness:.76}),cream=new THREE.MeshStandardMaterial({color:'#eadbc3',roughness:.64}),lilac=new THREE.MeshStandardMaterial({color:'#ad94be',roughness:.48});
 [wood,cream,lilac].forEach(function(m){materials.add(m);});
 var cube=new THREE.BoxGeometry(1,1,1),post=new THREE.CylinderGeometry(.046,.055,1,10),cap=new THREE.SphereGeometry(1,10,6);[cube,post,cap].forEach(function(x){geometries.add(x);});
 function mesh(geo,mat,name,parent){var m=new THREE.Mesh(geo,mat);m.name=name;m.castShadow=true;m.receiveShadow=true;(parent||root).add(m);return m;}
 function world(q,y){return new THREE.Vector3((q.x-g.origin.x)/g.scale,y,(q.y-g.origin.y)/g.scale);}
 var a=world(p.approach,0),b=world(p.head,0),delta=b.clone().sub(a),length=delta.length(),deck=new THREE.Group();deck.position.copy(a).add(b).multiplyScalar(.5);deck.rotation.y=Math.atan2(delta.x,delta.z);root.add(deck);
 var count=Math.ceil(length/.14),step=length/count;
 for(var i=0;i<count;i++){var plank=mesh(cube,wood,'closed-pier-plank',deck);plank.scale.set(p.width/g.scale,.075,step-.006);plank.position.set(0,p.deckTop-.0375,-length/2+(i+.5)*step);}
 for(var side=-1;side<=1;side+=2)for(var row=-1;row<=1;row+=2){var pile=mesh(post,wood,'closed-pier-support',deck);pile.scale.y=.80;pile.position.set(side*p.width/g.scale*.43,p.deckTop-.15,row*length*.40);var top=mesh(cap,cream,'closed-ivory-post-cap',deck);top.scale.set(.064,.038,.064);top.position.set(pile.position.x,p.deckTop+.26,pile.position.z);var collar=mesh(cube,lilac,'lilac-post-collar',deck);collar.scale.set(.108,.045,.108);collar.position.set(pile.position.x,p.deckTop+.18,pile.position.z);}
 // These guides are technical line annotations, not hull or collision geometry.
 var lineMaterial=new THREE.LineBasicMaterial({color:'#497f89'});materials.add(lineMaterial);
 var routeG=new THREE.BufferGeometry().setFromPoints(p.route.map(function(q){return world(q,g.waterHeight+.035);}));geometries.add(routeG);var line=new THREE.Line(routeG,lineMaterial);line.name='annotated-water-route-not-boat';root.add(line);
 var ringG=new THREE.TorusGeometry(p.vesselRadius/g.scale,.009,5,40);geometries.add(ringG);
 p.route.forEach(function(q,i){var ring=mesh(ringG,lilac,'provisional-vessel-envelope-'+i);ring.rotation.x=-Math.PI/2;ring.position.copy(world(q,g.waterHeight+.04));ring.castShadow=false;});
 root.updateMatrixWorld(true);
 return{group:root,geometries:geometries,materials:materials,report:report,dispose:function(){if(disposed)return;disposed=true;geometries.forEach(function(x){x.dispose();});materials.forEach(function(x){x.dispose();});root.removeFromParent();root.clear();}};
}
return Object.freeze({extract:extract,geometryOK:geometryOK,bankAt:bankAt,propose:propose,validate:validate,buildDock:buildDock,inside:inside,segmentDistance:segmentDistance});
}));

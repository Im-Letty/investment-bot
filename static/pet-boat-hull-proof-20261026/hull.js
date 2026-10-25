/* Original closed rowboat/boarding geometry precursor. No game state, sailing or ownership. */
(function(root,factory){'use strict';var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PetBoatHullProof=api;}(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
var EPS=1e-5;
function finite(n){return typeof n==='number'&&Number.isFinite(n);}
function point(p){return !!p&&finite(p.x)&&finite(p.y)&&finite(p.z);}
function normalizeWelded(THREE,g){
 g.computeVertexNormals();var p=g.attributes.position,n=g.attributes.normal,pool=new Map();
 for(var i=0;i<p.count;i++){var key=[p.getX(i),p.getY(i),p.getZ(i)].map(function(v){return Math.round(v*1e6);}).join(':'),v=pool.get(key)||new THREE.Vector3();v.x+=n.getX(i);v.y+=n.getY(i);v.z+=n.getZ(i);pool.set(key,v);}
 for(var i=0;i<p.count;i++){var key=[p.getX(i),p.getY(i),p.getZ(i)].map(function(v){return Math.round(v*1e6);}).join(':'),v=pool.get(key);if(v.lengthSq()<1e-12)v.set(0,p.getY(i)<0?-1:1,0);v.normalize();n.setXYZ(i,v.x,v.y,v.z);}
}
function shellGeometry(THREE,spec){
 var profile=[[0,-.16],[.15,-.16],[.55,-.10],[.86,.05],[1,.31],[.99,.35],[.90,.35],[.88,.28],[.75,.12],[.68,.04],[0,.04]];
 var segments=40,row=segments+1,positions=[],uv=[],index=[],groups=[],rim=[];
 for(var ring=0;ring<profile.length;ring++)for(var i=0;i<=segments;i++){
  var a=i/segments*Math.PI*2,r=profile[ring][0],base=profile[ring][1],stern=Math.pow(Math.max(0,-Math.cos(a)),12),y=base;
  if(base>.04)y-=.29*stern*(base-.04)/(.35-.04);
  // Length/beam are authored dimensions. The shell has an actual thick inner
  // floor and connected rim; it is not an open-ended tube or alpha billboard.
  var x=Math.sin(a)*spec.beam/2*r*(1-.12*Math.cos(a)),z=Math.cos(a)*spec.length/2*r;
  var scaleY=(spec.rim-spec.bottom)/.51;y=(y+.16)*scaleY+spec.bottom;
  positions.push(x,y,z);uv.push(i/segments,ring/(profile.length-1));if(ring===5)rim.push(y);
 }
 for(var ring=0;ring<profile.length-1;ring++){
  var start=index.length;
  for(var i=0;i<segments;i++){var a=ring*row+i,b=a+row;index.push(a,b,a+1,b,b+1,a+1);}
  groups.push({start:start,count:index.length-start,materialIndex:ring>=4&&ring<=6?2:ring>=7?1:0});
 }
 var g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(index);
 // Keep all outer/inner faces coherently outward; positive signed volume
 // remains the solid shell material, with the cockpit void excluded.
 var p=g.attributes.position,a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),volume=0;
 for(var i=0;i<index.length;i+=3){a.fromBufferAttribute(p,index[i]);b.fromBufferAttribute(p,index[i+1]);c.fromBufferAttribute(p,index[i+2]);volume+=a.dot(b.cross(c))/6;}
 if(volume<0){for(var i=0;i<index.length;i+=3){var t=index[i+1];index[i+1]=index[i+2];index[i+2]=t;}g.setIndex(index);volume=-volume;}
 groups.forEach(function(x){g.addGroup(x.start,x.count,x.materialIndex);});normalizeWelded(THREE,g);g.computeBoundingBox();g.computeBoundingSphere();
 g.userData.role='closed-thick-rowboat-shell';g.userData.signedMaterialVolume=volume;g.userData.minRimY=Math.min.apply(null,rim);return g;
}
function measure(THREE,group){
 if(!group||!group.isObject3D)throw Error('invalid_hull_group');group.updateMatrixWorld(true);
 var origin=group.getWorldPosition(new THREE.Vector3()),rotation=group.getWorldQuaternion(new THREE.Quaternion()).invert(),bounds=new THREE.Box3(),v=new THREE.Vector3(),radius=0,vertices=0;
 group.traverse(function(o){if(!o.isMesh)return;var p=o.geometry&&o.geometry.attributes.position;if(!p||p.count>100000)throw Error('invalid_hull_geometry');
  for(var i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld).sub(origin);radius=Math.max(radius,Math.hypot(v.x,v.z));v.applyQuaternion(rotation);if(!v.toArray().every(finite))throw Error('nonfinite_hull');bounds.expandByPoint(v);vertices++;}
 });
 if(!vertices||!finite(radius)||radius<=0)throw Error('empty_hull');
 return{bounds:{min:bounds.min.toArray(),max:bounds.max.toArray(),size:bounds.getSize(new THREE.Vector3()).toArray()},horizontalRadiusUnits:radius,vertices:vertices};
}
function buildHull(THREE,options){
 options=options||{};var spec={length:options.length===undefined?1.8:options.length,beam:options.beam===undefined?1.10:options.beam,bottom:options.bottom===undefined?-.16:options.bottom,rim:options.rim===undefined?.35:options.rim};
 if(!Object.keys(spec).every(function(k){return finite(spec[k]);})||spec.length<1||spec.length>4||spec.beam<.65||spec.beam>2||spec.bottom>=0||spec.bottom<-.5||spec.rim<.20||spec.rim>.7)throw Error('invalid_hull_spec');
 var proposedFloor=(.04+.16)*(spec.rim-spec.bottom)/.51+spec.bottom,proposedRim=(.06+.16)*(spec.rim-spec.bottom)/.51+spec.bottom;if(proposedFloor<=.01||proposedRim<=proposedFloor+.01)throw Error("invalid_hull_freeboard");
 var group=new THREE.Group();group.name='original-rowboat-geometry-precursor';var geometries=new Set(),materials=new Set(),dead=false;
 var outer=new THREE.MeshStandardMaterial({color:'#f2e4cd',roughness:.62}),wood=new THREE.MeshStandardMaterial({color:'#b98856',roughness:.76}),lilac=new THREE.MeshStandardMaterial({color:'#ad94be',roughness:.45});
 [outer,wood,lilac].forEach(function(m){materials.add(m);});
 var geo=shellGeometry(THREE,spec);geometries.add(geo);var shell=new THREE.Mesh(geo,[outer,wood,lilac]);shell.name='technical-hull-shell';shell.castShadow=true;shell.receiveShadow=true;group.add(shell);
 var box=new THREE.BoxGeometry(1,1,1);geometries.add(box);
 for(var side=-1;side<=1;side+=2){var bench=new THREE.Mesh(box,wood);bench.name='closed-wooden-thwart';bench.position.set(0,.13,side*.34*spec.length/1.8);bench.scale.set(spec.beam*.62,.055,.17);bench.castShadow=bench.receiveShadow=true;group.add(bench);}
 group.updateMatrixWorld(true);var m=measure(THREE,group);
 var floorY=(.04+.16)*(spec.rim-spec.bottom)/.51+spec.bottom;
 return{group:group,shell:shell,geometries:geometries,materials:materials,spec:spec,bounds:m.bounds,horizontalRadiusUnits:m.horizontalRadiusUnits,floorY:floorY,waterlineY:0,minRimY:geo.userData.minRimY,dispose:function(){if(dead)return;dead=true;geometries.forEach(function(g){g.dispose();});materials.forEach(function(m){m.dispose();});group.removeFromParent();group.clear();}};
}
function toWorld(THREE,input,p,y){return new THREE.Vector3((p.x-input.origin.x)/input.scale,y,(p.y-input.origin.y)/input.scale);}
function floorPoint(THREE,hull,localZ){
 hull.group.updateMatrixWorld(true);var q=new THREE.Vector3(0,hull.floorY+2,localZ).applyMatrix4(hull.group.matrixWorld),ray=new THREE.Raycaster(q,new THREE.Vector3(0,-1,0)),hit=ray.intersectObject(hull.shell,false)[0];
 if(!hit||Math.abs(hit.point.y-(hull.group.position.y+hull.floorY))>.01)throw Error('floor_contact_not_found');
 return{x:hit.point.x,y:hit.point.y,z:hit.point.z};
}
function validatePlacement(THREE,Route,input,base,hull){
 if(!Route||!input||!base||!hull)throw Error('missing_placement_input');
 var m=measure(THREE,hull.group),p=JSON.parse(JSON.stringify(base));p.id='south-landing-measured-hull-v2';p.version=2;p.vesselRadius=m.horizontalRadiusUnits*input.scale;p.boatHullCreated=true;
 var report=Route.validate(input,p),dx=p.socket.x-p.head.x,dy=p.socket.y-p.head.y,yaw=Math.atan2(dx,dy);
 var world=toWorld(THREE,input,p.socket,input.waterHeight),pier=Route.segmentDistance(p.approach,p.head,input.fishing.position,input.fishing.target)-input.fishing.radius-p.width/2-p.margin;
 var result={ok:report.valid&&pier>=0,candidate:p,routeReport:report,measured:m,pierFishingClearancePixels:pier,worldPosition:{x:world.x,y:world.y,z:world.z},yaw:yaw,boarding:null,normalGameIntegration:false,sailing:false,save:false};
 if(!result.ok)return result;
 hull.group.position.copy(world);hull.group.rotation.set(0,yaw,0);hull.group.updateMatrixWorld(true);
 var n={x:dx/Math.hypot(dx,dy),y:dy/Math.hypot(dx,dy)},start=toWorld(THREE,input,{x:p.head.x-n.x*4,y:p.head.y-n.y*4},p.deckTop),end=floorPoint(THREE,hull,-.50*specLength(hull)),delta=new THREE.Vector3(end.x-start.x,end.y-start.y,end.z-start.z);
 var finishTown={x:end.x*input.scale+input.origin.x,y:end.z*input.scale+input.origin.y};
 var boardFish=Route.segmentDistance({x:start.x*input.scale+input.origin.x,y:start.z*input.scale+input.origin.y},finishTown,input.fishing.position,input.fishing.target)-input.fishing.radius-20-p.margin;
 result.boarding={start:{x:start.x,y:start.y,z:start.z},end:end,width:.40,thickness:.035,stepHeight:delta.y,inclineDeg:Math.atan2(Math.abs(delta.y),Math.hypot(delta.x,delta.z))*180/Math.PI,floorY:end.y,fishingClearancePixels:boardFish,locomotionVerified:false};
 if(boardFish<0||result.boarding.inclineDeg>15||Math.abs(result.boarding.stepHeight)>.12){result.ok=false;result.boarding.geometryEligible=false;}else result.boarding.geometryEligible=true;
 return result;
}
function specLength(hull){return hull.spec.length/1.8;}
function createBoarding(THREE,placement){
 var p=placement&&placement.boarding;if(!placement||!placement.ok||!p||!p.geometryEligible||!point(p.start)||!point(p.end))throw Error('invalid_boarding_geometry');
 var group=new THREE.Group();group.name='fixed-contact-boarding-plank-not-sailing-fixture';var geometries=new Set(),materials=new Set(),dead=false;
 var a=new THREE.Vector3(p.start.x,p.start.y,p.start.z),b=new THREE.Vector3(p.end.x,p.end.y,p.end.z),z=b.clone().sub(a),length=z.length();z.normalize();var x=new THREE.Vector3(z.z,0,-z.x).normalize(),y=new THREE.Vector3().crossVectors(z,x).normalize();
 var geo=new THREE.BoxGeometry(p.width,p.thickness,length),mat=new THREE.MeshStandardMaterial({color:'#cba779',roughness:.75}),m=new THREE.Mesh(geo,mat);m.name='closed-contact-boarding-plank';
 m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z));m.position.copy(a).add(b).multiplyScalar(.5).addScaledVector(y,-p.thickness/2);m.castShadow=m.receiveShadow=true;group.add(m);geometries.add(geo);materials.add(mat);group.updateMatrixWorld(true);
 return{group:group,geometries:geometries,materials:materials,dispose:function(){if(dead)return;dead=true;geometries.forEach(function(g){g.dispose();});materials.forEach(function(m){m.dispose();});group.removeFromParent();group.clear();}};
}
function waterline(THREE,hull){
 var g=hull.shell.geometry,p=g.attributes.position,index=g.index,points=[],a=new THREE.Vector3(),b=new THREE.Vector3();
 for(var i=0;i<index.count;i+=3)for(var e=0;e<3;e++){
  a.fromBufferAttribute(p,index.getX(i+e));b.fromBufferAttribute(p,index.getX(i+(e+1)%3));
  if((a.y<0&&b.y>=0)||(b.y<0&&a.y>=0)){var t=-a.y/(b.y-a.y);points.push([a.x+(b.x-a.x)*t,0,a.z+(b.z-a.z)*t]);}
 }
 return points;
}
return Object.freeze({buildHull:buildHull,measure:measure,validatePlacement:validatePlacement,createBoarding:createBoarding,floorPoint:floorPoint,waterline:waterline});
}));

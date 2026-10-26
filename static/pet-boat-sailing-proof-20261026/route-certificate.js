/* Certify the existing route against actual source geometry and measured hull. */
(function(root,factory){'use strict';var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PetSailingCertificate=api;}(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';function finite(v){return typeof v==='number'&&Number.isFinite(v);}
function freeze(v){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.keys(v).forEach(function(k){freeze(v[k]);});Object.freeze(v);}return v;}
function certify(THREE,Route,Hull,input,original,hull){
 if(!input||!original||!hull)throw Error('missing_route_basis');var measured=Hull.measure(THREE,hull.group),candidate=JSON.parse(JSON.stringify(original));candidate.vesselRadius=measured.horizontalRadiusUnits*input.scale;
 var report=Route.validate(input,candidate);if(!report.valid)throw Error('unsafe_source_route');
 var path=candidate.route.map(function(p){return Object.freeze({x:(p.x-input.origin.x)/input.scale,z:(p.y-input.origin.y)/input.scale});}),dockYaw=Math.atan2(candidate.socket.x-candidate.head.x,candidate.socket.y-candidate.head.y);
 var plan=Object.freeze({route:Object.freeze(path),waterY:input.waterHeight,dockYaw:dockYaw});
 function closest(q){
  if(!q||!finite(q.x)||!finite(q.z))return null;var best=null,cumulative=0;
  for(var i=0;i<path.length-1;i++){var a=path[i],b=path[i+1],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz),t=Math.max(0,Math.min(1,((q.x-a.x)*dx+(q.z-a.z)*dz)/(length*length))),x=a.x+dx*t,z=a.z+dz*t,d=Math.hypot(q.x-x,q.z-z);if(!best||d<best.distance)best={progress:cumulative+t*length,distance:d};cumulative+=length;}
  return best;
 }
 function validatePose(q){var projected=closest(q);return !!projected&&projected.distance<=1e-7&&finite(q.y)&&Math.abs(q.y-plan.waterY)<=1e-7&&finite(q.yaw)&&Math.abs(q.yaw)<=Math.PI+1e-6;}
 return Object.freeze({plan:plan,candidate:freeze(candidate),report:freeze(report),measured:freeze(measured),closest:closest,validatePose:validatePose,scope:'measured-hull route circle clearance; passenger body/buoyancy/save unverified'});
}
return Object.freeze({certify:certify});
}));

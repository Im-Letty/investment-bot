/* Stable decorative meadow sites only. No game-state, clock, random or I/O. */
(function(root,factory){
  'use strict';
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PetTownMeadowSites=api;
}(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var MAX_SITES=40,MAX_CANDIDATES=500,MARGIN=.10,SAFE=1e100;
  function fail(){throw new TypeError('meadow_sites_invalid_input');}
  function finite(n){return typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=SAFE;}
  function positive(n){return finite(n)&&n>0;}
  function point(p){return Array.isArray(p)&&p.length===2&&finite(p[0])&&finite(p[1]);}
  function segment(s){return Array.isArray(s)&&s.length===2&&point(s[0])&&point(s[1]);}
  function triangle(t){return Array.isArray(t)&&t.length===3&&point(t[0])&&point(t[1])&&point(t[2]);}
  function box(b){return b&&typeof b==='object'&&[b.minX,b.maxX,b.minZ,b.maxZ].every(finite)&&b.minX<=b.maxX&&b.minZ<=b.maxZ;}
  function distanceSegment(x,z,a,b){
    var dx=b[0]-a[0],dz=b[1]-a[1],length2=dx*dx+dz*dz;
    if(length2===0)return Math.hypot(x-a[0],z-a[1]);
    var t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/length2));
    return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz);
  }
  function cross(a,b,x,z){return(b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0]);}
  function distanceTriangle(x,z,t){
    var a=t[0],b=t[1],c=t[2],area=cross(a,b,c[0],c[1]);
    var scale2=Math.max(Math.pow(b[0]-a[0],2)+Math.pow(b[1]-a[1],2),Math.pow(c[0]-b[0],2)+Math.pow(c[1]-b[1],2),Math.pow(a[0]-c[0],2)+Math.pow(a[1]-c[1],2));
    // A vertical or zero-area floor projection still excludes its real edges.
    // Do not classify its whole infinite line or an AABB as filled ground.
    if(Math.abs(area)>Number.EPSILON*scale2*8){
      var ab=cross(a,b,x,z),bc=cross(b,c,x,z),ca=cross(c,a,x,z);
      if(area>0?ab>=0&&bc>=0&&ca>=0:ab<=0&&bc<=0&&ca<=0)return 0;
    }
    return Math.min(distanceSegment(x,z,a,b),distanceSegment(x,z,b,c),distanceSegment(x,z,c,a));
  }
  function distanceBox(x,z,b){return Math.hypot(Math.max(b.minX-x,0,x-b.maxX),Math.max(b.minZ-z,0,z-b.maxZ));}
  function seedValue(value){
    if(typeof value==='number'){if(!Number.isInteger(value)||value<0||value>4294967295)fail();return value>>>0;}
    if(typeof value!=='string'||value.length===0||value.length>256)fail();
    var seed=2166136261;for(var i=0;i<value.length;i++)seed=Math.imul(seed^value.charCodeAt(i),16777619)>>>0;return seed;
  }
  function random(seed){var state=seed;return function(){state=(state+1831565813)>>>0;var t=Math.imul(state^(state>>>15),state|1);t^=t+Math.imul(t^(t>>>7),t|61);return(t^(t>>>14))>>>0;};}
  function integer(value,defaultValue){if(value===undefined)return defaultValue;if(!Number.isSafeInteger(value)||value<0)fail();return value;}
  function plan(options){
    if(!options||typeof options!=='object'||!positive(options.width)||!positive(options.depth))fail();
    var radius=options.radius===undefined?.55:options.radius,spacing=options.spacing===undefined?1.25:options.spacing;
    if(!positive(radius)||!positive(spacing))fail();
    var count=Math.min(MAX_SITES,integer(options.count,MAX_SITES)),attempts=Math.min(MAX_CANDIDATES,integer(options.maxCandidates,MAX_CANDIDATES));
    var triangles=options.triangles===undefined?[]:options.triangles,boundaries=options.boundaries===undefined?[]:options.boundaries,obstacles=options.obstacles===undefined?[]:options.obstacles;
    if(!Array.isArray(triangles)||!Array.from(triangles).every(triangle)||!Array.isArray(boundaries)||!Array.from(boundaries).every(segment)||!Array.isArray(obstacles)||!Array.from(obstacles).every(box)||options.allowPoint!==undefined&&typeof options.allowPoint!=='function')fail();
    // Pathside is opt-in. It needs actual paving triangles rather than an
    // invented centerline, and retains the same finite candidate/footprint cap.
    if(options.pathside!==undefined&&typeof options.pathside!=='boolean')fail();
    var pathside=options.pathside===true;
    if(pathside&&triangles.length===0)fail();
    var seed=seedValue(options.seed===undefined?0:options.seed),next=random(seed),clearance=radius+MARGIN,halfW=options.width/2,halfD=options.depth/2,rows=[],candidates=[];
    for(var attempt=0;attempt<attempts&&(pathside?count>0:rows.length<count);attempt++){
      var x=(next()/4294967296-.5)*options.width,z=(next()/4294967296-.5)*options.depth,siteSeed=next();
      if(x<-halfW+clearance||x>halfW-clearance||z<-halfD+clearance||z>halfD-clearance)continue;
      if(options.allowPoint){var allowed=options.allowPoint(x,z);if(typeof allowed!=='boolean')fail();if(!allowed)continue;}
      // Preserve the historical first-eligible uniform layout when not opted in.
      if(!pathside&&rows.some(function(row){return Math.hypot(x-row.x,z-row.z)<spacing;}))continue;
      var roadDistance=Infinity;
      if(triangles.some(function(t){var d=distanceTriangle(x,z,t);roadDistance=Math.min(roadDistance,d);return d<clearance;})||boundaries.some(function(s){return distanceSegment(x,z,s[0],s[1])<clearance;})||obstacles.some(function(b){return distanceBox(x,z,b)<clearance;}))continue;
      var site=Object.freeze({id:'meadow-'+attempt,x:x,z:z,seed:siteSeed,radius:radius});
      if(pathside)candidates.push({site:site,distance:roadDistance,attempt:attempt});
      else rows.push(site);
    }
    if(pathside){
      // Choose the nearest safe drifts first, then reject neighbours within
      // the same spacing as uniform mode. Exact ties keep generation order.
      candidates.sort(function(a,b){return a.distance-b.distance||a.attempt-b.attempt;});
      for(var i=0;i<candidates.length&&rows.length<count;i++){
        var candidate=candidates[i].site;
        if(rows.some(function(row){return Math.hypot(candidate.x-row.x,candidate.z-row.z)<spacing;}))continue;
        rows.push(candidate);
      }
    }
    return Object.freeze(rows);
  }
  return Object.freeze({revision:'meadow-sites2',plan:plan,limits:Object.freeze({sites:MAX_SITES,candidates:MAX_CANDIDATES,clearanceMargin:MARGIN}),
    pointSegmentDistance:function(x,z,s){if(!finite(x)||!finite(z)||!segment(s))fail();return distanceSegment(x,z,s[0],s[1]);},
    pointTriangleDistance:function(x,z,t){if(!finite(x)||!finite(z)||!triangle(t))fail();return distanceTriangle(x,z,t);},
    pointBoxDistance:function(x,z,b){if(!finite(x)||!finite(z)||!box(b))fail();return distanceBox(x,z,b);}});
}));

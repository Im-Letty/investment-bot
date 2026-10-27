/* Static authored grass/sand/shallow-water collar. No walking or saved-state changes. */
(function(root,factory){'use strict';var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PetTownShoreTransition=api;
}(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';var REVISION='shore-transition1',UNIT=100,TAU=Math.PI*2,EPS=1e-9;
  function finite(n){return typeof n==='number'&&Number.isFinite(n);}
  function hex(s){return typeof s==='string'&&/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(s);}
  function fail(){throw new Error('town_shore_context_unavailable');}
  function cross(a,b){return a[0]*b[1]-a[1]*b[0];}
  function smooth(t){t=Math.max(0,Math.min(1,t));return t*t*t*(10+t*(-15+6*t));}
  function create(T,ctx){
    var world=ctx&&ctx.world,shore=ctx&&ctx.shoreline;
    if(!T||!ctx||!ctx.group||!ctx.group.isObject3D||!world||!finite(world.width)||!finite(world.height)||world.width<=0||world.height<=0||world.width>4000||world.height>4000||!Array.isArray(shore)||shore.length<2||shore.length>128||!ctx.geometries||typeof ctx.geometries.add!=='function'||!ctx.materials||typeof ctx.materials.add!=='function'||!hex(ctx.groundColor)||['Box3','Group','BufferGeometry','Float32BufferAttribute','MeshStandardMaterial','MeshBasicMaterial','Mesh','Color'].some(function(k){return typeof T[k]!=='function';}))fail();
    var hw=world.width/UNIT/2,hd=world.height/UNIT/2,minX=-hw,minZ=-hd,aprons=ctx.groundAprons===undefined?[]:ctx.groundAprons;
    if(!Array.isArray(aprons))fail();
    for(var i=0;i<shore.length;i++){var r=shore[i];if(!Array.isArray(r)||r.length!==2||!r.every(finite)||r[0]<0||r[0]>world.height||r[1]<0||r[1]>world.width||(i&&r[0]<=shore[i-1][0]))fail();}
    if(shore[0][0]!==0||shore[shore.length-1][0]!==world.height)fail();
    var apronBounds=[];aprons.forEach(function(m){if(!m||!m.isMesh||!m.geometry)fail();var b=new T.Box3().setFromObject(m,true);if(![b.min.x,b.min.y,b.min.z,b.max.x,b.max.y,b.max.z].every(finite)||b.max.x>hw+EPS||b.max.z>hd+EPS||b.min.x>=b.max.x||b.min.z>=b.max.z)fail();minX=Math.min(minX,b.min.x);minZ=Math.min(minZ,b.min.z);apronBounds.push({min:b.min.toArray(),max:b.max.toArray()});});
    var polygon=[],coastEdges=[];
    function point(x,z,coastToNext){var last=polygon[polygon.length-1];if(last&&Math.hypot(x-last[0],z-last[1])<EPS){coastEdges[coastEdges.length-1]=!!coastToNext;return;}polygon.push([x,z]);coastEdges.push(!!coastToNext);}
    point(minX,minZ,false);point(hw,minZ,false);
    shore.forEach(function(r){point((r[1]-world.width/2)/UNIT,(r[0]-world.height/2)/UNIT,true);});
    coastEdges[coastEdges.length-1]=false;point(minX,hd,false);
    var area=0,cx=0,cz=0;for(i=0;i<polygon.length;i++){var a=polygon[i],b=polygon[(i+1)%polygon.length],v=cross(a,b);area+=v;cx+=(a[0]+b[0])*v;cz+=(a[1]+b[1])*v;}
    if(!(area>1)||polygon.some(function(p){return Math.abs(p[0])+1.8>=24||Math.abs(p[1])+1.8>=24;}))fail();
    var center=[cx/(3*area),cz/(3*area)];
    // The current bank plus its west/north apron union is convex. Refuse a new
    // incompatible coast rather than silently bridging a concavity or a channel.
    for(i=0;i<polygon.length;i++){a=polygon[i];b=polygon[(i+1)%polygon.length];var c=polygon[(i+2)%polygon.length];if(cross([b[0]-a[0],b[1]-a[1]],[c[0]-b[0],c[1]-b[1]])< -EPS)fail();}
    var angles=[];for(i=0;i<192;i++)angles.push(i*TAU/192);
    polygon.forEach(function(p){angles.push((Math.atan2(p[1]-center[1],p[0]-center[0])+TAU)%TAU);});angles.sort(function(a,b){return a-b;});angles=angles.filter(function(a,i){return !i||a-angles[i-1]>EPS;});if(angles.length>400)fail();
    function boundary(angle){var d=[Math.cos(angle),Math.sin(angle)],best=null;for(var k=0;k<polygon.length;k++){var a=polygon[k],b=polygon[(k+1)%polygon.length],e=[b[0]-a[0],b[1]-a[1]],q=[a[0]-center[0],a[1]-center[1]],den=cross(d,e);if(Math.abs(den)<EPS)continue;var radius=cross(q,e)/den,t=cross(q,d)/den;if(radius>0&&t>=-EPS&&t<=1+EPS&&(!best||radius<best.radius))best={radius:radius,x:center[0]+d[0]*radius,z:center[1]+d[1]*radius,dx:d[0],dz:d[1],coast:coastEdges[k]};}if(!best)fail();return best;}
    var firstBank=polygon.find(function(p){return Math.abs(p[1]+hd)<EPS&&Math.abs(p[0]-(shore[0][1]-world.width/2)/UNIT)<EPS;}),lastBank=[(shore[shore.length-1][1]-world.width/2)/UNIT,hd];
    var rows=angles.map(function(angle){var p=boundary(angle),townY=(p.z+hd)*UNIT,inner=1.175+.10*Math.sin(angle*11+.4)+.075*Math.sin(angle*19+.8),outer=.36+.10*Math.sin(angle*12+.7)+.07*Math.sin(angle*23+.2),bridge=0,endpointDistance=Math.min(Math.hypot(p.x-firstBank[0],p.z-firstBank[1]),Math.hypot(p.x-lastBank[0],p.z-lastBank[1])),coastWeight=p.coast?1:1-smooth(endpointDistance/1.5);inner=inner*(1-coastWeight)+(.425+.025*Math.sin(angle*3+.4))*coastWeight;outer=outer*(1-coastWeight)+(.30+.04*Math.sin(angle*4+.7))*coastWeight;if(p.coast){bridge=smooth((townY-920)/100)*(1-smooth((townY-1300)/100));inner=inner*(1-bridge)+.06*bridge;outer=outer*(1-bridge)+.055*bridge;}if(p.radius-inner<=.05)fail();return Object.assign(p,{angle:angle,townY:townY,inner:inner,outer:outer,bridge:bridge});});
    var positions=[],colors=[],indices=[],N=rows.length,ground=new T.Color(ctx.groundColor),dry=new T.Color('#e4cfa2'),wet=new T.Color('#bcb28b'),soil=new T.Color('#a59571');
    function vertex(p,d,y,color,alpha){positions.push(p.x+p.dx*d,y,p.z+p.dz*d);colors.push(color.r,color.g,color.b,alpha);}
    // All width offsets are authored radial distances, not recovered or new
    // physical bank measurements. Nested radial rings cannot cross one another.
    rows.forEach(function(p){vertex(p,-p.inner,.0269,ground,0);});
    rows.forEach(function(p){vertex(p,-p.inner*.72,.0268,ground.clone().lerp(dry,.38),.35);});
    rows.forEach(function(p){vertex(p,-p.inner*.18,.0266,dry,1);});
    rows.forEach(function(p){vertex(p,0,.0263,dry.clone().lerp(wet,.20),1);});
    rows.forEach(function(p){vertex(p,p.outer*.35,-.012,wet,1);});
    rows.forEach(function(p){vertex(p,p.outer,-.13,soil,1);});
    rows.forEach(function(p){vertex(p,-p.inner,-.21,ground,0);});
    rows.forEach(function(p){vertex(p,p.outer,-.21,soil,1);});
    function quad(a,b,c,d){indices.push(a,b,c,a,c,d);}
    for(i=0;i<N;i++){var j=(i+1)%N;for(var r=0;r<5;r++)quad(r*N+i,r*N+j,(r+1)*N+j,(r+1)*N+i);quad(j,i,6*N+i,6*N+j);quad(5*N+i,5*N+j,7*N+j,7*N+i);quad(6*N+i,7*N+i,7*N+j,6*N+j);}
    var shallowPositions=[],shallowColors=[],shallowIndices=[],shallowColor=new T.Color('#94c9bf');
    rows.forEach(function(p){shallowPositions.push(p.x+p.dx*p.outer*.65,-.047,p.z+p.dz*p.outer*.65);shallowColors.push(shallowColor.r,shallowColor.g,shallowColor.b,0);});
    rows.forEach(function(p){var d=p.outer+.22;shallowPositions.push(p.x+p.dx*d,-.047,p.z+p.dz*d);shallowColors.push(shallowColor.r,shallowColor.g,shallowColor.b,.15);});
    rows.forEach(function(p){shallowPositions.push(p.x+p.dx*1.10,-.047,p.z+p.dz*1.10);shallowColors.push(shallowColor.r,shallowColor.g,shallowColor.b,.08);});
    rows.forEach(function(p){shallowPositions.push(p.x+p.dx*1.8,-.047,p.z+p.dz*1.8);shallowColors.push(shallowColor.r,shallowColor.g,shallowColor.b,0);});
    for(i=0;i<N;i++){j=(i+1)%N;for(r=0;r<3;r++)shallowIndices.push(r*N+i,r*N+j,(r+1)*N+j,r*N+i,(r+1)*N+j,(r+1)*N+i);}
    if(!positions.concat(colors,shallowPositions,shallowColors).every(finite))fail();
    var group=new T.Group();group.name='native-grass-sand-shallows';group.userData.shoreTransitionRevision=REVISION;group.userData.presentationOnly=true;
    function geometry(pos,col,idx){var g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('color',new T.Float32BufferAttribute(col,4));g.setIndex(idx);g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();ctx.geometries.add(g);return g;}
    var beachGeometry=geometry(positions,colors,indices),shallowGeometry=geometry(shallowPositions,shallowColors,shallowIndices);
    var beachMaterial=new T.MeshStandardMaterial({color:'#ffffff',roughness:.96,metalness:0,vertexColors:true,transparent:true,opacity:1,alphaTest:.001,depthWrite:true}),shallowMaterial=new T.MeshBasicMaterial({color:'#ffffff',vertexColors:true,transparent:true,opacity:1,depthWrite:false});ctx.materials.add(beachMaterial);ctx.materials.add(shallowMaterial);
    var beach=new T.Mesh(beachGeometry,beachMaterial),shallows=new T.Mesh(shallowGeometry,shallowMaterial);beach.name='closed-grass-sand-soil-collar';shallows.name='shallow-water-color-fade';beach.renderOrder=-4;shallows.renderOrder=-2.5;beach.receiveShadow=true;
    [beach,shallows].forEach(function(m){m.castShadow=false;m.userData.shoreTransitionRevision=REVISION;m.userData.presentationOnly=true;m.userData.nonSolidWater=true;m.userData.noStaticBatch=true;group.add(m);});ctx.group.add(group);
    var groundHex=ground.getHexString(),metrics=Object.freeze({revision:REVISION,ringSamples:N,perimeterKnots:polygon.map(function(p){return Object.freeze(p.slice());}),radialCenter:Object.freeze(center.slice()),sourceGrassBounds:Object.freeze({minX:minX,minZ:minZ,maxX:hw,maxZ:hd}),apronCount:aprons.length,apronBounds:apronBounds,closedSoilCollar:true,shoreTriangles:indices.length/3,shallowTriangles:shallowIndices.length/3,totalTriangles:(indices.length+shallowIndices.length)/3,drawCalls:2,geometries:2,materials:2,textures:0,lights:0,seaTopY:-.05,shallowY:-.047,bottomY:-.21,normalMaxOutsideRadial:.53,eastMaxOutsideRadial:.34,shallowMaxOutsideRadial:1.8,bridgeTownY:[1020,1300],bridgeInnerRadial:.06,bridgeOuterRadial:.055,widthScope:'authored radial distances from actual convex grass union perimeter; no walkable extent or collision change',collisionSurfacesAdded:0,pickablesAdded:0,resourceOwner:'scene-context'});
    return Object.freeze({revision:REVISION,group:group,metrics:metrics,shoreMeshes:Object.freeze([beach]),shallowMeshes:Object.freeze([shallows]),setGroundColor:function(color){if(!hex(color))fail();var next=new T.Color(color),key=next.getHexString();if(key===groundHex)return false;var blended=next.clone().lerp(dry,.38),attr=beachGeometry.attributes.color;for(var k=0;k<N*2;k++){var c=k<N?next:blended;attr.setX(k,c.r);attr.setY(k,c.g);attr.setZ(k,c.b);}attr.needsUpdate=true;groundHex=key;return true;}});
  }
  return Object.freeze({revision:REVISION,create:create});
}));

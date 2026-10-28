/* Bounded, code-authored marine habitat. The enclosing Town scene owns GPU resources.
   Observation anchors come from the shared activity contract; this is no body rig. */
(function(root,factory){
  'use strict';
  var api=factory(typeof module==='object'&&module.exports?require('./pet-town-walk.js'):root.PetTownWalk,
    typeof module==='object'&&module.exports?require('./pet-ocean-snorkeling.js'):root.PetOceanSnorkeling,
    typeof module==='object'&&module.exports?require('./pet-ocean-discoveries.js'):root.PetOceanDiscoveries);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.PetOceanSnorkelingWorld=api;
}(typeof window!=='undefined'?window:globalThis,function(Town,Snorkeling,Discoveries){
  'use strict';
  var REVISION='ocean-snorkeling-world1',UNIT=100,TAU=Math.PI*2,SEA_Y=-.05,BED_DEPTH=2.35,FOUNDATION_Y=SEA_Y-BED_DEPTH-.04;
  function finite(v){return typeof v==='number'&&Number.isFinite(v);}
  function bedBlend(p){var gap=p.x-(Discoveries||globalThis.PetOceanDiscoveries).coastX(p.y),t=Math.max(0,Math.min(1,Math.min(gap-55,710-gap,p.y-1460,1870-p.y)/70));return t*t*(3-2*t);}
  function floorAt(p){
    var height=SEA_Y-BED_DEPTH+.025*Math.sin(p.x*.009)*Math.cos(p.y*.013),rows=(Discoveries||globalThis.PetOceanDiscoveries).encounters;
    for(var i=0;i<rows.length;i++){var c=rows[i];if(c.kind==='fish')continue;var d=Math.hypot(p.x-c.position.x,p.y-c.position.y),w=Math.exp(-d*d/900),contact=SEA_Y-c.depth-(c.kind==='seaweed'?0:.009);height=height*(1-w)+contact*w;}
    return FOUNDATION_Y+(height-FOUNDATION_Y)*bedBlend(p);
  }
  function create(T,ctx){
    var api=Snorkeling||globalThis.PetOceanSnorkeling,world=ctx&&ctx.world;
    if(!T||!ctx||!ctx.group||!ctx.group.isObject3D||!ctx.geometries||!ctx.materials||!api||typeof api.createHabitat!=='function'||
       !world||!finite(world.width)||!finite(world.height))throw Error('snorkeling_world_context_unavailable');
    var habitat=api.createHabitat(world,Town);
    if(!habitat)return null;
    if(!Array.isArray(habitat.creatures)||habitat.creatures.length>4)throw Error('snorkeling_habitat_unavailable');
    var root=new T.Group();root.name='southeast-snorkeling-habitat';root.visible=false;
    root.userData.snorkelingRevision=REVISION;root.userData.noStaticBatch=true;root.userData.nonSolidWater=true;
    var resources={geometries:[],materials:[]},fish=[],kelps=[],waves=[],disposed=false,active=null;
    function geo(g){ctx.geometries.add(g);resources.geometries.push(g);return g;}
    function mat(color,basic,opacity){var m=basic?new T.MeshBasicMaterial({color:color}):new T.MeshStandardMaterial({color:color,roughness:.78,metalness:0});
      if(opacity!==undefined){m.transparent=true;m.opacity=opacity;m.depthWrite=false;}
      m.userData.snorkelingRevision=REVISION;ctx.materials.add(m);resources.materials.push(m);return m;}
    function mesh(g,m,parent,name){var o=new T.Mesh(g,m);o.name=name||'marine-detail';o.castShadow=false;o.receiveShadow=!m.isMeshBasicMaterial;
      o.userData.noStaticBatch=true;o.userData.nonSolidWater=true;(parent||root).add(o);return o;}
    function coast(y){return (Discoveries||globalThis.PetOceanDiscoveries).coastX(y);}
    function place(p,height,target){target.position.set((p.x-world.width/2)/UNIT,height,(p.y-world.height/2)/UNIT);}
    // A closed, thick bed follows the same bent coast. Every column is seaward;
    // its small relief is authored scenery, never a recovered bathymetry value.
    var xs=[],zs=[],positions=[],colors=[],indices=[];
    for(var i=0;i<=16;i++)xs.push(55+655*i/16);for(i=0;i<=14;i++)zs.push(1460+(1870-1460)*i/14);
    habitat.creatures.forEach(function(c){xs.push(c.position.x-coast(c.position.y));zs.push(c.position.y);});
    xs.sort(function(a,b){return a-b;});zs.sort(function(a,b){return a-b;});
    xs=xs.filter(function(v,i){return !i||v-xs[i-1]>1e-8;});zs=zs.filter(function(v,i){return !i||v-zs[i-1]>1e-8;});
    var nx=xs.length-1,nz=zs.length-1,stride=nx+1;
    for(var layer=0;layer<2;layer++)for(var z=0;z<=nz;z++)for(var x=0;x<=nx;x++){
      var ty=zs[z],tx=coast(ty)+xs[x],p={x:tx,y:ty},h=layer?SEA_Y-BED_DEPTH-.23:floorAt(p);
      positions.push((tx-world.width/2)/UNIT,h,(ty-world.height/2)/UNIT);
      var tone=.96+.035*Math.sin(x*.7+z*.4),blend=bedBlend(p);colors.push(1+(tone-1)*blend,1+(tone*.98-1)*blend,1+(tone*.94-1)*blend);
    }
    var layerSize=stride*(nz+1);
    function quad(a,b,c,d){indices.push(a,b,c,a,c,d);}
    for(z=0;z<nz;z++)for(x=0;x<nx;x++){var i=z*stride+x;quad(i,i+stride,i+stride+1,i+1);quad(layerSize+i+1,layerSize+i+stride+1,layerSize+i+stride,layerSize+i);}
    for(x=0;x<nx;x++){quad(x+1,layerSize+x+1,layerSize+x,x);var j=nz*stride+x;quad(j,layerSize+j,layerSize+j+1,j+1);}
    for(z=0;z<nz;z++){var a=z*stride,b=(z+1)*stride;quad(a,layerSize+a,layerSize+b,b);a+=nx;b+=nx;quad(b,layerSize+b,layerSize+a,a);}
    var bedGeometry=geo(new T.BufferGeometry());bedGeometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));bedGeometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));bedGeometry.setIndex(indices);bedGeometry.computeVertexNormals();
    var bedNormals=bedGeometry.attributes.normal;for(var vi=0;vi<layerSize;vi++){var vx=vi%stride,vz=Math.floor(vi/stride);if(vx===0||vx===nx||vz===0||vz===nz)bedNormals.setXYZ(vi,0,1,0);}
    bedGeometry.computeBoundingBox();bedGeometry.computeBoundingSphere();
    var bedMaterial=mat('#d8b77f');bedMaterial.vertexColors=true;var bed=mesh(bedGeometry,bedMaterial,null,'closed-sandy-seabed');bed.userData.authoredDepth=BED_DEPTH;
    // A low sand foundation stays within the already existing 48-unit sea.
    // It supplies distant underwater floor, never a land/tap/collision surface.
    var foundation=mesh(geo(new T.BoxGeometry(47.8,.16,47.8)),mat('#d8b77f'),null,'underwater-distant-sand-foundation');foundation.position.y=FOUNDATION_Y-.08;
    var ceilingMaterial=mat('#92cbc6',true,.40);ceilingMaterial.side=T.DoubleSide;
    var ceiling=mesh(geo(new T.PlaneGeometry(47.8,47.8)),ceilingMaterial,null,'underwater-surface-ceiling');ceiling.rotation.x=-Math.PI/2;ceiling.position.y=SEA_Y;ceiling.renderOrder=-2;

    var stoneGeometry=geo(new T.SphereGeometry(1,10,6)),stoneMaterial=mat('#91aaa0'),sandMaterial=mat('#e8d7ad');
    for(var n=0;n<18;n++){
      var ty=1515+(n%6)*55,tx=coast(ty)+110+(n*137%480),p={x:tx,y:ty};
      var stone=mesh(stoneGeometry,n%3?sandMaterial:stoneMaterial,null,'small-marine-pebble');place(p,floorAt(p)+.025,stone);stone.scale.set(.05+(n%4)*.025,.035+(n%3)*.02,.07+(n%5)*.012);stone.rotation.y=n*.73;
    }
    var seaweedMaterial=mat('#5f9271'),leafMaterial=mat('#83ac77'),fishMaterial=mat('#77b9b4'),finMaterial=mat('#e7cf8d'),eyeMaterial=mat('#344e50',true),shellMaterial=mat('#e5c6b2'),starMaterial=mat('#dba084');
    var sphere=geo(new T.SphereGeometry(1,12,8)),finGeometry=geo(new T.ConeGeometry(1,1,3)),stemGeometry=geo(new T.CylinderGeometry(.016,.025,1,6));
    function extrudedOutline(points,depth){var s=new T.Shape();points.forEach(function(p,i){if(i)s.lineTo(p[0],p[1]);else s.moveTo(p[0],p[1]);});s.closePath();var g=new T.ExtrudeGeometry(s,{depth:depth,steps:1,bevelEnabled:true,bevelSize:.009,bevelThickness:.009,bevelSegments:1});g.rotateX(-Math.PI/2);return geo(g);}
    var starPoints=[];for(n=0;n<10;n++){var angle=n*TAU/10,r=n%2?.078:.20;starPoints.push([Math.cos(angle)*r,Math.sin(angle)*r]);}
    var starGeometry=extrudedOutline(starPoints,.035),shellPoints=[];
    shellPoints.push([-.04,-.13]);for(n=0;n<=18;n++){var a=Math.PI*.10+n/18*Math.PI*.80,r=.19+(n%2)*.015;shellPoints.push([Math.cos(a)*r,Math.sin(a)*r-.07]);}shellPoints.push([.04,-.13]);
    var shellGeometry=extrudedOutline(shellPoints,.055),creatureRoots=[];
    habitat.creatures.forEach(function(c,index){
      var g=new T.Group();g.name='marine-encounter-'+c.id;g.userData.creatureId=c.id;g.userData.noStaticBatch=true;
      place(c.position,SEA_Y-c.depth,g);root.add(g);creatureRoots.push(g);
      if(c.kind==='fish'){
        var body=mesh(sphere,fishMaterial,g,'reef-fish-body');body.scale.set(.25,.10,.095);
        var tail=mesh(finGeometry,finMaterial,g,'reef-fish-tail');tail.position.set(-.28,0,0);tail.rotation.z=-Math.PI/2;tail.scale.set(.17,.19,.07);
        for(var side=-1;side<=1;side+=2){var eye=mesh(sphere,eyeMaterial,g,'reef-fish-eye');eye.position.set(.16,.03,side*.079);eye.scale.setScalar(.018);}
        var dorsal=mesh(finGeometry,finMaterial,g,'reef-fish-dorsal');dorsal.position.set(-.02,.10,0);dorsal.scale.set(.11,.11,.028);
        fish.push({root:g,tail:tail,x:g.position.x,y:g.position.y,z:g.position.z,phase:index*.81});
      }else if(c.kind==='shell'){
        mesh(shellGeometry,shellMaterial,g,'scalloped-shell');
        for(var r=-2;r<=2;r++){var rib=mesh(stemGeometry,sandMaterial,g,'shell-fan-ridge');rib.position.set(r*.031,.072,.01);rib.rotation.z=r*.15;rib.rotation.x=Math.PI/2;rib.scale.set(.25,.11,.25);}
      }else if(c.kind==='starfish'){
        mesh(starGeometry,starMaterial,g,'five-arm-sea-star');var dot=mesh(sphere,shellMaterial,g,'starfish-center');dot.position.y=.052;dot.scale.set(.034,.014,.034);
      }else if(c.kind==='seaweed'){
        for(var k=0;k<5;k++){
          var stalk=new T.Group();stalk.position.set((k-2)*.07,0,Math.sin(k)*.06);g.add(stalk);
          var stem=mesh(stemGeometry,seaweedMaterial,stalk,'rooted-kelp-stem');stem.position.y=.42;stem.scale.y=.84;
          for(var l=0;l<4;l++){var leaf=mesh(sphere,l%2?leafMaterial:seaweedMaterial,stalk,'kelp-blade');leaf.position.set((l%2?1:-1)*.09,.15+l*.19,0);leaf.scale.set(.15,.045,.065);leaf.rotation.z=(l%2?1:-1)*.45;}
          kelps.push({root:stalk,phase:k*.65});
        }
      }
    });
    // Six small original scenery clusters break up the entry view. They have
    // no creature id and cannot create observations, inventory or extra rewards.
    var decorativeSites=[[1530,130],[1590,320],[1660,150],[1730,180],[1790,570],[1810,260]],decorativeRocks=new T.InstancedMesh(stoneGeometry,stoneMaterial,decorativeSites.length*2),rockMatrix=new T.Matrix4();
    decorativeRocks.name='decorative-rounded-marine-rocks';decorativeRocks.userData.noStaticBatch=true;decorativeRocks.userData.presentationOnly=true;root.add(decorativeRocks);
    decorativeSites.forEach(function(site,index){
      var p={x:coast(site[0])+site[1],y:site[0]},g=new T.Group();g.name='decorative-kelp-cluster-'+index;g.userData.presentationOnly=true;place(p,floorAt(p),g);root.add(g);
      var stalk=new T.Group();g.add(stalk);var stem=mesh(stemGeometry,seaweedMaterial,stalk,'decorative-kelp-stem');stem.position.y=.29;stem.scale.y=.58;
      for(var leafIndex=0;leafIndex<3;leafIndex++){var blade=mesh(sphere,leafIndex%2?leafMaterial:seaweedMaterial,stalk,'decorative-kelp-blade');blade.position.set((leafIndex%2?1:-1)*.075,.14+leafIndex*.16,0);blade.scale.set(.13,.037,.055);blade.rotation.z=(leafIndex%2?1:-1)*.42;}
      kelps.push({root:stalk,phase:index*.83});
      for(var r=0;r<2;r++){var rp={x:p.x+20+r*13,y:p.y+10-r*18};rockMatrix.makeScale(.10+r*.04,.065+r*.025,.085+r*.02);rockMatrix.setPosition((rp.x-world.width/2)/UNIT,floorAt(rp)+.035,(rp.y-world.height/2)/UNIT);decorativeRocks.setMatrixAt(index*2+r,rockMatrix);}
    });decorativeRocks.computeBoundingSphere();
    var causticGeometry=geo(new T.TorusGeometry(.21,.006,3,20,Math.PI*1.65)),causticMaterial=mat('#f0efc9',true,.19);
    for(n=0;n<8;n++){var ty=1515+n*44,tx=coast(ty)+135+(n%3)*135,p={x:tx,y:ty},glow=mesh(causticGeometry,causticMaterial,null,'soft-sand-caustic');place(p,floorAt(p)+.008,glow);glow.rotation.set(-Math.PI/2,0,n*.71);glow.scale.set(1.1+(n%3)*.12,.72,1);}
    var waveGeometry=geo(new T.TorusGeometry(.24,.010,4,28)),waveMaterial=mat('#e2f1df',true,.35),waveGroup=new T.Group();waveGroup.name='offshore-snorkeling-ripples';root.add(waveGroup);
    for(n=0;n<6;n++){var ty=1515+n*54,tx=coast(ty)+160+(n%3)*155,p={x:tx,y:ty},wave=mesh(waveGeometry,waveMaterial,waveGroup,'offshore-soft-wave');place(p,SEA_Y+.009,wave);wave.rotation.x=-Math.PI/2;wave.scale.set(2.7,1,1);waves.push({mesh:wave,x:wave.position.x,z:wave.position.z,phase:n*.72});}
    var bubbleGeometry=geo(new T.SphereGeometry(.018,7,5)),bubbleMaterial=mat('#d8eee5',true,.34),bubbleCount=16,bubbles=new T.InstancedMesh(bubbleGeometry,bubbleMaterial,bubbleCount);bubbles.name='snorkeling-small-bubbles';bubbles.frustumCulled=false;bubbles.userData.noStaticBatch=true;root.add(bubbles);bubbles.instanceMatrix.setUsage(T.DynamicDrawUsage);
    var bubbleRows=[];for(n=0;n<bubbleCount;n++){var c=habitat.creatures[n%Math.max(1,habitat.creatures.length)],p=c?c.position:habitat.entry.water;bubbleRows.push({x:(p.x-world.width/2)/UNIT+(n%3-.8)*.14,z:(p.y-world.height/2)/UNIT+Math.sin(n)*.17,phase:n/bubbleCount});}
    var matrix=new T.Matrix4(),lastTime=null,lastReduced=null;
    function animate(ms,reduced){
      if(disposed||!active)return false;var t=reduced?0:(Math.max(0,finite(ms)?ms:0)%24000)/1000;
      if(t===lastTime&&!!reduced===lastReduced)return false;
      causticMaterial.opacity=.19+Math.sin(t*.72)*.045;
      for(var i=0;i<fish.length;i++){var f=fish[i],a=t*.7+f.phase;f.root.position.set(f.x+Math.sin(a)*.24,f.y+Math.sin(a*.8)*.035,f.z+Math.cos(a)*.13);f.root.rotation.y=Math.cos(a)*.35;f.tail.rotation.y=Math.sin(t*3.1+f.phase)*.28;}
      for(i=0;i<kelps.length;i++)kelps[i].root.rotation.z=Math.sin(t*.8+kelps[i].phase)*.065;
      for(i=0;i<waves.length;i++){var w=waves[i],a=t*.7+w.phase;w.mesh.position.x=w.x+Math.sin(a)*.07;w.mesh.position.z=w.z+Math.cos(a)*.045;w.mesh.scale.set(2.7+Math.sin(a)*.18,1+Math.cos(a)*.12,1);}
      for(i=0;i<bubbleCount;i++){var b=bubbleRows[i],phase=(t*.13+b.phase)%1;matrix.makeScale(.6+phase*.55,.6+phase*.55,.6+phase*.55);matrix.setPosition(b.x+Math.sin(phase*TAU)*.035,SEA_Y-BED_DEPTH+.18+phase*(BED_DEPTH-.30),b.z);bubbles.setMatrixAt(i,matrix);}
      bubbles.instanceMatrix.needsUpdate=true;root.updateMatrixWorld(true);lastTime=t;lastReduced=!!reduced;return true;
    }
    function setActive(value){if(disposed)return false;var previous=active;active=value||null;root.visible=!!active;waveGroup.visible=!!active&&active.mode!=='underwater';ceiling.visible=!!active&&active.mode==='underwater';foundation.visible=!!active&&active.mode==='underwater';bubbles.visible=!!active&&active.mode==='underwater';if(!active){lastTime=null;return true;}if(!previous){lastTime=null;animate(0,true);}return true;}
    ctx.group.add(root);root.updateMatrixWorld(true);bubbles.computeBoundingSphere();if(bubbles.boundingSphere)bubbles.boundingSphere.radius+=3;
    var triangles=0;root.traverse(function(o){if(o.isMesh&&o.geometry)triangles+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);});
    var metrics=Object.freeze({revision:REVISION,encounters:habitat.creatures.length,seabedDepth:BED_DEPTH,seaY:SEA_Y,bedTriangles:indices.length/3,totalTriangles:triangles,geometries:resources.geometries.length,materials:resources.materials.length,bubbles:bubbleCount,offshoreWaves:waves.length,decorativeKelpClusters:decorativeSites.length,decorativeRockInstances:decorativeSites.length*2,causticArcs:8,continuousBedEdgeY:FOUNDATION_Y,textures:0,lights:0,collisionSurfacesAdded:0,resourceOwner:'town-scene',anatomicalBodyFit:false});
    return Object.freeze({revision:REVISION,group:root,habitat:habitat,bed:bed,tapSurfaces:Object.freeze([bed,foundation]),creatureRoots:Object.freeze(creatureRoots),bubbles:bubbles,metrics:metrics,floorAt:floorAt,isWater:function(p){return api.isWater(habitat,p);},cameraClear:function(x,z){var y=z*UNIT+world.height/2,tx=x*UNIT+world.width/2;return y>=1320&&y<=1910&&Math.abs(x)<23&&Math.abs(z)<23&&tx>=coast(y)+35;},setActive:setActive,animate:animate,
      dispose:function(){if(disposed)return false;disposed=true;root.removeFromParent();root.clear();bubbles.dispose();decorativeRocks.dispose();return true;}});
  }
  return Object.freeze({revision:REVISION,create:create,floorAt:floorAt,seaY:SEA_Y,seabedDepth:BED_DEPTH});
}));

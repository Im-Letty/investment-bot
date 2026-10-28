/* Native geometry for the saved village layout card. Presentation only. */
(function(root,factory){
  'use strict';
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PetTownLayoutArt=api;
}(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  var REVISION='layout-art-3d1',UNIT=100,TAU=Math.PI*2;
  var BANK=[[0,2880],[550,2840],[1050,2720],[1450,2510],[1920,1990]];
  function bankX(y){
    y=Math.max(0,Math.min(1920,y));
    for(var i=1;i<BANK.length;i++)if(y<=BANK[i][0]){
      var a=BANK[i-1],b=BANK[i];return a[1]+(b[1]-a[1])*(y-a[0])/(b[0]-a[0]);
    }
    return BANK[BANK.length-1][1];
  }
  function build(THREE,world,ctx){
    if(!THREE||!world||!Array.isArray(world.places)||!ctx||!ctx.group||
      ['groundPoint','mesh','box','ball','mat'].some(function(k){return typeof ctx[k]!=='function';})||
      !Array.isArray(ctx.surfaces)||!Array.isArray(ctx.occluders))throw new Error('layout_art_context_unavailable');
    var root=new THREE.Group();root.name='layout-art-native-landscape';ctx.group.add(root);
    root.userData.layoutArtRevision=REVISION;
    var paths=[],bankStones=[],fences=[],bridgeDetails=[],decorativeFloors=[],groundAprons=[],porchConnectors=[];
    function gp(p){return ctx.groundPoint(world,p);}
    function material(color,role){return typeof ctx.sceneryMaterial==='function'?ctx.sceneryMaterial(color,role):ctx.mat(color,false,role);}
    function woodBox(parent,w,h,d,mat,x,y,z){return typeof ctx.roundedBox==='function'?ctx.roundedBox(parent,w,h,d,mat,x,y,z):ctx.box(parent,w,h,d,mat,x,y,z);}
    function mesh(geo,mat,parent,x,y,z,name){
      var m=ctx.mesh(geo,mat,parent,x,y,z);if(name)m.name=name;return m;
    }
    function solid(m){
      m.castShadow=true;ctx.occluders.push(m);bridgeDetails.push(m);return m;
    }
    var cream=material('#e4cfa6','layout-path'),grout=material('#bca982','layout-path');
    var paving=[material('#d8c9a6','layout-path'),material('#cbbb94','layout-path'),material('#e0d2b0','layout-path')];
    var plazaPoint={x:world.width*.48,y:world.height*.52},plazaAt=gp(plazaPoint);
    var plaza=new THREE.Group();plaza.name='layout-elliptical-plaza';plaza.position.set(plazaAt.x,0,plazaAt.z);root.add(plaza);
    var rx=world.width*.24/UNIT/2,rz=world.height*.22/UNIT/2;
    // The card's 24% by22% oval and full ring become horizontal native surfaces.
    function horizontal(geo,mat,y,name){
      var m=mesh(geo,mat,plaza,0,y,0,name);m.rotation.x=-Math.PI/2;m.scale.set(rx,rz,1);decorativeFloors.push(m);return m;
    }
    horizontal(new THREE.RingGeometry(.90,1,96),grout,.027,'layout-plaza-border');
    horizontal(new THREE.CircleGeometry(.90,96),cream,.035,'layout-plaza-floor');
    var paverGeometry=new THREE.RingGeometry(.905,1,1,1,.003,TAU/48-.006);
    for(var paver=0;paver<48;paver++){
      var tile=horizontal(paverGeometry,paving[paver%3],.035,'layout-plaza-border-paver');
      // Rotate in the ellipse's local plane before its nonuniform world scale.
      tile.geometry=paverGeometry;tile.rotation.z=paver*TAU/48;
      // A parent rotation would rotate the ellipse. Bake each angular placement
      // into a shared unit wedge's matrix, then apply the common ellipse scale.
      tile.matrixAutoUpdate=false;
      tile.matrix.makeRotationX(-Math.PI/2);
      tile.matrix.multiply(new THREE.Matrix4().makeScale(rx,rz,1));
      tile.matrix.multiply(new THREE.Matrix4().makeRotationZ(paver*TAU/48));
      tile.matrix.setPosition(0,.035,0);
    }
    var junction={x:world.width*.48,y:world.height*.54},join=gp(junction);
    function ribbon(curve,bands,y,mat,name,segments){
      segments=segments||48;
      var positions=[],indices=[],uvs=[],points=curve.getPoints(segments);
      // Bands partition each road laterally. All dark bands also stay below
      // every cream branch, so intersecting roads cannot produce depth zebra.
      bands.forEach(function(band){
        var start=positions.length/3;
        points.forEach(function(p,i){
          var tangent=curve.getTangent(i/segments),n=new THREE.Vector3(-tangent.z,0,tangent.x).normalize();
          positions.push(p.x+n.x*band[1],y,p.z+n.z*band[1],p.x+n.x*band[0],y,p.z+n.z*band[0]);
          uvs.push((p.x+n.x*band[1])*.75,(p.z+n.z*band[1])*.75,(p.x+n.x*band[0])*.75,(p.z+n.z*band[0])*.75);
          if(i<segments){var k=start+i*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}
        });
      });
      var geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
      geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
      geo.setIndex(indices);geo.computeVertexNormals();geo.computeBoundingBox();geo.computeBoundingSphere();
      var m=mesh(geo,mat,root,0,0,0,name);decorativeFloors.push(m);return m;
    }
    world.places.forEach(function(place){
      if(place.id==='tree'||!place.entrance)return;
      var end=gp(place.entrance);
      if(Math.hypot(end.x-join.x,end.z-join.z)<1e-6)return;
      // Same normalized control points as the editable card, with saved doors.
      var curve=new THREE.CubicBezierCurve3(new THREE.Vector3(join.x,.028,join.z),
        new THREE.Vector3(end.x,.028,join.z),
        new THREE.Vector3(end.x,.028,(join.z+end.z)/2),
        new THREE.Vector3(end.x,.028,end.z));
      var edge=ribbon(curve,[[-.515,-.455],[.455,.515]],.027,grout,'layout-curved-path-edge');
      var fill=ribbon(curve,[[-.455,.455]],.033,cream,'layout-curved-cream-path');
      edge.userData.pathFor=fill.userData.pathFor=place.id;
      paths.push({placeId:place.id,entrance:{x:place.entrance.x,y:place.entrance.y},curve:curve,edge:edge,fill:fill});
      if(['home','cafe','shop'].indexOf(place.id)>=0&&place.footprint){
        var measuredContact=typeof ctx.doorContact==='function'?ctx.doorContact(place):null;
        var porchPoint=measuredContact?{x:measuredContact.x,y:measuredContact.y}:{x:place.footprint.x,y:place.footprint.y+place.footprint.ry+22},porch=gp(porchPoint);
        var connector=new THREE.LineCurve3(new THREE.Vector3(end.x,.028,end.z),new THREE.Vector3(porch.x,.028,porch.z));
        var strip=ribbon(connector,[[-.455,.455]],.033,cream,'layout-porch-cream-connector',1);
        strip.userData.pathFor=place.id;
        porchConnectors.push({placeId:place.id,entrance:{x:place.entrance.x,y:place.entrance.y},porchPoint:porchPoint,curve:connector,fill:strip});
      }

    });
    var wood=[material('#d5ad79','wood'),material('#bd8d58','wood'),material('#e9cba0','wood')];
    var bridgeAt=gp({x:2645,y:1160}),bridge=new THREE.Group();bridge.name='layout-board-bridge';
    bridge.position.set(bridgeAt.x,0,bridgeAt.z);root.add(bridge);
    // Eleven contiguous solid flat boards share one mesh and one exact walk top.
    // Recessed or arched walking surfaces would disagree with existing heightAt.
    var board=new THREE.BoxGeometry(3.3/11,.14,1.8),bp=board.attributes.position,bn=board.attributes.normal,bu=board.attributes.uv,bi=board.index;
    var positions=[],normals=[],uvs=[],deckGeometry=new THREE.BufferGeometry();
    for(var b=0;b<11;b++){
      var offset=(b-5)*3.3/11,start=positions.length/3;
      for(var j=0;j<bi.count;j++){var n=bi.getX(j);positions.push(bp.getX(n)+offset,bp.getY(n),bp.getZ(n));normals.push(bn.getX(n),bn.getY(n),bn.getZ(n));uvs.push(bu.getX(n),bu.getY(n));}
      deckGeometry.addGroup(start,bi.count,b%3);
    }
    board.dispose();
    deckGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    deckGeometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
    deckGeometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));deckGeometry.computeBoundingBox();deckGeometry.computeBoundingSphere();
    var deck=mesh(deckGeometry,wood,bridge,0,.12,0,'bridge-deck');deck.castShadow=true;ctx.surfaces.push(deck);
    deck.userData.layoutBoardCount=11;deck.userData.walkTop=.19;
    function beam(base,rise,thickness,depth,bevel){
      var shape=new THREE.Shape(),span=1.65,steps=24;
      for(var i=0;i<=steps;i++){var x=-span+i*span*2/steps,y=base+rise*(1-x*x/(span*span));if(i===0)shape.moveTo(x,y);else shape.lineTo(x,y);}
      for(var i=steps;i>=0;i--){var x=-span+i*span*2/steps,y=base+rise*(1-x*x/(span*span))-thickness;shape.lineTo(x,y);}
      shape.closePath();
      var g=new THREE.ExtrudeGeometry(shape,{depth:depth,steps:1,bevelEnabled:true,bevelSegments:2,bevelSize:bevel,bevelThickness:bevel,curveSegments:1});
      g.translate(0,0,-depth/2);g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();return g;
    }
    var sideBeam=beam(.25,.15,.13,.12,.02),topRail=beam(.83,.14,.065,.085,.015);
    for(var side=-1;side<=1;side+=2){
      solid(mesh(sideBeam,wood[1],bridge,0,0,side*1.045,'layout-bridge-arched-side-beam'));
      solid(mesh(topRail,wood[0],bridge,0,0,side*1.045,'layout-bridge-curved-top-rail'));
      [-1.54,0,1.54].forEach(function(x){
        var post=woodBox(bridge,.17,.90,.17,wood[0],x,.49,side*1.045);post.name='layout-bridge-rounded-post';solid(post);
        var cap=ctx.ball(bridge,wood[2],x,.96,side*1.045,.115,.07,.115);cap.name='layout-bridge-post-cap';solid(cap);
      });
    }
    // Rocks sit wholly on the water side, including their full z extent.
    // Nothing is inserted into the saved collision model or walking surfaces.
    var stones=[material('#b7a384','stone'),material('#dfd1b5','stone'),material('#ccba9b','stone')];
    for(var r=0;r<25;r++){
      var y=45+r*76;if(y>1020&&y<1300)continue;
      var sx=.19+(r%4)*.025,sz=.18+(r%3)*.035;
      var north=Math.max(0,y-sz*UNIT),x=bankX(north)+sx*UNIT+12,at=gp({x:x,y:y});
      var stone=ctx.ball(root,stones[r%3],at.x,.07,at.z,sx,.12+(r%3)*.025,sz);
      stone.name='layout-rounded-bank-stone';stone.castShadow=true;
      stone.userData.savedBankPoint={x:x,y:y};stone.userData.outsideCollisionBank=true;bankStones.push(stone);
    }
    function fence(startX,startZ,length,west){
      var g=new THREE.Group();g.name='layout-outside-boundary-fence';g.position.set(startX,0,startZ);if(west)g.rotation.y=Math.PI/2;root.add(g);fences.push(g);
      for(var i=0;i<3;i++){
        var post=woodBox(g,.16,.86,.16,wood[0],i*length/2,.43,0);post.name='layout-fence-rounded-post';post.castShadow=true;
        var cap=ctx.ball(g,wood[2],i*length/2,.88,0,.09,.055,.09);cap.name='layout-fence-post-cap';cap.castShadow=true;
      }
      for(var i=0;i<2;i++)[.31,.64].forEach(function(y){
        var rail=woodBox(g,length/2,.09,.10,wood[1],(i+.5)*length/2,y,0);rail.name='layout-fence-horizontal-rail';rail.castShadow=true;
      });
      g.userData.outsideSavedBounds=true;
    }
    var halfW=world.width/UNIT/2,halfH=world.height/UNIT/2;
    // These visible support strips remain strictly beyond the old saved map.
    // Share the land material so its existing seasonal map updates reach them.
    if(ctx.groundMaterial){
      var west=ctx.box(root,1.2,.08,world.height/UNIT+1.2,ctx.groundMaterial,-halfW-.6,-.015,-.6);
      var north=ctx.box(root,world.width/UNIT,.08,1.2,ctx.groundMaterial,0,-.015,-halfH-.6);
      west.name='layout-west-grass-support-apron';north.name='layout-north-grass-support-apron';
      [west,north].forEach(function(m){m.userData.outsideSavedBounds=true;m.userData.decorativeGroundSupport=true;groundAprons.push(m);});
    }
    fence(-halfW+1.3,-halfH-.34,3.1,false);
    fence(-halfW+8.2,-halfH-.34,3.0,false);
    fence(-halfW-.34,-halfH+5.5,3.0,true);
    fence(-halfW-.34,halfH-1.8,3.0,true);
    root.updateMatrixWorld(true);
    // Render static floor details once per material family. Keep the original
    // meshes as invisible geometry diagnostics, not a second visible layer.
    var inverse=root.matrixWorld.clone().invert(),renderBatches=[];
    function combine(rows,choices,name){
      var positions=[],normals=[],uvs=[],indices=[],ordered=[],geo=new THREE.BufferGeometry();
      choices.forEach(function(material,materialIndex){
        var groupStart=indices.length;
        rows.filter(function(m){return m.material===material;}).forEach(function(m){
          var transform=new THREE.Matrix4().multiplyMatrices(inverse,m.matrixWorld),normalTransform=new THREE.Matrix3().getNormalMatrix(transform);
          var p=m.geometry.attributes.position,n=m.geometry.attributes.normal,uv=m.geometry.attributes.uv,index=m.geometry.index,start=positions.length/3,v=new THREE.Vector3();
          for(var i=0;i<p.count;i++){
            v.fromBufferAttribute(p,i).applyMatrix4(transform);positions.push(v.x,v.y,v.z);
            if(n){v.fromBufferAttribute(n,i).applyNormalMatrix(normalTransform);normals.push(v.x,v.y,v.z);}else normals.push(0,1,0);
            uvs.push(uv?uv.getX(i):0,uv?uv.getY(i):0);
          }
          for(var i=0;i<(index?index.count:p.count);i++)indices.push(start+(index?index.getX(i):i));
          ordered.push(m);m.visible=false;m.userData.layoutDiagnosticOnly=true;
        });
        if(choices.length>1)geo.addGroup(groupStart,indices.length-groupStart,materialIndex);
      });
      geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
      geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geo.setIndex(indices);geo.computeBoundingBox();geo.computeBoundingSphere();
      var draw=mesh(geo,choices.length===1?choices[0]:choices,root,0,0,0,name);
      draw.castShadow=ordered.some(function(m){return m.castShadow;});
      draw.userData.layoutStaticBatch=true;renderBatches.push({mesh:draw,rows:ordered});return draw;
    }
    combine(decorativeFloors.filter(function(m){return m.material===cream;}),[cream],'layout-static-cream-surfaces');
    combine(decorativeFloors.filter(function(m){return m.material===grout;}),[grout],'layout-static-grout-surfaces');
    combine(decorativeFloors.filter(function(m){return paving.indexOf(m.material)>=0;}),paving,'layout-static-plaza-pavers');
    stones.forEach(function(material,i){combine(bankStones.filter(function(m){return m.material===material;}),[material],'layout-static-bank-stones-'+i);});
    root.updateMatrixWorld(true);
    return {layoutArtRevision:REVISION,environmentRevision:'shop-environment1',group:root,junction:junction,plaza:plaza,plazaPoint:plazaPoint,
      plazaRadii:{x:rx,z:rz},paths:paths,porchConnectors:porchConnectors,bridge:bridge,bridgeDeck:deck,bridgeDetails:bridgeDetails,
      bankStones:bankStones,fences:fences,groundAprons:groundAprons,decorativeFloors:decorativeFloors,renderBatches:renderBatches,
      walkSurfacePolicy:'existing-ground-plus-exact-bridge',resourceOwnership:'scene-context'};
  }
  return Object.freeze({revision:REVISION,environmentRevision:'shop-environment1',build:build});
}));

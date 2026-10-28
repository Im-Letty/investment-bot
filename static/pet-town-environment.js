/* Shop-family sky and distant terrain only. No game state, light or exposure changes.
   Scene owns registered geometry/material/sky resources; this helper owns its root only. */
(function(root,factory){
 'use strict';var api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;else root.PetTownEnvironment=api;
}(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 var REVISION='shop-environment2',SKY_WIDTH=512,SKY_HEIGHT=256,TAU=Math.PI*2,SEASONS={
  spring:{key:'spring',sky:'#a1c9d6',horizon:'#e4e2cc',hills:['#78975d','#a3b77a','#8aa36b']},
  summer:{key:'summer',sky:'#94c2d3',horizon:'#e1e2c9',hills:['#6f925b','#98af70','#809e64']},
  autumn:{key:'autumn',sky:'#a8c7cf',horizon:'#e7dec6',hills:['#85975e','#a9b177','#94a36a']},
  winter:{key:'winter',sky:'#b7ced9',horizon:'#e7e5d7',hills:['#92aa97','#b5c2aa','#a2b39e']}
 };
 Object.keys(SEASONS).forEach(function(k){Object.freeze(SEASONS[k].hills);Object.freeze(SEASONS[k]);});Object.freeze(SEASONS);
 function color(v){return typeof v==='string'&&/^#[a-f0-9]{6}$/i.test(v);}
 function profile(value){
  if(value&&Object.prototype.hasOwnProperty.call(SEASONS,value.key))return SEASONS[value.key];
  // Older isolated sky callers have only sky/horizon, not a calendar key.
  if(!value||typeof value!=='object'||!color(value.sky)||value.horizon!==undefined&&!color(value.horizon)||
     value.hills!==undefined&&(!Array.isArray(value.hills)||value.hills.length!==3||!value.hills.every(color)))throw new TypeError('environment_profile_invalid');
  return Object.freeze({key:'custom',sky:value.sky,horizon:value.horizon||'#eee7d7',
   hills:Object.freeze((value.hills||SEASONS.summer.hills).slice())});
 }
 function mix(a,b,t){
  var out='#';for(var i=1;i<7;i+=2)out+=Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0');return out;
 }
 // Opaque background pigment only. Horizontal terms are periodic, including
 // cloud shoulders, so yaw can cross the panorama seam without a hard edge.
 function smooth(a,b,x){var t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);}
 function rgb(h){return [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];}
 var CLOUDS=Object.freeze([
  Object.freeze([.09,.39,.068,.026]),Object.freeze([.34,.45,.084,.031]),
  Object.freeze([.61,.35,.077,.027]),Object.freeze([.86,.43,.060,.024])
 ]);
 function skyPixels(p){
  var pixels=new Uint8ClampedArray(SKY_WIDTH*SKY_HEIGHT*4),sky=rgb(p.sky),horizon=rgb(p.horizon);
  for(var y=0;y<SKY_HEIGHT;y++)for(var x=0;x<SKY_WIDTH;x++){
   var u=x/(SKY_WIDTH-1),v=y/(SKY_HEIGHT-1),blend=smooth(.40,.73,v),density=0,weightedY=0;
   for(var c=0;c<CLOUDS.length;c++){
    var row=CLOUDS[c];
    // Three overlapping soft lobes form each small bank; no cloud geometry,
    // alpha overlay, weather fetch or independent animation clock is created.
    for(var l=0;l<3;l++){
     var cx=row[0]+(l-1)*row[2]*.52,cy=row[1]-(l===1?row[3]*.30:0),du=Math.abs(u-cx);du=Math.min(du,1-du);
     var dv=v-cy,shape=Math.exp(-Math.pow(du/(row[2]*(l===1?.68:.57)),2)-Math.pow(dv/(row[3]*(l===1?1:.76)),2));
     density+=shape*(l===1?.67:.48);weightedY+=shape*(dv>0?1:0);
    }
   }
   var cloud=smooth(.20,1.20,density)*.43*(1-smooth(.55,.66,v));
   var under=density>1e-12?Math.min(1,weightedY/density):0;
   var grain=(Math.sin(TAU*(u*17+v*3))+.55*Math.cos(TAU*(u*31-v*7)))*.35;
   var at=(y*SKY_WIDTH+x)*4;
   for(var channel=0;channel<3;channel++){
    var base=sky[channel]*(1-blend)+horizon[channel]*blend;
    var cloudTop=[247,242,221][channel],cloudBottom=[207,216,203][channel];
    var pigment=cloudTop*(1-under*.48)+cloudBottom*under*.48;
    pixels[at+channel]=Math.max(0,Math.min(255,Math.round(base*(1-cloud)+pigment*cloud+grain*(1-blend))));
   }
   pixels[at+3]=255;
  }
  return pixels;
 }
 function skyTexture(T,doc,value){
  if(!doc||typeof doc.createElement!=='function'||!value)return null;
  var p=profile(value),canvas=doc.createElement('canvas');canvas.width=SKY_WIDTH;canvas.height=SKY_HEIGHT;
  var ctx=canvas.getContext&&canvas.getContext('2d');if(!ctx)return null;
  var pixelPaint=typeof ctx.createImageData==='function'&&typeof ctx.putImageData==='function';
  if(pixelPaint){
   var image=ctx.createImageData(SKY_WIDTH,SKY_HEIGHT);image.data.set(skyPixels(p));ctx.putImageData(image,0,0);
  }else{
   // Keep lightweight canvas callers useful without pretending they rendered
   // the detailed cloud field when ImageData is unavailable.
   if(typeof ctx.createLinearGradient!=='function'||typeof ctx.fillRect!=='function')return null;
   var g=ctx.createLinearGradient(0,0,0,SKY_HEIGHT);
   g.addColorStop(0,p.sky);g.addColorStop(.40,p.sky);g.addColorStop(.56,mix(p.sky,p.horizon,.48));
   g.addColorStop(.73,p.horizon);g.addColorStop(1,p.horizon);ctx.fillStyle=g;ctx.fillRect(0,0,SKY_WIDTH,SKY_HEIGHT);
  }
  var texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.mapping=T.EquirectangularReflectionMapping;
  texture.wrapS=T.RepeatWrapping;texture.wrapT=T.ClampToEdgeWrapping;
  texture.userData.presentationRole='bounded-seasonal-sky-background';texture.userData.environmentRevision=REVISION;
  texture.userData.environmentSeason=p.key;texture.userData.codeAuthored=true;texture.userData.cloudBanks=pixelPaint?CLOUDS.length:0;
  texture.userData.paintMode=pixelPaint?'periodic-layered-cloud-pigment':'gradient-fallback';
  texture.userData.textureBytes=SKY_WIDTH*SKY_HEIGHT*4;return texture;
 }
 function hillGeometry(T){
  var g=new T.SphereGeometry(1,32,16),p=g.attributes.position;
  // A closed radial surface remains inside the old unit sphere. Cardinal
  // extrema stay at +/-1, while asymmetric shoulders avoid a perfect ball.
  for(var i=0;i<p.count;i++){
   var x=p.getX(i),y=p.getY(i),z=p.getZ(i),a=Math.atan2(z,x),s=Math.sin(a*2);
   var radial=1-.12*s*s*(.7+.3*Math.sin(a*3+.4))*(1-y*y);
   var upper=y>0?y-.055*Math.pow(Math.sin(Math.PI*y),2):y;
   p.setXYZ(i,x*radial,upper,z*radial);
  }
  g.computeVertexNormals();
  // Sphere seams/poles duplicate positions. Share their smooth surface
  // normals, including unused pole entries, without changing triangle winding.
  var n=g.attributes.normal,pool=new Map();
  for(i=0;i<p.count;i++){
   var key=[p.getX(i),p.getY(i),p.getZ(i)].map(function(v){return Math.round(v*1e6);}).join(':');
   var sum=pool.get(key)||new T.Vector3();sum.add(new T.Vector3(n.getX(i),n.getY(i),n.getZ(i)));pool.set(key,sum);
  }
  for(i=0;i<p.count;i++){
   var key=[p.getX(i),p.getY(i),p.getZ(i)].map(function(v){return Math.round(v*1e6);}).join(':'),sum=pool.get(key);
   if(sum.lengthSq()<1e-16)sum.set(p.getX(i),p.getY(i),p.getZ(i));sum.normalize();n.setXYZ(i,sum.x,sum.y,sum.z);
  }
  // Gentle pigment depth belongs to this hill surface, not a screen wash.
  // Vertex positions/normals and the old closed envelope stay byte-for-byte
  // identical. A shared neutral multiplier lets all three seasonal materials
  // retain their own green/cream identity without allocating another texture.
  var colors=[];
  for(i=0;i<p.count;i++){
   var px=p.getX(i),py=p.getY(i),pz=p.getZ(i),upper=Math.max(0,py);
   var grain=Math.sin(px*8+pz*5)*Math.cos(pz*7-px*3)*.018;
   var tone=.86+.13*upper+.035*px+grain;
   colors.push(Math.max(.72,Math.min(1.04,tone+.018*upper)),Math.max(.72,Math.min(1.04,tone+.012*upper)),Math.max(.72,Math.min(1.04,tone-.012*upper)));
  }
  g.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  g.computeBoundingBox();g.computeBoundingSphere();g.userData.environmentRole='closed-irregular-distant-hill';
  g.userData.normalPolicy='shared-smooth-radial-surface';return g;
 }
 function create(T,ctx){
  if(!T||!T.Mesh||!T.MeshStandardMaterial||!ctx||!ctx.group||typeof ctx.group.add!=='function'||
     !ctx.geometries||typeof ctx.geometries.add!=='function'||!ctx.materials||typeof ctx.materials.add!=='function')
   throw new TypeError('environment_context_invalid');
  var active=profile(ctx.seasonProfile),root=new T.Group(),hills=[],materials=[],disposed=false;
  root.name='shop-environment-hills';root.userData.revision=REVISION;root.userData.nonSolidDecoration=true;
  var geometry=hillGeometry(T);ctx.geometries.add(geometry);
  for(var i=0;i<3;i++){
   var material=new T.MeshStandardMaterial({color:active.hills[i],roughness:.86,metalness:0,vertexColors:true});
   material.userData.surfaceRole='environment-hill';material.userData.environmentRevision=REVISION;
   material.userData.environmentSeason=active.key;material.userData.environmentColorIndex=i;
   ctx.materials.add(material);materials.push(material);
  }
  function hill(index,x,y,z,sx,sy,sz,colorIndex){
   var m=new T.Mesh(geometry,materials[colorIndex]);m.name='distant-rounded-hill';m.position.set(x,y,z);m.scale.set(sx,sy,sz);
   m.rotation.y=(index%4)*Math.PI/2;m.castShadow=false;m.receiveShadow=true;
   m.userData.environmentHill=true;m.userData.nonSolidDecoration=true;m.userData.originalEnvelope={center:[x,y,z],scale:[sx,sy,sz]};
   root.add(m);hills.push(m);
  }
  for(i=0;i<7;i++){hill(i,-16+i*5,-.6,-14.5,3.2,1.4,3.2,i%2);if(i<5)hill(i+1,-16+i*4.5,-.7,14.5,3,1.3,3,2);}
  ctx.group.add(root);
  function setSeason(value){
   if(disposed)return false;var next=profile(value);
   for(var i=0;i<materials.length;i++){materials[i].color.set(next.hills[i]);materials[i].userData.environmentSeason=next.key;}
   active=next;return true;
  }
  function summary(){return {revision:REVISION,season:active.key,hills:hills.length,geometries:1,materials:3,textures:0,lights:0,
   geometryMaterialDisposalOwner:'scene',instanceBuffers:0,skyTextureDisposalOwner:'scene-caller',disposed:disposed,
   hillColors:active.hills.slice(),surfacePigment:'shared-vertex-depth',skyTextureSize:[SKY_WIDTH,SKY_HEIGHT],skyTextureBytes:SKY_WIDTH*SKY_HEIGHT*4,cloudBanks:CLOUDS.length,worldCollisionOrSaveMutation:false};}
  function dispose(){if(disposed)return false;disposed=true;root.removeFromParent();root.clear();return true;}
  return {revision:REVISION,group:root,hills:Object.freeze(hills),setSeason:setSeason,summary:summary,dispose:dispose};
 }
 return Object.freeze({revision:REVISION,profile:profile,skyTexture:skyTexture,hillGeometry:hillGeometry,create:create,
  limits:Object.freeze({skyWidth:SKY_WIDTH,skyHeight:SKY_HEIGHT,skyTextureBytes:SKY_WIDTH*SKY_HEIGHT*4,cloudBanks:CLOUDS.length,hillGeometries:1,hillMaterials:3})});
}));

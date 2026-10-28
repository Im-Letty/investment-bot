/* Shop-family sky and distant terrain only. No game state, light or exposure changes.
   Scene owns registered geometry/material/sky resources; this helper owns its root only. */
(function(root,factory){
 'use strict';var api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;else root.PetTownEnvironment=api;
}(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 var REVISION='shop-environment1',SEASONS={
  spring:{key:'spring',sky:'#bdd5df',horizon:'#eee7d7',hills:['#8ea879','#a8b992','#98ad84']},
  summer:{key:'summer',sky:'#b6d2df',horizon:'#eee7d4',hills:['#819e6b','#9fb386','#8da879']},
  autumn:{key:'autumn',sky:'#c4d7df',horizon:'#eee4d2',hills:['#9ca57a','#b2b58c','#a7ae82']},
  winter:{key:'winter',sky:'#cedce2',horizon:'#ede9df',hills:['#acbeb2','#c2cbbd','#b6c4b6']}
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
 function skyTexture(T,doc,value){
  if(!doc||typeof doc.createElement!=='function'||!value)return null;
  var p=profile(value),canvas=doc.createElement('canvas');canvas.width=256;canvas.height=128;
  var ctx=canvas.getContext&&canvas.getContext('2d');if(!ctx||typeof ctx.createLinearGradient!=='function')return null;
  var g=ctx.createLinearGradient(0,0,0,128);
  g.addColorStop(0,p.sky);g.addColorStop(.43,p.sky);g.addColorStop(.56,mix(p.sky,p.horizon,.48));
  g.addColorStop(.70,p.horizon);g.addColorStop(1,p.horizon);
  ctx.fillStyle=g;ctx.fillRect(0,0,256,128);
  var texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.mapping=T.EquirectangularReflectionMapping;
  texture.userData.presentationRole='bounded-seasonal-sky-background';texture.userData.environmentRevision=REVISION;
  texture.userData.environmentSeason=p.key;return texture;
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
   var material=new T.MeshStandardMaterial({color:active.hills[i],roughness:.94,metalness:0});
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
   hillColors:active.hills.slice(),worldCollisionOrSaveMutation:false};}
  function dispose(){if(disposed)return false;disposed=true;root.removeFromParent();root.clear();return true;}
  return {revision:REVISION,group:root,hills:Object.freeze(hills),setSeason:setSeason,summary:summary,dispose:dispose};
 }
 return Object.freeze({revision:REVISION,profile:profile,skyTexture:skyTexture,hillGeometry:hillGeometry,create:create});
}));

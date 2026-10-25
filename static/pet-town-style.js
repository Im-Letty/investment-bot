/* Original code-native village detailing. No source art, game state or storage. */
(function(root,factory){
 'use strict';var api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;else root.PetTownStyle=api;
}(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 var limits=Object.freeze({treeLeaves:144,treeTwigs:9,surfaceTextures:6,surfaceTextureSize:128,groundTextureSize:512,groundPatches:80});
 function leafGeometry(THREE){
  // Closed tapered volume, with a softly raised midrib; never an alpha card.
  var g=new THREE.SphereGeometry(1,6,4),p=g.attributes.position;
  for(var i=0;i<p.count;i++){
   var y=p.getY(i),body=Math.max(0,1-y*y);
   p.setXYZ(i,p.getX(i)*.68*Math.pow(body,.25)*(1+.08*y),y,p.getZ(i)*.065+.105*body);
  }
  var uv=g.attributes.uv;for(var u=0;u<uv.count;u++)uv.setX(u,Math.max(0,Math.min(1,uv.getX(u))));
  g.computeVertexNormals();
  // Sphere UV seams/poles duplicate vertices, including unused pole entries.
  // Weld their shading normals so every closed tip has a finite unit normal.
  var normals=g.attributes.normal,pool={};
  for(var i=0;i<p.count;i++){var key=[p.getX(i),p.getY(i),p.getZ(i)].map(function(n){return Math.round(n*1e6);}).join(':');var v=pool[key]||(pool[key]=new THREE.Vector3());v.x+=normals.getX(i);v.y+=normals.getY(i);v.z+=normals.getZ(i);}
  for(var i=0;i<p.count;i++){var key=[p.getX(i),p.getY(i),p.getZ(i)].map(function(n){return Math.round(n*1e6);}).join(':');var v=pool[key].normalize();normals.setXYZ(i,v.x,v.y,v.z);}
  g.computeBoundingBox();g.computeBoundingSphere();g.userData.styleRole='closed-pointed-leaf';return g;
 }
 function branchGeometry(THREE,kind){
  var rings=kind==='trunk'?9:5,sides=kind==='trunk'?8:6,positions=[],uv=[],indices=[];
  function center(t){return [Math.sin(t*Math.PI)*.85-.2*t,t,Math.sin(t*Math.PI*2)*.24];}
  for(var y=0;y<=rings;y++){
   var t=y/rings,c=center(t),radius=1-.76*t;
   for(var j=0;j<=sides;j++){var a=j/sides*Math.PI*2;positions.push(c[0]+Math.cos(a)*radius,c[1],c[2]+Math.sin(a)*radius);uv.push(j/sides,t);}
  }
  for(var r=0;r<rings;r++)for(var s=0;s<sides;s++){var a=r*(sides+1)+s,b=a+sides+1;indices.push(a,b,a+1,b,b+1,a+1);}
  // Independent cap rings preserve hard end normals and an actually closed mesh.
  for(var end=0;end<=1;end++){
   var c=center(end),radius=1-.76*end,base=positions.length/3;positions.push(c[0],c[1],c[2]);uv.push(.5,.5);
   for(var n=0;n<=sides;n++){var a=n/sides*Math.PI*2;positions.push(c[0]+Math.cos(a)*radius,c[1],c[2]+Math.sin(a)*radius);uv.push((Math.cos(a)+1)/2,(Math.sin(a)+1)/2);}
   for(var n=0;n<sides;n++)if(end)indices.push(base,base+n+2,base+n+1);else indices.push(base,base+n+1,base+n+2);
  }
  var g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();g.userData.styleRole=kind==='trunk'?'curved-tapered-trunk':'curved-tapered-branch';return g;
 }
 function tileGeometry(THREE){
  var s=new THREE.Shape();s.moveTo(-.8,-1);s.lineTo(.8,-1);s.quadraticCurveTo(1,-1,1,-.8);s.lineTo(1,.35);s.bezierCurveTo(1,.92,.45,1,0,1);s.bezierCurveTo(-.45,1,-1,.92,-1,.35);s.lineTo(-1,-.8);s.quadraticCurveTo(-1,-1,-.8,-1);s.closePath();
  var g=new THREE.ExtrudeGeometry(s,{depth:.18,bevelEnabled:true,bevelThickness:.055,bevelSize:.045,bevelSegments:2,curveSegments:4,steps:1});g.rotateX(-Math.PI/2);g.computeBoundingBox();
  var b=g.boundingBox,c=new THREE.Vector3();b.getCenter(c);g.translate(-c.x,-c.y,-c.z);var size=new THREE.Vector3();b.getSize(size);g.scale(2/size.x,2/size.y,2/size.z);var p=g.attributes.position,uv=g.attributes.uv;for(var i=0;i<p.count;i++)uv.setXY(i,(p.getX(i)+1)/2,(p.getZ(i)+1)/2);
  g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();g.userData.styleRole='closed-scalloped-roof-tile';return g;
 }
 function surfaceTexture(THREE,doc,kind){
  if(['wood','bark','plaster','ceramic','foliage','stone'].indexOf(kind)<0||!doc||!doc.createElement)return null;
  var c=doc.createElement('canvas');c.width=c.height=limits.surfaceTextureSize;var ctx=c.getContext&&c.getContext('2d');
  if(!ctx||!ctx.createImageData||!ctx.putImageData)return null;
  var n=limits.surfaceTextureSize,image=ctx.createImageData(n,n),a=image.data;
  function wave(x,y,f){return Math.sin(x*f+Math.sin(y*.071)*1.8);}
  for(var y=0;y<n;y++)for(var x=0;x<n;x++){
   var noise=Math.sin(x*12.9898+y*78.233)*43758.5453;noise=(noise-Math.floor(noise)-.5)*2;
   var v=128;
   if(kind==='wood')v+=wave(x,y,.25)*13+wave(x,y,.82)*4+noise*3;
   else if(kind==='bark')v+=wave(x,y,.43)*19+Math.sin(x*.12+Math.sin(y*.11)*.7)*10+noise*7;
   else if(kind==='plaster')v+=noise*7+Math.sin(x*.31+y*.27)*2;
   else if(kind==='ceramic')v+=noise*2+Math.sin(x*.08)*2+Math.cos(y*.09)*2;
   else if(kind==='foliage'){var mid=Math.abs(x-n/2);v+=Math.max(0,1-mid/4)*22+Math.sin((y+mid*.65)*.32)*Math.max(0,1-mid/(n*.5))*5+noise*2;}
   else v+=noise*8+Math.sin(x*.19+Math.sin(y*.23))*4;
   var at=(y*n+x)*4;a[at]=a[at+1]=a[at+2]=Math.max(0,Math.min(255,Math.round(v)));a[at+3]=255;
  }
  ctx.putImageData(image,0,0);var texture=new THREE.CanvasTexture(c);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.colorSpace=THREE.NoColorSpace;texture.anisotropy=2;texture.userData.styleRole=kind;return texture;
 }
 return Object.freeze({limits:limits,leafGeometry:leafGeometry,branchGeometry:branchGeometry,tileGeometry:tileGeometry,surfaceTexture:surfaceTexture});
}));

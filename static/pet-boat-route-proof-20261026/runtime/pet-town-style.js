/* Original code-native village detailing. No source art, game state or storage. */
(function(root,factory){
 'use strict';var api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;else root.PetTownStyle=api;
}(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 var limits=Object.freeze({treeLeaves:126,treeTwigs:9,leavesPerTwig:14,leafWidthSegments:8,leafHeightSegments:5,surfaceTextures:6,surfaceTextureSize:128,groundTextureSize:512,groundPatches:80});
 function leafGeometry(THREE){
  // Closed tapered volume, with a softly raised midrib; never an alpha card.
  var g=new THREE.SphereGeometry(1,limits.leafWidthSegments,limits.leafHeightSegments),p=g.attributes.position;
  for(var i=0;i<p.count;i++){
   var y=p.getY(i),body=Math.max(0,1-y*y);
   p.setXYZ(i,p.getX(i)*.50*Math.pow(body,.12)*(1+.18*y),y,p.getZ(i)*.045+.055*body);
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
  function center(t){return kind==='trunk'?[Math.sin(t*Math.PI*2)*1.25+.32*t,t,Math.sin(t*Math.PI)*.48]:[Math.sin(t*Math.PI)*.6,t,Math.sin(t*Math.PI*2)*.18];}
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
  var g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
  // Average the side seam only. Independent cap normals stay hard.
  var n=g.attributes.normal;
  for(var r=0;r<=rings;r++){var a=r*(sides+1),b=a+sides,v=new THREE.Vector3(n.getX(a)+n.getX(b),n.getY(a)+n.getY(b),n.getZ(a)+n.getZ(b)).normalize();n.setXYZ(a,v.x,v.y,v.z);n.setXYZ(b,v.x,v.y,v.z);}
  g.computeBoundingBox();g.computeBoundingSphere();g.userData.styleRole=kind==='trunk'?'curved-tapered-trunk':'curved-tapered-branch';return g;
 }
 function tileGeometry(THREE){
  // Two closed tessellated caps give each tile a real cross-section crown.
  // Local -Z is the round eave end; normalized +/-1 bounds stay unchanged.
  var across=8,along=5,row=across+1,layer=row*(along+1),p=[],uv=[],indices=[];
  for(var side=0;side<2;side++)for(var j=0;j<=along;j++)for(var i=0;i<=across;i++){
   var x=-1+2*i/across,t=j/along,front=-(.55+.45*Math.sqrt(Math.max(0,1-x*x))),z=1+t*(front-1);
   var y=side===0?1-.70*x*x-.10*Math.pow(t,6):-1+.12*(1-x*x);
   p.push(x,y,z);uv.push(i/across,t);
  }
  for(var j=0;j<along;j++)for(var i=0;i<across;i++){
   var a=j*row+i,b=a+row;
   indices.push(a,a+1,b,a+1,b+1,b);
   indices.push(a+layer,b+layer,a+1+layer,a+1+layer,b+layer,b+1+layer);
  }
  var edge=[];for(var i=0;i<=across;i++)edge.push(i);
  for(var j=1;j<=along;j++)edge.push(j*row+across);
  for(var i=across-1;i>=0;i--)edge.push(along*row+i);
  for(var j=along-1;j>0;j--)edge.push(j*row);
  for(var i=0;i<edge.length;i++){var a=edge[i],b=edge[(i+1)%edge.length];indices.push(a,a+layer,b,b,a+layer,b+layer);}
  var g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();g.userData.styleRole='closed-scalloped-roof-tile';return g;
 }
 function bowlGeometry(THREE){
  // One closed lathed cross-section: rounded exterior, thick rim and actual
  // interior depression. The rim joins both sides, not an open cylinder cap.
  var points=[[0,0],[.42,0],[.62,.07],[.81,.21],[.94,.43],[1,.76],[1,.91],[.97,.98],[.92,1],[.87,.97],[.85,.87],[.76,.62],[.57,.43],[.32,.37],[0,.37]].map(function(p){return new THREE.Vector2(p[0],p[1]);});
  var g=new THREE.LatheGeometry(points,24);g.normalizeNormals();g.computeBoundingBox();g.computeBoundingSphere();g.userData.styleRole='closed-rounded-fountain-bowl';return g;
 }
 function archGeometry(THREE){
  var s=new THREE.Shape();s.moveTo(-.5,0);s.lineTo(.5,0);s.lineTo(.5,.54);s.absellipse(0,.54,.5,.46,0,Math.PI,false);s.lineTo(-.5,0);
  var g=new THREE.ExtrudeGeometry(s,{depth:1,bevelEnabled:false,steps:1,curveSegments:12});g.translate(0,0,-.5);g.computeBoundingBox();g.computeBoundingSphere();g.userData.styleRole='closed-arched-joinery';return g;
 }
 function surfaceTexture(THREE,doc,kind){
  if(['wood','bark','plaster','ceramic','foliage','stone'].indexOf(kind)<0||!doc||!doc.createElement)return null;
  var c=doc.createElement('canvas');c.width=c.height=limits.surfaceTextureSize;var ctx=c.getContext&&c.getContext('2d');
  if(!ctx||!ctx.createImageData||!ctx.putImageData)return null;
  var n=limits.surfaceTextureSize,image=ctx.createImageData(n,n),a=image.data;
  function wave(x,y,f){var cycles=Math.round(f*n/(Math.PI*2));return Math.sin(x*Math.PI*2*cycles/n+Math.sin(y*Math.PI*4/n)*1.8);}
  for(var y=0;y<n;y++)for(var x=0;x<n;x++){
   var noise=Math.sin(x*12.9898+y*78.233)*43758.5453;noise=(noise-Math.floor(noise)-.5)*2;
   // Linear near-white grayscale can be shared by albedo and height. It
   // gently shades the existing authored color; it can never whiten it.
   var v=250;
   if(kind==='wood')v=246+wave(x,y,.25)*6+wave(x,y,.82)*3+noise;
   else if(kind==='bark')v=243+wave(x,y,.43)*9+Math.sin(x*Math.PI*4/n+Math.sin(y*Math.PI*6/n)*.7)*5+noise*2;
   else if(kind==='plaster')v=250+noise*2+Math.sin(x*.31+y*.27)*2;
   else if(kind==='ceramic')v=252+noise+Math.sin(x*Math.PI*2/n)*1.5+Math.cos(y*Math.PI*2/n)*1.5;
   else if(kind==='foliage'){var mid=Math.abs(x-n/2);v=249+Math.max(0,1-mid/4)*4+Math.sin((y+mid*.65)*.32)*Math.max(0,1-mid/(n*.5))*2+noise;}
   else v=248+noise*3.5+Math.sin(x*.19+Math.sin(y*.23))*2;
   var at=(y*n+x)*4;a[at]=a[at+1]=a[at+2]=Math.max(0,Math.min(255,Math.round(v)));a[at+3]=255;
  }
  ctx.putImageData(image,0,0);var texture=new THREE.CanvasTexture(c);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.colorSpace=THREE.NoColorSpace;texture.anisotropy=2;texture.userData.styleRole=kind;texture.userData.usage='shared-linear-shade-and-height';return texture;
 }
 return Object.freeze({revision:'market-photo1',limits:limits,leafGeometry:leafGeometry,branchGeometry:branchGeometry,tileGeometry:tileGeometry,bowlGeometry:bowlGeometry,archGeometry:archGeometry,surfaceTexture:surfaceTexture});
}));

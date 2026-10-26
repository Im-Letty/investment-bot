/* Original code-native village detailing. No source art, game state or storage. */
(function(root,factory){
 'use strict';var api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;else root.PetTownStyle=api;
}(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 var limits=Object.freeze({treeLeaves:126,treeTwigs:9,leavesPerTwig:14,leafWidthSegments:8,leafHeightSegments:5,surfaceTextures:6,surfaceTextureSize:128,groundTextureSize:512,groundPatches:80});
 // A single collection contract supplies studio-warm material families.
 // Geometry, bitmap originals, seasonal leaf indexing and texture allocation
 // stay independent. No canvas-wide color filter or exposure is applied.
 var palette={
  wood:['#765034','#9a693f','#bd8d58','#d5ad79','#e9cba0'],
  bark:['#62432d','#795236','#906540','#a57b51','#b9956a'],
  plaster:['#c7b38f','#d9c7a7','#e6d6b9','#f0e4cf','#f8efdf'],
  ceramic:['#c4af89','#d6c4a3','#e3d4b8','#eee2cc','#f7eedb'],
  glaze:['#785897','#9572ae','#ae8bc5','#c5a5d8','#dfcbea'],
  terracotta:['#8e4e35','#a55e3e','#bc7650','#cf946d','#dfb18c'],
  stone:['#9e8b6d','#b7a384','#ccba9b','#dfd1b5','#eee4cd'],
  metal:['#76613d','#937b4c','#ae925b','#c6ad76','#ddc79a']
 };
 Object.keys(palette).forEach(function(k){Object.freeze(palette[k]);});Object.freeze(palette);
 var finishDefinitions={
  grass:{roughness:.96,metalness:0,bumpScale:0,textureRole:null},
  foliage:{roughness:.75,metalness:0,bumpScale:.023,textureRole:'foliage'},
  flower:{roughness:.78,metalness:0,bumpScale:0,textureRole:null},
  soil:{roughness:.98,metalness:0,bumpScale:.022,textureRole:'stone'},
  paper:{roughness:.90,metalness:0,bumpScale:.008,textureRole:'plaster'},
  plaster:{roughness:.84,metalness:0,bumpScale:.016,textureRole:'plaster'},
  wood:{roughness:.67,metalness:0,bumpScale:.027,textureRole:'wood'},
  bark:{roughness:.88,metalness:0,bumpScale:.052,textureRole:'bark'},
  ceramic:{roughness:.43,metalness:0,bumpScale:.006,textureRole:'ceramic'},
  glaze:{roughness:.32,metalness:0,bumpScale:.004,textureRole:'ceramic'},
  terracotta:{roughness:.83,metalness:0,bumpScale:.014,textureRole:'ceramic'},
  stone:{roughness:.85,metalness:0,bumpScale:.014,textureRole:'stone'},
  metal:{roughness:.43,metalness:.18,bumpScale:0,textureRole:null},
  glass:{roughness:.27,metalness:0,bumpScale:0,textureRole:null},
  water:{roughness:.26,metalness:0,bumpScale:0,textureRole:null}
 };
 Object.keys(finishDefinitions).forEach(function(k){Object.freeze(finishDefinitions[k]);});Object.freeze(finishDefinitions);
 var pigmentFamilies={};
 function pigment(family,colors){colors.concat(palette[family]||[]).forEach(function(c){pigmentFamilies[c]=family;});}
 pigment('glaze',['#ad94be','#9b7cb5','#b39bc9','#ad8fbe','#c1a5cf','#9983b0','#b5a0c6','#ab91b8','#c2a7cc']);
 pigment('terracotta',['#d6a18b','#e7b49b','#c7ab88','#ccae8f']);
 pigment('ceramic',['#eadbc3','#f2e4cd','#f6e7bc','#f9e6b5','#f2e5cf','#f3e7d3']);
 Object.freeze(pigmentFamilies);
 function hex(color){if(typeof color!=='string'||!/^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i.test(color))return null;var h=color.toLowerCase();return h.length===4?'#'+h[1]+h[1]+h[2]+h[2]+h[3]+h[3]:h;}
 function familyFor(role,h){if(role==='ceramic')return pigmentFamilies[h]||null;return Object.prototype.hasOwnProperty.call(palette,role)?role:null;}
 function paletteColor(color,role){
  var h=hex(color),family=h&&familyFor(role,h);if(!family)return color;
  var tones=palette[family];if(tones.indexOf(h)>=0)return h;
  var value=(parseInt(h.slice(1,3),16)*.2126+parseInt(h.slice(3,5),16)*.7152+parseInt(h.slice(5,7),16)*.0722)/255;
  var at=value<.25?0:value<.42?1:value<.60?2:value<.78?3:4;return tones[at];
 }
 function materialFinish(role,color){
  if(!Object.prototype.hasOwnProperty.call(finishDefinitions,role))return null;
  var family=hex(color)&&familyFor(role,hex(color));
  return finishDefinitions[family||role];
 }
 var light=Object.freeze({hemisphereSky:'#eaf1fb',hemisphereGround:'#ddd8d1',hemisphereIntensity:1.6,sunColor:'#fff4e7',sunIntensity:2.1});
 var collection=Object.freeze({revision:'shop-cottage-match2',palette:palette,finishes:finishDefinitions,light:light,
  references:Object.freeze({tree:'60cb702d2cac8ad22b09ad01621f55d24ddb4d3876f1f550f21cbfcdbaf8c7b9',house:'69ce8c93823a50c5f2225414d4df8adcfe92fcd271ae113982e64f7ccd01cd60',fountain:'b7394422852121b2d5b971fb42f82de6b9eb6460cb1b8bff5979b7e39d205006',sunflower:'3fe2389b077f5d01be2685ac8c6e4401b80703887d20227224e66d79aa422120',lantern:'fcddf79bb51dfd6c892e6f84101f2b59c2bd96b2085fc5339e727232f472a2da',flower:'f3303351c1e33b84905225edff5dcb361cf049542ad4289b324c4ff588551ab6',mushroom:'67e1d44960fd7fba76768b240e098bf1981304951d6474cef19ff72275eb03db'})});
 function leafGeometry(THREE){
  // Broad small pointed leaf with a thin bowed blade and soft midrib.
  // Keep the shop reference fullness; never an alpha card or a needle.
  var g=new THREE.SphereGeometry(1,limits.leafWidthSegments,limits.leafHeightSegments),p=g.attributes.position;
  for(var i=0;i<p.count;i++){
   var y=p.getY(i),body=Math.max(0,1-y*y);
   var t=(y+1)/2,bow=Math.sin(Math.PI*t);
   p.setXYZ(i,p.getX(i)*.48*Math.pow(body,.12)*(1+.18*y)+.012*bow,y,p.getZ(i)*.04+.035*bow);
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
  // More radial sides soften the bark silhouette; fewer longitudinal rings
  // keep the old per-component triangle budget. The centreline/endpoints
  // remain bounded by the previous trunk/branch recipe.
  var rings=kind==='trunk'?8:4,sides=kind==='trunk'?10:8,depth=kind==='trunk'?1:.84,positions=[],uv=[],indices=[],axis=[];
  function center(t){return kind==='trunk'?[Math.sin(t*Math.PI*2)*1.10+.32*t,t,Math.sin(t*Math.PI)*.42]:[Math.sin(t*Math.PI)*.55,t,Math.sin(t*Math.PI*2)*.13];}
  for(var y=0;y<=rings;y++){
   var t=y/rings,c=center(t),radius=(1-.76*t)*(kind==='trunk'?.92:1);axis.push(c.slice());
   for(var j=0;j<=sides;j++){var a=j/sides*Math.PI*2;positions.push(c[0]+Math.cos(a)*radius,c[1],c[2]+Math.sin(a)*radius*depth);uv.push(j/sides,t);}
  }
  for(var r=0;r<rings;r++)for(var s=0;s<sides;s++){var a=r*(sides+1)+s,b=a+sides+1;indices.push(a,b,a+1,b,b+1,a+1);}
  for(var end=0;end<=1;end++){
   var c=center(end),radius=(1-.76*end)*(kind==='trunk'?.92:1),base=positions.length/3;positions.push(c[0],c[1],c[2]);uv.push(.5,.5);
   for(var n=0;n<=sides;n++){var a=n/sides*Math.PI*2;positions.push(c[0]+Math.cos(a)*radius,c[1],c[2]+Math.sin(a)*radius*depth);uv.push((Math.cos(a)+1)/2,(Math.sin(a)+1)/2);}
   for(var n=0;n<sides;n++)if(end)indices.push(base,base+n+2,base+n+1);else indices.push(base,base+n+1,base+n+2);
  }
  var g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
  var n=g.attributes.normal;
  for(var r=0;r<=rings;r++){var a=r*(sides+1),b=a+sides,v=new THREE.Vector3(n.getX(a)+n.getX(b),n.getY(a)+n.getY(b),n.getZ(a)+n.getZ(b)).normalize();n.setXYZ(a,v.x,v.y,v.z);n.setXYZ(b,v.x,v.y,v.z);}
  g.computeBoundingBox();g.computeBoundingSphere();g.userData.axisCenters=axis;g.userData.radialSides=sides;
  g.userData.styleRole=kind==='trunk'?'curved-tapered-trunk':'curved-tapered-branch';return g;
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
 return Object.freeze({revision:'shop-cottage-match2',collection:collection,paletteColor:paletteColor,materialFinish:materialFinish,limits:limits,leafGeometry:leafGeometry,branchGeometry:branchGeometry,tileGeometry:tileGeometry,bowlGeometry:bowlGeometry,archGeometry:archGeometry,surfaceTexture:surfaceTexture});
}));

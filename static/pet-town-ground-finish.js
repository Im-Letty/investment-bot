/* Local outdoor finishes. No lighting, geometry, game state or frame clock. */
(function(root,factory){
  'use strict';
  var api=factory(typeof module==='object'&&module.exports?require('./pet-town-style.js'):root.PetTownStyle,
    typeof module==='object'&&module.exports?require('./pet-japan-seasons.js'):root.PetJapanSeasons);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.PetTownGroundFinish=api;
}(typeof window!=='undefined'?window:globalThis,function(Style,Seasons){
  'use strict';
  var REVISION='ground-finish1',ENVIRONMENT='shop-environment1',SIZE=512,MAX_MATERIALS=16;
  var pathPigments=Object.freeze({'#e4cfa6':'#eadcc3','#bca982':'#c4b397',
    '#d8c9a6':'#e5d8bf','#cbbb94':'#d8c9ad','#e0d2b0':'#eee3cc'});
  function hex(value){return typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);}
  function rgb(value){return [parseInt(value.slice(1,3),16),parseInt(value.slice(3,5),16),parseInt(value.slice(5,7),16)];}
  function profile(value){
    var api=Seasons||globalThis.PetJapanSeasons;
    var p=typeof value==='object'&&value?value:api&&api.profile(value||'summer');
    if(!p||!hex(p.ground))throw new Error('ground_finish_profile_invalid');
    return p;
  }
  // Seamless fine mottling lives in the ground's own seasonal bitmap. The
  // exact seasonal base remains the first paint; no screen overlay is added.
  function groundTexture(T,doc,season){
    var p=profile(season);
    if(!doc||typeof doc.createElement!=='function')return null;
    if(!T||typeof T.CanvasTexture!=='function')throw new Error('ground_finish_three_invalid');
    var canvas=doc.createElement('canvas');canvas.width=canvas.height=SIZE;
    var ctx=canvas.getContext&&canvas.getContext('2d');if(!ctx)return null;
    ctx.fillStyle=p.ground;ctx.fillRect(0,0,SIZE,SIZE);
    if(ctx.createImageData&&ctx.putImageData){
      var image=ctx.createImageData(SIZE,SIZE),pixels=image.data,base=rgb(p.ground),tau=Math.PI*2;
      for(var y=0;y<SIZE;y++)for(var x=0;x<SIZE;x++){
        var u=x/SIZE*tau,v=y/SIZE*tau;
        var moss=Math.sin(u*2+Math.sin(v*3)*.5)*1.6+Math.cos(v*3+Math.sin(u*2)*.4)*1.1+
          Math.sin(u*7+v*5)*.65;
        var h=Math.imul(x,73856093)^Math.imul(y,19349663);h=Math.imul(h^(h>>>13),1274126177);
        var grain=((h>>>0)/4294967295-.5)*2.2,at=(y*SIZE+x)*4;
        pixels[at]=Math.max(0,Math.min(255,Math.round(base[0]+moss+grain+.6)));
        pixels[at+1]=Math.max(0,Math.min(255,Math.round(base[1]+moss*.85+grain+.25)));
        pixels[at+2]=Math.max(0,Math.min(255,Math.round(base[2]+moss*.7+grain-.25)));
        pixels[at+3]=255;
      }
      ctx.putImageData(image,0,0);
    }
    var texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
    texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.anisotropy=4;
    texture.userData={environmentRevision:ENVIRONMENT,finishRevision:REVISION,season:p.key||null,
      baseColor:p.ground,role:'seasonal-fine-moss-ground',screenOverlay:false,pixelSize:SIZE};
    return texture;
  }
  function create(T,ctx){
    if(!T||typeof T.MeshStandardMaterial!=='function'||!ctx||!ctx.materials||typeof ctx.materials.add!=='function'||
      !ctx.textures||typeof ctx.textures.add!=='function'||ctx.surfaceMap!==undefined&&typeof ctx.surfaceMap!=='function')throw new Error('ground_finish_context_invalid');
    var cache=new Map(),maps=new Map(),allocatedTextures=0;
    function surface(kind){
      if(maps.has(kind))return maps.get(kind);
      var style=Style||globalThis.PetTownStyle;
      var map=ctx.surfaceMap?ctx.surfaceMap(kind):style&&style.surfaceTexture(T,ctx.doc,kind);
      if(map){if(!map.isTexture)throw new Error('ground_finish_texture_invalid');ctx.textures.add(map);if(!ctx.surfaceMap)allocatedTextures++;}
      maps.set(kind,map||null);return map||null;
    }
    function material(color,role){
      if(!hex(color)||['layout-path','wood','stone'].indexOf(role)<0)throw new Error('ground_finish_material_invalid');
      color=color.toLowerCase();var key=role+':'+color;if(cache.has(key))return cache.get(key);
      if(cache.size>=MAX_MATERIALS)throw new Error('ground_finish_material_limit');
      var pigment=role==='layout-path'?(pathPigments[color]||color):color;
      var m=new T.MeshStandardMaterial({color:pigment,metalness:0,roughness:role==='wood'?.72:role==='layout-path'?.80:.83});
      var map;
      try{map=surface(role==='wood'?'wood':'stone');}catch(error){m.dispose();throw error;}
      if(map){m.map=m.bumpMap=map;m.bumpScale=role==='wood'?.012:role==='layout-path'?.004:.006;}
      else m.bumpScale=0;
      m.userData={surfaceRole:role,paletteRole:'identity',baseColor:pigment,paletteColor:pigment,
        requestedColor:color,sceneryMaterial:true,environmentRevision:ENVIRONMENT,finishRevision:REVISION};
      ctx.materials.add(m);cache.set(key,m);return m;
    }
    function summary(){return {revision:REVISION,environmentRevision:ENVIRONMENT,materials:cache.size,
      materialLimit:MAX_MATERIALS,textureKinds:maps.size,textureLimit:2,allocatedTextures:allocatedTextures,
      geometryAllocations:0,lights:0,timers:0,resourceOwner:'scene',globalPaletteMutation:false};}
    return {revision:REVISION,environmentRevision:ENVIRONMENT,material:material,summary:summary};
  }
  return Object.freeze({revision:REVISION,environmentRevision:ENVIRONMENT,create:create,groundTexture:groundTexture,
    limits:Object.freeze({groundTextureSize:SIZE,materials:MAX_MATERIALS,surfaceTextureKinds:2}),pathPigments:pathPigments});
}));

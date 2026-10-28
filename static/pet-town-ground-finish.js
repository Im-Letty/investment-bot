/* Local outdoor finishes. No lighting, geometry, game state or frame clock.
   The enclosing Scene owns all registered maps and materials, including season swaps. */
(function(root,factory){
  'use strict';
  var api=factory(typeof module==='object'&&module.exports?require('./pet-town-style.js'):root.PetTownStyle,
    typeof module==='object'&&module.exports?require('./pet-japan-seasons.js'):root.PetJapanSeasons);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.PetTownGroundFinish=api;
}(typeof window!=='undefined'?window:globalThis,function(Style,Seasons){
  'use strict';
  var REVISION='ground-finish2',ENVIRONMENT='shop-environment2',SIZE=512,SURFACE_SIZE=128,MAX_MATERIALS=16;
  var pathPigments=Object.freeze({'#e4cfa6':'#eadcc3','#bca982':'#c4b397',
    '#d8c9a6':'#e5d8bf','#cbbb94':'#d8c9ad','#e0d2b0':'#eee3cc'});
  var groundSurface=Object.freeze({roughness:.92,bumpScale:.012,displacement:false});
  var finishes=Object.freeze({
    'layout-path':Object.freeze({map:'stone',roughness:.80,bumpScale:.008}),
    wood:Object.freeze({map:'wood',roughness:.64,bumpScale:.020}),
    stone:Object.freeze({map:'stone',roughness:.82,bumpScale:.012}),
    plaster:Object.freeze({map:'plaster',roughness:.80,bumpScale:.008}),
    ceramic:Object.freeze({map:'plaster',roughness:.42,bumpScale:.004}),
    glaze:Object.freeze({map:'plaster',roughness:.30,bumpScale:.003})
  });
  function hex(value){return typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);}
  function rgb(value){return [parseInt(value.slice(1,3),16),parseInt(value.slice(3,5),16),parseInt(value.slice(5,7),16)];}
  function profile(value){
    var api=Seasons||globalThis.PetJapanSeasons;
    var p=typeof value==='object'&&value?value:api&&api.profile(value||'summer');
    if(!p||!hex(p.ground))throw new Error('ground_finish_profile_invalid');
    return p;
  }
  function clampByte(value){return Math.max(0,Math.min(255,Math.round(value)));}
  function seed(x,y){
    var h=Math.imul(x,73856093)^Math.imul(y,19349663);
    h=Math.imul(h^(h>>>13),1274126177);return (h>>>0)/4294967295;
  }
  // Broad moss patches, tiny grain and short curved blades share one seasonal
  // albedo/height map. Periodic coordinates include both identical tile edges.
  // Mean removal retains the calendar base instead of grading the whole world.
  function groundTexture(T,doc,season){
    var p=profile(season);
    if(!doc||typeof doc.createElement!=='function')return null;
    if(!T||typeof T.CanvasTexture!=='function')throw new Error('ground_finish_three_invalid');
    var canvas=doc.createElement('canvas');canvas.width=canvas.height=SIZE;
    var ctx=canvas.getContext&&canvas.getContext('2d');if(!ctx)return null;
    ctx.fillStyle=p.ground;ctx.fillRect(0,0,SIZE,SIZE);
    if(ctx.createImageData&&ctx.putImageData){
      var image=ctx.createImageData(SIZE,SIZE),pixels=image.data,base=rgb(p.ground),tau=Math.PI*2;
      var tones=new Float32Array(SIZE*SIZE),mean=0;
      for(var y=0;y<SIZE;y++)for(var x=0;x<SIZE;x++){
        var nx=x/(SIZE-1),ny=y/(SIZE-1),u=nx*tau,v=ny*tau;
        var moss=Math.sin(u*2+Math.sin(v*3)*.5)*6.8+Math.cos(v*3+Math.sin(u*2)*.4)*4.2+
          Math.sin(u*7+v*5)*2.5+Math.sin(u*19-v*13)*.7;
        var cellX=Math.floor(nx*16)%16,cellY=Math.floor(ny*16)%16,r=seed(cellX,cellY);
        var fx=(nx*16)%1-.5,fy=(ny*16)%1-.5,angle=r*tau;
        var across=fx*Math.cos(angle)+fy*Math.sin(angle),along=-fx*Math.sin(angle)+fy*Math.cos(angle);
        var bow=.12*Math.sin((along+.35)/.70*Math.PI),width=.037*Math.sqrt(Math.max(0,1-Math.pow(along/.35,2)));
        var blade=0;
        if(Math.abs(along)<.35&&width>0){
          var center=across-bow,edge=Math.abs(center)/width;
          blade=9*Math.exp(-edge*edge*2)-5.4*Math.exp(-Math.pow((center-.045)/.045,2)*2);
        }
        var grain=(seed(x===SIZE-1?0:x,y===SIZE-1?0:y)-.5)*2.2;
        var tone=18*Math.tanh((moss+blade+grain)/18);
        tones[y*SIZE+x]=tone;mean+=tone;
      }
      mean/=SIZE*SIZE;
      for(var y=0;y<SIZE;y++)for(var x=0;x<SIZE;x++){
        var tone=tones[y*SIZE+x]-mean,at=(y*SIZE+x)*4;
        pixels[at]=clampByte(base[0]+tone);pixels[at+1]=clampByte(base[1]+tone);
        pixels[at+2]=clampByte(base[2]+tone*.80);pixels[at+3]=255;
      }
      ctx.putImageData(image,0,0);
    }
    var texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
    texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.anisotropy=4;
    texture.userData={environmentRevision:ENVIRONMENT,finishRevision:REVISION,season:p.key||null,
      baseColor:p.ground,role:'seasonal-layered-moss-and-curved-grass',screenOverlay:false,pixelSize:SIZE,
      periodicEdges:true,meanSeasonalColorPreserved:true,heightFromSameMap:true};
    return texture;
  }
  // Neutral linear modulation darkens the authored pigment locally; it cannot
  // whiten it. These maps belong only to the opt-in outdoor Scene provider.
  function surfaceTexture(T,doc,kind){
    if(['wood','stone','plaster'].indexOf(kind)<0)throw new Error('ground_finish_surface_kind_invalid');
    if(!doc||typeof doc.createElement!=='function')return null;
    var canvas=doc.createElement('canvas');canvas.width=canvas.height=SURFACE_SIZE;
    var ctx=canvas.getContext&&canvas.getContext('2d');
    if(!ctx||!ctx.createImageData||!ctx.putImageData)return null;
    var image=ctx.createImageData(SURFACE_SIZE,SURFACE_SIZE),pixels=image.data,tau=Math.PI*2;
    for(var y=0;y<SURFACE_SIZE;y++)for(var x=0;x<SURFACE_SIZE;x++){
      var u=x/(SURFACE_SIZE-1)*tau,v=y/(SURFACE_SIZE-1)*tau;
      var grain=Math.sin(u*29+v*37)*.5+Math.cos(u*43-v*31)*.5;
      var value;
      if(kind==='wood'){
        var phase=u*6+1.3*Math.sin(v)+.4*Math.sin(v*3);
        var darkRing=Math.pow(.5+.5*Math.cos(phase*3),10);
        value=244+Math.sin(phase)*6+Math.sin(phase*2+v)*3-darkRing*18+grain*1.5;
      }else if(kind==='stone'){
        var stone=Math.sin(u*3+.5*Math.sin(v*2))*.55+Math.cos(v*4+.4*Math.sin(u*3))*.45;
        var pores=Math.pow(Math.max(0,Math.sin(u*17+v*11)*Math.cos(v*13-u*7)),6);
        value=242+stone*9+grain*2.2-pores*8;
      }else{
        var plaster=Math.sin(u*3+v*2)*.5+Math.cos(v*4-u*3)*.5;
        var pores=Math.pow(Math.max(0,Math.sin(u*19+v*17)*Math.cos(v*23-u*11)),8);
        value=249+plaster*2.5+grain*1.5-pores*4;
      }
      var at=(y*SURFACE_SIZE+x)*4;
      pixels[at]=pixels[at+1]=pixels[at+2]=clampByte(value);pixels[at+3]=255;
    }
    ctx.putImageData(image,0,0);
    var texture=new T.CanvasTexture(canvas);texture.colorSpace=T.NoColorSpace;
    texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.anisotropy=4;
    texture.userData={environmentRevision:ENVIRONMENT,finishRevision:REVISION,surfaceRole:kind,
      usage:'local-linear-pigment-modulation-and-height',pixelSize:SURFACE_SIZE,periodicEdges:true,codeAuthored:true};
    return texture;
  }
  function applyGround(material,texture){
    if(!material||!material.isMaterial||!material.isMeshStandardMaterial||texture!==null&&(!texture||!texture.isTexture))
      throw new Error('ground_finish_ground_material_invalid');
    material.map=material.bumpMap=texture;material.bumpScale=texture?groundSurface.bumpScale:0;
    material.roughness=groundSurface.roughness;material.needsUpdate=true;
    material.userData.finishRevision=REVISION;material.userData.environmentRevision=ENVIRONMENT;
    material.userData.groundHeightMode='bump-only-no-displacement';
    return material;
  }
  function create(T,ctx){
    if(!T||typeof T.MeshStandardMaterial!=='function'||!ctx||!ctx.materials||typeof ctx.materials.add!=='function'||
      !ctx.textures||typeof ctx.textures.add!=='function'||ctx.surfaceMap!==undefined&&typeof ctx.surfaceMap!=='function'||
      ctx.localSurfaces!==undefined&&typeof ctx.localSurfaces!=='boolean')throw new Error('ground_finish_context_invalid');
    var cache=new Map(),maps=new Map(),allocatedTextures=0,applied=new Set();
    function surface(kind){
      if(maps.has(kind))return maps.get(kind);
      var map;
      if(ctx.localSurfaces||!ctx.surfaceMap)map=surfaceTexture(T,ctx.doc,kind);
      else map=ctx.surfaceMap(kind);
      if(map){if(!map.isTexture)throw new Error('ground_finish_texture_invalid');ctx.textures.add(map);if(ctx.localSurfaces||!ctx.surfaceMap)allocatedTextures++;}
      maps.set(kind,map||null);return map||null;
    }
    function applyTo(value,role){
      var finish=finishes[role];
      if(!value||!value.isMaterial||!value.isMeshStandardMaterial||!Object.prototype.hasOwnProperty.call(finishes,role))throw new Error('ground_finish_material_invalid');
      var map=surface(finish.map);
      value.map=value.bumpMap=map;value.bumpScale=map?finish.bumpScale:0;value.roughness=finish.roughness;
      value.userData.finishRevision=REVISION;value.userData.environmentRevision=ENVIRONMENT;
      value.userData.localOutdoorFinish=true;value.needsUpdate=true;applied.add(value);return value;
    }
    function material(color,role){
      if(!hex(color)||!Object.prototype.hasOwnProperty.call(finishes,role))throw new Error('ground_finish_material_invalid');
      color=color.toLowerCase();var key=role+':'+color;if(cache.has(key))return cache.get(key);
      if(cache.size>=MAX_MATERIALS)throw new Error('ground_finish_material_limit');
      var pigment=role==='layout-path'?(pathPigments[color]||color):color;
      var m=new T.MeshStandardMaterial({color:pigment,metalness:0});
      try{applyTo(m,role);}catch(error){m.dispose();throw error;}
      m.userData.surfaceRole=role;m.userData.paletteRole='identity';m.userData.baseColor=pigment;
      m.userData.paletteColor=pigment;m.userData.requestedColor=color;m.userData.sceneryMaterial=true;
      ctx.materials.add(m);cache.set(key,m);return m;
    }
    function summary(){return {revision:REVISION,environmentRevision:ENVIRONMENT,materials:cache.size,
      materialLimit:MAX_MATERIALS,textureKinds:maps.size,textureLimit:3,allocatedTextures:allocatedTextures,
      appliedExistingAndOwnedMaterials:applied.size,localSurfaces:!!ctx.localSurfaces,surfaceTextureSize:SURFACE_SIZE,
      geometryAllocations:0,lights:0,timers:0,resourceOwner:'scene',globalPaletteMutation:false};}
    return {revision:REVISION,environmentRevision:ENVIRONMENT,material:material,applyTo:applyTo,applyGround:applyGround,summary:summary};
  }
  return Object.freeze({revision:REVISION,environmentRevision:ENVIRONMENT,create:create,groundTexture:groundTexture,
    surfaceTexture:surfaceTexture,applyGround:applyGround,groundSurface:groundSurface,
    limits:Object.freeze({groundTextureSize:SIZE,materials:MAX_MATERIALS,surfaceTextureKinds:3,surfaceTextureSize:SURFACE_SIZE}),pathPigments:pathPigments});
}));

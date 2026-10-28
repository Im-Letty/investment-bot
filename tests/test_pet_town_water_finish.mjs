import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../static/vendor/three-0.160.1.module.js';
import Finish from '../static/pet-town-water-finish.js';
import Ocean from '../static/pet-town-ocean-life.js';
import Shore from '../static/pet-town-shore-transition.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const coast=[[0,2880],[550,2840],[1050,2720],[1450,2510],[1920,1990]];
function fixture(create=true,customT=T,withAprons=false){
  const group=new T.Group(),textures=new Set(),geometries=new Set(),materials=new Set();
  const world={width:2880,height:1920,places:[]};
  const sea=new T.Mesh(new T.BoxGeometry(48,.06,48),new T.MeshStandardMaterial({color:'#abd3cf',roughness:.26}));
  sea.name='water';sea.position.y=-.08;sea.renderOrder=-3;
  sea.material.transparent=true;sea.material.opacity=1;sea.material.depthWrite=false;
  const alpha=new T.DataTexture(new Uint8Array(16).fill(255),2,2,T.RGBAFormat);
  alpha.repeat.set(.8,.9);alpha.offset.set(.03,.07);alpha.updateMatrix();
  sea.material.alphaMap=alpha;textures.add(alpha);geometries.add(sea.geometry);materials.add(sea.material);group.add(sea);
  const oceanLife=Ocean.create(T,{group,world,shoreline:coast,geometries,materials});
  const groundAprons=[];
  if(withAprons){
    const a=new T.Mesh(new T.BoxGeometry(1.2,.08,20.4),sea.material),b=new T.Mesh(new T.BoxGeometry(28.8,.08,1.2),sea.material);
    a.position.set(-15,-.015,-.6);b.position.set(0,-.015,-10.2);a.updateMatrixWorld(true);b.updateMatrixWorld(true);
    groundAprons.push(a,b);geometries.add(a.geometry);geometries.add(b.geometry);
  }
  const shoreTransition=Shore.create(T,{group,world,shoreline:coast,groundAprons,groundColor:'#b1cf83',geometries,materials});
  const ctx={sea,oceanLife,shoreTransition,textures};
  const before={children:group.children.slice(),geometry:[...geometries],materials:[...materials],
    textures:[...textures],alpha,alphaMatrix:alpha.matrix.toArray(),seaMatrix:sea.matrix.toArray(),
    position:sea.position.toArray(),seaGeometry:sea.geometry,seaDepth:[sea.material.transparent,sea.material.opacity,sea.material.depthWrite,sea.material.depthTest,sea.renderOrder],
    shoreArrays:shoreTransition.shallowMeshes.map(m=>({position:Array.from(m.geometry.attributes.position.array),color:Array.from(m.geometry.attributes.color.array),index:Array.from(m.geometry.index.array)}))};
  return {group,world,textures,geometries,materials,ctx,before,finish:create?Finish.create(customT,ctx):null,
    cleanup(){for(const mesh of oceanLife.instanceMeshes)mesh.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();group.clear();}};
}
function seaDepth(f){const m=f.ctx.sea;return [m.material.transparent,m.material.opacity,m.material.depthWrite,m.material.depthTest,m.renderOrder];}
function oceanState(f){return f.ctx.oceanLife.group.children.map(m=>({position:m.position.toArray(),scale:m.scale.toArray(),opacity:m.material.opacity,order:m.renderOrder,matrix:m.matrixWorld.toArray(),instances:m.isInstancedMesh?Array.from(m.instanceMatrix.array):null}));}

test('portable UMD exposes the finish without clocks, storage, browser APIs or random generation',()=>{
  const realm=vm.createContext({});
  const source=readFileSync(new URL('../static/pet-town-water-finish.js',import.meta.url),'utf8');
  vm.runInContext(source,realm);
  assert.equal(realm.PetTownWaterFinish.revision,'water-finish1');
  assert.equal(typeof realm.PetTownWaterFinish.create,'function');
  assert.doesNotMatch(source,/Math\.random|Date\.|fetch\(|localStorage|setTimeout|setInterval|requestAnimationFrame/);
  assert.equal(Object.isFrozen(Finish.colors),true);
});

test('invalid contexts or target materials fail before allocating a texture or mutating a sea',()=>{
  const f=fixture(false);let allocations=0;
  function Counted(...args){allocations++;return new T.DataTexture(...args);}
  try{
    const old=f.ctx.sea.material.color.getHexString();
    assert.throws(()=>Finish.create({...T,DataTexture:Counted},{...f.ctx,textures:null}),/town_water_finish_context_unavailable/);
    const foam=f.ctx.oceanLife.group.children.find(m=>m.name.startsWith('incoming-shore-foam-')),mat=foam.material;
    foam.material=null;
    assert.throws(()=>Finish.create({...T,DataTexture:Counted},f.ctx),/town_water_finish_material_unavailable/);
    foam.material=mat;
    assert.equal(allocations,0);assert.equal(f.textures.size,f.before.textures.length);
    assert.equal(f.ctx.sea.material.color.getHexString(),old);assert.equal(f.ctx.sea.material.map,null);
  }finally{f.cleanup();}
});

test('one deterministic periodic128-square low-contrast linear texture is shared by color modulation and height',()=>{
  let allocations=0;
  function Counted(...args){allocations++;return new T.DataTexture(...args);}
  const f=fixture(true,{...T,DataTexture:Counted}),g=fixture();
  try{
    const texture=f.finish.texture,p=texture.image.data;
    assert.equal(allocations,1);assert.equal(texture.image.width,128);assert.equal(texture.image.height,128);
    assert.equal(p.length,128*128*4);assert.ok(p instanceof Uint8Array);
    assert.deepEqual(p,g.finish.texture.image.data);assert.notEqual(p,g.finish.texture.image.data);
    let low=255,high=0,seam=0;
    for(let y=0;y<128;y++)for(let x=0;x<128;x++){
      const i=(y*128+x)*4;assert.equal(p[i+3],255);
      for(let c=0;c<3;c++){low=Math.min(low,p[i+c]);high=Math.max(high,p[i+c]);}
    }
    for(let i=0;i<128;i++)for(let c=0;c<3;c++){
      seam=Math.max(seam,Math.abs(p[(i*128)*4+c]-p[(i*128+127)*4+c]),
        Math.abs(p[i*4+c]-p[((127*128)+i)*4+c]));
    }
    assert.ok(high>low+4&&high-low<=24,'subtle non-flat modulation instead of a flat or high-contrast image');
    assert.ok(low>=224&&high<=252);assert.ok(seam<=4,'opposite repeat samples meet with only the normal one-pixel slope');
    assert.equal(texture.colorSpace,T.NoColorSpace,'near-white multiplier/height bytes remain linear');
    assert.equal(texture.wrapS,T.RepeatWrapping);assert.equal(texture.wrapT,T.RepeatWrapping);
    assert.equal(texture.minFilter,T.LinearFilter);assert.equal(texture.magFilter,T.LinearFilter);
    assert.equal(texture.generateMipmaps,false);
    assert.equal(f.ctx.sea.material.map,texture);assert.equal(f.ctx.sea.material.bumpMap,texture);
    assert.deepEqual(texture.repeat.toArray(),[12,12]);
    assert.equal(texture.userData.disposalOwner,'scene-texture-set');
  }finally{f.cleanup();g.cleanup();}
});

test('geometry, water level, alpha-mask coordinates, depth/sort and all existing shore vertex arrays remain untouched',()=>{
  const f=fixture();
  try{
    assert.deepEqual(f.group.children,f.before.children);assert.deepEqual([...f.geometries],f.before.geometry);
    assert.deepEqual([...f.materials],f.before.materials);assert.equal(f.textures.size,f.before.textures.length+1);
    assert.equal(f.ctx.sea.geometry,f.before.seaGeometry);
    assert.deepEqual(f.ctx.sea.position.toArray(),f.before.position);assert.deepEqual(f.ctx.sea.matrix.toArray(),f.before.seaMatrix);
    assert.deepEqual(seaDepth(f),f.before.seaDepth);assert.equal(f.ctx.sea.material.alphaMap,f.before.alpha);
    const box=new T.Box3().setFromObject(f.ctx.sea);assert.ok(Math.abs(box.max.y+.05)<1e-8);
    f.finish.animate(.28,false);
    assert.deepEqual(f.before.alpha.matrix.toArray(),f.before.alphaMatrix);
    assert.notDeepEqual(f.finish.texture.matrix.toArray(),f.before.alphaMatrix);
    f.ctx.shoreTransition.shallowMeshes.forEach((m,i)=>{
      assert.deepEqual(Array.from(m.geometry.attributes.position.array),f.before.shoreArrays[i].position);
      assert.deepEqual(Array.from(m.geometry.attributes.color.array),f.before.shoreArrays[i].color);
      assert.deepEqual(Array.from(m.geometry.index.array),f.before.shoreArrays[i].index);
      assert.equal(m.renderOrder,-2.5);assert.equal(m.material.depthWrite,false);
    });
    for(const m of f.ctx.oceanLife.group.children){assert.equal(m.renderOrder,-2);assert.equal(m.material.depthWrite,false);}
    assert.equal(f.ctx.oceanLife.group.renderOrder,0);
  }finally{f.cleanup();}
});

test('sea is gently turquoise and only actual foam, glint and shallow materials receive the cream-family tint',()=>{
  const f=fixture();
  try{
    assert.equal(f.ctx.sea.material.color.getHexString(),new T.Color(Finish.colors.sea).getHexString());
    assert.equal(f.ctx.sea.material.roughness,.30);assert.equal(f.ctx.sea.material.metalness,0);assert.equal(f.ctx.sea.material.bumpScale,.006);
    const sea=f.ctx.sea.material.color;assert.ok(sea.g>sea.r&&sea.b>sea.r,'natural turquoise remains distinct from warm sand');
    for(const m of f.ctx.oceanLife.group.children){
      assert.equal(m.material.color.getHexString(),new T.Color(m.name.startsWith('incoming-shore-foam-')?Finish.colors.foam:Finish.colors.glint).getHexString());
      assert.equal(m.material.transparent,true);assert.equal(m.material.depthTest,true);
    }
    for(const m of f.ctx.shoreTransition.shallowMeshes)assert.equal(m.material.color.getHexString(),new T.Color(Finish.colors.shallowTint).getHexString());
    const beach=f.ctx.shoreTransition.shoreMeshes[0];
    assert.equal(beach.material.color.getHexString(),'ffffff');assert.equal(beach.material.depthWrite,true);assert.equal(beach.renderOrder,-4);
    assert.equal(f.finish.metrics.geometriesAdded,0);assert.equal(f.finish.metrics.lightsAdded,0);
  }finally{f.cleanup();}
});

test('existing six-second ocean timing and motion remain authoritative while finish changes UVs only',()=>{
  const f=fixture();
  try{
    assert.equal(f.ctx.oceanLife.metrics.periodMs,6000);
    for(const ms of [0,273,1550,4300,6000,9800]){
      const state=f.ctx.oceanLife.animate(ms,false),before=oceanState(f),phase=state.phase;
      f.finish.animate(phase,false);
      assert.deepEqual(oceanState(f),before);assert.equal(f.ctx.oceanLife.diagnostics.phase,phase);
      assert.equal(f.finish.summary().phase,phase);
      assert.ok(Math.abs(f.finish.texture.offset.x)<=.014+1e-12);
      assert.ok(f.finish.texture.offset.y<=0&&f.finish.texture.offset.y>=-.020-1e-12);
    }
    assert.equal(f.finish.metrics.clocksAdded,0);
    assert.equal(f.finish.metrics.phaseSource,'existing-ocean-diagnostics');
  }finally{f.cleanup();}
});

test('period endpoints join smoothly and reduced or invalid phases return an exact stable rest',()=>{
  const f=fixture();
  try{
    f.finish.animate(0,false);const rest=f.finish.texture.offset.toArray();
    f.finish.animate(1,false);assert.deepEqual(f.finish.texture.offset.toArray(),rest);
    f.finish.animate(1e-6,false);const right=f.finish.texture.offset.clone();
    f.finish.animate(1-1e-6,false);assert.ok(f.finish.texture.offset.distanceTo(right)<2e-6);
    for(const phase of [.2,.73,NaN,Infinity,-Infinity,-8,Number.MAX_VALUE,undefined]){
      assert.equal(f.finish.animate(phase,false),true);
      assert.ok(f.finish.texture.offset.toArray().every(Number.isFinite));
      assert.ok(f.finish.texture.matrix.elements.every(Number.isFinite));
      f.finish.animate(phase,true);assert.deepEqual(f.finish.texture.offset.toArray(),[0,0]);
      assert.equal(f.finish.summary().reduced,true);
    }
  }finally{f.cleanup();}
});

test('frames never regenerate pixels, upload images, allocate another texture or alter existing material/geometry sets',()=>{
  const f=fixture();
  try{
    const texture=f.finish.texture,image=texture.image,pixels=image.data,copy=pixels.slice(),version=texture.version;
    const geometry=[...f.geometries],materials=[...f.materials],textures=[...f.textures];
    for(let i=0;i<180;i++)f.finish.animate((i/179)%1,i%29===0);
    assert.equal(texture.image,image);assert.equal(texture.image.data,pixels);assert.deepEqual(pixels,copy);
    assert.equal(texture.version,version);assert.deepEqual([...f.geometries],geometry);
    assert.deepEqual([...f.materials],materials);assert.deepEqual([...f.textures],textures);
    assert.equal(f.finish.metrics.textureBytes,65536);
  }finally{f.cleanup();}
});

test('four seasons retain the same water finish and repeated setup deduplicates the exact texture instance',()=>{
  const f=fixture();
  try{
    const texture=f.finish.texture,pixels=texture.image.data,mat=f.ctx.sea.material.color.getHexString(),count=f.textures.size;
    for(const key of ['spring','summer','autumn','winter']){
      f.finish.setSeason(key);assert.equal(f.finish.summary().season,key);
      assert.equal(f.finish.texture,texture);assert.equal(texture.image.data,pixels);
      assert.equal(f.ctx.sea.material.color.getHexString(),mat);assert.equal(f.textures.size,count);
    }
    assert.throws(()=>f.finish.setSeason('weather'),/town_water_finish_season_unavailable/);
    assert.equal(Finish.create(T,f.ctx),f.finish);assert.equal(f.textures.size,count);
    assert.throws(()=>Finish.create(T,{...f.ctx,textures:new Set()}),/town_water_finish_conflict/);
    assert.equal(f.textures.size,count);
  }finally{f.cleanup();}
});

test('the Scene alone disposes its shared texture once and the finish then stops responding',()=>{
  const f=fixture();let disposed=0;
  f.finish.texture.addEventListener('dispose',()=>disposed++);
  assert.equal(f.finish.dispose,undefined);assert.equal(f.finish.resourceOwner,'scene-texture-set');
  assert.equal(f.finish.summary().disposed,false);
  f.finish.animate(.5,false);assert.equal(disposed,0);
  f.cleanup();assert.equal(disposed,1);assert.equal(f.finish.summary().disposed,true);
  const rest=f.finish.texture.offset.toArray();
  assert.equal(f.finish.animate(.3,false),false);assert.deepEqual(f.finish.texture.offset.toArray(),rest);
  assert.equal(f.finish.setSeason('spring'),false);
});

function compileSea(f){
  const shader={uniforms:{},vertexShader:T.ShaderLib.standard.vertexShader,fragmentShader:T.ShaderLib.standard.fragmentShader};
  f.ctx.sea.material.onBeforeCompile(shader,{name:'bounded-shader-test'});
  return shader;
}
function farFixture(){
  const f=fixture(false,T,true);f.ctx.world=f.world;
  f.ctx.sea.updateMatrixWorld(true);f.finish=Finish.create(T,f.ctx);return f;
}

test('far fade derives18-to24 from actual sea/apron bounds and stays outside all saved-map, shore, bridge and fishing coordinates',()=>{
  const f=farFixture();
  try{
    const shader=compileSea(f),u=shader.uniforms,s=f.finish.summary().farFade;
    assert.equal(s.enabled,true);assert.ok(Math.abs(s.start-18)<1e-9);assert.ok(Math.abs(s.end-24)<1e-9);
    assert.ok(Math.abs(s.protectedExtent-17.4)<1e-6,'actual Float32 apron bounds retain the same authored protection envelope');assert.ok(s.start>s.protectedExtent);
    assert.equal(u.knWFStart.value,s.start);assert.equal(u.knWFEnd.value,s.end);
    const center=u.knWFCenter.value,weight=(x,z)=>{
      const t=Math.max(0,Math.min(1,(Math.max(Math.abs(x-center.x),Math.abs(z-center.y))-s.start)/(s.end-s.start)));
      return t*t*(3-2*t);
    };
    const near=[[-14.4,-9.6],[14.4,9.6],[-15.6,-10.8],[12.05,2],[10.97,5.4]];
    for(const [x,z] of near)assert.equal(weight(x,z),0);
    for(const mesh of f.ctx.shoreTransition.shallowMeshes){
      const p=mesh.geometry.attributes.position;
      for(let i=0;i<p.count;i++)assert.equal(weight(p.getX(i),p.getZ(i)),0,'every current shallow vertex stays entirely unchanged');
    }
    assert.equal(weight(24,0),1);assert.equal(weight(0,-24),1);assert.equal(weight(24,24),1);
    assert.ok(weight(21,0)>0&&weight(21,0)<1);
    assert.deepEqual(seaDepth(f),f.before.seaDepth);assert.equal(f.ctx.sea.material.alphaMap,f.before.alpha);
    assert.equal(f.ctx.sea.geometry,f.before.seaGeometry);
  }finally{f.cleanup();}
});

test('far shader chains the existing callback/cache key and patches actual bundled Standard shaders after tone mapping without changing alpha',()=>{
  const f=fixture(false,T,true);f.ctx.world=f.world;
  let calls=0,key='prior-one';
  f.ctx.sea.material.onBeforeCompile=function(shader,renderer){calls++;assert.equal(this,f.ctx.sea.material);assert.equal(renderer.name,'bounded-shader-test');shader.uniforms.previous={value:7};};
  f.ctx.sea.material.customProgramCacheKey=function(){return key;};
  try{
    f.finish=Finish.create(T,f.ctx);const shader=compileSea(f);
    assert.equal(calls,1);assert.equal(shader.uniforms.previous.value,7);
    assert.match(f.ctx.sea.material.customProgramCacheKey(),/^prior-one\|water-finish1-far-edge1$/);
    key='prior-two';assert.match(f.ctx.sea.material.customProgramCacheKey(),/^prior-two\|water-finish1-far-edge1$/);
    assert.match(shader.vertexShader,/instanceMatrix \* knWFWorld/);
    assert.match(shader.vertexShader,/batchingMatrix \* knWFWorld/);
    assert.match(shader.vertexShader,/modelMatrix \* knWFWorld/);
    assert.match(shader.fragmentShader,/equirectUv\( knWFRay \)/);
    assert.match(shader.fragmentShader,/vKnWFWorld - cameraPosition/);
    assert.ok(shader.fragmentShader.indexOf('#include <tonemapping_fragment>')<shader.fragmentShader.indexOf('knWFBlend ='));
    assert.ok(shader.fragmentShader.indexOf('gl_FragColor.rgb = mix')<shader.fragmentShader.indexOf('#include <colorspace_fragment>'));
    assert.equal((shader.fragmentShader.match(/gl_FragColor\.a\s*=/g)||[]).length,0);
    for(const chunk of ['map_fragment','alphamap_fragment','opaque_fragment','tonemapping_fragment','colorspace_fragment'])assert.ok(shader.fragmentShader.includes('#include <'+chunk+'>'));
    assert.equal(shader.fragmentShader.includes('fogColor ='),false);
    assert.throws(()=>f.ctx.sea.material.onBeforeCompile({uniforms:{},vertexShader:'void main(){}',fragmentShader:'void main(){}'},{name:'bounded-shader-test'}),/town_water_finish_shader_unavailable/);
  }finally{f.cleanup();}
});

test('season horizon and existing sky sampler uniforms update without compilation, texture allocation or pixel upload',()=>{
  const f=farFixture();
  const sky=new T.DataTexture(new Uint8Array([220,231,235,255]),1,1,T.RGBAFormat);
  sky.colorSpace=T.SRGBColorSpace;f.textures.add(sky);
  try{
    const shader=compileSea(f),uniform=shader.uniforms.knWFHorizon,version=f.ctx.sea.material.version;
    const textureVersion=f.finish.texture.version,skyVersion=sky.version,pixels=f.finish.texture.image.data,count=f.textures.size;
    const key=f.ctx.sea.material.customProgramCacheKey(),hook=f.ctx.sea.material.onBeforeCompile;
    for(const [season,color] of [['spring','#e8ebda'],['summer','#edf0df'],['autumn','#eee2ce'],['winter','#e8eced']]){
      f.finish.setSeason(season);f.finish.setHorizonColor(color);
      assert.equal(shader.uniforms.knWFHorizon,uniform);
      assert.equal(uniform.value.getHexString(),new T.Color(color).getHexString());
    }
    assert.equal(f.finish.setSkyTexture(sky),true);assert.equal(f.finish.setSkyTexture(sky),false);
    assert.equal(shader.uniforms.knWFSky.value,sky);assert.equal(shader.uniforms.knWFHasSky.value,1);
    assert.equal(f.finish.summary().farFade.existingSkyTextureBound,true);
    f.finish.animate(.4,false);f.finish.animate(.9,true);
    assert.equal(f.textures.size,count);assert.equal(f.finish.texture.image.data,pixels);
    assert.equal(f.finish.texture.version,textureVersion);assert.equal(sky.version,skyVersion);
    assert.equal(f.ctx.sea.material.version,version);assert.equal(f.ctx.sea.material.onBeforeCompile,hook);
    assert.equal(f.ctx.sea.material.customProgramCacheKey(),key);
    assert.equal(f.finish.setSkyTexture(null),true);assert.equal(shader.uniforms.knWFHasSky.value,0);
    assert.equal(f.finish.summary().farFade.existingSkyTextureBound,false);
    assert.throws(()=>f.finish.setHorizonColor('untrusted-color'),/town_water_finish_horizon_unavailable/);
    const cube=new T.CubeTexture();assert.throws(()=>f.finish.setSkyTexture(cube),/town_water_finish_sky_unavailable/);cube.dispose();
  }finally{f.cleanup();}
});

test('far configuration rejects incompatible water extents before creating a finish texture and preserves default-hook cache identity',()=>{
  const f=fixture(false,T,true);let allocations=0;
  function Counted(...args){allocations++;return new T.DataTexture(...args);}
  const before=f.ctx.sea.material.onBeforeCompile;
  try{
    f.ctx.world={width:6000,height:1920};
    assert.throws(()=>Finish.create({...T,DataTexture:Counted},f.ctx),/town_water_finish_far_range_unavailable/);
    assert.equal(allocations,0);assert.equal(f.ctx.sea.material.onBeforeCompile,before);
    assert.equal(f.ctx.sea.material.map,null);assert.equal(f.textures.size,f.before.textures.length);
  }finally{f.cleanup();}
  const a=fixture(false),b=fixture(false);a.ctx.world=a.world;b.ctx.world=b.world;
  a.ctx.sea.material.onBeforeCompile=function firstWaterHook(){};
  b.ctx.sea.material.onBeforeCompile=function secondWaterHook(){};
  try{
    a.finish=Finish.create(T,a.ctx);b.finish=Finish.create(T,b.ctx);
    assert.notEqual(a.ctx.sea.material.customProgramCacheKey(),b.ctx.sea.material.customProgramCacheKey());
  }finally{a.cleanup();b.cleanup();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Scene from '../static/pet-town-scene.js';
import Town from '../static/pet-town-walk.js';
import Seasons from '../static/pet-japan-seasons.js';
import Environment from '../static/pet-town-environment.js';
function document(){
 const canvases=[];
 return {canvases,createElement(){const c={width:0,height:0,stops:[]},ctx={
  createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},putImageData(i){c.pixels=i.data;},
  createLinearGradient(...bounds){c.gradientBounds=bounds;return {addColorStop(at,color){c.stops.push([at,color]);}};},
  createRadialGradient(){return {addColorStop(){}};},fillRect(){},beginPath(){},ellipse(){},fill(){},fillText(){}
 };c.getContext=()=>ctx;canvases.push(c);return c;}};
}
test('sky uses a bounded world background gradient and safe non-canvas fallback',()=>{
 const doc=document(),t=Scene.skyTexture(THREE,doc,Seasons.profile('autumn')),expected=Environment.profile(Seasons.profile('autumn'));
 try{
  assert.deepEqual([t.image.width,t.image.height],[256,128]);assert.equal(t.colorSpace,THREE.SRGBColorSpace);
  assert.equal(t.mapping,THREE.EquirectangularReflectionMapping);
  assert.ok(t.image.stops.some(([at,c])=>at===0&&c===expected.sky));
  assert.ok(t.image.stops.some(([at,c])=>at===.70&&c===expected.horizon));
  assert.notEqual(expected.sky,expected.horizon);
  assert.equal(Scene.skyTexture(THREE,null,Seasons.profile('autumn')),null);
  assert.equal(Scene.skyTexture(THREE,{createElement(){return {getContext(){return {};}};}},Seasons.profile('autumn')),null);
 }finally{t.dispose();}
});
test('season transitions replace only bounded presentation maps and dispose each sky once',()=>{
 const doc=document(),world=Town.createWorld(),saved=JSON.stringify(world),m=Scene.buildWorld(THREE,world,{},null,doc,'autumn'),geometries=[...m.geometries];
 const disposed=new Map();
 function sky(){return [...m.textures].filter(t=>t.userData.presentationRole==='bounded-seasonal-sky-background');}
 try{
  for(const key of ['spring','summer','winter','autumn']){
   const old=sky();assert.equal(old.length,1);disposed.set(old[0],0);old[0].addEventListener('dispose',()=>disposed.set(old[0],disposed.get(old[0])+1));
   assert.equal(m.setSeason(key),true);assert.equal(disposed.get(old[0]),1);assert.equal(sky().length,1);
   assert.equal(m.scene.background,sky()[0]);assert.equal(m.scene.environment,null);assert.equal(m.scene.fog,null);
   assert.deepEqual([...m.geometries],geometries);assert.equal(JSON.stringify(world),saved);
   const same=sky()[0];m.setSeason(key);assert.equal(sky()[0],same);
  }
  const last=sky()[0];disposed.set(last,0);last.addEventListener('dispose',()=>disposed.set(last,disposed.get(last)+1));
 }finally{m.dispose();m.dispose();}
 assert.ok([...disposed.values()].every(n=>n===1));
});
test('distant mounds remain outside gameplay surfaces while four calendar seasons keep distinct greens/snow',()=>{
 const world=Town.createWorld(),m=Scene.buildWorld(THREE,world,{}),hills=[];
 try{
  m.scene.traverse(o=>{if(o.name==='distant-rounded-hill')hills.push(o);});
  assert.equal(hills.length,12);assert.ok(hills.every(h=>!m.surfaces.includes(h)&&!m.occluders.includes(h)));
  assert.equal(new Set(hills.map(h=>h.geometry)).size,1);
  assert.ok(hills.every(h=>h.position.y+h.scale.y<=.81));
  assert.equal(new Set(['spring','summer','autumn','winter'].map(k=>Seasons.profile(k).ground)).size,4);
  assert.equal(Seasons.resolve(Date.parse('2026-11-30T14:59:59Z')).key,'autumn');
  assert.equal(Seasons.resolve(Date.parse('2026-11-30T15:00:00Z')).key,'winter');
 }finally{m.dispose();}
});

test('legacy isolated previews can explicitly select a flat night background without throwing',()=>{
 const m=Scene.buildWorld(THREE,Town.createWorld(),{},null,document(),'autumn');
 try{
  const gradient=m.scene.background;assert.equal(gradient.isTexture,true);
  m.scene.background.set('#343c53');assert.equal(m.scene.background.isColor,true);assert.equal(m.scene.background.getHexString(),'343c53');
  m.scene.background.set(Seasons.profile('autumn').sky);
  m.setSeason('winter');assert.equal(m.scene.background.isTexture,true);assert.notEqual(m.scene.background,gradient);
 }finally{m.dispose();}
});

test('finite visual sea still covers the full saved river/coast while letting the sky appear beyond',()=>{
 const world=Town.createWorld(),m=Scene.buildWorld(THREE,world,{});
 try{
  const sea=m.scene.getObjectByName('water');assert.ok(sea);m.scene.updateMatrixWorld(true);
  const b=new THREE.Box3().setFromObject(sea);
  assert.ok(b.min.x<=-world.width/200-7.9&&b.max.x>=world.width/200+7.9);
  assert.ok(b.min.z<=-world.height/200-7.9&&b.max.z>=world.height/200+7.9);
  assert.ok(b.max.z-b.min.z<50);assert.equal(sea.material.userData.surfaceRole,'water');
  assert.equal(sea.position.y,-.08);assert.ok(!m.surfaces.includes(sea));
 }finally{m.dispose();}
});

test('only the distant coast edge blends into the sky; the entire saved map keeps opaque water',()=>{
 const world=Town.createWorld(),m=Scene.buildWorld(THREE,world,{},null,document(),'autumn');
 try{
  const sea=m.scene.getObjectByName('water'),mask=sea.material.alphaMap;assert.ok(mask);
  assert.equal(mask.colorSpace,THREE.NoColorSpace);assert.deepEqual([mask.image.width,mask.image.height],[128,128]);
  const pixels=mask.image.pixels;assert.ok(pixels);let inner=0,outer=0;
  for(let y=0;y<128;y++)for(let x=0;x<128;x++){
   const i=(y*128+x)*4,wx=((x+.5)/128*2-1)*24,wz=((y+.5)/128*2-1)*24;
   if(Math.abs(wx)<=world.width/200&&Math.abs(wz)<=world.height/200){assert.equal(pixels[i+1],255);inner++;}
   if(x===0||y===0||x===127||y===127){assert.equal(pixels[i+1],0);outer++;}
  }
  assert.ok(inner>1000&&outer>400);assert.equal(sea.material.depthWrite,false);
 }finally{m.dispose();}
});

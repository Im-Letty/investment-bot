import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Originals from '../static/pet-town-placement-originals.js';
import Scene from '../static/pet-town-scene.js';
import Town from '../static/pet-town-walk.js';
const treeKinds=['tree','treeApple','treeBirch','treeGrove'];
const rgba=v=>v.map((c,i)=>i===3?c/255:c/255<=.04045?c/255/12.92:Math.pow((c/255+.055)/1.055,2.4));
const clone=v=>JSON.parse(JSON.stringify(v));
function context(){return {textures:new Set(),materials:new Set()};}
function imageTexture(kind){const p=Originals.resolve(kind);return new THREE.Texture({width:p.width,height:p.height,sourceKind:kind});}
function shaderFor(material){const shader={uniforms:{},fragmentShader:THREE.ShaderLib.sprite.fragmentShader};material.onBeforeCompile(shader);return shader;}
function docFixture(){return {createElement(){const canvas={},gradient=()=>({addColorStop(){}});canvas.getContext=()=>({fillRect(){},clearRect(){},beginPath(){},ellipse(){},moveTo(){},lineTo(){},fill(){},stroke(){},fillText(){},createRadialGradient:gradient,createLinearGradient:gradient,drawImage(){},putImageData(){},createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)})});return canvas;}};}

// Observed opaque source pixels. Coordinates identify bounded samples, not a
// semantic whole-image segmentation. Each actual source file is SHA bound below.
const probes=[
 {kind:'tree',leaf:[242,66,[89,115,65,253]],bark:[250,360,[158,97,54,253]]},
 {kind:'treeApple',leaf:[660,99,[110,137,62,253]],bark:[660,1030,[206,136,79,253]]},
 {kind:'treeBirch',leaf:[495,99,[137,166,77,252]],bark:[705,1030,[239,206,167,253]]},
 {kind:'treeGrove',leaf:[450,220,[191,171,47,253]],bark:[590,920,[154,91,54,253]]}
];
test('actual SHA-bound canopy samples are selected while four observed bark samples, red apples and neutral colours are excluded',()=>{
 for(const row of probes){const p=Originals.resolve(row.kind),bytes=readFileSync(new URL('../'+p.url.slice(1),import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),p.sha256);assert(Originals.foliageMaskLinear(rgba(row.leaf[2]).slice(0,3))>.35,row.kind+' leaf');assert.equal(Originals.foliageMaskLinear(rgba(row.bark[2]).slice(0,3)),0,row.kind+' bark');}
 for(const v of [[240,81,59,253],[245,117,80,253],[120,120,120,255],[30,40,90,255],[0,0,0,0],[255,255,255,255]])assert.equal(Originals.foliageMaskLinear(rgba(v).slice(0,3)),0);
});

test('summer is exact identity and other authored seasons preserve alpha and bounded shading distinctions without mutating input',()=>{
 const colors=probes.flatMap(row=>[rgba(row.leaf[2]),rgba(row.bark[2])]);colors.push(rgba([240,81,59,253]),[0,0,0,0],[1,1,1,1]);
 for(const input of colors){const before=input.slice();assert.deepEqual(Originals.projectFoliageLinear(input,'summer'),input);for(const key of ['spring','autumn','winter']){const out=Originals.projectFoliageLinear(input,key);assert.equal(out[3],input[3]);assert(out.every(n=>Number.isFinite(n)&&n>=0&&n<=1));if(Originals.foliageMaskLinear(input.slice(0,3))===0)assert.deepEqual(out,input);}assert.deepEqual(input,before);}
 const green=rgba([110,137,62,253]),dark=green.map((n,i)=>i===3?n:n*.5);
 for(const key of ['spring','autumn','winter']){const a=Originals.projectFoliageLinear(green,key),b=Originals.projectFoliageLinear(dark,key);assert.notDeepEqual(a.slice(0,3),green.slice(0,3));assert(a[0]>b[0]&&a[1]>b[1]&&a[2]>b[2]);}
 for(const bad of [[NaN,0,0,1],[0,0,0],[0,0,2,1]])assert.throws(()=>Originals.projectFoliageLinear(bad,'spring'));
 assert.throws(()=>Originals.projectFoliageLinear(green,'__proto__'));
});

test('the vendored Sprite shader receives only tree RGB filtering with shared uniform objects and a stable program key',()=>{
 const ctx=context(),a=Originals.create(THREE,ctx),sprites=treeKinds.map(k=>a.createSprite(k,{width:2})),home=a.createSprite('home',{width:2});
 try{const shaders=sprites.map(s=>shaderFor(s.material));for(let i=0;i<shaders.length;i++){const shader=shaders[i];assert.equal(sprites[i].material.customProgramCacheKey(),'seasonal-canopy1');assert.equal(shader.uniforms.originalLeafBlend.value,0);assert.strictEqual(shader.uniforms.originalLeafBlend,shaders[0].uniforms.originalLeafBlend);assert.strictEqual(shader.uniforms.originalLeafTint,shaders[0].uniforms.originalLeafTint);assert.match(shader.fragmentShader,/#include <map_fragment>[\s\S]*#ifdef USE_MAP/);assert.match(shader.fragmentShader,/if \( originalLeafBlend > 0\.0 \)/);assert.match(shader.fragmentShader,/diffuseColor\.rgb = mix/);assert.doesNotMatch(shader.fragmentShader,/diffuseColor\.a\s*=/);assert.equal(sprites[i].material.color.getHexString(),'ffffff');}
 assert.equal(home.material.userData.seasonalCanopyRevision,undefined);assert.strictEqual(home.material.onBeforeCompile,THREE.Material.prototype.onBeforeCompile);assert.equal(a.summary().maskedTreeMaterials,4);assert.throws(()=>sprites[0].material.onBeforeCompile({uniforms:{},fragmentShader:'wrong shader'}),/placement_canopy_shader/);
 }finally{a.dispose();}
});

test('changing season updates shared existing uniform values without rebuilding materials, textures, positions or cache keys',()=>{
 const ctx=context(),map=new Map(Originals.kinds.map(k=>[k,imageTexture(k)])),a=Originals.create(THREE,{...ctx,loadedTextures:map}),s=a.createSprite('treeGrove',{width:2,position:{x:1,y:2,z:3}}),shader=shaderFor(s.material),material=s.material,texture=material.map,version=material.version,position=s.position.toArray(),counts=[ctx.textures.size,ctx.materials.size],uniform=shader.uniforms.originalLeafTint;
 try{const snapshots=[];for(const key of ['spring','summer','autumn','winter','summer']){assert.equal(a.setSeason(key),true);assert.equal(a.summary().treeSeason,key);assert.equal(shader.uniforms.originalLeafBlend.value,Originals.canopyProfiles[key].blend);assert.strictEqual(shader.uniforms.originalLeafTint,uniform);assert.equal(s.material,material);assert.equal(material.map,texture);assert.equal(material.version,version);assert.deepEqual(s.position.toArray(),position);assert.deepEqual([ctx.textures.size,ctx.materials.size],counts);snapshots.push(uniform.value.toArray());}assert.notDeepEqual(snapshots[0],snapshots[2]);const before=a.summary();assert.equal(a.setSeason('unknown'),false);assert.deepEqual(a.summary(),before);const detached=a.summary();detached.treeSeason='bad';assert.equal(a.summary().treeSeason,'summer');}
 finally{a.dispose();}
});

test('a selected season survives asynchronous original image loading and old consumers retain summer identity by default',async()=>{
 const ctx=context(),a=Originals.create(THREE,ctx),s=a.createSprite('treeApple',{width:2}),deferred=[];
 a.setSeason('winter');const shader=shaderFor(s.material),pending=a.preload({loadAsync(url){return new Promise(resolve=>deferred.push([url,resolve]));}});
 assert.equal(a.state,'loading');a.setSeason('autumn');const p=Originals.canopyProfiles.autumn;
 for(const [url,resolve] of deferred){const kind=Originals.kinds.find(k=>Originals.resolve(k).url===url);resolve(imageTexture(kind));}
 await pending;assert.equal(a.summary().treeSeason,'autumn');assert.equal(shader.uniforms.originalLeafBlend.value,p.blend);assert.equal(s.visible,true);assert.equal(s.material.map.image.sourceKind,'treeApple');assert.equal(a.textureFor('treeApple'),s.material.map);
 const old=Originals.create(THREE,context()),t=old.createSprite('tree',{width:2});assert.equal(old.summary().treeSeason,'summer');assert.equal(shaderFor(t.material).uniforms.originalLeafBlend.value,0);old.dispose();a.dispose();
});

test('normal Scene forwards initial and later seasons before preload, preserving saved world, tree transforms and night phase',async()=>{
 const world=Town.createWorld(),model=Scene.buildWorld(THREE,world,{},null,docFixture(),'autumn'),before=JSON.stringify(world),sprites=[];model.scene.traverse(o=>{if(o.isSprite&&treeKinds.includes(o.userData.originalArtKind))sprites.push(o);});
 const transforms=sprites.map(s=>[s.position.toArray(),s.scale.toArray(),s.center.toArray()]);
 try{assert.equal(model.originalArt.summary().treeSeason,'autumn');assert.equal(model.scene.userData.treeSeason,'autumn');model.setSkyPhase('clear-night');
 await model.loadOriginalArt({loadAsync(url){return Promise.resolve(imageTexture(Originals.kinds.find(k=>Originals.resolve(k).url===url)));}});
 for(const key of ['spring','summer','autumn','winter']){assert.equal(model.setSeason(key),true);assert.equal(model.originalArt.summary().treeSeason,key);assert.equal(model.scene.userData.treeSeason,key);assert.equal(model.scene.userData.skyPhase,'clear-night');assert.equal(JSON.stringify(world),before);assert.deepEqual(sprites.map(s=>[s.position.toArray(),s.scale.toArray(),s.center.toArray()]),transforms);}
 }finally{model.dispose();}
});

test('season changes create no extra owned resources and dispose every original texture/material exactly once',()=>{
 const ctx=context(),a=Originals.create(THREE,{...ctx,loadedTextures:new Map(Originals.kinds.map(k=>[k,imageTexture(k)]))});treeKinds.forEach(k=>a.createSprite(k,{width:2}));
 let tc=0,mc=0;ctx.textures.forEach(t=>t.addEventListener('dispose',()=>tc++));ctx.materials.forEach(m=>m.addEventListener('dispose',()=>mc++));const nt=ctx.textures.size,nm=ctx.materials.size;
 for(let n=0;n<3;n++)for(const key of ['spring','summer','autumn','winter'])a.setSeason(key);assert.equal(ctx.textures.size,nt);assert.equal(ctx.materials.size,nm);a.dispose();a.dispose();assert.equal(tc,nt);assert.equal(mc,nm);assert.equal(ctx.textures.size,0);assert.equal(ctx.materials.size,0);assert.equal(a.setSeason('spring'),false);
});

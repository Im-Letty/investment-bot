import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Originals from '../static/pet-town-placement-originals.js';

function context(extra={}) { return {textures:new Set(), materials:new Set(), ...extra}; }
function imageTexture(kind) {
  const spec=Originals.resolve(kind);
  return new THREE.Texture({width:spec.width,height:spec.height, originalPixels:kind});
}
function preparedMap() { return new Map(Originals.kinds.map(kind=>[kind,imageTexture(kind)])); }
function textureForUrl(url) {
  const entry=Object.entries(Originals.catalog).find(([,spec])=>spec.url===url);
  assert.ok(entry,'loader must use an exact catalog URL'); return imageTexture(entry[0]);
}
function webpSize(bytes) {
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
  assert.equal(bytes.toString('ascii',0,4),'RIFF'); assert.equal(bytes.toString('ascii',8,12),'WEBP');
  for(let offset=12;offset+8<=bytes.length;) {
    const type=bytes.toString('ascii',offset,offset+4), size=bytes.readUInt32LE(offset+4), start=offset+8;
    if(type==='VP8X')return [bytes.readUIntLE(start+4,3)+1,bytes.readUIntLE(start+7,3)+1];
    if(type==='VP8L') { assert.equal(bytes[start],0x2f); const bits=bytes.readUInt32LE(start+1); return [(bits&0x3fff)+1,((bits>>>14)&0x3fff)+1]; }
    if(type==='VP8 ') { assert.equal(bytes.toString('hex',start+3,start+6),'9d012a'); return [bytes.readUInt16LE(start+6)&0x3fff,bytes.readUInt16LE(start+8)&0x3fff]; }
    offset=start+size+(size%2);
  }
  throw Error('missing WebP image dimensions');
}

test('immutable catalog binds eleven actual source files while keeping prior originals and authored shop botanicals',async()=>{
  assert.equal(Originals.revision,'placement-originals1'); assert.equal(Originals.kinds.length,11); assert.equal(Originals.shopStyleRevision,'shop-style1'); assert.equal(Originals.treeRootsRevision,'soft-roots2');
  assert.ok(Object.isFrozen(Originals.catalog)); assert.ok(Object.isFrozen(Originals.kinds));
  for(const [kind,spec] of Object.entries(Originals.catalog)) {
    const bytes=await readFile(new URL('../'+spec.url.slice(1),import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),spec.sha256,kind+' source bytes');
    assert.deepEqual(webpSize(bytes),[spec.width,spec.height],kind+' source canvas');
    assert.ok(Object.isFrozen(spec)); assert.ok(Object.isFrozen(spec.alphaBounds));
    const [l,t,r,b]=spec.alphaBounds; assert.ok(l>=0&&t>=0&&l<r&&t<b&&r<=spec.width&&b<=spec.height);
    assert.equal(spec.alphaThreshold,8);
    assert.throws(()=>{spec.alphaBounds[3]=0;},TypeError);
  }
  assert.strictEqual(Originals.resolve('garden'),Originals.catalog.flowers);
  assert.strictEqual(Originals.resolve('playground'),Originals.catalog.fountain);
  assert.throws(()=>Originals.resolve('terrain'),/placement_originals_kind/);
  assert.throws(()=>Originals.resolve('__proto__'),/placement_originals_kind/);
});

test('browser UMD is DOM/storage independent and creates hidden contact sprites before loading',async()=>{
  const source=await readFile(new URL('../static/pet-town-placement-originals.js',import.meta.url),'utf8');
  const sandbox={}; vm.runInNewContext(source,sandbox);
  assert.equal(sandbox.PetTownPlacementOriginals.revision,Originals.revision);
  assert.throws(()=>Originals.create(THREE,{}),/placement_originals_context/);
  const ctx=context(),atlas=Originals.create(THREE,ctx);
  const sprite=atlas.createSprite('home',{width:3.2,position:{x:1,y:.025,z:-2}});
  assert.ok(sprite.isSprite); assert.equal(sprite.visible,false); assert.equal(atlas.state,'idle');
  assert.equal(sprite.userData.originalArt,true); assert.equal(sprite.userData.collisionIndependent,true);
  assert.equal(sprite.userData.artRepresentation,'original-2d-in-world-space');
  assert.deepEqual(sprite.position.toArray(),[1,.025,-2]); assert.equal(sprite.material.map,null);
  assert.equal(ctx.materials.size,1); assert.equal(ctx.textures.size,0);
  assert.throws(()=>atlas.createSprite('tree',{width:0}),/placement_originals_width/);
  assert.throws(()=>atlas.createSprite('tree',{width:NaN}),/placement_originals_width/);
  assert.throws(()=>atlas.createSprite('tree',{width:2,position:{x:0,y:Infinity,z:0}}),/placement_originals_position/);
  assert.throws(()=>atlas.createSprite('unknown',{width:2}),/placement_originals_kind/);
  atlas.dispose(); assert.equal(ctx.materials.size,0);
});

test('one complete strict preload reveals pending sprites, loads only exact originals once and shares resources',async()=>{
  const ctx=context(),atlas=Originals.create(THREE,ctx);
  const home1=atlas.createSprite('home',{width:3}),home2=atlas.createSprite('home',{width:2});
  const flower=atlas.createSprite('garden',{width:1.2}),flower2=atlas.createSprite('flowers',{width:.6});
  assert.strictEqual(home1.material,home2.material); assert.strictEqual(flower.material,flower2.material);
  const calls=[],resolvers=[];
  const loader={loadAsync(url){calls.push(url);return new Promise(resolve=>resolvers.push(()=>resolve(textureForUrl(url))));}};
  const first=atlas.preload(loader),second=atlas.preload(loader);
  assert.strictEqual(first,second); assert.equal(atlas.state,'loading');
  assert.deepEqual(new Set(calls),new Set(Object.values(Originals.catalog).map(spec=>spec.url)));
  assert.equal(calls.length,11); assert.equal(home1.visible,false);
  resolvers[0](); await Promise.resolve(); await Promise.resolve();
  assert.equal(atlas.ready,false); assert.equal(home1.visible,false); assert.equal(home1.material.map,null);
  resolvers.slice(1).forEach(resolve=>resolve()); assert.strictEqual(await first,atlas);
  assert.equal(atlas.ready,true); assert.equal(atlas.state,'ready'); assert.equal(ctx.textures.size,11); assert.equal(ctx.materials.size,2);
  for(const sprite of [home1,home2,flower,flower2])assert.equal(sprite.visible,true);
  assert.strictEqual(home1.material.map,atlas.textureFor('home')); assert.strictEqual(flower.material.map,atlas.textureFor('garden'));
  assert.strictEqual(await atlas.preload({loadAsync(){throw Error('must not load again');}}),atlas);
  assert.equal(calls.length,11); atlas.dispose();
});

test('original pixels use full-image SRGB white unlit materials unaffected by scene light, fog or tone mapping',()=>{
  const borrowed=preparedMap(); borrowed.get('home').colorSpace=THREE.LinearSRGBColorSpace;
  borrowed.get('home').offset.set(.2,.3); borrowed.get('home').repeat.set(.5,.6); borrowed.get('home').rotation=.8;
  const ctx=context({loadedTextures:borrowed}),atlas=Originals.create(THREE,ctx);
  for(const kind of Originals.kinds) {
    const sprite=atlas.createSprite(kind,{width:3}),material=sprite.material,texture=material.map;
    assert.ok(material.isSpriteMaterial); assert.equal(material.isMeshStandardMaterial,undefined);
    assert.equal(material.color.getHex(),0xffffff); assert.equal(material.opacity,1); assert.equal(material.transparent,true);
    assert.equal(material.fog,false); assert.equal(material.toneMapped,false); assert.equal(material.alphaTest,8/255);
    assert.equal(material.depthTest,true); assert.equal(material.depthWrite,true);
    assert.equal(sprite.castShadow,false); assert.equal(sprite.receiveShadow,false);
    assert.equal(texture.colorSpace,THREE.SRGBColorSpace); assert.equal(texture.premultiplyAlpha,false);
    assert.equal(texture.wrapS,THREE.ClampToEdgeWrapping); assert.equal(texture.wrapT,THREE.ClampToEdgeWrapping);
    assert.deepEqual(texture.offset.toArray(),[0,0]); assert.deepEqual(texture.repeat.toArray(),[1,1]); assert.equal(texture.rotation,0);
    assert.notStrictEqual(texture,borrowed.get(kind)); assert.strictEqual(texture.image,borrowed.get(kind).image,'same decoded source pixels');
    assert.equal(texture.userData.sourceSHA256,Originals.catalog[kind].sha256);
  }
  assert.equal(borrowed.get('home').colorSpace,THREE.LinearSRGBColorSpace);
  assert.deepEqual(borrowed.get('home').offset.toArray(),[.2,.3]); assert.deepEqual(borrowed.get('home').repeat.toArray(),[.5,.6]); assert.equal(borrowed.get('home').rotation,.8);
  atlas.dispose();
});

test('actual Three Sprite raycasting meets alpha-bottom contact and preserves source aspect at several camera angles',()=>{
  const atlas=Originals.create(THREE,context({loadedTextures:preparedMap()}));
  for(const kind of Originals.kinds) {
    const spec=Originals.resolve(kind),sprite=atlas.createSprite(kind,{width:2.7,position:{x:.4,y:.025,z:-.3}});
    assert.ok(Math.abs(sprite.scale.x/sprite.scale.y-spec.width/spec.height)<1e-12);
    assert.equal(sprite.center.x,spec.groundAnchor?spec.groundAnchor[0]:(spec.alphaBounds[0]+spec.alphaBounds[2])/(2*spec.width));
    assert.equal(sprite.center.y,spec.groundAnchor?1-spec.groundAnchor[1]:1-spec.alphaBounds[3]/spec.height);
    for(const [x,y,z] of [[0,3,7],[-5,4,3],[4,2,-5]]) {
      const camera=new THREE.PerspectiveCamera(45,1,.01,80); camera.position.set(x,y,z).add(sprite.position); camera.lookAt(sprite.position); camera.updateMatrixWorld(true);
      const target=sprite.position.clone().project(camera),ray=new THREE.Raycaster();
      sprite.updateMatrixWorld(true); ray.setFromCamera(new THREE.Vector2(target.x,target.y),camera);
      const hits=ray.intersectObject(sprite,false); assert.equal(hits.length,1,kind+' contact intersects actual sprite');
      assert.ok(Math.abs(hits[0].uv.x-sprite.center.x)<1e-10,kind+' alpha midpoint at contact');
      assert.ok(Math.abs(hits[0].uv.y-sprite.center.y)<1e-10,kind+' alpha bottom at contact');
      assert.ok(hits[0].point.distanceTo(sprite.position)<1e-10);
    }
  }
  atlas.dispose();
});

test('invalid or missing preloaded images fail before ownership, and callback loader also requires valid dimensions',async()=>{
  for(const change of [map=>map.delete('tree'),map=>map.set('tree',null),map=>map.set('tree',new THREE.Texture({width:512,height:512}))]) {
    const inputs=preparedMap(),ctx=context(); change(inputs);
    assert.throws(()=>Originals.create(THREE,{...ctx,loadedTextures:inputs}),/placement_originals_image:tree/);
    assert.equal(ctx.textures.size,0); assert.equal(ctx.materials.size,0);
  }
  const ctx=context(),atlas=Originals.create(THREE,ctx),pending=atlas.createSprite('tree',{width:2});
  const received=[];
  const loader={load(url,onLoad){const texture=textureForUrl(url);received.push(texture);if(url===Originals.catalog.tree.url)texture.image={width:1,height:1};onLoad(texture);return texture;}};
  await assert.rejects(atlas.preload(loader),/placement_originals_image:tree/);
  assert.equal(atlas.state,'failed'); assert.equal(atlas.ready,false); assert.equal(pending.visible,false);
  assert.equal(ctx.textures.size,0); assert.equal(pending.material.map,null); atlas.dispose();
});

test('a rejected load stays failed without substitute, retry, leaked textures or falsely ready sprites',async()=>{
  const ctx=context(),atlas=Originals.create(THREE,ctx),sprite=atlas.createSprite('fountain',{width:2});
  let calls=0,disposed=0;
  const loader={loadAsync(url){calls++;if(url===Originals.catalog.fountain.url)return Promise.reject(Error('private raw detail must not escape'));
    const texture=textureForUrl(url);texture.addEventListener('dispose',()=>disposed++);return Promise.resolve(texture);}};
  const load=atlas.preload(loader); await assert.rejects(load,/^Error: placement_originals_load_failed:fountain$/);
  await Promise.resolve(); assert.equal(atlas.state,'failed'); assert.equal(atlas.error,'placement_originals_load_failed:fountain');
  assert.equal(sprite.visible,false); assert.equal(sprite.material.map,null); assert.equal(ctx.textures.size,0); assert.equal(disposed,10);
  assert.strictEqual(atlas.preload(loader),load); assert.equal(calls,11); atlas.dispose();
});

test('owner disposal is idempotent, releases each shared local resource once and leaves borrowed textures intact',()=>{
  const input=preparedMap();let borrowedDisposals=0;input.forEach(texture=>texture.addEventListener('dispose',()=>borrowedDisposals++));
  const ctx=context({loadedTextures:input}),atlas=Originals.create(THREE,ctx);
  const sprites=[atlas.createSprite('home',{width:3}),atlas.createSprite('home',{width:1}),atlas.createSprite('garden',{width:1}),atlas.createSprite('flowers',{width:2})];
  let textureDisposals=0,materialDisposals=0;
  ctx.textures.forEach(texture=>texture.addEventListener('dispose',()=>textureDisposals++));ctx.materials.forEach(material=>material.addEventListener('dispose',()=>materialDisposals++));
  assert.equal(ctx.materials.size,2); assert.equal(ctx.textures.size,11);
  atlas.dispose(); atlas.dispose(); assert.equal(atlas.state,'disposed'); assert.equal(atlas.ready,false);
  assert.equal(textureDisposals,11); assert.equal(materialDisposals,2); assert.equal(borrowedDisposals,0);
  assert.equal(ctx.textures.size,0); assert.equal(ctx.materials.size,0); sprites.forEach(sprite=>assert.equal(sprite.visible,false));
  assert.throws(()=>atlas.createSprite('home',{width:2}),/placement_originals_disposed/);
});

test('disposal while loading rejects promptly and safely releases later arrivals without revival',async()=>{
  const ctx=context(),atlas=Originals.create(THREE,ctx),sprite=atlas.createSprite('home',{width:2}),finish=[];
  let disposed=0;
  const load=atlas.preload({loadAsync(url){return new Promise(resolve=>finish.push(()=>{const texture=textureForUrl(url);texture.addEventListener('dispose',()=>disposed++);resolve(texture);}));}});
  const rejection=assert.rejects(load,/placement_originals_disposed/); atlas.dispose();await rejection;
  assert.equal(sprite.visible,false); assert.equal(ctx.materials.size,0);
  finish.forEach(resolve=>resolve());await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(disposed,11); assert.equal(ctx.textures.size,0); assert.equal(atlas.state,'disposed');
  await assert.rejects(atlas.preload({}),/placement_originals_disposed/);
});

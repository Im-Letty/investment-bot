import {assertDerivedWorld} from './helpers/pet-town-derived-world.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Originals from '../static/pet-town-placement-originals.js';
import Trees from '../static/pet-town-tree-variety.js';
import Scene from '../static/pet-town-scene.js';
import Town from '../static/pet-town-walk.js';

const retained={
 tree:{sha256:'f2f13fd18a0b27cec312c10b2f9dc55694d98072f06b8c52c5a56b25210e03a1',width:512,height:480,bounds:[39,42,475,448]},
 treeApple:{sha256:'ce7ef7adda439841a3fc36de04d5250eb01249ce653337f19b6d9520b028c45b',width:1254,height:1254,bounds:[29,42,1236,1183],anchor:[660/1254,1182/1254]},
 treeBirch:{sha256:'ed3a42025eab7a46069550b2b727bc08777053c67a76e2cd5d2b7008d2c51fb0',width:1254,height:1254,bounds:[212,14,1131,1236],anchor:[705/1254,1235/1254]}
};
const bytesFor=spec=>readFile(new URL('../'+spec.url.slice(1),import.meta.url));
const textureFor=kind=>{const s=Originals.resolve(kind);return new THREE.Texture({width:s.width,height:s.height,originalPixels:kind});};
function prepared(){return new Map(Originals.kinds.map(kind=>[kind,textureFor(kind)]));}

test('shop family readiness adds a grove while retaining all three original tree pixels and metadata',async()=>{
 assert.equal(Originals.shopStyleRevision,'shop-style1');assert.equal(Trees.shopStyleRevision,'shop-style1');
 assert.equal(Trees.primaryKind,'treeGrove');
 for(const [kind,old] of Object.entries(retained)){
  const spec=Originals.resolve(kind),bytes=await bytesFor(spec);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),old.sha256);
  assert.equal(spec.sha256,old.sha256);assert.equal(spec.width,old.width);assert.equal(spec.height,old.height);
  assert.deepEqual(spec.alphaBounds,old.bounds);assert.deepEqual(spec.groundAnchor,old.anchor);
 }
 const plan=Trees.plan(),counts=plan.reduce((out,k)=>(out[k]=(out[k]||0)+1,out),{});
 assert.equal(plan[0],'treeGrove');assert.deepEqual(counts,{treeGrove:12,tree:5,treeApple:5,treeBirch:5});
});

test('rounded-root grove binds its new raw PNG while preserving v1 and the authored trunk-centred image baseline',async()=>{
 const originalV1=await readFile(new URL('../static/pet-village-art/tree-shop-grove-v1.png',import.meta.url));
 assert.equal(createHash('sha256').update(originalV1).digest('hex'),'fbd36580f164bb32409de1678d4eddc7f302b197e7d5b81a60f09643a75721b0');
 assert.equal(Originals.treeRootsRevision,'soft-roots2');
 const spec=Originals.resolve('treeGrove'),bytes=await bytesFor(spec);
 assert.equal(spec.url,'/static/pet-village-art/tree-shop-grove-soft-roots-v2.png');
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'1501f8fda37d378db93fd9e960cd3ba702a71514b26c3b7c62fa8ec2773cbf3b');
 assert.equal(spec.sha256,'1501f8fda37d378db93fd9e960cd3ba702a71514b26c3b7c62fa8ec2773cbf3b');
 assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.equal(bytes[24],8);assert.equal(bytes[25],6,'actual PNG has an alpha channel');
 assert.deepEqual([bytes.readUInt32BE(16),bytes.readUInt32BE(20)],[1254,1254]);
 assert.deepEqual(spec.alphaBounds,[53,41,1221,1203]);
 assert.deepEqual(spec.groundAnchor,[610/1254,1202/1254]);
 assert.equal(spec.groundAnchor[0],610/1254,'horizontal trunk anchor is retained; the authored baseline is image-space only');
 assert.ok(Object.isFrozen(spec.groundAnchor));
});

test('shop tulip reuses the exact existing ceramic-pot original and measured image-space baseline',async()=>{
 const spec=Originals.resolve('shopTulip'),bytes=await bytesFor(spec);
 assert.equal(spec.url,'/static/pet-items-v1/flower.webp');
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'f3303351c1e33b84905225edff5dcb361cf049542ad4289b324c4ff588551ab6');
 assert.equal(spec.sha256,'f3303351c1e33b84905225edff5dcb361cf049542ad4289b324c4ff588551ab6');
 assert.deepEqual([spec.width,spec.height],[384,384]);assert.deepEqual(spec.alphaBounds,[70,14,312,369]);
 // The observed alpha>=192 pot outline ends at y367,x185..206. This is
 // the next image-space baseline, not an anatomical/physical calibration.
 assert.deepEqual(spec.groundAnchor,[195.5/384,368/384]);
 assert.strictEqual(Originals.resolve('garden'),Originals.resolve('flowers'),'the old meadow bed alias is unchanged');
});

test('six synthetic tulip placements share unchanged pixels and one material with scene-owned disposal',()=>{
 const borrowed=prepared(),ctx={textures:new Set(),materials:new Set(),loadedTextures:borrowed},atlas=Originals.create(THREE,ctx);
 const sprites=Array.from({length:6},(_,i)=>atlas.createSprite('shopTulip',{width:.40,position:{x:i*2,y:.025,z:i%2}}));
 const mat=sprites[0].material,texture=mat.map;let matDispose=0,textureDispose=0,borrowedDispose=0;
 mat.addEventListener('dispose',()=>matDispose++);texture.addEventListener('dispose',()=>textureDispose++);
 borrowed.get('shopTulip').addEventListener('dispose',()=>borrowedDispose++);
 for(const [i,sprite] of sprites.entries()){
  assert.strictEqual(sprite.material,mat);assert.strictEqual(sprite.material.map,texture);
  assert.strictEqual(texture.image,borrowed.get('shopTulip').image);
  assert.deepEqual(sprite.position.toArray(),[i*2,.025,i%2]);assert.equal(sprite.scale.x,.40);assert.ok(Math.abs(sprite.scale.y-.40)<1e-14);assert.equal(sprite.scale.z,1);
  assert.equal(sprite.center.x,195.5/384);assert.equal(sprite.center.y,1-368/384);
  assert.equal(sprite.userData.collisionIndependent,true);assert.equal(sprite.userData.artRepresentation,'original-2d-in-world-space');
  assert.equal(mat.color.getHex(),0xffffff);assert.equal(mat.toneMapped,false);assert.equal(mat.fog,false);assert.equal(sprite.castShadow,false);
  assert.deepEqual(texture.repeat.toArray(),[1,1]);assert.deepEqual(texture.offset.toArray(),[0,0]);assert.equal(texture.rotation,0);
 }
 assert.equal(ctx.materials.size,1);atlas.dispose();atlas.dispose();
 assert.equal(matDispose,1);assert.equal(textureDispose,1);assert.equal(borrowedDispose,0);
 assert.equal(ctx.materials.size,0);assert.equal(ctx.textures.size,0);
});

for(const missing of ['treeGrove','shopTulip'])test('missing '+missing+' keeps the whole original set hidden with no substitute or retry',async()=>{
 const ctx={textures:new Set(),materials:new Set()},atlas=Originals.create(THREE,ctx);
 const tree=atlas.createSprite('treeGrove',{width:3.25}),tulip=atlas.createSprite('shopTulip',{width:.40}),disposals=[];
 let calls=0;
 const loader={loadAsync(url){calls++;const key=Originals.kinds.find(k=>Originals.resolve(k).url===url);assert.ok(key);
  if(key===missing)return Promise.reject(Error('synthetic unavailable'));
  const texture=textureFor(key),row={texture,count:0};texture.addEventListener('dispose',()=>row.count++);disposals.push(row);return Promise.resolve(texture);
 }};
 const pending=atlas.preload(loader);await assert.rejects(pending,new RegExp('^Error: placement_originals_load_failed:'+missing+'$'));
 await Promise.resolve();assert.equal(calls,11);assert.equal(atlas.state,'failed');
 assert.equal(tree.visible,false);assert.equal(tulip.visible,false);assert.equal(tree.material.map,null);assert.equal(tulip.material.map,null);
 assert.strictEqual(atlas.preload(loader),pending);atlas.dispose();
 assert.equal(ctx.textures.size,0);assert.equal(ctx.materials.size,0);assert.equal(disposals.length,10);for(const row of disposals)assert.equal(row.count,1);
});

test('the actual six entrance tulips keep world height, pot colliders, door access and the unchanged saved layout',async()=>{
 const world=Town.createWorld(),before=JSON.stringify(world),model=Scene.buildWorld(THREE,world,{});
 const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,a+' != '+b);
 try{
  // Synthetic decoded-image fixtures exercise source ownership/projection; the
  // separate byte-bound source tests and parent native review inspect real art.
  await model.originalArt.preload({loadAsync(url){const kind=Originals.kinds.find(k=>Originals.resolve(k).url===url);assert.ok(kind);return Promise.resolve(textureFor(kind));}});
  model.scene.updateMatrixWorld(true);const all=[];
  for(const id of ['home','cafe','shop']){
   const group=model.placeGroups.find(g=>g.userData.placeId===id),place=world.places.find(p=>p.id===id);
   const pots=[];group.traverse(o=>{if(o.name==='shop-original-potted-tulip')pots.push(o);});pots.sort((a,b)=>a.position.x-b.position.x);
   assert.equal(pots.length,2);const shapes=Town.collisionShapes(place).filter(s=>s.kind==='ellipse').sort((a,b)=>a.x-b.x);
   assert.equal(shapes.length,2);
   for(const [i,pot] of pots.entries()){
    const pictures=pot.children.filter(o=>o.isSprite);assert.equal(pictures.length,1);const picture=pictures[0],position=picture.getWorldPosition(new THREE.Vector3()),scale=picture.getWorldScale(new THREE.Vector3()),expected=Scene.groundPoint(world,shapes[i]);
    near(position.x,expected.x);near(position.z,expected.z);near(position.y,.025);
    near(scale.x,.40);near(scale.y,.40);assert.equal(picture.userData.originalArtKind,'shopTulip');
    assert.equal(picture.userData.shopStylePot,true);assert.equal(picture.userData.groundCollisionPreserved,true);assert.equal(picture.visible,true);
    assert.equal(picture.material.color.getHex(),0xffffff);assert.equal(picture.material.toneMapped,false);
    assert.equal(Town.isWalkable(world,shapes[i].x,shapes[i].y),false,'existing pot blocker is retained');
    all.push(picture);
   }
   const contact=Town.doorContact(place);assert.equal(Town.isWalkable(world,contact.x,contact.y),true);
   assert.equal(Town.isWalkable(world,place.entrance.x,place.entrance.y),true);
  }
  assert.equal(all.length,6);assert.equal(new Set(all.map(p=>p.material)).size,1);
  const poses=all.map(p=>p.matrixWorld.toArray());for(const season of ['winter','spring','summer','autumn']){
   model.setSeason(season);model.animate(1900,false);model.animate(8000,true);
   assert.deepEqual(all.map(p=>p.matrixWorld.toArray()),poses);
  }
  assertDerivedWorld(world,before,model);assert.equal(model.people.length,0);
 }finally{model.dispose();}
});

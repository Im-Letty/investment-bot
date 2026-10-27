
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Town from '../static/pet-town-walk.js';
import Scene from '../static/pet-town-scene.js';
import Originals from '../static/pet-town-placement-originals.js';

const world=Town.createWorld(),worldBefore=JSON.stringify(world);
const model=Scene.buildWorld(THREE,world,{},world.spawn,null,'autumn');
model.scene.updateMatrixWorld(true);
const building=id=>model.placeGroups.find(g=>g.userData.placeId===id);
const rooms=id=>model.windowRooms.filter(r=>{for(let p=r.group;p;p=p.parent)if(p===building(id))return true;return false;});
function rayLocal(mesh,parent,xyz,direction=[0,0,-1]) {
  const origin=new THREE.Vector3(...xyz).applyMatrix4(parent.matrixWorld);
  const ray=new THREE.Raycaster(origin,new THREE.Vector3(...direction).transformDirection(parent.matrixWorld));
  return ray.intersectObject(mesh,false);
}
const facts={revision:model.solidLifeRevision,tests:[],scope:'runtime building Meshes and bounded decorative window animation; not character360, physical lighting or real save verification'};

test('completed buildings and fountain use visible real Mesh volume while nature originals stay separate',()=>{
  assert.equal(model.solidLifeRevision,'solid-living-buildings1');
  assert.equal(model.scene.userData.buildingRepresentation,'closed-volume-with-recessed-window-rooms');
  for(const id of ['home','cafe','shop','playground']){
    const g=building(id),sprites=[];let visibleMeshes=0;
    g.traverse(m=>{if(m.isSprite)sprites.push(m);if(m.isMesh&&m.visible)visibleMeshes++;});
    assert.ok(sprites.every(o=>o.userData.shopStylePot&&o.userData.originalArtKind==='shopTulip'),id+' structure is solid; only its two fixed potted-flower accents are original cards');
    assert.equal(sprites.length,id==='playground'?0:2);
    assert.ok(visibleMeshes>=5,id+' has actual rendered volume');
    assert.ok(model.pickables.some(m=>m.userData.placeId===id&&!m.userData.nonSolidWater));
  }
  for(const id of ['tree','flowers']) {
    const sprites=[];building(id).traverse(m=>{if(m.isSprite)sprites.push(m);});
    assert.ok(sprites.some(m=>m.userData.originalArt),id+' original display kept');
  }
  assert.ok(model.waterLife&&model.waterLife.ringCount===3);
  facts.tests.push('solid representation and retained nature originals');
});

test('body width/depth comes from the same world-space navigation dimensions',()=>{
  for(const id of ['home','cafe','shop']){
    const place=world.places.find(p=>p.id===id),g=building(id),dimensions=Town.solidDimensions(place);
    assert.equal(g.userData.solidDimensions.width,dimensions.width);
    assert.equal(g.userData.solidDimensions.depth,dimensions.depth);
    assert.equal(g.userData.buildingTheme,id);
    assert.equal(g.scale.y,.9);
    const walls=[];g.traverse(m=>{if(m.userData.solidWall)walls.push(m);});
    assert.equal(walls.length,4);
    for(const wall of walls){assert.ok((wall.geometry.index?wall.geometry.index.count:wall.geometry.attributes.position.count)>0);assert.ok(wall.geometry.boundingBox);}
  }
  assert.equal(JSON.stringify(world),worldBefore);
  assert.deepEqual(model.people,[]);
  facts.tests.push('shared dimensions and no world/NPC mutation');
});

test('cafe sage and market coral thick tiles retain different original-art color families',()=>{
  const colorFor=id=>{const tile=building(id).getObjectByName('overlapping-round-roof-tile');assert.ok(tile);return tile.material.color;};
  const home=colorFor('home'),cafe=colorFor('cafe'),shop=colorFor('shop');
  assert.ok(home.b>home.r&&home.r>home.g,'home lavender');
  assert.ok(cafe.g>cafe.r&&cafe.g>cafe.b,'cafe sage');
  assert.ok(shop.r>shop.g&&shop.g>shop.b,'market coral');
  assert.ok(building('cafe').getObjectByName('cafe-cup-sign'));
  assert.ok(building('shop').getObjectByName('market-basket-sign'));
  for(const id of ['cafe','shop']){
    const awning=building(id).getObjectByName('commercial-side-striped-awning');assert.ok(awning);
    assert.ok(awning.children.filter(c=>c.name==='rounded-awning-scallop').length===7);
    assert.ok(rooms(id).some(r=>r.group.getObjectByName(id==='cafe'?'cafe-display-cake':'market-display-goods')));
  }
  facts.tests.push('art-specific roof, awning and stocked display');
});

test('open economy facilities inherit their normalized cafe or shop architecture',()=>{
  const world=Town.createWorld();
  world.places.push({...world.places.find(p=>p.id==='cafe'),id:'economy-cafe',shopId:'cafe'});
  world.places.push({...world.places.find(p=>p.id==='shop'),id:'economy-tea',shopId:'tea'});
  const economy=Scene.buildWorld(THREE,world,{},world.spawn,null,'autumn');
  for(const [id,theme,badge] of [['economy-cafe','cafe','cafe-cup-sign'],['economy-tea','shop','market-basket-sign']]){
    const g=economy.placeGroups.find(p=>p.userData.placeId===id);
    assert.equal(g.userData.buildingTheme,theme);assert.ok(g.getObjectByName(badge));assert.ok(g.getObjectByName('commercial-side-striped-awning'));
    assert.ok(g.getObjectByName(theme==='cafe'?'cafe-display-cake':'market-display-goods'));
  }
  economy.dispose();facts.tests.push('normalized open economy building themes');
});

test('closed wall panels have true apertures with separately recessed rooms on side and rear',()=>{
  for(const id of ['home','cafe','shop']){
    const g=building(id),dimensions=g.userData.solidDimensions,front=g.getObjectByName('cottage-short-cream-wall');
    assert.equal(rayLocal(front,g,[0,.6,dimensions.depth/2+1]).length,0,'door opening in actual wall');
    assert.ok(rayLocal(front,g,[-dimensions.width*.40,.7,dimensions.depth/2+1]).length>0,'solid front beside door');
    const back=g.getObjectByName('solid-building-back-wall');
    assert.equal(rayLocal(back,g,[0,.85,-dimensions.depth/2-1],[0,0,1]).length,0,'rear window aperture');
    assert.ok(rooms(id).length>=4);
    for(const r of rooms(id)){
      const room=r.group,pane=room.getObjectByName('living-window-glass'),backwall=room.getObjectByName('window-room-warm-backwall');
      assert.ok(pane&&backwall&&pane!==backwall);
      assert.ok(backwall.position.z<-.18&&pane.position.z>0,'real interior depth');
      assert.equal(room.userData.decorativeInteriorOnly,true);
      assert.ok(pane.material.transparent&&pane.material.opacity<.5&&!pane.material.depthWrite);
    }
  }
  facts.tests.push('wall openings and actual recessed window rooms');
});

test('only actual marked front door Meshes acquire door intent',()=>{
  for(const id of ['home','cafe','shop']){
    const g=building(id),door=g.getObjectByName('cottage-arched-door-panel'),wall=g.getObjectByName('solid-building-back-wall');
    assert.ok(door&&door.userData.door);
    assert.equal(model.originalDoorHit({object:door}),true);
    assert.equal(model.originalDoorHit({object:wall}),false);
    assert.equal(model.originalDoorHit({object:rooms(id)[0].group.getObjectByName('living-window-glass')}),false);
  }
  facts.tests.push('Mesh-only front doorway intent');
});

test('window animation changes owned materials/curtains without changing global lights or solid walls',()=>{
  const room=model.windowRooms[1],wall=building('home').getObjectByName('cottage-short-cream-wall');
  const wallBefore=wall.matrixWorld.toArray(),lights=[];
  model.scene.traverse(m=>{if(m.isLight)lights.push([m.uuid,m.intensity,m.color.getHex()]);});
  model.animate(0,false);
  const initial={curtain:room.curtains[0].rotation.z,lamp:room.lamp.rotation.z,glow:room.glowMaterial.emissiveIntensity};
  model.animate(1700,false);
  assert.notEqual(room.curtains[0].rotation.z,initial.curtain);
  assert.notEqual(room.lamp.rotation.z,initial.lamp);
  assert.notEqual(room.glowMaterial.emissiveIntensity,initial.glow);
  assert.deepEqual(wall.matrixWorld.toArray(),wallBefore);
  const after=[];model.scene.traverse(m=>{if(m.isLight)after.push([m.uuid,m.intensity,m.color.getHex()]);});
  assert.deepEqual(after,lights);
  assert.ok(model.windowLifeMaterials.every(m=>m.userData.windowLifeOwned));
  assert.equal(new Set(model.windowRooms.map(r=>r.glassMaterial)).size,model.windowRooms.length);
  facts.tests.push('local owned light/curtain motion with fixed structural world');
});

test('moving windows and water bypass static batches and never become camera occluders or water pickables',()=>{
  const originals=new Set(model.batches.flatMap(b=>b.rows));
  for(const r of model.windowRooms) {
    for(const pivot of r.curtains)pivot.traverse(m=>{if(m.isMesh){assert.equal(m.userData.noStaticBatch,true);assert.equal(originals.has(m),false);assert.equal(m.castShadow,false);assert.equal(model.occluders.includes(m),false);}});
    r.lamp.traverse(m=>{if(m.isMesh){assert.equal(m.userData.noStaticBatch,true);assert.equal(originals.has(m),false);}});
  }
  building('playground').traverse(m=>{if(m.userData.nonSolidWater){assert.equal(model.occluders.includes(m),false);assert.equal(model.pickables.includes(m),false);assert.equal(m.castShadow,false);}});
  facts.tests.push('dynamic batching and camera-water exclusions');
});

test('reduced-motion window pose and warm values are exactly stable at different times',()=>{
  model.animate(0,true);
  const snapshot=()=>model.windowRooms.map(r=>[r.curtains.map(p=>p.matrixWorld.toArray()),r.lamp.matrixWorld.toArray(),r.backMaterial.emissiveIntensity,r.glassMaterial.emissiveIntensity,r.glowMaterial.emissiveIntensity]);
  const first=snapshot();model.animate(60000,true);assert.deepEqual(snapshot(),first);
  assert.ok(model.windowRooms.every(r=>r.glowMaterial.emissiveIntensity>0));
  assert.equal(JSON.stringify(world),worldBefore);
  facts.tests.push('exact reduced-motion stability');
});

test('window-owned resources are registered and disposed exactly once with the model',()=>{
  let disposed=0;for(const material of model.windowLifeMaterials){assert.ok(model.materials.has(material));material.addEventListener('dispose',()=>disposed++);}
  const count=model.windowLifeMaterials.length;model.dispose();model.dispose();
  assert.equal(disposed,count);
  facts.windowRooms=model.windowRooms.length;facts.windowOwnedMaterials=count;facts.tests.push('owned resource disposal once');
});

test('original seven bitmap files remain byte-exact',async()=>{
  for(const spec of Object.values(Originals.catalog)) {
    const bytes=await readFile(new URL('../'+spec.url.slice(1),import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),spec.sha256);
  }
  facts.tests.push('original SHA preservation');
});

export {facts};

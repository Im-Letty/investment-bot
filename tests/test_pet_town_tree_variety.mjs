import {assertDerivedWorld} from './helpers/pet-town-derived-world.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Trees from '../static/pet-town-tree-variety.js';
import Scene from '../static/pet-town-scene.js';
import Town from '../static/pet-town-walk.js';
import Originals from '../static/pet-town-placement-originals.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-11,a+' != '+b);
function treePictures(model) {
  const rows=[];
  model.scene.traverse(o=>{if(o.isSprite&&Number.isInteger(o.userData.treeVarietyIndex))rows.push(o);});
  return rows.sort((a,b)=>a.userData.treeVarietyIndex-b.userData.treeVarietyIndex);
}
// These are synthetic decoded-image fixtures for resource/placement tests.
// The catalog's separate byte/SHA tests and native review validate real pixels.
function documentFixture() {
  return {createElement(){
    const canvas={width:0,height:0},gradient=()=>({addColorStop(){}});
    const context={fillRect(){},clearRect(){},beginPath(){},ellipse(){},moveTo(){},lineTo(){},fill(){},stroke(){},fillText(){},
      createRadialGradient:gradient,createLinearGradient:gradient,drawImage(){},putImageData(){},
      createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)})};
    canvas.getContext=()=>context;return canvas;
  }};
}
function fixture() {
  const world=Town.createWorld(),before=JSON.stringify(world),loads=[],textures=[];
  const model=Scene.buildWorld(THREE,world,{},null,documentFixture());
  const loader={loadAsync(url){
    loads.push(url);const entry=Object.entries(Originals.catalog).find(([,spec])=>spec.url===url);
    assert.ok(entry,'only a registered real source URL is requested');
    const spec=entry[1],texture=new THREE.Texture({width:spec.width,height:spec.height,complete:true});
    textures.push(texture);return Promise.resolve(texture);
  }};
  return {model,world,before,loads,textures,loader};
}

test('UMD selection is stable without ambient randomness, clocks, images or browser APIs',()=>{
  const guardedMath=Object.create(Math);guardedMath.random=()=>{throw Error('ambient random');};
  const sandbox={Math:guardedMath,Date:class{constructor(){throw Error('clock');}},fetch(){throw Error('network');}};
  vm.runInNewContext(readFileSync(new URL('../static/pet-town-tree-variety.js',import.meta.url),'utf8'),sandbox);
  assert.equal(sandbox.PetTownTreeVariety.revision,'tree-variety1');assert.equal(sandbox.PetTownTreeVariety.shopStyleRevision,'shop-style1');
  assert.deepEqual(Array.from(sandbox.PetTownTreeVariety.plan()),Trees.plan());
  assert.deepEqual(Trees.plan({seed:42}),Trees.plan({seed:42}));
  assert.notDeepEqual(Trees.plan({seed:42}),Trees.plan({seed:43}));
});

test('every bounded weighted plan keeps the primary grove and retains prior species when size permits',()=>{
  assert.ok(Object.isFrozen(Trees)&&Object.isFrozen(Trees.kinds));
  for(let count=1;count<=64;count++){
    const input=Object.freeze({count,seed:'stable-border'}),rows=Trees.plan(input);
    assert.ok(Object.isFrozen(rows));assert.equal(rows.length,count);assert.equal(rows[0],'treeGrove');
    const counts=Trees.kinds.map(kind=>rows.filter(row=>row===kind).length);
    assert.ok(counts.every(n=>n>=0));assert.equal(counts.reduce((a,b)=>a+b,0),count);
    assert.ok(counts[3]>=Math.max(...counts.slice(0,3)),'the new grove is primary');
    if(count>=4)assert.deepEqual(new Set(rows),new Set(['tree','treeApple','treeBirch','treeGrove']));
    assert.deepEqual(input,{count,seed:'stable-border'});
  }
  assert.throws(()=>{Trees.plan()[0]='treeBirch';},TypeError);
});

test('the actual 27-site mix is nonperiodic with12grove and5of each saved original',()=>{
  const rows=Trees.plan(),border=rows.slice(1);
  assert.equal(rows.length,27);
  assert.deepEqual(Trees.counts27,{treeGrove:12,tree:5,treeApple:5,treeBirch:5});
  for(const [kind,n] of Object.entries(Trees.counts27))assert.equal(rows.filter(row=>row===kind).length,n);
  for(let period=1;period<=13;period++)assert.equal(border.slice(period).every((kind,i)=>kind===border[i]),false,'repeating border period '+period);
});

test('invalid count/seed inputs fail explicitly before constructing a plan',()=>{
  for(const options of [null,[],2,'27'])assert.throws(()=>Trees.plan(options),/tree_variety_options/);
  for(const count of [null,0,-1,1.5,65,Infinity,NaN,'27'])assert.throws(()=>Trees.plan({count}),/tree_variety_count/);
  for(const seed of [null,{},'',Array(130).join('x'),-1,.5,0x100000000,NaN])assert.throws(()=>Trees.plan({seed}),/tree_variety_seed/);
  assert.equal(Trees.plan({seed:0,count:1})[0],'treeGrove');
});

test('actual Three tree cards keep 26 border centers and the coherent derived saved tree, widths, heights and originals',async()=>{
  const f=fixture();try{
    const rows=treePictures(f.model);assert.equal(rows.length,27);
    assert.ok(rows.every(o=>!o.visible));await f.model.loadOriginalArt(f.loader);f.model.scene.updateMatrixWorld(true);
    assert.equal(f.model.treeVarietyRevision,'tree-variety1');assert.deepEqual(f.model.treeVarietyKinds,Trees.plan());
    const saved=f.world.places.find(p=>p.id==='tree'),ground=Scene.groundPoint(f.world,saved.footprint);
    for(const [index,picture] of rows.entries()){
      const kind=Trees.plan()[index],spec=Originals.resolve(kind),point=picture.getWorldPosition(new THREE.Vector3());
      const border=index-1,scale=index===0?1.08:.75+(border*7%9)*.055;
      const ex=border<13?-f.world.width/200-.45:-f.world.width/200+(border-13)*1.55;
      const ez=border<13?-f.world.height/200+border*1.55:-f.world.height/200-.45;
      near(point.x,index===0?ground.x:ex+Math.sin(border*2.7)*.4);
      near(point.z,index===0?ground.z:ez+Math.cos(border*1.7)*.4);near(point.y,.025);
      near(picture.scale.x,3.25*scale);near(picture.scale.y,picture.scale.x*spec.height/spec.width);
      const anchor=spec.groundAnchor||[(spec.alphaBounds[0]+spec.alphaBounds[2])/(2*spec.width),spec.alphaBounds[3]/spec.height];
      near(picture.center.x,anchor[0]);near(picture.center.y,1-anchor[1]);
      assert.equal(picture.userData.originalArtKind,kind);assert.equal(picture.userData.sourceSHA256,spec.sha256);
      assert.equal(picture.userData.sourceUrl,spec.url);assert.equal(picture.userData.artRepresentation,'original-2d-in-world-space');
      assert.equal(picture.userData.collisionIndependent,true);assert.equal(picture.material.rotation,0);assert.equal(picture.visible,true);
      assert.equal(picture.material.color.getHex(),0xffffff);assert.equal(picture.material.toneMapped,false);
      assert.ok(picture.scale.x>0&&picture.scale.y>0,'no mirror or negative scale');
    }
    assert.equal(rows[0].userData.originalArtKind,'treeGrove');assertDerivedWorld(f.world,f.before,f.model);
  }finally{f.model.dispose();}
});

test('season and ambient updates preserve tree pictures, saved layouts and every walkable sample',async()=>{
  const f=fixture();try{
    await f.model.loadOriginalArt(f.loader);f.model.scene.updateMatrixWorld(true);
    const rows=treePictures(f.model),maps=rows.map(o=>o.material.map),positions=rows.map(o=>o.getWorldPosition(new THREE.Vector3()).toArray());
    const samples=[];for(let y=28;y<=1892;y+=110)for(let x=28;x<=2852;x+=110)samples.push([x,y,Town.isWalkable(f.world,x,y)]);
    for(const season of ['winter','spring','summer','autumn']){
      assert.equal(f.model.setSeason(season),true);f.model.animate(2700,false);f.model.animate(3000,true);
      assert.deepEqual(rows.map(o=>o.material.map),maps);assert.deepEqual(rows.map(o=>o.getWorldPosition(new THREE.Vector3()).toArray()),positions);
      for(const picture of rows)assert.equal(picture.material.color.getHex(),0xffffff);
      for(const [x,y,walkable] of samples)assert.equal(Town.isWalkable(f.world,x,y),walkable);
    }
    assertDerivedWorld(f.world,f.before,f.model);
  }finally{f.model.dispose();}
});

test('repeated cards share one material/texture per species and release those resources once without disposing the global quad',async()=>{
  const f=fixture(),counts=new Map();try{
    await f.model.loadOriginalArt(f.loader);const rows=treePictures(f.model),byKind=new Map();
    assert.equal(new Set(f.loads).size,f.loads.length,'each original has one load');
    for(const picture of rows){
      const kind=picture.userData.originalArtKind;
      if(byKind.has(kind))assert.strictEqual(picture.material,byKind.get(kind));else byKind.set(kind,picture.material);
    }
    assert.equal(byKind.size,4);assert.equal(new Set([...byKind.values()].map(m=>m.map)).size,4);
    for(const resource of [...byKind.values(),...[...byKind.values()].map(m=>m.map)]){counts.set(resource,0);resource.addEventListener('dispose',()=>counts.set(resource,counts.get(resource)+1));}
    let quadDisposals=0;const quads=new Set(rows.map(o=>o.geometry)),onQuad=()=>quadDisposals++;
    for(const quad of quads){assert.equal(f.model.geometries.has(quad),false);quad.addEventListener('dispose',onQuad);}
    try{f.model.dispose();f.model.dispose();for(const n of counts.values())assert.equal(n,1);assert.equal(quadDisposals,0);}
    finally{for(const quad of quads)quad.removeEventListener('dispose',onQuad);}
  }finally{f.model.dispose();}
});

test('a missing new tree picture keeps the whole original set hidden and releases completed loads',async()=>{
  const f=fixture(),counts=new Map();try{
    const missing=Originals.resolve('treeBirch').url;
    const loader={loadAsync(url){if(url===missing)return Promise.reject(Error('synthetic missing image'));return f.loader.loadAsync(url).then(texture=>{counts.set(texture,0);texture.addEventListener('dispose',()=>counts.set(texture,counts.get(texture)+1));return texture;});}};
    await assert.rejects(f.model.loadOriginalArt(loader),/placement_originals_load_failed:treeBirch/);
    assert.equal(f.model.originalArt.state,'failed');assert.ok(treePictures(f.model).every(o=>!o.visible));
    f.model.dispose();for(const count of counts.values())assert.equal(count,1);assertDerivedWorld(f.world,f.before,f.model);
  }finally{f.model.dispose();}
});

test('an older isolated synchronous preview retains its original tree when the new helper is not registered',()=>{
  const actualRequire=createRequire(new URL('../static/pet-town-scene.js',import.meta.url));
  const sandbox={module:{exports:{}},require:path=>path==='./pet-town-tree-variety.js'?undefined:actualRequire(path)};
  vm.runInNewContext(readFileSync(new URL('../static/pet-town-scene.js',import.meta.url),'utf8'),sandbox);
  const world=Town.createWorld(),before=JSON.stringify(world),model=sandbox.module.exports.buildWorld(THREE,world,{},null,documentFixture());
  try{
    assert.equal(model.treeVarietyRevision,null);assert.equal(model.scene.userData.treeVarietyRevision,null);
    assert.ok(Object.isFrozen(model.treeVarietyKinds));assert.deepEqual(Array.from(model.treeVarietyKinds),Array(27).fill('tree'));
    const rows=treePictures(model);assert.equal(rows.length,27);assert.ok(rows.every(o=>o.userData.originalArtKind==='tree'));
    assertDerivedWorld(world,before,model);
  }finally{model.dispose();}
});

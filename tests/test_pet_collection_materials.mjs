import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import Style from '../static/pet-town-style.js';
import Seasons from '../static/pet-japan-seasons.js';
const sha=s=>createHash('sha256').update(s).digest('hex'),rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
test('explicit collection roles have finite immutable palette/finish/light contracts with no global exposure increase',()=>{
 assert.equal(Style.revision,'shop-collection-unity1');assert.equal(Seasons.artRevision,Style.revision);assert.equal(Style.collection.revision,Style.revision);
 assert.ok(Object.isFrozen(Style.collection)&&Object.isFrozen(Style.collection.palette));
 for(const colors of Object.values(Style.collection.palette)){assert.ok(Object.isFrozen(colors));assert.equal(colors.length,5);assert.equal(new Set(colors).size,5);for(const c of colors)assert.match(c,/^#[0-9a-f]{6}$/);}
 const l=Style.collection.light;assert.ok(Object.isFrozen(l));assert.equal(l.hemisphereIntensity,1.45);assert.equal(l.sunIntensity,2.2);
 const [r,g,b]=rgb(l.hemisphereGround);assert.ok(r>=g&&g>=b,'shadow bounce is neutral warm instead of green');assert.ok(r-g<20&&g-b<20);
});
test('role-specific palette changes cannot recolor seasonal greens, authored flowers, water, glass or unknown/invalid inputs',()=>{
 for(const role of ['foliage','grass','flower','water','glass','soil','paper','unknown','__proto__'])for(const c of ['#627947','#edb1c7','#acd4d0','#715d47','#ABC'])assert.equal(Style.paletteColor(c,role),c);
 const object={};assert.equal(Style.paletteColor(object,'wood'),object);for(const c of ['not-a-color','#12345','rgba(1,2,3,1)',null])assert.equal(Style.paletteColor(c,'stone'),c);
 assert.equal(Style.materialFinish('__proto__','#fff'),null);assert.equal(Style.materialFinish('unknown','#fff'),null);
});
test('honey wood, warm stone, lilac glaze and terracotta stay distinct and resolve idempotently once cached',()=>{
 for(const role of ['wood','bark','plaster','stone','metal','glaze','terracotta'])for(const c of ['#71814a','#9c704d','#b98856','#d8bd95','#f8ead3']){const resolved=Style.paletteColor(c,role);assert.ok(Style.collection.palette[role].includes(resolved));assert.equal(Style.paletteColor(resolved,role),resolved);}
 for(const role of ['wood','stone','metal','terracotta']){const [r,g,b]=rgb(Style.paletteColor('#71814a',role));assert.ok(r>g&&g>b,'auxiliary olive prop becomes the explicit warm material family');}
 const glaze=Style.paletteColor('#ad94be','ceramic');assert.ok(Style.collection.palette.glaze.includes(glaze));assert.equal(Style.paletteColor(glaze,'ceramic'),glaze);
 assert.equal(Style.paletteColor('#a6c4b0','ceramic'),'#a6c4b0','authored mint pigment remains mint');assert.equal(Style.paletteColor('#d4a5b3','ceramic'),'#d4a5b3','authored blush remains blush');
 assert.ok(Style.collection.palette.wood.every(c=>!Style.collection.palette.glaze.includes(c)));
});
test('glaze/terracotta share the existing ceramic map and all role finishes stay bounded with no extra texture kind',()=>{
 const textureKinds=new Set();for(const role of ['grass','foliage','flower','soil','paper','plaster','wood','bark','ceramic','glaze','terracotta','stone','metal','glass','water']){
  const f=Style.materialFinish(role,'#ad94be');assert.ok(Object.isFrozen(f));for(const k of ['roughness','metalness','bumpScale'])assert.ok(Number.isFinite(f[k]));assert.ok(f.roughness>=0&&f.roughness<=1&&f.metalness>=0&&f.metalness<=1&&f.bumpScale>=0&&f.bumpScale<=.1);if(f.textureRole)textureKinds.add(f.textureRole);
 }
 assert.deepEqual([...textureKinds].sort(),['bark','ceramic','foliage','plaster','stone','wood']);assert.equal(Style.materialFinish('soil').textureRole,'stone');assert.equal(Style.materialFinish('paper').textureRole,'plaster');assert.equal(Style.materialFinish('terracotta').textureRole,'ceramic');assert.equal(Style.materialFinish('glaze').textureRole,'ceramic');assert.ok(Style.materialFinish('ceramic','#ad94be').roughness<Style.materialFinish('plaster').roughness);
});
test('seasonal presentation preserves natural green base and a distinct bounded winter without white haze',()=>{
 for(const key of ['spring','summer','autumn']){const p=Seasons.profile(key);for(const c of [p.ground,...p.foliage]){const[r,g,b]=rgb(c);assert.ok(g>r&&g>b);assert.ok(g<245);}assert.ok(Object.isFrozen(p)&&Object.isFrozen(p.foliage));}
 const winter=rgb(Seasons.profile('winter').ground);assert.ok(Math.max(...winter)-Math.min(...winter)<16);assert.ok(Math.max(...winter)<245);
 assert.equal(new Set(Object.values(Seasons.profiles).map(p=>p.ground)).size,4);assert.notDeepEqual(Seasons.profile('autumn').accents,Seasons.profile('summer').accents);assert.equal(Seasons.profile('unknown'),null);
});
test('leaf/branch/roof/bowl/arch geometry, neutral texture generators and their allocation limits are byte unchanged',()=>{
 const source=readFileSync(new URL('../static/pet-town-style.js',import.meta.url),'utf8'),geometry=source.slice(source.indexOf(' function leafGeometry'),source.indexOf(' return Object.freeze({revision:'));
 assert.equal(sha(geometry),'1c17d3d62885f6e0c23586094dd386e46aa4dc348c3b133f0ef9c81fd680cba2');
 assert.deepEqual([Style.limits.treeLeaves,Style.limits.treeTwigs,Style.limits.leavesPerTwig,Style.limits.surfaceTextures,Style.limits.surfaceTextureSize,Style.limits.groundTextureSize,Style.limits.groundPatches],[126,9,14,6,128,512,80]);
});
test('JST resolver and lifecycle watcher functions are byte unchanged including date boundaries, timer and cleanup',()=>{
 const source=readFileSync(new URL('../static/pet-japan-seasons.js',import.meta.url),'utf8'),logic=source.slice(source.indexOf('  function resolve'),source.indexOf('  return Object.freeze({artRevision:'));
 assert.equal(sha(logic),'6e63be42254634c73e8d45cea6cf2f7b9a5696cc8ab69162799bdd268ca382ad');
 for(const[before,after,key]of [['2026-02-28T14:59:59.999Z','2026-02-28T15:00:00.000Z','spring'],['2026-05-31T14:59:59.999Z','2026-05-31T15:00:00.000Z','summer'],['2026-08-31T14:59:59.999Z','2026-08-31T15:00:00.000Z','autumn'],['2026-11-30T14:59:59.999Z','2026-11-30T15:00:00.000Z','winter']]){
  assert.notEqual(Seasons.resolve(Date.parse(before)).key,key);assert.equal(Seasons.resolve(Date.parse(after)).key,key);
 }
 assert.equal(Seasons.resolve(NaN),null);
});
test('the seven actual market reference image bytes remain bound to this palette contract',()=>{
 for(const id of ['tree','house','fountain','sunflower','lantern','flower','mushroom'])assert.equal(sha(readFileSync(new URL('../static/pet-items-v1/'+id+'.webp',import.meta.url))),Style.collection.references[id]);
});

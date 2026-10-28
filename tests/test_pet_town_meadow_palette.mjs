import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import Meadow from '../static/pet-town-meadow-flowers.js';

function sites(n=40) {
  return Array.from({length:n},(_,i)=>({id:'approved-meadow-'+i,x:(i%4)*1.8-2.7,y:.026,z:Math.floor(i/4)*1.8-1.8,seed:i*101+17}));
}

test('flower palette revision preserves every authored species, position, height, turn and sway phase from native-reviewed v2',()=>{
  const rows=Array.from({length:128},(_,i)=>
    Meadow.recipe({id:'palette-proof-'+i,x:0,y:.025,z:0,seed:i*107+19}).plants.map(p=>
      ({id:p.id,siteId:p.siteId,kind:p.kind,x:p.x,z:p.z,height:p.height,turn:p.turn,phase:p.phase})));
  // Captured from native-reviewed candidatev2 before the palette-only edit.
  assert.equal(createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    '38408c0e9081719373d62ad301d0f3b24a14cad2ef9e3bebd1fd8b1744174ac7');
  assert.deepEqual(rows,Array.from({length:128},(_,i)=>
    Meadow.recipe({id:'palette-proof-'+i,x:0,y:.025,z:0,seed:i*107+19}).plants.map(p=>
      ({id:p.id,siteId:p.siteId,kind:p.kind,x:p.x,z:p.z,height:p.height,turn:p.turn,phase:p.phase}))));
});

test('species palettes favor white and yellow daisies/pansies while retaining warm roses and six garden pigments',()=>{
  const choices={daisy:[0,2,1],pansy:[0,3,2],tulip:[0,2,4,5],rose:[1,4,5],bell:[0,3,4],spike:[0,3,4],leaf:[0]};
  const all=new Set(),counts={daisy:[0,0],pansy:[0,0]};
  for(let i=0;i<1024;i++){
    const recipe=Meadow.recipe({id:'palette-distribution-'+i,x:0,y:.025,z:0,seed:i*97+31});
    for(const plant of recipe.plants){
      assert.ok(choices[plant.kind].includes(plant.colorIndex),plant.kind+' stays in its approved local palette');
      if(plant.kind!=='leaf')all.add(plant.colorIndex);
      if(counts[plant.kind]){
        counts[plant.kind][0]++;
        if(plant.colorIndex===0||plant.colorIndex===2)counts[plant.kind][1]++;
      }
    }
  }
  assert.equal(all.size,6);
  for(const [kind,[total,bright]] of Object.entries(counts)){
    assert.ok(bright/total>.58&&bright/total<.75,kind+' is mostly white/yellow across the finite seed sample');
  }
});

test('actual rendered instance pigments follow the species colors through seasons without new shapes, buffers or outside recoloring',()=>{
  const group=new THREE.Group(),geometries=new Set(),materials=new Set();
  const meadow=Meadow.create(THREE,{group,sites:sites(),geometries,materials,
    mat:color=>new THREE.MeshStandardMaterial({color})});
  const outside=new THREE.MeshStandardMaterial({color:'#abcdef'});
  const source=sites().flatMap(s=>Meadow.recipe(s).plants),byId=new Map(source.map(p=>[p.id,p]));
  const geometry=[...geometries],material=[...materials],buffers=meadow.batches.map(b=>b.mesh.instanceMatrix.array);
  const roots=meadow.plants.map(p=>p.base.slice()),summary=meadow.summary();
  const summer=['#fff0d2','#e97eac','#f4c542','#ae8bd4','#eeaabd','#dc6c63'];
  const autumn=['#f8ebcf','#e58aa5','#edbf4a','#b198cf','#eab3bd','#d47768'];
  const color=new THREE.Color(),seen=new Set();
  try{
    for(const [key,palette] of [['summer',summer],['autumn',autumn]]){
      meadow.setSeason(key);
      for(const batch of meadow.batches)for(let i=0;i<batch.rows.length;i++){
        const row=batch.rows[i];if(row.tintRole!=='bloom')continue;
        const plant=byId.get(row.plant.id);
        batch.mesh.getColorAt(i,color);
        assert.equal(color.getHexString(),new THREE.Color(palette[plant.colorIndex]).getHexString());
        seen.add(plant.colorIndex);
      }
      assert.deepEqual([...geometries],geometry);assert.deepEqual([...materials],material);
      meadow.batches.forEach((batch,i)=>assert.equal(batch.mesh.instanceMatrix.array,buffers[i]));
      assert.deepEqual(meadow.plants.map(p=>p.base),roots);
      assert.equal(meadow.summary().triangles,summary.triangles);
      assert.equal(outside.color.getHexString(),'abcdef');
    }
    assert.equal(seen.size,6);assert.equal(summary.textures,0);assert.equal(summary.lights,0);
  }finally{
    meadow.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();outside.dispose();
  }
});

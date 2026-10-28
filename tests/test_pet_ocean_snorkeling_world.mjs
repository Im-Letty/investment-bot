import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../static/vendor/three-0.160.1.module.js';
import World from '../static/pet-ocean-snorkeling-world.js';
import Town from '../static/pet-town-walk.js';
import Discoveries from '../static/pet-ocean-discoveries.js';
function fixture(){const world=Town.createWorld(),before=JSON.stringify(world),group=new THREE.Group(),geometries=new Set(),materials=new Set(),marine=World.create(THREE,{world,group,geometries,materials});return{world,before,group,geometries,materials,marine};}

test('marine habitat shares all four real observation anchors, remains inactive by default, and does not change land or economy',()=>{
 const f=fixture(),m=f.marine;assert.equal(m.group.visible,false);assert.deepEqual(m.habitat.creatures,Discoveries.encounters);assert.equal(JSON.stringify(f.world),f.before);assert.equal(m.metrics.textures,0);assert.equal(m.metrics.lights,0);assert.equal(m.metrics.collisionSurfacesAdded,0);assert.equal(m.metrics.anatomicalBodyFit,false);assert.equal(m.metrics.decorativeKelpClusters,6);assert.equal(m.group.getObjectByName('decorative-rounded-marine-rocks').count,12);assert.equal(m.creatureRoots.length,4,'scenery does not add discovery IDs');
 for(const c of Discoveries.encounters){const root=m.creatureRoots.find(x=>x.userData.creatureId===c.id);assert.ok(root);assert.ok(Math.abs(root.position.x*100+1440-c.position.x)<1e-9);assert.ok(Math.abs(root.position.z*100+960-c.position.y)<1e-9);assert.ok(Math.abs(root.position.y-(-.05-c.depth))<1e-9);assert.ok(m.isWater(c.position));}
 m.group.traverse(o=>{if(o.isMesh){assert.ok(o.userData.noStaticBatch);assert.ok(o.matrixWorld.elements.every(Number.isFinite));}});
 m.dispose();
});

test('seabed is a closed thick native mesh wholly seaward and actual shell/starfish/kelp bases meet its sampled vertices',()=>{
 const f=fixture(),bed=f.marine.bed,g=bed.geometry,p=g.attributes.position,edges=new Map();
 for(let i=0;i<g.index.count;i+=3){const t=[g.index.getX(i),g.index.getX(i+1),g.index.getX(i+2)];for(let j=0;j<3;j++){const a=t[j],b=t[(j+1)%3],key=[Math.min(a,b),Math.max(a,b)].join(':');edges.set(key,(edges.get(key)||0)+1);}}
 assert.ok([...edges.values()].every(n=>n===2),'every indexed boundary edge has exactly two triangle owners');
 for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),townY=z*100+960,townX=x*100+1440;assert.ok([x,y,z].every(Number.isFinite));assert.ok(Math.abs(x)<24&&Math.abs(z)<24);assert.ok(townX>Discoveries.coastX(townY)+54.99);assert.ok(y<-.05);}
 for(const c of Discoveries.encounters.filter(c=>c.kind!=='fish')){const x=(c.position.x-1440)/100,z=(c.position.y-960)/100,ray=new THREE.Raycaster(new THREE.Vector3(x,1,z),new THREE.Vector3(0,-1,0)),hit=ray.intersectObject(bed)[0];assert.ok(hit,c.id+' actual bed ray');const bottom=-.05-c.depth-(c.kind==='seaweed'?0:.009);assert.ok(Math.abs(hit.point.y-bottom)<.001,c.id+' actual ground support');}
 const foundation=f.marine.group.getObjectByName('underwater-distant-sand-foundation'),bounds=new THREE.Box3().setFromObject(foundation),colors=g.attributes.color;let border=0;
 assert.equal(foundation.material.color.getHexString(),bed.material.color.getHexString(),'sand foundation and detailed bed have matching pigment');
 for(let i=0;i<p.count/2;i++){const townY=p.getZ(i)*100+960,gap=p.getX(i)*100+1440-Discoveries.coastX(townY);if(Math.abs(townY-1460)<.001||Math.abs(townY-1870)<.001||Math.abs(gap-55)<.001||Math.abs(gap-710)<.001){border++;assert.ok(Math.abs(g.attributes.normal.getY(i)-1)<1e-6,'perimeter normals continue the flat foundation lighting');assert.ok(Math.abs(p.getY(i)-bounds.max.y)<.00001,'every actual bed perimeter vertex meets the foundation without a visible vertical edge');assert.ok(Math.abs(colors.getX(i)-1)<1e-6&&Math.abs(colors.getY(i)-1)<1e-6&&Math.abs(colors.getZ(i)-1)<1e-6,'perimeter pigment fades to the same foundation color');}}
 assert.ok(border>50);assert.ok(g.boundingBox.max.y-g.boundingBox.min.y>.2);f.marine.dispose();
});

test('fish, rooted kelp, bubbles and offshore ripples move within the sea; reduced motion freezes them with stable resources',()=>{
 const f=fixture(),m=f.marine,c=Discoveries.encounters.find(c=>c.kind==='fish'),fish=m.group.getObjectByName('marine-encounter-'+c.id),kelp=m.group.getObjectByName('marine-encounter-kelp'),stem=kelp.children[0],counts=[f.geometries.size,f.materials.size];
 m.setActive({mode:'underwater'});m.animate(0,false);const start=fish.position.clone(),root=stem.position.clone(),bubble=Array.from(m.bubbles.instanceMatrix.array);m.animate(1200,false);assert.notDeepEqual(fish.position,start);assert.notDeepEqual(Array.from(m.bubbles.instanceMatrix.array),bubble);assert.deepEqual(stem.position,root,'seaweed root stays planted');
 for(let ms=0;ms<=24000;ms+=400){m.animate(ms,false);assert.ok(Math.abs(fish.position.x)<24&&Math.abs(fish.position.z)<24);assert.ok(fish.position.y<-.05);}
 m.animate(1,true);const stable=fish.matrixWorld.toArray(),leaves=stem.matrixWorld.toArray(),frozen=Array.from(m.bubbles.instanceMatrix.array);m.animate(9999,true);assert.deepEqual(fish.matrixWorld.toArray(),stable);assert.deepEqual(stem.matrixWorld.toArray(),leaves);assert.deepEqual(Array.from(m.bubbles.instanceMatrix.array),frozen);assert.deepEqual([f.geometries.size,f.materials.size],counts);
 m.setActive(null);assert.equal(m.group.visible,false);m.dispose();
});

test('marine disposal releases only its instance buffer; the enclosing scene owns every geometry/material exactly once',()=>{
 const f=fixture();let geometries=0,materials=0,buffers=0,rockBuffers=0;for(const g of f.geometries)g.addEventListener('dispose',()=>geometries++);for(const m of f.materials)m.addEventListener('dispose',()=>materials++);f.marine.bubbles.addEventListener('dispose',()=>buffers++);f.marine.group.getObjectByName('decorative-rounded-marine-rocks').addEventListener('dispose',()=>rockBuffers++);
 assert.equal(f.marine.dispose(),true);assert.equal(f.marine.dispose(),false);assert.equal(buffers,1);assert.equal(rockBuffers,1);assert.equal(geometries,0);assert.equal(materials,0);for(const g of f.geometries)g.dispose();for(const m of f.materials)m.dispose();assert.equal(geometries,f.geometries.size);assert.equal(materials,f.materials.size);assert.equal(f.group.children.length,0);
});

import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
const candidateRoot=new URL('../',import.meta.url),fallbackRoot=new URL('../../source/',import.meta.url);
async function staticURL(name){const u=new URL('static/'+name,candidateRoot);try{await fs.access(u);return u;}catch{return new URL('static/'+name,fallbackRoot);}}
const THREE=await import((await staticURL('vendor/three-0.160.1.module.js')).href);
const context={console};context.window=context;context.globalThis=context;vm.createContext(context);
for(const name of ['pet-town-walk','pet-frame-fit','pet-river-fishing','pet-japan-seasons','pet-town-style','pet-town-layout-art','pet-town-placement-originals','pet-town-water-life','pet-town-scene'])vm.runInContext(await fs.readFile(await staticURL(name+'.js'),'utf8'),context);
const world=context.PetTownWalk.createWorld(),worldBefore=JSON.stringify(world);
const model=context.PetTownScene.buildWorld(THREE,world,{},null,null,'autumn');model.scene.updateMatrixWorld(true);
const home=model.placeGroups.find(g=>g.userData.placeId==='home'),homePlace=world.places.find(p=>p.id==='home'),dimensions=context.PetTownWalk.solidDimensions(homePlace);
const named=n=>{const m=home.getObjectByName(n);assert.ok(m,n);return m;};
const passed=[],facts={scope:'home form and material Mesh checks; finite witnesses, not traversal, body fit, physics or owner adoption',passed};
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const source=await fs.readFile(await staticURL('pet-town-scene.js'),'utf8');facts.source_sha256=hash(source);
function geometryFacts(m){
 const g=m.geometry,p=g.attributes.position,n=g.attributes.normal,idx=g.index,edges=new Map(),vertices=[];let badNormals=0,negativeFaces=0,degenerate=0,volume=0,minDot=1;
 for(let i=0;i<p.count;i++){const v=new THREE.Vector3().fromBufferAttribute(p,i),nn=new THREE.Vector3().fromBufferAttribute(n,i);if(!v.toArray().every(Number.isFinite)||!nn.toArray().every(Number.isFinite)||Math.abs(nn.length()-1)>1e-4)badNormals++;vertices.push(v);}
 const count=idx?idx.count:p.count;
 for(let i=0;i<count;i+=3){const ids=[0,1,2].map(j=>idx?idx.getX(i+j):i+j),a=vertices[ids[0]],b=vertices[ids[1]],c=vertices[ids[2]],face=new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a));if(face.length()<1e-11){degenerate++;continue;}const avg=ids.reduce((v,id)=>v.add(new THREE.Vector3().fromBufferAttribute(n,id)),new THREE.Vector3()).normalize(),dot=face.clone().normalize().dot(avg);minDot=Math.min(minDot,dot);if(dot< -1e-6)negativeFaces++;volume+=a.dot(new THREE.Vector3().crossVectors(b,c))/6;
 for(let k=0;k<3;k++){const ka=vertices[ids[k]].toArray().map(x=>Math.round(x*1e6)).join(','),kb=vertices[ids[(k+1)%3]].toArray().map(x=>Math.round(x*1e6)).join(',');if(ka===kb)continue;const key=ka<kb?ka+'|'+kb:kb+'|'+ka;edges.set(key,(edges.get(key)||0)+1);}}
 return{name:m.name,triangles:count/3,badEdges:[...edges.values()].filter(v=>v!==2).length,badNormals,negativeFaces,degenerate,minDot,localVolume:volume};
}
function inside(m,point){const p=point.clone().applyMatrix4(m.matrixWorld.clone().invert()),ray=new THREE.Ray(p,new THREE.Vector3(1,.21319,.37123).normalize()),g=m.geometry,pos=g.attributes.position,idx=g.index,count=idx?idx.count:pos.count,hits=[];
 for(let i=0;i<count;i+=3){const t=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(pos,idx?idx.getX(i+k):i+k)),hit=ray.intersectTriangle(t[0],t[1],t[2],false,new THREE.Vector3());if(hit&&hit.distanceTo(p)>1e-7)hits.push(hit.distanceTo(p));}
 hits.sort((a,b)=>a-b);return hits.filter((v,i)=>!i||v-hits[i-1]>1e-6).length%2===1;
}
function point(parent,xyz){return new THREE.Vector3(...xyz).applyMatrix4(parent.matrixWorld);}
function witness(a,b,xyz,parent=home){const p=point(parent,xyz);assert.ok(inside(a,p)&&inside(b,p),a.name+' / '+b.name);return{a:a.name,b:b.name,point:p.toArray()};}
function localRay(mesh,parent,xyz){const origin=point(parent,xyz),direction=new THREE.Vector3(0,0,-1).transformDirection(parent.matrixWorld),ray=new THREE.Raycaster(origin,direction);return ray.intersectObject(mesh,false);}
async function check(name,fn){await test(name,async()=>{await fn();passed.push(name);});}
await check('world definition, place transforms, and initial population stay unchanged',()=>{
 assert.equal(JSON.stringify(world),worldBefore);assert.deepEqual(Array.from(home.position.toArray()),[-8.064,.025,-5.704]);assert.deepEqual(Array.from(home.scale.toArray()),[1,.9,1]);assert.equal(model.people.length,0);assert.equal(home.userData.homeDesignRevision,'shop-cottage-match2');
 facts.world_sha256=hash(worldBefore);facts.home_matrix=home.matrixWorld.toArray();
});
await check('wooden threshold keeps its size and meets the shared deeper front contact',()=>{
 const m=named('cottage-retained-wood-threshold'),box=new THREE.Box3().setFromObject(m),localZ=dimensions.depth/2+dimensions.stepOffset;
 m.position.toArray().forEach((v,i)=>assert.ok(Math.abs(v-[0,.065,localZ][i])<1e-12));
 assert.deepEqual(m.scale.toArray(),[dimensions.stepWidth,.1,dimensions.stepDepth]);
 assert.ok(Math.abs(box.min.y-.0385)<1e-10&&Math.abs(box.max.y-.1285)<1e-10);
 const expectedFront=home.position.z+localZ+dimensions.stepDepth/2;
 assert.ok(Math.abs(box.max.z-expectedFront)<1e-10);
 const contact=context.PetTownWalk.doorContact(homePlace),actualFront=context.PetTownScene.townPoint(world,{x:0,z:box.max.z});
 assert.ok(contact.y>=actualFront.y+18,'the full actor radius remains outside the actual step');
 let doors=0;home.traverse(o=>{if(o.userData.door)doors++;});assert.equal(doors,10);
 facts.threshold_bounds={min:box.min.toArray(),max:box.max.toArray(),contact:contact,sharedDimensions:dimensions};
});
await check('short wall and curved gable use real volume, not a tinted image plane',()=>{
 const wall=named('cottage-short-cream-wall'),roof=named('cottage-curved-gable-roof');assert.ok(wall.isMesh&&wall.userData.solidWall);assert.ok(Math.abs(wall.geometry.boundingBox.max.y-wall.geometry.boundingBox.min.y-1.42)<1e-6);assert.equal(wall.userData.actualOpeningCount,1);assert.equal(roof.userData.profileExponent,1.35);assert.ok(roof.geometry.attributes.position.count>100);assert.ok(!roof.isSprite&&roof.material.every(m=>!m.map||m.map.userData.kind!=='reference-image'));
 const topAt=x=>{const p=roof.geometry.attributes.position;let best=-Infinity;for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i)-x)<.035)best=Math.max(best,p.getY(i));return best;};const midSlopeX=dimensions.width*.62*.5;assert.ok(topAt(0)>1.05);assert.ok(topAt(midSlopeX)<.51);assert.ok(topAt(midSlopeX)>.38);facts.profile={ridge:topAt(0),midSlopeX:midSlopeX,midSlope:topAt(midSlopeX),sampleRoofRunFraction:.5};
});
await check('door frame and actual wall have arched voids around a separate closed arched panel',()=>{
 const f=named('cottage-arched-door-frame'),p=named('cottage-arched-door-panel'),wall=named('cottage-short-cream-wall'),fz=f.position.z,pz=p.position.z;
 assert.equal(inside(f,point(home,[0,.6,fz])),false);
 assert.equal(inside(f,point(home,[.30,.60,fz])),true);
 assert.equal(inside(f,point(home,[0,1.42,fz])),true);
 assert.equal(inside(p,point(home,[0,1.28,pz])),true);
 assert.equal(inside(p,point(home,[.23,1.28,pz])),false);
 assert.equal(localRay(wall,home,[0,.6,dimensions.depth/2+1]).length,0,'the wall no longer fills the doorway aperture');
 assert.ok(localRay(p,home,[0,.6,dimensions.depth/2+1]).length>0,'the closed door panel remains a real solid');
});
await check('new named home solids have closed edges, finite outward normals and positive volume',()=>{
 const unique=new Set(),all=[];home.traverse(m=>{if(m.isMesh&&(/^cottage-|^dormer-|^solid-building-|overlapping-round-roof-tile|living-arched-window-ring|living-window-glass/.test(m.name))&&!unique.has(m.geometry)){unique.add(m.geometry);all.push(geometryFacts(m));}});assert.ok(all.length>=12);for(const f of all){assert.equal(f.badEdges,0,f.name);assert.equal(f.badNormals,0,f.name);assert.equal(f.negativeFaces,0,f.name);assert.equal(f.degenerate,0,f.name);assert.ok(f.localVolume>0,f.name);}facts.geometry=all;
});
await check('six finite structural join witnesses lie inside the actual wall, frame, post and roof solids',()=>{
 const d=named('market-photo-dormer'),front=named('cottage-short-cream-wall'),frame=named('cottage-arched-door-frame'),post=named('cottage-round-corner-post');
 facts.joins=[
 witness(front,named('cottage-curved-gable-roof'),[.4,1.535,front.position.z]),
 witness(front,frame,[.30,.60,frame.position.z]),
 witness(front,post,[post.position.x,.80,post.position.z]),
 witness(named('cottage-curved-gable-roof'),named('cottage-dormer-joined-cream-body'),[-.51,1.86,0]),
 witness(named('cottage-dormer-joined-cream-body'),named('dormer-arched-frame'),[.19,.20,.13],d),
 witness(named('cottage-dormer-joined-cream-body'),named('cottage-curved-dormer-roof'),[0,.66,0],d)];
});
await check('all authored home tile solids join their own real roof at finite interior samples',()=>{
 const tiles=[];home.traverse(m=>{if(m.name==='overlapping-round-roof-tile'||m.name==='dormer-rounded-cap')tiles.push(m);});const expectedTiles=2*4*Math.max(3,Math.ceil((dimensions.depth+.30)/.30))+2;assert.equal(tiles.length,expectedTiles);facts.authoredTileCount=expectedTiles;facts.tileJoins=tiles.map(m=>{const support=named(m.name==='dormer-rounded-cap'?'cottage-curved-dormer-roof':'cottage-curved-gable-roof');let found=null;outer:for(const x of [-.65,0,.65])for(const y of [-.9,-.5,0,.5])for(const z of [-.65,0,.65]){const p=point(m,[x,y,z]);if(inside(m,p)&&inside(support,p)){found=p.toArray();break outer;}}assert.ok(found,m.name);assert.equal(m.geometry.userData.cottageAdjustedTriangleNormals,1);return{name:m.name,point:found};});
});
await check('dormer arch top remains visible below its curved open-front hood',()=>{
 const d=named('market-photo-dormer'),f=named('dormer-arched-frame'),hood=named('cottage-curved-dormer-roof');assert.ok(localRay(f,d,[0,.55,1]).length>0);assert.equal(localRay(hood,d,[0,.55,1]).length,0);const forward=new THREE.Vector3(0,0,1).transformDirection(d.matrixWorld);assert.ok(forward.z>.7&&forward.x<-.6);facts.dormer_front_direction=forward.toArray();assert.deepEqual(d.scale.toArray(),[.8,.8,.8]);const dormerBox=new THREE.Box3().setFromObject(d),ridgeBox=new THREE.Box3().setFromObject(named('cottage-closed-rounded-ridge'));assert.ok(dormerBox.max.y<ridgeBox.max.y-.07);facts.dormer_bounds={min:dormerBox.min.toArray(),max:dormerBox.max.toArray(),main_ridge_max_y:ridgeBox.max.y};
});
await check('side and rear arched window rings each have real openings',()=>{
 const windows=[];home.traverse(m=>{if(m.name==='all-angle-arched-window')windows.push(m);});assert.equal(windows.length,3);for(const w of windows){const ring=w.getObjectByName('living-arched-window-ring');assert.ok(ring);const pane=w.getObjectByName('living-window-glass'),back=w.getObjectByName('window-room-warm-backwall');assert.ok(pane&&back&&pane.position.z-back.position.z>.20);assert.equal(localRay(ring,w,[0,.3,1]).length,0);assert.ok(localRay(ring,w,[.19,.3,1]).length>0);}
});
await check('wider deeper home stays in shared-dimension envelopes and retains the prior height limits',()=>{
 const oldMin=new THREE.Vector3(-9.108097065925598,.024999999999999994,-6.2665),oldMax=new THREE.Vector3(-7.019902934074402,2.4708472857272827,-5.094431097911412),b=new THREE.Box3();home.traverse(m=>{if(m.isMesh)b.union(new THREE.Box3().setFromObject(m));});
 assert.ok(b.min.y>=oldMin.y-1e-8&&b.max.y<=oldMax.y+1e-8,'old vertical silhouette cap retained');
 const widthEnvelope=dimensions.width*.62+.075;
 assert.ok(b.min.x>=home.position.x-widthEnvelope&&b.max.x<=home.position.x+widthEnvelope,'curved roof and tiles stay inside their shared-width authored overhang');
 const depthEnvelope=dimensions.depth/2+.27;
 assert.ok(b.min.z>=home.position.z-depthEnvelope&&b.max.z<=home.position.z+depthEnvelope,'roof trim and recessed rooms have a bounded authored depth');
 facts.home_bounds={min:b.min.toArray(),max:b.max.toArray()};facts.prior_Y_limits_retained=true;facts.shared_width_envelope=widthEnvelope;facts.shared_depth_envelope=depthEnvelope;facts.old_measured_home_bounds={min:oldMin.toArray(),max:oldMax.toArray()};
});
await check('home mesh/material budget is bounded and does not add live lights',()=>{
 let meshes=0,triangles=0,lights=0;home.traverse(m=>{if(m.isMesh){meshes++;triangles+=(m.geometry.index?m.geometry.index.count:m.geometry.attributes.position.count)/3;}if(m.isLight)lights++;});assert.ok(meshes<=210,'five authored recessed home rooms remain within the210Mesh cap');assert.ok(triangles<44000,'six authored depth-columns and real window walls/roof stay below44k home triangles');assert.ok(model.geometries.size<=176&&model.materials.size<=148,'three shared meadow shapes and eight additional meadow/border materials remain bounded; home budgets do not change');assert.ok(model.batches.length<=120,'static/dynamic batching stays bounded');assert.equal(lights,0);facts.budget={homeMeshes:meshes,homeTriangles:triangles,homeLights:lights,geometries:model.geometries.size,materials:model.materials.size};
});
await check('all four season changes preserve home geometry and doorway transform',()=>{
 const m=named('cottage-retained-wood-threshold'),pose=JSON.stringify(m.matrixWorld.elements),geometries=[];home.traverse(o=>{if(o.isMesh)geometries.push(o.geometry);});for(const season of ['spring','summer','autumn','winter']){model.setSeason(season);model.scene.updateMatrixWorld(true);assert.equal(JSON.stringify(m.matrixWorld.elements),pose);let at=0;home.traverse(o=>{if(o.isMesh)assert.equal(o.geometry,geometries[at++]);});assert.equal(at,geometries.length);}assert.equal(JSON.stringify(world),worldBefore);facts.seasonSamples=4;
});
await check('thin lilac tiles, smooth ivory and real wood roundovers use building-local finishes',()=>{
 const wall=named('cottage-short-cream-wall'),post=named('cottage-round-corner-post');assert.equal(home.userData.shopStyleRevision,'shop-style1');assert.equal(model.scene.userData.shopStyleRevision,'shop-style1');
 assert.equal(wall.material.color.getHexString(),'f3ead9');assert.equal(wall.material.bumpScale,.005);assert.equal(wall.material.roughness,.79);assert.equal(post.material.bumpScale,.012);
 assert.equal(post.geometry.userData.shopStyleRoundedWood,true);const p=post.geometry.attributes.position,b=post.geometry.boundingBox,corner=new THREE.Vector3(b.max.x,b.max.y,b.max.z);let nearest=Infinity;
 for(let i=0;i<p.count;i++)nearest=Math.min(nearest,new THREE.Vector3().fromBufferAttribute(p,i).distanceTo(corner));assert.ok(nearest>.004,'actual wood corners are cut back, not only relabelled');
 home.traverse(m=>{if(m.name==='overlapping-round-roof-tile'){assert.equal(m.scale.y,.037);assert.equal(m.material.bumpScale,.003);assert.equal(m.material.roughness,.46);}});
});
await check('larger closed scroll and its raised spiral actually join the wooden fascia inside the prior envelope',()=>{
 const cap=named('cottage-rounded-wood-ridge-cap'),spiral=named('cottage-ridge-scroll-relief'),fascia=home.children.find(m=>m.name==='cottage-curved-wood-fascia'&&m.position.z>0);assert.ok(fascia);
 facts.scrollJoins=[witness(cap,fascia,[0,2.56,dimensions.depth/2+.17])];const t=3/32,a=Math.PI*(.45+1.7*t),r=.061-.043*t;
 facts.scrollJoins.push(witness(cap,spiral,[.012+Math.cos(a)*r,2.515+.022+Math.sin(a)*r,dimensions.depth/2+.195]));
 const start=source.indexOf("        var fountain=new THREE.Group();fountain.name="),end=source.indexOf('      } else {',start);assert.equal(hash(source.slice(start,end)),'c38042dd241cb990e6a20b2fc4a3fb7b9ab703fedc27f814afa1b4bfd5a623a9','PR125 fountain block is byte-identical');
});
await check('new shared roundovers and building-only materials are released exactly once',()=>{
 const resources=new Set([...model.geometries].filter(g=>g.userData.shopStyleRoundedWood).concat([...model.materials].filter(m=>m.userData.shopStyleFinish))),counts=new Map();assert.ok(resources.size>=20);
 for(const r of resources)r.addEventListener('dispose',()=>counts.set(r,(counts.get(r)||0)+1));model.dispose();model.dispose();for(const r of resources)assert.equal(counts.get(r),1);
});
assert.equal(passed.length,15,'Every test callback must finish successfully');facts.total_unique_tests=passed.length;facts.native_render='parent-owned and separately recorded';facts.character_body_binding=null;facts.door_traversal_adoption=false;facts.physics=false;facts.ownership_save=false;
globalThis.__petHouseFacts=facts;
export {facts};

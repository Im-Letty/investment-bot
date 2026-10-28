import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../static/vendor/three-0.160.1.module.js';
import Ground from '../static/pet-town-ground-finish.js';
import Seasons from '../static/pet-japan-seasons.js';
import Scene from '../static/pet-town-scene.js';
import Town from '../static/pet-town-walk.js';

function documentFixture(){
 const canvases=[];
 return {canvases,createElement(tag){assert.equal(tag,'canvas');const c={width:0,height:0,colors:[],pixels:null};
  const ctx={fillStyle:'',fillRect(){c.colors.push(this.fillStyle);},createImageData(w,h){return {width:w,height:h,data:new Uint8ClampedArray(w*h*4)};},putImageData(image){c.pixels=image.data;}};
  c.getContext=type=>type==='2d'?ctx:null;canvases.push(c);return c;
 }};
}
function provider(overrides={}){const materials=new Set(),textures=new Set(),doc=documentFixture();return {materials,textures,doc,api:Ground.create(T,{doc,materials,textures,...overrides})};}
function release(f){for(const r of new Set([...f.materials,...f.textures]))r.dispose();}
function meshRows(m,names){const rows=[];m.scene.updateMatrixWorld(true);m.scene.traverse(o=>{if(o.isMesh&&names.has(o.name))rows.push(o);});return rows;}
function closedVolume(g){
 const p=g.attributes.position,index=g.index,edges=new Map();let volume=0;
 for(let i=0;i<(index?index.count:p.count);i+=3){const v=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(p,index?index.getX(i+k):i+k));
  const keys=v.map(q=>q.toArray().map(n=>Math.round(n*1e6)).join(':'));assert.equal(new Set(keys).size,3);
  for(let e=0;e<3;e++){const a=keys[e],b=keys[(e+1)%3],key=[a,b].sort().join('/'),row=edges.get(key)||{count:0,balance:0};row.count++;row.balance+=a<b?1:-1;edges.set(key,row);}
  assert.ok(new T.Vector3().subVectors(v[1],v[0]).cross(new T.Vector3().subVectors(v[2],v[0])).lengthSq()>1e-20);
  volume+=v[0].dot(new T.Vector3().crossVectors(v[1],v[2]))/6;
 }
 for(const e of edges.values()){assert.equal(e.count,2);assert.equal(e.balance,0);}assert.ok(volume>1e-8);
}

test('all four layered moss and curved-grass maps retain the exact seasonal mean without a screen wash',()=>{
 const before=JSON.stringify(['spring','summer','autumn','winter'].map(k=>Seasons.profile(k)));
 for(const key of ['spring','summer','autumn','winter']){
  const doc=documentFixture(),p=Seasons.profile(key),texture=Ground.groundTexture(T,doc,p),image=texture.image;
  assert.equal(image.width,512);assert.equal(image.height,512);assert.equal(image.colors[0],p.ground);
  assert.equal(texture.colorSpace,T.SRGBColorSpace);assert.equal(texture.wrapS,T.RepeatWrapping);assert.equal(texture.userData.screenOverlay,false);
  const base=[1,3,5].map(i=>parseInt(p.ground.slice(i,i+2),16)),sum=[0,0,0],mins=[255,255,255],maxs=[0,0,0];
  for(let i=0;i<image.pixels.length;i+=4){assert.equal(image.pixels[i+3],255);for(let c=0;c<3;c++){const v=image.pixels[i+c];assert.ok(Math.abs(v-base[c])<=19);sum[c]+=v;mins[c]=Math.min(mins[c],v);maxs[c]=Math.max(maxs[c],v);}}
  for(let c=0;c<3;c++){assert.ok(Math.abs(sum[c]/(512*512)-base[c])<.01);assert.ok(maxs[c]-mins[c]>=22);}
  texture.dispose();
 }
 assert.equal(JSON.stringify(['spring','summer','autumn','winter'].map(k=>Seasons.profile(k))),before);
});

test('layered ground is deterministic and opposite tile-edge texels are byte-identical',()=>{
 const a=Ground.groundTexture(T,documentFixture(),'summer'),b=Ground.groundTexture(T,documentFixture(),'summer');
 assert.deepEqual(a.image.pixels,b.image.pixels);const data=a.image.pixels;
 for(let k=0;k<512;k++)for(let c=0;c<3;c++){
  assert.equal(data[(k*512)*4+c],data[(k*512+511)*4+c]);
  assert.equal(data[k*4+c],data[(511*512+k)*4+c]);
 }
 a.dispose();b.dispose();
});

test('local ivory paths and house-like wood finishes share only their two caller-owned maps',()=>{
 const calls=[],wood=new T.DataTexture(new Uint8Array([250,250,250,255]),1,1),stone=new T.DataTexture(new Uint8Array([248,248,248,255]),1,1);
 const f=provider({surfaceMap(kind){calls.push(kind);return kind==='wood'?wood:stone;}});
 try{
  const path=f.api.material('#e4cfa6','layout-path'),timber=f.api.material('#d5ad79','wood'),rock=f.api.material('#dfd1b5','stone');
  assert.equal(path.color.getHexString(),'eadcc3');assert.equal(path.bumpScale,.008);assert.equal(timber.roughness,.64);assert.equal(timber.bumpScale,.020);
  assert.equal(path.map,path.bumpMap);assert.equal(path.map,rock.map);assert.equal(path.map,stone);assert.equal(timber.map,wood);
  assert.equal(f.api.material('#e4cfa6','layout-path'),path);assert.deepEqual(calls,['stone','wood']);assert.equal(f.materials.size,3);assert.equal(f.textures.size,2);
  assert.equal(f.api.summary().allocatedTextures,0);assert.equal(f.api.summary().geometryAllocations,0);assert.equal(f.api.summary().resourceOwner,'scene');
  for(const m of f.materials){assert.equal(m.userData.environmentRevision,'shop-environment2');assert.equal(m.userData.paletteRole,'identity');assert.equal(m.metalness,0);}
 }finally{release(f);}
});

test('opt-in outdoor finishes share three bounded neutral maps and preserve existing material identity and ownership',()=>{
 const f=provider({localSurfaces:true}),counts=new Map();
 const external=new T.MeshStandardMaterial({color:'#8d6949',transparent:true,opacity:.63,depthWrite:false,emissive:'#130b05'});
 external.userData={seasonRole:'accent',baseColor:'#8d6949',custom:'preserve'};f.materials.add(external);
 const identity={color:external.color.getHexString(),emissive:external.emissive.getHexString(),opacity:external.opacity,
  transparent:external.transparent,depthWrite:external.depthWrite,side:external.side};
 f.api.material('#d5ad79','wood');f.api.material('#bd8d58','wood');f.api.material('#e4cfa6','layout-path');
 f.api.material('#dfd1b5','stone');const wall=f.api.material('#f3ead9','plaster'),glaze=f.api.material('#ad8fbe','glaze');
 f.api.applyTo(external,'wood');
 assert.deepEqual({color:external.color.getHexString(),emissive:external.emissive.getHexString(),opacity:external.opacity,
  transparent:external.transparent,depthWrite:external.depthWrite,side:external.side},identity);
 assert.equal(external.userData.seasonRole,'accent');assert.equal(external.userData.baseColor,'#8d6949');
 assert.equal(external.userData.custom,'preserve');assert.equal(wall.map,glaze.map);
 assert.equal(f.api.summary().allocatedTextures,3);assert.equal(f.textures.size,3);assert.equal(f.doc.canvases.length,3);
 assert.equal(f.api.summary().materials,6,'applying to an existing material does not allocate an owned material');
 for(const t of f.textures){
  assert.equal(t.image.width,128);assert.equal(t.image.height,128);assert.equal(t.colorSpace,T.NoColorSpace);
  const pixels=t.image.pixels;let low=255,high=0;
  for(let i=0;i<pixels.length;i+=4){assert.equal(pixels[i],pixels[i+1]);assert.equal(pixels[i+1],pixels[i+2]);assert.equal(pixels[i+3],255);low=Math.min(low,pixels[i]);high=Math.max(high,pixels[i]);}
  assert.ok(low>=210&&high<=255&&high-low>=6);
  for(let i=0;i<128;i++){assert.equal(pixels[i*128*4],pixels[(i*128+127)*4]);assert.equal(pixels[i*4],pixels[(127*128+i)*4]);}
 }
 const ground=new T.MeshStandardMaterial({color:'#ffffff'}),season=Ground.groundTexture(T,documentFixture(),'winter');
 ground.userData.seasonRole='ground';ground.userData.baseColor='#ffffff';f.materials.add(ground);f.textures.add(season);
 f.api.applyGround(ground,season);assert.equal(ground.map,season);assert.equal(ground.bumpMap,season);
 assert.equal(ground.displacementMap,null);assert.equal(ground.bumpScale,.012);assert.equal(ground.roughness,.92);
 assert.equal(ground.userData.seasonRole,'ground');assert.equal(ground.userData.baseColor,'#ffffff');
 f.api.applyGround(ground,null);assert.equal(ground.map,null);assert.equal(ground.bumpMap,null);assert.equal(ground.bumpScale,0);
 for(const r of [...f.materials,...f.textures]){counts.set(r,0);r.addEventListener('dispose',()=>counts.set(r,counts.get(r)+1));}
 assert.equal(f.api.dispose,undefined);release(f);for(const n of counts.values())assert.equal(n,1);
});

test('invalid input fails before allocation and the local material cache has an explicit finite cap',()=>{
 let allocations=0;class CountingMaterial extends T.MeshStandardMaterial{constructor(...args){super(...args);allocations++;}}
 assert.throws(()=>Ground.create({...T,MeshStandardMaterial:CountingMaterial},{}),/ground_finish_context_invalid/);assert.equal(allocations,0);
 const materials=new Set(),textures=new Set(),p=Ground.create({...T,MeshStandardMaterial:CountingMaterial},{materials,textures});
 assert.throws(()=>p.material('invalid','wood'),/ground_finish_material_invalid/);assert.throws(()=>p.material('#d5ad79','water'),/ground_finish_material_invalid/);assert.equal(allocations,0);
 const candidate=new T.MeshStandardMaterial();try{
  assert.throws(()=>p.applyTo(candidate,'constructor'),/ground_finish_material_invalid/);
  assert.throws(()=>p.applyGround(candidate,{}),/ground_finish_ground_material_invalid/);
 }finally{candidate.dispose();}
 for(let i=0;i<16;i++)p.material('#'+(0x101010+i).toString(16),'wood');assert.equal(materials.size,16);
 assert.throws(()=>p.material('#202020','wood'),/ground_finish_material_limit/);assert.equal(allocations,16);assert.equal(materials.size,16);
 for(const m of materials)m.dispose();let canvases=0;
 assert.throws(()=>Ground.groundTexture(T,{createElement(){canvases++;}},'unknown'),/ground_finish_profile_invalid/);assert.equal(canvases,0);
 assert.equal(Ground.groundTexture(T,null,'spring'),null);
});

test('actual ribbons have finite world-scale UVs while the 2154 paving triangles and exact bridge deck remain unchanged',()=>{
 const world=Town.createWorld(),saved=JSON.stringify(world),m=Scene.buildWorld(T,world,{});
 try{
  let triangles=0;const names=new Set(['layout-plaza-border','layout-plaza-floor','layout-plaza-border-paver','layout-curved-path-edge','layout-curved-cream-path','layout-porch-cream-connector','bridge-deck']);
  for(const o of meshRows(m,names)){const p=o.geometry.attributes.position,uv=o.geometry.attributes.uv;assert.ok(uv);assert.equal(uv.count,p.count);for(const n of uv.array)assert.ok(Number.isFinite(n));triangles+=(o.geometry.index?o.geometry.index.count:p.count)/3;
   if(/^layout-curved|^layout-porch/.test(o.name))for(let i=0;i<p.count;i++){assert.ok(Math.abs(uv.getX(i)-p.getX(i)*.75)<1e-6);assert.ok(Math.abs(uv.getY(i)-p.getZ(i)*.75)<1e-6);}
  }
  assert.equal(triangles,2154);const deck=m.scene.getObjectByName('bridge-deck');assert.equal(deck.userData.layoutBoardCount,11);assert.equal(deck.userData.walkTop,.19);assert.equal(deck.geometry.groups.length,11);
  assert.equal(JSON.stringify(world),saved);assert.equal(m.scene.userData.environmentStyleRevision,'shop-environment2');
 }finally{m.dispose();}
});

test('four new rounded wood dimensions cut corners inside the exact previous post and rail boxes',()=>{
 const m=Scene.buildWorld(T,Town.createWorld(),{}),names=new Set(['layout-bridge-rounded-post','layout-fence-rounded-post','layout-fence-horizontal-rail']);
 try{
  const meshes=meshRows(m,names),geometries=new Set(meshes.map(o=>o.geometry));assert.equal(geometries.size,4);assert.equal(meshes.length,34);
  for(const g of geometries){closedVolume(g);assert.equal(g.userData.shopStyleRoundedWood,true);assert.ok(g.userData.roundoverRadius>0);g.computeBoundingBox();const b=g.boundingBox,p=g.attributes.position,n=g.attributes.normal,corner=new T.Vector3(b.max.x,b.max.y,b.max.z);let nearest=Infinity;
   for(let i=0;i<p.count;i++){const v=new T.Vector3().fromBufferAttribute(p,i);assert.ok(b.containsPoint(v));nearest=Math.min(nearest,v.distanceTo(corner));assert.ok(Math.abs(new T.Vector3().fromBufferAttribute(n,i).length()-1)<1e-5);}
   assert.ok(nearest>.003,'the old sharp corner is truly removed');
  }
  assert.equal(m.geometries.size,177);assert.ok(m.materials.size<=148);assert.ok(m.batches.length+m.meadowLife.batches.length<=120);
 }finally{m.dispose();}
});

test('all three finishes preserve completed buildings, rooted flowers and current collisions across four seasons',()=>{
 const world=Town.createWorld(),before=JSON.stringify(world),m=Scene.buildWorld(T,world,{}),geo=[...m.geometries],materials=[...m.materials];
 const poses=m.placeGroups.map(g=>g.matrixWorld.toArray()),sites=JSON.stringify(m.scene.userData.meadowFlowers.sitePlan),collisions=world.places.map(p=>Town.collisionBounds(p)),meadowTriangles=m.meadowLife.summary().triangles;
 try{for(const key of ['spring','summer','autumn','winter']){m.setSeason(key);m.animate(1000,false);m.animate(2000,true);
  assert.deepEqual([...m.geometries],geo);assert.deepEqual([...m.materials],materials);assert.deepEqual(m.placeGroups.map(g=>g.matrixWorld.toArray()),poses);assert.equal(JSON.stringify(m.scene.userData.meadowFlowers.sitePlan),sites);assert.deepEqual(world.places.map(p=>Town.collisionBounds(p)),collisions);
 }
 assert.equal(m.scene.userData.shopStyleRevision,'shop-style1');assert.equal(m.scene.userData.fountainReferenceRevision,'fountain-reference1');assert.equal(m.meadowLife.summary().triangles,meadowTriangles);assert.ok(meadowTriangles<=45000);assert.equal(JSON.stringify(world),before);
 }finally{m.dispose();}
});

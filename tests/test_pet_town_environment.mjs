import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import * as T from '../static/vendor/three-0.160.1.module.js';
import Env from '../static/pet-town-environment.js';import Seasons from '../static/pet-japan-seasons.js';
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<=e,a+' != '+b);
function fixture(){const group=new T.Group(),sentinel=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial({color:'#ae8bc5'}));group.add(sentinel);
 const geometries=new Set(),materials=new Set(),textures=new Set(),ctx={group,geometries,materials,textures,seasonProfile:Seasons.profile('autumn')};
 const helper=Env.create(T,ctx);return{group,sentinel,geometries,materials,textures,helper};}
function release(f){f.helper.dispose();for(const g of f.geometries)g.dispose();for(const m of f.materials)m.dispose();f.sentinel.geometry.dispose();f.sentinel.material.dispose();}
test('portable API is deterministic without timers, randomness or I/O',()=>{
 const guarded=Object.create(Math);guarded.random=()=>{throw Error('random')};const c={Math:guarded,Date:class{constructor(){throw Error('clock')}}};vm.runInNewContext(fs.readFileSync(new URL('../static/pet-town-environment.js',import.meta.url),'utf8'),c);
 assert.equal(c.PetTownEnvironment.revision,'shop-environment2');assert.ok(Object.isFrozen(Env));assert.equal(Env.profile(Seasons.profile('spring')).sky,'#a1c9d6');assert.ok(Object.isFrozen(Env.profile(Seasons.profile('spring')).hills));
});
test('one normalized irregular geometry is closed, outward, smooth and bounded by the old sphere',()=>{
 const g=Env.hillGeometry(T);try{const p=g.attributes.position,n=g.attributes.normal,idx=g.index,edges=new Map(),normals=new Map(),pigment=g.attributes.color;let volume=0,different=0;
 for(let i=0;i<p.count;i++){const v=new T.Vector3().fromBufferAttribute(p,i),nn=new T.Vector3().fromBufferAttribute(n,i);assert.ok(v.toArray().every(Number.isFinite));near(nn.length(),1);assert.ok(v.length()<=1+1e-6);
 const key=v.toArray().map(x=>Math.round(x*1e6)).join(':');if(normals.has(key))assert.ok(nn.distanceTo(normals.get(key))<1e-6);else normals.set(key,nn);if(Math.abs(v.length()-1)>.005)different++;}
 assert.ok(different>100,'actual vertex shoulders differ from a plain sphere');
 assert.equal(pigment.count,p.count);let pigmentLow=1,pigmentHigh=0;const pigmentAt=new Map();
 for(let i=0;i<pigment.count;i++){const rgb=[pigment.getX(i),pigment.getY(i),pigment.getZ(i)];for(const n of rgb){assert.ok(Number.isFinite(n)&&n>=.72-1e-6&&n<=1.04+1e-6);pigmentLow=Math.min(pigmentLow,n);pigmentHigh=Math.max(pigmentHigh,n);}
  const key=[p.getX(i),p.getY(i),p.getZ(i)].map(n=>Math.round(n*1e6)).join(':');if(pigmentAt.has(key))for(let c=0;c<3;c++)near(rgb[c],pigmentAt.get(key)[c]);else pigmentAt.set(key,rgb);}
 assert.ok(pigmentHigh-pigmentLow>.12,'surface has actual bounded pigment depth without a new texture');
 for(let i=0;i<idx.count;i+=3){const ids=[idx.getX(i),idx.getX(i+1),idx.getX(i+2)],vs=ids.map(j=>new T.Vector3().fromBufferAttribute(p,j)),face=vs[1].clone().sub(vs[0]).cross(vs[2].clone().sub(vs[0]));
 assert.ok(face.length()>1e-9);const avg=ids.reduce((sum,j)=>sum.add(new T.Vector3().fromBufferAttribute(n,j)),new T.Vector3());assert.ok(face.dot(avg)>0);volume+=vs[0].dot(vs[1].clone().cross(vs[2]))/6;
 for(let j=0;j<3;j++){const a=vs[j].toArray().map(x=>Math.round(x*1e6)).join(':'),b=vs[(j+1)%3].toArray().map(x=>Math.round(x*1e6)).join(':'),key=a<b?a+'|'+b:b+'|'+a;const row=edges.get(key)||[0,0];row[0]++;row[1]+=a<b?1:-1;edges.set(key,row);}}
 assert.ok(volume>3&&volume<4.2);for(const [count,orientation]of edges.values()){assert.equal(count,2);assert.equal(orientation,0);}
 for(const k of ['x','y','z']){near(g.boundingBox.min[k],-1);near(g.boundingBox.max[k],1);}
 }finally{g.dispose();}
});
test('twelve actual world hills retain old centers, scales and envelopes with no walk-map overlap',()=>{
 const f=fixture();try{assert.equal(f.helper.hills.length,12);assert.equal(f.geometries.size,1);assert.equal(f.materials.size,3);assert.equal(f.textures.size,0);const expected=[];
 for(let i=0;i<7;i++){expected.push({center:[-16+i*5,-.6,-14.5],scale:[3.2,1.4,3.2]});if(i<5)expected.push({center:[-16+i*4.5,-.7,14.5],scale:[3,1.3,3]});}
 f.group.updateMatrixWorld(true);for(const [i,hill]of f.helper.hills.entries()){assert.deepEqual(hill.position.toArray(),expected[i].center);assert.deepEqual(hill.scale.toArray(),expected[i].scale);assert.equal(hill.userData.nonSolidDecoration,true);assert.equal(hill.castShadow,false);
 const box=new T.Box3().setFromObject(hill);for(let axis=0;axis<3;axis++){const k=['x','y','z'][axis];near(box.min[k],expected[i].center[axis]-expected[i].scale[axis]);near(box.max[k],expected[i].center[axis]+expected[i].scale[axis]);}
 assert.ok(box.max.z<-9.6||box.min.z>9.6,'entire hill remains outside the current walk-map');}
 }finally{release(f);}
});
test('four seasonal changes recolor only the three dedicated materials, with stable resources and transforms',()=>{
 const group=new T.Group(),wallMaterial=new T.MeshStandardMaterial({color:'#f3ead9'}),plantMaterial=new T.MeshStandardMaterial({color:'#fff1d9'});
 const wall=new T.Mesh(new T.BoxGeometry(),wallMaterial),plant=new T.Mesh(new T.SphereGeometry(),plantMaterial);group.add(wall,plant);
 const scene=new T.Scene(),light=new T.HemisphereLight('#eaf1fb','#ddd8d1',1.6),sun=new T.DirectionalLight('#fff4e7',2.1);sun.position.set(-7,12,8);scene.background=new T.Color('#123456');scene.fog=null;scene.add(group,light,sun);
 const renderer={toneMappingExposure:1,toneMapping:T.NoToneMapping},ctx={group,scene,renderer,geometries:new Set(),materials:new Set(),textures:new Set(),seasonProfile:Seasons.profile('autumn')};
 const noNewLights={...T,HemisphereLight:class{constructor(){throw Error('extra hemisphere')}},DirectionalLight:class{constructor(){throw Error('extra sun')}}},helper=Env.create(noNewLights,ctx);
 try{group.updateMatrixWorld(true);const poses=helper.hills.map(m=>m.matrixWorld.toArray()),geometry=[...ctx.geometries],material=[...ctx.materials],foreign=[wallMaterial.color.getHex(),plantMaterial.color.getHex()],lighting=JSON.stringify([light.toJSON(),sun.toJSON()]);
 for(const season of ['spring','summer','autumn','winter']){const input=Seasons.profile(season),snapshot=JSON.stringify(input);assert.equal(helper.setSeason(input),true);group.updateMatrixWorld(true);assert.equal(JSON.stringify(input),snapshot);assert.deepEqual([...ctx.geometries],geometry);assert.deepEqual([...ctx.materials],material);
 for(const m of material){assert.equal(m.userData.surfaceRole,'environment-hill');assert.equal(m.userData.seasonRole,undefined);assert.equal(m.color.getHexString(),Env.profile(input).hills[m.userData.environmentColorIndex].slice(1));assert.equal(m.map,null);assert.equal(m.bumpMap,null);assert.equal(m.vertexColors,true);assert.equal(m.roughness,.86);}
 assert.deepEqual(helper.hills.map(m=>m.matrixWorld.toArray()),poses);assert.deepEqual([wallMaterial.color.getHex(),plantMaterial.color.getHex()],foreign);assert.equal(JSON.stringify([light.toJSON(),sun.toJSON()]),lighting);assert.equal(scene.background.getHexString(),'123456');assert.equal(scene.fog,null);assert.deepEqual(renderer,{toneMappingExposure:1,toneMapping:T.NoToneMapping});assert.equal(ctx.textures.size,0);
 for(const h of helper.hills){const box=new T.Box3().setFromObject(h),e=h.userData.originalEnvelope;for(let axis=0;axis<3;axis++){const k=['x','y','z'][axis];near(box.min[k],e.center[axis]-e.scale[axis]);near(box.max[k],e.center[axis]+e.scale[axis]);}}}
 const colors=material.map(m=>m.color.getHex());assert.throws(()=>helper.setSeason({sky:'bad'}),/environment_profile_invalid/);assert.deepEqual(material.map(m=>m.color.getHex()),colors);assert.equal(helper.summary().lights,0);
 }finally{helper.dispose();for(const g of ctx.geometries)g.dispose();for(const m of ctx.materials)m.dispose();wall.geometry.dispose();plant.geometry.dispose();wallMaterial.dispose();plantMaterial.dispose();}
});
test('sky fallback is background-only512x256 SRGB and returns independent Scene-owned textures',()=>{
 const stops=[],canvases=[],doc={createElement(tag){assert.equal(tag,'canvas');const canvas={width:0,height:0,getContext(){return{createLinearGradient(...args){assert.deepEqual(args,[0,0,0,256]);return{addColorStop(t,c){stops.push([t,c]);}}},fillRect(...args){assert.deepEqual(args,[0,0,512,256]);}}}};canvases.push(canvas);return canvas;}};
 const textures=[];try{for(const season of ['spring','summer','autumn','winter']){const texture=Env.skyTexture(T,doc,Seasons.profile(season));textures.push(texture);assert.equal(texture.image.width,512);assert.equal(texture.image.height,256);assert.equal(texture.userData.cloudBanks,0);assert.equal(texture.userData.paintMode,'gradient-fallback');assert.equal(texture.colorSpace,T.SRGBColorSpace);assert.equal(texture.mapping,T.EquirectangularReflectionMapping);assert.equal(texture.userData.presentationRole,'bounded-seasonal-sky-background');assert.equal(texture.userData.environmentSeason,season);}
 assert.equal(new Set(textures).size,4);assert.equal(stops.length,20);assert.ok(stops.every(([t,c])=>t>=0&&t<=1&&/^#[a-f0-9]{6}$/.test(c)));assert.equal(Env.skyTexture(T,null,Seasons.profile('spring')),null);assert.equal(Env.skyTexture(T,{createElement(){return{getContext(){return null}}}},Seasons.profile('spring')),null);
 const legacy=Env.skyTexture(T,doc,{sky:'#cbe7e8'});assert.equal(legacy.userData.environmentSeason,'custom');textures.push(legacy);
 }finally{for(const texture of textures)texture.dispose();}
});
test('opaque painted sky has soft cloud detail, exact panorama seams, stable seasonal identity and bounded texture memory',()=>{
 function doc(){return{createElement(){const canvas={width:0,height:0,pixels:null};canvas.getContext=()=>({createImageData(w,h){return{data:new Uint8ClampedArray(w*h*4)};},putImageData(image){canvas.pixels=image.data;}});return canvas;}};}
 const textures=[],saved=JSON.stringify(Seasons.profiles);
 try{for(const key of ['spring','summer','autumn','winter']){
  const a=Env.skyTexture(T,doc(),Seasons.profile(key)),b=Env.skyTexture(T,doc(),Seasons.profile(key));textures.push(a,b);
  const pixels=a.image.pixels;assert.deepEqual(pixels,b.image.pixels);assert.equal(pixels.length,512*256*4);assert.equal(a.userData.textureBytes,524288);assert.equal(a.userData.cloudBanks,4);assert.equal(a.userData.paintMode,'periodic-layered-cloud-pigment');
  assert.equal(a.wrapS,T.RepeatWrapping);assert.equal(a.wrapT,T.ClampToEdgeWrapping);
  for(let y=0;y<256;y++)for(let channel=0;channel<3;channel++)assert.equal(pixels[(y*512)*4+channel],pixels[(y*512+511)*4+channel],'panorama seam remains exact');
  let widest=0;for(let y=72;y<133;y++){let lo=255,hi=0;for(let x=0;x<512;x++){const at=(y*512+x)*4;lo=Math.min(lo,pixels[at]);hi=Math.max(hi,pixels[at]);}widest=Math.max(widest,hi-lo);}
  assert.ok(widest>=10&&widest<50,'horizontal cloud variation is visible but bounded instead of a global veil');
  for(let i=3;i<pixels.length;i+=4)assert.equal(pixels[i],255);
  const horizon=Env.profile(Seasons.profile(key)).horizon;for(let channel=0;channel<3;channel++)assert.equal(pixels[((256-1)*512)*4+channel],parseInt(horizon.slice(1+channel*2,3+channel*2),16));
 }assert.equal(JSON.stringify(Seasons.profiles),saved);assert.equal(Env.limits.skyTextureBytes,524288);
 }finally{for(const t of textures)t.dispose();}
});
test('dispose is idempotent, detaches only its root, and leaves all registered resources to Scene',()=>{
 const f=fixture(),counts=new Map([...f.geometries,...f.materials].map(r=>[r,0]));for(const r of counts.keys())r.addEventListener('dispose',()=>counts.set(r,counts.get(r)+1));
 assert.equal(f.helper.dispose(),true);assert.equal(f.helper.dispose(),false);assert.deepEqual(f.group.children,[f.sentinel]);assert.equal(f.helper.setSeason(Seasons.profile('spring')),false);for(const n of counts.values())assert.equal(n,0);
 for(const r of counts.keys())r.dispose();for(const n of counts.values())assert.equal(n,1);f.sentinel.geometry.dispose();f.sentinel.material.dispose();
});
test('invalid profiles and contexts fail before attaching or allocating registered resources',()=>{
 for(const value of [null,{}, {sky:'url(secret)'},{sky:'#abc'},{sky:'#123456',hills:['#123456']}])assert.throws(()=>Env.profile(value),/environment_profile_invalid/);
 const ctx={group:new T.Group(),geometries:new Set(),materials:new Set(),seasonProfile:{sky:'bad'}};assert.throws(()=>Env.create(T,ctx),/environment_profile_invalid/);assert.equal(ctx.group.children.length,0);assert.equal(ctx.geometries.size,0);assert.equal(ctx.materials.size,0);assert.throws(()=>Env.create(T,{}),/environment_context_invalid/);
});

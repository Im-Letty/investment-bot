import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import * as T from '../static/vendor/three-0.160.1.module.js';
import {build,spec} from '../static/pet-autumn-market-pear-tree-proof-20261031/pear-tree.mjs';
import {finiteAudit,inspectBuffers,geometryIdentity,pearProfileAudit,curvedSectionAudit,gapAudit,occupiedChord,rootCapAudit,diagnosticFloorPairs} from '../static/pet-autumn-market-pear-tree-proof-20261031/audit.mjs';
import {fitPearTreeView,authoredBoundsArrays} from '../static/pet-autumn-market-pear-tree-proof-20261031/framing.mjs';
import {placeAndProbe,anchor} from '../static/pet-autumn-market-pear-tree-proof-20261031/placement.mjs';
import {fitView as rawFitView} from '../static/pet-scalloped-path-proof-20261027/framing.mjs';
import {inspectTopology,inspectCrossings,inspectFaceNormalAgreement} from '../static/pet-breeze-cape-proof-20261029/geometry-audit.mjs';
import {independentPointAudit} from '../static/pet-breeze-cape-proof-20261029/audit.mjs';
import {startPreview,failureDetails} from '../static/pet-autumn-market-pear-tree-proof-20261031/entry.mjs';

const root=new URL('../',import.meta.url),H=new URL('../../',import.meta.url),dir=new URL('../static/pet-autumn-market-pear-tree-proof-20261031/',import.meta.url);
const read=n=>fs.readFileSync(new URL(n,dir)),json=n=>JSON.parse(read(n)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const m=build(T),a=finiteAudit(T,m),cert=json('finite-geometry-certificate.json');
after(()=>m.dispose());
function fingerprint(g){
  const p=g.attributes.position,i=g.index,layout=Buffer.from(JSON.stringify({positionType:p.array.constructor.name,positionItemSize:p.itemSize,positionCount:p.count,indexType:i.array.constructor.name,indexItemSize:i.itemSize,indexCount:i.count}));
  return sha(Buffer.concat([layout,Buffer.from(p.array.buffer,p.array.byteOffset,p.array.byteLength),Buffer.from(i.array.buffer,i.array.byteOffset,i.array.byteLength)]));
}
function currentWorld(){
  const ctx=vm.createContext({console:{warn(){},error(){},log(){}},setTimeout,clearTimeout});ctx.window=ctx;
  for(const[,p]of read('viewer.mjs').toString().matchAll(/import\s+'(\/static\/[^']+)'/g))vm.runInContext(fs.readFileSync(new URL(p.slice(1),root),'utf8'),ctx,{filename:p});
  const world=ctx.PetTownWalk.createWorld(),scene=ctx.PetTownScene.buildWorld(T,world,{},null,null,'autumn');
  return{ctx,world,scene};
}

test('actual owned reservation, post-reserve originals and final source bindings describe exactly one new standalone tree',()=>{
  const input=json('input-manifest.json'),specification=json('SPEC.json'),reserve=JSON.parse(fs.readFileSync(new URL('owned-parent-reservation-readback.json',H))),view=JSON.parse(fs.readFileSync(new URL('author-reference-view-after-reserve.json',H)));
  assert.equal(reserve.actual_lease.run_id,'automation360-20261031-171339');assert.deepEqual(reserve.actual_lease.units,[spec.unit_id]);assert.equal(reserve.shared_append_preceded_reserve,true);
  assert.equal(view.both_actual_view_image_calls_after_owned_reserve_and_before_new_model_source_authored,true);
  assert.equal(input.unit_id,spec.unit_id);assert.equal(input.model_id,spec.id);assert.equal(specification.authored_after_actual_parent_reserve,true);
  assert.equal(input.actual_parent_reserve.sha256,sha(fs.readFileSync(new URL('owned-parent-reservation-readback.json',H))));
  for(const[name,q]of Object.entries(input.artifacts)){const bytes=read(name);assert.equal(bytes.length,q.bytes);assert.equal(sha(bytes),q.sha256);assert(!bytes.includes(Buffer.from('/'+'Users'+'/')));}
  assert.equal(Object.keys(input.unchanged_dependencies).length,39);
  for(const[name,q]of Object.entries(input.unchanged_dependencies)){const b=fs.readFileSync(new URL(name,root));assert.equal(sha(b),q.sha256);assert.equal(b.length,q.bytes);}
  assert.equal(input.style_originals.length,2);
  for(const q of input.style_originals){assert.equal(q.actual_author_view_image,true);assert.equal(sha(fs.readFileSync(new URL(q.path,root))),q.sha256);}
  assert.equal(input.formal_test_source.actual_unique_definitions,18);assert.equal(input.formal_test_source.sha256,sha(fs.readFileSync(fileURL())));
  assert.equal(cert.formal_TAP_pass_claimed_by_compiler,false);
});
function fileURL(){return new URL(import.meta.url);}

test('every actual solid has finite indexed buffers, positive closed material, outward normals and finite positive transforms',()=>{
  assert.equal(a.pass,true);assert.equal(a.parts,71);assert.equal(a.triangles,27376);
  for(const q of a.topology){assert(q.buffers.valid);assert(q.closedEdges);assert.equal(q.badEdges,0);assert.equal(q.degenerateTriangles,0);assert.equal(q.invalidNormals,0);assert(q.signedVolume>0);assert.equal(q.normals.nonpositiveFaces,0);}
  assert.equal(a.transformsFinitePositive,true);
});

test('an actually unused NaN vertex, invalid indices, missing normals and a removed face fail the real solid criteria',()=>{
  const source=m.base.geometry,g=source.clone(),p=g.attributes.position,n=g.attributes.normal,index=Array.from(g.index.array),positions=[...p.array,NaN,0,0],normals=[...n.array,0,1,0];
  g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));
  assert(!index.includes(g.attributes.position.count-1));assert.deepEqual(Array.from(g.index.array),index);assert.deepEqual(inspectBuffers(g).errors,['position']);g.dispose();
  const fractional=source.clone();fractional.setIndex(new T.BufferAttribute(Float32Array.from(index),1));fractional.index.array[0]=.5;assert(inspectBuffers(fractional).errors.includes('index'));fractional.dispose();
  const range=source.clone();range.index.array[0]=range.attributes.position.count;assert(inspectBuffers(range).errors.includes('index'));range.dispose();
  const missing=source.clone();missing.deleteAttribute('normal');assert(inspectBuffers(missing).errors.includes('normal'));missing.dispose();
  const hole=source.clone();hole.setIndex(index.slice(3));assert.equal(inspectTopology(T,hole).closedEdges,false);hole.dispose();
});

test('all actual geometry objects have zero strict self-crossings and a genuine crossing-triangle control is detected',()=>{
  assert.equal(a.crossings.length,m.resources.geometries.length);
  for(const q of a.crossings)assert.equal(q.strictEdgeInteriorCrossings,0);
  const bad=new T.BufferGeometry();bad.setAttribute('position',new T.Float32BufferAttribute([-1,-1,0,1,-1,0,0,1,0,-.5,0,-.7,.5,0,.7,.5,.5,-.7],3));bad.setIndex([0,1,2,3,4,5]);bad.computeVertexNormals();
  assert(inspectCrossings(T,bad).strictEdgeInteriorCrossings>0);bad.dispose();
});

test('82 independently checked material witnesses connect all71 parts and a displaced pear loses its actual stem joint',()=>{
  assert.equal(a.contacts.length,82);assert.equal(a.connectedParts,71);
  for(const q of a.contacts){assert(q.partAudit.strictInside);assert(q.targetAudit.strictInside);}
  const pear=m.pears[0],q=a.contacts.find(q=>q.part===pear.name),before=pear.position.clone();
  try{pear.position.x+=.45;m.group.updateMatrixWorld(true);assert.equal(independentPointAudit(T,pear,q.point).strictInside,false);}
  finally{pear.position.copy(before);m.group.updateMatrixWorld(true);}
  const p=m.rootPads[0];assert.equal(independentPointAudit(T,p,[p.position.x,0,p.position.z]).strictInside,false,'an actual flat bottom boundary is not a strict material attachment');
});

test('the low wide trained fan has four real ribs, two backrails, three root pads and sparse bilateral fruit-bearing branches',()=>{
  assert.equal(m.trainingRibs.length,4);assert.equal(m.backrails.length,2);assert.equal(m.rootPads.length,3);assert.equal(m.branches.length,6);assert.equal(m.leaves.length,18);assert.equal(m.pears.length,6);
  const box=new T.Box3().setFromObject(m.group,true),size=box.getSize(new T.Vector3());assert(size.x>size.y*1.2);assert(size.z>.9);
  const branchCenters=m.branches.map(p=>new T.Box3().setFromObject(p,true).getCenter(new T.Vector3()).x);assert.equal(branchCenters.filter(x=>x<0).length,3);assert.equal(branchCenters.filter(x=>x>0).length,3);
  assert(m.parts.every(p=>p.isMesh));assert(m.resources.materials.every(p=>!p.map));assert.equal(m.inspect().textures,0);
});

test('six indexed pear profiles have a lower belly and narrowed upper neck while a same-height sphere fails that shape',()=>{
  const q=pearProfileAudit(T,m);assert(q.pass);
  for(const row of q.rows){assert(row.lowerBellyY<-.01);assert(row.upperNeckMaximumRadius<row.bellyMaximumRadius*.55);assert(row.actualSections>=20);}
  const p=m.pears[0],original=p.geometry,sphere=new T.SphereGeometry(.16,28,28);
  try{p.geometry=sphere;assert.equal(pearProfileAudit(T,m).pass,false);}
  finally{p.geometry=original;sphere.dispose();}
});

test('actual indexed wood sections retain thickness and bounded turns and an inward-collapsed ring vertex fails',()=>{
  assert(a.curvedSections.pass);assert.equal(a.curvedSections.rows.length,13);
  for(const q of a.curvedSections.rows){assert(q.minimumSectionRadius>.015);assert(q.maximumAdjacentTurnDegrees<30);assert(q.actualIndexedSections>=20);}
  const profile=m.curvedProfiles[0],part=m.parts.find(p=>p.name===profile.part),original=part.geometry,g=original.clone(),row=profile.sections[8];
  try{part.geometry=g;g.attributes.position.setXYZ(row.vertices[0],...row.center);assert.equal(curvedSectionAudit(T,m).pass,false);}
  finally{part.geometry=original;g.dispose();}
});

test('four finite fan paths distinguish frame-only clearance from actual all-part clearance and detect an added obstruction',()=>{
  assert(a.gaps.pass);assert.equal(a.gaps.rows.length,4);
  for(const q of a.gaps.rows){assert.equal(q.frameHits.length,0);assert.equal(q.allPartHits.length,0);}
  const q=m.passages[0],block=new T.Mesh(new T.BoxGeometry(.08,.08,.18),new T.MeshBasicMaterial());block.name='negative-only-real-fan-obstruction';block.position.set((q.from[0]+q.to[0])/2,(q.from[1]+q.to[1])/2,0);block.updateMatrixWorld(true);m.parts.push(block);
  try{const b=gapAudit(T,m);assert.equal(b.rows[0].frameHits.length,0);assert(b.rows[0].allPartHits.length>0);assert.equal(b.pass,false);}
  finally{m.parts.pop();block.geometry.dispose();block.material.dispose();}
});

test('eight actual two-wall chords cross occupied root wood and pear material and an empty-space chord cannot pass',()=>{
  assert.equal(a.occupiedChords.length,8);
  for(const q of a.occupiedChords){assert(q.pass);assert.equal(q.uniqueDistances.length,2);assert(q.strictOccupiedMidpoint);assert(q.actualThickness>=q.minimum&&q.actualThickness<=q.maximum);}
  const part=m.rootPads[0],bad=occupiedChord(T,part,{part:part.name,from:[5,.4,5],to:[5,-.2,5],minimum:.139,maximum:.141});assert.equal(bad.pass,false);assert.equal(bad.actualThickness,null);
});

test('all three real root-pad bottom caps have parallel stored normals and legacy shared cap smoothing fails',()=>{
  assert(a.actualRootCapNormals.pass);assert.equal(a.actualRootCapNormals.rows.length,3);
  for(const q of a.actualRootCapNormals.rows){assert(q.actualFlatCapTriangles>=16);assert(q.minimumCapVertexNormalDotFace>1-1e-6);}
  const part=m.rootPads[0],original=part.geometry,p=original.attributes.position,ix=original.index,map=new Map(),positions=[],index=[];
  for(const id of ix.array){const q=[p.getX(id),p.getY(id),p.getZ(id)],key=q.join(':');if(!map.has(key)){map.set(key,positions.length/3);positions.push(...q);}index.push(map.get(key));}
  const legacy=new T.BufferGeometry();legacy.setAttribute('position',new T.Float32BufferAttribute(positions,3));legacy.setIndex(index);legacy.computeVertexNormals();
  try{part.geometry=legacy;assert.equal(rootCapAudit(T,m).pass,false);assert.equal(inspectFaceNormalAgreement(T,legacy).nonpositiveFaces,0);}
  finally{part.geometry=original;legacy.dispose();}
});

test('fifteen finite actual sole/diagnostic-floor triangle pairs come from three pads and a lifted pad is rejected',()=>{
  assert(a.diagnosticFloor.pass);assert.equal(a.diagnosticFloor.rootPads,3);assert.equal(a.diagnosticFloor.rows.length,15);
  for(const q of a.diagnosticFloor.rows){assert(q.pass);assert(Number.isInteger(q.actualSoleTriangle));assert(Number.isInteger(q.diagnosticFloorTriangle));assert(q.normal[1]<-.999);}
  const pad=m.rootPads[0],y=pad.position.y;
  try{pad.position.y+=.02;m.group.updateMatrixWorld(true);assert.equal(diagnosticFloorPairs(T,m).pass,false);}
  finally{pad.position.y=y;m.group.updateMatrixWorld(true);}
  assert.match(a.diagnosticFloor.scope,/no full contact area or load/);
});

test('geometry object counts use exact typed content and saved mesh JSON uses its honest numeric serialization projection',()=>{
  const hashes=m.resources.geometries.map(fingerprint),identity=geometryIdentity(m),saved=json('mesh-geometry.json');
  assert.equal(identity.geometryObjects,18);assert.equal(identity.exactTypedContentGroups,new Set(hashes).size);assert.deepEqual(cert.geometryIdentity.objectFingerprints,hashes);assert.equal(cert.geometryIdentity.exactTypedPositionIndexFingerprintGroups,new Set(hashes).size);
  assert.equal(saved.geometries.length,18);assert.equal(saved.parts.length,71);
  for(const g of saved.geometries){const actual=m.resources.geometries[g.id];assert.equal(g.exactTypedPositionIndexSHA256,fingerprint(actual));assert.deepEqual(g.attributes.position.array,JSON.parse(JSON.stringify(Array.from(actual.attributes.position.array))));assert.deepEqual(g.index.array,Array.from(actual.index.array));}
  assert.notEqual(m.parts.length,identity.geometryObjects,'71parts are not71unique geometry objects');
});

test('135 finite cameras project all actual saved vertices and separately eight box corners without changing authored transforms',()=>{
  const points=m.parts.flatMap(p=>Array.from({length:p.geometry.attributes.position.count},(_,i)=>new T.Vector3().fromBufferAttribute(p.geometry.attributes.position,i).applyMatrix4(p.matrixWorld))),real=new T.Box3().setFromObject(m.group,true),arrays=authoredBoundsArrays(real),before=m.group.matrix.toArray(),corners=[];assert.equal(points.length,15874);
  for(const x of[real.min.x,real.max.x])for(const y of[real.min.y,real.max.y])for(const z of[real.min.z,real.max.z])corners.push(new T.Vector3(x,y,z));
  let count=0;
  for(const aspect of[.45,1.48,2.20])for(const yaw of[0,45,90,180,270])for(const pitch of[-82,18,86])for(const roll of[-25,0,25]){
    const view={yaw,pitch,roll,distance:1},f=fitPearTreeView(T,real,view,aspect),target=new T.Vector3(...f.targetLocal),a=yaw*Math.PI/180,p=pitch*Math.PI/180,camera=new T.PerspectiveCamera(46,aspect,.04,100);assert.deepEqual(f.authoredBounds,arrays);camera.position.copy(target).addScaledVector(new T.Vector3(Math.sin(a)*Math.cos(p),Math.sin(p),Math.cos(a)*Math.cos(p)),f.actualDistance);camera.lookAt(target);camera.rotateZ(roll*Math.PI/180);camera.updateMatrixWorld(true);
    for(const q of[...points,...corners]){const v=q.clone().project(camera);assert([v.x,v.y,v.z].every(Number.isFinite));assert(Math.abs(v.x)<=1+1e-7&&Math.abs(v.y)<=1+1e-7&&v.z>=-1-1e-7&&v.z<=1+1e-7);}count++;
  }
  assert.equal(count,135);assert.equal(corners.length,8);assert.deepEqual(m.group.matrix.toArray(),before);assert.deepEqual(m.group.scale.toArray(),[1,1,1]);
  let bad;try{bad=rawFitView(T,real,{yaw:0,pitch:18,roll:0,distance:1},1.48);}catch{bad=null;}
  assert(!bad||!Object.values(bad.ndcBounds).every(Number.isFinite)||bad.ndcBounds.maxX-bad.ndcBounds.minX<=1e-8||bad.ndcBounds.maxY-bad.ndcBounds.minY<=1e-8,'raw old Box3 indexing must not silently be accepted as a noncollapsed view');
});

test('current actual Scene placement uses15root-pad/floor triangles and conservative measured margins while a real road site fails',()=>{
  const x=currentWorld(),wBefore=JSON.stringify(x.world),pose={position:m.group.position.clone(),quaternion:m.group.quaternion.clone(),scale:m.group.scale.clone()};
  try{
    const p=placeAndProbe(T,x.ctx.PetTownScene,x.ctx.PetTownWalk,x.world,x.scene,m,anchor);assert.equal(p.supports.length,15);assert.equal(p.authoredRootPads,3);assert(p.worldUnchanged);assert(p.minimumRoadGap>=p.requiredMargin);assert(p.originalSpriteEnvelopeClearance.minimumGap>=p.requiredMargin);assert.equal(JSON.stringify(x.world),wBefore);
    for(const q of p.supports){assert(Number.isInteger(q.actualRootPadBottomTriangle));assert(Number.isInteger(q.actualFloorTriangle));assert(q.soleNormal[1]<-.999);assert(Math.abs(q.soleMinusFloor)<1e-6);}
    let road;x.scene.scene.traverse(p=>{if(!road&&p.isMesh&&p.name==='layout-curved-cream-path')road=p;});assert(road);const pos=road.geometry.attributes.position,ix=road.geometry.index,center=new T.Vector3();for(let k=0;k<3;k++)center.add(new T.Vector3().fromBufferAttribute(pos,ix?ix.getX(k):k).applyMatrix4(road.matrixWorld));center.multiplyScalar(1/3);const town=x.ctx.PetTownScene.townPoint(x.world,{x:center.x,z:center.z});
    assert.throws(()=>placeAndProbe(T,x.ctx.PetTownScene,x.ctx.PetTownWalk,x.world,x.scene,m,town),/road_clearance|footprint_blocked|original_card_clearance/);
    assert.equal(p.stabilityOrLoadVerified,false);assert.equal(p.normalPlacement,false);assert.equal(p.ownershipUnlockSave,false);
  }finally{m.group.position.copy(pose.position);m.group.quaternion.copy(pose.quaternion);m.group.scale.copy(pose.scale);m.group.updateMatrixWorld(true);}
});

test('a failed actual startup returns bounded diagnostics, cleans up and does not leak raw private errors or retry',async()=>{
  const nodes=Object.fromEntries(['stage','status','report'].map(k=>[k,{dataset:{},textContent:''}]));let cleanup=0;
  assert.equal(await startPreview({doc:{getElementById:k=>nodes[k]},load:async()=>({start(notify){notify('geometry_built');throw Error('private https://not-public.test/path');},cleanup(){cleanup++;return{failed:0};}})}),false);
  assert.equal(cleanup,1);assert(!nodes.report.textContent.includes('not-public.test'));assert.equal(failureDetails(Error('private path')).rawMessageStackOrURLSaved,false);assert.equal(JSON.parse(nodes.report.textContent).startup.automaticRetry,false);assert.equal(nodes.stage.dataset.ready,'false');
});

test('actual preset handlers clear partial highlights for reset and manual controls; partial camera eyes stay outside real material',()=>{
  const source=read('viewer.mjs').toString(),module=source.split('\n').filter(l=>!l.startsWith('import')).join('\n').replaceAll('export ',''),start=source.indexOf(" on($('context'),'click'"),end=source.indexOf(" on($('capture'),'click'");assert(start>0&&end>start);const bindings=source.slice(start,end);
  function fixture(code){const controls=new Map(),whole=['front','side','back','top','bottom','oblique'].map(view=>({dataset:{view},pressed:'false',setAttribute(k,v){if(k==='aria-pressed')this.pressed=v;}})),partial=['structure','fruit'].map(value=>({dataset:{partial:value},pressed:'false',setAttribute(k,v){if(k==='aria-pressed')this.pressed=v;}})),listeners=new Map(),stage={focus(){},setPointerCapture(){}},doc={hidden:false,querySelectorAll:s=>s==='[data-view]'?whole:partial,getElementById:id=>{if(!controls.has(id))controls.set(id,{id,value:id==='distance'?3:0,min:-360,max:360});return controls.get(id);}},ctx=vm.createContext({T,document:doc,window:{},stage,media:{},renderer:{shadowMap:{}},background(){},context(){},refresh(){},cameraMode:'whole',selectedView:null,isolated:true,drag:null,raf:null,on(o,e,f){if(!listeners.has(o))listeners.set(o,{});listeners.get(o)[e]=f;}});vm.runInContext(module,ctx);vm.runInContext(code,ctx);return{whole,partial,ctx,doc,stage,click(n){const p=n==='reset'?doc.getElementById(n):[...whole,...partial].find(p=>p.dataset.view===n||p.dataset.partial===n);listeners.get(p).click();},event(o,e,v={}){listeners.get(o)[e](v);}};}
  const check=f=>{f.click('structure');assert.equal(f.partial[0].pressed,'true');f.click('reset');assert(f.whole.every(p=>p.pressed==='false'));assert(f.partial.every(p=>p.pressed==='false'),'reset clears stale partial preset');assert.equal(f.ctx.cameraMode,'whole');};
  const f=fixture(bindings);check(f);
  for(const mode of['slider','drag','keyboard']){f.click('fruit');if(mode==='slider')f.event(f.doc.getElementById('yaw'),'input');else if(mode==='drag')f.event(f.stage,'pointerdown',{button:0,isPrimary:true,pointerId:1,clientX:0,clientY:0});else f.event(f.stage,'keydown',{key:'ArrowRight',preventDefault(){}});assert(f.whole.every(p=>p.pressed==='false'));assert(f.partial.every(p=>p.pressed==='false'));assert.equal(f.ctx.cameraMode,'whole');}
  const old=bindings.replace("on($('reset'),'click',()=>{cameraMode='whole';selectedView=null;selectViewPreset(document);selectPartialPreset(document);","on($('reset'),'click',()=>{cameraMode='whole';selectedView=null;");assert.notEqual(old,bindings);assert.throws(()=>check(fixture(old)),/reset clears stale partial preset/);
  for(const q of Object.values(m.interiorViews))for(const part of m.parts)assert.equal(independentPointAudit(T,part,q.eye).strictInside,false);
  assert(source.includes('partial surface visibility only'));assert(!source.includes('localStorage')&&!source.includes('sessionStorage'));
});

test('owned resources dispose once and standalone authored geometry never gains horticulture, physics, body or gameplay credit',()=>{
  const x=build(T),counts=new Map();assert(Array.isArray(x.resources.geometries)&&Array.isArray(x.resources.materials));assert.equal(new Set(x.resources.geometries).size,x.resources.geometries.length);
  for(const r of[...x.resources.geometries,...x.resources.materials]){counts.set(r,0);r.addEventListener('dispose',()=>counts.set(r,counts.get(r)+1));}
  assert.equal(x.dispose(),true);assert.equal(x.dispose(),false);assert([...counts.values()].every(n=>n===1));assert.throws(()=>x.inspect(),/disposed/);
  const input=json('input-manifest.json');assert.equal(input.bodyBinding,null);assert.equal(spec.bodyBinding,null);
  for(const k of['new_original_designs','new_raw_PNGs','raw_png_designs','paid_calls','new_body_references','new_canonical_fit_success','normal_game_changes'])assert.equal(input[k],0);assert.equal(input.new_village_library_candidates,1);
  for(const k of['horticulturalTraining','pruning','growth','fruitCollection','edibility','loadWeatherStability','physics','rig','wearingFit','normalGame','contractorConstruction','ownershipUnlockSave'])assert.equal(spec[k],false);
  assert.equal(m.animate,undefined);assert.equal(m.collectFruit,undefined);assert.equal(m.resolveAnatomicalSocket,undefined);assert.equal(m.attachToActualBuilding,undefined);
});

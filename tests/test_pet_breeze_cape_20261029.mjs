import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as T from '../static/vendor/three-0.160.1.module.js';
import {build,spec,strictContainment} from '../static/pet-breeze-cape-proof-20261029/modelrecipe.mjs';
import {finiteAudit,independentPointAudit,independentSegmentAudit} from '../static/pet-breeze-cape-proof-20261029/audit.mjs';
import {fitView} from '../static/pet-scalloped-path-proof-20261027/framing.mjs';
import {startPreview,failureDetails} from '../static/pet-breeze-cape-proof-20261029/entry.mjs';
const dir=new URL('../static/pet-breeze-cape-proof-20261029/',import.meta.url),read=name=>fs.readFileSync(new URL(name,dir)),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const model=build(T),certificate=finiteAudit(T,model);
test.after(()=>model.dispose());
test('unaltered original and every declared source file match their actual SHA; body and game gates remain pending',()=>{
 const manifest=JSON.parse(read('input-manifest.json'));
 assert.equal(sha(read('reference.png')),spec.sourceSHA);assert.equal(manifest.source_original.sha256,spec.sourceSHA);assert.equal(manifest.original_copy_unmodified,true);
 for(const f of manifest.files)assert.equal(sha(read(f.path)),f.sha256,f.path);
 for(const f of manifest.inputs.filter(f=>f.path.startsWith('static/')))assert.equal(sha(fs.readFileSync(new URL('../'+f.path,import.meta.url))),f.sha256,f.path);
 assert.equal(manifest.new_raw_PNGs,0);assert.equal(manifest.imagegen_calls,0);assert.equal(manifest.new_original_designs,0);assert.equal(spec.bodyBinding,null);
 for(const k of['wearingFit','rig','clothPhysics','normalGame','unlockSave'])assert.equal(spec[k],false,k);
});
test('each actual material component is closed, nondegenerate and outward with finite positive transforms',()=>{
 assert.equal(certificate.result,'pass');assert.equal(model.inspect().normalConstruction.actualTrianglePositionsAndWindingUnchanged,true);assert.ok(model.shell.geometry.attributes.position.count<model.shell.geometry.index.count,'Curved cloth panels must share smooth normals, not isolate every face');assert.equal(model.parts.length,18);assert.ok(model.budget.triangles<18000);assert.equal(model.budget.textures,0);
 for(const p of certificate.topology){assert.equal(p.closedEdges,true,p.name);assert.equal(p.badEdges,0);assert.equal(p.degenerateTriangles,0);assert.equal(p.invalidNormals,0);assert.ok(p.signedVolume>0);assert.ok(p.faceNormals.minimumFaceAverageNormalDot>.5);assert.equal(p.positiveFiniteTransform,true);}
 const measured=new T.Box3().setFromObject(model.group);assert.deepEqual(model.bounds.min,measured.min.toArray());assert.deepEqual(model.bounds.max,measured.max.toArray());assert.ok(measured.max.x-measured.min.x<2.7);
});
test('independent neckline/front/hem rays pass through actual empty space while side and rear cloth block probes',()=>{
 assert.equal(certificate.independentPassages.count,20);assert.equal(certificate.independentPassages.blocked,0);
 for(const p of certificate.independentPassages.segments)assert.equal(p.hits.length,0);
 for(const p of certificate.solidProbes)assert.ok(p.hits.length>=2,p.name);
});
test('nonadjacent actual triangle interiors do not cross in the fixed authored pose',()=>{
 assert.ok(certificate.crossings.length>=10);
 for(const c of certificate.crossings)assert.equal(c.strictEdgeInteriorCrossings,0,c.name);
 assert.equal(certificate.scope.includes('Not continuous collision safety'),true);
});
test('all trim, collar, bow and leaf pieces connect through strict common-material points independently checked',()=>{
 assert.equal(certificate.independentAttachments.failed,0);assert.equal(certificate.independentAttachments.count,18);assert.equal(certificate.connectedPartCount,model.parts.length);
 assert.ok(certificate.independentAttachments.minimumClearance>1e-5);
 for(const c of certificate.independentAttachments.contacts)for(const audit of[c.partAudit,c.targetAudit]){assert.equal(audit.strictInside,true);assert.equal(audit.independentUniqueRayHitCounts.length,3);assert.ok(audit.independentUniqueRayHitCounts.every(n=>n%2===1));}
 assert.ok(certificate.independentAttachments.contacts.some(c=>c.part==='rounded-bow-knot'&&c.target==='padded-bow-wing--1'));
});
test('strict contact checks reject surface-only contact and moved-away attachments',()=>{
 const box=new T.BoxGeometry(1,1,1),mesh=new T.Mesh(box,new T.MeshBasicMaterial());mesh.updateMatrixWorld(true);
 assert.equal(strictContainment(T,mesh,[.5,0,0]).inside,false);assert.equal(independentPointAudit(T,mesh,[.5,0,0]).strictInside,false);assert.equal(strictContainment(T,mesh,[0,0,0]).inside,true);
 const c=model.contactWitnesses.find(c=>c.part==='rounded-bow-knot'),part=model.parts.find(p=>p.name===c.part),prior=part.position.clone();
 try{part.position.x+=5;model.group.updateMatrixWorld(true);assert.equal(independentPointAudit(T,part,c.point).strictInside,false);}finally{part.position.copy(prior);model.group.updateMatrixWorld(true);box.dispose();mesh.material.dispose();}
});
test('actual rim faces and front-strip top caps are buried in covering material without draw-order masking',()=>{
 assert.equal(certificate.independentFrontTopCapVertices.count,16);assert.equal(certificate.independentFrontTopCapVertices.failed,0);assert.ok(certificate.independentFrontTopCapVertices.minimumSurfaceClearance>1e-5);assert.ok(certificate.independentFrontTopCapVertices.maximumY<new T.Box3().setFromObject(model.parts.find(p=>p.name==='rounded-scalloped-cream-collar')).max.y-.015,'Gold endpoint vertices must finish below and inside cream collar');
 assert.equal(certificate.independentBindingCoverage.witnesses.filter(w=>w.binding==='rounded-scalloped-cream-collar'&&w.target.startsWith('gold-front-edge-')&&w.targetRim==='neck').length,12,'Gold top caps must lie under the collar, not protrude as tips');
 assert.equal(certificate.independentBindingCoverage.count,576);assert.equal(certificate.independentBindingCoverage.failed,0);assert.ok(certificate.independentBindingCoverage.minimumSurfaceClearance>1e-5);
 for(const w of certificate.independentBindingCoverage.witnesses){
  assert.equal(w.audit.strictInside,true);const target=model.parts.find(p=>p.name===w.target),p=target.geometry.attributes.position,i=target.geometry.index,actual=new T.Vector3();
  for(let k=0;k<3;k++)actual.add(new T.Vector3().fromBufferAttribute(p,i.getX(w.targetFace*3+k)).applyMatrix4(target.matrixWorld).multiplyScalar(1/3));
  assert.ok(actual.distanceTo(new T.Vector3(...w.point))<1e-9);
 }
 const w=certificate.independentBindingCoverage.witnesses[0],binding=model.parts.find(p=>p.name===w.binding),prior=binding.position.clone();
 try{binding.position.z+=5;model.group.updateMatrixWorld(true);assert.equal(independentPointAudit(T,binding,w.point).strictInside,false);}finally{binding.position.copy(prior);model.group.updateMatrixWorld(true);}
 assert.doesNotMatch(read('modelrecipe.mjs').toString(),/polygonOffset|renderOrder/);
});
test('whole finite bounds remain framed across axes, rolls and narrow/mobile aspect samples without scaling model',()=>{
 const before=model.group.scale.toArray();let samples=0;
 for(const aspect of[320/350,390/350,1.5])for(const yaw of[-180,-45,0,90])for(const [pitch,roll]of[[12,0],[82,33],[-80,-27]]){
  const f=fitView(T,model.bounds,{yaw,pitch,roll,distance:1},aspect);assert.ok(Number.isFinite(f.actualDistance)&&f.actualDistance>=f.requestedDistance);
  for(const n of Object.values(f.ndcBounds))assert.ok(Math.abs(n)<=1.001);samples++;
 }
 assert.equal(samples,36);assert.deepEqual(model.group.scale.toArray(),before);assert.deepEqual(before,[1,1,1]);
});
test('garment-side markers resolve to exact stored triangle points, not body anchors',()=>{
 for(const r of Object.values(model.garmentRims)){assert.match(r.scope,/no body anchor/);assert.ok(r.actualSurfaceNormal.every(Number.isFinite));assert.ok(Math.abs(new T.Vector3(...r.actualSurfaceNormal).length()-1)<1e-6);const d=independentPointAudit(T,model.shell,r.actualSurfacePosition);assert.ok(d.minimumSurfaceClearance<1e-6);}
 assert.throws(()=>model.resolveRim('body_shoulder'),/cape_unknown_rim/);
});
test('startup failures clean resources and publish only fixed safe diagnostics without raw URLs or automatic retry',async()=>{
 const nodes=Object.fromEntries(['stage','status','report'].map(id=>[id,{dataset:{},textContent:''}]));let cleanups=0;
 const ok=await startPreview({doc:{getElementById:id=>nodes[id]},load:async()=>({start(step){step('geometry_built');throw Error('https://private.invalid?key=secret');},cleanup(){cleanups++;return{failed:0};}})});
 assert.equal(ok,false);assert.equal(cleanups,1);assert.equal(nodes.stage.dataset.ready,'false');assert.equal(nodes.stage.dataset.startupPhase,'failed');
 const report=JSON.parse(nodes.report.textContent);assert.equal(report.startup.phaseAtFailure,'geometry_built');assert.equal(report.startup.failure.code,null);assert.equal(report.startup.automaticRetry,false);assert.equal(nodes.report.textContent.includes('secret'),false);assert.equal(failureDetails(Error('cape_manifest_mismatch')).code,'cape_manifest_mismatch');
});
test('standalone viewer has no game or storage API paths and resource disposal is idempotent',()=>{
 const viewer=read('viewer.mjs').toString(),html=read('index.html').toString();
 assert.doesNotMatch(viewer,/localStorage|sessionStorage|\/api\/|requestAnimationFrame/);assert.match(viewer,/window\.capeProof/);assert.match(viewer,/paint\(\);const v=view\(\),name=/);assert.match(viewer,/toDataURL\('image\/png'\)/);assert.match(html,/min="\\-?89"|min="-89"/);
 const own=build(T),counts=new Map();for(const g of own.resources.geometries){counts.set(g,0);g.addEventListener('dispose',()=>counts.set(g,counts.get(g)+1));}for(const m of own.resources.materials){counts.set(m,0);m.addEventListener('dispose',()=>counts.set(m,counts.get(m)+1));}
 assert.equal(own.dispose(),true);assert.equal(own.dispose(),false);assert.equal(own.group.children.length,0);assert.ok([...counts.values()].every(n=>n===1));assert.throws(()=>own.inspect(),/cape_disposed/);
});

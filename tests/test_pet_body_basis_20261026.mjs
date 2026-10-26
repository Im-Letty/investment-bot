import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),B=require('../static/pet-body-basis-proof-20261026/basis.js'),root=new URL('../static/pet-body-basis-proof-20261026/',import.meta.url);
const d=JSON.parse(readFileSync(new URL('basis-data-v1.json',root))),copy=()=>structuredClone(d),near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,a+' != '+b);
test('SHA-bound actual original PNGs and source dimensions match both independent stages',()=>{
 B.validate(d);for(const stage of ['baby','adult']){const c=d.cases[stage],bytes=readFileSync(new URL(c.source.src,root));assert.equal(createHash('sha256').update(bytes).digest('hex'),c.source.sha256);assert.equal(bytes.readUInt32BE(16),1254);assert.equal(bytes.readUInt32BE(20),1254);}
});
test('stage/SHA/dimension substitution refuses stale or wrongly associated annotations',()=>{
 for(const edit of [x=>x.cases.baby.source.sha256=B.expected.adult,x=>x.cases.adult.source.stage='baby',x=>x.cases.baby.source.width=1024,x=>x.revision='old']){const x=copy();edit(x);assert.throws(()=>B.validate(x));}
});
test('visible points require finite pixels, explicit uncertainty, and unknown anatomical side/depth',()=>{
 for(const edit of [l=>l.px=[NaN,1],l=>l.px=[1254,1],l=>l.uncertaintyRadiusPx=[0,0],l=>l.anatomicalSide='left',l=>l.depth=0]){const x=copy();edit(x.cases.baby.landmarks[0]);assert.throws(()=>B.validate(x));}
});
test('screen-side chord cannot reverse or silently mirror',()=>{
 const x=copy();[x.cases.baby.basis.screenLeftLandmark,x.cases.baby.basis.screenRightLandmark]=[x.cases.baby.basis.screenRightLandmark,x.cases.baby.basis.screenLeftLandmark];assert.throws(()=>B.validate(x),/screen_side_order/);
});
test('chord frame is orthonormal, has positive determinant and round-trips every source landmark',()=>{
 for(const c of Object.values(d.cases)){const f=B.frame(c),l=c.landmarks.find(x=>x.id===c.basis.screenLeftLandmark).px,r=c.landmarks.find(x=>x.id===c.basis.screenRightLandmark).px;
 near(Math.hypot(...f.xAxis),1);near(Math.hypot(...f.yAxis),1);near(f.xAxis[0]*f.yAxis[0]+f.xAxis[1]*f.yAxis[1],0);near(f.xAxis[0]*f.yAxis[1]-f.xAxis[1]*f.yAxis[0],1);
 near(B.toLocal(f,l)[0],-Math.hypot(r[0]-l[0],r[1]-l[1])/2);near(B.toLocal(f,r)[0],f.chordLengthPx/2);
 for(const m of c.landmarks){const z=B.fromLocal(f,B.toLocal(f,m.px));near(z[0],m.px[0]);near(z[1],m.px[1]);}}
});
test('source pixel centres survive crop and non-square letterbox transforms; out-of-image clicks refuse',()=>{
 for(const c of Object.values(d.cases))for(const [w,h] of [[1254,1254],[883,501],[390,640],[320,568]])for(const crop of [null,c.crop]){
 const v=B.viewport(1254,1254,w,h,crop),r=v.crop;
 for(const p of [[r[0],r[1]],[r[2]-1,r[3]-1],[(r[0]+r[2]-1)/2,(r[1]+r[3]-1)/2]]){const z=B.canvasToSource(v,B.sourceToCanvas(v,p));assert.ok(z);near(z[0],p[0]);near(z[1],p[1]);}
 assert.equal(B.canvasToSource(v,[-1,-1]),null);}
 assert.throws(()=>B.viewport(1254,1254,0,390));assert.throws(()=>B.viewport(1254,1254,320,568,[100,100,80,80]));
});
test('hidden neck/arm roots/back remain unresolved, with no fabricated sockets',()=>{
 for(const c of Object.values(d.cases)){assert.deepEqual(c.unresolved.map(x=>x.id),['neck_socket','screen_left_arm_root','screen_right_arm_root','back_and_tail_root']);for(const u of c.unresolved)assert.equal(u.point,null);}
 const x=copy();x.cases.baby.unresolved[0].point=[737,914];assert.throws(()=>B.validate(x),/hidden_anchor_forbidden/);
});
test('source-image basis cannot be promoted into wearing, body360 or world calibration',()=>{
 for(const key of ['calibrationApproved','wearingVerified','characterBody360']){const x=copy();x[key]=true;assert.throws(()=>B.validate(x),/scope_gate/);}
 for(const [k,v] of [['bodyBinding',{}],['depth',0],['worldUnitsPerPixel',.01],['angleDegrees',0]]){const x=copy();x[k]=v;assert.throws(()=>B.validate(x),/unknown_spatial_basis/);}
});
test('adult local belly relation is not a uniform rescale of the baby source frame',()=>{
 const b=d.cases.baby,a=d.cases.adult;assert.notEqual(b.source.sha256,a.source.sha256);const f1=B.frame(b),f2=B.frame(a);
 const u1=B.toLocal(f1,b.landmarks.find(x=>x.id==='belly_visible').px).map(x=>x/f1.chordLengthPx),u2=B.toLocal(f2,a.landmarks.find(x=>x.id==='belly_visible').px).map(x=>x/f2.chordLengthPx);
 assert.ok(Math.hypot(u1[0]-u2[0],u1[1]-u2[1])>.01);
});
test('immutable snapshot binds pose, source, crop and pending gates for the same exported frame',()=>{
 const s=B.snapshot(d,'adult',{labels:true,region:'torso',matte:'#edf5e9'},'a'.repeat(64)),before=structuredClone(s);
 assert.equal(s.source.sha256,B.expected.adult);assert.equal(s.bodyBinding,null);assert.equal(s.garmentRendered,false);assert.equal(s.canonicalFitRecordsAdded,0);assert.deepEqual(s.viewport.crop,d.cases.adult.crop);
 d.cases.adult.landmarks[0].px[0]++;assert.deepEqual(s,before);d.cases.adult.landmarks[0].px[0]--;
 assert.throws(()=>B.snapshot(d,'egg',{labels:true,region:'whole'},'a'.repeat(64)));
});

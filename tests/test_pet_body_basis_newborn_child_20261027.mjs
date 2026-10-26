import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
const require=createRequire(import.meta.url),B=require('../static/pet-body-basis-newborn-child-proof-20261027/basis.js');
const root=new URL('../static/pet-body-basis-newborn-child-proof-20261027/',import.meta.url),data=JSON.parse(readFileSync(new URL('basis-data-v1.json',root)));
const copy=()=>structuredClone(data),near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,a+' != '+b),hash=b=>createHash('sha256').update(b).digest('hex');
// Decode the actual saved RGBA PNG rows, rather than testing synthetic opaque pixels.
function pixels(bytes){
 assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);assert.equal(bytes[24],8);assert.equal(bytes[25],6);assert.equal(bytes[28],0);
 const chunks=[];for(let i=8;i<bytes.length;){const n=bytes.readUInt32BE(i),kind=bytes.toString('ascii',i+4,i+8);if(kind==='IDAT')chunks.push(bytes.subarray(i+8,i+8+n));i+=12+n;}
 const raw=inflateSync(Buffer.concat(chunks)),stride=width*4,out=new Uint8Array(stride*height);assert.equal(raw.length,(stride+1)*height);
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];assert.ok(filter<=4);for(let x=0;x<stride;x++){const at=y*stride+x,a=x>=4?out[at-4]:0,b=y?out[at-stride]:0,c=y&&x>=4?out[at-stride-4]:0;out[at]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}}
 return{width,height,alpha:(x,y)=>out[(y*width+x)*4+3]};
}
test('newborn and child are the two unchanged real source images, with all visible probes on their actual opaque pixels',()=>{
 B.validate(data);assert.deepEqual(Object.keys(data.cases),['newborn','child']);
 const expected={newborn:'14c8978b1eb8864bc3c1eb54a24107d9111a6e53d8690d1275a1caa42e8a7766',child:'495e395a63f1d7e95b43d84deb9c66a60ddcdcc0142dea74640ee3e63b1f6a85'};
 for(const [stage,c] of Object.entries(data.cases)){const bytes=readFileSync(new URL(c.source.src,root)),image=pixels(bytes);assert.equal(hash(bytes),expected[stage]);assert.equal(c.source.sha256,expected[stage]);assert.deepEqual([image.width,image.height],[1254,1254]);for(const l of c.landmarks){assert.ok(l.px.every(Number.isInteger));assert.ok(image.alpha(...l.px)>=240,l.id+' is a visible source pixel, not padding or a hidden inferred joint');assert.ok(l.px[0]>=c.crop[0]&&l.px[0]<c.crop[2]&&l.px[1]>=c.crop[1]&&l.px[1]<c.crop[3]);}}
});
test('pose, hash and image size substitutions cannot inherit the other pose annotation',()=>{
 for(const edit of [x=>x.cases.newborn.source.sha256=B.expected.child,x=>x.cases.child.source.stage='baby',x=>x.cases.newborn.source.width=1024,x=>x.revision='milne-body-source-landmark-basis-v1']){const d=copy();edit(d);assert.throws(()=>B.validate(d));}
});
test('visible-source points require finite in-image pixels, positive finite annotation radii and unassigned anatomical side/depth',()=>{
 for(const edit of [l=>l.px=[NaN,1],l=>l.px=[1254,1],l=>l.px=[1,Infinity],l=>l.uncertaintyRadiusPx=[0,1],l=>l.uncertaintyRadiusPx=[1,Infinity],l=>l.anatomicalSide='left',l=>l.depth=0]){const d=copy();edit(d.cases.newborn.landmarks[0]);assert.throws(()=>B.validate(d));}
});
test('each independent visible-paw chord is nondegenerate, orthonormal and source-pixel reversible',()=>{
 for(const c of Object.values(data.cases)){const f=B.frame(c);assert.ok(f.chordLengthPx>150&&f.chordLengthPx<300);near(Math.hypot(...f.xAxis),1);near(Math.hypot(...f.yAxis),1);near(f.xAxis[0]*f.yAxis[0]+f.xAxis[1]*f.yAxis[1],0);near(f.xAxis[0]*f.yAxis[1]-f.xAxis[1]*f.yAxis[0],1);for(const l of c.landmarks){const p=B.fromLocal(f,B.toLocal(f,l.px));near(p[0],l.px[0]);near(p[1],l.px[1]);}}
 const d=copy();d.cases.child.landmarks[1].px=d.cases.child.landmarks[0].px.slice();assert.throws(()=>B.validate(d),/screen_side_order/);
 const reversed=copy();[reversed.cases.child.basis.screenLeftLandmark,reversed.cases.child.basis.screenRightLandmark]=[reversed.cases.child.basis.screenRightLandmark,reversed.cases.child.basis.screenLeftLandmark];assert.throws(()=>B.validate(reversed),/screen_side_order/);
});
test('source pixel centres round-trip through whole-image/crop letterboxing at desktop and both narrow widths',()=>{
 for(const c of Object.values(data.cases))for(const [width,height] of [[1254,1254],[883,501],[390,640],[320,568]])for(const crop of [null,c.crop]){const v=B.viewport(1254,1254,width,height,crop),r=v.crop;assert.ok(v.offset.every(Number.isFinite)&&Number.isFinite(v.scale));for(const p of [[r[0],r[1]],[r[2]-1,r[3]-1],...c.landmarks.map(l=>l.px)]){const back=B.canvasToSource(v,B.sourceToCanvas(v,p));assert.ok(back);near(back[0],p[0]);near(back[1],p[1]);}assert.equal(B.canvasToSource(v,[-1,-1]),null);if(v.offset[0]>1)assert.equal(B.canvasToSource(v,[0,height/2]),null);if(v.offset[1]>1)assert.equal(B.canvasToSource(v,[width/2,0]),null);}
 for(const args of [[1254,1254,0,390],[1254,1254,Infinity,390],[1254,1254,390,640,[100,100,80,80]],[1254,1254,390,640,[-1,0,100,100]]])assert.throws(()=>B.viewport(...args));
});
test('seated newborn and standing child keep distinct observed proportions instead of a reused uniform-rescale frame',()=>{
 const normal=c=>{const f=B.frame(c);return B.toLocal(f,c.landmarks.find(l=>l.id==='belly_visible').px).map(v=>v/f.chordLengthPx);},n=normal(data.cases.newborn),c=normal(data.cases.child);assert.ok(Math.hypot(n[0]-c[0],n[1]-c[1])>.02);assert.match(data.cases.newborn.poseObservation,/seated/);assert.match(data.cases.child.poseObservation,/standing/);
});
test('hidden neck, both arm roots and back/depth remain unresolved with finite explanatory regions and no fabricated body sockets',()=>{
 for(const c of Object.values(data.cases)){assert.deepEqual(c.unresolved.map(u=>u.id),['neck_socket','screen_left_arm_root','screen_right_arm_root','back_and_tail_root']);for(const u of c.unresolved){assert.equal(u.point,null);assert.equal(u.depth,null);assert.equal(u.binding,null);if(u.roi)assert.ok(u.roi.every(Number.isFinite));}assert.equal(c.anatomicalSocketsKnown,false);}
 const d=copy();d.cases.child.unresolved[0].point=[700,850];assert.throws(()=>B.validate(d),/hidden_anchor_forbidden/);
});
test('source-coordinate evidence cannot be promoted into depth, world calibration, wearing or canonical fit',()=>{
 for(const key of ['calibrationApproved','wearingVerified','characterBody360']){const d=copy();d[key]=true;assert.throws(()=>B.validate(d),/scope_gate/);}
 for(const [key,value] of [['bodyBinding',{}],['depth',0],['worldUnitsPerPixel',.01],['angleDegrees',0],['canonicalFitRecordsAdded',1]]){const d=copy();d[key]=value;assert.throws(()=>B.validate(d));}
});
test('an immutable export snapshot binds the selected source, crop and pending gates without mutating data',()=>{
 for(const stage of ['newborn','child']){const d=copy(),s=B.snapshot(d,stage,{labels:true,region:'torso',matte:'#edf5e9'},'a'.repeat(64)),before=structuredClone(s);assert.equal(s.source.sha256,B.expected[stage]);assert.equal(s.bodyBinding,null);assert.equal(s.garmentRendered,false);assert.equal(s.canonicalFitRecordsAdded,0);assert.deepEqual(s.viewport.crop,d.cases[stage].crop);d.cases[stage].landmarks[0].px[0]++;assert.deepEqual(s,before);}
 assert.throws(()=>B.snapshot(data,'baby',{labels:true,region:'whole'},'a'.repeat(64)));assert.throws(()=>B.snapshot(data,'newborn',{labels:true,region:'whole'},'bad'));
});
test('manifest binds the delivered coordinate code and unchanged two originals, separately from the old PR88 proof',()=>{
 const manifest=JSON.parse(readFileSync(new URL('input-manifest.json',root)));assert.equal(manifest.unit_id,'wardrobe:fit-prerequisite:komorebi-vest:milne-newborn-child:body-landmark-basis:v1');assert.equal(manifest.new_body_references,0);assert.equal(manifest.canonical_fit_records_added,0);
 for(const entry of [...manifest.own_sources,...manifest.source_originals]){const bytes=readFileSync(new URL(entry.path,root));assert.equal(hash(bytes),entry.sha256);assert.equal(bytes.length,entry.bytes);}
});

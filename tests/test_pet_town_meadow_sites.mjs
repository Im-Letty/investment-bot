import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import Sites from '../static/pet-town-meadow-sites.js';
const basic=extra=>({width:30,depth:20,seed:271028,count:40,maxCandidates:500,radius:.55,spacing:1.25,...extra}),near=(a,b,e=1e-10)=>assert.ok(Math.abs(a-b)<e,a+' != '+b);

test('1 portable UMD registers the same immutable deterministic API without ambient random',()=>{
 const source=fs.readFileSync(new URL('../static/pet-town-meadow-sites.js',import.meta.url),'utf8'),context={};vm.runInNewContext(source,context);assert.equal(context.PetTownMeadowSites.revision,'meadow-sites2');assert.ok(Object.isFrozen(Sites));assert.doesNotMatch(source,/Math\.random|Date\.|fetch\(|localStorage|setInterval|requestAnimationFrame/);assert.deepEqual(JSON.parse(JSON.stringify(context.PetTownMeadowSites.plan(basic()))),Sites.plan(basic()));
});
test('2 a stable seed produces irregular non-grid sites while a different seed produces a different layout',()=>{
 const a=Sites.plan(basic()),b=Sites.plan(basic()),other=Sites.plan(basic({seed:271029}));assert.equal(a.length,40);assert.deepEqual(a,b);assert.notDeepEqual(a,other);assert.equal(new Set(a.map(p=>p.x.toFixed(8))).size,40);assert.equal(new Set(a.map(p=>p.z.toFixed(8))).size,40);
 const sorted=a.map(p=>p.x).sort((x,y)=>x-y),gaps=sorted.slice(1).map((x,i)=>+(x-sorted[i]).toFixed(6));assert.ok(new Set(gaps).size>30);assert.ok(a.every(p=>p.id.startsWith('meadow-')&&Number.isInteger(p.seed)&&p.seed>=0&&p.seed<=4294967295&&p.radius===.55));assert.deepEqual(Sites.plan(basic({seed:'stable-layout'})),Sites.plan(basic({seed:'stable-layout'})));
});
test('3 all accepted pairs keep Poisson center spacing and their whole circle plus margin stays in the centered map',()=>{
 const rows=Sites.plan(basic());for(let i=0;i<rows.length;i++){const p=rows[i];assert.ok(Math.abs(p.x)<=15-.65&&Math.abs(p.z)<=10-.65);for(let j=0;j<i;j++)assert.ok(Math.hypot(p.x-rows[j].x,p.z-rows[j].z)>=1.25);}
});
test('4 exact circle-to-triangle distance protects edges and vertices even when the point center is outside',()=>{
 const triangle=[[0,0],[2,0],[0,2]];near(Sites.pointTriangleDistance(1,1,triangle),0);near(Sites.pointTriangleDistance(1,-.4,triangle),.4);near(Sites.pointTriangleDistance(-.3,-.4,triangle),.5);near(Sites.pointTriangleDistance(1.5,1.5,triangle),Math.SQRT1_2);near(Sites.pointTriangleDistance(1,-.4,[...triangle].reverse()),.4);
 const first=Sites.plan(basic({count:1}))[0],nearEdge=[[first.x-.4,first.z+.2],[first.x+.4,first.z+.2],[first.x,first.z+.6]],rows=Sites.plan(basic({triangles:[triangle,nearEdge]}));assert.ok(rows.length>0);assert.ok(rows.every(p=>p.id!==first.id));for(const p of rows){assert.ok(Sites.pointTriangleDistance(p.x,p.z,triangle)>=.65);assert.ok(Sites.pointTriangleDistance(p.x,p.z,nearEdge)>=.65);}
});
test('5 degenerate projected floors retain edge exclusion without treating an infinite line as filled area',()=>{
 const collinear=[[-1,0],[0,0],[1,0]],point=[[1,1],[1,1],[1,1]],tiny=[[-1,0],[0,1e-16],[1,0]];near(Sites.pointTriangleDistance(0,.4,collinear),.4);near(Sites.pointTriangleDistance(0,0,collinear),0);near(Sites.pointTriangleDistance(0,1,point),1);near(Sites.pointTriangleDistance(0,.4,tiny),.4);assert.ok(Sites.pointTriangleDistance(3,0,collinear)>1);
 const rows=Sites.plan(basic({triangles:[collinear,point]}));for(const p of rows){assert.ok(Sites.pointTriangleDistance(p.x,p.z,collinear)>=.65);assert.ok(Sites.pointTriangleDistance(p.x,p.z,point)>=.65);}
});
test('6 shoreline segments and box corners use actual circle distance; callback can exclude the bridge or unavailable ground',()=>{
 const shore=[[-12,-7],[12,-3]],obstacle={minX:-3,maxX:1,minZ:-2,maxZ:3};near(Sites.pointBoxDistance(1.3,3.4,obstacle),.5);near(Sites.pointSegmentDistance(2,0,[[0,0],[0,0]]),2);near(Sites.pointSegmentDistance(3,1,[[0,0],[2,0]]),Math.SQRT2);
 const rows=Sites.plan(basic({boundaries:[shore],obstacles:[obstacle],allowPoint:(x,z)=>!(x>7&&z<0)}));assert.ok(rows.length>0);for(const p of rows){assert.ok(Sites.pointSegmentDistance(p.x,p.z,shore)>=.65);assert.ok(Sites.pointBoxDistance(p.x,p.z,obstacle)>=.65);assert.equal(p.x>7&&p.z<0,false);}
});
test('7 caller inputs are untouched and results frozen; count and attempt caps are finite even in a blocked map',()=>{
 const triangles=[[[0,0],[2,0],[0,2]]],boundaries=[[[0,-5],[0,5]]],obstacles=[{minX:3,maxX:4,minZ:3,maxZ:4}],options=basic({triangles,boundaries,obstacles}),before=JSON.stringify(options),rows=Sites.plan(options);assert.equal(JSON.stringify(options),before);assert.ok(Object.isFrozen(rows));assert.ok(rows.every(Object.isFrozen));assert.throws(()=>{rows[0].x=9;},TypeError);assert.throws(()=>rows.push({}),TypeError);
 assert.equal(Sites.plan(basic({width:100,depth:100,count:1000,maxCandidates:10000})).length,40);let calls=0;assert.deepEqual(Sites.plan(basic({count:1000,maxCandidates:10000,allowPoint:()=>{calls++;return false;}})),[]);assert.ok(calls<=500&&calls>0);assert.equal(Sites.plan(basic({count:40,maxCandidates:3})).length<=3,true);assert.deepEqual(Sites.plan(basic({count:0})),[]);assert.deepEqual(Sites.plan(basic({width:1,depth:1})),[]);
});
test('8 malformed or nonfinite inputs and callback failures throw instead of reporting an empty successful plan',()=>{
 for(const change of[{width:0},{depth:NaN},{seed:Infinity},{seed:-1},{seed:''},{count:-1},{maxCandidates:Infinity},{radius:0},{spacing:NaN},{triangles:[[[0,0],[1,0]]]},{triangles:[[[0,0],[1,0],[NaN,2]]]},{boundaries:[[[0,0],[0,Infinity]]]},{obstacles:[{minX:2,maxX:1,minZ:0,maxZ:1}]},{allowPoint:1}])assert.throws(()=>Sites.plan(basic(change)),/meadow_sites_invalid_input/);
 assert.throws(()=>Sites.plan(basic({triangles:new Array(1)})),/meadow_sites_invalid_input/);assert.throws(()=>Sites.plan(basic({triangles:[[new Array(2),[1,0],[0,1]]]})),/meadow_sites_invalid_input/);assert.throws(()=>Sites.plan(basic({allowPoint:()=>Promise.resolve(true)})),/meadow_sites_invalid_input/);assert.throws(()=>Sites.plan(basic({allowPoint:()=>{throw Error('unavailable ground');}})),/unavailable ground/);assert.throws(()=>Sites.pointTriangleDistance(0,0,[]),/meadow_sites_invalid_input/);assert.throws(()=>Sites.pointSegmentDistance(NaN,0,[[0,0],[1,1]]),/meadow_sites_invalid_input/);
});

import * as THREE from '../static/vendor/three-0.160.1.module.js';
import {createHash} from 'node:crypto';

const pathStrip=[[[ -.4,-8],[ .4,-8],[ .4,8]],[[ -.4,-8],[ .4,8],[-.4,8]]];
function independentDistance(site,triangles) {
 const p=new THREE.Vector3(site.x,0,site.z);
 return Math.min(...triangles.map(t=>{
  const v=t.map(([x,z])=>new THREE.Vector3(x,0,z));
  const normal=new THREE.Vector3().subVectors(v[1],v[0]).cross(new THREE.Vector3().subVectors(v[2],v[0]));
  if(normal.lengthSq()>1e-20)return p.distanceTo(new THREE.Triangle(...v).closestPointToPoint(p,new THREE.Vector3()));
  return Math.min(...v.map((a,i)=>{const b=v[(i+1)%3];return a.distanceToSquared(b)===0?p.distanceTo(a):p.distanceTo(new THREE.Line3(a,b).closestPointToPoint(p,true,new THREE.Vector3()));}));
 }));
}
test('9 pathside chooses genuinely nearer safe drifts using the actual strip, while clearing its full triangle volume and neighbours',()=>{
 const options=basic({triangles:pathStrip,pathside:true}),rows=Sites.plan(options),uniform=Sites.plan({...options,pathside:false});
 assert.equal(rows.length,40);assert.deepEqual(rows,Sites.plan({...options}));
 const distances=rows.map(p=>independentDistance(p,pathStrip)),oldDistances=uniform.map(p=>independentDistance(p,pathStrip));
 assert.ok(distances.every((d,i)=>d>=.65-1e-9&&(!i||d>=distances[i-1]-1e-9)),'independent real-geometry distances are safe and prioritised');
 const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
 assert.ok(mean(distances)<mean(oldDistances)*.6,'planting is visibly concentrated along the path rather than just renamed uniform scatter');
 assert.ok(distances.filter(d=>d<=2.5).length>=24,'a substantial majority occupies the nearby pathside band');
 for(let i=0;i<rows.length;i++)for(let j=0;j<i;j++)assert.ok(Math.hypot(rows[i].x-rows[j].x,rows[i].z-rows[j].z)>=1.25-1e-10);
 assert.ok(rows.filter(p=>uniform.some(u=>u.id===p.id)).length<20,'the new preference genuinely selects different safe sites');
});
test('10 opt-in planning leaves the prior default fixture byte-for-byte stable and never annotates or mutates caller triangles',()=>{
 const legacy=Sites.plan(basic());
 assert.equal(createHash('sha256').update(JSON.stringify(legacy)).digest('hex'),'8758c1e2b938845ba2420c5347a45f7e853d2a0dcc29466d6b8e732d088df887');
 assert.deepEqual(legacy,Sites.plan(basic({pathside:false})));
 const options=basic({triangles:pathStrip.map(t=>t.map(p=>p.slice())),pathside:true}),before=JSON.stringify(options),rows=Sites.plan(options);
 assert.equal(JSON.stringify(options),before);assert.ok(Object.isFrozen(rows)&&rows.every(Object.isFrozen));
 assert.ok(rows.every(row=>Object.keys(row).sort().join(',')==='id,radius,seed,x,z'),'selection metadata is not persisted on sites');
});
test('11 pathside has a strict boolean and real-triangle contract, bounded blocked work and valid empty-request results',()=>{
 for(const pathside of[null,0,1,'true',{},[]])assert.throws(()=>Sites.plan(basic({pathside,triangles:pathStrip})),/meadow_sites_invalid_input/);
 assert.throws(()=>Sites.plan(basic({pathside:true,triangles:[]})),/meadow_sites_invalid_input/);
 assert.deepEqual(Sites.plan(basic({pathside:true,triangles:pathStrip,count:0})),[]);
 assert.deepEqual(Sites.plan(basic({pathside:true,triangles:pathStrip,maxCandidates:0})),[]);
 let calls=0;assert.deepEqual(Sites.plan(basic({pathside:true,triangles:pathStrip,count:1000,maxCandidates:10000,allowPoint:()=>{calls++;return false;}})),[]);
 assert.ok(calls>0&&calls<=500,'a completely unavailable floor never expands the candidate cap');
 assert.ok(Sites.plan(basic({pathside:true,triangles:pathStrip,count:1000,maxCandidates:10000})).length<=40);
 assert.throws(()=>Sites.plan(basic({pathside:true,triangles:pathStrip,allowPoint:()=>Promise.resolve(true)})),/meadow_sites_invalid_input/);
});
test('12 exact equal-distance ties retain original attempt order, including numeric IDs after nine',()=>{
 // At this finite distance, all small world coordinates round to the same
 // independent point distance; selecting by lexical ID would change the order.
 const far=[[[1e100,0],[1e100,0],[1e100,0]]],options=basic({triangles:far,spacing:.001,count:20});
 const baseline=Sites.plan(options),rows=Sites.plan({...options,pathside:true});
 assert.ok(rows.length>10);assert.deepEqual(rows,baseline);
 assert.ok(rows.every(p=>independentDistance(p,far)===1e100));
 const attempts=rows.map(p=>Number(p.id.slice('meadow-'.length)));
 assert.ok(attempts.every((value,i)=>!i||value>attempts[i-1]));
});

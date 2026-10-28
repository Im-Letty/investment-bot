import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import Sites from '../static/pet-town-meadow-sites.js';
const basic=extra=>({width:30,depth:20,seed:271028,count:40,maxCandidates:500,radius:.55,spacing:1.25,...extra}),near=(a,b,e=1e-10)=>assert.ok(Math.abs(a-b)<e,a+' != '+b);

test('1 portable UMD registers the same immutable deterministic API without ambient random',()=>{
 const source=fs.readFileSync(new URL('../static/pet-town-meadow-sites.js',import.meta.url),'utf8'),context={};vm.runInNewContext(source,context);assert.equal(context.PetTownMeadowSites.revision,'meadow-sites1');assert.ok(Object.isFrozen(Sites));assert.doesNotMatch(source,/Math\.random|Date\.|fetch\(|localStorage|setInterval|requestAnimationFrame/);assert.deepEqual(JSON.parse(JSON.stringify(context.PetTownMeadowSites.plan(basic()))),Sites.plan(basic()));
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

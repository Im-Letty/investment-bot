import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const Engine=require('../static/pet-contractor-endpoint-relations.js');
const Intent=require('../static/pet-contractor-intent.js');
const source=readFileSync(new URL('../static/pet-contractor-endpoint-relations.js',import.meta.url),'utf8');
const ids=['home','cafe','shop','playground','tree','flowers'];
const positions=[[10,10],[40,10],[70,70],[80,80],[90,90],[100,100]];
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture(){
  const currentLayout={version:1,theme:'cafe',items:ids.map((id,i)=>({id,x:positions[i][0],y:positions[i][1]}))};
  return {snapshot:{revision:7,currentLayout},proposal:{version:1,expectedRevision:7,requestedLayout:copy(currentLayout)},
    footprint:{version:1,coordinateSpace:'provided_saved_layout_xy',items:ids.map(id=>({id,minX:-4,minY:-4,maxX:4,maxY:4}))}};
}
function inspect(f,engine=Engine){return engine.inspect(JSON.stringify(f.snapshot),JSON.stringify(f.proposal),JSON.stringify(f.footprint));}
function move(f,id,x,y){Object.assign(f.proposal.requestedLayout.items.find(row=>row.id===id),{x,y});return f;}
function envelope(f,id,values){Object.assign(f.footprint.items.find(row=>row.id===id),values);return f;}
function pair(result,when,a='home',b='cafe'){const key=[a,b].sort().join('|');return result[when].pairs.find(row=>row.ids.join('|')===key);}
function measured(result,when,relation,width,height,area){
  assert.equal(result.ok,true);assert.deepEqual(pair(result,when),{ids:['cafe','home'],relation,overlapWidth:width,overlapHeight:height,overlapArea:area});
}
function failure(result,error){assert.deepEqual(result,{ok:false,error});assert.equal(Object.isFrozen(result),true);}
function vmEngine(dependency){const sandbox={PetContractorIntent:dependency};vm.runInNewContext(source,sandbox);return sandbox.PetContractorEndpointRelations;}

test('explicit unchanged endpoints report six sorted rectangles and all15 unique pairs',()=>{
  const f=fixture(),r=inspect(f);measured(r,'before','separate',0,8,0);
  assert.equal(Engine.version,1);assert.equal(r.scope,'provided_endpoint_relations');assert.equal(r.coordinateSpace,'provided_saved_layout_xy');assert.equal(r.expectedRevision,7);
  assert.deepEqual(r.before.rectangles.map(x=>x.id),[...ids].sort());assert.equal(r.before.pairs.length,15);assert.equal(new Set(r.before.pairs.map(x=>x.ids.join('|'))).size,15);
  assert.deepEqual(r.before.rectangles.find(x=>x.id==='home'),{id:'home',minX:6,minY:6,maxX:14,maxY:14});assert.deepEqual(r.after,r.before);assert.deepEqual(r.changes,[]);
});
test('proper overlap translates the explicit endpoints to a hand-computable4x8 area32',()=>{
  const r=inspect(move(fixture(),'home',36,10));measured(r,'before','separate',0,8,0);measured(r,'after','overlap',4,8,32);assert.equal(r.changes.length,1);
});
test('edge contact is touch with zero width and no epsilon',()=>{
  const r=inspect(move(fixture(),'home',32,10));measured(r,'after','touch',0,8,0);assert.equal(r.changes.length,1);
});
test('corner contact is touch with both axis widths zero',()=>{
  const r=inspect(move(fixture(),'home',32,2));measured(r,'after','touch',0,0,0);assert.equal(r.changes.length,1);
});
test('containment and identical rectangles retain full8x8 intersection',()=>{
  let f=envelope(move(fixture(),'home',40,10),'home',{minX:-10,minY:-10,maxX:10,maxY:10});measured(inspect(f),'after','overlap',8,8,64);
  measured(inspect(move(fixture(),'home',40,10)),'after','overlap',8,8,64);
});
test('asymmetric nonsquare supplied offsets preserve x/y and produce8x4 area32',()=>{
  const f=envelope(move(fixture(),'home',38,10),'home',{minX:-2,minY:-1,maxX:8,maxY:3}),r=inspect(f);measured(r,'after','overlap',8,4,32);
  assert.deepEqual(r.after.rectangles.find(x=>x.id==='home'),{id:'home',minX:36,minY:9,maxX:46,maxY:13});
});
test('same overlap class with changed measures appears in delta',()=>{
  const f=fixture();Object.assign(f.snapshot.currentLayout.items[0],{x:36,y:10});move(f,'home',38,10);const r=inspect(f);
  measured(r,'before','overlap',4,8,32);measured(r,'after','overlap',6,8,48);assert.equal(r.changes.length,1);assert.equal(r.changes[0].before.relation,r.changes[0].after.relation);
});
test('preexisting unchanged overlap is observable without an acceptance verdict',()=>{
  const f=fixture();Object.assign(f.snapshot.currentLayout.items[0],{x:36,y:10});move(f,'home',36,10);const r=inspect(f);
  measured(r,'before','overlap',4,8,32);assert.deepEqual(r.changes,[]);assert.equal('accepted' in r,false);assert.equal('clear' in r,false);
});
test('a separate pair still changes when its positive single-axis intersection changes',()=>{
  const f=fixture();Object.assign(f.snapshot.currentLayout.items.find(x=>x.id==='playground'),{x:10,y:60});Object.assign(f.proposal.requestedLayout.items.find(x=>x.id==='playground'),{x:10,y:60});
  const r=inspect(move(f,'home',36,10)),a=pair(r,'before','home','playground'),b=pair(r,'after','home','playground');
  assert.deepEqual(a,{ids:['home','playground'],relation:'separate',overlapWidth:8,overlapHeight:0,overlapArea:0});assert.deepEqual(b,{ids:['home','playground'],relation:'separate',overlapWidth:0,overlapHeight:0,overlapArea:0});
  assert(r.changes.some(x=>x.ids.join('|')==='home|playground'));
});
test('geometry and layout input order do not change canonical pair ordering',()=>{
  const f=move(fixture(),'home',36,10),expected=inspect(f);f.footprint.items.reverse();f.snapshot.currentLayout.items.reverse();f.proposal.requestedLayout.items.reverse();assert.deepEqual(inspect(f),expected);
});
test('negative local offsets are reported without invented clipping or world projection',()=>{
  const f=envelope(fixture(),'home',{minX:-20,minY:-20,maxX:-10,maxY:-10}),r=inspect(f);assert.equal(r.ok,true);
  assert.deepEqual(r.before.rectangles.find(x=>x.id==='home'),{id:'home',minX:-10,minY:-10,maxX:0,maxY:0});assert.deepEqual(r.changes,[]);
});
test('every success layer is detached and deeply frozen and source JSON stays intact',()=>{
  const f=move(fixture(),'home',36,10),saved=JSON.stringify(f),r=inspect(f);f.footprint.items[0].maxX=99;
  assert.equal(r.after.rectangles.find(x=>x.id==='home').maxX,40);assert(Object.isFrozen(r));assert(Object.isFrozen(r.before));assert(Object.isFrozen(r.before.rectangles[0]));assert(Object.isFrozen(r.after.pairs[0].ids));assert(Object.isFrozen(r.changes[0].before));
  assert.throws(()=>{r.after.pairs[0].overlapArea=123;},TypeError);assert.notEqual(JSON.stringify(f),saved);assert.equal(inspect(JSON.parse(saved)).ok,true);
});
test('unchanged Intent rejects invalid snapshot and proposal before footprint inspection',()=>{
  const f=fixture();failure(Engine.inspect('{',JSON.stringify(f.proposal),'bad'),'invalid_snapshot');failure(Engine.inspect(JSON.stringify(f.snapshot),'{','bad'),'invalid_proposal');
  failure(Engine.inspect('x'.repeat(1000001),JSON.stringify(f.proposal),'bad'),'invalid_snapshot');failure(Engine.inspect(JSON.stringify(f.snapshot),'x'.repeat(1000001),'bad'),'invalid_proposal');
});
test('stale revision has priority over absent or malformed geometry',()=>{
  const f=fixture();f.proposal.expectedRevision=6;failure(Engine.inspect(JSON.stringify(f.snapshot),JSON.stringify(f.proposal),undefined),'stale_revision');
});
test('footprints require bounded primitive JSON text and exact document version/space/keys',()=>{
  const f=fixture(),s=JSON.stringify(f.snapshot),p=JSON.stringify(f.proposal);
  for(const value of [null,undefined,{},'bad','x'.repeat(1000001)])failure(Engine.inspect(s,p,value),'invalid_footprint');
  for(const change of [{version:2},{coordinateSpace:'world_pixels'},{extra:true}]){const g=copy(f);Object.assign(g.footprint,change);failure(inspect(g),'invalid_footprint');}
});
test('missing extra duplicate and unknown footprint IDs all fail closed',()=>{
  for(const mutate of [f=>f.footprint.items.pop(),f=>f.footprint.items.push(copy(f.footprint.items[0])),f=>{f.footprint.items[5].id='home';},f=>{f.footprint.items[5].id='unknown';}]){const f=fixture();mutate(f);failure(inspect(f),'invalid_footprint');}
});
test('rows require exact keys nondegenerate safe integer offsets and reject nonfinite JSON numbers',()=>{
  for(const values of [{minX:4},{maxY:-4},{minX:.5},{minX:null},{minX:Number.MAX_SAFE_INTEGER+1},{extra:0}])failure(inspect(envelope(fixture(),'home',values)),'invalid_footprint');
  const f=fixture();failure(Engine.inspect(JSON.stringify(f.snapshot),JSON.stringify(f.proposal),JSON.stringify(f.footprint).replace('"minX":-4','"minX":1e309')),'invalid_footprint');
});
test('safe offsets whose translated addition is unsafe return unsafe_arithmetic',()=>{
  const m=Number.MAX_SAFE_INTEGER,f=envelope(fixture(),'home',{minX:m-4,maxX:m});failure(inspect(f),'unsafe_arithmetic');
});
test('unsafe local width and unsafe negative pair gap cannot be clamped into valid zero',()=>{
  const m=Number.MAX_SAFE_INTEGER;failure(inspect(envelope(fixture(),'home',{minX:-m,maxX:m})),'unsafe_arithmetic');
  const f=envelope(fixture(),'home',{minX:-m+100,maxX:-m+101});envelope(f,'cafe',{minX:m-100,maxX:m-99});failure(inspect(f),'unsafe_arithmetic');
});
test('alllarge valid integer envelopes fail closed when overlap area exceeds safe integer arithmetic',()=>{
  const f=fixture();for(const row of f.footprint.items)Object.assign(row,{minX:-100000000,minY:-100000000,maxX:100000000,maxY:100000000});failure(inspect(f),'unsafe_arithmetic');
});
test('VM factory captures inspect getter once and retains original this binding',()=>{
  let reads=0,calls=0;const dep={};Object.defineProperty(dep,'inspect',{configurable:true,get(){reads++;return function(...args){calls++;assert.equal(this,dep);return Intent.inspect(...args);};}});
  const engine=vmEngine(dep);Object.defineProperty(dep,'inspect',{get(){throw Error('method_was_read_again');}});const f=fixture();assert.equal(inspect(f,engine).ok,true);assert.equal(inspect(f,engine).ok,true);assert.equal(reads,1);assert.equal(calls,2);
});
test('missing throwing or malformed dependency is refused without guessing caller failure',()=>{
  assert.throws(()=>vmEngine(null),/endpoint_relations_dependency_unavailable/);assert.throws(()=>vmEngine({get inspect(){throw Error('capture');}}),/endpoint_relations_dependency_unavailable/);
  for(const dep of [{inspect(){throw Error('host');}},{inspect(){return null;}},{inspect(){return {ok:false,error:'unexpected'};}}])assert.equal(inspect(fixture(),vmEngine(dep)).error,'invalid_dependency');
});
test('dependency reply accessors are rejected without invoking their getters',()=>{
  let calls=0;const engine=vmEngine({inspect(){const reply={};Object.defineProperty(reply,'ok',{get(){calls++;throw Error('not_data');}});return reply;}});
  assert.equal(inspect(fixture(),engine).error,'invalid_dependency');assert.equal(calls,0);
});
test('malformed success response cannot supply a mismatched revision or requested layout',()=>{
  const f=fixture();for(const mutate of [r=>{r.stage='accepted';},r=>{r.draft.expectedRevision=8;},r=>{r.draft.requestedLayout.items[0].x=99;},r=>{r.changes.push({id:'home',from:{x:10,y:10},to:{x:11,y:10}});}]){
    const engine=vmEngine({inspect(s,p){const r=copy(Intent.inspect(s,p));mutate(r);return r;}});const r=inspect(f,engine);assert.equal(r.ok,false);assert.equal(r.error,'invalid_dependency');assert(Object.isFrozen(r));
  }
  let coercions=0;const reply=Intent.inspect(JSON.stringify(f.snapshot),JSON.stringify(f.proposal)),engine=vmEngine({inspect(){return reply;}});
  const objectInput={toString(){coercions++;return JSON.stringify(f.snapshot);}};
  assert.equal(engine.inspect(objectInput,JSON.stringify(f.proposal),JSON.stringify(f.footprint)).error,'invalid_dependency');
  assert.equal(engine.inspect(JSON.stringify(f.snapshot),'x'.repeat(1000001),JSON.stringify(f.footprint)).error,'invalid_dependency');assert.equal(coercions,0);
});

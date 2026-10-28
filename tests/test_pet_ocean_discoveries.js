'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Core=require('../static/pet-game-core.js'),Ocean=require('../static/pet-ocean-discoveries.js');
const copy=value=>JSON.parse(JSON.stringify(value));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function fixture(seed,choose=true){
 let now=Date.UTC(2026,9,29,3),mode='ok',pending=null,attempts=0;
 const data=new Map(seed||[]),writes=[];
 const storage={getItem:key=>data.get(key)??null,async setItem(key,value){attempts++;if(pending)await pending;
  if(mode==='throw')throw Error('synthetic storage failure');if(mode==='false')return false;if(mode==='object')return {ok:false};
  data.set(key,value);writes.push([key,value]);}};
 const options={storage,now:()=>now,random:()=>.5},app=Core.create(options),ready=await app.ready;
 if(ready.ok&&choose&&Core.needsEggChoice(app.getState()))assert.equal((await app.dispatch({type:'chooseEgg',eggOrigin:'lilac'})).ok,true);
 return {app,ready,data,writes,options,get now(){return now;},get attempts(){return attempts;},raw:()=>data.get(Core.KEY),state:()=>JSON.parse(data.get(Core.KEY)),clock:value=>now=value,advance:ms=>now+=ms,mode:value=>mode=value,pending:value=>pending=value,
  record(id='shell',extra={},revision=app.getState().revision){const row=Ocean.encounters.find(x=>x.id===id)||Ocean.encounters[0];return app.dispatch({type:'recordOceanDiscovery',expectedRevision:revision,creatureId:id,position:copy(row.position),mode:'underwater',depth:1.15,...extra});}};
}
function onlyCollection(before,after){
 const a=copy(before),b=copy(after);delete a.oceanDiscoveries;delete b.oceanDiscoveries;
 b.revision=a.revision;b.updatedAt=a.updatedAt;assert.deepEqual(b,a,'all existing saved data is preserved');
}
test('one immutable authored habitat defines all four distinct observation anchors and water/depth bounds',()=>{
 assert.deepEqual(Ocean.encounters.map(row=>row.id),['shell','starfish','kelp','reef_fish']);
 assert.ok(Object.isFrozen(Ocean)&&Object.isFrozen(Ocean.encounters)&&Object.isFrozen(Ocean.limits));
 for(const row of Ocean.encounters){
  assert.ok(Object.isFrozen(row)&&Object.isFrozen(row.position));assert.equal(Ocean.isWater(row.position),true);
  assert.equal(Ocean.canObserve(row.id,row.position,'underwater',1.15),true);
  assert.equal(Ocean.canObserve(row.id,row.position,'surface',1.15),false);
  assert.equal(Ocean.canObserve(row.id,row.position,'underwater',.79999),false);
  assert.equal(Ocean.canObserve(row.id,row.position,'underwater',1.15001),false);
  assert.equal(Ocean.canObserve(row.id,{x:row.position.x+70.001,y:row.position.y},'underwater',1.15),false);
  const near=Ocean.nearest(row.position,'underwater',1.15);assert.equal(near.id,row.id);near.position.x=0;assert.notEqual(row.position.x,0);
 }
 for(const p of [null,{x:0,y:0},{x:Infinity,y:1600},{x:2800,y:1499},{x:2800,y:1831}])assert.equal(Ocean.isWater(p),false);
 assert.ok(Number.isNaN(Ocean.coastX(NaN)));assert.ok(Number.isNaN(Ocean.coastX(-1)));
 assert.equal(Ocean.coastX(1450),2510);assert.equal(Ocean.coastX(1920),1990);
});
test('UMD browser module offers the same authored contract without storage, timers or Node imports',()=>{
 const context={};vm.runInNewContext(fs.readFileSync(require.resolve('../static/pet-ocean-discoveries.js'),'utf8'),context);
 const api=context.PetOceanDiscoveries;assert.equal(api.revision,Ocean.revision);
 assert.equal(JSON.stringify(api.encounters),JSON.stringify(Ocean.encounters));assert.equal(api.valid(api.empty()),true);
 assert.equal(api.canObserve('shell',copy(Ocean.encounters[0].position),'underwater',1.15),true);
});
test('module records and views are detached; duplicates and corrupt or sparse extensions never become extra counts',()=>{
 const empty=Ocean.empty(),row=Ocean.encounters[0],action={creatureId:row.id,position:row.position,mode:'underwater',depth:1.15,at:100};
 const next=Ocean.record(empty,action);assert.deepEqual(empty,Ocean.empty());assert.equal(Ocean.valid(next),true);
 const view=Ocean.view(next);assert.equal(view.total,1);assert.equal(view.entries[0].id,row.id);view.entries[0].name='changed';assert.notEqual(Ocean.view(next).entries[0].name,'changed');
 assert.throws(()=>Ocean.record(next,{...action,at:101}),{code:'ocean_already_discovered'});
 const sparse=Array(1),extra=[];extra.unexpected=true;
 const invalid=[null,{version:1,entries:[],extra:true},{version:2,entries:[]},{version:1,entries:sparse},{version:1,entries:extra},
  {version:1,entries:[{creatureId:'unknown',discoveredAt:1}]},{version:1,entries:[{creatureId:'shell',discoveredAt:-1}]},
  {version:1,entries:[{creatureId:'shell',discoveredAt:1,extra:true}]},{version:1,entries:[{creatureId:'shell',discoveredAt:1},{creatureId:'shell',discoveredAt:2}]},
  {version:1,entries:[{creatureId:'shell',discoveredAt:2},{creatureId:'kelp',discoveredAt:1}]}];
 for(const value of invalid){assert.equal(Ocean.valid(value),false);assert.throws(()=>Ocean.view(value),{code:'corrupt_data'});}
 assert.throws(()=>Ocean.record(next,{...action,creatureId:'kelp',position:Ocean.encounters[2].position,at:99}),{code:'clock_moved_back'});
});
test('old saves and collection getters do not initialize a field, write a key or normalize other records',async()=>{
 const first=await fixture(),raw=first.raw(),count=first.writes.length,second=Core.create(first.options);assert.equal((await second.ready).ok,true);
 assert.equal(Object.hasOwn(first.state(),'oceanDiscoveries'),false);
 for(const app of [first.app,second]){const view=app.getOceanDiscoveryView();assert.deepEqual(view,{version:1,entries:[],total:0,available:4,complete:false});view.entries.push({id:'fake'});assert.equal(app.getOceanDiscoveryView().total,0);}
 assert.equal(Core.getOceanDiscoveryView(first.app.getState()).total,0);assert.equal(first.raw(),raw);assert.equal(first.writes.length,count);
});
test('only an explicit nearby underwater observation creates a unique collection with no reward or economy mutation',async()=>{
 const g=await fixture(),before=g.state(),start=g.writes.length;
 for(const row of Ocean.encounters){g.advance(10);const previous=g.state(),result=await g.record(row.id);assert.equal(result.ok,true);assert.equal(Object.hasOwn(result,'reward'),false);onlyCollection(previous,g.state());}
 const after=g.state();onlyCollection(before,after);assert.equal(g.writes.length,start+4);
 assert.deepEqual(after.oceanDiscoveries.entries.map(row=>row.creatureId),Ocean.encounters.map(row=>row.id));
 assert.equal(g.app.getOceanDiscoveryView().total,4);assert.equal(g.app.getOceanDiscoveryView().complete,true);
 const raw=g.raw(),attempts=g.attempts;
 assert.equal((await g.record('shell')).error.code,'ocean_already_discovered');assert.equal(g.raw(),raw);assert.equal(g.attempts,attempts);
});
test('egg, surface, shallow, out-of-habitat, unknown and malformed requests never create discoveries',async()=>{
 const egg=await fixture(null,false),eggRaw=egg.raw();assert.equal((await egg.record()).error.code,'egg_required');assert.equal(egg.raw(),eggRaw);
 const g=await fixture(),raw=g.raw(),attempts=g.attempts;
 for(const extra of [{mode:'surface'},{mode:'swimming'},{mode:null},{depth:0},{depth:.79},{depth:1.2},{depth:NaN},{depth:Infinity},{depth:'1.15'},{position:null},{position:{x:0,y:0}},{position:{x:Infinity,y:1600}},{position:{x:Ocean.coastX(1600)+600,y:1600}}]){
  assert.equal((await g.record('shell',extra)).error.code,'invalid_ocean_discovery');
 }
 assert.equal((await g.record('not_a_creature')).error.code,'invalid_ocean_discovery');assert.equal(g.raw(),raw);assert.equal(g.attempts,attempts);
});
test('stale revisions, clocks and two concurrent observation actions preserve the winning record only',async()=>{
 const g=await fixture(),raw=g.raw(),revision=g.state().revision;
 assert.equal((await g.record('shell',{},revision-1)).error.code,'stale_state');g.clock(g.state().updatedAt-1);
 assert.equal((await g.record()).error.code,'clock_moved_back');assert.equal(g.raw(),raw);g.clock(NaN);assert.equal((await g.record()).error.code,'invalid_clock');assert.equal(g.raw(),raw);
 g.clock(Date.UTC(2026,9,29,4));const results=await Promise.all([g.record('shell',{},revision),g.record('starfish',{},revision)]);
 assert.equal(results[0].ok,true);assert.equal(results[1].error.code,'stale_state');assert.equal(g.app.getOceanDiscoveryView().total,1);
});
test('a stale second store cannot replace another store observation through the shared CAS record',async()=>{
 const g=await fixture(),second=Core.create(g.options);assert.equal((await second.ready).ok,true);const revision=second.getState().revision;
 assert.equal((await g.record('shell')).ok,true);const raw=g.raw(),row=Ocean.encounters[1],count=g.writes.length;
 const result=await second.dispatch({type:'recordOceanDiscovery',expectedRevision:revision,creatureId:row.id,position:copy(row.position),mode:'underwater',depth:1.15});
 assert.equal(result.error.code,'stale_state');assert.equal(g.raw(),raw);assert.equal(g.writes.length,count);assert.equal(g.app.getOceanDiscoveryView().entries[0].id,'shell');
});
for(const mode of ['false','throw','object'])test('a denied '+mode+' awaited save leaves the old collection byte-identical and can retry once',async()=>{
 const g=await fixture();assert.equal((await g.record('shell')).ok,true);const raw=g.raw(),view=g.app.getOceanDiscoveryView();g.mode(mode);
 assert.equal((await g.record('starfish')).error.code,'storage_failed');assert.equal(g.raw(),raw);assert.deepEqual(g.app.getOceanDiscoveryView(),view);
 g.mode('ok');assert.equal((await g.record('starfish')).ok,true);assert.equal(g.app.getOceanDiscoveryView().total,2);
});
test('the collection is not published until the existing async storage acknowledgment completes',async()=>{
 const g=await fixture(),hold=deferred(),raw=g.raw(),view=g.app.getOceanDiscoveryView();g.pending(hold.promise);
 const writing=g.record('shell');await new Promise(setImmediate);assert.equal(g.raw(),raw);assert.deepEqual(g.app.getOceanDiscoveryView(),view);
 let settled=false;writing.then(()=>settled=true);assert.equal(settled,false);hold.resolve();assert.equal((await writing).ok,true);assert.equal(g.app.getOceanDiscoveryView().total,1);
});
test('reload and backup round-trip the separate collection while leaving every earlier field intact',async()=>{
 const g=await fixture();await g.record('shell');g.advance(100);await g.record('reef_fish');const raw=g.raw(),count=g.writes.length,backup=g.app.exportBackup(),next=Core.create(g.options);
 assert.equal((await next.ready).ok,true);assert.equal(g.raw(),raw);assert.equal(g.writes.length,count);assert.deepEqual(next.getOceanDiscoveryView(),g.app.getOceanDiscoveryView());
 const before=g.state(),result=await next.importBackup(backup);assert.equal(result.ok,true);onlyCollection(before,g.state());assert.deepEqual(g.state().oceanDiscoveries,before.oceanDiscoveries);
});
test('corrupt collection state or out-of-record timestamps block loading without rewriting durable bytes',async()=>{
 for(const extension of [{version:1,entries:[{creatureId:'unknown',discoveredAt:0}]},{version:1,entries:[{creatureId:'shell',discoveredAt:0}]},{version:1,entries:[{creatureId:'shell',discoveredAt:Date.UTC(2030,0,1)}]}]){
  const g=await fixture(),seed=g.state();seed.oceanDiscoveries=extension;const raw=JSON.stringify(seed);g.data.set(Core.KEY,raw);const count=g.writes.length,app=Core.create(g.options);
  assert.equal((await app.ready).ok,false);assert.equal(app.getState().readOnly,true);assert.equal(g.raw(),raw);assert.equal(g.writes.length,count);
 }
});

function encryptedGate(seed={},deny=false){
 const values=new Map(Object.entries(seed)),storage={getItem:key=>values.get(key)??null,setItem(key,value){if(deny)throw Error('synthetic quota');values.set(key,String(value));},removeItem:key=>values.delete(key)};
 const context={localStorage:storage,crypto:require('node:crypto').webcrypto,TextEncoder,TextDecoder,
  btoa:value=>Buffer.from(value,'binary').toString('base64'),atob:value=>Buffer.from(value,'base64').toString('binary')};context.window=context;
 const html=fs.readFileSync(require.resolve('../index.html'),'utf8'),start=html.indexOf('/* knGate: encrypted localStorage gate');
 assert.ok(start>0);vm.runInNewContext(html.slice(start,html.indexOf('</script>',start)),context);
 return {context,values,storage:{getItem:key=>context.__knReadGameStorage(key),setItem:(key,value)=>context.__knPersistLocalSetting(key,value)}};
}
test('ocean observations round-trip the real encrypted awaited boundary; a failed encrypted save retains ciphertext and prior discoveries',async()=>{
 const gate=encryptedGate({pg_exp:'30'});await gate.context.__knGateReady;const now=()=>Date.UTC(2026,9,29,3),app=Core.create({storage:gate.storage,now});assert.equal((await app.ready).ok,true);
 const before=copy(app.getState()),keys=[...gate.values.keys()].sort(),row=Ocean.encounters[0];
 const action={type:'recordOceanDiscovery',creatureId:row.id,position:copy(row.position),mode:'underwater',depth:1.15,expectedRevision:app.getState().revision};
 assert.equal((await app.dispatch(action)).ok,true);assert.equal(gate.values.has(Core.KEY),false);const ciphertext=gate.values.get('knenc:'+Core.KEY);
 assert.match(ciphertext,/^knv1:/);assert.equal(ciphertext.includes('oceanDiscoveries'),false);assert.deepEqual([...gate.values.keys()].sort(),keys);
 const restored=encryptedGate(Object.fromEntries(gate.values));await restored.context.__knGateReady;const second=Core.create({storage:restored.storage,now});assert.equal((await second.ready).ok,true);
 assert.equal(restored.values.get('knenc:'+Core.KEY),ciphertext);assert.equal(second.getOceanDiscoveryView().total,1);
 for(const key of ['pet','coins','inventory','wardrobe','decorations','care','market','achievements'])assert.deepEqual(second.getState()[key],before[key],key);
 const denied=encryptedGate(Object.fromEntries(gate.values),true);await denied.context.__knGateReady;const third=Core.create({storage:denied.storage,now});assert.equal((await third.ready).ok,true);
 const next=Ocean.encounters[1],result=await third.dispatch({...action,creatureId:next.id,position:copy(next.position),expectedRevision:third.getState().revision});
 assert.equal(result.error.code,'storage_failed');assert.equal(denied.values.get('knenc:'+Core.KEY),ciphertext);assert.equal(third.getOceanDiscoveryView().total,1);
});

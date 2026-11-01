'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Seasons=require('../static/pet-japan-seasons.js'),Core=require('../static/pet-game-core.js'),Fishing=require('../static/pet-river-fishing.js'),Town=require('../static/pet-town-walk.js');
const springEnd=Date.UTC(2026,4,31,14,59,59),bank=Fishing.site().position,MAX=9000000000000;
async function game(initialTime=springEnd,seed){
 let ms=initialTime,mode='ok';const data=new Map(seed||[]),writes=[];
 const storage={getItem:k=>data.get(k)??null,async setItem(k,v){if(mode==='throw')throw Error('synthetic');if(mode==='false')return false;if(mode==='object')return {ok:false};data.set(k,v);writes.push([k,v]);}};
 const options={storage,now:()=>ms,random:()=>.5},app=Core.create(options),ready=await app.ready;
 if(ready.ok&&Core.needsEggChoice(app.getState()))await app.dispatch({type:'chooseEgg',eggOrigin:'lilac'});
 return {app,ready,options,data,writes,raw:()=>data.get(Core.KEY),state:()=>JSON.parse(data.get(Core.KEY)),time:n=>ms=n,advance:n=>ms+=n,mode:v=>mode=v,
 act:(type,fields={},revision=app.getState().revision)=>app.dispatch({type,expectedRevision:revision,...fields})};
}
function start(g){return g.act('startRiverFishing',{spotId:Fishing.site().id,position:bank});}
function reel(g){return g.act('reelRiverFishing',{attemptId:g.app.getState().riverFishing.active.id,position:bank});}
function castV1(ms,count){return {version:1,catches:{river_silverfish:count},active:{id:'river-7-'+ms,spotId:'south-bank',startedAt:ms,biteAt:ms+Fishing.WAIT,expiresAt:ms+Fishing.WINDOW},nextCastAt:ms+Fishing.COOLDOWN};}

test('legacy singleton counts and casts remain exact; getters across every season do not migrate or relabel them',()=>{
 assert.deepEqual(Fishing.empty(),{version:1,catches:{river_silverfish:0},active:null,nextCastAt:0});
 const old=castV1(springEnd,7),bytes=JSON.stringify(old);assert.equal(Fishing.valid(old),true);
 const v=Fishing.view(old,springEnd+Fishing.WAIT,Town.createWorld(),bank);
 assert.equal(v.fishId,'river_silverfish');assert.equal(v.fishName,'川の小魚');assert.deepEqual(v.fishCollection.map(r=>[r.id,r.name,r.count]),[['river_silverfish','川の小魚',7]]);
 const idle={...old,active:null};for(const month of [0,3,6,9]){
  const view=Fishing.view(idle,Date.UTC(2027,month,1),Town.createWorld(),bank);
  assert.equal(view.caught,7);assert.equal(view.fishCollection[0].id,'river_silverfish');
 }
 assert.equal(JSON.stringify(old),bytes);assert.equal(old.version,1);
});

test('prospective species recur by JST game season each year and all distinct owned species stay in the bag collection',()=>{
 const boundaries=[[2026,1,28,'river_cherry_salmon'],[2026,4,31,'river_ayu'],[2026,7,31,'river_salmon'],[2026,10,30,'river_smelt'],[2027,1,28,'river_cherry_salmon']];
 for(const [year,month,day,id] of boundaries){const ms=Date.UTC(year,month,day,15);assert.equal(Fishing.seasonFish(ms).id,id);assert.deepEqual(Fishing.seasonFish(ms),Seasons.life(ms).fish);}
 const s=Fishing.start(Fishing.empty(),springEnd,'river-1-'+springEnd);s.active=null;
 Fishing.fishIds.forEach((id,i)=>s.catches[id]=i+1);const bytes=JSON.stringify(s),a=Fishing.view(s,springEnd,Town.createWorld(),bank),b=Fishing.view(s,Date.UTC(2027,0,2),Town.createWorld(),bank);
 assert.equal(a.caught,15);assert.deepEqual(a.fishCollection,b.fishCollection);assert.deepEqual(a.fishCollection.map(r=>r.count),[1,2,3,4,5]);a.fishCollection[0].count=999;
 assert.equal(JSON.stringify(s),bytes);assert.notEqual(Fishing.view(s,springEnd,Town.createWorld(),bank).fishCollection[0].count,999);
});

test('a cast pins spring fish through the summer boundary, saves once, and the next explicit cast selects summer',async()=>{
 const g=await game(),before=g.state();assert.equal((await start(g)).ok,true);const active=g.state().riverFishing.active;
 assert.equal(active.fishId,'river_cherry_salmon');g.advance(Fishing.WAIT);assert.equal(g.app.getRiverFishingView(undefined,bank).fishId,'river_cherry_salmon');
 const caught=await reel(g);assert.deepEqual(caught.reward,{fishId:'river_cherry_salmon',quantity:1});
 assert.equal(g.state().riverFishing.catches.river_cherry_salmon,1);assert.equal(g.state().riverFishing.catches.river_silverfish,0);
 for(const k of ['coins','pet','inventory','care','achievements','market','wardrobe','decorations'])assert.deepEqual(g.state()[k],before[k],k);
 g.advance(Fishing.COOLDOWN);assert.equal((await start(g)).ok,true);assert.equal(g.state().riverFishing.active.fishId,'river_ayu');
 const raw=g.raw(),writes=g.writes.length,reopened=Core.create(g.options);assert.equal((await reopened.ready).ok,true);assert.equal(g.raw(),raw);assert.equal(g.writes.length,writes);assert.deepEqual(reopened.getState().riverFishing,g.state().riverFishing);
 assert.equal((await reopened.importBackup(g.app.exportBackup())).ok,true);assert.deepEqual(reopened.getState().riverFishing,g.state().riverFishing);
});

test('an existing legacy pending cast still credits only silverfish before a future explicit cast upgrades it',async()=>{
 const original=await game(),s=original.state();s.riverFishing=castV1(springEnd,7);original.data.set(Core.KEY,JSON.stringify(s));
 const g=await game(springEnd+Fishing.WAIT,Array.from(original.data));const before=g.raw(),writes=g.writes.length;
 assert.equal(g.app.getRiverFishingView(undefined,bank).fishId,'river_silverfish');assert.equal(g.raw(),before);assert.equal(g.writes.length,writes);
 assert.equal((await reel(g)).ok,true);assert.deepEqual(g.state().riverFishing.catches,{river_silverfish:8});assert.equal(g.state().riverFishing.version,1);
 g.advance(Fishing.COOLDOWN);assert.equal((await start(g)).ok,true);assert.equal(g.state().riverFishing.version,2);assert.equal(g.state().riverFishing.catches.river_silverfish,8);assert.equal(g.state().riverFishing.active.fishId,'river_ayu');
});

test('failed start ACK cannot publish a migration, seasonal count or pending cast',async()=>{
 for(const mode of ['false','object','throw']){
  const initial=await game(),s=initial.state();s.riverFishing=Fishing.empty();s.riverFishing.catches.river_silverfish=7;initial.data.set(Core.KEY,JSON.stringify(s));
  const g=await game(springEnd,Array.from(initial.data)),raw=g.raw(),old=g.app.getState().riverFishing;g.mode(mode);
  assert.equal((await start(g)).ok,false);assert.equal(g.raw(),raw);assert.deepEqual(g.app.getState().riverFishing,old);
  g.mode('ok');assert.equal((await start(g)).ok,true);assert.equal(g.state().riverFishing.catches.river_silverfish,7);
 }
});

test('failed reel ACK retains the exact pending cast and counters, and an explicit retry credits it once',async()=>{
 for(const mode of ['false','object','throw']){
  const g=await game();await start(g);g.advance(Fishing.WAIT);const raw=g.raw(),old=g.app.getState().riverFishing;g.mode(mode);
  assert.equal((await reel(g)).ok,false);assert.equal(g.raw(),raw);assert.deepEqual(g.app.getState().riverFishing,old);
  g.mode('ok');assert.equal((await reel(g)).ok,true);assert.equal(g.state().riverFishing.catches.river_cherry_salmon,1);assert.equal(g.state().riverFishing.catches.river_silverfish,0);
 }
});

test('seasonal overflow and stale duplicate reeling reject without changing any durable bytes',async()=>{
 const source=await game();await start(source);const s=source.state();s.riverFishing.catches.river_cherry_salmon=MAX;source.data.set(Core.KEY,JSON.stringify(s));
 const g=await game(springEnd+Fishing.WAIT,Array.from(source.data)),raw=g.raw();assert.equal((await reel(g)).error.code,'amount_overflow');assert.equal(g.raw(),raw);assert.equal(g.state().riverFishing.catches.river_cherry_salmon,MAX);
 const other=await game();await start(other);other.advance(Fishing.WAIT);const revision=other.app.getState().revision,id=other.app.getState().riverFishing.active.id;
 const action={attemptId:id,position:bank},results=await Promise.all([other.act('reelRiverFishing',action,revision),other.act('reelRiverFishing',action,revision)]);
 assert.equal(results[0].ok,true);assert.equal(results[1].error.code,'stale_state');assert.equal(other.state().riverFishing.catches.river_cherry_salmon,1);
});

test('strict v2 validation rejects missing/unknown counts and unpinned active identities while preserving invalid saved bytes',async()=>{
 const good=Fishing.start(Fishing.empty(),springEnd,'river-1-'+springEnd),bad=[];
 for(const mutate of [s=>delete s.catches.river_ayu,s=>s.catches.unknown=1,s=>s.catches.river_salmon=-1,s=>delete s.active.fishId,s=>s.active.fishId='unknown',s=>s.version=3]){const s=JSON.parse(JSON.stringify(good));mutate(s);assert.equal(Fishing.valid(s),false);bad.push(s);}
 const seed=await game(),s=seed.state();s.riverFishing=bad[0];const raw=JSON.stringify(s),g=await game(springEnd,[[Core.KEY,raw]]);assert.equal(g.ready.ok,false);assert.equal(g.app.getState().readOnly,true);assert.equal(g.raw(),raw);
});

test('missing calendar fails closed for a new cast while legacy pending identity stays readable',()=>{
 const context=vm.createContext({PetTownWalk:Town,legacyJSON:JSON.stringify(castV1(springEnd,7))});vm.runInContext(fs.readFileSync(require.resolve('../static/pet-river-fishing.js'),'utf8'),context);
 const api=context.PetRiverFishing,legacy=vm.runInContext('JSON.parse(legacyJSON)',context);assert.equal(api.view(legacy,springEnd,Town.createWorld(),bank).fishId,'river_silverfish');
 assert.equal(api.view(api.empty(),springEnd,Town.createWorld(),bank).canCast,false);assert.throws(()=>api.start(api.empty(),springEnd,'river-1-'+springEnd),e=>e.code==='invalid_fishing');
});

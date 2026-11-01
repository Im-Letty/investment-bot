'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Core=require('../static/pet-game-core.js'),Fishing=require('../static/pet-river-fishing.js'),Town=require('../static/pet-town-walk.js');
async function game(seed,choose=true){
 let now=Date.UTC(2026,9,25,12),mode='ok',pending=null;const data=new Map(seed||[]),writes=[];
 const storage={getItem:k=>data.get(k)??null,async setItem(k,v){if(pending)await pending;if(mode==='throw')throw Error('synthetic private');if(mode==='false')return false;if(mode==='object')return{ok:false};data.set(k,v);writes.push([k,v]);}};
 const opts={storage,now:()=>now,random:()=>.5},app=Core.create(opts);const ready=await app.ready;
 if(ready.ok&&choose&&Core.needsEggChoice(app.getState()))await app.dispatch({type:'chooseEgg',eggOrigin:'lilac'});
 return{app,opts,data,writes,ready,raw:()=>data.get(Core.KEY),state:()=>JSON.parse(data.get(Core.KEY)),time:n=>now=n,advance:n=>now+=n,get now(){return now;},mode:v=>mode=v,pending:v=>pending=v,
 act:(type,fields={},revision=app.getState().revision)=>app.dispatch({type,expectedRevision:revision,...fields})};
}
function start(g,p=Fishing.site().position){return g.act('startRiverFishing',{spotId:Fishing.site().id,position:p});}
function reel(g,fields={}){return g.act('reelRiverFishing',{attemptId:g.state().riverFishing.active.id,position:Fishing.site().position,...fields});}
test('one legal south-bank spot is dry, manually reachable, outside bridge/buildings, and never a water surface',()=>{
 const w=Town.createWorld(),s=Fishing.site(),before=JSON.stringify(w);
 assert.ok(Town.route(w,w.spawn,s.position));assert.equal(Fishing.legal(w,s.position),true);
 for(const p of [s.target,{x:2770,y:1160},{x:s.position.x,y:1160},w.spawn,{x:Infinity,y:1500},{x:NaN,y:1500},{x:s.position.x-200,y:1500}])assert.equal(Fishing.legal(w,p),false);
 w.places[0].x=s.position.x;w.places[0].y=s.position.y;assert.equal(Fishing.legal(w,s.position),false);
 w.places[0].x=s.position.x-240;w.places[0].y=s.position.y;w.places[0].entrance={...s.position};assert.equal(Fishing.legal(w,s.position),false,'a saved door-front cannot become a fishing location');
 assert.equal(JSON.stringify(Town.createWorld()),before);
});
test('old saves and read-only getters gain no fishing field or initialization writes',async()=>{
 const g=await game(),before=g.raw(),writes=g.writes.length,v=Core.getRiverFishingView(g.app.getState(),g.now,Fishing.site().position);
 assert.equal(v.caught,0);assert.equal(v.canCast,true);v.site.position.x=0;
 assert.equal(g.app.getRiverFishingView(g.now,Fishing.site().position).site.position.x,Fishing.site().position.x);
 assert.equal(g.raw(),before);assert.equal(g.writes.length,writes);assert.equal(Object.hasOwn(g.state(),'riverFishing'),false);
});
test('unchosen and malformed starts do not write or grant anything',async()=>{
 const egg=await game(null,false),before=egg.raw();assert.equal((await start(egg)).error.code,'egg_required');assert.equal(egg.raw(),before);
 const g=await game(),raw=g.raw();
 for(const p of [{x:2750,y:1500},{x:2770,y:1160},{x:0,y:0},null])assert.equal((await start(g,p)).error.code,'invalid_fishing');
 assert.equal((await g.act('startRiverFishing',{spotId:'home',position:Fishing.site().position})).error.code,'invalid_fishing');
 assert.equal((await g.act('startRiverFishing',{spotId:Fishing.site().id,position:Fishing.site().position},-1)).error.code,'stale_state');assert.equal(g.raw(),raw);
});
test('persisted cast requires real elapsed time and the same attempt once; catches are collectibles with no economy/care changes',async()=>{
 const g=await game(),before=g.state();assert.equal((await start(g)).ok,true);const active=g.state().riverFishing.active,castRaw=g.raw();
 assert.equal((await reel(g)).error.code,'fishing_wait');assert.equal(g.raw(),castRaw);
 g.advance(Fishing.WAIT);const rev=g.app.getState().revision;
 const results=await Promise.all([g.act('reelRiverFishing',{attemptId:active.id,position:Fishing.site().position},rev),g.act('reelRiverFishing',{attemptId:active.id,position:Fishing.site().position},rev)]);
 assert.equal(results[0].ok,true);assert.deepEqual(results[0].reward,{fishId:'river_salmon',quantity:1});assert.equal(results[1].error.code,'stale_state');
 const after=g.state();assert.equal(after.riverFishing.catches.river_salmon,1);assert.equal(after.riverFishing.active,null);
 for(const key of ['pet','coins','care','inventory','wardrobe','decorations','achievements','villageLife','market','legacyReserve'])assert.deepEqual(after[key],before[key],key);
 assert.equal((await g.act('reelRiverFishing',{attemptId:active.id,position:Fishing.site().position})).error.code,'invalid_fishing');
 assert.equal((await start(g)).error.code,'fishing_cooldown');g.advance(Fishing.COOLDOWN);assert.equal((await start(g)).ok,true);
});
test('leaving bank, expired window, wrong attempt and clock rollback cannot credit a fish',async()=>{
 const g=await game();await start(g);g.advance(Fishing.WAIT);const raw=g.raw(),id=g.state().riverFishing.active.id;
 assert.equal((await reel(g,{position:{x:2770,y:1160}})).error.code,'invalid_fishing');assert.equal((await reel(g,{attemptId:'river-0-0'})).error.code,'invalid_fishing');assert.equal(g.raw(),raw);
 g.advance(Fishing.WINDOW);assert.equal((await reel(g)).error.code,'fishing_escaped');assert.equal(g.raw(),raw);
 g.time(g.state().updatedAt-1);assert.equal((await g.act('cancelRiverFishing',{attemptId:id})).error.code,'clock_moved_back');assert.equal(g.raw(),raw);
 g.advance(Fishing.WINDOW+100);assert.equal((await g.act('cancelRiverFishing',{attemptId:id})).ok,true);assert.equal(g.state().riverFishing.catches.river_silverfish,0);
});
for(const mode of ['false','throw','object'])test('denied '+mode+' start/reel leaves durable bytes and in-memory ownership untouched, then same attempt can retry',async()=>{
 const g=await game(),before=g.raw();g.mode(mode);assert.equal((await start(g)).ok,false);assert.equal(g.raw(),before);assert.equal(g.app.getState().riverFishing,undefined);
 g.mode('ok');await start(g);g.advance(Fishing.WAIT);const cast=g.raw(),v=g.app.getState().riverFishing;g.mode(mode);assert.equal((await reel(g)).ok,false);assert.equal(g.raw(),cast);assert.deepEqual(g.app.getState().riverFishing,v);
 g.mode('ok');assert.equal((await reel(g)).ok,true);assert.equal(g.state().riverFishing.catches.river_salmon,1);
});
test('reload preserves a pending attempt without autocatch and backup round-trips collection',async()=>{
 const g=await game();await start(g);const raw=g.raw(),n=g.writes.length,second=Core.create(g.opts);await second.ready;
 assert.equal(g.raw(),raw);assert.equal(g.writes.length,n);assert.equal(second.getState().riverFishing.active.id,g.state().riverFishing.active.id);
 g.advance(Fishing.WAIT);assert.equal(second.getRiverFishingView(g.now,Fishing.site().position).phase,'bite');assert.equal(g.state().riverFishing.catches.river_silverfish,0);
 const id=second.getState().riverFishing.active.id;assert.equal((await second.dispatch({type:'reelRiverFishing',attemptId:id,position:Fishing.site().position,expectedRevision:second.getState().revision})).ok,true);
 const backup=second.exportBackup(),third=Core.create(g.opts);await third.ready;assert.equal(third.getState().riverFishing.catches.river_salmon,1);assert.equal((await third.importBackup(backup)).ok,true);
});
test('corrupt fishing extensions are blocked while raw old data is retained',async()=>{
 for(const bad of [{...Fishing.empty(),extra:true},{...Fishing.empty(),catches:{river_silverfish:-1}},{...Fishing.empty(),active:{id:'x'}}]){
  const g=await game(),s=g.state();s.riverFishing=bad;const raw=JSON.stringify(s);g.data.set(Core.KEY,raw);const next=Core.create(g.opts);assert.equal((await next.ready).ok,false);assert.equal(next.getState().readOnly,true);assert.equal(g.raw(),raw);
 }
});

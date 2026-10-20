'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../static/pet-game-core.js');

function memory(seed={}) {
  const data = new Map(Object.entries(seed));
  return {data,reads:[],writes:[],fail:false,
    getItem(k) {this.reads.push(k);return data.has(k)?data.get(k):null;},
    setItem(k,v) {this.writes.push([k,v]);if(this.fail)throw new Error('private failure must not appear');data.set(k,v);}
  };
}
async function game(seed={},random=()=>0.5) {
  const storage=memory(seed);let clock=new Date(2026,9,18,12).getTime();
  const options={storage,now:()=>clock,random};
  const app=Core.create(options);const ready=await app.ready;assert.equal(ready.ok,true,JSON.stringify(ready.error));
  return {app,storage,options,tick(ms=25000){clock+=ms;},day(){clock+=86400000;}};
}
function persisted(storage) {return JSON.parse(storage.data.get(Core.KEY));}
async function command(g,type,values={}) {return g.app.dispatch({type,...values});}
async function play(g,score=20) {
  const begin=await command(g,'beginMinigame',{kind:'catch'});assert.equal(begin.ok,true);g.tick();
  const end=await command(g,'finishMinigame',{sessionId:begin.reward.sessionId,score});return {begin,end};
}

test('fresh independent game has one durable record and no outside rewards',async()=>{
  const g=await game();assert.equal(g.app.getState().coins,100);assert.equal(g.app.getState().pet.exp,0);
  assert.equal(g.storage.writes.length,1);assert.equal(g.storage.writes[0][0],Core.KEY);
  assert.equal(g.app.getState().care.lastCareAt,null);
  assert.equal(g.storage.reads.includes('sk_last'),false);
  g.storage.reads=[];g.storage.data.set('sk_total','999');g.storage.data.set('pg_kakeibo_day','2026-10-18');
  g.storage.data.set('pg_morning_day','2026-10-18');
  const r=await command(g,'rename',{name:'ぽこ'});assert.equal(r.ok,true);
  assert.equal(r.state.pet.exp,0);assert.equal(r.state.coins,100);
  assert.deepEqual(g.storage.reads,[Core.KEY]);
});

test('migration fixes actual pg EXP including streak without degrading the stage',async()=>{
  const seed={pg_exp:'27',sk_total:'12',sk_streak:'15',pg_coins:'81',pg_name:'たま',pg_species:'bunny',
    pg_deco:JSON.stringify({house:{x:13},unknown:{x:32}}),pg_bgs:'["beach"]',pg_bg:'beach',pg_ach:'["letter","old-ach"]',
    pg_items:'{"rice":2}',pg_path:'cool',pg_px:'1',pg_cnt_pet:'52'};
  const g=await game(seed);const s=g.app.getState();
  assert.equal(s.pet.exp,167);assert.equal(Core.getStage(s.pet.exp).key,'final');
  assert.equal(s.pet.name,'たま');assert.equal(s.pet.species,'bunny');assert.equal(s.pet.path,'cool');assert.equal(s.pet.pixel,true);
  assert.equal(s.coins,81);assert.deepEqual(s.decorations.owned,{house:{x:13},unknown:{x:32}});
  assert.equal(s.decorations.background,'beach');assert.deepEqual(s.achievements,['letter','old-ach']);assert.equal(s.inventory.rice,2);
  assert.equal(s.care.lastCareAt,null);assert.equal(s.care.total.play,52);
  Object.entries(seed).forEach(([k,v])=>assert.equal(g.storage.data.get(k),v));
  g.storage.data.set('sk_total','9999');const count=g.storage.writes.length;
  const again=Core.create(g.options);assert.equal((await again.ready).ok,true);
  assert.equal(again.getState().pet.exp,167);assert.equal(g.storage.writes.length,count);
});

test('site counters and household/morning markers alone never migrate into new pet EXP',async()=>{
  const g=await game({sk_total:'300',sk_streak:'70',pg_kakeibo_day:'2026-10-18',pg_kakeibo_rwd:'2026-10-18',
    pg_morning_day:'2026-10-18',pg_login_day:'2026-10-18'});
  assert.equal(g.app.getState().pet.exp,0);assert.equal(g.app.getState().stage.key,'egg');
  assert.equal(g.app.getState().migration.source,'new');assert.equal(g.app.getState().migration.legacyRaw.sk_total,'300');
  const old=await game({pg_day:'2026-10-17',sk_total:'30',sk_streak:'14'});
  assert.equal(old.app.getState().pet.exp,320);assert.equal(old.app.getState().stage.key,'final');
});

test('final appearance changes are saved without reducing growth or replacing legacy appearance',async()=>{
  const fresh=await game();const before=fresh.storage.data.get(Core.KEY);
  assert.equal((await command(fresh,'chooseAppearance',{path:'cool',pixel:false})).error.code,'appearance_locked');
  assert.equal(fresh.storage.data.get(Core.KEY),before);
  const g=await game({pg_exp:'110',pg_path:'cool',pg_px:'1',pg_species:'bunny'});
  assert.equal(g.app.getState().pet.path,'cool');assert.equal(g.app.getState().pet.pixel,true);
  const r=await command(g,'chooseAppearance',{path:'cute',pixel:false});assert.equal(r.ok,true);assert.equal(r.state.pet.exp,110);
  assert.equal(r.state.stage.key,'final');assert.equal(r.state.pet.path,'cute');assert.equal(r.state.pet.pixel,false);
  assert.equal((await command(g,'chooseAppearance',{path:'new',pixel:false})).error.code,'invalid_appearance');
  const again=Core.create(g.options);await again.ready;assert.equal(again.getState().pet.path,'cute');assert.equal(again.getState().pet.exp,110);
});

test('lilac selection, reload and backup preserve the full grown pet and active economy',async()=>{
  const seed={pg_exp:'167',pg_name:'こはる',pg_species:'bunny',pg_path:'cool',pg_px:'1',pg_coins:'2000',
    pg_items:'{"apple":2,"rice":3}',pg_deco:'{"house":{"x":13},"lantern":{"x":32}}',
    pg_bgs:'["meadow","beach"]',pg_bg:'beach',pg_ach:'["old-ach"]',pg_cnt_feed:'24',pg_cnt_pet:'52',
    pet_game:'{"name":"別の子","coins":70,"exp":11,"foods":{"🍎":2},"pot":55,"potBasis":50,"potDays":3}'};
  const g=await game(seed,()=>0.99);
  for(const [type,values] of [['care',{kind:'feed'}],['buyItem',{itemId:'cake'}],['useItem',{itemId:'rice'}],
    ['equip',{itemId:'house'}],['buyItem',{itemId:'bg_room'}],['equip',{itemId:'bg_room'}],['buyStock',{stockId:'grn',quantity:5}]]){
    assert.equal((await command(g,type,values)).ok,true);
  }
  assert.equal((await play(g,20)).end.ok,true);
  for(let i=0;i<4;i++)assert.equal((await command(g,'advanceMarketDay')).ok,true);
  assert.equal((await command(g,'sellStock',{stockId:'grn',quantity:1})).ok,true);
  assert.equal((await command(g,'beginMinigame')).ok,true);
  const before=persisted(g.storage);
  assert.ok(before.market.dividends>0);assert.ok(before.market.feesPaid>0);
  assert.ok(before.minigames.active);assert.ok(before.minigames.completed.length);
  assert.ok(before.legacyReserve.available);assert.ok(before.pet.exp>167);
  g.tick(1234);
  const selected=await command(g,'chooseSpecies',{species:'lilac'});assert.equal(selected.ok,true);
  const expected={...before,pet:{...before.pet,species:'lilac'},revision:before.revision+1,updatedAt:g.options.now()};
  assert.deepEqual(persisted(g.storage),expected);
  assert.equal(selected.state.stage.key,'final');
  Object.entries(seed).forEach(([key,value])=>assert.equal(g.storage.data.get(key),value));
  const writes=g.storage.writes.length,reloaded=Core.create(g.options);
  assert.equal((await reloaded.ready).ok,true);assert.deepEqual(reloaded.getState(),selected.state);
  assert.equal(g.storage.writes.length,writes);
  const other=await game(),otherBefore=persisted(other.storage);
  assert.equal((await other.app.importBackup(reloaded.exportBackup())).ok,true);
  assert.deepEqual(persisted(other.storage),{...expected,revision:otherBefore.revision+1,updatedAt:other.options.now()});
  const restored=Core.create(other.options);assert.equal((await restored.ready).ok,true);
  assert.deepEqual(restored.getState(),other.app.getState());
});

test('lilac can be selected at every growth boundary and old species remain selectable',async()=>{
  const fresh=await game();assert.equal(fresh.app.getState().pet.species,'dragon');
  for(const species of ['dragon','bunny'])for(const exp of [0,14,15,44,45,109,110,98765]){
    const g=await game({pg_species:species,pg_exp:String(exp),pg_name:'もとの子',pg_path:'cool',pg_px:'1'});
    const before=g.app.getState().pet;
    assert.equal((await command(g,'chooseSpecies',{species:'lilac'})).ok,true);
    assert.deepEqual(g.app.getState().pet,{...before,species:'lilac'});
    const reload=Core.create(g.options);assert.equal((await reload.ready).ok,true);
    assert.deepEqual(reload.getState().pet,{...before,species:'lilac'});
    assert.equal((await command(g,'chooseSpecies',{species})).ok,true);
    assert.deepEqual(g.app.getState().pet,before);
    assert.equal(g.storage.data.get('pg_species'),species);
  }
});

test('failed lilac saves never publish a selection or alter the durable state',async()=>{
  for(const mode of ['throw','false']){
    const g=await game({pg_exp:'167',pg_name:'もとの子',pg_species:'bunny',pg_path:'cool',pg_px:'1',pg_coins:'500',pg_items:'{"rice":2}'});
    assert.equal((await command(g,'buyStock',{stockId:'apl',quantity:2})).ok,true);
    const raw=g.storage.data.get(Core.KEY),before=g.app.getState(),observed=[];
    g.app.subscribe(s=>observed.push(s));
    const set=g.storage.setItem.bind(g.storage);
    g.storage.setItem=async()=>{if(mode==='throw')throw new Error('private failure');return false;};
    const rejected=await command(g,'chooseSpecies',{species:'lilac'});
    assert.equal(rejected.ok,false);assert.equal(rejected.error.code,'storage_failed');
    assert.equal(g.storage.data.get(Core.KEY),raw);
    assert.deepEqual({...rejected.state,error:null},before);
    assert.ok(observed.length>0);assert.ok(observed.every(s=>s.pet.species==='bunny'));
    const reload=Core.create(g.options);assert.equal((await reload.ready).ok,true);
    assert.deepEqual(reload.getState(),before);
    g.storage.setItem=set;
    assert.equal((await command(g,'chooseSpecies',{species:'lilac'})).ok,true);
    assert.equal(g.app.getState().pet.species,'lilac');
  }
});

test('legacy decoration arrays and old current-day game limits are preserved',async()=>{
  const day=new Date(2026,9,18);const k=day.getFullYear()+'-'+(day.getMonth()+1)+'-'+day.getDate();
  const g=await game({pg_deco:'["house","flower"]',pg_day:k,pg_feed:'3',pg_pet:'8',pg_play:'3'});
  assert.deepEqual(g.app.getState().decorations.owned,{house:{},flower:{}});
  assert.equal((await command(g,'care',{kind:'feed'})).error.code,'daily_limit');
  assert.equal((await command(g,'beginMinigame')).error.code,'daily_limit');
});

test('separate legacy wallet, EXP, food, decoration, pot and market stay reserved until explicit transfer',async()=>{
  const old={name:'別の子',coins:65,exp:18,equipped:'🎩',foods:{'🍎':2,'🍙':1},decos:{'🎩':1},pot:55,potBasis:50,potDays:3,
    _mkt:{day:29,price:{apl:38},hold:{apl:2},cost:{apl:71.5},hist:[38]}};
  const raw=JSON.stringify(old);const g=await game({pg_coins:'10',pg_exp:'5',pet_game:raw});
  let s=g.app.getState();assert.equal(s.coins,10);assert.equal(s.pet.exp,5);assert.deepEqual(s.inventory,{});
  assert.equal(s.market.holdings.apl.quantity,0);assert.equal(s.legacyReserve.available,true);
  assert.equal(s.legacyReserve.sourceRaw,raw);assert.deepEqual(s.legacyReserve.market,old._mkt);
  assert.equal(s.legacyReserve.name,'別の子');
  const transferred=await command(g,'transferLegacy');assert.equal(transferred.ok,true);s=transferred.state;
  assert.equal(s.coins,75);assert.equal(s.pet.exp,23);assert.equal(s.inventory.apple,2);assert.equal(s.inventory.rice,1);
  assert.equal(s.pet.name,'別の子');assert.equal(s.legacyReserve.name,'別の子');
  assert.equal(s.decorations.equipped,'🎩');assert.equal(s.market.holdings.apl.quantity,2);assert.equal(s.market.holdings.apl.costBasis,71.5);
  assert.deepEqual(s.market.legacyPriceSnapshot,old._mkt.price);assert.equal(s.market.legacyPot.value,55);
  assert.equal(s.legacyReserve.sourceRaw,raw);assert.equal(g.storage.data.get('pet_game'),raw);
  assert.equal((await command(g,'transferLegacy')).error.code,'legacy_already_transferred');
  assert.equal((await command(g,'useItem',{itemId:'apple'})).ok,true);
  assert.equal((await command(g,'equip',{itemId:'🎩'})).ok,true);
  const withdraw=await command(g,'withdrawLegacyPot');assert.equal(withdraw.ok,true);assert.equal(withdraw.reward.coins,55);
  assert.equal(withdraw.state.coins,130);assert.equal(withdraw.state.market.realizedProfit,5);
  assert.equal(withdraw.state.legacyReserve.pot.value,55);assert.equal(withdraw.state.market.legacyPot.withdrawnValue,55);
  assert.equal((await command(g,'withdrawLegacyPot')).error.code,'legacy_pot_empty');
  const reloaded=Core.create(g.options);assert.equal((await reloaded.ready).ok,true);
  assert.equal(reloaded.getState().market.holdings.apl.costBasis,71.5);assert.equal(reloaded.getState().legacyReserve.transferred,true);
});

test('legacy name remains visible without replacing a named main pet',async()=>{
  const g=await game({pg_name:'もとの子',pg_exp:'0',pet_game:'{"name":"別の子","coins":1}'});
  const r=await command(g,'transferLegacy');assert.equal(r.ok,true);assert.equal(r.state.pet.name,'もとの子');
  assert.equal(r.state.legacyReserve.name,'別の子');assert.equal(JSON.parse(r.state.legacyReserve.sourceRaw).name,'別の子');
});

test('legacy fractional price and total basis remain archived and do not revert to new base prices',async()=>{
  const old={coins:10,exp:8,_mkt:{price:{apl:73.125},hold:{apl:2},cost:{apl:132.75}}};
  const g=await game({pet_game:JSON.stringify(old)});const r=await command(g,'transferLegacy');
  assert.equal(r.ok,true);assert.equal(r.state.market.prices.apl,73);assert.equal(r.state.market.previous.apl,73);
  assert.deepEqual(r.state.market.holdings.apl,{quantity:2,costBasis:132.75});
  assert.equal(r.state.legacyReserve.market.price.apl,73.125);assert.equal(r.state.market.legacyPriceSnapshot.apl,73.125);
  assert.deepEqual(r.state.market.legacyConversion,[{stockId:'apl',sourcePrice:73.125,gamePrice:73,quantity:2,valuationDifference:-0.25,reason:'integer_coin_price'}]);
});

test('malformed or unsupported legacy/v3 records are never overwritten with defaults',async()=>{
  const cases=[{pet_game:'{'},{pet_game:'[]'},{pg_exp:'-1'},{pg_coins:'NaN'},{pg_deco:'null'},
    {pg_bgs:'{}'},{pg_ach:'{'},{pg_species:'unknown'},{pg_species:'lilac'},{pet_game:'{"coins":-1}'},
    {[Core.KEY]:'{'},{[Core.KEY]:'null'},{[Core.KEY]:'{"version":9}'},
    {pet_game:'{"_mkt":{"price":{"apl":30},"hold":{"apl":1},"cost":{"apl":-1}}}'}];
  for(const seed of cases){const storage=memory(seed);const app=Core.create({storage});const r=await app.ready;
    assert.equal(r.ok,false,JSON.stringify(seed));assert.equal(app.getState().readOnly,true);assert.equal(storage.writes.length,0);
    assert.equal((await app.dispatch({type:'care',kind:'feed'})).ok,false);assert.equal(storage.writes.length,0);
    for(const [k,v] of Object.entries(seed))assert.equal(storage.data.get(k),v);
  }
});

test('failed legacy decryption/read does not create a new v3 record',async()=>{
  const storage=memory();const legacy={getItem(k){if(k==='pet_game')throw new Error('hidden URL or key');return null;}};
  const app=Core.create({storage,legacy});const r=await app.ready;assert.equal(r.ok,false);assert.equal(storage.writes.length,0);
  assert.doesNotMatch(JSON.stringify(r.error),/hidden|URL|key/);
});

test('care is bounded each day; daily coins depend on actual care, not opening the app',async()=>{
  const g=await game();for(let i=0;i<3;i++){const r=await command(g,'care',{kind:'feed'});assert.equal(r.ok,true);assert.equal(r.reward.coins,i===0?10:0);}
  const before=g.storage.data.get(Core.KEY);assert.equal((await command(g,'care',{kind:'feed'})).error.code,'daily_limit');assert.equal(g.storage.data.get(Core.KEY),before);
  assert.equal(g.app.getState().pet.exp,24);assert.equal(g.app.getState().coins,110);
  await command(g,'care',{kind:'play'});await command(g,'care',{kind:'rest'});assert.equal(g.app.getState().coins,110);
  g.day();const reloaded=Core.create(g.options);await reloaded.ready;assert.equal(reloaded.getState().coins,110);
  const r=await reloaded.dispatch({type:'care',kind:'feed'});assert.equal(r.reward.coins,10);assert.equal(r.state.coins,120);
  g.tick(-86400000);assert.equal((await reloaded.dispatch({type:'care',kind:'feed'})).error.code,'clock_moved_back');
});

test('minigame session survives reload and a valid result grants coins, bounded EXP and one item only once',async()=>{
  const g=await game();const b=await command(g,'beginMinigame');assert.equal(b.ok,true);
  assert.equal((await command(g,'finishMinigame',{sessionId:b.reward.sessionId,score:15})).error.code,'game_too_short');
  const reloaded=Core.create(g.options);await reloaded.ready;assert.equal(reloaded.getState().minigames.active.id,b.reward.sessionId);
  g.tick();const r=await reloaded.dispatch({type:'finishMinigame',sessionId:b.reward.sessionId,score:30});
  assert.equal(r.ok,true);assert.equal(r.reward.coins,30);assert.equal(r.reward.exp,10);assert.deepEqual(r.reward.items,[{id:'berry',count:1}]);
  assert.equal(r.state.coins,130);assert.equal(r.state.inventory.berry,1);assert.equal(r.state.minigames.active,null);
  const prior=g.storage.data.get(Core.KEY);assert.equal((await reloaded.dispatch({type:'finishMinigame',sessionId:b.reward.sessionId,score:30})).ok,false);
  assert.equal(g.storage.data.get(Core.KEY),prior);assert.equal(reloaded.getState().coins,130);
});

test('abandoned and cancelled minigame starts still consume the daily budget',async()=>{
  const g=await game();for(let i=0;i<3;i++) {const b=await command(g,'beginMinigame');assert.equal(b.ok,true);
    assert.equal((await command(g,'beginMinigame')).error.code,'game_active');
    assert.equal((await command(g,'cancelMinigame',{sessionId:b.reward.sessionId})).ok,true);}
  assert.equal((await command(g,'beginMinigame')).error.code,'daily_limit');
  assert.equal(g.app.getState().coins,100);g.day();assert.equal((await command(g,'beginMinigame')).ok,true);
});

test('invalid minigame scores and sessions do not alter durable progress',async()=>{
  const g=await game();const b=await command(g,'beginMinigame');g.tick();
  for(const score of [-1,31,1.5,NaN,Infinity,'3']) {const before=g.storage.data.get(Core.KEY);
    assert.equal((await command(g,'finishMinigame',{sessionId:b.reward.sessionId,score})).ok,false);assert.equal(g.storage.data.get(Core.KEY),before);}
  assert.equal((await command(g,'finishMinigame',{sessionId:'wrong',score:3})).ok,false);
  assert.equal((await command(g,'finishMinigame',{sessionId:b.reward.sessionId,score:0})).ok,true);
  assert.equal(g.app.getState().coins,100);assert.deepEqual(g.app.getState().inventory,{});
});

test('shop, food and equipment all use the same persisted wallet',async()=>{
  const g=await game();assert.equal((await command(g,'buyItem',{itemId:'feast'})).state.coins,85);
  const used=await command(g,'useItem',{itemId:'feast'});assert.equal(used.reward.exp,20);assert.equal(used.state.stage.key,'baby');
  assert.equal((await command(g,'useItem',{itemId:'feast'})).error.code,'not_owned');
  await command(g,'buyItem',{itemId:'house'});assert.equal((await command(g,'equip',{itemId:'house'})).ok,true);
  await command(g,'buyItem',{itemId:'bg_beach'});assert.equal((await command(g,'equip',{itemId:'bg_beach'})).ok,true);
  assert.equal(g.app.getState().coins,5);assert.equal(g.app.getState().decorations.background,'beach');
  assert.equal((await command(g,'buyItem',{itemId:'house'})).ok,false);
  const reload=Core.create(g.options);await reload.ready;assert.equal(reload.getState().decorations.equipped,'house');assert.equal(reload.getState().pet.exp,20);
});

test('trade fees, average basis, partial sale and realized loss balance exactly',async()=>{
  const g=await game();let r=await command(g,'buyStock',{stockId:'apl',quantity:2});assert.equal(r.ok,true);
  assert.equal(r.reward.fee,1);assert.equal(r.state.coins,19);assert.deepEqual(r.state.market.holdings.apl,{quantity:2,costBasis:81});
  assert.equal(r.state.marketSummary.unrealizedProfit,-1);
  r=await command(g,'sellStock',{stockId:'apl',quantity:1});assert.equal(r.state.coins,58);assert.equal(r.reward.realizedProfit,-1.5);
  assert.deepEqual(r.state.market.holdings.apl,{quantity:1,costBasis:40.5});
  r=await command(g,'sellStock',{stockId:'apl',quantity:1});assert.equal(r.state.coins,97);assert.equal(r.state.market.realizedProfit,-3);
  assert.equal(r.state.market.feesPaid,3);assert.deepEqual(r.state.market.holdings.apl,{quantity:0,costBasis:0});
  assert.equal(r.state.marketSummary.totalAssets,97);assert.equal(r.state.pet.exp,0);
});

test('invalid, fractional, negative, excessive and nonfinite stock orders are rejected without writes',async()=>{
  const g=await game();for(const quantity of [0,-1,0.1,NaN,Infinity,'1',1e13]){
    const before=g.storage.data.get(Core.KEY);assert.equal((await command(g,'buyStock',{stockId:'apl',quantity})).ok,false);assert.equal(g.storage.data.get(Core.KEY),before);}
  assert.equal((await command(g,'buyStock',{stockId:'unknown',quantity:1})).ok,false);
  assert.equal((await command(g,'buyStock',{stockId:'rkt',quantity:2})).error.code,'insufficient_coins');
  assert.equal((await command(g,'sellStock',{stockId:'apl',quantity:1})).error.code,'insufficient_shares');
});

test('fictional prices can rise and fall, pay bounded dividends once and persist with holdings',async()=>{
  let random=0.99;const g=await game({},()=>random);await command(g,'buyStock',{stockId:'grn',quantity:3});
  const up=await command(g,'advanceMarketDay');assert.ok(up.state.market.prices.grn>25);
  random=0;const down=await command(g,'advanceMarketDay');assert.ok(down.state.market.prices.grn<up.state.market.prices.grn);
  random=0.99;await command(g,'advanceMarketDay');const div=await command(g,'advanceMarketDay');assert.equal(div.state.market.day,5);assert.ok(div.reward.dividend>0);
  const again=await command(g,'advanceMarketDay');assert.equal(again.reward.dividend,0);assert.equal(again.state.market.dividends,div.reward.dividend);
  assert.equal(again.state.pet.exp,0);const reload=Core.create(g.options);await reload.ready;
  assert.deepEqual(reload.getState().market,again.state.market);
  for(let i=5;i<12;i++)assert.equal((await command(g,'advanceMarketDay')).ok,true);
  assert.equal((await command(g,'advanceMarketDay')).error.code,'daily_limit');g.day();assert.equal((await command(g,'advanceMarketDay')).ok,true);
});

test('save failure changes neither durable nor live economy and exposes only a fixed error',async()=>{
  const g=await game();const before=g.storage.data.get(Core.KEY);const old=g.app.getState();g.storage.fail=true;
  const r=await command(g,'care',{kind:'feed'});assert.equal(r.ok,false);assert.equal(r.error.code,'storage_failed');
  assert.doesNotMatch(JSON.stringify(r.error),/private/);assert.equal(g.storage.data.get(Core.KEY),before);
  assert.deepEqual(r.state.pet,old.pet);assert.equal(r.state.coins,old.coins);assert.deepEqual(r.state.care,old.care);
  g.storage.fail=false;const retry=await command(g,'care',{kind:'feed'});assert.equal(retry.ok,true);assert.equal(retry.state.coins,110);assert.equal(retry.state.pet.exp,8);
});

test('awaited encrypted-adapter write completes before publishing any state or reward',async()=>{
  const g=await game();const set=g.storage.setItem.bind(g.storage);let release;
  g.storage.setItem=async(k,v)=>new Promise(resolve=>{release=()=>{set(k,v);resolve();};});
  const pending=command(g,'care',{kind:'feed'});while(!release)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(g.app.getState().pet.exp,0);assert.equal(g.app.getState().coins,100);
  release();const r=await pending;assert.equal(r.ok,true);assert.equal(r.state.pet.exp,8);assert.equal(r.state.coins,110);
  g.storage.setItem=async()=>{throw new Error('key=https://private.invalid');};
  const rejected=await command(g,'care',{kind:'rest'});assert.equal(rejected.ok,false);assert.equal(rejected.state.pet.exp,8);assert.doesNotMatch(JSON.stringify(rejected.error),/key=|https:/);
});

test('explicit false storage result is not mistaken for durable success',async()=>{
  const g=await game();g.storage.setItem=async()=>false;const r=await command(g,'care',{kind:'feed'});
  assert.equal(r.ok,false);assert.equal(r.state.pet.exp,0);assert.equal(r.state.coins,100);
});

test('concurrent commands serialize and a second store cannot overwrite a newer wallet',async()=>{
  const g=await game();const second=Core.create(g.options);await second.ready;
  const results=await Promise.all([1,2,3,4].map(()=>command(g,'care',{kind:'feed'})));
  assert.equal(results.filter(x=>x.ok).length,3);assert.equal(g.app.getState().coins,110);assert.equal(g.app.getState().pet.exp,24);
  const before=g.storage.data.get(Core.KEY);const stale=await second.dispatch({type:'care',kind:'rest'});
  assert.equal(stale.ok,false);assert.equal(stale.error.code,'stale_state');assert.equal(g.storage.data.get(Core.KEY),before);
});

test('backups round-trip the full economy and preserve additive fields but reject corrupt inputs',async()=>{
  const g=await game();await command(g,'buyStock',{stockId:'apl',quantity:1});await play(g,20);const saved=g.app.exportBackup();
  const backup=JSON.parse(saved);backup.state.futureField={retained:true};assert.equal((await g.app.importBackup(JSON.stringify(backup))).ok,true);
  const other=await game();assert.equal((await other.app.importBackup(g.app.exportBackup())).ok,true);
  assert.deepEqual(other.app.getState().market,g.app.getState().market);assert.deepEqual(other.app.getState().inventory,g.app.getState().inventory);
  assert.deepEqual(persisted(other.storage).futureField,{retained:true});
  for(const mutate of [s=>{s.coins=-1;},s=>{s.market.holdings.apl.quantity=0.5;},s=>{s.pet.exp=null;},s=>{s.version=4;}]){
    const b=JSON.parse(saved);mutate(b.state);const before=other.storage.data.get(Core.KEY);
    assert.equal((await other.app.importBackup(JSON.stringify(b))).ok,false);assert.equal(other.storage.data.get(Core.KEY),before);}
  for(const raw of ['{','null','[]','{"format":"PetGameBackup","version":3,"state":{"__proto__":{}}}'])assert.equal((await other.app.importBackup(raw)).ok,false);
});

test('subscribers receive detached states and exceptions cannot roll back a saved transition',async()=>{
  const g=await game();let observed=0;const stop=g.app.subscribe(s=>{observed++;s.coins=999999;throw new Error('listener');});
  assert.equal((await command(g,'care',{kind:'feed'})).ok,true);assert.equal(observed,1);assert.equal(g.app.getState().coins,110);
  const detached=g.app.getState();detached.inventory.feast=999;assert.equal(g.app.getState().inventory.feast,undefined);
  stop();await command(g,'care',{kind:'rest'});assert.equal(observed,1);
});

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
async function game(seed={},random=()=>0.5,selectEgg=true) {
  const storage=memory(seed);let clock=new Date(2026,9,18,12).getTime();
  const options={storage,now:()=>clock,random};
  const app=Core.create(options);const ready=await app.ready;assert.equal(ready.ok,true,JSON.stringify(ready.error));
  // Existing economy tests start after the user's successful egg confirmation.
  // Onboarding tests explicitly pass false and exercise the untouched first-run record.
  if(selectEgg&&Core.needsEggChoice(app.getState()))assert.equal((await app.dispatch({type:'chooseEgg',eggOrigin:'lilac'})).ok,true);
  return {app,storage,options,tick(ms=25000){clock+=ms;},day(){clock+=86400000;}};
}
function persisted(storage) {return JSON.parse(storage.data.get(Core.KEY));}
async function command(g,type,values={}) {return g.app.dispatch({type,...values});}
async function play(g,score=20) {
  const begin=await command(g,'beginMinigame',{kind:'catch'});assert.equal(begin.ok,true);g.tick();
  const end=await command(g,'finishMinigame',{sessionId:begin.reward.sessionId,score});return {begin,end};
}

test('three frozen birth origins are separate from the six care-driven evolution paths',()=>{
  assert.equal(Object.isFrozen(Core.eggCatalogue),true);
  assert.deepEqual(Core.eggCatalogue.map(row=>[row.key,row.eggLabel,row.characterName,row.colorName,row.color]),[
    ['lilac','すみれのたまご','ふわり','薄紫','#b5a0d9'],
    ['mint','しずくのたまご','しずく','ミント','#98c8be'],
    ['apricot','ひだまりのたまご','まる','杏色','#e6bb8e']
  ]);
  for(const row of Core.eggCatalogue){assert.equal(Object.isFrozen(row),true);assert.strictEqual(Core.eggProfile(row.key),row);assert.ok(row.description.length>0);}
  for(const bad of[undefined,null,'unknown','__proto__',{},[]])assert.strictEqual(Core.eggProfile(bad),Core.eggCatalogue[0]);
  assert.deepEqual(Core.lilacEvolutionPaths.map(row=>row.key),['balanced','fruit','hearty','sweet','active','calm']);
});

test('a true first run persists an unchosen egg and cannot mutate the game before confirmation',async()=>{
  const g=await game({},()=>.5,false),s=g.app.getState(),raw=g.storage.data.get(Core.KEY);
  assert.equal(g.storage.writes.length,1);assert.equal(s.pet.eggOrigin,null);assert.equal(s.pet.exp,0);assert.equal(s.coins,100);
  assert.deepEqual(s.achievements,[]);assert.equal(Core.getEggOrigin(s),null);assert.equal(Core.needsEggChoice(s),true);
  assert.equal(g.app.getEggOrigin(s),null);assert.equal(g.app.needsEggChoice(s),true);assert.equal(s.readOnly,false);
  for(const action of[{type:'care',kind:'feed'},{type:'rename',name:'まだ選べない'},{type:'chooseSpecies',species:'bunny'},
    {type:'chooseAppearance',path:'cool',pixel:false},{type:'buyItem',itemId:'cloth_cream_vest'},{type:'equip',itemId:'house'},
    {type:'beginMinigame'},{type:'buyStock',stockId:'grn',quantity:1},{type:'advanceMarketDay'},{type:'transferLegacy'},{type:'withdrawLegacyPot'}]){
    const r=await g.app.dispatch(action);assert.equal(r.ok,false,action.type);assert.equal(r.error.code,'egg_required',action.type);
    assert.equal(g.storage.data.get(Core.KEY),raw);assert.equal(r.state.pet.exp,0);assert.equal(r.state.coins,100);
  }
  const reload=Core.create(g.options),writes=g.storage.writes.length;assert.equal((await reload.ready).ok,true);
  assert.equal(Core.needsEggChoice(reload.getState()),true);assert.equal(g.storage.writes.length,writes);assert.equal(g.storage.data.get(Core.KEY),raw);
});

test('each egg is confirmed exactly once with identity only, then survives reload and backups',async()=>{
  for(const egg of Core.eggCatalogue){
    const g=await game({},()=>.5,false),before=persisted(g.storage);g.tick(234);
    const r=await command(g,'chooseEgg',{eggOrigin:egg.key,exp:99999,coins:99999,price:-100,species:'bunny'});
    assert.equal(r.ok,true);assert.deepEqual(r.reward,{});assert.equal(Core.needsEggChoice(r.state),false);assert.equal(Core.getEggOrigin(r.state),egg.key);
    const expected={...before,pet:{...before.pet,eggOrigin:egg.key},revision:before.revision+1,updatedAt:g.options.now()};
    assert.deepEqual(persisted(g.storage),expected);assert.deepEqual(r.state.achievements,[]);assert.equal(r.state.pet.exp,0);assert.equal(r.state.coins,100);
    assert.equal(Object.hasOwn(r.state,'evolution'),false);assert.deepEqual(r.state.care,before.care);
    const raw=g.storage.data.get(Core.KEY),writes=g.storage.writes.length,reload=Core.create(g.options);assert.equal((await reload.ready).ok,true);
    assert.equal(Core.getEggOrigin(reload.getState()),egg.key);assert.equal(g.storage.data.get(Core.KEY),raw);assert.equal(g.storage.writes.length,writes);
    for(const key of Core.eggCatalogue.map(row=>row.key)){const rejected=await command(g,'chooseEgg',{eggOrigin:key});assert.equal(rejected.error.code,'egg_already_chosen');assert.equal(g.storage.data.get(Core.KEY),raw);}
    const other=await game({},()=>.5,false);assert.equal((await other.app.importBackup(reload.exportBackup())).ok,true);
    assert.equal(Core.getEggOrigin(other.app.getState()),egg.key);assert.equal(Core.needsEggChoice(other.app.getState()),false);assert.equal(other.app.getState().coins,100);
  }
});

test('invalid egg keys and rejected writes never choose or reward an egg',async()=>{
  for(const value of[undefined,null,'unknown','__proto__','constructor',{},[],0]){
    const g=await game({},()=>.5,false),raw=g.storage.data.get(Core.KEY),r=await command(g,'chooseEgg',{eggOrigin:value});
    assert.equal(r.ok,false);assert.equal(r.error.code,'invalid_egg');assert.equal(Core.needsEggChoice(r.state),true);assert.equal(g.storage.data.get(Core.KEY),raw);
  }
  for(const mode of['throw','false','object']){
    const g=await game({},()=>.5,false),raw=g.storage.data.get(Core.KEY),write=g.storage.setItem.bind(g.storage);
    g.storage.setItem=async()=>{if(mode==='throw')throw new Error('key=https://private.invalid');return mode==='false'?false:{ok:false};};
    const r=await command(g,'chooseEgg',{eggOrigin:'mint'});assert.equal(r.error.code,'storage_failed');assert.equal(Core.needsEggChoice(r.state),true);
    assert.equal(g.storage.data.get(Core.KEY),raw);assert.equal(r.state.coins,100);assert.deepEqual(r.state.achievements,[]);assert.doesNotMatch(JSON.stringify(r.error),/private|https:|key=/);
    g.storage.setItem=write;assert.equal((await command(g,'chooseEgg',{eggOrigin:'apricot'})).ok,true);assert.equal(Core.getEggOrigin(g.app.getState()),'apricot');
  }
});

test('an egg becomes visible as selected only after its awaited durable write',async()=>{
  const g=await game({},()=>.5,false),before=persisted(g.storage),raw=g.storage.data.get(Core.KEY),observed=[];g.app.subscribe(s=>observed.push(s));
  const write=g.storage.setItem.bind(g.storage);let release;g.storage.setItem=(key,value)=>new Promise(resolve=>{release=()=>{write(key,value);resolve();};});
  const pending=command(g,'chooseEgg',{eggOrigin:'mint'});while(!release)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(Core.needsEggChoice(g.app.getState()),true);assert.equal(g.storage.data.get(Core.KEY),raw);assert.equal(observed.length,0);assert.deepEqual(persisted(g.storage),before);
  release();assert.equal((await pending).ok,true);assert.equal(Core.getEggOrigin(g.app.getState()),'mint');assert.equal(observed.length,1);assert.equal(Core.getEggOrigin(observed[0]),'mint');
});

test('simultaneous confirmations serialize and a stale screen cannot replace the chosen egg',async()=>{
  const g=await game({},()=>.5,false),other=Core.create(g.options);assert.equal((await other.ready).ok,true);
  const results=await Promise.all([command(g,'chooseEgg',{eggOrigin:'mint'}),other.dispatch({type:'chooseEgg',eggOrigin:'apricot'})]);
  assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results[1].error.code,'stale_state');assert.equal(persisted(g.storage).pet.eggOrigin,'mint');
  const raw=g.storage.data.get(Core.KEY);assert.equal((await command(g,'chooseEgg',{eggOrigin:'lilac'})).error.code,'egg_already_chosen');assert.equal(g.storage.data.get(Core.KEY),raw);
  assert.equal(persisted(g.storage).pet.exp,0);assert.equal(persisted(g.storage).coins,100);
});

test('old v3 and legacy pets remain outside onboarding without origin backfill or progress reset',async()=>{
  const old=await game(),record=persisted(old.storage);delete record.pet.eggOrigin;record.pet.exp=678;record.coins=564;record.futureField={kept:true};
  const raw=JSON.stringify(record),g=await game({[Core.KEY]:raw});assert.equal(g.storage.writes.length,0);assert.equal(Core.needsEggChoice(g.app.getState()),false);
  assert.equal(Core.getEggOrigin(g.app.getState()),'lilac');assert.equal(Object.hasOwn(g.app.getState().pet,'eggOrigin'),false);assert.equal(g.app.getState().pet.exp,678);assert.equal(g.app.getState().coins,564);
  assert.equal((await command(g,'chooseEgg',{eggOrigin:'mint'})).error.code,'egg_already_chosen');assert.equal(g.storage.data.get(Core.KEY),raw);
  const target=await game({},()=>.5,false);assert.equal((await target.app.importBackup(g.app.exportBackup())).ok,true);assert.equal(Core.needsEggChoice(target.app.getState()),false);
  assert.equal(Object.hasOwn(target.app.getState().pet,'eggOrigin'),false);assert.equal(target.app.getState().pet.exp,678);assert.equal(target.app.getState().coins,564);
  for(const seed of[{pg_exp:'0'},{pg_species:'bunny',pg_exp:'12'},{pet_game:'{"coins":72,"exp":29,"name":"昔のこ"}'}]){
    const legacy=await game(seed);assert.equal(Core.needsEggChoice(legacy.app.getState()),false);assert.equal(Object.hasOwn(legacy.app.getState().pet,'eggOrigin'),false);
  }
  const notPet=await game({sk_total:'99',sk_streak:'7',pg_kakeibo_day:'2026-10-18'},()=>.5,false);assert.equal(Core.needsEggChoice(notPet.app.getState()),true);
});

test('birth origin survives care evolution and prevents species substitution for newly chosen pets',async()=>{
  for(const key of Core.eggCatalogue.map(row=>row.key)){
    const g=await game({},()=>.5,false);await command(g,'chooseEgg',{eggOrigin:key});
    await command(g,'care',{kind:'feed'});await command(g,'care',{kind:'feed'});
    const state=g.app.getState();assert.equal(state.pet.exp,16);assert.equal(Core.getLilacEvolution(state).current.key,'fruit');assert.equal(Core.getEggOrigin(state),key);
    const raw=g.storage.data.get(Core.KEY);assert.equal((await command(g,'chooseSpecies',{species:'bunny'})).error.code,'egg_species_locked');assert.equal(g.storage.data.get(Core.KEY),raw);
    assert.equal((await command(g,'chooseSpecies',{species:'lilac'})).ok,true);assert.equal(Core.getEggOrigin(g.app.getState()),key);
  }
});

test('malformed optional birth origins are rejected rather than guessed or overwritten',async()=>{
  const good=await game(),record=persisted(good.storage);
  for(const mutate of[s=>s.pet.eggOrigin='unknown',s=>s.pet.eggOrigin={},s=>s.pet.eggOrigin=[],s=>s.pet.eggOrigin=9,
    s=>{s.pet.eggOrigin=null;s.pet.exp=15;},s=>{s.pet.eggOrigin='mint';s.pet.species='bunny';}]){
    const bad=structuredClone(record);mutate(bad);
    const raw=JSON.stringify(bad),storage=memory({[Core.KEY]:raw}),app=Core.create({storage});const result=await app.ready;
    assert.equal(result.ok,false);assert.equal(result.error.code,'corrupt_data');assert.equal(result.state.readOnly,true);assert.equal(storage.data.get(Core.KEY),raw);assert.equal(storage.writes.length,0);
  }
});

test('lilac visual growth exposes all six boundaries without changing legacy stages',()=>{
  const expected=[['egg','うまれたて',0],['baby','よちよち',15],['child','こども',45],
    ['final','わかもの',110],['adult','おとな',400],['companion','なかよしの姿',800]];
  assert.deepEqual(Core.lilacGrowthStages.map(({key,label,min})=>[key,label,min]),expected);
  expected.forEach(([key,label,min],i)=>{
    const next=i+1<expected.length?expected[i+1][2]:1600;
    assert.deepEqual(Core.getLilacGrowth(min),{key,label,min,next,progress:next===null?100:0,remaining:next===null?0:next-min});
    if(next!==null){
      const before=Core.getLilacGrowth(next-1);
      assert.equal(before.key,key);assert.equal(before.remaining,1);
      assert.equal(before.progress,Math.round((next-min-1)/(next-min)*100));
    }
  });
  assert.deepEqual(Core.getLilacGrowth(373),{key:'final',label:'わかもの',min:110,next:400,progress:91,remaining:27});
  assert.deepEqual(Core.getStage(373),{key:'final',label:'さいしゅうしんか',min:110,next:null,progress:100});
  assert.equal(Core.getStage(400).key,'final');assert.equal(Core.getStage(800).key,'final');
});

test('lilac growth metadata is immutable and returned growth views are independent',()=>{
  assert.equal(Object.isFrozen(Core.lilacGrowthStages),true);
  Core.lilacGrowthStages.forEach(stage=>assert.equal(Object.isFrozen(stage),true));
  assert.throws(()=>Core.lilacGrowthStages.push({key:'extra',label:'extra',min:900}),TypeError);
  assert.throws(()=>{Core.lilacGrowthStages[0].min=900;},TypeError);
  const view=Core.getLilacGrowth(373);view.label='changed';view.min=1;view.remaining=0;
  assert.equal(Core.getLilacGrowth(373).label,'わかもの');
  assert.equal(Core.getLilacGrowth(373).min,110);assert.equal(Core.getLilacGrowth(373).remaining,27);
});

test('lilac growth accepts finite numbers and safely normalizes invalid or out of range inputs',()=>{
  const initial=Core.getLilacGrowth(0);
  for(const invalid of [undefined,null,false,true,'400',{},[],NaN,Infinity,-Infinity,Symbol('exp'),400n]){
    assert.deepEqual(Core.getLilacGrowth(invalid),initial);
  }
  assert.deepEqual(Core.getLilacGrowth(-1),initial);assert.deepEqual(Core.getLilacGrowth(-Number.MAX_VALUE),initial);
  assert.deepEqual(Core.getLilacGrowth(Number.MAX_VALUE),{key:'companion',label:'なかよしの姿',min:9000000000000,next:null,progress:100,remaining:0});
  assert.deepEqual(Core.getLilacGrowth(45.5),{key:'child',label:'こども',min:45,next:110,progress:1,remaining:64.5});
});

test('reading lilac growth and reopening a 373 EXP record grants no EXP, coins or achievements',async()=>{
  const fresh=await game();const record=persisted(fresh.storage);
  record.pet.exp=373;record.coins=765;
  const raw=JSON.stringify(record);const g=await game({[Core.KEY]:raw});
  assert.equal(g.storage.writes.length,0);
  const before=g.app.getState();
  assert.deepEqual(g.app.getLilacGrowth(before.pet.exp),Core.getLilacGrowth(373));
  assert.equal(g.app.getLilacGrowth(before.pet.exp).remaining,27);
  const reopened=Core.create(g.options);assert.equal((await reopened.ready).ok,true);
  assert.deepEqual(reopened.getState(),before);
  assert.equal(reopened.getState().stage.key,'final');
  assert.equal(reopened.getState().pet.exp,373);assert.equal(reopened.getState().coins,765);
  assert.deepEqual(reopened.getState().achievements,record.achievements);
  assert.equal(g.storage.writes.length,0);assert.equal(g.storage.data.get(Core.KEY),raw);
});

test('eleven appearance steps are pure immutable metadata independent of the six canonical growth and reward stages',()=>{
  const expected=[['egg','たまご',0],['egg_cracked','ひびのたまご',5],['hatching','もうすぐうまれる',10],
    ['newborn','うまれたて',15],['baby','あかちゃん',30],['toddler','よちよち',45],['child','こども',75],
    ['juvenile','わかもの',110],['grown','育った姿',200],['adult','おとな',400],['companion','なかよしの姿',800]];
  assert.deepEqual(Core.lilacAppearanceStages.map(({key,label,min})=>[key,label,min]),expected);
  assert.ok(Object.isFrozen(Core.lilacAppearanceStages));
  expected.forEach(([key,label,min],i)=>{
    assert.ok(Object.isFrozen(Core.lilacAppearanceStages[i]));const next=expected[i+1]?.[2]??1600;
    assert.deepEqual(Core.getLilacAppearance(min),{key,label,min,next,progress:0,remaining:next-min});
    assert.equal(Core.getLilacAppearance(next-1).key,key);assert.equal(Core.getLilacAppearance(next-1).remaining,1);
  });
  assert.throws(()=>{Core.lilacAppearanceStages[0].min=1;},TypeError);
  const view=Core.getLilacAppearance(386);view.key='newborn';view.label='changed';
  assert.deepEqual(Core.getLilacAppearance(386),{key:'grown',label:'育った姿',min:200,next:400,progress:93,remaining:14});
  assert.equal(Core.getLilacGrowth(386).key,'final');assert.equal(Core.getLilacGrowth(386).min,110);
  assert.equal(Core.getStage(386).key,'final');assert.equal(Core.getLilacGrowth(32).min,15);
  assert.equal(Core.getLilacAppearance(32).min,30);
});

test('appearance input normalization and ongoing companion goals are read-only calculations',()=>{
  const initial=Core.getLilacAppearance(0);
  for(const invalid of [undefined,null,false,true,'400',{},[],NaN,Infinity,-Infinity,Symbol('exp'),400n])assert.deepEqual(Core.getLilacAppearance(invalid),initial);
  assert.deepEqual(Core.getLilacAppearance(-5),initial);
  assert.deepEqual(Core.getLilacAppearance(1605),{key:'companion',label:'なかよしの姿',min:1600,next:2400,progress:1,remaining:795});
  assert.deepEqual(Core.getLilacAppearance(Number.MAX_VALUE),{key:'companion',label:'なかよしの姿',min:9000000000000,next:null,progress:100,remaining:0});
});

test('new appearance metadata does not rewrite an existing 386 EXP save, backfill history, or grant anything on reload and backup',async()=>{
  const source=await evolutionGame(378);await command(source,'care',{kind:'feed'});
  const record=persisted(source.storage);assert.equal(record.pet.exp,386);record.coins=355;
  const raw=JSON.stringify(record),g=await game({[Core.KEY]:raw}),before=g.app.getState();
  assert.deepEqual(g.app.getLilacAppearance(386),Core.getLilacAppearance(386));assert.equal(g.app.getLilacAppearance(386).key,'grown');
  assert.equal(g.app.getLilacEvolution(before).nextAt,400);assert.equal(g.storage.writes.length,0);
  const reopened=Core.create(g.options);assert.equal((await reopened.ready).ok,true);
  assert.deepEqual(reopened.getState(),before);assert.equal(g.storage.data.get(Core.KEY),raw);assert.equal(g.storage.writes.length,0);
  assert.deepEqual(JSON.parse(reopened.exportBackup()).state,record);
});

test('crossing extra appearance thresholds neither resets evolution scores nor creates noncanonical saved milestones',async()=>{
  const young=await evolutionGame(14);await command(young,'care',{kind:'feed'});
  const first=JSON.parse(JSON.stringify(persisted(young.storage).evolution.history));assert.deepEqual(first.map(row=>[row.stageKey,row.min]),[['baby',15]]);
  await command(young,'care',{kind:'play'});await command(young,'care',{kind:'play'});
  assert.equal(young.app.getState().pet.exp,32);assert.equal(Core.getLilacAppearance(32).key,'baby');
  assert.deepEqual(persisted(young.storage).evolution.history,first);
  assert.equal(evolution(young).scores.active,6,'a visual step at 30 EXP does not consume or reset evolution scores');
  assert.equal(evolution(young).nextAt,45);assert.equal(evolution(young).current.key,'fruit');
  const older=await evolutionGame(197);await command(older,'care',{kind:'feed'});
  assert.equal(older.app.getState().pet.exp,205);assert.equal(Core.getLilacAppearance(205).key,'grown');
  assert.deepEqual(evolution(older).history,[]);assert.equal(evolution(older).nextAt,400);assert.equal(evolution(older).scores.fruit,2);
  const saved=older.storage.data.get(Core.KEY),reloaded=await game({[Core.KEY]:saved});assert.deepEqual(evolution(reloaded),evolution(older));
});

async function evolutionGame(exp=373,extra={}) {
  return game({pg_exp:String(exp),pg_coins:'355',pg_name:'そのまま',pg_items:'{"apple":30,"berry":30,"cake":30,"rice":30,"feast":30}',...extra});
}
function evolution(g) {return Core.getLilacEvolution(g.app.getState());}

test('evolution paths are frozen independent metadata and old 373 EXP records have no invented care history',async()=>{
  assert.deepEqual(Core.lilacEvolutionPaths.map(p=>[p.key,p.label,p.colorName,p.color]),[
    ['balanced','のんびり','薄紫','#b5a0d9'],['fruit','はなほっぺ','桃色','#d99eae'],
    ['hearty','ぽかぽか','はちみつ色','#d2ad70'],['sweet','おやつっこ','杏色','#dfa88b'],
    ['active','そよかぜ','空色','#92b4d1'],['calm','まどろみ','ミント色','#9dbfb0']]);
  assert.ok(Object.isFrozen(Core.lilacEvolutionPaths));
  Core.lilacEvolutionPaths.forEach(p=>{assert.ok(Object.isFrozen(p));assert.ok(p.description&&p.hint);});
  assert.throws(()=>{Core.lilacEvolutionPaths[0].color='changed';},TypeError);
  const base=await evolutionGame(),old=persisted(base.storage);old.care.total={feed:50,play:55,rest:70};
  old.wardrobe={owned:{cloth_rose_cape:true},equipped:'cloth_rose_cape'};
  const raw=JSON.stringify(old),g=await game({[Core.KEY]:raw}),summary=evolution(g);
  assert.equal(summary.current.key,'balanced');assert.equal(summary.tendency,null);assert.equal(summary.tracked,false);
  assert.equal(summary.activeDays,0);assert.equal(summary.routineDays,0);assert.equal(summary.meals,0);
  assert.deepEqual(summary.care,{feed:0,play:0,rest:0});assert.deepEqual(summary.history,[]);
  assert.equal(summary.startedAt,null);assert.equal(summary.baselineExp,null);assert.equal(summary.nextAt,400);
  summary.current.color='changed';assert.equal(evolution(g).current.color,'#b5a0d9');
  assert.equal(g.app.getState().pet.exp,373);assert.equal(g.app.getState().coins,355);
  assert.deepEqual(g.app.getState().wardrobe,old.wardrobe);assert.equal(g.storage.writes.length,0);assert.equal(g.storage.data.get(Core.KEY),raw);
  const reopened=Core.create(g.options);assert.equal((await reopened.ready).ok,true);assert.equal(g.storage.writes.length,0);
  assert.equal(reopened.getLilacEvolution(reopened.getState()).tracked,false);assert.equal(g.storage.data.get(Core.KEY),raw);
});

test('first real B care starts prospectively and current colour changes only at the next future boundary',async()=>{
  const g=await evolutionGame(),before=persisted(g.storage);
  const first=await command(g,'care',{kind:'feed'});assert.equal(first.ok,true);assert.equal(first.state.pet.exp,381);
  const hint=evolution(g);assert.equal(hint.baselineExp,373);assert.equal(hint.startedAt,g.options.now());
  assert.equal(hint.current.key,'balanced');assert.equal(hint.tendency.key,'fruit');assert.equal(hint.meals,1);assert.equal(hint.care.feed,1);
  assert.equal(hint.scores.fruit,2);assert.equal(hint.activeDays,1);assert.deepEqual(hint.history,[]);assert.equal(hint.nextAt,400);
  assert.equal(first.state.coins,before.coins+10);assert.deepEqual(first.state.wardrobe,before.wardrobe);
  await command(g,'care',{kind:'feed'});await command(g,'care',{kind:'feed'});assert.equal(g.app.getState().pet.exp,397);
  await command(g,'useItem',{itemId:'apple'});
  assert.deepEqual(evolution(g).history,[{stageKey:'adult',min:400,branch:'fruit',at:g.options.now()}]);
  assert.equal(evolution(g).current.key,'fruit');assert.equal(evolution(g).tendency,null);assert.equal(evolution(g).nextAt,800);
  assert.equal(evolution(g).meals,3,'the fourth meal still gives its existing EXP but no extra evolution credit');
});

test('food and care choices independently select every evolution branch with the specified weights',async()=>{
  for(const [exp,type,value,key] of [[397,'useItem','apple','fruit'],[398,'useItem','berry','fruit'],
    [396,'useItem','rice','hearty'],[380,'useItem','feast','hearty'],[394,'useItem','cake','sweet'],
    [395,'care','play','active'],[396,'care','rest','calm'],[392,'care','feed','fruit']]){
    const g=await evolutionGame(exp);const r=await command(g,type,type==='care'?{kind:value}:{itemId:value});assert.equal(r.ok,true,value);
    const info=evolution(g);assert.equal(info.current.key,key,value);assert.equal(info.history.length,1);assert.equal(info.history[0].min,400);
    assert.equal(info.tendency,null);assert.ok(Object.values(info.scores).every(n=>n===0));
  }
  const balanced=await evolutionGame(383);
  for(const kind of ['feed','play','rest'])assert.equal((await command(balanced,'care',{kind})).ok,true);
  assert.equal(balanced.app.getState().pet.exp,400);assert.equal(evolution(balanced).current.key,'balanced');
});

test('daily meal and play caps survive interval resets without limiting existing EXP, consumption or care',async()=>{
  const g=await evolutionGame(0),before=persisted(g.storage);
  for(let i=0;i<4;i++)assert.equal((await command(g,'useItem',{itemId:'apple'})).ok,true);
  assert.equal(g.app.getState().pet.exp,12);assert.equal(g.app.getState().inventory.apple,before.inventory.apple-4);
  assert.equal(evolution(g).meals,3);assert.equal(evolution(g).scores.fruit,9);
  assert.equal((await command(g,'care',{kind:'feed'})).ok,true);assert.equal(g.app.getState().pet.exp,20);
  assert.equal(evolution(g).meals,3);assert.equal(evolution(g).care.feed,0);assert.equal(evolution(g).current.key,'fruit');
  assert.ok(Object.values(evolution(g).scores).every(n=>n===0));
  await command(g,'useItem',{itemId:'cake'});assert.ok(Object.values(evolution(g).scores).every(n=>n===0));
  for(let i=0;i<3;i++)assert.equal((await command(g,'care',{kind:'play'})).ok,true);
  assert.equal(evolution(g).scores.active,9);
  const plays=evolution(g).care.play,played=await play(g,8);assert.equal(played.end.ok,true);
  assert.equal(evolution(g).care.play,plays);assert.equal(evolution(g).scores.active,0,'45 EXP commits the interval without resetting its daily cap');
  assert.equal(evolution(g).current.key,'active');
  assert.equal(played.end.reward.exp,4,'mini-game economy is unchanged when evolution play credits are capped');
  assert.equal(evolution(g).scores.balanced,0);await command(g,'care',{kind:'rest'});
  assert.equal(evolution(g).scores.balanced,4);await command(g,'care',{kind:'rest'});
  assert.equal(evolution(g).scores.balanced,4,'the three kinds bonus is once per day');
  g.day();await command(g,'useItem',{itemId:'cake'});assert.equal(evolution(g).meals,4);
  assert.equal(evolution(g).activeDays,2);assert.equal(evolution(g).routineDays,1);assert.equal(evolution(g).scores.balanced,7);
});

test('the same actions on consecutive days can evolve differently and an unvisited gap never subtracts points',async()=>{
  const results=[];
  for(const spaced of [false,true]){
    const g=await evolutionGame();
    for(let i=0;i<3;i++){if(spaced&&i)g.day();await command(g,'care',{kind:'feed'});}
    assert.equal(g.app.getState().pet.exp,397);const finish=await play(g,6);assert.equal(finish.end.ok,true);
    assert.equal(g.app.getState().pet.exp,400);results.push(evolution(g));
  }
  assert.equal(results[0].current.key,'fruit');assert.equal(results[0].activeDays,1);assert.equal(results[0].routineDays,0);
  assert.equal(results[1].current.key,'balanced');assert.equal(results[1].activeDays,3);assert.equal(results[1].routineDays,2);
  const g=await evolutionGame(110);await command(g,'useItem',{itemId:'cake'});const before=evolution(g);
  g.tick(10*86400000);const raw=g.storage.data.get(Core.KEY),reopened=Core.create(g.options);await reopened.ready;
  assert.equal(g.storage.data.get(Core.KEY),raw);assert.deepEqual(evolution(g),before);
  await command(g,'useItem',{itemId:'cake'});assert.equal(evolution(g).activeDays,2);assert.equal(evolution(g).routineDays,0);
  assert.equal(evolution(g).scores.sweet,before.scores.sweet+3);assert.equal(evolution(g).scores.balanced,0);
});

test('another interval can select a different path while unrelated legacy transfers neither score nor manufacture milestones',async()=>{
  const g=await evolutionGame(397,{pet_game:'{"exp":385}'});await command(g,'useItem',{itemId:'apple'});
  assert.equal(evolution(g).current.key,'fruit');const before=JSON.parse(JSON.stringify(persisted(g.storage).evolution));
  assert.equal((await command(g,'transferLegacy')).ok,true);assert.equal(g.app.getState().pet.exp,785);
  assert.deepEqual(persisted(g.storage).evolution,before);
  g.day();for(let i=0;i<3;i++)assert.equal((await command(g,'useItem',{itemId:'cake'})).ok,true);
  assert.equal(g.app.getState().pet.exp,803);assert.equal(evolution(g).current.key,'sweet');
  assert.deepEqual(evolution(g).history.map(row=>[row.min,row.branch]),[[400,'fruit'],[800,'sweet']]);
  assert.equal(persisted(g.storage).evolution.day.meals,3);assert.equal(evolution(g).nextAt,1600);
});

test('zero-score boundaries retain the last path and ties choose balanced even without balanced points',async()=>{
  const g=await evolutionGame(0);
  await command(g,'useItem',{itemId:'apple'});await command(g,'useItem',{itemId:'rice'});
  assert.equal(evolution(g).scores.balanced,0);assert.equal(evolution(g).tendency.key,'balanced');
  const base=await evolutionGame(397);await command(base,'useItem',{itemId:'apple'});
  const record=persisted(base.storage);record.pet.exp=797;record.evolution.meals=3;record.evolution.day.meals=3;
  const full=await game({[Core.KEY]:JSON.stringify(record)});await command(full,'useItem',{itemId:'feast'});
  assert.equal(full.app.getState().pet.exp,817);assert.equal(evolution(full).current.key,'fruit');
  assert.deepEqual(evolution(full).history.map(row=>row.branch),['fruit','fruit']);assert.equal(evolution(full).meals,3);
});

test('companion growth continues in 800 EXP intervals and the twelve-entry history is bounded',async()=>{
  for(const [exp,min,next,remaining,progress] of [[800,800,1600,800,0],[1599,800,1600,1,100],[1600,1600,2400,800,0],[1999,1600,2400,401,50]]){
    assert.deepEqual(Core.getLilacGrowth(exp),{key:'companion',label:'なかよしの姿',min,next,remaining,progress});
  }
  const old=await evolutionGame(800);await command(old,'care',{kind:'feed'});
  assert.equal(evolution(old).baselineExp,800);assert.deepEqual(evolution(old).history,[]);assert.equal(evolution(old).nextAt,1600);
  const g=await evolutionGame(797);await command(g,'useItem',{itemId:'apple'});const record=persisted(g.storage);
  record.pet.exp=10397;record.evolution.history=Array.from({length:12},(_,i)=>({stageKey:'companion',min:(i+1)*800,branch:'fruit',at:record.evolution.startedAt}));
  const many=await game({[Core.KEY]:JSON.stringify(record)});await command(many,'useItem',{itemId:'apple'});
  const history=evolution(many).history;assert.equal(history.length,12);assert.equal(history[0].min,1600);assert.equal(history.at(-1).min,10400);
  assert.equal(evolution(many).current.key,'fruit');assert.equal(evolution(many).nextAt,11200);
  const terminal=persisted(many.storage);terminal.pet.exp=9000000000000-3;
  const end=await game({[Core.KEY]:JSON.stringify(terminal)});assert.equal((await command(end,'useItem',{itemId:'apple'})).ok,true);
  assert.equal(evolution(end).history.at(-1).min,9000000000000);assert.equal(evolution(end).nextAt,null);
});

test('unrelated actions, no-score mini-games and other species never initialize or backfill B evolution',async()=>{
  const g=await evolutionGame(373,{pg_species:'bunny',pet_game:'{"exp":500}'});
  await command(g,'care',{kind:'feed'});await command(g,'useItem',{itemId:'apple'});await play(g,8);
  assert.equal(Object.hasOwn(persisted(g.storage),'evolution'),false);
  await command(g,'chooseSpecies',{species:'lilac'});await command(g,'rename',{name:'かわらない'});
  await command(g,'buyItem',{itemId:'cloth_cream_vest'});await command(g,'equipClothing',{itemId:'cloth_cream_vest'});
  await command(g,'transferLegacy');await play(g,0);
  assert.equal(Object.hasOwn(persisted(g.storage),'evolution'),false);
  const before=g.app.getState().pet.exp;await command(g,'care',{kind:'rest'});
  assert.equal(evolution(g).baselineExp,before);assert.deepEqual(evolution(g).history,[]);
  assert.equal(evolution(g).care.feed,0);assert.equal(evolution(g).care.play,0);assert.equal(evolution(g).care.rest,1);
  const mini=await evolutionGame(390);const result=await play(mini,20);assert.equal(result.end.ok,true);
  assert.equal(evolution(mini).baselineExp,390);assert.equal(evolution(mini).current.key,'active');assert.equal(evolution(mini).care.play,1);
});

test('evolution starts and changes only after awaited persistence and rejected writes or stale stores keep the old record',async()=>{
  const g=await evolutionGame(397),set=g.storage.setItem.bind(g.storage);let release;
  g.storage.setItem=(k,v)=>new Promise(resolve=>{release=()=>{set(k,v);resolve();};});
  const raw=g.storage.data.get(Core.KEY),pending=command(g,'useItem',{itemId:'apple'});
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(evolution(g).tracked,false);assert.equal(g.app.getState().pet.exp,397);assert.equal(g.storage.data.get(Core.KEY),raw);
  release();assert.equal((await pending).ok,true);g.storage.setItem=set;assert.equal(evolution(g).current.key,'fruit');
  const second=Core.create(g.options);await second.ready;await command(g,'care',{kind:'rest'});const saved=g.storage.data.get(Core.KEY);
  assert.equal((await second.dispatch({type:'useItem',itemId:'cake'})).error.code,'stale_state');assert.equal(g.storage.data.get(Core.KEY),saved);
  for(const failure of ['throw','false'])for(const existing of [false,true]){
    const f=await evolutionGame(397);if(existing)await command(f,'useItem',{itemId:'apple'});
    const before=persisted(f.storage),bytes=f.storage.data.get(Core.KEY);
    f.storage.setItem=async()=>{if(failure==='throw')throw new Error('private write failure');return false;};
    const r=await command(f,'useItem',{itemId:'cake'});assert.equal(r.ok,false);assert.equal(f.storage.data.get(Core.KEY),bytes);
    Object.keys(before).forEach(key=>assert.deepEqual(r.state[key],before[key],key));
    assert.equal(Object.hasOwn(r.state,'evolution'),Object.hasOwn(before,'evolution'));
    assert.equal(evolution(f).tracked,existing);
  }
});

test('backward target timestamps are rejected without consuming food or rewriting evolution history',async()=>{
  const first=await evolutionGame(),record=persisted(first.storage);record.updatedAt++;
  const pending=await game({[Core.KEY]:JSON.stringify(record)}),raw=pending.storage.data.get(Core.KEY);
  assert.equal((await command(pending,'useItem',{itemId:'apple'})).error.code,'clock_moved_back');assert.equal(pending.storage.data.get(Core.KEY),raw);
  const g=await evolutionGame();await command(g,'care',{kind:'feed'});const saved=g.storage.data.get(Core.KEY);g.tick(-1);
  assert.equal((await command(g,'useItem',{itemId:'cake'})).error.code,'clock_moved_back');assert.equal(g.storage.data.get(Core.KEY),saved);
  g.tick(-86400000);assert.equal((await command(g,'useItem',{itemId:'cake'})).error.code,'clock_moved_back');assert.equal(g.storage.data.get(Core.KEY),saved);
});

test('strict evolution validation rejects unknown branches, unordered history and impossible caps without overwrites',async()=>{
  const source=await evolutionGame(397);await command(source,'useItem',{itemId:'apple'});const valid=persisted(source.storage);
  const mutations=[s=>{s.evolution=null;},s=>{s.evolution.version=2;},s=>{s.evolution.scores.fruit=-1;},
    s=>{s.evolution.scores.other=1;},s=>{delete s.evolution.care.feed;},s=>{s.evolution.day.meals=4;},
    s=>{s.evolution.routineDays=s.evolution.activeDays;},s=>{s.evolution.meals=4;},s=>{s.evolution.care.feed=2;},
    s=>{s.evolution.baselineExp=s.pet.exp+1;},s=>{s.evolution.lastAt=s.evolution.startedAt-1;},
    s=>{s.evolution.history[0].branch='unknown';},s=>{s.evolution.history[0].stageKey='egg';},s=>{s.evolution.history[0].min=399;},
    s=>{s.evolution.history[0].at=s.evolution.startedAt-1;},s=>{s.evolution.history.push({...s.evolution.history[0]});},
    s=>{s.evolution.history=Array(13).fill(s.evolution.history[0]);},
    s=>{s.pet.exp=1600;s.evolution.history[0]={stageKey:'companion',min:1599,branch:'fruit',at:s.evolution.startedAt};}];
  for(const mutate of mutations){
    const state=JSON.parse(JSON.stringify(valid));mutate(state);const raw=JSON.stringify(state),storage=memory({[Core.KEY]:raw});
    const app=Core.create({storage,now:source.options.now});assert.equal((await app.ready).ok,false);
    assert.equal(storage.data.get(Core.KEY),raw);assert.equal(storage.writes.length,0);assert.equal(app.getState().readOnly,true);
  }
});

test('new evolution histories round-trip backups and missing old histories remain absent without automatic saves',async()=>{
  const source=await evolutionGame(397);await command(source,'useItem',{itemId:'apple'});const backup=source.app.exportBackup();
  const target=await game();assert.equal((await target.app.importBackup(backup)).ok,true);
  assert.deepEqual(evolution(target),evolution(source));assert.deepEqual(target.app.getState().wardrobe,source.app.getState().wardrobe);
  const raw=target.storage.data.get(Core.KEY),writes=target.storage.writes.length,reopened=Core.create(target.options);await reopened.ready;
  assert.equal(target.storage.data.get(Core.KEY),raw);assert.equal(target.storage.writes.length,writes);
  const old=JSON.parse(backup);delete old.state.evolution;assert.equal((await target.app.importBackup(JSON.stringify(old))).ok,true);
  const oldRaw=target.storage.data.get(Core.KEY),oldWrites=target.storage.writes.length,oldReopen=Core.create(target.options);await oldReopen.ready;
  assert.equal(evolution(target).tracked,false);assert.equal(target.storage.data.get(Core.KEY),oldRaw);assert.equal(target.storage.writes.length,oldWrites);
  const corrupt=JSON.parse(backup);corrupt.state.evolution.history[0].branch='unknown';
  assert.equal((await target.app.importBackup(JSON.stringify(corrupt))).ok,false);assert.equal(target.storage.data.get(Core.KEY),oldRaw);
});

test('a newly selected independent game has one durable key and no outside rewards',async()=>{
  const g=await game();assert.equal(g.app.getState().coins,100);assert.equal(g.app.getState().pet.exp,0);
  assert.equal(g.storage.writes.length,2);assert.ok(g.storage.writes.every(row=>row[0]===Core.KEY));
  assert.equal(g.app.getState().pet.species,'lilac');
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

test('lilac can be selected at every growth boundary while the retired dragon remains archived',async()=>{
  const fresh=await game();assert.equal(fresh.app.getState().pet.species,'lilac');
  for(const species of ['dragon','bunny'])for(const exp of [0,14,15,44,45,109,110,98765]){
    const g=await game({pg_species:species,pg_exp:String(exp),pg_name:'もとの子',pg_path:'cool',pg_px:'1'});
    const before=g.app.getState().pet;
    assert.equal((await command(g,'chooseSpecies',{species:'lilac'})).ok,true);
    assert.deepEqual(g.app.getState().pet,{...before,species:'lilac'});
    const reload=Core.create(g.options);assert.equal((await reload.ready).ok,true);
    assert.deepEqual(reload.getState().pet,{...before,species:'lilac'});
    const again=await command(g,'chooseSpecies',{species});
    assert.equal(again.ok,species!=='dragon');
    if(species==='dragon')assert.equal(again.error.code,'invalid_species');
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

test('clothing catalogue has six fixed prices and purchases never equip or grant growth or achievements',async()=>{
  const expected=[['cloth_cream_vest','はじめてベスト',0],['cloth_rose_cape','ももいろケープ',30],
    ['cloth_sky_overalls','そらいろサロペット',45],['cloth_mint_knit','ミントのニット',40],
    ['cloth_star_pajamas','星のおやすみ服',55],['cloth_flower_dress','お花のワンピース',65]];
  assert.deepEqual(Core.items.filter(it=>it.type==='clothing').map(it=>[it.id,it.name,it.price]),expected);
  const g=await game(),before=persisted(g.storage);
  assert.deepEqual(before.wardrobe,{owned:{},equipped:null});
  const free=await command(g,'buyItem',{itemId:'cloth_cream_vest',price:-100,exp:999});
  assert.equal(free.ok,true);assert.deepEqual(free.reward,{});assert.equal(free.state.coins,100);
  assert.deepEqual(free.state.wardrobe,{owned:{cloth_cream_vest:true},equipped:null});
  const paid=await command(g,'buyItem',{itemId:'cloth_rose_cape',price:0,exp:999});
  assert.equal(paid.ok,true);assert.deepEqual(paid.reward,{});assert.equal(paid.state.coins,70);
  const after=persisted(g.storage);
  assert.deepEqual(after,{...before,coins:70,wardrobe:{owned:{cloth_cream_vest:true,cloth_rose_cape:true},equipped:null},revision:before.revision+2});
  assert.deepEqual(after.achievements,[],'even the free vest must not trigger the generic rich achievement');
});

test('old v3 records without wardrobes load byte for byte and only a real purchase initializes the field',async()=>{
  const base=await game(),old=persisted(base.storage);delete old.wardrobe;
  const raw=JSON.stringify(old),g=await game({[Core.KEY]:raw});
  assert.equal(g.storage.writes.length,0);assert.equal(Object.hasOwn(g.app.getState(),'wardrobe'),false);
  const reopened=Core.create(g.options);assert.equal((await reopened.ready).ok,true);
  assert.equal(g.storage.writes.length,0);assert.equal(g.storage.data.get(Core.KEY),raw);
  assert.equal((await command(g,'equipClothing',{itemId:'cloth_cream_vest'})).error.code,'not_owned');
  assert.equal(g.storage.writes.length,0);assert.equal(g.storage.data.get(Core.KEY),raw);
  g.storage.fail=true;
  assert.equal((await command(g,'buyItem',{itemId:'cloth_cream_vest'})).ok,false);
  assert.equal(Object.hasOwn(g.app.getState(),'wardrobe'),false);assert.equal(g.storage.data.get(Core.KEY),raw);
  g.storage.fail=false;
  const bought=await command(g,'buyItem',{itemId:'cloth_cream_vest'});assert.equal(bought.ok,true);
  assert.deepEqual(persisted(g.storage),{...old,wardrobe:{owned:{cloth_cream_vest:true},equipped:null},revision:old.revision+1});
});

test('insufficient funds, repeat purchases, unknown items and unowned clothing cannot write progress',async()=>{
  const g=await game({pg_coins:'29',pg_exp:'45'});
  for(const [type,itemId,code] of [['buyItem','cloth_rose_cape','insufficient_coins'],['buyItem','cloth_unknown','invalid_item'],
    ['equipClothing','cloth_rose_cape','not_owned'],['equipClothing','apple','invalid_item'],['equipClothing',undefined,'invalid_item']]){
    const raw=g.storage.data.get(Core.KEY),writes=g.storage.writes.length;
    const r=await command(g,type,{itemId});assert.equal(r.ok,false);assert.equal(r.error.code,code);
    assert.equal(g.storage.data.get(Core.KEY),raw);assert.equal(g.storage.writes.length,writes);
  }
  assert.equal((await command(g,'buyItem',{itemId:'cloth_cream_vest'})).ok,true);
  const raw=g.storage.data.get(Core.KEY),writes=g.storage.writes.length;
  assert.equal((await command(g,'buyItem',{itemId:'cloth_cream_vest'})).error.code,'already_owned');
  assert.equal((await command(g,'useItem',{itemId:'cloth_cream_vest'})).error.code,'invalid_item');
  assert.equal((await command(g,'equip',{itemId:'cloth_cream_vest'})).error.code,'not_owned');
  assert.equal(g.storage.data.get(Core.KEY),raw);assert.equal(g.storage.writes.length,writes);
});

test('all clothes can be changed and removed independently of food, decorations, backgrounds and achievements',async()=>{
  const g=await game({pg_coins:'1000',pg_exp:'167',pg_items:'{"rice":2}',pg_deco:'{"house":{}}',pg_ach:'["old-ach"]'});
  assert.equal((await command(g,'equip',{itemId:'house'})).ok,true);
  assert.equal((await command(g,'buyItem',{itemId:'bg_beach'})).ok,true);
  assert.equal((await command(g,'equip',{itemId:'bg_beach'})).ok,true);
  const before=persisted(g.storage),clothes=Core.items.filter(it=>it.type==='clothing');
  for(const it of clothes){
    assert.equal((await command(g,'buyItem',{itemId:it.id})).ok,true);
    assert.equal(g.app.getState().wardrobe.equipped,null,'purchases leave the pet undressed');
  }
  for(const it of clothes){
    const r=await command(g,'equipClothing',{itemId:it.id});assert.equal(r.ok,true);assert.deepEqual(r.reward,{});
    assert.equal(r.state.wardrobe.equipped,it.id);
    for(const key of ['pet','inventory','decorations','achievements','care','minigames','market','legacyReserve','migration'])assert.deepEqual(r.state[key],before[key],key);
  }
  const dressed=persisted(g.storage);assert.equal(dressed.coins,before.coins-235);
  const removed=await command(g,'equipClothing',{itemId:null});assert.equal(removed.ok,true);assert.equal(removed.state.wardrobe.equipped,null);
  assert.deepEqual(persisted(g.storage),{...dressed,wardrobe:{...dressed.wardrobe,equipped:null},revision:dressed.revision+1});
});

test('clothing ownership and wearing wait for durable storage before appearing in live state',async()=>{
  const g=await game(),set=g.storage.setItem.bind(g.storage);let release;
  g.storage.setItem=(k,v)=>new Promise(resolve=>{release=()=>{set(k,v);resolve();};});
  const before=persisted(g.storage),buying=command(g,'buyItem',{itemId:'cloth_rose_cape'});
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(persisted(g.storage),before);assert.deepEqual(g.app.getState().wardrobe,before.wardrobe);assert.equal(g.app.getState().coins,100);
  release();assert.equal((await buying).ok,true);release=null;
  const owned=persisted(g.storage),wearing=command(g,'equipClothing',{itemId:'cloth_rose_cape'});
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(persisted(g.storage),owned);assert.equal(g.app.getState().wardrobe.equipped,null);
  release();assert.equal((await wearing).ok,true);assert.equal(g.app.getState().wardrobe.equipped,'cloth_rose_cape');
});

test('rejected clothing purchase, wear and removal retain every durable and live progress field',async()=>{
  for(const mode of ['throw','false','object_false'])for(const action of [
    {type:'buyItem',itemId:'cloth_rose_cape'},{type:'equipClothing',itemId:'cloth_cream_vest'},{type:'equipClothing',itemId:null}]){
    const g=await game();assert.equal((await command(g,'buyItem',{itemId:'cloth_cream_vest'})).ok,true);
    if(action.itemId===null)assert.equal((await command(g,'equipClothing',{itemId:'cloth_cream_vest'})).ok,true);
    const before=persisted(g.storage),raw=g.storage.data.get(Core.KEY);
    g.storage.setItem=async()=>{if(mode==='throw')throw new Error('private storage failure');return mode==='false'?false:{ok:false};};
    const r=await g.app.dispatch(action);assert.equal(r.ok,false);assert.equal(r.error.code,'storage_failed');
    assert.equal(g.storage.data.get(Core.KEY),raw);assert.doesNotMatch(JSON.stringify(r.error),/private/);
    Object.keys(before).forEach(key=>assert.deepEqual(r.state[key],before[key],mode+': '+key));
  }
});

test('concurrent clothing purchases charge once and stale stores cannot overwrite a newer outfit',async()=>{
  const g=await game(),results=await Promise.all([1,2,3].map(()=>command(g,'buyItem',{itemId:'cloth_rose_cape'})));
  assert.equal(results.filter(r=>r.ok).length,1);assert.equal(g.app.getState().coins,70);
  assert.ok(results.filter(r=>!r.ok).every(r=>r.error.code==='already_owned'));
  assert.equal((await command(g,'buyItem',{itemId:'cloth_cream_vest'})).ok,true);
  const second=Core.create(g.options);assert.equal((await second.ready).ok,true);
  assert.equal((await command(g,'equipClothing',{itemId:'cloth_rose_cape'})).ok,true);
  const raw=g.storage.data.get(Core.KEY);
  const stale=await second.dispatch({type:'equipClothing',itemId:'cloth_cream_vest'});
  assert.equal(stale.ok,false);assert.equal(stale.error.code,'stale_state');assert.equal(g.storage.data.get(Core.KEY),raw);
  assert.equal(g.app.getState().wardrobe.equipped,'cloth_rose_cape');assert.equal(second.getState().wardrobe.equipped,null);
});

test('strict wardrobe validation rejects malformed ownership and equipped values without overwriting old data',async()=>{
  const base=await game(),valid=persisted(base.storage);
  for(const wardrobe of [null,[],{}, {owned:{},equipped:'cloth_cream_vest'}, {owned:[],equipped:null},
    {owned:{cloth_unknown:true},equipped:null},{owned:{apple:true},equipped:null},
    {owned:{cloth_cream_vest:false},equipped:null},{owned:{cloth_cream_vest:1},equipped:null},
    {owned:{cloth_cream_vest:true},equipped:'cloth_rose_cape'}, {owned:{cloth_cream_vest:true}},
    {owned:{},equipped:null,unexpected:true}]){
    const raw=JSON.stringify({...valid,wardrobe}),storage=memory({[Core.KEY]:raw}),app=Core.create({storage,now:base.options.now});
    const result=await app.ready;assert.equal(result.ok,false,JSON.stringify(wardrobe));assert.equal(result.error.code,'corrupt_data');
    assert.equal(storage.data.get(Core.KEY),raw);assert.equal(storage.writes.length,0);assert.equal(app.getState().readOnly,true);
  }
});

test('wardrobes and independent economy round-trip backups while old backups without wardrobes remain compatible',async()=>{
  const g=await game();await command(g,'buyItem',{itemId:'cloth_rose_cape'});await command(g,'equipClothing',{itemId:'cloth_rose_cape'});
  const record=persisted(g.storage),backup=g.app.exportBackup(),other=await game();
  assert.equal((await other.app.importBackup(backup)).ok,true);
  for(const key of ['wardrobe','pet','coins','inventory','decorations','achievements','care','minigames','market'])assert.deepEqual(other.app.getState()[key],record[key],key);
  const reloaded=Core.create(other.options),writes=other.storage.writes.length;assert.equal((await reloaded.ready).ok,true);
  assert.equal(other.storage.writes.length,writes);assert.deepEqual(reloaded.getState().wardrobe,record.wardrobe);
  const old=JSON.parse(backup);delete old.state.wardrobe;
  assert.equal((await other.app.importBackup(JSON.stringify(old))).ok,true);
  assert.equal(Object.hasOwn(persisted(other.storage),'wardrobe'),false);
  const raw=other.storage.data.get(Core.KEY),oldReopened=Core.create(other.options),oldWrites=other.storage.writes.length;
  assert.equal((await oldReopened.ready).ok,true);assert.equal(other.storage.writes.length,oldWrites);assert.equal(other.storage.data.get(Core.KEY),raw);
  const invalid=JSON.parse(backup);invalid.state.wardrobe.equipped='cloth_star_pajamas';
  assert.equal((await other.app.importBackup(JSON.stringify(invalid))).ok,false);assert.equal(other.storage.data.get(Core.KEY),raw);
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

async function retiredDragonRecord() {
  const g=await game({pg_exp:'167',pg_name:'もとのりゅう',pg_species:'dragon',pg_path:'cool',pg_px:'1',pg_coins:'2000',
    pg_items:'{"rice":3}',pg_deco:'{"house":{"x":13}}',pg_bg:'beach',pg_bgs:'["meadow","beach"]',pg_ach:'["old-ach"]',
    pet_game:'{"name":"保管している子","coins":70,"exp":11,"foods":{"🍎":2},"pot":55,"potBasis":50,"potDays":3}'},()=>.99);
  for(const [type,a] of [['care',{kind:'play'}],['buyStock',{stockId:'grn',quantity:5}],['advanceMarketDay',{}],['buyItem',{itemId:'cake'}],['beginMinigame',{}]])
    assert.equal((await command(g,type,a)).ok,true);
  const old=persisted(g.storage);old.pet.species='dragon';old.futureField={history:['leave','unchanged']};
  const raw=JSON.stringify(old);g.storage.data.set(Core.KEY,raw);g.tick(1234);
  return {g,old,raw};
}

test('retired v3 dragon becomes B with exactly one durable species revision and keeps every progress field',async()=>{
  const {g,old}=await retiredDragonRecord(),writes=g.storage.writes.length;
  const next=Core.create(g.options);assert.equal((await next.ready).ok,true);
  const expected={...old,pet:{...old.pet,species:'lilac'},revision:old.revision+1,updatedAt:g.options.now()};
  assert.deepEqual(persisted(g.storage),expected);assert.equal(g.storage.writes.length,writes+1);
  assert.equal(next.getState().pet.species,'lilac');assert.equal(next.getState().pet.exp,old.pet.exp);
  assert.deepEqual(next.getState().market,old.market);assert.deepEqual(next.getState().legacyReserve,old.legacyReserve);
  assert.equal(g.storage.data.get('pg_species'),'dragon');assert.equal(next.getState().migration.legacyRaw.pg_species,'dragon');
  assert.equal(JSON.parse(next.exportBackup()).state.pet.species,'lilac');
  const reload=Core.create(g.options);assert.equal((await reload.ready).ok,true);
  assert.deepEqual(reload.getState(),next.getState());assert.equal(g.storage.writes.length,writes+1);
  const before=g.storage.data.get(Core.KEY);assert.equal((await reload.dispatch({type:'chooseSpecies',species:'dragon'})).error.code,'invalid_species');
  assert.equal(g.storage.data.get(Core.KEY),before);assert.equal((await reload.dispatch({type:'chooseSpecies',species:'bunny'})).ok,true);
});

test('retired v3 dragon conversion awaits storage and never publishes B before confirmed persistence',async()=>{
  const {g,old,raw}=await retiredDragonRecord();let release,entered;
  const waiting=new Promise(resolve=>{entered=resolve;}),set=g.storage.setItem.bind(g.storage);
  g.storage.setItem=(k,v)=>new Promise(resolve=>{release=()=>{set(k,v);resolve();};entered();});
  const app=Core.create(g.options),observed=[];app.subscribe(s=>observed.push(s));await waiting;
  assert.equal(g.storage.data.get(Core.KEY),raw);assert.equal(app.getState().readOnly,true);
  assert.deepEqual(app.getState().pet,old.pet);assert.deepEqual(app.getState().market,old.market);
  assert.ok(observed.every(s=>s.pet.species!=='lilac'));
  release();assert.equal((await app.ready).ok,true);assert.equal(app.getState().pet.species,'lilac');
  assert.equal(app.getState().readOnly,false);assert.equal(JSON.parse(g.storage.data.get(Core.KEY)).pet.species,'lilac');
});

test('rejected dragon conversion blocks writes and keeps the original live and durable progress',async()=>{
  for(const mode of ['throw','false','result']){
    const {g,old,raw}=await retiredDragonRecord(),set=g.storage.setItem.bind(g.storage);
    g.storage.setItem=async()=>{if(mode==='throw')throw new Error('private key=https://hidden.invalid');return mode==='false'?false:{ok:false};};
    const app=Core.create(g.options),result=await app.ready;
    assert.equal(result.ok,false);assert.equal(result.error.code,'storage_failed');assert.equal(app.getState().readOnly,true);
    assert.equal(g.storage.data.get(Core.KEY),raw);assert.deepEqual(app.getState().pet,old.pet);
    assert.deepEqual(app.getState().market,old.market);assert.deepEqual(app.getState().inventory,old.inventory);
    assert.deepEqual(app.getState().legacyReserve,old.legacyReserve);assert.doesNotMatch(JSON.stringify(result.error),/private|https:|key=/);
    assert.equal((await app.dispatch({type:'care',kind:'feed'})).error.code,'read_only');assert.equal(g.storage.data.get(Core.KEY),raw);
    assert.throws(()=>app.exportBackup());
    g.storage.setItem=set;const retry=Core.create(g.options);assert.equal((await retry.ready).ok,true);
    assert.deepEqual(persisted(g.storage),{...old,pet:{...old.pet,species:'lilac'},revision:old.revision+1,updatedAt:g.options.now()});
  }
});

test('legacy dragon conversion is part of the first write and leaves archived source keys intact on success or failure',async()=>{
  const seed={pg_species:'dragon',pg_exp:'14',pg_name:'昔の子',pg_coins:'71',pg_path:'cool',pg_px:'1',pg_items:'{"rice":3}'};
  const g=await game(seed);assert.equal(g.storage.writes.length,1);assert.equal(g.app.getState().pet.species,'lilac');
  assert.equal(g.app.getState().pet.exp,14);assert.equal(g.app.getState().coins,71);assert.equal(g.app.getState().revision,0);
  assert.equal(g.app.getState().migration.legacyRaw.pg_species,'dragon');
  for(const [key,value] of Object.entries(seed))assert.equal(g.storage.data.get(key),value);
  for(const mode of ['false','throw']){
    const storage=memory(seed);storage.setItem=async()=>{if(mode==='throw')throw new Error('private');return false;};
    const app=Core.create({storage});assert.equal((await app.ready).ok,false);assert.equal(storage.data.has(Core.KEY),false);
    assert.equal(app.getState().readOnly,true);for(const [key,value] of Object.entries(seed))assert.equal(storage.data.get(key),value);
  }
});

test('old dragon backups remain importable, adopt B only on the one successful import and export current B',async()=>{
  const {old}=await retiredDragonRecord(),backup=JSON.stringify({format:'PetGameBackup',version:3,exportedAt:old.updatedAt,state:old});
  const g=await game({pg_species:'bunny',pg_exp:'45',pg_name:'今の子',pg_coins:'123'}),before=persisted(g.storage),raw=g.storage.data.get(Core.KEY);
  const set=g.storage.setItem.bind(g.storage);g.storage.setItem=async()=>false;
  const rejected=await g.app.importBackup(backup);assert.equal(rejected.ok,false);assert.equal(g.storage.data.get(Core.KEY),raw);
  assert.deepEqual(rejected.state.pet,before.pet);assert.equal(rejected.state.coins,before.coins);
  g.storage.setItem=set;assert.equal((await g.app.importBackup(backup)).ok,true);
  assert.deepEqual(persisted(g.storage),{...old,pet:{...old.pet,species:'lilac'},revision:before.revision+1,updatedAt:g.options.now()});
  assert.equal(JSON.parse(backup).state.pet.species,'dragon');assert.equal(JSON.parse(g.app.exportBackup()).state.pet.species,'lilac');
});

test('two simultaneous loads convert a retired dragon once and CAS rejects an intervening update',async()=>{
  const {g,old,raw}=await retiredDragonRecord(),writes=g.storage.writes.length;
  const first=Core.create(g.options),second=Core.create(g.options);
  assert.equal((await first.ready).ok,true);assert.equal((await second.ready).ok,true);
  assert.deepEqual(first.getState(),second.getState());assert.equal(g.storage.writes.length,writes+1);
  g.storage.data.set(Core.KEY,raw);const newer={...old,coins:old.coins+17,revision:old.revision+1},newRaw=JSON.stringify(newer);
  const get=g.storage.getItem.bind(g.storage);let reads=0;
  g.storage.getItem=k=>{if(k===Core.KEY&&++reads===2)g.storage.data.set(Core.KEY,newRaw);return get(k);};
  const stale=Core.create(g.options);const result=await stale.ready;
  assert.equal(result.ok,false);assert.equal(result.error.code,'stale_state');assert.equal(g.storage.data.get(Core.KEY),newRaw);
  assert.equal(stale.getState().readOnly,true);assert.deepEqual(stale.getState().pet,old.pet);
});

const roomBuiltins = [
  {id:'room_window',x:11,y:2,flip:false},{id:'room_shelf',x:88,y:10,flip:false},
  {id:'room_rug',x:50,y:93,flip:false},{id:'room_bed',x:94,y:86,flip:false},
  {id:'room_bowl',x:10,y:91,flip:false},{id:'room_toy',x:25,y:94,flip:false}
];
const roomLayout = items => ({version:1,items});
const roomItem = (id, values={}) => ({id,x:25,y:75,flip:false,...values});
async function saveRoom(g,layout,revision=g.app.getState().revision) {
  return command(g,'saveRoomLayout',{layout,expectedRevision:revision});
}

test('room furniture and effective default layouts are detached views without initialization writes',async()=>{
  const g=await game({},()=>.5,false),before=g.storage.data.get(Core.KEY),writes=g.storage.writes.length;
  assert.equal(Object.hasOwn(persisted(g.storage),'roomLayout'),false);
  assert.deepEqual(Core.roomFurniture.map(({id,x,y,flip})=>({id,x,y,flip})),roomBuiltins);
  assert.ok(Core.roomFurniture.every(entry=>typeof entry.name==='string'&&entry.name));
  assert.deepEqual(Core.defaultRoomLayout(g.app.getState()),roomLayout(roomBuiltins));
  assert.deepEqual(Core.getRoomLayout(g.app.getState()),roomLayout(roomBuiltins));
  const defaults=Core.defaultRoomLayout(g.app.getState()),effective=Core.getRoomLayout(g.app.getState());
  defaults.items[0].x=100;effective.items.splice(0);assert.deepEqual(Core.defaultRoomLayout(g.app.getState()),roomLayout(roomBuiltins));
  const exported=structuredClone(Core.roomFurniture);
  try{Core.roomFurniture[0].x=99;Core.roomFurniture[0].name='changed';Core.roomFurniture.push({id:'invented'});assert.deepEqual(Core.defaultRoomLayout(g.app.getState()),roomLayout(roomBuiltins));}
  finally{Core.roomFurniture.splice(0,Core.roomFurniture.length,...exported);}
  assert.equal(g.storage.data.get(Core.KEY),before);assert.equal(g.storage.writes.length,writes);
  const blocked=await saveRoom(g,roomLayout([]));assert.equal(blocked.error.code,'egg_required');assert.equal(g.storage.data.get(Core.KEY),before);
});

test('old v3 room defaults include only the owned known equipped decoration and never rewrite records',async()=>{
  const first=await game({pg_exp:'686',pg_coins:'574',pg_deco:'{"house":{},"legacy-prop":{"x":12}}'});
  await command(first,'equip',{itemId:'house'});const old=persisted(first.storage);delete old.roomLayout;
  const raw=JSON.stringify(old),g=await game({[Core.KEY]:raw});
  const expected=roomLayout([...roomBuiltins,{id:'house',x:74,y:94,flip:false}]);
  assert.deepEqual(Core.getRoomLayout(g.app.getState()),expected);
  assert.equal(g.storage.writes.length,0);assert.equal(g.storage.data.get(Core.KEY),raw);
  for(const state of [
    {...old,decorations:{...old.decorations,equipped:'legacy-prop'}},
    {...old,decorations:{...old.decorations,equipped:'flower'}},
    {...old,decorations:{owned:{apple:{}},equipped:'apple'}}
  ])assert.deepEqual(Core.defaultRoomLayout(state),roomLayout(roomBuiltins),'unknown, unowned and non-decoration equipment cannot become a furniture placement');
  const reopened=Core.create(g.options);await reopened.ready;
  assert.equal(g.storage.writes.length,0);assert.equal(g.storage.data.get(Core.KEY),raw);assert.equal(reopened.getState().pet.exp,686);assert.equal(reopened.getState().coins,574);
  assert.deepEqual(reopened.getState().decorations.owned,old.decorations.owned);
});

test('saving one room layout changes only layout revision and update time without backfilling rewards',async()=>{
  const g=await game({pg_exp:'686',pg_coins:'574',pg_items:'{"rice":2}',pg_deco:'{"house":{},"legacy-prop":{}}'});
  await command(g,'equip',{itemId:'house'});
  const clean=persisted(g.storage);clean.achievements=[];const loaded=await game({[Core.KEY]:JSON.stringify(clean)});
  const before=persisted(loaded.storage),layout=roomLayout([roomItem('room_bed',{x:100,y:0,flip:true}),roomItem('house',{x:0,y:100})]);loaded.tick(17);
  const r=await saveRoom(loaded,layout);assert.equal(r.ok,true);assert.deepEqual(r.reward,{});
  assert.deepEqual(persisted(loaded.storage),{...before,roomLayout:layout,revision:before.revision+1,updatedAt:loaded.options.now()});
  assert.deepEqual(r.state.achievements,[]);assert.deepEqual(r.state.decorations,before.decorations);assert.equal(r.state.pet.exp,686);assert.equal(r.state.coins,574);
  const view=Core.getRoomLayout(r.state);view.items[0].x=4;assert.deepEqual(Core.getRoomLayout(loaded.app.getState()),layout);
  assert.equal(loaded.storage.writes.length,1);
});

test('all thirteen unique built-in and owned decorations can be positioned with boundary values',async()=>{
  const decorations=Core.items.filter(row=>row.type==='decoration'),owned=Object.fromEntries(decorations.map(row=>[row.id,{}]));
  const g=await game({pg_exp:'45',pg_coins:'355',pg_deco:JSON.stringify({...owned,'unknown-kept':{count:2}})}),before=persisted(g.storage);
  const layout=roomLayout([...roomBuiltins,...decorations.map((entry,i)=>roomItem(entry.id,{x:i%2?0:100,y:i*10,flip:!!(i%2)}))]);
  assert.equal(layout.items.length,13);assert.equal((await saveRoom(g,layout)).ok,true);assert.deepEqual(Core.getRoomLayout(g.app.getState()),layout);
  assert.deepEqual(g.app.getState().decorations.owned,before.decorations.owned);assert.equal(g.app.getState().coins,355);
});

test('explicit empty room layouts survive reload and backup without resurrecting default or equipped objects',async()=>{
  const g=await game({pg_deco:'{"house":{}}'});await command(g,'equip',{itemId:'house'});
  const before=persisted(g.storage);assert.equal((await saveRoom(g,roomLayout([]))).ok,true);
  assert.deepEqual(Core.getRoomLayout(g.app.getState()),roomLayout([]));assert.equal(g.app.getState().decorations.equipped,'house');
  const raw=g.storage.data.get(Core.KEY),writes=g.storage.writes.length,reopened=Core.create(g.options);assert.equal((await reopened.ready).ok,true);
  assert.deepEqual(Core.getRoomLayout(reopened.getState()),roomLayout([]));assert.equal(g.storage.data.get(Core.KEY),raw);assert.equal(g.storage.writes.length,writes);
  const target=await game();assert.equal((await target.app.importBackup(reopened.exportBackup())).ok,true);assert.deepEqual(Core.getRoomLayout(target.app.getState()),roomLayout([]));
  for(const key of ['pet','coins','inventory','decorations','wardrobe','care','market','legacyReserve'])assert.deepEqual(target.app.getState()[key],before[key],key);
});

test('invalid room structure coordinates types duplicates and extras cannot write or alter progress',async()=>{
  const g=await game({pg_exp:'45',pg_deco:'{"house":{}}'}),raw=g.storage.data.get(Core.KEY),before=persisted(g.storage),writes=g.storage.writes.length;
  const hiddenExtra=roomItem('room_bed');Object.defineProperty(hiddenExtra,'hidden',{value:1});
  const symbolExtra=roomLayout([]);symbolExtra[Symbol('extra')]=1;
  const badLayouts=[undefined,null,[],{}, {version:1}, {version:2,items:[]}, {version:'1',items:[]},{version:1,items:{}},{version:1,items:[],extra:1},symbolExtra,
    roomLayout([null]),roomLayout([{}]),roomLayout(new Array(1)),roomLayout([roomItem('room_bed'),roomItem('room_bed')]),
    roomLayout(Array.from({length:14},()=>roomItem('room_bed'))),roomLayout([{id:'room_bed',x:1,y:2}]),roomLayout([roomItem('room_bed',{extra:true})]),roomLayout([hiddenExtra]),
    roomLayout([roomItem('__proto__')]),roomLayout([roomItem('constructor')]),roomLayout([roomItem('missing')])];
  for(const key of ['x','y'])for(const value of [-1,101,.5,NaN,Infinity,-Infinity,'25',null,undefined,{},[]])badLayouts.push(roomLayout([roomItem('room_bed',{[key]:value})]));
  for(const value of [0,1,'false',null,undefined,{}])badLayouts.push(roomLayout([roomItem('room_bed',{flip:value})]));
  for(const layout of badLayouts){const r=await saveRoom(g,layout);assert.equal(r.ok,false);assert.equal(r.error.code,'invalid_room_layout');assert.equal(g.storage.data.get(Core.KEY),raw);assert.equal(g.storage.writes.length,writes);for(const key of Object.keys(before))assert.deepEqual(r.state[key],before[key]);}
});

test('room placements cannot invent ownership or use foods clothes backgrounds or unknown legacy props',async()=>{
  const g=await game({pg_deco:'{"unknown-kept":{},"apple":{},"cloth_cream_vest":{}}'}),raw=g.storage.data.get(Core.KEY),writes=g.storage.writes.length;
  const unowned=await saveRoom(g,roomLayout([roomItem('house')]));assert.equal(unowned.error.code,'not_owned');
  for(const id of ['apple','cloth_cream_vest','bg_meadow','unknown-kept'])assert.equal((await saveRoom(g,roomLayout([roomItem(id)]))).error.code,'invalid_room_layout');
  assert.equal(g.storage.data.get(Core.KEY),raw);assert.equal(g.storage.writes.length,writes);assert.deepEqual(persisted(g.storage).decorations.owned,{'unknown-kept':{},apple:{},cloth_cream_vest:{}});
});

test('layout expected revision is mandatory and a stale same-store editor cannot replace a newer state',async()=>{
  const g=await game(),layout=roomLayout([roomItem('room_bed')]),revision=g.app.getState().revision;
  for(const expectedRevision of [null,String(revision),revision+.5,-1,NaN,Infinity,revision+1])assert.equal((await saveRoom(g,layout,expectedRevision)).error.code,'stale_state');
  // saveRoom defaults undefined: exercise the genuinely omitted field separately.
  const omitted=await command(g,'saveRoomLayout',{layout});assert.equal(omitted.error.code,'stale_state');
  assert.equal((await command(g,'rename',{name:'新しい名前'})).ok,true);const raw=g.storage.data.get(Core.KEY),before=persisted(g.storage);
  assert.equal((await saveRoom(g,layout,revision)).error.code,'stale_state');assert.equal(g.storage.data.get(Core.KEY),raw);assert.equal(Object.hasOwn(before,'roomLayout'),false);
  assert.equal((await saveRoom(g,layout)).ok,true);assert.equal(g.app.getState().pet.name,'新しい名前');
});

test('a pending layout write publishes no candidate and detaches caller input before durable adoption',async()=>{
  const g=await game(),layout=roomLayout([roomItem('room_bed',{flip:true})]),before=persisted(g.storage),raw=g.storage.data.get(Core.KEY),notified=[];
  g.app.subscribe(s=>notified.push(s));const set=g.storage.setItem.bind(g.storage);let release;
  g.storage.setItem=(key,value)=>new Promise(resolve=>{release=()=>{set(key,value);resolve();};});
  const pending=saveRoom(g,layout);while(!release)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(g.storage.data.get(Core.KEY),raw);assert.equal(Object.hasOwn(g.app.getState(),'roomLayout'),false);assert.equal(notified.length,0);
  layout.items[0].x=99;layout.items.push(roomItem('room_window'));
  release();assert.equal((await pending).ok,true);const expected=roomLayout([roomItem('room_bed',{flip:true})]);
  assert.deepEqual(g.app.getState().roomLayout,expected);assert.deepEqual(persisted(g.storage).roomLayout,expected);assert.equal(notified.length,1);
  for(const key of ['pet','coins','inventory','wardrobe','decorations','care','market','achievements'])assert.deepEqual(g.app.getState()[key],before[key],key);
});

test('throw false and explicit rejected writes retain both old and absent layouts and allow exact retry',async()=>{
  for(const previous of [undefined,roomLayout([]),roomLayout([roomItem('room_toy')])])for(const mode of ['throw','false','object_false']){
    const g=await game();if(previous)assert.equal((await saveRoom(g,previous)).ok,true);
    const raw=g.storage.data.get(Core.KEY),before=persisted(g.storage),write=g.storage.setItem.bind(g.storage);
    g.storage.setItem=async()=>{if(mode==='throw')throw new Error('private key=https://hidden.invalid');return mode==='false'?false:{ok:false};};
    const layout=roomLayout([roomItem('room_window')]),r=await saveRoom(g,layout);assert.equal(r.ok,false);assert.equal(r.error.code,'storage_failed');assert.equal(g.storage.data.get(Core.KEY),raw);
    for(const key of Object.keys(before))assert.deepEqual(r.state[key],before[key]);assert.equal(Object.hasOwn(r.state,'roomLayout'),Object.hasOwn(before,'roomLayout'));assert.doesNotMatch(JSON.stringify(r.error),/private|https:|key=/);
    g.storage.setItem=write;assert.equal((await saveRoom(g,layout,before.revision)).ok,true);assert.deepEqual(g.app.getState().roomLayout,layout);
  }
});

test('concurrent layout saves accept once and external CAS keeps the newer wallet and room untouched',async()=>{
  const g=await game(),revision=g.app.getState().revision,layouts=[roomLayout([roomItem('room_window')]),roomLayout([roomItem('room_bed')])];
  const results=await Promise.all(layouts.map(layout=>saveRoom(g,layout,revision)));assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results[1].error.code,'stale_state');
  assert.deepEqual(g.app.getState().roomLayout,layouts[0]);
  const other=Core.create(g.options);assert.equal((await other.ready).ok,true);const otherRevision=other.getState().revision;
  assert.equal((await command(g,'care',{kind:'feed'})).ok,true);const raw=g.storage.data.get(Core.KEY),before=persisted(g.storage);
  const stale=await other.dispatch({type:'saveRoomLayout',layout:layouts[1],expectedRevision:otherRevision});assert.equal(stale.error.code,'stale_state');assert.equal(g.storage.data.get(Core.KEY),raw);
  assert.deepEqual(persisted(g.storage),before);assert.deepEqual(other.getState().roomLayout,layouts[0]);assert.equal(other.getState().coins,100);
});

test('invalid saved layouts fail closed and malformed backups preserve the current room and economy',async()=>{
  const base=await game(),valid=persisted(base.storage),badLayouts=[null,{},roomLayout([roomItem('house')]),roomLayout([roomItem('room_bed',{x:101})]),roomLayout([roomItem('room_bed'),roomItem('room_bed')])];
  for(const room of badLayouts){const record={...valid,roomLayout:room},raw=JSON.stringify(record),storage=memory({[Core.KEY]:raw}),app=Core.create({storage,now:base.options.now});
    const r=await app.ready;assert.equal(r.ok,false);assert.equal(r.error.code,'corrupt_data');assert.equal(r.state.readOnly,true);assert.equal(storage.data.get(Core.KEY),raw);assert.equal(storage.writes.length,0);
    assert.equal((await app.dispatch({type:'care',kind:'feed'})).error.code,'read_only');
  }
  assert.equal((await saveRoom(base,roomLayout([roomItem('room_toy')]))).ok,true);const raw=base.storage.data.get(Core.KEY);
  for(const layout of badLayouts){const backup={format:'PetGameBackup',version:3,state:{...valid,roomLayout:layout}};assert.equal((await base.app.importBackup(JSON.stringify(backup))).ok,false);assert.equal(base.storage.data.get(Core.KEY),raw);}
});

test('older layout-free backups remain byte-stable on subsequent reads while custom rooms round-trip',async()=>{
  const old=await game({pg_exp:'686',pg_coins:'574',pg_deco:'{"house":{},"old-prop":{}}'}),legacyBackup=old.app.exportBackup();
  assert.equal((await saveRoom(old,roomLayout([roomItem('room_bed',{flip:true}),roomItem('house')]))).ok,true);
  const copy=await game();assert.equal((await copy.app.importBackup(old.app.exportBackup())).ok,true);assert.deepEqual(copy.app.getState().roomLayout,old.app.getState().roomLayout);assert.equal(copy.app.getState().pet.exp,686);assert.equal(copy.app.getState().coins,574);
  assert.equal((await copy.app.importBackup(legacyBackup)).ok,true);assert.equal(Object.hasOwn(copy.app.getState(),'roomLayout'),false);
  const raw=copy.storage.data.get(Core.KEY),writes=copy.storage.writes.length,reopened=Core.create(copy.options);await reopened.ready;
  Core.getRoomLayout(reopened.getState());assert.equal(copy.storage.data.get(Core.KEY),raw);assert.equal(copy.storage.writes.length,writes);assert.equal(reopened.getState().decorations.owned['old-prop']!==undefined,true);
});

test('old equipment stays layout-free until custom save then appends preserves or removes only its own known decoration',async()=>{
  const g=await game({pg_exp:'45',pg_coins:'1000',pg_deco:'{"house":{},"flower":{},"tree":{},"old-prop":{}}'});
  await command(g,'equip',{itemId:'house'});assert.equal(Object.hasOwn(persisted(g.storage),'roomLayout'),false);
  const initial=roomLayout([roomItem('room_window'),roomItem('house',{x:9,y:81,flip:true}),roomItem('tree',{x:32,y:86})]);assert.equal((await saveRoom(g,initial)).ok,true);
  await command(g,'equip',{itemId:'house'});assert.deepEqual(g.app.getState().roomLayout,initial,'already placed equipment keeps its exact position and flip');
  await command(g,'equip',{itemId:'flower'});assert.deepEqual(g.app.getState().roomLayout,roomLayout([...initial.items,{id:'flower',x:74,y:94,flip:false}]));
  await command(g,'equip',{itemId:null});assert.equal(g.app.getState().decorations.equipped,null);assert.deepEqual(g.app.getState().roomLayout,initial,'only the previous flower is removed; prior house/tree stay');
  await command(g,'buyItem',{itemId:'bg_beach'});const before=persisted(g.storage);await command(g,'equip',{itemId:'bg_beach'});assert.deepEqual(g.app.getState().roomLayout,before.roomLayout);
  await command(g,'equip',{itemId:'old-prop'});assert.equal(g.app.getState().decorations.equipped,'old-prop');assert.deepEqual(g.app.getState().roomLayout,initial);
  await command(g,'equip',{itemId:null});assert.deepEqual(g.app.getState().roomLayout,initial,'removing unknown legacy equipment cannot remove unrelated placed objects');
  assert.deepEqual(g.app.getState().decorations.owned,before.decorations.owned);
});

const villageIds=['home','cafe','shop','playground','tree','flowers'];
function villageLayout() { return {version:1,theme:'cafe',items:Core.villagePlaces.map(({id,x,y})=>({id,x,y}))}; }
async function saveVillage(g,layout,revision=g.app.getState().revision) {
  return command(g,'saveVillageLayout',{layout,expectedRevision:revision});
}

test('village places are frozen and layout-free v3 records have detached defaults without writes',async()=>{
  assert.equal(Object.isFrozen(Core.villagePlaces),true);assert.ok(Core.villagePlaces.every(Object.isFrozen));
  assert.deepEqual(Core.villagePlaces.map(x=>x.id),villageIds);
  assert.ok(Core.villagePlaces.every(x=>typeof x.name==='string'&&x.name.length>0));
  const initial=await game({pg_exp:'686',pg_coins:'574',pg_deco:'{"house":{},"legacy-prop":{}}'}),raw=initial.storage.data.get(Core.KEY);
  const g=await game({[Core.KEY]:raw}),writes=g.storage.writes.length;
  assert.equal(Object.hasOwn(g.app.getState(),'villageLayout'),false);
  assert.deepEqual(Core.getVillageLayout(g.app.getState()),villageLayout());
  assert.deepEqual(g.app.getVillageLayout(),villageLayout());
  const defaults=Core.defaultVillageLayout(),view=g.app.getVillageLayout();defaults.items[0].x=100;view.items.splice(0);
  assert.deepEqual(Core.defaultVillageLayout(),villageLayout());
  assert.equal(g.storage.data.get(Core.KEY),raw);assert.equal(g.storage.writes.length,writes);assert.equal(writes,0);
  const unchosen=await game({},()=>.5,false),before=unchosen.storage.data.get(Core.KEY);
  assert.equal((await saveVillage(unchosen,villageLayout())).error.code,'egg_required');assert.equal(unchosen.storage.data.get(Core.KEY),before);
});

test('saving village placements changes only layout revision and update time and keeps the separate room intact',async()=>{
  const first=await game({pg_exp:'686',pg_coins:'574',pg_items:'{"rice":2}',pg_deco:'{"house":{}}'});
  assert.equal((await saveRoom(first,roomLayout([roomItem('room_bed',{x:6,y:91,flip:true})]))).ok,true);
  const initial=persisted(first.storage);initial.achievements=[];
  const g=await game({[Core.KEY]:JSON.stringify(initial)}),before=persisted(g.storage),layout=villageLayout();
  layout.items.forEach((row,i)=>{row.x=i%2?100:0;row.y=100-i*20;});g.tick(71);
  const r=await saveVillage(g,layout);assert.equal(r.ok,true);assert.deepEqual(r.reward,{});
  assert.deepEqual(persisted(g.storage),{...before,villageLayout:layout,revision:before.revision+1,updatedAt:g.options.now()});
  assert.deepEqual(g.app.getVillageLayout(),layout);assert.deepEqual(r.state.roomLayout,before.roomLayout);assert.deepEqual(r.state.achievements,[]);
  layout.items[0].x=56;const view=g.app.getVillageLayout();view.items[0].y=5;
  assert.equal(g.app.getVillageLayout().items[0].x,0);assert.equal(g.app.getVillageLayout().items[0].y,100);
});

test('village layout rejects missing entrances extra fields malformed positions duplicate and unknown IDs without writes',async()=>{
  const g=await game(),raw=g.storage.data.get(Core.KEY),writes=g.storage.writes.length;
  const mutate=fn=>{const l=villageLayout();fn(l);return l;};
  const hidden=mutate(l=>Object.defineProperty(l.items[0],'hidden',{value:1}));
  const symbol=mutate(l=>{l[Symbol('extra')]=1;});
  const cases=[undefined,null,[],{}, {version:1,theme:'cafe'},
    mutate(l=>{l.version=2;}),mutate(l=>{l.theme='garden';}),mutate(l=>{l.extra=1;}),hidden,symbol,
    mutate(l=>{l.items={};}),mutate(l=>{l.items.pop();}),mutate(l=>{l.items.push({...l.items[0]});}),
    mutate(l=>{delete l.items[1];}),mutate(l=>{l.items[2]=l.items[0];}),mutate(l=>{l.items[2]=null;}),
    mutate(l=>{l.items[0].id='__proto__';}),mutate(l=>{l.items[0].id='constructor';}),mutate(l=>{l.items[0].id='house';}),
    mutate(l=>{l.items[0].flip=false;}),mutate(l=>{l.items.extra=1;}),mutate(l=>{delete l.items[0].x;})];
  for(const key of ['x','y'])for(const value of [-1,101,.5,NaN,Infinity,-Infinity,'25',null,undefined,{},[]])cases.push(mutate(l=>{l.items[1][key]=value;}));
  for(const layout of cases){const r=await saveVillage(g,layout);assert.equal(r.error.code,'invalid_village_layout');assert.equal(g.storage.data.get(Core.KEY),raw);assert.equal(g.storage.writes.length,writes);}
});

test('village editor revision and storage CAS reject stale saves without replacing newer care or layout',async()=>{
  const g=await game(),revision=g.app.getState().revision,layout=villageLayout();
  for(const expectedRevision of [undefined,null,String(revision),revision+.5,-1,NaN,Infinity,revision+1]){
    const r=await command(g,'saveVillageLayout',{layout,expectedRevision});assert.equal(r.error.code,'stale_state');
  }
  const other=Core.create(g.options);assert.equal((await other.ready).ok,true);
  assert.equal((await command(g,'care',{kind:'feed'})).ok,true);const raw=g.storage.data.get(Core.KEY);
  assert.equal((await saveVillage(g,layout,revision)).error.code,'stale_state');
  assert.equal((await other.dispatch({type:'saveVillageLayout',layout,expectedRevision:revision})).error.code,'stale_state');
  assert.equal(g.storage.data.get(Core.KEY),raw);assert.equal(Object.hasOwn(g.app.getState(),'villageLayout'),false);
  assert.equal((await saveVillage(g,layout)).ok,true);assert.equal(g.app.getState().pet.exp,8);
});

test('pending village layout writes expose no candidate and detach mutable caller input before completion',async()=>{
  const g=await game(),layout=villageLayout(),expected=structuredClone(layout),raw=g.storage.data.get(Core.KEY),notifications=[];
  const write=g.storage.setItem.bind(g.storage);let release;g.app.subscribe(s=>notifications.push(s));
  g.storage.setItem=(key,value)=>new Promise(resolve=>{release=()=>{write(key,value);resolve();};});
  const pending=saveVillage(g,layout);while(!release)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(g.storage.data.get(Core.KEY),raw);assert.equal(Object.hasOwn(g.app.getState(),'villageLayout'),false);assert.equal(notifications.length,0);
  layout.items[0].x=100;layout.items.pop();release();assert.equal((await pending).ok,true);
  assert.deepEqual(g.app.getVillageLayout(),expected);assert.deepEqual(persisted(g.storage).villageLayout,expected);assert.equal(notifications.length,1);
});

test('rejected village writes retain previous or absent layout and support exact retry without economy changes',async()=>{
  for(const previous of [false,true])for(const mode of ['throw','false','object_false']){
    const g=await game();if(previous)assert.equal((await saveVillage(g,villageLayout())).ok,true);
    const raw=g.storage.data.get(Core.KEY),before=persisted(g.storage),write=g.storage.setItem.bind(g.storage),layout=villageLayout();layout.items[0].x=99;
    g.storage.setItem=async()=>{if(mode==='throw')throw new Error('secret=https://hidden.invalid');return mode==='false'?false:{ok:false};};
    const r=await saveVillage(g,layout);assert.equal(r.error.code,'storage_failed');assert.equal(g.storage.data.get(Core.KEY),raw);
    for(const key of Object.keys(before))assert.deepEqual(r.state[key],before[key],key);
    assert.doesNotMatch(JSON.stringify(r.error),/secret|https:/);g.storage.setItem=write;
    assert.equal((await saveVillage(g,layout,before.revision)).ok,true);assert.deepEqual(g.app.getVillageLayout(),layout);
    assert.equal(g.app.getState().coins,before.coins);assert.equal(g.app.getState().pet.exp,before.pet.exp);
  }
});

test('invalid persisted village layouts fail closed and cannot replace a valid village through backup',async()=>{
  const g=await game(),original=persisted(g.storage),bad=[null,{}, {...villageLayout(),theme:'island'}, {...villageLayout(),items:[]},villageLayout()];
  bad[4].items[0].id='cafe';
  assert.equal((await saveVillage(g,villageLayout())).ok,true);const raw=g.storage.data.get(Core.KEY);
  for(const villageLayout of bad){
    const corrupt=JSON.stringify({...original,villageLayout}),storage=memory({[Core.KEY]:corrupt}),app=Core.create({storage,now:g.options.now});
    const ready=await app.ready;assert.equal(ready.error.code,'corrupt_data');assert.equal(ready.state.readOnly,true);assert.equal(storage.data.get(Core.KEY),corrupt);assert.equal(storage.writes.length,0);
    assert.equal((await app.dispatch({type:'care',kind:'feed'})).error.code,'read_only');
    assert.equal((await g.app.importBackup(JSON.stringify({format:'PetGameBackup',version:3,state:{...original,villageLayout}}))).error.code,'corrupt_data');assert.equal(g.storage.data.get(Core.KEY),raw);
  }
});

test('custom village and room survive backup reload while older village-free backups stay initialization-free',async()=>{
  const g=await game({pg_exp:'686',pg_coins:'574',pg_items:'{"rice":2}'}),old=g.app.exportBackup();
  assert.equal((await saveRoom(g,roomLayout([roomItem('room_rug',{x:5,y:95})]))).ok,true);
  const layout=villageLayout();layout.items.reverse();layout.items[0].y=11;
  assert.equal((await saveVillage(g,layout)).ok,true);const before=persisted(g.storage),raw=g.storage.data.get(Core.KEY),writes=g.storage.writes.length;
  const reload=Core.create(g.options);assert.equal((await reload.ready).ok,true);assert.deepEqual(reload.getVillageLayout(),layout);assert.equal(g.storage.writes.length,writes);assert.equal(g.storage.data.get(Core.KEY),raw);
  const target=await game();assert.equal((await target.app.importBackup(reload.exportBackup())).ok,true);
  for(const key of ['villageLayout','roomLayout','pet','coins','inventory','wardrobe','decorations','care','market','minigames'])assert.deepEqual(target.app.getState()[key],before[key],key);
  assert.equal((await target.app.importBackup(old)).ok,true);assert.equal(Object.hasOwn(target.app.getState(),'villageLayout'),false);
  const oldRaw=target.storage.data.get(Core.KEY),oldWrites=target.storage.writes.length,reopened=Core.create(target.options);await reopened.ready;reopened.getVillageLayout();
  assert.equal(target.storage.data.get(Core.KEY),oldRaw);assert.equal(target.storage.writes.length,oldWrites);
});

test('cafe snack and catch share exactly one three-start daily budget including cancellation and active-session exclusion',async()=>{
  const g=await game(),raw=g.storage.data.get(Core.KEY);
  for(const kind of ['unknown','__proto__',null,{},[]])assert.equal((await command(g,'beginMinigame',{kind})).error.code,'invalid_action');
  assert.equal(g.storage.data.get(Core.KEY),raw);
  for(const kind of ['snack','catch','snack']){
    const r=await command(g,'beginMinigame',{kind});assert.equal(r.ok,true);assert.equal(r.state.minigames.active.kind,kind);assert.ok(r.reward.sessionId.startsWith(kind+'-'));
    assert.equal((await command(g,'beginMinigame',{kind:kind==='snack'?'catch':'snack'})).error.code,'game_active');
    assert.equal((await command(g,'cancelMinigame',{sessionId:r.reward.sessionId})).ok,true);
  }
  for(const kind of ['catch','snack'])assert.equal((await command(g,'beginMinigame',{kind})).error.code,'daily_limit');
  assert.equal(g.app.getState().coins,100);assert.equal(g.app.getState().pet.exp,0);g.day();
  assert.equal((await command(g,'beginMinigame',{kind:'snack'})).ok,true);
});

test('snack settlement survives reload and backup with unchanged elapsed score reward and replay safeguards',async()=>{
  const g=await game(),start=await command(g,'beginMinigame',{kind:'snack'}),id=start.reward.sessionId;
  assert.equal((await command(g,'finishMinigame',{sessionId:id,score:30})).error.code,'game_too_short');
  const restored=await game();assert.equal((await restored.app.importBackup(g.app.exportBackup())).ok,true);
  assert.equal(restored.app.getState().minigames.active.kind,'snack');assert.equal(restored.app.getState().minigames.active.id,id);
  const reload=Core.create(g.options);assert.equal((await reload.ready).ok,true);g.tick();
  for(const score of [-1,31,.5,NaN,Infinity,'3']){const raw=g.storage.data.get(Core.KEY);assert.equal((await reload.dispatch({type:'finishMinigame',sessionId:id,score})).error.code,'invalid_score');assert.equal(g.storage.data.get(Core.KEY),raw);}
  const result=await reload.dispatch({type:'finishMinigame',sessionId:id,score:30});assert.equal(result.ok,true);assert.equal(result.reward.coins,30);assert.equal(result.reward.exp,10);assert.deepEqual(result.reward.items,[{id:'berry',count:1}]);
  assert.equal(result.state.coins,130);assert.equal(result.state.pet.exp,10);assert.equal(result.state.inventory.berry,1);assert.equal(result.state.minigames.active,null);
  const raw=g.storage.data.get(Core.KEY);for(const type of ['finishMinigame','cancelMinigame'])assert.equal((await reload.dispatch({type,sessionId:id,score:30})).error.code,'invalid_session');
  assert.equal(g.storage.data.get(Core.KEY),raw);
});

test('failed snack settlement retains the active session and grants one result only after durable retry',async()=>{
  const g=await game(),layout=villageLayout();assert.equal((await saveVillage(g,layout)).ok,true);
  const started=await command(g,'beginMinigame',{kind:'snack'}),id=started.reward.sessionId;g.tick();
  const raw=g.storage.data.get(Core.KEY),before=persisted(g.storage),write=g.storage.setItem.bind(g.storage);g.storage.setItem=()=>false;
  const failed=await command(g,'finishMinigame',{sessionId:id,score:12});assert.equal(failed.error.code,'storage_failed');assert.equal(g.storage.data.get(Core.KEY),raw);
  assert.equal(failed.state.minigames.active.id,id);assert.equal(failed.state.coins,before.coins);assert.deepEqual(failed.state.villageLayout,layout);
  g.storage.setItem=write;const retry=await command(g,'finishMinigame',{sessionId:id,score:12});assert.equal(retry.ok,true);assert.equal(retry.reward.coins,12);assert.equal(retry.reward.exp,6);assert.deepEqual(retry.state.villageLayout,layout);
  assert.equal((await command(g,'finishMinigame',{sessionId:id,score:12})).error.code,'invalid_session');assert.equal(g.app.getState().coins,before.coins+12);
});

test('failed equipment synchronization cannot adopt a layout append or removal',async()=>{
  const g=await game({pg_deco:'{"house":{},"flower":{}}'});await saveRoom(g,roomLayout([]));
  for(const action of [{type:'equip',itemId:'house'},{type:'equip',itemId:null}]){
    if(action.itemId===null)await command(g,'equip',{itemId:'house'});
    const raw=g.storage.data.get(Core.KEY),before=persisted(g.storage),set=g.storage.setItem.bind(g.storage);g.storage.setItem=async()=>false;
    const r=await g.app.dispatch(action);assert.equal(r.ok,false);assert.equal(g.storage.data.get(Core.KEY),raw);assert.deepEqual(r.state.roomLayout,before.roomLayout);assert.deepEqual(r.state.decorations,before.decorations);g.storage.setItem=set;
  }
});

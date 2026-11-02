'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const Core=require('../static/pet-game-core.js');
const prefix='/static/pet-characters/milne-original8-v1/';
// Alpha >=31 silhouettes measured from these exact existing 640px WebPs.
// Box bottoms are exclusive; low-alpha stray pixels are not foot landmarks.
const assets={
 egg:{bytes:38842,sha256:'87d21c9c4370d3c02ce241c96c367d88698d38e62d115783d908b46016449140',bottom:597},
 newborn:{bytes:64496,sha256:'b49268491715c6ea014a99f4deecdf9ceb354690a930a4046404160ea053ffdc',bottom:599},
 baby:{bytes:59440,sha256:'e52b71830288712c182f8fb055c622cdf24159a9f87c5e8b41bd5fda5323e806',bottom:608},
 child:{bytes:51734,sha256:'0863810aec57f1ab1b454f683c5c713e7e26b9fb92ce37d3187a3961320935ba',bottom:595},
 adult:{bytes:77396,sha256:'06950a43f18cf7bd22a0d0c8a36239eda724a70352149f071e9e6590971d86ad',bottom:613}
};
function fixture(){
 const listeners=[],timers=[];
 const forbidden=()=>assert.fail('Presentation reads must not access network or storage');
 const document={hidden:false,addEventListener(type,fn){listeners.push([type,fn]);}};
 const window={PetGameCore:Core,addEventListener(type,fn){listeners.push([type,fn]);},setInterval(fn,ms){timers.push([fn,ms]);return timers.length;},fetch:forbidden,localStorage:{getItem:forbidden,setItem:forbidden,removeItem:forbidden}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static/pet-game.js'),'utf8'),{window,document});
 assert.equal(typeof window.IndependentPetGame.mainCharacterProfile,'function');
 return {profile:window.IndependentPetGame.mainCharacterProfile};
}
function state(exp=400,species='lilac',origin='lilac'){
 const value={revision:17,pet:{name:'名前はそのまま',species,exp,eggOrigin:origin,path:'cute',pixel:false},coins:321,inventory:{apple:2},wardrobe:{owned:{},equipped:null},history:[{stage:'child',at:123}]};
 return value;
}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

test('the current Lilac and historical dragon presentation use Milne without changing the stored identity or name',()=>{
 const {profile}=fixture();
 for(const species of ['lilac','dragon'])for(const legacy of [false,true]){
  const saved=state(400,species);if(legacy)delete saved.pet.eggOrigin;
  const before=JSON.stringify(saved),result=profile(saved);
  assert.equal(result.characterId,'milne');assert.equal(result.stage,'adult');assert.equal(result.src,prefix+'adult.webp');
  assert.equal(JSON.stringify(saved),before);assert.equal(saved.pet.species,species);assert.equal(saved.pet.name,'名前はそのまま');
 }
});

test('every existing appearance boundary selects one of the five original artworks without changing growth thresholds',()=>{
 const {profile}=fixture();
 const cases=[[0,'egg'],[4,'egg'],[5,'egg'],[9,'egg'],[10,'egg'],[14,'egg'],[15,'newborn'],[29,'newborn'],[30,'baby'],[44,'baby'],[45,'baby'],[74,'baby'],[75,'child'],[109,'child'],[110,'child'],[199,'child'],[200,'child'],[399,'child'],[400,'adult'],[799,'adult'],[800,'adult'],[9000,'adult']];
 const milestones=Core.lilacGrowthStages.map(row=>[row.key,row.min]);
 for(const [exp,expected]of cases){const saved=freeze(state(exp)),result=profile(saved);assert.equal(result.stage,expected,'EXP '+exp);assert.equal(result.src,prefix+expected+'.webp');assert.equal(saved.pet.exp,exp);}
 assert.deepEqual(Core.lilacGrowthStages.map(row=>[row.key,row.min]),milestones);
 assert.deepEqual(milestones,[['egg',0],['baby',15],['child',45],['final',110],['adult',400],['companion',800]]);
});

test('other saved species, other birth origins and the unchosen egg remain outside this replacement',()=>{
 const {profile}=fixture();
 for(const saved of [state(400,'bunny'),state(400,'lilac','mint'),state(400,'lilac','apricot'),state(0,'lilac',null)]){
  const before=JSON.stringify(saved);assert.equal(profile(freeze(saved)),null);assert.equal(JSON.stringify(saved),before);
 }
});

test('profiles and capability data are frozen pure reads and do not claim directional animation, rig or fitting',()=>{
 const {profile}=fixture(),saved=freeze(state()),before=JSON.stringify(saved),result=profile(saved);
 assert.equal(Object.isFrozen(result),true);assert.equal(Object.isFrozen(result.capabilities),true);
 assert.deepEqual(JSON.parse(JSON.stringify(result.capabilities)),{staticFront:true,directional:false,rig:false,fitting:false});
 assert.equal(Reflect.set(result,'stage','egg'),false);assert.equal(Reflect.set(result.capabilities,'fitting',true),false);
 assert.equal(result.stage,'adult');assert.equal(result.capabilities.fitting,false);assert.equal(JSON.stringify(saved),before);
});

test('public asset metadata binds all five unchanged WebPs and their measured alpha31 bottom-gap anchors',()=>{
 const {profile}=fixture(),exampleExp={egg:0,newborn:15,baby:30,child:75,adult:400};
 for(const [stage,expected]of Object.entries(assets)){
  const result=profile(state(exampleExp[stage]));assert.equal(result.src,prefix+stage+'.webp');
  const bytes=fs.readFileSync(path.join(__dirname,'..',result.src.slice(1)));assert.equal(bytes.length,expected.bytes);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),expected.sha256);
  assert.equal(result.anchor,(640-expected.bottom)/640);assert.ok(result.anchor>0&&result.anchor<.1);
 }
});

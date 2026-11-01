'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('older browser consumers can load Core without the optional calendar and later share the provided calendar without initializing saves',async()=>{
 const root={PetVillageEconomy:require('../static/pet-village-economy.js'),PetShopLayout:require('../static/pet-shop-layout.js'),PetRiverFishing:require('../static/pet-river-fishing.js'),PetOceanDiscoveries:require('../static/pet-ocean-discoveries.js')};
 const context=vm.createContext(root);vm.runInContext(fs.readFileSync(require.resolve('../static/pet-game-core.js'),'utf8'),context);
 const Core=root.PetGameCore;assert.ok(Core);assert.equal(Core.getSeasonalLife(Date.UTC(2026,5,1)),null);
 let writes=0;const store=new Map(),app=Core.create({storage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>{store.set(k,v);writes++;}},now:()=>Date.UTC(2026,5,1),random:()=>.5});assert.equal((await app.ready).ok,true);
 const before=store.get(Core.KEY),count=writes;context.PetJapanSeasons=require('../static/pet-japan-seasons.js');
 assert.equal(Core.getSeasonalLife(Date.UTC(2026,5,1)).fruit.id,'peach');assert.equal(Core.getVillageHarvestView(app.getState(),Date.UTC(2026,5,1)).plots[0].itemId,'peach');assert.equal(store.get(Core.KEY),before);assert.equal(writes,count);
});

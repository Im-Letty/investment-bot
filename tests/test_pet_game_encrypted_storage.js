'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const Core = require('../static/pet-game-core.js');

function gate(seed = {}, failWrites = false) {
  const values = new Map(Object.entries(seed));
  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { if (failWrites) throw new Error('quota'); values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
  const context = {localStorage:storage,crypto:webcrypto,TextEncoder,TextDecoder,
    btoa:value => Buffer.from(value, 'binary').toString('base64'),
    atob:value => Buffer.from(value, 'base64').toString('binary')};
  context.window = context;
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const start = html.indexOf('/* knGate: encrypted localStorage gate');
  assert.ok(start > 0);
  vm.runInNewContext(html.slice(start, html.indexOf('</script>', start)), context);
  return {context,values};
}

test('new game records retain encrypted persistence and await actual storage success', async () => {
  const {context,values} = gate();
  await context.__knGateReady;
  assert.ok(context.__knGate.whitelist.includes('pet_game_v3'));
  await context.__knPersistLocalSetting('pet_game_v3', '{"version":3,"coins":123}');
  assert.equal(values.has('pet_game_v3'), false);
  assert.match(values.get('knenc:pet_game_v3'), /^knv1:/);
  assert.equal(await context.__knReadGameStorage('pet_game_v3'), '{"version":3,"coins":123}');
  const restored = gate(Object.fromEntries(values));
  await restored.context.__knGateReady;
  assert.equal(await restored.context.__knReadGameStorage('pet_game_v3'), '{"version":3,"coins":123}');
});

test('an undecipherable legacy game or growth counter cannot masquerade as an empty save', async () => {
  for (const key of ['pet_game','pet_game_v3','sk_total','sk_streak']) {
    const {context,values} = gate({['knenc:'+key]:'knv1:broken.cipher'});
    await context.__knGateReady;
    await assert.rejects(async () => await context.__knReadGameStorage(key));
    assert.equal(values.get('knenc:'+key), 'knv1:broken.cipher');
  }
});

test('failed encrypted writes reject without adopting an unsaved game cache', async () => {
  const {context,values} = gate({}, true);
  await context.__knGateReady;
  await assert.rejects(context.__knPersistLocalSetting('pet_game_v3','{"version":3}'));
  assert.equal(await context.__knReadGameStorage('pet_game_v3'), null);
  assert.equal(values.has('knenc:pet_game_v3'), false);
});

test('game storage reads cannot expose unrelated local account or household records', async () => {
  const {context} = gate({pg_exp:'42',private_account:'unrelated'});
  await context.__knGateReady;
  assert.equal(await context.__knReadGameStorage('pg_exp'), '42');
  await assert.rejects(async () => await context.__knReadGameStorage('private_account'));
  await assert.rejects(async () => await context.__knReadGameStorage('knVaultKeyV1'));
});

function gameAdapter(window){return {getItem:key=>window.__knReadGameStorage(key),setItem:(key,value)=>window.__knPersistLocalSetting(key,value)};}

test('custom room furniture round-trips the real encrypted game boundary without plaintext or extra keys',async()=>{
  const first=gate({pg_exp:'0'});await first.context.__knGateReady;
  const now=()=>new Date(2026,9,22,12).getTime(),app=Core.create({storage:gameAdapter(first.context),now});assert.equal((await app.ready).ok,true);
  const before=app.getState(),layout={version:1,items:[{id:'room_bed',x:82,y:84,flip:true},{id:'room_window',x:20,y:35,flip:false}]};
  assert.equal((await app.dispatch({type:'saveRoomLayout',layout,expectedRevision:before.revision})).ok,true);
  assert.equal(first.values.has(Core.KEY),false);const ciphertext=first.values.get('knenc:'+Core.KEY);assert.match(ciphertext,/^knv1:/);assert.equal(ciphertext.includes('room_bed'),false);
  const restored=gate(Object.fromEntries(first.values));await restored.context.__knGateReady;
  const reopened=Core.create({storage:gameAdapter(restored.context),now});assert.equal((await reopened.ready).ok,true);
  assert.deepEqual(Core.getRoomLayout(reopened.getState()),layout);assert.equal(restored.values.get('knenc:'+Core.KEY),ciphertext,'read-only hydration does not rewrite ciphertext');
  for(const key of ['pet','coins','inventory','wardrobe','decorations','care','market','achievements'])assert.deepEqual(reopened.getState()[key],before[key],key);
  assert.equal((await reopened.dispatch({type:'saveRoomLayout',layout:{version:1,items:[]},expectedRevision:reopened.getState().revision})).ok,true);
  const empty=gate(Object.fromEntries(restored.values));await empty.context.__knGateReady;const emptyGame=Core.create({storage:gameAdapter(empty.context),now});await emptyGame.ready;
  assert.deepEqual(Core.getRoomLayout(emptyGame.getState()),{version:1,items:[]});
});

test('failed encrypted layout save retains previous ciphertext and confirmed furniture',async()=>{
  const first=gate({pg_exp:'0'});await first.context.__knGateReady;
  const now=()=>new Date(2026,9,22,12).getTime(),app=Core.create({storage:gameAdapter(first.context),now});await app.ready;
  const layout={version:1,items:[{id:'room_toy',x:40,y:90,flip:false}]};assert.equal((await app.dispatch({type:'saveRoomLayout',layout,expectedRevision:app.getState().revision})).ok,true);
  const denied=gate(Object.fromEntries(first.values),true);await denied.context.__knGateReady;
  const reopened=Core.create({storage:gameAdapter(denied.context),now});assert.equal((await reopened.ready).ok,true);const before=reopened.getState(),ciphertext=denied.values.get('knenc:'+Core.KEY);
  const result=await reopened.dispatch({type:'saveRoomLayout',layout:{version:1,items:[]},expectedRevision:before.revision});assert.equal(result.ok,false);assert.equal(result.error.code,'storage_failed');
  assert.equal(denied.values.get('knenc:'+Core.KEY),ciphertext);assert.deepEqual(Core.getRoomLayout(reopened.getState()),layout);
  for(const key of ['pet','coins','inventory','wardrobe','decorations','care','market','achievements','revision'])assert.deepEqual(reopened.getState()[key],before[key],key);
});

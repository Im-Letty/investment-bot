'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const Core = require('../static/pet-game-core.js');
const Economy = require('../static/pet-village-economy.js');
const BASE = Date.parse('2026-10-24T03:00:00Z');

// Actual current encrypted gate, isolated synthetic values only. No personal
// browser profile, account data, network, or filesystem save is accessed.
function gate(seed = {}) {
  const values = new Map(Object.entries(seed)), control = { fail: false, writes: 0 }, localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { if (control.fail) throw Error('synthetic encrypted storage denial'); control.writes++; values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
  const window = { localStorage, crypto: webcrypto, TextEncoder, TextDecoder,
    btoa: value => Buffer.from(value, 'binary').toString('base64'), atob: value => Buffer.from(value, 'base64').toString('binary') };
  window.window = window;
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8'), start = html.indexOf('/* knGate: encrypted localStorage gate');
  assert.ok(start > 0); vm.runInNewContext(html.slice(start, html.indexOf('</script>', start)), window);
  return { window, values, control };
}
function adapter(g) { return { getItem: key => g.window.__knReadGameStorage(key), setItem: (key, text) => g.window.__knPersistLocalSetting(key, text) }; }
async function open(g, clock = { now: BASE }) { await g.window.__knGateReady; const app = Core.create({ storage: adapter(g), now: () => clock.now }); assert.equal((await app.ready).ok, true); return app; }
async function command(app, type, fields = {}) { const result = await app.dispatch({ type, expectedRevision: app.getState().revision, ...fields }); assert.equal(result.ok, true, result.error && result.error.code); return result; }
async function selected() { const g = gate(), clock = { now: BASE }, app = await open(g, clock); await command(app, 'chooseEgg', { eggOrigin: 'lilac' }); return { g, app, clock }; }

test('optional NPC state round-trips the actual encrypted gate with no new key/plaintext and zero read/view initialization writes', async () => {
  const { g, app, clock } = await selected(); await command(app, 'buyItem', { itemId: 'apple' });
  const keys = [...g.values.keys()].sort(); await command(app, 'placeVillageListing', { itemId: 'apple', quantity: 1, unitPrice: 999 });
  await command(app, 'contributeVillageShop', { shopId: 'orchard', quantity: 2 });
  const saved = app.getState(), ciphertext = g.values.get('knenc:' + Core.KEY); assert.match(ciphertext, /^knv1:/);
  assert.equal(g.values.has(Core.KEY), false); assert.equal(ciphertext.includes('villageEconomy'), false); assert.equal(ciphertext.includes('orchard'), false); assert.deepEqual([...g.values.keys()].sort(), keys);
  const restored = gate(Object.fromEntries(g.values)), reopened = await open(restored, clock), writes = restored.control.writes;
  for (let i = 0; i < 5; i++) reopened.getVillageEconomyView();
  assert.deepEqual(reopened.getState().villageEconomy, saved.villageEconomy); assert.deepEqual(reopened.getState().inventory, saved.inventory); assert.equal(reopened.getState().coins, saved.coins);
  assert.equal(restored.values.get('knenc:' + Core.KEY), ciphertext); assert.equal(restored.control.writes, writes); assert.equal(restored.values.has(Core.KEY), false);
});

test('actual encrypted write rejection keeps the confirmed full ciphertext and retry settles the same NPC demand once', async () => {
  const { g, app, clock } = await selected(); await command(app, 'buyItem', { itemId: 'apple' }); await command(app, 'placeVillageListing', { itemId: 'apple', quantity: 1, unitPrice: 1 });
  const state = app.getState(), cipher = g.values.get('knenc:' + Core.KEY), confirmedRaw = await g.window.__knReadGameStorage(Core.KEY), expected = Economy.transition(state, { type: 'advanceVillageEconomy', expectedRevision: state.revision }, clock.now);
  g.control.fail = true; const failed = await app.dispatch({ type: 'advanceVillageEconomy', expectedRevision: state.revision });
  assert.equal(failed.error.code, 'storage_failed'); assert.equal(g.values.get('knenc:' + Core.KEY), cipher); assert.equal(await g.window.__knReadGameStorage(Core.KEY), confirmedRaw);
  assert.deepEqual(app.getState().villageEconomy, state.villageEconomy); assert.equal(app.getState().coins, state.coins); assert.equal(app.getState().revision, state.revision);
  g.control.fail = false; await command(app, 'advanceVillageEconomy'); assert.deepEqual(app.getState().villageEconomy, expected.economy); assert.equal(app.getState().coins, expected.coins);
  assert.equal(g.values.has(Core.KEY), false); assert.notEqual(g.values.get('knenc:' + Core.KEY), cipher);
});

test('share purchase, fees, average basis and loss survive encrypted reload without touching pet or old market', async () => {
  const { g, app, clock } = await selected();
  for (let i = 0; i < 11; i++) { clock.now += 60000; await command(app, 'advanceVillageEconomy'); }
  const before = app.getState(), shop = app.getVillageEconomyView().shops[0]; assert.equal(shop.status, 'open');
  await command(app, 'buyVillageShares', { shopId: shop.id, quantity: 1 }); await command(app, 'sellVillageShares', { shopId: shop.id, quantity: 1 });
  const after = app.getState(); assert.equal(after.coins, before.coins - 2); assert.equal(after.villageEconomy.shops.orchard.realizedProfit, -2); assert.equal(after.villageEconomy.shops.orchard.costBasis, 0);
  const restored = gate(Object.fromEntries(g.values)), reopened = await open(restored, clock);
  assert.deepEqual(reopened.getState().villageEconomy, after.villageEconomy); assert.equal(reopened.getState().coins, after.coins);
  for (const key of ['pet', 'market', 'care', 'achievements', 'wardrobe', 'decorations', 'minigames']) assert.deepEqual(reopened.getState()[key], before[key], key);
});

test('corrupt present encrypted economy is preserved and rejected rather than treated as new/default wallet', async () => {
  const { g, app, clock } = await selected(), state = app.getState(); state.villageEconomy = Economy.get(state); state.villageEconomy.shops.orchard.capitalRaised = 99;
  await g.window.__knPersistLocalSetting(Core.KEY, JSON.stringify(state)); const cipher = g.values.get('knenc:' + Core.KEY), restored = gate(Object.fromEntries(g.values)); await restored.window.__knGateReady;
  const blocked = Core.create({ storage: adapter(restored), now: () => clock.now }); assert.equal((await blocked.ready).error.code, 'corrupt_data'); assert.equal(blocked.getState().readOnly, true);
  assert.equal((await blocked.dispatch({ type: 'advanceVillageEconomy', expectedRevision: state.revision })).error.code, 'read_only'); assert.equal(restored.values.get('knenc:' + Core.KEY), cipher); assert.equal(restored.values.has(Core.KEY), false);
});

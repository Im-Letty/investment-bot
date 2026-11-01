'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../static/pet-game-core.js');
const Seasons = require('../static/pet-japan-seasons.js');
const clone = x => JSON.parse(JSON.stringify(x));
const JST = (y, m, d, h = 12, min = 0, sec = 0, milli = 0) => Date.UTC(y, m - 1, d, h - 9, min, sec, milli);
const expected = [
  ['spring', 3, ['berry', 'asparagus']], ['summer', 6, ['peach', 'cucumber']],
  ['autumn', 9, ['pear', 'sweet_potato']], ['winter', 12, ['mandarin', 'daikon']]
];
async function fixture({ now = JST(2026, 3, 1), raw = null, choose = true } = {}) {
  const data = new Map(raw ? [[Core.KEY, raw]] : []), writes = [], control = { mode: 'ok', pending: null };
  let ms = now;
  const storage = { getItem: k => data.get(k) ?? null, async setItem(k, v) {
    if (control.pending) await control.pending.promise;
    if (control.mode === 'false') return false;
    if (control.mode === 'object') return { ok: false };
    if (control.mode === 'throw') throw Error('synthetic private adapter failure');
    data.set(k, v); writes.push([k, v]);
  } };
  const options = { storage, now: () => ms, random: () => .5 }, app = Core.create(options), ready = await app.ready;
  if (ready.ok && choose && Core.needsEggChoice(app.getState())) assert.equal((await app.dispatch({ type: 'chooseEgg', eggOrigin: 'lilac' })).ok, true);
  return { app, ready, options, control, data, writes, now: () => ms, time: n => { ms = n; }, raw: () => data.get(Core.KEY), saved: () => JSON.parse(data.get(Core.KEY)),
    act(type, fields = {}, rev = app.getState().revision) { return app.dispatch({ type, ...fields, expectedRevision: rev }); } };
}
const view = g => Core.getVillageHarvestView(g.app.getState(), g.now());

test('the shared recurring JST calendar selects fruit and vegetable at exact four-season and next-year edges', () => {
  for (const y of [2026, 2027, 2028]) for (const [key, month, ids] of expected) {
    const at = JST(y, month, 1, 0), next = Seasons.life(at), prev = Seasons.life(at - 1);
    assert.equal(next.key, key); assert.deepEqual([next.fruit.id, next.vegetable.id], ids);
    assert.notEqual(prev.key, key); assert.equal(next.dateJst, `${y}-${String(month).padStart(2, '0')}-01`);
    assert.equal(Seasons.life(JST(y, month, 15)).key, key);
  }
  assert.equal(Seasons.life(JST(2028, 2, 29, 23, 59, 59, 999)).key, 'winter');
  assert.equal(Seasons.life(JST(2028, 3, 1, 0)).key, 'spring');
  for (const bad of [NaN, Infinity, -Infinity, undefined, '2026-03-01']) assert.equal(Seasons.life(bad), null);
});

test('calendar and harvest views are pure across seasons and do not migrate old possession records', async () => {
  const base = await fixture(), saved = base.saved();
  saved.inventory = { apple: 8, berry: 5, peach: 2, old_shell: 4 };
  saved.riverFishing = { version: 1, catches: { river_silverfish: 9 }, active: null, nextCastAt: 0 };
  const raw = JSON.stringify(saved), g = await fixture({ raw });
  const before = g.raw(), n = g.writes.length;
  for (const [key, month, ids] of expected) {
    g.time(JST(2027, month, 15)); const current = view(g);
    assert.equal(current.season.key, key); assert.deepEqual(current.plots.map(p => p.itemId), ids);
    assert.deepEqual(current.plots.map(p => p.id), ['orchard', 'berry']);
    current.plots[0].owned = 0; Core.getSeasonalLife(g.now());
  }
  assert.equal(g.raw(), before); assert.equal(g.writes.length, n);
  assert.deepEqual(g.saved().inventory, saved.inventory); assert.deepEqual(g.saved().riverFishing, saved.riverFishing);
});

test('action-time season controls the real reward and stable daily plot IDs enforce one claim with stale or forged inputs', async () => {
  const g = await fixture({ now: JST(2026, 5, 31, 23, 59, 59) });
  const before = g.saved(), old = view(g), rev = g.app.getState().revision;
  assert.equal(old.plots[0].itemId, 'berry');
  assert.equal((await g.act('harvestVillageFood', { plotId: 'orchard', itemId: 'apple', quantity: 500 })).reward.itemId, 'berry');
  let raw = g.raw(); assert.equal((await g.act('harvestVillageFood', { plotId: 'orchard' })).error.code, 'harvest_wait'); assert.equal(g.raw(), raw);
  assert.equal((await g.act('harvestVillageFood', { plotId: 'berry' }, rev)).error.code, 'stale_state'); assert.equal(g.raw(), raw);
  g.time(JST(2026, 6, 1, 0));
  assert.equal(view(g).plots[0].itemId, 'peach');
  assert.equal((await g.act('harvestVillageFood', { plotId: old.plots[0].id, itemId: old.plots[0].itemId })).reward.itemId, 'peach');
  raw = g.raw(); assert.equal((await g.act('harvestVillageFood', { plotId: 'orchard' })).error.code, 'harvest_wait'); assert.equal(g.raw(), raw);
  assert.deepEqual(g.saved().inventory, { berry: 1, peach: 1 });
  for (const k of ['pet', 'coins', 'care', 'market', 'wardrobe', 'decorations', 'achievements']) assert.deepEqual(g.saved()[k], before[k], k);
  g.time(JST(2026, 5, 31, 23, 59, 59)); assert.equal((await g.act('harvestVillageFood', { plotId: 'berry' })).error.code, 'clock_moved_back'); assert.equal(g.raw(), raw);
});

test('all seasonal acquisitions accumulate without deleting old food, including a new-year and reopened backup', async () => {
  const g = await fixture();
  for (const [, month] of expected) {
    g.time(JST(2026, month, 15));
    for (const p of view(g).plots) assert.equal((await g.act('harvestVillageFood', { plotId: p.id })).ok, true);
  }
  const accumulated = clone(g.saved().inventory); assert.equal(Object.keys(accumulated).length, 8);
  g.time(JST(2027, 3, 1)); await g.act('harvestVillageFood', { plotId: 'orchard' });
  assert.deepEqual(g.saved().inventory, { ...accumulated, berry: accumulated.berry + 1 });
  const reopened = Core.create(g.options), before = g.raw(), writes = g.writes.length;
  assert.equal((await reopened.ready).ok, true); assert.deepEqual(reopened.getState().inventory, g.saved().inventory); assert.equal(g.raw(), before); assert.equal(g.writes.length, writes);
  const other = await fixture({ now: g.now() }); assert.equal((await other.app.importBackup(reopened.exportBackup())).ok, true);
  assert.deepEqual(other.saved().inventory, g.saved().inventory); assert.deepEqual(other.saved().villageLife.harvest, g.saved().villageLife.harvest);
});

for (const mode of ['false', 'object', 'throw']) test(`seasonal harvest ${mode} ACK preserves exact bytes and claims until explicit retry`, async () => {
  const g = await fixture({ now: JST(2026, 12, 1) }), raw = g.raw(), prior = g.app.getState(), writes = g.writes.length;
  g.control.mode = mode;
  const failed = await g.act('harvestVillageFood', { plotId: 'berry' });
  assert.equal(failed.ok, false); assert.equal(failed.error.code, 'storage_failed'); assert.equal(g.raw(), raw); assert.deepEqual({ ...g.app.getState(), error: null }, prior); assert.equal(g.app.getState().error.code, 'storage_failed'); assert.equal(g.writes.length, writes);
  assert.equal(view(g).plots[1].claimed, false); assert.doesNotMatch(JSON.stringify(failed.error), /private|adapter/);
  g.control.mode = 'ok'; const result = await g.act('harvestVillageFood', { plotId: 'berry' });
  assert.deepEqual(result.reward, { itemId: 'daikon', quantity: 1 }); assert.equal(g.saved().inventory.daikon, 1); assert.equal(view(g).plots[1].claimed, true);
});

test('overflow rejects the seasonal claim atomically and a corrupted old claim fails read-only without reset', async () => {
  const base = await fixture(), saturated = base.saved(); saturated.inventory.berry = 9000000000000;
  const g = await fixture({ raw: JSON.stringify(saturated) }), raw = g.raw();
  assert.equal((await g.act('harvestVillageFood', { plotId: 'orchard' })).error.code, 'amount_overflow'); assert.equal(g.raw(), raw); assert.equal(view(g).plots[0].claimed, false);
  const broken = clone(saturated); broken.villageLife.harvest = { day: '2026-03-01', claimed: ['orchard', 'orchard'] };
  const corruptRaw = JSON.stringify(broken), bad = await fixture({ raw: corruptRaw });
  assert.equal(bad.ready.ok, false); assert.equal(bad.app.getState().readOnly, true); assert.equal(bad.raw(), corruptRaw); assert.equal(bad.writes.length, 0);
});

test('new harvest-only foods cannot be bought free and consuming a saved seasonal food uses established fruit or hearty growth', async () => {
  for (const id of ['peach', 'pear', 'mandarin', 'asparagus', 'cucumber', 'sweet_potato', 'daikon']) {
    const base = await fixture(), saved = base.saved(), food = Core.items.find(x => x.id === id); saved.inventory[id] = 1;
    const g = await fixture({ raw: JSON.stringify(saved) }), raw = g.raw(), before = g.saved();
    assert.equal(food.harvestOnly, true); assert.equal((await g.act('buyItem', { itemId: id, price: 0 })).error.code, 'invalid_item'); assert.equal(g.raw(), raw);
    const used = await g.act('useItem', { itemId: id }); assert.equal(used.ok, true); assert.equal(used.reward.exp, food.exp);
    assert.equal(g.saved().inventory[id], 0); assert.equal(g.saved().pet.exp, before.pet.exp + food.exp); assert.equal(g.saved().coins, before.coins); assert.deepEqual(g.saved().care, { ...before.care, lastCareAt: g.now() });
    assert.equal(g.saved().evolution.scores[food.foodGroup === 'fruit' ? 'fruit' : 'hearty'], 3);
    const once = g.raw(); assert.equal((await g.act('useItem', { itemId: id })).error.code, 'not_owned'); assert.equal(g.raw(), once);
  }
  assert.deepEqual(Core.items.slice(0, 5).map(x => [x.id, x.price, x.exp]), [['apple',8,3],['cake',18,6],['berry',6,2],['rice',12,4],['feast',15,20]]);
});

test('pending seasonal harvest publishes neither count nor claim until ACK and a simultaneous stale claim cannot duplicate it', async () => {
  const g = await fixture({ now: JST(2026, 9, 1) }), before = g.raw(), prior = g.app.getState(), writes = g.writes.length, revision = prior.revision;
  let release; g.control.pending = { promise: new Promise(resolve => { release = resolve; }) };
  const first = g.act('harvestVillageFood', { plotId: 'orchard' }, revision), duplicate = g.act('harvestVillageFood', { plotId: 'orchard' }, revision);
  for (let i = 0; i < 24; i++) await Promise.resolve();
  assert.equal(g.raw(), before); assert.deepEqual(g.app.getState(), prior); assert.equal(g.writes.length, writes); assert.equal(view(g).plots[0].claimed, false);
  release(); g.control.pending = null;
  assert.deepEqual((await first).reward, { itemId: 'pear', quantity: 1 }); assert.equal((await duplicate).error.code, 'stale_state');
  assert.equal(g.saved().inventory.pear, 1); assert.equal(g.writes.length, writes + 1); assert.equal(view(g).plots[0].claimed, true);
});

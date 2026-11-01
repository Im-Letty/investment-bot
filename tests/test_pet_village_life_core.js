'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../static/pet-game-core.js');
const clone = x => JSON.parse(JSON.stringify(x));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function game(seed = {}, opts = {}) {
  const data = new Map(Object.entries(seed)), writes = [], control = { mode: 'ok', pending: null };
  let now = opts.now ?? Date.UTC(2026, 9, 25, 3);
  const storage = { getItem: k => data.get(k) ?? null, async setItem(k, v) {
    if (control.pending) await control.pending.promise;
    if (control.mode === 'throw') throw Error('private storage detail');
    if (control.mode === 'false') return false; if (control.mode === 'object') return { ok: false };
    data.set(k, v); writes.push([k, v]);
  } };
  const options = { storage, now: () => now, random: opts.random || (() => .5) }, app = Core.create(options);
  assert.equal((await app.ready).ok, true);
  if (opts.choose !== false && Core.needsEggChoice(app.getState())) assert.equal((await app.dispatch({ type: 'chooseEgg', eggOrigin: 'lilac' })).ok, true);
  return { app, data, writes, control, options, storage, setTime(value) { now = value; }, advance(ms) { now += ms; }, raw() { return data.get(Core.KEY); }, state() { return JSON.parse(data.get(Core.KEY)); },
    act(type, fields = {}, revision = app.getState().revision) { return app.dispatch({ type, expectedRevision: revision, ...fields }); } };
}
const furniture = (g, id) => Core.getHomeFurnishingsView(g.app.getState()).items.find(row => row.id === id);

test('a true new record starts with only two owned home fixtures and pure getters never initialize or rewrite layouts', async () => {
  const g = await game(), before = g.raw(), writes = g.writes.length, view = Core.getHomeFurnishingsView(g.app.getState());
  assert.equal(view.homeMode, 'starter'); assert.equal(view.purchaseCount, 0);
  assert.deepEqual(view.items.filter(x => x.owned).map(x => x.id), ['bed', 'rug']);
  assert.deepEqual(Core.getCozyRoomLayout(g.app.getState()).objects.map(x => x.type), ['bed', 'rug']);
  assert.deepEqual(Core.getCozyRoomFurniture(g.app.getState()).map(x => [x.id, x.limit]), [['bed', 1], ['rug', 1]]);
  view.items[0].owned = false; Core.getVillageHarvestView(g.app.getState(), g.options.now()); g.app.getHomeFurnishingsView(); g.app.getCozyRoomFurniture();
  assert.equal(furniture(g, 'bed').owned, true); assert.equal(g.raw(), before); assert.equal(g.writes.length, writes); assert.equal(Object.hasOwn(g.state(), 'cozyRoomLayout'), false);
  const prices = Core.items.map(x => [x.id, x.price]); assert.deepEqual(prices.slice(0, 5), [['apple',8],['cake',18],['berry',6],['rice',12],['feast',15]]);
});

test('unchosen eggs cannot harvest, acquire furniture or receive food and invalid revisions perform no write', async () => {
  const g = await game({}, { choose: false }), before = g.raw(), writes = g.writes.length;
  for (const action of [{ type: 'harvestVillageFood', plotId: 'orchard' }, { type: 'buyHomeFurniture', furnitureId: 'table' }, { type: 'claimHomeFurniture', furnitureId: 'table' }, { type: 'useItem', itemId: 'apple' }]) {
    assert.equal((await g.act(action.type, action)).error.code, 'egg_required'); assert.equal(g.raw(), before);
  }
  assert.ok(Core.getVillageHarvestView(g.app.getState(), g.options.now()).plots.every(x => !x.available)); assert.equal(g.writes.length, writes);
  await g.app.dispatch({ type: 'chooseEgg', eggOrigin: 'lilac' }); const raw = g.raw();
  for (const rev of [undefined, null, '1', NaN, Infinity, -1, g.app.getState().revision + 1]) assert.equal((await g.app.dispatch({ type: 'harvestVillageFood', plotId: 'orchard', expectedRevision: rev })).error.code, 'stale_state');
  assert.equal(g.raw(), raw);
});

test('both finite harvest plots credit real inventory once per JST day without granting EXP, care or currency', async () => {
  const g = await game({}, { now: Date.UTC(2026, 9, 25, 14, 59, 59) }), before = g.state(), forecast = Core.getVillageHarvestView(g.app.getState(), g.options.now()).plots;
  assert.equal(Core.getVillageHarvestView(g.app.getState(), g.options.now()).day, '2026-10-25');
  assert.equal((await g.act('harvestVillageFood', { plotId: 'orchard' })).ok, true); assert.equal((await g.act('harvestVillageFood', { plotId: 'berry' })).ok, true);
  assert.deepEqual(g.state().inventory, Object.fromEntries(forecast.map(row => [row.itemId, 1]))); assert.deepEqual(g.state().pet, before.pet); assert.deepEqual(g.state().care, before.care); assert.equal(g.state().coins, before.coins);
  const raw = g.raw(); assert.equal((await g.act('harvestVillageFood', { plotId: 'orchard' })).error.code, 'harvest_wait'); assert.equal(g.raw(), raw);
  assert.ok(Core.getVillageHarvestView(g.app.getState(), g.options.now()).plots.every(x => x.claimed && !x.available));
  g.advance(1000); assert.equal(Core.getVillageHarvestView(g.app.getState(), g.options.now()).day, '2026-10-26');
  assert.equal((await g.act('harvestVillageFood', { plotId: 'orchard' })).ok, true); assert.equal(g.state().inventory[forecast[0].itemId], 2);
  const later = g.raw(); g.advance(-1001); assert.equal((await g.act('harvestVillageFood', { plotId: 'berry' })).error.code, 'clock_moved_back'); assert.equal(g.raw(), later);
  assert.ok(Core.getVillageHarvestView(g.app.getState(), g.options.now()).plots.every(x => !x.available && x.reason === 'clock_moved_back'));
});

test('a harvested or bought gift consumes exactly one stored food and follows existing EXP and revision rules', async () => {
  const g = await game(), fruitId = Core.getVillageHarvestView(g.app.getState(), g.options.now()).plots[0].itemId; await g.act('harvestVillageFood', { plotId: 'orchard' }); await g.act('buyItem', { itemId: 'berry' });
  const before = g.state(), rev = before.revision;
  const results = await Promise.all([g.act('useItem', { itemId: fruitId }, rev), g.act('useItem', { itemId: fruitId }, rev)]);
  assert.equal(results[0].ok, true); assert.equal(results[0].reward.exp, 3); assert.equal(results[1].error.code, 'stale_state');
  assert.equal(g.state().inventory[fruitId], 0); assert.equal(g.state().pet.exp, before.pet.exp + 3); assert.equal(g.state().coins, before.coins); assert.deepEqual(g.state().care.counts, before.care.counts);
  const raw = g.raw(); assert.equal((await g.act('useItem', { itemId: 'unknown' })).error.code, 'invalid_item'); assert.equal(g.raw(), raw);
  assert.equal((await g.act('useItem', { itemId: 'berry' })).reward.exp, 2); assert.equal(g.state().inventory.berry, 0); assert.equal(g.state().pet.exp, before.pet.exp + 5);
  const careRev = g.app.getState().revision, care = await g.act('care', { kind: 'rest' }, careRev); assert.equal(care.reward.exp, 4); assert.equal(care.reward.coins, 10);
  assert.equal((await g.act('care', { kind: 'rest' }, careRev)).error.code, 'stale_state'); assert.equal(g.state().care.total.rest, 1);
});

test('growth claims one free fixture while purchase experience unlocks an alternative paid route without duplicate ownership', async () => {
  const g = await game(); assert.equal(furniture(g, 'table').available, false);
  assert.equal((await g.act('claimHomeFurniture', { furnitureId: 'table' })).error.code, 'home_furniture_locked');
  await g.act('buyItem', { itemId: 'cloth_cream_vest' }); assert.equal(g.state().villageLife.purchaseCount, 0);
  await g.act('buyItem', { itemId: 'apple' }); assert.equal(g.state().villageLife.purchaseCount, 1); assert.equal(furniture(g, 'table').available, true); assert.equal(furniture(g, 'table').canClaim, false);
  const before = g.state(); assert.equal((await g.act('buyHomeFurniture', { furnitureId: 'table' })).ok, true);
  assert.equal(g.state().coins, before.coins - 24); assert.equal(g.state().villageLife.purchaseCount, 2); assert.equal(furniture(g, 'table').owned, true); assert.equal(furniture(g, 'chair').available, true);
  assert.deepEqual(Core.getCozyRoomLayout(g.app.getState()).objects.map(x => x.type), ['bed', 'rug'], 'buying furniture adds inventory without arranging the home');
  assert.deepEqual(g.state().pet, before.pet); const raw = g.raw();
  for (const type of ['claimHomeFurniture', 'buyHomeFurniture']) assert.equal((await g.act(type, { furnitureId: 'table' })).error.code, 'already_owned');
  assert.equal(g.raw(), raw); assert.equal((await g.act('buyHomeFurniture', { furnitureId: 'counter' })).error.code, 'home_furniture_locked');
  for (let i = 0; i < 3; i++) await g.act('care', { kind: 'feed' });
  const growth = g.state(), count = growth.villageLife.purchaseCount; assert.equal(furniture(g, 'chair').canClaim, false);
  for (let i = 0; i < 3; i++) await g.act('care', { kind: 'play' }); for (let i = 0; i < 2; i++) await g.act('care', { kind: 'rest' });
  assert.equal(g.state().pet.exp, 47); const coins = g.state().coins; assert.equal((await g.act('claimHomeFurniture', { furnitureId: 'chair' })).ok, true);
  assert.equal(g.state().coins, coins); assert.equal(g.state().villageLife.purchaseCount, count); assert.equal(furniture(g, 'chair').owned, true);
  assert.deepEqual(Core.getCozyRoomLayout(g.app.getState()).objects.map(x => x.type), ['bed', 'rug'], 'growth rewards also wait for the owner to place them');
  const arranged = Core.getCozyRoomLayout(g.app.getState()); arranged.objects.push({ id: 9, type: 'table', x: -2, z: -2, r: 0 }, { id: 10, type: 'chair', x: -2, z: 2, r: 0 }); arranged.nextId = 11;
  assert.equal((await g.act('saveCozyRoomLayout', { layout: arranged })).ok, true);
  const restored = Core.create(g.options); assert.equal((await restored.ready).ok, true); assert.deepEqual(Core.getCozyRoomLayout(restored.getState()), arranged);
});

test('paid village offers count once after their real shared-wallet purchase and do not grant growth or gifts twice', async () => {
  const g = await game(), view = g.app.getVillageEconomyView(), offer = view.offers[0], before = g.state(), rev = before.revision;
  assert.equal((await g.act('buyVillageOffer', { offerId: offer.id, quantity: 1 }, rev)).ok, true);
  assert.equal(g.state().villageLife.purchaseCount, 1); assert.equal(g.state().coins, before.coins - offer.unitPrice); assert.equal(g.state().inventory[offer.itemId], 1); assert.deepEqual(g.state().pet, before.pet);
  const raw = g.raw(); assert.equal((await g.act('buyVillageOffer', { offerId: offer.id, quantity: 1 }, rev)).error.code, 'stale_state'); assert.equal(g.raw(), raw);
});

test('furniture acquisitions reject insufficient funds, forged prices, invalid IDs, stale revisions and reversed clocks atomically', async () => {
  const g = await game(); await g.act('buyItem', { itemId: 'apple' }); const low = g.state(); low.coins = 0;
  const poor = await game({ [Core.KEY]: JSON.stringify(low) }), raw = poor.raw();
  assert.equal(furniture(poor, 'table').available, true); assert.equal(furniture(poor, 'table').canBuy, false);
  assert.equal((await poor.act('buyHomeFurniture', { furnitureId: 'table', price: 0 })).error.code, 'insufficient_coins'); assert.equal(poor.raw(), raw);
  for (const id of [undefined, null, '__proto__', 'unknown', 'apple', 1]) assert.equal((await poor.act('buyHomeFurniture', { furnitureId: id })).error.code, 'invalid_home_furniture');
  for (const rev of [undefined, null, '1', NaN, Infinity, -1, poor.app.getState().revision + 1]) assert.equal((await poor.app.dispatch({ type:'buyHomeFurniture',furnitureId:'table',expectedRevision:rev })).error.code, 'stale_state');
  assert.equal(poor.raw(), raw); const before = g.state();
  assert.equal((await g.act('buyHomeFurniture', { furnitureId: 'table', price: 0, exp: 999, quantity: 99 })).ok, true);
  assert.equal(g.state().coins, before.coins - 24); assert.deepEqual(g.state().pet, before.pet); assert.equal(g.state().villageLife.purchaseCount, before.villageLife.purchaseCount + 1);
  const current = g.raw(); g.advance(-1); assert.equal((await g.act('buyHomeFurniture', { furnitureId: 'chair' })).error.code, 'clock_moved_back'); assert.equal(g.raw(), current);
});

test('real virtual-market proceeds can buy home furniture from the same wallet without changing investment holdings again', async () => {
  const g = await game({}, { random: () => .99 }); await g.act('buyItem', { itemId: 'apple' }); await g.act('buyStock', { stockId: 'grn', quantity: 1 });
  for (let i = 0; i < 4; i++) await g.act('advanceMarketDay'); assert.equal((await g.act('sellStock', { stockId: 'grn', quantity: 1 })).ok, true);
  const before = g.state(); assert.ok(before.market.realizedProfit > 0); assert.equal((await g.act('buyHomeFurniture', { furnitureId: 'table' })).ok, true);
  assert.equal(g.state().coins, before.coins - 24); assert.deepEqual(g.state().market, before.market); assert.deepEqual(g.state().pet, before.pet); assert.equal(furniture(g, 'table').owned, true);
});

test('starter placement cannot duplicate stock or place unowned fixtures and explicit empty saves stay empty after later acquisitions', async () => {
  const g = await game(); const original = Core.getCozyRoomLayout(g.app.getState());
  const duplicate = clone(original); duplicate.objects.push({ id: 9, type: 'bed', x: -2, z: 0, r: 0 }); duplicate.nextId = 10;
  assert.equal((await g.act('saveCozyRoomLayout', { layout: duplicate })).error.code, 'not_owned');
  const unowned = clone(original); unowned.objects.push({ id: 9, type: 'chair', x: -2, z: 0, r: 0 }); unowned.nextId = 10;
  assert.equal((await g.act('saveCozyRoomLayout', { layout: unowned })).error.code, 'not_owned');
  const empty = { ...original, objects: [] }; assert.equal((await g.act('saveCozyRoomLayout', { layout: empty })).ok, true);
  await g.act('buyItem', { itemId: 'apple' }); await g.act('buyHomeFurniture', { furnitureId: 'table' });
  assert.deepEqual(Core.getCozyRoomLayout(g.app.getState()), empty); assert.equal(furniture(g, 'table').owned, true);
  const restored = Core.create(g.options); assert.equal((await restored.ready).ok, true); assert.deepEqual(Core.getCozyRoomLayout(restored.getState()), empty);
});

test('starter cannot forge an unowned legacy source or mint the old free room fixtures through a legacy save', async () => {
  const g = await game(), before = g.raw(), writes = g.writes.length;
  for (const [type, sourceId] of [['cupboard','room_shelf'], ['legacy_window','room_window'], ['legacy_bowl','room_bowl'], ['legacy_toy','room_toy']]) {
    const layout = { version: 1, wall: 'brick', floor: 'honey', objects: [{ id: 1, type, x: 0, z: 0, r: 0, sourceId }], nextId: 2 };
    assert.equal((await g.act('saveCozyRoomLayout', { layout })).error.code, 'not_owned'); assert.equal(g.raw(), before);
  }
  assert.equal((await g.act('saveRoomLayout', { layout: Core.defaultRoomLayout() })).error.code, 'not_owned'); assert.equal(g.raw(), before); assert.equal(g.writes.length, writes);
  const empty = { version: 1, items: [] }; assert.equal((await g.act('saveRoomLayout', { layout: empty })).ok, true); const cleared = g.raw();
  for (const id of ['room_shelf','room_window','room_bowl','room_toy']) {
    assert.equal((await g.act('saveRoomLayout', { layout: { version: 1, items: [{ id, x: 50, y: 50, flip: false }] } })).error.code, 'not_owned'); assert.equal(g.raw(), cleared);
  }
  await g.act('buyItem', { itemId: 'apple' }); await g.act('buyHomeFurniture', { furnitureId: 'table' });
  assert.deepEqual(g.state().roomLayout, empty); assert.deepEqual(Core.getCozyRoomLayout(g.app.getState()).objects, []);
});

test('owned starter fixtures share stock across native and old-source forms and real owned decorations still save', async () => {
  const g = await game(), original = Core.getCozyRoomLayout(g.app.getState()), duplicate = clone(original);
  duplicate.objects.push({ id: 9, type: 'bed', x: -2, z: 0, r: 0, sourceId: 'room_bed' }); duplicate.nextId = 10;
  const before = g.raw(); assert.equal((await g.act('saveCozyRoomLayout', { layout: duplicate })).error.code, 'not_owned'); assert.equal(g.raw(), before);
  const oldOwned = { version: 1, items: [{ id: 'room_bed', x: 90, y: 90, flip: true }, { id: 'room_rug', x: 50, y: 80, flip: false }] };
  assert.equal((await g.act('saveRoomLayout', { layout: oldOwned })).ok, true);
  const projected = Core.getCozyRoomLayout(g.app.getState()); assert.deepEqual(projected.objects.map(x => x.sourceId), ['room_bed','room_rug']);
  assert.equal((await g.act('saveCozyRoomLayout', { layout: projected })).ok, true);
  await g.act('buyItem', { itemId: 'flower' }); const owned = clone(projected);
  owned.objects.push({ id: 3, type: 'decor_flower', x: -2, z: -2, r: 0, sourceId: 'flower' }); owned.nextId = 4;
  assert.equal((await g.act('saveCozyRoomLayout', { layout: owned })).ok, true); assert.equal(g.state().decorations.owned.flower !== undefined, true);
  const retained = g.raw(), unowned = clone(owned); unowned.objects.push({ id: 4, type: 'decor_house', x: -2, z: 2, r: 0, sourceId: 'house' }); unowned.nextId = 5;
  assert.equal((await g.act('saveCozyRoomLayout', { layout: unowned })).error.code, 'not_owned'); assert.equal(g.raw(), retained);
});

test('real previously saved starter legacy placements remain exact without granting unowned native inventory', async () => {
  const fresh = await game(), saved = fresh.state(), previous = Core.defaultRoomLayout(); saved.roomLayout = previous;
  const g = await game({ [Core.KEY]: JSON.stringify(saved) }); assert.deepEqual(g.state().roomLayout, previous); assert.equal(furniture(g, 'cupboard').owned, false);
  const projected = Core.getCozyRoomLayout(g.app.getState()); assert.deepEqual(projected.objects.map(x => x.sourceId), previous.items.map(x => x.id));
  const moved = clone(previous); moved.items[1].x = 78; assert.equal((await g.act('saveRoomLayout', { layout: moved })).ok, true);
  const current = Core.getCozyRoomLayout(g.app.getState()); assert.equal((await g.act('saveCozyRoomLayout', { layout: current })).ok, true);
  assert.deepEqual(g.state().roomLayout, moved); assert.deepEqual(g.state().villageLife, saved.villageLife);
  const raw = g.raw(), native = clone(current); native.objects.push({ id: 7, type: 'cupboard', x: -2, z: 0, r: 0 }); native.nextId = 8;
  assert.equal((await g.act('saveCozyRoomLayout', { layout: native })).error.code, 'not_owned'); assert.equal(g.raw(), raw);
  const restored = Core.create(g.options); assert.equal((await restored.ready).ok, true); assert.deepEqual(Core.getCozyRoomLayout(restored.getState()), current);
});

test('legacy owners and exact saved layouts remain free and unchanged when future harvest and purchase experience is recorded', async () => {
  const g = await game({ pg_exp: '686', pg_coins: '574', pg_items: '{"rice":2}', pg_deco: '{"flower":{}}' }), before = g.state();
  assert.equal(Object.hasOwn(before, 'villageLife'), false); assert.equal(Core.getHomeFurnishingsView(g.app.getState()).homeMode, 'legacy'); assert.equal(Core.getCozyRoomLayout(g.app.getState()).objects.length, 8);
  const empty = { version: 1, wall: 'mint', floor: 'oak', objects: [], nextId: 42 }; await g.act('saveCozyRoomLayout', { layout: empty });
  const saved = g.state(); await g.act('harvestVillageFood', { plotId: 'berry' }); await g.act('buyItem', { itemId: 'apple' });
  assert.equal(g.state().villageLife.homeMode, 'legacy'); assert.ok(Core.getHomeFurnishingsView(g.app.getState()).items.every(x => x.owned)); assert.ok(Core.getCozyRoomFurniture(g.app.getState()).every(x => x.limit === 24));
  assert.deepEqual(g.state().cozyRoomLayout, empty); for (const key of ['pet','wardrobe','decorations','care','market','migration','legacyReserve']) assert.deepEqual(g.state()[key], saved[key]);
  const repeated = { ...empty, objects: Array.from({ length: 24 }, (_, i) => ({ id: i + 1, type: 'chair', x: 0, z: 0, r: 0 })), nextId: 43 };
  assert.equal((await g.act('saveCozyRoomLayout', { layout: repeated })).ok, true);
});

for (const mode of ['false','object','throw']) test(mode + ' durable denial leaves harvest, purchase counts, ownership and gift growth unchanged until explicit retry', async () => {
  const g = await game(); await g.act('harvestVillageFood', { plotId: 'orchard' }); await g.act('buyItem', { itemId: 'apple' });
  for (const [type, fields] of [['harvestVillageFood',{plotId:'berry'}],['useItem',{itemId:'apple'}],['buyHomeFurniture',{furnitureId:'table'}]]) {
    const before = g.raw(), rev = g.app.getState().revision; g.control.mode = mode; const result = await g.act(type, fields, rev);
    assert.equal(result.error.code, 'storage_failed'); assert.equal(g.raw(), before); assert.doesNotMatch(JSON.stringify(result.error), /private/);
    g.control.mode = 'ok'; assert.equal((await g.act(type, fields, rev)).ok, true);
  }
});

test('pending writes publish neither acquisition nor purchase experience early and stale duplicate purchase can charge only once', async () => {
  const g = await game(); await g.act('buyItem', { itemId: 'apple' }); const before = g.state(), held = deferred(), rev = before.revision; g.control.pending = held;
  const one = g.act('buyHomeFurniture', { furnitureId: 'table' }, rev), two = g.act('buyHomeFurniture', { furnitureId: 'table' }, rev);
  for (let i = 0; i < 24; i++) await Promise.resolve(); assert.deepEqual(g.state(), before); assert.equal(furniture(g, 'table').owned, false);
  held.resolve(); g.control.pending = null; assert.equal((await one).ok, true); assert.equal((await two).error.code, 'stale_state');
  assert.equal(g.state().coins, before.coins - 24); assert.equal(g.state().villageLife.purchaseCount, before.villageLife.purchaseCount + 1);
});

test('restored life state survives backups while malformed life and acquired furniture records fail read-only without resetting storage', async () => {
  const g = await game(); await g.act('harvestVillageFood', { plotId: 'orchard' }); await g.act('buyItem', { itemId: 'apple' }); await g.act('buyHomeFurniture', { furnitureId: 'table' });
  const backup = g.app.exportBackup(), other = await game(); assert.equal((await other.app.importBackup(backup)).ok, true); assert.deepEqual(other.state().villageLife, g.state().villageLife);
  const base = g.state(), bad = [null, {}, { ...base.villageLife, homeMode: 'unknown' }, { ...base.villageLife, purchaseCount: -1 },
    { ...base.villageLife, harvest: { day: '', claimed: ['orchard'] } }, { ...base.villageLife, harvest: { day: '2026-10-25', claimed: ['orchard','orchard'] } },
    { ...base.villageLife, claimedFurniture: { bed:true,rug:true,unknown:true } }, { ...base.villageLife, claimedFurniture: { bed:true } }];
  for (const life of bad) {
    const raw = JSON.stringify({ ...base, villageLife: life }), data = new Map([[Core.KEY, raw]]), writes = [];
    const app = Core.create({ storage: { getItem: k => data.get(k) ?? null, setItem(k,v) { writes.push([k,v]); data.set(k,v); } }, now: g.options.now });
    assert.equal((await app.ready).error.code, 'corrupt_data'); assert.equal(app.getState().readOnly, true); assert.equal(data.get(Core.KEY), raw); assert.equal(writes.length, 0);
  }
});

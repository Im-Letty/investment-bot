'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../static/pet-game-core.js');
const Economy = require('../static/pet-village-economy.js');
const BASE = Date.parse('2026-10-24T03:00:00Z');
const copy = value => JSON.parse(JSON.stringify(value));

async function fixture(change) {
  const clock = { now: BASE }, mem = { raw: null, writes: 0, fail: false,
    getItem(key) { return key === Core.KEY ? this.raw : null; },
    async setItem(key, value) { assert.equal(key, Core.KEY); if (this.fail) throw Error('synthetic write failure'); this.writes++; this.raw = value; }
  };
  let app = Core.create({ storage: mem, now: () => clock.now }); assert.equal((await app.ready).ok, true);
  assert.equal((await app.dispatch({ type: 'chooseEgg', eggOrigin: 'mint' })).ok, true);
  if (change) { const state = JSON.parse(mem.raw); change(state); mem.raw = JSON.stringify(state); }
  app = Core.create({ storage: mem, now: () => clock.now }); assert.equal((await app.ready).ok, true);
  const f = { app, mem, clock, raw: () => JSON.parse(mem.raw),
    async act(type, args = {}) { return app.dispatch({ type, expectedRevision: app.getState().revision, ...args }); },
    async advance() { clock.now += 60000; const result = await this.act('advanceVillageEconomy'); assert.equal(result.ok, true, result.error && result.error.code); return result; }
  };
  return f;
}
function stable(state) { const next = copy(state); delete next.error; return next; }
async function opened() {
  const f = await fixture(s => { s.coins = 10000; s.inventory = { apple: 100, cake: 100, berry: 100, rice: 100, feast: 100 }; });
  assert.equal((await f.act('contributeVillageShop', { shopId: 'orchard', quantity: 20 })).ok, true);
  await f.advance(); assert.equal(f.app.getVillageEconomyView().shops[0].status, 'open'); return f;
}
async function replace(f, change) {
  const s = f.raw(); change(s); f.mem.raw = JSON.stringify(s);
  f.app = Core.create({ storage: f.mem, now: () => f.clock.now }); assert.equal((await f.app.ready).ok, true);
  f.act = (type, args = {}) => f.app.dispatch({ type, expectedRevision: f.app.getState().revision, ...args });
}

test('pure UMD exposes no storage, requests, timers, or DOM side effects', () => {
  const context = {}; vm.runInNewContext(fs.readFileSync(require.resolve('../static/pet-village-economy.js'), 'utf8'), context);
  assert.deepEqual(Object.keys(context), ['PetVillageEconomy']); assert.equal(typeof context.PetVillageEconomy.transition, 'function');
});

test('old selected save hydration, detached projection and backup export require zero new writes or economy initialization', async () => {
  const f = await fixture(s => { s.coins = 731; s.pet.exp = 686; s.inventory.apple = 7; s.minigames.active = { id: 'old-active', kind: 'catch', startedAt: BASE - 5000 }; });
  const raw = f.mem.raw, writes = f.mem.writes, first = Core.getVillageEconomyView(f.app.getState(), f.clock.now);
  assert.equal(first.coins, 731); assert.equal(first.revision, f.app.getState().revision); assert.equal(first.day, 1);
  assert.equal(first.residents.length, 2); assert.equal(first.visitors.length, 3); assert.equal(first.advance.canAdvance, true);
  first.shops[0].playerShares = 99; first.offers[0].remaining = 0; first.foods[0].owned = 0;
  assert.equal(f.app.getVillageEconomyView().shops[0].playerShares, 0); assert.equal(f.app.getVillageEconomyView().foods[0].owned, 7);
  assert.equal(Object.hasOwn(f.raw(), 'villageEconomy'), false); assert.equal(f.mem.raw, raw); assert.equal(f.mem.writes, writes);
  assert.equal(Object.hasOwn(JSON.parse(f.app.exportBackup()).state, 'villageEconomy'), false);
});

test('listing escrows only known stack food and cancellation returns exactly the unsold balance once', async () => {
  const f = await fixture(s => { s.inventory = { apple: 10 }; s.wardrobe.owned.cloth_cream_vest = true; });
  const before = f.raw(); assert.equal((await f.act('placeVillageListing', { itemId: 'apple', quantity: 6, unitPrice: 999 })).ok, true);
  assert.equal(f.raw().inventory.apple, 4); assert.equal(f.raw().coins, before.coins);
  const id = f.app.getVillageEconomyView().listings[0].id;
  await f.advance(); assert.equal(f.app.getVillageEconomyView().listings[0].remaining, 6, 'expensive stock can remain unsold');
  assert.equal((await f.act('cancelVillageListing', { listingId: id })).ok, true); assert.equal(f.raw().inventory.apple, 10);
  const raw = f.mem.raw; assert.equal((await f.act('cancelVillageListing', { listingId: id })).error.code, 'village_not_found'); assert.equal(f.mem.raw, raw);
  for (const itemId of ['cloth_cream_vest', 'house', 'not-food']) { assert.equal((await f.act('placeVillageListing', { itemId, quantity: 1, unitPrice: 1 })).error.code, 'village_invalid'); assert.equal(f.mem.raw, raw); }
});

test('bounded budgets/demand create partial food fills, exact revenues, and no replay from viewing or reopening', async () => {
  const f = await fixture(s => { s.inventory.apple = 99; });
  assert.equal((await f.act('placeVillageListing', { itemId: 'apple', quantity: 99, unitPrice: 1 })).ok, true);
  await f.advance(); const e = f.raw().villageEconomy, left = e.listings[0].remaining, sold = 99 - left;
  assert.ok(sold > 0 && sold < 99); assert.equal(f.raw().coins, 100 + sold); assert.equal(e.salesRevenue, sold);
  assert.equal(e.history.filter(h => h.type === 'sale').reduce((n, h) => n + h.quantity, 0), sold);
  const raw = f.mem.raw, writes = f.mem.writes;
  for (let i = 0; i < 15; i++) f.app.getVillageEconomyView();
  const reopened = Core.create({ storage: f.mem, now: () => f.clock.now }); await reopened.ready;
  assert.equal(f.mem.raw, raw); assert.equal(f.mem.writes, writes); assert.equal(reopened.getState().coins, 100 + sold);
  assert.equal((await f.act('cancelVillageListing', { listingId: e.listings[0].id })).ok, true); assert.equal(f.raw().inventory.apple + sold, 99);
});

test('listing price/quantity bounds and eight-slot limit reject without discarding inventory', async () => {
  const f = await fixture(s => { s.inventory.apple = 100; });
  for (const [quantity, unitPrice] of [[0, 1], [100, 1], [1.5, 1], [1, 0], [1, 1000], [1, NaN]]) {
    const raw = f.mem.raw; assert.equal((await f.act('placeVillageListing', { itemId: 'apple', quantity, unitPrice })).error.code, 'village_invalid'); assert.equal(f.mem.raw, raw);
  }
  for (let i = 0; i < 8; i++) assert.equal((await f.act('placeVillageListing', { itemId: 'apple', quantity: 1, unitPrice: 999 })).ok, true);
  const raw = f.mem.raw; assert.equal((await f.act('placeVillageListing', { itemId: 'apple', quantity: 1, unitPrice: 999 })).error.code, 'village_listing_limit'); assert.equal(f.mem.raw, raw); assert.equal(f.raw().inventory.apple, 92);
});

test('finite visitor offers use core prices and atomically credit food without EXP or a duplicate depleted purchase', async () => {
  const f = await fixture(s => { s.coins = 500; s.pet.exp = 686; });
  const before = f.raw(), offer = f.app.getVillageEconomyView().offers[0];
  assert.equal((await f.act('buyVillageOffer', { offerId: offer.id, quantity: 3, total: 0, price: 0 })).ok, true);
  assert.equal(f.raw().coins, before.coins - 3 * offer.unitPrice); assert.equal(f.raw().inventory[offer.itemId], 3);
  assert.equal(f.raw().pet.exp, 686); assert.deepEqual(f.raw().achievements, before.achievements);
  const raw = f.mem.raw; assert.equal((await f.act('buyVillageOffer', { offerId: offer.id, quantity: 1 })).error.code, 'village_not_found'); assert.equal(f.mem.raw, raw);
});

test('NPC co-funding reaches a finite target, builds once, opens next game day, and capital is never distributable profit', async () => {
  const f = await fixture(s => { s.coins = 200; });
  assert.equal((await f.act('contributeVillageShop', { shopId: 'orchard', quantity: 10 })).ok, true); assert.equal(f.raw().coins, 100);
  let p = f.app.getVillageEconomyView().shops[0]; assert.equal(p.playerShares, 10); assert.equal(p.capitalRaised, 100); assert.equal(p.status, 'funding');
  for (let i = 0; i < 5; i++) await f.advance();
  p = f.app.getVillageEconomyView().shops[0]; assert.equal(p.status, 'building'); assert.equal(p.capitalRaised, 200); assert.equal(p.npcShares, 10); assert.equal(p.dividends, 0);
  const before = f.mem.raw; assert.equal((await f.act('contributeVillageShop', { shopId: 'orchard', quantity: 1 })).error.code, 'village_not_open'); assert.equal(f.mem.raw, before);
  await f.advance(); const saved = f.raw().villageEconomy.shops.orchard;
  assert.equal(saved.status, 'open'); assert.equal(saved.constructionCost, 200); assert.equal(saved.capitalRaised, 200);
  assert.equal(saved.playerShares + saved.npcShares, 20); assert.ok(saved.dividends <= saved.revenue - saved.costs);
  assert.equal(f.raw().villageEconomy.history.filter(h => h.type === 'open' && h.shopId === 'orchard').length, 1);
});

test('shop offer purchases become operating revenue minus wholesale cost, never a profit from contributed capital', async () => {
  const f = await opened(), offers = f.app.getVillageEconomyView().offers.filter(x => x.shopId === 'orchard' && x.remaining);
  assert.ok(offers.length); const offer = offers[0], before = f.raw(), q = Math.min(2, offer.remaining), wholesale = Economy.foods.find(x => x.id === offer.itemId).price;
  assert.equal((await f.act('buyVillageOffer', { offerId: offer.id, quantity: q })).ok, true);
  const p = f.raw().villageEconomy.shops.orchard, old = before.villageEconomy.shops.orchard;
  assert.equal(p.revenue - old.revenue, q * offer.unitPrice); assert.equal(p.costs - old.costs, q * wholesale);
  assert.equal(p.profitReserve - old.profitReserve, q * (offer.unitPrice - wholesale)); assert.equal(p.capitalRaised, old.capitalRaised); assert.equal(p.constructionCost, 200);
});

test('funded dividends are proportional to shares, retain remainders, and reserve-funded benefit can be claimed only once', async () => {
  const f = await opened();
  await replace(f, s => { const p = s.villageEconomy.shops.orchard; p.playerShares = 5; p.npcShares = 15; p.costBasis = 50; p.revenue += 100; p.profitReserve += 100; });
  const before = f.raw(); await f.advance(); const after = f.raw(), p = after.villageEconomy.shops.orchard, old = before.villageEconomy.shops.orchard;
  assert.equal(after.villageEconomy.day, 3); assert.ok(p.dividends > old.dividends);
  assert.equal((p.dividends - old.dividends) * 3, p.npcDividends - old.npcDividends);
  assert.equal(p.profitReserve, p.revenue - p.costs - p.dividends - p.npcDividends - p.benefitCost);
  assert.equal(p.pendingBenefit, 1); assert.equal(p.benefitCost, 8);
  const beforeClaim = after.inventory.apple; assert.equal((await f.act('claimVillageBenefit', { shopId: 'orchard' })).ok, true); assert.equal(f.raw().inventory.apple, beforeClaim + 1);
  const raw = f.mem.raw; assert.equal((await f.act('claimVillageBenefit', { shopId: 'orchard' })).error.code, 'village_no_benefit'); assert.equal(f.mem.raw, raw);
  assert.equal(f.raw().villageEconomy.shops.orchard.claimedBenefits, 1);
});

test('no operating profit means no dividend or perk despite fully paid construction capital', async () => {
  const f = await opened();
  // Use a pure synthetic fully funded shop immediately before its third-day payout;
  // making all food stalls cheaper consumes buyer demand before any shop trade.
  await replace(f, s => { const e = s.villageEconomy, p = e.shops.orchard; p.revenue = 0; p.costs = 0; p.profitReserve = 0; p.dividends = 0; p.npcDividends = 0; p.benefitCost = 0; p.pendingBenefit = 0; p.claimedBenefits = 0;
    e.listings = Economy.foods.map((food, i) => ({ id: i + 1, itemId: food.id, quantity: 99, remaining: 99, unitPrice: 1, listedDay: e.day })); e.nextListingId = 6;
  });
  await f.advance(); const p = f.raw().villageEconomy.shops.orchard; assert.equal(p.capitalRaised, 200); assert.equal(p.dividends, 0); assert.equal(p.pendingBenefit, 0); assert.equal(p.profitReserve, 0);
});

test('share sales respect finite NPC liquidity and preserve positive/negative realized profit, fees, basis and total ownership', async () => {
  const f = await opened(); await replace(f, s => { s.villageEconomy.shops.orchard.price = 30; });
  const raw = f.mem.raw; assert.equal((await f.act('sellVillageShares', { shopId: 'orchard', quantity: 3 })).error.code, 'village_liquidity'); assert.equal(f.mem.raw, raw);
  const before = f.raw().coins, sale = await f.act('sellVillageShares', { shopId: 'orchard', quantity: 2 });
  assert.equal(sale.reward.realizedProfit, 39); assert.equal(sale.reward.fee, 1); assert.equal(f.raw().coins, before + 59);
  let p = f.raw().villageEconomy.shops.orchard; assert.equal(p.playerShares, 18); assert.equal(p.npcShares, 2); assert.equal(p.costBasis, 180); assert.equal(p.buybackCoins, 20);
  await replace(f, s => { s.villageEconomy.shops.orchard.price = 3; });
  const loss = await f.act('sellVillageShares', { shopId: 'orchard', quantity: 1 }); assert.equal(loss.reward.realizedProfit, -8);
  p = f.raw().villageEconomy.shops.orchard; assert.equal(p.realizedProfit, 31); assert.equal(p.feesPaid, 2); assert.equal(p.playerShares + p.npcShares, 20); assert.equal(p.costBasis, 170);
  await replace(f, s => { const p = s.villageEconomy.shops.orchard; p.npcLiquidityIn += 80 - p.buybackCoins; p.buybackCoins = 80; });
  assert.equal((await f.act('sellVillageShares', { shopId: 'orchard', quantity: 17 })).ok, true); assert.equal(f.raw().villageEconomy.shops.orchard.costBasis, 0); assert.equal(f.raw().villageEconomy.shops.orchard.playerShares, 0);
});

test('game-day progress has a real sixty-second gate, no offline catch-up, and one settlement for a replayed revision', async () => {
  const f = await fixture(); const revision = f.app.getState().revision;
  assert.equal((await f.app.dispatch({ type: 'advanceVillageEconomy', expectedRevision: revision })).ok, true);
  const raw = f.mem.raw; assert.equal((await f.app.dispatch({ type: 'advanceVillageEconomy', expectedRevision: revision })).error.code, 'stale_state'); assert.equal(f.mem.raw, raw);
  f.clock.now += 59999; assert.equal(f.app.getVillageEconomyView().advance.waitMs, 1); assert.equal((await f.act('advanceVillageEconomy')).error.code, 'village_wait'); assert.equal(f.mem.raw, raw);
  f.clock.now += 1; assert.equal((await f.act('advanceVillageEconomy')).ok, true); assert.equal(f.raw().villageEconomy.day, 3);
  f.clock.now += 86400000 * 100; assert.equal((await f.act('advanceVillageEconomy')).ok, true); assert.equal(f.raw().villageEconomy.day, 4, 'one explicit action advances only one game day');
});

test('the twelve-advance limit uses JST, crosses midnight once, and clock reversal rejects all new economy writes', async () => {
  const f = await fixture(); f.clock.now = Date.parse('2026-10-24T14:40:00Z');
  for (let i = 0; i < 12; i++) { assert.equal((await f.act('advanceVillageEconomy')).ok, true); f.clock.now += 60000; }
  const raw = f.mem.raw; assert.equal((await f.act('advanceVillageEconomy')).error.code, 'daily_limit'); assert.equal(f.mem.raw, raw); assert.equal(f.app.getVillageEconomyView().advance.dailyRemaining, 0);
  f.clock.now = Date.parse('2026-10-24T15:00:00Z'); assert.equal((await f.act('advanceVillageEconomy')).ok, true); assert.equal(f.raw().villageEconomy.advances, 1);
  f.clock.now--; assert.equal(f.app.getVillageEconomyView().advance.reason, 'clock_moved_back'); const after = f.mem.raw;
  assert.equal((await f.act('advanceVillageEconomy')).error.code, 'clock_moved_back');
  assert.equal((await f.act('buyVillageOffer', { offerId: f.app.getVillageEconomyView().offers[0].id, quantity: 1 })).error.code, 'clock_moved_back'); assert.equal(f.mem.raw, after);
});

test('resident growth and tourist rotation depend only on explicitly confirmed game days', async () => {
  const f = await fixture(), initial = f.app.getVillageEconomyView();
  f.clock.now += 86400000 * 30; assert.deepEqual(f.app.getVillageEconomyView().visitors, initial.visitors);
  for (let i = 0; i < 4; i++) await f.advance(); const next = f.app.getVillageEconomyView();
  assert.equal(next.day, 5); assert.equal(next.residents.length, 3); assert.notDeepEqual(next.visitors.map(x => x.id), initial.visitors.map(x => x.id));
});

test('the first economy action also respects the confirmed whole-save clock without initializing a rolled-back record', async () => {
  const f = await fixture(); f.clock.now -= 1; const raw = f.mem.raw;
  assert.equal(f.app.getVillageEconomyView().advance.reason, 'clock_moved_back');
  assert.equal((await f.act('advanceVillageEconomy')).error.code, 'clock_moved_back'); assert.equal(f.mem.raw, raw); assert.equal(Object.hasOwn(f.raw(), 'villageEconomy'), false);
});

test('economy write failures retain the complete save and retry the exact deterministic settlement instead of rerolling', async () => {
  const f = await fixture(s => { s.inventory.apple = 20; }); await f.act('placeVillageListing', { itemId: 'apple', quantity: 20, unitPrice: 1 });
  const before = f.raw(), expected = Economy.transition(before, { type: 'advanceVillageEconomy', expectedRevision: before.revision }, f.clock.now);
  f.mem.fail = true; const raw = f.mem.raw, writes = f.mem.writes;
  assert.equal((await f.act('advanceVillageEconomy')).error.code, 'storage_failed'); assert.equal(f.mem.raw, raw); assert.equal(f.mem.writes, writes);
  assert.deepEqual(stable(f.app.getState()), stable({ ...before, error: null, readOnly: false, stage: Core.getStage(before.pet.exp), marketSummary: Core.getMarketSummary(before) }));
  f.mem.fail = false; assert.equal((await f.act('advanceVillageEconomy')).ok, true); assert.deepEqual(f.raw().villageEconomy, expected.economy); assert.equal(f.raw().coins, expected.coins);
});

test('awaited writes never expose unconfirmed escrow, holdings or coins to subscribers', async () => {
  const f = await fixture(s => { s.inventory.apple = 5; }); const original = f.mem.setItem.bind(f.mem), before = f.raw(); let release;
  f.mem.setItem = async function(key, value) { await new Promise(resolve => { release = resolve; }); return original(key, value); };
  const events = []; const unsubscribe = f.app.subscribe(s => events.push(s));
  const pending = f.act('placeVillageListing', { itemId: 'apple', quantity: 3, unitPrice: 9 });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.app.getState().inventory.apple, 5); assert.equal(f.app.getState().villageEconomy, undefined); assert.equal(f.mem.raw, JSON.stringify(before)); assert.equal(events.length, 0);
  release(); assert.equal((await pending).ok, true); assert.equal(events.length, 1); assert.equal(events[0].inventory.apple, 2); unsubscribe();
});

test('cross-tab CAS and same-revision rapid clicks cannot double debit, sell or claim', async () => {
  const f = await fixture(s => { s.coins = 300; }); const other = Core.create({ storage: f.mem, now: () => f.clock.now }); await other.ready;
  const revision = f.app.getState().revision, action = { type: 'contributeVillageShop', shopId: 'orchard', quantity: 5, expectedRevision: revision };
  const [one, two] = await Promise.all([f.app.dispatch(action), f.app.dispatch(action)]); assert.equal(one.ok, true); assert.equal(two.error.code, 'stale_state');
  const raw = f.mem.raw; assert.equal((await other.dispatch(action)).error.code, 'stale_state'); assert.equal(f.mem.raw, raw); assert.equal(f.raw().coins, 250); assert.equal(f.raw().villageEconomy.shops.orchard.playerShares, 5);
});

test('unselected eggs reject new economy commands without creating a village economy', async () => {
  const values = new Map(), storage = { getItem: key => values.get(key) || null, setItem: (key, value) => { values.set(key, value); } };
  const app = Core.create({ storage, now: () => BASE }); await app.ready; const raw = values.get(Core.KEY);
  for (const type of Economy.commands) { assert.equal((await app.dispatch({ type, expectedRevision: 0 })).error.code, 'egg_required'); assert.equal(values.get(Core.KEY), raw); }
});

test('core-side limits reject aggregate wallet/old-stock/village-stock overflow and food overflow atomically', async () => {
  const f = await fixture(s => { s.coins = 9000000000000; s.inventory.apple = 99; });
  assert.equal((await f.act('placeVillageListing', { itemId: 'apple', quantity: 99, unitPrice: 1 })).ok, true);
  const raw = f.mem.raw; assert.equal((await f.act('advanceVillageEconomy')).error.code, 'amount_overflow'); assert.equal(f.mem.raw, raw);
  const g = await fixture(s => { s.coins = 500; s.inventory.apple = 9000000000000; });
  // Pick any offered item and fill that exact inventory counter to its cap.
  const offer = g.app.getVillageEconomyView().offers[0]; await replace(g, s => { s.inventory[offer.itemId] = 9000000000000; });
  const capped = g.mem.raw; assert.equal((await g.act('buyVillageOffer', { offerId: offer.id, quantity: 1 })).error.code, 'amount_overflow'); assert.equal(g.mem.raw, capped);
  const h = await opened(), cappedState = h.raw(); cappedState.coins = 9000000000000 - 200; cappedState.market.holdings.apl = { quantity: 5, costBasis: 200 }; cappedState.villageEconomy.shops.orchard.price = 3; h.mem.raw = JSON.stringify(cappedState);
  const blocked = Core.create({ storage: h.mem, now: () => h.clock.now }); assert.equal((await blocked.ready).error.code, 'amount_overflow'); assert.equal(blocked.getState().readOnly, true);
});

test('open-shop NPC shares remain buyable after full NPC funding and repeated buy/sell conserves issue count and average cost', async () => {
  const f = await fixture(s => { s.coins = 10000; });
  for (let i = 0; i < 11; i++) await f.advance();
  let p = f.app.getVillageEconomyView().shops[0]; assert.equal(p.status, 'open'); assert.equal(p.playerShares, 0); assert.equal(p.npcShares, 20); assert.ok(p.maxBuyQuantity > 0);
  await replace(f, s => { s.villageEconomy.shops.orchard.price = 10; });
  const before = f.raw().coins; assert.equal((await f.act('buyVillageShares', { shopId: 'orchard', quantity: 2 })).ok, true);
  let saved = f.raw().villageEconomy.shops.orchard; assert.equal(saved.playerShares, 2); assert.equal(saved.npcShares, 18); assert.equal(saved.costBasis, 21); assert.equal(f.raw().coins, before - 21);
  assert.equal(saved.buybackCoins, saved.npcLiquidityIn + saved.sharePurchases - saved.shareSales - saved.npcLiquidityOut);
  await replace(f, s => { s.villageEconomy.shops.orchard.price = 20; });
  assert.equal((await f.act('buyVillageShares', { shopId: 'orchard', quantity: 1 })).ok, true);
  saved = f.raw().villageEconomy.shops.orchard; assert.equal(saved.costBasis, 42); assert.equal(saved.playerShares, 3);
  const result = await f.act('sellVillageShares', { shopId: 'orchard', quantity: 1 }); assert.equal(result.reward.realizedProfit, 5);
  saved = f.raw().villageEconomy.shops.orchard; assert.equal(saved.costBasis, 28); assert.equal(saved.playerShares, 2); assert.equal(saved.npcShares, 18); assert.equal(saved.capitalRaised, 200); assert.equal(saved.feesPaid, 3);
  assert.equal(saved.buybackCoins, saved.npcLiquidityIn + saved.sharePurchases - saved.shareSales - saved.npcLiquidityOut);
});

test('partial market-bought sales allocate fractional basis and final liquidation resets it exactly', async () => {
  const f = await opened(); await f.act('sellVillageShares', { shopId: 'orchard', quantity: 1 });
  await replace(f, s => { const p = s.villageEconomy.shops.orchard; p.price = 11; });
  assert.equal((await f.act('buyVillageShares', { shopId: 'orchard', quantity: 1 })).ok, true);
  const before = f.raw().villageEconomy.shops.orchard, expectedBasis = before.costBasis * 2 / before.playerShares;
  assert.equal((await f.act('sellVillageShares', { shopId: 'orchard', quantity: 2 })).ok, true);
  const after = f.raw().villageEconomy.shops.orchard; assert.equal(after.costBasis, before.costBasis - expectedBasis);
  assert.equal(after.realizedProfit - before.realizedProfit, 22 - 1 - expectedBasis);
  await replace(f, s => { const p = s.villageEconomy.shops.orchard; p.price = 3; p.npcLiquidityIn += 80 - p.buybackCoins; p.buybackCoins = 80; });
  assert.equal((await f.act('sellVillageShares', { shopId: 'orchard', quantity: after.playerShares })).ok, true);
  assert.equal(f.raw().villageEconomy.shops.orchard.costBasis, 0); assert.equal(f.raw().villageEconomy.shops.orchard.playerShares, 0);
});

test('corrupt optional economy fails closed without replacing old records or allowing a command', async () => {
  for (const mutate of [e => { e.version = 2; }, e => { e.shops.orchard.profitReserve = 1; }, e => { e.offers[0].unitPrice = 0; }, e => { e.extra = true; }]) {
    const f = await fixture(); const state = f.raw(); state.villageEconomy = Economy.get(state); mutate(state.villageEconomy); f.mem.raw = JSON.stringify(state);
    const raw = f.mem.raw, writes = f.mem.writes, blocked = Core.create({ storage: f.mem, now: () => f.clock.now });
    assert.equal((await blocked.ready).error.code, 'corrupt_data'); assert.equal(blocked.getState().readOnly, true);
    assert.equal((await blocked.dispatch({ type: 'advanceVillageEconomy', expectedRevision: state.revision })).error.code, 'read_only'); assert.equal(f.mem.raw, raw); assert.equal(f.mem.writes, writes);
  }
});

test('all unrelated selected pet, historical games, rooms, inventory ownership, care and legacy market survive NPC transactions and backups', async () => {
  const f = await fixture(s => { s.pet.exp = 686; s.pet.name = '保存テスト'; s.coins = 500; s.inventory.apple = 9;
    delete s.villageLife; // Explicit historical full-room fixture, before starter acquisition existed.
    s.roomLayout = { version: 1, items: [] }; s.cozyRoomLayout = Core.defaultCozyRoomLayout(); s.villageLayout = Core.defaultVillageLayout();
    s.minigames.completed = ['old-result']; s.minigames.active = { id: 'old-active', kind: 'snack', startedAt: BASE - 10 };
    s.market.holdings.apl = { quantity: 2, costBasis: 83 }; s.market.history = [{ type: 'existing-history', note: 'retain' }];
  });
  const before = f.raw(); await f.act('placeVillageListing', { itemId: 'apple', quantity: 3, unitPrice: 999 }); await f.act('contributeVillageShop', { shopId: 'orchard', quantity: 5 }); await f.advance();
  for (const key of ['pet', 'care', 'wardrobe', 'decorations', 'roomLayout', 'cozyRoomLayout', 'villageLayout', 'minigames', 'market', 'achievements', 'legacyReserve', 'migration']) assert.deepEqual(f.raw()[key], before[key], key);
  const backup = f.app.exportBackup(), target = await fixture(); assert.equal((await target.app.importBackup(backup)).ok, true); assert.deepEqual(target.raw().villageEconomy, f.raw().villageEconomy);
  assert.deepEqual(target.raw().minigames, before.minigames); assert.deepEqual(target.raw().market, before.market);
  const legacyBefore = copy(target.raw().villageEconomy); assert.equal((await target.act('buyStock', { stockId: 'apl', quantity: 1 })).ok, true); assert.deepEqual(target.raw().villageEconomy, legacyBefore);
});

test('a bounded multi-day trading sequence conserves the wallet, original construction capital and NPC liquidity after history pruning', async () => {
  const f = await fixture(s => { s.coins = 10000; s.inventory = { apple: 300, berry: 300, rice: 300, cake: 300, feast: 300 }; });
  await f.act('contributeVillageShop', { shopId: 'orchard', quantity: 5 });
  let previous = f.app.getVillageEconomyView();
  for (let i = 0; i < 36; i++) {
    if (!previous.advance.dailyRemaining) f.clock.now += 86400000;
    if (i % 3 === 0 && previous.listings.length < 8) await f.act('placeVillageListing', { itemId: 'apple', quantity: 20, unitPrice: i % 2 ? 999 : 1 });
    await f.advance(); const view = f.app.getVillageEconomyView();
    for (const p of view.shops) {
      if (p.canBuyShares && i % 2 === 0) assert.equal((await f.act('buyVillageShares', { shopId: p.id, quantity: 1 })).ok, true);
      const current = f.app.getVillageEconomyView().shops.find(x => x.id === p.id);
      if (current.maxSellQuantity && i % 3 === 0) assert.equal((await f.act('sellVillageShares', { shopId: p.id, quantity: 1 })).ok, true);
      if (current.pendingBenefit) assert.equal((await f.act('claimVillageBenefit', { shopId: p.id })).ok, true);
    }
    const offer = f.app.getVillageEconomyView().offers.find(x => x.shopId && x.remaining > 0);
    if (offer) assert.equal((await f.act('buyVillageOffer', { offerId: offer.id, quantity: 1 })).ok, true);
    const s = f.raw(), e = s.villageEconomy; Economy.validate(s);
    let expected = 10000 - e.purchasesSpent + e.salesRevenue;
    for (const p of Object.values(e.shops)) {
      expected += p.dividends - p.playerCapital - p.sharePurchases + p.shareSales - p.feesPaid;
      assert.equal(p.capitalRaised, p.playerCapital + p.npcCapital);
      assert.equal(p.buybackCoins, p.npcLiquidityIn + p.sharePurchases - p.shareSales - p.npcLiquidityOut);
      assert.equal(p.profitReserve, p.revenue - p.costs - p.dividends - p.npcDividends - p.benefitCost);
    }
    assert.equal(s.coins, expected); previous = f.app.getVillageEconomyView();
  }
  assert.equal(f.raw().villageEconomy.history.length, 100); assert.ok(f.raw().villageEconomy.nextEventId > 101);
  assert.equal(f.raw().villageEconomy.shops.orchard.playerCapital, 50, 'trading never rewrites the original contribution');
});

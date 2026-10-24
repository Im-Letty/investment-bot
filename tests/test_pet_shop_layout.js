'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Layout = require('../static/pet-shop-layout.js');
const Core = require('../static/pet-game-core.js');
const copy = value => JSON.parse(JSON.stringify(value));
function memory(seed = {}) {
  const data = new Map(Object.entries(seed));
  return { data, reads: [], writes: [], getItem(k) { this.reads.push(k); return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { this.writes.push([k, v]); data.set(k, v); } };
}
async function game(seed = {}) {
  const storage = memory(seed); let clock = Date.UTC(2026, 9, 18, 3);
  const options = { storage, now: () => clock, random: () => .5 }, app = Core.create(options);
  const ready = await app.ready; assert.equal(ready.ok, true, JSON.stringify(ready.error));
  if (Core.needsEggChoice(app.getState())) assert.equal((await app.dispatch({ type: 'chooseEgg', eggOrigin: 'lilac' })).ok, true);
  return { app, storage, options, tick(ms = 71) { clock += ms; } };
}
const persisted = g => JSON.parse(g.storage.data.get(Core.KEY));
function save(g, roomId, layout, expectedRevision = g.app.getState().revision) {
  return g.app.dispatch({ type: 'saveShopInteriorLayout', roomId, layout, expectedRevision });
}
function edited(roomId) {
  const layout = Layout.defaultLayout(roomId), plant = layout.items.find(x => x.id === 'plant');
  plant.x += roomId === 'shop' ? .25 : -.25; plant.turn = 1;
  return layout;
}
function badLayouts() {
  const base = { version: 1, items: [{ id: 'counter', x: 0, z: -2.75, turn: 0 }] };
  const change = fn => { const value = copy(base); fn(value); return value; };
  const inherited = Object.assign(Object.create({ extra: true }), copy(base));
  const inheritedItem = change(l => { l.items[0] = Object.assign(Object.create({ extra: true }), l.items[0]); });
  const hidden = change(l => { Object.defineProperty(l.items[0], 'hidden', { value: 1 }); });
  const symbolic = change(l => { l[Symbol('extra')] = true; });
  const result = [undefined, null, [], {}, { version: 1 }, inherited, inheritedItem, hidden, symbolic,
    change(l => { l.version = 2; }), change(l => { l.extra = 1; }),
    change(l => { l.items = {}; }), change(l => { l.items.length = 2; }), change(l => { l.items.extra = 1; }),
    change(l => { l.items[0] = null; }), change(l => { delete l.items[0].x; }),
    change(l => { l.items.push({ ...l.items[0] }); }), change(l => { l.items[0].id = 'unknown'; }),
    change(l => { l.items[0].id = '__proto__'; }), change(l => { l.items[0].id = 'constructor'; }),
    change(l => { l.items[0].x = 4; }), change(l => { l.items[0].z = -4; }),
    change(l => { l.items = [{ id: 'chairA', x: 0, z: 2.5, turn: 0 }]; }),
    change(l => { l.items = [{ id: 'counter', x: -3, z: -2.75, turn: 0 }, { id: 'teaTable', x: -3, z: -2.75, turn: 0 }]; })];
  for (const key of ['x', 'z']) for (const value of [NaN, Infinity, -Infinity, .1, '0', null, undefined, {}, []]) result.push(change(l => { l.items[0][key] = value; }));
  for (const turn of [-1, 4, .5, '1', NaN, Infinity, null]) result.push(change(l => { l.items[0].turn = turn; }));
  return result;
}
function assertSegment(layout, from, to) {
  const count = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / .01));
  for (let i = 0; i <= count; i++) assert.equal(Layout.walkable(layout, from.x + (to.x - from.x) * i / count, from.z + (to.z - from.z) * i / count), true, JSON.stringify({ from, to, i, count }));
}

test('both detached defaults use only frozen free fixtures, quarter-grid coordinates and an open entrance aisle', async () => {
  assert.equal(Object.isFrozen(Layout.fixtures), true); assert.ok(Layout.fixtures.every(Object.isFrozen));
  assert.equal(Layout.validRoom('home'), false); assert.equal(Layout.validRoom('__proto__'), false);
  for (const roomId of ['shop', 'cafe']) {
    const layout = Layout.defaultLayout(roomId), original = copy(layout);
    assert.equal(layout.items.length, 9); assert.deepEqual(Layout.validateLayout(layout, roomId), original);
    assert.equal(new Set(layout.items.map(x => x.id)).size, layout.items.length);
    for (const row of layout.items) { assert.ok(Layout.fixture(row.id)); assert.equal(Math.abs(row.x * 4 % 1), 0); assert.equal(Math.abs(row.z * 4 % 1), 0); }
    for (let z = -1.6; z <= 3.55; z += .1) assert.equal(Layout.walkable(layout, 0, z), true, roomId + ' central aisle');
    layout.items[0].x = 99; layout.items.pop(); assert.deepEqual(Layout.defaultLayout(roomId), original);
  }
  const g = await game(), raw = g.storage.data.get(Core.KEY), writes = g.storage.writes.length;
  for (const roomId of ['shop', 'cafe']) { const view = Core.getShopInteriorLayout(g.app.getState(), roomId); view.items.splice(0); assert.deepEqual(Core.getShopInteriorLayout(g.app.getState(), roomId), Layout.defaultLayout(roomId)); }
  assert.equal(Object.hasOwn(persisted(g), 'shopInteriorLayouts'), false); assert.equal(g.storage.data.get(Core.KEY), raw); assert.equal(g.storage.writes.length, writes);
  const reopened = Core.create(g.options); assert.equal((await reopened.ready).ok, true); assert.equal(g.storage.writes.length, writes);
});

test('strict model validation rejects sparse, inherited, extra, unknown, duplicate, colliding, outside and aisle shapes', () => {
  for (const roomId of ['shop', 'cafe']) for (const layout of badLayouts()) assert.throws(() => Layout.validateLayout(layout, roomId), e => e.code === 'invalid_shop_interior_layout');
  for (const roomId of [undefined, null, 'home', 'unknown', '__proto__', {}]) assert.throws(() => Layout.validateLayout({ version: 1, items: [] }, roomId));
  const nullProto = Object.assign(Object.create(null), { version: 1, items: [] });
  assert.deepEqual(Layout.validateLayout(nullProto, 'shop'), { version: 1, items: [] }, 'deliberate null-prototype records are normalized to a detached JSON shape');
});

test('rotation changes the physical footprint while flat rugs remain walkable and may sit beneath furniture', () => {
  const a = { id: 'counter', x: -3, z: 0, turn: 1 }, b = Layout.footprint(a), spec = Layout.fixture('counter');
  assert.equal(b.width, spec.depth); assert.equal(b.depth, spec.width);
  const room = { version: 1, items: [a, { id: 'rug', x: -3, z: 0, turn: 0 }] };
  assert.deepEqual(Layout.validateLayout(room, 'shop'), room);
  assert.equal(Layout.walkable(room, -3, 0), false); assert.equal(Layout.walkable(room, -2, 0), true);
  const rugOnly = { version: 1, items: [{ id: 'rug', x: 0, z: 0, turn: 0 }] };
  assert.equal(Layout.walkable(rugOnly, 0, 0), true); assert.equal(Layout.walkable(rugOnly, 4.8, 0), false);
});

test('real movement substeps cannot cross counters, room walls or nonfinite coordinates', () => {
  const room = { version: 1, items: [{ id: 'counter', x: -3, z: 0, turn: 1 }] }, start = { x: -4, z: 0 };
  assert.equal(Layout.walkable(room, start.x, start.z), true);
  const blocked = Layout.move(room, start, 4, 0); assert.equal(blocked.blocked, true); assert.ok(blocked.x < -3.5); assert.equal(Layout.walkable(room, blocked.x, blocked.z), true);
  const wall = Layout.move(room, { x: 0, z: 2.6 }, 0, 3); assert.equal(wall.blocked, true); assert.ok(wall.z <= 3.64 + 1e-8);
  for (const value of [NaN, Infinity, -Infinity, '1', undefined]) {
    assert.equal(Layout.move(room, start, value, 0), null); assert.equal(Layout.move(room, { x: value, z: 0 }, 1, 0), null);
    assert.equal(Layout.walkable(room, value, 0), false);
  }
  assert.deepEqual(start, { x: -4, z: 0 });
  const large = Layout.move(room, start, 500, 0); assert.deepEqual(large, { ...start, blocked: true });
});

test('tap paths route around real fixture collisions and every returned segment remains walkable', () => {
  for (const roomId of ['shop', 'cafe']) {
    const room = Layout.defaultLayout(roomId), before = copy(room), start = { x: .04, z: 2.6 };
    const sign = roomId === 'shop' ? -1 : 1;
    for (const target of [{ x: sign * 4.4, z: -.25 }, { x: sign * 4.4, z: -2.5 }, { x: sign * 1.25, z: -2 }, { x: 0, z: 3.4 }]) {
      assert.equal(Layout.walkable(room, target.x, target.z), true);
      const path = Layout.path(room, start, target); assert.ok(path && path.length);
      assert.deepEqual(path.at(-1), target); let previous = start;
      for (const p of path) { assertSegment(room, previous, p); previous = p; }
    }
    for (const target of [{ x: NaN, z: 0 }, { x: 99, z: 0 }, { x: room.items[0].x, z: room.items[0].z }]) assert.equal(Layout.path(room, start, target), null);
    assert.deepEqual(room, before); assert.deepEqual(start, { x: .04, z: 2.6 });
  }
});

test('saving one room changes only that layout, revision and time, preserves all economy/home/world fields and survives restore', async () => {
  const source = await game({ pg_exp: '686', pg_coins: '574', pg_items: '{"rice":2}', pg_deco: '{"house":{},"legacy-prop":{}}' });
  const initial = persisted(source); initial.roomLayout = Core.defaultRoomLayout(initial); initial.cozyRoomLayout = Core.defaultCozyRoomLayout(initial); initial.villageLayout = Core.defaultVillageLayout();
  initial.shopInteriorLayouts = { cafe: Layout.defaultLayout('cafe') }; initial.achievements = []; initial.futureCompatible = { kept: true };
  const g = await game({ [Core.KEY]: JSON.stringify(initial) }), before = persisted(g), layout = edited('shop'), draftSnapshot = copy(layout); g.tick();
  const result = await save(g, 'shop', layout); assert.equal(result.ok, true); assert.deepEqual(result.reward, {});
  const expected = { ...before, shopInteriorLayouts: { ...before.shopInteriorLayouts, shop: draftSnapshot }, revision: before.revision + 1, updatedAt: g.options.now() };
  assert.deepEqual(persisted(g), expected); assert.deepEqual(layout, draftSnapshot);
  layout.items[0].x = 99; const view = Core.getShopInteriorLayout(g.app.getState(), 'shop'); view.items.pop();
  assert.deepEqual(Core.getShopInteriorLayout(g.app.getState(), 'shop'), draftSnapshot);
  assert.deepEqual(Core.getShopInteriorLayout(g.app.getState(), 'cafe'), before.shopInteriorLayouts.cafe);
  const raw = g.storage.data.get(Core.KEY), writes = g.storage.writes.length, restored = Core.create(g.options); assert.equal((await restored.ready).ok, true);
  assert.deepEqual(Core.getShopInteriorLayout(restored.getState(), 'shop'), draftSnapshot); assert.equal(g.storage.data.get(Core.KEY), raw); assert.equal(g.storage.writes.length, writes);
});

test('malformed layouts and unsupported room IDs reject without writes or draft mutation', async () => {
  const g = await game(), raw = g.storage.data.get(Core.KEY), writes = g.storage.writes.length;
  for (const layout of badLayouts()) {
    const result = await save(g, 'shop', layout); assert.equal(result.ok, false); assert.equal(result.error.code, 'invalid_shop_interior_layout');
    assert.equal(g.storage.data.get(Core.KEY), raw); assert.equal(g.storage.writes.length, writes);
  }
  for (const roomId of [undefined, null, 'home', 'unknown', '__proto__', {}]) {
    const layout = edited('shop'), draft = copy(layout), result = await save(g, roomId, layout);
    assert.equal(result.error.code, 'invalid_shop_interior'); assert.deepEqual(layout, draft); assert.equal(g.storage.data.get(Core.KEY), raw); assert.equal(g.storage.writes.length, writes);
  }
});

test('pending writes publish nothing early and preserve later draft edits separately from the saved candidate', async () => {
  const g = await game(), before = persisted(g), raw = g.storage.data.get(Core.KEY), write = g.storage.setItem.bind(g.storage), notices = [];
  g.app.subscribe(s => notices.push(s)); let release;
  g.storage.setItem = (k, v) => new Promise(resolve => { release = () => { write(k, v); resolve(); }; });
  const layout = edited('shop'), intended = copy(layout), pending = save(g, 'shop', layout);
  for (let i = 0; i < 10 && !release; i++) await new Promise(resolve => setImmediate(resolve)); assert.ok(release);
  assert.equal(g.storage.data.get(Core.KEY), raw); assert.equal(Object.hasOwn(g.app.getState(), 'shopInteriorLayouts'), false); assert.equal(notices.length, 0);
  layout.items[0].x = -1; release(); const result = await pending; assert.equal(result.ok, true);
  assert.deepEqual(persisted(g).shopInteriorLayouts.shop, intended); assert.equal(layout.items[0].x, -1); assert.equal(notices.length, 1);
  for (const key of Object.keys(before).filter(k => !['revision', 'updatedAt'].includes(k))) assert.deepEqual(persisted(g)[key], before[key], key);
});

test('denied and throwing saves retain the old record and draft and allow a fresh explicit retry', async () => {
  for (const previous of [false, true]) for (const mode of ['false', 'object_false', 'throw']) {
    const g = await game(); if (previous) assert.equal((await save(g, 'shop', Layout.defaultLayout('shop'))).ok, true);
    const raw = g.storage.data.get(Core.KEY), before = persisted(g), write = g.storage.setItem.bind(g.storage), layout = edited('shop'), draft = copy(layout);
    g.storage.setItem = async () => { if (mode === 'throw') throw Error('private key=https://hidden.invalid'); return mode === 'false' ? false : { ok: false }; };
    const result = await save(g, 'shop', layout); assert.equal(result.error.code, 'storage_failed'); assert.equal(g.storage.data.get(Core.KEY), raw); assert.deepEqual(layout, draft);
    for (const key of Object.keys(before)) assert.deepEqual(result.state[key], before[key], key);
    assert.doesNotMatch(JSON.stringify(result.error), /private|https:|key=/); g.storage.setItem = write;
    assert.equal((await save(g, 'shop', layout, before.revision)).ok, true); assert.deepEqual(persisted(g).shopInteriorLayouts.shop, draft);
  }
});

test('revision conflicts and storage CAS preserve the newer wallet, progress and other room', async () => {
  const g = await game(), revision = g.app.getState().revision, draft = edited('shop'), writes = g.storage.writes.length, raw = g.storage.data.get(Core.KEY);
  for (const rev of [undefined, null, String(revision), revision + .5, -1, NaN, Infinity, revision + 1]) {
    const result = await g.app.dispatch({ type: 'saveShopInteriorLayout', roomId: 'shop', layout: draft, expectedRevision: rev });
    assert.equal(result.error.code, 'stale_state'); assert.equal(g.storage.data.get(Core.KEY), raw); assert.equal(g.storage.writes.length, writes);
  }
  const stale = Core.create(g.options); assert.equal((await stale.ready).ok, true); const oldRevision = stale.getState().revision;
  assert.equal((await g.app.dispatch({ type: 'care', kind: 'feed' })).ok, true); assert.equal((await save(g, 'cafe', edited('cafe'))).ok, true);
  const newer = persisted(g), newerRaw = g.storage.data.get(Core.KEY), newerWrites = g.storage.writes.length;
  const result = await stale.dispatch({ type: 'saveShopInteriorLayout', roomId: 'shop', layout: draft, expectedRevision: oldRevision });
  assert.equal(result.error.code, 'stale_state'); assert.equal(g.storage.data.get(Core.KEY), newerRaw); assert.deepEqual(persisted(g), newer); assert.equal(g.storage.writes.length, newerWrites);
  assert.deepEqual(draft, edited('shop'));
});

test('concurrent room saves require one revision each and a fresh retry preserves the other room', async () => {
  const g = await game(), revision = g.app.getState().revision;
  const results = await Promise.all([save(g, 'shop', edited('shop'), revision), save(g, 'cafe', edited('cafe'), revision)]);
  assert.equal(results.filter(r => r.ok).length, 1); assert.equal(results[1].error.code, 'stale_state');
  assert.deepEqual(persisted(g).shopInteriorLayouts, { shop: edited('shop') });
  assert.equal((await save(g, 'cafe', edited('cafe'))).ok, true);
  assert.deepEqual(persisted(g).shopInteriorLayouts, { shop: edited('shop'), cafe: edited('cafe') });
});

test('corrupt stored shop layouts are rejected read-only without resetting or overwriting the existing record', async () => {
  const base = await game(), original = persisted(base), cases = [null, [], { shop: null }, { shop: { version: 1, items: [{ id: 'unknown', x: 0, z: 0, turn: 0 }] } }, { shop: { version: 1, items: [{ id: 'chairA', x: 0, z: 2.5, turn: 0 }] } }, { home: { version: 1, items: [] } }];
  for (const value of cases) {
    const record = { ...original, shopInteriorLayouts: value }, raw = JSON.stringify(record), storage = memory({ [Core.KEY]: raw }), app = Core.create({ storage, now: base.options.now });
    const result = await app.ready; assert.equal(result.ok, false); assert.equal(result.error.code, 'corrupt_data'); assert.equal(result.state.readOnly, true);
    assert.equal(storage.data.get(Core.KEY), raw); assert.equal(storage.writes.length, 0);
    assert.equal((await app.dispatch({ type: 'saveShopInteriorLayout', roomId: 'shop', layout: edited('shop'), expectedRevision: original.revision })).error.code, 'read_only');
    assert.equal(storage.data.get(Core.KEY), raw); assert.equal(storage.writes.length, 0);
  }
});

test('bad backup layouts cannot replace a valid store, while valid shop and cafe layouts round-trip', async () => {
  const source = await game(); await save(source, 'shop', edited('shop')); await save(source, 'cafe', edited('cafe'));
  const target = await game(); assert.equal((await target.app.importBackup(source.app.exportBackup())).ok, true);
  assert.deepEqual(persisted(target).shopInteriorLayouts, persisted(source).shopInteriorLayouts);
  const raw = target.storage.data.get(Core.KEY), writes = target.storage.writes.length, state = persisted(target);
  const bad = { ...state, shopInteriorLayouts: { shop: { version: 1, items: [{ id: 'chairA', x: 0, z: 2.5, turn: 0 }] } } };
  assert.equal((await target.app.importBackup(JSON.stringify({ format: 'PetGameBackup', version: 3, state: bad }))).ok, false);
  assert.equal(target.storage.data.get(Core.KEY), raw); assert.equal(target.storage.writes.length, writes);
});

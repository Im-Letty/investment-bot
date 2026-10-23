'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../static/pet-game-core.js');
const clone = value => JSON.parse(JSON.stringify(value));
function memory(seed = {}) {
  const data = new Map(Object.entries(seed));
  return { data, writes: [], getItem(key) { return data.has(key) ? data.get(key) : null; }, setItem(key, value) { this.writes.push([key, value]); data.set(key, value); } };
}
async function game(seed = {}, choose = true) {
  const storage = memory(seed); let now = new Date(2026, 9, 24, 12).getTime();
  const options = { storage, now: () => now, random: () => .5 }, app = Core.create(options);
  assert.equal((await app.ready).ok, true);
  if (choose && Core.needsEggChoice(app.getState())) assert.equal((await app.dispatch({ type: 'chooseEgg', eggOrigin: 'mint' })).ok, true);
  return { app, storage, options, advance(ms = 100) { now += ms; } };
}
const persisted = g => JSON.parse(g.storage.data.get(Core.KEY));
const layout = objects => ({ version: 1, wall: 'brick', floor: 'honey', objects, nextId: Math.max(0, ...objects.map(o => o.id)) + 1 });
const object = (id = 1, type = 'chair', extra = {}) => ({ id, type, x: 0, z: 0, r: 0, ...extra });
const save = (g, value, expectedRevision = g.app.getState().revision) => g.app.dispatch({ type: 'saveCozyRoomLayout', layout: value, expectedRevision });

test('approved default geometry keeps all eight exact non-grid positions and metadata is separate from owned items', () => {
  const approved = { version: 1, wall: 'brick', floor: 'honey', objects: [
    { id: 1, type: 'cupboard', x: -2.5, z: -3.2, r: 0 }, { id: 2, type: 'counter', x: -.25, z: -3.15, r: 0 },
    { id: 3, type: 'bed', x: 2.45, z: .2, r: 0 }, { id: 4, type: 'rug', x: -.5, z: .65, r: 0 },
    { id: 5, type: 'table', x: -1, z: -.5, r: 0 }, { id: 6, type: 'chair', x: -1, z: 1.05, r: 0 },
    { id: 7, type: 'plant', x: -3, z: 2.35, r: 0 }, { id: 8, type: 'lamp', x: 3, z: -2.5, r: 0 }
  ], nextId: 9 };
  assert.deepEqual(Core.defaultCozyRoomLayout(), approved); assert.deepEqual(Core.getCozyRoomLayout(), approved);
  assert.deepEqual(Core.cozyRoomFurniture.map(x => x.id), ['bed', 'table', 'chair', 'cupboard', 'plant', 'counter', 'lamp', 'rug']);
  assert.equal(Core.cozyRoomTypes.length, 18); assert.equal(Core.cozyRoomFurniture.filter(x => x.flat).length, 1);
  const changed = Core.defaultCozyRoomLayout(); changed.objects[0].x = 123; assert.deepEqual(Core.defaultCozyRoomLayout(), approved);
  assert.equal(Core.items.some(x => x.id === 'chair' || x.id === 'cupboard'), false);
});

test('older layout-free records derive a detached room without initialization writes or character/economy changes', async () => {
  const g = await game({ pg_exp: '686', pg_coins: '574', pg_species: 'bunny', pg_name: '以前からのこ', pg_items: '{"rice":2}' });
  const raw = g.storage.data.get(Core.KEY), before = persisted(g), writes = g.storage.writes.length;
  const view = Core.getCozyRoomLayout(g.app.getState()); assert.deepEqual(view, Core.defaultCozyRoomLayout());
  view.objects[0].x = 0; assert.deepEqual(g.app.getCozyRoomLayout(), Core.defaultCozyRoomLayout());
  const reopened = Core.create(g.options); assert.equal((await reopened.ready).ok, true); Core.getCozyRoomLayout(reopened.getState());
  assert.equal(g.storage.data.get(Core.KEY), raw); assert.equal(g.storage.writes.length, writes); assert.deepEqual(persisted(g), before);
  assert.equal(Object.hasOwn(before, 'cozyRoomLayout'), false); assert.equal(before.pet.species, 'bunny'); assert.equal(before.pet.exp, 686);
});

test('an unchosen egg may view a detached default but cannot persist a room or earn a reward', async () => {
  const g = await game({}, false), before = persisted(g), raw = g.storage.data.get(Core.KEY);
  assert.deepEqual(g.app.getCozyRoomLayout(), Core.defaultCozyRoomLayout());
  const result = await save(g, Core.defaultCozyRoomLayout()); assert.equal(result.error.code, 'egg_required');
  assert.equal(g.storage.data.get(Core.KEY), raw); assert.deepEqual(persisted(g), before);
});

test('all explicit old fixtures and owned decorations project in original order with stable IDs while preserving raw percentages and flip', async () => {
  const decor = Object.fromEntries(Core.items.filter(x => x.type === 'decoration').map(x => [x.id, {}]));
  const g = await game({ pg_deco: JSON.stringify(decor) });
  const ids = Core.roomFurniture.map(x => x.id).concat(Object.keys(decor));
  const old = { version: 1, items: ids.map((id, i) => ({ id, x: i % 2 ? 100 : 0, y: i % 3 ? 100 : 0, flip: i % 2 === 1 })) };
  assert.equal((await g.app.dispatch({ type: 'saveRoomLayout', layout: old, expectedRevision: g.app.getState().revision })).ok, true);
  const raw = g.storage.data.get(Core.KEY), writes = g.storage.writes.length, projected = g.app.getCozyRoomLayout();
  const types = ['legacy_window', 'cupboard', 'rug', 'bed', 'legacy_bowl', 'legacy_toy', ...Object.keys(decor).map(id => 'decor_' + id)];
  assert.deepEqual(projected.objects.map(x => x.type), types); assert.deepEqual(projected.objects.map(x => x.sourceId), ids);
  assert.deepEqual(projected.objects.map(x => x.id), ids.map((_, i) => i + 1)); assert.equal(projected.nextId, 14);
  for (let i = 0; i < old.items.length; i++) {
    const p = projected.objects[i], spec = Core.cozyRoomTypes.find(x => x.id === p.type), width = p.r % 2 ? spec.depth : spec.width, depth = p.r % 2 ? spec.width : spec.depth;
    assert.equal(p.r, old.items[i].flip ? 2 : 0); assert.ok(Math.abs(p.x) + width / 2 <= 3.85 + 1e-9); assert.ok(Math.abs(p.z) + depth / 2 <= 3.85 + 1e-9);
  }
  assert.deepEqual(g.app.getCozyRoomLayout(), projected); assert.deepEqual(Core.getRoomLayout(g.app.getState()), old);
  assert.equal(g.storage.data.get(Core.KEY), raw); assert.equal(g.storage.writes.length, writes);
  assert.equal((await save(g, projected)).ok, true); assert.deepEqual(persisted(g).roomLayout, old); assert.deepEqual(g.app.getCozyRoomLayout(), projected);
});

test('an explicit empty old room stays empty even with an equipped decoration; absent old room appends only an owned known decoration', async () => {
  const g = await game({ pg_deco: '{"house":{},"future-kept":{}}' });
  await g.app.dispatch({ type: 'equip', itemId: 'house' });
  const fallback = g.app.getCozyRoomLayout(); assert.equal(fallback.objects.length, 9); assert.deepEqual(fallback.objects.at(-1), { id: 9, type: 'decor_house', x: 1.536, z: 2.816, r: 0, sourceId: 'house' });
  await g.app.dispatch({ type: 'saveRoomLayout', layout: { version: 1, items: [] }, expectedRevision: g.app.getState().revision });
  const raw = g.storage.data.get(Core.KEY); assert.deepEqual(g.app.getCozyRoomLayout(), layout([])); assert.equal(g.storage.data.get(Core.KEY), raw);
  assert.equal((await save(g, layout([]))).ok, true); assert.deepEqual(g.app.getCozyRoomLayout(), layout([])); assert.deepEqual(persisted(g).roomLayout, { version: 1, items: [] });
});

test('saving approved furniture surfaces and repeated free fixtures changes only its layout revision and update time', async () => {
  const g = await game({ pg_exp: '686', pg_coins: '574', pg_items: '{"rice":2}', pg_deco: '{"flower":{}}' });
  const before = persisted(g), value = Core.defaultCozyRoomLayout(); value.wall = 'floral'; value.floor = 'oak'; g.advance(123);
  const result = await save(g, value); assert.equal(result.ok, true); assert.deepEqual(result.reward, {});
  assert.deepEqual(persisted(g), { ...before, cozyRoomLayout: value, revision: before.revision + 1, updatedAt: g.options.now() });
  const repeated = layout(Array.from({ length: 24 }, (_, i) => object(i + 1, 'chair')));
  assert.equal((await save(g, repeated)).ok, true, 'saved overlap and free duplicates remain valid without inventing inventory');
  assert.deepEqual(persisted(g).decorations, before.decorations); assert.deepEqual(persisted(g).inventory, before.inventory); assert.deepEqual(persisted(g).achievements, before.achievements);
});

test('quarter-turn bounds use the rotated footprint while exact fractional positions remain saveable', async () => {
  const g = await game();
  assert.equal((await save(g, layout([object(1, 'bed', { x: 2.8 })]))).ok, true);
  const raw = g.storage.data.get(Core.KEY);
  assert.equal((await save(g, layout([object(1, 'bed', { x: 2.8, r: 1 })]))).error.code, 'invalid_cozy_room_layout');
  assert.equal(g.storage.data.get(Core.KEY), raw);
  assert.equal((await save(g, layout([object(1, 'bed', { z: 2.8, r: 1 })]))).ok, true);
  assert.equal((await save(g, layout([object(1, 'chair', { x: .12345, z: -.23456, r: 3 })]))).ok, true);
});

test('malformed room structure, IDs, surfaces, positions and unknown object fields cannot write', async () => {
  const g = await game(), good = layout([object()]), bad = [null, [], {}, { ...good, version: 2 }, { ...good, wall: 'unknown' }, { ...good, floor: 'room' },
    { ...good, nextId: 1 }, { ...good, nextId: 2.5 }, { ...good, nextId: '2' }, { ...good, extra: true },
    layout([object(0)]), layout([object(-1)]), layout([object(1.5)]), layout([object('1')]), layout([object(1), object(1)]),
    layout([object(1, 'unknown')]), layout([object(1, 'apple')]), layout([object(1, 'chair', { x: NaN })]), layout([object(1, 'chair', { x: Infinity })]),
    layout([object(1, 'chair', { x: '0' })]), layout([object(1, 'chair', { z: 4 })]), layout([object(1, 'chair', { r: -1 })]),
    layout([object(1, 'chair', { r: 4 })]), layout([object(1, 'chair', { r: .5 })]), layout([object(1, 'chair', { flip: false })]),
    layout(Array.from({ length: 25 }, (_, i) => object(i + 1)))];
  const sparse = { ...good, objects: new Array(1) }; bad.push(sparse);
  const extraArray = clone(good); extraArray.objects.extra = true; bad.push(extraArray);
  const raw = g.storage.data.get(Core.KEY), before = persisted(g), writes = g.storage.writes.length;
  for (const value of bad) { const result = await save(g, value); assert.equal(result.ok, false); assert.equal(result.error.code, 'invalid_cozy_room_layout'); assert.equal(g.storage.data.get(Core.KEY), raw); }
  assert.equal(g.storage.writes.length, writes); assert.deepEqual(persisted(g), before);
});

test('import types require a unique matching known source and decorations require real ownership', async () => {
  const g = await game(), invalid = [
    object(1, 'legacy_window'), object(1, 'decor_house'), object(1, 'chair', { sourceId: 'room_bed' }),
    object(1, 'legacy_window', { sourceId: 'room_bowl' }), object(1, 'bed', { sourceId: 'unknown' }), object(1, 'bed', { sourceId: null }),
    object(1, 'decor_house', { sourceId: 'apple' }), object(1, 'bed', { sourceId: '__proto__' })
  ];
  const raw = g.storage.data.get(Core.KEY);
  for (const value of invalid) assert.equal((await save(g, layout([value]))).error.code, 'invalid_cozy_room_layout');
  assert.equal((await save(g, layout([object(1, 'decor_house', { sourceId: 'house' })]))).error.code, 'not_owned');
  assert.equal((await save(g, layout([object(1, 'bed', { sourceId: 'room_bed' }), object(2, 'bed', { sourceId: 'room_bed' })]))).error.code, 'invalid_cozy_room_layout');
  assert.equal(g.storage.data.get(Core.KEY), raw);
  assert.equal((await save(g, layout([object(1, 'legacy_window', { sourceId: 'room_window' }), object(2, 'bed', { sourceId: 'room_bed' })]))).ok, true);
  assert.equal(Object.hasOwn(persisted(g), 'roomLayout'), false, 'source attribution does not require or create a current old placement');
});

test('putting imported fixtures away does not delete old ownership, room layout or their source records', async () => {
  const g = await game({ pg_deco: '{"house":{}}' });
  const old = { version: 1, items: [{ id: 'house', x: 24, y: 94, flip: true }, { id: 'room_bed', x: 70, y: 80, flip: false }] };
  await g.app.dispatch({ type: 'saveRoomLayout', layout: old, expectedRevision: g.app.getState().revision });
  const before = persisted(g), imported = g.app.getCozyRoomLayout(); await save(g, imported); await save(g, layout([]));
  assert.deepEqual(persisted(g).roomLayout, old); assert.deepEqual(persisted(g).decorations, before.decorations);
  assert.equal((await save(g, imported)).ok, true); assert.deepEqual(g.app.getCozyRoomLayout(), imported);
});

test('a pending durable write publishes no room and adopts its cloned input only after acknowledgement', async () => {
  const g = await game(), before = persisted(g), raw = g.storage.data.get(Core.KEY), notices = [], value = Core.defaultCozyRoomLayout(), snapshot = clone(value);
  const write = g.storage.setItem.bind(g.storage); let release; g.app.subscribe(s => notices.push(s));
  g.storage.setItem = (key, text) => new Promise(resolve => { release = () => { write(key, text); resolve(); }; });
  const pending = save(g, value); while (!release) await new Promise(resolve => setImmediate(resolve));
  value.wall = 'mint'; value.objects[0].x = 99; assert.deepEqual(persisted(g), before); assert.equal(g.storage.data.get(Core.KEY), raw); assert.equal(notices.length, 0);
  release(); assert.equal((await pending).ok, true); assert.deepEqual(persisted(g).cozyRoomLayout, snapshot); assert.equal(notices.length, 1);
});

for (const mode of ['false', 'object', 'throw']) test('a ' + mode + ' write failure preserves the confirmed room and progress until explicit retry', async () => {
  const g = await game(); await save(g, Core.defaultCozyRoomLayout()); const before = persisted(g), raw = g.storage.data.get(Core.KEY), value = layout([]), write = g.storage.setItem.bind(g.storage);
  g.storage.setItem = async () => { if (mode === 'throw') throw Error('token=private https://private.invalid'); return mode === 'object' ? { ok: false } : false; };
  const result = await save(g, value); assert.equal(result.error.code, 'storage_failed'); assert.doesNotMatch(JSON.stringify(result.error), /private|https:|token=/);
  assert.equal(g.storage.data.get(Core.KEY), raw); assert.deepEqual(persisted(g), before); assert.deepEqual(g.app.getCozyRoomLayout(), before.cozyRoomLayout);
  g.storage.setItem = write; assert.equal((await save(g, value)).ok, true); assert.deepEqual(g.app.getCozyRoomLayout(), value);
});

test('revision conflicts and external CAS preserve the newer real care and reject stale room saves', async () => {
  const g = await game(), revision = g.app.getState().revision;
  for (const bad of [undefined, null, -1, revision + 1, String(revision), revision + .5]) {
    const result = await g.app.dispatch({ type: 'saveCozyRoomLayout', layout: layout([]), ...(bad === undefined ? {} : { expectedRevision: bad }) }); assert.equal(result.error.code, 'stale_state');
  }
  const other = Core.create(g.options); await other.ready; const otherRevision = other.getState().revision;
  await g.app.dispatch({ type: 'care', kind: 'feed' }); const raw = g.storage.data.get(Core.KEY), before = persisted(g);
  assert.equal((await other.dispatch({ type: 'saveCozyRoomLayout', layout: layout([]), expectedRevision: otherRevision })).error.code, 'stale_state');
  assert.equal(g.storage.data.get(Core.KEY), raw); assert.deepEqual(persisted(g), before);
  const results = await Promise.all([save(g, Core.defaultCozyRoomLayout()), save(g, layout([]))]);
  assert.equal(results.filter(x => x.ok).length, 1); assert.equal(results[1].error.code, 'stale_state'); assert.deepEqual(g.app.getState().pet, before.pet);
});

test('cozy and old layouts survive backup and reload while older backups remain initialization-free', async () => {
  const g = await game(), old = { version: 1, items: [{ id: 'room_bed', x: 10, y: 90, flip: true }] };
  await g.app.dispatch({ type: 'saveRoomLayout', layout: old, expectedRevision: g.app.getState().revision });
  const value = g.app.getCozyRoomLayout(); value.wall = 'mint'; value.floor = 'check'; await save(g, value);
  const target = await game(); assert.equal((await target.app.importBackup(g.app.exportBackup())).ok, true); assert.deepEqual(target.app.getCozyRoomLayout(), value); assert.deepEqual(persisted(target).roomLayout, old);
  const raw = target.storage.data.get(Core.KEY), writes = target.storage.writes.length, reopened = Core.create(target.options); await reopened.ready;
  assert.deepEqual(reopened.getCozyRoomLayout(), value); assert.equal(target.storage.data.get(Core.KEY), raw); assert.equal(target.storage.writes.length, writes);
  const older = clone(persisted(target)); delete older.cozyRoomLayout; const source = await game({ [Core.KEY]: JSON.stringify(older) });
  const olderRaw = source.storage.data.get(Core.KEY); source.app.getCozyRoomLayout(); assert.equal(source.storage.data.get(Core.KEY), olderRaw); assert.equal(source.storage.writes.length, 0);
});

test('corrupt saved cozy rooms fail closed and malformed backups do not replace a valid room', async () => {
  const g = await game(); await save(g, Core.defaultCozyRoomLayout()); const before = persisted(g), raw = g.storage.data.get(Core.KEY);
  for (const value of [null, { ...layout([]), wall: 'unknown' }, layout([object(1, 'decor_house', { sourceId: 'house' })]), layout([object(1, 'chair', { x: 99 })])]) {
    const storage = memory({ [Core.KEY]: JSON.stringify({ ...before, cozyRoomLayout: value }) }), bad = Core.create({ ...g.options, storage });
    assert.equal((await bad.ready).error.code, 'corrupt_data'); assert.equal(bad.getState().readOnly, true); assert.equal(storage.writes.length, 0);
    const result = await g.app.importBackup(JSON.stringify({ format: 'PetGameBackup', version: 3, state: { ...before, cozyRoomLayout: value } }));
    assert.equal(result.ok, false); assert.equal(g.storage.data.get(Core.KEY), raw);
  }
});

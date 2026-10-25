'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const Core = require('../static/pet-game-core.js');

function gate(seed = {}, failWrites = false) {
  const values = new Map(Object.entries(seed)), localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { if (failWrites) throw Error('synthetic denied write'); values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
  const window = { localStorage, crypto: webcrypto, TextEncoder, TextDecoder,
    btoa: value => Buffer.from(value, 'binary').toString('base64'), atob: value => Buffer.from(value, 'base64').toString('binary') };
  window.window = window;
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8'), start = html.indexOf('/* knGate: encrypted localStorage gate');
  assert.ok(start > 0); vm.runInNewContext(html.slice(start, html.indexOf('</script>', start)), window);
  return { window, values };
}
const now = () => new Date(2026, 9, 24, 13).getTime();
function adapter(window) { return { getItem: key => window.__knReadGameStorage(key), setItem: (key, text) => window.__knPersistLocalSetting(key, text) }; }
async function open(g) { await g.window.__knGateReady; const app = Core.create({ storage: adapter(g.window), now }); assert.equal((await app.ready).ok, true); return app; }
const empty = { version: 1, wall: 'floral', floor: 'check', objects: [], nextId: 1 };

test('3D surfaces and original imported furniture round-trip the actual encrypted gate without plaintext, new keys or an initialization write', async () => {
  const first = gate({ pg_exp: '0' }), app = await open(first);
  const old = { version: 1, items: [{ id: 'room_window', x: 15, y: 22, flip: true }, { id: 'room_bed', x: 85, y: 75, flip: false }] };
  assert.equal((await app.dispatch({ type: 'saveRoomLayout', layout: old, expectedRevision: app.getState().revision })).ok, true);
  const before = app.getState(), keys = [...first.values.keys()].sort(), design = app.getCozyRoomLayout(); design.wall = 'mint'; design.floor = 'oak';
  assert.equal((await app.dispatch({ type: 'saveCozyRoomLayout', layout: design, expectedRevision: before.revision })).ok, true);
  const ciphertext = first.values.get('knenc:' + Core.KEY); assert.match(ciphertext, /^knv1:/); assert.equal(first.values.has(Core.KEY), false);
  assert.equal(ciphertext.includes('cozyRoomLayout'), false); assert.equal(ciphertext.includes('legacy_window'), false); assert.deepEqual([...first.values.keys()].sort(), keys);
  const restored = gate(Object.fromEntries(first.values)), reopened = await open(restored);
  assert.deepEqual(reopened.getCozyRoomLayout(), design); assert.deepEqual(Core.getRoomLayout(reopened.getState()), old);
  assert.equal(restored.values.get('knenc:' + Core.KEY), ciphertext, 'read-only hydration keeps the confirmed ciphertext exact');
  for (const key of ['pet', 'coins', 'inventory', 'wardrobe', 'decorations', 'care', 'market', 'achievements', 'roomLayout']) assert.deepEqual(reopened.getState()[key], before[key], key);
  assert.equal((await reopened.dispatch({ type: 'saveCozyRoomLayout', layout: empty, expectedRevision: reopened.getState().revision })).ok, true);
  const afterEmpty = gate(Object.fromEntries(restored.values)), emptyGame = await open(afterEmpty);
  assert.deepEqual(emptyGame.getCozyRoomLayout(), empty); assert.deepEqual(Core.getRoomLayout(emptyGame.getState()), old);
});

test('a rejected encrypted 3D-room save retains the prior ciphertext, design and complete selected pet record', async () => {
  const first = gate(), app = await open(first); await app.dispatch({ type: 'chooseEgg', eggOrigin: 'mint' });
  const design = app.getCozyRoomLayout(); assert.equal((await app.dispatch({ type: 'saveCozyRoomLayout', layout: design, expectedRevision: app.getState().revision })).ok, true);
  const denied = gate(Object.fromEntries(first.values), true), reopened = await open(denied), before = reopened.getState(), ciphertext = denied.values.get('knenc:' + Core.KEY);
  const result = await reopened.dispatch({ type: 'saveCozyRoomLayout', layout: empty, expectedRevision: before.revision }); assert.equal(result.ok, false); assert.equal(result.error.code, 'storage_failed');
  assert.equal(denied.values.get('knenc:' + Core.KEY), ciphertext); assert.deepEqual(reopened.getCozyRoomLayout(), design); assert.equal(denied.values.has(Core.KEY), false);
  for (const key of Object.keys(before).filter(key => key !== 'error')) assert.deepEqual(reopened.getState()[key], before[key], key);
});

test('a structurally corrupt encrypted cozy layout is preserved for recovery and cannot be treated as an empty room', async () => {
  const first = gate(), app = await open(first); await app.dispatch({ type: 'chooseEgg', eggOrigin: 'lilac' });
  const raw = JSON.parse(await first.window.__knReadGameStorage(Core.KEY)); raw.cozyRoomLayout = { ...empty, wall: 'not-a-wall' };
  await first.window.__knPersistLocalSetting(Core.KEY, JSON.stringify(raw)); const ciphertext = first.values.get('knenc:' + Core.KEY);
  const restored = gate(Object.fromEntries(first.values)); await restored.window.__knGateReady;
  const blocked = Core.create({ storage: adapter(restored.window), now }); assert.equal((await blocked.ready).error.code, 'corrupt_data'); assert.equal(blocked.getState().readOnly, true);
  assert.equal((await blocked.dispatch({ type: 'saveCozyRoomLayout', layout: empty, expectedRevision: blocked.getState().revision })).error.code, 'read_only');
  assert.equal(restored.values.get('knenc:' + Core.KEY), ciphertext); assert.equal(restored.values.has(Core.KEY), false);
});

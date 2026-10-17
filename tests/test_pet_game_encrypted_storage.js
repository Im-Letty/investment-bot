'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');

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

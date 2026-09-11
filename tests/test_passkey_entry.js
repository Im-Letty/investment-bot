'use strict';

// Exercise the actual main-page handler without loading news, account data or
// external SDKs. Auth responses are controlled to test account-switch races.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('var passkeyEntryBusy=false;');
const end = html.indexOf("fetch('/auth/passkey/status'", start);
assert.ok(start >= 0 && end > start, 'Expected the shipped main entry handler');
const source = html.slice(start, end);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function until(predicate) {
  for (let i = 0; i < 50; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail('Expected asynchronous auth operation');
}

function harness({ mode = 'signup', user = null, enabled = true } = {}) {
  const primary = { disabled: false };
  const checks = [], oauth = [], messages = [], entries = [];
  const context = {
    KN_PASSKEY_ENABLED: enabled, knaMode: mode, knUser: user,
    document: { querySelector(selector) { assert.equal(selector, '#knAuthOv .kna-pk'); return primary; } },
    knaMsg(message, error) { messages.push({ message, error }); },
    async knEnterHome() { entries.push(context.knUser && context.knUser.id); },
    sb: { auth: {
      getUser() { const request = deferred(); checks.push(request); return request.promise; },
      signInWithOAuth(options) { const request = deferred(); oauth.push({ options, ...request }); return request.promise; },
    } },
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'index-passkey-entry.js' });
  return { context, primary, checks, oauth, messages, entries, click: () => context.knaPasskey() };
}

function assertOAuth(app, mode) {
  assert.equal(app.oauth.length, 1);
  const request = app.oauth[0].options;
  assert.equal(request.provider, 'custom:passkey');
  assert.equal(request.options.redirectTo, 'https://investment-bot-ta24.onrender.com');
  assert.equal(request.options.queryParams.screen_hint, mode);
  assert.notEqual(request.options.queryParams.screen_hint, 'signup_new');
}

for (const mode of ['signup', 'login']) {
  test(mode + ': guest entry starts the requested OAuth check, never direct new registration', async () => {
    const app = harness({ mode });
    const click = app.click();
    assert.equal(app.checks.length, 0);
    assertOAuth(app, mode);
    await app.click();
    assert.equal(app.oauth.length, 1, 'Repeated click must share the pending handoff');
    app.oauth[0].resolve({ error: null });
    await click;
    await app.click();
    assert.equal(app.oauth.length, 1, 'Do not repeat OAuth while leaving');
    assert.equal(app.primary.disabled, true);
    assert.deepEqual(app.entries, []);
  });
}

test('signup preserves the current account only after getUser validates the same identity', async () => {
  const app = harness({ user: { id: 'account-a' } });
  const click = app.click();
  await app.click();
  assert.equal(app.checks.length, 1);
  assert.equal(app.oauth.length, 0);
  assert.deepEqual(app.entries, []);
  assert.equal(app.primary.disabled, true);
  app.checks[0].resolve({ data: { user: { id: 'account-a' } }, error: null });
  await click;
  assert.deepEqual(app.entries, ['account-a']);
  assert.equal(app.oauth.length, 0);
  assert.equal(app.context.knUser.id, 'account-a');
  assert.equal(app.primary.disabled, false);
});

for (const change of ['invalid session', 'signed out', 'different account']) {
  test('signup never enters a stale account after ' + change + ' during getUser', async () => {
    const app = harness({ user: { id: 'account-a' } });
    const click = app.click();
    if (change === 'signed out') app.context.knUser = null;
    if (change === 'different account') app.context.knUser = { id: 'account-b' };
    app.checks[0].resolve(change === 'invalid session'
      ? { data: { user: null }, error: { message: 'Expired session' } }
      : { data: { user: { id: 'account-a' } }, error: null });
    await until(() => app.oauth.length === 1);
    assert.deepEqual(app.entries, []);
    assertOAuth(app, 'signup');
    if (change === 'signed out') assert.equal(app.context.knUser, null);
    if (change === 'different account') assert.equal(app.context.knUser.id, 'account-b');
    app.oauth[0].resolve({ error: null });
    await click;
  });
}

test('a rejected session check preserves the account and permits a deliberate retry', async () => {
  const app = harness({ user: { id: 'account-a' } });
  const first = app.click();
  app.checks[0].reject(new Error('Network unavailable'));
  await first;
  assert.equal(app.primary.disabled, false);
  assert.equal(app.context.knUser.id, 'account-a');
  assert.equal(app.oauth.length, 0);
  assert.deepEqual(app.entries, []);
  assert.match(app.messages[0].message, /接続/);
  const retry = app.click();
  assert.equal(app.checks.length, 2);
  app.checks[1].resolve({ data: { user: { id: 'account-a' } }, error: null });
  await retry;
  assert.deepEqual(app.entries, ['account-a']);
});

for (const outcome of ['error response', 'network rejection']) {
  test('OAuth ' + outcome + ' releases the duplicate guard for a user retry', async () => {
    const app = harness();
    const first = app.click();
    if (outcome === 'error response') app.oauth[0].resolve({ error: { message: 'OAuth unavailable' } });
    else app.oauth[0].reject(new Error('Connection lost'));
    await first;
    assert.equal(app.primary.disabled, false);
    assert.deepEqual(app.entries, []);
    assert.equal(app.messages.length, 1);
    const retry = app.click();
    assert.equal(app.oauth.length, 2);
    assert.equal(app.oauth[1].options.options.queryParams.screen_hint, 'signup');
    app.oauth[1].resolve({ error: null });
    await retry;
    assert.equal(app.primary.disabled, true);
  });
}

test('disabled backend does not validate a session or initiate OAuth', async () => {
  const app = harness({ enabled: false, user: { id: 'account-a' } });
  await app.click();
  assert.equal(app.checks.length, 0);
  assert.equal(app.oauth.length, 0);
  assert.deepEqual(app.entries, []);
  assert.equal(app.primary.disabled, false);
});

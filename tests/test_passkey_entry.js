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
const renderStart = html.indexOf('  function render(){');
const renderEnd = html.indexOf('  function mount(){', renderStart);
const controlsStart = html.indexOf('  window.openAuth=function(mode)', end);
const controlsEnd = html.indexOf('  var requestedAuth=', controlsStart);
const homeListener = html.split('\n').find(line => line.includes("document.addEventListener('knAuthChange'") && line.includes('knHoldSignupNotice'));
assert.ok(renderStart >= 0 && renderEnd > renderStart && controlsEnd > controlsStart && homeListener);
const source = html.slice(renderStart, renderEnd) + html.slice(start, end) + html.slice(controlsStart, controlsEnd) + homeListener;
const foundCopy = '登録済みのアカウントが見つかりました。<br>元のアカウントでログインしてください。';

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
  let primary = { disabled: false }, markup = '';
  const checks = [], oauth = [], messages = [], entries = [], listeners = {};
  const classes = new Set(['open']);
  const overlay = { classList: { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name) } };
  function mount() {
    markup = context.render();
    primary = { disabled: context.passkeyEntryBusy || !context.KN_PASSKEY_ENABLED };
  }
  const context = {
    KN_PASSKEY_ENABLED: enabled, knaMode: mode, knUser: user,
    isLineInApp() { return false; }, flag(value) { return !!value; },
    btnRow(options) { return '<button class="' + options.cls + '">' + options.label + '</button>'; },
    mount,
    document: {
      querySelector(selector) { assert.equal(selector, '#knAuthOv .kna-pk'); return primary; },
      getElementById(id) { assert.equal(id, 'knAuthOv'); return overlay; },
      addEventListener(type, listener) { (listeners[type] ||= []).push(listener); },
    },
    knaMsg(message, error) { messages.push({ message, error }); },
    async knEnterHome() { entries.push(context.knUser && context.knUser.id); },
    sb: { auth: {
      getUser() { const request = deferred(); checks.push(request); return request.promise; },
      signInWithOAuth(options) { const request = deferred(); oauth.push({ options, ...request }); return request.promise; },
    } },
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'index-passkey-entry.js' });
  mount();
  return { context, get primary() { return primary; }, get markup() { return markup; }, checks, oauth, messages, entries,
    click: () => context.knaPasskey(), mount,
    authChange() { for (const listener of listeners.knAuthChange || []) listener(); },
  };
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
    assert.ok(!app.markup.includes(foundCopy));
    assert.ok(app.markup.includes('id="knaTitle">' + (mode === 'signup' ? 'アカウント作成' : 'おかえりなさい') + '</h2>'));
    if (mode === 'signup') assert.ok(!app.markup.includes('おかえりなさい'));
  });
}

test('signup shows the notice only after getUser proof, then waits for deliberate login with the same account', async () => {
  const app = harness({ user: { id: 'account-a' } });
  const click = app.click();
  await app.click();
  assert.equal(app.checks.length, 1);
  assert.equal(app.oauth.length, 0);
  assert.deepEqual(app.entries, []);
  assert.equal(app.primary.disabled, true);
  assert.ok(!app.markup.includes(foundCopy));
  app.authChange(); // Session refresh during getUser must not dismiss signup.
  assert.deepEqual(app.entries, []);
  app.checks[0].resolve({ data: { user: { id: 'account-a' } }, error: null });
  await click;
  assert.deepEqual(app.entries, []);
  assert.ok(app.markup.includes(foundCopy));
  assert.ok(app.markup.includes('id="knaTitle">おかえりなさい</h2>'));
  assert.ok(app.markup.includes('元のアカウントでログイン</button>'));
  assert.ok(!app.markup.includes('<details class="kna-alternatives"'));
  assert.equal(app.oauth.length, 0);
  assert.equal(app.context.knUser.id, 'account-a');
  assert.equal(app.primary.disabled, false);
  app.mount(); // The late status fetch may remount the dialog.
  app.authChange();
  assert.ok(app.markup.includes(foundCopy));
  assert.deepEqual(app.entries, []);
  const login = app.click();
  assert.equal(app.checks.length, 2);
  assert.deepEqual(app.entries, []);
  app.checks[1].resolve({ data: { user: { id: 'account-a' } }, error: null });
  await login;
  assert.deepEqual(app.entries, ['account-a']);
  assert.equal(app.oauth.length, 0);
});

for (const change of ['invalid session', 'signed out', 'different account', 'anonymous session', 'replaced response']) {
  test('signup never enters a stale account after ' + change + ' during getUser', async () => {
    const app = harness({ user: { id: 'account-a' } });
    const click = app.click();
    if (change === 'signed out') app.context.knUser = null;
    if (change === 'different account') app.context.knUser = { id: 'account-b' };
    if (change === 'replaced response') app.context.knUser = { id: 'account-b' };
    app.checks[0].resolve(change === 'invalid session'
      ? { data: { user: null }, error: { message: 'Expired session' } }
      : { data: { user: { id: change === 'replaced response' ? 'account-b' : 'account-a', is_anonymous: change === 'anonymous session' } }, error: null });
    await until(() => app.oauth.length === 1);
    assert.deepEqual(app.entries, []);
    assert.ok(!app.markup.includes(foundCopy));
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
  assert.deepEqual(app.entries, []);
  assert.ok(app.markup.includes(foundCopy));
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
  assert.equal(app.primary.disabled, true);
});

for (const action of ['close', 'close and reopen', 'toggle']) {
  test('a pending signup check cannot change the dialog after ' + action, async () => {
    const app = harness({ user: { id: 'account-a' } });
    const click = app.click();
    if (action === 'toggle') app.context.knaToggleFn();
    else app.context.closeAuth();
    if (action === 'close and reopen') app.context.openAuth('signup');
    app.checks[0].resolve({ data: { user: { id: 'account-a' } }, error: null });
    await click;
    assert.ok(!app.markup.includes(foundCopy));
    assert.equal(app.oauth.length, 0);
    assert.deepEqual(app.entries, []);
    assert.equal(app.context.passkeyEntryBusy, false);
  });
}

for (const change of ['signed out', 'different account', 'anonymous session']) {
  test('a confirmed notice is removed on auth change: ' + change, async () => {
    const app = harness({ user: { id: 'account-a' } });
    const first = app.click();
    app.checks[0].resolve({ data: { user: { id: 'account-a' } }, error: null });
    await first;
    app.context.knUser = change === 'signed out' ? null : { id: change === 'different account' ? 'account-b' : 'account-a', is_anonymous: change === 'anonymous session' };
    app.authChange();
    assert.ok(!app.markup.includes(foundCopy));
    assert.equal(app.context.passkeyConfirmedUserId, null);
  });
}

for (const outcome of ['expired', 'anonymous', 'changed identity', 'network error']) {
  test('confirmed login recheck cannot enter home or start OAuth on ' + outcome, async () => {
    const app = harness({ user: { id: 'account-a' } });
    const first = app.click();
    app.checks[0].resolve({ data: { user: { id: 'account-a' } }, error: null });
    await first;
    const login = app.click();
    if (outcome === 'network error') app.checks[1].reject(new Error('Offline'));
    else app.checks[1].resolve(outcome === 'expired' ? { data: { user: null }, error: {} }
      : { data: { user: { id: outcome === 'changed identity' ? 'account-b' : 'account-a', is_anonymous: outcome === 'anonymous' } }, error: null });
    await login;
    assert.deepEqual(app.entries, []);
    assert.equal(app.oauth.length, 0);
    assert.equal(app.messages.length, 1);
    if (outcome !== 'network error') {
      assert.equal(app.context.knaMode, 'login');
      assert.ok(!app.markup.includes(foundCopy));
    }
  });
}

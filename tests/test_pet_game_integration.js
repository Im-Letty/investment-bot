'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const Core = require('../static/pet-game-core.js');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g));
const loader = scripts.find(m => m[0].startsWith('<script id="independent-pet-loader">'))?.[1];
const gate = scripts.find(m => m[1].includes('/* knGate:'))?.[1];
assert.ok(loader, 'independent game route exists');
assert.ok(gate, 'protected local settings gate exists');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {};
    this.hidden = false; this._text = ''; this.parentNode = null;
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
  }
  focus() { this.focused = true; }
}

function loaderFixture(options = {}) {
  const pane = new Element('section'); pane.hidden = true;
  const host = new Element(), focus = new Element('button');
  const scripts = [], listeners = { document: {}, window: {} }, timers = new Map();
  let timerId = 0, mounts = 0, closes = 0, received;
  const ui = {
    mount: async function (target, config) {
      mounts++; received = { target, config };
      if (options.mount) return options.mount(target, config);
      target.textContent = 'Synthetic game'; return true;
    },
    close: async function () { closes++; }
  };
  const document = {
    activeElement: focus,
    getElementById: id => id === 'sect-pet' ? pane : id === 'pet-game-root' ? host : null,
    createElement: tag => new Element(tag),
    addEventListener: (name, fn) => { (listeners.document[name] ||= []).push(fn); },
    head: { appendChild: script => { scripts.push(script); } }
  };
  const window = {
    __knGateReady: options.gate ?? Promise.resolve(true),
    __knReadGameStorage: options.read || (() => null),
    __knPersistLocalSetting: options.persist || (async () => undefined),
    addEventListener: (name, fn) => { (listeners.window[name] ||= []).push(fn); }
  };
  if (options.preloaded) { window.PetGameCore = {}; window.IndependentPetGame = ui; }
  const context = vm.createContext({
    window, document, Promise,
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id)
  });
  vm.runInContext(loader, context);
  return {
    window, document, pane, host, focus, scripts, timers, listeners, ui, context,
    get mounts() { return mounts; }, get closes() { return closes; }, get received() { return received; },
    coreLoaded() { window.PetGameCore = {}; scripts.at(-1).onload(); },
    motionLoaded() { window.PetLilacMotion = {}; scripts.at(-1).onload(); },
    roomLoaded() { window.PetRoomBehavior = {}; scripts.at(-1).onload(); },
    uiLoaded() { window.IndependentPetGame = ui; scripts.at(-1).onload(); },
    click(action) {
      const button = new Element('button'); button.setAttribute('data-act', action);
      for (const fn of listeners.document.click || []) fn({ target: { closest: () => button } });
    }
  };
}

function gateFixture(seed = {}, controls = {}, sharedMap) {
  const map = sharedMap || new Map(Object.entries(seed));
  const storage = {
    getItem: key => map.has(String(key)) ? map.get(String(key)) : null,
    setItem: (key, value) => {
      if (controls.failWrite === key) throw new Error('synthetic write failure');
      map.set(String(key), String(value));
    },
    removeItem: key => map.delete(String(key))
  };
  const crypto = {
    getRandomValues: value => webcrypto.getRandomValues(value),
    subtle: {
      importKey: (...args) => webcrypto.subtle.importKey(...args),
      generateKey: (...args) => webcrypto.subtle.generateKey(...args),
      exportKey: (...args) => webcrypto.subtle.exportKey(...args),
      encrypt: (...args) => webcrypto.subtle.encrypt(...args),
      decrypt: (...args) => {
        const result = webcrypto.subtle.decrypt(...args);
        if (controls.onDecrypt) controls.onDecrypt(map);
        return result;
      }
    }
  };
  const window = {};
  const context = vm.createContext({
    window, localStorage: storage, crypto, Uint8Array, TextEncoder, TextDecoder,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    atob: value => Buffer.from(value, 'base64').toString('binary')
  });
  vm.runInContext(gate, context);
  return { window, storage, map, controls };
}

test('egg selection persists through the existing encrypted storage boundary and fresh reload', async () => {
  const first=gateFixture();await first.window.__knGateReady;
  const adapter=gate=>({getItem:key=>gate.window.__knReadGameStorage(key),setItem:(key,value)=>gate.window.__knPersistLocalSetting(key,value)});
  const clock=()=>new Date(2026,9,22,12).getTime();
  const game=Core.create({storage:adapter(first),now:clock});assert.equal((await game.ready).ok,true);
  assert.equal(Core.needsEggChoice(game.getState()),true);
  assert.equal((await game.dispatch({type:'chooseEgg',eggOrigin:'mint'})).ok,true);
  const selected=game.getState();assert.equal(selected.pet.eggOrigin,'mint');assert.equal(selected.pet.exp,0);assert.equal(selected.coins,100);
  assert.equal(first.map.has(Core.KEY),false);assert.match(first.map.get('knenc:'+Core.KEY),/^knv1:/);
  const ciphertext=first.map.get('knenc:'+Core.KEY),second=gateFixture({}, {}, first.map);await second.window.__knGateReady;
  const reopened=Core.create({storage:adapter(second),now:clock});assert.equal((await reopened.ready).ok,true);
  assert.equal(reopened.getState().pet.eggOrigin,'mint');assert.equal(Core.needsEggChoice(reopened.getState()),false);
  assert.equal(second.map.get('knenc:'+Core.KEY),ciphertext,'reading the selected egg does not rewrite its encrypted save');
  assert.equal((await reopened.dispatch({type:'care',kind:'feed'})).ok,true);
  assert.equal(reopened.getState().pet.eggOrigin,'mint','care changes growth without replacing the birth origin');
  const exported=JSON.parse(reopened.exportBackup());assert.equal(exported.state.pet.eggOrigin,'mint');
});

test('new section is reachable and only independent game modules are loaded', () => {
  assert.match(html, /<section id="sect-pet"[^>]*hidden[^>]*>[\s\S]*?<div id="pet-game-root">/);
  assert.match(html, /href="\/static\/pet-game\.css\?v=/);
  assert.match(loader, /\/static\/pet-game-core\.js\?v=/);
  assert.match(loader, /\/static\/pet-game\.js\?v=/);
  assert.match(loader, /\/static\/pet-room-behavior\.js\?v=/);
  assert.doesNotMatch(loader, /developerPreview/);
  assert.match(html, /class="bn-item" data-act="pet"/);
  assert.doesNotMatch(html, /pet-features-855cb201bd\.js|id="pet-card"|id="petOv"/);
  assert.doesNotMatch(html, /function\s+(?:hookMorning|kakeiboBonus|dailyLogin|calcExp)\s*\(/);
});

test('simulator routes and shared study check-in remain, with no old game writes', () => {
  for (const marker of ['__PG_SPA_BOOTED', '__PG_SIM_IFRAME_BOOTED', '__PG_SIM_UNIFY_BOOTED']) {
    assert.ok(html.includes(marker), marker + ' remains');
  }
  assert.ok(html.includes('skBanner'));
  assert.match(html, /setItem\(['"]sk_total['"]/);
  assert.doesNotMatch(html, /localStorage\.setItem\(\s*['"]pg_(?:exp|coins|login_day|morning_day|kakeibo_rwd)['"]/);
  assert.doesNotMatch(html, /localStorage\.removeItem\(\s*['"](?:pg_[^'"]+|pet_game)['"]/);
  const legacy = fs.readFileSync(path.join(root, 'static/pet-features-855cb201bd.js'), 'utf8');
  assert.ok(legacy.length > 1000, 'legacy module retained as migration history');
});

test('household recording remains but it does not produce game rewards', () => {
  const household = fs.readFileSync(path.join(root, 'kakeibo.html'), 'utf8');
  assert.doesNotMatch(household, /function\s+pgMark\s*\(/);
  assert.doesNotMatch(household, /(?:localStorage|sessionStorage)\.setItem\(\s*['"]pg_kakeibo_day['"]/);
  for (const name of ['saveData', 'saveDayData', 'addDayRecord']) {
    assert.match(household, new RegExp('function\\s+' + name + '\\s*\\('), name + ' retained');
  }
});

test('first open loads core then UI once and shares concurrent open requests', async () => {
  const f = loaderFixture();
  assert.equal(f.scripts.length, 0); assert.equal(f.mounts, 0);
  const first = f.window.openPetTab(), second = f.window.openPetTab();
  assert.equal(first, second);
  assert.equal(f.pane.hidden, false); assert.equal(f.scripts.length, 1);
  assert.match(f.scripts[0].src, /pet-game-core\.js/);
  f.coreLoaded(); await flush();
  assert.equal(f.scripts.length, 2); assert.match(f.scripts[1].src, /pet-lilac-motion\.js/);
  f.motionLoaded(); await flush();
  assert.equal(f.scripts.length, 3); assert.match(f.scripts[2].src, /pet-room-behavior\.js/);
  f.roomLoaded(); await flush();
  assert.equal(f.scripts.length, 4); assert.match(f.scripts[3].src, /pet-game\.js/);
  f.uiLoaded(); assert.equal(await first, true);
  assert.equal(f.mounts, 1); assert.equal(f.received.target, f.host);
  assert.equal(await f.window.openPetTab(), true);
  assert.equal(f.mounts, 1, 'already-visible game is not rebuilt during an active minigame');
  f.window.closePetTab(); assert.equal(f.pane.hidden, true); assert.equal(f.focus.focused, true);
  assert.equal(await f.window.openPetTab(), true);
  assert.equal(f.scripts.length, 4); assert.equal(f.mounts, 2, 'UI owns idempotent store reuse');
});

test('mount waits for protected hydration and storage adapter awaits durable writes', async () => {
  const hydration = deferred(), write = deferred(), calls = [];
  const f = loaderFixture({
    preloaded: true, gate: hydration.promise,
    persist: (key, value) => { calls.push([key, value]); return write.promise; },
    read: key => key === 'pet_game_v3' ? Promise.resolve('saved') : 'legacy'
  });
  const opening = f.window.openPetTab(); await flush();
  assert.equal(f.mounts, 0);
  hydration.resolve(true); assert.equal(await opening, true);
  const { storage, legacy } = f.received.config;
  assert.equal(await storage.getItem('pet_game_v3'), 'saved');
  assert.equal(legacy.getItem('pg_exp'), 'legacy');
  assert.throws(() => storage.getItem('tk_name'), /Unsupported game setting/);
  let settled = false;
  const saving = storage.setItem('pet_game_v3', '{"version":3}').then(() => { settled = true; });
  await flush(); assert.equal(settled, false); assert.deepEqual(calls, [['pet_game_v3', '{"version":3}']]);
  write.resolve(); await saving; assert.equal(settled, true);
  await assert.rejects(storage.setItem('pg_exp', '0'), /Unsupported game setting/);
});

test('durable adapter rejects a failed persistence result and has no fallback path', async () => {
  const f = loaderFixture({ preloaded: true, persist: async () => ({ ok: false }) });
  await f.window.openPetTab();
  await assert.rejects(f.received.config.storage.setItem('pet_game_v3', '{}'), /Game storage unavailable/);
  const broken = loaderFixture({ preloaded: true });
  delete broken.window.__knReadGameStorage;
  assert.equal(await broken.window.openPetTab(), false); assert.equal(broken.mounts, 0);
  assert.match(broken.host.textContent, /ゲームを読み込めませんでした/);
});

test('failed script load allows retry without leaking raw failure or reloading core', async () => {
  const f = loaderFixture();
  const opening = f.window.openPetTab();
  f.coreLoaded(); await flush();
  f.motionLoaded(); await flush();
  f.roomLoaded(); await flush();
  f.scripts[3].onerror(new Error('do not display this synthetic raw detail'));
  assert.equal(await opening, false); assert.equal(f.mounts, 0);
  assert.doesNotMatch(f.host.textContent, /synthetic raw detail/);
  assert.match(f.host.textContent, /もう一度読み込む/);
  const retry = f.window.openPetTab();
  await flush();
  assert.equal(f.scripts.length, 5); assert.match(f.scripts[4].src, /pet-game\.js/);
  f.uiLoaded(); assert.equal(await retry, true);
});

test('optional motion download failure keeps the game and saved records available', async () => {
  const f = loaderFixture();
  const opening = f.window.openPetTab();
  f.coreLoaded(); await flush();
  assert.match(f.scripts[1].src, /pet-lilac-motion\.js/);
  f.scripts[1].onerror(new Error('private transport details must stay hidden'));
  await flush();
  assert.match(f.scripts[2].src, /pet-room-behavior\.js/);
  f.scripts[2].onerror(new Error('optional room behavior unavailable')); await flush();
  assert.match(f.scripts[3].src, /pet-game\.js/);
  f.uiLoaded(); assert.equal(await opening, true);
  assert.equal(f.mounts, 1);
  assert.doesNotMatch(f.host.textContent, /private transport details/);
});

test('closing before hydration prevents hidden mount; reopen and nav use one handler', async () => {
  const hydration = deferred();
  const f = loaderFixture({ preloaded: true, gate: hydration.promise });
  const opening = f.window.openPetTab(); f.window.closePetTab(false);
  hydration.resolve(true); assert.equal(await opening, false); assert.equal(f.mounts, 0);
  f.click('pet'); await flush(); assert.equal(f.mounts, 1); assert.equal(f.pane.hidden, false);
  f.click('mypage'); assert.equal(f.pane.hidden, true); assert.ok(f.closes >= 2);
  assert.equal(f.focus.focused, undefined, 'other navigation does not steal focus');
  vm.runInContext(loader, f.context);
  assert.equal(f.listeners.document.click.length, 1);
  assert.equal(f.listeners.document.keydown.length, 1);
});

test('pending old mount does not close a newly reopened visible game', async () => {
  const mounting = deferred();
  const f = loaderFixture({ preloaded: true, mount: () => mounting.promise });
  const first = f.window.openPetTab(); await flush();
  f.window.closePetTab(false);
  const second = f.window.openPetTab(); await flush();
  const alreadyClosed = f.closes;
  mounting.resolve(true);
  assert.equal(await first, false); assert.equal(await second, true);
  assert.equal(f.pane.hidden, false); assert.equal(f.closes, alreadyClosed);
});

test('v3 persistence is encrypted and legacy progress is preserved', async () => {
  const f = gateFixture({ pg_exp: '45', sk_total: '8', pet_game: '{"coins":3}' });
  await f.window.__knGateReady;
  assert.ok(f.window.__knGate.whitelist.includes('pet_game_v3'));
  assert.equal(f.window.__knReadGameStorage('pg_exp'), '45');
  assert.equal(f.window.__knReadGameStorage('sk_total'), '8');
  assert.equal(f.window.__knReadGameStorage('pet_game'), '{"coins":3}');
  await f.window.__knPersistLocalSetting('pet_game_v3', '{"version":3,"coins":7}');
  assert.match(f.map.get('knenc:pet_game_v3'), /^knv1:/);
  assert.equal(f.map.has('pet_game_v3'), false);
  assert.equal(await f.window.__knReadGameStorage('pet_game_v3'), '{"version":3,"coins":7}');
  assert.equal(f.map.get('pg_exp'), '45');
  assert.ok(f.map.has('knenc:pet_game'));
  assert.throws(() => f.window.__knReadGameStorage('tk_name'), /Unsupported game setting/);
});

test('malformed encrypted legacy or v3 records fail closed instead of becoming new progress', async () => {
  const f = gateFixture({ 'knenc:pet_game': 'knv1:broken', 'knenc:pet_game_v3': 'knv1:broken' });
  await f.window.__knGateReady;
  assert.throws(() => f.window.__knReadGameStorage('pet_game'), /Game storage unavailable/);
  await assert.rejects(f.window.__knReadGameStorage('pet_game_v3'), /Game storage unavailable/);
  assert.equal(f.map.get('knenc:pet_game_v3'), 'knv1:broken');
});

test('v3 reads see another tab ciphertext update rather than stale gate cache', async () => {
  const first = gateFixture(); await first.window.__knGateReady;
  await first.window.__knPersistLocalSetting('pet_game_v3', 'first');
  assert.equal(first.storage.getItem('pet_game_v3'), 'first');
  const otherTab = gateFixture({}, {}, first.map); await otherTab.window.__knGateReady;
  await otherTab.window.__knPersistLocalSetting('pet_game_v3', 'second');
  assert.equal(first.storage.getItem('pet_game_v3'), 'first', 'synthetic cache is stale before fresh read');
  assert.equal(await first.window.__knReadGameStorage('pet_game_v3'), 'second');
  assert.equal(first.storage.getItem('pet_game_v3'), 'second');
});

test('quota write failure keeps previous ciphertext and cached progress', async () => {
  const controls = {}, f = gateFixture({}, controls); await f.window.__knGateReady;
  await f.window.__knPersistLocalSetting('pet_game_v3', 'kept');
  const ciphertext = f.map.get('knenc:pet_game_v3');
  controls.failWrite = 'knenc:pet_game_v3';
  await assert.rejects(f.window.__knPersistLocalSetting('pet_game_v3', 'lost'), /synthetic write failure/);
  assert.equal(f.map.get('knenc:pet_game_v3'), ciphertext);
  assert.equal(f.storage.getItem('pet_game_v3'), 'kept');
  assert.equal(await f.window.__knReadGameStorage('pet_game_v3'), 'kept');
});

test('v3 replacement during decrypt is rejected; unexpected plaintext is not trusted', async () => {
  const controls = {}, f = gateFixture({}, controls); await f.window.__knGateReady;
  await f.window.__knPersistLocalSetting('pet_game_v3', 'original');
  controls.onDecrypt = map => map.set('knenc:pet_game_v3', 'knv1:changed');
  await assert.rejects(f.window.__knReadGameStorage('pet_game_v3'), /Game storage unavailable/);
  assert.equal(f.storage.getItem('pet_game_v3'), 'original', 'failed fresh read does not replace cache');
  controls.onDecrypt = null; f.map.delete('knenc:pet_game_v3'); f.map.set('pet_game_v3', 'unprotected');
  await assert.rejects(f.window.__knReadGameStorage('pet_game_v3'), /Game storage unavailable/);
  f.map.delete('pet_game_v3');
  assert.equal(await f.window.__knReadGameStorage('pet_game_v3'), null);
  assert.equal(f.storage.getItem('pet_game_v3'), null);
});

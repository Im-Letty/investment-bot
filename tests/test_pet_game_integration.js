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
  removeAttribute(name) { delete this.attributes[name]; }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
  }
  focus() { this.focused = true; }
}

function loaderFixture(options = {}) {
  const pane = new Element('section'); pane.hidden = true;
  pane.roomEditing = false; pane.villageEditing = false; pane.shopEditing = false;
  pane.querySelector = selector => selector === '.ipg-room-editor' && pane.roomEditing || selector === '.ipg-village-editor' && pane.villageEditing || selector === '.ipg-shop-editor-actions' && pane.shopEditing ? {} : null;
  const host = new Element(), focus = new Element('button'), petButton = new Element('button');
  const scripts = [], styles = [], listeners = { document: {}, window: {} }, timers = new Map();
  let timerId = 0, mounts = 0, closes = 0, reloads = 0, recordCloses = 0, renders = 0, received;
  const enhancements = [];
  const record = { open: !!options.recordOpen, classList: { contains: () => record.open } };
  const ui = {
    mount: async function (target, config) {
      mounts++; received = { target, config };
      if (options.mount) return options.mount(target, config);
      target.textContent = 'Synthetic game'; return true;
    },
    close: async function () { closes++; },
    render() { renders++; },
    refreshVisuals(target) { enhancements.push(target); if (options.refresh) options.refresh(target); }
  };
  const document = {
    activeElement: focus,
    getElementById: id => id === 'sect-pet' ? pane : id === 'pet-game-root' ? host : id === 'mrOv' ? record : null,
    querySelector: () => petButton,
    createElement: tag => new Element(tag),
    addEventListener: (name, fn) => { (listeners.document[name] ||= []).push(fn); },
    head: { appendChild: asset => { if (asset.tagName === 'LINK') { styles.push(asset); if (!options.stylePending) asset.onload(); } else scripts.push(asset); } }
  };
  const window = {
    PetVillageEconomy: options.economyMissing ? undefined : {},
    PetShopLayout: options.layoutMissing ? undefined : {},
    PetTownWalk: options.townMissing ? undefined : {},
    PetRiverFishing: options.fishingMissing ? undefined : {},
    PetVillageEconomyScene: options.sceneMissing ? undefined : {mount(){}},
    PetCozyRoom: options.cozyMissing ? undefined : {mount(){}},
    __knGateReady: options.gate ?? Promise.resolve(true),
    __knReadGameStorage: options.read || (() => null),
    __knPersistLocalSetting: options.persist || (async () => undefined),
    addEventListener: (name, fn) => { (listeners.window[name] ||= []).push(fn); },
    location: { reload: () => { reloads++; } },
    mrClose: () => { record.open = false; recordCloses++; }
  };
  if (options.preloaded) { window.PetGameCore = {}; window.IndependentPetGame = ui; }
  const context = vm.createContext({
    window, document, Promise,
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id)
  });
  vm.runInContext(loader, context);
  return {
    window, document, pane, host, focus, petButton, scripts, styles, timers, listeners, ui, context, enhancements,
    get mounts() { return mounts; }, get closes() { return closes; }, get received() { return received; },
    get renders() { return renders; },
    get reloads() { return reloads; }, get recordCloses() { return recordCloses; }, record,
    asset(name) { return scripts.findLast(script => script.src.includes('/' + name + '.js?')); },
    economyLoaded() { window.PetVillageEconomy = {}; this.asset('pet-village-economy').onload(); },
    layoutLoaded() { window.PetShopLayout = {}; this.asset('pet-shop-layout').onload(); },
    townLoaded() { window.PetTownWalk = {}; this.asset('pet-town-walk').onload(); },
    sceneLoaded() { window.PetVillageEconomyScene = {mount(){}}; this.asset('pet-village-economy-scene').onload(); },
    fishingLoaded() { window.PetRiverFishing = {}; this.asset('pet-river-fishing').onload(); },
    coreLoaded() { window.PetGameCore = {}; this.asset('pet-game-core').onload(); },
    motionLoaded() { window.PetLilacMotion = {}; this.asset('pet-lilac-motion').onload(); },
    roomLoaded() { window.PetRoomBehavior = {}; this.asset('pet-room-behavior').onload(); },
    cozyLoaded() { window.PetCozyRoom = {mount(){}}; this.asset('pet-cozy-room').onload(); },
    uiLoaded() { window.IndependentPetGame = ui; this.asset('pet-game').onload(); },
    fireTimers(delay) {
      const pending = Array.from(timers).filter(([, timer]) => timer.delay === delay);
      for (const [id, timer] of pending) { timers.delete(id); timer.fn(); }
      return pending.length;
    },
    retryButton() { return host.children[0].children.find(child => child.tagName === 'BUTTON'); },
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
  const petSection = html.match(/<section id="sect-pet"[\s\S]*?<\/section>/)?.[0];
  assert.equal((html.match(/id="skBanner"/g) || []).length, 1, 'one existing banner owns the check-in display');
  assert.match(petSection, /class="ipg-shell-content"[\s\S]*?class="ipg-check-in"[\s\S]*?id="skBanner"[\s\S]*?<\/div><\/div>\s*<div id="pet-game-root">/,
    'check-in shares the game scroller but stays outside the replaceable loading/render root');
  assert.match(petSection, /id="skBanner"[^>]*role="button"[^>]*tabindex="0"[^>]*onclick="openMyRecord\(\)"/);
  assert.match(html, /\.ipg-shell-content\{[^}]*overflow:auto/);
  assert.match(html, /body:has\(#sect-pet:not\(\[hidden\]\)\)\s+#mrOv\{z-index:100002\}/,
    'record overlay opens in front of the game and its navigation');
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

test('UI downloads in parallel and required readiness opens without optional visuals; concurrent opens share work', async () => {
  const f = loaderFixture();
  assert.equal(f.scripts.length, 0); assert.equal(f.mounts, 0);
  const first = f.window.openPetTab(), second = f.window.openPetTab();
  assert.equal(first, second);
  assert.equal(f.pane.hidden, true, 'do not show the old check-in/loading screen'); assert.equal(f.scripts.length, 4);
  assert.equal(f.petButton.getAttribute('aria-busy'), 'true');
  assert.doesNotMatch(f.host.textContent, /ゲームを読み込んでいます/);
  assert.match(f.scripts[0].src, /pet-game-core\.js/);
  assert.match(f.scripts[1].src, /pet-game\.js/);
  assert.match(f.scripts[2].src, /pet-lilac-motion\.js/);
  assert.match(f.scripts[3].src, /pet-room-behavior\.js/);
  f.coreLoaded(); await flush();
  assert.equal(f.scripts.length, 4); assert.ok(f.asset('pet-game'));
  f.uiLoaded(); assert.equal(await first, true);
  assert.equal(f.mounts, 1, 'usable UI does not wait for optional visuals');
  f.motionLoaded(); f.roomLoaded();
  assert.deepEqual(f.enhancements, [f.host, f.host]); assert.equal(f.renders, 1, 'late visuals do not rebuild the visible UI');
  assert.equal(f.mounts, 1); assert.equal(f.received.target, f.host);
  assert.equal(f.pane.hidden, false); assert.equal(f.petButton.getAttribute('aria-busy'), null);
  assert.equal(await f.window.openPetTab(), true);
  assert.equal(f.mounts, 1, 'already-visible game is not rebuilt during normal use');
  f.window.closePetTab(); assert.equal(f.pane.hidden, true); assert.equal(f.focus.focused, true);
  assert.equal(await f.window.openPetTab(), true);
  assert.equal(f.scripts.length, 4); assert.equal(f.mounts, 2, 'UI owns idempotent store reuse');
});

test('a visual-only frame helper is not a boot dependency of the usable game', async () => {
  const f=loaderFixture();const first=f.window.openPetTab();f.coreLoaded();f.uiLoaded();
  assert.equal(await first,true);assert.equal(f.mounts,1);assert.equal(f.window.PetFrameFit,undefined);
  assert.equal(f.asset('pet-frame-fit'),undefined,'only lazy world renderers request the shared frame helper');
});

test('a cold entry loads the economy before core and the walking engine before its scene without showing a pending page', async () => {
  const f=loaderFixture({economyMissing:true,townMissing:true,sceneMissing:true}),opening=f.window.openPetTab();
  assert.equal(f.asset('pet-game-core'),undefined);assert.equal(f.asset('pet-village-economy-scene'),undefined);
  assert.ok(f.asset('pet-village-economy'));assert.ok(f.asset('pet-town-walk'));
  assert.ok(f.asset('pet-game')); f.uiLoaded(); await flush();
  assert.equal(f.mounts,0,'UI registration alone cannot create a game before core/economy');
  assert.equal(f.pane.hidden,true);assert.equal(f.mounts,0);
  f.townLoaded();await flush();assert.ok(f.asset('pet-village-economy-scene'));assert.equal(f.mounts,0);
  f.economyLoaded();await flush();assert.ok(f.asset('pet-game-core'));assert.equal(f.mounts,0);
  f.coreLoaded();await flush();assert.equal(f.mounts,0,'scene remains a required entry point');
  f.sceneLoaded();assert.equal(await opening,true);assert.equal(f.mounts,1);
  f.motionLoaded();f.roomLoaded();
  f.window.closePetTab();await f.window.openPetTab();
  for(const name of ['pet-village-economy','pet-game-core','pet-town-walk','pet-village-economy-scene'])assert.equal(f.scripts.filter(s=>s.src.includes('/'+name+'.js?')).length,1,name+' is shared across reopening');
});

test('both lightweight core dependencies must finish before core executes and are shared across concurrent opens and reopen', async () => {
  const f = loaderFixture({ economyMissing: true, layoutMissing: true }), first = f.window.openPetTab(), second = f.window.openPetTab();
  assert.equal(first, second); assert.equal(f.asset('pet-game-core'), undefined);
  assert.ok(f.asset('pet-village-economy')); assert.ok(f.asset('pet-shop-layout'));
  f.uiLoaded(); f.economyLoaded(); await flush();
  assert.equal(f.asset('pet-game-core'), undefined, 'economy alone cannot execute a factory without its layout dependency');
  assert.equal(f.mounts, 0); assert.equal(f.pane.hidden, true);
  f.layoutLoaded(); await flush(); assert.ok(f.asset('pet-game-core')); assert.equal(f.mounts, 0);
  f.coreLoaded(); assert.equal(await first, true); assert.equal(f.mounts, 1);
  assert.equal(f.scripts.some(s => /pet-shop-interior|\/vendor\/three/.test(s.src)), false, 'the lightweight model does not preload the interior renderer');
  f.window.closePetTab(); assert.equal(await f.window.openPetTab(), true);
  for (const name of ['pet-shop-layout', 'pet-village-economy', 'pet-game-core']) assert.equal(f.scripts.filter(s => s.src.includes('/' + name + '.js?')).length, 1);
  assert.equal(f.styles.length, 1); assert.equal(f.styles[0].href, '/static/pet-shop-entry.css?v=20261025-shop1');
});

test('a failed layout dependency never executes core and uses the same bounded retry and recoverable boot error', async () => {
  const f = loaderFixture({ layoutMissing: true }), opening = f.window.openPetTab();
  f.uiLoaded(); f.asset('pet-shop-layout').onerror(); await flush();
  assert.equal(f.asset('pet-game-core'), undefined); assert.equal(f.scripts.filter(s => s.src.includes('/pet-shop-layout.js?')).length, 1);
  f.fireTimers(1200); await flush(); assert.equal(f.scripts.filter(s => s.src.includes('/pet-shop-layout.js?')).length, 2);
  f.asset('pet-shop-layout').onerror(); assert.equal(await opening, false);
  assert.equal(f.mounts, 0); assert.equal(f.asset('pet-game-core'), undefined); assert.match(f.host.textContent, /もう一度読み込む/);
});

test('entry styles gate the first usable game, stay shared through cancellation, and do not load interior art', async () => {
  const f = loaderFixture({ preloaded: true, stylePending: true }), first = f.window.openPetTab(); await flush();
  assert.equal(f.styles.length, 1); assert.equal(f.styles[0].rel, 'stylesheet'); assert.equal(f.mounts, 0); assert.equal(f.pane.hidden, true);
  f.window.closePetTab(false); const second = f.window.openPetTab(); await flush(); assert.equal(f.styles.length, 1);
  f.styles[0].onload(); assert.equal(await first, false); assert.equal(await second, true); assert.equal(f.mounts, 1);
  assert.equal(f.styles.some(style => /pet-shop-interior/.test(style.href)), false);
  f.window.closePetTab(); assert.equal(await f.window.openPetTab(), true); assert.equal(f.styles.length, 1);
});

test('entry stylesheet errors permit one retry then show the normal boot error without mounting', async () => {
  const f = loaderFixture({ preloaded: true, stylePending: true }), opening = f.window.openPetTab();
  f.styles[0].onerror(); await flush(); assert.equal(f.styles.length, 1); assert.equal(f.mounts, 0);
  f.fireTimers(1200); await flush(); assert.equal(f.styles.length, 2);
  assert.equal(f.styles[1].href, f.styles[0].href); f.styles[1].onerror(); assert.equal(await opening, false);
  assert.equal(f.mounts, 0); assert.match(f.host.textContent, /もう一度読み込む/);
});

test('an economy or scene download failure preserves the previous page and cannot execute dependent modules', async () => {
  for(const missing of ['economy','scene']){
    const f=loaderFixture({economyMissing:missing==='economy',sceneMissing:missing==='scene'}),opening=f.window.openPetTab();
    f.uiLoaded(); await flush(); assert.equal(f.mounts,0);
    const name=missing==='economy'?'pet-village-economy':'pet-village-economy-scene';
    f.asset(name).onerror();await flush();f.fireTimers(1200);await flush();f.asset(name).onerror();
    assert.equal(await opening,false);assert.equal(f.mounts,0);assert.ok(f.asset('pet-game'));
    if(missing==='economy')assert.equal(f.asset('pet-game-core'),undefined);
    assert.match(f.host.textContent,/もう一度読み込む/);
  }
});

test('room presentation loads once before mounting without downloading the heavy 3D vendor at game entry', async () => {
  const f=loaderFixture({cozyMissing:true}),opening=f.window.openPetTab();
  assert.equal(f.scripts.length,5);f.uiLoaded();f.coreLoaded();f.motionLoaded();f.roomLoaded();await flush();
  assert.equal(f.mounts,0,'UI may arrive first but mounting waits for the room entry point');
  assert.equal(f.scripts.filter(s=>s.src.includes('pet-cozy-room')).length,1);
  assert.equal(f.scripts.some(s=>s.src.includes('/vendor/three')),false,'Three stays lazy until the actual room opens');
  f.cozyLoaded();assert.equal(await opening,true);assert.equal(f.mounts,1);
});

test('a missing room presentation reports the existing recoverable load error without entering an obsolete editor', async () => {
  const f=loaderFixture({cozyMissing:true}),opening=f.window.openPetTab();
  f.uiLoaded();f.coreLoaded();f.motionLoaded();f.roomLoaded();await flush();
  f.asset('pet-cozy-room').onerror();await flush();f.fireTimers(1200);await flush();
  f.asset('pet-cozy-room').onerror();assert.equal(await opening,false);assert.equal(f.mounts,0);
  assert.match(f.host.textContent,/もう一度読み込む/);assert.equal(f.scripts.filter(s=>s.src.includes('/pet-game.js?')).length,1);
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

test('a download error retries once, then offers manual retry without reloading core or leaking details', async () => {
  const f = loaderFixture();
  const opening = f.window.openPetTab();
  f.coreLoaded(); await flush();
  f.motionLoaded(); await flush();
  f.roomLoaded(); await flush();
  const initialUI = f.asset('pet-game'); initialUI.onerror(new Error('do not display this synthetic raw detail'));
  await flush(); assert.equal(f.mounts, 0); assert.equal(f.scripts.length, 4);
  assert.equal(f.fireTimers(1200), 1); await flush();
  assert.equal(f.scripts.length, 5); assert.equal(f.asset('pet-game').src, initialUI.src);
  f.scripts[4].onerror(new Error('second failure'));
  assert.equal(await opening, false); assert.equal(f.mounts, 0);
  assert.equal(f.fireTimers(1200), 0, 'automatic retry stops after one additional request');
  assert.doesNotMatch(f.host.textContent, /synthetic raw detail/);
  assert.match(f.host.textContent, /もう一度読み込む/);
  const retry = f.window.openPetTab();
  await flush();
  assert.equal(f.scripts.length, 6); assert.match(f.scripts[5].src, /pet-game\.js/);
  f.uiLoaded(); assert.equal(await retry, true);
});

test('a transient core download failure recovers automatically at the same URL', async () => {
  const f = loaderFixture(), opening = f.window.openPetTab();
  const original = f.asset('pet-game-core');
  original.onerror(); f.motionLoaded(); f.roomLoaded(); await flush();
  assert.equal(f.fireTimers(1200), 1); await flush();
  assert.notEqual(f.asset('pet-game-core'), original);
  assert.equal(f.asset('pet-game-core').src, original.src);
  f.coreLoaded(); await flush(); f.uiLoaded();
  assert.equal(await opening, true); assert.equal(f.mounts, 1);
  assert.equal(f.scripts.length, 5); assert.equal(f.reloads, 0);
});

test('a slow core is shared on manual retry and may finish late without duplicate execution', async () => {
  const f = loaderFixture(), first = f.window.openPetTab();
  f.uiLoaded(); f.motionLoaded(); f.roomLoaded();
  assert.equal(f.fireTimers(15000), 1); assert.equal(await first, false);
  const original = f.asset('pet-game-core'), second = f.window.openPetTab();
  assert.equal(f.scripts.length, 4); assert.equal(f.fireTimers(1200), 0);
  assert.equal(f.asset('pet-game-core'), original);
  f.coreLoaded(); await flush();
  assert.equal(await second, true); assert.equal(f.mounts, 1);
  assert.equal(f.scripts.filter(script => script.src === original.src).length, 1);
});

test('a slow UI is retained on retry and ready globals at timeout do not trigger reinjection', async () => {
  const f = loaderFixture(), first = f.window.openPetTab();
  f.coreLoaded(); f.motionLoaded(); f.roomLoaded(); await flush();
  const original = f.asset('pet-game');
  assert.equal(f.fireTimers(15000), 1); assert.equal(await first, false);
  const second = f.window.openPetTab(); await flush();
  assert.equal(f.scripts.length, 4); assert.equal(f.asset('pet-game'), original);
  f.window.IndependentPetGame = f.ui;
  assert.equal(f.fireTimers(15000), 1); assert.equal(await second, true);
  original.onload(); await flush(); assert.equal(f.mounts, 1); assert.equal(f.scripts.length, 4);
});

test('partially executed UI is never reinjected and explicit page reload preserves saved storage', async () => {
  const writes = [], f = loaderFixture({ persist: (...args) => writes.push(args) });
  const first = f.window.openPetTab();
  f.coreLoaded(); f.motionLoaded(); f.roomLoaded(); await flush();
  f.asset('pet-game').onload(); assert.equal(await first, false);
  assert.match(f.host.textContent, /ページを読み直す/); assert.equal(f.fireTimers(1200), 0);
  assert.equal(await f.window.openPetTab(), false); assert.equal(f.scripts.length, 4);
  assert.equal(f.reloads, 0); f.retryButton().onclick();
  assert.equal(f.reloads, 1); assert.equal(f.mounts, 0); assert.deepEqual(writes, []);
});

test('late invalid UI after timeout moves the shared retry to explicit page reload', async () => {
  const f = loaderFixture(), first = f.window.openPetTab();
  f.coreLoaded(); f.motionLoaded(); f.roomLoaded(); await flush();
  f.fireTimers(15000); assert.equal(await first, false);
  const second = f.window.openPetTab(); await flush();
  f.asset('pet-game').onload(); assert.equal(await second, false);
  assert.equal(f.scripts.length, 4); assert.equal(f.mounts, 0);
  assert.match(f.host.textContent, /ページを読み直す/);
  f.retryButton().onclick(); assert.equal(f.reloads, 1);
});

test('close and reopen during downloads share scripts and only mount the current generation', async () => {
  const f = loaderFixture(), first = f.window.openPetTab();
  f.window.closePetTab(false); const second = f.window.openPetTab();
  assert.equal(f.scripts.length, 4);
  f.coreLoaded(); f.motionLoaded(); f.roomLoaded(); await flush(); f.uiLoaded();
  assert.equal(await first, false); assert.equal(await second, true);
  assert.equal(f.scripts.length, 4); assert.equal(f.mounts, 1); assert.equal(f.pane.hidden, false);
});

test('optional timeouts do not delay display and real late loads enhance the current host once', async () => {
  const f = loaderFixture(), opening = f.window.openPetTab();
  assert.equal(Array.from(f.timers.values()).filter(timer => timer.delay === 5000).length, 2);
  f.coreLoaded(); await flush(); f.uiLoaded(); await flush();
  assert.equal(f.scripts.length, 4); assert.equal(await opening, true); assert.equal(f.mounts, 1);
  assert.equal(f.enhancements.length, 0); assert.equal(f.fireTimers(5000), 2);
  assert.equal(f.mounts, 1); assert.equal(f.fireTimers(1200), 0);
  f.motionLoaded(); f.roomLoaded(); await flush();
  assert.deepEqual(f.enhancements, [f.host, f.host]); assert.equal(f.renders, 1);
  f.asset('pet-lilac-motion').onload(); f.asset('pet-room-behavior').onload();
  assert.equal(f.enhancements.length, 2, 'duplicate load delivery cannot create duplicate controllers');
  assert.equal(f.scripts.length, 4, 'timeouts never inject another optional script');
});

test('late optional loads cannot enhance a closed visit and reopening shares only the current host', async () => {
  const f = loaderFixture(), opening = f.window.openPetTab();
  f.coreLoaded(); await flush(); f.uiLoaded(); assert.equal(await opening, true);
  f.window.closePetTab(false); f.fireTimers(5000); f.motionLoaded(); await flush();
  assert.equal(f.enhancements.length, 0); assert.equal(f.pane.hidden, true); assert.equal(f.mounts, 1);
  assert.equal(await f.window.openPetTab(), true); f.roomLoaded();
  assert.deepEqual(f.enhancements, [f.host]); assert.equal(f.mounts, 2); assert.equal(f.renders, 2);
  assert.equal(f.scripts.length, 4);
});

test('an optional load before hydration cannot bypass the storage gate or create an enhancement', async () => {
  const hydration = deferred(), f = loaderFixture({gate: hydration.promise}), opening = f.window.openPetTab();
  f.coreLoaded(); await flush(); f.uiLoaded(); f.motionLoaded(); f.roomLoaded(); await flush();
  assert.equal(f.mounts, 0); assert.equal(f.enhancements.length, 0); assert.equal(f.pane.hidden, true);
  hydration.resolve(true); assert.equal(await opening, true); assert.equal(f.mounts, 1);
});

test('an invalid optional module or a failing enhancement cannot replace the usable game', async () => {
  const f = loaderFixture({refresh() { throw new Error('private visual detail'); }}), opening = f.window.openPetTab();
  f.coreLoaded(); await flush(); f.uiLoaded(); assert.equal(await opening, true);
  f.asset('pet-room-behavior').onload();
  assert.equal(f.enhancements.length, 0, 'missing globals are not enhanced');
  assert.doesNotThrow(() => f.motionLoaded());
  assert.equal(f.host.textContent, 'Synthetic game'); assert.equal(f.pane.hidden, false); assert.equal(f.mounts, 1);
});

test('a rejected protected-storage gate fails closed and offers explicit page reload', async () => {
  const hydration = deferred(), writes = [];
  const f = loaderFixture({ preloaded: true, gate: hydration.promise, persist: (...args) => writes.push(args) });
  const opening = f.window.openPetTab(); hydration.reject(new Error('private storage detail'));
  assert.equal(await opening, false); assert.equal(f.mounts, 0); assert.deepEqual(writes, []);
  assert.doesNotMatch(f.host.textContent, /private storage detail/);
  assert.match(f.host.textContent, /ページを読み直す/); assert.equal(f.reloads, 0);
  f.retryButton().onclick(); assert.equal(f.reloads, 1);
});

test('optional motion download failure keeps the game and saved records available', async () => {
  const f = loaderFixture();
  const opening = f.window.openPetTab();
  f.coreLoaded(); await flush();
  assert.match(f.asset('pet-lilac-motion').src, /pet-lilac-motion\.js/);
  f.asset('pet-lilac-motion').onerror(new Error('private transport details must stay hidden'));
  await flush();
  assert.match(f.asset('pet-room-behavior').src, /pet-room-behavior\.js/);
  f.asset('pet-room-behavior').onerror(new Error('optional room behavior unavailable')); await flush();
  assert.ok(f.asset('pet-game'));
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

test('Escape closes the check-in record first and returns to the same game without remounting', async () => {
  const f = loaderFixture({ preloaded: true, recordOpen: true });
  assert.equal(await f.window.openPetTab(), true);
  for (const listener of f.listeners.document.keydown) listener({ key: 'Escape' });
  assert.equal(f.record.open, false); assert.equal(f.recordCloses, 1);
  assert.equal(f.pane.hidden, false); assert.equal(f.mounts, 1); assert.equal(f.closes, 0);
  for (const listener of f.listeners.document.keydown) listener({ key: 'Escape' });
  assert.equal(f.pane.hidden, true); assert.equal(f.closes, 1);
});

test('leaving the game closes the record overlay so it cannot remain over another route', async () => {
  const f = loaderFixture({ preloaded: true, recordOpen: true });
  await f.window.openPetTab(); f.click('mypage');
  assert.equal(f.pane.hidden, true); assert.equal(f.record.open, false); assert.equal(f.recordCloses, 1);
  assert.equal(await f.window.openPetTab(), true); assert.equal(f.record.open, false);
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


test('the outer loader leaves Escape to room editing and resumes normal closing after the editor ends', async () => {
  const f = loaderFixture({ preloaded: true });
  await f.window.openPetTab(); f.pane.roomEditing = true;
  for (const listener of f.listeners.document.keydown) listener({ key: 'Escape' });
  assert.equal(f.pane.hidden, false); assert.equal(f.closes, 0); assert.equal(f.mounts, 1);
  f.pane.roomEditing = false;
  for (const listener of f.listeners.document.keydown) listener({ key: 'Escape' });
  assert.equal(f.pane.hidden, true); assert.equal(f.closes, 1); assert.equal(f.mounts, 1);
});

test('the outer loader also protects village arrangement from Escape until the editor ends', async () => {
  const f = loaderFixture({ preloaded: true });
  await f.window.openPetTab(); f.pane.villageEditing = true;
  for (const listener of f.listeners.document.keydown) listener({ key: 'Escape' });
  assert.equal(f.pane.hidden, false); assert.equal(f.closes, 0); assert.equal(f.mounts, 1);
  f.pane.villageEditing = false;
  for (const listener of f.listeners.document.keydown) listener({ key: 'Escape' });
  assert.equal(f.pane.hidden, true); assert.equal(f.closes, 1); assert.equal(f.mounts, 1);
});

test('the outer loader leaves Escape to the shop editor until the draft is saved or cancelled', async () => {
  const f = loaderFixture({ preloaded: true }); assert.equal(await f.window.openPetTab(), true);
  f.pane.shopEditing = true;
  for (const listener of f.listeners.document.keydown) listener({ key: 'Escape' });
  assert.equal(f.pane.hidden, false); assert.equal(f.closes, 0); assert.equal(f.mounts, 1);
  f.pane.shopEditing = false;
  for (const listener of f.listeners.document.keydown) listener({ key: 'Escape' });
  assert.equal(f.pane.hidden, true); assert.equal(f.closes, 1); assert.equal(f.mounts, 1);
});

test('main game does not load a removed minigame runtime and updates only changed game asset revisions',()=>{
  assert.doesNotMatch(html,/<script\b[^>]*src=["'][^"']*pet-cafe\.js/);
  assert.equal(fs.existsSync(path.join(root,'static/pet-cafe.js')),false);
  for(const asset of ['pet-village.css']){
    assert.ok(html.includes('/static/'+asset+'?v=20261027-mobile-framing1'),asset);
  }
  for(const asset of ['pet-village-economy.js','pet-village-economy-scene.js','pet-village-economy-scene.css'])assert.ok(html.includes('/static/'+asset+'?v=20261024-village-economy1'),asset);
  assert.ok(html.includes('/static/pet-game.css?v=20261028-market-art1'),'market artwork layout pin');
  for(const asset of ['pet-shop-layout.js','pet-shop-entry.css'])assert.ok(html.includes('/static/'+asset+'?v=20261025-shop1'),asset);
  assert.ok(html.includes('/static/pet-town-walk.js?v=20261028-fountain-reference1'),'shared physical shape walk pin');
  assert.ok(html.includes('/static/pet-town-walk.css?v=20261027-mobile-framing1'),'unchanged viewport clipping CSS pin');
  for(const asset of ['pet-cozy-room.js','pet-home-interior.css'])assert.ok(html.includes('/static/'+asset+'?v=20261025-life1'),asset+' village-life pin');
  assert.ok(html.includes('/static/pet-game-core.js?v=20261025-fishing1'));assert.ok(html.includes('/static/pet-village-life.css?v=20261027-mobile-framing1'));
  assert.ok(html.includes('/static/pet-game.js?v=20261028-tree-family1'),'integrated manual-control UI retains fit1 renderer contract');
  assert.equal(loader.includes('/static/pet-frame-fit.js?'),false,'visual-only frame contract stays out of game boot');
  assert.ok(html.includes('/static/pet-lilac-motion.js?v=20261028-gentle-walk1'),'gentle walking face renderer pin is current');
  assert.ok(html.includes('/static/pet-cozy-room.css?v=20261024-cozy-room1'),'unchanged room asset pin is preserved');
});

test('fishing is a required lightweight dependency after walking and before core, shared across cold concurrent opens',async()=>{
 const f=loaderFixture({townMissing:true,fishingMissing:true}),a=f.window.openPetTab(),b=f.window.openPetTab();
 assert.equal(a,b);assert.equal(f.asset('pet-river-fishing'),undefined);assert.equal(f.asset('pet-game-core'),undefined);f.uiLoaded();
 f.townLoaded();await flush();assert.ok(f.asset('pet-river-fishing'));assert.equal(f.asset('pet-game-core'),undefined);
 f.fishingLoaded();await flush();assert.ok(f.asset('pet-game-core'));f.coreLoaded();assert.equal(await a,true);assert.equal(f.mounts,1);
 assert.equal(f.scripts.filter(x=>x.src.includes('/pet-river-fishing.js?')).length,1);
});

test('resize repair refreshes only the three borrowed-frame consumer cache revisions, leaving source art/rig/core pins untouched',()=>{
 const game=fs.readFileSync(path.join(root,'static/pet-game.js'),'utf8');
 for(const name of ['pet-home-interior.js','pet-shop-interior.js'])assert.ok(game.includes('/static/'+name+'?v=20261025-resize1'),name);
 assert.ok(game.includes('/static/pet-town-scene.js?v=20261028-tree-family1'));
 assert.ok(html.includes('/static/pet-game-core.js?v=20261025-fishing1'));assert.ok(html.includes('/static/pet-lilac-motion.js?v=20261028-gentle-walk1'));
 assert.equal(loader.includes('/static/pet-frame-fit.js?'),false);
});

test('Japanese season resolver loads with Town only and refreshes the game entry without changing saved-core or interior pins',()=>{
 const game=fs.readFileSync(path.join(root,'static/pet-game.js'),'utf8'),town=fs.readFileSync(path.join(root,'static/pet-town-scene.js'),'utf8');
 assert.ok(loader.includes('/static/pet-game.js?v=20261028-tree-family1'));
 assert.equal(loader.includes('pet-japan-seasons.js'),false,'the calendar does not add an eager startup resource');
 assert.ok(town.includes("import('/static/pet-japan-seasons.js?v=20261026-shop-cottage-match2')"));
 assert.ok(town.includes("loadFrameFit(), loadSeasons()"));
 assert.ok(game.includes('/static/pet-town-scene.js?v=20261028-tree-family1'));
 for(const name of ['pet-home-interior.js','pet-shop-interior.js'])assert.ok(game.includes('/static/'+name+'?v=20261025-resize1'));
 assert.ok(loader.includes('/static/pet-game-core.js?v=20261025-fishing1'));
});

test('bounded village detailing is lazy with Town while the deployed calendar, frame contract and indoors retain their revisions',()=>{
 const game=fs.readFileSync(path.join(root,'static/pet-game.js'),'utf8'),town=fs.readFileSync(path.join(root,'static/pet-town-scene.js'),'utf8');
 assert.ok(loader.includes('/static/pet-game.js?v=20261028-tree-family1'));assert.equal(loader.includes('pet-town-style.js'),false);
 assert.ok(game.includes('/static/pet-town-scene.js?v=20261028-tree-family1'));assert.ok(town.includes("import('/static/pet-town-style.js?v=20261027-layout-art3d1')"));
 assert.ok(town.includes("loadSeasons(), loadStyle()"));assert.ok(town.includes("/static/pet-japan-seasons.js?v=20261026-shop-cottage-match2"));
 assert.ok(town.includes("/static/pet-frame-fit.js?v=20261025-fit1"));
 for(const name of ['pet-home-interior.js','pet-shop-interior.js'])assert.ok(game.includes('/static/'+name+'?v=20261025-resize1'));
});

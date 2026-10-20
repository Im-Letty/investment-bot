'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../static/pet-game-core.js');
const Motion = require('../static/pet-lilac-motion.js');
const source = fs.readFileSync(require.resolve('../static/pet-game.js'), 'utf8');

const copy = value => JSON.parse(JSON.stringify(value));
async function flush() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
function events(target) {
  const listeners = new Map();
  target.addEventListener = (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); };
  target.removeEventListener = (name, fn) => listeners.get(name)?.delete(fn);
  target.emit = (name, values = {}) => {
    const event = { target, cancelable: true, preventDefault() {}, ...values };
    [...(listeners.get(name) || [])].forEach(fn => fn(event));
  };
  return target;
}
class Element {
  constructor(tag, document) {
    events(this); this.tagName = tag.toUpperCase(); this.ownerDocument = document;
    this.children = []; this.parentNode = null; this.dataset = {}; this.style = {};
    this.attributes = {}; this.className = ''; this._text = ''; this.hidden = false; this.disabled = false; this.value = '';
  }
  get isConnected() { return this === this.ownerDocument.body || !!this.parentNode?.isConnected; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
  replaceChildren(...children) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; this._text = ''; children.forEach(child => this.appendChild(child)); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  focus() { this.ownerDocument.activeElement = this; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 300 }; }
  matches(selector) {
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    const focus = /^\[data-focus-key="([^"]+)"\]$/.exec(selector);
    return focus ? this.dataset.focusKey === focus[1] : this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    const selectors = selector.split(','), result = [];
    const visit = node => node.children.forEach(child => { if (selectors.some(s => child.matches(s.trim()))) result.push(child); visit(child); });
    visit(this); return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

// Only drawing is stubbed. All durable actions and action-to-cue mapping use the
// shipped modules, with the same asynchronous storage boundary as the product.
async function fixture(config = {}) {
  let clock = new Date(2026, 9, 21, 12).getTime(), sequence = 0, store;
  const data = new Map(Object.entries({ pg_exp: '30', pg_coins: '500', pg_name: 'もとの子', pg_path: 'cool', pg_px: '1',
    pg_items: '{"rice":2}', pg_ach: '["old-ach"]', ...(config.seed || {}) }));
  const writes = [], control = { outcome: 'ok', pending: null };
  const storage = {
    getItem: key => data.has(key) ? data.get(key) : null,
    async setItem(key, value) {
      if (control.pending) await control.pending.promise;
      if (control.outcome === 'throw') throw new Error('private storage failure');
      if (control.outcome === 'false') return false;
      data.set(key, value); writes.push([key, value]);
    }
  };
  const coreOptions = { storage, now: () => clock, random: () => .5 };
  const setup = Core.create(coreOptions); assert.equal((await setup.ready).ok, true);
  if (config.species) assert.equal((await setup.dispatch({ type: 'chooseSpecies', species: config.species })).ok, true);
  const document = events({ hidden: !!config.hidden, activeElement: null });
  document.createElement = tag => new Element(tag, document);
  document.body = new Element('body', document);
  const pane = document.createElement('section'), host = document.createElement('div');
  pane.hidden = !!config.paneHidden; document.body.appendChild(pane); pane.appendChild(host);
  document.getElementById = id => id === 'sect-pet' ? pane : id === 'pet-game-root' ? host : null;
  const raf = new Map(), intervals = new Map(), mounts = [], actionCues = [];
  const rendererControl = { mode: config.rendererMode || 'pending', mappingThrows: false };
  const renderer = {
    durations: Motion.durations,
    situationForAction(action, before, after, result) {
      if (rendererControl.mappingThrows) throw new Error('private renderer failure');
      const cue = Motion.situationForAction(action, before, after, result);
      actionCues.push({ action: copy(action), cue: copy(cue), result: result.ok });
      return cue;
    },
    mount(canvas, options) {
      const controller = { canvas, options, destroyed: false, changes: [], destroy() { this.destroyed = true; },
        setSituation(name, detail) { this.changes.push({ name, ...(detail == null ? {} : copy(detail)) }); } };
      mounts.push(controller);
      if (rendererControl.mode === 'throw') throw new Error('private GPU failure');
      if (rendererControl.mode === 'ready') options.onReady();
      if (rendererControl.mode === 'error') options.onError('unavailable');
      return controller;
    }
  };
  const window = events({ document, PetLilacMotion: renderer, confirm: () => true,
    PetGameCore: { ...Core, create(opts) { store = Core.create(opts); return store; } },
    requestAnimationFrame(fn) { const id = ++sequence; raf.set(id, fn); return id; },
    cancelAnimationFrame(id) { raf.delete(id); },
    setInterval(fn) { const id = ++sequence; intervals.set(id, fn); return id; },
    setTimeout() { return ++sequence; }, clearTimeout() {}, URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL() {} }
  });
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  const math = Object.create(Math); math.random = () => .5;
  const context = vm.createContext({ window, document, Date: Clock, Math: math, Promise, Blob });
  vm.runInContext(source, context);
  const ui = window.IndependentPetGame;
  const opening = ui.mount(host, coreOptions); assert.equal(await opening, true); await flush();
  return { ui, host, pane, document, window, data, storage, writes, control, rendererControl, mounts, actionCues, raf,
    get store() { return store; },
    saved() { return JSON.parse(data.get(Core.KEY)); },
    buttons() { return host.querySelectorAll('button'); },
    button(text) { const found = this.buttons().find(b => b.textContent === text || b.textContent.startsWith(text)); assert.ok(found, 'button: ' + text); return found; },
    focusButton(key) { const found = host.querySelector('[data-focus-key="' + key + '"]'); assert.ok(found, key); return found; },
    async click(button) { if (!button.disabled) button.emit('click'); await flush(); },
    advance(ms) { clock += ms; },
    async frame(ms = 0) { clock += ms; const callbacks = [...raf.values()]; raf.clear(); callbacks.forEach(fn => fn(clock)); await flush(); },
    activeMotions() { return mounts.filter(m => !m.destroyed && m.canvas.isConnected); }
  };
}

test('choosing B waits for persistence, preserves the economy and reveals canvas only when ready', async () => {
  const f = await fixture({ seed: { pg_exp: '167', pg_species: 'bunny' } });
  assert.equal((await f.store.dispatch({ type: 'buyStock', stockId: 'apl', quantity: 2 })).ok, true);
  const before = f.saved(), gate = deferred(); f.control.pending = gate;
  await f.click(f.button('薄紫のこ（B）'));
  assert.equal(f.store.getState().pet.species, 'bunny'); assert.deepEqual(f.saved(), before);
  assert.equal(f.mounts.length, 0, 'an unconfirmed selection cannot mount the B renderer');
  gate.resolve(); await flush(); f.control.pending = null;
  const after = f.saved();
  assert.deepEqual(after, { ...before, pet: { ...before.pet, species: 'lilac' }, revision: before.revision + 1 });
  assert.equal(f.mounts.length, 1); assert.equal(f.actionCues.length, 1);
  assert.equal(f.actionCues[0].cue.situation, 'greeting');
  const still = f.host.querySelector('.ipg-lilac-still'), canvas = f.host.querySelector('canvas');
  assert.match(still.src, /pet_lilac_cutout\.webp$/); assert.equal(still.hidden, false); assert.equal(canvas.hidden, true);
  f.mounts[0].options.onReady(); assert.equal(still.hidden, true); assert.equal(canvas.hidden, false);
  assert.ok(f.host.textContent.includes('もとの子'));
});

test('pending and rejected care saves never emit a successful reaction or change progress', async () => {
  for (const outcome of ['false', 'throw']) {
    const f = await fixture({ species: 'lilac' }); f.advance(10000); f.ui.render();
    const before = f.saved(), raw = f.data.get(Core.KEY), gate = deferred(), mapped = f.actionCues.length;
    f.control.pending = gate; f.control.outcome = outcome;
    await f.click(f.focusButton('care-feed'));
    assert.equal(f.host.getAttribute('aria-busy'), 'true'); assert.deepEqual(f.saved(), before);
    assert.equal(f.actionCues.length, mapped);
    gate.resolve(); await flush(); f.control.pending = null;
    assert.equal(f.data.get(Core.KEY), raw); assert.equal(f.actionCues.length, mapped);
    assert.equal(f.store.getState().pet.exp, before.pet.exp); assert.equal(f.store.getState().coins, before.coins);
    assert.deepEqual(f.store.getState().market, before.market);
    assert.equal(f.mounts.at(-1).options.situation, 'idle');
    assert.ok(f.host.querySelector('.ipg-error')); assert.equal(f.host.getAttribute('aria-busy'), 'false');
  }
});

test('a rejected B selection keeps the previous species image and never mounts B', async () => {
  for (const outcome of ['false', 'throw']) {
    const f = await fixture({ seed: { pg_species: 'bunny', pg_exp: '167' } }), before = f.saved();
    f.control.outcome = outcome; await f.click(f.button('薄紫のこ（B）'));
    assert.deepEqual(f.saved(), before); assert.equal(f.store.getState().pet.species, 'bunny');
    assert.ok(f.host.querySelector('.ipg-pet-image').src.endsWith('pet_bimg_cool.webp'));
    assert.equal(f.host.querySelector('canvas'), null); assert.equal(f.mounts.length, 0); assert.equal(f.actionCues.length, 0);
  }
});

test('one successful care cue is finite, does not restart on render and respects the daily cap', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' }); f.advance(10000); f.ui.render();
  const old = f.mounts.at(-1), count = f.mounts.length, before = f.saved();
  await f.click(f.focusButton('care-feed'));
  assert.equal(f.actionCues.length, 1); assert.equal(f.actionCues[0].cue.situation, 'feeding');
  assert.equal(f.mounts.length, count + 1); assert.equal(old.destroyed, true);
  assert.equal(f.mounts.at(-1).options.durationMs, Motion.durations.feeding);
  assert.equal(f.saved().pet.exp, before.pet.exp + 8); assert.equal(f.saved().coins, before.coins + 10);
  f.advance(1200); f.ui.render();
  assert.equal(f.mounts.at(-1).options.elapsedMs, 1200); assert.equal(f.actionCues.length, 1);
  f.advance(Motion.durations.feeding); f.ui.render(); assert.equal(f.mounts.at(-1).options.situation, 'idle');
  await f.click(f.focusButton('care-feed')); await f.click(f.focusButton('care-feed'));
  const full = f.saved(), written = f.writes.length, mapped = f.actionCues.length;
  assert.equal(f.focusButton('care-feed').disabled, true);
  await f.click(f.focusButton('care-feed'));
  assert.equal(f.writes.length, written); assert.deepEqual(f.saved(), full); assert.equal(f.actionCues.length, mapped);
  // A previously queued handler still has to respect the core's actual cap;
  // this deliberately bypasses the disabled DOM control, not the real store.
  f.focusButton('care-feed').emit('click'); await flush();
  assert.equal(f.writes.length, written); assert.deepEqual(f.saved(), full); assert.equal(f.actionCues.length, mapped);
  assert.match(f.host.querySelector('.ipg-error').textContent, /今日の回数/);
  assert.equal(f.activeMotions().length, 1);
});

test('using owned shop food and resting cue finite actions only after their real saves', async () => {
  const f = await fixture({ species: 'lilac' }); f.advance(10000);
  await f.click(f.focusButton('tab-shop'));
  const rice = f.host.querySelectorAll('article').find(row => row.querySelector('h4')?.textContent === 'おにぎり');
  assert.ok(rice); const before = f.saved();
  await f.click(rice.querySelectorAll('button').find(b => b.textContent === '使う'));
  assert.equal(f.saved().inventory.rice, before.inventory.rice - 1); assert.equal(f.saved().pet.exp, before.pet.exp + 4);
  assert.equal(f.saved().coins, before.coins); assert.deepEqual(f.saved().market, before.market);
  assert.equal(f.actionCues.at(-1).cue.situation, 'feeding'); assert.equal(f.mounts.at(-1).options.durationMs, Motion.durations.feeding);
  await f.click(f.focusButton('tab-care')); await f.click(f.focusButton('care-rest'));
  assert.equal(f.actionCues.at(-1).cue.situation, 'resting'); assert.equal(f.mounts.at(-1).options.durationMs, Motion.durations.resting);
  f.advance(Motion.durations.resting + 1); f.ui.render(); assert.equal(f.mounts.at(-1).options.situation, 'idle');
});

test('an egg keeps the static asset and hatching gets one post-save joy cue', async () => {
  const f = await fixture({ species: 'lilac', seed: { pg_exp: '14' } });
  assert.equal(f.mounts.length, 0); assert.equal(f.host.querySelector('canvas'), null);
  assert.match(f.host.querySelector('.ipg-pet-image').src, /pet_lilac_egg\.webp$/);
  await f.click(f.focusButton('care-feed'));
  assert.equal(f.saved().pet.exp, 22); assert.equal(f.mounts.length, 1);
  assert.equal(f.mounts[0].options.situation, 'joy'); assert.equal(f.actionCues.length, 1);
});

test('old species use their prior images with no motion mounts or economy changes', async () => {
  for (const [seed, expected] of [
    [{ pg_species: 'dragon', pg_exp: '167' }, 'pet_img_px_final.webp'],
    [{ pg_species: 'bunny', pg_exp: '167' }, 'pet_bimg_cool.webp'],
    [{ pg_species: 'dragon', pg_exp: '0' }, 'pet_img_px_egg.webp']
  ]) {
    const f = await fixture({ seed }), before = f.saved();
    assert.ok(f.host.querySelector('.ipg-pet-image').src.endsWith(expected));
    assert.equal(f.host.querySelector('canvas'), null); assert.equal(f.mounts.length, 0);
    f.window.emit('focus'); await flush(); assert.deepEqual(f.saved(), before); assert.equal(f.mounts.length, 0);
  }
});

test('hide and close destroy motion; hidden focus does not mount and reopen owns one controller', async () => {
  const f = await fixture({ species: 'lilac' }); const first = f.mounts[0];
  f.document.hidden = true; f.document.emit('visibilitychange'); await flush();
  assert.equal(first.destroyed, true); const count = f.mounts.length;
  f.window.emit('focus'); f.window.emit('pageshow'); await flush(); assert.equal(f.mounts.length, count);
  f.document.hidden = false; f.document.emit('visibilitychange'); await flush(); assert.equal(f.activeMotions().length, 1);
  await f.ui.close(); f.pane.hidden = true; const closed = f.mounts.length;
  f.window.emit('focus'); f.window.emit('pageshow'); f.ui.render(); await flush();
  assert.equal(f.mounts.length, closed); assert.equal(f.activeMotions().length, 0);
  f.pane.hidden = false; assert.equal(await f.ui.open(), true); assert.equal(f.activeMotions().length, 1);
  assert.equal(f.mounts.at(-1).options.situation, 'greeting');
  const reopened = f.mounts.at(-1); f.ui.render(); assert.equal(reopened.destroyed, true); assert.equal(f.activeMotions().length, 1);
});

test('an initially hidden document or pane cannot start drawing on focus or render', async () => {
  for (const config of [{ hidden: true }, { paneHidden: true }]) {
    const f = await fixture({ species: 'lilac', ...config }), before = f.saved();
    f.window.emit('focus'); f.ui.render(); await flush();
    assert.equal(f.mounts.length, 0); assert.deepEqual(f.saved(), before);
    assert.equal(f.host.querySelector('canvas').hidden, true); assert.equal(f.host.querySelector('.ipg-lilac-still').hidden, false);
  }
});

test('all eight B preview modes work for an old egg without selecting B or writing any progress', async () => {
  const f = await fixture({ seed: { pg_species: 'dragon', pg_exp: '0' } }), before = f.saved(), writes = f.writes.length;
  await f.click(f.button('薄紫のこのしぐさを見る'));
  const panel = f.host.querySelector('.ipg-appearance-preview'), controller = f.mounts.at(-1);
  assert.ok(panel); assert.equal(f.host.querySelector('.ipg-pet-settings').open, true);
  assert.ok(f.host.querySelector('.ipg-pet-image').src.endsWith('pet_img_px_egg.webp'));
  assert.equal(panel.querySelector('.ipg-lilac-still').hidden, false); assert.equal(panel.querySelector('canvas').hidden, true);
  controller.options.onReady(); assert.equal(panel.querySelector('canvas').hidden, false);
  const choices = panel.querySelectorAll('button'); assert.equal(choices.length, 8);
  for (const [i, name] of Motion.situations.entries()) {
    await f.click(choices[i]);
    assert.equal(controller.changes.at(-1).name, name);
    assert.equal(choices[i].getAttribute('aria-pressed'), 'true');
    assert.equal(choices.filter(b => b.getAttribute('aria-pressed') === 'true').length, 1);
    assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(f.actionCues.length, 0);
  }
  f.advance(700); f.ui.render();
  assert.equal(controller.destroyed, true); assert.equal(f.activeMotions().length, 1);
  assert.equal(f.mounts.at(-1).options.situation, 'caught'); assert.equal(f.mounts.at(-1).options.elapsedMs, 700);
  assert.equal(f.host.querySelector('.ipg-pet-settings').open, true);
  await f.click(f.button('しぐさの見本を閉じる'));
  assert.equal(f.host.querySelector('.ipg-appearance-preview'), null); assert.equal(f.activeMotions().length, 0);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('B preview keeps static fallback and disables its controls when drawing fails', async () => {
  for (const mode of ['error', 'throw']) {
    const f = await fixture({ seed: { pg_species: 'dragon', pg_exp: '0' }, rendererMode: mode }), before = f.saved();
    await f.click(f.button('薄紫のこのしぐさを見る'));
    const panel = f.host.querySelector('.ipg-appearance-preview');
    assert.equal(panel.querySelector('.ipg-lilac-still').hidden, false); assert.equal(panel.querySelector('canvas').hidden, true);
    assert.ok(panel.querySelectorAll('button').every(b => b.disabled), mode + ': preview actions unavailable');
    assert.match(panel.textContent, /絵で表示/); assert.deepEqual(f.saved(), before);
  }
});

test('B preview is a disabled static reference if the optional motion module is unavailable', async () => {
  const f = await fixture({ seed: { pg_species: 'dragon', pg_exp: '0' } }), before = f.saved();
  delete f.window.PetLilacMotion;
  await f.click(f.button('薄紫のこのしぐさを見る'));
  const panel = f.host.querySelector('.ipg-appearance-preview');
  assert.ok(panel.querySelectorAll('button').every(b => b.disabled)); assert.equal(f.mounts.length, 0);
  assert.equal(panel.querySelector('.ipg-lilac-still').hidden, false); assert.deepEqual(f.saved(), before);
});

test('mount failures and renderer errors retain a still while real game saves succeed', async () => {
  for (const mode of ['throw', 'error']) {
    const f = await fixture({ species: 'lilac', rendererMode: mode });
    assert.equal(f.host.querySelector('.ipg-lilac-still').hidden, false); assert.equal(f.host.querySelector('canvas').hidden, true);
    const before = f.saved(); await f.click(f.focusButton('care-rest'));
    assert.equal(f.saved().pet.exp, before.pet.exp + 4); assert.equal(f.saved().coins, before.coins + 10);
    assert.equal(f.host.querySelector('.ipg-lilac-still').hidden, false); assert.equal(f.host.querySelector('canvas').hidden, true);
    assert.equal(f.host.querySelector('.ipg-error'), null);
  }
  const f = await fixture({ species: 'lilac' }); const before = f.saved(); f.rendererControl.mappingThrows = true;
  await f.click(f.focusButton('care-feed'));
  assert.equal(f.saved().pet.exp, before.pet.exp + 8); assert.equal(f.host.querySelector('.ipg-error'), null);
});

test('B catcher movement and catches are transient; a failed result grants nothing until one retry saves', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' });
  await f.click(f.focusButton('tab-play')); await f.click(f.button('25秒のゲームをはじめる'));
  const before = f.saved(), catcher = f.host.querySelector('.ipg-catcher'), controller = f.activeMotions()[0];
  assert.ok(catcher.className.includes('ipg-lilac-visual')); assert.equal(f.raf.size, 1);
  await f.click(f.button('右へ')); assert.equal(catcher.style.left, '62%');
  assert.equal(controller.changes.at(-1).name, 'moving');
  await f.click(f.button('← 左へ')); assert.equal(catcher.style.left, '50%');
  await f.frame(); await f.frame(1600);
  assert.ok(controller.changes.some(cue => cue.name === 'caught'));
  assert.deepEqual(f.saved(), before, 'catch feedback is not a reward or storage write');
  f.control.outcome = 'false'; await f.frame(23400);
  assert.deepEqual(f.saved(), before); assert.ok(f.button('結果の保存を再試行'));
  assert.equal(f.actionCues.filter(row => row.action.type === 'finishMinigame').length, 0);
  f.control.outcome = 'ok'; await f.click(f.button('結果の保存を再試行'));
  assert.equal(f.saved().coins, before.coins + 1); assert.equal(f.saved().pet.exp, before.pet.exp + 1);
  assert.equal(f.saved().inventory.berry, (before.inventory.berry || 0) + 1); assert.equal(f.saved().minigames.active, null);
  assert.equal(f.actionCues.filter(row => row.action.type === 'finishMinigame').length, 1);
  assert.equal(f.actionCues.at(-1).cue.situation, 'caught'); assert.equal(f.raf.size, 0);
  assert.equal(f.activeMotions().length, 1);
});

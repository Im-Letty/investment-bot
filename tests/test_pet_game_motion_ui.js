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
  focus(options) { this.lastFocusOptions = options; this.ownerDocument.activeElement = this; }
  scrollIntoView(options) { this.scrollCalls = this.scrollCalls || []; this.scrollCalls.push(options);
    this.ownerDocument.scrollEvents = this.ownerDocument.scrollEvents || []; this.ownerDocument.scrollEvents.push({ node: this, options }); }
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
  if (config.setup) await config.setup(setup);
  const document = events({ hidden: !!config.hidden, activeElement: null });
  document.createElement = tag => new Element(tag, document);
  document.body = new Element('body', document);
  const pane = document.createElement('section'), host = document.createElement('div');
  pane.hidden = !!config.paneHidden; document.body.appendChild(pane); pane.appendChild(host);
  document.getElementById = id => id === 'sect-pet' ? pane : id === 'pet-game-root' ? host : null;
  const raf = new Map(), intervals = new Map(), timers = new Map(), mounts = [], actionCues = [], anchorCalls = [];
  const rendererControl = { mode: config.rendererMode || 'pending', mappingThrows: false };
  const renderer = {
    durations: Motion.durations, catalogue: Motion.catalogue, bodyCatalogue: Motion.bodyCatalogue, directionCatalogue: Motion.directionCatalogue, feedingPhase: Motion.feedingPhase, feedingAnchor(stage, path) { anchorCalls.push({ stage, path }); return Motion.feedingAnchor(stage, path); }, growthProfile: Motion.growthProfile, growthPoint: Motion.growthPoint,
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
    setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, at: clock + Math.max(0, ms || 0) }); return id; },
    clearTimeout(id) { timers.delete(id); }, URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL() {} }
  });
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  const math = Object.create(Math); math.random = () => .5;
  const context = vm.createContext({ window, document, Date: Clock, Math: math, Promise, Blob });
  vm.runInContext(source, context);
  const ui = window.IndependentPetGame;
  const opening = ui.mount(host, coreOptions); assert.equal(await opening, true); await flush();
  return { ui, host, pane, document, window, data, storage, writes, control, rendererControl, mounts, actionCues, anchorCalls, raf, timers,
    get store() { return store; },
    saved() { return JSON.parse(data.get(Core.KEY)); },
    buttons() { return host.querySelectorAll('button'); },
    button(text) { const found = this.buttons().find(b => b.textContent === text || b.textContent.startsWith(text)); assert.ok(found, 'button: ' + text); return found; },
    focusButton(key) { const found = host.querySelector('[data-focus-key="' + key + '"]'); assert.ok(found, key); return found; },
    async click(button) { if (!button.disabled) button.emit('click'); await flush(); },
    async revealEmotion(id, preview = false) {
      const mode = preview ? 'preview' : 'pet', entry = Motion.catalogue.find(row => row.id === id); assert.ok(entry, id);
      const group = { happy: 'bright', feeling: 'deep', social: 'together' }[entry.group] || entry.group;
      await this.click(this.focusButton(mode + '-emotion-group-' + group));
      let choice = this.focusButton(mode + '-emotion-' + id), remaining = 20;
      while (choice.hidden && remaining--) await this.click(this.focusButton(mode + '-emotion-next'));
      assert.equal(choice.hidden, false, id + ' must be on its visible page'); return choice;
    },
    async bodyDrawer(open = true, preview = false) {
      const drawer = this.focusButton((preview ? 'preview' : 'pet') + '-body-motion');
      drawer.open = open; drawer.emit('toggle'); await flush(); return drawer;
    },
    async directionDrawer(open = true, preview = false) {
      const drawer = this.focusButton((preview ? 'preview' : 'pet') + '-direction-motion');
      drawer.open = open; drawer.emit('toggle'); await flush(); return drawer;
    },
    advance(ms) { clock += ms; },
    async fireTimers() {
      for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.fn(); }
      await flush();
    },
    async frame(ms = 0) { clock += ms; const callbacks = [...raf.values()]; raf.clear(); callbacks.forEach(fn => fn(clock)); await flush(); },
    activeMotions() { return mounts.filter(m => !m.destroyed && m.canvas.isConnected); },
    scrolls() { return document.scrollEvents || []; }
  };
}

function shellBounds(f, headerRect, footerRect) {
  const header = f.document.createElement('header'); header.className = 'ipg-shell-head';
  header.getBoundingClientRect = () => headerRect; f.pane.appendChild(header);
  const footer = f.document.createElement('nav'); footer.getBoundingClientRect = () => footerRect;
  f.document.body.appendChild(footer);
  const originalGet = f.document.getElementById;
  f.document.getElementById = id => id === 'knBottomNav' ? footer : originalGet(id);
  return { header, footer };
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

test('B is already visible before 15 EXP and the first growth-boundary meal keeps its full feeding cue', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '14' } }), before = f.saved();
  assert.equal(f.mounts.length, 1); assert.ok(f.host.querySelector('canvas'));
  assert.match(f.host.querySelector('.ipg-lilac-still').src, /pet_lilac_cutout\.webp$/);
  assert.equal(before.pet.exp, 14); assert.equal(f.store.getState().stage.key, 'egg');
  assert.ok(f.host.querySelector('.ipg-stage').textContent.includes('うまれたて'));
  await f.click(f.focusButton('care-feed'));
  assert.equal(f.saved().pet.exp, 22); assert.equal(f.mounts.length, 2); assert.equal(f.activeMotions().length, 1);
  assert.equal(f.mounts.at(-1).options.situation, 'feeding'); assert.equal(f.actionCues.length, 1);
  assert.equal(f.host.querySelector('.ipg-lilac-visual').dataset.feedingPhase, 'anticipation');
});

test('retired dragons display B with preserved progress and no red dragon choices; bunny images remain unchanged', async () => {
  for (const exp of ['0', '167']) {
    const f = await fixture({ seed: { pg_species: 'dragon', pg_exp: exp }, rendererMode: 'ready' }), before = f.saved();
    assert.equal(before.pet.species, 'lilac'); assert.equal(before.pet.exp, Number(exp));
    assert.equal(before.pet.path, 'cool'); assert.equal(before.pet.pixel, true);
    assert.equal(before.migration.legacyRaw.pg_species, 'dragon'); assert.equal(f.data.get('pg_species'), 'dragon');
    assert.ok(f.host.querySelector('canvas')); assert.equal(f.mounts.length, 1);
    assert.ok(f.host.querySelectorAll('img').every(img => !/pet_img_|pet_lilac_egg/.test(img.src)));
    assert.ok(f.buttons().every(button => !button.textContent.startsWith('りゅう')));
    f.window.emit('focus'); await flush(); assert.deepEqual(f.saved(), before); assert.equal(f.activeMotions().length, 1);
  }
  for (const [exp, expected] of [['167', 'pet_bimg_cool.webp'], ['0', 'pet_bimg_egg.webp']]) {
    const f = await fixture({ seed: { pg_species: 'bunny', pg_exp: exp } }), before = f.saved();
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

test('all 100 B preview modes work for an old egg without selecting B or writing any progress', async () => {
  const f = await fixture({ seed: { pg_species: 'bunny', pg_exp: '0' } }), before = f.saved(), writes = f.writes.length;
  await f.click(f.button('薄紫のこのしぐさを見る'));
  const panel = f.host.querySelector('.ipg-appearance-preview'), controller = f.mounts.at(-1);
  assert.ok(panel); assert.equal(f.host.querySelector('.ipg-pet-settings').open, true);
  assert.ok(f.host.querySelector('.ipg-pet-image').src.endsWith('pet_bimg_egg.webp'));
  assert.equal(panel.querySelector('.ipg-lilac-still').hidden, false); assert.equal(panel.querySelector('canvas').hidden, true);
  controller.options.onReady(); assert.equal(panel.querySelector('canvas').hidden, false);
  const choices = panel.querySelectorAll('button').filter(b => b.dataset.emotion); assert.equal(choices.length, 100);
  assert.equal(panel.querySelectorAll('.ipg-emotion-groups')[0].querySelectorAll('button').length, 6);
  for (const [i, name] of Motion.situations.entries()) {
    await f.click(await f.revealEmotion(name, true));
    assert.equal(controller.changes.at(-1).name, name);
    assert.match(panel.querySelector('.ipg-emotion-caption').textContent, /の見本$/);
    assert.ok(panel.querySelector('canvas').getAttribute('aria-label').includes(choices[i].getAttribute('aria-label')));
    assert.equal(choices[i].getAttribute('aria-pressed'), 'true');
    assert.equal(choices.filter(b => b.getAttribute('aria-pressed') === 'true').length, 1);
    assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(f.actionCues.length, 0);
  }
  f.advance(700); f.ui.render();
  assert.equal(controller.destroyed, true); assert.equal(f.activeMotions().length, 1);
  assert.equal(f.mounts.at(-1).options.situation, Motion.situations.at(-1)); assert.equal(f.mounts.at(-1).options.elapsedMs, 700);
  assert.equal(f.host.querySelector('.ipg-pet-settings').open, true);
  await f.click(f.button('しぐさの見本を閉じる'));
  assert.equal(f.host.querySelector('.ipg-appearance-preview'), null); assert.equal(f.activeMotions().length, 0);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('B preview keeps static fallback and disables its controls when drawing fails', async () => {
  for (const mode of ['error', 'throw']) {
    const f = await fixture({ seed: { pg_species: 'bunny', pg_exp: '0' }, rendererMode: mode }), before = f.saved();
    await f.click(f.button('薄紫のこのしぐさを見る'));
    const panel = f.host.querySelector('.ipg-appearance-preview');
    assert.equal(panel.querySelector('.ipg-lilac-still').hidden, false); assert.equal(panel.querySelector('canvas').hidden, true);
    assert.ok(panel.querySelectorAll('button').filter(b => b.dataset.emotion).every(b => b.disabled), mode + ': preview actions unavailable');
    assert.match(panel.textContent, /絵で表示/); assert.deepEqual(f.saved(), before);
  }
});

test('B preview is a disabled static reference if the optional motion module is unavailable', async () => {
  const f = await fixture({ seed: { pg_species: 'bunny', pg_exp: '0' } }), before = f.saved();
  delete f.window.PetLilacMotion;
  await f.click(f.button('薄紫のこのしぐさを見る'));
  const panel = f.host.querySelector('.ipg-appearance-preview');
  assert.ok(panel.querySelectorAll('button').filter(b => b.dataset.emotion).every(b => b.disabled)); assert.equal(f.mounts.length, 0);
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

test('care offers all 100 expressive choices without saving, awarding or starting an animation loop', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
  const panel = f.host.querySelector('.ipg-emotion-panel'), controller = f.mounts.at(-1);
  const choices = panel.querySelectorAll('button').filter(b => b.dataset.emotion);
  assert.equal(choices.length, 100); assert.equal(panel.querySelectorAll('.ipg-emotion-groups')[0].querySelectorAll('button').length, 6);
  for (const [i, id] of Motion.situations.entries()) {
    await f.click(await f.revealEmotion(id));
    assert.equal(controller.changes.at(-1).name, id);
    assert.ok(f.host.querySelector('canvas').getAttribute('aria-label').includes(choices[i].getAttribute('aria-label')));
    assert.equal(choices[i].getAttribute('aria-pressed'), 'true');
    assert.equal(choices.filter(b => b.getAttribute('aria-pressed') === 'true').length, 1);
    assert.ok(f.timers.size <= 1, 'one cue deadline, no timer accumulation');
    assert.equal(f.raf.size, 0, 'UI effect uses CSS rather than a second render loop');
    assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(f.actionCues.length, 0);
  }
  f.advance(725); f.ui.render();
  assert.equal(controller.destroyed, true); assert.equal(f.activeMotions().length, 1);
  assert.equal(f.mounts.at(-1).options.situation, Motion.situations.at(-1));
  assert.equal(f.mounts.at(-1).options.elapsedMs, 725, 'rerender keeps the original cue age');
  assert.equal(f.focusButton('pet-emotion-group-action').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('sadness and anger get distinct finite accents; replay resets only the transient cue', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
  await f.click(f.focusButton('pet-emotion-group-deep'));
  await f.click(f.focusButton('pet-emotion-cry'));
  let effect = f.host.querySelector('.ipg-emotion-effect');
  assert.equal(effect.hidden, false); assert.ok(effect.className.includes('ipg-effect-tears')); assert.equal(effect.children.length, 4);
  f.advance(500); f.ui.render();
  effect = f.host.querySelector('.ipg-emotion-effect');
  assert.equal(f.mounts.at(-1).options.elapsedMs, 500);
  assert.match(effect.children[0].style.animationDelay, /^-0\.5s$/);
  await f.click(f.focusButton('pet-emotion-angry'));
  assert.ok(effect.className.includes('ipg-effect-anger')); assert.equal(effect.children.length, 3);
  f.advance(300); await f.click(f.focusButton('pet-emotion-angry'));
  assert.equal(f.mounts.at(-1).changes.filter(c => c.name === 'angry').length, 2);
  f.advance(Motion.durations.angry + 1); await f.fireTimers();
  assert.equal(effect.hidden, true); assert.equal(effect.children.length, 0);
  assert.equal(f.focusButton('pet-emotion-idle').getAttribute('aria-pressed'), 'true');
  assert.match(f.host.querySelector('.ipg-emotion-caption').textContent, /ふだん/);
  assert.equal(f.timers.size, 0); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('all six groups page through the 100 labelled descriptions without remounting or restarting a live cue', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
  await f.click(await f.revealEmotion('sad'));
  const controller = f.mounts[0], changes = controller.changes.length, mounts = f.mounts.length;
  const deadline = [...f.timers.values()][0].at, ids = new Set();
  const groups = [['bright', 17], ['deep', 16], ['wonder', 16], ['together', 16], ['calm', 16], ['action', 19]];
  const visible = () => f.buttons().filter(button => button.dataset.emotion && !button.hidden);
  for (const [group, count] of groups) {
    const tab = f.focusButton('pet-emotion-group-' + group);
    assert.ok(tab.textContent.endsWith(' ' + count)); await f.click(tab);
    assert.equal(tab.getAttribute('aria-pressed'), 'true');
    assert.equal(f.focusButton('pet-emotion-previous').disabled, true);
    let seen = 0;
    for (let page = 0; page < Math.ceil(count / 6); page++) {
      const choices = visible(); assert.equal(choices.length, Math.min(6, count - seen));
      for (const choice of choices) {
        const row = Motion.catalogue.find(entry => entry.id === choice.dataset.emotion);
        assert.equal(choice.getAttribute('aria-label'), row.label, 'descriptions must not lengthen the accessible name');
        assert.equal(choice.getAttribute('aria-description'), '顔：' + row.face + '。動き：' + row.motion);
        assert.ok(choice.querySelector('.ipg-emotion-description').textContent.includes(row.motion));
        assert.equal(ids.has(row.id), false, row.id + ' appears once'); ids.add(row.id);
      }
      seen += choices.length;
      assert.equal(f.host.querySelector('.ipg-emotion-page').textContent, (page + 1) + ' / ' + Math.ceil(count / 6) + 'ページ');
      await f.click(f.focusButton('pet-emotion-next'));
    }
    assert.equal(seen, count); assert.equal(f.focusButton('pet-emotion-next').disabled, true);
    await f.click(f.focusButton('pet-emotion-previous'));
    assert.ok(visible().length <= 6);
  }
  assert.equal(ids.size, 100); assert.equal(f.mounts.length, mounts); assert.equal(controller.changes.length, changes);
  assert.equal([...f.timers.values()][0].at, deadline, 'browsing cannot restart the sad cue');
  assert.equal(f.raf.size, 0); assert.equal(f.scrolls().length, 0);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('Japanese search spans every group, normalizes kana and full-width text, and has an honest zero-result clear flow', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
  await f.click(await f.revealEmotion('cry'));
  const controller = f.mounts[0], changes = controller.changes.length, mounts = f.mounts.length;
  const deadline = [...f.timers.values()][0].at, input = f.focusButton('pet-emotion-search');
  const visible = () => f.buttons().filter(button => button.dataset.emotion && !button.hidden).map(button => button.dataset.emotion);
  async function search(query) { input.value = query; input.emit('input'); await flush(); }
  await search('ニッコリ'); assert.deepEqual(visible(), ['gentlesmile']);
  await search('ｿﾜｿﾜ'); assert.deepEqual(visible(), ['nervous', 'awkward', 'bored_fidget']);
  assert.equal(f.host.querySelector('.ipg-emotion-count').textContent, '全100種類 · 検索3件 · 3件表示');
  assert.ok(f.host.querySelector('.ipg-emotion-groups').querySelectorAll('button').every(button => button.getAttribute('aria-pressed') === 'false'));
  await search('ＦＵＲＹ'); assert.deepEqual(visible(), ['furious']);
  await search('存在しないしぐさ'); assert.deepEqual(visible(), []);
  assert.equal(f.host.querySelector('.ipg-emotion-empty').hidden, false);
  assert.equal(f.host.querySelector('.ipg-emotion-pages').hidden, true);
  assert.match(f.host.querySelector('.ipg-emotion-count').textContent, /検索0件/);
  await f.click(f.focusButton('pet-emotion-clear'));
  assert.equal(input.value, ''); assert.equal(f.document.activeElement, input);
  assert.equal(f.host.querySelector('.ipg-emotion-empty').hidden, true); assert.equal(visible().length, 6);
  assert.equal(f.focusButton('pet-emotion-group-deep').getAttribute('aria-pressed'), 'true');
  assert.equal(f.mounts.length, mounts); assert.equal(controller.changes.length, changes);
  assert.equal([...f.timers.values()][0].at, deadline); assert.equal(f.scrolls().length, 0);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('the optional module fallback names only the original 36 static references and never promises the expanded motion catalogue', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
  delete f.window.PetLilacMotion; f.ui.render();
  const panel = f.host.querySelector('.ipg-emotion-panel'), choices = panel.querySelectorAll('button').filter(button => button.dataset.emotion);
  assert.equal(choices.length, 36); assert.equal(panel.getAttribute('aria-label'), 'きもちとしぐさ・36種類');
  assert.ok(choices.every(button => button.disabled));
  assert.deepEqual(choices.map(button => button.dataset.emotion), Motion.situations.slice(0, 36));
  assert.match(panel.querySelector('.ipg-emotion-caption').textContent, /絵の見本/);
  assert.equal(panel.textContent.includes('100種類'), false);
  const input = f.focusButton('pet-emotion-search'); input.value = '悲しい'; input.emit('input'); await flush();
  assert.deepEqual(choices.filter(button => !button.hidden).map(button => button.dataset.emotion), ['sad']);
  assert.equal(f.activeMotions().length, 0); assert.equal(f.timers.size, 0);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('expanded negative emotions use their declared accents and unknown effect metadata stays empty rather than sparkling', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
  for (const id of ['furious', 'disgusted', 'repulsed', 'contempt', 'jealous', 'guilty', 'regretful', 'horrified']) {
    const row = Motion.catalogue.find(entry => entry.id === id); assert.ok(row, id);
    await f.click(await f.revealEmotion(id));
    const effect = f.host.querySelector('.ipg-emotion-effect');
    assert.equal(effect.hidden, row.effect === 'none');
    if (row.effect !== 'none') assert.ok(effect.className.includes('ipg-effect-' + row.effect));
    assert.equal(effect.className.includes('ipg-effect-sparkle'), false, id + ' must not inherit happy fallback accents');
  }
  f.window.PetLilacMotion.catalogue = Motion.catalogue.map(row => ({ ...row, effect: row.id === 'sad' ? 'not-a-known-effect' : row.effect }));
  f.ui.render(); await f.click(await f.revealEmotion('sad'));
  const effect = f.host.querySelector('.ipg-emotion-effect');
  assert.equal(effect.hidden, true); assert.equal(effect.children.length, 0);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('every nonmeal cue has observable finite enter, acting, settling and idle phases with one deadline and no save or RAF', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
  const controller = f.mounts[0], visual = f.host.querySelector('.ipg-lilac-visual');
  for (const row of Motion.catalogue.filter(entry => !['idle', 'feeding'].includes(entry.id))) {
    await f.click(await f.revealEmotion(row.id));
    assert.equal(visual.dataset.cuePhase, 'enter', row.id); assert.equal(f.timers.size, 1);
    const enter = Math.min(450, row.durationMs * .22), release = row.durationMs - Math.min(800, row.durationMs * .28);
    f.advance(enter); await f.fireTimers(); assert.equal(visual.dataset.cuePhase, 'acting', row.id);
    f.advance(release - enter); await f.fireTimers(); assert.equal(visual.dataset.cuePhase, 'settling', row.id);
    f.advance(row.durationMs - release); await f.fireTimers();
    assert.equal(visual.dataset.cuePhase, 'idle', row.id); assert.equal(visual.dataset.situation, 'idle');
    assert.equal(f.host.querySelector('.ipg-emotion-effect').hidden, true); assert.equal(f.timers.size, 0);
    assert.equal(f.raf.size, 0); assert.equal(f.mounts.length, 1); assert.equal(controller.destroyed, false);
  }
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(f.actionCues.length, 0);
});

test('an offscreen selected gesture reveals the actor while browsing stays still and an unsupported scroll cannot reject playback', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' }), before = f.saved();
  const visual = f.host.querySelector('.ipg-lilac-visual'), controller = f.mounts[0];
  f.window.innerHeight = 500; visual.getBoundingClientRect = () => ({ top: -120, height: 260 });
  const choice = await f.revealEmotion('furious'); assert.equal(f.scrolls().length, 0);
  await f.click(choice); assert.equal(f.scrolls().length, 1);
  assert.equal(f.scrolls()[0].node, visual); assert.deepEqual(copy(f.scrolls()[0].options), { block: 'center', behavior: 'auto' });
  visual.scrollIntoView = () => { throw new Error('scroll unavailable'); };
  await f.click(choice); assert.equal(controller.changes.at(-1).name, 'furious'); assert.equal(visual.dataset.cuePhase, 'enter');
  f.document.hidden = true; f.document.emit('visibilitychange'); await flush();
  assert.equal(visual.dataset.cuePhase, 'idle'); assert.equal(f.timers.size, 0); assert.deepEqual(f.saved(), before);
});

test('a direction reference keeps the complete idle wrapper clear of the fixed game header and footer with only one scroll', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
  f.window.innerHeight = 720; shellBounds(f, { top: 0, height: 69 }, { top: 662, height: 58 });
  const visual = f.host.querySelector('.ipg-lilac-visual'), controller = f.mounts[0];
  visual.getBoundingClientRect = () => ({ top: 31, height: 260 });
  await f.directionDrawer(); await f.click(f.focusButton('pet-direction-motion-direction_left'));
  assert.equal(f.scrolls().length, 1, 'the whole actor is occluded even if the smaller turning head appears below the header');
  assert.equal(f.scrolls()[0].node, visual); assert.deepEqual(copy(f.scrolls()[0].options), { block: 'center', behavior: 'auto' });
  assert.equal(visual.style.scrollMarginTop, '81px'); assert.equal(visual.style.scrollMarginBottom, '70px');
  f.advance(6000); await f.fireTimers(); assert.equal(visual.dataset.cuePhase, 'idle');
  assert.equal(f.scrolls().length, 1, 'phase boundaries and idle recovery cannot keep moving the page');
  assert.equal(f.mounts.length, 1); assert.equal(controller.destroyed, false); assert.equal(f.raf.size, 0);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('footer occlusion also reveals the actor but an actor entirely within the safe area stays still', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
  f.window.innerHeight = 720; shellBounds(f, { top: 0, height: 69, bottom: 69 }, { top: 662, height: 58, bottom: 720 });
  const visual = f.host.querySelector('.ipg-lilac-visual');
  visual.getBoundingClientRect = () => ({ top: 420, height: 260 });
  await f.click(f.focusButton('pet-emotion-joy')); assert.equal(f.scrolls().length, 1, 'feet behind the bottom navigation are not fully visible');
  visual.getBoundingClientRect = () => ({ top: 100, height: 260 });
  await f.click(f.focusButton('pet-emotion-love')); assert.equal(f.scrolls().length, 1, 'a safely placed actor needs no new scroll');
  assert.equal(f.mounts.length, 1); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('hidden or zero-height shell bars do not cause an unnecessary actor scroll and CSS supplies safe scroll margins', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' }), before = f.saved(); f.window.innerHeight = 720;
  const chrome = shellBounds(f, { top: 0, height: 69 }, { top: 662, height: 58 });
  chrome.header.hidden = true; chrome.footer.hidden = true;
  const visual = f.host.querySelector('.ipg-lilac-visual'); visual.getBoundingClientRect = () => ({ top: 31, height: 260 });
  await f.click(f.focusButton('pet-emotion-joy')); assert.equal(f.scrolls().length, 0);
  chrome.header.hidden = false; chrome.footer.hidden = false;
  chrome.header.getBoundingClientRect = chrome.footer.getBoundingClientRect = () => ({ top: 0, height: 0 });
  await f.click(f.focusButton('pet-emotion-love')); assert.equal(f.scrolls().length, 0); assert.deepEqual(f.saved(), before);
  const css = fs.readFileSync(require.resolve('../static/pet-game.css'), 'utf8');
  assert.match(css, /\.ipg-lilac-visual,\.ipg-emotion-stage>\.ipg-scene\{scroll-margin-top:calc\(82px \+ env\(safe-area-inset-top,0px\)\);scroll-margin-bottom:calc\(82px \+ env\(safe-area-inset-bottom,0px\)\)/);
});

test('unavailable shell measurements use conservative margins without rejecting a valid gesture or adding drawing work', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
  f.window.innerHeight = 720; const chrome = shellBounds(f, { top: 0, height: 69 }, { top: 662, height: 58 });
  chrome.header.getBoundingClientRect = () => { throw new Error('layout unavailable'); };
  chrome.footer.getBoundingClientRect = () => ({ top: NaN, height: 58 });
  const visual = f.host.querySelector('.ipg-lilac-visual'); visual.getBoundingClientRect = () => ({ top: 31, height: 260 });
  await f.click(f.focusButton('pet-emotion-joy'));
  assert.equal(f.mounts[0].changes.at(-1).name, 'joy'); assert.equal(f.scrolls().length, 1);
  assert.equal(visual.style.scrollMarginTop, '94px'); assert.equal(visual.style.scrollMarginBottom, '94px');
  assert.equal(f.mounts.length, 1); assert.equal(f.raf.size, 0); assert.equal(f.timers.size, 1);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('six full-body references share the actual clothed actor without changing the 100-expression catalogue or any saved progress', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '373', pg_coins: '355' }, setup: async store => {
    await store.dispatch({ type: 'buyItem', itemId: 'cloth_cream_vest' }); await store.dispatch({ type: 'equipClothing', itemId: 'cloth_cream_vest' });
  } }), before = f.saved(), writes = f.writes.length;
  const controller = f.mounts[0], visual = f.host.querySelector('.ipg-lilac-visual');
  assert.equal(controller.options.outfit, 'cloth_cream_vest'); assert.equal(controller.options.growthStage, 'final');
  const drawer = await f.bodyDrawer(); assert.equal(drawer.open, true);
  const choices = drawer.querySelectorAll('button'); assert.equal(choices.length, 6);
  assert.deepEqual(choices.map(button => button.dataset.bodyMotion), ['body_hands', 'body_feet', 'body_ears', 'body_tail', 'body_head', 'body_joy']);
  assert.equal(f.buttons().filter(button => button.dataset.emotion).length, 100);
  assert.equal(f.host.querySelector('.ipg-emotion-panel').getAttribute('aria-label'), 'きもちとしぐさ・100種類');
  for (const row of Motion.bodyCatalogue) {
    const choice = f.focusButton('pet-body-motion-' + row.id);
    assert.equal(choice.getAttribute('aria-label'), row.label);
    assert.equal(choice.getAttribute('aria-description'), '顔：' + row.face + '。動き：' + row.motion);
    await f.click(choice); assert.equal(controller.changes.at(-1).name, row.id);
    assert.equal(visual.dataset.cuePhase, 'enter'); assert.equal(choice.getAttribute('aria-pressed'), 'true');
    assert.equal(choices.filter(button => button.getAttribute('aria-pressed') === 'true').length, 1);
    assert.equal(f.host.querySelector('.ipg-emotion-caption').textContent, row.label + 'の見本');
    assert.ok(visual.querySelector('canvas').getAttribute('aria-label').includes(row.label));
    assert.equal(f.host.querySelector('.ipg-emotion-effect').hidden, true, 'part demonstrations do not add distracting emotion accents');
    f.advance(450); await f.fireTimers(); assert.equal(visual.dataset.cuePhase, 'acting');
    f.advance(4750); await f.fireTimers(); assert.equal(visual.dataset.cuePhase, 'settling');
    f.advance(800); await f.fireTimers(); assert.equal(visual.dataset.cuePhase, 'idle'); assert.equal(f.timers.size, 0);
    assert.equal(f.mounts.length, 1); assert.equal(f.raf.size, 0);
  }
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(f.actionCues.length, 0);
});

test('closing the full-body drawer stops only its active reference while ordinary emotions and saved meals retain their deadlines', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
  await f.bodyDrawer(); await f.click(f.focusButton('pet-body-motion-body_tail')); f.advance(700); f.ui.render();
  assert.equal(f.mounts.at(-1).options.situation, 'body_tail'); assert.equal(f.mounts.at(-1).options.elapsedMs, 700);
  assert.equal(f.focusButton('pet-body-motion').open, true, 'ordinary rendering keeps only the drawer preference and original cue age');
  await f.bodyDrawer(false);
  assert.equal(f.mounts.at(-1).changes.at(-1).name, 'idle'); assert.equal(f.host.querySelector('.ipg-lilac-visual').dataset.cuePhase, 'idle');
  assert.equal(f.timers.size, 0); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
  await f.bodyDrawer(); await f.click(await f.revealEmotion('angry'));
  const controller = f.mounts.at(-1), changes = controller.changes.length, deadline = [...f.timers.values()][0].at;
  await f.bodyDrawer(false); assert.equal(controller.changes.length, changes); assert.equal([...f.timers.values()][0].at, deadline);
  await f.click(f.focusButton('care-feed')); await f.bodyDrawer();
  const mealController = f.mounts.at(-1), mealChanges = mealController.changes.length, mealDeadline = [...f.timers.values()][0].at;
  const afterMeal = f.saved(), mealWrites = f.writes.length; await f.bodyDrawer(false);
  assert.equal(f.host.querySelector('.ipg-lilac-visual').dataset.situation, 'feeding');
  assert.equal(mealController.changes.length, mealChanges); assert.equal([...f.timers.values()][0].at, mealDeadline);
  assert.deepEqual(f.saved(), afterMeal); assert.equal(f.writes.length, mealWrites); assert.equal(afterMeal.pet.exp, before.pet.exp + 8);
});

test('main and appearance-reference body drawers keep their cues independent and drawing failure or hide stops every body control safely', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
  await f.bodyDrawer(); await f.click(f.focusButton('pet-body-motion-body_hands')); f.advance(600);
  await f.click(f.button('薄紫のこのしぐさを見る')); await f.bodyDrawer(true, true);
  const main = f.activeMotions().find(controller => !controller.canvas.parentNode.parentNode.className.includes('ipg-appearance-preview'));
  const preview = f.mounts.at(-1); await f.click(f.focusButton('preview-body-motion-body_ears'));
  assert.equal(main.options.situation, 'body_hands'); assert.equal(main.options.elapsedMs, 600);
  assert.equal(preview.changes.at(-1).name, 'body_ears'); await f.bodyDrawer(false, true);
  assert.equal(preview.changes.at(-1).name, 'idle'); assert.equal(main.changes.length, 0);
  await f.bodyDrawer(true, true); await f.click(f.focusButton('preview-body-motion-body_head'));
  preview.options.onError();
  const panel = f.host.querySelector('.ipg-appearance-preview');
  assert.ok(panel.querySelectorAll('button').filter(button => button.dataset.bodyMotion).every(button => button.disabled));
  assert.equal(panel.querySelector('.ipg-body-motion').querySelectorAll('p').find(node => node.textContent.includes('この環境では')).hidden, false);
  f.document.hidden = true; f.document.emit('visibilitychange'); await flush();
  assert.equal(f.timers.size, 0); assert.equal(f.activeMotions().length, 0);
  f.document.hidden = false; f.document.emit('visibilitychange'); await flush();
  assert.equal(f.focusButton('pet-body-motion').open, false);
  assert.notEqual(f.mounts.at(-1).options.situation, 'body_hands');
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('older optional motion modules keep 100 emotions without claiming to support unavailable full-body references', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
  delete f.window.PetLilacMotion.bodyCatalogue; f.ui.render(); const drawer = await f.bodyDrawer();
  assert.equal(drawer.querySelectorAll('button').length, 0); assert.match(drawer.textContent, /この環境では全身の動きの見本を表示できません/);
  assert.equal(f.buttons().filter(button => button.dataset.emotion).length, 100);
  await f.click(await f.revealEmotion('cry')); assert.equal(f.mounts.at(-1).changes.at(-1).name, 'cry');
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('renderer mouth frames move only visible food on a ready live meal and never schedule a second loop or write progress', async () => {
  const f = await fixture({ species: 'lilac' }); await f.click(f.focusButton('care-feed'));
  const controller = f.mounts.at(-1), food = f.host.querySelector('.ipg-feeding-food'), before = f.saved(), writes = f.writes.length;
  const fallback = { left: food.style.left, top: food.style.top }, pose = { situation: 'feeding', elapsedMs: 1500, mouthX: .31, mouthY: .405, foodLeft: .2, foodTop: .41 };
  controller.options.onPose(pose); assert.deepEqual({ left: food.style.left, top: food.style.top }, fallback, 'pending drawing keeps the static fallback anchor');
  f.advance(1500); controller.options.onReady(); assert.equal(food.hidden, false); assert.equal(f.host.querySelector('.ipg-lilac-visual').dataset.feedingPhase, 'chewing');
  const timer = [...f.timers.values()][0].at;
  controller.options.onPose(pose); assert.equal(food.style.left, '20%'); assert.equal(food.style.top, '41%');
  controller.options.onPose({ ...pose, situation: 'body_hands', foodLeft: .9 }); assert.equal(food.style.left, '20%');
  controller.options.onPose({ ...pose, foodLeft: NaN }); assert.equal(food.style.left, '20%');
  assert.equal([...f.timers.values()][0].at, timer); assert.equal(f.raf.size, 0);
  f.advance(2900); await f.fireTimers(); assert.equal(food.hidden, true);
  const hiddenAnchor = { left: food.style.left, top: food.style.top }; controller.options.onPose({ ...pose, foodLeft: .9 });
  assert.deepEqual({ left: food.style.left, top: food.style.top }, hiddenAnchor);
  await f.click(f.focusButton('pet-emotion-joy')); controller.options.onPose({ ...pose, foodLeft: .8 }); assert.equal(food.style.left, hiddenAnchor.left);
  f.ui.render(); controller.options.onPose({ ...pose, foodLeft: .7 }); assert.equal(food.style.left, hiddenAnchor.left, 'disconnected old canvas callbacks cannot move old food');
  f.document.hidden = true; f.document.emit('visibilitychange'); await flush();
  f.mounts.at(-1).options.onPose(pose); assert.equal(f.timers.size, 0); assert.equal(f.raf.size, 0);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('four direction references keep the 100 moods and six body controls separate while returning to idle without savings or remounts', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '373', pg_coins: '355' }, setup: async store => {
    await store.dispatch({ type: 'buyItem', itemId: 'cloth_cream_vest' }); await store.dispatch({ type: 'equipClothing', itemId: 'cloth_cream_vest' });
  } }), before = f.saved(), writes = f.writes.length;
  const drawer = await f.directionDrawer(), controller = f.mounts[0], visual = f.host.querySelector('.ipg-lilac-visual');
  assert.equal(drawer.querySelector('summary').textContent, '向きと回転を見る'); assert.match(drawer.textContent, /終わると正面に戻ります/);
  assert.deepEqual(drawer.querySelectorAll('button').map(button => button.dataset.directionMotion), ['direction_left', 'direction_right', 'direction_back', 'direction_spin']);
  assert.equal(f.buttons().filter(button => button.dataset.emotion).length, 100); assert.equal(f.buttons().filter(button => button.dataset.bodyMotion).length, 6);
  assert.equal(controller.options.growthStage, 'final'); assert.equal(controller.options.outfit, 'cloth_cream_vest');
  for (const [i, row] of Motion.directionCatalogue.entries()) {
    assert.equal(row.durationMs, [6000, 6000, 6500, 6800][i]);
    const choice = f.focusButton('pet-direction-motion-' + row.id);
    assert.equal(choice.getAttribute('aria-label'), row.label); assert.equal(choice.getAttribute('aria-description'), '顔：' + row.face + '。動き：' + row.motion);
    await f.click(choice); assert.equal(controller.changes.at(-1).name, row.id); assert.equal(visual.dataset.cuePhase, 'enter');
    assert.equal(choice.getAttribute('aria-pressed'), 'true'); assert.equal(f.host.querySelector('.ipg-emotion-caption').textContent, row.label + 'の見本');
    assert.ok(visual.querySelector('canvas').getAttribute('aria-label').includes(row.label));
    assert.equal(f.host.querySelector('.ipg-emotion-effect').hidden, true); assert.equal(f.host.querySelector('.ipg-feeding-food').hidden, true);
    f.advance(450); await f.fireTimers(); assert.equal(visual.dataset.cuePhase, 'acting');
    f.advance(row.durationMs - 1250); await f.fireTimers(); assert.equal(visual.dataset.cuePhase, 'settling');
    f.advance(800); await f.fireTimers(); assert.equal(visual.dataset.situation, 'idle'); assert.equal(visual.dataset.cuePhase, 'idle');
    assert.equal(f.timers.size, 0); assert.equal(f.raf.size, 0); assert.equal(f.mounts.length, 1);
  }
  const input = f.focusButton('pet-emotion-search'); input.value = 'direction_spin'; input.emit('input'); await flush();
  assert.match(f.host.querySelector('.ipg-emotion-count').textContent, /全100種類 · 検索0件/);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(f.actionCues.length, 0);
});

test('closing a direction drawer cancels only that kind of reference and leaves body, ordinary emotion and meal deadlines intact', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
  await f.directionDrawer(); await f.click(f.focusButton('pet-direction-motion-direction_left')); await f.directionDrawer(false);
  assert.equal(f.mounts[0].changes.at(-1).name, 'idle'); assert.equal(f.timers.size, 0);
  for (const id of ['body_tail', 'cry', 'feeding']) {
    await f.directionDrawer();
    if (id === 'body_tail') { await f.bodyDrawer(); await f.click(f.focusButton('pet-body-motion-' + id)); }
    else await f.click(await f.revealEmotion(id));
    const changes = f.mounts[0].changes.length, deadline = [...f.timers.values()][0].at;
    await f.directionDrawer(false); assert.equal(f.mounts[0].changes.length, changes);
    assert.equal(f.host.querySelector('.ipg-lilac-visual').dataset.situation, id); assert.equal([...f.timers.values()][0].at, deadline);
  }
  await f.directionDrawer(); await f.click(f.focusButton('pet-direction-motion-direction_back'));
  const deadline = [...f.timers.values()][0].at, changes = f.mounts[0].changes.length;
  await f.bodyDrawer(false); assert.equal(f.mounts[0].changes.length, changes); assert.equal([...f.timers.values()][0].at, deadline);
  assert.equal(f.host.querySelector('.ipg-lilac-visual').dataset.situation, 'direction_back');
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('main and preview directions preserve elapsed ages on delayed drawing, remain separate and do not replay after hide', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
  await f.directionDrawer(); await f.click(f.focusButton('pet-direction-motion-direction_spin')); f.advance(900);
  f.rendererControl.mode = 'pending'; f.ui.render();
  const main = f.mounts.at(-1); assert.equal(main.options.situation, 'direction_spin'); assert.equal(main.options.elapsedMs, 900);
  assert.equal(f.focusButton('pet-direction-motion').open, true); f.advance(400); main.options.onReady();
  assert.equal(f.host.querySelector('.ipg-lilac-visual').dataset.cuePhase, 'acting'); assert.equal(main.changes.length, 0);
  f.rendererControl.mode = 'ready'; await f.click(f.button('薄紫のこのしぐさを見る')); await f.directionDrawer(true, true);
  const mainLive = f.activeMotions()[0], preview = f.mounts.at(-1); await f.click(f.focusButton('preview-direction-motion-direction_right'));
  assert.equal(mainLive.options.situation, 'direction_spin'); assert.equal(mainLive.options.elapsedMs, 1300); assert.equal(mainLive.changes.length, 0);
  assert.equal(preview.changes.at(-1).name, 'direction_right'); await f.directionDrawer(false, true);
  assert.equal(preview.changes.at(-1).name, 'idle'); assert.equal(mainLive.changes.length, 0);
  await f.directionDrawer(true, true); await f.click(f.focusButton('preview-direction-motion-direction_left'));
  f.document.hidden = true; f.document.emit('visibilitychange'); await flush(); assert.equal(f.timers.size, 0); assert.equal(f.activeMotions().length, 0);
  f.document.hidden = false; f.document.emit('visibilitychange'); await flush();
  assert.equal(f.focusButton('pet-direction-motion').open, false); assert.equal(f.host.querySelector('.ipg-appearance-preview'), null);
  assert.notEqual(f.mounts.at(-1).options.situation, 'direction_spin'); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('switching a meal reference to a direction hides food immediately and rejects old mouth frames throughout turning and after cleanup', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
  await f.click(await f.revealEmotion('feeding')); f.advance(1500); await f.fireTimers();
  const controller = f.mounts[0], food = f.host.querySelector('.ipg-feeding-food'); assert.equal(food.hidden, false);
  await f.directionDrawer(); await f.click(f.focusButton('pet-direction-motion-direction_back'));
  assert.equal(food.hidden, true); assert.equal(f.host.querySelector('.ipg-lilac-visual').dataset.feedingPhase, '');
  const anchor = { left: food.style.left, top: food.style.top };
  controller.options.onPose({ situation: 'feeding', elapsedMs: 1600, foodLeft: .1, foodTop: .2 });
  assert.deepEqual({ left: food.style.left, top: food.style.top }, anchor);
  f.advance(6500); await f.fireTimers(); assert.equal(food.hidden, true); assert.equal(f.host.querySelector('.ipg-lilac-visual').dataset.situation, 'idle');
  await f.click(f.focusButton('pet-direction-motion-direction_spin')); await f.ui.close();
  controller.options.onPose({ situation: 'feeding', elapsedMs: 1900, foodLeft: .2, foodTop: .3 });
  assert.deepEqual({ left: food.style.left, top: food.style.top }, anchor); assert.equal(f.timers.size, 0); assert.equal(f.raf.size, 0);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('missing direction support or a drawing failure is labelled honestly without disabling the older 100 and body APIs', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
  const catalogue = f.window.PetLilacMotion.directionCatalogue; delete f.window.PetLilacMotion.directionCatalogue; f.ui.render();
  let drawer = await f.directionDrawer(); assert.equal(drawer.querySelectorAll('button').length, 0);
  assert.match(drawer.textContent, /この環境では向きと回転の見本を表示できません/);
  assert.equal(f.buttons().filter(button => button.dataset.emotion).length, 100); assert.equal(f.buttons().filter(button => button.dataset.bodyMotion).length, 6);
  await f.bodyDrawer(); await f.click(f.focusButton('pet-body-motion-body_ears')); assert.equal(f.mounts.at(-1).changes.at(-1).name, 'body_ears');
  f.window.PetLilacMotion.directionCatalogue = catalogue; f.ui.render(); drawer = await f.directionDrawer();
  await f.click(f.focusButton('pet-direction-motion-direction_back')); f.mounts.at(-1).options.onError();
  assert.ok(drawer.querySelectorAll('button').every(button => button.disabled)); assert.equal(f.timers.size, 0);
  assert.equal(drawer.querySelectorAll('p').find(node => node.textContent.includes('この環境では')).hidden, false);
  assert.equal(f.host.querySelector('.ipg-lilac-visual').dataset.cuePhase, 'idle'); assert.equal(f.host.querySelector('canvas').hidden, true);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('emotion effects, deadlines and drawing are cleaned on hide, close and fallback', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' });
  await f.click(f.focusButton('pet-emotion-love'));
  const effect = f.host.querySelector('.ipg-emotion-effect'), controller = f.mounts.at(-1);
  assert.equal(effect.hidden, false); assert.equal(f.timers.size, 1);
  f.document.hidden = true; f.document.emit('visibilitychange'); await flush();
  assert.equal(effect.hidden, true); assert.equal(effect.children.length, 0); assert.equal(f.timers.size, 0); assert.equal(controller.destroyed, true);
  f.document.hidden = false; f.document.emit('visibilitychange'); await flush();
  await f.click(f.focusButton('pet-emotion-love'));
  const nextEffect = f.host.querySelector('.ipg-emotion-effect');
  f.mounts.at(-1).options.onError();
  assert.equal(nextEffect.hidden, true); assert.equal(nextEffect.children.length, 0); assert.equal(f.timers.size, 0);
  assert.ok(f.host.querySelectorAll('button').filter(b => b.dataset.emotion).every(b => b.disabled));
  assert.equal(f.host.querySelector('canvas').hidden, true); assert.equal(f.host.querySelector('.ipg-lilac-still').hidden, false);
  await f.ui.close(); assert.equal(f.timers.size, 0); assert.equal(f.activeMotions().length, 0);
});

test('zero-EXP B starts visible with all 100 emotions enabled and safe preview adds no growth or rewards', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '0' } }), before = f.saved(), writes = f.writes.length;
  const panel = f.host.querySelector('.ipg-emotion-panel'), choices = panel.querySelectorAll('button').filter(b => b.dataset.emotion);
  assert.equal(choices.length, 100); assert.ok(choices.every(b => !b.disabled));
  assert.equal(f.mounts.length, 1); assert.equal(f.store.getState().stage.key, 'egg');
  assert.equal(f.saved().pet.exp, 0); assert.match(f.host.querySelector('.ipg-lilac-still').src, /pet_lilac_cutout\.webp$/);
  for (const [i, id] of Motion.situations.entries()) {
    await f.click(await f.revealEmotion(id)); assert.equal(f.mounts[0].changes.at(-1).name, id);
    assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
  }
  await f.click(f.button('薄紫のこのしぐさを見る'));
  const preview = f.host.querySelector('.ipg-appearance-preview');
  assert.equal(preview.querySelectorAll('button').filter(b => b.dataset.emotion).length, 100);
  assert.equal(f.activeMotions().length, 2); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('reduced-motion CSS suppresses accent animation and hidden groups are removed from layout', () => {
  const css = fs.readFileSync(require.resolve('../static/pet-game.css'), 'utf8');
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.ipg-lilac-visual>\.ipg-emotion-effect\{display:none!important\}\.ipg-emotion-mote,\.ipg-feeding-food\{animation:none!important/);
  assert.match(css, /\.ipg-emotion-grid\[hidden\]\{display:none!important\}/);
});

test('B care keeps its face and emotion controls together before progress while old layouts stay intact', async () => {
  const b = await fixture({ species: 'lilac', rendererMode: 'ready' });
  const card = b.host.querySelector('.ipg-pet-card'), stage = card.querySelector('.ipg-emotion-stage');
  assert.ok(stage); assert.equal(card.children[0], stage);
  assert.equal(stage.children[0], stage.querySelector('.ipg-scene'));
  assert.equal(stage.children[1], stage.querySelector('.ipg-emotion-panel'));
  assert.ok(stage.querySelector('canvas'), 'face remains alongside the emotion palette');
  assert.equal(card.querySelectorAll('.ipg-emotion-panel').length, 1);
  assert.ok(card.children.indexOf(card.querySelector('.ipg-pet-name')) > card.children.indexOf(stage));
  assert.ok(card.children.indexOf(card.querySelector('.ipg-care-buttons')) > card.children.indexOf(stage));
  await b.click(b.focusButton('pet-emotion-group-deep'));
  await b.click(b.focusButton('pet-emotion-angry'));
  assert.equal(stage.querySelector('.ipg-emotion-caption').textContent, '怒るのしぐさ');
  const old = await fixture({ seed: { pg_species: 'bunny', pg_exp: '167' } });
  assert.equal(old.host.querySelector('.ipg-emotion-stage'), null);
  assert.equal(old.host.querySelector('.ipg-pet-card').children[0], old.host.querySelector('.ipg-scene'));
});

test('one confirmed meal shows food, shrinking bites, then happy hearts and returns to idle without further rewards', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '0' } });
  f.advance(10000); f.ui.render(); const before = f.saved(), writes = f.writes.length;
  await f.click(f.focusButton('care-feed'));
  const after = f.saved(), wrap = f.host.querySelector('.ipg-lilac-visual'), food = wrap.querySelector('.ipg-feeding-food');
  const effect = wrap.querySelector('.ipg-emotion-effect'), caption = f.host.querySelector('.ipg-emotion-caption');
  assert.equal(after.pet.exp, 8); assert.equal(after.coins, before.coins + 10); assert.equal(f.writes.length, writes + 1);
  assert.equal(wrap.dataset.situation, 'feeding'); assert.equal(wrap.dataset.feedingPhase, 'anticipation');
  assert.equal(food.hidden, false); assert.equal(food.dataset.bites, '0'); assert.equal(effect.hidden, true);
  assert.match(caption.textContent, /ごはん、うれしいな/); assert.equal(f.timers.size, 1);
  const steps = [
    [1200, 'chewing', true, '0', 'もぐもぐ'], [1088, 'chewing', true, '1', 'もぐもぐ'],
    [1088, 'chewing', true, '2', 'もぐもぐ'], [1024, 'joy', false, '2', 'おいしい！'],
    [2800, 'settling', false, '2', 'ごちそうさま']
  ];
  for (const [ms, phase, visible, bites, label] of steps) {
    f.advance(ms); await f.fireTimers();
    assert.equal(wrap.dataset.feedingPhase, phase); assert.equal(food.hidden, !visible); assert.equal(food.dataset.bites, bites);
    assert.ok(caption.textContent.includes(label)); assert.equal(f.timers.size, 1);
    assert.equal(effect.hidden, false); assert.ok(effect.className.includes(phase === 'chewing' ? 'ipg-effect-crumbs' : 'ipg-effect-hearts'));
    assert.deepEqual(f.saved(), after); assert.equal(f.writes.length, writes + 1); assert.equal(f.actionCues.length, 1);
  }
  f.advance(1200); await f.fireTimers();
  assert.equal(wrap.dataset.situation, 'idle'); assert.equal(wrap.dataset.feedingPhase, '');
  assert.equal(food.hidden, true); assert.equal(effect.hidden, true); assert.equal(effect.children.length, 0);
  assert.match(caption.textContent, /ふだん/); assert.equal(f.focusButton('pet-emotion-idle').getAttribute('aria-pressed'), 'true');
  assert.equal(f.timers.size, 0); assert.equal(f.raf.size, 0); assert.deepEqual(f.saved(), after); assert.equal(f.writes.length, writes + 1);
});

test('using owned food gets the same finite food-to-happiness timeline with only its confirmed item write', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' });
  await f.click(f.focusButton('tab-shop')); const before = f.saved(), writes = f.writes.length;
  const rice = f.host.querySelectorAll('article').find(row => row.querySelector('h4')?.textContent === 'おにぎり');
  await f.click(rice.querySelectorAll('button').find(b => b.textContent === '使う'));
  const after = f.saved(), wrap = f.host.querySelector('.ipg-lilac-visual'), food = wrap.querySelector('.ipg-feeding-food');
  assert.equal(after.pet.exp, before.pet.exp + 4); assert.equal(after.inventory.rice, before.inventory.rice - 1); assert.equal(after.coins, before.coins);
  assert.equal(food.hidden, false); assert.equal(wrap.dataset.feedingPhase, 'anticipation');
  f.advance(4400); await f.fireTimers();
  assert.equal(wrap.dataset.feedingPhase, 'joy'); assert.equal(food.hidden, true);
  assert.ok(wrap.querySelector('.ipg-emotion-effect').className.includes('ipg-effect-hearts'));
  assert.match(wrap.querySelector('canvas').getAttribute('aria-label'), /おいしい！/);
  f.advance(4000); await f.fireTimers(); assert.equal(wrap.dataset.situation, 'idle'); assert.equal(food.hidden, true);
  assert.equal(wrap.querySelector('.ipg-emotion-effect').hidden, true); assert.equal(f.timers.size, 0);
  assert.deepEqual(f.saved(), after); assert.equal(f.writes.length, writes + 1); assert.equal(f.actionCues.length, 1);
});

test('replacing a meal removes stale food; rerender keeps its elapsed phase and hide or reopen does not replay it', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' });
  await f.click(f.focusButton('care-feed')); let mealWrap = f.host.querySelector('.ipg-lilac-visual');
  const firstFood = mealWrap.querySelector('.ipg-feeding-food'); assert.equal(firstFood.hidden, false);
  f.advance(500); await f.click(f.focusButton('pet-emotion-angry'));
  assert.equal(firstFood.hidden, true); assert.equal(mealWrap.dataset.situation, 'angry'); assert.equal(mealWrap.dataset.feedingPhase, '');
  f.advance(8401); await f.fireTimers(); assert.equal(firstFood.hidden, true); assert.equal(mealWrap.dataset.situation, 'idle');
  await f.click(f.focusButton('care-feed')); f.advance(1200); await f.fireTimers();
  const before = f.saved(), writes = f.writes.length, oldController = f.mounts.at(-1), oldWrap = f.host.querySelector('.ipg-lilac-visual');
  assert.equal(oldWrap.dataset.feedingPhase, 'chewing'); f.ui.render();
  mealWrap = f.host.querySelector('.ipg-lilac-visual'); assert.equal(oldController.destroyed, true);
  assert.equal(oldWrap.querySelector('.ipg-feeding-food').hidden, true); assert.equal(f.mounts.at(-1).options.elapsedMs, 1200);
  assert.equal(mealWrap.dataset.feedingPhase, 'chewing'); assert.equal(mealWrap.querySelector('.ipg-feeding-food').hidden, false);
  assert.equal(f.timers.size, 1); assert.equal(f.activeMotions().length, 1);
  f.document.hidden = true; f.document.emit('visibilitychange'); await flush();
  assert.equal(mealWrap.querySelector('.ipg-feeding-food').hidden, true); assert.equal(f.timers.size, 0); assert.equal(f.activeMotions().length, 0);
  f.document.hidden = false; f.document.emit('visibilitychange'); await flush();
  const resumed = f.host.querySelector('.ipg-lilac-visual');
  assert.notEqual(resumed.dataset.situation, 'feeding'); assert.equal(resumed.dataset.feedingPhase, '');
  assert.equal(resumed.querySelector('.ipg-feeding-food').hidden, true); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
  await f.ui.close(); f.pane.hidden = true; assert.equal(f.timers.size, 0);
  f.pane.hidden = false; await f.ui.open(); assert.notEqual(f.host.querySelector('.ipg-lilac-visual').dataset.situation, 'feeding');
  assert.equal(f.host.querySelector('.ipg-feeding-food').hidden, true); assert.deepEqual(f.saved(), before);
});

test('pending or failed meal saves cannot show food or happy meal feedback, and drawing fallback clears every meal phase', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' }); f.advance(10000); f.ui.render();
  const before = f.saved(), gate = deferred(), count = f.actionCues.length;
  f.control.pending = gate; f.control.outcome = 'false'; await f.click(f.focusButton('care-feed'));
  assert.equal(f.host.querySelector('.ipg-feeding-food').hidden, true); assert.equal(f.host.querySelector('.ipg-emotion-effect').hidden, true);
  assert.equal(f.actionCues.length, count); assert.deepEqual(f.saved(), before);
  gate.resolve(); await flush(); f.control.pending = null;
  assert.equal(f.host.querySelector('.ipg-feeding-food').hidden, true); assert.equal(f.host.querySelector('.ipg-emotion-effect').hidden, true);
  assert.equal(f.host.querySelector('.ipg-lilac-visual').dataset.situation, 'idle'); assert.deepEqual(f.saved(), before);
  f.control.outcome = 'ok'; await f.click(f.focusButton('care-feed'));
  const after = f.saved(), wrap = f.host.querySelector('.ipg-lilac-visual'); assert.equal(wrap.querySelector('.ipg-feeding-food').hidden, false);
  f.advance(1200); await f.fireTimers(); f.mounts.at(-1).options.onError();
  assert.equal(wrap.querySelector('.ipg-feeding-food').hidden, true); assert.equal(wrap.querySelector('.ipg-emotion-effect').hidden, true); assert.equal(f.timers.size, 0);
  f.advance(7200); await f.fireTimers(); assert.equal(wrap.querySelector('.ipg-feeding-food').hidden, true);
  assert.equal(wrap.querySelector('.ipg-emotion-effect').hidden, true); assert.equal(f.timers.size, 0); assert.deepEqual(f.saved(), after);
});

test('a 373 EXP B has an honest next goal of 400 EXP without changing any saved progress', async () => {
  assert.equal(typeof Core.getLilacGrowth, 'function');
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '373' } }), before = f.saved(), writes = f.writes.length;
  assert.equal(f.host.querySelector('.ipg-stage').textContent, 'わかもの · 373 EXP');
  assert.ok(f.host.textContent.includes('次の成長まで あと27 EXP'));
  assert.equal(f.host.querySelector('progress').value, Core.getLilacGrowth(373).progress);
  assert.equal(f.mounts.at(-1).options.growthStage, 'final');
  assert.equal(f.host.querySelector('.ipg-lilac-visual').dataset.growthStage, 'final');
  assert.equal(f.store.getState().stage.key, 'final', 'old core appearance/reward stage still remains readable');
  f.window.emit('focus'); await flush();
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(f.actionCues.length, 0);
});

test('growth album previews all six stages in one canvas and future views never grant EXP, coins or an unlock', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '373' } }), before = f.saved(), writes = f.writes.length;
  await f.click(f.focusButton('growth-album-toggle'));
  assert.equal(f.focusButton('growth-album-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(f.host.querySelector('.ipg-growth-gallery').querySelectorAll('canvas').length, 1);
  assert.equal(f.mounts.at(-1).options.growthStage, 'final'); assert.equal(f.mounts.at(-1).options.situation, 'idle');
  assert.match(f.host.querySelector('.ipg-growth-caption').textContent, /わかもの.*いまの姿/);
  assert.equal(f.host.querySelectorAll('button').filter(button => button.dataset.growthStage).length, 6);
  for (const entry of Core.lilacGrowthStages) {
    const previous = f.mounts.at(-1); await f.click(f.focusButton('growth-stage-' + entry.key));
    assert.equal(previous.destroyed, true); assert.equal(f.activeMotions().length, 2);
    assert.equal(f.host.querySelector('.ipg-growth-gallery').querySelectorAll('canvas').length, 1);
    assert.equal(f.mounts.at(-1).options.growthStage, entry.key); assert.equal(f.mounts.at(-1).options.situation, 'idle');
    assert.equal(f.focusButton('growth-stage-' + entry.key).getAttribute('aria-pressed'), 'true');
    const caption = f.host.querySelector('.ipg-growth-caption').textContent;
    assert.ok(caption.includes(entry.label)); assert.ok(caption.includes(entry.min > 373 ? 'これからの姿・見本' : entry.key === 'final' ? 'いまの姿' : '育った姿の見本'));
    assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(f.actionCues.length, 0);
    assert.equal(f.host.querySelector('.ipg-stage').textContent, 'わかもの · 373 EXP');
  }
  assert.match(f.focusButton('growth-stage-adult').textContent, /400 EXP.*これから/);
  assert.match(f.focusButton('growth-stage-companion').textContent, /800 EXP.*これから/);
  await f.click(f.focusButton('growth-album-toggle'));
  assert.equal(f.host.querySelector('.ipg-growth-gallery'), null); assert.equal(f.activeMotions().length, 1);
  await f.click(f.focusButton('growth-album-toggle')); assert.equal(f.mounts.at(-1).options.growthStage, 'final', 'reopen starts at the real current stage');
  f.document.hidden = true; f.document.emit('visibilitychange'); await flush(); assert.equal(f.activeMotions().length, 0); assert.equal(f.timers.size, 0);
  f.document.hidden = false; f.document.emit('visibilitychange'); await flush();
  assert.equal(f.host.querySelector('.ipg-growth-gallery'), null); assert.equal(f.activeMotions().length, 1);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('crossing 400 EXP adopts the new visible growth only after a confirmed save and never cuts off the meal', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '397' } });
  f.advance(10000); f.ui.render(); const before = f.saved(), gate = deferred();
  f.control.pending = gate; f.control.outcome = 'false'; await f.click(f.focusButton('care-rest'));
  assert.equal(f.host.querySelector('.ipg-stage').textContent, 'わかもの · 397 EXP');
  assert.equal(f.mounts.at(-1).options.growthStage, 'final'); assert.deepEqual(f.saved(), before);
  gate.resolve(); await flush(); f.control.pending = null;
  assert.equal(f.host.querySelector('.ipg-stage').textContent, 'わかもの · 397 EXP'); assert.deepEqual(f.saved(), before);
  assert.equal(f.mounts.at(-1).options.situation, 'idle');
  f.control.outcome = 'ok'; await f.click(f.focusButton('care-rest'));
  assert.equal(f.saved().pet.exp, 401); assert.equal(f.saved().coins, before.coins + 10);
  assert.equal(f.mounts.at(-1).options.growthStage, 'adult'); assert.equal(f.mounts.at(-1).options.situation, 'joy');
  assert.equal(f.host.querySelector('.ipg-stage').textContent, 'おとな · 401 EXP'); assert.ok(f.host.textContent.includes('あと399 EXP'));
  const meal = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '397' } }), old = meal.saved();
  await meal.click(meal.focusButton('care-feed'));
  assert.equal(meal.saved().pet.exp, 405); assert.equal(meal.saved().coins, old.coins + 10);
  assert.equal(meal.mounts.at(-1).options.growthStage, 'adult'); assert.equal(meal.mounts.at(-1).options.situation, 'feeding');
  assert.equal(meal.host.querySelector('.ipg-lilac-visual').dataset.feedingPhase, 'anticipation');
  meal.advance(4400); await meal.fireTimers(); assert.equal(meal.host.querySelector('.ipg-lilac-visual').dataset.feedingPhase, 'joy');
});

test('all six growth stages reach the renderer and attach food to that stage mouth without CSS scaling twice', async () => {
  assert.equal(typeof Motion.feedingAnchor, 'function');
  for (const entry of Core.lilacGrowthStages) {
    const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: String(entry.min) } });
    await f.click(f.focusButton('care-feed'));
    const food = f.host.querySelector('.ipg-feeding-food'), anchor = Motion.feedingAnchor(entry.key);
    assert.equal(f.mounts.at(-1).options.growthStage, entry.key); assert.equal(food.hidden, false);
    assert.equal(food.style.left, String(anchor.foodLeft * 100) + '%'); assert.equal(food.style.top, String(anchor.foodTop * 100) + '%');
    assert.equal(f.saved().pet.exp, entry.min + 8);
  }
  const css = fs.readFileSync(require.resolve('../static/pet-game.css'), 'utf8');
  assert.doesNotMatch(css, /\.ipg-lilac-stage-(?:egg|baby|child)\{transform:scale/);
});

test('growth album isolates its idle preview and preserves the current meal age and pending food deadline', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '373' } });
  await f.click(f.focusButton('care-feed')); f.advance(1500); await f.fireTimers();
  const after = f.saved(), writes = f.writes.length;
  await f.click(f.focusButton('growth-album-toggle'));
  assert.equal(f.activeMotions().length, 2); assert.equal(f.activeMotions()[0].options.situation, 'feeding');
  assert.equal(f.activeMotions()[0].options.elapsedMs, 1500); assert.equal(f.activeMotions()[0].options.growthStage, 'final');
  assert.equal(f.mounts.at(-1).options.situation, 'idle'); assert.equal(f.mounts.at(-1).options.growthStage, 'final');
  assert.equal(f.host.querySelector('.ipg-growth-gallery').querySelector('.ipg-feeding-food').hidden, true);
  assert.equal(f.timers.size, 1);
  await f.click(f.focusButton('growth-stage-companion'));
  assert.equal(f.activeMotions()[0].options.situation, 'feeding'); assert.equal(f.activeMotions()[0].options.elapsedMs, 1500);
  assert.equal(f.mounts.at(-1).options.growthStage, 'companion'); assert.equal(f.mounts.at(-1).options.situation, 'idle');
  assert.equal(f.host.querySelector('.ipg-growth-gallery').querySelector('.ipg-feeding-food').hidden, true); assert.equal(f.timers.size, 1);
  f.advance(2900); await f.fireTimers();
  assert.equal(f.host.querySelector('.ipg-emotion-stage').querySelector('.ipg-lilac-visual').dataset.feedingPhase, 'joy');
  assert.equal(f.host.querySelector('.ipg-growth-gallery').querySelector('.ipg-lilac-visual').dataset.situation, 'idle');
  assert.deepEqual(f.saved(), after); assert.equal(f.writes.length, writes);
  await f.ui.close(); assert.equal(f.activeMotions().length, 0); assert.equal(f.timers.size, 0);
});

test('switching a grown bunny to B uses existing EXP without calling the species change a new growth event', async () => {
  const f = await fixture({ rendererMode: 'ready', seed: { pg_species: 'bunny', pg_exp: '800' } }), before = f.saved();
  await f.click(f.button('薄紫のこ（B）'));
  assert.equal(f.saved().pet.species, 'lilac'); assert.equal(f.saved().pet.exp, 800); assert.equal(f.saved().coins, before.coins);
  assert.equal(f.mounts.at(-1).options.growthStage, 'companion'); assert.equal(f.mounts.at(-1).options.situation, 'greeting');
  assert.ok(!f.host.querySelector('.ipg-notice').textContent.includes('進化しました'));
  assert.equal(f.host.querySelector('.ipg-stage').textContent, 'なかよしの姿 · 800 EXP');
  assert.equal(f.saved().revision, before.revision + 1);
});

test('growth drawing failure labels its reference fallback honestly and keeps all progress intact', async () => {
  const f = await fixture({ rendererMode: 'error', species: 'lilac', seed: { pg_exp: '373' } }), before = f.saved(), writes = f.writes.length;
  await f.click(f.focusButton('growth-album-toggle'));
  await f.click(f.focusButton('growth-stage-companion'));
  const gallery = f.host.querySelector('.ipg-growth-gallery');
  assert.equal(gallery.querySelector('canvas').hidden, true); assert.equal(gallery.querySelector('.ipg-lilac-still').hidden, false);
  assert.match(gallery.querySelector('.ipg-growth-caption').textContent, /成長の動きを表示できないため、基準の絵/);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(f.timers.size, 0);
});

test('the clothes shop preserves old absent wardrobe records and fits all six unowned clothes with one preview only', async () => {
  const original = await fixture(), old = original.saved(); delete old.wardrobe;
  const f = await fixture({ rendererMode: 'ready', seed: { [Core.KEY]: JSON.stringify(old) } }), before = f.saved(), writes = f.writes.length;
  assert.equal(before.wardrobe, undefined); assert.equal(f.mounts.at(-1).options.outfit, null);
  await f.click(f.focusButton('tab-shop'));
  const clothes = Core.items.filter(entry => entry.type === 'clothing'); assert.equal(clothes.length, 6);
  assert.equal(f.host.querySelectorAll('.ipg-clothing-item').length, 6); assert.equal(f.host.querySelector('.ipg-outfit-fitting'), null);
  assert.ok(f.host.querySelector('.ipg-clothes-shop').textContent.includes('薄紫のこ（B）のお洋服'));
  assert.ok(f.host.querySelectorAll('.ipg-shop-item').every(row => !clothes.some(entry => row.textContent.includes(entry.name))));
  for (const entry of clothes) {
    const oldControllers = f.activeMotions(); await f.click(f.focusButton('outfit-try-' + entry.id));
    assert.ok(oldControllers.every(controller => controller.destroyed));
    const fitting = f.host.querySelector('.ipg-outfit-fitting'); assert.ok(fitting);
    assert.equal(fitting.querySelectorAll('canvas').length, 1); assert.equal(f.activeMotions().length, 2);
    assert.equal(f.activeMotions()[0].options.outfit, null); assert.equal(f.mounts.at(-1).options.outfit, entry.id);
    assert.equal(f.mounts.at(-1).options.situation, 'idle'); assert.equal(f.mounts.at(-1).options.growthStage, 'baby');
    assert.ok(fitting.querySelector('.ipg-fitting-caption').textContent.includes('未購入・試着の見本'));
    assert.ok(fitting.querySelector('.ipg-fitting-caption').textContent.includes(entry.name));
    assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(f.actionCues.length, 0);
  }
  await f.click(f.button('試着を閉じる')); assert.equal(f.host.querySelector('.ipg-outfit-fitting'), null); assert.equal(f.activeMotions().length, 1);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('buying even the zero-coin starter vest waits for a confirmed write and never equips automatically', async () => {
  for (const outcome of ['false', 'throw']) {
    const f = await fixture({ rendererMode: 'ready' }); await f.click(f.focusButton('tab-shop'));
    const before = f.saved(), writes = f.writes.length, gate = deferred();
    f.control.pending = gate; f.control.outcome = outcome; await f.click(f.focusButton('outfit-buy-cloth_cream_vest'));
    assert.deepEqual(f.saved(), before); assert.equal(f.activeMotions()[0].options.outfit, null);
    gate.resolve(); await flush(); f.control.pending = null;
    assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(f.activeMotions()[0].options.outfit, null);
    assert.ok(f.focusButton('outfit-buy-cloth_cream_vest')); f.control.outcome = 'ok';
    await f.click(f.focusButton('outfit-buy-cloth_cream_vest'));
    const bought = f.saved(); assert.equal(bought.wardrobe.owned.cloth_cream_vest, true); assert.equal(bought.wardrobe.equipped, null);
    assert.equal(bought.coins, before.coins); assert.equal(bought.pet.exp, before.pet.exp); assert.equal(f.writes.length, writes + 1);
    assert.equal(f.activeMotions()[0].options.outfit, null); assert.equal(f.focusButton('outfit-wear-cloth_cream_vest').textContent, '着る');
  }
});

test('paid clothing uses the same wallet exactly once; ownership and wearing are separate saved transitions', async () => {
  const f = await fixture({ rendererMode: 'ready' }); await f.click(f.focusButton('tab-shop'));
  const before = f.saved(), writes = f.writes.length, oldBuy = f.focusButton('outfit-buy-cloth_sky_overalls');
  await f.click(oldBuy); const bought = f.saved();
  assert.equal(bought.coins, before.coins - 45); assert.equal(bought.pet.exp, before.pet.exp);
  assert.deepEqual(bought.market, before.market); assert.deepEqual(bought.inventory, before.inventory); assert.deepEqual(bought.decorations, before.decorations);
  assert.equal(bought.wardrobe.owned.cloth_sky_overalls, true); assert.equal(bought.wardrobe.equipped, null);
  assert.equal(f.writes.length, writes + 1); oldBuy.emit('click'); await flush();
  assert.deepEqual(f.saved(), bought); assert.equal(f.writes.length, writes + 1, 'queued duplicate purchase cannot charge twice');
  const gate = deferred(); f.control.pending = gate; await f.click(f.focusButton('outfit-wear-cloth_sky_overalls'));
  assert.deepEqual(f.saved(), bought); assert.equal(f.activeMotions()[0].options.outfit, null);
  gate.resolve(); await flush(); f.control.pending = null;
  assert.equal(f.saved().wardrobe.equipped, 'cloth_sky_overalls'); assert.equal(f.saved().coins, bought.coins); assert.equal(f.saved().pet.exp, bought.pet.exp);
  assert.equal(f.activeMotions()[0].options.outfit, 'cloth_sky_overalls'); assert.equal(f.writes.length, writes + 2);
  assert.equal(f.focusButton('outfit-wear-cloth_sky_overalls').disabled, true);
  assert.ok(f.host.querySelector('.ipg-worn-outfit').textContent.includes('そらいろサロペット'));
});

test('failed changing or removing clothes retains the actual saved outfit, wallet and independent decoration', async () => {
  for (const outcome of ['false', 'throw']) {
    const f = await fixture({ rendererMode: 'ready', setup: async app => {
      for (const id of ['cloth_cream_vest', 'cloth_rose_cape', 'house']) assert.equal((await app.dispatch({ type: 'buyItem', itemId: id })).ok, true);
      assert.equal((await app.dispatch({ type: 'equipClothing', itemId: 'cloth_cream_vest' })).ok, true);
      assert.equal((await app.dispatch({ type: 'equip', itemId: 'house' })).ok, true);
    } });
    await f.click(f.focusButton('tab-shop')); const before = f.saved(), writes = f.writes.length, gate = deferred();
    f.control.pending = gate; f.control.outcome = outcome; await f.click(f.focusButton('outfit-wear-cloth_rose_cape'));
    assert.equal(f.activeMotions()[0].options.outfit, 'cloth_cream_vest'); assert.deepEqual(f.saved(), before);
    gate.resolve(); await flush(); f.control.pending = null;
    assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(f.activeMotions()[0].options.outfit, 'cloth_cream_vest');
    await f.click(f.focusButton('outfit-remove')); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
    f.control.outcome = 'ok'; await f.click(f.focusButton('outfit-wear-cloth_rose_cape'));
    const changed = f.saved(); assert.equal(changed.wardrobe.equipped, 'cloth_rose_cape'); assert.equal(changed.coins, before.coins);
    assert.equal(changed.pet.exp, before.pet.exp); assert.deepEqual(changed.decorations, before.decorations); assert.equal(changed.decorations.equipped, 'house');
    assert.equal(f.activeMotions()[0].options.outfit, 'cloth_rose_cape');
    await f.click(f.focusButton('outfit-remove')); assert.equal(f.saved().wardrobe.equipped, null);
    assert.equal(f.saved().wardrobe.owned.cloth_rose_cape, true); assert.equal(f.saved().wardrobe.owned.cloth_cream_vest, true);
    assert.deepEqual(f.saved().decorations, before.decorations); assert.equal(f.activeMotions()[0].options.outfit, null);
  }
});

test('saved clothes survive growth, emotions, feeding, navigation and reload while every preview stays read only', async () => {
  const f = await fixture({ rendererMode: 'ready', seed: { pg_exp: '397' }, setup: async app => {
    assert.equal((await app.dispatch({ type: 'buyItem', itemId: 'cloth_rose_cape' })).ok, true);
    assert.equal((await app.dispatch({ type: 'equipClothing', itemId: 'cloth_rose_cape' })).ok, true);
  } });
  const before = f.saved(), writes = f.writes.length; assert.equal(f.mounts.at(-1).options.outfit, 'cloth_rose_cape');
  await f.click(f.focusButton('pet-emotion-angry')); assert.equal(f.saved().wardrobe.equipped, 'cloth_rose_cape');
  await f.click(f.focusButton('growth-album-toggle')); await f.click(f.focusButton('growth-stage-companion'));
  assert.ok(f.activeMotions().every(controller => controller.options.outfit === 'cloth_rose_cape'));
  await f.click(f.button('薄紫のこのしぐさを見る')); assert.equal(f.activeMotions().length, 3);
  assert.ok(f.activeMotions().every(controller => controller.options.outfit === 'cloth_rose_cape'));
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
  await f.click(f.focusButton('care-feed')); assert.equal(f.saved().pet.exp, 405);
  assert.equal(f.activeMotions()[0].options.growthStage, 'adult'); assert.equal(f.activeMotions()[0].options.outfit, 'cloth_rose_cape');
  f.advance(4400); await f.fireTimers(); assert.equal(f.host.querySelector('.ipg-emotion-stage').querySelector('.ipg-lilac-visual').dataset.feedingPhase, 'joy');
  for (const tab of ['play', 'market', 'shop', 'care']) {
    await f.click(f.focusButton('tab-' + tab)); assert.equal(f.activeMotions()[0].options.outfit, 'cloth_rose_cape');
  }
  const after = f.saved(), raw = f.data.get(Core.KEY), reload = await fixture({ rendererMode: 'ready', seed: { [Core.KEY]: raw } });
  assert.equal(reload.saved().wardrobe.equipped, 'cloth_rose_cape'); assert.equal(reload.mounts.at(-1).options.outfit, 'cloth_rose_cape');
  assert.deepEqual(reload.saved(), after); assert.equal(reload.writes.length, 0);
});

test('a bunny can browse B-only fittings without changing its species, real image or saved wardrobe', async () => {
  const f = await fixture({ rendererMode: 'ready', species: 'bunny', setup: async app => {
    assert.equal((await app.dispatch({ type: 'buyItem', itemId: 'cloth_cream_vest' })).ok, true);
    assert.equal((await app.dispatch({ type: 'equipClothing', itemId: 'cloth_cream_vest' })).ok, true);
  } }), before = f.saved(), image = f.host.querySelector('.ipg-pet-image').src;
  assert.equal(f.mounts.length, 0); await f.click(f.focusButton('tab-shop'));
  await f.click(f.focusButton('outfit-try-cloth_flower_dress'));
  assert.equal(f.activeMotions().length, 1); assert.equal(f.mounts.at(-1).options.outfit, 'cloth_flower_dress');
  assert.ok(f.host.querySelector('.ipg-fitting-caption').textContent.includes('未購入・試着'));
  assert.equal(f.saved().pet.species, 'bunny'); assert.equal(f.saved().wardrobe.equipped, 'cloth_cream_vest'); assert.deepEqual(f.saved(), before);
  await f.click(f.focusButton('tab-care')); assert.equal(f.host.querySelector('.ipg-pet-image').src, image);
  assert.equal(f.activeMotions().length, 0); assert.equal(f.host.querySelector('.ipg-outfit-fitting'), null);
  await f.click(f.focusButton('tab-shop')); assert.equal(f.host.querySelector('.ipg-outfit-fitting'), null);
  assert.deepEqual(f.saved(), before);
});

test('failed clothing drawing keeps saved wearing state but honestly labels the bare fallback and stops fittings on hide', async () => {
  const f = await fixture({ rendererMode: 'error', setup: async app => {
    assert.equal((await app.dispatch({ type: 'buyItem', itemId: 'cloth_cream_vest' })).ok, true);
    assert.equal((await app.dispatch({ type: 'equipClothing', itemId: 'cloth_cream_vest' })).ok, true);
  } }), before = f.saved(), writes = f.writes.length;
  assert.equal(f.host.querySelector('.ipg-outfit-unavailable').hidden, false);
  assert.match(f.host.querySelector('.ipg-outfit-unavailable').textContent, /着用設定は保存されています.*服の見た目を表示できません/);
  assert.ok(!f.host.querySelector('.ipg-lilac-still').alt.includes('お洋服：'));
  await f.click(f.focusButton('tab-shop')); await f.click(f.focusButton('outfit-try-cloth_mint_knit'));
  const fitting = f.host.querySelector('.ipg-outfit-fitting'); assert.equal(fitting.querySelector('canvas').hidden, true);
  assert.equal(fitting.querySelector('.ipg-lilac-still').hidden, false); assert.match(fitting.querySelector('.ipg-fitting-caption').textContent, /服を描かない基準の絵/);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
  f.document.hidden = true; f.document.emit('visibilitychange'); await flush(); assert.equal(f.activeMotions().length, 0); assert.equal(f.timers.size, 0);
  f.document.hidden = false; f.document.emit('visibilitychange'); await flush(); assert.equal(f.host.querySelector('.ipg-outfit-fitting'), null);
  assert.deepEqual(f.saved(), before);
});

test('insufficient coins disable paid purchases while trial remains free and never grants ownership', async () => {
  const f = await fixture({ rendererMode: 'ready', seed: { pg_coins: '0' } }); await f.click(f.focusButton('tab-shop'));
  const before = f.saved(), writes = f.writes.length;
  assert.equal(f.focusButton('outfit-buy-cloth_cream_vest').disabled, false);
  assert.equal(f.focusButton('outfit-buy-cloth_flower_dress').disabled, true);
  await f.click(f.focusButton('outfit-buy-cloth_flower_dress')); assert.deepEqual(f.saved(), before);
  await f.click(f.focusButton('outfit-try-cloth_flower_dress')); assert.equal(f.mounts.at(-1).options.outfit, 'cloth_flower_dress');
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
  assert.ok(!f.saved().wardrobe?.owned?.cloth_flower_dress);
});

test('an unavailable optional renderer never presents the bare reference as visibly wearing saved clothes', async () => {
  const f = await fixture({ rendererMode: 'ready', setup: async app => {
    assert.equal((await app.dispatch({ type: 'buyItem', itemId: 'cloth_cream_vest' })).ok, true);
    assert.equal((await app.dispatch({ type: 'equipClothing', itemId: 'cloth_cream_vest' })).ok, true);
  } }), before = f.saved(), writes = f.writes.length;
  delete f.window.PetLilacMotion; f.ui.render();
  assert.equal(f.host.querySelector('.ipg-outfit-unavailable').hidden, false);
  await f.click(f.focusButton('growth-album-toggle'));
  assert.match(f.host.querySelector('.ipg-growth-caption').textContent, /服の見た目を表示できません/);
  await f.click(f.button('薄紫のこのしぐさを見る'));
  assert.match(f.host.querySelector('.ipg-appearance-preview').querySelector('.ipg-emotion-caption').textContent, /服の見た目を表示できません/);
  assert.equal(f.activeMotions().length, 0); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('trying a lower-row garment immediately shows the fitting and moves focus to its caption without saving', async () => {
  const f = await fixture({ rendererMode: 'ready' }); await f.click(f.focusButton('tab-shop'));
  const before = f.saved(), writes = f.writes.length, choice = f.focusButton('outfit-try-cloth_flower_dress');
  choice.focus(); await f.click(choice);
  const shown = f.host.querySelector('.ipg-outfit-fitting'), caption = shown.querySelector('.ipg-fitting-caption');
  assert.equal(shown.scrollCalls.length, 1); assert.equal(shown.scrollCalls[0].block, 'center'); assert.equal(shown.scrollCalls[0].behavior, 'auto');
  assert.equal(caption.tabIndex, -1); assert.equal(f.document.activeElement, caption); assert.equal(caption.lastFocusOptions.preventScroll, true);
  assert.ok(caption.textContent.includes('お花のワンピース')); assert.ok(caption.textContent.includes('未購入・試着の見本'));
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(f.mounts.at(-1).options.situation, 'idle');
});

test('old EXP and care totals keep the original lilac appearance without inventing food, frequency or evolution history', async () => {
  const f = await fixture({ rendererMode: 'ready', seed: { pg_exp: '373', pg_coins: '355', pg_cnt_feed: '900', pg_cnt_pet: '700' } }), before = f.saved(), writes = f.writes.length;
  assert.equal(typeof Core.getLilacEvolution, 'function'); assert.equal(before.evolution, undefined);
  assert.equal(f.mounts.at(-1).options.evolutionPath, 'balanced');
  assert.match(f.host.querySelector('.ipg-evolution-current').textContent, /のんびり・薄紫/);
  assert.match(f.host.querySelector('.ipg-evolution-tendency').textContent, /まだこれから/);
  assert.match(f.host.querySelector('.ipg-evolution-recorded').textContent, /ここからのお世話から始まります/);
  assert.equal(f.host.querySelector('.ipg-evolution-history'), null); assert.equal(before.pet.exp, 373); assert.equal(before.coins, 355);
  assert.match(f.host.querySelector('.ipg-evolution-help').textContent, /日を分けて続ける/);
  assert.match(f.host.querySelector('.ipg-evolution-help').textContent, /800 EXPから先も、800 EXPごと/);
  f.window.emit('focus'); await flush(); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('a failed first meal never creates a tendency; future confirmed care records only the new observations and locks color at 400', async () => {
  const f = await fixture({ rendererMode: 'ready', seed: { pg_exp: '373', pg_coins: '355' } });
  f.advance(10000); f.ui.render(); const before = f.saved(), gate = deferred();
  f.control.pending = gate; f.control.outcome = 'false'; await f.click(f.focusButton('care-feed'));
  assert.deepEqual(f.saved(), before); assert.equal(f.mounts.at(-1).options.evolutionPath, 'balanced');
  gate.resolve(); await flush(); f.control.pending = null;
  assert.equal(f.saved().evolution, undefined); assert.match(f.host.querySelector('.ipg-evolution-tendency').textContent, /まだこれから/);
  f.control.outcome = 'ok'; await f.click(f.focusButton('care-feed'));
  assert.equal(f.saved().pet.exp, 381); assert.equal(f.saved().coins, 365); assert.equal(f.saved().evolution.baselineExp, 373);
  assert.equal(f.mounts.at(-1).options.evolutionPath, 'balanced', 'predicted fruit is not the current saved color');
  assert.match(f.host.querySelector('.ipg-evolution-current').textContent, /のんびり・薄紫/);
  assert.match(f.host.querySelector('.ipg-evolution-tendency').textContent, /予想.*はなほっぺ・桃色/);
  assert.match(f.host.querySelector('.ipg-evolution-recorded').textContent, /新しく記録した育成日数：1日/);
  assert.equal(f.host.querySelector('.ipg-evolution-history'), null);
  await f.click(f.focusButton('care-feed')); await f.click(f.focusButton('care-feed'));
  assert.equal(f.saved().pet.exp, 397); assert.equal(f.mounts.at(-1).options.evolutionPath, 'balanced');
  await f.click(f.focusButton('care-rest'));
  assert.equal(f.saved().pet.exp, 401); assert.equal(f.saved().coins, 365);
  assert.equal(f.mounts.at(-1).options.evolutionPath, 'fruit'); assert.equal(f.host.querySelector('.ipg-lilac-visual').dataset.evolutionPath, 'fruit');
  assert.match(f.host.querySelector('.ipg-evolution-current').textContent, /はなほっぺ・桃色/);
  const records = f.host.querySelector('.ipg-evolution-history').querySelectorAll('li');
  assert.equal(records.length, 1); assert.match(records[0].textContent, /おとな.*400 EXP.*はなほっぺ・桃色.*JST/);
  assert.equal(Core.getLilacEvolution(f.saved()).history.length, 1); assert.equal(f.saved().evolution.history[0].min, 400);
});

test('all six evolution previews stay read only, preserve the saved outfit and never recolor the real pet or tendency', async () => {
  const f = await fixture({ rendererMode: 'ready', seed: { pg_exp: '373', pg_coins: '355' }, setup: async app => {
    assert.equal((await app.dispatch({ type: 'buyItem', itemId: 'cloth_cream_vest' })).ok, true);
    assert.equal((await app.dispatch({ type: 'equipClothing', itemId: 'cloth_cream_vest' })).ok, true);
  } }), before = f.saved(), writes = f.writes.length;
  await f.click(f.focusButton('growth-album-toggle'));
  assert.equal(f.host.querySelectorAll('button').filter(button => button.dataset.focusKey?.startsWith('growth-path-')).length, 6);
  for (const path of Core.lilacEvolutionPaths) {
    await f.click(f.focusButton('growth-path-' + path.key));
    assert.equal(f.activeMotions().length, 2); assert.equal(f.host.querySelector('.ipg-growth-gallery').querySelectorAll('canvas').length, 1);
    assert.equal(f.activeMotions()[0].options.evolutionPath, 'balanced'); assert.equal(f.mounts.at(-1).options.evolutionPath, path.key);
    assert.equal(f.mounts.at(-1).options.situation, 'idle'); assert.ok(f.activeMotions().every(controller => controller.options.outfit === 'cloth_cream_vest'));
    const caption = f.host.querySelector('.ipg-growth-caption'); assert.ok(caption.textContent.includes(path.label));
    assert.ok(caption.textContent.includes(path.colorName)); assert.ok(caption.textContent.includes('見本'));
    assert.equal(f.document.activeElement, caption); assert.equal(f.focusButton('growth-path-' + path.key).getAttribute('aria-pressed'), 'true');
    assert.match(f.host.querySelector('.ipg-evolution-current').textContent, /のんびり・薄紫/);
    assert.match(f.host.querySelector('.ipg-evolution-tendency').textContent, /まだこれから/);
    assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(f.actionCues.length, 0);
  }
  await f.click(f.focusButton('growth-stage-companion')); assert.equal(f.mounts.at(-1).options.evolutionPath, 'calm');
  assert.equal(f.mounts.at(-1).options.growthStage, 'companion'); assert.match(f.host.querySelector('.ipg-growth-caption').textContent, /これからの姿・見本/);
  await f.click(f.focusButton('growth-album-toggle')); assert.equal(f.activeMotions().length, 1);
  assert.equal(f.mounts.at(-1).options.evolutionPath, 'balanced'); assert.deepEqual(f.saved(), before);
});

test('a recorded color follows clothing, 36-emotion references, fitting and the correct feeding anchor', async () => {
  const f = await fixture({ rendererMode: 'ready', seed: { pg_exp: '397' }, setup: async app => {
    assert.equal((await app.dispatch({ type: 'buyItem', itemId: 'cloth_cream_vest' })).ok, true);
    assert.equal((await app.dispatch({ type: 'equipClothing', itemId: 'cloth_cream_vest' })).ok, true);
    assert.equal((await app.dispatch({ type: 'care', kind: 'feed' })).ok, true);
  } });
  assert.equal(f.saved().pet.exp, 405); assert.equal(f.mounts.at(-1).options.evolutionPath, 'fruit');
  await f.click(f.button('薄紫のこのしぐさを見る'));
  assert.equal(f.mounts.at(-1).options.growthStage, 'child'); assert.equal(f.mounts.at(-1).options.evolutionPath, 'fruit', 'reference EXP must not invalidate the saved color');
  assert.ok(f.activeMotions().every(controller => controller.options.outfit === 'cloth_cream_vest'));
  const before = f.saved(), writes = f.writes.length;
  await f.click(f.focusButton('preview-emotion-cry')); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
  await f.click(f.focusButton('care-feed'));
  assert.equal(f.activeMotions()[0].options.evolutionPath, 'fruit'); assert.equal(f.activeMotions()[0].options.situation, 'feeding');
  assert.ok(f.anchorCalls.some(call => call.stage === 'adult' && call.path === 'fruit'));
  const food = f.host.querySelector('.ipg-emotion-stage').querySelector('.ipg-feeding-food'), anchor = Motion.feedingAnchor('adult', 'fruit');
  assert.equal(food.style.left, String(anchor.foodLeft * 100) + '%'); assert.equal(food.style.top, String(anchor.foodTop * 100) + '%');
  await f.click(f.focusButton('tab-shop')); const saved = f.saved(); await f.click(f.focusButton('outfit-try-cloth_flower_dress'));
  assert.equal(f.activeMotions()[0].options.evolutionPath, 'fruit'); assert.equal(f.mounts.at(-1).options.evolutionPath, 'fruit');
  assert.equal(f.activeMotions()[0].options.outfit, 'cloth_cream_vest'); assert.equal(f.mounts.at(-1).options.outfit, 'cloth_flower_dress'); assert.deepEqual(f.saved(), saved);
});

test('food cards explain B-specific diet tendencies while bunny care does not show or create B evolution', async () => {
  const f = await fixture({ rendererMode: 'ready' }); await f.click(f.focusButton('tab-shop'));
  for (const [name, target] of [['りんご', '桃色'], ['いちご', '桃色'], ['おにぎり', 'はちみつ色'], ['ごちそう', 'はちみつ色'], ['ケーキ', '杏色']]) {
    const row = f.host.querySelectorAll('.ipg-shop-item').find(entry => entry.querySelector('h4')?.textContent === name);
    assert.ok(row); assert.ok(row.querySelector('.ipg-food-evolution-hint').textContent.includes('Bの育ち方'));
    assert.ok(row.querySelector('.ipg-food-evolution-hint').textContent.includes(target));
  }
  const bunny = await fixture({ rendererMode: 'ready', species: 'bunny' });
  assert.equal(bunny.host.querySelector('.ipg-evolution-status'), null); await bunny.click(bunny.focusButton('care-feed'));
  assert.equal(bunny.saved().evolution, undefined); await bunny.click(bunny.focusButton('tab-shop'));
  assert.equal(bunny.host.querySelector('.ipg-food-evolution-hint'), null);
});

test('missing evolution APIs retain the earlier game, and failed color drawing labels the original reference honestly', async () => {
  const legacy = await fixture({ rendererMode: 'ready' }), before = legacy.saved(), writes = legacy.writes.length;
  delete legacy.window.PetGameCore.getLilacEvolution; delete legacy.window.PetGameCore.lilacEvolutionPaths;
  legacy.ui.render(); assert.equal(legacy.host.querySelector('.ipg-evolution-status'), null);
  assert.equal(legacy.mounts.at(-1).options.evolutionPath, 'balanced');
  await legacy.click(legacy.focusButton('growth-album-toggle')); assert.equal(legacy.host.querySelector('.ipg-evolution-choices'), null);
  assert.equal(legacy.host.querySelector('.ipg-growth-gallery').querySelectorAll('canvas').length, 1); assert.deepEqual(legacy.saved(), before); assert.equal(legacy.writes.length, writes);
  const f = await fixture({ rendererMode: 'error', seed: { pg_exp: '397' }, setup: async app => { assert.equal((await app.dispatch({ type: 'care', kind: 'feed' })).ok, true); } }), saved = f.saved();
  assert.equal(f.host.querySelector('.ipg-evolution-unavailable').hidden, false);
  assert.match(f.host.querySelector('.ipg-evolution-unavailable').textContent, /記録は保存されています.*色・姿を表示できません/);
  await f.click(f.focusButton('growth-album-toggle')); await f.click(f.focusButton('growth-path-calm'));
  assert.match(f.host.querySelector('.ipg-growth-caption').textContent, /育ち方の色・姿は表示できません/);
  assert.equal(f.host.querySelector('.ipg-growth-gallery').querySelector('canvas').hidden, true); assert.deepEqual(f.saved(), saved);
});

test('growth and color continue past 800 EXP while the current companion body is labelled from its first 800 EXP stage', async () => {
  const f = await fixture({ rendererMode: 'ready', seed: { pg_exp: '1605' } }), before = f.saved();
  assert.equal(Core.getLilacGrowth(1605).next, 2400); assert.ok(f.host.textContent.includes('次の成長まで あと795 EXP'));
  await f.click(f.focusButton('growth-album-toggle'));
  assert.ok(f.host.querySelector('.ipg-growth-caption').textContent.includes('見本'));
  assert.match(f.host.querySelector('.ipg-growth-caption').textContent, /いまの姿の見本/);
  assert.match(f.focusButton('growth-stage-companion').textContent, /800 EXP〜.*いまの姿/);
  assert.ok(!f.host.querySelector('.ipg-growth-gallery').textContent.includes('1600'), 'body reference does not invent a 1600 EXP picture or history');
  assert.deepEqual(f.saved(), before); assert.equal(f.host.querySelector('.ipg-evolution-history'), null);
  const next = await fixture({ rendererMode: 'ready', seed: { pg_exp: '1597' } }); next.advance(10000); next.ui.render();
  const old = next.saved(), gate = deferred(); next.control.pending = gate; next.control.outcome = 'false';
  await next.click(next.focusButton('care-rest')); gate.resolve(); await flush(); next.control.pending = null;
  assert.deepEqual(next.saved(), old); assert.equal(next.mounts.at(-1).options.situation, 'idle');
  next.control.outcome = 'ok'; await next.click(next.focusButton('care-rest'));
  assert.equal(next.saved().pet.exp, 1601); assert.equal(next.mounts.at(-1).options.growthStage, 'companion');
  assert.equal(next.mounts.at(-1).options.evolutionPath, 'calm'); assert.equal(next.mounts.at(-1).options.situation, 'joy');
  assert.ok(next.host.querySelector('.ipg-notice').textContent.includes('進化しました'));
  const meal = await fixture({ rendererMode: 'ready', seed: { pg_exp: '1597' } }); await meal.click(meal.focusButton('care-feed'));
  assert.equal(meal.saved().pet.exp, 1605); assert.equal(meal.mounts.at(-1).options.evolutionPath, 'fruit'); assert.equal(meal.mounts.at(-1).options.situation, 'feeding');
});

test('each confirmed B care scrolls its actor into view once after rendering, while ordinary rerenders and navigation stay still', async () => {
  for (const [kind, exp] of [['feed', 8], ['play', 5], ['rest', 4]]) {
    const f = await fixture({ rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
    assert.equal(f.scrolls().length, 0); const oldScene = f.host.querySelector('.ipg-scene');
    await f.click(f.focusButton('care-' + kind));
    assert.equal(f.saved().pet.exp, before.pet.exp + exp); assert.equal(f.writes.length, writes + 1);
    assert.equal(f.scrolls().length, 1); assert.notEqual(f.scrolls()[0].node, oldScene);
    assert.equal(f.scrolls()[0].node, f.host.querySelector('.ipg-scene'));
    assert.equal(f.scrolls()[0].options.block, 'center'); assert.equal(f.scrolls()[0].options.behavior, 'auto');
    assert.ok(f.scrolls()[0].node.querySelector('canvas'), 'the actual actor is the scroll target');
    f.advance(500); f.ui.render(); f.window.emit('focus'); await flush();
    await f.click(f.focusButton('pet-emotion-love')); await f.click(f.focusButton('tab-shop'));
    assert.equal(f.scrolls().length, 1, 'no repeat from render, focus, manual emotions or navigation');
  }
});

test('failed, capped, read-only, hidden or bunny care never auto-scrolls the B actor', async () => {
  for (const outcome of ['false', 'throw']) {
    const f = await fixture({ rendererMode: 'ready' }), before = f.saved(); f.control.outcome = outcome;
    await f.click(f.focusButton('care-feed')); assert.deepEqual(f.saved(), before); assert.equal(f.scrolls().length, 0);
  }
  const capped = await fixture({ rendererMode: 'ready' });
  for (let i = 0; i < 3; i++) await capped.click(capped.focusButton('care-feed'));
  const beforeCap = capped.saved(), scrolls = capped.scrolls().length;
  await capped.click(capped.focusButton('care-feed')); capped.focusButton('care-feed').emit('click'); await flush();
  assert.deepEqual(capped.saved(), beforeCap); assert.equal(capped.scrolls().length, scrolls);
  const readonly = await fixture({ rendererMode: 'ready' }), beforeReadOnly = readonly.saved();
  readonly.store.dispatch = async () => ({ ok: false, error: { code: 'read_only', message: '記録を確認してください。' } });
  await readonly.click(readonly.focusButton('care-rest')); assert.deepEqual(readonly.saved(), beforeReadOnly); assert.equal(readonly.scrolls().length, 0);
  const hidden = await fixture({ rendererMode: 'ready' }), gate = deferred(); hidden.control.pending = gate;
  await hidden.click(hidden.focusButton('care-feed')); assert.equal(hidden.scrolls().length, 0);
  hidden.pane.hidden = true; gate.resolve(); await flush(); hidden.control.pending = null;
  assert.equal(hidden.saved().pet.exp, 38); assert.equal(hidden.scrolls().length, 0);
  hidden.pane.hidden = false; await hidden.ui.open(); assert.equal(hidden.scrolls().length, 0);
  const bunny = await fixture({ rendererMode: 'ready', species: 'bunny' });
  await bunny.click(bunny.focusButton('care-feed')); assert.equal(bunny.scrolls().length, 0); assert.equal(bunny.saved().pet.species, 'bunny');
});

test('delayed first drawing keeps the meal elapsed time and never re-scrolls or restarts a completed cue', async () => {
  for (const delay of [1500, 9000]) {
    const f = await fixture({ rendererMode: 'pending' }); f.advance(10000); f.ui.render();
    const gate = deferred(); f.control.pending = gate;
    await f.click(f.focusButton('care-feed')); assert.equal(f.scrolls().length, 0, 'pending persistence does not move the view');
    gate.resolve(); await flush(); f.control.pending = null;
    const after = f.saved(), writes = f.writes.length, controller = f.mounts.at(-1);
    assert.equal(f.scrolls().length, 1); assert.equal(f.host.querySelector('.ipg-feeding-food').hidden, true);
    f.advance(delay); controller.options.onReady();
    const wrap = f.host.querySelector('.ipg-lilac-visual');
    assert.equal(wrap.dataset.situation, delay < Motion.durations.feeding ? 'feeding' : 'idle');
    assert.equal(wrap.dataset.feedingPhase, delay < Motion.durations.feeding ? 'chewing' : '');
    assert.equal(f.host.querySelector('.ipg-feeding-food').hidden, delay >= Motion.durations.feeding);
    assert.equal(f.scrolls().length, 1, 'onReady only resumes the current age, never scrolls again');
    f.ui.render(); assert.equal(f.mounts.at(-1).options.elapsedMs, delay < Motion.durations.feeding ? delay : 0);
    assert.equal(f.scrolls().length, 1); assert.deepEqual(f.saved(), after); assert.equal(f.writes.length, writes);
  }
});

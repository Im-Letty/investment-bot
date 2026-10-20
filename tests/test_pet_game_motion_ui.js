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
  const raf = new Map(), intervals = new Map(), timers = new Map(), mounts = [], actionCues = [];
  const rendererControl = { mode: config.rendererMode || 'pending', mappingThrows: false };
  const renderer = {
    durations: Motion.durations, catalogue: Motion.catalogue, feedingPhase: Motion.feedingPhase, feedingAnchor: Motion.feedingAnchor, growthProfile: Motion.growthProfile, growthPoint: Motion.growthPoint,
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
  return { ui, host, pane, document, window, data, storage, writes, control, rendererControl, mounts, actionCues, raf, timers,
    get store() { return store; },
    saved() { return JSON.parse(data.get(Core.KEY)); },
    buttons() { return host.querySelectorAll('button'); },
    button(text) { const found = this.buttons().find(b => b.textContent === text || b.textContent.startsWith(text)); assert.ok(found, 'button: ' + text); return found; },
    focusButton(key) { const found = host.querySelector('[data-focus-key="' + key + '"]'); assert.ok(found, key); return found; },
    async click(button) { if (!button.disabled) button.emit('click'); await flush(); },
    advance(ms) { clock += ms; },
    async fireTimers() {
      for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.fn(); }
      await flush();
    },
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

test('all 36 B preview modes work for an old egg without selecting B or writing any progress', async () => {
  const f = await fixture({ seed: { pg_species: 'bunny', pg_exp: '0' } }), before = f.saved(), writes = f.writes.length;
  await f.click(f.button('薄紫のこのしぐさを見る'));
  const panel = f.host.querySelector('.ipg-appearance-preview'), controller = f.mounts.at(-1);
  assert.ok(panel); assert.equal(f.host.querySelector('.ipg-pet-settings').open, true);
  assert.ok(f.host.querySelector('.ipg-pet-image').src.endsWith('pet_bimg_egg.webp'));
  assert.equal(panel.querySelector('.ipg-lilac-still').hidden, false); assert.equal(panel.querySelector('canvas').hidden, true);
  controller.options.onReady(); assert.equal(panel.querySelector('canvas').hidden, false);
  const choices = panel.querySelectorAll('button').filter(b => b.dataset.emotion); assert.equal(choices.length, 36);
  assert.equal(panel.querySelectorAll('.ipg-emotion-grid').length, 6);
  for (const [i, name] of Motion.situations.entries()) {
    const groups = panel.querySelectorAll('.ipg-emotion-groups')[0].querySelectorAll('button');
    await f.click(groups[Math.floor(i / 6)]);
    assert.equal(choices[i].parentNode.hidden, false);
    await f.click(choices[i]);
    assert.equal(controller.changes.at(-1).name, name);
    assert.match(panel.querySelector('.ipg-emotion-caption').textContent, /の見本$/);
    assert.ok(panel.querySelector('canvas').getAttribute('aria-label').includes(choices[i].textContent));
    assert.equal(choices[i].getAttribute('aria-pressed'), 'true');
    assert.equal(choices.filter(b => b.getAttribute('aria-pressed') === 'true').length, 1);
    assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(f.actionCues.length, 0);
  }
  f.advance(700); f.ui.render();
  assert.equal(controller.destroyed, true); assert.equal(f.activeMotions().length, 1);
  assert.equal(f.mounts.at(-1).options.situation, 'determined'); assert.equal(f.mounts.at(-1).options.elapsedMs, 700);
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

test('care offers all 36 expressive choices without saving, awarding or starting an animation loop', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
  const panel = f.host.querySelector('.ipg-emotion-panel'), controller = f.mounts.at(-1);
  const choices = panel.querySelectorAll('button').filter(b => b.dataset.emotion);
  assert.equal(choices.length, 36); assert.equal(panel.querySelectorAll('.ipg-emotion-grid').length, 6);
  for (const [i, id] of Motion.situations.entries()) {
    await f.click(panel.querySelectorAll('.ipg-emotion-groups')[0].querySelectorAll('button')[Math.floor(i / 6)]);
    assert.equal(choices[i].parentNode.hidden, false);
    await f.click(choices[i]);
    assert.equal(controller.changes.at(-1).name, id);
    assert.ok(f.host.querySelector('canvas').getAttribute('aria-label').includes(choices[i].textContent));
    assert.equal(choices[i].getAttribute('aria-pressed'), 'true');
    assert.equal(choices.filter(b => b.getAttribute('aria-pressed') === 'true').length, 1);
    assert.ok(f.timers.size <= 1, 'one cue deadline, no timer accumulation');
    assert.equal(f.raf.size, 0, 'UI effect uses CSS rather than a second render loop');
    assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(f.actionCues.length, 0);
  }
  f.advance(725); f.ui.render();
  assert.equal(controller.destroyed, true); assert.equal(f.activeMotions().length, 1);
  assert.equal(f.mounts.at(-1).options.situation, 'determined');
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

test('zero-EXP B starts visible with all 36 emotions enabled and safe preview adds no growth or rewards', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '0' } }), before = f.saved(), writes = f.writes.length;
  const panel = f.host.querySelector('.ipg-emotion-panel'), choices = panel.querySelectorAll('button').filter(b => b.dataset.emotion);
  assert.equal(choices.length, 36); assert.ok(choices.every(b => !b.disabled));
  assert.equal(f.mounts.length, 1); assert.equal(f.store.getState().stage.key, 'egg');
  assert.equal(f.saved().pet.exp, 0); assert.match(f.host.querySelector('.ipg-lilac-still').src, /pet_lilac_cutout\.webp$/);
  for (const [i, id] of Motion.situations.entries()) {
    await f.click(panel.querySelectorAll('.ipg-emotion-groups')[0].querySelectorAll('button')[Math.floor(i / 6)]);
    await f.click(choices[i]); assert.equal(f.mounts[0].changes.at(-1).name, id);
    assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
  }
  await f.click(f.button('薄紫のこのしぐさを見る'));
  const preview = f.host.querySelector('.ipg-appearance-preview');
  assert.equal(preview.querySelectorAll('button').filter(b => b.dataset.emotion).length, 36);
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

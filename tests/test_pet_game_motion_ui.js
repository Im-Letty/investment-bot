'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../static/pet-game-core.js');
const Motion = require('../static/pet-lilac-motion.js');
const Room = require('../static/pet-room-behavior.js');
const Town = require('../static/pet-town-walk.js');
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
  target.listenerCount = name => listeners.get(name)?.size || 0;
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
  contains(child) { for(let node=child;node;node=node.parentNode)if(node===this)return true;return false; }
  matches(selector) {
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    const focus = /^\[data-focus-key="([^"]+)"\]$/.exec(selector);
    return focus ? this.dataset.focusKey === focus[1] : this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    const selectors = selector.split(','), result = [];
    const matches = (child, value) => {
      const parts = value.trim().split(/\s+/); if (!child.matches(parts.pop())) return false;
      let ancestor = child.parentNode;
      while (parts.length) { const part = parts.pop(); while (ancestor && !ancestor.matches(part)) ancestor = ancestor.parentNode; if (!ancestor) return false; ancestor = ancestor.parentNode; }
      return true;
    };
    const visit = node => node.children.forEach(child => { if (selectors.some(s => matches(child,s))) result.push(child); visit(child); });
    visit(this); return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

// Only drawing is stubbed. All durable actions and action-to-cue mapping use the
// shipped modules, with the same asynchronous storage boundary as the product.
async function fixture(config = {}) {
  let clock = new Date(2026, 9, 21, 12).getTime(), sequence = 0, store;
  const data = new Map(Object.entries({ ...(config.fresh ? {} : { pg_exp: '30', pg_coins: '500', pg_name: 'もとの子', pg_path: 'cool', pg_px: '1',
    pg_items: '{"rice":2}', pg_ach: '["old-ach"]' }), ...(config.seed || {}) }));
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
  const coreOptions = { storage, now: () => clock, random: () => .5, developerPreview: config.developerPreview !== false };
  const setup = Core.create(coreOptions); assert.equal((await setup.ready).ok, true);
  if (config.species) assert.equal((await setup.dispatch({ type: 'chooseSpecies', species: config.species })).ok, true);
  if (config.setup) await config.setup(setup);
  const beforeMountRaw = data.get(Core.KEY), writesBeforeMount = writes.length;
  const document = events({ hidden: !!config.hidden, activeElement: null });
  document.createElement = tag => new Element(tag, document);
  document.createElementNS = (namespace, tag) => {
    const element = new Element(tag, document); element.namespaceURI = namespace;
    const setAttribute = element.setAttribute.bind(element);
    element.setAttribute = (name, value) => { setAttribute(name, value); if (name === 'class') element.className = String(value); };
    return element;
  };
  document.body = new Element('body', document);
  const pane = document.createElement('section'), host = document.createElement('div');
  pane.hidden = !!config.paneHidden; document.body.appendChild(pane); pane.appendChild(host);
  document.getElementById = id => id === 'sect-pet' ? pane : id === 'pet-game-root' ? host : null;
  const raf = new Map(), intervals = new Map(), timers = new Map(), mounts = [], actionCues = [], anchorCalls = [], hitTests = [];
  const cozyMounts = [], cozyControl = { pending: null, reject: false }, economyScenes = [];
  const rendererControl = { mode: config.rendererMode || 'pending', mappingThrows: false, hit: null, hitThrows: false };
  const renderer = {
    durations: Motion.durations, catalogue: Motion.catalogue, bodyCatalogue: Motion.bodyCatalogue, directionCatalogue: Motion.directionCatalogue, appearanceProfile: Motion.appearanceProfile, eggVisualProfile: Motion.eggVisualProfile, roomWalkFrame: Motion.roomWalkFrame, feedingPhase: Motion.feedingPhase, feedingAnchor(stage, path, appearanceKey, eggOrigin) { anchorCalls.push({ stage, path, appearanceKey, eggOrigin }); return Motion.feedingAnchor(stage, path, appearanceKey, eggOrigin); }, growthProfile: Motion.growthProfile, growthPoint: Motion.growthPoint,
    situationForAction(action, before, after, result) {
      if (rendererControl.mappingThrows) throw new Error('private renderer failure');
      const cue = Motion.situationForAction(action, before, after, result);
      actionCues.push({ action: copy(action), cue: copy(cue), result: result.ok });
      return cue;
    },
    mount(canvas, options) {
      const controller = { canvas, options, destroyed: false, changes: [], destroy() { this.destroyed = true; },
        hitTest(x, y) {
          hitTests.push({ x, y, controller: this });
          if (rendererControl.hitThrows) throw new Error('private hit-test failure');
          if (this.destroyed || !canvas.isConnected || canvas.hidden || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
          return typeof rendererControl.hit === 'function' ? rendererControl.hit(x, y) : rendererControl.hit;
        },
        setSituation(name, detail) { this.changes.push({ name, ...(detail == null ? {} : copy(detail)) }); } };
      mounts.push(controller);
      if (rendererControl.mode === 'throw') throw new Error('private GPU failure');
      if (rendererControl.mode === 'ready') options.onReady();
      if (rendererControl.mode === 'error') options.onError('unavailable');
      return controller;
    }
  };
  const window = events({ document, PetTownWalk: config.townUnavailable ? undefined : Town, PetLilacMotion: renderer, PetRoomBehavior: config.roomUnavailable ? undefined : Room, matchMedia: () => ({ matches: !!config.reducedMotion }), confirm: () => true,
    PetGameCore: { ...Core, create(opts) { store = Core.create(opts); return store; } },
    requestAnimationFrame(fn) { const id = ++sequence; raf.set(id, fn); return id; },
    cancelAnimationFrame(id) { raf.delete(id); },
    setInterval(fn) { const id = ++sequence; intervals.set(id, fn); return id; },
    setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, at: clock + Math.max(0, ms || 0) }); return id; },
    clearTimeout(id) { timers.delete(id); }, URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL() {} }
  });
  document.defaultView = window;
  if (config.villageScene) window.PetVillageEconomyScene = {
    mount(options) {
      const controller = { options, disposed: false, dispose() { this.disposed = true; } };
      economyScenes.push(controller); return controller;
    }
  };
  if (config.cozyRenderer) window.PetCozyRoom = {
    async mount(options) {
      const stage = document.createElement('div'); stage.className = 'room-stage'; options.host.appendChild(stage);
      const controller = { options, stage, destroyed: false, destroyCount: 0, destroy() { this.destroyed = true; this.destroyCount++; } };
      cozyMounts.push(controller);
      // Only the 3D drawing/import is stubbed. The real UI, core, callbacks and
      // asynchronous durable adapter remain responsible for all state changes.
      options.onProjectPet({ left: 140, top: 200, scale: 1 });
      if (cozyControl.pending) await cozyControl.pending.promise;
      if (cozyControl.reject) throw Error('synthetic unavailable renderer');
      return controller;
    }
  };
  if (config.rendererUnavailable) delete window.PetLilacMotion;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  const math = Object.create(Math); math.random = () => .5;
  const context = vm.createContext({ window, document, Date: Clock, Math: math, Promise, Blob });
  vm.runInContext(source, context);
  const ui = window.IndependentPetGame;
  const opening = ui.mount(host, coreOptions); assert.equal(await opening, true); await flush();
  // Existing room/animation cases explicitly enter the room through the same
  // public tab as players; village-entry cases opt into the new initial screen.
  if (!config.startAtVillage && config.developerPreview === false && !Core.needsEggChoice(store.getState())) {
    const room = host.querySelector('[data-focus-key="tab-care"]');
    assert.ok(room, 'existing room scenarios can enter the room from the village');
    room.emit('click'); await flush();
  }
  return { ui, host, pane, document, window, data, storage, writes, control, rendererControl, mounts, actionCues, anchorCalls, hitTests, raf, timers, beforeMountRaw, writesBeforeMount, cozyMounts, cozyControl, economyScenes,
    get store() { return store; },
    get now() { return clock; },
    saved() { return JSON.parse(data.get(Core.KEY)); },
    buttons() { return host.querySelectorAll('button'); },
    button(text) { const found = this.buttons().find(b => b.textContent === text || b.textContent.startsWith(text)); assert.ok(found, 'button: ' + text); return found; },
    focusButton(key) { const found = host.querySelector('[data-focus-key="' + key + '"]'); assert.ok(found, key); return found; },
    async click(button) { if (!button.disabled) button.emit('click'); await flush(); },
    async revealEmotion(id, preview = false) {
      const mode = typeof preview === 'string' ? preview : preview ? 'preview' : 'pet', entry = Motion.catalogue.find(row => row.id === id); assert.ok(entry, id);
      const group = { happy: 'bright', feeling: 'deep', social: 'together' }[entry.group] || entry.group;
      await this.click(this.focusButton(mode + '-emotion-group-' + group));
      let choice = this.focusButton(mode + '-emotion-' + id), remaining = 20;
      while (choice.hidden && remaining--) await this.click(this.focusButton(mode + '-emotion-next'));
      assert.equal(choice.hidden, false, id + ' must be on its visible page'); return choice;
    },
    async bodyDrawer(open = true, preview = false) {
      const drawer = this.focusButton((typeof preview === 'string' ? preview : preview ? 'preview' : 'pet') + '-body-motion');
      drawer.open = open; drawer.emit('toggle'); await flush(); return drawer;
    },
    async directionDrawer(open = true, preview = false) {
      const drawer = this.focusButton((typeof preview === 'string' ? preview : preview ? 'preview' : 'pet') + '-direction-motion');
      drawer.open = open; drawer.emit('toggle'); await flush(); return drawer;
    },
    async growthMotions(open = true) {
      const drawer = this.focusButton('growth-motions-toggle'); drawer.open = open; drawer.emit('toggle'); await flush(); return drawer;
    },
    advance(ms) { clock += ms; },
    async fireTimers() {
      for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.fn(); }
      await flush();
    },
    async frame(ms = 0) { clock += ms; const callbacks = [...raf.values()]; raf.clear(); callbacks.forEach(fn => fn(clock)); await flush(); },
    activeMotions() { return mounts.filter(m => !m.destroyed && m.canvas.isConnected); },
    activeCozy() { return cozyMounts.filter(m => !m.destroyed && m.options.host.isConnected && m.options.canRun()); },
    scrolls() { return document.scrollEvents || []; }
  };
}

async function cozyFixture(config = {}) { return fixture({ species: 'lilac', developerPreview: false, rendererMode: 'ready', cozyRenderer: true, ...config }); }
function cozyView(f, editable) {
  const controller = f.activeCozy().find(m => m.options.editable === editable);
  assert.ok(controller, editable ? 'current 3D room editor' : 'current 3D care room'); return controller;
}
function changedCozy(layout, wall = 'floral') { const draft = copy(layout); draft.wall = wall; draft.floor = 'check'; return draft; }

test('approved 3D care room projects the same canonical selected pet without creating a room save or changing progress', async () => {
  const f = await cozyFixture({ seed: { pg_exp: '686', pg_name: '育ててきたこ' } }), before = f.saved(), writes = f.writes.length;
  const room = cozyView(f, false), motion = f.activeMotions()[0], visual = f.host.querySelector('.ipg-cozy-pet');
  assert.deepEqual(copy(room.options.layout), Core.getCozyRoomLayout(before)); assert.equal(room.options.furniture.length, 8); assert.equal(room.options.types.length, 18);
  assert.ok(visual); assert.equal(motion.canvas.parentNode, visual); assert.equal(visual.parentNode, room.stage);
  assert.equal(motion.options.appearanceKey, Core.getLilacAppearance(before.pet.exp).key);
  assert.equal(visual.dataset.eggOrigin, Core.getEggOrigin(before)); assert.equal(visual.dataset.evolutionPath, Core.getLilacEvolution(before).current.key);
  assert.equal(room.options.host.parentNode.dataset.cozyReady, 'true'); assert.equal(Object.hasOwn(before, 'cozyRoomLayout'), false);
  room.options.onDraftChange(changedCozy(room.options.layout)); assert.equal((await room.options.onSave(room.options.layout)).ok, false, 'read-only care cannot save an editor draft');
  f.ui.render(); await flush(); assert.equal(room.destroyed, true); assert.equal(room.destroyCount, 1); cozyView(f, false);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); await f.ui.close();
});

test('3D editor receives the real legacy projection, holds draft changes locally and keeps stale care/navigation callbacks inert', async () => {
  const old = { version: 1, items: [{ id: 'room_bed', x: 80, y: 84, flip: true }] };
  const f = await cozyFixture({ setup: async store => { await store.dispatch({ type: 'saveRoomLayout', layout: old, expectedRevision: store.getState().revision }); } });
  const before = f.saved(), writes = f.writes.length, expected = Core.getCozyRoomLayout(before), care = cozyView(f, false), staleFeed = f.focusButton('care-feed'), staleNav = f.focusButton('tab-shop');
  await f.click(f.focusButton('room-edit')); const editor = cozyView(f, true);
  assert.equal(care.destroyed, true); assert.deepEqual(copy(editor.options.layout), expected); assert.equal(f.activeMotions().length, 0);
  const draft = changedCozy(expected), retained = copy(draft); editor.options.onDraftChange(draft); draft.objects[0].x = 99;
  staleFeed.emit('click'); staleNav.emit('click'); await flush(); assert.ok(f.host.querySelector('.ipg-cozy-editor-card')); assert.equal(f.host.querySelector('.ipg-shop-grid'), null);
  f.ui.render(); await flush(); assert.equal(editor.destroyed, true); assert.deepEqual(copy(cozyView(f, true).options.layout), retained, 'the adapter retains a detached draft through a render');
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.deepEqual(f.saved().roomLayout, old);
  await f.click(f.focusButton('room-cancel')); assert.equal(f.host.querySelector('.ipg-room-editor'), null); assert.deepEqual(copy(cozyView(f, false).options.layout), expected); assert.deepEqual(f.saved(), before); await f.ui.close();
});

test('3D save keeps the editor mounted while storage is pending, then shows only the confirmed design in the care room', async () => {
  const f = await cozyFixture(), before = f.saved(), writes = f.writes.length; await f.click(f.focusButton('room-edit'));
  const editor = cozyView(f, true), draft = changedCozy(editor.options.layout), gate = deferred(); editor.options.onDraftChange(draft);
  f.control.pending = gate; const saving = editor.options.onSave(draft); await flush();
  assert.equal(f.host.getAttribute('aria-busy'), 'true'); assert.equal(cozyView(f, true), editor); assert.equal(editor.destroyed, false);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal((await editor.options.onSave(changedCozy(draft, 'mint'))).ok, false);
  editor.options.onDraftChange(changedCozy(draft, 'mint'));
  gate.resolve(); const result = await saving; f.control.pending = null; await flush();
  assert.equal(result.ok, true); assert.equal(editor.destroyed, true); assert.equal(f.host.querySelector('.ipg-room-editor'), null); assert.equal(f.host.getAttribute('aria-busy'), 'false');
  assert.deepEqual(f.saved(), { ...before, cozyRoomLayout: draft, revision: before.revision + 1 });
  assert.deepEqual(copy(cozyView(f, false).options.layout), draft); assert.ok(f.host.textContent.includes('おへやの配置を保存しました'));
  assert.equal(f.writes.length, writes + 1); assert.equal(f.activeMotions().length, 1); await f.ui.close();
});

for (const outcome of ['false', 'throw']) test('3D ' + outcome + ' save failure keeps the same draft/editor and an explicit retry can succeed', async () => {
  const f = await cozyFixture(), before = f.saved(), writes = f.writes.length; await f.click(f.focusButton('room-edit'));
  const editor = cozyView(f, true), draft = changedCozy(editor.options.layout); editor.options.onDraftChange(draft); f.control.outcome = outcome;
  const result = await editor.options.onSave(draft); await flush();
  assert.equal(result.ok, false); assert.match(result.message, /下書きは残っています/); assert.equal(cozyView(f, true), editor); assert.equal(editor.destroyed, false);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(f.host.getAttribute('aria-busy'), 'false');
  f.control.outcome = 'ok'; assert.equal((await editor.options.onSave(draft)).ok, true); await flush();
  assert.deepEqual(copy(cozyView(f, false).options.layout), draft); assert.deepEqual(f.saved().pet, before.pet); assert.deepEqual(f.saved().inventory, before.inventory); assert.deepEqual(f.saved().care, before.care); assert.equal(f.saved().coins, before.coins); await f.ui.close();
});

test('3D editor rejects an external storage revision and preserves both its draft and the newer real game record', async () => {
  const f = await cozyFixture(); await f.click(f.focusButton('room-edit')); const editor = cozyView(f, true), draft = changedCozy(editor.options.layout); editor.options.onDraftChange(draft);
  const other = Core.create({ storage: f.storage, now: () => new Date(2026, 9, 21, 12).getTime() }); await other.ready;
  assert.equal((await other.dispatch({ type: 'rename', name: '別画面でつけた名前' })).ok, true); const saved = f.saved(), raw = f.data.get(Core.KEY), writes = f.writes.length;
  const result = await editor.options.onSave(draft); await flush();
  assert.equal(result.ok, false); assert.match(result.message, /ほかの操作で記録が変わった/); assert.equal(cozyView(f, true), editor); assert.equal(editor.destroyed, false);
  assert.equal(f.data.get(Core.KEY), raw); assert.deepEqual(f.saved(), saved); assert.equal(f.writes.length, writes); assert.equal(Object.hasOwn(saved, 'cozyRoomLayout'), false); await f.ui.close();
});

test('a focus event keeps the live 3D editor and its transient draft instead of destroying its undo-owning controller', async () => {
  const f = await cozyFixture(); await f.click(f.focusButton('room-edit')); const editor = cozyView(f, true), draft = changedCozy(editor.options.layout), before = f.saved(), writes = f.writes.length;
  editor.options.onDraftChange(draft); const mounts = f.cozyMounts.length; f.window.emit('focus'); await flush();
  assert.equal(cozyView(f, true), editor); assert.equal(editor.destroyed, false); assert.equal(f.cozyMounts.length, mounts); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
  assert.equal((await editor.options.onSave(draft)).ok, true); await flush(); assert.deepEqual(copy(cozyView(f, false).options.layout), draft); await f.ui.close();
});

test('closing a pending 3D mount destroys its late controller and stale callbacks cannot edit, save, report errors or reopen it', async () => {
  const f = await cozyFixture(), before = f.saved(), writes = f.writes.length, gate = deferred(); f.cozyControl.pending = gate;
  await f.click(f.focusButton('room-edit')); const old = f.cozyMounts.at(-1), oldHost = old.options.host; assert.equal(old.options.editable, true);
  await f.ui.close(); assert.equal(old.options.canRun(), false); old.options.onDraftChange(changedCozy(old.options.layout)); old.options.onError(); old.options.onProjectPet({ left: 1, top: 1, scale: 20 });
  assert.equal((await old.options.onSave(old.options.layout)).ok, false); old.options.onCancel();
  await f.ui.open(); const next = f.cozyMounts.at(-1); assert.notEqual(next, old); assert.equal(next.options.editable, false);
  gate.resolve(); f.cozyControl.pending = null; await flush();
  assert.equal(old.destroyed, true); assert.equal(old.destroyCount, 1); assert.equal(cozyView(f, false), next); assert.equal(oldHost.isConnected, false);
  assert.equal(f.host.querySelector('.ipg-room-editor'), null); assert.equal(f.host.querySelector('.ipg-cozy-failure'), null); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); await f.ui.close();
});

test('a pending old 3D controller cannot project or save into a different host and private game store', async () => {
  const f = await cozyFixture(), before = f.saved(), raw = f.data.get(Core.KEY), writes = f.writes.length, gate = deferred(); f.cozyControl.pending = gate;
  await f.click(f.focusButton('room-edit')); const old = f.cozyMounts.at(-1);
  const otherRecord = copy(before); otherRecord.pet.name = '別の保存先のこ'; otherRecord.cozyRoomLayout = changedCozy(Core.defaultCozyRoomLayout(), 'mint');
  const values = new Map([[Core.KEY, JSON.stringify(otherRecord)]]), otherWrites = [], storage = { getItem: key => values.get(key) ?? null, setItem(key, text) { values.set(key, text); otherWrites.push([key, text]); } };
  const target = f.document.createElement('div'); f.pane.appendChild(target);
  assert.equal(await f.ui.mount(target, { storage, developerPreview: false, now: () => new Date(2026, 9, 21, 12).getTime(), random: () => .5 }), true);
  target.querySelector('[data-focus-key="tab-care"]').emit('click'); await flush(); const current = f.cozyMounts.at(-1);
  assert.notEqual(current, old); assert.equal(current.options.editable, false); assert.equal(old.options.canRun(), false);
  old.options.onProjectPet({ left: 1, top: 1, scale: 99 }); old.options.onDraftChange(changedCozy(old.options.layout)); old.options.onCancel(); old.options.onError();
  assert.equal((await old.options.onSave(old.options.layout)).ok, false);
  gate.resolve(); f.cozyControl.pending = null; await flush();
  assert.equal(old.destroyed, true); assert.equal(current.destroyed, false); assert.ok(target.textContent.includes('別の保存先のこ'));
  assert.deepEqual(copy(current.options.layout), otherRecord.cozyRoomLayout); assert.equal(target.querySelector('.ipg-room-editor'), null); assert.equal(target.querySelector('.ipg-cozy-failure'), null);
  assert.deepEqual(JSON.parse(values.get(Core.KEY)), otherRecord); assert.equal(otherWrites.length, 0); assert.equal(f.data.get(Core.KEY), raw); assert.equal(f.writes.length, writes); await f.ui.close();
});

test('a late 3D save may commit in its original store but cannot overwrite a newly opened editor draft or announce success there', async () => {
  const f = await cozyFixture(); await f.click(f.focusButton('room-edit')); const old = cozyView(f, true), firstDraft = changedCozy(old.options.layout), gate = deferred();
  f.control.pending = gate; const pendingSave = old.options.onSave(firstDraft); await flush(); await f.ui.close(); await f.ui.open(); await f.click(f.focusButton('room-edit'));
  const next = cozyView(f, true), newDraft = changedCozy(next.options.layout, 'mint'); next.options.onDraftChange(newDraft);
  gate.resolve(); f.control.pending = null; const result = await pendingSave; await flush();
  assert.equal(result.ok, false); assert.equal(old.destroyed, true); assert.ok(f.host.querySelector('.ipg-room-editor'));
  assert.deepEqual(copy(cozyView(f, true).options.layout), newDraft); assert.deepEqual(f.saved().cozyRoomLayout, firstDraft);
  assert.equal(f.host.textContent.includes('おへやの配置を保存しました'), false); assert.equal(f.host.getAttribute('aria-busy'), 'false'); await f.ui.close();
});

test('3D controllers are destroyed on care rerender, tab navigation and close, while detached controls stay powerless', async () => {
  const f = await cozyFixture(), before = f.saved(), writes = f.writes.length, first = cozyView(f, false);
  await f.click(f.focusButton('tab-shop')); assert.equal(first.destroyed, true); assert.equal(first.destroyCount, 1); assert.equal(first.options.canRun(), false);
  await f.click(f.focusButton('tab-care')); const second = cozyView(f, false); assert.notEqual(second, first);
  f.ui.render(); await flush(); assert.equal(second.destroyed, true); const third = cozyView(f, false);
  await f.ui.close(); assert.equal(third.destroyed, true); assert.equal(third.destroyCount, 1); assert.equal(third.options.canRun(), false);
  first.options.onCancel(); third.options.onError(); third.options.onDraftChange(changedCozy(third.options.layout)); assert.equal((await third.options.onSave(third.options.layout)).ok, false);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('a failed 3D renderer reports an unavailable room without replacing records or consuming care', async () => {
  const f = await cozyFixture(), before = f.saved(), writes = f.writes.length; f.cozyControl.reject = true; f.ui.render(); await flush();
  assert.ok(f.host.querySelector('.ipg-cozy-failure')); assert.ok(f.host.textContent.includes('配置の記録はそのままです')); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); await f.ui.close();
});

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
  assert.match(still.querySelector('.ipg-lilac-still-base').src, /pet_lilac_reference_v2\.png$/); assert.equal(still.hidden, false); assert.equal(canvas.hidden, true);
  f.mounts[0].options.onReady(); assert.equal(still.hidden, true); assert.equal(canvas.hidden, false);
  assert.ok(f.host.textContent.includes('もとの子'));
});

test('all eleven fallback appearances and mature boundaries retain the selected reference with no save writes', async () => {
  for (const exp of [0, 5, 10, 15, 30, 45, 75, 110, 199, 200, 399, 400, 799, 800]) {
    const f = await fixture({ species: 'lilac', rendererMode: 'error', seed: { pg_exp: String(exp) } });
    const state = f.saved(), writes = f.writes.length;
    const appearance = Core.getLilacAppearance(exp), profile = Motion.appearanceProfile(appearance.key);
    const still = f.host.querySelector('.ipg-lilac-still'), patch = still.querySelector('.ipg-lilac-mouth-patch');
    assert.equal(still.hidden, false, appearance.key);
    assert.equal(f.host.querySelector('canvas').hidden, true);
    assert.equal(still.getAttribute('role'), 'img');
    const base = still.querySelector(profile.family === 'egg' ? '.ipg-egg-sheet' : '.ipg-lilac-still-base');
    assert.equal(base.src, '/static/' + profile.stillBaseAsset, appearance.key);
    assert.equal(still.style.transform, 'scale(' + profile.overallScale + ')');
    if (exp >= 15) { assert.equal(base.src, '/static/pet_lilac_reference_v2.png'); assert.equal(profile.family, 'baby'); }
    if (exp < 10) assert.equal(patch, null, 'unhatched eggs must not have a mouth');
    else {
      assert.equal(patch.src, '/static/' + profile.stillAsset, appearance.key);
      assert.match(patch.style.maskImage, /^radial-gradient\(ellipse /);
      assert.match(patch.style.clipPath, /^inset\(/);
      assert.equal(patch.getAttribute('aria-hidden'), 'true');
      assert.equal(patch.alt, '');
    }
    assert.deepEqual(f.saved(), state); assert.equal(f.writes.length, writes);
  }
});

test('a missing motion module still renders the chosen mouth below the protected nose', async () => {
  for (const exp of [0, 5, 10, 15, 30, 45, 75, 110, 199, 200, 399, 400, 799, 800]) {
    const f = await fixture({ species: 'lilac', rendererUnavailable: true, seed: { pg_exp: String(exp) } });
    const state = f.saved(), writes = f.writes.length, profile = Motion.appearanceProfile(Core.getLilacAppearance(exp).key);
    const still = f.host.querySelector('.ipg-lilac-still'), patch = still.querySelector('.ipg-lilac-mouth-patch');
    assert.equal(still.hidden, false); assert.equal(f.mounts.length, 0);
    const base = still.querySelector(profile.family === 'egg' ? '.ipg-egg-sheet' : '.ipg-lilac-still-base');
    assert.equal(base.src, '/static/' + profile.stillBaseAsset);assert.equal(still.style.transform, 'scale(' + profile.overallScale + ')');
    if (exp < 10) assert.equal(patch, null);
    else {
      assert.equal(patch.src, '/static/' + profile.stillAsset);
      const floor = Number(/^inset\(([\d.]+)%/.exec(patch.style.clipPath)?.[1]) / 100;
      assert.ok(Math.abs(floor - profile.stillMouthMask.floor) < 1e-12);
      assert.ok(patch.style.maskImage.includes(profile.stillMouthMask.x * 100 + '% ' + profile.stillMouthMask.y * 100 + '%'));
    }
    f.ui.render();assert.deepEqual(f.saved(), state);assert.equal(f.writes.length, writes);
  }
});

test('room, gallery, compact header and free fittings share the selected reference at every born stage without writing data', async () => {
  for (const exp of [15, 30, 45, 75, 110, 200, 400, 800]) {
    const f = await fixture({ species: 'lilac', rendererUnavailable: true, seed: { pg_exp: String(exp) } });
    const before = f.saved(), writes = f.writes.length, key = Core.getLilacAppearance(exp).key;
    const reference = container => {
      const base = container.querySelector('.ipg-lilac-still-base'), mouth = container.querySelector('.ipg-lilac-mouth-patch');
      assert.equal(base.src, '/static/pet_lilac_reference_v2.png', key);assert.equal(mouth.src, base.src);
    };
    reference(f.host.querySelector('.ipg-emotion-stage'));
    await f.click(f.focusButton('growth-album-toggle'));reference(f.host.querySelector('.ipg-growth-gallery'));
    await f.click(f.focusButton('tab-shop'));reference(f.host.querySelector('.ipg-lilac-compact'));
    await f.click(f.focusButton('outfit-try-cloth_flower_dress'));reference(f.host.querySelector('.ipg-outfit-fitting'));
    assert.deepEqual(f.saved(), before);assert.equal(f.writes.length, writes);assert.equal(f.mounts.length, 0);
  }
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

test('B begins as a real hatching egg and the confirmed 15 EXP boundary reveals the newborn without cutting off its feeding cue', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '14' } }), before = f.saved();
  assert.equal(f.mounts.length, 1); assert.ok(f.host.querySelector('canvas'));
  assert.match(f.host.querySelector('.ipg-egg-sheet').src, /pet_lilac_egg_stages_v1\.png$/);
  assert.equal(f.host.querySelector('.ipg-lilac-still').dataset.eggCell, '2'); assert.equal(f.mounts[0].options.appearanceKey, 'hatching');
  assert.equal(before.pet.exp, 14); assert.equal(f.store.getState().stage.key, 'egg');
  assert.ok(f.host.querySelector('.ipg-stage').textContent.includes('もうすぐうまれる'));
  await f.click(f.focusButton('care-feed'));
  assert.equal(f.saved().pet.exp, 22); assert.equal(f.mounts.length, 2); assert.equal(f.activeMotions().length, 1);
  assert.equal(f.mounts.at(-1).options.situation, 'feeding'); assert.equal(f.actionCues.length, 1);
  assert.equal(f.mounts.at(-1).options.appearanceKey, 'newborn'); assert.equal(f.mounts.at(-1).options.growthStage, 'baby');
  assert.match(f.host.querySelector('.ipg-lilac-still-base').src, /pet_lilac_reference_v2\.png$/);
  assert.equal(f.host.querySelector('.ipg-lilac-visual').dataset.feedingPhase, 'anticipation');
});

test('the three real egg cells stay distinct before drawing and in fallback without claiming the grown B image is an egg', async () => {
  for (const [exp, key, cell, left, top] of [[0, 'egg', '0', '0%', '0%'], [5, 'egg_cracked', '1', '-100%', '0%'], [10, 'hatching', '2', '0%', '-100%']]) {
    const f = await fixture({ species: 'lilac', seed: { pg_exp: String(exp) } }), before = f.saved(), writes = f.writes.length;
    const still = f.host.querySelector('.ipg-lilac-still'), sheet = still.querySelector('img');
    assert.equal(still.dataset.eggCell, cell); assert.equal(still.getAttribute('role'), 'img'); assert.match(sheet.src, /pet_lilac_egg_stages_v1\.png$/);
    const profile = Motion.appearanceProfile(key);
    if (profile.stillRect) assert.equal(still.dataset.sourceRect, profile.stillRect.join(','));
    else { assert.equal(sheet.style.left, left); assert.equal(sheet.style.top, top); }
    assert.equal(still.hidden, false);
    assert.equal(f.mounts[0].options.appearanceKey, key); assert.equal(f.mounts[0].options.growthStage, 'egg');
    f.mounts[0].options.onError(); assert.equal(still.hidden, false); assert.equal(f.host.querySelector('canvas').hidden, true);
    assert.equal(f.host.querySelectorAll('img').some(image => /pet_lilac_cutout/.test(image.src)), false);
    assert.match(f.focusButton('care-feed').textContent, /あたためる/); assert.match(f.host.querySelector('.ipg-nursery-note').textContent, /15 EXP/);
    assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
  }
});

test('the hatching fallback uses its exact non-square source rectangle without cutting a detached lid or distorting sheet pixels', async () => {
  const f = await fixture({ species: 'lilac', seed: { pg_exp: '10' } }), before = f.saved(), writes = f.writes.length;
  const original = f.window.PetLilacMotion.appearanceProfile, rect = [0, .5, .575, 1];
  f.window.PetLilacMotion.appearanceProfile = key => ({ ...original(key), ...(key === 'hatching' ? { stillRect: rect } : {}) });
  f.ui.render();
  const still = f.host.querySelector('.ipg-lilac-still'), crop = still.querySelector('.ipg-egg-crop'), sheet = crop.querySelector('img');
  assert.equal(still.dataset.sourceRect, rect.join(',')); assert.equal(crop.style.width, '100%');
  assert.equal(crop.style.height, String(.5 / .575 * 100) + '%');
  assert.equal(sheet.style.width, String(100 / .575) + '%'); assert.equal(sheet.style.height, '200%');
  assert.equal(sheet.style.left, '0%'); assert.equal(sheet.style.top, '-100%');
  assert.ok(Math.abs(parseFloat(crop.style.width) * parseFloat(sheet.style.width) - parseFloat(crop.style.height) * parseFloat(sheet.style.height)) < 1e-8,
    'the complete sheet keeps its original pixel aspect while the source rectangle alone is clipped');
  f.window.PetLilacMotion.appearanceProfile = key => ({ ...original(key), stillRect: [0, .5, NaN, 1] }); f.ui.render();
  const measured = [99, 648, 721, 1189].map(value => value / 1254).join(',');
  assert.equal(f.host.querySelector('.ipg-lilac-still').dataset.sourceRect, measured, 'invalid metadata must keep the real lid rather than falling back to an unsafe quarter cell');
  delete f.window.PetLilacMotion; f.ui.render();
  assert.equal(f.host.querySelector('.ipg-lilac-still').dataset.sourceRect, measured, 'a missing optional module uses the same measured source rectangle');
  assert.match(f.host.querySelector('.ipg-egg-sheet').src, /pet_lilac_egg_stages_v1\.png$/);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('warming an egg uses the existing care reward once, shows shell reactions without mouth food, and hatches only at real saved EXP', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '0' } }), before = f.saved(), writes = f.writes.length;
  await f.click(f.focusButton('care-feed'));
  const first = f.saved(), visual = f.host.querySelector('.ipg-lilac-visual'), food = visual.querySelector('.ipg-feeding-food'), controller = f.mounts.at(-1);
  assert.equal(first.pet.exp, 8); assert.equal(first.coins, before.coins + 10); assert.equal(f.writes.length, writes + 1);
  assert.equal(controller.options.appearanceKey, 'egg_cracked'); assert.equal(food.hidden, true); assert.deepEqual(first.evolution.history, []);
  assert.match(f.host.querySelector('.ipg-emotion-caption').textContent, /たまごに元気/);
  f.advance(1200); await f.fireTimers(); assert.equal(visual.dataset.feedingPhase, 'chewing');
  assert.match(f.host.querySelector('.ipg-emotion-caption').textContent, /殻がぽかぽか/); assert.equal(food.hidden, true);
  assert.equal(visual.querySelector('.ipg-emotion-effect').hidden, true, 'an egg cannot produce chewing crumbs');
  const anchor = { left: food.style.left, top: food.style.top };
  controller.options.onPose({ situation: 'feeding', elapsedMs: 1500, foodLeft: .1, foodTop: .2 }); assert.deepEqual({ left: food.style.left, top: food.style.top }, anchor);
  f.advance(7200); await f.fireTimers(); assert.equal(visual.dataset.situation, 'idle'); assert.equal(food.hidden, true); assert.equal(f.timers.size, 0);
  assert.deepEqual(f.saved(), first); assert.equal(f.writes.length, writes + 1);
  await f.click(f.focusButton('care-feed'));
  assert.equal(f.saved().pet.exp, 16); assert.equal(f.saved().coins, first.coins); assert.equal(f.writes.length, writes + 2);
  assert.equal(f.mounts.at(-1).options.appearanceKey, 'newborn'); assert.equal(f.host.querySelector('.ipg-feeding-food').hidden, false);
  assert.match(f.focusButton('care-feed').textContent, /ごはん/); assert.equal(f.host.querySelector('.ipg-nursery-note'), null);
  assert.deepEqual(f.saved().evolution.history.map(row => [row.stageKey, row.min]), [['baby', 15]], 'cracks at 5 and 10 never become saved colour milestones');
});

test('pending or rejected warmth keeps the previous egg and every saved field, while a confirmed visual step adds no extra reward', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '4' } }); f.advance(10000); f.ui.render();
  const before = f.saved(), writes = f.writes.length, gate = deferred(); f.control.pending = gate; f.control.outcome = 'false';
  await f.click(f.focusButton('care-feed'));
  assert.equal(f.mounts.at(-1).options.appearanceKey, 'egg'); assert.equal(f.host.querySelector('.ipg-lilac-still').dataset.eggCell, '0'); assert.deepEqual(f.saved(), before);
  gate.resolve(); await flush(); f.control.pending = null;
  assert.equal(f.mounts.at(-1).options.appearanceKey, 'egg'); assert.equal(f.host.querySelector('.ipg-feeding-food').hidden, true); assert.deepEqual(f.saved(), before);
  f.control.outcome = 'ok'; await f.click(f.focusButton('care-feed'));
  assert.equal(f.saved().pet.exp, 12); assert.equal(f.saved().coins, before.coins + 10); assert.equal(f.writes.length, writes + 1);
  assert.equal(f.mounts.at(-1).options.appearanceKey, 'hatching'); assert.equal(f.host.querySelector('.ipg-lilac-still').dataset.eggCell, '2');
  assert.equal(f.host.querySelector('.ipg-feeding-food').hidden, true); assert.deepEqual(f.saved().evolution.history, []); assert.ok(f.host.textContent.includes('あと3 EXP'));
});

test('a saved 386 EXP pet adopts the selected reference B and retains its outfit, canonical history and exact economy while browsing all earlier appearances', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '386', pg_coins: '355' }, setup: async store => {
    await store.dispatch({ type: 'buyItem', itemId: 'cloth_cream_vest' }); await store.dispatch({ type: 'equipClothing', itemId: 'cloth_cream_vest' });
  } }), before = f.saved(), writes = f.writes.length;
  assert.equal(before.pet.exp, 386); assert.equal(before.coins, 355); assert.equal(f.mounts[0].options.appearanceKey, 'grown'); assert.equal(f.mounts[0].options.growthStage, 'final');
  assert.equal(f.mounts[0].options.outfit, 'cloth_cream_vest'); assert.match(f.host.querySelector('.ipg-lilac-still-base').src, /pet_lilac_reference_v2\.png$/);
  assert.equal(f.host.querySelector('.ipg-stage').textContent, '育った姿 · 386 EXP'); assert.ok(f.host.textContent.includes('あと14 EXP'));
  await f.click(f.focusButton('growth-album-toggle'));
  assert.equal(f.host.querySelector('.ipg-growth-choices').getAttribute('aria-label'), '成長のすがた・11段階');
  for (const key of ['egg', 'egg_cracked', 'hatching', 'newborn', 'baby', 'toddler', 'child', 'juvenile']) {
    await f.click(f.focusButton('growth-stage-' + key));
    assert.equal(f.mounts.at(-1).options.appearanceKey, key); assert.equal(f.activeMotions()[0].options.appearanceKey, 'grown');
    assert.equal(f.activeMotions()[0].options.outfit, 'cloth_cream_vest'); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
  }
  f.window.emit('focus'); await flush(); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('a new visual boundary is celebrated only after its successful save without manufacturing a canonical evolution entry', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '27' } }); f.advance(10000); f.ui.render();
  const before = f.saved(); f.control.outcome = 'false'; await f.click(f.focusButton('care-play'));
  assert.equal(f.mounts.at(-1).options.appearanceKey, 'newborn'); assert.deepEqual(f.saved(), before);
  f.control.outcome = 'ok'; await f.click(f.focusButton('care-play'));
  assert.equal(f.saved().pet.exp, 32); assert.equal(f.saved().coins, before.coins + 10);
  assert.equal(f.mounts.at(-1).options.appearanceKey, 'baby'); assert.equal(f.mounts.at(-1).options.growthStage, 'baby'); assert.equal(f.mounts.at(-1).options.situation, 'joy');
  assert.equal(f.host.querySelector('.ipg-stage').textContent, 'あかちゃん · 32 EXP'); assert.deepEqual(f.saved().evolution.history, []);
  assert.equal(f.saved().evolution.scores.active, 3); assert.equal(Core.getLilacEvolution(f.store.getState()).nextAt, 45);
});

test('recorded canonical milestones display the matching appearance labels without rewriting their original keys, values or times', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '14' }, setup: async store => {
    for (const kind of ['feed', 'play', 'play', 'play', 'rest', 'rest']) assert.equal((await store.dispatch({ type: 'care', kind })).ok, true);
  } }), before = f.saved(), writes = f.writes.length;
  assert.deepEqual(before.evolution.history.map(row => [row.stageKey, row.min]), [['baby', 15], ['child', 45]]);
  let rows = f.host.querySelector('.ipg-evolution-history').querySelectorAll('li');
  assert.match(rows[0].textContent, /^うまれたて · 15 EXP/); assert.match(rows[1].textContent, /^よちよち · 45 EXP/);
  assert.ok(rows.every(row => row.textContent.includes('JST')));
  f.ui.render(); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
  delete f.window.PetGameCore.getLilacAppearance; f.ui.render(); rows = f.host.querySelector('.ipg-evolution-history').querySelectorAll('li');
  assert.match(rows[0].textContent, /^よちよち · 15 EXP/); assert.match(rows[1].textContent, /^こども · 45 EXP/);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
  const older = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '1597' }, setup: async store => {
    assert.equal((await store.dispatch({ type: 'care', kind: 'rest' })).ok, true);
  } }), saved = older.saved(), oldWrites = older.writes.length;
  assert.equal(saved.evolution.history[0].stageKey, 'companion'); assert.equal(saved.evolution.history[0].min, 1600);
  assert.match(older.host.querySelector('.ipg-evolution-history').querySelector('li').textContent, /^なかよしの姿 · 1,600 EXP/);
  older.ui.render(); assert.deepEqual(older.saved(), saved); assert.equal(older.writes.length, oldWrites);
});

test('egg clothing stays owned and saved for hatching while a free future newborn fitting never changes the egg or purchases clothes', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '0' }, setup: async store => {
    await store.dispatch({ type: 'buyItem', itemId: 'cloth_cream_vest' }); await store.dispatch({ type: 'equipClothing', itemId: 'cloth_cream_vest' });
  } }), before = f.saved(), writes = f.writes.length;
  assert.equal(f.mounts[0].options.appearanceKey, 'egg'); assert.equal(f.mounts[0].options.outfit, 'cloth_cream_vest');
  assert.match(f.host.querySelector('.ipg-worn-outfit').textContent, /孵化後のお洋服.*孵化すると着られます/);
  await f.click(f.focusButton('tab-shop')); await f.click(f.focusButton('outfit-try-cloth_rose_cape'));
  assert.equal(f.activeMotions()[0].options.appearanceKey, 'egg'); assert.equal(f.mounts.at(-1).options.appearanceKey, 'newborn');
  assert.match(f.host.querySelector('.ipg-fitting-caption').textContent, /孵化後の姿.*未購入・試着の見本/);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
  delete f.window.PetLilacMotion; f.ui.render();
  assert.match(f.host.querySelector('.ipg-egg-sheet').src, /pet_lilac_egg_stages_v1\.png$/);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('retired dragons display B with preserved progress and no red dragon choices; bunny images remain unchanged', async () => {
  for (const exp of ['0', '167']) {
    const f = await fixture({ seed: { pg_species: 'dragon', pg_exp: exp }, rendererMode: 'ready' }), before = f.saved();
    assert.equal(before.pet.species, 'lilac'); assert.equal(before.pet.exp, Number(exp));
    assert.equal(before.pet.path, 'cool'); assert.equal(before.pet.pixel, true);
    assert.equal(before.migration.legacyRaw.pg_species, 'dragon'); assert.equal(f.data.get('pg_species'), 'dragon');
    assert.ok(f.host.querySelector('canvas')); assert.equal(f.mounts.length, 1);
    assert.ok(f.host.querySelectorAll('img').every(img => !/pet_img_|pet_lilac_egg\.webp/.test(img.src)));
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

test('only the four retained game tabs are reachable and ordinary care play remains available', async () => {
  const f=await fixture({species:'lilac',rendererMode:'ready'}),before=f.saved();
  assert.deepEqual(f.host.querySelector('.ipg-tabs').children.map(b=>b.dataset.focusKey),['tab-village','tab-care','tab-shop','tab-market']);
  assert.equal(f.host.querySelector('[data-focus-key="tab-play"]'),null);
  for(const key of ['shop','market','care']){
    await f.click(f.focusButton('tab-'+key));assert.equal(f.host.querySelector('.ipg-catch-board'),null);assert.equal(f.host.querySelector('.ipg-cafe-activity'),null);
    assert.doesNotMatch(f.host.textContent,/ミニゲーム|25秒|結果の保存を再試行|前の回を終了/);
  }
  assert.deepEqual(f.saved(),before);await f.click(f.focusButton('care-play'));
  assert.equal(f.saved().pet.exp,before.pet.exp+5);assert.equal(f.saved().care.counts.play,before.care.counts.play+1);
  assert.deepEqual(f.saved().minigames,before.minigames);await f.ui.close();
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

test('closing a direction drawer recenters the actor after layout without restarting a body, ordinary emotion or meal deadline', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
  f.window.innerHeight = 720; shellBounds(f, { top: 0, height: 69 }, { top: 662, height: 58 });
  let actorTop = 269; const visual = f.host.querySelector('.ipg-lilac-visual'), controller = f.mounts[0];
  visual.getBoundingClientRect = () => ({ top: actorTop, height: 260 });
  const originalScroll = visual.scrollIntoView.bind(visual);
  visual.scrollIntoView = options => { originalScroll(options); actorTop = 269; };
  for (const id of ['body_tail', 'cry', 'feeding']) {
    await f.directionDrawer();
    if (id === 'body_tail') { await f.bodyDrawer(); await f.click(f.focusButton('pet-body-motion-' + id)); }
    else await f.click(await f.revealEmotion(id));
    f.advance(1500); await f.fireTimers();
    const deadline = [...f.timers.values()][0].at, changes = controller.changes.length;
    const phase = visual.dataset.cuePhase, foodHidden = f.host.querySelector('.ipg-feeding-food').hidden;
    const effects = f.host.querySelector('.ipg-emotion-effect'), effectClass = effects.className, effectHidden = effects.hidden;
    actorTop = 30; const scrolls = f.scrolls().length; await f.directionDrawer(false);
    assert.equal(f.raf.size, 1, 'one layout check is queued, not a permanent animation loop');
    assert.equal(controller.changes.length, changes); assert.equal([...f.timers.values()][0].at, deadline);
    await f.frame(); assert.equal(f.raf.size, 0); assert.equal(actorTop, 269); assert.equal(f.scrolls().length, scrolls + 1);
    assert.equal(visual.dataset.situation, id); assert.equal(visual.dataset.cuePhase, phase);
    assert.equal(f.host.querySelector('.ipg-feeding-food').hidden, foodHidden);
    assert.equal(effects.className, effectClass); assert.equal(effects.hidden, effectHidden);
    assert.equal(controller.changes.length, changes); assert.equal([...f.timers.values()][0].at, deadline);
    f.advance(Motion.durations[id] - 1500); await f.fireTimers();
    assert.equal(visual.dataset.cuePhase, 'idle'); assert.equal(f.scrolls().length, scrolls + 1);
    assert.equal(f.raf.size, 0); assert.equal(f.timers.size, 0); assert.equal(f.mounts.length, 1);
  }
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(f.actionCues.length, 0);
});

test('closing its own direction returns to idle and checks the larger front wrapper exactly once after the drawer shrinks', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
  f.window.innerHeight = 720; shellBounds(f, { top: 0, height: 69 }, { top: 662, height: 58 });
  let actorTop = 269; const visual = f.host.querySelector('.ipg-lilac-visual');
  visual.getBoundingClientRect = () => ({ top: actorTop, height: 260 });
  await f.directionDrawer(); await f.click(f.focusButton('pet-direction-motion-direction_back'));
  actorTop = 30; await f.directionDrawer(false);
  assert.equal(f.mounts[0].changes.at(-1).name, 'idle'); assert.equal(visual.dataset.cuePhase, 'idle'); assert.equal(f.timers.size, 0);
  assert.equal(f.scrolls().length, 0); assert.equal(f.raf.size, 1);
  await f.frame(); assert.equal(f.scrolls().length, 1); assert.equal(f.raf.size, 0);
  await f.frame(10000); assert.equal(f.scrolls().length, 1, 'no later timer or frame can keep recentring');
  assert.equal(f.mounts.length, 1); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('rapid drawer closes share one layout frame which hide, fallback and rerender cancel before touching an old visual', async () => {
  for (const cleanup of ['hide', 'fallback', 'render']) {
    const f = await fixture({ species: 'lilac', rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
    f.window.innerHeight = 720; shellBounds(f, { top: 0, height: 69 }, { top: 662, height: 58 });
    const visual = f.host.querySelector('.ipg-lilac-visual'); visual.getBoundingClientRect = () => ({ top: 30, height: 260 });
    await f.directionDrawer(); await f.bodyDrawer();
    await f.directionDrawer(false); await f.bodyDrawer(false);
    assert.equal(f.raf.size, 1, cleanup + ': both close events coalesce on the same actor');
    if (cleanup === 'hide') { f.document.hidden = true; f.document.emit('visibilitychange'); await flush(); }
    else if (cleanup === 'fallback') f.mounts[0].options.onError();
    else f.ui.render();
    assert.equal(f.raf.size, 0, cleanup + ': the pending one-shot is cancelled'); await f.frame();
    assert.equal(f.scrolls().length, 0); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
  }
});

test('seven full-body references share the actual clothed actor without changing the 100-expression catalogue or any saved progress', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '373', pg_coins: '355' }, setup: async store => {
    await store.dispatch({ type: 'buyItem', itemId: 'cloth_cream_vest' }); await store.dispatch({ type: 'equipClothing', itemId: 'cloth_cream_vest' });
  } }), before = f.saved(), writes = f.writes.length;
  const controller = f.mounts[0], visual = f.host.querySelector('.ipg-lilac-visual');
  assert.equal(controller.options.outfit, 'cloth_cream_vest'); assert.equal(controller.options.growthStage, 'final');
  const drawer = await f.bodyDrawer(); assert.equal(drawer.open, true);
  const choices = drawer.querySelectorAll('button'); assert.equal(choices.length, 7);
  assert.deepEqual(choices.map(button => button.dataset.bodyMotion), ['body_hands', 'body_flap', 'body_feet', 'body_ears', 'body_tail', 'body_head', 'body_joy']);
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
    f.advance(row.durationMs - 1250); await f.fireTimers(); assert.equal(visual.dataset.cuePhase, 'settling');
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

test('four direction references keep the 100 moods and seven body controls separate while returning to idle without savings or remounts', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '373', pg_coins: '355' }, setup: async store => {
    await store.dispatch({ type: 'buyItem', itemId: 'cloth_cream_vest' }); await store.dispatch({ type: 'equipClothing', itemId: 'cloth_cream_vest' });
  } }), before = f.saved(), writes = f.writes.length;
  const drawer = await f.directionDrawer(), controller = f.mounts[0], visual = f.host.querySelector('.ipg-lilac-visual');
  assert.equal(drawer.querySelector('summary').textContent, '向きと回転を見る'); assert.match(drawer.textContent, /終わると正面に戻ります/);
  assert.deepEqual(drawer.querySelectorAll('button').map(button => button.dataset.directionMotion), ['direction_left', 'direction_right', 'direction_back', 'direction_spin']);
  assert.equal(f.buttons().filter(button => button.dataset.emotion).length, 100); assert.equal(f.buttons().filter(button => button.dataset.bodyMotion).length, 7);
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
  assert.equal(f.buttons().filter(button => button.dataset.emotion).length, 100); assert.equal(f.buttons().filter(button => button.dataset.bodyMotion).length, 7);
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
  assert.equal(f.saved().pet.exp, 0); assert.match(f.host.querySelector('.ipg-egg-sheet').src, /pet_lilac_egg_stages_v1\.png$/);
  assert.equal(f.mounts[0].options.appearanceKey, 'egg');
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
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '15' } });
  f.advance(10000); f.ui.render(); const before = f.saved(), writes = f.writes.length;
  await f.click(f.focusButton('care-feed'));
  const after = f.saved(), wrap = f.host.querySelector('.ipg-lilac-visual'), food = wrap.querySelector('.ipg-feeding-food');
  const effect = wrap.querySelector('.ipg-emotion-effect'), caption = f.host.querySelector('.ipg-emotion-caption');
  assert.equal(after.pet.exp, 23); assert.equal(after.coins, before.coins + 10); assert.equal(f.writes.length, writes + 1);
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
  assert.equal(f.host.querySelector('.ipg-stage').textContent, '育った姿 · 373 EXP');
  assert.ok(f.host.textContent.includes('次の成長まで あと27 EXP'));
  assert.equal(f.host.querySelector('progress').value, Core.getLilacAppearance(373).progress);
  assert.equal(f.mounts.at(-1).options.growthStage, 'final');
  assert.equal(f.host.querySelector('.ipg-lilac-visual').dataset.growthStage, 'final');
  assert.equal(f.store.getState().stage.key, 'final', 'old core appearance/reward stage still remains readable');
  f.window.emit('focus'); await flush();
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(f.actionCues.length, 0);
});

test('growth album previews all eleven appearances in one canvas while future views never grant EXP, coins or an unlock', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '373' } }), before = f.saved(), writes = f.writes.length;
  await f.click(f.focusButton('growth-album-toggle'));
  assert.equal(f.focusButton('growth-album-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(f.host.querySelector('.ipg-growth-gallery').querySelectorAll('canvas').length, 1);
  assert.equal(f.mounts.at(-1).options.growthStage, 'final'); assert.equal(f.mounts.at(-1).options.situation, 'idle');
  assert.match(f.host.querySelector('.ipg-growth-caption').textContent, /育った姿.*いまの姿/);
  assert.equal(f.host.querySelectorAll('button').filter(button => button.dataset.growthStage).length, 11);
  for (const entry of Core.lilacAppearanceStages) {
    const previous = f.mounts.at(-1); await f.click(f.focusButton('growth-stage-' + entry.key));
    assert.equal(previous.destroyed, true); assert.equal(f.activeMotions().length, 2);
    assert.equal(f.host.querySelector('.ipg-growth-gallery').querySelectorAll('canvas').length, 1);
    assert.equal(f.mounts.at(-1).options.growthStage, Core.getLilacGrowth(entry.min).key); assert.equal(f.mounts.at(-1).options.appearanceKey, entry.key); assert.equal(f.mounts.at(-1).options.situation, 'idle');
    assert.equal(f.focusButton('growth-stage-' + entry.key).getAttribute('aria-pressed'), 'true');
    const caption = f.host.querySelector('.ipg-growth-caption').textContent;
    assert.ok(caption.includes(entry.label)); assert.ok(caption.includes(entry.min > 373 ? 'これからの姿・見本' : entry.key === 'grown' ? 'いまの姿' : '育った姿の見本'));
    assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(f.actionCues.length, 0);
    assert.equal(f.host.querySelector('.ipg-stage').textContent, '育った姿 · 373 EXP');
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

test('every growth appearance offers food, faces, body parts and directions on that same gallery canvas without changing the real 386 EXP pet', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '386', pg_coins: '355' } });
  f.advance(10000); f.ui.render(); const before = f.saved(), writes = f.writes.length;
  await f.click(f.focusButton('growth-album-toggle')); const details = f.focusButton('growth-motions-toggle');
  assert.equal(details.open, false); assert.equal(details.querySelector('.ipg-emotion-panel'), null, 'the large palette is created only when requested');
  await f.growthMotions();
  for (const row of Core.lilacAppearanceStages) {
    await f.click(f.focusButton('growth-stage-' + row.key));
    const gallery = f.host.querySelector('.ipg-growth-gallery'), visual = gallery.querySelector('.ipg-lilac-visual'), controller = f.mounts.at(-1);
    const mountCount = f.mounts.length, main = f.activeMotions()[0]; assert.equal(f.focusButton('growth-motions-toggle').open, true);
    assert.equal(controller.options.appearanceKey, row.key); assert.equal(controller.options.situation, 'idle');
    assert.equal(gallery.querySelectorAll('canvas').length, 1);
    assert.equal(gallery.querySelectorAll('button').filter(button => button.dataset.emotion).length, 100);
    assert.equal(gallery.querySelectorAll('button').filter(button => button.dataset.bodyMotion).length, 7);
    assert.equal(gallery.querySelectorAll('button').filter(button => button.dataset.directionMotion).length, 4);
    await f.click(await f.revealEmotion('feeding', 'growth'));
    assert.equal(controller.changes.at(-1).name, 'feeding'); assert.equal(visual.querySelector('.ipg-feeding-food').hidden, row.min < 15);
    await f.click(await f.revealEmotion('cry', 'growth')); assert.equal(controller.changes.at(-1).name, 'cry');
    await f.bodyDrawer(true, 'growth'); await f.click(f.focusButton('growth-body-motion-body_hands')); assert.equal(controller.changes.at(-1).name, 'body_hands');
    await f.click(f.focusButton('growth-body-motion-body_flap')); assert.equal(controller.changes.at(-1).name, 'body_flap');
    await f.directionDrawer(true, 'growth'); await f.click(f.focusButton('growth-direction-motion-direction_back')); assert.equal(controller.changes.at(-1).name, 'direction_back');
    assert.equal(f.mounts.length, mountCount, 'choosing gestures does not remount the selected appearance');
    assert.equal(main.options.appearanceKey, 'grown'); assert.equal(main.changes.length, 0); assert.equal(f.activeMotions().length, 2);
    assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(f.actionCues.length, 0); assert.ok(f.timers.size <= 1);
  }
  f.advance(6500); await f.fireTimers(); assert.equal(f.host.querySelector('.ipg-growth-gallery').querySelector('.ipg-lilac-visual').dataset.situation, 'idle');
  assert.equal(f.timers.size, 0); assert.equal(f.raf.size, 0); assert.deepEqual(f.saved(), before);
});

test('a gallery meal has its own full timeline and closing its controls cannot alter the ongoing main or settings-preview cues', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '386', pg_coins: '355' } }), before = f.saved(), writes = f.writes.length;
  await f.click(await f.revealEmotion('feeding')); f.advance(1500); await f.fireTimers();
  await f.click(f.focusButton('growth-album-toggle')); await f.click(f.button('薄紫のこのしぐさを見る'));
  await f.click(await f.revealEmotion('cry', true)); await f.click(f.focusButton('growth-stage-newborn')); await f.growthMotions();
  const main = f.activeMotions()[0], gallery = f.host.querySelector('.ipg-growth-gallery'), visual = gallery.querySelector('.ipg-lilac-visual');
  const galleryController = f.activeMotions().find(controller => controller.canvas === visual.querySelector('canvas'));
  const settings = f.host.querySelector('.ipg-appearance-preview'), settingsController = f.activeMotions().find(controller => controller.canvas === settings.querySelector('canvas'));
  assert.equal(main.options.situation, 'feeding'); assert.equal(main.options.elapsedMs, 1500); assert.equal(settingsController.options.situation, 'cry');
  await f.click(await f.revealEmotion('feeding', 'growth'));
  assert.equal(visual.dataset.feedingPhase, 'anticipation'); assert.equal(visual.querySelector('.ipg-feeding-food').hidden, false);
  f.advance(1200); await f.fireTimers(); assert.equal(visual.dataset.feedingPhase, 'chewing');
  f.advance(3200); await f.fireTimers(); assert.equal(visual.dataset.feedingPhase, 'joy'); assert.equal(visual.querySelector('.ipg-feeding-food').hidden, true);
  assert.match(gallery.querySelector('.ipg-emotion-caption').textContent, /おいしい！の見本/);
  f.advance(4000); await f.fireTimers(); assert.equal(visual.dataset.situation, 'idle'); assert.equal(galleryController.changes.at(-1).name, 'feeding');
  assert.equal(main.changes.length, 0); assert.equal(settingsController.changes.length, 0); assert.equal(f.timers.size, 0);
  await f.click(await f.revealEmotion('feeding')); await f.click(await f.revealEmotion('cry', true));
  const ids = new Set(f.timers.keys()); await f.click(await f.revealEmotion('feeding', 'growth'));
  const localId = [...f.timers.keys()].find(id => !ids.has(id)); assert.ok(localId);
  f.advance(800); await f.fireTimers(); const otherDeadlines = [...f.timers].filter(([id]) => id !== localId).map(([id, timer]) => [id, timer.at]);
  await f.growthMotions(false); assert.equal(visual.dataset.situation, 'idle'); assert.equal(galleryController.changes.at(-1).name, 'idle');
  assert.deepEqual([...f.timers].map(([id, timer]) => [id, timer.at]), otherDeadlines);
  assert.equal(main.changes.at(-1).name, 'feeding'); assert.equal(settingsController.changes.at(-1).name, 'cry');
  await f.frame(); assert.equal(f.raf.size, 0); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('stage and path changes discard a gallery-only cue while keeping the palette open and preserving main saved appearance', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '386', pg_coins: '355' } });
  f.advance(10000); f.ui.render(); const before = f.saved(), writes = f.writes.length;
  await f.click(f.focusButton('growth-album-toggle')); await f.click(f.focusButton('growth-stage-newborn')); await f.growthMotions();
  await f.click(await f.revealEmotion('feeding', 'growth')); f.advance(1500); await f.fireTimers();
  const old = f.mounts.at(-1), oldFood = f.host.querySelector('.ipg-growth-gallery').querySelector('.ipg-feeding-food');
  assert.equal(oldFood.hidden, false); await f.click(f.focusButton('growth-path-fruit'));
  assert.equal(old.destroyed, true); assert.equal(oldFood.hidden, true); assert.equal(f.mounts.at(-1).options.situation, 'idle');
  assert.equal(f.mounts.at(-1).options.appearanceKey, 'newborn'); assert.equal(f.mounts.at(-1).options.evolutionPath, 'fruit');
  assert.equal(f.focusButton('growth-motions-toggle').open, true); assert.equal(f.timers.size, 0);
  await f.directionDrawer(true, 'growth'); await f.click(f.focusButton('growth-direction-motion-direction_spin'));
  const turn = f.mounts.at(-1); await f.click(f.focusButton('growth-stage-hatching'));
  assert.equal(turn.destroyed, true); assert.equal(f.mounts.at(-1).options.situation, 'idle'); assert.equal(f.mounts.at(-1).options.appearanceKey, 'hatching');
  assert.equal(f.activeMotions()[0].options.appearanceKey, 'grown'); assert.equal(f.activeMotions()[0].options.evolutionPath, 'balanced'); assert.equal(f.timers.size, 0);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('a lazy gallery palette stays disabled after renderer failure or module absence, and hiding a live gallery clears only transient resources', async () => {
  for (const mode of ['error', 'missing']) {
    const f = await fixture({ species: 'lilac', rendererMode: mode === 'error' ? 'error' : 'ready', seed: { pg_exp: '386' } }), before = f.saved(), writes = f.writes.length;
    if (mode === 'missing') { delete f.window.PetLilacMotion; f.ui.render(); }
    await f.click(f.focusButton('growth-album-toggle')); await f.click(f.focusButton('growth-stage-newborn')); await f.growthMotions();
    const gallery = f.host.querySelector('.ipg-growth-gallery'), choices = gallery.querySelectorAll('button').filter(button => button.dataset.emotion);
    assert.equal(choices.length, mode === 'error' ? 100 : 36); assert.ok(choices.every(button => button.disabled));
    assert.match(gallery.querySelector('.ipg-emotion-caption').textContent, /絵/); assert.equal(gallery.querySelector('canvas').hidden, true);
    assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
  }
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '386' } }), before = f.saved(), writes = f.writes.length;
  await f.click(f.focusButton('growth-album-toggle')); await f.growthMotions(); await f.click(await f.revealEmotion('cry', 'growth'));
  f.document.hidden = true; f.document.emit('visibilitychange'); await flush();
  assert.equal(f.timers.size, 0); assert.equal(f.raf.size, 0); assert.equal(f.activeMotions().length, 0);
  f.document.hidden = false; f.document.emit('visibilitychange'); await flush();
  assert.equal(f.host.querySelector('.ipg-growth-gallery'), null); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('crossing 400 EXP adopts the new visible growth only after a confirmed save and never cuts off the meal', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '397' } });
  f.advance(10000); f.ui.render(); const before = f.saved(), gate = deferred();
  f.control.pending = gate; f.control.outcome = 'false'; await f.click(f.focusButton('care-rest'));
  assert.equal(f.host.querySelector('.ipg-stage').textContent, '育った姿 · 397 EXP');
  assert.equal(f.mounts.at(-1).options.growthStage, 'final'); assert.deepEqual(f.saved(), before);
  gate.resolve(); await flush(); f.control.pending = null;
  assert.equal(f.host.querySelector('.ipg-stage').textContent, '育った姿 · 397 EXP'); assert.deepEqual(f.saved(), before);
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

test('all eleven appearances reach the renderer separately from canonical growth and only hatched stages attach visible food to a mouth', async () => {
  assert.equal(typeof Motion.feedingAnchor, 'function');
  for (const entry of Core.lilacAppearanceStages) {
    const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: String(entry.min) } });
    await f.click(await f.revealEmotion('feeding'));
    const canonical = Core.getLilacGrowth(entry.min).key, food = f.host.querySelector('.ipg-feeding-food'), anchor = Motion.feedingAnchor(canonical, 'balanced', entry.key);
    assert.equal(f.mounts.at(-1).options.growthStage, canonical); assert.equal(f.mounts.at(-1).options.appearanceKey, entry.key); assert.equal(food.hidden, entry.min < 15);
    if (anchor) { assert.equal(food.style.left, String(anchor.foodLeft * 100) + '%'); assert.equal(food.style.top, String(anchor.foodTop * 100) + '%'); }
    assert.equal(f.saved().pet.exp, entry.min, 'manual samples cannot skip any growth stage');
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
  for (const tab of ['market', 'shop', 'care']) {
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
  const food = f.host.querySelector('.ipg-emotion-stage').querySelector('.ipg-feeding-food'), anchor = Motion.feedingAnchor('adult', 'fruit', 'adult');
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


test('normal care room has no motion inspector, settings preview or future appearance selectors', async () => {
  const f = await fixture({ developerPreview: false, rendererMode: 'ready' });
  assert.ok(f.host.querySelector('.ipg-care-room'));
  assert.ok(f.host.querySelector('.ipg-room-window'));
  assert.equal(f.host.querySelector('.ipg-emotion-panel'), null);
  assert.equal(f.host.querySelector('.ipg-body-motion'), null);
  assert.equal(f.host.querySelector('.ipg-growth-gallery'), null);
  assert.equal(f.host.querySelector('[data-focus-key="lilac-preview"]'), null);
  assert.equal(f.host.querySelector('[data-focus-key="growth-stage-companion"]'), null);
  assert.equal(f.host.querySelector('.ipg-growth-album'), null);
  assert.equal(f.host.querySelector('.ipg-growth-record'), null);
  assert.equal(f.host.querySelector('.ipg-growth-milestones'), null);
  assert.ok(!f.host.textContent.includes('成長のあゆみ'));
  assert.ok(!f.host.textContent.includes('100種類'));
  assert.ok(!f.host.textContent.includes('好きに選べます'));
  const before = f.saved(), writes = f.writes.length;
  for (const tab of ['shop', 'village', 'market', 'care']) {
    await f.click(f.focusButton('tab-' + tab));
    assert.equal(f.host.querySelector('.ipg-emotion-panel'), null);
    assert.equal(f.host.querySelector('.ipg-growth-gallery'), null);
    assert.equal(f.host.querySelector('.ipg-growth-album'), null);
    assert.equal(f.host.querySelector('.ipg-growth-milestones'), null);
    assert.ok(!f.host.textContent.includes('成長のあゆみ'));
  }
  f.ui.render();
  assert.equal(f.host.querySelector('.ipg-growth-album'), null);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('normal players have no growth roadmap at any appearance stage and viewing does not change their progress', async () => {
  for (const stage of Core.lilacAppearanceStages) {
    const f = await fixture({ developerPreview: false, rendererMode: 'ready', seed: { pg_exp: String(stage.min) } });
    const before = f.saved(), writes = f.writes.length;
    assert.equal(f.host.querySelector('.ipg-growth-album'), null, stage.key);
    assert.equal(f.host.querySelector('.ipg-growth-milestones'), null, stage.key);
    assert.ok(!f.host.textContent.includes('成長のあゆみ'), stage.key);
    assert.ok(f.host.querySelector('.ipg-progress'), 'current growth progress remains visible');
    f.ui.render();
    assert.equal(f.host.querySelector('.ipg-growth-gallery'), null, stage.key);
    assert.deepEqual(f.saved(), before, stage.key);
    assert.equal(f.writes.length, writes, stage.key);
    await f.ui.close();
  }
});

test('newborn and baby show autonomous body emotion without changing saved growth, wallet or care counts', async () => {
  for (const exp of [15, 30]) {
    const f = await fixture({ developerPreview: false, rendererMode: 'ready', seed: { pg_exp: String(exp) } });
    const before = f.saved(), writes = f.writes.length;
    f.advance(3000); await f.fireTimers(); f.advance(9000); await f.fireTimers();
    assert.ok(f.activeMotions()[0].changes.some(cue => cue.name !== 'idle'));
    assert.notEqual(f.host.querySelector('.ipg-care-room').dataset.activity, 'idle');
    assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
    f.ui.close(); assert.equal(f.timers.size, 0);
  }
});

test('normal room care waits for successful persistence and protects the complete feeding reaction from autonomy', async () => {
  const f = await fixture({ developerPreview: false, rendererMode: 'ready', seed: { pg_exp: '15' } });
  const gate = deferred(), before = f.saved(); f.control.pending = gate;
  await f.click(f.focusButton('care-feed'));
  assert.deepEqual(f.saved(), before); assert.equal(f.host.querySelector('.ipg-feeding-food').hidden, true);
  f.advance(16000); await f.fireTimers();
  assert.equal(f.activeMotions()[0].changes.some(cue => cue.name === 'feeding'), false);
  gate.resolve(); f.control.pending = null; await flush();
  assert.equal(f.saved().pet.exp, before.pet.exp + 8);
  assert.equal(f.activeMotions()[0].options.situation, 'feeding');
  const room = f.host.querySelector('.ipg-care-room'); assert.equal(room.dataset.activity, 'feeding');
  f.advance(2000); await f.fireTimers(); assert.equal(room.dataset.activity, 'feeding');
  assert.equal(f.host.querySelector('.ipg-feeding-food').hidden, false);
  const snapshot = f.saved(), writes = f.writes.length;
  f.advance(3000); await f.fireTimers(); assert.equal(room.dataset.activity, 'feeding');
  assert.equal(f.host.querySelector('.ipg-lilac-visual').dataset.feedingPhase, 'joy');
  assert.equal(f.host.querySelector('.ipg-room-bubble').textContent, 'おいしい！');
  f.advance(4000); await f.fireTimers(); assert.equal(room.dataset.activity, 'idle');
  assert.deepEqual(f.saved(), snapshot); assert.equal(f.writes.length, writes);
});

test('room save rejection, reduced motion, unavailable behavior and renderer failure stay safe', async () => {
  const failed = await fixture({ developerPreview: false, rendererMode: 'ready' }), before = failed.saved();
  failed.control.outcome = 'false'; await failed.click(failed.focusButton('care-feed'));
  assert.deepEqual(failed.saved(), before); assert.notEqual(failed.activeMotions()[0].options.situation, 'feeding');
  for (const config of [{ reducedMotion: true }, { roomUnavailable: true }, { rendererMode: 'error' }]) {
    const f = await fixture({ developerPreview: false, rendererMode: 'ready', ...config }), saved = f.saved(), writes = f.writes.length;
    f.advance(3000); await f.fireTimers(); f.advance(60000); await f.fireTimers();
    assert.equal(f.activeMotions().some(m => m.changes.some(c => c.name !== 'idle')), false);
    assert.deepEqual(f.saved(), saved); assert.equal(f.writes.length, writes);
    f.ui.close(); assert.equal(f.timers.size, 0);
  }
});

test('room autonomy cleans up on tab switch, visibility and re-render without stale callbacks', async () => {
  const f = await fixture({ developerPreview: false, rendererMode: 'ready' });
  f.advance(3000); await f.fireTimers(); f.advance(9000); await f.fireTimers();
  const old = f.activeMotions()[0], before = f.saved(), writes = f.writes.length;
  await f.click(f.focusButton('tab-shop')); assert.equal(old.destroyed, true);
  f.advance(20000); await f.fireTimers(); assert.equal(f.timers.size, 0);
  await f.click(f.focusButton('tab-care'));
  f.document.hidden = true; f.document.emit('visibilitychange');
  assert.equal(f.timers.size, 0); assert.equal(f.activeMotions().length, 0);
  f.document.hidden = false; f.document.emit('visibilitychange'); await flush();
  assert.equal(f.activeMotions().length, 1);
  f.ui.render(); assert.equal(f.activeMotions().length, 1);
  f.ui.close(); assert.equal(f.timers.size, 0);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});


test('room walking uses renderer frames for position and heading, and returns to center before a saved care reaction', async () => {
  for (const exp of [15, 386]) {
    const f = await fixture({ developerPreview: false, rendererMode: 'ready', seed: { pg_exp: String(exp) } });
    const before = f.saved(), writes = f.writes.length;
    // Finish greeting, then follow finite room actions until the first walk.
    f.advance(3000); await f.fireTimers();
    for (let i = 0; i < 30 && !f.activeMotions()[0].changes.some(c => /^room_walk_/.test(c.name)); i++) { f.advance(10000); await f.fireTimers(); }
    const motion = f.activeMotions()[0], cue = motion.changes.filter(c => /^room_walk_/.test(c.name)).at(-1);
    assert.ok(cue, 'a private room walk is reached naturally');
    const visual = f.host.querySelector('.ipg-room-pet');
    const frame = Motion.roomWalkFrame(cue.name, 1800, false);
    motion.options.onPose({ situation: cue.name, roomX: frame.x, yawDeg: frame.yawDeg, phase: frame.phase });
    assert.equal(visual.dataset.facing, frame.x > 0 ? 'right' : 'left');
    assert.ok(!visual.style.transform.includes('+ 0.000px'));
    assert.equal(visual.style.transition, 'none');
    assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
    await f.click(f.focusButton('care-play'));
    const next = f.host.querySelector('.ipg-room-pet');
    assert.equal(f.activeMotions()[0].options.situation, 'petted');
    assert.equal(next.dataset.facing, 'front');
    assert.equal(next.style.transform, 'translateX(calc(-50% + 0.000px))');
    assert.equal(next.style.transition, 'transform 400ms ease-out');
    const after = f.saved(); assert.equal(after.pet.exp, before.pet.exp + 5);
    const stable = next.style.transform;
    motion.options.onPose({ situation: cue.name, roomX: 1, yawDeg: 90, phase: 'outbound' });
    assert.equal(next.style.transform, stable); assert.deepEqual(f.saved(), after);
    f.ui.close(); assert.equal(f.timers.size, 0);
  }
});

test('room directions keep side and back headings isolated from food and hidden motion controls', async () => {
  const f = await fixture({ developerPreview: false, rendererMode: 'ready' });
  f.advance(3000); await f.fireTimers(); f.advance(9000); await f.fireTimers();
  const m = f.activeMotions()[0], v = f.host.querySelector('.ipg-room-pet');
  assert.equal(m.changes.at(-1).name, 'direction_left');
  m.options.onPose({ situation: 'direction_left', yawDeg: -90 });
  assert.equal(v.dataset.facing, 'left'); assert.equal(v.querySelector('.ipg-feeding-food').hidden, true);
  assert.equal(f.host.querySelector('.ipg-emotion-panel'), null);
  f.advance(6500); await f.fireTimers();
  assert.equal(v.dataset.facing, 'front');
  assert.equal(v.style.transform, 'translateX(calc(-50% + 0.000px))');
  f.ui.close();
});

async function touchRoom(config = {}) {
  const f = await fixture({ developerPreview: false, rendererMode: 'ready', ...config });
  f.advance(3000); await f.fireTimers(); // Let the initial saved greeting finish.
  return f;
}
function roomPointer(canvas, type, detail = {}) {
  canvas.emit(type, { pointerId: 7, isPrimary: true, button: 0, clientX: 150, clientY: 150, ...detail });
}
async function roomTap(f, detail = {}, canvas = f.host.querySelector('.ipg-lilac-canvas')) {
  roomPointer(canvas, 'pointerdown', detail); roomPointer(canvas, 'pointerup', detail); await flush();
}
async function finishTouch(f, cue) {
  f.advance(Motion.durations[cue]); await f.fireTimers();
  assert.equal(f.host.querySelector('.ipg-room-pet').dataset.situation, 'idle');
}

test('room taps use live canvas-relative coordinates and the renderer part contract without saving or exposing inspectors', async () => {
  for (const [part, side, cue, message] of [
    ['head', null, 'petted', 'なでなで、うれしいな。'],
    ['cheek', 'right', 'laugh', 'くすぐったいよ、えへへ！'],
    ['hand', 'left', 'body_flap', 'おてて、ぎゅっ。うれしくて、ぱたぱた！']
  ]) {
    const f = await touchRoom(), canvas = f.host.querySelector('.ipg-lilac-canvas'), motion = f.activeMotions()[0];
    const saved = f.saved(), writes = f.writes.length, mapped = f.actionCues.length, scrolled = f.scrolls().length;
    canvas.getBoundingClientRect = () => ({ left: 87, top: 143, width: 240, height: 160 });
    f.rendererControl.hit = { part, side };
    await roomTap(f, { clientX: 147, clientY: 263 });
    assert.equal(f.hitTests.length, 1); assert.strictEqual(f.hitTests[0].controller, motion);
    assert.equal(f.hitTests[0].x, .25); assert.equal(f.hitTests[0].y, .75);
    assert.deepEqual(motion.changes.at(-1), { name: cue, durationMs: Motion.durations[cue] });
    const visual = f.host.querySelector('.ipg-room-pet'), room = f.host.querySelector('.ipg-care-room');
    assert.equal(visual.dataset.touchPart, part); assert.equal(visual.dataset.touchSide, side || '');
    assert.equal(room.dataset.activity, 'affection'); assert.equal(f.host.querySelector('.ipg-room-bubble').textContent, message);
    assert.equal(f.host.querySelector('.ipg-room-status').textContent, message);
    assert.ok(canvas.getAttribute('aria-label').includes(message));
    assert.equal(f.host.querySelector('.ipg-emotion-panel'), null); assert.equal(f.host.querySelector('.ipg-body-motion'), null);
    assert.equal(f.host.querySelector('.ipg-feeding-food').hidden, true);
    assert.ok(f.timers.size <= 2, 'one UI phase deadline and one room hold own the finite response'); assert.equal(f.raf.size, 0);
    assert.deepEqual(f.saved(), saved); assert.equal(f.writes.length, writes); assert.equal(f.actionCues.length, mapped); assert.equal(f.scrolls().length, scrolled);
    await finishTouch(f, cue); assert.equal(visual.dataset.touchPart, ''); assert.equal(visual.dataset.touchSide, '');
    f.ui.close(); assert.equal(f.timers.size, 0);
  }
});

test('room gestures reject drags, canceled or mismatched pointers, long presses, secondary buttons and empty or invalid hits', async () => {
  const cases = [
    ['drag returns to start', (f, c) => { roomPointer(c, 'pointerdown'); roomPointer(c, 'pointermove', { clientX: 180 }); roomPointer(c, 'pointerup'); }],
    ['large pointerup displacement', (f, c) => { roomPointer(c, 'pointerdown'); roomPointer(c, 'pointerup', { clientY: 180 }); }],
    ['cancel', (f, c) => { roomPointer(c, 'pointerdown'); roomPointer(c, 'pointercancel'); roomPointer(c, 'pointerup'); }],
    ['leave', (f, c) => { roomPointer(c, 'pointerdown'); roomPointer(c, 'pointerleave'); roomPointer(c, 'pointerup'); }],
    ['mismatched pointer', (f, c) => { roomPointer(c, 'pointerdown'); roomPointer(c, 'pointerup', { pointerId: 9 }); roomPointer(c, 'pointerup'); }],
    ['long press', (f, c) => { roomPointer(c, 'pointerdown'); f.advance(651); roomPointer(c, 'pointerup'); }],
    ['nonprimary', (f, c) => { roomPointer(c, 'pointerdown', { isPrimary: false }); roomPointer(c, 'pointerup', { isPrimary: false }); }],
    ['right button', (f, c) => { roomPointer(c, 'pointerdown', { button: 2 }); roomPointer(c, 'pointerup', { button: 2 }); }],
    ['no pointerdown', (f, c) => { roomPointer(c, 'pointerup'); }],
    ['outside canvas', (f, c) => { roomPointer(c, 'pointerdown', { clientX: -5 }); roomPointer(c, 'pointerup', { clientX: -5 }); }],
    ['nonfinite position', (f, c) => { roomPointer(c, 'pointerdown', { clientX: NaN }); roomPointer(c, 'pointerup', { clientX: NaN }); }],
    ['zero canvas size', (f, c) => { c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 }); roomPointer(c, 'pointerdown'); roomPointer(c, 'pointerup'); }],
    ['renderer misses transparent space', (f, c) => { f.rendererControl.hit = null; roomPointer(c, 'pointerdown'); roomPointer(c, 'pointerup'); }],
    ['unsupported part', (f, c) => { f.rendererControl.hit = { part: 'tail', side: 'left' }; roomPointer(c, 'pointerdown'); roomPointer(c, 'pointerup'); }],
    ['hit-test throws', (f, c) => { f.rendererControl.hitThrows = true; roomPointer(c, 'pointerdown'); roomPointer(c, 'pointerup'); }],
    ['hit-test API unavailable', (f, c) => { delete f.activeMotions()[0].hitTest; roomPointer(c, 'pointerdown'); roomPointer(c, 'pointerup'); }]
  ];
  for (const [label, gesture] of cases) {
    const f = await touchRoom(), c = f.host.querySelector('.ipg-lilac-canvas'), motion = f.activeMotions()[0];
    f.rendererControl.hit = { part: 'head', side: null };
    const saved = f.saved(), writes = f.writes.length, count = motion.changes.length;
    gesture(f, c); await flush();
    assert.equal(motion.changes.length, count, label); assert.equal(f.host.querySelector('.ipg-room-pet').dataset.situation, 'idle', label);
    assert.deepEqual(f.saved(), saved, label); assert.equal(f.writes.length, writes, label);
    f.ui.close(); assert.equal(f.timers.size, 0, label);
  }
});

test('three native touch buttons give keyboard-equivalent actions and cycle variants only after each finite reaction', async () => {
  const f = await touchRoom(), saved = f.saved(), writes = f.writes.length, motion = f.activeMotions()[0];
  const group = f.host.querySelector('.ipg-touch-actions'), status = f.host.querySelector('.ipg-room-status');
  assert.equal(group.getAttribute('role'), 'group'); assert.equal(group.getAttribute('aria-label'), 'ふれあう');
  assert.equal(status.getAttribute('role'), 'status'); assert.equal(status.getAttribute('aria-live'), 'polite');
  for (const [part, label, variants] of [['head', '頭をなでる', ['petted', 'love', 'petted']], ['cheek', 'ほっぺをつつく', ['laugh', 'shy', 'laugh']], ['hand', '手をにぎる', ['body_flap', 'cheer', 'body_flap']]]) {
    const choice = f.focusButton('touch-' + part);
    assert.equal(choice.tagName, 'BUTTON'); assert.equal(choice.type, 'button'); assert.equal(choice.textContent, label);
    choice.focus(); assert.strictEqual(f.document.activeElement, choice);
    for (const cue of variants) {
      assert.equal(choice.disabled, false); await f.click(choice);
      assert.equal(motion.changes.at(-1).name, cue); assert.equal(f.host.querySelector('.ipg-room-pet').dataset.touchPart, part);
      assert.ok(group.querySelectorAll('button').every(button => button.disabled));
      const count = motion.changes.length; group.querySelectorAll('button').forEach(button => button.emit('click'));
      f.rendererControl.hit = { part: 'head' }; await roomTap(f); f.host.querySelector('.ipg-lilac-canvas').emit('click');
      assert.equal(motion.changes.length, count, 'neither repeated touch nor a synthetic click restarts the active cue');
      f.advance(Motion.durations[cue] - 1); await f.fireTimers(); assert.equal(choice.disabled, true); assert.equal(f.host.querySelector('.ipg-room-pet').dataset.situation, cue);
      f.advance(1); await f.fireTimers(); assert.equal(f.host.querySelector('.ipg-room-pet').dataset.situation, 'idle'); assert.equal(choice.disabled, false);
    }
  }
  assert.equal(f.hitTests.length, 0, 'native activation does not invent pointer coordinates');
  assert.deepEqual(f.saved(), saved); assert.equal(f.writes.length, writes);
  f.ui.close(); assert.equal(f.timers.size, 0);
});

test('saved care and pending persistence take priority over touch without manufacturing rewards or interrupting a meal', async () => {
  const f = await touchRoom(), saved = f.saved(), writes = f.writes.length;
  await f.click(f.focusButton('touch-cheek')); const beforeCare = f.activeMotions()[0], oldCanvas = beforeCare.canvas;
  const gate = deferred(); f.control.pending = gate;
  await f.click(f.focusButton('care-feed')); assert.equal(f.host.getAttribute('aria-busy'), 'true');
  const count = beforeCare.changes.length, hitCount = f.hitTests.length;
  f.rendererControl.hit = { part: 'hand', side: 'right' }; await roomTap(f, {}, oldCanvas); f.focusButton('touch-head').emit('click'); await flush();
  assert.equal(beforeCare.changes.length, count); assert.equal(f.hitTests.length, hitCount); assert.deepEqual(f.saved(), saved); assert.equal(f.writes.length, writes);
  gate.resolve(); f.control.pending = null; await flush();
  const afterCare = f.saved(), meal = f.activeMotions()[0];
  assert.equal(afterCare.pet.exp, saved.pet.exp + 8); assert.equal(meal.options.situation, 'feeding'); assert.equal(beforeCare.destroyed, true);
  const mealChanges = meal.changes.length, mealWrites = f.writes.length; let previousElapsed = 0;
  for (const elapsed of [0, 1200, 4400, 7200]) {
    f.advance(elapsed - previousElapsed); await f.fireTimers(); previousElapsed = elapsed;
    await roomTap(f); f.focusButton('touch-hand').emit('click'); await flush();
    assert.equal(meal.changes.length, mealChanges); assert.equal(f.host.querySelector('.ipg-room-pet').dataset.situation, 'feeding');
    assert.deepEqual(f.saved(), afterCare); assert.equal(f.writes.length, mealWrites);
  }
  f.advance(Motion.durations.feeding - 7200); await f.fireTimers(); assert.equal(f.focusButton('touch-head').disabled, false);
  await f.click(f.focusButton('touch-head')); assert.equal(meal.changes.at(-1).name, 'petted'); assert.deepEqual(f.saved(), afterCare); assert.equal(f.writes.length, mealWrites);
  f.ui.close(); assert.equal(f.timers.size, 0);
});

test('touch interrupts an autonomous room walk, returns to idle and never resurrects its old pose or deadline', async () => {
  const f = await touchRoom(), motion = f.activeMotions()[0], saved = f.saved(), writes = f.writes.length;
  for (let i = 0; i < 30 && !motion.changes.some(cue => /^room_walk_/.test(cue.name)); i++) { f.advance(10000); await f.fireTimers(); }
  const walk = motion.changes.filter(cue => /^room_walk_/.test(cue.name)).at(-1); assert.ok(walk);
  const oldReturn = [...f.timers.values()].sort((a, b) => b.at - a.at)[0].fn;
  motion.options.onPose({ situation: walk.name, roomX: .7, yawDeg: 90, phase: 'outbound' });
  const visual = f.host.querySelector('.ipg-room-pet'); assert.ok(!visual.style.transform.includes('+ 0.000px'));
  await f.click(f.focusButton('touch-head')); assert.equal(motion.changes.at(-1).name, 'petted');
  assert.equal(visual.dataset.facing, 'front'); assert.equal(visual.dataset.roomWalkPhase, ''); assert.equal(visual.style.transform, 'translateX(calc(-50% + 0.000px))');
  oldReturn(); motion.options.onPose({ situation: walk.name, roomX: 1, yawDeg: 90, phase: 'outbound' });
  assert.equal(visual.dataset.situation, 'petted'); assert.equal(visual.style.transform, 'translateX(calc(-50% + 0.000px))');
  await finishTouch(f, 'petted'); assert.equal(motion.changes.at(-1).name, 'idle');
  f.advance(8499); await f.fireTimers(); assert.equal(visual.dataset.situation, 'idle');
  f.advance(1); await f.fireTimers(); assert.equal(motion.changes.at(-1).name, 'direction_left');
  assert.deepEqual(f.saved(), saved); assert.equal(f.writes.length, writes);
  f.ui.close(); assert.equal(f.timers.size, 0);
});

test('touch listeners and pending gestures stop on tab changes, hiding, disconnection, fallback and close', async () => {
  for (const mode of ['tab', 'hidden', 'disconnected', 'fallback', 'close']) for (const active of [false, true]) {
    const f = await touchRoom(), motion = f.activeMotions()[0], canvas = motion.canvas, oldButton = f.focusButton('touch-head');
    const saved = f.saved(), writes = f.writes.length;
    if (active) { await f.click(oldButton); assert.equal(motion.changes.at(-1).name, 'petted'); }
    const before = motion.changes.length;
    f.rendererControl.hit = { part: 'head' }; roomPointer(canvas, 'pointerdown');
    if (mode === 'tab') await f.click(f.focusButton('tab-shop'));
    else if (mode === 'hidden') { f.document.hidden = true; f.document.emit('visibilitychange'); await flush(); }
    else if (mode === 'disconnected') canvas.remove();
    else if (mode === 'fallback') motion.options.onError('context_lost');
    else f.ui.close();
    roomPointer(canvas, 'pointerup'); oldButton.emit('click'); await flush();
    assert.equal(motion.changes.length, before, mode); assert.equal(f.hitTests.length, 0, mode);
    if (mode !== 'disconnected') assert.equal(f.timers.size, 0, mode + ': active touch and room deadlines are canceled');
    if (mode !== 'disconnected') for (const event of ['pointerdown','pointermove','pointercancel','pointerleave','pointerup']) assert.equal(canvas.listenerCount(event), 0, mode+event);
    if (mode === 'fallback') { assert.equal(f.host.querySelector('.ipg-touch-actions').hidden, true); assert.equal(f.host.querySelector('.ipg-lilac-still').hidden, false); }
    assert.deepEqual(f.saved(), saved, mode); assert.equal(f.writes.length, writes, mode);
    f.ui.close(); assert.equal(f.timers.size, 0, mode); assert.equal(f.raf.size, 0, mode);
  }
});

test('only born ready B exposes touch actions; delayed or unavailable drawing and every egg keep them inactive', async () => {
  for (const exp of [0, 5, 10]) {
    const f = await touchRoom({ seed: { pg_exp: String(exp) } });
    assert.equal(f.host.querySelector('.ipg-touch-actions'), null); assert.equal(f.host.querySelector('.ipg-touch-hint'), null);
    f.rendererControl.hit = { part: 'head' }; await roomTap(f); assert.equal(f.hitTests.length, 0); f.ui.close();
  }
  for (const exp of [15, 400]) {
    const f = await touchRoom({ seed: { pg_exp: String(exp) } }); const saved = f.saved(), writes = f.writes.length;
    assert.equal(f.host.querySelector('.ipg-touch-actions').hidden, false); assert.equal(f.focusButton('touch-head').disabled, false);
    await f.click(f.focusButton('touch-head')); assert.equal(f.activeMotions()[0].changes.at(-1).name, 'petted');
    assert.deepEqual(f.saved(), saved); assert.equal(f.writes.length, writes); f.ui.close();
  }
  for (const config of [{ rendererMode: 'pending' }, { rendererMode: 'error' }, { rendererUnavailable: true }]) {
    const f = await touchRoom(config), saved = f.saved(), writes = f.writes.length;
    assert.equal(f.host.querySelector('.ipg-touch-actions').hidden, true);
    f.rendererControl.hit = { part: 'head' }; await roomTap(f); f.focusButton('touch-head').emit('click'); await flush();
    assert.equal(f.hitTests.length, 0); assert.deepEqual(f.saved(), saved); assert.equal(f.writes.length, writes); f.ui.close(); assert.equal(f.timers.size, 0);
  }
});

test('reduced-motion touch keeps readable finite responses without autonomous movement or saved changes', async () => {
  const f = await touchRoom({ reducedMotion: true }), saved = f.saved(), writes = f.writes.length;
  f.rendererControl.hit = { part: 'cheek', side: 'left' }; await roomTap(f);
  assert.equal(f.host.querySelector('.ipg-room-bubble').textContent, 'くすぐったいよ、えへへ！');
  assert.equal(f.host.querySelector('.ipg-room-status').getAttribute('aria-live'), 'polite');
  assert.equal(f.activeMotions()[0].changes.at(-1).name, 'laugh'); assert.equal(f.raf.size, 0); assert.ok(f.timers.size <= 1);
  await finishTouch(f, 'laugh'); assert.equal(f.focusButton('touch-hand').disabled, false);
  assert.deepEqual(f.saved(), saved); assert.equal(f.writes.length, writes);
  f.ui.close(); assert.equal(f.timers.size, 0); assert.equal(f.raf.size, 0);
});

async function chooseFirstEgg(f, key) {
  await f.click(f.focusButton('egg-choice-' + key));
  await f.click(f.focusButton('egg-review'));
  await f.click(f.focusButton('egg-confirm'));
}

test('new visitors choose and review one of three eggs without drawing or changing progress until the confirmed save', async () => {
  for (const row of Core.eggCatalogue) {
    const f = await fixture({ fresh: true, developerPreview: false, rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
    assert.equal(Core.needsEggChoice(before), true); assert.equal(before.pet.exp, 0); assert.equal(before.coins, 100);
    assert.equal(f.host.querySelectorAll('.ipg-egg-choice').length, 3);
    assert.equal(f.host.querySelector('.ipg-tabs'), null); assert.equal(f.host.querySelector('.ipg-care-room'), null);
    assert.equal(f.host.querySelector('.ipg-backup'), null); assert.equal(f.mounts.length, 0); assert.equal(f.timers.size, 0);
    assert.equal(f.data.get(Core.KEY),f.beforeMountRaw);assert.equal(f.writes.length,f.writesBeforeMount);
    assert.equal(f.focusButton('egg-review').disabled, true);
    await f.click(f.focusButton('egg-choice-' + row.key));
    assert.equal(f.focusButton('egg-choice-' + row.key).getAttribute('aria-pressed'), 'true');
    assert.equal(f.focusButton('egg-review').disabled, false); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
    await f.click(f.focusButton('egg-review'));
    assert.ok(f.host.querySelector('.ipg-egg-review').textContent.includes(row.eggLabel));
    assert.equal(f.document.activeElement, f.focusButton('egg-confirm'));
    await f.click(f.focusButton('egg-back')); assert.equal(f.focusButton('egg-choice-' + row.key).getAttribute('aria-pressed'), 'true');
    await f.click(f.focusButton('egg-review'));
    const pending = deferred(); f.control.pending = pending;
    await f.click(f.focusButton('egg-confirm'));
    assert.equal(f.focusButton('egg-confirm').disabled, true); assert.equal(f.host.getAttribute('aria-busy'), 'true');
    assert.deepEqual(f.saved(), before); assert.equal(f.mounts.length, 0);
    f.focusButton('egg-confirm').emit('click'); await flush();
    pending.resolve(); await flush(); f.control.pending = null;
    const after = f.saved(); assert.equal(after.pet.eggOrigin, row.key); assert.equal(after.pet.exp, 0); assert.equal(after.coins, 100);
    assert.deepEqual(after.care, before.care); assert.equal(f.writes.length, writes + 1);
    assert.equal(f.host.querySelector('.ipg-egg-welcome'), null); assert.ok(f.host.querySelector('.ipg-care-room'));
    assert.equal(f.mounts.at(-1).options.eggOrigin, row.key); assert.equal(f.mounts.at(-1).options.appearanceKey, 'egg');
    assert.ok(f.focusButton('care-feed').getAttribute('aria-label').includes('あたためる'));
    assert.ok(f.host.querySelector('.ipg-egg-origin').textContent.includes(row.eggLabel));
    assert.equal(f.buttons().some(button => button.textContent === 'うさぎ'), false, 'the confirmed origin cannot be changed by a species selector');
    const reloaded = await fixture({ fresh: true, developerPreview: false, rendererMode: 'ready', seed: { [Core.KEY]: JSON.stringify(after) } });
    assert.equal(reloaded.host.querySelector('.ipg-egg-welcome'), null); assert.equal(reloaded.mounts.at(-1).options.eggOrigin, row.key);
    assert.deepEqual(reloaded.saved(), after); f.ui.close(); reloaded.ui.close();
  }
});

test('a rejected egg confirmation keeps its draft and every existing field and can retry the same choice', async () => {
  for (const outcome of ['false', 'throw']) {
    const f = await fixture({ fresh: true, developerPreview: false, rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
    await f.click(f.focusButton('egg-choice-mint')); await f.click(f.focusButton('egg-review'));
    f.control.outcome = outcome; await f.click(f.focusButton('egg-confirm'));
    assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(f.mounts.length, 0);
    assert.ok(f.host.querySelector('.ipg-egg-review').textContent.includes('しずくのたまご'));
    assert.ok(f.host.querySelector('.ipg-error')); assert.equal(f.focusButton('egg-confirm').disabled, false);
    f.control.outcome = 'ok'; await f.click(f.focusButton('egg-confirm'));
    assert.equal(f.saved().pet.eggOrigin, 'mint'); assert.equal(f.saved().pet.exp, 0); assert.equal(f.saved().coins, 100);
    f.ui.close();
  }
});

test('old zero-EXP and grown saves bypass new selection while the explicit local developer preview remains read only', async () => {
  for (const exp of [0, 678]) {
    const f = await fixture({ developerPreview: false, rendererMode: 'ready', seed: { pg_exp: String(exp) } }), before = f.saved(), writes = f.writes.length;
    assert.equal(f.host.querySelector('.ipg-egg-welcome'), null); assert.ok(f.host.querySelector('.ipg-care-room'));
    assert.equal(Object.hasOwn(before.pet, 'eggOrigin'), false); assert.equal(f.mounts.at(-1).options.eggOrigin, 'lilac');
    f.ui.render(); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); f.ui.close();
  }
  const f = await fixture({ fresh: true, developerPreview: true, rendererMode: 'ready' }), before = f.saved(), writes = f.writes.length;
  assert.equal(f.host.querySelector('.ipg-egg-welcome'), null); assert.ok(f.host.querySelector('.ipg-emotion-panel'));
  await f.click(f.focusButton('pet-emotion-joy')); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); f.ui.close();
});

test('a previously restored old pet bypasses new selection without backup controls or mount-time storage writes', async () => {
  const old = await fixture({ developerPreview: false, seed: { pg_exp: '678' } }), preserved = old.saved(), backup = old.store.exportBackup(); old.ui.close();
  const f = await fixture({ fresh: true, developerPreview: false, rendererMode: 'ready',setup:async store=>{
    assert.equal((await store.importBackup(backup)).ok,true);
  } });
  assert.equal(f.host.querySelector('.ipg-egg-welcome'), null); assert.equal(f.store.getState().pet.exp, 678);
  assert.equal(f.host.querySelector('.ipg-backup'),null);assert.equal(f.data.get(Core.KEY),f.beforeMountRaw);assert.equal(f.writes.length,f.writesBeforeMount);
  assert.equal(f.store.getState().coins, preserved.coins); assert.equal(Object.hasOwn(f.saved().pet, 'eggOrigin'), false);
  assert.equal(f.mounts.at(-1).options.eggOrigin, 'lilac'); f.ui.close();
});

test('a chosen birth follows real saved hatching, food anchors and free fittings without reopening the selection', async () => {
  for (const key of ['mint', 'apricot']) {
    const f = await fixture({ fresh: true, developerPreview: false, rendererMode: 'ready' }); await chooseFirstEgg(f, key);
    await f.click(f.focusButton('care-feed')); assert.equal(f.saved().pet.exp, 8); assert.equal(f.mounts.at(-1).options.appearanceKey, 'egg_cracked');
    await f.click(f.focusButton('care-play')); assert.equal(f.saved().pet.exp, 13); assert.equal(f.mounts.at(-1).options.appearanceKey, 'hatching');
    await f.click(f.focusButton('care-rest')); assert.equal(f.saved().pet.exp, 17); assert.equal(f.mounts.at(-1).options.appearanceKey, 'newborn');
    await f.click(f.focusButton('care-feed')); assert.equal(f.mounts.at(-1).options.eggOrigin, key);
    assert.ok(f.anchorCalls.some(call => call.eggOrigin === key && call.appearanceKey === 'newborn'));
    const saved = f.saved(), writes = f.writes.length;
    await f.click(f.focusButton('tab-shop')); await f.click(f.focusButton('outfit-try-cloth_cream_vest'));
    assert.ok(f.activeMotions().every(request => request.options.eggOrigin === key));
    assert.deepEqual(f.saved(), saved); assert.equal(f.writes.length, writes); assert.equal(f.host.querySelector('.ipg-egg-welcome'), null); f.ui.close();
  }
});

test('an unavailable chosen mint or apricot appears as its egg placeholder instead of the other purple character and retries without saving', async () => {
  for (const key of ['mint', 'apricot']) {
    const f = await fixture({ fresh: true, developerPreview: false, rendererMode: 'error' }); await chooseFirstEgg(f, key);
    const before = f.saved(), writes = f.writes.length, placeholder = f.host.querySelector('.ipg-origin-placeholder');
    assert.ok(placeholder); assert.equal(placeholder.hidden, false); assert.equal(placeholder.querySelectorAll('img').length, 0);
    assert.ok(placeholder.textContent.includes(Core.eggProfile(key).eggLabel));
    assert.ok(placeholder.textContent.includes('卵の選択と育成の記録は保存されています'));
    assert.equal(f.host.querySelector('.ipg-lilac-canvas').hidden, true);
    assert.equal(f.focusButton('pet-appearance-retry').hidden, false);
    f.rendererControl.mode = 'ready'; await f.click(f.focusButton('pet-appearance-retry'));
    assert.equal(f.host.querySelector('.ipg-origin-placeholder').hidden, true); assert.equal(f.host.querySelector('.ipg-lilac-canvas').hidden, false);
    assert.equal(f.mounts.at(-1).options.eggOrigin, key); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); f.ui.close();
  }
});


test('each consumed food keeps its own temporary artwork through navigation and meal phases without entering saved data', async () => {
  for (const id of ['apple', 'cake', 'berry', 'rice', 'feast']) {
    const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '30', pg_items: JSON.stringify({ [id]: 2 }) } });
    f.advance(10000); f.ui.render(); await f.click(f.focusButton('tab-shop'));
    const entry = Core.items.find(row => row.id === id), before = f.saved();
    const row = f.host.querySelectorAll('.ipg-shop-item').find(row => row.dataset.itemId === id);
    await f.click(row.querySelectorAll('button').find(button => button.textContent === '使う'));
    const after = f.saved();
    assert.equal(after.inventory[id], before.inventory[id] - 1); assert.equal(after.pet.exp, before.pet.exp + entry.exp);
    assert.equal(JSON.stringify(after).includes('foodId'), false, 'artwork identity is never saved');
    assert.equal(f.host.querySelector('.ipg-feeding-food').dataset.foodId, id);
    await f.click(f.focusButton('tab-care'));
    const food = f.host.querySelector('.ipg-feeding-food'), image = food.querySelector('img');
    assert.equal(food.dataset.foodId, id); assert.equal(image.src, '/static/pet-items-v1/' + id + '.webp');
    assert.equal(food.hidden, false); image.emit('load'); assert.equal(food.dataset.artReady, 'true');
    f.advance(1200); await f.fireTimers();
    assert.equal(food.querySelector('img'), image, 'phase updates reuse the same loaded image');
    assert.equal(food.dataset.foodId, id);
    f.advance(Motion.durations.feeding); await f.fireTimers();
    assert.equal(food.hidden, true); assert.equal(food.dataset.foodId, ''); assert.equal(food.querySelector('img'), null);
    assert.deepEqual(f.saved(), after, 'artwork and phase changes add no writes or rewards');
  }
});

test('failed food consumption stays invisible and stale image callbacks cannot overwrite a replacement meal', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', seed: { pg_exp: '30', pg_items: '{"cake":2}' } });
  f.advance(10000); f.ui.render(); await f.click(f.focusButton('tab-shop'));
  function useCake() {
    const row = f.host.querySelectorAll('.ipg-shop-item').find(row => row.dataset.itemId === 'cake');
    return row.querySelectorAll('button').find(button => button.textContent === '使う');
  }
  const before = f.saved(), gate = deferred(); f.control.pending = gate; f.control.outcome = 'false';
  await f.click(useCake());
  assert.deepEqual(f.saved(), before); assert.equal(f.host.querySelector('.ipg-feeding-food').hidden, true);
  assert.equal(f.host.querySelector('.ipg-feeding-food').dataset.foodId, '');
  gate.resolve(); await flush(); f.control.pending = null;
  assert.deepEqual(f.saved(), before); assert.equal(f.host.querySelector('.ipg-feeding-food').dataset.foodId, '');
  f.control.outcome = 'ok'; await f.click(useCake()); await f.click(f.focusButton('tab-care'));
  const saved = f.saved(), food = f.host.querySelector('.ipg-feeding-food'), cakeImage = food.querySelector('img');
  assert.equal(food.dataset.foodId, 'cake');
  await f.click(await f.revealEmotion('feeding'));
  assert.equal(f.host.querySelector('.ipg-feeding-food'), food); assert.equal(food.dataset.foodId, 'apple');
  const appleImage = food.querySelector('img'); assert.notEqual(appleImage, cakeImage);
  appleImage.emit('load'); cakeImage.emit('error'); assert.equal(food.dataset.artReady, 'true');
  appleImage.emit('error'); cakeImage.emit('load'); assert.equal(food.dataset.artReady, 'false');
  await f.click(await f.revealEmotion('love'));
  assert.equal(food.hidden, true); assert.equal(food.dataset.foodId, ''); assert.equal(food.querySelector('img'), null);
  cakeImage.emit('load'); appleImage.emit('load'); assert.equal(food.dataset.artReady, 'false');
  assert.deepEqual(f.saved(), saved);
});

const illustratedItemIds = ['apple', 'cake', 'berry', 'rice', 'feast', 'house', 'tree', 'flower', 'fountain', 'sunflower', 'mushroom', 'lantern'];
const illustratedClothingIds = ['cloth_cream_vest', 'cloth_rose_cape', 'cloth_sky_overalls', 'cloth_mint_knit', 'cloth_star_pajamas', 'cloth_flower_dress'];
function illustrationPath(id) { return '/static/' + (illustratedClothingIds.includes(id) ? 'pet-clothes-v1/' : 'pet-items-v1/') + id + '.webp'; }

test('all eighteen illustrated products keep neutral loading and error states without emoji or inventory writes', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready' });
  await f.click(f.focusButton('tab-shop'));
  const before = f.saved(), writes = f.writes.length;
  const rows = f.host.querySelectorAll('.ipg-shop-item').filter(row => row.querySelector('.ipg-item-art'))
    .concat(f.host.querySelectorAll('.ipg-clothing-item'));
  assert.equal(rows.length, 18);
  assert.deepEqual(rows.map(row => row.dataset.itemId || row.dataset.clothing).sort(), illustratedItemIds.concat(illustratedClothingIds).sort());
  for (const row of rows) {
    const id = row.dataset.itemId || row.dataset.clothing, entry = Core.items.find(item => item.id === id);
    const art = row.querySelector('.ipg-item-art'), placeholder = art.querySelector('.ipg-item-art-placeholder'), image = art.querySelector('img');
    assert.equal(art.dataset.itemArt, id); assert.equal(art.getAttribute('aria-hidden'), 'true');
    assert.equal(image.alt, ''); assert.equal(image.getAttribute('aria-hidden'), 'true'); assert.equal(image.width, 384); assert.equal(image.height, 384);
    assert.equal(image.src, illustrationPath(id)); assert.equal(image.hidden, true); assert.equal(placeholder.hidden, false);
    assert.equal(art.dataset.artState, 'loading'); assert.equal(art.textContent, '', 'Loading cannot substitute platform emoji');
    assert.equal(row.querySelector('h4').textContent, entry.name); assert.ok(row.textContent.includes(entry.price + 'コイン'));
    image.emit('load'); assert.equal(image.hidden, false); assert.equal(placeholder.hidden, true); assert.equal(art.dataset.artReady, 'true'); assert.equal(art.dataset.artState, 'ready');
    image.emit('error'); assert.equal(image.hidden, true); assert.equal(placeholder.hidden, false); assert.equal(art.dataset.artReady, 'false'); assert.equal(art.dataset.artState, 'error');
    assert.equal(art.textContent, '', 'A failed image cannot return to platform emoji');
    image.emit('load'); assert.equal(image.hidden, false); assert.equal(placeholder.hidden, true);
  }
  assert.equal(f.host.querySelectorAll('.ipg-background-swatch').length, 4);
  assert.equal(f.host.querySelectorAll('.ipg-clothing-art').length, 6);
  assert.equal(f.host.querySelectorAll('.ipg-clothing-swatch').length, 0, 'Generated clothing illustrations do not inherit clipped CSS garments');
  assert.equal(f.host.querySelectorAll('.ipg-item-art-fallback').length, 0);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); f.ui.close();
});

test('every garment shares its product illustration with free fitting and saved wearing while preserving the economy', async () => {
  for (const id of illustratedClothingIds) {
    const f = await fixture({ species: 'lilac', rendererMode: 'ready' });
    await f.click(f.focusButton('tab-shop'));
    const before = f.saved(), writes = f.writes.length, entry = Core.items.find(item => item.id === id);
    await f.click(f.focusButton('outfit-try-' + id));
    const fitting = f.host.querySelector('.ipg-outfit-fitting');
    assert.equal(fitting.querySelector('.ipg-fitting-item-art').dataset.itemArt, id);
    assert.equal(fitting.querySelector('.ipg-fitting-item-art').querySelector('img').src, illustrationPath(id));
    assert.equal(f.mounts.at(-1).options.outfit, id, 'The actual animated fitting still uses the selected garment');
    assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes, 'Trying an unowned garment never purchases or saves');
    await f.click(f.focusButton('outfit-buy-' + id));
    const bought = f.saved(); assert.equal(bought.coins, before.coins - entry.price); assert.equal(bought.wardrobe.owned[id], true); assert.equal(bought.wardrobe.equipped, null);
    await f.click(f.focusButton('outfit-wear-' + id));
    const worn = f.saved(), thumbnail = f.host.querySelector('.ipg-worn-item-art');
    assert.equal(worn.wardrobe.equipped, id); assert.equal(worn.coins, bought.coins); assert.equal(worn.pet.exp, before.pet.exp);
    assert.equal(thumbnail.dataset.itemArt, id); assert.equal(thumbnail.querySelector('img').src, illustrationPath(id));
    assert.ok(f.host.querySelector('.ipg-worn-outfit').textContent.includes(entry.name));
    assert.deepEqual(worn.inventory, before.inventory); assert.deepEqual(worn.decorations, before.decorations); assert.deepEqual(worn.market, before.market);
    const persistedWrites = f.writes.length; thumbnail.querySelector('img').emit('error'); assert.equal(thumbnail.textContent, '');
    assert.deepEqual(f.saved(), worn); assert.equal(f.writes.length, persistedWrites, 'Drawing success/failure cannot change saved clothes or balances');
    assert.doesNotMatch(JSON.stringify(worn), /pet-clothes-v1|itemArt|artReady|artState/);
    await f.click(f.focusButton('outfit-remove')); assert.equal(f.saved().wardrobe.equipped, null); assert.equal(f.saved().wardrobe.owned[id], true);
    assert.equal(f.host.querySelector('.ipg-worn-item-art'), null); assert.equal(f.saved().coins, worn.coins); f.ui.close();
  }
});

test('room decorations and ordinary care reuse local illustrations without emoji fallbacks', async () => {
  const f = await fixture({ species: 'lilac', rendererMode: 'ready', setup: async app => {
    assert.equal((await app.dispatch({ type: 'buyItem', itemId: 'house' })).ok, true);
    assert.equal((await app.dispatch({ type: 'equip', itemId: 'house' })).ok, true);
  } });
  const before = f.saved(), writes = f.writes.length;
  const decoration = f.host.querySelector('.ipg-decoration-art'); assert.equal(decoration.dataset.itemArt, 'house');
  assert.equal(decoration.querySelector('img').src, illustrationPath('house')); decoration.querySelector('img').emit('error'); assert.equal(decoration.textContent, '');
  const care = f.focusButton('care-feed').querySelector('.ipg-care-item-art'); assert.equal(care.querySelector('img').src, illustrationPath('apple')); assert.equal(care.textContent, '');
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
  f.ui.close();
});

test('illustration styles use fixed neutral boxes and never apply old garment clipping or pseudo-garments', () => {
  const css = fs.readFileSync(require.resolve('../static/pet-game.css'), 'utf8');
  assert.match(css, /\.ipg-item-art-placeholder\{[^}]*width:100%;height:100%/);
  assert.match(css, /\.ipg-item-art-image\[hidden\],\.ipg-item-art-placeholder\[hidden\]\{display:none!important\}/);
  assert.doesNotMatch(css, /\.ipg-clothing-swatch|\.ipg-cloth-(?:vest|cape|overalls|knit|pajamas|dress)/);
  assert.match(css, /\.ipg-clothing-art\{[^}]*max-width:100%/);
  assert.match(css, /\.ipg-feeding-food\[data-food-id\]:not\(\[data-food-id=""\]\)\{background:none/);
});

function roomProps(f) { return f.host.querySelectorAll('.ipg-room-layout-prop'); }
function roomProp(f, id) { const found = roomProps(f).find(el => el.dataset.roomItem === id); assert.ok(found, id); return found; }
function roomPosition(f, id) { const el = roomProp(f, id); return { x: Number(el.dataset.x), y: Number(el.dataset.y), flip: el.dataset.flip === 'true' }; }
function roomGeometry(f, id, width = 300, height = 280, itemWidth = 60, itemHeight = 60) {
  const surface = f.host.querySelector('.ipg-room-layout-surface'), prop = roomProp(f, id);
  surface.getBoundingClientRect = () => ({ left: 10, top: 20, width, height });
  prop.getBoundingClientRect = () => ({ left: 10, top: 20, width: itemWidth, height: itemHeight });
  return { surface, prop };
}

test('room layout is opt-in: old rooms keep six fixed fixtures and equipped artwork without a startup write', async () => {
  const f = await fixture({ species: 'lilac', developerPreview: false, setup: async s => {
    assert.equal((await s.dispatch({ type: 'buyItem', itemId: 'flower' })).ok, true);
    assert.equal((await s.dispatch({ type: 'equip', itemId: 'flower' })).ok, true);
  } });
  const before = f.saved(), writes = f.writes.length;
  assert.equal(Object.hasOwn(before, 'roomLayout'), false);
  for (const part of ['window', 'shelf', 'rug', 'bed', 'bowl', 'toy']) assert.equal(f.host.querySelectorAll('.ipg-room-' + part).length, 1, part);
  assert.equal(f.host.querySelectorAll('.ipg-pet-decoration').length, 1);
  assert.equal(roomProps(f).length, 0); assert.ok(f.focusButton('room-edit'));
  f.ui.render(); f.window.emit('focus'); await flush();
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
  delete f.window.PetGameCore.getRoomLayout; delete f.window.PetGameCore.roomFurniture;
  f.ui.render(); assert.equal(f.host.querySelectorAll('.ipg-room-window').length, 1);
  assert.equal(f.focusButton('room-edit').disabled, true, 'an older optional Core retains its room but cannot start unsupported editing');
});

test('editing stops room drawing and touch, suppresses stale care/navigation handlers and keeps every draft action local', async () => {
  const f = await fixture({ species: 'lilac', developerPreview: false, rendererMode: 'ready' });
  const before = f.saved(), writes = f.writes.length, care = f.focusButton('care-feed'), nav = f.focusButton('tab-shop');
  await f.click(f.focusButton('room-edit'));
  assert.equal(roomProps(f).length, 6); assert.equal(f.activeMotions().length, 0);
  assert.equal(f.host.querySelector('.ipg-touch-actions'), null); assert.equal(f.host.querySelector('.ipg-room-care'), null);
  assert.equal(f.host.querySelector('.ipg-backup'), null); assert.equal(f.host.querySelector('.ipg-pet-settings'), null);
  for (const key of ['care', 'village', 'shop', 'market']) assert.equal(f.focusButton('tab-' + key).disabled, true);
  care.emit('click'); nav.emit('click'); await flush();
  assert.ok(f.host.querySelector('.ipg-room-editor')); assert.equal(f.host.querySelector('.ipg-shop-grid'), null);
  await f.click(roomProp(f, 'room_window')); await f.click(f.focusButton('room-flip')); await f.click(f.focusButton('room-move-右へ'));
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(f.raf.size, 0);
  assert.ok(f.host.textContent.includes('画面を離れると、保存前の変更は取り消されます'));
  await f.click(f.focusButton('room-cancel'));
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(f.activeMotions().length, 1);
});

test('all six fixtures and seven owned decorations can be placed once, flipped and put away without purchases or saves', async () => {
  const decorations = Core.items.filter(row => row.type === 'decoration');
  assert.equal(decorations.length, 7);
  const f = await fixture({ species: 'lilac', developerPreview: false, seed: { pg_coins: '100000' }, setup: async s => {
    for (const entry of decorations) assert.equal((await s.dispatch({ type: 'buyItem', itemId: entry.id })).ok, true);
  } });
  const before = f.saved(), writes = f.writes.length;
  await f.click(f.focusButton('room-edit'));
  const choices = f.host.querySelectorAll('.ipg-room-layout-choices')[0].querySelectorAll('button');
  assert.equal(choices.length, 13); assert.ok(choices.every(el => !['apple', 'rice', 'cloth_cream_vest'].includes(el.dataset.roomChoice)));
  for (const entry of decorations) {
    await f.click(f.focusButton('room-add-' + entry.id));
    assert.equal(f.focusButton('room-add-' + entry.id).disabled, true);
    assert.equal(f.document.activeElement, roomProp(f, entry.id));
  }
  assert.equal(roomProps(f).length, 13); assert.equal(new Set(roomProps(f).map(el => el.dataset.roomItem)).size, 13);
  const latest = decorations.at(-1).id;
  await f.click(f.focusButton('room-flip')); assert.equal(roomPosition(f, latest).flip, true);
  await f.click(f.focusButton('room-remove')); assert.equal(roomProps(f).length, 12);
  assert.equal(f.focusButton('room-add-' + latest).disabled, false);
  await f.click(f.focusButton('room-reset')); assert.equal(roomProps(f).length, 6);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('mouse/touch drag, room tap and keyboard move the same local integer coordinates with edge clamping', async () => {
  const f = await fixture({ species: 'lilac', developerPreview: false });
  const before = f.saved(), writes = f.writes.length;
  await f.click(f.focusButton('room-edit'));
  const { surface, prop } = roomGeometry(f, 'room_window');
  const captures = [], releases = []; prop.setPointerCapture = id => captures.push(id); prop.releasePointerCapture = id => releases.push(id);
  prop.emit('pointerdown', { pointerId: 4, button: 0, isPrimary: true, clientX: 80, clientY: 90 });
  f.window.emit('pointermove', { pointerId: 4, clientX: 2000, clientY: -1000 });
  assert.deepEqual(roomPosition(f, 'room_window'), { x: 100, y: 0, flip: false });
  f.window.emit('pointerup', { pointerId: 4 }); assert.deepEqual(captures, [4]); assert.deepEqual(releases, [4]);
  surface.emit('click', { clientX: 160, clientY: 160 });
  assert.deepEqual(roomPosition(f, 'room_window'), { x: 50, y: 50, flip: false });
  f.document.emit('keydown', { target: prop, key: 'ArrowLeft' });
  f.document.emit('keydown', { target: prop, key: 'ArrowDown', shiftKey: true });
  assert.deepEqual(roomPosition(f, 'room_window'), { x: 49, y: 60, flip: false });
  await f.click(f.focusButton('room-move-上へ')); assert.equal(roomPosition(f, 'room_window').y, 55);
  f.document.emit('keydown', { target: f.document.body, key: 'ArrowRight' });
  assert.equal(roomPosition(f, 'room_window').x, 49, 'keyboard events outside the editor do not move furniture');
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('secondary and mismatched pointers, canceled drags, blur and detached handlers cannot move a draft', async () => {
  const f = await fixture({ species: 'lilac', developerPreview: false }); await f.click(f.focusButton('room-edit'));
  let { prop } = roomGeometry(f, 'room_bed'), initial = roomPosition(f, 'room_bed');
  for (const bad of [{ button: 2 }, { isPrimary: false }]) {
    prop.emit('pointerdown', { pointerId: 1, button: 0, isPrimary: true, clientX: 10, clientY: 10, ...bad });
    f.window.emit('pointermove', { pointerId: 1, clientX: 200, clientY: 200 }); assert.deepEqual(roomPosition(f, 'room_bed'), initial);
  }
  prop.emit('pointerdown', { pointerId: 2, button: 0, clientX: 10, clientY: 10 });
  f.window.emit('pointermove', { pointerId: 8, clientX: 200, clientY: 200 }); assert.deepEqual(roomPosition(f, 'room_bed'), initial);
  f.window.emit('pointercancel', { pointerId: 2 }); f.window.emit('pointermove', { pointerId: 2, clientX: 200, clientY: 200 });
  assert.deepEqual(roomPosition(f, 'room_bed'), initial);
  prop.emit('pointerdown', { pointerId: 3, button: 0, clientX: 10, clientY: 10 }); f.window.emit('blur');
  f.window.emit('pointermove', { pointerId: 3, clientX: 200, clientY: 200 }); assert.deepEqual(roomPosition(f, 'room_bed'), initial);
  prop.emit('pointerdown', { pointerId: 4, button: 0, clientX: 10, clientY: 10 }); prop.emit('lostpointercapture', { pointerId: 4 });
  f.window.emit('pointermove', { pointerId: 4, clientX: 200, clientY: 200 }); assert.deepEqual(roomPosition(f, 'room_bed'), initial);
  prop.emit('pointerdown', { pointerId: 5, button: 0, clientX: 10, clientY: 10 });
  f.window.emit('pointermove', { pointerId: 5, clientX: -999, clientY: -999 }); assert.deepEqual(roomPosition(f, 'room_bed'), { x: 0, y: 0, flip: false }, 'capture loss permits a new drag');
  f.window.emit('pointerup', { pointerId: 5 }); initial = roomPosition(f, 'room_bed');
  const oldFlip = f.focusButton('room-flip'), oldSave = f.focusButton('room-save'); f.ui.render();
  prop.emit('pointerdown', { pointerId: 9, button: 0, clientX: 10, clientY: 10 }); oldFlip.emit('click'); oldSave.emit('click');
  f.window.emit('pointermove', { pointerId: 9, clientX: 200, clientY: 200 }); await flush();
  assert.deepEqual(roomPosition(f, 'room_bed'), initial); assert.ok(f.host.querySelector('.ipg-room-editor'));
});

test('saving dispatches exactly once and changes only layout plus revision after asynchronous persistence confirms', async () => {
  const f = await fixture({ species: 'lilac', developerPreview: false });
  const before = f.saved(), writes = f.writes.length, actions = [], dispatch = f.store.dispatch;
  f.store.dispatch = action => { actions.push(copy(action)); return dispatch(action); };
  await f.click(f.focusButton('room-edit')); await f.click(roomProp(f, 'room_window')); await f.click(f.focusButton('room-flip'));
  await f.click(f.focusButton('room-move-右へ'));
  const expected = Core.getRoomLayout(before); expected.items[0].x += 5; expected.items[0].flip = true;
  const gate = deferred(); f.control.pending = gate;
  const save = f.focusButton('room-save'); await f.click(save); save.emit('click'); await flush();
  assert.equal(actions.length, 1); assert.deepEqual(actions[0], { type: 'saveRoomLayout', layout: expected, expectedRevision: before.revision });
  assert.deepEqual(f.saved(), before); assert.deepEqual(JSON.parse(f.store.exportBackup()).state, before);
  assert.equal(f.focusButton('room-save').disabled, true); assert.equal(f.focusButton('room-cancel').disabled, true);
  gate.resolve(); await flush(); f.control.pending = null;
  assert.deepEqual(f.saved(), { ...before, roomLayout: expected, revision: before.revision + 1 }); assert.equal(f.writes.length, writes + 1);
  assert.equal(f.host.querySelector('.ipg-room-editor'), null); assert.equal(roomProps(f).length, 6);
  assert.equal(f.host.querySelector('.ipg-pet-decoration'), null); assert.equal(f.focusButton('room-edit'), f.document.activeElement);
  assert.ok(f.host.textContent.includes('おへやの配置を保存しました'));
});

for (const outcome of ['false', 'throw']) test('a ' + outcome + ' room save preserves the complete draft and old durable state until an explicit retry', async () => {
  const f = await fixture({ species: 'lilac', developerPreview: false }); const before = f.saved(), writes = f.writes.length;
  await f.click(f.focusButton('room-edit')); await f.click(roomProp(f, 'room_window')); await f.click(f.focusButton('room-flip'));
  const draft = roomPosition(f, 'room_window'); f.control.outcome = outcome; await f.click(f.focusButton('room-save'));
  assert.deepEqual(f.saved(), before); assert.deepEqual(JSON.parse(f.store.exportBackup()).state, before); assert.equal(f.writes.length, writes);
  assert.ok(f.host.textContent.includes('配置を保存できませんでした')); assert.ok(!f.host.textContent.includes('配置を保存しました'));
  assert.deepEqual(roomPosition(f, 'room_window'), draft); assert.equal(f.focusButton('room-cancel').disabled, false);
  f.control.outcome = 'ok'; await f.click(f.focusButton('room-save'));
  assert.equal(f.saved().roomLayout.items[0].flip, true); assert.equal(f.writes.length, writes + 1);
});

test('a revision conflict retains the draft and current saved state without rebasing or overwriting another action', async () => {
  const f = await fixture({ species: 'lilac', developerPreview: false });
  await f.click(f.focusButton('room-edit')); await f.click(roomProp(f, 'room_bed')); await f.click(f.focusButton('room-flip'));
  assert.equal((await f.store.dispatch({ type: 'rename', name: 'ほかの変更' })).ok, true); await flush();
  const before = f.saved(), writes = f.writes.length;
  await f.click(f.focusButton('room-save'));
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(roomPosition(f, 'room_bed').flip, true);
  assert.ok(f.host.textContent.includes('ほかの操作で記録が変わった'));
  assert.ok(f.host.textContent.includes('下書きは残っています'));
  await f.click(f.focusButton('room-cancel')); assert.equal(f.saved().pet.name, 'ほかの変更');
});

test('focus, daily refresh and a same-target mount retain the local draft but replace all obsolete surface listeners', async () => {
  const f = await fixture({ species: 'lilac', developerPreview: false }); await f.click(f.focusButton('room-edit'));
  await f.click(roomProp(f, 'room_toy')); await f.click(f.focusButton('room-move-左へ'));
  const expected = roomPosition(f, 'room_toy'), before = f.saved(), writes = f.writes.length;
  const old = roomGeometry(f, 'room_toy'); old.prop.emit('pointerdown', { pointerId: 6, clientX: 10, clientY: 10, button: 0 });
  f.window.emit('focus'); await flush(); assert.deepEqual(roomPosition(f, 'room_toy'), expected);
  f.window.emit('pointermove', { pointerId: 6, clientX: 999, clientY: 999 }); assert.deepEqual(roomPosition(f, 'room_toy'), expected);
  f.advance(86400000); f.ui.render(); assert.deepEqual(roomPosition(f, 'room_toy'), expected);
  assert.equal(await f.ui.mount(f.host), true); assert.deepEqual(roomPosition(f, 'room_toy'), expected);
  assert.equal(f.window.listenerCount('pointermove'), 1); assert.equal(f.document.listenerCount('keydown'), 1);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

for (const interrupt of ['close', 'pagehide', 'visibility']) test(interrupt + ' discards only the room draft and prevents old pointers from changing a reopened editor', async () => {
  const f = await fixture({ species: 'lilac', developerPreview: false }); const before = f.saved(), writes = f.writes.length;
  await f.click(f.focusButton('room-edit')); const old = roomGeometry(f, 'room_window');
  old.prop.emit('pointerdown', { pointerId: 5, clientX: 0, clientY: 0, button: 0 });
  f.window.emit('pointermove', { pointerId: 5, clientX: 900, clientY: 900 });
  if (interrupt === 'close') await f.ui.close();
  if (interrupt === 'pagehide') f.window.emit('pagehide');
  if (interrupt === 'visibility') { f.document.hidden = true; f.document.emit('visibilitychange'); }
  assert.equal(f.window.listenerCount('pointermove'), 0); assert.equal(f.document.listenerCount('keydown'), 0);
  f.document.hidden = false; await f.ui.open(); await f.click(f.focusButton('room-edit'));
  const expected = roomPosition(f, 'room_window');
  old.prop.emit('pointerdown', { pointerId: 5, clientX: 0, clientY: 0, button: 0 });
  f.window.emit('pointermove', { pointerId: 5, clientX: 900, clientY: 900 }); f.window.emit('pointerup', { pointerId: 5 });
  assert.deepEqual(roomPosition(f, 'room_window'), expected); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('a late successful save after close cannot close, change or announce success in a newer editor session', async () => {
  const f = await fixture({ species: 'lilac', developerPreview: false });
  await f.click(f.focusButton('room-edit')); await f.click(roomProp(f, 'room_bed')); await f.click(f.focusButton('room-flip'));
  const gate = deferred(); f.control.pending = gate; await f.click(f.focusButton('room-save'));
  await f.ui.close(); await f.ui.open(); await f.click(f.focusButton('room-edit'));
  await f.click(roomProp(f, 'room_toy')); await f.click(f.focusButton('room-move-左へ'));
  const expected = roomPosition(f, 'room_toy');
  gate.resolve(); await flush(); f.control.pending = null;
  assert.equal(f.saved().roomLayout.items.find(row => row.id === 'room_bed').flip, true, 'the authorized old save still finishes in its store');
  assert.ok(f.host.querySelector('.ipg-room-editor')); assert.deepEqual(roomPosition(f, 'room_toy'), expected);
  assert.equal(f.focusButton('room-save').disabled, false); assert.ok(!f.host.textContent.includes('配置を保存しました'));
});

test('mounting another host destroys the editor and isolates old pending save callbacks from that mount', async () => {
  const f = await fixture({ species: 'lilac', developerPreview: false });
  await f.click(f.focusButton('room-edit')); const oldProp = roomGeometry(f, 'room_bed').prop;
  await f.click(oldProp); await f.click(f.focusButton('room-flip'));
  const gate = deferred(); f.control.pending = gate; await f.click(f.focusButton('room-save'));
  const target = f.document.createElement('div'); f.pane.appendChild(target);
  const renders = [], replace = target.replaceChildren.bind(target); target.replaceChildren = (...children) => { replace(...children); renders.push(target.textContent); };
  const opening = f.ui.mount(target); await flush();
  assert.equal(target.querySelector('.ipg-room-editor'), null); assert.equal(f.window.listenerCount('pointermove'), 0);
  gate.resolve(); await flush(); f.control.pending = null; assert.equal(await opening, true);
  const current = target.textContent;
  assert.equal(renders.length, 2, 'the new host renders loading and its own ready state, never an early old-store notification');
  assert.equal(target.textContent, current); assert.equal(target.querySelector('.ipg-room-editor'), null);
  oldProp.emit('pointerdown', { pointerId: 8, clientX: 0, clientY: 0 }); f.window.emit('pointermove', { pointerId: 8, clientX: 900, clientY: 900 });
  assert.equal(target.textContent, current);
});

test('Escape first deselects and then cancels without changing saved furniture or granting a reward', async () => {
  const f = await fixture({ species: 'lilac', developerPreview: false }); const before = f.saved(), writes = f.writes.length;
  await f.click(f.focusButton('room-edit')); await f.click(roomProp(f, 'room_rug'));
  const prop = roomProp(f, 'room_rug'); f.document.emit('keydown', { target: prop, key: 'Escape' });
  assert.ok(f.host.querySelector('.ipg-room-editor')); assert.equal(prop.getAttribute('aria-pressed'), 'false');
  assert.equal(f.focusButton('room-flip').disabled, true);
  f.document.emit('keydown', { target: f.host.querySelector('.ipg-room-layout-surface'), key: 'Escape' });
  assert.equal(f.host.querySelector('.ipg-room-editor'), null); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('a saved empty room stays empty through render, reopen and edit instead of restoring furniture or equipped artwork', async () => {
  const f = await fixture({ species: 'lilac', developerPreview: false, setup: async s => {
    await s.dispatch({ type: 'buyItem', itemId: 'flower' }); await s.dispatch({ type: 'equip', itemId: 'flower' });
    assert.equal((await s.dispatch({ type: 'saveRoomLayout', layout: { version: 1, items: [] }, expectedRevision: s.getState().revision })).ok, true);
  } });
  const before = f.saved(), writes = f.writes.length;
  for (const part of ['window', 'shelf', 'rug', 'bed', 'bowl', 'toy']) assert.equal(f.host.querySelector('.ipg-room-' + part), null);
  assert.equal(roomProps(f).length, 0); assert.equal(f.host.querySelector('.ipg-pet-decoration'), null);
  f.ui.render(); await f.ui.close(); await f.ui.open(); assert.equal(roomProps(f).length, 0);
  await f.click(f.focusButton('room-edit')); assert.equal(roomProps(f).length, 0);
  await f.click(f.focusButton('room-cancel')); assert.equal(roomProps(f).length, 0);
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
});

test('custom room shop places owned decorations without replacing others and routes removal into the local editor', async () => {
  const f = await fixture({ species: 'lilac', developerPreview: false, seed: { pg_coins: '10000' }, setup: async s => {
    for (const id of ['flower', 'tree']) await s.dispatch({ type: 'buyItem', itemId: id });
    await s.dispatch({ type: 'saveRoomLayout', layout: { version: 1, items: [{ id: 'flower', x: 0, y: 100, flip: true }] }, expectedRevision: s.getState().revision });
  } });
  await f.click(f.focusButton('tab-shop'));
  const row = id => f.host.querySelectorAll('.ipg-shop-item').find(el => el.dataset.itemId === id);
  assert.equal(row('flower').querySelector('button').textContent, '配置済み'); assert.equal(row('flower').querySelector('button').disabled, true);
  const tree = row('tree').querySelector('button'); assert.equal(tree.textContent, 'お部屋に置く'); await f.click(tree);
  assert.deepEqual(f.saved().roomLayout.items, [{ id: 'flower', x: 0, y: 100, flip: true }, { id: 'tree', x: 74, y: 94, flip: false }]);
  assert.ok(!f.host.textContent.includes('身につけているかざりを外す'));
  const before = f.saved(), writes = f.writes.length;
  await f.click(f.button('配置を変える・片づける')); assert.ok(f.host.querySelector('.ipg-room-editor'));
  await f.click(roomProp(f, 'flower')); await f.click(f.focusButton('room-remove'));
  assert.equal(roomProps(f).length, 1); assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes);
  await f.click(f.focusButton('room-cancel')); assert.deepEqual(f.saved(), before);
});

test('safe travel coordinates keep every padded prop inside representative 320px and 720px rooms and above the 64px care strip', async () => {
  const css = fs.readFileSync(require.resolve('../static/pet-game.css'), 'utf8');
  assert.match(css, /\.ipg-room-layout-surface\{position:absolute;inset:12px 12px 64px;/);
  assert.match(css, /\.ipg \.ipg-room-layout-prop\{[^}]*max-width:100%;max-height:100%[^}]*overflow:hidden/);
  assert.match(css, /\.ipg-room-layout-content\{position:absolute;inset:8px;/);
  // Evaluate the applicable simple class rules by CSS specificity then source
  // order. A later one-class rug rule must not falsely beat the two-class base.
  const zRules = [...css.matchAll(/(\.ipg(?: \.ipg-room-layout-prop| \.ipg-room-prop-rug)|\.ipg-room-prop-rug)\{([^}]+)\}/g)]
    .filter(match => /(?:^|;)z-index:/.test(match[2]))
    .map(match => ({ selector: match[1], specificity: (match[1].match(/\./g) || []).length, order: match.index,
      z: Number(/(?:^|;)z-index:(\d+)/.exec(match[2])[1]), declarations: match[2] }));
  const winner = zRules.sort((a,b) => a.specificity - b.specificity || a.order - b.order).at(-1);
  assert.equal(winner.selector, '.ipg .ipg-room-prop-rug'); assert.equal(winner.z, 0, 'rug remains below general z-index:1 even when appended last');
  assert.equal(winner.declarations, 'z-index:0', 'the stronger rule only changes stacking and cannot override compact rug dimensions');
  assert.match(css, /\.ipg-room-prop-rug\{width:min\(70%,416px\);height:106px\}/);
  assert.match(css, /@media\(max-width:540px\)\{[^\n]*\.ipg-room-prop-rug\{width:82%;height:85px\}/);
  assert.match(css, /\.ipg-room-layout-tools[^}]*flex-wrap:wrap/);
  assert.match(css, /\.ipg \.ipg-room-layout-tools>\.ipg-button\{min-width:44px;min-height:44px/);
  assert.match(css, /@media\(prefers-color-scheme:dark\)\{\.ipg-room-layout-surface\.is-editing/);
  for (const roomWidth of [320, 720]) {
    const compact = roomWidth <= 540, roomHeight = compact ? 354 : 414, insetX = compact ? 8 : 12, insetTop = compact ? 10 : 12;
    const surfaceWidth = roomWidth - insetX * 2, surfaceHeight = roomHeight - insetTop - 64;
    const sizes = compact ? [[94,113],[100,64],[surfaceWidth*.82,85],[94,75],[56,39],[38,38],[80,80]] : [[114,132],[126,64],[Math.min(416,surfaceWidth*.7),106],[122,87],[68,42],[44,44],[96,96]];
    for (const [width,height] of sizes) for (const x of [0,50,100]) for (const y of [0,50,100]) {
      const left = insetX + x / 100 * (surfaceWidth - width), top = insetTop + y / 100 * (surfaceHeight - height);
      assert.ok(left >= insetX && left + width <= roomWidth - insetX + 1e-8);
      assert.ok(top >= insetTop && top + height <= roomHeight - 64 + 1e-8);
    }
    const f = await fixture({ species: 'lilac', developerPreview: false }); await f.click(f.focusButton('room-edit'));
    const { prop } = roomGeometry(f, 'room_bed', surfaceWidth, surfaceHeight, sizes[3][0], sizes[3][1]);
    prop.emit('pointerdown', { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
    f.window.emit('pointermove', { pointerId: 1, clientX: -9999, clientY: 9999 });
    assert.deepEqual(roomPosition(f, 'room_bed'), { x: 0, y: 100, flip: false });
    assert.equal(prop.style.left, '0%'); assert.equal(prop.style.top, '100%'); assert.equal(prop.style.transform, 'translate(-0%,-100%)');
  }
});


test('a disk-level conflict cannot overwrite another store and explicitly asks for a reload while keeping the local draft', async () => {
  const f = await fixture({ species: 'lilac', developerPreview: false });
  const other = Core.create({ storage: f.storage, now: () => new Date(2026, 9, 21, 12).getTime(), random: () => .5 });
  assert.equal((await other.ready).ok, true);
  await f.click(f.focusButton('room-edit')); await f.click(roomProp(f, 'room_toy')); await f.click(f.focusButton('room-flip'));
  assert.equal((await other.dispatch({ type: 'rename', name: '別のタブの子' })).ok, true);
  const before = f.saved(), writes = f.writes.length; await f.click(f.focusButton('room-save'));
  assert.deepEqual(f.saved(), before); assert.equal(f.writes.length, writes); assert.equal(roomPosition(f, 'room_toy').flip, true);
  assert.ok(f.host.textContent.includes('ページを再読み込みしてから')); assert.ok(!f.host.textContent.includes('配置を保存しました'));
});

test('an obsolete failed save cannot replace a newer draft error or leave the new session busy', async () => {
  const f = await fixture({ species: 'lilac', developerPreview: false }); const before = f.saved();
  await f.click(f.focusButton('room-edit')); const gate = deferred(); f.control.pending = gate;
  f.control.outcome = 'throw'; await f.click(f.focusButton('room-save')); await f.ui.close(); await f.ui.open();
  await f.click(f.focusButton('room-edit')); await f.click(roomProp(f, 'room_bowl')); await f.click(f.focusButton('room-flip'));
  gate.resolve(); await flush(); f.control.pending = null; f.control.outcome = 'ok';
  assert.deepEqual(f.saved(), before); assert.equal(roomPosition(f, 'room_bowl').flip, true); assert.equal(f.focusButton('room-save').disabled, false);
  assert.ok(!f.host.textContent.includes('配置を保存できませんでした')); await f.click(f.focusButton('room-cancel'));
});

test('room arrangement is available for eggs and bunnies, stays free, and does not expose motion inspection', async () => {
  for (const sample of [{ species: 'lilac', exp: 0 }, { species: 'bunny', exp: 30 }]) {
    const f = await fixture({ species: sample.species, seed: { pg_exp: String(sample.exp) }, developerPreview: false });
    const before = f.saved(); await f.click(f.focusButton('room-edit'));
    assert.equal(roomProps(f).length, 6); assert.equal(f.host.querySelector('.ipg-emotion-panel'), null); assert.equal(f.activeMotions().length, 0);
    await f.click(f.focusButton('room-save'));
    assert.deepEqual(f.saved(), { ...before, roomLayout: Core.getRoomLayout(before), revision: before.revision + 1 });
  }
});


async function villageFixture(config={}) { return fixture({species:'lilac',developerPreview:false,startAtVillage:true,...config}); }
function villagePlace(f,id) { return f.focusButton('village-place-'+id); }
function villagePositionInView(f,id) { const p=villagePlace(f,id);return p.className.includes('ipg-town-place')?{x:Number(p.dataset.layoutX),y:Number(p.dataset.layoutY)}:{x:Number.parseFloat(p.style.left),y:Number.parseFloat(p.style.top)}; }
async function setVillageAxis(f,axis,value) { const field=f.focusButton('village-'+axis);field.value=String(value);field.emit('input');await flush(); }
async function walkToVillagePlace(f,id,enter=true) {
  await f.click(villagePlace(f,id));
  for(let frame=0;frame<650;frame++) {
    await f.frame(50);
    const avatar=f.host.querySelector('.ipg-town-avatar'),world=Town.createWorld(Core.getVillageLayout(f.store.getState()));
    const pos={x:parseFloat(avatar.style.left),y:parseFloat(avatar.style.top)},place=world.places.find(row=>row.id===id);
    if(Math.hypot(pos.x-place.entrance.x,pos.y-place.entrance.y)<1)break;
  }
  if(enter&&['home','shop'].includes(id)) {
    const button=f.focusButton('town-enter');assert.equal(button.hidden,false,id+' is in reach');
    assert.ok(button.textContent.startsWith(Town.createWorld().places.find(p=>p.id===id).label));await f.click(button);
  }
}

test('public game enters the cafe village without initializing layout or changing legacy pet and economy',async()=>{
  const f=await villageFixture({seed:{pg_exp:'686',pg_coins:'574',pg_items:'{"rice":2}'}});
  assert.ok(f.host.querySelector('.ipg-village'));assert.equal(f.focusButton('tab-village').getAttribute('aria-current'),'page');
  assert.deepEqual(f.host.querySelectorAll('.ipg-village-place,.ipg-town-place').map(x=>x.dataset.place),Core.villagePlaces.map(x=>x.id));
  assert.equal(f.host.querySelector('.ipg-care-room'),null);assert.equal(Object.hasOwn(f.saved(),'villageLayout'),false);
  assert.equal(f.data.get(Core.KEY),f.beforeMountRaw);assert.equal(f.writes.length,f.writesBeforeMount);assert.equal(f.saved().pet.exp,686);assert.equal(f.saved().coins,574);
  f.ui.render();await f.ui.close();await f.ui.open();assert.equal(f.data.get(Core.KEY),f.beforeMountRaw);assert.ok(f.host.querySelector('.ipg-village'));
});

test('walking to nearby entrances opens the existing facilities only after explicit entry, without granting rewards',async()=>{
  const f=await villageFixture(),before=f.saved(),writes=f.writes.length;
  const start=f.host.querySelector('.ipg-town-avatar').style.left;
  await f.click(villagePlace(f,'home'));assert.ok(f.host.querySelector('.ipg-town'));assert.equal(f.host.querySelector('.ipg-town-avatar').style.left,start,'tap cannot teleport or enter');
  await walkToVillagePlace(f,'home');assert.ok(f.host.querySelector('.ipg-care-room'));assert.equal(f.focusButton('tab-care').getAttribute('aria-current'),'page');
  await f.click(f.focusButton('tab-village'));await walkToVillagePlace(f,'shop');assert.ok(f.host.querySelector('.ipg-village-market'));
  await f.click(f.focusButton('tab-village'));await walkToVillagePlace(f,'cafe');assert.ok(f.host.querySelector('.ipg-town'));assert.equal(f.focusButton('town-enter').hidden,true);
  await f.click(f.focusButton('tab-village'));await walkToVillagePlace(f,'playground');assert.ok(f.host.querySelector('.ipg-town'));assert.equal(f.focusButton('town-enter').hidden,true);
  await f.click(f.focusButton('tab-village'));await walkToVillagePlace(f,'tree',false);assert.ok(f.host.querySelector('.ipg-town'));
  await walkToVillagePlace(f,'flowers',false);assert.equal(f.focusButton('town-enter').hidden,true);
  assert.deepEqual(f.saved(),before);assert.equal(f.writes.length,writes);
});

test('town uses exactly the raised clothed pet, moves continuously with its camera, and writes no save',async()=>{
  const f=await villageFixture({rendererMode:'ready',seed:{pg_exp:'686'},setup:async store=>{
    for(const action of [{type:'buyItem',itemId:'cloth_cream_vest'},{type:'equipClothing',itemId:'cloth_cream_vest'}])assert.equal((await store.dispatch(action)).ok,true);
  }}),before=f.saved(),writes=f.writes.length;
  const avatar=f.host.querySelector('.ipg-town-avatar'),visual=avatar.querySelector('.ipg-lilac-visual'),scene=f.host.querySelector('.ipg-town-world');
  assert.equal(f.host.querySelectorAll('.ipg-lilac-visual').length,1);assert.equal(visual.dataset.outfit,'cloth_cream_vest');
  assert.equal(f.activeMotions()[0].options.growthStage,Core.getLilacGrowth(before.pet.exp).key);
  const x=parseFloat(avatar.style.left),camera=scene.style.transform,button=f.focusButton('town-right');
  button.emit('pointerdown',{pointerId:1,button:0});await f.frame();for(let i=0;i<25;i++)await f.frame(50);
  assert.equal(Math.round(parseFloat(avatar.style.left)-x),250);assert.notEqual(scene.style.transform,camera);
  assert.equal(avatar.dataset.walking,'true');assert.equal(avatar.style.zIndex,String(Math.round(parseFloat(avatar.style.top))));
  const moving=f.activeMotions()[0].changes.filter(row=>row.name==='moving');assert.ok(moving.length>=3);assert.ok(moving.every(row=>row.durationMs===1600&&row.elapsedMs>=0&&row.elapsedMs<1600));
  f.window.emit('pointerup',{pointerId:1});await f.frame(50);assert.equal(avatar.dataset.walking,'false');
  assert.deepEqual(f.saved(),before);assert.equal(f.writes.length,writes);
});

test('returning from a facility keeps the walked position while detached entry controls are inert',async()=>{
  const f=await villageFixture(),before=f.saved();await walkToVillagePlace(f,'shop',false);
  const avatar=f.host.querySelector('.ipg-town-avatar'),position=[avatar.style.left,avatar.style.top],oldEnter=f.focusButton('town-enter'),oldRight=f.focusButton('town-right');
  await f.click(oldEnter);assert.ok(f.host.querySelector('.ipg-village-market'));
  await f.click(f.focusButton('tab-village'));const current=f.host.querySelector('.ipg-town-avatar');
  assert.deepEqual([current.style.left,current.style.top],position);assert.equal(f.focusButton('town-enter').textContent,'マルシェに入る');
  oldEnter.emit('click');oldRight.emit('pointerdown',{pointerId:8,button:0});await f.frame(50);
  assert.ok(f.host.querySelector('.ipg-town'));assert.deepEqual([current.style.left,current.style.top],position);assert.deepEqual(f.saved(),before);
});

test('town hide and editing destroy all movement frames; reopening is still with the same durable pet',async()=>{
  const f=await villageFixture(),before=f.saved(),button=f.focusButton('town-right');
  button.emit('pointerdown',{pointerId:2,button:0});await f.frame();await f.frame(50);const stale=[...f.raf.values()];
  await f.ui.close();assert.equal(f.raf.size,0);stale.forEach(fn=>fn(999999));await f.ui.open();
  const avatar=f.host.querySelector('.ipg-town-avatar'),position=[avatar.style.left,avatar.style.top];
  await f.frame(500);assert.deepEqual([avatar.style.left,avatar.style.top],position);assert.equal(avatar.dataset.walking,'false');
  f.focusButton('town-right').emit('pointerdown',{pointerId:3,button:0});await f.frame();await f.click(f.focusButton('village-edit'));
  assert.equal(f.raf.size,0);button.emit('pointerdown',{pointerId:2,button:0});await f.frame(50);
  assert.ok(f.host.querySelector('.ipg-village-editor'));assert.deepEqual(f.saved(),before);
});

test('missing town movement code reports a loading failure without showing teleport controls or changing a save',async()=>{
  const f=await villageFixture({townUnavailable:true});assert.ok(f.host.textContent.includes('街を読み込めませんでした'));
  assert.equal(f.host.querySelector('.ipg-village-map'),null);assert.equal(f.host.querySelector('.ipg-town-avatar'),null);
  assert.equal(f.data.get(Core.KEY),f.beforeMountRaw);assert.equal(f.writes.length,f.writesBeforeMount);
});

test('village editor keeps all six entrances free, blocks navigation and updates only local integer positions before save',async()=>{
  const f=await villageFixture(),before=f.saved(),writes=f.writes.length,oldRoomTab=f.focusButton('tab-care'),oldShop=villagePlace(f,'shop');
  await f.click(f.focusButton('village-edit'));assert.ok(f.host.querySelector('.ipg-village-editor'));
  assert.equal(f.host.querySelectorAll('.ipg-village-place,.ipg-town-place').length,6);assert.equal(f.host.querySelector('.ipg-backup'),null);
  assert.ok(f.host.querySelector('.ipg-tabs').querySelectorAll('button').every(x=>x.disabled));oldRoomTab.emit('click');oldShop.emit('click');await flush();
  assert.ok(f.host.querySelector('.ipg-village-editor'));
  await f.click(villagePlace(f,'cafe'));await setVillageAxis(f,'x',81);await setVillageAxis(f,'y',79);
  assert.deepEqual(villagePositionInView(f,'cafe'),{x:81,y:78});assert.equal(villagePlace(f,'cafe').getAttribute('aria-pressed'),'true');
  assert.deepEqual(f.saved(),before);assert.equal(f.writes.length,writes);
  await f.click(f.button('はじめの配置'));assert.deepEqual(villagePositionInView(f,'cafe'),{x:72,y:23});
  await f.click(f.button('やめる'));assert.equal(f.host.querySelector('.ipg-village-editor'),null);assert.deepEqual(f.saved(),before);assert.equal(f.writes.length,writes);
});

test('village save waits for durability and publishes exactly the edited layout without touching room growth or economy',async()=>{
  const f=await villageFixture(),before=f.saved(),gate=deferred();
  await f.click(f.focusButton('village-edit'));await f.click(villagePlace(f,'shop'));await setVillageAxis(f,'x',33);await setVillageAxis(f,'y',77);
  f.control.pending=gate;await f.click(f.focusButton('village-save'));
  assert.deepEqual(f.saved(),before);assert.equal(f.host.getAttribute('aria-busy'),'true');assert.ok(f.focusButton('village-save').disabled);
  const pendingSlider=f.focusButton('village-x');pendingSlider.value='80';pendingSlider.emit('input');await flush();assert.deepEqual(villagePositionInView(f,'shop'),{x:33,y:77});
  gate.resolve();await flush();f.control.pending=null;
  const expected=Core.defaultVillageLayout();Object.assign(expected.items.find(x=>x.id==='shop'),{x:33,y:77});
  assert.deepEqual(f.saved(),{...before,villageLayout:expected,revision:before.revision+1});assert.equal(f.host.querySelector('.ipg-village-editor'),null);
  assert.ok(f.host.textContent.includes('村の配置を保存しました'));assert.equal(f.document.activeElement,f.focusButton('village-edit'));
  f.ui.render();await f.ui.close();await f.ui.open();assert.deepEqual(villagePositionInView(f,'shop'),{x:33,y:77});
});

for(const mode of ['false','throw'])test(mode+' village write retains the draft and old save until explicit retry',async()=>{
  const f=await villageFixture(),before=f.saved();await f.click(f.focusButton('village-edit'));await setVillageAxis(f,'x',76);
  f.control.outcome=mode;await f.click(f.focusButton('village-save'));assert.deepEqual(f.saved(),before);assert.ok(f.host.querySelector('.ipg-village-editor'));
  assert.deepEqual(villagePositionInView(f,'home'),{x:76,y:23});assert.ok(f.host.textContent.includes('下書きは残っています'));assert.equal(f.focusButton('village-save').disabled,false);
  f.control.outcome='ok';await f.click(f.focusButton('village-save'));assert.equal(f.saved().villageLayout.items.find(x=>x.id==='home').x,76);assert.equal(f.saved().coins,before.coins);assert.equal(f.saved().pet.exp,before.pet.exp);
});

test('a village revision conflict retains the draft and newer real care without rebasing it',async()=>{
  const f=await villageFixture();await f.click(f.focusButton('village-edit'));await setVillageAxis(f,'y',71);
  assert.equal((await f.store.dispatch({type:'care',kind:'rest'})).ok,true);const saved=f.saved(),writes=f.writes.length;
  await f.click(f.focusButton('village-save'));assert.deepEqual(f.saved(),saved);assert.equal(f.writes.length,writes);
  assert.ok(f.host.querySelector('.ipg-village-editor'));assert.deepEqual(villagePositionInView(f,'home'),{x:22,y:71});assert.ok(f.host.textContent.includes('ほかの操作で記録が変わりました'));
});

for(const interrupt of ['close','pagehide','visibility'])test(interrupt+' discards village draft and ignores old controls after reopen',async()=>{
  const f=await villageFixture(),before=f.saved(),writes=f.writes.length;
  await f.click(f.focusButton('village-edit'));await setVillageAxis(f,'x',78);
  const oldSlider=f.focusButton('village-x'),oldSave=f.focusButton('village-save'),oldCancel=f.button('やめる'),oldReset=f.button('はじめの配置');
  if(interrupt==='close')await f.ui.close();if(interrupt==='pagehide')f.window.emit('pagehide');if(interrupt==='visibility'){f.document.hidden=true;f.document.emit('visibilitychange');}
  f.document.hidden=false;await f.ui.open();await f.click(f.focusButton('village-edit'));await setVillageAxis(f,'y',73);
  oldSlider.value='85';oldSlider.emit('input');oldSave.emit('click');oldCancel.emit('click');oldReset.emit('click');await flush();
  assert.ok(f.host.querySelector('.ipg-village-editor'));assert.deepEqual(villagePositionInView(f,'home'),{x:22,y:73});assert.deepEqual(f.saved(),before);assert.equal(f.writes.length,writes);
});

test('a late village save may finish in its store but cannot close or announce success in a newer editor',async()=>{
  const f=await villageFixture();await f.click(f.focusButton('village-edit'));await setVillageAxis(f,'x',79);
  const gate=deferred();f.control.pending=gate;await f.click(f.focusButton('village-save'));await f.ui.close();await f.ui.open();
  await f.click(f.focusButton('village-edit'));await f.click(villagePlace(f,'cafe'));await setVillageAxis(f,'y',77);
  gate.resolve();await flush();f.control.pending=null;
  assert.equal(f.saved().villageLayout.items.find(x=>x.id==='home').x,79);assert.ok(f.host.querySelector('.ipg-village-editor'));
  assert.deepEqual(villagePositionInView(f,'cafe'),{x:72,y:77});assert.equal(f.focusButton('village-save').disabled,false);assert.ok(!f.host.textContent.includes('村の配置を保存しました'));
});

test('mounting a different host isolates a pending village save and all detached editor callbacks',async()=>{
  const f=await villageFixture();await f.click(f.focusButton('village-edit'));await setVillageAxis(f,'y',79);
  const oldSlider=f.focusButton('village-y'),oldSave=f.focusButton('village-save'),oldCancel=f.button('やめる');
  const gate=deferred();f.control.pending=gate;await f.click(oldSave);
  const target=f.document.createElement('div');f.pane.appendChild(target);const renders=[],replace=target.replaceChildren.bind(target);
  target.replaceChildren=(...children)=>{replace(...children);renders.push(target.textContent);};
  const opening=f.ui.mount(target);await flush();assert.equal(target.querySelector('.ipg-village-editor'),null);
  gate.resolve();await flush();f.control.pending=null;assert.equal(await opening,true);assert.equal(renders.length,2);
  assert.ok(target.querySelector('.ipg-village'));assert.equal(target.querySelector('.ipg-village-editor'),null);const text=target.textContent,saved=f.saved(),writes=f.writes.length;
  oldSlider.value='16';oldSlider.emit('input');oldSave.emit('click');oldCancel.emit('click');await flush();
  assert.equal(target.textContent,text);assert.deepEqual(f.saved(),saved);assert.equal(f.writes.length,writes);assert.equal(saved.villageLayout.items.find(x=>x.id==='home').y,78);
});

test('cafe and playground remain walkable scenery with no minigame entry, timers or rewards',async()=>{
  const f=await villageFixture(),before=f.saved(),writes=f.writes.length;
  f.window.PetCafe={mount(){assert.fail('removed cafe runtime must never mount');}};
  for(const id of ['cafe','playground']){
    await walkToVillagePlace(f,id);assert.ok(f.host.querySelector('.ipg-town'));
    assert.equal(f.focusButton('town-enter').hidden,true);assert.equal(f.host.querySelector('.ipg-cafe-activity'),null);assert.equal(f.host.querySelector('.ipg-catch-board'),null);
    assert.equal(f.raf.size,0);assert.doesNotMatch(f.host.textContent,/おやつづくり|おにぎりキャッチ|25秒|ミニゲーム|準備中/);
    await f.frame(30000);assert.deepEqual(f.saved(),before);assert.equal(f.writes.length,writes);
  }
  await f.ui.close();assert.equal(f.raf.size,0);
});

async function archivedMinigame(kind){
  return fixture({species:'lilac',developerPreview:false,startAtVillage:true,rendererMode:'ready',setup:async store=>{
    const backup=JSON.parse(store.exportBackup());backup.state.minigames={day:backup.state.minigames.day,started:2,active:{id:'archived-'+kind,kind,startedAt:backup.exportedAt-30000},completed:['historic-result'],bestScore:17};
    assert.equal((await store.importBackup(JSON.stringify(backup))).ok,true);
  }});
}
test('old active catch and snack records survive mount, idle, visibility, close and reopen byte for byte',async()=>{
  for(const kind of ['catch','snack']){
    const f=await archivedMinigame(kind),before=f.saved(),raw=f.data.get(Core.KEY),writes=f.writes.length;
    assert.equal(raw,f.beforeMountRaw);assert.equal(writes,f.writesBeforeMount);assert.equal(before.minigames.active.kind,kind);
    assert.doesNotMatch(f.host.textContent,/ミニゲーム|前の回|結果の保存|25秒/);assert.equal(f.raf.size,0);
    f.ui.render();await f.frame(30000);f.document.hidden=true;f.document.emit('visibilitychange');await flush();
    f.document.hidden=false;f.document.emit('visibilitychange');f.window.emit('pageshow');f.window.emit('focus');await flush();
    await f.ui.close();await f.ui.open();await f.frame(30000);
    assert.equal(f.data.get(Core.KEY),raw);assert.deepEqual(f.saved(),before);assert.equal(f.writes.length,writes);assert.equal(f.raf.size,0);assert.equal(f.actionCues.length,0);
    const exported=JSON.parse(f.store.exportBackup()).state;assert.deepEqual(exported.minigames,before.minigames);await f.ui.close();
  }
});
test('ordinary care play can save while an archived minigame active and all prior game history remain intact',async()=>{
  const f=await archivedMinigame('snack'),before=f.saved();await f.click(f.focusButton('tab-care'));await f.click(f.focusButton('care-play'));
  const after=f.saved();assert.equal(after.pet.exp,before.pet.exp+5);assert.equal(after.care.counts.play,before.care.counts.play+1);
  assert.deepEqual(after.minigames,before.minigames);assert.deepEqual(after.inventory,before.inventory);assert.deepEqual(after.wardrobe,before.wardrobe);
  await f.click(f.focusButton('tab-shop'));await f.click(f.focusButton('tab-market'));await f.click(f.focusButton('tab-village'));
  assert.deepEqual(f.saved(),after);await f.ui.close();assert.deepEqual(f.saved(),after);
});

test('village facility and flora edges clamp to their distinct safe bands without rewriting saved coordinates on view or edit',async()=>{
  const f=await villageFixture({setup:async store=>{
    const layout=Core.defaultVillageLayout();layout.items.forEach((row,i)=>{row.x=i%2?100:0;row.y=i%2?100:0;});
    assert.equal((await store.dispatch({type:'saveVillageLayout',layout,expectedRevision:store.getState().revision})).ok,true);
  }}),before=f.saved(),writes=f.writes.length;
  const bounds=id=>['tree','flowers'].includes(id)?[16,84]:[22,78];
  Town.createWorld(before.villageLayout).places.forEach(row=>assert.deepEqual(villagePositionInView(f,row.id),{x:row.x/2880*100,y:row.y/1920*100}));
  assert.equal(f.data.get(Core.KEY),f.beforeMountRaw);assert.equal(f.writes.length,writes);
  await f.click(f.focusButton('village-edit'));
  for(const {id} of Core.villagePlaces){
    await f.click(villagePlace(f,id));const [low,high]=bounds(id),vertical=f.focusButton('village-y');
    assert.equal(Number(vertical.min),low);assert.equal(Number(vertical.max),high);
    await setVillageAxis(f,'y',-999);await setVillageAxis(f,'x',-999);assert.deepEqual(villagePositionInView(f,id),{x:15,y:low});
    await setVillageAxis(f,'y',999);await setVillageAxis(f,'x',999);assert.deepEqual(villagePositionInView(f,id),{x:85,y:high});
    assert.deepEqual(f.saved(),before);assert.equal(f.writes.length,writes);
  }
  await f.click(f.focusButton('village-save'));
  const expected=Core.defaultVillageLayout();expected.items.forEach(row=>{row.x=85;row.y=bounds(row.id)[1];});
  assert.deepEqual(f.saved(),{...before,villageLayout:expected,revision:before.revision+1});assert.equal(f.writes.length,writes+1);
});

test('village connected roads stay decorative while all six original entrances and browsing remain free',async()=>{
  const f=await villageFixture(),before=f.saved(),writes=f.writes.length;
  const roads=f.host.querySelector('.ipg-village-roads');assert.ok(roads);
  assert.equal(roads.getAttribute('aria-hidden'),'true');assert.equal(roads.getAttribute('focusable'),'false');
  // A vertical lane has a zero-width object bounding box, so its texture needs
  // a nonzero filter region in the shared map's coordinate system.
  const texture=roads.querySelector('filter');assert.ok(texture);
  assert.equal(texture.getAttribute('filterUnits'),'userSpaceOnUse');
  for(const [attribute,value] of [['x','0'],['y','0'],['width','1000'],['height','1000']])assert.equal(texture.getAttribute(attribute),value);
  assert.deepEqual(roads.querySelectorAll('.ipg-village-lane').map(lane=>lane.dataset.pathFor).sort(),['cafe','flowers','home','playground','shop']);
  assert.equal(roads.querySelectorAll('button').length,0);
  const entrances=f.host.querySelectorAll('.ipg-village-place,.ipg-town-place');assert.equal(entrances.length,6);
  for(const spec of Core.villagePlaces){
    const entrance=villagePlace(f,spec.id);assert.equal(entrance.tagName,'BUTTON');
    assert.ok(entrance.getAttribute('aria-label').includes(spec.name));assert.equal(entrance.disabled,false);
  }
  await f.click(villagePlace(f,'tree'));await f.click(villagePlace(f,'flowers'));
  await walkToVillagePlace(f,'home');await f.click(f.focusButton('tab-village'));
  assert.ok(f.host.querySelector('.ipg-village-roads'));assert.deepEqual(f.saved(),before);assert.equal(f.writes.length,writes);
});

test('village roads follow visible clamped entrances and draft edits without stale controls changing a newer world',async()=>{
  const f=await villageFixture({setup:async store=>{
    const layout=Core.defaultVillageLayout();layout.items.forEach((row,i)=>{row.x=i%2?100:0;row.y=i%2?100:0;});
    assert.equal((await store.dispatch({type:'saveVillageLayout',layout,expectedRevision:store.getState().revision})).ok,true);
  }}),before=f.saved(),writes=f.writes.length;
  function lane(id){return f.host.querySelectorAll('.ipg-village-lane').find(path=>path.dataset.pathFor===id);}
  function endpoint(id){const coordinates=lane(id).getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number);return coordinates.slice(-2);}
  for(const row of before.villageLayout.items.filter(row=>row.id!=='tree')){
    const position=villagePositionInView(f,row.id);assert.deepEqual(endpoint(row.id),[position.x*10,(position.y+4)*10]);
  }
  await f.click(f.focusButton('village-edit'));await f.click(villagePlace(f,'cafe'));
  await setVillageAxis(f,'x',63);await setVillageAxis(f,'y',41);assert.deepEqual(endpoint('cafe'),[630,450]);
  await f.click(villagePlace(f,'flowers'));await setVillageAxis(f,'x',-999);await setVillageAxis(f,'y',999);
  assert.deepEqual(endpoint('flowers'),[150,880]);assert.deepEqual(f.saved(),before);assert.equal(f.writes.length,writes);
  const oldSlider=f.focusButton('village-x');await f.ui.close();await f.ui.open();
  await f.click(f.focusButton('village-edit'));await setVillageAxis(f,'x',56);await setVillageAxis(f,'y',64);
  const currentRoads=f.host.querySelectorAll('.ipg-village-lane').map(path=>path.getAttribute('d'));
  oldSlider.value='85';oldSlider.emit('input');await flush();
  assert.deepEqual(f.host.querySelectorAll('.ipg-village-lane').map(path=>path.getAttribute('d')),currentRoads);
  assert.deepEqual(endpoint('home'),[560,680]);await f.click(f.button('やめる'));
  assert.deepEqual(f.saved(),before);assert.equal(f.writes.length,writes);
  assert.deepEqual(endpoint('home'),[150,260]);
});

test('market illustrations use six fixed decorative images and recover from loading failures without state writes',async()=>{
  const f=await fixture({species:'lilac',developerPreview:false});await f.click(f.focusButton('tab-market'));
  const before=f.saved(),writes=f.writes.length;
  const sources={apl:'/static/pet-items-v1/apple.webp',rkt:'/static/pet-market-v1/rocket.webp',grn:'/static/pet-items-v1/tree.webp',gam:'/static/pet-market-v1/controller.webp',bnk:'/static/pet-market-v1/bank.webp',fud:'/static/pet-items-v1/feast.webp'};
  const rows=f.host.querySelectorAll('.ipg-stock');assert.equal(rows.length,6);
  for(const stock of Core.stocks){
    const row=rows.find(card=>card.querySelector('.ipg-stock-art')?.dataset.stockArt===stock.id);assert.ok(row,stock.id);
    const heading=row.querySelector('.ipg-stock-heading'),art=heading.querySelector('.ipg-stock-art');
    const image=art.querySelector('img'),placeholder=art.querySelector('.ipg-item-art-placeholder');
    assert.equal(heading.querySelector('h3').textContent,stock.name);assert.equal(art.getAttribute('aria-hidden'),'true');
    assert.equal(image.src,sources[stock.id]);assert.equal(image.alt,'');assert.equal(image.getAttribute('aria-hidden'),'true');assert.equal(image.draggable,false);
    assert.equal(art.dataset.artState,'loading');assert.equal(image.hidden,true);assert.equal(placeholder.hidden,false);
    assert.equal(art.textContent,'');assert.ok(row.textContent.includes(before.market.prices[stock.id]+' コイン / 株'));
    image.emit('load');assert.equal(art.dataset.artState,'ready');assert.equal(image.hidden,false);assert.equal(placeholder.hidden,true);
    image.emit('error');assert.equal(art.dataset.artState,'error');assert.equal(image.hidden,true);assert.equal(placeholder.hidden,false);assert.equal(art.textContent,'');
    image.emit('load');assert.equal(art.dataset.artState,'ready');assert.equal(image.hidden,false);assert.equal(placeholder.hidden,true);
  }
  assert.deepEqual(f.saved(),before);assert.equal(f.writes.length,writes);
});

test('market illustration failures leave real quantity purchases partial sales fees and saved holdings unchanged in behavior',async()=>{
  const f=await fixture({species:'lilac',developerPreview:false});await f.click(f.focusButton('tab-market'));
  const before=f.saved(),writes=f.writes.length;assert.equal(before.coins,500);assert.equal(before.market.prices.apl,40);
  function appleRow(){const row=f.host.querySelectorAll('.ipg-stock').find(card=>card.querySelector('.ipg-stock-art')?.dataset.stockArt==='apl');assert.ok(row);return row;}
  function stockButton(row,caption){const button=row.querySelectorAll('button').find(control=>control.textContent===caption);assert.ok(button);return button;}
  let row=appleRow();assert.equal(stockButton(row,'売る').disabled,true);
  row.querySelector('img').emit('error');let quantity=row.querySelector('input');quantity.value='2';quantity.emit('input');
  assert.deepEqual(f.saved(),before);assert.equal(f.writes.length,writes);await f.click(stockButton(row,'買う'));
  const bought=f.saved();assert.equal(bought.coins,419);assert.deepEqual(bought.market.holdings.apl,{quantity:2,costBasis:81});
  assert.equal(bought.market.feesPaid,before.market.feesPaid+1);assert.equal(bought.revision,before.revision+1);assert.equal(f.writes.length,writes+1);
  row=appleRow();assert.equal(row.querySelector('input').value,'2');assert.equal(stockButton(row,'売る').disabled,false);
  row.querySelector('img').emit('error');quantity=row.querySelector('input');quantity.value='1';quantity.emit('input');await f.click(stockButton(row,'売る'));
  const sold=f.saved();assert.equal(sold.coins,458);assert.deepEqual(sold.market.holdings.apl,{quantity:1,costBasis:40.5});
  assert.equal(sold.market.feesPaid,before.market.feesPaid+2);assert.equal(sold.market.realizedProfit,before.market.realizedProfit-1.5);
  assert.equal(sold.revision,before.revision+2);assert.equal(f.writes.length,writes+2);
  for(const field of ['pet','inventory','decorations','wardrobe','care','minigames','legacyReserve'])assert.deepEqual(sold[field],before[field]);
  for(const stock of Core.stocks.filter(stock=>stock.id!=='apl'))assert.deepEqual(sold.market.holdings[stock.id],before.market.holdings[stock.id]);
  for(const field of ['day','prices','previous','dividends'])assert.deepEqual(sold.market[field],before.market[field]);
  await f.click(f.focusButton('tab-care'));await f.click(f.focusButton('tab-market'));
  row=appleRow();row.querySelector('img').emit('load');assert.equal(row.querySelector('input').value,'1');
  assert.deepEqual(f.saved(),sold);assert.equal(f.writes.length,writes+2);
});

function priceChart(f,id){
  const chart=f.host.querySelectorAll('.ipg-price-chart').find(row=>row.dataset.stockId===id);assert.ok(chart,'price chart: '+id);return chart;
}
function plottedPrices(chart){
  return chart.querySelectorAll('.ipg-price-chart-dot').map(dot=>({day:Number(dot.dataset.day),price:Number(dot.dataset.price)}));
}
function plottedSegments(chart){
  return chart.querySelectorAll('.ipg-price-chart-line').map(line=>line.getAttribute('points').trim().split(/\s+/).map(pair=>pair.split(',').map(Number)));
}
function plottedPosition(chart,day){
  const dot=chart.querySelectorAll('.ipg-price-chart-dot').find(row=>Number(row.dataset.day)===day);assert.ok(dot,'plotted day '+day);
  return [Number(Number(dot.getAttribute('cx')).toFixed(2)),Number(Number(dot.getAttribute('cy')).toFixed(2))];
}
function pricesAt(offset=0){return Object.fromEntries(Core.stocks.map(stock=>[stock.id,stock.base+offset]));}
async function historicalMarketFixture(history,day=6,extra={}){
  return fixture({species:'lilac',developerPreview:false,setup:async store=>{
    const backup=JSON.parse(store.exportBackup());Object.assign(backup.state.market,{day,prices:pricesAt(day),previous:pricesAt(999),history,...extra});
    assert.equal((await store.importBackup(JSON.stringify(backup))).ok,true);
  }});
}

test('each fresh market product has an accessible native SVG chart showing only its observed current price without saving',async()=>{
  const f=await fixture({species:'lilac',developerPreview:false}),before=f.saved(),writes=f.writes.length;
  await f.click(f.focusButton('tab-market'));
  assert.equal(f.host.querySelectorAll('.ipg-price-chart').length,6);
  for(const stock of Core.stocks){
    const chart=priceChart(f,stock.id),svg=chart.querySelector('.ipg-price-chart-svg');
    assert.equal(chart.tagName,'FIGURE');assert.equal(Number(chart.dataset.pointCount),1);
    assert.ok(svg);assert.equal(svg.namespaceURI,'http://www.w3.org/2000/svg');assert.ok(svg.getAttribute('viewBox'));
    assert.deepEqual(plottedPrices(chart),[{day:1,price:before.market.prices[stock.id]}]);
    assert.equal(plottedSegments(chart).length,0,'a starting price is a point, not an invented past');
    assert.ok(svg.getAttribute('aria-label').includes(stock.name));assert.ok(chart.querySelector('.ipg-price-chart-hint').textContent.trim());
    const dot=chart.querySelector('.ipg-price-chart-dot');assert.equal(dot.namespaceURI,'http://www.w3.org/2000/svg');
  }
  f.ui.render();await flush();await f.click(f.focusButton('tab-care'));await f.click(f.focusButton('tab-market'));
  assert.deepEqual(f.saved(),before);assert.equal(f.writes.length,writes);f.ui.close();
});

test('advancing the real market twice plots recorded prices for every product and never invents day one from previous prices',async()=>{
  const f=await fixture({species:'lilac',developerPreview:false});await f.click(f.focusButton('tab-market'));
  await f.click(f.button('ゲーム内の時間を1日進める'));await f.click(f.button('ゲーム内の時間を1日進める'));
  const after=f.saved(),writes=f.writes.length;assert.equal(after.market.day,3);
  for(const stock of Core.stocks){
    const chart=priceChart(f,stock.id);
    assert.deepEqual(plottedPrices(chart),[{day:2,price:stock.base+1},{day:3,price:after.market.prices[stock.id]}]);
    assert.equal(Number(chart.dataset.pointCount),2);assert.deepEqual(plottedSegments(chart),[[plottedPosition(chart,2),plottedPosition(chart,3)]]);
  }
  f.ui.render();await flush();assert.deepEqual(f.saved(),after);assert.equal(f.writes.length,writes);f.ui.close();
});

test('real buy and partial sell events add one observed daily price while preserving the existing trade economy',async()=>{
  const f=await fixture({species:'lilac',developerPreview:false});await f.click(f.focusButton('tab-market'));
  const before=f.saved(),writes=f.writes.length;
  function apple(){return f.host.querySelectorAll('.ipg-stock').find(row=>row.querySelector('.ipg-stock-art')?.dataset.stockArt==='apl');}
  function tradeButton(row,caption){return row.querySelectorAll('button').find(button=>button.textContent===caption);}
  let row=apple(),quantity=row.querySelector('input');quantity.value='2';quantity.emit('input');await f.click(tradeButton(row,'買う'));
  row=apple();quantity=row.querySelector('input');quantity.value='1';quantity.emit('input');await f.click(tradeButton(row,'売る'));
  const after=f.saved();assert.equal(after.coins,before.coins-42);assert.deepEqual(after.market.holdings.apl,{quantity:1,costBasis:40.5});
  assert.equal(after.market.feesPaid,before.market.feesPaid+2);assert.equal(f.writes.length,writes+2);
  assert.equal(after.market.history.length,2);assert.deepEqual(plottedPrices(priceChart(f,'apl')),[{day:1,price:40}]);
  await f.click(f.button('ゲーム内の時間を1日進める'));
  assert.deepEqual(plottedPrices(priceChart(f,'apl')),[{day:1,price:40},{day:2,price:41}]);
  assert.deepEqual(plottedSegments(priceChart(f,'apl')),[[plottedPosition(priceChart(f,'apl'),1),plottedPosition(priceChart(f,'apl'),2)]]);f.ui.close();
});

test('sparse saved observations preserve missing days and join only adjacent game days',async()=>{
  const f=await historicalMarketFixture([{type:'day',day:2,prices:pricesAt(2)},{type:'day',day:5,prices:pricesAt(5)},{type:'day',day:6,prices:pricesAt(6)}]);
  const before=f.saved(),writes=f.writes.length;await f.click(f.focusButton('tab-market'));
  for(const stock of Core.stocks){
    const chart=priceChart(f,stock.id);
    assert.deepEqual(plottedPrices(chart),[{day:2,price:stock.base+2},{day:5,price:stock.base+5},{day:6,price:stock.base+6}]);
    assert.deepEqual(plottedSegments(chart),[[plottedPosition(chart,5),plottedPosition(chart,6)]],'the gap from day two to five has no connecting line');
  }
  const chart=priceChart(f,'apl'),svg=chart.querySelector('.ipg-price-chart-svg'),readout=chart.querySelector('.ipg-price-chart-readout');
  assert.equal(readout.textContent,'6日目 · 46コイン');svg.emit('keydown',{key:'Home'});assert.equal(readout.textContent,'2日目 · 42コイン');
  svg.emit('keydown',{key:'ArrowRight'});assert.equal(readout.textContent,'5日目 · 45コイン');
  svg.emit('keydown',{key:'ArrowLeft'});assert.equal(readout.textContent,'2日目 · 42コイン');
  svg.emit('keydown',{key:'End'});assert.equal(readout.textContent,'6日目 · 46コイン');
  svg.emit('pointerdown',{clientX:12/320*300,pointerType:'touch'});assert.equal(readout.textContent,'2日目 · 42コイン');
  assert.deepEqual(f.saved(),before);assert.equal(f.writes.length,writes);f.ui.close();
});

test('conflicting old-day prices are omitted and a conflicting current-day observation cannot draw a misleading connection',async()=>{
  const f=await historicalMarketFixture([
    {type:'day',day:2,prices:pricesAt(2)},{type:'buyStock',day:2,stockId:'apl',quantity:1,price:99,fee:1},
    {type:'day',day:3,prices:pricesAt(3)},{type:'day',day:4,prices:pricesAt(4)},
    {type:'day',day:6,prices:pricesAt(40)}
  ]);await f.click(f.focusButton('tab-market'));
  const apple=priceChart(f,'apl');assert.deepEqual(plottedPrices(apple),[{day:3,price:43},{day:4,price:44},{day:6,price:46}]);
  assert.deepEqual(plottedSegments(apple),[[plottedPosition(apple,3),plottedPosition(apple,4)]]);
  f.ui.close();
  const consecutive=await historicalMarketFixture([{type:'day',day:5,prices:pricesAt(5)},{type:'day',day:6,prices:pricesAt(40)}]);
  await consecutive.click(consecutive.focusButton('tab-market'));
  assert.deepEqual(plottedPrices(priceChart(consecutive,'apl')),[{day:5,price:45},{day:6,price:46}]);
  assert.equal(plottedSegments(priceChart(consecutive,'apl')).length,0,'current truth wins without joining across its conflicting recorded value');consecutive.ui.close();
});

test('invalid saved history falls back to actual current prices without crashing or making storage writes',async()=>{
  const malformed=[
    [{type:'day',day:2,prices:pricesAt(2)},null],
    [{type:'day',day:2,prices:pricesAt(2)},{type:'unexpected',day:3,prices:pricesAt(3)}],
    [{type:'day',day:7,prices:pricesAt(7)}],
    [{type:'day',day:3,prices:pricesAt(3)},{type:'day',day:2,prices:pricesAt(2)}],
    [{type:'day',day:0,prices:pricesAt(0)}],
    [{type:'day',prices:pricesAt(2)}],
    [{type:'day',day:2,prices:{}}],
    [{type:'day',day:2,prices:Object.fromEntries(Core.stocks.map(stock=>[stock.id,'NaN']))}],
    [{type:'day',day:2,prices:Object.fromEntries(Core.stocks.map(stock=>[stock.id,0]))}],
    [{type:'day',day:2,prices:Object.fromEntries(Core.stocks.map(stock=>[stock.id,100000]))}],
    [{type:'day',day:2,prices:pricesAt(2)},{type:'buyStock',day:3,stockId:'unknown',quantity:1,price:40,fee:1}],
    [{type:'day',day:2,prices:pricesAt(2)},{type:'sellStock',day:3,stockId:'apl',quantity:0,price:40,fee:1}],
    [{type:'day',day:2,prices:pricesAt(2)},{type:'buyStock',day:3,stockId:'apl',quantity:1,price:40,fee:0}]
  ];
  for(const history of malformed){
    const f=await historicalMarketFixture(history),before=f.saved(),writes=f.writes.length;await f.click(f.focusButton('tab-market'));
    for(const stock of Core.stocks){
      const chart=priceChart(f,stock.id);assert.deepEqual(plottedPrices(chart),[{day:6,price:before.market.prices[stock.id]}],JSON.stringify(history));
      assert.equal(plottedSegments(chart).length,0);
    }
    assert.deepEqual(f.saved(),before);assert.equal(f.writes.length,writes);f.ui.close();
  }
});

test('legacy price resets retain observed points but never imply continuous prices across an unrecorded conversion',async()=>{
  for(const extra of [{legacyConversion:[{stockId:'apl'}]},{legacyPriceSnapshot:pricesAt(500)}]){
    const f=await historicalMarketFixture([{type:'day',day:5,prices:pricesAt(5)},{type:'day',day:6,prices:pricesAt(500)}],6,extra),before=f.saved(),writes=f.writes.length;
    await f.click(f.focusButton('tab-market'));
    const apple=priceChart(f,'apl');assert.deepEqual(plottedPrices(apple),[{day:5,price:45},{day:6,price:46}]);assert.equal(plottedSegments(apple).length,0);
    assert.deepEqual(f.saved(),before);assert.equal(f.writes.length,writes);f.ui.close();
  }
});

test('reopening and restoring a different market rebuilds charts from that save without retaining an old series',async()=>{
  const first=await historicalMarketFixture([{type:'day',day:2,prices:pricesAt(2)},{type:'day',day:5,prices:pricesAt(5)}]);
  await first.click(first.focusButton('tab-market'));assert.equal(plottedPrices(priceChart(first,'apl')).length,3);
  const backup=first.store.exportBackup();first.ui.close();
  const restored=await fixture({species:'lilac',developerPreview:false,setup:async store=>assert.equal((await store.importBackup(backup)).ok,true)});
  await restored.click(restored.focusButton('tab-market'));assert.deepEqual(plottedPrices(priceChart(restored,'apl')),[{day:2,price:42},{day:5,price:45},{day:6,price:46}]);restored.ui.close();
  const fresh=await fixture({species:'lilac',developerPreview:false}),before=fresh.saved(),writes=fresh.writes.length;
  await fresh.click(fresh.focusButton('tab-market'));assert.deepEqual(plottedPrices(priceChart(fresh,'apl')),[{day:1,price:40}]);
  assert.equal(plottedSegments(priceChart(fresh,'apl')).length,0);assert.deepEqual(fresh.saved(),before);assert.equal(fresh.writes.length,writes);fresh.ui.close();
});

function villageView(f) { return Core.getVillageEconomyView(f.store.getState(), f.now); }
function villageInput(f, key, value, event = 'input') {
  const input=f.focusButton(key);input.value=String(value);input.emit(event);return input;
}
async function marketVillageFixture(config = {}) {
  const f=await fixture({species:'lilac',developerPreview:false,seed:{pg_coins:'10000',pg_items:'{"rice":30,"apple":30}'},...config});
  await f.click(f.focusButton('tab-market'));return f;
}
async function nextVillageDay(f) {
  if(f.focusButton('village-advance').disabled){f.advance(60025);await f.fireTimers();}
  await f.click(f.focusButton('village-advance'));
}

test('village market views, redraw and reopen never initialize an old save or reroll visitors; old stocks and care shop remain separate',async()=>{
  const f=await marketVillageFixture(),before=f.saved(),raw=f.data.get(Core.KEY),writes=f.writes.length,view=villageView(f);
  assert.equal(Object.hasOwn(before,'villageEconomy'),false);
  assert.ok(f.host.querySelector('.ipg-village-goods'));assert.ok(f.host.querySelector('.ipg-village-businesses'));
  const legacy=f.host.querySelector('.ipg-village-legacy');assert.equal(legacy.tagName,'DETAILS');assert.notEqual(legacy.open,true);
  assert.equal(legacy.querySelectorAll('.ipg-stock').length,6);
  for(let i=0;i<3;i++){f.ui.render();assert.deepEqual(villageView(f),view);}
  f.ui.close();await f.ui.open();await f.click(f.focusButton('tab-market'));
  assert.deepEqual(villageView(f),view);assert.equal(f.data.get(Core.KEY),raw);assert.equal(f.writes.length,writes);
  await f.click(f.focusButton('tab-shop'));assert.ok(f.host.querySelector('.ipg-shop-grid'));assert.equal(f.host.querySelector('.ipg-village-goods'),null);
  assert.equal(f.data.get(Core.KEY),raw);f.ui.close();
});

for(const outcome of ['false','throw'])test('village listing '+outcome+' save retains the price/quantity draft and wallet, and an explicit retry escrows once',async()=>{
  const f=await marketVillageFixture(),before=f.saved(),writes=f.writes.length;
  villageInput(f,'village-list-item','rice','change');villageInput(f,'village-list-quantity',5);villageInput(f,'village-list-price',999);
  f.control.outcome=outcome;await f.click(f.focusButton('village-list'));
  assert.deepEqual(f.saved(),before);assert.equal(f.writes.length,writes);assert.equal(f.focusButton('village-list-quantity').value,'5');assert.equal(f.focusButton('village-list-price').value,'999');
  assert.match(f.host.querySelector('.ipg-notice').textContent,/保存/);
  f.control.outcome='ok';await f.click(f.focusButton('village-list'));
  const after=f.saved();assert.equal(after.inventory.rice,before.inventory.rice-5);assert.equal(after.coins,before.coins);
  assert.equal(villageView(f).listings.length,1);assert.equal(villageView(f).listings[0].remaining,5);assert.equal(f.writes.length,writes+1);
  assert.deepEqual(after.pet,before.pet);assert.deepEqual(after.market,before.market);f.ui.close();
});

test('a pending village listing changes no displayed balance before durability and repeated taps cannot duplicate escrow',async()=>{
  const f=await marketVillageFixture(),before=f.saved(),writes=f.writes.length;
  villageInput(f,'village-list-item','rice','change');villageInput(f,'village-list-quantity',4);villageInput(f,'village-list-price',12);
  const held=deferred(),list=f.focusButton('village-list');f.control.pending=held;list.emit('click');await flush();
  list.emit('click');assert.equal(list.disabled,true);assert.deepEqual(f.store.getState().inventory,before.inventory);assert.deepEqual(f.saved(),before);assert.equal(f.writes.length,writes);
  assert.equal(f.host.querySelectorAll('.ipg-village-trade-row').some(x=>x.dataset.listingId),false);
  held.resolve();await flush();f.control.pending=null;
  assert.equal(f.writes.length,writes+1);assert.equal(villageView(f).listings.length,1);assert.equal(f.saved().inventory.rice,before.inventory.rice-4);f.ui.close();
});

test('expensive listings can remain unsold; taking them down returns remaining inventory once without income',async()=>{
  const f=await marketVillageFixture(),before=f.saved();
  villageInput(f,'village-list-item','rice','change');villageInput(f,'village-list-quantity',5);villageInput(f,'village-list-price',999);
  await f.click(f.focusButton('village-list'));await nextVillageDay(f);
  const view=villageView(f);assert.equal(view.listings[0].remaining,5);assert.equal(f.saved().coins,before.coins);assert.equal(view.summary.salesRevenue,0);
  const cancel=f.focusButton('village-cancel-'+view.listings[0].id);await f.click(cancel);
  assert.equal(f.saved().inventory.rice,before.inventory.rice);assert.equal(villageView(f).listings.length,0);
  const writes=f.writes.length;cancel.emit('click');await flush();assert.equal(f.writes.length,writes);assert.equal(f.saved().coins,before.coins);f.ui.close();
});

test('cheap listing partial sales and cancellation conserve sold, remaining, escrow and the shared wallet',async()=>{
  const f=await marketVillageFixture(),before=f.saved();
  villageInput(f,'village-list-item','rice','change');villageInput(f,'village-list-quantity',20);villageInput(f,'village-list-price',1);
  await f.click(f.focusButton('village-list'));await nextVillageDay(f);
  const view=villageView(f),remaining=view.listings[0].remaining,sold=20-remaining;
  assert.ok(sold>0&&remaining>0);assert.equal(f.saved().coins,before.coins+sold);assert.equal(view.summary.salesRevenue,sold);
  assert.match(f.host.querySelector('.ipg-village-listings').textContent,new RegExp('残り'+remaining+'個'));
  await f.click(f.focusButton('village-cancel-'+view.listings[0].id));
  assert.equal(f.saved().inventory.rice,before.inventory.rice-sold);assert.deepEqual(f.saved().pet,before.pet);assert.deepEqual(f.saved().market,before.market);f.ui.close();
});

test('NPC offer purchase uses a finite actual offer and confirmed wallet/inventory; detached buy cannot buy it twice',async()=>{
  const f=await marketVillageFixture(),before=f.saved(),offer=villageView(f).offers[0],key='village-offer-'+offer.id;
  villageInput(f,key,2);const buy=f.focusButton(key+'-buy');await f.click(buy);
  assert.equal(f.saved().coins,before.coins-offer.unitPrice*2);assert.equal(f.saved().inventory[offer.itemId],(before.inventory[offer.itemId]||0)+2);
  assert.equal(villageView(f).offers.find(x=>x.id===offer.id).remaining,offer.remaining-2);
  const writes=f.writes.length;buy.emit('click');await flush();assert.equal(f.writes.length,writes);f.ui.close();
});

test('village time progresses only explicitly, enforces one minute, and the visible advance control unlocks without a save',async()=>{
  const f=await marketVillageFixture();await nextVillageDay(f);const after=f.saved(),writes=f.writes.length,visitors=villageView(f).visitors;
  assert.equal(villageView(f).day,2);assert.equal(f.focusButton('village-advance').disabled,true);assert.match(f.host.textContent,/約60秒後/);
  f.ui.render();assert.deepEqual(f.saved(),after);assert.deepEqual(villageView(f).visitors,visitors);
  f.advance(59999);await f.fireTimers();assert.equal(f.focusButton('village-advance').disabled,true);assert.equal(f.writes.length,writes);
  f.advance(30);await f.fireTimers();assert.equal(f.focusButton('village-advance').disabled,false);assert.equal(f.writes.length,writes);
  assert.equal(villageView(f).day,2);await nextVillageDay(f);assert.equal(villageView(f).day,3);assert.equal(f.writes.length,writes+1);f.ui.close();
});

test('availability timers preserve live listing and funding inputs, their draft values and focus while only updating the advance control',async()=>{
  const f=await marketVillageFixture();await nextVillageDay(f);
  const before=f.data.get(Core.KEY),writes=f.writes.length,goods=f.host.querySelector('.ipg-village-goods'),shops=f.host.querySelector('.ipg-village-businesses');
  const price=villageInput(f,'village-list-price',777),quantity=villageInput(f,'village-list-quantity',7),fund=villageInput(f,'village-fund-orchard',3);
  const advance=f.focusButton('village-advance'),hint=f.host.querySelector('.ipg-village-advance-hint');fund.focus();
  f.advance(30000);await f.fireTimers();assert.equal(f.focusButton('village-advance'),advance);assert.equal(advance.disabled,true);
  f.advance(30030);await f.fireTimers();
  assert.equal(f.focusButton('village-advance'),advance);assert.equal(advance.disabled,false);assert.equal(advance.dataset.ipgDisabled,'');
  assert.equal(f.host.querySelector('.ipg-village-advance-hint'),hint);assert.match(hint.textContent,/あと11回/);
  assert.equal(f.host.querySelector('.ipg-village-goods'),goods);assert.equal(f.host.querySelector('.ipg-village-businesses'),shops);
  for(const [key,input,value] of [['village-list-price',price,'777'],['village-list-quantity',quantity,'7'],['village-fund-orchard',fund,'3']]){
    assert.equal(f.focusButton(key),input);assert.equal(input.isConnected,true);assert.equal(input.value,value);
  }
  assert.equal(f.document.activeElement,fund);assert.equal(f.data.get(Core.KEY),before);assert.equal(f.writes.length,writes);assert.equal(villageView(f).day,2);
  await f.click(f.focusButton('village-jump-goods'));price.focus();f.advance(120000);await f.fireTimers();
  assert.equal(f.document.activeElement,price);assert.equal(f.focusButton('village-list-price'),price);assert.equal(f.data.get(Core.KEY),before);f.ui.close();
});

test('shared funding shows NPC holdings, then construction, open shares and net current-price sale without modifying legacy stocks',async()=>{
  const f=await marketVillageFixture(),original=f.saved();await nextVillageDay(f);
  let shop=villageView(f).shops.find(x=>x.id==='orchard');assert.equal(shop.npcShares,2);
  villageInput(f,'village-fund-orchard',18);await f.click(f.focusButton('village-fund-orchard-buy'));
  shop=villageView(f).shops.find(x=>x.id==='orchard');assert.equal(shop.status,'building');assert.equal(shop.playerShares,18);
  assert.match(f.host.querySelector('.ipg-village-businesses').textContent,/建設中/);assert.equal(f.host.querySelector('[data-focus-key="village-shares-orchard-sell"]'),null);
  await nextVillageDay(f);shop=villageView(f).shops.find(x=>x.id==='orchard');assert.equal(shop.status,'open');assert.ok(shop.maxSellQuantity>0);
  const before=f.saved();villageInput(f,'village-shares-orchard',1);await f.click(f.focusButton('village-shares-orchard-sell'));
  const after=f.saved(),fee=Math.max(1,Math.ceil(shop.price*.01));assert.equal(after.coins,before.coins+shop.price-fee);
  const sold=villageView(f).shops.find(x=>x.id==='orchard');assert.equal(sold.playerShares,17);assert.equal(sold.costBasis,170);assert.equal(sold.realizedProfit,shop.price-fee-10);
  assert.deepEqual(after.market,original.market);assert.deepEqual(after.pet,original.pet);f.ui.close();
});

test('actual operating profit enables a claimable food benefit and funded dividends, while a claim cannot replay',async()=>{
  const f=await marketVillageFixture();await nextVillageDay(f);villageInput(f,'village-fund-orchard',18);await f.click(f.focusButton('village-fund-orchard-buy'));await nextVillageDay(f);
  for(let round=0;round<4;round++){
    for(const offer of villageView(f).offers.filter(x=>x.shopId==='orchard'&&x.remaining>0)){
      const key='village-offer-'+offer.id;villageInput(f,key,offer.remaining);await f.click(f.focusButton(key+'-buy'));
    }
    if(round<3)await nextVillageDay(f);
  }
  const shop=villageView(f).shops.find(x=>x.id==='orchard');assert.ok(shop.pendingBenefit>0);assert.ok(shop.dividends>0);
  const before=f.saved(),claim=f.focusButton('village-benefit-orchard');await f.click(claim);
  assert.equal(f.saved().inventory.apple,before.inventory.apple+1);assert.equal(f.saved().coins,before.coins);
  assert.equal(villageView(f).shops.find(x=>x.id==='orchard').pendingBenefit,shop.pendingBenefit-1);
  const writes=f.writes.length;claim.emit('click');await flush();assert.equal(f.writes.length,writes);f.ui.close();
});

test('village validation keeps local drafts and performs no write for fractional, nonfinite or out-of-bounds listing values',async()=>{
  const f=await marketVillageFixture(),before=f.saved(),writes=f.writes.length;
  for(const [quantity,price] of [['0','1'],['1.5','1'],['100','1'],['1','1000'],['1','NaN'],['Infinity','1']]){
    villageInput(f,'village-list-quantity',quantity);villageInput(f,'village-list-price',price);await f.click(f.focusButton('village-list'));
    assert.deepEqual(f.saved(),before);assert.equal(f.writes.length,writes);assert.equal(f.focusButton('village-list-quantity').value,quantity);assert.equal(f.focusButton('village-list-price').value,price);
  }
  f.ui.close();
});

test('a stale stored revision refuses the village draft without overwriting newer care or listing inventory',async()=>{
  const f=await marketVillageFixture();villageInput(f,'village-list-item','rice','change');villageInput(f,'village-list-quantity',3);villageInput(f,'village-list-price',13);
  const other=Core.create({storage:f.storage,now:()=>f.now,random:()=>.5});await other.ready;assert.equal((await other.dispatch({type:'care',kind:'play'})).ok,true);
  const newer=f.data.get(Core.KEY),writes=f.writes.length;await f.click(f.focusButton('village-list'));
  assert.equal(f.data.get(Core.KEY),newer);assert.equal(f.writes.length,writes);assert.equal(f.focusButton('village-list-price').value,'13');assert.equal(Object.hasOwn(f.saved(),'villageEconomy'),false);f.ui.close();
});

test('closing a pending village save prevents late success messages and detached controls in the reopened screen',async()=>{
  const f=await marketVillageFixture();villageInput(f,'village-list-item','rice','change');villageInput(f,'village-list-price',999);
  const held=deferred(),oldButton=f.focusButton('village-list');f.control.pending=held;oldButton.emit('click');await flush();
  f.ui.close();await f.ui.open();held.resolve();await flush();f.control.pending=null;
  assert.equal(f.host.getAttribute('aria-busy'),'false');assert.doesNotMatch(f.host.querySelector('.ipg-notice').textContent,/出品しました/);
  const writes=f.writes.length;oldButton.emit('click');await flush();assert.equal(f.writes.length,writes);assert.equal(villageView(f).listings.length,1);f.ui.close();
});

test('the town economy scene receives a detached read-only projection and is disposed on route, close and remount',async()=>{
  const f=await villageFixture({villageScene:true}),before=f.data.get(Core.KEY),writes=f.writes.length,first=f.economyScenes[0];
  assert.ok(first.options.canRun());assert.equal(first.options.view.day,1);assert.equal(first.options.view.residents.length,2);assert.equal(first.options.view.shops.length,2);
  first.options.view.residents[0].name='changed';assert.notEqual(villageView(f).residents[0].name,'changed');
  first.options.onOpenMarket();await flush();assert.ok(f.host.querySelector('.ipg-village-market'));assert.equal(first.disposed,true);assert.equal(first.options.canRun(),false);
  await f.click(f.focusButton('tab-village'));const second=f.economyScenes.at(-1);assert.notEqual(first,second);f.ui.close();assert.equal(second.disposed,true);
  await f.ui.open();assert.ok(f.economyScenes.at(-1).options.canRun());assert.equal(f.data.get(Core.KEY),before);assert.equal(f.writes.length,writes);f.ui.close();
});

test('a pending village save remains in its original owner and connected old controls cannot change a newly mounted owner',async()=>{
  const f=await marketVillageFixture(),before=f.saved();villageInput(f,'village-list-item','rice','change');villageInput(f,'village-list-quantity',4);villageInput(f,'village-list-price',777);
  const held=deferred(),old=f.focusButton('village-list');f.control.pending=held;old.emit('click');await flush();
  const other=copy(before);other.pet.name='別の保存先のこ';other.coins=1234;
  const data=new Map([[Core.KEY,JSON.stringify(other)]]),otherWrites=[],storage={getItem:key=>data.get(key)??null,setItem(key,value){data.set(key,value);otherWrites.push([key,value]);}};
  const target=f.document.createElement('div');f.pane.appendChild(target);
  const opening=f.ui.mount(target,{storage,developerPreview:false,now:()=>f.now,random:()=>.5});await flush();
  held.resolve();assert.equal(await opening,true);await flush();f.control.pending=null;
  target.querySelector('[data-focus-key="tab-market"]').emit('click');await flush();
  assert.equal(old.isConnected,true,'the old owner may remain attached to its old host');old.emit('click');await flush();
  assert.equal(otherWrites.length,0);assert.deepEqual(JSON.parse(data.get(Core.KEY)),other);assert.equal(target.getAttribute('aria-busy'),'false');
  assert.equal(target.querySelector('[data-focus-key="village-list-price"]').value,'10');assert.doesNotMatch(target.querySelector('.ipg-notice').textContent,/出品しました/);
  assert.equal(f.saved().inventory.rice,before.inventory.rice-4);assert.equal(f.saved().villageEconomy.listings.length,1);f.ui.close();
});

test('the twelfth explicit village advance stops for the JST day and closing removes the availability refresh timer',async()=>{
  const f=await marketVillageFixture();
  for(let i=0;i<12;i++)await nextVillageDay(f);
  assert.equal(villageView(f).day,13);assert.equal(villageView(f).residents.length,5);assert.equal(villageView(f).advance.reason,'daily_limit');
  assert.equal(f.focusButton('village-advance').disabled,true);assert.match(f.host.textContent,/今日はここまで/);
  const advance=f.focusButton('village-advance'),price=villageInput(f,'village-list-price',19);price.focus();
  const raw=f.data.get(Core.KEY),writes=f.writes.length;f.advance(120000);await f.fireTimers();
  assert.equal(f.focusButton('village-advance'),advance);assert.equal(f.focusButton('village-list-price'),price);assert.equal(f.document.activeElement,price);
  assert.equal(f.data.get(Core.KEY),raw);assert.equal(f.writes.length,writes);assert.equal(villageView(f).day,13);
  f.advance(villageView(f).advance.waitMs+30);await f.fireTimers();
  assert.equal(f.focusButton('village-advance').disabled,false,'the core JST boundary unlocks without relying on a local calendar interval');
  assert.equal(f.focusButton('village-advance'),advance);assert.equal(f.focusButton('village-list-price'),price);assert.equal(f.document.activeElement,price);assert.equal(price.value,'19');
  assert.equal(villageView(f).day,13);assert.equal(villageView(f).advance.dailyRemaining,12);assert.equal(f.data.get(Core.KEY),raw);assert.equal(f.writes.length,writes);
  f.ui.close();assert.equal(f.timers.size,0);f.ui.close();
});

test('folded village rules disclose actual wait, JST cap, dividend and benefit conditions without changing the record',async()=>{
  const f=await marketVillageFixture(),raw=f.data.get(Core.KEY),writes=f.writes.length,rules=f.host.querySelector('.ipg-village-rules');
  assert.equal(rules.tagName,'DETAILS');assert.notEqual(rules.open,true);assert.equal(rules.querySelector('summary').textContent,'村のあそび方');
  assert.match(rules.textContent,/60秒/);assert.match(rules.textContent,/JST.*12回/);assert.match(rules.textContent,/3ゲーム日/);assert.match(rules.textContent,/2株以上/);
  rules.open=true;rules.emit('toggle');await flush();assert.equal(f.data.get(Core.KEY),raw);assert.equal(f.writes.length,writes);f.ui.close();
});

test('the two market shortcuts focus and scroll to the same sections without replacing draft inputs or saving',async()=>{
  const f=await marketVillageFixture(),raw=f.data.get(Core.KEY),writes=f.writes.length;
  const quantity=villageInput(f,'village-list-quantity',7),price=villageInput(f,'village-list-price',23),goods=f.host.querySelector('.ipg-village-goods'),shops=f.host.querySelector('.ipg-village-businesses');
  await f.click(f.focusButton('village-jump-shops'));assert.equal(f.scrolls().at(-1).node,shops);assert.equal(f.document.activeElement,shops.querySelector('h3'));
  await f.click(f.focusButton('village-jump-goods'));assert.equal(f.scrolls().at(-1).node,goods);assert.equal(f.document.activeElement,goods.querySelector('h3'));
  assert.equal(f.focusButton('village-list-quantity'),quantity);assert.equal(f.focusButton('village-list-price'),price);assert.equal(quantity.value,'7');assert.equal(price.value,'23');
  assert.equal(f.data.get(Core.KEY),raw);assert.equal(f.writes.length,writes);f.ui.close();
});

test('open-shop purchases preserve issued shares and a later sale uses actual average acquisition cost plus fees',async()=>{
  const f=await marketVillageFixture();await nextVillageDay(f);villageInput(f,'village-fund-orchard',18);await f.click(f.focusButton('village-fund-orchard-buy'));await nextVillageDay(f);
  const quoted=villageView(f).shops.find(x=>x.id==='orchard'),before=f.saved(),gross=quoted.price*2,fee=Math.max(1,Math.ceil(gross/100));
  assert.equal(quoted.npcShares,2);assert.ok(quoted.canBuyShares);villageInput(f,'village-buy-shares-orchard',2);await f.click(f.focusButton('village-buy-shares-orchard-buy'));
  const bought=villageView(f).shops.find(x=>x.id==='orchard');assert.equal(bought.playerShares,20);assert.equal(bought.npcShares,0);assert.equal(bought.costBasis,180+gross+fee);assert.equal(f.saved().coins,before.coins-gross-fee);
  assert.equal(f.focusButton('village-buy-shares-orchard-buy').disabled,true,'no NPC stock is fabricated after buying the available shares');
  const wallet=f.saved().coins,basis=bought.costBasis/20,sellFee=Math.max(1,Math.ceil(quoted.price/100));
  villageInput(f,'village-shares-orchard',1);await f.click(f.focusButton('village-shares-orchard-sell'));
  const sold=villageView(f).shops.find(x=>x.id==='orchard');assert.equal(sold.playerShares,19);assert.equal(sold.npcShares,1);assert.ok(Math.abs(sold.costBasis-(bought.costBasis-basis))<1e-8);
  assert.ok(Math.abs(sold.realizedProfit-(quoted.price-sellFee-basis))<1e-8);assert.equal(f.saved().coins,wallet+quoted.price-sellFee);assert.deepEqual(f.saved().market,before.market);f.ui.close();
});

test('a fully NPC-funded open shop still offers shares to a player with no previous investment, and failed purchase retains its draft',async()=>{
  const f=await marketVillageFixture();for(let i=0;i<11;i++)await nextVillageDay(f);
  const shop=villageView(f).shops.find(x=>x.id==='orchard');assert.equal(shop.status,'open');assert.equal(shop.playerShares,0);assert.equal(shop.npcShares,20);
  const raw=f.data.get(Core.KEY),writes=f.writes.length;villageInput(f,'village-buy-shares-orchard',2);f.control.outcome='false';await f.click(f.focusButton('village-buy-shares-orchard-buy'));
  assert.equal(f.data.get(Core.KEY),raw);assert.equal(f.writes.length,writes);assert.equal(f.focusButton('village-buy-shares-orchard').value,'2');
  f.control.outcome='ok';await f.click(f.focusButton('village-buy-shares-orchard-buy'));assert.equal(villageView(f).shops.find(x=>x.id==='orchard').playerShares,2);assert.equal(f.writes.length,writes+1);f.ui.close();
});

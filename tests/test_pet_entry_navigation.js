'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const scripts = Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g));
const byId = id => scripts.find(m => m[0].startsWith('<script id="' + id + '">'))?.[1];
const guard = byId('pet-entry-navigation'), loader = byId('independent-pet-loader');
const talk = scripts.find(m => m[1].includes('/* KN_TALK_TABS:'))?.[1];
const nav = scripts.find(m => m[1].includes('function go(sel)') && m[1].includes('has-bottom-nav'))?.[1];
const targetStart = html.indexOf("nav.querySelectorAll('.bn-item').forEach(function(btn){btn.addEventListener('click',function(){var act=");
const targetEnd = html.indexOf("var sb=document.getElementById('knShortsBtn');", targetStart);
assert.ok(guard && loader && talk && nav && targetStart >= 0 && targetEnd > targetStart, 'real navigation handlers found');
const targetCapture = html.slice(targetStart, targetEnd);

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function flush() { for (let i = 0; i < 32; i++) await Promise.resolve(); }
function classes(initial = []) { const set = new Set(initial); return { add: x => set.add(x), remove: x => set.delete(x), contains: x => set.has(x), values: () => [...set] }; }
class Element {
  constructor(tag = 'div', act) { this.tagName = tag.toUpperCase(); this.act = act; this.children = []; this.attributes = {}; this.classList = classes(); this.listeners = []; this._text = ''; this.style = {}; this.hidden = false; }
  get textContent() { return this._text + this.children.map(x => x.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k === 'data-act' ? this.act : this.attributes[k] ?? null; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(type, fn, capture = false) { this.listeners.push({ type, fn, capture }); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(x => x !== this); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  focus() { this.focused = true; }
  scrollIntoView() {}
  closest(selector) { return this.act && (!selector.includes('[data-act="pet"]') || this.act === 'pet') ? this : null; }
}

function fixture({ origin = 'morning', preloaded = true, hydration, mounting } = {}) {
  const body = new Element('body'); body.classList = classes(origin === 'morning' ? ['view-asaletter'] : []);
  const pane = new Element('section'), host = new Element(), sourceView = new Element(), pet = new Element('button', 'pet');
  pane.hidden = true; host.textContent = 'ゲームを開くと読み込みます。'; sourceView.classList.add('open');
  const buttons = [new Element('button', 'morning'), pet, new Element('button', 'mypage'), new Element('button', 'talk')];
  buttons.find(x => x.act === (origin === 'community' ? 'talk' : origin)).classList.add('active');
  const docs = [], windows = [], assets = [], timers = new Map(), commits = [], visibleRenders = [];
  let timerId = 0, mounts = 0, closes = 0, reloads = 0, communityCloses = 0, storageWrites = 0;
  const nodes = { 'sect-pet': pane, 'pet-game-root': host, 'morning-section': sourceView,
    myPageOv: origin === 'mypage' ? sourceView : new Element(), cmOv: origin === 'community' ? sourceView : null };
  const navEl = { querySelectorAll: () => buttons };
  const document = { body, activeElement: pet,
    createElement: tag => new Element(tag),
    addEventListener(type, fn, capture = false) { docs.push({ type, fn, capture: !!capture }); },
    getElementById(id) { return id === 'knBottomNav' ? navEl : nodes[id] || null; },
    querySelector(selector) { return selector.includes('[data-act="pet"]') ? pet : null; },
    head: { appendChild(script) { assets.push(script); } } };
  const window = { __knGateReady: hydration?.promise || Promise.resolve(true),
    __knReadGameStorage: () => 'saved-progress', __knPersistLocalSetting: async () => { storageWrites++; },
    location: { reload() { reloads++; } }, scrollTo() {},
    addEventListener(type, fn) { windows.push({ type, fn }); },
    KNCommunity: { close() { communityCloses++; if (origin === 'community') sourceView.classList.remove('open'); } },
    closeCommunity() { if (origin === 'community') sourceView.classList.remove('open'); } };
  const ui = {
    async mount(target) { mounts++; target.textContent = '記録を準備中'; const result = mounting ? await mounting.promise : true; target.textContent = result === false ? '記録を読み込めませんでした。' : '実ゲーム'; return result; },
    async close() { closes++; },
    render() { visibleRenders.push(!pane.hidden); }
  };
  if (preloaded) { window.PetVillageEconomy = {}; window.PetTownWalk = {}; window.PetVillageEconomyScene = {mount(){}}; window.PetGameCore = {}; window.PetCozyRoom = {mount(){}}; window.IndependentPetGame = ui; }
  const context = vm.createContext({ document, window, Promise, nav: navEl, ms: sourceView,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); } });
  function click(button) {
    document.activeElement = button;
    const event = { target: button, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    function fire(items) { for (const item of items) { if (event.stopped) break; item.fn(event); } }
    fire(docs.filter(x => x.type === 'click' && x.capture));
    fire(button.listeners.filter(x => x.type === 'click' && x.capture));
    fire(button.listeners.filter(x => x.type === 'click' && !x.capture));
    fire(docs.filter(x => x.type === 'click' && !x.capture));
    if (!event.defaultPrevented && button === pet) commits.push(host.textContent);
    return event;
  }
  buttons.forEach(b => { b.click = () => click(b); });
  vm.runInContext(guard, context);
  vm.runInContext(talk, context);
  vm.runInContext(nav, context);
  vm.runInContext(targetCapture, context);
  vm.runInContext(loader, context);
  return { window, context, pet, pane, host, sourceView, body, assets, ui, commits, visibleRenders,
    counts: () => ({ mounts, closes, reloads, communityCloses, storageWrites }),
    selected: () => buttons.filter(x => x.classList.contains('active')).map(x => x.act),
    click: act => click(buttons.find(x => x.act === act)),
    key(key) { for (const listener of docs.filter(x => x.type === 'keydown')) listener.fn({ key }); },
    pagehide() { windows.filter(x => x.type === 'pagehide').forEach(x => x.fn()); },
    async loadPrerequisites() {
      if(!window.PetVillageEconomy){window.PetVillageEconomy={};assets.findLast(x=>x.src.includes('/pet-village-economy.js')).onload();}
      if(!window.PetTownWalk){window.PetTownWalk={};assets.findLast(x=>x.src.includes('/pet-town-walk.js')).onload();}
      await flush();
      if(!window.PetVillageEconomyScene){window.PetVillageEconomyScene={mount(){}};assets.findLast(x=>x.src.includes('/pet-village-economy-scene.js')).onload();}
      await flush();
    },
    async loadAssets() {
      await this.loadPrerequisites();
      window.PetGameCore = {}; assets.findLast(x => x.src.includes('/pet-game-core.js')).onload();
      window.PetCozyRoom = {mount(){}}; assets.findLast(x => x.src.includes('/pet-cozy-room.js')).onload();
      window.PetLilacMotion = {}; assets.findLast(x => x.src.includes('/pet-lilac-motion.js')).onload();
      window.PetRoomBehavior = {}; assets.findLast(x => x.src.includes('/pet-room-behavior.js')).onload();
      await flush(); window.IndependentPetGame = ui; assets.findLast(x => x.src.includes('/pet-game.js')).onload(); await flush();
    },
    async failCore() { await this.loadPrerequisites(); assets.findLast(x => x.src.includes('/pet-game-core.js')).onerror(); },
    timer(delay) { for (const [id, item] of [...timers]) if (item.delay === delay) { timers.delete(id); item.fn(); } }
  };
}

test('guard is registered before legacy document and target handlers', () => {
  assert.ok(html.indexOf('<script id="pet-entry-navigation">') < html.indexOf('/* KN_TALK_TABS:'));
  assert.ok(html.indexOf('<script id="pet-entry-navigation">') < targetStart);
});
test('all previous routes remain visible through hydration and mount; only ready navigation commits once', async () => {
  for (const origin of ['morning', 'mypage', 'community']) {
    const hydration = deferred(), mounting = deferred(), f = fixture({ origin, hydration, mounting });
    f.click('pet'); const pending = f.window.openPetTab();
    assert.equal(f.pane.hidden, true); assert.equal(f.sourceView.classList.contains('open'), true);
    assert.deepEqual(f.selected(), [origin === 'community' ? 'talk' : origin]);
    assert.equal(f.counts().communityCloses, 0); assert.equal(f.pet.getAttribute('aria-busy'), 'true');
    assert.equal(f.body.classList.contains('view-asaletter'), origin === 'morning');
    hydration.resolve(true); await flush(); assert.equal(f.counts().mounts, 1); assert.equal(f.pane.hidden, true);
    assert.equal(f.host.textContent, '記録を準備中'); assert.deepEqual(f.commits, []);
    mounting.resolve(true); assert.equal(await pending, true);
    assert.equal(f.pane.hidden, false); assert.deepEqual(f.selected(), ['pet']); assert.deepEqual(f.commits, ['実ゲーム']);
    assert.deepEqual(f.visibleRenders, [true]); assert.equal(f.pet.getAttribute('aria-busy'), null);
    assert.equal(f.body.classList.contains('view-asaletter'), false); assert.equal(f.counts().storageWrites, 0);
  }
});
test('repeated taps share assets/mount and never replay navigation repeatedly', async () => {
  const mounting = deferred(), f = fixture({ preloaded: false, mounting });
  f.click('pet'); f.click('pet'); const pending = f.window.openPetTab(); assert.equal(f.assets.length, 5);
  await f.loadAssets(); assert.equal(f.counts().mounts, 1); assert.equal(f.pane.hidden, true);
  mounting.resolve(true); assert.equal(await pending, true); f.click('pet'); await flush();
  assert.equal(f.assets.length, 8); assert.equal(f.counts().mounts, 1); assert.deepEqual(f.commits, ['実ゲーム']);
});
test('other navigation cancels downloads; late assets cannot mount or steal the selected route', async () => {
  const f = fixture({ preloaded: false }); f.click('pet'); const pending = f.window.openPetTab();
  f.click('mypage'); await f.loadAssets(); assert.equal(await pending, false);
  assert.equal(f.counts().mounts, 0); assert.equal(f.pane.hidden, true); assert.deepEqual(f.selected(), ['mypage']);
  assert.deepEqual(f.commits, []); assert.equal(f.pet.getAttribute('aria-busy'), null);
});
test('Escape cancels hydration without changing the previous screen or focusing another control', async () => {
  const hydration = deferred(), f = fixture({ hydration, origin: 'community' });
  f.click('pet'); const pending = f.window.openPetTab(); f.key('Escape'); hydration.resolve(true);
  assert.equal(await pending, false); assert.equal(f.counts().mounts, 0); assert.equal(f.pane.hidden, true);
  assert.deepEqual(f.selected(), ['talk']); assert.equal(f.sourceView.classList.contains('open'), true);
  assert.equal(f.counts().communityCloses, 0); assert.deepEqual(f.commits, []); assert.equal(f.pet.focused, undefined);
});
test('leaving during mount suppresses stale completion and reopen shares only current generation', async () => {
  const mounting = deferred(), f = fixture({ mounting }); f.click('pet'); const old = f.window.openPetTab(); await flush();
  f.click('mypage'); const closed = f.counts().closes; f.click('pet'); const current = f.window.openPetTab(); await flush();
  mounting.resolve(true); assert.equal(await old, false); assert.equal(await current, true);
  assert.equal(f.counts().closes, closed); assert.deepEqual(f.commits, ['実ゲーム']); assert.equal(f.pane.hidden, false);
});
test('pagehide cancels a pending mount and a late failure never displays an error over the old route', async () => {
  const mounting = deferred(), f = fixture({ mounting }); f.click('pet'); const pending = f.window.openPetTab(); await flush();
  f.pagehide(); mounting.reject(new Error('private-storage-detail')); assert.equal(await pending, false);
  assert.equal(f.pane.hidden, true); assert.deepEqual(f.commits, []); assert.deepEqual(f.selected(), ['morning']);
  assert.doesNotMatch(f.host.textContent, /private-storage-detail/);
});
test('a real download failure commits a recoverable error once and manual retry reveals the game', async () => {
  const f = fixture({ preloaded: false }); f.click('pet'); const first = f.window.openPetTab();
  await f.failCore(); await flush(); f.timer(1200); await flush(); await f.failCore(); assert.equal(await first, false);
  assert.equal(f.pane.hidden, false); assert.match(f.host.textContent, /ゲームを読み込めませんでした/);
  assert.match(f.host.textContent, /もう一度読み込む/); assert.deepEqual(f.selected(), ['pet']); assert.equal(f.commits.length, 1);
  const retry = f.host.children[0].children.find(x => x.tagName === 'BUTTON'); retry.onclick(); const second = f.window.openPetTab();
  await f.loadAssets(); assert.equal(await second, true); assert.equal(f.host.textContent, '実ゲーム');
  assert.equal(f.counts().storageWrites, 0); assert.equal(f.counts().reloads, 0);
});
test('mount returning false reveals its storage recovery UI rather than waiting indefinitely', async () => {
  const mounting = deferred(), f = fixture({ mounting }); f.click('pet'); const pending = f.window.openPetTab(); await flush();
  mounting.resolve(false); assert.equal(await pending, false); assert.equal(f.pane.hidden, false);
  assert.deepEqual(f.commits, ['記録を読み込めませんでした。']); assert.equal(f.pet.getAttribute('aria-busy'), null);
});

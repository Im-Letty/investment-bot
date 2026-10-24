'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Town = require('../static/pet-town-walk.js');

function near(actual, expected, tolerance = .001) { assert.ok(Math.abs(actual - expected) <= tolerance, actual + ' differs from ' + expected); }
class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, values = {}) {
    const event = { target: this, preventDefault() { this.prevented = true; }, ...values };
    [...(this.listeners.get(type) || [])].forEach(fn => fn(event)); return event;
  }
  count() { return [...this.listeners.values()].reduce((total, rows) => total + rows.size, 0); }
}
class Element extends Events {
  constructor(doc, tag = 'DIV') { super(); this.ownerDocument = doc; this.tagName = tag; this.style = {}; this.attributes = {}; this.children = []; this.isConnected = true; this.hidden = false; this.disabled = false; this.captures = new Set(); }
  append(child) { child.parentNode = this; this.children.push(child); return child; }
  contains(child) { return child === this || this.children.some(item => item.contains(child)); }
  focus(options) { this.ownerDocument.activeElement = this; this.focusOptions = options; }
  getBoundingClientRect() { return { left: 10, top: 20, width: this.width || 390, height: this.height || 700 }; }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  setPointerCapture(id) { this.captures.add(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
}
function fixture(options = {}) {
  const win = new Events(), doc = new Events(), raf = new Map(), observed = [], positions = [], motions = [], entries = [];
  let sequence = 0, stamp = 0, allowed = true;
  doc.hidden = false; doc.defaultView = win;
  win.requestAnimationFrame = fn => { const id = ++sequence; raf.set(id, fn); return id; };
  win.cancelAnimationFrame = id => raf.delete(id);
  if (!options.noObserver) win.ResizeObserver = class {
    constructor(fn) { this.fn = fn; this.disconnected = false; observed.push(this); }
    observe(element) { this.element = element; }
    disconnect() { this.disconnected = true; }
  };
  const viewport = new Element(doc), surface = viewport.append(new Element(doc)), avatar = surface.append(new Element(doc));
  const enter = new Element(doc, 'BUTTON'), buttons = [];
  const controls = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]].map(([x, y]) => {
    const element = new Element(doc, 'BUTTON'); buttons.push(element); return { element, x, y };
  });
  doc.activeElement = viewport;
  const world = options.world || Town.createWorld();
  const controller = Town.mount({ viewport, worldElement: surface, avatar, enterButton: options.noEnter ? null : enter, world,
    position: options.position || { x: 1100, y: 1100 }, controls, canRun: () => allowed, enterableIds: options.enterableIds,
    doorEntry: options.doorEntry, onPosition: p => positions.push(p), onMotion: m => motions.push(m), onEnter: id => { entries.push(id); if (options.onEnter) options.onEnter(id); },
    resolveTap: options.resolveTap, projectDirection: options.projectDirection, onDraw: options.onDraw });
  function frame(ms = 50) { stamp += ms; const calls = [...raf.values()]; raf.clear(); calls.forEach(fn => fn(stamp)); }
  function advance(count, ms = 50) { for (let i = 0; i < count; i++) frame(ms); }
  function settle(limit = 1200) { for (let i = 0; raf.size && i < limit; i++) frame(); assert.equal(raf.size, 0, 'movement must reach or safely stop in a bounded number of frames'); }
  return { win, doc, world, viewport, surface, avatar, enter, buttons, controls, controller, raf, observed, positions, motions, entries,
    frame, advance, settle, allow(value) { allowed = value; }, key(key, type = 'keydown', values = {}) { return win.emit(type, { target: doc.activeElement, key, ...values }); } };
}

test('approach and intentional door travel clear clipped-world DOM scrolling without making an ordinary approach enter', () => {
  const f = fixture({ doorEntry: true, noEnter: true }), nativeFocus = f.viewport.focus.bind(f.viewport);
  // A real browser may scroll an overflow-hidden ancestor while focusing its
  // offscreen semantic landmark. World travel uses transforms instead.
  f.viewport.focus = options => { nativeFocus(options); f.viewport.scrollLeft = 245; f.viewport.scrollTop = 212; };
  f.viewport.scrollLeft = 100; f.viewport.scrollTop = 80;
  assert.equal(f.controller.approach('shop'), true);
  assert.equal(f.viewport.scrollLeft, 0); assert.equal(f.viewport.scrollTop, 0); assert.deepEqual(f.viewport.focusOptions, { preventScroll: true });
  f.settle(); assert.deepEqual(f.entries, []); const shop = f.world.places.find(p => p.id === 'shop');
  near(f.controller.position().x, shop.entrance.x); near(f.controller.position().y, shop.entrance.y);
  f.viewport.scrollLeft = 245; f.viewport.scrollTop = 212;
  assert.equal(f.controller.enterDoor('shop'), true);
  assert.equal(f.viewport.scrollLeft, 0); assert.equal(f.viewport.scrollTop, 0);
  f.settle(); assert.deepEqual(f.entries, ['shop']); assert.equal(f.raf.size, 0); f.controller.destroy();
});

test('an optional scene projects input into the same collision and explicit entry rules without teleporting',()=>{
  let target={x:1200,y:1100},draws=0;const f=fixture({resolveTap:()=>target,projectDirection:(x,y)=>({x:-y,y:x}),onDraw:()=>draws++});
  const before=f.controller.position();f.viewport.emit('pointerdown',{pointerId:1,clientX:100,clientY:100});f.viewport.emit('pointerup',{pointerId:1,clientX:100,clientY:100});assert.deepEqual(f.controller.position(),before);f.settle();near(f.controller.position().x,1200);
  f.key('ArrowUp');f.advance(4);f.key('ArrowUp','keyup');assert.ok(f.controller.position().x>1200);assert.ok(draws>4);
  target={placeId:'shop'};f.viewport.emit('pointerdown',{pointerId:2,clientX:100,clientY:100});f.viewport.emit('pointerup',{pointerId:2,clientX:100,clientY:100});f.settle();assert.equal(f.entries.length,0);assert.equal(f.enter.hidden,false);f.enter.emit('click');assert.deepEqual(f.entries,['shop']);
  target=null;f.viewport.emit('pointerdown',{pointerId:3,clientX:100,clientY:100});f.viewport.emit('pointerup',{pointerId:3,clientX:100,clientY:100});assert.equal(f.raf.size,0);f.controller.destroy();
});

test('world projections use the six saved places and safe display bands without rewriting the saved layout', () => {
  const layout = { version: 1, theme: 'cafe', items: [
    { id: 'home', x: 0, y: 0 }, { id: 'cafe', x: 100, y: 100 }, { id: 'tree', x: 100, y: 100 }, { id: 'flowers', x: 0, y: 0 }
  ] }, original = JSON.stringify(layout), world = Town.createWorld(layout);
  assert.equal(world.width, 2880); assert.equal(world.height, 1920); assert.equal(world.places.length, 6);
  assert.equal(JSON.stringify(layout), original);
  const home = world.places.find(p => p.id === 'home'), cafe = world.places.find(p => p.id === 'cafe'), tree = world.places.find(p => p.id === 'tree'), flowers = world.places.find(p => p.id === 'flowers');
  near(home.x, 432); near(home.y, 422.4); near(cafe.y, 1497.6); near(tree.y, 1612.8); near(flowers.y, 307.2);
  assert.ok(cafe.x < 2880 * .85, 'unsafe saved bank positions are projected inland only for display');
  for (const place of world.places) { near(place.entrance.x, place.x); near(place.entrance.y, place.y + 70); assert.ok(place.footprint.y < place.y); }
});

test('river collision respects the near bank and the single bounded bridge corridor', () => {
  const world = Town.createWorld(); world.places = [];
  assert.equal(Town.isWalkable(world, 2200, 1500), true);
  assert.equal(Town.isWalkable(world, 2650, 1500), false);
  assert.equal(Town.isWalkable(world, 2770, 1160), true);
  assert.equal(Town.isWalkable(world, 2770, 1060), false);
  assert.equal(Town.isWalkable(world, 2820, 1160), false);
  assert.equal(Town.isWalkable(world, -1, 500), false);
  assert.equal(Town.isWalkable(world, 500, NaN), false);
});

test('substeps prevent crossing a building or the river even for a large displacement', () => {
  const world = Town.createWorld(), home = world.places[0].footprint;
  const start = { x: home.x - 300, y: home.y }, end = Town.move(world, start, 600, 0);
  assert.ok(Town.isWalkable(world, start.x, start.y)); assert.ok(Town.isWalkable(world, end.x, end.y));
  assert.ok(end.x < home.x - home.rx, 'the far side must not be reached through the footprint');
  const empty = Town.createWorld(); empty.places = [];
  const shore = Town.move(empty, { x: 2000, y: 1500 }, 800, 0);
  assert.ok(shore.x < 2500); assert.ok(Town.isWalkable(empty, shore.x, shore.y));
});

test('a cached position is accepted only on valid walkable ground and copies cannot mutate engine spawn state', () => {
  const world = Town.createWorld(), home = world.places[0];
  const safe = { x: 1000, y: 1000 }, recovered = Town.spawn(world, safe); assert.deepEqual(recovered, safe); recovered.x = 0; assert.equal(safe.x, 1000);
  for (const unsafe of [{ x: NaN, y: 0 }, { x: 2700, y: 1600 }, { x: home.footprint.x, y: home.footprint.y }]) {
    const result = Town.spawn(world, unsafe); assert.ok(Town.isWalkable(world, result.x, result.y)); assert.notDeepEqual(result, unsafe);
  }
});

test('only four facilities can be entered, using their entrance within 110 pixels', () => {
  const world = Town.createWorld(), cafe = world.places.find(p => p.id === 'cafe'), tree = world.places.find(p => p.id === 'tree');
  assert.equal(Town.nearestFacility(world, { x: cafe.entrance.x, y: cafe.entrance.y + 109 }).id, 'cafe');
  assert.equal(Town.nearestFacility(world, { x: cafe.entrance.x, y: cafe.entrance.y + 111 }), null);
  assert.equal(Town.nearestFacility(world, tree.entrance), null);
});

test('camera follows the player at its anchor, clamps to the world and never fits the whole map', () => {
  const world = Town.createWorld(), position = { x: 1500, y: 1100 }, c = Town.camera(world, 390, 700, position);
  near((position.x - c.x) * c.scale, 390 * .5); near((position.y - c.y) * c.scale, 700 * .58);
  for (const size of [[390, 700], [1440, 900], [320, 240]]) {
    const at = Town.camera(world, ...size, { x: 2870, y: 1910 });
    assert.ok(size[0] / at.scale <= 960); assert.ok(size[1] / at.scale <= 800);
    assert.ok(at.x >= 0 && at.x + size[0] / at.scale <= world.width + .001); assert.ok(at.y >= 0 && at.y + size[1] / at.scale <= world.height + .001);
  }
});

test('short portrait and landscape cameras keep the player above the lower direction pad while respecting world bounds', () => {
  const world = Town.createWorld(), position = { x: 1500, y: 1100 };
  for (const [width, height] of [[320, 480], [640, 360], [844, 390]]) {
    const c = Town.camera(world, width, height, position);
    near((position.x - c.x) * c.scale, width * .5); near((position.y - c.y) * c.scale, height * .45);
    if (height === 480) near((position.y - c.y) * c.scale, 216);
    for (const corner of [{ x: 28, y: 28 }, { x: world.width - 28, y: world.height - 28 }]) {
      const edge = Town.camera(world, width, height, corner);
      assert.ok(edge.x >= 0 && edge.x + width / edge.scale <= world.width + .001);
      assert.ok(edge.y >= 0 && edge.y + height / edge.scale <= world.height + .001);
      assert.ok((corner.y - edge.y) * edge.scale >= 0 && (corner.y - edge.y) * edge.scale <= height);
    }
  }
});

test('idle and resizing create no continuous animation or position writes, and avatar depth follows its feet', () => {
  const f = fixture(); assert.equal(f.raf.size, 0); assert.equal(f.positions.length, 0); assert.equal(f.avatar.style.zIndex, '1100');
  const initial = f.surface.style.transform; f.viewport.width = 700; f.observed[0].fn();
  assert.notEqual(f.surface.style.transform, initial); assert.equal(f.raf.size, 0); assert.equal(f.positions.length, 0);
  f.controller.destroy(); assert.equal(f.observed[0].disconnected, true);
});

test('continuous movement uses 200 pixels per second, equal diagonal speed and a 50ms maximum step', () => {
  for (const diagonal of [false, true]) {
    const f = fixture(), start = f.controller.position(); f.key('ArrowRight'); if (diagonal) f.key('ArrowDown');
    f.frame(); f.advance(20);
    const end = f.controller.position(); near(Math.hypot(end.x - start.x, end.y - start.y), 200);
    assert.equal(f.positions.length, 20); assert.equal(f.motions.filter(m => m.walking).length, 20, 'the renderer receives every actual walking frame');
    f.key('ArrowRight', 'keyup'); if (diagonal) f.key('ArrowDown', 'keyup');
    assert.equal(f.raf.size, 0); assert.equal(f.motions.at(-1).walking, false); f.controller.destroy();
  }
  const f = fixture(), start = f.controller.position(); f.key('d'); f.frame(); f.frame(5000);
  near(f.controller.position().x - start.x, 10); f.controller.destroy();
});

test('keyboard input stays inside the focused town and never takes text-entry or modifier keys', () => {
  const f = fixture(), outside = new Element(f.doc); f.doc.activeElement = outside;
  assert.equal(f.key('ArrowRight').prevented, undefined); assert.equal(f.raf.size, 0);
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
    f.doc.activeElement = f.viewport.append(new Element(f.doc, tag));
    assert.equal(f.key('w').prevented, undefined); assert.equal(f.raf.size, 0);
  }
  const editable = f.viewport.append(new Element(f.doc)); editable.isContentEditable = true; f.doc.activeElement = editable;
  assert.equal(f.key('s').prevented, undefined); f.doc.activeElement = f.viewport;
  assert.equal(f.key('a', 'keydown', { ctrlKey: true }).prevented, undefined);
  assert.equal(f.key('A').prevented, true); f.frame(); f.frame(); assert.ok(f.controller.position().x < 1100);
  f.viewport.emit('focusout', { relatedTarget: outside }); assert.equal(f.raf.size, 0); assert.equal(f.motions.at(-1).walking, false); f.controller.destroy();
});

test('Dpad holds capture their pointer, release immediately and suppress the resulting pointer click', () => {
  const f = fixture(), east = f.buttons[0], start = f.controller.position();
  east.emit('pointerdown', { pointerId: 7, button: 0 }); assert.equal(east.captures.has(7), true); assert.deepEqual(f.viewport.focusOptions, { preventScroll: true });
  f.frame(); f.advance(4); near(f.controller.position().x - start.x, 40);
  f.win.emit('pointerup', { pointerId: 7 }); assert.equal(east.captures.has(7), false); assert.equal(f.raf.size, 0);
  east.emit('click', { detail: 1 }); assert.equal(f.raf.size, 0); near(f.controller.position().x - start.x, 40);
  east.emit('click', { detail: 0 }); assert.ok(f.raf.size); f.settle(); near(f.controller.position().x - start.x, 88); f.controller.destroy();
});

test('assistive diagonal button activation walks a normalized small step without teleporting', () => {
  const f = fixture(), start = f.controller.position(); f.buttons[1].emit('click', { detail: 0 }); assert.deepEqual(f.controller.position(), start);
  f.settle(); const end = f.controller.position(); near(Math.hypot(end.x - start.x, end.y - start.y), 48); assert.equal(f.entries.length, 0); f.controller.destroy();
});

test('facility approach walks around footprints from home to shop to cafe, never entering automatically', () => {
  const world = Town.createWorld(), f = fixture({ world, position: world.spawn });
  for (const id of ['shop', 'cafe']) {
    const before = f.controller.position(), place = world.places.find(p => p.id === id), path = Town.route(world, before, place.entrance);
    assert.ok(path && path.length); assert.equal(f.controller.approach(id), true); assert.deepEqual(f.controller.position(), before);
    f.settle(); near(f.controller.position().x, place.entrance.x, 1); near(f.controller.position().y, place.entrance.y, 1);
    assert.equal(f.enter.hidden, false); assert.equal(f.enter.textContent, place.label + 'に入る'); assert.equal(f.entries.length, 0);
    assert.ok(f.positions.every(p => Town.isWalkable(world, p.x, p.y)));
  }
  f.enter.emit('click'); assert.deepEqual(f.entries, ['cafe']); f.controller.destroy();
});

test('flora can be approached but do not invent an enterable facility', () => {
  const f = fixture(); assert.equal(f.controller.approach('flowers'), true); f.settle();
  const flowers = f.world.places.find(p => p.id === 'flowers'); near(f.controller.position().x, flowers.entrance.x, 1); near(f.controller.position().y, flowers.entrance.y, 1);
  assert.equal(f.enter.hidden, true); assert.equal(f.enter.disabled, true); f.enter.emit('click'); assert.deepEqual(f.entries, []); f.controller.destroy();
});

test('overlapping saved placements with a blocked entrance reject approach without snapping or entering', () => {
  const world = Town.createWorld(), home = world.places[0], cafe = world.places[1];
  cafe.entrance = { x: home.footprint.x, y: home.footprint.y };
  const f = fixture({ world }); const before = f.controller.position();
  assert.equal(f.controller.approach('cafe'), false); assert.deepEqual(f.controller.position(), before); assert.equal(f.raf.size, 0); assert.deepEqual(f.entries, []); f.controller.destroy();
});

test('ground taps walk their vector, ignore drags and controls, and do not auto-enter', () => {
  const f = fixture(), start = f.controller.position(), c = Town.camera(f.world, 390, 700, start), box = f.viewport.getBoundingClientRect();
  const event = { pointerId: 1, button: 0, target: f.surface, clientX: box.left + (start.x + 80 - c.x) * c.scale, clientY: box.top + (start.y - c.y) * c.scale };
  f.viewport.emit('pointerdown', event); f.viewport.emit('pointerup', event); assert.deepEqual(f.controller.position(), start); f.settle(); near(f.controller.position().x, start.x + 80, 1);
  const after = f.controller.position(); f.viewport.emit('pointerdown', event); f.viewport.emit('pointerup', { ...event, clientX: event.clientX + 40 }); assert.equal(f.raf.size, 0);
  const button = f.viewport.append(new Element(f.doc, 'BUTTON')); f.viewport.emit('pointerdown', { ...event, target: button }); f.viewport.emit('pointerup', { ...event, target: button }); assert.equal(f.raf.size, 0); assert.deepEqual(f.controller.position(), after); assert.deepEqual(f.entries, []); f.controller.destroy();
});

for (const reason of ['blur', 'pagehide', 'visibility', 'pointercancel', 'lostcapture']) test(reason + ' stops movement and does not restart it on resume', () => {
  const f = fixture(), button = f.buttons[0]; button.emit('pointerdown', { pointerId: 3, button: 0 }); f.frame(); f.frame();
  if (reason === 'visibility') { f.doc.hidden = true; f.doc.emit('visibilitychange'); }
  else if (reason === 'pointercancel') f.win.emit('pointercancel', { pointerId: 3 });
  else if (reason === 'lostcapture') button.emit('lostpointercapture', { pointerId: 3 });
  else f.win.emit(reason);
  const stopped = f.controller.position(); assert.equal(f.raf.size, 0); assert.equal(f.motions.at(-1).walking, false);
  f.doc.hidden = false; f.doc.emit('visibilitychange'); f.advance(20); assert.deepEqual(f.controller.position(), stopped); f.controller.destroy();
});

test('a detached button or denied host cannot enter, and destroying removes pending frames, observers and every listener', () => {
  const world = Town.createWorld(), home = world.places[0], f = fixture({ world, position: home.entrance });
  const staleEnter = [...f.enter.listeners.get('click')][0], observer = f.observed[0];
  f.enter.isConnected = false; staleEnter({}); assert.deepEqual(f.entries, []); f.enter.isConnected = true; f.allow(false); staleEnter({}); assert.deepEqual(f.entries, []);
  f.allow(true); f.key('ArrowRight'); const staleFrame = [...f.raf.values()][0]; f.controller.destroy();
  const position = f.controller.position(), count = f.positions.length, motions = f.motions.length;
  staleFrame(10000); staleEnter({}); observer.fn(); f.key('ArrowRight'); f.buttons[0].emit('click', { detail: 0 });
  assert.deepEqual(f.controller.position(), position); assert.equal(f.positions.length, count); assert.equal(f.motions.length, motions); assert.deepEqual(f.entries, []); assert.equal(f.raf.size, 0); assert.equal(observer.disconnected, true);
  for (const target of [f.win, f.doc, f.viewport, f.enter, ...f.buttons]) assert.equal(target.count(), 0);
  assert.equal(f.controller.approach('home'), false);
});

test('the resize-event fallback also cleans up, and a lost canRun lease stops its pending frame', () => {
  const f = fixture({ noObserver: true }); f.key('ArrowRight'); f.frame(); f.frame(); const position = f.controller.position();
  f.allow(false); f.frame(); assert.equal(f.raf.size, 0); assert.deepEqual(f.controller.position(), position); assert.equal(f.motions.at(-1).walking, false);
  f.controller.destroy(); assert.equal(f.win.count(), 0);
});

test('main UI can limit entry to home and shop while former minigame places remain scenery',()=>{
  const world=Town.createWorld(),cafe=world.places.find(p=>p.id==='cafe'),allowed=['home','shop'];
  const f=fixture({world,position:cafe.entrance,enterableIds:allowed});assert.equal(f.enter.hidden,true);
  allowed.push('cafe');f.observed[0].fn();assert.equal(f.enter.hidden,true,'a later caller mutation cannot restore a removed entrance');
  f.enter.hidden=false;f.enter.disabled=false;f.enter.emit('click');assert.deepEqual(f.entries,[],'stale/forged former entry is inert');
  assert.equal(f.controller.approach('shop'),true);f.settle();assert.equal(f.enter.hidden,false);f.enter.emit('click');assert.deepEqual(f.entries,['shop']);f.controller.destroy();
});

function frontContact(place) { return { x: place.footprint.x, y: place.footprint.y + place.footprint.ry + 19 }; }
function doorFixture(options = {}) {
  const world = options.world || Town.createWorld(), home = world.places.find(p => p.id === 'home');
  const f = fixture({ doorEntry: true, noEnter: true, enterableIds: ['home', 'shop', 'cafe'], world, position: frontContact(home), ...options });
  return f;
}

test('door mode requires genuine sustained inward contact, stops input before entry and latches a held key', () => {
  const f = doorFixture(), start = f.controller.position(), home = f.world.places[0];
  assert.equal(Town.isWalkable(f.world, start.x, start.y), true);
  assert.equal(Town.isWalkable(f.world, start.x, start.y - 8), false, 'the test touches the real building collision');
  f.key('ArrowUp'); f.frame(); f.advance(5);
  assert.deepEqual(f.entries, [], '250ms of pressure is not yet a deliberate entry');
  assert.equal(f.raf.size, 1, 'contact keeps only one bounded movement frame');
  f.frame(); assert.deepEqual(f.entries, ['home']);
  assert.equal(f.raf.size, 0); assert.equal(f.motions.at(-1).walking, false);
  assert.deepEqual(f.controller.position(), start, 'the player does not teleport through the wall');
  assert.equal(f.key('ArrowUp', 'keydown', { repeat: true }).prevented, true); f.advance(30);
  assert.deepEqual(f.entries, ['home']); assert.equal(f.raf.size, 0);
  f.key('ArrowUp', 'keyup'); f.key('ArrowUp'); f.frame(); f.advance(6);
  assert.deepEqual(f.entries, ['home', 'home'], 'a new released-and-pressed intent can enter again if navigation was not mounted');
  assert.equal(home.id, 'home'); f.controller.destroy();
});

test('door entry is opt-in and cannot expose or forge the old nearby button', () => {
  const world = Town.createWorld(), home = world.places[0], f = fixture({ world, position: home.entrance, doorEntry: true });
  assert.equal(f.enter.hidden, true); assert.equal(f.enter.disabled, true);
  f.enter.hidden = false; f.enter.disabled = false; f.enter.emit('click');
  assert.deepEqual(f.entries, []); f.controller.destroy();
  const legacy = fixture({ world, position: frontContact(home) });
  assert.equal(legacy.controller.enterDoor('home'), false); legacy.key('ArrowUp'); legacy.advance(40);
  assert.deepEqual(legacy.entries, []); assert.equal(legacy.raf.size, 0); legacy.controller.destroy();
});

test('nearby, sideways, backside and unimplemented-building contact cannot open a door', () => {
  const world = Town.createWorld(), home = world.places[0], f = doorFixture({ world, position: home.entrance });
  f.advance(100); assert.deepEqual(f.entries, []); assert.equal(f.raf.size, 0);
  f.controller.destroy();
  for (const [position, key] of [
    [{ x: home.footprint.x + home.footprint.rx + 19, y: home.footprint.y }, 'ArrowLeft'],
    [{ x: home.footprint.x, y: home.footprint.y - home.footprint.ry - 19 }, 'ArrowDown'],
    [frontContact(home), 'ArrowRight']
  ]) {
    const side = doorFixture({ world, position }); side.key(key); side.advance(40);
    assert.deepEqual(side.entries, []); side.controller.destroy();
  }
  const cafe = world.places.find(p => p.id === 'cafe'), allowed = ['home', 'shop'];
  const limited = doorFixture({ world, position: frontContact(cafe), enterableIds: allowed });
  allowed.push('cafe'); limited.key('ArrowUp'); limited.advance(40);
  assert.deepEqual(limited.entries, []); assert.equal(limited.controller.enterDoor('cafe'), false);
  assert.equal(limited.controller.enterDoor('flowers'), false); assert.equal(limited.controller.enterDoor('playground'), false);
  assert.equal(limited.controller.enterDoor('economy-tea'), false); limited.controller.destroy();
});

test('an explicit door intent walks around saved footprints, then pushes and enters once without a button', () => {
  const world = Town.createWorld(), before = JSON.stringify(world), start = { ...world.spawn }, f = doorFixture({ world, position: start });
  assert.equal(f.controller.enterDoor('shop'), true); assert.equal(f.controller.enterDoor('shop'), true, 'the same in-flight phone request is not restarted');
  assert.deepEqual(f.controller.position(), start); assert.deepEqual(f.entries, []);
  f.settle(); assert.deepEqual(f.entries, ['shop']); assert.equal(f.raf.size, 0);
  assert.ok(f.positions.length > 20, 'the route actually walked across the village');
  assert.ok(f.positions.every(p => Town.isWalkable(world, p.x, p.y)));
  assert.equal(JSON.stringify(world), before); assert.equal(f.motions.at(-1).walking, false);
  assert.equal(f.controller.enterDoor('shop'), false, 'a stale completed request cannot re-enter without a new user gesture');
  f.controller.destroy();
});

test('ordinary approach, roof taps and ground taps never acquire door intent', () => {
  let target = { placeId: 'home' };
  const f = doorFixture({ position: { x: 1100, y: 1100 }, resolveTap: () => target });
  f.viewport.emit('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
  f.viewport.emit('pointerup', { pointerId: 1, clientX: 100, clientY: 100 }); f.settle();
  assert.deepEqual(f.entries, []); near(f.controller.position().y, f.world.places[0].entrance.y, 1);
  target = frontContact(f.world.places[0]); target.y += .25;
  f.viewport.emit('pointerdown', { pointerId: 2, button: 0, clientX: 100, clientY: 100 });
  f.viewport.emit('pointerup', { pointerId: 2, clientX: 100, clientY: 100 }); f.settle();
  assert.deepEqual(f.entries, []); assert.equal(f.raf.size, 0);
  target = { placeId: 'home', door: true };
  f.viewport.emit('pointerdown', { pointerId: 3, button: 0, clientX: 100, clientY: 100 });
  f.viewport.emit('pointerup', { pointerId: 3, clientX: 100, clientY: 100 }); f.settle();
  assert.deepEqual(f.entries, ['home']); f.controller.destroy();
});

test('door contact follows projected world movement and caps dwell elapsed rather than using a suspended wall clock', () => {
  const f = doorFixture({ projectDirection: (x, y) => ({ x: -y, y: x }) });
  f.key('ArrowLeft'); f.frame(); f.frame(5000);
  assert.deepEqual(f.entries, [], 'one delayed frame counts at most 50ms');
  f.advance(4); assert.deepEqual(f.entries, []); f.frame(); assert.deepEqual(f.entries, ['home']);
  f.controller.destroy();
});

for (const reason of ['blur', 'pagehide', 'visibility', 'pointercancel', 'focusout', 'stop', 'destroy', 'denied', 'detached', 'release', 'away']) test('door pressure cannot survive ' + reason, () => {
  const f = doorFixture(); f.key('ArrowUp'); f.frame(); f.advance(5); assert.deepEqual(f.entries, []);
  const stale = [...f.raf.values()][0];
  if (reason === 'visibility') { f.doc.hidden = true; f.doc.emit('visibilitychange'); }
  else if (reason === 'pointercancel') f.win.emit('pointercancel', { pointerId: 99 });
  else if (reason === 'focusout') f.viewport.emit('focusout', { relatedTarget: new Element(f.doc) });
  else if (reason === 'stop' || reason === 'destroy') f.controller[reason]();
  else if (reason === 'denied') { f.allow(false); f.frame(); }
  else if (reason === 'detached') { f.viewport.isConnected = false; f.frame(); }
  else if (reason === 'release') f.key('ArrowUp', 'keyup');
  else if (reason === 'away') { f.key('ArrowDown'); f.key('ArrowUp', 'keyup'); }
  else f.win.emit(reason);
  if (reason !== 'away') assert.equal(f.raf.size, 0);
  f.doc.hidden = false; f.allow(true); f.viewport.isConnected = true;
  if (stale) stale(10000); f.advance(30);
  assert.deepEqual(f.entries, []); f.controller.destroy();
});

test('a canceled phone door route and a lost held pointer cannot finish an old entry', () => {
  const f = doorFixture({ position: { x: 1100, y: 1100 } });
  assert.equal(f.controller.enterDoor('shop'), true); f.advance(4); f.win.emit('pointercancel', { pointerId: 100 });
  f.advance(1200); assert.deepEqual(f.entries, []); assert.equal(f.raf.size, 0); f.controller.destroy();
  const p = doorFixture(), north = p.buttons[6]; north.emit('pointerdown', { pointerId: 7, button: 0 }); p.frame(); p.advance(5);
  north.emit('lostpointercapture', { pointerId: 7 }); p.advance(30);
  assert.deepEqual(p.entries, []); assert.equal(p.raf.size, 0); p.controller.destroy();
});

test('an occluded, invalid or changed door safely refuses the route and cannot mutate the world', () => {
  const world = Town.createWorld(), home = world.places[0], cafe = world.places[1];
  cafe.footprint = { x: home.entrance.x, y: home.entrance.y - 10, rx: 38, ry: 38 };
  const f = doorFixture({ world, position: { x: 1100, y: 1100 } }), before = JSON.stringify(world);
  assert.equal(f.controller.enterDoor('home'), false); assert.equal(f.raf.size, 0); assert.deepEqual(f.entries, []); assert.equal(JSON.stringify(world), before);
  assert.equal(f.controller.enterDoor(null), false); assert.equal(f.controller.enterDoor('missing'), false);
  f.controller.destroy();
  const changed = doorFixture({ position: { x: 1100, y: 1100 } }); assert.equal(changed.controller.enterDoor('shop'), true);
  changed.world.places = changed.world.places.filter(p => p.id !== 'shop'); changed.frame();
  assert.deepEqual(changed.entries, []); assert.equal(changed.raf.size, 0); changed.controller.destroy();
});

test('synchronous entry navigation may destroy its old controller without resurrecting movement or re-entering', () => {
  let f; f = doorFixture({ onEnter: () => { assert.equal(f.raf.size, 0); assert.equal(f.motions.at(-1).walking, false); f.controller.destroy(); } });
  f.key('ArrowUp'); f.frame(); f.advance(6); assert.deepEqual(f.entries, ['home']);
  f.advance(1000); assert.equal(f.raf.size, 0); assert.equal(f.controller.enterDoor('home'), false);
  assert.equal(f.viewport.count() + f.win.count() + f.doc.count(), 0);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/market-carousel.js'), 'utf8');

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
  }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  fire(name, event = {}) { for (const fn of [...(this.listeners.get(name) || [])]) fn(event); }
  listenerCount() { return [...this.listeners.values()].reduce((total, group) => total + group.size, 0); }
}

class Element extends Events {
  constructor(tag = 'div') {
    super();
    this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null;
    this.attributes = new Map(); this.className = ''; this.innerHTML = ''; this.title = '';
    this.style = {
      setProperty(name, value) { this[name] = String(value); },
      getPropertyValue(name) { return this[name] || ''; },
      removeProperty(name) { delete this[name]; }
    };
    const names = () => new Set(this.className.split(/\s+/).filter(Boolean));
    this.classList = {
      contains: name => names().has(name),
      toggle: (name, force) => {
        const current = names(), add = force === undefined ? !current.has(name) : force;
        if (add) current.add(name); else current.delete(name);
        this.className = [...current].join(' '); return add;
      },
      remove: (...items) => { const current = names(); items.forEach(name => current.delete(name)); this.className = [...current].join(' '); }
    };
  }
  get firstChild() { return this.children[0] || null; }
  getBoundingClientRect() { return { left: this.parentNode?.measureChildLeft?.(this) ?? 0 }; }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, before) {
    node.remove();
    const index = before === null ? this.children.length : this.children.indexOf(before);
    assert.notEqual(index, -1, 'insertBefore requires a child of this parent');
    this.children.splice(index, 0, node); node.parentNode = this; return node;
  }
  remove() {
    if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
  replaceChildren(...nodes) { [...this.children].forEach(node => node.remove()); nodes.forEach(node => this.appendChild(node)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  querySelector(selector) {
    for (const child of this.children) {
      if (selector[0] === '.' && child.classList.contains(selector.slice(1))) return child;
      const nested = child.querySelector(selector); if (nested) return nested;
    }
    return null;
  }
  cloneNode(deep) {
    const node = new Element(this.tagName);
    node.className = this.className; node.innerHTML = this.innerHTML; node.title = this.title;
    this.attributes.forEach((value, name) => node.setAttribute(name, value));
    if (deep) this.children.forEach(child => node.appendChild(child.cloneNode(true)));
    return node;
  }
}

function harness({ count = 4, mobile = true, reduced = false, priceWidth = 80, supported = true } = {}) {
  let width = mobile ? 390 : 1000;
  const animations = [], intersections = [], resizes = [];
  const section = new Element('section'), controls = new Element(), grid = new Element();
  section.appendChild(controls); section.appendChild(grid);
  const columns = () => Number(grid.style['--kn-market-columns'] || 3);
  grid.measureChildLeft = card => grid.children.indexOf(card) * width / columns();
  if (supported) grid.animate = (frames, options) => {
    const a = {
      frames, options, currentTime: null, playState: 'running',
      play() { this.playState = 'running'; },
      pause() { this.playState = 'paused'; },
      cancel() { this.playState = 'idle'; }
    };
    animations.push(a);
    return a;
  };
  function makeCard(id) {
    const card = new Element(), price = new Element();
    card.className = 'kn-a-quote'; card.title = id; card.innerHTML = id + ': 100.00 (+1.00, +1.00%)';
    price.className = 'kn-a-quote-value'; price.scrollWidth = priceWidth;
    Object.defineProperty(price, 'clientWidth', { get: () => width / columns() - 12 });
    card.appendChild(price); return card;
  }
  grid.replaceChildren(...Array.from({ length: count }, (_, i) => makeCard(String.fromCharCode(65 + i))));
  const document = new Events();
  document.hidden = false; document.documentElement = { lang: 'ja' };
  document.createElement = tag => new Element(tag);
  const phoneQuery = new Events(), motionQuery = new Events();
  phoneQuery.matches = mobile; motionQuery.matches = reduced;
  const window = new Events();
  window.matchMedia = query => query.includes('max-width') ? phoneQuery : motionQuery;
  class IntersectionObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; intersections.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; resizes.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  window.IntersectionObserver = IntersectionObserver; window.ResizeObserver = ResizeObserver;
  vm.runInNewContext(source, { window, document, IntersectionObserver, ResizeObserver,
    localStorage: { getItem: () => null } });
  const controller = window.KNMarketCarousel.mount({ grid, controls, section });
  const viewport = grid.parentNode, button = controls.firstChild;
  const originals = () => grid.children.filter(card => !card.hasAttribute('data-kn-market-clone'));
  const clones = () => grid.children.filter(card => card.hasAttribute('data-kn-market-clone'));
  const runningAnimations = () => animations.filter(a => a.playState !== 'idle');
  return { grid, section, viewport, button, document, window, controller, animations, intersections, resizes,
    phoneQuery, motionQuery, originals, clones, columns, runningAnimations,
    animation: () => runningAnimations()[0],
    click: () => button.fire('click'), tap: () => viewport.fire('click'),
    replace(ids) { grid.replaceChildren(...ids.map(id => makeCard(id))); controller.sync(); },
    reduced(value) { motionQuery.matches = value; motionQuery.fire('change'); },
    hidden(value) { document.hidden = value; document.fire('visibilitychange'); },
    visible(value) { intersections[0].callback([{ isIntersecting: value }]); },
    resize(value) { width = value; resizes[0].callback([{ contentRect: { width } }]); }
  };
}

test('mobile and desktop move left by one whole set at a constant speed', () => {
  for (const [count, mobile, expectedColumns] of [[2,true,2],[4,true,3],[6,true,3],[6,false,6]]) {
    const h = harness({ count, mobile });
    assert.equal(h.columns(), expectedColumns);
    const distance = count * (mobile ? 390 : 1000) / expectedColumns;
    const a = h.animation();
    assert.equal(a.frames[0].transform, 'translateX(0px)');
    assert.ok(Math.abs(parseFloat(a.frames[1].transform.slice(11)) + distance) < 0.01);
    assert.ok(Math.abs(a.options.duration - distance / 28 * 1000) < 0.01);
    assert.equal(a.options.iterations, Infinity);
    assert.equal(a.options.easing, 'linear');
    assert.deepEqual(h.clones().map(card => card.title), h.originals().map(card => card.title));
    assert.ok(h.clones().every(card => card.getAttribute('aria-hidden') === 'true'));
  }
});

test('quote updates and language changes keep the animation and its position', () => {
  const h = harness();
  const a = h.animation(); a.currentTime = 5000;
  const original = h.originals()[0];
  original.innerHTML = 'A: 101.25 (+2.25, +2.27%)'; original.title = 'Updated A';
  h.document.documentElement.lang = 'en'; h.controller.sync();
  assert.equal(h.animation(), a); assert.equal(a.currentTime, 5000);
  assert.equal(h.originals()[0], original);
  assert.equal(h.clones()[0].innerHTML, original.innerHTML); assert.equal(h.clones()[0].title, 'Updated A');
  assert.equal(h.button.getAttribute('aria-label'), 'Pause price ticker');
});

test('replacing the selection restarts one loop with the new quotes; one or zero stays still', () => {
  const h = harness({ count: 6 });
  const a = h.animation(); a.currentTime = 8000;
  h.replace(['X', 'Y']);
  assert.equal(a.playState, 'idle');
  assert.equal(h.runningAnimations().length, 1); assert.equal(h.animation().currentTime, 0);
  assert.deepEqual(h.clones().map(card => card.title), ['X', 'Y']);
  for (const selected of [['Z'], []]) {
    h.replace(selected);
    assert.equal(h.clones().length, 0); assert.equal(h.runningAnimations().length, 0);
    assert.equal(h.button.hidden, true);
  }
});

test('pausing at any position survives refresh, offscreen and background changes', () => {
  const h = harness();
  const a = h.animation(); a.currentTime = 1700;
  assert.equal(h.button.tagName, 'BUTTON'); assert.equal(h.button.type, 'button');
  h.click(); h.controller.sync(); h.visible(false); h.hidden(true); h.visible(true); h.hidden(false);
  assert.equal(a.playState, 'paused'); assert.equal(a.currentTime, 1700);
  assert.equal(h.button.getAttribute('aria-pressed'), 'true');
  h.tap(); assert.equal(a.playState, 'running');
  h.hidden(true); assert.equal(a.playState, 'paused');
  h.visible(false); h.hidden(false); assert.equal(a.playState, 'paused');
  h.visible(true); assert.equal(a.playState, 'running');
});

test('reduced motion and missing animation support keep all the original quotes readable', () => {
  const h = harness({ reduced: true });
  assert.ok(h.section.classList.contains('kn-markets-still'));
  assert.equal(h.originals().length, 4); assert.equal(h.clones().length, 0);
  assert.equal(h.button.hidden, true); assert.equal(h.runningAnimations().length, 0);
  h.reduced(false); assert.equal(h.runningAnimations().length, 1);
  h.reduced(true); assert.equal(h.runningAnimations().length, 0); assert.equal(h.clones().length, 0);
  const fallback = harness({supported: false});
  assert.equal(fallback.originals().length, 4); assert.equal(fallback.clones().length, 0);
  assert.equal(fallback.button.hidden, true);
});

test('long prices gain room and resizing replaces the loop while keeping its progress', () => {
  const h = harness({ priceWidth: 150 });
  assert.equal(h.columns(), 2); assert.equal(h.clones().length, 4);
  const a = h.animation(); a.currentTime = a.options.duration * 0.25;
  h.resize(690);
  assert.equal(h.columns(), 3); assert.equal(h.clones().length, 4);
  assert.equal(a.playState, 'idle'); assert.equal(h.runningAnimations().length, 1);
  assert.ok(Math.abs(h.animation().currentTime / h.animation().options.duration - 0.25) < 0.0001);
});

test('destroy cancels the loop and restores the original DOM and observers', () => {
  const h = harness(); h.controller.destroy(); h.controller.sync();
  assert.equal(h.grid.parentNode, h.section); assert.equal(h.viewport.parentNode, null); assert.equal(h.button.parentNode, null);
  assert.equal(h.originals().length, 4); assert.equal(h.clones().length, 0);
  assert.equal(h.runningAnimations().length, 0);
  for (const node of [h.document, h.window, h.viewport, h.button, h.phoneQuery, h.motionQuery]) assert.equal(node.listenerCount(), 0);
  assert.ok([...h.intersections, ...h.resizes].every(observer => observer.disconnected));
});

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

function harness({ count = 4, mobile = true, reduced = false, priceWidth = 80 } = {}) {
  let clock = 0, sequence = 0, width = 390;
  const timers = new Map(), intersections = [], resizes = [];
  const section = new Element('section'), controls = new Element(), grid = new Element();
  section.appendChild(controls); section.appendChild(grid);
  function makeCard(id, requiredWidth = priceWidth) {
    const card = new Element(), price = new Element();
    card.className = 'kn-a-quote'; card.title = id; card.innerHTML = `${id}: 100.00 (+1.00, +1.00%)`;
    price.className = 'kn-a-quote-value'; price.scrollWidth = requiredWidth;
    // Simulate only the measured price widths; layout appearance is checked in a browser.
    Object.defineProperty(price, 'clientWidth', { get: () => width / Number(grid.style['--kn-market-columns'] || 3) - 12 });
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
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  }
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; resizes.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  }
  window.IntersectionObserver = IntersectionObserver; window.ResizeObserver = ResizeObserver;
  const context = { window, document, IntersectionObserver, ResizeObserver,
    localStorage: { getItem: () => null },
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: clock + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  vm.runInNewContext(source, context);
  const controller = window.KNMarketCarousel.mount({ grid, controls, section });
  const viewport = grid.parentNode, button = controls.firstChild;
  function advance(duration) {
    const until = clock + duration;
    let steps = 0;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      assert.ok(++steps < 1000, 'Timers must not spin without advancing time');
      clock = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    clock = until;
  }
  const originals = () => grid.children.filter(card => !card.hasAttribute('data-kn-market-clone'));
  const clones = () => grid.children.filter(card => card.hasAttribute('data-kn-market-clone'));
  const columns = () => Number(grid.style['--kn-market-columns']);
  const index = () => Math.round(-parseFloat((grid.style.transform || 'translateX(0%)').slice(11)) * columns() / 100) || 0;
  return { grid, controls, section, viewport, button, document, window, controller, timers, intersections, resizes,
    phoneQuery, motionQuery, advance, originals, clones, columns, index,
    shown: () => grid.children.slice(index(), index() + columns()).map(card => card.title),
    deadline: () => [...timers.values()].map(timer => timer.at),
    click: () => button.fire('click'), tap: () => viewport.fire('click'),
    replace(ids) { grid.replaceChildren(...ids.map(id => makeCard(id))); controller.sync(); },
    mobile(value) { phoneQuery.matches = value; phoneQuery.fire('change', { matches: value }); },
    reduced(value) { motionQuery.matches = value; motionQuery.fire('change', { matches: value }); },
    hidden(value) { document.hidden = value; document.fire('visibilitychange'); },
    visible(value) { intersections[0].callback([{ target: section, isIntersecting: value }]); },
    resize(value) { width = value; resizes[0].callback([{ contentRect: { width } }]); }
  };
}

test('four mobile markets rotate one at a time after six seconds and loop without losing a visible card', () => {
  const h = harness();
  assert.equal(h.columns(), 3); assert.equal(h.clones().length, 3);
  assert.deepEqual(h.shown(), ['A', 'B', 'C']);
  assert.ok(h.clones().every(card => card.getAttribute('aria-hidden') === 'true'));
  for (const expected of [['B', 'C', 'D'], ['C', 'D', 'A'], ['D', 'A', 'B'], ['A', 'B', 'C']]) {
    const before = h.grid.style.transform;
    h.advance(5999); assert.equal(h.grid.style.transform, before);
    h.advance(1); assert.deepEqual(h.shown(), expected); assert.match(h.grid.style.transition, /700ms/);
    h.advance(699); assert.equal(h.timers.size, 1);
    h.advance(1); assert.equal(h.timers.size, 1);
  }
  assert.equal(h.index(), 0); assert.equal(h.grid.style.transition, 'none');
});

test('price and language updates refresh clones without restarting the current waiting period', () => {
  const h = harness(); h.advance(6700); h.advance(2000);
  const deadline = h.deadline(), original = h.originals()[0];
  original.innerHTML = 'A: 101.25 (+2.25, +2.27%)'; original.title = 'Updated A';
  h.document.documentElement.lang = 'en'; h.controller.sync();
  assert.equal(h.index(), 1); assert.deepEqual(h.deadline(), deadline);
  assert.equal(h.originals()[0], original);
  assert.equal(h.clones()[0].innerHTML, original.innerHTML); assert.equal(h.clones()[0].title, 'Updated A');
  assert.equal(h.button.getAttribute('aria-label'), 'Pause automatic rotation');
  h.advance(4000); assert.equal(h.index(), 2);
});

test('selection changes discard removed markets and rotate only when the visible capacity is exceeded', () => {
  const h = harness(); h.advance(6700);
  h.replace(['W', 'X', 'Y', 'Z']);
  assert.equal(h.index(), 0); assert.deepEqual(h.shown(), ['W', 'X', 'Y']);
  assert.deepEqual(h.clones().map(card => card.title), ['W', 'X', 'Y']); assert.equal(h.timers.size, 1);
  for (const ids of [['W', 'X', 'Y'], ['W'], []]) {
    h.replace(ids);
    assert.equal(h.clones().length, 0); assert.equal(h.timers.size, 0); assert.equal(h.button.hidden, true);
    assert.deepEqual(h.originals().map(card => card.title), ids);
  }
  h.replace(['A', 'B', 'C', 'D']); h.advance(6000); assert.deepEqual(h.shown(), ['B', 'C', 'D']);
});

test('the native pause button and tapping the quotes preserve a user pause across refreshes', () => {
  const h = harness();
  assert.equal(h.button.tagName, 'BUTTON'); assert.equal(h.button.type, 'button');
  h.advance(2000); h.click();
  assert.equal(h.button.getAttribute('aria-pressed'), 'true'); assert.equal(h.timers.size, 0);
  h.originals()[0].innerHTML = 'A: 102.00'; h.controller.sync(); h.advance(30000);
  assert.equal(h.index(), 0); assert.equal(h.timers.size, 0); assert.equal(h.clones()[0].innerHTML, 'A: 102.00');
  h.tap(); assert.equal(h.button.getAttribute('aria-pressed'), 'false');
  h.advance(5999); assert.equal(h.index(), 0); h.advance(1); assert.equal(h.index(), 1);
});

test('pausing during a slide finishes that step and schedules no additional rotation', () => {
  const h = harness(); h.advance(6300); h.click();
  assert.equal(h.index(), 1); assert.equal(h.timers.size, 1, 'The current 700 ms step must still finish');
  h.advance(399); assert.equal(h.timers.size, 1);
  h.advance(1); assert.equal(h.timers.size, 0); h.advance(20000); assert.equal(h.index(), 1);
  h.click(); h.advance(6000); assert.equal(h.index(), 2);
});

test('document and section visibility must both permit motion and cannot clear a user pause', () => {
  const h = harness(); h.advance(6200); h.hidden(true);
  assert.equal(h.timers.size, 0); assert.equal(h.grid.style.transition, 'none');
  h.visible(false); h.hidden(false); h.advance(20000); assert.equal(h.timers.size, 0);
  h.visible(true); assert.equal(h.timers.size, 1); h.advance(6000); assert.equal(h.index(), 2);
  h.advance(700); h.click(); h.visible(false); h.hidden(true); h.visible(true); h.hidden(false);
  assert.equal(h.button.getAttribute('aria-pressed'), 'true'); assert.equal(h.timers.size, 0);
});

test('reduced motion exposes all four original cards and desktop mode remains static', () => {
  const h = harness({ reduced: true });
  assert.ok(h.section.classList.contains('kn-markets-still')); assert.equal(h.originals().length, 4);
  assert.equal(h.clones().length, 0); assert.equal(h.timers.size, 0); assert.equal(h.button.hidden, true);
  h.reduced(false); h.advance(6200); assert.equal(h.index(), 1);
  h.reduced(true); assert.equal(h.index(), 0); assert.equal(h.clones().length, 0); assert.equal(h.timers.size, 0);
  h.reduced(false); h.mobile(false);
  assert.equal(h.originals().length, 4); assert.equal(h.clones().length, 0); assert.equal(h.timers.size, 0);
  assert.ok(!h.section.classList.contains('kn-markets-compact')); assert.ok(!h.section.classList.contains('kn-markets-still'));
  h.mobile(true); assert.equal(h.columns(), 3); assert.equal(h.clones().length, 3); assert.equal(h.timers.size, 1);
});

test('long prices gain columns of space and a wider viewport restores the three-card layout', () => {
  const h = harness({ priceWidth: 150 });
  assert.equal(h.columns(), 2); assert.equal(h.clones().length, 2);
  h.originals()[0].querySelector('.kn-a-quote-value').scrollWidth = 210; h.controller.sync();
  assert.equal(h.columns(), 1); assert.equal(h.clones().length, 1);
  h.resize(690); assert.equal(h.columns(), 3); assert.equal(h.clones().length, 3);
  assert.equal(h.timers.size, 1);
});

test('three or fewer selected markets remain static even when long prices need additional rows', () => {
  for (const count of [1, 2, 3]) {
    const h = harness({ count, priceWidth: 210 });
    assert.equal(h.columns(), 1); assert.equal(h.originals().length, count);
    assert.equal(h.clones().length, 0); assert.equal(h.timers.size, 0); assert.equal(h.button.hidden, true);
    assert.ok(!h.section.classList.contains('kn-markets-rotating'));
    h.advance(30000); assert.equal(h.index(), 0);
  }
});

test('destroy restores the original DOM and removes timers, observers and event listeners', () => {
  const h = harness(); h.advance(6200); h.controller.destroy();
  assert.equal(h.grid.parentNode, h.section); assert.equal(h.viewport.parentNode, null); assert.equal(h.button.parentNode, null);
  assert.equal(h.originals().length, 4); assert.equal(h.clones().length, 0); assert.equal(h.timers.size, 0);
  assert.equal(h.grid.style.transform, undefined); assert.equal(h.grid.style.transition, undefined);
  for (const node of [h.document, h.window, h.viewport, h.button, h.phoneQuery, h.motionQuery]) assert.equal(node.listenerCount(), 0);
  assert.ok([...h.intersections, ...h.resizes].every(observer => observer.disconnected));
  h.controller.sync(); h.advance(30000); assert.equal(h.timers.size, 0);
});

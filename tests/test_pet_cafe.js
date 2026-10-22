'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../static/pet-cafe.js'), 'utf8');

class Element {
  constructor(tag, ownerDocument) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = ownerDocument; this.children = [];
    this.className = ''; this.dataset = {}; this.attributes = {}; this.disabled = false; this._text = '';
    this.listeners = new Map();
  }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  replaceChildren(...children) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; this._text = ''; children.forEach(child => this.appendChild(child)); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  emit(name) { [...(this.listeners.get(name) || [])].forEach(fn => fn({target: this})); }
  find(cls) { return this.all().find(child => child.className.split(/\s+/).includes(cls)); }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
}

function fixture(options = {}) {
  let clock = 1000, sequence = 0;
  const frames = new Map(), timers = new Map(), completed = [], cancelled = [];
  const document = {createElement(tag) { return new Element(tag, document); }};
  const parent = document.createElement('div');
  const window = {
    setTimeout(fn, ms) { const id = ++sequence; timers.set(id, {fn, at: clock + ms}); return id; },
    clearTimeout(id) { timers.delete(id); },
    ...(options.noRaf ? {} : {
      requestAnimationFrame(fn) { const id = ++sequence; frames.set(id, fn); return id; },
      cancelAnimationFrame(id) { frames.delete(id); }
    })
  };
  const context = vm.createContext({window, Date, console});
  vm.runInContext(source, context);
  const controller = window.PetCafe.mount(parent, {now: () => clock, durationMs: options.durationMs,
    onComplete: score => completed.push(score), onCancel: () => cancelled.push(true)});
  return {parent, frames, timers, completed, cancelled, controller,
    get root() { return parent.children[0]; },
    button(id) { return parent.all().find(n => n.tagName === 'BUTTON' && n.dataset.ingredient === id); },
    click(id) { this.button(id).emit('click'); },
    recipe() { return this.root.find('ipg-cafe-recipe').children.map(row => row.dataset.ingredient); },
    make() { this.recipe().forEach(id => this.click(id)); },
    advance(ms) { clock += ms; },
    frame(ms = 0) { clock += ms; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(clock)); },
    runTimers(ms = 0) { clock += ms; for (const [id, t] of [...timers]) if (t.at <= clock) { timers.delete(id); t.fn(); } }
  };
}

test('native ingredient buttons follow the shown recipe, reset a wrong order and rotate after a completed snack', () => {
  const f = fixture();
  assert.equal(f.parent.find('ipg-cafe-status').textContent, '残り25秒 · 0点');
  assert.deepEqual(f.recipe(), ['sponge', 'cream', 'berry']);
  f.click('sponge'); assert.equal(f.parent.find('ipg-cafe-recipe').children[0].className.includes('is-complete'), true);
  f.click('berry');
  assert.equal(f.parent.find('ipg-cafe-recipe').children.filter(n => n.className.includes('is-complete')).length, 0);
  assert.match(f.parent.find('ipg-cafe-feedback').textContent, /最初から/);
  f.make(); assert.match(f.parent.find('ipg-cafe-status').textContent, /3点/);
  assert.deepEqual(f.recipe(), ['berry', 'sponge', 'cream']);
  assert.equal(f.parent.find('ipg-cafe-feedback').getAttribute('aria-live'), 'polite');
  for (const id of ['sponge', 'cream', 'berry']) {
    assert.equal(f.button(id).type, 'button'); assert.match(f.button(id).textContent, /スポンジ|クリーム|いちご/);
  }
  f.controller.dispose();
});

test('all snack scores share a hard 30-point cap and cannot settle before the full 25 seconds', () => {
  const f = fixture();
  for (let n = 0; n < 14; n++) f.make();
  assert.match(f.parent.find('ipg-cafe-status').textContent, /30点/);
  f.frame(24999); assert.deepEqual(f.completed, []); assert.equal(f.frames.size, 1);
  f.frame(1); assert.deepEqual(f.completed, [30]); assert.equal(f.frames.size, 0);
  assert.equal(f.parent.find('ipg-cafe-status').textContent, 'できあがり · 30点');
  f.frame(5000); f.click('sponge'); f.root.find('ipg-cafe-cancel').emit('click');
  assert.deepEqual(f.completed, [30]); assert.deepEqual(f.cancelled, []);
  assert.ok(f.root.all().filter(n => n.tagName === 'BUTTON').every(n => n.disabled));
});

test('a click at expiry completes first and cannot add a final late score', () => {
  const f = fixture(); f.click('sponge'); f.click('cream'); f.advance(25000); f.click('berry');
  assert.deepEqual(f.completed, [0]); assert.equal(f.frames.size, 0);
  f.click('berry'); assert.deepEqual(f.completed, [0]);
});

test('cancel and dispose remove scheduled work and listeners without awarding or repeating callbacks', () => {
  const cancelled = fixture();
  const staleFrame = [...cancelled.frames.values()][0];
  const cancel = cancelled.root.find('ipg-cafe-cancel');
  cancel.emit('click'); cancel.emit('click'); staleFrame();
  assert.deepEqual(cancelled.cancelled, [true]); assert.deepEqual(cancelled.completed, []); assert.equal(cancelled.frames.size, 0);
  assert.ok(cancelled.root.all().filter(n => n.tagName === 'BUTTON').every(n => (n.listeners.get('click')?.size || 0) === 0));
  const disposed = fixture();
  const staleDisposed = [...disposed.frames.values()][0];
  disposed.controller.dispose(); disposed.controller.dispose(); disposed.advance(30000); staleDisposed(); disposed.click('sponge');
  assert.deepEqual(disposed.completed, []); assert.deepEqual(disposed.cancelled, []); assert.equal(disposed.frames.size, 0);
});

test('duration bounds, backward clocks and timer fallback preserve the minimum game duration', () => {
  for (const durationMs of [0, -10, 500, NaN, Infinity]) {
    const f = fixture({durationMs}); f.frame(24999); assert.deepEqual(f.completed, []); f.frame(1); assert.deepEqual(f.completed, [0]);
  }
  const f = fixture(); f.frame(10000); f.frame(-9000); assert.match(f.parent.find('ipg-cafe-status').textContent, /残り15秒/);
  f.frame(23999); assert.deepEqual(f.completed, []); f.frame(1); assert.deepEqual(f.completed, [0]);
  const bounded = fixture({durationMs: 999999}); bounded.frame(119999); assert.deepEqual(bounded.completed, []); bounded.frame(1); assert.deepEqual(bounded.completed, [0]);
  const timer = fixture({noRaf: true}); assert.equal(timer.timers.size, 1); timer.runTimers(24999); assert.deepEqual(timer.completed, []);
  timer.runTimers(1); assert.deepEqual(timer.completed, []); timer.runTimers(99); assert.deepEqual(timer.completed, [0]); assert.equal(timer.timers.size, 0);
});

test('the activity rejects missing parents and performs no persistence, network or reward side effects', () => {
  const window = {}; vm.runInNewContext(source, {window});
  assert.throws(() => window.PetCafe.mount(null), /parent element/);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage)\b/);
});

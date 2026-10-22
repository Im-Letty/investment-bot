'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'static/simulator-inputs.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'simulator.html'), 'utf8');
const currencies = vm.runInNewContext(html.match(/const CUR=(\{[\s\S]*?\n\});/)[0] + '\nCUR');
const moneyHandlers = html.slice(html.indexOf('function moneyFocus('), html.indexOf('function countUp('));

function harness(lang = 'ja') {
  class Element {
    constructor(type = '') {
      this.type = type; this.dataset = new Proxy({}, {set(object, key, value) {object[key] = String(value); return true;}}); this.children = []; this.events = new Map();
      this.attributes = new Map(); this.classes = new Set(); this.textContent = ''; this._value = '';
      this.classList = {contains: name => this.classes.has(name), add: name => this.classes.add(name)};
    }
    set value(value) {
      let number = Number(value);
      if (this.type === 'range' && Number.isFinite(number)) {
        const min = Number(this.min), max = Number(this.max), step = Number(this.step);
        number = Math.max(min, Math.min(max, number));
        number = min + Math.round((number - min) / step) * step;
        number = Math.min(min + Math.floor((max - min) / step + 1e-9) * step, number);
        value = Math.round(number * 1e8) / 1e8;
      }
      this._value = String(value);
    }
    get value() { return this._value; }
    get firstChild() { return this.children[0] || null; }
    appendChild(child) {
      if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1);
      child.parentNode = this; this.children.push(child); return child;
    }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    addEventListener(name, fn, options) {
      const list = this.events.get(name) || [];
      list.push({fn, capture: options === true || !!(options && options.capture)}); this.events.set(name, list);
    }
    dispatchEvent(event) {
      // Model the DOM target phase: capture listeners precede the existing
      // inline handler, regardless of registration order.
      for (const capture of [true, false]) for (const item of this.events.get(event.type) || []) {
        if (item.capture === capture) item.fn.call(this, event);
      }
      return true;
    }
  }
  class InputEvent { constructor(type, options = {}) { this.type = type; Object.assign(this, options); } }
  const document = new Element(), windowEvents = new Element(), nodes = new Map(), ranges = [], calculations = [];
  document.readyState = 'complete'; document.documentElement = {lang};
  document.createElement = () => new Element();
  document.getElementById = id => nodes.get(id);
  document.querySelectorAll = selector => selector === '.row input[type="range"]' ? ranges : [];
  const context = {document, currentLang: lang, Event: InputEvent,
    fmtInput: value => 'shown:' + value, updateFill: range => {range.fill = range.value;},
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    MutationObserver: class {observe() {}}, console};
  context.window = context;
  const c = currencies[lang];
  const specs = [
    ['d-amount', c.d_min, c.d_max, c.d_step, c.d_def, true, 'calcD'],
    ['m-amount', c.m_min, c.m_max, c.m_step, c.m_def, true, 'calcM'],
    ['lp-amount', c.l_min, c.l_max, c.l_step, c.l_def, true, 'calcL'],
    ['g-target', c.g_min, c.g_max, c.g_step, c.g_def, true, 'calcG'],
    ['d-rate', 0, 30, .1, 5, false, 'calcD'],
    ['d-years', 1, 50, 1, 20, false, 'calcD']
  ];
  const controls = new Map();
  for (const [id, min, max, step, initial, money, calc] of specs) {
    const range = new Element('range'), input = new Element(money ? 'text' : 'number'), row = new Element();
    range.id = id; Object.assign(range, {min, max, step}); range.value = initial;
    input.id = id + '-n'; input.value = initial; if (money) input.dataset.raw = String(initial);
    if (id.endsWith('rate')) input.classes.add('rate');
    const label = new Element(), right = new Element(), unit = new Element();
    label.id = id + '-label'; label.textContent = id; unit.textContent = money ? '円' : id.endsWith('rate') ? '%' : '年';
    right.appendChild(input); right.appendChild(unit);
    row.querySelector = selector => selector === 'label' ? label : selector === '.right' ? right : selector === '.unit' ? unit : null;
    range.closest = () => row;
    nodes.set(range.id, range); nodes.set(input.id, input); ranges.push(range);
    controls.set(id, {range, input, row, right, calc});
  }
  for (const name of ['calcD', 'calcM', 'calcL', 'calcG']) context[name] = () => {
    calculations.push({name, amounts: Object.fromEntries([...controls].map(([id, {input}]) => [id, input.dataset.raw]))});
  };
  vm.createContext(context); vm.runInContext(moneyHandlers, context);
  // Use the actual numeric/slider inline handlers before installing decorators.
  for (const {range, input} of controls.values()) for (const field of [range, input]) {
    const tag = html.match(new RegExp('<input[^>]*id="' + field.id + '"[^>]*>'))[0];
    for (const type of ['input', 'blur']) {
      const attr = tag.match(new RegExp('on' + type + '="([^"]+)"'));
      if (attr) field.addEventListener(type, vm.runInContext('(function(){' + attr[1] + '})', context));
    }
  }
  vm.runInContext(script, context);
  const emit = (target, type, extra = {}) => target.dispatchEvent(new InputEvent(type, extra));
  function change(id, value) { const x = controls.get(id); x.range.value = value; emit(x.range, 'input'); return Number(x.input.dataset.raw || x.input.value); }
  return {context, document, windowEvents, controls, calculations, emit, change,
    start(id, options = {}) {emit(controls.get(id).range, 'pointerdown', {pointerId: 1, button: 0, isPrimary: true, ...options});},
    end(type = 'pointerup', pointerId = 1) {emit(document, type, {pointerId});}};
}

test('yen drag snaps to round thousands, ten-thousands and hundred-thousands before calculations', () => {
  const h = harness(); h.start('d-amount');
  for (const [input, expected] of [[500, 500], [8500, 9000], [9500, 10000], [10500, 10000], [14500, 10000], [15000, 20000], [89500, 90000], [99500, 100000]]) {
    assert.equal(h.change('d-amount', input), expected);
    const {range, input: field} = h.controls.get('d-amount');
    assert.equal(range.value, String(expected)); assert.equal(field.value, 'shown:' + expected);
    assert.equal(range.attributes.get('aria-valuetext'), 'shown:' + expected);
    assert.equal(range.fill, String(expected));
    assert.equal(h.calculations.at(-1).amounts['d-amount'], String(expected));
  }
});
for (const [id, allowed] of [
  ['d-amount', [500, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000]],
  ['m-amount', [100000, 200000, 300000, 400000, 500000, 600000, 700000, 800000, 900000, 1000000, 2000000, 3000000]],
  ['lp-amount', [100000, 200000, 300000, 400000, 500000, 600000, 700000, 800000, 900000, 1000000, 2000000, 3000000, 4000000, 5000000, 6000000, 7000000, 8000000, 9000000, 10000000]]
]) test(id + ': every native position picks its nearest allowed stop, with no reversal or lost endpoints', () => {
  const h = harness(); h.start(id); const {range} = h.controls.get(id); let previous = -Infinity;
  for (let value = Number(range.min); value <= Number(range.max); value += Number(range.step)) {
    const expected = allowed.reduce((best, candidate) => Math.abs(candidate - value) <= Math.abs(best - value) ? candidate : best);
    const actual = h.change(id, value);
    assert.equal(actual, expected, id + ' raw drag ' + value);
    assert.ok(actual >= previous); previous = actual;
  }
  for (const point of allowed) assert.equal(h.change(id, point), point, 'round stop remains reachable');
});
test('direct input and fine plus/minus keep exact amounts after a drag', () => {
  const h = harness(); h.start('d-amount'); assert.equal(h.change('d-amount', 88500), 90000); h.end();
  const {input, right} = h.controls.get('d-amount');
  h.emit(right.children.at(-1), 'click'); assert.equal(Number(input.dataset.raw), 90500);
  h.emit(right.children[0], 'click'); assert.equal(Number(input.dataset.raw), 90000);
  for (const amount of [12345.5, 222200000, 17.25]) {
    input.value = String(amount); h.emit(input, 'input');
    assert.equal(Number(input.dataset.raw), amount);
    h.context.calcD(); assert.equal(Number(input.dataset.raw), amount, 'redraw cannot quantize a saved amount');
    assert.equal(Number(h.calculations.at(-1).amounts['d-amount']), amount);
  }
});
test('monthly and initial fine controls keep their original steps', () => {
  const h = harness();
  for (const id of ['m-amount', 'lp-amount']) {
    const {input, right, range} = h.controls.get(id);
    input.value = '1543210.5'; h.emit(input, 'input');
    h.emit(right.children.at(-1), 'click');
    assert.equal(Number(input.dataset.raw), 1543210.5 + Number(range.step));
  }
});
for (const cancel of ['pointerup', 'pointercancel', 'window-blur', 'range-blur', 'keydown']) test(cancel + ': cancels drag snapping without trapping later native adjustments', () => {
  const h = harness(); h.start('d-amount'); assert.equal(h.change('d-amount', 88500), 90000);
  if (cancel === 'window-blur') h.emit(h.windowEvents, 'blur');
  else if (cancel === 'range-blur' || cancel === 'keydown') h.emit(h.controls.get('d-amount').range, cancel === 'range-blur' ? 'blur' : cancel);
  else h.end(cancel);
  assert.equal(h.change('d-amount', 10500), 10500);
});
test('keyboard arrows can move from a snapped stop by the native fine step', () => {
  const h = harness(); h.start('d-amount'); h.change('d-amount', 10000);
  const {range} = h.controls.get('d-amount');
  h.emit(range, 'keydown', {key: 'ArrowRight'});
  assert.equal(h.change('d-amount', 10500), 10500);
  assert.equal(h.change('d-amount', 11000), 11000);
});
test('secondary touches and unrelated pointer releases do not replace the primary drag', () => {
  const h = harness(); h.start('d-amount');
  h.start('d-amount', {pointerId: 2, isPrimary: false}); h.end('pointerup', 2);
  assert.equal(h.change('d-amount', 88500), 90000); h.end();
  assert.equal(h.change('d-amount', 88500), 88500);
});
test('right-clicks do not start an amount drag', () => {
  const h = harness(); h.start('d-amount', {button: 2});
  assert.equal(h.change('d-amount', 88500), 88500);
});
for (const lang of ['en', 'ko', 'zh']) test(lang + ': currency controls retain existing fine positions', () => {
  const h = harness(lang);
  for (const id of ['d-amount', 'm-amount', 'lp-amount']) {
    const {range} = h.controls.get(id); h.start(id);
    const value = Number(range.min) + 17 * Number(range.step);
    assert.equal(h.change(id, value), value);
  }
});
test('goal, rate and years sliders keep their original behavior', () => {
  const h = harness();
  for (const [id, value] of [['g-target', 13000000], ['d-rate', 5.1], ['d-years', 21]]) {
    h.start(id); assert.equal(h.change(id, value), value);
  }
});

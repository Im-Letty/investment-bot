'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mount, hexToHsv, hsvToHex, validHex } = require('../static/menu-color-plane.js');

function fixture({ color = '#3da060', custom = true, commitThrows = false } = {}) {
  let document, raw = color, customFlag = custom, allowed = true, language = 'ja';
  const commits = [];
  function matches(node, selector) {
    return selector[0] === '.' ? node.className.split(/\s+/).includes(selector.slice(1))
      : selector[0] === '#' ? node.id === selector.slice(1) : node.tagName === selector.toUpperCase();
  }
  function listeners(target, type, event, capture) {
    for (const listener of target.listeners.get(type) || []) {
      if (!!listener.capture !== capture) continue;
      listener.fn(event);
      if (event.immediateStopped) return;
    }
  }
  function eventFor(target, type, values) {
    return { type, target, defaultPrevented: false, propagationStopped: false, immediateStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      stopImmediatePropagation() { this.immediateStopped = true; this.propagationStopped = true; }, ...values };
  }
  function eventTarget() {
    return { listeners: new Map(), addEventListener(type, fn, capture = false) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push({ fn, capture });
    }, emit(type, values = {}) {
      const event = eventFor(values.target || this, type, values);
      listeners(this, type, event, true);
      if (!event.immediateStopped) listeners(this, type, event, false);
      return event;
    } };
  }
  function node(tag) {
    const element = Object.assign(eventTarget(), { tagName: tag.toUpperCase(), className: '', id: '', children: [],
      parentElement: null, hidden: false, tabIndex: -1, attrs: new Map(), textContent: '', value: '', captures: new Set(), scrolls: [],
      rect: { left: 10, top: 20, width: 360, height: 100 }, style: { values: new Map(), setProperty(key, value) { this.values.set(key, value); } },
      appendChild(child) {
        if (child.parentElement) child.parentElement.children.splice(child.parentElement.children.indexOf(child), 1);
        child.parentElement = this; this.children.push(child); return child;
      },
      setAttribute(key, value) { this.attrs.set(key, String(value)); },
      getAttribute(key) { return this.attrs.get(key) ?? null; },
      contains(other) { for (let item = other; item; item = item.parentElement) if (item === this) return true; return false; },
      querySelectorAll(selector) {
        const result = [];
        function walk(parent) { for (const child of parent.children) { if (matches(child, selector)) result.push(child); walk(child); } }
        walk(this); return result;
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
      closest(selector) { for (let item = this; item; item = item.parentElement) if (matches(item, selector)) return item; return null; },
      focus() {
        const previous = document.activeElement;
        if (previous === this) return;
        document.activeElement = this;
        if (previous && previous.fire) previous.fire('focusout', { relatedTarget: this });
      },
      click() { this.focus(); return this.fire('click'); },
      getBoundingClientRect() { return this.rect; },
      scrollIntoView(options) { this.scrolls.push(options); },
      setPointerCapture(id) { this.captures.add(id); },
      releasePointerCapture(id) { if (this.captures.delete(id)) this.fire('lostpointercapture', { pointerId: id }); },
      fire(type, values = {}) {
        const event = eventFor(this, type, values);
        listeners(document, type, event, true);
        for (let item = this; item && !event.propagationStopped; item = item.parentElement) listeners(item, type, event, false);
        if (!event.propagationStopped) listeners(document, type, event, false);
        return event;
      }
    });
    Object.defineProperties(element, {
      ownerDocument: { get: () => document },
      isConnected: { get: () => document.documentElement.contains(element) }
    });
    return element;
  }
  const window = eventTarget();
  document = Object.assign(eventTarget(), { defaultView: window, hidden: false, createElement: node });
  document.documentElement = node('html'); document.body = node('body'); document.documentElement.appendChild(document.body);
  const colors = node('div'); document.body.appendChild(colors);
  const presets = node('div'); presets.className = 'drawer-color-presets'; colors.appendChild(presets);
  for (const hex of ['#3da060', '#e91e63', '#b2923a']) {
    const preset = node('button'); preset.className = 'drawer-color-preset'; presets.appendChild(preset);
    preset.addEventListener('click', () => { raw = hex; customFlag = true; });
  }
  const nativeWrap = node('div'); nativeWrap.className = 'drawer-color-custom'; colors.appendChild(nativeWrap);
  const input = node('input'); input.id = 'drawerColorInput'; input.value = raw; nativeWrap.appendChild(input);
  const reset = node('button'); reset.id = 'drawerColorReset'; colors.appendChild(reset);
  let resets = 0; reset.addEventListener('click', () => { resets++; raw = '#3da060'; customFlag = false; });
  const outside = node('button'); document.body.appendChild(outside); document.activeElement = outside;
  const options = { readColor: () => raw, isCustom: () => customFlag, isAvailable: () => allowed,
    label: key => language === 'en' ? 'en:' + key : key,
    commitColor(hex) { if (commitThrows) throw new Error('synthetic denial'); commits.push(hex); raw = hex; customFlag = true; input.value = hex; }
  };
  const controller = mount(colors, options);
  const get = id => colors.querySelector('#' + id);
  const plus = get('knMenuColorPlus'), panel = get('knMenuColorPanel'), spectrum = get('knMenuColorSpectrum'), tone = get('knMenuColorTone');
  function pointer(type, target = spectrum, x = 10, y = 20, extra = {}) {
    const values = { target, pointerId: 7, isPrimary: true, button: 0, clientX: x, clientY: y, ...extra };
    return type === 'pointerdown' ? target.fire(type, values) : document.emit(type, values);
  }
  return { colors, presets, input, nativeWrap, reset, controller, options, document, window, outside, plus, panel, spectrum, tone, commits, get,
    open() { plus.click(); }, pointer, raw: () => raw, isCustom: () => customFlag, resets: () => resets,
    allowed(value) { allowed = value; }, external(value, customValue = true) { raw = value; customFlag = customValue; input.value = value; },
    language(value) { language = value; }, sample: () => colors.querySelector('.kn-color-sample'), value: () => colors.querySelector('.kn-color-value')
  };
}

test('HSV conversions cover primaries, exact gray, shorthand and clamped finite inputs', () => {
  for (const [hex, expected] of [['#ff0000', { h: 0, s: 1, v: 1 }], ['#00ff00', { h: 120, s: 1, v: 1 }], ['#0000ff', { h: 240, s: 1, v: 1 }], ['#000000', { h: 0, s: 0, v: 0 }], ['#ffffff', { h: 0, s: 0, v: 1 }]]) assert.deepEqual(hexToHsv(hex), expected);
  assert.equal(hsvToHex(hexToHsv('#aBc')), '#aabbcc');
  assert.equal(hsvToHex(720, 2, 2), '#ff0000');
  assert.equal(hsvToHex(-120, 1, 1), '#0000ff');
  assert.equal(hsvToHex(30, -1, -1), '#000000');
  for (const bad of [null, '', '#12', '#xyzxyz', 'red', 4]) { assert.equal(hexToHsv(bad), null); assert.equal(validHex(bad), false); }
  for (const bad of [NaN, Infinity, '0', null]) assert.equal(hsvToHex(bad, 1, 1), null);
});
test('a finite RGB sample round-trips exactly, including old blue and unsaturated colors', () => {
  for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 17) {
    const hex = '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
    assert.equal(hsvToHex(hexToHsv(hex)), hex);
  }
  for (const hex of ['#2196f3', '#808080', '#c0b1a2']) assert.equal(hsvToHex(hexToHsv(hex)), hex);
});
test('mount and opening preserve exact legacy/raw values and never persist or round a selection', () => {
  for (const color of ['#2196f3', '#808080', '#000000', '#ffffff', '#AbC', '#0c1d2e']) {
    const f = fixture({ color }); f.open();
    assert.equal(f.raw(), color); assert.equal(f.sample().style.backgroundColor, color); assert.equal(f.value().textContent, color);
    assert.deepEqual(f.commits, []); assert.equal(f.panel.hidden, false); assert.equal(f.plus.getAttribute('aria-expanded'), 'true');
    assert.equal(f.document.activeElement, f.spectrum);
    f.controller.close(false); assert.equal(f.raw(), color); assert.deepEqual(f.commits, []);
  }
});
test('three preserved presets, native input and existing reset keep their identity with one plus', () => {
  const f = fixture({ custom: false }); assert.equal(f.presets.children.length, 4); assert.equal(f.presets.children.at(-1), f.plus);
  assert.equal(f.nativeWrap.hidden, true); assert.equal(f.input.hidden, true); assert.equal(f.input.tabIndex, -1);
  assert.equal(f.reset.parentElement, f.panel); f.open(); assert.equal(f.value().textContent, '標準の色');
  f.reset.click(); assert.equal(f.resets(), 1); assert.equal(f.isCustom(), false); assert.equal(f.panel.hidden, false); assert.deepEqual(f.commits, []);
  const same = mount(f.colors, f.options); assert.equal(same, f.controller); assert.equal(f.presets.children.length, 4);
});
test('spectrum tap and drag preview locally and commit exactly once on matching pointerup', () => {
  const f = fixture({ color: '#ff0000' }); f.open();
  f.pointer('pointerdown', f.spectrum, 10, 20); f.pointer('pointermove', f.spectrum, 130, 20);
  assert.equal(f.sample().style.backgroundColor, '#00ff00'); assert.equal(f.raw(), '#ff0000'); assert.deepEqual(f.commits, []);
  f.controller.sync(); assert.equal(f.sample().style.backgroundColor, '#00ff00', 'same-value outer preference sync retains local preview');
  f.pointer('pointerup', f.spectrum, 250, 20); assert.deepEqual(f.commits, ['#0000ff']); assert.equal(f.raw(), '#0000ff');
  f.pointer('pointerup', f.spectrum, 250, 20); assert.equal(f.commits.length, 1); assert.equal(f.spectrum.captures.size, 0);
});
test('spectrum geometry clamps at all edges and the tone plane reaches dark and neutral colors', () => {
  const f = fixture({ color: '#ff0000' }); f.open();
  f.pointer('pointerdown', f.spectrum, -100, -100); f.pointer('pointerup', f.spectrum, -100, -100);
  assert.equal(f.raw(), '#ff0000');
  f.pointer('pointerdown', f.spectrum, 900, 500); f.pointer('pointerup', f.spectrum, 900, 500); assert.equal(f.raw(), '#ffffff');
  f.external('#ff0000'); f.controller.sync(); f.get('knMenuColorToneButton').click();
  assert.equal(f.tone.hidden, false); assert.equal(f.document.activeElement, f.tone);
  f.pointer('pointerdown', f.tone, 190, 70); f.pointer('pointerup', f.tone, 190, 70); assert.equal(f.raw(), '#804040');
  f.pointer('pointerdown', f.tone, 1000, 1000); f.pointer('pointerup', f.tone, 1000, 1000); assert.equal(f.raw(), '#000000');
});
test('invalid geometry and nonprimary or unrelated pointers cannot save', () => {
  const f = fixture(); f.open();
  f.pointer('pointerdown', f.spectrum, 100, 50, { isPrimary: false }); f.pointer('pointerup'); assert.deepEqual(f.commits, []);
  f.pointer('pointerdown', f.spectrum, 100, 50, { button: 2 }); f.pointer('pointerup'); assert.deepEqual(f.commits, []);
  f.spectrum.rect.width = 0; f.pointer('pointerdown'); f.pointer('pointerup'); assert.deepEqual(f.commits, []);
  f.spectrum.rect.width = 360; f.spectrum.rect.left = NaN; f.pointer('pointerdown'); f.pointer('pointerup'); assert.deepEqual(f.commits, []);
  f.spectrum.rect.left = 10; f.pointer('pointerdown', f.spectrum, 100, 50);
  f.pointer('pointerup', f.spectrum, 100, 50, { pointerId: 8 }); assert.deepEqual(f.commits, []);
  f.pointer('pointerup', f.spectrum, NaN, 50); assert.deepEqual(f.commits, []); assert.equal(f.sample().style.backgroundColor, f.raw());
});
test('pointercancel and lost capture discard local preview without altering the saved color', () => {
  for (const kind of ['pointercancel', 'lostpointercapture']) {
    const f = fixture({ color: '#2196f3' }); f.open(); f.pointer('pointerdown', f.spectrum, 100, 50);
    if (kind === 'pointercancel') f.pointer(kind); else f.spectrum.fire(kind, { pointerId: 7 });
    assert.equal(f.sample().style.backgroundColor, '#2196f3'); f.pointer('pointerup'); assert.deepEqual(f.commits, []);
  }
});
test('close, visibility, owner change and window blur invalidate a pending gesture and late events', () => {
  for (const reason of ['close', 'hidden', 'auth', 'blur', 'unavailable']) {
    const f = fixture({ color: '#2196f3' }); f.open(); f.pointer('pointerdown', f.spectrum, 100, 50);
    if (reason === 'close') f.controller.close(false);
    if (reason === 'hidden') { f.document.hidden = true; f.document.emit('visibilitychange'); }
    if (reason === 'auth') f.document.emit('knAuthChange');
    if (reason === 'blur') f.window.emit('blur');
    if (reason === 'unavailable') f.allowed(false);
    f.pointer('pointermove', f.spectrum, 250, 20); f.pointer('pointerup', f.spectrum, 250, 20);
    assert.deepEqual(f.commits, [], reason); assert.equal(f.raw(), '#2196f3', reason); assert.equal(f.panel.hidden, true, reason); assert.equal(f.spectrum.captures.size, 0);
  }
});
test('external confirmed color changes cancel pending preview, including before an outer sync', () => {
  for (const notify of [true, false]) {
    const f = fixture({ color: '#2196f3' }); f.open(); f.pointer('pointerdown', f.spectrum, 100, 50);
    f.external('#654321'); if (notify) f.controller.sync();
    f.pointer('pointerup', f.spectrum, 250, 20); assert.deepEqual(f.commits, []);
    assert.equal(f.raw(), '#654321'); assert.equal(f.sample().style.backgroundColor, '#654321');
  }
});
test('keyboard arrows commit one operation, use coarse Shift steps, and guard modified or hidden input', () => {
  const f = fixture({ color: '#ff0000' }); f.open();
  f.spectrum.fire('keydown', { key: 'ArrowRight', shiftKey: true }); assert.deepEqual(f.commits, ['#ff2b00']);
  f.external('#ff0000'); f.controller.sync(); f.get('knMenuColorToneButton').click();
  f.tone.fire('keydown', { key: 'ArrowDown', shiftKey: true }); assert.equal(f.commits.at(-1), '#e60000'); assert.equal(f.commits.length, 2);
  f.tone.fire('keydown', { key: 'ArrowLeft', ctrlKey: true }); assert.equal(f.commits.length, 2);
  f.controller.close(false); f.spectrum.fire('keydown', { key: 'ArrowRight' }); assert.equal(f.commits.length, 2);
  f.allowed(false); f.plus.click(); assert.equal(f.panel.hidden, true);
});
test('Escape closes only the color panel, returns plus focus and blocks drawer propagation', () => {
  const f = fixture(); let outerEscapes = 0; f.document.addEventListener('keydown', event => { if (event.key === 'Escape') outerEscapes++; });
  f.open(); f.pointer('pointerdown', f.spectrum, 100, 50);
  const event = f.spectrum.fire('keydown', { key: 'Escape' });
  assert.equal(event.defaultPrevented, true); assert.equal(outerEscapes, 0); assert.equal(f.panel.hidden, true); assert.equal(f.document.activeElement, f.plus);
  f.pointer('pointerup'); assert.deepEqual(f.commits, []);
  f.plus.fire('keydown', { key: 'Escape' }); assert.equal(outerEscapes, 1, 'the next Escape remains the parent drawer action');
});
test('outside pointer and focus changes never steal destination focus or save a canceled preview', () => {
  for (const reason of ['pointer', 'focus']) {
    const f = fixture(); f.open(); f.pointer('pointerdown', f.spectrum, 100, 50);
    if (reason === 'pointer') { f.document.emit('pointerdown', { target: f.outside, pointerId: 9 }); f.outside.focus(); }
    else f.outside.focus();
    assert.equal(f.document.activeElement, f.outside); assert.equal(f.panel.hidden, true);
    f.pointer('pointerup'); assert.deepEqual(f.commits, []);
  }
});
test('a preset keeps its own handler and closes the panel; translation does not write', () => {
  const f = fixture(); f.open(); f.presets.children[1].click();
  assert.equal(f.raw(), '#e91e63'); assert.equal(f.panel.hidden, true); assert.deepEqual(f.commits, []);
  f.language('en'); f.controller.translate(); assert.equal(f.plus.getAttribute('aria-label'), 'en:chooseColor');
  f.open(); assert.equal(f.get('knMenuColorToneButton').textContent, 'en:adjustTone'); assert.deepEqual(f.commits, []);
});
test('commit failure restores the confirmed color without a success claim or losing the open editor', () => {
  const f = fixture({ color: '#2196f3', commitThrows: true }); f.open();
  f.pointer('pointerdown', f.spectrum, 10, 20); f.pointer('pointerup', f.spectrum, 10, 20);
  assert.deepEqual(f.commits, []); assert.equal(f.raw(), '#2196f3'); assert.equal(f.sample().style.backgroundColor, '#2196f3');
  assert.equal(f.panel.hidden, false); assert.equal(f.colors.querySelector('.kn-color-status').hidden, false);
});

test('opening and explicit close bring fields into the drawer scroll view without shifting pointer selection', () => {
  const f = fixture(); f.open();
  assert.deepEqual(f.spectrum.scrolls, [{ block: 'nearest', inline: 'nearest' }]);
  f.pointer('pointerdown', f.spectrum, 100, 50); assert.equal(f.spectrum.scrolls.length, 1);
  f.pointer('pointercancel'); f.get('knMenuColorToneButton').click();
  assert.deepEqual(f.tone.scrolls, [{ block: 'nearest', inline: 'nearest' }]);
  f.controller.close(true); assert.deepEqual(f.plus.scrolls, [{ block: 'nearest', inline: 'nearest' }]);
  assert.deepEqual(f.commits, []);
});

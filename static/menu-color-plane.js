/* Two-dimensional color selection; preferences stay on the existing commit path. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KNMenuColorPlane = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  var mounted = new WeakMap();
  var defaults = {
    chooseColor: '自由に色を選ぶ', closeColor: '色選びを閉じる',
    colorSpectrum: '色合いと鮮やかさ', colorTone: '鮮やかさと明るさ',
    adjustTone: '濃淡も選ぶ', colorKeyboardHint: '矢印キーでも選べます。Shiftで大きく調整できます。',
    standardColor: '標準の色', selectedColor: '選んだ色', colorUnavailable: '色を変更できませんでした。'
  };
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function validHex(value) { return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value); }
  function hexToHsv(hex) {
    if (!validHex(hex)) return null;
    var digits = hex.slice(1);
    if (digits.length === 3) digits = digits.split('').map(function (c) { return c + c; }).join('');
    var rgb = [0, 2, 4].map(function (offset) { return parseInt(digits.slice(offset, offset + 2), 16) / 255; });
    var hi = Math.max.apply(null, rgb), lo = Math.min.apply(null, rgb), delta = hi - lo, hue = 0;
    if (delta) {
      if (hi === rgb[0]) hue = ((rgb[1] - rgb[2]) / delta) % 6;
      else if (hi === rgb[1]) hue = (rgb[2] - rgb[0]) / delta + 2;
      else hue = (rgb[0] - rgb[1]) / delta + 4;
      hue = (hue * 60 + 360) % 360;
    }
    return { h: hue, s: hi ? delta / hi : 0, v: hi };
  }
  function hsvToHex(h, s, v) {
    if (h && typeof h === 'object') { v = h.v; s = h.s; h = h.h; }
    if (![h, s, v].every(function (value) { return typeof value === 'number' && Number.isFinite(value); })) return null;
    h = ((h % 360) + 360) % 360; s = clamp(s, 0, 1); v = clamp(v, 0, 1);
    var chroma = v * s, x = chroma * (1 - Math.abs((h / 60) % 2 - 1)), m = v - chroma;
    var channels = h < 60 ? [chroma, x, 0] : h < 120 ? [x, chroma, 0] : h < 180 ? [0, chroma, x] : h < 240 ? [0, x, chroma] : h < 300 ? [x, 0, chroma] : [chroma, 0, x];
    return '#' + channels.map(function (channel) { return Math.round((channel + m) * 255 + 1e-10).toString(16).padStart(2, '0'); }).join('');
  }
  function mount(colors, options) {
    if (!colors) return null;
    if (mounted.has(colors)) return mounted.get(colors);
    options = options || {};
    var doc = colors.ownerDocument, win = doc && doc.defaultView;
    var presets = colors.querySelector('.drawer-color-presets');
    if (!doc || !presets) return null;
    var input = colors.querySelector('#drawerColorInput'), reset = colors.querySelector('#drawerColorReset');
    var opened = false, toneOpen = false, drag = null, outsidePointer = null, committedRaw = '', committedCustom = false;
    var hsv = { h: 0, s: 0, v: 1 }, previewRaw = '', previewCustom = false;
    function label(key) {
      var value;
      try { if (typeof options.label === 'function') value = options.label(key); } catch (_) {}
      return typeof value === 'string' && value && value !== key ? value : (defaults[key] || key);
    }
    function node(tag, className, parent) {
      var element = doc.createElement(tag); element.className = className;
      if (parent) parent.appendChild(element);
      return element;
    }
    var plus = node('button', 'kn-color-plus', presets);
    plus.type = 'button'; plus.id = 'knMenuColorPlus'; plus.textContent = '+';
    plus.setAttribute('aria-controls', 'knMenuColorPanel'); plus.setAttribute('aria-expanded', 'false');
    var panel = node('div', 'kn-color-panel', colors);
    panel.id = 'knMenuColorPanel'; panel.hidden = true; panel.setAttribute('role', 'group');
    var header = node('div', 'kn-color-panel-head', panel);
    var title = node('span', 'kn-color-title', header);
    var closeButton = node('button', 'kn-color-close', header);
    closeButton.type = 'button'; closeButton.textContent = '×';
    function field(className, id) {
      var element = node('div', className + ' kn-color-field', panel);
      element.id = id; element.tabIndex = 0; element.setAttribute('role', 'group');
      element.setAttribute('aria-describedby', 'knMenuColorKeyboardHint');
      var marker = node('span', 'kn-color-marker', element); marker.setAttribute('aria-hidden', 'true');
      return { element: element, marker: marker };
    }
    var spectrum = field('kn-color-spectrum', 'knMenuColorSpectrum');
    var toneButton = node('button', 'kn-color-tone-button', panel);
    toneButton.type = 'button'; toneButton.id = 'knMenuColorToneButton';
    toneButton.setAttribute('aria-controls', 'knMenuColorTone'); toneButton.setAttribute('aria-expanded', 'false');
    var tone = field('kn-color-tone', 'knMenuColorTone'); tone.element.hidden = true;
    var selection = node('div', 'kn-color-selection', panel);
    var sample = node('span', 'kn-color-sample', selection); sample.setAttribute('aria-hidden', 'true');
    var value = node('output', 'kn-color-value', selection);
    var hint = node('p', 'kn-color-hint', panel); hint.id = 'knMenuColorKeyboardHint';
    var status = node('p', 'kn-color-status', panel); status.hidden = true; status.setAttribute('role', 'alert');
    if (reset) panel.appendChild(reset);
    if (input) {
      input.hidden = true; input.tabIndex = -1;
      var custom = input.closest('.drawer-color-custom');
      if (custom) { custom.hidden = true; custom.setAttribute('aria-hidden', 'true'); }
    }
    function available() {
      if (doc.hidden || colors.isConnected === false) return false;
      try { return typeof options.isAvailable !== 'function' || !!options.isAvailable(); } catch (_) { return false; }
    }
    function snapshot() {
      var raw;
      try { raw = typeof options.readColor === 'function' ? options.readColor() : input && input.value; } catch (_) {}
      if (!validHex(raw)) raw = validHex(committedRaw) ? committedRaw : '#3da060';
      var custom = false;
      try { custom = typeof options.isCustom === 'function' && !!options.isCustom(); } catch (_) {}
      return { raw: raw, custom: custom };
    }
    function render() {
      spectrum.marker.style.left = String(hsv.h / 360 * 100) + '%';
      spectrum.marker.style.top = String((1 - hsv.s) * 100) + '%';
      tone.marker.style.left = String(hsv.s * 100) + '%';
      tone.marker.style.top = String((1 - hsv.v) * 100) + '%';
      tone.element.style.setProperty('--kn-color-hue', hsvToHex(hsv.h, 1, 1));
      sample.style.backgroundColor = previewRaw;
      value.textContent = previewCustom ? previewRaw : label('standardColor');
      value.setAttribute('aria-label', label('selectedColor') + ': ' + value.textContent);
      spectrum.element.setAttribute('aria-label', label('colorSpectrum') + ': ' + previewRaw);
      tone.element.setAttribute('aria-label', label('colorTone') + ': ' + previewRaw);
      plus.setAttribute('data-custom-color', String(committedCustom));
    }
    function restorePreview() {
      var current = snapshot(), parsed = hexToHsv(current.raw);
      if (parsed.s === 0) parsed.h = hsv.h;
      committedRaw = current.raw; committedCustom = current.custom;
      hsv = parsed; previewRaw = current.raw; previewCustom = current.custom; render();
    }
    function releaseDrag() {
      var previous = drag; drag = null;
      if (previous && typeof previous.field.releasePointerCapture === 'function') {
        try { previous.field.releasePointerCapture(previous.pointerId); } catch (_) {}
      }
    }
    function close(focus) {
      var wasOpened = opened;
      opened = false; outsidePointer = null; releaseDrag(); panel.hidden = true; tone.element.hidden = true; toneOpen = false;
      plus.setAttribute('aria-expanded', 'false'); toneButton.setAttribute('aria-expanded', 'false');
      restorePreview();
      if (wasOpened && focus && available()) {
        plus.focus({ preventScroll: true });
        if (typeof plus.scrollIntoView === 'function') plus.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
    function sync() {
      var current = snapshot(), changed = current.raw !== committedRaw || current.custom !== committedCustom;
      if (drag && changed) releaseDrag();
      if (!drag) restorePreview();
      if (opened && !available()) close(false);
    }
    function usable(fieldElement) {
      if (!opened || panel.hidden || !available() || fieldElement && fieldElement.hidden) {
        if (drag || opened) close(false);
        return false;
      }
      return true;
    }
    function open() {
      if (!available()) return;
      outsidePointer = null; releaseDrag(); restorePreview(); status.hidden = true;
      opened = true; panel.hidden = false; plus.setAttribute('aria-expanded', 'true');
      spectrum.element.focus({ preventScroll: true });
      if (typeof spectrum.element.scrollIntoView === 'function') spectrum.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    function showPreview(next) {
      hsv = next; previewRaw = hsvToHex(next); previewCustom = true; status.hidden = true; render();
    }
    function commit() {
      if (!usable()) return;
      var hex = hsvToHex(hsv);
      releaseDrag();
      try {
        if (typeof options.commitColor !== 'function') throw new Error('color_commit_unavailable');
        options.commitColor(hex);
        restorePreview();
      } catch (_) {
        restorePreview(); status.textContent = label('colorUnavailable'); status.hidden = false;
      }
    }
    function point(element, event) {
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
      var rect = element.getBoundingClientRect();
      if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) return null;
      return { x: clamp((event.clientX - rect.left) / rect.width, 0, 1), y: clamp((event.clientY - rect.top) / rect.height, 0, 1) };
    }
    function updatePointer(element, event) {
      var position = point(element, event); if (!position) return false;
      showPreview(element === spectrum.element ? { h: position.x * 360, s: 1 - position.y, v: 1 } : { h: hsv.h, s: position.x, v: 1 - position.y });
      return true;
    }
    function begin(element, event) {
      if (event.isPrimary === false || event.button != null && event.button !== 0 || !Number.isFinite(event.pointerId) || !usable(element)) return;
      sync();
      if (!usable(element)) return;
      releaseDrag();
      if (!updatePointer(element, event)) return;
      drag = { field: element, pointerId: event.pointerId };
      if (event.preventDefault) event.preventDefault();
      element.focus({ preventScroll: true });
      if (typeof element.setPointerCapture === 'function') { try { element.setPointerCapture(event.pointerId); } catch (_) {} }
    }
    function sameConfirmedColor() {
      var current = snapshot();
      if (current.raw === committedRaw && current.custom === committedCustom) return true;
      releaseDrag(); restorePreview(); return false;
    }
    function moving(event) {
      if (!drag || event.pointerId !== drag.pointerId || !sameConfirmedColor()) return;
      if (!usable(drag.field)) return;
      if (event.preventDefault) event.preventDefault();
      updatePointer(drag.field, event);
    }
    function finish(event) {
      if (!drag || event.pointerId !== drag.pointerId || !sameConfirmedColor()) return;
      var element = drag.field;
      if (!usable(element)) return;
      if (!updatePointer(element, event)) { releaseDrag(); restorePreview(); return; }
      if (event.preventDefault) event.preventDefault();
      commit();
    }
    function cancel(event) {
      if (!drag || event.pointerId != null && event.pointerId !== drag.pointerId) return;
      releaseDrag(); restorePreview();
    }
    function keyboard(element, event) {
      if (!/^Arrow(?:Left|Right|Up|Down)$/.test(event.key) || event.altKey || event.ctrlKey || event.metaKey || !usable(element)) return;
      sync();
      if (!usable(element)) return;
      releaseDrag();
      var next = { h: hsv.h, s: hsv.s, v: hsv.v }, direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1;
      var step = event.shiftKey ? 0.1 : 0.01;
      if (element === spectrum.element) {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next.h = ((next.h + direction * (event.shiftKey ? 10 : 1)) % 360 + 360) % 360;
        else next.s = clamp(next.s + direction * step, 0, 1);
        next.v = 1;
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next.s = clamp(next.s + direction * step, 0, 1);
      else next.v = clamp(next.v + direction * step, 0, 1);
      if (event.preventDefault) event.preventDefault();
      showPreview(next); commit();
    }
    plus.addEventListener('click', function () { if (opened) close(false); else open(); });
    closeButton.addEventListener('click', function () { close(true); });
    toneButton.addEventListener('click', function () {
      if (!usable()) return;
      releaseDrag(); restorePreview(); toneOpen = !toneOpen; tone.element.hidden = !toneOpen;
      toneButton.setAttribute('aria-expanded', String(toneOpen));
      if (toneOpen) {
        tone.element.focus({ preventScroll: true });
        if (typeof tone.element.scrollIntoView === 'function') tone.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    });
    [spectrum.element, tone.element].forEach(function (element) {
      element.addEventListener('pointerdown', function (event) { begin(element, event); });
      element.addEventListener('keydown', function (event) { keyboard(element, event); });
      element.addEventListener('lostpointercapture', function (event) { cancel(event); });
    });
    doc.addEventListener('pointermove', moving);
    doc.addEventListener('pointerup', finish);
    doc.addEventListener('pointercancel', function (event) {
      cancel(event);
      if (outsidePointer && (event.pointerId == null || event.pointerId === outsidePointer.pointerId)) close(false);
    });
    doc.addEventListener('pointerdown', function (event) {
      outsidePointer = null;
      if (opened && !colors.contains(event.target)) {
        // Cancel color work immediately, but preserve the outside target's
        // geometry until its native click has resolved. Collapsing here can
        // clamp the drawer's scroll position between pointerdown and pointerup.
        releaseDrag(); restorePreview(); outsidePointer = { pointerId: event.pointerId };
      }
    }, true);
    doc.addEventListener('click', function (event) {
      outsidePointer = null;
      if (opened && !colors.contains(event.target)) close(false);
    }, true);
    doc.addEventListener('keydown', function () { outsidePointer = null; }, true);
    colors.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || !opened) return;
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      close(true);
    });
    colors.addEventListener('focusout', function (event) { if (opened && !outsidePointer && !colors.contains(event.relatedTarget)) close(false); });
    colors.addEventListener('click', function (event) {
      var target = event.target && event.target.closest && event.target.closest('.drawer-color-preset');
      if (target && colors.contains(target)) close(false);
      if (event.target === reset) sync();
    });
    doc.addEventListener('visibilitychange', function () { if (doc.hidden) close(false); });
    doc.addEventListener('knAuthChange', function () { close(false); });
    if (win) win.addEventListener('blur', function () { close(false); });
    function translate() {
      plus.setAttribute('aria-label', label('chooseColor')); panel.setAttribute('aria-label', label('chooseColor'));
      closeButton.setAttribute('aria-label', label('closeColor')); title.textContent = label('chooseColor');
      toneButton.textContent = label('adjustTone'); hint.textContent = label('colorKeyboardHint'); render();
      if (!status.hidden) status.textContent = label('colorUnavailable');
    }
    var controller = { close: close, sync: sync, translate: translate };
    mounted.set(colors, controller); sync(); translate();
    return controller;
  }
  return { mount: mount, hexToHsv: hexToHsv, hsvToHex: hsvToHex, validHex: validHex };
});

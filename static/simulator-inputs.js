/* Fine adjustments reuse the calculator's existing input and calculation paths. */
(function () {
  'use strict';
  if (window.__KN_SIMULATOR_INPUTS) return;
  window.__KN_SIMULATOR_INPUTS = true;
  var controls = [];
  var words = {
    ja: {less: 'を減らす', more: 'を増やす', points: 'ポイント'},
    en: {less: 'Decrease ', more: 'Increase ', points: ' percentage points'},
    ko: {less: ' 줄이기', more: ' 늘리기', points: '퍼센트포인트'},
    zh: {less: '减少', more: '增加', points: '个百分点'}
  };

  function current(control) {
    var value = parseFloat(control.money ? control.input.dataset.raw : control.input.value);
    return Number.isFinite(value) ? value : Number(control.range.value);
  }

  function next(control, direction) {
    var value = current(control), range = control.range;
    var min = Number(range.min), max = Number(range.max), step = Number(range.step) || 1;
    var precision = Math.min(10, Math.max(
      (String(step).split('.')[1] || '').length,
      (String(value).split('.')[1] || '').length));
    var result = Number((value + direction * step).toFixed(precision));
    // Hand-entered values outside a slider's bounds remain editable. Move one
    // step towards its range rather than snapping a large amount to its max.
    if (direction < 0) {
      if (value <= min) return null;
      result = Math.max(value > max ? max : min, result);
    } else {
      if (value >= max) return null;
      result = Math.min(value < min ? min : max, result);
    }
    return Number.isFinite(result) && result !== value ? result : null;
  }

  function sync(control) {
    var label = control.label.textContent.trim();
    var lang = document.documentElement.lang || 'ja', text = words[lang] || words.ja;
    var step = Number(control.range.step) || 1;
    var unit = control.row.querySelector('.unit');
    var amount = control.money ? window.fmtInput(step) : String(step) +
      (control.input.classList.contains('rate') ? text.points : (unit ? unit.textContent : ''));
    [control.less, control.more].forEach(function (button, index) {
      var action = index ? text.more : text.less;
      var description = lang === 'en' ? action + label + ' by ' + amount :
        lang === 'zh' ? label + action + amount : label + amount + action;
      button.setAttribute('aria-label', description);
      button.title = description;
      button.disabled = next(control, index ? 1 : -1) === null;
    });
    var sliderValue = Number(control.range.value);
    control.range.setAttribute('aria-valuetext', control.money ? window.fmtInput(sliderValue) :
      String(sliderValue) + (unit ? unit.textContent : ''));
    if (typeof window.updateFill === 'function') window.updateFill(control.range);
  }

  function adjust(control, direction) {
    var value = next(control, direction);
    if (value === null) return;
    control.input.value = String(value);
    // Dispatch the numeric field's existing handler, not the range handler:
    // sliderToMoney would overwrite hand-entered amounts above the slider max.
    control.input.dispatchEvent(new Event('input', {bubbles: true}));
    if (control.money) control.input.value = window.fmtInput(value);
    sync(control);
  }

  // Only dragging the three yen amount sliders uses broad, round stops.
  // Numeric input, step buttons, keyboard movement and saved values stay exact.
  function snapDraggedMoney(control) {
    var range = control.range;
    if (control.pointerId === null || window.currentLang !== 'ja' ||
        ['d-amount', 'm-amount', 'lp-amount'].indexOf(range.id) === -1) return;
    var value = Number(range.value), min = Number(range.min), max = Number(range.max);
    var step = Number(range.step) || 1;
    if (![value, min, max, step].every(Number.isFinite) || min < 0 || max <= min || step <= 0) return;
    var nearest = min, distance = Math.abs(value - min);
    function consider(candidate) {
      if (candidate < min || candidate > max) return;
      // Keep the native range's min-based step lattice, without shifting round
      // yen amounts to 10,500 / 20,500 when the lower bound is 500.
      var steps = (candidate - min) / step;
      if (Math.abs(steps - Math.round(steps)) > 1e-7) return;
      var delta = Math.abs(value - candidate);
      if (delta < distance || (delta === distance && candidate > nearest)) {
        nearest = candidate; distance = delta;
      }
    }
    consider(min + Math.floor((max - min) / step + 1e-9) * step);
    for (var unit = 1000; unit <= max; unit *= 10) {
      for (var multiple = 1; multiple < 10; multiple++) consider(unit * multiple);
    }
    range.value = String(nearest);
  }

  function stopDragging(event) {
    controls.forEach(function (control) {
      if (!event || control.pointerId === event.pointerId) control.pointerId = null;
    });
  }

  function init() {
    document.querySelectorAll('.row input[type="range"]').forEach(function (range) {
      var row = range.closest('.row'), input = document.getElementById(range.id + '-n');
      var label = row.querySelector('label'), right = row.querySelector('.right');
      if (!input || !label || !right || row.classList.contains('sim-adjust-row')) return;
      var control = {row: row, range: range, input: input, label: label, money: input.type === 'text', pointerId: null};
      var value = document.createElement('div');
      value.className = 'sim-step-value';
      while (right.firstChild) value.appendChild(right.firstChild);
      [-1, 1].forEach(function (direction) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'sim-step-button';
        button.textContent = direction < 0 ? '−' : '+';
        button.setAttribute('aria-controls', input.id);
        button.addEventListener('click', function () { adjust(control, direction); });
        if (direction < 0) { control.less = button; right.appendChild(button); right.appendChild(value); }
        else { control.more = button; right.appendChild(button); }
      });
      row.classList.add('sim-adjust-row');
      label.htmlFor = input.id;
      input.setAttribute('aria-labelledby', label.id);
      range.setAttribute('aria-labelledby', label.id);
      if (control.money) input.setAttribute('inputmode', 'decimal');
      // Capture runs before the range's existing inline input/calculation
      // handler, so displayed amount, calculation, fill and aria agree.
      if (control.money) {
        range.addEventListener('pointerdown', function (event) {
          if (event.isPrimary !== false && (event.button === undefined || event.button === 0)) control.pointerId = event.pointerId;
        }, true);
        range.addEventListener('input', function () { snapDraggedMoney(control); }, true);
        range.addEventListener('keydown', function () { control.pointerId = null; });
        range.addEventListener('blur', function () { control.pointerId = null; });
      }
      [input, range].forEach(function (field) {
        field.addEventListener('input', function () { sync(control); });
        field.addEventListener('change', function () { sync(control); });
        field.addEventListener('blur', function () { sync(control); });
      });
      controls.push(control);
      sync(control);
    });
    document.addEventListener('pointerup', stopDragging, true);
    document.addEventListener('pointercancel', stopDragging, true);
    window.addEventListener('blur', function () { stopDragging(); });
    // Saved settings and URL prefill update values without input events. Keep
    // buttons in sync after their existing calculation, including later graph
    // loading and the existing detailed-analysis calculation wrappers.
    ['calcD', 'calcM', 'calcL', 'calcG'].forEach(function (name) {
      var calculate = window[name];
      if (typeof calculate !== 'function') return;
      window[name] = function () {
        var result = calculate.apply(this, arguments);
        controls.forEach(sync);
        return result;
      };
    });
    // Language changes reset values and currency steps in the existing code.
    // Observe their labels/range attributes after that synchronous reset ends.
    if (typeof MutationObserver === 'function') {
      var observer = new MutationObserver(function () { controls.forEach(sync); });
      observer.observe(document.documentElement, {attributes: true, attributeFilter: ['lang']});
      controls.forEach(function (control) {
        observer.observe(control.label, {childList: true, characterData: true, subtree: true});
        observer.observe(control.range, {attributes: true, attributeFilter: ['min', 'max', 'step']});
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

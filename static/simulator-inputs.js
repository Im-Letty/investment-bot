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

  function init() {
    document.querySelectorAll('.row input[type="range"]').forEach(function (range) {
      var row = range.closest('.row'), input = document.getElementById(range.id + '-n');
      var label = row.querySelector('label'), right = row.querySelector('.right');
      if (!input || !label || !right || row.classList.contains('sim-adjust-row')) return;
      var control = {row: row, range: range, input: input, label: label, money: input.type === 'text'};
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
      [input, range].forEach(function (field) {
        field.addEventListener('input', function () { sync(control); });
        field.addEventListener('change', function () { sync(control); });
        field.addEventListener('blur', function () { sync(control); });
      });
      controls.push(control);
      sync(control);
    });
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

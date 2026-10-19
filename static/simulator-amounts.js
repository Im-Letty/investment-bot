/* Keep exact amounts visible: give them room before reducing their type size. */
(function () {
  'use strict';
  var frame = 0;
  var probe = document.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;white-space:pre;width:max-content;max-width:none;padding:0;border:0;';

  function set(element, name, value) {
    if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
  }

  function natural(element) {
    // Always measure the selected reading size, never the previous fitted size.
    element.style.removeProperty('--sim-amount-size');
    var style = getComputedStyle(element);
    ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch',
      'fontVariant', 'fontVariantNumeric', 'fontFeatureSettings', 'fontKerning', 'letterSpacing'].forEach(function (name) {
      probe.style[name] = style[name];
    });
    var text = element.tagName === 'INPUT' ? element.value : element.textContent;
    probe.textContent = text;
    return {width: probe.getBoundingClientRect().width,
      size: parseFloat(style.fontSize), style: style};
  }

  function padding(style) {
    return parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  }

  function fit(element) {
    if (!element.clientWidth) return;
    var text = natural(element);
    var available = element.clientWidth - padding(text.style) - 2;
    if (text.width > available && available > 0) {
      var size = text.size * available / text.width;
      // Editable fields keep iOS's non-zooming input size; widen the row first.
      if (element.tagName === 'INPUT') size = Math.max(16, size);
      set(element, '--sim-amount-size', size + 'px');
    }
    // Font hinting at the fitted size can differ from proportional scaling.
    // Check the actual rendered glyphs, including tabular digits, as well.
    if (element.tagName !== 'INPUT') {
      var range = document.createRange();
      range.selectNodeContents(element);
      for (var attempt = 0; attempt < 3; attempt++) {
        var rendered = range.getBoundingClientRect().width;
        var room = element.clientWidth - padding(getComputedStyle(element)) - 2;
        if (rendered <= room || room <= 0) break;
        set(element, '--sim-amount-size', (parseFloat(getComputedStyle(element).fontSize) * room / rendered) + 'px');
      }
    }
  }

  function columns(grid, selector, maximum, property) {
    if (!grid.clientWidth) return;
    var minimum = 0;
    grid.querySelectorAll(selector).forEach(function (value) {
      var item = value.parentElement, style = getComputedStyle(item);
      var label = item.querySelector('.mlabel');
      var width = Math.max(natural(value).width, label ? natural(label).width : 0);
      minimum = Math.max(minimum, width + padding(style) + 4);
    });
    var gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
    var count = Math.max(1, Math.min(maximum, Math.floor((grid.clientWidth + gap) / (minimum + gap))));
    set(grid, property, String(count));
  }

  function fitTooltip(chart) {
    if (!chart || !chart.options.plugins.tooltip) return;
    var tooltip = chart.options.plugins.tooltip;
    var original = tooltip.callbacks.label;
    if (!original || original.knAmountFit) return;
    function label(item) {
      var text = original.call(this, item);
      var font = this.options.bodyFont, pad = this.options.padding;
      var horizontal = typeof pad === 'number' ? pad * 2 : (pad.left || 0) + (pad.right || 0);
      var room = Math.max(1, chart.width - horizontal - (this.options.boxWidth || font.size) - 16);
      var ctx = chart.ctx, lines = [];
      ctx.save();
      ctx.font = (font.weight || 'normal') + ' ' + font.size + 'px ' + font.family;
      (Array.isArray(text) ? text : [text]).forEach(function (line) {
        var current = '';
        Array.from(String(line)).forEach(function (character) {
          if (current && ctx.measureText(current + character).width > room) {
            lines.push(current);
            current = '';
          }
          current += character;
        });
        lines.push(current);
      });
      ctx.restore();
      return lines;
    }
    label.knAmountFit = true;
    tooltip.callbacks.label = label;
  }

  function refresh() {
    frame = 0;
    if (window.Chart) document.querySelectorAll('.chart-wrap canvas').forEach(function (canvas) {
      fitTooltip(window.Chart.getChart(canvas));
    });
    document.querySelectorAll('.result-grid').forEach(function (grid) {
      columns(grid, '.mval', 3, '--sim-result-columns');
      grid.querySelectorAll('.metric').forEach(function (metric) {
        var value = metric.querySelector('.mval'), label = metric.querySelector('.mlabel');
        if (!value || !label || !metric.clientWidth) return;
        var style = getComputedStyle(metric), text = natural(value);
        var needed = text.width + natural(label).width + (parseFloat(style.columnGap) || 0);
        metric.classList.toggle('sim-stacked-amount', needed + 2 > metric.clientWidth - padding(style));
        fit(value);
      });
    });
    document.querySelectorAll('.sim-analysis > div[style*="grid"]').forEach(function (grid) {
      columns(grid, '.sim-analysis-value', 2, '--sim-analysis-columns');
    });
    document.querySelectorAll('.mp-summary-grid').forEach(function (grid) {
      columns(grid, '.mp-card-value', 2, '--sim-summary-columns');
    });
    document.querySelectorAll('.sim-analysis-value, .mp-card-value').forEach(fit);
    document.querySelectorAll('.sim-adjust-row').forEach(function (row) {
      var input = row.querySelector('input[type="text"]');
      if (!input || !row.clientWidth || document.activeElement === input) return;
      row.classList.remove('sim-wide-input');
      var text = natural(input), available = input.clientWidth - padding(text.style);
      row.classList.toggle('sim-wide-input', text.width + 2 > available);
      fit(input);
    });
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(refresh);
  }

  function init() {
    // Outside the observed body so measuring text cannot schedule itself again.
    document.documentElement.appendChild(probe);
    if (window.KNSimulatorTheme) {
      var applyChart = window.KNSimulatorTheme.applyChart;
      window.KNSimulatorTheme.applyChart = function (chart) {
        applyChart(chart);
        fitTooltip(chart);
      };
    }
    document.body.classList.add('sim-amount-fitting');
    var observer = new MutationObserver(function (changes) {
      if (changes.some(function (change) {
        return change.type !== 'attributes' || change.target === document.documentElement ||
          change.target === document.body || change.target.classList.contains('tab-panel');
      })) schedule();
    });
    observer.observe(document.body, {subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['class', 'data-kn-sim-large-text']});
    observer.observe(document.documentElement, {attributes: true, attributeFilter: ['style', 'lang']});
    if (typeof ResizeObserver === 'function') {
      var resize = new ResizeObserver(schedule);
      document.querySelectorAll('.wrap, .result-grid').forEach(function (element) { resize.observe(element); });
    }
    ['input', 'change', 'focusout', 'click'].forEach(function (name) {
      document.addEventListener(name, schedule);
    });
    window.addEventListener('resize', schedule);
    window.addEventListener('pageshow', schedule);
    if (document.fonts) {
      document.fonts.ready.then(schedule);
      document.fonts.addEventListener('loadingdone', schedule);
    }
    refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

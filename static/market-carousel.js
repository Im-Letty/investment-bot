/* Three readable mobile quotes; data fetching stays in the shared market model. */
(function () {
  'use strict';
  window.KNMarketCarousel = { mount: function (options) {
    var grid = options.grid, controls = options.controls, section = options.section;
    var viewport = document.createElement('div');
    viewport.className = 'kn-market-viewport';
    grid.parentNode.insertBefore(viewport, grid);
    viewport.appendChild(grid);
    var button = document.createElement('button');
    button.type = 'button'; button.className = 'kn-market-motion'; button.hidden = true;
    controls.insertBefore(button, controls.firstChild);
    var mobile = window.matchMedia('(max-width: 700px)');
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    var cards = [], clones = [], index = 0, columns = 3;
    var hold = null, moving = null, paused = false, inView = true, destroyed = false, active = false;
    var observedWidth = 0;

    function labels() {
      var locale = document.documentElement.lang;
      try { locale = localStorage.getItem('app_lang') || locale; } catch (_) {}
      var copy = ({ja:['一時停止','再生','自動切り替えを一時停止','自動切り替えを再開'],en:['Pause','Play','Pause automatic rotation','Resume automatic rotation'],ko:['일시 정지','재생','자동 전환 일시 정지','자동 전환 재개'],zh:['暂停','播放','暂停自动切换','继续自动切换']})[locale] || ['一時停止','再生','自動切り替えを一時停止','自動切り替えを再開'];
      button.textContent = (paused ? '▷ ' : 'Ⅱ ') + copy[paused ? 1 : 0];
      button.setAttribute('aria-label', copy[paused ? 3 : 2]);
      button.setAttribute('aria-pressed', String(paused));
      button.hidden = !active;
    }
    function clearHold() { if (hold !== null) clearTimeout(hold); hold = null; }
    function position(animate) {
      grid.style.transition = animate ? 'transform 700ms cubic-bezier(.4,0,.2,1)' : 'none';
      grid.style.transform = 'translateX(' + (-index * 100 / columns) + '%)';
    }
    function canRun() { return active && !paused && !document.hidden && inView && !destroyed; }
    function schedule() {
      if (!canRun() || hold !== null || moving !== null) return;
      hold = setTimeout(function () {
        hold = null;
        if (!canRun()) return;
        index++; position(true);
        moving = setTimeout(function () {
          moving = null;
          if (index >= cards.length) { index = 0; position(false); }
          schedule();
        }, 700);
      }, 6000);
    }
    function settle() {
      if (moving !== null) clearTimeout(moving);
      moving = null;
      if (cards.length) index %= cards.length;
      position(false);
    }
    function stopOffscreen() {
      if (!canRun()) { clearHold(); settle(); }
      else schedule();
    }
    function toggle() {
      if (!active) return;
      paused = !paused; labels(); clearHold();
      // Finish a current step before pausing, so no quote remains half visible.
      schedule();
    }
    function syncClones() {
      var needed = active ? columns : 0;
      if (clones.length !== needed || clones.some(function (clone) { return clone.parentNode !== grid; })) {
        clones.forEach(function (clone) { clone.remove(); }); clones = [];
        cards.slice(0, needed).forEach(function (card) {
          var clone = card.cloneNode(true);
          clone.setAttribute('data-kn-market-clone', ''); clone.setAttribute('aria-hidden', 'true');
          grid.appendChild(clone); clones.push(clone);
        });
      }
      clones.forEach(function (clone, i) {
        if (clone.innerHTML !== cards[i].innerHTML) clone.innerHTML = cards[i].innerHTML;
        clone.title = cards[i].title;
      });
    }
    function layout() {
      if (destroyed) return;
      var compact = mobile.matches && !reduced.matches;
      var nextColumns = Math.min(3, cards.length) || 1;
      section.classList.toggle('kn-markets-compact', compact);
      section.classList.toggle('kn-markets-still', mobile.matches && reduced.matches);
      // Start from three; only use more room when a long price or larger text needs it.
      grid.style.setProperty('--kn-market-columns', String(nextColumns));
      if (compact) {
        while (nextColumns > 1 && cards.some(function (card) {
          var price = card.querySelector('.kn-a-quote-value');
          return price && price.clientWidth > 0 && price.scrollWidth > price.clientWidth + 1;
        })) {
          nextColumns--; grid.style.setProperty('--kn-market-columns', String(nextColumns));
        }
      }
      var nextActive = compact && cards.length > 3 && cards.length > nextColumns;
      if (columns !== nextColumns || active !== nextActive) {
        clearHold(); settle(); columns = nextColumns; active = nextActive;
        if (!active) index = 0;
        position(false);
      }
      section.classList.toggle('kn-markets-rotating', active);
      syncClones(); labels(); schedule();
    }
    function sync() {
      if (destroyed) return;
      var next = Array.prototype.filter.call(grid.children, function (card) { return !card.hasAttribute('data-kn-market-clone'); });
      var changed = cards.length !== next.length || next.some(function (card, i) { return card !== cards[i]; });
      if (changed) { clearHold(); settle(); index = 0; cards = next; position(false); }
      layout();
    }
    function visibility() { stopOffscreen(); }
    button.addEventListener('click', toggle);
    viewport.addEventListener('click', toggle);
    document.addEventListener('visibilitychange', visibility);
    mobile.addEventListener('change', layout);
    reduced.addEventListener('change', layout);
    window.addEventListener('resize', layout);
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', layout);
    var observer = window.IntersectionObserver ? new IntersectionObserver(function (entries) {
      inView = entries[0].isIntersecting; stopOffscreen();
    }) : null;
    if (observer) observer.observe(section);
    var resize = window.ResizeObserver ? new ResizeObserver(function (entries) {
      var width = entries[0].contentRect.width;
      if (Math.abs(width - observedWidth) > 0.5) { observedWidth = width; layout(); }
    }) : null;
    if (resize) resize.observe(viewport);
    sync();
    return { sync: sync, destroy: function () {
      destroyed = true; clearHold(); settle();
      button.removeEventListener('click', toggle); viewport.removeEventListener('click', toggle);
      document.removeEventListener('visibilitychange', visibility);
      mobile.removeEventListener('change', layout); reduced.removeEventListener('change', layout);
      window.removeEventListener('resize', layout);
      if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', layout);
      if (observer) observer.disconnect(); if (resize) resize.disconnect();
      clones.forEach(function (clone) { clone.remove(); }); button.remove();
      viewport.parentNode.insertBefore(grid, viewport); viewport.remove();
      grid.style.removeProperty('transform'); grid.style.removeProperty('transition'); grid.style.removeProperty('--kn-market-columns');
      section.classList.remove('kn-markets-compact', 'kn-markets-still', 'kn-markets-rotating');
    }};
  }};
})();

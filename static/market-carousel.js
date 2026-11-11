/* Move one complete set of quotes left at a steady speed. */
(function () {
  'use strict';
  window.KNMarketCarousel = { mount: function (options) {
    var grid = options.grid, controls = options.controls, section = options.section;
    var viewport = document.createElement('div');
    viewport.className = 'kn-market-viewport';
    grid.parentNode.insertBefore(viewport, grid);
    viewport.appendChild(grid);
    // The pause control is visually hidden until keyboard focus; quotes stay readable to screen readers.
    var button = document.createElement('button');
    button.type = 'button'; button.className = 'kn-market-motion'; button.hidden = true;
    controls.insertBefore(button, controls.firstChild);
    var mobile = window.matchMedia('(max-width: 700px)');
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    var cards = [], clones = [];
    var animation = null, distance = 0;
    var paused = false, inView = true, destroyed = false, active = false;
    var observedWidth = 0;
    var pixelsPerSecond = 28;

    function labels() {
      var locale = document.documentElement.lang;
      try { locale = localStorage.getItem('app_lang') || locale; } catch (_) {}
      var copy = ({ja:['一時停止','再生','価格バーを一時停止','価格バーの動きを再開'],en:['Pause','Play','Pause price ticker','Resume price ticker'],ko:['일시 정지','재생','시세 표시줄 일시 정지','시세 표시줄 재개'],zh:['暂停','播放','暂停行情滚动','继续行情滚动']})[locale] || ['一時停止','再生','価格バーを一時停止','価格バーの動きを再開'];
      button.textContent = (paused ? '▷ ' : 'Ⅱ ') + copy[paused ? 1 : 0];
      button.setAttribute('aria-label', copy[paused ? 3 : 2]);
      button.setAttribute('aria-pressed', String(paused));
      button.hidden = !active;
    }
    function stopAnimation() {
      if (animation) animation.cancel();
      animation = null;
      distance = 0;
    }
    function syncPlayback() {
      if (!animation) return;
      if (!paused && !document.hidden && inView) {
        if (animation.playState !== 'running') animation.play();
      } else if (animation.playState !== 'paused') animation.pause();
    }
    function syncAnimation() {
      // This is the exact distance from the first real quote to its copy.
      var nextDistance = active ? clones[0].getBoundingClientRect().left - cards[0].getBoundingClientRect().left : 0;
      if (!(nextDistance > 0)) { stopAnimation(); return; }
      if (!animation || Math.abs(nextDistance - distance) > 0.01) {
        var duration = nextDistance / pixelsPerSecond * 1000;
        var oldDuration = distance / pixelsPerSecond * 1000;
        var progress = animation ? (Number(animation.currentTime) % oldDuration) / oldDuration : 0;
        stopAnimation();
        distance = nextDistance;
        animation = grid.animate([
          { transform: 'translateX(0px)' },
          { transform: 'translateX(' + (-distance) + 'px)' }
        ], { duration: duration, iterations: Infinity, easing: 'linear' });
        animation.currentTime = progress * duration;
      }
      syncPlayback();
    }
    function toggle() {
      if (!active) return;
      paused = !paused; labels(); syncPlayback();
    }
    function syncClones() {
      var needed = active ? cards.length : 0;
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
      active = !reduced.matches && cards.length > 1 && typeof grid.animate === 'function';
      var nextColumns = (compact ? Math.min(3, cards.length) : cards.length) || 1;
      section.classList.toggle('kn-markets-compact', compact);
      section.classList.toggle('kn-markets-still', mobile.matches && reduced.matches);
      section.classList.toggle('kn-markets-rotating', active);
      // Widen the cards if a long price or larger font needs more room.
      grid.style.setProperty('--kn-market-columns', String(nextColumns));
      if (compact || active) {
        while (nextColumns > 1 && cards.some(function (card) {
          var price = card.querySelector('.kn-a-quote-value');
          return price && price.clientWidth > 0 && price.scrollWidth > price.clientWidth + 1;
        })) {
          nextColumns--; grid.style.setProperty('--kn-market-columns', String(nextColumns));
        }
      }
      syncClones(); labels(); syncAnimation();
    }
    function sync() {
      if (destroyed) return;
      var next = Array.prototype.filter.call(grid.children, function (card) { return !card.hasAttribute('data-kn-market-clone'); });
      var changed = cards.length !== next.length || next.some(function (card, i) { return card !== cards[i]; });
      if (changed) { stopAnimation(); cards = next; }
      layout();
    }
    button.addEventListener('click', toggle);
    viewport.addEventListener('click', toggle);
    document.addEventListener('visibilitychange', syncPlayback);
    mobile.addEventListener('change', layout);
    reduced.addEventListener('change', layout);
    window.addEventListener('resize', layout);
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', layout);
    var observer = window.IntersectionObserver ? new IntersectionObserver(function (entries) {
      inView = entries[0].isIntersecting; syncPlayback();
    }) : null;
    if (observer) observer.observe(section);
    var resize = window.ResizeObserver ? new ResizeObserver(function (entries) {
      var width = entries[0].contentRect.width;
      if (Math.abs(width - observedWidth) > 0.5) { observedWidth = width; layout(); }
    }) : null;
    if (resize) resize.observe(viewport);
    sync();
    return { sync: sync, destroy: function () {
      destroyed = true; stopAnimation();
      button.removeEventListener('click', toggle); viewport.removeEventListener('click', toggle);
      document.removeEventListener('visibilitychange', syncPlayback);
      mobile.removeEventListener('change', layout); reduced.removeEventListener('change', layout);
      window.removeEventListener('resize', layout);
      if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', layout);
      if (observer) observer.disconnect(); if (resize) resize.disconnect();
      clones.forEach(function (clone) { clone.remove(); }); button.remove();
      viewport.parentNode.insertBefore(grid, viewport); viewport.remove();
      grid.style.removeProperty('--kn-market-columns');
      section.classList.remove('kn-markets-compact', 'kn-markets-still', 'kn-markets-rotating');
    }};
  }};
})();

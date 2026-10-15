/* Presentation only: existing ledger storage, identity and calculations stay in kakeibo.html. */
(function () {
  'use strict';
  var more = document.getElementById('kkMore');
  var moreToggle = document.getElementById('kkMoreToggle');

  function languageChanged() {
    document.querySelectorAll('[data-kk-layout-label]').forEach(function (element) {
      if (typeof window.kkT === 'function') {
        element.setAttribute('aria-label', window.kkT(element.getAttribute('data-kk-layout-label')));
      }
    });
  }

  function tabChanged(tab) {
    document.querySelectorAll('#kkBottomNav [data-kknav]').forEach(function (button) {
      var active = button.getAttribute('data-kknav') === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.body.setAttribute('data-kk-active-tab', tab);
    if (more) more.open = false;
  }

  window.kkLayoutLanguageChanged = languageChanged;
  window.kkLayoutTabChanged = tabChanged;

  document.addEventListener('click', function (event) {
    var back = event.target.closest('.back-btn');
    if (back) {
      try {
        if (window.parent !== window && window.parent.location.origin === location.origin &&
            typeof window.parent.knReturnFromLedger === 'function' &&
            window.parent.knReturnFromLedger(window) === true) event.preventDefault();
      } catch (ignore) { /* The link still returns the top-level page. */ }
      return;
    }
    var go = event.target.closest('[data-kk-layout-go]');
    if (go) {
      var tab = go.getAttribute('data-kk-layout-go');
      if (typeof window.switchTab === 'function') window.switchTab(tab);
      var first = document.querySelector('#tab-' + tab + ' [data-kk-pane-title]');
      if (first) first.focus({preventScroll: true});
      return;
    }
    if (more && more.open && !more.contains(event.target)) more.open = false;
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && more && more.open) {
      more.open = false;
      if (moreToggle) moreToggle.focus();
    }
  });
  if (more) more.addEventListener('toggle', function () {
    if (moreToggle) moreToggle.setAttribute('aria-expanded', String(more.open));
  });

  languageChanged();
  tabChanged('home');
})();

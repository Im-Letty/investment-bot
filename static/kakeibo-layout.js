/* Presentation only: existing ledger storage, identity and calculations stay in kakeibo.html. */
(function () {
  'use strict';
  var more = document.getElementById('kkMore');
  var moreToggle = document.getElementById('kkMoreToggle');
  var myPageView = 'ledger', ledgerTab = 'home';
  var viewScroll = {ledger: 0, assets: 0}, scrollRevision = 0;

  function scrollTop() {
    return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
  }

  // The parent keeps one authenticated document for both surfaces. Switching a
  // view must never copy records, reload the iframe or replace unfinished inputs.
  window.kkSetMyPageView = function (mode) {
    if (mode !== 'assets' && mode !== 'ledger') return false;
    if (mode === myPageView) return true;
    viewScroll[myPageView] = scrollTop();
    myPageView = mode;
    document.body.setAttribute('data-kk-mypage-view', mode);
    if (typeof window.switchTab === 'function')
      window.switchTab(mode === 'assets' ? 'assets' : ledgerTab);
    var revision = ++scrollRevision;
    function restore() {
      if (revision !== scrollRevision || mode !== myPageView) return;
      if (typeof window.scrollTo === 'function') window.scrollTo(0, viewScroll[mode]);
    }
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(restore);
    else restore();
    return true;
  };
  document.body.setAttribute('data-kk-mypage-view', myPageView);

  function openAssets() {
    try {
      if (window.parent !== window && window.parent.location.origin === location.origin &&
          typeof window.parent.knOpenAssets === 'function' && window.parent.knOpenAssets() === true) return;
    } catch (ignore) { /* The top-level MyPage link remains available. */ }
    window.top.location.href = '/?mypage=assets';
  }

  function languageChanged() {
    document.querySelectorAll('[data-kk-layout-label]').forEach(function (element) {
      if (typeof window.kkT === 'function') {
        element.setAttribute('aria-label', window.kkT(element.getAttribute('data-kk-layout-label')));
      }
    });
  }

  function tabChanged(tab) {
    if (myPageView === 'ledger' && ['home', 'records', 'calendar'].indexOf(tab) !== -1) ledgerTab = tab;
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
  window.kkLayoutFocusInput = function () {
    var title = document.getElementById('kkEntryTitle');
    if (title) {
      title.scrollIntoView({block: 'start'});
      title.focus({preventScroll: true});
    }
  };
  window.kkLayoutFocusExpenses = function () {
    var title = document.getElementById('kkExpenseTitle');
    if (title) {
      title.scrollIntoView({block: 'start'});
      title.focus({preventScroll: true});
    }
  };

  document.addEventListener('click', function (event) {
    var assetsLink = event.target.closest('[data-kk-open-assets]');
    if (assetsLink) {
      if (more) more.open = false;
      openAssets();
      return;
    }
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
      var anchor = document.getElementById(go.getAttribute('data-kk-layout-anchor'));
      var first = anchor || document.querySelector('#tab-' + tab + ' [data-kk-pane-title]');
      if (anchor) anchor.scrollIntoView({block: 'start'});
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

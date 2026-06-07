/* scanner.js — frontend for /api/scanner */
(function(){
  'use strict';
  var POLL_MS = 15000;
  var DEFAULT_THRESHOLD = 3;
  var LIMIT = 10;
  var LS_KEY = 'alert_scanner_threshold_v1';
  var pollTimer = null;
  var lastFetchAt = 0;
  var lastData = null;

  function t(key, fallback){
    try{
      if(window.i18n && typeof window.i18n.t === 'function'){
        var v = window.i18n.t(key);
        if(v && v !== key) return v;
      }
      if(window.translations){
        var lang = (document.documentElement.lang || 'ja').toLowerCase();
        var dict = window.translations[lang] || window.translations.ja;
        if(dict && dict[key]) return dict[key];
      }
    }catch(e){}
    return fallback;
  }

  function getThreshold(){
    var v = parseFloat(localStorage.getItem(LS_KEY));
    if(isNaN(v) || v <= 0) return DEFAULT_THRESHOLD;
    return v;
  }
  function setThreshold(v){
    var n = parseFloat(v);
    if(!isNaN(n) && n > 0){
      localStorage.setItem(LS_KEY, String(n));
    }
  }

  function findHost(){
    return document.getElementById('alert-section') || document.getElementById('alertSection')
      || document.querySelector('[data-section="alert"]')
      || document.querySelector('.alert-section')
      || document.getElementById('alertPanel');
  }

  function fmtPct(p){
    if(p == null || isNaN(p)) return '-';
    var s = (p > 0 ? '+' : '') + p.toFixed(2) + '%';
    return s;
  }
  function fmtPrice(p){
    if(p == null || isNaN(p)) return '-';
    return Number(p).toLocaleString(undefined, {maximumFractionDigits:2});
  }
  function timeAgo(ts){
    if(!ts) return '-';
    var sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    return sec + 's';
  }

  function injectUI(){
    if(document.getElementById('alertScanner')) return;
    var host = findHost();
    if(!host) return;
    var wrap = document.createElement('div');
    wrap.id = 'alertScanner';
    wrap.className = 'alert-scanner';
    wrap.innerHTML = ''
      + '<div class="alert-scanner-header">'
      +   '<div class="alert-scanner-title" data-i18n="alert_scanner_title">' + t('alert_scanner_title','急騰急落スキャナー') + '</div>'
      +   '<div class="alert-scanner-controls">'
      +     '<label class="alert-scanner-thresh-label" data-i18n="alert_scanner_threshold">' + t('alert_scanner_threshold','しきい値') + '</label>'
      +     '<input id="alertScannerThresh" type="number" min="0.1" max="50" step="0.1" value="' + getThreshold() + '">'
      +     '<span class="alert-scanner-thresh-unit">%</span>'
      +     '<button id="alertScannerRefresh" class="alert-scanner-refresh" type="button">' + t('alert_scanner_refresh','更新') + '</button>'
      +   '</div>'
      + '</div>'
      + '<div class="alert-scanner-meta">'
      +   '<span id="alertScannerMeta">' + t('alert_scanner_loading','読み込み中...') + '</span>'
      + '</div>'
      + '<div class="alert-scanner-grid">'
      +   '<div class="alert-scanner-col alert-scanner-surges">'
      +     '<div class="alert-scanner-col-title" data-i18n="alert_scanner_surges">' + t('alert_scanner_surges','急騰') + '</div>'
      +     '<ul id="alertScannerSurges" class="alert-scanner-list"></ul>'
      +   '</div>'
      +   '<div class="alert-scanner-col alert-scanner-drops">'
      +     '<div class="alert-scanner-col-title" data-i18n="alert_scanner_drops">' + t('alert_scanner_drops','急落') + '</div>'
      +     '<ul id="alertScannerDrops" class="alert-scanner-list"></ul>'
      +   '</div>'
      + '</div>';
    host.appendChild(wrap);
    var inp = document.getElementById('alertScannerThresh');
    if(inp){
      inp.addEventListener('change', function(){
        setThreshold(inp.value);
        load(true);
      });
    }
    var btn = document.getElementById('alertScannerRefresh');
    if(btn){
      btn.addEventListener('click', function(){ load(true); });
    }
  }

  function renderList(elId, items, dir){
    var ul = document.getElementById(elId);
    if(!ul) return;
    if(!items || !items.length){
      ul.innerHTML = '<li class="alert-scanner-empty">' + t('alert_scanner_empty','該当なし') + '</li>';
      return;
    }
    var html = '';
    for(var i=0; i<items.length && i<LIMIT; i++){
      var it = items[i];
      var sym = (it.symbol || it.ticker || '').toString();
      var name = (it.name || sym).toString();
      var pct = it.change_pct != null ? it.change_pct : it.changePercent;
      var price = it.price != null ? it.price : it.last;
      var cls = dir === 'surge' ? 'is-surge' : 'is-drop';
      html += '<li class="alert-scanner-item ' + cls + '">'
        + '<span class="alert-scanner-sym">' + escapeHtml(sym) + '</span>'
        + '<span class="alert-scanner-name">' + escapeHtml(name) + '</span>'
        + '<span class="alert-scanner-price">' + fmtPrice(price) + '</span>'
        + '<span class="alert-scanner-pct">' + fmtPct(pct) + '</span>'
        + '</li>';
    }
    ul.innerHTML = html;
  }
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  function isVisible(){
    var host = document.getElementById('alertScanner');
    if(!host) return false;
    if(document.hidden) return false;
    var sec = findHost();
    if(!sec) return false;
    var st = window.getComputedStyle(sec);
    if(st.display === 'none' || st.visibility === 'hidden') return false;
    var r = host.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function load(force){
    if(!force && !isVisible()) return;
    var th = getThreshold();
    var url = '/api/scanner?threshold=' + encodeURIComponent(th) + '&limit=' + LIMIT;
    if (localStorage.getItem('ui_style') === 'pro') url += '&pro=1';
    var meta = document.getElementById('alertScannerMeta');
    if(meta) meta.textContent = t('alert_scanner_loading','読み込み中...');
    fetch(url, {credentials:'same-origin'})
      .then(function(r){
        if(!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data){
        lastData = data;
        lastFetchAt = Date.now();
        renderList('alertScannerSurges', data.surges || [], 'surge');
        renderList('alertScannerDrops', data.drops || [], 'drop');
        var scanned = (data.scanned != null) ? data.scanned : (data.count || '-');
        if(meta){
          meta.textContent = t('alert_scanner_scanned','スキャン済み') + ': ' + scanned
            + ' / ' + t('alert_scanner_updated','更新') + ': ' + new Date(lastFetchAt).toLocaleTimeString();
        }
      })
      .catch(function(err){
        if(meta) meta.textContent = t('alert_scanner_error','エラー') + ': ' + (err && err.message ? err.message : 'fetch failed');
      });
  }

  function startPolling(){
    if(pollTimer) return;
    pollTimer = setInterval(function(){
      if(isVisible()) load(false);
    }, POLL_MS);
  }
  function stopPolling(){
    if(pollTimer){ clearInterval(pollTimer); pollTimer = null; }
  }

  function ensureInit(){
    injectUI();
    if(document.getElementById('alertScanner')){
      load(true);
      startPolling();
    }
  }

  // Hook into existing openAlertSection if present
  function hookOpen(){
    if(typeof window.openAlertSection === 'function'){
      var orig = window.openAlertSection;
      if(!orig.__scannerHooked){
        var wrapped = function(){
          var r = orig.apply(this, arguments);
          setTimeout(ensureInit, 50);
          return r;
        };
        wrapped.__scannerHooked = true;
        window.openAlertSection = wrapped;
      }
    }
  }

  document.addEventListener('visibilitychange', function(){
    if(!document.hidden && isVisible()) load(false);
  });

  function boot(){
    hookOpen();
    // If alert section is already on screen, init now
    if(findHost()){
      // Init lazily so we do not waste calls if hidden
      if(isVisible() || document.getElementById('alertScanner') == null){
        ensureInit();
      }
    }
    // Re-try hook periodically in case openAlertSection is defined later
    var tries = 0;
    var retry = setInterval(function(){
      tries++;
      hookOpen();
      if(!document.getElementById('alertScanner') && findHost()){
        injectUI();
      }
      if(tries > 20) clearInterval(retry);
    }, 500);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window._alertScanner = {
    load: load,
    init: ensureInit,
    start: startPolling,
    stop: stopPolling,
    getThreshold: getThreshold,
    setThreshold: setThreshold
  };
})();

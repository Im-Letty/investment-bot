/* Selected market data, independent of headlines and of the legacy watch list. */
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KNMarketData = api;
})(typeof window !== 'undefined' ? window : this, function() {
  'use strict';
  var DEFAULTS = ['日経225', 'ドル円', 'S&P500', 'NYダウ'];
  var SYMBOL = /^[A-Z0-9^][A-Z0-9.^=\-]{0,24}$/;
  var TTL = 60000, RETAIN = 86400000, RETRY = 30000;
  function normalize(value) { return String(value || '').normalize('NFKC').trim().toUpperCase(); }
  function validQuote(q) { return q && Number.isFinite(q.price) && q.price > 0 && (q.pct == null || Number.isFinite(q.pct)); }
  function create(options) {
    var storage = options.storage, clock = options.now || Date.now;
    var catalog = options.catalog.slice(), cache = Object.create(null), pending = Object.create(null), failed = Object.create(null);
    var selected = [], base = Object.create(null), baseTimes = Object.create(null), baseMissing = Object.create(null), baseSeen = false, coreFailed = false;
    function read(key) { try { return JSON.parse(storage.getItem(key) || 'null'); } catch (_) { return null; } }
    function save(key, value) { try { storage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; } }
    function emit() { if (options.onChange) options.onChange(); }
    function find(id) { return catalog.find(function(c) { return c.id === id || c.symbol === id; }); }
    function addCustom(item) {
      if (!item || typeof item.key !== 'string') return;
      var symbol = normalize(item.key);
      if (!SYMBOL.test(symbol) || find(symbol)) return;
      catalog.push({ id: symbol, symbol: symbol, label: String(item.label || symbol).slice(0, 100), category: 'custom', keywords: symbol });
    }
    function validate(ids) {
      if (!Array.isArray(ids)) return [];
      return ids.reduce(function(result, raw) {
        if (typeof raw !== 'string') return result;
        var entry = find(raw);
        if (!entry && SYMBOL.test(normalize(raw))) { addCustom({key: normalize(raw)}); entry = find(normalize(raw)); }
        if (entry && result.indexOf(entry.id) < 0 && result.length < 4) result.push(entry.id);
        return result;
      }, []);
    }
    function hydrate(custom) {
      (Array.isArray(custom) ? custom : []).forEach(addCustom);
      var saved = validate(read('morn_sel'));
      selected = saved.length ? saved : validate(DEFAULTS);
      emit();
    }
    var savedCache = read('kn_market_quotes_v2');
    if (savedCache && typeof savedCache === 'object' && !Array.isArray(savedCache)) {
      Object.keys(savedCache).slice(0, 48).forEach(function(symbol) {
        var record = savedCache[symbol];
        if (SYMBOL.test(symbol) && record && validQuote(record.quote) && Number.isFinite(record.at) && clock() >= record.at && clock() - record.at < RETAIN) cache[symbol] = record;
      });
    }
    hydrate(options.custom);
    function saveCache() {
      var result = Object.create(null);
      Object.keys(cache).sort(function(a,b) { return cache[b].at-cache[a].at; }).slice(0,32).forEach(function(key) { result[key] = cache[key]; });
      save('kn_market_quotes_v2', result);
    }
    function fetchQuote(symbol, full) {
      if (pending[symbol]) return pending[symbol];
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timeout, done = false;
      var request = Promise.resolve().then(function() { return options.fetch('/api/quote?symbol=' + encodeURIComponent(symbol) + (full ? '' : '&light=1'), controller ? {signal: controller.signal} : {}); }).then(function(response) {
        if (!response.ok) throw new Error('quote unavailable');
        return response.json();
      });
      var deadline = new Promise(function(_, reject) { timeout = setTimeout(function() { if (done) return; if (controller) controller.abort(); reject(new Error('timeout')); }, 12000); });
      pending[symbol] = Promise.race([request,deadline]).then(function(quote) {
        if (!validQuote(quote)) throw new Error('invalid quote');
        cache[symbol] = {quote: quote, at: clock()};
        delete failed[symbol]; saveCache(); return quote;
      }).catch(function(error) { failed[symbol] = clock(); throw error; }).finally(function() {
        done = true; clearTimeout(timeout); delete pending[symbol]; emit();
      });
      return pending[symbol];
    }
    function refresh(force) {
      var requests = selected.map(find).filter(Boolean).filter(function(item) { return !item.baseKey; }).map(function(item) {
        var record = cache[item.symbol];
        if (!force && record && clock()-record.at < TTL) return Promise.resolve(record.quote);
        if (!force && failed[item.symbol] != null && clock()-failed[item.symbol] < RETRY) return Promise.resolve(null);
        return fetchQuote(item.symbol, false).catch(function() { return null; });
      });
      emit(); return Promise.all(requests);
    }
    function rows() {
      return selected.map(find).filter(Boolean).map(function(item) {
        if (item.baseKey) {
          var source = base && base[item.baseKey], record = cache[item.symbol];
          var unavailable = coreFailed || !!baseMissing[item.baseKey];
          if (source && typeof source.display === 'string' && source.display && source.display !== '--') return {item:item, display:source.display, at:baseTimes[item.baseKey], failed:unavailable, pending:false};
          return {item:item, quote:record && record.quote, at:record && record.at, failed:unavailable, pending:!baseSeen&&!unavailable};
        }
        var record = cache[item.symbol];
        return {item:item, quote:record && record.quote, at:record && record.at, failed:failed[item.symbol]!=null, pending:!!pending[item.symbol]};
      });
    }
    return {
      catalog: function() { return catalog.slice(); }, find: find,
      selection: function() { return selected.slice(); }, validate: validate, hydrate: hydrate,
      commit: function(ids) {
        var next = validate(ids);
        if (!next.length || !Array.isArray(ids) || ids.length > 4 || next.length !== new Set(ids).size) return false;
        selected = next; save('morn_sel',selected); emit(); refresh(false); return true;
      },
      acceptBase: function(data) {
        if (!data || !data.market) return;
        baseSeen=true;coreFailed=false;
        catalog.filter(function(item){return item.baseKey;}).forEach(function(item){
          var source=data.market[item.baseKey];
          if(source&&typeof source.display==='string'&&source.display&&source.display!=='--'){
            base[item.baseKey]=source;baseTimes[item.baseKey]=Number.isFinite(data.fetched_at)?data.fetched_at*1000:clock();delete baseMissing[item.baseKey];
          }else baseMissing[item.baseKey]=true;
        });
        emit();
      },
      baseFailed: function() { coreFailed=true; emit(); },
      refresh: refresh, rows: rows,
      lookup: function(raw) {
        var symbol = normalize(raw);
        if (/^[0-9A-Z]{4}$/.test(symbol) && /[0-9]/.test(symbol)) symbol += '.T';
        if (!SYMBOL.test(symbol)) return Promise.reject(new Error('invalid symbol'));
        var existing = find(symbol); if (existing) return Promise.resolve(existing);
        return fetchQuote(symbol,true).then(function(q) {
          addCustom({key:symbol,label:q.name || symbol});
          return find(symbol);
        });
      }
    };
  }
  return {create:create, normalize:normalize, validQuote:validQuote};
});

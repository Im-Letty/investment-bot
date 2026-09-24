/* Selected market data, independent of headlines and of the legacy watch list. */
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KNMarketData = api;
})(typeof window !== 'undefined' ? window : this, function() {
  'use strict';
  var DEFAULTS = ['日経225', 'ドル円', 'S&P500', 'NYダウ'];
  var SYMBOL = /^[A-Z0-9^][A-Z0-9.^=\-]{0,24}$/;
  var TTL = 60000, RETAIN = 7 * 86400000, RETRY = 30000;
  function normalize(value) { return String(value || '').normalize('NFKC').trim().toUpperCase(); }
  function validQuote(q) { return q && Number.isFinite(q.price) && q.price > 0 && (q.pct == null || Number.isFinite(q.pct)); }
  // Absolute movement comes from the quote itself, never from its rounded percent.
  function formatChange(quote, item, locale, legacy) {
    var q=quote||{}, entry=item||{}, language=locale||'ja', symbol=entry.symbol||'';
    var delta=Number.isFinite(q.change_value)?q.change_value:null;
    var pct=Number.isFinite(q.pct)?q.pct:null;
    var rate=/^\^(TNX|IRX|FVX|TYX)$/.test(symbol);
    var unit=q.change_unit||(rate?'percentage_points':symbol==='^N225'?'currency':entry.category==='index'||symbol[0]==='^'?'points':'currency');
    var currency=symbol==='^N225'?'JPY':q.currency||entry.currency||'';
    if(!currency && entry.category==='fx')currency=symbol==='JPY=X'?'JPY':/^[A-Z]{6}=X$/.test(symbol)?symbol.slice(3,6):'';
    var units={ja:['ポイント','ポイント'],en:[' pt',' pp'],ko:['포인트','%p'],zh:['点','个百分点']};
    var unitWords=units[language]||units.en, suffix='';
    if(unit==='points')suffix=unitWords[0];
    else if(unit==='percentage_points')suffix=unitWords[1];
    else if(currency){
      var names=language==='ja'?{JPY:'円',USD:'米ドル',EUR:'ユーロ',GBP:'英ポンド',AUD:'豪ドル',CAD:'カナダドル',CHF:'スイスフラン',HKD:'香港ドル',CNY:'人民元',KRW:'ウォン'}:{};
      suffix=names[currency]||' '+currency;
    }
    function signed(value, digits) {
      var rounded=Number(value.toFixed(digits));
      return (rounded>0?'+':rounded<0?'−':'')+Math.abs(rounded).toLocaleString(language,{minimumFractionDigits:digits,maximumFractionDigits:digits});
    }
    var digits=unit==='percentage_points'?3:entry.category==='fx'&&currency!=='JPY'?4:2;
    if(delta!==null && delta!==0)while(digits<6 && Number(delta.toFixed(digits))===0)digits++;
    var amount=delta===null?'':signed(delta,digits)+suffix;
    var percent=pct===null?'':signed(pct,2)+'%';
    var fallback=typeof legacy==='string'?legacy:typeof q.change==='string'?q.change:'';
    if(fallback==='--')fallback='';
    // Old cached data remains usable until a structured quote arrives.
    if(!percent && !amount)percent=fallback;
    var direction=delta!==null?delta:pct!==null?pct:/^[▼−-]/.test(fallback)?-1:/^[▲+]/.test(fallback)?1:0;
    return {amount:amount,percent:percent,direction:direction<0?'down':direction>0?'up':'flat'};
  }
  function create(options) {
    var storage = options.storage, clock = options.now || Date.now;
    var later = options.setTimeout || setTimeout, cancel = options.clearTimeout || clearTimeout;
    var catalog = options.catalog.slice(), cache = Object.create(null), pending = Object.create(null), failed = Object.create(null), checked = Object.create(null);
    var selected = [], base = Object.create(null), baseTimes = Object.create(null), baseMissing = Object.create(null), baseSeen = false, baseRefreshing = false, coreFailed = false;
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
        if (SYMBOL.test(symbol) && record && validQuote(record.quote) && Number.isFinite(record.at) && record.at <= clock()+60000 && clock() - record.at < RETAIN) cache[symbol] = record;
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
      checked[symbol]=clock();
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timeout, done = false;
      var request = Promise.resolve().then(function() { return options.fetch('/api/quote?symbol=' + encodeURIComponent(symbol) + (full ? '' : '&light=1'), controller ? {signal: controller.signal,cache:'no-store'} : {cache:'no-store'}); }).then(function(response) {
        if (!response.ok) throw new Error('quote unavailable');
        return response.json();
      });
      var deadline = new Promise(function(_, reject) { timeout = later(function() { if (done) return; if (controller) controller.abort(); reject(new Error('timeout')); }, 12000); });
      pending[symbol] = Promise.race([request,deadline]).then(function(quote) {
        var at=quote&&Number.isFinite(quote.fetched_at)?quote.fetched_at*1000:NaN;
        if (!validQuote(quote)||!Number.isFinite(at)||at<=0||at>clock()+60000||clock()-at>=RETAIN) throw new Error('invalid quote');
        // The server may return a cached quote. Keep its original retrieval time,
        // and never replace a newer saved snapshot with an older API response.
        if(!cache[symbol]||at>=cache[symbol].at){cache[symbol] = {quote: quote, at: at};delete failed[symbol];saveCache();}
        return quote;
      }).catch(function(error) { failed[symbol] = clock(); throw error; }).finally(function() {
        done = true; cancel(timeout); delete pending[symbol]; emit();
      });
      return pending[symbol];
    }
    function refresh(force) {
      var requests = selected.map(find).filter(Boolean).filter(function(item) { return !item.baseKey; }).map(function(item) {
        var record = cache[item.symbol];
        if (!force && failed[item.symbol] != null && clock()-failed[item.symbol] < RETRY) return Promise.resolve(null);
        // Request-start time prevents network latency from turning one-minute
        // polling into an accidental two-minute interval.
        if (!force && failed[item.symbol] == null && record && clock()-(checked[item.symbol] == null?record.at:checked[item.symbol]) < TTL) return Promise.resolve(record.quote);
        return fetchQuote(item.symbol, false).catch(function() { return null; });
      });
      emit(); return Promise.all(requests);
    }
    function rows() {
      return selected.map(find).filter(Boolean).map(function(item) {
        if (item.baseKey) {
          var source = base && base[item.baseKey], record = cache[item.symbol];
          var unavailable = coreFailed || !!baseMissing[item.baseKey];
          if (source && typeof source.display === 'string' && source.display && source.display !== '--' && (!record || baseTimes[item.baseKey] >= record.at)) return {item:item, display:source.display, quote:validQuote(source)?source:undefined, at:baseTimes[item.baseKey], failed:unavailable, pending:false, stale:clock()-baseTimes[item.baseKey]>=TTL};
          return {item:item, quote:record && record.quote, at:record && record.at, failed:unavailable, pending:(!baseSeen||baseRefreshing)&&!unavailable, stale:!!record&&clock()-record.at>=TTL};
        }
        var record = cache[item.symbol];
        return {item:item, quote:record && record.quote, at:record && record.at, failed:failed[item.symbol]!=null, pending:!!pending[item.symbol], stale:!!record&&clock()-record.at>=TTL};
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
        baseSeen=true;baseRefreshing=!!data.refreshing;coreFailed=false;
        catalog.filter(function(item){return item.baseKey;}).forEach(function(item){
          var source=data.market[item.baseKey];
          if(source&&typeof source.display==='string'&&source.display&&source.display!=='--'){
            var at=Number.isFinite(source.fetched_at)?source.fetched_at*1000:Number.isFinite(data.fetched_at)?data.fetched_at*1000:clock();
            if(!baseTimes[item.baseKey]||at>=baseTimes[item.baseKey]){base[item.baseKey]=source;baseTimes[item.baseKey]=at;}
            if(validQuote(source)&&(!cache[item.symbol]||at>=cache[item.symbol].at))cache[item.symbol]={quote:source,at:at};
            delete baseMissing[item.baseKey];
          }else baseMissing[item.baseKey]=!baseRefreshing;
        });
        saveCache();
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
  return {create:create, normalize:normalize, validQuote:validQuote, formatChange:formatChange};
});

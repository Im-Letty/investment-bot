/* Dividend snapshots: show saved data first; share refreshes across the tabs. */
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    var storage; try { storage = root.localStorage; } catch (_) {}
    root.KNDividendData = api.create({fetch:root.fetch.bind(root), storage:storage});
    // Warm the shared server snapshot after the initial page has settled.
    root.setTimeout(function() {
      if (!root.document.hidden) root.KNDividendData.get('top').catch(function() {});
    }, 8000);
  }
})(typeof window !== 'undefined' ? window : this, function() {
  'use strict';
  var PREFIX='kn_dividend_snapshot_v1:', RETAIN=7*86400000, TTL=300000;
  function time(value) {
    if (typeof value==='number') return value<1e12?value*1000:value;
    return typeof value==='string'?Date.parse(value):NaN;
  }
  function validKey(key) { return /^(top|yearly|calendar\?month=\d{4}-(0[1-9]|1[0-2])|search\?q=[A-Za-z0-9_.!~*'()%\-]{1,300})$/.test(key); }
  function usable(key, data) {
    if (!data || !Number.isFinite(time(data.updated_at))) return false;
    if (key.indexOf('calendar')===0) return Array.isArray(data.days) && ['ready','stale'].indexOf(data.status)>=0;
    if (key.indexOf('search')===0) return typeof data.ticker==='string' && (Number.isFinite(data.price)||Number.isFinite(data.annual_dividend));
    return Array.isArray(data.items) && data.items.length>0;
  }
  function create(options) {
    var now=options.now||Date.now, later=options.setTimeout||setTimeout, cancel=options.clearTimeout||clearTimeout;
    var cache=Object.create(null), pending=Object.create(null), checked=Object.create(null);
    function peek(key) {
      if (!validKey(key)) return null;
      if (!cache[key]) {
        try { cache[key]=JSON.parse(options.storage.getItem(PREFIX+key)||'null'); } catch (_) {}
      }
      var data=cache[key], age=data?now()-time(data.updated_at):Infinity;
      return usable(key,data) && age>=-60000 && age<RETAIN?data:null;
    }
    function get(key, force) {
      if (!validKey(key)) return Promise.reject(new Error('Invalid dividend request'));
      if (pending[key]) return pending[key];
      var saved=peek(key);
      if (!force && saved && checked[key] && now()-checked[key]<TTL) return Promise.resolve(saved);
      var controller=typeof AbortController!=='undefined'?new AbortController():null, timer;
      var url='/api/dividend/'+(key==='top'||key==='yearly'?key+'?limit=20':key);
      var timeout=new Promise(function(_,reject) {
        timer=later(function() { if(controller)controller.abort(); reject(new Error('Timeout')); },10000);
      });
      var request=Promise.resolve().then(function() {
        return options.fetch(url,{signal:controller?controller.signal:undefined});
      }).then(function(r) { if(!r.ok)throw new Error('Dividend unavailable'); return r.json(); });
      pending[key]=Promise.race([request,timeout]).then(function(data) {
        if (!data || typeof data!=='object') throw new Error('Invalid dividend data');
        if (usable(key,data)) {
          var previous=peek(key);
          // A delayed worker response must not roll the displayed snapshot back.
          if (!previous || time(data.updated_at)>=time(previous.updated_at)) {
            cache[key]=data;
            try { options.storage.setItem(PREFIX+key,JSON.stringify(data)); } catch (_) {}
          }
          if (!data.refreshing && data.status==='ready') checked[key]=now();
          return cache[key];
        }
        var retained=peek(key);
        if (retained) return Object.assign({},retained,{status:'stale',refreshing:!!data.refreshing});
        return data;
      }).finally(function() { cancel(timer); delete pending[key]; });
      return pending[key];
    }
    function watch(key,onData,onError,isActive) {
      var stopped=false, timer, start=now(), saved=peek(key);
      if (saved) onData(saved,true);
      function active() { return !stopped && (!isActive || isActive()); }
      function refresh(force) {
        get(key,force).then(function(data) {
          if (!active()) return;
          onData(data,false);
          if (data.refreshing) {
            if(now()-start<90000)timer=later(function(){if(active())refresh(true);},3000);
            else if(onError)onError(new Error('Still refreshing'),peek(key));
          }
        }).catch(function(err) { if(active()&&onError)onError(err,peek(key)); });
      }
      refresh(false);
      return function() { stopped=true; cancel(timer); };
    }
    return {get:get,peek:peek,watch:watch};
  }
  return {create:create,time:time};
});

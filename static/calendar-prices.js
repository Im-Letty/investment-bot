/* Visible calendar quotes: bounded requests, saved prices and one-minute cadence. */
(function(root,factory){
  var api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.KNCalendarPrices=api;
})(typeof window!=='undefined'?window:globalThis,function(root){
  'use strict';
  var KEY='kn_calendar_prices_v1',INTERVAL=60000,TIMEOUT=12000,RETAIN=7*86400000,MAX=100;
  function symbol(value){
    if(typeof value!=='string')return null;
    value=value.normalize('NFKC').trim().toUpperCase();
    if(/^[0-9][0-9A-Z]{3}$/.test(value))value+='.T';
    return /^[0-9][0-9A-Z]{3}\.T$/.test(value)?value:null;
  }
  function validQuote(raw,ticker,now){
    if(!raw||typeof raw!=='object'||raw.symbol!==ticker||raw.currency!=='JPY'||
      !Number.isFinite(raw.price)||raw.price<=0||raw.source!=='Yahoo Finance')return null;
    var fetched=raw.fetched_at,priced=raw.price_updated_at;
    if(!Number.isFinite(fetched)||!Number.isFinite(priced)||fetched<=0||priced<=0||
      priced>fetched||fetched*1000>now||priced*1000>now||
      now-fetched*1000>=RETAIN||now-priced*1000>=RETAIN)return null;
    var quote={symbol:ticker,price:raw.price,currency:'JPY',fetched_at:fetched,
      price_updated_at:priced,source:'Yahoo Finance'};
    if(Number.isFinite(raw.delay_minutes)&&raw.delay_minutes>=0&&raw.delay_minutes<=1440)
      quote.delay_minutes=raw.delay_minutes;
    return quote;
  }
  function create(env,onUpdate){
    env=env||{};
    var now=env.now||Date.now,later=env.setTimeout||root.setTimeout.bind(root),
      cancel=env.clearTimeout||root.clearTimeout.bind(root),fetcher=env.fetch||(root.fetch&&root.fetch.bind(root)),
      Controller=env.AbortController||root.AbortController,storage=env.storage;
    if(!storage)try{storage=root.localStorage;}catch(_){}
    var selected=new Set(),quotes=Object.create(null),started=Object.create(null),errors=Object.create(null),
      jobs=new Map(),queue=new Set(),timer=null,paused=false;
    function readSaved(){
      try{
        var text=storage&&storage.getItem(KEY);
        if(!text||text.length>200000)return;
        var saved=JSON.parse(text);
        if(!saved||saved.version!==1||!Array.isArray(saved.quotes))return;
        saved.quotes.slice(0,MAX).forEach(function(raw){
          var ticker=symbol(raw&&raw.symbol),quote=ticker&&validQuote(raw,ticker,now());
          if(quote&&(!quotes[ticker]||quote.price_updated_at>quotes[ticker].price_updated_at))quotes[ticker]=quote;
        });
      }catch(_){}
    }
    function persist(){
      var saved=Object.keys(quotes).map(function(ticker){return validQuote(quotes[ticker],ticker,now());})
        .filter(Boolean).sort(function(a,b){return b.fetched_at-a.fetched_at;}).slice(0,MAX);
      quotes=Object.create(null);saved.forEach(function(quote){quotes[quote.symbol]=quote;});
      try{if(storage)storage.setItem(KEY,JSON.stringify({version:1,quotes:saved}));}catch(_){}
    }
    function peek(value){
      var ticker=symbol(value);if(!ticker)return null;
      var quote=validQuote(quotes[ticker],ticker,now());
      if(!quote)delete quotes[ticker];
      return {quote:quote,pending:jobs.has(ticker)||queue.has(ticker),error:errors[ticker]||null,
        stale:!quote||!!errors[ticker]||now()-quote.fetched_at*1000>=INTERVAL};
    }
    function notify(ticker){
      if(selected.has(ticker)&&typeof onUpdate==='function')try{onUpdate(ticker,peek(ticker));}catch(_){}
    }
    function dueAt(ticker){
      if(Object.prototype.hasOwnProperty.call(started,ticker))return started[ticker]+INTERVAL;
      var quote=validQuote(quotes[ticker],ticker,now());
      return quote?quote.fetched_at*1000+INTERVAL:now();
    }
    function schedule(){
      if(timer!==null){cancel(timer);timer=null;}
      if(paused||!selected.size)return;
      var next=Infinity;
      selected.forEach(function(ticker){
        if(!jobs.has(ticker)&&!queue.has(ticker))next=Math.min(next,dueAt(ticker));
      });
      if(Number.isFinite(next))timer=later(function(){timer=null;refresh(false);},Math.max(0,next-now()));
    }
    function stopJob(ticker){
      var job=jobs.get(ticker);if(!job)return;
      jobs.delete(ticker);cancel(job.timer);
      if(job.controller)try{job.controller.abort();}catch(_){}
    }
    function finish(ticker,job,raw,error){
      if(jobs.get(ticker)!==job||paused||!selected.has(ticker))return;
      jobs.delete(ticker);cancel(job.timer);
      var quote=!error&&validQuote(raw,ticker,now()),previous=validQuote(quotes[ticker],ticker,now());
      if(quote&&previous&&(quote.price_updated_at<previous.price_updated_at||quote.fetched_at<previous.fetched_at||
        (quote.price_updated_at===previous.price_updated_at&&quote.price!==previous.price)))quote=null;
      if(quote){quotes[ticker]=quote;delete errors[ticker];persist();}
      else errors[ticker]=error==='timeout'?'timeout':'unavailable';
      notify(ticker);pump();schedule();
    }
    function start(ticker){
      var job={controller:Controller?new Controller():null,timer:null};
      jobs.set(ticker,job);started[ticker]=now();
      job.timer=later(function(){
        if(jobs.get(ticker)!==job)return;
        if(job.controller)try{job.controller.abort();}catch(_){}
        finish(ticker,job,null,'timeout');
      },TIMEOUT);
      Promise.resolve().then(function(){
        if(jobs.get(ticker)!==job||paused||!selected.has(ticker))return null;
        if(!fetcher)throw new Error('Unavailable');
        return fetcher('/api/quote?symbol='+encodeURIComponent(ticker)+'&light=1',
          {signal:job.controller?job.controller.signal:undefined,cache:'no-store'});
      }).then(function(response){
        if(jobs.get(ticker)!==job)return null;
        if(!response||!response.ok)throw new Error('Unavailable');
        return response.json();
      }).then(function(data){finish(ticker,job,data,null);},function(){finish(ticker,job,null,'unavailable');});
    }
    function pump(){
      if(paused)return;
      while(jobs.size<3&&queue.size){
        var ticker=queue.values().next().value;queue.delete(ticker);
        if(selected.has(ticker)&&!jobs.has(ticker))start(ticker);
      }
    }
    function refresh(force){
      if(paused)return;
      selected.forEach(function(ticker){
        if(!jobs.has(ticker)&&!queue.has(ticker)&&(force||dueAt(ticker)<=now())){
          queue.add(ticker);notify(ticker);
        }
      });
      pump();schedule();
    }
    function setSymbols(values){
      var next=new Set();
      if(Array.isArray(values))values.slice(0,1000).forEach(function(value){
        var ticker=symbol(value);if(ticker&&next.size<MAX)next.add(ticker);
      });
      selected.forEach(function(ticker){
        if(!next.has(ticker)){stopJob(ticker);queue.delete(ticker);delete started[ticker];delete errors[ticker];}
      });
      selected=next;
      selected.forEach(notify);refresh(false);
      if(paused)schedule();
    }
    function pause(){
      paused=true;if(timer!==null){cancel(timer);timer=null;}
      Array.from(jobs.keys()).forEach(function(ticker){stopJob(ticker);delete started[ticker];});
      queue.clear();selected.forEach(notify);
    }
    function resume(){paused=false;refresh(false);}
    readSaved();
    return {setSymbols:setSymbols,refresh:refresh,pause:pause,resume:resume,peek:peek};
  }
  return {create:create};
});

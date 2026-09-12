/* Public morning data: independent requests, one request per resource, keep content while refreshing. */
(function(){
  'use strict';
  var newsCache={}, newsPending={}, newsTimers={}, newsAttempts={}, marketPending=null, marketRetry=null;
  var NEWS_TTL=120000, MAX_NEWS_AGE=900000, MAX_MARKET_AGE=120000;
  var shownLanguage=null, newsLoadedAt={}, started=false;
  var copy={
    ja:{loading:'ニュースを準備しています',updated:'取得',pending:'翻訳中',stale:'最新情報を確認中',failed:'いま更新できません。表示中の取得時刻をご確認ください。',empty:'ニュースを取得できませんでした。',retry:'もう一度読み込む'},
    en:{loading:'Preparing headlines',updated:'Retrieved',pending:'Translating',stale:'Checking for updates',failed:'Unable to refresh. Please check the retrieval time.',empty:'Unable to load headlines.',retry:'Try again'},
    ko:{loading:'뉴스를 준비하고 있습니다',updated:'가져온 시각',pending:'번역 중',stale:'최신 정보 확인 중',failed:'업데이트할 수 없습니다. 가져온 시각을 확인해 주세요.',empty:'뉴스를 가져올 수 없습니다.',retry:'다시 시도'},
    zh:{loading:'正在准备新闻',updated:'获取时间',pending:'翻译中',stale:'正在检查更新',failed:'暂时无法更新，请查看获取时间。',empty:'无法获取新闻。',retry:'重试'}
  };
  function lang(){var l='ja';try{l=localStorage.getItem('app_lang')||localStorage.getItem('siteLang')||document.documentElement.lang||'ja';}catch(e){}return copy[l]?l:'ja';}
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function read(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch(e){return null;}}
  function save(key,data){try{localStorage.setItem(key,JSON.stringify(data));}catch(e){}}
  function validNews(d,l){return d&&d.lang===l&&Number.isFinite(d.fetched_at)&&Date.now()-d.fetched_at*1000>=0&&Date.now()-d.fetched_at*1000<MAX_NEWS_AGE&&Array.isArray(d.news)&&d.news.length>0&&d.news.length<=28&&d.news.every(function(x){return x&&typeof x.source==='string'&&x.source.length<100&&typeof x.title==='string'&&x.title.length<=2000;});}
  function cachedNews(l){if(!validNews(newsCache[l],l))newsCache[l]=read('kn_news_v1_'+l);return validNews(newsCache[l],l)?newsCache[l]:null;}
  function fetchJSON(url){
    var controller=typeof AbortController==='function'?new AbortController():null;
    var timer=controller?setTimeout(function(){controller.abort();},12000):null;
    return fetch(url,controller?{signal:controller.signal}:undefined).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}).finally(function(){if(timer)clearTimeout(timer);});
  }
  function drawNews(d,l,failed){
    if(l!==lang())return;
    var el=document.getElementById('morning-news-content');if(!el)return;
    var groups=Object.create(null),c=copy[l];
    d.news.forEach(function(item){(groups[item.source]||(groups[item.source]=[])).push(item.title);});
    var html=Object.keys(groups).map(function(source){return '<div class="morning-news-source-block"><span class="morning-news-source-label">'+esc(window.translateNewsSource?window.translateNewsSource(source):source)+'</span>'+groups[source].map(function(title){return '<div class="morning-news-item">'+esc(title)+'</div>';}).join('')+'</div>';}).join('');
    var stamp=new Date(d.fetched_at*1000).toLocaleString(l,{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
    html+='<div class="morning-news-updated">'+esc(c.updated+' '+stamp)+(failed?' · '+esc(c.failed):d.translation_pending?' · '+esc(c.pending):d.stale?' · '+esc(c.stale):'')+'</div>';
    if(el.innerHTML!==html)el.innerHTML=html;
    el.setAttribute('aria-busy','false');shownLanguage=l;
  }
  function drawLoading(l){
    var el=document.getElementById('morning-news-content');if(!el)return;
    if(shownLanguage===l&&el.getAttribute('aria-busy')==='true')return;
    el.innerHTML='<div class="morning-news-skeleton" role="status" aria-label="'+esc(copy[l].loading)+'"><span></span><i></i><i></i><i></i><i></i></div>';
    el.setAttribute('aria-busy','true');shownLanguage=l;
  }
  function drawFailure(l){
    if(l!==lang())return;var el=document.getElementById('morning-news-content');if(!el)return;
    el.innerHTML='<div class="morning-news-error">'+esc(copy[l].empty)+' <button type="button" class="morning-news-retry">'+esc(copy[l].retry)+'</button></div>';
    el.setAttribute('aria-busy','false');var button=el.querySelector('button');
    if(button)button.onclick=function(){newsAttempts[l]=0;return loadNews(true);};
  }
  function scheduleNews(l){
    clearTimeout(newsTimers[l]);
    if((newsAttempts[l]||0)>=8)return;
    newsAttempts[l]=(newsAttempts[l]||0)+1;
    newsTimers[l]=setTimeout(function(){if(lang()===l&&!document.hidden)loadNews(true);},Math.min(10000,1500*newsAttempts[l]));
  }
  function loadNews(force){
    var l=lang(),cached=cachedNews(l);
    if(cached)drawNews(cached,l);else drawLoading(l);
    if(newsPending[l])return newsPending[l];
    if(!force&&cached&&!cached.refreshing&&!cached.translation_pending&&Date.now()-(newsLoadedAt[l]||0)<NEWS_TTL)return Promise.resolve(cached);
    clearTimeout(newsTimers[l]);
    newsPending[l]=fetchJSON('/api/morning-news?lang='+encodeURIComponent(l)).then(function(d){
      if(d.error||!Array.isArray(d.news))throw new Error('Unavailable news');
      if(validNews(d,l)){
        newsCache[l]=d;newsLoadedAt[l]=Date.now();save('kn_news_v1_'+l,d);drawNews(d,l);
        if(d.refreshing||d.translation_pending)scheduleNews(l);else newsAttempts[l]=0;
      }else if(d.refreshing){scheduleNews(l);if(cached)drawNews(cached,l,true);else if((newsAttempts[l]||0)>=8)drawFailure(l);}
      else throw new Error('Empty news');
      return d;
    }).catch(function(){
      var previous=cachedNews(l);
      if(previous){drawNews(previous,l,true);newsLoadedAt[l]=Date.now()-NEWS_TTL+15000;}
      else drawFailure(l);
      scheduleNews(l);
    }).finally(function(){delete newsPending[l];});
    return newsPending[l];
  }
  function drawMarket(d){
    _mktCache=d.market;renderMorningGrid(_mktCache);
    window.__knHomeABase=d;if(window.knHomeA)window.knHomeA.acceptBase(d);
    var t=document.getElementById('morning-update-time');if(t)t.textContent=d.updated||'--';
    var tr=window.t||function(k){return k;};
    var a=document.getElementById('morning-analysis');if(a)a.innerHTML='<strong>'+esc(tr('data_updated'))+': '+esc(d.updated||'--')+'</strong>'+(d.market['VIX恐怖指数']?'<br>VIX: '+esc(d.market['VIX恐怖指数'].display):'')+(d.market['米10年金利']?esc(tr('mkt_us_rate_label'))+esc(d.market['米10年金利'].display):'');
    var p=document.getElementById('morning-points');if(p)p.innerHTML='✅ <strong>'+esc(tr('mp_latest'))+'</strong><br>✅ '+esc(tr('mp_morning_line'));
  }
  function loadMarket(){
    if(marketPending)return marketPending;
    if(_mktCache&&Date.now()-_mktLastFetch<_mktFetchSec*1000){renderMorningGrid(_mktCache);return Promise.resolve(_mktCache);}
    clearTimeout(marketRetry);
    marketPending=fetchJSON('/api/morning-data').then(function(d){
      if(d.error||!d.market||!Object.keys(d.market).length)throw new Error('Unavailable market');
      _mktLastFetch=Date.now();_mktCountdown=_mktFetchSec;window.__mdTry=0;
      drawMarket(d);if(Number.isFinite(d.fetched_at))save('kn_market_v1',d);
      return d;
    }).catch(function(){
      if(window.knHomeA)window.knHomeA.baseFailed();
      if(_mktCache){renderMorningGrid(_mktCache);return;}
      var a=document.getElementById('morning-analysis');if(a)a.textContent='市場データを確認しています。ニュースはそのままご覧いただけます。';
      window.__mdTry=(window.__mdTry||0)+1;
      if(window.__mdTry<=8)marketRetry=setTimeout(loadMarket,Math.min(10000,1500*window.__mdTry));
    }).finally(function(){marketPending=null;});return marketPending;
  }
  function start(){
    if(!started){
      started=true;var cached=read('kn_market_v1');
      if(cached&&cached.market&&Number.isFinite(cached.fetched_at)&&Date.now()-cached.fetched_at*1000>=0&&Date.now()-cached.fetched_at*1000<MAX_MARKET_AGE)drawMarket(cached);
    }
    // Start news first, independently of the market response and intro timeline.
    loadNews();loadMarket();
    if(_mktInterval)clearInterval(_mktInterval);
    _mktInterval=setInterval(function(){
      if(document.hidden)return;
      _mktCountdown--;var c=document.getElementById('morning-countdown');if(c)c.textContent=Math.max(0,_mktCountdown);
      if(_mktCountdown<=0){_mktCountdown=_mktFetchSec;loadNews();loadMarket();}
    },1000);
  }
  window.loadMorningNews=loadNews;window.loadMorningData=loadMarket;window.startMorningInterval=start;
  document.addEventListener('visibilitychange',function(){if(!document.hidden){loadNews();loadMarket();}});
  document.addEventListener('langChanged',function(){loadNews();});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();

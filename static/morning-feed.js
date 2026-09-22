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
  var digestCopy={
    ja:{title:'経済ニュース',date:'取得日',period:'各配信元から取得した見出しです。記事の発表日はそれぞれ異なります。',more:'もっと詳しく',close:'説明を閉じる',intro:'気になる配信元を開いて、見出しを読む。',source:'配信元',count:function(n){return n+'件の見出し';}},
    en:{title:'Economic news',date:'Retrieved',period:'Headlines retrieved from publishers. Article publication dates vary.',more:'Read more',close:'Close details',intro:'Choose a publisher to read its headlines.',source:'Publisher',count:function(n){return n+' headlines';}},
    ko:{title:'경제 뉴스',date:'가져온 날짜',period:'언론사에서 가져온 헤드라인입니다. 각 기사의 발행일은 다릅니다.',more:'더 자세히',close:'설명 닫기',intro:'언론사를 선택해 헤드라인을 읽어 보세요.',source:'언론사',count:function(n){return '헤드라인 '+n+'개';}},
    zh:{title:'经济新闻',date:'获取日期',period:'以下标题来自各媒体，文章的发布日期各不相同。',more:'了解更多',close:'收起详情',intro:'选择媒体，阅读新闻标题。',source:'媒体',count:function(n){return n+'条标题';}}
  };
  function newsSource(source){return window.translateNewsSource?window.translateNewsSource(source):source;}
  function digestMarkup(d,l,status){
    var c=digestCopy[l],groups=Object.create(null),featured=[],seen=Object.create(null);
    d.news.forEach(function(item){(groups[item.source]||(groups[item.source]=[])).push(item.title);});
    // Show at most three supplied headlines first, while retaining every source
    // below. These are not AI summaries or claims about publication dates.
    for(var row=0;row<7&&featured.length<3;row++)Object.keys(groups).forEach(function(source){
      var title=groups[source][row];if(featured.length<3&&title&&!seen[title]){seen[title]=true;featured.push({source:source,title:title});}
    });
    var fetched=new Date(d.fetched_at*1000),jst=new Date(d.fetched_at*1000+9*60*60*1000);
    var year=jst.getUTCFullYear(),month=String(jst.getUTCMonth()+1).padStart(2,'0'),day=String(jst.getUTCDate()).padStart(2,'0');
    var dateKey=year+'-'+month+'-'+day,weekday=fetched.toLocaleDateString(l,{timeZone:'Asia/Tokyo',weekday:'long'});
    var calendar='<div class="calendar" aria-label="'+esc(c.date+' '+dateKey+' '+weekday)+'"><strong>'+day+'</strong><small>'+esc(weekday)+'</small></div>';
    var brief=featured.map(function(item){return '<div class="brief-part"><p>'+esc(item.title)+'</p><span class="headline-source">'+esc(newsSource(item.source))+'</span></div>';}).join('');
    var stories=Object.keys(groups).map(function(source){
      var key='source:'+source;
      return '<details class="story" name="kn-news-sources" data-news-key="'+esc(key)+'"><summary data-news-focus="'+esc(key)+'"><h4><span class="story-category">'+esc(c.source)+'</span><span class="story-title">'+esc(newsSource(source))+'</span><span class="story-takeaway">'+esc(c.count(groups[source].length))+'</span></h4><span class="plus" aria-hidden="true"></span></summary><div class="story-content"><ul class="headline-list">'+groups[source].map(function(title){return '<li>'+esc(title)+'</li>';}).join('')+'</ul></div></details>';
    }).join('');
    return '<article id="knNewsDigest" class="news-card journal" aria-labelledby="knNewsDigestTitle"><header class="news-header">'+calendar+'<div class="heading-text"><h3 id="knNewsDigestTitle">'+esc(c.title)+'</h3></div><p class="news-period">'+esc(c.period)+'</p></header><div class="news-content"><div class="brief">'+brief+'</div><details class="read-more" data-news-key="more"><summary data-news-focus="more"><span class="closed-label">'+esc(c.more)+'</span><span class="open-label">'+esc(c.close)+'</span><span class="read-arrow" aria-hidden="true">↗</span></summary><div class="stories editorial-detail"><p class="stories-intro">'+esc(c.intro)+'</p>'+stories+'</div></details><footer class="news-footer"><p>'+esc(status)+'</p></footer></div></article>';
  }
  function replaceNews(el,html,l){
    if(el.innerHTML===html)return;
    var opened=Object.create(null),focus=null;
    if(shownLanguage===l){
      el.querySelectorAll('details[data-news-key]').forEach(function(node){if(node.open)opened[node.getAttribute('data-news-key')]=true;});
      if(document.activeElement&&el.contains(document.activeElement))focus=document.activeElement.getAttribute('data-news-focus');
    }
    el.innerHTML=html;
    el.querySelectorAll('details[data-news-key]').forEach(function(node){node.open=!!opened[node.getAttribute('data-news-key')];});
    if(focus){
      var target=null,fallback=null;
      el.querySelectorAll('[data-news-focus]').forEach(function(node){var key=node.getAttribute('data-news-focus');if(key===focus)target=node;if(key==='more')fallback=node;});
      if(target||fallback)(target||fallback).focus({preventScroll:true});
    }
  }
  function drawNews(d,l,failed){
    if(l!==lang())return;
    var el=document.getElementById('morning-news-content');if(!el)return;
    var c=copy[l],stamp=new Date(d.fetched_at*1000).toLocaleString(l,{timeZone:'Asia/Tokyo',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
    var status=c.updated+' '+stamp+' JST'+(failed?' · '+c.failed:d.translation_pending?' · '+c.pending:d.stale?' · '+c.stale:'');
    replaceNews(el,digestMarkup(d,l,status),l);
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

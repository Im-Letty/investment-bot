/* Public morning data: independent requests, one request per resource, keep content while refreshing. */
(function(){
  'use strict';
  var newsCache={}, newsPending={}, newsTimers={}, newsAttempts={}, marketPending=null, marketRetry=null;
  var NEWS_TTL=120000, MAX_NEWS_AGE=900000, MAX_MARKET_AGE=7*86400000;
  var shownLanguage=null, shownEdition=null, shownNews=null, shownState=null, newsLoadedAt={}, started=false;
  var initialNews=null, initialRead=false, publishedNews={}, publishedRead={}, newsPeriods={};
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
  function editionKey(stamp){var date=new Date(stamp*1000+9*60*60*1000);return Number.isFinite(date.getTime())?date.toISOString().slice(0,10):'';}
  function publicationPeriod(){return editionKey(Date.now()/1000-8*60*60);}
  function curatedPublication(d){return !!(d&&d.delivery==='published'&&d.digest&&d.digest.publication_mode==='curated');}
  function safeNewsURL(value){try{var u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch(_){return '';}}
  function validEdition(d,l){
    var now=Date.now()/1000,today=editionKey(now);
    if(!d||d.policy_version!==4||d.lang!==l||typeof d.edition_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d.edition_date)||d.edition_date>today||(!curatedPublication(d)&&d.edition_date!==today)||!['ready','empty_today'].includes(d.selection_status)||!Array.isArray(d.news)||d.news.length>3||!Array.isArray(d.supplements)||d.supplements.length>1)return false;
    function article(x,older){
      if(!x||typeof x.source!=='string'||x.source.length>=100||typeof x.title!=='string'||!x.title.trim()||x.title.length>2000||!safeNewsURL(x.url)||!Number.isFinite(x.published_at)||x.published_at>now)return false;
      var date=editionKey(x.published_at);
      if(x.published_date!==date)return false;
      return older?date<d.edition_date&&Date.parse(d.edition_date)-Date.parse(date)<=7*86400000&&x.is_supplement===true&&typeof x.editorial_reason==='string'&&!!x.editorial_reason.trim():date===d.edition_date;
    }
    return d.news.every(function(x){return article(x,false);})&&d.supplements.every(function(x){return article(x,true);});
  }
  function validNews(d,l){
    var now=Date.now()/1000;
    return validEdition(d,l)&&d.delivery!=='published'&&Number.isFinite(d.fetched_at)&&now-d.fetched_at>=0&&now-d.fetched_at<MAX_NEWS_AGE/1000;
  }
  function validPublished(d,l){return validEdition(d,l)&&d.delivery==='published'&&d.fetched_at===null&&!!reviewedDigest(d);}
  function rememberPublished(d,l){
    if(!validPublished(d,l))return;
    var previous=publishedNews[l];
    function releasedAt(item){return item.digest.publish_at==null?item.digest.reviewed_at||0:item.digest.publish_at;}
    if(validPublished(previous,l)&&((curatedPublication(previous)&&!curatedPublication(d))||previous.edition_date>d.edition_date||(previous.edition_date===d.edition_date&&releasedAt(previous)>releasedAt(d))))return;
    publishedNews[l]=d;
    if(curatedPublication(d))save('kn_published_news_v1_'+l,d);
  }
  function clearPublished(l){
    if(initialNews&&initialNews.lang===l)initialNews=null;
    delete publishedNews[l];
    try{localStorage.removeItem('kn_published_news_v1_'+l);}catch(e){}
  }
  function cachedNews(l){
    if(!initialRead){
      initialRead=true;
      try{var node=document.getElementById('knInitialNews');initialNews=node?JSON.parse(node.textContent):null;}catch(_){initialNews=null;}
      // Native <details> are already usable in server-rendered HTML. Preserve
      // a reader's open panel and focus when JavaScript first takes over.
      if(shownLanguage===null&&(validNews(initialNews,l)||validPublished(initialNews,l))){shownLanguage=l;shownEdition=initialNews.edition_date;}
    }
    if(!publishedRead[l]){
      publishedRead[l]=true;var saved=read('kn_published_news_v1_'+l);
      if(initialNews&&initialNews.lang===l&&initialNews.publication_revoked===true){
        var correction=initialNews;clearPublished(l);initialNews=correction;
      }else if(curatedPublication(saved))rememberPublished(saved,l);
      if(initialNews&&initialNews.lang===l)rememberPublished(initialNews,l);
    }
    if(!validNews(newsCache[l],l))newsCache[l]=read('kn_news_v4_'+l);
    if(validNews(initialNews,l)&&(!validNews(newsCache[l],l)||initialNews.fetched_at>newsCache[l].fetched_at))newsCache[l]=initialNews;
    return validPublished(publishedNews[l],l)?publishedNews[l]:validNews(newsCache[l],l)?newsCache[l]:null;
  }
  function reviewedDigest(d){
    var digest=d.digest;
    if(!digest||digest.lang!=='ja'||digest.edition_date!==d.edition_date||typeof digest.headline!=='string'||!digest.headline.trim()||Array.from(digest.headline).length>80||typeof digest.summary!=='string'||Array.from(digest.summary).length<200||Array.from(digest.summary).length>300||!Array.isArray(digest.article_refs)||!d.news.length||digest.article_refs.length!==d.news.length)return null;
    if(digest.publication_mode!=null&&digest.publication_mode!=='curated')return null;
    if(digest.publication_mode==='curated'&&(digest.article_refs.length<2||digest.article_refs.length>3||!Number.isFinite(digest.reviewed_at)||digest.reviewed_at>Date.now()/1000||editionKey(digest.reviewed_at)!==d.edition_date||digest.article_refs.some(function(ref){return !ref||!Number.isFinite(ref.published_at)||ref.published_at>digest.reviewed_at;})))return null;
    if(Object.prototype.hasOwnProperty.call(digest,'publish_at')&&(!Number.isFinite(digest.publish_at)||digest.publication_mode!=='curated'||digest.publish_at<digest.reviewed_at||digest.publish_at>Date.now()/1000||editionKey(digest.publish_at)!==d.edition_date))return null;
    var used=new Set();
    var matches=digest.article_refs.every(function(ref){
      if(!ref||!safeNewsURL(ref.url)||used.has(ref.url))return false;
      used.add(ref.url);
      return d.news.some(function(item){return ref.url===item.url&&ref.source===item.source&&ref.published_at===item.published_at&&(d.lang!=='ja'||ref.title===item.title);});
    });
    if(Object.prototype.hasOwnProperty.call(digest,'article_summaries')){
      var summaries=digest.article_summaries,covered=new Set();
      if(!Array.isArray(summaries)||summaries.length!==digest.article_refs.length)return null;
      if(!summaries.every(function(item){
        if(!item||typeof item.headline!=='string'||!item.headline.trim()||Array.from(item.headline.trim()).length>80||typeof item.summary!=='string'||Array.from(item.summary.trim()).length<200||Array.from(item.summary.trim()).length>300||covered.has(item.url))return false;
        covered.add(item.url);
        return digest.article_refs.some(function(ref){return item.source===ref.source&&item.url===ref.url&&item.published_at===ref.published_at&&item.title===ref.title;});
      }))return null;
    }
    return matches?digest:null;
  }
  function fetchJSON(url){
    var controller=typeof AbortController==='function'?new AbortController():null;
    var timer=controller?setTimeout(function(){controller.abort();},12000):null;
    return fetch(url,controller?{signal:controller.signal}:undefined).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}).finally(function(){if(timer)clearTimeout(timer);});
  }
  var digestCopy={
    ja:{title:'経済ニュース',date:'掲載対象日',noDigest:'本日のまとめはまだ掲載されていません。記事は「もっと詳しく」から読めます。',more:'もっと詳しく',close:'閉じる',source:'配信元',count:function(n){return n+'件の見出し';},noToday:'本日発表された経済ニュースは、まだ確認できていません。',supplements:'日付付きの補足',supplement:'補足',original:'元の記事を読む',published:'発表'},
    en:{title:'Economic news',date:'Edition date',noDigest:'Today’s summary has not been published yet. Open Read more for the articles.',more:'Read more',close:'Close details',source:'Publisher',count:function(n){return n+' headlines';},noToday:'No qualifying economic news published today has been confirmed yet.',supplements:'Earlier news for context',supplement:'Context',original:'Read the original article',published:'Published'},
    ko:{title:'경제 뉴스',date:'게시 대상 날짜',noDigest:'오늘의 요약은 아직 게시되지 않았습니다. 더 자세히에서 기사를 읽을 수 있습니다.',more:'더 자세히',close:'설명 닫기',source:'언론사',count:function(n){return '헤드라인 '+n+'개';},noToday:'오늘 발표된 경제 뉴스는 아직 확인되지 않았습니다.',supplements:'이전 날짜의 참고 뉴스',supplement:'참고',original:'원문 읽기',published:'발표'},
    zh:{title:'经济新闻',date:'本期日期',noDigest:'今天的摘要尚未发布，请打开了解更多查看文章。',more:'了解更多',close:'收起详情',source:'媒体',count:function(n){return n+'条标题';},noToday:'暂未确认今天发布的相关经济新闻。',supplements:'标注日期的补充新闻',supplement:'补充',original:'阅读原文',published:'发布'}
  };
  function newsSource(source){if(source==='ロイター経済')return {ja:'ロイター経済',en:'Reuters Business',ko:'로이터 경제',zh:'路透经济'}[lang()];return window.translateNewsSource?window.translateNewsSource(source):source;}
  function publication(item,l){
    var date=new Date(item.published_at*1000),label=date.toLocaleString(l,{timeZone:'Asia/Tokyo',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
    return '<time class="publication-date" datetime="'+esc(date.toISOString())+'">'+esc(digestCopy[l].published+' '+label+' JST')+'</time>';
  }
  function articleLink(item,l){var url=safeNewsURL(item.url);return url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(digestCopy[l].original)+' ↗</a>':'';}
  function digestMarkup(d,l,status){
    var c=digestCopy[l],groups=Object.create(null);
    d.news.forEach(function(item){(groups[item.source]||(groups[item.source]=[])).push(item);});
    var edition=new Date(d.edition_date+'T00:00:00+09:00'),day=d.edition_date.slice(-2),weekday=edition.toLocaleDateString(l,{timeZone:'Asia/Tokyo',weekday:'long'});
    var calendar='<div class="calendar" aria-label="'+esc(c.date+' '+d.edition_date+' '+weekday)+'"><strong>'+day+'</strong><small>'+esc(weekday)+'</small></div>';
    var digest=reviewedDigest(d);
    var sources=digest?'<span class="headline-source">'+esc(Object.keys(groups).map(newsSource).join(' / '))+'</span>':'';
    var brief=digest?'<div class="daily-digest" lang="ja"><h4 class="brief-headline">'+esc(digest.headline)+'</h4><p class="brief-summary">'+esc(digest.summary)+'</p></div>':'<p class="news-empty">'+esc(d.news.length?c.noDigest:c.noToday)+'</p>';
    var stories=d.news.map(function(item){
      var key='article:'+item.url;
      var authored=digest&&(digest.article_summaries||[]).find(function(summary){return summary.url===item.url;});
      if(authored)return '<article class="story summarized-story" lang="ja"><h4><span class="story-title">'+esc(authored.headline)+'</span></h4><div class="story-content"><p class="article-summary">'+esc(authored.summary)+'</p><div class="headline-meta">'+publication(item,l)+articleLink(item,l)+'</div></div></article>';
      return '<details class="story" name="kn-news-sources" data-news-key="'+esc(key)+'"><summary data-news-focus="'+esc(key)+'"><h4><span class="story-title">'+esc(item.title)+'</span></h4><span class="plus" aria-hidden="true"></span></summary><div class="story-content"><div class="headline-meta">'+publication(item,l)+articleLink(item,l)+'</div></div></details>';
    }).join('');
    if(d.supplements.length)stories+='<section class="news-supplements"><h4>'+esc(c.supplements)+'</h4>'+d.supplements.map(function(item){
      var key='supplement:'+item.url;
      return '<details class="story" name="kn-news-sources" data-news-key="'+esc(key)+'"><summary data-news-focus="'+esc(key)+'"><h4><span class="story-category">'+esc(c.supplement)+' · '+publication(item,l)+'</span><span class="story-title">'+esc(item.title)+'</span></h4><span class="plus" aria-hidden="true"></span></summary><div class="story-content"><p>'+esc(item.editorial_reason)+'</p><div class="headline-meta">'+articleLink(item,l)+'</div></div></details>';
    }).join('')+'</section>';
    var more=stories?'<details class="read-more" data-news-key="more"><summary data-news-focus="more"><span class="closed-label">'+esc(c.more)+'</span><span class="open-label">'+esc(c.close)+'</span><span class="read-toggle" aria-hidden="true"></span></summary><div class="stories editorial-detail">'+stories+'</div></details>':'';
    return '<article id="knNewsDigest" class="news-card journal" aria-labelledby="knNewsDigestTitle"><header class="news-header">'+calendar+'<div class="heading-text"><h3 id="knNewsDigestTitle">'+esc(c.title)+'</h3></div></header><div class="news-content"><div class="brief">'+brief+'</div>'+more+'<footer class="news-footer"><p><span>'+esc(status)+'</span>'+sources+'</p></footer></div></article>';
  }
  function replaceNews(el,html,l){
    // Native details.open changes the DOM serialization without changing the
    // article. Compare the last rendered source, not a reader's current DOM.
    if(el.__knNewsHTML===html&&el.__knNewsLanguage===l)return;
    el.__knNewsHTML=html;el.__knNewsLanguage=l;
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
    var c=copy[l],status;
    if(d.delivery==='published')status=d.edition_date.replace(/-/g,'/')+' '+({ja:'掲載',en:'Published',ko:'게시',zh:'发布'}[l])+(failed?' · '+({ja:'最新情報を確認できませんでした。',en:'Unable to check for updates.',ko:'최신 정보를 확인하지 못했습니다.',zh:'暂时无法检查更新。'}[l]):'');
    else{
      var stamp=new Date(d.fetched_at*1000).toLocaleString(l,{timeZone:'Asia/Tokyo',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
      status=c.updated+' '+stamp+' JST'+(failed?' · '+c.failed:d.translation_pending?' · '+c.pending:d.stale?' · '+c.stale:'');
    }
    replaceNews(el,digestMarkup(d,l,status),l);
    el.setAttribute('aria-busy','false');shownLanguage=l;shownEdition=d.edition_date;shownNews=d;shownState='news';
  }
  function drawLoading(l){
    if(l!==lang())return;
    var el=document.getElementById('morning-news-content');if(!el)return;
    if(shownLanguage===l&&shownEdition===editionKey(Date.now()/1000)&&el.getAttribute('aria-busy')==='true')return;
    replaceNews(el,'<div class="morning-news-skeleton" role="status" aria-label="'+esc(copy[l].loading)+'"><span></span><i></i><i></i><i></i><i></i></div>',l);
    el.setAttribute('aria-busy','true');shownLanguage=l;shownEdition=editionKey(Date.now()/1000);shownNews=null;shownState='loading';
  }
  function drawFailure(l){
    if(l!==lang())return;var el=document.getElementById('morning-news-content');if(!el)return;
    replaceNews(el,'<div class="morning-news-error">'+esc(copy[l].empty)+' <button type="button" class="morning-news-retry">'+esc(copy[l].retry)+'</button></div>',l);
    el.setAttribute('aria-busy','false');shownLanguage=l;shownEdition=editionKey(Date.now()/1000);shownNews=null;shownState='failed';var button=el.querySelector('button');
    if(button)button.onclick=function(){newsAttempts[l]=0;return loadNews(true,true);};
  }
  function scheduleNews(l){
    clearTimeout(newsTimers[l]);
    if((newsAttempts[l]||0)>=8)return;
    newsAttempts[l]=(newsAttempts[l]||0)+1;
    newsTimers[l]=setTimeout(function(){if(lang()===l&&!document.hidden)loadNews(true);},Math.min(10000,1500*newsAttempts[l]));
  }
  function keepNewsWhileLoading(l,cached,manualRetry){
    if(l!==lang())return;
    if(cached){
      // Retain a failed-refresh notice until the next successful check instead
      // of removing and adding it again on each background retry.
      if(shownLanguage!==l||shownNews!==cached)drawNews(cached,l);
    }else if(manualRetry||shownLanguage!==l||shownEdition!==editionKey(Date.now()/1000)||shownState!=='failed')drawLoading(l);
  }
  function loadNews(force,manualRetry){
    var l=lang(),cached=cachedNews(l),period=publicationPeriod();
    keepNewsWhileLoading(l,cached,manualRetry);
    if(newsPending[l])return newsPending[l];
    if(!force&&newsPeriods[l]===period&&cached&&!cached.refreshing&&!cached.translation_pending&&Date.now()-(newsLoadedAt[l]||0)<NEWS_TTL)return Promise.resolve(cached);
    clearTimeout(newsTimers[l]);
    newsPeriods[l]=period;
    newsPending[l]=fetchJSON('/api/morning-news?lang='+encodeURIComponent(l)).then(function(d){
      if(d.publication_revoked===true)clearPublished(l);
      if(d.error||!Array.isArray(d.news))throw new Error('Unavailable news');
      if(validNews(d,l)){
        // Keep an approved edition until another approved edition is released.
        // A live feed may be empty while the next publication is being prepared.
        if(!curatedPublication(publishedNews[l]))clearPublished(l);
        newsCache[l]=d;newsLoadedAt[l]=Date.now();save('kn_news_v4_'+l,d);drawNews(cachedNews(l)||d,l);
        if(d.refreshing||d.translation_pending)scheduleNews(l);else newsAttempts[l]=0;
      }else if(validPublished(d,l)){
        rememberPublished(d,l);newsLoadedAt[l]=Date.now();drawNews(cachedNews(l)||d,l);
        if(d.refreshing||d.translation_pending)scheduleNews(l);else newsAttempts[l]=0;
      }else if(d.refreshing||(d.policy_version===4&&d.edition_date!==editionKey(Date.now()/1000))){scheduleNews(l);var current=cachedNews(l);if(!current&&(newsAttempts[l]||0)>=8)drawFailure(l);else keepNewsWhileLoading(l,current,false);}
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
  function checkNewsBoundary(){
    var l=lang();
    if(newsPeriods[l]!==publicationPeriod())loadNews();
    else if(shownEdition!==editionKey(Date.now()/1000)&&!validPublished(publishedNews[l],l)){
      // Unreviewed daily headlines still expire at midnight, without forcing
      // another network request every second for a retained published edition.
      var current=cachedNews(l);if(current)drawNews(current,l);else drawLoading(l);
    }
  }
  function normalizeMarket(d){
    if(!d||typeof d!=='object'||Array.isArray(d)||!d.market||typeof d.market!=='object'||Array.isArray(d.market))return null;
    var market=Object.create(null),stamps=[],now=Date.now()/1000;
    Object.keys(d.market).forEach(function(label){
      var quote=d.market[label];
      if(!quote||typeof quote!=='object'||Array.isArray(quote)||typeof quote.display!=='string'||!quote.display.trim()||quote.display==='--'||/[<>]/.test(quote.display))return;
      var stamp=Object.prototype.hasOwnProperty.call(quote,'fetched_at')?quote.fetched_at:d.fetched_at;
      if(!Number.isFinite(stamp)||now-stamp<0||(now-stamp)*1000>=MAX_MARKET_AGE)return;
      var fields=['price','value','pct','change_value'];
      if(fields.some(function(key){return quote[key]!=null&&(!Number.isFinite(quote[key])||((key==='price'||key==='value')&&quote[key]<=0));}))return;
      var clean={display:quote.display,fetched_at:stamp};
      fields.forEach(function(key){if(quote[key]!=null)clean[key]=quote[key];});
      ['currency','change_unit','change'].forEach(function(key){if(typeof quote[key]==='string')clean[key]=quote[key];});
      market[label]=clean;stamps.push(stamp);
    });
    return {market:market,fetched_at:stamps.length?Math.min.apply(null,stamps):null,updated:typeof d.updated==='string'?d.updated:'--',refreshing:d.refreshing===true,stale:d.stale===true,error:d.error};
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
    if(document.hidden)return Promise.resolve(_mktCache);
    if(marketPending)return marketPending;
    if(_mktCache&&Date.now()-_mktLastFetch<_mktFetchSec*1000){renderMorningGrid(_mktCache);return Promise.resolve(_mktCache);}
    clearTimeout(marketRetry);
    marketPending=fetchJSON('/api/morning-data').then(function(d){
      d=normalizeMarket(d);
      if(!d||d.error)throw new Error('Unavailable market');
      if(d.refreshing&&d.market&&!Object.keys(d.market).length){
        if(window.knHomeA)window.knHomeA.acceptBase(d);
        if(!document.hidden)marketRetry=setTimeout(loadMarket,2000);return d;
      }
      if(!Object.keys(d.market).length)throw new Error('Unavailable market');
      _mktLastFetch=Date.now();_mktCountdown=_mktFetchSec;window.__mdTry=0;
      drawMarket(d);if(Number.isFinite(d.fetched_at))save('kn_market_v1',d);
      return d;
    }).catch(function(){
      if(window.knHomeA)window.knHomeA.baseFailed();
      if(_mktCache){renderMorningGrid(_mktCache);return;}
      var a=document.getElementById('morning-analysis');if(a)a.textContent='市場データを確認しています。ニュースはそのままご覧いただけます。';
      window.__mdTry=(window.__mdTry||0)+1;
      if(!document.hidden&&window.__mdTry<=8)marketRetry=setTimeout(loadMarket,Math.min(10000,1500*window.__mdTry));
    }).finally(function(){marketPending=null;});return marketPending;
  }
  function start(){
    if(!started){
      started=true;var cached=read('kn_market_v1'),embedded=null;
      try{var node=document.getElementById('knInitialMarket');embedded=node?JSON.parse(node.textContent):null;}catch(_){}
      [cached,embedded].map(normalizeMarket).filter(function(d){return d&&!d.error&&Object.keys(d.market).length;}).sort(function(a,b){return a.fetched_at-b.fetched_at;}).forEach(drawMarket);
    }
    // Start news first, independently of the market response and intro timeline.
    loadNews();loadMarket();
    if(_mktInterval)clearInterval(_mktInterval);
    _mktInterval=setInterval(function(){
      if(document.hidden)return;
      checkNewsBoundary();
      _mktCountdown--;var c=document.getElementById('morning-countdown');if(c)c.textContent=Math.max(0,_mktCountdown);
      if(_mktCountdown<=0){_mktCountdown=_mktFetchSec;loadNews();loadMarket();}
    },1000);
  }
  window.loadMorningNews=loadNews;window.loadMorningData=loadMarket;window.startMorningInterval=start;
  document.addEventListener('visibilitychange',function(){if(document.hidden)clearTimeout(marketRetry);else{loadNews();loadMarket();}});
  document.addEventListener('langChanged',function(){loadNews();});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();

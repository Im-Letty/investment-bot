/* Public morning data: independent requests, one request per resource, keep content while refreshing. */
(function(){
  'use strict';
  var newsCache={}, newsPending={}, newsTimers={}, newsAttempts={}, marketPending=null, marketRetry=null;
  var NEWS_TTL=120000, MAX_NEWS_AGE=900000, MAX_MARKET_AGE=7*86400000;
  var officialSourceHosts={'総務省統計局':'www.stat.go.jp','財務省':'www.mof.go.jp','日本銀行':'www.boj.or.jp','金融庁':'www.fsa.go.jp'};
  var shownLanguage=null, shownEdition=null, shownNews=null, shownState=null, newsLoadedAt={}, started=false;
  var initialNews=null, initialRead=false, publishedNews={}, publishedRead={}, newsPeriods={}, publishedFloors={}, updateObservations={};
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
  function headlinesFallback(d){return !!(d&&d.delivery==='headlines'&&d.fallback_reason==='current_edition_unavailable'&&d.digest===null&&d.selection_status==='ready'&&Array.isArray(d.news)&&d.news.length);}
  function safeNewsURL(value){try{var u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch(_){return '';}}
  function validISODate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;var date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
  function newsUpdateMarkup(d){
    var value=d.update_status,now=Date.now()/1000;
    if(!value||value.version!==1)return '';
    var labels={no_eligible_articles:'対象記事なし（取得元の確認済み）',partially_published:'一部公開・残りは確認未完',review_failed:'審査で停止',generation_failed:'生成で停止（詳細未提供）',check_failed:'確認に失敗',daily_limit:'当日の試行上限に到達',in_progress:'処理中',publication_confirmed:'掲載を確認',prepared:'原稿準備済み・公開待ち',candidate_confirmed:'掲載候補を確認（未公開）',no_publication:'新規掲載なし（対象候補の有無は未確認）',unavailable:'結果未提供'};
    var day=validISODate(value.edition_date)?value.edition_date.replace(/-/g,'/')+'版':'掲載版は未確認';
    var state={current:'新しい掲載を確認',previous:'新しい掲載は未確認・前回分を表示',unconfirmed:'公開記事は未確認'}[value.publication_state]||'公開記事は未確認';
    var lines=[];
    [['morning_result','朝の通常処理'],['intraday_result','日中の通常処理']].forEach(function(pair){
      var row=value[pair[0]]||{},date=validISODate(row.edition_date)?row.edition_date.replace(/-/g,'/')+' · ':'';
      var count=Number.isInteger(row.published_count)&&row.published_count>0&&row.published_count<=3?' · '+row.published_count+'件掲載':'';
      lines.push([pair[1],date+(Object.prototype.hasOwnProperty.call(labels,row.state)?labels[row.state]:labels.unavailable)+count+(row.observation_failed===true?' · 最新の処理結果は確認できません':'')]);
      if(Number.isFinite(row.observed_at)&&row.observed_at>0&&row.observed_at<=now){var stamp=new Date((row.observed_at+9*3600)*1000).toISOString();lines.push([pair[1]+'の確認時刻',stamp.slice(0,10).replace(/-/g,'/')+' '+stamp.slice(11,16)+' JST']);}
    });
    [['published_at','公開開始'],['source_checked_at','取得元の確認'],['display_checked_at','表示確認']].forEach(function(pair){
      var stamp=value[pair[0]];
      if(Number.isFinite(stamp)&&stamp>0&&stamp<=now){var date=new Date((stamp+9*3600)*1000).toISOString();lines.push([pair[1],date.slice(0,10).replace(/-/g,'/')+' '+date.slice(11,16)+' JST']);}
    });
    return '<details class="news-update-status" lang="ja" data-news-key="update-status"><summary data-news-focus="update-status">'+esc(day+' · '+state)+'</summary><dl>'+lines.map(function(row){return '<div><dt>'+esc(row[0])+'</dt><dd>'+esc(row[1])+'</dd></div>';}).join('')+'</dl></details>';
  }
  function sourceWindow(digest){
    var w=digest&&digest.source_window;
    if(!w||Object.keys(w).length!==(w.version===3?7:5)||digest.publication_mode!=='curated'||w.edition_date!==digest.edition_date||!validISODate(w.edition_date))return null;
    var midnight=Date.parse(w.edition_date+'T00:00:00+09:00')/1000;
    if(w.version===2){
      if(w.kind!=='intraday'||!Object.keys(w).every(function(key){return ['version','kind','edition_date','window_start','cutoff_at'].includes(key);})||!Number.isFinite(w.window_start)||w.window_start<=0||!Number.isFinite(w.cutoff_at)||w.cutoff_at<=0)return null;
      return w.window_start===midnight+7.5*3600&&w.cutoff_at>=midnight+9*3600&&w.cutoff_at<midnight+23*3600?w:null;
    }
    if(w.version===3){
      if(w.kind!=='morning'||!Object.keys(w).every(function(key){return ['version','kind','edition_date','window_start','carryover_start','cutoff_at','snapshot_at'].includes(key);})||!Number.isFinite(w.snapshot_at)||w.snapshot_at<w.cutoff_at||editionKey(w.snapshot_at)!==w.edition_date)return null;
    }else if(w.version!==1)return null;
    return w.window_start===midnight-16*3600&&w.carryover_start===midnight-16.5*3600&&w.cutoff_at===midnight+7.5*3600?w:null;
  }
  function officialArticle(item,w,reviewedAt){
    if(!item||!Object.prototype.hasOwnProperty.call(officialSourceHosts,item.source)||!validISODate(item.published_date)||!['second','day'].includes(item.publication_precision)||typeof item.body_sha256!=='string'||! /^[a-f0-9]{64}$/.test(item.body_sha256)||!Number.isFinite(item.body_verified_at)||item.body_verified_at>(w.version===3?w.snapshot_at:w.cutoff_at)||item.body_verified_at>reviewedAt)return false;
    var url;try{url=new URL(item.url);}catch(_){return false;}
    if(url.protocol!=='https:'||url.hostname!==officialSourceHosts[item.source]||url.username||url.password||url.search||(url.port&&url.port!=='443'))return false;
    if(item.source==='日本銀行'&&!/^\/mopo\/mpmdeci\/(?:state_\d{4}\/k\d{6}[a-z]?\.html?|mpr_\d{4}\/k\d{6}[a-z]?\.pdf)$/.test(url.pathname))return false;
    if(item.source==='金融庁'){
      // Match the server's HTML-only FSA scope. Its RSS delivery time is not
      // an original publication time, and the dated path must corroborate it.
      var fsaPath=/^\/news\/r[1-9]\d?\/(?:hoken|sonota|shouken|ginkou)\/(?:(\d{8})\/)?(\d{8})(?:_[a-z0-9]+|[a-z]+)?\.html$/.exec(url.pathname);
      if(!fsaPath||fsaPath[2]!==item.published_date.replace(/-/g,'')||item.publication_precision!=='day'||item.published_at!==null||typeof item.title!=='string'||!item.title.length||item.title.length>1000||!/金融|保険|預貯金|口座|証券|銀行|信用|資産運用|NISA|サイバーセキュリティ/.test(item.title)||/予定|募集|入札|採用|調達|公募|開催|会議|会合|連絡会|議事|パブリックコメント|意見募集|訂正|正誤表|更新しました|差替|差し替|取消|取り消し/.test(item.title))return false;
    }
    if(w.kind==='intraday'){
      if(item.selection_route!=='intraday'||item.published_date!==w.edition_date||item.body_verified_at<w.window_start||typeof item.title!=='string'||!item.title.trim()||item.title.length>1000||Object.prototype.hasOwnProperty.call(item,'deferred_from')||Object.prototype.hasOwnProperty.call(item,'deferred_reason'))return false;
      if(item.publication_precision==='day')return item.published_at===null&&editionKey(item.body_verified_at)>=item.published_date;
      return Number.isFinite(item.published_at)&&item.published_at>=w.window_start&&item.published_at<=w.cutoff_at&&item.published_at<=item.body_verified_at&&editionKey(item.published_at)===item.published_date;
    }
    var deferred=item.selection_route==='deferred',previous=editionKey(w.window_start),previousStart=w.window_start-86400;
    if(deferred){
      if(item.deferred_from!==previous||!['late_verification','review_failed','omitted'].includes(item.deferred_reason)||(item.deferred_reason==='late_verification'&&item.body_verified_at<=w.carryover_start))return false;
    }else if(Object.prototype.hasOwnProperty.call(item,'deferred_from')||Object.prototype.hasOwnProperty.call(item,'deferred_reason'))return false;
    if(item.publication_precision==='day')return item.published_at===null&&editionKey(item.body_verified_at)>=item.published_date&&(deferred?item.published_date>=editionKey(previousStart)&&item.published_date<=previous:item.selection_route==='date_only'&&item.published_date>=previous&&item.published_date<=editionKey(w.cutoff_at));
    if(!Number.isFinite(item.published_at)||item.published_at>w.cutoff_at||item.published_at>item.body_verified_at||editionKey(item.published_at)!==item.published_date)return false;
    if(deferred)return item.published_at>=previousStart&&item.published_at<=w.carryover_start;
    return item.selection_route==='main'?item.published_at>=w.window_start:item.selection_route==='carryover'&&item.published_at>w.carryover_start&&item.published_at<w.window_start;
  }
  function sameArticleMetadata(a,b,w){return a.published_at===b.published_at&&(!w||['published_date','publication_precision','body_sha256','body_verified_at','selection_route','deferred_from','deferred_reason'].every(function(key){return a[key]===b[key];}));}
  function validEdition(d,l){
    var now=Date.now()/1000,today=editionKey(now),window=sourceWindow(d&&d.digest);
    if(!d||d.policy_version!==4||d.lang!==l||typeof d.edition_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d.edition_date)||d.edition_date>today||(!curatedPublication(d)&&d.edition_date!==today)||!['ready','empty_today'].includes(d.selection_status)||!Array.isArray(d.news)||d.news.length>3||!Array.isArray(d.supplements)||d.supplements.length>1)return false;
    if(d.digest&&Object.prototype.hasOwnProperty.call(d.digest,'source_window')&&!window)return false;
    function article(x,older){
      if(window&&!older)return !!(x&&typeof x.title==='string'&&x.title.trim()&&x.title.length<=2000&&safeNewsURL(x.url)&&officialArticle(x,window,now));
      if(!x||typeof x.source!=='string'||x.source.length>=100||typeof x.title!=='string'||!x.title.trim()||x.title.length>2000||!safeNewsURL(x.url)||!Number.isFinite(x.published_at)||x.published_at>now)return false;
      var date=editionKey(x.published_at);
      if(x.published_date!==date)return false;
      return older?date<d.edition_date&&Date.parse(d.edition_date)-Date.parse(date)<=7*86400000&&x.is_supplement===true&&typeof x.editorial_reason==='string'&&!!x.editorial_reason.trim():date===d.edition_date;
    }
    return d.news.every(function(x){return article(x,false);})&&d.supplements.every(function(x){return article(x,true);});
  }
  function validNews(d,l){
    var now=Date.now()/1000;
    return validEdition(d,l)&&d.delivery!=='published'&&(d.delivery!=='headlines'||(headlinesFallback(d)&&d.edition_date===publicationPeriod()))&&Number.isFinite(d.fetched_at)&&now-d.fetched_at>=0&&now-d.fetched_at<MAX_NEWS_AGE/1000;
  }
  function validPublished(d,l){return validEdition(d,l)&&d.delivery==='published'&&d.fetched_at===null&&!!reviewedDigest(d);}
  function rememberPublished(d,l){
    if(!validPublished(d,l)||(publishedFloors[l]&&d.edition_date<publishedFloors[l]))return;
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
  function preferHeadlines(d,published,l){return headlinesFallback(d)&&validNews(d,l)&&(!validPublished(published,l)||published.edition_date<d.edition_date);}
  function acceptHeadlines(d,l){
    // Keep a date-only floor even after the short-lived RSS cache expires, so
    // stale embedded/API editions cannot resurrect the superseded publication.
    if(!publishedFloors[l]||publishedFloors[l]<d.edition_date){
      publishedFloors[l]=d.edition_date;save('kn_news_headline_edition_v1_'+l,d.edition_date);
    }
    clearPublished(l);
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
      publishedRead[l]=true;var saved=read('kn_published_news_v1_'+l),floor=read('kn_news_headline_edition_v1_'+l);
      if(typeof floor==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(floor)&&floor<=editionKey(Date.now()/1000))publishedFloors[l]=floor;
      if(initialNews&&initialNews.lang===l&&initialNews.publication_revoked===true){
        var correction=initialNews;clearPublished(l);initialNews=correction;
      }else if(curatedPublication(saved))rememberPublished(saved,l);
      if(initialNews&&initialNews.lang===l)rememberPublished(initialNews,l);
    }
    if(!validNews(newsCache[l],l))newsCache[l]=read('kn_news_v4_'+l);
    if(validNews(initialNews,l)&&(!validNews(newsCache[l],l)||initialNews.fetched_at>newsCache[l].fetched_at))newsCache[l]=initialNews;
    if(preferHeadlines(newsCache[l],publishedNews[l],l))acceptHeadlines(newsCache[l],l);
    return validPublished(publishedNews[l],l)?publishedNews[l]:validNews(newsCache[l],l)?newsCache[l]:null;
  }
  function validCopySummary(value,role,digest){
    if(typeof value!=='string')return false;
    var hasPolicy=Object.prototype.hasOwnProperty.call(digest,'copy_length_policy');
    if(hasPolicy&&digest.copy_length_policy!=='flexible-v1')return false;
    var length=Array.from(value.trim()).length,minimum=hasPolicy?1:200,maximum=hasPolicy?(role==='article'?440:330):300;
    return length>=minimum&&length<=maximum;
  }
  function reviewedDigest(d){
    var digest=d.digest,window=sourceWindow(d.digest);
    if(!digest||digest.lang!=='ja'||digest.edition_date!==d.edition_date||typeof digest.headline!=='string'||!digest.headline.trim()||Array.from(digest.headline).length>80||!validCopySummary(digest.summary,'overview',digest)||!Array.isArray(digest.article_refs)||!d.news.length||digest.article_refs.length!==d.news.length)return null;
    if(digest.publication_mode!=null&&digest.publication_mode!=='curated')return null;
    if(Object.prototype.hasOwnProperty.call(digest,'source_window')&&!window)return null;
    var hasStructure=Object.prototype.hasOwnProperty.call(digest,'reading_structure');
    if(hasStructure&&(digest.reading_structure!=='lead-plus-other-news-v1'||!window||digest.publication_mode!=='curated'||digest.copy_length_policy!=='flexible-v1'||!Object.prototype.hasOwnProperty.call(digest,'article_summaries')))return null;
    if(digest.publication_mode==='curated'&&(digest.article_refs.length<1||digest.article_refs.length>3||!Number.isFinite(digest.reviewed_at)||digest.reviewed_at>Date.now()/1000||editionKey(digest.reviewed_at)!==d.edition_date||(window&&digest.reviewed_at<(window.version===3?window.snapshot_at:window.cutoff_at))||digest.article_refs.some(function(ref){return window?!officialArticle(ref,window,digest.reviewed_at):!ref||!Number.isFinite(ref.published_at)||ref.published_at>digest.reviewed_at;})))return null;
    if(window&&(!Number.isFinite(digest.publish_at)||digest.publish_at<window.cutoff_at+(window.kind==='intraday'?0:1800)))return null;
    if(Object.prototype.hasOwnProperty.call(digest,'publish_at')&&(!Number.isFinite(digest.publish_at)||digest.publication_mode!=='curated'||digest.publish_at<digest.reviewed_at||digest.publish_at>Date.now()/1000||editionKey(digest.publish_at)!==d.edition_date))return null;
    var used=new Set();
    var matches=digest.article_refs.every(function(ref){
      if(!ref||!safeNewsURL(ref.url)||used.has(ref.url))return false;
      used.add(ref.url);
      return d.news.some(function(item){return ref.url===item.url&&ref.source===item.source&&sameArticleMetadata(ref,item,window)&&(d.lang!=='ja'||ref.title===item.title);});
    });
    if(Object.prototype.hasOwnProperty.call(digest,'article_summaries')){
      var summaries=digest.article_summaries,covered=new Set();
      if(!Array.isArray(summaries)||summaries.length!==digest.article_refs.length)return null;
      if(!summaries.every(function(item,index){
        if(!item||typeof item.headline!=='string'||!item.headline.trim()||Array.from(item.headline.trim()).length>80||!validCopySummary(item.summary,'article',digest)||covered.has(item.url))return false;
        if(hasStructure&&item.url!==digest.article_refs[index].url)return false;
        covered.add(item.url);
        return digest.article_refs.some(function(ref){return item.source===ref.source&&item.url===ref.url&&sameArticleMetadata(item,ref,window)&&item.title===ref.title;});
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
  var headlineCopy={
    ja:{title:'今日の見出し',pending:'本日の要約は未掲載です。'},
    en:{title:'Today’s headlines',pending:'Today’s summary has not been published yet.'},
    ko:{title:'오늘의 헤드라인',pending:'오늘의 요약은 아직 게시되지 않았습니다.'},
    zh:{title:'今日标题',pending:'今天的摘要尚未发布。'}
  };
  var otherNewsCopy={ja:'ほかのニュース',en:'Other news',ko:'다른 뉴스',zh:'其他新闻'};
  function newsSource(source){if(source==='ロイター経済')return {ja:'ロイター経済',en:'Reuters Business',ko:'로이터 경제',zh:'路透经济'}[lang()];return window.translateNewsSource?window.translateNewsSource(source):source;}
  function publication(item,l){
    var dayOnly=item.publication_precision==='day'&&item.published_at===null&&validISODate(item.published_date);
    var stamp=item.published_at;
    var validStamp=typeof stamp==='number'&&Number.isFinite(stamp)&&Number.isFinite(new Date(stamp*1000).getTime())&&Number.isFinite(new Date((stamp+9*3600)*1000).getTime());
    if(!dayOnly&&!validStamp)return '<span class="publication-unknown">'+esc({ja:'発表日未確認',en:'Publication date unconfirmed',ko:'발표일 미확인',zh:'发布日期未确认'}[l])+'</span>';
    var label=window.KNDateDisplay.label(dayOnly?item.published_date:stamp,digestCopy[l].published,!dayOnly);
    var datetime=dayOnly?item.published_date:new Date(stamp*1000).toISOString();
    return '<time class="publication-date" datetime="'+esc(datetime)+'" title="'+esc(label+(dayOnly?'':' JST'))+'">'+esc(label)+'</time>';
  }
  function articleLink(item,l){var url=safeNewsURL(item.url),source=newsSource(item.source||'')||digestCopy[l].original,title=item.title||'';return url?'<a class="source-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer" title="'+esc(title)+'" aria-label="'+esc((title?title+' · ':'')+source+' · '+digestCopy[l].original)+'">'+esc(source)+' ↗</a>':'<span class="headline-source">'+esc(source)+'</span>';}
  function articleMeta(item,l){
    return '<div class="news-publication-source" aria-label="'+esc({ja:'発表日時と出典',en:'Publication date and source',ko:'발표 날짜와 출처',zh:'发布日期与来源'}[l])+'">'+publication(item,l)+'<span aria-hidden="true">·</span>'+articleLink(item,l)+'</div>';
  }
  function digestMarkup(d,l,status){
    var c=digestCopy[l];
    var edition=new Date(d.edition_date+'T00:00:00+09:00'),day=d.edition_date.slice(-2),weekday=edition.toLocaleDateString(l,{timeZone:'Asia/Tokyo',weekday:'long'});
    var calendar='<div class="calendar" aria-label="'+esc(c.date+' '+d.edition_date+' '+weekday)+'"><strong>'+day+'</strong><small>'+esc(weekday)+'</small></div>';
    var digest=reviewedDigest(d),headlines=headlinesFallback(d);
    var leadAndOthers=digest&&digest.reading_structure==='lead-plus-other-news-v1';
    var orderedNews=leadAndOthers?digest.article_refs.map(function(ref){return d.news.find(function(item){return item.url===ref.url;});}):d.news;
    var summaryNews=digest?(leadAndOthers?orderedNews.slice(0,1):digest.article_refs.map(function(ref){return d.news.find(function(item){return item.url===ref.url;});})):[];
    var brief=digest?'<div class="daily-digest" lang="ja"><h4 class="brief-headline">'+esc(digest.headline)+'</h4><p class="brief-summary">'+esc(digest.summary)+'</p><div class="news-summary-sources">'+summaryNews.map(function(item){return articleMeta(item,l);}).join('')+'</div></div>':'<p class="news-empty">'+esc(d.news.length?c.noDigest:c.noToday)+'</p>';
    if(headlines)brief='<h4 class="brief-headline">'+esc(headlineCopy[l].title)+'</h4><p class="news-empty">'+esc(d.edition_date.replace(/-/g,'/')+' · '+headlineCopy[l].pending)+'</p><ul class="headline-list">'+d.news.map(function(item){return '<li><a class="story-title" href="'+esc(safeNewsURL(item.url))+'" target="_blank" rel="noopener noreferrer">'+esc(item.title)+'</a>'+articleMeta(item,l)+'</li>';}).join('')+'</ul>';
    var stories=headlines?'':(leadAndOthers?orderedNews.slice(1):orderedNews).map(function(item){
      var authored=digest&&(digest.article_summaries||[]).find(function(summary){return summary.url===item.url;});
      if(authored)return '<article class="story summarized-story" lang="ja"><h4><span class="story-title">'+esc(authored.headline)+'</span></h4><div class="story-content"><p class="article-summary">'+esc(authored.summary)+'</p>'+articleMeta(item,l)+'</div></article>';
      return '<article class="story source-story"><h4><span class="story-title">'+esc(item.title)+'</span></h4>'+articleMeta(item,l)+'</article>';
    }).join('');
    if(d.supplements.length)stories+='<section class="news-supplements"><h4>'+esc(c.supplements)+'</h4>'+d.supplements.map(function(item){
      var key='supplement:'+item.url;
      return '<details class="story" name="kn-news-sources" data-news-key="'+esc(key)+'"><summary data-news-focus="'+esc(key)+'"><h4><span class="story-category">'+esc(c.supplement)+'</span><span class="story-title">'+esc(item.title)+'</span></h4><span class="plus" aria-hidden="true"></span>'+articleMeta(item,l)+'</summary><div class="story-content"><p>'+esc(item.editorial_reason)+'</p></div></details>';
    }).join('')+'</section>';
    var more=stories?'<details class="read-more" data-news-key="more"><summary data-news-focus="more"><span class="closed-label">'+esc(leadAndOthers?otherNewsCopy[l]:c.more)+'</span><span class="open-label">'+esc(c.close)+'</span><span class="read-toggle" aria-hidden="true"></span></summary><div class="stories editorial-detail">'+stories+'</div></details>':'';
    var tail=leadAndOthers&&more?'<div class="news-tail">'+more+'</div>':more;
    var observation=newsUpdateMarkup(d);
    var footer=status||observation?'<footer class="news-footer">'+(status?'<p>'+esc(status)+'</p>':'')+observation+'</footer>':'';
    return '<article id="knNewsDigest" class="news-card journal" aria-labelledby="knNewsDigestTitle"><header class="news-header">'+calendar+'<div class="heading-text"><h3 id="knNewsDigestTitle">'+esc(c.title)+'</h3></div></header><div class="news-content"><div class="brief">'+brief+'</div>'+tail+footer+'</div></article>';
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
    if(d.delivery==='published'){
      status=d.edition_date<publicationPeriod()?({ja:'新しい経済ニュースを確認できていません。前回分を表示しています。',en:'A newer economic news edition has not been confirmed. Showing the previous edition.',ko:'새 경제 뉴스를 확인하지 못했습니다. 이전 기사를 표시하고 있습니다.',zh:'尚未确认新一期经济新闻，当前显示上一期内容。'}[l]):'';
      if(failed)status+=(status?' ':'')+({ja:'最新情報を確認できませんでした。',en:'Unable to check for updates.',ko:'최신 정보를 확인하지 못했습니다.',zh:'暂时无法检查更新。'}[l]);
    }
    else{
      var stamp=window.KNDateDisplay.label(d.fetched_at,c.updated,true);
      status=stamp+(failed?' · '+c.failed:d.translation_pending?' · '+c.pending:d.stale?' · '+c.stale:'');
    }
    var display=updateObservations[l]?Object.assign({},d,{update_status:updateObservations[l]}):d;
    replaceNews(el,digestMarkup(display,l,status),l);
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
      if(d.update_status&&d.update_status.version===1)updateObservations[l]=d.update_status;
      if(validPublished(d,l)&&publishedFloors[l]&&d.edition_date<publishedFloors[l]){
        scheduleNews(l);var retained=cachedNews(l);
        if(!retained&&(newsAttempts[l]||0)>=8)drawFailure(l);else keepNewsWhileLoading(l,retained,false);
        return d;
      }
      if(validNews(d,l)){
        // Only an explicitly dated, verified headline fallback can supersede an
        // older curated edition. Empty/failed feeds still retain that edition.
        if(preferHeadlines(d,publishedNews[l],l))acceptHeadlines(d,l);
        else if(!curatedPublication(publishedNews[l]))clearPublished(l);
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

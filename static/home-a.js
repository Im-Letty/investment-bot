/* Approved A home: reuse existing news, stock panels, navigation and account flows. */
(function() {
  'use strict';
  var model, marketCarousel, dialog, draft = [], query = '', searchItems = [], searchBusy = false, searchFailed = false;
  var searchTimer, searchController, searchEpoch = 0, composing = false;
  var featured = ['日経225','ドル円','S&P500','NYダウ','7203.T','AAPL'];
  var words = {
    ja: {searchButton:'検索',searching:'検索中…',searchFailed:'追加の候補を取得できませんでした。「検索」を押して再試行できます。',mainOptions:'主なマーケット',searchResults:'検索結果',daily:'今日のマーケットニュース',market:'今日のマーケット',choose:'表示選択',title:'表示するマーケット',selected:'選択中',search:'名前・銘柄コードで探す',placeholder:'例：トヨタ・7203',options:'選べるマーケット',back:'戻る',apply:'この表示にする',close:'閉じる',max:'最大4つです。選択中の項目を1つ外してください。',empty:'該当するものが見つかりませんでした。',none:'下から表示したいものを選んでください。',news:'今日のニュース',stocks:'今日の銘柄',morning:'朝レター',menu:'メニュー',account:'マイページ',retry:'再読み込み',loading:'読み込み中',failed:'取得できませんでした',updating:'更新を確認中',nodiff:'前日比なし',notice:'掲載している価格やニュースは、更新のタイミングにより最新の情報と異なる場合があります。',count:'件'},
    en: {searchButton:'Search',searching:'Searching…',searchFailed:'More results could not be loaded. Press Search to retry.',mainOptions:'Main markets',searchResults:'Search results',daily:'Today’s market news',market:'Markets',choose:'Customize',title:'Choose your markets',selected:'Selected',search:'Search by name or symbol',placeholder:'e.g. Gold, EUR, Toyota, AAPL',options:'Available markets',back:'Cancel',apply:'Apply',close:'Close',max:'Choose up to four. Remove an item first.',empty:'No matching markets found.',none:'Choose a market below.',news:'Today’s news',stocks:'Stocks today',morning:'Morning letter',menu:'Menu',account:'My page',retry:'Retry',loading:'Loading',failed:'Unable to load',updating:'Checking for updates',nodiff:'Change unavailable',notice:'Prices and news may not reflect the latest information due to update timing.',count:' results'},
    ko: {searchButton:'검색',searching:'검색 중…',searchFailed:'추가 결과를 불러오지 못했습니다. 검색을 눌러 다시 시도하세요.',mainOptions:'주요 시장',searchResults:'검색 결과',daily:'오늘의 시장 뉴스',market:'오늘의 시장',choose:'표시 선택',title:'표시할 시장 선택',selected:'선택됨',search:'이름·종목 코드 검색',placeholder:'예: AAPL, 7203',options:'선택 가능한 시장',back:'취소',apply:'적용',close:'닫기',max:'최대 4개입니다. 먼저 항목을 제거하세요.',empty:'검색 결과가 없습니다.',none:'아래에서 선택하세요.',news:'오늘의 뉴스',stocks:'오늘의 종목',morning:'아침 레터',menu:'메뉴',account:'마이페이지',retry:'다시 시도',loading:'불러오는 중',failed:'불러오지 못했습니다',updating:'업데이트 확인 중',nodiff:'변동 없음',notice:'표시된 가격과 뉴스는 업데이트 시점에 따라 최신 정보와 다를 수 있습니다.',count:'개'},
    zh: {searchButton:'搜索',searching:'搜索中…',searchFailed:'无法加载更多结果，请点击搜索重试。',mainOptions:'主要市场',searchResults:'搜索结果',daily:'今日市场新闻',market:'今日市场',choose:'选择显示',title:'选择市场',selected:'已选',search:'搜索名称或代码',placeholder:'例如：AAPL、7203',options:'可选市场',back:'取消',apply:'应用',close:'关闭',max:'最多选择四项，请先移除一项。',empty:'未找到匹配项目。',none:'请在下方选择。',news:'今日新闻',stocks:'今日股票',morning:'早间市场',menu:'菜单',account:'我的主页',retry:'重试',loading:'加载中',failed:'无法获取',updating:'正在检查更新',nodiff:'暂无涨跌数据',notice:'受更新时间影响，所显示的价格和新闻可能与最新信息不同。',count:'项'}
  };
  function lang() { var value; try { value=localStorage.getItem('app_lang') || document.documentElement.lang; } catch (_) {} return words[value] ? value : 'ja'; }
  function text(key) { return words[lang()][key]; }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function setHTML(node, html) { if (node && node.innerHTML !== html) node.innerHTML=html; }
  function icon(name) {
    var paths={menu:'M4 6h16M4 12h16M4 18h16',user:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM5 21v-2a7 7 0 0 1 14 0v2',sun:'M12 1v2M12 21v2M1 12h2M21 12h2M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z',settings:'M4 5h16M4 12h16M4 19h16M8 3v4M16 10v4M10 17v4',search:'M19 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM15 15l6 6'};
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+paths[name]+'"/></svg>';
  }
  function renderDate() {
    var node=document.getElementById('knHomeADate');
    if(!node)return;
    var now=new Date(),zone='Asia/Tokyo',locale=lang();
    var date=now.toLocaleDateString(locale,{month:'long',day:'numeric',timeZone:zone});
    var weekday=now.toLocaleDateString(locale,{weekday:'long',timeZone:zone});
    var value=new Intl.DateTimeFormat('sv-SE',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:zone}).format(now);
    setHTML(node,'<time datetime="'+value+'">'+esc(date)+'</time><span class="kn-a-date-separator" aria-hidden="true"></span><time datetime="'+value+'">'+esc(weekday)+'</time>');
  }
  function renderMarkets() {
    if(!model)return;
    var rows=model.rows(), anyFailure=rows.some(function(row){return row.failed;});
    var grid=document.getElementById('knHomeMarketGrid'),selection=JSON.stringify(rows.map(function(row){return row.item.id||row.item.symbol;})),times=[];
    if(grid&&grid.__marketSelection!==selection){
      setHTML(grid,rows.map(function(){return '<div class="kn-a-quote"><div class="kn-a-quote-name"></div><div class="kn-a-quote-value"></div><div class="kn-a-quote-change"></div><div class="kn-a-quote-note"></div></div>';}).join(''));
      grid.__marketSelection=selection;
    }
    rows.forEach(function(row,index){
      var price='—', legacy='', note='', item=row.item;
      if(row.display){var parts=row.display.split(/[\s　]+/);price=parts[0];legacy=parts.slice(1).join(' ');}
      else if(row.quote){price=Number(row.quote.price).toLocaleString(lang(),{maximumFractionDigits:item.category==='fx'?4:2});if(item.currency==='USD')price='$'+price;else if(item.currency==='JPY')price='¥'+price;}
      var movement=window.KNMarketData.formatChange(row.quote,item,lang(),legacy||undefined);
      var hasChange=!!(movement.amount||movement.percent);
      var percent=movement.amount&&movement.percent?(lang()==='ja'||lang()==='zh'?'（'+movement.percent+'）':'('+movement.percent+')'):movement.percent;
      var amount=esc(movement.amount).replace(/(ポイント|포인트|个百分点)$/, '<span class="kn-a-change-unit">$1</span>');
      var change=(movement.amount?'<span class="kn-a-change-amount">'+amount+'</span>':'')+(percent?'<span class="kn-a-change-percent">'+esc(percent)+'</span>':'');
      if(row.failed)note=(row.quote||row.display)?text('updating'):text('failed');
      else if(!row.quote&&!row.display)note=text('loading');
      else if(!hasChange)note=text('nodiff');
      var date=Number.isFinite(row.at)&&row.at>0?new Date(row.at):null;
      var time=date&&Number.isFinite(date.getTime())&&(row.quote||row.display)?date.toLocaleString(lang(),{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})+' JST':'';
      times.push({label:item.label,time:time,iso:time?date.toISOString():''});
      var card=grid&&grid.children[index];if(!card)return;
      if(card.title!==item.label)card.title=item.label;
      setHTML(card.children[0],esc(item.label));setHTML(card.children[1],esc(price));
      var changeClass='kn-a-quote-change is-'+movement.direction;if(card.children[2].className!==changeClass)card.children[2].className=changeClass;
      setHTML(card.children[2],change||esc(note));setHTML(card.children[3],hasChange&&note?esc(note):'');
    });
    if(marketCarousel)marketCarousel.sync();
    var groups=[];
    times.forEach(function(entry){var group=groups.find(function(g){return g.time===entry.time;});if(group)group.labels.push(entry.label);else groups.push({time:entry.time,iso:entry.iso,labels:[entry.label]});});
    var retrieved=({ja:'取得 ',en:'Retrieved ',ko:'가져옴 ',zh:'获取 '}[lang()]),unknown=({ja:'取得時刻 —',en:'Retrieved —',ko:'가져온 시간 —',zh:'获取时间 —'}[lang()]);
    setHTML(document.getElementById('knHomeMarketTimeText'),groups.map(function(group){return '<span class="kn-a-market-time">'+(groups.length>1?'<span class="kn-a-market-time-label">'+esc(group.labels.join('・'))+'</span>':'')+(group.time?'<time datetime="'+esc(group.iso)+'">'+esc(retrieved+group.time)+'</time>':esc(unknown))+'</span>';}).join(''));
    var retry=document.getElementById('knMarketRetry');if(retry)retry.hidden=!anyFailure;
    renderDate();
  }
  function startMarketRefresh() {
    var timer=null,pending=null;
    function refresh(force) {
      if(timer!==null){clearTimeout(timer);timer=null;}
      if(document.hidden)return Promise.resolve();
      if(pending)return pending;
      var began=Date.now();renderDate();
      pending=Promise.all([
        Promise.resolve().then(function(){return model.refresh(force===true);}),
        // Core indices use the existing shared request/cache. The selected
        // extra quotes have their own per-symbol single-flight requests.
        Promise.resolve().then(function(){return window.loadMorningData?window.loadMorningData():null;})
      ]).catch(function(){}).finally(function(){
        pending=null;
        if(!document.hidden)timer=setTimeout(function(){refresh(false);},Math.max(0,60000-(Date.now()-began)));
      });
      return pending;
    }
    document.addEventListener('visibilitychange',function(){
      if(document.hidden){if(timer!==null){clearTimeout(timer);timer=null;}}
      else refresh(false);
    });
    if(window.addEventListener)window.addEventListener('online',function(){refresh(true);});
    refresh(false);
    return refresh;
  }
  function renderSelected() {
    setHTML(document.getElementById('knMarketSelected'),draft.map(function(id){var c=model.find(id);return '<button type="button" class="kn-market-chip" data-kn-remove="'+esc(id)+'" aria-label="'+esc(c.label)+' ×"><span>'+esc(c.label)+'</span><span aria-hidden="true">×</span></button>';}).join('')||'<span class="kn-market-empty">'+esc(text('none'))+'</span>');
    document.getElementById('knMarketCount').textContent=draft.length+' / 4';
    document.getElementById('knMarketApply').disabled=draft.length===0;
  }
  function renderOptions() {
    var searching=!!query.trim();
    var items=searching?searchItems:featured.map(function(id){return model.find(id);}).filter(Boolean);
    document.getElementById('knMarketOptionsTitle').textContent=text(searching?'searchResults':'mainOptions');
    document.getElementById('knMarketResultCount').textContent=items.length+text('count');
    document.getElementById('knMarketSearchStatus').textContent=searchBusy?text('searching'):searchFailed?text('searchFailed'):'';
    document.getElementById('knMarketOptions').setAttribute('aria-busy',String(searchBusy));
    var options=document.getElementById('knMarketOptions'),active=document.activeElement,focused=options.contains(active)&&active.tagName==='INPUT'?active.value:null;
    setHTML(options,items.map(function(c){
      var code=window.KNMarketData.displayCode(c);
      return '<label><input type="checkbox" value="'+esc(c.id)+'" '+(draft.indexOf(c.id)>=0?'checked':'')+'><span><span class="kn-market-option-name">'+esc(c.label)+'</span>'+(code?'<span class="kn-market-meta">'+esc(code)+'</span>':'')+'</span></label>';
    }).join('')||(!searchBusy&&!searchFailed?'<p class="kn-market-empty">'+esc(text('empty'))+'</p>':''));
    if(focused){var target=Array.from(options.querySelectorAll('input')).find(function(input){return input.value===focused;});if(target&&target!==document.activeElement)target.focus({preventScroll:true});}
  }
  function cancelSearch() {
    clearTimeout(searchTimer);searchEpoch++;
    if(searchController)searchController.abort();
    searchController=null;searchBusy=false;
  }
  function runSearch() {
    cancelSearch();
    if(!query.trim()){searchItems=[];searchFailed=false;renderOptions();return;}
    var epoch=searchEpoch,controller=new AbortController();searchController=controller;
    searchBusy=true;searchFailed=false;renderOptions();
    var timeout=setTimeout(function(){controller.abort();},12000);
    model.search(query,{signal:controller.signal}).then(function(result){
      if(epoch!==searchEpoch||!dialog.open)return;
      searchItems=result.items;searchFailed=result.unavailable;
    }).catch(function(){if(epoch===searchEpoch&&dialog.open)searchFailed=true;}).finally(function(){
      clearTimeout(timeout);
      if(epoch===searchEpoch&&dialog.open){searchController=null;searchBusy=false;renderOptions();}
    });
  }
  function queueSearch() {
    cancelSearch();query=document.getElementById('knMarketQuery').value;searchFailed=false;
    searchItems=model.searchLocal(query);searchBusy=!!query.trim()&&!composing;renderOptions();
    if(searchBusy)searchTimer=setTimeout(runSearch,350);
  }
  function openPicker() {
    if(!model)return;
    cancelSearch();composing=false;
    draft=model.selection();query='';searchItems=[];searchFailed=false;
    dialog.setAttribute('aria-label',text('title'));
    dialog.querySelectorAll('[data-kn-copy]').forEach(function(node){node.textContent=text(node.dataset.knCopy);});
    var search=document.getElementById('knMarketQuery');search.value='';search.placeholder=text('placeholder');search.setAttribute('aria-label',text('search'));
    document.getElementById('knMarketError').textContent='';
    renderSelected();renderOptions();dialog.showModal();
  }
  function makePicker() {
    dialog=document.createElement('dialog');dialog.id='knMarketPicker';dialog.setAttribute('aria-label',text('title'));
    dialog.innerHTML='<form id="knMarketForm"><div class="kn-market-head"><div class="kn-market-selected-heading"><span data-kn-copy="selected"></span><span id="knMarketCount" aria-live="polite"></span><button type="button" class="kn-market-close" data-kn-close aria-label="'+esc(text('close'))+'">×</button></div><div id="knMarketSelected"></div></div><div class="kn-market-scroll"><div class="kn-market-search"><input id="knMarketQuery" type="search" autocomplete="off" maxlength="80" enterkeyhint="search"><button type="button" id="knMarketSearch" data-kn-copy="searchButton"></button></div><div class="kn-market-results-heading"><span id="knMarketOptionsTitle"></span><span id="knMarketResultCount" aria-live="polite"></span></div><p id="knMarketSearchStatus" role="status" aria-live="polite"></p><div id="knMarketOptions"></div></div><div class="kn-market-foot"><p id="knMarketError" role="status" aria-live="polite"></p><div class="kn-market-actions"><button type="button" data-kn-close data-kn-copy="back"></button><button type="submit" id="knMarketApply" data-kn-copy="apply"></button></div></div></form>';
    document.body.appendChild(dialog);
    dialog.addEventListener('close',cancelSearch);
    dialog.addEventListener('click',function(e){
      if(e.target===dialog||e.target.closest('[data-kn-close]')){cancelSearch();dialog.close();return;}
      var remove=e.target.closest('[data-kn-remove]');if(remove){var index=draft.indexOf(remove.dataset.knRemove);draft=draft.filter(function(id){return id!==remove.dataset.knRemove;});document.getElementById('knMarketError').textContent='';renderSelected();dialog.querySelectorAll('#knMarketOptions input').forEach(function(input){input.checked=draft.indexOf(input.value)>=0;});var chips=dialog.querySelectorAll('[data-kn-remove]');(chips[Math.min(index,chips.length-1)]||document.getElementById('knMarketQuery')).focus({preventScroll:true});}
    });
    document.getElementById('knMarketOptions').addEventListener('change',function(e){
      var input=e.target;if(input.tagName!=='INPUT')return;
      var item=model.find(input.value)||searchItems.find(function(c){return c.id===input.value;});if(!item)return;
      document.getElementById('knMarketError').textContent='';
      if(input.checked){
        if(draft.length>=4){input.checked=false;document.getElementById('knMarketError').textContent=text('max');return;}
        item=model.remember(item);if(!item){input.checked=false;return;}draft.push(item.id);
      }else draft=draft.filter(function(id){return id!==input.value;});
      renderSelected();
    });
    var input=document.getElementById('knMarketQuery');
    input.addEventListener('compositionstart',function(){composing=true;cancelSearch();});
    input.addEventListener('compositionend',function(){composing=false;queueSearch();});
    input.addEventListener('input',queueSearch);
    input.addEventListener('keydown',function(e){if(e.key==='Enter'){if(e.isComposing||composing||e.keyCode===229)return;e.preventDefault();runSearch();}});
    document.getElementById('knMarketSearch').onclick=runSearch;
    document.getElementById('knMarketForm').addEventListener('submit',function(e){
      e.preventDefault();if(composing)return;if(!model.commit(draft))return;
      window._selIndices=model.selection();
      var customs=model.catalog().filter(function(c){return c.category==='custom'&&draft.indexOf(c.id)>=0;});
      if(customs.length){try{
        if(typeof window.loadCustomSymbols==='function')window.loadCustomSymbols();
        if(!Array.isArray(window._customSymbols))window._customSymbols=[];
        customs.forEach(function(c){
          var entry=window._customSymbols.find(function(x){return x.key===c.symbol;});
          if(!entry){entry={key:c.symbol,label:c.label,icon:'📈'};window._customSymbols.push(entry);}
          if(c.pickerGroup)entry.pickerGroup=c.pickerGroup;if(c.currency)entry.currency=c.currency;
        });
        if(typeof window.saveCustomSymbols==='function')window.saveCustomSymbols();
      }catch(_){}}
      cancelSearch();dialog.close();
    });
  }
  function decoratePanels() {
    var wrap=document.getElementById('knTabWrap');if(!wrap)return;
    if(!wrap.querySelector('.kn-a-section-title')){var heading=document.createElement('h2');heading.className='kn-a-section-title';heading.dataset.knHomeText='stocks';heading.textContent=text('stocks');wrap.insertBefore(heading,wrap.firstChild);}
    if(window.KNStockSearch)window.KNStockSearch.mount(wrap);
    wrap.querySelectorAll('[data-kn-tab]').forEach(function(b){if(!['stock','div_top','div_cal','div_search','favorites'].includes(b.dataset.knTab))return;if(!b.hasAttribute('aria-pressed'))b.setAttribute('aria-pressed',String(b.dataset.knTab==='stock'));if(['stock','div_top'].includes(b.dataset.knTab))b.parentElement.classList.add('kn-a-stock-tabs');});
  }
  async function boot() {
    if(window.knHomeA || !window.KNMarketData || !window.KN_MARKET_CATALOG)return;
    if(window.__knGateReady)try{await window.__knGateReady;}catch(_){}
    var section=document.getElementById('morning-section'),banner=section&&section.querySelector('.morning-banner');if(!banner)return;
    document.body.classList.add('kn-home-a');
    function syncColor(){var color=document.documentElement.style.getPropertyValue('--brand-color').trim().toLowerCase();document.body.toggleAttribute('data-kn-a-custom-color',!!color&&(color!=='#3da060'||document.documentElement.hasAttribute('data-custom-brand-color')));}
    syncColor();
    if(typeof window.applyBrandColor==='function'){var applyColor=window.applyBrandColor;window.applyBrandColor=function(){var result=applyColor.apply(this,arguments);syncColor();return result;};}
    function syncReading(){
      var size='m',font='';try{size=localStorage.getItem('ui_fontscale')||'m';font=localStorage.getItem('ui_font')||'';}catch(_){}
      document.body.style.setProperty('--kn-a-scale',String(({s:.9,m:1,l:1.15,xl:1.3})[size]||1));
      document.body.dataset.knReadingSize=size;
      var fonts={gothic:'"Noto Sans JP",sans-serif',round:'"Hiragino Maru Gothic ProN","M PLUS Rounded 1c","Noto Sans JP",sans-serif',mincho:'"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif',klee:'"Klee One",cursive',pop:'"Shippori Mincho",serif'};
      ['--kn-a-serif','--kn-a-sans'].forEach(function(key){if(fonts[font])document.body.style.setProperty(key,fonts[font]);else document.body.style.removeProperty(key);});
      if(marketCarousel)marketCarousel.sync();
    }
    syncReading();
    ['dsSetSize','dsSetFont','dsReset'].forEach(function(name){if(typeof window[name]==='function'){var original=window[name];window[name]=function(){var result=original.apply(this,arguments);syncReading();return result;};}});
    var homeHero=window.KNHomeHero||window.KNNewsOrbit;
    var masthead=document.createElement('div');masthead.className='kn-a-masthead';masthead.innerHTML='<div class="kn-a-top-row"><button type="button" id="knHomeAMenu" aria-label="'+esc(text('menu'))+'">'+icon('menu')+'</button><button type="button" id="knHomeAAccount" aria-label="'+esc(text('account'))+'">'+icon('user')+'</button></div>'+(homeHero?homeHero.markup:'')+'<div class="kn-a-daily-caption"><div class="kn-a-daily-title"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.3"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"/></svg><h1 data-kn-home-text="daily">'+esc(text('daily'))+'</h1></div><div id="knHomeADate"></div></div>';banner.appendChild(masthead);
    if(homeHero)homeHero.mount(masthead);
    var markets=document.createElement('section');markets.id='knHomeMarkets';markets.innerHTML='<div class="kn-a-market-heading"><button type="button" id="knMarketOpen">'+icon('settings')+'<span data-kn-home-text="choose">'+esc(text('choose'))+'</span></button></div><div id="knHomeMarketGrid"></div>';banner.insertAdjacentElement('afterend',markets);
    if(window.KNMarketCarousel)marketCarousel=window.KNMarketCarousel.mount({grid:document.getElementById('knHomeMarketGrid'),controls:markets.querySelector('.kn-a-market-heading'),section:markets});
    var marketTimes=document.createElement('div');marketTimes.id='knHomeMarketTimes';marketTimes.innerHTML='<div id="knHomeMarketTimeText" tabindex="0"></div><button type="button" id="knMarketRetry" hidden data-kn-home-text="retry">'+esc(text('retry'))+'</button>';markets.insertAdjacentElement('afterend',marketTimes);
    var notice=document.createElement('footer');notice.id='knHomeNotice';notice.innerHTML='<p data-kn-home-text="notice">'+esc(text('notice'))+'</p>';section.appendChild(notice);
    try{if(typeof window.loadCustomSymbols==='function')window.loadCustomSymbols();}catch(_){}
    model=window.KNMarketData.create({catalog:window.KN_MARKET_CATALOG,custom:window._customSymbols||[],storage:localStorage,fetch:window.fetch.bind(window),onChange:renderMarkets});
    window._selIndices=model.selection();
    window.knHomeA={acceptBase:model.acceptBase,baseFailed:model.baseFailed,openMarkets:openPicker};
    if(window.__knHomeABase)model.acceptBase(window.__knHomeABase);
    else if(window._mktCache)model.acceptBase({market:window._mktCache,fetched_at:window._mktLastFetch/1000||Date.now()/1000});
    makePicker();
    var drawer=document.getElementById('sideDrawer');if(drawer&&!drawer.classList.contains('kn-menu-a')&&!document.getElementById('knHomeADrawerBrand')){var brand=document.createElement('div');brand.id='knHomeADrawerBrand';brand.innerHTML='<span class="kn-a-nmark" aria-hidden="true">N</span><span>経済NEWS</span><button type="button" aria-label="'+esc(text('close'))+'">×</button>';brand.querySelector('button').onclick=function(){if(window.closeDrawer)window.closeDrawer();};drawer.insertBefore(brand,drawer.firstChild);}
    document.getElementById('knHomeAMenu').onclick=function(){var b=document.getElementById('hamburgerBtn');if(b)b.click();};
    document.getElementById('knHomeAAccount').onclick=function(){var b=document.querySelector('#knBottomNav [data-act="mypage"]');if(b)b.click();};
    document.getElementById('knMarketOpen').onclick=openPicker;
    document.getElementById('knMarketRetry').onclick=function(){return refreshMarkets(true);};
    window.openIndexCustomizer=openPicker;
    document.addEventListener('click',function(e){var tab=e.target.closest('#knTabWrap [data-kn-tab]');if(tab&&['stock','div_top','div_cal','div_search','favorites'].includes(tab.dataset.knTab))document.querySelectorAll('#knTabWrap [data-kn-tab]').forEach(function(b){b.setAttribute('aria-pressed',String(b===tab));});});
    decoratePanels();
    var attempts=0,initTimer=setInterval(function(){decoratePanels();if(document.querySelector('.kn-a-stock-tabs')||++attempts>=30)clearInterval(initTimer);},300);
    document.addEventListener('langChanged',function(){document.querySelectorAll('[data-kn-home-text]').forEach(function(node){node.textContent=text(node.dataset.knHomeText);});renderDate();renderMarkets();});
    renderMarkets();var refreshMarkets=startMarketRefresh();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();

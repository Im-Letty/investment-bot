/* Approved A home: reuse existing news, stock panels, navigation and account flows. */
(function() {
  'use strict';
  var model, dialog, draft = [], category = 'all', query = '', customBusy = false, pickerEpoch = 0;
  var categories = ['all','index','fx','commodity','jp','us','crypto','other','custom'];
  var words = {
    ja: {market:'今日のマーケット',choose:'表示選択',title:'表示するマーケット',subtitle:'気になるものを、最大4つまで。',selected:'選択中',swap:'入れ替えるときは、選択中の項目を×で外してください。',search:'名前・銘柄コードで探す',placeholder:'例：金、ドル、トヨタ、AAPL',options:'選べるマーケット',back:'戻る',apply:'この表示にする',close:'閉じる',max:'最大4つです。選択中の項目を1つ外してください。',empty:'該当するものが見つかりませんでした。',none:'下から表示したいものを選んでください。',news:'今日のニュース',stocks:'今日の銘柄',morning:'朝レター',menu:'メニュー',account:'マイページ',retry:'再読み込み',loading:'読み込み中',failed:'取得できませんでした',updating:'更新を確認中',nodiff:'前日比なし',custom:'一覧にない銘柄を追加',customHint:'銘柄コードを入力（例：7203、AAPL、BTC-USD）',check:'確認する',checking:'確認中…',customError:'見つかりませんでした。銘柄コードを確認してください。',rate:'価格は遅れて更新される場合があります。',count:'件',categories:['すべて','株価指数','為替','金・原油など','日本株','米国株','暗号資産','金利・VIX','追加した銘柄']},
    en: {market:'Markets',choose:'Customize',title:'Choose your markets',subtitle:'Choose up to four markets.',selected:'Selected',swap:'Remove a selected item with × to replace it.',search:'Search by name or symbol',placeholder:'e.g. Gold, EUR, Toyota, AAPL',options:'Available markets',back:'Cancel',apply:'Apply',close:'Close',max:'Choose up to four. Remove an item first.',empty:'No matching markets found.',none:'Choose a market below.',news:'Today’s news',stocks:'Stocks today',morning:'Morning letter',menu:'Menu',account:'My page',retry:'Retry',loading:'Loading',failed:'Unable to load',updating:'Checking for updates',nodiff:'Change unavailable',custom:'Add another symbol',customHint:'Enter a symbol (e.g. 7203, AAPL, BTC-USD)',check:'Find',checking:'Checking…',customError:'Not found. Please check the symbol.',rate:'Market data may be delayed.',count:' results',categories:['All','Indices','Currencies','Commodities','Japan stocks','US stocks','Crypto','Rates / VIX','Custom']},
    ko: {market:'오늘의 시장',choose:'표시 선택',title:'표시할 시장 선택',subtitle:'최대 4개까지 선택하세요.',selected:'선택됨',swap:'×로 선택한 항목을 제거한 후 변경하세요.',search:'이름·종목 코드 검색',placeholder:'예: AAPL, 7203',options:'선택 가능한 시장',back:'취소',apply:'적용',close:'닫기',max:'최대 4개입니다. 먼저 항목을 제거하세요.',empty:'검색 결과가 없습니다.',none:'아래에서 선택하세요.',news:'오늘의 뉴스',stocks:'오늘의 종목',morning:'아침 레터',menu:'메뉴',account:'마이페이지',retry:'다시 시도',loading:'불러오는 중',failed:'불러오지 못했습니다',updating:'업데이트 확인 중',nodiff:'변동 없음',custom:'다른 종목 추가',customHint:'종목 코드를 입력하세요 (AAPL, 7203)',check:'확인',checking:'확인 중…',customError:'종목 코드를 확인해 주세요.',rate:'시장 데이터가 지연될 수 있습니다.',count:'개',categories:['전체','지수','환율','원자재','일본 주식','미국 주식','암호자산','금리 / VIX','추가 종목']},
    zh: {market:'今日市场',choose:'选择显示',title:'选择市场',subtitle:'最多选择四项。',selected:'已选',swap:'点击×移除已选项目后即可替换。',search:'搜索名称或代码',placeholder:'例如：AAPL、7203',options:'可选市场',back:'取消',apply:'应用',close:'关闭',max:'最多选择四项，请先移除一项。',empty:'未找到匹配项目。',none:'请在下方选择。',news:'今日新闻',stocks:'今日股票',morning:'早间市场',menu:'菜单',account:'我的主页',retry:'重试',loading:'加载中',failed:'无法获取',updating:'正在检查更新',nodiff:'暂无涨跌数据',custom:'添加其他代码',customHint:'输入代码（例如 AAPL、7203）',check:'查找',checking:'查找中…',customError:'未找到，请检查代码。',rate:'市场数据可能延迟更新。',count:'项',categories:['全部','指数','汇率','大宗商品','日本股票','美国股票','加密资产','利率 / VIX','自定义']}
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
    if(node) setHTML(node,icon('sun')+'<span>'+esc(new Date().toLocaleDateString(lang(),{month:'long',day:'numeric',weekday:'long'}))+'</span>');
  }
  function renderMarkets() {
    if(!model)return;
    var rows=model.rows(), anyFailure=rows.some(function(row){return row.failed;});
    setHTML(document.getElementById('knHomeMarketGrid'),rows.map(function(row){
      var price='—', change='', note='', item=row.item;
      if(row.display){var parts=row.display.split(/[\s　]+/);price=parts[0];change=parts.slice(1).join(' ');}
      else if(row.quote){price=Number(row.quote.price).toLocaleString(lang(),{maximumFractionDigits:item.category==='fx'?4:2});if(item.currency==='USD')price='$'+price;else if(item.currency==='JPY')price='¥'+price;change=row.quote.change==='--'?'':row.quote.change?row.quote.change:row.quote.pct==null?'':(row.quote.pct>=0?'▲':'▼')+Math.abs(row.quote.pct).toFixed(2)+'%';}
      if(row.failed)note=(row.quote||row.display)?text('updating'):text('failed');
      else if(!row.quote&&!row.display)note=text('loading');
      else if(!change)note=text('nodiff');
      var time=row.at?new Date(row.at).toLocaleString(lang(),{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
      return '<div class="kn-a-quote" title="'+esc(item.label+(time?' · '+time:''))+'"><div class="kn-a-quote-name">'+esc(item.label)+'</div><div class="kn-a-quote-value">'+esc(price)+'</div><div class="kn-a-quote-change '+(/^[▼−-]/.test(change)?'is-down':'')+'">'+esc(change||note)+'</div>'+(change&&note?'<div class="kn-a-quote-note">'+esc(note)+'</div>':'')+'</div>';
    }).join(''));
    var retry=document.getElementById('knMarketRetry');if(retry)retry.hidden=!anyFailure;
    renderDate();
  }
  function renderSelected() {
    setHTML(document.getElementById('knMarketSelected'),draft.map(function(id){var c=model.find(id);return '<button type="button" class="kn-market-chip" data-kn-remove="'+esc(id)+'" aria-label="'+esc(c.label)+' ×"><span>'+esc(c.label)+'</span><span aria-hidden="true">×</span></button>';}).join('')||'<span class="kn-market-empty">'+esc(text('none'))+'</span>');
    document.getElementById('knMarketCount').textContent=draft.length+' / 4';
    document.getElementById('knMarketApply').disabled=draft.length===0;
  }
  function renderOptions() {
    var needle=window.KNMarketData.normalize(query).replace(/\s/g,'');
    var items=model.catalog().filter(function(c){return (category==='all'||c.category===category)&&window.KNMarketData.normalize(c.label+' '+c.symbol+' '+(c.keywords||'')).replace(/\s/g,'').includes(needle);});
    document.getElementById('knMarketResultCount').textContent=items.length+text('count');
    setHTML(document.getElementById('knMarketOptions'),items.map(function(c){var ci=categories.indexOf(c.category);return '<label><input type="checkbox" value="'+esc(c.id)+'" '+(draft.indexOf(c.id)>=0?'checked':'')+'><span><span class="kn-market-option-name">'+esc(c.label)+'</span><span class="kn-market-meta">'+esc(words[lang()].categories[ci]+' · '+c.symbol)+'</span></span></label>';}).join('')||'<p class="kn-market-empty">'+esc(text('empty'))+'</p>');
    dialog.querySelectorAll('[data-kn-category]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.knCategory===category));});
  }
  function openPicker() {
    if(!model)return;
    pickerEpoch++;
    draft=model.selection();category='all';query='';
    dialog.querySelectorAll('[data-kn-copy]').forEach(function(node){node.textContent=text(node.dataset.knCopy);});
    var search=document.getElementById('knMarketQuery');search.value='';search.placeholder=text('placeholder');
    document.getElementById('knMarketCustomInput').placeholder='AAPL / 7203 / BTC-USD';
    document.getElementById('knMarketError').textContent='';
    document.getElementById('knMarketCustomResult').textContent='';
    document.getElementById('knMarketCustomInput').value='';
    setHTML(document.getElementById('knMarketCategories'),categories.filter(function(c){return c!=='custom'||model.catalog().some(function(x){return x.category==='custom';});}).map(function(c){return '<button type="button" data-kn-category="'+c+'" aria-pressed="'+(c==='all')+'">'+esc(words[lang()].categories[categories.indexOf(c)])+'</button>';}).join(''));
    renderSelected();renderOptions();dialog.showModal();
  }
  function makePicker() {
    dialog=document.createElement('dialog');dialog.id='knMarketPicker';dialog.setAttribute('aria-labelledby','knMarketTitle');
    dialog.innerHTML='<form id="knMarketForm"><div class="kn-market-head"><button type="button" class="kn-market-close" data-kn-close aria-label="'+esc(text('close'))+'">×</button><h2 id="knMarketTitle" data-kn-copy="title"></h2><p data-kn-copy="subtitle"></p><div class="kn-market-selected-heading"><span data-kn-copy="selected"></span><span id="knMarketCount" aria-live="polite"></span></div><div id="knMarketSelected"></div><p class="kn-market-hint" data-kn-copy="swap"></p></div><div class="kn-market-scroll"><label class="kn-market-search-label" for="knMarketQuery" data-kn-copy="search"></label><div class="kn-market-search">'+icon('search')+'<input id="knMarketQuery" type="search" autocomplete="off"></div><div id="knMarketCategories" role="group" aria-label="'+esc(text('options'))+'"></div><div class="kn-market-results-heading"><span data-kn-copy="options"></span><span id="knMarketResultCount" aria-live="polite"></span></div><div id="knMarketOptions"></div><details class="kn-market-custom"><summary data-kn-copy="custom"></summary><label for="knMarketCustomInput" data-kn-copy="customHint"></label><div><input id="knMarketCustomInput" type="text" autocomplete="off" maxlength="25"><button type="button" id="knMarketCustomCheck" data-kn-copy="check"></button></div><p id="knMarketCustomResult" role="status"></p></details></div><div class="kn-market-foot"><p id="knMarketError" role="status" aria-live="polite"></p><div class="kn-market-actions"><button type="button" data-kn-close data-kn-copy="back"></button><button type="submit" id="knMarketApply" data-kn-copy="apply"></button></div></div></form>';
    document.body.appendChild(dialog);
    dialog.addEventListener('click',function(e){
      if(e.target===dialog||e.target.closest('[data-kn-close]')){dialog.close();return;}
      var cat=e.target.closest('[data-kn-category]');if(cat){category=cat.dataset.knCategory;renderOptions();}
      var remove=e.target.closest('[data-kn-remove]');if(remove){var index=draft.indexOf(remove.dataset.knRemove);draft=draft.filter(function(id){return id!==remove.dataset.knRemove;});document.getElementById('knMarketError').textContent='';renderSelected();dialog.querySelectorAll('#knMarketOptions input').forEach(function(input){input.checked=draft.indexOf(input.value)>=0;});var chips=dialog.querySelectorAll('[data-kn-remove]');(chips[Math.min(index,chips.length-1)]||document.getElementById('knMarketQuery')).focus({preventScroll:true});}
    });
    document.getElementById('knMarketOptions').addEventListener('change',function(e){var input=e.target;if(input.tagName!=='INPUT'||!model.find(input.value))return;document.getElementById('knMarketError').textContent='';if(input.checked){if(draft.length>=4){input.checked=false;document.getElementById('knMarketError').textContent=text('max');return;}draft.push(input.value);}else draft=draft.filter(function(id){return id!==input.value;});renderSelected();});
    document.getElementById('knMarketQuery').addEventListener('input',function(e){query=e.target.value;renderOptions();});
    document.getElementById('knMarketQuery').addEventListener('keydown',function(e){if(e.key==='Enter')e.preventDefault();});
    document.getElementById('knMarketForm').addEventListener('submit',function(e){e.preventDefault();if(!model.commit(draft))return;window._selIndices=model.selection();var customs=model.catalog().filter(function(c){return c.category==='custom'&&draft.indexOf(c.id)>=0;});if(customs.length){try{if(typeof window.loadCustomSymbols==='function')window.loadCustomSymbols();customs.forEach(function(c){if(!window._customSymbols.some(function(x){return x.key===c.symbol;}))window._customSymbols.push({key:c.symbol,label:c.label,icon:'📈'});});if(typeof window.saveCustomSymbols==='function')window.saveCustomSymbols();}catch(_){}}dialog.close();});
    function checkCustom(){if(customBusy)return;customBusy=true;var epoch=pickerEpoch,button=document.getElementById('knMarketCustomCheck'),result=document.getElementById('knMarketCustomResult');button.disabled=true;button.textContent=text('checking');model.lookup(document.getElementById('knMarketCustomInput').value).then(function(item){if(epoch!==pickerEpoch||!dialog.open)return;result.textContent=item.label;if(draft.indexOf(item.id)<0&&draft.length<4)draft.push(item.id);else if(draft.indexOf(item.id)<0)document.getElementById('knMarketError').textContent=text('max');category='all';query=item.symbol;document.getElementById('knMarketQuery').value=query;renderSelected();renderOptions();}).catch(function(){if(epoch===pickerEpoch&&dialog.open)result.textContent=text('customError');}).finally(function(){customBusy=false;button.disabled=false;button.textContent=text('check');});}
    document.getElementById('knMarketCustomCheck').onclick=checkCustom;
    document.getElementById('knMarketCustomInput').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();checkCustom();}});
  }
  function decoratePanels() {
    var news=document.getElementById('morning-news-section');
    if(news&&!news.querySelector('.kn-a-section-title')){var title=document.createElement('h2');title.className='kn-a-section-title';title.dataset.knHomeText='news';title.textContent=text('news');news.insertBefore(title,news.firstChild);}
    var wrap=document.getElementById('knTabWrap');if(!wrap)return;
    if(!wrap.querySelector('.kn-a-section-title')){var heading=document.createElement('h2');heading.className='kn-a-section-title';heading.dataset.knHomeText='stocks';heading.textContent=text('stocks');wrap.insertBefore(heading,wrap.firstChild);}
    wrap.querySelectorAll('[data-kn-tab]').forEach(function(b){if(!['stock','div_top','div_cal','div_search'].includes(b.dataset.knTab))return;if(!b.hasAttribute('aria-pressed'))b.setAttribute('aria-pressed',String(b.dataset.knTab==='stock'));b.parentElement.classList.add('kn-a-stock-tabs');});
  }
  async function boot() {
    if(window.knHomeA || !window.KNMarketData || !window.KN_MARKET_CATALOG)return;
    if(window.__knGateReady)try{await window.__knGateReady;}catch(_){}
    var section=document.getElementById('morning-section'),banner=section&&section.querySelector('.morning-banner');if(!banner)return;
    document.body.classList.add('kn-home-a');
    function syncColor(){var color=document.documentElement.style.getPropertyValue('--brand-color').trim().toLowerCase();document.body.toggleAttribute('data-kn-a-custom-color',!!color&&!['#3da060','#a2d6bf'].includes(color));}
    syncColor();
    if(typeof window.applyBrandColor==='function'){var applyColor=window.applyBrandColor;window.applyBrandColor=function(){var result=applyColor.apply(this,arguments);syncColor();return result;};}
    function syncReading(){
      var size='m',font='';try{size=localStorage.getItem('ui_fontscale')||'m';font=localStorage.getItem('ui_font')||'';}catch(_){}
      document.body.style.setProperty('--kn-a-scale',String(({s:.9,m:1,l:1.15,xl:1.3})[size]||1));
      var fonts={gothic:'"Noto Sans JP",sans-serif',round:'"Hiragino Maru Gothic ProN","M PLUS Rounded 1c","Noto Sans JP",sans-serif',mincho:'"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif',klee:'"Klee One",cursive',pop:'"Shippori Mincho",serif'};
      ['--kn-a-serif','--kn-a-sans'].forEach(function(key){if(fonts[font])document.body.style.setProperty(key,fonts[font]);else document.body.style.removeProperty(key);});
    }
    syncReading();
    ['dsSetSize','dsSetFont','dsReset'].forEach(function(name){if(typeof window[name]==='function'){var original=window[name];window[name]=function(){var result=original.apply(this,arguments);syncReading();return result;};}});
    var masthead=document.createElement('div');masthead.className='kn-a-masthead';masthead.innerHTML='<div class="kn-a-top-row"><button type="button" id="knHomeAMenu" aria-label="'+esc(text('menu'))+'">'+icon('menu')+'</button><button type="button" id="knHomeAAccount" aria-label="'+esc(text('account'))+'">'+icon('user')+'</button></div>'+(window.KNNewsOrbit?window.KNNewsOrbit.markup:'')+'<div class="kn-a-orbit-signature"><h1>経済NEWS</h1><p class="kn-a-wordmark-en">ECONOMIC INSIGHT</p></div><div id="knHomeADate"></div>';banner.appendChild(masthead);
    if(window.KNNewsOrbit)window.KNNewsOrbit.mount(masthead);
    var markets=document.createElement('section');markets.id='knHomeMarkets';markets.innerHTML='<div class="kn-a-market-heading"><span data-kn-home-text="market">'+esc(text('market'))+'</span><button type="button" id="knMarketOpen">'+icon('settings')+'<span data-kn-home-text="choose">'+esc(text('choose'))+'</span></button></div><div id="knHomeMarketGrid"></div><div class="kn-a-market-foot"><span data-kn-home-text="rate">'+esc(text('rate'))+'</span><button type="button" id="knMarketRetry" hidden data-kn-home-text="retry">'+esc(text('retry'))+'</button></div>';banner.insertAdjacentElement('afterend',markets);
    try{if(typeof window.loadCustomSymbols==='function')window.loadCustomSymbols();}catch(_){}
    model=window.KNMarketData.create({catalog:window.KN_MARKET_CATALOG,custom:window._customSymbols||[],storage:localStorage,fetch:window.fetch.bind(window),onChange:renderMarkets});
    window._selIndices=model.selection();
    window.knHomeA={acceptBase:model.acceptBase,baseFailed:model.baseFailed,openMarkets:openPicker};
    if(window.__knHomeABase)model.acceptBase(window.__knHomeABase);
    else if(window._mktCache)model.acceptBase({market:window._mktCache,fetched_at:window._mktLastFetch/1000||Date.now()/1000});
    makePicker();
    var drawer=document.getElementById('sideDrawer');if(drawer&&!document.getElementById('knHomeADrawerBrand')){var brand=document.createElement('div');brand.id='knHomeADrawerBrand';brand.innerHTML='<span class="kn-a-nmark" aria-hidden="true">N</span><span>経済NEWS</span><button type="button" aria-label="'+esc(text('close'))+'">×</button>';brand.querySelector('button').onclick=function(){if(window.closeDrawer)window.closeDrawer();};drawer.insertBefore(brand,drawer.firstChild);}
    document.getElementById('knHomeAMenu').onclick=function(){var b=document.getElementById('hamburgerBtn');if(b)b.click();};
    document.getElementById('knHomeAAccount').onclick=function(){var b=document.querySelector('#knBottomNav [data-act="mypage"]');if(b)b.click();};
    document.getElementById('knMarketOpen').onclick=openPicker;
    document.getElementById('knMarketRetry').onclick=function(){model.refresh(true);if(window.loadMorningData)window.loadMorningData();};
    window.openIndexCustomizer=openPicker;
    document.addEventListener('click',function(e){var tab=e.target.closest('#knTabWrap [data-kn-tab]');if(tab&&['stock','div_top','div_cal','div_search'].includes(tab.dataset.knTab))document.querySelectorAll('#knTabWrap [data-kn-tab]').forEach(function(b){b.setAttribute('aria-pressed',String(b===tab));});});
    decoratePanels();
    var attempts=0,initTimer=setInterval(function(){decoratePanels();if(document.querySelector('.kn-a-stock-tabs')||++attempts>=30)clearInterval(initTimer);},300);
    document.addEventListener('langChanged',function(){document.querySelectorAll('[data-kn-home-text]').forEach(function(node){node.textContent=text(node.dataset.knHomeText);});renderDate();renderMarkets();});
    document.addEventListener('visibilitychange',function(){if(!document.hidden)model.refresh(false);});
    setInterval(function(){if(!document.hidden)model.refresh(false);},60000);
    renderMarkets();model.refresh(false);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();

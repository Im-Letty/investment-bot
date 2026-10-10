/* A shared company search, available from the heading on every stock tab. */
(function(){
  'use strict';
  var labels={ja:{search:'銘柄を検索',favorites:'お気に入り',div_cal:'カレンダー',div_top:'配当金',div_short:'配当',actions:'銘柄の操作'},en:{search:'Search stocks',favorites:'Favorites',div_cal:'Calendar',div_top:'Dividends',div_short:'Div.',actions:'Stock actions'},ko:{search:'종목 검색',favorites:'즐겨찾기',div_cal:'캘린더',div_top:'배당',div_short:'배당',actions:'종목 메뉴'},zh:{search:'搜索股票',favorites:'收藏',div_cal:'日历',div_top:'股息',div_short:'股息',actions:'股票操作'}};
  function mountLayout(wrap){
    if(wrap.querySelector('.kn-stock-layout'))return;
    var stock=wrap.querySelector('[data-kn-tab="stock"]'),movers=wrap.querySelector('#homeMoversCard');
    if(!stock||!movers)return;
    var navigation=stock.parentElement,content=movers.parentElement;
    if(navigation.parentElement!==wrap||content.parentElement!==wrap)return;
    var surface=document.createElement('div');surface.className='kn-stock-surface';
    var layout=document.createElement('div');layout.className='kn-stock-layout';
    navigation.classList.add('kn-a-stock-tabs');content.classList.add('kn-stock-body');
    navigation.before(surface);surface.appendChild(layout);layout.appendChild(navigation);layout.appendChild(content);
    // Keep the original heading and shortcut handlers together inside the paper.
    var heading=wrap.querySelector('.kn-stock-heading');if(heading)surface.insertBefore(heading,layout);
  }
  function mountShortcuts(wrap){
    var head=wrap.querySelector('.kn-stock-heading'),opener=wrap.querySelector('.kn-stock-search-open');if(!head||!opener)return;
    mountLayout(wrap);
    var actions=head.querySelector('.kn-stock-actions');
    if(!actions){actions=document.createElement('div');actions.className='kn-stock-actions';actions.setAttribute('role','group');head.insertBefore(actions,head.querySelector('.kn-stock-quick-search'));}
    var icons={div_cal:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M8 14h2M14 14h2M8 17h2"/>',div_top:'<circle cx="12" cy="12" r="9"/><path d="m8.5 7.5 3.5 5 3.5-5M12 12.5v5M8.5 12.5h7M8.5 15.5h7"/>'};
    ['div_top','div_cal'].forEach(function(key){
      var button=wrap.querySelector('[data-kn-tab="'+key+'"]');if(!button||button.classList.contains('kn-stock-shortcut'))return;
      // Move the existing button: its original onclick still opens the existing view.
      button.classList.add('kn-stock-shortcut');button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+icons[key]+'</svg>'+(key==='div_top'?'<span class="kn-stock-shortcut-label" aria-hidden="true">配当</span>':'');
      button.setAttribute('aria-controls','knDivHolder');actions.appendChild(button);
    });
    if(opener.parentNode!==actions||actions.lastElementChild!==opener)actions.appendChild(opener);
    if(head.dataset.shortcutsReady)return;head.dataset.shortcutsReady='true';
    function sync(){
      var lang=(window.currentLang||document.documentElement.lang||'ja').split('-')[0],copy=labels[lang]||labels.ja;
      actions.setAttribute('aria-label',copy.actions);opener.setAttribute('aria-label',copy.search);opener.title=copy.search;
      actions.querySelectorAll('.kn-stock-shortcut').forEach(function(button){button.setAttribute('aria-label',copy[button.dataset.knTab]);button.title=copy[button.dataset.knTab];});
      var shortLabel=actions.querySelector('.kn-stock-shortcut-label');if(shortLabel)shortLabel.textContent=copy.div_short;
    }
    sync();new MutationObserver(sync).observe(wrap,{attributes:true,attributeFilter:['data-stock-main']});document.addEventListener('langChanged',sync);
  }
  function mountHomeButton(wrap,heading){
    var button=document.createElement('button');button.type='button';button.className='kn-stock-home';
    button.textContent=heading.textContent;button.dataset.knHomeText=heading.dataset.knHomeText||'stocks';
    heading.removeAttribute('data-kn-home-text');heading.replaceChildren(button);
    button.setAttribute('aria-controls','homeMoversCard knWatchSec');
    button.onclick=function(){if(window.__knSetSub)window.__knSetSub(wrap.dataset.stockView==='watch'?'watch':'movers');};
  }
  window.KNStockSearch={mount:function(wrap){
    if(wrap.querySelector('.kn-stock-search-open')){mountShortcuts(wrap);return;}
    var heading=wrap.querySelector('.kn-a-section-title');if(!heading)return;
    mountHomeButton(wrap,heading);
    var icon='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.4 15.4 4.6 4.6"/></svg>';
    var head=document.createElement('div');head.className='kn-stock-heading kn-section-header';heading.before(head);
    var symbol=document.createElement('span');symbol.className='kn-section-symbol';symbol.setAttribute('aria-hidden','true');
    symbol.innerHTML='<svg viewBox="0 0 48 48" fill="none" focusable="false"><rect class="kn-symbol-tint" x="6" y="7" width="36" height="34" rx="3"/><rect x="6" y="7" width="36" height="34" rx="3"/><path d="M12 34h24M12 34V14M14 28l7-7 6 4 9-10M31 15h5v5"/></svg>';
    head.appendChild(symbol);head.appendChild(heading);
    var opener=document.createElement('button');opener.type='button';opener.className='kn-stock-search-open';opener.innerHTML=icon+'<span>検索</span>';
    opener.setAttribute('aria-label','銘柄を検索');opener.setAttribute('aria-haspopup','dialog');opener.setAttribute('aria-expanded','false');opener.setAttribute('aria-controls','alert-section');head.appendChild(opener);
    var pointerScroll=null;
    // Capture before pointer focus can move an edge-of-screen shortcut.
    opener.addEventListener('pointerdown',function(event){
      pointerScroll=event.button===0&&window.KNViewStability?window.KNViewStability.capture(opener):null;
    });
    opener.addEventListener('pointercancel',function(){pointerScroll=null;});
    opener.addEventListener('keydown',function(){pointerScroll=null;});
    opener.onclick=function(event){
      var snapshot=(event&&event.detail&&pointerScroll)||(window.KNViewStability&&window.KNViewStability.capture(opener));
      pointerScroll=null;
      if(window.openStockWatchManager)window.openStockWatchManager({mode:'search',trigger:opener,snapshot:snapshot});
    };
    mountShortcuts(wrap);
  }};
})();

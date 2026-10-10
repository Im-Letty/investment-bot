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
    var layout=document.createElement('div');layout.className='kn-stock-layout';
    navigation.classList.add('kn-a-stock-tabs');content.classList.add('kn-stock-body');
    navigation.before(layout);layout.appendChild(navigation);layout.appendChild(content);
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
    if(wrap.querySelector('.kn-stock-search')){mountShortcuts(wrap);return;}
    var heading=wrap.querySelector('.kn-a-section-title');if(!heading)return;
    mountHomeButton(wrap,heading);
    var icon='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.4 15.4 4.6 4.6"/></svg>';
    var head=document.createElement('div');head.className='kn-stock-heading';heading.before(head);head.appendChild(heading);
    var opener=document.createElement('button');opener.type='button';opener.className='kn-stock-search-open';opener.innerHTML=icon+'<span>検索</span>';
    opener.setAttribute('aria-label','銘柄を検索');opener.setAttribute('aria-haspopup','dialog');opener.setAttribute('aria-expanded','false');opener.setAttribute('aria-controls','knStockSearchDialog');head.appendChild(opener);
    var section=document.createElement('dialog');section.id='knStockSearchDialog';section.className='kn-stock-search kn-stock-search-dialog';section.setAttribute('aria-labelledby','knStockSearchTitle');
    section.innerHTML='<div class="kn-stock-search-dialog-head"><h3 id="knStockSearchTitle" hidden>銘柄を検索</h3><button type="button" class="kn-stock-search-close" aria-label="検索を閉じる">閉じる</button></div><form class="kn-stock-search-form" role="search">'+icon+'<input type="search" aria-label="会社名・銘柄コードで検索" placeholder="会社名・銘柄コード" autocomplete="off" enterkeyhint="search"><button type="submit">検索</button></form><div class="kn-stock-search-panel" hidden><div class="kn-stock-search-head"><span role="status" aria-live="polite"></span></div><div class="kn-stock-search-results"></div></div>';
    head.insertAdjacentElement('afterend',section);
    var input=section.querySelector('input'),form=section.querySelector('form'),panel=section.querySelector('.kn-stock-search-panel'),status=section.querySelector('[role="status"]'),results=section.querySelector('.kn-stock-search-results');
    var timer,controller,epoch=0,previousOverflow,isShowing=false;
    function cancel(){clearTimeout(timer);epoch++;if(controller)controller.abort();}
    function clearResults(){cancel();panel.hidden=true;results.replaceChildren();}
    function restore(){if(!isShowing)return;isShowing=false;clearResults();document.body.style.overflow=previousOverflow;opener.setAttribute('aria-expanded','false');opener.focus({preventScroll:true});}
    function close(){if(section.open)section.close();restore();}
    opener.onclick=function(){
      if(section.open)return;
      previousOverflow=document.body.style.overflow;section.showModal();isShowing=true;document.body.style.overflow='hidden';
      opener.setAttribute('aria-expanded','true');input.focus({preventScroll:true});
      if(input.value.trim())search();
    };
    section.querySelector('.kn-stock-search-close').onclick=close;
    section.addEventListener('cancel',function(event){event.preventDefault();close();});
    section.addEventListener('close',function(){if(!section.open)restore();});
    section.addEventListener('click',function(event){if(event.target!==section)return;var rect=section.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();});
    async function search(){
      cancel();var q=input.value.trim(),request=epoch;if(!q){clearResults();return;}
      panel.hidden=false;results.replaceChildren();status.textContent='検索しています…';controller=new AbortController();var currentController=controller;
      var timeout=setTimeout(function(){currentController.abort();},12000);
      try{
        var response=await fetch('/api/lookup?q='+encodeURIComponent(q),{signal:controller.signal});if(!response.ok)throw new Error('search');
        var data=await response.json();if(request!==epoch)return;if(data.unavailable)throw new Error('unavailable');
        var rows=Array.isArray(data.results)?data.results:[];
        status.textContent=rows.length?'会社を選んでください':'見つかりませんでした。会社名や銘柄コードを変えてお試しください。';
        rows.forEach(function(row){
          var button=document.createElement('button');button.type='button';button.className='kn-stock-search-company';
          var name=document.createElement('strong');name.textContent=row.name;
          var code=document.createElement('span');code.textContent=String(row.symbol||'').replace(/\.T$/,'');
          button.append(name,code);button.setAttribute('aria-label',row.name+' '+code.textContent+'の会社情報を開く');
          button.onclick=function(){if(window.KNCompanyProfile){close();window.KNCompanyProfile.open(row.symbol,row.name,opener);}};results.appendChild(button);
        });
      }catch(error){if(request===epoch)status.textContent='検索できませんでした。「検索」を押してもう一度お試しください。';}
      finally{clearTimeout(timeout);}
    }
    form.onsubmit=function(event){event.preventDefault();search();};
    input.addEventListener('input',function(event){cancel();if(!input.value.trim()){clearResults();return;}if(!event.isComposing)timer=setTimeout(search,300);});
    input.addEventListener('compositionend',function(){cancel();timer=setTimeout(search,300);});
    mountShortcuts(wrap);
  }};
})();

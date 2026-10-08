/* A shared company search, available from the heading on every stock tab. */
(function(){
  'use strict';
  var labels={ja:{search:'銘柄を検索',favorites:'お気に入り',div_cal:'カレンダー',div_top:'配当金',actions:'銘柄の操作'},en:{search:'Search stocks',favorites:'Favorites',div_cal:'Calendar',div_top:'Dividends',actions:'Stock actions'},ko:{search:'종목 검색',favorites:'즐겨찾기',div_cal:'캘린더',div_top:'배당',actions:'종목 메뉴'},zh:{search:'搜索股票',favorites:'收藏',div_cal:'日历',div_top:'股息',actions:'股票操作'}};
  function mountShortcuts(wrap){
    var head=wrap.querySelector('.kn-stock-heading'),opener=wrap.querySelector('.kn-stock-search-open');if(!head||!opener)return;
    var actions=head.querySelector('.kn-stock-actions');
    if(!actions){actions=document.createElement('div');actions.className='kn-stock-actions';actions.setAttribute('role','group');head.insertBefore(actions,head.querySelector('.kn-stock-quick-search'));}
    var icons={favorites:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',div_cal:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M8 14h2M14 14h2M8 17h2"/>',div_top:'<circle cx="12" cy="12" r="9"/><path d="m8.5 7.5 3.5 5 3.5-5M12 12.5v5M8.5 12.5h7M8.5 15.5h7"/>'};
    ['favorites','div_cal','div_top'].forEach(function(key){
      var button=wrap.querySelector('[data-kn-tab="'+key+'"]');if(!button||button.classList.contains('kn-stock-shortcut'))return;
      // Move the existing button: its original onclick still opens the existing view.
      button.classList.add('kn-stock-shortcut');button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+icons[key]+'</svg>';
      if(key==='div_cal'||key==='div_top')button.setAttribute('aria-controls','knDivHolder');actions.appendChild(button);
    });
    if(head.dataset.shortcutsReady)return;head.dataset.shortcutsReady='true';
    var title=document.createElement('h3');title.className='kn-stock-view-title';title.hidden=true;
    var sub=wrap.querySelector('#knSubRow');if(sub)sub.before(title);
    function sync(){
      var lang=(window.currentLang||document.documentElement.lang||'ja').split('-')[0],copy=labels[lang]||labels.ja;
      actions.setAttribute('aria-label',copy.actions);opener.setAttribute('aria-label',copy.search);opener.title=copy.search;
      actions.querySelectorAll('.kn-stock-shortcut').forEach(function(button){button.setAttribute('aria-label',copy[button.dataset.knTab]);button.title=copy[button.dataset.knTab];});
      var current=wrap.dataset.stockMain;title.hidden=!['favorites','div_cal','div_top'].includes(current);title.textContent=copy[current]||'';
    }
    sync();new MutationObserver(sync).observe(wrap,{attributes:true,attributeFilter:['data-stock-main']});document.addEventListener('langChanged',sync);
  }
  window.KNStockSearch={mount:function(wrap){
    if(wrap.querySelector('.kn-stock-search')){mountShortcuts(wrap);return;}
    var heading=wrap.querySelector('.kn-a-section-title');if(!heading)return;
    var icon='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.4 15.4 4.6 4.6"/></svg>';
    var head=document.createElement('div');head.className='kn-stock-heading';heading.before(head);head.appendChild(heading);
    var quickForm=document.createElement('form');quickForm.className='kn-stock-quick-search';quickForm.setAttribute('role','search');quickForm.setAttribute('aria-label','銘柄の検索');
    var quickInput=document.createElement('input');quickInput.type='search';quickInput.setAttribute('aria-label','会社名・銘柄コード');quickInput.placeholder='会社名・銘柄コード';quickInput.autocomplete='off';quickInput.setAttribute('enterkeyhint','search');quickForm.appendChild(quickInput);
    var opener=document.createElement('button');opener.type='submit';opener.className='kn-stock-search-open';opener.innerHTML=icon+'<span>検索</span>';
    opener.setAttribute('aria-label','銘柄を検索');opener.setAttribute('aria-haspopup','dialog');opener.setAttribute('aria-expanded','false');opener.setAttribute('aria-controls','knStockSearchDialog');quickForm.appendChild(opener);head.appendChild(quickForm);
    var section=document.createElement('dialog');section.id='knStockSearchDialog';section.className='kn-stock-search kn-stock-search-dialog';section.setAttribute('aria-labelledby','knStockSearchTitle');
    section.innerHTML='<div class="kn-stock-search-dialog-head"><h3 id="knStockSearchTitle">銘柄を検索</h3><button type="button" class="kn-stock-search-close" aria-label="検索を閉じる">閉じる</button></div><form class="kn-stock-search-form" role="search">'+icon+'<input type="search" aria-label="会社名・銘柄コードで検索" placeholder="会社名・銘柄コード" autocomplete="off" enterkeyhint="search"><button type="submit">検索</button></form><div class="kn-stock-search-panel" hidden><div class="kn-stock-search-head"><span role="status" aria-live="polite"></span></div><div class="kn-stock-search-results"></div></div>';
    head.insertAdjacentElement('afterend',section);
    var input=section.querySelector('input'),form=section.querySelector('form'),panel=section.querySelector('.kn-stock-search-panel'),status=section.querySelector('[role="status"]'),results=section.querySelector('.kn-stock-search-results');
    var timer,controller,epoch=0,previousOverflow,isShowing=false,quickComposing=false;
    function cancel(){clearTimeout(timer);epoch++;if(controller)controller.abort();}
    function clearResults(){cancel();panel.hidden=true;results.replaceChildren();}
    function restore(){if(!isShowing)return;isShowing=false;quickInput.value=input.value;clearResults();document.body.style.overflow=previousOverflow;opener.setAttribute('aria-expanded','false');opener.focus({preventScroll:true});}
    function close(){if(section.open)section.close();restore();}
    quickForm.onsubmit=function(event){
      event.preventDefault();if(quickComposing)return;
      if(section.open)return;
      input.value=quickInput.value;
      previousOverflow=document.body.style.overflow;section.showModal();isShowing=true;document.body.style.overflow='hidden';
      opener.setAttribute('aria-expanded','true');input.focus({preventScroll:true});
      if(input.value.trim())search();
    };
    quickInput.addEventListener('compositionstart',function(){quickComposing=true;});
    quickInput.addEventListener('compositionend',function(){quickComposing=false;});
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

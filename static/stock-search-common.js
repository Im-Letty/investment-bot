/* A shared company search, available from the heading on every stock tab. */
(function(){
  'use strict';
  window.KNStockSearch={mount:function(wrap){
    if(wrap.querySelector('.kn-stock-search'))return;
    var heading=wrap.querySelector('.kn-a-section-title');if(!heading)return;
    var icon='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.4 15.4 4.6 4.6"/></svg>';
    var head=document.createElement('div');head.className='kn-stock-heading';heading.before(head);head.appendChild(heading);
    var opener=document.createElement('button');opener.type='button';opener.className='kn-stock-search-open';opener.innerHTML=icon+'<span>検索</span>';
    opener.setAttribute('aria-label','銘柄を検索');opener.setAttribute('aria-haspopup','dialog');opener.setAttribute('aria-expanded','false');opener.setAttribute('aria-controls','knStockSearchDialog');head.appendChild(opener);
    var section=document.createElement('dialog');section.id='knStockSearchDialog';section.className='kn-stock-search kn-stock-search-dialog';section.setAttribute('aria-labelledby','knStockSearchTitle');
    section.innerHTML='<div class="kn-stock-search-dialog-head"><h3 id="knStockSearchTitle">銘柄を検索</h3><button type="button" class="kn-stock-search-close" aria-label="検索を閉じる">閉じる</button></div><form class="kn-stock-search-form" role="search">'+icon+'<input type="search" aria-label="会社名・銘柄コードで検索" placeholder="会社名・銘柄コード" autocomplete="off" enterkeyhint="search"><button type="submit">検索</button></form><div class="kn-stock-search-panel" hidden><div class="kn-stock-search-head"><span role="status" aria-live="polite"></span></div><div class="kn-stock-search-results"></div></div>';
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
  }};
})();

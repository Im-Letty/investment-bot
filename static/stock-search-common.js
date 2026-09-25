/* A shared company search; changing stock tabs never removes the search field. */
(function(){
  'use strict';
  window.KNStockSearch={mount:function(wrap){
    if(wrap.querySelector('.kn-stock-search'))return;
    var section=document.createElement('section');section.className='kn-stock-search';section.setAttribute('aria-label','銘柄を検索');
    section.innerHTML='<form class="kn-stock-search-form" role="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input type="search" aria-label="会社名・銘柄コードで検索" placeholder="会社名・銘柄コード" autocomplete="off" enterkeyhint="search"><button type="submit">検索</button></form><div class="kn-stock-search-panel" hidden><div class="kn-stock-search-head"><span role="status" aria-live="polite"></span><button type="button" aria-label="検索結果を閉じる">閉じる</button></div><div class="kn-stock-search-results"></div></div>';
    var heading=wrap.querySelector('.kn-a-section-title');heading.insertAdjacentElement('afterend',section);
    var input=section.querySelector('input'),form=section.querySelector('form'),panel=section.querySelector('.kn-stock-search-panel'),status=section.querySelector('[role="status"]'),results=section.querySelector('.kn-stock-search-results');
    var timer,controller,epoch=0;
    function cancel(){clearTimeout(timer);epoch++;if(controller)controller.abort();}
    function close(){cancel();panel.hidden=true;results.replaceChildren();}
    section.querySelector('.kn-stock-search-head button').onclick=function(){close();input.focus();};
    async function search(){
      cancel();var q=input.value.trim(),request=epoch;if(!q){close();return;}
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
          button.onclick=function(){if(window.KNCompanyProfile)window.KNCompanyProfile.open(row.symbol,row.name);};results.appendChild(button);
        });
      }catch(error){if(request===epoch)status.textContent='検索できませんでした。「検索」を押してもう一度お試しください。';}
      finally{clearTimeout(timeout);}
    }
    form.onsubmit=function(event){event.preventDefault();search();};
    input.addEventListener('input',function(event){cancel();if(!input.value.trim()){close();return;}if(!event.isComposing)timer=setTimeout(search,300);});
    input.addEventListener('compositionend',function(){cancel();timer=setTimeout(search,300);});
    input.addEventListener('keydown',function(event){if(event.key==='Escape')close();});
  }};
})();

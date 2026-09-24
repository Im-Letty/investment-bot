(function() {
  'use strict';
  var stops={}, signatures={}, calendarData=null, calendarMonth='';
  function lang(){return window.currentLang||document.documentElement.lang||'ja';}
  function tr(key,fallback){return window._divT?window._divT(key,fallback):fallback;}
  function words(){return ({ja:['保存済み · ','取得 ','配当情報を確認しています…','配当情報を取得できませんでした。','再読み込み','過去1年の配当実績','表示できる配当情報がありません。'],en:['Saved · ','Retrieved ','Checking dividends…','Dividend data unavailable.','Retry','Dividends paid in the past 12 months','No dividend data available.'],ko:['저장됨 · ','조회 ','배당 정보를 확인하고 있습니다…','배당 정보를 가져오지 못했습니다.','다시 시도','지난 12개월 배당 실적','표시할 배당 정보가 없습니다.'],zh:['已保存 · ','获取 ','正在确认股息信息…','无法获取股息信息。','重试','过去12个月的股息实绩','暂无可显示的股息信息。']})[lang()]||['Saved · ','Retrieved ','Checking dividends…','Dividend data unavailable.','Retry','Dividends paid in the past 12 months','No dividend data available.'];}
  function visible(pane) {
    return !document.hidden && pane.classList.contains('active') && pane.getClientRects().length>0;
  }
  function escape(value) { return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function number(value,digits) { return Number.isFinite(value)?value.toLocaleString('ja-JP',{maximumFractionDigits:digits,minimumFractionDigits:digits}):'—'; }
  function stamp(value) {
    if(value==null || value==='' || typeof value!=='number' && typeof value!=='string')return '';
    var date=new Date(typeof value==='number'?value*1000:value);
    return isNaN(date.getTime())?'':new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(date)+' JST';
  }
  function status(pane,data,saved,error) {
    var el=pane.querySelector('.dividend-snapshot-status');
    if(!el) {el=document.createElement('div');el.className='dividend-snapshot-status';el.setAttribute('role','status');pane.appendChild(el);}
    var at=data&&stamp(data.updated_at), text='';
    if(at) text=(saved||error||data.status==='stale'?words()[0]:words()[1])+at;
    else if(data&&data.refreshing&&!error) text=words()[2];
    else text=words()[3];
    el.textContent=text;
    if(error || !at && (!data||!data.refreshing)) {
      var retry=document.createElement('button');retry.type='button';retry.className='dividend-retry';retry.textContent=words()[4];
      retry.onclick=function(){if(pane.dataset.pane==='cal')window.loadDividendCalendar();else if(pane.dataset.pane==='search')window.doDividendSearch();else list(pane.dataset.pane);};el.appendChild(retry);
    }
  }
  function remember(key,data) {
    if(!Array.isArray(data.items)) return;
    if(key==='top')window._topCodes=new Set(data.items.map(function(x){return x.code;}));
    if(key==='yearly')window._yrCodes=new Set(data.items.map(function(x){return x.code;}));
    data.items.forEach(function(x){window._allStocksData[x.code]=x;});
  }
  function list(key) {
    var pane=document.querySelector('.dividend-pane[data-pane="'+key+'"]'),el=document.getElementById('dividend-'+key+'-list');
    if(!pane||!el)return;
    if(stops[key])stops[key]();
    // Keep the previous rows in place throughout a refresh.
    pane.querySelector('.dividend-loading').style.display='none';
    function render(data,saved) {
      var items=(data.items||[]).filter(function(it){return Number.isFinite(it[key==='top'?'yield_pct':'annual_dividend']);});
      if(items.length) {
        remember(key,data);
        var signature=lang()+JSON.stringify(items);
        if(signature!==signatures[key]) {
          var html=items.map(function(it,idx) {
            var name=window._stockName?window._stockName(it.code,it.name):it.name;
            var yen=tr('div_yen','円');
            var main=key==='top'?number(it.yield_pct,2)+'%':number(it.annual_dividend,2)+yen;
            function metric(label,value,kind) {
              return '<div class="div-metric div-metric--'+kind+'"><span class="div-metric-label">'+escape(label)+'</span> <span class="div-metric-value">'+escape(value)+'</span></div>';
            }
            var sub=key==='top'?metric(tr('div_annual','年間配当'),number(it.annual_dividend,2)+yen,'distribution'):metric(tr('div_yield','利回り'),number(it.yield_pct,2)+'%','distribution');
            if(Number.isFinite(it.price))sub+=metric(tr('div_kabuka','株価'),number(it.price,2)+yen,'quote');
            return '<div class="div-item"><div class="div-rank">'+(idx+1)+'</div><div><button type="button" class="cp-company-link" data-company-profile="'+escape(it.ticker||it.code+'.T')+'" data-company-name="'+escape(name)+'" aria-label="'+escape(name)+'の会社情報を開く"><span class="div-name">'+escape(name)+'</span><span class="div-code">'+escape(it.code)+'</span></button></div><div class="dividend-row-values"><div class="div-yield">'+escape(main)+'</div><div class="div-metrics">'+sub+'</div>'+(it.price_updated_at?'<div class="div-meta div-price-time">'+escape(tr('div_kabuka','株価')+' '+stamp(it.price_updated_at))+'</div>':'')+'</div></div>';
          }).join('');
          el.innerHTML=html;signatures[key]=signature;
        }
        el.dataset.loaded='1';
        var basis=pane.querySelector('.dividend-basis');
        if(!basis){basis=document.createElement('div');basis.className='dividend-basis';pane.insertBefore(basis,el);}
        basis.textContent=items.some(function(it){return it.annual_dividend_basis==='trailing_12m';})?words()[5]:'';
      } else if(!el.dataset.loaded && !data.refreshing && data.updated_at) {
        el.textContent=words()[6];
      }
      status(pane,data,saved);
    }
    if(!window.KNDividendData.peek(key))status(pane,{refreshing:true});
    stops[key]=window.KNDividendData.watch(key,render,function(_,retained){status(pane,retained,false,true);},function(){return visible(pane);});
  }
  function calendar(month,render) {
    var pane=document.querySelector('.dividend-pane[data-pane="cal"]');
    if(stops.cal)stops.cal();
    calendarMonth=month;
    var key='calendar?month='+month;
    pane.querySelector('.dividend-loading').style.display='none';
    // Rankings only add badges; their requests never hold up the calendar.
    ['top','yearly'].forEach(function(kind) {
      var saved=window.KNDividendData.peek(kind);if(saved)remember(kind,saved);
      window.KNDividendData.get(kind).then(function(d){
        remember(kind,d);
        if(calendarMonth===month&&calendarData&&visible(pane))render(calendarData);
      }).catch(function(){});
    });
    if(!window.KNDividendData.peek(key)) {calendarData=null;render({days:[]});status(pane,{refreshing:true});}
    stops.cal=window.KNDividendData.watch(key,function(data,saved){
      if(calendarMonth!==month)return;
      if(Array.isArray(data.days)) {
        calendarData=data;
        data.days.forEach(function(day){(day.items||[]).forEach(function(it){window._allStocksData[it.code]=it;});});
        render(data);
      }
      status(pane,data,saved);
    },function(_,retained){status(pane,retained,false,true);},function(){return calendarMonth===month&&visible(pane);});
  }
  function search(query,render) {
    if(stops.search)stops.search();
    var pane=document.querySelector('.dividend-pane[data-pane="search"]'),box=document.getElementById('dividend-search-result');
    if(!query){box.textContent='';return;}
    if(box.dataset.query!==query){box.textContent='';box.dataset.query=query;}
    var key='search?q='+encodeURIComponent(query);
    if(!window.KNDividendData.peek(key))status(pane,{refreshing:true});
    stops.search=window.KNDividendData.watch(key,function(data,saved){
      if(Number.isFinite(data.price)||Number.isFinite(data.annual_dividend))render(data);
      status(pane,data,saved);
    },function(_,retained){status(pane,retained,false,true);},function(){return visible(pane)&&document.getElementById('dividend-search-input').value.trim()===query;});
  }
  window.KNDividendView={list:list,calendar:calendar,search:search};
})();

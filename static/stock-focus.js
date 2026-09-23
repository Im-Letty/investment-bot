/* Approved stock panel: live rankings and independently reviewed company stories. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document){root.StockFocus=api;api.start(root);}
})(typeof window==='undefined'?null:window,function(){
  'use strict';
  const DAY=86400000, CACHE_AGE=7*DAY;
  const escape=value=>String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const amount=value=>Math.abs(value).toLocaleString('ja-JP',{maximumFractionDigits:2});
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const dateLabel=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.replace(/-/g,'/'):'';
  function normalizeItem(item){
    if(!item||!finite(item.price)||!finite(item.prev)||item.price<=0||item.prev<=0||typeof item.symbol!=='string')return null;
    const delta=item.price-item.prev;
    return {...item,change_value:delta,pct:delta/item.prev*100,currency:item.currency||(item.symbol.endsWith('.T')?'JPY':'USD')};
  }
  function normalizePayload(data,now=Date.now()){
    if(!data||!finite(data.updated_at)||data.updated_at<=0||now-data.updated_at*1000>CACHE_AGE||data.updated_at*1000>now+60000)return null;
    if(!Array.isArray(data.items))return null;
    const symbols=new Set(),items=[];
    for(const raw of data.items){const item=normalizeItem(raw);if(item&&finite(item.fetched_at)&&item.fetched_at*1000<=now+60000&&now-item.fetched_at*1000<CACHE_AGE&&dateLabel(item.trade_date)&&!symbols.has(item.symbol)){symbols.add(item.symbol);items.push(item);}}
    return items.length?{...data,items}:null;
  }
  function quote(raw,showDate=true){
    const item=normalizeItem(raw);
    if(!item)return '<div class="sf-quote"><span class="sf-quote-date">株価を確認できませんでした</span></div>';
    const delta=item.change_value,sign=delta>0?'+':delta<0?'−':'',direction=delta>0?'up':delta<0?'down':'flat',unit=item.currency==='JPY'?'円':item.currency==='USD'?'米ドル':escape(item.currency);
    return '<div class="sf-quote"><span class="sf-price">'+amount(item.price)+'<small>'+unit+'</small></span><span class="sf-change sf-'+direction+'">'+sign+amount(delta)+unit+' <span>（'+sign+Math.abs(item.pct).toFixed(2)+'%）</span></span>'+(showDate&&dateLabel(item.trade_date)?'<span class="sf-quote-date">'+dateLabel(item.trade_date)+' の株価</span>':'')+'</div>';
  }
  function tradeDates(items){
    const groups=new Map();
    const market=item=>item.symbol.endsWith('.T')?'日本':'米国';
    for(const item of items){if(!groups.has(market(item)))groups.set(market(item),new Set());groups.get(market(item)).add(dateLabel(item.trade_date));}
    const parts=Array.from(groups,([key,dates])=>((groups.size>1?key+' ':'')+(dates.size===1&&![...dates].includes('')?[...dates][0]:'銘柄ごとの日付')));
    return {text:parts.length?'株価 '+parts.join(' / '):'',showDate:item=>groups.get(market(item)).size!==1};
  }
  function stockCode(symbol){
    return '<small class="sf-stock-code">'+escape(String(symbol||'').replace(/\.T$/,''))+'</small>';
  }
  function row(item,index,showDate=true){
    return '<li class="sf-row"><span class="sf-rank" aria-label="'+(index+1)+'位">'+(index+1)+'</span><div class="sf-stock-name" title="'+escape(item.symbol)+'"><span>'+escape(item.name||item.symbol)+'</span>'+stockCode(item.symbol)+'</div>'+quote(item,showDate)+'</li>';
  }
  function watchRow(raw,symbol,formatChange){
    const item=raw||{},name=escape(item.name||symbol);
    if(!finite(item.price)||item.price<=0)return '<div class="sf-watch-row"><div class="sf-stock-name">'+name+stockCode(symbol)+'</div><span class="sf-quote-date">株価を確認できませんでした</span></div>';
    const currency=item.currency||(symbol.endsWith('.T')?'JPY':''),unit=({JPY:'円',USD:'米ドル',EUR:'ユーロ',GBP:'英ポンド'})[currency]||currency;
    const change=typeof formatChange==='function'?formatChange(item,{symbol,currency},'ja'):{amount:'',percent:'',direction:'flat'};
    return '<div class="sf-watch-row"><div class="sf-stock-name" title="'+escape(symbol)+'"><span>'+name+'</span>'+stockCode(symbol)+'</div><div class="sf-quote"><span class="sf-price">'+item.price.toLocaleString('ja-JP',{maximumSignificantDigits:15})+'<small>'+escape(unit)+'</small></span>'+(change.amount||change.percent?'<span class="sf-change sf-'+change.direction+'">'+escape(change.amount)+(change.percent?' <span>（'+escape(change.percent)+'）</span>':'')+'</span>':'')+'</div></div>';
  }
  function ranked(data,direction){
    return (data?data.items:[]).filter(x=>direction==='up'?x.pct>=3:x.pct<=-3).sort((a,b)=>direction==='up'?b.pct-a.pct:a.pct-b.pct).slice(0,20);
  }
  function ranking(data,direction,active,status){
    const items=ranked(data,direction),dates=tradeDates(data?data.items:[]),rows=(list,offset=0)=>list.map((item,index)=>row(item,index+offset,dates.showDate(item))).join('');
    const empty=data?'条件に当てはまる銘柄はありません。':status==='error'?'株価を確認できませんでした。':'株価を確認しています…';
    const more=items.length>5?'<details class="sf-more" data-stock-detail="rank-'+direction+'"><summary><span class="sf-closed">もっと見る<span class="sf-sr-only">、残り'+(items.length-5)+'社</span></span><span class="sf-open">閉じる</span><i aria-hidden="true"></i></summary><ol class="sf-rows" start="6">'+rows(items.slice(5),5)+'</ol></details>':'';
    return '<section class="sf-ranking" id="sf-rank-panel-'+direction+'" role="tabpanel" aria-labelledby="sf-rank-tab-'+direction+'" tabindex="0"'+(active!==direction?' hidden':'')+'>'+(items.length?'<ol class="sf-rows">'+rows(items.slice(0,5))+'</ol>':'<p class="sf-state">'+empty+(!data&&status==='error'?'<button class="sf-retry" type="button" data-stock-retry>再読み込み</button>':'')+'</p>')+more+'</section>';
  }
  function rankingMarkup(data,active='up',status='loading'){
    const tabs='<div class="sf-direction-tabs" role="tablist" aria-label="ランキングの種類">'+[['up','上昇'],['down','急落']].map(([key,label])=>'<button type="button" role="tab" id="sf-rank-tab-'+key+'" data-sf-rank="'+key+'" aria-controls="sf-rank-panel-'+key+'" aria-selected="'+(active===key)+'" tabindex="'+(active===key?0:-1)+'">'+label+'</button>').join('')+'</div>';
    const scope=data&&data.scope==='selected_jp_us'?'日本・米国':'日本';
    const meta=data?'<footer class="sf-meta"><span class="sf-meta-date">'+escape(tradeDates(data.items).text)+'</span><span>対象 '+scope+(finite(data.total_scanned)?' '+data.total_scanned+'社':'')+' · '+new Date(data.updated_at*1000).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})+' 取得'+(status==='error'?' · 保存済みの価格':data.stale?' · 更新を確認中':'')+'</span></footer>':'';
    return '<div class="sf-content"><section class="sf-market" aria-label="株価ランキング"><div class="sf-rank-toolbar">'+tabs+'<span class="sf-column-hint">株価 / 前日比</span></div><div class="sf-rankings">'+ranking(data,'up',active,status)+ranking(data,'down',active,status)+'</div>'+meta+'</section></div>';
  }
  function validStories(data,now=Date.now()){
    if(!data||!Array.isArray(data.companies)||!dateLabel(data.edition_date)||!dateLabel(data.valid_until))return [];
    const today=new Date(now+9*3600000).toISOString().slice(0,10);
    if(data.edition_date>today||data.valid_until<today)return [];
    const symbols=new Set(),sources=new Set();
    return data.companies.filter(x=>{
      if(!x||!['symbol','name','sector','title','business','event','outlook','source_url','published_date'].every(k=>typeof x[k]==='string'&&x[k].trim())||!/^https:\/\//.test(x.source_url)||!dateLabel(x.published_date)||x.published_date>today)return false;
      const symbol=x.symbol.trim().toUpperCase(),source=x.source_url.split('#')[0].replace(/\/$/,'');
      if(symbols.has(symbol)||sources.has(source))return false;
      symbols.add(symbol);sources.add(source);return true;
    }).slice(0,3);
  }
  function movement(raw){
    const q=normalizeItem(raw);
    if(!q)return '株価の情報がそろい次第、値動きを表示します。';
    const unit=q.currency==='JPY'?'円':'米ドル';
    return (dateLabel(q.trade_date)?dateLabel(q.trade_date)+'の株価は、':'取得した株価は、')+'前の取引日の終値'+(q.change_value===0?'と同じでした。':'より'+amount(q.change_value)+unit+'（'+Math.abs(q.pct).toFixed(2)+'%）'+(q.change_value>0?'上がりました。':'下がりました。'));
  }
  function companyMarkup(editorial,data,status='loading',now=Date.now()){
    const stories=validStories(editorial,now),quotes=new Map((data?data.items:[]).map(x=>[x.symbol,x]));
    const cards=stories.map(item=>{
      const value=quotes.get(item.symbol);
      const explanation=[['どんな会社？',item.business],['何があった？',item.event],['これからの注目は？',item.outlook]].map(([heading,body],index)=>'<section class="sf-explain-block"><h5>'+escape(heading)+'</h5><p'+(index===0?' class="sf-business"':'')+'>'+escape(body)+'</p></section>').join('');
      return '<article class="sf-company"><p class="sf-company-name">'+escape(item.name)+stockCode(item.symbol)+'</p><details class="sf-explanation" data-stock-detail="'+escape(item.symbol)+'"><summary><h4>'+escape(item.title)+'</h4><span class="sf-sr-only sf-closed">'+escape(item.name)+'の記事を開く</span><span class="sf-sr-only sf-open">'+escape(item.name)+'の記事を閉じる</span><span class="sf-disclosure-mark" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><path d="M4 10h12"/><path class="sf-vertical" d="M10 4v12"/></svg></span></summary><div>'+explanation+quote(value)+'<div class="sf-story-source"><a class="sf-source" href="'+escape(item.source_url)+'" target="_blank" rel="noopener noreferrer">会社の発表を読む ↗</a><time class="sf-story-date" datetime="'+escape(item.published_date)+'">'+dateLabel(item.published_date)+' 発表</time></div></div></details></article>';
    }).join('');
    return '<div class="sf-content"><section class="sf-stories" aria-label="注目企業">'+(stories.length?'<div class="sf-companies">'+cards+'</div>':'<p class="sf-state">'+(status==='loading'?'企業の話題を確認しています…':'現在、確認済みの企業の話題を準備しています。')+'</p>')+'</section></div>';
  }
  function selectRanking(container,direction){
    if(!['up','down'].includes(direction))return;
    container.querySelectorAll('[data-sf-rank]').forEach(button=>{const active=button.dataset.sfRank===direction;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});
    container.querySelectorAll('.sf-ranking').forEach(panel=>{panel.hidden=panel.id!=='sf-rank-panel-'+direction;});
  }
  function start(w){
    const doc=w.document;let data=null,editorial=null,status='loading',storyStatus='loading',active='up',busy=false,poll=0,timer=null,generation=0;
    const scope=()=>{try{return w.localStorage.getItem('ui_style')==='pro'?'pro':'jp';}catch(_){return 'jp';}};
    let currentScope=scope();const cacheKey=()=> 'kn_stock_focus_v1_'+currentScope;
    function paint(id,html){
      const el=doc.getElementById(id);if(!el||el.__stockHTML===html)return;
      const open=new Set(Array.from(el.querySelectorAll('details[open][data-stock-detail]')).map(x=>x.dataset.stockDetail));
      const focused=doc.activeElement,focusKey=focused&&el.contains(focused)&&focused.getAttribute('data-sf-rank');
      el.innerHTML=html;el.__stockHTML=html;
      el.querySelectorAll('details[data-stock-detail]').forEach(x=>{x.open=open.has(x.dataset.stockDetail);});
      if(focusKey){const button=el.querySelector('[data-sf-rank="'+focusKey+'"]');if(button)button.focus({preventScroll:true});}
    }
    function render(){paint('homeMoversList',rankingMarkup(data,active,status));paint('knCompanyFocus',companyMarkup(editorial,data,storyStatus));}
    function restore(){try{data=normalizePayload(JSON.parse(w.localStorage.getItem(cacheKey())));if(data)data.stale=true;}catch(_){data=null;}}
    async function getJSON(url){const controller=new w.AbortController(),timeout=w.setTimeout(()=>controller.abort(),12000);try{const response=await w.fetch(url,{signal:controller.signal,cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);return await response.json();}finally{w.clearTimeout(timeout);}}
    async function refresh(){
      if(busy)return;busy=true;const token=generation;
      try{const result=await getJSON('/api/scanner?limit=20'+(currentScope==='pro'?'&pro=1':''));if(token!==generation)return;
        const next=normalizePayload(result);
        if(next){data=next;status='ready';try{w.localStorage.setItem(cacheKey(),JSON.stringify(next));}catch(_){}}
        else status=result.refreshing?'loading':'error';
        if(result.refreshing&&poll++<10){w.clearTimeout(timer);timer=w.setTimeout(refresh,3000);}else{poll=0;if(!data)status='error';}
      }catch(_){if(token===generation)status='error';}
      finally{busy=false;if(token===generation)render();else refresh();}
    }
    async function loadStories(){try{editorial=await getJSON('/static/company-focus.json?v=20260924-layoutd1');storyStatus='ready';}catch(_){storyStatus='error';}render();}
    function init(){
      restore();render();refresh();loadStories();
      w.closeStockWatchManager=function(){const manager=doc.getElementById('alert-section');if(manager)manager.style.display='none';const home=doc.getElementById('morning-section'),news=doc.getElementById('morning-news-section');if(home)home.style.display='block';if(news)news.style.display='';if(w.__knRefreshWatch)w.__knRefreshWatch();if(w.__knSetSub)w.__knSetSub('watch');};
      doc.addEventListener('click',e=>{const button=e.target.closest&&e.target.closest('[data-sf-rank]');if(button){active=button.dataset.sfRank;selectRanking(doc.getElementById('homeMoversList'),active);}if(e.target.closest&&e.target.closest('[data-stock-retry]')){poll=0;status='loading';render();refresh();}});
      doc.addEventListener('keydown',e=>{const button=e.target.closest&&e.target.closest('[data-sf-rank]');if(!button||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();active=e.key==='Home'?'up':e.key==='End'?'down':button.dataset.sfRank==='up'?'down':'up';selectRanking(doc.getElementById('homeMoversList'),active);doc.getElementById('sf-rank-tab-'+active).focus();});
      doc.addEventListener('styleChanged',()=>{const next=scope();if(next===currentScope)return;currentScope=next;generation++;poll=0;w.clearTimeout(timer);data=null;status='loading';restore();render();refresh();});
      doc.addEventListener('knStockViewChanged',()=>{render();if(status==='error')refresh();});
      doc.addEventListener('visibilitychange',()=>{if(!doc.hidden){if(data&&Date.now()-data.updated_at*1000>CACHE_AGE){data=null;status='loading';render();}refresh();}});
    }
    if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',init,{once:true});else init();
  }
  return {normalizeItem,normalizePayload,quote,tradeDates,watchRow,ranked,rankingMarkup,companyMarkup,validStories,movement,selectRanking,start};
});

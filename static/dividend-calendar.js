/* Dates come from verified schedules; month-only plans never acquire an invented day. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root&&root.document)api.start(root);})(typeof window==='undefined'?null:window,function(){
  'use strict';
  const FAVORITES='alert_watchlist_v1',LEGACY='myDividendStocks',MIGRATED='dividend_calendar_migrated_v1',NAMES='stock_watch_names_v1',CACHE='kn_dividend_calendar_v6:',KINDS={holding_deadline:'配当のために持っておく日',payment:'配当の支払い',ex_dividend:'権利落ち日'};
  const finite=v=>typeof v==='number'&&Number.isFinite(v),clean=(v,max=160)=>typeof v==='string'?v.trim().slice(0,max):'';
  function parse(value,fallback){try{return JSON.parse(value)||fallback;}catch(e){return fallback;}}
  function symbol(value){const key=clean(value,30).normalize('NFKC').toUpperCase();return /^[0-9][A-Z0-9]{3}(?:\.T)?$/.test(key)?key.replace(/\.T$/,'')+'.T':'';}
  function month(value){return typeof value==='string'&&/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)?value:null;}
  function day(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?value:null;}
  function today(now=Date.now()){return new Date(now+9*3600000).toISOString().slice(0,10);}
  function shift(value,delta){if(!month(value))return null;const parts=value.split('-').map(Number),date=new Date(Date.UTC(parts[0],parts[1]-1+delta,1));return date.toISOString().slice(0,7);}
  function bounds(now=Date.now()){const start=today(now).slice(0,7),last=shift(start,12),end=new Date(Date.parse(shift(last,1)+'-01T00:00:00Z')-86400000).toISOString().slice(0,10);return {start:start+'-01',end,months:Array.from({length:13},(_,i)=>shift(start,i))};}
  function safeUrl(value){if(typeof value!=='string'||/[\u0000-\u0020\u007f\\]/.test(value))return null;try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch(e){return null;}}
  function at(value,now=Date.now()){const n=finite(value)?value>=1e12?value:value*1000:null;return n>0&&n<=now+60000?n:null;}
  function uniq(values){return Array.from(new Set(values));}
  function readList(store,key){const list=parse(store&&store.getItem(key),[]);return Array.isArray(list)?list:[];}
  function selection(store){
    try{const watched=uniq(readList(store,FAVORITES).map(symbol).filter(Boolean)),done=new Set(readList(store,MIGRATED).map(symbol).filter(Boolean));const legacy=uniq(readList(store,LEGACY).map(row=>symbol(typeof row==='string'?row:row&&row.code)).filter(Boolean)).filter(key=>!done.has(key)&&!watched.includes(key)),all=watched.concat(legacy);return {symbols:all.slice(0,100),legacyCount:legacy.length,overflow:Math.max(0,all.length-100)};}catch(e){return {symbols:[],legacyCount:0,overflow:0,error:true};}
  }
  async function migrate(store,persist,ready){
    await Promise.resolve(ready);if(!store)return {error:true};
    const write=persist||((key,value)=>store.setItem(key,value));
    try{
      const original=readList(store,FAVORITES).filter(value=>typeof value==='string'),seen=new Set(original.map(value=>symbol(value)||value)),done=new Set(readList(store,MIGRATED).map(symbol).filter(Boolean));
      const legacy=readList(store,LEGACY),names=parse(store.getItem(NAMES),{}),metadata=names&&typeof names==='object'&&!Array.isArray(names)?names:{};const next=original.slice();let changed=false;
      for(const row of legacy){const key=symbol(typeof row==='string'?row:row&&row.code);if(!key||done.has(key))continue;if(seen.has(key)){done.add(key);continue;}if(next.length>=20)continue;next.push(key);seen.add(key);done.add(key);changed=true;if(row&&typeof row.name==='string'&&!metadata[key])metadata[key]=clean(row.name);}
      if(changed){await write(FAVORITES,JSON.stringify(next));try{await write(NAMES,JSON.stringify(metadata));}catch(e){}}
      await write(MIGRATED,JSON.stringify([...done]));return selection(store);
    }catch(e){return {...selection(store),migrationError:true};}
  }
  function dividendAmount(raw,record,now=Date.now()){
    if(!raw||typeof raw!=='object'||!record||raw.record_date!==record||raw.currency!=='JPY'||raw.status!=='forecast'||!finite(raw.per_share)||raw.per_share<0||raw.per_share>1000000)return null;
    const announced=day(raw.announced_on),verified=day(raw.verified_on),source=raw.source||{},url=safeUrl(source.url),title=clean(source.title,120);
    if(!announced||!verified||announced>verified||verified>today(now)||announced>record||!url||!title)return null;
    return {record_date:record,per_share:raw.per_share,currency:'JPY',status:'forecast',announced_on:announced,verified_on:verified,source:{title,url}};
  }
  function holdingWindow(raw,date,record){
    const deadline=day(raw.holding_deadline),ex=day(raw.ex_dividend_date);
    if(raw.precision!=='day'||raw.status!=='confirmed'||!deadline||!ex||deadline>=ex||Date.parse(ex)-Date.parse(deadline)>15*86400000||record&&ex>=record)return null;
    if(raw.kind==='holding_deadline'?date!==deadline:raw.kind!=='ex_dividend'||date!==ex)return null;
    return {deadline,ex_dividend:ex};
  }
  function normalize(raw,selected,scope,symbols,now=Date.now()){
    if(!raw||typeof raw!=='object'||raw.error||!Array.isArray(raw.events)||!raw.coverage||!raw.range)return null;
    const start=day(raw.range.start),end=day(raw.range.end),stamp=at(raw.updated_at,now);if(!start||!end||start>end||selected<start.slice(0,7)||selected>end.slice(0,7))return null;
    const count=value=>Number.isInteger(value)&&value>=0?value:null,coverage={universe:count(raw.coverage.universe),known:count(raw.coverage.known),unknown:count(raw.coverage.unknown)};
    if(Object.values(coverage).includes(null)||coverage.known>coverage.universe||coverage.unknown>coverage.universe)return null;
    const seen=new Set(),allowed=new Set(symbols),events=[];
    for(const row of raw.events.slice(0,20000)){
      if(!row||typeof row!=='object')continue;const key=symbol(row.symbol||row.code),date=day(row.date),period=month(row.period),source=row.source&&typeof row.source==='object'?row.source:{},url=safeUrl(source.url),title=clean(source.title,120),verified=day(row.verified_on);
      if(!key||scope==='favorites'&&!allowed.has(key)||!KINDS[row.kind]||!['confirmed','planned'].includes(row.status)||!url||!title||!verified||verified>today(now))continue;
      if(row.precision==='day'?(!date||date.slice(0,7)!==selected):(row.precision!=='month'||row.kind!=='payment'||!period||period!==selected))continue;
      const id=[key,row.kind,row.precision,row.precision==='day'?date:period].join(':');if(seen.has(id))continue;seen.add(id);
      const record=day(row.record_date),recordDate=row.precision==='day'&&row.kind!=='payment'&&record&&record>date?record:null;
      events.push({id,yield_pct:finite(row.yield_pct)&&row.yield_pct>=0?row.yield_pct:null,symbol:key,code:key.slice(0,-2),name:clean(row.name)||key,kind:row.kind,precision:row.precision,date:row.precision==='day'?date:null,period:row.precision==='month'?period:null,status:row.status,source:{title,url},verified_on:verified,record_date:recordDate,holding_deadline:day(row.holding_deadline),ex_dividend_date:day(row.ex_dividend_date),holding_window:holdingWindow(row,date,recordDate),dividend:row.kind!=='payment'?dividendAmount(row.dividend,recordDate,now):null});
    }
    events.sort((a,b)=>(a.date||a.period).localeCompare(b.date||b.period)||a.symbol.localeCompare(b.symbol)||a.kind.localeCompare(b.kind));
    return {events,coverage,range:{start,end},updated_at:stamp,universe_as_of:day(raw.universe_as_of),status:raw.status==='loading'?'pending':['ready','stale','pending','unavailable'].includes(raw.status)?raw.status:'ready',refreshing:raw.refreshing===true,month:selected,scope};
  }
  function calendarDays(selected,events,current=today()){
    const first=new Date(selected+'-01T00:00:00Z'),offset=first.getUTCDay(),length=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate(),counts=new Map();events.forEach(event=>{if(event.precision==='day'&&event.kind!=='ex_dividend')counts.set(event.date,(counts.get(event.date)||0)+1);});
    return Array.from({length:42},(_,index)=>{const n=index-offset+1;if(n<1||n>length)return null;const date=selected+'-'+String(n).padStart(2,'0');return {date,day:n,count:counts.get(date)||0,today:date===current};});
  }
  function visibleEvents(data,selectedDate,current=today()){return data?data.events.filter(event=>event.precision==='day'&&event.kind!=='ex_dividend'&&(selectedDate?event.date===selectedDate:event.date>=current)):[];}
  function createLoader(env,onState){
    const now=env.now||Date.now,set=env.setTimeout||setTimeout,clear=env.clearTimeout||clearTimeout;let serial=0,active=null,last=null;const memory=new Map();
    function keyOf(query){return query.month+'|'+query.scope+'|'+query.symbols.slice().sort().join(',');}
    function stored(query){const key=keyOf(query);let data=memory.get(key);if(!data){try{data=normalize(parse(env.storage&&env.storage.getItem(CACHE+key),null),query.month,query.scope,query.symbols,now());}catch(e){}}if(!data||!data.updated_at||now()-data.updated_at>14*86400000)return null;memory.set(key,data);return data;}
    function emit(query,status,data,reason=null,excluded=[]){last={query,status,data,reason,excluded};onState(last);}
    function save(query,data){if(!data.updated_at)return;const key=keyOf(query);memory.set(key,data);while(memory.size>12)memory.delete(memory.keys().next().value);try{if(env.storage)env.storage.setItem(CACHE+key,JSON.stringify(data));}catch(e){}}
    function cancel(){serial++;if(active){active.controller.abort();clear(active.timer);if(active.reject)active.reject(new Error('cancelled'));}active=null;}
    function load(query){
      query={month:month(query.month),scope:query.scope==='favorites'?'favorites':'all',symbols:uniq((query.symbols||[]).map(symbol).filter(Boolean)).slice(0,100)};if(!query.month)return Promise.resolve();const key=keyOf(query);if(active&&active.key===key)return active.promise;
      cancel();const token=serial,before=stored(query);emit(query,before?'refreshing':'loading',before);
      if(query.scope==='favorites'&&!query.symbols.length){emit(query,'ready',{events:[],coverage:{universe:0,known:0,unknown:0},range:bounds(now()),updated_at:null,universe_as_of:null,status:'ready',refreshing:false,month:query.month,scope:query.scope});return Promise.resolve();}
      const current={key,controller:new env.AbortController(),timer:null,reject:null,promise:null};active=current;
      current.promise=(async()=>{
        try{
          const timeout=new Promise((resolve,reject)=>{current.reject=reject;current.timer=set(()=>{current.controller.abort();reject(new Error('timeout'));},12000);});
          async function fetchPayload(symbols){const response=await env.fetch('/api/dividend/calendar-v2?month='+encodeURIComponent(query.month)+'&scope='+query.scope+'&symbols='+encodeURIComponent(symbols.join(',')),{signal:current.controller.signal,cache:'no-store'});const payload=await response.json();return {response,payload};}
          const operation=(async()=>{let result=await fetchPayload(query.symbols),excluded=[];if(result.response.status===400&&Array.isArray(result.payload.invalid_symbols)){excluded=result.payload.invalid_symbols.map(symbol).filter(key=>query.symbols.includes(key));if(excluded.length)result=await fetchPayload(query.symbols.filter(key=>!excluded.includes(key)));}return {...result,excluded};})();
          const {response,payload,excluded}=await Promise.race([operation,timeout]);if(token!==serial)return;if(!response.ok)throw new Error('unavailable');
          const unavailableSymbols=uniq(excluded.concat(Array.isArray(payload.invalid_symbols)?payload.invalid_symbols.map(symbol).filter(key=>query.symbols.includes(key)):[]));
          const data=normalize(payload,query.month,query.scope,query.symbols,now());if(!data)throw new Error('invalid');
          if(data.status==='unavailable'){emit(query,'error',before,'unavailable',unavailableSymbols);return;}
          const chosen=before&&(!data.updated_at||before.updated_at>data.updated_at)?before:data;save(query,chosen);emit(query,chosen===before||data.status==='stale'?'stale':data.status==='pending'&&!data.events.length?'pending':'ready',chosen,null,unavailableSymbols);
        }catch(error){if(token===serial)emit(query,'error',before,error.message==='timeout'?'timeout':'unavailable');}
        finally{clear(current.timer);if(active===current)active=null;}
      })();return current.promise;
    }
    return {load,cancel,getState:()=>last,peek:stored};
  }
  function start(w){
    function init(){
      const doc=w.document,mount=doc.getElementById('knDividendCalendar');if(!mount||mount.dataset.ready)return;
      mount.dataset.ready='true';let storage=null;try{storage=w.localStorage;}catch(e){}
      let monthValue=today().slice(0,7),scope=selection(storage).symbols.length?'favorites':'all',scopeChosen=false,searchText='',selectedDate=null,autoDate=true,limit=5,monthLimit=5,current=null,favorites=selection(storage),lastQuery='',lastRefresh=0,retryTimer=null,refreshTimer=null,polls=0;const refs={},dateButtons=new Map(),priceNodes=new Map();let priceController=null,priceInView=typeof w.IntersectionObserver!=='function';
      function el(tag,cls,text){const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;}
      function append(parent,...nodes){nodes.forEach(node=>parent.appendChild(node));return parent;}
      function button(label,cls,fn){const node=el('button',cls,label);node.type='button';node.addEventListener('click',fn);return node;}
      const filters=el('div','dc-filters');filters.setAttribute('aria-label','表示する銘柄');refs.all=button('掲載銘柄','dc-filter',()=>setScope('all'));refs.favorites=button('お気に入り','dc-filter',()=>setScope('favorites'));refs.manage=button('銘柄を追加','dc-manage',()=>{if(w.openStockWatchManager)w.openStockWatchManager();});append(filters,refs.all,refs.favorites,refs.manage);
      refs.search=el('input','dc-search');refs.search.type='search';refs.search.placeholder='会社名・銘柄コードで探す';refs.search.setAttribute('aria-label','表示中の月の会社名・銘柄コードを検索');
      const searchKey=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[\s・]/g,'').replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
      const matches=event=>!searchText||searchKey(event.name+' '+event.code).includes(searchText);
      const companyResults=el('div','dc-company-results');companyResults.hidden=true;companyResults.setAttribute('aria-live','polite');
      let companyLimit=5,catalogue=null,cataloguePending=false,catalogueFailed=false;
      function renderCompanyResults(){
        companyResults.hidden=!searchText;companyResults.replaceChildren();if(!searchText)return;
        if(!catalogue){companyResults.appendChild(el('p','dc-status',catalogueFailed?'会社一覧を確認できませんでした。検索し直してください。':'会社を探しています…'));return;}
        const found=catalogue.filter(matches),shown=found.slice(0,companyLimit);
        companyResults.appendChild(el('p','dc-status',found.length?'該当 '+found.length+'社（会社名から詳細を確認）':'会社一覧に一致する銘柄がありません。'));
        shown.forEach(company=>{const link=button(company.name+'　'+company.code,'dc-search-company',()=>{});link.dataset.companyProfile=company.symbol;link.dataset.companyName=company.name;companyResults.appendChild(link);});
        if(found.length>companyLimit)companyResults.appendChild(button('\u3082\u3063\u3068\u898b\u308b','dc-more',()=>{companyLimit+=5;renderCompanyResults();}));
      }
      async function loadCatalogue(){
        if(catalogue||cataloguePending)return;cataloguePending=true;catalogueFailed=false;renderCompanyResults();
        const controller=new w.AbortController(),timer=w.setTimeout(()=>controller.abort(),12000);
        try{const response=await w.fetch('/api/lookup_all',{signal:controller.signal});if(!response.ok)throw new Error('catalogue');const raw=await response.json();if(!Array.isArray(raw.items))throw new Error('catalogue');catalogue=raw.items.slice(0,10000).filter(row=>row&&symbol(row.code)&&clean(row.name)).map(row=>({symbol:symbol(row.code),code:symbol(row.code).slice(0,-2),name:clean(row.name)}));}
        catch(error){catalogueFailed=true;}finally{w.clearTimeout(timer);cataloguePending=false;renderCompanyResults();}
      }
      refs.search.addEventListener('input',()=>{searchText=searchKey(refs.search.value);companyLimit=5;selectedDate=null;autoDate=false;limit=monthLimit=5;renderLists();updateDays();renderCompanyResults();if(searchText)loadCatalogue();});
      const navigation=el('div','dc-month-navigation');refs.previous=button('‹','dc-month-arrow',()=>changeMonth(-1));refs.previous.setAttribute('aria-label','前の月');refs.next=button('›','dc-month-arrow',()=>changeMonth(1));refs.next.setAttribute('aria-label','次の月');refs.month=el('h3','dc-month');refs.month.id='dc-month-title';append(navigation,refs.previous,refs.month,refs.next);
      const weekdays=el('div','dc-weekdays');weekdays.setAttribute('aria-hidden','true');['日','月','火','水','木','金','土'].forEach(name=>weekdays.appendChild(el('span','',name)));
      refs.grid=el('div','dc-grid');refs.grid.setAttribute('role','group');refs.grid.setAttribute('aria-labelledby','dc-month-title');
      const statusRow=el('div','dc-status-row');refs.status=el('p','dc-status');refs.status.setAttribute('role','status');refs.retry=button('再確認','dc-retry',()=>refresh(true));refs.retry.hidden=true;append(statusRow,refs.status,refs.retry);
      const listHead=el('div','dc-list-heading');refs.heading=el('h4');refs.heading.id='dc-agenda-title';refs.clear=button('これからの予定へ','dc-reset',()=>{selectedDate=null;autoDate=false;limit=5;renderLists();updateDays();});refs.clear.hidden=true;append(listHead,refs.heading,refs.clear);
      refs.list=el('ul','dc-events');refs.empty=el('p','dc-empty');refs.more=button('もっと見る','dc-more',()=>{limit+=5;renderLists();});refs.more.hidden=true;
      refs.plans=el('div','dc-month-plans');refs.planHeading=el('h4','dc-plan-heading');refs.planList=el('ul','dc-events');refs.planMore=button('もっと見る','dc-more',()=>{monthLimit+=5;renderLists();});append(refs.plans,refs.planHeading,el('p','dc-plan-note','配当金が支払われる時期です。詳しい日付はまだ確認できていません。'),refs.planList,refs.planMore);
      refs.coverage=el('p','dc-coverage');refs.migration=el('p','dc-coverage');refs.universe=el('p','dc-universe');
      const legend=el('details','dc-help'),terms=el('dl','dc-help-terms');
      [
        ['いつ買って、いつまで持つ？','「配当のために持っておく日」（権利付最終日）までに買い、その日の取引終了時点まで持ちます。買った日からそこまで持てばよく、当日に買っても対象です。何か月も前から持つ必要はありません。注文しただけではなく、実際に買えていることが必要です。'],
        ['いつから売ってもよい？','次に株の売買が行われる日が「権利落ち日」です。この日以降に売っても、今回の配当の権利は残ります。この日から新しく買った株は、今回の配当の対象にはなりません。'],
        ['権利確定日って何？','配当の対象になる人が、会社の株主の一覧表をもとに決まる日です。株の受け渡しには日数がかかるため、この日に買っても間に合いません。株を持つ締切や、配当金を受け取る日とは別です。'],
        ['配当金が支払われるのは？','会社が別に決める支払日です。権利確定日にすぐ振り込まれるわけではありません。確認できた支払日や支払い予定月を、このカレンダーに表示します。']
      ].forEach(([title,text])=>append(terms,el('dt','',title),el('dd','',text)));
      const helpSource=el('a','dc-help-source','日付のしくみを確認する ↗');helpSource.href='https://faq.sbisec.co.jp/answer/5ef300184a6766001122cc38/';helpSource.target='_blank';helpSource.rel='noopener noreferrer';
      append(legend,el('summary','','いつ買って、いつまで持つ？'),terms,el('p','dc-help-note','一般的な日本株の現物取引（お金を払って株を買う方法）の説明です。配当の有無・金額は会社の発表によります。株主優待の保有期間の条件とは異なります。'),helpSource,refs.universe);
      const layout=el('div','dc-layout'),calendarPanel=el('section','dc-calendar-panel'),agendaPanel=el('section','dc-agenda-panel');calendarPanel.setAttribute('aria-labelledby','dc-month-title');agendaPanel.setAttribute('aria-labelledby','dc-agenda-title');append(calendarPanel,weekdays,refs.grid,statusRow);append(agendaPanel,listHead,refs.list,refs.empty,refs.more,refs.plans);append(layout,calendarPanel,agendaPanel);append(mount,filters,refs.search,companyResults,navigation,layout,refs.coverage,refs.migration,legend);
      function query(){return {month:monthValue,scope,symbols:favorites.symbols};}
      const loader=createLoader({fetch:w.fetch.bind(w),AbortController:w.AbortController,setTimeout:w.setTimeout.bind(w),clearTimeout:w.clearTimeout.bind(w),storage},state=>{if(!state.data&&current&&current.data&&state.query.scope==='all'&&current.query.scope==='all'&&state.query.month===current.query.month)state={...state,data:current.data,status:state.status==='loading'?'refreshing':state.status};current=state;render();w.clearTimeout(retryTimer);if(state.data&&state.data.refreshing&&state.status!=='error'&&polls<4&&!doc.hidden&&mount.getClientRects().length){retryTimer=w.setTimeout(()=>{polls++;refresh(true,false);},15000);}});
      function prettyMonth(value){return value.slice(0,4)+'年'+Number(value.slice(5))+'月';}
      function dateLabel(value){return Number(value.slice(5,7))+'月'+Number(value.slice(8))+'日';}
      function buildDays(){refs.grid.replaceChildren();dateButtons.clear();calendarDays(monthValue,[],today()).forEach(item=>{if(!item){const blank=el('span','dc-blank');blank.setAttribute('aria-hidden','true');refs.grid.appendChild(blank);return;}const cell=button(String(item.day),'dc-day',()=>selectDay(item.date));cell.dataset.date=item.date;const count=el('small','dc-day-count');count.setAttribute('aria-hidden','true');cell.appendChild(count);cell.addEventListener('keydown',event=>{const jump={ArrowRight:1,ArrowLeft:-1,ArrowDown:7,ArrowUp:-7}[event.key];if(!jump)return;const destination=new Date(Date.parse(item.date+'T00:00:00Z')+jump*86400000).toISOString().slice(0,10),target=dateButtons.get(destination);if(target){event.preventDefault();target.button.focus();}});dateButtons.set(item.date,{button:cell,count});refs.grid.appendChild(cell);});}
      function updateDays(){const events=current&&current.data&&current.data.events||[];calendarDays(monthValue,events,today()).forEach(item=>{if(!item)return;const row=dateButtons.get(item.date);row.button.setAttribute('aria-pressed',String(selectedDate===item.date));row.button.setAttribute('aria-label',dateLabel(item.date)+'、'+(item.count?item.count+'件の予定':'確認済みの予定なし'));if(item.today)row.button.setAttribute('aria-current','date');else row.button.removeAttribute('aria-current');row.count.textContent=item.count?String(item.count):'';row.count.hidden=!item.count;});}
      function sourceLink(title,url,cls=''){const link=el('a',cls,title);link.href=url;link.target='_blank';link.rel='noopener noreferrer';return link;}
      function shortDate(value){return Number(value.slice(5,7))+'/'+Number(value.slice(8));}
      function weekday(value){return ['日','月','火','水','木','金','土'][new Date(value+'T00:00:00Z').getUTCDay()];}
      function brokerOptions(event){
        const details=el('details','dc-brokers'),body=el('div','dc-brokers-body'),list=el('ul','dc-broker-links'),verified=event.symbol==='5803.T';
        append(details,el('summary','',verified?'1株から買える証券会社':'1株で買えるか確認する'));
        append(body,el('p','dc-broker-stock',verified?event.name+'（'+event.code+'）の取扱例':'各社の対象銘柄で「'+event.code+'」を確認できます。'));
        [
          ['SBI証券','S株','https://faq.sbisec.co.jp/answer/5f17d6e68c7981001102a0c0/'],
          ['楽天証券','かぶミニ®','https://www.rakuten-sec.co.jp/web/domestic/ols/lineup/'],
          ['マネックス証券','ワン株','https://info.monex.co.jp/wankabu/meigara.html']
        ].forEach(([name,service,url])=>{const li=el('li'),link=sourceLink('',url);link.setAttribute('aria-label',name+' '+service+'の公式案内（別タブ）');const icon=el('span','dc-broker-external','↗');icon.setAttribute('aria-hidden','true');append(link,el('span','dc-broker-name',name),el('span','dc-broker-service',service),icon);append(li,link);list.appendChild(li);});
        append(body,list,el('p','dc-broker-note','1株単位の注文締切は、通常の100株取引と異なる場合があります。最新の取扱状況・締切は各社の公式サイトで確認できます。'));
        if(verified)body.appendChild(el('p','dc-broker-note','2026/9/24 確認'));
        details.appendChild(body);return details;
      }
      function updatePrice(symbol,state){
        for(const refs of priceNodes.get(symbol)||[]){
          const quote=state&&state.quote;
          refs.single.textContent=quote?new Intl.NumberFormat('ja-JP',{maximumFractionDigits:4}).format(quote.price):'—';
          refs.hundred.textContent=quote?new Intl.NumberFormat('ja-JP',{maximumFractionDigits:2}).format(Math.round(quote.price*10000)/100):'—';
          refs.time.textContent=quote?'株価 '+new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(quote.price_updated_at*1000)+' JST 時点':'株価の時刻を確認しています';
          refs.status.textContent=state&&state.error?(quote?'更新できませんでした。前回の価格を表示しています。':'株価を取得できませんでした。自動で再確認します。'):quote?'':'株価を確認しています…';
        }
      }
      function pricePanel(event){
        const panel=el('section','dc-price-panel'),heading=el('div','dc-price-heading'),values=el('div','dc-price-values'),refs={};
        append(heading,el('h5','','現在の購入金額の目安'),el('span','dc-price-mode','自動更新'));
        [['single','1株の株価'],['hundred','100株の購入目安']].forEach(([key,label])=>{const cell=el('div','dc-price-cell');refs[key]=el('strong','dc-price-value','—');append(cell,el('span','dc-price-label',label),refs[key],el('span','dc-price-unit','円'));values.appendChild(cell);});
        refs.time=el('p','dc-price-time','株価の時刻を確認しています');refs.status=el('p','dc-price-status','株価を確認しています…');
        append(panel,heading,values,refs.time,refs.status);panel.__priceRefs=refs;return panel;
      }
      function syncPrices(){
        if(!priceController)return;
        const active=!doc.hidden&&priceInView&&mount.getClientRects().length>0;
        if(!active)priceController.pause();
        priceNodes.clear();
        for(const row of [...refs.list.children,...refs.planList.children]){if(!row.__priceRefs||!row.__disclosure.open)continue;const key=row.__priceSymbol;if(!priceNodes.has(key))priceNodes.set(key,[]);priceNodes.get(key).push(row.__priceRefs);}
        priceController.setSymbols([...priceNodes.keys()]);
        priceNodes.forEach((_,key)=>updatePrice(key,priceController.peek(key)));
        if(active)priceController.resume();
      }
      function holdingStory(event){
        const story=el('div','dc-holding-story'),amount=event.dividend,window=event.holding_window;
        const confirmedDay=event.precision==='day'&&event.status==='confirmed',deadline=window?window.deadline:confirmedDay&&event.kind==='holding_deadline'?event.date:null,ex=window?window.ex_dividend:confirmedDay&&event.kind==='ex_dividend'?event.date:null,currentDay=today(),past=event.precision==='day'&&event.date<currentDay,deadlinePast=deadline&&deadline<currentDay;
        if(past)story.appendChild(el('p','dc-past-event',event.status==='planned'?'過去の予定日です。実際の日程は、まだ確認できていません。':event.kind==='payment'?'過去の支払い日程です。':'過去の配当日程です。今から買っても、この配当の対象にはなりません。'));
        const estimate=el('section','dc-dividend-estimate'),heading=el('div','dc-dividend-heading');
        append(heading,el('h5','',event.kind==='payment'?'この支払いの配当額':past?'当時の配当予想':'今回の配当予想'));if(event.record_date)heading.appendChild(el('span','',prettyMonth(event.record_date.slice(0,7))+'分'));estimate.appendChild(heading);
        const values=el('div','dc-dividend-values');
        [[1,'1株保有した場合'],[100,'100株保有した場合']].forEach(([shares,label])=>{
          const value=el('div','dc-dividend-value');value.appendChild(el('span','',label));
          if(amount)append(value,el('strong','',new Intl.NumberFormat('ja-JP',{maximumFractionDigits:2}).format(Math.round(amount.per_share*shares*100)/100)),el('span','dc-dividend-unit','円'));
          else value.appendChild(el('strong','dc-dividend-unknown','金額未確認'));
          values.appendChild(value);
        });
        append(estimate,values,el('p','dc-dividend-note',amount?(past?'税引前・当時の会社予想。確定した支払額とは異なる場合があります。':'税引前・会社予想'):'この配当1回分の金額は、まだ確認できていません。'));
        const unit=el('p','dc-unit-note');append(unit,el('strong','','通常の購入は100株単位です。'),el('span','','証券会社や銘柄によっては、1株から買えるサービスもあります。'));
        const prices=pricePanel(event);story.__priceRefs=prices.__priceRefs;append(estimate,prices,unit,brokerOptions(event));story.appendChild(estimate);
        append(story,el('p','dc-range-title',past?'この配当の購入・保有期限':'今回の配当を受け取るには'));
        const range=el('div','dc-holding-range');
        [['start','購入はいつまで？',deadlinePast?'取引終了までに購入':'取引終了までに買う'],['end','保有はいつまで？',deadlinePast?'取引終了時点まで保有':'取引終了時点まで持つ']].forEach(([position,label,description],index)=>{
          if(index){const arrow=el('span','dc-range-arrow','→');arrow.setAttribute('aria-hidden','true');range.appendChild(arrow);}
          const part=el('div','dc-range-'+position),date=el('strong','dc-range-value'+(deadline?'':' dc-range-unknown'),deadline?shortDate(deadline)+' ':'日程未確認');if(deadline)date.appendChild(el('small','',weekday(deadline)));
          append(part,el('span','dc-range-label',label),date);if(deadline)part.appendChild(el('span','dc-range-deadline',description));range.appendChild(part);
        });
        let note=deadline?(deadlinePast?shortDate(deadline)+'までに買い、その日の取引終了時点まで持っていた株が対象です。':shortDate(deadline)+'当日に買っても対象です。その日の途中で売らず、取引終了まで持ちます。注文しただけでなく、実際に買えている必要があります。'):'購入・保有の締切日は、まだ確認できていません。';
        if(event.kind==='payment')note+='支払日や支払予定月は、購入・保有の締切とは別です。';
        const after=el('section','dc-after-deadline');
        if(ex)append(after,el('h5','',past?shortDate(ex)+'（'+weekday(ex)+'） 権利落ち日':shortDate(ex)+'（'+weekday(ex)+'）以降に売っても'),el('p','',deadline?'締切まで持っていれば、今回の配当の権利は残ります。'+(event.record_date?shortDate(event.record_date)+'や':'')+'支払日まで持ち続ける必要はありません。':'前の取引日の終了時点まで持っていた株は、この日以降に売っても配当の権利が残ります。支払日まで持ち続ける必要はありません。'));
        else append(after,el('h5','','売却できる日は？'),el('p','','日程未確認。配当の権利を残して売却できる「権利落ち日」は、まだ確認できていません。'));
        append(story,range,el('p','dc-holding-note',note),after);
        const record=el('p','dc-record-note');append(record,el('strong','',event.record_date?shortDate(event.record_date)+'（'+weekday(event.record_date)+'） 権利確定日':'権利確定日：日程未確認'),el('span','','配当の対象になる株主が決まる日です。買う締切・配当金の支払日とは別です。'));story.appendChild(record);
        if(ex)story.appendChild(el('p','dc-holding-note',shortDate(ex)+'以降に新しく買った株は、この配当の対象にはなりません。'));
        return story;
      }
      function eventRow(event){
        const row=el('li','dc-event');row.dataset.event=event.id;
        const disclosure=el('details','dc-disclosure'),summary=el('summary','dc-event-summary');row.__disclosure=disclosure;
        const date=el('span','dc-event-date',event.precision==='day'?shortDate(event.date):Number(event.period.slice(5))+'月');
        const body=el('span','dc-event-body'),name=el('span','dc-company',event.name),badge=el('span','dc-favorite','★');badge.setAttribute('aria-label','お気に入り');row.__favorite=badge;
        append(body,name,el('span','dc-company-code',event.code));
        const tag=el('span','dc-event-kind',KINDS[event.kind]+(event.status==='planned'?'（予定）':''));tag.dataset.kind=event.kind;body.appendChild(tag);
        append(summary,date,body,badge);
        const story=holdingStory(event),profile=button('会社情報を見る','cp-company-link dc-profile',()=>{});profile.dataset.companyProfile=event.symbol;profile.dataset.companyName=event.name;profile.setAttribute('aria-label',event.name+'の会社情報を開く');
        const evidence=el('details','dc-evidence');append(evidence,el('summary','','出典・確認日'),sourceLink(event.source.title,event.source.url),el('span','','日程の確認 '+event.verified_on.replace(/-/g,'/')));
        if(event.dividend)append(evidence,sourceLink(event.dividend.source.title,event.dividend.source.url),el('span','','配当予想の発表 '+event.dividend.announced_on.replace(/-/g,'/')+' ／ 確認 '+event.dividend.verified_on.replace(/-/g,'/')));
        append(story,profile,evidence);row.__priceRefs=story.__priceRefs;row.__priceSymbol=event.symbol;
        append(disclosure,summary,story);row.appendChild(disclosure);disclosure.addEventListener('toggle',syncPrices);
        return row;
      }
      function prioritize(events){
        const saved=new Set(favorites.symbols);
        return events.slice().sort((a,b)=>(a.date||a.period).localeCompare(b.date||b.period)||Number(saved.has(b.symbol))-Number(saved.has(a.symbol))||((b.yield_pct??-1)-(a.yield_pct??-1))||a.symbol.localeCompare(b.symbol));
      }
      function drawList(node,events){
        const signature=JSON.stringify([events,favorites.symbols]);if(node.__signature===signature)return;node.__signature=signature;
        const old=new Map(Array.from(node.children).map(row=>[row.dataset.event,row])),saved=new Set(favorites.symbols);
        const rows=events.map(event=>{const prior=old.get(event.id);let row=prior;
          if(!prior||prior.__event!==JSON.stringify(event)){row=eventRow(event);row.__event=JSON.stringify(event);if(prior)row.__disclosure.open=prior.__disclosure.open;}
          row.__favorite.hidden=!saved.has(event.symbol);return row;
        });node.replaceChildren(...rows);
      }
      function renderLists(){const data=current&&current.data,events=prioritize((searchText&&!selectedDate?(data?data.events.filter(event=>event.precision==='day'&&event.kind!=='ex_dividend'):[]):visibleEvents(data,selectedDate,today())).filter(matches));refs.list.dataset.selectedDay=String(!!selectedDate);refs.heading.textContent=selectedDate?Number(selectedDate.slice(5,7))+'/'+Number(selectedDate.slice(8))+' '+['日','月','火','水','木','金','土'][new Date(selectedDate+'T00:00:00Z').getUTCDay()]+'曜日の予定':searchText?'検索結果':'これからの予定';refs.clear.hidden=!selectedDate;drawList(refs.list,events.slice(0,limit));refs.more.hidden=events.length<=limit;refs.more.textContent='もっと見る（残り'+Math.max(0,events.length-limit)+'件）';
        refs.empty.hidden=events.length>0;refs.empty.textContent=!data?(current&&current.status==='error'?'日程を確認できませんでした。再確認をお試しください。':'予定を確認しています…'):scope==='favorites'&&!favorites.symbols.length?'お気に入りに日本株を追加すると、確認できた予定が表示されます。':searchText?'この月に一致する確認済みの予定はありません。':selectedDate?'この日に確認できた予定はありません。':'この月のこれからの予定は、まだ確認できていません。';
        const plans=prioritize(data?data.events.filter(event=>event.precision==='month'&&matches(event)):[]);refs.plans.hidden=!plans.length;refs.planHeading.textContent=Number(monthValue.slice(5))+'月の支払い予定';drawList(refs.planList,plans.slice(0,monthLimit));refs.planMore.hidden=plans.length<=monthLimit;refs.planMore.textContent='もっと見る（残り'+Math.max(0,plans.length-monthLimit)+'件）';syncPrices();
      }
      function render(){refs.all.setAttribute('aria-pressed',String(scope==='all'));refs.favorites.setAttribute('aria-pressed',String(scope==='favorites'));refs.month.textContent=prettyMonth(monthValue);const range=bounds();refs.previous.disabled=monthValue<=range.months[0];refs.next.disabled=monthValue>=range.months[12];const state=current,data=state&&state.data;
        if(autoDate&&data&&(['ready','stale'].includes(state.status)||data.events.length)){const next=visibleEvents(data,null,today())[0];selectedDate=next?next.date:monthValue===today().slice(0,7)?today():monthValue+'-01';autoDate=false;}
        const checked=data&&data.updated_at?'確認 '+new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(data.updated_at)+' JST':'';
        refs.retry.hidden=!(state&&['error','stale'].includes(state.status));refs.status.textContent=!state||state.status==='loading'?'予定を確認しています…':state.status==='error'?(data?'更新できませんでした。保存済みの予定を表示しています。':'予定を読み込めませんでした。'):state.status==='pending'?'確認できた予定を集めています…':state.status==='refreshing'?'最新の予定を確認しています…':state.status==='stale'?'保存済みの予定です。'+checked:checked;
        refs.universe.textContent='東証の国内上場企業を対象に、確認できた配当日程を掲載しています。1年先まで表示できますが、未発表・未確認の予定は載りません。予定が空欄でも、配当がないとは限りません。';refs.universe.hidden=!refs.universe.textContent;
        refs.coverage.textContent=data&&data.coverage.universe?'対象 '+data.coverage.universe+'社 ／ この月の予定を確認 '+data.coverage.known+'社'+(data.coverage.unknown?' ／ 日程未確認 '+data.coverage.unknown+'社':'')+(scope==='all'?'（収集対象の銘柄）':''):'';
        const notes=[];if(favorites.legacyCount)notes.push('以前の登録 '+favorites.legacyCount+'社も含みます');if(favorites.overflow)notes.push('100社を超える登録は保存されています');if(favorites.error||favorites.migrationError)notes.push('保存済み銘柄の引き継ぎを確認できませんでした');if(state&&state.excluded&&state.excluded.length)notes.push(state.excluded.length+'社の銘柄コードを確認できませんでした');refs.migration.textContent=notes.join('。');refs.migration.hidden=!notes.length;updateDays();renderLists();
      }
      function selectDay(value){selectedDate=value;autoDate=false;limit=5;renderLists();updateDays();}
      function setScope(value){scopeChosen=true;if(scope===value)return;scope=value;selectedDate=null;autoDate=true;limit=monthLimit=5;polls=0;refresh(true);}
      function changeMonth(delta){const next=shift(monthValue,delta);if(!bounds().months.includes(next))return;monthValue=next;selectedDate=null;autoDate=true;limit=monthLimit=5;polls=0;buildDays();refresh(true);}
      function schedule(){w.clearTimeout(refreshTimer);if(!doc.hidden)refreshTimer=w.setTimeout(()=>{if(mount.getClientRects().length)refresh(false);schedule();},300000);}
      function refresh(force=false,reset=true){const range=bounds();if(!range.months.includes(monthValue)){monthValue=range.months[0];selectedDate=null;autoDate=true;buildDays();}favorites={...selection(storage),migrationError:favorites.migrationError};const next=query(),key=JSON.stringify(next);if(doc.hidden)return Promise.resolve();if(!force&&key===lastQuery&&Date.now()-lastRefresh<60000)return Promise.resolve();if(reset){polls=0;w.clearTimeout(retryTimer);}lastQuery=key;lastRefresh=Date.now();return loader.load(next);}
      if(w.KNCalendarPrices){priceController=w.KNCalendarPrices.create({fetch:w.fetch.bind(w),storage,now:Date.now,setTimeout:w.setTimeout.bind(w),clearTimeout:w.clearTimeout.bind(w),AbortController:w.AbortController},updatePrice);priceController.pause();}
      w.KNDividendCalendar={refresh:()=>{syncPrices();return refresh(true);},__ready:true};w.loadDividendCalendar=w.KNDividendCalendar.refresh;buildDays();render();refresh();schedule();
      if(typeof w.IntersectionObserver==='function'){const observer=new w.IntersectionObserver(entries=>{priceInView=entries.some(entry=>entry.isIntersecting);syncPrices();},{rootMargin:'100px'});observer.observe(mount);}
      doc.addEventListener('knStockViewChanged',syncPrices);
      migrate(storage,w.__knPersistLocalSetting,w.__knGateReady).then(result=>{favorites=result;if(!scopeChosen&&favorites.symbols.length)scope='favorites';if(result.error||result.migrationError)render();if(w.dispatchEvent&&w.Event)w.dispatchEvent(new w.Event('kn:watchlist-change'));else refresh(true);}).catch(()=>{});
      if(w.addEventListener){w.addEventListener('kn:watchlist-change',()=>{const before=lastQuery;favorites=selection(storage);renderLists();if(JSON.stringify(query())!==before)refresh(true);});w.addEventListener('storage',event=>{if([FAVORITES,LEGACY,MIGRATED,null].includes(event.key))refresh(true);});w.addEventListener('online',()=>{syncPrices();if(priceController&&!doc.hidden&&priceInView)priceController.refresh(true);refresh(true);});}
      doc.addEventListener('visibilitychange',()=>{w.clearTimeout(retryTimer);w.clearTimeout(refreshTimer);syncPrices();if(doc.hidden)loader.cancel();else{if(mount.getClientRects().length)refresh(true);schedule();}});
    }
    if(w.document.readyState==='loading')w.document.addEventListener('DOMContentLoaded',init);else init();
  }
  return {symbol,month,day,today,shift,bounds,safeUrl,selection,migrate,normalize,calendarDays,visibleEvents,createLoader,start};
});

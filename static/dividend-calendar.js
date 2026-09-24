/* Dates come from verified schedules; month-only plans never acquire an invented day. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root&&root.document)api.start(root);})(typeof window==='undefined'?null:window,function(){
  'use strict';
  const FAVORITES='alert_watchlist_v1',LEGACY='myDividendStocks',MIGRATED='dividend_calendar_migrated_v1',NAMES='stock_watch_names_v1',CACHE='kn_dividend_calendar_v2:',KINDS={holding_deadline:'保有の締切',payment:'配当の支払い',ex_dividend:'権利落ち日'};
  const finite=v=>typeof v==='number'&&Number.isFinite(v),clean=(v,max=160)=>typeof v==='string'?v.trim().slice(0,max):'';
  function parse(value,fallback){try{return JSON.parse(value)||fallback;}catch(e){return fallback;}}
  function symbol(value){const key=clean(value,30).normalize('NFKC').toUpperCase();return /^[0-9][A-Z0-9]{3}(?:\.T)?$/.test(key)?key.replace(/\.T$/,'')+'.T':'';}
  function month(value){return typeof value==='string'&&/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)?value:null;}
  function day(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?value:null;}
  function today(now=Date.now()){return new Date(now+9*3600000).toISOString().slice(0,10);}
  function shift(value,delta){if(!month(value))return null;const parts=value.split('-').map(Number),date=new Date(Date.UTC(parts[0],parts[1]-1+delta,1));return date.toISOString().slice(0,7);}
  function bounds(now=Date.now()){const start=today(now).slice(0,7),last=shift(start,2),end=new Date(Date.parse(shift(last,1)+'-01T00:00:00Z')-86400000).toISOString().slice(0,10);return {start:start+'-01',end,months:[start,shift(start,1),last]};}
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
  function normalize(raw,selected,scope,symbols,now=Date.now()){
    if(!raw||typeof raw!=='object'||raw.error||!Array.isArray(raw.events)||!raw.coverage||!raw.range)return null;
    const start=day(raw.range.start),end=day(raw.range.end),stamp=at(raw.updated_at,now);if(!start||!end||start>end||selected<start.slice(0,7)||selected>end.slice(0,7))return null;
    const count=value=>Number.isInteger(value)&&value>=0?value:null,coverage={universe:count(raw.coverage.universe),known:count(raw.coverage.known),unknown:count(raw.coverage.unknown)};
    if(Object.values(coverage).includes(null)||coverage.known>coverage.universe||coverage.unknown>coverage.universe)return null;
    const seen=new Set(),allowed=new Set(symbols),events=[];
    for(const row of raw.events.slice(0,3000)){
      if(!row||typeof row!=='object')continue;const key=symbol(row.symbol||row.code),date=day(row.date),period=month(row.period),source=row.source&&typeof row.source==='object'?row.source:{},url=safeUrl(source.url),title=clean(source.title,120),verified=day(row.verified_on);
      if(!key||scope==='favorites'&&!allowed.has(key)||!KINDS[row.kind]||!['confirmed','planned'].includes(row.status)||!url||!title||!verified||verified>today(now))continue;
      if(row.precision==='day'?(!date||date.slice(0,7)!==selected):(row.precision!=='month'||row.kind!=='payment'||!period||period!==selected))continue;
      const id=[key,row.kind,row.precision,row.precision==='day'?date:period].join(':');if(seen.has(id))continue;seen.add(id);
      events.push({id,symbol:key,code:key.slice(0,-2),name:clean(row.name)||key,kind:row.kind,precision:row.precision,date:row.precision==='day'?date:null,period:row.precision==='month'?period:null,status:row.status,source:{title,url},verified_on:verified});
    }
    events.sort((a,b)=>(a.date||a.period).localeCompare(b.date||b.period)||a.symbol.localeCompare(b.symbol)||a.kind.localeCompare(b.kind));
    return {events,coverage,range:{start,end},updated_at:stamp,universe_as_of:day(raw.universe_as_of),status:raw.status==='loading'?'pending':['ready','stale','pending','unavailable'].includes(raw.status)?raw.status:'ready',refreshing:raw.refreshing===true,month:selected,scope};
  }
  function calendarDays(selected,events,current=today()){
    const first=new Date(selected+'-01T00:00:00Z'),offset=first.getUTCDay(),length=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate(),counts=new Map();events.forEach(event=>{if(event.precision==='day')counts.set(event.date,(counts.get(event.date)||0)+1);});
    return Array.from({length:42},(_,index)=>{const n=index-offset+1;if(n<1||n>length)return null;const date=selected+'-'+String(n).padStart(2,'0');return {date,day:n,count:counts.get(date)||0,today:date===current};});
  }
  function visibleEvents(data,selectedDate,current=today()){return data?data.events.filter(event=>event.precision==='day'&&(selectedDate?event.date===selectedDate:event.date>=current)):[];}
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
      let monthValue=today().slice(0,7),scope=selection(storage).symbols.length?'favorites':'all',scopeChosen=false,selectedDate=null,limit=5,monthLimit=5,current=null,favorites=selection(storage),lastQuery='',lastRefresh=0,retryTimer=null,refreshTimer=null,polls=0;const refs={},dateButtons=new Map();
      function el(tag,cls,text){const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;}
      function append(parent,...nodes){nodes.forEach(node=>parent.appendChild(node));return parent;}
      function button(label,cls,fn){const node=el('button',cls,label);node.type='button';node.addEventListener('click',fn);return node;}
      const filters=el('div','dc-filters');filters.setAttribute('aria-label','表示する銘柄');refs.all=button('掲載銘柄','dc-filter',()=>setScope('all'));refs.favorites=button('お気に入り','dc-filter',()=>setScope('favorites'));refs.manage=button('銘柄を追加','dc-manage',()=>{if(w.openStockWatchManager)w.openStockWatchManager();});append(filters,refs.all,refs.favorites,refs.manage);
      const navigation=el('div','dc-month-navigation');refs.previous=button('‹','dc-month-arrow',()=>changeMonth(-1));refs.previous.setAttribute('aria-label','前の月');refs.next=button('›','dc-month-arrow',()=>changeMonth(1));refs.next.setAttribute('aria-label','次の月');refs.month=el('h3','dc-month');refs.month.id='dc-month-title';append(navigation,refs.previous,refs.month,refs.next);
      const weekdays=el('div','dc-weekdays');weekdays.setAttribute('aria-hidden','true');['日','月','火','水','木','金','土'].forEach(name=>weekdays.appendChild(el('span','',name)));
      refs.grid=el('div','dc-grid');refs.grid.setAttribute('role','group');refs.grid.setAttribute('aria-labelledby','dc-month-title');
      const statusRow=el('div','dc-status-row');refs.status=el('p','dc-status');refs.status.setAttribute('role','status');refs.retry=button('再確認','dc-retry',()=>refresh(true));refs.retry.hidden=true;append(statusRow,refs.status,refs.retry);
      const listHead=el('div','dc-list-heading');refs.heading=el('h4');refs.clear=button('これからの予定へ','dc-reset',()=>{selectedDate=null;limit=5;renderLists();updateDays();});refs.clear.hidden=true;append(listHead,refs.heading,refs.clear);
      refs.list=el('ul','dc-events');refs.empty=el('p','dc-empty');refs.more=button('もっと見る','dc-more',()=>{limit+=5;renderLists();});refs.more.hidden=true;
      refs.plans=el('div','dc-month-plans');refs.planHeading=el('h4','dc-plan-heading');refs.planList=el('ul','dc-events');refs.planMore=button('もっと見る','dc-more',()=>{monthLimit+=5;renderLists();});append(refs.plans,refs.planHeading,el('p','dc-plan-note','支払日はまだ確認できていません。'),refs.planList,refs.planMore);
      refs.coverage=el('p','dc-coverage');refs.migration=el('p','dc-coverage');refs.universe=el('p','dc-universe');const legend=el('details','dc-help');append(legend,el('summary','','日付の見方'),el('p','','保有の締切は、今回の配当の権利を得るため、この日の取引終了時まで株を持っておく日です。権利落ち日に買っても、今回の配当の権利は得られません。配当の支払いとは別の日です。'),refs.universe);
      append(mount,filters,navigation,weekdays,refs.grid,statusRow,listHead,refs.list,refs.empty,refs.more,refs.plans,refs.coverage,refs.migration,legend);
      function query(){return {month:monthValue,scope,symbols:favorites.symbols};}
      const loader=createLoader({fetch:w.fetch.bind(w),AbortController:w.AbortController,setTimeout:w.setTimeout.bind(w),clearTimeout:w.clearTimeout.bind(w),storage},state=>{current=state;render();w.clearTimeout(retryTimer);if(state.data&&state.data.refreshing&&state.status!=='error'&&polls<4&&!doc.hidden&&mount.getClientRects().length){retryTimer=w.setTimeout(()=>{polls++;refresh(true,false);},15000);}});
      function prettyMonth(value){return value.slice(0,4)+'年'+Number(value.slice(5))+'月';}
      function dateLabel(value){return Number(value.slice(5,7))+'月'+Number(value.slice(8))+'日';}
      function buildDays(){refs.grid.replaceChildren();dateButtons.clear();calendarDays(monthValue,[],today()).forEach(item=>{if(!item){const blank=el('span','dc-blank');blank.setAttribute('aria-hidden','true');refs.grid.appendChild(blank);return;}const cell=button(String(item.day),'dc-day',()=>selectDay(item.date));cell.dataset.date=item.date;const count=el('small','dc-day-count');count.setAttribute('aria-hidden','true');cell.appendChild(count);cell.addEventListener('keydown',event=>{const jump={ArrowRight:1,ArrowLeft:-1,ArrowDown:7,ArrowUp:-7}[event.key];if(!jump)return;const destination=new Date(Date.parse(item.date+'T00:00:00Z')+jump*86400000).toISOString().slice(0,10),target=dateButtons.get(destination);if(target){event.preventDefault();target.button.focus();}});dateButtons.set(item.date,{button:cell,count});refs.grid.appendChild(cell);});}
      function updateDays(){const events=current&&current.data&&current.data.events||[];calendarDays(monthValue,events,today()).forEach(item=>{if(!item)return;const row=dateButtons.get(item.date);row.button.setAttribute('aria-pressed',String(selectedDate===item.date));row.button.setAttribute('aria-label',dateLabel(item.date)+'、'+(item.count?item.count+'件の予定':'確認済みの予定なし'));if(item.today)row.button.setAttribute('aria-current','date');else row.button.removeAttribute('aria-current');row.count.textContent=item.count?String(item.count):'';row.count.hidden=!item.count;});}
      function eventRow(event){const row=el('li','dc-event');row.dataset.event=event.id;const date=el('div','dc-event-date',event.precision==='day'?Number(event.date.slice(5,7))+'/'+Number(event.date.slice(8)):Number(event.period.slice(5))+'月');const body=el('div','dc-event-body'),name=el('button','cp-company-link dc-company',event.name);name.type='button';name.dataset.companyProfile=event.symbol;name.dataset.companyName=event.name;name.setAttribute('aria-label',event.name+'の会社情報を開く');const tag=el('p','dc-event-kind',KINDS[event.kind]+(event.status==='planned'?'（予定）':''));tag.dataset.kind=event.kind;const evidence=el('details','dc-evidence');append(evidence,el('summary','','出典・確認日'));const link=el('a','',event.source.title);link.href=event.source.url;link.target='_blank';link.rel='noopener noreferrer';append(evidence,link,el('span','','確認 '+event.verified_on.replace(/-/g,'/')));append(body,name,tag,evidence);append(row,date,body);return row;}
      function drawList(node,events){const signature=JSON.stringify(events);if(node.__signature===signature)return;node.__signature=signature;const old=new Map(Array.from(node.children).map(row=>[row.dataset.event,row]));const rows=events.map(event=>{const prior=old.get(event.id);if(prior&&prior.__event===JSON.stringify(event))return prior;const row=eventRow(event);row.__event=JSON.stringify(event);return row;});node.replaceChildren(...rows);}
      function renderLists(){const data=current&&current.data,events=visibleEvents(data,selectedDate,today());refs.heading.textContent=selectedDate?dateLabel(selectedDate)+'の予定':'これからの予定';refs.clear.hidden=!selectedDate;drawList(refs.list,events.slice(0,limit));refs.more.hidden=events.length<=limit;refs.more.textContent='もっと見る（残り'+Math.max(0,events.length-limit)+'件）';
        refs.empty.hidden=events.length>0;refs.empty.textContent=!data?(current&&current.status==='error'?'日程を確認できませんでした。再確認をお試しください。':'予定を確認しています…'):scope==='favorites'&&!favorites.symbols.length?'お気に入りに日本株を追加すると、確認できた予定が表示されます。':selectedDate?'この日に確認できた予定はありません。':'この月のこれからの予定は、まだ確認できていません。';
        const plans=data?data.events.filter(event=>event.precision==='month'):[];refs.plans.hidden=!plans.length;refs.planHeading.textContent=Number(monthValue.slice(5))+'月の支払い予定';drawList(refs.planList,plans.slice(0,monthLimit));refs.planMore.hidden=plans.length<=monthLimit;refs.planMore.textContent='もっと見る（残り'+Math.max(0,plans.length-monthLimit)+'件）';
      }
      function render(){refs.all.setAttribute('aria-pressed',String(scope==='all'));refs.favorites.setAttribute('aria-pressed',String(scope==='favorites'));refs.month.textContent=prettyMonth(monthValue);const range=bounds();refs.previous.disabled=monthValue<=range.months[0];refs.next.disabled=monthValue>=range.months[2];const state=current,data=state&&state.data;
        const checked=data&&data.updated_at?'確認 '+new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(data.updated_at)+' JST':'';
        refs.retry.hidden=!(state&&['error','stale'].includes(state.status));refs.status.textContent=!state||state.status==='loading'?'予定を確認しています…':state.status==='error'?(data?'更新できませんでした。保存済みの予定を表示しています。':'予定を読み込めませんでした。'):state.status==='pending'?'確認できた予定を集めています…':state.status==='refreshing'?'最新の予定を確認しています…':state.status==='stale'?'保存済みの予定です。'+checked:checked;
        refs.universe.textContent=data&&data.universe_as_of?'日経225の構成：'+data.universe_as_of.replace(/-/g,'/')+' 時点。掲載銘柄は収集対象の銘柄で、すべての上場会社ではありません。':'';refs.universe.hidden=!refs.universe.textContent;
        refs.coverage.textContent=data&&data.coverage.universe?'対象 '+data.coverage.universe+'社 ／ この月の予定を確認 '+data.coverage.known+'社'+(data.coverage.unknown?' ／ 日程未確認 '+data.coverage.unknown+'社':'')+(scope==='all'?'（収集対象の銘柄）':''):'';
        const notes=[];if(favorites.legacyCount)notes.push('以前の登録 '+favorites.legacyCount+'社も含みます');if(favorites.overflow)notes.push('100社を超える登録は保存されています');if(favorites.error||favorites.migrationError)notes.push('保存済み銘柄の引き継ぎを確認できませんでした');if(state&&state.excluded&&state.excluded.length)notes.push(state.excluded.length+'社の銘柄コードを確認できませんでした');refs.migration.textContent=notes.join('。');refs.migration.hidden=!notes.length;updateDays();renderLists();
      }
      function selectDay(value){selectedDate=value;limit=5;renderLists();updateDays();}
      function setScope(value){scopeChosen=true;if(scope===value)return;scope=value;selectedDate=null;limit=monthLimit=5;polls=0;refresh(true);}
      function changeMonth(delta){const next=shift(monthValue,delta);if(!bounds().months.includes(next))return;monthValue=next;selectedDate=null;limit=monthLimit=5;polls=0;buildDays();refresh(true);}
      function schedule(){w.clearTimeout(refreshTimer);if(!doc.hidden)refreshTimer=w.setTimeout(()=>{if(mount.getClientRects().length)refresh(false);schedule();},300000);}
      function refresh(force=false,reset=true){const range=bounds();if(!range.months.includes(monthValue)){monthValue=range.months[0];selectedDate=null;buildDays();}favorites={...selection(storage),migrationError:favorites.migrationError};const next=query(),key=JSON.stringify(next);if(doc.hidden)return Promise.resolve();if(!force&&key===lastQuery&&Date.now()-lastRefresh<60000)return Promise.resolve();if(reset){polls=0;w.clearTimeout(retryTimer);}lastQuery=key;lastRefresh=Date.now();return loader.load(next);}
      w.KNDividendCalendar={refresh:()=>refresh(true),__ready:true};w.loadDividendCalendar=w.KNDividendCalendar.refresh;buildDays();render();refresh();schedule();
      migrate(storage,w.__knPersistLocalSetting,w.__knGateReady).then(result=>{favorites=result;if(!scopeChosen&&favorites.symbols.length)scope='favorites';if(result.error||result.migrationError)render();if(w.dispatchEvent&&w.Event)w.dispatchEvent(new w.Event('kn:watchlist-change'));else refresh(true);}).catch(()=>{});
      if(w.addEventListener){w.addEventListener('kn:watchlist-change',()=>{const before=lastQuery;favorites=selection(storage);if(JSON.stringify(query())!==before)refresh(true);});w.addEventListener('storage',event=>{if([FAVORITES,LEGACY,MIGRATED,null].includes(event.key))refresh(true);});w.addEventListener('online',()=>refresh(true));}
      doc.addEventListener('visibilitychange',()=>{w.clearTimeout(retryTimer);w.clearTimeout(refreshTimer);if(doc.hidden)loader.cancel();else{if(mount.getClientRects().length)refresh(true);schedule();}});
    }
    if(w.document.readyState==='loading')w.document.addEventListener('DOMContentLoaded',init);else init();
  }
  return {symbol,month,day,today,shift,bounds,safeUrl,selection,migrate,normalize,calendarDays,visibleEvents,createLoader,start};
});

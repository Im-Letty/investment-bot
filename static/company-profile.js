/* Company facts are independent of the article disclosure and retain their own dates. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document)root.KNCompanyProfile=api.start(root);
})(typeof window==='undefined'?null:window,function(){
  'use strict';
  const POLL_MS=3000,POLL_LIMIT=90000,REQUEST_TIMEOUT=12000,CACHE_AGE=7*86400000,CACHE_PREFIX='kn_company_profile_v1:';
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const text=(value,limit=400)=>typeof value==='string'?value.trim().slice(0,limit):'';
  function symbol(value){const key=text(value,30).normalize('NFKC').toUpperCase();return /^[0-9][A-Z0-9]{3}(?:\.T)?$/.test(key)?key.replace(/\.T$/,'')+'.T':'';}
  function safeUrl(value){
    if(typeof value!=='string'||/[\u0000-\u0020\u007f\\]/.test(value))return null;
    try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch(e){return null;}
  }
  function day(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
    const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?value:null;
  }
  function month(value){return typeof value==='string'&&/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)?value:null;}
  function timestamp(value,now=Date.now()){
    let at=null;
    if(finite(value)&&value>0)at=value>=1e12?value:value*1000;
    else if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&day(value.slice(0,10)))at=Date.parse(value);
    return finite(at)&&at>0&&at<=now+60000?at:null;
  }
  function dateText(value){return day(value)?value.replace(/-/g,'/'):'—';}
  function stamp(value){return finite(value)?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(value)+' JST':null;}
  function today(now){return new Date(now+9*3600000).toISOString().slice(0,10);}
  function money(value,currency='JPY',compact=false){
    if(!finite(value)||value<0||!['JPY','USD','EUR','GBP'].includes(currency))return null;
    const unit={JPY:'円',USD:'米ドル',EUR:'ユーロ',GBP:'英ポンド'}[currency];
    let number=value,suffix='';
    if(compact&&value>=1e12){number=value/1e12;suffix='兆';}else if(compact&&value>=1e8){number=value/1e8;suffix='億';}
    return number.toLocaleString('ja-JP',{maximumFractionDigits:2})+suffix+unit;
  }
  function sourceList(values,now){
    const seen=new Set();return (Array.isArray(values)?values:[]).slice(0,15).flatMap(raw=>{
      if(!raw||typeof raw!=='object')return [];
      const title=text(raw.title||raw.name,120),url=safeUrl(raw.url||raw.source_url);
      if(!title||!url||seen.has(url))return [];seen.add(url);
      return [{title,url,fetched_at:timestamp(raw.fetched_at,now)}];
    });
  }
  function normalize(raw,key,now=Date.now()){
    if(!raw||typeof raw!=='object'||raw.error||symbol(raw.symbol)!==key||!['pending','ready','stale','unavailable'].includes(raw.status))return null;
    const input=raw.data&&typeof raw.data==='object'?raw.data:{},positive=v=>finite(v)&&v>0?v:null,amount=v=>finite(v)&&v>=0?v:null;
    const currency=/^[A-Z]{3}$/.test(input.currency||'')?input.currency:'JPY';
    const fieldSource=raw.source&&typeof raw.source==='object'?raw.source:{};
    const fields={};
    for(const name of ['price','market_cap','forward_annual_dividend_per_share','analyst_target','ex_dividend_date','dividend_payment_date','dividend_payment_period']){
      const field=fieldSource.fields&&fieldSource.fields[name];
      fields[name]={fetched_at:timestamp(field&&field.fetched_at,now)};
    }
    const target=input.analyst_target&&typeof input.analyst_target==='object'?input.analyst_target:{};
    const mean=positive(target.mean),low=positive(target.low),high=positive(target.high);
    const consistent=!(low!==null&&high!==null&&low>high||mean!==null&&low!==null&&mean<low||mean!==null&&high!==null&&mean>high);
    const targetCurrency=text(target.currency,3)||currency;
    const analyst=consistent&&targetCurrency===currency?{mean,low,high,analyst_count:finite(target.analyst_count)&&Number.isInteger(target.analyst_count)&&target.analyst_count>0?target.analyst_count:null,as_of:day(target.as_of),currency:targetCurrency}:null;
    const editorial=raw.editorial&&typeof raw.editorial==='object'&&text(raw.editorial.business)?{
      business:text(raw.editorial.business),life:text(raw.editorial.life),watch:text(raw.editorial.watch),
      reviewed_on:day(raw.editorial.reviewed_on),sources:sourceList(raw.editorial.sources,now)
    }:null;
    const data={currency,price:positive(input.price),price_updated_at:timestamp(input.price_updated_at,now),market_cap:positive(input.market_cap),
      annual_dividend:input.annual_dividend_basis==='trailing_12m'?amount(input.annual_dividend):null,
      annual_dividend_basis:input.annual_dividend_basis==='trailing_12m'?'trailing_12m':null,
      dividend_fetched_at:timestamp(input.dividend_fetched_at,now),
      forward_annual_dividend_per_share:input.forward_dividend_basis==='annualized'?amount(input.forward_annual_dividend_per_share):null,
      forward_dividend_basis:input.forward_dividend_basis==='annualized'?'annualized':null,
      analyst_target:analyst,ex_dividend_date:day(input.ex_dividend_date),dividend_payment_date:day(input.dividend_payment_date),dividend_payment_period:month(input.dividend_payment_period)};
    const sources=sourceList(raw.sources,now);
    if(!sources.length&&fieldSource.url)sources.push(...sourceList([fieldSource],now));
    return {symbol:key,name:text(raw.name,160)||key,status:raw.status,refreshing:raw.refreshing===true,
      updated_at:timestamp(raw.updated_at,now),data,editorial,sources,source:{fields}};
  }
  function hasFacts(record){return !!record&&(record.data.price!==null||record.data.market_cap!==null||record.data.annual_dividend!==null||record.data.forward_annual_dividend_per_share!==null||record.data.ex_dividend_date||record.data.dividend_payment_date||record.data.dividend_payment_period||record.data.analyst_target&&record.data.analyst_target.mean!==null);}
  function cacheTime(record){return record&&Math.max(record.updated_at||0,record.data.price_updated_at||0,record.data.dividend_fetched_at||0);}
  function retainNewer(record,before){
    if(!before||hasFacts(record)&&(record.updated_at||0)>=(before.updated_at||0))return record;
    const kept={...before,name:record.name,editorial:record.editorial||before.editorial,status:record.status,refreshing:record.refreshing,data:{...before.data},source:{fields:{...before.source.fields}}};
    if(record.data.price!==null&&(record.data.price_updated_at||0)>(before.data.price_updated_at||0)){
      kept.data.price=record.data.price;kept.data.price_updated_at=record.data.price_updated_at;kept.source.fields.price=record.source.fields.price;
    }
    if(record.data.annual_dividend!==null&&(record.data.dividend_fetched_at||0)>(before.data.dividend_fetched_at||0)){
      kept.data.annual_dividend=record.data.annual_dividend;kept.data.annual_dividend_basis=record.data.annual_dividend_basis;kept.data.dividend_fetched_at=record.data.dividend_fetched_at;
    }
    return kept;
  }
  function createLoader(env,onState){
    const now=env.now||Date.now,set=env.setTimeout||setTimeout,clear=env.clearTimeout||clearTimeout;
    const cache=new Map();let version=0,current='',controller=null,requestTimer=null,pollTimer=null,cancelWait=null,busy=false,last=null;
    function save(record){
      if(!hasFacts(record)||!cacheTime(record))return;
      cache.delete(record.symbol);cache.set(record.symbol,record);
      while(cache.size>20)cache.delete(cache.keys().next().value);
      try{if(env.storage)env.storage.setItem(CACHE_PREFIX+record.symbol,JSON.stringify(record));}catch(e){}
    }
    function saved(key){
      let record=cache.get(key);
      if(!record){try{record=normalize(JSON.parse(env.storage&&env.storage.getItem(CACHE_PREFIX+key)),key,now());}catch(e){}}
      if(!record||!hasFacts(record)||!cacheTime(record)||now()-cacheTime(record)>CACHE_AGE)return null;
      cache.set(key,record);return record;
    }
    function cancel(){version++;busy=false;clear(requestTimer);clear(pollTimer);requestTimer=pollTimer=null;if(controller)controller.abort();controller=null;if(cancelWait)cancelWait(new Error('cancelled'));cancelWait=null;current='';}
    function emit(state){last=state;onState(state);}
    function end(key,reason){busy=false;const kept=saved(key)||(last&&last.symbol===key&&last.data);emit({symbol:key,status:kept?'stale':'error',data:kept||null,fromCache:!!kept,updating:false,reason});}
    async function request(key,token,deadline){
      if(token!==version)return;
      const remaining=deadline-now();if(remaining<=0){end(key,'pending_timeout');return;}
      const active=new env.AbortController();controller=active;
      try{
        const timeout=new Promise((resolve,reject)=>{cancelWait=reject;requestTimer=set(()=>{active.abort();reject(new Error('timeout'));},Math.min(REQUEST_TIMEOUT,remaining));});
        const response=Promise.resolve().then(()=>env.fetch('/api/company-profile?symbol='+encodeURIComponent(key),{signal:active.signal,cache:'no-store'})).then(async result=>{if(!result.ok)throw new Error(result.status===404?'not_found':'request');return result.json();});
        const payload=await Promise.race([response,timeout]);
        if(token!==version)return;
        const record=normalize(payload,key,now());if(!record)throw new Error('invalid');
        const before=saved(key),data=retainNewer(record,before),fromCache=data!==record;save(data);
        const pending=record.status==='pending'||record.refreshing;
        if(record.status==='unavailable'&&!pending){busy=false;emit({symbol:key,status:'error',data,fromCache,updating:false,reason:'unavailable'});return;}
        emit({symbol:key,status:pending?'pending':fromCache?'stale':record.status,data,fromCache,updating:pending,reason:null});
        if(pending){pollTimer=set(()=>{pollTimer=null;request(key,token,deadline);},Math.min(POLL_MS,Math.max(0,deadline-now())));}else busy=false;
      }catch(error){if(token===version)end(key,error.message==='not_found'?'not_found':error.message==='timeout'?'timeout':'unavailable');}
      finally{if(token===version){clear(requestTimer);requestTimer=null;controller=null;cancelWait=null;}}
    }
    function load(value){
      const key=symbol(value);if(!key)return false;
      if(key===current&&busy)return true;
      cancel();current=key;busy=true;const token=version,kept=saved(key);
      emit({symbol:key,status:kept?'stale':'loading',data:kept,fromCache:!!kept,updating:true,reason:null});
      request(key,token,now()+POLL_LIMIT);return true;
    }
    return {load,cancel,peek:key=>saved(symbol(key)),getState:()=>last};
  }
  function createDialog(w,onRetry){
    const doc=w.document,refs={};let opened=false,closing=null,returnFocus=null,background=[],scrolls=[],bodyStyle=null,currentSymbol='';
    function el(tag,cls,content){const node=doc.createElement(tag);if(cls)node.className=cls;if(content!==undefined)node.textContent=content;return node;}
    function append(parent,...nodes){nodes.forEach(node=>parent.appendChild(node));return parent;}
    const overlay=el('div','cp-overlay');overlay.id='knCompanyProfile';overlay.hidden=true;
    const backdrop=el('div','cp-backdrop');backdrop.setAttribute('aria-hidden','true');
    const panel=el('section','cp-sheet');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','cp-company-title');panel.tabIndex=-1;
    const head=el('header','cp-head'),identity=el('div','cp-identity');refs.code=el('p','cp-code');refs.name=el('h2','cp-title');refs.name.id='cp-company-title';
    const closeButton=el('button','cp-close','閉じる');closeButton.type='button';
    append(identity,refs.code,refs.name);append(head,identity,closeButton);
    const content=el('div','cp-content'),feedback=el('div','cp-feedback');feedback.setAttribute('role','status');
    refs.status=el('p');refs.retry=el('button','cp-retry','もう一度確認');refs.retry.type='button';refs.retry.hidden=true;append(feedback,refs.status,refs.retry);
    const stories=el('div','cp-stories');
    [['business','どんな会社？'],['life','暮らしとのつながり'],['watch','これから見るところ']].forEach(([key,title])=>{
      const section=el('section','cp-story'),body=el('p','cp-story-copy');append(section,el('h3','cp-heading',title),body);stories.appendChild(section);refs[key]={section,body};
    });
    const numbers=el('details','cp-numbers'),summary=el('summary','cp-numbers-toggle');
    const mark=el('i','cp-disclosure');mark.setAttribute('aria-hidden','true');append(summary,el('span','','数字・配当'),mark);numbers.appendChild(summary);
    const facts=el('div','cp-facts');numbers.appendChild(facts);
    function group(title){const box=el('section','cp-fact-group'),list=el('dl','cp-metric-list');append(box,el('h3','cp-heading',title),list);facts.appendChild(box);return {box,list};}
    function metric(group,key,label,help){
      const row=el('div','cp-metric'),dt=el('dt','cp-metric-label',label),dd=el('dd','cp-metric-data'),value=el('span','cp-number','—'),unknown=el('small','cp-unknown','未確認'),time=el('p','cp-fact-time');
      if(help)dt.appendChild(el('small','cp-definition',help));append(dd,value,unknown,time);append(row,dt,dd);group.list.appendChild(row);refs[key]={value,unknown,time};
    }
    const market=group('株価と会社の大きさ');metric(market,'price','株価');metric(market,'cap','時価総額','会社の株を全部合わせた値段');
    const dividends=group('配当');metric(dividends,'annual','過去1年の実績配当','1株あたり');metric(dividends,'forward','予想配当（今後1年の目安）','1株あたり。会社が出す年度ごとの予想とは異なります。');
    metric(dividends,'exDate','配当の権利が外れる日','権利落ち日です。配当の支払日とは異なります。');metric(dividends,'paymentDate','配当の支払日');
    const targets=group('専門家の予想');metric(targets,'target','アナリストの目標株価（平均）','専門家の予想・保証ではありません。');
    refs.targetRange=el('p','cp-fact-note');refs.targetDate=el('p','cp-fact-note');append(targets.box,refs.targetRange,refs.targetDate);
    const sources=el('footer','cp-sources');append(sources,el('h3','cp-heading','出典'));refs.reviewed=el('p','cp-review-date');refs.sources=el('ul','cp-source-list');append(sources,refs.reviewed,refs.sources);
    append(content,feedback,stories,numbers,sources);append(panel,head,content);append(overlay,backdrop,panel);doc.body.appendChild(overlay);
    let sourcesSignature='';
    function setMetric(key,value,when){const ref=refs[key];ref.value.textContent=value||'—';ref.unknown.hidden=!!value;ref.time.textContent=when||'';ref.time.hidden=!when;}
    function render(state){
      if(!opened||state.symbol!==currentSymbol)return;
      const record=state.data,data=record&&record.data||{},currency=data.currency||'JPY',editorial=record&&record.editorial;
      if(record&&record.name)refs.name.textContent=record.name;
      const failed=['error','stale'].includes(state.status)&&!state.updating;
      refs.status.textContent=state.status==='loading'?'情報を確認しています…':state.updating?(state.fromCache?'保存していた情報を表示し、最新の情報を確認しています…':'最新の情報を確認しています…'):failed?(record&&hasFacts(record)?'一部の情報は保存済みです。取得日時をご確認ください。':'情報を確認できませんでした。'):state.status==='stale'?'保存済みの情報です。取得日時をご確認ください。':'';
      refs.retry.hidden=!failed;
      feedback.hidden=!refs.status.textContent&&!failed;
      refs.business.body.textContent=editorial?editorial.business:record?'この会社の説明はまだ掲載されていません':'会社の説明を確認しています…';
      ['life','watch'].forEach(key=>{refs[key].section.hidden=!(editorial&&editorial[key]);refs[key].body.textContent=editorial&&editorial[key]||'';});
      function fetched(field,fallback){const value=record&&record.source.fields[field]&&record.source.fields[field].fetched_at||fallback;return stamp(value)?'取得 '+stamp(value):'取得日：未確認';}
      setMetric('price',money(data.price,currency),data.price!==null&&data.price!==undefined?(stamp(data.price_updated_at)?'株価の時点 '+stamp(data.price_updated_at):'株価の時点：未確認')+' / '+fetched('price'):null);
      setMetric('cap',money(data.market_cap,currency,true),data.market_cap!==null&&data.market_cap!==undefined?fetched('market_cap'):null);
      setMetric('annual',money(data.annual_dividend,currency),data.annual_dividend!==null&&data.annual_dividend!==undefined?(stamp(data.dividend_fetched_at)?'取得 '+stamp(data.dividend_fetched_at):'取得日：未確認'):null);
      setMetric('forward',money(data.forward_annual_dividend_per_share,currency),data.forward_annual_dividend_per_share!==null&&data.forward_annual_dividend_per_share!==undefined?fetched('forward_annual_dividend_per_share'):null);
      function schedule(value){return day(value)?dateText(value)+(value>today(Date.now())?'（予定）':''):null;}
      setMetric('exDate',schedule(data.ex_dividend_date),day(data.ex_dividend_date)?fetched('ex_dividend_date'):null);
      const paymentMonth=month(data.dividend_payment_period),paymentDate=day(data.dividend_payment_date);
      const paymentValue=paymentDate?schedule(paymentDate):paymentMonth?paymentMonth.slice(0,4)+'年'+Number(paymentMonth.slice(5))+'月'+(paymentMonth>today(Date.now()).slice(0,7)?'（予定）':''):null;
      setMetric('paymentDate',paymentValue,paymentDate?fetched('dividend_payment_date'):paymentMonth?'日付は未公表 / '+fetched('dividend_payment_period'):null);
      const analyst=data.analyst_target;
      setMetric('target',money(analyst&&analyst.mean,currency),analyst&&(analyst.mean!==null||analyst.low!==null||analyst.high!==null)?fetched('analyst_target'):null);
      const range=analyst&&analyst.low!==null&&analyst.high!==null?'予想の幅 '+money(analyst.low,currency)+'〜'+money(analyst.high,currency):'';
      refs.targetRange.textContent=[range,analyst&&analyst.analyst_count?analyst.analyst_count+'人の予想':''].filter(Boolean).join(' / ');refs.targetRange.hidden=!refs.targetRange.textContent;
      refs.targetDate.textContent=analyst&&(analyst.mean!==null||analyst.low!==null||analyst.high!==null)?(analyst.as_of?'予想日 '+dateText(analyst.as_of):'予想が出された日は提供元に記載がありません。'):'';refs.targetDate.hidden=!refs.targetDate.textContent;
      refs.reviewed.textContent=editorial?(editorial.reviewed_on?'会社の説明の確認日 '+dateText(editorial.reviewed_on):'会社の説明の確認日：未確認'):'';refs.reviewed.hidden=!refs.reviewed.textContent;
      const allSources=[...(editorial&&editorial.sources||[]),...(record&&record.sources||[])],signature=JSON.stringify(allSources);
      if(signature!==sourcesSignature){
        sourcesSignature=signature;refs.sources.replaceChildren();
        const unique=new Set();allSources.forEach(source=>{if(unique.has(source.url))return;unique.add(source.url);const row=el('li'),link=el('a','cp-source-link',source.title);link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';row.appendChild(link);if(stamp(source.fetched_at))row.appendChild(el('small','cp-source-time','取得 '+stamp(source.fetched_at)));refs.sources.appendChild(row);});
        if(!allSources.length)refs.sources.appendChild(el('li','cp-source-time','出典：未確認'));
      }
    }
    function sizeViewport(){if(!opened||!w.visualViewport)return;overlay.style.setProperty('--cp-viewport-height',Math.round(w.visualViewport.height)+'px');overlay.style.setProperty('--cp-viewport-top',Math.max(0,Math.round(w.visualViewport.offsetTop))+'px');}
    function rememberBackground(trigger){
      returnFocus=trigger||doc.activeElement;scrolls=[];let node=returnFocus;
      while(node&&node!==doc.body){if(node.scrollTop||node.scrollLeft)scrolls.push({node,top:node.scrollTop,left:node.scrollLeft});node=node.parentElement;}
      const home=doc.getElementById('morning-section');if(home&&!scrolls.some(item=>item.node===home))scrolls.push({node:home,top:home.scrollTop,left:home.scrollLeft});
      background=Array.from(doc.body.children).filter(node=>node!==overlay&&!['SCRIPT','STYLE','LINK'].includes(node.tagName)).map(node=>({node,inert:node.inert,aria:node.getAttribute('aria-hidden')}));
      background.forEach(item=>{item.node.inert=true;});
      const style=doc.body.style;bodyStyle={};['overflow','position','top','left','right','width','paddingRight'].forEach(key=>bodyStyle[key]=style[key]);bodyStyle.scrollY=w.scrollY||0;
      const gutter=Math.max(0,w.innerWidth-doc.documentElement.clientWidth);
      if(gutter&&w.getComputedStyle)style.paddingRight=(parseFloat(w.getComputedStyle(doc.body).paddingRight)||0)+gutter+'px';
      style.overflow='hidden';style.position='fixed';style.top=-bodyStyle.scrollY+'px';style.left='0';style.right='0';style.width='100%';
    }
    function open(key,name,trigger){
      if(closing!==null){w.clearTimeout(closing);closing=null;}
      delete overlay.dataset.closing;
      if(!opened)rememberBackground(trigger);
      if(currentSymbol!==key){numbers.open=false;content.scrollTop=0;sourcesSignature='';}
      currentSymbol=key;opened=true;refs.code.textContent=key.replace(/\.T$/,'');refs.name.textContent=text(name,160)||key;overlay.hidden=false;sizeViewport();panel.focus({preventScroll:true});
      background.forEach(item=>item.node.setAttribute('aria-hidden','true'));
    }
    function finishClose(){
      closing=null;opened=false;overlay.hidden=true;delete overlay.dataset.closing;
      background.forEach(item=>{item.node.inert=item.inert;if(item.aria===null)item.node.removeAttribute('aria-hidden');else item.node.setAttribute('aria-hidden',item.aria);});background=[];
      const previous=bodyStyle;if(previous){Object.keys(previous).filter(key=>key!=='scrollY').forEach(key=>doc.body.style[key]=previous[key]);w.scrollTo({top:previous.scrollY,behavior:'instant'});}
      scrolls.forEach(item=>{if(item.node.isConnected){item.node.scrollTop=item.top;item.node.scrollLeft=item.left;}});scrolls=[];
      const target=returnFocus&&returnFocus.isConnected&&!returnFocus.closest('[inert]')?returnFocus:doc.querySelector('#knTabWrap button, #knBottomNav button');
      if(target)target.focus({preventScroll:true});
    }
    function close(immediate=false){if(!opened||closing!==null)return;if(immediate||w.matchMedia&&w.matchMedia('(prefers-reduced-motion: reduce)').matches){finishClose();return;}overlay.dataset.closing='true';closing=w.setTimeout(finishClose,180);}
    let onClose=()=>close();
    closeButton.addEventListener('click',()=>onClose());refs.retry.addEventListener('click',()=>onRetry());
    overlay.addEventListener('click',event=>{if(event.target===overlay||event.target===backdrop)onClose();});
    function focusables(){return Array.from(panel.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]')).filter(node=>!node.closest('[hidden]')&&node.getClientRects().length);}
    doc.addEventListener('keydown',event=>{
      if(!opened||event.isComposing)return;
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();onClose();return;}
      if(event.key!=='Tab')return;
      event.stopImmediatePropagation();const all=focusables(),first=all[0],last=all[all.length-1];
      if(!first){event.preventDefault();panel.focus({preventScroll:true});}
      else if(event.shiftKey&&(doc.activeElement===first||!all.includes(doc.activeElement))){event.preventDefault();last.focus({preventScroll:true});}
      else if(!event.shiftKey&&(doc.activeElement===last||!all.includes(doc.activeElement))){event.preventDefault();first.focus({preventScroll:true});}
    },true);
    doc.addEventListener('focusin',event=>{if(opened&&!panel.contains(event.target))(focusables()[0]||panel).focus({preventScroll:true});},true);
    if(w.visualViewport){w.visualViewport.addEventListener('resize',sizeViewport);w.visualViewport.addEventListener('scroll',sizeViewport);}
    return {open,close,render,setClose(fn){onClose=fn;},isOpen:()=>opened,elements:{overlay,panel,content,numbers,closeButton,backdrop,...refs}};
  }
  function start(w){
    if(w.KNCompanyProfile&&w.KNCompanyProfile.__ready)return w.KNCompanyProfile;
    let view=null,current='',name='';
    let storage=null;try{storage=w.localStorage;}catch(e){}
    const loader=createLoader({fetch:w.fetch.bind(w),AbortController:w.AbortController,setTimeout:w.setTimeout.bind(w),clearTimeout:w.clearTimeout.bind(w),storage},state=>{if(view)view.render(state);});
    function close(){loader.cancel();if(view)view.close();}
    function open(value,label,trigger){
      const key=symbol(value);if(!key||!w.document.body)return false;
      if(!view){view=createDialog(w,()=>loader.load(current));view.setClose(close);}
      current=key;name=text(label,160)||key;view.open(key,name,trigger);loader.load(key);const state=loader.getState();if(state&&state.symbol===key)view.render(state);return true;
    }
    w.document.addEventListener('click',event=>{const target=event.target&&event.target.closest&&event.target.closest('[data-company-profile]');if(!target||target.disabled||target.getAttribute('aria-disabled')==='true'||!symbol(target.dataset.companyProfile))return;event.preventDefault();event.stopPropagation();open(target.dataset.companyProfile,target.dataset.companyName,target);},true);
    return {open,close,__ready:true};
  }
  return {symbol,safeUrl,day,month,timestamp,stamp,money,normalize,hasFacts,createLoader,createDialog,start,POLL_MS,POLL_LIMIT,REQUEST_TIMEOUT};
});

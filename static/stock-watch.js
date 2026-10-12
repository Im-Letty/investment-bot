/* Company search and browser-local favorites. Quote availability never gates saving. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./year-per.js'):root.KNYearPER);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document){root.StockWatch=api;api.start(root);}
})(typeof window==='undefined'?null:window,function(yearPers){
  'use strict';
  const KEY='alert_watchlist_v1', NAMES='stock_watch_names_v1', LIMIT=20;
  function symbol(value){
    const text=String(value||'').normalize('NFKC').trim().toUpperCase();
    if(/^[0-9][0-9A-Z]{3}$/.test(text))return text+'.T';
    return /^[A-Z0-9][A-Z0-9.^=-]{0,24}$/.test(text)?text:'';
  }
  function yearPerLine(item,dates,now){
    const fallback='有報の年度PER 未確認',key=symbol(item&&item.symbol);
    if(!/^[0-9][A-Z0-9]{3}\.(?:T|JP)$/.test(key))return '';
    return yearPers&&dates&&typeof dates.date==='function'?yearPers.line({...item,symbol:key},now):fallback;
  }
  function parse(value,fallback){try{return JSON.parse(value)||fallback;}catch(e){return fallback;}}
  function createStore(storage,persist,ready){
    let queue=Promise.resolve();
    const settled=Promise.resolve(ready);
    function list(){const data=parse(storage.getItem(KEY),[]);return Array.isArray(data)?Array.from(new Set(data.filter(x=>typeof x==='string').map(symbol).filter(Boolean))):[];}
    function names(){const data=parse(storage.getItem(NAMES),{});return data&&typeof data==='object'&&!Array.isArray(data)?data:{};}
    function name(key){const saved=names()[key];return typeof saved==='string'?saved:key;}
    function mutate(operation){const result=queue.then(()=>settled).then(operation);queue=result.catch(()=>{});return result;}
    const write=persist||((key,value)=>storage.setItem(key,value));
    return {list,name,ready:settled,
      add(item){return mutate(async()=>{
        const key=symbol(item&&item.symbol);
        if(!key||!item||item.verified!==true||typeof item.name!=='string'||!item.name.trim())return {status:'invalid'};
        const current=list();
        if(current.includes(key))return {status:'duplicate',symbol:key};
        if(current.length>=LIMIT)return {status:'limit'};
        // Persist the selection before reporting success. Names are optional display metadata.
        await write(KEY,JSON.stringify(current.concat(key)));
        try{const metadata=names();metadata[key]=item.name.slice(0,160);await write(NAMES,JSON.stringify(metadata));}catch(e){}
        return {status:'added',symbol:key};
      });},
      remove(value){return mutate(async()=>{const key=symbol(value);await write(KEY,JSON.stringify(list().filter(x=>x!==key)));return {status:'removed',symbol:key};});}
    };
  }
  function createSearch(w,onState){
    let sequence=0,controller=null,debounce=null,deadline=null;
    function cancel(){sequence++;if(controller)controller.abort();controller=null;w.clearTimeout(debounce);w.clearTimeout(deadline);debounce=deadline=null;}
    async function run(raw){
      cancel();const query=String(raw||'').normalize('NFKC').trim().slice(0,80),token=sequence;
      if(!query){onState({status:'idle',items:[]});return;}
      controller=new w.AbortController();const active=controller;
      onState({status:'loading',items:[]});
      try{
        const request=w.fetch('/api/lookup?q='+encodeURIComponent(query),{signal:active.signal}).then(response=>{if(!response.ok)throw new Error('lookup');return response.json();});
        const timeout=new Promise((resolve,reject)=>{deadline=w.setTimeout(()=>{active.abort();reject(new Error('timeout'));},10000);});
        const payload=await Promise.race([request,timeout]);
        if(token!==sequence)return;
        if(!payload||!Array.isArray(payload.results)||payload.error||payload.unavailable)throw new Error('lookup');
        const seen=new Set();const items=payload.results.filter(item=>{
          const key=symbol(item&&item.symbol);
          if(!key||item.verified!==true||typeof item.name!=='string'||!item.name.trim()||seen.has(key))return false;
          seen.add(key);return true;
        }).slice(0,20);
        onState({status:items.length?'results':'empty',items});
      }catch(e){if(token===sequence)onState({status:'error',items:[]});}
      finally{if(token===sequence){w.clearTimeout(deadline);deadline=null;controller=null;}}
    }
    return {run,cancel,schedule(query){cancel();onState({status:'idle',items:[]});debounce=w.setTimeout(()=>run(query),300);}};
  }
  function start(w){
    const doc=w.document;
    function init(){
      const manager=doc.getElementById('alert-section'),input=doc.getElementById('alert-ticker-input'),form=doc.getElementById('stock-search-form');
      if(!manager||!input||!form||manager.dataset.searchReady)return;
      manager.dataset.searchReady='true';
      const results=doc.getElementById('stock-search-results'),saved=doc.getElementById('alert-watchlist'),message=doc.getElementById('alert-msg'),count=doc.getElementById('stock-watch-count');
      const panel=manager.querySelector('.sw-sheet'),closeButton=doc.getElementById('stock-watch-close'),heading=doc.getElementById('stock-search-heading'),title=doc.getElementById('stock-watch-title');
      if(!panel||!closeButton)return;
      // Keep the dialog outside any home-view stacking context or inert ancestor.
      doc.body.appendChild(manager);
      const store=createStore(w.localStorage,w.__knPersistLocalSetting,w.__knGateReady);
      let state={status:'idle',items:[]},composing=false,opened=false,returnFocus=null,returnY=0,homeScroll=0,closeTimer=null,background=[],bodyOverflow='',bodyPadding='',homeOverflow='',backgroundScroll=null;
      function el(tag,className,text){const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
      function feedback(text,error){message.textContent=text;message.className='sw-feedback';message.dataset.error=error?'true':'false';}
      const dividendNodes=new Map();
      function paintDividends(key,value){
        const lines=dividendNodes.get(key);if(!lines)return;
        const text=w.KNWatchDividends.lines(value);
        lines[0].textContent=text.annual;lines[1].textContent=text.payment;
      }
      const dividendQueue=w.KNWatchDividends&&w.KNWatchDividends.createQueue&&w.KNWatchDividends.lines&&w.KNCompanyProfile&&w.KNCompanyProfile.createFactsLoader?
        w.KNWatchDividends.createQueue(callback=>w.KNCompanyProfile.createFactsLoader(callback),paintDividends):null;
      function syncDividends(){
        if(!dividendQueue)return;
        const shown=opened&&closeTimer===null&&!doc.hidden&&!composing&&state.status==='results';
        dividendQueue.select(Array.from(dividendNodes.keys()),shown);
        if(shown)for(const key of dividendNodes.keys())paintDividends(key,dividendQueue.peek(key));
      }
      function company(item){
        const box=el('button','sw-company');box.type='button';
        const key=symbol(item.symbol),regional=/^[0-9][A-Z0-9]{3}\.JP$/.test(key),hint=regional?'会社情報を見る':'会社情報・配当金を見る';
        box.appendChild(el('span','sw-name',item.name));box.appendChild(el('small','sw-code',key.replace(/\.(?:T|JP)$/,'')));
        box.appendChild(el('small','sw-company-hint',hint));
        box.setAttribute('aria-label',item.name+'の'+hint);
        box.addEventListener('click',()=>{
          if(!w.KNCompanyProfile||!w.KNCompanyProfile.open){feedback('会社情報を読み込めませんでした。ページを開き直してください。',true);return;}
          const trigger=returnFocus;
          // Release this sheet's inert/scroll locks before the profile takes over.
          w.closeStockWatchManager(true);
          w.KNCompanyProfile.open(symbol(item.symbol),item.name,trigger);
        });
        return box;
      }
      function notify(){if(w.__knRefreshWatch)w.__knRefreshWatch();}
      async function add(item,button){
        button.disabled=true;
        try{
          const result=await store.add(item);
          if(result.status==='added'){feedback('');button.textContent='追加済み';button.setAttribute('aria-label',item.name+' 追加済み');renderSaved();notify();}
          else if(result.status==='duplicate'){feedback('登録済みの銘柄です。');button.textContent='追加済み';button.setAttribute('aria-label',item.name+' 追加済み');}
          else{feedback(result.status==='limit'?'お気に入りは20件まで登録できます。':'検索結果から銘柄を選んでください。',true);button.disabled=false;}
        }catch(e){feedback('保存できませんでした。ブラウザの保存設定を確認して、もう一度お試しください。',true);button.disabled=false;}
      }
      function renderResults(next){
        state=next;dividendNodes.clear();results.replaceChildren();results.setAttribute('aria-busy',next.status==='loading'?'true':'false');
        if(heading)heading.hidden=next.status==='idle';
        const text={loading:'検索しています…',empty:'見つかりませんでした。会社名や銘柄コードを変えてみてください。',error:'検索できませんでした。少し待って、もう一度お試しください。'}[next.status];
        if(text){const note=el('p','sw-empty',text);note.setAttribute('role','status');results.appendChild(note);syncDividends();return;}
        if(!next.items.length){syncDividends();return;}
        const list=el('ul','sw-list');list.setAttribute('aria-label','銘柄の検索結果');
        const current=store.list();
        next.items.forEach(item=>{
          const key=symbol(item.symbol),row=el('li','sw-row');row.appendChild(company(item));
          const has=current.includes(key),button=el('button','sw-add',has?'追加済み':'お気に入りに追加');button.type='button';button.disabled=has;button.setAttribute('aria-label',item.name+(has?' 追加済み':'をお気に入りに追加'));button.addEventListener('click',()=>add(item,button));row.appendChild(button);
          // Preview a small set of Japanese companies. Every result keeps its full company information action.
          if(dividendQueue&&/^[0-9][A-Z0-9]{3}\.T$/.test(key)&&dividendNodes.size<5){
            const preview=el('div','sw-dividends'),annual=el('span','sw-dividend-line'),payment=el('span','sw-dividend-line');
            preview.appendChild(annual);preview.appendChild(payment);row.appendChild(preview);dividendNodes.set(key,[annual,payment]);paintDividends(key,dividendQueue.peek(key));
          }
          if(/^[0-9][A-Z0-9]{3}\.JP$/.test(key))row.appendChild(el('small','sw-dividend-line','会社情報は表示できます。株価・時価総額の取得元は未対応です。'));
          // These dated filing facts arrive with lookup; no per-company request is needed.
          const per=yearPerLine(item,w.KNDateDisplay);if(per)row.appendChild(el('small','sw-year-per',per));
          list.appendChild(row);
        });
        results.appendChild(list);syncDividends();
      }
      function renderSaved(){
        const current=store.list();count.textContent=current.length+'件';saved.replaceChildren();
        if(!current.length){saved.appendChild(el('p','sw-empty','まだ登録されていません'));return;}
        const list=el('ul','sw-list');
        current.forEach(key=>{const row=el('li','sw-row');row.appendChild(company({symbol:key,name:store.name(key)}));const button=el('button','sw-remove','削除');button.type='button';button.setAttribute('aria-label',store.name(key)+'をお気に入りから削除');button.addEventListener('click',async()=>{
          button.disabled=true;try{await store.remove(key);feedback('お気に入りから削除しました。');renderSaved();renderResults(state);notify();if(opened&&closeTimer===null){const next=saved.querySelector('button');(next||input).focus({preventScroll:true});}}catch(e){feedback('削除できませんでした。もう一度お試しください。',true);button.disabled=false;}
        });row.appendChild(button);list.appendChild(row);});saved.appendChild(list);
      }
      const search=createSearch(w,renderResults);
      input.addEventListener('compositionstart',()=>{composing=true;search.cancel();if(dividendQueue)dividendQueue.select([],false);});
      input.addEventListener('compositionend',()=>{composing=false;search.schedule(input.value);});
      input.addEventListener('input',()=>{if(!composing)search.schedule(input.value);});
      form.addEventListener('submit',event=>{event.preventDefault();if(!composing){feedback('');search.run(input.value);}});
      function sizeViewport(){
        if(!opened||!w.visualViewport)return;
        manager.style.setProperty('--sw-viewport-height',Math.round(w.visualViewport.height)+'px');
        manager.style.setProperty('--sw-viewport-top',Math.max(0,Math.round(w.visualViewport.offsetTop))+'px');
      }
      function freezeBackground(){
        background=Array.from(doc.body.children).filter(node=>node!==manager&&!['SCRIPT','STYLE','LINK'].includes(node.tagName)).map(node=>({node,inert:node.inert}));
        background.forEach(item=>{item.node.inert=true;});
        bodyOverflow=doc.body.style.overflow;bodyPadding=doc.body.style.paddingRight;
        const gutter=Math.max(0,w.innerWidth-doc.documentElement.clientWidth);
        if(gutter&&w.getComputedStyle)doc.body.style.paddingRight=(parseFloat(w.getComputedStyle(doc.body).paddingRight)||0)+gutter+'px';
        doc.body.style.overflow='hidden';
        const home=doc.getElementById('morning-section');homeOverflow=home?home.style.overflowY:'';if(home)home.style.overflowY='hidden';
      }
      w.openStockWatchManager=async function(options){
        options=options||{};
        if(closeTimer!==null){w.clearTimeout(closeTimer);closeTimer=null;}
        delete manager.dataset.closing;
        if(!opened){
          returnFocus=options.trigger||doc.activeElement;
          backgroundScroll=options.snapshot||(w.KNViewStability&&w.KNViewStability.capture(returnFocus));
          if(backgroundScroll&&w.KNViewStability)w.KNViewStability.hold(returnFocus,{snapshot:backgroundScroll});
          returnY=w.scrollY||0;const home=doc.getElementById('morning-section');homeScroll=home?home.scrollTop:0;
          freezeBackground();
        }
        opened=true;
        if(title)title.textContent=options.mode==='search'?'銘柄を検索':'お気に入り';
        const savedSection=doc.getElementById('stock-watch-saved');if(savedSection)savedSection.hidden=options.mode==='search';
        if(returnFocus)returnFocus.setAttribute('aria-expanded','true');
        sizeViewport();manager.style.display='flex';panel.focus({preventScroll:true});
        if(backgroundScroll)backgroundScroll.restore();
        if(input.value.trim()&&['idle','loading','error'].includes(state.status))search.run(input.value);
        syncDividends();
        try{await store.ready;renderSaved();}catch(e){feedback('保存済みの銘柄を読み込めませんでした。ページを開き直してください。',true);}
      };
      function finishClose(){
        closeTimer=null;opened=false;manager.style.display='none';delete manager.dataset.closing;
        background.forEach(item=>{item.node.inert=item.inert;});background=[];
        doc.body.style.overflow=bodyOverflow;doc.body.style.paddingRight=bodyPadding;
        const home=doc.getElementById('morning-section');if(home)home.style.overflowY=homeOverflow;
        if(returnFocus)returnFocus.setAttribute('aria-expanded','false');
        w.scrollTo({top:returnY,behavior:'instant'});
        if(home)home.scrollTop=homeScroll;
        const target=returnFocus&&returnFocus.isConnected?returnFocus:doc.querySelector('#knWatchSec button, #knTabWrap [data-kn-tab="favorites"]');
        if(target)target.focus({preventScroll:true});
        if(backgroundScroll){backgroundScroll.restore();if(w.KNViewStability)w.KNViewStability.hold(target,{snapshot:backgroundScroll});}
        backgroundScroll=null;
      }
      w.closeStockWatchManager=function(immediate){
        if(!opened)return;
        if(dividendQueue)dividendQueue.select([],false);
        if(immediate===true){if(closeTimer!==null)w.clearTimeout(closeTimer);search.cancel();finishClose();return;}
        if(closeTimer!==null)return;
        search.cancel();
        if(w.matchMedia&&w.matchMedia('(prefers-reduced-motion: reduce)').matches){finishClose();return;}
        manager.dataset.closing='true';closeTimer=w.setTimeout(finishClose,180);
      };
      closeButton.addEventListener('click',w.closeStockWatchManager);
      manager.addEventListener('click',event=>{if(event.target===manager||event.target.classList.contains('sw-backdrop'))w.closeStockWatchManager();});
      doc.addEventListener('keydown',event=>{
        if(!opened)return;
        if(event.key==='Escape'&&!composing&&!event.isComposing){event.preventDefault();w.closeStockWatchManager();return;}
        if(event.key!=='Tab')return;
        const focusable=Array.from(panel.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex="0"], a[href]')).filter(node=>!node.closest('[hidden]')&&node.getClientRects().length);
        const first=focusable[0],last=focusable[focusable.length-1];
        if(!first){event.preventDefault();panel.focus({preventScroll:true});return;}
        if(event.shiftKey&&(doc.activeElement===first||!focusable.includes(doc.activeElement))){event.preventDefault();last.focus({preventScroll:true});}
        else if(!event.shiftKey&&(doc.activeElement===last||!focusable.includes(doc.activeElement))){event.preventDefault();first.focus({preventScroll:true});}
      });
      doc.addEventListener('visibilitychange',syncDividends);
      if(w.visualViewport){w.visualViewport.addEventListener('resize',sizeViewport);w.visualViewport.addEventListener('scroll',sizeViewport);}
      // Compatibility entry points; selecting a verified result is the only way to add.
      w.openAlertSection=w.openStockWatchManager;
      w.addWatchTicker=()=>search.run(input.value);
      w.renderWatchlist=renderSaved;w.refreshWatchlist=async()=>{await store.ready;renderSaved();notify();};
      w.removeWatchTicker=async key=>{await store.remove(key);renderSaved();notify();};
      w.StockWatch.savedName=key=>store.name(key);
      store.ready.then(()=>{renderSaved();notify();}).catch(()=>{});
    }
    if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',init);else init();
  }
  return {symbol,yearPerLine,createStore,createSearch,start,LIMIT};
});

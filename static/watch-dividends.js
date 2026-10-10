/* Favorite dividends use the existing verified company facts, separately from prices. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./date-display.js'):root.KNDateDisplay);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document)root.KNWatchDividends={...api,...api.start(root)};
})(typeof window==='undefined'?null:window,function(dates){
  'use strict';
  const FRESH_MS=6*3600000,RETRY_MS=5*60000;
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const japanese=symbol=>/^[0-9][A-Z0-9]{3}\.T$/.test(symbol||'');
  function lines(state,now=Date.now()){
    const record=state&&state.data,data=record&&record.data||{},fields=record&&record.field_status||{},today=new Date(now+9*3600000).toISOString().slice(0,10);
    const known=fields.annual_dividend!=='invalid'&&data.annual_dividend_basis==='trailing_12m'&&typeof data.annual_dividend==='number'&&Number.isFinite(data.annual_dividend)&&data.annual_dividend>=0;
    const currency={JPY:'円',USD:'米ドル',EUR:'ユーロ',GBP:'英ポンド'}[data.currency];
    const annual=known&&currency?data.annual_dividend.toLocaleString('ja-JP',{maximumFractionDigits:2})+currency:state&&state.updating?'確認中…':'未確認';
    let payment='支払予定 '+(state&&state.updating?'確認中…':'未確認');
    if(fields.dividend_payment_date!=='invalid'){
      if(dates.date(data.dividend_payment_date)&&data.dividend_payment_date>=today)payment=dates.label(data.dividend_payment_date,'支払予定',false);
      else if(/^\d{4}-(?:0[1-9]|1[0-2])$/.test(data.dividend_payment_period||'')&&data.dividend_payment_period>=today.slice(0,7)&&(!dates.date(data.dividend_payment_date)||data.dividend_payment_period!==data.dividend_payment_date.slice(0,7)))payment=data.dividend_payment_period.replace('-','/')+' 支払予定（日付未確認）';
    }
    return {annual:'過去1年の配当（1株） '+annual,payment};
  }
  function markup(state,now){
    const text=lines(state,now);
    return '<span>'+escape(text.annual)+'</span><span>'+escape(text.payment)+'</span>';
  }
  function createQueue(makeLoader,onChange,now=Date.now){
    const saved=new Map(),completed=new Map();let selected=new Set(),visible=false,queue=[];
    const workers=Array.from({length:2},()=>({symbol:'',loader:null}));
    function peek(key){
      if(!japanese(key))return null;
      if(saved.has(key))return saved.get(key);
      for(const worker of workers){const record=worker.loader.peek(key);if(record)return {symbol:key,data:record,fromCache:true,updating:false};}
      return null;
    }
    function fresh(key){const finish=completed.get(key);return finish&&now()-finish.at<(finish.failed?RETRY_MS:FRESH_MS);}
    function pump(){
      if(!visible)return;
      for(const worker of workers){
        if(worker.symbol)continue;
        const key=queue.shift();if(!key)break;
        worker.symbol=key;worker.loader.load(key);
      }
    }
    workers.forEach(worker=>{
      worker.loader=makeLoader(state=>{
        if(!visible||state.symbol!==worker.symbol||!selected.has(state.symbol))return;
        saved.set(state.symbol,state);onChange(state.symbol,state);
        if(!state.updating){
          const key=worker.symbol;
          completed.set(key,{at:now(),failed:state.status==='error'||state.status==='stale'});
          // Finish the loader's current request before reusing its worker.
          Promise.resolve().then(()=>{if(worker.symbol===key){worker.symbol='';pump();}});
        }
      });
    });
    function select(symbols,shown){
      visible=!!shown;selected=new Set(symbols.filter(japanese).slice(0,20));
      for(const worker of workers)if(worker.symbol&&(!visible||!selected.has(worker.symbol))){
        const key=worker.symbol;worker.loader.cancel();worker.symbol='';
        const state=saved.get(key);if(state)saved.set(key,{...state,updating:false});
      }
      const active=new Set(workers.map(worker=>worker.symbol));
      queue=visible?[...selected].filter(key=>!active.has(key)&&!fresh(key)):[];
      pump();
    }
    return {select,peek};
  }
  function start(w){
    if(!w.KNCompanyProfile||!w.KNCompanyProfile.createFactsLoader)return {};
    const doc=w.document;
    const rows=()=>{const section=doc.getElementById('knWatchSec');return section?[...section.querySelectorAll('[data-watch-dividend]')]:[];};
    function paint(key,state){for(const row of rows())if(row.dataset.watchDividend===key){const html=markup(state);if(row.innerHTML!==html)row.innerHTML=html;}}
    const queue=createQueue(callback=>w.KNCompanyProfile.createFactsLoader(callback),paint);
    function refresh(){
      const wrap=doc.getElementById('knTabWrap'),section=doc.getElementById('knWatchSec');
      const shown=!doc.hidden&&wrap&&wrap.dataset.stockMain==='favorites'&&section&&section.getClientRects().length>0,items=rows();
      queue.select(items.map(row=>row.dataset.watchDividend),shown);
      if(shown)for(const row of items)paint(row.dataset.watchDividend,queue.peek(row.dataset.watchDividend));
    }
    doc.addEventListener('knStockViewChanged',refresh);
    doc.addEventListener('visibilitychange',refresh);
    doc.addEventListener('click',event=>{if(event.target&&event.target.closest&&event.target.closest('#knTabWrap [data-kn-tab]'))w.setTimeout(refresh,0);});
    if(w.MutationObserver){
      const observer=new w.MutationObserver(refresh);
      for(const target of [doc.body,doc.getElementById('morning-section')])if(target)observer.observe(target,{attributes:true,attributeFilter:['style','hidden','class']});
    }
    return {peek:queue.peek,refresh};
  }
  return {lines,markup,createQueue,start,FRESH_MS,RETRY_MS};
});

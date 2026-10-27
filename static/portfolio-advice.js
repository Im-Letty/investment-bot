/* Portfolio facts are calculated locally. External AI is explicit, private and opt-in. */
(function(root,factory){
  'use strict';
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else {root.KNPortfolioAdvice=api;api.mount(root);}
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  var categories={
    '現金':['cash','現金・預金'],'現金・預金':['cash','現金・預金'],
    '国内株':['domestic_stock','国内株'],'米国株':['us_stock','米国株'],
    '投資信託':['mutual_fund','投資信託'],'ETF':['etf','ETF'],'債券':['bond','債券'],
    '不動産':['real_estate','不動産'],'仮想通貨':['crypto','仮想通貨']
  };
  function normaliseContext(value){
    if(value===undefined||value===null)value={};
    if(typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(function(k){return ['monthly_expense','horizon','loss_tolerance'].indexOf(k)<0;}))throw Error('invalid_context');
    var context=Object.assign({monthly_expense:null,horizon:'unknown',loss_tolerance:'unknown'},value);
    if(context.monthly_expense!==null&&(typeof context.monthly_expense!=='number'||!Number.isFinite(context.monthly_expense)||context.monthly_expense<0||context.monthly_expense>Number.MAX_SAFE_INTEGER))throw Error('invalid_context');
    if(['unknown','under_3','3_10','over_10'].indexOf(context.horizon)<0||['unknown','low','medium','high'].indexOf(context.loss_tolerance)<0)throw Error('invalid_context');
    return context;
  }
  function parseMonthlyExpense(value){
    var text=String(value).normalize('NFKC').trim();
    if(!text)return null;
    if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text))throw Error('invalid_context');
    var amount=Number(text.replace(/,/g,''));
    return normaliseContext({monthly_expense:amount}).monthly_expense;
  }
  function sum(values){
    var parts=values.map(function(n){var b=String(n).toLowerCase().split('e'),f=(b[0].split('.')[1]||'').length;return {n:BigInt(b[0].replace('.','')),scale:f-Number(b[1]||0)};});
    var scale=parts.reduce(function(n,x){return Math.max(n,x.scale);},0);
    var value=Number(String(parts.reduce(function(n,x){return n+x.n*10n**BigInt(scale-x.scale);},0n))+'e-'+scale);
    if(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER)throw Error('invalid_assets');
    return value;
  }
  function analyse(raw,value){
    if(raw!==null&&typeof raw!=='string')throw Error('invalid_assets');
    var context=normaliseContext(value),rows=raw===null?[]:JSON.parse(raw);
    if(!Array.isArray(rows)||rows.length>5000)throw Error('invalid_assets');
    var groups=new Map(),negative=false,amounts=[];
    rows.forEach(function(row){
      if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.amount!=='number'||!Number.isFinite(row.amount)||Math.abs(row.amount)>Number.MAX_SAFE_INTEGER)throw Error('invalid_assets');
      var category=typeof row.cat==='string'&&Object.prototype.hasOwnProperty.call(categories,row.cat)?categories[row.cat]:['other','その他・未分類'];
      if(!groups.has(category[0]))groups.set(category[0],{key:category[0],label:category[1],values:[]});
      groups.get(category[0]).values.push(row.amount);amounts.push(row.amount);negative=negative||row.amount<0;
    });
    var total=sum(amounts),ratios=!negative&&total>0,cash=0;
    var list=Array.from(groups.values(),function(g){var amount=sum(g.values);if(g.key==='cash')cash=amount;return {key:g.key,label:g.label,amount:amount,percent:ratios?amount/total*100:null};});
    list.sort(function(a,b){return b.amount-a.amount;});
    var months=ratios&&context.monthly_expense>0?cash/context.monthly_expense:null;
    return {total:total,count:rows.length,negative:negative,groups:list,cash:cash,monthsOfExpenses:months!==null&&Number.isFinite(months)?months:null,largestEntryPercent:ratios?Math.max.apply(null,amounts)/total*100:null};
  }
  function validResult(data){
    function text(s,n){return typeof s==='string'&&s.trim().length>0&&s.length<=n;}
    function strings(a,n,max){return Array.isArray(a)&&a.length<=max&&a.every(function(s){return text(s,n);});}
    if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(function(k){return ['summary','risks','actions','questions'].indexOf(k)<0;})||
      !text(data.summary,400)||!Array.isArray(data.risks)||data.risks.length<1||data.risks.length>3||
      !data.risks.every(function(r){return r&&Object.keys(r).length===2&&text(r.title,80)&&text(r.detail,300);})||
      !strings(data.actions,300,3)||data.actions.length<1||!strings(data.questions,300,3))throw Error('invalid_response');
    return JSON.parse(JSON.stringify(data));
  }
  function createSession(options){
    var epoch=0,readVersion=0,owner='',raw,alive=true,checkedOwner='',requestController=null;
    var state={facts:null,context:normaliseContext(),ready:false,busy:false,result:null,error:'',stale:false};
    function emit(){if(alive&&options.onChange)options.onChange(getState());}
    function getState(){return JSON.parse(JSON.stringify(state));}
    function active(who,version){return alive&&who&&who===owner&&who===options.owner()&&epoch===version;}
    function abort(){if(requestController)requestController.abort();requestController=null;}
    function invalidate(){epoch++;abort();state.stale=state.stale||!!state.result||state.busy;state.result=null;state.busy=false;}
    function reset(who){
      invalidate();readVersion++;owner=who;raw=undefined;checkedOwner='';
      state={facts:null,context:normaliseContext(),ready:false,busy:false,result:null,error:'',stale:false};
    }
    async function refresh(){
      var who=options.owner()||'';
      if(who!==owner){reset(who);emit();}
      if(!who){emit();return false;}
      var load=++readVersion;
      function currentLoad(){return alive&&who&&who===owner&&who===options.owner()&&readVersion===load;}
      try{
        var next=await options.read(who);
        if(!currentLoad())return false;
        if(next!==raw){invalidate();raw=next;}
        state.facts=analyse(raw,state.context);state.error='';emit();
        if(checkedOwner!==who){
          try{
            var status=await options.status();
            if(!currentLoad())return false;
            state.ready=!!(status&&status.ok===true&&status.ready===true);checkedOwner=who;
          }catch(ignore){if(!currentLoad())return false;state.ready=false;}
          emit();
        }
        return true;
      }catch(ignore){
        if(currentLoad()){invalidate();checkedOwner='';state.facts=null;state.ready=false;state.error='records_unavailable';emit();}
        return false;
      }
    }
    function setContext(value){
      var context=normaliseContext(value);
      if(JSON.stringify(context)===JSON.stringify(state.context))return;
      invalidate();state.context=context;state.error='';
      try{state.facts=raw===undefined?null:analyse(raw,context);}catch(ignore){state.facts=null;state.error='records_unavailable';}
      emit();
    }
    async function run(consent){
      if(!alive||!consent||!state.ready||state.busy||!state.facts||state.facts.negative||state.facts.total<=0||owner!==options.owner())return false;
      var who=owner,version=++epoch,snapshot=raw,context=normaliseContext(state.context);
      state.busy=true;state.result=null;state.error='';state.stale=false;
      requestController=typeof AbortController==='function'?new AbortController():null;var controller=requestController;emit();
      try{
        var digest=await options.digest(snapshot===null?'null':snapshot);
        if(!active(who,version))return false;
        var beforeSend=await options.read(who);
        if(!active(who,version))return false;
        if(beforeSend!==snapshot){await refresh();return false;}
        var response=await options.request({lang:'ja',consent:true,expected_assets_sha256:digest,context:context},controller&&controller.signal);
        if(!active(who,version)||raw!==snapshot)return false;
        var afterResponse=await options.read(who);
        if(!active(who,version))return false;
        if(afterResponse!==snapshot){await refresh();return false;}
        if(!response||response.ok!==true){
          var allowed=['monthly_limit','daily_limit','global_limit','stale_assets','not_configured','disabled','paid_confirmation_required','quota_unavailable','provider_unavailable','auth_required','invalid_assets','invalid_response'];
          state.error=response&&allowed.indexOf(response.error)>=0?response.error:'analysis_unavailable';return false;
        }
        state.result=validResult(response.data);state.stale=false;return true;
      }catch(ignore){if(active(who,version))state.error='analysis_unavailable';return false;}
      finally{if(active(who,version)){state.busy=false;requestController=null;emit();}}
    }
    function destroy(){alive=false;readVersion++;invalidate();owner='';raw=undefined;state={facts:null,context:normaliseContext(),ready:false,busy:false,result:null,error:'',stale:false};}
    return {refresh:refresh,setContext:setContext,run:run,cancel:function(){invalidate();emit();},destroy:destroy,getState:getState};
  }

  function mount(w){
    var document=w.document;if(!document)return;
    function setup(){
      var pane=document.getElementById('tab-assets');if(!pane||document.getElementById('kkPortfolioAdvice'))return;
      function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
      function owner(){
        try{
          var session=w.knLedgerSession,id=session&&session.user&&String(session.user.id);
          if(!id||!session.access_token||w.localStorage.getItem('kn_ledger_owner')!==id)return '';
          if(w.parent!==w&&(w.parent.location.origin!==w.location.origin||!w.parent.knUser||String(w.parent.knUser.id)!==id))return '';
          return id;
        }catch(ignore){return '';}
      }
      var panel=el('section','card pa-panel');panel.id='kkPortfolioAdvice';panel.setAttribute('aria-labelledby','paTitle');
      var header=el('div','pa-heading'),title=el('h2','','資産の見直し・AIアドバイス');title.id='paTitle';header.appendChild(title);
      var info=el('details','pa-info'),toggle=el('summary','','！');toggle.setAttribute('aria-label','分析について');
      info.appendChild(toggle);info.appendChild(el('p','','登録した評価額をもとにした参考情報です。価格は自動更新されません。銘柄の中身・負債・為替・将来の値動きまでは判断できません。AIの説明には誤りが含まれることがあります。大切な判断は専門家にもご相談ください。'));header.appendChild(info);panel.appendChild(header);
      var notice=el('p','pa-notice');notice.setAttribute('role','status');panel.appendChild(notice);
      var facts=el('div','pa-facts');panel.appendChild(facts);
      var ai=el('div','pa-ai');ai.appendChild(el('h3','','AIと見直す'));
      var availability=el('p','pa-caption');ai.appendChild(availability);
      var consentLabel=el('label','pa-consent'),consent=el('input');consent.type='checkbox';consentLabel.appendChild(consent);
      consentLabel.appendChild(el('span','','18歳以上です。資産カテゴリ別の集計をGoogle Geminiに送信して分析します。登録名やメモは送信しません。'));ai.appendChild(consentLabel);
      var run=el('button','pa-run','AIで分析する');run.type='button';ai.appendChild(run);
      var output=el('div','pa-result');output.setAttribute('aria-live','polite');ai.appendChild(output);panel.appendChild(ai);pane.appendChild(panel);
      var currentOwner='';
      function money(n){return new Intl.NumberFormat('ja-JP',{maximumFractionDigits:20}).format(n)+'円';}
      function pct(n){return new Intl.NumberFormat('ja-JP',{maximumFractionDigits:1}).format(n)+'%';}
      function metric(label,value){var n=el('div','pa-metric');n.appendChild(el('span','',label));n.appendChild(el('strong','',value));facts.appendChild(n);}
      var messages={
        records_unavailable:'記録を確認できませんでした。元の記録を保ったまま、再読み込みしてお試しください。',
        daily_limit:'今日のAI分析は利用済みです。同じ内容での再実行を控え、明日ご確認ください。',
        monthly_limit:'今月のAI分析の利用上限に達しました。',global_limit:'現在、AI分析の利用上限に達しています。',
        stale_assets:'資産の同期がまだ完了していません。同期後にもう一度お試しください。',
        auth_required:'非公開の接続を確認できません。マイページを開き直してください。',
        invalid_assets:'入力額を確認できないため、AI分析を行いませんでした。',
        invalid_response:'AIの説明を確認できませんでした。今回の結果は表示していません。',
        analysis_unavailable:'AI分析を完了できませんでした。自動で再実行はしません。'
      };
      function paint(state){
        var who=owner();
        if(currentOwner!==who){currentOwner=who;consent.checked=false;}
        facts.replaceChildren();output.replaceChildren();
        var f=state.facts;
        notice.textContent=messages[state.error]||(state.error?'AI分析を利用できません。':state.stale?'記録が変わりました。必要に応じてもう一度分析してください。':!f?'資産記録を確認しています。':!f.count?'資産を追加すると分析できます。':f.negative||f.total<=0?'分析するには、登録額をご確認ください。':'');
        notice.hidden=!notice.textContent;
        if(f&&f.count){
          var first=f.groups[0];
          metric('登録額の合計',money(f.total));
          metric('最大のカテゴリ',first.label+(first.percent===null?'（割合未算定）':' '+pct(first.percent)));
          metric('1つの登録項目の最大割合',f.largestEntryPercent===null?'未算定':pct(f.largestEntryPercent));
        }
        availability.textContent=state.ready?'分析ボタンを押したときだけ送信します。':'AI分析は準備中です。';
        consentLabel.hidden=!state.ready;consent.disabled=!state.ready||state.busy;
        run.disabled=!state.ready||state.busy||!consent.checked||!f||f.negative||f.total<=0;
        run.textContent=state.busy?'分析しています…':'AIで分析する';run.setAttribute('aria-busy',String(state.busy));
        if(state.result){
          output.appendChild(el('p','pa-generated','AIによる参考情報'));
          output.appendChild(el('p','pa-summary',state.result.summary));
          output.appendChild(el('h4','','確認したいリスク'));
          state.result.risks.forEach(function(r){var n=el('div','pa-risk');n.appendChild(el('strong','',r.title));n.appendChild(el('p','',r.detail));output.appendChild(n);});
          [['見直しの候補',state.result.actions],['追加で考えたいこと',state.result.questions]].forEach(function(row){
            if(!row[1].length)return;output.appendChild(el('h4','',row[0]));var list=el('ul');row[1].forEach(function(t){list.appendChild(el('li','',t));});output.appendChild(list);
          });
        }
      }
      async function http(path,body,signal){
        var session=w.knLedgerSession;
        if(!owner()||!session)return {ok:false,error:'auth_required'};
        var controller=typeof w.AbortController==='function'?new w.AbortController():null;
        var timer=controller?w.setTimeout(function(){controller.abort();},35000):null;
        var cancelled=function(){if(controller)controller.abort();};
        if(signal)signal.addEventListener('abort',cancelled,{once:true});
        try{
          var response=await w.fetch(path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},body:body?JSON.stringify(body):undefined,signal:controller?controller.signal:signal,cache:'no-store'});
          var text=await response.text();if(text.length>64000)throw Error('invalid_response');
          var data=JSON.parse(text);if(!response.ok&&data.ok!==false)return {ok:false,error:'analysis_unavailable'};return data;
        }finally{if(timer)w.clearTimeout(timer);if(signal)signal.removeEventListener('abort',cancelled);}
      }
      var session=createSession({
        owner:owner,
        read:async function(who){if(!w.kkMyPageStore)throw Error('records_unavailable');var record=await w.kkMyPageStore.load(who);return record.assetsRaw;},
        status:function(){return http('/api/portfolio-advice/status');},
        request:function(payload,signal){return http('/api/portfolio-advice',payload,signal);},
        digest:async function(raw){var data=await w.crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));return Array.from(new Uint8Array(data),function(b){return b.toString(16).padStart(2,'0');}).join('');},
        onChange:paint
      });
      consent.addEventListener('change',function(){paint(session.getState());});
      run.addEventListener('click',function(){session.run(consent.checked);});
      w.addEventListener('knMyPageStoreChange',function(){session.refresh();});
      w.addEventListener('knLedgerAuth',function(){session.refresh();});
      w.addEventListener('storage',function(e){if(!e.key||e.key==='kb2_assets'||e.key==='kn_ledger_owner')session.refresh();});
      if(w.parent!==w)try{w.parent.document.addEventListener('knAuthChange',function(){session.refresh();});}catch(ignore){}
      w.addEventListener('pagehide',function(event){if(event.persisted)session.cancel();else session.destroy();});
      w.addEventListener('pageshow',function(event){if(event.persisted)session.refresh();});
      session.refresh();
    }
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
  }
  return {analyse:analyse,parseMonthlyExpense:parseMonthlyExpense,normaliseContext:normaliseContext,validResult:validResult,createSession:createSession,mount:mount};
});

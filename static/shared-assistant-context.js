/* Optional owner-scoped summary memory and separately consented safe site aggregates. */
(function(root,factory){
  'use strict';var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.KNSharedAssistantContext=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  var KEY='kb2_assistant_memory_v1',LIMIT=1200;
  function empty(){return {version:1,enabled:false,summary:''};}
  function validText(text){return typeof text==='string'&&text.length<=LIMIT&&!/[\u0000-\u0008\u000b-\u001f\u007f]/.test(text);}
  function decode(raw){
    if(raw===null)return empty();if(typeof raw!=='string'||raw.length>16000)throw Error('memory_format');var d=JSON.parse(raw);
    if(!d||Array.isArray(d)||Object.keys(d).sort().join(',')!=='enabled,summary,version'||d.version!==1||typeof d.enabled!=='boolean'||!validText(d.summary))throw Error('memory_format');
    return {version:1,enabled:d.enabled,summary:d.summary};
  }
  function encode(enabled,summary){if(typeof enabled!=='boolean'||!validText(summary))throw Error('memory_format');return JSON.stringify({version:1,enabled:enabled,summary:summary.trim()});}
  function createSession(options){
    var owner='',epoch=0,serial=0,raw,doc=empty(),ready=false,busy=false,proposal=null,error='',factsOnce=false;
    function current(){return !!owner&&owner===options.owner();}
    function state(){return current()?{owner:owner,epoch:epoch,raw:raw,ready:ready,busy:busy,enabled:doc.enabled,summary:doc.summary,proposal:proposal,error:error,factsOnce:factsOnce}:{owner:'',epoch:epoch,raw:undefined,ready:false,busy:false,enabled:false,summary:'',proposal:null,error:'',factsOnce:false};}
    function emit(){if(options.onChange)options.onChange(state());}
    function reset(){owner=options.owner()||'';epoch++;serial++;raw=undefined;doc=empty();ready=false;busy=false;proposal=null;error='';factsOnce=false;emit();}
    async function refresh(){
      if(owner!==(options.owner()||''))reset();if(!owner){emit();return false;}var who=owner,generation=epoch,token=++serial;
      try{var next=await options.read(who);if(!current()||epoch!==generation||token!==serial)return false;var value=decode(next);
        if(raw!==next)proposal=null;raw=next;doc=value;ready=true;error='';emit();return true;
      }catch(e){if(current()&&epoch===generation&&token===serial){ready=false;proposal=null;error=e&&e.message==='memory_not_ready'?'':'記憶を読み込めませんでした。保存済みの内容は変更していません。';emit();}return false;}
    }
    async function update(enabled,summary){
      if(!current()||!ready||busy)throw Error('memory_not_ready');var who=owner,generation=epoch,base=raw,next=encode(enabled,summary);busy=true;error='';emit();
      try{var result=await options.write(who,base,next);if(!current()||epoch!==generation)throw Error('memory_owner_changed');
        if(!result||result.ok!==true)throw Error('memory_save_failed');var latest=await options.read(who);if(!current()||epoch!==generation)throw Error('memory_owner_changed');if(latest!==next)throw Error('memory_changed');raw=next;doc=decode(next);proposal=null;emit();return {ok:true,synced:result.synced===true};
      }catch(e){if(current()&&epoch===generation){error=e&&e.message==='memory_changed'?'記憶が別の操作で更新されています。再読み込みして確認してください。':'保存できませんでした。入力内容は残しています。';emit();}throw e;}
      finally{if(current()&&epoch===generation){busy=false;emit();}}
    }
    function propose(text,snapshot){if(!validText(text)||!text.trim()||!snapshot||!current()||snapshot.owner!==owner||snapshot.epoch!==epoch||snapshot.raw!==raw||!ready||!doc.enabled)return false;proposal=text.trim();emit();return true;}
    return {state:state,refresh:refresh,reset:reset,update:update,forget:async function(){var result=await update(false,'');factsOnce=false;emit();return result;},propose:propose,setFactsOnce:function(value){if(!current()||!ready||typeof value!=='boolean')return false;factsOnce=value;emit();return true;},dismiss:function(){proposal=null;emit();}};
  }
  var categories={現金:'cash','現金・預金':'cash',預金:'cash',国内株:'domestic_stock',日本株:'domestic_stock',米国株:'us_stock',投資信託:'investment_fund',ETF:'etf',債券:'bond',不動産:'real_estate',仮想通貨:'crypto',暗号資産:'crypto'};
  function number(value){if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER)throw Error('context_invalid');return value;}
  function exactSum(values){
    var parts=values.map(function(v){number(v);var b=String(v).toLowerCase().split('e'),m=b[0];return {n:BigInt(m.replace('.','')),scale:(m.split('.')[1]||'').length-Number(b[1]||0)};}),scale=parts.reduce(function(n,p){return Math.max(n,p.scale);},0);
    return number(Number(String(parts.reduce(function(n,p){return n+p.n*10n**BigInt(scale-p.scale);},0n))+'e-'+scale));
  }
  function siteFacts(record,monthRows,now){
    var day=new Date((now===undefined?Date.now():now)+9*3600000).toISOString().slice(0,10),assets=null,target=null,household=null;
    if(record.assetsRaw!==null){var rows=JSON.parse(record.assetsRaw),groups=new Map();if(!Array.isArray(rows)||rows.length>5000)throw Error('context_invalid');rows.forEach(function(r){if(!r||typeof r!=='object'||Array.isArray(r))throw Error('context_invalid');number(r.amount);var kind=Object.prototype.hasOwnProperty.call(categories,r.cat)?categories[r.cat]:'other';if(!groups.has(kind))groups.set(kind,[]);groups.get(kind).push(r.amount);});assets={total:exactSum(rows.map(function(r){return r.amount;})),count:rows.length,categories:Array.from(groups,function(g){return {kind:g[0],amount:exactSum(g[1])};})};}
    if(record.raw!==null){var planner=JSON.parse(record.raw);if(!planner||planner.version!==1||!Array.isArray(planner.goals))throw Error('context_invalid');if(Object.prototype.hasOwnProperty.call(planner,'assetTarget'))target=planner.assetTarget;else{var goal=planner.goals.find(function(g){return g&&g.id===planner.selectedGoalId;})||planner.goals.find(function(g){return g&&typeof g.target==='number'&&g.target>0;});target=goal&&goal.target!==undefined?goal.target:null;}if(target!==null&&number(target)<=0)throw Error('context_invalid');}
    if(!Array.isArray(monthRows)||monthRows.length>5000)throw Error('context_invalid');if(!monthRows._kkUnreadable){var income=[],expense=[],investment=[];monthRows.forEach(function(r){if(!r||!['inc','exp','inv'].includes(r.type))throw Error('context_invalid');number(r.amount);(r.type==='inc'?income:r.type==='exp'?expense:investment).push(r.amount);});household={month:day.slice(0,7),income:exactSum(income),expense:exactSum(expense),investment:exactSum(investment),record_count:monthRows.length};}
    return {version:1,consent:true,as_of:day,currency:'JPY',assets:assets,goal_target:target,household:household};
  }
  function createFrameAdapter(w,getFrame){
    var revision=0;
    function owner(){return w.knUser&&w.knUser.id?String(w.knUser.id):'';}
    function checked(who){
      var frame=getFrame(),c=frame&&frame.contentWindow;
      try{if(!who||who!==owner()||!c||c.location.origin!==w.location.origin||!/^\/kakeibo(?:\.html)?$/.test(c.location.pathname)||!c.kkMyPageStore||!c.knLedgerSession||!c.knLedgerSession.access_token||!c.knLedgerSession.user||String(c.knLedgerSession.user.id)!==who||c.localStorage.getItem('kn_ledger_owner')!==who)throw Error('memory_owner_changed');return c;}
      catch(ignore){throw Error('memory_not_ready');}
    }
    async function loaded(who){var generation=revision,c=checked(who);await c.kkMyPageStore.load(who);if(generation!==revision||c!==checked(who))throw Error('memory_owner_changed');return c;}
    return {owner:owner,invalidate:function(){revision++;},read:async function(who){var c=await loaded(who);if(!c.kkAssistantMemoryStore)throw Error('memory_not_ready');return c.kkAssistantMemoryStore.load(who);},
      write:async function(who,base,next){decode(next);var generation=revision,c=await loaded(who);if(!c.kkAssistantMemoryStore)throw Error('memory_not_ready');var result=await c.kkAssistantMemoryStore.write(who,base,next);if(generation!==revision||c!==checked(who))throw Error('memory_owner_changed');return result;},
      facts:async function(who,now){now=now===undefined?Date.now():now;var generation=revision,c=await loaded(who),record=await c.kkMyPageStore.load(who);if(generation!==revision||c!==checked(who))throw Error('memory_owner_changed');var day=new Date((now===undefined?Date.now():now)+9*3600000).toISOString().slice(0,10);if(typeof c.getData!=='function')throw Error('context_invalid');var value=siteFacts(record,c.getData(Number(day.slice(0,4)),Number(day.slice(5,7))),now);if(generation!==revision||c!==checked(who))throw Error('memory_owner_changed');return value;},
      token:function(who){return checked(who).knLedgerSession.access_token;}};
  }
  function createController(w,options){
    options=options||{};var d=w.document,views=[],destroyed=false,frame=options.frame||function(){return d.querySelector('#myPageOv .kb-frame');},adapter=options.adapter||createFrameAdapter(w,frame),bound=new WeakSet(),observedOwner=adapter.owner(),chatBusy=false,chatTicket=0;
    var session=createSession({owner:adapter.owner,read:adapter.read,write:adapter.write,onChange:function(s){views.forEach(function(v){paint(v,s);});if(options.onChange)options.onChange(s);}});
    function node(tag,cls,text){var n=d.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
    function button(text,fn){var n=node('button','kn-am-button',text);n.type='button';n.addEventListener('click',fn);return n;}
    function paint(v,s){
      if(v.owner!==s.owner){v.owner=s.owner;v.dirty=false;v.proposalDirty=false;v.proposalText=null;v.summary.value='';v.enabled.checked=false;v.candidate.value='';v.notice.textContent='';}v.facts.checked=!!s.factsOnce;
      if(!v.dirty){v.summary.value=s.summary;v.enabled.checked=s.enabled;}
      [v.summary,v.enabled,v.facts,v.save,v.forget].forEach(function(n){n.disabled=!s.ready||s.busy;});v.retry.disabled=s.busy;
      v.status.textContent=s.error||(!s.ready?'マイページで非公開接続を準備すると、要点を保存できます。':s.enabled?'相談ロボットと先生AIで、保存した要点を使います。':'記憶はOFFです。会話の要点を自動送信しません。');
      v.proposalBox.hidden=!s.proposal;if(s.proposal!==v.proposalText){v.proposalText=s.proposal;v.proposalDirty=false;v.candidate.value=s.proposal||'';}
      v.confirm.disabled=!s.ready||s.busy;v.dismiss.disabled=s.busy;
    }
    function mount(host){
      if(!host||destroyed)return null;var box=node('details','kn-assistant-memory'),title=node('summary','','会話の要点を記憶');box.appendChild(title);
      var body=node('div','kn-am-body'),status=node('p','kn-am-status');status.setAttribute('role','status');body.appendChild(status);
      var label=node('label','kn-am-opt'),enabled=node('input');enabled.type='checkbox';label.appendChild(enabled);label.appendChild(node('span','','会話の要点を覚えて相談に使う（任意）'));body.appendChild(label);
      body.appendChild(node('p','kn-am-caption','ONにすると、確認して保存した要点を相談ロボット・先生AIのAnthropicへ送ります。返信と同じ1回の処理で更新候補を作り、確認してから保存できます。'));
      var summaryLabel=node('label','kn-am-label','覚えておく要点'),summary=node('textarea');summary.maxLength=LIMIT;summary.rows=4;summary.setAttribute('aria-label','覚えておく会話の要点');summaryLabel.appendChild(summary);body.appendChild(summaryLabel);
      body.appendChild(node('p','kn-am-caption','希望や相談中の課題を短くまとめてください。氏名、銘柄名、金額、口座、連絡先などは含めないでください。資産・自由メモ・別画面の記録を自動で送ることはありません。'));
      var factsLabel=node('label','kn-am-opt'),facts=node('input');facts.type='checkbox';factsLabel.appendChild(facts);factsLabel.appendChild(node('span','','次の相談に資産・目標・今月家計の集計を使う（Anthropicへ送信）'));body.appendChild(factsLabel);body.appendChild(node('p','kn-am-caption','集計は相談ごとに新しく確認し、この1回だけ送ります。名前・銘柄名・取引内容・メモは含めず、金額を記憶には保存しません。'));facts.addEventListener('change',function(){session.setFactsOnce(facts.checked);});
      var actions=node('div','kn-am-actions'),notice=node('p','kn-am-status');notice.setAttribute('role','status');
      var view={owner:'',box:box,enabled:enabled,facts:facts,summary:summary,status:status,notice:notice,dirty:false,proposalText:null,proposalDirty:false};
      async function save(value,isEnabled){try{var saved=await session.update(isEnabled,value);view.dirty=false;notice.textContent=saved.synced?'要点を保存・同期しました。':'この端末に保存しました。同期を待っています。';paint(view,session.state());}catch(ignore){notice.textContent='保存できませんでした。入力内容は残しています。';}}
      view.save=button('設定を保存',function(){return save(summary.value,enabled.checked);});actions.appendChild(view.save);
      view.forget=button('記憶を削除',async function(){try{var saved=await session.forget();view.dirty=false;notice.textContent=saved.synced?'記憶を削除・同期しました。':'この端末の記憶を削除しました。同期を待っています。';paint(view,session.state());}catch(ignore){notice.textContent='削除できませんでした。記憶は残しています。';}});actions.appendChild(view.forget);
      view.retry=button('接続・再読み込み',async function(){try{if(options.ensureReady)await options.ensureReady();bind();await session.refresh();}catch(ignore){notice.textContent='マイページの非公開接続を確認してください。';}});actions.appendChild(view.retry);body.appendChild(actions);body.appendChild(notice);
      var proposalBox=node('section','kn-am-proposal');proposalBox.hidden=true;proposalBox.appendChild(node('strong','','今回の会話からの更新候補'));proposalBox.appendChild(node('p','kn-am-caption','内容を確認・修正して保存してください。保存するまでは記憶に加わりません。'));
      var candidate=node('textarea');candidate.maxLength=LIMIT;candidate.rows=4;candidate.setAttribute('aria-label','確認して保存する要点の候補');proposalBox.appendChild(candidate);var proposalActions=node('div','kn-am-actions');
      view.confirm=button('この要点を保存',function(){return save(candidate.value,true);});view.dismiss=button('今回は保存しない',function(){session.dismiss();});proposalActions.appendChild(view.confirm);proposalActions.appendChild(view.dismiss);proposalBox.appendChild(proposalActions);body.appendChild(proposalBox);
      body.appendChild(node('p','kn-am-caption','連携先：相談ロボット・先生AI。家計・資産AI、質問ヒント、レシート読取にはこの記憶を送信しません。既存の利用制限は変わりません。'));
      view.proposalBox=proposalBox;view.candidate=candidate;enabled.addEventListener('change',function(){view.dirty=true;notice.textContent='';});summary.addEventListener('input',function(){view.dirty=true;notice.textContent='';});candidate.addEventListener('input',function(){view.proposalDirty=true;});box.appendChild(body);host.appendChild(box);views.push(view);paint(view,session.state());return box;
    }
    function bind(){var f=frame();if(!f||bound.has(f))return;bound.add(f);f.addEventListener('load',function(){session.refresh();});}
    function changedOwner(){var who=adapter.owner();if(observedOwner!==who){observedOwner=who;chatTicket++;chatBusy=false;if(adapter.invalidate)adapter.invalidate();session.reset();}bind();session.refresh();}
    function records(event){var f=frame();if(event.origin===w.location.origin&&f&&event.source===f.contentWindow&&event.data&&event.data.type==='kn-mypage-records-ready')session.refresh();}
    d.addEventListener('knAuthChange',changedOwner);w.addEventListener('message',records);bind();session.refresh();
    function ownerError(){var e=Error('memory_owner_changed');e.code='assistant_owner_changed';return e;}
    async function fetchChat(payload,requestOptions){
      if(chatBusy){var waiting=Error('request_pending');waiting.code='assistant_busy';throw waiting;}var ticket=++chatTicket;chatBusy=true;
      try{
      requestOptions=requestOptions||{};var before=session.state(),who=adapter.owner(),generation=before.epoch,body=Object.assign({},payload),headers={'Content-Type':'application/json'};delete body.shared_context;delete body.site_context;
      if(!before.ready&&(before.enabled||before.factsOnce)){var disconnected=Error('context_unavailable');disconnected.code='assistant_context_unavailable';throw disconnected;}
      if(before.ready&&before.enabled&&before.owner===who){headers.Authorization='Bearer '+adapter.token(who);body.shared_context={version:1,consent:true,summary:before.summary};}
      if(before.ready&&before.factsOnce&&before.owner===who){try{if(!adapter.facts)throw Error('context_invalid');var facts=await adapter.facts(who);if(destroyed||adapter.owner()!==who||session.state().epoch!==generation)throw ownerError();headers.Authorization='Bearer '+adapter.token(who);body.site_context=facts;}catch(e){if(e&&e.code==='assistant_owner_changed')throw e;var unavailable=Error('context_unavailable');unavailable.code='assistant_context_unavailable';throw unavailable;}}
      var current=session.state();if(body.shared_context&&(current.raw!==before.raw||!current.enabled||current.busy)||body.site_context&&!current.factsOnce){var changed=Error('context_changed');changed.code='assistant_context_unavailable';throw changed;}
      if(body.site_context)session.setFactsOnce(false);
      var response=await w.fetch('/api/chat',{method:'POST',headers:headers,body:JSON.stringify(body),signal:requestOptions.signal,cache:'no-store'});
      if(destroyed||adapter.owner()!==who||session.state().epoch!==generation)throw ownerError();var text=await response.text();
      if(destroyed||adapter.owner()!==who||session.state().epoch!==generation)throw ownerError();if(text.length>64000)throw Error('memory_response_invalid');
      if(body.shared_context){try{var result=JSON.parse(text);if(result&&result.shared_context_used===true&&validText(result.memory_proposal)&&result.memory_proposal.trim())session.propose(result.memory_proposal,before);}catch(ignore){}}
      return {ok:response.ok,status:response.status,text:async function(){if(destroyed||adapter.owner()!==who||session.state().epoch!==generation)throw ownerError();return text;}};
      }finally{if(ticket===chatTicket)chatBusy=false;}
    }
    return {mount:mount,refresh:session.refresh,state:session.state,fetchChat:fetchChat,session:session,destroy:function(){destroyed=true;d.removeEventListener('knAuthChange',changedOwner);w.removeEventListener('message',records);session.reset();views.forEach(function(v){v.box.remove();});views=[];}};
  }
  return Object.freeze({KEY:KEY,LIMIT:LIMIT,empty:empty,decode:decode,encode:encode,createSession:createSession,siteFacts:siteFacts,createFrameAdapter:createFrameAdapter,createController:createController});
});

/* The adopted overview uses the existing private ledger and its owner/restore boundary. */
(function(root,factory){
  'use strict';var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else{root.KNPortfolioOverview=api;api.mount(root);}
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  var own=Object.prototype.hasOwnProperty;
  function decimalText(values){
    var parts=values.map(function(value){if(typeof value!=='number'||!Number.isFinite(value))throw Error('assets_invalid');var bits=String(value).toLowerCase().split('e'),m=bits[0];return {n:BigInt(m.replace('.','')),scale:(m.split('.')[1]||'').length-Number(bits[1]||0)};});
    var scale=parts.reduce(function(n,x){return Math.max(n,x.scale);},0),total=parts.reduce(function(n,x){return n+x.n*10n**BigInt(scale-x.scale);},0n);
    var negative=total<0n,text=String(negative?-total:total);if(scale){text=text.padStart(scale+1,'0');text=text.slice(0,-scale)+'.'+text.slice(-scale);text=text.replace(/0+$/,'').replace(/\.$/,'');}return (negative?'-':'')+text;
  }
  function sum(values){var value=Number(decimalText(values));if(!Number.isFinite(value))throw Error('assets_invalid');return value;}
  function decode(raw){
    var rows=raw===null?[]:JSON.parse(raw);
    if(!Array.isArray(rows)||rows.length>5000)throw Error('assets_invalid');
    rows.forEach(function(row){if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.amount!=='number'||!Number.isFinite(row.amount))throw Error('assets_invalid');});
    return rows;
  }
  function cash(row){return row.cat==='現金'||row.cat==='現金・預金';}
  function knownCost(row){return !cash(row)&&typeof row.cost==='number'&&Number.isFinite(row.cost)&&row.cost>=0;}
  function analyse(raw){
    var rows=decode(raw),map=new Map(),known=[],unknown=0,negative=false;
    rows.forEach(function(row){var key=typeof row.cat==='string'&&row.cat?row.cat:'未分類';if(!map.has(key))map.set(key,[]);map.get(key).push(row.amount);negative=negative||row.amount<0;
      if(!cash(row)){if(knownCost(row))known.push(row.amount,-row.cost);else unknown++;}
    });
    var totalText=decimalText(rows.map(function(row){return row.amount;})),total=Number(totalText);if(!Number.isFinite(total))throw Error('assets_invalid');
    var groups=Array.from(map,function(pair){var text=decimalText(pair[1]);return {name:pair[0],amount:Number(text),amountText:text};}),profitText=known.length?decimalText(known):null;
    return {rows:rows,total:total,totalText:totalText,groups:groups,canAllocate:!negative&&total>0,knownCount:known.length/2,unknownCount:unknown,profit:profitText===null?null:Number(profitText),profitText:profitText};
  }
  function dateOK(value){if(value==='')return true;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;var d=new Date(value+'T00:00:00Z');return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===value;}
  function goal(raw,decoder){
    if(raw===null)return null;var d=typeof decoder==='function'?decoder(raw):JSON.parse(raw),ids=new Set();
    if(!d||d.version!==1||!Array.isArray(d.goals))throw Error('goal_invalid');
    d.goals.forEach(function(g){if(!g||ids.has(g.id)||typeof g.id!=='string'||typeof g.title!=='string'||typeof g.deadline!=='string'||!dateOK(g.deadline)||(g.target!==null&&(typeof g.target!=='number'||!Number.isFinite(g.target)||g.target<=0)))throw Error('goal_invalid');ids.add(g.id);});
    if(own.call(d,'assetTarget')){validateTarget(d.assetTarget);return d.assetTarget===null?null:{target:d.assetTarget};}
    return d.goals.find(function(g){return g.id===d.selectedGoalId;})||d.goals.find(function(g){return g.target>0;})||null;
  }
  function validateTarget(value){if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>Number.MAX_SAFE_INTEGER))throw Error('目標資産額は0円より大きい金額を入力してください。');return value;}
  function targetAmount(text){return String(text).normalize('NFKC').trim()===''?null:validateTarget(amount(text,false));}
  function targetDocument(raw,value,decoder){
    validateTarget(value);
    var d=raw===null?{version:1,goals:[],todos:[],notes:[],groups:[],selectedGoalId:'',selectedNoteId:'',legacyImported:false,goalDraft:null,todoDraft:{text:'',goalId:'',dueDate:'',flagged:false},todoEdits:{}}:typeof decoder==='function'?decoder(raw):JSON.parse(raw);
    if(!d||d.version!==1||!['goals','todos','notes','groups'].every(function(k){return Array.isArray(d[k]);}))throw Error('goal_invalid');
    goal(JSON.stringify(d),decoder);d.assetTarget=value;return JSON.stringify(d);
  }
  function amount(value,negative){
    var s=String(value).normalize('NFKC').trim().replace(/[−－]/g,'-');
    s=s.replace(/^[¥￥]/,'').replace(/円$/,'').trim();
    if(!/^[+-]?(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s))throw Error('金額を数字で入力してください。');
    var n=Number(s.replace(/,/g,''));
    if(!Number.isFinite(n)||Math.abs(n)>Number.MAX_SAFE_INTEGER||!negative&&n<0||n===0&&/[1-9]/.test(s.split(/[eE]/)[0]))throw Error('金額を確認してください。');return n;
  }
  function updateRows(raw,index,draft){
    var rows=decode(raw);if(index!==null&&(!Number.isInteger(index)||index<0||index>=rows.length))throw Error('asset_changed');
    var simple=!own.call(draft,'name'),next=Object.assign({},index===null?{id:Date.now()}:rows[index]);
    if(simple){
      // The two-field editor never rewrites a historical name or omitted
      // metadata. Preserve even unusual legacy categories when left untouched.
      if(index===null||own.call(draft,'cat')&&draft.cat!==rows[index].cat){
        var kind=String(draft.cat||'').trim();if(!kind||kind.length>80)throw Error('資産の種類を80文字以内で入力してください。');
        next.cat=kind;
      }
      if(index===null)next.name=next.cat;
    }else{
      // Keep compatibility with callers that explicitly supply a full draft.
      var name=String(draft.name||'').trim(),cat=String(draft.cat||'').trim();if(!name||name.length>80||index===null&&!cat||cat.length>80&&(index===null||cat!==rows[index].cat))throw Error('資産名と種類を入力してください。');
      next.name=name;if(cat)next.cat=cat;
    }
    var unchanged=index!==null&&String(draft.amount).trim()===String(rows[index].amount);
    next.amount=unchanged?rows[index].amount:amount(draft.amount,true);
    ['cost','account','institution','date'].forEach(function(key){
      if(!own.call(draft,key))return;var text=String(draft[key]===null?'':draft[key]).trim();
      if(key==='cost')next.cost=text===''?null:amount(text,false);
      else if(key==='date'){if(!dateOK(text))throw Error('基準日を確認してください。');next.date=text;}
      else{if(text.length>80)throw Error('入力は80文字以内にしてください。');next[key]=text;}
    });
    if(index===null)rows.push(next);else rows[index]=next;return rows;
  }
  function money(value){var text=typeof value==='string'?value:decimalText([value]);if(!/^-?\d+(?:\.\d+)?$/.test(text))throw Error('assets_invalid');var parts=text.split('.');return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g,',')+(parts[1]?'.'+parts[1]:'')+'円';}
  function percent(total,target,gapText){
    var ratio=total/target*100,under=gapText!==undefined&&gapText!=='0'&&gapText[0]!=='-';
    if(!Number.isFinite(ratio))return ratio>0?'100%超':'0%未満';
    if(total>0&&ratio<0.1)return '0.1%未満';
    if(ratio<0&&ratio>-0.1)return '0%未満';
    if(under&&ratio>99.9)return '99.9%';
    return ratio.toLocaleString('ja-JP',{maximumFractionDigits:1})+'%';
  }
  function errorMessage(error){
    var text=error&&error.message;
    var known=['金額を数字で入力してください。','金額を確認してください。','目標資産額は0円より大きい金額を入力してください。','目標資産額を確認してください。','記録の読み込みを確認してから、もう一度お試しください。','この端末に保存できませんでした。入力内容は残しています。','目標を読み込めませんでした。再読み込みしてください。','目標を保存できませんでした。入力内容は残しています。もう一度お試しください。','資産名と種類を入力してください。','資産の種類を80文字以内で入力してください。','基準日を確認してください。','入力は80文字以内にしてください。','非公開接続を確認してから、もう一度お試しください。','アカウントが切り替わりました。','資産の内容が更新されています。入力内容は残しています。閉じて開き直して確認してください。','非公開接続を確認してください。','資産の内容が更新されています。再読み込みしてください。','資産が見つかりません。'];
    if(known.indexOf(text)>=0)return text;
    if(text==='assets_invalid'||text==='asset_changed')return '資産の内容を確認してください。入力内容は残しています。';
    return '保存できませんでした。入力内容は残しています。もう一度お試しください。';
  }
  function createSession(options){
    var owner='',serial=0,generation=0,raw,model=null,ready=false,goalValue=null,goalError=false,error='';
    function current(){return !!owner&&owner===options.owner();}
    function state(){return current()?{owner:owner,raw:raw,model:model,ready:ready,goal:goalValue,goalError:goalError,error:error}:{owner:'',raw:undefined,model:null,ready:false,goal:null,goalError:false,error:''};}
    function emit(){if(options.onChange)options.onChange(state());}
    function reset(next){owner=next;generation++;serial++;raw=undefined;model=null;ready=false;goalValue=null;goalError=false;error='';emit();}
    async function refresh(){
      var who=options.owner()||'';if(who!==owner)reset(who);if(!who){emit();return false;}
      var token=++serial;
      try{var result=await options.read(who);if(!current()||token!==serial)return false;
        var next=analyse(result.assetsRaw);raw=result.assetsRaw;model=next;ready=true;error='';
        try{goalValue=goal(result.raw,options.decodeGoal);goalError=false;}catch(ignore){goalValue=null;goalError=true;}
        emit();return true;
      }catch(ignore){if(current()&&token===serial){ready=false;model=null;goalValue=null;error='資産を読み込めませんでした。保存済みの内容を変更せず、再読み込みしてください。';emit();}return false;}
    }
    async function save(index,draft,baseRaw){
      var who=owner,token=serial,epoch=generation;if(!ready||!current())throw Error('非公開接続を確認してから、もう一度お試しください。');
      var latest=await options.read(who);if(!current()||serial!==token)throw Error('アカウントが切り替わりました。');
      if(latest.assetsRaw!==baseRaw)throw Error('資産の内容が更新されています。入力内容は残しています。閉じて開き直して確認してください。');
      var rows=updateRows(latest.assetsRaw,index,draft);analyse(JSON.stringify(rows));options.write(who,rows);
      if(!current())throw Error('アカウントが切り替わりました。');await refresh();if(!current()||owner!==who||generation!==epoch)throw Error('アカウントが切り替わりました。');return true;
    }
    async function remove(index,baseRaw){
      var who=owner,token=serial,epoch=generation;if(!ready||!current())throw Error('非公開接続を確認してください。');
      var latest=await options.read(who);if(!current()||serial!==token||latest.assetsRaw!==baseRaw)throw Error('資産の内容が更新されています。再読み込みしてください。');
      var rows=decode(latest.assetsRaw);if(!Number.isInteger(index)||!rows[index])throw Error('資産が見つかりません。');rows.splice(index,1);analyse(JSON.stringify(rows));options.write(who,rows);await refresh();if(!current()||owner!==who||generation!==epoch)throw Error('アカウントが切り替わりました。');return true;
    }
    async function setTarget(value){
      validateTarget(value);var who=owner,epoch=generation;
      if(!ready||!current())throw Error('非公開接続を確認してから、もう一度お試しください。');
      if(goalError)throw Error('目標を読み込めませんでした。再読み込みしてください。');
      var result=await options.writeTarget(who,value);
      if(!current()||owner!==who||generation!==epoch)throw Error('アカウントが切り替わりました。');
      if(!result||result.ok!==true)throw Error(result&&result.error||'目標を保存できませんでした。入力内容は残しています。もう一度お試しください。');
      if(!await refresh())throw Error('目標を読み込めませんでした。再読み込みしてください。');
      if(!current()||owner!==who||generation!==epoch)throw Error('アカウントが切り替わりました。');
      return {ok:true,synced:result.synced===true};
    }
    return {refresh:refresh,state:state,save:save,remove:remove,setTarget:setTarget,reset:function(){reset(options.owner()||'');}};
  }
  function mount(w){
    var doc=w.document;if(!doc)return;var pane,form,fields={},session,editorIndex=null,editorRaw,editorOwner='',busy=false,dirty=false,editedFields=Object.create(null),targetInput,targetForm,targetOwner='',targetDirty=false,targetBusy=false,targetEpoch=0;
    function node(tag,cls,text){var n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
    function owner(){
      try{var s=w.knLedgerSession,id=s&&s.access_token&&s.user&&String(s.user.id);if(!id||w.localStorage.getItem('kn_ledger_owner')!==id)return '';
        if(w.parent!==w&&(w.parent.location.origin!==w.location.origin||!w.parent.knUser||String(w.parent.knUser.id)!==id))return '';return id;
      }catch(ignore){return '';}
    }
    function status(text,error){var el=doc.getElementById('poStatus');el.textContent=text||'';el.hidden=!text;el.classList.toggle('po-error',!!error);}
    function close(){form.hidden=true;editorIndex=null;editorRaw=undefined;editorOwner='';dirty=false;doc.getElementById('poEditorError').textContent='';}
    function scrub(){close();Object.keys(fields).forEach(function(k){fields[k].value='';});pane.querySelectorAll('[data-po-custom]').forEach(function(n){n.remove();});targetEpoch++;targetOwner='';targetDirty=false;targetBusy=false;if(targetInput)targetInput.value='';if(targetForm){doc.getElementById('poGoalError').textContent='';doc.getElementById('poGoalStatus').textContent='';}}
    function fieldValues(){var draft={amount:fields.amount.value};
      if(editorIndex===null||editedFields.cat)draft.cat=fields.cat.value;return draft;
    }
    function paint(s){
      var same=owner()&&s.owner===owner();if(!same){scrub();s={ready:false,model:null,error:''};}
      if(editorOwner&&editorOwner!==s.owner)scrub();
      pane.setAttribute('data-po-ready',s.ready?'true':'false');doc.getElementById('poFieldset').disabled=!s.ready||busy;
      if(targetOwner&&targetOwner!==s.owner)scrub();
      targetOwner=s.owner||'';targetInput.disabled=!s.ready||!!s.goalError||targetBusy;doc.getElementById('poGoalSave').disabled=targetInput.disabled;
      if(!targetDirty)targetInput.value=s.ready&&s.goal&&s.goal.target>0?String(s.goal.target):'';
      pane.querySelectorAll('[data-po-add]').forEach(function(b){b.disabled=!s.ready;});
      doc.getElementById('totalAssetVal').textContent=s.model?money(s.model.totalText):'—';
      status(s.error||(!s.ready?'資産の非公開接続を確認しています…':''),!!s.error);
      var legend=doc.getElementById('asset-legend'),stack=doc.getElementById('poAllocationStack'),list=doc.getElementById('asset-list-el');legend.replaceChildren();stack.replaceChildren();list.replaceChildren();
      if(!s.ready||!s.model){doc.getElementById('poProfitValue').textContent='—';doc.getElementById('poProfitNote').textContent='';doc.getElementById('poAsOf').textContent='';doc.getElementById('totalAssetChange').textContent='';doc.getElementById('poGoalBody').replaceChildren();return;}
      var m=s.model;doc.getElementById('totalAssetChange').textContent='登録資産 '+m.rows.length+'件';
      var dates=m.rows.map(function(a){return typeof a.date==='string'&&a.date&&dateOK(a.date)?a.date:'';}),unknownDates=dates.filter(function(d){return !d;}).length;
      doc.getElementById('poAsOf').textContent=!m.rows.length?'手入力の評価額を合計します':unknownDates?'基準日未入力 '+unknownDates+'件 · 手入力':new Set(dates).size===1?'評価額の基準日 '+dates[0].replace(/-/g,'/')+' · 手入力':'各資産の基準日で集計 · 手入力';
      var profitSign=m.profitText===null||m.profitText==='0'?0:m.profitText[0]==='-'?-1:1;
      doc.getElementById('poProfitValue').textContent=m.profitText===null?'—':(profitSign>0?'＋':profitSign<0?'−':'')+money(profitSign<0?m.profitText.slice(1):m.profitText);
      doc.getElementById('poProfitValue').className='po-profit-value '+(profitSign>0?'po-up':profitSign<0?'po-down':'');
      doc.getElementById('poProfitNote').textContent=(m.knownCount?'取得額のある記録 '+m.knownCount+'件を集計':'取得額のある記録はありません')+(m.unknownCount?' · 取得額不明 '+m.unknownCount+'件':'');
      stack.hidden=!m.canAllocate;stack.setAttribute('aria-label',m.groups.map(function(g){return g.name+' '+money(g.amountText);}).join('、'));
      doc.getElementById('poAllocationNote').textContent=m.rows.length?m.canAllocate?'評価額ベース':'マイナスまたは合計0円のため、配分率の代わりに金額を表示しています。':'資産を追加すると内訳が表示されます。';
      m.groups.forEach(function(g,i){var color='var(--po-category-'+(i%7)+')';if(m.canAllocate&&g.amount>0){var segment=node('span','po-segment');segment.style.width=g.amount/m.total*100+'%';segment.style.background=color;stack.appendChild(segment);}
        var row=node('div','po-legend-row'),name=node('span','po-category'),swatch=node('span','po-swatch');swatch.style.background=color;name.appendChild(swatch);name.appendChild(node('span','',g.name));row.appendChild(name);
        var value=node('span','po-legend-value',money(g.amountText));value.appendChild(node('small','',m.canAllocate?(g.amount/m.total*100).toLocaleString('ja-JP',{maximumFractionDigits:1})+'%':'—'));row.appendChild(value);legend.appendChild(row);
      });
      if(!m.rows.length)list.appendChild(node('p','po-muted','資産はまだ登録されていません。'));
      m.rows.forEach(function(a,index){var row=node('div','po-holding'),edit=node('button','po-asset');edit.type='button';edit.setAttribute('aria-label',(a.name||'名称未設定')+'の詳細を編集');
        var left=node('span','po-asset-main');left.appendChild(node('span','po-asset-name',typeof a.name==='string'?a.name:'名称未設定'));left.appendChild(node('span','po-asset-meta',(typeof a.cat==='string'&&a.cat?a.cat:'未分類')+(!cash(a)&&typeof a.account==='string'&&a.account?' · '+a.account:'')));edit.appendChild(left);
        var right=node('span','po-asset-values');right.appendChild(node('strong','',money(a.amount)));if(!cash(a)){var pnl=knownCost(a)?decimalText([a.amount,-a.cost]):null,pnlSign=pnl===null||pnl==='0'?0:pnl[0]==='-'?-1:1;right.appendChild(node('small',pnlSign>0?'po-up':pnlSign<0?'po-down':'po-muted',pnl===null?'損益 —':(pnlSign>0?'＋':pnlSign<0?'−':'')+money(pnlSign<0?pnl.slice(1):pnl)));}edit.appendChild(right);edit.addEventListener('click',function(){open(index);});row.appendChild(edit);
        var del=node('button','po-delete','削除');del.type='button';del.setAttribute('aria-label',(a.name||'名称未設定')+'を削除');del.addEventListener('click',async function(){if(busy||!w.confirm('この資産を削除しますか？'))return;var who=owner();busy=true;try{await session.remove(index,s.raw);if(who===owner()){close();status('この端末から削除しました。',false);}}catch(e){if(who===owner())status(errorMessage(e),true);}finally{busy=false;doc.getElementById('poFieldset').disabled=!session.state().ready;}});row.appendChild(del);list.appendChild(row);
      });
      paintGoal(s);
    }
    function paintGoal(s){var body=doc.getElementById('poGoalBody');body.replaceChildren();var g=s.goal;
      if(s.goalError){body.appendChild(node('p','po-muted','目標を読み込めませんでした。再読み込みしてください。'));return;}
      if(!g)return;
      if(!(g.target>0)){body.appendChild(node('p','po-muted','目標額は未入力です。'));return;}
      var gap=decimalText([g.target].concat(s.model.rows.map(function(row){return -row.amount;}))),ratio=s.model.total/g.target*100,ratioLabel=percent(s.model.total,g.target,gap),pct=Math.max(0,Math.min(gap!=='0'&&gap[0]!=='-'?99.9:100,ratio)),above=gap[0]==='-';
      if(gap!=='0'){var distance=node('p','po-goal-gap');distance.appendChild(node('span','po-goal-label',above?'目標を上回った金額':'目標まであと'));distance.appendChild(node('strong','po-goal-amount',money(above?gap.slice(1):gap)));body.appendChild(distance);}
      body.appendChild(node('p','po-goal-rate','達成率 '+ratioLabel));
      var track=node('div','po-track');track.setAttribute('role','progressbar');track.setAttribute('aria-label','資産目標の達成率');track.setAttribute('aria-valuenow',String(pct));track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');track.setAttribute('aria-valuetext',ratioLabel);var fill=node('div','po-fill');fill.style.width=pct+'%';track.appendChild(fill);body.appendChild(track);
      var values=node('div','po-goal-current-target'),current=node('p','po-goal-current'),target=node('p','po-goal-target');
      current.appendChild(node('span','po-goal-label','現在 '));current.appendChild(node('strong','',money(s.model.totalText)));target.appendChild(node('span','po-goal-label','目標 '));target.appendChild(node('strong','',money(g.target)));values.appendChild(current);values.appendChild(target);body.appendChild(values);
    }
    function open(index){if(busy)return;var s=session.state();if(!s.ready||owner()!==s.owner)return;if(!form.hidden&&dirty&&!w.confirm('編集中の内容を閉じますか？'))return;
      editorIndex=index;editorRaw=s.raw;editorOwner=s.owner;var a=index===null?{}:s.model.rows[index];if(!a)return;
      fields.amount.value=index===null?'':String(a.amount);fields.cat.value=typeof a.cat==='string'?a.cat:'';
      doc.getElementById('poEditorTitle').textContent=index===null?'資産を追加':'資産の詳細';doc.getElementById('poSaveButton').textContent=index===null?'追加する':'変更を保存';doc.getElementById('poEditorError').textContent='';dirty=false;editedFields=Object.create(null);form.hidden=false;fields.cat.focus();form.scrollIntoView({block:'nearest',behavior:'auto'});
    }
    async function save(){if(busy)return false;var s=session.state();if(form.hidden){open(null);return false;}if(editorOwner!==owner()||!s.ready)return false;
      var who=editorOwner,base=editorRaw;busy=true;doc.getElementById('poFieldset').disabled=true;try{var draft=fieldValues();await session.save(editorIndex,draft,editorRaw);if(who!==owner()||editorOwner!==who||editorRaw!==base)return false;close();status('この端末に保存しました。',false);return true;}catch(e){if(who===owner()&&editorOwner===who)doc.getElementById('poEditorError').textContent=errorMessage(e);return false;}finally{busy=false;doc.getElementById('poFieldset').disabled=!session.state().ready;}
    }
    function decodePlanner(raw){if(w.parent!==w&&w.parent.location.origin===w.location.origin&&w.parent.KNMyPagePlanner)return w.parent.KNMyPagePlanner.decode(raw);return JSON.parse(raw);}
    async function writeTarget(who,value){
      var epoch=targetEpoch;
      function valid(){return who===owner()&&epoch===targetEpoch;}
      if(!valid())throw Error('アカウントが切り替わりました。');
      if(w.parent!==w){
        if(w.parent.location.origin!==w.location.origin||typeof w.parent.knSetPortfolioAssetTarget!=='function')throw Error('非公開接続を確認してから、もう一度お試しください。');
        return w.parent.knSetPortfolioAssetTarget(w,who,value);
      }
      var store=w.kkMyPageStore;if(!store)throw Error('非公開接続を確認してから、もう一度お試しください。');
      var latest=await store.load(who);if(!valid())throw Error('アカウントが切り替わりました。');
      var next=targetDocument(latest.raw,value,decodePlanner);
      if(!valid()||!store.stage(who,next))throw Error('目標を保存できませんでした。入力内容は残しています。もう一度お試しください。');
      var synced=await store.save(who,next);if(!valid())throw Error('アカウントが切り替わりました。');
      return {ok:true,synced:synced===true};
    }
    async function saveTarget(){
      var s=session.state();if(targetBusy||!s.ready||s.goalError||s.owner!==owner())return false;
      var who=owner(),epoch=targetEpoch,text=targetInput.value;targetBusy=true;targetInput.disabled=true;doc.getElementById('poGoalSave').disabled=true;doc.getElementById('poGoalError').textContent='';doc.getElementById('poGoalStatus').textContent='';
      try{
        var result=await session.setTarget(targetAmount(text));
        if(who!==owner()||epoch!==targetEpoch)return false;
        if(targetInput.value===text)targetDirty=false;
        doc.getElementById('poGoalStatus').textContent=result.synced?'':'この端末に保存しました。同期を待っています…';return true;
      }catch(e){if(who===owner()&&epoch===targetEpoch)doc.getElementById('poGoalError').textContent=errorMessage(e);return false;}
      finally{if(who===owner()&&epoch===targetEpoch){targetBusy=false;paint(session.state());}}
    }
    function build(){pane=doc.getElementById('tab-assets');form=doc.getElementById('poEditor');if(!pane||!form)return;
      targetForm=doc.getElementById('poGoalForm');targetInput=doc.getElementById('poGoalAmount');if(!targetForm||!targetInput)return;
      ['cat','amount'].forEach(function(k){fields[k]=doc.getElementById('ast-'+k);});
      session=createSession({owner:owner,read:function(who){if(!w.kkMyPageStore)throw Error('restore_unavailable');return w.kkMyPageStore.load(who);},decodeGoal:decodePlanner,write:function(who,rows){if(who!==owner())throw Error('アカウントが切り替わりました。');w.saveAssets(rows);},writeTarget:writeTarget,onChange:paint});
      pane.querySelectorAll('[data-po-add]').forEach(function(b){b.addEventListener('click',function(){open(null);});});doc.getElementById('poCancelButton').addEventListener('click',close);doc.getElementById('poRetry').addEventListener('click',function(){session.refresh();});
      targetInput.addEventListener('input',function(){if(targetBusy||targetInput.disabled)return;targetDirty=true;doc.getElementById('poGoalError').textContent='';doc.getElementById('poGoalStatus').textContent='';});targetForm.addEventListener('submit',function(e){e.preventDefault();return saveTarget();});
      form.addEventListener('input',function(e){dirty=true;if(e.target&&e.target.id&&e.target.id.indexOf('ast-')===0)editedFields[e.target.id.slice(4)]=true;doc.getElementById('poEditorError').textContent='';});form.addEventListener('submit',function(e){e.preventDefault();save();});
      w.kkPortfolioSaveAsset=save;w.kkPortfolioRender=function(){return session.refresh();};
      w.addEventListener('knLedgerAuth',function(){if(editorOwner&&editorOwner!==owner())scrub();session.refresh();});w.addEventListener('knMyPageStoreChange',function(){session.refresh();});
      w.addEventListener('storage',function(e){if(!e.key||e.key==='kn_ledger_owner'){if(owner()!==session.state().owner){scrub();session.reset();}session.refresh();}});
      session.refresh();
    }
    if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',build,{once:true});else build();
  }
  return Object.freeze({sum:sum,decimalText:decimalText,decode:decode,analyse:analyse,goal:goal,targetAmount:targetAmount,targetDocument:targetDocument,amount:amount,updateRows:updateRows,money:money,percent:percent,createSession:createSession,mount:mount});
});

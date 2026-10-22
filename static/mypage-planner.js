/* Personal goals and notebooks use the existing private ledger, never a second save API. */
(function(root,factory){
  'use strict';
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else {root.KNMyPagePlanner=api;api.mount(root);}
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  function empty(){return {version:1,goals:[],todos:[],notes:[],groups:[],selectedGoalId:'',selectedNoteId:'',legacyImported:false,goalDraft:null,todoDraft:{text:'',goalId:'',dueDate:'',flagged:false},todoEdits:{}};}
  function id(){return 'p'+Date.now().toString(36)+Math.random().toString(36).slice(2,10);}
  function str(x){return typeof x==='string';}
  function dateOK(s){if(!s)return true;if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;var d=new Date(s+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;}
  function todoOptions(value){
    if(value.notificationScheduled!==undefined&&typeof value.notificationScheduled!=='boolean')throw Error('planner_format');
    if(value.dueDate!==undefined&&(!str(value.dueDate)||!dateOK(value.dueDate))||value.flagged!==undefined&&typeof value.flagged!=='boolean')throw Error('planner_format');
  }
  function localDateKey(now){
    var date=new Date(now===undefined?Date.now():now),year=date.getFullYear();
    if(!Number.isFinite(date.getTime())||year<1||year>9999)throw Error('planner_date');
    return String(year).padStart(4,'0')+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
  }
  function filterTodos(todos,filter,query,today){
    if(['all','today','scheduled','flagged'].indexOf(filter)<0)throw Error('planner_filter');
    today=today===undefined?localDateKey():today;
    if(!str(today)||!today||!dateOK(today))throw Error('planner_date');
    var search=String(query===undefined||query===null?'':query).trim().toLocaleLowerCase();
    return todos.filter(function(todo){
      if(search&&!todo.text.toLocaleLowerCase().includes(search))return false;
      if(filter==='all')return true;
      if(todo.done)return false;
      return filter==='today'?todo.dueDate===today:filter==='scheduled'?!!todo.dueDate:todo.flagged===true;
    });
  }
  function decode(raw){
    if(raw===null)return empty();
    var d=JSON.parse(raw);
    if(!d||d.version!==1||!['goals','todos','notes','groups'].every(function(k){return Array.isArray(d[k]);}))throw Error('planner_format');
    var used=Object.create(null);
    ['goals','todos','notes','groups'].forEach(function(k){d[k].forEach(function(x){
      if(!x||!str(x.id)||!x.id||used[k+':'+x.id])throw Error('planner_format');used[k+':'+x.id]=true;
      if(k==='goals'&&(!str(x.title)||!str(x.details)||(!str(x.deadline)||!dateOK(x.deadline))||![x.target,x.monthly].every(function(n){return n===null||typeof n==='number'&&Number.isFinite(n)&&n>=0;})||x.target===0))throw Error('planner_format');
      if(k==='todos'){if(!str(x.text)||typeof x.done!=='boolean'||!str(x.goalId))throw Error('planner_format');todoOptions(x);}
      if(k==='notes'&&(!str(x.title)||!str(x.body)||!str(x.groupId)))throw Error('planner_format');
      if(k==='groups'&&!str(x.name))throw Error('planner_format');
    });});
    var merged=Object.assign(empty(),d);
    if(!str(merged.selectedGoalId)||!str(merged.selectedNoteId)||typeof merged.legacyImported!=='boolean')throw Error('planner_format');
    if(!merged.todoDraft||!str(merged.todoDraft.text)||!str(merged.todoDraft.goalId))throw Error('planner_format');
    todoOptions(merged.todoDraft);
    if(merged.goalDraft!==null&&(!merged.goalDraft||!['id','title','details','target','deadline','monthly'].every(function(k){return str(merged.goalDraft[k]);})||!dateOK(merged.goalDraft.deadline)))throw Error('planner_format');
    if(!merged.todoEdits||typeof merged.todoEdits!=='object'||Array.isArray(merged.todoEdits))throw Error('planner_format');
    Object.keys(merged.todoEdits).forEach(function(k){var t=merged.todoEdits[k];if(!t||!str(t.text)||!str(t.goalId))throw Error('planner_format');todoOptions(t);});
    return merged;
  }
  // Display-only excerpts: preserve the original title, whitespace and body in storage.
  function notePreview(note){
    var lines=note.body.split('\n').map(function(line){return line.trim();}).filter(Boolean);
    return {title:note.title.trim()||(lines[0]||'').slice(0,40)||'無題のメモ',excerpt:(note.title.trim()?lines:lines.slice(1)).join(' ').slice(0,100)};
  }
  function amount(text,positive){
    var s=String(text).replace(/[０-９．，]/g,function(c){return String.fromCharCode(c.charCodeAt(0)-0xfee0);}).replace(/[,\s]/g,'');
    if(!s)return null;
    if(!/^\d+(?:\.\d+)?$/.test(s))throw Error('金額を数字で入力してください。');
    var n=Number(s);if(!Number.isFinite(n)||positive&&n<=0)throw Error('目標額は0円より大きい金額にしてください。');
    return n;
  }
  // Sum decimal representations without rounding away valid fractional yen.
  function decimalTotal(terms){
    var parts=terms.map(function(term){
      var bits=String(term[0]).toLowerCase().split('e'),mantissa=bits[0],fraction=(mantissa.split('.')[1]||'').length;
      return {digits:BigInt(mantissa.replace('.',''))*BigInt(term[1]),scale:fraction-Number(bits[1]||0)};
    });
    var scale=parts.reduce(function(n,p){return Math.max(n,p.scale);},0);
    var sum=parts.reduce(function(n,p){return n+p.digits*10n**BigInt(scale-p.scale);},0n);
    return Number(String(sum)+'e-'+scale);
  }
  function assets(raw){
    if(raw===null)return {total:0,groups:[],count:0};
    var rows=JSON.parse(raw);if(!Array.isArray(rows))throw Error('assets_format');
    var groups=new Map(),values=[];
    rows.forEach(function(x){if(!x||typeof x.amount!=='number'||!Number.isFinite(x.amount))throw Error('assets_format');values.push([x.amount,1]);var name=typeof x.cat==='string'&&x.cat?x.cat:'未分類';if(!groups.has(name))groups.set(name,[]);groups.get(name).push([x.amount,1]);});
    var sum=decimalTotal(values);if(!Number.isFinite(sum))throw Error('assets_format');
    return {total:sum,groups:Array.from(groups,function(x){return {name:x[0],amount:decimalTotal(x[1])};}),count:rows.length};
  }
  function money(n){return new Intl.NumberFormat('ja-JP',{maximumFractionDigits:20}).format(n)+'円';}
  function percent(current,target){
    if(!(target>0)||!Number.isFinite(current))return null;
    var n=current/target*100;
    if(n>0&&n<0.1)return '0.1%未満';
    if(n<100&&n>99.9)return '99.9%';
    return (Math.round(n*10)/10).toLocaleString('ja-JP',{maximumFractionDigits:1})+'%';
  }
  function progress(goal,stock,todos){
    var tasks=todos.filter(function(t){return t.goalId===goal.id;}),done=tasks.filter(function(t){return t.done;}).length;
    return {tasks:tasks.length,done:done,next:tasks.find(function(t){return !t.done;})||null,assetRate:stock&&goal.target?percent(stock.total,goal.target):null,gap:stock&&goal.target?decimalTotal([[goal.target,1],[stock.total,-1]]):null};
  }
  function plan(goal,total,now){
    if(!goal.deadline||goal.monthly===null)return null;
    var jst=new Date((now===undefined?Date.now():now)+9*3600000);
    var months=(Number(goal.deadline.slice(0,4))-jst.getUTCFullYear())*12+Number(goal.deadline.slice(5,7))-jst.getUTCMonth()-1;
    return months>0?{months:months,total:decimalTotal([[total,1],[goal.monthly,months]])}:null;
  }
  function importLegacy(doc,legacy){
    var d=decode(JSON.stringify(doc));
    if(d.legacyImported)return d;
    if(legacy.goal)d.goals.push({id:id(),title:'以前の目標',details:legacy.goal,target:null,monthly:null,deadline:''});
    if(legacy.memo)d.notes.push({id:id(),title:'以前の自由メモ',body:legacy.memo,groupId:''});
    if(legacy.todos){var rows=JSON.parse(legacy.todos);if(!Array.isArray(rows)||rows.some(function(t){return !t||!str(t.text)||typeof t.done!=='boolean';}))throw Error('legacy_format');rows.forEach(function(t){d.todos.push({id:id(),text:t.text,done:t.done,goalId:''});});}
    d.legacyImported=true;return d;
  }
  function mount(w){
    var document=w.document;if(!document)return;
    var page,panes,status,doc=null,stock=null,owner='',bridge=null,loading=false,revision=0,saving=false,savedRevision=0,timer,notesFilter='',search='',boundFrame=null,epoch=0,editable=false;
    var retryButton,goalList,goalForm,todoList,todoText,todoGoal,todoDue,todoFlag,todoFind,todoCount,todoCompleted,todoCompletedSummary,todoCompletedList,todoAddDetails,noteList,noteTitle,noteBody,groupList,legacyButton,formFields={},goalSummary;
    var todoFilter='all',todoSearch='',completedOpen=false,todoFilterButtons=[];
    var notesEditing=false,viewNoteId='',noteLibrary,noteEditor,noteFind,noteHeading,noteCount,noteFolders,noteDelete,noteRich=null,noteRichSlot=null,noteRichKey='';
    var claimKey='kn_mypage_legacy_owner_v1';
    function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
    function button(text,fn,cls){var n=el('button',cls||'mp-button',text);n.type='button';n.addEventListener('click',fn);return n;}
    function current(){return w.knUser&&w.knUser.id?String(w.knUser.id):'';}
    function message(text,error){if(status){status.textContent=text;status.classList.toggle('mp-error',!!error);if(retryButton)retryButton.hidden=!error;if(status.parentElement)status.parentElement.hidden=!text;}}
    function validOwner(){return !!owner&&owner===current();}
    function child(){
      var f=page&&page.querySelector('.kb-frame'),c;
      try{c=f&&f.contentWindow;if(c&&c.kkMyPageStore&&c.knLedgerSession&&c.knLedgerSession.user.id===current()&&c.localStorage.getItem('kn_ledger_owner')===current())return c;}catch(ignore){}
      return null;
    }
    function setEnabled(ok){
      editable=ok;page.querySelectorAll('.mp-planner input,.mp-planner textarea,.mp-planner select,.mp-planner button').forEach(function(n){n.disabled=!ok;});
      // Previously confirmed notes remain readable after a later restore failure.
      page.querySelectorAll('.mp-note-pick,.mp-note-back,.mp-note-search,.mp-note-all,.mp-note-folder-pick').forEach(function(n){n.disabled=!notesReadable();});
      if(noteRich)noteRich.setEditable(!!ok&&!!(doc&&selectedNote()));
    }
    function changed(){
      if(!doc||!validOwner()||!editable)return;
      revision++;message('この端末に保存中…');
      // Keep every keystroke locally, even while an earlier cloud save is pending.
      try{if(!bridge||!bridge.stage(owner,JSON.stringify(doc)))throw Error('stage_failed');}
      catch(ignore){w.clearTimeout(timer);message('この端末に保存できませんでした。画面の書きかけを保持しています。',true);return;}
      message('この端末に保存しました。同期を待っています…');
      queuePersist();
    }
    function queuePersist(){w.clearTimeout(timer);timer=w.setTimeout(persist,1500);}
    async function persist(){
      if(saving||!doc||!validOwner()||!bridge)return;
      saving=true;var who=owner,token=revision,raw=JSON.stringify(doc),active=bridge,generation=epoch;
      try{
        var promise=active.save(who,raw);message('同期中…');
        var ok=await promise;
        if(who!==owner||!validOwner()||active!==bridge)return;
        if(ok){savedRevision=token;if(revision===token)message('保存しました');}
        else message('同期できませんでした。書きかけを保持しています。再試行してください。',true);
      }catch(ignore){if(who===owner&&validOwner())message('保存できませんでした。画面の書きかけを保持しています。',true);}
      finally{if(generation===epoch){saving=false;if(who===owner&&validOwner()&&revision!==token)queuePersist();}}
    }
    function dateLabel(s){return w.KNDateDisplay?w.KNDateDisplay.date(s):s.replace(/-/g,'/');}
    function selectedNote(){return doc.notes.find(function(n){return n.id===(viewNoteId||doc.selectedNoteId);})||doc.notes[0]||null;}
    function pickGoal(g){doc.selectedGoalId=g.id;renderGoals();changed();}
    function goTab(i){var t=page.querySelectorAll('.mo-tab')[i];if(t)t.click();}
    function renderGoals(){
      goalList.replaceChildren();goalSummary.replaceChildren();
      if(!doc)return;
      if(!doc.goals.length)goalList.appendChild(el('p','mp-muted','NISA、株や経済の勉強など、取り組みたい目標を自由に追加できます。'));
      doc.goals.forEach(function(g){
        var card=el('article','mp-card'),head=el('div','mp-row');head.appendChild(button(g.title,function(){pickGoal(g);},'mp-goal-title'));head.appendChild(button('編集',function(){openGoal(g);},'mp-link'));card.appendChild(head);
        if(g.details)card.appendChild(el('p','mp-preserve',g.details));
        var p=progress(g,stock,doc.todos);
        if(g.deadline)card.appendChild(el('p','mp-muted',dateLabel(g.deadline)+' 目標の期限'));
        card.appendChild(el('p','mp-muted','やること '+p.done+' / '+p.tasks+' 件完了'));
        if(p.tasks){var taskMeter=el('progress');taskMeter.max=p.tasks;taskMeter.value=p.done;taskMeter.setAttribute('aria-label',g.title+'のやること完了');card.appendChild(taskMeter);}
        card.appendChild(el('p','mp-next',p.next?'次の一歩：'+p.next.text:p.tasks?'すべてのやることが完了しています。':'最初のやることを追加しましょう。'));
        card.appendChild(button('この目標にやることを追加',function(){doc.selectedGoalId=g.id;todoGoal.value=g.id;doc.todoDraft.goalId=g.id;goTab(2);changed();},'mp-link'));
        if(g.target!==null){
          var asset=el('section','mp-asset-progress');asset.appendChild(el('h3',null,'資産目標の進捗'));
          asset.appendChild(el('p',null,'目標額 '+money(g.target)));
          if(stock){
            asset.appendChild(el('strong','mp-value',p.assetRate));
            var meter=el('progress');meter.max=100;meter.value=Math.max(0,Math.min(100,stock.total/g.target*100));meter.setAttribute('aria-label',g.title+'の資産達成率');asset.appendChild(meter);
            asset.appendChild(el('p',null,'現在の記録額 '+money(stock.total)));
            asset.appendChild(el('p',null,p.gap>0?'目標まであと '+money(p.gap):p.gap===0?'目標額に到達しました。':'目標額を '+money(-p.gap)+' 上回っています。'));
            var breakdown=el('details'),summary=el('summary',null,'資産の内訳');breakdown.appendChild(summary);
            stock.groups.forEach(function(x){breakdown.appendChild(el('p','mp-muted',x.name+' '+money(x.amount)));});if(!stock.count)breakdown.appendChild(el('p','mp-muted','資産はまだ登録されていません。'));asset.appendChild(breakdown);
            var planned=plan(g,stock.total);if(planned)asset.appendChild(el('p','mp-muted','翌月から期限月まで'+planned.months+'回、毎月'+money(g.monthly)+'を足した単純合計 '+money(planned.total)+'。運用益は含みません。'));
          }else asset.appendChild(el('p','mp-muted','資産の記録を読み込めないため、達成率は表示できません。'));
          asset.appendChild(el('p','mp-caption','登録した金額の合計です。現在の株価による評価額とは異なります。'));card.appendChild(asset);
        }
        goalList.appendChild(card);
      });
    }
    function field(label,type,parent){var wrap=el('label','mp-field'),n=el(type==='textarea'?'textarea':'input');if(type!=='textarea')n.type=type;wrap.appendChild(el('span',null,label));wrap.appendChild(n);parent.appendChild(wrap);return n;}
    function openGoal(g){
      if(!doc||!editable)return;
      doc.goalDraft=g?{id:g.id,title:g.title,details:g.details,target:g.target===null?'':String(g.target),deadline:g.deadline,monthly:g.monthly===null?'':String(g.monthly)}:{id:'',title:'',details:'',target:'',deadline:'',monthly:''};
      fillGoal();changed();formFields.title.focus();
    }
    function fillGoal(){
      var draft=doc&&doc.goalDraft;goalForm.hidden=!draft;
      if(!draft)return;Object.keys(formFields).forEach(function(k){formFields[k].value=draft[k]||'';});
      goalForm.querySelector('[data-delete-goal]').hidden=!draft.id;
    }
    function saveGoal(event){
      event.preventDefault();if(!doc||!doc.goalDraft)return;
      try{
        var draft=doc.goalDraft;if(!draft.title.trim())throw Error('目標の名前を入力してください。');if(!dateOK(draft.deadline))throw Error('期限の日付を確認してください。');
        var g={id:draft.id||id(),title:draft.title,details:draft.details,target:amount(draft.target,true),deadline:draft.deadline,monthly:amount(draft.monthly,false)};
        var i=doc.goals.findIndex(function(x){return x.id===g.id;});if(i<0)doc.goals.push(g);else doc.goals[i]=g;
        doc.selectedGoalId=g.id;doc.goalDraft=null;fillGoal();renderGoals();renderTodos();changed();
      }catch(e){message(e.message,true);}
    }
    function options(select,rows,blank){var value=select.value;select.replaceChildren();var o=el('option',null,blank);o.value='';select.appendChild(o);rows.forEach(function(x){var n=el('option',null,x.title===undefined?x.name:x.title);n.value=x.id;select.appendChild(n);});select.value=value;}
    function todoEditable(todo){return !!doc&&validOwner()&&editable&&(!todo||doc.todos.indexOf(todo)!==-1);}
    function renderTodos(){
      todoList.replaceChildren();todoCompletedList.replaceChildren();if(!doc)return;
      options(todoGoal,doc.goals,'目標未指定');todoGoal.value=doc.todoDraft.goalId||'';todoText.value=doc.todoDraft.text||'';
      todoDue.value=doc.todoDraft.dueDate||'';todoFlag.checked=doc.todoDraft.flagged===true;
      if(todoFind.value!==todoSearch)todoFind.value=todoSearch;
      todoFilterButtons.forEach(function(item){var active=item.filter===todoFilter;item.button.classList.toggle('on',active);item.button.setAttribute('aria-pressed',String(active));});
      var today=localDateKey(),shown=filterTodos(doc.todos,todoFilter,todoSearch,today),pending=shown.filter(function(t){return !t.done;}),completed=shown.filter(function(t){return t.done;});
      todoCount.textContent=String(pending.length);todoCount.setAttribute('aria-label','表示中の未完了 '+pending.length+'件');
      if(!pending.length)todoList.appendChild(el('li','mp-reminder-empty mp-muted',todoSearch?'条件に一致するやることはありません。':todoFilter==='today'?'今日が期限のやることはありません。':todoFilter==='scheduled'?'期限を設定した未完了のやることはありません。':todoFilter==='flagged'?'フラグ付きの未完了のやることはありません。':doc.todos.length?'未完了のやることはありません。':'やることはまだありません。下の行から追加できます。'));
      function row(t){
        var item=el('li','mp-task'),label=el('label','mp-task-check'),check=el('input');check.type='checkbox';check.checked=t.done;check.setAttribute('aria-label',t.text+'の完了');
        var circle=el('span','mp-task-circle');circle.setAttribute('aria-hidden','true');label.appendChild(check);label.appendChild(circle);item.appendChild(label);
        check.addEventListener('change',async function(){if(!todoEditable(t))return;var done=check.checked,who=owner,generation=epoch;
          if(done&&(t.notificationScheduled||w.KNNotifications&&w.KNNotifications.cancelForTodo)){
            check.disabled=true;
            try{if(!w.KNNotifications)throw Error();if(w.KNNotifications.cancelForTodo)await w.KNNotifications.cancelForTodo(t.id,t.notificationScheduled===true);else await w.KNNotifications.cancelTodo(t.id);}
            catch(ignore){if(who===owner&&generation===epoch&&todoEditable(t)){check.checked=t.done;check.disabled=false;message('通知を取り消せませんでした。完了への変更は保留しています。もう一度お試しください。',true);}return;}
            if(who!==owner||generation!==epoch||!todoEditable(t))return;
            t.notificationScheduled=false;
          }
          t.done=done;renderTodos();renderGoals();changed();if(t.done&&!todoCompleted.hidden&&!todoCompleted.open)todoCompletedSummary.focus();
        });
        var edit=el('details','mp-task-edit'),summary=el('summary','mp-task-title');summary.appendChild(el('span',t.done?'mp-task-text mp-done':'mp-task-text',t.text));
        var meta=el('span','mp-task-meta'),goal=doc.goals.find(function(g){return g.id===t.goalId;});
        if(t.dueDate){var overdue=!t.done&&t.dueDate<today;meta.appendChild(el('span','mp-task-date'+(overdue?' mp-task-overdue':''),(overdue?'期限切れ · ':t.dueDate===today?'今日 · ':'')+dateLabel(t.dueDate)));}
        if(t.flagged){var flagged=el('span','mp-task-flag','⚑');flagged.setAttribute('aria-label','フラグ付き');meta.appendChild(flagged);}
        if(goal)meta.appendChild(el('span','mp-task-goal',goal.title));
        if(meta.children.length)summary.appendChild(meta);edit.appendChild(summary);
        var draft=doc.todoEdits[t.id],text=field('やること','text',edit);text.value=draft?draft.text:t.text;
        var sel=el('select');sel.setAttribute('aria-label','関連する目標');options(sel,doc.goals,'目標未指定');sel.value=draft?draft.goalId:t.goalId;edit.appendChild(sel);
        var due=field('期限（任意）','date',edit),flag=field('フラグを付ける','checkbox',edit);flag.parentNode.classList.add('mp-flag-field');
        due.value=draft&&draft.dueDate!==undefined?draft.dueDate:t.dueDate||'';flag.checked=draft&&draft.flagged!==undefined?draft.flagged:t.flagged===true;edit.open=!!draft;
        summary.addEventListener('click',function(event){if(!edit.open&&todoEditable(t)){event.preventDefault();edit.open=true;text.focus();}});
        function keepEdit(){
          if(!todoEditable(t))return;
          if(!dateOK(due.value)){message('期限の日付を確認してください。',true);return;}
          doc.todoEdits[t.id]=Object.assign({},doc.todoEdits[t.id]||{},{text:text.value,goalId:sel.value,dueDate:due.value,flagged:flag.checked});changed();
        }
        text.addEventListener('input',keepEdit);sel.addEventListener('change',keepEdit);due.addEventListener('input',keepEdit);flag.addEventListener('change',keepEdit);
        edit.appendChild(button('変更を保存',function(){if(!todoEditable(t))return;if(!text.value.trim()){message('やることを入力してください。',true);return;}if(!dateOK(due.value)){message('期限の日付を確認してください。',true);return;}t.text=text.value;t.goalId=sel.value;t.dueDate=due.value;t.flagged=flag.checked;delete doc.todoEdits[t.id];renderTodos();renderGoals();changed();}));
        edit.appendChild(button('削除',async function(){if(!todoEditable(t)||!w.confirm('このやることを削除しますか？'))return;var who=owner,generation=epoch;
          if(t.notificationScheduled||w.KNNotifications&&w.KNNotifications.cancelForTodo){try{if(!w.KNNotifications)throw Error();if(w.KNNotifications.cancelForTodo)await w.KNNotifications.cancelForTodo(t.id,t.notificationScheduled===true);else await w.KNNotifications.cancelTodo(t.id);}catch(ignore){if(who===owner&&generation===epoch&&todoEditable(t))message('通知を取り消せませんでした。やることは削除せず残しています。',true);return;}}
          if(who!==owner||generation!==epoch||!todoEditable(t))return;doc.todos=doc.todos.filter(function(x){return x.id!==t.id;});delete doc.todoEdits[t.id];renderTodos();renderGoals();changed();
        },'mp-link mp-danger'));item.appendChild(edit);return item;
      }
      pending.forEach(function(t){todoList.appendChild(row(t));});completed.forEach(function(t){todoCompletedList.appendChild(row(t));});
      todoCompletedSummary.textContent='完了済み '+completed.length+'件';todoCompleted.hidden=!completed.length;
      if(completed.some(function(t){return !!doc.todoEdits[t.id];}))completedOpen=true;
      todoCompleted.open=completedOpen;
      if(w.KNNotifications)w.KNNotifications.refreshTodos();
    }
    function notesReadable(){return !!doc&&validOwner();}
    function notesEditable(){return !!doc&&validOwner()&&editable;}
    function noteEditorKey(){var n=doc&&selectedNote();return n?JSON.stringify([owner,epoch,n.id]):'';}
    function richNoteReadable(key){return notesReadable()&&key===noteEditorKey();}
    function clearRichNote(){
      if(noteRich){noteRich.destroy();noteRich=null;}noteRichKey='';if(noteRichSlot)noteRichSlot.replaceChildren();
    }
    function loadRichNote(n){
      if(!noteRichSlot)return;if(!n){clearRichNote();return;}
      var key=noteEditorKey();
      // A native IME or undo event may arrive after a note/account switch. Keep
      // each editing context on its own DOM node and retire the old closure.
      if(!noteRich||noteRichKey!==key){
        clearRichNote();noteRichKey=key;var host=el('div');
        noteRich=w.KNMyPageNoteEditor.create(w,{host:host,canRead:richNoteReadable,canEdit:function(k){return notesEditable()&&k===noteEditorKey();},onChange:function(model,body,k){
          if(!notesEditable()||k!==noteEditorKey())return false;
          var selected=selectedNote();selected.body=body;selected.richText=model;noteBody.value=body;renderNotes(true);changed();return true;
        }});
        noteRichSlot.appendChild(noteRich.toolbar);noteRichSlot.appendChild(noteRich.notice);noteRichSlot.appendChild(host);
      }
      noteRich.load(n,key,editable);
    }
    function showNotesView(){
      var editing=notesEditing&&!!(doc&&selectedNote());
      noteLibrary.hidden=editing;noteEditor.hidden=!editing;
    }
    function renderNotes(keepEditor){
      noteList.replaceChildren();groupList.replaceChildren();if(!doc)return;
      var group=doc.groups.find(function(g){return g.id===notesFilter;});
      noteHeading.textContent=group?group.name:'メモ';
      doc.groups.forEach(function(g){
        var row=el('div','mp-note-folder');
        var pick=button(g.name,function(){if(!notesReadable())return;notesFilter=g.id;notesEditing=false;renderNotes(true);noteHeading.focus();},'mp-note-folder-pick');
        pick.setAttribute('aria-pressed',String(notesFilter===g.id));row.appendChild(pick);
        row.appendChild(el('span','mp-note-folder-count',String(doc.notes.filter(function(n){return n.groupId===g.id;}).length)));
        var options=el('details','mp-note-folder-options');options.appendChild(el('summary',null,'操作'));
        options.appendChild(button('名前を変更',function(){if(!notesEditable())return;var name=w.prompt('まとめの名前',g.name);if(name===null||!name.trim())return;g.name=name;renderNotes(true);changed();},'mp-link'));
        options.appendChild(button('まとめを解除',function(){if(!notesEditable()||!w.confirm('まとめを解除しますか？メモは残ります。'))return;doc.notes.forEach(function(n){if(n.groupId===g.id)n.groupId='';});doc.groups=doc.groups.filter(function(x){return x.id!==g.id;});notesFilter='';renderNotes(true);changed();},'mp-link'));row.appendChild(options);groupList.appendChild(row);
      });
      groupList.querySelectorAll('button').forEach(function(control){control.disabled=!editable;});
      groupList.querySelectorAll('.mp-note-folder-pick').forEach(function(control){control.disabled=!notesReadable();});
      var query=search.trim().toLocaleLowerCase();
      var shown=doc.notes.filter(function(n){return (!notesFilter||n.groupId===notesFilter)&&(!query||(n.title+'\n'+n.body).toLocaleLowerCase().includes(query));});
      shown.forEach(function(n){
        var preview=notePreview(n),pick=button('',function(){if(!notesReadable())return;viewNoteId=n.id;if(editable)doc.selectedNoteId=n.id;notesEditing=true;renderNotes();if(editable)changed();noteEditor.focus();},'mp-note-pick');
        pick.disabled=!notesReadable();
        pick.appendChild(el('strong','mp-note-name',preview.title));
        pick.appendChild(el('span','mp-note-excerpt',preview.excerpt||'メモを開く'));
        pick.setAttribute('aria-label',preview.title+'を開く');noteList.appendChild(pick);
      });
      noteCount.textContent=shown.length+'件のメモ';
      if(!shown.length){
        var blank=el('div','mp-note-empty');
        blank.appendChild(el('strong',null,query?'メモが見つかりません':notesFilter?'このフォルダにメモはありません':'メモをはじめましょう'));
        blank.appendChild(el('p',null,query?'別の言葉で検索してみてください。':'右上のボタンから、新しいメモを書けます。'));noteList.appendChild(blank);
      }
      var n=selectedNote();[noteTitle,noteBody,noteDelete].forEach(function(x){x.disabled=!n||!editable;});
      if(!keepEditor){
        noteTitle.value=n?n.title:'';noteBody.value=n?n.body:'';
        loadRichNote(n);
      }
      if(noteRich)noteRich.setEditable(!!n&&editable);
      else if(n&&n.richText!==undefined)noteBody.disabled=true;
      showNotesView();
    }
    function legacyAvailable(){
      try{return !doc.legacyImported&&(!w.localStorage.getItem(claimKey)||w.localStorage.getItem(claimKey)===owner)&&['mp_goal','mp_memo','mp_todos'].some(function(k){var v=w.localStorage.getItem(k);return v&&v!=='[]';});}catch(ignore){return false;}
    }
    async function importOld(){
      if(!doc||!validOwner())return;var who=owner;
      if(!w.confirm('この端末の以前の目標・やること・自由メモを、現在のアカウントへ取り込みますか？元の記録は残ります。'))return;
      try{
        await w.__knGateReady;if(who!==current()||who!==owner)return;
        var claim=w.localStorage.getItem(claimKey);if(claim&&claim!==who)throw Error('legacy_owner');
        var next=importLegacy(doc,{goal:w.localStorage.getItem('mp_goal'),memo:w.localStorage.getItem('mp_memo'),todos:w.localStorage.getItem('mp_todos')});
        w.localStorage.setItem(claimKey,who);if(w.localStorage.getItem(claimKey)!==who)throw Error('legacy_claim');
        doc=next;renderAll();changed();
      }catch(ignore){message('以前の記録を取り込めませんでした。元の記録は保持しています。',true);}
    }
    function renderAll(){renderGoals();fillGoal();renderTodos();renderNotes();legacyButton.hidden=!legacyAvailable();}
    function reset(){
      w.clearTimeout(timer);epoch++;revision=0;savedRevision=0;saving=false;loading=false;doc=null;stock=null;bridge=null;owner=current();notesFilter='';search='';notesEditing=false;viewNoteId='';
      clearRichNote();
      if(!page)return;goalList.replaceChildren();todoList.replaceChildren();noteList.replaceChildren();groupList.replaceChildren();noteTitle.value='';noteBody.value='';todoText.value='';Object.keys(formFields).forEach(function(k){formFields[k].value='';});todoGoal.replaceChildren();todoGoal.value='';noteFind.value='';noteHeading.textContent='メモ';noteCount.textContent='0件のメモ';noteFolders.open=false;showNotesView();goalForm.hidden=true;legacyButton.hidden=true;setEnabled(false);
      todoFilter='all';todoSearch='';completedOpen=false;todoDue.value='';todoFlag.checked=false;todoFind.value='';todoCompletedList.replaceChildren();todoCompleted.open=false;todoCompleted.hidden=true;todoCompletedSummary.textContent='完了済み 0件';todoCount.textContent='0';todoCount.setAttribute('aria-label','表示中の未完了 0件');todoAddDetails.open=false;
      todoFilterButtons.forEach(function(item){var active=item.filter==='all';item.button.classList.toggle('on',active);item.button.setAttribute('aria-pressed',String(active));});
      message(owner?'保存した記録を読み込んでいます…':'ログイン後に記録を表示します。');
    }
    async function load(){
      if(!page||!page.classList.contains('open'))return;
      if(owner!==current())reset();
      var c=child();if(!c){if(w.knPrepareLedger)w.knPrepareLedger();return;}
      if(loading)return;
      if(doc&&revision>savedRevision)return;
      loading=true;var who=owner,version=revision,store=c.kkMyPageStore,generation=epoch;
      try{
        if(boundFrame!==c){boundFrame=c;c.addEventListener('knMyPageStoreChange',function(){if(!saving)load();});}
        var result=await store.load(who);
        if(generation!==epoch||who!==owner||who!==current()||version!==revision)return;
        var next=decode(result.raw);var nextStock;try{nextStock=assets(result.assetsRaw);}catch(ignore){nextStock=null;}
        var same=doc&&JSON.stringify(next)===JSON.stringify(doc);if(!same)doc=next;stock=nextStock;bridge=store;setEnabled(true);
        if(!same)renderAll();else renderGoals();
        message('');if(doc.goalDraft)fillGoal();
      }catch(ignore){if(generation===epoch&&who===owner&&who===current()){setEnabled(false);bridge=null;message('保存した記録を読み込めませんでした。空の記録では上書きしません。再試行してください。',true);}}
      finally{if(generation===epoch&&who===owner)loading=false;}
    }
    function build(){
      page=document.getElementById('myPageOv');if(!page){w.setTimeout(build,200);return;}
      if(page.querySelector('.mp-planner'))return;
      panes=page.querySelectorAll('.mo-pane:not(.kb-pane)');if(panes.length<4){w.setTimeout(build,200);return;}
      [1,2,3].forEach(function(i){panes[i].replaceChildren();panes[i].classList.add('mp-planner');panes[i].setAttribute('data-planner-ready','true');});
      var bar=el('div','mp-planner-bar');status=el('p','mp-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');bar.appendChild(status);retryButton=button('再試行',function(){if(doc&&revision>savedRevision)persist();else load();},'mp-link');retryButton.hidden=true;bar.appendChild(retryButton);page.querySelector('.mo-body').prepend(bar);
      panes[1].appendChild(el('h2','mp-heading','目標と次の一歩'));goalSummary=el('div');panes[1].appendChild(goalSummary);panes[1].appendChild(button('目標を追加',function(){openGoal();}));goalForm=el('form','mp-card mp-form');goalForm.hidden=true;
      formFields.title=field('目標の名前','text',goalForm);formFields.details=field('内容・メモ（任意）','textarea',goalForm);formFields.target=field('目標資産額・円（任意）','text',goalForm);formFields.target.inputMode='decimal';formFields.deadline=field('期限（任意）','date',goalForm);formFields.monthly=field('毎月の積立予定・円（任意）','text',goalForm);formFields.monthly.inputMode='decimal';
      Object.keys(formFields).forEach(function(k){formFields[k].addEventListener('input',function(){if(doc&&doc.goalDraft){doc.goalDraft[k]=formFields[k].value;changed();}});});
      var save=el('button','mp-button','目標を保存');save.type='submit';goalForm.appendChild(save);goalForm.addEventListener('submit',saveGoal);
      goalForm.appendChild(button('閉じる',function(){doc.goalDraft=null;fillGoal();changed();},'mp-link'));
      var del=button('目標を削除',function(){var g=doc.goalDraft;if(!g||!g.id||!w.confirm('目標を削除しますか？関連するやることは目標未指定として残ります。'))return;doc.goals=doc.goals.filter(function(x){return x.id!==g.id;});doc.todos.forEach(function(t){if(t.goalId===g.id)t.goalId='';});doc.goalDraft=null;renderAll();changed();},'mp-link mp-danger');del.setAttribute('data-delete-goal','');goalForm.appendChild(del);panes[1].appendChild(goalForm);goalList=el('div','mp-cards');panes[1].appendChild(goalList);
      legacyButton=button('この端末の以前の記録を取り込む',importOld,'mp-link');legacyButton.hidden=true;panes[1].appendChild(legacyButton);
      panes[2].classList.add('mp-reminders');var remindersHead=el('div','mp-reminders-head');remindersHead.appendChild(el('h2','mp-heading','やることリスト'));todoCount=el('strong','mp-reminders-count','0');remindersHead.appendChild(todoCount);panes[2].appendChild(remindersHead);
      var filters=el('div','mp-reminder-filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','やることの絞り込み');
      [['all','すべて'],['today','今日'],['scheduled','予定あり'],['flagged','フラグ']].forEach(function(item){var control=button(item[1],function(){if(!todoEditable())return;todoFilter=item[0];renderTodos();},'mp-reminder-filter');control.setAttribute('aria-pressed',String(item[0]==='all'));filters.appendChild(control);todoFilterButtons.push({filter:item[0],button:control});});panes[2].appendChild(filters);
      todoFind=el('input','mp-reminder-search');todoFind.type='search';todoFind.placeholder='検索';todoFind.setAttribute('aria-label','リマインダーを検索');todoFind.addEventListener('input',function(){if(!todoEditable())return;todoSearch=todoFind.value;renderTodos();});panes[2].appendChild(todoFind);
      todoList=el('ul','mp-tasks');panes[2].appendChild(todoList);todoCompleted=el('details','mp-completed');todoCompletedSummary=el('summary',null,'完了済み 0件');todoCompleted.appendChild(todoCompletedSummary);todoCompletedList=el('ul','mp-completed-tasks');todoCompleted.appendChild(todoCompletedList);todoCompleted.addEventListener('toggle',function(){completedOpen=todoCompleted.open;});panes[2].appendChild(todoCompleted);
      var add=el('form','mp-reminder-add'),addLine=el('div','mp-add-line'),addButton=el('button','mp-reminder-add-button','＋');addButton.type='submit';addButton.setAttribute('aria-label','新しいリマインダーを追加');addLine.appendChild(addButton);
      todoText=el('input','mp-reminder-new-input');todoText.type='text';todoText.id='mpTodoInput';todoText.placeholder='新しいリマインダー';todoText.setAttribute('aria-label','新しいリマインダー');addLine.appendChild(todoText);add.appendChild(addLine);
      todoAddDetails=el('details','mp-add-details');todoAddDetails.appendChild(el('summary',null,'詳細'));var goalField=el('label','mp-field');goalField.appendChild(el('span',null,'関連する目標'));todoGoal=el('select');todoGoal.setAttribute('aria-label','関連する目標');goalField.appendChild(todoGoal);todoAddDetails.appendChild(goalField);
      todoDue=field('期限（任意）','date',todoAddDetails);todoDue.id='mpTodoDueDate';todoFlag=field('フラグを付ける','checkbox',todoAddDetails);todoFlag.id='mpTodoFlagged';todoFlag.parentNode.classList.add('mp-flag-field');add.appendChild(todoAddDetails);panes[2].appendChild(add);
      if(w.KNNotifications)w.KNNotifications.attachPlanner({root:panes[2],getTodos:function(){return doc&&validOwner()?doc.todos:[];},canEdit:function(){return todoEditable();},markScheduled:function(id,value){if(!todoEditable())return;var t=doc.todos.find(function(t){return t.id===id;});if(t&&!t.done){t.notificationScheduled=value;changed();}}});

      function keepNewTodo(){if(!todoEditable())return;if(!dateOK(todoDue.value)){message('期限の日付を確認してください。',true);return;}doc.todoDraft=Object.assign({},doc.todoDraft,{text:todoText.value,goalId:todoGoal.value,dueDate:todoDue.value,flagged:todoFlag.checked});changed();}
      todoText.addEventListener('input',keepNewTodo);todoGoal.addEventListener('change',keepNewTodo);todoDue.addEventListener('input',keepNewTodo);todoFlag.addEventListener('change',keepNewTodo);
      add.addEventListener('submit',function(e){e.preventDefault();if(!todoEditable()||!todoText.value.trim())return;if(!dateOK(todoDue.value)){message('期限の日付を確認してください。',true);return;}doc.todos.push({id:id(),text:todoText.value,done:false,goalId:todoGoal.value,dueDate:todoDue.value,flagged:todoFlag.checked});doc.todoDraft=Object.assign({},doc.todoDraft,{text:'',dueDate:'',flagged:false});todoFilter='all';todoSearch='';renderTodos();renderGoals();changed();todoText.focus();});
      panes[3].classList.add('mp-notebook');
      noteLibrary=el('section','mp-note-library');panes[3].appendChild(noteLibrary);
      var notesHead=el('div','mp-note-head');noteHeading=el('h2','mp-heading','メモ');noteHeading.tabIndex=-1;notesHead.appendChild(noteHeading);
      var compose=button('メモを追加',function(){
        if(!notesEditable())return;var n={id:id(),title:'',body:'',groupId:notesFilter};doc.notes.push(n);doc.selectedNoteId=n.id;viewNoteId=n.id;search='';noteFind.value='';notesEditing=true;renderNotes();changed();if(noteRich)noteRich.focus();else noteBody.focus();
      },'mp-note-compose');compose.setAttribute('aria-label','新しいメモを書く');notesHead.appendChild(compose);noteLibrary.appendChild(notesHead);
      noteFind=el('input','mp-note-search');noteFind.type='search';noteFind.placeholder='検索';noteFind.setAttribute('aria-label','メモを検索');
      noteFind.addEventListener('input',function(){if(!notesReadable())return;search=noteFind.value;renderNotes(true);});noteLibrary.appendChild(noteFind);
      noteFolders=el('details','mp-note-folders');noteFolders.appendChild(el('summary',null,'フォルダ'));
      noteFolders.appendChild(button('すべてのメモ',function(){if(!notesReadable())return;notesFilter='';renderNotes(true);},'mp-link mp-note-all'));
      groupList=el('div','mp-groups');noteFolders.appendChild(groupList);
      noteFolders.appendChild(button('まとめを作る',function(){if(!notesEditable())return;var name=w.prompt('まとめの名前');if(name===null||!name.trim())return;doc.groups.push({id:id(),name:name});renderNotes(true);changed();},'mp-link'));noteLibrary.appendChild(noteFolders);
      noteList=el('nav','mp-notes');noteList.setAttribute('aria-label','メモ一覧');noteLibrary.appendChild(noteList);
      noteCount=el('p','mp-note-count','0件のメモ');noteLibrary.appendChild(noteCount);
      noteEditor=el('section','mp-note-editor');noteEditor.setAttribute('aria-label','メモを編集');noteEditor.tabIndex=-1;noteEditor.hidden=true;
      var noteToolbar=el('div','mp-note-toolbar');
      noteToolbar.appendChild(button('メモ一覧',function(){notesEditing=false;showNotesView();noteHeading.focus();},'mp-note-back'));
      noteDelete=button('このメモを削除',function(){var n=doc&&selectedNote();if(!notesEditable()||!n||!w.confirm('このメモを削除しますか？'))return;doc.notes=doc.notes.filter(function(x){return x.id!==n.id;});doc.selectedNoteId='';viewNoteId='';notesEditing=false;renderNotes();changed();noteHeading.focus();},'mp-link mp-danger');noteToolbar.appendChild(noteDelete);noteEditor.appendChild(noteToolbar);
      noteTitle=el('input','mp-note-title');noteTitle.type='text';noteTitle.placeholder='タイトル';noteTitle.setAttribute('aria-label','タイトル（任意）');noteEditor.appendChild(noteTitle);
      noteBody=el('textarea','mp-note-body');noteBody.id='mpMemo';noteBody.rows=14;noteBody.placeholder='ここから書きはじめる';noteBody.setAttribute('aria-label','自由メモ');noteEditor.appendChild(noteBody);
      if(w.KNMyPageNoteEditor&&w.KNMyPageNoteEditor.canMount(w)){
        noteBody.hidden=true;noteBody.tabIndex=-1;noteRichSlot=el('div','mp-note-writing');noteEditor.appendChild(noteRichSlot);
      }
      function editNote(key,value){var n=doc&&selectedNote();if(!notesEditable()||!n||key==='body'&&(noteRich||n.richText!==undefined))return;n[key]=value;renderNotes(true);changed();}
      noteTitle.addEventListener('input',function(){editNote('title',noteTitle.value);});noteBody.addEventListener('input',function(){editNote('body',noteBody.value);});panes[3].appendChild(noteEditor);
      if(w.location&&w.location.hash==='#todo-reminders'){page.classList.add('open');goTab(2);if(w.knPrepareLedger)w.knPrepareLedger();}
      document.addEventListener('knAuthChange',function(){if(owner!==current())reset();load();});
      page.querySelectorAll('.mo-tab,.mp-toptab').forEach(function(t){t.addEventListener('click',load);});
      new w.MutationObserver(function(){if(page.classList.contains('open'))load();}).observe(page,{attributes:true,attributeFilter:['class']});
      w.addEventListener('storage',function(e){if(!e.key||e.key==='kn_ledger_owner'){if(owner!==current())reset();load();}});
      w.addEventListener('message',function(event){
        var frame=page.querySelector('.kb-frame');
        if(frame&&event.origin===w.location.origin&&event.source===frame.contentWindow&&event.data&&event.data.type==='kn-mypage-records-ready')load();
      });
      reset();load();w.setInterval(function(){if(!doc&&page.classList.contains('open'))load();},1500);
    }
    if(document.readyState!=='complete')document.addEventListener('DOMContentLoaded',build,{once:true});
    if(document.readyState!=='loading')build();
  }
  return Object.freeze({empty:empty,decode:decode,localDateKey:localDateKey,filterTodos:filterTodos,notePreview:notePreview,amount:amount,assets:assets,money:money,percent:percent,progress:progress,plan:plan,importLegacy:importLegacy,mount:mount});
});

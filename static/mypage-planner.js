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
      if(k==='notes'&&(!str(x.title)||!str(x.body)||!str(x.groupId)||x.pinned!==undefined&&typeof x.pinned!=='boolean'))throw Error('planner_format');
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
    var page,panes,status,doc=null,stock=null,owner='',bridge=null,loading=false,revision=0,saving=false,savedRevision=0,timer,search='',boundFrame=null,epoch=0,editable=false;
    var retryButton,goalList,goalForm,noteList,noteTitle,noteBody,legacyButton,formFields={},goalSummary;
    var notesEditing=false,viewNoteId='',noteLibrary,noteEditor,noteFind,noteHeading,noteCount,noteDelete,notePin,noteRich=null,noteRichSlot=null,noteRichKey='';
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
      page.querySelectorAll('.mp-note-pick,.mp-note-back,.mp-note-search').forEach(function(n){n.disabled=!notesReadable();});
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
    function renderGoals(){
      goalList.replaceChildren();goalSummary.replaceChildren();
      if(!doc)return;
      if(!doc.goals.length)goalList.appendChild(el('p','mp-muted','NISA、株や経済の勉強など、取り組みたい目標を自由に追加できます。'));
      doc.goals.forEach(function(g){
        var card=el('article','mp-card'),head=el('div','mp-row');head.appendChild(button(g.title,function(){pickGoal(g);},'mp-goal-title'));head.appendChild(button('編集',function(){openGoal(g);},'mp-link'));card.appendChild(head);
        if(g.details)card.appendChild(el('p','mp-preserve',g.details));
        var p=progress(g,stock,[]);
        if(g.deadline)card.appendChild(el('p','mp-muted',dateLabel(g.deadline)+' 目標の期限'));
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
        doc.selectedGoalId=g.id;doc.goalDraft=null;fillGoal();renderGoals();changed();
      }catch(e){message(e.message,true);}
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
    function updateNotePin(control,n){
      var pinned=!!n&&n.pinned===true,label=pinned?'ピン留めを解除':'ピン留め';
      control.setAttribute('aria-pressed',String(pinned));
      control.setAttribute('aria-label',n?notePreview(n).title+'の'+label:label);
      control.title=label;control.disabled=!n||!notesEditable();
      if(control===notePin)control.textContent=label;
    }
    function toggleNotePin(n,fromList){
      // Detached controls from a removed note or an earlier owner cannot save.
      if(!notesEditable()||doc.notes.indexOf(n)<0)return;
      n.pinned=n.pinned!==true;renderNotes(true);changed();
      var control=fromList?Array.from(noteList.querySelectorAll('.mp-note-pin')).find(function(x){return x.getAttribute('data-note-pin-id')===n.id;}):notePin;
      if(control)control.focus();
    }
    function renderNotes(keepEditor){
      noteList.replaceChildren();if(!doc)return;
      var query=search.trim().toLocaleLowerCase();
      // Folder membership remains in storage; the single list includes every note.
      // Sort a derived array only, keeping the original order within both groups.
      var shown=doc.notes.filter(function(n){return !query||(n.title+'\n'+n.body).toLocaleLowerCase().includes(query);}).sort(function(a,b){return Number(b.pinned===true)-Number(a.pinned===true);});
      shown.forEach(function(n){
        var row=el('div','mp-note-entry');
        var preview=notePreview(n),pick=button('',function(){if(!notesReadable())return;viewNoteId=n.id;if(editable)doc.selectedNoteId=n.id;notesEditing=true;renderNotes();if(editable)changed();noteEditor.focus();},'mp-note-pick');
        pick.disabled=!notesReadable();
        pick.appendChild(el('strong','mp-note-name',preview.title));
        pick.appendChild(el('span','mp-note-excerpt',preview.excerpt||'メモを開く'));
        pick.setAttribute('aria-label',preview.title+'を開く');row.appendChild(pick);
        var pin=button('',function(){toggleNotePin(n,true);},'mp-note-pin');
        pin.setAttribute('data-note-pin-id',n.id);updateNotePin(pin,n);row.appendChild(pin);noteList.appendChild(row);
      });
      noteCount.textContent=shown.length+'件のメモ';
      if(!shown.length&&query){
        var blank=el('div','mp-note-empty');
        blank.appendChild(el('strong',null,'メモが見つかりません'));
        blank.appendChild(el('p',null,'別の言葉で検索してみてください。'));noteList.appendChild(blank);
      }
      var n=selectedNote();[noteTitle,noteBody,noteDelete].forEach(function(x){x.disabled=!n||!editable;});
      updateNotePin(notePin,n);
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
      if(!w.confirm('この端末の以前の記録を、現在のアカウントへ取り込みますか？元の記録は残ります。'))return;
      try{
        await w.__knGateReady;if(who!==current()||who!==owner)return;
        var claim=w.localStorage.getItem(claimKey);if(claim&&claim!==who)throw Error('legacy_owner');
        var next=importLegacy(doc,{goal:w.localStorage.getItem('mp_goal'),memo:w.localStorage.getItem('mp_memo'),todos:w.localStorage.getItem('mp_todos')});
        w.localStorage.setItem(claimKey,who);if(w.localStorage.getItem(claimKey)!==who)throw Error('legacy_claim');
        doc=next;renderAll();changed();
      }catch(ignore){message('以前の記録を取り込めませんでした。元の記録は保持しています。',true);}
    }
    function renderAll(){renderGoals();fillGoal();renderNotes();legacyButton.hidden=!legacyAvailable();}
    function reset(){
      w.clearTimeout(timer);epoch++;revision=0;savedRevision=0;saving=false;loading=false;doc=null;stock=null;bridge=null;owner=current();search='';notesEditing=false;viewNoteId='';
      clearRichNote();
      if(!page)return;goalList.replaceChildren();noteList.replaceChildren();noteTitle.value='';noteBody.value='';Object.keys(formFields).forEach(function(k){formFields[k].value='';});noteFind.value='';noteHeading.textContent='メモ';noteCount.textContent='0件のメモ';updateNotePin(notePin,null);showNotesView();goalForm.hidden=true;legacyButton.hidden=true;setEnabled(false);
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
      panes=page.querySelectorAll('.mo-pane:not(.kb-pane)');if(panes.length<4){w.setTimeout(build,200);return;}
      // Keep the old index reserved so the surviving memo remains slot three.
      // No retired controls or notification context are mounted in this slot.
      [page.querySelectorAll('.mo-tab')[2],panes[2]].forEach(function(slot){
        if(!slot)return;slot.replaceChildren();slot.hidden=true;slot.inert=true;slot.tabIndex=-1;
        slot.classList.add('mp-todo-retired');slot.classList.remove('on');
        slot.setAttribute('aria-hidden','true');slot.setAttribute('data-retired-todo','true');
      });
      if(page.querySelector('.mp-planner'))return;
      [1,3].forEach(function(i){panes[i].replaceChildren();panes[i].classList.add('mp-planner');panes[i].setAttribute('data-planner-ready','true');});
      var bar=el('div','mp-planner-bar');status=el('p','mp-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');bar.appendChild(status);retryButton=button('再試行',function(){if(doc&&revision>savedRevision)persist();else load();},'mp-link');retryButton.hidden=true;bar.appendChild(retryButton);page.querySelector('.mo-body').prepend(bar);
      panes[1].appendChild(el('h2','mp-heading','目標'));goalSummary=el('div');panes[1].appendChild(goalSummary);panes[1].appendChild(button('目標を追加',function(){openGoal();}));goalForm=el('form','mp-card mp-form');goalForm.hidden=true;
      formFields.title=field('目標の名前','text',goalForm);formFields.details=field('内容・メモ（任意）','textarea',goalForm);formFields.target=field('目標資産額・円（任意）','text',goalForm);formFields.target.inputMode='decimal';formFields.deadline=field('期限（任意）','date',goalForm);formFields.monthly=field('毎月の積立予定・円（任意）','text',goalForm);formFields.monthly.inputMode='decimal';
      Object.keys(formFields).forEach(function(k){formFields[k].addEventListener('input',function(){if(doc&&doc.goalDraft){doc.goalDraft[k]=formFields[k].value;changed();}});});
      var save=el('button','mp-button','目標を保存');save.type='submit';goalForm.appendChild(save);goalForm.addEventListener('submit',saveGoal);
      goalForm.appendChild(button('閉じる',function(){doc.goalDraft=null;fillGoal();changed();},'mp-link'));
      var del=button('目標を削除',function(){var g=doc.goalDraft;if(!g||!g.id||!w.confirm('目標を削除しますか？'))return;doc.goals=doc.goals.filter(function(x){return x.id!==g.id;});doc.goalDraft=null;renderAll();changed();},'mp-link mp-danger');del.setAttribute('data-delete-goal','');goalForm.appendChild(del);panes[1].appendChild(goalForm);goalList=el('div','mp-cards');panes[1].appendChild(goalList);
      legacyButton=button('この端末の以前の記録を取り込む',importOld,'mp-link');legacyButton.hidden=true;panes[1].appendChild(legacyButton);
      panes[3].classList.add('mp-notebook');
      noteLibrary=el('section','mp-note-library');panes[3].appendChild(noteLibrary);
      var notesHead=el('div','mp-note-head');noteHeading=el('h2','mp-heading','メモ');noteHeading.tabIndex=-1;notesHead.appendChild(noteHeading);
      var compose=button('メモを追加',function(){
        if(!notesEditable())return;var n={id:id(),title:'',body:'',groupId:''};doc.notes.push(n);doc.selectedNoteId=n.id;viewNoteId=n.id;search='';noteFind.value='';notesEditing=true;renderNotes();changed();if(noteRich)noteRich.focus();else noteBody.focus();
      },'mp-note-compose');compose.setAttribute('aria-label','新しいメモを書く');notesHead.appendChild(compose);noteLibrary.appendChild(notesHead);
      noteFind=el('input','mp-note-search');noteFind.type='search';noteFind.placeholder='検索';noteFind.setAttribute('aria-label','メモを検索');
      noteFind.addEventListener('input',function(){if(!notesReadable())return;search=noteFind.value;renderNotes(true);});noteLibrary.appendChild(noteFind);
      noteList=el('nav','mp-notes');noteList.setAttribute('aria-label','メモ一覧');noteLibrary.appendChild(noteList);
      noteCount=el('p','mp-note-count','0件のメモ');noteLibrary.appendChild(noteCount);
      noteEditor=el('section','mp-note-editor');noteEditor.setAttribute('aria-label','メモを編集');noteEditor.tabIndex=-1;noteEditor.hidden=true;
      var noteToolbar=el('div','mp-note-toolbar');
      noteToolbar.appendChild(button('メモ一覧',function(){notesEditing=false;showNotesView();noteHeading.focus();},'mp-note-back'));
      notePin=button('ピン留め',function(){toggleNotePin(doc&&selectedNote(),false);},'mp-note-pin mp-note-pin-editor');noteToolbar.appendChild(notePin);
      noteDelete=button('このメモを削除',function(){var n=doc&&selectedNote();if(!notesEditable()||!n||!w.confirm('このメモを削除しますか？'))return;doc.notes=doc.notes.filter(function(x){return x.id!==n.id;});doc.selectedNoteId='';viewNoteId='';notesEditing=false;renderNotes();changed();noteHeading.focus();},'mp-link mp-danger');noteToolbar.appendChild(noteDelete);noteEditor.appendChild(noteToolbar);
      noteTitle=el('input','mp-note-title');noteTitle.type='text';noteTitle.placeholder='タイトル';noteTitle.setAttribute('aria-label','タイトル（任意）');noteEditor.appendChild(noteTitle);
      noteBody=el('textarea','mp-note-body');noteBody.id='mpMemo';noteBody.rows=14;noteBody.placeholder='ここから書きはじめる';noteBody.setAttribute('aria-label','自由メモ');noteEditor.appendChild(noteBody);
      if(w.KNMyPageNoteEditor&&w.KNMyPageNoteEditor.canMount(w)){
        noteBody.hidden=true;noteBody.tabIndex=-1;noteRichSlot=el('div','mp-note-writing');noteEditor.appendChild(noteRichSlot);
      }
      function editNote(key,value){var n=doc&&selectedNote();if(!notesEditable()||!n||key==='body'&&(noteRich||n.richText!==undefined))return;n[key]=value;renderNotes(true);changed();}
      noteTitle.addEventListener('input',function(){editNote('title',noteTitle.value);});noteBody.addEventListener('input',function(){editNote('body',noteBody.value);});panes[3].appendChild(noteEditor);
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

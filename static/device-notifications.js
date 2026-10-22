/* Opt-in notification UI. No timer, quote fetch, secret key or message text upload. */
(function(root,factory){
  'use strict';var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document)root.KNNotifications=api.create(root);
})(typeof window==='undefined'?null:window,function(){
  'use strict';
  function dateTime(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('invalid_time');
    var d=new Date(value),parts=value.split(/[-T:]/).map(Number);
    if(!Number.isFinite(d.getTime())||d.getFullYear()!==parts[0]||d.getMonth()+1!==parts[1]||d.getDate()!==parts[2]||d.getHours()!==parts[3]||d.getMinutes()!==parts[4])throw Error('invalid_time');
    return d.toISOString();
  }
  function create(w){
    var doc=w.document,serial=0,identity='',config=null,reminders=[],subscribed=0,context=null,section=null,message=null,select=null,date=null,save=null,enable=null,disable=null,busy=false,ownerReset=Promise.resolve(),taskOperations=Object.create(null);
    function owner(){return w.knUser&&w.knUser.is_anonymous===false?String(w.knUser.id||''):'';}
    function same(key,generation){return !!key&&key===owner()&&key===identity&&generation===serial;}
    function el(tag,text){var n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
    function announce(text){if(message)message.textContent=text;}
    function fixed(error){
      return ({task_changed:'やることが変更されたため、通知を取り消しました。',account_changed:'アカウントが切り替わりました。開き直してください。',auth_required:'ログインしてから設定してください。',conflict:'別の画面で設定が変わりました。通知設定を再読み込みしてください。',invalid_time:'通知日時を確認してください。',invalid_request:'通知日時は30秒後から1年以内で設定してください。',not_configured:'端末通知は準備中です。',unsupported:'この端末では通知を利用できません。',permission:'通知は許可されていません。端末の設定を確認してください。',home_screen:'iPhone・iPadはこのサイトをホーム画面に追加して、そのアイコンから開いてください。',price_source_unverified:'価格通知は取得元の利用条件を確認中です。'})[error&&error.message]||'通知設定を確認できませんでした。再読み込みして確認してください。';
    }
    async function token(key,generation){
      var result=await w.sb.auth.getSession(),session=result&&result.data&&result.data.session;
      if(!same(key,generation))throw Error('account_changed');
      if(result.error||!session||!session.access_token||!session.user||session.user.id!==key||session.user.is_anonymous!==false)throw Error('auth_required');
      return session.access_token;
    }
    async function request(path,method,data,key,generation){
      if(!same(key,generation)||!w.sb||!w.sb.auth)throw Error('auth_required');
      var auth=await token(key,generation);
      var response=await w.fetch('/api/notifications/'+path,{method:method||'GET',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),cache:'no-store',credentials:'omit',redirect:'error'});
      if(!same(key,generation))throw Error('account_changed');
      var value=await response.json();
      if(!same(key,generation))throw Error('account_changed');
      if(!response.ok||!value||value.ok!==true)throw Error(value&&typeof value.reason==='string'?value.reason:'unavailable');
      return value;
    }
    function compatible(){
      if(!w.isSecureContext||!w.Notification||!w.navigator.serviceWorker||!w.PushManager)throw Error('unsupported');
      var ios=/iPad|iPhone|iPod/.test(w.navigator.userAgent||'')||w.navigator.platform==='MacIntel'&&w.navigator.maxTouchPoints>1;
      if(ios&&!w.navigator.standalone&&!(w.matchMedia&&w.matchMedia('(display-mode: standalone)').matches))throw Error('home_screen');
    }
    function paint(){
      if(!section)return;
      enable.disabled=busy||!identity||!config||!config.enabled;
      disable.disabled=busy||!identity;
      save.disabled=busy||!identity||!config||!config.enabled||!subscribed||!select.value;
      if(!identity)announce('ログイン後に端末通知を設定できます。');
      else if(config&&!config.enabled)announce('端末通知は準備中です。通知の配信確認はまだ完了していません。');
    }
    function refreshTodos(){
      if(!select)return;
      var selected=select.value;select.replaceChildren();
      var todos=context&&context.getTodos?context.getTodos():[];
      todos.filter(function(t){return !t.done;}).forEach(function(t){var o=el('option',t.text);o.value=t.id;select.appendChild(o);});
      if(Array.from(select.options||[]).some(function(o){return o.value===selected;}))select.value=selected;
      paint();
    }
    async function refresh(){
      var key=owner();if(key!==identity){serial++;identity=key;reminders=[];subscribed=0;busy=false;taskOperations=Object.create(null);ownerReset=clearWorkerOwner();}
      var generation=serial;
      try{
        var response=await w.fetch('/api/notifications/config',{cache:'no-store',credentials:'omit',redirect:'error'});
        var data=await response.json();if(generation!==serial||key!==owner())return;
        if(!response.ok||!data||data.ok!==true)throw Error('unavailable');config=data;
        if(key&&config.enabled){
          var state=await request('status','GET',undefined,key,generation);
          reminders=state.reminders;subscribed=state.subscription_count;
          announce('通知日時はこの端末の時間帯で指定します。内容は「やることリストの確認」として届きます。');
        }
      }catch(error){if(generation===serial&&key===owner())announce(fixed(error));}
      paint();refreshTodos();
    }
    async function registration(){return w.navigator.serviceWorker.getRegistration('/notifications/');}
    async function workerMessage(reg,data){
      var target=reg&&(reg.active||reg.waiting||reg.installing);
      if(!target)return null;
      return new Promise(function(resolve,reject){
        var channel=new w.MessageChannel(),timer=w.setTimeout(function(){channel.port1.close();reject(Error('unavailable'));},5000);
        channel.port1.onmessage=function(event){w.clearTimeout(timer);channel.port1.close();if(event.data&&event.data.ok)resolve(event.data);else reject(Error('unavailable'));};
        target.postMessage(data,[channel.port2]);
      });
    }
    async function workerOwner(reg,key){return workerMessage(reg,{kind:'notification-owner',owner_id:key});}
    async function clearWorkerOwner(){
      var generation=serial,key=owner();
      try{
        if(!w.navigator.serviceWorker)return;
        var reg=await registration();if(!reg)return;
        var current=await workerMessage(reg,{kind:'notification-owner-read'});
        if(generation===serial&&key===owner()&&current&&current.owner_id!==key)await workerOwner(reg,'');
      }catch(_){}
    }
    function keyBytes(value){var s=w.atob(value.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(s,function(c){return c.charCodeAt(0);});}
    async function activate(){
      if(busy)return;
      var key=identity,generation=serial;
      try{
        compatible();if(!config||!config.enabled)throw Error('not_configured');
        if(!same(key,generation))throw Error('auth_required');
        // Permission is requested directly from this button's user gesture.
        var permission=w.Notification.requestPermission();
        busy=true;paint();
        if(await permission!=='granted')throw Error('permission');
        if(!same(key,generation))throw Error('account_changed');
        var reg=await w.navigator.serviceWorker.register('/notifications-worker.js',{scope:'/notifications/',updateViaCache:'none'});
        if(!same(key,generation))throw Error('account_changed');
        // Wait for an active worker without using serviceWorker.ready (its scope excludes this page).
        if(!reg.active)await new Promise(function(resolve,reject){
          var worker=reg.installing||reg.waiting,timer=w.setTimeout(function(){reject(Error('unavailable'));},10000);
          if(!worker){w.clearTimeout(timer);reject(Error('unavailable'));return;}
          worker.addEventListener('statechange',function(){if(worker.state==='activated'){w.clearTimeout(timer);resolve();}else if(worker.state==='redundant'){w.clearTimeout(timer);reject(Error('unavailable'));}});
        });
        if(!same(key,generation))throw Error('account_changed');
        var sub=await reg.pushManager.getSubscription();
        // A browser subscription is never silently moved to another Auth owner.
        if(sub){await request('subscriptions','DELETE',{endpoint:sub.endpoint},key,generation);await sub.unsubscribe();}
        sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(config.public_key)});
        if(!same(key,generation)){await sub.unsubscribe();throw Error('account_changed');}
        var raw=sub.toJSON();try{await request('subscriptions','POST',{endpoint:raw.endpoint,keys:raw.keys},key,generation);}catch(e){await sub.unsubscribe();throw e;}
        await ownerReset;if(!same(key,generation))throw Error('account_changed');
        await workerOwner(reg,key);subscribed=Math.max(1,subscribed);
        announce('この端末の通知を登録しました。通知日時を保存できます。');
      }catch(error){if(generation===serial&&key===owner())announce(fixed(error));}
      finally{if(generation===serial){busy=false;paint();}}
    }
    async function deactivate(){
      if(busy)return;var key=identity,generation=serial;busy=true;paint();
      try{
        var reg=await registration(),sub=reg&&await reg.pushManager.getSubscription();
        if(!same(key,generation))throw Error('account_changed');
        if(sub){await request('subscriptions','DELETE',{endpoint:sub.endpoint},key,generation);await sub.unsubscribe();}
        await workerOwner(reg,'');subscribed=0;announce('この端末の通知を解除しました。');
      }catch(error){if(same(key,generation))announce(fixed(error));}
      finally{if(generation===serial){busy=false;paint();}}
    }
    function taskOperation(id,operation){
      var table=taskOperations,previous=table[id]||Promise.resolve();
      var next=previous.catch(function(){}).then(operation);table[id]=next;
      next.then(function(){if(table[id]===next)delete table[id];},function(){if(table[id]===next)delete table[id];});
      return next;
    }
    function cancelTodo(id){
      var key=identity,generation=serial;
      return taskOperation(id,async function(){
        await request('reminders/'+encodeURIComponent(id),'DELETE',undefined,key,generation);
        reminders=reminders.filter(function(r){return r.task_id!==id;});
        return true;
      });
    }
    async function cancelForTodo(id,wasScheduled){
      var key=identity,generation=serial;
      if(!key&&!wasScheduled)return true;
      if(!config){
        var response=await w.fetch('/api/notifications/config',{cache:'no-store',credentials:'omit',redirect:'error'}),value=await response.json();
        if(!same(key,generation))throw Error('account_changed');
        if(!response.ok||!value||value.ok!==true)throw Error('unavailable');
        config=value;
      }
      // Also cancel a schedule created from another tab before its planner marker synced.
      if(config.enabled||wasScheduled)return cancelTodo(id);
      return true;
    }
    async function schedule(){
      if(busy)return;var key=identity,generation=serial,id=select.value;
      try{
        if(!context||!context.canEdit()||!context.getTodos().some(function(t){return t.id===id&&!t.done;}))throw Error('account_changed');
        var due=dateTime(date.value),old=reminders.find(function(r){return r.task_id===id;});
        var zone=w.Intl.DateTimeFormat().resolvedOptions().timeZone;
        busy=true;paint();
        await taskOperation(id,async function(){
          if(!same(key,generation)||!context.canEdit()||!context.getTodos().some(function(t){return t.id===id&&!t.done;}))throw Error('account_changed');
          var result=await request('reminders/'+encodeURIComponent(id),'PUT',{due_at:due,timezone:zone,expected_revision:old?old.revision:0},key,generation);
          if(!context.canEdit()||!same(key,generation))throw Error('account_changed');
          if(!context.getTodos().some(function(t){return t.id===id&&!t.done;})){
            // Do not enqueue behind our own operation: retire the just-created schedule directly.
            await request('reminders/'+encodeURIComponent(id),'DELETE',undefined,key,generation);
            throw Error('task_changed');
          }
          context.markScheduled(id,true);
          reminders=reminders.filter(function(r){return r.task_id!==id;});reminders.push({task_id:id,due_at:due,timezone:zone,revision:result.revision,state:'scheduled'});
          announce('通知日時を保存しました。端末がオフラインの間や配信処理の停止中は、通知が遅れたり届かない場合があります。');
        });
      }catch(error){if(generation===serial&&key===owner())announce(fixed(error));}
      finally{if(generation===serial){busy=false;paint();}}
    }
    function attachPlanner(next){
      context=next;if(section)return refreshTodos();
      section=el('section');section.className='kn-notification-settings';section.setAttribute('aria-label','端末通知');
      var heading=el('h3','端末通知');section.appendChild(heading);
      message=el('p');message.setAttribute('role','status');message.setAttribute('aria-live','polite');section.appendChild(message);
      enable=el('button','この端末で通知を使う');enable.type='button';enable.addEventListener('click',activate);section.appendChild(enable);
      disable=el('button','この端末の通知を解除');disable.type='button';disable.addEventListener('click',deactivate);section.appendChild(disable);
      var reload=el('button','通知設定を再読み込み');reload.type='button';reload.addEventListener('click',refresh);section.appendChild(reload);
      var label=el('label','通知するやること');select=el('select');label.appendChild(select);section.appendChild(label);select.addEventListener('change',paint);
      label=el('label','通知日時');date=el('input');date.type='datetime-local';label.appendChild(date);section.appendChild(label);
      save=el('button','通知日時を保存');save.type='button';save.addEventListener('click',schedule);section.appendChild(save);
      var cancel=el('button','選んだやることの通知を取り消す');cancel.type='button';cancel.addEventListener('click',async function(){
        if(busy||!select.value)return;var key=identity,generation=serial,id=select.value;
        busy=true;paint();try{await cancelTodo(id);if(same(key,generation)&&context.canEdit()){context.markScheduled(id,false);announce('通知を取り消しました。すでに端末へ送信済みの通知は取り消せません。');}}catch(e){if(same(key,generation))announce(fixed(e));}finally{if(generation===serial){busy=false;paint();}}
      });section.appendChild(cancel);
      next.root.appendChild(section);refresh();
    }
    function pricePanel(){
      var target=doc.getElementById('stock-watch-saved');if(!target||target.querySelector('[data-price-draft]'))return;
      var panel=el('details');panel.className='kn-notification-settings';panel.setAttribute('data-price-draft','');
      panel.appendChild(el('summary','価格通知の条件を準備'));
      panel.appendChild(el('p','価格取得元の利用条件を確認中のため、価格監視・通知はまだ動きません。条件だけ下書き保存できます。'));
      var form=el('form'),symbol=el('select'),direction=el('select'),threshold=el('input'),status=el('p'),submit=el('button','条件を下書き保存');
      symbol.setAttribute('aria-label','お気に入りの銘柄');direction.setAttribute('aria-label','価格通知の条件');threshold.type='number';threshold.min='0.00000001';threshold.step='any';threshold.setAttribute('aria-label','条件の数値');submit.type='submit';status.setAttribute('role','status');
      [['above','指定価格以上・円'],['below','指定価格以下・円'],['percent_up','前日終値からの上昇率・％']].forEach(function(x){var o=el('option',x[1]);o.value=x[0];direction.appendChild(o);});
      form.appendChild(symbol);form.appendChild(direction);form.appendChild(threshold);form.appendChild(submit);panel.appendChild(form);panel.appendChild(status);target.appendChild(panel);
      panel.addEventListener('toggle',async function(){
        if(!panel.open)return;var generation=serial,key=owner();var selected=symbol.value;symbol.replaceChildren();
        try{
          if(w.__knGateReady)await w.__knGateReady;if(generation!==serial||key!==owner())return;
          var rows=JSON.parse(w.localStorage.getItem('alert_watchlist_v1')||'[]');
          if(!Array.isArray(rows))throw Error();
          rows.filter(function(x){return typeof x==='string'&&/^[0-9A-Z]{4}\.T$/.test(x);}).forEach(function(x){var o=el('option',x);o.value=x;symbol.appendChild(o);});
          if(Array.from(symbol.options||[]).some(function(o){return o.value===selected;}))symbol.value=selected;
          submit.disabled=!key||!symbol.value;status.textContent=!key?'ログインしてから保存してください。':!symbol.value?'お気に入りに価格対応の銘柄を追加してください。':'';
        }catch(_){submit.disabled=true;status.textContent='お気に入りを確認できませんでした。保存は行っていません。';}
      });
      form.addEventListener('submit',async function(event){
        event.preventDefault();var key=owner(),generation=serial;
        try{
          if(!identity||identity!==key){identity=key;serial++;generation=serial;}
          var rows=JSON.parse(w.localStorage.getItem('alert_watchlist_v1')||'[]'),number=Number(threshold.value);
          if(!Array.isArray(rows)||rows.indexOf(symbol.value)<0||!threshold.value||!Number.isFinite(number)||number<=0)throw Error('invalid_request');
          submit.disabled=true;
          await request('price-rule','PUT',{symbol:symbol.value,currency:'JPY',direction:direction.value,threshold:number,enabled:false},key,generation);
          if(same(key,generation))status.textContent='条件を下書き保存しました。価格監視・通知はまだ無効です。';
        }catch(error){if(key===owner()&&generation===serial)status.textContent=fixed(error);}
        finally{if(key===owner()&&generation===serial)submit.disabled=false;}
      });
    }
    if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',pricePanel);else pricePanel();
    doc.addEventListener('knAuthChange',function(){if(identity!==owner()){serial++;identity=owner();reminders=[];subscribed=0;busy=false;taskOperations=Object.create(null);ownerReset=clearWorkerOwner();}refresh();});
    return {attachPlanner:attachPlanner,refreshTodos:refreshTodos,cancelTodo:cancelTodo,cancelForTodo:cancelForTodo,refresh:refresh};
  }
  return {create:create,dateTime:dateTime};
});

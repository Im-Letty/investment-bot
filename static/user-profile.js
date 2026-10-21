/* One public display profile; account identity always remains the existing Auth ID. */
(function(root,factory){
  'use strict';
  var exported=factory();
  if(typeof module==='object'&&module.exports)module.exports=exported;
  if(root&&root.document)root.KNUserProfile=exported.create(root);
})(typeof window==='undefined'?null:window,function(){
  'use strict';
  var metadataKey='kn_profile_v1',guestKey='kn_profile_guest_v1';
  var avatars={leaf:'🌿',star:'⭐',flower:'🌼',moon:'🌙',sun:'☀️'};
  var avatarLabels={leaf:'葉っぱ',star:'星',flower:'花',moon:'月',sun:'太陽'};
  function empty(){return {username:'',bio:'',avatar:'leaf'};}
  function count(value){return Array.from(value).length;}
  function validate(input){
    if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('invalid_profile');
    var name=input.username,bio=input.bio,avatar=input.avatar;
    if(typeof name!=='string'||typeof bio!=='string'||typeof avatar!=='string')throw new Error('invalid_profile');
    name=name.trim();bio=bio.replace(/\r\n?/g,'\n').trim();
    if(count(name)>20||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(name))throw new Error('invalid_name');
    if(count(bio)>160||/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(bio))throw new Error('invalid_bio');
    if(!Object.prototype.hasOwnProperty.call(avatars,avatar))throw new Error('invalid_avatar');
    return {username:name,bio:bio,avatar:avatar};
  }
  function storedProfile(value){try{return validate(value);}catch(_){return empty();}}
  function create(w){
    var doc=w.document,state=empty(),identity=null,loaded=false,loading=false,error='',email='',serial=0,readPromise=null,saving=false,refreshTimer=null;
    var section=null,form=null,fields={},summaryName=null,summaryIcon=null,scope=null,status=null,submit=null,cancel=null,emailWrap=null,emailInput=null,dirty=false;
    function member(user){return !!(user&&user.is_anonymous===false&&typeof user.id==='string'&&user.id);}
    function owner(){var user=w.knUser;return member(user)?'member:'+user.id:'guest';}
    function same(key){return owner()===key&&identity===key;}
    function copy(){return {username:state.username,bio:state.bio,avatar:state.avatar};}
    function snapshot(){return Object.assign(copy(),{member:identity!==null&&identity!=='guest',loaded:loaded,loading:loading,error:error,email:email});}
    function emit(old){
      if(old===JSON.stringify(copy()))return;
      if(doc&&typeof doc.dispatchEvent==='function'){
        var event;if(typeof w.CustomEvent==='function')event=new w.CustomEvent('knProfileChange',{detail:copy()});
        else if(typeof w.Event==='function')event=new w.Event('knProfileChange');
        if(event)doc.dispatchEvent(event);
      }
    }
    function apply(next){var old=JSON.stringify(copy());state=storedProfile(next);emit(old);}
    function resetIdentity(){
      var key=owner();if(identity===key)return false;
      serial++;identity=key;loaded=false;loading=false;readPromise=null;error='';email='';dirty=false;apply(empty());paint(true);return true;
    }
    function fixedError(reason){
      return ({invalid_name:'ユーザー名は20文字以内で入力してください。',invalid_bio:'自己紹介は160文字以内で入力してください。',invalid_avatar:'アイコンを選んでください。',busy:'保存中です。少しお待ちください。',account_changed:'アカウントが切り替わりました。内容を確認して保存し直してください。',auth_unavailable:'アカウントを確認できませんでした。もう一度お試しください。',storage_unavailable:'保存できませんでした。入力内容は残しています。もう一度お試しください。'})[reason]||'プロフィールを読み込めませんでした。もう一度お試しください。';
    }
    function announce(message,bad){if(status){status.textContent=message||'';status.classList.toggle('kn-profile-error',!!bad);}}
    function paint(force){
      if(!section)return;
      summaryName.textContent=state.username||'プロフィール';summaryIcon.textContent=avatars[state.avatar]||avatars.leaf;
      scope.textContent=identity==='guest'?'ユーザー名はチャットで共通に使います。このブラウザに保存します。動画の投稿にはログインが必要です。':'ユーザー名はチャットと動画投稿で共通に使います。このアカウントに保存します。';
      emailWrap.hidden=identity==='guest'||!email;emailInput.value=email;
      if(force||!dirty){fields.username.value=state.username;fields.bio.value=state.bio;fields.avatar.value=state.avatar;}
      var disabled=saving||loading||(!loaded&&identity!=='guest');
      Object.keys(fields).forEach(function(key){fields[key].disabled=disabled;});
      submit.disabled=disabled;cancel.disabled=saving||loading;submit.textContent=saving?'保存しています…':'保存する';
      section.setAttribute('aria-busy',String(saving||loading));
      if(error)announce(fixedError(error),true);
      else if(loading)announce('プロフィールを確認しています…',false);
    }
    function guestRead(){
      var next=empty(),raw;
      try{
        var name=w.localStorage.getItem('cm_nick')||'';next.username=storedProfile({username:name,bio:'',avatar:'leaf'}).username;
        raw=w.localStorage.getItem(guestKey);
        if(raw!==null){var extra=JSON.parse(raw);if(!extra||extra.version!==1)throw new Error('invalid');var normalized=validate({username:next.username,bio:extra.bio,avatar:extra.avatar});next.bio=normalized.bio;next.avatar=normalized.avatar;}
      }catch(_){throw new Error('storage_unavailable');}
      return next;
    }
    async function verifiedUser(key){
      var auth=w.sb&&w.sb.auth;
      if(!auth||typeof auth.getUser!=='function')throw new Error('auth_unavailable');
      var result;try{result=await auth.getUser();}catch(_){throw new Error('auth_unavailable');}
      if(!same(key))throw new Error('account_changed');
      var user=result&&result.data&&result.data.user;
      if(!result||result.error||!member(user)||'member:'+user.id!==key)throw new Error('auth_unavailable');
      return user;
    }
    function refresh(){
      resetIdentity();var key=identity;if(readPromise)return readPromise;
      if(saving)return Promise.resolve(snapshot());
      loading=true;error='';var epoch=++serial;paint(false);
      var promise=(async function(){
        await Promise.resolve();
        try{
          var next;
          if(key==='guest'){if(w.__knGateReady)await w.__knGateReady;if(!same(key)||epoch!==serial)throw new Error('account_changed');next=guestRead();}
          else{
            var user=await verifiedUser(key);if(!same(key)||epoch!==serial)throw new Error('account_changed');
            next=storedProfile(user.user_metadata&&user.user_metadata[metadataKey]);
            email=typeof user.email==='string'?user.email.slice(0,320):'';
          }
          if(!same(key)||epoch!==serial)throw new Error('account_changed');
          apply(next);loaded=true;error='';
        }catch(e){
          if(same(key)&&epoch===serial){loaded=false;error=e.message==='storage_unavailable'?'storage_unavailable':'auth_unavailable';}
        }finally{
          if(same(key)&&epoch===serial){loading=false;readPromise=null;paint(false);}
        }
        return snapshot();
      })();
      readPromise=promise;
      return promise;
    }
    async function ready(){
      resetIdentity();var expected=identity;if(!loaded||readPromise||error)await refresh();
      if(!same(expected))throw new Error('account_changed');
      if(!loaded||error)throw new Error(error||'auth_unavailable');
      return snapshot();
    }
    async function persistGuest(next,key){
      if(w.__knGateReady)await w.__knGateReady;
      if(!same(key))throw new Error('account_changed');
      var oldExtra;
      try{
        oldExtra=w.localStorage.getItem(guestKey);
        var extra=JSON.stringify({version:1,bio:next.bio,avatar:next.avatar});
        w.localStorage.setItem(guestKey,extra);if(w.localStorage.getItem(guestKey)!==extra)throw new Error('not_saved');
        if(typeof w.__knPersistLocalSetting==='function'){await w.__knPersistLocalSetting('cm_nick',next.username);if(w.localStorage.getItem('cm_nick')!==next.username)throw new Error('not_saved');}
        else{w.localStorage.setItem('cm_nick',next.username);if(w.localStorage.getItem('cm_nick')!==next.username)throw new Error('not_saved');}
      }catch(_){
        try{if(oldExtra===null)w.localStorage.removeItem(guestKey);else if(oldExtra!==undefined)w.localStorage.setItem(guestKey,oldExtra);}catch(ignored){}
        throw new Error('storage_unavailable');
      }
    }
    async function save(input){
      if(saving)throw new Error('busy');
      resetIdentity();var expected=identity,next=validate(input);await ready();
      if(!same(expected))throw new Error('account_changed');
      if(saving)throw new Error('busy');
      var key=identity,epoch=++serial;saving=true;error='';paint(false);
      try{
        if(key==='guest')await persistGuest(next,key);
        else{
          await verifiedUser(key);
          if(!same(key)||epoch!==serial)throw new Error('account_changed');
          var auth=w.sb&&w.sb.auth;if(!auth||typeof auth.getSession!=='function'||typeof w.fetch!=='function')throw new Error('auth_unavailable');
          var result;try{result=await auth.getSession();}catch(_){throw new Error('auth_unavailable');}
          if(!same(key)||epoch!==serial)throw new Error('account_changed');
          var session=result&&result.data&&result.data.session;
          if(!result||result.error||!session||!member(session.user)||'member:'+session.user.id!==key||typeof session.access_token!=='string'||!session.access_token||session.access_token.length>8192||/[\u0000-\u0020\u007f-\uffff]/.test(session.access_token))throw new Error('auth_unavailable');
          // This request remains bound to the captured account even if another
          // sign-in obtains the SDK lock immediately afterward.
          var token=session.access_token,controller=typeof w.AbortController==='function'?new w.AbortController():null,timer=null;
          var requestTask=(async function(){
            var response=await w.fetch('/api/user-profile',{method:'PUT',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller?controller.signal:undefined,body:JSON.stringify(next)});
            var raw=await response.text();if(raw.length>8192)throw new Error('storage_unavailable');
            var data;try{data=JSON.parse(raw);}catch(_){throw new Error('storage_unavailable');}
            if(!response.ok||!data||data.ok!==true||'member:'+data.user_id!==key)throw new Error('storage_unavailable');
            var stored=validate(data.profile);if(JSON.stringify(stored)!==JSON.stringify(next))throw new Error('storage_unavailable');
          })();
          var timedOut=new Promise(function(_,reject){timer=w.setTimeout(function(){if(controller)controller.abort();reject(new Error('storage_unavailable'));},12000);});
          try{await Promise.race([requestTask,timedOut]);}catch(_){throw new Error('storage_unavailable');}
          finally{if(timer!==null&&typeof w.clearTimeout==='function')w.clearTimeout(timer);}
          if(!same(key)||epoch!==serial)throw new Error('account_changed');
        }
        if(!same(key)||epoch!==serial)throw new Error('account_changed');
        dirty=false;apply(next);loaded=true;error='';paint(true);
        announce(key==='guest'?'このブラウザに保存しました。':'プロフィールを保存しました。',false);
        return snapshot();
      }catch(e){
        var reason=['account_changed','auth_unavailable','storage_unavailable'].indexOf(e.message)>=0?e.message:'storage_unavailable';
        if(same(key)&&epoch===serial){error=reason;paint(false);}
        throw new Error(reason);
      }finally{saving=false;paint(false);}
    }
    async function saveUsername(value){resetIdentity();var expected=identity;await ready();if(!same(expected))throw new Error('account_changed');var next=copy();next.username=value;return save(next);}
    function make(tag,className,text){var n=doc.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;}
    function field(label,name,tag){
      var wrap=make('label','kn-profile-field'),caption=make('span','',label),input=make(tag||'input');input.id='knProfile'+name.charAt(0).toUpperCase()+name.slice(1);input.name=name;
      wrap.appendChild(caption);wrap.appendChild(input);form.appendChild(wrap);fields[name]=input;return input;
    }
    function mount(container){
      if(!doc||!container)return null;
      if(section){if(section.parentNode!==container)container.insertBefore(section,container.firstChild);return section;}
      section=make('details','kn-profile');section.id='knProfile';var summary=make('summary','kn-profile-summary');
      summaryIcon=make('span','kn-profile-avatar',avatars.leaf);summaryIcon.setAttribute('aria-hidden','true');summaryName=make('span','kn-profile-name','プロフィール');summary.appendChild(summaryIcon);summary.appendChild(summaryName);section.appendChild(summary);
      form=make('form','kn-profile-form');form.setAttribute('aria-label','プロフィールを編集');form.noValidate=true;section.appendChild(form);
      scope=make('p','kn-profile-scope');form.appendChild(scope);
      var name=field('ユーザー名（公開・20文字まで）','username');name.type='text';name.maxLength=40;name.autocomplete='nickname';name.placeholder='みんなに表示する名前';
      var avatar=field('アイコン','avatar','select');Object.keys(avatars).forEach(function(key){var option=make('option','',avatars[key]+' '+avatarLabels[key]);option.value=key;avatar.appendChild(option);});
      var bio=field('自己紹介（160文字まで）','bio','textarea');bio.maxLength=320;bio.rows=3;bio.placeholder='好きなことや興味のあること';
      var note=make('p','kn-profile-note','ユーザー名は投稿者名として公開されます。アイコンと自己紹介はプロフィールに保存します。');form.appendChild(note);
      emailWrap=make('div','kn-profile-private');var emailLabel=make('label','kn-profile-field'),emailTitle=make('span','','ログイン用メールアドレス（非公開）');emailInput=make('input');emailInput.type='email';emailInput.readOnly=true;emailInput.tabIndex=0;emailLabel.appendChild(emailTitle);emailLabel.appendChild(emailInput);emailWrap.appendChild(emailLabel);form.appendChild(emailWrap);
      var actions=make('div','kn-profile-actions');submit=make('button','kn-profile-save','保存する');submit.type='submit';cancel=make('button','kn-profile-cancel','変更を戻す');cancel.type='button';actions.appendChild(submit);actions.appendChild(cancel);form.appendChild(actions);
      status=make('p','kn-profile-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');form.appendChild(status);
      form.addEventListener('input',function(){dirty=true;announce('',false);});
      form.addEventListener('change',function(){dirty=true;announce('',false);});
      form.addEventListener('submit',async function(event){event.preventDefault();if(saving)return;try{await save({username:name.value,bio:bio.value,avatar:avatar.value});}catch(e){announce(fixedError(e.message),true);}});
      cancel.addEventListener('click',function(){dirty=false;paint(true);announce('',false);name.focus();});
      section.addEventListener('toggle',function(){if(section.open&&!loaded&&!loading)refresh();});
      container.insertBefore(section,container.firstChild);resetIdentity();paint(true);refresh();return section;
    }
    function open(){
      if(!section){var target=doc&&doc.querySelector('#drawerNav .kn-menu-content');if(target)mount(target);}
      if(!section)return false;
      if(typeof w.openDrawer==='function')w.openDrawer();
      else{var trigger=doc.getElementById('knHomeAMenu');if(trigger)trigger.click();}
      section.open=true;
      if(typeof w.setTimeout==='function')w.setTimeout(function(){if(section&&section.isConnected){section.scrollIntoView({block:'nearest'});fields.username.focus({preventScroll:true});}},350);
      return true;
    }
    function authChanged(){
      var changed=resetIdentity();if(saving&&!changed)return;
      if(refreshTimer!==null&&typeof w.clearTimeout==='function')w.clearTimeout(refreshTimer);
      refreshTimer=w.setTimeout(function(){refreshTimer=null;refresh();},0);
    }
    resetIdentity();
    if(doc&&typeof doc.addEventListener==='function')doc.addEventListener('knAuthChange',authChanged);
    if(typeof w.addEventListener==='function')w.addEventListener('storage',function(event){if(identity==='guest'&&event&&(event.key===guestKey||event.key==='cm_nick'||event.key==='knenc:cm_nick'))refresh();});
    return {username:function(){resetIdentity();return state.username;},snapshot:function(){resetIdentity();return snapshot();},save:save,saveUsername:saveUsername,ready:ready,refresh:refresh,mount:mount,open:open};
  }
  return {create:create,validate:validate,avatars:Object.assign({},avatars)};
});

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
  var photoBytes=49152,photoPixels=40000000,hasOwn=Object.prototype.hasOwnProperty;
  function photo(value){
    if(typeof value!=='string')throw new Error('invalid_avatar_image');
    if(value===''||/^[a-f0-9]{64}$/.test(value))return value;
    var body=value.slice(23);
    if(!value.startsWith('data:image/jpeg;base64,')||body.length>65536||body.length%4!==0||!/^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(body)||body.length/4*3-(body.endsWith('==')?2:body.endsWith('=')?1:0)>photoBytes)throw new Error('invalid_avatar_image');
    return value;
  }
  function isPhotoData(value){return typeof value==='string'&&value.startsWith('data:image/jpeg;base64,');}
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
    var result={username:name,bio:bio,avatar:avatar};
    if(hasOwn.call(input,'avatar_image'))result.avatar_image=photo(input.avatar_image);
    return result;
  }
  function storedProfile(value,local){
    try{
      var result=validate({username:value.username,bio:value.bio,avatar:value.avatar});
      if(hasOwn.call(value,'avatar_image'))try{var image=photo(value.avatar_image);if(!isPhotoData(image)||local)result.avatar_image=image;}catch(ignored){}
      return result;
    }catch(_){return empty();}
  }
  function create(w){
    var doc=w.document,state=empty(),identity=null,loaded=false,loading=false,error='',email='',serial=0,readPromise=null,saving=false,refreshTimer=null;
    var section=null,form=null,fields={},summaryName=null,summaryIcon=null,scope=null,status=null,submit=null,cancel=null,emailWrap=null,emailInput=null,dirty=false,iconButton=null,iconChoices=null,choiceButtons={};
    var photoInput=null,photoPreview=null,photoReset=null,albumButton=null,draftPhoto='',photoEdited=false,preparing=false,photoSerial=0,decodeCancel=null,imageSerial=0,imageRef='',imageOwner='',imageURL='',imagePending=false,imageController=null;
    function member(user){return !!(user&&user.is_anonymous===false&&typeof user.id==='string'&&user.id);}
    function owner(){var user=w.knUser;return member(user)?'member:'+user.id:'guest';}
    function same(key){return owner()===key&&identity===key;}
    function copy(){var result={username:state.username,bio:state.bio,avatar:state.avatar};if(hasOwn.call(state,'avatar_image'))result.avatar_image=state.avatar_image;return result;}
    function imageValue(value){return value.avatar_image||'';}
    function snapshot(){return Object.assign(copy(),{member:identity!==null&&identity!=='guest',loaded:loaded,loading:loading,error:error,email:email});}
    function emit(old){
      if(old===JSON.stringify(copy()))return;
      if(doc&&typeof doc.dispatchEvent==='function'){
        // Photos are private profile UI data, never part of chat/post events.
        var detail={username:state.username,bio:state.bio,avatar:state.avatar};
        var event;if(typeof w.CustomEvent==='function')event=new w.CustomEvent('knProfileChange',{detail:detail});
        else if(typeof w.Event==='function')event=new w.Event('knProfileChange');
        if(event)doc.dispatchEvent(event);
      }
    }
    function revoke(url){if(url&&w.URL&&typeof w.URL.revokeObjectURL==='function')w.URL.revokeObjectURL(url);}
    function clearSavedImage(){imageSerial++;if(imageController)imageController.abort();imageController=null;revoke(imageURL);imageURL='';imageRef='';imageOwner='';imagePending=false;}
    function cancelPreparation(){photoSerial++;preparing=false;if(decodeCancel){var stop=decodeCancel;decodeCancel=null;stop();}}
    function restorePhoto(){cancelPreparation();draftPhoto=imageValue(state);photoEdited=false;if(photoInput)photoInput.value='';}
    function apply(next){var old=JSON.stringify(copy());state=storedProfile(next,identity==='guest');ensureSavedImage();emit(old);}
    function closeIconChoices(focus){if(!iconChoices)return;iconChoices.hidden=true;iconButton.setAttribute('aria-expanded','false');if(focus)iconButton.focus();}
    function resetIdentity(){
      var key=owner();if(identity===key)return false;
      serial++;closeIconChoices(false);clearSavedImage();cancelPreparation();identity=key;loaded=false;loading=false;readPromise=null;error='';email='';dirty=false;apply(empty());restorePhoto();paint(true);return true;
    }
    function fixedError(reason){
      return ({invalid_name:'ユーザー名は20文字以内で入力してください。',invalid_bio:'自己紹介は160文字以内で入力してください。',invalid_avatar:'アイコンを選んでください。',invalid_avatar_image:'写真を準備できませんでした。別の写真を選んでください。',photo_size:'写真は10MB以下のものを選んでください。',photo_pixels:'写真の縦横が大きすぎます。小さくしてから選んでください。',photo_type:'JPEG・PNGなどの写真を選んでください。',photo_decode:'この写真を読み込めませんでした。JPEGかPNGに変換するか、別の写真を選んでください。',photo_unavailable:'保存した写真を表示できませんでした。プロフィールを開き直してお試しください。',photo_busy:'写真を準備しています。少しお待ちください。',busy:'保存中です。少しお待ちください。',account_changed:'アカウントが切り替わりました。内容を確認して保存し直してください。',auth_unavailable:'アカウントを確認できませんでした。もう一度お試しください。',storage_unavailable:'保存できませんでした。入力内容は残しています。もう一度お試しください。'})[reason]||'プロフィールを読み込めませんでした。もう一度お試しください。';
    }
    function announce(message,bad){if(status){status.textContent=message||'';status.classList.toggle('kn-profile-error',!!bad);}}
    function renderAvatar(target,preset,src){
      if(!target)return;var signature=(src||'')+'|'+preset;if(target._knAvatar===signature)return;target._knAvatar=signature;target.textContent='';
      if(src){var image=doc.createElement('img'),key=identity;image.alt='';image.width=target===summaryIcon?38:76;image.height=image.width;
        image.onerror=function(){if(!same(key)||target._knAvatar!==signature)return;if(src===imageURL){revoke(imageURL);imageURL='';}target._knAvatar='|'+preset;target.textContent=avatars[preset]||avatars.leaf;announce(fixedError('photo_unavailable'),true);};image.src=src;target.appendChild(image);}
      else target.textContent=avatars[preset]||avatars.leaf;
    }
    function savedSource(){var value=imageValue(state);if(identity==='guest'&&isPhotoData(value))return value;return imageOwner===identity&&imageRef===value?imageURL:'';}
    function draftSource(){if(isPhotoData(draftPhoto))return draftPhoto;return draftPhoto&&draftPhoto===imageValue(state)?savedSource():'';}
    function paint(force){
      if(!section)return;
      summaryName.textContent=state.username||'プロフィール';renderAvatar(summaryIcon,state.avatar,savedSource());
      scope.hidden=identity!=='guest';
      scope.textContent=identity==='guest'?'ユーザー名はチャットで共通に使います。このブラウザに保存します。動画の投稿にはログインが必要です。':'';
      emailWrap.hidden=identity==='guest'||!email;emailInput.value=email;
      if(force||!dirty){fields.username.value=state.username;fields.bio.value=state.bio;fields.avatar.value=state.avatar;draftPhoto=imageValue(state);photoEdited=false;}
      renderAvatar(photoPreview,fields.avatar.value||state.avatar,draftSource());
      var disabled=saving||loading||(!loaded&&identity!=='guest');
      Object.keys(fields).forEach(function(key){fields[key].disabled=disabled;});
      iconButton.disabled=disabled;iconButton.setAttribute('aria-label','アイコンを変更（'+(draftPhoto?'写真':avatarLabels[fields.avatar.value]||avatarLabels.leaf)+'）');
      Object.keys(choiceButtons).forEach(function(key){choiceButtons[key].disabled=disabled;choiceButtons[key].setAttribute('aria-pressed',String(!draftPhoto&&key===fields.avatar.value));});
      photoInput.disabled=disabled;photoReset.disabled=disabled;albumButton.disabled=disabled;submit.disabled=disabled||preparing;cancel.disabled=saving||loading;submit.textContent=saving?'保存しています…':'保存する';
      section.setAttribute('aria-busy',String(saving||loading||preparing));
      if(error)announce(fixedError(error),true);
      else if(loading)announce('プロフィールを確認しています…',false);
      else if(status&&status.textContent==='プロフィールを確認しています…')announce('',false);
    }
    async function capturedSession(key){
      var auth=w.sb&&w.sb.auth;if(!auth||typeof auth.getSession!=='function'||typeof w.fetch!=='function')throw new Error('auth_unavailable');
      var result;try{result=await auth.getSession();}catch(_){throw new Error('auth_unavailable');}
      if(!same(key))throw new Error('account_changed');var session=result&&result.data&&result.data.session;
      if(!result||result.error||!session||!member(session.user)||'member:'+session.user.id!==key||typeof session.access_token!=='string'||!session.access_token||session.access_token.length>8192||/[\u0000-\u0020\u007f-\uffff]/.test(session.access_token))throw new Error('auth_unavailable');
      return session.access_token;
    }
    function ensureSavedImage(){
      var ref=imageValue(state),key=identity;if(!section)return;
      if(key==='guest'||!ref||isPhotoData(ref)){if(imageRef||imageURL||imagePending)clearSavedImage();return;}
      if(imageOwner===key&&imageRef===ref&&(imageURL||imagePending))return;
      clearSavedImage();imageOwner=key;imageRef=ref;imagePending=true;var epoch=imageSerial;
      function current(){return same(key)&&epoch===imageSerial&&imageValue(state)===ref;}
      (async function(){
        var timer=null,controller=typeof w.AbortController==='function'?new w.AbortController():null;imageController=controller;
        try{
          var request=(async function(){
            var token=await capturedSession(key);if(!current())throw new Error('account_changed');
            var response=await w.fetch('/api/user-profile/avatar',{method:'GET',headers:{'Authorization':'Bearer '+token},credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller?controller.signal:undefined});
            if(!current())throw new Error('account_changed');
            if(!response.ok||!response.headers||response.headers.get('X-Avatar-Image')!==ref||!/^image\/jpeg(?:\s*;|$)/i.test(response.headers.get('Content-Type')||'')||Number(response.headers.get('Content-Length')||0)>photoBytes)throw new Error('photo_unavailable');
            var blob=await response.blob();if(!current())throw new Error('account_changed');
            if(!blob||!blob.size||blob.size>photoBytes||!w.URL||typeof w.URL.createObjectURL!=='function')throw new Error('photo_unavailable');
            return blob;
          })();
          var timeout=new Promise(function(_,reject){timer=w.setTimeout(function(){if(controller)controller.abort();reject(new Error('photo_unavailable'));},12000);});
          var blob=await Promise.race([request,timeout]);if(!current())return;
          imageURL=w.URL.createObjectURL(blob);imagePending=false;paint(false);
        }catch(_){if(current()){imagePending=false;announce(fixedError('photo_unavailable'),true);}}
        finally{if(timer!==null&&typeof w.clearTimeout==='function')w.clearTimeout(timer);if(current())imageController=null;}
      })();
    }
    function photoCurrent(key,epoch){return same(key)&&epoch===photoSerial;}
    async function decodePhoto(file,key,epoch){
      if(typeof w.createImageBitmap==='function')try{
        var bitmap=await w.createImageBitmap(file,{imageOrientation:'from-image'});
        if(!photoCurrent(key,epoch)||!preparing){if(bitmap&&typeof bitmap.close==='function')bitmap.close();throw new Error('photo_cancelled');}
        return bitmap;
      }catch(e){if(!photoCurrent(key,epoch)||!preparing||e.message==='photo_cancelled')throw new Error('photo_cancelled');}
      if(typeof w.Image!=='function'||!w.URL||typeof w.URL.createObjectURL!=='function')throw new Error('photo_decode');
      var url=w.URL.createObjectURL(file),image=new w.Image();
      try{
        await new Promise(function(resolve,reject){decodeCancel=function(){image.onload=null;image.onerror=null;image.src='';reject(new Error('photo_cancelled'));};image.onload=resolve;image.onerror=function(){reject(new Error('photo_decode'));};image.decoding='async';image.src=url;});
        if(!photoCurrent(key,epoch)||!preparing)throw new Error('photo_cancelled');return image;
      }finally{if(photoCurrent(key,epoch))decodeCancel=null;revoke(url);}
    }
    async function choosePhoto(){
      var file=photoInput.files&&photoInput.files[0];photoInput.value='';if(!file||saving||loading)return;
      resetIdentity();closeIconChoices(false);cancelPreparation();var key=identity,epoch=photoSerial;preparing=true;dirty=true;paint(false);announce('写真を準備しています…',false);
      var decoded=null,timer=null;
      try{
        if(!Number.isFinite(file.size)||file.size<=0||file.size>10*1024*1024)throw new Error('photo_size');
        if(!/^image\/(jpeg|png|webp|gif|avif|heic(?:-sequence)?|heif(?:-sequence)?|bmp|x-ms-bmp)$/i.test(file.type||'')&&!(!file.type&&/\.(heic|heif)$/i.test(file.name||'')))throw new Error('photo_type');
        var timeout=new Promise(function(_,reject){timer=w.setTimeout(function(){reject(new Error('photo_decode'));},15000);});
        decoded=await Promise.race([decodePhoto(file,key,epoch),timeout]);if(!photoCurrent(key,epoch))return;
        var width=decoded.naturalWidth||decoded.width,height=decoded.naturalHeight||decoded.height;
        if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||width*height>photoPixels)throw new Error('photo_pixels');
        var canvas=doc.createElement('canvas');canvas.width=192;canvas.height=192;var context=canvas.getContext('2d');if(!context)throw new Error('photo_decode');
        context.fillStyle='#ffffff';context.fillRect(0,0,192,192);var side=Math.min(width,height);context.drawImage(decoded,(width-side)/2,(height-side)/2,side,side,0,0,192,192);
        var prepared='';for(var quality=9;quality>=4;quality--){try{prepared=photo(canvas.toDataURL('image/jpeg',quality/10));break;}catch(_){prepared='';}}
        if(!isPhotoData(prepared))throw new Error('invalid_avatar_image');if(!photoCurrent(key,epoch))return;
        draftPhoto=prepared;photoEdited=true;preparing=false;paint(false);announce('写真を選びました。「保存する」で反映します。',false);
      }catch(e){if(photoCurrent(key,epoch)){preparing=false;if(decodeCancel){var stop=decodeCancel;decodeCancel=null;stop();}paint(false);announce(fixedError(e.message==='photo_cancelled'?'photo_decode':e.message),true);}}
      finally{if(timer!==null&&typeof w.clearTimeout==='function')w.clearTimeout(timer);if(decoded&&typeof decoded.close==='function')decoded.close();}
    }
    function guestRead(){
      var next=empty(),raw;
      try{
        var name=w.localStorage.getItem('cm_nick')||'';next.username=storedProfile({username:name,bio:'',avatar:'leaf'}).username;
        raw=w.localStorage.getItem(guestKey);
        if(raw!==null){var extra=JSON.parse(raw);if(!extra||extra.version!==1)throw new Error('invalid');var input={username:next.username,bio:extra.bio,avatar:extra.avatar};if(hasOwn.call(extra,'avatar_image'))input.avatar_image=extra.avatar_image;var normalized=validate(input);if(normalized.avatar_image&&!isPhotoData(normalized.avatar_image))throw new Error('invalid');next=normalized;}
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
      var oldExtra,oldName;
      try{
        oldExtra=w.localStorage.getItem(guestKey);oldName=w.localStorage.getItem('cm_nick');
        var record={version:1,bio:next.bio,avatar:next.avatar};if(hasOwn.call(next,'avatar_image'))record.avatar_image=next.avatar_image;
        var extra=JSON.stringify(record);
        w.localStorage.setItem(guestKey,extra);if(w.localStorage.getItem(guestKey)!==extra)throw new Error('not_saved');
        if(typeof w.__knPersistLocalSetting==='function'){await w.__knPersistLocalSetting('cm_nick',next.username);if(w.localStorage.getItem('cm_nick')!==next.username)throw new Error('not_saved');}
        else{w.localStorage.setItem('cm_nick',next.username);if(w.localStorage.getItem('cm_nick')!==next.username)throw new Error('not_saved');}
      }catch(_){
        try{if(oldExtra===null)w.localStorage.removeItem(guestKey);else if(oldExtra!==undefined)w.localStorage.setItem(guestKey,oldExtra);}catch(ignored){}
        // Roll back both guest keys, including helpers that write before failing.
        try{if(same(key)&&w.localStorage.getItem('cm_nick')!==oldName){if(oldName===null)w.localStorage.removeItem('cm_nick');else if(oldName!==undefined)w.localStorage.setItem('cm_nick',oldName);}}catch(ignored){}
        throw new Error('storage_unavailable');
      }
    }
    async function save(input){
      if(saving)throw new Error('busy');
      if(preparing)throw new Error('photo_busy');
      resetIdentity();var expected=identity,next=validate(input);await ready();
      if(!same(expected))throw new Error('account_changed');
      if(saving)throw new Error('busy');
      if(preparing)throw new Error('photo_busy');
      if(!hasOwn.call(next,'avatar_image')&&hasOwn.call(state,'avatar_image'))next.avatar_image=state.avatar_image;
      if(identity==='guest'&&next.avatar_image&&!isPhotoData(next.avatar_image))throw new Error('invalid_avatar_image');
      var key=identity,epoch=++serial;saving=true;error='';paint(false);
      try{
        if(key==='guest')await persistGuest(next,key);
        else{
          await verifiedUser(key);
          if(!same(key)||epoch!==serial)throw new Error('account_changed');
          var token=await capturedSession(key);
          if(!same(key)||epoch!==serial)throw new Error('account_changed');
          // This request remains bound to the captured account even if another
          // sign-in obtains the SDK lock immediately afterward.
          var controller=typeof w.AbortController==='function'?new w.AbortController():null,timer=null,storedNext=null;
          var requestTask=(async function(){
            var response=await w.fetch('/api/user-profile',{method:'PUT',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller?controller.signal:undefined,body:JSON.stringify(next)});
            if(!same(key)||epoch!==serial)throw new Error('account_changed');
            var raw=await response.text();if(!same(key)||epoch!==serial)throw new Error('account_changed');if(raw.length>8192)throw new Error('storage_unavailable');
            var data;try{data=JSON.parse(raw);}catch(_){throw new Error('storage_unavailable');}
            if(!response.ok||!data||data.ok!==true||'member:'+data.user_id!==key)throw new Error('storage_unavailable');
            var stored=validate(data.profile),expectedCore={username:next.username,bio:next.bio,avatar:next.avatar},storedCore={username:stored.username,bio:stored.bio,avatar:stored.avatar};
            if(JSON.stringify(storedCore)!==JSON.stringify(expectedCore)||hasOwn.call(stored,'avatar_image')!==hasOwn.call(next,'avatar_image'))throw new Error('storage_unavailable');
            if(hasOwn.call(next,'avatar_image')&&(isPhotoData(next.avatar_image)?!/^[a-f0-9]{64}$/.test(stored.avatar_image):stored.avatar_image!==next.avatar_image))throw new Error('storage_unavailable');
            storedNext=stored;
          })();
          var timedOut=new Promise(function(_,reject){timer=w.setTimeout(function(){if(controller)controller.abort();reject(new Error('storage_unavailable'));},12000);});
          try{await Promise.race([requestTask,timedOut]);}catch(_){throw new Error(!same(key)||epoch!==serial?'account_changed':'storage_unavailable');}
          finally{if(timer!==null&&typeof w.clearTimeout==='function')w.clearTimeout(timer);}
          if(!same(key)||epoch!==serial)throw new Error('account_changed');
          next=storedNext;
        }
        if(!same(key)||epoch!==serial)throw new Error('account_changed');
        dirty=false;closeIconChoices(false);apply(next);restorePhoto();loaded=true;error='';paint(true);
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
      var iconEditor=make('div','kn-profile-icon-editor');iconEditor.appendChild(make('span','kn-profile-icon-label','アイコン'));
      iconButton=make('button','kn-profile-icon-button');iconButton.id='knProfileIconButton';iconButton.type='button';iconButton.setAttribute('aria-label','アイコンを変更（葉っぱ）');iconButton.setAttribute('aria-controls','knProfileIconChoices');iconButton.setAttribute('aria-expanded','false');
      photoPreview=make('span','kn-profile-photo-preview');photoPreview.setAttribute('aria-hidden','true');iconButton.appendChild(photoPreview);iconEditor.appendChild(iconButton);iconEditor.appendChild(make('span','kn-profile-icon-hint','タップして変更'));
      iconChoices=make('div','kn-profile-icon-choices');iconChoices.id='knProfileIconChoices';iconChoices.hidden=true;iconChoices.setAttribute('role','group');iconChoices.setAttribute('aria-label','アイコンを選ぶ');
      var avatar=make('input');avatar.id='knProfileAvatar';avatar.name='avatar';avatar.type='hidden';avatar.value=state.avatar;fields.avatar=avatar;iconEditor.appendChild(avatar);
      Object.keys(avatars).forEach(function(key){var option=make('button','kn-profile-icon-choice',avatars[key]);option.type='button';option.setAttribute('data-avatar',key);option.setAttribute('aria-label',avatarLabels[key]+'のアイコン');option.setAttribute('aria-pressed','false');option.addEventListener('click',function(){if(option.disabled||resetIdentity())return;avatar.value=key;cancelPreparation();draftPhoto='';photoEdited=true;dirty=true;paint(false);closeIconChoices(true);announce('アイコンを選びました。「保存する」で反映します。',false);});choiceButtons[key]=option;iconChoices.appendChild(option);});
      var iconActions=make('div','kn-profile-icon-actions');albumButton=make('button','kn-profile-album-button','アルバムから選ぶ');albumButton.id='knProfileAlbumButton';albumButton.type='button';iconActions.appendChild(albumButton);
      photoReset=make('button','kn-profile-photo-reset','標準に戻す');photoReset.type='button';iconActions.appendChild(photoReset);
      photoInput=make('input','kn-profile-photo-input');photoInput.id='knProfilePhoto';photoInput.type='file';photoInput.hidden=true;photoInput.tabIndex=-1;photoInput.accept='image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,image/bmp,.heic,.heif';iconActions.appendChild(photoInput);iconChoices.appendChild(iconActions);iconEditor.appendChild(iconChoices);form.appendChild(iconEditor);
      var bio=field('自己紹介（160文字まで）','bio','textarea');bio.maxLength=320;bio.rows=3;bio.placeholder='好きなことや興味のあること';
      emailWrap=make('div','kn-profile-private');var emailLabel=make('label','kn-profile-field'),emailTitle=make('span','','ログイン用メールアドレス（非公開）');emailInput=make('input');emailInput.type='email';emailInput.readOnly=true;emailInput.tabIndex=0;emailLabel.appendChild(emailTitle);emailLabel.appendChild(emailInput);emailWrap.appendChild(emailLabel);form.appendChild(emailWrap);
      var actions=make('div','kn-profile-actions');submit=make('button','kn-profile-save','保存する');submit.type='submit';cancel=make('button','kn-profile-cancel','変更を戻す');cancel.type='button';actions.appendChild(submit);actions.appendChild(cancel);form.appendChild(actions);
      status=make('p','kn-profile-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');form.appendChild(status);
      form.addEventListener('input',function(){dirty=true;announce('',false);});
      form.addEventListener('change',function(event){dirty=true;if(event.target!==photoInput&&event.target!==avatar)announce('',false);});
      iconButton.addEventListener('click',function(){if(iconButton.disabled||resetIdentity())return;var show=iconChoices.hidden;iconChoices.hidden=!show;iconButton.setAttribute('aria-expanded',String(show));if(show)(draftPhoto?albumButton:choiceButtons[avatar.value]||choiceButtons.leaf).focus();});
      form.addEventListener('keydown',function(event){if(event.key==='Escape'&&!iconChoices.hidden){event.preventDefault();if(typeof event.stopPropagation==='function')event.stopPropagation();closeIconChoices(true);}});
      albumButton.addEventListener('click',function(){if(albumButton.disabled||resetIdentity())return;photoInput.value='';closeIconChoices(true);try{photoInput.click();}catch(_){announce(fixedError('photo_decode'),true);}});
      photoInput.addEventListener('change',choosePhoto);
      avatar.addEventListener('change',function(){cancelPreparation();draftPhoto='';photoEdited=true;dirty=true;paint(false);closeIconChoices(true);announce('標準アイコンを選びました。「保存する」で反映します。',false);});
      photoReset.addEventListener('click',function(){if(photoReset.disabled||resetIdentity())return;cancelPreparation();draftPhoto='';photoEdited=true;dirty=true;photoInput.value='';paint(false);closeIconChoices(true);announce('標準アイコンに戻します。「保存する」で反映します。',false);});
      form.addEventListener('submit',async function(event){event.preventDefault();if(saving)return;var next={username:name.value,bio:bio.value,avatar:avatar.value};if(photoEdited||hasOwn.call(state,'avatar_image'))next.avatar_image=draftPhoto;try{await save(next);}catch(e){announce(fixedError(e.message),true);}});
      cancel.addEventListener('click',function(){dirty=false;closeIconChoices(false);restorePhoto();paint(true);announce('',false);name.focus();});
      section.addEventListener('toggle',function(){if(section.open){if(!loaded&&!loading)refresh();else if(loaded)ensureSavedImage();}});
      container.insertBefore(section,container.firstChild);resetIdentity();restorePhoto();ensureSavedImage();paint(true);refresh();return section;
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

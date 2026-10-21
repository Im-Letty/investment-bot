/* Public playback and owner-only posting share no browser-stored credentials. */
(function(root,factory){
  'use strict';var api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.KNShortsPosting=api;if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',api.mount);else api.mount();}
})(typeof window==='undefined'?null:window,function(w){
  'use strict';
  var topics=['#経済入門','#投資','#マーケット','#企業','#家計・節約','#税金','#副業・お金','#年金・老後','#不動産','#暗号資産','#経済ニュース','#世界経済','#経済史','#行動経済学','#テクノロジーと経済','#用語解説'];
  var maxFile=20000000,modal=null,form=null,status=null,ownerList=null,submit=null,owner=null,requestId=null,busy=false,generation=0,feedGeneration=0,mineCursor=null,selectedFile=null,selectedURL=null,videoPreview=null,fileSummary=null,editButton=null,editorHandle=null;
  function validId(value){return Number.isSafeInteger(value)&&value>0;}
  function feedRows(posts){
    if(!Array.isArray(posts)||posts.length>20)return [];
    return posts.filter(function(p){return p&&validId(p.id)&&typeof p.title==='string'&&p.title.length>0&&Array.from(p.title).length<=120&&topics.indexOf(p.topic)>=0&&typeof p.published_at==='string'&&p.published_at.length>0;}).map(function(p){
      var row={id:null,cap:p.title,tag:p.topic,provider:p.provider,postId:p.id};
      if(p.provider==='youtube'&&/^[A-Za-z0-9_-]{11}$/.test(p.video_id||''))row.id=p.video_id;
      if(p.provider==='upload'&&p.media_url==='/api/shorts/posts/'+p.id+'/media'){row.id='upload:'+p.id;row.mediaSrc=p.media_url;}
      return row;
    }).filter(function(row){return !!row.id;});
  }
  async function getLoggedInSession(client){
    if(!client||!client.auth||typeof client.auth.getSession!=='function')throw new Error('login_required');
    var result=await client.auth.getSession(),session=result&&result.data&&result.data.session;
    if(!result||result.error||!session||!session.user||session.user.is_anonymous!==false||typeof session.access_token!=='string'||!session.access_token)throw new Error('login_required');
    return session;
  }
  function message(reason){return ({login_required:'動画の投稿にはログインが必要です。ログイン機能の準備後に投稿できます。',
    invalid_url:'YouTubeの動画の共有リンクを入力してください。',invalid_metadata:'タイトルと説明の長さを確認してください。',invalid_topic:'ジャンルを選んでください。',
    invalid_request_id:'投稿をやり直してください。',invalid_request:'入力内容を確認してください。',unsupported_file:'MP4・MOV形式のH.264動画に対応しています。対応形式で保存した動画を選んでください。',
    invalid_file:'この動画ファイルを読み取れませんでした。MP4・MOV形式のH.264動画を選んでください。',file_too_large:'動画は20MB以内で選んでください。',file_too_long:'動画は3分以内で選んでください。',
    quota_exceeded:'動画の保存容量に達しました。自分の投稿を削除してからお試しください。',rate_limited:'少し待ってから投稿してください。',request_conflict:'前の投稿と内容が変わりました。入力を変更してから投稿してください。',
    not_found:'この投稿は見つかりませんでした。',post_unavailable:'この投稿は削除済みです。',storage_unavailable:'投稿の保存先は準備中か、接続できません。少し後にお試しください。',auth_unavailable:'ログイン状態を確認できません。少し後にお試しください。'})[reason]||'接続できませんでした。少し後にお試しください。';}
  function say(text){if(status)status.textContent=text;}
  function node(tag,className,text){var n=w.document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;}
  function field(label,name,tag){var wrap=node('label','ks-post-field'),title=node('span','',label),input=node(tag||'input');input.name=name;wrap.appendChild(title);wrap.appendChild(input);form.appendChild(wrap);return input;}
  function setBusy(value){busy=value;if(!form)return;Array.from(form.elements).forEach(function(el){el.disabled=value||(!owner&&el!==editButton);});submit.disabled=value||!owner||!selectedFile;submit.textContent=value?'投稿しています…':'投稿する';}
  function clearVideo(){if(videoPreview){videoPreview.pause();videoPreview.removeAttribute('src');videoPreview.load();videoPreview.hidden=true;}if(selectedURL){w.URL.revokeObjectURL(selectedURL);selectedURL=null;}selectedFile=null;if(fileSummary)fileSummary.textContent='まだ動画を選んでいません。';}
  function selectVideo(file,meta){
    if(!file||typeof file.size!=='number'||file.size<=0||file.size>maxFile||typeof file.name!=='string'||!/\.(mp4|mov)$/i.test(file.name)){say(message('invalid_file'));return;}
    clearVideo();selectedFile=file;selectedURL=w.URL.createObjectURL(file);videoPreview.src=selectedURL;videoPreview.hidden=false;requestId=null;
    var seconds=meta&&Number.isFinite(meta.duration)?'・'+meta.duration.toFixed(1)+'秒':'';fileSummary.textContent=file.name+'（'+(file.size/1000000).toFixed(1)+'MB'+seconds+'）';
    if(!form.elements.title.value)form.elements.title.value=file.name.replace(/\.(mp4|mov)$/i,'').slice(0,120);
    say(owner?'動画を確認して、タイトルを付けて投稿できます。':message('login_required'));setBusy(false);
  }
  function editVideo(){
    if(busy||editorHandle)return;
    if(!w.KNShortsEditor||typeof w.KNShortsEditor.open!=='function'){say('動画編集を読み込めませんでした。ページを開き直してください。');return;}
    var serial=generation;videoPreview.pause();modal.hidden=true;
    function returnToForm(){if(serial!==generation)return false;editorHandle=null;modal.hidden=false;setBusy(false);editButton.focus();return true;}
    try{editorHandle=w.KNShortsEditor.open({initialFile:selectedFile,onConfirm:function(file,meta){if(returnToForm())selectVideo(file,meta);},onCancel:function(){returnToForm();}});}
    catch(_){editorHandle=null;modal.hidden=false;say('動画編集を開けませんでした。もう一度お試しください。');setBusy(false);}
  }
  function create(){
    if(modal)return;
    modal=node('div','ks-post-overlay');modal.id='knShortsPublish';modal.hidden=true;
    var dialog=node('section','ks-post-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','ksPostTitle');
    var head=node('div','ks-post-head'),title=node('h2','','動画を投稿');title.id='ksPostTitle';var close=node('button','ks-post-close','閉じる');close.type='button';close.addEventListener('click',exit);head.appendChild(title);head.appendChild(close);dialog.appendChild(head);
    dialog.appendChild(node('p','ks-post-intro','自分の動画を選ぶか、このサイトで撮影・編集して、ショートに投稿できます。'));
    status=node('p','ks-post-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');dialog.appendChild(status);
    form=node('form','ks-post-form');dialog.appendChild(form);
    editButton=node('button','ks-post-edit','動画を選ぶ・撮影する');editButton.type='button';editButton.addEventListener('click',editVideo);form.appendChild(editButton);
    fileSummary=node('p','ks-post-file-summary','まだ動画を選んでいません。');form.appendChild(fileSummary);
    videoPreview=node('video','ks-post-preview');videoPreview.controls=true;videoPreview.playsInline=true;videoPreview.muted=true;videoPreview.hidden=true;videoPreview.setAttribute('aria-label','投稿する動画のプレビュー');form.appendChild(videoPreview);
    var videoTitle=field('タイトル','title');videoTitle.maxLength=120;videoTitle.required=true;
    var caption=field('説明（任意）','caption','textarea');caption.maxLength=280;caption.rows=3;
    var topic=field('ジャンル','topic','select');topics.forEach(function(tag){var option=node('option','',tag);option.value=tag;topic.appendChild(option);});
    submit=node('button','ks-post-submit','投稿する');submit.type='submit';form.appendChild(submit);
    form.addEventListener('input',function(){requestId=null;});form.addEventListener('change',function(){requestId=null;});form.addEventListener('submit',send);
    var ownTitle=node('h3','','自分の投稿');dialog.appendChild(ownTitle);ownerList=node('div','ks-post-mine');dialog.appendChild(ownerList);
    modal.appendChild(dialog);modal.addEventListener('click',function(e){if(e.target===modal)exit();});modal.addEventListener('keydown',function(e){if(e.key==='Escape'){e.preventDefault();exit();return;}if(e.key==='Tab'){var controls=Array.from(dialog.querySelectorAll('button,input,textarea,select,[tabindex]')).filter(function(n){return !n.disabled&&n.getClientRects().length>0;});if(!controls.length)return;var first=controls[0],last=controls[controls.length-1];if(e.shiftKey&&w.document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&w.document.activeElement===last){e.preventDefault();first.focus();}}});w.document.body.appendChild(modal);
  }
  async function session(){
    var serial=++generation;owner=null;setBusy(false);ownerList.textContent='';mineCursor=null;
    try{var current=await getLoggedInSession(w.sb);if(serial!==generation||modal.hidden)return;owner=current.user.id;say('');setBusy(false);loadMine(false,serial);}
    catch(_){if(serial===generation&&!modal.hidden)say(message('login_required'));}
  }
  function player(){var feed=w.document.getElementById('ksFeed'),sheet=w.document.getElementById('knShorts');return w.KNShortsPlayback&&feed&&sheet?w.KNShortsPlayback.get(feed,sheet):null;}
  function resumePlayback(){var sheet=w.document.getElementById('knShorts'),feed=w.document.getElementById('ksFeed'),managed=player();if(!managed||!sheet||!sheet.classList.contains('open')||w.document.hidden||!feed)return;var rect=feed.getBoundingClientRect(),selected=null,best=0;Array.from(feed.querySelectorAll('.ks-slide')).forEach(function(s){var r=s.getBoundingClientRect(),overlap=Math.max(0,Math.min(r.bottom,rect.bottom)-Math.max(r.top,rect.top));if(overlap>best){best=overlap;selected=s;}});if(selected)managed.activate(selected);}
  function open(){create();var managed=player();if(managed)managed.close();modal.hidden=false;session();var close=modal.querySelector('.ks-post-close');if(close&&close.focus)close.focus();}
  function resetForm(){form.reset();clearVideo();}
  function exit(resume){if(!modal||(modal.hidden&&!editorHandle))return;generation++;var activeEditor=editorHandle;editorHandle=null;if(activeEditor&&typeof activeEditor.close==='function')activeEditor.close();modal.hidden=true;owner=null;requestId=null;busy=false;resetForm();ownerList.textContent='';say('');var sheet=w.document.getElementById('knShorts'),btn=w.document.getElementById('ksPublishBtn');if(resume!==false)resumePlayback();if(!w.document.hidden&&sheet&&sheet.classList.contains('open')&&btn&&btn.getClientRects().length&&btn.focus)btn.focus();}
  async function api(path,options,authenticated){
    options=options||{};options.credentials='same-origin';options.cache='no-store';
    if(authenticated){var current=await getLoggedInSession(w.sb);if(current.user.id!==owner)throw new Error('login_required');options.headers=Object.assign({},options.headers,{Authorization:'Bearer '+current.access_token});}
    var response=await w.fetch(path,options),data;
    try{data=await response.json();}catch(_){throw new Error('storage_unavailable');}
    if(!response.ok||!data||data.ok!==true)throw new Error(data&&typeof data.reason==='string'?data.reason:'storage_unavailable');return data;
  }
  async function loadPublished(){
    var serial=++feedGeneration,keyword=w.__ksKeyword||'',feed=w.KNShortsFeed,context=feed&&typeof feed.captureContext==='function'?feed.captureContext():null;
    if(keyword)return;
    try{var data=await api('/api/shorts/posts?limit=20');var sheet=w.document.getElementById('knShorts');
      if(serial!==feedGeneration||!sheet||!sheet.classList.contains('open')||w.document.hidden||(w.__ksKeyword||'')!==keyword)return;
      if(w.KNShortsFeed&&typeof w.KNShortsFeed.appendPublished==='function')w.KNShortsFeed.appendPublished(data.posts,context);
    }catch(_){/* The existing seed/current video stays available on failure. */}
  }
  async function loadMine(more,serial){
    if(!owner||modal.hidden)return;serial=serial||generation;
    try{var data=await api('/api/shorts/mine?limit=20'+(more&&mineCursor?'&before='+mineCursor:''),{},true);
      if(serial!==generation||modal.hidden)return;if(!Array.isArray(data.posts)||data.posts.length>20)throw new Error('storage_unavailable');
      if(!more)ownerList.textContent='';var oldMore=ownerList.querySelector('.ks-post-more');if(oldMore)oldMore.remove();
      data.posts.forEach(function(p){if(!validId(p.id)||typeof p.title!=='string')return;var row=node('div','ks-post-own'),text=node('div','ks-post-own-text',p.title);
        var labels={pending:'アップロード未完了',hidden:'非表示',deleted:'削除済み・保存先の片付け待ち'};if(labels[p.state])text.appendChild(node('small','',labels[p.state]));row.appendChild(text);
        var del=node('button','ks-post-delete',p.state==='deleted'?'片付けを再試行':'削除');del.type='button';del.addEventListener('click',async function(){if(busy)return;del.disabled=true;
          try{var result=await api('/api/shorts/posts/'+p.id,{method:'DELETE'},true);if(serial!==generation||modal.hidden)return;
            say(result.cleanup_pending?'投稿を削除しました。保存先の片付けは少し後にもう一度お試しください。':'投稿を削除しました。');
            if(w.KNShortsFeed&&typeof w.KNShortsFeed.removePublished==='function')w.KNShortsFeed.removePublished(p.id);loadMine(false,serial);
          }catch(e){if(serial===generation&&!modal.hidden){say(message(e.message));del.disabled=false;}}});row.appendChild(del);ownerList.appendChild(row);});
      if(!ownerList.firstChild)ownerList.appendChild(node('p','ks-post-empty','まだ投稿はありません。'));
      mineCursor=data.has_more&&validId(data.next_cursor)?data.next_cursor:null;if(mineCursor){var moreBtn=node('button','ks-post-more','さらに見る');moreBtn.type='button';moreBtn.addEventListener('click',function(){moreBtn.disabled=true;loadMine(true,serial);});ownerList.appendChild(moreBtn);}
    }catch(e){if(serial===generation&&!modal.hidden)say(message(e.message));}
  }
  async function send(event){
    event.preventDefault();if(busy||!owner)return;var serial=generation,options;
    if(!requestId){if(!w.crypto||typeof w.crypto.randomUUID!=='function'){say('投稿を始められませんでした。ページを開き直してください。');return;}requestId=w.crypto.randomUUID();}
    var values={request_id:requestId,title:form.elements.title.value,caption:form.elements.caption.value,topic:form.elements.topic.value};
    var file=selectedFile;if(!file){say('動画を選ぶか撮影してください。');return;}if(file.size>maxFile){say(message('file_too_large'));return;}
    var body=new w.FormData();Object.keys(values).forEach(function(key){body.append(key,values[key]);});body.append('file',file);options={method:'POST',body:body};
    setBusy(true);say('動画を投稿しています…');
    try{var data=await api('/api/shorts/posts',options,true);if(serial!==generation||modal.hidden)return;requestId=null;resetForm();say('動画を投稿しました。');loadMine(false,serial);
      var feed=w.KNShortsFeed;if(feed&&typeof feed.appendPublished==='function')feed.appendPublished([data.post],typeof feed.captureContext==='function'?feed.captureContext():null);
    }catch(e){if(serial===generation&&!modal.hidden)say(message(e.message));}
    finally{if(serial===generation&&!modal.hidden)setBusy(false);}
  }
  function mount(){
    if(!w||!w.document||w.document.getElementById('ksPublishBtn'))return;
    var tries=0;
    function install(){var sheet=w.document.getElementById('knShorts'),shorts=w.document.getElementById('knShortsBtn'),top=sheet&&sheet.querySelector('.ks-top');
      if(!top||!shorts){if(++tries<30)w.setTimeout(install,500);return;}
      var nav=w.document.getElementById('knBottomNav'),inNav=nav&&shorts.parentNode===nav;
      var btn=node('button','ks-publish-btn'+(inNav?' ks-publish-nav':''));btn.id='ksPublishBtn';btn.type='button';btn.setAttribute('aria-label','動画を投稿');btn.addEventListener('click',open);
      if(inNav){var mark=node('span','ks-publish-mark','+');mark.setAttribute('aria-hidden','true');btn.appendChild(mark);nav.appendChild(btn);}
      else{btn.textContent='投稿';top.appendChild(btn);} // Keep the existing entry when the main navigation is unavailable.
      shorts.addEventListener('click',loadPublished);
      if(typeof w.MutationObserver==='function'){var visibility=new w.MutationObserver(function(){if(!sheet.classList.contains('open'))exit(false);});visibility.observe(sheet,{attributes:true,attributeFilter:['class']});}
      w.document.addEventListener('visibilitychange',function(){if(w.document.hidden)exit(false);});
      w.addEventListener('pagehide',function(){exit(false);});w.addEventListener('popstate',function(){exit(false);});
      w.document.addEventListener('knAuthChange',function(){var visible=modal&&(!modal.hidden||editorHandle);if(editorHandle){generation++;var active=editorHandle;editorHandle=null;active.close();modal.hidden=false;}generation++;owner=null;requestId=null;if(ownerList)ownerList.textContent='';if(visible){resetForm();session();}});
    }install();
  }
  return {feedRows:feedRows,getLoggedInSession:getLoggedInSession,loadPublished:loadPublished,open:open,mount:mount};
});

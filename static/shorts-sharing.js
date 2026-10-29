/* Optional link sharing. No uploads, credentials, storage or automatic distribution. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports={create:factory};
  if(root){var api=factory(root);root.KNShortsSharing=api;if(root.document.readyState==='complete')api.mount();else root.document.addEventListener('DOMContentLoaded',api.mount);}
})(typeof window==='undefined'?null:window,function(w){
  'use strict';
  var doc=w&&w.document,bound=new WeakSet(),observer=null,discovery=null,mounted=false,generation=0,dialog=null,lastOpen=null;
  function postId(value){if(typeof value!=='string'||!/^[1-9][0-9]{0,15}$/.test(value))return null;var id=Number(value);return Number.isSafeInteger(id)?id:null;}
  function shareURL(provider,id){
    if(provider==='youtube')return typeof id==='string'&&/^[A-Za-z0-9_-]{11}$/.test(id)?'https://www.youtube.com/shorts/'+id:null;
    if(provider!=='post'||postId(String(id))===null)return null;
    try{var origin=new w.URL(w.location.origin);if(!/^https?:$/.test(origin.protocol)||origin.username||origin.password||origin.origin==='null')return null;return origin.origin+'/shorts/'+id;}catch(_){return null;}
  }
  function node(tag,cls,text){var el=doc.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;}
  function within(element,parent){if(!parent)return false;while(element){if(element===parent)return true;element=element.parentNode;}return false;}
  function available(button){
    if(!button||button.isConnected===false||doc.hidden)return false;
    var feed=doc.getElementById('ksFeed');
    if(feed&&within(button,feed)){var sheet=doc.getElementById('knShorts'),posting=doc.getElementById('knShortsPublish');return !!(sheet&&sheet.classList.contains('open')&&(!posting||posting.hidden)&&!doc.getElementById('knShortsEditor'));}
    var details=doc.getElementById('ksDetailsPanel');
    if(details&&!details.hidden&&within(button,details)){var sheet=doc.getElementById('knShorts');return !!(sheet&&sheet.classList.contains('open'));}
    return within(button,doc.querySelector('.ks-share-viewer'));
  }
  function alive(button,serial){return serial===generation&&available(button);}
  function invalidate(){generation++;closeDialog(false);}
  function syncSheetState(){var sheet=doc.getElementById('knShorts'),open=!!(sheet&&sheet.classList.contains('open'));if(lastOpen===true&&!open)invalidate();lastOpen=open;if(dialog&&!available(dialog.button))closeDialog(false);}
  function closeDialog(returnFocus){
    if(!dialog)return;var current=dialog;dialog=null;current.overlay.remove();
    if(returnFocus!==false&&available(current.button))current.button.focus();
  }
  function openShare(url,button,shareTitle){
    closeDialog(false);var overlay=node('div','ks-share-copy-overlay'),panel=node('section','ks-share-copy-dialog');
    panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','ksShareCopyTitle');
    var title=node('h2','','リンクを共有');title.id='ksShareCopyTitle';panel.appendChild(title);
    var hint=node('p','ks-share-copy-status','下のURLをコピーして共有できます。');hint.id='ksShareCopyHint';hint.setAttribute('role','status');hint.setAttribute('aria-live','polite');panel.appendChild(hint);
    var input=node('input','ks-share-copy-url');input.type='text';input.value=url;input.readOnly=true;input.setAttribute('aria-label','共有するリンク');input.setAttribute('aria-describedby','ksShareCopyHint');panel.appendChild(input);
    input.addEventListener('click',function(){input.select();});
    var current={overlay:overlay,button:button,serial:generation};
    function active(){return dialog===current&&alive(button,current.serial);}
    function selectLink(message){if(!active())return;hint.textContent=message;input.focus();input.select();}
    var actions=node('div','ks-share-copy-actions'),copy=node('button','ks-share-copy-action','リンクをコピー');copy.type='button';actions.appendChild(copy);panel.appendChild(actions);
    copy.addEventListener('click',async function(){
      if(!active()||copy.disabled)return;
      if(!w.navigator||!w.navigator.clipboard||typeof w.navigator.clipboard.writeText!=='function'){selectLink('下のURLを選択してコピーしてください。');return;}
      copy.disabled=true;copy.textContent='コピーしています…';
      try{await w.navigator.clipboard.writeText(url);if(active())hint.textContent='リンクをコピーしました。';}
      catch(_){selectLink('リンクをコピーできませんでした。下のURLを選択してコピーしてください。');}
      finally{if(active()){copy.disabled=false;copy.textContent='リンクをコピー';}}
    });
    if(w.navigator&&typeof w.navigator.share==='function'){
      var app=node('button','ks-share-app-action','ほかのアプリに共有');app.type='button';actions.appendChild(app);
      app.addEventListener('click',async function(){
        if(!active()||app.disabled)return;app.disabled=true;app.textContent='共有先を開いています…';
        try{await w.navigator.share({title:shareTitle,url:url});if(active())hint.textContent='共有画面での操作が完了しました。';}
        catch(error){if(!error||error.name!=='AbortError'){if(active())hint.textContent='共有先を開けませんでした。リンクをコピーして共有できます。';}}
        finally{if(active()){app.disabled=false;app.textContent='ほかのアプリに共有';}}
      });
    }
    var close=node('button','ks-share-copy-close','閉じる');close.type='button';close.addEventListener('click',function(){closeDialog(true);});panel.appendChild(close);overlay.appendChild(panel);
    overlay.addEventListener('click',function(event){if(event.target===overlay)closeDialog(true);});
    overlay.addEventListener('keydown',function(event){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeDialog(true);}else if(event.key==='Tab'){if(event.shiftKey&&doc.activeElement===input){event.preventDefault();event.stopPropagation();close.focus();}else if(!event.shiftKey&&doc.activeElement===close){event.preventDefault();event.stopPropagation();input.focus();}}});
    dialog=current;doc.body.appendChild(overlay);input.focus();input.select();
  }
  function share(button){
    syncSheetState();if(!available(button))return;
    var provider=button.getAttribute('data-share-provider'),id=provider==='post'?button.getAttribute('data-post-id'):button.getAttribute('data-video-id'),url=shareURL(provider,id);
    if(!url)return;var title=button.getAttribute('data-share-title')||'経済ショート';title=Array.from(title).slice(0,120).join('');
    openShare(url,button,title);
  }
  function bind(button){if(bound.has(button))return;bound.add(button);button.addEventListener('click',function(event){event.preventDefault();event.stopPropagation();share(button);});}
  function decorate(){
    var feed=doc.getElementById('ksFeed');
    if(feed)Array.from(feed.querySelectorAll('.ks-slide')).forEach(function(slide){
      if(slide.querySelector('.ks-share-button'))return;
      var id=slide.getAttribute('data-post-id'),provider='post';
      if(postId(id)===null){provider='youtube';id=slide.getAttribute('data-vid');if(slide.getAttribute('data-media-type')==='upload'||!shareURL(provider,id))return;}
      var button=node('button','ks-share-button ks-feed-share');button.type='button';button.setAttribute('aria-label','動画を共有');button.setAttribute('title','共有');button.setAttribute('data-share-provider',provider);button.setAttribute(provider==='post'?'data-post-id':'data-video-id',id);
      var caption=slide.querySelector('.ks-cap');button.setAttribute('data-share-title',caption?Array.from(caption.textContent||'').slice(0,120).join(''):'経済ショート');
      var icon;
      if(typeof doc.createElementNS==='function'){
        icon=doc.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('class','ks-share-symbol');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','1.8');icon.setAttribute('stroke-linecap','round');icon.setAttribute('stroke-linejoin','round');
        var path=doc.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M12 16V3m-5 5 5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6');icon.appendChild(path);
      }else icon=node('span','ks-share-symbol','↗');
      icon.setAttribute('aria-hidden','true');button.appendChild(icon);slide.appendChild(button);bind(button);
    });
    Array.from(doc.querySelectorAll('.ks-share-button')).forEach(bind);
  }
  function installFeed(){
    if(observer)return true;var feed=doc.getElementById('ksFeed'),sheet=doc.getElementById('knShorts');if(!feed||!sheet)return false;
    if(discovery){discovery.disconnect();discovery=null;}
    decorate();syncSheetState();
    // The site's observer throttle supplies an empty record list. Decoration is
    // idempotent, so always scan after a notification rather than reading records.
    if(feed&&typeof w.MutationObserver==='function'){observer=new w.MutationObserver(function(){decorate();syncSheetState();});observer.observe(feed,{childList:true,subtree:true});}
    if(typeof w.MutationObserver==='function'){var visibility=new w.MutationObserver(syncSheetState);visibility.observe(sheet,{attributes:true,attributeFilter:['class']});}
    return true;
  }
  function mount(){
    if(mounted||!doc)return;mounted=true;decorate();syncSheetState();
    // The inline app may create its feed during DOMContentLoaded or a later
    // navigation retry. Stop discovery as soon as that single feed is present.
    if(!installFeed()&&!doc.querySelector('.ks-share-viewer')&&typeof w.MutationObserver==='function'){
      discovery=new w.MutationObserver(function(){installFeed();});discovery.observe(doc.body,{childList:true,subtree:true});
    }
    // Invalidate before other navigation closes/reopens the pane; the site's
    // throttled observer can otherwise miss a brief closed state.
    doc.addEventListener('click',function(event){var target=event.target,nav=doc.getElementById('knBottomNav');while(target&&target!==doc.body){var action=target.getAttribute&&target.getAttribute('data-act');if(action&&within(target,nav)){if(action!=='shorts')invalidate();return;}target=target.parentNode;}},true);
    doc.addEventListener('visibilitychange',function(){if(doc.hidden)invalidate();});
    w.addEventListener('pagehide',invalidate);
  }
  return {mount:mount,shareURL:shareURL,share:share};
});

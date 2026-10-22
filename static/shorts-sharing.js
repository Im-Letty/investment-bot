/* Optional link sharing. No uploads, credentials, storage or automatic distribution. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports={create:factory};
  if(root){var api=factory(root);root.KNShortsSharing=api;if(root.document.readyState==='complete')api.mount();else root.document.addEventListener('DOMContentLoaded',api.mount);}
})(typeof window==='undefined'?null:window,function(w){
  'use strict';
  var doc=w&&w.document,bound=new WeakSet(),observer=null,discovery=null,mounted=false,busy=false,generation=0,dialog=null,status=null,timer=null,lastOpen=null;
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
    return within(button,doc.querySelector('.ks-share-viewer'));
  }
  function alive(button,serial){return serial===generation&&available(button);}
  function invalidate(){generation++;if(busy){busy.button.disabled=false;busy=false;}closeDialog(false);if(status)announce('');}
  function syncSheetState(){var sheet=doc.getElementById('knShorts'),open=!!(sheet&&sheet.classList.contains('open'));if(lastOpen===true&&!open)invalidate();lastOpen=open;if(dialog&&!available(dialog.button))closeDialog(false);}
  function announce(message){
    if(timer){w.clearTimeout(timer);timer=null;}
    if(!status){status=node('p','ks-share-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');doc.body.appendChild(status);}
    status.hidden=!message;status.textContent=message;
    if(message)timer=w.setTimeout(function(){status.hidden=true;status.textContent='';timer=null;},5000);
  }
  function closeDialog(returnFocus){
    if(!dialog)return;var current=dialog;dialog=null;current.overlay.remove();
    if(returnFocus!==false&&available(current.button))current.button.focus();
  }
  function manualCopy(url,button,failed){
    closeDialog(false);var overlay=node('div','ks-share-copy-overlay'),panel=node('section','ks-share-copy-dialog');
    panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','ksShareCopyTitle');
    var title=node('h2','','リンクを共有');title.id='ksShareCopyTitle';panel.appendChild(title);
    var hint=node('p','',failed?'リンクをコピーできませんでした。下のURLを選択してコピーしてください。':'下のURLをコピーして共有できます。');hint.id='ksShareCopyHint';panel.appendChild(hint);
    var input=node('input','ks-share-copy-url');input.type='text';input.value=url;input.readOnly=true;input.setAttribute('aria-label','共有するリンク');input.setAttribute('aria-describedby','ksShareCopyHint');panel.appendChild(input);
    var close=node('button','ks-share-copy-close','閉じる');close.type='button';close.addEventListener('click',function(){closeDialog(true);});panel.appendChild(close);overlay.appendChild(panel);
    overlay.addEventListener('click',function(event){if(event.target===overlay)closeDialog(true);});
    overlay.addEventListener('keydown',function(event){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeDialog(true);}else if(event.key==='Tab'){if(event.shiftKey&&doc.activeElement===input){event.preventDefault();event.stopPropagation();close.focus();}else if(!event.shiftKey&&doc.activeElement===close){event.preventDefault();event.stopPropagation();input.focus();}}});
    dialog={overlay:overlay,button:button};doc.body.appendChild(overlay);input.focus();input.select();
  }
  async function share(button){
    syncSheetState();if(busy||!available(button))return;
    var provider=button.getAttribute('data-share-provider'),id=provider==='post'?button.getAttribute('data-post-id'):button.getAttribute('data-video-id'),url=shareURL(provider,id);
    if(!url)return;var serial=generation,title=button.getAttribute('data-share-title')||'経済ショート';title=Array.from(title).slice(0,120).join('');
    var job={button:button};busy=job;button.disabled=true;announce('');
    try{
      if(w.navigator&&typeof w.navigator.share==='function'){
        try{await w.navigator.share({title:title,url:url});return;}catch(error){if(error&&error.name==='AbortError')return;}
        if(alive(button,serial))manualCopy(url,button,false);return;
      }
      if(w.navigator&&w.navigator.clipboard&&typeof w.navigator.clipboard.writeText==='function'){
        try{await w.navigator.clipboard.writeText(url);if(alive(button,serial))announce('リンクをコピーしました。');return;}catch(_){if(alive(button,serial))manualCopy(url,button,true);return;}
      }
      if(alive(button,serial))manualCopy(url,button,false);
    }finally{if(busy===job){busy=false;if(button.isConnected!==false)button.disabled=false;}}
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
    if(feed&&typeof w.MutationObserver==='function'){observer=new w.MutationObserver(decorate);observer.observe(feed,{childList:true,subtree:true});}
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
    w.addEventListener('pagehide',invalidate);
  }
  return {mount:mount,shareURL:shareURL};
});

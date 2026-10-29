/* App-owned video information lives beside the player, never over its picture.
   Existing save/follow/share handlers remain the only writers/actions. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory;
  if(root){var api=factory(root);root.KNShortsDetails=api;if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',api.mount,{once:true});else api.mount();}
})(typeof window==='undefined'?null:window,function(w){
  'use strict';
  var doc=w.document,sheet,feed,panel,trigger,observed=false,discovery,slideIndex=0;
  function node(tag,cls,text){var n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
  function text(slide,selector){var el=slide&&slide.querySelector(selector);return el?(el.textContent||'').trim():'';}
  function describe(slide){
    if(!slide)return null;
    var id=slide.getAttribute('data-vid'),post=slide.getAttribute('data-post-id'),url=null;
    if(slide.getAttribute('data-media-type')==='upload'){if(/^[1-9][0-9]{0,15}$/.test(post||'')&&Number.isSafeInteger(Number(post)))url='/shorts/'+post;}
    else if(/^[A-Za-z0-9_-]{11}$/.test(id||''))url='https://www.youtube.com/watch?v='+id;
    return {title:text(slide,'.ks-cap'),creator:text(slide,'.ks-creator-name')||text(slide,'.ks-post-author'),tag:text(slide,'.ks-tag'),url:url};
  }
  function current(){
    if(!feed)return null;var slides=Array.from(feed.querySelectorAll('.ks-slide'));
    if(!slides.length)return null;
    var height=feed.clientHeight||1;slideIndex=Math.max(0,Math.min(slides.length-1,Math.round(feed.scrollTop/height)));
    return slides[slideIndex];
  }
  function anchor(index){
    // The optional information row changes the available stage height, not its
    // scale/crop. Keep the same selected video after that layout change.
    if(feed&&sheet&&sheet.classList.contains('open'))feed.scrollTop=index*feed.clientHeight;
  }
  function refresh(selected){
    if(!panel||panel.hidden)return;
    // A sharing job retains this visible initiator until its dialog closes.
    if(doc.querySelector&&doc.querySelector('.ks-share-copy-overlay'))return;
    var focused=doc.activeElement&&panel.contains(doc.activeElement)?doc.activeElement.getAttribute('data-details-action'):null;
    var slide=selected||current(),info=describe(slide);panel.replaceChildren();
    var head=node('div','ks-details-heading'),heading=node('h2','','動画の情報'),close=node('button','ks-details-close','閉じる');heading.id='ksDetailsTitle';close.type='button';close.setAttribute('data-details-action','close');
    close.addEventListener('click',function(){toggle(false,true);});head.appendChild(heading);head.appendChild(close);panel.appendChild(head);
    if(!info){panel.appendChild(node('p','','表示中の動画はありません。'));return;}
    if(info.title)panel.appendChild(node('p','ks-details-title',info.title));
    if(info.creator)panel.appendChild(node('p','ks-details-creator',info.creator));
    if(info.tag)panel.appendChild(node('p','ks-details-tag',info.tag));
    var actions=node('div','ks-details-actions');
    if(info.url){var source=node('a','ks-details-source',info.url.charAt(0)==='/'?'投稿を開く':'YouTubeで見る');source.href=info.url;source.target='_blank';source.rel='noopener noreferrer';actions.appendChild(source);}
    [['.ks-save','保存'],['.ks-follow-toggle','フォロー'],['.ks-share-button','共有']].forEach(function(pair){
      var original=slide.querySelector(pair[0]);if(!original)return;
      var button=node('button','ks-details-action',pair[0]==='.ks-follow-toggle'?original.textContent:(pair[0]==='.ks-save'&&original.getAttribute('aria-pressed')==='true'?'保存済み':pair[1]));button.type='button';
      button.setAttribute('data-details-action',pair[0]);button.setAttribute('aria-label',original.getAttribute('aria-label')||pair[1]);
      if(pair[0]==='.ks-share-button')['data-share-provider','data-post-id','data-video-id','data-share-title'].forEach(function(key){var value=original.getAttribute(key);if(value!==null)button.setAttribute(key,value);});
      if(original.getAttribute('aria-pressed')!==null)button.setAttribute('aria-pressed',original.getAttribute('aria-pressed'));
      button.addEventListener('click',function(){if(current()!==slide){refresh();return;}if(pair[0]==='.ks-share-button'&&w.KNShortsSharing&&typeof w.KNShortsSharing.share==='function'){w.KNShortsSharing.share(button);return;}original.click();refresh();});actions.appendChild(button);
    });
    panel.appendChild(actions);
    if(focused){var restored=Array.from(panel.querySelectorAll('button')).find(function(button){return button.getAttribute('data-details-action')===focused;});if(restored)restored.focus({preventScroll:true});}
  }
  function toggle(open,focus){
    if(!panel)return;var selected=current(),index=slideIndex;
    panel.hidden=!open;trigger.setAttribute('aria-expanded',String(open));
    if(open)refresh(selected);anchor(index);
    if(focus){var target=open?panel.querySelector('button'):trigger;if(target)target.focus({preventScroll:true});}
    return selected;
  }
  function mount(){
    if(observed)return true;
    sheet=doc.getElementById('knShorts');feed=doc.getElementById('ksFeed');var header=sheet&&sheet.querySelector('.ks-top');
    if(!sheet||!feed||!header){
      if(!discovery&&typeof w.MutationObserver==='function'){discovery=new w.MutationObserver(mount);discovery.observe(doc.body,{childList:true});}
      return false;
    }
    if(discovery){discovery.disconnect();discovery=null;}observed=true;
    trigger=node('button','ks-info-button');trigger.type='button';trigger.id='ksInfoBtn';trigger.setAttribute('aria-label','動画の情報とリンク');trigger.title='動画の情報とリンク';trigger.setAttribute('aria-controls','ksDetailsPanel');trigger.setAttribute('aria-expanded','false');
    trigger.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="8.5"/><path d="M12 10.5v6M12 7.2v.2" stroke-linecap="round"/></svg>';
    header.insertBefore(trigger,header.querySelector('#ksClose'));
    panel=node('section','ks-details-panel');panel.id='ksDetailsPanel';panel.hidden=true;panel.setAttribute('aria-labelledby','ksDetailsTitle');sheet.appendChild(panel);
    trigger.addEventListener('click',function(){toggle(panel.hidden,true);});
    panel.addEventListener('keydown',function(event){if(event.key==='Escape'){event.preventDefault();toggle(false,true);}});
    feed.addEventListener('scroll',function(){if(!panel.hidden&&current()!==panel.__current){panel.__current=current();refresh();}},{passive:true});
    if(typeof w.MutationObserver==='function'){
      new w.MutationObserver(function(){if(!panel.hidden)refresh();}).observe(feed,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-pressed']});
      new w.MutationObserver(function(){if(!sheet.classList.contains('open'))toggle(false,false);}).observe(sheet,{attributes:true,attributeFilter:['class']});
    }
    doc.addEventListener('click',function(event){var button=event.target&&event.target.closest?event.target.closest('#knBottomNav [data-act]'):null;if(button&&button.getAttribute('data-act')!=='shorts')toggle(false,false);},true);
    return true;
  }
  return {mount:mount,describe:describe,current:current,toggle:toggle};
});

/* Device-only follows use creator metadata returned by the existing YouTube search. */
(function(root,factory){
  'use strict';var exported=factory();if(typeof module==='object'&&module.exports)module.exports=exported;
  if(root&&root.document){root.KNShortsFollowing=exported.create(root);if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',root.KNShortsFollowing.mount);else root.KNShortsFollowing.mount();}
})(typeof window==='undefined'?null:window,function(){
  'use strict';
  function create(w){
    var followKey='knShortsFollowing_v1',cacheKey='knShortsCreatorCache_v1',ttl=30*24*60*60*1000;
    var ids=[],cache=[],followError=false,cacheError=false,purgeError=false,timer=null,retries=0,observing=null,eventsBound=false;
    var readMessage='フォロー情報を読み込めませんでした。この端末の保存設定を確認して、もう一度お試しください。';
    var writeMessage='フォローを保存できませんでした。変更は反映していません。この端末の保存設定を確認してください。';
    var purgeMessage='期限切れの動画情報を整理できませんでした。この端末の保存設定を確認して、もう一度お試しください。';
    function now(){return w.Date&&typeof w.Date.now==='function'?w.Date.now():Date.now();}
    function channel(value){return typeof value==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(value);}
    function video(value){return typeof value==='string'&&/^[A-Za-z0-9_-]{11}$/.test(value);}
    function text(value,limit,required){return typeof value==='string'&&Array.from(value).length<=limit&&(!required||value.trim().length>0)&&!/[\u0000-\u001f\u007f]/.test(value);}
    function row(value,stamp){
      if(!value||!video(value.id)||!channel(value.channelId)||!text(value.channelTitle,100,true)||!text(value.cap,500,false)||!text(value.tag,100,false)||!Number.isFinite(value.fetchedAt)||value.fetchedAt<0||value.fetchedAt>stamp)return null;
      return {id:value.id,cap:value.cap,tag:value.tag,channelId:value.channelId,channelTitle:value.channelTitle.trim(),fetchedAt:value.fetchedAt};
    }
    function fresh(value,stamp){return stamp-value.fetchedAt<ttl;}
    function read(key,kind){
      try{
        var raw=w.localStorage.getItem(key);if(raw===null)return {ok:true,value:[]};
        var data=JSON.parse(raw);if(!data||data.version!==1)return {ok:false};
        var values=kind==='follows'?data.ids:data.rows,limit=kind==='follows'?100:300;
        if(!Array.isArray(values)||values.length>limit)return {ok:false};
        var seen=Object.create(null),result=[],stamp=now(),pruned=false;
        for(var i=0;i<values.length;i++){
          var item=kind==='follows'?values[i]:row(values[i],stamp),keyValue=kind==='follows'?item:item&&item.id;
          if((kind==='follows'&&!channel(item))||!item||seen[keyValue])return {ok:false};
          seen[keyValue]=true;if(kind==='follows'||fresh(item,stamp))result.push(item);else pruned=true;
        }
        return {ok:true,value:result,pruned:pruned};
      }catch(_){return {ok:false};}
    }
    function merge(a,b){
      var byId=Object.create(null),stamp=now();
      a.concat(b).forEach(function(item){if(fresh(item,stamp)&&(!byId[item.id]||item.fetchedAt>=byId[item.id].fetchedAt))byId[item.id]=item;});
      return Object.keys(byId).map(function(id){return byId[id];}).sort(function(a,b){return b.fetchedAt-a.fetchedAt||(a.id<b.id?-1:a.id>b.id?1:0);}).slice(0,300);
    }
    function sync(){
      var preferences=read(followKey,'follows'),metadata=read(cacheKey,'cache');
      followError=!preferences.ok;cacheError=!metadata.ok;purgeError=false;
      if(preferences.ok)ids=preferences.value;
      cache=merge(metadata.ok?metadata.value:[],cache);
      if(metadata.ok&&metadata.pruned){try{w.localStorage.setItem(cacheKey,JSON.stringify({version:1,rows:cache}));}catch(_){cacheError=true;purgeError=true;}}
      return preferences.ok&&metadata.ok;
    }
    function creatorKnown(id){
      if(!video(id))return null;var item=cache.find(function(value){return value.id===id;});
      return item?{id:item.channelId,name:item.channelTitle,following:ids.indexOf(item.channelId)>=0}:null;
    }
    function remember(values){
      sync();var stamp=now(),accepted=[];
      if(Array.isArray(values))values.forEach(function(value){var item=row(value,stamp);if(item&&fresh(item,stamp))accepted.push(item);});
      cache=merge(cache,accepted);
      if(!cacheError){try{w.localStorage.setItem(cacheKey,JSON.stringify({version:1,rows:cache}));}catch(_){cacheError=true;}}
      hydrate(false);return accepted.length;
    }
    function rows(){sync();if(followError||cacheError)return [];return cache.filter(function(item){return ids.indexOf(item.channelId)>=0;}).map(function(item){return Object.assign({},item);});}
    function creator(id){sync();return creatorKnown(id);}
    function emptyMessage(){
      sync();if(followError||cacheError)return (purgeError?purgeMessage:readMessage)+' フォローはこの端末で確認できたYouTubeチャンネルにのみ使えます。';
      if(!ids.length)return 'まだフォローしていません。おすすめのチャンネル名の横からフォローできます。この端末で確認できたYouTube動画だけを表示します。';
      return 'フォロー中のチャンネルの動画はまだありません。おすすめで見かけたYouTube動画を、この端末で最大30日間表示します。';
    }
    function toggle(id){
      if(!channel(id))return {ok:false,following:false,error:'このチャンネルはフォローできません。'};
      var preferences=read(followKey,'follows');followError=!preferences.ok;
      if(!preferences.ok)return {ok:false,following:ids.indexOf(id)>=0,error:readMessage};
      ids=preferences.value;var wasFollowing=ids.indexOf(id)>=0,next=wasFollowing?ids.filter(function(value){return value!==id;}):ids.concat(id);
      if(next.length>100)return {ok:false,following:wasFollowing,error:'フォローはこの端末で100チャンネルまでです。先にフォローを解除してください。'};
      try{w.localStorage.setItem(followKey,JSON.stringify({version:1,ids:next}));}
      catch(_){return {ok:false,following:wasFollowing,error:writeMessage};}
      ids=next;return {ok:true,following:!wasFollowing,error:null};
    }
    function controller(){return w.KNShortsFeed&&typeof w.KNShortsFeed.getMode==='function'&&typeof w.KNShortsFeed.setMode==='function'?w.KNShortsFeed:null;}
    function mode(){var feed=controller();return feed&&feed.getMode()==='following'?'following':'recommended';}
    function status(message){
      var doc=w.document,sheet=doc&&doc.getElementById('knShorts');if(!sheet)return;
      var target=doc.getElementById('ksFollowStatus');if(!target){target=doc.createElement('p');target.id='ksFollowStatus';target.className='ks-follow-status';target.setAttribute('role','status');target.setAttribute('aria-live','polite');sheet.appendChild(target);}
      if(target.textContent!==(message||''))target.textContent=message||'';target.hidden=!message;
    }
    function select(next,focus){
      var feed=controller();if(!feed){status('表示を準備しています。少し待ってからもう一度お試しください。');schedule();return;}
      if(feed.setMode(next)===false)return;status('');hydrate(true);if(focus){var target=w.document.getElementById(next==='following'?'ksFollowingTab':'ksRecommendedTab');if(target)target.focus();}
    }
    function tabs(title){
      var doc=w.document;if(doc.getElementById('ksFollowingTab')&&doc.getElementById('ksRecommendedTab'))return;
      title.textContent='';var list=doc.createElement('div');list.className='ks-feed-tabs';list.setAttribute('role','tablist');list.setAttribute('aria-label','表示する動画');
      ['following','recommended'].forEach(function(value){
        var button=doc.createElement('button');button.type='button';button.id=value==='following'?'ksFollowingTab':'ksRecommendedTab';button.className='ks-feed-tab';button.textContent=value==='following'?'フォロー中':'おすすめ';button.setAttribute('role','tab');button.setAttribute('aria-controls','ksFeed');
        button.addEventListener('click',function(){select(value,false);});
        button.addEventListener('keydown',function(event){var next;if(event.key==='Home')next='following';else if(event.key==='End')next='recommended';else if(event.key==='ArrowLeft'||event.key==='ArrowRight')next=value==='following'?'recommended':'following';if(next){event.preventDefault();select(next,true);}});
        list.appendChild(button);
      });title.appendChild(list);
    }
    function decorate(feed){
      var doc=w.document;
      Array.from(feed.querySelectorAll('.ks-slide')).forEach(function(slide){
        var meta=slide.querySelector('.ks-meta');if(!meta)return;
        var known=creatorKnown(slide.getAttribute('data-vid')),existing=meta.querySelector('.ks-creator-row');
        if(!known){if(existing)existing.remove();return;}
        if(!existing){
          existing=doc.createElement('div');existing.className='ks-creator-row';var name=doc.createElement('span');name.className='ks-creator-name';existing.appendChild(name);
          var button=doc.createElement('button');button.type='button';button.className='ks-follow-toggle';existing.appendChild(button);
          button.addEventListener('click',function(){var result=toggle(existing.__creatorId);status(result.error||'');hydrate(false);var current=controller();if(result.ok&&current&&current.getMode()==='following'&&typeof current.refreshFollowing==='function'){current.refreshFollowing();var tab=doc.getElementById('ksFollowingTab');if(tab)tab.focus();}});
          meta.insertBefore(existing,meta.querySelector('.ks-cap')||meta.firstChild);
        }
        existing.__creatorId=known.id;
        var label=existing.querySelector('.ks-creator-name'),control=existing.querySelector('.ks-follow-toggle'),caption=known.following?'フォロー中':'フォロー';
        if(label.textContent!==known.name)label.textContent=known.name;
        if(control.textContent!==caption)control.textContent=caption;
        control.setAttribute('aria-pressed',String(known.following));control.setAttribute('aria-label',known.name+(known.following?'のフォローを解除':'をフォロー'));
      });
    }
    function hydrate(refresh){
      var doc=w.document;if(!doc)return;if(refresh!==false)sync();
      var title=doc.querySelector('#knShorts .ks-title'),feed=doc.getElementById('ksFeed');if(!title||!feed)return;
      tabs(title);var selected=mode();
      ['following','recommended'].forEach(function(value){var button=doc.getElementById(value==='following'?'ksFollowingTab':'ksRecommendedTab');button.setAttribute('aria-selected',String(value===selected));button.tabIndex=value===selected?0:-1;});
      feed.setAttribute('role','tabpanel');feed.setAttribute('aria-labelledby',selected==='following'?'ksFollowingTab':'ksRecommendedTab');decorate(feed);
    }
    function schedule(){if(timer!==null||retries>=40||typeof w.setTimeout!=='function')return;retries++;timer=w.setTimeout(function(){timer=null;mount();},250);}
    function mount(){
      var doc=w.document;if(!doc)return;
      var title=doc.querySelector('#knShorts .ks-title'),feed=doc.getElementById('ksFeed');if(!title||!feed){schedule();return;}
      hydrate(true);
      if(observing!==feed&&typeof w.MutationObserver==='function'){
        if(observing&&observing.__knFollowingObserver)observing.__knFollowingObserver.disconnect();
        var observer=new w.MutationObserver(function(records){if(records.some(function(record){return Array.from(record.addedNodes||[]).some(function(n){return n.nodeType===1&&((n.classList&&n.classList.contains('ks-slide'))||(n.querySelector&&n.querySelector('.ks-slide')));});}))hydrate(true);});
        observer.observe(feed,{childList:true,subtree:true});feed.__knFollowingObserver=observer;observing=feed;
      }
      if(!eventsBound&&typeof w.addEventListener==='function'){
        eventsBound=true;w.addEventListener('storage',function(event){if(event.key!==null&&event.key!==followKey&&event.key!==cacheKey)return;hydrate(true);var current=controller();if(current&&current.getMode()==='following'&&typeof current.refreshFollowing==='function')current.refreshFollowing();});
        w.addEventListener('pagehide',function(){if(timer!==null&&typeof w.clearTimeout==='function'){w.clearTimeout(timer);timer=null;}});
      }
      if(!controller())schedule();
    }
    sync();
    return {remember:remember,rows:rows,creator:creator,emptyMessage:emptyMessage,modeChanged:function(){hydrate(true);},mount:mount,toggle:toggle};
  }
  return {create:create};
});

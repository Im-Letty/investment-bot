(function () {
  'use strict';
  var names=['bg','paper','ink','muted','line','button','chip'], signature='', timer;
  var layoutNav, layoutHeader;
  function syncLayout() {
    var shorts=document.getElementById('knShorts');
    if(!shorts)return;
    // Actual nav height includes safe-area insets and larger text settings.
    var nav=layoutNav&&layoutNav.getBoundingClientRect().height;
    if(nav>0) {
      var value=Math.ceil(nav)+'px';
      if(shorts.style.getPropertyValue('--kn-sh-nav-height')!==value)
        shorts.style.setProperty('--kn-sh-nav-height',value);
    }
    var header=layoutHeader&&layoutHeader.getBoundingClientRect().height;
    if(header>0) {
      var value=Math.ceil(header)+'px';
      if(shorts.style.getPropertyValue('--kn-sh-header-height')!==value)
        shorts.style.setProperty('--kn-sh-header-height',value);
    }
  }
  var layoutObserver=typeof ResizeObserver==='function'?new ResizeObserver(syncLayout):null;
  function syncPalette() {
    var source=document.getElementById('morning-section');
    if(!source)return;
    var style=getComputedStyle(source), values={};
    names.forEach(function(name){values[name]=style.getPropertyValue('--kn-a-'+name).trim();});
    var paper=document.getElementById('knHomeMarkets');
    if(paper)values.paper=getComputedStyle(paper).backgroundColor;
    var next=JSON.stringify(values);
    if(next===signature)return;
    signature=next;
    names.forEach(function(name){if(values[name])document.documentElement.style.setProperty('--kn-sh-'+name,values[name]);});
  }
  function schedulePalette(){clearTimeout(timer);timer=setTimeout(syncPalette,0);}
  function decorateSlide(slide) {
    var vid=slide.getAttribute('data-vid'), caption=slide.querySelector('.ks-cap');
    if(!vid)return;
    var title=caption?caption.textContent:'';
    var frame=slide.querySelector('iframe');
    if(frame&&!frame.title)frame.title=title||'動画プレーヤー';
    var button=slide.querySelector('.ks-save');
    if(!button) {
      button=document.createElement('button');button.className='ks-save';button.type='button';
      button.setAttribute('data-vid',vid);button.textContent='☆';
      button.addEventListener('click',function(event){
        if(window.knToggleSave)window.knToggleSave(event,vid,title,button);
      });
      slide.appendChild(button);
    }
    var saved=!!(window.knSaved&&window.knSaved[vid]);
    if(button.classList.contains('on')!==saved)button.classList.toggle('on',saved);
    var mark=saved?'★':'☆';if(button.textContent!==mark)button.textContent=mark;
    button.setAttribute('aria-label',saved?'動画の保存を解除':'動画を保存');
    button.setAttribute('aria-pressed',String(saved));button.title=saved?'保存済み':'動画を保存';
  }
  // The app throttles observers and can supply no mutation records.
  var feedObserver=new MutationObserver(function(){
    if(observedFeed)observedFeed.querySelectorAll('.ks-slide').forEach(decorateSlide);
  });
  var headerObserver=new MutationObserver(hydrate), observedFeed, observedHeader;
  function hydrate() {
    syncPalette();
    var search=document.getElementById('ksSearchBtn');
    if(search)search.setAttribute('aria-label','動画を検索');
    var panel=document.getElementById('ksSearchPanel');
    if(panel) {
      panel.setAttribute('aria-label','動画の検索とジャンル選択');
      var input=panel.querySelector('input'), close=panel.lastElementChild;
      if(input)input.setAttribute('aria-label','動画のキーワード');
      if(close&&close.tagName==='BUTTON')close.setAttribute('aria-label','検索を閉じる');
    }
    var saved=document.getElementById('kgShortsSaved');
    if(saved)saved.setAttribute('aria-label','保存した動画');
    var savedOverlay=document.getElementById('knSavedOv');
    if(savedOverlay){
      var back=savedOverlay.querySelector('.kns-back'), savedTitle=savedOverlay.querySelector('.kns-top span');
      if(back)back.setAttribute('aria-label','保存一覧を閉じる');
      if(savedTitle&&savedTitle.textContent.indexOf('🔖')>=0)savedTitle.textContent='保存した動画';
    }
    var header=document.querySelector('#knShorts .ks-top');
    var nav=document.getElementById('knBottomNav');
    if(layoutObserver&&(header!==layoutHeader||nav!==layoutNav)) {
      layoutObserver.disconnect();
      if(header)layoutObserver.observe(header);
      if(nav)layoutObserver.observe(nav);
    }
    layoutHeader=header;layoutNav=nav;
    if(header&&header!==observedHeader){
      headerObserver.disconnect();observedHeader=header;
      headerObserver.observe(header,{childList:true});
    }
    var feed=document.getElementById('ksFeed');
    if(feed&&feed!==observedFeed) {
      feed.tabIndex=0;feed.setAttribute('aria-label','動画一覧。上下にスクロールして切替');
      feedObserver.disconnect();observedFeed=feed;
      feed.querySelectorAll('.ks-slide').forEach(decorateSlide);
      feedObserver.observe(feed,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    }
    syncLayout();
  }
  var rootObserver=new MutationObserver(schedulePalette);
  rootObserver.observe(document.documentElement,{attributes:true,attributeFilter:['style','class','data-custom-brand-color']});
  rootObserver.observe(document.body,{attributes:true,attributeFilter:['class','style','data-theme','data-kn-a-custom-color']});
  var structureObserver=new MutationObserver(hydrate);
  structureObserver.observe(document.body,{childList:true});
  document.addEventListener('knAuthChange',function(){if(observedFeed)observedFeed.querySelectorAll('.ks-slide').forEach(decorateSlide);});
  window.addEventListener('storage',schedulePalette);
  window.addEventListener('focus',schedulePalette);
  window.addEventListener('resize',syncLayout);
  hydrate();[100,600,1600].forEach(function(delay){setTimeout(hydrate,delay);});
})();

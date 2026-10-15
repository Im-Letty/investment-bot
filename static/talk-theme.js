(function () {
  'use strict';
  var watched=new WeakSet(),navHeight='',observedNav;
  function syncNavHeight() {
    var nav=document.getElementById('knBottomNav');if(!nav)return;
    var height=Math.ceil(nav.getBoundingClientRect().height);
    if(height>0&&navHeight!==height+'px'){
      navHeight=height+'px';document.documentElement.style.setProperty('--kn-talk-nav-height',navHeight);
    }
  }
  var navObserver=window.ResizeObserver?new ResizeObserver(syncNavHeight):null;
  function keyboardButton(element,label) {
    if(!element)return;
    if(label&&element.getAttribute('aria-label')!==label)element.setAttribute('aria-label',label);
    if(element.tagName==='BUTTON')return;
    element.setAttribute('role','button');element.tabIndex=0;
    if(element.dataset.knTalkKeyboard)return;
    element.dataset.knTalkKeyboard='1';
    element.addEventListener('keydown',function(event){
      if(event.key==='Enter'||event.key===' '){event.preventDefault();element.click();}
    });
  }
  var stateObserver=new MutationObserver(hydrate);
  function hydrate() {
    syncNavHeight();
    var nav=document.getElementById('knBottomNav');
    if(nav&&nav!==observedNav){
      observedNav=nav;if(navObserver)navObserver.observe(nav);
      stateObserver.observe(nav,{attributes:true,attributeFilter:['style','class']});
    }
    var active=false;
    ['talkOv','cmOv','stockTalkOv','teachOv'].forEach(function(id){
      var screen=document.getElementById(id);if(!screen)return;
      if(getComputedStyle(screen).display!=='none')active=true;
      if(!watched.has(screen)){
        watched.add(screen);stateObserver.observe(screen,{attributes:true,attributeFilter:['style','class']});
      }
    });
    if(document.body.classList.contains('kn-talk-active')!==active)document.body.classList.toggle('kn-talk-active',active);
    document.querySelectorAll('#talkOv .tk-head > span,#cmOv .cm-title').forEach(function(title){
      if(/^💬\s*/.test(title.textContent))title.textContent=title.textContent.replace(/^💬\s*/,'');
    });
    document.querySelectorAll('#talkOv .tk-sym').forEach(function(button){
      keyboardButton(button);
      button.setAttribute('aria-pressed',String(button.classList.contains('on')));
      if(!watched.has(button)){watched.add(button);stateObserver.observe(button,{attributes:true,attributeFilter:['class']});}
    });
    keyboardButton(document.querySelector('#cmOv .cm-back'),'トークに戻る');
    keyboardButton(document.querySelector('#talkOv .tk-x'),'銘柄トークを閉じる');
    keyboardButton(document.querySelector('#teachOv .to-x'),'相談を閉じる');
    [['tkName','ニックネーム（任意）'],['tkInput','コメントを書く（200文字まで）'],['cmNick','ニックネーム'],['cmInput','メッセージを書く（200文字まで）']].forEach(function(item){
      var field=document.getElementById(item[0]);if(field)field.setAttribute('aria-label',item[1]);
    });
    var message=document.getElementById('tkMsg');if(message)message.setAttribute('aria-live','polite');
  }
  // Conversation open/close prepares active state before the shared observer runs.
  window.knPrepareTalkScreen=hydrate;
  // KN_MO_THROTTLE can provide empty records, so inspect the current screen.
  var structureObserver=new MutationObserver(hydrate);
  structureObserver.observe(document.body,{childList:true});
  window.addEventListener('resize',syncNavHeight);
  hydrate();[100,600,1600].forEach(function(delay){setTimeout(hydrate,delay);});
})();

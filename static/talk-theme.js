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
  function icon(kind) {
    var span=document.createElement('span');span.className='kt-hub-icon';span.setAttribute('aria-hidden','true');
    span.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'+
      (kind==='community'?'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>':'<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>')+'</svg>';
    return span;
  }
  function decorateHub() {
    document.querySelectorAll('#talkHubOv .thb-card').forEach(function(card){
      if(card.querySelector('.kt-hub-copy'))return;
      var title=card.querySelector('.thb-tt'),subtitle=card.querySelector('.thb-sub');
      if(!title||!subtitle)return;
      var copy=document.createElement('div');copy.className='kt-hub-copy';
      copy.appendChild(title);copy.appendChild(subtitle);card.appendChild(copy);
      var arrow=document.createElement('span');arrow.className='kt-hub-arrow';arrow.textContent='›';arrow.setAttribute('aria-hidden','true');card.appendChild(arrow);
    });
    var officialTitle=document.querySelector('#talkHubOv .thb-title');
    if(officialTitle&&/^📣\s*/.test(officialTitle.textContent))officialTitle.textContent=officialTitle.textContent.replace(/^📣\s*/,'');
    var hub=document.getElementById('knMyTalkHub');
    if(!hub||hub.querySelector('.kt-hub-body'))return;
    var header=hub.firstElementChild,cards=Array.from(hub.children).slice(1);
    if(!header||cards.length!==2)return;
    hub.classList.add('kt-hub');header.classList.add('kt-hub-head');
    var heading=header.firstElementChild;
    if(heading){heading.classList.add('kt-hub-title');heading.textContent=heading.textContent.replace(/^💬\s*/,'');}
    var body=document.createElement('div');body.className='kt-hub-body';
    cards.forEach(function(card,index){
      card.classList.add('kt-hub-card');keyboardButton(card);
      var title=card.firstElementChild,subtitle=card.lastElementChild;
      var copy=document.createElement('div');copy.className='kt-hub-copy';
      if(title){title.classList.add('kt-hub-card-title');title.textContent=title.textContent.replace(/^(💬|👥)\s*/,'');copy.appendChild(title);}
      if(subtitle&&subtitle!==title){subtitle.classList.add('kt-hub-sub');copy.appendChild(subtitle);}
      card.appendChild(icon(index===1?'community':'stock'));card.appendChild(copy);
      var arrow=document.createElement('span');arrow.className='kt-hub-arrow';arrow.textContent='›';arrow.setAttribute('aria-hidden','true');card.appendChild(arrow);
      body.appendChild(card);
    });
    hub.appendChild(body);
  }
  var stateObserver=new MutationObserver(hydrate);
  function hydrate() {
    syncNavHeight();
    var nav=document.getElementById('knBottomNav');
    if(nav&&nav!==observedNav){
      observedNav=nav;if(navObserver)navObserver.observe(nav);
      stateObserver.observe(nav,{attributes:true,attributeFilter:['style','class']});
    }
    decorateHub();
    var active=false;
    ['knMyTalkHub','talkHubOv','talkOv','cmOv','teachOv'].forEach(function(id){
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
    keyboardButton(document.querySelector('#talkHubOv .thb-x'),'トークを閉じる');
    keyboardButton(document.querySelector('#talkOv .tk-x'),'銘柄トークを閉じる');
    keyboardButton(document.querySelector('#teachOv .to-x'),'相談を閉じる');
    [['tkName','ニックネーム（任意）'],['tkInput','コメントを書く（200文字まで）'],['cmNick','ニックネーム'],['cmInput','メッセージを書く（200文字まで）']].forEach(function(item){
      var field=document.getElementById(item[0]);if(field)field.setAttribute('aria-label',item[1]);
    });
    var message=document.getElementById('tkMsg');if(message)message.setAttribute('aria-live','polite');
  }
  // Talk is built on the first click. Prepare it in that same event so the
  // shared 300 ms observer throttle cannot expose the legacy layout first.
  window.knPrepareTalkScreen=hydrate;
  // KN_MO_THROTTLE can provide empty records, so inspect the current screen.
  var structureObserver=new MutationObserver(hydrate);
  structureObserver.observe(document.body,{childList:true});
  window.addEventListener('resize',syncNavHeight);
  hydrate();[100,600,1600].forEach(function(delay){setTimeout(hydrate,delay);});
})();

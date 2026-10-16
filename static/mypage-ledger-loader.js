(function () {
  'use strict';
  var page, body, tabs, pane, frame, personal, ledger, owner='', ready=false, loaded=false, personalScroll=0;
  function account() {
    var user=window.knUser;
    return user&&user.id?String(user.id):'';
  }
  function unload(keepParentScroll) {
    owner='';ready=false;loaded=false;
    if(!keepParentScroll){personalScroll=0;if(body)body.scrollTop=0;}
    if(frame&&frame.getAttribute('src')){
      // Detach the old browsing context immediately, including pending save
      // timers. A new account must never resume the previous account's page.
      pane.removeChild(frame);frame=createFrame();
    }
  }
  function createFrame() {
    var item=document.createElement('iframe');item.className='kb-frame';item.dataset.kbsrc='/kakeibo';
    item.setAttribute('title','家計簿');item.addEventListener('load',function(){
      if(item!==frame)return;
      loaded=true;ready=false;item.setAttribute('aria-busy','true');markReady();
    });pane.appendChild(item);
    return item;
  }
  function markReady() {
    if(!frame||!owner||owner!==account())return;
    try {
      var doc=frame.contentDocument;
      if(!doc||doc.documentElement.getAttribute('data-kn-ledger-ready')!=='true')return;
      ready=true;frame.removeAttribute('aria-busy');
    } catch(ignore) {}
  }
  function prepare() {
    if(!page||!page.classList.contains('open'))return;
    var current=account();
    if(!current){unload();return;}
    if(owner&&owner!==current)unload();
    if(owner===current)return;
    owner=current;ready=false;
    frame.setAttribute('aria-busy','true');
    // An authorized MyPage visit warms this document once. Hidden lazy frames
    // would otherwise defer the request until the household-ledger tab is tapped.
    frame.setAttribute('loading','eager');
    frame.setAttribute('src',frame.dataset.kbsrc);
  }
  function recoverWrongDocument() {
    if(!loaded||!frame||!frame.getAttribute('src'))return;
    try {
      var doc=frame.contentDocument,where=frame.contentWindow.location;
      if(!doc||doc.readyState!=='complete'||doc.documentElement.getAttribute('data-kn-ledger-ready')==='true')return;
      if(where.origin===location.origin&&/^https?:$/.test(where.protocol)&&where.pathname!=='/kakeibo')unload(owner===account());
    } catch(ignore) {}
  }
  function returnFromLedger(source) {
    if(!frame||source!==frame.contentWindow||!owner||owner!==account()||!page.classList.contains('open'))return false;
    try {
      if(!frame.contentDocument||frame.contentDocument.documentElement.getAttribute('data-kn-ledger-ready')!=='true')return false;
      var close=page.querySelector('.mo-x');
      if(!close)return false;
      close.click();return true;
    } catch(ignore) {return false;}
  }
  function show(group) {
    var wasLedger=pane.classList.contains('on');
    if(group===1){
      if(!account())return;
      recoverWrongDocument();
      prepare();
      markReady();
      if(ready)try {
        var child=frame.contentWindow;
        if(child.kkRefreshRecords)child.kkRefreshRecords();
        else if(child.renderAll)child.renderAll();
      } catch(ignore) {}
    }
    if(group===1&&!wasLedger)personalScroll=body.scrollTop;
    personal.classList.toggle('on',group===0);ledger.classList.toggle('on',group===1);
    // Reserve the same intrinsic tab-row height in both views, including large
    // type and translated labels. Hidden tabs must not remain keyboard targets.
    tabs.style.display='';tabs.style.visibility=group===0?'':'hidden';
    if(group===1){tabs.setAttribute('inert','');tabs.setAttribute('aria-hidden','true');}
    else {tabs.removeAttribute('inert');tabs.removeAttribute('aria-hidden');}
    pane.classList.toggle('on',group===1);
    var inner=body.querySelectorAll('.mo-pane:not(.kb-pane)'), ti=tabs.querySelectorAll('.mo-tab');
    for(var i=0;i<inner.length;i++)
      inner[i].classList.toggle('on',group===0&&!!(ti[i]&&ti[i].classList.contains('on')));
    if(group===1)body.scrollTop=0;
    else if(wasLedger)body.scrollTop=personalScroll;
    // Keep the same authenticated document, its scroll position and unfinished
    // inputs when switching tabs. Authentication changes destroy it below.
  }
  function setup() {
    page=document.getElementById('myPageOv');
    if(!page){setTimeout(setup,300);return;}
    tabs=page.querySelector('.mo-tabs');body=page.querySelector('.mo-body');
    if(!tabs||!body||page.querySelector('.mp-toptabs'))return;
    pane=body.querySelector('.kb-pane');
    if(!pane){pane=document.createElement('div');pane.className='mo-pane kb-pane';body.appendChild(pane);}
    frame=pane.querySelector('.kb-frame');
    if(!frame)frame=createFrame();
    var old=tabs.querySelector('.kb-tab');if(old)old.parentNode.removeChild(old);
    var top=document.createElement('div');top.className='mp-toptabs';
    personal=document.createElement('div');personal.className='mp-toptab on';personal.textContent='マイページ';
    ledger=document.createElement('div');ledger.className='mp-toptab';ledger.textContent='家計簿';
    top.appendChild(personal);top.appendChild(ledger);page.insertBefore(top,tabs);
    personal.addEventListener('click',function(){show(0);});
    ledger.addEventListener('click',function(){show(1);});
    window.addEventListener('message',function(event){
      if(event.origin===location.origin&&event.source===frame.contentWindow&&event.data&&event.data.type==='kn-kakeibo-ready')markReady();
    });
    document.addEventListener('knAuthChange',function(){
      if(owner&&owner!==account()){unload();show(0);}
      if(!account())page.classList.remove('open');
      else prepare();
    });
    new MutationObserver(prepare).observe(page,{attributes:true,attributeFilter:['class']});
    window.knPrepareLedger=prepare;
    window.knReturnFromLedger=returnFromLedger;
    window.knOpenLedger=function(){
      var card=document.getElementById('myPageCard');if(card)card.click();
      if(page.classList.contains('open')&&account())show(1);
    };
    prepare();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();

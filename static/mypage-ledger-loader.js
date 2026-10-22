(function () {
  'use strict';
  var page, body, tabs, pane, frame, personal, ledger, owner='', ready=false, loaded=false, personalScroll=0;
  var group=0, pendingAssets=false, pendingGoals=false;
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
    item.setAttribute('title','資産管理・家計簿');item.addEventListener('load',function(){
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
      ready=true;applyFrameView();frame.removeAttribute('aria-busy');
    } catch(ignore) {}
  }
  function portfolioSelected() {
    var first=tabs&&tabs.querySelector('.mo-tab');
    return !!(first&&first.classList.contains('on'));
  }
  function applyFrameView() {
    if(!ready||!owner||owner!==account())return;
    var view=group===1?'ledger':portfolioSelected()?'assets':null;
    if(!view)return;
    var child=frame.contentWindow;
    if(typeof child.kkSetMyPageView==='function')child.kkSetMyPageView(view);
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
  function show(nextGroup) {
    if(nextGroup===1&&!account())return;
    var wasLedger=group===1;
    group=nextGroup;
    var assets=group===0&&portfolioSelected()&&!!account();
    page.setAttribute('data-mp-view',group===1?'ledger':assets?'assets':'personal');
    if(group===1||assets){
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
    pane.classList.toggle('on',group===1||assets);
    var inner=body.querySelectorAll('.mo-pane:not(.kb-pane)'), ti=tabs.querySelectorAll('.mo-tab');
    for(var i=0;i<inner.length;i++)
      inner[i].classList.toggle('on',group===0&&!!(ti[i]&&ti[i].classList.contains('on')));
    if(group===1)body.scrollTop=0;
    else if(wasLedger)body.scrollTop=personalScroll;
    // Keep the same authenticated document, its scroll position and unfinished
    // inputs when switching tabs. Authentication changes destroy it below.
  }
  function openAssets() {
    pendingAssets=true;
    var card=document.getElementById('myPageCard');if(card)card.click();
    if(!page.classList.contains('open')||!account())return false;
    pendingAssets=false;
    var first=tabs.querySelector('.mo-tab');if(first)first.click();
    show(0);
    return true;
  }
  function openGoals() {
    pendingGoals=true;
    var card=document.getElementById('myPageCard');if(card)card.click();
    if(!page.classList.contains('open')||!account())return false;
    var goal=tabs.querySelectorAll('.mo-tab')[1];if(!goal)return false;
    pendingGoals=false;goal.click();show(0);return true;
  }
  function preparePortfolioNote() {
    var portfolio=body.querySelector('.mo-pane:not(.kb-pane)');
    var field=portfolio&&portfolio.querySelector('textarea');
    if(!field)return;
    portfolio.classList.add('mp-portfolio-note');
    var details=document.createElement('details'),summary=document.createElement('summary');
    summary.textContent='ポートフォリオのメモ';details.appendChild(summary);
    while(portfolio.firstChild)details.appendChild(portfolio.firstChild);
    portfolio.appendChild(details);field.rows=4;
    var lead=details.querySelector('.mo-lead');
    if(lead)lead.textContent='資産の計画や補足をメモできます。';
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
    preparePortfolioNote();
    var old=tabs.querySelector('.kb-tab');if(old)old.parentNode.removeChild(old);
    var top=document.createElement('div');top.className='mp-toptabs';
    personal=document.createElement('div');personal.className='mp-toptab on';personal.textContent='マイページ';
    ledger=document.createElement('div');ledger.className='mp-toptab';ledger.textContent='家計簿';
    top.appendChild(personal);top.appendChild(ledger);page.insertBefore(top,tabs);
    personal.addEventListener('click',function(){show(0);});
    ledger.addEventListener('click',function(){show(1);});
    tabs.querySelectorAll('.mo-tab').forEach(function(tab){
      // The original tab handler still owns each note, goal and Todo pane.
      tab.addEventListener('click',function(){show(0);});
    });
    window.addEventListener('message',function(event){
      if(event.origin===location.origin&&event.source===frame.contentWindow&&event.data&&event.data.type==='kn-kakeibo-ready')markReady();
    });
    document.addEventListener('knAuthChange',function(){
      if(owner&&owner!==account()){unload();show(0);}
      if(!account())page.classList.remove('open');
      else {show(group);prepare();if(pendingAssets)openAssets();else if(pendingGoals)openGoals();}
    });
    new MutationObserver(prepare).observe(page,{attributes:true,attributeFilter:['class']});
    window.knPrepareLedger=prepare;
    window.knReturnFromLedger=returnFromLedger;
    window.knOpenAssets=openAssets;
    window.knOpenGoals=openGoals;
    window.knOpenLedger=function(){
      var card=document.getElementById('myPageCard');if(card)card.click();
      if(page.classList.contains('open')&&account())show(1);
    };
    show(0);
    if(typeof URLSearchParams==='function'){var entry=new URLSearchParams(location.search||'').get('mypage');if(entry==='assets')openAssets();else if(entry==='goals')openGoals();}
  }
  if(document.readyState!=='complete')document.addEventListener('DOMContentLoaded',setup,{once:true});
  if(document.readyState!=='loading')setup();
})();

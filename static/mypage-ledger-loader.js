(function () {
  'use strict';
  var page, body, tabs, pane, frame, personal, ledger, owner='', ready=false, loaded=false, personalScroll=0;
  var group=0, pendingAssets=false, pendingGoals=false;
  var memoSession=null, memoBackdrop=null, memoLastFocus=null;
  function account() {
    var user=window.knUser;
    return user&&user.id?String(user.id):'';
  }
  function rendered(item) {
    if(!item||item.isConnected===false||typeof item.focus!=='function')return false;
    for(var at=item;at;at=at.parentElement||at.parentNode){
      if(at.hidden||at.inert||at.getAttribute&&at.getAttribute('aria-hidden')==='true')return false;
      if(window.getComputedStyle&&at.nodeType!==9){var css=window.getComputedStyle(at);if(css.display==='none'||css.visibility==='hidden'||css.visibility==='collapse')return false;}
    }
    if(item.getBoundingClientRect){var box=item.getBoundingClientRect();if(!(box.width>0&&box.height>0))return false;}
    return true;
  }
  function visible(item) {
    if(!rendered(item))return false;
    if(item.getBoundingClientRect){var box=item.getBoundingClientRect();if(box.right!=null&&box.right<=0||box.bottom!=null&&box.bottom<=0||window.innerWidth&&box.left>=window.innerWidth||window.innerHeight&&box.top>=window.innerHeight)return false;}
    return true;
  }
  function insidePage(item) { return !!item&&(item===page||page.contains&&page.contains(item)); }
  function focusMemo() {
    var remembered=memoLastFocus&&memoLastFocus.owner===account()&&memoLastFocus.node;
    var editor=page.querySelector('.mp-note-editor'),heading=page.querySelector('.mp-note-library .mp-heading');
    var target=rendered(remembered)&&!remembered.disabled?remembered:rendered(editor)?editor:rendered(heading)?heading:page;
    target.focus({preventScroll:true});
  }
  function endMemo(returnFocus,returnView) {
    var previous=memoSession;if(!previous)return;
    var focused=document.activeElement,ownsFocus=insidePage(focused)||focused===memoBackdrop||focused===document.body||!focused;
    if(insidePage(focused)&&focused!==page&&focused!==page.querySelector('.mo-x')&&previous.owner===account())memoLastFocus={owner:previous.owner,node:focused};
    memoSession=null;memoBackdrop.hidden=true;memoBackdrop.inert=true;
    document.body.classList.remove('kn-memo-dialog-active');document.body.style.overflow=previous.overflow;
    Object.keys(previous.attributes).forEach(function(key){var value=previous.attributes[key];if(value===null)page.removeAttribute(key);else page.setAttribute(key,value);});
    if(previous.title){previous.title.node.textContent=previous.title.text;if(previous.title.id===null)previous.title.node.removeAttribute('id');else previous.title.node.setAttribute('id',previous.title.id);if(previous.title.i18n===null)previous.title.node.removeAttribute('data-i18n');else previous.title.node.setAttribute('data-i18n',previous.title.i18n);}
    if(returnView){
      tabs.querySelectorAll('.mo-tab').forEach(function(tab,index){tab.classList.toggle('on',index===returnView.tabIndex);});
      show(returnView.group);body.scrollTop=returnView.scroll;personalScroll=returnView.personalScroll;
    }
    if(returnFocus&&ownsFocus){
      var candidates=[previous.origin,document.getElementById('knFloatHam'),document.getElementById('knHomeAMenu'),document.getElementById('myPageCard')];
      var target=candidates.find(visible);if(target)target.focus({preventScroll:true});
    }
  }
  function closeMemo() {
    if(!memoSession||group!==2||!page.classList.contains('open'))return;
    var sameOwner=memoSession.owner===account(),returnView=sameOwner&&memoSession.returnView;
    // End the memo first so the existing close button can restore navigation
    // without its memo capture handler intercepting the same click again.
    endMemo(false,returnView);
    if(!sameOwner){page.classList.remove('open');return;}
    var close=page.querySelector('.mo-x');
    if(close)close.click();
    else{
      page.classList.remove('open');document.body.classList.remove('kn-mypage-active');
      document.body.classList.add('view-asaletter');
      var morning=document.getElementById('morning-section');if(morning)morning.style.display='block';
      if(window.knNavScreenSync)window.knNavScreenSync();
    }
    if(window.KNMenuSheet&&typeof window.KNMenuSheet.openMain==='function')window.KNMenuSheet.openMain();
  }
  function beginMemo(origin,returnView) {
    if(memoSession)return;
    var attributes={};['role','aria-modal','aria-labelledby','aria-label','tabindex'].forEach(function(key){attributes[key]=page.getAttribute(key);});
    var head=page.querySelector('.mo-head'),title=head&&head.querySelector('span');
    memoSession={owner:account(),origin:origin,returnView:returnView,overflow:document.body.style.overflow,attributes:attributes,title:title?{node:title,text:title.textContent,id:title.getAttribute('id'),i18n:title.getAttribute('data-i18n')}:null};
    page.setAttribute('role','dialog');page.setAttribute('aria-modal','true');page.setAttribute('tabindex','-1');
    if(title){if(!title.id)title.setAttribute('id','knMemoDialogTitle');title.textContent='自由メモ';title.setAttribute('data-i18n','g2_mp_tab_memo');page.setAttribute('aria-labelledby',title.id);page.removeAttribute('aria-label');}
    else{page.removeAttribute('aria-labelledby');page.setAttribute('aria-label','自由メモ');}
    memoBackdrop.hidden=false;memoBackdrop.inert=false;document.body.classList.add('kn-memo-dialog-active');document.body.style.overflow='hidden';
  }
  function memoKeys(event) {
    if(!memoSession||group!==2||!page.classList.contains('open')||event.isComposing)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMemo();return;}
    if(event.key!=='Tab')return;
    var choices=Array.from(page.querySelectorAll('*')).filter(function(item){
      if(item.disabled||item.getAttribute('tabindex')==='-1'||!rendered(item))return false;
      var tag=item.tagName,tabindex=item.getAttribute('tabindex');
      if(tag==='INPUT'&&item.type==='hidden')return false;
      var parent=item.parentElement||item.parentNode,editable=item.isContentEditable||item.getAttribute('contenteditable')==='true';
      var editingHost=editable&&!(parent&&(parent.isContentEditable||parent.getAttribute&&parent.getAttribute('contenteditable')==='true'));
      return /^(BUTTON|INPUT|TEXTAREA|SELECT|SUMMARY)$/.test(tag)||tag==='A'&&item.getAttribute('href')!==null||tabindex!==null&&Number(tabindex)>=0||editingHost;
    });
    if(!choices.length){event.preventDefault();page.focus({preventScroll:true});return;}
    var index=choices.indexOf(document.activeElement);
    if(index<0||event.shiftKey&&index===0||!event.shiftKey&&index===choices.length-1){event.preventDefault();choices[event.shiftKey?choices.length-1:0].focus({preventScroll:true});}
  }
  function syncMemo() {
    if(memoSession&&(!page.classList.contains('open')||page.getAttribute('data-mp-view')!=='memo'||memoSession.owner!==account()))endMemo(false);
    prepare();
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
      ready=true;pane.classList.remove('mp-memo-warming');applyFrameView();frame.removeAttribute('aria-busy');
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
  function prepare(allowHidden) {
    if(!page||!page.classList.contains('open')&&allowHidden!==true)return;
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
    if(nextGroup!==0&&!account())return;
    if(nextGroup!==2)endMemo(false);
    var wasLedger=group===1;
    group=nextGroup;
    var assets=group===0&&portfolioSelected()&&!!account();
    page.setAttribute('data-mp-view',group===2?'memo':group===1?'ledger':assets?'assets':'personal');
    var top=page.querySelector('.mp-toptabs');
    top.hidden=group===2;
    if(group===2){top.setAttribute('inert','');top.setAttribute('aria-hidden','true');}
    else{top.removeAttribute('inert');top.removeAttribute('aria-hidden');}
    if(group===1||group===2||assets){
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
    tabs.hidden=group===2;tabs.style.display=group===2?'none':'';tabs.style.visibility=group===0?'':'hidden';
    if(group!==0){tabs.setAttribute('inert','');tabs.setAttribute('aria-hidden','true');}
    else {tabs.removeAttribute('inert');tabs.removeAttribute('aria-hidden');}
    pane.classList.toggle('on',group===1||assets);
    // The first direct note visit must also start the private document. Some
    // mobile browsers defer its navigation while its ancestor is display:none.
    // Lay it out offscreen only until readiness, without exposing its controls.
    pane.classList.toggle('mp-memo-warming',group===2&&!ready&&!!owner);
    if(group===2){pane.setAttribute('inert','');pane.setAttribute('aria-hidden','true');}
    else{pane.removeAttribute('inert');pane.removeAttribute('aria-hidden');}
    var inner=body.querySelectorAll('.mo-pane:not(.kb-pane)'), ti=tabs.querySelectorAll('.mo-tab');
    for(var i=0;i<inner.length;i++)
      inner[i].classList.toggle('on',group===2?i===3:group===0&&!!(ti[i]&&ti[i].classList.contains('on')));
    if(group===1)body.scrollTop=0;
    else if(wasLedger)body.scrollTop=personalScroll;
    // Keep the same authenticated document, its scroll position and unfinished
    // inputs when switching tabs. Authentication changes destroy it below.
  }
  function openAssets() {
    pendingGoals=false;pendingAssets=true;
    var card=document.getElementById('myPageCard');if(card)card.click();
    if(!page.classList.contains('open')||!account())return false;
    pendingAssets=false;
    var first=tabs.querySelector('.mo-tab');if(first)first.click();
    show(0);
    return true;
  }
  function openGoals() {
    return openAssets();
  }
  function showMyPage() {
    var first=tabs.querySelector('.mo-tab');if(first)first.click();
    show(0);
  }
  function openMemo() {
    var origin=document.activeElement;
    if(memoSession&&memoSession.owner===account()&&page.classList.contains('open')&&group===2){focusMemo();return true;}
    var returnView=page.classList.contains('open')&&group!==2?{group:group,scroll:body.scrollTop,personalScroll:personalScroll,tabIndex:Array.from(tabs.querySelectorAll('.mo-tab')).findIndex(function(tab){return tab.classList.contains('on');})}:null;
    var card=document.getElementById('myPageCard');if(card)card.click();
    if(!page.classList.contains('open')||!account())return false;
    show(2);
    beginMemo(origin,returnView);focusMemo();
    return true;
  }
  function hidePortfolioNote() {
    var portfolio=body.querySelector('.mo-pane:not(.kb-pane)');
    var field=portfolio&&portfolio.querySelector('textarea');
    if(!field)return;
    // Keep the original field and its saved content for the existing storage
    // lifecycle, while removing this obsolete note from the portfolio view.
    portfolio.classList.add('mp-portfolio-note');
    portfolio.hidden=true;
    portfolio.setAttribute('inert','');
    portfolio.setAttribute('aria-hidden','true');
  }
  function setup() {
    page=document.getElementById('myPageOv');
    if(!page){setTimeout(setup,300);return;}
    tabs=page.querySelector('.mo-tabs');body=page.querySelector('.mo-body');
    if(!tabs||!body||page.querySelector('.mp-toptabs'))return;
    memoBackdrop=document.createElement('div');memoBackdrop.className='mp-memo-backdrop';memoBackdrop.hidden=true;memoBackdrop.inert=true;memoBackdrop.setAttribute('aria-hidden','true');document.body.appendChild(memoBackdrop);
    memoBackdrop.addEventListener('click',function(event){if(event.target===memoBackdrop)closeMemo();});
    var close=page.querySelector('.mo-x');if(close)close.addEventListener('click',function(event){if(!memoSession||group!==2)return;event.preventDefault();event.stopImmediatePropagation();closeMemo();},true);
    page.addEventListener('keydown',memoKeys);
    page.addEventListener('focusin',function(event){if(memoSession&&event.target!==close&&event.target!==page&&insidePage(event.target))memoLastFocus={owner:account(),node:event.target};});
    pane=body.querySelector('.kb-pane');
    if(!pane){pane=document.createElement('div');pane.className='mo-pane kb-pane';body.appendChild(pane);}
    frame=pane.querySelector('.kb-frame');
    if(!frame)frame=createFrame();
    hidePortfolioNote();
    var old=tabs.querySelector('.kb-tab');if(old)old.parentNode.removeChild(old);
    var top=document.createElement('div');top.className='mp-toptabs';
    personal=document.createElement('div');personal.className='mp-toptab on';personal.textContent='ポートフォリオ';
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
      if(memoSession&&memoSession.owner!==account()){endMemo(false);memoLastFocus=null;}
      if(owner&&owner!==account()){unload();show(0);}
      if(!account())page.classList.remove('open');
      else {show(group);prepare();if(pendingAssets)openAssets();else if(pendingGoals)openGoals();}
    });
    new MutationObserver(syncMemo).observe(page,{attributes:true,attributeFilter:['class','data-mp-view']});
    window.knPrepareLedger=prepare;
    // Explicit summary-memory setup reuses this one owner-scoped document
    // without opening MyPage, changing its view or moving the reader.
    window.knPrepareAssistantMemory=function(){prepare(true);};
    window.knReturnFromLedger=returnFromLedger;
    window.knOpenAssets=openAssets;
    window.knOpenGoals=openGoals;
    window.knOpenMemo=openMemo;
    window.knShowMyPage=showMyPage;
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

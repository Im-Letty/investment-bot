(function () {
  'use strict';
  var watched=new WeakSet(), frames=new WeakSet(), observedBody;
  var colors=['bg','paper','ink','muted','line','button','chip'];
  function attribute(element,name,value) {
    if(element&&element.getAttribute(name)!==value)element.setAttribute(name,value);
  }
  function keyboard(element,role) {
    if(!element)return;
    attribute(element,'role',role||'button');attribute(element,'tabindex','0');
    if(watched.has(element))return;
    watched.add(element);
    element.addEventListener('keydown',function(event){
      if(event.key==='Enter'||event.key===' '){
        event.preventDefault();
        var list=element.closest('.td-list');
        var index=list?Array.from(list.querySelectorAll('.td-chk')).indexOf(element):-1;
        element.click();
        // The existing Todo renderer replaces each row when completion changes.
        if(index>=0&&!element.isConnected){
          var replacement=list.querySelectorAll('.td-chk')[index];
          if(replacement){decorateCheck(replacement);replacement.focus({preventScroll:true});}
        }
      }
    });
    stateObserver.observe(element,{attributes:true,attributeFilter:['class']});
  }
  function decorateCheck(check) {
    var text=check.parentElement.querySelector('.td-txt');
    keyboard(check,'checkbox');attribute(check,'aria-label',(text?text.textContent:'やること')+'の完了');
    attribute(check,'aria-checked',String(check.parentElement.classList.contains('done')));
  }
  function syncLedger() {
    var frame=document.querySelector('#myPageOv .kb-frame');
    if(!frame||!frame.getAttribute('src'))return;
    try {
      var url=new URL(frame.src,location.href);
      if(url.origin!==location.origin||url.pathname!=='/kakeibo')return;
      var doc=frame.contentDocument;if(!doc||!doc.body)return;
      var rootStyle=getComputedStyle(document.documentElement);
      colors.forEach(function(name){
        var value=rootStyle.getPropertyValue('--kn-sh-'+name).trim();
        if(value&&doc.documentElement.style.getPropertyValue('--kn-sh-'+name)!==value)
          doc.documentElement.style.setProperty('--kn-sh-'+name,value);
      });
      ['sans','serif'].forEach(function(name){
        var value=getComputedStyle(document.body).getPropertyValue('--kn-a-'+name).trim();
        if(value&&doc.documentElement.style.getPropertyValue('--kn-sh-'+name)!==value)
          doc.documentElement.style.setProperty('--kn-sh-'+name,value);
      });
      var scale=getComputedStyle(document.body).getPropertyValue('--kn-a-scale').trim()||'1';
      if(doc.documentElement.style.getPropertyValue('--kn-sh-scale')!==scale)
        doc.documentElement.style.setProperty('--kn-sh-scale',scale);
      attribute(doc.body,'data-kn-ledger-dark',String(document.body.getAttribute('data-theme')==='dark'));
    } catch(ignore) { /* A different-origin frame does not receive the palette. */ }
  }
  var stateObserver=new MutationObserver(hydrate);
  var contentsObserver=new MutationObserver(hydrate);
  function hydrate() {
    var page=document.getElementById('myPageOv');if(!page)return;
    var active=getComputedStyle(page).display!=='none';
    if(document.body.classList.contains('kn-mypage-active')!==active)
      document.body.classList.toggle('kn-mypage-active',active);
    if(!watched.has(page)){
      watched.add(page);stateObserver.observe(page,{attributes:true,attributeFilter:['class','style']});
    }
    page.querySelectorAll('.mp-toptab,.mo-tab').forEach(function(tab){
      keyboard(tab);attribute(tab,'aria-pressed',String(tab.classList.contains('on')));
    });
    page.querySelectorAll('.td-chk').forEach(decorateCheck);
    page.querySelectorAll('.td-del').forEach(function(button){attribute(button,'aria-label','やることを削除');});
    var title=page.querySelector('.mo-head > span');
    if(title&&/^📋\s*/.test(title.textContent))title.textContent=title.textContent.replace(/^📋\s*/,'');
    attribute(page.querySelector('.mo-x'),'aria-label','マイページを閉じる');
    [['mpPortfolio','ポートフォリオ'],['mpGoal','目標'],['mpMemo','自由メモ'],['mpTodoInput','やることを追加']].forEach(function(item){
      attribute(document.getElementById(item[0]),'aria-label',item[1]);
    });
    page.querySelectorAll('.mo-save').forEach(function(note){attribute(note,'aria-live','polite');});
    var body=page.querySelector('.mo-body');
    if(body&&body!==observedBody){
      observedBody=body;contentsObserver.disconnect();contentsObserver.observe(body,{childList:true,subtree:true});
    }
    var frame=page.querySelector('.kb-frame');
    if(frame&&!frames.has(frame)){
      frames.add(frame);attribute(frame,'title','資産管理・家計簿');frame.addEventListener('load',syncLedger);
    }
    syncLedger();
  }
  // Existing observer throttling can omit mutation records; inspect current nodes.
  new MutationObserver(hydrate).observe(document.body,{childList:true});
  var paletteObserver=new MutationObserver(syncLedger);
  paletteObserver.observe(document.documentElement,{attributes:true,attributeFilter:['style','class']});
  paletteObserver.observe(document.body,{attributes:true,attributeFilter:['style','class','data-theme']});
  document.addEventListener('knAuthChange',hydrate);
  hydrate();[100,600,1600].forEach(function(delay){setTimeout(hydrate,delay);});
})();

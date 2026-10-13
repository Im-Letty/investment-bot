/* One guide dialog reuses the existing beginner guide and assistant controls. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports={install:factory};
  if(root&&root.document){
    function boot(){var api=factory(root);if(api)root.KNSiteGuide=api;}
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  }
})(typeof window==='undefined'?null:window,function(w){
  'use strict';
  if(w.KNSiteGuide&&w.KNSiteGuide.installed)return w.KNSiteGuide;
  var doc=w.document,modal=doc.getElementById('bgModal'),sheet=doc.getElementById('bgSheet'),chat=doc.getElementById('knChatPanel');
  var assistant=w.KNAssistChat,nativeOpen=w.openBeginnerGuide,nativeClose=w.closeBeginnerGuide;
  if(!modal||!sheet||!chat||!assistant||typeof assistant.open!=='function'||typeof assistant.close!=='function'||typeof nativeOpen!=='function'||typeof nativeClose!=='function')return null;
  var priorChatOpen=chat.classList.contains('open'),priorGuideOpen=modal.classList.contains('bg-open');
  var copy={
    ja:{title:'ガイド・相談',guide:'はじめてガイド',chat:'ロボットに相談',tabs:'ガイドの表示',close:'ガイドを閉じる'},
    en:{title:'Guide & questions',guide:'Getting started',chat:'Ask the assistant',tabs:'Guide views',close:'Close guide'},
    ko:{title:'가이드 · 질문',guide:'시작 가이드',chat:'로봇에게 질문',tabs:'가이드 보기',close:'가이드 닫기'},
    zh:{title:'指南与咨询',guide:'入门指南',chat:'向机器人提问',tabs:'指南视图',close:'关闭指南'}
  };
  function words(){var language=(doc.documentElement&&doc.documentElement.lang)||'ja';return copy[String(language).split('-')[0]]||copy.ja;}
  function node(tag,cls,id){var n=doc.createElement(tag);if(cls)n.className=cls;if(id)n.id=id;return n;}
  var guideView=node('div','kn-guide-content','knGuideContent');
  Array.from(sheet.childNodes).forEach(function(child){guideView.appendChild(child);});
  Array.from(guideView.children).forEach(function(child){if(child.classList.contains('bg-close')||child.tagName==='H2')child.hidden=true;});
  var header=node('header','kn-guide-hub-head'),title=node('h2','','knGuideHubTitle'),exit=node('button','kn-guide-hub-close','knGuideHubClose');
  exit.type='button';exit.textContent='×';header.appendChild(title);header.appendChild(exit);
  var tabs=node('div','kn-guide-tabs');tabs.setAttribute('role','tablist');
  var guideTab=node('button','kn-guide-tab','knGuideTabGuide'),chatTab=node('button','kn-guide-tab','knGuideTabChat');
  [[guideTab,'knGuideContent'],[chatTab,'knGuideChatHost']].forEach(function(item){item[0].type='button';item[0].setAttribute('role','tab');item[0].setAttribute('aria-controls',item[1]);tabs.appendChild(item[0]);});
  var chatHost=node('div','kn-guide-chat-host','knGuideChatHost');chatHost.appendChild(chat);
  guideView.setAttribute('role','tabpanel');guideView.setAttribute('aria-labelledby',guideTab.id);
  chatHost.setAttribute('role','tabpanel');chatHost.setAttribute('aria-labelledby',chatTab.id);
  chat.setAttribute('role','region');
  sheet.appendChild(header);sheet.appendChild(tabs);sheet.appendChild(guideView);sheet.appendChild(chatHost);
  modal.classList.add('kn-guide-hub');modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby',title.id);
  var active='guide',origin=null,chatTop=0,guideTop=0;
  function refreshLabels(){var text=words();title.textContent=text.title;guideTab.textContent=text.guide;chatTab.textContent=text.chat;tabs.setAttribute('aria-label',text.tabs);exit.setAttribute('aria-label',text.close);chat.setAttribute('aria-label',text.chat);}
  function reflect(){var isGuide=active==='guide';guideView.hidden=!isGuide;chatHost.hidden=isGuide;guideTab.setAttribute('aria-selected',String(isGuide));chatTab.setAttribute('aria-selected',String(!isGuide));guideTab.setAttribute('tabindex',isGuide?'0':'-1');chatTab.setAttribute('tabindex',isGuide?'-1':'0');}
  function rememberChat(){var body=doc.getElementById('knChatBody');if(body)chatTop=body.scrollTop;}
  function select(view,options){
    if(!modal.classList.contains('bg-open'))return false;
    view=view==='chat'?'chat':'guide';
    if(active!==view){
      if(active==='chat'){rememberChat();assistant.close();}
      else guideTop=guideView.scrollTop;
      active=view;reflect();
      if(view==='chat'){assistant.open({focusInput:!!(options&&options.focusInput)});var body=doc.getElementById('knChatBody');if(body)body.scrollTop=chatTop;}
      else guideView.scrollTop=guideTop;
    }
    if(!(options&&options.focusInput))(view==='chat'?chatTab:guideTab).focus({preventScroll:true});
    return true;
  }
  function open(view){
    view=view==='chat'?'chat':'guide';
    if(!modal.classList.contains('bg-open')){
      origin=doc.activeElement;nativeOpen();active='guide';reflect();guideView.scrollTop=guideTop;
    }
    modal.setAttribute('aria-hidden','false');refreshLabels();
    select(view,{focusInput:view==='chat'});
    return true;
  }
  function rendered(n){
    if(!n||n.isConnected===false||typeof n.focus!=='function')return false;
    var rect=n.getBoundingClientRect();
    return rect.width>0&&rect.height>0;
  }
  function visible(n){
    if(!rendered(n))return false;
    var rect=n.getBoundingClientRect();
    return (rect.right==null||rect.right>0)&&(rect.bottom==null||rect.bottom>0)&&(!w.innerWidth||rect.left<w.innerWidth)&&(!w.innerHeight||rect.top<w.innerHeight);
  }
  function close(){
    if(!modal.classList.contains('bg-open'))return;
    if(active==='chat')rememberChat();else guideTop=guideView.scrollTop;
    assistant.close();nativeClose();modal.setAttribute('aria-hidden','true');
    var target=[origin,doc.querySelector('.kn-orbit-guide'),doc.getElementById('knFloatHam'),doc.getElementById('knHomeAMenu')].find(visible);if(target)target.focus({preventScroll:true});
  }
  exit.addEventListener('click',close);
  guideTab.addEventListener('click',function(){select('guide');});chatTab.addEventListener('click',function(){select('chat');});
  tabs.addEventListener('keydown',function(event){
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();select(event.key==='Home'?'guide':event.key==='End'?'chat':active==='guide'?'chat':'guide');
  });
  modal.addEventListener('keydown',function(event){
    if(event.key==='Escape'){event.preventDefault();close();return;}
    if(event.key!=='Tab'||!modal.classList.contains('bg-open'))return;
    var focusable=Array.from(sheet.querySelectorAll('button,input,textarea,select,a[href],summary,[tabindex="0"]')).filter(function(n){return !n.disabled&&n.getAttribute('tabindex')!=='-1'&&rendered(n);});
    if(!focusable.length)return;
    var first=focusable[0],last=focusable[focusable.length-1];
    if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();}
  });
  doc.addEventListener('langChanged',refreshLabels);
  var api={installed:true,open:open,select:select,close:close};w.KNSiteGuide=api;
  w.openSiteGuide=open;w.openBeginnerGuide=function(){return open('guide');};w.closeBeginnerGuide=close;
  reflect();refreshLabels();modal.setAttribute('aria-hidden',String(!modal.classList.contains('bg-open')));
  if(priorChatOpen&&!priorGuideOpen)open('chat');
  return api;
});

/* Concern-first entrance. The original guide and assistant retain their DOM and controllers. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports={install:factory};
  if(root&&root.document){
    function boot(){var api=factory(root);if(api)root.KNConcernGuide=api;}
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  }
})(typeof window==='undefined'?null:window,function(w){
  'use strict';
  if(w.KNConcernGuide&&w.KNConcernGuide.installed)return w.KNConcernGuide;
  var d=w.document,hub=w.KNSiteGuide,assistant=w.KNAssistChat;
  var modal=d.getElementById('bgModal'),sheet=d.getElementById('bgSheet'),panel=d.getElementById('knChatPanel');
  var body=d.getElementById('knChatBody'),input=d.getElementById('knChatInput'),send=d.getElementById('knChatSend');
  if(!hub||!assistant||!modal||!sheet||!panel||!body||!input||!send)return null;
  var header=sheet.querySelector('.kn-guide-hub-head'),tabs=sheet.querySelector('.kn-guide-tabs');
  var foot=panel.querySelector('.kn-chat-foot'),hint=d.getElementById('knChatSuggestRefresh'),guide=d.getElementById('knGuideContent');
  if(!header||!tabs||!foot||!guide)return null;
  var copy={
    ja:{title:'何が気になっていますか？',read:'ガイドを読む',back:'悩みから選ぶ画面に戻る',placeholder:'気になっていることを入力',send:'質問を送信',sections:'ガイドの項目',topics:['家計を整えたい','投資を知りたい','運用が気になる','サイトの使い方'],questions:[
      ['家計は何から見直せばいい？','毎月、いくら使っているか知りたい','貯金と投資、どう考えればいい？'],
      ['投資が初めてで、何もわかりません','NISAの仕組みを知りたい','まだ投資しなくても大丈夫？'],
      ['値下がりが不安です','積み立てを続けるか迷っています','投資の言葉がわかりません'],
      ['資産をまとめて見たい','家計簿を使ってみたい','お気に入りの銘柄を整理したい']],sectionNames:['よくある疑問','ことばの意味','こんな気持ちのときは？']},
    en:{title:'What is on your mind?',read:'Read the guide',back:'Back to topics',placeholder:'Enter what is on your mind',send:'Send question',sections:'Guide topics',topics:['Manage my budget','Learn about investing','Investment concerns','Using this site'],questions:[
      ['Where can I start reviewing my budget?','I want to know how much I spend each month','How can I think about saving and investing?'],
      ['I am new to investing','I want to understand NISA','Is it OK not to invest yet?'],
      ['I am worried about falling prices','I am unsure about continuing regular investments','I do not understand investment terms'],
      ['I want to see my assets together','I want to try the household ledger','I want to organise my favourite stocks']],sectionNames:['Common questions','Words and meanings','Feelings and concerns']},
    ko:{title:'무엇이 궁금한가요?',read:'가이드 읽기',back:'고민 선택 화면으로 돌아가기',placeholder:'궁금한 내용을 입력하세요',send:'질문 보내기',sections:'가이드 항목',topics:['가계 정리하기','투자 알아보기','투자 고민','사이트 사용법'],questions:[
      ['가계는 무엇부터 점검하면 좋을까요?','매달 얼마를 쓰는지 알고 싶어요','저축과 투자를 어떻게 생각하면 좋을까요?'],
      ['투자가 처음이라 잘 모르겠어요','NISA의 구조를 알고 싶어요','아직 투자하지 않아도 괜찮을까요?'],
      ['가격 하락이 걱정돼요','적립식 투자를 계속할지 고민이에요','투자 용어를 잘 모르겠어요'],
      ['자산을 한곳에서 보고 싶어요','가계부를 사용해 보고 싶어요','관심 종목을 정리하고 싶어요']],sectionNames:['자주 묻는 질문','용어의 뜻','이런 마음이 들 때']},
    zh:{title:'你在关心什么？',read:'阅读指南',back:'返回话题选择',placeholder:'输入你关心的事情',send:'发送问题',sections:'指南主题',topics:['整理家庭收支','了解投资','投资方面的担心','网站使用方法'],questions:[
      ['家庭收支应该从哪里开始检查？','想知道每月花了多少钱','应该如何考虑储蓄和投资？'],
      ['我是投资新手，什么都不了解','想了解NISA的机制','暂时不投资也可以吗？'],
      ['我担心价格下跌','正在犹豫是否继续定期投资','不明白投资术语'],
      ['想集中查看资产','想试用记账功能','想整理关注的股票']],sectionNames:['常见问题','词语含义','有这些感受时']}
  };
  function words(){return copy[String(d.documentElement.lang||'ja').split('-')[0]]||copy.ja;}
  function node(tag,cls,id,text){var n=d.createElement(tag);if(cls)n.className=cls;if(id)n.id=id;if(text)n.textContent=text;return n;}
  var icons={
    bot:'M9 5h6v4M7 9h12a2 2 0 0 1 2 2v9H3v-9a2 2 0 0 1 2-2h2M7 14v3m10-3v3M1 14h2m18 0h2',
    wallet:'M3 6h16v14H3a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h14v4M17 11h5v5h-5a2.5 2.5 0 0 1 0-5Z',
    sprout:'M12 22v-9M12 14C4 14 3 11 3 7c5 0 9 1 9 7Zm0-5c0-5 3-7 8-7 0 5-2 8-8 8M5 22h14',
    heart:'M12 20 3 12C-2 7 5 1 9 6l3 3 3-3c4-5 11 1 6 6l-4 4M8 10l3-3m-2 8 3-3 3 3-3 3m4-2 2 2',
    compass:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM15.5 8.5l-2 5-5 2 2-5Z'
  };
  function icon(name){var n=node('span','kn-concern-icon');n.setAttribute('aria-hidden','true');n.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="'+icons[name]+'"/></svg>';return n;}
  var mark=icon('bot');mark.classList.add('kn-concern-mark');header.insertBefore(mark,header.firstChild);
  var back=node('button','kn-concern-back','knConcernBack','‹');back.type='button';header.insertBefore(back,mark);
  var home=node('section','kn-concern-home','knConcernHome');
  var heading=node('h2','','knConcernTitle');heading.setAttribute('tabindex','-1');
  home.setAttribute('aria-labelledby',heading.id);home.appendChild(heading);
  var grid=node('div','kn-concern-topics');home.appendChild(grid);
  var topicButtons=[],questionButtons=[],topic=0;
  ['wallet','sprout','heart','compass'].forEach(function(name,i){
    var b=node('button','kn-concern-topic','knConcernTopic'+i);b.type='button';b.appendChild(icon(name));
    var label=node('span','kn-concern-topic-label');b.appendChild(label);var arrow=node('span','kn-concern-arrow','','›');arrow.setAttribute('aria-hidden','true');b.appendChild(arrow);
    b.addEventListener('click',function(){topic=i;refreshTopics();});topicButtons.push({button:b,label:label});grid.appendChild(b);
  });
  var questions=node('div','kn-concern-questions');home.appendChild(questions);
  for(var i=0;i<3;i++){
    var q=node('button','kn-concern-question','knConcernQuestion'+i);q.type='button';var label=node('span');q.appendChild(label);
    var arrow=node('span','kn-concern-arrow','','↗');arrow.setAttribute('aria-hidden','true');q.appendChild(arrow);
    (function(index,button){button.addEventListener('click',function(){input.value=words().questions[topic][index];input.focus();});})(i,q);
    questionButtons.push({button:q,label:label});questions.appendChild(q);
  }
  var read=node('button','kn-concern-read','knConcernRead');read.type='button';home.appendChild(read);
  panel.insertBefore(home,body);
  send.removeAttribute('data-i18n');
  var nav=node('nav','kn-concern-guide-nav','knConcernGuideNav');var sectionLinks=[];
  var boxes=Array.from(guide.querySelectorAll('.bg-box'));
  boxes.slice(2,5).forEach(function(box,i){
    box.id=box.id||'knConcernSection'+(i+3);
    var b=node('button','kn-concern-section');b.type='button';
    b.addEventListener('click',function(){if(typeof box.scrollIntoView==='function')box.scrollIntoView({block:'start'});var h=box.querySelector('h3');if(h){h.setAttribute('tabindex','-1');h.focus({preventScroll:true});}});
    nav.appendChild(b);sectionLinks.push(b);
  });
  guide.insertBefore(nav,guide.firstChild);
  var originalOpen=hub.open,originalSelect=hub.select,inHome=true;
  function mode(homeMode){
    inHome=homeMode;modal.classList.toggle('kn-concern-home-open',homeMode);home.hidden=!homeMode;body.hidden=homeMode;back.hidden=homeMode;tabs.hidden=homeMode;
    if(hint)hint.hidden=homeMode;
    panel.setAttribute('aria-label',homeMode?words().title:words().send);
  }
  function showHome(){
    if(!modal.classList.contains('bg-open'))originalOpen('guide');
    originalSelect('chat',{focusInput:false});mode(true);heading.focus({preventScroll:true});return true;
  }
  function select(view,options){
    if(!modal.classList.contains('bg-open'))return false;
    if(view==='home')return showHome();
    mode(false);return originalSelect(view,options);
  }
  function open(view){
    if(!view||view==='home')return showHome();
    mode(false);return originalOpen(view);
  }
  function refreshTopics(){
    var text=words();topicButtons.forEach(function(x,i){x.label.textContent=text.topics[i];x.button.setAttribute('aria-pressed',String(i===topic));});
    questionButtons.forEach(function(x,i){x.label.textContent=text.questions[topic][i];});
  }
  function refresh(){
    var text=words();heading.textContent=text.title;read.textContent=text.read+' →';
    back.setAttribute('aria-label',text.back);input.setAttribute('aria-label',text.placeholder);input.placeholder=text.placeholder;send.textContent='↑';send.setAttribute('aria-label',text.send);
    nav.setAttribute('aria-label',text.sections);sectionLinks.forEach(function(b,i){b.textContent=text.sectionNames[i];});refreshTopics();
  }
  read.addEventListener('click',function(){select('guide');});back.addEventListener('click',showHome);
  // Native tab handlers run first; this listener only leaves the landing view.
  tabs.addEventListener('click',function(){mode(false);});
  tabs.addEventListener('keydown',function(e){if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key))mode(false);});
  // Capture switches the presentation before the retained explicit-send handler.
  function beforeSend(){if(input.value.trim()&&!send.disabled)mode(false);}
  send.addEventListener('click',beforeSend,true);
  input.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing)beforeSend();},true);
  d.addEventListener('langChanged',refresh);
  hub.open=open;hub.select=select;w.openSiteGuide=open;w.openBeginnerGuide=function(){return open('home');};
  refresh();mode(true);modal.classList.add('kn-concern-guide');
  var api={installed:true,open:open,select:select,close:hub.close};w.KNConcernGuide=api;
  return api;
});

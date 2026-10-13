/* Selected champagne orbit header. No account, market, or intro state changes. */
(function(){
  'use strict';
  var markup="<div class=\"kn-news-orbit\"><div class=\"kn-orbit-scene\" role=\"group\" aria-label=\"シャンパンのコイン・新聞・株価グラフが、やわらかな地球の周りを等間隔で巡るアニメーション\">\n<div class=\"kn-orbit-globe-halo\"></div><div class=\"kn-orbit-world-shadow\" data-knsoft=\"1\"></div>\n<div class=\"kn-orbit-plane\"><div class=\"kn-orbit-globe-orbit kn-orbit-orbit-back\"><span class=\"kn-orbit-ring-light\" aria-hidden=\"true\"></span></div>\n<div class=\"kn-orbit-earth-fixed\"><img class=\"kn-orbit-globe kn-orbit-illustrated-earth\" src=\"/static/news-orbit/earth.webp\" alt=\"\" width=\"512\" height=\"512\" decoding=\"async\"></div>\n<div class=\"kn-orbit-globe-orbit kn-orbit-orbit-front\"><span class=\"kn-orbit-ring-light\" aria-hidden=\"true\"></span></div>\n<div class=\"kn-orbit-news-orbiter kn-orbit-orbiter-one kn-orbit-orbiter-newspaper\"><button type=\"button\" class=\"kn-orbit-shortcut kn-orbit-news-shortcut\" aria-label=\"経済ニュースへ\"><span class=\"kn-orbit-shortcut-art\" aria-hidden=\"true\"><img src=\"/static/news-orbit/newspaper.webp\" width=\"256\" height=\"256\" decoding=\"async\" alt=\"\"></span></button></div>\n<div class=\"kn-orbit-news-orbiter kn-orbit-orbiter-two kn-orbit-orbiter-coin\"><button type=\"button\" class=\"kn-orbit-guide\" aria-label=\"ガイド・ロボット相談を開く\" aria-controls=\"bgModal\"><span class=\"kn-orbit-coin-face\" aria-hidden=\"true\"><img class=\"kn-orbit-coordinated-coin\" src=\"/static/news-orbit/coin.webp\" width=\"192\" height=\"192\" decoding=\"async\" alt=\"\"><span class=\"kn-orbit-coin-question\">?</span></span></button></div>\n<div class=\"kn-orbit-news-orbiter kn-orbit-orbiter-three kn-orbit-orbiter-market\"><button type=\"button\" class=\"kn-orbit-shortcut kn-orbit-rank-shortcut\" aria-label=\"今日の銘柄ランキングへ\"><div class=\"kn-orbit-market-tile kn-orbit-tile-bars\" aria-hidden=\"true\"><svg viewBox=\"0 0 56 40\"><defs><linearGradient id=\"area-kn-home-orbit\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"var(--kn-orbit-chart-line)\" stop-opacity=\".30\"/><stop offset=\"1\" stop-color=\"var(--kn-orbit-chart-line)\" stop-opacity=\".01\"/></linearGradient><linearGradient id=\"bar-kn-home-orbit\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop stop-color=\"var(--kn-orbit-chart-bar-light)\"/><stop offset=\"1\" stop-color=\"var(--kn-orbit-chart-bar)\"/></linearGradient></defs><path class=\"kn-orbit-chart-grid\" d=\"M7 12H49M7 22H49M7 32H49\"/><path class=\"kn-orbit-chart-axis\" d=\"M6 8V34H50\"/><rect x=\"12\" y=\"23\" width=\"6\" height=\"10\" rx=\"1.4\" fill=\"url(#bar-kn-home-orbit)\"/><rect x=\"24\" y=\"15\" width=\"6\" height=\"18\" rx=\"1.4\" fill=\"url(#bar-kn-home-orbit)\"/><rect x=\"36\" y=\"9\" width=\"6\" height=\"24\" rx=\"1.4\" fill=\"url(#bar-kn-home-orbit)\"/><path class=\"kn-orbit-chart-bar-shine\" d=\"M13.5 25V30M25.5 17V30M37.5 11V30\"/><path class=\"kn-orbit-chart-trace\" d=\"M9 21L20 17L28 20L39 10L48 13\"/><circle class=\"kn-orbit-chart-dot\" cx=\"48\" cy=\"13\" r=\"1.6\"/></svg></div></button></div>\n</div></div></div>";
  var labels={ja:['動きを止める','動きを再生','地球の周りを、コイン・新聞・株価グラフが巡るアニメーション'],en:['Pause animation','Play animation','A coin, newspaper and stock chart orbit the Earth'],ko:['애니메이션 일시 정지','애니메이션 재생','지구 주위를 도는 동전, 신문 및 주식 차트'],zh:['暂停动画','播放动画','硬币、报纸和股票图表围绕地球旋转']};
  function mount(host,options){
    var root=host.querySelector('.kn-news-orbit');
    if(!root||root.dataset.mounted)return;
    root.dataset.mounted='1';
    var button=document.getElementById('knHomeOrbitMotion'),scene=root.querySelector('.kn-orbit-scene');
    var settingLabel=document.getElementById('knHomeOrbitMotionLabel');
    var guide=root.querySelector('.kn-orbit-guide');
    var graphShortcut=root.querySelector('.kn-orbit-rank-shortcut'),newsShortcut=root.querySelector('.kn-orbit-news-shortcut');
    function tapFeedback(control){
      if(!control)return function(){};
      var timer=0;
      function clear(){
        if(timer)window.clearTimeout(timer);timer=0;
        control.classList.toggle('kn-orbit-tapped',false);
      }
      function light(){
        if(timer)window.clearTimeout(timer);
        control.classList.toggle('kn-orbit-tapped',true);
        timer=window.setTimeout(clear,480);
      }
      control.addEventListener('pointerdown',function(event){if(event.button===0||event.button===undefined)light();});
      control.addEventListener('pointercancel',clear);
      control.addEventListener('keydown',function(event){if(!event.repeat&&(event.key==='Enter'||event.key===' '))light();});
      return light;
    }
    var lightGuide=tapFeedback(guide),lightGraph=tapFeedback(graphShortcut),lightNews=tapFeedback(newsShortcut);
    var preference=window.matchMedia('(prefers-reduced-motion: reduce)');
    var reduced=preference.matches,savedPause=false,inView=true;
    try{savedPause=localStorage.getItem('kn_home_motion_paused')==='1';}catch(_){}
    var paused=reduced||savedPause;
    function copyLanguage(){var lang=document.documentElement.lang;try{lang=localStorage.getItem('app_lang')||lang;}catch(_){}return lang;}
    function copy(){return labels[copyLanguage()]||labels.ja;}
    function shortcutCopy(){
      return ({"ja":["今日の銘柄ランキングへ","経済ニュースへ"],"en":["Go to today's stock rankings","Go to economic news"],"ko":["오늘의 종목 순위로 이동","경제 뉴스로 이동"],"zh":["查看今日股票排名","查看经济新闻"]})[copyLanguage()]||shortcutCopy.ja;
    }
    shortcutCopy.ja=["今日の銘柄ランキングへ","経済ニュースへ"];
    function scrollToSection(id,headingId){
      var section=document.getElementById(id);if(!section)return;
      section.scrollIntoView({behavior:reduced?'auto':'smooth',block:'start'});
      var heading=headingId?document.getElementById(headingId):section.querySelector('.kn-a-section-title');
      if(heading){if(!heading.hasAttribute('tabindex'))heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});}
    }
    function navigateAfterView(id,headingId){
      // Stock view changes restore their scroll over two frames. Wait for that
      // work even for keyboard shortcuts, which do not send pointerdown.
      function navigate(){scrollToSection(id,headingId);}
      if(typeof window.requestAnimationFrame==='function')window.requestAnimationFrame(function(){window.requestAnimationFrame(navigate);});else navigate();
    }
    function showRanking(){
      var stock=document.querySelector('#knTabWrap [data-kn-tab="stock"]');
      if(stock)stock.click();else if(typeof window.__knSetSub==='function')window.__knSetSub('movers');
      navigateAfterView('knTabWrap');
    }
    function sync(){
      root.classList.toggle('kn-orbit-paused',paused);
      root.classList.toggle('kn-orbit-reduced',reduced);
      root.classList.toggle('kn-orbit-motion-enabled',!reduced);
      root.classList.toggle('kn-orbit-away',document.hidden||!inView);
      var words=copy(),label=words[paused?1:0];
      var navigationWords=shortcutCopy();
      if(graphShortcut)graphShortcut.setAttribute('aria-label',navigationWords[0]);
      if(newsShortcut)newsShortcut.setAttribute('aria-label',navigationWords[1]);
      if(guide)guide.setAttribute('aria-label',({ja:'ガイド・ロボット相談を開く',en:'Open the guide and assistant',ko:'가이드와 로봇 상담 열기',zh:'打开指南与机器人咨询'})[copyLanguage()]||'ガイド・ロボット相談を開く');
      if(button){button.setAttribute('aria-pressed',String(paused));button.setAttribute('aria-label',label);button.textContent=label;}
      if(settingLabel)settingLabel.textContent=({ja:'ホームのアニメーション',en:'Home animation',ko:'홈 애니메이션',zh:'首页动画'})[copyLanguage()]||'ホームのアニメーション';
      var descriptions=options&&options.descriptions;
      scene.setAttribute('aria-label',descriptions?(descriptions[copyLanguage()]||descriptions.ja||words[2]):words[2]);
    }
    if(guide)guide.addEventListener('click',function(){lightGuide();if(typeof window.openBeginnerGuide==='function')window.openBeginnerGuide();});
    if(graphShortcut)graphShortcut.addEventListener('click',function(){lightGraph();showRanking();});
    if(newsShortcut)newsShortcut.addEventListener('click',function(){lightNews();navigateAfterView('morning-news-section','knNewsDigestTitle');});
    if(button)button.addEventListener('click',function(){if(reduced)reduced=false;paused=!paused;savedPause=paused;try{localStorage.setItem('kn_home_motion_paused',paused?'1':'0');}catch(_){}sync();});
    function changed(event){reduced=event.matches;paused=reduced||savedPause;sync();}
    if(typeof window.dsReset==='function'){var reset=window.dsReset;window.dsReset=function(){var result=reset.apply(this,arguments);savedPause=false;reduced=preference.matches;paused=reduced;try{localStorage.removeItem('kn_home_motion_paused');}catch(_){}sync();return result;};}
    if(preference.addEventListener)preference.addEventListener('change',changed);else preference.addListener(changed);
    document.addEventListener('visibilitychange',sync);
    document.addEventListener('langChanged',sync);
    if('IntersectionObserver' in window){
      var observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.target===root){inView=entry.isIntersecting;sync();}});});
      observer.observe(root);
    }
    sync();
  }
  window.KNNewsOrbit={markup:markup,mount:mount};
})();

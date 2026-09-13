/* Selected champagne orbit header. No account, market, or intro state changes. */
(function(){
  'use strict';
  var markup="<div class=\"kn-news-orbit\"><div class=\"kn-orbit-scene\" role=\"img\" aria-label=\"シャンパンのコイン・新聞・株価グラフが、やわらかな地球の周りを等間隔で巡るアニメーション\">\n<div class=\"kn-orbit-globe-halo\"></div><div class=\"kn-orbit-globe-orbit kn-orbit-orbit-back\"></div><div class=\"kn-orbit-world-shadow\" data-knsoft=\"1\"></div>\n<img class=\"kn-orbit-globe kn-orbit-illustrated-earth\" src=\"/static/news-orbit/earth.webp\" alt=\"\" width=\"512\" height=\"512\" decoding=\"async\">\n<div class=\"kn-orbit-globe-orbit kn-orbit-orbit-front\"></div>\n<div class=\"kn-orbit-news-orbiter kn-orbit-orbiter-one kn-orbit-orbiter-newspaper\"><img src=\"/static/news-orbit/newspaper.webp\" width=\"256\" height=\"256\" decoding=\"async\" alt=\"\"></div>\n<div class=\"kn-orbit-news-orbiter kn-orbit-orbiter-two kn-orbit-orbiter-coin\"><img class=\"kn-orbit-coordinated-coin\" src=\"/static/news-orbit/coin.webp\" width=\"192\" height=\"192\" decoding=\"async\" alt=\"\"></div>\n<div class=\"kn-orbit-news-orbiter kn-orbit-orbiter-three kn-orbit-orbiter-market\"><div class=\"kn-orbit-market-tile kn-orbit-tile-bars\" aria-hidden=\"true\"><svg viewBox=\"0 0 56 40\"><defs><linearGradient id=\"area-kn-home-orbit\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"var(--kn-orbit-chart-line)\" stop-opacity=\".30\"/><stop offset=\"1\" stop-color=\"var(--kn-orbit-chart-line)\" stop-opacity=\".01\"/></linearGradient><linearGradient id=\"bar-kn-home-orbit\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop stop-color=\"var(--kn-orbit-chart-bar-light)\"/><stop offset=\"1\" stop-color=\"var(--kn-orbit-chart-bar)\"/></linearGradient></defs><path class=\"kn-orbit-chart-grid\" d=\"M7 12H49M7 22H49M7 32H49\"/><path class=\"kn-orbit-chart-axis\" d=\"M6 8V34H50\"/><rect x=\"12\" y=\"23\" width=\"6\" height=\"10\" rx=\"1.4\" fill=\"url(#bar-kn-home-orbit)\"/><rect x=\"24\" y=\"15\" width=\"6\" height=\"18\" rx=\"1.4\" fill=\"url(#bar-kn-home-orbit)\"/><rect x=\"36\" y=\"9\" width=\"6\" height=\"24\" rx=\"1.4\" fill=\"url(#bar-kn-home-orbit)\"/><path class=\"kn-orbit-chart-bar-shine\" d=\"M13.5 25V30M25.5 17V30M37.5 11V30\"/><path class=\"kn-orbit-chart-trace\" d=\"M9 21L20 17L28 20L39 10L48 13\"/><circle class=\"kn-orbit-chart-dot\" cx=\"48\" cy=\"13\" r=\"1.6\"/></svg></div></div>\n</div><button type=\"button\" class=\"kn-orbit-toggle\" aria-label=\"動きを止める\" title=\"動きを止める\" aria-pressed=\"false\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path class=\"kn-orbit-pause-icon\" d=\"M9 6v12M15 6v12\"/><path class=\"kn-orbit-play-icon\" d=\"m9 6 9 6-9 6Z\"/></svg></button></div>";
  var labels={ja:['動きを止める','動きを再生','地球の周りを、コイン・新聞・株価グラフが巡るアニメーション'],en:['Pause animation','Play animation','A coin, newspaper and stock chart orbit the Earth'],ko:['애니메이션 일시 정지','애니메이션 재생','지구 주위를 도는 동전, 신문 및 주식 차트'],zh:['暂停动画','播放动画','硬币、报纸和股票图表围绕地球旋转']};
  function mount(host){
    var root=host.querySelector('.kn-news-orbit');
    if(!root||root.dataset.mounted)return;
    root.dataset.mounted='1';
    var button=root.querySelector('.kn-orbit-toggle'),scene=root.querySelector('.kn-orbit-scene');
    var preference=window.matchMedia('(prefers-reduced-motion: reduce)');
    var reduced=preference.matches,paused=reduced,inView=true;
    function copy(){
      var lang=document.documentElement.lang;
      try{lang=localStorage.getItem('app_lang')||lang;}catch(_){}
      return labels[lang]||labels.ja;
    }
    function sync(){
      root.classList.toggle('kn-orbit-paused',paused);
      root.classList.toggle('kn-orbit-reduced',reduced);
      root.classList.toggle('kn-orbit-motion-enabled',!reduced);
      root.classList.toggle('kn-orbit-away',document.hidden||!inView);
      var words=copy(),label=words[paused?1:0];
      button.setAttribute('aria-pressed',String(paused));
      button.setAttribute('aria-label',label);button.title=label;
      scene.setAttribute('aria-label',words[2]);
    }
    button.addEventListener('click',function(){if(reduced)reduced=false;paused=!paused;sync();});
    function changed(event){reduced=event.matches;paused=reduced;sync();}
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

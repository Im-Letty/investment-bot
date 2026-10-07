/* Approved A drawer. Keep destinations and saved preferences on their existing paths. */
(function () {
  'use strict';
  var drawer, nav, lastOpener;
  var copy = {
    ja: {menu:'メニュー',close:'閉じる',frequent:'よく使うもの',news:'経済ニュース',stocks:'今日の銘柄',favorites:'お気に入り',calendar:'カレンダー',color:'カラー',resetColor:'元の色に戻す',original:'これまでの機能',morning:'朝の相場レター',sim:'シミュレーター',shorts:'ショート',saved:'保存した動画',talk:'トーク',kakeibo:'家計簿',memo:'メモ',alert:'急騰アラート',guide:'はじめてガイド',pet:'育成ゲーム',display:'表示設定',size:'文字の大きさ',font:'字体',small:'小',medium:'中',large:'大',largest:'特大',gothic:'ゴシック',round:'丸ゴシック',mincho:'明朝',klee:'かわいい',pop:'かっこいい',reset:'標準に戻す',style:'説明のスタイル',beginner:'かんたん解説',pro:'しっかり解説',account:'マイページ',language:'言語'},
    en: {menu:'Menu',close:'Close',frequent:'Quick access',news:'Economic news',stocks:'Stocks today',favorites:'Favorites',calendar:'Calendar',color:'Color',resetColor:'Reset color',original:'All features',morning:'Morning letter',sim:'Simulator',shorts:'Shorts',saved:'Saved videos',talk:'Talk',kakeibo:'Household budget',memo:'Notes',alert:'Price alerts',guide:'Getting started',pet:'Pet game',display:'Display settings',size:'Text size',font:'Font',small:'Small',medium:'Medium',large:'Large',largest:'Extra large',gothic:'Sans serif',round:'Rounded',mincho:'Serif',klee:'Handwritten',pop:'Stylish',reset:'Reset display',style:'Explanation style',beginner:'Simple',pro:'Detailed',account:'My page',language:'Language'},
    ko: {menu:'메뉴',close:'닫기',frequent:'빠른 이동',news:'경제 뉴스',stocks:'오늘의 종목',favorites:'즐겨찾기',calendar:'캘린더',color:'색상',resetColor:'색상 초기화',original:'모든 기능',morning:'아침 레터',sim:'시뮬레이터',shorts:'쇼츠',saved:'저장한 영상',talk:'대화',kakeibo:'가계부',memo:'메모',alert:'주가 알림',guide:'시작 가이드',pet:'육성 게임',display:'화면 설정',size:'글자 크기',font:'글꼴',small:'작게',medium:'보통',large:'크게',largest:'아주 크게',gothic:'고딕',round:'둥근 글꼴',mincho:'명조',klee:'손글씨',pop:'스타일 글꼴',reset:'기본으로',style:'설명 방식',beginner:'쉬운 설명',pro:'자세한 설명',account:'마이페이지',language:'언어'},
    zh: {menu:'菜单',close:'关闭',frequent:'快捷入口',news:'经济新闻',stocks:'今日股票',favorites:'收藏',calendar:'日历',color:'颜色',resetColor:'恢复颜色',original:'全部功能',morning:'早间市场',sim:'模拟器',shorts:'短视频',saved:'已保存视频',talk:'聊天',kakeibo:'家庭账本',memo:'备忘录',alert:'股价提醒',guide:'入门指南',pet:'养成游戏',display:'显示设置',size:'文字大小',font:'字体',small:'小',medium:'中',large:'大',largest:'特大',gothic:'黑体',round:'圆体',mincho:'明朝体',klee:'手写体',pop:'个性字体',reset:'恢复默认',style:'说明方式',beginner:'简单说明',pro:'详细说明',account:'我的主页',language:'语言'}
  };
  var paths = {news:'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5',stocks:'M4 19h16M6 15l4-5 4 3 5-8',favorites:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z',calendar:'M5 5h14v15H5zM8 3v4M16 3v4M5 10h14',sim:'M4 20h17M7 16V9M12 16V5M17 16v-4',shorts:'m8 5 11 7-11 7z',saved:'M6 3h12v18l-6-4-6 4z',talk:'M4 4h16v12H9l-5 4z',kakeibo:'M4 6h15v14H4zM4 6V4h12M14 11h7v5h-7z',memo:'M5 3h14v18H5zM8 8h8M8 12h8M8 16h5',alert:'M12 3 3 20h18zM12 9v5M12 17h.01',guide:'M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5M12 17h.01',pet:'M19 4C6 3 3 11 6 16s15 3 13-12ZM5 21l10-11',account:'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0M5 21v-2a7 7 0 0 1 14 0v2',morning:'M12 2v2M12 20v2M2 12h2M20 12h2M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0'};
  function lang() { var value; try { value=localStorage.getItem('app_lang'); } catch (_) {} return copy[value] ? value : 'ja'; }
  function text(key) { return copy[lang()][key] || key; }
  function stored(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; } }
  function icon(key) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+paths[key]+'"/></svg>'; }
  function row(key) { var b=document.createElement('button');b.type='button';b.className='drawer-item kn-menu-row';b.dataset.menuPage=key;b.innerHTML=icon(key)+'<span data-menu-copy="'+key+'">'+text(key)+'</span><svg class="kn-menu-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';return b; }
  function detail(key) { var d=document.createElement('details');d.className='kn-menu-details';d.innerHTML='<summary data-menu-copy="'+key+'">'+text(key)+'</summary>';return d; }
  function bn(act) { var b=document.querySelector('.bn-item[data-act="'+act+'"]');if(b)b.click(); }
  function close() { if(window.closeDrawer)window.closeDrawer(); }
  function openHome() { bn('morning'); }
  function scrollToNode(node) { if(node)node.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'}); }
  function navigate(key) {
    close();
    setTimeout(function () {
      if(key==='news'){openHome();scrollToNode(document.getElementById('morning-news-content'));}
      else if(key==='stocks'||key==='favorites'||key==='calendar'){
        openHome();
        if(key==='calendar'){var c=document.querySelector('#knTabWrap [data-kn-tab="div_cal"]');if(c)c.click();}
        else if(window.__knSetSub)window.__knSetSub(key==='favorites'?'watch':'movers');
        scrollToNode(document.getElementById('knTabWrap'));
      }
      else if(key==='morning')openHome();
      else if(key==='shorts'||key==='talk'||key==='pet')bn(key);
      else if(key==='sim'&&window.openSimulatorSection)window.openSimulatorSection();
      else if(key==='saved'&&window.openSaved)window.openSaved();
      else if(key==='alert'&&window.openAlertSection)window.openAlertSection();
      else if(key==='guide'&&window.openBeginnerGuide)window.openBeginnerGuide();
      else if(key==='account'||key==='kakeibo'||key==='memo'){
        bn('mypage');
        if(key!=='account')setTimeout(function(){var ov=document.getElementById('myPageOv');if(!ov)return;var tabs=ov.querySelectorAll('.mp-toptab'),tab=tabs[key==='kakeibo'?1:0];if(tab)tab.click();if(key==='memo'){var memo=ov.querySelector('.mo-tab[data-i18n="g2_mp_tab_memo"]');if(memo)memo.click();}},300);
      }
    },250);
  }
  function syncPreferences() {
    if(!drawer)return;
    // The drawer follows the home scale; legacy per-node sizing must not compound it.
    drawer.querySelectorAll('[data-bfs]').forEach(function(n){n.style.removeProperty('font-size');});
    drawer.querySelectorAll('[data-menu-size]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.menuSize===stored('ui_fontscale','m')));});
    var font=drawer.querySelector('#knMenuFont');if(font)font.value=stored('ui_font','gothic');
    drawer.querySelectorAll('[data-menu-style]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.menuStyle===stored('ui_style','pro')));});
    drawer.querySelectorAll('.drawer-color-preset').forEach(function(b){b.setAttribute('aria-pressed',String(b.classList.contains('active')&&document.documentElement.hasAttribute('data-custom-brand-color')));});
  }
  function translate() {
    if(!drawer)return;
    drawer.querySelectorAll('[data-menu-copy]').forEach(function(n){n.textContent=text(n.dataset.menuCopy);});
    var x=drawer.querySelector('.kn-menu-close');if(x)x.setAttribute('aria-label',text('close'));
    var font=drawer.querySelector('#knMenuFont');if(font)font.setAttribute('aria-label',text('font'));
    syncPreferences();
  }
  function rebuild() {
    drawer=document.getElementById('sideDrawer');nav=document.getElementById('drawerNav');
    if(!drawer||!nav)return;
    drawer.classList.add('kn-menu-a');
    var brand=document.getElementById('knHomeADrawerBrand');if(brand)brand.remove();
    var header=document.createElement('div');header.className='kn-menu-header';header.innerHTML='<span data-menu-copy="menu">'+text('menu')+'</span><button type="button" class="kn-menu-close" aria-label="'+text('close')+'"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';drawer.insertBefore(header,drawer.firstChild);header.querySelector('button').onclick=close;
    nav.replaceChildren();
    var panel=document.createElement('div');panel.className='knAccPanel kn-menu-content';nav.appendChild(panel);
    var label=document.createElement('p');label.className='kn-menu-label';label.dataset.menuCopy='frequent';label.textContent=text('frequent');panel.appendChild(label);
    ['news','stocks','favorites','calendar'].forEach(function(key){panel.appendChild(row(key));});
    var colors=drawer.querySelector('.drawer-color-wrap:has(.drawer-color-presets)');
    if(colors){var palette=document.createElement('section');palette.className='kn-menu-palette';palette.innerHTML='<h3 data-menu-copy="color">'+text('color')+'</h3>';palette.appendChild(colors);panel.appendChild(palette);colors.querySelectorAll('.drawer-color-preset').forEach(function(b){b.type='button';b.setAttribute('aria-label',b.title);b.style.setProperty('--menu-swatch',b.getAttribute('data-color'));});var reset=colors.querySelector('#drawerColorReset');if(reset){reset.removeAttribute('data-i18n');reset.dataset.menuCopy='resetColor';reset.textContent=text('resetColor');}}
    var original=detail('original');original.open=true;['morning','sim','shorts','saved','talk','kakeibo','memo','alert','guide','pet'].forEach(function(key){original.appendChild(row(key));});panel.appendChild(original);
    var display=detail('display');display.innerHTML+='<p class="kn-menu-label" data-menu-copy="size">'+text('size')+'</p><div class="kn-menu-sizes">'+[['s','small'],['m','medium'],['l','large'],['xl','largest']].map(function(v){return '<button type="button" data-menu-size="'+v[0]+'" data-menu-copy="'+v[1]+'">'+text(v[1])+'</button>';}).join('')+'</div><label class="kn-menu-font"><span data-menu-copy="font">'+text('font')+'</span><select id="knMenuFont" aria-label="'+text('font')+'">'+['gothic','round','mincho','klee','pop'].map(function(key){return '<option value="'+key+'" data-menu-copy="'+key+'">'+text(key)+'</option>';}).join('')+'</select></label>';
    var motion=document.getElementById('knHomeOrbitMotion');if(motion){motion.classList.add('kn-menu-motion');display.appendChild(motion);}
    var reset=document.createElement('button');reset.type='button';reset.className='kn-menu-reset';reset.dataset.menuReset='1';reset.dataset.menuCopy='reset';reset.textContent=text('reset');display.appendChild(reset);panel.appendChild(display);
    var style=detail('style');style.innerHTML+='<div class="kn-menu-styles">'+['beginner','pro'].map(function(key){return '<button type="button" data-menu-style="'+key+'" data-menu-copy="'+key+'">'+text(key)+'</button>';}).join('')+'</div>';panel.appendChild(style);panel.appendChild(row('account'));
    var language=detail('language'),grid=drawer.querySelector('.lang-grid');if(grid){language.appendChild(grid);panel.appendChild(language);}
    drawer.querySelectorAll(':scope > .drawer-section-label,:scope > .drawer-color-wrap,:scope > .drawer-footer').forEach(function(n){n.remove();});
    var oldSettings=document.getElementById('drawerSettingsBtn');if(oldSettings)oldSettings.parentElement.remove();
    nav.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;if(b.dataset.menuPage)navigate(b.dataset.menuPage);if(b.dataset.menuSize&&window.dsSetSize)window.dsSetSize(b.dataset.menuSize);if(b.dataset.menuStyle&&window._setUIStyle)window._setUIStyle(b.dataset.menuStyle);if(b.dataset.menuReset&&window.dsReset)window.dsReset();syncPreferences();});
    display.querySelector('select').addEventListener('change',function(e){if(window.dsSetFont)window.dsSetFont(e.target.value);syncPreferences();});
    drawer.addEventListener('click',function(){syncPreferences();});
    var observer=new MutationObserver(function(){Array.from(nav.children).forEach(function(n){if(n!==panel)n.remove();});});observer.observe(nav,{childList:true});
    var stateObserver=new MutationObserver(function(){var open=drawer.classList.contains('open');drawer.inert=!open;drawer.setAttribute('aria-hidden',String(!open));var opener=document.getElementById('knHomeAMenu');if(opener)opener.setAttribute('aria-expanded',String(open));if(open){nav.scrollTop=0;lastOpener=document.activeElement;header.querySelector('button').focus({preventScroll:true});}else if(lastOpener&&lastOpener.isConnected)lastOpener.focus({preventScroll:true});});stateObserver.observe(drawer,{attributes:true,attributeFilter:['class']});
    drawer.inert=!drawer.classList.contains('open');drawer.setAttribute('aria-hidden',String(drawer.inert));
    drawer.addEventListener('keydown',function(e){if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){var focusable=Array.from(drawer.querySelectorAll('button,select,input,summary,a[href]')).filter(function(n){return !n.disabled&&n.getClientRects().length;});var first=focusable[0],last=focusable[focusable.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
    translate();document.addEventListener('langChanged',translate);document.addEventListener('styleChanged',syncPreferences);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(rebuild,950);},{once:true});else setTimeout(rebuild,950);
})();

/* Compact bottom menu. Keep destinations and saved preferences on their existing paths. */
(function () {
  'use strict';
  var drawer, nav, lastOpener, mainPanel, backButton, syncDrawerState, colorController, currentView='main', wasOpen=false;
  var views=Object.create(null), viewTriggers=Object.create(null);
  var copy = {
    ja: {menu:'メニュー',back:'戻る',close:'閉じる',frequent:'よく使うもの',news:'経済ニュース',stocks:'今日の銘柄',favorites:'お気に入り',calendar:'カレンダー',color:'カラー',resetColor:'元の色に戻す',original:'これまでの機能',morning:'朝の相場レター',sim:'シミュレーター',shorts:'ショート',saved:'保存した動画',talk:'トーク',kakeibo:'家計簿',memo:'自由メモ',alert:'急騰アラート',guide:'はじめてガイド',pet:'育成ゲーム',display:'表示設定',size:'文字の大きさ',font:'字体',small:'小',medium:'中',large:'大',largest:'特大',gothic:'ゴシック',round:'丸ゴシック',mincho:'明朝',klee:'かわいい',pop:'かっこいい',reset:'標準に戻す',style:'説明のスタイル',beginner:'かんたん解説',pro:'しっかり解説',account:'マイページ',language:'言語',logout:'ログアウト'},
    en: {menu:'Menu',back:'Back',close:'Close',frequent:'Quick access',news:'Economic news',stocks:'Stocks today',favorites:'Favorites',calendar:'Calendar',color:'Color',resetColor:'Reset color',original:'All features',morning:'Morning letter',sim:'Simulator',shorts:'Shorts',saved:'Saved videos',talk:'Talk',kakeibo:'Household budget',memo:'Notes',alert:'Price alerts',guide:'Getting started',pet:'Pet game',display:'Display settings',size:'Text size',font:'Font',small:'Small',medium:'Medium',large:'Large',largest:'Extra large',gothic:'Sans serif',round:'Rounded',mincho:'Serif',klee:'Handwritten',pop:'Stylish',reset:'Reset display',style:'Explanation style',beginner:'Simple',pro:'Detailed',account:'My page',language:'Language',logout:'Log out'},
    ko: {menu:'메뉴',back:'뒤로',close:'닫기',frequent:'빠른 이동',news:'경제 뉴스',stocks:'오늘의 종목',favorites:'즐겨찾기',calendar:'캘린더',color:'색상',resetColor:'색상 초기화',original:'모든 기능',morning:'아침 레터',sim:'시뮬레이터',shorts:'쇼츠',saved:'저장한 영상',talk:'대화',kakeibo:'가계부',memo:'메모',alert:'주가 알림',guide:'시작 가이드',pet:'육성 게임',display:'화면 설정',size:'글자 크기',font:'글꼴',small:'작게',medium:'보통',large:'크게',largest:'아주 크게',gothic:'고딕',round:'둥근 글꼴',mincho:'명조',klee:'손글씨',pop:'스타일 글꼴',reset:'기본으로',style:'설명 방식',beginner:'쉬운 설명',pro:'자세한 설명',account:'마이페이지',language:'언어',logout:'로그아웃'},
    zh: {menu:'菜单',back:'返回',close:'关闭',frequent:'快捷入口',news:'经济新闻',stocks:'今日股票',favorites:'收藏',calendar:'日历',color:'颜色',resetColor:'恢复颜色',original:'全部功能',morning:'早间市场',sim:'模拟器',shorts:'短视频',saved:'已保存视频',talk:'聊天',kakeibo:'家庭账本',memo:'备忘录',alert:'股价提醒',guide:'入门指南',pet:'养成游戏',display:'显示设置',size:'文字大小',font:'字体',small:'小',medium:'中',large:'大',largest:'特大',gothic:'黑体',round:'圆体',mincho:'明朝体',klee:'手写体',pop:'个性字体',reset:'恢复默认',style:'说明方式',beginner:'简单说明',pro:'详细说明',account:'我的主页',language:'语言',logout:'退出登录'}
  };
  var paths = {color:'M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 1.4-3.4 1.6 1.6 0 0 1 1.1-2.7h1a4 4 0 0 0 4-4C21 6.5 17 3 12 3ZM7.5 10h.01M10 6.5h.01M15 7h.01M7 14h.01',display:'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',language:'M3 5h12M9 3v2M6 5c0 5 3 9 7 11M12 5c0 5-3 9-7 11M14 21l4-10 4 10M15.5 17h5',news:'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5',stocks:'M4 19h16M6 15l4-5 4 3 5-8',favorites:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z',calendar:'M5 5h14v15H5zM8 3v4M16 3v4M5 10h14',sim:'M4 20h17M7 16V9M12 16V5M17 16v-4',shorts:'m8 5 11 7-11 7z',saved:'M6 3h12v18l-6-4-6 4z',talk:'M4 4h16v12H9l-5 4z',kakeibo:'M4 6h15v14H4zM4 6V4h12M14 11h7v5h-7z',memo:'M5 3h14v18H5zM8 8h8M8 12h8M8 16h5',alert:'M12 3 3 20h18zM12 9v5M12 17h.01',guide:'M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5M12 17h.01',pet:'M19 4C6 3 3 11 6 16s15 3 13-12ZM5 21l10-11',account:'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0M5 21v-2a7 7 0 0 1 14 0v2',logout:'M9 4H4v16h5M14 8l4 4-4 4M8 12h10',morning:'M12 2v2M12 20v2M2 12h2M20 12h2M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0'};
  function lang() { var value; try { value=localStorage.getItem('app_lang'); } catch (_) {} return copy[value] ? value : 'ja'; }
  var colorCopy = {
    ja:{color:'表示カラー',chooseColor:'好きな色を選ぶ',closeColor:'色の選択を閉じる',colorSpectrum:'色合いの面',colorTone:'濃淡の面',adjustTone:'濃淡も選ぶ',colorKeyboardHint:'矢印キーでも選べます。色合いは左右で色、上下で白っぽさ。濃淡は左右で鮮やかさ、上下で明るさを選びます。',standardColor:'標準の色',colorUnavailable:'色を変更できませんでした。もう一度選んでください。',selectedColor:'選択中の色',presetGreen:'グリーン',presetPink:'ピンク',presetYellow:'イエロー'},
    en:{color:'Display color',chooseColor:'Choose a color',closeColor:'Close color selection',colorSpectrum:'Color plane',colorTone:'Shade plane',adjustTone:'Adjust shade',colorKeyboardHint:'Use arrow keys. Color: left/right changes hue, up/down changes whiteness. Shade: left/right changes saturation, up/down changes brightness.',standardColor:'Default color',colorUnavailable:'The color could not be changed. Please choose again.',selectedColor:'Selected color',presetGreen:'Green',presetPink:'Pink',presetYellow:'Yellow'},
    ko:{color:'표시 색상',chooseColor:'원하는 색 선택',closeColor:'색상 선택 닫기',colorSpectrum:'색상 영역',colorTone:'명암 영역',adjustTone:'명암도 선택',colorKeyboardHint:'방향키로 선택할 수 있습니다. 색상은 좌우로 색, 상하로 흰 정도를, 명암은 좌우로 채도, 상하로 밝기를 선택합니다.',standardColor:'기본 색상',colorUnavailable:'색상을 변경하지 못했습니다. 다시 선택해 주세요.',selectedColor:'선택한 색상',presetGreen:'초록',presetPink:'분홍',presetYellow:'노랑'},
    zh:{color:'显示颜色',chooseColor:'选择喜欢的颜色',closeColor:'关闭颜色选择',colorSpectrum:'颜色区域',colorTone:'明暗区域',adjustTone:'调整明暗',colorKeyboardHint:'也可使用方向键。颜色区域左右选择色相、上下选择白色程度；明暗区域左右选择饱和度、上下选择亮度。',standardColor:'默认颜色',colorUnavailable:'无法更改颜色，请重新选择。',selectedColor:'所选颜色',presetGreen:'绿色',presetPink:'粉色',presetYellow:'黄色'}
  };
  function text(key) { return colorCopy[lang()][key] || copy[lang()][key] || key; }
  function stored(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; } }
  function icon(key) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+paths[key]+'"/></svg>'; }
  function row(key) { var b=document.createElement('button');b.type='button';b.className=(['color','display','language'].indexOf(key)>=0?'':'drawer-item ')+'kn-menu-row';b.dataset.menuPage=key;b.innerHTML=icon(key)+'<span data-menu-copy="'+key+'">'+text(key)+'</span><svg class="kn-menu-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';return b; }
  function group(keys) { var section=document.createElement('div');section.className='kn-menu-group';keys.forEach(function(key){section.appendChild(row(key));});return section; }
  function view(key) {
    var section=document.createElement('section');section.className='kn-menu-view';section.id='knMenuView-'+key;section.hidden=true;
    section.setAttribute('aria-labelledby','knMenuTitle-'+key);
    var heading=document.createElement('h2');heading.id='knMenuTitle-'+key;heading.tabIndex=-1;heading.dataset.menuCopy=key;heading.textContent=text(key);section.appendChild(heading);
    views[key]=section;return section;
  }
  function showView(key,focus) {
    if(!mainPanel||key!=='main'&&!views[key])return;
    if(colorController)colorController.close(false);
    var previous=currentView;currentView=key;mainPanel.hidden=key!=='main';
    Object.keys(views).forEach(function(name){views[name].hidden=name!==key;});
    backButton.hidden=key==='main';drawer.dataset.menuView=key;nav.scrollTop=0;
    if(focus!==false){
      var target=key==='main'?viewTriggers[previous]:views[key].querySelector('h2');
      if(target)target.focus({preventScroll:true});
    }
  }
  function syncOpeners(open) {
    ['knHomeAMenu','knFloatHam','hamburgerBtn'].forEach(function(id){var opener=document.getElementById(id);if(opener){opener.setAttribute('aria-controls','sideDrawer');opener.setAttribute('aria-haspopup','dialog');opener.setAttribute('aria-expanded',String(open));}});
  }
  function bn(act) { var b=document.querySelector('.bn-item[data-act="'+act+'"]');if(b)b.click(); }
  function close() {
    if(window.closeDrawer)window.closeDrawer();
    // Finish this close before a destination takes focus. The later observer
    // sees the same state and must not move focus back from the new screen.
    if(drawer&&!drawer.classList.contains('open')&&syncDrawerState)syncDrawerState();
  }
  function openHome() { bn('morning'); }
  function scrollToNode(node) { if(node)node.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'}); }
  function canLogout() { return !!(window.knUser && !window.knUser.is_anonymous); }
  function syncAccount() {
    if(!drawer)return;
    var group=drawer.querySelector('#knMenuLogoutGroup');
    if(group)group.hidden=!canLogout();
  }
  function navigate(key) {
    if(views[key]){showView(key);return;}
    if(key==='logout'){
      if(canLogout()&&typeof window.knLogoutFlow==='function'){close();window.knLogoutFlow();}
      return;
    }
    close();
    // Route in this event; the closing drawer can finish its own CSS transition.
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
    else if(key==='memo'){
      if(typeof window.knOpenMemo==='function')window.knOpenMemo();
    }
    else if(key==='account'||key==='kakeibo'){
      bn('mypage');
      // The existing opener owns auth and record restoration. Select only an
      // already-open page, without a timer that could outlive another route.
      var ov=document.getElementById('myPageOv');
      if(key==='account'||!ov||!ov.classList.contains('open'))return;
      var tabs=ov.querySelectorAll('.mp-toptab'),tab=tabs[key==='kakeibo'?1:0];if(tab)tab.click();
    }
  }
  function syncPreferences() {
    if(!drawer)return;
    // The drawer follows the home scale; legacy per-node sizing must not compound it.
    drawer.querySelectorAll('[data-bfs]').forEach(function(n){n.style.removeProperty('font-size');});
    drawer.querySelectorAll('[data-menu-size]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.menuSize===stored('ui_fontscale','m')));});
    var font=drawer.querySelector('#knMenuFont');if(font)font.value=stored('ui_font','gothic');
    drawer.querySelectorAll('[data-menu-style]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.menuStyle===stored('ui_style','pro')));});
    drawer.querySelectorAll('.drawer-color-preset').forEach(function(b){b.setAttribute('aria-pressed',String(b.classList.contains('active')&&document.documentElement.hasAttribute('data-custom-brand-color')));});
    if(colorController)colorController.sync();
  }
  function translate() {
    if(!drawer)return;
    drawer.querySelectorAll('[data-menu-copy]').forEach(function(n){n.textContent=text(n.dataset.menuCopy);});
    drawer.setAttribute('aria-label',text('menu'));
    var x=drawer.querySelector('.kn-menu-close');if(x)x.setAttribute('aria-label',text('close'));
    var font=drawer.querySelector('#knMenuFont');if(font)font.setAttribute('aria-label',text('font'));
    drawer.querySelectorAll('[data-menu-preset]').forEach(function(b){b.title=text(b.dataset.menuPreset);b.setAttribute('aria-label',b.title);});
    if(colorController)colorController.translate();
    syncPreferences();
  }
  function rebuild() {
    drawer=document.getElementById('sideDrawer');nav=document.getElementById('drawerNav');
    if(!drawer||!nav)return;
    drawer.classList.add('kn-menu-a');drawer.setAttribute('role','dialog');drawer.setAttribute('aria-modal','true');drawer.dataset.menuView='main';
    var brand=document.getElementById('knHomeADrawerBrand');if(brand)brand.remove();
    var header=document.createElement('div');header.className='kn-menu-header';header.innerHTML='<button type="button" class="kn-menu-back" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg><span data-menu-copy="back">'+text('back')+'</span></button><button type="button" class="kn-menu-close" aria-label="'+text('close')+'"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';drawer.insertBefore(header,drawer.firstChild);header.querySelector('.kn-menu-close').onclick=close;
    backButton=header.querySelector('.kn-menu-back');backButton.onclick=function(){showView('main');};
    nav.replaceChildren();
    var panel=document.createElement('div');panel.className='knAccPanel kn-menu-content';mainPanel=panel;nav.appendChild(panel);
    window.KNMenuSheet={showMain:function(){showView('main',false);}};
    if(window.KNUserProfile&&typeof window.KNUserProfile.mount==='function')window.KNUserProfile.mount(panel);
    panel.appendChild(group(['memo','guide']));
    var colors=drawer.querySelector('.drawer-color-wrap:has(.drawer-color-presets)');
    if(colors){
      Array.from(colors.querySelectorAll('.drawer-color-preset')).forEach(function(b,i){if(i>=3){b.remove();return;}b.type='button';b.dataset.menuPreset=['presetGreen','presetPink','presetYellow'][i];b.setAttribute('aria-label',text(b.dataset.menuPreset));b.style.setProperty('--menu-swatch',b.getAttribute('data-color'));});
      colors.classList.add('kn-menu-palette');colors.setAttribute('aria-labelledby','knMenuColorTitle');
      var colorHeading=document.createElement('p');colorHeading.id='knMenuColorTitle';colorHeading.className='kn-menu-label';colorHeading.dataset.menuCopy='color';colorHeading.textContent=text('color');colors.insertBefore(colorHeading,colors.firstChild);
      var colorReset=colors.querySelector('#drawerColorReset');if(colorReset){colorReset.removeAttribute('data-i18n');colorReset.dataset.menuCopy='resetColor';colorReset.textContent=text('resetColor');}
    }
    var display=view('display');var displayControls=document.createElement('div');displayControls.innerHTML='<p class="kn-menu-label" data-menu-copy="size">'+text('size')+'</p><div class="kn-menu-sizes">'+[['s','small'],['m','medium'],['l','large'],['xl','largest']].map(function(v){return '<button type="button" data-menu-size="'+v[0]+'" data-menu-copy="'+v[1]+'">'+text(v[1])+'</button>';}).join('')+'</div><label class="kn-menu-font"><span data-menu-copy="font">'+text('font')+'</span><select id="knMenuFont" aria-label="'+text('font')+'">'+['gothic','round','mincho','klee','pop'].map(function(key){return '<option value="'+key+'" data-menu-copy="'+key+'">'+text(key)+'</option>';}).join('')+'</select></label>';
    while(displayControls.firstChild)display.appendChild(displayControls.firstChild);
    var motion=document.getElementById('knHomeOrbitMotion');if(motion){motion.classList.add('kn-menu-motion');display.appendChild(motion);}
    var reset=document.createElement('button');reset.type='button';reset.className='kn-menu-reset';reset.dataset.menuReset='1';reset.dataset.menuCopy='reset';reset.textContent=text('reset');display.appendChild(reset);nav.appendChild(display);var displayTrigger=row('display');displayTrigger.setAttribute('aria-controls','knMenuView-display');viewTriggers.display=displayTrigger;panel.appendChild(displayTrigger);
    var logout=group(['logout']);logout.id='knMenuLogoutGroup';logout.hidden=true;panel.appendChild(logout);
    var grid=drawer.querySelector('.lang-grid');if(grid){var language=document.createElement('section');language.className='kn-menu-language';language.setAttribute('aria-labelledby','knMenuLanguageTitle');var languageHeading=document.createElement('p');languageHeading.id='knMenuLanguageTitle';languageHeading.className='kn-menu-label';languageHeading.dataset.menuCopy='language';languageHeading.textContent=text('language');language.appendChild(languageHeading);language.appendChild(grid);panel.appendChild(language);}
    if(colors){
      panel.appendChild(colors);
      var nativeColor=colors.querySelector('#drawerColorInput');if(nativeColor){nativeColor.hidden=true;nativeColor.tabIndex=-1;}
      var legacyColorRow=colors.querySelector('.drawer-color-custom');if(legacyColorRow)legacyColorRow.hidden=true;
      if(window.KNMenuColorPlane&&typeof window.KNMenuColorPlane.mount==='function'){
        colorController=window.KNMenuColorPlane.mount(colors,{readColor:function(){return nativeColor&&nativeColor.value||'#3da060';},commitColor:function(hex){if(typeof window.applyBrandColor!=='function')throw new Error('color_unavailable');window.applyBrandColor(hex,true);syncPreferences();},isCustom:function(){return document.documentElement.hasAttribute('data-custom-brand-color');},isAvailable:function(){return currentView==='main'&&drawer.classList.contains('open')&&!drawer.inert&&!document.hidden;},label:text});
      }else{
        var unavailable=document.createElement('button');unavailable.type='button';unavailable.className='kn-color-plus';unavailable.textContent='＋';unavailable.disabled=true;unavailable.setAttribute('aria-label',text('chooseColor'));colors.querySelector('.drawer-color-presets').appendChild(unavailable);
        var unavailableText=document.createElement('p');unavailableText.className='kn-color-error';unavailableText.dataset.menuCopy='colorUnavailable';unavailableText.textContent=text('colorUnavailable');colors.appendChild(unavailableText);
      }
    }
    drawer.querySelectorAll(':scope > .drawer-section-label,:scope > .drawer-color-wrap,:scope > .drawer-footer').forEach(function(n){n.remove();});
    var oldSettings=document.getElementById('drawerSettingsBtn');if(oldSettings)oldSettings.parentElement.remove();
    nav.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;if(b.dataset.menuPage)navigate(b.dataset.menuPage);if(b.dataset.menuSize&&window.dsSetSize)window.dsSetSize(b.dataset.menuSize);if(b.dataset.menuStyle&&window._setUIStyle)window._setUIStyle(b.dataset.menuStyle);if(b.dataset.menuReset&&window.dsReset)window.dsReset();syncPreferences();});
    display.querySelector('select').addEventListener('change',function(e){if(window.dsSetFont)window.dsSetFont(e.target.value);syncPreferences();});
    drawer.addEventListener('click',function(){syncPreferences();});
    var observer=new MutationObserver(function(){Array.from(nav.children).forEach(function(n){if(n!==panel&&Object.keys(views).every(function(key){return views[key]!==n;}))n.remove();});});observer.observe(nav,{childList:true});
    wasOpen=drawer.classList.contains('open');
    syncDrawerState=function(){var open=drawer.classList.contains('open');if(!open&&colorController)colorController.close(false);drawer.inert=!open;drawer.setAttribute('aria-hidden',String(!open));syncOpeners(open);if(open===wasOpen)return;wasOpen=open;if(open){lastOpener=document.activeElement;showView('main',false);header.querySelector('.kn-menu-close').focus({preventScroll:true});}else if(lastOpener&&lastOpener.isConnected)lastOpener.focus({preventScroll:true});};
    var stateObserver=new MutationObserver(syncDrawerState);stateObserver.observe(drawer,{attributes:true,attributeFilter:['class']});
    drawer.inert=!wasOpen;drawer.setAttribute('aria-hidden',String(drawer.inert));syncOpeners(wasOpen);
    drawer.addEventListener('keydown',function(e){if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){var focusable=Array.from(drawer.querySelectorAll('button,select,input,textarea,summary,a[href],[tabindex]')).filter(function(n){return !n.disabled&&n.tabIndex>=0&&n.getClientRects().length;});var first=focusable[0],last=focusable[focusable.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
    translate();syncAccount();document.addEventListener('knAuthChange',syncAccount);document.addEventListener('langChanged',function(){if(colorController)colorController.close(false);translate();});document.addEventListener('styleChanged',syncPreferences);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(rebuild,950);},{once:true});else setTimeout(rebuild,950);
})();

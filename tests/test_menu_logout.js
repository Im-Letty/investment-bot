'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

// Execute the production drawer and confirmation code against synthetic DOM and auth objects.
function fixture({user=null,language='ja',logoutFlow=true,mypageAllowed=true}={}){
  const calls=[],timers=[],observers=[],storage=new Map([['app_lang',language]]);let document,clock=0;
  const dataKey=key=>key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
  function matches(node,selector){
    if(selector.includes(':has(')){const found=selector.match(/:has\(([^)]+)\)/);if(!found||!node.querySelector(found[1]))return false;selector=selector.replace(found[0],'');}
    const attrs=[...selector.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)];
    if(attrs.some(([,key,value])=>node.getAttribute(key)===null||(value!==undefined&&node.getAttribute(key)!==value)))return false;
    const simple=selector.replace(/\[[^\]]*\]/g,'');
    if([...simple.matchAll(/\.([\w-]+)/g)].some(([,name])=>!node.classList.contains(name)))return false;
    const id=simple.match(/#([\w-]+)/);if(id&&node.id!==id[1])return false;
    const tag=simple.match(/^[a-z][\w-]*/i);return !tag||node.tagName===tag[0].toLowerCase();
  }
  function node(tag){
    const n={tagName:tag.toLowerCase(),parentElement:null,children:[],dataset:{},attrs:{},className:'',hidden:false,style:{removeProperty(){},setProperty(){}},listeners:new Map(),_text:'',_html:'',
      appendChild(child){child.remove();child.parentElement=this;this.children.push(child);return child;},
      insertBefore(child,before){child.remove();child.parentElement=this;const i=this.children.indexOf(before);this.children.splice(i<0?this.children.length:i,0,child);return child;},
      replaceChildren(...children){this.children.forEach(child=>child.parentElement=null);this.children=[];children.forEach(child=>this.appendChild(child));},
      remove(){if(this.parentElement){const list=this.parentElement.children;list.splice(list.indexOf(this),1);this.parentElement=null;}},
      setAttribute(key,value){value=String(value);if(key==='id')this.id=value;else if(key==='class')this.className=value;else if(key==='hidden')this.hidden=true;else if(key.startsWith('data-'))this.dataset[dataKey(key)]=value;else this.attrs[key]=value;},
      getAttribute(key){if(key==='id')return this.id||null;if(key==='class')return this.className||null;if(key.startsWith('data-'))return this.dataset[dataKey(key)]??null;return this.attrs[key]??null;},
      hasAttribute(key){return this.getAttribute(key)!==null;},removeAttribute(key){delete this.attrs[key];},
      querySelectorAll(selector){
        const results=[];const walk=parent=>parent.children.forEach(child=>{results.push(child);walk(child);});walk(this);
        return results.filter(child=>selector.split(',').some(part=>{
          part=part.trim();if(part.startsWith(':scope > '))return child.parentElement===this&&matches(child,part.slice(9));
          const steps=part.split(/\s+/);if(!matches(child,steps.pop()))return false;
          let ancestor=child.parentElement;while(steps.length){const step=steps.pop();while(ancestor&&!matches(ancestor,step))ancestor=ancestor.parentElement;if(!ancestor)return false;ancestor=ancestor.parentElement;}return true;
        }));
      },
      querySelector(selector){return this.querySelectorAll(selector)[0]||null;},
      closest(selector){for(let el=this;el;el=el.parentElement)if(matches(el,selector))return el;return null;},
      addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);},
      fire(type,event={}){const e={type,target:this,preventDefault(){},...event};if(type==='click'&&this.onclick)this.onclick(e);for(let el=this;el;el=el.parentElement)for(const fn of el.listeners.get(type)||[])fn(e);},
      click(){this.fire('click');},scrollIntoView(options){calls.push(['scroll',this.id,options.behavior,options.block]);},focus(){document.activeElement=this;},getClientRects(){for(let el=this;el;el=el.parentElement)if(el.hidden)return [];return [{}];}
    };
    n.classList={contains:name=>n.className.split(/\s+/).includes(name),add(...names){n.className=[...new Set([...n.className.split(/\s+/).filter(Boolean),...names])].join(' ');},remove(name){n.className=n.className.split(/\s+/).filter(n=>n!==name).join(' ');}};
    Object.defineProperties(n,{
      firstChild:{get:()=>n.children[0]||null},isConnected:{get:()=>{let el=n;while(el.parentElement)el=el.parentElement;return el===document?.documentElement;}},
      textContent:{get:()=>n._text+n.children.map(child=>child.textContent).join(''),set:value=>{n._text=String(value);n.replaceChildren();}},
      innerHTML:{get:()=>n._html,set:value=>{
        n._html=String(value);n._text='';n.replaceChildren();const stack=[n];
        for(const token of n._html.match(/<[^>]*>|[^<]+/g)||[]){
          if(token.startsWith('</')){stack.pop();continue;}
          if(token.startsWith('<')){const name=token.match(/^<([\w-]+)/)?.[1];if(!name)continue;const child=node(name);for(const [,key,value='']of token.matchAll(/([\w-]+)(?:="([^"]*)")?/g)){if(key!==name)child.setAttribute(key,value);}stack.at(-1).appendChild(child);if(!token.endsWith('/>')&&!['input','br','hr','img'].includes(name))stack.push(child);}
          else stack.at(-1)._text+=token;
        }
      }}
    });return n;
  }
  const root=node('html'),body=node('body');root.appendChild(body);
  document={readyState:'complete',documentElement:root,body,activeElement:null,listeners:new Map(),createElement:node,getElementById:id=>root.querySelector('#'+id),querySelector:selector=>root.querySelector(selector),querySelectorAll:selector=>root.querySelectorAll(selector),
    addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);},dispatch(type){for(const fn of this.listeners.get(type)||[])fn({type});}};
  function add(tag,attrs={},parent=body){const el=node(tag);Object.entries(attrs).forEach(([key,value])=>el.setAttribute(key,value));parent.appendChild(el);return el;}
  const drawer=add('aside',{id:'sideDrawer',class:'open'}),nav=add('nav',{id:'drawerNav'},drawer);
  const languageGrid=add('div',{class:'lang-grid'},drawer);for(const language of ['ja','en','ko','zh'])add('button',{class:'lang-btn','data-lang':language},languageGrid).textContent=language;
  const colors=add('div',{class:'drawer-color-wrap'},drawer),presets=add('div',{class:'drawer-color-presets'},colors);
  for(const [name,color]of [['グリーン','#3da060'],['ピンク','#e91e63'],['イエロー','#b2923a'],['ブルー','#2196f3']]){const b=add('button',{class:'drawer-color-preset','data-color':color},presets);b.title=name;b.onclick=()=>calls.push(['color',color]);}
  const custom=add('input',{type:'color',id:'drawerColorInput'},colors),colorReset=add('button',{id:'drawerColorReset'},colors);colorReset.onclick=()=>calls.push(['color-reset']);
  const motion=add('button',{id:'knHomeOrbitMotion'},drawer);motion.onclick=()=>calls.push(['motion']);
  for(const id of ['knHomeAMenu','knFloatHam','hamburgerBtn'])add('button',{id});
  const mounted=[];

  for(const act of ['morning','shorts','talk','pet','mypage'])add('button',{class:'bn-item','data-act':act}).onclick=()=>{calls.push(['bottom',act]);if(act==='mypage'&&mypageAllowed)mypage.classList.add('open');};
  add('div',{id:'morning-news-content'});const stock=add('div',{id:'knTabWrap'});add('button',{'data-kn-tab':'div_cal'},stock).onclick=()=>calls.push(['tab','div_cal']);
  const mypage=add('div',{id:'myPageOv'});for(let i=0;i<2;i++)add('button',{class:'mp-toptab'},mypage).onclick=()=>calls.push(['mypage-tab',i]);
  add('button',{class:'mo-tab','data-i18n':'g2_mp_tab_memo'},mypage).onclick=()=>calls.push(['memo-tab']);
  const w={knUser:user,KNUserProfile:{mount(panel){const section=add('details',{id:'knProfile'},panel);add('summary',{},section).textContent='プロフィール';mounted.push(panel);return section;}},dsSetSize:value=>{storage.set('ui_fontscale',value);calls.push(['size',value]);},dsSetFont:value=>{storage.set('ui_font',value);calls.push(['font',value]);},dsReset:()=>calls.push(['reset']),closeDrawer:()=>{calls.push(['close']);drawer.classList.remove('open');},__knSetSub:value=>calls.push(['stock-view',value]),matchMedia:()=>({matches:false})};
  for(const [key,name]of Object.entries({openSimulatorSection:'sim',openSaved:'saved',openAlertSection:'alert',openBeginnerGuide:'guide'}))w[key]=()=>calls.push(['open',name]);
  if(logoutFlow)w.knLogoutFlow=()=>calls.push(['logout-flow']);
  const context={window:w,document,localStorage:{getItem:key=>storage.get(key)||null},setTimeout:(fn,delay=0)=>{timers.push({fn,at:clock+delay,delay});return timers.length;},MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(target,options){this.target=target;this.options=options;}},console};
  vm.runInNewContext(read('static/menu-a.js'),context);
  function flush(){for(let budget=20;timers.length;){assert.ok(budget-->0,'Unexpected repeated menu scheduling');timers.sort((a,b)=>a.at-b.at);const next=timers.shift();clock=Math.max(clock,next.at);next.fn();}}
  function advance(ms){const end=clock+ms;for(let budget=20;;){timers.sort((a,b)=>a.at-b.at);if(!timers.length||timers[0].at>end)break;assert.ok(budget-->0,'Unexpected repeated menu scheduling');const next=timers.shift();clock=next.at;next.fn();}clock=end;}
  function route(key){const b=node('button');b.dataset.menuPage=key;nav.appendChild(b);b.click();b.remove();}
  flush();
  return {w,document,drawer,nav,calls,storage,flush,advance,route,now:()=>clock,pendingTimers:()=>timers.map(t=>t.delay),setMypageAllowed(value){mypageAllowed=value;},node,mounted,colors,languageGrid,motion,custom,colorReset,notifyDrawerState(){observers.find(o=>o.target===drawer).fn();},notifyNav(){observers.find(o=>o.target===nav).fn();},group:()=>document.getElementById('knMenuLogoutGroup'),button:key=>nav.querySelector('[data-menu-page="'+key+'"]'),activate(key,{nested=false}={}){const b=nav.querySelector('[data-menu-page="'+key+'"]');assert.ok(b,key+' menu row exists');(nested?b.querySelector('span'):b).click();flush();},
    navigate(key){route(key);flush();},
    useConfirmation(){
      const html=read('index.html'),marker='(function(){window.knLogoutFlow=function(){',start=html.indexOf(marker);assert.ok(start>=0,'Existing confirmation IIFE exists');const end=html.indexOf('})();',start);assert.ok(end>start);
      let signouts=0,reloads=0;w.sb={auth:{signOut(){signouts++;return Promise.resolve();}}};context.location={reload(){reloads++;}};
      vm.runInNewContext(html.slice(start,end+5),context);
      return {signouts:()=>signouts,reloads:()=>reloads,dialog:()=>document.getElementById('knLogoutDlg')};
    }
  };
}

test('logout exists once at the end of the hamburger menu and the old personal-page injector is absent',()=>{
  const h=fixture({user:{id:'synthetic-member',is_anonymous:false}}),group=h.group();
  assert.ok(group);assert.equal(group.parentElement.className,'knAccPanel kn-menu-content');assert.equal(group.parentElement.children.at(-1),group);
  assert.equal(h.nav.querySelectorAll('[data-menu-page="logout"]').length,1);assert.equal(h.button('logout').textContent,'ログアウト');assert.equal(group.hidden,false);
  const html=read('index.html');assert.doesNotMatch(html,/ensureLogout|knLogoutBtn/);assert.match(html,/menu-a\.js\?v=20261024-fast-nav1/);
});
test('signed-out and guest users cannot invoke logout even through a programmatic menu click',()=>{
  for(const user of [null,undefined,{id:'synthetic-guest',is_anonymous:true}]){
    const h=fixture({user});assert.equal(h.group().hidden,true);h.activate('logout',{nested:true});assert.deepEqual(h.calls,[]);
  }
});
test('a member activation closes the drawer then invokes the existing flow exactly once',()=>{
  const h=fixture({user:{id:'synthetic-member',is_anonymous:false}});h.activate('logout',{nested:true});assert.deepEqual(h.calls,[['close'],['logout-flow']]);
});
test('logout safely does nothing when the existing flow is unavailable',()=>{
  const h=fixture({user:{id:'synthetic-member'},logoutFlow:false});assert.doesNotThrow(()=>h.activate('logout'));assert.deepEqual(h.calls,[]);
});
test('authentication changes update the one menu group and stale visible rows remain guarded',()=>{
  const h=fixture();const group=h.group();assert.equal(group.hidden,true);
  h.w.knUser={id:'synthetic-member',is_anonymous:false};h.document.dispatch('knAuthChange');assert.equal(group.hidden,false);
  h.w.knUser={id:'synthetic-guest',is_anonymous:true};h.activate('logout');assert.deepEqual(h.calls,[],'Guard checks current identity before an auth event redraw');
  h.document.dispatch('knAuthChange');assert.equal(group.hidden,true);
  h.w.knUser={id:'synthetic-member-2'};h.document.dispatch('knAuthChange');assert.equal(group.hidden,false);
  h.w.knUser=null;h.document.dispatch('knAuthChange');assert.equal(group.hidden,true);assert.equal(h.group(),group);
});
test('logout follows the existing language selection and language-change event',()=>{
  for(const [language,label]of [['ja','ログアウト'],['en','Log out'],['ko','로그아웃'],['zh','退出登录']]){
    const h=fixture({language,user:{id:'synthetic-member'}});assert.equal(h.button('logout').textContent,label);
    h.storage.set('app_lang','en');h.document.dispatch('langChanged');assert.equal(h.button('logout').textContent,'Log out');assert.equal(h.group().hidden,false);
  }
});
test('the existing confirmation can cancel without signing out or reloading',()=>{
  const user={id:'synthetic-member',is_anonymous:false},h=fixture({user}),flow=h.useConfirmation();h.activate('logout');h.activate('logout');
  assert.equal(h.document.querySelectorAll('#knLogoutDlg').length,1);assert.equal(flow.signouts(),0);assert.equal(flow.reloads(),0);assert.equal(h.w.knUser,user);
  const buttons=flow.dialog().querySelectorAll('button');assert.equal(buttons[0].textContent,'キャンセル');buttons[0].click();
  assert.equal(flow.dialog(),null);assert.equal(flow.signouts(),0);assert.equal(flow.reloads(),0);assert.equal(h.w.knUser,user);
});
test('only confirmation invokes the synthetic signOut and then reloads',async()=>{
  const h=fixture({user:{id:'synthetic-member',is_anonymous:false}}),flow=h.useConfirmation();h.activate('logout');
  assert.equal(flow.signouts(),0);assert.equal(flow.reloads(),0);const ok=flow.dialog().querySelectorAll('button')[1];assert.equal(ok.textContent,'ログアウト');ok.click();
  assert.equal(flow.dialog(),null);assert.equal(h.w.knUser,null);assert.equal(flow.signouts(),1);assert.equal(flow.reloads(),0);
  await Promise.resolve();assert.equal(flow.reloads(),1);
});

const destinations={
  news:[['bottom','morning'],['scroll','morning-news-content','smooth','start']],
  stocks:[['bottom','morning'],['stock-view','movers'],['scroll','knTabWrap','smooth','start']],
  favorites:[['bottom','morning'],['stock-view','watch'],['scroll','knTabWrap','smooth','start']],
  calendar:[['bottom','morning'],['tab','div_cal'],['scroll','knTabWrap','smooth','start']],
  morning:[['bottom','morning']],shorts:[['bottom','shorts']],talk:[['bottom','talk']],pet:[['bottom','pet']],
  sim:[['open','sim']],saved:[['open','saved']],alert:[['open','alert']],guide:[['open','guide']],account:[['bottom','mypage']],
  kakeibo:[['bottom','mypage'],['mypage-tab',1]],memo:[['bottom','mypage'],['mypage-tab',0],['memo-tab']]
};
for(const [key,expected]of Object.entries(destinations))test('existing '+key+' navigation retains its destination and arguments',()=>{
  const h=fixture({user:{id:'synthetic-member'}});h.navigate(key);assert.deepEqual(h.calls,[['close'],...expected]);
});

test('every route runs in the activation event after closing the drawer, without animation timers',()=>{
  for(const [key,expected]of Object.entries(destinations)){
    const h=fixture({user:{id:'synthetic-member'}}),at=h.now();h.route(key);
    assert.deepEqual(h.calls,[['close'],...expected],key+' must respond before advancing the clock');
    assert.equal(h.now(),at);assert.deepEqual(h.pendingTimers(),[],key+' must not leave a deferred navigation');
    h.advance(1000);assert.deepEqual(h.calls,[['close'],...expected],key+' must not replay a route after animation');
  }
});
test('household and memo select their prepared panel immediately while storage restoration stays on its own path',()=>{
  for(const key of ['kakeibo','memo']){
    const h=fixture({user:{id:'synthetic-member'}}),settings=[...h.storage];
    Object.defineProperty(h.w,'__knGateReady',{get(){throw new Error('The existing personal-page route owns protected restoration');}});
    h.route(key);
    assert.deepEqual(h.calls,[['close'],...destinations[key]]);assert.equal(h.document.getElementById('myPageOv').classList.contains('open'),true);
    assert.deepEqual([...h.storage],settings,'Navigation only selects the existing panel and never writes records');
    assert.deepEqual(h.pendingTimers(),[]);
  }
});
test('a rejected personal-page opener never selects hidden panels or applies an intent after later authentication',()=>{
  for(const key of ['kakeibo','memo']){
    const h=fixture({mypageAllowed:false});h.route(key);
    assert.deepEqual(h.calls,[['close'],['bottom','mypage']]);assert.equal(h.document.getElementById('myPageOv').classList.contains('open'),false);
    h.setMypageAllowed(true);h.advance(1000);assert.deepEqual(h.calls,[['close'],['bottom','mypage']]);
    assert.deepEqual(h.pendingTimers(),[],'No delayed protected panel selection may survive denied auth');
  }
});
test('switching routes after household selection cannot be pulled back by a delayed memo or ledger callback',()=>{
  for(const key of ['kakeibo','memo']){
    const h=fixture({user:{id:'synthetic-member'}});h.route(key);h.route('morning');const calls=h.calls.slice();
    assert.deepEqual(calls,[['close'],...destinations[key],['close'],...destinations.morning]);
    h.advance(2000);assert.deepEqual(h.calls,calls);assert.deepEqual(h.pendingTimers(),[]);
  }
});
test('synchronous close finishes focus restoration before routing and its late observer cannot steal destination focus',()=>{
  const h=fixture(),opener=h.document.getElementById('knHomeAMenu'),destination=h.node('h2');h.document.body.appendChild(destination);
  h.drawer.classList.remove('open');h.notifyDrawerState();opener.focus();h.drawer.classList.add('open');h.notifyDrawerState();
  h.w.openBeginnerGuide=()=>{h.calls.push(['open','guide']);destination.focus();};
  h.route('guide');assert.equal(h.drawer.inert,true);assert.equal(h.drawer.getAttribute('aria-hidden'),'true');
  assert.equal(opener.getAttribute('aria-expanded'),'false');assert.equal(h.document.activeElement,destination);
  h.notifyDrawerState();h.advance(1000);assert.equal(h.document.activeElement,destination);
  assert.deepEqual(h.calls,[['close'],['open','guide']]);
});
test('an explicit close without navigation still restores the existing opener once',()=>{
  const h=fixture(),opener=h.document.getElementById('knFloatHam');
  h.drawer.classList.remove('open');h.notifyDrawerState();opener.focus();h.drawer.classList.add('open');h.notifyDrawerState();
  h.drawer.querySelector('.kn-menu-close').click();assert.equal(h.document.activeElement,opener);assert.equal(h.drawer.inert,true);
  const elsewhere=h.node('button');h.document.body.appendChild(elsewhere);elsewhere.focus();h.notifyDrawerState();
  assert.equal(h.document.activeElement,elsewhere,'a duplicate close notification cannot steal later focus');
  assert.deepEqual(h.calls,[['close']]);
});

test('compact menu has only the selected primary rows and hides preference panels until requested',()=>{
  const h=fixture({user:{id:'synthetic-member'}}),panel=h.mounted[0];
  assert.equal(panel.className,'knAccPanel kn-menu-content');assert.equal(h.document.getElementById('knProfile').parentElement,panel);
  assert.deepEqual(panel.querySelectorAll('[data-menu-page]').map(n=>n.dataset.menuPage),['guide','color','display','language','logout']);
  for(const key of ['color','display','language'])assert.equal(h.document.getElementById('knMenuView-'+key).hidden,true);
  assert.equal(h.drawer.getAttribute('role'),'dialog');assert.equal(h.drawer.getAttribute('aria-modal'),'true');
  for(const key of ['account','kakeibo','memo','saved','alert'])assert.equal(h.button(key),null);
  assert.equal(h.drawer.querySelector('[data-menu-style]'),null);
});
test('each preference page opens in place and Back restores the selected row focus',()=>{
  const h=fixture();
  for(const key of ['color','display','language']){
    h.activate(key,{nested:true});const page=h.document.getElementById('knMenuView-'+key);
    assert.equal(h.mounted[0].hidden,true);assert.equal(page.hidden,false);assert.equal(h.drawer.dataset.menuView,key);assert.equal(h.document.activeElement,page.querySelector('h2'));
    assert.deepEqual(h.calls,[],'Opening a preference is not a route or account action');
    assert.equal(h.button(key).classList.contains('drawer-item'),false,'Preferences must not trigger the existing simulator navigation closer');
    h.drawer.querySelector('.kn-menu-back').click();assert.equal(page.hidden,true);assert.equal(h.mounted[0].hidden,false);assert.equal(h.document.activeElement,h.button(key));
  }
});
test('color, language and motion controls retain their original nodes and handlers',()=>{
  const h=fixture();h.activate('color');
  assert.equal(h.colors.parentElement,h.document.getElementById('knMenuView-color'));assert.equal(h.custom,h.document.getElementById('drawerColorInput'));
  h.colors.querySelector('.drawer-color-preset').click();h.colorReset.click();assert.deepEqual(h.calls,[['color','#3da060'],['color-reset']]);
  assert.equal(h.colors.querySelectorAll('.drawer-color-preset').length,4);assert.equal(h.colors.querySelector('.drawer-color-preset').getAttribute('aria-label'),'グリーン');
  h.drawer.querySelector('.kn-menu-back').click();h.activate('language');assert.equal(h.languageGrid.parentElement,h.document.getElementById('knMenuView-language'));assert.equal(h.languageGrid.children.length,4);
  h.drawer.querySelector('.kn-menu-back').click();h.activate('display');assert.equal(h.motion.parentElement,h.document.getElementById('knMenuView-display'));h.motion.click();assert.deepEqual(h.calls.at(-1),['motion']);
});
test('display settings keep the existing setters and synchronize saved selections',()=>{
  const h=fixture();h.activate('display');const xl=h.drawer.querySelector('[data-menu-size="xl"]');xl.click();assert.deepEqual(h.calls,[['size','xl']]);assert.equal(xl.getAttribute('aria-pressed'),'true');
  const font=h.document.getElementById('knMenuFont');font.value='round';font.fire('change');assert.deepEqual(h.calls.at(-1),['font','round']);assert.equal(font.value,'round');
  h.drawer.querySelector('[data-menu-reset]').click();assert.deepEqual(h.calls.at(-1),['reset']);
});
test('all language changes update sheet title, back label and preference headings',()=>{
  const h=fixture();h.activate('language');h.storage.set('app_lang','en');h.document.dispatch('langChanged');
  assert.equal(h.drawer.getAttribute('aria-label'),'Menu');assert.equal(h.drawer.querySelector('.kn-menu-back span').textContent,'Back');
  assert.equal(h.document.getElementById('knMenuTitle-language').textContent,'Language');assert.equal(h.drawer.dataset.menuView,'language');
});
test('only open state transitions move focus, and both visible menu openers stay synchronized',()=>{
  const h=fixture(),opener=h.document.getElementById('knFloatHam');
  h.drawer.classList.remove('open');h.notifyDrawerState();opener.focus();h.drawer.classList.add('open');h.notifyDrawerState();
  assert.equal(h.document.activeElement,h.drawer.querySelector('.kn-menu-close'));
  for(const id of ['knHomeAMenu','knFloatHam','hamburgerBtn'])assert.equal(h.document.getElementById(id).getAttribute('aria-expanded'),'true');
  h.activate('display');const focused=h.document.activeElement;h.drawer.classList.add('another-class');h.notifyDrawerState();assert.equal(h.document.activeElement,focused);assert.equal(h.drawer.dataset.menuView,'display');
  h.drawer.classList.remove('open');h.notifyDrawerState();assert.equal(h.document.activeElement,opener);assert.equal(h.drawer.inert,true);assert.equal(opener.getAttribute('aria-expanded'),'false');
  h.drawer.classList.add('open');h.notifyDrawerState();assert.equal(h.drawer.dataset.menuView,'main');assert.equal(h.mounted[0].hidden,false);
});
test('focus trap uses only visible controls and Escape or the close button keep the existing closer',()=>{
  const h=fixture();h.activate('language');const back=h.drawer.querySelector('.kn-menu-back'),last=h.languageGrid.children.at(-1);
  last.focus();let blocked=0;last.fire('keydown',{key:'Tab',preventDefault(){blocked++;}});assert.equal(h.document.activeElement,back);assert.equal(blocked,1);
  back.fire('keydown',{key:'Tab',shiftKey:true,preventDefault(){blocked++;}});assert.equal(h.document.activeElement,last);assert.equal(blocked,2);
  last.fire('keydown',{key:'Escape'});h.drawer.querySelector('.kn-menu-close').click();assert.deepEqual(h.calls,[['close'],['close']]);
});
test('external profile hook reveals the existing profile panel without writing or losing its node',()=>{
  const h=fixture();const profile=h.document.getElementById('knProfile');h.activate('color');h.w.KNMenuSheet.showMain();
  assert.equal(h.mounted[0].hidden,false);assert.equal(h.drawer.dataset.menuView,'main');assert.equal(h.document.getElementById('knProfile'),profile);assert.deepEqual(h.calls,[]);
});
test('legacy nav cleanup preserves each preference page and removes only injected siblings',()=>{
  const h=fixture();const obsolete=h.node('button');h.nav.appendChild(obsolete);h.notifyNav();assert.equal(obsolete.parentElement,null);
  for(const key of ['color','display','language'])assert.equal(h.document.getElementById('knMenuView-'+key).parentElement,h.nav);
});

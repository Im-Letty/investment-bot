'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

// Execute the production drawer and confirmation code against synthetic DOM and auth objects.
function fixture({user=null,language='ja',logoutFlow=true}={}){
  const calls=[],timers=[],storage=new Map([['app_lang',language]]);let document;
  const dataKey=key=>key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
  function matches(node,selector){
    if(selector.includes(':has('))return false;
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
      setAttribute(key,value){value=String(value);if(key==='id')this.id=value;else if(key==='class')this.className=value;else if(key.startsWith('data-'))this.dataset[dataKey(key)]=value;else this.attrs[key]=value;},
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
      click(){this.fire('click');},scrollIntoView(options){calls.push(['scroll',this.id,options.behavior,options.block]);},focus(){document.activeElement=this;},getClientRects(){return this.hidden?[]:[{}];}
    };
    n.classList={contains:name=>n.className.split(/\s+/).includes(name),add(...names){n.className=[...new Set([...n.className.split(/\s+/).filter(Boolean),...names])].join(' ');}};
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
  const languageGrid=add('div',{class:'lang-grid'},drawer);add('button',{},languageGrid).textContent='日本語';
  for(const act of ['morning','shorts','talk','pet','mypage'])add('button',{class:'bn-item','data-act':act}).onclick=()=>calls.push(['bottom',act]);
  add('div',{id:'morning-news-content'});const stock=add('div',{id:'knTabWrap'});add('button',{'data-kn-tab':'div_cal'},stock).onclick=()=>calls.push(['tab','div_cal']);
  const mypage=add('div',{id:'myPageOv'});for(let i=0;i<2;i++)add('button',{class:'mp-toptab'},mypage).onclick=()=>calls.push(['mypage-tab',i]);
  add('button',{class:'mo-tab','data-i18n':'g2_mp_tab_memo'},mypage).onclick=()=>calls.push(['memo-tab']);
  const w={knUser:user,closeDrawer:()=>calls.push(['close']),__knSetSub:value=>calls.push(['stock-view',value]),matchMedia:()=>({matches:false})};
  for(const [key,name]of Object.entries({openSimulatorSection:'sim',openSaved:'saved',openAlertSection:'alert',openBeginnerGuide:'guide'}))w[key]=()=>calls.push(['open',name]);
  if(logoutFlow)w.knLogoutFlow=()=>calls.push(['logout-flow']);
  const context={window:w,document,localStorage:{getItem:key=>storage.get(key)||null},setTimeout:fn=>{timers.push(fn);return timers.length;},MutationObserver:class{observe(){}},console};
  vm.runInNewContext(read('static/menu-a.js'),context);
  function flush(){for(let budget=20;timers.length;){assert.ok(budget-->0,'Unexpected repeated menu scheduling');timers.shift()();}}
  flush();
  return {w,document,drawer,nav,calls,storage,flush,node,group:()=>document.getElementById('knMenuLogoutGroup'),button:key=>nav.querySelector('[data-menu-page="'+key+'"]'),activate(key,{nested=false}={}){const b=nav.querySelector('[data-menu-page="'+key+'"]');assert.ok(b,key+' menu row exists');(nested?b.querySelector('span'):b).click();flush();},
    navigate(key){const b=node('button');b.dataset.menuPage=key;nav.appendChild(b);b.click();b.remove();flush();},
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
  const html=read('index.html');assert.doesNotMatch(html,/ensureLogout|knLogoutBtn/);assert.match(html,/menu-a\.js\?v=20261022-saved-in-shorts1/);
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

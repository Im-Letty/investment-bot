'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

// Deliberately never deliver mutation records or timers: preparation must happen
// in the navigation click, before the globally throttled observer can run.
function harness({stock=true,community=true,last}={}){
  const timers=[],intervals=new Map(),observers=[],requests=[],windowEvents=new Map(),documentEvents=new Map(),storage=new Map();let nextTimer=0,closeSaved=0;
  function matches(element,selector){
    const tag=selector.match(/^[a-z][\w-]*/i)?.[0];
    if(tag&&element.tagName!==tag.toUpperCase())return false;
    for(const [,id] of selector.matchAll(/#([\w-]+)/g))if(element.id!==id)return false;
    for(const [,name] of selector.matchAll(/\.([\w-]+)/g))if(!element.classList.contains(name))return false;
    for(const [,name,,value] of selector.matchAll(/\[([\w-]+)(?:=(['"]?)([^\]'"]+)\2)?\]/g)){
      if(value!==undefined?element.getAttribute(name)!==value:element.getAttribute(name)===null)return false;
    }
    return true;
  }
  function selected(element,selector){
    const parts=selector.trim().replace(/\s*>\s*/g,' > ').split(/\s+/);
    let cursor=element,index=parts.length-1;
    if(!matches(cursor,parts[index--]))return false;
    while(index>=0){
      if(parts[index]==='>'){cursor=cursor.parentNode;index--;if(!cursor||!matches(cursor,parts[index--]))return false;}
      else{cursor=cursor.parentNode;while(cursor&&!matches(cursor,parts[index]))cursor=cursor.parentNode;if(!cursor)return false;index--;}
    }
    return true;
  }
  class Element{
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attrs={};this.dataset={};this.listeners=new Map();this.style={setProperty(name,value){this[name]=value;}};this._text='';this._classes=new Set();this.value='';this.hidden=false;this.disabled=false;this.scrollTop=0;this.selectionStart=0;this.selectionEnd=0;
      this.classList={add:(...names)=>names.forEach(name=>this._classes.add(name)),remove:(...names)=>names.forEach(name=>this._classes.delete(name)),contains:name=>this._classes.has(name),toggle:(name,on)=>{const next=on===undefined?!this._classes.has(name):on;if(next)this._classes.add(name);else this._classes.delete(name);return next;}};
    }
    get id(){return this.attrs.id||'';}set id(value){this.attrs.id=value;}
    get className(){return [...this._classes].join(' ');}set className(value){this._classes=new Set(value.split(/\s+/).filter(Boolean));}
    get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}set textContent(value){this._text=String(value);this.children.forEach(child=>child.parentNode=null);this.children=[];}
    get innerHTML(){return this._html||'';}set innerHTML(value){throw Error('direct Talk entry must not build a legacy HTML hub');}
    get firstElementChild(){return this.children[0]||null;}get lastElementChild(){return this.children.at(-1)||null;}get firstChild(){return this.firstElementChild;}
    get nextSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)+1]||null;}
    appendChild(child){if(child.parentNode)child.parentNode.removeChild(child);this.children.push(child);child.parentNode=this;return child;}
    removeChild(child){this.children.splice(this.children.indexOf(child),1);child.parentNode=null;return child;}
    remove(){this.parentNode?.removeChild(this);}
    replaceChildren(...children){this.textContent='';children.forEach(child=>this.appendChild(child));}
    contains(node){return this===node||this.children.some(child=>child.contains(node));}
    get isConnected(){return this===body||!!this.parentNode?.isConnected;}
    insertBefore(child,before){if(child.parentNode)child.parentNode.removeChild(child);this.children.splice(this.children.indexOf(before),0,child);child.parentNode=this;return child;}
    setAttribute(name,value){if(name==='class')this.className=String(value);else this.attrs[name]=String(value);}
    getAttribute(name){if(name==='class')return this.className;if(name.startsWith('data-')){const key=name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());if(key in this.dataset)return String(this.dataset[key]);}return this.attrs[name]??null;}
    querySelectorAll(selector){const alternatives=selector.split(',');const result=[];function visit(node){for(const child of node.children){if(alternatives.some(sel=>selected(child,sel)))result.push(child);visit(child);}}visit(this);return result;}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    closest(selector){for(let node=this;node;node=node.parentNode)if(selected(node,selector))return node;return null;}
    addEventListener(name,fn,capture=false){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push({fn,capture:!!capture});}
    removeEventListener(name,fn){this.listeners.set(name,(this.listeners.get(name)||[]).filter(listener=>listener.fn!==fn));}
    dispatch(name,data={}){const event={target:this,preventDefault(){},stopPropagation(){},...data};for(const listener of documentEvents.get(name)||[])if(listener.capture)listener.fn(event);if(name==='click'&&this.onclick)this.onclick(event);for(const listener of this.listeners.get(name)||[])listener.fn.call(this,event);for(const listener of documentEvents.get(name)||[])if(!listener.capture)listener.fn(event);}
    click(){if(!this.disabled)this.dispatch('click');}
    focus(){document.activeElement=this;}setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
    getBoundingClientRect(){return {height:this.id==='knBottomNav'?58:0};}
    scrollIntoView(){}
  }
  const body=new Element('body');body.classList.add('kn-home-a');
  const document={body,documentElement:new Element('html'),activeElement:null,hidden:false,readyState:'complete',createElement:tag=>new Element(tag),getElementById:id=>body.querySelector('#'+id),querySelector:selector=>body.querySelector(selector),querySelectorAll:selector=>body.querySelectorAll(selector),addEventListener(name,fn,capture=false){documentEvents.set(name,[...(documentEvents.get(name)||[]),{fn,capture:!!capture}]);},removeEventListener(name,fn){documentEvents.set(name,(documentEvents.get(name)||[]).filter(listener=>listener.fn!==fn));}};document.documentElement.lang='ja';
  const morning=new Element('section');morning.id='morning-section';morning.scrollTop=347;body.appendChild(morning);
  const entrance=new Element('button');entrance.id='knHomeATalk';body.appendChild(entrance);
  const nav=new Element('nav');nav.id='knBottomNav';body.appendChild(nav);
  const talkButton=new Element('button');talkButton.className='bn-item';talkButton.setAttribute('data-act','talk');nav.appendChild(talkButton);
  const morningButton=new Element('button');morningButton.className='bn-item';morningButton.setAttribute('data-act','morning');nav.appendChild(morningButton);
  const label=new Element('span');label.className='bn-label';talkButton.appendChild(label);
  const context={document,console,WeakSet,Array,AbortController,knTalkLastView:last,closeSaved(){closeSaved++;},MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}},ResizeObserver:class{observe(){}},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value))},setTimeout(fn,ms){timers.push({fn,ms});return ++nextTimer;},clearTimeout(){},setInterval(fn,ms){const id=++nextTimer;intervals.set(id,{fn,ms});return id;},clearInterval(id){intervals.delete(id);},getComputedStyle(element){return {display:element.style.display||'block'};},fetch(url,options){requests.push({url,options});return new Promise(()=>{});},scrollTo(){},addEventListener:(name,fn)=>windowEvents.set(name,fn)};
  context.window=context;
  const html=read('index.html');
  const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
  const route=scripts.find(script=>script.includes('/* KN_TALK_TABS:'));assert.ok(route);vm.runInNewContext(route,context,{filename:'index.html: direct Talk router'});
  vm.runInNewContext(read('static/community.js'),context,{filename:'static/community.js'});
  if(!community)context.openCommunity=undefined;
  if(stock)vm.runInNewContext(read('static/stock-talk.js'),context,{filename:'static/stock-talk.js'});
  const navigation=scripts.find(script=>script.includes('KN_TALK_NAV:'));assert.ok(navigation,'execute the actual legacy bottom-navigation bubble handler');vm.runInNewContext(navigation,context,{filename:'index.html: bottom navigation'});
  const upper=read('static/home-a.js').split('\n').find(line=>line.includes("document.getElementById('knHomeATalk').onclick="));assert.ok(upper,'execute the actual upper entrance handler');vm.runInNewContext(upper,context,{filename:'static/home-a.js: Talk entrance'});
  vm.runInNewContext(read('static/talk-theme.js'),context,{filename:'static/talk-theme.js'});
  return {context,document,body,nav,talkButton,morningButton,entrance,morning,timers,intervals,observers,requests,storage,Element,html,closeSaved:()=>closeSaved,settle:()=>new Promise(resolve=>setImmediate(resolve))};
}
function ready(h,id='cmOv',navigationTabs=2){
  const screen=h.document.getElementById(id);assert.ok(screen,'new conversation is synchronous before any observer or timer');assert.equal(h.body.querySelectorAll('.cw-screen').length,1);assert.equal(screen.classList.contains('cw-screen'),true);
  assert.equal(screen.querySelectorAll('.cw-view-tab').length,navigationTabs);assert.equal(h.document.getElementById('knMyTalkHub'),null);assert.equal(h.document.getElementById('talkHubOv'),null);
  assert.ok(h.body.classList.contains('kn-talk-active'));
  assert.equal(h.document.documentElement.style['--kn-talk-nav-height'],'58px');
  return screen;
}

test('the real upper Talk click opens the general feed with a plus composer control before observers or timers',async()=>{
  const h=harness();assert.equal(h.document.getElementById('knMyTalkHub'),null);
  h.entrance.click();const screen=ready(h);assert.equal(screen.querySelector('.cw-title').textContent,'みんなのトーク');assert.equal(screen.querySelector('.cw-composer').hidden,true);assert.equal(screen.querySelectorAll('.cw-compose-add').length,1);assert.equal(screen.querySelectorAll('.cw-categories').length,0);assert.equal(screen.querySelector('.cw-intro').textContent,'');assert.equal(h.document.activeElement,null,'initial entry leaves the keyboard closed');assert.equal(screen.querySelector('.cw-stock-talk-link'),null);await h.settle();assert.equal(h.requests.length,1);assert.ok(h.requests.every(request=>!request.options.method||request.options.method==='GET'),'opening never sends a comment');assert.equal(h.closeSaved(),1);
});
test('repeated upper and real legacy bottom clicks preserve the active root, composer and single loading request',async()=>{
  const h=harness();h.entrance.click();const root=ready(h),input=root.querySelector('#cmInput');input.value='保存前の架空下書き';input.dispatch('input');await h.settle();
  for(let index=0;index<4;index++){h.talkButton.click();h.entrance.click();}assert.equal(ready(h),root);assert.equal(root.querySelector('#cmInput'),input);assert.equal(input.value,'保存前の架空下書き');await h.settle();assert.equal(h.requests.length,1);assert.equal(h.intervals.size,1);
});
test('global Talk replaces a scoped voice without returning to company detail and preserves each draft',async()=>{
  const h=harness();let returns=0;h.entrance.click();const general=ready(h);general.querySelector('#cmInput').value='一般の下書き';general.querySelector('#cmInput').dispatch('input');
  h.context.KNStockTalk.openRoom({category:'stock:1832',code:'1832',name:'北海電工'},{onReturn(){returns++;}});const voice=ready(h,'stockTalkOv',0);voice.querySelector('#cmInput').value='銘柄の下書き';voice.querySelector('#cmInput').dispatch('input');await h.settle();
  assert.match(h.requests.at(-1).url,/category=stock%3A1832/);assert.equal(voice.querySelector('.cw-room-picker').hidden,true);assert.match(voice.querySelector('.cw-company-context').textContent,/北海電工.*1832/);
  h.entrance.click();assert.equal(returns,0);assert.equal(ready(h).querySelector('#cmInput').value,'一般の下書き');assert.equal(h.intervals.size,1);
  h.context.KNStockTalk.openRoom({category:'stock:1832',code:'1832',name:'北海電工'},{onReturn(){returns++;}});assert.equal(ready(h,'stockTalkOv',0).querySelector('#cmInput').value,'銘柄の下書き');h.morningButton.click();assert.equal(returns,0);assert.equal(h.intervals.size,0);assert.ok(h.requests.every(r=>!r.options.method||r.options.method==='GET'));
});
test('all four index rooms and four existing company rooms remain available through the new conversation instance',()=>{
 const h=harness();assert.deepEqual(Array.from(h.context.KNStockTalk.categories, r=>r[0]),['stock:7203','stock:6758','stock:9984','stock:8306','index:N225','index:SP500','index:DJI','index:IXIC']);
});
test('a single ready module opens directly and no ready module leaves existing screens untouched',async()=>{
  const fallback=harness({stock:false});fallback.entrance.click();ready(fallback,'cmOv');await fallback.settle();assert.equal(fallback.requests.length,1);
  const stockFallback=harness({community:false});stockFallback.entrance.click();assert.equal(stockFallback.body.querySelectorAll('.cw-screen').length,0);await stockFallback.settle();assert.equal(stockFallback.requests.length,0);
  const h=harness({stock:false,community:false}),saved=new h.Element('section');saved.id='syntheticSaved';h.body.appendChild(saved);assert.doesNotThrow(()=>h.entrance.click());assert.equal(h.closeSaved(),0);assert.equal(h.document.getElementById('syntheticSaved'),saved);assert.equal(h.morning.scrollTop,347);assert.equal(h.body.querySelectorAll('.cw-screen').length,0);await h.settle();assert.equal(h.requests.length,0);
});
test('neither removed legacy builder nor delayed theme work can reconstruct a two-card Talk hub',()=>{
  const h=harness();assert.doesNotMatch(h.html,/ov\.id="(?:knMyTalkHub|talkHubOv)"|function setupTalk\(\)/);h.entrance.click();ready(h);for(const observer of h.observers)observer.fn([]);for(const timer of [...h.timers])timer.fn();ready(h);assert.equal(h.body.querySelectorAll('.kt-hub-card').length,0);assert.equal(h.body.querySelectorAll('.thb-card').length,0);
});
test('real navigation away closes the active factory, aborts its read and restores the saved draft on reentry',async()=>{
  const h=harness();h.entrance.click();const root=ready(h),input=root.querySelector('#cmInput');input.value='朝レターへ戻る前の架空下書き';input.dispatch('input');await h.settle();const request=h.requests[0];
  h.morningButton.click();assert.equal(h.body.querySelectorAll('.cw-screen').length,0);assert.equal(h.body.classList.contains('kn-talk-active'),false);assert.equal(h.intervals.size,0);assert.equal(request.options.signal.aborted,true);assert.equal(h.document.getElementById('knMyTalkHub'),null);assert.equal(h.document.getElementById('talkHubOv'),null);
  h.entrance.click();assert.equal(ready(h).querySelector('#cmInput').value,'朝レターへ戻る前の架空下書き');await h.settle();assert.equal(h.requests.length,2);assert.equal(h.intervals.size,1);assert.ok(h.requests.every(call=>!call.options.method||call.options.method==='GET'));
});

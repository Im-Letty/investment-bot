'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

// Deliberately never deliver mutation records or timers: preparation must happen
// in the navigation click, before the globally throttled observer can run.
function harness({stock=true,legacy=true}={}){
  const timers=[],observers=[],requests=[],windowEvents=new Map();
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
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attrs={};this.dataset={};this.listeners=new Map();this.style={setProperty(name,value){this[name]=value;}};this._text='';this._classes=new Set();
      this.classList={add:(...names)=>names.forEach(name=>this._classes.add(name)),remove:(...names)=>names.forEach(name=>this._classes.delete(name)),contains:name=>this._classes.has(name),toggle:(name,on)=>{const next=on===undefined?!this._classes.has(name):on;if(next)this._classes.add(name);else this._classes.delete(name);return next;}};
    }
    get id(){return this.attrs.id||'';}set id(value){this.attrs.id=value;}
    get className(){return [...this._classes].join(' ');}set className(value){this._classes=new Set(value.split(/\s+/).filter(Boolean));}
    get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}set textContent(value){this._text=String(value);this.children.forEach(child=>child.parentNode=null);this.children=[];}
    get innerHTML(){return this._html||'';}set innerHTML(value){this._html=value;this.textContent='';}
    get firstElementChild(){return this.children[0]||null;}get lastElementChild(){return this.children.at(-1)||null;}get firstChild(){return this.firstElementChild;}
    get nextSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)+1]||null;}
    appendChild(child){if(child.parentNode)child.parentNode.removeChild(child);this.children.push(child);child.parentNode=this;return child;}
    removeChild(child){this.children.splice(this.children.indexOf(child),1);child.parentNode=null;return child;}
    insertBefore(child,before){if(child.parentNode)child.parentNode.removeChild(child);this.children.splice(this.children.indexOf(before),0,child);child.parentNode=this;return child;}
    setAttribute(name,value){if(name==='class')this.className=String(value);else this.attrs[name]=String(value);}
    getAttribute(name){return name==='class'?this.className:(this.attrs[name]??null);}
    querySelectorAll(selector){const alternatives=selector.split(',');const result=[];function visit(node){for(const child of node.children){if(alternatives.some(sel=>selected(child,sel)))result.push(child);visit(child);}}visit(this);return result;}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(fn);}
    dispatch(name,data={}){const event={target:this,preventDefault(){},stopPropagation(){},...data};if(name==='click'&&this.onclick)this.onclick(event);for(const fn of this.listeners.get(name)||[])fn.call(this,event);}
    click(){this.dispatch('click');}
    getBoundingClientRect(){return {height:this.id==='knBottomNav'?58:0};}
    scrollIntoView(){}
  }
  const body=new Element('body');body.classList.add('kn-home-a');
  const document={body,documentElement:new Element('html'),readyState:'complete',createElement:tag=>new Element(tag),getElementById:id=>body.querySelector('#'+id),querySelector:selector=>body.querySelector(selector),querySelectorAll:selector=>body.querySelectorAll(selector),addEventListener(){}};
  const nav=new Element('nav');nav.id='knBottomNav';body.appendChild(nav);
  const talkButton=new Element('button');talkButton.className='bn-item';talkButton.setAttribute('data-act','talk');nav.appendChild(talkButton);
  const label=new Element('span');label.className='bn-label';talkButton.appendChild(label);
  const context={document,console,WeakSet,Array,MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}},ResizeObserver:class{observe(){}},localStorage:{getItem(){return null;},setItem(){}},setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},setInterval(fn,ms){timers.push({fn,ms});return timers.length;},clearInterval(){},getComputedStyle(element){let display=element.style.display;if(!display&&['talkOv','talkHubOv','cmOv','teachOv'].includes(element.id))display=element.classList.contains('open')?'flex':'none';return {display:display||'block'};},fetch(url){requests.push(url);return new Promise(()=>{});},scrollTo(){},addEventListener:(name,fn)=>windowEvents.set(name,fn)};
  context.window=context;
  const html=read('index.html');
  const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
  if(stock){context.knCreateConversation=function(w,options){context.stockRooms=options.categories;return {open(){let n=document.getElementById('stockTalkOv');if(!n){n=new Element('section');n.id='stockTalkOv';document.body.appendChild(n);}n.style.display='flex';context.stockOpens=(context.stockOpens||0)+1;},close(){}};};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static/stock-talk.js'),'utf8'),context);}

  if(legacy){const code=scripts.find(script=>script.includes('var nav=document.getElementById("knBottomNav")')&&script.includes('ov.id="knMyTalkHub"'));assert.ok(code,'actual lazy Talk navigation builder is present');vm.runInNewContext(code,context,{filename:'index.html: Talk navigation'});}
  vm.runInNewContext(read('static/talk-theme.js'),context,{filename:'static/talk-theme.js'});
  return {context,document,body,nav,talkButton,timers,observers,requests,Element,html};
}
function ready(h){
  const hub=h.document.getElementById('knMyTalkHub');assert.ok(hub);
  assert.ok(hub.classList.contains('kt-hub'),'hub is prepared before observers run');
  assert.ok(hub.querySelector('.kt-hub-head'));
  assert.equal(hub.querySelectorAll('.kt-hub-body').length,1);
  assert.equal(hub.querySelectorAll('.kt-hub-card').length,2);
  assert.equal(hub.querySelectorAll('.kt-hub-copy').length,2);
  assert.equal(hub.querySelectorAll('.kt-hub-icon').length,2);
  assert.equal(hub.querySelectorAll('.kt-hub-arrow').length,2);
  assert.ok(h.body.classList.contains('kn-talk-active'));
  assert.equal(h.document.documentElement.style['--kn-talk-nav-height'],'58px');
  return hub;
}

test('first Talk click prepares the final layout synchronously without delivering any observer or timer',()=>{
  const h=harness();assert.equal(h.document.getElementById('knMyTalkHub'),null);
  h.talkButton.click();const hub=ready(h);
  assert.equal(hub.querySelector('.kt-hub-title').textContent,'トーク');
  assert.deepEqual(hub.querySelectorAll('.kt-hub-card-title').map(node=>node.textContent),['みんなの銘柄トーク','コミュニティ']);
  assert.equal(h.requests.length,0,'opening the entrance does not fetch or send comments');
});
test('reopening prepares active state immediately and repeated clicks do not duplicate layout or handlers',()=>{
  const h=harness();h.talkButton.click();const hub=ready(h),cards=hub.querySelectorAll('.kt-hub-card'),body=hub.querySelector('.kt-hub-body');
  hub.style.display='none';h.body.classList.remove('kn-talk-active');
  for(let index=0;index<4;index++)h.talkButton.click();
  assert.equal(ready(h),hub);assert.equal(hub.querySelector('.kt-hub-body'),body);
  assert.deepEqual(hub.querySelectorAll('.kt-hub-card'),cards);
  assert.equal(cards[0].listeners.get('keydown').length,1);
  assert.equal(cards[1].listeners.get('keydown').length,1);
});
test('preparation retains both original entrance callbacks and keyboard access',()=>{
  const h=harness();let communityOpened=0;h.context.openCommunity=()=>communityOpened++;
  h.talkButton.click();let hub=ready(h),cards=hub.querySelectorAll('.kt-hub-card');
  cards[0].dispatch('keydown',{key:'Enter'});
  assert.equal(hub.style.display,'none');assert.ok(h.document.getElementById('stockTalkOv').style.display==='flex');
  assert.equal(h.context.stockOpens,1);assert.equal(h.requests.length,0);
  h.talkButton.click();cards[1].dispatch('keydown',{key:' '});
  assert.equal(hub.style.display,'none');assert.equal(communityOpened,1);
  assert.ok(cards.every(card=>card.getAttribute('role')==='button'&&card.tabIndex===0));
});
test('all four index rooms and four existing company rooms remain available through the new conversation instance',()=>{
 const h=harness();assert.deepEqual(Array.from(h.context.stockRooms, r=>r[0]),['stock:7203','stock:6758','stock:9984','stock:8306','index:N225','index:SP500','index:DJI','index:IXIC']);
});
test('the other existing Talk entrance also prepares its open state in the same click',()=>{
  const h=harness({stock:false,legacy:false}),hub=new h.Element('div');hub.id='talkHubOv';h.body.appendChild(hub);
  h.context.buildHub=()=>{};
  const start=h.html.indexOf('function setupTalk(){'),end=h.html.indexOf('if(document.readyState===',start);
  assert.ok(start>=0&&end>start);
  vm.runInNewContext(h.html.slice(start,end)+'setupTalk();',h.context,{filename:'index.html: setupTalk'});
  assert.equal(h.body.classList.contains('kn-talk-active'),false);
  h.talkButton.click();
  assert.ok(hub.classList.contains('open'));assert.ok(h.body.classList.contains('kn-talk-active'));
});

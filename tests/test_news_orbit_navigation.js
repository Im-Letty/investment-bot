'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {create:createStability}=require('../static/view-stability.js');
const source=fs.readFileSync(path.join(__dirname,'../static/news-orbit.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');

// Use the existing stock controller, rather than reproducing its state changes
// in a test double. These three functions contain no regex/template literals.
function existingFunction(name){
  const start=html.indexOf('function '+name+'(');assert.ok(start>=0);
  let braces=0,quote=null,escaped=false;
  for(let i=html.indexOf('{',start);i<html.length;i++){
    const c=html[i];
    if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote=null;continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='{')braces++;
    else if(c==='}'&&--braces===0)return html.slice(start,i+1);
  }
  throw new Error('Unclosed existing function '+name);
}
const controller=['_styleP','_setSub','_showStock'].map(existingFunction).join('\n');

function harness({view='favorites',reduced=false,withStock=true,withFallback=true,pointerEvents=true}={}){
  const frames=[],events=new Map(),log=[],storage=new Map([['kn_rank_conditions','{"metric":"amount","market":"regional","direction":"down"}']]);
  let network=0,auth=0,guideCalls=0,dialogs=0,stockClicks=0,fallbackCalls=0,mediaChanged;
  let doc,w,now=1000;
  function node(tag='div',attrs={},parent=null){
    const listeners=new Map(),classes=new Set((attrs.class||'').split(' ').filter(Boolean));
    const n={tagName:tag.toUpperCase(),attrs:{...attrs},dataset:{},children:[],parentElement:null,isConnected:true,
      style:{overflowY:'visible',overflowAnchor:'',setProperty(k,v){this[k]=v;},getPropertyValue(k){return this[k]||'';}},
      clientHeight:600,scrollHeight:3000,scrollTop:0,scrollLeft:0,
      classList:{contains:k=>classes.has(k),toggle(k,value){if(value)classes.add(k);else classes.delete(k);}},
      get id(){return this.attrs.id||'';},set id(value){this.attrs.id=value;},
      setAttribute(k,v){this.attrs[k]=String(v);if(k==='open')this.open=true;},getAttribute(k){return this.attrs[k]??null;},hasAttribute(k){return k in this.attrs;},removeAttribute(k){delete this.attrs[k];if(k==='open')this.open=false;},
      appendChild(child){if(child.parentElement)child.parentElement.children=child.parentElement.children.filter(x=>x!==child);child.parentElement=this;this.children.push(child);return child;},
      contains(child){for(let p=child;p;p=p.parentElement)if(p===this)return true;return false;},
      matches(selector){
        if(selector.startsWith('#'))return this.id===selector.slice(1);
        if(selector.startsWith('.'))return classes.has(selector.slice(1));
        const attribute=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
        if(attribute)return this.hasAttribute(attribute[1])&&(attribute[2]===undefined||this.getAttribute(attribute[1])===attribute[2]);
        return this.tagName.toLowerCase()===selector;
      },
      closest(selectors){for(let p=this;p;p=p.parentElement)if(selectors.split(',').some(s=>p.matches(s.trim())))return p;return null;},
      querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);},
      querySelector(selector){return this.querySelectorAll(selector)[0]||null;},
      addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
      listenerCount:type=>(listeners.get(type)||new Set()).size,
      fire(type,event={}){for(const fn of [...(listeners.get(type)||[])])fn({type,target:this,...event});},
      setPointerCapture(id){this.capturedPointer=id;},
      click(){dispatch('click',{target:this});this.fire('click');if(this.onclick)this.onclick();},
      scrollTo(options){this.scrollTop=options.top;this.scrollLeft=options.left;log.push(['restore',this.id,options.top]);},
      scrollIntoView(options){home.scrollTop=this.offset||0;log.push(['navigate',this.id,options.behavior]);},
      getBoundingClientRect(){return{top:(this.offset||0)-home.scrollTop,height:this.clientHeight};},
      focus(options){doc.activeElement=this;log.push(['focus',this.id,options.preventScroll]);},
      showModal(){this.open=true;this.shows=(this.shows||0)+1;},close(){this.open=false;this.closes=(this.closes||0)+1;},
      set innerHTML(value){
        this.html=value;
        if(this.tagName==='DIALOG'){
          const heading=value.match(/<h2 id="([^"]*)">([^<]*)<\/h2>/);assert.ok(heading);node('h2',{id:heading[1]},this).textContent=heading[2];
          for(const match of value.matchAll(/<button ([^>]*)>([^<]*)<\/button>/g)){
            const properties=Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
            node('button',properties,this).textContent=match[2];
          }
        }
      },get innerHTML(){return this.html||'';}};
    for(const [key,value]of Object.entries(attrs))if(key.startsWith('data-'))n.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
    if(parent)parent.appendChild(n);return n;
  }
  function dispatch(type,event={}){for(const fn of [...(events.get(type)||[])])fn({type,...event});}
  const htmlNode=node('html'),body=node('body',{},htmlNode),home=node('section',{id:'morning-section'},body);
  home.style.overflowY='auto';home.style.overflowAnchor='auto';home.scrollTop=800;
  const stock=node('section',{id:'knTabWrap'},home);stock.offset=1000;
  stock.dataset.stockMain=view;stock.dataset.stockView=view==='favorites'?'watch':'movers';
  const surface=node('div',{class:'kn-stock-surface'},stock);surface.clientHeight=1800;surface.getBoundingClientRect=()=>({top:stock.offset-home.scrollTop,height:1800});
  const heading=node('h2',{id:'rankingHeading',class:'kn-a-section-title'},stock);
  const main=node('button',{'data-kn-tab':'stock'},stock),watch=node('button',{'data-kn-tab':'favorites'},stock);
  const dividendTabs=['div_top','div_cal','div_search'].map(key=>node('button',{'data-kn-tab':key},stock));
  const movers=node('div',{id:'homeMoversCard'},stock),favorites=node('div',{id:'knWatchSec'},stock),holder=node('div',{id:'knDivHolder'},stock);
  const modalBody=node('div',{class:'dividend-modal-body'},body),dividendBody=node('div',{class:'dividend-tab-body'},holder);
  node('div',{id:'knSubRow'},stock);node('div',{id:'knDivSubRow'},stock);
  const economy=node('section',{id:'morning-news-section'},home);economy.offset=500;
  const economyHeading=node('h3',{id:'knNewsDigestTitle'},economy);
  const company=node('section',{id:'knCompanyNewsSection'},home);company.offset=700;
  const companyHeading=node('h2',{id:'knCompanyNewsTitle'},company);
  const root=node('div',{class:'kn-news-orbit'},home),scene=node('div',{class:'kn-orbit-scene'},root);
  const guide=node('button',{class:'kn-orbit-guide'},scene),rank=node('button',{class:'kn-orbit-rank-shortcut'},scene),news=node('button',{class:'kn-orbit-news-shortcut'},scene);
  node('button',{id:'knHomeOrbitMotion'},body);
  doc={body,documentElement:htmlNode,hidden:false,activeElement:null,
    getElementById:id=>body.querySelector('#'+id),
    querySelector(selector){if(selector==='#knTabWrap [data-kn-tab="stock"]')return withStock?main:null;return body.querySelector(selector);},
    createElement(tag){if(tag==='dialog')dialogs++;return node(tag);},
    addEventListener(type,fn){if(!events.has(type))events.set(type,new Set());events.get(type).add(fn);},removeEventListener(type,fn){events.get(type)?.delete(fn);},
    dispatchEvent(event){dispatch(event.type,event);}};
  htmlNode.lang='ja';
  function forbidden(){network++;throw new Error('Shortcut must not fetch or invoke chat');}
  w={document:doc,scrollX:0,scrollY:0,fetch:forbidden,
    setTimeout:()=>1,clearTimeout(){},
    requestAnimationFrame:fn=>frames.push(fn),getComputedStyle:n=>({overflowY:n.style.overflowY}),scrollTo(options){this.scrollX=options.left;this.scrollY=options.top;},
    matchMedia:()=>({matches:reduced,addEventListener(type,fn){mediaChanged=fn;}}),openBeginnerGuide(){guideCalls++;},requireAuth(){auth++;throw new Error('Unexpected auth');}};
  if(pointerEvents)w.PointerEvent=function(){};
  createStability(w);
  const context={window:w,document:doc,fetch:forbidden,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    Date:class extends Date{static now(){return now;}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},wrap:stock,movers,_knMainTab:main,_knWatchTab:watch,_kndb:dividendTabs,_sM:node('button',{'data-sub':'movers'},stock)};
  vm.runInNewContext(controller,context);
  if(view==='favorites')context._showStock('watch');
  else {context._styleP(main,view==='stock');context._styleP(watch,false);dividendTabs.forEach(tab=>context._styleP(tab,tab.dataset.knTab===view));}
  main.onclick=function(){stockClicks++;log.push(['select','stock']);context._showStock();home.scrollTop=900;};
  if(withFallback)w.__knSetSub=function(view){fallbackCalls++;context._showStock(view);};
  vm.runInNewContext(source,context);const host={querySelector:selector=>selector==='.kn-news-orbit'?root:null};w.KNNewsOrbit.mount(host);
  return{w,doc,root,host,main,rank,news,guide,stock,heading,home,economy,economyHeading,company,companyHeading,holder,modalBody,dividendBody,log,storage,dispatch,
    frame(){const current=frames.splice(0);current.forEach(fn=>fn());},frames:()=>frames.length,dialogs:()=>dialogs,stockClicks:()=>stockClicks,fallbackCalls:()=>fallbackCalls,network:()=>network,auth:()=>auth,guideCalls:()=>guideCalls,media(value){mediaChanged({matches:value});},
    advance:ms=>now+=ms,menu:()=>doc.getElementById('knOrbitNewsMenu')};
}

function contact(control,type,values={}){
  control.fire(type,{pointerType:'touch',pointerId:7,isPrimary:true,button:0,clientX:100,clientY:100,...values});
}

test('one touch release reaches each destination without requiring a browser click',()=>{
  for(const name of ['guide','rank','news']){
    const h=harness(),control=h[name],saved=h.storage.get('kn_rank_conditions');
    contact(control,'pointerdown');assert.equal(control.capturedPointer,7);
    assert.equal(h.guideCalls(),0);assert.equal(h.stockClicks(),0);assert.equal(h.log.filter(x=>x[0]==='navigate').length,0);
    contact(control,'pointerup');h.frame();h.frame();
    assert.equal(h.guideCalls(),name==='guide'?1:0);assert.equal(h.stockClicks(),name==='rank'?1:0);
    assert.deepEqual(h.log.filter(x=>x[0]==='navigate'),name==='guide'?[]:[['navigate',name==='rank'?'knTabWrap':'morning-news-section','smooth']]);
    if(name==='rank')assert.equal(h.doc.activeElement,h.heading);
    if(name==='news')assert.equal(h.doc.activeElement,h.economyHeading);
    assert.equal(h.storage.get('kn_rank_conditions'),saved);assert.equal(h.network(),0);assert.equal(h.auth(),0);
  }
});

test('a touch compatibility click does not open twice and the next separate input still works',()=>{
  const h=harness();
  for(let i=1;i<=2;i++){
    contact(h.guide,'pointerdown');contact(h.guide,'pointerup');
    h.guide.fire('click',{detail:1,pointerType:'touch'});
    h.guide.fire('click',{detail:1});assert.equal(h.guideCalls(),i);
    h.advance(100);
  }
  h.guide.fire('click',{detail:0});assert.equal(h.guideCalls(),3,'Assistive technology native activation remains available');
  contact(h.guide,'pointerdown',{pointerType:'mouse'});contact(h.guide,'pointerup',{pointerType:'mouse'});h.guide.fire('click',{detail:1,pointerType:'mouse'});
  assert.equal(h.guideCalls(),4,'A new desktop mouse press must not be swallowed by the touch guard');
  for(const key of ['Enter',' ']){
    contact(h.guide,'pointerdown');contact(h.guide,'pointerup');
    h.guide.fire('keydown',{key,repeat:false});h.guide.fire('click',{detail:0});
  }
  assert.equal(h.guideCalls(),8);assert.equal(h.network(),0);
  contact(h.guide,'pointerdown');contact(h.guide,'pointercancel');
  contact(h.guide,'pointerdown',{pointerType:'mouse'});contact(h.guide,'pointerup',{pointerType:'mouse'});h.guide.fire('click',{detail:1,pointerType:'mouse'});
  assert.equal(h.guideCalls(),9,'A reused pointer ID after cancelled touch must not swallow the next mouse click');
});

test('scroll, cancelled contact, lost capture, long press and multiple fingers never open a shortcut',()=>{
  const cases=[
    h=>contact(h.guide,'pointermove',{clientY:130}),
    h=>contact(h.guide,'pointerup',{clientX:125}),
    h=>contact(h.guide,'pointercancel'),
    h=>h.guide.fire('lostpointercapture'),
    h=>h.guide.fire('contextmenu'),
    h=>{h.guide.fire('contextmenu');h.advance(2000);},
    h=>h.advance(800),
    h=>contact(h.guide,'pointerdown',{pointerId:8,isPrimary:false}),
    h=>h.dispatch('pointerdown',{pointerId:8,isPrimary:false,pointerType:'touch',target:h.body})
  ];
  for(const interrupt of cases){
    const h=harness();contact(h.guide,'pointerdown');interrupt(h);contact(h.guide,'pointerup');
    h.guide.fire('click',{detail:1,pointerType:'touch'});
    assert.equal(h.guideCalls(),0);assert.equal(h.stockClicks(),0);assert.equal(h.network(),0);
    h.advance(100);contact(h.guide,'pointerdown');contact(h.guide,'pointerup');assert.equal(h.guideCalls(),1,'The next independent tap recovers');
  }
});

test('pen taps and older touch-only browsers activate once while retaining native scroll cancellation',()=>{
  const pen=harness();contact(pen.guide,'pointerdown',{pointerType:'pen'});contact(pen.guide,'pointerup',{pointerType:'pen'});
  pen.guide.fire('click',{detail:1,pointerType:'pen'});assert.equal(pen.guideCalls(),1);
  const h=harness({pointerEvents:false}),touch={identifier:3,clientX:100,clientY:100};let prevented=0;
  const start=()=>h.guide.fire('touchstart',{touches:[touch],changedTouches:[touch]});
  const finish=()=>h.guide.fire('touchend',{touches:[],changedTouches:[touch],cancelable:true,preventDefault(){prevented++;}});
  start();finish();h.guide.fire('click',{detail:1});assert.equal(h.guideCalls(),1);assert.equal(prevented,1);
  start();h.guide.fire('touchmove',{touches:[{...touch,clientY:140}]});finish();h.guide.fire('click',{detail:1});assert.equal(h.guideCalls(),1);
  start();h.dispatch('touchstart',{touches:[touch,{...touch,identifier:4}]});finish();assert.equal(h.guideCalls(),1);
  start();h.guide.fire('touchcancel');finish();assert.equal(h.guideCalls(),1);
  start();finish();assert.equal(h.guideCalls(),2);assert.equal(h.network(),0);
});

test('newspaper and graph retain artwork and expose their distinct direct destinations',()=>{
  const h=harness();const markup=h.w.KNNewsOrbit.markup;
  assert.match(markup,/<button type="button" class="kn-orbit-shortcut kn-orbit-news-shortcut" aria-label="[^"]+">/);
  assert.match(markup,/<button type="button" class="kn-orbit-shortcut kn-orbit-rank-shortcut"/);
  assert.doesNotMatch(markup,/knOrbitNewsMenu|aria-haspopup="dialog"/);
  const paper=markup.match(/src="data:image\/webp;base64,([^"]+)"[^>]+/);
  assert.ok(paper,'Newspaper artwork must not wait for another request after the header mounts');
  assert.deepEqual(Buffer.from(paper[1],'base64'),fs.readFileSync(path.join(__dirname,'../static/news-orbit/newspaper.webp')));
  assert.match(paper[0],/decoding="sync" loading="eager"/);
  assert.match(markup,/kn-orbit-market-tile kn-orbit-tile-bars/);
  assert.equal((markup.match(/class="kn-orbit-news-orbiter /g)||[]).length,3);assert.equal(h.dialogs(),0);
});

for(const view of ['favorites','div_top','div_cal'])test(`graph selects the actual rankings from ${view} and navigates after view restoration`,()=>{
  const h=harness({view}),saved=h.storage.get('kn_rank_conditions');
  h.rank.click();assert.equal(h.stockClicks(),1);assert.equal(h.fallbackCalls(),0);
  h.frame();h.frame();assert.equal(h.frames(),0);
  assert.equal(h.stock.dataset.stockMain,'stock');assert.equal(h.stock.dataset.stockView,'movers');
  assert.equal(h.main.getAttribute('aria-pressed'),'true');assert.equal(h.holder.style.display,'none');assert.equal(h.dividendBody.parentElement,h.modalBody);
  assert.deepEqual(h.log.filter(x=>x[0]==='navigate'),[['navigate','knTabWrap','smooth']]);assert.equal(h.doc.activeElement,h.heading);
  assert.equal(h.heading.getAttribute('tabindex'),'-1');assert.equal(h.home.scrollTop,1000);assert.equal(h.home.style.overflowAnchor,'auto');
  assert.equal(h.storage.get('kn_rank_conditions'),saved);assert.equal(h.network(),0);assert.equal(h.auth(),0);assert.equal(h.dialogs(),0);assert.equal(h.guideCalls(),0);
});

test('graph keyboard and pointer activation outlast an earlier view-stability restoration',()=>{
  for(const input of ['Enter','pointerdown']){
    const h=harness();h.main.click();assert.equal(h.home.scrollTop,900);assert.ok(h.frames()>0);
    if(input==='Enter')h.dispatch('keydown',{target:h.rank,key:'Enter'});else h.dispatch('pointerdown',{target:h.rank});
    h.rank.click();h.frame();h.frame();assert.equal(h.home.scrollTop,1000);assert.equal(h.frames(),0);
    assert.equal(h.stockClicks(),2,'Graph must activate the real stock control once');assert.equal(h.fallbackCalls(),0);
    assert.deepEqual(h.log.filter(x=>x[0]==='navigate'),[['navigate','knTabWrap','smooth']]);assert.deepEqual(h.log.at(-1),['focus','rankingHeading',true]);
    assert.equal(h.home.style.overflowAnchor,'auto');assert.equal(h.stock.dataset.stockMain,'stock');assert.equal(h.stock.dataset.stockView,'movers');
  }
});

test('graph uses the existing movers fallback when the stock tab is absent and otherwise fails safely',()=>{
  for(const withFallback of [true,false]){
    const h=harness({withStock:false,withFallback,view:'favorites'}),saved=h.storage.get('kn_rank_conditions');
    assert.doesNotThrow(()=>h.rank.click());h.frame();h.frame();
    assert.equal(h.stockClicks(),0);assert.equal(h.fallbackCalls(),withFallback?1:0);
    assert.equal(h.stock.dataset.stockMain,withFallback?'stock':'favorites');assert.equal(h.stock.dataset.stockView,withFallback?'movers':'watch');
    assert.equal(h.doc.activeElement,h.heading);assert.equal(h.home.scrollTop,1000);assert.equal(h.storage.get('kn_rank_conditions'),saved);
    assert.equal(h.network(),0);assert.equal(h.auth(),0);assert.equal(h.guideCalls(),0);assert.equal(h.dialogs(),0);
  }
});

test('direct newspaper navigation remains single after repeated mounting and creates no chooser',()=>{
  const h=harness();h.w.KNNewsOrbit.mount(h.host);h.w.KNNewsOrbit.mount(h.host);
  assert.equal(h.news.listenerCount('click'),1);assert.equal(h.rank.listenerCount('click'),1);
  h.news.click();h.frame();h.frame();h.news.click();h.frame();h.frame();
  assert.deepEqual(h.log.filter(x=>x[0]==='navigate'),[['navigate','morning-news-section','smooth'],['navigate','morning-news-section','smooth']]);
  assert.equal(h.menu(),null);assert.equal(h.dialogs(),0);assert.equal(h.guideCalls(),0);assert.equal(h.stockClicks(),0);assert.equal(h.network(),0);assert.equal(h.frames(),0);
});

test('newspaper goes directly to economic news without changing stock views or ranking conditions',()=>{
  for(const view of ['favorites','div_top','div_cal']){
    const h=harness({view}),saved=h.storage.get('kn_rank_conditions');
    const before={main:h.stock.dataset.stockMain,view:h.stock.dataset.stockView,cur:h.stock.getAttribute('data-cur'),aria:h.main.getAttribute('aria-pressed'),holder:h.holder.style.display,parent:h.dividendBody.parentElement};
    h.news.click();h.frame();h.frame();
    assert.deepEqual(h.log.filter(x=>x[0]==='navigate'),[['navigate','morning-news-section','smooth']]);assert.equal(h.doc.activeElement,h.economyHeading);assert.equal(h.home.scrollTop,500);
    assert.equal(h.stock.dataset.stockMain,before.main);assert.equal(h.stock.dataset.stockView,before.view);assert.equal(h.stock.getAttribute('data-cur'),before.cur);
    assert.equal(h.main.getAttribute('aria-pressed'),before.aria);assert.equal(h.holder.style.display,before.holder);assert.equal(h.dividendBody.parentElement,before.parent);
    assert.equal(h.storage.get('kn_rank_conditions'),saved);assert.equal(h.stockClicks(),0);assert.equal(h.fallbackCalls(),0);assert.equal(h.dialogs(),0);assert.equal(h.guideCalls(),0);assert.equal(h.auth(),0);assert.equal(h.network(),0);
  }
});

test('newspaper Enter navigation waits out a pending stock restoration without selecting a stock tab',()=>{
  const h=harness();h.main.click();assert.equal(h.home.scrollTop,900);assert.ok(h.frames()>0);
  const before={main:h.stock.dataset.stockMain,view:h.stock.dataset.stockView,aria:h.main.getAttribute('aria-pressed')};
  h.dispatch('keydown',{target:h.news,key:'Enter'});h.news.click();h.frame();h.frame();
  assert.equal(h.home.scrollTop,500);assert.equal(h.frames(),0);assert.equal(h.stockClicks(),1);assert.equal(h.fallbackCalls(),0);
  assert.equal(h.stock.dataset.stockMain,before.main);assert.equal(h.stock.dataset.stockView,before.view);assert.equal(h.main.getAttribute('aria-pressed'),before.aria);
  assert.deepEqual(h.log.filter(x=>x[0]==='navigate'),[['navigate','morning-news-section','smooth']]);assert.deepEqual(h.log.at(-1),['focus','knNewsDigestTitle',true]);
  assert.equal(h.home.style.overflowAnchor,'auto');assert.equal(h.dialogs(),0);assert.equal(h.guideCalls(),0);assert.equal(h.network(),0);
});

test('reduced motion and all four languages apply to the two direct shortcut destinations',()=>{
  const h=harness({reduced:true});h.rank.click();h.frame();h.frame();assert.equal(h.log.find(x=>x[0]==='navigate')[2],'auto');
  h.news.click();h.frame();h.frame();assert.equal(h.log.filter(x=>x[0]==='navigate').at(-1)[2],'auto');
  const copies=[["en", "Go to today's stock rankings", "Go to economic news"], ["ko", "오늘의 종목 순위로 이동", "경제 뉴스로 이동"], ["zh", "查看今日股票排名", "查看经济新闻"], ["ja", "今日の銘柄ランキングへ", "経済ニュースへ"]];
  for(const [lang,graph,news]of copies){h.doc.documentElement.lang=lang;h.dispatch('langChanged');assert.equal(h.rank.getAttribute('aria-label'),graph);assert.equal(h.news.getAttribute('aria-label'),news);assert.ok(h.root.classList.contains('kn-orbit-reduced'));}
  h.doc.documentElement.lang='unknown';h.dispatch('langChanged');assert.equal(h.rank.getAttribute('aria-label'),copies.at(-1)[1]);assert.equal(h.news.getAttribute('aria-label'),copies.at(-1)[2]);
  h.storage.set('app_lang','en');h.doc.documentElement.lang='ja';h.dispatch('langChanged');assert.equal(h.rank.getAttribute('aria-label'),copies[0][1]);assert.equal(h.news.getAttribute('aria-label'),copies[0][2]);
  h.media(false);h.news.click();h.frame();h.frame();assert.equal(h.log.filter(x=>x[0]==='navigate').at(-1)[2],'smooth');
  assert.equal(h.dialogs(),0);assert.equal(h.auth(),0);assert.equal(h.guideCalls(),0);assert.equal(h.network(),0);
});

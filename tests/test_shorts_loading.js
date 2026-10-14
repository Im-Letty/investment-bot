'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').replace(/\bvar K="[^"]+";/g,'var K="fixture-youtube-key";'),scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const seedSource=scripts.find(s=>s.includes('var SRC=[')&&s.includes('knShortsBtn')),liveSource=scripts.find(s=>s.includes('var TOPICS=[[')&&s.includes('ksPool'));
assert.ok(seedSource&&liveSource,'exercise both actual Shorts controllers');
const searchSource=scripts.find(s=>s.includes('window.__ksFetchPatched'));
const patchStart=searchSource.indexOf('(function(){if(!window.__ksFetchPatched)'),patchEnd=searchSource.indexOf('})();',patchStart)+5;
assert.ok(patchStart>=0&&patchEnd>patchStart);const keywordPatch=searchSource.slice(patchStart,patchEnd);
const tags=JSON.parse(searchSource.match(/var TAGS=(\[[^;]+\]);/)[1]);
function harness({pool=[],managed=true}={}){
 const storage=new Map([['ksPool',JSON.stringify(pool)]]),requests=[],pending=[],observers=[],actions=[];
 class Node{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attrs={};this.style={};this.events=new Map();this._classes=new Set();this._text='';this.__m=false;this.scrollTop=0;this.classList={add:(...a)=>a.forEach(c=>this._classes.add(c)),remove:(...a)=>a.forEach(c=>this._classes.delete(c)),contains:c=>this._classes.has(c)};if(tag==='iframe')this.contentWindow={postMessage:(data)=>actions.push({kind:'native-message',data})};}
  set id(s){this.attrs.id=s;}get id(){return this.attrs.id||'';}set className(s){this._classes=new Set(s.split(/\s+/).filter(Boolean));}get className(){return [...this._classes].join(' ');}
  set textContent(s){this._text=String(s);this.children=[];}get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
  get firstChild(){return this.children[0]||null;}get lastElementChild(){return this.children.at(-1)||null;}get nextElementSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)+1]||null;}
  get isConnected(){return this===document.body||!!this.parentNode?.isConnected;}
  setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}
  appendChild(n){n.parentNode?.removeChild(n);n.parentNode=this;this.children.push(n);return n;}
  insertBefore(n,b){n.parentNode?.removeChild(n);n.parentNode=this;const at=b?this.children.indexOf(b):this.children.length;this.children.splice(at,0,n);return n;}
  removeChild(n){this.children.splice(this.children.indexOf(n),1);n.parentNode=null;}remove(){this.parentNode?.removeChild(this);}
  contains(n){return n===this||this.children.some(c=>c.contains(n));}
  addEventListener(k,f){if(!this.events.has(k))this.events.set(k,[]);this.events.get(k).push(f);}
  click(){for(const f of this.events.get('click')||[])f({target:this});}
  querySelectorAll(sel){const result=[],match=n=>sel.startsWith('.')?n._classes.has(sel.slice(1)):sel.startsWith('#')?n.id===sel.slice(1):n.tagName===sel.toUpperCase();function walk(n){for(const c of n.children){if(match(c))result.push(c);walk(c);}}walk(this);return result;}
  querySelector(sel){return this.querySelectorAll(sel)[0]||null;}
  set innerHTML(value){this.children.forEach(n=>n.parentNode=null);this.children=[];this._text='';this.lastHTML=value;if(this.id==='knShorts'){const top=new Node('div');top.className='ks-top';const close=new Node('button');close.id='ksClose';top.appendChild(close);this.appendChild(top);const feed=new Node('div');feed.id='ksFeed';feed.className='ks-feed';this.appendChild(feed);parseSlides(feed,value);}else parseSlides(this,value);}
  insertAdjacentHTML(_where,value){this.lastInsertedHTML=value;parseSlides(this,value);}
 }
 function parseSlides(parent,value){for(const m of value.matchAll(/<div class="ks-slide"([^>]*)>([\s\S]*?)<\/span><\/div><\/div>/g)){const slide=new Node('div');slide.className='ks-slide';for(const a of m[1].matchAll(/([\w-]+)="([^"]*)"/g))slide.setAttribute(a[1],a[2]);const ph=new Node('div');ph.className='ks-ph';ph.textContent='読み込み中…';slide.appendChild(ph);parent.appendChild(slide);}}
 const document={readyState:'complete',hidden:false,body:new Node('body'),createElement:tag=>new Node(tag),getElementById(id){return this.body.querySelector('#'+id);},addEventListener(){}};
 const nav=new Node('nav');nav.id='knBottomNav';document.body.appendChild(nav);for(const action of ['home','morning']){const b=new Node('button');b.className='bn-item';b.setAttribute('data-act',action);nav.appendChild(b);}
 class IO{constructor(fn,options){this.fn=fn;this.options=options;this.targets=new Set();observers.push(this);}observe(n){this.targets.add(n);}unobserve(n){this.targets.delete(n);}disconnect(){this.targets.clear();}fire(node,on=true){this.fn([{target:node,isIntersecting:on,intersectionRatio:on?1:0}]);}}
 const context={document,IntersectionObserver:IO,Date,Math,Promise,setTimeout(){return 1;},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},fetch(url,options){requests.push({url,options});return new Promise((resolve,reject)=>pending.push({resolve,reject}));}};context.window=context;
 const player={active:null,activate(slide){assert.ok(document.getElementById('ksFeed').contains(slide));actions.push({kind:'activate',slide});this.active=slide;mount(slide,true);if(slide.nextElementSibling)this.prepare(slide.nextElementSibling);},prepare(slide){actions.push({kind:'prepare',slide});mount(slide,false);},pause(slide){actions.push({kind:'pause',slide});},close(){actions.push({kind:'close'});const feed=document.getElementById('ksFeed');feed.querySelectorAll('iframe').forEach(n=>n.remove());feed.querySelectorAll('.ks-slide').forEach(n=>n.__m=false);this.active=null;}};
 function mount(slide,active){if(!slide.querySelector('iframe')){const iframe=new Node('iframe');iframe.src='fixture';iframe.active=active;slide.insertBefore(iframe,slide.firstChild);}slide.__m=true;}
 if(managed)context.KNShortsPlayback={get(feed,sh){assert.equal(feed.id,'ksFeed');assert.equal(sh.id,'knShorts');return player;}};
 vm.runInNewContext(seedSource,context,{filename:'actual-shorts-seed.js'});vm.runInNewContext(keywordPatch,context,{filename:'actual-keyword-wrapper.js'});vm.runInNewContext(liveSource,context,{filename:'actual-shorts-live.js'});
 const feed=document.getElementById('ksFeed'),sheet=document.getElementById('knShorts'),button=document.getElementById('knShortsBtn');
 const settle=()=>new Promise(resolve=>setImmediate(resolve));async function reply(data,index=0){await settle();assert.ok(pending[index]);pending.splice(index,1)[0].resolve({json:async()=>data});await settle();}
 function search(keyword,genre){if(genre)storage.set('ksWeights',JSON.stringify({[genre]:100}));context.__ksKeyword=keyword||'';feed.innerHTML='';feed.__live=false;button.click();}
 return {context,document,feed,sheet,button,player,actions,observers,storage,requests,pending,settle,reply,search,close:()=>document.getElementById('ksClose').click(),slides:()=>feed.querySelectorAll('.ks-slide')};
}
const result=(id,title='取得した説明')=>({id:{videoId:id},snippet:{title}});
test('published native metadata joins the visible feed without entering the YouTube pool',()=>{
 const h=harness();h.button.click();h.context.KNShortsPosting={feedRows:rows=>rows};
 const before=h.slides().length,pool=h.storage.get('ksPool');
 const row={id:'upload:51',postId:51,provider:'upload',mediaSrc:'/api/shorts/posts/51/media',cap:'<img onerror="bad">',tag:'#企業'};
 assert.equal(h.context.KNShortsFeed.appendPublished([row],h.context.KNShortsFeed.captureContext()),1);
 const published=h.slides().at(-1);assert.equal(h.slides().length,before+1);assert.equal(published.getAttribute('data-media-type'),'upload');assert.equal(published.getAttribute('data-vid'),null);
 assert.equal(published.getAttribute('data-media-src'),'/api/shorts/posts/51/media');assert.match(h.feed.lastInsertedHTML,/&lt;img/);assert.equal(h.storage.get('ksPool'),pool);
 assert.equal(h.context.KNShortsFeed.appendPublished([row],h.context.KNShortsFeed.captureContext()),0);
 assert.equal(h.context.KNShortsFeed.appendPublished([{...row,id:'upload:52',postId:52,mediaSrc:'https://external.invalid/asset'}],h.context.KNShortsFeed.captureContext()),0);
});
test('late public posts cannot contaminate a changed search or a closed feed',()=>{
 const h=harness();h.button.click();h.context.KNShortsPosting={feedRows:rows=>rows};const captured=h.context.KNShortsFeed.captureContext();
 const row={id:'upload:51',postId:51,provider:'upload',mediaSrc:'/api/shorts/posts/51/media',cap:'投稿',tag:'#企業'};
 h.search('銀行');assert.equal(h.context.KNShortsFeed.appendPublished([row],captured),0);assert.equal(h.context.KNShortsFeed.appendPublished([row],h.context.KNShortsFeed.captureContext()),0);
 h.context.__ksKeyword='';h.close();assert.equal(h.context.KNShortsFeed.appendPublished([row],h.context.KNShortsFeed.captureContext()),0);
});
test('owner deletion removes only that published slide and its observer/player record',()=>{
 const h=harness();h.button.click();h.context.KNShortsPosting={feedRows:rows=>rows};
 const row={id:'upload:51',postId:51,provider:'upload',mediaSrc:'/api/shorts/posts/51/media',cap:'投稿',tag:'#企業'};
 h.context.KNShortsFeed.appendPublished([row],h.context.KNShortsFeed.captureContext());const target=h.slides().at(-1),seed=h.slides()[0];
 h.player.remove=slide=>h.actions.push({kind:'remove',slide});
 assert.equal(h.context.KNShortsFeed.removePublished(51),1);assert.equal(h.feed.contains(target),false);assert.equal(h.feed.contains(seed),true);assert.equal(h.observers[1].targets.has(target),false);
 assert.ok(h.actions.some(a=>a.kind==='remove'&&a.slide===target));assert.equal(h.context.KNShortsFeed.removePublished(51),0);
 assert.equal(h.context.KNShortsFeed.appendPublished([row],h.context.KNShortsFeed.captureContext()),1,'a fresh verified feed can restore the id after local removal');
});
test('cold open keeps seed DOM and prepared iframe while just one background search is unresolved',()=>{
 const h=harness(),first=h.slides()[0],seedCount=h.slides().length;h.storage.set('ksPool',JSON.stringify([{id:first.getAttribute('data-vid'),cap:'重複',tag:'既存'},{id:'cachevid001',cap:'<img onerror="x">',tag:'" onload="x'},{id:'cachevid001',cap:'<img onerror="x">',tag:'" onload="x'},{id:'invalid"id',cap:'不正',tag:'不正'}]));h.button.click();assert.equal(h.slides()[0],first);assert.ok(first.querySelector('iframe'));assert.ok(first.nextElementSibling.querySelector('iframe'));assert.equal(h.requests.length,1);assert.equal(h.slides().length,seedCount+1);assert.equal(h.feed.lastInsertedHTML.includes('&lt;img'),true);assert.equal(h.feed.lastInsertedHTML.includes('&quot;'),true);assert.ok(h.observers[1].targets.has(first));h.observers.forEach(io=>io.fire(first));assert.equal(h.requests.length,1);
});
test('explicit keyword rejects the old background result and never mixes an unrelated pool',async()=>{
 const h=harness({pool:[{id:'cachevid001',cap:'以前',tag:'以前'}]});h.button.click();h.search('銀行');assert.equal(h.slides().length,0);assert.equal(h.requests.length,2);assert.equal(new URL(h.requests[1].url).searchParams.get('q'),'銀行');await h.reply({items:[result('lateold0001')]},0);assert.equal(h.slides().length,0);await h.reply({items:[result('current0001')]});assert.deepEqual(h.slides().map(n=>n.getAttribute('data-vid')),['current0001']);assert.ok(h.slides()[0].querySelector('iframe'));assert.equal(JSON.parse(h.storage.get('ksPool')).some(v=>v.id==='lateold0001'),false);
});
test('all sixteen existing genre searches keep their selected tag without stale cache content',async()=>{
 assert.equal(tags.length,16);for(const tag of tags){const h=harness({pool:[{id:'cachevid001',cap:'違う候補',tag:'無関係'}]});h.search('',tag);assert.equal(h.slides().length,0);assert.equal(h.requests.length,1);await h.reply({items:[result('current0001')]});assert.equal(h.slides().length,1);assert.equal(h.slides()[0].getAttribute('data-tag'),tag);assert.deepEqual(JSON.parse(h.storage.get('ksWeights')),{[tag]:100});}
});
test('explicit search reports empty and unavailable distinctly with no cached fake result',async()=>{
 for(const [data,text] of [[{items:[]},'見つかりません'],[null,'取得できません'],[{error:{reason:'fixture'}},'取得できません']]){const h=harness({pool:[{id:'cachevid001',cap:'違う候補',tag:'無関係'}]});h.search('見つからない');await h.reply(data);assert.equal(h.slides().length,0);assert.match(h.feed.querySelector('.ks-search-status').textContent,new RegExp(text));assert.equal(h.feed.querySelector('.ks-search-status').getAttribute('role'),'status');}
});
test('hidden responses do not append or mount; reopening accepts only the current waiting result',async()=>{
 const h=harness();h.button.click();const count=h.slides().length,first=h.slides()[0];h.close();h.observers.forEach(io=>io.fire(first));assert.equal(h.requests.length,1);await h.reply({items:[result('current0001')]});assert.equal(h.slides().length,count);assert.equal(h.feed.querySelectorAll('iframe').length,0);h.button.click();assert.equal(h.slides().length,count+1);assert.equal(h.requests.length,1);assert.equal(h.player.active,h.slides()[0]);h.document.hidden=true;const before=h.actions.filter(a=>a.kind==='activate').length;h.observers.forEach(io=>io.fire(h.slides().at(-1)));assert.equal(h.actions.filter(a=>a.kind==='activate').length,before);assert.equal(h.requests.length,1);
});
test('fresh dynamic first slide is reused on reopen and close removes its current iframe',async()=>{
 const h=harness(),detached=h.slides()[0];h.search('銀行');await h.reply({items:[result('current0001'),result('newvideo001')]});const first=h.slides()[0];assert.equal(h.player.active,first);const before=h.actions.length;h.observers.forEach(io=>io.fire(detached));assert.equal(h.actions.length,before);h.close();assert.equal(h.feed.querySelectorAll('iframe').length,0);assert.ok(h.slides().every(n=>n.__m===false));h.button.click();assert.equal(h.player.active,first);assert.ok(first.querySelector('iframe'));assert.equal(h.requests.length,1);
});
test('background additions never reactivate an evicted first slide while another slide is being watched',async()=>{
 const h=harness();h.button.click();const first=h.slides()[0],watching=h.slides()[5];h.player.activate(watching);first.querySelector('iframe').remove();await h.reply({items:[result('newvideo001'),result('bad"id'),result('short')]});assert.equal(h.player.active,watching);assert.equal(first.querySelector('iframe'),null);assert.equal(h.slides().filter(n=>n.getAttribute('data-vid')==='newvideo001').length,1);assert.equal(h.slides().some(n=>n.getAttribute('data-vid')==='bad"id'),false);
});
test('unavailable player asset keeps native fallback and cleans up dynamic iframe nodes',async()=>{
 const h=harness({managed:false});h.button.click();assert.ok(h.slides()[0].querySelector('iframe'));h.search('銀行');await h.reply({items:[result('current0001')]},1);assert.ok(h.slides()[0].querySelector('iframe'));await h.reply({items:[]});h.close();assert.equal(h.feed.querySelectorAll('iframe').length,0);assert.ok(h.slides().every(n=>n.__m===false));
});
test('native fallback reuses an existing unmarked iframe on visibility and after close/reopen',()=>{
 const h=harness({managed:false});h.button.click();const first=h.slides()[0],iframe=first.querySelector('iframe');assert.ok(iframe);delete first.__m;assert.equal(first.__m,undefined);assert.equal(h.requests.length,1);assert.equal(h.pending.length,1);
 h.observers[1].fire(first);assert.equal(first.querySelectorAll('iframe').length,1);assert.equal(first.querySelector('iframe'),iframe);assert.ok(h.actions.some(a=>a.kind==='native-message'&&JSON.parse(a.data).func==='playVideo'));assert.equal(h.requests.length,1,'observer reuse does not start another search');
 h.close();assert.equal(h.feed.querySelectorAll('iframe').length,0);assert.equal(first.__m,false);h.button.click();const reopened=first.querySelector('iframe');assert.ok(reopened);assert.notEqual(reopened,iframe);delete first.__m;h.observers[1].fire(first);assert.equal(first.querySelectorAll('iframe').length,1);assert.equal(first.querySelector('iframe'),reopened);assert.equal(h.slides()[0],first);assert.equal(h.requests.length,1);assert.equal(h.pending.length,1);h.close();assert.equal(h.feed.querySelectorAll('iframe').length,0);
});

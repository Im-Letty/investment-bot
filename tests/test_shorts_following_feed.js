'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').replace(/\bvar K="[^"]+";/g,'var K="fixture-youtube-key";'),scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const seedSource=scripts.find(s=>s.includes('var SRC=[')&&s.includes('knShortsBtn')),liveSource=scripts.find(s=>s.includes('var TOPICS=[[')&&s.includes('ksPool'));
assert.ok(seedSource&&liveSource,'exercise both actual Shorts controllers');
const searchSource=scripts.find(s=>s.includes('window.__ksFetchPatched'));
const patchStart=searchSource.indexOf('(function(){if(!window.__ksFetchPatched)'),patchEnd=searchSource.indexOf('})();',patchStart)+5;
assert.ok(patchStart>=0&&patchEnd>patchStart);const keywordPatch=searchSource.slice(patchStart,patchEnd);
function harness({pool=[],managed=true,followingRows=[],realFollowing=false}={}){
 const storage=new Map([['ksPool',JSON.stringify(pool)]]),requests=[],pending=[],observers=[],actions=[],remembered=[],modeChanges=[];
 let currentFollowing=followingRows.slice(),followingReads=0;
 const following={rows(){followingReads++;return currentFollowing.slice();},emptyMessage(){return 'フォローした投稿者の動画はまだありません。';},remember(rows){remembered.push(rows.map(row=>({...row})));},modeChanged(mode){modeChanges.push(mode);}};
 class Node{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attrs={};this.style={};this.events=new Map();this._classes=new Set();this._text='';this.__m=false;this.scrollTop=0;this.classList={add:(...a)=>a.forEach(c=>this._classes.add(c)),remove:(...a)=>a.forEach(c=>this._classes.delete(c)),contains:c=>this._classes.has(c),toggle:(c,on)=>on?this._classes.add(c):this._classes.delete(c)};if(tag==='iframe')this.contentWindow={postMessage:(data)=>actions.push({kind:'native-message',data})};}
  set id(s){this.attrs.id=s;}get id(){return this.attrs.id||'';}set className(s){this._classes=new Set(s.split(/\s+/).filter(Boolean));}get className(){return [...this._classes].join(' ');}
  set textContent(s){this._text=String(s);this.children=[];}get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
  get childNodes(){return this.children;}get firstChild(){return this.children[0]||null;}get lastElementChild(){return this.children.at(-1)||null;}get nextElementSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)+1]||null;}
  get isConnected(){return this===document.body||!!this.parentNode?.isConnected;}
  setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}
  appendChild(n){n.parentNode?.removeChild(n);n.parentNode=this;this.children.push(n);return n;}
  insertBefore(n,b){n.parentNode?.removeChild(n);n.parentNode=this;const at=b?this.children.indexOf(b):this.children.length;this.children.splice(at,0,n);return n;}
  removeChild(n){this.children.splice(this.children.indexOf(n),1);n.parentNode=null;}remove(){this.parentNode?.removeChild(this);}
  contains(n){return n===this||this.children.some(c=>c.contains(n));}
  getBoundingClientRect(){const height=600,index=this.parentNode&&this.parentNode.id==='ksFeed'?this.parentNode.children.indexOf(this):0,top=this.id==='ksFeed'?0:index*height-(this.parentNode?.scrollTop||0);return {top,bottom:top+height,left:0,right:320,width:320,height};}
  replaceChildren(...nodes){this.children.forEach(n=>n.parentNode=null);this.children=[];nodes.forEach(n=>this.appendChild(n));}
  scrollIntoView(){actions.push({kind:'scroll',slide:this});}
  addEventListener(k,f){if(!this.events.has(k))this.events.set(k,[]);this.events.get(k).push(f);}
  click(){for(const f of this.events.get('click')||[])f({target:this});}
  querySelectorAll(sel){const result=[],parts=sel.trim().split(/\s+/),match=(n,s)=>s.startsWith('.')?n._classes.has(s.slice(1)):s.startsWith('#')?n.id===s.slice(1):n.tagName===s.toUpperCase();function matches(n){if(!match(n,parts.at(-1)))return false;let ancestor=n.parentNode;for(let i=parts.length-2;i>=0;i--){while(ancestor&&!match(ancestor,parts[i]))ancestor=ancestor.parentNode;if(!ancestor)return false;ancestor=ancestor.parentNode;}return true;}function walk(n){for(const c of n.children){if(matches(c))result.push(c);walk(c);}}walk(this);return result;}
  querySelector(sel){return this.querySelectorAll(sel)[0]||null;}
  set innerHTML(value){this.children.forEach(n=>n.parentNode=null);this.children=[];this._text='';this.lastHTML=value;if(this.id==='knShorts'){const top=new Node('div');top.className='ks-top';const title=new Node('div');title.className='ks-title';title.textContent='経済ショート';top.appendChild(title);const close=new Node('button');close.id='ksClose';top.appendChild(close);this.appendChild(top);const feed=new Node('div');feed.id='ksFeed';feed.className='ks-feed';this.appendChild(feed);parseSlides(feed,value);}else parseSlides(this,value);}
  insertAdjacentHTML(_where,value){this.lastInsertedHTML=value;parseSlides(this,value);}
 }
 function parseSlides(parent,value){for(const m of value.matchAll(/<div class="ks-slide"([^>]*)>([\s\S]*?)<\/span><\/div><\/div>/g)){const slide=new Node('div');slide.className='ks-slide';for(const a of m[1].matchAll(/([\w-]+)="([^"]*)"/g))slide.setAttribute(a[1],a[2]);const ph=new Node('div');ph.className='ks-ph';ph.textContent='読み込み中…';slide.appendChild(ph);const meta=new Node('div');meta.className='ks-meta';for(const [tag,className] of [['div','ks-cap'],['span','ks-tag']]){const child=new Node(tag);child.className=className;meta.appendChild(child);}slide.appendChild(meta);parent.appendChild(slide);}}
 const document={readyState:'complete',hidden:false,body:new Node('body'),createElement:tag=>new Node(tag),getElementById(id){return this.body.querySelector('#'+id);},querySelector(sel){return this.body.querySelector(sel);},addEventListener(){}};
 const nav=new Node('nav');nav.id='knBottomNav';document.body.appendChild(nav);for(const action of ['home','morning']){const b=new Node('button');b.className='bn-item';b.setAttribute('data-act',action);nav.appendChild(b);}
 class IO{constructor(fn,options){this.fn=fn;this.options=options;this.targets=new Set();observers.push(this);}observe(n){this.targets.add(n);}unobserve(n){this.targets.delete(n);}disconnect(){this.targets.clear();}fire(node,on=true){this.fn([{target:node,isIntersecting:on,intersectionRatio:on?1:0}]);}}
 const context={KNShortsFollowing:following,document,IntersectionObserver:IO,Date,Math,Promise,setTimeout(){return 1;},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},fetch(url,options){requests.push({url,options});return new Promise((resolve,reject)=>pending.push({resolve,reject}));}};context.window=context;
 const player={active:null,activate(slide){assert.ok(document.getElementById('ksFeed').contains(slide));actions.push({kind:'activate',slide});this.active=slide;mount(slide,true);if(slide.nextElementSibling)this.prepare(slide.nextElementSibling);},prepare(slide){actions.push({kind:'prepare',slide});mount(slide,false);},pause(slide){actions.push({kind:'pause',slide});},close(){actions.push({kind:'close'});const feed=document.getElementById('ksFeed');feed.querySelectorAll('iframe').forEach(n=>n.remove());feed.querySelectorAll('.ks-slide').forEach(n=>n.__m=false);this.active=null;}};
 function mount(slide,active){if(!slide.querySelector('iframe')){const iframe=new Node('iframe');iframe.src='fixture';iframe.active=active;slide.insertBefore(iframe,slide.firstChild);}slide.__m=true;}
 if(managed)context.KNShortsPlayback={get(feed,sh){assert.equal(feed.id,'ksFeed');assert.equal(sh.id,'knShorts');return player;}};
 vm.runInNewContext(seedSource,context,{filename:'actual-shorts-seed.js'});vm.runInNewContext(keywordPatch,context,{filename:'actual-keyword-wrapper.js'});vm.runInNewContext(liveSource,context,{filename:'actual-shorts-live.js'});
 if(realFollowing){context.KNShortsFollowing=require('../static/shorts-following.js').create(context);context.KNShortsFollowing.mount();}
 const feed=document.getElementById('ksFeed'),sheet=document.getElementById('knShorts'),button=document.getElementById('knShortsBtn');
 const settle=()=>new Promise(resolve=>setImmediate(resolve));async function reply(data,index=0){await settle();assert.ok(pending[index]);pending.splice(index,1)[0].resolve({json:async()=>data});await settle();}
 function search(keyword,genre){if(genre)storage.set('ksWeights',JSON.stringify({[genre]:100}));context.__ksKeyword=keyword||'';context.__ksTag=genre||'';feed.innerHTML='';feed.__live=false;button.click();}
 return {context,document,feed,sheet,button,player,actions,observers,storage,requests,pending,settle,reply,search,remembered,modeChanges,followingReads:()=>followingReads,setFollowing:rows=>{currentFollowing=rows.slice();},close:()=>document.getElementById('ksClose').click(),slides:()=>feed.querySelectorAll('.ks-slide')};
}

// These cases exercise the actual inline seed, live-feed and keyword controllers.
// Creator storage/follow membership is stubbed except where the real module is requested.
const followed=(id='followed001')=>({id,cap:'フォロー中の投稿者の動画',tag:'#企業',channelId:'UC_followed_fixture',channelTitle:'フォローした投稿者'});
const result=(id,extra={})=>({id:{videoId:id},snippet:{title:'取得した説明',...extra}});
const ids=h=>h.slides().map(sl=>sl.getAttribute('data-vid'));
const api=h=>h.context.KNShortsFeed;
const globalNative={id:'upload:51',postId:51,provider:'upload',mediaSrc:'/api/shorts/posts/51/media',cap:'全体への投稿',tag:'#企業'};

test('Follow replaces seeds and cached recommendations without fetching and same-mode selection is idempotent',()=>{
 const h=harness({pool:[{id:'cachevid001',cap:'おすすめキャッシュ',tag:'#投資'}],followingRows:[followed()]});
 h.button.click();const seed=h.slides()[0],count=h.requests.length;
 assert.equal(api(h).getMode(),'recommended');
 api(h).setMode('following');
 assert.equal(api(h).getMode(),'following');assert.deepEqual(ids(h),['followed001']);
 assert.equal(h.feed.contains(seed),false);assert.equal(seed.querySelector('iframe'),null);
 assert.equal(h.requests.length,count,'Follow does not issue an unrelated YouTube or public-post request');
 assert.ok(h.actions.some(a=>a.kind==='close'));assert.ok(h.observers[1].targets.has(h.slides()[0]));
 const current=h.slides()[0],reads=h.followingReads(),closes=h.actions.filter(a=>a.kind==='close').length;
 h.feed.scrollTop=120;api(h).setMode('following');
 assert.equal(h.slides()[0],current);assert.equal(h.feed.scrollTop,120);assert.equal(h.followingReads(),reads);
 assert.equal(h.actions.filter(a=>a.kind==='close').length,closes);assert.equal(h.requests.length,count);
});

test('neither old observer can inject random seeds or fetch pagination while Follow is selected',()=>{
 const h=harness({followingRows:[followed()]});h.button.click();
 const oldFirst=h.slides()[0],oldLast=h.slides().at(-1);api(h).setMode('following');
 const current=h.slides()[0],requests=h.requests.length,activations=h.actions.filter(a=>a.kind==='activate').length;
 h.observers.forEach(io=>{io.fire(oldFirst);io.fire(oldLast);});
 assert.equal(h.actions.filter(a=>a.kind==='activate').length,activations,'detached recommendation callbacks are inert');
 h.observers.forEach(io=>io.fire(current));
 assert.deepEqual(ids(h),['followed001']);assert.equal(h.requests.length,requests);
 assert.ok(h.slides().every(sl=>sl.getAttribute('data-vid')==='followed001'));
});

test('a late recommended response cannot render, cache or remember creator rows after switching to Follow',async()=>{
 const h=harness({followingRows:[followed()]});h.button.click();const pool=h.storage.get('ksPool');
 api(h).setMode('following');await h.reply({items:[result('lateold0001',{channelId:'UC_stale',channelTitle:'古い取得'})]});
 assert.deepEqual(ids(h),['followed001']);assert.equal(h.storage.get('ksPool'),pool);assert.equal(h.remembered.length,0);
 api(h).setMode('recommended');assert.equal(ids(h).includes('lateold0001'),false);assert.equal(h.requests.length,1);
});

test('an already-waiting hidden recommendation response is discarded by a Follow switch and cannot return on reopen',async()=>{
 const h=harness({followingRows:[followed()]});h.button.click();h.close();
 await h.reply({items:[result('lateold0001',{channelId:'UC_waiting',channelTitle:'待機中の取得'})]});
 assert.equal(h.remembered.length,0);api(h).setMode('following');h.button.click();
 assert.equal(api(h).getMode(),'following');assert.deepEqual(ids(h),['followed001']);
 assert.equal(h.requests.length,1);assert.equal(h.remembered.length,0);
 h.close();assert.equal(h.feed.querySelectorAll('iframe').length,0);h.button.click();
 assert.equal(api(h).getMode(),'following');assert.deepEqual(ids(h),['followed001']);assert.equal(h.requests.length,1);
});

test('Follow rejects old published contexts and freshly captured global public or native posts',()=>{
 const h=harness({followingRows:[followed()]});h.button.click();h.context.KNShortsPosting={feedRows:rows=>rows};
 const old=api(h).captureContext();assert.equal(old.mode,'recommended');
 api(h).setMode('following');const current=api(h).captureContext();assert.equal(current.mode,'following');
 for(const context of [old,current]){
  assert.equal(api(h).appendPublished([globalNative],context),0);
  assert.equal(api(h).appendPublished([{id:'globalyt001',cap:'全体のYouTube投稿',tag:'#企業'}],context),0);
 }
 assert.deepEqual(ids(h),['followed001']);
 api(h).setMode('recommended');
 assert.equal(api(h).appendPublished([globalNative],old),0,'restoring Recommended does not revive a prior generation token');
 assert.equal(api(h).appendPublished([globalNative],api(h).captureContext()),1);
});

test('deleting a public or native post while Following cannot resurrect it from the detached Recommended snapshot',()=>{
 const publicYouTube={id:'globalyt001',postId:52,provider:'youtube',cap:'全体へのYouTube投稿',tag:'#企業'};
 for(const row of [globalNative,publicYouTube]){
  const h=harness({followingRows:[followed()]});h.button.click();h.context.KNShortsPosting={feedRows:rows=>rows};
  const original=h.slides().slice();assert.equal(api(h).appendPublished([row],api(h).captureContext()),1);
  const published=h.slides().at(-1);assert.equal(published.getAttribute('data-post-id'),String(row.postId));
  api(h).setMode('following');assert.equal(h.feed.contains(published),false);
  assert.equal(api(h).removePublished(row.postId),1,'owner deletion also removes a detached recommendation post');
  assert.equal(api(h).removePublished(row.postId),0,'a repeated deletion finds no remaining snapshot row');
  assert.deepEqual(ids(h),['followed001']);api(h).setMode('recommended');
  assert.equal(h.feed.contains(published),false);assert.equal(h.slides().some(sl=>sl.getAttribute('data-post-id')===String(row.postId)),false);
  assert.equal(h.slides().length,original.length);original.forEach((node,i)=>assert.equal(h.slides()[i],node,'other stored recommendation nodes are preserved'));
  assert.equal(api(h).appendPublished([row],api(h).captureContext()),1,'a fresh verified published response retains the existing append behavior');
 }
});

test('only returning to Recommended refreshes public posts and its delayed response still uses the captured context guard',()=>{
 const h=harness({followingRows:[followed()]});h.button.click();const requests=h.requests.length,deliveries=[];
 h.context.KNShortsPosting={feedRows:rows=>rows,loadPublished(){const captured=api(h).captureContext();deliveries.push({captured,reply:posts=>api(h).appendPublished(posts,captured)});}};
 api(h).setMode('recommended');assert.equal(deliveries.length,0,'selecting the already active mode does not refresh');
 api(h).setMode('following');api(h).setMode('following');assert.equal(deliveries.length,0,'Following does not load the global public list');
 api(h).setMode('recommended');assert.equal(deliveries.length,1);assert.equal(deliveries[0].captured.mode,'recommended');
 api(h).setMode('recommended');assert.equal(deliveries.length,1,'same-mode selection does not issue another public refresh');
 assert.equal(h.requests.length,requests,'returning to Recommended does not start an extra YouTube request');
 api(h).setMode('following');assert.equal(deliveries.length,1);assert.equal(deliveries[0].reply([globalNative]),0);
 assert.deepEqual(ids(h),['followed001'],'a late public response cannot append into Following');
 api(h).setMode('recommended');assert.equal(deliveries.length,2);assert.equal(deliveries[1].reply([globalNative]),1);
});

test('Recommended restores the actual prior nodes, keyword, genre and scroll without a replacement request',async()=>{
 const h=harness({followingRows:[followed()]});h.search('銀行','#企業');
 await h.reply({items:[result('current0001')]});
 const nodes=h.slides().slice(),requests=h.requests.length;h.feed.scrollTop=360;
 api(h).setMode('following');assert.deepEqual(ids(h),['followed001']);
 api(h).setMode('recommended');
 assert.equal(api(h).getMode(),'recommended');assert.equal(h.context.__ksKeyword,'銀行');assert.equal(h.context.__ksTag,'#企業');
 assert.equal(h.feed.scrollTop,360);assert.equal(h.requests.length,requests);assert.equal(h.slides().length,nodes.length);
 nodes.forEach((node,i)=>assert.equal(h.slides()[i],node,'restore retains the prior recommendation node identity'));
 const current=h.slides()[0],reads=h.followingReads();api(h).setMode('recommended');
 assert.equal(h.slides()[0],current);assert.equal(h.feed.scrollTop,360);assert.equal(h.followingReads(),reads);assert.equal(h.requests.length,requests);
});

test('the existing keyword and genre fallback explicitly leave Follow and replace its recommendation snapshot',async()=>{
 for(const [keyword,genre] of [['銀行',''],['','#税金']]){
  const h=harness({followingRows:[followed()]});h.button.click();await h.reply({items:[]});
  const original=h.slides()[0];api(h).setMode('following');h.search(keyword,genre);
  assert.equal(api(h).getMode(),'recommended');assert.equal(h.slides().length,0);
  assert.equal(h.requests.length,2);if(keyword)assert.equal(new URL(h.requests[1].url).searchParams.get('q'),keyword);
  await h.reply({items:[result('current0001')]});const searched=h.slides()[0];
  assert.deepEqual(ids(h),['current0001']);assert.notEqual(searched,original);if(genre)assert.equal(searched.getAttribute('data-tag'),genre);
  api(h).setMode('following');api(h).setMode('recommended');
  assert.equal(h.slides()[0],searched,'a later tab return restores the new search, not the discarded old snapshot');
  assert.equal(h.context.__ksKeyword,keyword);assert.equal(h.context.__ksTag,genre);assert.equal(h.requests.length,2);
 }
});

test('refreshing Follow removes unfollowed rows and shows its own empty message without recommendation fallback',()=>{
 const h=harness({pool:[{id:'cachevid001',cap:'無関係なキャッシュ',tag:'#投資'}],followingRows:[followed(),followed('followed002')]});
 h.button.click();const original=h.slides()[0],requests=h.requests.length;api(h).setMode('following');
 const removed=h.slides()[0];h.setFollowing([followed('followed002')]);api(h).refreshFollowing();
 assert.deepEqual(ids(h),['followed002']);assert.equal(h.feed.contains(removed),false);assert.equal(removed.querySelector('iframe'),null);
 h.observers.forEach(io=>io.fire(removed));assert.deepEqual(ids(h),['followed002']);
 h.setFollowing([]);api(h).refreshFollowing();
 assert.equal(h.slides().length,0);assert.match(h.feed.textContent,/フォローした投稿者の動画はまだありません/);assert.equal(h.requests.length,requests);
 api(h).setMode('recommended');assert.equal(h.slides()[0],original);assert.equal(h.requests.length,requests);
});

test('context checks cover tag and mode as well as generation, keyword and visibility',()=>{
 const h=harness();h.button.click();h.context.KNShortsPosting={feedRows:rows=>rows};
 const context=api(h).captureContext();assert.equal(context.mode,'recommended');assert.equal(context.tag,'');
 assert.equal(api(h).appendPublished([globalNative],{...context,mode:'following'}),0);
 assert.equal(api(h).appendPublished([globalNative],{...context,tag:'#税金'}),0);
 h.context.__ksTag='#企業';assert.equal(api(h).appendPublished([globalNative],context),0,'a changed genre invalidates a previously captured public request');
 h.context.__ksTag='';h.close();assert.equal(api(h).appendPublished([globalNative],api(h).captureContext()),0);
});

test('a current selected-genre public response admits only that genre and invalid mode changes preserve the active list',()=>{
 const h=harness({followingRows:[followed()]});h.search('','#企業');h.context.KNShortsPosting={feedRows:rows=>rows};
 const current=api(h).captureContext();assert.equal(current.tag,'#企業');assert.equal(current.mode,'recommended');
 assert.equal(api(h).appendPublished([{...globalNative,tag:'#税金'},globalNative],current),1);
 assert.equal(h.slides().length,1);assert.equal(h.slides()[0].getAttribute('data-post-id'),'51');
 const node=h.slides()[0],requests=h.requests.length;
 assert.equal(api(h).setMode('not-a-feed'),false);assert.equal(api(h).getMode(),'recommended');
 assert.equal(h.slides()[0],node);assert.equal(h.requests.length,requests);assert.equal(api(h).refreshFollowing(),false);
});

test('fresh YouTube creator metadata reaches the bounded Following module but is stripped from the generic pool',async()=>{
 const h=harness({pool:[{id:'cachevid001',cap:'以前のキャッシュ',tag:'#投資',channelId:'UC_old',channelTitle:'保存済み投稿者',fetchedAt:1}]});
 const before=Date.now();h.button.click();assert.equal(h.remembered.length,0,'seed and generic-pool rows are not re-dated as fresh observations');
 await h.reply({items:[result('current0001',{channelId:'UC_fresh_fixture',channelTitle:'新しく確認した投稿者'})]});
 const fresh=h.remembered.flat().find(row=>row.id==='current0001');assert.ok(fresh);
 assert.equal(fresh.channelId,'UC_fresh_fixture');assert.equal(fresh.channelTitle,'新しく確認した投稿者');
 const observed=typeof fresh.fetchedAt==='number'?fresh.fetchedAt:Date.parse(fresh.fetchedAt);
 assert.ok(Number.isFinite(observed)&&observed>=before&&observed<=Date.now(),'fresh metadata carries its actual observation time');
 assert.equal(h.remembered.flat().some(row=>row.id==='cachevid001'),false);
 const persisted=JSON.parse(h.storage.get('ksPool')).find(row=>row.id==='current0001');assert.ok(persisted);
 for(const key of ['channelId','channelTitle','fetchedAt'])assert.equal(Object.hasOwn(persisted,key),false,'generic ksPool must not retain creator cache fields: '+key);
});

test('the real Following module decorates newly fetched creator rows immediately without an observer or a tab click',async()=>{
 const h=harness({realFollowing:true});
 assert.equal(h.context.MutationObserver,undefined,'the controller must explicitly hydrate inserted metadata rows');
 assert.equal(h.feed.querySelectorAll('.ks-creator-row').length,0);h.button.click();
 await h.reply({items:[result('current0001',{channelId:'UC_fresh_fixture',channelTitle:'新しく確認した投稿者'})]});
 const current=h.slides().find(sl=>sl.getAttribute('data-vid')==='current0001');assert.ok(current);
 const creator=current.querySelector('.ks-creator-row');assert.ok(creator,'creator controls appear on the actual inserted slide without selecting Recommended again');
 assert.equal(creator.querySelector('.ks-creator-name').textContent,'新しく確認した投稿者');
 const button=creator.querySelector('.ks-follow-toggle');assert.ok(button);assert.equal(button.textContent,'フォロー');
 assert.equal(button.getAttribute('aria-pressed'),'false');assert.equal(button.getAttribute('aria-label'),'新しく確認した投稿者をフォロー');
 assert.equal(h.feed.querySelectorAll('.ks-creator-row').length,1);assert.equal(api(h).getMode(),'recommended');assert.equal(h.requests.length,1);
});

test('a delayed failed YouTube search does not replace Follow with a search error or cached recommendations',async()=>{
 const h=harness({pool:[{id:'cachevid001',cap:'無関係',tag:'#投資'}],followingRows:[]});h.button.click();
 api(h).setMode('following');await h.reply({error:{reason:'fixture-unavailable'}});
 assert.equal(api(h).getMode(),'following');assert.equal(h.slides().length,0);
 assert.match(h.feed.textContent,/フォローした投稿者の動画はまだありません/);assert.doesNotMatch(h.feed.textContent,/検索結果を取得できません/);
 assert.equal(h.remembered.length,0);assert.equal(h.requests.length,1);
});

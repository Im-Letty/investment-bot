'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {create}=require('../static/shorts-following.js');
const FOLLOW='knShortsFollowing_v1',CACHE='knShortsCreatorCache_v1',DAY=86400000,START=1800000000000;
function metadata(id='video000001',channelId='channel_A',name='作り手 A',fetchedAt=START){return {id,cap:'経済の動画',tag:'#投資',channelId,channelTitle:name,fetchedAt};}
function fixture({dom=false,controller=true,initial={}}={}){
  let stamp=START;const values=new Map(Object.entries(initial)),writes=[],timers=[],events=new Map(),observers=[];
  const faults={read:false,write:false};
  const storage={getItem(key){if(faults.read===true||faults.read===key)throw new Error('read blocked');return values.has(key)?values.get(key):null;},setItem(key,value){if(faults.write===true||faults.write===key)throw new Error('quota');writes.push({key,value});values.set(key,value);}};
  class Element{
    constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.nodeType=1;this.childNodes=[];this.parentNode=null;this.attrs=new Map();this.listeners=new Map();this.hidden=false;this.tabIndex=-1;}
    get id(){return this.attrs.get('id')||'';}set id(value){this.attrs.set('id',value);}
    get className(){return this.attrs.get('class')||'';}set className(value){this.attrs.set('class',value);}
    get classList(){return {contains:value=>this.className.split(/\s+/).includes(value)};}
    get children(){return this.childNodes.filter(n=>n.nodeType===1);}
    get firstChild(){return this.childNodes[0]||null;}
    get textContent(){return this.childNodes.map(n=>n.nodeType===3?n.textContent:n.textContent).join('');}
    set textContent(value){const removed=this.childNodes;removed.forEach(n=>n.parentNode=null);this.childNodes=value===''?[]:[{nodeType:3,textContent:String(value),parentNode:this}];this.ownerDocument.notify(this,this.childNodes,removed);}
    appendChild(node){return this.insertBefore(node,null);}
    insertBefore(node,before){if(node.parentNode)node.parentNode.removeChild(node);const i=before===null?this.childNodes.length:this.childNodes.indexOf(before);assert.ok(i>=0);this.childNodes.splice(i,0,node);node.parentNode=this;this.ownerDocument.notify(this,[node],[]);return node;}
    removeChild(node){const i=this.childNodes.indexOf(node);assert.ok(i>=0);this.childNodes.splice(i,1);node.parentNode=null;this.ownerDocument.notify(this,[],[node]);return node;}
    remove(){if(this.parentNode)this.parentNode.removeChild(this);}
    setAttribute(key,value){this.attrs.set(key,String(value));}
    getAttribute(key){return this.attrs.has(key)?this.attrs.get(key):null;}
    matches(selector){return selector[0]==='.'?this.classList.contains(selector.slice(1)):selector[0]==='#'?this.id===selector.slice(1):this.tagName.toLowerCase()===selector.toLowerCase();}
    querySelectorAll(selector){const parts=selector.trim().split(/\s+/),result=[];function walk(parent){for(const child of parent.children){if(child.matches(parts.at(-1))){let at=child.parentNode,index=parts.length-2;while(index>=0&&at){if(at.matches&&at.matches(parts[index]))index--;at=at.parentNode;}if(index<0)result.push(child);}walk(child);}}walk(this);return result;}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    addEventListener(type,callback){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(callback);}
    fire(type,properties={}){const event={target:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...properties};for(const callback of this.listeners.get(type)||[])callback(event);return event;}
    click(){this.fire('click');}
    focus(){this.ownerDocument.activeElement=this;}
  }
  const document={readyState:'complete',activeElement:null,listeners:new Map(),createElement(tag){return new Element(tag,this);},getElementById(id){return this.body.id===id?this.body:this.body.querySelector('#'+id);},querySelector(selector){return this.body.querySelector(selector);},addEventListener(type,callback){this.listeners.set(type,callback);},notify(target,addedNodes,removedNodes){for(const observer of observers){let at=target;while(at&&at!==observer.target)at=at.parentNode;if(observer.target&&(target===observer.target||(observer.options.subtree&&at===observer.target)))observer.pending.push({target,addedNodes,removedNodes});}}};
  document.body=document.createElement('body');
  const calls={modes:[],refresh:0,fetch:0};let currentMode='recommended';
  const feedController={getMode(){return currentMode;},setMode(mode){if(!['following','recommended'].includes(mode))return false;calls.modes.push(mode);currentMode=mode;return true;},refreshFollowing(){if(currentMode!=='following')return false;calls.refresh++;return true;}};
  const w={localStorage:storage,Date:{now:()=>stamp},setTimeout(callback,delay){const timer={callback,delay,active:true};timers.push(timer);return timer;},clearTimeout(timer){timer.active=false;},addEventListener(type,callback){events.set(type,callback);},fetch(){calls.fetch++;throw new Error('No requests allowed');},MutationObserver:class{constructor(callback){this.callback=callback;this.pending=[];this.target=null;observers.push(this);}observe(target,options){this.target=target;this.options=options;}disconnect(){this.target=null;this.pending=[];}}};
  if(dom)w.document=document;if(controller)w.KNShortsFeed=feedController;
  function build(){const sheet=document.createElement('section');sheet.id='knShorts';const top=document.createElement('header');top.className='ks-top';const title=document.createElement('div');title.className='ks-title';title.textContent='経済 ショート';top.appendChild(title);sheet.appendChild(top);const feed=document.createElement('div');feed.id='ksFeed';sheet.appendChild(feed);document.body.appendChild(sheet);return {sheet,title,feed};}
  const nodes=dom?build():{};
  function addSlide(id,native=false){const slide=document.createElement('div');slide.className='ks-slide';slide.setAttribute(native?'data-media-type':'data-vid',native?'upload':id);const meta=document.createElement('div');meta.className='ks-meta';const cap=document.createElement('div');cap.className='ks-cap';cap.textContent='動画';meta.appendChild(cap);slide.appendChild(meta);(nodes.feed||document.getElementById('ksFeed')).appendChild(slide);return slide;}
  function flushMutations(){let rounds=0;while(observers.some(o=>o.pending.length)){assert.ok(++rounds<10,'observer must settle without a self-mutation loop');for(const observer of observers){const records=observer.pending.splice(0);if(records.length)observer.callback(records);}}return rounds;}
  function flushTimers(){let count=0;for(const timer of timers.splice(0)){if(timer.active){count++;timer.callback();}}return count;}
  return {w,document,values,writes,faults,calls,timers,observers,events,nodes,build,addSlide,flushMutations,flushTimers,feedController,setNow(value){stamp=value;},api:create(w)};
}

test('only verified creator metadata supplies follows; unknown and native rows never acquire an author',()=>{
  const h=fixture();h.api.remember([metadata(),{id:'upload:5',cap:'投稿',tag:'#投資',channelId:'channel_A',channelTitle:'作り手',fetchedAt:START},{id:'video000002',cap:'不明',tag:'#投資',fetchedAt:START}]);
  assert.deepEqual(h.api.creator('video000001'),{id:'channel_A',name:'作り手 A',following:false});assert.equal(h.api.creator('upload:5'),null);assert.equal(h.api.creator('video000002'),null);
  assert.match(h.api.emptyMessage(),/まだフォロー/);assert.deepEqual(h.api.toggle('channel_A'),{ok:true,following:true,error:null});assert.deepEqual(h.api.rows(),[metadata()]);assert.equal(h.calls.fetch,0);
});
test('creator cache retains original retrieval time and expires at thirty days',()=>{
  const h=fixture();const original=metadata();h.api.remember([original]);h.api.toggle('channel_A');h.setNow(START+29*DAY);h.api.remember(h.api.rows());assert.equal(h.api.rows()[0].fetchedAt,START);
  h.setNow(START+30*DAY);assert.deepEqual(h.api.rows(),[]);assert.equal(h.api.creator(original.id),null);assert.match(h.api.emptyMessage(),/まだありません/);h.api.remember([]);assert.deepEqual(JSON.parse(h.values.get(CACHE)).rows,[]);
});
test('opening or reading a valid expired cache physically removes expired API metadata',()=>{
  const expired=metadata('video000001','channel_A','期限切れ',START-30*DAY),fresh=metadata('video000002','channel_A','有効',START-1),h=fixture({initial:{[CACHE]:JSON.stringify({version:1,rows:[expired,fresh]}),[FOLLOW]:JSON.stringify({version:1,ids:['channel_A']})}});
  assert.deepEqual(JSON.parse(h.values.get(CACHE)).rows,[fresh]);assert.equal(h.api.creator(expired.id),null);assert.deepEqual(h.api.rows(),[fresh]);
  h.setNow(START+30*DAY);assert.deepEqual(h.api.rows(),[]);assert.deepEqual(JSON.parse(h.values.get(CACHE)).rows,[]);const writes=h.writes.length;create(h.w).rows();assert.equal(h.writes.length,writes,'already-pruned storage does not keep writing');
});
test('failed expiry deletion exposes a safe error until persistence succeeds',()=>{
  const h=fixture();h.api.remember([metadata()]);h.api.toggle('channel_A');const prior=h.values.get(CACHE);h.setNow(START+30*DAY);h.faults.write=CACHE;
  assert.deepEqual(h.api.rows(),[]);assert.equal(h.api.creator('video000001'),null);assert.equal(h.values.get(CACHE),prior);assert.match(h.api.emptyMessage(),/期限切れ.*整理できません/);assert.deepEqual(JSON.parse(h.values.get(FOLLOW)).ids,['channel_A']);
  h.faults.write=false;assert.deepEqual(h.api.rows(),[]);assert.deepEqual(JSON.parse(h.values.get(CACHE)).rows,[]);assert.match(h.api.emptyMessage(),/まだありません/);
});
test('invalid, expired, future and incomplete fresh metadata is ignored',()=>{
  const h=fixture();const bad=[metadata('short'),metadata('video000002','bad/id'),metadata('video000003','channel_C',' '),metadata('video000004','channel_D','名'.repeat(101)),metadata('video000005','channel_E','名',NaN),metadata('video000006','channel_F','名',START+1),metadata('video000007','channel_G','名',START-30*DAY),{...metadata('video000008'),cap:null}];
  assert.equal(h.api.remember(bad),0);assert.deepEqual(JSON.parse(h.values.get(CACHE)).rows,[]);assert.equal(h.api.toggle('bad/id').ok,false);
});
test('malformed follow preferences are reported and never overwritten by remember or toggle',()=>{
  const raw='{"version":1,"ids":["channel_A",42]}',h=fixture({initial:{[FOLLOW]:raw}});h.api.remember([metadata()]);assert.match(h.api.emptyMessage(),/読み込めません/);assert.equal(h.api.toggle('channel_B').ok,false);assert.equal(h.values.get(FOLLOW),raw);assert.equal(h.writes.some(v=>v.key===FOLLOW),false);
});
test('malformed creator cache remains untouched and cannot masquerade as an empty feed',()=>{
  const raw='{"version":1,"rows":[{"id":"video000001"}]}',h=fixture({initial:{[CACHE]:raw,[FOLLOW]:JSON.stringify({version:1,ids:['channel_A']})}});h.api.remember([metadata()]);assert.equal(h.values.get(CACHE),raw);assert.deepEqual(h.api.rows(),[]);assert.match(h.api.emptyMessage(),/読み込めません/);assert.equal(h.writes.length,0);
});
test('storage read failure is distinct from no follows and never causes a replacement write',()=>{
  const h=fixture();h.faults.read=true;h.api.remember([metadata()]);assert.equal(h.api.toggle('channel_A').ok,false);assert.match(h.api.emptyMessage(),/読み込めません/);assert.equal(h.writes.length,0);
});
test('failed follow writes preserve the exact prior preference and following state',()=>{
  const h=fixture();h.api.remember([metadata()]);h.api.toggle('channel_A');const prior=h.values.get(FOLLOW);h.faults.write=FOLLOW;
  const result=h.api.toggle('channel_A');assert.equal(result.ok,false);assert.equal(result.following,true);assert.match(result.error,/変更は反映していません/);assert.equal(h.values.get(FOLLOW),prior);assert.equal(h.api.creator('video000001').following,true);
});
test('each toggle and remember consult the latest preference instead of overwriting another instance',()=>{
  const h=fixture(),second=create(h.w);h.api.toggle('channel_A');second.toggle('channel_B');h.api.remember([metadata()]);assert.deepEqual(JSON.parse(h.values.get(FOLLOW)).ids,['channel_A','channel_B']);h.api.toggle('channel_A');assert.deepEqual(JSON.parse(h.values.get(FOLLOW)).ids,['channel_B']);assert.equal(second.creator('video000001').following,false);
});
test('cache is bounded to three hundred newest videos and returned rows cannot mutate it',()=>{
  const h=fixture();const all=Array.from({length:320},(_,i)=>metadata('v'+String(i).padStart(10,'0'),'channel_A','作り手',START-320+i));h.api.remember(all);h.api.toggle('channel_A');const rows=h.api.rows();assert.equal(rows.length,300);assert.equal(rows[0].id,all[319].id);rows[0].channelTitle='変更';assert.equal(h.api.creator(rows[0].id).name,'作り手');assert.equal(JSON.parse(h.values.get(CACHE)).rows.length,300);
});
test('one hundred device follows are permitted and overflow cannot change storage',()=>{
  const h=fixture();for(let i=0;i<100;i++)assert.equal(h.api.toggle('channel_'+i).ok,true);const before=h.values.get(FOLLOW);assert.equal(h.api.toggle('channel_100').ok,false);assert.equal(h.values.get(FOLLOW),before);assert.equal(h.api.toggle('channel_0').following,false);assert.equal(h.api.toggle('channel_100').following,true);
});
test('stable channel identities stay separate despite matching titles and repeated videos merge fresh metadata',()=>{
  const h=fixture();h.api.remember([metadata('video000001','channel_A','同名'),metadata('video000002','channel_B','同名')]);h.api.toggle('channel_A');assert.deepEqual(h.api.rows().map(r=>r.id),['video000001']);h.setNow(START+1);h.api.remember([metadata('video000001','channel_A','新しい名前',START+1)]);assert.equal(h.api.creator('video000001').name,'新しい名前');assert.equal(JSON.parse(h.values.get(CACHE)).rows.length,2);
});
test('follow and creator persistence never writes saved videos, recommendations or the legacy pool',()=>{
  const initial={knSaved:'saved',ksWeights:'weights',ksPool:'pool'},h=fixture({initial});h.api.remember([metadata()]);h.api.toggle('channel_A');for(const [key,value]of Object.entries(initial))assert.equal(h.values.get(key),value);assert.ok(h.writes.every(v=>[FOLLOW,CACHE].includes(v.key)));
});
test('mount creates accessible tabs and creator controls once, with names as literal text',()=>{
  const h=fixture({dom:true}),slide=h.addSlide('video000001');h.api.remember([metadata('video000001','channel_A','<img onerror="bad">')]);h.api.mount();h.api.mount();h.flushMutations();
  const following=h.document.getElementById('ksFollowingTab'),recommended=h.document.getElementById('ksRecommendedTab');assert.equal(h.nodes.title.children.length,1);assert.equal(following.getAttribute('role'),'tab');assert.equal(following.getAttribute('aria-controls'),'ksFeed');assert.equal(following.getAttribute('aria-selected'),'false');assert.equal(following.tabIndex,-1);assert.equal(recommended.tabIndex,0);assert.equal(h.nodes.feed.getAttribute('aria-labelledby'),'ksRecommendedTab');
  const meta=slide.querySelector('.ks-meta');assert.equal(meta.children[0].className,'ks-creator-row');assert.equal(meta.querySelector('.ks-creator-name').textContent,'<img onerror="bad">');assert.equal(meta.querySelector('img'),null);assert.equal(meta.querySelectorAll('.ks-follow-toggle').length,1);assert.equal(h.calls.fetch,0);
});
test('tab clicks and Arrow, Home and End keys select, focus and update roving tab stops',()=>{
  const h=fixture({dom:true});h.api.mount();const following=h.document.getElementById('ksFollowingTab'),recommended=h.document.getElementById('ksRecommendedTab');following.click();assert.equal(following.getAttribute('aria-selected'),'true');assert.equal(following.tabIndex,0);assert.equal(recommended.tabIndex,-1);
  assert.equal(following.fire('keydown',{key:'ArrowRight'}).defaultPrevented,true);assert.equal(h.document.activeElement,recommended);recommended.fire('keydown',{key:'ArrowLeft'});assert.equal(h.document.activeElement,following);following.fire('keydown',{key:'End'});assert.equal(h.document.activeElement,recommended);recommended.fire('keydown',{key:'Home'});assert.equal(h.document.activeElement,following);assert.deepEqual(h.calls.modes,['following','recommended','following','recommended','following']);assert.equal(h.calls.fetch,0);
});
test('follow buttons update all videos by that creator and rebuild only an active Following feed',()=>{
  const h=fixture({dom:true}),a=h.addSlide('video000001'),b=h.addSlide('video000002');h.api.remember([metadata(),metadata('video000002')]);h.api.mount();a.querySelector('.ks-follow-toggle').click();assert.equal(h.calls.refresh,0);assert.equal(b.querySelector('.ks-follow-toggle').getAttribute('aria-pressed'),'true');assert.equal(b.querySelector('.ks-follow-toggle').textContent,'フォロー中');h.document.getElementById('ksFollowingTab').click();b.querySelector('.ks-follow-toggle').click();assert.equal(h.calls.refresh,1);assert.equal(a.querySelector('.ks-follow-toggle').getAttribute('aria-pressed'),'false');assert.deepEqual(h.api.rows(),[]);
});
test('unfollowing from Following restores focus after refresh removes the focused author button',()=>{
  const h=fixture({dom:true}),slide=h.addSlide('video000001');h.api.remember([metadata()]);h.api.toggle('channel_A');h.api.mount();const tab=h.document.getElementById('ksFollowingTab');tab.click();const button=slide.querySelector('.ks-follow-toggle');button.focus();
  h.feedController.refreshFollowing=function(){h.calls.refresh++;slide.remove();return true;};button.click();assert.equal(slide.parentNode,null);assert.equal(h.document.activeElement,tab);assert.equal(h.calls.refresh,1);assert.equal(h.api.creator('video000001').following,false);
});
test('failed UI toggles keep button state and expose a readable live status',()=>{
  const h=fixture({dom:true}),slide=h.addSlide('video000001');h.api.remember([metadata()]);h.api.mount();h.faults.write=FOLLOW;slide.querySelector('.ks-follow-toggle').click();const status=h.document.getElementById('ksFollowStatus');assert.equal(status.hidden,false);assert.equal(status.getAttribute('role'),'status');assert.match(status.textContent,/保存できません/);assert.equal(slide.querySelector('.ks-follow-toggle').getAttribute('aria-pressed'),'false');assert.equal(h.calls.refresh,0);
});
test('fresh metadata and observed new slides hydrate without switching or refreshing the feed',()=>{
  const h=fixture({dom:true});h.api.mount();h.api.remember([metadata()]);const slide=h.addSlide('video000001');const rounds=h.flushMutations();assert.ok(rounds<=2);assert.ok(slide.querySelector('.ks-follow-toggle'));assert.deepEqual(h.calls.modes,[]);assert.equal(h.calls.refresh,0);const native=h.addSlide('upload:5',true);h.addSlide('video000002');h.flushMutations();assert.equal(native.querySelector('.ks-creator-row'),null);assert.equal(h.nodes.feed.querySelectorAll('.ks-creator-row').length,1);
});
test('late feed controller initialization uses one bounded retry and then real selection',()=>{
  const h=fixture({dom:true,controller:false});h.api.mount();h.api.mount();assert.equal(h.timers.length,1);h.document.getElementById('ksFollowingTab').click();assert.equal(h.document.getElementById('ksFollowStatus').hidden,false);h.w.KNShortsFeed=h.feedController;h.flushTimers();assert.equal(h.timers.length,0);h.document.getElementById('ksFollowingTab').click();assert.deepEqual(h.calls.modes,['following']);assert.equal(h.observers.length,1);assert.equal(h.document.getElementById('ksFollowStatus').hidden,true);
});
test('missing header retries idempotently and pagehide cancels a pending retry',()=>{
  const h=fixture();h.w.document=h.document;h.api.mount();h.api.mount();assert.equal(h.timers.length,1);Object.assign(h.nodes,h.build());h.flushTimers();assert.ok(h.document.getElementById('ksFollowingTab'));assert.equal(h.observers.length,1);
  delete h.w.KNShortsFeed;h.api.mount();assert.equal(h.timers.length,1);h.events.get('pagehide')();assert.equal(h.flushTimers(),0);
});
test('invalid preference versions and empty strings are preserved rather than reset',()=>{
  for(const raw of ['',JSON.stringify({version:2,ids:[]}),JSON.stringify({version:1,ids:['same','same']})]){const h=fixture({initial:{[FOLLOW]:raw}});h.api.remember([metadata()]);assert.equal(h.api.toggle('channel_A').ok,false);assert.equal(h.values.get(FOLLOW),raw);assert.match(h.api.emptyMessage(),/読み込めません/);}
});
test('storage events refresh an active Following feed and expired metadata removes old author controls',()=>{
  const h=fixture({dom:true}),slide=h.addSlide('video000001');h.api.remember([metadata()]);h.api.mount();h.document.getElementById('ksFollowingTab').click();h.values.set(FOLLOW,JSON.stringify({version:1,ids:['channel_A']}));h.events.get('storage')({key:FOLLOW});assert.equal(slide.querySelector('.ks-follow-toggle').getAttribute('aria-pressed'),'true');assert.equal(h.calls.refresh,1);h.setNow(START+30*DAY);h.api.modeChanged();assert.equal(slide.querySelector('.ks-creator-row'),null);
});
test('browser entry exports one mounted controller after DOM ready without network or authentication',()=>{
  const h=fixture({dom:true});h.document.readyState='loading';const source=fs.readFileSync(path.join(__dirname,'../static/shorts-following.js'),'utf8');vm.runInNewContext(source,{window:h.w});assert.equal(typeof h.w.KNShortsFollowing.remember,'function');assert.equal(h.document.getElementById('ksFollowingTab'),null);h.document.listeners.get('DOMContentLoaded')();assert.ok(h.document.getElementById('ksFollowingTab'));assert.equal(h.calls.fetch,0);
});

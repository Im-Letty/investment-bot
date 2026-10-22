'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {create}=require('../static/shorts-sharing.js');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
async function settle(){for(let i=0;i<8;i++)await Promise.resolve();}
function fixture({share,clipboard,origin='https://site.example',search='?auth=private-token&assets=90000#account',hidden=false,withFeed=true}={}){
  const observers=[],events=new Map(),timers=[],calls={share:[],copy:[],fetch:0,storage:0};
  class Element{
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attrs=new Map();this.parentNode=null;this.listeners=new Map();this._text='';this.hidden=false;this.disabled=false;}
    get className(){return this.attrs.get('class')||'';}set className(v){this.attrs.set('class',v);}
    get classList(){return {contains:name=>this.className.split(/\s+/).includes(name)};}
    get id(){return this.attrs.get('id')||'';}set id(v){this.attrs.set('id',v);}
    get isConnected(){let el=this;while(el){if(el===doc.body)return true;el=el.parentNode;}return false;}
    get textContent(){return this._text+this.children.map(el=>el.textContent).join('');}set textContent(v){this._text=String(v);this.children.forEach(x=>x.parentNode=null);this.children=[];}
    appendChild(el){this.children.push(el);el.parentNode=this;for(const o of observers){let p=this;while(p&&p!==o.target)p=p.parentNode;if(p===o.target)o.pending.push({addedNodes:[el]});}return el;}
    remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(x=>x!==this);this.parentNode=null;}}
    setAttribute(k,v){this.attrs.set(k,String(v));}getAttribute(k){return this.attrs.has(k)?this.attrs.get(k):null;}
    matches(sel){if(sel.startsWith('.'))return this.className.split(/\s+/).includes(sel.slice(1));if(sel.startsWith('#'))return this.id===sel.slice(1);return this.tagName.toLowerCase()===sel;}
    querySelectorAll(sel){const list=[];for(const x of this.children){if(x.matches(sel))list.push(x);list.push(...x.querySelectorAll(sel));}return list;}querySelector(sel){return this.querySelectorAll(sel)[0]||null;}
    addEventListener(k,f){if(!this.listeners.has(k))this.listeners.set(k,[]);this.listeners.get(k).push(f);}
    fire(k,detail={}){const e={target:this,key:'',preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...detail};for(const fn of this.listeners.get(k)||[])fn(e);return e;}
    click(){return this.fire('click');}focus(){doc.activeElement=this;}select(){this.selected=true;}
  }
  const doc={hidden,activeElement:null,createElement:tag=>new Element(tag),listeners:new Map(),addEventListener(k,f){if(!this.listeners.has(k))this.listeners.set(k,[]);this.listeners.get(k).push(f);},removeEventListener(k,f){this.listeners.set(k,(this.listeners.get(k)||[]).filter(x=>x!==f));},querySelectorAll:sel=>doc.body.querySelectorAll(sel),querySelector:sel=>doc.body.querySelector(sel),getElementById:id=>doc.body.querySelector('#'+id),fire(k,e={}){for(const fn of this.listeners.get(k)||[])fn({preventDefault(){this.prevented=true;},...e});}};doc.body=new Element('body');
  doc.createElementNS=(ns,tag)=>new Element(tag);
  const feed=new Element('div');feed.id='ksFeed';const sheet=new Element('section');sheet.id='knShorts';sheet.className='open';if(withFeed){sheet.appendChild(feed);doc.body.appendChild(sheet);}
  const w={document:doc,URL,location:{origin,href:origin+'/'+search,search,hash:'#private-data'},navigator:{},setTimeout(fn){const timer={fn,active:true};timers.push(timer);return timer;},clearTimeout(timer){timer.active=false;},addEventListener:(k,f)=>events.set(k,f),fetch(){calls.fetch++;throw new Error('no fetch');},localStorage:{getItem(){calls.storage++;throw new Error('no storage');}},MutationObserver:class{constructor(fn){this.fn=fn;this.pending=[];observers.push(this);}observe(target){this.target=target;}disconnect(){this.target=null;this.pending=[];}}};
  if(share)w.navigator.share=async value=>{calls.share.push(value);return share(value);};
  if(clipboard)w.navigator.clipboard={writeText:async value=>{calls.copy.push(value);return clipboard(value);}};
  function slide({post,video,type,title='投稿した動画'}={}){const el=new Element('div');el.className='ks-slide';if(post!==undefined)el.setAttribute('data-post-id',post);if(video!==undefined)el.setAttribute('data-vid',video);if(type)el.setAttribute('data-media-type',type);const cap=new Element('div');cap.className='ks-cap';cap.textContent=title;el.appendChild(cap);feed.appendChild(el);return el;}
  function flush(){let count=0;while(observers.some(o=>o.pending.length)){assert.ok(count++<5,'observer must settle');for(const o of observers){const records=o.pending.splice(0);if(records.length)o.fn(records);}}}
  return {w,doc,feed,sheet,calls,events,timers,slide,flush,observers,api:create(w),button:el=>el.querySelector('.ks-share-button'),manual:()=>doc.body.querySelector('.ks-share-copy-dialog'),status:()=>doc.body.querySelector('.ks-share-copy-status'),copy:()=>doc.body.querySelector('.ks-share-copy-action'),native:()=>doc.body.querySelector('.ks-share-app-action'),close:()=>doc.body.querySelector('.ks-share-copy-close')};
}
test('stable share URLs contain only an allowed origin/path/id and discard every page query/hash',()=>{
  const h=fixture();assert.equal(h.api.shareURL('post','1'),'https://site.example/shorts/1');assert.equal(h.api.shareURL('post','9007199254740991'),'https://site.example/shorts/9007199254740991');
  for(const id of ['01','0','-1','1?auth=secret','1#private','1/../../admin','9007199254740992','1e3','1.5','NaN',null,undefined])assert.equal(h.api.shareURL('post',id),null);
  assert.equal(h.api.shareURL('youtube','AAAAA_AA-AA'),'https://www.youtube.com/shorts/AAAAA_AA-AA');
  for(const id of ['x','AAAAAAAAAAA?token=secret','https://evil.example','<svg>'])assert.equal(h.api.shareURL('youtube',id),null);
  for(const origin of ['file:///secret','null','https://owner:secret@site.example'])assert.equal(fixture({origin}).api.shareURL('post','1'),null);
});
test('mount annotates valid rows once without altering the existing player, caption or saving controls',()=>{
  const h=fixture(),upload=h.slide({post:'12',type:'upload'}),youtube=h.slide({video:'AAAAAAAAAAA'}),bad=h.slide({type:'upload',video:'AAAAAAAAAAA'}),injected=h.slide({post:'0',video:'instagram:source'});
  const video=h.doc.createElement('video'),saved=h.doc.createElement('button');saved.className='ks-save';upload.appendChild(video);upload.appendChild(saved);const cap=upload.querySelector('.ks-cap');
  h.api.mount();h.api.mount();h.flush();assert.equal(upload.querySelectorAll('.ks-share-button').length,1);assert.equal(youtube.querySelectorAll('.ks-share-button').length,1);assert.equal(h.button(bad),null);assert.equal(h.button(injected),null);assert.equal(upload.children[1],video);assert.equal(upload.children[2],saved);assert.equal(upload.querySelector('.ks-cap'),cap);assert.equal(h.calls.fetch+h.calls.storage+h.calls.share.length+h.calls.copy.length,0);
  const later=h.slide({post:'13',type:'upload'});h.flush();assert.ok(h.button(later));h.flush();assert.equal(later.querySelectorAll('.ks-share-button').length,1);
});
test('first click synchronously opens a local sheet and only the explicit app action invokes native sharing',async()=>{
  const gate=deferred(),h=fixture({share:()=>gate.promise,clipboard:()=>Promise.resolve()}),slide=h.slide({post:'3',type:'upload',title:'<題> & 本文'});h.api.mount();const b=h.button(slide),event=b.click();assert.equal(event.prevented,true);assert.equal(event.stopped,true);assert.ok(h.manual());assert.equal(h.manual().querySelector('input').value,'https://site.example/shorts/3');assert.equal(h.calls.share.length+h.calls.copy.length,0);assert.equal(b.disabled,false);h.native().click();h.native().click();assert.equal(h.calls.share.length,1);assert.deepEqual(h.calls.share[0],{title:'<題> & 本文',url:'https://site.example/shorts/3'});assert.equal(h.native().disabled,true);assert.equal(h.copy().disabled,false);assert.equal(h.close().disabled,false);gate.resolve();await settle();assert.equal(h.native().disabled,false);assert.ok(h.manual());assert.equal(h.calls.fetch+h.calls.storage,0);
});
test('the production observer throttle may discard mutation records without losing async share controls',()=>{
  const h=fixture();h.api.mount();const slide=h.slide({post:'42',type:'upload'});h.observers[0].fn([]);assert.ok(h.button(slide));h.flush();h.observers[0].fn([]);assert.equal(slide.querySelectorAll('.ks-share-button').length,1);
});
test('head defer waits through interactive until the earlier inline DOMContentLoaded feed initializer runs',()=>{
  const h=fixture({withFeed:false});h.doc.readyState='interactive';const slide=h.slide({post:'41'});h.doc.addEventListener('DOMContentLoaded',()=>{h.sheet.appendChild(h.feed);h.doc.body.appendChild(h.sheet);});
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../static/shorts-sharing.js'),'utf8'),{window:h.w,WeakSet,Array,Number,String});
  assert.equal(h.button(slide),null);assert.equal(h.observers.length,0);h.doc.fire('DOMContentLoaded');assert.ok(h.button(slide));assert.ok(h.observers.some(o=>o.target===h.feed));const later=h.slide({post:'43'});h.observers.find(o=>o.target===h.feed).fn([]);assert.ok(h.button(later));
});
test('a feed created after DOM ready is discovered once and its discovery observer disconnects',()=>{
  const h=fixture({withFeed:false}),slide=h.slide({post:'44'});h.api.mount();const discovery=h.observers.find(o=>o.target===h.doc.body);assert.ok(discovery);h.sheet.appendChild(h.feed);h.doc.body.appendChild(h.sheet);discovery.fn([]);h.flush();assert.equal(discovery.target,null);assert.ok(h.button(slide));assert.ok(h.observers.some(o=>o.target===h.feed));const later=h.slide({post:'45'});h.flush();assert.ok(h.button(later));assert.equal(later.querySelectorAll('.ks-share-button').length,1);
});
test('user cancelling native sharing silently leaves the local URL available without copying',async()=>{
  const h=fixture({share:()=>Promise.reject({name:'AbortError'}),clipboard:()=>Promise.resolve()}),slide=h.slide({post:'4'});h.api.mount();h.button(slide).click();const before=h.status().textContent;h.native().click();await settle();assert.equal(h.calls.copy.length,0);assert.ok(h.manual());assert.equal(h.status().textContent,before);assert.equal(h.native().disabled,false);
});
test('copy is a second explicit action and success is reported only after the clipboard write',async()=>{
  const gate=deferred(),h=fixture({clipboard:()=>gate.promise}),slide=h.slide({video:'AAAAAAAAAAA'});h.api.mount();h.button(slide).click();assert.equal(h.calls.copy.length,0);assert.equal(h.native(),null);h.copy().click();assert.deepEqual(h.calls.copy,['https://www.youtube.com/shorts/AAAAAAAAAAA']);assert.doesNotMatch(h.status().textContent,/コピーしました/);assert.equal(h.copy().disabled,true);assert.equal(h.close().disabled,false);assert.equal(h.manual().querySelector('input').readOnly,true);gate.resolve();await settle();assert.match(h.status().textContent,/コピーしました/);assert.ok(h.manual());assert.equal(h.copy().disabled,false);
});
test('clipboard failure offers a readonly selected link, keyboard containment, Escape and focus return',async()=>{
  const h=fixture({clipboard:()=>Promise.reject(new Error('denied'))}),slide=h.slide({post:'8'});h.api.mount();const b=h.button(slide);b.click();h.copy().click();await settle();const dialog=h.manual(),input=dialog.querySelector('input'),close=h.close(),overlay=dialog.parentNode;assert.equal(dialog.getAttribute('role'),'dialog');assert.equal(input.value,'https://site.example/shorts/8');assert.equal(input.readOnly,true);assert.equal(input.selected,true);assert.match(h.status().textContent,/コピーできませんでした/);assert.equal(h.doc.activeElement,input);overlay.fire('keydown',{key:'Tab',shiftKey:true});assert.equal(h.doc.activeElement,close);overlay.fire('keydown',{key:'Tab',shiftKey:false});assert.equal(h.doc.activeElement,input);const event=overlay.fire('keydown',{key:'Escape'});assert.equal(event.stopped,true);assert.equal(h.manual(),null);assert.equal(h.doc.activeElement,b);assert.equal(h.calls.share.length,0);assert.doesNotMatch(h.doc.body.textContent,/denied/);
});
test('native failure does not auto-copy and browsers without either API can manually select the URL',async()=>{
  const h=fixture({share:()=>Promise.reject({name:'NotAllowedError'}),clipboard:()=>Promise.resolve()}),slide=h.slide({post:'9'});h.api.mount();h.button(slide).click();h.native().click();await settle();assert.equal(h.calls.copy.length,0);assert.ok(h.manual());assert.equal(h.calls.share.length,1);assert.match(h.status().textContent,/共有先を開けません/);assert.equal(h.copy().disabled,false);
  const plain=fixture(),s=plain.slide({post:'10'});plain.api.mount();plain.button(s).click();assert.ok(plain.manual());assert.equal(plain.native(),null);plain.copy().click();assert.equal(plain.manual().querySelector('input').selected,true);assert.match(plain.status().textContent,/選択してコピー/);
});
test('standalone viewer shares with the same fixed post identity without requiring a feed',async()=>{
  const h=fixture({withFeed:false,clipboard:()=>Promise.resolve()}),button=h.doc.createElement('button'),viewer=h.doc.createElement('main');viewer.className='ks-share-viewer';button.className='ks-share-button';button.setAttribute('data-share-provider','post');button.setAttribute('data-post-id','11');button.setAttribute('data-share-title','共有する動画');viewer.appendChild(button);h.doc.body.appendChild(viewer);h.api.mount();button.click();assert.equal(h.calls.copy.length,0);assert.equal(h.manual().querySelector('input').value,'https://site.example/shorts/11');h.copy().click();await settle();assert.deepEqual(h.calls.copy,['https://site.example/shorts/11']);
});
test('closing the feed blocks late failures and closes an existing manual dialog without focus to hidden controls',async()=>{
  for(const native of [false,true]){const gate=deferred(),h=fixture(native?{share:()=>gate.promise}:{clipboard:()=>gate.promise}),slide=h.slide({post:'31'});h.api.mount();h.button(slide).click();(native?h.native():h.copy()).click();h.sheet.className='';h.observers.find(o=>o.target===h.sheet).fn([]);gate.reject(new Error('late failure'));await settle();assert.equal(h.manual(),null);assert.equal(h.status(),null);assert.equal(h.button(slide).disabled,false);}
  const h=fixture(),slide=h.slide({post:'32'});h.api.mount();h.button(slide).click();await settle();const input=h.manual().querySelector('input');h.sheet.className='';h.observers.find(o=>o.target===h.sheet).fn([]);assert.equal(h.manual(),null);assert.notEqual(h.doc.activeElement,h.button(slide));assert.equal(input.isConnected,false);
});
test('close/reopen invalidates old jobs and an old finally cannot unlock a newer pending share',async()=>{
  const first=deferred(),second=deferred();let attempt=0;const h=fixture({clipboard:()=>++attempt===1?first.promise:second.promise}),slide=h.slide({post:'33'});h.api.mount();const button=h.button(slide);button.click();h.copy().click();h.sheet.className='';h.observers.find(o=>o.target===h.sheet).fn([]);h.sheet.className='open';h.observers.find(o=>o.target===h.sheet).fn([]);button.click();h.copy().click();assert.equal(h.calls.copy.length,2);const before=h.status().textContent;first.reject(new Error('old'));await settle();assert.ok(h.manual());assert.equal(h.copy().disabled,true);assert.equal(h.status().textContent,before);second.resolve();await settle();assert.equal(h.copy().disabled,false);assert.match(h.status().textContent,/コピーしました/);
});
test('another bottom-nav destination invalidates before a throttled observer can miss a brief closed pane',async()=>{
  const gate=deferred(),h=fixture({clipboard:()=>gate.promise}),slide=h.slide({post:'34'}),nav=h.doc.createElement('nav'),other=h.doc.createElement('button');nav.id='knBottomNav';other.setAttribute('data-act','morning');nav.appendChild(other);h.doc.body.appendChild(nav);h.api.mount();h.button(slide).click();h.copy().click();h.doc.fire('click',{target:other});h.sheet.className='';h.sheet.className='open';gate.reject(new Error('old'));await settle();assert.equal(h.manual(),null);assert.equal(h.button(slide).disabled,false);
});
test('page exit or detached controls prevent late clipboard errors from reopening a dialog',async()=>{
  for(const mode of ['pagehide','detached','hidden']){const gate=deferred(),h=fixture({clipboard:()=>gate.promise}),slide=h.slide({post:'12'});h.api.mount();h.button(slide).click();h.copy().click();if(mode==='pagehide')h.events.get('pagehide')();if(mode==='detached'){slide.remove();h.observers.find(o=>o.target===h.feed).fn([]);}if(mode==='hidden'){h.doc.hidden=true;h.doc.fire('visibilitychange');}gate.reject(new Error('late'));await settle();assert.equal(h.manual(),null);assert.equal(h.status(),null);}
});
test('invalid mutated ids and hidden documents cannot trigger a native or clipboard action',async()=>{
  const h=fixture({share:()=>Promise.resolve(),clipboard:()=>Promise.resolve()}),slide=h.slide({post:'13'});h.api.mount();const b=h.button(slide);b.setAttribute('data-post-id','13?secret=private');b.click();assert.equal(h.manual(),null);h.doc.hidden=true;b.setAttribute('data-post-id','13');b.click();await settle();assert.equal(h.calls.share.length+h.calls.copy.length,0);assert.equal(h.manual(),null);
});
test('loader is separate and rendering/playback scripts remain at the published revision',()=>{
  const root=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');assert.equal((root.match(/shorts-sharing\.js\?v=20261022-hybrid2/g)||[]).length,1);assert.equal((root.match(/shorts-sharing\.css\?v=20261022-hybrid2/g)||[]).length,1);assert.match(root,/shorts-player\.js\?v=20261014-loading1/);assert.doesNotMatch(root,/shorts-social\.js/);
  const css=fs.readFileSync(require('node:path').join(__dirname,'../static/shorts-sharing.css'),'utf8');assert.match(css,/width:44px;height:44px/);assert.match(css,/white-space:pre-wrap;overflow-wrap:anywhere/);
});
test('pending browser APIs never hide the readonly URL or prevent closing and reopening the local sheet',async()=>{
  for(const native of [false,true]){
    const old=deferred(),h=fixture(native?{share:()=>old.promise}:{clipboard:()=>old.promise}),slide=h.slide({post:'60'});h.api.mount();const origin=h.button(slide);origin.click();const first=h.manual(),input=first.querySelector('input');(native?h.native():h.copy()).click();assert.equal(input.value,'https://site.example/shorts/60');assert.equal(input.readOnly,true);assert.equal(h.close().disabled,false);assert.equal(origin.disabled,false);input.click();assert.equal(input.selected,true);h.close().click();assert.equal(h.manual(),null);assert.equal(h.doc.activeElement,origin);origin.click();const second=h.manual(),before=h.status().textContent;assert.notEqual(first,second);assert.equal(h.copy().disabled,false);if(native)assert.equal(h.native().disabled,false);old.reject(new Error('old pending operation'));await settle();assert.equal(h.manual(),second);assert.equal(h.status().textContent,before);assert.equal(h.copy().disabled,false);
  }
});

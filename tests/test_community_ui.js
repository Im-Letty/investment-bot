'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../static/community.js');

function harness({logged=true,storage=new Map(),language='ja'}={}) {
  const calls=[],pending=[],timers=new Map(),events=new Map();let timerId=0,authPrompts=0,prepared=0;
  function attrName(key){return 'data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());}
  function matches(node,selector){
    const tag=selector.match(/^[a-z]+/i)?.[0];if(tag&&node.tagName!==tag.toUpperCase())return false;
    for(const [,cls] of selector.matchAll(/\.([\w-]+)/g))if(!node.classList.contains(cls))return false;
    for(const [,id] of selector.matchAll(/#([\w-]+)/g))if(node.id!==id)return false;
    for(const [,key,,value] of selector.matchAll(/\[([\w-]+)(?:=(['"]?)([^\]'"\s]+)\2)?\]/g))if(value===undefined?node.getAttribute(key)===null:node.getAttribute(key)!==value)return false;
    return true;
  }
  class Node {
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.dataset={};this.attrs={};this.events=new Map();this.style={};this._text='';this._classes=new Set();this.value='';this.hidden=false;this.disabled=false;this.scrollTop=0;this.selectionStart=0;this.selectionEnd=0;
      this.classList={add:(...names)=>names.forEach(n=>this._classes.add(n)),remove:(...names)=>names.forEach(n=>this._classes.delete(n)),contains:n=>this._classes.has(n),toggle:(n,on)=>{on=on===undefined?!this._classes.has(n):on;if(on)this._classes.add(n);else this._classes.delete(n);return on;}};
    }
    set className(value){this._classes=new Set(value.split(/\s+/).filter(Boolean));}get className(){return [...this._classes].join(' ');}
    set id(value){this.attrs.id=value;}get id(){return this.attrs.id||'';}
    set textContent(value){this._text=String(value);this.children.forEach(child=>child.parentNode=null);this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
    set innerHTML(_){throw new Error('Community must use text nodes, not innerHTML');}
    get firstElementChild(){return this.children[0]||null;}get lastElementChild(){return this.children.at(-1)||null;}
    get isConnected(){return this===document.body||!!this.parentNode?.isConnected;}
    setAttribute(key,value){this.attrs[key]=String(value);}getAttribute(key){if(key.startsWith('data-')){const item=Object.entries(this.dataset).find(([k])=>attrName(k)===key);if(item)return String(item[1]);}return this.attrs[key]??null;}
    appendChild(node){node.parentNode?.removeChild(node);node.parentNode=this;this.children.push(node);return node;}
    insertBefore(node,before){node.parentNode?.removeChild(node);node.parentNode=this;this.children.splice(this.children.indexOf(before),0,node);return node;}
    removeChild(node){this.children.splice(this.children.indexOf(node),1);node.parentNode=null;return node;}
    remove(){this.parentNode?.removeChild(this);}
    replaceChildren(...nodes){this.children.forEach(child=>child.parentNode=null);this.children=[];this._text='';nodes.forEach(node=>this.appendChild(node));}
    contains(node){return node===this||this.children.some(child=>child.contains(node));}
    addEventListener(name,fn){if(!this.events.has(name))this.events.set(name,[]);this.events.get(name).push(fn);}
    removeEventListener(name,fn){this.events.set(name,(this.events.get(name)||[]).filter(item=>item!==fn));}
    emit(name,event={}){const data={target:this,preventDefault(){},...event};for(const fn of this.events.get(name)||[])fn(data);}
    click(){if(!this.disabled)this.emit('click');}
    focus(){document.activeElement=this;}setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
    getBoundingClientRect(){return {top:0,bottom:100,height:100};}
    querySelectorAll(selector){const result=[];function walk(node){for(const child of node.children){if(matches(child,selector))result.push(child);walk(child);}}walk(this);return result;}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    showModal(){this.open=true;}close(){this.open=false;this.emit('close');}
  }
  const document={hidden:false,activeElement:null,documentElement:{lang:language},createElement:tag=>new Node(tag),body:new Node('body'),getElementById(id){return this.body.querySelector('#'+id);},querySelector(selector){return this.body.querySelector(selector);},addEventListener(name,fn){if(!events.has(name))events.set(name,[]);events.get(name).push(fn);},removeEventListener(name,fn){events.set(name,(events.get(name)||[]).filter(item=>item!==fn));},emit(name){for(const fn of events.get(name)||[])fn();}};
  const morning=new Node('section');morning.id='morning-section';morning.scrollTop=177;document.body.appendChild(morning);
  const hub=new Node('div');hub.id='knMyTalkHub';hub.style.display='none';document.body.appendChild(hub);
  const nav=new Node('nav');nav.id='knBottomNav';document.body.appendChild(nav);
  const morningButton=new Node('button');morningButton.setAttribute('data-act','morning');morningButton.addEventListener('click',()=>morning.scrollTop=0);nav.appendChild(morningButton);
  const window={document,AbortController,crypto:{randomUUID:()=>`10000000-0000-4000-8000-${String(++timerId).padStart(12,'0')}`},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},setInterval(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearInterval(id){timers.delete(id);},knPrepareTalkScreen(){prepared++;},knRequireAuth(){if(!logged)authPrompts++;return logged;},openAuth(){authPrompts++;},sb:{auth:{getSession:async()=>({data:{session:logged?{access_token:'local-fixture-token'}:null}})}},fetch(url,options){calls.push({url,options});return new Promise((resolve,reject)=>pending.push({url,options,resolve,reject}));}};
  const ui=create(window);
  async function settle(){await new Promise(resolve=>setImmediate(resolve));}
  async function response(data,status=200,index=0){await settle();assert.ok(pending[index],'a request is queued');const [request]=pending.splice(index,1);request.resolve({ok:status<400,status,json:async()=>data});await settle();return request;}
  function nodes(selector){return document.body.querySelectorAll(selector);}function node(selector){const result=document.body.querySelector(selector);assert.ok(result,selector);return result;}
  return {ui,window,document,calls,pending,storage,timers,hub,morning,node,nodes,response,settle,authPrompts:()=>authPrompts,prepared:()=>prepared};
}
const post=(id,extra={})=>({id,name:'表示例',body:'表示用の投稿',category:'economy',language:'ja',created_at:'2026-10-12T00:00:00Z',parent_id:null,reply_count:0,like_count:0,is_mine:false,liked_by_me:false,...extra});

test('public entrance is prepared before loading; guest GET never prompts login',async()=>{
  const h=harness({logged:false});h.ui.open();assert.equal(h.prepared(),1);assert.equal(h.authPrompts(),0);await h.settle();assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.headers,undefined);assert.equal(h.node('.cw-title').textContent,'コミュニティ');
});
test('empty, loading and unavailable are different states',async()=>{
  const h=harness();h.ui.open();assert.equal(h.node('.cw-state').hidden,false);assert.equal(h.nodes('.cw-state')[1].hidden,true);await h.response({ok:false,reason:'storage_unavailable'},503);
  assert.match(h.node('.cw-error-state').textContent,/準備中/);assert.equal(h.node('.cw-error-state').hidden,false);assert.equal(h.nodes('.cw-state')[1].hidden,true);
  h.node('.cw-error-state').querySelector('button').click();await h.response({ok:true,posts:[],has_more:false,next_cursor:null});assert.equal(h.nodes('.cw-state')[1].hidden,false);assert.equal(h.node('.cw-error-state').hidden,true);
});
test('existing session is sent on reads; ownership comes from server flags, never names',async()=>{
  const h=harness();h.ui.open();await h.response({ok:true,posts:[post(3,{is_mine:true,liked_by_me:true}),post(2,{name:'表示例'})],has_more:false});
  assert.equal(h.calls[0].options.headers.Authorization,'Bearer local-fixture-token');assert.equal(h.nodes('.cw-delete').length,1);assert.equal(h.nodes('.cw-like')[0].getAttribute('aria-pressed'),'true');
});
test('older category response cannot replace the selected category',async()=>{
  const h=harness();h.ui.open();await h.settle();h.nodes('.cw-category')[2].click();await h.settle();assert.equal(h.calls[0].options.signal.aborted,true);
  await h.response({ok:true,posts:[post(9,{body:'古いカテゴリの返答'})],has_more:false},200,0);assert.equal(h.nodes('.cw-post').length,0);
  await h.response({ok:true,posts:[post(8,{category:'news',body:'新しいカテゴリの返答'})],has_more:false});assert.equal(h.nodes('.cw-post-body')[0].textContent,'新しいカテゴリの返答');
});
test('post body is text; paging appends without moving reading position',async()=>{
  const h=harness();h.ui.open();await h.response({ok:true,posts:[post(4,{body:'<img src=x onerror=alert(1)>'})],has_more:true,next_cursor:4});
  assert.equal(h.nodes('.cw-post-body')[0].textContent,'<img src=x onerror=alert(1)>');h.node('.cw-scroll').scrollTop=345;h.node('.cw-more').click();await h.response({ok:true,posts:[post(3)],has_more:false,next_cursor:null});assert.equal(h.nodes('.cw-post').length,2);assert.equal(h.node('.cw-scroll').scrollTop,345);assert.match(h.calls.at(-1).url,/before=4/);
});
test('new posts do not move the feed; accepting them updates paging cursor',async()=>{
  const h=harness();h.ui.open();await h.response({ok:true,posts:[],has_more:false});h.node('.cw-scroll').scrollTop=88;
  [...h.timers.values()][0].fn();await h.response({ok:true,posts:[post(21)],has_more:true,next_cursor:21});assert.equal(h.nodes('.cw-post').length,0);assert.equal(h.node('.cw-new-posts').hidden,false);assert.equal(h.node('.cw-scroll').scrollTop,88);
  h.node('.cw-new-posts').click();assert.equal(h.nodes('.cw-post').length,1);assert.equal(h.node('.cw-more').hidden,false);h.node('.cw-more').click();await h.settle();assert.match(h.calls.at(-1).url,/before=21/);
});
test('poll removes deleted head posts and updates like flags without clearing older pages',async()=>{
  const h=harness();h.ui.open();await h.response({ok:true,posts:[post(30),post(29)],has_more:true,next_cursor:29});h.node('.cw-more').click();await h.response({ok:true,posts:[post(10)],has_more:false});
  [...h.timers.values()][0].fn();await h.response({ok:true,posts:[post(30,{like_count:2,liked_by_me:true})],has_more:true,next_cursor:30});assert.deepEqual(h.nodes('.cw-post').map(n=>n.dataset.postId),['30','29','10']);
  // The first unseen boundary is ambiguous; only remove IDs in the observed head range.
  [...h.timers.values()][0].fn();await h.response({ok:true,posts:[post(30,{like_count:2,liked_by_me:true}),post(28)],has_more:true,next_cursor:28});assert.deepEqual(h.nodes('.cw-post').map(n=>n.dataset.postId),['30','10']);assert.equal(h.nodes('.cw-like')[0].getAttribute('aria-pressed'),'true');
});
test('unknown-result retry keeps UUID across close and reopen and blocks double submit',async()=>{
  const h=harness();h.ui.open();await h.response({ok:true,posts:[],has_more:false});const input=h.node('#cmInput');input.value='再送する内容';input.emit('input');h.ui.send();h.ui.send();await h.settle();assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1);const first=JSON.parse(h.calls.at(-1).options.body);
  const failed=h.pending.shift();failed.reject(new Error('connection lost'));await h.settle();h.ui.close();h.ui.open();await h.response({ok:true,posts:[post(50,{body:first.body,is_mine:true})],has_more:false});assert.equal(h.node('#cmInput').value,'再送する内容');h.ui.send();await h.settle();const second=JSON.parse(h.calls.at(-1).options.body);assert.equal(first.request_id,second.request_id);assert.equal(second.parent_id,null);
  await h.response({ok:true,post:post(50,{body:second.body,is_mine:true})});assert.equal(h.node('#cmInput').value,'');assert.equal(h.nodes('.cw-post').length,1);
});
test('drafts stay with their topic and close only cleans up, while Back returns to Talk',async()=>{
  const h=harness();h.ui.open();await h.response({ok:true,posts:[],has_more:false});h.node('#cmInput').value='全体の下書き';h.node('#cmInput').emit('input');h.nodes('.cw-category')[1].click();await h.response({ok:true,posts:[],has_more:false});h.node('#cmInput').value='経済の下書き';h.node('#cmInput').emit('input');h.nodes('.cw-category')[0].click();await h.response({ok:true,posts:[],has_more:false});assert.equal(h.node('#cmInput').value,'全体の下書き');h.ui.close();assert.equal(h.hub.style.display,'none');assert.equal(h.timers.size,0);assert.equal(h.document.getElementById('cmOv'),null);
  h.ui.open();await h.response({ok:true,posts:[],has_more:false});h.node('.cw-back').click();assert.equal(h.hub.style.display,'block');
});
test('guest report prompts login before opening a native modal',async()=>{
  const h=harness({logged:false});h.ui.open();await h.response({ok:true,posts:[post(1)],has_more:false});h.node('.cw-menu-item').click();await h.settle();assert.equal(h.authPrompts(),1);assert.equal(h.nodes('dialog').length,0);assert.equal(h.calls.length,1);
});
test('reply writes to the parent topic and server-owned replies can be deleted',async()=>{
  const h=harness();h.ui.open();await h.response({ok:true,posts:[post(7,{category:'life'})],has_more:false});h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[],has_more:false});const field=h.node('.cw-reply-form').querySelector('textarea');field.value='返信例';field.emit('input');h.node('.cw-reply-form').emit('submit');await h.settle();const payload=JSON.parse(h.calls.at(-1).options.body);assert.equal(payload.parent_id,7);assert.equal(payload.category,'life');
  await h.response({ok:true,post:post(8,{parent_id:7,category:'life',body:'返信例',is_mine:true})});assert.equal(h.nodes('.cw-reply-post').length,1);assert.equal(h.nodes('.cw-delete').length,1);
});
test('legacy conversations remain readonly and never appear under topic filters',async()=>{
  const h=harness();h.ui.open();await h.response({ok:true,posts:[],has_more:false});const archive=h.node('.cw-archive');archive.open=true;archive.emit('toggle');await h.response({ok:true,messages:[{id:1,name:'以前の名前',body:'以前の会話',created_at:'2026-10-10T00:00:00Z'}]});assert.equal(h.nodes('.cw-legacy-post').length,1);assert.equal(h.node('.cw-legacy-post').querySelector('button'),null);h.nodes('.cw-category')[1].click();await h.response({ok:true,posts:[],has_more:false});assert.equal(archive.hidden,true);
});
test('language change uses English fallback without translating user content',async()=>{
  const h=harness();h.ui.open();await h.response({ok:true,posts:[post(2,{body:'ニュース',name:'ニュース'})],has_more:false});h.document.documentElement.lang='en';h.document.emit('langChanged');assert.equal(h.node('.cw-title').textContent,'Community');assert.equal(h.nodes('.cw-category')[2].textContent,'News');assert.equal(h.node('.cw-post-body').textContent,'ニュース');assert.equal(h.node('.cw-author').textContent,'ニュース');assert.match(h.node('.cw-post-date').textContent,/Posted/);
  h.document.documentElement.lang='ko';h.document.emit('langChanged');assert.equal(h.node('.cw-title').textContent,'Community');
});
test('close button restores the original morning scroll position',async()=>{
  const h=harness();h.ui.open();await h.response({ok:true,posts:[],has_more:false});h.node('.cw-close').click();assert.equal(h.morning.scrollTop,177);assert.equal(h.document.getElementById('cmOv'),null);
});
test('expired optional read token falls back once to public reading without a login prompt',async()=>{
  const h=harness();h.ui.open();await h.response({ok:false,reason:'auth_required'},401);assert.equal(h.calls.length,2);assert.equal(h.calls[1].options.headers.Authorization,undefined);assert.equal(h.authPrompts(),0);await h.response({ok:true,posts:[post(3)],has_more:false});assert.equal(h.nodes('.cw-post').length,1);
});
test('opening Community hides both historical Talk entrances',async()=>{
  const h=harness();h.hub.style.display='block';const other=h.document.createElement('div');other.id='talkHubOv';other.classList.add('open');h.document.body.appendChild(other);h.ui.open();await h.response({ok:true,posts:[],has_more:false});assert.equal(h.hub.style.display,'none');assert.equal(other.classList.contains('open'),false);
});
test('in-flight poll cannot overwrite a successful like action',async()=>{
  const h=harness();h.ui.open();await h.response({ok:true,posts:[post(3)],has_more:false});[...h.timers.values()][0].fn();await h.settle();h.node('.cw-like').click();await h.settle();assert.equal(h.pending.length,2);
  await h.response({ok:true,liked:true,like_count:1},200,1);await h.response({ok:true,posts:[post(3)],has_more:false},200,0);assert.equal(h.node('.cw-like').getAttribute('aria-pressed'),'true');assert.equal(h.node('.cw-action-count').textContent,'1');
});
test('reopening replies refreshes the conversation while retaining a reply draft',async()=>{
  const h=harness();h.ui.open();await h.response({ok:true,posts:[post(3,{reply_count:1})],has_more:false});h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[post(4,{parent_id:3})],has_more:false});let input=h.node('.cw-reply-form').querySelector('textarea');input.value='書きかけ';input.emit('input');h.node('.cw-reply-toggle').click();h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[post(5,{parent_id:3,body:'新しい返信'})],has_more:false});assert.equal(h.node('.cw-reply-form').querySelector('textarea').value,'書きかけ');assert.equal(h.node('.cw-reply-post').querySelector('.cw-post-body').textContent,'新しい返信');
});
test('an old initial GET cannot erase a successfully published draft',async()=>{
  const h=harness();h.ui.open();await h.settle();h.node('#cmInput').value='取得前に投稿';h.node('#cmInput').emit('input');h.ui.send();await h.settle();assert.equal(h.pending.length,2);
  const body=JSON.parse(h.calls.at(-1).options.body);await h.response({ok:true,post:post(40,{body:body.body,is_mine:true})},200,1);assert.equal(h.nodes('.cw-post').length,1);
  await h.response({ok:true,posts:[],has_more:false},200,0);assert.equal(h.nodes('.cw-post').length,1);assert.equal(h.pending.length,1,'one fresh GET follows the discarded result');
  await h.response({ok:true,posts:[post(40,{body:body.body,is_mine:true})],has_more:false});assert.equal(h.nodes('.cw-post').length,1);assert.equal(h.pending.length,0);
});
test('an old replies GET cannot erase a reply; refresh waits for its write to settle',async()=>{
  const h=harness();h.ui.open();await h.response({ok:true,posts:[post(40,{category:'news'})],has_more:false});h.node('.cw-reply-toggle').click();await h.settle();let input=h.node('.cw-reply-form').querySelector('textarea');input.value='読み込み中の返信';input.emit('input');h.node('.cw-reply-form').emit('submit');await h.settle();assert.equal(h.pending.length,2);
  await h.response({ok:true,posts:[],has_more:false},200,0);assert.equal(h.pending.length,1,'no fresh GET while POST is pending');
  await h.response({ok:true,post:post(41,{category:'news',parent_id:40,body:'読み込み中の返信',is_mine:true})});assert.equal(h.nodes('.cw-reply-post').length,1);assert.equal(h.pending.length,1);
  await h.response({ok:true,posts:[post(41,{category:'news',parent_id:40,body:'読み込み中の返信',is_mine:true})],has_more:false});assert.equal(h.nodes('.cw-reply-post').length,1);assert.equal(h.pending.length,0);
});
test('idempotent reply response upserts an already visible reply without inflating its count',async()=>{
  const h=harness();h.ui.open();await h.response({ok:true,posts:[post(40,{reply_count:1})],has_more:false});h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[post(41,{parent_id:40,body:'保存済みの返信',is_mine:true})],has_more:false});const input=h.node('.cw-reply-form').querySelector('textarea');input.value='保存済みの返信';input.emit('input');h.node('.cw-reply-form').emit('submit');await h.response({ok:true,post:post(41,{parent_id:40,body:'保存済みの返信',is_mine:true})});assert.equal(h.nodes('.cw-reply-post').length,1);assert.equal(h.node('.cw-reply-toggle').querySelector('.cw-action-count').textContent,'1');
});

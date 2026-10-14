'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../static/community.js');

function harness({logged=true,storage=new Map(),language='ja',config}={}) {
  const calls=[],pending=[],timers=new Map(),timeouts=new Map(),events=new Map();let timerId=0,authPrompts=0,prepared=0;
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
    get lastChild(){return this.children.at(-1)||null;}get firstElementChild(){return this.children[0]||null;}get lastElementChild(){return this.children.at(-1)||null;}
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
  const window={document,AbortController,crypto:{randomUUID:()=>`10000000-0000-4000-8000-${String(++timerId).padStart(12,'0')}`},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},setInterval(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearInterval(id){timers.delete(id);},setTimeout(fn,ms){const id=++timerId;timeouts.set(id,{fn,ms});return id;},clearTimeout(id){timeouts.delete(id);},knPrepareTalkScreen(){prepared++;},knRequireAuth(){if(!logged)authPrompts++;return logged;},openAuth(){authPrompts++;},sb:{auth:{getSession:async()=>({data:{session:logged?{access_token:'local-fixture-token'}:null}})}},fetch(url,options){calls.push({url,options});return new Promise((resolve,reject)=>pending.push({url,options,resolve,reject}));}};
  const ui=create(window,config);
  async function settle(){await new Promise(resolve=>setImmediate(resolve));}
  async function runTimeouts(){const queued=[...timeouts.entries()];for(const [id,timer] of queued){if(timeouts.delete(id))timer.fn();}await settle();}
  async function response(data,status=200,index=0){await settle();assert.ok(pending[index],'a request is queued');const [request]=pending.splice(index,1);request.resolve({ok:status<400,status,json:async()=>data});await settle();return request;}
  function nodes(selector){return document.body.querySelectorAll(selector);}function node(selector){const result=document.body.querySelector(selector);assert.ok(result,selector);return result;}
  return {ui,window,document,calls,pending,storage,timers,timeouts,runTimeouts,events,hub,morning,node,nodes,response,settle,authPrompts:()=>authPrompts,prepared:()=>prepared};
}
const post=(id,extra={})=>({id,name:'表示例',body:'表示用の投稿',category:'economy',language:'ja',created_at:'2026-10-12T00:00:00Z',parent_id:null,reply_count:0,like_count:0,is_mine:false,liked_by_me:false,...extra});
function paired(h){
  h.window.KNCommunity=h.ui;h.window.openCommunity=h.ui.open;
  const stock=create(h.window,{stock:true,categories:[['stock:7203','トヨタ 7203'],['stock:6758','ソニー 6758']]});
  h.window.KNStockTalk=stock;h.window.openStockTalk=stock.open;return stock;
}

test('public entrance is prepared before loading; guest GET never prompts login',async()=>{
  const h=harness({logged:false});h.ui.open();assert.equal(h.prepared(),1);assert.equal(h.authPrompts(),0);await h.settle();assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.headers,undefined);assert.equal(h.node('.cw-title').textContent,'トーク');assert.equal(h.node('#cmOv').getAttribute('aria-label'),'コミュニティ');
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
test('older stock room response cannot replace the selected company',async()=>{
  const h=harness({config:{stock:true,categories:[['stock:7203','トヨタ 7203'],['stock:6758','ソニー 6758']]}});h.ui.open();await h.settle();h.nodes('.cw-category')[1].click();await h.settle();assert.equal(h.calls[0].options.signal.aborted,true);
  await h.response({ok:true,posts:[post(9,{body:'古いカテゴリの返答'})],has_more:false},200,0);assert.equal(h.nodes('.cw-post').length,0);
  await h.response({ok:true,posts:[post(8,{category:'stock:6758',body:'新しいカテゴリの返答'})],has_more:false});assert.equal(h.nodes('.cw-post-body')[0].textContent,'新しいカテゴリの返答');
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
test('stock drafts stay with their company and close only cleans up, while Back returns to Talk',async()=>{
  const h=harness({config:{stock:true,categories:[['stock:7203','トヨタ 7203'],['stock:6758','ソニー 6758']]}});h.ui.open();await h.response({ok:true,posts:[],has_more:false});h.node('#cmInput').value='トヨタの下書き';h.node('#cmInput').emit('input');h.nodes('.cw-category')[1].click();await h.response({ok:true,posts:[],has_more:false});h.node('#cmInput').value='ソニーの下書き';h.node('#cmInput').emit('input');h.nodes('.cw-category')[0].click();await h.response({ok:true,posts:[],has_more:false});assert.equal(h.node('#cmInput').value,'トヨタの下書き');h.ui.close();assert.equal(h.hub.style.display,'none');assert.equal(h.timers.size,0);assert.equal(h.document.getElementById('stockTalkOv'),null);
  h.ui.open();await h.response({ok:true,posts:[],has_more:false});h.node('.cw-back').click();assert.equal(h.hub.style.display,'block');
});
test('guest report prompts login before opening a native modal',async()=>{
  const h=harness({logged:false});h.ui.open();await h.response({ok:true,posts:[post(1)],has_more:false});h.node('.cw-menu-item').click();await h.settle();assert.equal(h.authPrompts(),1);assert.equal(h.nodes('dialog').length,0);assert.equal(h.calls.length,1);
});
test('reply writes to the parent topic and server-owned replies can be deleted',async()=>{
  const h=harness();h.ui.open();await h.response({ok:true,posts:[post(7,{category:'life'})],has_more:false});h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[],has_more:false});const field=h.node('.cw-reply-form').querySelector('textarea');field.value='返信例';field.emit('input');h.node('.cw-reply-form').emit('submit');await h.settle();const payload=JSON.parse(h.calls.at(-1).options.body);assert.equal(payload.parent_id,7);assert.equal(payload.category,'life');
  await h.response({ok:true,post:post(8,{parent_id:7,category:'life',body:'返信例',is_mine:true})});assert.equal(h.nodes('.cw-reply-post').length,1);assert.equal(h.nodes('.cw-delete').length,1);
});
test('legacy conversations remain a separate readonly archive outside the shared searchable feed',async()=>{
  const h=harness();h.ui.open();await h.response({ok:true,posts:[],has_more:false});const archive=h.node('.cw-archive');archive.open=true;archive.emit('toggle');await h.response({ok:true,messages:[{id:1,name:'以前の名前',body:'以前の会話',created_at:'2026-10-10T00:00:00Z'}]});assert.equal(h.nodes('.cw-legacy-post').length,1);assert.equal(h.node('.cw-legacy-post').querySelector('button'),null);assert.equal(h.nodes('.cw-feed')[0].querySelector('.cw-legacy-post'),null);assert.equal(h.nodes('.cw-categories').length,0);
});
test('language change uses English fallback without translating user content',async()=>{
  const h=harness();h.ui.open();await h.response({ok:true,posts:[post(2,{body:'ニュース',name:'ニュース'})],has_more:false});h.document.documentElement.lang='en';h.document.emit('langChanged');assert.equal(h.node('.cw-title').textContent,'Talk');assert.equal(h.nodes('.cw-category').length,0);assert.equal(h.node('.cw-post-body').textContent,'ニュース');assert.equal(h.node('.cw-author').textContent,'ニュース');assert.match(h.node('.cw-post-date').textContent,/Posted/);
  h.document.documentElement.lang='ko';h.document.emit('langChanged');assert.equal(h.node('.cw-title').textContent,'Talk');
});
test('delayed language events preserve composer and reply controls and allow sending',async()=>{
  const h=harness();h.ui.open();await h.response({ok:true,posts:[post(20,{category:'life'})],has_more:false});
  const nickname=h.node('#cmNick'),body=h.node('#cmInput'),selects=h.node('.cw-composer').querySelectorAll('select');
  nickname.value='表示名';body.value='入力中の投稿';body.emit('input');selects[0].value='news';selects[1].value='ja';
  h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[],has_more:false});let reply=h.node('.cw-reply-form').querySelector('textarea');reply.value='入力中の返信';reply.emit('input');
  const search=h.node('.cw-community-search').querySelector('input');search.value='表示用';search.emit('input');
  for(const language of ['ja','en','ko','ja']){
    h.document.documentElement.lang=language;h.document.emit('langChanged');
    assert.equal(h.node('#cmNick'),nickname);assert.equal(h.node('#cmInput'),body);assert.equal(body.value,'入力中の投稿');assert.equal(nickname.value,'表示名');
    assert.deepEqual(h.node('.cw-composer').querySelectorAll('select'),selects);assert.equal(selects[0].value,'news');assert.equal(selects[1].value,'ja');
    assert.equal(h.node('.cw-reply-form').querySelector('textarea').value,'入力中の返信');assert.equal(h.nodes('label[data-cw-copy]').length,0);
    assert.equal(h.node('.cw-community-search').querySelector('input'),search);assert.equal(search.value,'表示用');
    assert.equal(search.placeholder,language==='ja'?'投稿・返信を検索':'Search posts and replies');
    assert.deepEqual(h.nodes('.cw-view-tab').map(node=>node.textContent),language==='ja'?['みんなの銘柄','コミュニティ']:['Stock Talk','Community']);
  }
  h.node('.cw-composer').emit('submit');await h.settle();let payload=JSON.parse(h.calls.at(-1).options.body);assert.equal(payload.body,'入力中の投稿');assert.equal(payload.name,'表示名');assert.equal(payload.category,'news');
  await h.response({ok:true,post:post(21,{body:payload.body,category:'news',is_mine:true})});
  h.node('.cw-reply-form').emit('submit');await h.settle();payload=JSON.parse(h.calls.at(-1).options.body);assert.equal(payload.body,'入力中の返信');assert.equal(payload.parent_id,20);assert.equal(payload.category,'life');
  await h.response({ok:true,post:post(22,{parent_id:20,category:'life',body:payload.body,is_mine:true})});assert.equal(h.nodes('.cw-reply-post').length,1);
});
test('close button restores the original morning scroll position',async()=>{
  const h=harness();h.document.body.classList.add('view-asaletter');h.ui.open();assert.equal(h.document.body.classList.contains('view-asaletter'),false);await h.response({ok:true,posts:[],has_more:false});h.node('.cw-close').click();assert.equal(h.morning.scrollTop,177);assert.equal(h.document.getElementById('cmOv'),null);
});
test('entry can supply the morning position from before legacy cleanup while an active view keeps priority',async()=>{
  const h=harness(),top=h.morning.scrollTop;h.morning.scrollTop=0;h.ui.open({morningTop:top});await h.response({ok:true,posts:[],has_more:false});h.node('.cw-close').click();assert.equal(h.morning.scrollTop,177);
  const stock=paired(h);stock.open({morningTop:177});await h.response({ok:true,posts:[],has_more:false});h.morning.scrollTop=0;h.ui.open({morningTop:999});await h.response({ok:true,posts:[],has_more:false});h.node('.cw-close').click();assert.equal(h.morning.scrollTop,177,'active view origin takes priority over a new entry hint');
  h.morning.scrollTop=23;h.ui.open({morningTop:'999'});await h.response({ok:true,posts:[],has_more:false});h.node('.cw-close').click();assert.equal(h.morning.scrollTop,23,'non-numeric entry hints use the original morning value');
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

test('stock conversation keeps catalogue room, draft and transport separate from general community',async()=>{
 const config={stock:true,categories:[['stock:7203','トヨタ 7203'],['stock:6758','ソニー 6758']]};
 const h=harness({config});h.ui.open();await h.settle();assert.match(h.calls[0].url,/\/api\/stock-talk\/posts\?category=stock%3A7203/);
 await h.response({ok:true,posts:[],has_more:false});h.node('.cw-compose-body').value='トヨタの下書き';h.node('.cw-compose-body').emit('input');
 h.nodes('.cw-category')[1].click();await h.response({ok:true,posts:[],has_more:false});assert.equal(h.node('.cw-compose-body').value,'');
 h.nodes('.cw-category')[0].click();await h.response({ok:true,posts:[],has_more:false});assert.equal(h.node('.cw-compose-body').value,'トヨタの下書き');
});

test('catalogue search opens a regional company room and writes only to that selected room',async()=>{
 const h=harness({config:{stock:true,categories:[['stock:7203','トヨタ 7203']]}});h.ui.open();await h.response({ok:true,posts:[],has_more:false});
 const finder=h.node('.cw-stock-search'),query=finder.querySelector('input');assert.ok(finder.classList.contains('cw-search'));assert.equal(finder.firstElementChild.tagName,'BUTTON');assert.equal(finder.firstElementChild.type,'submit');assert.equal(query.type,'search');assert.equal(finder.events.has('keydown'),false,'native Enter submission is not intercepted');
 query.value='1832';let prevented=false;finder.emit('submit',{preventDefault(){prevented=true;}});assert.equal(prevented,true);
 await h.response({ok:true,rooms:[{category:'stock:1832',name:'北海電工',code:'1832'}]});h.node('.cw-stock-results').querySelector('button').click();
 await h.response({ok:true,posts:[],has_more:false});assert.match(h.calls.at(-1).url,/category=stock%3A1832/);
 h.node('.cw-compose-body').value='地方銘柄へのテスト';h.node('.cw-composer').emit('submit');await h.settle();
 assert.equal(JSON.parse(h.calls.at(-1).options.body).category,'stock:1832');
});

test('both real Talk views share two immediate tabs and close the previous instance completely',async()=>{
 const h=harness(),stock=paired(h);stock.open();await h.settle();h.morning.scrollTop=0;
 assert.equal(h.node('.cw-title').textContent,'トーク');assert.equal(h.node('#stockTalkOv').getAttribute('aria-label'),'みんなの銘柄トーク');
 assert.deepEqual(h.nodes('.cw-view-tab').map(n=>[n.tagName,n.type,n.textContent,n.getAttribute('aria-pressed')]),[['BUTTON','button','みんなの銘柄','true'],['BUTTON','button','コミュニティ','false']]);
 const old=h.pending[0];h.node('#cmInput').value='銘柄の下書き';h.node('#cmInput').emit('input');h.nodes('.cw-view-tab')[1].click();await h.settle();
 assert.equal(old.options.signal.aborted,true);assert.equal(h.nodes('.cw-screen').length,1);assert.equal(h.document.getElementById('stockTalkOv'),null);assert.equal(h.nodes('#cmInput').length,1);assert.equal(h.nodes('#cmNick').length,1);assert.equal(h.window.knTalkLastView,'community');assert.equal(h.timers.size,1);
 assert.equal(h.document.activeElement,h.nodes('.cw-view-tab')[1],'keyboard focus follows the selected tab without scrolling');
 for(const event of ['visibilitychange','langChanged','knAuthChange'])assert.equal(h.events.get(event).length,1);
 await h.response({ok:true,posts:[post(999,{body:'古い銘柄の返答'})],has_more:false},200,0);assert.equal(h.nodes('.cw-post').length,0);
 await h.response({ok:true,posts:[post(9)],has_more:false});assert.equal(h.node('.cw-post').dataset.postId,'9');assert.equal(h.nodes('.cw-view-tab')[1].getAttribute('aria-pressed'),'true');
 const before=h.calls.length,root=h.node('#cmOv');h.nodes('.cw-view-tab')[1].click();h.ui.open();await h.settle();assert.equal(h.calls.length,before);assert.equal(h.node('#cmOv'),root);assert.equal(h.nodes('.cw-view-tabs').length,1);assert.equal(h.timers.size,1);
 h.nodes('.cw-view-tab')[0].click();await h.response({ok:true,posts:[],has_more:false});assert.equal(h.node('#cmInput').value,'銘柄の下書き');assert.equal(h.window.knTalkLastView,'stock');assert.equal(h.nodes('.cw-screen').length,1);assert.equal(h.document.activeElement,h.nodes('.cw-view-tab')[0]);h.node('.cw-close').click();assert.equal(h.morning.scrollTop,177,'both tab transitions retain the original morning reading position');assert.equal(h.timers.size,0);
 for(const event of ['visibilitychange','langChanged','knAuthChange'])assert.equal(h.events.get(event).length,0);
});

test('reply drafts remain separate by conversation and topic across tab switches without new persistent storage',async()=>{
 const h=harness(),stock=paired(h);h.ui.open();await h.response({ok:true,posts:[post(7)],has_more:false});
 h.node('#cmInput').value='一般の投稿下書き';h.node('#cmInput').emit('input');h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[],has_more:false});let input=h.node('.cw-reply-form').querySelector('textarea');input.value='一般の返信下書き';input.emit('input');
 h.nodes('.cw-view-tab')[0].click();await h.response({ok:true,posts:[post(7,{category:'stock:7203'})],has_more:false});h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[],has_more:false});input=h.node('.cw-reply-form').querySelector('textarea');assert.equal(input.value,'');input.value='銘柄の返信下書き';input.emit('input');
 h.nodes('.cw-view-tab')[1].click();await h.response({ok:true,posts:[post(7)],has_more:false});assert.equal(h.node('#cmInput').value,'一般の投稿下書き');h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[],has_more:false});assert.equal(h.node('.cw-reply-form').querySelector('textarea').value,'一般の返信下書き');
 h.nodes('.cw-view-tab')[0].click();await h.response({ok:true,posts:[post(7,{category:'stock:7203'})],has_more:false});h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[],has_more:false});assert.equal(h.node('.cw-reply-form').querySelector('textarea').value,'銘柄の返信下書き');
 h.nodes('.cw-category')[1].click();await h.response({ok:true,posts:[post(7,{category:'stock:6758'})],has_more:false});h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[],has_more:false});assert.equal(h.node('.cw-reply-form').querySelector('textarea').value,'','same post ID in another stock room does not inherit a draft');
 h.nodes('.cw-category')[0].click();await h.response({ok:true,posts:[post(7,{category:'stock:7203'})],has_more:false});h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[],has_more:false});assert.equal(h.node('.cw-reply-form').querySelector('textarea').value,'銘柄の返信下書き');
 assert.ok([...h.storage.keys()].every(k=>['kn_community_drafts_v1','kn_community_requests_v1','kn_stock_talk_drafts_v1','kn_stock_talk_requests_v1','cm_nick'].includes(k)));assert.ok([...h.storage.values()].every(v=>!v.includes('返信下書き')));
 h.node('.cw-reply-form').emit('submit');await h.response({ok:true,post:post(8,{parent_id:7,category:'stock:7203',body:'銘柄の返信下書き'})});stock.close();stock.open();await h.response({ok:true,posts:[post(7,{category:'stock:7203'})],has_more:false});h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[],has_more:false});assert.equal(h.node('.cw-reply-form').querySelector('textarea').value,'','successful reply clears its memory draft');
});

test('community is one shared feed with backend post and reply search, debounced and literal normalized',async()=>{
 const h=harness();h.ui.open();await h.response({ok:true,posts:[post(5)],has_more:false});
 assert.equal(h.nodes('.cw-categories').length,0);assert.equal(h.nodes('.cw-category').length,0);assert.match(h.calls[0].url,/category=all/);
 const finder=h.node('.cw-community-search'),query=finder.querySelector('input'),before=h.calls.length;assert.equal(finder.firstElementChild.type,'submit');assert.equal(query.type,'search');assert.equal(query.getAttribute('aria-label'),'投稿・返信を検索');assert.equal(query.maxLength,80);
 query.value=' ＮＩＳＡ ';query.emit('input');query.value=' ＮＩＳＡ　学ぶ ';query.emit('input');assert.equal(h.timeouts.size,1);assert.equal([...h.timeouts.values()][0].ms,350);assert.equal(h.calls.length,before);assert.equal(h.timers.size,1,'debounce is separate from the existing poll interval');
 await h.runTimeouts();assert.equal(h.calls.length,before+1);const params=new URL(h.calls.at(-1).url,'https://example.invalid').searchParams;assert.equal(params.get('q'),'nisa 学ぶ');assert.equal(params.get('category'),'all');
 await h.response({ok:true,posts:[post(2,{body:'親の本文には検索語なし',reply_count:1,reply_preview:{id:3,parent_id:2,name:'返信者',body:'NISAを学ぶ',created_at:'2026-10-12T00:01:00Z'}})],has_more:false});assert.deepEqual(h.nodes('.cw-post').map(n=>n.dataset.postId),['2'],'reply-only server match survives without the removed parent-only filter');assert.equal(h.node('.cw-preview-body').textContent,'NISAを学ぶ');
});

test('native search submission and clear cancel debounce and search stored posts through q',async()=>{
 const h=harness();h.ui.open();await h.response({ok:true,posts:[post(5)],has_more:false});const finder=h.node('.cw-community-search'),query=finder.querySelector('input');
 query.value='100% _';query.emit('input');let prevented=false;finder.emit('submit',{preventDefault(){prevented=true;}});await h.settle();assert.equal(prevented,true);assert.equal(h.timeouts.size,0);assert.equal(new URL(h.calls.at(-1).url,'https://example.invalid').searchParams.get('q'),'100% _');
 await h.response({ok:true,posts:[],has_more:false});assert.equal(h.node('.cw-search-empty').hidden,false);assert.equal(h.nodes('.cw-state')[1].hidden,true);
 query.value='';query.emit('search');await h.settle();assert.doesNotMatch(h.calls.at(-1).url,/[?&]q=/);await h.response({ok:true,posts:[post(5)],has_more:false});assert.equal(h.node('.cw-search-empty').hidden,true);assert.equal(h.node('.cw-post').dataset.postId,'5');
 const before=h.calls.length;finder.emit('submit');await h.settle();assert.equal(h.calls.length,before,'same normalized query does not issue another read');
});

test('searched feed paging and poll retain q and distinguish empty results from failure',async()=>{
 const h=harness();h.ui.open();await h.response({ok:true,posts:[],has_more:false});const finder=h.node('.cw-community-search'),query=finder.querySelector('input');query.value='探したい';finder.emit('submit');assert.equal(h.node('.cw-search-empty').hidden,true);await h.response({ok:true,posts:[post(5,{body:'探したい言葉'})],has_more:true,next_cursor:5});
 h.node('.cw-scroll').scrollTop=213;h.node('.cw-more').click();await h.response({ok:true,posts:[post(4,{body:'探したい関連語'})],has_more:true,next_cursor:4});assert.deepEqual(h.nodes('.cw-post').map(n=>n.dataset.postId),['5','4']);const page=new URL(h.calls.at(-1).url,'https://example.invalid').searchParams;assert.equal(page.get('q'),'探したい');assert.equal(page.get('before'),'5');assert.equal(h.node('.cw-scroll').scrollTop,213);
 [...h.timers.values()][0].fn();await h.settle();assert.equal(new URL(h.calls.at(-1).url,'https://example.invalid').searchParams.get('q'),'探したい');await h.response({ok:true,posts:[post(5,{body:'探したい更新'})],has_more:true,next_cursor:5});
 query.value='一致なし';finder.emit('submit');await h.response({ok:false,reason:'storage_unavailable'},503);assert.equal(h.node('.cw-search-empty').hidden,true);assert.equal(h.node('.cw-error-state').hidden,false);assert.equal(h.nodes('.cw-state')[1].hidden,true);
 h.node('.cw-error-state').querySelector('button').click();await h.response({ok:true,posts:[],has_more:false});assert.equal(h.node('.cw-search-empty').hidden,false);assert.equal(h.nodes('.cw-state')[1].hidden,true);
});

test('stock search still ignores earlier matches after a second native form submission',async()=>{
 const h=harness({config:{stock:true,categories:[['stock:7203','トヨタ 7203']]}});h.ui.open();await h.response({ok:true,posts:[],has_more:false});const finder=h.node('.cw-stock-search'),input=finder.querySelector('input');input.value='1832';finder.emit('submit');await h.settle();input.value='6758';finder.emit('submit');await h.settle();
 await h.response({ok:true,rooms:[{category:'stock:1832',name:'北海電工',code:'1832'}]},200,0);assert.equal(h.node('.cw-stock-results').querySelector('button'),null);
 await h.response({ok:true,rooms:[{category:'stock:6758',name:'ソニー',code:'6758'}]});assert.match(h.node('.cw-stock-results').querySelector('button').textContent,/ソニー/);assert.equal(finder.querySelector('input'),input);assert.equal(h.nodes('.cw-community-search').length,0);assert.equal(h.nodes('.cw-search-scope').length,0);
});

test('successful reply cannot regain a stale draft after language rerender, collapse and tab changes',async()=>{
 const h=harness();paired(h);h.ui.open();await h.response({ok:true,posts:[post(11)],has_more:false});h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[],has_more:false});const oldInput=h.node('.cw-reply-form').querySelector('textarea');oldInput.value='送信中の返信';oldInput.emit('input');h.node('.cw-reply-form').emit('submit');await h.settle();
 h.document.documentElement.lang='en';h.document.emit('langChanged');const rerendered=h.node('.cw-reply-form').querySelector('textarea');assert.notEqual(rerendered,oldInput);assert.equal(rerendered.value,'送信中の返信');h.node('.cw-reply-toggle').click();assert.equal(h.nodes('.cw-reply-form').length,0);
 await h.response({ok:true,post:post(12,{parent_id:11,body:'送信中の返信'})});h.nodes('.cw-view-tab')[0].click();await h.response({ok:true,posts:[],has_more:false});h.nodes('.cw-view-tab')[1].click();await h.response({ok:true,posts:[post(11,{reply_count:1})],has_more:false});h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[post(12,{parent_id:11,body:'送信中の返信'})],has_more:false});assert.equal(h.node('.cw-reply-form').querySelector('textarea').value,'');assert.equal(h.nodes('.cw-reply-post').length,1);assert.equal(h.calls.filter(call=>call.options.method==='POST').length,1);
});

test('saved historical community topic drafts remain selectable without splitting the live feed',async()=>{
 const original={all:{body:'コミュニティの下書き',category:'chat',language:'ja'},economy:{body:'以前の経済下書き',category:'economy',language:'en'},news:{body:'以前のニュース下書き',category:'news',language:'ja'}};
 const storage=new Map([['kn_community_drafts_v1',JSON.stringify(original)]]),h=harness({storage});h.ui.open();await h.response({ok:true,posts:[],has_more:false});
 assert.equal(h.node('#cmInput').value,original.all.body);assert.equal(h.nodes('.cw-category').length,0);assert.equal(h.nodes('.cw-categories').length,0);assert.equal(h.node('.cw-composer').querySelectorAll('select')[1].parentNode.hidden,true,'legacy destination is not a visible genre selector');
 const chooser=h.node('.cw-saved-draft-label').querySelector('select');chooser.value='economy';chooser.emit('change');assert.equal(h.node('#cmInput').value,original.economy.body);assert.equal(h.node('.cw-composer').querySelectorAll('select')[1].value,'economy');
 h.node('#cmInput').value='編集した以前の下書き';h.node('#cmInput').emit('input');chooser.value='all';chooser.emit('change');assert.equal(h.node('#cmInput').value,original.all.body);const saved=JSON.parse(storage.get('kn_community_drafts_v1'));assert.equal(saved.economy.body,'編集した以前の下書き');assert.deepEqual(saved.news,original.news);assert.match(h.calls[0].url,/category=all/);assert.equal(h.calls.length,1,'choosing a saved draft does not switch the live feed');
 h.ui.close();h.ui.open();await h.response({ok:true,posts:[],has_more:false});assert.equal(h.node('#cmInput').value,original.all.body);assert.equal(JSON.parse(storage.get('kn_community_drafts_v1')).economy.body,'編集した以前の下書き');
});

test('reply-visible rows render avatars and safe excerpts, opening only the exact parent thread once',async()=>{
 const h=harness();h.ui.open();await h.response({ok:true,posts:[post(10,{name:'<img name>',body:'親の本文',reply_count:1,reply_preview:{id:12,parent_id:10,name:'<script>名前</script>',body:'<img src=x onerror=alert(1)>',created_at:'2026-10-12T00:01:00Z'}}),post(9,{reply_count:1,reply_preview:{id:11,parent_id:999,name:'別の人',body:'違う親の内容'}})],has_more:false});
 assert.equal(h.nodes('.cw-avatar').length,2);assert.equal(h.node('.cw-avatar').getAttribute('aria-hidden'),'true');assert.equal(h.nodes('.cw-reply-preview').length,1);assert.equal(h.node('.cw-preview-name').textContent,'<script>名前</script>');assert.equal(h.node('.cw-preview-body').textContent,'<img src=x onerror=alert(1)>');assert.equal(h.calls.length,1,'initial excerpts share the feed GET and never create per-post reads');assert.equal(h.node('.cw-reply-preview').tagName,'BUTTON');assert.equal(h.node('.cw-reply-preview').getAttribute('aria-label'),'返信の続きを見る');
 h.node('.cw-reply-preview').click();await h.settle();assert.equal(h.calls.length,2);assert.match(h.calls.at(-1).url,/\/posts\/10\/replies\?limit=50$/);await h.response({ok:true,posts:[post(12,{parent_id:10,body:'返信全文'})],has_more:false});assert.equal(h.nodes('.cw-reply-post').length,1);assert.equal(h.nodes('.cw-reply-preview').length,0);assert.equal(h.node('.cw-reply-post').querySelector('.cw-post-body').textContent,'返信全文');
});

test('poll explicitly clears an unavailable reply excerpt without additional thread reads',async()=>{
 const h=harness();h.ui.open();await h.response({ok:true,posts:[post(10,{reply_count:1,reply_preview:{id:11,parent_id:10,name:'表示名',body:'公開されていた返信'}})],has_more:false});assert.equal(h.nodes('.cw-reply-preview').length,1);
 [...h.timers.values()][0].fn();await h.response({ok:true,posts:[post(10,{reply_count:0,reply_preview:null})],has_more:false});assert.equal(h.nodes('.cw-reply-preview').length,0);assert.equal(h.node('.cw-reply-toggle').querySelector('.cw-action-count').textContent,'0');assert.equal(h.calls.length,2);
});

test('out-of-order search responses cannot replace a new query and close cancels pending debounce',async()=>{
 const h=harness();h.ui.open();await h.response({ok:true,posts:[post(10)],has_more:false});const finder=h.node('.cw-community-search'),query=finder.querySelector('input');
 query.value='古い検索';finder.emit('submit');await h.settle();const first=h.pending[0];query.value='新しい検索';finder.emit('submit');await h.settle();assert.equal(first.options.signal.aborted,true);assert.equal(h.pending.length,2);
 await h.response({ok:true,posts:[post(9,{body:'古い検索の結果'})],has_more:false},200,0);assert.equal(h.nodes('.cw-post').length,0);await h.response({ok:true,posts:[post(8,{body:'新しい検索の結果'})],has_more:false});assert.equal(h.node('.cw-post-body').textContent,'新しい検索の結果');
 query.value='まだ送らない';query.emit('input');assert.equal(h.timeouts.size,1);const before=h.calls.length;h.ui.close();assert.equal(h.timeouts.size,0);assert.equal(h.timers.size,0);await h.runTimeouts();assert.equal(h.calls.length,before);
});

test('stock keyword search stays in its selected room and room changes clear and abort the old query',async()=>{
 const h=harness({config:{stock:true,categories:[['stock:7203','トヨタ 7203'],['stock:6758','ソニー 6758']]}});h.ui.open();await h.response({ok:true,posts:[],has_more:false});const finder=h.node('.cw-stock-post-search'),query=finder.querySelector('input');query.value='新製品';finder.emit('submit');await h.settle();const old=h.pending[0],params=new URL(h.calls.at(-1).url,'https://example.invalid').searchParams;assert.equal(params.get('category'),'stock:7203');assert.equal(params.get('q'),'新製品');assert.match(h.calls.at(-1).url,/\/api\/stock-talk\/posts/);
 h.nodes('.cw-category')[1].click();await h.settle();assert.equal(old.options.signal.aborted,true);assert.equal(query.value,'');const selected=new URL(h.calls.at(-1).url,'https://example.invalid').searchParams;assert.equal(selected.get('category'),'stock:6758');assert.equal(selected.has('q'),false);
 await h.response({ok:true,posts:[post(99,{category:'stock:7203',body:'古い銘柄の結果'})],has_more:false},200,0);assert.equal(h.nodes('.cw-post').length,0);await h.response({ok:true,posts:[post(98,{category:'stock:6758'})],has_more:false});assert.equal(h.node('.cw-post').dataset.postId,'98');
});

test('search queued during a write waits for success and cannot erase the published post with a stale query',async()=>{
 const h=harness();h.ui.open();await h.response({ok:true,posts:[],has_more:false});h.node('#cmInput').value='検索を待つ投稿';h.node('#cmInput').emit('input');h.ui.send();await h.settle();const write=h.pending[0];assert.equal(write.options.method,'POST');
 const finder=h.node('.cw-community-search'),query=finder.querySelector('input');query.value='検索を待つ';finder.emit('submit');await h.settle();assert.equal(h.pending.length,1,'search does not abort a pending write');assert.equal(write.options.signal.aborted,false);
 await h.response({ok:true,post:post(30,{body:'検索を待つ投稿',is_mine:true})});assert.equal(h.node('#cmInput').value,'');assert.equal(h.pending.length,1);assert.equal(new URL(h.calls.at(-1).url,'https://example.invalid').searchParams.get('q'),'検索を待つ');await h.response({ok:true,posts:[post(30,{body:'検索を待つ投稿',is_mine:true})],has_more:false});assert.equal(h.nodes('.cw-post').length,1);assert.equal(h.node('.cw-post-body').textContent,'検索を待つ投稿');assert.equal(h.calls.filter(call=>call.options.method==='POST').length,1);
});

test('new shared-community posts use the retained chat destination and search errors preserve drafts',async()=>{
 const h=harness();h.ui.open();await h.response({ok:true,posts:[],has_more:false});h.node('#cmInput').value='新しいつぶやき';h.node('#cmInput').emit('input');assert.equal(h.node('.cw-composer').querySelectorAll('select')[0].value,'chat');h.ui.send();await h.settle();assert.equal(JSON.parse(h.calls.at(-1).options.body).category,'chat');await h.response({ok:true,post:post(30,{body:'新しいつぶやき',category:'chat',is_mine:true})});
 h.node('#cmInput').value='検索中の下書き';h.node('#cmInput').emit('input');const finder=h.node('.cw-community-search'),query=finder.querySelector('input');const before=h.calls.length;query.value='あ'.repeat(81);finder.emit('submit');await h.settle();assert.equal(h.calls.length,before);assert.match(h.node('.cw-notice').textContent,/80文字/);assert.equal(h.node('#cmInput').value,'検索中の下書き');
 query.value='検索語';finder.emit('submit');await h.response({ok:false,reason:'storage_unavailable'},503);assert.equal(h.node('#cmInput').value,'検索中の下書き');assert.equal(JSON.parse(h.storage.get('kn_community_drafts_v1')).all.body,'検索中の下書き');
});

test('same or invalid queued search still flushes the successful post refresh under the active query',async()=>{
 for(const queued of [' ＮＩＳＡ　','あ'.repeat(81)]){
  const h=harness();h.ui.open();await h.response({ok:true,posts:[],has_more:false});const finder=h.node('.cw-community-search'),query=finder.querySelector('input');query.value='nisa';finder.emit('submit');await h.response({ok:true,posts:[],has_more:false});
  h.node('#cmInput').value='NISAの投稿';h.node('#cmInput').emit('input');h.ui.send();await h.settle();query.value=queued;finder.emit('submit');await h.settle();assert.equal(h.pending.length,1);
  await h.response({ok:true,post:post(30,{body:'NISAの投稿',is_mine:true})});assert.equal(h.pending.length,1,'pending search no-op or invalid input cannot swallow the required fresh feed read');assert.equal(new URL(h.calls.at(-1).url,'https://example.invalid').searchParams.get('q'),'nisa');await h.response({ok:true,posts:[post(30,{body:'NISAの投稿',is_mine:true})],has_more:false});assert.equal(h.node('.cw-post-body').textContent,'NISAの投稿');
 }
});

test('search restarts an open pending archive and does not leave it permanently loading',async()=>{
 const h=harness();h.ui.open();await h.response({ok:true,posts:[],has_more:false});const archive=h.node('.cw-archive');archive.open=true;archive.emit('toggle');await h.settle();const old=h.pending[0];const finder=h.node('.cw-community-search'),query=finder.querySelector('input');query.value='NISA';finder.emit('submit');await h.settle();assert.equal(old.options.signal.aborted,true);assert.equal(h.pending.length,3,'one aborted archive plus new feed and new archive');
 await h.response({ok:true,messages:[{id:1,name:'古い返答',body:'破棄すべき内容'}]},200,0);assert.equal(h.nodes('.cw-legacy-post').length,0);await h.response({ok:true,posts:[],has_more:false},200,0);await h.response({ok:false,reason:'storage_unavailable'},503,0);
 h.node('.cw-archive-body').querySelector('button').click();await h.settle();assert.equal(h.pending.length,1,'archive retry remains operational');assert.equal(h.calls.at(-1).url,'/api/messages');await h.response({ok:true,messages:[{id:2,name:'名前',body:'新しい履歴'}]});assert.equal(h.node('.cw-legacy-post').querySelector('.cw-post-body').textContent,'新しい履歴');
});

test('old draft picker is guarded while compose POST is pending and other stored drafts are never erased',async()=>{
 const old={all:{body:'送る投稿',category:'chat',language:'ja'},economy:{body:'以前の下書き',category:'economy',language:'ja'}};const storage=new Map([['kn_community_drafts_v1',JSON.stringify(old)]]),h=harness({storage});h.ui.open();await h.response({ok:true,posts:[],has_more:false});const picker=h.node('.cw-saved-draft-label').querySelector('select');h.ui.send();await h.settle();assert.equal(picker.disabled,true);
 picker.value='economy';picker.emit('change');assert.equal(picker.value,'all');assert.equal(h.node('#cmInput').value,'送る投稿');await h.response({ok:true,post:post(30,{body:'送る投稿',category:'chat',is_mine:true})});assert.equal(picker.disabled,false);assert.equal(h.node('#cmInput').value,'');assert.deepEqual(JSON.parse(storage.get('kn_community_drafts_v1')).economy,old.economy);
 picker.value='economy';picker.emit('change');assert.equal(h.node('#cmInput').value,'以前の下書き');
});

test('typing the next compose or reply draft while a write is pending keeps the new text after success',async()=>{
 const h=harness();h.ui.open();await h.response({ok:true,posts:[post(20)],has_more:false});h.node('#cmInput').value='送信中の投稿';h.node('#cmInput').emit('input');h.ui.send();await h.settle();h.node('#cmInput').value='次の投稿下書き';h.node('#cmInput').emit('input');await h.response({ok:true,post:post(30,{body:'送信中の投稿',is_mine:true})});assert.equal(h.node('#cmInput').value,'次の投稿下書き');assert.equal(JSON.parse(h.storage.get('kn_community_drafts_v1')).all.body,'次の投稿下書き');
 h.nodes('.cw-reply-toggle')[1].click();await h.response({ok:true,posts:[],has_more:false});let input=h.node('.cw-reply-form').querySelector('textarea');input.value='送信中の返信';input.emit('input');h.node('.cw-reply-form').emit('submit');await h.settle();h.document.documentElement.lang='en';h.document.emit('langChanged');input=h.node('.cw-reply-form').querySelector('textarea');input.value='次の返信下書き';input.emit('input');await h.response({ok:true,post:post(21,{parent_id:20,body:'送信中の返信',is_mine:true})});assert.equal(h.node('.cw-reply-form').querySelector('textarea').value,'次の返信下書き');assert.equal(h.node('.cw-reply-post').querySelector('.cw-post-body').textContent,'送信中の返信');
 h.ui.close();h.ui.open();await h.response({ok:true,posts:[post(20,{reply_count:1})],has_more:false});h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[post(21,{parent_id:20,body:'送信中の返信',is_mine:true})],has_more:false});assert.equal(h.node('.cw-reply-form').querySelector('textarea').value,'次の返信下書き');
});

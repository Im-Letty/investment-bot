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
  const entrance=new Node('button');entrance.id='knHomeATalk';document.body.appendChild(entrance);
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
const companyRoom=(code='1832',name='北海電工')=>({category:'stock:'+code,code,name});
function paired(h){
  h.window.KNCommunity=h.ui;h.window.openCommunity=h.ui.open;
  const stock=create(h.window,{stock:true,categories:[['stock:7203','トヨタ 7203'],['stock:6758','ソニー 6758']]});
  h.window.KNStockTalk=stock;h.window.openStockTalk=stock.open;return stock;
}

function assertNoNicknameUI(h){
 for(const selector of ['#cmNick','.cw-nickname','.cw-nickname-summary','.cw-nickname-value','.cw-nickname-editor','.cw-nickname-change','.cw-nickname-save','.cw-nickname-cancel','.cw-nickname-status','.cw-nickname-caption','.cw-nickname-scope','.cw-nickname-actions'])assert.equal(h.nodes(selector).length,0,selector+' must be absent');
}

function assertNoPostLanguageUI(h){
 const fields=h.node('.cw-composer-fields');assert.equal(fields.hidden,true,'retained metadata controls remain hidden');
 assert.equal(fields.querySelectorAll('select').length,1,'only the retained category select exists');
 assert.equal(h.nodes('[aria-label="投稿の言語"]').length,0);
 assert.equal(h.nodes('[data-cw-copy]').filter(node=>node.dataset.cwCopy==='投稿の言語').length,0);
 return fields.querySelector('select');
}

test('scoped company voices load the selected room first and preserve its existing draft',async()=>{
  const storage=new Map([['kn_stock_talk_drafts_v1',JSON.stringify({'stock:1832':{body:'地方銘柄の下書き',category:'stock:1832',language:'ja'},'stock:7203':{body:'別の会社の下書き',category:'stock:7203',language:'ja'}})]]);
  const h=harness({storage}),stock=paired(h);assert.equal(stock.openRoom(companyRoom()),true);await h.settle();
  assert.equal(h.calls.length,1);assert.match(h.calls[0].url,/category=stock%3A1832/);assert.equal(h.node('#cmInput').value,'地方銘柄の下書き');assert.equal(h.node('.cw-context-title').textContent,'みんなの声');assert.equal(h.node('.cw-company-context').textContent,'北海電工 1832');assert.equal(h.node('.cw-room-picker').hidden,true);assert.equal(h.nodes('.cw-view-tab').length,0);assert.equal(h.nodes('.cw-back').length,0);assert.equal(h.node('.cw-composer').hidden,true);assert.equal(h.document.activeElement,null);
  stock.close();assert.equal(JSON.parse(storage.get('kn_stock_talk_drafts_v1'))['stock:7203'].body,'別の会社の下書き');
});
test('only the scoped close control returns to company information and restores the morning view',async()=>{
  const h=harness(),stock=paired(h);let returned=0;h.document.body.classList.add('view-asaletter');
  const options={onReturn(){returned++;assert.equal(h.document.getElementById('stockTalkOv'),null);assert.equal(h.timers.size,0);assert.equal(h.document.body.classList.contains('view-asaletter'),true);}};
  stock.openRoom(companyRoom(),options);await h.response({ok:true,posts:[],has_more:false});assert.equal(h.document.body.classList.contains('view-asaletter'),false);assert.equal(h.node('.cw-close').getAttribute('aria-label'),'会社情報に戻る');h.node('.cw-close').click();assert.equal(returned,1);
  h.document.body.classList.add('view-asaletter');stock.openRoom(companyRoom(),options);await h.response({ok:true,posts:[],has_more:false});stock.close();assert.equal(returned,1);assert.equal(h.document.body.classList.contains('view-asaletter'),false,'ordinary navigation cleanup must not restore a hidden morning screen');
});
test('opening global Talk from scoped voices keeps the global feed alone and never returns to the company',async()=>{
  const h=harness(),stock=paired(h);let returned=0;stock.openRoom(companyRoom(),{onReturn(){returned++;}});await h.settle();const old=h.calls[0];h.ui.open();await h.settle();
  assert.equal(returned,0);assert.equal(old.options.signal.aborted,true);assert.equal(h.nodes('.cw-screen').length,1);assert.equal(h.document.getElementById('stockTalkOv'),null);assert.equal(h.node('.cw-context-title').textContent,'みんなのトーク');assert.equal(h.nodes('.cw-company-context').length,0);assert.equal(h.nodes('.cw-stock-talk-link').length,0);assert.equal(h.nodes('.cw-view-tab').length,2);assert.match(h.calls.at(-1).url,/\/api\/community\/posts\?category=all/);
});
test('scoped company changes abort old feed reads and retain separate company drafts',async()=>{
  const h=harness(),stock=paired(h);stock.openRoom(companyRoom());await h.settle();const first=h.calls[0];h.node('#cmInput').value='北海の下書き';h.node('#cmInput').emit('input');stock.openRoom(companyRoom('6758','ソニー'));await h.settle();assert.equal(first.options.signal.aborted,true);assert.equal(h.node('#cmInput').value,'');assert.equal(h.node('.cw-company-context').textContent,'ソニー 6758');
  await h.response({ok:true,posts:[post(9,{category:'stock:1832',body:'古い会社'})],has_more:false},200,0);assert.equal(h.nodes('.cw-post').length,0);await h.response({ok:true,posts:[],has_more:false});stock.openRoom(companyRoom());await h.settle();assert.equal(h.node('#cmInput').value,'北海の下書き');assert.ok(h.calls.every(call=>!call.options.method||call.options.method==='GET'));
});
test('invalid scoped room data cannot close an existing conversation or fetch a default company',async()=>{
  const h=harness(),stock=paired(h);h.ui.open();await h.response({ok:true,posts:[],has_more:false});const root=h.node('#cmOv'),count=h.calls.length;
  for(const room of [null,{...companyRoom(),code:'1832.JP'},{...companyRoom(),category:'stock:7203'},companyRoom('1832',' ')])assert.equal(stock.openRoom(room),false);
  await h.settle();assert.equal(h.node('#cmOv'),root);assert.equal(h.calls.length,count);
});

test('public entrance is prepared before loading; guest GET never prompts login',async()=>{
  const h=harness({logged:false});h.ui.open();assert.equal(h.prepared(),1);assert.equal(h.authPrompts(),0);await h.settle();assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.headers,undefined);assert.equal(h.node('.cw-context-title').textContent,'みんなのトーク');assert.equal(h.node('#cmOv').getAttribute('aria-label'),'みんなのトーク');
  assert.equal(h.node('.cw-composer').hidden,true);assert.equal(h.document.activeElement,null,'opening does not focus a field or summon the mobile keyboard');assert.equal(h.nodes('.cw-compose-toggle').length,1);assert.equal(h.nodes('.cw-view-tabs').length,1);assert.equal(h.nodes('.cw-view-tab').length,2);assert.equal(h.nodes('.cw-back').length,0);assert.equal(h.nodes('.cw-stock-talk-link').length,0);assert.equal(h.nodes('.cw-categories').length,0);assert.equal(h.node('.cw-intro').textContent,'');assert.equal(h.node('.cw-intro').hidden,true);
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
  const unrelated={body:'以前の経済下書き',category:'economy',language:'en'},storage=new Map([['kn_community_drafts_v1',JSON.stringify({all:{body:'再送する内容',category:'news',language:'ko'},economy:unrelated})]]);
  const h=harness({storage});h.ui.open();await h.response({ok:true,posts:[],has_more:false});const input=h.node('#cmInput');assert.equal(input.value,'再送する内容');input.emit('input');h.ui.send();h.ui.send();await h.settle();assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1);const first=JSON.parse(h.calls.at(-1).options.body);assert.equal(first.category,'news','restored news drafts keep their original destination');assert.equal(first.language,'ko');
  const failed=h.pending.shift();failed.reject(new Error('connection lost'));await h.settle();h.ui.close();h.ui.open();await h.response({ok:true,posts:[post(50,{body:first.body,is_mine:true})],has_more:false});assert.equal(h.node('#cmInput').value,'再送する内容');h.ui.send();await h.settle();const second=JSON.parse(h.calls.at(-1).options.body);assert.equal(first.request_id,second.request_id);assert.equal(second.parent_id,null);assert.equal(second.category,'news');assert.equal(second.language,'ko');assert.equal(second.language,first.language);assert.deepEqual(JSON.parse(storage.get('kn_community_drafts_v1')).economy,unrelated);
  await h.response({ok:true,post:post(50,{body:second.body,is_mine:true})});assert.equal(h.node('#cmInput').value,'');assert.equal(h.nodes('.cw-post').length,1);
});
test('new general and stock posts default to ja without a post-language selector or automatic detection',async()=>{
 for(const stock of [false,true]){
  const config=stock?{stock:true,categories:[['stock:7203','トヨタ 7203']]}:undefined,h=harness({language:'en',config});
  h.ui.open();await h.response({ok:true,posts:[],has_more:false});assertNoPostLanguageUI(h);
  h.node('#cmInput').value='An English draft remains in its original words 中文';h.node('#cmInput').emit('input');
  const key=stock?'kn_stock_talk_drafts_v1':'kn_community_drafts_v1',slot=stock?'stock:7203':'all';
  assert.equal(JSON.parse(h.storage.get(key))[slot].language,'ja');h.ui.send();await h.settle();
  const payload=JSON.parse(h.calls.at(-1).options.body);assert.equal(payload.language,'ja');assert.equal(payload.body,'An English draft remains in its original words 中文');
  await h.response({ok:true,post:post(50,{category:stock?'stock:7203':'chat',body:payload.body})});
  h.document.documentElement.lang='ko';h.document.emit('langChanged');assertNoPostLanguageUI(h);
  h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[],has_more:false});h.node('.cw-reply-form').querySelector('textarea').value='An English reply';h.node('.cw-reply-form').emit('submit');await h.settle();assert.equal(JSON.parse(h.calls.at(-1).options.body).language,'ja');
  await h.response({ok:true,post:post(51,{category:stock?'stock:7203':'chat',parent_id:50})});h.ui.close();
 }
});

test('all supported saved draft language values survive restoration and submission in both conversations',async()=>{
 for(const stock of [false,true])for(const language of ['ja','en','ko','zh','other']){
  const key=stock?'kn_stock_talk_drafts_v1':'kn_community_drafts_v1',slot=stock?'stock:7203':'all',category=stock?'stock:7203':'news';
  const storage=new Map([[key,JSON.stringify({[slot]:{body:'保存済みの本文',category,language}})]]),config=stock?{stock:true,categories:[['stock:7203','トヨタ 7203']]}:undefined,h=harness({storage,language:'en',config});
  h.ui.open();await h.response({ok:true,posts:[],has_more:false});assert.equal(h.node('#cmInput').value,'保存済みの本文');assertNoPostLanguageUI(h);
  h.document.documentElement.lang='ko';h.document.emit('langChanged');h.node('#cmInput').emit('input');assert.equal(JSON.parse(storage.get(key))[slot].language,language);
  h.ui.send();await h.settle();const payload=JSON.parse(h.calls.at(-1).options.body);assert.equal(payload.language,language);assert.equal(payload.category,category);
  await h.response({ok:true,post:post(50,{category,language,body:payload.body})});h.ui.close();
 }
});

test('invalid or absent saved language metadata falls back to ja without replacing the draft body or category',async()=>{
 for(const stock of [false,true])for(const language of [undefined,null,'fr','en-US','en ',0,{}]){
  const key=stock?'kn_stock_talk_drafts_v1':'kn_community_drafts_v1',slot=stock?'stock:7203':'all',category=stock?'stock:7203':'economy';
  const storage=new Map([[key,JSON.stringify({[slot]:{body:'消さない下書き',category,language}})]]),config=stock?{stock:true,categories:[['stock:7203','トヨタ 7203']]}:undefined,h=harness({storage,language:'en',config});
  h.ui.open();await h.response({ok:true,posts:[],has_more:false});assertNoPostLanguageUI(h);assert.equal(h.node('#cmInput').value,'消さない下書き');
  h.node('#cmInput').emit('input');assert.equal(JSON.parse(storage.get(key))[slot].language,'ja');h.ui.send();await h.settle();const payload=JSON.parse(h.calls.at(-1).options.body);assert.equal(payload.language,'ja');assert.equal(payload.body,'消さない下書き');assert.equal(payload.category,category);
  await h.response({ok:true,post:post(50,{category,body:payload.body})});h.ui.close();
 }
});

test('stock drafts stay with their company and ordinary close only cleans up, while the close control returns to the original morning position',async()=>{
  const h=harness({config:{stock:true,categories:[['stock:7203','トヨタ 7203'],['stock:6758','ソニー 6758']]}});h.ui.open();await h.response({ok:true,posts:[],has_more:false});h.node('#cmInput').value='トヨタの下書き';h.node('#cmInput').emit('input');h.nodes('.cw-category')[1].click();await h.response({ok:true,posts:[],has_more:false});h.node('#cmInput').value='ソニーの下書き';h.node('#cmInput').emit('input');h.nodes('.cw-category')[0].click();await h.response({ok:true,posts:[],has_more:false});assert.equal(h.node('#cmInput').value,'トヨタの下書き');h.ui.close();assert.equal(h.hub.style.display,'none');assert.equal(h.timers.size,0);assert.equal(h.document.getElementById('stockTalkOv'),null);
  h.ui.open();await h.response({ok:true,posts:[],has_more:false});assert.equal(h.nodes('.cw-back').length,0);h.node('.cw-close').click();assert.equal(h.hub.style.display,'none');assert.equal(h.morning.scrollTop,177);assert.equal(h.document.activeElement,h.node('#knHomeATalk'));assert.equal(h.document.getElementById('stockTalkOv'),null);assert.equal(h.timers.size,0);
  h.ui.open();await h.response({ok:true,posts:[],has_more:false});assert.equal(h.node('#cmInput').value,'トヨタの下書き');
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
  const h=harness();h.ui.open();await h.response({ok:true,posts:[post(2,{body:'ニュース',name:'ニュース'})],has_more:false});h.document.documentElement.lang='en';h.document.emit('langChanged');assert.equal(h.node('.cw-context-title').textContent,'Everyone’s Talk');assert.equal(h.nodes('.cw-category').length,0);assert.equal(h.node('.cw-post-body').textContent,'ニュース');assert.equal(h.node('.cw-author').textContent,'ニュース');assert.match(h.node('.cw-post-date').textContent,/Posted/);
  h.document.documentElement.lang='ko';h.document.emit('langChanged');assert.equal(h.node('.cw-context-title').textContent,'Everyone’s Talk');
});
test('delayed language events preserve composer, stored language metadata and reply controls',async()=>{
  const storage=new Map([['kn_community_drafts_v1',JSON.stringify({all:{body:'入力中の投稿',category:'news',language:'en'}})]]),h=harness({storage});paired(h);h.ui.open();await h.response({ok:true,posts:[post(20,{category:'life'})],has_more:false});
  const body=h.node('#cmInput'),category=assertNoPostLanguageUI(h);
  h.window.KNUserProfile={username:()=>'表示名',ready:async()=>{}};body.value='入力中の投稿';body.emit('input');
  h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[],has_more:false});let reply=h.node('.cw-reply-form').querySelector('textarea');reply.value='入力中の返信';reply.emit('input');
  const search=h.node('.cw-community-search').querySelector('input');search.value='表示用';search.emit('input');
  for(const language of ['ja','en','ko','ja']){
    h.document.documentElement.lang=language;h.document.emit('langChanged');
    assertNoNicknameUI(h);assert.equal(h.node('#cmInput'),body);assert.equal(body.value,'入力中の投稿');
    assert.equal(assertNoPostLanguageUI(h),category);assert.equal(category.value,'news');assert.equal(JSON.parse(storage.get('kn_community_drafts_v1')).all.language,'en');
    assert.equal(h.node('.cw-reply-form').querySelector('textarea').value,'入力中の返信');assert.equal(h.nodes('label[data-cw-copy]').length,0);
    assert.equal(h.node('.cw-community-search').querySelector('input'),search);assert.equal(search.value,'表示用');
    assert.equal(search.placeholder,language==='ja'?'投稿・返信を検索':'Search posts and replies');
    assert.equal(h.nodes('.cw-view-tab').length,2);assert.equal(h.nodes('.cw-stock-talk-link').length,0);assert.equal(h.node('.cw-context-title').textContent,language==='ja'?'みんなのトーク':'Everyone’s Talk');assert.equal(h.node('.cw-composer').hidden,true);
  }
  h.node('.cw-composer').emit('submit');await h.settle();let payload=JSON.parse(h.calls.at(-1).options.body);assert.equal(payload.body,'入力中の投稿');assert.equal(payload.name,'表示名');assert.equal(payload.category,'news');assert.equal(payload.language,'en');
  await h.response({ok:true,post:post(21,{body:payload.body,category:'news',is_mine:true})});
  h.node('.cw-reply-form').emit('submit');await h.settle();payload=JSON.parse(h.calls.at(-1).options.body);assert.equal(payload.body,'入力中の返信');assert.equal(payload.parent_id,20);assert.equal(payload.category,'life');assert.equal(payload.language,'en');
  await h.response({ok:true,post:post(22,{parent_id:20,category:'life',body:payload.body,is_mine:true})});assert.equal(h.nodes('.cw-reply-post').length,1);
});
test('close button restores the original morning scroll position',async()=>{
  const h=harness();h.document.body.classList.add('view-asaletter');h.ui.open();assert.equal(h.document.body.classList.contains('view-asaletter'),false);await h.response({ok:true,posts:[],has_more:false});h.node('.cw-close').click();assert.equal(h.morning.scrollTop,177);assert.equal(h.document.getElementById('cmOv'),null);assert.equal(h.document.activeElement,h.node('#knHomeATalk'));assert.equal(h.hub.style.display,'none');
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
test('close leaves either conversation without reviving a legacy hub and aborts pending reads while preserving drafts',async()=>{
  for(const useStock of [false,true])for(const exit of ['.cw-close']){
    const h=harness(),stock=paired(h),conversation=useStock?stock:h.ui,other=h.document.createElement('div');other.id='talkHubOv';other.classList.add('open');h.document.body.appendChild(other);
    h.morning.scrollTop=0;conversation.open({morningTop:177});await h.settle();const request=h.pending[0];h.node('#cmInput').value='送信しない架空の下書き';h.node('#cmInput').emit('input');
    h.node(exit).click();assert.equal(h.nodes('.cw-screen').length,0);assert.equal(h.hub.style.display,'none');assert.equal(other.classList.contains('open'),false);assert.equal(h.morning.scrollTop,177);assert.equal(h.document.activeElement,h.node('#knHomeATalk'));assert.equal(h.timers.size,0);assert.equal(request.options.signal.aborted,true);
    for(const event of ['visibilitychange','langChanged','knAuthChange'])assert.equal(h.events.get(event).length,0);
    await h.response({ok:true,posts:[post(99,{body:'終了後の古い応答'})],has_more:false});assert.equal(h.nodes('.cw-screen').length,0);assert.equal(h.calls.filter(call=>call.options.method==='POST').length,0);
    conversation.open();await h.response({ok:true,posts:[],has_more:false});assert.equal(h.node('#cmInput').value,'送信しない架空の下書き');conversation.close();
  }
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
 await h.response({ok:true,posts:[],has_more:false});assert.equal(h.node('.cw-composer').hidden,true);h.node('.cw-compose-toggle').click();assert.equal(h.node('.cw-composer').hidden,false);assert.equal(h.document.activeElement,h.node('.cw-compose-body'));h.node('.cw-compose-body').value='トヨタの下書き';h.node('.cw-compose-body').emit('input');
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

test('separate conversation APIs clean up reads and retain drafts without cross-links in global Talk',async()=>{
 const h=harness(),stock=paired(h);stock.open();await h.settle();h.morning.scrollTop=0;
 assert.equal(h.node('.cw-context-title').textContent,'みんなの声');assert.equal(h.node('#stockTalkOv').getAttribute('aria-label'),'みんなの声');assert.equal(h.nodes('.cw-view-tab').length,2);
 const old=h.pending[0];h.node('#cmInput').value='銘柄の下書き';h.node('#cmInput').emit('input');h.ui.open();await h.settle();
 assert.equal(old.options.signal.aborted,true);assert.equal(h.nodes('.cw-screen').length,1);assert.equal(h.document.getElementById('stockTalkOv'),null);assert.equal(h.nodes('#cmInput').length,1);assertNoNicknameUI(h);assert.equal(h.window.knTalkLastView,'community');assert.equal(h.timers.size,1);
 assert.equal(h.node('.cw-context-title').textContent,'みんなのトーク');assert.equal(h.nodes('.cw-stock-talk-link').length,0);
 for(const event of ['visibilitychange','langChanged','knAuthChange'])assert.equal(h.events.get(event).length,1);
 await h.response({ok:true,posts:[post(999,{body:'古い銘柄の返答'})],has_more:false},200,0);assert.equal(h.nodes('.cw-post').length,0);
 await h.response({ok:true,posts:[post(9)],has_more:false});assert.equal(h.node('.cw-post').dataset.postId,'9');assert.equal(h.nodes('.cw-view-tabs').length,1);assert.equal(h.nodes('.cw-categories').length,0);
 const before=h.calls.length,root=h.node('#cmOv');h.ui.open();await h.settle();assert.equal(h.calls.length,before);assert.equal(h.node('#cmOv'),root);assert.equal(h.node('.cw-composer').hidden,true);assert.equal(h.timers.size,1);
 stock.open();await h.response({ok:true,posts:[],has_more:false});assert.equal(h.node('#cmInput').value,'銘柄の下書き');assert.equal(h.window.knTalkLastView,'stock');assert.equal(h.nodes('.cw-screen').length,1);h.node('.cw-close').click();assert.equal(h.morning.scrollTop,177,'both view transitions retain the original morning reading position');assert.equal(h.timers.size,0);
 for(const event of ['visibilitychange','langChanged','knAuthChange'])assert.equal(h.events.get(event).length,0);
});

test('reply drafts remain separate by conversation and topic across navigation without new persistent storage',async()=>{
 const h=harness(),stock=paired(h);h.ui.open();await h.response({ok:true,posts:[post(7)],has_more:false});
 h.node('#cmInput').value='一般の投稿下書き';h.node('#cmInput').emit('input');h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[],has_more:false});let input=h.node('.cw-reply-form').querySelector('textarea');input.value='一般の返信下書き';input.emit('input');
 stock.open();await h.response({ok:true,posts:[post(7,{category:'stock:7203'})],has_more:false});h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[],has_more:false});input=h.node('.cw-reply-form').querySelector('textarea');assert.equal(input.value,'');input.value='銘柄の返信下書き';input.emit('input');
 h.ui.open();await h.response({ok:true,posts:[post(7)],has_more:false});assert.equal(h.node('#cmInput').value,'一般の投稿下書き');h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[],has_more:false});assert.equal(h.node('.cw-reply-form').querySelector('textarea').value,'一般の返信下書き');
 stock.open();await h.response({ok:true,posts:[post(7,{category:'stock:7203'})],has_more:false});h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[],has_more:false});assert.equal(h.node('.cw-reply-form').querySelector('textarea').value,'銘柄の返信下書き');
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

test('successful reply cannot regain a stale draft after language rerender, collapse and navigation',async()=>{
 const h=harness(),stock=paired(h);h.ui.open();await h.response({ok:true,posts:[post(11)],has_more:false});h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[],has_more:false});const oldInput=h.node('.cw-reply-form').querySelector('textarea');oldInput.value='送信中の返信';oldInput.emit('input');h.node('.cw-reply-form').emit('submit');await h.settle();
 h.document.documentElement.lang='en';h.document.emit('langChanged');const rerendered=h.node('.cw-reply-form').querySelector('textarea');assert.notEqual(rerendered,oldInput);assert.equal(rerendered.value,'送信中の返信');h.node('.cw-reply-toggle').click();assert.equal(h.nodes('.cw-reply-form').length,0);
 await h.response({ok:true,post:post(12,{parent_id:11,body:'送信中の返信'})});stock.open();await h.response({ok:true,posts:[],has_more:false});h.ui.open();await h.response({ok:true,posts:[post(11,{reply_count:1})],has_more:false});h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[post(12,{parent_id:11,body:'送信中の返信'})],has_more:false});assert.equal(h.node('.cw-reply-form').querySelector('textarea').value,'');assert.equal(h.nodes('.cw-reply-post').length,1);assert.equal(h.calls.filter(call=>call.options.method==='POST').length,1);
});

test('saved historical community topic drafts remain selectable without splitting the live feed',async()=>{
 const original={all:{body:'コミュニティの下書き',category:'chat',language:'ja'},economy:{body:'以前の経済下書き',category:'economy',language:'en'},news:{body:'以前のニュース下書き',category:'news',language:'ja'}};
 const storage=new Map([['kn_community_drafts_v1',JSON.stringify(original)]]),h=harness({storage});h.ui.open();await h.response({ok:true,posts:[],has_more:false});
 assert.equal(h.node('#cmInput').value,original.all.body);assert.equal(h.nodes('.cw-category').length,0);assert.equal(h.nodes('.cw-categories').length,0);assert.equal(assertNoPostLanguageUI(h).parentNode.hidden,true,'legacy destination is not a visible genre selector');
 const chooser=h.node('.cw-saved-draft-label').querySelector('select');assert.deepEqual(chooser.querySelectorAll('option').map(option=>[option.value,option.textContent]),[['all','いまの下書き'],['economy','以前の下書き 1'],['news','以前の下書き 2']]);chooser.value='economy';chooser.emit('change');assert.equal(h.node('#cmInput').value,original.economy.body);assert.equal(assertNoPostLanguageUI(h).value,'economy');
 h.node('#cmInput').value='編集した以前の下書き';h.node('#cmInput').emit('input');chooser.value='all';chooser.emit('change');assert.equal(h.node('#cmInput').value,original.all.body);const saved=JSON.parse(storage.get('kn_community_drafts_v1'));assert.equal(saved.economy.body,'編集した以前の下書き');assert.equal(saved.economy.language,'en');assert.deepEqual(saved.news,original.news);assert.match(h.calls[0].url,/category=all/);assert.equal(h.calls.length,1,'choosing a saved draft does not switch the live feed');
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
 const h=harness();h.ui.open();await h.response({ok:true,posts:[],has_more:false});h.node('#cmInput').value='新しいつぶやき';h.node('#cmInput').emit('input');assert.equal(assertNoPostLanguageUI(h).value,'chat');h.ui.send();await h.settle();assert.equal(JSON.parse(h.calls.at(-1).options.body).category,'chat');await h.response({ok:true,post:post(30,{body:'新しいつぶやき',category:'chat',is_mine:true})});
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

test('legacy names remain stored without exposing nickname controls or rewriting the value',async()=>{
 const storage=new Map([['cm_nick','以前の名前']]),h=harness({storage}),writes=[];
 h.window.localStorage.setItem=(key,value)=>{writes.push(key);storage.set(key,value);};h.ui.open();await h.response({ok:true,posts:[],has_more:false});
 assertNoNicknameUI(h);h.node('#cmInput').value='下書き';h.node('#cmInput').emit('input');h.ui.close();
 assert.equal(storage.get('cm_nick'),'以前の名前');assert.equal(writes.filter(key=>key==='cm_nick').length,0);
});

test('profile names reach general and stock posts and replies without composer name controls or writes',async()=>{
 const storage=new Map([['cm_nick','以前の端末名']]),h=harness({storage}),writes=[];let profileSaves=0;
 h.window.KNUserProfile={username:()=>'メニューの名前',ready:async()=>{},saveUsername:async()=>{profileSaves++;}};
 h.window.localStorage.setItem=(key,value)=>{writes.push(key);storage.set(key,value);};h.ui.open();await h.response({ok:true,posts:[],has_more:false});assertNoNicknameUI(h);
 h.node('#cmInput').value='一般の投稿';h.ui.send();await h.settle();assert.equal(JSON.parse(h.calls.at(-1).options.body).name,'メニューの名前');await h.response({ok:true,post:post(40,{name:'メニューの名前',body:'一般の投稿'})});
 h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[],has_more:false});h.node('.cw-reply-form').querySelector('textarea').value='一般の返信';h.node('.cw-reply-form').emit('submit');await h.settle();assert.equal(JSON.parse(h.calls.at(-1).options.body).name,'メニューの名前');await h.response({ok:true,post:post(41,{name:'メニューの名前',parent_id:40})});h.ui.close();
 const stock=paired(h);stock.open();await h.response({ok:true,posts:[],has_more:false});assertNoNicknameUI(h);
 h.node('#cmInput').value='銘柄の投稿';stock.send();await h.settle();assert.equal(JSON.parse(h.calls.at(-1).options.body).name,'メニューの名前');await h.response({ok:true,post:post(50,{category:'stock:7203',name:'メニューの名前'})});
 h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[],has_more:false});h.node('.cw-reply-form').querySelector('textarea').value='銘柄の返信';h.node('.cw-reply-form').emit('submit');await h.settle();const reply=JSON.parse(h.calls.at(-1).options.body);assert.equal(reply.name,'メニューの名前');assert.equal(reply.parent_id,50);assert.match(h.calls.at(-1).url,/\/api\/stock-talk\/posts$/);await h.response({ok:true,post:post(51,{category:'stock:7203',parent_id:50,name:'メニューの名前'})});
 assertNoNicknameUI(h);stock.close();assert.equal(profileSaves,0);assert.equal(writes.filter(key=>key==='cm_nick').length,0);assert.equal(storage.get('cm_nick'),'以前の端末名');
});

test('fresh posts and replies use the latest name changed in the menu profile',async()=>{
 const h=harness();let name='以前のプロフィール名';h.window.KNUserProfile={username:()=>name,ready:async()=>{}};h.ui.open();await h.response({ok:true,posts:[],has_more:false});
 name='メニューで変更した名前';h.document.emit('knProfileChange');h.node('#cmInput').value='新しい投稿';h.ui.send();await h.settle();assert.equal(JSON.parse(h.calls.at(-1).options.body).name,name);await h.response({ok:true,post:post(30)});
 h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[],has_more:false});name='さらに変更した名前';h.document.emit('knProfileChange');h.node('.cw-reply-form').querySelector('textarea').value='返信';h.node('.cw-reply-form').emit('submit');await h.settle();assert.equal(JSON.parse(h.calls.at(-1).options.body).name,name);assertNoNicknameUI(h);
});

test('a legacy name read failure retains the loaded name without writing nickname storage',async()=>{
 const storage=new Map([['cm_nick','元の名前']]),h=harness({storage});let nicknameWrites=0;
 h.window.localStorage.setItem=(key,value)=>{if(key==='cm_nick'){nicknameWrites++;throw new Error('fixture storage denied');}storage.set(key,value);};h.ui.open();await h.response({ok:true,posts:[],has_more:false});
 h.window.localStorage.getItem=key=>{if(key==='cm_nick')throw new Error('fixture read denied');return storage.get(key)||null;};h.node('#cmInput').value='元の名前で投稿';h.ui.send();await h.settle();
 assert.equal(JSON.parse(h.calls.at(-1).options.body).name,'元の名前');assert.equal(storage.get('cm_nick'),'元の名前');assert.equal(nicknameWrites,0);assertNoNicknameUI(h);
});

test('blank legacy names keep anonymous posting without presenting a name editor',async()=>{
 const h=harness({logged:false,storage:new Map([['cm_nick','   ']])});h.window.knEnsureGuest=async()=>({access_token:'local-guest-fixture'});h.ui.open();await h.response({ok:true,posts:[],has_more:false});assertNoNicknameUI(h);
 h.node('#cmInput').value='匿名のまま投稿';h.ui.send();await h.settle();assert.equal(JSON.parse(h.calls.at(-1).options.body).name,'');assert.equal(h.authPrompts(),0);assert.equal(h.storage.get('cm_nick'),'   ');await h.response({ok:true,post:post(3,{name:'名無しさん'})});
});

test('profile names in post and reply authors remain literal text during language changes',async()=>{
 for(const name of ['ニュース','保存','<b>名前</b>']){
  const h=harness();h.window.KNUserProfile={username:()=>name,ready:async()=>{}};h.ui.open();await h.response({ok:true,posts:[post(20,{name,reply_count:1})],has_more:false});
  h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[post(21,{name,parent_id:20})],has_more:false});h.document.documentElement.lang='en';h.document.emit('langChanged');
  assert.equal(h.nodes('.cw-author').length,2);for(const author of h.nodes('.cw-author')){assert.equal(author.textContent,name);assert.equal(author.getAttribute('data-cw-copy'),null);assert.equal(author.children.length,0);}
  assertNoNicknameUI(h);h.node('#cmInput').value='名前を変更しない本文';h.ui.send();await h.settle();assert.equal(JSON.parse(h.calls.at(-1).options.body).name,name);
 }
});

test('an unknown-outcome retry keeps its original name and UUID after a menu profile change and reopening',async()=>{
 const storage=new Map(),h=harness({storage});let name='前の名前';h.window.KNUserProfile={username:()=>name,ready:async()=>{}};h.ui.open();await h.response({ok:true,posts:[],has_more:false});h.node('#cmInput').value='結果が不明の投稿';h.node('#cmInput').emit('input');h.ui.send();await h.settle();const first=JSON.parse(h.calls.at(-1).options.body);h.pending.shift().reject(new Error('fixture unknown outcome'));await h.settle();
 name='新しい名前';h.document.emit('knProfileChange');h.ui.close();const fresh=harness({storage});fresh.window.KNUserProfile={username:()=>name,ready:async()=>{}};let generated=0;fresh.window.crypto.randomUUID=()=>{generated++;return '20000000-0000-4000-8000-000000000001';};fresh.ui.open();await fresh.response({ok:true,posts:[],has_more:false});fresh.ui.send();await fresh.settle();const retry=JSON.parse(fresh.calls.at(-1).options.body);assert.equal(retry.request_id,first.request_id);assert.equal(retry.name,'前の名前');assert.equal(generated,0);assertNoNicknameUI(fresh);assert.match(fresh.node('.cw-notice').textContent,/前回と同じ/);await fresh.response({ok:true,post:post(50,{name:'前の名前',body:first.body})});
 fresh.node('#cmInput').value='別の新しい投稿';fresh.ui.send();await fresh.settle();const next=JSON.parse(fresh.calls.at(-1).options.body);assert.equal(next.name,'新しい名前');assert.notEqual(next.request_id,first.request_id);assert.equal(generated,1);
});

test('a confirmed invalid-name rejection uses the corrected menu profile name with a fresh request ID',async()=>{
 const h=harness();let name='前の名前';h.window.KNUserProfile={username:()=>name,ready:async()=>{}};h.ui.open();await h.response({ok:true,posts:[],has_more:false});h.node('#cmInput').value='明示拒否された投稿';h.ui.send();await h.settle();const first=JSON.parse(h.calls.at(-1).options.body);await h.response({ok:false,reason:'invalid_name'},400);assert.match(h.node('.cw-notice').textContent,/メニュー.*プロフィール/);
 name='修正した名前';h.document.emit('knProfileChange');h.ui.send();await h.settle();const next=JSON.parse(h.calls.at(-1).options.body);assert.equal(next.name,'修正した名前');assert.notEqual(next.request_id,first.request_id);
});

test('changing the menu profile during a pending post leaves its captured payload unchanged',async()=>{
 const h=harness();let name='送信時の名前';h.window.KNUserProfile={username:()=>name,ready:async()=>{}};h.ui.open();await h.response({ok:true,posts:[],has_more:false});h.node('#cmInput').value='送信中';h.ui.send();await h.settle();const sent=h.calls.at(-1),payload=JSON.parse(sent.options.body);
 name='次回からの名前';h.document.emit('knProfileChange');assert.deepEqual(JSON.parse(sent.options.body),payload);assert.equal(payload.name,'送信時の名前');await h.response({ok:true,post:post(1,{name:'送信時の名前'})});h.node('#cmInput').value='次の投稿';h.ui.send();await h.settle();assert.equal(JSON.parse(h.calls.at(-1).options.body).name,'次回からの名前');
});

test('menu profile updates are shared by chat composers and replies without sending other profile fields',async()=>{
 const h=harness({storage:new Map([['cm_nick','別アカウントの旧名']])});let name='メニューの名前',profileSaves=0;
 h.window.KNUserProfile={username:()=>name,ready:async()=>{},saveUsername:async()=>{profileSaves++;}};
 h.ui.open();await h.response({ok:true,posts:[],has_more:false});assertNoNicknameUI(h);h.node('#cmInput').value='共通名の投稿';h.ui.send();await h.settle();
 const payload=JSON.parse(h.calls.at(-1).options.body);assert.equal(payload.name,name);assert.deepEqual(Object.keys(payload).sort(),['body','category','language','name','parent_id','request_id']);
 await h.response({ok:true,post:post(30,{name})});name='プロフィールの新名';h.document.emit('knProfileChange');
 const stock=paired(h);stock.open();await h.response({ok:true,posts:[post(40,{category:'stock:7203'})],has_more:false});assertNoNicknameUI(h);
 h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[],has_more:false});h.node('.cw-reply-form').querySelector('textarea').value='共通名の返信';h.node('.cw-reply-form').emit('submit');await h.settle();const reply=JSON.parse(h.calls.at(-1).options.body);assert.equal(reply.name,name);assert.deepEqual(Object.keys(reply).sort(),['body','category','language','name','parent_id','request_id']);assert.equal(profileSaves,0);assert.equal(h.storage.get('cm_nick'),'別アカウントの旧名');
});
test('profile loading blocks duplicate sends and failure preserves the draft instead of using another account name',async()=>{
 const h=harness({storage:new Map([['cm_nick','以前のアカウント']])});let resolve;
 h.window.KNUserProfile={username:()=>'',ready:()=>new Promise(r=>{resolve=r;})};h.ui.open();await h.response({ok:true,posts:[],has_more:false});
 h.node('#cmInput').value='消さない下書き';h.ui.send();h.ui.send();await h.settle();assert.equal(h.calls.filter(c=>c.options.method==='POST').length,0);
 h.ui.close();resolve();await h.settle();assert.equal(h.calls.filter(c=>c.options.method==='POST').length,0);
 h.window.KNUserProfile.ready=async()=>{throw new Error('offline');};h.ui.open();await h.response({ok:true,posts:[],has_more:false});await h.ui.send();assert.match(h.node('.cw-notice').textContent,/ユーザー名を確認できません/);assert.equal(h.node('#cmInput').value,'消さない下書き');assert.equal(h.calls.filter(c=>c.options.method==='POST').length,0);
});

test('account switching while token lookup is pending cannot send an old profile name with the new account',async()=>{
 const h=harness();let name='アカウントA',resolve;h.window.knUser={id:'account-A',is_anonymous:false};h.window.KNUserProfile={username:()=>name,ready:async()=>{}};
 h.ui.open();await h.response({ok:true,posts:[],has_more:false});h.window.sb.auth.getSession=()=>new Promise(r=>{resolve=r;});h.node('#cmInput').value='アカウントをまたがない下書き';h.ui.send();await h.settle();
 h.window.knUser={id:'account-B',is_anonymous:false};name='アカウントB';resolve({data:{session:{access_token:'fixture-B'}}});await h.settle();assert.equal(h.calls.filter(c=>c.options.method==='POST').length,0);assert.equal(h.node('#cmInput').value,'アカウントをまたがない下書き');assert.match(h.node('.cw-notice').textContent,/アカウントが切り替わり/);
 h.window.sb.auth.getSession=async()=>({data:{session:{access_token:'fixture-B'}}});h.ui.send();await h.settle();assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1,'the next explicit send is a fresh B request because A never reached transport');assert.equal(JSON.parse(h.calls.at(-1).options.body).name,'アカウントB');
});

test('first anonymous session initialization may submit the current guest name without looking like an account switch',async()=>{
 const h=harness();h.window.KNUserProfile={username:()=>'初回の名前',ready:async()=>{}};h.window.knEnsureGuest=async()=>{h.window.knUser={id:'first-guest',is_anonymous:true};return {access_token:'first-guest-fixture'};};
 h.ui.open();await h.response({ok:true,posts:[],has_more:false});h.node('#cmInput').value='はじめての投稿';h.ui.send();await h.settle();assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1);assert.equal(JSON.parse(h.calls.at(-1).options.body).name,'初回の名前');
});

test('embedded company room retains the original surface without changing the global screen or morning state',async()=>{
 const storage=new Map([['kn_stock_talk_drafts_v1',JSON.stringify({'stock:1832':{body:'会社の下書き',category:'stock:1832',language:'ja'}})]]);
 const h=harness({storage}),stock=paired(h),host=h.document.createElement('div');h.document.body.appendChild(host);h.document.body.classList.add('view-asaletter');h.hub.style.display='block';
 const handle=stock.mountRoom(host,companyRoom());assert.ok(handle);await h.settle();
 assert.equal(h.node('#cpStockTalk').parentNode,host);assert.equal(h.nodes('#stockTalkOv').length,0);assert.equal(h.nodes('.cw-header').length,0);assert.equal(h.nodes('.cw-view-tabs').length,0);
 assert.equal(h.node('#cmInput').value,'会社の下書き');assert.equal(h.document.body.classList.contains('view-asaletter'),true);assert.equal(h.hub.style.display,'block');assert.equal(h.prepared(),0);assert.equal(h.window.knTalkLastView,undefined);assert.match(h.calls[0].url,/\/api\/stock-talk\/posts\?category=stock%3A1832/);assertNoNicknameUI(h);assertNoPostLanguageUI(h);
 handle.destroy();assert.equal(h.nodes('#cpStockTalk').length,0);assert.equal(h.prepared(),0);
});
test('embedded hide and resume keep composer and reply drafts while pausing recurring reads',async()=>{
 const h=harness(),stock=paired(h),host=h.document.createElement('div');h.document.body.appendChild(host);const handle=stock.mountRoom(host,companyRoom());await h.response({ok:true,posts:[post(20,{category:'stock:1832'})],has_more:false});
 h.node('.cw-reply-toggle').click();await h.response({ok:true,posts:[],has_more:false});const reply=h.node('.cw-reply-form').querySelector('textarea');reply.value='返信下書き';reply.emit('input');
 const input=h.node('#cmInput'),root=h.node('#cpStockTalk');input.value='投稿下書き';input.emit('input');const count=h.calls.length;handle.setVisible(false);assert.equal(root.hidden,true);assert.equal(h.timers.size,0);
 h.document.emit('visibilitychange');h.document.emit('knAuthChange');await h.settle();assert.equal(h.calls.length,count);
 handle.setVisible(true);assert.equal(root.hidden,false);assert.equal(h.node('#cmInput'),input);assert.equal(input.value,'投稿下書き');assert.equal(h.node('.cw-reply-form').querySelector('textarea').value,'返信下書き');assert.equal(h.timers.size,1);
 await h.response({ok:true,posts:[post(20,{category:'stock:1832'})],has_more:false});assert.equal(h.node('.cw-reply-form').querySelector('textarea').value,'返信下書き');handle.destroy();
});
test('tab hiding does not abort a pending post or erase the next draft when it succeeds',async()=>{
 const h=harness(),stock=paired(h),host=h.document.createElement('div');h.window.KN_REGISTRATION_REQUIRED=false;h.document.body.appendChild(host);const handle=stock.mountRoom(host,companyRoom());await h.response({ok:true,posts:[],has_more:false});
 const input=h.node('#cmInput');input.value='送信する文';input.emit('input');stock.send();await h.settle();const request=h.calls.at(-1);assert.equal(request.options.method,'POST');const id=JSON.parse(request.options.body).request_id;
 handle.setVisible(false);assert.equal(request.options.signal.aborted,false);input.value='次の下書き';input.emit('input');await h.response({ok:true,post:post(30,{category:'stock:1832',body:'送信する文',is_mine:true})});assert.equal(input.value,'次の下書き');assert.equal(h.node('#cpStockTalk').hidden,true);assert.equal(JSON.parse(h.storage.get('kn_stock_talk_drafts_v1'))['stock:1832'].body,'次の下書き');assert.ok(id);handle.destroy();
});
test('embedded destruction is owner-specific and only external close notifies its company host',async()=>{
 const h=harness(),stock=paired(h),host=h.document.createElement('div');h.document.body.appendChild(host);let closed=0;
 const first=stock.mountRoom(host,companyRoom(),{onClose(){closed++;}});await h.response({ok:true,posts:[],has_more:false});first.destroy();assert.equal(closed,0);
 const second=stock.mountRoom(host,companyRoom('6758','ソニー'),{onClose(){closed++;}});await h.response({ok:true,posts:[],has_more:false});first.destroy();assert.ok(h.node('#cpStockTalk'));stock.close();assert.equal(closed,1);second.destroy();assert.equal(closed,1);
});
test('global entry replaces an embedded room and releases its parent before building the full screen',async()=>{
 const h=harness(),stock=paired(h),host=h.document.createElement('div');h.document.body.appendChild(host);let closed=0;
 stock.mountRoom(host,companyRoom(),{onClose(){closed++;assert.equal(h.nodes('#cpStockTalk').length,0);}});await h.response({ok:true,posts:[],has_more:false});stock.open();await h.settle();assert.equal(closed,1);assert.equal(h.nodes('#cpStockTalk').length,0);assert.equal(h.nodes('#stockTalkOv').length,1);assert.equal(h.nodes('.cw-view-tab').length,2);
 await h.response({ok:true,posts:[],has_more:false});stock.close();
});
test('embedded fallback login releases the company host before opening auth and preserves the draft',async()=>{
 const h=harness({logged:false}),stock=paired(h),host=h.document.createElement('div');h.document.body.appendChild(host);const order=[];h.window.knRequireAuth=()=>true;h.window.openAuth=()=>order.push('auth');let handle;
 handle=stock.mountRoom(host,companyRoom(),{onAuthRequired(){order.push('release');handle.destroy();}});await h.response({ok:true,posts:[],has_more:false});h.node('#cmInput').value='未送信';h.node('#cmInput').emit('input');await stock.send();assert.deepEqual(order,['release','auth']);assert.equal(h.calls.filter(x=>x.options.method==='POST').length,0);assert.equal(JSON.parse(h.storage.get('kn_stock_talk_drafts_v1'))['stock:1832'].body,'未送信');
});
test('a read waiting for optional auth cannot start while the embedded panel is hidden',async()=>{
 const h=harness(),stock=paired(h),host=h.document.createElement('div');h.document.body.appendChild(host);let release,first=true;h.window.sb.auth.getSession=()=>first?(first=false,new Promise(resolve=>release=resolve)):Promise.resolve({data:{session:null}});
 const handle=stock.mountRoom(host,companyRoom());await h.settle();handle.setVisible(false);release({data:{session:null}});await h.settle();assert.equal(h.calls.length,0);handle.setVisible(true);await h.settle();assert.equal(h.calls.length,1);await h.response({ok:true,posts:[post(20,{category:'stock:1832',body:'最初の投稿が表示される'})],has_more:false});assert.equal(h.nodes('.cw-post').length,1);assert.equal(h.node('.cw-post-body').textContent,'最初の投稿が表示される');assert.equal(h.node('.cw-new-posts').hidden,true);handle.destroy();
});
test('global segmented navigation switches real conversations with keyboard support and separate drafts',async()=>{
 const h=harness(),stock=paired(h);h.ui.open();await h.response({ok:true,posts:[],has_more:false});let input=h.node('#cmInput');input.value='みんなの下書き';input.emit('input');
 let tabs=h.nodes('.cw-view-tab');assert.deepEqual(tabs.map(x=>x.textContent),['みんなの声','みんなのトーク']);assert.equal(tabs[1].getAttribute('aria-current'),'page');assert.equal(tabs.some(x=>x.getAttribute('aria-controls')!==null),false);
 h.node('.cw-view-tabs').emit('keydown',{target:tabs[1],key:'ArrowLeft'});await h.response({ok:true,posts:[],has_more:false});assert.equal(h.node('#stockTalkOv').isConnected,true);input=h.node('#cmInput');input.value='銘柄の下書き';input.emit('input');tabs=h.nodes('.cw-view-tab');assert.equal(h.document.activeElement,tabs[0]);
 h.node('.cw-view-tabs').emit('keydown',{target:tabs[0],key:'End'});await h.response({ok:true,posts:[],has_more:false});assert.equal(h.node('#cmInput').value,'みんなの下書き');assert.equal(h.node('.cw-view-tabs').getAttribute('aria-label'),'トークの画面');h.ui.close();
});

test('embedded legacy auth guard also releases the host before its own login UI opens',async()=>{
 const h=harness({logged:false}),stock=paired(h),host=h.document.createElement('div');h.document.body.appendChild(host);const order=[];let handle;
 h.window.KN_REGISTRATION_REQUIRED=true;h.window.knRequireAuth=()=>{order.push('auth');return false;};
 handle=stock.mountRoom(host,companyRoom(),{onAuthRequired(){order.push('release');handle.destroy();}});await h.response({ok:true,posts:[],has_more:false});h.node('#cmInput').value='認証前の下書き';h.node('#cmInput').emit('input');await stock.send();assert.deepEqual(order,['release','auth']);assert.equal(h.nodes('#cpStockTalk').length,0);assert.equal(h.calls.filter(x=>x.options.method==='POST').length,0);
});

test('paused optional-auth paging resumes as an append read and keeps the existing page',async()=>{
 const h=harness(),stock=paired(h),host=h.document.createElement('div');h.document.body.appendChild(host);const handle=stock.mountRoom(host,companyRoom());await h.response({ok:true,posts:[post(20,{category:'stock:1832'})],has_more:true,next_cursor:20});
 let release,first=true;h.window.sb.auth.getSession=()=>first?(first=false,new Promise(resolve=>release=resolve)):Promise.resolve({data:{session:null}});
 h.node('.cw-more').click();await h.settle();handle.setVisible(false);release({data:{session:null}});await h.settle();assert.equal(h.calls.length,1);
 handle.setVisible(true);await h.settle();assert.equal(h.calls.length,2);assert.match(h.calls.at(-1).url,/before=20/);await h.response({ok:true,posts:[post(19,{category:'stock:1832',body:'次のページ'})],has_more:false});
 assert.deepEqual(h.nodes('.cw-post').map(x=>x.dataset.postId),['20','19']);assert.equal(h.node('.cw-new-posts').hidden,true);handle.destroy();
});
test('paused optional-auth replies resume their actual thread read without losing the reply draft',async()=>{
 const h=harness(),stock=paired(h),host=h.document.createElement('div');h.document.body.appendChild(host);const handle=stock.mountRoom(host,companyRoom());const head=post(20,{category:'stock:1832',reply_count:1});await h.response({ok:true,posts:[head],has_more:false});
 let release,first=true;h.window.sb.auth.getSession=()=>first?(first=false,new Promise(resolve=>release=resolve)):Promise.resolve({data:{session:null}});
 h.node('.cw-reply-toggle').click();await h.settle();const draft=h.node('.cw-reply-form').querySelector('textarea');draft.value='返信の下書き';draft.emit('input');handle.setVisible(false);release({data:{session:null}});await h.settle();assert.equal(h.calls.length,1);
 handle.setVisible(true);await h.settle();assert.equal(h.calls.filter(x=>/\/replies\?/.test(x.url)).length,1);await h.response({ok:true,posts:[post(21,{category:'stock:1832',parent_id:20,body:'実際の返信'})],has_more:false});
 await h.response({ok:true,posts:[head],has_more:false});assert.equal(h.node('.cw-reply-post').querySelector('.cw-post-body').textContent,'実際の返信');assert.equal(h.node('.cw-reply-form').querySelector('textarea').value,'返信の下書き');handle.destroy();
});
test('paused optional-auth archive resumes only the open incomplete archive and replaces its loading state',async()=>{
 const h=harness(),stock=paired(h),host=h.document.createElement('div');h.document.body.appendChild(host);const handle=stock.mountRoom(host,companyRoom());await h.response({ok:true,posts:[],has_more:false});
 let release,first=true;h.window.sb.auth.getSession=()=>first?(first=false,new Promise(resolve=>release=resolve)):Promise.resolve({data:{session:null}});
 const archive=h.node('.cw-archive');archive.open=true;archive.emit('toggle');await h.settle();handle.setVisible(false);release({data:{session:null}});await h.settle();assert.equal(h.calls.length,1);
 handle.setVisible(true);await h.settle();assert.equal(h.calls.filter(x=>/\/api\/stock-comments/.test(x.url)).length,1);await h.response({ok:true,comments:[{id:7,name:'過去の表示例',body:'保存済みの過去の会話',created_at:'2026-10-12T00:00:00Z'}]});await h.response({ok:true,posts:[],has_more:false});
 assert.equal(h.node('.cw-legacy-post').querySelector('.cw-post-body').textContent,'保存済みの過去の会話');assert.doesNotMatch(h.node('.cw-archive-body').textContent,/読み込み中/);handle.destroy();
});


test('general Talk plus opens the existing composer and closing preserves the draft without requests',async()=>{
 const h=harness();h.ui.open();await h.response({ok:true,posts:[post(4)],has_more:false});
 const toggle=h.node('.cw-compose-add'),form=h.node('.cw-composer'),input=h.node('#cmInput'),calls=h.calls.length;
 assert.equal(form.hidden,true);assert.equal(toggle.getAttribute('aria-controls'),form.id);assert.equal(toggle.getAttribute('aria-expanded'),'false');
 assert.equal(toggle.getAttribute('aria-label'),'投稿する');assert.equal(toggle.textContent,'＋');
 toggle.click();assert.equal(form.hidden,false);assert.equal(h.document.activeElement,input);assert.equal(toggle.getAttribute('aria-expanded'),'true');assert.equal(toggle.getAttribute('aria-label'),'投稿欄を閉じる');
 input.value='プラスから書いた下書き';input.emit('input');toggle.click();
 assert.equal(form.hidden,true);assert.equal(h.document.activeElement,toggle);assert.equal(toggle.getAttribute('aria-expanded'),'false');assert.equal(toggle.getAttribute('aria-label'),'投稿する');
 assert.equal(JSON.parse(h.storage.get('kn_community_drafts_v1')).all.body,input.value);
 toggle.click();assert.equal(h.node('.cw-composer'),form);assert.equal(h.node('#cmInput'),input);assert.equal(input.value,'プラスから書いた下書き');assert.equal(h.calls.length,calls);
});

test('general Talk plus remains collapsed on re-entry and preserves drafts across existing view tabs',async()=>{
 const h=harness(),stock=paired(h);h.ui.open();await h.response({ok:true,posts:[],has_more:false});
 h.node('.cw-compose-add').click();h.node('#cmInput').value='切替後も残す';h.node('#cmInput').emit('input');
 h.nodes('.cw-view-tab')[0].click();await h.response({ok:true,posts:[],has_more:false});assert.equal(h.nodes('.cw-compose-add').length,0);
 assert.equal(h.node('.cw-compose-toggle').textContent,'つぶやく');assert.equal(h.node('.cw-composer').hidden,true);
 h.nodes('.cw-view-tab')[1].click();await h.response({ok:true,posts:[],has_more:false});
 assert.equal(h.node('.cw-composer').hidden,true);assert.equal(h.node('#cmInput').value,'切替後も残す');
 h.node('.cw-compose-add').click();assert.equal(h.node('#cmInput').value,'切替後も残す');stock.close();
});

test('hiding general composer never cancels an in-flight post or discards a later draft',async()=>{
 const h=harness();h.ui.open();await h.response({ok:true,posts:[],has_more:false});
 const toggle=h.node('.cw-compose-add');toggle.click();h.node('#cmInput').value='送信する本文';h.node('#cmInput').emit('input');
 h.node('.cw-composer').emit('submit');await h.settle();const pending=h.calls.at(-1);assert.equal(pending.options.method,'POST');
 h.node('#cmInput').value='次の下書き';h.node('#cmInput').emit('input');toggle.click();assert.equal(pending.options.signal.aborted,false);
 h.node('.cw-composer').emit('submit');await h.settle();assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1);
 await h.response({ok:true,post:post(12,{body:'送信する本文',is_mine:true})});
 assert.equal(h.node('.cw-composer').hidden,true);assert.equal(h.node('#cmInput').value,'次の下書き');
 toggle.click();assert.equal(h.node('#cmInput').value,'次の下書き');assert.equal(h.nodes('.cw-post').length,1);
});

test('general Talk plus keeps its icon and accessible action in sync when language changes',async()=>{
 const h=harness();h.ui.open();await h.response({ok:true,posts:[],has_more:false});const toggle=h.node('.cw-compose-add');
 toggle.click();h.document.documentElement.lang='en';h.document.emit('langChanged');
 assert.equal(toggle.textContent,'＋');assert.equal(toggle.getAttribute('aria-label'),'Close post composer');assert.equal(toggle.getAttribute('aria-expanded'),'true');
 toggle.click();assert.equal(toggle.getAttribute('aria-label'),'Post');assert.equal(toggle.textContent,'＋');assert.equal(h.node('.cw-composer').hidden,true);
});

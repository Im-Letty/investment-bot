'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const source=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes("var fab=document.getElementById('knChatFab')"));
assert.ok(source,'exercise the actual inline assistant controller');
function harness({storage=new Map()}={}){
 const calls=[],pending=[],timers=[],events=new Map();
 class Node{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attrs={};this.events=new Map();this.style={};this.disabled=false;this.value='';this.scrollHeight=80;this._text='';this._html='';this._classes=new Set();this.classList={add:n=>this._classes.add(n),remove:n=>this._classes.delete(n),contains:n=>this._classes.has(n)};}
  set className(s){this._classes=new Set(s.split(/\s+/));}get className(){return [...this._classes].join(' ');}
  set id(s){this.attrs.id=s;}get id(){return this.attrs.id||'';}
  set textContent(s){this._text=String(s);this._html='';this.children=[];}get textContent(){return this._text+this._html+this.children.map(n=>n.textContent).join('');}
  set innerHTML(s){this._html=s;this._text='';this.children.forEach(n=>n.parentNode=null);this.children=[];}get innerHTML(){return this._html;}
  setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}
  appendChild(n){n.parentNode?.removeChild(n);n.parentNode=this;this.children.push(n);return n;}
  insertBefore(n,before){n.parentNode?.removeChild(n);n.parentNode=this;this.children.splice(this.children.indexOf(before),0,n);return n;}
  removeChild(n){this.children.splice(this.children.indexOf(n),1);n.parentNode=null;}
  remove(){this.parentNode?.removeChild(this);}
  addEventListener(k,f){if(!this.events.has(k))this.events.set(k,[]);this.events.get(k).push(f);}
  emit(k,extra={}){for(const f of this.events.get(k)||[])f({target:this,preventDefault(){},...extra});}
  click(){if(!this.disabled)this.emit('click');}focus(){document.activeElement=this;}
  querySelectorAll(selector){const result=[];const match=n=>selector.startsWith('#')?n.id===selector.slice(1):selector.split('.').filter(Boolean).every(c=>n._classes.has(c));function walk(n){for(const child of n.children){if(match(child))result.push(child);walk(child);}}walk(this);return result;}
 }
 const document={body:new Node('body'),documentElement:{lang:'ja'},activeElement:null,createElement:tag=>new Node(tag),getElementById(id){return this.body.querySelectorAll('#'+id)[0]||null;},addEventListener(k,f){if(!events.has(k))events.set(k,[]);events.get(k).push(f);},emit(k){for(const f of events.get(k)||[])f();}};
 const nodes={};for(const [id,tag] of [['knChatFab','button'],['knChatPanel','div'],['knChatBody','div'],['knChatInput','textarea'],['knChatSend','button'],['knChatX','button'],['knGuideBtn','button']]){const n=new Node(tag);n.id=id;nodes[id]=n;}
 document.body.appendChild(nodes.knChatFab);document.body.appendChild(nodes.knChatPanel);for(const id of ['knChatX','knGuideBtn','knChatBody','knChatInput','knChatSend'])nodes.knChatPanel.appendChild(nodes[id]);
 const context={document,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v))},setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},fetch(url,options){calls.push({url,options});return new Promise((resolve,reject)=>pending.push({url,resolve,reject}));}};context.window=context;
 vm.runInNewContext(source,context,{filename:'index.html: actual assistant IIFE'});
 const settle=()=>new Promise(resolve=>setImmediate(resolve));
 async function reply(data,index=0){await settle();assert.ok(pending[index]);pending.splice(index,1)[0].resolve({json:async()=>data,text:async()=>JSON.stringify(data)});await settle();}
 return {context,document,nodes,calls,pending,timers,storage,settle,reply,chat:context.KNAssistChat,chips:()=>nodes.knChatBody.querySelectorAll('.kn-chip'),hint:()=>document.getElementById('knChatSuggestRefresh'),runTimers(){timers.splice(0).forEach(t=>t.fn());}};
}
test('open, close, tabs and locale keep the same input and send no automatic requests',()=>{
 const h=harness(),input=h.nodes.knChatInput;h.chat.open({focusInput:false});assert.equal(h.chips().length,8);input.value='未送信の質問';
 h.chat.close();h.chat.open({focusInput:false});h.document.documentElement.lang='en';h.document.emit('langChanged');assert.equal(h.nodes.knChatInput,input);assert.equal(input.value,'未送信の質問');assert.equal(h.hint().textContent,'Refresh question ideas');assert.equal(h.hint().type,'button');assert.equal(h.calls.length,0);assert.equal(h.timers.length,0);
 for(const [language,label] of [['ko','질문 힌트 새로고침'],['zh','更新问题提示'],['ja','質問のヒントを更新']]){h.document.documentElement.lang=language;h.document.emit('langChanged');assert.equal(h.hint().getAttribute('aria-label'),label);}
 assert.equal(h.calls.length,0);
});
test('only explicit hint refresh calls suggestions and retains all eight connected topics',async()=>{
 const h=harness();h.chat.open({focusInput:false});const fixed=h.chips().map(n=>n.textContent);h.hint().click();const same=h.chat.requestSuggestions();assert.equal(h.calls.length,1);assert.equal(h.hint().disabled,true);assert.equal(h.calls[0].url,'/api/chat-suggestions');assert.deepEqual(JSON.parse(h.calls[0].options.body),{interests:[]});
 await h.reply({chips:['NISAって何？','新しい質問','新しい質問','追加の質問']});await same;assert.equal(h.hint().disabled,false);assert.deepEqual(h.chips().map(n=>n.textContent),[...fixed,'新しい質問','追加の質問']);h.chat.close();h.chat.open({focusInput:false});assert.equal(h.calls.length,1);assert.equal(h.chips().length,10);
});
test('every fixed topic has a real existing ask handler; installment explanation stays local',async()=>{
 const labels=['NISAって何？','PERって何？','ドルコスト平均法って？','家計簿のコツは？','つみたての考え方は？','投資ってなに？','毎月いくらから始める？','元本割れがこわい'];
 for(const label of labels){const h=harness();h.chat.open({focusInput:false});h.chips().find(n=>n.textContent===label).click();await h.settle();if(label==='つみたての考え方は？'){assert.equal(h.calls.length,0);assert.match(h.nodes.knChatBody.textContent,/分散投資/);assert.equal(h.storage.has('knChatHist_v1'),false);}else{assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,'/api/chat');const payload=JSON.parse(h.calls[0].options.body);assert.deepEqual(payload,{messages:[{role:'user',content:label}]});assert.equal(payload.mode,undefined);await h.reply({reply:'回答例'});}}
});
test('successful answers and a new unsent question survive tab and language changes',async()=>{
 const h=harness();h.chat.open({focusInput:false});h.nodes.knChatInput.value='相場の質問';h.nodes.knChatSend.click();await h.reply({reply:'既存の回答'});const before=h.nodes.knChatBody.children.filter(n=>n.textContent.includes('既存の回答'));assert.equal(before.length,1);h.nodes.knChatInput.value='次の未送信文';h.chat.close();h.chat.open({focusInput:false});h.document.documentElement.lang='en';h.document.emit('langChanged');assert.ok(h.nodes.knChatBody.children.includes(before[0]));assert.equal(h.nodes.knChatInput.value,'次の未送信文');assert.equal(h.calls.length,1);assert.deepEqual(JSON.parse(h.storage.get('knChatHist_v1')),[{role:'user',content:'相場の質問'},{role:'assistant',content:'既存の回答'}]);
});
test('unknown result keeps the original three retries and its error survives reopening',async()=>{
 const h=harness();h.chat.open({focusInput:false});h.nodes.knChatInput.value='失敗例';h.nodes.knChatSend.click();await h.reply({});for(let i=0;i<2;i++){assert.equal(h.timers.at(-1).ms,1500);h.runTimers();await h.settle();await h.reply({});}assert.equal(h.calls.length,3);assert.ok(h.calls.every(c=>c.url==='/api/chat'));assert.equal(h.nodes.knChatSend.disabled,false);const errors=h.nodes.knChatBody.children.filter(n=>n.classList.contains('err'));assert.equal(errors.length,1);h.nodes.knChatInput.value='入力を保持';h.chat.close();h.chat.open({focusInput:false});assert.ok(h.nodes.knChatBody.children.includes(errors[0]));assert.equal(h.nodes.knChatInput.value,'入力を保持');
});
test('fab chooses the shared guide route and retains the original toggle fallback',()=>{
 const h=harness(),destinations=[];h.context.openSiteGuide=mode=>destinations.push(mode);h.nodes.knChatFab.click();assert.deepEqual(destinations,['chat']);assert.equal(h.nodes.knChatPanel.classList.contains('open'),false);assert.equal(h.calls.length,0);delete h.context.openSiteGuide;h.nodes.knChatFab.click();assert.equal(h.nodes.knChatPanel.classList.contains('open'),true);h.nodes.knChatFab.click();assert.equal(h.nodes.knChatPanel.classList.contains('open'),false);h.chat.open({focusInput:false});h.nodes.knChatX.click();assert.equal(h.nodes.knChatPanel.classList.contains('open'),false);
});
test('optional focus and close before the delayed callback never move focus to hidden input',()=>{
 const h=harness(),opener={};h.document.activeElement=opener;h.chat.open({focusInput:false});assert.equal(h.timers.length,0);assert.equal(h.document.activeElement,opener);h.chat.open();assert.equal(h.timers[0].ms,50);h.chat.close();h.runTimers();assert.equal(h.document.activeElement,opener);h.chat.open();h.runTimers();assert.equal(h.document.activeElement,h.nodes.knChatInput);
});
test('existing storage keys and last twenty saved history entries are preserved',async()=>{
 const history=Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',content:'以前'+i})),storage=new Map([['knChatHist_v1',JSON.stringify(history)],['private-fixture','unchanged']]);const h=harness({storage});h.chat.open({focusInput:false});h.nodes.knChatInput.value='続き';h.nodes.knChatSend.click();await h.reply({reply:'続きの回答'});const saved=JSON.parse(storage.get('knChatHist_v1'));assert.equal(saved.length,20);assert.deepEqual(saved.slice(-2),[{role:'user',content:'続き'},{role:'assistant',content:'続きの回答'}]);assert.equal(storage.get('private-fixture'),'unchanged');assert.deepEqual([...storage.keys()],['knChatHist_v1','private-fixture']);
});

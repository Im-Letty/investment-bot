'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const market=require('../static/market-data.js');
const source=fs.readFileSync(path.join(__dirname,'../static/home-a.js'),'utf8');
const catalogWindow={};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static/market-catalog.js'),'utf8'),{window:catalogWindow});
const catalog=JSON.parse(JSON.stringify(catalogWindow.KN_MARKET_CATALOG));
const featured=['日経225','ドル円','S&P500','NYダウ','7203.T','AAPL'];
const decode=value=>String(value).replace(/&(amp|lt|gt|quot|#39);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"})[key]);

// Only DOM mechanics are simulated; all picker rendering and event handlers
// come from home-a.js, and local search uses the real market data model.
function documentHarness(){
 const doc={documentElement:{lang:'ja'},activeElement:null};
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.attrs={};this.dataset={};this.listeners={};this.value='';this.checked=false;this.disabled=false;this.open=false;this._html='';this._text='';}
  setAttribute(key,value){this.attrs[key]=String(value);if(key==='id')this.id=String(value);if(key==='value')this.value=decode(value);if(key==='checked')this.checked=true;if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=decode(value);}
  getAttribute(key){return this.attrs[key]??null;}
  appendChild(node){node.parentElement=this;this.children.push(node);return node;}
  contains(node){return !!node&&(node===this||this.children.some(child=>child.contains(node)));}
  matches(selector){if(selector[0]==='#')return this.id===selector.slice(1);if(selector[0]==='[')return Object.hasOwn(this.attrs,selector.slice(1,-1));return this.tagName===selector.toUpperCase();}
  closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}
  querySelectorAll(selector){
   const parts=selector.split(/\s+/),last=parts.pop(),all=this.children.flatMap(child=>[child,...child.querySelectorAll('*')]);
   return all.filter(node=>(last==='*'||node.matches(last))&&(!parts.length||node.parentElement?.closest(parts.join(' '))));
  }
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  addEventListener(type,listener){(this.listeners[type]||=[]).push(listener);}
  dispatch(type,values={}){
   const event={type,target:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...values};
   for(let node=this;node;node=['click','change','input'].includes(type)?node.parentElement:null){
    for(const listener of node.listeners[type]||[])listener(event);
    if(typeof node['on'+type]==='function')node['on'+type](event);
   }
   return event;
  }
  focus(){doc.activeElement=this;}
  showModal(){this.open=true;}
  close(){if(this.open){this.open=false;this.dispatch('close');}}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set textContent(value){this.children=[];this._text=String(value);this._html='';}
  get innerHTML(){return this._html;}
  set innerHTML(value){
   if(this.contains(doc.activeElement))doc.activeElement=doc.body;
   this._html=String(value);this.children=[];this._text='';
   const stack=[this];
   for(const token of this._html.match(/<[^>]+>|[^<]+/g)||[]){
    if(token.startsWith('</')){stack.pop();continue;}
    if(token[0]!=='<'){stack.at(-1)._text+=decode(token);continue;}
    const match=token.match(/^<([\w-]+)([^>]*)>/);if(!match)continue;
    const node=new Element(match[1]);
    for(const attr of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))node.setAttribute(attr[1],decode(attr[2]??''));
    stack.at(-1).appendChild(node);
    if(!['INPUT','BR','HR','IMG','META','LINK'].includes(node.tagName)&&!token.endsWith('/>'))stack.push(node);
   }
  }
 }
 doc.body=new Element('body');doc.activeElement=doc.body;
 doc.createElement=tag=>new Element(tag);
 doc.getElementById=id=>doc.body.querySelector('#'+id);
 return doc;
}

async function flush(){for(let i=0;i<12;i++)await Promise.resolve();}
function harness(saved={}){
 const doc=documentHarness(),requests=[],timers=new Map();let timerId=0,now=0;
 const stored=new Map(Object.entries(saved)),storage={getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)};
 const model=market.create({catalog,storage,fetch:async()=>({ok:false})});
 model.search=(query,options)=>new Promise((resolve,reject)=>requests.push({query,signal:options.signal,resolve,reject}));
 const window={KNMarketData:market};
 const context={window,document:doc,localStorage:storage,AbortController,
  setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id)};
 const end=source.indexOf('  function decoratePanels()');assert.ok(end>0);
 vm.runInNewContext(source.slice(0,end)+'window.mountPickerForTest=function(value){model=value;makePicker();return openPicker;};})();',context);
 const open=window.mountPickerForTest(model);open();
 const node=id=>doc.getElementById(id),input=node('knMarketQuery'),dialog=node('knMarketPicker');
 return {doc,window,model,node,input,dialog,requests,timers,open,stored,
  type(value,extra={}){input.value=value;input.dispatch('input',extra);},
  ids(){return node('knMarketOptions').querySelectorAll('input').map(option=>option.value);},
  advance(ms){now+=ms;for(const [id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}},
  async reply(index,items,unavailable=false){requests[index].resolve({items,unavailable});await flush();}};
}
const remote=(id,label)=>({id,symbol:id,label,category:'custom',pickerGroup:'stocks'});

test('picker starts with six familiar markets and searches the complete bundled catalog',async()=>{
 const h=harness();assert.deepEqual(h.ids(),featured);assert.equal(h.node('knMarketResultCount').textContent,'6件');assert.equal(h.requests.length,0);
 assert.equal(h.node('knMarketOptions').textContent,'日経225ドル円S&P500NYダウトヨタ自動車7203AppleAAPL');
 assert.equal(h.dialog.querySelectorAll('input').filter(input=>input.getAttribute('type')==='search').length,1);
 for(const query of ['任天堂','7974']){
  h.type(query);assert.deepEqual(h.ids(),['7974.T']);assert.equal(h.node('knMarketOptionsTitle').textContent,'検索結果');
 }
 h.type('日本');const expected=h.model.searchLocal('日本').map(item=>item.id);
 assert.ok(expected.length>6,'Fixture searches more than the featured set');assert.deepEqual(h.ids(),expected);
 assert.equal(h.requests.length,0);h.advance(350);assert.equal(h.requests.length,1);assert.equal(h.requests[0].query,'日本');
 await h.reply(0,h.model.searchLocal('日本'));assert.deepEqual(h.ids(),expected);
});

test('picker accepts six, rejects a seventh, and restores all six when reopened',()=>{
 const h=harness();assert.equal(h.node('knMarketCount').textContent,'4 / 6');
 function choose(id){
  const option=h.node('knMarketOptions').querySelectorAll('input').find(input=>input.value===id);
  assert.ok(option,id);option.checked=true;option.dispatch('change');return option;
 }
 choose('7203.T');choose('AAPL');assert.equal(h.node('knMarketCount').textContent,'6 / 6');
 h.type('任天堂');assert.equal(choose('7974.T').checked,false);
 assert.match(h.node('knMarketError').textContent,/最大6つ/);assert.equal(h.node('knMarketCount').textContent,'6 / 6');
 h.node('knMarketForm').dispatch('submit');
 const six=['日経225','ドル円','S&P500','NYダウ','7203.T','AAPL'];
 assert.deepEqual(h.model.selection(),six);assert.deepEqual(JSON.parse(h.stored.get('morn_sel')),six);assert.equal(h.dialog.open,false);
 h.open();assert.equal(h.node('knMarketCount').textContent,'6 / 6');
 assert.deepEqual(h.node('knMarketOptions').querySelectorAll('input').filter(input=>input.checked).map(input=>input.value),six);
 assert.equal(h.node('knMarketSelected'),null,'Selected choices are not copied into a moving header');
 const reloaded=harness(Object.fromEntries(h.stored));
 assert.equal(reloaded.node('knMarketCount').textContent,'6 / 6');assert.deepEqual(reloaded.model.selection(),six);
});

test('removing a selected market frees a slot for another market at the six-item limit',()=>{
 const six=['日経225','ドル円','S&P500','NYダウ','7203.T','AAPL'],h=harness({morn_sel:JSON.stringify(six)});
 const remove=h.node('knMarketOptions').querySelectorAll('input').find(node=>node.value==='AAPL');remove.checked=false;remove.dispatch('change');
 assert.equal(h.node('knMarketCount').textContent,'5 / 6');h.type('任天堂');
 const option=h.node('knMarketOptions').querySelector('input');option.checked=true;option.dispatch('change');
 assert.equal(option.checked,true);assert.equal(h.node('knMarketError').textContent,'');assert.equal(h.node('knMarketCount').textContent,'6 / 6');
 h.node('knMarketForm').dispatch('submit');assert.deepEqual(h.model.selection(),[...six.slice(0,-1),'7974.T']);
});

test('checking and unchecking leave the candidate nodes, order, and focus in place',()=>{
 const h=harness(),options=h.node('knMarketOptions'),nodes=options.querySelectorAll('input'),labels=options.children.slice();
 const option=nodes.find(input=>input.value==='7203.T');option.focus();
 for(const checked of [true,false,true]){
  option.checked=checked;option.dispatch('change');
  assert.equal(h.doc.activeElement,option,'Checking keeps focus on the same checkbox');
  assert.deepEqual(options.querySelectorAll('input'),nodes,'No checkbox is recreated or moved to the top');
  assert.deepEqual(options.children,labels,'Candidate rows retain their original identity and order');
  assert.deepEqual(h.ids(),featured);
  assert.equal(h.node('knMarketCount').textContent,checked?'5 / 6':'4 / 6');
 }
 assert.equal(h.node('knMarketSelected'),null);
 assert.equal(h.dialog.querySelectorAll('[data-kn-remove]').length,0);
});

test('saved nonfeatured choices can be unchecked and remain in place until the dialog closes',()=>{
 const selected=['日経225','7974.T'],h=harness({morn_sel:JSON.stringify(selected)});
 assert.deepEqual(h.ids(),[...featured,'7974.T']);
 const nodes=h.node('knMarketOptions').querySelectorAll('input'),option=nodes.at(-1);assert.equal(option.checked,true);
 option.focus();option.checked=false;option.dispatch('change');
 assert.deepEqual(h.ids(),[...featured,'7974.T']);assert.deepEqual(h.node('knMarketOptions').querySelectorAll('input'),nodes);
 assert.equal(h.doc.activeElement,option);assert.equal(h.node('knMarketCount').textContent,'1 / 6');
 h.type('');assert.deepEqual(h.ids(),[...featured,'7974.T']);assert.equal(h.node('knMarketOptions').querySelectorAll('input').at(-1).checked,false);
 h.node('knMarketForm').dispatch('submit');assert.deepEqual(h.model.selection(),['日経225']);
 h.open();assert.deepEqual(h.ids(),featured,'An unchecked extra is omitted only on a later opening');
});

test('a searched choice remains available for unchecking after clearing search',async()=>{
 const h=harness();h.type('NEW');h.advance(350);await h.reply(0,[remote('NEW','検索で見つけた会社')]);
 const searched=h.node('knMarketOptions').querySelector('input');searched.focus();searched.checked=true;searched.dispatch('change');
 assert.equal(h.node('knMarketOptions').querySelector('input'),searched);assert.equal(h.doc.activeElement,searched);
 assert.equal(h.node('knMarketCount').textContent,'5 / 6');
 h.type('');assert.deepEqual(h.ids(),[...featured,'NEW']);
 const nodes=h.node('knMarketOptions').querySelectorAll('input'),extra=nodes.at(-1);assert.equal(extra.checked,true);
 extra.focus();extra.checked=false;extra.dispatch('change');
 assert.deepEqual(h.node('knMarketOptions').querySelectorAll('input'),nodes);assert.equal(h.doc.activeElement,extra);
 assert.deepEqual(h.ids(),[...featured,'NEW']);assert.equal(h.node('knMarketCount').textContent,'4 / 6');
 h.node('knMarketForm').dispatch('submit');assert.deepEqual(h.model.selection(),featured.slice(0,4));
});

test('canceling discards draft checks and leaves the saved selection untouched',()=>{
 const selected=['日経225','7974.T'],saved=JSON.stringify(selected),h=harness({morn_sel:saved});
 const options=h.node('knMarketOptions').querySelectorAll('input'),old=options.find(input=>input.value==='7974.T'),added=options.find(input=>input.value==='AAPL');
 old.checked=false;old.dispatch('change');added.checked=true;added.dispatch('change');
 assert.deepEqual(h.model.selection(),selected);assert.equal(h.stored.get('morn_sel'),saved);
 h.dialog.querySelector('[data-kn-close]').dispatch('click');assert.equal(h.dialog.open,false);
 assert.deepEqual(h.model.selection(),selected);assert.equal(h.stored.get('morn_sel'),saved);
 h.open();assert.deepEqual(h.node('knMarketOptions').querySelectorAll('input').filter(input=>input.checked).map(input=>input.value),selected);
});

test('typing invalidates old responses immediately, even before the next debounce runs',async()=>{
 const h=harness();h.type('old');h.advance(350);assert.equal(h.requests.length,1);
 h.type('任天堂');assert.equal(h.requests[0].signal.aborted,true);assert.deepEqual(h.ids(),['7974.T']);
 await h.reply(0,[remote('OLD','古い結果')]);assert.deepEqual(h.ids(),['7974.T']);
 h.advance(350);h.type('new');h.advance(350);assert.equal(h.requests.length,3);assert.equal(h.requests[1].signal.aborted,true);
 await h.reply(2,[remote('NEW','新しい結果')]);await h.reply(1,[remote('LATE','遅い結果')]);
 assert.deepEqual(h.ids(),['NEW']);assert.equal(h.node('knMarketOptions').getAttribute('aria-busy'),'false');assert.equal(h.node('knMarketSearchStatus').textContent,'');
});

test('clearing restores featured choices and prevents pending or failed searches from replacing them',async()=>{
 const h=harness();h.type('pending');h.type('');h.advance(350);assert.equal(h.requests.length,0);assert.deepEqual(h.ids(),featured);
 h.type('old');h.advance(350);h.type('  ');assert.equal(h.requests[0].signal.aborted,true);
 await h.reply(0,[remote('OLD','古い結果')],true);
 assert.deepEqual(h.ids(),featured);assert.equal(h.node('knMarketOptionsTitle').textContent,'主なマーケット');assert.equal(h.node('knMarketSearchStatus').textContent,'');assert.equal(h.node('knMarketOptions').getAttribute('aria-busy'),'false');
});

test('closing cancels queued and running searches; reopening ignores a previous dialog response',async()=>{
 const h=harness();h.type('queued');h.dialog.close();h.advance(350);assert.equal(h.requests.length,0);
 h.open();h.type('old');h.advance(350);h.dialog.close();assert.equal(h.requests[0].signal.aborted,true);
 h.open();assert.equal(h.input.value,'');assert.deepEqual(h.ids(),featured);
 h.type('new');h.advance(350);await h.reply(1,[remote('NEW','新しい結果')]);await h.reply(0,[remote('OLD','古い結果')]);
 assert.deepEqual(h.ids(),['NEW']);assert.equal(h.dialog.open,true);
});

test('Japanese composition cancels stale work and only searches after text is committed',async()=>{
 const h=harness();h.type('old');h.advance(350);h.input.dispatch('compositionstart');assert.equal(h.requests[0].signal.aborted,true);
 h.type('にん',{isComposing:true});h.advance(500);assert.equal(h.requests.length,1);
 h.input.dispatch('keydown',{key:'Enter',isComposing:true,keyCode:229});h.node('knMarketForm').dispatch('submit');
 assert.equal(h.requests.length,1);assert.equal(h.dialog.open,true);
 await h.reply(0,[remote('OLD','古い結果')]);assert.deepEqual(h.ids(),[]);
 h.input.value='任天堂';h.input.dispatch('compositionend');h.input.dispatch('input');assert.deepEqual(h.ids(),['7974.T']);
 h.advance(349);assert.equal(h.requests.length,1);h.advance(1);assert.equal(h.requests.length,2);assert.equal(h.requests[1].query,'任天堂');
 await h.reply(1,h.model.searchLocal('任天堂'));assert.deepEqual(h.ids(),['7974.T']);
 const enter=h.input.dispatch('keydown',{key:'Enter'});assert.equal(enter.defaultPrevented,true);assert.equal(h.requests.length,3);assert.equal(h.dialog.open,true);
});

test('remote completion preserves keyboard focus and local matches remain usable when more results fail',async()=>{
 const h=harness();h.type('任天堂');const initial=h.node('knMarketOptions').querySelector('input');initial.focus();h.advance(350);
 await h.reply(0,[...h.model.searchLocal('任天堂'),remote('NEW','別の会社')]);
 assert.notEqual(h.doc.activeElement,initial);assert.equal(h.doc.activeElement.value,'7974.T');assert.ok(h.node('knMarketOptions').contains(h.doc.activeElement));
 h.node('knMarketSearch').dispatch('click');assert.equal(h.requests.length,2);
 await h.reply(1,h.model.searchLocal('任天堂'),true);assert.deepEqual(h.ids(),['7974.T']);assert.match(h.node('knMarketSearchStatus').textContent,/取得できませんでした/);assert.equal(h.node('knMarketOptions').getAttribute('aria-busy'),'false');
});

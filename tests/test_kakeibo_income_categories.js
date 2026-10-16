'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'kakeibo.html'),'utf8');
const source=fs.readFileSync(path.join(root,'static/kakeibo-income-categories.js'),'utf8');
const sessionSource=fs.readFileSync(path.join(root,'static/ledger-session.js'),'utf8');
const KEY='kb2_custom_inc_cats',ADD='__kkadd__',IDS=['inc-cat','m-inc-cat'];
const BUILT_INS=['給与','賞与','副業','年金','配当','その他'];
const plain=value=>JSON.parse(JSON.stringify(value));

function fixture({seed={},answers=[],failRead=false,failWrite=false,language='ja'}={}){
  const values=new Map(Object.entries(seed)),reads=[],writes=[],changes=[],prompts=[],alerts=[],events=new Map(),originalCalls=[];
  class Event{constructor(type,options={}){this.type=type;this.bubbles=!!options.bubbles;}}
  class Element{
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attrs=new Map();this.listeners=new Map();this._value=undefined;this.textContent='';}
    get options(){return this.children.filter(child=>child.tagName==='OPTION');}
    get value(){return this._value===undefined?'':this._value;}
    set value(value){value=String(value);this._value=this.tagName==='SELECT'&&!this.options.some(option=>option.value===value)?'':value;}
    setAttribute(key,value){this.attrs.set(key,String(value));}
    getAttribute(key){return this.attrs.get(key)??null;}
    removeAttribute(key){this.attrs.delete(key);}
    appendChild(child){return this.insertBefore(child,null);}
    insertBefore(child,before){if(child.parentNode)child.parentNode.removeChild(child);const at=this.children.indexOf(before);this.children.splice(at<0?this.children.length:at,0,child);child.parentNode=this;if(this.tagName==='SELECT'&&this._value===undefined)this._value=child.value;return child;}
    removeChild(child){const at=this.children.indexOf(child);assert.ok(at>=0);const selected=this.value===child.value;this.children.splice(at,1);child.parentNode=null;if(selected)this._value=this.options[0]?.value||'';return child;}
    addEventListener(type,callback){this.listeners.set(type,[...(this.listeners.get(type)||[]),callback]);}
    dispatchEvent(event){if(this.tagName==='SELECT'&&event.type==='change')changes.push({id:this.id,value:this.value,bubbles:event.bubbles});for(const callback of this.listeners.get(event.type)||[])callback(event);return true;}
  }
  const selects=new Map();
  for(const id of IDS){
    const select=new Element('select');select.id=id;
    const markup=html.match(new RegExp('<select\\b[^>]*\\bid="'+id+'"[^>]*>([\\s\\S]*?)<\\/select>'));
    assert.ok(markup,'use production income built-ins for '+id);
    for(const match of markup[1].matchAll(/<option\b[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)){
      const option=new Element('option');option.value=match[1];option.textContent=match[2];select.appendChild(option);
    }
    selects.set(id,select);
  }
  const document={documentElement:new Element('html'),getElementById:id=>selects.get(id)||null,createElement:tag=>new Element(tag),body:new Element('body'),head:new Element('head')};
  document.documentElement.lang=language;
  const storage={get length(){return values.size;},key:i=>[...values.keys()][i]??null,getItem(key){reads.push(key);if(failRead)throw Error('synthetic read failure');return values.get(key)??null;},setItem(key,value){if(failWrite)throw Error('synthetic write failure');values.set(String(key),String(value));writes.push({key:String(key),value:String(value)});},removeItem:key=>values.delete(key)};
  const context={document,localStorage:storage,Event,console,KK_LANG:language,
    prompt(text){prompts.push(text);return answers.length?answers.shift():null;},alert:text=>alerts.push(text),
    addEventListener(type,callback){events.set(type,[...(events.get(type)||[]),callback]);},
    dispatchEvent(event){for(const callback of events.get(event.type)||[])callback(event);return true;},
    kkRenderCustomCats:function(){originalCalls.push({self:this,args:Array.from(arguments)});return 'original-render-result';},
    fetch(){throw Error('network forbidden');},XMLHttpRequest:class{constructor(){throw Error('network forbidden');}}};
  context.window=context;context.parent=context;vm.createContext(context);
  const select=id=>selects.get(id||IDS[0]);
  const option=(value,id)=>select(id).options.find(option=>option.value===value);
  const nativeValues=id=>select(id).options.map(option=>option.value);
  const run=()=>vm.runInContext(source,context);
  const change=(value,id)=>{const target=select(id);target.value=value;target.dispatchEvent(new Event('change',{bubbles:true}));};
  return {context,document,selects,select,storage,values,reads,writes,changes,prompts,alerts,events,originalCalls,run,change,option,nativeValues,
    add:(name,id)=>context.kkAddIncomeCategory(name,id?select(id):undefined),render:()=>context.kkRenderIncomeCats(),
    setFailRead:value=>failRead=value,setFailWrite:value=>failWrite=value};
}

test('both income forms restore only income categories without changing records or independent selections',()=>{
  const seed={[KEY]:'["架空の収入","架空の収入","給与"]',kk_custom_cats:'["架空の支出"]',kb2_custom_inv_cats:'["架空の投資"]',kb2_2026_10:'[{"type":"inc","name":"旧記録","amount":123.45}]',kbday_2026_10_1:'[{"type":"inc","amount":1}]'};
  const h=fixture({seed});h.change('賞与');h.change('年金','m-inc-cat');h.changes.length=0;h.run();
  for(const id of IDS){assert.deepEqual(h.nativeValues(id).filter(value=>BUILT_INS.includes(value)),BUILT_INS);assert.equal(h.nativeValues(id).filter(value=>value==='架空の収入').length,1);assert.equal(h.nativeValues(id).at(-1),ADD);assert.equal(h.option('架空の支出',id),undefined);assert.equal(h.option('架空の投資',id),undefined);}
  assert.equal(h.select().value,'賞与');assert.equal(h.select('m-inc-cat').value,'年金');assert.deepEqual(Object.fromEntries(h.values),seed);assert.deepEqual(h.writes,[]);assert.deepEqual(h.changes,[]);assert.ok(h.reads.every(key=>key===KEY));
});

test('new categories persist before DOM changes, synchronize both options and select only the requested form',()=>{
  const h=fixture();h.run();h.change('配当');h.change('年金','m-inc-cat');h.changes.length=0;
  const original=h.storage.setItem;h.storage.setItem=function(key,value){for(const id of IDS)assert.equal(h.option('架空の手当',id),undefined);assert.equal(h.select().value,'配当');assert.equal(h.select('m-inc-cat').value,'年金');return original.call(this,key,value);};
  assert.deepEqual(plain(h.add('　架空の手当  ','m-inc-cat')),{ok:true,value:'架空の手当'});
  assert.deepEqual(JSON.parse(h.values.get(KEY)),['架空の手当']);for(const id of IDS)assert.equal(h.option('架空の手当',id).textContent,'架空の手当');
  assert.equal(h.select().value,'配当');assert.equal(h.select('m-inc-cat').value,'架空の手当');assert.deepEqual(h.changes,[{id:'m-inc-cat',value:'架空の手当',bubbles:true}]);assert.equal(h.writes.length,1);
  h.storage.setItem=original;h.changes.length=0;assert.equal(h.add('架空の臨時').ok,true);assert.equal(h.select().value,'架空の臨時');assert.equal(h.select('m-inc-cat').value,'架空の手当');assert.deepEqual(h.changes,[{id:'inc-cat',value:'架空の臨時',bubbles:true}]);
});

test('duplicates select existing built-in or custom values without duplicate writes or options',()=>{
  const h=fixture();h.run();assert.equal(h.add('賞与').ok,true);assert.deepEqual(h.writes,[]);assert.equal(h.add('架空の臨時').ok,true);assert.equal(h.add(' 架空の臨時 ','m-inc-cat').ok,true);assert.equal(h.writes.length,1);
  for(const id of IDS){assert.equal(h.nativeValues(id).filter(value=>value==='架空の臨時').length,1);assert.equal(h.select(id).value,'架空の臨時');}
});

test('validation leaves both selections, options and all saved facts unchanged',()=>{
  const h=fixture();h.run();h.change('配当');h.change('年金','m-inc-cat');h.changes.length=0;const before=IDS.map(h.nativeValues);
  for(const [name,reason] of [['','empty'],['　 ','empty'],[null,'empty'],[{},'empty'],['金'.repeat(81),'too_long'],[' __kkadd__ ','reserved']])assert.deepEqual(plain(h.add(name,'m-inc-cat')),{ok:false,reason});
  assert.deepEqual(IDS.map(h.nativeValues),before);assert.equal(h.select().value,'配当');assert.equal(h.select('m-inc-cat').value,'年金');assert.deepEqual(h.writes,[]);assert.deepEqual(h.changes,[]);assert.equal(h.add('🪙'.repeat(80)).ok,true,'limit counts Unicode characters');
});

test('read/write failures and corrupt payloads cannot discard known options or overwrite saved facts',()=>{
  for(const failure of ['read','write','corrupt']){
    const h=fixture({seed:{[KEY]:'["架空の既存"]',kb2_2026_10:'[{"type":"inc","amount":42}]'}});h.run();h.change('架空の既存');h.change('配当','m-inc-cat');h.changes.length=0;const before=IDS.map(h.nativeValues);
    if(failure==='read')h.setFailRead(true);else if(failure==='write')h.setFailWrite(true);else h.values.set(KEY,'{bad');
    const bytes=Object.fromEntries(h.values);assert.deepEqual(plain(h.add('架空の新規','m-inc-cat')),{ok:false,reason:'storage'});assert.equal(h.render(),failure==='write');
    assert.deepEqual(IDS.map(h.nativeValues),before);assert.equal(h.select().value,'架空の既存');assert.equal(h.select('m-inc-cat').value,'配当');assert.deepEqual(Object.fromEntries(h.values),bytes);assert.deepEqual(h.writes,[]);assert.deepEqual(h.changes,[]);
  }
  for(const payload of ['{}','null','[1]','["", "valid"]','["__kkadd__"]']){
    const h=fixture({seed:{[KEY]:payload}});h.run();assert.deepEqual(plain(h.add('架空の新規')),{ok:false,reason:'storage'});assert.equal(h.values.get(KEY),payload);assert.deepEqual(h.writes,[]);
  }
});

test('HTML-like and prototype-property names are literal text in both forms and survive restore',()=>{
  const h=fixture();h.run();const names=['<img src=x onerror=synthetic()>','名前 "引用" [x] & café','__proto__','constructor','toString'];
  for(const name of names){assert.deepEqual(plain(h.add(name)),{ok:true,value:name});for(const id of IDS){assert.equal(h.option(name,id).textContent,name);assert.equal(h.option(name,id).children.length,0);}}
  const reloaded=fixture({seed:Object.fromEntries(h.values)});reloaded.run();for(const id of IDS)for(const name of names)assert.equal(reloaded.option(name,id).textContent,name);assert.deepEqual(reloaded.writes,[]);
});

test('late restore wraps the original renderer transparently, preserves form selections and refreshes locale labels',()=>{
  const h=fixture();h.run();h.change('配当');h.change('年金','m-inc-cat');h.changes.length=0;h.values.set(KEY,'["架空の復元"]');const receiver={synthetic:true};
  h.context.KK_LANG='en';assert.equal(h.context.kkRenderCustomCats.call(receiver,'original argument'),'original-render-result');assert.equal(h.originalCalls.length,1);assert.equal(h.originalCalls[0].self,receiver);assert.deepEqual(h.originalCalls[0].args,['original argument']);
  for(const id of IDS){assert.ok(h.option('架空の復元',id));assert.match(h.option(ADD,id).textContent,/New category/);}assert.equal(h.select().value,'配当');assert.equal(h.select('m-inc-cat').value,'年金');assert.deepEqual(h.writes,[]);assert.deepEqual(h.changes,[]);
  const failed=fixture(),error=Error('synthetic original failure');failed.context.kkRenderCustomCats=()=>{throw error;};failed.run();failed.values.set(KEY,'["架空の独立復元"]');assert.throws(()=>failed.context.kkRenderCustomCats(),value=>value===error);for(const id of IDS)assert.ok(failed.option('架空の独立復元',id));
});

test('native add prompts use the originating form and cancellation or failures restore its own previous selection',()=>{
  const h=fixture({answers:[null,' 架空の手当 ','']});h.run();h.change('配当');h.change('年金','m-inc-cat');h.change(ADD,'m-inc-cat');assert.equal(h.select().value,'配当');assert.equal(h.select('m-inc-cat').value,'年金');assert.deepEqual(h.writes,[]);
  h.change(ADD,'m-inc-cat');assert.equal(h.select().value,'配当');assert.equal(h.select('m-inc-cat').value,'架空の手当');assert.equal(h.writes.length,1);h.change(ADD);assert.equal(h.select().value,'配当');assert.equal(h.select('m-inc-cat').value,'架空の手当');assert.equal(h.alerts.length,1);assert.doesNotMatch(h.alerts[0],/synthetic|https?:\/\//);
});

async function realOwnerSession(h,initialUser='synthetic-alice'){
  let user=initialUser,timer;
  h.context.location={origin:'https://income-category.test'};
  h.context.parent={location:h.context.location,document:{addEventListener(){}},knEnsureGuest:async()=>({user:{id:user},access_token:'synthetic-token'})};
  h.context.setInterval=callback=>{timer=callback;};vm.runInContext(sessionSource,h.context);await new Promise(resolve=>setImmediate(resolve));await timer();
  return {changeUser(value){user=value;return timer();},tick:()=>timer()};
}

test('the unchanged real owner-session wrapper backs up income categories and reconciles both forms on account switches',async()=>{
  const h=fixture();h.run();const session=await realOwnerSession(h);h.add('架空の所有者A');h.add('架空の所有者A','m-inc-cat');
  await session.changeUser('synthetic-bob');assert.equal(h.values.has(KEY),false);for(const id of IDS){assert.equal(h.option('架空の所有者A',id),undefined);assert.equal(h.select(id).value,'給与');}assert.equal(JSON.parse(h.values.get('kn_ledger_backup:synthetic-alice'))[KEY],'["架空の所有者A"]');
  h.add('架空の所有者B','m-inc-cat');await session.changeUser('synthetic-alice');assert.equal(h.values.get(KEY),'["架空の所有者A"]');for(const id of IDS){assert.ok(h.option('架空の所有者A',id));assert.equal(h.option('架空の所有者B',id),undefined);}
});

test('confirmed owner changes clear old custom options in both forms even when new owner categories are corrupt or unreadable',async()=>{
  for(const failure of ['corrupt','read']){
    const h=fixture();h.run();const session=await realOwnerSession(h);h.add('架空の所有者A');h.add('架空の所有者A','m-inc-cat');
    const payload=failure==='corrupt'?'{bad':'["架空の所有者B"]';h.values.set('kn_ledger_backup:synthetic-bob',JSON.stringify({[KEY]:payload}));
    const original=h.storage.getItem;if(failure==='read')h.storage.getItem=function(key){if(key===KEY&&h.context.knLedgerSession?.user.id==='synthetic-bob')throw Error('synthetic new owner read failure');return original.call(this,key);};
    h.changes.length=0;const writes=h.writes.length;await session.changeUser('synthetic-bob');assert.equal(h.context.knLedgerSession.user.id,'synthetic-bob');
    for(const id of IDS){assert.equal(h.option('架空の所有者A',id),undefined);assert.equal(h.option('架空の所有者B',id),undefined);assert.equal(h.select(id).value,'給与');}assert.equal(h.values.get(KEY),payload);assert.deepEqual(h.changes,[]);assert.equal(h.writes.slice(writes).filter(write=>write.key===KEY).length,1,'only the existing owner restore writes the saved payload');
    assert.deepEqual(plain(h.add('架空の新規')),{ok:false,reason:'storage'});assert.equal(h.values.get(KEY),payload);
  }
});

test('same-owner transient reads retain the existing categories, selections and saved bytes in both forms',async()=>{
  const h=fixture();h.run();const session=await realOwnerSession(h);h.add('架空の手当');h.change('年金','m-inc-cat');const bytes=h.values.get(KEY),writes=h.writes.length;h.changes.length=0;const original=h.storage.getItem;
  h.storage.getItem=function(key){if(key===KEY)throw Error('synthetic transient failure');return original.call(this,key);};await session.tick();
  for(const id of IDS)assert.ok(h.option('架空の手当',id));assert.equal(h.select().value,'架空の手当');assert.equal(h.select('m-inc-cat').value,'年金');assert.equal(h.values.get(KEY),bytes);assert.equal(h.writes.length,writes);assert.deepEqual(h.changes,[]);
});

test('duplicate initialization does not stack renderer wrappers or change/auth event handlers',()=>{
  const h=fixture();h.run();const original=h.context.kkRenderCustomCats,api=h.context.kkAddIncomeCategory;h.run();assert.equal(h.context.kkRenderCustomCats,original);assert.equal(h.context.kkAddIncomeCategory,api);
  for(const id of IDS){assert.equal(h.nativeValues(id).filter(value=>value===ADD).length,1);assert.equal(h.select(id).listeners.get('change').length,1);}assert.equal(h.events.get('knLedgerAuth').length,1);
});

test('income category storage uses the unchanged owner, sync and server allowlists without network or record writes',()=>{
  const ownerPattern=sessionSource.match(/var KEY=(\/.*?\/);/)[1];assert.equal(vm.runInNewContext(ownerPattern).test(KEY),true);
  const syncPattern=html.match(/var KK_RE=(\/.*?\/);/)[1];assert.equal(vm.runInNewContext(syncPattern).test(KEY),true);
  const api=fs.readFileSync(path.join(root,'ledger_api.py'),'utf8'),serverPattern=api.match(/KEY = re\.compile\(r'([^']+)'\)/)[1];assert.equal(new RegExp(serverPattern).test(KEY),true);
  assert.doesNotMatch(source,/fetch\(|XMLHttpRequest|Authorization|access_token|createClient|kn_ledger_owner/);
});

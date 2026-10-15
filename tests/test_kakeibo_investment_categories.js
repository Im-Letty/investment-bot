'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'kakeibo.html'),'utf8');
const source=fs.readFileSync(path.join(root,'static/kakeibo-investment-categories.js'),'utf8');
const sessionSource=fs.readFileSync(path.join(root,'static/ledger-session.js'),'utf8');
const KEY='kb2_custom_inv_cats',ADD='__kkadd__';

function fixture({seed={},answers=[],missingSelect=false,failRead=false,failWrite=false,language='ja'}={}){
  const values=new Map(Object.entries(seed)),reads=[],writes=[],changes=[],prompts=[],alerts=[],events=new Map(),originalCalls=[];
  let document;
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
    dispatchEvent(event){if(this===select&&event.type==='change')changes.push({value:this.value,bubbles:event.bubbles});for(const callback of this.listeners.get(event.type)||[])callback(event);return true;}
  }
  const select=new Element('select');
  const markup=html.match(/<select\b[^>]*\bid="inv-cat"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(markup,'use the production investment built-ins');
  for(const match of markup[1].matchAll(/<option\b[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)){
    const option=new Element('option');option.value=match[1];option.textContent=match[2];select.appendChild(option);
  }
  document={documentElement:new Element('html'),getElementById:id=>!missingSelect&&id==='inv-cat'?select:null,createElement:tag=>new Element(tag),body:new Element('body'),head:new Element('head')};
  document.documentElement.lang=language;
  const storage={get length(){return values.size;},key:i=>[...values.keys()][i]??null,getItem(key){reads.push(key);if(failRead)throw Error('synthetic read failure');return values.get(key)??null;},setItem(key,value){if(failWrite)throw Error('synthetic write failure');values.set(String(key),String(value));writes.push({key:String(key),value:String(value)});},removeItem:key=>values.delete(key)};
  const context={document,localStorage:storage,Event,console,KK_LANG:language,
    prompt(text){prompts.push(text);return answers.length?answers.shift():null;},alert:text=>alerts.push(text),
    addEventListener(type,callback){events.set(type,[...(events.get(type)||[]),callback]);},
    dispatchEvent(event){for(const callback of events.get(event.type)||[])callback(event);return true;},
    kkRenderCustomCats:function(){originalCalls.push({self:this,args:Array.from(arguments)});return 'original-render-result';},
    fetch(){throw Error('network forbidden');},XMLHttpRequest:class{constructor(){throw Error('network forbidden');}}};
  context.window=context;context.parent=context;vm.createContext(context);
  const run=()=>vm.runInContext(source,context);
  function change(value){select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));}
  return {context,select,document,storage,values,reads,writes,changes,prompts,alerts,events,originalCalls,run,change,
    add:name=>context.kkAddInvestmentCategory(name),render:()=>context.kkRenderInvestmentCats(),
    option:value=>select.options.find(option=>option.value===value),nativeValues:()=>select.options.map(option=>option.value),
    setFailRead:value=>failRead=value,setFailWrite:value=>failWrite=value};
}
const plain=value=>JSON.parse(JSON.stringify(value));

test('initialization restores only investment categories without rewriting any records and keeps native add last',()=>{
  const seed={[KEY]:'["架空の金","架空の金","ETF"]',kk_custom_cats:'["架空の支出"]',kb2_2026_10:'[{"name":"架空の旧記録"}]'};
  const h=fixture({seed});h.run();assert.equal(h.select.value,'国内株');assert.equal(h.nativeValues().filter(value=>value==='架空の金').length,1);assert.equal(h.nativeValues().filter(value=>value==='ETF').length,1);assert.equal(h.nativeValues().at(-1),ADD);assert.equal(h.option('架空の支出'),undefined);
  assert.deepEqual(h.writes,[]);assert.deepEqual(h.changes,[]);assert.deepEqual(Object.fromEntries(h.values),seed);assert.ok(h.reads.every(key=>key===KEY));
});
test('a trimmed custom category is persisted before native options or selection change, then emits one bubbling event',()=>{
  const h=fixture();h.run();h.change('ETF');h.changes.length=0;
  const original=h.storage.setItem;h.storage.setItem=function(key,value){assert.equal(h.option('架空の金'),undefined);assert.equal(h.select.value,'ETF');return original.call(this,key,value);};
  assert.deepEqual(plain(h.add('　架空の金  ')),{ok:true,value:'架空の金'});assert.deepEqual(JSON.parse(h.values.get(KEY)),['架空の金']);assert.equal(h.select.value,'架空の金');assert.equal(h.option('架空の金').textContent,'架空の金');assert.deepEqual(h.changes,[{value:'架空の金',bubbles:true}]);assert.equal(h.writes.length,1);
});
test('built-in and custom duplicates select the same native value without another persistence write',()=>{
  const h=fixture();h.run();assert.equal(h.add('ETF').ok,true);assert.equal(h.writes.length,0);assert.equal(h.add('架空の金').ok,true);assert.equal(h.add(' 架空の金 ').ok,true);assert.equal(h.writes.length,1);assert.equal(h.nativeValues().filter(value=>value==='架空の金').length,1);assert.deepEqual(h.changes.map(change=>change.value),['ETF','架空の金','架空の金']);
});
test('validation rejects empty, overlong and reserved names without storage writes, DOM mutation or change',()=>{
  const h=fixture();h.run();const before=h.nativeValues();
  for(const [name,reason] of [['','empty'],['　 ','empty'],[null,'empty'],[{},'empty'],['金'.repeat(81),'too_long'],[' __kkadd__ ','reserved']])assert.deepEqual(plain(h.add(name)),{ok:false,reason});
  assert.deepEqual(h.nativeValues(),before);assert.equal(h.select.value,'国内株');assert.deepEqual(h.writes,[]);assert.deepEqual(h.changes,[]);
  assert.equal(h.add('🪙'.repeat(80)).ok,true,'length limit counts Unicode characters');
});
test('write and read failures retain previous category and options and expose only a fixed failure reason',()=>{
  for(const failure of ['read','write']){
    const h=fixture({seed:{[KEY]:'["架空の既存"]'}});h.run();h.change('ETF');h.changes.length=0;const before=h.nativeValues();
    if(failure==='read')h.setFailRead(true);else h.setFailWrite(true);
    assert.deepEqual(plain(h.add('架空の新規')),{ok:false,reason:'storage'});assert.equal(h.select.value,'ETF');assert.deepEqual(h.nativeValues(),before);assert.equal(h.values.get(KEY),'["架空の既存"]');assert.deepEqual(h.changes,[]);assert.deepEqual(h.writes,[]);
  }
});
test('corrupt and structurally invalid stored payloads stay untouched and cannot be silently replaced',()=>{
  for(const payload of ['{bad','{}','null','[1]','["", "valid"]','["__kkadd__"]','["x"'.repeat(2)]){
    const h=fixture({seed:{[KEY]:payload}});h.run();assert.deepEqual(plain(h.add('架空の新規')),{ok:false,reason:'storage'});assert.equal(h.render(),false);assert.equal(h.option('架空の新規'),undefined);assert.equal(h.values.get(KEY),payload);assert.deepEqual(h.writes,[]);assert.deepEqual(h.changes,[]);
  }
});
test('HTML-like, quoted, selector-like and prototype-property custom names remain literal text',()=>{
  const h=fixture();h.run();
  for(const name of ['<img src=x onerror=synthetic()>','名前 "引用" [x] & café','__proto__','constructor','toString']){
    assert.deepEqual(plain(h.add(name)),{ok:true,value:name});assert.equal(h.option(name).textContent,name);assert.equal(h.option(name).children.length,0);assert.equal(h.select.value,name);
  }
  const reloaded=fixture({seed:Object.fromEntries(h.values)});reloaded.run();for(const name of JSON.parse(h.values.get(KEY)))assert.equal(reloaded.option(name).textContent,name);assert.deepEqual(reloaded.writes,[]);
});
test('late cloud restore calls the original expense renderer with unchanged this/args/result and also restores investment',()=>{
  const h=fixture();h.run();h.values.set(KEY,'["架空の復元"]');const receiver={synthetic:true};assert.equal(h.context.kkRenderCustomCats.call(receiver,'original argument'),'original-render-result');assert.equal(h.originalCalls.length,1);assert.equal(h.originalCalls[0].self,receiver);assert.deepEqual(h.originalCalls[0].args,['original argument']);assert.ok(h.option('架空の復元'));assert.deepEqual(h.writes,[]);
});
test('investment restore still runs if the unchanged original expense renderer throws, preserving that exception',()=>{
  const h=fixture(),failure=new Error('synthetic original renderer failure');h.context.kkRenderCustomCats=function(){throw failure;};h.run();h.values.set(KEY,'["架空の独立復元"]');assert.throws(()=>h.context.kkRenderCustomCats(),error=>error===failure);assert.ok(h.option('架空の独立復元'));assert.deepEqual(h.writes,[]);
});
test('restore removes only managed options omitted by the current owner and resets vanished selection',()=>{
  const h=fixture({seed:{[KEY]:'["架空の所有者A"]'}});h.run();h.add('架空の所有者A');h.changes.length=0;h.values.set(KEY,'["架空の所有者B"]');assert.equal(h.render(),true);assert.equal(h.option('架空の所有者A'),undefined);assert.ok(h.option('架空の所有者B'));assert.equal(h.select.value,'国内株');assert.ok(h.option('ETF'));assert.deepEqual(h.changes,[]);assert.deepEqual(h.writes,[]);
  h.values.set(KEY,'{bad');assert.equal(h.render(),false);assert.ok(h.option('架空の所有者B'),'failed reads do not discard known existing options');
});
test('native fallback cancels to the previous real value and successful prompt persists once',()=>{
  const h=fixture({answers:[null,' 架空の金 ']});h.run();h.change('ETF');h.change(ADD);assert.equal(h.select.value,'ETF');assert.deepEqual(h.writes,[]);h.change(ADD);assert.equal(h.select.value,'架空の金');assert.deepEqual(JSON.parse(h.values.get(KEY)),['架空の金']);assert.equal(h.writes.length,1);assert.equal(h.prompts.length,2);assert.equal(h.changes.filter(change=>change.value==='架空の金').length,1);
});
test('native fallback reports validation or storage failures safely and retains the prior selection',()=>{
  for(const answer of ['',ADD,'x'.repeat(81),'架空の保存失敗']){
    const h=fixture({answers:[answer]});h.run();h.change('ETF');if(answer==='架空の保存失敗')h.setFailWrite(true);h.change(ADD);assert.equal(h.select.value,'ETF');assert.equal(h.alerts.length,1);assert.doesNotMatch(h.alerts[0],/synthetic|https?:\/\//);assert.deepEqual(h.writes,[]);assert.equal(h.option('架空の保存失敗'),undefined);
  }
});
test('native prompt and add-option labels follow all four existing locales without changing category values',()=>{
  const expected={ja:'新しい投資カテゴリ',en:'new investment category',zh:'投资分类',ko:'투자 카테고리'};
  for(const [language,fragment] of Object.entries(expected)){
    const h=fixture({language,answers:[null]});h.run();const before=h.nativeValues();h.change(ADD);assert.ok(h.prompts[0].includes(fragment),language);assert.equal(h.select.value,'国内株');assert.deepEqual(h.nativeValues(),before);assert.deepEqual(h.writes,[]);
  }
});
test('duplicate initialization adds no extra native options, restore wrappers or event listeners; missing select is a no-op',()=>{
  const h=fixture();h.run();const original=h.context.kkRenderCustomCats,api=h.context.kkAddInvestmentCategory;h.run();assert.equal(h.context.kkRenderCustomCats,original);assert.equal(h.context.kkAddInvestmentCategory,api);assert.equal(h.nativeValues().filter(value=>value===ADD).length,1);assert.equal(h.select.listeners.get('change').length,1);assert.equal(h.events.get('knLedgerAuth').length,1);
  const missing=fixture({missingSelect:true});missing.run();assert.equal(missing.context.kkInvestmentCategoriesReady,undefined);assert.deepEqual(missing.reads,[]);assert.deepEqual(missing.writes,[]);
});
test('the new key already matches the unchanged browser-owner, synchronization and server ledger allowlists',()=>{
  const ownerPattern=sessionSource.match(/var KEY=(\/.*?\/);/)[1];assert.equal(vm.runInNewContext(ownerPattern).test(KEY),true);
  const syncPattern=html.match(/var KK_RE=(\/.*?\/);/)[1];assert.equal(vm.runInNewContext(syncPattern).test(KEY),true);
  const api=fs.readFileSync(path.join(root,'ledger_api.py'),'utf8'),serverPattern=api.match(/KEY = re\.compile\(r'([^']+)'\)/)[1];assert.equal(new RegExp(serverPattern).test(KEY),true);
  assert.doesNotMatch(source,/fetch\(|XMLHttpRequest|Authorization|access_token|createClient|kn_ledger_owner/);
});
test('the existing owner-change policy backs up and restores custom investment keys while the auth event reconciles DOM',async()=>{
  const h=fixture();h.run();let user='synthetic-alice',timer;
  h.context.location={origin:'https://investment-category.test'};
  h.context.parent={location:h.context.location,document:{addEventListener(){}},knEnsureGuest:async()=>({user:{id:user},access_token:'synthetic-token'})};
  h.context.setInterval=callback=>{timer=callback;};
  vm.runInContext(sessionSource,h.context);await new Promise(resolve=>setImmediate(resolve));await timer();
  assert.equal(h.add('架空の所有者A').ok,true);assert.ok(h.option('架空の所有者A'));
  user='synthetic-bob';await timer();assert.equal(h.values.has(KEY),false);assert.equal(h.option('架空の所有者A'),undefined);assert.equal(h.select.value,'国内株');assert.equal(JSON.parse(h.values.get('kn_ledger_backup:synthetic-alice'))[KEY],'["架空の所有者A"]');
  assert.equal(h.add('架空の所有者B').ok,true);user='synthetic-alice';await timer();assert.equal(h.values.get(KEY),'["架空の所有者A"]');assert.ok(h.option('架空の所有者A'));assert.equal(h.option('架空の所有者B'),undefined);
});
async function realOwnerSession(h){
  let user='synthetic-alice',timer;
  h.context.location={origin:'https://investment-category.test'};
  h.context.parent={location:h.context.location,document:{addEventListener(){}},knEnsureGuest:async()=>({user:{id:user},access_token:'synthetic-token'})};
  h.context.setInterval=callback=>{timer=callback;};
  vm.runInContext(sessionSource,h.context);await new Promise(resolve=>setImmediate(resolve));await timer();
  return {changeUser(value){user=value;return timer();},tick:()=>timer()};
}
test('a confirmed owner change clears previous managed options even when the new restored category payload is corrupt',async()=>{
  for(const payload of ['{bad','{}','null','[1]']){
    const h=fixture();h.run();const session=await realOwnerSession(h);assert.equal(h.add('架空の所有者A').ok,true);
    h.values.set('kn_ledger_backup:synthetic-bob',JSON.stringify({[KEY]:payload}));const writes=h.writes.length;h.changes.length=0;
    await session.changeUser('synthetic-bob');assert.equal(h.context.knLedgerSession.user.id,'synthetic-bob');assert.equal(h.option('架空の所有者A'),undefined);assert.equal(h.select.value,'国内株');assert.ok(h.option('ETF'));assert.equal(h.values.get(KEY),payload);assert.deepEqual(h.changes,[]);
    assert.equal(h.writes.slice(writes).filter(write=>write.key===KEY).length,1,'only the existing session restore writes the unchanged payload');
    assert.deepEqual(plain(h.add('架空の新規')),{ok:false,reason:'storage'});assert.equal(h.values.get(KEY),payload);
  }
});
test('a confirmed owner change clears previous managed options before a new-owner category read throws',async()=>{
  const h=fixture();h.run();const session=await realOwnerSession(h);h.add('架空の所有者A');const payload='["架空の所有者B"]';h.values.set('kn_ledger_backup:synthetic-bob',JSON.stringify({[KEY]:payload}));
  const originalGet=h.storage.getItem;h.storage.getItem=function(key){if(key===KEY&&h.context.knLedgerSession?.user.id==='synthetic-bob')throw Error('synthetic new-owner category read failure');return originalGet.call(this,key);};
  h.changes.length=0;await session.changeUser('synthetic-bob');assert.equal(h.context.knLedgerSession.user.id,'synthetic-bob');assert.equal(h.option('架空の所有者A'),undefined);assert.equal(h.option('架空の所有者B'),undefined);assert.equal(h.select.value,'国内株');assert.equal(h.values.get(KEY),payload);assert.deepEqual(h.changes,[]);
  h.storage.getItem=originalGet;assert.equal(h.render(),true);assert.ok(h.option('架空の所有者B'));assert.equal(h.values.get(KEY),payload);
});
test('same-owner temporary read failures and corrupt payloads retain existing managed options and saved bytes',async()=>{
  const h=fixture();h.run();const session=await realOwnerSession(h);h.add('架空の同じ所有者');const payload=h.values.get(KEY),writes=h.writes.length;h.changes.length=0;
  const originalGet=h.storage.getItem;h.storage.getItem=function(key){if(key===KEY)throw Error('synthetic transient category read failure');return originalGet.call(this,key);};
  await session.tick();assert.equal(h.context.knLedgerSession.user.id,'synthetic-alice');assert.ok(h.option('架空の同じ所有者'));assert.equal(h.select.value,'架空の同じ所有者');assert.equal(h.values.get(KEY),payload);assert.equal(h.writes.length,writes);assert.deepEqual(h.changes,[]);
  h.storage.getItem=originalGet;h.values.set(KEY,'{bad');await session.tick();assert.ok(h.option('架空の同じ所有者'));assert.equal(h.select.value,'架空の同じ所有者');assert.equal(h.values.get(KEY),'{bad');assert.equal(h.writes.length,writes);
});
test('first confirmation removes pending old-local options even when the confirmed owner has invalid or unreadable categories',async()=>{
  for(const failure of ['corrupt','read']){
    const payload=failure==='corrupt'?'{bad':'["架空の所有者B"]';
    const h=fixture({seed:{kn_ledger_owner:'synthetic-alice',[KEY]:'["架空の未確定所有者A"]','kn_ledger_backup:synthetic-bob':JSON.stringify({[KEY]:payload})}});h.run();h.add('架空の未確定所有者A');assert.ok(h.option('架空の未確定所有者A'));assert.equal(h.context.knLedgerSession,undefined);
    h.context.location={origin:'https://investment-category.test'};h.context.parent={location:h.context.location,document:{addEventListener(){}},knEnsureGuest:async()=>({user:{id:'synthetic-bob'},access_token:'synthetic-token'})};h.context.setInterval=()=>{};
    const originalGet=h.storage.getItem;if(failure==='read')h.storage.getItem=function(key){if(key===KEY&&h.context.knLedgerSession?.user.id==='synthetic-bob')throw Error('synthetic first-owner category read failure');return originalGet.call(this,key);};
    h.changes.length=0;vm.runInContext(sessionSource,h.context);await new Promise(resolve=>setImmediate(resolve));assert.equal(h.context.knLedgerSession.user.id,'synthetic-bob');assert.equal(h.option('架空の未確定所有者A'),undefined);assert.equal(h.select.value,'国内株');assert.equal(h.values.get(KEY),payload);assert.deepEqual(h.changes,[]);assert.equal(h.writes.filter(write=>write.key===KEY).length,1,'only existing session restore writes the saved payload');
  }
});

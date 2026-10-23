'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'kakeibo.html'),'utf8');
const script=fs.readFileSync(path.join(root,'static/kakeibo-category-picker.js'),'utf8');
const customScript=Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)).map(match=>match[1]).find(text=>text.includes('function kkGetCustomCats()'));
assert.ok(customScript,'exercise the existing category prompt/restore handler');

function fixture({missingSelect=false,missingLabel=false,investment=false,owner='synthetic-owner-a',seed={},answers=[]}={}){
  const observers=[],pending=new Set(),storage=new Map(Object.entries(seed)),writes=[],reads=[],changes=[],invChanges=[],prompts=[],alerts=[],innerWrites=[];
  let document;
  function notify(node,type,attribute){
    for(const observer of observers){
      const target=observer.target,options=observer.options;
      if(!target||!(target===node||(options.subtree&&target.contains(node))))continue;
      if(type==='attributes'&&(!options.attributes||(options.attributeFilter&&!options.attributeFilter.includes(attribute))))continue;
      if(type==='childList'&&!options.childList)continue;
      if(type==='characterData'&&!options.characterData)continue;
      pending.add(observer);
    }
  }
  function descendants(node){return node.children.flatMap(child=>[child,...descendants(child)]);}
  function matches(node,selector){
    if(selector[0]==='#')return node.id===selector.slice(1);
    if(selector[0]==='.')return node.className.split(/\s+/).includes(selector.slice(1));
    const match=selector.match(/^(\w+)?\[([^=\]]+)(?:="([\s\S]*)")?\]$/);
    if(match)return (!match[1]||node.tagName===match[1].toUpperCase())&&node.hasAttribute(match[2])&&(match[3]===undefined||node.getAttribute(match[2])===match[3]);
    return node.tagName===selector.toUpperCase();
  }
  class Event{
    constructor(type,options={}){this.type=type;this.bubbles=!!options.bubbles;Object.assign(this,options);this.defaultPrevented=false;}
    preventDefault(){this.defaultPrevented=true;}
  }
  class Element{
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attrs=new Map();this.listeners=new Map();this.hidden=false;this._text='';this._html='';this._value=undefined;}
    get id(){return this.getAttribute('id')||'';}set id(value){this.setAttribute('id',value);}
    get className(){return this.getAttribute('class')||'';}set className(value){this.setAttribute('class',value);}
    get htmlFor(){return this.getAttribute('for')||'';}set htmlFor(value){this.setAttribute('for',value);}
    get type(){return this.getAttribute('type')||'';}set type(value){this.setAttribute('type',value);}
    get disabled(){return this.hasAttribute('disabled');}set disabled(value){if(value)this.setAttribute('disabled','');else this.removeAttribute('disabled');}
    get options(){return this.children.filter(node=>node.tagName==='OPTION');}
    get value(){return this._value===undefined?'':this._value;}
    set value(value){value=String(value);this._value=this.tagName==='SELECT'&&!this.options.some(option=>option.value===value)?'':value;if(this.tagName==='OPTION')this.setAttribute('value',value);}
    get selectedIndex(){return this.options.findIndex(option=>option.value===this.value);}
    set selectedIndex(index){this._value=this.options[index]?.value||'';}
    get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
    set textContent(value){for(const child of this.children)child.parentNode=null;if(this.children.some(child=>child.contains(document?.activeElement)))document.activeElement=document.body;this.children=[];this._text=String(value);this._html='';notify(this,'childList');notify(this,'characterData');}
    get innerHTML(){return this._html;}
    set innerHTML(value){this.children=[];this._text='';this._html=String(value);innerWrites.push({node:this,html:String(value)});notify(this,'childList');}
    get nextSibling(){if(!this.parentNode)return null;return this.parentNode.children[this.parentNode.children.indexOf(this)+1]||null;}
    get parentElement(){return this.parentNode;}
    get isConnected(){return !!document&&document.documentElement.contains(this);}
    setAttribute(key,value){this.attrs.set(key,String(value));notify(this,'attributes',key);}
    getAttribute(key){return this.attrs.get(key)??null;}
    hasAttribute(key){return this.attrs.has(key);}
    removeAttribute(key){this.attrs.delete(key);notify(this,'attributes',key);}
    appendChild(child){return this.insertBefore(child,null);}
    insertBefore(child,before){if(child.parentNode)child.parentNode.removeChild(child);const index=before?this.children.indexOf(before):-1;this.children.splice(index<0?this.children.length:index,0,child);child.parentNode=this;if(this.tagName==='SELECT'&&this._value===undefined)this._value=child.value;notify(this,'childList');return child;}
    removeChild(child){const index=this.children.indexOf(child);assert.ok(index>=0);this.children.splice(index,1);child.parentNode=null;notify(this,'childList');return child;}
    remove(){this.parentNode?.removeChild(this);}
    contains(node){return !!node&&(node===this||this.children.some(child=>child.contains(node)));}
    querySelectorAll(selector){return descendants(this).filter(node=>matches(node,selector));}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    addEventListener(name,callback){this.listeners.set(name,[...(this.listeners.get(name)||[]),callback]);}
    dispatchEvent(event){if(!event.target)event.target=this;event.currentTarget=this;if(event.type==='change'&&this===select){changes.push(this.value);context.kkExpCatChange(this);}if(event.type==='change'&&this===invSelect){invChanges.push(this.value);if(context.kkInvCatChange)context.kkInvCatChange(this);}for(const callback of this.listeners.get(event.type)||[])callback(event);if(event.bubbles&&this.parentNode)this.parentNode.dispatchEvent(event);return !event.defaultPrevented;}
    click(){if(!this.disabled)this.dispatchEvent(new Event('click',{bubbles:true}));}
    focus(){if(!this.disabled)document.activeElement=this;}
    select(){this.selectionStart=0;this.selectionEnd=this.value.length;}
  }
  const docListeners=new Map(),documentElement=new Element('html'),body=new Element('body');documentElement.appendChild(body);
  document={readyState:'loading',documentElement,body,activeElement:body,createElement:tag=>new Element(tag),
    getElementById:id=>[documentElement,...descendants(documentElement)].find(node=>node.id===id)||null,
    querySelectorAll:selector=>documentElement.querySelectorAll(selector),querySelector:selector=>documentElement.querySelector(selector),
    addEventListener(name,callback){docListeners.set(name,[...(docListeners.get(name)||[]),callback]);},
    dispatchEvent(event){for(const callback of docListeners.get(event.type)||[])callback(event);return !event.defaultPrevented;}};
  documentElement.setAttribute('lang','ja');
  const form=new Element('div');body.appendChild(form);
  function makeSelect(id){
    const markup=html.match(new RegExp('<select\\b[^>]*\\bid="'+id+'"[^>]*>([\\s\\S]*?)<\\/select>'));
    assert.ok(markup,id+' exists in production HTML');const node=new Element('select');node.id=id;
    for(const match of markup[1].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)){
      const option=new Element('option');for(const attr of match[1].matchAll(/([\w-]+)="([^"]*)"/g))option.setAttribute(attr[1],attr[2]);
      option.value=option.getAttribute('value')||'';option.textContent=match[2];node.appendChild(option);
    }
    return node;
  }
  const label=new Element('label');label.htmlFor='exp-cat';label.textContent='カテゴリ';label.setAttribute('data-i18n','kk_layout_category');
  const select=makeSelect('exp-cat');if(!missingLabel)form.appendChild(label);if(!missingSelect)form.appendChild(select);
  const other={};for(const id of ['inv-cat','m-exp-cat']){other[id]=makeSelect(id);form.appendChild(other[id]);}
  const invSelect=other['inv-cat'],invLabel=new Element('label');
  if(investment){invLabel.htmlFor='inv-cat';invLabel.textContent='カテゴリ';invLabel.setAttribute('data-i18n','kk_layout_category');form.insertBefore(invLabel,invSelect);}
  for(const id of ['exp-amount','kkEntryDate','ast-cat','m-exp-name']){assert.match(html,new RegExp('\\bid="'+id+'"'));other[id]=new Element('input');other[id].id=id;other[id].value='synthetic draft '+id;form.appendChild(other[id]);}
  const windowEvents=new Map();
  const context={document,console,Event,localStorage:{getItem(key){reads.push(key);return storage.get(key)??null;},setItem(key,value){storage.set(key,String(value));writes.push({key,value:String(value)});},removeItem(key){storage.delete(key);}},
    MutationObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(target,options){this.target=target;this.options=options;}},
    fetch(){throw Error('network is forbidden');},XMLHttpRequest:class{constructor(){throw Error('network is forbidden');}},
    prompt(message){prompts.push(message);return answers.length?answers.shift():null;},
    alert(message){alerts.push(message);},
    addEventListener(name,callback){windowEvents.set(name,[...(windowEvents.get(name)||[]),callback]);},
    dispatchEvent(event){for(const callback of windowEvents.get(event.type)||[])callback(event);return !event.defaultPrevented;}};
  context.window=context;context.parent=context;context.knLedgerSession={user:owner?{id:owner}:null};vm.createContext(context);
  const begin=html.indexOf('var KK_I18N ='),end=html.indexOf('var _year=new Date()',begin);assert.ok(begin>=0&&end>begin);
  vm.runInContext(html.slice(begin,end),context);vm.runInContext(customScript,context);
  if(investment)vm.runInContext(fs.readFileSync(path.join(root,'static/kakeibo-investment-categories.js'),'utf8'),context);
  function run(){vm.runInContext(script,context);}
  function flush(){let iterations=0;while(pending.size){assert.ok(++iterations<15,'observer must settle without a feedback loop');const batch=[...pending];pending.clear();for(const observer of batch)observer.callback([]);}}
  const get=id=>document.getElementById(id),buttons=()=>get('kkExpenseCategoryChoices')?.children||[],button=value=>buttons().find(node=>node.getAttribute('data-kk-category')===value);
  const invButtons=()=>get('kkInvestmentCategoryChoices')?.children.filter(node=>node.hasAttribute('data-kk-category'))||[],invButton=value=>invButtons().find(node=>node.getAttribute('data-kk-category')===value);
  return {context,document,select,label,other,invSelect,invLabel,storage,writes,reads,changes,invChanges,prompts,alerts,innerWrites,observers,run,flush,get,buttons,button,invButtons,invButton,
    option(value,text=value){const node=new Element('option');node.value=value;node.textContent=text;select.insertBefore(node,select.querySelector('option[value="__kkadd__"]'));return node;},
    open(){get('kkExpenseCategoryToggle').click();},
    invOpen(){get('kkInvestmentCategoryToggle').click();},
    change(value){select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));},
    key(node,key,options={}){const event=new Event('keydown',{key,bubbles:true,...options});node.dispatchEvent(event);return event;},
    pointer(target){document.dispatchEvent(new Event('pointerdown',{target}));}};
}

function selected(h){return h.buttons().filter(button=>button.getAttribute('aria-pressed')==='true').map(button=>button.getAttribute('data-kk-category'));}
function nameOf(button){return button.children.find(node=>node.className==='kk-category-text');}

test('native category select remains the initial fallback and absent dependencies make enhancement a no-op',()=>{
  const tag=html.match(/<select\b[^>]*\bid="exp-cat"[^>]*>/)[0];assert.doesNotMatch(tag,/\bhidden\b/);assert.match(tag,/onchange="kkExpCatChange\(this\)"/);
  assert.match(html,/<script\b[^>]*defer[^>]*src="\/static\/kakeibo-category-picker\.js\?[^\"]+"/);
  for(const options of [{missingSelect:true},{missingLabel:true}]){const h=fixture(options);assert.doesNotThrow(h.run);assert.equal(h.select.hidden,false);assert.equal(h.get('kkExpenseCategoryPicker'),null);assert.equal(h.observers.length,0);assert.deepEqual(h.writes,[]);}
});
test('successful enhancement preserves the native value and creates accessible buttons without touching other forms or storage',()=>{
  const h=fixture({seed:{kb2_2026_10:'[{"name":"synthetic legacy","amount":12.5}]'}}),before=new Map(h.storage),other=Object.fromEntries(Object.entries(h.other).map(([id,node])=>[id,node.value]));
  h.select.value='交通';h.run();assert.equal(h.select.value,'交通');assert.equal(h.select.hidden,true);assert.equal(h.get('kkExpenseCategoryPicker').parentNode,h.select.parentNode);assert.equal(h.select.nextSibling,h.get('kkExpenseCategoryPicker'));
  const toggle=h.get('kkExpenseCategoryToggle'),choices=h.get('kkExpenseCategoryChoices');assert.equal(toggle.type,'button');assert.equal(toggle.getAttribute('aria-expanded'),'false');assert.equal(toggle.getAttribute('aria-controls'),choices.id);assert.equal(h.label.htmlFor,toggle.id);assert.equal(choices.getAttribute('role'),'group');assert.equal(choices.hidden,true);
  assert.equal(h.get('kkExpenseCategoryValue').textContent,'交通費');assert.deepEqual(selected(h),['交通']);assert.equal(h.buttons().length,h.select.options.length);assert.ok(h.buttons().every(button=>button.type==='button'));
  assert.deepEqual(Object.fromEntries(Object.entries(h.other).map(([id,node])=>[id,node.value])),other);assert.deepEqual(h.storage,before);assert.deepEqual(h.writes,[]);
});
test('choosing an ordinary category updates only native select and one native change, then closes and returns focus',()=>{
  const h=fixture(),other=Object.fromEntries(Object.entries(h.other).map(([id,node])=>[id,node.value]));h.run();h.open();assert.equal(h.document.activeElement,h.button('食費'));assert.equal(h.get('kkExpenseCategoryChoices').hidden,false);
  h.button('交通').click();assert.equal(h.select.value,'交通');assert.deepEqual(h.changes,['交通']);assert.deepEqual(selected(h),['交通']);assert.equal(h.get('kkExpenseCategoryValue').textContent,'交通費');assert.equal(h.get('kkExpenseCategoryChoices').hidden,true);assert.equal(h.get('kkExpenseCategoryToggle').getAttribute('aria-expanded'),'false');assert.equal(h.document.activeElement,h.get('kkExpenseCategoryToggle'));assert.deepEqual(h.writes,[]);assert.equal(h.prompts.length,0);
  assert.deepEqual(Object.fromEntries(Object.entries(h.other).map(([id,node])=>[id,node.value])),other);
});
test('Escape closes from a choice and restores focus; outside pointer closes without stealing another input focus',()=>{
  const h=fixture();h.run();h.open();const event=h.key(h.button('食費'),'Escape');assert.equal(event.defaultPrevented,true);assert.equal(h.get('kkExpenseCategoryChoices').hidden,true);assert.equal(h.document.activeElement,h.get('kkExpenseCategoryToggle'));
  h.open();h.pointer(h.button('交通'));assert.equal(h.get('kkExpenseCategoryChoices').hidden,false);const input=h.other['exp-amount'];input.focus();h.pointer(input);assert.equal(h.get('kkExpenseCategoryChoices').hidden,true);assert.equal(h.document.activeElement,input);
  assert.equal(h.key(h.get('kkExpenseCategoryToggle'),'Escape').defaultPrevented,false);assert.deepEqual(h.changes,[]);
});
test('toggle closes itself without changing the selection or invoking the custom prompt',()=>{
  const h=fixture();h.run();h.open();h.get('kkExpenseCategoryToggle').click();assert.equal(h.get('kkExpenseCategoryChoices').hidden,true);assert.equal(h.select.value,'食費');assert.deepEqual(h.changes,[]);assert.deepEqual(h.prompts,[]);
});
test('existing custom-category prompt cancellation synchronizes back to native first option and does not save',()=>{
  for(const answer of [null,'','　 ']){const h=fixture({answers:[answer]});h.select.value='交通';h.run();h.open();h.button('__kkadd__').click();h.flush();assert.equal(h.prompts.length,1);assert.equal(h.select.value,'食費');assert.deepEqual(selected(h),['食費']);assert.equal(h.get('kkExpenseCategoryValue').textContent,'食費');assert.equal(h.get('kkExpenseCategoryChoices').hidden,true);assert.equal(h.document.activeElement,h.get('kkExpenseCategoryToggle'));assert.deepEqual(h.writes,[]);}
});
test('existing prompt creates and selects a trimmed custom category with one change and no duplicate option',()=>{
  const seed={kb2_2026_10:'[{"name":"synthetic legacy","amount":12.5}]',kbday_2026_10_01:'[]',userBrandColor:'#725799'};
  const h=fixture({seed,answers:['  架空の保険  ','架空の保険']});h.run();
  for(let i=0;i<2;i++){h.open();h.button('__kkadd__').click();h.flush();assert.equal(h.select.value,'架空の保険');assert.equal(h.get('kkExpenseCategoryValue').textContent,'架空の保険');assert.deepEqual(selected(h),['架空の保険']);assert.equal(h.get('kkExpenseCategoryChoices').hidden,true);}
  assert.deepEqual(h.changes,['__kkadd__','__kkadd__']);assert.equal(h.select.options.filter(option=>option.value==='架空の保険').length,1);assert.deepEqual(JSON.parse(h.storage.get('kk_custom_cats')),['架空の保険']);assert.equal(h.writes.length,1);assert.equal(h.writes[0].key,'kk_custom_cats');for(const [key,value] of Object.entries(seed))assert.equal(h.storage.get(key),value);
});
test('late restored categories and external native change synchronize through the observer and existing handler',()=>{
  const h=fixture({seed:{kk_custom_cats:'["架空の復元"]'}});h.run();h.context.kkRenderCustomCats();h.flush();assert.ok(h.button('架空の復元'));h.change('架空の復元');assert.deepEqual(selected(h),['架空の復元']);assert.equal(h.get('kkExpenseCategoryValue').textContent,'架空の復元');assert.deepEqual(h.writes,[]);
  assert.equal(h.observers.length,1);assert.equal(h.observers[0].target,h.select);assert.equal(h.observers[0].options.subtree,true);
});
test('option translation and four-language custom action text update without rewriting saved category values',()=>{
  const h=fixture();h.run();const values=h.select.options.map(option=>option.value),expected={ja:'新しいカテゴリ',en:'New category',ko:'새 카테고리',zh:'新建分类'};
  for(const lang of ['ja','en','ko','zh']){h.context.kkApplyLang(lang);h.flush();assert.equal(nameOf(h.button('__kkadd__')).textContent,expected[lang]);assert.equal(nameOf(h.button('食費')).textContent,h.context.kkT('kk_cat_food').replace(/^[^\p{L}\p{N}]+/u,'').trim());assert.equal(h.get('kkExpenseCategoryValue').textContent,nameOf(h.button('食費')).textContent);assert.deepEqual(h.select.options.map(option=>option.value),values);assert.equal(h.select.value,'食費');}
  assert.ok(h.writes.every(write=>['kk_lang','siteLang'].includes(write.key)),'only existing locale preferences may change');
});
test('arbitrary custom names remain literal text and fixed SVG paths, including object-prototype property names',()=>{
  for(const value of ['<img src=x onerror=synthetic()>','__proto__','constructor','toString','名前 "引用" [x] & café']){
    const h=fixture();h.run();h.option(value,'🏷️ '+value);h.flush();const button=h.button(value);assert.ok(button);assert.equal(nameOf(button).textContent,value);assert.equal(nameOf(button).innerHTML,'');assert.equal(nameOf(button).children.length,0);assert.ok(h.innerWrites.every(write=>!write.html.includes(value)));
    h.open();button.click();assert.equal(h.select.value,value);assert.equal(h.get('kkExpenseCategoryValue').textContent,value);assert.deepEqual(selected(h),[value]);
  }
});
test('observer rebuild keeps focus on the same enabled value while an open choice label changes',()=>{
  const h=fixture();h.run();h.open();h.button('交通').focus();const old=h.document.activeElement;h.select.options.find(option=>option.value==='交通').textContent='Transport';h.flush();assert.notEqual(h.button('交通'),old);assert.equal(h.document.activeElement,h.button('交通'));assert.equal(h.get('kkExpenseCategoryChoices').hidden,false);assert.equal(nameOf(h.button('交通')).textContent,'Transport');
});
test('removed or disabled focused options fall back to the trigger when the open group rebuilds',()=>{
  for(const action of ['remove','disable']){const h=fixture();h.run();h.open();h.button('交通').focus();const option=h.select.options.find(node=>node.value==='交通');if(action==='remove')option.remove();else option.disabled=true;h.flush();assert.equal(h.document.activeElement,h.get('kkExpenseCategoryToggle'));if(action==='disable'){assert.equal(h.button('交通').disabled,true);const before=h.select.value;h.button('交通').click();assert.equal(h.select.value,before);}}
});
test('closed-group rebuild and open-group updates with external focus never steal a draft input focus',()=>{
  for(const open of [false,true]){const h=fixture();h.run();if(open)h.open();const input=h.other['kkEntryDate'];input.focus();const draft=input.value;h.select.options[0].textContent='Updated';h.flush();assert.equal(h.document.activeElement,input);assert.equal(input.value,draft);assert.equal(h.get('kkExpenseCategoryChoices').hidden,!open);}
});
test('duplicate initialization adds neither a second picker nor listeners and unchanged observer delivery preserves buttons',()=>{
  const h=fixture();h.run();const picker=h.get('kkExpenseCategoryPicker'),button=h.button('食費');h.run();assert.equal(h.get('kkExpenseCategoryPicker'),picker);assert.equal(h.document.querySelectorAll('#kkExpenseCategoryPicker').length,1);assert.equal(h.observers.length,1);
  h.observers[0].callback([]);assert.equal(h.button('食費'),button);h.open();h.button('交通').click();assert.deepEqual(h.changes,['交通']);assert.equal(h.get('kkExpenseCategoryChoices').hidden,true);
});

function invSelected(h){return h.invButtons().filter(button=>button.getAttribute('aria-pressed')==='true').map(button=>button.getAttribute('data-kk-category'));}
function composer(h){h.invOpen();h.invButton('__kkadd__').click();return h.get('kkInvestmentCategoryName');}

test('expense keeps its original IDs and the investment disclosure selects independently',()=>{
  const h=fixture({investment:true});h.run();assert.equal(h.select.hidden,true);assert.equal(h.invSelect.hidden,true);assert.equal(h.observers.length,2);
  assert.equal(h.label.htmlFor,'kkExpenseCategoryToggle');assert.equal(h.invLabel.htmlFor,'kkInvestmentCategoryToggle');
  h.invOpen();h.invButton('ETF').click();assert.equal(h.invSelect.value,'ETF');assert.deepEqual(h.invChanges,['ETF']);assert.equal(h.select.value,'食費');assert.deepEqual(h.changes,[]);assert.deepEqual(invSelected(h),['ETF']);
  h.open();h.button('交通').click();assert.equal(h.select.value,'交通');assert.equal(h.invSelect.value,'ETF');assert.deepEqual(h.invChanges,['ETF']);assert.deepEqual(selected(h),['交通']);assert.deepEqual(h.writes,[]);
});
test('investment plus opens a labelled inline composer without invoking prompt or changing the native category',()=>{
  const h=fixture({investment:true});h.run();const original=h.invSelect.value,input=composer(h);
  assert.equal(h.get('kkInvestmentCategoryEditor').hidden,false);assert.equal(h.get('kkInvestmentCategoryChoices').hidden,true);assert.equal(h.get('kkInvestmentCategoryToggle').getAttribute('aria-expanded'),'true');assert.equal(h.document.activeElement,input);
  assert.equal(h.get('kkInvestmentCategoryNameLabel').htmlFor,input.id);assert.equal(input.type,'text');assert.equal(input.getAttribute('aria-describedby'),'kkInvestmentCategoryError');assert.equal(h.get('kkInvestmentCategorySave').type,'button');assert.equal(h.get('kkInvestmentCategoryCancel').type,'button');assert.equal(h.get('kkInvestmentCategoryError').getAttribute('role'),'alert');
  assert.equal(h.invSelect.value,original);assert.deepEqual(h.invChanges,[]);assert.deepEqual(h.prompts,[]);assert.deepEqual(h.writes,[]);
});
test('investment composer saves exact trimmed safe text to its separate key and emits one native change',()=>{
  const seed={kk_custom_cats:'["expense legacy"]',kb2_2026_10:'[{"name":"legacy investment","amount":12.5}]',kbday_2026_10_01:'[]'};
  const h=fixture({investment:true,seed});h.run();const input=composer(h),name='<img src=x onerror="synthetic()"> & "基金"';input.value='  '+name+'  ';h.get('kkInvestmentCategorySave').click();h.flush();
  assert.equal(h.invSelect.value,name);assert.deepEqual(h.invChanges,[name]);assert.equal(h.get('kkInvestmentCategoryValue').textContent,name);assert.equal(nameOf(h.invButton(name)).textContent,name);assert.equal(nameOf(h.invButton(name)).innerHTML,'');assert.ok(h.innerWrites.every(write=>!write.html.includes(name)));
  assert.deepEqual(JSON.parse(h.storage.get('kb2_custom_inv_cats')),[name]);assert.equal(h.writes.length,1);assert.equal(h.writes[0].key,'kb2_custom_inv_cats');assert.equal(h.get('kkInvestmentCategoryEditor').hidden,true);assert.equal(h.document.activeElement,h.get('kkInvestmentCategoryToggle'));assert.equal(h.select.value,'食費');
  for(const [key,value] of Object.entries(seed))assert.equal(h.storage.get(key),value);
});
test('composer validation keeps empty, overlong and reserved drafts visible without writing or selecting',()=>{
  for(const value of ['','x'.repeat(81),'__kkadd__']){
    const h=fixture({investment:true});h.run();const original=h.invSelect.value,input=composer(h);input.value=value;h.get('kkInvestmentCategorySave').click();
    assert.equal(input.value,value);assert.equal(input.getAttribute('aria-invalid'),'true');assert.equal(h.get('kkInvestmentCategoryError').hidden,false);assert.ok(h.get('kkInvestmentCategoryError').textContent);assert.equal(h.document.activeElement,input);assert.equal(h.get('kkInvestmentCategoryEditor').hidden,false);assert.equal(h.invSelect.value,original);assert.deepEqual(h.writes,[]);assert.deepEqual(h.invChanges,[]);
  }
});
test('storage failure retains composer draft and prior selection, and a corrected retry saves once',()=>{
  const h=fixture({investment:true});h.run();const original=h.invSelect.value,input=composer(h);input.value='  架空のNISA  ';const write=h.context.localStorage.setItem;
  h.context.localStorage.setItem=()=>{throw Error('synthetic storage failure');};h.get('kkInvestmentCategorySave').click();
  assert.equal(input.value,'  架空のNISA  ');assert.equal(h.get('kkInvestmentCategoryEditor').hidden,false);assert.equal(h.get('kkInvestmentCategoryError').hidden,false);assert.equal(h.invSelect.value,original);assert.deepEqual(h.invChanges,[]);assert.deepEqual(h.writes,[]);assert.equal(h.invButton('架空のNISA'),undefined);
  h.context.localStorage.setItem=write;input.dispatchEvent(new h.context.Event('input',{bubbles:true}));assert.equal(h.get('kkInvestmentCategoryError').hidden,true);assert.equal(input.getAttribute('aria-invalid'),null);h.get('kkInvestmentCategorySave').click();h.flush();
  assert.equal(h.invSelect.value,'架空のNISA');assert.deepEqual(h.invChanges,['架空のNISA']);assert.equal(h.writes.length,1);assert.equal(h.get('kkInvestmentCategoryEditor').hidden,true);
});
test('composer cancel, Escape and outside pointer preserve category and other drafts without creating a category',()=>{
  for(const action of ['cancel','escape','outside']){
    const h=fixture({investment:true});h.run();const original=h.invSelect.value,input=composer(h),draft=h.other['kkEntryDate'].value;input.value='保存しない投資分類';
    if(action==='cancel')h.get('kkInvestmentCategoryCancel').click();
    else if(action==='escape'){assert.equal(h.key(input,'Escape',{isComposing:true}).defaultPrevented,false);assert.equal(h.get('kkInvestmentCategoryEditor').hidden,false);assert.equal(h.key(input,'Escape').defaultPrevented,true);}
    else{h.other['kkEntryDate'].focus();h.pointer(h.other['kkEntryDate']);}
    assert.equal(h.get('kkInvestmentCategoryEditor').hidden,true);assert.equal(h.invSelect.value,original);assert.deepEqual(h.invChanges,[]);assert.deepEqual(h.writes,[]);assert.equal(h.other['kkEntryDate'].value,draft);
    assert.equal(h.document.activeElement,action==='outside'?h.other['kkEntryDate']:h.get('kkInvestmentCategoryToggle'));
  }
});
test('composer Enter ignores composition and legacy key229, then prevents default and saves exactly once',()=>{
  const h=fixture({investment:true});h.run();const input=composer(h);input.value='架空の積立';
  assert.equal(h.key(input,'Enter',{isComposing:true}).defaultPrevented,false);assert.equal(h.key(input,'Enter',{keyCode:229}).defaultPrevented,false);assert.deepEqual(h.writes,[]);assert.deepEqual(h.invChanges,[]);
  assert.equal(h.key(input,'Enter').defaultPrevented,true);h.flush();assert.deepEqual(h.invChanges,['架空の積立']);assert.equal(h.writes.length,1);assert.equal(h.invSelect.value,'架空の積立');assert.equal(h.document.activeElement,h.get('kkInvestmentCategoryToggle'));
});
test('open composer labels and errors follow all four languages without clearing its draft or focus',()=>{
  const h=fixture({investment:true});h.run();const input=composer(h);input.value='__kkadd__';h.get('kkInvestmentCategorySave').click();const labels={ja:'カテゴリ名',en:'Category name',ko:'카테고리 이름',zh:'类别名称'},errors=new Set();
  for(const lang of ['ja','en','ko','zh']){h.context.kkApplyLang(lang);h.flush();assert.equal(h.get('kkInvestmentCategoryNameLabel').textContent,labels[lang]);assert.ok(h.get('kkInvestmentCategorySave').textContent);assert.ok(h.get('kkInvestmentCategoryCancel').textContent);errors.add(h.get('kkInvestmentCategoryError').textContent);assert.equal(input.value,'__kkadd__');assert.equal(h.document.activeElement,input);assert.equal(h.get('kkInvestmentCategoryEditor').hidden,false);assert.equal(input.getAttribute('aria-invalid'),'true');}
  assert.equal(errors.size,4);assert.deepEqual(h.invChanges,[]);assert.ok(h.writes.every(write=>['kk_lang','siteLang'].includes(write.key)));
});
test('late restored investment options update their own picker, retain open focus and do not alter expense state',()=>{
  const h=fixture({investment:true,seed:{kb2_custom_inv_cats:'["旧投資分類"]'}});h.run();h.invOpen();h.invButton('ETF').focus();h.storage.set('kb2_custom_inv_cats','["新投資分類"]');h.context.kkRenderCustomCats();h.flush();
  assert.equal(h.invButton('旧投資分類'),undefined);assert.ok(h.invButton('新投資分類'));assert.equal(h.document.activeElement,h.invButton('ETF'));assert.equal(h.select.value,'食費');assert.deepEqual(selected(h),['食費']);assert.deepEqual(h.changes,[]);assert.deepEqual(h.writes,[]);
  const expense=h.get('kkExpenseCategoryPicker'),investment=h.get('kkInvestmentCategoryPicker');h.run();assert.equal(h.get('kkExpenseCategoryPicker'),expense);assert.equal(h.get('kkInvestmentCategoryPicker'),investment);assert.equal(h.observers.length,2);
});

test('auth restore with unreadable owner categories removes stale custom choices without rewriting storage',()=>{
  for(const owner of ['synthetic-owner-a',''])for(const failure of ['invalid','throw']){
    const h=fixture({investment:true,owner,seed:{kb2_custom_inv_cats:'["旧ownerの投資分類"]'}}),first=h.invSelect.options[0].value;h.run();h.invOpen();h.invButton('旧ownerの投資分類').click();
    assert.equal(h.invSelect.value,'旧ownerの投資分類');h.context.knLedgerSession.user={id:'synthetic-owner-b'};h.storage.set('kb2_custom_inv_cats','{');
    if(failure==='throw')h.context.localStorage.getItem=()=>{throw Error('synthetic owner storage read failure');};
    h.context.dispatchEvent(new h.context.Event('knLedgerAuth'));h.flush();
    assert.equal(h.invButton('旧ownerの投資分類'),undefined);assert.equal(h.invSelect.value,first);assert.deepEqual(invSelected(h),[first]);assert.equal(h.get('kkInvestmentCategoryValue').textContent,nameOf(h.invButton(first)).textContent);assert.equal(h.storage.get('kb2_custom_inv_cats'),'{');assert.deepEqual(h.writes,[]);assert.equal(h.select.value,'食費');
  }
});

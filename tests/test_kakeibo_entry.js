'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','kakeibo.html'),'utf8');

function fixture(seed={}){
  const nodes=new Map(),all=[],events=new Map(),values=new Map(Object.entries(seed)),writes=[],alerts=[];
  let focused='';
  function element(tag='div',id=''){
    const attrs=new Map(),classes=new Set();
    const node={id,tagName:tag.toUpperCase(),className:'',children:[],style:{},value:'',textContent:'',innerHTML:'',hidden:false,
      classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name),toggle(name,on){if(on)classes.add(name);else classes.delete(name);}},
      getAttribute:key=>attrs.get(key)??null,setAttribute:(key,value)=>attrs.set(key,String(value)),removeAttribute:key=>attrs.delete(key),
      appendChild(child){node.children.push(child);child.parentElement=node;return child;},
      insertBefore(child,before){const at=node.children.indexOf(before);node.children.splice(at<0?node.children.length:at,0,child);child.parentElement=node;return child;},
      insertAdjacentElement(position,child){assert.equal(position,'afterend');node.parentElement.appendChild(child);},
      after(child){node.parentElement.appendChild(child);},
      remove(){node.removed=true;if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(child=>child!==node);},
      querySelector(selector){return node.children.find(child=>selector==='.'+child.className.split(' ').at(-1))||null;},
      focus(){focused=node.id;},addEventListener(){},getContext(){return node;}};
    Object.defineProperty(node,'parentNode',{get:()=>node.parentElement});
    all.push(node);if(id)nodes.set(id,node);return node;
  }
  for(const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)){
    const node=element(match[1],match[3]);node.value=match[2].match(/\bvalue="([^"]*)"/)?.[1]||'';
    node.parentElement=element();
  }
  const document={readyState:'loading',documentElement:element('html'),body:element('body'),
    getElementById:id=>nodes.get(id)||all.find(node=>node.id===id&&!node.removed)||null,
    createElement:tag=>element(tag),querySelectorAll:()=>[],
    addEventListener(name,fn){const list=events.get(name)||[];list.push(fn);events.set(name,list);}};
  const localStorage={get length(){return values.size;},key:i=>[...values.keys()][i]??null,getItem:key=>values.get(key)??null,
    setItem(key,value){values.set(String(key),String(value));writes.push({key:String(key),value:String(value)});},removeItem:key=>values.delete(key)};
  const context={document,localStorage,console,KK_LANG:'ja',kkT:key=>key==='kk_currency_symbol'?'¥':key,kkCat:value=>value,
    setTimeout:()=>1,clearTimeout(){},alert:message=>alerts.push(message),location:{origin:'https://entry.test'}};
  context.window=context;context.parent=context;
  const start=html.indexOf('var _year=new Date()'),end=html.indexOf('// ===== Brand Color Sync =====',start);
  assert.ok(start>=0&&end>start,'execute the real production entry handlers and renderers');
  const translations=html.indexOf('var KK_I18N =');assert.ok(translations>=0&&translations<start);
  vm.runInNewContext(html.slice(translations,start),context);
  vm.runInNewContext(html.slice(start,end),context);
  let renders=0,dayRenders=0;
  const render=context.renderAll,dayRender=context.renderDayModal;
  context.renderAll=function(){renders++;return render.apply(this,arguments);};
  context.renderDayModal=function(){dayRenders++;return dayRender.apply(this,arguments);};
  return {context,nodes,document,values,writes,alerts,all,events,
    get focused(){return focused;},get renders(){return renders;},get dayRenders(){return dayRenders;},
    fill(prefix,amount,name='架空の入力項目',category='食費'){
      const nameInput=nodes.get(prefix+'-name');
      if(nameInput)nameInput.value=name;else assert.ok(['inc','exp','inv'].includes(prefix),'only Home income/spending/investment omit their name field');
      nodes.get(prefix+'-amount').value=amount;
      if(nodes.get(prefix+'-cat'))nodes.get(prefix+'-cat').value=category;
    },
    errorFor(id){const input=nodes.get(id),description=input.getAttribute('aria-describedby');
      return description?(description.split(/\s+/).map(ref=>document.getElementById(ref)).find(note=>note&&!note.hidden&&note.textContent)||null):null;
    }};
}
function monthRows(h){return JSON.parse(h.values.get(h.context.getKey())||'[]');}

test('only Home income, spending and investment name labels and inputs are removed from the real DOM',()=>{
  const h=fixture();
  for(const id of ['inc-name','exp-name','inv-name']){
    assert.equal(h.document.getElementById(id),null);assert.equal(h.nodes.has(id),false);
    assert.doesNotMatch(html,new RegExp('\\b(?:id|for)="'+id+'"'));
  }
  for(const id of ['ast-name','m-inc-name','m-exp-name','m-inv-name'])assert.ok(h.nodes.has(id),id+' remains present and required');
});

test('all seven manual money fields retain full-width text and request a decimal keyboard',()=>{
  const ids=['inc-amount','exp-amount','inv-amount','ast-amount','m-inc-amount','m-exp-amount','m-inv-amount'];
  for(const id of ids){
    const tag=html.match(new RegExp('<input\\b[^>]*\\bid="'+id+'"[^>]*>'))?.[0];
    assert.ok(tag,id);assert.match(tag,/\btype="text"/);assert.match(tag,/\binputmode="decimal"/);
    assert.match(tag,/\boninput="kkClearEntryError\(this\)"/);
  }
});

test('the actual expense handler accepts complete full-width, grouped and yen amounts without truncation',()=>{
  for(const [input,expected] of [
    ['１０００',1000],['１，０００',1000],['1000',1000],['1,234,567',1234567],
    ['￥１，０００',1000],['¥1,000',1000],['１，０００円',1000],['　１０００　',1000],
    ['-1000',-1000],['－１０００',-1000],['1000.75',1000.75],['１２．５',12.5],['-0.5',-.5],['０．５',.5],['1,234.50',1234.5],
    ['1e3',1000],['1e-3',.001]
  ]){
    const h=fixture();h.fill('exp',input);h.context.addRecord('exp');
    const rows=monthRows(h);assert.equal(rows.length,1,input);assert.equal(rows[0].amount,expected,input);
    assert.equal(rows[0].type,'exp');assert.equal(rows[0].cat,'食費');assert.equal(h.alerts.length,0);
    assert.equal(h.renders,1);assert.equal(h.document.getElementById('exp-name'),null);assert.equal(h.nodes.get('exp-amount').value,'');
    assert.equal(rows[0].name,'食費');assert.match(h.nodes.get('rec-list-el').innerHTML,/食費/);
  }
});

test('malformed, partial, zero, nonfinite and unsafe amounts reject without clearing the Home draft or writing records',()=>{
  for(const input of ['','　','0','０００','0.0','-0','1,00','12,34,567','1,,000',',1000','1000,',
    '1000abc','abc1000','10円20','1e','1e+','1e3x','Infinity','NaN','1e309','1e-400','9007199254740992','-9007199254740992','9'.repeat(400)]){
    const h=fixture();h.fill('exp',input);h.context.addRecord('exp');
    assert.equal(monthRows(h).length,0,input);assert.equal(h.writes.length,0,input);assert.equal(h.renders,0,input);
    assert.equal(h.document.getElementById('exp-name'),null);assert.equal(h.nodes.get('exp-amount').value,input);
    assert.equal(h.nodes.get('exp-amount').getAttribute('aria-invalid'),'true',input);
    assert.ok(h.errorFor('exp-amount'),input);assert.equal(h.focused,'exp-amount',input);assert.equal(h.alerts.length,0,input);
  }
});

test('the shared parser validates the whole normalized numeric value and preserves signed decimals and exponents',()=>{
  const h=fixture();assert.equal(typeof h.context.kkParseAmount,'function');
  for(const [raw,expected] of [['１０００',1000],['１，０００円',1000],['￥１，０００．５',1000.5],['−１２．５',-12.5],
    ['＋１０００',1000],['1e3',1000],['1e-3',.001],['１Ｅ３',1000],['9007199254740991',Number.MAX_SAFE_INTEGER]]){
    assert.equal(h.context.kkParseAmount(raw),expected,raw);
  }
  for(const raw of ['',null,undefined,'０','-０．０','1,2','1,000,00','1.2.3','1 000','1/2','1-2','1000usd','円1000','¥¥1000',
    '1e','1e999','-1e999','1e-999','9007199254740992','-9007199254740992']){
    assert.equal(h.context.kkParseAmount(raw),null,String(raw));
  }
});

test('the shared reader distinguishes missing name, missing amount and invalid amount while preserving other descriptions',()=>{
  const h=fixture(),name=h.nodes.get('ast-name'),amount=h.nodes.get('ast-amount');
  name.setAttribute('aria-describedby','existing-name-help');amount.setAttribute('aria-describedby','existing-money-help');
  h.fill('ast','','');assert.equal(h.context.kkReadEntry('ast'),null);
  assert.equal(h.focused,'ast-name');
  assert.equal(h.document.getElementById('ast-name-error').getAttribute('data-i18n'),'kk_input_name_required');
  assert.equal(h.document.getElementById('ast-amount-error').getAttribute('data-i18n'),'kk_input_amount_required');
  assert.ok(name.getAttribute('aria-describedby').split(/\s+/).includes('existing-name-help'));
  assert.ok(amount.getAttribute('aria-describedby').split(/\s+/).includes('existing-money-help'));
  amount.value='1,23';h.context.kkClearEntryError(amount);
  assert.notEqual(amount.getAttribute('aria-invalid'),'true');assert.equal(h.errorFor('ast-amount'),null);
  assert.equal(amount.getAttribute('aria-describedby'),'existing-money-help');
  assert.equal(name.getAttribute('aria-invalid'),'true','editing one field must not clear another field error');
  name.value='架空の修正';h.context.kkClearEntryError(name);assert.equal(name.getAttribute('aria-describedby'),'existing-name-help');
  assert.equal(h.context.kkReadEntry('ast'),null);assert.equal(h.focused,'ast-amount');
  assert.equal(h.document.getElementById('ast-amount-error').getAttribute('data-i18n'),'kk_input_amount_invalid');
  amount.value='１０００';h.context.kkClearEntryError(amount);
  assert.deepEqual(JSON.parse(JSON.stringify(h.context.kkReadEntry('ast'))),{name:'架空の修正',amount:1000});
});

test('missing asset name identifies the field while a corrected retry saves exactly once and clears its error',()=>{
  const h=fixture(),assets=()=>JSON.parse(h.values.get('kb2_assets')||'[]');h.fill('ast','１０００','　 ','現金');h.context.addRecord('ast');
  assert.equal(h.nodes.get('ast-name').getAttribute('aria-invalid'),'true');assert.ok(h.errorFor('ast-name'));
  assert.equal(h.focused,'ast-name');assert.equal(h.nodes.get('ast-amount').value,'１０００');assert.equal(h.writes.length,0);
  h.nodes.get('ast-name').value='  架空の資産名  ';h.context.addRecord('ast');
  assert.equal(assets().length,1);assert.equal(assets()[0].name,'架空の資産名');
  assert.notEqual(h.nodes.get('ast-name').getAttribute('aria-invalid'),'true');assert.equal(h.errorFor('ast-name'),null);
  h.context.addRecord('ast');assert.equal(assets().length,1,'the empty second click must not duplicate the first record');assert.equal(h.writes.length,1);
});

test('each home record retains its fields and category, adds the selected date and leaves calendar records untouched',()=>{
  for(const [type,amount,category] of [['inc','２０００．５',''],['exp','１，０００','独自カテゴリ'],['inv','－１２．５','国内株']]){
    const originalDay='[{"id":91,"type":"exp","name":"架空の日別","amount":3,"cat":"食費"}]';
    const h=fixture({kbday_2026_10_15:originalDay});h.fill(type,amount,'架空の月入力',category);
    const selectedDate=h.nodes.get('kkEntryDate').value;h.context.addRecord(type);
    const rows=monthRows(h);assert.equal(rows.length,1);assert.deepEqual(Object.keys(rows[0]).sort(),['amount','cat','date','id','name','type']);
    assert.equal(rows[0].date,selectedDate);assert.match(selectedDate,/^\d{4}-\d{2}-\d{2}$/);
    assert.equal(rows[0].type,type);assert.equal(rows[0].cat,category);assert.equal(typeof rows[0].id,'number');
    assert.equal(h.values.get('kbday_2026_10_15'),originalDay);assert.equal(h.renders,1);assert.equal(h.dayRenders,0);
  }
});

test('day-modal entries retain the daily schema and date and never merge into the monthly ledger',()=>{
  for(const [type,amount,expected,category] of [['inc','１０００',1000,''],['exp','１，０００円',1000,'食費'],['inv','－１２．５',-12.5,'国内株']]){
    const h=fixture();h.context._modalDate={y:2026,m:10,day:15};h.fill('m-'+type,amount,'架空の日入力',category);
    h.context.addDayRecord(type);const rows=JSON.parse(h.values.get('kbday_2026_10_15')||'[]');
    assert.equal(rows.length,1);assert.equal(rows[0].amount,expected);assert.equal(rows[0].type,type);assert.equal(rows[0].cat,category);
    assert.deepEqual(Object.keys(rows[0]).sort(),['amount','cat','id','name','type']);assert.equal(monthRows(h).length,0);
    assert.equal(h.dayRenders,1);assert.equal(h.renders,0);assert.equal(h.nodes.get('m-'+type+'-amount').value,'');
    assert.match(h.nodes.get('dayRecList').innerHTML,/架空の日入力/);
    h.context.addDayRecord(type);assert.equal(JSON.parse(h.values.get('kbday_2026_10_15')).length,1);assert.equal(h.writes.length,1);
  }
});

test('assets retain the existing independent schema and signed fractional value',()=>{
  const h=fixture();h.fill('ast','－１，０００．５','架空の資産','現金');h.context.addRecord('ast');
  const rows=JSON.parse(h.values.get('kb2_assets')||'[]');assert.equal(rows.length,1);
  assert.deepEqual(Object.keys(rows[0]).sort(),['amount','cat','id','name']);assert.equal(rows[0].amount,-1000.5);assert.equal(rows[0].cat,'現金');
  assert.equal(monthRows(h).length,0);assert.equal(h.renders,1);assert.equal(h.nodes.get('ast-amount').value,'');
});

test('invalid daily and asset submissions mark their own fields and leave other forms and data alone',()=>{
  for(const prefix of ['m-inc','m-exp','m-inv','ast']){
    const h=fixture();h.context._modalDate={y:2026,m:10,day:15};h.fill(prefix,'１，２３','架空の保存前');h.fill('exp','５００','別の架空下書き');
    const otherName=prefix==='ast'?'m-inc-name':'ast-name';h.nodes.get(otherName).value='別の架空下書き';const date=h.nodes.get('kkEntryDate').value;
    if(prefix==='ast')h.context.addRecord('ast');else h.context.addDayRecord(prefix.slice(2));
    assert.equal(h.writes.length,0);assert.equal(h.nodes.get(prefix+'-amount').value,'１，２３');assert.equal(h.nodes.get(prefix+'-name').value,'架空の保存前');
    assert.equal(h.nodes.get(prefix+'-amount').getAttribute('aria-invalid'),'true');assert.ok(h.errorFor(prefix+'-amount'));
    assert.equal(h.focused,prefix+'-amount');assert.equal(h.nodes.get('exp-amount').value,'５００');assert.equal(h.nodes.get(otherName).value,'別の架空下書き');assert.equal(h.nodes.get('kkEntryDate').value,date);
  }
});

test('a failed local write retains a valid draft for retry without a success redraw',()=>{
  for(const prefix of ['inc','exp','inv','m-exp','ast']){
    const h=fixture();h.context._modalDate={y:2026,m:10,day:15};h.fill(prefix,'１０００','架空の保存待ち');
    const date=h.nodes.get('kkEntryDate').value;
    h.context.localStorage.setItem=()=>{throw new Error('synthetic storage failure');};
    try{if(prefix==='m-exp')h.context.addDayRecord('exp');else h.context.addRecord(prefix);}catch(error){assert.match(error.message,/synthetic storage failure/);}
    if(h.nodes.has(prefix+'-name'))assert.equal(h.nodes.get(prefix+'-name').value,'架空の保存待ち');else assert.equal(h.document.getElementById(prefix+'-name'),null);
    assert.equal(h.nodes.get(prefix+'-amount').value,'１０００');assert.equal(h.nodes.get('kkEntryDate').value,date);
    assert.equal(h.writes.length,0);assert.equal(h.renders,0);assert.equal(h.dayRenders,0);
  }
});

test('all Home entry types save without name inputs, reject an empty repeat and accept the next amount',()=>{
  for(const type of ['inc','exp','inv']){
    const h=fixture();assert.equal(h.document.getElementById(type+'-name'),null);
    const category=type==='inv'?'米国株':'独自の食費';h.fill(type,'１，０００．５','unused Home name',category);const date=h.nodes.get('kkEntryDate').value;h.context.addRecord(type);
    let rows=monthRows(h);assert.equal(rows.length,1);assert.equal(rows[0].amount,1000.5);assert.equal(rows[0].date,date);
    assert.equal(rows[0].name,type==='inc'?h.context.kkT('kk_js_income'):category);assert.equal(h.nodes.get(type+'-amount').value,'');
    const original=JSON.parse(JSON.stringify(rows[0]));h.context.addRecord(type);
    assert.deepEqual(monthRows(h),[original]);assert.equal(h.writes.length,1);assert.equal(h.nodes.get(type+'-amount').getAttribute('aria-invalid'),'true');
    h.nodes.get(type+'-amount').value='２００';h.context.addRecord(type);rows=monthRows(h);
    assert.equal(rows.length,2);assert.deepEqual(rows[0],original);assert.equal(rows[1].amount,200);assert.equal(rows[1].date,date);assert.equal(rows[1].name,original.name);assert.equal(h.writes.length,2);
    assert.notEqual(h.nodes.get(type+'-amount').getAttribute('aria-invalid'),'true');assert.equal(h.errorFor(type+'-amount'),null);
  }
});

test('automatic Home names use current income translation and literal expense or investment categories',()=>{
  const incomeNames=new Set();
  for(const lang of ['ja','en','ko','zh']){
    for(const [type,category] of [['inc',''],['exp','旅行・カフェ'],['exp',''],['inv','国内株'],['inv','ETF'],['inv','']]){
      const h=fixture();h.context.kkApplyLang(lang);h.writes.length=0;h.fill(type,'１０００','unused Home name',category);h.context.addRecord(type);
      const saved=monthRows(h)[0],expected=type==='inc'?h.context.kkT('kk_js_income'):category||h.context.kkT(type==='inv'?'kk_js_investment':'kk_js_expense');
      assert.equal(saved.name,expected);assert.equal(saved.cat,type==='inc'?'':category);assert.equal(saved.amount,1000);assert.ok(saved.name);assert.equal(h.writes.length,1);
      assert.equal(h.document.getElementById(type+'-name'),null);assert.equal(h.document.getElementById(type+'-name-error'),null);
      if(type==='inc')incomeNames.add(saved.name);
    }
  }
  assert.equal(incomeNames.size,4);
});

test('asset and each calendar form still require a name before any valid amount can save',()=>{
  for(const prefix of ['ast','m-inc','m-exp','m-inv']){
    const h=fixture();h.context._modalDate={y:2026,m:10,day:15};h.fill(prefix,'１０００','　 ','現金');
    const save=()=>prefix.startsWith('m-')?h.context.addDayRecord(prefix.slice(2)):h.context.addRecord(prefix);
    save();assert.equal(h.writes.length,0,prefix);assert.equal(h.focused,prefix+'-name');assert.equal(h.nodes.get(prefix+'-name').getAttribute('aria-invalid'),'true');assert.ok(h.errorFor(prefix+'-name'));
    assert.equal(h.nodes.get(prefix+'-amount').value,'１０００');h.nodes.get(prefix+'-name').value='  架空の必須名称  ';save();
    const key=prefix==='ast'?'kb2_assets':prefix.startsWith('m-')?'kbday_2026_10_15':h.context.getKey();
    const saved=JSON.parse(h.values.get(key));assert.equal(saved.length,1);assert.equal(saved[0].name,'架空の必須名称');assert.equal(saved[0].amount,1000);assert.equal(h.writes.length,1);
    assert.notEqual(h.nodes.get(prefix+'-name').getAttribute('aria-invalid'),'true');
  }
});

test('removing Home item fields never rewrites old names, dates, signed values or other record attributes',()=>{
  const now=new Date(),key='kb2_'+now.getFullYear()+'_'+String(now.getMonth()+1).padStart(2,'0'),date=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-01';
  const legacy=[{id:1,type:'inc',name:'以前の架空の給与名',amount:1234.5,date,extra:{keep:true}},
    {id:2,type:'exp',name:'以前の架空の買い物名',cat:'食費',amount:-12.25},
    {id:3,type:'inv',name:'以前の架空の投資名',cat:'国内株',amount:10,date}];
  const raw=JSON.stringify(legacy),h=fixture({[key]:raw});assert.equal(h.values.get(key),raw);assert.equal(h.writes.length,0);
  h.context.renderAll();assert.equal(h.values.get(key),raw);h.fill('inv','－５０．２５','ignored','ETF');const selectedDate=h.nodes.get('kkEntryDate').value;h.context.addRecord('inv');
  const saved=monthRows(h);assert.deepEqual(saved.slice(0,3),legacy);assert.equal(saved[3].name,'ETF');assert.equal(saved[3].cat,'ETF');assert.equal(saved[3].amount,-50.25);assert.equal(saved[3].date,selectedDate);
  const reloaded=fixture(Object.fromEntries(h.values));assert.deepEqual(monthRows(reloaded),saved);
  for(const row of legacy)assert.match(reloaded.nodes.get('rec-list-el').innerHTML,new RegExp(row.name));
});

test('Home amount and date failures keep the selected category and remaining drafts without a phantom name error',()=>{
  for(const type of ['inc','exp','inv']){
    const h=fixture();h.fill(type,'1,23','ignored',type==='inv'?'ETF':'架空の分類');const date=h.nodes.get('kkEntryDate').value;
    h.nodes.get('ast-name').value='保存前の資産名';h.context.addRecord(type);
    assert.equal(h.writes.length,0);assert.equal(h.focused,type+'-amount');assert.equal(h.nodes.get(type+'-amount').value,'1,23');assert.equal(h.nodes.get('kkEntryDate').value,date);
    h.nodes.get(type+'-amount').value='１０００';h.nodes.get('kkEntryDate').value='';h.context.addRecord(type);
    assert.equal(h.writes.length,0);assert.equal(h.focused,'kkEntryDate');assert.equal(h.nodes.get(type+'-amount').value,'１０００');assert.equal(h.nodes.get('kkEntryDate').value,'');
    assert.equal(h.nodes.get('exp-cat').value,type==='exp'?'架空の分類':'');assert.equal(h.nodes.get('ast-name').value,'保存前の資産名');assert.equal(h.document.getElementById(type+'-name-error'),null);
    if(type==='inv')assert.equal(h.nodes.get('inv-cat').value,'ETF');
    h.nodes.get('kkEntryDate').value=date;h.context.addRecord(type);assert.equal(monthRows(h).length,1);assert.equal(monthRows(h)[0].amount,1000);
  }
});

test('Home investment rejects invalid amount and dates without a name field and saves the corrected signed fraction',()=>{
  for(const value of ['','0','１，２３','NaN','1e309','9007199254740992']){
    const h=fixture();assert.equal(h.document.getElementById('inv-name'),null);h.fill('inv',value,'ignored','投資信託');
    const date=h.nodes.get('kkEntryDate').value;h.nodes.get('ast-name').value='保存前の資産名';h.context.addRecord('inv');
    assert.equal(h.writes.length,0);assert.equal(h.focused,'inv-amount');assert.equal(h.nodes.get('inv-amount').value,value);assert.equal(h.nodes.get('inv-cat').value,'投資信託');assert.equal(h.nodes.get('kkEntryDate').value,date);assert.equal(h.nodes.get('ast-name').value,'保存前の資産名');assert.ok(h.errorFor('inv-amount'));
    h.nodes.get('inv-amount').value='－１２．５';h.context.addRecord('inv');const saved=monthRows(h)[0];assert.equal(saved.name,'投資信託');assert.equal(saved.amount,-12.5);assert.equal(saved.date,date);assert.equal(h.writes.length,1);
  }
  for(const kind of ['blank','impossible','other-month']){
    const h=fixture();h.fill('inv','１２．５','ignored','ETF');const date=h.nodes.get('kkEntryDate').value;
    const serial=h.context._year*12+h.context._month,other=String(Math.floor(serial/12)).padStart(4,'0')+'-'+String(serial%12+1).padStart(2,'0')+'-01';
    const invalid=kind==='blank'?'':kind==='impossible'?date.slice(0,8)+'32':other;h.nodes.get('kkEntryDate').value=invalid;h.context.addRecord('inv');
    assert.equal(h.writes.length,0);assert.equal(h.focused,'kkEntryDate');assert.equal(h.nodes.get('inv-amount').value,'１２．５');assert.equal(h.nodes.get('inv-cat').value,'ETF');assert.equal(h.nodes.get('kkEntryDate').value,invalid);assert.ok(h.errorFor('kkEntryDate'));assert.equal(h.document.getElementById('inv-name-error'),null);
    h.nodes.get('kkEntryDate').value=date;h.context.addRecord('inv');const saved=monthRows(h)[0];assert.equal(saved.name,'ETF');assert.equal(saved.amount,12.5);assert.equal(saved.date,date);assert.equal(h.writes.length,1);
  }
});

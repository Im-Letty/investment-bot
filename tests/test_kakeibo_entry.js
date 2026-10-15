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
  vm.runInNewContext(html.slice(start,end),context);
  let renders=0,dayRenders=0;
  const render=context.renderAll,dayRender=context.renderDayModal;
  context.renderAll=function(){renders++;return render.apply(this,arguments);};
  context.renderDayModal=function(){dayRenders++;return dayRender.apply(this,arguments);};
  return {context,nodes,document,values,writes,alerts,all,events,
    get focused(){return focused;},get renders(){return renders;},get dayRenders(){return dayRenders;},
    fill(prefix,amount,name='架空の入力項目',category='食費'){
      nodes.get(prefix+'-name').value=name;nodes.get(prefix+'-amount').value=amount;
      if(nodes.get(prefix+'-cat'))nodes.get(prefix+'-cat').value=category;
    },
    errorFor(id){const input=nodes.get(id),description=input.getAttribute('aria-describedby');
      return description?(description.split(/\s+/).map(ref=>document.getElementById(ref)).find(note=>note&&!note.hidden&&note.textContent)||null):null;
    }};
}
function monthRows(h){return JSON.parse(h.values.get(h.context.getKey())||'[]');}

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
    assert.equal(h.renders,1);assert.equal(h.nodes.get('exp-name').value,'');assert.equal(h.nodes.get('exp-amount').value,'');
    assert.match(h.nodes.get('rec-list-el').innerHTML,/架空の入力項目/);
  }
});

test('malformed, partial, zero, nonfinite and unsafe amounts reject without clearing either draft or writing records',()=>{
  for(const input of ['','　','0','０００','0.0','-0','1,00','12,34,567','1,,000',',1000','1000,',
    '1000abc','abc1000','10円20','1e','1e+','1e3x','Infinity','NaN','1e309','1e-400','9007199254740992','-9007199254740992','9'.repeat(400)]){
    const h=fixture();h.fill('exp',input);h.context.addRecord('exp');
    assert.equal(monthRows(h).length,0,input);assert.equal(h.writes.length,0,input);assert.equal(h.renders,0,input);
    assert.equal(h.nodes.get('exp-name').value,'架空の入力項目');assert.equal(h.nodes.get('exp-amount').value,input);
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
  const h=fixture(),name=h.nodes.get('exp-name'),amount=h.nodes.get('exp-amount');
  name.setAttribute('aria-describedby','existing-name-help');amount.setAttribute('aria-describedby','existing-money-help');
  h.fill('exp','','');assert.equal(h.context.kkReadEntry('exp'),null);
  assert.equal(h.focused,'exp-name');
  assert.equal(h.document.getElementById('exp-name-error').getAttribute('data-i18n'),'kk_input_name_required');
  assert.equal(h.document.getElementById('exp-amount-error').getAttribute('data-i18n'),'kk_input_amount_required');
  assert.ok(name.getAttribute('aria-describedby').split(/\s+/).includes('existing-name-help'));
  assert.ok(amount.getAttribute('aria-describedby').split(/\s+/).includes('existing-money-help'));
  amount.value='1,23';h.context.kkClearEntryError(amount);
  assert.notEqual(amount.getAttribute('aria-invalid'),'true');assert.equal(h.errorFor('exp-amount'),null);
  assert.equal(amount.getAttribute('aria-describedby'),'existing-money-help');
  assert.equal(name.getAttribute('aria-invalid'),'true','editing one field must not clear another field error');
  name.value='架空の修正';h.context.kkClearEntryError(name);assert.equal(name.getAttribute('aria-describedby'),'existing-name-help');
  assert.equal(h.context.kkReadEntry('exp'),null);assert.equal(h.focused,'exp-amount');
  assert.equal(h.document.getElementById('exp-amount-error').getAttribute('data-i18n'),'kk_input_amount_invalid');
  amount.value='１０００';h.context.kkClearEntryError(amount);
  assert.deepEqual(JSON.parse(JSON.stringify(h.context.kkReadEntry('exp'))),{name:'架空の修正',amount:1000});
});

test('missing item name identifies the name field while a corrected retry saves exactly once and clears its error',()=>{
  const h=fixture();h.fill('exp','１０００','　 ');h.context.addRecord('exp');
  assert.equal(h.nodes.get('exp-name').getAttribute('aria-invalid'),'true');assert.ok(h.errorFor('exp-name'));
  assert.equal(h.focused,'exp-name');assert.equal(h.nodes.get('exp-amount').value,'１０００');assert.equal(h.writes.length,0);
  h.nodes.get('exp-name').value='  架空の食費  ';h.context.addRecord('exp');
  assert.equal(monthRows(h).length,1);assert.equal(monthRows(h)[0].name,'架空の食費');
  assert.notEqual(h.nodes.get('exp-name').getAttribute('aria-invalid'),'true');assert.equal(h.errorFor('exp-name'),null);
  h.context.addRecord('exp');assert.equal(monthRows(h).length,1,'the empty second click must not duplicate the first record');assert.equal(h.writes.length,1);
});

test('each monthly record type keeps its existing schema and selected category while daily data is untouched',()=>{
  for(const [type,amount,category] of [['inc','２０００．５',''],['exp','１，０００','独自カテゴリ'],['inv','－１２．５','国内株']]){
    const originalDay='[{"id":91,"type":"exp","name":"架空の日別","amount":3,"cat":"食費"}]';
    const h=fixture({kbday_2026_10_15:originalDay});h.fill(type,amount,'架空の月入力',category);h.context.addRecord(type);
    const rows=monthRows(h);assert.equal(rows.length,1);assert.deepEqual(Object.keys(rows[0]).sort(),['amount','cat','id','name','type']);
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
    if(prefix==='ast')h.context.addRecord('ast');else h.context.addDayRecord(prefix.slice(2));
    assert.equal(h.writes.length,0);assert.equal(h.nodes.get(prefix+'-amount').value,'１，２３');assert.equal(h.nodes.get(prefix+'-name').value,'架空の保存前');
    assert.equal(h.nodes.get(prefix+'-amount').getAttribute('aria-invalid'),'true');assert.ok(h.errorFor(prefix+'-amount'));
    assert.equal(h.focused,prefix+'-amount');assert.equal(h.nodes.get('exp-amount').value,'５００');assert.equal(h.nodes.get('exp-name').value,'別の架空下書き');
  }
});

test('a failed local write retains a valid draft for retry without a success redraw',()=>{
  for(const prefix of ['exp','m-exp','ast']){
    const h=fixture();h.context._modalDate={y:2026,m:10,day:15};h.fill(prefix,'１０００','架空の保存待ち');
    h.context.localStorage.setItem=()=>{throw new Error('synthetic storage failure');};
    try{if(prefix==='m-exp')h.context.addDayRecord('exp');else h.context.addRecord(prefix);}catch(error){assert.match(error.message,/synthetic storage failure/);}
    assert.equal(h.nodes.get(prefix+'-name').value,'架空の保存待ち');assert.equal(h.nodes.get(prefix+'-amount').value,'１０００');
    assert.equal(h.writes.length,0);assert.equal(h.renders,0);assert.equal(h.dayRenders,0);
  }
});

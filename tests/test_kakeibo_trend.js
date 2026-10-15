'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','kakeibo.html'),'utf8');
const theme=fs.readFileSync(path.join(__dirname,'..','static/mypage-kakeibo-theme.js'),'utf8');
const fixedTime=Date.parse('2026-10-15T12:00:00+09:00');
class ClockDate extends Date{constructor(...args){super(...(args.length?args:[fixedTime]));}static now(){return fixedTime;}}
function rows(income=0,expense=0,investment=0){return [
  ...(income?[{id:1,type:'inc',name:'架空の収入',cat:'',amount:income}]:[]),
  ...(expense?[{id:2,type:'exp',name:'架空の支出',cat:'食費',amount:expense}]:[]),
  ...(investment?[{id:3,type:'inv',name:'架空の投資',cat:'国内株',amount:investment}]:[])
];}
function monthKey(year,month){return 'kb2_'+String(year).padStart(4,'0')+'_'+String(month).padStart(2,'0');}
function seedMonth(year,month,records){return {[monthKey(year,month)]:JSON.stringify(records)};}
function copy(value){return JSON.parse(JSON.stringify(value));}
function total(values){return Array.from(values).reduce((sum,value)=>sum+(value||0),0);}

function fixture(seed={},{charts=false,mutatePalette=false}={}){
  const nodes=new Map(),all=[],stack=[],values=new Map(Object.entries(seed)),reads=[],writes=[],events=new Map(),frames=new Map();
  const chartInstances=new Map(),created=[],destroyed=[],plugins=[];let sequence=0,focused='';
  function element(tag='div',id=''){
    const attrs=new Map(),classes=new Set(),variables=new Map();
    const node={id,tagName:tag.toUpperCase(),className:'',children:[],value:'',textContent:'',innerHTML:'',hidden:false,
      style:{setProperty:(key,value)=>variables.set(key,String(value)),getPropertyValue:key=>variables.get(key)||''},
      classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name),toggle(name,on){if(on)classes.add(name);else classes.delete(name);}},
      setAttribute:(key,value)=>attrs.set(key,String(value)),getAttribute:key=>attrs.get(key)??null,removeAttribute:key=>attrs.delete(key),
      appendChild(child){node.children.push(child);child.parentElement=node;return child;},
      insertAdjacentElement(position,child){assert.equal(position,'afterend');node.parentElement.appendChild(child);},
      querySelector(selector){return node.children.find(child=>selector==='.'+child.className.split(' ').at(-1))||null;},
      focus(){focused=node.id;},addEventListener(){},getContext(){return node;}};
    all.push(node);if(id)nodes.set(id,node);return node;
  }
  const markup=html.replace(/<script\b[\s\S]*?<\/script>/gi,'').replace(/<style\b[\s\S]*?<\/style>/gi,'');
  const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  for(const match of markup.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*)>/gi)){
    const tag=match[2].toLowerCase();
    if(match[1]){for(let i=stack.length-1;i>=0;i--)if(stack[i].tagName===tag.toUpperCase()){stack.length=i;break;}continue;}
    const attributes=match[3],id=attributes.match(/\bid="([^"]+)"/)?.[1]||'',node=element(tag,id);
    for(const attr of attributes.matchAll(/([\w-]+)="([^"]*)"/g))node.setAttribute(attr[1],attr[2]);
    node.className=node.getAttribute('class')||'';for(const name of node.className.split(/\s+/).filter(Boolean))node.classList.add(name);
    node.value=node.getAttribute('value')||'';node.hidden=/(?:^|\s)hidden(?:\s|=|$)/.test(attributes);
    node.style.display=attributes.match(/\bstyle="[^"]*\bdisplay\s*:\s*([^;"\s]+)/)?.[1]||'';
    if(stack.length)stack.at(-1).appendChild(node);
    if(!voidTags.has(tag)&&!attributes.trimEnd().endsWith('/'))stack.push(node);
  }
  function matches(node,selector){
    if(selector==='canvas')return node.tagName==='CANVAS';
    if(selector.startsWith('.'))return node.classList.contains(selector.slice(1));
    const attr=selector.match(/^\[([^\]]+)\]$/);return !!attr&&node.getAttribute(attr[1])!==null;
  }
  const document={readyState:'loading',documentElement:all.find(node=>node.tagName==='HTML'),body:all.find(node=>node.tagName==='BODY'),
    getElementById:id=>nodes.get(id)||all.find(node=>node.id===id)||null,createElement:tag=>element(tag),querySelectorAll:selector=>all.filter(node=>matches(node,selector)),
    addEventListener(name,fn){const key='document:'+name;events.set(key,[...(events.get(key)||[]),fn]);}};
  const localStorage={get length(){return values.size;},key:index=>[...values.keys()][index]??null,
    getItem(key){reads.push(key);return values.get(key)??null;},setItem(key,value){values.set(String(key),String(value));writes.push(key);},removeItem:key=>values.delete(key)};
  const context={document,localStorage,Date:ClockDate,console,location:{origin:'https://trend.test'},setTimeout:()=>1,clearTimeout(){},
    Event:class{constructor(type){this.type=type;}},MutationObserver:class{observe(){}},
    getComputedStyle:()=>({fontFamily:'fixture-family',color:'',getPropertyValue:()=>''}),
    requestAnimationFrame(fn){frames.set(++sequence,fn);return sequence;},
    addEventListener(name,fn){const key='window:'+name;events.set(key,[...(events.get(key)||[]),fn]);},
    dispatchEvent(event){for(const fn of events.get('window:'+event.type)||[])fn(event);},alert(message){throw Error(message);},
    fetch(){throw Error('no request is allowed in this fixture');}};
  context.window=context;context.parent=context;
  if(charts)context.Chart=class{
    static getChart(canvas){return chartInstances.get(typeof canvas==='string'?canvas:canvas.id);}
    static register(plugin){plugins.push(plugin);}
    constructor(canvas,config){this.canvas=canvas;this.config=config;this.data=config.data;this.options=config.options;chartInstances.set(canvas.id,this);created.push(this);
      if(mutatePalette)this.data.datasets[0].backgroundColor='fixture-resolved-palette';}
    update(){for(const plugin of plugins)plugin.beforeUpdate(this);}
    destroy(){destroyed.push(this);if(chartInstances.get(this.canvas.id)===this)chartInstances.delete(this.canvas.id);}
  };
  const begin=html.indexOf('var KK_I18N ='),core=html.indexOf('var _year=new Date()'),end=html.indexOf('// ===== Brand Color Sync =====',core);
  assert.ok(begin>=0&&core>begin&&end>core);vm.runInNewContext(html.slice(begin,core),context);vm.runInNewContext(html.slice(core,end),context);
  return {context,document,nodes,values,reads,writes,created,destroyed,chartInstances,makeElement:element,get focused(){return focused;},
    data(){return context.kkTrendData();},
    setPeriod(period){context.kkTrendSetPeriod(period);return context.kkTrendData();},
    custom(from,to){context.kkTrendSetPeriod('custom');nodes.get('kkTrendFrom').value=from;nodes.get('kkTrendTo').value=to;context.kkTrendApplyRange();return context.kkTrendData();},
    theme(){vm.runInNewContext(theme,context);},
    fire(name){for(const fn of events.get('window:'+name)||[])fn({type:name});},
    flush(){let rounds=0;while(frames.size){assert.ok(++rounds<20);const tasks=[...frames.values()];frames.clear();for(const fn of tasks)fn();}}
  };
}

test('strict month parsing and formatting reject impossible custom endpoints',()=>{
  const h=fixture();
  for(const value of ['0001-01','2026-01','2026-12','9999-12'])assert.equal(h.context.kkTrendMonthValue(h.context.kkTrendMonth(value)),value);
  for(const value of ['','2026-00','2026-13','2026-1','2026-001','2026/01','0000-01','10000-01','2026-01x',' 2026-01','２０２６-０１'])assert.equal(h.context.kkTrendMonth(value),null,value);
});
test('six, twelve and thirty-six month presets end at the selected month and cross years correctly',()=>{
  const h=fixture({...seedMonth(2023,2,rows(3,1)),...seedMonth(2025,12,rows(100,20)),...seedMonth(2026,1,rows(200,30))});
  h.context._year=2026;h.context._month=1;
  for(const [period,from,count] of [['6','2025-08',6],['12','2025-02',12],['36','2023-02',36]]){
    const data=h.setPeriod(period);assert.equal(data.from,from);assert.equal(data.to,'2026-01');assert.equal(data.months,count);assert.equal(data.unit,'month');assert.equal(data.labels.length,count);
    assert.equal(data.income.at(-1),200);assert.equal(data.expense.at(-1),30);
    assert.equal(total(data.income),period==='36'?303:300);
  }
});
test('one-month preset spans day one through the actual last day, including Gregorian leap years',()=>{
  for(const [year,month,days] of [[2026,1,31],[2026,4,30],[2023,2,28],[2024,2,29],[1900,2,28],[2000,2,29]]){
    const value=String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0');
    const h=fixture(seedMonth(year,month,[{id:1,type:'inc',name:'架空の初日収入',amount:10,date:value+'-01'},{id:2,type:'inc',name:'架空の月末収入',amount:5,date:value+'-'+days}]));
    h.context._year=year;h.context._month=month;const data=h.setPeriod('1');
    assert.equal(data.labels.length,days,year+'-'+month+' starts at day one and includes every calendar day');
    assert.equal(data.unit,'day');assert.equal(data.days,days);assert.equal(data.months,1);assert.equal(data.from,value);assert.equal(data.to,value);
    assert.deepEqual(copy(data.labels),Array.from({length:days},(_,index)=>String(index+1)));
    assert.equal(data.income[0],10);assert.equal(data.income.at(-1),5);assert.equal(total(data.income),15);
  }
});
test('default all shows every stored past and future monthly input, with missing months zero and empty arrays excluded from bounds',()=>{
  const h=fixture({...seedMonth(1900,1,[]),...seedMonth(2022,12,rows(10,2)),...seedMonth(2026,10,rows(20,3)),...seedMonth(2029,1,rows(30,4)),...seedMonth(9999,12,[])},{charts:true});
  const line=h.chartInstances.get('lineChart');assert.equal(line.data.labels.length,74,'the visible chart includes older and future input instead of only the selected six months');
  assert.equal(total(line.data.datasets[0].data),60);assert.equal(total(line.data.datasets[1].data),9);
  const data=h.data();assert.equal(h.context._trendPeriod,'all');assert.equal(data.from,'2022-12');assert.equal(data.to,'2029-01');assert.equal(data.months,74);
  assert.equal(data.labels.length,74);assert.equal(data.unit,'month');assert.equal(data.income[0],10);assert.equal(data.income.at(-1),30);assert.equal(data.income[1],0);
  assert.equal(total(data.income),60);assert.equal(total(data.expense),9);assert.equal(data.unreadable,false);
  h.context.changeMonth(-20);assert.deepEqual(copy(h.data()),copy(data),'all is independent of the overview month cursor');
});
test('daily, assets, backups and malformed key names cannot enter or extend the trend',()=>{
  const h=fixture({...seedMonth(2026,10,rows(20,3)),
    kbday_1800_01_01:JSON.stringify(rows(999,999)),kb2_assets:JSON.stringify([{amount:8888}]),
    'kn_ledger_backup:other-owner':JSON.stringify(seedMonth(1700,1,rows(9999,9999))),
    kb2_2026_1:JSON.stringify(rows(7777,7777)),kb2_2026_13:JSON.stringify(rows(7777,7777)),kb2_2026_10_extra:JSON.stringify(rows(7777,7777))});
  h.reads.length=0;const data=h.data();
  assert.equal(data.from,'2026-10');assert.equal(data.to,'2026-10');assert.deepEqual(copy(data.income),[20]);assert.deepEqual(copy(data.expense),[3]);
  assert.ok(h.reads.every(key=>/^kb2_\d{4}_\d{2}$/.test(key)&&!key.endsWith('_13')),JSON.stringify(h.reads));
});
test('investment-only input months define all bounds but never become income or expense series',()=>{
  const h=fixture({...seedMonth(2026,1,rows(0,0,10000)),...seedMonth(2026,3,rows(100,20,5000))}),data=h.data();
  assert.equal(data.from,'2026-01');assert.equal(data.to,'2026-03');assert.deepEqual(copy(data.income),[0,0,100]);assert.deepEqual(copy(data.expense),[0,0,20]);
});
test('custom endpoints are inclusive, keep committed data on invalid drafts and recover with an explicit apply',()=>{
  const h=fixture({...seedMonth(2025,12,rows(1,2)),...seedMonth(2026,1,rows(3,4)),...seedMonth(2026,2,rows(5,6)),...seedMonth(2026,3,rows(7,8))},{charts:true});
  const original=h.custom('2026-01','2026-02');assert.equal(original.from,'2026-01');assert.equal(original.to,'2026-02');assert.deepEqual(copy(original.income),[3,5]);assert.deepEqual(copy(original.expense),[4,6]);
  const committed=copy(h.context._trendCustom),chart=h.chartInstances.get('lineChart');
  for(const [from,to] of [['2026-03','2026-01'],['2026-13','2026-03'],['','2026-03'],['2026-1','2026-03']]){
    h.nodes.get('kkTrendFrom').value=from;h.nodes.get('kkTrendTo').value=to;h.context.kkTrendApplyRange();
    assert.deepEqual(copy(h.context._trendCustom),committed);assert.deepEqual(copy(h.data()),copy(original));assert.equal(h.chartInstances.get('lineChart'),chart);
    assert.equal(h.nodes.get('kkTrendFrom').value,from);assert.equal(h.nodes.get('kkTrendTo').value,to);
    assert.equal(h.nodes.get('kkTrendError').hidden,false);assert.equal(h.nodes.get('kkTrendError').getAttribute('data-i18n'),'kk_trend_invalid_range');
    assert.ok([h.nodes.get('kkTrendFrom'),h.nodes.get('kkTrendTo')].some(node=>node.getAttribute('aria-invalid')==='true'));
  }
  h.nodes.get('kkTrendFrom').value='2025-12';h.nodes.get('kkTrendTo').value='2026-03';h.context.kkTrendApplyRange();
  assert.equal(h.data().months,4);assert.equal(total(h.data().income),16);assert.equal(total(h.data().expense),20);assert.equal(h.nodes.get('kkTrendError').hidden,true);
});
test('entering custom mode seeds the current effective range and later redraws do not overwrite drafts',()=>{
  const h=fixture({...seedMonth(2025,1,rows(5,1)),...seedMonth(2026,10,rows(10,2))});
  const data=h.setPeriod('6');h.setPeriod('custom');assert.equal(h.nodes.get('kkTrendFrom').value,data.from);assert.equal(h.nodes.get('kkTrendTo').value,data.to);
  h.nodes.get('kkTrendFrom').value='2026-13';h.nodes.get('kkTrendTo').value='';h.context.kkTrendApplyRange();
  h.context.renderAll();h.context.kkApplyLang('en');h.context.renderAll();
  assert.equal(h.nodes.get('kkTrendFrom').value,'2026-13');assert.equal(h.nodes.get('kkTrendTo').value,'');assert.equal(h.nodes.get('kkTrendError').hidden,false);assert.equal(h.context._trendPeriod,'custom');
});
test('120 months stay monthly and 121 months switch to annual buckets without dropping any record',()=>{
  const seed={};for(let year=2017;year<=2026;year++)for(let month=1;month<=12;month++)Object.assign(seed,seedMonth(year,month,rows(1,2)));
  const h=fixture(seed);let data=h.data();assert.equal(data.months,120);assert.equal(data.unit,'month');assert.equal(data.labels.length,120);assert.equal(total(data.income),120);assert.equal(total(data.expense),240);
  h.context.localStorage.setItem('kb2_2016_12',JSON.stringify(rows(3,4)));h.context.renderAll();data=h.data();
  assert.equal(data.from,'2016-12');assert.equal(data.to,'2026-12');assert.equal(data.months,121);assert.equal(data.unit,'year');assert.equal(data.labels.length,11);
  assert.equal(total(data.income),123);assert.equal(total(data.expense),244);assert.equal(data.income[0],3);assert.equal(data.expense[0],4);
  assert.match(h.nodes.get('kkTrendRange').textContent,/年/);
});
test('long custom ranges aggregate partial boundary years only within the inclusive endpoints',()=>{
  const h=fixture({...seedMonth(2000,1,rows(9999,9999)),...seedMonth(2000,12,rows(3,4)),...seedMonth(2010,1,rows(5,6)),...seedMonth(2010,12,rows(9999,9999)),...seedMonth(2011,2,rows(9999,9999))});
  const data=h.custom('2000-12','2010-12');assert.equal(data.unit,'year');assert.equal(total(data.income),10007);assert.equal(total(data.expense),10009);
  const partial=h.custom('2000-12','2011-01');assert.equal(partial.unit,'year');assert.equal(partial.labels.length,12);assert.equal(total(partial.income),10007);assert.equal(partial.income.at(-1),0);
});
test('all retains both distant past and future values across many decades without a rolling cap',()=>{
  const h=fixture({...seedMonth(1970,1,rows(1,2)),...seedMonth(2026,10,rows(10,20)),...seedMonth(2099,12,rows(100,200))}),data=h.data();
  assert.equal(data.from,'1970-01');assert.equal(data.to,'2099-12');assert.equal(data.months,1560);assert.equal(data.unit,'year');assert.equal(data.labels.length,130);
  assert.equal(data.income[0],1);assert.equal(data.income.at(-1),100);assert.equal(total(data.income),111);assert.equal(total(data.expense),222);
});
test('unreadable monthly source stays a visible gap and boundary rather than becoming a false zero',()=>{
  const h=fixture({...seedMonth(2025,1,rows(10,2)),kb2_2025_02:'{"synthetic-broken":',...seedMonth(2025,3,rows(20,3)),kb2_2025_04:'{}',...seedMonth(2025,5,[])});
  const data=h.data();assert.equal(data.from,'2025-01');assert.equal(data.to,'2025-04');assert.equal(data.unreadable,true);
  assert.deepEqual(copy(data.income),[10,null,20,null]);assert.deepEqual(copy(data.expense),[2,null,3,null]);assert.equal(h.nodes.get('kkTrendDataNotice').hidden,false);
});
test('period and custom controls render gaps even when the selected or recent summary month becomes unreadable',()=>{
  for(const [key,corrupt] of [['kb2_2026_10','{"synthetic-broken":'],['kb2_2026_08','{}']]){
    const h=fixture({...seedMonth(2026,8,rows(10,2)),...seedMonth(2026,10,rows(20,3))},{charts:true});
    h.nodes.get('m-inv-name').value='保存前の架空下書き';h.nodes.get('exp-amount').value='１０００';
    const year=h.context._year,month=h.context._month;h.context.localStorage.setItem(key,corrupt);
    assert.doesNotThrow(()=>h.setPeriod('6'),'trend controls must not depend on unrelated summary or hidden-bar JSON parsing');
    let data=h.data();assert.equal(data.unreadable,true);assert.equal(h.nodes.get('kkTrendDataNotice').hidden,false);
    assert.ok(data.income.includes(null));assert.ok(h.chartInstances.get('lineChart').data.datasets[0].data.includes(null));
    assert.doesNotThrow(()=>h.custom('2026-08','2026-10'));data=h.data();assert.equal(data.months,3);assert.equal(data.unreadable,true);
    assert.equal(data.income[key==='kb2_2026_08'?0:2],null);assert.equal(h.nodes.get('kkTrendError').hidden,true);
    assert.equal(h.context._year,year);assert.equal(h.context._month,month);
    assert.equal(h.nodes.get('m-inv-name').value,'保存前の架空下書き');assert.equal(h.nodes.get('exp-amount').value,'１０００');
  }
});
test('invalid row amounts produce a gap for the affected month without corrupting another month',()=>{
  const h=fixture({kb2_2025_01:'[{"type":"inc","amount":1e309}]',kb2_2025_02:JSON.stringify([{type:'exp',amount:'synthetic-invalid'}]),...seedMonth(2025,3,rows(4,5))});
  const data=h.data();assert.equal(data.unreadable,true);assert.deepEqual(copy(data.income),[null,null,4]);assert.deepEqual(copy(data.expense),[null,null,5]);
});
test('annual sum overflow is marked unreadable and never sent to the chart as infinity or a false zero',()=>{
  const h=fixture({...seedMonth(1970,1,rows(1,2)),...seedMonth(2026,1,rows(1e308,1e308)),...seedMonth(2026,2,rows(1e308,1e308))},{charts:true});
  const data=h.data();assert.equal(data.unit,'year');assert.equal(data.unreadable,true);
  assert.equal(data.income[0],1);assert.equal(data.income.at(-1),null);assert.equal(data.expense.at(-1),null);
  assert.ok([...data.income,...data.expense].every(value=>value===null||Number.isFinite(value)));
  assert.equal(h.nodes.get('kkTrendDataNotice').hidden,false);assert.equal(h.chartInstances.get('lineChart').data.datasets[0].data.at(-1),null);
  h.context._year=2026;h.context._month=1;const month=h.custom('2026-01','2026-01');assert.equal(month.income[0],1e308);assert.equal(month.unreadable,false);
});
test('empty all data is bounded, zero-valued and excludes empty historical arrays',()=>{
  const h=fixture({...seedMonth(1900,1,[]),...seedMonth(9999,12,[])}),data=h.data();
  assert.equal(data.from,'2026-10');assert.equal(data.to,'2026-10');assert.equal(data.months,1);assert.equal(data.unit,'month');assert.equal(data.unreadable,false);
  assert.deepEqual(copy(data.income),[0]);assert.deepEqual(copy(data.expense),[0]);assert.equal(h.nodes.get('kkTrendDataNotice').hidden,true);
});
test('unchanged trend redraws reuse the chart while locale, palette and font changes preserve the selected range',()=>{
  const h=fixture({...seedMonth(2026,8,rows(10,2)),...seedMonth(2026,10,rows(20,3))},{charts:true,mutatePalette:true});
  const first=h.chartInstances.get('lineChart');h.context.renderAll();h.context.renderAll();assert.equal(h.chartInstances.get('lineChart'),first);
  h.custom('2026-08','2026-10');const committed=copy(h.context._trendCustom);const current=h.chartInstances.get('lineChart');
  h.context.renderAll();assert.equal(h.chartInstances.get('lineChart'),current);
  h.context.kkApplyLang('en');assert.deepEqual(copy(h.context._trendCustom),committed);assert.equal(h.context._trendPeriod,'custom');
  h.theme();h.context.localStorage.setItem('userBrandColor','#725799');h.context.localStorage.setItem('userBrandColorCustom','1');h.context.localStorage.setItem('ui_fontscale','xl');h.fire('focus');h.flush();h.context.renderAll();
  assert.deepEqual(copy(h.context._trendCustom),committed);assert.equal(h.context._trendPeriod,'custom');assert.equal(h.nodes.get('kkTrendPeriod').value,'custom');
  assert.equal(h.nodes.get('kkTrendFrom').value,'2026-08');assert.equal(h.nodes.get('kkTrendTo').value,'2026-10');
});
test('full-width monthly additions update all-range data while keeping the range selection and daily records independent',()=>{
  const daily=JSON.stringify(rows(8888,9999));const h=fixture({kbday_2026_10_15:daily},{charts:true});
  assert.equal(h.document.getElementById('inc-name'),null);assert.equal(h.document.getElementById('exp-name'),null);
  h.nodes.get('inc-amount').value='１０００';h.context.addRecord('inc');
  h.nodes.get('exp-amount').value='２００';h.nodes.get('exp-cat').value='食費';h.context.addRecord('exp');
  assert.equal(h.context._trendPeriod,'all');assert.equal(total(h.data().income),1000);assert.equal(total(h.data().expense),200);assert.equal(h.values.get('kbday_2026_10_15'),daily);
  assert.equal(h.nodes.get('d-income').textContent,'¥1,000');assert.equal(h.nodes.get('d-expense').textContent,'¥200');
});

test('daily dates must be strict real Gregorian dates inside the selected monthly key',()=>{
  const h=fixture();
  for(const [year,month,days] of [[2024,2,29],[2023,2,28],[1900,2,28],[2000,2,29],[2026,4,30],[2026,10,31]])assert.equal(h.context.kkTrendMonthDays(year,month),days);
  for(const [value,year,month,day] of [['2026-10-01',2026,10,1],['2026-10-31',2026,10,31],['2024-02-29',2024,2,29],['2000-02-29',2000,2,29],['0001-01-01',1,1,1]])assert.equal(h.context.kkTrendMonthDay(value,year,month),day,value);
  for(const value of ['',null,undefined,'2026-10-00','2026-10-32','2026-9-01','2026-10-1','2026/10/01','2026-09-30','2026-11-01','2026-10-01T00:00:00Z',' 2026-10-01','２０２６-１０-０１'])assert.equal(h.context.kkTrendMonthDay(value,2026,10),null,String(value));
  assert.equal(h.context.kkTrendMonthDay('2023-02-29',2023,2),null);assert.equal(h.context.kkTrendMonthDay('1900-02-29',1900,2),null);
});
test('daily income and spending combine same-day signed fractions while investment and calendar records stay separate',()=>{
  const month=[{id:1,type:'inc',amount:20.25,date:'2026-10-01'},{id:2,type:'inc',amount:-2.5,date:'2026-10-01'},
    {id:3,type:'exp',amount:5.125,date:'2026-10-01'},{id:4,type:'exp',amount:-0.125,date:'2026-10-01'},
    {id:5,type:'inc',amount:-10,date:'2026-10-31'},{id:6,type:'inv',amount:99999,date:'2026-10-01'}];
  const seed={...seedMonth(2026,10,month),...seedMonth(2026,9,[{id:7,type:'inc',amount:88888,date:'2026-10-01'}]),
    kbday_2026_10_01:JSON.stringify(rows(77777,66666)),kb2_assets:JSON.stringify([{id:8,amount:55555}]),
    'kn_ledger_backup:other-owner':JSON.stringify(seedMonth(2026,10,rows(44444,33333)))};
  const h=fixture(seed);h.reads.length=0;h.writes.length=0;const data=h.setPeriod('1');
  assert.equal(data.income[0],17.75);assert.equal(data.expense[0],5);assert.equal(data.income[30],-10);
  assert.equal(data.expense[30],0);assert.equal(total(data.income),7.75);assert.equal(total(data.expense),5);
  assert.equal(data.undated.count,0);assert.equal(data.undated.bad,false);assert.equal(data.unreadable,false);
  assert.ok(h.reads.every(key=>key==='kb2_2026_10'),JSON.stringify(h.reads));assert.deepEqual(h.writes,[]);
  for(const [key,value] of Object.entries(seed))assert.equal(h.values.get(key),value,key+' must not be rewritten by a period change');
});
test('undated legacy and impossible or foreign-month dates retain explicit counts and totals without timestamp inference',()=>{
  const records=[{id:fixedTime,type:'inc',name:'架空の旧記録',amount:100},
    {id:2,type:'inc',amount:5.5,date:'2026-10-32'},{id:3,type:'exp',amount:7.75,date:'2026-09-30'},
    {id:4,type:'exp',amount:-0.25,date:'2026-02-29'},{id:5,type:'inv',amount:1000},
    {id:6,type:'inc',amount:10,date:'2026-10-02'}];
  const original=JSON.stringify(records),h=fixture({kb2_2026_10:original},{charts:true});h.writes.length=0;
  const data=h.setPeriod('1');assert.deepEqual(copy(data.undated),{count:4,income:105.5,expense:7.5,bad:false});
  assert.equal(total(data.income),10);assert.equal(total(data.expense),0);assert.equal(data.income[14],0,'id timestamp must never become an inferred transaction day');
  assert.equal(h.nodes.get('kkTrendUndatedNotice').hidden,false);assert.match(h.nodes.get('kkTrendUndatedNotice').textContent,/105\.5/);assert.match(h.nodes.get('kkTrendUndatedNotice').textContent,/7\.5/);
  h.setPeriod('6');h.custom('2026-10','2026-10');h.context.renderAll();
  assert.equal(h.values.get('kb2_2026_10'),original);assert.deepEqual(h.writes,[],'rendering never migrates or dates legacy rows');
});
test('known-day invalid amounts and overflow become local null gaps without hiding unrelated days',()=>{
  for(const bad of [null,'invalid',{},1e308]){
    const records=[{id:1,type:'inc',amount:bad,date:'2026-10-03'},{id:2,type:'exp',amount:2,date:'2026-10-03'},
      {id:3,type:'inc',amount:7.25,date:'2026-10-04'},{id:4,type:'exp',amount:1.5,date:'2026-10-04'}];
    if(bad===1e308)records.push({id:5,type:'inc',amount:1e308,date:'2026-10-03'});
    const h=fixture(seedMonth(2026,10,records)),data=h.setPeriod('1');
    assert.equal(data.income[2],null);assert.equal(data.expense[2],null);assert.equal(data.income[3],7.25);assert.equal(data.expense[3],1.5);
    assert.equal(data.income[0],0);assert.equal(data.unreadable,true);assert.equal(h.nodes.get('kkTrendDataNotice').hidden,false);
    assert.ok([...data.income,...data.expense].every(value=>value===null||Number.isFinite(value)));
  }
});
test('unknown-day invalid amounts mark undated totals unknown while valid dated days remain visible',()=>{
  const records=[{id:1,type:'inc',amount:'invalid'},{id:2,type:'exp',amount:null,date:'2026-11-01'},
    {id:3,type:'inc',amount:9.5,date:'2026-10-07'},{id:4,type:'exp',amount:2.25,date:'2026-10-07'}];
  const h=fixture(seedMonth(2026,10,records)),data=h.setPeriod('1');
  assert.deepEqual(copy(data.undated),{count:2,income:null,expense:null,bad:true});
  assert.equal(data.income[6],9.5);assert.equal(data.expense[6],2.25);assert.equal(data.income[0],0);
  assert.equal(h.nodes.get('kkTrendUndatedNotice').hidden,false);assert.doesNotMatch(h.nodes.get('kkTrendUndatedNotice').textContent,/NaN|Infinity|undefined/);
});
test('unreadable monthly JSON produces all-day gaps through the isolated daily controls',()=>{
  for(const broken of ['{"synthetic-broken":','{}','null']){
    const h=fixture(seedMonth(2026,10,rows(10,2)),{charts:true});h.values.set('kb2_2026_10',broken);
    const data=h.setPeriod('1');assert.equal(data.unreadable,true);assert.equal(data.labels.length,31);
    assert.ok(data.income.every(value=>value===null));assert.ok(data.expense.every(value=>value===null));
    assert.ok(h.chartInstances.get('lineChart').data.datasets[0].data.every(value=>value===null));
    assert.equal(h.nodes.get('kkTrendDataNotice').hidden,false);assert.equal(h.values.get('kb2_2026_10'),broken);
  }
});
test('only preset one is daily; all and even a one-month custom range retain complete monthly totals',()=>{
  const records=[{id:1,type:'inc',amount:10,date:'2026-10-01'},{id:2,type:'inc',amount:20,date:'2026-10-99'},
    {id:3,type:'inc',amount:5},{id:4,type:'exp',amount:3,date:'2026-10-20'},{id:5,type:'exp',amount:2},{id:6,type:'inv',amount:1000}];
  const h=fixture({...seedMonth(2026,10,records),...seedMonth(2026,9,rows(7,1))});
  let data=h.setPeriod('1');assert.equal(data.unit,'day');assert.equal(total(data.income),10);assert.equal(data.undated.income,25);assert.equal(data.undated.expense,2);
  data=h.custom('2026-10','2026-10');assert.equal(data.unit,'month');assert.deepEqual(copy(data.income),[35]);assert.deepEqual(copy(data.expense),[5]);
  assert.equal(h.nodes.get('kkTrendUndatedNotice').hidden,true);
  for(const period of ['6','12','36','all']){data=h.setPeriod(period);assert.equal(data.unit,'month');assert.equal(total(data.income),42);assert.equal(total(data.expense),6);}
});
test('entry date defaults to today or the other selected month first day and changes no amount/name drafts',()=>{
  const h=fixture(),date=h.nodes.get('kkEntryDate');assert.ok(date);assert.equal(date.value,'2026-10-15');
  assert.equal(date.getAttribute('min'),'2026-10-01');assert.equal(date.getAttribute('max'),'2026-10-31');
  h.nodes.get('m-inv-name').value='保存前の架空下書き';h.nodes.get('exp-amount').value='１２３４';h.setPeriod('1');h.context.changeMonth(-1);
  assert.equal(date.value,'2026-09-01');assert.equal(date.getAttribute('min'),'2026-09-01');assert.equal(date.getAttribute('max'),'2026-09-30');assert.equal(h.data().days,30);
  assert.equal(h.nodes.get('m-inv-name').value,'保存前の架空下書き');assert.equal(h.nodes.get('exp-amount').value,'１２３４');
  h.context._year=2024;h.context._month=2;h.context.renderAll();assert.equal(date.value,'2024-02-01');assert.equal(date.getAttribute('max'),'2024-02-29');assert.equal(h.data().days,29);
});
test('same-month trend, language and theme redraws preserve valid, blank and invalid entry-date drafts',()=>{
  const h=fixture(seedMonth(2026,10,rows(10,2)),{charts:true});h.setPeriod('1');h.theme();
  h.nodes.get('m-inv-name').value='保存前の架空項目';h.nodes.get('inc-amount').value='１０００';
  for(const draft of ['2026-10-23','','2026-10-99']){
    h.nodes.get('kkEntryDate').value=draft;h.context.renderAll();h.context.kkApplyLang('en');
    h.context.localStorage.setItem('userBrandColor','#725799');h.context.localStorage.setItem('ui_theme','dark');h.fire('focus');h.flush();h.context.renderAll();
    assert.equal(h.nodes.get('kkEntryDate').value,draft);assert.equal(h.nodes.get('m-inv-name').value,'保存前の架空項目');assert.equal(h.nodes.get('inc-amount').value,'１０００');assert.equal(h.context._trendPeriod,'1');
  }
});
test('home additions save the chosen date without changing old rows or mixing separate calendar data',()=>{
  const legacy={id:1,type:'inc',name:'架空の旧行',amount:50,extra:'preserve'},daily=JSON.stringify(rows(9999,8888));
  const h=fixture({...seedMonth(2026,10,[legacy]),kbday_2026_10_12:daily},{charts:true});h.setPeriod('1');
  for(const [type,date,amount] of [['inc','2026-10-12','１０００'],['exp','2026-10-31','２００'],['inv','2026-10-30','１００']]){
    h.nodes.get('kkEntryDate').value=date;
    if(h.nodes.has(type+'-name'))h.nodes.get(type+'-name').value='架空の'+type;else assert.ok(['inc','exp','inv'].includes(type));
    h.nodes.get(type+'-amount').value=amount;
    if(type!=='inc')h.nodes.get(type+'-cat').value=type==='exp'?'食費':'国内株';
    h.context.addRecord(type);const saved=JSON.parse(h.values.get('kb2_2026_10'));
    assert.equal(saved.at(-1).date,date);assert.deepEqual(saved[0],legacy);assert.equal(h.nodes.get('kkEntryDate').value,date);
    if(h.nodes.has(type+'-name'))assert.equal(h.nodes.get(type+'-name').value,'');else assert.equal(h.document.getElementById(type+'-name'),null);
  }
  const data=h.data();assert.equal(data.income[11],1000);assert.equal(data.expense[30],200);assert.equal(data.income[29],0);assert.equal(data.undated.income,50);assert.equal(data.undated.count,1);
  assert.equal(h.values.get('kbday_2026_10_12'),daily);assert.equal(h.nodes.get('d-income').textContent,'¥1,050');assert.equal(h.nodes.get('d-expense').textContent,'¥200');
  const reloaded=fixture(Object.fromEntries(h.values));assert.deepEqual(copy(reloaded.setPeriod('1')),copy(data),'saved dated rows and undated legacy totals survive a fresh page context');
});
test('invalid home dates block a monthly save without clearing drafts while assets remain independent',()=>{
  for(const value of ['','2026-10-32','2026-09-30']){
    const h=fixture(seedMonth(2026,10,rows(10,2))),before=h.values.get('kb2_2026_10');h.writes.length=0;
    h.nodes.get('kkEntryDate').value=value;h.nodes.get('m-inv-name').value='架空の未保存投資';h.nodes.get('exp-amount').value='１００';h.nodes.get('exp-cat').value='食費';h.context.addRecord('exp');
    assert.equal(h.values.get('kb2_2026_10'),before);assert.deepEqual(h.writes,[]);assert.equal(h.nodes.get('m-inv-name').value,'架空の未保存投資');assert.equal(h.nodes.get('exp-amount').value,'１００');assert.equal(h.nodes.get('kkEntryDate').value,value);assert.equal(h.nodes.get('kkEntryDate').getAttribute('aria-invalid'),'true');
    h.nodes.get('ast-name').value='架空の資産';h.nodes.get('ast-amount').value='２００';h.nodes.get('ast-cat').value='現金';h.context.addRecord('ast');
    const asset=JSON.parse(h.values.get('kb2_assets'))[0];assert.equal(asset.amount,200);assert.equal(Object.hasOwn(asset,'date'),false);assert.equal(h.values.get('kb2_2026_10'),before);
  }
});
test('record date set, change and clear update daily points and undated totals while preserving fields and drafts',()=>{
  const first={id:1,type:'inc',name:'架空の未日付収入',amount:100,extra:{kept:true}},second={id:2,type:'exp',name:'架空の支出',amount:20,date:'2026-10-10',cat:'食費'};
  const h=fixture(seedMonth(2026,10,[first,second]),{charts:true});h.setPeriod('1');h.nodes.get('m-inv-name').value='架空の入力下書き';h.nodes.get('inc-amount').value='１２３';h.nodes.get('kkEntryDate').value='2026-10-22';
  const oldChart=h.chartInstances.get('lineChart');assert.equal(h.context.kkSetRecordDate(1,'2026-10-07'),true);
  let saved=JSON.parse(h.values.get('kb2_2026_10'));assert.deepEqual(saved,[{...first,date:'2026-10-07'},second]);assert.equal(h.data().income[6],100);assert.equal(h.data().undated.count,0);assert.notEqual(h.chartInstances.get('lineChart'),oldChart);
  assert.match(h.nodes.get('rec-list-el').innerHTML,/type="date"/);assert.match(h.nodes.get('rec-list-el').innerHTML,/onchange="kkRecordDateEdited\(this\)"/);
  const editor=h.makeElement('input','fixture-record-date');editor.setAttribute('data-kk-record-date','1');editor.value='2026-10-05';h.document.body.appendChild(editor);
  h.context.kkRecordDateEdited(editor);assert.equal(h.data().expense[4],20);assert.equal(h.data().expense[9],0);
  assert.equal(h.context.kkSetRecordDate(1,''),true);saved=JSON.parse(h.values.get('kb2_2026_10'));assert.deepEqual(saved[0],first);assert.equal(h.data().income[6],0);assert.equal(h.data().undated.count,1);assert.equal(h.data().undated.income,100);
  assert.equal(h.context._year,2026);assert.equal(h.context._month,10);assert.equal(h.nodes.get('m-inv-name').value,'架空の入力下書き');assert.equal(h.nodes.get('inc-amount').value,'１２３');assert.equal(h.nodes.get('kkEntryDate').value,'2026-10-22');
});
test('record-date invalid, unknown and ambiguous IDs never write or change stored data',()=>{
  for(const records of [[{id:1,type:'inc',amount:10}],[{id:1,type:'inc',amount:10},{id:1,type:'exp',amount:2}]]){
    const h=fixture(seedMonth(2026,10,records)),before=h.values.get('kb2_2026_10');h.writes.length=0;
    for(const [id,date] of [[1,'2026-10-32'],[1,'2026-11-01'],[999,'2026-10-01']])assert.equal(h.context.kkSetRecordDate(id,date),false);
    if(records.length===2)assert.equal(h.context.kkSetRecordDate(1,'2026-10-01'),false);
    assert.equal(h.values.get('kb2_2026_10'),before);assert.deepEqual(h.writes,[]);
  }
});
test('native incomplete date input cannot silently clear an existing date, while an explicit blank can',()=>{
  const row={id:1,type:'inc',name:'架空の日付付き収入',amount:100,date:'2026-10-07',extra:'preserve'};
  const h=fixture(seedMonth(2026,10,[row])),before=h.values.get('kb2_2026_10');h.setPeriod('1');h.writes.length=0;
  const input=h.makeElement('input','fixture-incomplete-date');input.value='';input.validity={badInput:true};input.setAttribute('data-kk-record-date','0');h.document.body.appendChild(input);
  assert.equal(h.context.kkSetRecordDate(1,'',input),false);h.context.kkRecordDateEdited(input);
  assert.equal(h.values.get('kb2_2026_10'),before);assert.deepEqual(h.writes,[]);assert.equal(input.getAttribute('aria-invalid'),'true');
  const error=h.document.getElementById(input.id+'-error');assert.ok(error);assert.equal(error.hidden,false);assert.equal(error.getAttribute('data-i18n'),'kk_entry_date_invalid');assert.equal(h.data().income[6],100);
  input.validity={badInput:false};assert.equal(h.context.kkSetRecordDate(1,'',input),true);
  const saved=JSON.parse(h.values.get('kb2_2026_10'))[0];assert.deepEqual(saved,{id:1,type:'inc',name:'架空の日付付き収入',amount:100,extra:'preserve'});
  assert.equal(h.data().income[6],0);assert.equal(h.data().undated.count,1);assert.equal(h.data().undated.income,100);assert.equal(input.getAttribute('aria-invalid'),null);assert.equal(error.hidden,true);
});
test('daily chart and undated explanation survive all four languages and palette mutation without changing values',()=>{
  const h=fixture(seedMonth(2026,10,[{id:1,type:'inc',amount:1000.5},{id:2,type:'exp',amount:20.25,date:'2026-10-03'}]),{charts:true,mutatePalette:true});h.setPeriod('1');
  const expected=copy(h.data()),notes=new Set();h.theme();
  for(const lang of ['ja','en','ko','zh']){
    h.context.kkApplyLang(lang);h.context.renderAll();h.fire('focus');h.flush();
    assert.deepEqual(copy(h.data()),expected);const line=h.chartInstances.get('lineChart');assert.deepEqual(copy(line.data.datasets[0].data),expected.income);assert.deepEqual(copy(line.data.datasets[1].data),expected.expense);
    const text=h.nodes.get('kkTrendUndatedNotice').textContent;assert.match(text,/1,?000\.5/);assert.doesNotMatch(text,/undefined|NaN|Infinity/);notes.add(text);
    assert.match(h.nodes.get('kkTrendRange').textContent,/2026\/10/);assert.equal(h.nodes.get('kkTrendUndatedNotice').hidden,false);assert.equal(h.nodes.get('kkTrendPeriod').value,'1');
  }
  assert.equal(notes.size,4,'the explanatory notice is translated for each supported language');
  const before=h.chartInstances.get('lineChart');h.context.renderAll();assert.equal(h.chartInstances.get('lineChart'),before,'a same-locale daily redraw still reuses the unmodified source signature');
});

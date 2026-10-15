'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','kakeibo.html'),'utf8');
const fixedTime=Date.parse('2026-10-15T12:00:00+09:00');
class ClockDate extends Date{constructor(...args){super(...(args.length?args:[fixedTime]));}static now(){return fixedTime;}}
const row=(id,type,name,amount,date,extra={})=>({id,type,name,amount,...(date===undefined?{}:{date}),...extra});
const seed=(records,extra={})=>({kb2_2026_10:JSON.stringify(records),...extra});
const decode=text=>text.replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[\da-f]+|\d+);/gi,entity=>{
  const named={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':'\u00a0'};
  return named[entity]??String.fromCodePoint(Number(entity[2].toLowerCase()==='x'?'0'+entity.slice(2,-1):entity.slice(2,-1)));
});
function descendants(node){return node.children.flatMap(child=>[child,...descendants(child)]);}
function hasClass(node,name){return (node.attrs.class||'').split(/\s+/).includes(name);}
// Parse only rendered markup for structural assertions; never execute generated HTML.
function markupTree(markup){
  const root={tag:'root',attrs:{},children:[],parts:[]},stack=[root],voids=new Set(['input','br','hr','img','meta','link']);
  for(const token of markup.matchAll(/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][^>]*>|[^<]+/gi)){
    const text=token[0],closing=/^<\//.test(text),tag=text.match(/^<\/?([\w-]+)/)?.[1]?.toLowerCase();
    if(tag&&closing){assert.equal(stack.at(-1).tag,tag,'generated markup must have balanced structural tags');stack.pop();}
    else if(tag){const node={tag,attrs:{},children:[],parts:[],parent:stack.at(-1)};for(const attr of text.matchAll(/([\w-]+)="([^"]*)"/g))node.attrs[attr[1]]=decode(attr[2]);stack.at(-1).children.push(node);stack.at(-1).parts.push(node);if(!voids.has(tag))stack.push(node);}
    else if(!text.startsWith('<!'))stack.at(-1).parts.push(decode(text));
  }
  assert.equal(stack.length,1,'generated markup must close every non-void tag');return root;
}
function textOf(node){return node.parts.map(part=>typeof part==='string'?part:textOf(part)).join('');}
function member(node,name){const found=descendants(node).filter(child=>hasClass(child,name));assert.equal(found.length,1,name+' must appear exactly once per row');return found[0];}

function fixture(initial={}){
  const nodes=new Map(),all=[],stack=[],values=new Map(Object.entries(initial)),reads=[],writes=[];
  function matches(node,selector){if(selector[0]==='#')return node.id===selector.slice(1);if(selector[0]==='.')return node.classList.contains(selector.slice(1));if(selector[0]==='[')return node.getAttribute(selector.slice(1,-1))!==null;return node.tagName===selector.toUpperCase();}
  function element(tag='div',id=''){
    const attrs=new Map(),variables=new Map();let rawHTML='',rawText='';
    const node={id,tagName:tag.toUpperCase(),children:[],parentElement:null,value:'',hidden:false,
      style:{setProperty:(key,value)=>variables.set(key,String(value)),getPropertyValue:key=>variables.get(key)||''},
      get className(){return attrs.get('class')||'';},set className(value){attrs.set('class',String(value));},
      get innerHTML(){return rawHTML;},set innerHTML(value){rawHTML=String(value);rawText='';},
      get textContent(){return rawText;},set textContent(value){rawText=String(value);rawHTML='';},
      getAttribute:key=>attrs.get(key)??null,setAttribute:(key,value)=>attrs.set(key,String(value)),removeAttribute:key=>attrs.delete(key),
      appendChild(child){node.children.push(child);child.parentElement=node;return child;},
      insertAdjacentElement(position,child){assert.equal(position,'afterend');node.parentElement.appendChild(child);},
      querySelector:selector=>descendants(node).find(child=>matches(child,selector))||null,
      addEventListener(){},focus(){},getContext(){return node;}};
    node.classList={contains:name=>node.className.split(/\s+/).includes(name),add(name){node.className=[...new Set([...node.className.split(/\s+/).filter(Boolean),name])].join(' ');},remove(name){node.className=node.className.split(/\s+/).filter(item=>item!==name).join(' ');},toggle(name,on){if(on)node.classList.add(name);else node.classList.remove(name);}};
    all.push(node);if(id)nodes.set(id,node);return node;
  }
  const markup=html.replace(/<script\b[\s\S]*?<\/script>/gi,'').replace(/<style\b[\s\S]*?<\/style>/gi,'');
  const voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  for(const match of markup.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*)>/gi)){
    const tag=match[2].toLowerCase();if(match[1]){for(let i=stack.length-1;i>=0;i--)if(stack[i].tagName===tag.toUpperCase()){stack.length=i;break;}continue;}
    const attrs=match[3],id=attrs.match(/\bid="([^"]+)"/)?.[1]||'',node=element(tag,id);
    for(const attr of attrs.matchAll(/([\w-]+)="([^"]*)"/g))node.setAttribute(attr[1],attr[2]);
    node.value=node.getAttribute('value')||'';node.hidden=/(?:^|\s)hidden(?:\s|=|$)/.test(attrs);node.style.display=attrs.match(/\bstyle="[^"]*\bdisplay\s*:\s*([^;"\s]+)/)?.[1]||'';
    if(stack.length)stack.at(-1).appendChild(node);if(!voids.has(tag)&&!attrs.trimEnd().endsWith('/'))stack.push(node);
  }
  const document={readyState:'loading',documentElement:all.find(node=>node.tagName==='HTML'),body:all.find(node=>node.tagName==='BODY'),
    getElementById:id=>nodes.get(id)||all.find(node=>node.id===id)||null,createElement:tag=>element(tag),querySelectorAll:selector=>all.filter(node=>matches(node,selector)),addEventListener(){}};
  const localStorage={get length(){return values.size;},key:index=>[...values.keys()][index]??null,getItem(key){reads.push(key);return values.get(key)??null;},setItem(key,value){values.set(key,String(value));writes.push({key,value:String(value)});},removeItem:key=>values.delete(key)};
  const context={document,localStorage,Date:ClockDate,console,location:{origin:'https://calendar.test'},setTimeout:()=>1,clearTimeout(){},addEventListener(){},Event:class{constructor(type){this.type=type;}},alert(message){throw Error(message);},fetch(){throw Error('external requests are forbidden');},XMLHttpRequest:class{constructor(){throw Error('external requests are forbidden');}}};
  context.window=context;context.parent=context;
  const begin=html.indexOf('var KK_I18N ='),core=html.indexOf('var _year=new Date()'),end=html.indexOf('// ===== Brand Color Sync =====',core);assert.ok(begin>=0&&core>begin&&end>core);
  vm.runInNewContext(html.slice(begin,core),context);vm.runInNewContext(html.slice(core,end),context);context.switchTab('calendar');
  function groups(){const output=nodes.get('kkCalendarRecords');assert.ok(output,'calendar list exists in the real DOM');return markupTree(output.innerHTML).children.filter(node=>hasClass(node,'kk-cal-day'));}
  function records(){return groups().flatMap(group=>descendants(group).filter(node=>hasClass(node,'kk-cal-record')));}
  return {context,document,nodes,values,reads,writes,groups,records,
    dates:()=>groups().map(group=>group.attrs['data-date']),
    memos:()=>records().map(record=>textOf(member(record,'kk-cal-memo'))),
    fill(prefix,amount,name='架空の入力',category='食費'){const input=nodes.get(prefix+'-name');if(input)input.value=name;nodes.get(prefix+'-amount').value=amount;if(nodes.has(prefix+'-cat'))nodes.get(prefix+'-cat').value=category;}};
}

test('the calendar list is a labelled section immediately below the calendar and before category totals',()=>{
  const h=fixture(),title=h.nodes.get('kkCalendarRecordsTitle'),list=h.nodes.get('kkCalendarRecords'),notice=h.nodes.get('kkCalendarRecordsNotice');
  assert.ok(title);assert.equal(title.tagName,'H2');assert.ok(list);assert.ok(notice);assert.equal(notice.getAttribute('role'),'status');assert.equal(notice.hidden,true);
  const card=title.parentElement;assert.equal(card.tagName,'SECTION');assert.equal(card.classList.contains('card'),true);assert.equal(card.classList.contains('kk-cal-log'),true);assert.equal(list.parentElement,card);
  assert.ok(html.indexOf('id="calGrid"')<html.indexOf('id="kkCalendarRecords"'));assert.ok(html.indexOf('id="kkCalendarRecords"')<html.indexOf('id="calCatSummary"'));
});
test('only populated days form numeric ascending h3/time groups with every same-day row in source order',()=>{
  const monthly=[row(1,'exp','十日',10,'2026-10-10'),row(2,'inc','一日収入',100,'2026-10-01'),row(3,'exp','二日',2,'2026-10-02'),row(4,'inv','月末投資',31,'2026-10-31')];
  const h=fixture(seed(monthly,{kbday_2026_10_01:JSON.stringify([row(2,'exp','同IDの日別支出',5)])}));assert.deepEqual(h.dates(),['2026-10-01','2026-10-02','2026-10-10','2026-10-31']);
  for(const group of h.groups()){assert.equal(group.tag,'section');const headings=group.children.filter(node=>node.tag==='h3');assert.equal(headings.length,1);assert.equal(hasClass(headings[0],'kk-cal-day-title'),true);assert.equal(headings[0].children.length,1);const time=headings[0].children[0];assert.equal(time.tag,'time');assert.equal(time.attrs.datetime,group.attrs['data-date']);assert.equal(textOf(time),'10月'+Number(group.attrs['data-date'].slice(-2))+'日');const ul=group.children.find(node=>node.tag==='ul');assert.ok(ul);assert.ok(ul.children.every(node=>node.tag==='li'&&hasClass(node,'kk-cal-record')));}
  assert.equal(h.records().length,5);assert.deepEqual(h.memos().slice(0,2),['一日収入','同IDの日別支出']);assert.equal(h.writes.length,0);
});
test('category and type labels remain explicit for income, spending and investment while memos follow nonblank string priority',()=>{
  const records=[row(1,'inc','元の名前',10,'2026-10-01',{memo:'  優先メモ  ',note:'使わない注記'}),
    row(2,'exp','元の名前',20,'2026-10-01',{cat:'交通',memo:' \t',note:'注記fallback'}),
    row(3,'inv','名前fallback',30,'2026-10-01',{cat:'ETF',memo:123,note:null}),row(4,'inc',' ',40,'2026-10-01',{memo:{},note:''})];
  const h=fixture(seed(records)),rendered=h.records();assert.deepEqual(h.memos(),['  優先メモ  ','注記fallback','名前fallback','—']);
  assert.deepEqual(rendered.map(record=>record.attrs['data-type']),['inc','exp','inv','inc']);assert.deepEqual(rendered.map(record=>textOf(member(record,'kk-cal-kind'))),['収入','支出','投資','収入']);
  assert.equal(textOf(member(rendered[0],'kk-cal-category')),'収入');assert.equal(textOf(member(rendered[1],'kk-cal-category')),h.context.kkCat('交通'));assert.equal(textOf(member(rendered[2],'kk-cal-category')),h.context.kkCat('ETF'));
});
test('signed fractional amounts preserve their stored value without an invented spending minus sign',()=>{
  const h=fixture(seed([row(1,'inc','端数収入',.125,'2026-10-01'),row(2,'exp','支出',12.5,'2026-10-01'),row(3,'exp','返金',-2.25,'2026-10-01'),row(4,'inv','負の投資',-1.5,'2026-10-01')]));
  assert.deepEqual(h.records().map(record=>textOf(member(record,'kk-cal-amount'))),['¥0.125','¥12.5','¥-2.25','¥-1.5']);
});
test('arbitrary category and memo characters render only as escaped literal text',()=>{
  const payload='<img src=x onerror="synthetic()"> & \'引用\' <script>',h=fixture(seed([row(1,'inv','unused',10,'2026-10-01',{cat:payload,memo:payload}),row(2,'exp','constructor',5,'2026-10-02',{cat:'__proto__'})]));
  assert.equal(h.memos()[0],payload);assert.equal(textOf(member(h.records()[0],'kk-cal-category')),payload);assert.equal(textOf(member(h.records()[1],'kk-cal-category')),'__proto__');
  const markup=h.nodes.get('kkCalendarRecords').innerHTML;assert.doesNotMatch(markup,/<img\b|<script\b|\[object Object\]|function\s/);assert.match(markup,/&lt;img/);assert.match(markup,/&quot;/);assert.match(markup,/&amp;/);assert.match(markup,/&#39;/);assert.equal(h.writes.length,0);
});
test('undated and invalid dates are not inferred from IDs, timestamps or foreign monthly date values',()=>{
  const records=[row(fixedTime,'inc','日付なし',10),row(2,'exp','不正な末日',20,'2026-10-32'),row(3,'inv','別月の日付',30,'2026-09-30'),row(4,'exp','時刻付き日付',40,'2026-10-02T00:00:00Z'),row(5,'inc','有効日',50,'2026-10-03')];
  const h=fixture(seed(records,{kbday_2026_10_04:JSON.stringify([row(6,'inc','明示的な空日付',60,'')]),kbday_2026_10_05:JSON.stringify([row(7,'exp','既存dayキーの日付',70)]),kbday_2026_02_30:JSON.stringify([row(8,'inc','不正キー',80)])}));
  assert.deepEqual(h.dates(),['2026-10-03','2026-10-05']);assert.deepEqual(h.memos(),['有効日','既存dayキーの日付']);assert.equal(h.writes.length,0);
});
test('empty months show an honest empty message and no fabricated day group',()=>{
  const h=fixture(seed([row(fixedTime,'inc','日付未設定だけ',10)]));assert.deepEqual(h.dates(),[]);assert.deepEqual(h.records(),[]);assert.match(h.nodes.get('kkCalendarRecords').innerHTML,/この月の日付付きの記録はありません。/);assert.equal(h.nodes.get('kkCalendarRecordsNotice').hidden,true);
});
test('broken buckets warn while known dated rows remain visible and malformed amount or type is never printed as a false value',()=>{
  const h=fixture(seed([row(1,'inc','読める収入',12.5,'2026-10-01'),row(2,'exp','壊れた金額','bad','2026-10-02'),row(3,'other','不明な種類',5,'2026-10-03')],{kbday_2026_10_04:'{'}));
  assert.equal(h.nodes.get('kkCalendarRecordsNotice').hidden,false);assert.ok(h.nodes.get('kkCalendarRecordsNotice').textContent);assert.deepEqual(h.dates(),['2026-10-01','2026-10-02','2026-10-03']);assert.equal(textOf(member(h.records()[1],'kk-cal-amount')),'—');assert.equal(h.records()[2].attrs['data-type'],'unknown');assert.equal(textOf(member(h.records()[2],'kk-cal-kind')),h.context.kkT('kk_trend_amount_unknown'));assert.equal(textOf(member(h.records()[2],'kk-cal-category')),h.context.kkT('kk_trend_amount_unknown'));
  assert.doesNotMatch(h.nodes.get('kkCalendarRecords').innerHTML,/NaN|Infinity|undefined|この月の日付付きの記録はありません。/);assert.equal(h.values.get('kbday_2026_10_04'),'{');assert.equal(h.writes.length,0);
  const emptyBroken=fixture({kb2_2026_10:'{'});assert.equal(emptyBroken.nodes.get('kkCalendarRecordsNotice').hidden,false);assert.deepEqual(emptyBroken.records(),[]);assert.doesNotMatch(emptyBroken.nodes.get('kkCalendarRecords').innerHTML,/この月の日付付きの記録はありません。/);assert.equal(emptyBroken.writes.length,0);
});
test('Home and Calendar additions immediately update the same list and source-aware deletion removes only the selected row',()=>{
  const h=fixture({kbday_2026_10_01:JSON.stringify([row(fixedTime,'exp','同IDの旧日別',3,undefined,{cat:'交通'})])});h.nodes.get('kkEntryDate').value='2026-10-01';h.fill('exp','１２．５','ignored','食費');h.context.addRecord('exp');assert.equal(h.records().length,2);assert.deepEqual(h.dates(),['2026-10-01']);
  h.context.openDayModal(2026,10,2);h.fill('m-inc','１００．２５','架空の二日収入');h.context.addDayRecord('inc');assert.deepEqual(h.dates(),['2026-10-01','2026-10-02']);assert.ok(h.memos().includes('架空の二日収入'));assert.equal(h.records().length,3);
  h.context.deleteRecord(h.context.getData().find(record=>record.name==='食費')._kkRef);assert.equal(h.records().length,2);assert.ok(h.memos().includes('同IDの旧日別'));assert.deepEqual(h.dates(),['2026-10-01','2026-10-02']);
  h.context.deleteDayRecord(h.context.getDayData(2026,10,2)[0]._kkRef);assert.equal(h.records().length,1);assert.deepEqual(h.dates(),['2026-10-01']);
  const reloaded=fixture(Object.fromEntries(h.values));assert.equal(reloaded.records().length,1);assert.deepEqual(reloaded.memos(),['同IDの旧日別']);assert.equal(reloaded.writes.length,0);
});
test('date movement updates the date group and clearing keeps the stored legacy row outside guessed day groups after reload',()=>{
  const original=row(1,'exp','架空の旧日別',-2.5,undefined,{cat:'交通',extra:{keep:true}}),h=fixture({kbday_2026_10_01:JSON.stringify([original])});assert.deepEqual(h.dates(),['2026-10-01']);
  assert.equal(h.context.kkSetRecordDate(h.context.getData()[0]._kkRef,'2026-10-10'),true);assert.deepEqual(h.dates(),['2026-10-10']);assert.equal(h.records().length,1);assert.equal(h.memos()[0],original.name);
  assert.equal(h.context.kkSetRecordDate(h.context.getData()[0]._kkRef,''),true);assert.deepEqual(h.dates(),[]);assert.equal(h.context.getData().length,1);assert.deepEqual(JSON.parse(h.values.get('kbday_2026_10_01')),[{...original,date:''}]);
  const reloaded=fixture(Object.fromEntries(h.values));assert.deepEqual(reloaded.dates(),[]);assert.equal(reloaded.context.getData().length,1);assert.equal(reloaded.writes.length,0);
});
test('both month controls update the list immediately across year and leap-month boundaries without writing or clearing drafts',()=>{
  const h=fixture({kb2_2026_12:JSON.stringify([row(1,'inc','架空の十二月',10,'2026-12-31')]),kbday_2027_01_01:JSON.stringify([row(2,'exp','架空の一月',20)]),kbday_2024_02_29:JSON.stringify([row(3,'inc','架空のうるう日',30)])});
  h.context._year=2026;h.context._month=12;h.context._calYear=2026;h.context._calMonth=12;h.context.renderAll();h.nodes.get('exp-amount').value='保存前の下書き';assert.deepEqual(h.dates(),['2026-12-31']);h.context.calChangeMonth(1);assert.deepEqual(h.dates(),['2027-01-01']);h.context.changeMonth(-1);assert.deepEqual(h.dates(),['2026-12-31']);
  h.context._year=2024;h.context._month=2;h.context._calYear=2024;h.context._calMonth=2;h.context.renderAll();assert.deepEqual(h.dates(),['2024-02-29']);assert.equal(h.nodes.get('exp-amount').value,'保存前の下書き');assert.equal(h.writes.length,0);
});
test('the new renderer reuses Calendar month data without extra storage reads and every nonmutating redraw keeps source bytes exact',()=>{
  const initial=seed([row(1,'inc','架空の収入',10,'2026-10-01')],{kbday_2026_10_02:'  '+JSON.stringify([row(2,'exp','架空の日支出',5)])+'\n'}),h=fixture(initial);h.reads.length=0;h.context.renderCalendar();
  assert.deepEqual(h.reads.sort(),['kb2_2026_10','kbday_2026_10_02']);assert.equal(h.records().length,2);h.context.renderAll();h.context.renderCalendar();
  for(const [key,value] of Object.entries(initial))assert.equal(h.values.get(key),value);assert.equal(h.writes.length,0);
});
test('all four languages refresh heading, type and category text while keeping dates, exact memo and source values',()=>{
  const initial=seed([row(1,'exp','literal fallback',12.5,'2026-10-01',{cat:'交通',memo:'架空の固定メモ'})]),h=fixture(initial),headings=new Set();
  for(const lang of ['ja','en','ko','zh']){h.context.kkApplyLang(lang);const group=h.groups()[0],record=h.records()[0];assert.equal(group.attrs['data-date'],'2026-10-01');headings.add(textOf(group.children.find(node=>node.tag==='h3')));assert.equal(textOf(member(record,'kk-cal-kind')),h.context.kkT('kk_js_expense'));assert.equal(textOf(member(record,'kk-cal-category')),h.context.kkCat('交通'));assert.equal(textOf(member(record,'kk-cal-memo')),'架空の固定メモ');assert.doesNotMatch(h.nodes.get('kkCalendarRecords').innerHTML,/undefined|NaN|kk_calendar_/);assert.equal(h.values.get('kb2_2026_10'),initial.kb2_2026_10);}
  assert.ok(headings.size>=3);assert.ok(h.writes.every(write=>['kk_lang','siteLang'].includes(write.key)));
});

'use strict';
// Actual inline scripts by default. An explicit proposal directory supports
// author review before the coordinating agent replaces the HTML blocks.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {Blob}=require('node:buffer');
const html=fs.readFileSync(path.join(__dirname,'..','kakeibo.html'),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
function source(id){
  if(process.env.KK_AUX_SOURCE_DIR)return fs.readFileSync(path.join(process.env.KK_AUX_SOURCE_DIR,id+'.js'),'utf8');
  const match=html.match(new RegExp('<script\\b[^>]*\\bid="'+id+'"[^>]*>([\\s\\S]*?)<\\/script>'));
  assert.ok(match,'actual HTML supplies '+id);return match[1];
}
const fixed=new Date(2026,2,15,12).getTime();
class ClockDate extends Date{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}}
function cloneRows(value){
  const cloned=copy(value);
  for(const key of ['_kkUnreadable','_kkBrokenBuckets'])if(Object.prototype.hasOwnProperty.call(value,key))Object.defineProperty(cloned,key,{value:copy(value[key])});
  return cloned;
}
function fixture({year=2026,month=1,visible=true,months={},days={},records=[],assets=[],language='en'}={}){
  const reads=[],dayReads=[],timers=[],created=[],destroyed=[],blobs=[],downloads=[],revoked=[],requests=[],alerts=[],nodes=new Map();
  let renderCount=0;
  function element(tag='div'){
    return {tagName:tag.toUpperCase(),style:{},id:'',innerHTML:'',children:[],
      appendChild(node){this.children.push(node);if(node.id)nodes.set(node.id,node);return node;},
      remove(){},getContext(){return this;},click(){downloads.push({href:this.href,filename:this.download});}};
  }
  const canvas=element('canvas');canvas.id='catStackChart';nodes.set(canvas.id,canvas);
  const document={readyState:'complete',body:element('body'),getElementById:id=>nodes.get(id)||null,createElement:element,addEventListener(){}};
  const context={document,Blob,Date:ClockDate,Number,Math,JSON,console:{warn(){},error(){}},_year:year,_month:month,
    CAT_COLORS:{'食費':'#123456'},_chartVisible:()=>visible,kkCat:value=>'category '+value,kkT:key=>'localized '+key,
    renderAll(){renderCount++;},
    getData(y,m){const key=y+'-'+String(m).padStart(2,'0');reads.push(key);const value=months[key];if(value instanceof Error)throw value;return value===undefined?[]:cloneRows(value);},
    getDayData(y,m,d){const key=y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');dayReads.push(key);const value=days[key];if(value instanceof Error)throw value;return value===undefined?[]:cloneRows(value);},
    kkLedgerAllRecords:()=>copy(records),
    localStorage:{getItem(key){if(key==='kb2_assets')return JSON.stringify(assets);if(key==='kk_lang')return language;throw Error('Unexpected storage read: '+key);},setItem(){throw Error('Synthetic auxiliary tests never save');},removeItem(){throw Error('Synthetic auxiliary tests never delete');}},
    URL:{createObjectURL(blob){blobs.push(blob);return 'blob:synthetic-'+blobs.length;},revokeObjectURL:url=>revoked.push(url)},
    setTimeout(fn){timers.push(fn);return timers.length;},alert:message=>alerts.push(message),
    fetch(url,options){requests.push({url,body:JSON.parse(options.body)});return new Promise(()=>{});}};
  context.Chart=class{constructor(target,config){this.canvas=target;this.config=config;this.data=config.data;this.options=config.options;created.push(this);}destroy(){destroyed.push(this);}};
  context.window=context;vm.createContext(context);
  return {context,reads,dayReads,months,days,created,destroyed,blobs,downloads,revoked,requests,alerts,
    load(id){vm.runInContext(source(id),context);},
    flush(){let count=0;while(timers.length){assert.ok(++count<10);timers.shift()();}},
    get renderCount(){return renderCount;}};
}
function csvRows(text){
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(!quoted&&(c===','||c==='\n')){row.push(field);field='';if(c==='\n'){rows.push(row);row=[];}}
    else field+=c;
  }
  row.push(field);rows.push(row);return rows;
}
function installActualLedgerReaders(h,seed){
  const values=new Map(Object.entries(seed));
  h.context.localStorage={get length(){return values.size;},key:index=>[...values.keys()][index]??null,getItem:key=>values.get(key)??null,
    setItem(){throw Error('Read-only auxiliary tests never save');},removeItem(){throw Error('Read-only auxiliary tests never delete');}};
  for(const name of ['kkTrendMonth','kkTrendMonthValue','kkTrendMonthDays','kkTrendMonthDay',
    'kkLedgerFingerprint','kkLedgerKeyParts','kkLedgerMonths','kkLedgerBare','kkLedgerReadMonth','kkLedgerAllRecords','getKey','getData','getDayData']){
    const begin=html.indexOf('function '+name+'(');assert.ok(begin>=0,'actual core supplies '+name);
    const next=html.indexOf('\nfunction ',begin+1);assert.ok(next>begin);
    vm.runInContext(html.slice(begin,next),h.context);
  }
  return values;
}

test('category history uses selected months, all custom categories and signed unified values without source-key reads',()=>{
  const h=fixture({months:{'2025-08':[{type:'exp',cat:'食費',amount:10},{type:'inc',amount:900}],
    '2025-12':[{type:'exp',cat:'__proto__',amount:-5}],
    '2026-01':[{type:'exp',cat:'本人の分類',amount:25.5},{type:'exp',cat:'本人の分類',amount:4.5},{type:'inv',amount:999}]}});
  h.load('cat-stack-chart');h.flush();
  assert.deepEqual(h.reads,['2025-08','2025-09','2025-10','2025-11','2025-12','2026-01']);
  const chart=h.created.at(-1),data=copy(chart.data);
  assert.deepEqual(data.labels,['2025/08','2025/09','2025/10','2025/11','2025/12','2026/01']);
  assert.deepEqual(data.datasets.map(row=>row.label),['category 食費','category __proto__','category 本人の分類']);
  assert.deepEqual(data.datasets.map(row=>row.data),[[10,0,0,0,0,0],[0,0,0,0,-5,0],[0,0,0,0,0,30]]);
  assert.equal(data.datasets[0].backgroundColor,'#123456');
  h.months['2026-01'].push({type:'exp',cat:'別の新分類',amount:-2});h.context.renderAll();
  assert.equal(h.renderCount,1);assert.equal(h.destroyed.length,1);assert.equal(h.created.at(-1).data.datasets.at(-1).data.at(-1),-2);
  assert.equal(h.requests.length,0);
});
test('hidden category history does no ledger work and invalid or empty data cannot leave a stale chart',()=>{
  const hidden=fixture({visible:false});hidden.load('cat-stack-chart');hidden.flush();assert.equal(hidden.reads.length,0);assert.equal(hidden.created.length,0);
  const h=fixture({months:{'2026-01':[{type:'exp',cat:'食費',amount:-2}]}});h.load('cat-stack-chart');h.flush();assert.equal(h.created.length,1);
  h.months['2026-01']=[{type:'exp',cat:'食費',amount:'unverified'}];h.context.renderAll();assert.equal(h.destroyed.length,1);assert.equal(h.created.length,1);
  h.months['2026-01']=[];h.context.renderAll();assert.equal(h.created.length,1);
});
test('JSON export retains past, future, undated, fractional and duplicate-ID records while excluding internal references',async()=>{
  const records=[{id:0,month:'2000-01',type:'inc',name:'以前の収入',amount:1.25,_kkRef:{key:'private-origin'}},
    {id:'ocr_same',month:'2026-03',date:'2026-03-15',type:'exp',name:'同じ取引名',cat:'食費',amount:100,_kkSource:'daily'},
    {id:'ocr_same',month:'2026-03',date:'2026-03-15',type:'exp',name:'同じ取引名',cat:'食費',amount:100,_kkRef:'monthly'},
    {id:4,month:'2040-12',date:'2040-12-31',type:'inv',name:'未来の投資',cat:'ETF',amount:-0.5}];
  const h=fixture({records,assets:[{id:9,name:'架空の資産',cat:'現金',amount:300}]});h.load('export-data');h.context.kkExportData('json');
  const output=JSON.parse(await h.blobs[0].text());assert.equal(output.total_records,4);assert.equal(output.records[0].date,'');assert.equal(output.records[0].month,'2000-01');assert.equal(output.records[0].id,0);
  assert.equal(output.records[3].amount,-0.5);assert.equal(output.records[3].month,'2040-12');assert.deepEqual(output.records.slice(1,3).map(row=>row.amount),[100,100]);
  assert.deepEqual(Object.keys(output.records[0]).sort(),['month','date','type','name','amount','category','id'].sort());
  assert.doesNotMatch(JSON.stringify(output),/_kkRef|_kkSource|private-origin/);assert.equal(output.assets[0].amount,300);assert.equal(h.downloads.length,1);
  h.flush();assert.deepEqual(h.revoked,['blob:synthetic-1']);assert.equal(h.requests.length,0);
});
test('CSV export preserves empty dates and quotes categories, multiline names and string IDs with month context',async()=>{
  const h=fixture({records:[{month:'2026-03',name:'店,"A"\n明細',type:'exp',cat:'分類,特別',amount:12.5,id:'ocr,"1"',_kkRef:'hidden'}]});
  h.load('export-data');h.context.kkExportData('csv');const rows=csvRows(await h.blobs[0].text());
  assert.deepEqual(rows[0],['month','date','type','name','amount','category','id']);
  assert.deepEqual(rows[1],['2026-03','','exp','店,"A"\n明細','12.5','分類,特別','ocr,"1"']);
  assert.doesNotMatch(rows.flat().join('|'),/_kkRef|hidden/);
});
test('missing or invalid unified export input fails without producing a misleading empty or zero-filled file',()=>{
  for(const invalid of ['missing','shape','amount']){
    const h=fixture();h.load('export-data');
    if(invalid==='missing')h.context.kkLedgerAllRecords=undefined;
    else h.context.kkLedgerAllRecords=()=>invalid==='shape'?{}:[{month:'2026-03',amount:'unverified'}];
    h.context.kkExportData('json');assert.equal(h.blobs.length,0);assert.equal(h.downloads.length,0);assert.equal(h.alerts.length,1);
  }
});
test('AI remains explicit and builds the existing request from thirty local-calendar days of unified income and expenses',()=>{
  const h=fixture({days:{'2026-03-15':[{type:'inc',amount:1000.25},{type:'exp',cat:'食費',amount:20.5},{type:'inv',amount:999}],
    '2026-02-14':[{type:'exp',cat:'__proto__',amount:-5.25},{type:'exp',cat:'本人の分類',amount:100}],
    '2026-02-13':[{type:'inc',amount:99999}]},assets:[{amount:500}]});
  h.load('ai-advice-feature');assert.equal(h.requests.length,0);assert.equal(h.dayReads.length,0);
  h.context.kkAiAdvice();assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/api/ai-advice');assert.equal(h.dayReads.length,30);
  assert.equal(h.dayReads[0],'2026-03-15');assert.equal(h.dayReads.at(-1),'2026-02-14');
  const summary=h.requests[0].body.summary;
  assert.equal(summary.record_count,4);assert.equal(summary.days_with_data,2);assert.equal(summary.total_income,1000.25);assert.equal(summary.total_expense,115.25);assert.equal(summary.balance,885);
  assert.deepEqual(summary.categories,{'食費':20.5,['__proto__']:-5.25,'本人の分類':100});
  assert.deepEqual(summary.monthly,{'2026-03':{income:1000.25,expense:20.5},'2026-02':{income:0,expense:94.75}});
  assert.equal(summary.total_assets,500);assert.equal(summary.currency,'JPY');
});
test('AI aggregation retains legitimate duplicate entries and refuses unreadable or overflowing totals without provider contact',()=>{
  const duplicates=fixture({days:{'2026-03-15':[{type:'inc',amount:50},{type:'exp',cat:'食費',amount:20},{type:'exp',cat:'食費',amount:20}]}});
  duplicates.load('ai-advice-feature');duplicates.context.kkAiAdvice();assert.equal(duplicates.requests[0].body.summary.record_count,3);assert.equal(duplicates.requests[0].body.summary.total_expense,40);
  for(const bad of [new Error('unavailable'),{},[{type:'inc',amount:'unverified'}],[{type:'inc',amount:Number.MAX_VALUE},{type:'inc',amount:Number.MAX_VALUE}]]){
    const h=fixture({days:{'2026-03-15':bad}});h.load('ai-advice-feature');h.context.kkAiAdvice();assert.equal(h.requests.length,0);assert.equal(h.alerts.length,1);
  }
  const empty=fixture();empty.load('ai-advice-feature');empty.context.kkAiAdvice();assert.equal(empty.requests.length,0);assert.equal(empty.alerts.length,1);
});
test('unreadable flags prevent partial category charts and AI summaries even when valid records are present',()=>{
  const rows=[{type:'exp',amount:10,cat:'食費'},{type:'inc',amount:50},{type:'exp',amount:5,cat:'食費'}];
  Object.defineProperty(rows,'_kkUnreadable',{value:true});
  const h=fixture({months:{'2026-01':rows},days:{'2026-03-15':rows}});
  h.load('cat-stack-chart');h.flush();assert.equal(h.created.length,0);
  h.load('ai-advice-feature');h.context.kkAiAdvice();assert.equal(h.requests.length,0);assert.equal(h.alerts.length,1);
});
test('actual core readers preserve a broken legacy bucket alongside valid rows without exporting or requesting AI for partial data',()=>{
  const h=fixture({year:2026,month:3}),valid=JSON.stringify([{id:1,type:'inc',amount:100,date:'2026-03-15'},
    {id:2,type:'exp',amount:10,date:'2026-03-15'},{id:3,type:'exp',amount:20,date:'2026-03-15'}]);
  const seed={kb2_2026_03:valid,kbday_2026_03_15:'{'},values=installActualLedgerReaders(h,seed);
  const rows=h.context.getDayData(2026,3,15);assert.equal(rows.length,3);assert.equal(rows._kkUnreadable,true);assert.equal(rows._kkBrokenBuckets.length,1);
  h.load('export-data');h.context.kkExportData('json');assert.equal(h.blobs.length,0);assert.equal(h.downloads.length,0);
  h.load('ai-advice-feature');h.context.kkAiAdvice();assert.equal(h.requests.length,0);
  h.load('cat-stack-chart');h.flush();assert.equal(h.created.length,0);
  assert.deepEqual(Object.fromEntries(values),seed);
});

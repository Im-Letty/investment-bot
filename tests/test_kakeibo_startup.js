'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','kakeibo.html'),'utf8');
const theme=fs.readFileSync(path.join(__dirname,'..','static/mypage-kakeibo-theme.js'),'utf8');
function storage(initial={}){
  const values=new Map(Object.entries(initial));
  return {get length(){return values.size;},key:i=>[...values.keys()][i]??null,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(String(k),String(v)),removeItem:k=>values.delete(k),values};
}
function element(tag='div',id=''){
  const classes=new Set(),attrs=new Map(),vars=new Map();
  return {id,tagName:tag.toUpperCase(),className:'',children:[],style:{setProperty:(k,v)=>vars.set(k,v),getPropertyValue:k=>vars.get(k)||''},value:'',textContent:'',innerHTML:'',hidden:false,
    classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name),toggle(name,on){if(on)classes.add(name);else classes.delete(name);}},
    setAttribute:(k,v)=>attrs.set(k,String(v)),getAttribute:k=>attrs.get(k)??null,
    appendChild(node){this.children.push(node);node.parentElement=this;return node;},
    querySelector(selector){return this.children.find(n=>selector==='.'+n.className.split(' ').at(-1))||null;},
    addEventListener(){},getContext(){return this;}};
}
function fixture(initial={},embedded=true){
  const nodes=new Map(),events=new Map(),messages=[],scripts=[],frames=new Map();let sequence=0;
  for(const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)){
    const node=element(match[1],match[3]);node.value=match[2].match(/value="([^"]*)"/)?.[1]||'';
    if(node.tagName==='CANVAS')node.parentElement=element();
    nodes.set(node.id,node);
  }
  const document={readyState:'loading',documentElement:element('html'),body:element('body'),head:{appendChild:n=>scripts.push(n)},getElementById:id=>nodes.get(id)||null,
    createElement:tag=>element(tag),querySelectorAll:selector=>selector==='canvas'?[...nodes.values()].filter(n=>n.tagName==='CANVAS'):[],
    addEventListener(name,fn){const list=events.get('document:'+name)||[];list.push(fn);events.set('document:'+name,list);}};
  const context={document,console,location:{origin:'https://example.test'},localStorage:storage(initial),kkT:key=>key==='kk_currency_symbol'?'¥':key,kkCat:value=>value,
    setTimeout:()=>1,clearTimeout(){},Event:class{constructor(type){this.type=type;}},MutationObserver:class{observe(){}},
    requestAnimationFrame(fn){frames.set(++sequence,fn);return sequence;},
    getComputedStyle:()=>({fontFamily:'fixture-font',getPropertyValue:()=>''}),
    addEventListener(name,fn){const list=events.get('window:'+name)||[];list.push(fn);events.set('window:'+name,list);},
    dispatchEvent(event){(events.get('window:'+event.type)||[]).forEach(fn=>fn(event));},alert(message){throw new Error(message);}};
  context.window=context;context.parent=embedded?{postMessage:(data,origin)=>messages.push({data,origin})}:context;
  function core(){const start=html.indexOf('var _year=new Date()'),end=html.indexOf('// ===== Brand Color Sync =====',start);assert.ok(start>0&&end>start);vm.runInNewContext(html.slice(start,end),context);}
  function loader(){const source=html.match(/<script id="kk-chart-loader">([\s\S]*?)<\/script>/)[1];vm.runInNewContext(source,context);}
  function event(name){(events.get('document:'+name)||[]).forEach(fn=>fn());}
  return {context,nodes,document,messages,scripts,events,frames,core,loader,event};
}
const now=new Date(),monthKey='kb2_'+now.getFullYear()+'_'+String(now.getMonth()+1).padStart(2,'0');
const records=[{id:1,type:'inc',name:'架空の収入',amount:50000},{id:2,type:'exp',name:'架空の支出',cat:'食費',amount:1200}];
test('summary, list, calendar and editable records initialize even when graph loading never completes',()=>{
  const h=fixture({[monthKey]:JSON.stringify(records)});h.core();
  assert.equal(h.nodes.get('d-income').textContent,'¥50,000');assert.equal(h.nodes.get('d-expense').textContent,'¥1,200');assert.equal(h.nodes.get('d-balance').textContent,'¥48,800');
  assert.match(h.nodes.get('rec-list-el').innerHTML,/架空の支出/);assert.match(h.nodes.get('calGrid').innerHTML,/cal-day/);
  assert.equal(h.document.documentElement.getAttribute('data-kn-ledger-ready'),'true');
  assert.deepEqual(JSON.parse(JSON.stringify(h.messages)),[{data:{type:'kn-kakeibo-ready'},origin:'https://example.test'}]);
  h.nodes.get('exp-name').value='架空の追記';h.nodes.get('exp-amount').value='800';h.nodes.get('exp-cat').value='食費';h.context.addRecord('exp');
  assert.equal(h.nodes.get('d-expense').textContent,'¥2,000');assert.match(h.nodes.get('rec-list-el').innerHTML,/架空の追記/);
  h.context.deleteRecord(2);assert.equal(h.nodes.get('d-expense').textContent,'¥800');
});
test('late local graph loading preserves draft, selected month and canvas after an initially empty ledger',()=>{
  const h=fixture();h.core();h.loader();assert.equal(h.scripts.length,0,'graphs wait until critical HTML and theme are ready');
  const canvas=h.nodes.get('donutChart');assert.equal(canvas.hidden,true);assert.ok(canvas.parentElement.querySelector('.kk-chart-empty'));
  h.nodes.get('inc-name').value='保存前の架空メモ';h.nodes.get('inc-amount').value='123';h.context._year=2024;h.context._month=3;
  h.context.localStorage.setItem('kb2_2024_03',JSON.stringify([{id:4,type:'exp',name:'架空の三月支出',cat:'食費',amount:900}]));
  h.event('DOMContentLoaded');assert.equal(h.scripts.length,1);assert.equal(h.scripts[0].src,'/static/vendor/chart.umd-4.4.1.js');assert.equal(h.scripts[0].async,true);
  const charts=[],order=[];
  h.context.addEventListener('kkChartsReady',()=>order.push('theme'));
  h.context.Chart=class{static getChart(){}constructor(canvas,config){order.push('chart');charts.push({canvas,config});}};
  h.scripts[0].onload();assert.equal(order[0],'theme');assert.equal(charts.length,3,'original bar, line and nonempty expense graphs restored');
  assert.equal(h.nodes.get('inc-name').value,'保存前の架空メモ');assert.equal(h.nodes.get('inc-amount').value,'123');assert.equal(h.context._year,2024);assert.equal(h.context._month,3);
  assert.equal(canvas.hidden,false);assert.equal(canvas.parentElement.querySelector('.kk-chart-empty').hidden,true);
  assert.equal(h.nodes.get('d-expense').textContent,'¥900');
});
test('reading palette plugin registers before late chart construction and never duplicates registration',()=>{
  const h=fixture();h.core();vm.runInNewContext(theme,h.context);h.loader();h.event('DOMContentLoaded');
  const order=[];
  h.context.Chart=class{static register(plugin){order.push('plugin:'+plugin.id);}static getChart(){}constructor(){order.push('chart');}};
  h.scripts[0].onload();assert.equal(order[0],'plugin:knLedgerReading');assert.ok(order.includes('chart'));
  h.context.dispatchEvent(new h.context.Event('kkChartsReady'));assert.equal(order.filter(x=>x==='plugin:knLedgerReading').length,1);
});
test('external fonts and graph library no longer block parsing of usable ledger inputs',()=>{
  assert.match(html,/<link[^>]*fonts\.googleapis\.com[^>]*media="print"[^>]*onload="this\.media='all'"/);
  assert.doesNotMatch(html,/<script[^>]*src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart/);
  assert.match(html,/script\.src='\/static\/vendor\/chart\.umd-4\.4\.1\.js';script\.async=true/);
});
function syncFixture(initial={},usePrototype=false){
  class FixtureStorage{
    constructor(seed){this.values=new Map(Object.entries(seed||{}));}
    get length(){return this.values.size;}
    key(i){return [...this.values.keys()][i]??null;}
    getItem(k){return this.values.get(k)??null;}
    setItem(k,v){this.values.set(String(k),String(v));}
    removeItem(k){this.values.delete(k);}
  }
  const ls=usePrototype?new FixtureStorage({lineUserId:'fixture-user',...initial}):storage({lineUserId:'fixture-user',...initial});
  const requests=[],renders=[],timers=new Map(),events=new Map();let reloads=0,seq=0;
  const context={console,knLedgerSession:initial.lineUserId===''?null:{user:{id:'fixture-user'},access_token:'fixture-token'},localStorage:ls,document:{readyState:'interactive',addEventListener(){}},
    setTimeout(fn,ms){timers.set(++seq,{fn,ms});return seq;},clearTimeout:id=>timers.delete(id),addEventListener:(name,fn)=>events.set(name,fn),
    fetch(url,init){const req={url,init,resolved:false};requests.push(req);return new Promise(resolve=>{req.resolve=resolve;});},location:{reload(){reloads++;}},
    renderAll:()=>renders.push('summary'),renderCalendar:()=>renders.push('calendar'),renderDayModal:()=>renders.push('modal'),kkRenderCustomCats:()=>renders.push('categories')};
  context.window=context;if(usePrototype){context.Storage=FixtureStorage;context.sessionStorage=new FixtureStorage();}
  const start=html.indexOf('/* ==== Kakeibo <-> Supabase sync'),end=html.indexOf('</script>',start);
  vm.runInNewContext(html.slice(start,end),context);
  return {context,ls,requests,renders,timers,events,get reloads(){return reloads;},
    respond(data,ok=true){const req=requests.find(r=>!r.resolved&&r.url.endsWith('/load'));assert.ok(req);req.resolved=true;req.resolve({ok,json:()=>Promise.resolve({data})});return context.kkRefreshRecords();},
    respondSave(ok=true,jsonOk=ok){const req=requests.find(r=>!r.resolved&&r.url.endsWith('/save'));assert.ok(req);req.resolved=true;req.resolve({ok,json:()=>Promise.resolve({ok:jsonOk})});},
    timer(ms){const found=[...timers].find(([,t])=>t.ms===ms);assert.ok(found);timers.delete(found[0]);return found[1].fn();}};
}
test('cloud data refresh updates summaries in place without reload or duplicate in-flight fetch',async()=>{
  const h=syncFixture({[monthKey]:'[]'});const pending=h.context.kkRefreshRecords();assert.equal(h.requests.length,1);
  const result=h.respond({[monthKey]:JSON.stringify(records),'kb2_assets':'[]','unrelated':'ignore'});await pending;await result;
  assert.equal(h.ls.getItem(monthKey),JSON.stringify(records));assert.equal(h.ls.getItem('unrelated'),null);
  assert.deepEqual(h.renders,['summary','calendar','modal','categories']);assert.equal(h.reloads,0);
});
test('cloud refresh preserves edits and removals made while its request is in flight',async()=>{
  const h=syncFixture({[monthKey]:'[]',kb2_assets:'[]'});
  const local=JSON.stringify([{id:3,type:'inc',name:'架空の新入力',amount:300}]);h.ls.setItem(monthKey,local);h.ls.removeItem('kb2_assets');
  await h.respond({[monthKey]:JSON.stringify(records),kb2_assets:'[{"id":5,"amount":500}]',kk_custom_cats:'["架空分類"]'});
  assert.equal(h.ls.getItem(monthKey),local);assert.equal(h.ls.getItem('kb2_assets'),null);assert.equal(h.ls.getItem('kk_custom_cats'),'["架空分類"]');assert.equal(h.reloads,0);
});
test('a cloud response for a previous user is discarded and failed loads retain local records',async()=>{
  const h=syncFixture({[monthKey]:'[]'});h.context.knLedgerSession={user:{id:'different-fixture-user'},access_token:'different-token'};await h.respond({[monthKey]:JSON.stringify(records)});
  assert.equal(h.ls.getItem(monthKey),'[]');assert.equal(h.renders.length,0);
  const bad=syncFixture({[monthKey]:JSON.stringify(records)});await bad.respond({[monthKey]:'[]'},false);
  assert.equal(bad.ls.getItem(monthKey),JSON.stringify(records));assert.equal(bad.renders.length,0);assert.equal(bad.reloads,0);
});

test('reopening before the debounced save cannot replace unsaved records with an older cloud snapshot',async()=>{
  const h=syncFixture({[monthKey]:'[]'});await h.respond({[monthKey]:'[]'});
  const local=JSON.stringify([{id:6,type:'inc',name:'架空の保存待ち',amount:600}]);h.ls.setItem(monthKey,local);
  const refresh=h.context.kkRefreshRecords();await h.respond({[monthKey]:'[]'});await refresh;
  assert.equal(h.ls.getItem(monthKey),local);
  const save=h.timer(1500);assert.equal(JSON.parse(h.requests.at(-1).init.body).data[monthKey],local);
  h.respondSave();await save;
  const later=h.context.kkRefreshRecords();await h.respond({[monthKey]:'[{"id":8,"amount":800,"type":"inc"}]'});await later;
  assert.equal(h.ls.getItem(monthKey),'[{"id":8,"amount":800,"type":"inc"}]','successfully saved keys may be refreshed again');
});
test('failed save and edits made during a save remain protected against stale cloud reads',async()=>{
  const h=syncFixture({[monthKey]:'[]'});await h.respond({[monthKey]:'[]'});
  h.ls.setItem(monthKey,'[{"id":10,"amount":1000,"type":"inc"}]');const failed=h.timer(1500);h.respondSave(false);await failed;
  const refresh=h.context.kkRefreshRecords();await h.respond({[monthKey]:'[]'});await refresh;
  assert.match(h.ls.getItem(monthKey),/1000/);
  h.ls.setItem(monthKey,'[{"id":11,"amount":1100,"type":"inc"}]');const pending=h.timer(1500);
  h.ls.setItem(monthKey,'[{"id":12,"amount":1200,"type":"inc"}]');h.respondSave();await pending;
  const again=h.context.kkRefreshRecords();await h.respond({[monthKey]:'[{"id":11,"amount":1100,"type":"inc"}]'});await again;
  assert.match(h.ls.getItem(monthKey),/1200/);
});
test('retained local refresh redraws changes from another ledger window and delayed identity starts restoration',async()=>{
  const h=syncFixture({[monthKey]:'[]'});await h.respond({[monthKey]:'[]'});
  h.ls.values.set(monthKey,JSON.stringify(records));const before=h.renders.length;
  const refresh=h.context.kkRefreshRecords();assert.equal(h.renders.length,before+4);await h.respond({[monthKey]:JSON.stringify(records)});await refresh;
  const delayed=syncFixture({lineUserId:''});assert.equal(delayed.requests.length,0);
  delayed.context.knLedgerSession={user:{id:'later-fixture-user'},access_token:'later-token'};delayed.events.get('knLedgerAuth')();
  assert.equal(delayed.requests.length,1);await delayed.respond({[monthKey]:'[]'});
});
test('a successful response without ok true does not clear local write protection',async()=>{
  const h=syncFixture({[monthKey]:'[]'});await h.respond({[monthKey]:'[]'});h.ls.setItem(monthKey,JSON.stringify(records));
  const save=h.timer(1500);h.respondSave(true,false);await save;
  const refresh=h.context.kkRefreshRecords();await h.respond({[monthKey]:'[]'});await refresh;assert.equal(h.ls.getItem(monthKey),JSON.stringify(records));
});

test('the native Storage prototype hook protects local records while leaving session storage outside autosave',async()=>{
  const h=syncFixture({[monthKey]:'[]'},true);await h.respond({[monthKey]:'[]'});
  h.context.sessionStorage.setItem(monthKey,'session-only');assert.equal(h.timers.size,0);
  h.ls.setItem(monthKey,JSON.stringify(records));assert.equal(h.timers.size,1);
  const pending=h.context.kkRefreshRecords();await h.respond({[monthKey]:'[]'});await pending;assert.equal(h.ls.getItem(monthKey),JSON.stringify(records));
  const save=h.timer(1500);h.respondSave();await save;assert.equal(h.context.sessionStorage.getItem(monthKey),'session-only');
});

test('an older read cannot overwrite a local edit even when its save finishes before the read response',async()=>{
  const h=syncFixture({[monthKey]:'[]'});await h.respond({[monthKey]:'[]'});
  h.ls.setItem(monthKey,JSON.stringify(records));const read=h.context.kkRefreshRecords();
  const saved=h.timer(1500);h.respondSave();await saved;
  await h.respond({[monthKey]:'[]'});await read;assert.equal(h.ls.getItem(monthKey),JSON.stringify(records));
  const nextRead=h.context.kkRefreshRecords();
  h.ls.setItem(monthKey,'[]');h.ls.setItem(monthKey,JSON.stringify(records));const savedAgain=h.timer(1500);h.respondSave();await savedAgain;
  await h.respond({[monthKey]:'[]'});await nextRead;assert.equal(h.ls.getItem(monthKey),JSON.stringify(records),'edit-and-revert is still newer than the fetch');
});
test('ledger transport uses verified session bearer token and never sends a legacy UID',async()=>{
 const h=syncFixture({lineUserId:'untrusted-id',kb2_assets:'[]'});
 assert.equal(h.requests[0].url,'/api/kakeibo/load');assert.equal(h.requests[0].init.headers.Authorization,'Bearer fixture-token');
 await h.respond(null);const save=h.timer(1500);const req=h.requests.at(-1);
 assert.equal(req.init.headers.Authorization,'Bearer fixture-token');assert.equal(Object.hasOwn(JSON.parse(req.init.body),'uid'),false);h.respondSave();await save;
});

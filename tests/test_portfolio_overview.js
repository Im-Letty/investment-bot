'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const api=require('../static/portfolio-overview.js');
const raw=rows=>JSON.stringify(rows);
function fixture(rows=[]){let owner='A',assetsRaw=raw(rows),plannerRaw=null,readHook=null,writeHook=null;const writes=[],states=[];
 const session=api.createSession({owner:()=>owner,read:async who=>{if(readHook)return readHook(who);return {assetsRaw,raw:plannerRaw};},write(who,rows){if(writeHook)return writeHook(who,rows);assert.equal(who,owner);assetsRaw=raw(rows);writes.push(assetsRaw);},onChange:s=>states.push(s)});
 return {session,writes,states,setOwner:v=>owner=v,setRaw:v=>assetsRaw=v,setPlanner:v=>plannerRaw=v,setRead:v=>readHook=v,setWrite:v=>writeHook=v,getRaw:()=>assetsRaw};
}
test('overview sums saved signed fractional values exactly without mutating or seeding data',()=>{
 const rows=[{id:1,name:'預金',cat:'現金',amount:.1,custom:{untouched:true}},{id:2,name:'株',cat:'国内株',amount:.2},{id:3,amount:-.1}];
 const before=raw(rows),m=api.analyse(before);assert.equal(m.total,.2);assert.equal(m.canAllocate,false);assert.equal(m.rows.length,3);assert.equal(raw(m.rows),before);assert.equal(api.analyse(null).total,0);assert.deepEqual(api.analyse(null).rows,[]);
});
test('unknown acquisition values remain unknown; cash is excluded and zero cost is explicit known data',()=>{
 const m=api.analyse(raw([{amount:100,cat:'現金',cost:0},{amount:120,cat:'投資信託',cost:100},{amount:10,cat:'国内株'},{amount:15,cat:'米国株',cost:null},{amount:5,cat:'ETF',cost:0}]));
 assert.equal(m.total,250);assert.equal(m.profit,25);assert.equal(m.knownCount,2);assert.equal(m.unknownCount,2);
 assert.equal(api.analyse(raw([{amount:100,cat:'国内株'}])).profit,null);
});
test('NISA stays an account classification and legacy categories are not silently migrated',()=>{
 const rows=[{id:1,amount:5,cat:'投資信託',account:'NISA'},{id:2,amount:3,cat:'NISA'}],m=api.analyse(raw(rows));
 assert.deepEqual(m.groups,[{name:'投資信託',amount:5,amountText:'5'},{name:'NISA',amount:3,amountText:'3'}]);assert.deepEqual(m.rows,rows);
});
test('zero, offsetting and any negative valuations do not produce allocation ratios',()=>{
 for(const rows of [[],[{amount:0}],[{amount:100},{amount:-100}],[{amount:-1},{amount:101}]])assert.equal(api.analyse(raw(rows)).canAllocate,false);
 assert.equal(api.analyse(raw([{amount:0},{amount:.3}])).canAllocate,true);
});
test('malformed or unsafe saved assets cannot turn into an empty successful portfolio',()=>{
 for(const r of ['bad','{}','[null]','[{"amount":"10"}]','[{"amount":1e309}]',raw([{amount:1e308},{amount:1e308}])])assert.throws(()=>api.analyse(r));
});
test('asset edits preserve ids, unknown fields and every other saved row',()=>{
 const rows=[{id:4,name:'元',cat:'国内株',amount:.1,custom:{same:true},cost:null},{id:5,name:'別',cat:'現金',amount:-1}],before=raw(rows);
 const next=api.updateRows(before,0,{name:'新',cat:'国内株',amount:'０．２',account:'NISA'});
 assert.deepEqual(next[0],{id:4,name:'新',cat:'国内株',amount:.2,custom:{same:true},cost:null,account:'NISA'});assert.deepEqual(next[1],rows[1]);assert.equal(raw(rows),before);
 const added=api.updateRows(before,null,{name:'追加',cat:'現金',amount:'0'}).at(-1);assert.deepEqual(Object.keys(added).sort(),['amount','cat','id','name']);
});
test('amount editing supports the prior whole-input decimal grammar and refuses malformed grouping',()=>{
 for(const [text,value] of [['.5',.5],['1.',1],['１．',1],['－．５',-.5],['￥１，０００．５',1000.5],['1e-3',.001],['０',0]])assert.equal(api.amount(text,true),value,text);
 for(const text of ['','1,00','1.2.3','1x','1e','Infinity','1e309','1e-400','9007199254740992'])assert.throws(()=>api.amount(text,true),text);
 assert.throws(()=>api.amount('-1',false));
});
test('optional metadata validates only intentional edits and never invents a date or cost',()=>{
 const legacy=raw([{id:1,name:'元',cat:'国内株',amount:1,date:'legacy-unknown',extra:9}]);
 const next=api.updateRows(legacy,0,{name:'元',cat:'国内株',amount:'2'});assert.equal(next[0].date,'legacy-unknown');assert.equal(next[0].cost,undefined);
 assert.throws(()=>api.updateRows(legacy,0,{name:'元',cat:'国内株',amount:'2',date:'2026-02-30'}));
 assert.equal(api.updateRows(legacy,0,{name:'元',cat:'国内株',amount:'2',cost:''})[0].cost,null);
});
test('selected nonmonetary goals remain selected, and only missing selection falls back to a monetary goal',()=>{
 const goals=[{id:'free',title:'勉強',target:null,deadline:''},{id:'fund',title:'資産目標',target:1000,deadline:'2030-01-01'}];
 assert.equal(api.goal(raw({version:1,goals,selectedGoalId:'free'})).id,'free');assert.equal(api.goal(raw({version:1,goals,selectedGoalId:'missing'})).id,'fund');assert.equal(api.goal(null),null);
});
test('restoration failure blocks edits, leaves stored data intact and offers no empty ready model',async()=>{
 const h=fixture([{id:1,name:'保存値',cat:'現金',amount:10}]),before=h.getRaw();h.setRead(async()=>{throw Error('unavailable');});assert.equal(await h.session.refresh(),false);assert.equal(h.session.state().ready,false);assert.equal(h.session.state().model,null);
 await assert.rejects(h.session.save(null,{name:'新',cat:'現金',amount:'1'},before));assert.equal(h.writes.length,0);assert.equal(h.getRaw(),before);
});
test('intentional save writes the same private asset store and refreshes one consistent model',async()=>{
 const h=fixture([{id:1,name:'元',cat:'国内株',amount:10,extra:5}]);await h.session.refresh();const base=h.session.state().raw;
 assert.equal(await h.session.save(0,{name:'変更',cat:'国内株',amount:'10.2',cost:'9'},base),true);assert.equal(h.writes.length,1);assert.equal(h.session.state().model.total,10.2);assert.equal(h.session.state().model.profit,1.2);assert.equal(JSON.parse(h.getRaw())[0].extra,5);
});
test('new edits cannot overwrite a newer restored asset snapshot',async()=>{
 const h=fixture([{id:1,name:'元',cat:'現金',amount:1}]);await h.session.refresh();const base=h.session.state().raw;h.setRaw(raw([{id:1,name:'最新',cat:'現金',amount:2}]));
 await assert.rejects(h.session.save(0,{name:'古い下書き',cat:'現金',amount:'3'},base),/更新/);assert.equal(h.writes.length,0);assert.equal(JSON.parse(h.getRaw())[0].name,'最新');
});
test('finite legacy amounts and exact totals beyond safe integers remain readable and unchanged on metadata edits',async()=>{
 const h=fixture([{id:1,name:'保存',cat:'国内株',amount:1e16,extra:1}]);await h.session.refresh();const before=h.getRaw();
 await h.session.save(0,{name:'保存',cat:'国内株',amount:'10000000000000000',account:'NISA'},before);assert.equal(JSON.parse(h.getRaw())[0].amount,1e16);assert.equal(JSON.parse(h.getRaw())[0].extra,1);
 const m=api.analyse(raw([{amount:Number.MAX_SAFE_INTEGER},{amount:2}]));assert.equal(m.totalText,'9007199254740993');assert.equal(api.money(m.totalText),'9,007,199,254,740,993円');
 assert.equal(api.decimalText([.0000001,.0000002]),'0.0000003');
});
test('true nonfinite aggregates stay unavailable without mutating the stored rows',async()=>{
 const h=fixture([{amount:1e308},{amount:1e308}]),before=h.getRaw();assert.equal(await h.session.refresh(),false);assert.equal(h.session.state().ready,false);assert.equal(h.getRaw(),before);assert.equal(h.writes.length,0);
});
test('storage failures retain the old model and never report a successful save',async()=>{
 const h=fixture([{id:1,name:'保存',cat:'現金',amount:1}]);await h.session.refresh();const before=h.getRaw();h.setWrite(()=>{throw Error('quota');});await assert.rejects(h.session.save(0,{name:'下書き',cat:'現金',amount:'2'},before),/quota/);assert.equal(h.getRaw(),before);assert.equal(h.session.state().model.total,1);
});
test('owner changes during the prewrite load prevent writes and hide prior owner state',async()=>{
 const h=fixture([{id:1,name:'秘密',cat:'現金',amount:1}]);await h.session.refresh();let resolve;const pending=new Promise(r=>resolve=r),before=h.getRaw();h.setRead(()=>pending);const saving=h.session.save(0,{name:'旧',cat:'現金',amount:'2'},before);h.setOwner('B');resolve({assetsRaw:before,raw:null});await assert.rejects(saving);assert.equal(h.writes.length,0);assert.equal(h.session.state().model,null);
});
test('owner changes during postwrite refresh cannot acknowledge the prior owner save',async()=>{
 const h=fixture([{id:1,name:'旧',cat:'現金',amount:1}]);await h.session.refresh();let calls=0,resolve;const before=h.getRaw();h.setRead(async()=>{calls++;if(calls===1)return {assetsRaw:before,raw:null};return new Promise(r=>resolve=r);});
 const saving=h.session.save(0,{name:'保存',cat:'現金',amount:'2'},before);while(!resolve)await Promise.resolve();h.setOwner('B');h.session.reset();resolve({assetsRaw:h.getRaw(),raw:null});await assert.rejects(saving,/アカウント/);assert.equal(h.session.state().model,null);assert.equal(h.writes.length,1);
});
test('malformed goal metadata does not hide valid saved asset totals',async()=>{
 const h=fixture([{amount:.1},{amount:.2}]);h.setPlanner('bad');assert.equal(await h.session.refresh(),true);assert.equal(h.session.state().model.total,.3);assert.equal(h.session.state().goalError,true);
});
test('deleted stale rows cannot be removed from a newer asset snapshot',async()=>{
 const h=fixture([{id:1,name:'A',cat:'現金',amount:1},{id:2,name:'B',cat:'現金',amount:2}]);await h.session.refresh();const base=h.session.state().raw;h.setRaw(raw([{id:2,name:'B',cat:'現金',amount:2}]));await assert.rejects(h.session.remove(0,base));assert.equal(h.writes.length,0);assert.equal(JSON.parse(h.getRaw())[0].id,2);
});

test('goal percentages never announce completion before the exact remaining amount is zero',()=>{
 assert.equal(api.percent(999999,1000000,'1'),'99.9%');assert.equal(api.percent(9007199254740992,9007199254740992,'1'),'99.9%');assert.equal(api.percent(1000000,1000000,'0'),'100%');assert.equal(api.percent(.01,1000000,'999999.99'),'0.1%未満');
});
function domFixture(seed=[{id:1,name:'架空の保存資産',cat:'国内株',amount:.1},{id:2,name:'架空の別資産',cat:'現金',amount:.2}]){
 const nodes=new Map(),all=[],listeners={},values=new Map([['kn_ledger_owner','A']]),writes=[];let assetRaw=raw(seed),planner=null;
 function element(tag='div',id=''){
  const attrs=new Map(),classes=new Set(),events={};const n={tagName:tag.toUpperCase(),id,value:'',textContent:'',hidden:false,disabled:false,children:[],style:{},events,options:[],
   classList:{toggle(k,on){on?classes.add(k):classes.delete(k);},add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k)},setAttribute:(k,v)=>attrs.set(k,String(v)),getAttribute:k=>attrs.get(k)??null,
   appendChild(c){n.children.push(c);c.parentNode=n;if(n.tagName==='SELECT')n.options.push(c);return c;},replaceChildren(...children){n.children=[];children.forEach(c=>n.appendChild(c));},
   querySelectorAll(selector){return all.filter(c=>selector==='[data-po-add]'?c.getAttribute('data-po-add')!==null:selector==='[data-po-custom]'?c.getAttribute('data-po-custom')!==null:false);},
   addEventListener:(name,fn)=>events[name]=fn,focus(){n.focused=true;},scrollIntoView(){},remove(){if(n.parentNode)n.parentNode.children=n.parentNode.children.filter(c=>c!==n);attrs.delete('data-po-custom');},click(){if(events.click)return events.click({target:n});}};
  all.push(n);if(id)nodes.set(id,n);return n;
 }
 const ids=['tab-assets','poEditor','poStatus','poFieldset','totalAssetVal','poProfitValue','poProfitNote','poAsOf','poGoalBody','totalAssetChange','asset-legend','poAllocationStack','asset-list-el','poAllocationNote','poEditorError','poEditorTitle','poSaveButton','poCancelButton','poGoalEdit','poRetry'];ids.forEach(id=>element('div',id));nodes.get('poEditor').hidden=true;
 for(const key of ['name','cat','amount','cost','account','institution','date'])element(['cat','account'].includes(key)?'select':'input','ast-'+key);
 for(const id of ['ast-cat','ast-account'])for(const value of ['',...(id==='ast-cat'?['現金','国内株','投資信託']:['NISA','特定口座'])]){const o=element('option');o.value=value;nodes.get(id).appendChild(o);}
 const add=element('button');add.setAttribute('data-po-add','');
 const document={readyState:'complete',getElementById:id=>nodes.get(id)||null,createElement:tag=>element(tag)};
 const w={document,location:{origin:'https://portfolio.test',href:'https://portfolio.test/kakeibo'},knLedgerSession:{user:{id:'A'},access_token:'synthetic-token'},localStorage:{getItem:k=>values.get(k)??null},
  kkMyPageStore:{load:async()=>({assetsRaw:assetRaw,raw:planner})},saveAssets(rows){assetRaw=raw(rows);writes.push(assetRaw);},confirm:()=>true,addEventListener:(name,fn)=>listeners[name]=fn};w.parent=w;
 api.mount(w);
 return {w,nodes,all,add,listeners,writes,getRaw:()=>assetRaw,setPlanner:r=>planner=r,async flush(){for(let i=0;i<12;i++)await Promise.resolve();},
  owner(id){values.set('kn_ledger_owner',id);w.knLedgerSession={user:{id},access_token:'synthetic-'+id};},
  input(key,value){const n=nodes.get('ast-'+key);n.value=value;nodes.get('poEditor').events.input({target:n});},
  dispatch(name,event={}){return listeners[name]&&listeners[name](event);}};
}
test('actual DOM handlers show the exact model, submit once, preserve untouched metadata and retain empty optional fields',async()=>{
 const h=domFixture();await h.flush();assert.equal(h.nodes.get('totalAssetVal').textContent,'0.3円');assert.equal(h.nodes.get('poAllocationStack').children.length,2);assert.equal(h.nodes.get('asset-legend').children[0].children[1].textContent,'0.1円');h.add.click();h.input('name','追加の架空資産');h.input('amount','１．５');h.nodes.get('ast-cat').value='現金';let prevented=false;
 h.nodes.get('poEditor').events.submit({preventDefault(){prevented=true;}});await h.flush();assert.equal(prevented,true);assert.equal(h.writes.length,1);assert.equal(h.nodes.get('poEditor').hidden,true);assert.equal(h.nodes.get('totalAssetVal').textContent,'1.8円');
 const saved=JSON.parse(h.getRaw()).at(-1);assert.deepEqual(Object.keys(saved).sort(),['amount','cat','id','name']);assert.equal(saved.amount,1.5);
});
test('same-owner token refresh and ordinary rerender keep unfinished editor fields; a confirmed account change scrubs them',async()=>{
 const h=domFixture();await h.flush();h.add.click();h.input('name','未保存の私的な下書き');h.input('amount','１２３．４５');
 h.dispatch('storage',{key:'sb-auth-token'});h.dispatch('knLedgerAuth');await h.flush();assert.equal(h.nodes.get('poEditor').hidden,false);assert.equal(h.nodes.get('ast-name').value,'未保存の私的な下書き');assert.equal(h.nodes.get('ast-amount').value,'１２３．４５');assert.equal(h.writes.length,0);
 h.owner('B');h.dispatch('knLedgerAuth');assert.equal(h.nodes.get('poEditor').hidden,true);for(const k of ['name','amount','cost','account','institution','date'])assert.equal(h.nodes.get('ast-'+k).value,'');assert.equal(h.nodes.get('totalAssetChange').textContent,'');
});
test('DOM asset edit and cancel keep stored signed valuations and unknown properties intact',async()=>{
 const h=domFixture([{id:1,name:'架空',cat:'国内株',amount:-1.25,extra:{keep:true},date:'unknown-basis'}]);await h.flush();const before=h.getRaw(),edit=h.nodes.get('asset-list-el').children[0].children[0];edit.click();h.input('name','編集下書き');h.nodes.get('poCancelButton').click();assert.equal(h.getRaw(),before);assert.equal(h.writes.length,0);
 edit.click();h.input('name','名称だけ編集');h.nodes.get('poEditor').events.submit({preventDefault(){}});await h.flush();assert.equal(h.writes.length,1);assert.deepEqual(JSON.parse(h.getRaw())[0],{id:1,name:'名称だけ編集',cat:'国内株',amount:-1.25,extra:{keep:true},date:'unknown-basis'});
});
test('DOM fieldset stays disabled and no saved values are fabricated if restoration fails',async()=>{
 const h=domFixture();h.w.kkMyPageStore.load=async()=>{throw Error('restore');};h.dispatch('knLedgerAuth');await h.flush();assert.equal(h.nodes.get('poFieldset').disabled,true);assert.equal(h.nodes.get('totalAssetVal').textContent,'—');assert.equal(h.add.disabled,true);assert.equal(h.writes.length,0);
});

test('deleting an offsetting valuation rejects a nonfinite planned total before touching storage',async()=>{
 const h=fixture([{id:1,amount:1e308},{id:2,amount:1e308},{id:3,amount:-1e308}]);await h.session.refresh();const before=h.getRaw();assert.equal(h.session.state().ready,true);await assert.rejects(h.session.remove(2,before));assert.equal(h.getRaw(),before);assert.equal(h.writes.length,0);assert.equal(h.session.state().ready,true);
});

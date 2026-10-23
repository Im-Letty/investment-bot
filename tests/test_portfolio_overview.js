'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const api=require('../static/portfolio-overview.js');
const raw=rows=>JSON.stringify(rows);
const nodeText=n=>[n.textContent,...n.children.map(nodeText)].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
function fixture(rows=[]){let owner='A',assetsRaw=raw(rows),plannerRaw=null,readHook=null,writeHook=null,targetHook=null;const writes=[],states=[],targetWrites=[];
 const session=api.createSession({owner:()=>owner,read:async who=>{if(readHook)return readHook(who);return {assetsRaw,raw:plannerRaw};},write(who,rows){if(writeHook)return writeHook(who,rows);assert.equal(who,owner);assetsRaw=raw(rows);writes.push(assetsRaw);},writeTarget:async(who,value)=>{if(targetHook)return targetHook(who,value);assert.equal(who,owner);plannerRaw=api.targetDocument(plannerRaw,value);targetWrites.push(plannerRaw);return {ok:true,synced:true};},onChange:s=>states.push(s)});
 return {session,writes,states,targetWrites,setOwner:v=>owner=v,setRaw:v=>assetsRaw=v,setPlanner:v=>plannerRaw=v,setRead:v=>readHook=v,setWrite:v=>writeHook=v,setTargetWrite:v=>targetHook=v,getRaw:()=>assetsRaw,getPlanner:()=>plannerRaw};
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
test('two-field additions use the entered kind as name and category without invented optional facts',()=>{
 for(const [kind,text,value]of [['現金・預金','０',0],['自分で入力した種類','−１２３．４５',-123.45],['NISA','１．２５',1.25]]){
  const rows=api.updateRows('[]',null,{cat:'  '+kind+'  ',amount:text});
  assert.equal(typeof rows[0].id,'number');assert.deepEqual(Object.keys(rows[0]).sort(),['amount','cat','id','name']);
  assert.equal(rows[0].name,kind);assert.equal(rows[0].cat,kind);assert.equal(rows[0].amount,value);
 }
});
test('simple amount edits preserve sparse legacy names/categories and every optional or unknown field',()=>{
 const rows=[{id:1,name:'個別の資産名',cat:'国内株',amount:-1.25,cost:0,account:'昔の独自口座',institution:'金融機関',date:'unknown-basis',memo:'保存メモ\n',future:{keep:[1,2]}},
  {id:2,name:'',cat:'',amount:.1,cost:null,date:''},{id:3,amount:.2},{id:4,name:{future:true},cat:'  '+('長'.repeat(90))+'  ',amount:1e16}];
 const before=raw(rows);
 for(let index=0;index<rows.length;index++){
  const value=index===3?rows[index].amount:rows[index].amount+.5,next=api.updateRows(before,index,{amount:String(value)});
  assert.deepEqual(next[index],{...rows[index],amount:value});
  next.forEach((row,i)=>{if(i!==index)assert.deepEqual(row,rows[i]);});assert.equal(raw(rows),before);
 }
 const unchanged=api.updateRows(before,3,{cat:rows[3].cat,amount:'10000000000000000'});assert.deepEqual(unchanged,rows);
});
test('a changed simple kind never replaces the stored asset name or reclassifies account metadata',()=>{
 const row={id:'old-id',name:'元の銘柄名',cat:'国内株',amount:120.25,cost:100.25,account:'NISA',institution:'元の金融機関',date:'2020-01-01',extra:{untouched:true}};
 const next=api.updateRows(raw([row]),0,{cat:'  ETF  ',amount:'120.25'});
 assert.deepEqual(next,[{...row,cat:'ETF'}]);assert.equal(api.analyse(raw(next)).profit,20);
});
test('simple kind validation accepts unchanged legacy blank/long values but rejects new empty or oversized kinds',()=>{
 for(const kind of ['', ' ', '新'.repeat(81)])assert.throws(()=>api.updateRows('[]',null,{cat:kind,amount:'1'}),/種類/);
 const row={name:'既存',cat:'元の分類',amount:1};for(const kind of ['', ' ', '新'.repeat(81)])assert.throws(()=>api.updateRows(raw([row]),0,{cat:kind,amount:'1'}),/種類/);
 assert.deepEqual(api.updateRows(raw([{amount:1,cat:''}]),0,{amount:'2'}),[{amount:2,cat:''}]);
});
test('simple numeric edits reject invalid or unsafe inputs without converting them into zero',()=>{
 const row={id:1,name:'旧',cat:'国内株',amount:1,cost:0},before=raw([row]);
 for(const amount of ['', 'NaN', 'Infinity', '-Infinity', '1e309', '1e-9999', '9007199254740992']){
  assert.throws(()=>api.updateRows(before,0,{amount}));assert.equal(before,raw([row]));
 }
 assert.equal(api.updateRows(before,0,{amount:'−０．２５'})[0].amount,-.25);
});
test('simple session edits retain snapshot conflict and owner guards without writing another row or account',async()=>{
 const h=fixture([{id:1,name:'旧名',cat:'',amount:1,other:true}]);await h.session.refresh();const before=h.getRaw();
 h.setRaw(raw([{id:1,name:'別タブの変更',cat:'',amount:5,other:true}]));await assert.rejects(h.session.save(0,{amount:'2'},before),/更新/);assert.equal(h.writes.length,0);
 await h.session.refresh();const current=h.getRaw();let resolve;h.setRead(()=>new Promise(r=>resolve=r));const pending=h.session.save(0,{amount:'3'},current);
 h.setOwner('B');resolve({assetsRaw:current,raw:null});await assert.rejects(pending,/アカウント/);assert.equal(h.writes.length,0);assert.equal(h.session.state().model,null);
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
test('the single asset target overrides legacy selection and explicit clearing never revives an old goal',()=>{
 const before={version:1,goals:[{id:'old',title:'以前の目標名',target:100,deadline:'2030-01-01'}],selectedGoalId:'old'};
 assert.equal(api.goal(raw(before)).target,100);
 assert.deepEqual(api.goal(raw({...before,assetTarget:250})),{target:250});
 assert.equal(api.goal(raw({...before,assetTarget:null})),null);
 for(const assetTarget of [0,-1,'250',false,{},Number.MAX_SAFE_INTEGER+1])assert.throws(()=>api.goal(raw({...before,assetTarget})));
});
test('target amount accepts empty clearing and valid money while refusing zero negative unsafe and incomplete values',()=>{
 assert.equal(api.targetAmount('　 '),null);assert.equal(api.targetAmount('￥１，０００．５円'),1000.5);
 assert.equal(api.targetAmount('9007199254740991'),Number.MAX_SAFE_INTEGER);
 for(const text of ['0','-1','1,00','1e','Infinity','1e309','1e-400','9007199254740992'])assert.throws(()=>api.targetAmount(text),text);
});
test('a target update preserves every legacy goal note pin unknown field and unfinished draft',()=>{
 const planner=require('../static/mypage-planner.js'),d=planner.empty();
 d.goals=[{id:'old',title:'名前と期限を保持',details:'原文\n',target:100,monthly:10,deadline:'2030-01-01',extra:{old:true}}];d.selectedGoalId='old';
 d.notes=[{id:'memo',title:'ピン留め',body:'本文\n',groupId:'folder',pinned:true,richText:{version:99,future:true}}];d.groups=[{id:'folder',name:'元の分類'}];
 d.todos=[{id:'todo',text:'保存済み',done:false,goalId:'old'}];d.todoDraft={text:'追加途中',goalId:'old'};d.goalDraft={id:'old',title:'編集中',details:'保持',target:'123.',deadline:'',monthly:''};d.future={preserved:true};
 const before=raw(d),next=JSON.parse(api.targetDocument(before,1000.5,planner.decode));
 assert.equal(next.assetTarget,1000.5);delete next.assetTarget;assert.deepEqual(next,d);assert.equal(raw(d),before);
 const cleared=api.targetDocument(api.targetDocument(before,1000.5,planner.decode),null,planner.decode);assert.equal(api.goal(cleared,planner.decode),null);
 assert.equal(JSON.parse(api.targetDocument(null,1000,planner.decode)).assetTarget,1000);
 assert.throws(()=>api.targetDocument('{broken',1000));
});
test('target session writes once through its target writer and refreshes the same asset model',async()=>{
 const h=fixture([{amount:.1},{amount:.2}]);await h.session.refresh();const assets=h.getRaw();
 assert.deepEqual(await h.session.setTarget(1),{ok:true,synced:true});assert.equal(h.targetWrites.length,1);assert.equal(h.session.state().goal.target,1);assert.equal(h.session.state().model.totalText,'0.3');assert.equal(h.getRaw(),assets);assert.equal(h.writes.length,0);
 await h.session.setTarget(null);assert.equal(h.session.state().goal,null);assert.equal(JSON.parse(h.getPlanner()).assetTarget,null);
});
test('target writes stay blocked after restoration or goal-format failure',async()=>{
 const failed=fixture();failed.setRead(async()=>{throw Error('unavailable');});await failed.session.refresh();await assert.rejects(failed.session.setTarget(10));assert.equal(failed.targetWrites.length,0);
 const malformed=fixture([{amount:10}]);malformed.setPlanner('{bad');await malformed.session.refresh();assert.equal(malformed.session.state().model.total,10);await assert.rejects(malformed.session.setTarget(10),/読み込めません/);assert.equal(malformed.targetWrites.length,0);
});
test('an owner change or round trip invalidates a pending target acknowledgement',async()=>{
 for(const roundTrip of [false,true]){const h=fixture([{amount:10}]);await h.session.refresh();let resolve;h.setTargetWrite(()=>new Promise(r=>resolve=r));const pending=h.session.setTarget(20);h.setOwner('B');h.session.reset();if(roundTrip){h.setOwner('A');h.session.reset();}resolve({ok:true,synced:true});await assert.rejects(pending,/アカウント/);assert.equal(h.session.state().goal,null);}
});
function domFixture(seed=[{id:1,name:'架空の保存資産',cat:'国内株',amount:.1},{id:2,name:'架空の別資産',cat:'現金',amount:.2}]){
 const nodes=new Map(),all=[],listeners={},values=new Map([['kn_ledger_owner','A']]),writes=[],targetWrites=[];let assetRaw=raw(seed),planner=null;
 function element(tag='div',id=''){
  const attrs=new Map(),classes=new Set(),events={};const n={tagName:tag.toUpperCase(),id,value:'',textContent:'',hidden:false,disabled:false,children:[],style:{},events,options:[],
   classList:{toggle(k,on){on?classes.add(k):classes.delete(k);},add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k)},setAttribute:(k,v)=>attrs.set(k,String(v)),getAttribute:k=>attrs.get(k)??null,
   appendChild(c){n.children.push(c);c.parentNode=n;if(n.tagName==='SELECT')n.options.push(c);return c;},replaceChildren(...children){n.children=[];children.forEach(c=>n.appendChild(c));},
   querySelectorAll(selector){return all.filter(c=>selector==='[data-po-add]'?c.getAttribute('data-po-add')!==null:selector==='[data-po-custom]'?c.getAttribute('data-po-custom')!==null:false);},
   addEventListener:(name,fn)=>events[name]=fn,focus(){n.focused=true;},scrollIntoView(){},remove(){if(n.parentNode)n.parentNode.children=n.parentNode.children.filter(c=>c!==n);attrs.delete('data-po-custom');},click(){if(events.click)return events.click({target:n});}};
  all.push(n);if(id)nodes.set(id,n);return n;
 }
 const ids=['tab-assets','poEditor','poStatus','poFieldset','totalAssetVal','poProfitValue','poProfitNote','poAsOf','poGoalHero','poGoalBody','totalAssetChange','asset-legend','poAllocationStack','asset-list-el','poAllocationNote','poEditorError','poEditorTitle','poSaveButton','poCancelButton','poGoalForm','poGoalAmount','poGoalError','poGoalSave','poGoalStatus','poRetry'];ids.forEach(id=>element('div',id));nodes.get('poEditor').hidden=true;
 nodes.get('tab-assets').appendChild(nodes.get('poGoalHero'));nodes.get('poGoalHero').appendChild(nodes.get('poGoalBody'));nodes.get('poGoalHero').appendChild(nodes.get('poGoalForm'));
 const advice=element('section','kkPortfolioAdvice'),adviceControl=element('button');advice.appendChild(adviceControl);nodes.get('tab-assets').appendChild(advice);
 for(const key of ['cat','amount']){const input=element('input','ast-'+key);delete input.options;}
 const add=element('button');add.setAttribute('data-po-add','');
 const document={readyState:'complete',getElementById:id=>nodes.get(id)||null,createElement:tag=>element(tag)};
 const w={document,location:{origin:'https://portfolio.test',href:'https://portfolio.test/kakeibo'},knLedgerSession:{user:{id:'A'},access_token:'synthetic-token'},localStorage:{getItem:k=>values.get(k)??null},
  kkMyPageStore:{load:async()=>({assetsRaw:assetRaw,raw:planner}),stage(who,next){assert.equal(who,w.knLedgerSession.user.id);planner=next;targetWrites.push(next);if(listeners.knMyPageStoreChange)listeners.knMyPageStoreChange();return true;},save:async()=>true},saveAssets(rows){assetRaw=raw(rows);writes.push(assetRaw);},confirm:()=>true,addEventListener:(name,fn)=>listeners[name]=fn};w.parent=w;
 api.mount(w);
 return {w,nodes,all,add,advice,adviceControl,listeners,writes,targetWrites,getRaw:()=>assetRaw,getPlanner:()=>planner,setPlanner:r=>planner=r,async flush(){for(let i=0;i<20;i++)await Promise.resolve();},
  owner(id){values.set('kn_ledger_owner',id);w.knLedgerSession={user:{id},access_token:'synthetic-'+id};},
  input(key,value){const n=nodes.get('ast-'+key);n.value=value;nodes.get('poEditor').events.input({target:n});},target(value){const n=nodes.get('poGoalAmount');n.value=value;n.events.input({target:n});},saveTarget(){return nodes.get('poGoalForm').events.submit({preventDefault(){}});},
  dispatch(name,event={}){return listeners[name]&&listeners[name](event);}};
}
test('actual DOM handlers show the exact model, submit once, preserve untouched metadata and retain empty optional fields',async()=>{
 const h=domFixture();await h.flush();assert.equal(h.nodes.get('totalAssetVal').textContent,'0.3円');assert.equal(h.nodes.get('poAllocationStack').children.length,2);assert.equal(h.nodes.get('asset-legend').children[0].children[1].textContent,'0.1円');h.add.click();assert.equal(h.nodes.get('ast-cat').value,'');h.input('cat','現金・預金');h.input('amount','１．５');let prevented=false;
 h.nodes.get('poEditor').events.submit({preventDefault(){prevented=true;}});await h.flush();assert.equal(prevented,true);assert.equal(h.writes.length,1);assert.equal(h.nodes.get('poEditor').hidden,true);assert.equal(h.nodes.get('totalAssetVal').textContent,'1.8円');
 const saved=JSON.parse(h.getRaw()).at(-1);assert.deepEqual(Object.keys(saved).sort(),['amount','cat','id','name']);assert.equal(saved.amount,1.5);assert.equal(saved.name,'現金・預金');assert.equal(saved.cat,'現金・預金');
});
test('same-owner token refresh and ordinary rerender keep unfinished editor fields; a confirmed account change scrubs them',async()=>{
 const h=domFixture();await h.flush();h.add.click();h.input('cat','未保存の私的な下書き');h.input('amount','１２３．４５');
 h.dispatch('storage',{key:'sb-auth-token'});h.dispatch('knLedgerAuth');await h.flush();assert.equal(h.nodes.get('poEditor').hidden,false);assert.equal(h.nodes.get('ast-cat').value,'未保存の私的な下書き');assert.equal(h.nodes.get('ast-amount').value,'１２３．４５');assert.equal(h.writes.length,0);
 h.owner('B');h.dispatch('knLedgerAuth');assert.equal(h.nodes.get('poEditor').hidden,true);for(const k of ['cat','amount'])assert.equal(h.nodes.get('ast-'+k).value,'');assert.equal(h.nodes.get('totalAssetChange').textContent,'');
});
test('DOM asset edit and cancel keep stored signed valuations and unknown properties intact',async()=>{
 const h=domFixture([{id:1,name:'架空',cat:'国内株',amount:-1.25,extra:{keep:true},date:'unknown-basis'}]);await h.flush();const before=h.getRaw(),edit=h.nodes.get('asset-list-el').children[0].children[0];edit.click();h.input('cat','編集下書き');h.nodes.get('poCancelButton').click();assert.equal(h.getRaw(),before);assert.equal(h.writes.length,0);
 edit.click();h.input('cat','その他');h.nodes.get('poEditor').events.submit({preventDefault(){}});await h.flush();assert.equal(h.writes.length,1);assert.deepEqual(JSON.parse(h.getRaw())[0],{id:1,name:'架空',cat:'その他',amount:-1.25,extra:{keep:true},date:'unknown-basis'});
});
test('the two actual input handlers edit legacy amounts without supplying removed metadata or names',async()=>{
 const rows=[{id:1,name:'元の名称',cat:'',amount:1.25,cost:0,account:'独自口座',institution:'旧機関',date:'無効な旧日付',note:'本文',unknown:[1,2]},
  {id:2,cat:'旧'.repeat(90),amount:1e16,cost:null},{id:3,amount:-.25,extra:{keep:true}}];
 for(let index=0;index<rows.length;index++){
  const h=domFixture(rows);await h.flush();const edit=h.nodes.get('asset-list-el').children[index].children[0];edit.click();
  assert.equal(h.nodes.get('ast-cat').tagName,'INPUT');assert.equal(h.nodes.get('ast-name'),undefined);assert.equal(h.nodes.get('ast-cost'),undefined);
  const amount=index===1?'10000000000000000':index===0?'−２．５':'０';h.input('amount',amount);await h.w.kkPortfolioSaveAsset();await h.flush();
  const next=JSON.parse(h.getRaw()),expected=index===1?1e16:index===0?-2.5:0;assert.equal(h.writes.length,1);
  assert.deepEqual(next[index],{...rows[index],amount:expected});next.forEach((row,i)=>{if(i!==index)assert.deepEqual(row,rows[i]);});
 }
});
test('DOM fieldset stays disabled and no saved values are fabricated if restoration fails',async()=>{
 const h=domFixture();h.w.kkMyPageStore.load=async()=>{throw Error('restore');};h.dispatch('knLedgerAuth');await h.flush();assert.equal(h.nodes.get('poFieldset').disabled,true);assert.equal(h.nodes.get('totalAssetVal').textContent,'—');assert.equal(h.add.disabled,true);assert.equal(h.writes.length,0);
});

test('deleting an offsetting valuation rejects a nonfinite planned total before touching storage',async()=>{
 const h=fixture([{id:1,amount:1e308},{id:2,amount:1e308},{id:3,amount:-1e308}]);await h.session.refresh();const before=h.getRaw();assert.equal(h.session.state().ready,true);await assert.rejects(h.session.remove(2,before));assert.equal(h.getRaw(),before);assert.equal(h.writes.length,0);assert.equal(h.session.state().ready,true);
});

test('DOM save errors keep the draft and show fixed Japanese copy while known field validation stays specific',async()=>{
 const h=domFixture();await h.flush();const before=h.getRaw();h.add.click();h.input('cat','保存前の下書き');h.input('amount','１．５');
 h.w.saveAssets=()=>{throw Error('QuotaExceededError internal storage detail');};h.nodes.get('poEditor').events.submit({preventDefault(){}});await h.flush();
 assert.equal(h.nodes.get('poEditor').hidden,false);assert.equal(h.nodes.get('ast-cat').value,'保存前の下書き');assert.equal(h.nodes.get('ast-amount').value,'１．５');assert.equal(h.getRaw(),before);
 assert.equal(h.nodes.get('poEditorError').textContent,'保存できませんでした。入力内容は残しています。もう一度お試しください。');assert.doesNotMatch(h.nodes.get('poEditorError').textContent,/Quota|internal|storage/);
 h.input('cat','');h.nodes.get('poEditor').events.submit({preventDefault(){}});await h.flush();assert.equal(h.nodes.get('poEditorError').textContent,'資産の種類を80文字以内で入力してください。');assert.equal(h.getRaw(),before);
});
test('DOM target shows the same exact current total as the hero plus percentage and remaining amount without legacy metadata',async()=>{
 const h=domFixture([{amount:1.5},{amount:2.5}]);await h.flush();h.setPlanner(raw({version:1,goals:[{id:'old',title:'表示しない旧目標名',target:10,deadline:'2030-01-01'}],selectedGoalId:'old'}));await h.w.kkPortfolioRender();
 const body=h.nodes.get('poGoalBody'),text=nodeText(body);
 assert.equal(h.nodes.get('totalAssetVal').textContent,'4円');assert.match(text,/現在 4円/);assert.match(text,/40%/);assert.match(text,/目標 10円/);assert.match(text,/目標まであと 6円/);assert.doesNotMatch(text,/旧目標名|2030/);assert.equal(h.nodes.get('poGoalAmount').value,'10');
 const track=body.children.find(n=>n.getAttribute('role')==='progressbar');assert.equal(track.getAttribute('aria-valuenow'),'40');assert.equal(track.getAttribute('aria-valuetext'),'40%');
 assert.match(nodeText(body.children[0]),/^目標まであと 6円$/);assert.equal(body.children[1].textContent,'達成率 40%');
 h.setPlanner(raw({version:1,goals:[],assetTarget:2}));await h.w.kkPortfolioRender();assert.match(nodeText(body.children[0]),/^目標を上回った金額 2円$/);assert.match(nodeText(body),/200%/);assert.equal(body.children.find(n=>n.getAttribute('role')==='progressbar').getAttribute('aria-valuenow'),'100');
});
test('an empty restored asset list is zero progress and an exact target match shows progress without an achievement message',async()=>{
 const empty=domFixture([]);await empty.flush();empty.setPlanner(raw({version:1,goals:[],assetTarget:10}));await empty.w.kkPortfolioRender();const body=empty.nodes.get('poGoalBody');
 assert.equal(empty.nodes.get('totalAssetVal').textContent,'0円');assert.match(nodeText(body),/目標まであと 10円.*0%.*現在 0円.*目標 10円/);
 const exact=domFixture([{amount:.1},{amount:.2}]);await exact.flush();exact.setPlanner(raw({version:1,goals:[],assetTarget:.3}));await exact.w.kkPortfolioRender();const achieved=exact.nodes.get('poGoalBody');assert.match(nodeText(achieved),/達成率 100%.*現在 0.3円.*目標 0.3円/);assert.doesNotMatch(nodeText(achieved),/目標額に到達/);assert.equal(achieved.children[0].className,'po-goal-rate');assert.equal(achieved.children.find(n=>n.getAttribute('role')==='progressbar').getAttribute('aria-valuenow'),'100');
});
test('DOM target saves only on submit through the existing bridge and blank clears legacy fallback',async()=>{
 const h=domFixture();await h.flush();const planner=require('../static/mypage-planner.js'),d=planner.empty();d.notes=[{id:'p',title:'保持',body:'本文',groupId:'',pinned:true}];d.goals=[{id:'old',title:'保持',details:'詳細',target:100,monthly:null,deadline:''}];d.selectedGoalId='old';d.extra={keep:true};h.setPlanner(raw(d));await h.w.kkPortfolioRender();
 h.target('１，０００．５');assert.equal(h.targetWrites.length,0);await h.saveTarget();await h.flush();assert.equal(h.targetWrites.length,1);const next=JSON.parse(h.getPlanner());assert.equal(next.assetTarget,1000.5);delete next.assetTarget;assert.deepEqual(next,d);assert.equal(h.writes.length,0);assert.equal(h.nodes.get('poGoalStatus').textContent,'保存しました。');
 h.target('');await h.saveTarget();await h.flush();assert.equal(JSON.parse(h.getPlanner()).assetTarget,null);assert.equal(h.nodes.get('poGoalAmount').value,'');assert.doesNotMatch(h.nodes.get('poGoalBody').children.map(n=>n.textContent).join('|'),/100円/);
});
test('same-owner refresh keeps an unfinished target while account change clears the input errors and prior acknowledgement',async()=>{
 const h=domFixture();await h.flush();h.target('１２３．');h.dispatch('knLedgerAuth');await h.flush();assert.equal(h.nodes.get('poGoalAmount').value,'１２３．');assert.equal(h.targetWrites.length,0);
 h.setPlanner(null);h.owner('B');h.dispatch('knLedgerAuth');await h.flush();assert.equal(h.nodes.get('poGoalAmount').value,'');assert.equal(h.nodes.get('poGoalError').textContent,'');assert.equal(h.nodes.get('poGoalStatus').textContent,'');assert.equal(h.targetWrites.length,0);
});
test('target validation storage failure and unavailable restore retain the typed amount without leaking internal errors',async()=>{
 const h=domFixture();await h.flush();h.target('0');await h.saveTarget();assert.match(h.nodes.get('poGoalError').textContent,/0円より大きい/);assert.equal(h.targetWrites.length,0);
 h.target('１２３．５');h.w.kkMyPageStore.stage=()=>{throw Error('synthetic secret storage URL');};await h.saveTarget();await h.flush();assert.equal(h.nodes.get('poGoalAmount').value,'１２３．５');assert.equal(h.nodes.get('poGoalError').textContent,'保存できませんでした。入力内容は残しています。もう一度お試しください。');assert.equal(h.targetWrites.length,0);
 h.w.kkMyPageStore.load=async()=>{throw Error('restore');};h.dispatch('knLedgerAuth');await h.flush();assert.equal(h.nodes.get('poGoalAmount').value,'１２３．５');assert.equal(h.nodes.get('poGoalAmount').disabled,true);assert.equal(h.nodes.get('poGoalSave').disabled,true);assert.equal(await h.saveTarget(),false);assert.equal(h.targetWrites.length,0);
});
test('embedded target submit delegates to the current parent controller and preserves input after rejected save',async()=>{
 const h=domFixture();await h.flush();const calls=[];h.w.parent={location:h.w.location,knUser:{id:'A'},KNMyPagePlanner:require('../static/mypage-planner.js'),async knSetPortfolioAssetTarget(source,who,value){calls.push({source,who,value});return {ok:false,error:'目標を保存できませんでした。入力内容は残しています。もう一度お試しください。'};}};
 h.target('250');await h.saveTarget();assert.equal(calls.length,1);assert.equal(calls[0].source,h.w);assert.equal(calls[0].who,'A');assert.equal(calls[0].value,250);assert.equal(h.targetWrites.length,0);assert.equal(h.nodes.get('poGoalAmount').value,'250');assert.match(h.nodes.get('poGoalError').textContent,/目標を保存できません/);
});
test('a staged local target awaiting sync is described honestly and repeated submit cannot start duplicate saves',async()=>{
 const h=domFixture();await h.flush();let resolve;h.w.kkMyPageStore.save=()=>new Promise(r=>resolve=r);h.target('250');const saving=h.saveTarget();await h.flush();assert.equal(h.targetWrites.length,1);assert.equal(h.nodes.get('poGoalSave').disabled,true);assert.equal(await h.saveTarget(),false);resolve(false);await saving;await h.flush();assert.equal(h.targetWrites.length,1);assert.equal(h.nodes.get('poGoalStatus').textContent,'この端末に保存しました。同期を待っています…');assert.equal(h.nodes.get('poGoalAmount').value,'250');
});
test('goal-first markup keeps one editable target and the existing independently mounted advice',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../kakeibo.html'),'utf8'),pane=html.slice(html.indexOf('id="tab-assets"'),html.indexOf('id="tab-records"'));
 assert.ok(pane.indexOf('id="poGoalHero"')<pane.indexOf('id="kkAssetTotalLabel"'));
 assert.ok(pane.indexOf('id="poGoalBody"')<pane.indexOf('id="poGoalForm"'));
 assert.equal((pane.match(/id="poGoalAmount"/g)||[]).length,1);
 assert.equal((pane.match(/<input[^>]+>/g)||[]).filter(s=>/id="poGoal/.test(s)).length,1);
 assert.match(html,/<script defer src="\/static\/portfolio-advice\.js\?v=20261018-advice1"><\/script>/);
 assert.match(html,/<link rel="stylesheet" href="\/static\/portfolio-advice\.css\?v=20261018-advice1">/);
});
test('prominent remaining and excess values keep signed totals and exact fractional differences',async()=>{
 for(const [rows,target,label,current] of [
  [[{amount:-1.25}],10,'目標まであと 11.25円','現在 -1.25円'],
  [[{amount:.1},{amount:.2}],1,'目標まであと 0.7円','現在 0.3円'],
  [[{amount:.1},{amount:.2}],.1,'目標を上回った金額 0.2円','現在 0.3円'],
  [[{amount:999999.99}],1000000,'目標まであと 0.01円','現在 999,999.99円']
 ]){
  const h=domFixture(rows);await h.flush();h.setPlanner(raw({version:1,goals:[],assetTarget:target}));await h.w.kkPortfolioRender();const body=h.nodes.get('poGoalBody');
  assert.equal(nodeText(body.children[0]),label);assert.match(nodeText(body),new RegExp(current.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.equal(body.children[0].children[1].className,'po-goal-amount');
  if(rows[0].amount<0)assert.equal(body.children.find(n=>n.getAttribute('role')==='progressbar').getAttribute('aria-valuenow'),'0');
  if(target===1000000)assert.match(nodeText(body),/達成率 99.9%/);
  assert.equal(h.writes.length,0);assert.equal(h.targetWrites.length,0);
 }
});
test('readiness and account transitions clear all prominent goal numbers before another owner restores',async()=>{
 const h=domFixture([{amount:4321.25}]);await h.flush();h.setPlanner(raw({version:1,goals:[],assetTarget:9876.5}));await h.w.kkPortfolioRender();assert.match(nodeText(h.nodes.get('poGoalBody')),/5,555.25円/);
 let restore;h.w.kkMyPageStore.load=()=>new Promise(resolve=>restore=resolve);h.owner('B');h.dispatch('knLedgerAuth');
 assert.equal(h.nodes.get('tab-assets').getAttribute('data-po-ready'),'false');assert.equal(nodeText(h.nodes.get('poGoalBody')),'');assert.equal(h.nodes.get('poGoalAmount').value,'');assert.equal(h.nodes.get('poGoalSave').disabled,true);
 restore({assetsRaw:raw([{amount:7}]),raw:raw({version:1,goals:[],assetTarget:20})});await h.flush();assert.equal(nodeText(h.nodes.get('poGoalBody').children[0]),'目標まであと 13円');assert.doesNotMatch(nodeText(h.nodes.get('poGoalBody')),/4,321|9,876|5,555/);
 h.w.kkMyPageStore.load=async()=>{throw Error('synthetic restore failure');};h.dispatch('knLedgerAuth');await h.flush();assert.equal(nodeText(h.nodes.get('poGoalBody')),'');assert.equal(h.nodes.get('poGoalSave').disabled,true);
});
test('overview redraws and target saves preserve the mounted advice node and its controls without running them',async()=>{
 const h=domFixture();let clicks=0;h.adviceControl.addEventListener('click',()=>clicks++);await h.flush();
 h.target('10');await h.saveTarget();h.add.click();h.input('cat','保存しない下書き');h.nodes.get('poCancelButton').click();h.dispatch('knMyPageStoreChange');await h.flush();
 assert.equal(h.nodes.get('tab-assets').children.at(-1),h.advice);assert.equal(h.advice.children[0],h.adviceControl);assert.equal(clicks,0);assert.equal(h.writes.length,0);
 h.adviceControl.click();assert.equal(clicks,1);
});

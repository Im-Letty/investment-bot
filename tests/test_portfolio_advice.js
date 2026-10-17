'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const api=require('../static/portfolio-advice.js');

const defaults={monthly_expense:null,horizon:'unknown',loss_tolerance:'unknown'};
const context=extra=>({...defaults,...extra});
const encode=rows=>JSON.stringify(rows);
const group=(facts,key)=>facts.groups.find(row=>row.key===key);
const validAdvice=()=>({summary:'登録額にもとづく架空の分析です。',risks:[{title:'記録の偏り',detail:'本人が入力した資産区分を確認してください。'}],actions:['支出と保有期間を確認する'],questions:[]});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const settle=()=>new Promise(done=>setImmediate(done));

test('absent and explicitly empty assets stay distinct from registered zero amounts',()=>{
  for(const raw of [null,'[]']){
    const result=api.analyse(raw,context());
    assert.equal(result.total,0);assert.equal(result.count,0);assert.equal(result.negative,false);
    assert.deepEqual(result.groups,[]);assert.equal(result.cash,0);
    assert.equal(result.monthsOfExpenses,null);assert.equal(result.largestEntryPercent,null);
  }
  const zero=api.analyse('[{"amount":0,"cat":"現金"}]',context());
  assert.equal(zero.count,1);assert.equal(zero.total,0);
});

test('decimal totals preserve fractional yen and valid large amounts without binary addition artifacts',()=>{
  const small=api.analyse(encode([{amount:0.1,cat:'現金'},{amount:0.2,cat:'現金・預金'}]),context());
  assert.equal(small.total,0.3);assert.equal(small.cash,0.3);assert.equal(group(small,'cash').amount,0.3);
  const tiny=api.analyse(encode([{amount:1e-7,cat:'ETF'},{amount:2e-7,cat:'ETF'}]),context());
  assert.equal(tiny.total,3e-7);assert.equal(group(tiny,'etf').amount,3e-7);
  assert.equal(api.analyse('[{"amount":999999999999999.5,"cat":"現金"}]',context()).total,999999999999999.5);
});

test('canonical asset categories and the two documented cash labels aggregate by stable keys',()=>{
  const labels=['現金','現金・預金','国内株','米国株','投資信託','ETF','債券','不動産','仮想通貨','その他'];
  const result=api.analyse(encode(labels.map(cat=>({amount:10,cat}))),context());
  assert.equal(result.count,10);assert.equal(result.total,100);assert.equal(result.cash,20);
  assert.deepEqual(new Set(result.groups.map(row=>row.key)),new Set(['cash','domestic_stock','us_stock','mutual_fund','etf','bond','real_estate','crypto','other']));
  assert.equal(group(result,'cash').amount,20);
  assert.ok(result.groups.every(row=>typeof row.label==='string'&&row.label.length>0));
});

test('freeform names, identifiers and unknown categories do not enter returned analysis',()=>{
  const secret='個人の口座・銘柄・独自カテゴリ <svg onload=private()>';
  const result=api.analyse(encode([
    {id:secret,name:secret,cat:secret,amount:1.25,private_note:secret},
    {id:'__proto__',name:secret,cat:'__proto__',amount:2.75},
    {name:secret,cat:'その他',amount:3}
  ]),context());
  assert.equal(result.count,3);assert.equal(result.groups.length,1);
  assert.equal(group(result,'other').amount,7);
  assert.doesNotMatch(JSON.stringify(result),/個人の口座|private\(|__proto__|private_note/);
});

test('recorded negative valuations remain in totals and suppress all allocation and runway ratios',()=>{
  const result=api.analyse(encode([{amount:500,cat:'現金'},{amount:-125.5,cat:'国内株'}]),context({monthly_expense:100}));
  assert.equal(result.total,374.5);assert.equal(result.cash,500);assert.equal(result.negative,true);
  assert.equal(group(result,'domestic_stock').amount,-125.5);
  assert.ok(result.groups.every(row=>row.percent===null));
  assert.equal(result.largestEntryPercent,null);assert.equal(result.monthsOfExpenses,null);
});

test('zero and offsetting portfolios never invent percentages or divide by zero',()=>{
  for(const rows of [[{amount:0,cat:'現金'},{amount:0,cat:'ETF'}],[{amount:100,cat:'現金'},{amount:-100,cat:'ETF'}]]){
    const result=api.analyse(encode(rows),context({monthly_expense:50}));
    assert.equal(result.total,0);assert.ok(result.groups.every(row=>row.percent===null));
    assert.equal(result.largestEntryPercent,null);assert.equal(result.monthsOfExpenses,null);
    assert.doesNotMatch(JSON.stringify(result),/NaN|Infinity/);
  }
});

test('cash runway and single-entry concentration use the stated denominator and zero expense remains unknown',()=>{
  const raw=encode([{amount:25,cat:'現金'},{amount:100,cat:'現金・預金'},{amount:100,cat:'国内株'},{amount:175,cat:'国内株'}]);
  const result=api.analyse(raw,context({monthly_expense:50}));
  assert.equal(result.total,400);assert.equal(result.cash,125);assert.equal(result.monthsOfExpenses,2.5);
  assert.equal(group(result,'cash').percent,31.25);assert.equal(group(result,'domestic_stock').percent,68.75);
  assert.equal(result.largestEntryPercent,43.75);
  assert.equal(api.analyse(raw,context()).monthsOfExpenses,null);
  assert.equal(api.analyse(raw,context({monthly_expense:0})).monthsOfExpenses,null);
});

test('malformed and non-array source data reject rather than masquerading as an empty portfolio',()=>{
  for(const raw of ['', '{', 'null', 'false', '{}', '0', '"[]"', undefined, false, 0, [], ['[]'], {}, {toString(){return '[]';}}])
    assert.throws(()=>api.analyse(raw,context()),undefined,String(raw));
});

test('invalid amount rows reject the whole snapshot without dropping an otherwise valid row',()=>{
  for(const bad of ['null','true','false','{}','[]','{"amount":"12"}','{"amount":true}','{"amount":false}','{"amount":null}','{"cat":"現金"}','{"amount":1e309}','{"amount":NaN}']){
    assert.throws(()=>api.analyse('[{"amount":25,"cat":"現金"},'+bad+']',context()),undefined,bad);
  }
  assert.throws(()=>api.analyse('[{"amount":1e308,"cat":"現金"},{"amount":1e308,"cat":"ETF"}]',context()));
});

test('provider output must follow the bounded text-only advice schema without additional fields or a score',()=>{
  const input=validAdvice(),clean=api.validResult(input);assert.deepEqual(clean,input);assert.notEqual(clean,input);
  clean.actions.push('caller change');assert.equal(input.actions.length,1);
  const boundary={summary:'s'.repeat(400),risks:Array.from({length:3},()=>({title:'t'.repeat(80),detail:'d'.repeat(300)})),actions:Array(3).fill('a'.repeat(300)),questions:Array(3).fill('q'.repeat(300))};
  assert.deepEqual(api.validResult(boundary),boundary);
  const invalid=[
    null,[],{...input,score:100},{...input,summary:''},{...input,summary:'x'.repeat(401)},
    {...input,risks:[]},{...input,risks:Array(4).fill(input.risks[0])},
    {...input,risks:[{title:'risk',detail:'detail',private_note:'not allowed'}]},
    {...input,risks:[{title:'x'.repeat(81),detail:'detail'}]},
    {...input,risks:[{title:'risk',detail:'x'.repeat(301)}]},
    {...input,actions:[]},{...input,actions:[true]},{...input,actions:['x'.repeat(301)]},
    {...input,actions:Array(4).fill('action')},{...input,questions:['x'.repeat(301)]},{...input,questions:Array(4).fill('question')}
  ];
  for(const value of invalid)assert.throws(()=>api.validResult(value));
});

test('context defaults are explicit while invalid expenses, enum values and extra fields are rejected',()=>{
  assert.deepEqual(api.normaliseContext(),defaults);assert.deepEqual(api.normaliseContext(null),defaults);
  assert.deepEqual(api.normaliseContext({horizon:'3_10'}),context({horizon:'3_10'}));
  assert.equal(api.normaliseContext({monthly_expense:0}).monthly_expense,0);
  assert.equal(api.normaliseContext({monthly_expense:null}).monthly_expense,null);
  for(const horizon of ['unknown','under_3','3_10','over_10'])
    for(const loss_tolerance of ['unknown','low','medium','high'])
      assert.deepEqual(api.normaliseContext({monthly_expense:123.45,horizon,loss_tolerance}),{monthly_expense:123.45,horizon,loss_tolerance});
  for(const bad of [false,0,'',[],{monthly_expense:'100'},{monthly_expense:true},{monthly_expense:-1},{monthly_expense:NaN},{monthly_expense:Infinity},{horizon:'soon'},{horizon:null},{loss_tolerance:'maximum'},{loss_tolerance:null},{private_note:'do not transfer'}])
    assert.throws(()=>api.normaliseContext(bad),undefined,JSON.stringify(bad));
});

test('normalisation and repeated analysis do not mutate supplied context or share mutable aggregate results',()=>{
  const input=Object.freeze(context({monthly_expense:50,horizon:'over_10',loss_tolerance:'medium'}));
  const before=JSON.stringify(input),normalised=api.normaliseContext(input);
  assert.notEqual(normalised,input);assert.deepEqual(normalised,input);
  const raw='[{"amount":0.1,"cat":"現金"},{"amount":0.2,"cat":"現金"}]';
  const first=api.analyse(raw,input);first.groups[0].amount=999;first.groups.push({key:'injected'});
  const second=api.analyse(raw,input);
  assert.equal(second.total,0.3);assert.equal(second.groups.length,1);assert.equal(second.groups[0].amount,0.3);
  assert.equal(JSON.stringify(input),before);
});

function sessionFixture(){
  let owner='owner-A',raw='[{"amount":100,"cat":"現金","name":"私的な名前"}]',ready=true;
  const requests=[],changes=[];
  let responder=async()=>({ok:true,data:validAdvice()});
  let reader=async expected=>{assert.equal(expected,owner);return raw;};
  let statusReader=async()=>({ok:true,ready});
  let digester=async value=>createHash('sha256').update(value).digest('hex');
  const session=api.createSession({
    owner:()=>owner,
    read:expected=>reader(expected),
    status:()=>statusReader(),
    digest:value=>digester(value),
    request:async payload=>{requests.push(payload);return responder(payload);},
    onChange:state=>changes.push(state)
  });
  return {session,requests,changes,setOwner:value=>{owner=value;},setRaw:value=>{raw=value;},setReady:value=>{ready=value;},respondWith:fn=>{responder=fn;},readWith:fn=>{reader=fn;},statusWith:fn=>{statusReader=fn;},digestWith:fn=>{digester=fn;}};
}

test('session refresh and profile edits do not call AI and execution requires consent, readiness and valid assets',async()=>{
  const h=sessionFixture();await h.session.refresh();
  assert.equal(h.session.getState().ready,true);assert.equal(h.requests.length,0);
  h.session.setContext({monthly_expense:25,horizon:'over_10',loss_tolerance:'low'});
  assert.equal(h.requests.length,0);assert.equal(await h.session.run(false),false);assert.equal(h.requests.length,0);
  const unavailable=sessionFixture();unavailable.setReady(false);await unavailable.session.refresh();
  assert.equal(unavailable.session.getState().ready,false);assert.equal(await unavailable.session.run(true),false);assert.equal(unavailable.requests.length,0);unavailable.session.destroy();
  h.setRaw('[]');await h.session.refresh();assert.equal(await h.session.run(true),false);assert.equal(h.requests.length,0);
  h.setRaw('[{"amount":100,"cat":"現金"},{"amount":-1,"cat":"ETF"}]');await h.session.refresh();assert.equal(await h.session.run(true),false);assert.equal(h.requests.length,0);
  const raw='[{"amount":100,"cat":"現金","name":"私的な名前"}]';h.setRaw(raw);await h.session.refresh();
  assert.equal(await h.session.run(true),true);assert.equal(h.requests.length,1);
  assert.deepEqual(h.requests[0],{lang:'ja',consent:true,expected_assets_sha256:createHash('sha256').update(raw).digest('hex'),context:context({monthly_expense:25,horizon:'over_10',loss_tolerance:'low'})});
  assert.doesNotMatch(JSON.stringify(h.requests),/私的な名前|owner-A|amount|現金/);
  assert.deepEqual(h.session.getState().result,validAdvice());h.session.destroy();
});

test('context and asset changes invalidate advice while an unchanged refresh preserves a running analysis',async()=>{
  const h=sessionFixture();await h.session.refresh();
  const pending=deferred();h.respondWith(()=>pending.promise);
  const running=h.session.run(true);await settle();assert.equal(h.requests.length,1);
  h.session.setContext({monthly_expense:20});
  pending.resolve({ok:true,data:validAdvice()});assert.equal(await running,false);
  assert.equal(h.session.getState().result,null);assert.equal(h.requests.length,1);
  const unchanged=deferred();h.respondWith(()=>unchanged.promise);const secondRun=h.session.run(true);await settle();
  await h.session.refresh();unchanged.resolve({ok:true,data:validAdvice()});
  assert.equal(await secondRun,true,'an unchanged refresh must retain a running analysis for the same owner and snapshot');
  h.setRaw('[{"amount":150,"cat":"現金"}]');await h.session.refresh();
  const state=h.session.getState();assert.equal(state.facts.total,150);assert.equal(state.result,null);assert.equal(state.stale,true);
  assert.equal(h.requests.length,2);h.session.destroy();
});

test('an owner change and destruction discard a previous owner response and reset private profile state',async()=>{
  const h=sessionFixture();await h.session.refresh();
  h.session.setContext({monthly_expense:33,horizon:'under_3',loss_tolerance:'high'});
  const pending=deferred();h.respondWith(()=>pending.promise);
  const running=h.session.run(true);await settle();
  h.setOwner('owner-B');h.setRaw('[{"amount":7.5,"cat":"ETF"}]');await h.session.refresh();
  assert.deepEqual(h.session.getState().context,defaults);assert.equal(h.session.getState().facts.total,7.5);assert.equal(h.session.getState().result,null);
  pending.resolve({ok:true,data:validAdvice()});assert.equal(await running,false);assert.equal(h.session.getState().result,null);
  const count=h.requests.length;h.session.destroy();
  assert.equal(await h.session.run(true),false);assert.equal(h.requests.length,count);assert.equal(h.session.getState().result,null);
});

test('an owner change emits cleared facts, profile and advice before the new owner read completes',async()=>{
  const h=sessionFixture();await h.session.refresh();h.session.setContext({monthly_expense:44,horizon:'under_3',loss_tolerance:'high'});
  assert.equal(await h.session.run(true),true);
  const pending=deferred();h.setOwner('owner-B');h.readWith(()=>pending.promise);
  const refresh=h.session.refresh(),visible=h.changes.at(-1);
  assert.equal(visible.facts,null);assert.equal(visible.result,null);assert.deepEqual(visible.context,defaults);assert.equal(visible.ready,false);
  assert.equal(h.session.getState().facts,null);
  pending.resolve('[{"amount":7.5,"cat":"ETF"}]');assert.equal(await refresh,true);
  assert.equal(h.session.getState().facts.total,7.5);h.session.destroy();
});

test('an AI status failure keeps confirmed local facts and a later refresh can retry readiness',async()=>{
  const h=sessionFixture();let checks=0;
  h.statusWith(async()=>{if(++checks===1)throw Error('mock status unavailable');return {ok:true,ready:true};});
  assert.equal(await h.session.refresh(),true);
  assert.equal(h.session.getState().facts.total,100);assert.equal(h.session.getState().ready,false);assert.equal(h.session.getState().error,'');
  assert.equal(await h.session.refresh(),true);
  assert.equal(checks,2);assert.equal(h.session.getState().facts.total,100);assert.equal(h.session.getState().ready,true);assert.equal(h.requests.length,0);h.session.destroy();
});

test('a failed asset read clears readiness and successful recovery verifies readiness again',async()=>{
  const h=sessionFixture();let checks=0;h.statusWith(async()=>{checks++;return {ok:true,ready:true};});
  await h.session.refresh();assert.equal(checks,1);assert.equal(h.session.getState().ready,true);
  h.readWith(async()=>{throw Error('mock unreadable record');});assert.equal(await h.session.refresh(),false);
  assert.equal(h.session.getState().facts,null);assert.equal(h.session.getState().ready,false);assert.equal(h.session.getState().error,'records_unavailable');
  h.readWith(async()=>'[{"amount":150,"cat":"現金"}]');assert.equal(await h.session.refresh(),true);
  assert.equal(checks,2);assert.equal(h.session.getState().facts.total,150);assert.equal(h.session.getState().ready,true);assert.equal(h.session.getState().error,'');h.session.destroy();
});

test('missed asset notifications cannot submit an old snapshot or display a response for changed assets',async()=>{
  const h=sessionFixture();await h.session.refresh();const hashing=deferred();h.digestWith(()=>hashing.promise);
  const beforeSend=h.session.run(true);await settle();h.setRaw('[{"amount":150,"cat":"現金"}]');
  hashing.resolve('a'.repeat(64));assert.equal(await beforeSend,false);assert.equal(h.requests.length,0);assert.equal(h.session.getState().facts.total,150);
  h.digestWith(async value=>createHash('sha256').update(value).digest('hex'));
  const pending=deferred();h.respondWith(()=>pending.promise);const afterSend=h.session.run(true);await settle();assert.equal(h.requests.length,1);
  h.setRaw('[{"amount":200,"cat":"現金"}]');pending.resolve({ok:true,data:validAdvice()});assert.equal(await afterSend,false);
  assert.equal(h.session.getState().facts.total,200);assert.equal(h.session.getState().result,null);assert.equal(h.session.getState().stale,true);assert.equal(h.requests.length,1);h.session.destroy();
});

test('cancel followed by a valid context edit keeps the stale notice until a new explicit run',async()=>{
  const h=sessionFixture();await h.session.refresh();assert.equal(await h.session.run(true),true);
  h.session.cancel();assert.equal(h.session.getState().stale,true);assert.equal(h.session.getState().result,null);
  h.session.setContext({monthly_expense:40});assert.equal(h.session.getState().stale,true);assert.equal(h.session.getState().result,null);assert.equal(h.requests.length,1);
  assert.equal(await h.session.run(true),true);assert.equal(h.session.getState().stale,false);assert.equal(h.requests.length,2);h.session.destroy();
});

test('the supported 5000-row portfolio boundary rejects an oversized snapshot atomically',()=>{
  const rows=Array.from({length:5000},()=>({amount:1,cat:'現金'}));
  const supported=api.analyse(encode(rows),context());assert.equal(supported.count,5000);assert.equal(supported.total,5000);
  rows.push({amount:1,cat:'ETF'});assert.throws(()=>api.analyse(encode(rows),context()));
});


test('monthly expense input preserves fractional and full-width values and rejects malformed grouping',()=>{
  assert.equal(api.parseMonthlyExpense(''),null);
  assert.equal(api.parseMonthlyExpense('  ０  '),0);
  assert.equal(api.parseMonthlyExpense('１５０，０００．２５'),150000.25);
  assert.equal(api.parseMonthlyExpense('1,234,567.5'),1234567.5);
  for(const raw of ['1,2','12,34','1,,000','-1','1e3','NaN','Infinity','150000円','9007199254740992'])
    assert.throws(()=>api.parseMonthlyExpense(raw),undefined,raw);
});

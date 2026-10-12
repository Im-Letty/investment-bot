const {test}=require('node:test');
const assert=require('node:assert/strict');
const dates=require('../static/date-display.js');
const profile=require('../static/company-profile.js');
const NOW=Date.parse('2026-09-24T06:00:00Z'),KEY='7203.T',PREFIX='kn_company_profile_v1:';
const IDENTITY={market:'プライム（内国株式）',industry:'輸送用機器',source_url:'https://www.jpx.co.jp/markets/statistics-equities/misc/01.html',date:'2026-09-23',source_title:'日本取引所グループ（JPX）'};
function fixture(changes={}){
  return {symbol:KEY,name:'トヨタ自動車',status:'ready',refreshing:false,quote_refresh_enabled:true,updated_at:NOW/1000,
    data:{currency:'JPY',price:3210,price_updated_at:(NOW-60000)/1000,market_cap:42000000000000,annual_dividend:95,annual_dividend_basis:'trailing_12m',dividend_fetched_at:(NOW-3600000)/1000,forward_annual_dividend_per_share:100,forward_dividend_basis:'annualized',analyst_target:{mean:3600,low:2900,high:4100,analyst_count:12,currency:'JPY',as_of:null},ex_dividend_date:'2026-09-29',dividend_payment_date:'2026-11-26'},
    source:{name:'Yahoo Finance',url:'https://finance.yahoo.com/quote/7203.T/',fields:Object.fromEntries(['price','market_cap','forward_annual_dividend_per_share','analyst_target','ex_dividend_date','dividend_payment_date'].map((name,i)=>[name,{fetched_at:(NOW-i*3600000)/1000,as_of:null}]))},
    editorial:{business:'車を作り、世界中で販売する会社です。',life:'通勤や買い物で使う車を支えています。',watch:'車の売れ行きや材料の値段に注目です。',reviewed_on:'2026-09-24',sources:[{title:'会社の公式サイト',url:'https://global.toyota/jp/'}]},
    sources:[{title:'Yahoo Finance',url:'https://finance.yahoo.com/quote/7203.T/',fetched_at:NOW/1000}],...changes};
}
function storage(initial={}){const map=new Map(Object.entries(initial));return {map,getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)};}
async function flush(){for(let n=0;n<30;n++)await Promise.resolve();}
function clock(){let now=NOW,next=0;const timers=new Map();return {now:()=>now,timers,setTimeout(fn,ms){timers.set(++next,{at:now+ms,fn});return next;},clearTimeout(id){timers.delete(id);},async advance(ms){const end=now+ms;for(;;){const found=[...timers.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!found)break;now=found[1].at;timers.delete(found[0]);found[1].fn();await flush();}now=end;await flush();}};}
function loaderHarness(saved=storage()){
  const time=clock(),requests=[],states=[];
  const env={...time,AbortController,storage:saved,fetch(url,options){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});requests.push({url,options,resolve,reject});return promise;}};
  const loader=profile.createLoader(env,state=>states.push(state));
  return {time,requests,states,loader,storage:saved,async reply(index,payload,status=200){requests[index].resolve({ok:status===200,status,json:async()=>payload});await flush();},async load(key=KEY){loader.load(key);await flush();}};
}
const HISTORICAL='historical_dividend_per_share',REGIONAL_KEY='9085.JP';
const ISSUER_FORECAST='issuer_annual_dividend_forecast_per_share';
const YEAR_PER='issuer_reported_fiscal_per';
function yearPerFixture(changes={}){
  const raw=fixture({identity:{...IDENTITY,exchange:'Tokyo'}});
  raw.year_per_status='available';raw.data[YEAR_PER]=12.12345678;
  raw.year_per={kind:YEAR_PER,symbol:KEY,status:'available',value:12.12345678,reason:null,unit:'times',basis:'consolidated',accounting_standard:'JGAAP',security_code:'7203',issuer_name:raw.name,exchange:'Tokyo',fiscal_period:{start:'2025-04-01',end:'2026-03-31'},price_basis:'not_stated',price_reference_date:null,doc_id:'S100TEST',source_url:'https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/S100TEST.pdf',source_title:'有価証券報告書（当サイトが年度PERを抜粋）',filed_on:'2026-06-30',checked_on:'2026-09-24',fetched_at:(NOW-1000)/1000,use_basis:'independent_extraction_of_numeric_facts',latest_filing_guaranteed:false};
  raw.sources=[{title:raw.year_per.source_title,url:raw.year_per.source_url,fetched_at:raw.year_per.fetched_at}];
  return {...raw,...changes};
}
function issuerForecastFixture(changes={}){
  const raw=filedFixture(),source='https://sirius.chuo-bus.co.jp/corporation/ir/forecast.pdf';
  raw.issuer_dividend_forecast_status='available';raw.data[ISSUER_FORECAST]=60;
  raw.issuer_dividend_forecast={kind:'issuer_annual_dividend_forecast',status:'available',value:60,currency:'JPY',unit:'JPY/share',security_code:'9085',issuer_name:raw.name,exchange:'Sapporo',fiscal_period:{start:'2026-04-01',end:'2027-03-31'},announcement_date:'2026-07-28',checked_on:'2026-09-24',fetched_at:(NOW-1000)/1000,source_url:source,source_title:'北海道中央バス 決算短信',source_host:'sirius.chuo-bus.co.jp',use_basis:'independent_extraction_of_numeric_facts',split_adjustment:'as_reported',latest_revision_guaranteed:false};
  return {...raw,...changes};
}
function filedFixture(changes={}){
  const end='2026-09-24',from=new Date(Date.parse(end)-399*86400000).toISOString().slice(0,10);
  const fact={value:50.5,currency:'JPY',unit:'JPY/share',security_code:'90850',edinet_code:'E00123',doc_id:'S100ABCD',fiscal_period:{start:'2025-04-01',end:'2026-03-31'},filing_submitted_at:'2026-06-30 09:00',submitted_at:Date.parse('2026-06-30T00:00:00Z')/1000,fetched_at:(NOW-1000)/1000,source_url:'https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/S100ABCD.pdf',source_title:'EDINET 有価証券報告書',kind:'filed_fiscal_period_dividend',split_adjustment:'as_reported',latest_filing_guaranteed:false};
  return fixture({symbol:REGIONAL_KEY,name:'表示テスト企業',data:{currency:'JPY',[HISTORICAL]:50.5},identity:{...IDENTITY,exchange:'Sapporo',market:'札幌市場',industry:'陸運業'},editorial:null,updated_at:null,source:{fields:{}},sources:[],quote_refresh_enabled:false,historical_dividend_status:'available',historical_dividend_refreshing:false,historical_dividend_invalidated:false,historical_dividend_coverage:{window_days:400,indexed_days:399,missing_days:1,from,to:end,complete:false,snapshot_guaranteed:false},dividend_fact:fact,...changes});
}
test('filed fiscal-year dividends remain independent of unsupported Tokyo-derived numbers and accept true zero',()=>{
  const raw=filedFixture();Object.assign(raw.data,{price:99,market_cap:300,annual_dividend:10,annual_dividend_basis:'trailing_12m',forward_annual_dividend_per_share:20,forward_dividend_basis:'annualized'});
  const clean=profile.normalize(raw,REGIONAL_KEY,NOW);assert.equal(clean.data[HISTORICAL],50.5);assert.equal(clean.dividend_fact.fetched_at,NOW-1000);assert.equal(clean.data.price,null);assert.equal(clean.data.annual_dividend,null);assert.equal(clean.data.forward_annual_dividend_per_share,null);assert.equal(clean.data.market_cap,null);assert.equal(clean.dividend_fact.latest_filing_guaranteed,false);
  raw.data[HISTORICAL]=raw.dividend_fact.value=0;const zero=profile.normalize(raw,REGIONAL_KEY,NOW);assert.equal(zero.data[HISTORICAL],0);assert.equal(profile.fieldReason({data:zero},HISTORICAL),'');
  const tokyo=profile.normalize({...raw,symbol:KEY},KEY,NOW);assert.equal(tokyo.data[HISTORICAL],null);assert.equal(tokyo.dividend_fact,null);
});
test('invalid annual facts never become links or values and cannot survive in a cache',()=>{
  const good=filedFixture();
  for(const change of [{value:true},{security_code:'72030'},{currency:'USD'},{fiscal_period:{start:'2026-04-01',end:'2025-03-31'}},{filing_submitted_at:'2026-02-30 09:00'},{fetched_at:(NOW+1000)/1000},{source_url:good.dividend_fact.source_url+'?Subscription-Key=secret'},{source_url:good.dividend_fact.source_url.replace('S100ABCD','S100ABCE')},{source_url:'https://api.edinet-fsa.go.jp/api/v2/documents/S100ABCD?type=1'}]){
    const raw=structuredClone(good);Object.assign(raw.dividend_fact,change);raw.sources=[{title:'EDINET',url:raw.dividend_fact.source_url}];raw.source.url=raw.dividend_fact.source_url;
    const clean=profile.normalize(raw,REGIONAL_KEY,NOW);assert.equal(clean.dividend_fact,null);assert.equal(clean.data[HISTORICAL],null);assert.equal(clean.historical_dividend_invalidated,true);assert.deepEqual(clean.sources,[]);
  }
  const raw=filedFixture();raw.data[HISTORICAL]=50;assert.equal(profile.normalize(raw,REGIONAL_KEY,NOW).dividend_fact,null);
});
test('the latest filed year and corrected submission win independently of financial profile freshness',async()=>{
  const h=loaderHarness();await h.load(REGIONAL_KEY);await h.reply(0,filedFixture());
  const older=filedFixture();older.dividend_fact.fiscal_period={start:'2024-04-01',end:'2025-03-31'};older.dividend_fact.filing_submitted_at='2025-06-30 09:00';older.dividend_fact.submitted_at=Date.parse('2025-06-30T00:00:00Z')/1000;older.dividend_fact.fetched_at=NOW/1000;older.dividend_fact.value=older.data[HISTORICAL]=1;
  await h.load(REGIONAL_KEY);await h.reply(1,older);assert.equal(h.states.at(-1).data.data[HISTORICAL],50.5);assert.equal(h.states.at(-1).data.dividend_fact.fiscal_period.end,'2026-03-31');
  const correction=filedFixture();correction.dividend_fact.filing_submitted_at='2026-07-01 09:00';correction.dividend_fact.submitted_at=Date.parse('2026-07-01T00:00:00Z')/1000;correction.dividend_fact.value=correction.data[HISTORICAL]=55;
  await h.load(REGIONAL_KEY);await h.reply(2,correction);assert.equal(h.states.at(-1).data.data[HISTORICAL],55);
  const reloaded=loaderHarness(h.storage);await reloaded.load(REGIONAL_KEY);assert.equal(reloaded.states[0].data.data[HISTORICAL],55);assert.equal(reloaded.states[0].data.dividend_fact.filing_submitted_at,'2026-07-01 09:00');
});
test('transient annual fetch failures retain the saved fiscal year and its original dates',async()=>{
  const h=loaderHarness();await h.load(REGIONAL_KEY);await h.reply(0,filedFixture());
  await h.load(REGIONAL_KEY);await h.reply(1,filedFixture({data:{currency:'JPY'},dividend_fact:null,historical_dividend_status:'fetch_error',historical_dividend_error:'fetch_error'}));
  const kept=h.states.at(-1).data;assert.equal(kept.data[HISTORICAL],50.5);assert.equal(kept.dividend_fact.fetched_at,NOW-1000);assert.equal(kept.historical_dividend_error,'fetch_error');assert.equal(kept.dividend_fact.fiscal_period.end,'2026-03-31');
  const reloaded=loaderHarness(h.storage);await reloaded.load(REGIONAL_KEY);assert.equal(reloaded.states[0].data.dividend_fact.fetched_at,NOW-1000);
});
test('known withdrawal or correction clears only the annual cache and cannot return after closing or reload',async()=>{
  for(const status of ['invalid','unconfirmed']){
    const h=loaderHarness();await h.load(REGIONAL_KEY);await h.reply(0,filedFixture());await h.load(REGIONAL_KEY);
    await h.reply(1,filedFixture({data:{currency:'JPY'},dividend_fact:null,historical_dividend_status:status,historical_dividend_invalidated:true,sources:[{title:'EDINET',url:filedFixture().dividend_fact.source_url}]}));
    const current=h.states.at(-1).data;assert.equal(current.dividend_fact,null);assert.equal(current.data[HISTORICAL],null);assert.deepEqual(current.sources,[]);assert.equal(current.identity.industry,'陸運業');
    h.loader.cancel();assert.equal(h.loader.peek(REGIONAL_KEY),null);await h.load(REGIONAL_KEY);assert.equal(h.states.at(-1).data,null);
    const reloaded=loaderHarness(h.storage);await reloaded.load(REGIONAL_KEY);assert.equal(reloaded.states[0].data,null);
  }
});
test('disabling annual configuration removes its old cache and malformed coverage never claims completeness',async()=>{
  const h=loaderHarness();await h.load(REGIONAL_KEY);await h.reply(0,filedFixture());await h.load(REGIONAL_KEY);
  const disabled=filedFixture();delete disabled.historical_dividend_status;delete disabled.dividend_fact;await h.reply(1,disabled);assert.equal(h.states.at(-1).data.dividend_fact,null);assert.equal(h.loader.peek(REGIONAL_KEY),null);
  const reloaded=loaderHarness(h.storage);await reloaded.load(REGIONAL_KEY);assert.equal(reloaded.states[0].data,null);
  for(const change of [{missing_days:0},{window_days:true},{complete:true},{to:'2099-01-01'},{stale_days:400}]){
    const raw=filedFixture();Object.assign(raw.historical_dividend_coverage,change);assert.equal(profile.normalize(raw,REGIONAL_KEY,NOW).historical_dividend_coverage,null);
  }
  const initial=filedFixture();Object.assign(initial.historical_dividend_coverage,{indexed_days:0,missing_days:400,observed_at:null});assert.equal(profile.normalize(initial,REGIONAL_KEY,NOW).historical_dividend_coverage.missing_days,400);
});
test('Japanese company codes normalize; malformed symbols and mismatched company responses are rejected',()=>{
  assert.equal(profile.symbol('７２０３'),'7203.T');assert.equal(profile.symbol('285a.t'),'285A.T');
  assert.equal(profile.symbol('８３０１.jp'),'8301.JP');
  for(const value of ['AAPL','7203.T/other','<script>','１２３',null])assert.equal(profile.symbol(value),'');
  assert.equal(profile.normalize(fixture({symbol:'9432.T'}),KEY,NOW),null);
  assert.equal(profile.normalize(fixture({status:'made-up'}),KEY,NOW),null);
  assert.equal(profile.normalize(fixture({symbol:'7203.JP'}),KEY,NOW),null);
});
test('quote delay metadata belongs to its actual price and a cached quote never becomes realtime',()=>{
  const raw=fixture({market_data:{kind:'delayed',delay_minutes:20,quote_as_of:(NOW-60000)/1000,quote_age_seconds:60,quote_is_recent:true}});
  const record=profile.normalize(raw,KEY,NOW);
  assert.equal(record.market_data.quote_as_of,NOW-60000);assert.equal(record.market_data.quote_age_seconds,60);
  assert.equal(profile.quoteNote({data:record,status:'ready'},NOW),'20分遅延の株価');
  assert.match(profile.quoteNote({data:record,status:'stale',fromCache:true,updating:true},NOW),/20分遅延.*保存済み.*確認中/);
  assert.match(profile.quoteNote({data:record,status:'ready'},NOW+30*60000),/株価の時点/);
  assert.match(profile.quoteNote({data:record,status:'error',reason:'fetch_error'},NOW),/通信エラー/);
  raw.market_data.quote_as_of=NOW/1000;assert.equal(profile.normalize(raw,KEY,NOW).market_data,null,'Different quote timestamps cannot establish freshness');
  raw.market_data={kind:'realtime',quote_as_of:(NOW-60000)/1000};assert.equal(profile.normalize(raw,KEY,NOW).market_data,null,'A source without verified realtime support cannot claim realtime');
});
test('quote-only failures describe retained prices without changing the independent financial state',async()=>{
  const h=loaderHarness(),raw=fixture({market_data:{kind:'delayed',delay_minutes:20,quote_as_of:(NOW-60000)/1000,quote_is_recent:true},quote_status:'ready',quote_error:null,quote_refreshing:false});
  await h.load();await h.reply(0,raw);await h.load();
  const failure=fixture({data:{currency:'JPY'},updated_at:null,status:'ready',quote_status:'unavailable',quote_error:'fetch_error',quote_refreshing:false});await h.reply(1,failure);
  const kept=h.states.at(-1);assert.equal(kept.data.data.price,3210);assert.equal(kept.data.data.price_updated_at,NOW-60000);assert.equal(kept.data.data.annual_dividend,95);
  assert.equal(kept.data.status,'ready');assert.equal(kept.data.quote_error,'fetch_error');assert.match(profile.quoteNote(kept,NOW),/20分遅延.*保存済み.*株価取得で通信エラー/);
  raw.quote_status='ready';raw.quote_refreshing=false;const financialPending=profile.normalize(raw,KEY,NOW);assert.equal(profile.quoteNote({data:financialPending,updating:true},NOW),'20分遅延の株価','A financial refresh is not a price refresh');
  raw.quote_status='pending';raw.quote_refreshing=true;assert.match(profile.quoteNote({data:profile.normalize(raw,KEY,NOW)},NOW),/最新の株価を確認中/);
  raw.quote_error='private upstream text';assert.equal(profile.normalize(raw,KEY,NOW).quote_error,null);
});
test('regional companies keep their identity and do not borrow a Tokyo quote or dividend',async()=>{
  const key='8301.JP',raw=fixture({symbol:key,name:'地方の会社',identity:{...IDENTITY,market:'札証単独上場'},editorial:null,market_data:{kind:'delayed',delay_minutes:20,quote_as_of:(NOW-60000)/1000,quote_is_recent:true}});
  const clean=profile.normalize(raw,key,NOW);assert.equal(clean.symbol,key);assert.equal(clean.identity.market,'札証単独上場');
  for(const field of ['price','market_cap','annual_dividend','forward_annual_dividend_per_share','analyst_target','ex_dividend_date','dividend_payment_date'])assert.equal(clean.data[field],null,field);
  assert.equal(profile.fieldReason({data:clean},'price'),'取得元未対応');assert.equal(clean.market_data.kind,'unsupported');
  const h=loaderHarness();await h.load(key);assert.match(h.requests[0].url,/symbol=8301.JP&purpose=detail/);await h.reply(0,raw);assert.equal(h.states.at(-1).symbol,key);
  await h.load(key);await h.reply(1,fixture({symbol:'8301.T'}));assert.equal(h.states.at(-1).reason,'invalid');
});
test('saving an older quote preserves that quote delay metadata and its original timestamps',async()=>{
  const h=loaderHarness(),raw=fixture({market_data:{kind:'delayed',delay_minutes:20,quote_as_of:(NOW-60000)/1000,quote_is_recent:true}});
  await h.load();await h.reply(0,raw);await h.load();
  const older=fixture({updated_at:(NOW+30000)/1000,market_data:{kind:'delayed',delay_minutes:20,quote_as_of:(NOW-3600000)/1000,quote_is_recent:false}});older.data.price=1;older.data.price_updated_at=(NOW-3600000)/1000;
  await h.reply(1,older);const kept=h.states.at(-1).data;assert.equal(kept.data.price,3210);assert.equal(kept.market_data.quote_as_of,NOW-60000);
  const restored=loaderHarness(h.storage);await restored.load();assert.equal(restored.states[0].data.market_data.quote_as_of,NOW-60000);
});
test('search-time capitalization updates independently of the older financial profile and cannot roll back',async()=>{
  const h=loaderHarness();await h.load();await h.reply(0,fixture());await h.load();
  const newerCap=fixture({updated_at:(NOW-3600000)/1000});newerCap.data.market_cap=43000000000000;newerCap.source.fields.market_cap.fetched_at=NOW/1000;
  await h.reply(1,newerCap);assert.equal(h.states.at(-1).data.data.market_cap,43000000000000);assert.equal(h.states.at(-1).data.source.fields.market_cap.fetched_at,NOW);
  await h.load();const olderCap=fixture({updated_at:(NOW+30000)/1000});olderCap.data.market_cap=1;olderCap.source.fields.market_cap.fetched_at=(NOW-7200000)/1000;
  await h.reply(2,olderCap);assert.equal(h.states.at(-1).data.data.market_cap,43000000000000);assert.equal(h.states.at(-1).data.source.fields.market_cap.fetched_at,NOW);
});
test('unknowns remain unknown, actual zero dividends survive, and forecast basis/currency are explicit',()=>{
  const raw=fixture();Object.assign(raw.data,{price:'3210',market_cap:true,annual_dividend:0,forward_dividend_basis:'company_forecast'});raw.data.analyst_target.currency='USD';
  const clean=profile.normalize(raw,KEY,NOW);
  assert.equal(clean.data.price,null);assert.equal(clean.data.market_cap,null);assert.equal(clean.data.annual_dividend,0);assert.equal(clean.data.forward_annual_dividend_per_share,null);assert.equal(clean.data.analyst_target,null);
  assert.equal(profile.money(0),'0円');assert.equal(profile.money(null),null);assert.equal(profile.money(-5),null);assert.equal(profile.money(42000000000000,'JPY',true),'42兆円');
  assert.equal(profile.money(1000),'1,000円');assert.equal(profile.money(55.5),'55.5円');assert.equal(profile.money(55.25),'55.25円');
  raw.data.annual_dividend_basis='unknown';assert.equal(profile.normalize(raw,KEY,NOW).data.annual_dividend,null);
  raw.data.analyst_target={mean:4000,low:2000,high:3000,currency:'JPY'};assert.equal(profile.normalize(raw,KEY,NOW).data.analyst_target,null);
});
test('unsafe URLs and invalid dates never become navigable sources; field dates are independent',()=>{
  const raw=fixture();raw.sources.push(...['javascript:alert(1)','data:text/html,x','https://user:pass@example.com/','https://example.com/\n'].map(url=>({title:'bad',url})));
  raw.editorial.business='<img src=x onerror=alert(1)>';raw.data.ex_dividend_date='2026-02-30';raw.data.price_updated_at=(NOW+61000)/1000;
  const clean=profile.normalize(raw,KEY,NOW);assert.equal(clean.sources.length,1);assert.equal(clean.data.ex_dividend_date,null);assert.equal(clean.data.price_updated_at,null);
  assert.equal(clean.editorial.business,'<img src=x onerror=alert(1)>');assert.equal(clean.source.fields.analyst_target.fetched_at,NOW-3*3600000);assert.equal(clean.updated_at,NOW);
  assert.equal(profile.day('2024-02-29'),'2024-02-29');assert.equal(profile.day('2026-02-29'),null);assert.equal(profile.timestamp('2026-09-24T14:00:00',NOW),null);assert.equal(profile.timestamp((NOW+30000)/1000,NOW),NOW+30000);
});
test('opening emits immediately, deduplicates requests, and polls multiple times without overlapping',async()=>{
  const h=loaderHarness();h.loader.load(KEY);assert.equal(h.states[0].status,'loading');h.loader.load(KEY);await flush();assert.equal(h.requests.length,1);
  const partial=fixture({status:'pending',refreshing:true,updated_at:null});partial.data.market_cap=null;
  await h.reply(0,partial);assert.equal(h.states.at(-1).data.data.price,3210);assert.equal(h.states.at(-1).data.updated_at,null);
  await h.time.advance(2999);assert.equal(h.requests.length,1);await h.time.advance(1);assert.equal(h.requests.length,2);
  await h.reply(1,partial);await h.time.advance(3000);assert.equal(h.requests.length,3);
  await h.reply(2,fixture());assert.equal(h.states.at(-1).status,'ready');await h.time.advance(60000);assert.equal(h.requests.length,3);assert.equal(h.time.timers.size,0);
});
test('pending polling stops at 90 seconds and never relabels old observations as fresh',async()=>{
  const h=loaderHarness();await h.load();const pending=fixture({status:'pending',refreshing:true});
  for(let i=0;i<30;i++){assert.equal(h.requests.length,i+1);await h.reply(i,pending);await h.time.advance(3000);}
  assert.equal(h.requests.length,30);assert.equal(h.states.at(-1).reason,'pending_timeout');assert.equal(h.states.at(-1).data.data.price_updated_at,NOW-60000);assert.equal(h.time.timers.size,0);
});
test('stalled requests abort within 12 seconds, retry twice, and then allow explicit retry',async()=>{
  const h=loaderHarness();await h.load();await h.time.advance(12000);assert.equal(h.requests[0].options.signal.aborted,true);assert.equal(h.states.at(-1).reason,'retrying');
  await h.time.advance(1000);assert.equal(h.requests.length,2);await h.time.advance(12000);await h.time.advance(3000);assert.equal(h.requests.length,3);await h.time.advance(12000);
  assert.equal(h.states.at(-1).reason,'timeout');assert.equal(h.states.at(-1).updating,false);assert.equal(h.time.timers.size,0);
  await h.load();await h.reply(3,fixture());assert.equal(h.states.at(-1).status,'ready');assert.equal(h.requests.length,4);
});
test('transient failures recover automatically, while invalid and unknown companies are not retried',async()=>{
  const h=loaderHarness();await h.load();await h.reply(0,{},503);assert.equal(h.states.at(-1).reason,'retrying');
  await h.time.advance(1000);await h.reply(1,fixture());assert.equal(h.states.at(-1).status,'ready');await h.time.advance(20000);assert.equal(h.requests.length,2);
  for(const [status,body] of [[404,{error:'company_not_found'}],[400,{error:'invalid_symbol'}],[200,fixture({symbol:'9432.T'})]]){
    const bad=loaderHarness();await bad.load();await bad.reply(0,body,status);assert.equal(bad.states.at(-1).updating,false);await bad.time.advance(90000);assert.equal(bad.requests.length,1);
  }
});
test('closing during retry cancels backoff and never starts another request',async()=>{
  const h=loaderHarness();await h.load();await h.reply(0,{},429);h.loader.cancel();const count=h.states.length;await h.time.advance(90000);assert.equal(h.requests.length,1);assert.equal(h.states.length,count);assert.equal(h.time.timers.size,0);
});
test('closing and switching companies ignore late replies and cancel pending timers',async()=>{
  const h=loaderHarness();await h.load();await h.load('9432.T');assert.equal(h.requests[0].options.signal.aborted,true);
  await h.reply(1,fixture({symbol:'9432.T',name:'NTT'}));const count=h.states.length;await h.reply(0,fixture());assert.equal(h.states.length,count);assert.equal(h.states.at(-1).symbol,'9432.T');
  await h.load();h.loader.cancel();const afterCancel=h.states.length;await h.reply(2,fixture({status:'pending',refreshing:true}));assert.equal(h.states.length,afterCancel);assert.equal(h.time.timers.size,0);
});
test('persisted last-good data survives failure and incomplete pending responses',async()=>{
  const saved=storage(),first=loaderHarness(saved);await first.load();await first.reply(0,fixture());
  const h=loaderHarness(saved);await h.load();assert.equal(h.states[0].fromCache,true);assert.equal(h.states[0].data.data.price,3210);
  const partial=fixture({updated_at:null,status:'pending',refreshing:true,data:{currency:'JPY'},editorial:{...fixture().editorial,business:'新しい説明です。'}});
  await h.reply(0,partial);assert.equal(h.states.at(-1).data.data.price,3210);assert.equal(h.states.at(-1).data.editorial.business,'新しい説明です。');assert.equal(h.states.at(-1).fromCache,true);
  await h.time.advance(3000);h.requests[1].reject(new Error('offline'));await flush();assert.equal(h.states.at(-1).reason,'retrying');assert.equal(h.states.at(-1).data.data.price,3210);
  await h.time.advance(1000);h.requests[2].reject(new Error('offline'));await flush();await h.time.advance(3000);h.requests[3].reject(new Error('offline'));await flush();assert.equal(h.states.at(-1).status,'stale');assert.equal(h.states.at(-1).data.updated_at,NOW);
});
test('an older server seed cannot roll back saved profile fields or their dates',async()=>{
  const h=loaderHarness();await h.load();await h.reply(0,fixture());await h.load();
  const older=fixture({updated_at:(NOW-86400000)/1000});older.data.market_cap=1;older.data.price=1200;older.data.price_updated_at=(NOW-86400000)/1000;older.data.annual_dividend=1;older.data.dividend_fetched_at=(NOW-86400000)/1000;
  for(const field of Object.values(older.source.fields))field.fetched_at=(NOW-86400000)/1000;
  await h.reply(1,older);const kept=h.states.at(-1);assert.equal(kept.fromCache,true);assert.equal(kept.data.data.market_cap,42000000000000);assert.equal(kept.data.data.price,3210);assert.equal(kept.data.source.fields.market_cap.fetched_at,NOW-3600000);assert.equal(kept.data.updated_at,NOW);
  await h.load();older.data.price=3300;older.data.price_updated_at=NOW/1000;older.source.fields.price.fetched_at=NOW/1000;older.data.annual_dividend=96;older.data.dividend_fetched_at=NOW/1000;
  await h.reply(2,older);assert.equal(h.states.at(-1).data.data.price,3300);assert.equal(h.states.at(-1).data.data.annual_dividend,96);assert.equal(h.states.at(-1).data.data.market_cap,42000000000000);
  const restored=loaderHarness(h.storage);await restored.load();assert.equal(restored.states[0].data.data.price,3300);
});
test('expired cache, inaccessible storage, and not-found responses are handled safely',async()=>{
  const old=fixture({updated_at:(NOW-8*86400000)/1000});old.data.price_updated_at=old.updated_at;old.data.dividend_fetched_at=old.updated_at;
  for(const field of Object.values(old.source.fields))field.fetched_at=old.updated_at;
  const h=loaderHarness(storage({[PREFIX+KEY]:JSON.stringify(old)}));await h.load();assert.equal(h.states[0].data,null);await h.reply(0,{error:'unknown'},404);assert.equal(h.states.at(-1).reason,'not_found');
  const failing=loaderHarness({getItem(){throw new Error('storage disabled');},setItem(){throw new Error('quota');}});await failing.load();await failing.reply(0,fixture());assert.equal(failing.states.at(-1).status,'ready');assert.equal(failing.loader.peek(KEY).data.price,3210);
});
test('dated end-of-day prices cache without an invented market timestamp and cannot roll back',async()=>{
  const h=loaderHarness(),close=fixture({updated_at:null});close.data.price_updated_at=null;close.data.price_trade_date='2026-09-23';close.data.annual_dividend=null;close.data.dividend_fetched_at=null;
  await h.load();await h.reply(0,close);assert.equal(h.loader.peek(KEY).data.price_updated_at,null);assert.equal(h.loader.peek(KEY).data.price_trade_date,'2026-09-23');
  await h.load();const older=structuredClone(close);older.data.price=1;older.data.price_trade_date='2026-09-22';older.source.fields.price.fetched_at=NOW/1000;await h.reply(1,older);assert.equal(h.states.at(-1).data.data.price,3210);assert.equal(h.states.at(-1).data.data.price_trade_date,'2026-09-23');
  await h.load();const newer=structuredClone(close);newer.data.price=3300;newer.data.price_trade_date='2026-09-24';await h.reply(2,newer);assert.equal(h.states.at(-1).data.data.price,3300);assert.equal(h.states.at(-1).data.data.price_updated_at,null);
  const reloaded=loaderHarness(h.storage);await reloaded.load();assert.equal(reloaded.states[0].data.data.price,3300);
});
test('official identity is accepted only with a safe source and an actual nonfuture catalogue date',()=>{
  const clean=profile.normalize(fixture({identity:IDENTITY}),KEY,NOW);assert.equal(clean.identity.industry,'輸送用機器');assert.equal(clean.identity.date,'2026-09-23');
  for(const identity of [{...IDENTITY,source_url:'javascript:alert(1)'},{...IDENTITY,date:'2026-02-30'},{...IDENTITY,date:'2026-09-25'},{market:'プライム',industry:'輸送用機器'}])assert.equal(profile.normalize(fixture({identity}),KEY,NOW).identity,null);
});
test('field statuses accept only known reasons and rejected values never masquerade as available numbers',()=>{
  const clean=profile.normalize(fixture({data:{currency:'JPY',price:'3210'},field_status:{price:'available',market_cap:'source_missing',annual_dividend:'unpublished',made_up:'loading'}}),KEY,NOW);
  assert.deepEqual(clean.field_status,{price:'invalid',market_cap:'source_missing'});
  assert.equal(profile.fieldReason({data:clean},'price'),'内容を確認中');assert.equal(profile.fieldReason({data:clean},'market_cap'),'提供元に情報なし');assert.equal(profile.fieldReason({data:clean},'annual_dividend'),'未確認');
});
test('a valid target range without a mean is unconfirmed rather than malformed',()=>{
  const raw=fixture({field_status:{analyst_target:'available'}});raw.data.analyst_target={mean:null,low:2900,high:4100,analyst_count:12,currency:'JPY'};
  const clean=profile.normalize(raw,KEY,NOW);assert.equal(clean.field_status.analyst_target,'available');assert.equal(profile.fieldReason({data:clean},'analyst_target'),'未確認');assert.equal(clean.data.analyst_target.low,2900);
  raw.data.analyst_target={mean:3600,low:4100,high:2900,currency:'JPY'};const bad=profile.normalize(raw,KEY,NOW);assert.equal(bad.field_status.analyst_target,'invalid');assert.equal(profile.fieldReason({data:bad},'analyst_target'),'内容を確認中');
});
test('each empty field explains its own state and unrelated annual loading does not override a completed source',()=>{
  const field_status={price:'loading',market_cap:'source_missing',annual_dividend:'loading',forward_annual_dividend_per_share:'fetch_error',ex_dividend_date:'invalid',dividend_payment_date:'unconfirmed',analyst_target:'source_missing'};
  const record=profile.normalize(fixture({data:{currency:'JPY'},field_status,status:'pending',refreshing:true}),KEY,NOW),pending={data:record,status:'pending',updating:true};
  assert.equal(profile.fieldReason(pending,'price'),'取得中');assert.equal(profile.fieldReason(pending,'annual_dividend'),'取得中');assert.equal(profile.fieldReason(pending,'market_cap'),'提供元に情報なし');assert.equal(profile.fieldReason(pending,'forward_annual_dividend_per_share'),'通信エラー');assert.equal(profile.fieldReason(pending,'ex_dividend_date'),'内容を確認中');assert.equal(profile.fieldReason(pending,'dividend_payment_date'),'未確認');assert.equal(profile.fieldReason(pending,'analyst_target'),'提供元に情報なし');
  assert.equal(profile.fieldReason({status:'loading',updating:true,data:null},'price'),'取得中');assert.equal(profile.fieldReason({...pending,reason:'retrying'},'market_cap'),'提供元に情報なし');assert.equal(profile.fieldReason({...pending,reason:'fetch_error',updating:false},'ex_dividend_date'),'内容を確認中');
  assert.equal(profile.fieldReason({...pending,reason:'pending_timeout',updating:false},'annual_dividend'),'未確認');
});
test('browser failures are distinct from unknown companies and malformed responses',async()=>{
  const h=loaderHarness();await h.load();await h.reply(0,{},503);assert.equal(profile.fieldReason(h.states.at(-1),'market_cap'),'通信エラー');
  const unknown=loaderHarness();await unknown.load();await unknown.reply(0,{},404);assert.equal(unknown.states.at(-1).reason,'not_found');assert.equal(profile.fieldReason(unknown.states.at(-1),'price'),'未確認');
  const malformed=loaderHarness();await malformed.load();await malformed.reply(0,fixture({symbol:'9432.T'}));assert.equal(malformed.states.at(-1).reason,'invalid');assert.equal(profile.fieldReason(malformed.states.at(-1),'price'),'内容を確認中');
  const invalid=loaderHarness();await invalid.load();await invalid.reply(0,{},400);assert.equal(profile.fieldReason(invalid.states.at(-1),'price'),'未確認');
});
test('current response field reasons replace cached failures even when older numeric records are retained',async()=>{
  const saved=fixture({field_status:{market_cap:'fetch_error',annual_dividend:'loading'}});saved.data.market_cap=null;saved.data.annual_dividend=null;
  const h=loaderHarness();await h.load();await h.reply(0,saved);
  const later=fixture({updated_at:null,data:{currency:'JPY'},field_status:{market_cap:'source_missing',annual_dividend:'loading'},status:'pending',refreshing:true});await h.load();await h.reply(1,later);
  assert.equal(h.states.at(-1).fromCache,true);assert.equal(h.states.at(-1).data.data.price,3210);assert.equal(profile.fieldReason(h.states.at(-1),'market_cap'),'提供元に情報なし');assert.equal(profile.fieldReason(h.states.at(-1),'annual_dividend'),'取得中');
  h.loader.cancel();const reloaded=loaderHarness(h.storage);await reloaded.load();assert.equal(reloaded.states[0].data.field_status.annual_dividend,'unconfirmed');assert.equal(profile.fieldReason({...reloaded.states[0],updating:false},'annual_dividend'),'未確認');assert.equal(profile.fieldReason(reloaded.states[0],'annual_dividend'),'取得中');assert.equal(profile.fieldReason(reloaded.states[0],'market_cap'),'提供元に情報なし');
});
test('valid saved values, zero dividends, and month-precise schedules do not become missing on later failure',()=>{
  const raw=fixture({field_status:Object.fromEntries(['price','market_cap','annual_dividend','forward_annual_dividend_per_share','ex_dividend_date','dividend_payment_date','analyst_target'].map(key=>[key,'fetch_error']))});raw.data.annual_dividend=0;raw.data.dividend_payment_date=null;raw.data.dividend_payment_period='2026-11';
  const state={data:profile.normalize(raw,KEY,NOW),status:'stale',updating:false,reason:'fetch_error'};
  for(const key of Object.keys(raw.field_status))assert.equal(profile.fieldReason(state,key),'',key);
});

class Element {
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.doc=doc;this.children=[];this.dataset={};this.attributes={};this.listeners={};this.hidden=false;this.disabled=false;this.inert=false;this.open=false;this.scrollTop=0;this.scrollLeft=0;this.className='';this.style={overflow:'',position:'',top:'',left:'',right:'',width:'',paddingRight:'',setProperty(k,v){this[k]=v;}};this._text='';}
  get parentElement(){return this.parentNode||null;}
  get isConnected(){return this===this.doc.body||!!this.parentNode&&this.parentNode.isConnected;}
  get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}set textContent(value){this._text=String(value);this.children.forEach(n=>n.parentNode=null);this.children=[];}
  set innerHTML(value){throw new Error('HTML interpolation must not be used');}
  appendChild(node){if(node.parentNode)node.parentNode.children=node.parentNode.children.filter(n=>n!==node);node.parentNode=this;this.children.push(node);return node;}
  replaceChildren(...nodes){this.children.forEach(n=>n.parentNode=null);this.children=[];nodes.forEach(n=>this.appendChild(n));}
  setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}removeAttribute(key){delete this.attributes[key];}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}dispatch(type,event={}){for(const fn of this.listeners[type]||[])fn({target:this,...event});}
  focus(){this.doc.activeElement=this;}
  matches(selector){if(selector==='[hidden]')return this.hidden;if(selector==='[inert]')return this.inert;if(selector==='[data-company-profile]')return !!this.dataset.companyProfile;if(selector==='[tabindex="0"]')return this.tabIndex===0;if(selector==='a[href]')return this.tagName==='A'&&!!this.href;if(selector.includes(':not([disabled])'))return this.tagName===selector.split(':')[0].toUpperCase()&&!this.disabled;return selector[0]==='.'?this.className.split(' ').includes(selector.slice(1)):this.tagName===selector.toUpperCase();}
  closest(selector){let node=this;while(node){if(node.matches(selector))return node;node=node.parentNode;}return null;}
  contains(node){while(node){if(node===this)return true;node=node.parentNode;}return false;}
  querySelectorAll(selector){const parts=selector.split(',').map(s=>s.trim()),results=[];function walk(node){for(const child of node.children){if(parts.some(s=>child.matches(s)))results.push(child);walk(child);}}walk(this);return results;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  getClientRects(){let node=this,child=null;while(node){if(node.hidden||node.inert)return [];if(node.tagName==='DETAILS'&&!node.open&&child&&child.tagName!=='SUMMARY')return [];child=node;node=node.parentNode;}return this.isConnected?[{}]:[];}
}
function dialogHarness({reduced=true}={}){
  const time=clock(),events={};const doc={activeElement:null,documentElement:{clientWidth:400},createElement(tag){return new Element(tag,this);},addEventListener(type,fn){(events[type]??=[]).push(fn);},getElementById(id){function find(node){return node.id===id?node:node.children.map(find).find(Boolean);}return find(this.body)||null;},querySelector(){return this.fallback;}};
  doc.body=doc.createElement('body');const home=doc.createElement('main');home.id='morning-section';home.scrollTop=480;doc.body.appendChild(home);const trigger=doc.createElement('button');home.appendChild(trigger);trigger.focus();const nav=doc.createElement('nav');nav.inert=true;nav.setAttribute('aria-hidden','true');doc.body.appendChild(nav);doc.fallback=doc.createElement('button');home.appendChild(doc.fallback);
  const vv={height:780,offsetTop:0,events:{},addEventListener(type,fn){this.events[type]=fn;}};
  const w={KNDateDisplay:dates,KNDividendDates:require('../static/dividend-dates.js'),...time,document:doc,innerWidth:400,scrollY:95,scrollTo(value){this.restoredScroll=value.top;},visualViewport:vv,matchMedia:()=>({matches:reduced}),getComputedStyle:()=>({paddingRight:'0px'}),AbortController,localStorage:storage()};let retries=0;const view=profile.createDialog(w,()=>retries++);
  return {w,doc,home,nav,trigger,time,events,vv,view,get retries(){return retries;},key(key,shiftKey=false){const event={key,shiftKey,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};for(const fn of events.keydown||[])fn(event);return event;}};
}
function state(raw=fixture(),extra={}){return {symbol:KEY,status:raw.status,data:profile.normalize(raw,KEY,NOW),updating:false,fromCache:false,...extra};}
test('filed annual row has a separate label, exact fiscal period, submitted and fetched times, and EDINET attribution',()=>{
  const h=dialogHarness();h.view.open(REGIONAL_KEY,'表示テスト企業',h.trigger);const raw=filedFixture(),viewState={symbol:REGIONAL_KEY,status:'ready',data:profile.normalize(raw,REGIONAL_KEY,NOW),updating:false};h.view.render(viewState);const refs=h.view.elements;
  assert.equal(refs.historical.row.hidden,false);assert.match(refs.historical.row.textContent,/年度の実績配当（1株）/);assert.equal(refs.historical.value.textContent,'50.5円');assert.equal(refs.historical.period.textContent,'2025/04/01〜2026/03/31 対象年度');assert.equal(refs.historical.time.textContent,'2026/06/30 09:00 提出 / 2026/09/24 14:59 取得');
  assert.equal(refs.historical.source.children[0].href,raw.dividend_fact.source_url);assert.match(refs.historical.note.textContent,/当サイトがEDINET有価証券報告書から配当額を抜粋/);assert.match(refs.historical.note.textContent,/株式分割は調整していません/);assert.match(refs.historical.note.textContent,/保証されません/);assert.equal(refs.price.value.textContent,'—');assert.equal(refs.forward.value.textContent,'—');assert.equal(refs.annual.value.textContent,'—');assert.match(refs.status.textContent,/年度の実績配当は「数字・配当」/);
  refs.numbers.open=true;refs.content.scrollTop=240;const link=refs.historical.source.children[0];link.focus();h.view.render(viewState);assert.equal(refs.historical.source.children[0],link);assert.equal(h.doc.activeElement,link);assert.equal(refs.numbers.open,true);assert.equal(refs.content.scrollTop,240);
  raw.data[HISTORICAL]=raw.dividend_fact.value=0;h.view.render({...viewState,data:profile.normalize(raw,REGIONAL_KEY,NOW)});assert.equal(refs.historical.value.textContent,'0円');assert.equal(refs.historical.unknown.hidden,true);
  raw.historical_dividend_error='fetch_error';h.view.render({...viewState,data:profile.normalize(raw,REGIONAL_KEY,NOW)});assert.match(refs.historical.note.textContent,/通信エラー.*保存済み/);
});
test('annual loading and invalidation are unknown values while an unconfigured service keeps the old layout',()=>{
  const h=dialogHarness();h.view.open(REGIONAL_KEY,'表示テスト企業',h.trigger);const refs=h.view.elements;
  const pending=filedFixture({data:{currency:'JPY'},dividend_fact:null,historical_dividend_status:'loading',historical_dividend_refreshing:true});h.view.render({symbol:REGIONAL_KEY,status:'pending',updating:true,data:profile.normalize(pending,REGIONAL_KEY,NOW)});assert.equal(refs.historical.value.textContent,'—');assert.equal(refs.historical.unknown.textContent,'取得中');assert.equal(refs.historical.source.hidden,true);assert.equal(refs.historical.time.hidden,true);assert.match(refs.status.textContent,/年度の実績配当を確認/);
  const invalid=filedFixture({data:{currency:'JPY'},dividend_fact:null,historical_dividend_status:'unconfirmed',historical_dividend_invalidated:true});h.view.render({symbol:REGIONAL_KEY,status:'ready',updating:false,data:profile.normalize(invalid,REGIONAL_KEY,NOW)});assert.equal(refs.historical.value.textContent,'—');assert.equal(refs.historical.unknown.textContent,'未確認');assert.equal(refs.historical.source.hidden,true);assert.equal(refs.historical.period.hidden,true);
  h.view.open(KEY,'トヨタ',h.trigger);h.view.render(state(fixture()));assert.equal(refs.historical.row.hidden,true);assert.equal(refs.reasonHelp.hidden,true);
});
test('sheet opens immediately and restores body, background accessibility, focus and scroll after close',()=>{
  const h=dialogHarness();h.view.open(KEY,'トヨタ',h.trigger);const refs=h.view.elements;
  assert.equal(refs.overlay.hidden,false);assert.equal(refs.name.textContent,'トヨタ');assert.equal(refs.code.textContent,'7203');assert.equal(h.doc.activeElement,refs.panel);assert.equal(h.home.inert,true);assert.equal(h.home.getAttribute('aria-hidden'),'true');assert.equal(h.doc.body.style.position,'fixed');
  h.home.scrollTop=0;h.view.close();assert.equal(refs.overlay.hidden,true);assert.equal(h.home.inert,false);assert.equal(h.home.getAttribute('aria-hidden'),null);assert.equal(h.nav.inert,true);assert.equal(h.nav.getAttribute('aria-hidden'),'true');assert.equal(h.doc.body.style.position,'');assert.equal(h.home.scrollTop,480);assert.equal(h.w.restoredScroll,95);assert.equal(h.doc.activeElement,h.trigger);
});
test('render preserves an open disclosure, uses each actual field date and inserts untrusted copy as text',()=>{
  const h=dialogHarness(),raw=fixture();raw.editorial.business='<img src=x onerror=alert(1)>';h.view.open(KEY,'トヨタ',h.trigger);h.view.render(state(raw));const refs=h.view.elements;
  assert.equal(refs.name.textContent,'トヨタ自動車');assert.equal(refs.business.body.textContent,raw.editorial.business);assert.equal(refs.business.body.children.length,0);assert.equal(refs.price.value.textContent,'3,210円');assert.match(refs.price.time.textContent,/14:59/);assert.match(refs.cap.time.textContent,/14:00/);assert.match(refs.target.time.textContent,/12:00/);assert.equal(refs.targetDate.textContent,'予想が出された日は提供元に記載がありません。');assert.match(refs.targetRange.textContent,/12人/);
  refs.numbers.open=true;refs.content.scrollTop=510;const firstSource=refs.sources.children[0];h.view.render(state(raw));assert.equal(refs.numbers.open,true);assert.equal(refs.content.scrollTop,510);assert.equal(refs.sources.children[0],firstSource);assert.equal(firstSource.children[0].rel,'noopener noreferrer');
});
test('missing prices, timestamps and editorials are explicit, while zero dividends and separate dates remain meaningful',()=>{
  const h=dialogHarness();h.view.open(KEY,'トヨタ',h.trigger);h.view.render({symbol:KEY,status:'loading',data:null,updating:true});const refs=h.view.elements;assert.equal(refs.business.body.textContent,'会社の説明を確認しています…');
  const raw=fixture({editorial:null});raw.data.price_updated_at=null;raw.data.annual_dividend=0;raw.data.ex_dividend_date='2020-09-29';raw.data.dividend_payment_date='2099-11-26';h.view.render(state(raw));
  assert.equal(refs.business.body.textContent,'この会社の説明はまだ掲載されていません');assert.equal(refs.life.section.hidden,true);assert.match(refs.price.time.textContent,/株価の時点：未確認/);assert.equal(refs.annual.value.textContent,'0円');assert.equal(refs.annual.unknown.hidden,true);assert.equal(refs.exDate.value.textContent,'次回未確認（過去の記録：2020/09/29）');assert.equal(refs.paymentDate.value.textContent,'2099/11/26（予定）');
  raw.data.price=null;h.view.render(state(raw));assert.equal(refs.price.value.textContent,'—');assert.equal(refs.price.unknown.hidden,false);assert.equal(refs.price.time.hidden,true);
});
test('company basics remain usable when financial data or editorial is missing, with the source date intact',()=>{
  const h=dialogHarness();h.view.open(KEY,'トヨタ自動車',h.trigger);
  const raw=fixture({name:KEY,identity:IDENTITY,status:'pending',refreshing:true,data:{currency:'JPY'},editorial:null,updated_at:null,sources:[]});h.view.render(state(raw,{updating:true}));const refs=h.view.elements;
  assert.equal(refs.name.textContent,'トヨタ自動車');assert.equal(refs.basic.hidden,false);assert.equal(refs.market.value.textContent,'プライム（内国株式）');assert.equal(refs.industry.value.textContent,'輸送用機器');assert.equal(refs.business.section.hidden,true);assert.equal(refs.price.value.textContent,'—');assert.equal(refs.price.unknown.hidden,false);assert.equal(refs.identityDate.textContent,'2026/09/23 会社一覧の基準日');assert.equal(refs.sources.children[0].children[0].href,IDENTITY.source_url);
  h.view.render(state(raw,{status:'error',updating:false}));assert.match(refs.status.textContent,/会社の基本情報を表示/);assert.equal(refs.retry.hidden,false);assert.equal(refs.basic.hidden,false);
  h.view.render({symbol:KEY,status:'error',data:null,updating:false});assert.equal(refs.name.textContent,'トヨタ自動車');assert.equal(refs.basic.hidden,true);assert.match(refs.business.body.textContent,/今は確認できません/);
});
test('structured company facts provide a sourced explanation while reviewed editorial remains preferred',()=>{
  const h=dialogHarness();h.view.open(KEY,'トヨタ',h.trigger);
  const overview={kind:'structured_company_facts',text:'日本の自動車メーカーです。',field_status:'available',source_url:'https://www.wikidata.org/wiki/Q53268',source_title:'Wikidata',fetched_at:NOW/1000,products:['自動車'],industry_labels:['自動車製造業']};
  const raw=fixture({identity:IDENTITY,editorial:null,business_overview:overview});h.view.render(state(raw));const refs=h.view.elements;
  assert.equal(refs.business.section.hidden,false);assert.equal(refs.business.body.textContent,overview.text);assert.equal(refs.businessSource.hidden,false);assert.equal(refs.businessSource.children.at(-1).href,overview.source_url);assert.match(refs.businessSource.textContent,/2026\/09\/24 15:00 取得.*Wikidata/);
  const link=refs.businessSource.children.at(-1);link.focus();h.view.render(state(raw));assert.equal(refs.businessSource.children.at(-1),link);assert.equal(h.doc.activeElement,link,'A quote update must not remove the focused business-source link');
  raw.editorial=fixture().editorial;h.view.render(state(raw));assert.equal(refs.business.body.textContent,raw.editorial.business);assert.equal(refs.businessSource.hidden,true);
  raw.editorial=null;raw.business_overview={kind:'structured_company_facts',field_status:'identity_unconfirmed'};h.view.render(state(raw));assert.equal(refs.business.section.hidden,false);assert.match(refs.business.body.textContent,/まだ確認できていません/);assert.equal(refs.businessSource.hidden,true);assert.equal(refs.industry.value.textContent,'輸送用機器');
  raw.business_overview={...overview,text:'<img onerror=alert(1)>',source_url:'javascript:alert(1)'};h.view.render(state(raw));assert.doesNotMatch(refs.business.body.textContent,/onerror/);assert.equal(refs.businessSource.hidden,true);
});
test('company price rows show delay, retained prices and unsupported regional sources without changing list dates',()=>{
  const h=dialogHarness();h.view.open(KEY,'トヨタ',h.trigger);
  const raw=fixture({market_data:{kind:'delayed',delay_minutes:20,quote_as_of:(NOW-60000)/1000,quote_is_recent:true}});h.view.render(state(raw));const refs=h.view.elements;
  assert.equal(refs.price.note.textContent,'20分遅延の株価');assert.equal(refs.price.time.textContent,'2026/09/24 14:59 株価時点 / 2026/09/24 15:00 取得');
  refs.numbers.open=true;refs.content.scrollTop=240;h.view.render(state(raw,{status:'stale',fromCache:true,updating:true}));assert.match(refs.price.note.textContent,/保存済み.*確認中/);assert.equal(refs.numbers.open,true);assert.equal(refs.content.scrollTop,240);
  const regional=fixture({symbol:'8301.JP',identity:{...IDENTITY,market:'福証単独上場'},name:'地域企業',editorial:null});h.view.open('8301.JP','地域企業',h.trigger);h.view.render({symbol:'8301.JP',status:'ready',data:profile.normalize(regional,'8301.JP',NOW),updating:false});
  assert.equal(refs.code.textContent,'8301');assert.equal(refs.price.value.textContent,'—');assert.equal(refs.price.unknown.textContent,'取得元未対応');assert.match(refs.price.note.textContent,/この取引所/);assert.equal(refs.market.value.textContent,'福証単独上場');
  assert.match(refs.status.textContent,/株価・配当・時価総額の取得元は未対応/);assert.equal(refs.numbers.open,false);
  h.view.render({symbol:'8301.JP',status:'pending',data:profile.normalize(regional,'8301.JP',NOW),updating:true});assert.match(refs.status.textContent,/株価・配当・時価総額の取得元は未対応/);assert.doesNotMatch(refs.status.textContent,/株価や配当の情報を確認しています/);
});
test('regional financial unavailability leaves its verified identity and sourced business readable',()=>{
  const h=dialogHarness(),key='1738.JP';h.view.open(key,'地域企業',h.trigger);
  const raw=fixture({symbol:key,name:'地域企業',status:'unavailable',refreshing:false,data:{currency:'JPY'},editorial:null,identity:{...IDENTITY,market:'名証メイン市場'},business_overview:{kind:'structured_company_facts',text:'住宅設備を扱う会社です。',field_status:'available',source_url:'https://www.wikidata.org/wiki/Q999',source_title:'Wikidata',fetched_at:NOW/1000}});
  h.view.render({symbol:key,status:'error',reason:'unavailable',data:profile.normalize(raw,key,NOW),updating:false});const refs=h.view.elements;
  assert.equal(refs.basic.hidden,false);assert.equal(refs.market.value.textContent,'名証メイン市場');assert.equal(refs.business.section.hidden,false);assert.equal(refs.business.body.textContent,raw.business_overview.text);assert.equal(refs.businessSource.hidden,false);
  assert.equal(refs.price.unknown.textContent,'取得元未対応');assert.equal(refs.price.value.textContent,'—');assert.equal(refs.annual.value.textContent,'—');
});
test('unsupported regional figures link only to the matching official market and keep link focus during refresh',()=>{
  const h=dialogHarness(),key='6147.JP';h.view.open(key,'地域企業',h.trigger);
  for(const [exchange,url] of [['Sapporo','https://www.sse.or.jp/market'],['Nagoya','https://www.nse.or.jp/market/condition/quick/'],['Fukuoka','https://www.fse.or.jp/market-info/daily/']]){
    const raw=fixture({symbol:key,name:'地域企業',identity:{...IDENTITY,exchange},editorial:null});
    const state={symbol:key,status:'ready',data:profile.normalize(raw,key,NOW),updating:false};h.view.render(state);const ref=h.view.elements.price.reference;
    assert.equal(ref.hidden,false);assert.equal(ref.children[0].href,url);assert.equal(ref.children[0].rel,'noopener noreferrer');
    const link=ref.children[0];link.focus();h.view.render(state);assert.equal(ref.children[0],link);assert.equal(h.doc.activeElement,link);
    assert.equal(h.view.elements.price.value.textContent,'—');
  }
  const invalid=fixture({symbol:key,identity:{...IDENTITY,exchange:'Tokyo'}});h.view.render({symbol:key,status:'ready',data:profile.normalize(invalid,key,NOW)});assert.equal(h.view.elements.price.reference.hidden,true);
  h.view.open(KEY,'トヨタ',h.trigger);h.view.render({symbol:KEY,status:'ready',data:profile.normalize(fixture({identity:{...IDENTITY,exchange:'Tokyo'}}),KEY,NOW)});assert.equal(h.view.elements.price.reference.hidden,true);
});
test('scanner closing-price dates are explicit; precise quote times take precedence when present',()=>{
  const h=dialogHarness();h.view.open(KEY,'トヨタ',h.trigger);const raw=fixture();raw.data.price_updated_at=null;raw.data.price_trade_date='2026-09-23';h.view.render(state(raw));const refs=h.view.elements;
  assert.match(refs.price.time.textContent,/2026\/09\/23 終値/);assert.doesNotMatch(refs.price.time.textContent,/株価の時点：未確認/);
  raw.data.price_updated_at=(NOW-60000)/1000;h.view.render(state(raw));assert.match(refs.price.time.textContent,/2026\/09\/24 14:59 株価時点/);assert.doesNotMatch(refs.price.time.textContent,/終値/);
});
test('company metadata shares date-first JST formatting without inventing release times',()=>{
  const h=dialogHarness();h.view.open(KEY,'トヨタ',h.trigger);
  const raw=fixture({identity:IDENTITY});raw.data.analyst_target.as_of='2026-09-23';h.view.render(state(raw));const refs=h.view.elements;
  assert.equal(refs.price.time.textContent,'2026/09/24 14:59 株価時点 / 2026/09/24 15:00 取得');
  assert.equal(refs.cap.time.textContent,'2026/09/24 14:00 取得');assert.equal(refs.annual.time.textContent,'2026/09/24 14:00 取得');
  assert.equal(refs.targetDate.textContent,'2026/09/23 予想');assert.equal(refs.reviewed.textContent,'2026/09/24 会社の説明を確認');assert.equal(refs.identityDate.textContent,'2026/09/23 会社一覧の基準日');
  assert.doesNotMatch(refs.reviewed.textContent,/\d{2}:\d{2}/);
  const yahoo=refs.sources.children.find(row=>row.children.some(node=>node.href==='https://finance.yahoo.com/quote/7203.T/'));
  assert.deepEqual(yahoo.children.map(node=>node.textContent),['2026/09/24 15:00 取得','Yahoo Finance ↗']);assert.equal(yahoo.children[1].rel,'noopener noreferrer');
  const editorial=refs.sources.children[0];assert.equal(editorial.children.length,1);assert.equal(editorial.children[0].textContent,'会社の公式サイト ↗');
});
test('empty metric labels change individually and explain source omissions without claiming nonpublication',()=>{
  const h=dialogHarness();h.view.open(KEY,'トヨタ',h.trigger);const refs=h.view.elements;
  const raw=fixture({data:{currency:'JPY'},field_status:{price:'loading',market_cap:'source_missing',annual_dividend:'fetch_error',forward_annual_dividend_per_share:'invalid',ex_dividend_date:'unconfirmed',dividend_payment_date:'source_missing',analyst_target:'unconfirmed'},status:'pending',refreshing:true});
  h.view.render(state(raw,{updating:true}));assert.equal(refs.price.unknown.textContent,'取得中');assert.equal(refs.cap.unknown.textContent,'提供元に情報なし');assert.equal(refs.annual.unknown.textContent,'通信エラー');assert.equal(refs.forward.unknown.textContent,'内容を確認中');assert.equal(refs.exDate.unknown.textContent,'未確認');assert.equal(refs.paymentDate.unknown.textContent,'提供元に情報なし');assert.equal(refs.target.unknown.textContent,'未確認');
  assert.equal(refs.reasonHelp.hidden,false);assert.equal(refs.reasonHelp.open,false);assert.match(refs.reasonHelp.textContent,/会社が未公表とは限りません/);assert.equal(refs.reasonHelp.querySelector('summary').textContent,'表示の意味');
  refs.numbers.open=true;refs.reasonHelp.open=true;refs.content.scrollTop=230;h.view.render(state(fixture()));assert.equal(refs.reasonHelp.hidden,true);assert.equal(refs.numbers.open,true);assert.equal(refs.content.scrollTop,230);assert.equal(refs.price.unknown.hidden,true);
});
test('missing dividend dates show their actual reason instead of a generic date-helper placeholder',()=>{
  const h=dialogHarness();h.view.open(KEY,'トヨタ',h.trigger);const calls=[];h.w.KNDividendDates={describe(value){calls.push(value);return '次回未確認';}};
  const raw=fixture({data:{currency:'JPY'},field_status:{ex_dividend_date:'source_missing',dividend_payment_date:'fetch_error'}});h.view.render(state(raw));const refs=h.view.elements;
  assert.deepEqual(calls,[]);assert.equal(refs.exDate.value.textContent,'—');assert.equal(refs.exDate.unknown.hidden,false);assert.equal(refs.exDate.unknown.textContent,'提供元に情報なし');assert.equal(refs.paymentDate.value.textContent,'—');assert.equal(refs.paymentDate.unknown.hidden,false);assert.equal(refs.paymentDate.unknown.textContent,'通信エラー');
});
test('an average target can be unconfirmed while a valid low-to-high forecast remains visible',()=>{
  const h=dialogHarness();h.view.open(KEY,'トヨタ',h.trigger);const raw=fixture({field_status:{analyst_target:'available'}});raw.data.analyst_target={mean:null,low:2900,high:4100,analyst_count:12,currency:'JPY'};h.view.render(state(raw));const refs=h.view.elements;
  assert.equal(refs.target.value.textContent,'—');assert.equal(refs.target.unknown.hidden,false);assert.equal(refs.target.unknown.textContent,'未確認');assert.equal(refs.targetRange.hidden,false);assert.match(refs.targetRange.textContent,/2,900円〜4,100円/);
});
test('a payment month stays month-precise and never invents a payment day',()=>{
  const h=dialogHarness();h.view.open(KEY,'トヨタ',h.trigger);const raw=fixture();raw.data.dividend_payment_date=null;raw.data.dividend_payment_period='2099-11';raw.source.fields.dividend_payment_period={fetched_at:(NOW-2*3600000)/1000};h.view.render(state(raw));
  const refs=h.view.elements;assert.equal(refs.paymentDate.value.textContent,'2099/11（予定）');assert.match(refs.paymentDate.time.textContent,/日付は未確認/);assert.match(refs.paymentDate.time.textContent,/13:00/);assert.equal(refs.paymentDate.unknown.hidden,true);
  raw.data.dividend_payment_period='2026-13';h.view.render(state(raw));assert.equal(refs.paymentDate.value.textContent,'—');assert.equal(refs.paymentDate.unknown.hidden,false);
  raw.data.dividend_payment_period='2099-11';raw.data.dividend_payment_date='2099-11-26';h.view.render(state(raw));assert.equal(refs.paymentDate.value.textContent,'2099/11/26（予定）');
});
test('focus cycles only visible controls, keyboard viewport changes are respected and Escape closes',()=>{
  const h=dialogHarness();h.view.open(KEY,'トヨタ',h.trigger);h.view.render(state());const refs=h.view.elements;
  const links=refs.panel.querySelectorAll('a[href]'),last=links.at(-1);refs.closeButton.focus();assert.equal(h.key('Tab',true).prevented,true);assert.equal(h.doc.activeElement,last);assert.equal(h.key('Tab').prevented,true);assert.equal(h.doc.activeElement,refs.closeButton);
  h.doc.activeElement=h.trigger;for(const fn of h.events.focusin)fn({target:h.trigger});assert.equal(h.doc.activeElement,refs.closeButton);
  h.vv.height=390;h.vv.offsetTop=35;h.vv.events.resize();assert.equal(refs.overlay.style['--cp-viewport-height'],'390px');assert.equal(refs.overlay.style['--cp-viewport-top'],'35px');
  const event=h.key('Escape');assert.equal(event.prevented,true);assert.equal(event.stopped,true);assert.equal(refs.overlay.hidden,true);
});
test('backdrop close, removed opener fallback and reopening mid-animation preserve state',async()=>{
  const h=dialogHarness({reduced:false});h.view.open(KEY,'トヨタ',h.trigger);const refs=h.view.elements;refs.overlay.dispatch('click',{target:refs.backdrop});assert.equal(refs.overlay.dataset.closing,'true');h.view.open(KEY,'トヨタ',h.trigger);assert.equal(refs.overlay.dataset.closing,undefined);await h.time.advance(180);assert.equal(refs.overlay.hidden,false);
  h.home.children=h.home.children.filter(n=>n!==h.trigger);h.trigger.parentNode=null;h.view.close();await h.time.advance(180);assert.equal(refs.overlay.hidden,true);assert.equal(h.home.inert,false);assert.equal(h.doc.activeElement,h.doc.fallback);
});
test('closing after company cards refresh returns focus to the same company in the news frame',()=>{
  const h=dialogHarness(),stories=h.doc.createElement('section');stories.id='knCompanyFocus';h.home.appendChild(stories);stories.appendChild(h.trigger);h.trigger.dataset.companyProfile=KEY;
  h.view.open(KEY,'トヨタ',h.trigger);const replacement=h.doc.createElement('button');replacement.dataset.companyProfile=KEY;stories.replaceChildren(replacement);
  assert.equal(h.trigger.isConnected,false);h.view.close();assert.equal(h.doc.activeElement,replacement);assert.equal(h.home.inert,false);
});
test('removed news openers use the existing fallback when their replacement is absent or unavailable',()=>{
  for(const unavailable of ['different company','hidden','disabled','aria disabled','removed frame']){
    const h=dialogHarness(),stories=h.doc.createElement('section');stories.id='knCompanyFocus';h.home.appendChild(stories);stories.appendChild(h.trigger);h.trigger.dataset.companyProfile=KEY;
    const outside=h.doc.createElement('button');outside.dataset.companyProfile=KEY;h.home.appendChild(outside);
    h.view.open(KEY,'トヨタ',h.trigger);const replacement=h.doc.createElement('button');replacement.dataset.companyProfile=unavailable==='different company'?'9432.T':KEY;stories.replaceChildren(replacement);
    if(unavailable==='hidden')stories.hidden=true;if(unavailable==='disabled')replacement.disabled=true;if(unavailable==='aria disabled')replacement.setAttribute('aria-disabled','true');
    if(unavailable==='removed frame'){h.home.children=h.home.children.filter(node=>node!==stories);stories.parentNode=null;}
    h.view.close();assert.equal(h.doc.activeElement,h.doc.fallback,unavailable+' must not focus a different, hidden or outside company button');
  }
});
test('delegated company button does not toggle its article, closes cancel requests and late data stays hidden',async()=>{
  const h=dialogHarness(),requests=[];h.w.fetch=(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}));const api=profile.start(h.w);h.trigger.dataset.companyProfile=KEY;h.trigger.dataset.companyName='トヨタ';let prevented=false,stopped=false;
  for(const fn of h.events.click)fn({target:h.trigger,preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});await flush();assert.equal(prevented,true);assert.equal(stopped,true);assert.equal(requests.length,1);const overlay=h.doc.body.children.at(-1);assert.equal(overlay.hidden,false);
  api.close();assert.equal(requests[0].options.signal.aborted,true);assert.equal(overlay.hidden,true);requests[0].resolve({ok:true,json:async()=>fixture()});await flush();assert.equal(overlay.hidden,true);assert.equal(h.home.inert,false);
});
test('only the selected visible Tokyo company requests minute quotes; previews and regional identities do not',async()=>{
  const h=dialogHarness(),requests=[];h.w.fetch=(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}));const api=profile.start(h.w);
  const reply=async(index,raw=fixture())=>{requests[index].resolve({ok:true,json:async()=>raw});await flush();};
  api.open(KEY,'トヨタ',h.trigger);await flush();assert.match(requests[0].url,/purpose=detail/);await reply(0);
  await h.time.advance(59999);assert.equal(requests.length,1);await h.time.advance(1);assert.equal(requests.length,2);await reply(1);
  h.doc.hidden=true;for(const fn of h.events.visibilitychange)fn();await h.time.advance(120000);assert.equal(requests.length,2);
  h.doc.hidden=false;for(const fn of h.events.visibilitychange)fn();await flush();assert.equal(requests.length,3);await reply(2);
  const preview=api.createFactsLoader(()=>{});preview.load('9432.T');await flush();assert.match(requests[3].url,/symbol=9432.T&purpose=preview/);await reply(3,fixture({symbol:'9432.T'}));
  api.close();await h.time.advance(120000);assert.equal(requests.length,4,'Closing cancels the selected quote refresh and a completed preview never starts a minute timer');
  api.open('8301.JP','地域企業',h.trigger);await flush();assert.match(requests[4].url,/symbol=8301.JP&purpose=detail/);await reply(4,fixture({symbol:'8301.JP',status:'ready',data:{currency:'JPY'}}));await h.time.advance(120000);assert.equal(requests.length,5);
  api.close();
});
test('backgrounding a company cancels its pending request and ignores the late reply until visible again',async()=>{
  const h=dialogHarness(),requests=[];h.w.fetch=(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}));const api=profile.start(h.w);
  api.open(KEY,'トヨタ',h.trigger);await flush();h.doc.hidden=true;for(const fn of h.events.visibilitychange)fn();assert.equal(requests[0].options.signal.aborted,true);
  requests[0].resolve({ok:true,json:async()=>fixture()});await flush();await h.time.advance(120000);assert.equal(requests.length,1);
  h.doc.hidden=false;for(const fn of h.events.visibilitychange)fn();await flush();assert.equal(requests.length,2);api.close();assert.equal(requests[1].options.signal.aborted,true);
});
test('selected quote refresh respects provider backoff and does not repeat unknown-company failures',async()=>{
  const h=dialogHarness(),requests=[];h.w.fetch=(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}));const api=profile.start(h.w);
  api.open(KEY,'トヨタ',h.trigger);await flush();requests[0].resolve({ok:true,json:async()=>fixture({retry_after_seconds:180})});await flush();
  await h.time.advance(179999);assert.equal(requests.length,1);await h.time.advance(1);assert.equal(requests.length,2);
  requests[1].resolve({ok:false,status:404,json:async()=>({error:'company_not_found'})});await flush();await h.time.advance(180000);assert.equal(requests.length,2);api.close();
});
test('minute quotes stay disabled unless a current API response explicitly enables them, regardless of old caches',async()=>{
  for(const enabled of [false,undefined,'true']){
    const h=dialogHarness(),requests=[];h.w.localStorage.setItem(PREFIX+KEY,JSON.stringify(fixture({quote_refresh_enabled:true})));h.w.fetch=(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}));const api=profile.start(h.w);
    api.open(KEY,'トヨタ',h.trigger);await flush();const raw=fixture({quote_refresh_enabled:enabled,updated_at:null});requests[0].resolve({ok:true,json:async()=>raw});await flush();
    await h.time.advance(180000);assert.equal(requests.length,1);assert.equal(profile.normalize(raw,KEY,NOW).quote_refresh_enabled,false);api.close();
  }
  const h=dialogHarness(),requests=[];h.w.localStorage.setItem(PREFIX+KEY,JSON.stringify(fixture({quote_refresh_enabled:true})));h.w.fetch=(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}));const api=profile.start(h.w);
  api.open(KEY,'トヨタ',h.trigger);await flush();requests[0].resolve({ok:false,status:404});await flush();await h.time.advance(180000);assert.equal(requests.length,1,'A saved capability cannot arm a minute timer after a failed API request');api.close();
});
test('public business summaries preserve attribution and their distinct dates through cache normalization',()=>{
  const overview={kind:'public_company_business',field_status:'available',text:'求人情報の提供と職業紹介を行う会社です。',source_url:'https://shokuba.mhlw.go.jp/shokuba/utilize/utilize010.do',source_title:'厚生労働省・しょくばらぼ',source_updated_on:'2026-09-24',source_record_updated_on:'2026-05-28',use_basis:'independent_summary_of_business_facts',fetched_at:NOW/1000};
  const clean=profile.normalize(fixture({editorial:null,business_overview:overview}),KEY,NOW);
  assert.equal(clean.business_overview.text,overview.text);assert.equal(clean.business_overview.source_record_updated_on,'2026-05-28');assert.match(clean.business_overview.attribution_notice,/当サイトが説明を作成/);
  assert.equal(profile.normalize(clean,KEY,NOW).business_overview.text,overview.text,'A saved summary retains its independently written provenance');
  for(const patch of [{source_url:'https://example.com/'},{use_basis:'unreviewed_original'},{source_updated_on:'2026-09-25'},{source_record_updated_on:'2026-09-25'}])assert.equal(profile.normalize(fixture({editorial:null,business_overview:{...overview,...patch}}),KEY,NOW).business_overview,null);
});
test('public summary display keeps source attribution, update dates and existing prices apart',()=>{
  const h=dialogHarness();h.view.open(KEY,'会社',h.trigger);
  const overview={kind:'public_company_business',field_status:'available',text:'求人情報の提供と職業紹介を行う会社です。',source_url:'https://shokuba.mhlw.go.jp/shokuba/utilize/utilize010.do',source_title:'厚生労働省・しょくばらぼ',source_updated_on:'2026-09-24',source_record_updated_on:'2026-05-28',use_basis:'independent_summary_of_business_facts',fetched_at:NOW/1000};
  const data=profile.normalize(fixture({editorial:null,business_overview:overview}),KEY,NOW);h.view.render({symbol:KEY,status:'ready',updating:false,data});const refs=h.view.elements;
  assert.equal(refs.business.body.textContent,overview.text);assert.equal(refs.businessSource.hidden,false);assert.equal(refs.businessSource.children.find(n=>n.tagName==='A').href,overview.source_url);
  assert.match(refs.businessSource.children.map(n=>n.textContent).join(' '),/2026\/05\/28 企業掲載情報の更新/);assert.match(refs.businessSource.children.map(n=>n.textContent).join(' '),/2026\/09\/24 一括データ更新/);assert.match(refs.businessSource.children.at(-1).textContent,/事業情報をもとに当サイトが説明を作成/);
  assert.equal(refs.life.section.hidden,true);assert.equal(data.data.price,fixture().data.price);
});

test('issuer fiscal forecast is independent of historical and annualized values and accepts a verified zero',()=>{
  const raw=issuerForecastFixture();raw.data.forward_annual_dividend_per_share=100;raw.data.forward_dividend_basis='annualized';
  const clean=profile.normalize(raw,REGIONAL_KEY,NOW);assert.equal(clean.data[ISSUER_FORECAST],60);assert.equal(clean.data[HISTORICAL],50.5);assert.equal(clean.data.forward_annual_dividend_per_share,null);assert.equal(clean.data.price,null);
  raw.data[ISSUER_FORECAST]=raw.issuer_dividend_forecast.value=0;const zero=profile.normalize(raw,REGIONAL_KEY,NOW);assert.equal(zero.data[ISSUER_FORECAST],0);assert.equal(profile.fieldReason({data:zero},ISSUER_FORECAST),'');
  raw.issuer_dividend_forecast_status=raw.issuer_dividend_forecast.status='undetermined';raw.issuer_dividend_forecast.value=null;delete raw.data[ISSUER_FORECAST];const undetermined=profile.normalize(raw,REGIONAL_KEY,NOW);assert.equal(undetermined.data[ISSUER_FORECAST],null);assert.equal(undetermined.issuer_dividend_forecast.status,'undetermined');
});
test('wrong-company, unsafe or misdated issuer forecasts never become a number or source link',()=>{
  for(const change of [{security_code:'7203'},{issuer_name:'別会社'},{exchange:'Tokyo'},{currency:'USD'},{unit:'JPY'},{value:true},{value:-1},{source_url:issuerForecastFixture().issuer_dividend_forecast.source_url+'?token=secret'},{source_host:'different.example'},{announcement_date:'2099-01-01'},{fetched_at:(NOW+1000)/1000},{fiscal_period:{start:'2027-04-01',end:'2027-03-31'}},{latest_revision_guaranteed:true}]){
    const raw=issuerForecastFixture();Object.assign(raw.issuer_dividend_forecast,change);raw.sources=[{title:'予想',url:raw.issuer_dividend_forecast.source_url}];const clean=profile.normalize(raw,REGIONAL_KEY,NOW);assert.equal(clean.issuer_dividend_forecast,null);assert.equal(clean.data[ISSUER_FORECAST],null);assert.deepEqual(clean.sources,[]);
  }
  const mismatch=issuerForecastFixture();mismatch.data[ISSUER_FORECAST]=61;assert.equal(profile.normalize(mismatch,REGIONAL_KEY,NOW).issuer_dividend_forecast,null);
});
test('later issuer revisions and explicit undetermined forecasts survive cache while old announcements cannot roll them back',async()=>{
  const h=loaderHarness();await h.load(REGIONAL_KEY);await h.reply(0,issuerForecastFixture());
  const newer=issuerForecastFixture();newer.issuer_dividend_forecast.announcement_date='2026-08-20';newer.issuer_dividend_forecast.value=newer.data[ISSUER_FORECAST]=70;
  await h.load(REGIONAL_KEY);await h.reply(1,newer);assert.equal(h.states.at(-1).data.data[ISSUER_FORECAST],70);
  await h.load(REGIONAL_KEY);await h.reply(2,issuerForecastFixture());assert.equal(h.states.at(-1).data.data[ISSUER_FORECAST],70);
  const unknown=issuerForecastFixture();unknown.issuer_dividend_forecast.announcement_date='2026-09-20';unknown.issuer_dividend_forecast.status=unknown.issuer_dividend_forecast_status='undetermined';unknown.issuer_dividend_forecast.value=null;delete unknown.data[ISSUER_FORECAST];
  await h.load(REGIONAL_KEY);await h.reply(3,unknown);assert.equal(h.states.at(-1).data.data[ISSUER_FORECAST],null);assert.equal(h.states.at(-1).data.issuer_dividend_forecast.status,'undetermined');
  const reloaded=loaderHarness(h.storage);await reloaded.load(REGIONAL_KEY);assert.equal(reloaded.states[0].data.issuer_dividend_forecast.status,'undetermined');assert.equal(reloaded.states[0].data.issuer_dividend_forecast.announcement_date,'2026-09-20');
});
test('issuer forecast row shows fiscal period, real publication date and source while retaining focus',()=>{
  const h=dialogHarness();h.view.open(REGIONAL_KEY,'表示テスト企業',h.trigger);const raw=issuerForecastFixture(),viewState={symbol:REGIONAL_KEY,status:'ready',data:profile.normalize(raw,REGIONAL_KEY,NOW),updating:false};h.view.render(viewState);const refs=h.view.elements;
  assert.equal(refs.issuerForecast.row.hidden,false);assert.equal(refs.issuerForecast.value.textContent,'60円');assert.equal(refs.issuerForecast.period.textContent,'2026/04/01〜2027/03/31 対象年度');assert.equal(refs.issuerForecast.time.textContent,'2026/07/28 公表 / 2026/09/24 14:59 取得');assert.match(refs.issuerForecast.note.textContent,/資料公表時点/);assert.match(refs.issuerForecast.note.textContent,/最新の修正は保証されません/);assert.match(refs.status.textContent,/会社の年度予想配当/);
  refs.numbers.open=true;const link=refs.issuerForecast.source.children[0];link.focus();h.view.render(viewState);assert.equal(refs.issuerForecast.source.children[0],link);assert.equal(h.doc.activeElement,link);
  raw.issuer_dividend_forecast.status=raw.issuer_dividend_forecast_status='undetermined';raw.issuer_dividend_forecast.value=null;delete raw.data[ISSUER_FORECAST];h.view.render({...viewState,data:profile.normalize(raw,REGIONAL_KEY,NOW)});assert.equal(refs.issuerForecast.value.textContent,'未定');assert.equal(refs.issuerForecast.unknown.hidden,true);
  delete raw.historical_dividend_status;h.view.render({...viewState,data:profile.normalize(raw,REGIONAL_KEY,NOW)});assert.match(refs.status.textContent,/会社の年度予想配当/);assert.doesNotMatch(refs.status.textContent,/株価・配当・時価総額/);
});

test('issuer ranges and mixed split bases retain their exact meaning and expired periods are explicit',()=>{
  const raw=issuerForecastFixture(),h=dialogHarness();h.view.open(REGIONAL_KEY,raw.name,h.trigger);
  raw.issuer_dividend_forecast.status=raw.issuer_dividend_forecast_status='range';raw.issuer_dividend_forecast.value=null;raw.issuer_dividend_forecast.value_range={min:1.34,max:2.01};delete raw.data[ISSUER_FORECAST];
  let clean=profile.normalize(raw,REGIONAL_KEY,NOW);h.view.render({symbol:REGIONAL_KEY,status:'ready',data:clean});assert.equal(clean.data[ISSUER_FORECAST],null);assert.equal(h.view.elements.issuerForecast.value.textContent,'1.34〜2.01円');
  raw.issuer_dividend_forecast.value_range={min:2,max:1};assert.equal(profile.normalize(raw,REGIONAL_KEY,NOW).issuer_dividend_forecast,null);
  raw.issuer_dividend_forecast.status=raw.issuer_dividend_forecast_status='not_comparable';raw.issuer_dividend_forecast.reason='split_basis_mismatch';raw.issuer_dividend_forecast.fiscal_period={start:'2025-09-01',end:'2026-08-31'};
  clean=profile.normalize(raw,REGIONAL_KEY,NOW);h.view.render({symbol:REGIONAL_KEY,status:'ready',data:clean});assert.equal(h.view.elements.issuerForecast.value.textContent,'年間額は比較不可');assert.match(h.view.elements.issuerForecast.note.textContent,/中間と期末で株式分割/);assert.match(h.view.elements.issuerForecast.note.textContent,/対象年度は終了/);assert.equal(clean.data[ISSUER_FORECAST],null);
});
test('reviewed report business summaries preserve public document provenance and reject credential URLs',()=>{
  const raw=fixture({editorial:null,business_overview:{kind:'reviewed_company_business',text:'電子部品の検査装置を開発する会社です。',field_status:'available',source_kind:'public_annual_report',source_url:'https://info.gbiz.go.jp/hojin/edinetDownload?docId=S100ABCD',source_title:'Gビズインフォ 公開有価証券報告書',source_published_on:'2026-06-26',reviewed_on:'2026-09-24',fetched_at:NOW/1000,use_basis:'independent_summary_of_business_facts'}});
  const clean=profile.normalize(raw,KEY,NOW);assert.equal(clean.business_overview.text,raw.business_overview.text);assert.equal(clean.business_overview.source_published_on,'2026-06-26');assert.equal(profile.normalize(clean,KEY,NOW).business_overview.text,raw.business_overview.text);
  const h=dialogHarness();h.view.open(KEY,raw.name,h.trigger);h.view.render(state(raw));assert.match(h.view.elements.businessSource.textContent,/2026\/06\/26 提出/);assert.match(h.view.elements.businessSource.textContent,/当サイトが説明を作成/);
  raw.business_overview.source_url+='&token=secret';assert.equal(profile.normalize(raw,KEY,NOW).business_overview,null);
});
test('issuer-reported fiscal PER stays independent of current quotes and retains seconds across cache normalization',()=>{
  const raw=yearPerFixture(),clean=profile.normalize(raw,KEY,NOW);
  assert.equal(clean.year_per.value,12.12345678);assert.equal(clean.data[YEAR_PER],12.12345678);assert.equal(clean.data.price,3210);
  assert.equal(clean.year_per.fetched_at,(NOW-1000)/1000);assert.equal(clean.source.fields[YEAR_PER].fetched_at,NOW-1000);
  assert.equal(clean.year_per.price_reference_date,null);assert.equal(clean.year_per.price_basis,'not_stated');assert.equal(clean.sources[0].url,raw.year_per.source_url);
  const cached=profile.normalize(clean,KEY,NOW);assert.equal(cached.year_per.fetched_at,clean.year_per.fetched_at);assert.equal(cached.data[YEAR_PER],12.12345678);assert.equal(cached.sources[0].fetched_at,NOW-1000);
  raw.data[YEAR_PER]=13;assert.equal(profile.normalize(raw,KEY,NOW).year_per,null);
  raw.data[YEAR_PER]=12.12345678;raw.year_per_status='not_presented';assert.equal(profile.normalize(raw,KEY,NOW).year_per,null);
});
test('PER normalization rejects wrong identities, unsafe disclosure URLs and unsupported accounting without exporting links',()=>{
  const original=yearPerFixture();
  for(const patch of [{symbol:'7203.JP'},{security_code:'7202'},{issuer_name:'別会社'},{exchange:'Sapporo'},{accounting_standard:'other'},{basis:'other'},{value:0},{value:NaN},{value:12.123456789},{unit:'yen'},{use_basis:'unreviewed'},{latest_filing_guaranteed:true},{doc_id:'S100ABCD'},{source_url:original.year_per.source_url+'?token=secret'},{source_url:'https://info.gbiz.go.jp/hojin/edinetDownload?docId=S100TEST&key=secret'},{source_url:'https://example.com/S100TEST.pdf'},{fetched_at:(NOW+1000)/1000},{price_basis:'period_end_explicit',price_reference_date:null}]){
    const raw=yearPerFixture();Object.assign(raw.year_per,patch);raw.sources=[{title:'有価証券報告書',url:raw.year_per.source_url}];raw.source.url=raw.year_per.source_url;
    const clean=profile.normalize(raw,KEY,NOW);assert.equal(clean.year_per,null,JSON.stringify(patch));assert.equal(clean.data[YEAR_PER],null);assert.equal(clean.year_per_invalidated,true);assert.deepEqual(clean.sources,[]);
  }
  const validGbiz=yearPerFixture();validGbiz.year_per.source_url='https://info.gbiz.go.jp/hojin/edinetDownload?docId=S100TEST';validGbiz.sources[0].url=validGbiz.year_per.source_url;assert.equal(profile.normalize(validGbiz,KEY,NOW).sources[0].url,validGbiz.year_per.source_url);
});
test('the latest PER fiscal year and corrected filing win regardless of quote freshness; an explicit omission replaces an old number',async()=>{
  const h=loaderHarness();await h.load();await h.reply(0,yearPerFixture());
  const older=yearPerFixture();older.year_per.fiscal_period={start:'2024-04-01',end:'2025-03-31'};older.year_per.filed_on='2025-06-30';older.year_per.value=older.data[YEAR_PER]=1;older.year_per.fetched_at=NOW/1000;
  await h.load();await h.reply(1,older);let current=h.states.at(-1).data;assert.equal(current.year_per.value,12.12345678);assert.equal(current.year_per.fiscal_period.end,'2026-03-31');assert.equal(current.year_per.fetched_at,(NOW-1000)/1000);
  const correction=yearPerFixture();correction.year_per.filed_on='2026-07-01';correction.year_per.value=correction.data[YEAR_PER]=15.5;
  await h.load();await h.reply(2,correction);assert.equal(h.states.at(-1).data.year_per.value,15.5);
  await h.load();await h.reply(3,yearPerFixture());assert.equal(h.states.at(-1).data.year_per.value,15.5,'An older filing cannot roll back a correction within the same fiscal year');
  const absent=yearPerFixture();absent.year_per.filed_on='2026-07-02';absent.year_per.status=absent.year_per_status='not_presented';absent.year_per.value=absent.data[YEAR_PER]=null;absent.year_per.reason='loss_eps';
  await h.load();await h.reply(4,absent);current=h.states.at(-1).data;assert.equal(current.data[YEAR_PER],null);assert.equal(current.year_per.reason,'loss_eps');assert.equal(current.year_per.filed_on,'2026-07-02');
  const reloaded=loaderHarness(h.storage);await reloaded.load();assert.equal(reloaded.states[0].data.year_per.reason,'loss_eps');assert.equal(reloaded.states[0].data.year_per.fetched_at,(NOW-1000)/1000);
});
test('a PER-only response caches using its real acquisition seconds and HTTP failures preserve its original dates',async()=>{
  const raw=yearPerFixture({data:{currency:'JPY',[YEAR_PER]:12.12345678},updated_at:null,source:{fields:{}},editorial:null,quote_refresh_enabled:false}),h=loaderHarness();
  await h.load();await h.reply(0,raw);assert.equal(h.loader.peek(KEY).year_per.value,12.12345678);
  const reloaded=loaderHarness(h.storage);await reloaded.load();assert.equal(reloaded.states[0].data.year_per.fetched_at,(NOW-1000)/1000);
  await h.load();await h.reply(1,null,503);await h.time.advance(1000);await h.reply(2,null,503);await h.time.advance(3000);await h.reply(3,null,503);
  const final=h.states.at(-1);assert.equal(final.reason,'fetch_error');assert.equal(final.data.year_per.fetched_at,(NOW-1000)/1000);assert.equal(final.data.year_per.filed_on,'2026-06-30');assert.equal(final.data.year_per.price_reference_date,null);assert.equal(final.data.data.price,null);
});
test('invalid or removed PER clears only its fact and source while other saved facts survive and reload cannot restore it',async()=>{
  for(const replacement of ['wrong_company','unconfirmed']){
    const h=loaderHarness();await h.load();await h.reply(0,yearPerFixture());await h.load();const raw=yearPerFixture({updated_at:null});
    if(replacement==='wrong_company')raw.year_per.issuer_name='別会社';else{raw.year_per=null;raw.year_per_status='unconfirmed';raw.data[YEAR_PER]=null;}
    await h.reply(1,raw);const clean=h.states.at(-1).data;assert.equal(clean.year_per,null);assert.equal(clean.data[YEAR_PER],null);assert.equal(clean.data.price,3210);assert.ok(clean.sources.every(source=>!source.url.includes('S100TEST')));
    const reloaded=loaderHarness(h.storage);await reloaded.load();assert.equal(reloaded.states[0].data.year_per,null);assert.ok(reloaded.states[0].data.sources.every(source=>!source.url.includes('S100TEST')));
  }
  const h=loaderHarness(),good=yearPerFixture({data:{currency:'JPY',[YEAR_PER]:12.12345678},updated_at:null,source:{fields:{}},editorial:null});await h.load();await h.reply(0,good);await h.load();
  await h.reply(1,{...good,data:{currency:'JPY'},year_per:null,year_per_status:'unconfirmed',sources:[]});assert.equal(h.loader.peek(KEY),null);
  const reloaded=loaderHarness(h.storage);await reloaded.load();assert.equal(reloaded.states[0].data,null);
});
test('PER detail shows fiscal year, accounting scope, actual source dates and ambiguous price timing without disturbing focus',()=>{
  const h=dialogHarness();h.view.open(KEY,'トヨタ',h.trigger);const raw=yearPerFixture();h.view.render(state(raw));const refs=h.view.elements;
  assert.equal(refs.yearPer.row.hidden,false);assert.match(refs.yearPer.row.textContent,/有報の年度PER（実績）/);assert.equal(refs.yearPer.value.textContent,'12.12345678倍');assert.equal(refs.yearPer.unknown.hidden,true);
  assert.equal(refs.yearPer.period.textContent,'2025/04/01〜2026/03/31 対象年度 / 連結・日本基準');assert.equal(refs.yearPer.time.textContent,'2026/06/30 提出 / 2026/09/24 14:59 取得');
  assert.match(refs.yearPer.note.textContent,/当サイトが有価証券報告書から年度PERを抜粋/);assert.match(refs.yearPer.note.textContent,/現在の株価から算定したPERではありません/);assert.match(refs.yearPer.note.textContent,/算定に使った株価の時点は資料に明記されていません/);assert.doesNotMatch(refs.yearPer.note.textContent,/2026\/03\/31.*算定株価/);
  const link=refs.yearPer.source.children[0];assert.equal(link.href,raw.year_per.source_url);assert.equal(link.rel,'noopener noreferrer');refs.numbers.open=true;refs.content.scrollTop=350;link.focus();h.view.render(state(raw));assert.equal(refs.yearPer.source.children[0],link);assert.equal(h.doc.activeElement,link);assert.equal(refs.numbers.open,true);assert.equal(refs.content.scrollTop,350);
  raw.year_per.basis='standalone';raw.year_per.accounting_standard='IFRS';raw.year_per.price_basis='period_end_explicit';raw.year_per.price_reference_date='2026-03-31';h.view.render(state(raw));assert.match(refs.yearPer.period.textContent,/単体・IFRS/);assert.match(refs.yearPer.note.textContent,/2026\/03\/31 算定株価の基準日/);assert.doesNotMatch(refs.yearPer.note.textContent,/資料に明記されていません/);
});
test('PER detail preserves non-presentation reasons; unconfirmed values stay independent of quote loading and never acquire sources',()=>{
  const h=dialogHarness();h.view.open(KEY,'トヨタ',h.trigger);const refs=h.view.elements;
  for(const [reason,label] of [['loss_eps','算定対象外（1株利益が赤字）'],['zero_eps','算定対象外（1株利益が0）'],['ratio_not_disclosed','未記載']]){
    const raw=yearPerFixture();raw.year_per.status=raw.year_per_status='not_presented';raw.year_per.value=raw.data[YEAR_PER]=null;raw.year_per.reason=reason;h.view.render(state(raw));assert.equal(refs.yearPer.value.textContent,label);assert.equal(refs.yearPer.unknown.hidden,true);assert.equal(refs.yearPer.source.hidden,false);
  }
  const raw=yearPerFixture({year_per:null,year_per_status:'unconfirmed',data:{currency:'JPY',price:123},sources:[],status:'pending',refreshing:true});const clean=profile.normalize(raw,KEY,NOW),loading={data:clean,status:'pending',symbol:KEY,updating:true};h.view.render(loading);
  assert.equal(refs.yearPer.row.hidden,false);assert.equal(refs.yearPer.value.textContent,'—');assert.equal(refs.yearPer.unknown.textContent,'未確認');assert.equal(refs.yearPer.source.hidden,true);assert.equal(refs.yearPer.period.hidden,true);assert.equal(refs.yearPer.time.hidden,true);assert.equal(refs.yearPer.note.hidden,true);assert.equal(profile.fieldReason({...loading,reason:'fetch_error'},YEAR_PER),'未確認');
});

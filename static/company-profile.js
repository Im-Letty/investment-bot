/* Company facts are independent of the article disclosure and retain their own dates. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./date-display.js'):root.KNDateDisplay);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document)root.KNCompanyProfile=api.start(root);
})(typeof window==='undefined'?null:window,function(dates){
  'use strict';
  const POLL_MS=3000,POLL_LIMIT=90000,REQUEST_TIMEOUT=12000,QUOTE_REFRESH_MS=60000,RETRY_DELAYS=[1000,3000],CACHE_AGE=7*86400000,CACHE_PREFIX='kn_company_profile_v1:';
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const text=(value,limit=400)=>typeof value==='string'?value.trim().slice(0,limit):'';
  const FIELD_KEYS=['price','market_cap','annual_dividend','forward_annual_dividend_per_share','ex_dividend_date','dividend_payment_date','analyst_target'];
  const HISTORICAL_FIELD='historical_dividend_per_share';
  const ISSUER_FORECAST_FIELD='issuer_annual_dividend_forecast_per_share';
  const CURRENT_PER_FIELD='current_per';
  const METRIC_KEYS={price:'price',cap:'market_cap',currentPer:CURRENT_PER_FIELD,annual:'annual_dividend',historical:HISTORICAL_FIELD,issuerForecast:ISSUER_FORECAST_FIELD,forward:'forward_annual_dividend_per_share',exDate:'ex_dividend_date',paymentDate:'dividend_payment_date',target:'analyst_target'};
  const FIELD_REASONS={loading:'取得中',source_missing:'提供元に情報なし',fetch_error:'通信エラー',invalid:'内容を確認中',unconfirmed:'未確認',unsupported:'取得元未対応'};
  const REGIONAL_MARKET_REFERENCES={Nagoya:'https://www.nse.or.jp/market/condition/quick/',Sapporo:'https://www.sse.or.jp/market',Fukuoka:'https://www.fse.or.jp/market-info/daily/'};
  function symbol(value){const key=text(value,30).normalize('NFKC').toUpperCase();return /^[0-9][A-Z0-9]{3}(?:\.(?:T|JP))?$/.test(key)?(/\.(?:T|JP)$/.test(key)?key:key+'.T'):'';}
  function safeUrl(value){
    if(typeof value!=='string'||/[\u0000-\u0020\u007f\\]/.test(value))return null;
    try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch(e){return null;}
  }
  function day(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
    const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?value:null;
  }
  function month(value){return typeof value==='string'&&/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)?value:null;}
  function timestamp(value,now=Date.now()){
    let at=null;
    if(finite(value)&&value>0)at=value>=1e12?value:value*1000;
    else if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&day(value.slice(0,10)))at=Date.parse(value);
    return finite(at)&&at>0&&at<=now+60000?at:null;
  }
  function stamp(value){return finite(value)?dates.timestamp(value/1000)||null:null;}
  function today(now){return new Date(now+9*3600000).toISOString().slice(0,10);}
  function edinetUrl(value,docId){return typeof value==='string'&&/^S[A-Z0-9]{7}$/.test(docId||'')&&value==='https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/'+docId+'.pdf'?value:null;}
  function historicalFact(raw,key,now){
    if(!raw||typeof raw!=='object'||!key.endsWith('.JP')||raw.currency!=='JPY'||raw.unit!=='JPY/share'||raw.kind!=='filed_fiscal_period_dividend'||raw.split_adjustment!=='as_reported'||!finite(raw.value)||raw.value<0||raw.value>1e9||raw.security_code!==key.slice(0,-3)+'0'||!/^E[0-9]{5}$/.test(raw.edinet_code||''))return null;
    const url=edinetUrl(raw.source_url,raw.doc_id),period=raw.fiscal_period||{},start=day(period.start),end=day(period.end),fetched=timestamp(raw.fetched_at,now),submitted=timestamp(raw.submitted_at,now);
    if(!url||!start||!end||start>end||!fetched||fetched>now||!submitted||submitted>fetched||end>today(submitted)||(Date.parse(end)-Date.parse(start))/86400000>550||typeof raw.filing_submitted_at!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(raw.filing_submitted_at)||Date.parse(raw.filing_submitted_at.replace(' ','T')+':00+09:00')!==submitted)return null;
    return {value:raw.value,currency:'JPY',unit:'JPY/share',fiscal_period:{start,end},filing_submitted_at:raw.filing_submitted_at,submitted_at:submitted,fetched_at:fetched,doc_id:raw.doc_id,edinet_code:raw.edinet_code,security_code:raw.security_code,source_url:url,source_title:'EDINET 有価証券報告書',kind:'filed_fiscal_period_dividend',split_adjustment:'as_reported',latest_filing_guaranteed:false};
  }
  function historicalCoverage(raw,now){
    if(!raw||typeof raw!=='object'||!['window_days','indexed_days','missing_days'].every(key=>Number.isInteger(raw[key])&&raw[key]>=0&&raw[key]<=400)||!raw.window_days||raw.indexed_days+raw.missing_days!==raw.window_days)return null;
    const from=day(raw.from),to=day(raw.to);
    if(!from||!to||to>today(now)||(Date.parse(to)-Date.parse(from))/86400000+1!==raw.window_days||typeof raw.complete!=='boolean'||raw.complete!==(raw.missing_days===0)||raw.snapshot_guaranteed!==false)return null;
    const clean={window_days:raw.window_days,indexed_days:raw.indexed_days,missing_days:raw.missing_days,from,to,complete:raw.complete,snapshot_guaranteed:false};
    if(raw.stale_days!==undefined){if(!Number.isInteger(raw.stale_days)||raw.stale_days<0||raw.stale_days>raw.indexed_days)return null;clean.stale_days=raw.stale_days;}
    if(raw.observed_at!==undefined&&raw.observed_at!==null){const at=timestamp(raw.observed_at,now);if(!at||at>now)return null;clean.observed_at=at;}
    return clean;
  }
  function issuerForecastFact(raw,key,name,exchange,now){
    if(!raw||typeof raw!=='object'||raw.kind!=='issuer_annual_dividend_forecast'||raw.use_basis!=='independent_extraction_of_numeric_facts'||raw.security_code!==key.split('.')[0]||raw.issuer_name!==name||raw.exchange!==exchange||!exchange||raw.currency!=='JPY'||raw.unit!=='JPY/share'||raw.split_adjustment!=='as_reported'||raw.latest_revision_guaranteed!==false||!['available','range','undetermined','not_comparable','not_disclosed'].includes(raw.status))return null;
    if(raw.status==='available'?(!finite(raw.value)||raw.value<0||raw.value>1e6):raw.value!==null)return null;
    const range=raw.status==='range'&&raw.value_range;if(raw.status==='range'&&(!range||!finite(range.min)||!finite(range.max)||range.min<0||range.max>1e6||range.min>=range.max))return null;
    const reason={not_comparable:'split_basis_mismatch',not_disclosed:'annual_amount_not_reported'}[raw.status]||null;if(reason&&raw.reason!==reason)return null;
    const url=safeUrl(raw.source_url),period=raw.fiscal_period||{},start=day(period.start),end=day(period.end),announced=day(raw.announcement_date),checked=day(raw.checked_on),fetched=timestamp(raw.fetched_at,now);
    if(!url||!start||!end||!announced||!checked||!fetched||fetched>now||start>=end||(Date.parse(end)-Date.parse(start))/86400000>550||announced>today(fetched)||today(fetched)>checked||checked>today(now)||Date.parse(announced)<Date.parse(start)-90*86400000||Date.parse(announced)>Date.parse(end)+180*86400000)return null;
    const source=new URL(url),title=text(raw.source_title,160);
    if(source.protocol!=='https:'||source.hostname!==raw.source_host||source.search&&!/^\?\d{1,20}$/.test(source.search)||source.hash||!source.pathname.toLowerCase().endsWith('.pdf')||!/^[a-z0-9.-]+$/.test(source.hostname)||!source.hostname.includes('.')||/^\d+(?:\.\d+)+$/.test(source.hostname)||/\.(?:local|localhost)$/.test(source.hostname)||!title)return null;
    let reportedSplit=null;
    if(raw.reported_split){const split=raw.reported_split,effective=day(split.effective_on);if(!effective||effective>end||!Number.isInteger(split.before)||!Number.isInteger(split.after)||split.before<=0||split.after<=0||split.before>1e6||split.after>1e6)return null;reportedSplit={effective_on:effective,before:split.before,after:split.after};}
    return {kind:raw.kind,status:raw.status,reason,value:raw.value,value_range:range?{min:range.min,max:range.max}:null,reported_split:reportedSplit,currency:'JPY',unit:'JPY/share',security_code:raw.security_code,issuer_name:name,exchange,fiscal_period:{start,end},fiscal_period_expired:end<today(now),announcement_date:announced,checked_on:checked,fetched_at:fetched,source_url:url,source_title:title,source_host:raw.source_host,use_basis:raw.use_basis,split_adjustment:'as_reported',latest_revision_guaranteed:false};
  }
  function marketData(raw,data,now){
    if(!raw||typeof raw!=='object'||!['delayed','end_of_day','unsupported'].includes(raw.kind))return null;
    if(raw.kind==='unsupported')return {kind:'unsupported',delay_minutes:null,quote_as_of:null,quote_age_seconds:null,quote_is_recent:false};
    const quoteAt=timestamp(raw.quote_as_of,now),delay=finite(raw.delay_minutes)&&raw.delay_minutes>=0&&raw.delay_minutes<=1440?raw.delay_minutes:null;
    // Freshness belongs to this exact quote, not to a newly retrieved financial field.
    if(quoteAt!==data.price_updated_at||data.price===null)return null;
    return {kind:raw.kind,delay_minutes:delay,quote_as_of:quoteAt,quote_age_seconds:quoteAt?Math.max(0,(now-quoteAt)/1000):null,quote_is_recent:quoteAt!==null&&raw.quote_is_recent===true};
  }
  function quoteNote(state,now=Date.now()){
    const record=state&&state.data,market=record&&record.market_data,data=record&&record.data||{};
    if(market&&market.kind==='unsupported')return 'この取引所の株価・時価総額の取得元は未対応です。';
    const parts=[];
    const issue={fetch_error:'最新の株価取得で通信エラー',invalid:'最新の株価は内容を確認中',unconfirmed:'最新の株価は未確認'}[record&&record.quote_error];
    if(!finite(data.price))return issue||'';
    if(market&&market.kind==='delayed')parts.push(market.delay_minutes!==null?market.delay_minutes+'分遅延の株価':'遅延して配信される株価');
    if(market&&market.kind==='end_of_day'||!data.price_updated_at&&data.price_trade_date)parts.push('終値');
    const elapsed=market&&market.quote_as_of?Math.max(0,(now-market.quote_as_of)/1000):null;
    const old=market&&market.kind==='delayed'&&(market.quote_is_recent!==true||elapsed!==null&&elapsed>(market.delay_minutes||0)*60+300);
    if(state.fromCache)parts.push('保存済みの株価');
    else if(old)parts.push('株価の時点をご確認ください');
    else if(record&&record.quote_status==='stale'&&!record.quote_refreshing)parts.push('保存済みの株価');
    if(issue)parts.push(issue);
    else if(record&&record.quote_status==='unavailable')parts.push('最新の株価は確認できませんでした');
    if(record&&record.quote_status?record.quote_refreshing:state.updating)parts.push('最新の株価を確認中');
    else if(['fetch_error','timeout'].includes(state.reason))parts.push('最新の情報は通信エラー');
    return parts.join(' / ');
  }
  function money(value,currency='JPY',compact=false){
    if(!finite(value)||value<0||!['JPY','USD','EUR','GBP'].includes(currency))return null;
    const unit={JPY:'円',USD:'米ドル',EUR:'ユーロ',GBP:'英ポンド'}[currency];
    let number=value,suffix='';
    if(compact&&value>=1e12){number=value/1e12;suffix='兆';}else if(compact&&value>=1e8){number=value/1e8;suffix='億';}
    return number.toLocaleString('ja-JP',{maximumFractionDigits:2})+suffix+unit;
  }
  function sourceList(values,now){
    const seen=new Set();return (Array.isArray(values)?values:[]).slice(0,15).flatMap(raw=>{
      if(!raw||typeof raw!=='object')return [];
      const title=text(raw.title||raw.name,120),url=safeUrl(raw.url||raw.source_url);
      if(url&&new URL(url).hostname.endsWith('edinet-fsa.go.jp')&&!/^https:\/\/disclosure2dl\.edinet-fsa\.go\.jp\/searchdocument\/pdf\/S[A-Z0-9]{7}\.pdf$/.test(url))return [];
      if(!title||!url||seen.has(url))return [];seen.add(url);
      return [{title,url,fetched_at:timestamp(raw.fetched_at,now)}];
    });
  }
  function normalize(raw,key,now=Date.now()){
    if(!raw||typeof raw!=='object'||raw.error||symbol(raw.symbol)!==key||!['pending','ready','stale','unavailable','error'].includes(raw.status))return null;
    const input=raw.data&&typeof raw.data==='object'?raw.data:{},positive=v=>finite(v)&&v>0?v:null,amount=v=>finite(v)&&v>=0?v:null;
    const currency=/^[A-Z]{3}$/.test(input.currency||'')?input.currency:'JPY';
    const fieldSource=raw.source&&typeof raw.source==='object'?raw.source:{};
    const fields={};
    for(const name of ['price','market_cap','forward_annual_dividend_per_share','analyst_target','ex_dividend_date','dividend_payment_date','dividend_payment_period']){
      const field=fieldSource.fields&&fieldSource.fields[name];
      fields[name]={fetched_at:timestamp(field&&field.fetched_at,now)};
    }
    const target=input.analyst_target&&typeof input.analyst_target==='object'?input.analyst_target:{};
    const mean=positive(target.mean),low=positive(target.low),high=positive(target.high);
    const consistent=!(low!==null&&high!==null&&low>high||mean!==null&&low!==null&&mean<low||mean!==null&&high!==null&&mean>high);
    const targetCurrency=text(target.currency,3)||currency;
    const analyst=consistent&&targetCurrency===currency?{mean,low,high,analyst_count:finite(target.analyst_count)&&Number.isInteger(target.analyst_count)&&target.analyst_count>0?target.analyst_count:null,as_of:day(target.as_of),currency:targetCurrency}:null;
    const editorial=raw.editorial&&typeof raw.editorial==='object'&&text(raw.editorial.business)?{
      business:text(raw.editorial.business),life:text(raw.editorial.life),watch:text(raw.editorial.watch),
      reviewed_on:day(raw.editorial.reviewed_on),sources:sourceList(raw.editorial.sources,now)
    }:null;
    const overviewInput=raw.business_overview&&typeof raw.business_overview==='object'?raw.business_overview:{};
    const overviewUrl=safeUrl(overviewInput.source_url),overviewStatus=['available','loading','source_missing','fetch_error','identity_unconfirmed'].includes(overviewInput.field_status)?overviewInput.field_status:'identity_unconfirmed';
    const recordUpdated=day(overviewInput.source_record_updated_on);
    const publicOverview=overviewInput.kind==='public_company_business'&&overviewUrl==='https://shokuba.mhlw.go.jp/shokuba/utilize/utilize010.do'&&overviewInput.use_basis==='independent_summary_of_business_facts'&&day(overviewInput.source_updated_on)&&overviewInput.source_updated_on<=today(now)&&(overviewInput.source_record_updated_on==null||recordUpdated&&recordUpdated<=overviewInput.source_updated_on);
    const published=day(overviewInput.source_published_on),reviewed=day(overviewInput.reviewed_on),overviewFetched=timestamp(overviewInput.fetched_at,now);
    const reviewedOverview=overviewInput.kind==='reviewed_company_business'&&overviewInput.source_kind==='public_annual_report'&&overviewInput.use_basis==='independent_summary_of_business_facts'&&/^https:\/\/(?:info\.gbiz\.go\.jp\/hojin\/edinetDownload\?docId=S[A-Z0-9]{7}|disclosure2dl\.edinet-fsa\.go\.jp\/searchdocument\/pdf\/S[A-Z0-9]{7}\.pdf)$/.test(overviewUrl||'')&&published&&reviewed&&published<=reviewed&&reviewed<=today(now)&&overviewFetched&&overviewFetched<=now&&published<=today(overviewFetched);
    const business_overview=overviewInput.kind==='structured_company_facts'||publicOverview||reviewedOverview?{
      kind:overviewInput.kind,text:overviewStatus==='available'&&overviewUrl?text(overviewInput.text,1200):'',field_status:overviewStatus==='available'&&!overviewUrl?'identity_unconfirmed':overviewStatus,
      source_url:overviewUrl,source_title:text(overviewInput.source_title,120)||'会社の情報の出典',fetched_at:timestamp(overviewInput.fetched_at,now),
      products:Array.isArray(overviewInput.products)?overviewInput.products.slice(0,15).map(value=>text(value,80)).filter(Boolean):[],
      industry_labels:Array.isArray(overviewInput.industry_labels)?overviewInput.industry_labels.slice(0,15).map(value=>text(value,80)).filter(Boolean):[],
      source_updated_on:publicOverview?day(overviewInput.source_updated_on):null,
      source_record_updated_on:publicOverview?recordUpdated:null,
      source_kind:reviewedOverview?'public_annual_report':null,source_published_on:reviewedOverview?published:null,reviewed_on:reviewedOverview?reviewed:null,
      use_basis:publicOverview||reviewedOverview?overviewInput.use_basis:null,
      attribution_notice:publicOverview?'職場情報総合サイト（しょくばらぼ）の事業情報をもとに当サイトが説明を作成。':reviewedOverview?'提出資料の事業情報をもとに当サイトが説明を作成。':''
    }:null;
    const identityInput=raw.identity&&typeof raw.identity==='object'?raw.identity:{};
    const identityUrl=safeUrl(identityInput.source_url),identityDate=day(identityInput.date);
    const exchange=['Tokyo','Nagoya','Sapporo','Fukuoka'].includes(identityInput.exchange)&&(key.endsWith('.T')===(identityInput.exchange==='Tokyo'))?identityInput.exchange:null;
    const identity=identityUrl&&identityDate&&identityDate<=today(now)?{market:text(identityInput.market,100),industry:text(identityInput.industry,100),exchange,source_url:identityUrl,date:identityDate,source_title:text(identityInput.source_title,120)||'会社の一覧の出典'}:null;
    const data={currency,price:positive(input.price),price_updated_at:timestamp(input.price_updated_at,now),price_trade_date:day(input.price_trade_date)&&input.price_trade_date<=today(now)?input.price_trade_date:null,market_cap:positive(input.market_cap),
      annual_dividend:input.annual_dividend_basis==='trailing_12m'?amount(input.annual_dividend):null,
      annual_dividend_basis:input.annual_dividend_basis==='trailing_12m'?'trailing_12m':null,
      dividend_fetched_at:timestamp(input.dividend_fetched_at,now),
      forward_annual_dividend_per_share:input.forward_dividend_basis==='annualized'?amount(input.forward_annual_dividend_per_share):null,
      forward_dividend_basis:input.forward_dividend_basis==='annualized'?'annualized':null,
      analyst_target:analyst,ex_dividend_date:day(input.ex_dividend_date),dividend_payment_date:day(input.dividend_payment_date),dividend_payment_period:month(input.dividend_payment_period)};
    const regional=key.endsWith('.JP');
    if(regional){
      for(const name of FIELD_KEYS)data[name]=null;
      data.price_updated_at=data.price_trade_date=data.dividend_fetched_at=data.dividend_payment_period=null;
    }
    const historicalStatus=regional&&['available','loading','source_missing','fetch_error','invalid','unconfirmed'].includes(raw.historical_dividend_status)?raw.historical_dividend_status:null;
    let historicalInvalidated=historicalStatus!==null&&raw.historical_dividend_invalidated===true;
    let dividend_fact=historicalStatus&&!historicalInvalidated?historicalFact(raw.dividend_fact,key,now):null;
    if(historicalStatus&&raw.dividend_fact&&!historicalInvalidated&&(!dividend_fact||input[HISTORICAL_FIELD]!==dividend_fact.value)){historicalInvalidated=true;dividend_fact=null;}
    data[HISTORICAL_FIELD]=dividend_fact&&input[HISTORICAL_FIELD]===dividend_fact.value?dividend_fact.value:null;
    const issuerStatus=['available','range','undetermined','not_comparable','not_disclosed','unconfirmed'].includes(raw.issuer_dividend_forecast_status)?raw.issuer_dividend_forecast_status:null;
    let issuer_dividend_forecast=issuerStatus?issuerForecastFact(raw.issuer_dividend_forecast,key,text(raw.name,160)||key,identity&&identity.exchange,now):null;
    if(issuer_dividend_forecast&&(issuer_dividend_forecast.status!==issuerStatus||issuer_dividend_forecast.status==='available'&&input[ISSUER_FORECAST_FIELD]!==issuer_dividend_forecast.value))issuer_dividend_forecast=null;
    data[ISSUER_FORECAST_FIELD]=issuer_dividend_forecast&&issuer_dividend_forecast.status==='available'?issuer_dividend_forecast.value:null;
    // No verified current-PER source is configured. Never substitute a filing ratio.
    data[CURRENT_PER_FIELD]=null;
    const forecastSourceAllowed=source=>!raw.issuer_dividend_forecast||source.url!==raw.issuer_dividend_forecast.source_url||!!issuer_dividend_forecast;
    const perSourceAllowed=source=>!/(?:年度.*PER|PER.*年度)/i.test(source.title)&&(!raw.year_per||source.url!==raw.year_per.source_url);
    const filingSourceAllowed=source=>{
      const url=new URL(source.url),filing=url.hostname.endsWith('edinet-fsa.go.jp')||url.hostname==='info.gbiz.go.jp'&&url.pathname==='/hojin/edinetDownload';
      return !filing||data[HISTORICAL_FIELD]!==null&&source.url===dividend_fact.source_url||business_overview&&business_overview.source_kind==='public_annual_report'&&source.url===business_overview.source_url;
    };
    const sources=sourceList(raw.sources,now).filter(forecastSourceAllowed).filter(perSourceAllowed).filter(filingSourceAllowed);
    if(!sources.length&&fieldSource.url)sources.push(...sourceList([fieldSource],now).filter(perSourceAllowed).filter(filingSourceAllowed));
    const statuses=raw.field_status&&typeof raw.field_status==='object'?raw.field_status:{},field_status={};
    FIELD_KEYS.forEach(key=>{
      if(statuses[key]==='available'||Object.prototype.hasOwnProperty.call(FIELD_REASONS,statuses[key]))field_status[key]=statuses[key];
      if(field_status[key]!=='available'||knownField({data},key))return;
      const supplied=input[key];
      const rejected=key==='analyst_target'?supplied!==null&&supplied!==undefined&&(typeof supplied!=='object'||!analyst||['mean','low','high'].some(part=>supplied[part]!==null&&supplied[part]!==undefined&&!positive(supplied[part]))):supplied!==null&&supplied!==undefined;
      if(rejected)field_status[key]='invalid';
    });
    if(regional)FIELD_KEYS.forEach(field=>{field_status[field]='unsupported';});
    if(historicalStatus)field_status[HISTORICAL_FIELD]=data[HISTORICAL_FIELD]!==null?'available':raw.dividend_fact?'invalid':historicalStatus==='available'?'unconfirmed':historicalStatus;
    if(issuerStatus)field_status[ISSUER_FORECAST_FIELD]=issuer_dividend_forecast&&issuer_dividend_forecast.status==='available'?'available':raw.issuer_dividend_forecast&&!issuer_dividend_forecast?'invalid':'unconfirmed';
    field_status[CURRENT_PER_FIELD]='unconfirmed';
    return {symbol:key,name:text(raw.name,160)||key,status:raw.status,refreshing:raw.refreshing===true,
      updated_at:timestamp(raw.updated_at,now),data,editorial,identity,business_overview,field_status,sources,source:{fields},
      dividend_fact:data[HISTORICAL_FIELD]!==null?dividend_fact:null,historical_dividend_status:historicalStatus,
      issuer_dividend_forecast,issuer_dividend_forecast_status:issuerStatus,
      historical_dividend_coverage:historicalStatus?historicalCoverage(raw.historical_dividend_coverage,now):null,
      historical_dividend_refreshing:historicalStatus!==null&&raw.historical_dividend_refreshing===true,
      historical_dividend_invalidated:historicalInvalidated,
      historical_dividend_error:historicalStatus!==null&&raw.historical_dividend_error==='fetch_error'?'fetch_error':null,
      market_data:regional?marketData({kind:'unsupported'},data,now):marketData(raw.market_data,data,now),
      quote_status:['ready','pending','stale','unavailable','error'].includes(raw.quote_status)?raw.quote_status:null,
      quote_error:['fetch_error','invalid','unconfirmed'].includes(raw.quote_error)?raw.quote_error:null,
      quote_refreshing:raw.quote_refreshing===true,
      quote_refresh_enabled:raw.quote_refresh_enabled===true,
      retry_after_seconds:finite(raw.retry_after_seconds)&&raw.retry_after_seconds>=0?Math.min(raw.retry_after_seconds,3600):null};
  }
  function knownField(record,key){
    const data=record&&record.data||{};
    if(['price','market_cap'].includes(key))return finite(data[key])&&data[key]>0;
    if(['annual_dividend','forward_annual_dividend_per_share',HISTORICAL_FIELD,ISSUER_FORECAST_FIELD].includes(key))return finite(data[key])&&data[key]>=0;
    if(key===CURRENT_PER_FIELD)return false;
    if(key==='analyst_target')return finite(data.analyst_target&&data.analyst_target.mean)&&data.analyst_target.mean>0;
    if(key==='dividend_payment_date')return !!(day(data.dividend_payment_date)||month(data.dividend_payment_period));
    return key==='ex_dividend_date'&&!!day(data.ex_dividend_date);
  }
  function fieldReason(state,key){
    const record=state&&state.data;if(knownField(record,key))return '';
    const supplied=record&&record.field_status&&record.field_status[key];
    if(key===CURRENT_PER_FIELD)return FIELD_REASONS.unconfirmed;
    // A completed source's known omission is independent of other fields still
    // loading, or of a later request failing before it provides new evidence.
    if(['source_missing','invalid','unsupported'].includes(supplied))return FIELD_REASONS[supplied];
    if(state&&['not_found','invalid_request'].includes(state.reason))return FIELD_REASONS.unconfirmed;
    if(state&&state.reason==='invalid')return FIELD_REASONS.invalid;
    if(state&&['retrying','fetch_error','timeout'].includes(state.reason))return FIELD_REASONS.fetch_error;
    if(state&&state.reason==='pending_timeout')return FIELD_REASONS.unconfirmed;
    if(supplied==='available')return FIELD_REASONS.unconfirmed;
    if(supplied==='unconfirmed'&&state&&state.fromCache&&state.status==='stale'&&state.updating)return FIELD_REASONS.loading;
    if(Object.prototype.hasOwnProperty.call(FIELD_REASONS,supplied))return FIELD_REASONS[supplied];
    return state&&(state.updating||state.status==='loading')?FIELD_REASONS.loading:FIELD_REASONS.unconfirmed;
  }
  function hasFacts(record){return !!record&&(record.data.price!==null||record.data.market_cap!==null||record.data.annual_dividend!==null||record.data.forward_annual_dividend_per_share!==null||finite(record.data[HISTORICAL_FIELD])||record.issuer_dividend_forecast||record.data.ex_dividend_date||record.data.dividend_payment_date||record.data.dividend_payment_period||record.data.analyst_target&&record.data.analyst_target.mean!==null);}
  function cacheTime(record){return record&&Math.max(record.updated_at||0,record.data.price_updated_at||0,record.data.dividend_fetched_at||0,record.source.fields.price.fetched_at||0,record.dividend_fact&&record.dividend_fact.fetched_at||0,record.issuer_dividend_forecast&&record.issuer_dividend_forecast.fetched_at||0);}
  function priceDay(record){return record.data.price_trade_date||(record.data.price_updated_at?today(record.data.price_updated_at):null);}
  function newerPrice(record,before){
    const incoming=priceDay(record),previous=priceDay(before);
    if(incoming&&previous&&incoming!==previous)return incoming>previous;
    if(incoming&&!previous)return true;if(!incoming&&previous)return false;
    if((record.data.price_updated_at||0)!==(before.data.price_updated_at||0))return (record.data.price_updated_at||0)>(before.data.price_updated_at||0);
    return (record.source.fields.price.fetched_at||0)>(before.source.fields.price.fetched_at||0);
  }
  function newerHistorical(record,before){
    const next=record.dividend_fact,old=before.dividend_fact;
    if(!next)return false;if(!old)return true;
    if(next.fiscal_period.end!==old.fiscal_period.end)return next.fiscal_period.end>old.fiscal_period.end;
    if(next.submitted_at!==old.submitted_at)return next.submitted_at>old.submitted_at;
    return next.fetched_at>=old.fetched_at;
  }
  function retainNewer(record,before){
    if(!before)return record;
    const fresh=hasFacts(record)&&(record.updated_at||0)>=(before.updated_at||0);
    const keepPrice=before.data.price!==null&&(record.data.price===null||newerPrice(before,record));
    const capAt=record.source.fields.market_cap.fetched_at||0,beforeCapAt=before.source.fields.market_cap.fetched_at||0;
    const keepCap=before.data.market_cap!==null&&(record.data.market_cap===null||beforeCapAt>capAt);
    const keepHistorical=record.historical_dividend_status!==null&&!record.historical_dividend_invalidated&&before.dividend_fact&&!newerHistorical(record,before);
    const nextForecast=record.issuer_dividend_forecast,oldForecast=before.issuer_dividend_forecast;
    const keepIssuerForecast=nextForecast&&oldForecast&&(oldForecast.fiscal_period.end>nextForecast.fiscal_period.end||oldForecast.fiscal_period.end===nextForecast.fiscal_period.end&&oldForecast.announcement_date>nextForecast.announcement_date);
    if(fresh&&!keepPrice&&!keepCap&&!keepHistorical&&!keepIssuerForecast)return record;
    const base=fresh?record:before;
    const kept={...base,name:record.name,editorial:record.editorial||before.editorial,identity:record.identity||before.identity,business_overview:record.business_overview||before.business_overview,field_status:{...before.field_status,...record.field_status},status:record.status,refreshing:record.refreshing,retry_after_seconds:record.retry_after_seconds,quote_status:record.quote_status,quote_error:record.quote_error,quote_refreshing:record.quote_refreshing,quote_refresh_enabled:record.quote_refresh_enabled,data:{...base.data},source:{fields:{...base.source.fields}}};
    if(keepPrice){
      for(const key of ['price','price_updated_at','price_trade_date'])kept.data[key]=before.data[key];kept.source.fields.price=before.source.fields.price;kept.market_data=before.market_data;
    }else if(record.data.price!==null&&newerPrice(record,before)){
      for(const key of ['price','price_updated_at','price_trade_date'])kept.data[key]=record.data[key];kept.source.fields.price=record.source.fields.price;kept.market_data=record.market_data;
    }
    if(keepCap){kept.data.market_cap=before.data.market_cap;kept.source.fields.market_cap=before.source.fields.market_cap;}
    else if(record.data.market_cap!==null&&capAt>=beforeCapAt){kept.data.market_cap=record.data.market_cap;kept.source.fields.market_cap=record.source.fields.market_cap;}
    if(record.data.annual_dividend!==null&&(record.data.dividend_fetched_at||0)>(before.data.dividend_fetched_at||0)){
      kept.data.annual_dividend=record.data.annual_dividend;kept.data.annual_dividend_basis=record.data.annual_dividend_basis;kept.data.dividend_fetched_at=record.data.dividend_fetched_at;
    }
    kept.historical_dividend_status=record.historical_dividend_status;
    kept.historical_dividend_refreshing=record.historical_dividend_refreshing;
    kept.historical_dividend_invalidated=record.historical_dividend_invalidated;
    kept.historical_dividend_error=record.historical_dividend_error;
    kept.historical_dividend_coverage=record.historical_dividend_coverage;
    const selected=record.historical_dividend_status===null||record.historical_dividend_invalidated?null:keepHistorical?before.dividend_fact:record.dividend_fact;
    kept.dividend_fact=selected;
    kept.data[HISTORICAL_FIELD]=selected?selected.value:null;
    // A dated company revision (including an explicit undetermined forecast)
    // wins over an older cached announcement. Removal or validation failure
    // clears the field; a failed HTTP request retains the whole saved record.
    const forecast=keepIssuerForecast?oldForecast:nextForecast;
    kept.issuer_dividend_forecast=forecast;kept.issuer_dividend_forecast_status=forecast?forecast.status:record.issuer_dividend_forecast_status;
    kept.data[ISSUER_FORECAST_FIELD]=forecast&&forecast.status==='available'?forecast.value:null;
    if(forecast)kept.field_status[ISSUER_FORECAST_FIELD]=forecast.status==='available'?'available':'unconfirmed';
    kept.data[CURRENT_PER_FIELD]=null;kept.field_status[CURRENT_PER_FIELD]='unconfirmed';
    if(selected)kept.field_status[HISTORICAL_FIELD]='available';
    kept.sources=(kept.sources||[]).filter(source=>!new URL(source.url).hostname.endsWith('edinet-fsa.go.jp'));
    if(selected)kept.sources.push({title:'EDINET 有価証券報告書（当サイトが配当額を抜粋）',url:selected.source_url,fetched_at:selected.fetched_at});
    const oldForecastUrls=[before.issuer_dividend_forecast,record.issuer_dividend_forecast].filter(Boolean).map(fact=>fact.source_url);
    kept.sources=kept.sources.filter(source=>!oldForecastUrls.includes(source.url));
    if(forecast)kept.sources.push({title:forecast.source_title,url:forecast.source_url,fetched_at:forecast.fetched_at});
    return kept;
  }
  function createLoader(env,onState){
    const now=env.now||Date.now,set=env.setTimeout||setTimeout,clear=env.clearTimeout||clearTimeout;
    const cache=new Map();let version=0,current='',controller=null,requestTimer=null,pollTimer=null,cancelWait=null,busy=false,last=null;
    function save(record){
      if(record.historical_dividend_invalidated||record.symbol.endsWith('.JP')&&record.historical_dividend_status===null&&!record.issuer_dividend_forecast){
        cache.delete(record.symbol);
        try{if(env.storage&&env.storage.removeItem)env.storage.removeItem(CACHE_PREFIX+record.symbol);else if(env.storage)env.storage.setItem(CACHE_PREFIX+record.symbol,'null');}catch(e){}
      }
      if(!hasFacts(record)||!cacheTime(record))return;
      cache.delete(record.symbol);cache.set(record.symbol,record);
      while(cache.size>20)cache.delete(cache.keys().next().value);
      try{if(env.storage)env.storage.setItem(CACHE_PREFIX+record.symbol,JSON.stringify(record));}catch(e){}
    }
    function saved(key){
      let record=cache.get(key);
      if(!record){try{record=normalize(JSON.parse(env.storage&&env.storage.getItem(CACHE_PREFIX+key)),key,now());}catch(e){}}
      if(!record||!hasFacts(record)||!cacheTime(record)||now()-cacheTime(record)>CACHE_AGE)return null;
      if(Object.values(record.field_status||{}).includes('loading'))record={...record,field_status:Object.fromEntries(Object.entries(record.field_status).map(([field,status])=>[field,status==='loading'?'unconfirmed':status]))};
      cache.set(key,record);return record;
    }
    function cancel(){version++;busy=false;clear(requestTimer);clear(pollTimer);requestTimer=pollTimer=null;if(controller)controller.abort();controller=null;if(cancelWait)cancelWait(new Error('cancelled'));cancelWait=null;current='';}
    function emit(state){last=state;onState(state);}
    function end(key,reason){busy=false;const kept=saved(key)||(last&&last.symbol===key&&last.data);emit({symbol:key,status:kept?'stale':'error',data:kept||null,fromCache:!!kept,updating:false,reason});}
    async function request(key,token,deadline,retry=0){
      if(token!==version)return;
      const remaining=deadline-now();if(remaining<=0){end(key,'pending_timeout');return;}
      const active=new env.AbortController();controller=active;
      try{
        const timeout=new Promise((resolve,reject)=>{cancelWait=reject;requestTimer=set(()=>{active.abort();reject(new Error('timeout'));},Math.min(REQUEST_TIMEOUT,remaining));});
        const purpose=env.purpose==='preview'?'preview':'detail';
        const response=Promise.resolve().then(()=>env.fetch('/api/company-profile?symbol='+encodeURIComponent(key)+'&purpose='+purpose+'&per=current',{signal:active.signal,cache:'no-store'})).then(async result=>{
          if(!result.ok){const retryable=[408,425,429].includes(result.status)||result.status>=500,error=new Error(result.status===404?'not_found':retryable?'fetch_error':'invalid_request');error.retryable=retryable;throw error;}
          try{return await result.json();}catch(error){throw new Error('invalid');}
        });
        const payload=await Promise.race([response,timeout]);
        if(token!==version)return;
        const record=normalize(payload,key,now());if(!record)throw new Error('invalid');
        const before=saved(key),data=retainNewer(record,before),fromCache=data!==record;save(data);
        const pending=record.status==='pending'||record.refreshing;
        if(['unavailable','error'].includes(record.status)&&!pending){busy=false;emit({symbol:key,status:'error',data,fromCache,updating:false,quoteRefreshEnabled:record.quote_refresh_enabled,reason:record.status==='error'?'fetch_error':'unavailable'});return;}
        emit({symbol:key,status:pending?'pending':fromCache?'stale':record.status,data,fromCache,updating:pending,quoteRefreshEnabled:record.quote_refresh_enabled,reason:null});
        if(pending){pollTimer=set(()=>{pollTimer=null;request(key,token,deadline);},Math.min(POLL_MS,Math.max(0,deadline-now())));}else busy=false;
      }catch(error){
        if(token!==version)return;
        const reason=['not_found','timeout','invalid','invalid_request'].includes(error.message)?error.message:'fetch_error';
        const delay=RETRY_DELAYS[retry],retryable=error.retryable!==false&&!['not_found','invalid'].includes(error.message);
        if(retryable&&delay!==undefined&&now()+delay<deadline){
          const kept=saved(key)||(last&&last.symbol===key&&last.data);
          emit({symbol:key,status:'pending',data:kept||null,fromCache:!!saved(key),updating:true,reason:'retrying'});
          pollTimer=set(()=>{pollTimer=null;request(key,token,deadline,retry+1);},delay);
        }else end(key,reason);
      }
      finally{if(token===version){clear(requestTimer);requestTimer=null;controller=null;cancelWait=null;}}
    }
    function load(value){
      const key=symbol(value);if(!key)return false;
      if(key===current&&busy)return true;
      cancel();current=key;busy=true;const token=version,kept=saved(key);
      emit({symbol:key,status:kept?'stale':'loading',data:kept,fromCache:!!kept,updating:true,reason:null});
      request(key,token,now()+POLL_LIMIT);return true;
    }
    return {load,cancel,peek:key=>saved(symbol(key)),getState:()=>last};
  }
  function createDialog(w,onRetry){
    const doc=w.document,refs={};let opened=false,closing=null,returnFocus=null,returnCompanySymbol='',background=[],scrolls=[],bodyStyle=null,currentSymbol='',selectedName='';
    function el(tag,cls,content){const node=doc.createElement(tag);if(cls)node.className=cls;if(content!==undefined)node.textContent=content;return node;}
    function append(parent,...nodes){nodes.forEach(node=>parent.appendChild(node));return parent;}
    const overlay=el('div','cp-overlay');overlay.id='knCompanyProfile';overlay.hidden=true;
    const backdrop=el('div','cp-backdrop');backdrop.setAttribute('aria-hidden','true');
    const panel=el('section','cp-sheet');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','cp-company-title');panel.tabIndex=-1;
    const head=el('header','cp-head'),identity=el('div','cp-identity');refs.code=el('p','cp-code');refs.name=el('h2','cp-title');refs.name.id='cp-company-title';
    const closeButton=el('button','cp-close','閉じる');closeButton.type='button';
    append(identity,refs.code,refs.name);append(head,identity,closeButton);
    const content=el('div','cp-content'),feedback=el('div','cp-feedback');feedback.setAttribute('role','status');
    refs.status=el('p');refs.retry=el('button','cp-retry','もう一度確認');refs.retry.type='button';refs.retry.hidden=true;append(feedback,refs.status,refs.retry);
    const basic=el('section','cp-basic');basic.hidden=true;
    const basicList=el('dl','cp-basic-list');append(basic,el('h3','cp-heading','会社の基本情報'),basicList);refs.basic=basic;
    [['market','市場'],['industry','業種']].forEach(([key,label])=>{const row=el('div','cp-basic-row'),value=el('dd');append(row,el('dt','',label),value);basicList.appendChild(row);refs[key]={row,value};});
    const stories=el('div','cp-stories');
    [['business','どんな会社？'],['life','暮らしとのつながり'],['watch','これから見るところ']].forEach(([key,title])=>{
      const section=el('section','cp-story'),body=el('p','cp-story-copy');append(section,el('h3','cp-heading',title),body);stories.appendChild(section);refs[key]={section,body};
    });
    refs.businessSource=el('p','cp-source-time');refs.business.section.appendChild(refs.businessSource);
    const numbers=el('details','cp-numbers'),summary=el('summary','cp-numbers-toggle');
    const mark=el('i','cp-disclosure');mark.setAttribute('aria-hidden','true');append(summary,el('span','','数字・配当'),mark);numbers.appendChild(summary);
    const facts=el('div','cp-facts');numbers.appendChild(facts);
    function group(title){const box=el('section','cp-fact-group'),list=el('dl','cp-metric-list');append(box,el('h3','cp-heading',title),list);facts.appendChild(box);return {box,list};}
    function metric(group,key,label,help){
      const row=el('div','cp-metric'),dt=el('dt','cp-metric-label',label),dd=el('dd','cp-metric-data'),value=el('span','cp-number','—'),unknown=el('small','cp-unknown','未確認'),time=el('p','cp-fact-time');
      if(help)dt.appendChild(el('small','cp-definition',help));append(dd,value,unknown,time);append(row,dt,dd);group.list.appendChild(row);refs[key]={row,value,unknown,time};
    }
    const market=group('株価と会社の大きさ');metric(market,'price','株価');metric(market,'cap','時価総額','会社の株を全部合わせた値段');
    refs.price.note=el('p','cp-fact-note');refs.price.value.parentElement.appendChild(refs.price.note);
    refs.price.reference=el('p','cp-fact-note');refs.price.reference.hidden=true;refs.price.value.parentElement.appendChild(refs.price.reference);
    metric(market,'currentPer','現在のPER');
    const dividends=group('配当');metric(dividends,'annual','過去1年の実績配当','1株あたり');metric(dividends,'forward','予想配当（今後1年の目安）','1株あたり。会社が出す年度ごとの予想とは異なります。');
    metric(dividends,'issuerForecast','会社の年度予想配当（1株）','会社の公表資料に記載された対象年度の予想です。');
    refs.issuerForecast.row.hidden=true;refs.issuerForecast.period=el('p','cp-fact-note');refs.issuerForecast.source=el('p','cp-source-time');refs.issuerForecast.note=el('p','cp-fact-note');append(refs.issuerForecast.value.parentElement,refs.issuerForecast.period,refs.issuerForecast.source,refs.issuerForecast.note);
    metric(dividends,'historical','年度の実績配当（1株）','提出済みの年度の実績です。過去1年の合計や予想配当とは異なります。');
    refs.historical.row.hidden=true;refs.historical.period=el('p','cp-fact-note');refs.historical.source=el('p','cp-source-time');refs.historical.note=el('p','cp-fact-note');
    append(refs.historical.value.parentElement,refs.historical.period,refs.historical.source,refs.historical.note);
    metric(dividends,'exDate','次回の権利落ち日','権利落ち日です。配当の支払日とは異なります。');metric(dividends,'paymentDate','配当の支払日');
    const targets=group('専門家の予想');metric(targets,'target','アナリストの目標株価（平均）','専門家の予想・保証ではありません。');
    refs.targetRange=el('p','cp-fact-note');refs.targetDate=el('p','cp-fact-note');append(targets.box,refs.targetRange,refs.targetDate);
    const reasonHelp=el('details','cp-reason-help');reasonHelp.hidden=true;
    append(reasonHelp,el('summary','','表示の意味'),el('p','','取得中：読み込み中です。通信エラー：取得先に接続できませんでした。'),el('p','','提供元に情報なし：取得先で確認できません。会社が未公表とは限りません。'),el('p','','内容を確認中・未確認：正確に表示できるか確認できていません。空欄は0円という意味ではありません。'));facts.appendChild(reasonHelp);refs.reasonHelp=reasonHelp;
    const sources=el('footer','cp-sources');append(sources,el('h3','cp-heading','出典'));refs.identityDate=el('p','cp-review-date');refs.reviewed=el('p','cp-review-date');refs.sources=el('ul','cp-source-list');append(sources,refs.identityDate,refs.reviewed,refs.sources);
    append(content,feedback,basic,stories,numbers,sources);append(panel,head,content);append(overlay,backdrop,panel);doc.body.appendChild(overlay);
    let sourcesSignature='',businessSourceSignature='',marketReferenceSignature='',historicalSourceSignature='',issuerForecastSourceSignature='';
    function setMetric(key,value,when,reason){const ref=refs[key];ref.value.textContent=value||'—';ref.unknown.hidden=!!value;ref.unknown.textContent=reason||FIELD_REASONS.unconfirmed;ref.time.textContent=when||'';ref.time.hidden=!when;}
    function render(state){
      if(!opened||state.symbol!==currentSymbol)return;
      const record=state.data,data=record&&record.data||{},currency=data.currency||'JPY',editorial=record&&record.editorial,identity=record&&record.identity,overview=record&&record.business_overview;
      if(record&&record.name&&symbol(record.name)!==currentSymbol)refs.name.textContent=record.name;else refs.name.textContent=selectedName;
      const failed=['error','stale'].includes(state.status)&&!state.updating;
      refs.status.textContent=state.reason==='retrying'?'通信が一時的に遅れています。自動でもう一度確認しています…':state.status==='loading'?'株価や配当の情報を確認しています…':state.updating?(state.fromCache?'保存していた情報を表示し、最新の情報を確認しています…':'株価や配当の情報を確認しています…'):failed?(record&&hasFacts(record)?'一部の情報は保存済みです。取得日時をご確認ください。':identity?'会社の基本情報を表示しています。株価や配当の情報は今は確認できません。':'情報を確認できませんでした。'):state.status==='stale'?'保存済みの情報です。取得日時をご確認ください。':'';
      if(record&&record.market_data&&record.market_data.kind==='unsupported')refs.status.textContent='会社の基本情報を表示しています。この取引所の株価・配当・時価総額の取得元は未対応です。';
      if(record&&record.market_data&&record.market_data.kind==='unsupported'&&record.issuer_dividend_forecast)refs.status.textContent='この取引所の株価・時価総額の取得元は未対応です。会社の年度予想配当は「数字・配当」で確認できます。';
      if(record&&record.market_data&&record.market_data.kind==='unsupported'&&record.historical_dividend_status!==null){
        refs.status.textContent='この取引所の株価・時価総額の取得元は未対応です。'+(record.issuer_dividend_forecast?'会社の年度予想配当は「数字・配当」で確認できます。':'')+(record.dividend_fact?'年度の実績配当は「数字・配当」で確認できます。':record.historical_dividend_status==='loading'?'年度の実績配当を確認しています。':'年度の実績配当はまだ確認できていません。');
      }
      refs.retry.hidden=!failed;
      feedback.hidden=!refs.status.textContent&&!failed;
      refs.basic.hidden=!(identity&&(identity.market||identity.industry));
      ['market','industry'].forEach(key=>{refs[key].row.hidden=!(identity&&identity[key]);refs[key].value.textContent=identity&&identity[key]||'';});
      refs.business.section.hidden=!editorial&&!overview&&!refs.basic.hidden;
      refs.business.body.textContent=editorial?editorial.business:overview&&overview.text?overview.text:overview&&overview.field_status==='loading'?'会社の事業内容を確認しています…':overview?'会社の事業内容はまだ確認できていません。':record?'この会社の説明はまだ掲載されていません':failed?'この会社の説明は今は確認できません。':'会社の説明を確認しています…';
      refs.businessSource.hidden=!!editorial||!(overview&&overview.text);
      const businessSignature=refs.businessSource.hidden?'':JSON.stringify([overview.fetched_at,overview.source_title,overview.source_url,overview.source_updated_on,overview.source_record_updated_on,overview.source_published_on,overview.reviewed_on,overview.attribution_notice]);
      if(businessSignature!==businessSourceSignature){
        businessSourceSignature=businessSignature;refs.businessSource.replaceChildren();
        if(!refs.businessSource.hidden){
          if(overview.source_published_on)refs.businessSource.appendChild(el('span','',dates.label(overview.source_published_on,'提出')+' / '));
          if(overview.fetched_at)refs.businessSource.appendChild(el('span','',dates.label(overview.fetched_at/1000,'取得',true)+' '));
          const link=el('a','cp-source-link',overview.source_title+' ↗');link.href=overview.source_url;link.target='_blank';link.rel='noopener noreferrer';refs.businessSource.appendChild(link);
          if(overview.source_record_updated_on)refs.businessSource.appendChild(el('span','',' / '+dates.label(overview.source_record_updated_on,'企業掲載情報の更新')));
          if(overview.source_updated_on)refs.businessSource.appendChild(el('span','',' / '+dates.label(overview.source_updated_on,'一括データ更新')));
          if(overview.attribution_notice)refs.businessSource.appendChild(el('p','cp-source-note',overview.attribution_notice));
        }
      }
      ['life','watch'].forEach(key=>{refs[key].section.hidden=!(editorial&&editorial[key]);refs[key].body.textContent=editorial&&editorial[key]||'';});
      function showMetric(key,value,when){setMetric(key,value,when,fieldReason(state,METRIC_KEYS[key]));}
      function fetched(field,fallback){const value=record&&record.source.fields[field]&&record.source.fields[field].fetched_at||fallback;return stamp(value)?dates.label(value/1000,'取得',true):'取得日時：未確認';}
      showMetric('price',money(data.price,currency),data.price!==null&&data.price!==undefined?(stamp(data.price_updated_at)?dates.label(data.price_updated_at/1000,'株価時点',true):data.price_trade_date?dates.label(data.price_trade_date,'終値'):'株価の時点：未確認')+' / '+fetched('price'):null);
      refs.price.note.textContent=quoteNote(state,w.now?w.now():Date.now());refs.price.note.hidden=!refs.price.note.textContent;
      const marketReference=record&&record.market_data&&record.market_data.kind==='unsupported'&&identity&&REGIONAL_MARKET_REFERENCES[identity.exchange]||'';
      if(marketReference!==marketReferenceSignature){
        marketReferenceSignature=marketReference;refs.price.reference.replaceChildren();refs.price.reference.hidden=!marketReference;
        if(marketReference){const link=el('a','cp-source-link','取引所の公表データを確認 ↗');link.href=marketReference;link.target='_blank';link.rel='noopener noreferrer';append(refs.price.reference,link,el('span','','（株価の時点はリンク先でご確認ください）'));}
      }
      showMetric('cap',money(data.market_cap,currency,true),data.market_cap!==null&&data.market_cap!==undefined?fetched('market_cap'):null);
      showMetric('currentPer',null,null);
      showMetric('annual',money(data.annual_dividend,currency),data.annual_dividend!==null&&data.annual_dividend!==undefined?(stamp(data.dividend_fetched_at)?dates.label(data.dividend_fetched_at/1000,'取得',true):'取得日時：未確認'):null);
      const historical=record&&record.dividend_fact,historicalVisible=record&&record.historical_dividend_status!==null;
      refs.historical.row.hidden=!historicalVisible;
      showMetric('historical',historical?money(data[HISTORICAL_FIELD],'JPY'):null,historical?dates.label(historical.submitted_at/1000,'提出',true)+' / '+dates.label(historical.fetched_at/1000,'取得',true):null);
      refs.historical.period.textContent=historical?dates.date(historical.fiscal_period.start)+'〜'+dates.date(historical.fiscal_period.end)+' 対象年度':'';refs.historical.period.hidden=!historical;
      const historicalSignature=historical?JSON.stringify([historical.doc_id,historical.source_url]):'';
      if(historicalSignature!==historicalSourceSignature){historicalSourceSignature=historicalSignature;refs.historical.source.replaceChildren();if(historical){const link=el('a','cp-source-link','EDINET 有価証券報告書 ↗');link.href=historical.source_url;link.target='_blank';link.rel='noopener noreferrer';refs.historical.source.appendChild(link);}}
      refs.historical.source.hidden=!historical;
      refs.historical.note.textContent=historical?'当サイトがEDINET有価証券報告書から配当額を抜粋。株式分割は調整していません。最新の書類・訂正の確認は保証されません。'+(record.historical_dividend_refreshing?' 新しい書類を確認中です。':record.historical_dividend_error==='fetch_error'?' 更新時に通信エラーがあり、保存済みの実績を表示しています。':state.fromCache?' 保存済みの実績を表示しています。':''):'';refs.historical.note.hidden=!historical;
      showMetric('forward',money(data.forward_annual_dividend_per_share,currency),data.forward_annual_dividend_per_share!==null&&data.forward_annual_dividend_per_share!==undefined?fetched('forward_annual_dividend_per_share'):null);
      const issuerForecast=record&&record.issuer_dividend_forecast;
      refs.issuerForecast.row.hidden=!(record&&record.issuer_dividend_forecast_status!==null);
      const issuerMoney=value=>finite(value)&&value>=0?value.toLocaleString('ja-JP',{maximumFractionDigits:20})+'円':null;
      const issuerForecastValue=issuerForecast&&issuerForecast.status==='range'?issuerForecast.value_range.min.toLocaleString('ja-JP',{maximumFractionDigits:20})+'〜'+issuerMoney(issuerForecast.value_range.max):issuerForecast&&{undetermined:'未定',not_comparable:'年間額は比較不可',not_disclosed:'年間額の記載なし'}[issuerForecast.status]||issuerMoney(data[ISSUER_FORECAST_FIELD]);
      showMetric('issuerForecast',issuerForecastValue,issuerForecast?dates.label(issuerForecast.announcement_date,'公表')+' / '+dates.label(issuerForecast.fetched_at/1000,'取得',true):null);
      refs.issuerForecast.period.textContent=issuerForecast?dates.date(issuerForecast.fiscal_period.start)+'〜'+dates.date(issuerForecast.fiscal_period.end)+' 対象年度':'';refs.issuerForecast.period.hidden=!issuerForecast;
      const issuerForecastSignature=issuerForecast?JSON.stringify([issuerForecast.source_url,issuerForecast.source_title]):'';
      if(issuerForecastSignature!==issuerForecastSourceSignature){issuerForecastSourceSignature=issuerForecastSignature;refs.issuerForecast.source.replaceChildren();if(issuerForecast){const link=el('a','cp-source-link',issuerForecast.source_title+' ↗');link.href=issuerForecast.source_url;link.target='_blank';link.rel='noopener noreferrer';refs.issuerForecast.source.appendChild(link);}}refs.issuerForecast.source.hidden=!issuerForecast;
      const reportedSplit=issuerForecast&&issuerForecast.reported_split;
      refs.issuerForecast.note.textContent=issuerForecast?(issuerForecast.fiscal_period_expired?'対象年度は終了しています。資料当時の予想で、実績ではありません。 ':'')+(issuerForecast.status==='not_comparable'?'中間と期末で株式分割の基準が異なり、会社が年間額を示していないため合算しません。 ':'')+(reportedSplit?dates.date(reportedSplit.effective_on)+'の'+reportedSplit.before+'対'+reportedSplit.after+'の株式分割後の基準を会社が記載しています。 ':'')+'資料公表時点の会社予想です。最新の修正は保証されません。当サイトでは株式分割の換算を行っていません。':'';refs.issuerForecast.note.hidden=!issuerForecast;
      function schedule(value){return day(value)&&w.KNDividendDates?w.KNDividendDates.describe(value):null;}
      showMetric('exDate',schedule(data.ex_dividend_date),day(data.ex_dividend_date)?fetched('ex_dividend_date'):null);
      const paymentMonth=month(data.dividend_payment_period),paymentDate=day(data.dividend_payment_date);
      const paymentValue=paymentDate?schedule(paymentDate):paymentMonth?(w.KNDividendDates?w.KNDividendDates.describe(paymentMonth,Date.now(),true):null):null;
      showMetric('paymentDate',paymentValue,paymentDate?fetched('dividend_payment_date'):paymentMonth?'日付は未確認 / '+fetched('dividend_payment_period'):null);
      const analyst=data.analyst_target;
      showMetric('target',money(analyst&&analyst.mean,currency),analyst&&(analyst.mean!==null||analyst.low!==null||analyst.high!==null)?fetched('analyst_target'):null);
      refs.reasonHelp.hidden=!Object.keys(METRIC_KEYS).some(key=>key!=='currentPer'&&!refs[key].row.hidden&&!refs[key].unknown.hidden);
      const range=analyst&&analyst.low!==null&&analyst.high!==null?'予想の幅 '+money(analyst.low,currency)+'〜'+money(analyst.high,currency):'';
      refs.targetRange.textContent=[range,analyst&&analyst.analyst_count?analyst.analyst_count+'人の予想':''].filter(Boolean).join(' / ');refs.targetRange.hidden=!refs.targetRange.textContent;
      refs.targetDate.textContent=analyst&&(analyst.mean!==null||analyst.low!==null||analyst.high!==null)?(analyst.as_of?dates.label(analyst.as_of,'予想'):'予想が出された日は提供元に記載がありません。'):'';refs.targetDate.hidden=!refs.targetDate.textContent;
      refs.reviewed.textContent=editorial?(editorial.reviewed_on?dates.label(editorial.reviewed_on,'会社の説明を確認'):'会社の説明の確認日：未確認'):'';refs.reviewed.hidden=!refs.reviewed.textContent;
      refs.identityDate.textContent=identity?dates.label(identity.date,'会社一覧の基準日'):'';refs.identityDate.hidden=!refs.identityDate.textContent;
      const allSources=[...(editorial&&editorial.sources||[]),...(!editorial&&overview&&overview.text?[{title:overview.source_title,url:overview.source_url,fetched_at:overview.fetched_at}]:[]),...(identity?[{title:identity.source_title,url:identity.source_url,fetched_at:null}]:[]),...(record&&record.sources||[])],signature=JSON.stringify(allSources);
      if(signature!==sourcesSignature){
        sourcesSignature=signature;refs.sources.replaceChildren();
        const unique=new Set();allSources.forEach(source=>{if(unique.has(source.url))return;unique.add(source.url);const row=el('li'),link=el('a','cp-source-link',source.title+' ↗');link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';if(stamp(source.fetched_at))row.appendChild(el('small','cp-source-time',dates.label(source.fetched_at/1000,'取得',true)));row.appendChild(link);refs.sources.appendChild(row);});
        if(!allSources.length)refs.sources.appendChild(el('li','cp-source-time','出典：未確認'));
      }
    }
    function sizeViewport(){if(!opened||!w.visualViewport)return;overlay.style.setProperty('--cp-viewport-height',Math.round(w.visualViewport.height)+'px');overlay.style.setProperty('--cp-viewport-top',Math.max(0,Math.round(w.visualViewport.offsetTop))+'px');}
    function rememberBackground(trigger){
      returnFocus=trigger||doc.activeElement;scrolls=[];let node=returnFocus;
      const companyPanel=doc.getElementById('knCompanyFocus');returnCompanySymbol=companyPanel&&companyPanel.contains(returnFocus)&&returnFocus.dataset?symbol(returnFocus.dataset.companyProfile):'';
      while(node&&node!==doc.body){if(node.scrollTop||node.scrollLeft)scrolls.push({node,top:node.scrollTop,left:node.scrollLeft});node=node.parentElement;}
      const home=doc.getElementById('morning-section');if(home&&!scrolls.some(item=>item.node===home))scrolls.push({node:home,top:home.scrollTop,left:home.scrollLeft});
      background=Array.from(doc.body.children).filter(node=>node!==overlay&&!['SCRIPT','STYLE','LINK'].includes(node.tagName)).map(node=>({node,inert:node.inert,aria:node.getAttribute('aria-hidden')}));
      background.forEach(item=>{item.node.inert=true;});
      const style=doc.body.style;bodyStyle={};['overflow','position','top','left','right','width','paddingRight'].forEach(key=>bodyStyle[key]=style[key]);bodyStyle.scrollY=w.scrollY||0;
      const gutter=Math.max(0,w.innerWidth-doc.documentElement.clientWidth);
      if(gutter&&w.getComputedStyle)style.paddingRight=(parseFloat(w.getComputedStyle(doc.body).paddingRight)||0)+gutter+'px';
      style.overflow='hidden';style.position='fixed';style.top=-bodyStyle.scrollY+'px';style.left='0';style.right='0';style.width='100%';
    }
    function open(key,name,trigger){
      if(closing!==null){w.clearTimeout(closing);closing=null;}
      delete overlay.dataset.closing;
      if(!opened)rememberBackground(trigger);
      if(currentSymbol!==key){numbers.open=false;content.scrollTop=0;sourcesSignature='';}
      currentSymbol=key;selectedName=text(name,160)||key;opened=true;refs.code.textContent=key.replace(/\.(?:T|JP)$/,'');refs.name.textContent=selectedName;overlay.hidden=false;sizeViewport();panel.focus({preventScroll:true});
      background.forEach(item=>item.node.setAttribute('aria-hidden','true'));
    }
    function finishClose(){
      closing=null;opened=false;overlay.hidden=true;delete overlay.dataset.closing;
      background.forEach(item=>{item.node.inert=item.inert;if(item.aria===null)item.node.removeAttribute('aria-hidden');else item.node.setAttribute('aria-hidden',item.aria);});background=[];
      const previous=bodyStyle;if(previous){Object.keys(previous).filter(key=>key!=='scrollY').forEach(key=>doc.body.style[key]=previous[key]);w.scrollTo({top:previous.scrollY,behavior:'instant'});}
      scrolls.forEach(item=>{if(item.node.isConnected){item.node.scrollTop=item.top;item.node.scrollLeft=item.left;}});scrolls=[];
      const companyPanel=returnCompanySymbol&&doc.getElementById('knCompanyFocus');
      const replacement=companyPanel&&Array.from(companyPanel.querySelectorAll('[data-company-profile]')).find(node=>symbol(node.dataset.companyProfile)===returnCompanySymbol&&node.isConnected&&!node.disabled&&node.getAttribute('aria-disabled')!=='true'&&!node.closest('[inert]')&&node.getClientRects().length);
      const target=returnFocus&&returnFocus.isConnected&&!returnFocus.closest('[inert]')?returnFocus:replacement||doc.querySelector('#knTabWrap button, #knBottomNav button');
      if(target)target.focus({preventScroll:true});
    }
    function close(immediate=false){if(!opened||closing!==null)return;if(immediate||w.matchMedia&&w.matchMedia('(prefers-reduced-motion: reduce)').matches){finishClose();return;}overlay.dataset.closing='true';closing=w.setTimeout(finishClose,180);}
    let onClose=()=>close();
    closeButton.addEventListener('click',()=>onClose());refs.retry.addEventListener('click',()=>onRetry());
    overlay.addEventListener('click',event=>{if(event.target===overlay||event.target===backdrop)onClose();});
    function focusables(){return Array.from(panel.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]')).filter(node=>!node.closest('[hidden]')&&node.getClientRects().length);}
    doc.addEventListener('keydown',event=>{
      if(!opened||event.isComposing)return;
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();onClose();return;}
      if(event.key!=='Tab')return;
      event.stopImmediatePropagation();const all=focusables(),first=all[0],last=all[all.length-1];
      if(!first){event.preventDefault();panel.focus({preventScroll:true});}
      else if(event.shiftKey&&(doc.activeElement===first||!all.includes(doc.activeElement))){event.preventDefault();last.focus({preventScroll:true});}
      else if(!event.shiftKey&&(doc.activeElement===last||!all.includes(doc.activeElement))){event.preventDefault();first.focus({preventScroll:true});}
    },true);
    doc.addEventListener('focusin',event=>{if(opened&&!panel.contains(event.target))(focusables()[0]||panel).focus({preventScroll:true});},true);
    if(w.visualViewport){w.visualViewport.addEventListener('resize',sizeViewport);w.visualViewport.addEventListener('scroll',sizeViewport);}
    return {open,close,render,setClose(fn){onClose=fn;},isOpen:()=>opened,elements:{overlay,panel,content,numbers,closeButton,backdrop,...refs}};
  }
  function start(w){
    if(w.KNCompanyProfile&&w.KNCompanyProfile.__ready)return w.KNCompanyProfile;
    let view=null,current='',name='',refreshTimer=null;
    let storage=null;try{storage=w.localStorage;}catch(e){}
    const env={fetch:w.fetch.bind(w),AbortController:w.AbortController,setTimeout:w.setTimeout.bind(w),clearTimeout:w.clearTimeout.bind(w),now:w.now,storage,purpose:'detail'};
    function stopRefresh(){w.clearTimeout(refreshTimer);refreshTimer=null;}
    const loader=createLoader(env,state=>{
      if(view)view.render(state);
      stopRefresh();
      // Only a current API response can enable licensed quote refreshes.
      // An old browser cache or a failed request cannot grant that capability.
      if(!state.updating&&state.quoteRefreshEnabled===true&&view&&view.isOpen()&&!w.document.hidden&&current.endsWith('.T')&&!['not_found','invalid_request','invalid'].includes(state.reason)){
        const delay=Math.max(QUOTE_REFRESH_MS,((state.data&&state.data.retry_after_seconds)||0)*1000);
        refreshTimer=w.setTimeout(()=>{refreshTimer=null;if(view.isOpen()&&!w.document.hidden)loader.load(current);},delay);
      }
    });
    function close(){stopRefresh();loader.cancel();if(view)view.close();}
    function open(value,label,trigger){
      const key=symbol(value);if(!key||!w.document.body)return false;
      if(!view){view=createDialog(w,()=>loader.load(current));view.setClose(close);}
      stopRefresh();current=key;name=text(label,160)||key;view.open(key,name,trigger);if(!w.document.hidden)loader.load(key);const state=loader.getState();if(state&&state.symbol===key)view.render(state);return true;
    }
    w.document.addEventListener('visibilitychange',()=>{if(!view||!view.isOpen())return;stopRefresh();if(w.document.hidden)loader.cancel();else loader.load(current);});
    w.document.addEventListener('click',event=>{const target=event.target&&event.target.closest&&event.target.closest('[data-company-profile]');if(!target||target.disabled||target.getAttribute('aria-disabled')==='true'||!symbol(target.dataset.companyProfile))return;event.preventDefault();event.stopPropagation();open(target.dataset.companyProfile,target.dataset.companyName,target);},true);
    return {open,close,createFactsLoader:onState=>createLoader({...env,purpose:'preview'},onState),__ready:true};
  }
  return {symbol,safeUrl,day,month,timestamp,stamp,money,normalize,hasFacts,fieldReason,quoteNote,createLoader,createDialog,start,POLL_MS,POLL_LIMIT,REQUEST_TIMEOUT,QUOTE_REFRESH_MS};
});

/* Dated, issuer-reported annual PER facts. Never calculate today's PER here. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./date-display.js'):root.KNDateDisplay);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.KNYearPER=api;
})(typeof window==='undefined'?null:window,function(dates){
  'use strict';
  const KIND='issuer_reported_fiscal_per',BASIS={consolidated:'連結',standalone:'単体'},STANDARDS={JGAAP:'日本基準',IFRS:'IFRS',USGAAP:'米国基準'};
  function japaneseSymbol(value){return typeof value==='string'&&/^[0-9][A-Z0-9]{3}\.(?:T|JP)$/.test(value)?value:'';}
  function normalize(raw,item,now=Date.now()/1000){
    const key=japaneseSymbol(item&&item.symbol);
    if(!key||!raw||typeof raw!=='object'||!dates||typeof dates.date!=='function'||typeof now!=='number'||!Number.isFinite(now))return null;
    const exchange=raw.exchange,period=raw.fiscal_period||{},date=value=>typeof value==='string'?dates.date(value):'',start=date(period.start),end=date(period.end),filed=date(raw.filed_on),checked=date(raw.checked_on);
    const today=dates.date(now),fetchedDay=dates.date(raw.fetched_at),expectedCode=key.split('.')[0],title=typeof raw.source_title==='string'?raw.source_title.trim():'';
    const document=/^S[A-Z0-9]{7}$/.test(raw.doc_id||'')&&[
      'https://info.gbiz.go.jp/hojin/edinetDownload?docId='+raw.doc_id,
      'https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/'+raw.doc_id+'.pdf'
    ].includes(raw.source_url);
    if(raw.kind!==KIND||raw.symbol!==key||raw.security_code!==expectedCode||raw.issuer_name!==item.name||typeof item.name!=='string'||!item.name.trim()||raw.unit!=='times'||raw.latest_filing_guaranteed!==false||raw.use_basis!=='independent_extraction_of_numeric_facts'||
       !['Tokyo','Nagoya','Sapporo','Fukuoka'].includes(exchange)||key.endsWith('.T')!==(exchange==='Tokyo')||item.exchange&&item.exchange!==exchange||item.code&&item.code!==expectedCode||
       !Object.prototype.hasOwnProperty.call(BASIS,raw.basis)||!Object.prototype.hasOwnProperty.call(STANDARDS,raw.accounting_standard)||!document||!title||title.length>160||
       !start||!end||!filed||!checked||!today||start>=end||(Date.parse(period.end)-Date.parse(period.start))/86400000>550||end>filed||filed>checked||checked>today||typeof raw.fetched_at!=='number'||!Number.isFinite(raw.fetched_at)||raw.fetched_at<=0||raw.fetched_at>now||!fetchedDay||filed>fetchedDay||fetchedDay>checked||
       !['period_end_explicit','not_stated'].includes(raw.price_basis)||raw.price_basis==='period_end_explicit'&&raw.price_reference_date!==period.end||raw.price_basis==='not_stated'&&raw.price_reference_date!==null)return null;
    if(raw.status==='available'){
      if(typeof raw.value!=='number'||!Number.isFinite(raw.value)||raw.value<=0||raw.value>1e7||Number(raw.value.toFixed(8))!==raw.value||raw.reason!==null&&raw.reason!==undefined)return null;
    }else if(raw.status==='not_presented'){
      if(raw.value!==null||!['loss_eps','zero_eps','ratio_not_disclosed'].includes(raw.reason))return null;
    }else return null;
    return {kind:KIND,symbol:key,status:raw.status,value:raw.value,reason:raw.reason||null,unit:'times',basis:raw.basis,accounting_standard:raw.accounting_standard,
      security_code:expectedCode,issuer_name:raw.issuer_name,exchange,fiscal_period:{start:period.start,end:period.end},price_basis:raw.price_basis,price_reference_date:raw.price_reference_date,
      source_url:raw.source_url,source_title:title,doc_id:raw.doc_id,filed_on:raw.filed_on,checked_on:raw.checked_on,fetched_at:raw.fetched_at,
      use_basis:'independent_extraction_of_numeric_facts',latest_filing_guaranteed:false};
  }
  function value(fact){
    if(!fact)return null;
    if(fact.status==='available')return fact.value.toLocaleString('ja-JP',{maximumFractionDigits:8})+'倍';
    return {loss_eps:'算定対象外（1株利益が赤字）',zero_eps:'算定対象外（1株利益が0）',ratio_not_disclosed:'未記載'}[fact.reason]||null;
  }
  function basis(fact){return fact?BASIS[fact.basis]+'・'+STANDARDS[fact.accounting_standard]:'';}
  function line(item,now){
    if(!japaneseSymbol(item&&item.symbol))return '';
    const fact=normalize(item.year_per,item,now);
    return fact?'有報の年度PER（'+BASIS[fact.basis]+'） '+value(fact)+' · '+dates.date(fact.fiscal_period.end)+'までの年度':'有報の年度PER 未確認';
  }
  return Object.freeze({normalize,value,basis,line,KIND});
});

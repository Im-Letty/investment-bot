/* Company programmes and reviewed schedules; never infer annual dates in the view. */
(function(root,factory){
  const data=typeof module==='object'&&module.exports?require('./shareholder-benefits-data.js'):root&&root.KNBenefitsData;
  const api=factory(Array.isArray(data)?data:[]);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.KNBenefits=api;
})(typeof window==='undefined'?null:window,function(programmes){
'use strict';
function validDay(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const day=new Date(value+'T00:00:00Z');
  return Number.isFinite(day.getTime())&&day.toISOString().slice(0,10)===value;
}
function schedulesFor(company){
  const seen=new Set();
  return (Array.isArray(company.schedules)?company.schedules:[]).filter(schedule=>{
    if(!schedule||!validDay(schedule.date)||seen.has(schedule.date))return false;
    seen.add(schedule.date);return true;
  }).map(schedule=>({...company,...schedule})).sort((a,b)=>a.date.localeCompare(b.date));
}
function rowsForMonth(month){return programmes.flatMap(schedulesFor).filter(row=>row.date.slice(0,7)===month);}
function searchKey(value){return String(value||'').normalize('NFKC').toLowerCase().replace(/[\s・]/g,'').replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));}
function nextRow(company,today){
  const dates=schedulesFor(company),next=dates.find(row=>row.date>=today);
  return next||{...company,date:null,record:null,holdUntil:'次回の保有締切は確認中',grant:'次回の付与時期は確認中',lastConfirmed:dates.length?dates[dates.length-1].date:null};
}
function create(w,mount,cal){
  const doc=w.document;
  let month=cal.today().slice(0,7),selected=null,query='',limit=5,pendingLimit=5;
  const dateButtons=new Map();
  function el(tag,cls,text){const node=doc.createElement(tag);node.className=cls||'';if(text!==undefined)node.textContent=text;return node;}
  function btn(text,cls,fn){const node=el('button',cls,text);node.type='button';node.addEventListener('click',fn);return node;}
  function reset(){selected=null;limit=pendingLimit=5;}
  const intro=el('p','dc-status');intro.setAttribute('aria-live','polite');
  const search=el('input','dc-search');search.type='search';search.placeholder='掲載中の会社名・銘柄コードで探す';search.setAttribute('aria-label','掲載中の全ての株主優待を検索');
  search.addEventListener('input',()=>{query=searchKey(search.value);reset();render();});
  const nav=el('div','dc-month-navigation'),label=el('h3','dc-month');
  const prev=btn('‹','dc-month-arrow',()=>move(-1)),next=btn('›','dc-month-arrow',()=>move(1));
  prev.setAttribute('aria-label','優待カレンダーの前の月');next.setAttribute('aria-label','優待カレンダーの次の月');
  [prev,label,next].forEach(node=>nav.appendChild(node));
  const todayButton=btn('今月に戻る','dc-more bc-today',()=>{month=cal.today().slice(0,7);reset();render();});
  const layout=el('div','dc-layout'),left=el('section','dc-calendar-panel'),right=el('section','dc-agenda-panel');
  const week=el('div','dc-weekdays'),grid=el('div','dc-grid'),list=el('div','bc-list'),head=el('h4','bc-heading');
  const more=btn('もっと見る','dc-more bc-more',()=>{limit+=5;render();});
  ['日','月','火','水','木','金','土'].forEach(day=>week.appendChild(el('span','',day)));
  [week,grid].forEach(node=>left.appendChild(node));[head,list,more].forEach(node=>right.appendChild(node));
  layout.appendChild(left);layout.appendChild(right);
  const pending=el('details','bc-pending'),pendingHeading=el('summary'),pendingBody=el('div','bc-pending-body');pending.open=true;
  const pendingMore=btn('もっと見る','dc-more bc-pending-more',()=>{pendingLimit+=5;render();});
  [pendingHeading,pendingBody,pendingMore].forEach(node=>pending.appendChild(node));
  const note=el('p','dc-coverage','カレンダーは購入締切日です。現行制度に基づく予定を含みます。長期保有が必要な優待は、締切当日の購入だけでは対象になりません。空欄や検索結果なしは、優待がないという意味ではありません。');
  [intro,search,nav,todayButton,layout,pending,note].forEach(node=>mount.appendChild(node));
  function favorites(){try{const saved=JSON.parse(w.localStorage.getItem('alert_watchlist_v1')||'[]');return new Set(Array.isArray(saved)?saved.map(code=>String(code).normalize('NFKC').toUpperCase().replace(/\.T$/,'')):[]);}catch(_){return new Set();}}
  function sortRows(rows){const saved=favorites();return rows.slice().sort((a,b)=>Number(saved.has(b.code))-Number(saved.has(a.code))||(a.date||'9999').localeCompare(b.date||'9999')||a.code.localeCompare(b.code));}
  function matches(company){return !query||searchKey(company.name+' '+company.code+' '+(company.aliases||'')).includes(query);}
  function card(row,opened){
    const box=el('details','bc-card'),summary=el('summary','bc-summary');
    box.dataset.benefitKey=row.code+':'+(row.date||'pending');box.open=opened.has(box.dataset.benefitKey);
    const hold=row.date?(row.holdUntil||row.date.replaceAll('-','/')+'の取引終了まで'):'次回の保有締切は確認中';
    [el('span','bc-company',row.name+'　'+row.code),el('strong','bc-reward',row.reward),el('span','bc-tags',row.shares+' ／ '+row.holding),el('span','bc-date','いつまで持つ？ '+hold+(row.status==='planned'?'（予定）':'')),el('span','bc-date','いつもらえる？ '+(row.grant||'付与時期は会社の案内で確認'))].forEach(node=>summary.appendChild(node));
    if(row.basis)summary.appendChild(el('span','dc-coverage bc-basis',row.basis));
    box.appendChild(summary);
    const details=el('dl','bc-detail');
    const period=(row.record?row.record.replaceAll('-','/')+'の株主名簿で確認。':'')+(row.period||'会社の案内で確認');
    [['何がもらえる？',row.use],['いつまで持つ？',row.holdExplanation||'継続保有など会社所定の条件があります。会社の優待案内をご確認ください。'],['優待を受け取る条件',row.conditions],['いつもらえる？',row.delivery||'次回の詳しい付与日程は未確認です。会社の案内をご確認ください。'],['対象になる時期',period]].forEach(([title,text])=>{details.appendChild(el('dt','',title));details.appendChild(el('dd','',text||'会社の案内で確認'));});
    box.appendChild(details);
    if(row.lastConfirmed)box.appendChild(el('p','dc-coverage','前回掲載した締切：'+row.lastConfirmed.replaceAll('-','/')+'。次回の日程は未確認です。'));
    const link=el('a','dc-help-source','会社の優待案内 ↗');link.href=row.url;link.target='_blank';link.rel='noopener noreferrer';box.appendChild(link);
    const source=row.source,sourceUrl=typeof source==='string'?source:source&&source.url;
    if(sourceUrl&&sourceUrl!==row.url){const dates=el('a','dc-help-source bc-date-source','購入締切の日程資料 ↗');dates.href=sourceUrl;dates.target='_blank';dates.rel='noopener noreferrer';box.appendChild(dates);}
    if(row.verified)box.appendChild(el('p','dc-coverage',row.verified.replaceAll('-','/')+' 確認'));
    if(query&&row.date&&row.date.slice(0,7)!==month&&cal.bounds().months.includes(row.date.slice(0,7))){
      box.appendChild(btn(row.date.slice(0,7).replace('-','年 ')+'月のカレンダーを見る','dc-more bc-jump',()=>{month=row.date.slice(0,7);selected=row.date;limit=5;render();}));
    }
    return box;
  }
  function drawList(target,rows,count){
    const opened=new Set(Array.from(target.children).filter(node=>node.open).map(node=>node.dataset.benefitKey));
    target.replaceChildren();rows.slice(0,count).forEach(row=>target.appendChild(card(row,opened)));
  }
  function move(delta){const candidate=cal.shift(month,delta);if(!cal.bounds().months.includes(candidate))return;month=candidate;reset();render();}
  function render(){
    const today=cal.today(),months=cal.bounds().months;
    if(!months.includes(month)){month=months[0];reset();}
    prev.disabled=month===months[0];next.disabled=month===months[months.length-1];todayButton.hidden=month===today.slice(0,7);
    label.textContent=month.replace('-','年 ')+'月';
    const allMonthRows=rowsForMonth(month),events=allMonthRows.filter(matches),allMatches=programmes.filter(matches);
    layout.dataset.searching=String(!!query);
    const total=new Set(programmes.map(company=>company.code)).size;
    intro.textContent=query?'掲載'+total+'社のうち、検索結果は'+allMatches.length+'社。表示中の月に一致する日程は'+new Set(events.map(row=>row.code)).size+'社・'+events.length+'件です。':'公式情報を確認した'+total+'社を掲載。この月の掲載日程は'+new Set(allMonthRows.map(row=>row.code)).size+'社・'+allMonthRows.length+'件です。全ての優待を網羅しているものではありません。';
    grid.replaceChildren();dateButtons.clear();
    cal.calendarDays(month,events.map(row=>({date:row.date,precision:'day',kind:'benefit'})),today).forEach(day=>{
      if(!day){grid.appendChild(el('span'));return;}
      const button=btn(String(day.day),'dc-day',()=>{selected=selected===day.date?null:day.date;limit=5;render();const focused=dateButtons.get(day.date);if(focused)focused.focus();});
      button.dataset.date=day.date;if(day.count)button.appendChild(el('span','dc-day-count',day.count+'件'));
      button.setAttribute('aria-label',day.date+' 優待の購入締切 '+day.count+'件');button.setAttribute('aria-pressed',String(selected===day.date));
      if(day.date===today)button.setAttribute('aria-current','date');dateButtons.set(day.date,button);grid.appendChild(button);
    });
    const searching=!!query&&!selected;
    const rows=sortRows(searching?allMatches.map(company=>nextRow(company,today)):events.filter(row=>!selected||row.date===selected));
    head.textContent=selected?selected.replaceAll('-','/')+' の購入締切':searching?'掲載企業の検索結果 '+allMatches.length+'社（次回の掲載日程）':'この月の優待の購入締切';
    drawList(list,rows,limit);more.hidden=rows.length<=limit;more.textContent='もっと見る（残り'+Math.max(0,rows.length-limit)+'件）';
    if(!rows.length)list.appendChild(el('p','dc-empty',searching?'掲載中の会社には一致するものがありません。未掲載の会社にも優待がある場合があります。':'この月・日付の掲載日程はありません。優待がないという意味ではありません。'));
    const unknown=sortRows(allMatches.map(company=>nextRow(company,today)).filter(row=>!row.date));
    pending.hidden=!!query||!unknown.length;pendingHeading.textContent='制度を掲載済み・次回の日程は未確認 '+unknown.length+'社';
    drawList(pendingBody,unknown,pendingLimit);pendingMore.hidden=unknown.length<=pendingLimit;pendingMore.textContent='もっと見る（残り'+Math.max(0,unknown.length-pendingLimit)+'社）';
  }
  if(doc.addEventListener)doc.addEventListener('visibilitychange',()=>{if(!doc.hidden)render();});
  if(w.addEventListener)w.addEventListener('kn:watchlist-change',render);
  render();return {render};
}
return {programmes,rowsForMonth,create};
});

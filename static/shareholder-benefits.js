/* Company programmes and reviewed schedules; never infer annual dates in the view. */
(function(root,factory){
  const data=typeof module==='object'&&module.exports?require('./shareholder-benefits-data.js'):root&&root.KNBenefitsData;
  const dates=typeof module==='object'&&module.exports?require('./date-display.js'):root&&root.KNDateDisplay;
  const api=factory(Array.isArray(data)?data:[],dates);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.KNBenefits=api;
})(typeof window==='undefined'?null:window,function(programmes,dates){
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
function monthLabel(value){return value.slice(0,4)+'年'+Number(value.slice(5))+'月';}
function shortDay(value){return Number(value.slice(5,7))+'/'+Number(value.slice(8));}
function agendaLabel(value){return shortDay(value)+' '+['日','月','火','水','木','金','土'][new Date(value+'T00:00:00Z').getUTCDay()]+'曜日の予定';}
function nextRow(company,today){
  const dates=schedulesFor(company),next=dates.find(row=>row.date>=today);
  return next||{...company,date:null,record:null,holdUntil:'次回の保有締切は確認中',grant:'次回の付与時期は確認中',lastConfirmed:dates.length?dates[dates.length-1].date:null};
}
function create(w,mount,cal){
  const doc=w.document;
  let month=cal.today().slice(0,7),selected=null,limit=5,pendingLimit=5;
  const dateButtons=new Map();
  function el(tag,cls,text){const node=doc.createElement(tag);node.className=cls||'';if(text!==undefined)node.textContent=text;return node;}
  function btn(text,cls,fn){const node=el('button',cls,text);node.type='button';node.addEventListener('click',fn);return node;}
  function reset(){selected=null;limit=pendingLimit=5;}
  const nav=el('div','dc-month-navigation'),label=el('h3','dc-month');
  const prev=btn('‹','dc-month-arrow',()=>move(-1)),next=btn('›','dc-month-arrow',()=>move(1));
  prev.setAttribute('aria-label','優待カレンダーの前の月');next.setAttribute('aria-label','優待カレンダーの次の月');
  [prev,label,next].forEach(node=>nav.appendChild(node));
  const todayButton=btn('今月に戻る','dc-more bc-today',()=>{month=cal.today().slice(0,7);reset();render();});
  const layout=el('div','dc-layout'),left=el('section','dc-calendar-panel'),right=el('section','dc-agenda-panel');
  const week=el('div','dc-weekdays'),grid=el('div','dc-grid'),list=el('div','bc-list'),head=el('h4','bc-heading'),listHead=el('div','dc-list-heading');
  const clear=btn('予定一覧に戻る','dc-reset',()=>{selected=null;limit=5;render();});clear.hidden=true;
  head.id='bc-agenda-title';label.id='bc-month-title';
  left.setAttribute('aria-labelledby',label.id);right.setAttribute('aria-labelledby',head.id);
  grid.setAttribute('role','group');grid.setAttribute('aria-labelledby',label.id);week.setAttribute('aria-hidden','true');
  listHead.appendChild(head);listHead.appendChild(clear);
  const more=btn('もっと見る','dc-more bc-more',()=>{limit+=5;render();});
  ['日','月','火','水','木','金','土'].forEach(day=>week.appendChild(el('span','',day)));
  [week,grid].forEach(node=>left.appendChild(node));[listHead,list,more].forEach(node=>right.appendChild(node));
  layout.appendChild(left);layout.appendChild(right);
  const pending=el('details','bc-pending'),pendingHeading=el('summary'),pendingBody=el('div','bc-pending-body');pending.open=true;
  const pendingMore=btn('もっと見る','dc-more bc-pending-more',()=>{pendingLimit+=5;render();});
  [pendingHeading,pendingBody,pendingMore].forEach(node=>pending.appendChild(node));
  const note=el('p','dc-coverage','カレンダーは購入締切日です。現行制度に基づく予定を含みます。長期保有が必要な優待は、締切当日の購入だけでは対象になりません。空欄は、優待がないという意味ではありません。');
  [nav,todayButton,layout,pending,note].forEach(node=>mount.appendChild(node));
  function favorites(){try{const saved=JSON.parse(w.localStorage.getItem('alert_watchlist_v1')||'[]');return new Set(Array.isArray(saved)?saved.map(code=>String(code).normalize('NFKC').toUpperCase().replace(/\.T$/,'')):[]);}catch(_){return new Set();}}
  function sortRows(rows){const saved=favorites();return rows.slice().sort((a,b)=>Number(saved.has(b.code))-Number(saved.has(a.code))||(a.date||'9999').localeCompare(b.date||'9999')||a.code.localeCompare(b.code));}
  function card(row,opened){
    const box=el('details','bc-card dc-disclosure'),summary=el('summary','bc-summary dc-event-summary');
    box.dataset.benefitKey=row.code+':'+(row.date||'pending');box.open=opened.has(box.dataset.benefitKey);
    const hold=row.date?(row.holdUntil||row.date.replaceAll('-','/')+'の取引終了まで'):'次回の保有締切は確認中';
    const date=el('span','dc-event-date',row.date?shortDay(row.date):'未確認'),body=el('span','dc-event-body');
    [el('span','dc-company bc-company',row.name),el('span','dc-company-code',row.code),el('strong','bc-reward',row.reward),el('span','bc-tags',row.shares+' ／ '+row.holding),el('span','bc-date','保有はいつまで？ '+hold+(row.status==='planned'?'（予定）':'')),el('span','bc-date','いつもらえる？ '+(row.grant||'付与時期は会社の案内で確認'))].forEach(node=>body.appendChild(node));
    if(row.basis)body.appendChild(el('span','dc-coverage bc-basis',row.basis));
    const badge=el('span','dc-favorite','★');badge.setAttribute('aria-label','お気に入り');badge.hidden=!favorites().has(row.code);
    [date,body,badge].forEach(node=>summary.appendChild(node));
    box.appendChild(summary);
    const details=el('dl','bc-detail');
    const period=(row.record?row.record.replaceAll('-','/')+'の株主名簿で確認。':'')+(row.period||'会社の案内で確認');
    [['何がもらえる？',row.use],['保有はいつまで？',row.holdExplanation||'継続保有など会社所定の条件があります。会社の優待案内をご確認ください。'],['優待を受け取る条件',row.conditions],['いつもらえる？',row.delivery||'次回の詳しい付与日程は未確認です。会社の案内をご確認ください。'],['対象になる時期',period]].forEach(([title,text])=>{details.appendChild(el('dt','',title));details.appendChild(el('dd','',text||'会社の案内で確認'));});
    box.appendChild(details);
    if(row.lastConfirmed)box.appendChild(el('p','dc-coverage','前回掲載した締切：'+row.lastConfirmed.replaceAll('-','/')+'。次回の日程は未確認です。'));
    const verified=dates.label(row.verified,'確認');
    if(verified)box.appendChild(el('p','dc-coverage bc-verified',verified));
    const link=el('a','dc-help-source','会社の優待案内 ↗');link.href=row.url;link.target='_blank';link.rel='noopener noreferrer';box.appendChild(link);
    const source=row.source,sourceUrl=typeof source==='string'?source:source&&source.url;
    if(sourceUrl&&sourceUrl!==row.url){const dates=el('a','dc-help-source bc-date-source','購入締切の日程資料 ↗');dates.href=sourceUrl;dates.target='_blank';dates.rel='noopener noreferrer';box.appendChild(dates);}
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
    label.textContent=monthLabel(month);
    const events=rowsForMonth(month);
    grid.replaceChildren();dateButtons.clear();
    cal.calendarDays(month,events.map(row=>({date:row.date,precision:'day',kind:'benefit'})),today).forEach(day=>{
      if(!day){grid.appendChild(el('span'));return;}
      const button=btn(String(day.day),'dc-day',()=>{selected=selected===day.date?null:day.date;limit=5;render();const focused=dateButtons.get(day.date);if(focused)focused.focus();});
      button.dataset.date=day.date;if(day.count){const count=el('small','dc-day-count',String(day.count));count.setAttribute('aria-hidden','true');button.appendChild(count);}
      button.setAttribute('aria-label',Number(day.date.slice(5,7))+'月'+Number(day.date.slice(8))+'日、'+(day.count?day.count+'件の優待の購入締切':'確認済みの予定なし'));button.setAttribute('aria-pressed',String(selected===day.date));
      if(day.date===today)button.setAttribute('aria-current','date');dateButtons.set(day.date,button);grid.appendChild(button);
    });
    const rows=sortRows(events.filter(row=>!selected||row.date===selected));
    list.dataset.selectedDay=String(!!selected);clear.hidden=!selected;
    head.textContent=selected?agendaLabel(selected):'この月の優待の購入締切';
    drawList(list,rows,limit);more.hidden=rows.length<=limit;
    if(!rows.length)list.appendChild(el('p','dc-empty','この月・日付の掲載日程はありません。優待がないという意味ではありません。'));
    const unknown=sortRows(programmes.map(company=>nextRow(company,today)).filter(row=>!row.date));
    pending.hidden=!unknown.length;pendingHeading.textContent='制度を掲載済み・次回の日程は未確認 '+unknown.length+'社';
    drawList(pendingBody,unknown,pendingLimit);pendingMore.hidden=unknown.length<=pendingLimit;
  }
  if(doc.addEventListener)doc.addEventListener('visibilitychange',()=>{if(!doc.hidden)render();});
  if(w.addEventListener)w.addEventListener('kn:watchlist-change',render);
  render();return {render};
}
return {programmes,rowsForMonth,create};
});

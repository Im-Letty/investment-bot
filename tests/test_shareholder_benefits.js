const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const calendar=require('../static/dividend-calendar.js');
const dates=require('../static/date-display.js');
const script=fs.readFileSync(path.join(__dirname,'../static/shareholder-benefits.js'),'utf8');
function schedule(date,extra={}){return {date,record:date.slice(0,7)+'-30',holdUntil:date.replaceAll('-','/')+'の取引終了まで',holdExplanation:'今回の期限まで保有してください。',grant:'会社の案内で確認',delivery:'申込期限を確認してください。',status:'planned',basis:'現行制度に基づく予定',source:'https://example.com/dates',verified:'2026-09-24',...extra};}
function company(code,changes={}){return {code,name:'会社'+code,reward:'優待券',shares:'100株以上',holding:'長期保有の条件なし',period:'9月末',conditions:'必要株数を保有',use:'対象店舗で利用',url:'https://example.com/ir/'+code,verified:'2026-09-24',schedules:[schedule('2026-09-28')],...changes};}
function load(data){const context={module:{exports:{}},require(name){if(name==='./date-display.js')return dates;assert.equal(name,'./shareholder-benefits-data.js');return data;}};vm.runInNewContext(script,context);return context.module.exports;}
class Element{
 constructor(tag,doc){this.tagName=tag;this.doc=doc;this.children=[];this.dataset={};this.attrs={};this.listeners={};this.className='';this.hidden=false;this.open=false;this.disabled=false;this._text='';}
 get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}set textContent(value){this._text=String(value);this.children=[];}
 appendChild(node){this.children.push(node);return node;}replaceChildren(...nodes){this.children=[];nodes.forEach(node=>this.appendChild(node));}
 setAttribute(name,value){this.attrs[name]=String(value);}getAttribute(name){return this.attrs[name]??null;}
 addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}dispatch(type){for(const fn of this.listeners[type]||[])fn({target:this});}
 all(){return [this,...this.children.flatMap(node=>node.all())];}find(cls){return this.all().find(node=>node.className.split(' ').includes(cls));}focus(){this.doc.activeElement=this;}
}
function harness(data,options={}){
 let current=options.today||'2026-09-24';const events={},saved=new Map([['alert_watchlist_v1',JSON.stringify(options.favorites||[])]]);
 const doc={hidden:false,createElement(tag){return new Element(tag,this);},addEventListener(type,fn){events[type]=fn;}};
 const mount=doc.createElement('div'),w={document:doc,localStorage:{getItem:key=>saved.get(key)},addEventListener(type,fn){events[type]=fn;}};
 const cal={today:()=>current,shift:calendar.shift,bounds:()=>calendar.bounds(Date.parse(current+'T03:00:00Z')),calendarDays:calendar.calendarDays};
 const api=load(data),view=api.create(w,mount,cal);
 return {api,view,mount,doc,events,setToday(value){current=value;},cards(){return mount.find('bc-list').children.filter(node=>node.className.split(' ').includes('bc-card'));}};
}
test('a company can have multiple explicit dates without generating unreviewed years or duplicates',()=>{
 const data=[company('1000',{schedules:[schedule('2026-09-28'),schedule('2027-03-29',{record:'2027-03-31'}),schedule('2026-09-28'),schedule('2027-02-30')]}),company('2000')];
 const api=load(data);
 assert.equal(api.rowsForMonth('2026-09').length,2);assert.equal(api.rowsForMonth('2027-03').length,1);
 assert.equal(api.rowsForMonth('2027-03')[0].record,'2027-03-31');assert.equal(api.rowsForMonth('2027-03')[0].name,'会社1000');
 assert.equal(api.rowsForMonth('2027-09').length,0);assert.equal(api.rowsForMonth('2027-02').length,0);
});
test('monthly counts include all matching dates while lists paginate and prioritize saved favorites',()=>{
 const data=Array.from({length:7},(_,i)=>company(String(1000+i)));data[0].schedules.push(schedule('2026-09-29'));
 const h=harness(data,{favorites:['1006.T']});
 assert.equal(h.mount.find('dc-status'),undefined);assert.equal(h.cards().length,5);
 assert.match(h.mount.children.at(-1).textContent,/空欄は、優待がないという意味ではありません/);
 assert.match(h.cards()[0].textContent,/会社1006/);assert.equal(h.mount.find('bc-more').hidden,false);
 const day=h.mount.find('dc-grid').children.find(node=>node.dataset.date==='2026-09-28');assert.equal(day.find('dc-day-count').textContent,'7');
 const today=h.mount.find('dc-grid').children.find(node=>node.dataset.date==='2026-09-24');assert.equal(today.getAttribute('aria-current'),'date');
 h.cards()[0].open=true;h.mount.find('bc-more').dispatch('click');assert.equal(h.cards().length,8);assert.equal(h.cards()[0].open,true);assert.equal(h.mount.find('bc-more').hidden,true);
 day.dispatch('click');assert.equal(h.cards().length,5);assert.equal(h.doc.activeElement.dataset.date,'2026-09-28');assert.equal(h.doc.activeElement.getAttribute('aria-pressed'),'true');
 h.doc.activeElement.dispatch('click');assert.equal(h.mount.find('bc-heading').textContent,'この月の優待の購入締切');
});
test('benefit calendar navigates to later schedules without internal company search or other-month dots',()=>{
 const h=harness([company('3088',{name:'マツキヨココカラ＆カンパニー'}),company('3563',{name:'FOOD & LIFE COMPANIES',aliases:'スシロー 京樽',schedules:[schedule('2027-03-29',{record:'2027-03-31'})]})]);
 assert.equal(h.mount.find('dc-search'),undefined);assert.equal(h.mount.find('dc-manage'),undefined);
 assert.equal(h.cards().length,1);assert.match(h.cards()[0].textContent,/3088/);assert.doesNotMatch(h.mount.find('bc-list').textContent,/3563/);
 const next=h.mount.find('dc-month-navigation').children[2];next.dispatch('click');assert.equal(h.cards().length,0);assert.equal(h.mount.find('dc-grid').find('dc-day-count'),undefined);
 for(let i=0;i<5;i++)next.dispatch('click');assert.equal(h.mount.find('dc-month').textContent,'2027年3月');assert.equal(h.cards().length,1);assert.match(h.cards()[0].textContent,/3563/);assert.match(h.cards()[0].textContent,/2027\/03\/29/);
 assert.equal(h.mount.find('dc-grid').children.find(node=>node.dataset.date==='2027-03-29').find('dc-day-count').textContent,'1');
 h.mount.find('bc-today').dispatch('click');assert.match(h.cards()[0].textContent,/3088/);
});
test('undated and expired programmes remain discoverable without fabricated next dates or calendar counts',()=>{
 const data=[company('1000',{schedules:[schedule('2026-08-28')]}),company('2000',{name:'KDDI',schedules:[],holding:'1年以上の継続保有'})];
 const h=harness(data),pending=h.mount.find('bc-pending');
 assert.equal(pending.hidden,false);assert.equal(pending.open,true);assert.match(pending.textContent,/未確認 2社/);assert.match(pending.textContent,/前回掲載した締切：2026\/08\/28/);
 assert.equal(h.mount.find('dc-grid').find('dc-day-count'),undefined);assert.equal(h.cards().length,0);
 assert.match(pending.textContent,/KDDI/);assert.match(pending.textContent,/次回の保有締切は確認中/);assert.match(pending.textContent,/1年以上の継続保有/);
});
test('pending companies paginate independently and planned schedules retain their own period and source',()=>{
 const pending=harness(Array.from({length:7},(_,i)=>company(String(1000+i),{schedules:[]})));
 assert.equal(pending.mount.find('bc-pending-body').children.length,5);pending.mount.find('bc-pending-more').dispatch('click');assert.equal(pending.mount.find('bc-pending-body').children.length,7);
 const h=harness([company('1000',{period:'9月末（年1回）'})]),card=h.cards()[0];
 assert.match(card.textContent,/年1回/);assert.doesNotMatch(card.textContent,/年2回/);assert.match(card.find('bc-date').textContent,/（予定）/);
 assert.equal(card.find('bc-basis').textContent,'現行制度に基づく予定');assert.equal(card.find('dc-help-source').href,'https://example.com/ir/1000');assert.equal(card.find('bc-date-source').href,'https://example.com/dates');
 const verified=card.find('bc-verified');assert.equal(verified.textContent,'2026/09/24 確認');
 assert.ok(card.children.indexOf(verified)<card.children.indexOf(card.find('dc-help-source')));
 assert.ok(card.children.indexOf(verified)<card.children.indexOf(card.find('bc-date-source')));
 assert.doesNotMatch(verified.textContent,/\d{2}:\d{2}/);
});
test('month navigation clamps to bounds and refreshes the current month after a date rollover',()=>{
 const h=harness([company('1000')]),nav=h.mount.find('dc-month-navigation');
 assert.equal(nav.children[0].disabled,true);nav.children[0].dispatch('click');assert.equal(h.mount.find('dc-month').textContent,'2026年9月');
 for(let i=0;i<14;i++)nav.children[2].dispatch('click');assert.equal(h.mount.find('dc-month').textContent,'2027年9月');assert.equal(nav.children[2].disabled,true);
 h.mount.find('bc-today').dispatch('click');assert.equal(h.mount.find('dc-month').textContent,'2026年9月');
 h.setToday('2027-01-01');h.view.render();assert.equal(h.mount.find('dc-month').textContent,'2027年1月');assert.equal(h.cards().length,0);assert.match(h.mount.find('bc-pending').textContent,/会社1000/);
 assert.equal(h.mount.find('dc-grid').children.find(node=>node.dataset.date==='2027-01-01').getAttribute('aria-current'),'date');
});
test('benefit summaries share dividend date, company-code, disclosure and plain pagination structure',()=>{
 const h=harness(Array.from({length:7},(_,i)=>company(String(1000+i))),{favorites:['1006.T']});
 const card=h.cards()[0];
 assert.ok(card.className.split(' ').includes('dc-disclosure'));
 assert.ok(card.find('bc-summary').className.split(' ').includes('dc-event-summary'));
 assert.equal(card.find('dc-company').textContent,'会社1006');assert.equal(card.find('dc-company-code').textContent,'1006');
 assert.equal(card.find('dc-event-date').textContent,'9/28');assert.equal(card.find('dc-favorite').hidden,false);
 assert.equal(h.cards()[1].find('dc-favorite').hidden,true);
 assert.equal(h.mount.find('bc-more').textContent,'もっと見る');
 h.mount.find('dc-grid').children.find(node=>node.dataset.date==='2026-09-28').dispatch('click');
 assert.equal(h.mount.find('bc-heading').textContent,'9/28 月曜日の予定');assert.equal(h.mount.find('bc-list').dataset.selectedDay,'true');
 assert.equal(h.mount.find('dc-reset').hidden,false);h.mount.find('dc-reset').dispatch('click');
 assert.equal(h.mount.find('bc-list').dataset.selectedDay,'false');assert.equal(h.mount.find('dc-reset').hidden,true);
 assert.equal(h.mount.find('bc-heading').textContent,'この月の優待の購入締切');
});
test('matching dividend typography keeps long-term benefit conditions and unknown timing explicit',()=>{
 const h=harness(Array.from({length:7},(_,i)=>company(String(1000+i),{schedules:[],holding:'1年以上の継続保有',conditions:'200株以上を1年以上保有'})));
 const card=h.mount.find('bc-pending-body').children[0];
 assert.equal(card.find('dc-event-date').textContent,'未確認');assert.match(card.find('bc-tags').textContent,/1年以上の継続保有/);
 assert.match(card.find('bc-detail').textContent,/200株以上を1年以上保有/);
 assert.match(card.find('bc-date').textContent,/次回の保有締切は確認中/);
 assert.equal(h.mount.find('bc-pending-more').textContent,'もっと見る');
 assert.equal(card.find('bc-verified').textContent,'2026/09/24 確認');
});

// Synthetic integration cases, never production catalogue facts.
test('expired generated programmes stay pending with no old current-reward claim',()=>{
 const h=harness([company('130A',{reward:'旧制度9999円分',programmeStatus:'active',programmeEffectiveFrom:'2026-09-01',programmeEffectiveUntil:'2026-09-23'})]);
 assert.equal(h.cards().length,0);const pending=h.mount.find('bc-pending-body');assert.match(pending.textContent,/現在の優待内容は未確認/);assert.doesNotMatch(pending.textContent,/旧制度9999円分/);assert.equal(h.mount.find('dc-grid').find('dc-day-count'),undefined);
});
test('generated programme verification and schedule verification stay distinct',()=>{
 const h=harness([company('130A',{programmeStatus:'active',programmeEffectiveFrom:null,programmeEffectiveUntil:null,programmeVerified:'2026-09-22',verified:'2026-09-22',schedules:[schedule('2026-09-28',{verified:'2026-09-24'})]})]);
 const row=h.cards()[0];assert.equal(row.find('bc-verified').textContent,'2026/09/22 確認');assert.equal(row.find('bc-schedule-verified').textContent,'2026/09/24 購入締切日程の確認');assert.ok(row.children.indexOf(row.find('bc-schedule-verified'))<row.children.indexOf(row.find('bc-date-source')));
});
test('regional JP favorites receive the same existing benefit priority and badge',()=>{
 const h=harness([company('130A'),company('131A')],{favorites:['131A.JP']});assert.match(h.cards()[0].textContent,/会社131A/);assert.equal(h.cards()[0].find('dc-favorite').hidden,false);
});

test('coverage is a single bottom paragraph before the existing final caution and counts full catalogue',()=>{
 const h=harness(Array.from({length:7},(_,i)=>company(String(1000+i))));const notice=h.mount.find('bc-coverage');assert.equal(notice.textContent,'優待制度を7社掲載。公式情報を確認して順次追加しています。全社の確認は継続中です。会社ごとに確認日が異なります。');assert.equal(h.cards().length,5);assert.equal(h.mount.children.at(-2),notice);assert.match(h.mount.children.at(-1).textContent,/空欄は、優待がないという意味ではありません/);assert.equal(h.mount.find('dc-search'),undefined);
});

test('unknown purchase deadline keeps a separately confirmed grant summary',()=>{
 const h=harness([company('130A',{schedules:[],grant:'2027年3月6日お届け予定'})]);
 const pending=h.mount.find('bc-pending'),card=h.mount.find('bc-pending-body').children[0];
 assert.match(pending.textContent,/購入締切日は未確認 1社/);
 assert.match(card.find('bc-summary').textContent,/いつもらえる？ 2027年3月6日お届け予定/);
 assert.match(card.find('bc-summary').textContent,/次回の保有締切は確認中/);
 assert.equal(h.mount.find('dc-grid').find('dc-day-count'),undefined);
});
test('unconfirmed grant timing links to details without declaring a known date unknown',()=>{
 const h=harness([company('130A',{schedules:[],delivery:'発送時期は会社の案内を確認'})]);
 const card=h.mount.find('bc-pending-body').children[0];
 assert.match(card.find('bc-summary').textContent,/いつもらえる？ 発送・付与の案内は詳細を確認/);
 assert.doesNotMatch(card.find('bc-summary').textContent,/次回の付与時期は確認中/);
});
test('expired generated programme does not retain its old grant date as current',()=>{
 const h=harness([company('130A',{schedules:[],grant:'旧制度の2027年3月6日お届け予定',programmeStatus:'active',programmeEffectiveFrom:'2026-09-01',programmeEffectiveUntil:'2026-09-23'})]);
 const card=h.mount.find('bc-pending-body').children[0];
 assert.match(card.find('bc-summary').textContent,/次回の付与時期は確認中/);
 assert.doesNotMatch(card.textContent,/2027年3月6日/);
});

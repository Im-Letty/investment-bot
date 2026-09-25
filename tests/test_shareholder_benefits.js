const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const calendar=require('../static/dividend-calendar.js');
const script=fs.readFileSync(path.join(__dirname,'../static/shareholder-benefits.js'),'utf8');
function schedule(date,extra={}){return {date,record:date.slice(0,7)+'-30',holdUntil:date.replaceAll('-','/')+'の取引終了まで',holdExplanation:'今回の期限まで保有してください。',grant:'会社の案内で確認',delivery:'申込期限を確認してください。',status:'planned',basis:'現行制度に基づく予定',source:'https://example.com/dates',verified:'2026-09-24',...extra};}
function company(code,changes={}){return {code,name:'会社'+code,reward:'優待券',shares:'100株以上',holding:'長期保有の条件なし',period:'9月末',conditions:'必要株数を保有',use:'対象店舗で利用',url:'https://example.com/ir/'+code,verified:'2026-09-24',schedules:[schedule('2026-09-28')],...changes};}
function load(data){const context={module:{exports:{}},require(name){assert.equal(name,'./shareholder-benefits-data.js');return data;}};vm.runInNewContext(script,context);return context.module.exports;}
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
 return {api,view,mount,doc,events,setToday(value){current=value;},search(value){const input=mount.find('dc-search');input.value=value;input.dispatch('input');},cards(){return mount.find('bc-list').children.filter(node=>node.className==='bc-card');}};
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
 assert.match(h.mount.find('dc-status').textContent,/7社を掲載.*7社・8件/);assert.equal(h.cards().length,5);
 assert.match(h.cards()[0].textContent,/会社1006/);assert.equal(h.mount.find('bc-more').hidden,false);
 const day=h.mount.find('dc-grid').children.find(node=>node.dataset.date==='2026-09-28');assert.equal(day.find('dc-day-count').textContent,'7件');
 const today=h.mount.find('dc-grid').children.find(node=>node.dataset.date==='2026-09-24');assert.equal(today.getAttribute('aria-current'),'date');
 h.cards()[0].open=true;h.mount.find('bc-more').dispatch('click');assert.equal(h.cards().length,8);assert.equal(h.cards()[0].open,true);assert.equal(h.mount.find('bc-more').hidden,true);
 day.dispatch('click');assert.equal(h.cards().length,5);assert.equal(h.doc.activeElement.dataset.date,'2026-09-28');assert.equal(h.doc.activeElement.getAttribute('aria-pressed'),'true');
 h.doc.activeElement.dispatch('click');assert.equal(h.mount.find('bc-heading').textContent,'この月の優待の購入締切');
});
test('search normalizes names, fullwidth codes and kana aliases across months without adding other-month dots',()=>{
 const h=harness([company('3088',{name:'マツキヨココカラ＆カンパニー'}),company('3563',{name:'FOOD & LIFE COMPANIES',aliases:'スシロー 京樽',schedules:[schedule('2027-03-29',{record:'2027-03-31'})]})]);
 h.search('ココカラ＆');assert.equal(h.cards().length,1);assert.match(h.cards()[0].textContent,/3088/);
 h.search('３５６３');assert.equal(h.cards().length,1);assert.match(h.cards()[0].textContent,/2027\/03\/29/);assert.equal(h.mount.find('dc-grid').find('dc-day-count'),undefined);
 assert.equal(h.mount.find('dc-layout').dataset.searching,'true');assert.match(h.mount.find('dc-status').textContent,/掲載2社.*検索結果は1社.*表示中の月.*0社・0件/);
 h.search('すしろー');assert.equal(h.cards().length,1);assert.match(h.mount.find('bc-heading').textContent,/検索結果 1社/);
 h.mount.find('bc-jump').dispatch('click');assert.equal(h.mount.find('dc-month').textContent,'2027年 03月');assert.match(h.cards()[0].textContent,/2027\/03\/29/);
 h.search('未掲載の会社');assert.equal(h.cards().length,0);assert.match(h.mount.find('dc-empty').textContent,/未掲載の会社にも優待/);
});
test('undated and expired programmes remain discoverable without fabricated next dates or calendar counts',()=>{
 const data=[company('1000',{schedules:[schedule('2026-08-28')]}),company('2000',{name:'KDDI',schedules:[],holding:'1年以上の継続保有'})];
 const h=harness(data),pending=h.mount.find('bc-pending');
 assert.equal(pending.hidden,false);assert.equal(pending.open,true);assert.match(pending.textContent,/未確認 2社/);assert.match(pending.textContent,/前回掲載した締切：2026\/08\/28/);
 assert.equal(h.mount.find('dc-grid').find('dc-day-count'),undefined);assert.equal(h.cards().length,0);
 h.search('kddi');assert.equal(h.cards().length,1);assert.match(h.cards()[0].textContent,/次回の保有締切は確認中/);assert.equal(pending.hidden,true);
 h.search('');assert.equal(pending.hidden,false);
});
test('pending companies paginate independently and planned schedules retain their own period and source',()=>{
 const pending=harness(Array.from({length:7},(_,i)=>company(String(1000+i),{schedules:[]})));
 assert.equal(pending.mount.find('bc-pending-body').children.length,5);pending.mount.find('bc-pending-more').dispatch('click');assert.equal(pending.mount.find('bc-pending-body').children.length,7);
 const h=harness([company('1000',{period:'9月末（年1回）'})]),card=h.cards()[0];
 assert.match(card.textContent,/年1回/);assert.doesNotMatch(card.textContent,/年2回/);assert.match(card.find('bc-date').textContent,/（予定）/);
 assert.equal(card.find('bc-basis').textContent,'現行制度に基づく予定');assert.equal(card.find('dc-help-source').href,'https://example.com/ir/1000');assert.equal(card.find('bc-date-source').href,'https://example.com/dates');
});
test('month navigation clamps to bounds and refreshes the current month after a date rollover',()=>{
 const h=harness([company('1000')]),nav=h.mount.find('dc-month-navigation');
 assert.equal(nav.children[0].disabled,true);nav.children[0].dispatch('click');assert.equal(h.mount.find('dc-month').textContent,'2026年 09月');
 for(let i=0;i<14;i++)nav.children[2].dispatch('click');assert.equal(h.mount.find('dc-month').textContent,'2027年 09月');assert.equal(nav.children[2].disabled,true);
 h.mount.find('bc-today').dispatch('click');assert.equal(h.mount.find('dc-month').textContent,'2026年 09月');
 h.setToday('2027-01-01');h.view.render();assert.equal(h.mount.find('dc-month').textContent,'2027年 01月');assert.equal(h.cards().length,0);assert.match(h.mount.find('bc-pending').textContent,/会社1000/);
 assert.equal(h.mount.find('dc-grid').children.find(node=>node.dataset.date==='2027-01-01').getAttribute('aria-current'),'date');
});

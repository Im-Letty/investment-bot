'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'kakeibo.html'),'utf8');
const source=fs.readFileSync(path.join(root,'static/kakeibo-calendar-designs.js'),'utf8');
const KEY='knKakeiboCalendarDesignV1',ids=['planner','modern','pop'];
const rawMonth='  [{"id":1,"type":"inc","amount":12345.67,"date":"2026-10-27","name":"架空の給与"}]\n';
const rawDay='[{"id":1,"type":"exp","amount":-12.5,"name":"架空の旧日別","extra":{"keep":true}}]';
function attributes(markup){const values=new Map();for(const match of markup.matchAll(/([-\w]+)="([^"]*)"/g))values.set(match[1],match[2]);return values;}
function fixture({stored={},missing='',readDenied=false,writeDenied=false,storageDenied=false}={}){
 const values=new Map([['kb2_2026_10',rawMonth],['kbday_2026_10_27',rawDay],['kb2_assets','[{"name":"架空","amount":100.25}]'],...Object.entries(stored)]);
 const reads=[],writes=[],attributesWritten=[],events=new Map(),documentEvents=new Map(),queries=[];
 function node(tag,attrs,text=''){const a=attributes(attrs||'');return {tagName:tag.toUpperCase(),textContent:text,disabled:false,listeners:new Map(),getAttribute:n=>a.get(n)??null,setAttribute(n,v){a.set(n,String(v));attributesWritten.push({node:this,name:n,value:String(v)});},addEventListener(n,fn){const list=this.listeners.get(n)||[];list.push(fn);this.listeners.set(n,list);},emit(n,event={}){for(const fn of this.listeners.get(n)||[])fn(event);}};}
 const match=html.match(/<div class="tab-content" id="tab-calendar"[^>]*>/);assert.ok(match);
 const section=node('div',match[0]);
 const fragment=html.slice(html.indexOf(match[0]),html.indexOf('<div class="modal-overlay" id="dayModal"'));
 const groupMatch=fragment.match(/<div([^>]*class="kk-calendar-designs"[^>]*)>/);assert.ok(groupMatch);const group=node('div',groupMatch[1]);
 const captionMatch=fragment.match(/<span([^>]*id="kkCalendarDesignLabel"[^>]*)>([^<]*)<\/span>/);assert.ok(captionMatch);
 const caption=node('span',captionMatch[1],captionMatch[2]),buttons=[];
 for(const m of fragment.matchAll(/<button([^>]*data-kk-calendar-design="[^"]+"[^>]*)>([^<]*)<\/button>/g))buttons.push(node('button',m[1],m[2]));
 const visible=missing==='buttons'?[]:buttons;
 section.querySelector=s=>{queries.push(s);return missing==='group'?null:s==='.kk-calendar-designs'?group:null;};
 group.querySelectorAll=s=>{queries.push(s);return s==='button[data-kk-calendar-design]'?visible:[];};
 const draft={id:'m-exp-amount',value:'１２，３４５．６７',selectionStart:2,selectionEnd:7},nameDraft={id:'m-exp-name',value:'入力途中の架空メモ'};
 const dateDraft={id:'kkEntryDate',value:'2026-10-27'},modal={id:'dayModal',open:true};
 const document={readyState:'loading',activeElement:draft,documentElement:node('html','lang="ja"'),getElementById(id){if(id==='tab-calendar')return missing==='section'?null:section;if(id==='kkCalendarDesignLabel')return caption;if(id==='m-exp-amount')return draft;if(id==='m-exp-name')return nameDraft;if(id==='kkEntryDate')return dateDraft;if(id==='dayModal')return modal;return null;},querySelectorAll(s){if(s==='[data-i18n]')return[caption,...buttons];if(s==='[data-i18n-placeholder]')return[];return[];},addEventListener(n,fn){documentEvents.set(n,fn);}};
 const storage={get length(){throw Error('calendar appearance must not enumerate storage');},key(){throw Error('calendar appearance must not enumerate storage');},getItem(key){reads.push(key);if(readDenied)throw Error('synthetic denied read');return values.get(key)??null;},setItem(key,value){if(writeDenied)throw Error('synthetic denied write');writes.push({key,value:String(value)});values.set(key,String(value));},removeItem(){throw Error('calendar appearance must not remove records');}};
 function forbidden(){throw Error('appearance must not call ledger, render, navigation or network functions');}
 const context={document,_year:2026,_month:10,_calYear:2026,_calMonth:10,_modalDate:{y:2026,m:10,day:27},_modalForm:'exp',renderAll:forbidden,renderCalendar:forbidden,changeMonth:forbidden,calChangeMonth:forbidden,saveData:forbidden,saveDayData:forbidden,fetch:forbidden,location:{assign:forbidden},addEventListener(n,fn){const list=events.get(n)||[];list.push(fn);events.set(n,list);}};
 Object.defineProperty(context,'localStorage',{get(){if(storageDenied)throw Error('synthetic unavailable storage');return storage;}});
 context.window=context;vm.runInNewContext(source,context);
 const event=(name,payload)=>{for(const fn of events.get(name)||[])fn(payload);};
 const choose=id=>buttons.find(b=>b.getAttribute('data-kk-calendar-design')===id).emit('click');
 function protectedState(){return {financial:[...values].filter(([k])=>k!==KEY&&k!=='kk_lang'&&k!=='siteLang'),draft,nameDraft,dateDraft,modal,draftValues:{amount:draft.value,name:nameDraft.value,date:dateDraft.value,modalOpen:modal.open},active:document.activeElement,selection:[draft.selectionStart,draft.selectionEnd],year:context._year,month:context._month,calYear:context._calYear,calMonth:context._calMonth,modalDate:JSON.stringify(context._modalDate),modalForm:context._modalForm};}
 return {context,document,section,group,caption,buttons,values,reads,writes,attributesWritten,queries,events,event,choose,storage,protectedState};
}
function selected(h,id){assert.equal(h.section.getAttribute('data-calendar-design'),id);for(const b of h.buttons)assert.equal(b.getAttribute('aria-pressed'),String(b.getAttribute('data-kk-calendar-design')===id));}
test('real calendar markup exposes three native non-submit buttons and a translated group label',()=>{
 const h=fixture();assert.equal(h.buttons.length,3);assert.deepEqual(h.buttons.map(b=>b.getAttribute('data-kk-calendar-design')),ids);
 for(const b of h.buttons){assert.equal(b.tagName,'BUTTON');assert.equal(b.getAttribute('type'),'button');assert.equal(b.getAttribute('onclick'),null);assert.equal(b.getAttribute('tabindex'),null);assert.deepEqual([...b.listeners.keys()],['click']);}
 assert.equal(h.group.getAttribute('role'),'group');assert.equal(h.group.getAttribute('aria-labelledby'),h.caption.getAttribute('id'));assert.match(html,/class="card kk-calendar-sheet"/);
 assert.match(html,/kakeibo-calendar-designs\.css\?v=20261027-calendar-designs1/);assert.match(html,/kakeibo-calendar-designs\.js\?v=20261027-calendar-designs1/);
});
test('initial default and every saved design restore without writing or reading ledger keys',()=>{
 for(const value of [undefined,...ids]){const h=fixture({stored:value===undefined?{}:{[KEY]:value}});selected(h,value||'planner');assert.deepEqual(h.reads,[KEY]);assert.deepEqual(h.writes,[]);}
});
test('unknown, empty and malformed saved values safely use the planner without rewriting storage',()=>{
 for(const value of ['', 'unknown','__proto__','{"design":"pop"}','<script>']){const h=fixture({stored:{[KEY]:value}});selected(h,'planner');assert.equal(h.values.get(KEY),value);assert.deepEqual(h.writes,[]);}
});
test('each explicit choice writes one appearance key and restores the same choice on reopening',()=>{
 const h=fixture();for(const id of ids){const before=h.writes.length;h.choose(id);selected(h,id);assert.deepEqual(h.writes.slice(before),[{key:KEY,value:id}]);const reopened=fixture({stored:Object.fromEntries(h.values)});selected(reopened,id);assert.deepEqual(reopened.writes,[]);}
});
test('unavailable or denied preference storage never prevents in-memory choices',()=>{
 for(const settings of [{readDenied:true},{writeDenied:true},{storageDenied:true}]){const h=fixture(settings);selected(h,'planner');h.choose('pop');selected(h,'pop');assert.equal(h.values.get('kb2_2026_10'),rawMonth);assert.equal(h.values.get('kbday_2026_10_27'),rawDay);}
});
test('appearance switching preserves financial bytes, actual draft nodes, month and open day state',()=>{
 const h=fixture(),before=h.protectedState();for(const id of ['modern','pop','planner','pop']){h.choose(id);selected(h,id);assert.deepEqual(h.protectedState(),before);assert.equal(h.document.getElementById('m-exp-amount'),before.draft);assert.equal(h.document.getElementById('dayModal'),before.modal);}
 assert.ok(h.writes.every(x=>x.key===KEY));assert.deepEqual(h.reads,[KEY]);assert.equal(h.document.activeElement,before.active);
});
test('only the same local preference storage event updates appearance and it never writes back',()=>{
 const h=fixture();h.choose('modern');const writes=h.writes.length,attributes=h.attributesWritten.length;
 for(const event of [{key:'kb2_2026_10',newValue:'pop',storageArea:h.storage},{key:'ui_font',newValue:'pop',storageArea:h.storage},{key:null,newValue:null,storageArea:h.storage},{key:KEY,newValue:'pop',storageArea:{}}])h.event('storage',event);
 selected(h,'modern');assert.equal(h.attributesWritten.length,attributes);
 h.event('storage',{key:KEY,newValue:'pop',storageArea:h.storage});selected(h,'pop');h.event('storage',{key:KEY,newValue:'invalid',storageArea:h.storage});selected(h,'planner');h.event('storage',{key:KEY,newValue:null,storageArea:h.storage});selected(h,'planner');assert.equal(h.writes.length,writes);
});
test('missing section, group or buttons is a quiet no-op without storage access',()=>{
 for(const missing of ['section','group','buttons']){const h=fixture({missing});assert.deepEqual(h.reads,[]);assert.deepEqual(h.writes,[]);assert.equal(h.events.size,0);assert.equal(h.attributesWritten.length,0);}
});
test('disabled buttons and a changed invalid design cannot write or replace the last valid selection',()=>{
 const h=fixture();h.choose('modern');const writes=h.writes.length,button=h.buttons.find(b=>b.getAttribute('data-kk-calendar-design')==='pop');button.disabled=true;button.emit('click');selected(h,'modern');button.disabled=false;button.setAttribute('data-kk-calendar-design','unrecognized');button.emit('click');assert.equal(h.section.getAttribute('data-calendar-design'),'modern');assert.equal(h.writes.length,writes);
});
test('the existing four-language renderer updates design names and accessible group caption while keeping the selected design',()=>{
 const h=fixture();h.choose('modern');const protectedBefore=h.protectedState(),buttonNodes=[...h.buttons],caption=h.caption;
 const begin=html.indexOf('var KK_I18N = {'),end=html.indexOf('\nvar _year=',begin);assert.ok(begin>=0&&end>begin);vm.runInNewContext(html.slice(begin,end),h.context);
 const expected={ja:['カレンダーのデザイン','手帳風','モダン','レトロポップ'],en:['Calendar design','Planner','Modern','Retro pop'],ko:['달력 디자인','다이어리','모던','레트로 팝'],zh:['日历样式','手账风','现代','复古波普']};
 for(const [lang,text] of Object.entries(expected)){h.context.kkApplyLang(lang);assert.equal(h.caption,caption);assert.deepEqual(h.buttons,buttonNodes);assert.deepEqual([h.caption.textContent,...h.buttons.map(b=>b.textContent)],text);selected(h,'modern');assert.deepEqual(h.protectedState(),protectedBefore);}
 assert.deepEqual(h.writes.filter(x=>x.key===KEY),[{key:KEY,value:'modern'}]);
});

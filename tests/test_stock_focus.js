'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const stock=require('../static/stock-focus.js');
const now=Date.parse('2026-09-23T09:00:00Z');
const item=(symbol,n=0)=>({symbol,name:'企業 '+symbol,price:110+n,prev:100,currency:'JPY',trade_date:'2026-09-18',fetched_at:now/1000});
const payload=items=>stock.normalizePayload({updated_at:now/1000,items,scope:'selected_jp',total_scanned:items.length},now);
test('ranking sorts independently, caps at20 and initially displays only5',()=>{
 const data=payload(Array.from({length:25},(_,i)=>item((1000+i)+'.T',i)).concat(Array.from({length:25},(_,i)=>({...item((2000+i)+'.T'),price:90-i}))));
 for(const direction of ['up','down']){const list=stock.ranked(data,direction);assert.equal(list.length,20);assert.equal(list[0].symbol,(direction==='up'?'1024':'2024')+'.T');}
 const html=stock.rankingMarkup(data);
 assert.equal((html.match(/class="sf-row"/g)||[]).length,40);
 assert.equal((html.match(/<ol class="sf-rows">/g)||[]).length,2);
 for(const initial of html.matchAll(/<ol class="sf-rows">(.*?)<\/ol>/g))assert.equal((initial[1].match(/class="sf-row"/g)||[]).length,5);
 assert.equal((html.match(/start="6"/g)||[]).length,2);assert.equal((html.match(/残り15社/g)||[]).length,2);
});
test('fewer than6 companies have no empty more button; no eligible stocks is different from fetch failure',()=>{
 const html=stock.rankingMarkup(payload([item('7203.T')]));assert.doesNotMatch(html,/sf-more/);assert.match(html,/条件に当てはまる銘柄はありません/);
 const error=stock.rankingMarkup(null,'up','error');assert.match(error,/再読み込み/);assert.doesNotMatch(error,/条件に当てはまる銘柄はありません/);
});
test('uses price minus previous close, not rounded source pct, with both amount and percentage',()=>{
 const html=stock.quote({...item('7203.T'),price:1001.5,prev:1000,pct:99});assert.match(html,/\+1.5円/);assert.match(html,/\+0.15%/);assert.match(html,/2026\/09\/18 の株価/);assert.doesNotMatch(html,/99%/);
 const us=stock.quote({...item('AAPL'),currency:'USD',price:99.5});assert.match(us,/−0.5米ドル/);assert.match(us,/−0.50%/);
 assert.match(stock.quote({...item('7203.T'),price:100}),/sf-flat/);
});
test('invalid or missing amounts are never rendered as zero',()=>{
 for(const value of [undefined,null,NaN,Infinity,0,-1,'100']){assert.equal(stock.normalizeItem({...item('7203.T'),price:value}),null);assert.doesNotMatch(stock.quote({...item('7203.T'),price:value}),/sf-price/);}
});
test('common quote dates are grouped by market, while mixed dates remain on each row',()=>{
 const jp=item('7203.T'),us={...item('AAPL'),currency:'USD',trade_date:'2026-09-21'};
 const grouped=stock.tradeDates([jp,us]);assert.equal(grouped.text,'株価 日本 2026/09/18 / 米国 2026/09/21');assert.equal(grouped.showDate(jp),false);assert.equal(grouped.showDate(us),false);
 const older={...item('9432.T'),trade_date:'2026-09-17'};
 const html=stock.rankingMarkup(payload([jp,older,us]));assert.match(html,/2026\/09\/18 の株価/);assert.match(html,/2026\/09\/17 の株価/);assert.match(html,/米国 2026\/09\/21/);assert.doesNotMatch(html,/2026\/09\/21 の株価/);
});
test('favorite quotes preserve currency and absolute changes without inventing missing changes',()=>{
 const format=require('../static/market-data.js').formatChange;
 const jp=stock.watchRow({name:'<会社>',price:1001.5,currency:'JPY',change_value:1.5,pct:.15},'7203.T',format);assert.match(jp,/&lt;会社&gt;/);assert.match(jp,/\+1\.50円/);assert.match(jp,/\+0\.15%/);
 const us=stock.watchRow({price:99.5,currency:'USD',change_value:-.5,pct:-.5},'AAPL',format);assert.match(us,/−0\.50米ドル/);assert.match(us,/sf-down/);
 const missing=stock.watchRow({price:100,currency:'JPY',change_value:null,pct:null},'7203.T',format);assert.match(missing,/sf-price/);assert.doesNotMatch(missing,/sf-change|0\.00%/);
 for(const price of [null,NaN,Infinity,0])assert.doesNotMatch(stock.watchRow({price},'7203.T',format),/sf-price/);
 assert.match(stock.watchRow({price:.0014,currency:'USD'},'LOW',format),/0\.0014<small>米ドル/);
});
test('browser cache rejects expired/future payloads and expired per-row quotes without changing trade dates',()=>{
 const base={updated_at:now/1000,items:[item('7203.T')]};
 assert.equal(stock.normalizePayload({...base,updated_at:now/1000-8*86400},now),null);
 assert.equal(stock.normalizePayload({...base,updated_at:now/1000+1000},now),null);
 assert.equal(stock.normalizePayload({...base,items:[{...item('7203.T'),fetched_at:now/1000-8*86400}]},now),null);
 const data=payload([item('7203.T'),item('7203.T')]);assert.equal(data.items.length,1);assert.equal(data.items[0].trade_date,'2026-09-18');
});
test('nested direction tab state uses selected, roving tabindex and one visible panel',()=>{
 const buttons=['up','down'].map(key=>({dataset:{sfRank:key},attrs:{},setAttribute(k,v){this.attrs[k]=v;}}));
 const panels=['up','down'].map(key=>({id:'sf-rank-panel-'+key}));
 const root={querySelectorAll:q=>q==='[data-sf-rank]'?buttons:panels};
 stock.selectRanking(root,'down');assert.deepEqual(buttons.map(b=>b.attrs['aria-selected']),['false','true']);assert.deepEqual(buttons.map(b=>b.tabIndex),[-1,0]);assert.deepEqual(panels.map(p=>p.hidden),[true,false]);
 assert.match(stock.rankingMarkup(payload([item('7203.T')]),'down'),/id="sf-rank-panel-up"[^>]+ hidden/);
});
test('reviewed real company stories show publication date, source and independent quote date',()=>{
 const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../static/company-focus.json')));
 assert.equal(stock.validStories(data,now).length,2);
 const html=stock.companyMarkup(data,payload([item('9432.T'),item('6501.T')]),'ready',now);
 assert.match(html,/NTT/);assert.match(html,/日立製作所/);assert.match(html,/2026\/09\/15 発表/);assert.match(html,/2026\/09\/18 の株価/);assert.match(html,/target="_blank" rel="noopener noreferrer"/);
 assert.doesNotMatch(html,/DEMO|さくら食品|みなと電機|あおば物流|サンプル/);
 assert.equal(stock.validStories(data,Date.parse('2026-10-01T03:00:00Z')).length,0);
 assert.equal(stock.validStories(data,Date.parse('2026-09-22T03:00:00Z')).length,0);
});
test('server/provider text is escaped, unsafe story links never become markup',()=>{
 const html=stock.rankingMarkup(payload([{...item('7203.T'),name:'<img src=x onerror=alert(1)>'}]));assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
 const real=JSON.parse(fs.readFileSync(path.join(__dirname,'../static/company-focus.json')));real.companies[0].source_url='javascript:alert(1)';assert.equal(stock.validStories(real,now).length,1);
});
test('company details keep every quote, change and trade date out of the collapsed card',()=>{
 const editorial=JSON.parse(fs.readFileSync(path.join(__dirname,'../static/company-focus.json')));
 const html=stock.companyMarkup(editorial,payload([item('9432.T'),item('6501.T')]),'ready',now);
 const cards=[...html.matchAll(/<article class="sf-company">(.*?)<\/article>/g)];assert.equal(cards.length,2);
 for(const [,card] of cards){
   const details=card.match(/<details\b([^>]*)>(.*?)<\/details>/);assert.ok(details);
   assert.doesNotMatch(details[1],/\bopen\b/);
   assert.match(details[2],/sf-price/);assert.match(details[2],/\+10円/);assert.match(details[2],/\+10\.00%/);assert.match(details[2],/2026\/09\/18 の株価/);
   const summary=details[2].match(/<summary>(.*?)<\/summary>/);assert.ok(summary);assert.match(summary[1],/<h4>/);assert.match(summary[1],/sf-disclosure-mark/);assert.doesNotMatch(summary[1],/詳しく/);
   const collapsed=card.replace(details[0],summary[0]);assert.match(collapsed,/sf-company-name/);assert.match(collapsed,/sf-stock-code/);assert.match(collapsed,/<h4>/);assert.doesNotMatch(collapsed,/sf-quote|sf-price|sf-change|の株価/);
 }
 assert.doesNotMatch(html,/株価はどう動いた/);
 const missing=stock.companyMarkup(editorial,null,'ready',now);
 assert.equal((missing.match(/株価を確認できませんでした/g)||[]).length,2);assert.doesNotMatch(missing,/sf-price/);
});
test('company selection uses at most three distinct valid companies without filling empty slots',()=>{
 const base=JSON.parse(fs.readFileSync(path.join(__dirname,'../static/company-focus.json'))),first=base.companies[0];
 const stories=Array.from({length:5},(_,i)=>({...first,symbol:(1000+i)+'.T',source_url:'https://example.com/announcement/'+i}));
 const invalid={...first,symbol:'INVALID.T',published_date:'2026-10-01'};
 const duplicateCompany={...stories[0],symbol:'1000.t',source_url:'https://example.com/second-story'};
 const duplicateSource={...stories[1],symbol:'DUP.T',source_url:stories[1].source_url+'/#details'};
 const selected=stock.validStories({...base,companies:[invalid,stories[0],duplicateCompany,stories[1],duplicateSource,...stories.slice(2)]},now);
 assert.deepEqual(selected.map(x=>x.symbol),['1000.T','1001.T','1002.T']);
 for(const count of [0,1,2])assert.equal(stock.validStories({...base,companies:stories.slice(0,count)},now).length,count);
});
test('production tabs preserve existing dividend, calendar, search and favorites wiring',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');const script=html.match(/<script>\/\*knTabFeatureV1\*\/[\s\S]*?<\/script>/)[0];
 assert.ok(script.indexOf("_mkSub('movers','','ランキング')")<script.indexOf("_mkSub('companies','','注目')"));assert.ok(script.indexOf("_subRow.appendChild(_sC)")<script.indexOf("_subRow.appendChild(_sW)"));
 assert.match(script,/data-sub/);assert.match(script,/if\(companies\)companies.style.display='none'/);assert.match(script,/switchDividendTab\(tab\)/);assert.doesNotMatch(script,/if\(k.id!=='knWatchAddBtn'\)k.style.display='none'/);
 assert.equal((html.match(/id="knCompanyFocus"/g)||[]).length,1);assert.match(html,/static\/stock-focus.js\?v=/);
});
test('all executable inline scripts remain syntactically valid after integration',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');let count=0;
 for(const [,attributes,source]of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){if(/src=|application\/json|application\/ld\+json|type="importmap"/.test(attributes)||!source.trim())continue;new vm.Script(source);count++;}
 assert.ok(count>20);
});
async function flush(){for(let i=0;i<20;i++)await Promise.resolve();}
function browserHarness(saved){
 const elements=new Map(['homeMoversList','knCompanyFocus'].map(id=>[id,{innerHTML:'',querySelectorAll(){return [];},contains(){return false;}}]));
 const listeners={},requests=[],timers=new Map(),storage=new Map(Object.entries(saved||{}));let timerId=0;
 const w={AbortController,document:{readyState:'complete',activeElement:null,getElementById:id=>elements.get(id)||null,addEventListener:(key,fn)=>{listeners[key]=fn;}},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),fetch(url){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});requests.push({url,resolve,reject});return promise;}};
 stock.start(w);
 return {w,elements,listeners,requests,timers,async respond(request,data){request.resolve({ok:true,json:async()=>data});await flush();}};
}
test('cold provider waiting ends with a retry action rather than an endless spinner',async()=>{
 const h=browserHarness();await h.respond(h.requests.find(r=>r.url.includes('company-focus')),{companies:[]});
 for(let i=0;i<=10;i++){
   const request=h.requests.filter(r=>r.url.includes('/api/scanner'))[i];assert.ok(request);await h.respond(request,{items:[],updated_at:null,refreshing:true});
   if(i<10){const [key,timer]=[...h.timers].find(([,v])=>v.ms===3000);h.timers.delete(key);timer.fn();}
 }
 assert.match(h.elements.get('homeMoversList').innerHTML,/再読み込み/);assert.ok(![...h.timers.values()].some(t=>t.ms===3000));
});
test('style switch discards a late response from a different market scope',async()=>{
 const h=browserHarness();h.w.localStorage.setItem('ui_style','pro');h.listeners.styleChanged();
 const stamp=Date.now()/1000;
 await h.respond(h.requests[0],{updated_at:stamp,items:[{...item('OLD.T'),fetched_at:stamp}],scope:'selected_jp'});
 const next=h.requests.filter(r=>r.url.includes('/api/scanner'))[1];assert.match(next.url,/pro=1/);
 await h.respond(next,{updated_at:stamp,items:[{...item('AAPL'),fetched_at:stamp,currency:'USD'}],scope:'selected_jp_us'});
 assert.match(h.elements.get('homeMoversList').innerHTML,/AAPL/);assert.doesNotMatch(h.elements.get('homeMoversList').innerHTML,/OLD.T/);
});
test('legacy alerts stay outside new home rankings and favorite management has working targets',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');assert.doesNotMatch(html,/_knSyncAlert|Move 急騰・急落アラート/);
 for(const id of ['alert-ticker-input','alert-watchlist','alert-refresh-btn','alert-msg'])assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
 assert.match(html,/var liveWatch=document.getElementById\('knWatchSec'\);if\(liveWatch\)liveWatch.style.display='none'/);
});

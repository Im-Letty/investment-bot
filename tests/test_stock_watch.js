const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const watch=require('../static/stock-watch.js');
const dividendFacts=require('../static/watch-dividends.js'),companyProfile=require('../static/company-profile.js');
const dates=require('../static/date-display.js');
const KEY='alert_watchlist_v1';
const toyota={symbol:'7203.T',name:'トヨタ自動車',verified:true};
function perFact(item=toyota,overrides={}){
 return {kind:'issuer_reported_fiscal_per',symbol:item.symbol,status:'available',value:12.34,unit:'times',basis:'consolidated',accounting_standard:'JGAAP',security_code:item.symbol.split('.')[0],issuer_name:item.name,exchange:item.symbol.endsWith('.T')?'Tokyo':'Nagoya',fiscal_period:{start:'2024-04-01',end:'2025-03-31'},price_basis:'not_stated',price_reference_date:null,source_url:'https://info.gbiz.go.jp/hojin/edinetDownload?docId=S100TEST',source_title:'有価証券報告書（当サイトが年度PERを抜粋）',doc_id:'S100TEST',filed_on:'2025-06-30',checked_on:'2025-07-01',fetched_at:Date.parse('2025-07-01T00:00:00Z')/1000,use_basis:'independent_extraction_of_numeric_facts',latest_filing_guaranteed:false,...overrides};
}
function storage(initial={}){const map=new Map(Object.entries(initial));return {map,getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};}
async function flush(){for(let i=0;i<25;i++)await Promise.resolve();}
test('verified search selections save and reload without any quote request; duplicate codes normalize',async()=>{
 const saved=storage({[KEY]:'["9432.T"]'}),store=watch.createStore(saved);
 assert.equal((await store.add(toyota)).status,'added');
 assert.deepEqual(store.list(),['9432.T','7203.T']);
 assert.equal((await store.add({...toyota,symbol:'７２０３'})).status,'duplicate');
 const reloaded=watch.createStore(saved);assert.deepEqual(reloaded.list(),store.list());assert.equal(reloaded.name('7203.T'),'トヨタ自動車');
 await reloaded.remove('7203');assert.deepEqual(store.list(),['9432.T']);
 assert.equal(watch.symbol('285a'),'285A.T');assert.equal(watch.symbol(' aapl '),'AAPL');
});
test('unknown input cannot create a favorite; concurrent saves retain both selections',async()=>{
 const store=watch.createStore(storage());
 for(const item of [{symbol:'NTT'},null,{...toyota,verified:false},{...toyota,symbol:'<script>'}])assert.equal((await store.add(item)).status,'invalid');
 await Promise.all([store.add(toyota),store.add({symbol:'AAPL',name:'Apple',verified:true}),store.add(toyota)]);
 assert.deepEqual(store.list(),['7203.T','AAPL']);
});
test('ranking and manager share one gated queue so simultaneous additions cannot exceed20',async()=>{
 const initial=Array.from({length:19},(_,i)=>(1000+i)+'.T');
 const saved=storage();let unlock;const ready=new Promise(resolve=>unlock=resolve);
 const w={localStorage:saved,__knGateReady:ready};
 const ranking=watch.storeFor(w),manager=watch.storeFor(w);
 assert.equal(ranking,manager);
 const a=ranking.add(toyota),b=manager.add({symbol:'9432.T',name:'NTT',verified:true});
 await flush();assert.deepEqual(ranking.list(),[]);
 saved.setItem(KEY,JSON.stringify(initial));unlock();
 assert.equal((await a).status,'added');assert.equal((await b).status,'limit');
 assert.equal(ranking.list().length,20);assert.ok(ranking.list().includes('7203.T'));assert.ok(!ranking.list().includes('9432.T'));
 assert.equal(watch.storeFor({localStorage:storage()} )===ranking,false);
});
test('verified regional identities persist as regional favorites without being converted to Tokyo codes',async()=>{
 const store=watch.createStore(storage()),regional={symbol:'8301.JP',name:'地域企業',verified:true,provider_symbol:null};
 assert.equal((await store.add(regional)).status,'added');assert.deepEqual(store.list(),['8301.JP']);assert.equal(store.name('8301.JP'),'地域企業');
 assert.equal((await store.add({...regional,symbol:'８３０１.jp'})).status,'duplicate');assert.equal((await store.add({...regional,symbol:'8301.T',name:'東証企業'})).status,'added');assert.deepEqual(store.list(),['8301.JP','8301.T']);
});
test('saved list is read only after decryption; quota failures do not claim success or discard existing data',async()=>{
 const saved=storage();let resolve;const ready=new Promise(r=>resolve=r);const store=watch.createStore(saved,null,ready);
 const adding=store.add(toyota);await flush();assert.deepEqual(store.list(),[]);
 saved.setItem(KEY,'["9432.T"]');resolve();await adding;assert.deepEqual(store.list(),['9432.T','7203.T']);
 const failing=watch.createStore(saved,()=>{throw new Error('quota');});
 await assert.rejects(failing.add({symbol:'AAPL',name:'Apple',verified:true}),/quota/);
 await assert.rejects(failing.remove('9432.T'),/quota/);assert.deepEqual(failing.list(),['9432.T','7203.T']);
});
test('20-company limit matches the home favorites display and deletion makes space',async()=>{
 const list=Array.from({length:20},(_,i)=>(1000+i)+'.T');const store=watch.createStore(storage({[KEY]:JSON.stringify(list)}));
 assert.equal((await store.add(toyota)).status,'limit');await store.remove(list[0]);assert.equal((await store.add(toyota)).status,'added');assert.equal(store.list().length,20);
});
test('moving favorites inserts before a row or at the end and preserves company names and regional identities',async()=>{
 const namesKey='stock_watch_names_v1',names=JSON.stringify({'7203.T':'トヨタ自動車','8301.JP':'地域企業',AAPL:'Apple'});
 const saved=storage({[KEY]:'["7203.T","8301.JP","AAPL"]',[namesKey]:names}),writes=[];
 const store=watch.createStore(saved,(key,value)=>{writes.push(key);saved.setItem(key,value);});
 assert.deepEqual(await store.move(' aapl ','７２０３'),{status:'moved',symbol:'AAPL',beforeSymbol:'7203.T'});
 assert.deepEqual(store.list(),['AAPL','7203.T','8301.JP']);
 assert.deepEqual(await store.move('AAPL',null),{status:'moved',symbol:'AAPL',beforeSymbol:null});
 assert.deepEqual(store.list(),['7203.T','8301.JP','AAPL']);assert.equal(saved.getItem(namesKey),names);
 assert.equal(store.name('8301.JP'),'地域企業');assert.deepEqual(writes,[KEY,KEY]);
 const restored=watch.createStore(saved);assert.deepEqual(restored.list(),store.list());assert.equal(restored.name('7203.T'),'トヨタ自動車');
});
test('unchanged positions, missing rows and invalid destinations never write or invent a favorite',async()=>{
 const saved=storage({[KEY]:'["7203.T","9432.T","AAPL"]'}),writes=[];
 const store=watch.createStore(saved,(key,value)=>{writes.push(key);saved.setItem(key,value);});
 for(const [from,to] of [['7203.T','9432.T'],['9432.T','9432.T'],['AAPL',null]])assert.equal((await store.move(from,to)).status,'unchanged');
 for(const [from,to] of [['8301.JP','7203.T'],['7203.T','8301.JP'],['8301.JP',null]])assert.equal((await store.move(from,to)).status,'missing');
 for(const [from,to] of [['<bad>','7203.T'],['7203.T','<bad>'],['7203.T',''],['7203.T',undefined],['',null]])assert.equal((await store.move(from,to)).status,'invalid');
 assert.deepEqual(writes,[]);assert.deepEqual(store.list(),['7203.T','9432.T','AAPL']);
});
test('queued moves use the decrypted current list and retain intervening additions without reviving removals',async()=>{
 const saved=storage();let unlock;const ready=new Promise(resolve=>unlock=resolve),w={localStorage:saved,__knGateReady:ready};
 const first=watch.storeFor(w),second=watch.storeFor(w);
 const operations=[first.add({symbol:'AAPL',name:'Apple',verified:true}),second.remove('7203.T'),first.move('7203.T','9432.T'),second.move('AAPL','9432.T')];
 await flush();assert.deepEqual(first.list(),[]);
 saved.setItem(KEY,'["7203.T","9432.T","8301.JP"]');unlock();
 assert.deepEqual((await Promise.all(operations)).map(result=>result.status),['added','removed','missing','moved']);
 assert.deepEqual(first.list(),['AAPL','9432.T','8301.JP']);assert.equal(first.name('AAPL'),'Apple');
 const removedDestination=first.remove('9432.T'),staleMove=second.move('8301.JP','9432.T');await removedDestination;
 assert.equal((await staleMove).status,'missing');assert.deepEqual(first.list(),['AAPL','8301.JP']);
});
test('an unresolved durable move serializes later removals, additions and moves against the newest order',async()=>{
 const saved=storage({[KEY]:'["7203.T","9432.T","AAPL"]'}),writes=[];let release;
 const barrier=new Promise(resolve=>release=resolve);let first=true;
 const store=watch.createStore(saved,async(key,value)=>{writes.push({key,value});if(first){first=false;await barrier;}saved.setItem(key,value);});
 const moving=store.move('AAPL','7203.T'),removing=store.remove('9432.T'),adding=store.add({symbol:'8301.JP',name:'地域企業',verified:true}),movingNew=store.move('8301.JP','AAPL');
 await flush();assert.equal(writes.length,1);assert.deepEqual(store.list(),['7203.T','9432.T','AAPL'],'Pending persistence cannot acknowledge or expose a changed order');
 release();assert.deepEqual((await Promise.all([moving,removing,adding,movingNew])).map(result=>result.status),['moved','removed','added','moved']);
 assert.deepEqual(store.list(),['8301.JP','AAPL','7203.T']);assert.equal(store.name('8301.JP'),'地域企業');
 assert.deepEqual(writes.filter(write=>write.key===KEY).map(write=>JSON.parse(write.value)),[['AAPL','7203.T','9432.T'],['AAPL','7203.T'],['AAPL','7203.T','8301.JP'],['8301.JP','AAPL','7203.T']]);
});
test('a rejected durable reorder preserves the existing order and the shared queue accepts a later retry',async()=>{
 const saved=storage({[KEY]:'["7203.T","9432.T","AAPL"]','stock_watch_names_v1':'{"AAPL":"Apple"}'});let fail=true;
 const store=watch.createStore(saved,async(key,value)=>{if(fail)throw new Error('quota');saved.setItem(key,value);});
 await assert.rejects(store.move('AAPL','7203.T'),/quota/);assert.deepEqual(store.list(),['7203.T','9432.T','AAPL']);
 fail=false;assert.equal((await store.move('AAPL','7203.T')).status,'moved');
 const restored=watch.createStore(saved);assert.deepEqual(restored.list(),['AAPL','7203.T','9432.T']);assert.equal(restored.name('AAPL'),'Apple');
});
function searchHarness(){
 const requests=[],states=[],timers=new Map();let next=0;
 const w={AbortController,fetch(url,options){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});requests.push({url,options,resolve,reject});return promise;},setTimeout(fn,ms){timers.set(++next,{fn,ms});return next;},clearTimeout(id){timers.delete(id);}};
 return {requests,states,timers,search:watch.createSearch(w,s=>states.push(s)),async reply(index,data){requests[index].resolve({ok:true,json:async()=>data});await flush();}};
}
test('search encodes company names, drops stale results and only exposes verified choices',async()=>{
 const h=searchHarness();h.search.run('トヨタ');assert.match(h.requests[0].url,/%E3%83%88/);
 h.search.run('NTT');assert.equal(h.requests[0].options.signal.aborted,true);
 await h.reply(1,{results:[{symbol:'9432.T',name:'NTT',verified:true},{symbol:'<bad>',name:'x',verified:true},{symbol:'7203.T',name:'unverified'}]});
 await h.reply(0,{results:[toyota]});assert.deepEqual(h.states.at(-1).items.map(x=>x.symbol),['9432.T']);
});
test('search distinguishes no match, service errors and a bounded stalled request; supports retry',async()=>{
 const h=searchHarness();h.search.run('nothing');await h.reply(0,{results:[]});assert.equal(h.states.at(-1).status,'empty');
 h.search.run('7203');h.requests[1].reject(new Error('offline'));await flush();assert.equal(h.states.at(-1).status,'error');
 h.search.run('7203');const timer=[...h.timers.values()].find(x=>x.ms===10000);timer.fn();await flush();assert.equal(h.states.at(-1).status,'error');assert.equal(h.requests[2].options.signal.aborted,true);
 h.search.run('7203');await h.reply(3,{results:[toyota]});assert.equal(h.states.at(-1).status,'results');
 h.search.run('AAPL');await h.reply(4,{results:[],unavailable:true});assert.equal(h.states.at(-1).status,'error');
});
test('debouncing and clearing search invalidate prior requests immediately',async()=>{
 const h=searchHarness();h.search.schedule('ト');h.search.schedule('トヨタ');assert.equal(h.requests.length,0);
 assert.equal(h.timers.size,1);[...h.timers.values()][0].fn();assert.equal(h.requests.length,1);
 h.search.run('');await h.reply(0,{results:[toyota]});assert.equal(h.states.at(-1).status,'idle');
});
test('encrypted favorites persistence survives a new page and rejects failed durable writes',async()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');const start=html.indexOf('/* knGate:');const code=html.slice(start,html.indexOf('</script>',start));
 const disk=new Map();let fail=false;
 function gate(){const localStorage={getItem:k=>disk.get(k)??null,setItem(k,v){if(fail&&k==='knenc:'+KEY)throw new Error('quota');disk.set(k,v);},removeItem:k=>disk.delete(k)};const window={};vm.runInNewContext(code,{window,localStorage,crypto:require('node:crypto').webcrypto,TextEncoder,TextDecoder,Uint8Array,btoa,atob});return {window,localStorage};}
 const first=gate();await first.window.__knGateReady;
 const store=watch.createStore(first.localStorage,first.window.__knPersistLocalSetting,first.window.__knGateReady);await store.add(toyota);
 await store.add({symbol:'8301.JP',name:'地域企業',verified:true});await store.add({symbol:'AAPL',name:'Apple',verified:true});
 assert.equal((await store.move('AAPL','7203.T')).status,'moved');
 assert.equal(disk.has(KEY),false);assert.ok(disk.get('knenc:'+KEY).startsWith('knv1:'));assert.ok(!disk.get('knenc:'+KEY).includes('7203'));
 const second=gate();await second.window.__knGateReady;const restored=watch.createStore(second.localStorage,second.window.__knPersistLocalSetting,second.window.__knGateReady);
 assert.deepEqual(restored.list(),['AAPL','7203.T','8301.JP']);assert.equal(restored.name('7203.T'),'トヨタ自動車');assert.equal(restored.name('8301.JP'),'地域企業');
 fail=true;await assert.rejects(restored.move('AAPL',null),/quota/);await assert.rejects(restored.remove('7203.T'),/quota/);assert.deepEqual(restored.list(),['AAPL','7203.T','8301.JP']);
});
class Element{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.style={overflow:'',paddingRight:'',setProperty(k,v){this[k]=v;}};this.listeners={};this.attrs={};this.value='';this.textContent='';this.isConnected=true;this.scrollTop=0;this.inert=false;this.classes=new Set();this.classList={add:v=>this.classes.add(v),remove:v=>this.classes.delete(v),contains:v=>this.classes.has(v)};}
 appendChild(node){if(node.parentNode)node.parentNode.children=node.parentNode.children.filter(n=>n!==node);node.parentNode=this;this.children.push(node);return node;}replaceChildren(...nodes){this.children=nodes;}setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k]??null;}addEventListener(k,v){this.listeners[k]=v;}focus(options){this.focused=true;this.focusOptions=options;if(this.doc)this.doc.activeElement=this;}querySelector(tag){return this.children.flatMap(n=>[n,...n.children]).find(n=>n.tagName===tag)||null;}closest(selector){return selector==='[hidden]'&&this.hidden?this:null;}getClientRects(){return this.hidden?[]:[{}];}
}
function uiHarness({reduced=true,withDividends=false,lookupItems=[toyota]}={}){
 const ids=['alert-section','alert-ticker-input','stock-search-form','stock-search-results','alert-watchlist','stock-watch-saved','alert-msg','stock-watch-count','morning-section','morning-news-section','stock-watch-close','stock-search-heading','stock-watch-title'];const nodes=new Map(ids.map(id=>[id,new Element()]));const requests=[],factsRequests=[],timers=new Map(),events={};let tid=0,refreshes=0;
 const body=new Element('BODY'),panel=new Element('section'),originalFocus=new Element('button'),fallback=new Element('button'),submit=new Element('button'),nav=new Element('nav');nav.inert=true;
 body.classList.add('view-asaletter');body.appendChild(nodes.get('morning-section'));body.appendChild(nav);body.appendChild(nodes.get('alert-section'));nodes.get('morning-section').scrollTop=450;
 const manager=nodes.get('alert-section');manager.querySelector=selector=>selector==='.sw-sheet'?panel:null;
 const doc={body,documentElement:{clientWidth:400},addEventListener:(key,fn)=>events[key]=fn,readyState:'complete',activeElement:originalFocus,querySelector:()=>fallback,getElementById:id=>nodes.get(id),createElement:tag=>{const node=new Element(tag);node.doc=doc;return node;}};
 for(const node of [...nodes.values(),panel,originalFocus,fallback,submit])node.doc=doc;
 panel.querySelectorAll=()=>[nodes.get('stock-watch-close'),nodes.get('alert-ticker-input'),submit];
 const vv={height:780,offsetTop:0,events:{},addEventListener(key,fn){this.events[key]=fn;}};
 const w={document:doc,localStorage:storage(),StockWatch:{},KNDateDisplay:dates,AbortController,innerWidth:400,visualViewport:vv,matchMedia:()=>({matches:reduced}),scrollTo(){},__knRefreshWatch(){refreshes++;},setTimeout(fn,ms){timers.set(++tid,{fn,ms});return tid;},clearTimeout:id=>timers.delete(id),async fetch(url,options){
  if(url.startsWith('/api/company-profile?'))return new Promise(resolve=>factsRequests.push({url,options,resolve}));
  requests.push(url);return {ok:true,json:async()=>({results:lookupItems})};
 }};
 if(withDividends){w.KNWatchDividends=dividendFacts;w.KNCompanyProfile={createFactsLoader:callback=>companyProfile.createLoader({fetch:w.fetch.bind(w),AbortController,setTimeout:w.setTimeout.bind(w),clearTimeout:w.clearTimeout.bind(w),storage:w.localStorage},callback)};}
 watch.start(w);return {w,doc,nodes,panel,manager,nav,originalFocus,fallback,submit,requests,factsRequests,timers,events,vv,get refreshes(){return refreshes;},async replyFacts(index,key,amount=95){factsRequests[index].resolve({ok:true,json:async()=>({symbol:key,status:'ready',updated_at:Date.now()/1000,data:{currency:'JPY',annual_dividend:amount,annual_dividend_basis:'trailing_12m',dividend_fetched_at:Date.now()/1000,dividend_payment_date:'2099-11-26'}})});await flush();}};
}
test('sheet preserves the home while searching, adding and removing; Japanese composition does not submit',async()=>{
 const h=uiHarness();const {w,doc,nodes,requests,manager}=h;
 await w.openStockWatchManager();assert.equal(doc.body.classList.contains('view-asaletter'),true);assert.equal(nodes.get('morning-section').inert,true);assert.equal(manager.style.display,'flex');assert.equal(h.panel.focused,true);const input=nodes.get('alert-ticker-input');input.value='トヨタ';
 input.listeners.compositionstart();input.listeners.input();nodes.get('stock-search-form').listeners.submit({preventDefault(){}});await flush();assert.equal(requests.length,0);
 input.listeners.compositionend();nodes.get('stock-search-form').listeners.submit({preventDefault(){}});await flush();assert.equal(requests.length,1);assert.equal(nodes.get('stock-search-heading').hidden,false);
 const button=nodes.get('stock-search-results').children[0].children[0].children[1];await button.listeners.click();await flush();
 assert.equal(button.textContent,'追加済み');assert.equal(nodes.get('stock-watch-count').textContent,'1件');assert.equal(nodes.get('alert-msg').textContent,'');assert.equal(requests.length,1);
 const remove=nodes.get('alert-watchlist').children[0].children[0].children[1];await remove.listeners.click();assert.equal(nodes.get('stock-watch-count').textContent,'0件');
 h.originalFocus.isConnected=false;w.closeStockWatchManager();assert.equal(h.fallback.focused,true);assert.equal(manager.style.display,'none');assert.ok(h.refreshes>=3);assert.equal(doc.body.classList.contains('view-asaletter'),true);assert.equal(nodes.get('morning-section').scrollTop,450);assert.equal(nodes.get('morning-section').inert,false);assert.equal(h.nav.inert,true);assert.equal(doc.body.style.overflow,'');
});
test('sheet traps focus, follows the visible keyboard viewport and closes with Escape or backdrop',async()=>{
 const h=uiHarness();await h.w.openStockWatchManager();let prevented=0;const key=(value,shiftKey=false)=>h.events.keydown({key:value,shiftKey,preventDefault(){prevented++;}});
 const close=h.nodes.get('stock-watch-close');close.focus();key('Tab',true);assert.equal(h.doc.activeElement,h.submit);key('Tab');assert.equal(h.doc.activeElement,close);assert.equal(prevented,2);
 h.vv.height=420;h.vv.offsetTop=30;h.vv.events.resize();assert.equal(h.manager.style['--sw-viewport-height'],'420px');assert.equal(h.manager.style['--sw-viewport-top'],'30px');
 key('Escape');assert.equal(h.manager.style.display,'none');assert.equal(h.doc.activeElement,h.originalFocus);
 await h.w.openStockWatchManager();const backdrop=new Element();backdrop.classList.add('sw-backdrop');h.manager.listeners.click({target:backdrop});assert.equal(h.manager.style.display,'none');
});
test('reopening during the close animation retains the original focus and background state',async()=>{
 const h=uiHarness({reduced:false});await h.w.openStockWatchManager();h.w.closeStockWatchManager();assert.equal(h.manager.dataset.closing,'true');assert.equal(h.nodes.get('morning-section').inert,true);
 await h.w.openStockWatchManager();assert.equal(h.manager.dataset.closing,undefined);assert.equal([...h.timers.values()].filter(t=>t.ms===180).length,0);
 h.w.closeStockWatchManager();[...h.timers.values()].find(t=>t.ms===180).fn();assert.equal(h.manager.style.display,'none');assert.equal(h.nodes.get('morning-section').inert,false);assert.equal(h.doc.activeElement,h.originalFocus);
});
test('a query interrupted by closing resumes when the sheet is opened again',async()=>{
 const h=uiHarness();await h.w.openStockWatchManager();const input=h.nodes.get('alert-ticker-input');input.value='トヨタ';input.listeners.input();
 h.w.closeStockWatchManager();assert.equal(h.requests.length,0);await h.w.openStockWatchManager();await flush();assert.equal(h.requests.length,1);assert.equal(h.nodes.get('stock-search-heading').hidden,false);
 assert.equal(h.nodes.get('stock-search-results').children[0].children.length,1);
});
test('heading search and favorite management use one sheet and retain the same saved companies',async()=>{
 const h=uiHarness();await flush();
 await h.w.openStockWatchManager({mode:'search',trigger:h.originalFocus});
 assert.equal(h.manager.style.display,'flex');assert.equal(h.nodes.get('stock-watch-title').textContent,'銘柄を検索');
 assert.equal(h.manager.dataset.mode,'search');
 assert.equal(h.nodes.get('stock-watch-saved').hidden,true,'Search offers adding while the saved list stays in favorite management');
 const input=h.nodes.get('alert-ticker-input');input.value='トヨタ';
 h.nodes.get('stock-search-form').listeners.submit({preventDefault(){}});await flush();
 const row=h.nodes.get('stock-search-results').children[0].children[0],add=row.children[1];
 assert.equal(row.children[0].tagName,'button','Company names retain the company information action');
 assert.deepEqual(JSON.parse(h.w.localStorage.getItem(KEY)||'[]'),[],'Looking up a company never adds it automatically');
 await add.listeners.click();await flush();
 assert.equal(h.nodes.get('stock-watch-count').textContent,'1件');
 h.w.closeStockWatchManager();
 await h.w.openStockWatchManager();
 assert.equal(h.manager.style.display,'flex');assert.equal(h.nodes.get('stock-watch-title').textContent,'お気に入り');
 assert.equal(h.manager.dataset.mode,'favorites','Favorite management must not retain centered search presentation');
 assert.equal(h.nodes.get('stock-watch-saved').hidden,false);
 assert.equal(h.nodes.get('stock-watch-count').textContent,'1件');
 assert.equal(h.nodes.get('alert-watchlist').children[0].children[0].children[0].children[0].textContent,toyota.name);
 assert.equal(h.requests.length,1,'Switching entry points does not repeat a completed lookup');
});
test('heading search restores its pre-focus position and returns focus to its explicit trigger',async()=>{
 const h=uiHarness(),home=h.nodes.get('morning-section'),trigger=new Element('button');trigger.doc=h.doc;
 home.style.overflowY='auto';h.doc.body.style.overflow='clip';h.doc.body.style.paddingRight='7px';
 let restores=0;const snapshot={restore(){restores++;home.scrollTop=265;}};
 await h.w.openStockWatchManager({mode:'search',trigger,snapshot});
 assert.equal(home.scrollTop,265,'The supplied pointer-down position wins over later focus movement');
 assert.equal(home.style.overflowY,'hidden');assert.equal(home.inert,true);assert.equal(trigger.attrs['aria-expanded'],'true');
 assert.equal(h.doc.activeElement,h.panel);assert.deepEqual(h.panel.focusOptions,{preventScroll:true});
 home.scrollTop=310;h.w.closeStockWatchManager();
 assert.equal(home.scrollTop,265);assert.equal(home.style.overflowY,'auto');assert.equal(home.inert,false);
 assert.equal(h.doc.body.style.overflow,'clip');assert.equal(h.doc.body.style.paddingRight,'7px');
 assert.equal(h.doc.activeElement,trigger);assert.deepEqual(trigger.focusOptions,{preventScroll:true});
 assert.equal(trigger.attrs['aria-expanded'],'false');assert.ok(restores>=2);
});
test('company information opens only after the shared sheet releases its background lock',async()=>{
 const h=uiHarness({reduced:false}),home=h.nodes.get('morning-section');home.style.overflowY='auto';
 await h.w.openStockWatchManager({mode:'search',trigger:h.originalFocus});
 const input=h.nodes.get('alert-ticker-input');input.value='トヨタ';
 h.nodes.get('stock-search-form').listeners.submit({preventDefault(){}});await flush();
 let call=null;h.w.KNCompanyProfile={open(key,name,trigger){
  assert.equal(h.manager.style.display,'none','There cannot be two active modal focus traps');
  assert.equal(home.inert,false);assert.equal(home.style.overflowY,'auto');assert.equal(h.doc.body.style.overflow,'');
  assert.equal([...h.timers.values()].filter(timer=>timer.ms===180).length,0,'The old close animation cannot unlock a newly opened profile');
  call={key,name,trigger};
 }};
 const company=h.nodes.get('stock-search-results').children[0].children[0].children[0];
 assert.equal(company.tagName,'button');
 await company.listeners.click();await flush();
 assert.deepEqual(call,{key:toyota.symbol,name:toyota.name,trigger:h.originalFocus});
 assert.deepEqual(JSON.parse(h.w.localStorage.getItem(KEY)||'[]'),[],'Opening company information is distinct from adding a favorite');
});
test('search dividend previews repaint only facts and adding writes the existing favorites store',async()=>{
 const h=uiHarness({withDividends:true});await h.w.openStockWatchManager({mode:'search'});
 const input=h.nodes.get('alert-ticker-input');input.value='トヨタ';h.nodes.get('stock-search-form').listeners.submit({preventDefault(){}});await flush();
 const list=h.nodes.get('stock-search-results').children[0],row=list.children[0],company=row.children[0],add=row.children[1],preview=row.children[2];
 assert.equal(add.textContent,'お気に入りに追加');assert.match(company.attrs['aria-label'],/会社情報・配当金を見る/);assert.equal(h.factsRequests.length,1);
 assert.match(preview.children[0].textContent,/確認中/);add.focus();const refreshes=h.refreshes;
 await h.replyFacts(0,'7203.T',1000);
 assert.equal(preview.children[0].textContent,'過去1年の配当（1株） 1,000円');assert.equal(preview.children[1].textContent,'2099/11/26 支払予定');
 assert.equal(h.nodes.get('stock-search-results').children[0],list);assert.equal(row.children[1],add);assert.equal(h.doc.activeElement,add,'Enrichment must not rebuild or refocus the result');
 assert.deepEqual(JSON.parse(h.w.localStorage.getItem(KEY)||'[]'),[],'Reading facts does not register a company');
 await add.listeners.click();await flush();assert.deepEqual(JSON.parse(h.w.localStorage.getItem(KEY)),['7203.T']);assert.equal(h.nodes.get('stock-watch-count').textContent,'1件');assert.ok(h.refreshes>refreshes);
 assert.equal(add.textContent,'追加済み');assert.equal(add.attrs['aria-label'],'トヨタ自動車 追加済み');assert.equal(add.disabled,true);assert.equal(h.w.localStorage.getItem('myDividendStocks'),null,'No second dividend favorites store is created');
});
test('search previews cap Japanese companies at five, use two workers and reuse completed results on reopen',async()=>{
 const japanese=Array.from({length:7},(_,i)=>({symbol:(1000+i)+'.T',name:'会社'+i,verified:true})),foreign={symbol:'AAPL',name:'Apple',verified:true};
 const h=uiHarness({withDividends:true,lookupItems:[foreign,...japanese]});await h.w.openStockWatchManager({mode:'search'});
 h.nodes.get('alert-ticker-input').value='会社';h.nodes.get('stock-search-form').listeners.submit({preventDefault(){}});await flush();
 const rows=h.nodes.get('stock-search-results').children[0].children;
 assert.equal(rows.length,8);assert.equal(rows[0].children.length,2);assert.equal(rows.filter(row=>row.children.some(node=>node.className==='sw-dividends')).length,5);assert.equal(rows[6].children.length,3);assert.equal(rows[7].children.length,3);
 assert.equal(rows.slice(1).filter(row=>row.children.some(node=>node.className==='sw-per')).length,7,'Every Japanese result gets a synchronous PER state, independently of the five dividend previews');
 assert.equal(h.factsRequests.length,2,'Only two facts requests may start concurrently');
 for(let i=0;i<5;i++){const key=new URL(h.factsRequests[i].url,'https://fixture.test').searchParams.get('symbol');await h.replyFacts(i,key,i);}
 assert.equal(h.factsRequests.length,5);assert.ok(h.factsRequests.every(request=>!request.url.includes('AAPL')));
 h.w.closeStockWatchManager();await h.w.openStockWatchManager({mode:'search'});await flush();assert.equal(h.factsRequests.length,5,'Reopening reuses the completed facts cache');
 assert.equal(rows[1].children[2].children[0].textContent,'過去1年の配当（1株） 0円');
});
test('hidden sheets and cleared searches cancel pending facts and reject their late responses',async()=>{
 const ntt={symbol:'9432.T',name:'NTT',verified:true},h=uiHarness({withDividends:true,lookupItems:[toyota,ntt]});await h.w.openStockWatchManager({mode:'search'});
 const input=h.nodes.get('alert-ticker-input');input.value='会社';h.nodes.get('stock-search-form').listeners.submit({preventDefault(){}});await flush();assert.equal(h.factsRequests.length,2);
 const preview=h.nodes.get('stock-search-results').children[0].children[0].children[2];
 h.doc.hidden=true;h.events.visibilitychange();assert.ok(h.factsRequests.every(request=>request.options.signal.aborted));
 await h.replyFacts(0,'7203.T',999);await h.replyFacts(1,'9432.T',999);assert.doesNotMatch(preview.children[0].textContent,/999/);
 h.doc.hidden=false;h.events.visibilitychange();await flush();assert.equal(h.factsRequests.length,4,'Visibility resumes the bounded pending selection');
 input.value='';input.listeners.input();assert.ok(h.factsRequests.slice(2).every(request=>request.options.signal.aborted));assert.equal(h.nodes.get('stock-search-results').children.length,0);
 await h.replyFacts(2,'7203.T',777);await h.replyFacts(3,'9432.T',777);assert.equal(h.nodes.get('stock-search-results').children.length,0,'Old facts cannot restore cleared results');
});
test('closing or opening company information cancels preview work before the next dialog takes over',async()=>{
 const h=uiHarness({withDividends:true,reduced:false});await h.w.openStockWatchManager({mode:'search'});
 h.nodes.get('alert-ticker-input').value='トヨタ';h.nodes.get('stock-search-form').listeners.submit({preventDefault(){}});await flush();
 h.w.closeStockWatchManager();assert.equal(h.factsRequests[0].options.signal.aborted,true,'Cancel at the start of the close animation');
 await h.w.openStockWatchManager({mode:'search'});await flush();assert.equal(h.factsRequests.length,2);
 let called=false;h.w.KNCompanyProfile.open=()=>{called=true;assert.equal(h.manager.style.display,'none');assert.equal(h.factsRequests[1].options.signal.aborted,true);};
 h.nodes.get('stock-search-results').children[0].children[0].children[0].listeners.click();assert.equal(called,true);
});
test('unavailable preview facts remain unconfirmed without blocking favorites or creating zero values',async()=>{
 const h=uiHarness({withDividends:true});await h.w.openStockWatchManager({mode:'search'});
 h.nodes.get('alert-ticker-input').value='トヨタ';h.nodes.get('stock-search-form').listeners.submit({preventDefault(){}});await flush();
 h.factsRequests[0].resolve({ok:false,status:404});await flush();
 const row=h.nodes.get('stock-search-results').children[0].children[0];assert.equal(row.children[2].children[0].textContent,'過去1年の配当（1株） 未確認');assert.equal(row.children[2].children[1].textContent,'支払予定 未確認');assert.equal(row.children[1].disabled,false);
 await row.children[1].listeners.click();await flush();assert.deepEqual(JSON.parse(h.w.localStorage.getItem(KEY)),['7203.T']);
});
test('regional searches open the regional company details and never enter Yahoo dividend previews',async()=>{
 const regional={symbol:'8301.JP',name:'地域企業',verified:true,provider_symbol:null},h=uiHarness({withDividends:true,lookupItems:[regional,toyota]});
 await h.w.openStockWatchManager({mode:'search'});h.nodes.get('alert-ticker-input').value='地域';h.nodes.get('stock-search-form').listeners.submit({preventDefault(){}});await flush();
 const rows=h.nodes.get('stock-search-results').children[0].children,company=rows[0].children[0];assert.equal(company.children[1].textContent,'8301');assert.match(company.attrs['aria-label'],/会社情報を見る/);assert.match(rows[0].children[2].textContent,/取得元は未対応/);
 assert.equal(h.factsRequests.length,1);assert.match(h.factsRequests[0].url,/symbol=7203.T/);assert.ok(h.factsRequests.every(request=>!request.url.includes('8301')));
 let opened;h.w.KNCompanyProfile.open=key=>{opened=key;};company.listeners.click();assert.equal(opened,'8301.JP');assert.equal(h.manager.style.display,'none');
});
test('current PER never takes a filing ratio, price/EPS calculation or unverified current-like input',()=>{
 const item={...toyota,exchange:'Tokyo',code:'7203'};
 for(const value of [12.34,0,1234.5,null,NaN]){
  assert.equal(watch.currentPerLine({...item,year_per:perFact(item,{value}),current_per:value,data:{issuer_reported_fiscal_per:value,current_per:value,price:100,eps:10},trailingPE:value}),'現在のPER 未確認');
 }
 assert.equal(watch.currentPerLine({symbol:'1869.JP',name:'名工建設',year_per:perFact(item)}),'現在のPER 未確認');
 assert.equal(watch.currentPerLine({symbol:'AAPL',name:'Apple',year_per:perFact(item)}),'');
});
test('all Japanese search rows discard old lookup PER and show current unconfirmed without extra PER requests',async()=>{
 const japanese=Array.from({length:6},(_,i)=>{const item={symbol:(1000+i)+'.T',code:String(1000+i),name:'会社'+i,exchange:'Tokyo',verified:true};return {...item,year_per:perFact(item,{value:10+i})};});
 const regional={symbol:'1869.JP',code:'1869',name:'名工建設',exchange:'Nagoya',verified:true},foreign={symbol:'AAPL',name:'Apple',verified:true};
 regional.year_per=perFact(regional,{basis:'standalone',value:8.125});
 const h=uiHarness({withDividends:true,lookupItems:[...japanese,regional,foreign]});await h.w.openStockWatchManager({mode:'search'});
 h.nodes.get('alert-ticker-input').value='会社';h.nodes.get('stock-search-form').listeners.submit({preventDefault(){}});await flush();
 const rows=h.nodes.get('stock-search-results').children[0].children,perRows=rows.slice(0,7).map(row=>row.children.find(node=>node.className==='sw-per'));
 assert.equal(perRows.length,7);assert.ok(perRows.every(node=>node&&node.textContent==='現在のPER 未確認'));
 assert.equal(perRows[5].textContent,'現在のPER 未確認');assert.equal(perRows[6].textContent,'現在のPER 未確認');
 assert.equal(rows[7].children.some(node=>node.className==='sw-per'),false);
 assert.deepEqual(h.requests,['/api/lookup?q=%E4%BC%9A%E7%A4%BE&per=current']);assert.equal(h.factsRequests.length,2,'Only the existing two dividend workers start');
 assert.ok(h.factsRequests.every(request=>request.url.startsWith('/api/company-profile?symbol=')&&!request.url.includes('1869')));
 const perNode=perRows[0],add=rows[0].children[1];add.focus();await h.replyFacts(0,japanese[0].symbol,95);
 assert.equal(rows[0].children.find(node=>node.className==='sw-per'),perNode);assert.equal(perNode.textContent,'現在のPER 未確認');assert.equal(h.doc.activeElement,add,'Dividend enrichment does not replace the PER line or focus');
});
test('unconfirmed PER does not block saving, fabricate zero, or trigger an individual retry',async()=>{
 const h=uiHarness({lookupItems:[{...toyota,year_per:perFact(toyota,{value:null})}]});await h.w.openStockWatchManager({mode:'search'});
 h.nodes.get('alert-ticker-input').value='7203';h.nodes.get('stock-search-form').listeners.submit({preventDefault(){}});await flush();
 const row=h.nodes.get('stock-search-results').children[0].children[0],per=row.children.find(node=>node.className==='sw-per');
 assert.equal(per.textContent,'現在のPER 未確認');assert.equal(row.children[1].disabled,false);await row.children[1].listeners.click();await flush();
 assert.deepEqual(JSON.parse(h.w.localStorage.getItem(KEY)),['7203.T']);assert.equal(h.requests.length,1);assert.equal(h.factsRequests.length,0);
});

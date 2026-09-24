const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const watch=require('../static/stock-watch.js');
const KEY='alert_watchlist_v1';
const toyota={symbol:'7203.T',name:'トヨタ自動車',verified:true};
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
 assert.equal(disk.has(KEY),false);assert.ok(disk.get('knenc:'+KEY).startsWith('knv1:'));assert.ok(!disk.get('knenc:'+KEY).includes('7203'));
 const second=gate();await second.window.__knGateReady;const restored=watch.createStore(second.localStorage,second.window.__knPersistLocalSetting,second.window.__knGateReady);
 assert.deepEqual(restored.list(),['7203.T']);assert.equal(restored.name('7203.T'),'トヨタ自動車');
 fail=true;await assert.rejects(restored.remove('7203.T'),/quota/);assert.deepEqual(restored.list(),['7203.T']);
});
class Element{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.listeners={};this.attrs={};this.value='';this.textContent='';this.isConnected=true;this.scrollTop=0;}
 appendChild(node){this.children.push(node);return node;}replaceChildren(...nodes){this.children=nodes;}setAttribute(k,v){this.attrs[k]=v;}addEventListener(k,v){this.listeners[k]=v;}focus(){this.focused=true;}querySelector(tag){return this.children.flatMap(n=>[n,...n.children]).find(n=>n.tagName===tag)||null;}
}
test('UI searches on submit, adds selected company, removes it, returns to favorites and handles Japanese composition',async()=>{
 const ids=['alert-section','alert-ticker-input','stock-search-form','stock-search-results','alert-watchlist','alert-msg','stock-watch-count','morning-section','morning-news-section'];const nodes=new Map(ids.map(id=>[id,new Element()]));const requests=[],timers=new Map();let tid=0,refreshes=0,tab='';
 const classes=new Set(['view-asaletter']);nodes.get('morning-section').scrollTop=450;
 const w={document:{body:{classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)}},addEventListener(){},readyState:'complete',activeElement:new Element('button'),querySelector:()=>nodes.get('morning-section'),getElementById:id=>nodes.get(id),createElement:tag=>new Element(tag)},localStorage:storage(),StockWatch:{},AbortController,scrollTo(){},__knRefreshWatch(){refreshes++;},__knSetSub(value){tab=value;},setTimeout(fn,ms){timers.set(++tid,{fn,ms});return tid;},clearTimeout:id=>timers.delete(id),async fetch(url){requests.push(url);return {ok:true,json:async()=>({results:[toyota]})};}};
 watch.start(w);await w.openStockWatchManager();assert.equal(classes.has('view-asaletter'),false);const input=nodes.get('alert-ticker-input');input.value='トヨタ';
 input.listeners.compositionstart();input.listeners.input();nodes.get('stock-search-form').listeners.submit({preventDefault(){}});await flush();assert.equal(requests.length,0);
 input.listeners.compositionend();nodes.get('stock-search-form').listeners.submit({preventDefault(){}});await flush();assert.equal(requests.length,1);
 const button=nodes.get('stock-search-results').children[0].children[0].children[1];await button.listeners.click();await flush();
 assert.equal(button.textContent,'追加済み');assert.equal(nodes.get('stock-watch-count').textContent,'1 / 20');assert.equal(nodes.get('alert-msg').textContent,'');assert.equal(requests.length,1);
 const remove=nodes.get('alert-watchlist').children[0].children[0].children[1];await remove.listeners.click();assert.equal(nodes.get('stock-watch-count').textContent,'0 / 20');
 w.document.activeElement.isConnected=false;w.closeStockWatchManager();assert.equal(nodes.get('morning-section').focused,true);assert.equal(nodes.get('alert-section').style.display,'none');assert.equal(tab,'watch');assert.ok(refreshes>=3);assert.equal(classes.has('view-asaletter'),true);assert.equal(nodes.get('morning-section').scrollTop,450);
});

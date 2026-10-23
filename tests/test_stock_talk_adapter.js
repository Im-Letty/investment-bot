'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../static/stock-talk.js'),'utf8');
const room=(code='1832',name='北海電工')=>({category:'stock:'+code,code,name});
function harness(){
  const reads=[],opens=[],events=[],timers=new Map();let id=0,config;
  const conversation={categories:[],open(origin){events.push('open');opens.push({origin});return true;},openRoom(value,options){events.push('room');opens.push({room:value,options});return true;},close(){events.push('close');return {morningTop:177};},send(){},count(){}};
  const document={readyState:'complete',createElement(){throw Error('The stock adapter must not create a global Talk card');},addEventListener(){}};
  const window={document,AbortController,setTimeout(fn,ms){const key=++id;timers.set(key,{fn,ms});return key;},clearTimeout(key){timers.delete(key);},knCreateConversation(w,options){assert.equal(w,window);config=options;return conversation;},fetch(url,options){return new Promise((resolve,reject)=>reads.push({url,options,resolve,reject}));}};
  vm.runInNewContext(source,{window,document});
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  async function response(data,{status=200,index=reads.length-1}={}){reads[index].resolve({ok:status>=200&&status<300,json:async()=>data});await settle();}
  return {api:window.KNStockTalk,window,reads,opens,events,timers,response,settle,config};
}
test('company entry normalizes Japanese symbols and opens only the exact verified room after releasing the sheet',async()=>{
  for(const symbol of ['1832.JP','1832.T','1832','１８３２．ｊｐ',' 1832.jp ']){
    const h=harness(),trace=[],onReturn=()=>{};
    const opening=h.api.openForCompany(symbol,{isCurrent(){trace.push('current');return true;},beforeOpen(){trace.push('release');return true;},onReturn});
    assert.equal(h.opens.length,0);assert.equal(h.reads.length,1);assert.equal(h.reads[0].url,'/api/stock-talk/rooms?q=1832');assert.equal(h.reads[0].options.cache,'no-store');
    await h.response({ok:true,rooms:[room('7203','トヨタ'),room()]});assert.equal(await opening,true);assert.deepEqual(trace,['current','release']);assert.equal(h.opens.length,1);assert.equal(h.opens[0].room.category,'stock:1832');assert.equal(h.opens[0].room.code,'1832');assert.equal(h.opens[0].options.onReturn,onReturn);assert.equal(h.timers.size,0);
  }
});
test('unsupported symbols never fetch or open a default company',async()=>{
  for(const value of [null,1832,'AAPL','7203.US','stock:7203','1832.JP?x=1','../1832','000','12345','ABCD']){
    const h=harness();assert.equal(await h.api.openForCompany(value),false);assert.equal(h.reads.length,0);assert.equal(h.opens.length,0);
  }
});
test('HTTP, malformed, wrong-code and wrong-category room results leave the current sheet untouched',async()=>{
  for(const [data,status] of [[{ok:true,rooms:[room()]},503],[null,200],[{ok:false,rooms:[room()]},200],[{ok:true,rooms:{}},200],[{ok:true,rooms:[room('7203')]},200],[{ok:true,rooms:[{...room(),category:'stock:7203'}]},200],[{ok:true,rooms:[{...room(),code:1832}]},200],[{ok:true,rooms:[room('1832',' ')]},200]]){
    const h=harness();let released=0;const opening=h.api.openForCompany('1832.JP',{beforeOpen(){released++;}});await h.response(data,{status});assert.equal(await opening,false);assert.equal(released,0);assert.equal(h.opens.length,0);assert.equal(h.timers.size,0);
  }
});
test('fetch and JSON failures return false without opening or leaking a timer',async()=>{
  const h=harness(),opening=h.api.openForCompany('1832.JP');h.reads[0].reject(Error('fixture transport failure'));assert.equal(await opening,false);assert.equal(h.opens.length,0);assert.equal(h.timers.size,0);
  const j=harness(),badJson=j.api.openForCompany('1832.JP');j.reads[0].resolve({ok:true,json:async()=>{throw Error('fixture invalid JSON');}});assert.equal(await badJson,false);assert.equal(j.opens.length,0);assert.equal(j.timers.size,0);
});
test('late validation cannot close a different company and beforeOpen may cancel or throw',async()=>{
  for(const options of [{isCurrent:()=>false,beforeOpen(){throw Error('must not release');}},{beforeOpen:()=>false},{isCurrent(){throw Error('fixture expired');}},{beforeOpen(){throw Error('fixture release failure');}}]){
    const h=harness(),opening=h.api.openForCompany('1832.JP',options);await h.response({ok:true,rooms:[room()]});assert.equal(await opening,false);assert.equal(h.opens.length,0);
  }
});
test('beforeOpen may invalidate the company modal token without a second isCurrent call',async()=>{
  const h=harness();let current=true,checks=0;const opening=h.api.openForCompany('1832.JP',{isCurrent(){checks++;return current;},beforeOpen(){current=false;return true;}});
  await h.response({ok:true,rooms:[room()]});assert.equal(await opening,true);assert.equal(checks,1);assert.equal(h.opens.length,1);
});
test('close, ordinary open and cancelPending invalidate a verification even if its fetch ignores abort',async()=>{
  for(const action of ['close','open','cancelPending']){
    const h=harness();let released=0;const opening=h.api.openForCompany('1832.JP',{beforeOpen(){released++;}});h.api[action]();assert.equal(h.reads[0].options.signal.aborted,true);assert.equal(await opening,false);assert.equal(h.timers.size,0);
    await h.response({ok:true,rooms:[room()]});assert.equal(released,0);assert.equal(h.opens.filter(value=>value.room).length,0);if(action==='cancelPending')assert.equal(h.events.length,0);
  }
});
test('a newer company request wins and an older exact-room response cannot replace it',async()=>{
  const h=harness(),first=h.api.openForCompany('1832.JP'),second=h.api.openForCompany('6758.T');assert.equal(await first,false);assert.equal(h.reads[0].options.signal.aborted,true);
  await h.response({ok:true,rooms:[room('6758','ソニー')]},{index:1});assert.equal(await second,true);await h.response({ok:true,rooms:[room()]},{index:0});assert.equal(h.opens.length,1);assert.equal(h.opens[0].room.code,'6758');
});
test('the 12-second deadline settles a fetch or JSON body that ignores abort',async()=>{
  for(const pendingJson of [false,true]){
    const h=harness(),opening=h.api.openForCompany('1832.JP');if(pendingJson){h.reads[0].resolve({ok:true,json:()=>new Promise(()=>{})});await h.settle();}
    assert.equal(h.timers.size,1);const timeout=[...h.timers.values()][0];assert.equal(timeout.ms,12000);timeout.fn();assert.equal(await opening,false);assert.equal(h.reads[0].options.signal.aborted,true);assert.equal(h.opens.length,0);assert.equal(h.timers.size,0);
  }
});
test('cancelPending during beforeOpen prevents a stale room from being mounted',async()=>{
  const h=harness(),opening=h.api.openForCompany('1832.JP',{beforeOpen(){h.api.cancelPending();return true;}});await h.response({ok:true,rooms:[room()]});assert.equal(await opening,false);assert.equal(h.opens.length,0);
});

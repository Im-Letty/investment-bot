'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const start=html.indexOf('/* KN_TALK_TABS:');
assert.ok(start>=0);
const source=html.slice(start,html.indexOf('</script>',start));
function harness({active=false,last,stock=true,community=true}={}) {
  const events=[],calls=[],morning={scrollTop:347},listeners=[];
  const window={knTalkLastView:last,closeSaved(){events.push('close-saved');}};
  if(stock)window.openStockTalk=origin=>{events.push('stock');calls.push({view:'stock',origin});};
  if(community)window.openCommunity=origin=>{events.push('community');calls.push({view:'community',origin});};
  const document={addEventListener(name,fn,capture){listeners.push({name,fn,capture});},getElementById(id){return id==='morning-section'?morning:null;},querySelector(selector){
    if(selector==='#cmOv.cw-screen,#stockTalkOv.cw-screen')return active?{}:null;
    if(selector==='#knBottomNav [data-act="talk"]')return{click(){events.push('legacy-cleanup');morning.scrollTop=0;}};
    return null;
  }};
  vm.runInNewContext(source,{window,document});
  function navigate(act){listeners.filter(listener=>listener.name==='click').forEach(listener=>listener.fn({target:{closest:()=>act?{getAttribute:()=>act}:null}}));}
  return {window,events,calls,morning,navigate,listeners};
}
test('first Talk entry uses existing screen cleanup before opening stock and preserves original reading position',()=>{
  const h=harness();h.window.openTalk();assert.deepEqual(h.events,['legacy-cleanup','close-saved','stock']);assert.equal(h.calls[0].origin.morningTop,347);assert.equal(h.morning.scrollTop,0);
});
test('Talk entry returns to the last community view after cleanup',()=>{
  const h=harness({last:'community'});h.window.openTalk();assert.deepEqual(h.events,['legacy-cleanup','close-saved','community']);assert.equal(h.calls[0].origin.morningTop,347);
});
test('re-entering an active conversation avoids legacy navigation and does not overwrite its origin or drafts',()=>{
  const h=harness({active:true,last:'community'});h.window.openTalk();assert.deepEqual(h.events,['close-saved','community']);assert.equal(h.calls[0].origin,undefined);assert.equal(h.morning.scrollTop,347);
});
test('unavailable stock view falls back to the ready community route',()=>{
  const h=harness({stock:false});h.window.openTalk();assert.deepEqual(h.events,['legacy-cleanup','close-saved','community']);assert.equal(h.calls[0].origin.morningTop,347);
});
test('unavailable conversation modules leave the existing Talk entrance usable with one navigation click',()=>{
  const h=harness({stock:false,community:false});h.window.openTalk();assert.deepEqual(h.events,['legacy-cleanup','close-saved']);assert.equal(h.calls.length,0);
});
test('bottom navigation away from Talk closes both factories through their draft and request cleanup',()=>{
  const h=harness({active:true});h.window.KNStockTalk={close(){h.events.push('close-stock');}};h.window.KNCommunity={close(){h.events.push('close-community');}};
  assert.equal(h.listeners[0].capture,true);h.navigate('morning');assert.deepEqual(h.events,['close-stock','close-community']);
  h.events.length=0;h.navigate('home');assert.deepEqual(h.events,['close-stock','close-community']);
});
test('Talk navigation and unrelated clicks do not discard the active conversation',()=>{
  const h=harness({active:true});h.window.KNStockTalk={close(){h.events.push('close-stock');}};h.window.KNCommunity={close(){h.events.push('close-community');}};
  h.navigate('talk');h.navigate(null);assert.deepEqual(h.events,[]);
});

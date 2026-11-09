'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../static/guest-access.js'),'utf8');
function app(session,signIn,{search='',getSession,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let calls=0,events=0;const w={sb:{auth:{getSession:getSession||(async()=>({data:{session}})),signInAnonymously:async()=>{calls++;return signIn();}}}};
 const ctx={window:w,location:{search},URLSearchParams,document:{documentElement:{setAttribute(){}},dispatchEvent(){events++;}},Event:class{},setTimeout:setTimer,clearTimeout:clearTimer,Date};vm.runInNewContext(source,ctx);
 return {w,calls:()=>calls,events:()=>events};
}
test('existing member session is kept without creating a guest',async()=>{
 const session={user:{id:'member'},access_token:'member-token'},a=app(session,()=>{throw Error('must not create');});
 assert.equal(await a.w.knEnsureGuest(),session);assert.equal(a.calls(),0);assert.equal(a.w.knUser.id,'member');
});
test('concurrent guest requests create one identity and retain the same session',async()=>{
 const session={user:{id:'guest',is_anonymous:true},access_token:'guest-token'},a=app(null,()=>({data:{session}}));
 const first=a.w.knEnsureGuest(),second=a.w.knEnsureGuest();assert.equal(first,second);
 assert.equal(await first,session);assert.equal(a.calls(),1);assert.equal(a.w.knUser.id,'guest');assert.equal(a.events(),1);
});
test('failed guest creation does not invent an owner and permits a later retry',async()=>{
 let fail=true;const a=app(null,()=>fail?{error:{message:'unavailable'}}:{data:{session:{user:{id:'recovered'},access_token:'token'}}});
 await assert.rejects(a.w.knEnsureGuest());assert.equal(a.w.knUser,undefined);fail=false;
 assert.equal((await a.w.knEnsureGuest()).user.id,'recovered');assert.equal(a.calls(),2);
});

function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
test('explicit logout entry does not create or restore an automatic guest',async()=>{
 for(const session of [null,{user:{id:'member'}}]){
  let reads=0;const a=app(session,()=>{throw Error('must not create');},{search:'?entry=logout',getSession:async()=>{reads++;return {data:{session}};}});
  assert.equal(a.w.KN_REGISTRATION_REQUIRED,false);assert.equal(a.w.knEntryChoiceRequired,true);
  await assert.rejects(a.w.knEnsureGuest(),/entry_choice_required/);assert.equal(a.calls(),0);assert.equal(reads,0);assert.equal(a.events(),0);
 }
});
test('logout invalidates a session restore before it can start anonymous authentication',async()=>{
 const result=deferred(),a=app(null,()=>{throw Error('must not create');},{getSession:()=>result.promise});
 const guest=a.w.knEnsureGuest();await Promise.resolve();await Promise.resolve();
 const paused=a.w.knPrepareLogout();result.resolve({data:{session:null}});
 await assert.rejects(guest,/guest_request_cancelled/);await paused;assert.equal(a.calls(),0);assert.equal(a.w.knUser,undefined);assert.equal(a.events(),0);
});
test('logout waits for an already sent anonymous request without publishing its stale user',async()=>{
 const result=deferred(),a=app(null,()=>result.promise);const guest=a.w.knEnsureGuest();
 await new Promise(setImmediate);assert.equal(a.calls(),1);
 let settled=false;const paused=a.w.knPrepareLogout().then(()=>{settled=true;});await Promise.resolve();assert.equal(settled,false);
 result.resolve({data:{session:{user:{id:'old-guest',is_anonymous:true}}}});
 await assert.rejects(guest,/guest_request_cancelled/);await paused;assert.equal(settled,true);assert.equal(a.w.knUser,undefined);assert.equal(a.events(),0);
 a.w.knEntryChoiceRequired=false;assert.equal((await a.w.knEnsureGuest()).user.id,'old-guest','deliberate guest retry remains available');
});
test('a stalled guest restore times out logout preparation without bypassing the pending authentication',async()=>{
 const result=deferred(),timers=new Map();let id=0;
 const a=app(null,()=>{throw Error('must not create');},{getSession:()=>result.promise,setTimer(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimer:key=>timers.delete(key)});
 const guest=a.w.knEnsureGuest();await new Promise(setImmediate);const paused=a.w.knPrepareLogout();
 const timeout=[...timers.values()].find(t=>t.ms===12000);assert.ok(timeout);timeout.fn();await assert.rejects(paused,/logout_pending_timeout/);assert.equal(a.calls(),0);assert.equal(a.w.knUser,undefined);
 result.resolve({data:{session:null}});await assert.rejects(guest,/guest_request_cancelled/);assert.equal(a.calls(),0);assert.equal(a.events(),0);
 a.w.knEntryChoiceRequired=false;assert.equal((await a.w.knEnsureGuest().catch(e=>e)).message,'must not create','a deliberate retry does not remain blocked by a stale promise');
});

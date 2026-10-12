'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../static/guest-access.js'),'utf8');
function app(session,signIn){
 let calls=0,events=0;const w={sb:{auth:{getSession:async()=>({data:{session}}),signInAnonymously:async()=>{calls++;return signIn();}}}};
 const ctx={window:w,document:{documentElement:{setAttribute(){}},dispatchEvent(){events++;}},Event:class{},setTimeout,Date};vm.runInNewContext(source,ctx);
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

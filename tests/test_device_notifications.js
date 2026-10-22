"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const notifications=require("../static/device-notifications.js");
const ALICE="11111111-1111-4111-8111-111111111111",BOB="33333333-3333-4333-8333-333333333333";
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.attributes={};this.disabled=false;this._value="";}
 appendChild(child){this.children.push(child);return child;}
 replaceChildren(){this.children=[];this._value="";}
 setAttribute(key,value){this.attributes[key]=value;}
 addEventListener(key,fn){this.listeners[key]=fn;}
 get options(){return this.children.filter(x=>x.tagName==="option");}
 get value(){return this._value||(this.tagName==="select"&&this.options[0]?.value)||"";}
 set value(value){this._value=value;}
}
function client({enabled=false}={}){
 const events={},calls=[],root=new Element("section"),tasks=[{id:"task-1",text:"private task stays local",done:false}];
 let bound=ALICE,sub=null,permissionCalls=0,marked=[];
 const worker={postMessage(data,ports){queueMicrotask(()=>{if(data.kind==="notification-owner")bound=data.owner_id;ports[0].postMessage({ok:true,owner_id:bound});});}};
 const registration={active:worker,pushManager:{getSubscription:async()=>sub,subscribe:async()=>sub={endpoint:"https://fcm.googleapis.com/fcm/send/fixture",toJSON(){return {endpoint:this.endpoint,keys:{p256dh:"fixture",auth:"fixture"},expirationTime:null};},async unsubscribe(){sub=null;return true;}}}};
 const w={document:{readyState:"loading",createElement:tag=>new Element(tag),getElementById:()=>null,addEventListener:(name,fn)=>events[name]=fn},
  knUser:{id:ALICE,is_anonymous:false},sb:{auth:{getSession:async()=>({data:{session:{access_token:"alice-fixture",user:{id:w.knUser.id,is_anonymous:false}}}})}},
  fetch:async(path,options)=>{calls.push([path,options]);let value=path.endsWith("/config")?{ok:true,enabled,public_key:"BA"}:path.endsWith("/status")?{ok:true,reminders:[],subscription_count:1}:{ok:true,revision:1};return {ok:true,json:async()=>value};},
  navigator:{userAgent:"fixture browser",serviceWorker:{getRegistration:async()=>registration,register:async()=>registration}},isSecureContext:true,PushManager:function(){},
  Notification:{requestPermission(){permissionCalls++;return Promise.resolve("granted");}},Intl,
  atob:value=>Buffer.from(value,"base64").toString("binary"),setTimeout,clearTimeout,
  MessageChannel:class{constructor(){this.port1={close(){}};this.port2={postMessage:data=>queueMicrotask(()=>this.port1.onmessage?.({data}))};}}
 };
 const api=notifications.create(w);
 function attach(){api.attachPlanner({root,getTodos:()=>tasks,canEdit:()=>true,markScheduled:(id,value)=>marked.push([id,value])});}
 const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
 const button=text=>descendants(root).find(x=>x.tagName==="button"&&x.textContent===text);
 return {api,w,events,calls,root,tasks,attach,descendants,button,get permissionCalls(){return permissionCalls;},get bound(){return bound;},get marked(){return marked;}};
}
test("notification local datetime rejects impossible dates, nonexistent time and missing zone-independent shape",()=>{
 const valid="2028-02-29T09:30";assert.equal(notifications.dateTime(valid),new Date(valid).toISOString());
 for(const invalid of ["","2026-02-30T09:30","2026-13-01T12:00","2026-10-22","2026-10-22T24:01","2026-10-22T12:30Z"])assert.throws(()=>notifications.dateTime(invalid));
});
test("no permission request or subscription is made by render, and unconfigured notification controls remain disabled",async()=>{
 const c=client();c.attach();await flush();
 assert.equal(c.permissionCalls,0);assert.equal(c.button("この端末で通知を使う").disabled,true);
 assert.equal(c.calls.filter(([path])=>!path.endsWith("/config")).length,0);
 assert.equal(c.bound,ALICE,"same-owner reload keeps its existing Worker binding");
});
test("activation requests permission from the button and stores only subscription keys, never task text or expiration metadata",async()=>{
 const c=client({enabled:true});c.attach();await flush();assert.equal(c.permissionCalls,0);
 const promise=c.button("この端末で通知を使う").listeners.click();assert.equal(c.permissionCalls,1);await promise;
 const call=c.calls.find(([path,options])=>path.endsWith("/subscriptions")&&options.method==="POST");
 assert.ok(call);const body=JSON.parse(call[1].body);assert.deepEqual(Object.keys(body).sort(),["endpoint","keys"]);
 assert.equal(JSON.stringify(body).includes("private task"),false);assert.equal(c.bound,ALICE);
});
test("a session resolved after account change cannot authenticate an old-owner cancellation",async()=>{
 const c=client();await c.api.refresh();const wait=deferred();c.w.sb.auth.getSession=()=>wait.promise;
 const call=c.api.cancelTodo("task-1");await flush();c.w.knUser={id:BOB,is_anonymous:false};c.events.knAuthChange();
 wait.resolve({data:{session:{access_token:"old-alice",user:{id:ALICE,is_anonymous:false}}}});
 await assert.rejects(call,/account_changed/);assert.equal(c.calls.filter(([path])=>path.includes("/reminders/")).length,0);
 await flush();assert.equal(c.bound,"","switching accounts clears the old Worker owner");
});
test("late cancellation response after signout is rejected and not reported as saved",async()=>{
 const c=client();await c.api.refresh();const wait=deferred();
 c.w.fetch=(path,options)=>{c.calls.push([path,options]);return wait.promise;};
 const call=c.api.cancelTodo("task-1");await flush();c.w.knUser=null;c.events.knAuthChange();
 wait.resolve({ok:true,json:async()=>({ok:true})});await assert.rejects(call,/account_changed/);
});
test("same-account auth refresh does not revoke the Worker owner or ask for notification permission",async()=>{
 const c=client();await c.api.refresh();c.events.knAuthChange();await flush();
 assert.equal(c.bound,ALICE);assert.equal(c.permissionCalls,0);
});

function pushWorker(){
 const handlers={},values=new Map(),shown=[],opened=[];
 function database(){
  return {createObjectStore(){},close(){},transaction(){
   let pending=0,scheduled=false;const tx={};
   const finish=()=>{if(pending===0&&!scheduled){scheduled=true;setImmediate(()=>{scheduled=false;if(pending===0)tx.oncomplete?.();});}};
   const store={put(value,key){values.set(key,value);finish();},get(key){const request={};pending++;queueMicrotask(()=>{request.result=values.get(key);request.onsuccess?.();pending--;finish();});return request;}};
   tx.objectStore=()=>store;finish();return tx;
  }};
 }
 const context={self:{location:{origin:"https://site.invalid"},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{},registration:{showNotification:async(title,data)=>shown.push({title,...data})},clients:{openWindow:async url=>opened.push(url)}},
  indexedDB:{open(){const request={};queueMicrotask(()=>{request.result=database();request.onupgradeneeded?.();request.onsuccess?.();});return request;}},URL,Promise};
 vm.runInNewContext(fs.readFileSync(require.resolve("../static/notifications-worker.js"),"utf8"),context);
 async function event(type,data){let promise;handlers[type]({...data,waitUntil:p=>promise=p});if(promise)await promise;}
 async function bind(owner,origin="https://site.invalid"){
  const ack=[];await event("message",{source:{url:origin+"/"},data:{kind:"notification-owner",owner_id:owner},ports:[{postMessage:value=>ack.push(value)}]});return ack;
 }
 return {handlers,values,shown,opened,event,bind};
}
const payload={kind:"todo",owner_id:ALICE,task_id:"task-1",id:"55555555-5555-4555-8555-555555555555",occurrence_id:"66666666-6666-4666-8666-666666666666"};
test("push worker persists owner before acknowledging and suppresses duplicate IDs",async()=>{
 const w=pushWorker();assert.equal(w.handlers.fetch,undefined);assert.equal(JSON.stringify(await w.bind(ALICE)),JSON.stringify([{ok:true}]));
 await w.event("push",{data:{json:()=>payload}});await w.event("push",{data:{json:()=>payload}});
 assert.equal(w.shown.length,1);assert.equal(w.shown[0].title,"やることリストの確認");assert.equal(w.shown[0].body.includes("private"),false);
});
test("push worker drops old-owner, corrupt JSON and foreign-origin owner changes",async()=>{
 const w=pushWorker();await w.bind(ALICE);await w.bind(BOB,"https://foreign.invalid");
 await w.event("push",{data:{json:()=>({...payload,owner_id:BOB})}});
 await w.event("push",{data:{json:()=>{throw Error("untrusted");}}});
 assert.equal(w.shown.length,0);assert.equal(w.values.get("owner"),ALICE);
 await w.bind("");await w.event("push",{data:{json:()=>payload}});assert.equal(w.shown.length,0);
});
test("notification clicks always use a fixed same-origin app destination",async()=>{
 const w=pushWorker();let closed=false;await w.event("notificationclick",{notification:{data:{url:"https://foreign.invalid"},close(){closed=true;}}});
 assert.equal(closed,true);assert.deepEqual(w.opened,["/#todo-reminders"]);
});

test("completion cancellation checks the server even when another tab's reminder marker has not synced",async()=>{
 const c=client({enabled:true});await c.api.refresh();await c.api.cancelForTodo("task-1",false);
 assert.equal(c.calls.filter(([path,options])=>path.endsWith("/reminders/task-1")&&options.method==="DELETE").length,1);
 const off=client();await off.api.refresh();await off.api.cancelForTodo("task-1",false);
 assert.equal(off.calls.filter(([path])=>path.includes("/reminders/")).length,0);
});

test("guest ordinary todo completion is independent of notification eligibility and permissions",async()=>{
 const c=client({enabled:true});c.w.knUser={id:ALICE,is_anonymous:true};await c.api.refresh();
 await c.api.cancelForTodo("guest-task",false);
 assert.equal(c.calls.filter(([path])=>path.includes("/reminders/")).length,0);
 await assert.rejects(c.api.cancelForTodo("guest-task",true),/auth_required/);
});
test("account switch during notification activation releases the new owner's busy controls",async()=>{
 const c=client({enabled:true});c.attach();await flush();const wait=deferred();
 c.w.Notification.requestPermission=()=>wait.promise;
 const pending=c.button("この端末で通知を使う").listeners.click();
 c.w.knUser={id:BOB,is_anonymous:false};c.events.knAuthChange();await flush();
 assert.equal(c.button("この端末で通知を使う").disabled,false);
 wait.resolve("granted");await pending;
 assert.equal(c.button("この端末で通知を使う").disabled,false);
});
test("completion cancellation is queued after an in-flight schedule PUT",async()=>{
 const c=client({enabled:true});c.attach();await flush();
 c.descendants(c.root).find(x=>x.tagName==="input").value="2028-02-29T10:30";
 const wait=deferred(),original=c.w.fetch;
 c.w.fetch=(path,options)=>{
   if(path.includes("/reminders/")&&options.method==="PUT"){c.calls.push([path,options]);return wait.promise;}
   return original(path,options);
 };
 const schedule=c.button("通知日時を保存").listeners.click();await flush();
 const cancel=c.api.cancelForTodo("task-1",false);await flush();
 assert.equal(c.calls.filter(([path,options])=>path.includes("/reminders/")&&options.method==="DELETE").length,0);
 wait.resolve({ok:true,json:async()=>({ok:true,revision:1})});await schedule;await cancel;
 assert.deepEqual(c.calls.filter(([path])=>path.includes("/reminders/")).map(([,options])=>options.method),["PUT","DELETE"]);
});
test("a task removed while schedule response is pending gets compensating cancellation, never a saved marker",async()=>{
 const c=client({enabled:true});c.attach();await flush();
 c.descendants(c.root).find(x=>x.tagName==="input").value="2028-02-29T10:30";
 const wait=deferred(),original=c.w.fetch;
 c.w.fetch=(path,options)=>{if(path.includes("/reminders/")&&options.method==="PUT"){c.calls.push([path,options]);return wait.promise;}return original(path,options);};
 const schedule=c.button("通知日時を保存").listeners.click();await flush();c.tasks.length=0;
 wait.resolve({ok:true,json:async()=>({ok:true,revision:1})});await schedule;
 assert.deepEqual(c.marked,[]);
 assert.deepEqual(c.calls.filter(([path])=>path.includes("/reminders/")).map(([,options])=>options.method),["PUT","DELETE"]);
});
test("replacing the same device subscription deletes its own old server endpoint first",async()=>{
 const c=client({enabled:true});c.attach();await flush();await c.button("この端末で通知を使う").listeners.click();
 c.calls.length=0;await c.button("この端末で通知を使う").listeners.click();
 assert.deepEqual(c.calls.filter(([path])=>path.endsWith("/subscriptions")).map(([,options])=>options.method),["DELETE","POST"]);
});

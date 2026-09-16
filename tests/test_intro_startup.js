'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const start=html.indexOf('function startApprovedIntro(){');
const end=html.indexOf("document.addEventListener('DOMContentLoaded',startApprovedIntro,{once:true});",start);
const controller=html.slice(start,end);
function harness({reduced=false,prepareThrows=false,startThrows=false}={}){
  let clock=0,seq=0,starts=0,prepares=0,events=0;
  const timers=new Map(),listeners={};
  function element(){const classes=new Set();return {classes,inert:false,classList:{add:name=>classes.add(name)}};}
  const splash=element(),lp=element(),intro={startIntro(){starts++;if(startThrows)throw Error('canvas unavailable');}};
  const document={hidden:false,getElementById:id=>id==='spl'?splash:id==='news-pastel-palettes'?intro:null,
    addEventListener:(name,fn)=>listeners['doc:'+name]=fn,removeEventListener:name=>delete listeners['doc:'+name],
    dispatchEvent(event){if(event.type==='knIntroComplete')events++;}};
  class ClockDate extends Date{static now(){return clock;}}
  const context={document,lpEl:lp,Date:ClockDate,Event:class{constructor(type){this.type=type;}},matchMedia:()=>({matches:reduced}),
    setTimeout(fn,ms){const id=++seq;timers.set(id,{fn,at:clock+ms});return id;},clearTimeout:id=>timers.delete(id),
    addEventListener:(name,fn)=>listeners['window:'+name]=fn,removeEventListener:name=>delete listeners['window:'+name],
    knPrepareWelcome(){prepares++;if(prepareThrows)throw Error('welcome canvas unavailable');}};
  context.window=context;vm.runInNewContext(controller,context);context.startApprovedIntro();
  function advance(ms,run=true){clock+=ms;if(run){let due;while((due=[...timers].find(([,t])=>t.at<=clock))){timers.delete(due[0]);due[1].fn();}}}
  return {context,document,splash,lp,timers,listeners,advance,events:()=>events,starts:()=>starts,prepares:()=>prepares,
    fire(name){if(listeners[name])listeners[name]();}};
}
test('intro exits after three seconds even without animation frames or mutation observers',()=>{
  const app=harness();assert.equal(app.starts(),1);assert.equal(app.lp.inert,true);
  app.advance(2999);assert.equal(app.events(),0);assert.ok(!app.lp.classes.has('show'));
  app.advance(1);assert.equal(app.events(),1);assert.equal(app.lp.inert,false);assert.ok(app.lp.classes.has('show'));
  assert.ok(app.splash.classes.has('leaving'));assert.ok(!app.splash.classes.has('done'));
  app.advance(699);assert.ok(!app.splash.classes.has('done'));
  app.advance(1);assert.ok(app.splash.classes.has('done'));assert.equal(app.timers.size,0);assert.equal(Object.keys(app.listeners).length,0);
});
test('welcome preparation and animation initialization errors cannot strand the splash',()=>{
  for(const options of [{prepareThrows:true},{startThrows:true},{prepareThrows:true,startThrows:true}]){
    const app=harness(options);app.advance(3000);assert.equal(app.events(),1);app.advance(700);assert.ok(app.splash.classes.has('done'));
  }
});
test('reduced motion retains the approved three-second hold and skips the exit fade',()=>{
  const app=harness({reduced:true});app.advance(2999);assert.equal(app.events(),0);
  app.advance(1);assert.ok(app.splash.classes.has('done'));assert.equal(app.events(),1);
});
test('returning from a suspended tab finishes despite timers and frames not running',()=>{
  const app=harness();app.document.hidden=true;app.advance(45000,false);
  app.fire('doc:visibilitychange');assert.equal(app.events(),0);
  app.document.hidden=false;app.fire('doc:visibilitychange');assert.equal(app.events(),1);assert.ok(app.splash.classes.has('leaving'));
  app.advance(700);assert.ok(app.splash.classes.has('done'));assert.equal(app.events(),1);
});
test('page restore clears an interrupted exit and does not restart the intro',()=>{
  const app=harness();app.advance(3000);app.advance(60000,false);app.fire('window:pageshow');
  assert.ok(app.splash.classes.has('done'));assert.equal(app.events(),1);app.context.startApprovedIntro();assert.equal(app.starts(),1);
});
test('duplicate startup requests do not reset the deadline or complete twice',()=>{
  const app=harness();app.advance(1500);app.context.startApprovedIntro();app.advance(1500);
  assert.equal(app.starts(),1);assert.equal(app.prepares(),1);assert.equal(app.events(),1);
  app.fire('window:pageshow');assert.equal(app.events(),1);
});

function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
async function flush(){for(let i=0;i<20;i++)await Promise.resolve();}
function legacyHarness(){
  const module=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const imports=[],alerts=[],timers=new Map(),storage=new Map([['lineUserId','existing-user']]);let seq=0,authCalls=0,reloads=0;
  const context={Promise,Error,console,document:{getElementById:()=>null},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    loadSDK(){const task=deferred();imports.push(task);return task.promise;},
    setTimeout(fn,ms){const id=++seq;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    alert:message=>alerts.push(message),fetch:async()=>({ok:true,json:async()=>({verified:true})}),location:{reload(){reloads++;}},__faLoginOpts:{challenge:'prepared'}};
  context.window=context;
  vm.runInNewContext(module.replace('import("https://esm.sh/@simplewebauthn/browser@9.0.1")','loadSDK()')+'\nwindow.testLoadSDK=loadLegacyPasskeySDK;',context);
  const sdk={startAuthentication:async()=>{authCalls++;return {id:'saved-credential'};}};
  return {context,imports,alerts,timers,sdk,authCalls:()=>authCalls,reloads:()=>reloads};
}
test('legacy auth definitions make no startup SDK request and load only on use',async()=>{
  const app=legacyHarness();assert.equal(app.imports.length,0);assert.equal(app.timers.size,0);
  const login=app.context.knFaceLogin();await flush();assert.equal(app.imports.length,1);
  app.imports[0].resolve(app.sdk);await login;assert.equal(app.authCalls(),1);assert.equal(app.reloads(),1);assert.equal(app.timers.size,0);
  assert.equal(app.context.__faInProgress,false);
});
test('slow legacy SDK times out, releases the login lock and supports a clean retry',async()=>{
  const app=legacyHarness();const first=app.context.knFaceLogin();await flush();
  const [id,timer]=[...app.timers][0];assert.equal(timer.ms,12000);app.timers.delete(id);timer.fn();await first;
  assert.equal(app.context.__faInProgress,false);assert.equal(app.authCalls(),0);assert.match(app.alerts[0],/もう一度お試しください/);
  app.context.__faLoginOpts={challenge:'fresh'};const retry=app.context.knFaceLogin();await flush();assert.equal(app.imports.length,2);
  app.imports[0].resolve(app.sdk);await flush();assert.equal(app.authCalls(),0,'Timed-out SDK response must not resume the previous attempt');
  app.imports[1].resolve(app.sdk);await retry;assert.equal(app.authCalls(),1);assert.equal(app.reloads(),1);
});
test('legacy SDK failures are retryable and concurrent loaders share the same request',async()=>{
  const app=legacyHarness();const one=app.context.testLoadSDK(),two=app.context.testLoadSDK();assert.equal(one,two);assert.equal(app.imports.length,1);
  app.imports[0].reject(Error('offline'));await assert.rejects(one,/offline/);assert.equal(app.timers.size,0);
  const next=app.context.testLoadSDK();assert.equal(app.imports.length,2);app.imports[1].resolve(app.sdk);assert.equal(await next,app.sdk);
});
test('an old successful login cannot unlock the app after a new SDK timeout',async()=>{
  const app=legacyHarness(),button={};let unlocks=0;
  app.context.localStorage.setItem('faceIdVerifiedAt','1600000000000');
  app.context.document.getElementById=id=>id==='alFace'?button:null;
  app.context.unlock=()=>unlocks++;
  const begin=html.indexOf("document.getElementById('alFace').onclick=");
  const finish=html.indexOf("document.getElementById('alLine').onclick=",begin);
  vm.runInNewContext(html.slice(begin,finish),app.context);
  const click=button.onclick();await flush();
  const [id,timer]=[...app.timers][0];app.timers.delete(id);timer.fn();await click;
  assert.equal(unlocks,0,'Saved verification history must not count as current authentication');
  app.context.__faLoginOpts={challenge:'retry'};const retry=button.onclick();await flush();app.imports[1].resolve(app.sdk);await retry;
  assert.equal(unlocks,1,'Only a successful current authentication unlocks the app');
});
test('external fonts and auth SDK are not blocking startup dependencies',()=>{
  const font=html.match(/<link\b[^>]*href="https:\/\/fonts\.googleapis\.com\/css2[^>]*>/)[0];
  assert.match(font,/media="print"/);assert.match(font,/onload="this\.media='all'"/);
  const modules=[...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
  assert.ok(modules.length>0);modules.forEach(m=>assert.doesNotMatch(m[1],/\bimport\s+(?:\{|[\w*])/));
});

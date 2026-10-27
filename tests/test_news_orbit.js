'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../static/news-orbit.js'),'utf8');
function harness(reduced=false,savedPause=false,options,withGuide=true,pictures=[]){
  const storage=new Map(savedPause?[['kn_home_motion_paused','1']]:[]);let resets=0;
  const classes=new Set(pictures.length?['kn-orbit-art-pending']:[]),events={},buttonEvents={},guideEvents={},attrs={},guideAttrs={},sceneAttrs={};let mediaCallback,intersectionCallback,observations=0,guideCalls=0,networkCalls=0;
  let now=0,timerId=0;const timers=new Map();
  function setTimer(fn,delay){const id=++timerId;timers.set(id,{fn,at:now+delay});return id;}
  function advance(ms){const target=now+ms;for(;;){const due=[...timers].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();}now=target;}
  function control(listeners={},attributes={}){const names=new Set();return{names,attributes,classList:{toggle(name,value){if(value)names.add(name);else names.delete(name);}},addEventListener(name,fn){(listeners[name]||=[]).push(fn);},setAttribute(name,value){attributes[name]=value;},fire(name,event={}){(listeners[name]||[]).forEach(fn=>fn(event));}};}
  const guide=control(guideEvents,guideAttrs),graph=control(),news=control();
  const root={dataset:{},querySelectorAll(){return pictures;},classList:{toggle(name,value){if(value)classes.add(name);else classes.delete(name);}},querySelector(selector){return selector==='.kn-orbit-scene'?scene:selector==='.kn-orbit-guide'&&withGuide?guide:selector==='.kn-orbit-rank-shortcut'?graph:selector==='.kn-orbit-news-shortcut'?news:null;}};
  const button={addEventListener(name,fn){(buttonEvents[name]||=[]).push(fn);},setAttribute(name,value){attrs[name]=value;}};
  const scene={setAttribute(name,value){sceneAttrs[name]=value;}};
  const preference={matches:reduced,addEventListener(name,fn){mediaCallback=fn;}};
  const document={hidden:false,documentElement:{lang:'ja'},getElementById(id){return id==='knHomeOrbitMotion'?button:null;},querySelector(){return null;},addEventListener(name,fn){(events[name]||=[]).push(fn);}};
  function unexpectedNetwork(){networkCalls++;throw new Error('Orbit guide must not request AI/chat/network');}
  const context={window:{matchMedia:()=>preference,dsReset(){resets++;},openBeginnerGuide(){guideCalls++;},setTimeout:setTimer,clearTimeout:id=>timers.delete(id),fetch:unexpectedNetwork},fetch:unexpectedNetwork,document,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},IntersectionObserver:class{constructor(cb){intersectionCallback=cb;}observe(){observations++;}}};
  context.window.IntersectionObserver=context.IntersectionObserver;
  vm.runInNewContext(source,context);
  const host={querySelector(){return root;}};
  context.window.KNNewsOrbit.mount(host,options);
  return {classes,attrs,guideAttrs,sceneAttrs,document,host,root,context,storage,controls:{guide,graph,news},advance,pendingTimers:()=>timers.size,resets:()=>resets,guideCalls:()=>guideCalls,networkCalls:()=>networkCalls,
    click(){(buttonEvents.click||[]).forEach(fn=>fn());},guideClick(){(guideEvents.click||[]).forEach(fn=>fn());},event(name){(events[name]||[]).forEach(fn=>fn());},
    visible(value){intersectionCallback([{target:root,isIntersecting:value}]);},
    preference(value){preference.matches=value;mediaCallback({matches:value});},
    observations(){return observations;},listeners(name){return (events[name]||[]).length;},guideListeners(name){return (guideEvents[name]||[]).length;},motionListeners(name){return (buttonEvents[name]||[]).length;}};
}
test('settings pause remains selected across hidden and offscreen transitions',()=>{
  const a=harness();assert.equal(a.attrs['aria-label'],'動きを止める');
  a.click();assert.ok(a.classes.has('kn-orbit-paused'));assert.equal(a.attrs['aria-pressed'],'true');
  a.visible(false);assert.ok(a.classes.has('kn-orbit-away'));
  a.visible(true);assert.ok(!a.classes.has('kn-orbit-away'));assert.ok(a.classes.has('kn-orbit-paused'));
  a.document.hidden=true;a.event('visibilitychange');assert.ok(a.classes.has('kn-orbit-away'));
  a.document.hidden=false;a.event('visibilitychange');assert.ok(a.classes.has('kn-orbit-paused'));
  a.click();assert.ok(!a.classes.has('kn-orbit-paused'));assert.equal(a.attrs['aria-label'],'動きを止める');
});
test('reduced motion starts static and can be explicitly played',()=>{
  const a=harness(true);assert.ok(a.classes.has('kn-orbit-reduced'));assert.ok(a.classes.has('kn-orbit-paused'));
  assert.equal(a.attrs['aria-label'],'動きを再生');assert.ok(!a.classes.has('kn-orbit-motion-enabled'));
  a.click();assert.ok(!a.classes.has('kn-orbit-reduced'));assert.ok(!a.classes.has('kn-orbit-paused'));assert.ok(a.classes.has('kn-orbit-motion-enabled'));
  a.preference(true);assert.ok(a.classes.has('kn-orbit-reduced'));assert.ok(a.classes.has('kn-orbit-paused'));
});
test('document visibility and viewport visibility must both allow animation',()=>{
  const a=harness();a.visible(false);a.document.hidden=true;a.event('visibilitychange');
  a.visible(true);assert.ok(a.classes.has('kn-orbit-away'));
  a.document.hidden=false;a.event('visibilitychange');assert.ok(!a.classes.has('kn-orbit-away'));
  a.visible(false);a.event('visibilitychange');assert.ok(a.classes.has('kn-orbit-away'));
});
test('repeated mounting does not duplicate listeners and language updates labels',()=>{
  const a=harness();a.context.window.KNNewsOrbit.mount(a.host);
  assert.equal(a.observations(),1);assert.equal(a.listeners('visibilitychange'),1);assert.equal(a.listeners('langChanged'),1);
  a.document.documentElement.lang='en';a.event('langChanged');assert.equal(a.attrs['aria-label'],'Pause animation');assert.match(a.sceneAttrs['aria-label'],/orbit the Earth/);
  a.click();assert.equal(a.attrs['aria-label'],'Play animation');
});

test('settings pause survives a new visit and a motion-preference update',()=>{
  const a=harness();a.click();assert.equal(a.storage.get('kn_home_motion_paused'),'1');
  const b=harness(false,true);assert.ok(b.classes.has('kn-orbit-paused'));
  b.preference(true);b.preference(false);assert.ok(b.classes.has('kn-orbit-paused'));
  b.click();assert.equal(b.storage.get('kn_home_motion_paused'),'0');assert.ok(!b.classes.has('kn-orbit-paused'));
});
test('display reset clears saved pause and retains the system motion preference',()=>{
  const a=harness(false,true);a.context.window.dsReset();assert.equal(a.resets(),1);
  assert.ok(!a.storage.has('kn_home_motion_paused'));assert.ok(!a.classes.has('kn-orbit-paused'));
  a.preference(true);a.context.window.dsReset();assert.equal(a.resets(),2);assert.ok(a.classes.has('kn-orbit-reduced'));assert.ok(a.classes.has('kn-orbit-paused'));
});

// Alternative artwork shares the same motion preferences and language updates.
test('alternative scene descriptions retain pause, reduced-motion and translation behavior',()=>{
  const a=harness(true,false,{descriptions:{ja:'和紙の便り',en:'Paper letters'}},false);
  assert.equal(a.sceneAttrs['aria-label'],'和紙の便り');
  assert.ok(a.classes.has('kn-orbit-reduced'));
  a.click();assert.ok(!a.classes.has('kn-orbit-reduced'));
  a.document.documentElement.lang='en';a.event('langChanged');
  assert.equal(a.sceneAttrs['aria-label'],'Paper letters');
  a.click();assert.ok(a.classes.has('kn-orbit-paused'));
  a.visible(false);a.visible(true);assert.ok(a.classes.has('kn-orbit-paused'));
  a.document.documentElement.lang='unknown';a.event('langChanged');
  assert.equal(a.sceneAttrs['aria-label'],'和紙の便り');
});

test('the coin opens the existing guide without changing motion preferences or requesting chat',()=>{
  const a=harness(false,true);
  const before=[...a.classes].sort(),saved=a.storage.get('kn_home_motion_paused');
  a.guideClick();assert.equal(a.guideCalls(),1);assert.equal(a.networkCalls(),0);
  assert.deepEqual([...a.classes].sort(),before);assert.equal(a.storage.get('kn_home_motion_paused'),saved);
  a.click();assert.equal(a.guideCalls(),1,'Motion toggle must not open the guide');
  assert.ok(!a.classes.has('kn-orbit-paused'));
});

test('repeated mounting binds exactly one guide click handler and one motion handler',()=>{
  const a=harness();a.context.window.KNNewsOrbit.mount(a.host);a.context.window.KNNewsOrbit.mount(a.host);
  assert.equal(a.guideListeners('click'),1);assert.equal(a.motionListeners('click'),1);
  for(const event of ['pointerdown','keydown','pointercancel'])assert.equal(a.guideListeners(event),1);
  a.guideClick();assert.equal(a.guideCalls(),1);assert.equal(a.networkCalls(),0);
  assert.equal(a.observations(),1);assert.equal(a.listeners('langChanged'),1);
});

test('coin markup uses a named native button inside an accessible group',()=>{
  const a=harness();const markup=a.context.window.KNNewsOrbit.markup;
  assert.match(markup,/<div class="kn-orbit-scene" role="group"/);
  assert.doesNotMatch(markup,/<div class="kn-orbit-scene" role="img"/);
  assert.match(markup,/<button type="button" class="kn-orbit-guide" aria-label="ガイド・ロボット相談を開く" aria-controls="bgModal">/);
  const coin=markup.match(/class="kn-orbit-coordinated-coin" src="data:image\/svg\+xml;base64,([^"]+)"[^>]+/);
  assert.ok(coin,'The guide must paint one complete coin, without an asynchronous text/rim swap');
  assert.match(coin[0],/decoding="sync" loading="eager"/);
  const coinSVG=Buffer.from(coin[1],'base64').toString('utf8');
  const originalCoin=coinSVG.match(/href="data:image\/webp;base64,([^"]+)"/);
  assert.ok(originalCoin);
  assert.deepEqual(Buffer.from(originalCoin[1],'base64'),fs.readFileSync(path.join(__dirname,'../static/news-orbit/coin.webp')));
  assert.match(coinSVG,/<text[^>]*>\?<\/text>/);
  assert.doesNotMatch(markup,/kn-orbit-coin-question/);
  assert.equal((markup.match(/class="kn-orbit-news-orbiter /g)||[]).length,3);
  assert.equal((markup.match(/class="kn-orbit-guide"/g)||[]).length,1);
  // Enter/Space activation comes from native button semantics; this VM test does
  // not claim to simulate a browser keyboard or assistive-technology session.
});

test('guide labels translate while the saved pause and system reduced-motion state remain intact',()=>{
  const a=harness(true,true);
  for(const [lang,label] of [['ja','ガイド・ロボット相談を開く'],['en','Open the guide and assistant'],['ko','가이드와 로봇 상담 열기'],['zh','打开指南与机器人咨询'],['unknown','ガイド・ロボット相談を開く']]){
    a.document.documentElement.lang=lang;a.event('langChanged');
    assert.equal(a.guideAttrs['aria-label'],label);
    assert.ok(a.classes.has('kn-orbit-reduced'));assert.ok(a.classes.has('kn-orbit-paused'));
    assert.equal(a.storage.get('kn_home_motion_paused'),'1');
  }
  a.storage.set('app_lang','en');a.document.documentElement.lang='ja';a.event('langChanged');
  assert.equal(a.guideAttrs['aria-label'],'Open the guide and assistant');
  a.guideClick();assert.equal(a.guideCalls(),1);assert.equal(a.networkCalls(),0);
});

test('a late or unavailable guide opener is safe and never falls back to chat',()=>{
  const a=harness();delete a.context.window.openBeginnerGuide;
  assert.doesNotThrow(()=>a.guideClick());assert.equal(a.guideCalls(),0);
  let lateCalls=0;a.context.window.openBeginnerGuide=()=>{lateCalls++;};
  a.guideClick();assert.equal(lateCalls,1);assert.equal(a.networkCalls(),0);
  assert.ok(!a.classes.has('kn-orbit-paused'));
});

test('the coin calls the actual local beginner guide and preserves its checklist',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match=>match[1]);
  const guideScript=scripts.find(script=>script.includes('window.openBeginnerGuide=function()'));
  assert.ok(guideScript,'Use the existing public guide script, not an AI panel');
  let networkCalls=0,writes=0;
  const storage=new Map([['bg_guide_v1','{"s0":true}']]);
  const names=new Set();
  function element(){return{style:{},children:[],appendChild(node){this.children.push(node);},set innerHTML(value){this._html=value;if(value==='')this.children=[];},get innerHTML(){return this._html||'';}};}
  const nodes=Object.fromEntries(['bgResult','bgBtns','bgQ','bgList','bgBar','bgPct','bgTip','bgCta'].map(id=>[id,element()]));
  nodes.bgModal={classList:{add:name=>names.add(name),remove:name=>names.delete(name)}};
  const context={document:{getElementById:id=>nodes[id],createElement:element},
    localStorage:{getItem:key=>storage.get(key)||null,setItem(key,value){writes++;storage.set(key,value);}},
    fetch(){networkCalls++;throw new Error('Local guide must not send a request');}};
  context.window=context;vm.runInNewContext(guideScript,context);
  const a=harness();a.context.window.openBeginnerGuide=context.openBeginnerGuide;
  a.guideClick();assert.ok(names.has('bg-open'));assert.equal(nodes.bgList.children.length,5);
  assert.match(nodes.bgQ.textContent,/収入と支出/);assert.equal(nodes.bgBar.style.width,'20%');
  assert.equal(nodes.bgList.children[0].children[0].checked,true);
  assert.equal(storage.get('bg_guide_v1'),'{"s0":true}');assert.equal(writes,0);
  context.closeBeginnerGuide();assert.ok(!names.has('bg-open'));
  assert.equal(networkCalls,0);assert.equal(a.networkCalls(),0);
});

test('all three native shortcut clicks light immediately and expire without changing motion or saved preferences',()=>{
  const a=harness(true,true),before=[...a.classes].sort(),saved=new Map(a.storage);
  for(const control of Object.values(a.controls)){
    control.fire('click');assert.ok(control.names.has('kn-orbit-tapped'));assert.equal(a.pendingTimers(),1);
    a.advance(479);assert.ok(control.names.has('kn-orbit-tapped'));
    a.advance(1);assert.ok(!control.names.has('kn-orbit-tapped'));assert.equal(a.pendingTimers(),0);
  }
  assert.equal(a.guideCalls(),1,'The guide action runs immediately in its original click handler');
  assert.deepEqual([...a.classes].sort(),before);assert.deepEqual(a.storage,saved);assert.equal(a.networkCalls(),0);
});

test('primary taps renew one bounded feedback timer and cancellation clears it',()=>{
  const a=harness(),control=a.controls.news;
  control.fire('pointerdown',{button:2,isPrimary:true});
  assert.ok(!control.names.has('kn-orbit-tapped'));assert.equal(a.pendingTimers(),0);
  control.fire('pointerdown',{button:0,isPrimary:true});a.advance(300);
  control.fire('pointerdown',{button:0,isPrimary:true});assert.equal(a.pendingTimers(),1);
  a.advance(180);assert.ok(control.names.has('kn-orbit-tapped'),'The earlier timer must not clear the newer tap');
  control.fire('pointercancel');assert.ok(!control.names.has('kn-orbit-tapped'));assert.equal(a.pendingTimers(),0);
  a.advance(1000);assert.ok(!control.names.has('kn-orbit-tapped'));assert.equal(a.guideCalls(),0);assert.equal(a.networkCalls(),0);
});

test('keyboard feedback does not invoke the guide before its native click and repeated keys do not renew it',()=>{
  const a=harness(),control=a.controls.guide;
  for(const key of ['Enter',' ']){
    control.fire('keydown',{key,repeat:false});assert.ok(control.names.has('kn-orbit-tapped'));assert.equal(a.guideCalls(),key==='Enter'?0:1);
    a.advance(300);control.fire('keydown',{key,repeat:true});assert.equal(a.pendingTimers(),1);
    a.advance(180);assert.ok(!control.names.has('kn-orbit-tapped'));
    control.fire('click');assert.ok(control.names.has('kn-orbit-tapped'));a.advance(480);
  }
  control.fire('keydown',{key:'Escape',repeat:false});assert.ok(!control.names.has('kn-orbit-tapped'));
  assert.equal(a.guideCalls(),2);assert.equal(a.networkCalls(),0);assert.equal(a.pendingTimers(),0);
});


test('the first visible scene waits for both inline pictures, then preserves the chosen pause',()=>{
  function picture(complete){const events={};return{complete,addEventListener(name,fn){events[name]=fn;},fire(name){if(events[name])events[name]();}};}
  const paper=picture(true),coin=picture(false),a=harness(false,true,undefined,true,[paper,coin]);
  assert.ok(a.classes.has('kn-orbit-art-pending'),'Never show a partial question coin or a missing newspaper');
  coin.complete=true;coin.fire('load');
  assert.ok(!a.classes.has('kn-orbit-art-pending'));assert.ok(a.classes.has('kn-orbit-paused'));
  assert.equal(a.storage.get('kn_home_motion_paused'),'1');assert.equal(a.networkCalls(),0);
  const ready=harness(false,false,undefined,true,[picture(true),picture(true)]);
  assert.ok(!ready.classes.has('kn-orbit-art-pending'),'Already decoded pictures reveal together immediately');
  const bad=picture(false),fallback=harness(false,false,undefined,true,[picture(true),bad]);
  bad.fire('error');bad.fire('load');assert.ok(!fallback.classes.has('kn-orbit-art-pending'),'A broken picture must not hide the whole scene forever');
});

test('critical geometry and original artwork exist before mounting or external CSS',()=>{
  // Definition must be safe before a DOM exists; do not call mount to obtain the fallback.
  const context={window:{}};vm.runInNewContext(source,context);
  const markup=context.window.KNNewsOrbit.markup;
  const critical=markup.match(/^<style data-kn-orbit-critical>([\s\S]*?)<\/style>/);
  assert.ok(critical,'Geometry must precede the first image in the delivered markup');
  const rules=new Map([...critical[1].split('@media',1)[0].matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([,selector,body])=>[
    selector.trim(),new Map(body.split(';').filter(Boolean).map(declaration=>{
      const colon=declaration.indexOf(':');assert.ok(colon>0);
      return [declaration.slice(0,colon).trim(),declaration.slice(colon+1).trim()];
    }))
  ]));
  const root=rules.get('.kn-news-orbit'),globe=rules.get('.kn-news-orbit .kn-orbit-globe');
  assert.equal(root.get('position'),'relative');assert.equal(root.get('max-width'),'100%');
  assert.equal(root.get('height'),'220px');
  for(const dimension of ['width','height'])assert.equal(globe.get(dimension),'208px');
  for(const crop of ['clip-path','-webkit-clip-path'])assert.equal(globe.get(crop),'circle(43.25% at 50% 50%)');
  assert.equal(globe.get('left'),'50%');assert.equal(globe.get('margin-left'),'-104px');
  const buttons=rules.get('.kn-news-orbit .kn-orbit-guide,.kn-news-orbit .kn-orbit-shortcut');
  assert.equal(buttons.get('width'),'80px');assert.equal(buttons.get('height'),'80px');
  assert.equal(buttons.get('pointer-events'),'auto');
  const coinCrop=rules.get('.kn-news-orbit .kn-orbit-orbiter-coin img');
  assert.equal(coinCrop.get('width'),'54px');assert.equal(coinCrop.get('height'),'54px');
  assert.equal(coinCrop.get('clip-path'),'circle(38.5% at 50% 49.6%)');
  for(const child of ['kn-orbit-scene','kn-orbit-plane','kn-orbit-earth-fixed'])
    assert.equal(rules.get('.kn-news-orbit .'+child).get('position'),'absolute');
  const poses=['one','two','three'].map(name=>rules.get('.kn-news-orbit .kn-orbit-orbiter-'+name).get('transform'));
  assert.equal(new Set(poses).size,3);for(const pose of poses)assert.match(pose,/^translate\([^)]+\) scale\([^)]+\)$/);
  for(const selectorList of rules.keys())for(const selector of selectorList.split(','))
    assert.match(selector,/^\.kn-news-orbit(?: \.[\w-]+(?: (?:img|svg))?)?$/,'Ordinary class selectors stay below the external body-scoped rules without requiring newer selector syntax');
  assert.doesNotMatch(critical[1],/!important|@keyframes|animation:|--kn-|color-mix|#[\da-f]{3,8}\b/i,'Fallback must not own motion or theme colors');
  const earth=markup.match(/<img class="kn-orbit-globe kn-orbit-illustrated-earth"[^>]+>/)[0];
  assert.match(earth,/src="\/static\/news-orbit\/earth\.webp"/);
  assert.match(earth,/width="208" height="208"/);
  assert.ok(markup.indexOf('</style>')<markup.indexOf(earth));
  const paper=markup.match(/src="data:image\/webp;base64,([^"]+)"/);
  assert.deepEqual(Buffer.from(paper[1],'base64'),fs.readFileSync(path.join(__dirname,'../static/news-orbit/newspaper.webp')));
  const coin=markup.match(/class="kn-orbit-coordinated-coin" src="data:image\/svg\+xml;base64,([^"]+)"/);
  const original=Buffer.from(coin[1],'base64').toString('utf8').match(/href="data:image\/webp;base64,([^"]+)"/);
  assert.deepEqual(Buffer.from(original[1],'base64'),fs.readFileSync(path.join(__dirname,'../static/news-orbit/coin.webp')));
  // Parsing/markup assertions do not substitute for native CSS-failure layout checks.
});

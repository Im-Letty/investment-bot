'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../static/news-orbit.js'),'utf8');
function harness(reduced=false){
  const classes=new Set(),events={},buttonEvents={},attrs={},sceneAttrs={};let mediaCallback,intersectionCallback,observations=0;
  const root={dataset:{},classList:{toggle(name,value){if(value)classes.add(name);else classes.delete(name);}},querySelector(selector){return selector==='.kn-orbit-toggle'?button:scene;}};
  const button={addEventListener(name,fn){buttonEvents[name]=fn;},setAttribute(name,value){attrs[name]=value;}};
  const scene={setAttribute(name,value){sceneAttrs[name]=value;}};
  const preference={matches:reduced,addEventListener(name,fn){mediaCallback=fn;}};
  const document={hidden:false,documentElement:{lang:'ja'},addEventListener(name,fn){(events[name]||=[]).push(fn);}};
  const context={window:{matchMedia:()=>preference},document,localStorage:{getItem(){return null;}},IntersectionObserver:class{constructor(cb){intersectionCallback=cb;}observe(){observations++;}}};
  context.window.IntersectionObserver=context.IntersectionObserver;
  vm.runInNewContext(source,context);
  const host={querySelector(){return root;}};
  context.window.KNNewsOrbit.mount(host);
  return {classes,attrs,sceneAttrs,document,host,root,context,
    click(){buttonEvents.click();},event(name){(events[name]||[]).forEach(fn=>fn());},
    visible(value){intersectionCallback([{target:root,isIntersecting:value}]);},
    preference(value){preference.matches=value;mediaCallback({matches:value});},
    observations(){return observations;},listeners(name){return (events[name]||[]).length;}};
}
test('user pause remains selected across hidden and offscreen transitions',()=>{
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

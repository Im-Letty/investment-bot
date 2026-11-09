'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const start=html.indexOf('/* KN_BROWSER_SURFACE:');
assert.ok(start>=0);
const source=html.slice(start,html.indexOf('</script>',start));

function app({storage={},blocked=false,readyState='loading',homeReady=false,dark=false}={}){
  const styles=new Map(),attrs=new Map([['content','#f8f7ef']]),listeners={},observed=[];
  let writes=0,metaWrites=0,computed='rgb(240, 238, 223)',observerCount=0;
  const classes=new Set();
  const splash={classList:{contains:name=>classes.has(name)}};
  const welcomeClasses=new Set(),welcome={classList:{contains:name=>welcomeClasses.has(name)}};
  const root={hasAttribute:()=>false,style:{getPropertyValue:key=>styles.get(key)||'',setProperty(key,value){writes++;styles.set(key,value);}}};
  const home={},body={getAttribute:key=>key==='data-theme'&&dark?'dark':null,classList:{contains:name=>name==='kn-home-a'&&homeReady}},meta={getAttribute:key=>attrs.get(key),setAttribute(key,value){metaWrites++;attrs.set(key,value);}};
  const document={readyState,documentElement:root,body,
    getElementById:id=>({spl:splash,knWelcomeOv:welcome,'morning-section':home}[id]||null),
    querySelector:selector=>selector==='meta[name="theme-color"]'?meta:null,
    addEventListener:(name,fn)=>{listeners[name]=fn;}};
  let observerCallback;
  const context={document,
    localStorage:{getItem(key){if(blocked)throw Error('storage unavailable');return storage[key]||null;}},
    getComputedStyle:()=>({backgroundColor:computed,color:dark?'rgb(238, 238, 222)':'rgb(52, 51, 49)',getPropertyValue:key=>homeReady?(key==='--kn-a-bg'?computed:key==='--kn-a-muted'?dark?'#c0c6b2':'#625d58':''):''}),
    MutationObserver:class{constructor(fn){observerCount++;observerCallback=fn;}observe(el){observed.push(el);}},
    addEventListener:(name,fn)=>{listeners[name]=fn;}};
  context.window=context;
  vm.runInNewContext(source,context);
  return {context,classes,welcomeClasses,observed,refresh:()=>context.knSyncBrowserSurface(),
    fire:name=>listeners[name](),mutation:()=>observerCallback([]),
    setComputed:value=>{computed=value;homeReady=true;},setDark:value=>{dark=value;},site:()=>styles.get('--kn-site-bg'),ink:()=>styles.get('--kn-site-ink'),color:()=>styles.get('--kn-browser-surface'),meta:()=>attrs.get('content'),
    counts:()=>({writes,metaWrites,observerCount})};
}

test('browser color is available before external startup files and has one meta',()=>{
  assert.equal((html.match(/<meta name="theme-color"/g)||[]).length,1);
  assert.ok(html.indexOf('/* KN_BROWSER_SURFACE:')<html.indexOf('<script src='));
  const a=app();assert.equal(a.color(),'#f0eedf');assert.equal(a.meta(),a.color());
});
test('saved custom and shorthand colors tint the first paint without modifying settings',()=>{
  const a=app({storage:{userBrandColor:'#ff00ff'}});
  assert.equal(a.color(),'#f6daeb');assert.equal(a.meta(),a.color());
  assert.equal(app({storage:{userBrandColor:'#f0f'}}).color(),a.color());
  assert.notEqual(app({storage:{userBrandColor:'#3da060',userBrandColorCustom:'1'}}).color(),app().color());
  assert.equal(app({storage:{userBrandColor:'#3da060',userBrandColorCustom:'0'}}).color(),app().color());
});
test('missing, invalid or blocked saved settings leave a usable default',()=>{
  for(const options of [{},{storage:{userBrandColor:'pink'}},{storage:{userBrandColor:'bad<script>'}},{blocked:true}]){
    const a=app(options);assert.equal(a.color(),'#f0eedf');assert.equal(a.meta(),a.color());
  }
});
test('intro, welcome and home keep one base while the existing entry timing remains independent',()=>{
  const a=app();a.fire('DOMContentLoaded');a.context.knIntroComplete=true;a.fire('knIntroComplete');
  assert.equal(a.color(),'#f0eedf');
  a.classes.add('done');a.welcomeClasses.add('open');a.mutation();assert.equal(a.color(),'#f0eedf');assert.equal(a.site(),a.color());assert.equal(a.meta(),a.color());
});
test('home and dark theme follow the actual surface rather than the older body palette',()=>{
  const a=app({readyState:'complete'});a.context.knIntroComplete=true;a.classes.add('done');
  a.setComputed('color(srgb 0.97 0.83 0.94)');a.mutation();assert.equal(a.meta(),'#f7d4f0');
  a.setComputed('rgb(32, 39, 31)');a.mutation();assert.equal(a.color(),'#20271f');assert.equal(a.meta(),a.color());
});
test('four home palettes and selected-green flag are available before CSS without saving preferences',()=>{
 const cases=[{options:{},expected:'#f0eedf'},{options:{storage:{userBrandColor:'#ff00ff'}},expected:'#f6daeb'},{options:{dark:true},expected:'#20271f'},{options:{dark:true,storage:{userBrandColor:'#ff00ff'}},expected:'#362035'}];
 for(const {options,expected}of cases){const a=app(options);a.welcomeClasses.add('open');a.refresh();assert.equal(a.site(),expected);assert.equal(a.meta(),expected);assert.equal(a.color(),expected);}
 assert.notEqual(app({storage:{userBrandColor:'#3da060',userBrandColorCustom:'1'}}).site(),app({storage:{userBrandColor:'#3da060',userBrandColorCustom:'0'}}).site());
 const a=app({dark:true});assert.equal(a.ink(),'#eeeede');a.setComputed('rgb(51, 40, 46)');a.refresh();assert.equal(a.site(),'rgb(51, 40, 46)');assert.equal(a.meta(),'#33282e');
});
test('redundant sync and its own style mutation produce no extra writes or observers',()=>{
  const a=app({readyState:'complete'}),before=a.counts();
  a.refresh();a.mutation();a.fire('pageshow');a.fire('load');vm.runInNewContext(source,a.context);
  assert.deepEqual(a.counts(),before);assert.equal(a.observed.length,4);
});

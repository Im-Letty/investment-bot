'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const start=html.indexOf('/* __KN_NEWS_FIRST:');
assert.ok(start>=0,'The morning startup controller must be present');
const controller=html.slice(start,html.indexOf('</script>',start));

function harness({readyState='loading'}={}){
  let clock=0,sequence=0,clicks=0;
  const timers=new Map(),listeners=new Map();
  function element(classes=[]){
    const names=new Set(classes);
    return {style:{},classList:{
      add(...items){items.forEach(name=>names.add(name));},
      remove(...items){items.forEach(name=>names.delete(name));},
      contains(name){return names.has(name);},
      toggle(name,force){const add=force===undefined?!names.has(name):force;if(add)names.add(name);else names.delete(name);return add;}
    }};
  }
  const body=element(),section=element(),welcome=element(['open']),auth=element(['open']);
  section.style.display='none';
  const buttons=['home','morning','mypage'].map(act=>{
    const button=element(act==='home'?['bn-item','active']:['bn-item']);
    button.dataset={act};
    button.getAttribute=name=>name==='data-act'?act:null;
    button.click=()=>{clicks++;welcome.classList.remove('open');auth.classList.remove('open');};
    return button;
  });
  function query(selector){
    const match=selector.match(/\[data-act=["']?(\w+)["']?\]/);
    return match?buttons.find(button=>button.dataset.act===match[1])||null:null;
  }
  const nav={children:[...buttons],querySelector:query,querySelectorAll:()=>buttons,
    insertBefore(item,before){this.children.splice(this.children.indexOf(item),1);this.children.splice(this.children.indexOf(before),0,item);}};
  const document={readyState,body,
    getElementById:id=>({knBottomNav:nav,'morning-section':section,knWelcomeOv:welcome,knAuthOv:auth}[id]||null),
    querySelector:query,querySelectorAll:()=>buttons,
    addEventListener(name,fn,options){const group=listeners.get(name)||[];group.push({fn,once:!!(options&&options.once)});listeners.set(name,group);}
  };
  const context={document,MutationObserver:class{observe(){}},
    setTimeout(fn,delay){const id=++sequence;timers.set(id,{fn,at:clock+delay});return id;},
    clearTimeout:id=>timers.delete(id)};
  context.window=context;
  vm.runInNewContext(controller,context);
  function advance(duration){
    const deadline=clock+duration;
    while(true){
      const next=[...timers].filter(([,timer])=>timer.at<=deadline).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next)break;
      clock=next[1].at;timers.delete(next[0]);next[1].fn();
    }
    clock=deadline;
  }
  function fire(name){
    if(name==='DOMContentLoaded')document.readyState='interactive';
    const group=[...(listeners.get(name)||[])];
    listeners.set(name,group.filter(listener=>!listener.once));
    group.forEach(listener=>listener.fn());
  }
  return {body,section,welcome,auth,buttons,nav,advance,fire,clicks:()=>clicks};
}

function assertMorningSelected(app){
  assert.ok(app.body.classList.contains('view-asaletter'),'Morning must be visible without a navigation click');
  assert.equal(app.section.style.display,'block');
  assert.deepEqual(app.buttons.filter(button=>button.classList.contains('active')).map(button=>button.dataset.act),['morning']);
}

test('morning startup waits for DOMContentLoaded even after the old timer deadlines',()=>{
  const app=harness();
  app.advance(2500);
  assert.equal(app.body.classList.contains('view-asaletter'),false);
  assert.equal(app.section.style.display,'none');
  assert.equal(app.clicks(),0);
  app.fire('DOMContentLoaded');
  assertMorningSelected(app);
  assert.equal(app.nav.children[0].dataset.act,'morning');
});

test('morning startup selects the visible section immediately when the DOM is ready',()=>{
  for(const readyState of ['interactive','complete'])assertMorningSelected(harness({readyState}));
});

test('selecting the startup section preserves welcome and account entry overlays',()=>{
  const app=harness();
  app.fire('DOMContentLoaded');
  app.advance(12000);
  assertMorningSelected(app);
  assert.ok(app.welcome.classList.contains('open'));
  assert.ok(app.auth.classList.contains('open'));
  assert.equal(app.clicks(),0,'Startup must not invoke navigation click side effects');
});

test('startup does not overwrite a later user navigation choice',()=>{
  const app=harness();
  app.fire('DOMContentLoaded');
  assertMorningSelected(app);
  app.body.classList.remove('view-asaletter');
  app.section.style.display='none';
  app.buttons.forEach(button=>button.classList.toggle('active',button.dataset.act==='mypage'));
  app.advance(20000);
  app.fire('knIntroComplete');
  app.fire('DOMContentLoaded');
  assert.equal(app.body.classList.contains('view-asaletter'),false);
  assert.equal(app.section.style.display,'none');
  assert.deepEqual(app.buttons.filter(button=>button.classList.contains('active')).map(button=>button.dataset.act),['mypage']);
  assert.equal(app.clicks(),0);
});

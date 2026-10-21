'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const files=['static/simulator-embed-9438e6695a.html','simulator.html'];
function read(file){return fs.readFileSync(path.join(__dirname,'..',file),'utf8');}
function calculator(file,{uid='',embedded=true}={}){
  const html=read(file),nodes=new Map(),events=new Map(),timers=new Map(),frames=new Map(),messages=[],requests=[];
  let clock=0,sequence=0;
  for(const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)){
    const attrs=match[2],style={},classes=new Set((attrs.match(/class="([^"]*)"/)?.[1]||'').split(/\s+/));
    nodes.set(match[3],{id:match[3],tagName:match[1].toUpperCase(),type:attrs.match(/type="([^"]*)"/)?.[1],value:attrs.match(/value="([^"]*)"/)?.[1]||'',dataset:{},style,textContent:'',
      classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),toggle(name,on){if(on)classes.add(name);else classes.delete(name);}},addEventListener(){},offsetWidth:300});
  }
  const ranges=[...nodes.values()].filter(n=>n.type==='range');
  const document={hidden:false,documentElement:{lang:'ja'},getElementById:id=>nodes.get(id)||null,querySelectorAll:selector=>selector==='input[type=range]'?ranges:[],addEventListener(name,fn){events.set(name,fn);}};
  const context={document,console,URLSearchParams,location:{origin:'https://example.test',search:'',hash:'#sim_attempt=attempt-7'},UID:uid,
    localStorage:{getItem(){return null;},setItem(){}},performance:{now:()=>clock},setTimeout(fn,ms){timers.set(++sequence,{fn,ms});return sequence;},clearTimeout:id=>timers.delete(id),
    requestAnimationFrame(fn){frames.set(++sequence,fn);return sequence;},cancelAnimationFrame:id=>frames.delete(id),fetch(url){requests.push(url);return new Promise(()=>{});}};
  context.window=context;context.parent=embedded?{postMessage:(data,origin)=>messages.push({data,origin})}:context;
  const start=html.indexOf('let chartD,chartM,chartL,chartG;'),end=html.indexOf('    // ===== 複数株入力 =====',start);
  assert.ok(start>0&&end>start);
  vm.runInNewContext(html.match(/const SIM_ATTEMPT=[^;]+;/)[0],context,{filename:file});
  vm.runInNewContext(html.slice(start,end),context,{filename:file});
  return {context,nodes,messages,requests,frames,settleNumbers(){clock=1000;const scheduled=[...frames.values()];frames.clear();scheduled.forEach(fn=>fn(clock));},
    money(id,value){nodes.get(id).dataset.raw=String(value);nodes.get(id).value=String(value);},number(id,value){nodes.get(id).value=String(value);}};
}
for(const file of files){
  test(`${file}: readable yen amounts preserve fractional yen, signs, and compact chart ticks`,()=>{
    const h=calculator(file);
    for(const [value,expected] of [[22220000000,'222億2,000万円'],[123456789.5,'1億2,345万6,789.5円'],
      [100000000.1,'1億0.1円'],[1000.5,'1,000.5円'],[10000,'1万円'],[0,'0円'],
      [-12345.5,'-1万2,345.5円'],[1e-7,'0.0000001円'],[1e21,'10,000,000,000,000億円']]){
      assert.equal(h.context.fmt(value),expected);
    }
    assert.equal(h.context.fmtChartTick(22220000000),'222.2億');
    h.context.countUp('m-gain',12345.5,'+');h.settleNumbers();
    assert.equal(h.nodes.get('m-gain').textContent,'+1万2,345.5円');
    h.context.currentLang='en';assert.equal(h.context.fmt(123456),'123K');
    assert.doesNotMatch(read(file),/LINEアプリで開くとより快適です/);
  });
  test(`${file}: all four modes calculate without waiting for styling, a graph library or user-data response`,()=>{
    const h=calculator(file,{uid:'fixture-user'});h.settleNumbers();
    assert.equal(h.context.__KN_SIMULATOR_READY,true);
    assert.equal(h.context.__KN_SIMULATOR_READY_TOKEN,'attempt-7');
    assert.deepEqual(h.messages,[],'calculation initialization must not expose an unfinished view');
    assert.equal(h.requests.length,1,'existing user-data fetch remains independent of readiness');
    for(const id of ['d-total','d-final','m-total','m-final','lp-principal','lp-final','g-monthly','g-total'])assert.match(h.nodes.get(id).textContent,/\d/);
    assert.equal(h.context.makeChart('chart-d',[],[],[]),null);
  });
  test(`${file}: all four calculations remain correct and editable without Chart, including zero return`,()=>{
    const h=calculator(file),results={};h.context.countUp=(id,value)=>results[id]=value;
    h.money('d-amount-n',1000);h.number('d-rate-n',0);h.number('d-years-n',2);h.context.calcD();
    assert.equal(results['d-total'],730000);assert.equal(results['d-final'],730000);assert.equal(results['d-gain'],0);
    h.money('m-amount-n',30000);h.number('m-rate-n',0);h.number('m-years-n',2);h.context.calcM();
    assert.equal(results['m-total'],720000);assert.equal(results['m-final'],720000);assert.equal(results['m-gain'],0);
    h.money('lp-amount-n',1000000);h.number('lp-rate-n',0);h.number('lp-years-n',2);h.context.calcL();
    assert.equal(results['lp-principal'],1000000);assert.equal(results['lp-final'],1000000);assert.equal(results['lp-gain'],0);
    h.money('g-target-n',1200000);h.number('g-rate-n',0);h.number('g-years-n',2);h.context.calcG();
    assert.equal(results['g-monthly'],50000);assert.equal(results['g-total'],1200000);assert.equal(results['g-gain'],0);
    h.number('d-rate-n',5);h.context.calcD();
    const dailyRate=.05/365;assert.equal(results['d-final'],Math.round(1000*((Math.pow(1+dailyRate,730)-1)/dailyRate)*(1+dailyRate)));
    h.number('m-rate-n',5);h.context.calcM();
    const monthlyRate=.05/12;assert.equal(results['m-final'],Math.round(30000*((Math.pow(1+monthlyRate,24)-1)/monthlyRate)*(1+monthlyRate)));
    h.number('lp-rate-n',5);h.context.calcL();assert.equal(results['lp-final'],1102500);
    h.number('g-rate-n',5);h.context.calcG();assert.equal(results['g-monthly'],Math.ceil(1200000*monthlyRate/((Math.pow(1+monthlyRate,24)-1)*(1+monthlyRate))));
  });
  test(`${file}: late graph loading draws current values without resetting edited inputs`,()=>{
    const h=calculator(file),charts=[];
    h.money('d-amount-n',2000);h.money('m-amount-n',45000);h.money('lp-amount-n',2345000);h.money('g-target-n',6789000);
    for(const prefix of ['d','m','lp','g']){h.number(`${prefix}-rate-n`,0);h.number(`${prefix}-years-n`,2);}
    const snapshot=[...h.nodes].filter(([,n])=>n.tagName==='INPUT').map(([id,n])=>[id,n.value,n.dataset.raw]);
    h.context.Chart=class{constructor(canvas,config){this.canvas=canvas;this.data=config.data;this.options=config.options;this.destroyed=false;charts.push(this);}destroy(){this.destroyed=true;}};
    h.context.__knSimulatorChartsLoaded();
    assert.deepEqual(charts.map(c=>c.canvas.id),['chart-d','chart-m','chart-l','chart-g']);
    assert.deepEqual(charts.map(c=>c.data.datasets[1].data.at(-1)),[1460000,1080000,2345000,6789000]);
    assert.deepEqual([...h.nodes].filter(([,n])=>n.tagName==='INPUT').map(([id,n])=>[id,n.value,n.dataset.raw]),snapshot);
    h.context.__knSimulatorChartsLoaded();assert.ok(charts.slice(0,4).every(c=>c.destroyed));assert.equal(charts.length,8);
  });
  test(`${file}: standalone simulator marks ready without messaging itself`,()=>{
    const h=calculator(file,{embedded:false});assert.equal(h.context.__KN_SIMULATOR_READY,true);assert.equal(h.messages.length,0);
  });
  test(`${file}: external fonts and graph downloads do not block input initialization`,()=>{
    const html=read(file);
    assert.match(html,/<link[^>]*fonts\.googleapis\.com[^>]*media="print"[^>]*onload="this\.media='all'"/);
    assert.match(html,/<script src="\/static\/vendor\/chart\.umd-4\.4\.1\.js" async/);
    assert.doesNotMatch(html,/cdnjs\.cloudflare\.com/);
    assert.doesNotMatch(html,/<base href="https:\/\/investment-bot-ta24/);
  });
}
function viewReady(file,{embedded=true,readyState='loading',calculationReady=true,
  missingStyle='',themeReady=true,inputsReady=true,amountsReady=true,rowsReady=true,
  missingDecoratedRow=false,prepareAtDOMContentLoaded=false}={}){
  const h=calculator(file,{embedded}),html=read(file),document=h.context.document,listeners=[],flagsAtMessage=[];
  const styles=['simulator-theme-style','simulator-site-type-style','simulator-type-style','simulator-inputs-style'];
  for(const id of styles){assert.ok(h.nodes.has(id),file+' must include '+id);h.nodes.get(id).sheet=id===missingStyle?null:{};}
  const state={rowsReady,amountsReady},ranges=[...h.nodes.values()].filter(n=>n.type==='range');
  assert.ok(ranges.length>0);
  ranges.forEach((range,index)=>{range.closest=()=>({classList:{contains:name=>name==='sim-adjust-row'&&state.rowsReady&&!(missingDecoratedRow&&index===0)}});});
  document.body={classList:{contains:name=>name==='sim-amount-fitting'&&state.amountsReady}};
  document.readyState=readyState;
  document.querySelectorAll=selector=>selector==='.row input[type="range"]'?ranges:[];
  document.addEventListener=(name,fn)=>{assert.equal(name,'DOMContentLoaded');listeners.push(fn);};
  h.context.KNSimulatorTheme=themeReady?{applyChart(){}}:undefined;
  h.context.__KN_SIMULATOR_INPUTS=inputsReady;
  h.context.__KN_SIMULATOR_READY=calculationReady;
  if(embedded)h.context.parent.postMessage=(data,origin)=>{
    flagsAtMessage.push(h.context.__KN_SIMULATOR_VIEW_READY);h.messages.push({data,origin});
  };
  if(prepareAtDOMContentLoaded){
    state.rowsReady=false;state.amountsReady=false;
    // Model the existing input/amount script listeners registered before the
    // finalizer. The finalizer must run after both decorations complete.
    document.addEventListener('DOMContentLoaded',()=>{state.rowsReady=true;});
    document.addEventListener('DOMContentLoaded',()=>{state.amountsReady=true;});
  }
  const match=html.match(/<script id="simulator-view-ready">([\s\S]*?)<\/script>/);
  assert.ok(match,'view-ready gate must exist');
  assert.ok(html.indexOf('<script id="simulator-view-ready">')>html.indexOf('<script src="/static/simulator-amounts.js'));
  vm.runInNewContext(match[1],h.context,{filename:file+':view-ready'});
  return {...h,state,listeners,flagsAtMessage,domReady(){document.readyState='interactive';listeners.forEach(fn=>fn());}};
}
for(const file of files){
  test(file+': calculation-ready does not reveal the legacy view before DOM and decorations are ready',()=>{
    const h=viewReady(file,{prepareAtDOMContentLoaded:true});
    assert.equal(h.context.__KN_SIMULATOR_READY,true);
    assert.equal(h.context.__KN_SIMULATOR_VIEW_READY,undefined);
    assert.deepEqual(h.messages,[]);
    assert.equal(h.listeners.length,3,'view finalizer follows input and amount initialization');
    h.domReady();
    assert.equal(h.context.__KN_SIMULATOR_VIEW_READY,true);
    assert.deepEqual(JSON.parse(JSON.stringify(h.messages)),[{data:{type:'kn-simulator-ready',attempt:'attempt-7'},origin:'https://example.test'}]);
    assert.deepEqual(h.flagsAtMessage,[true],'the view flag is set before notifying the parent');
    h.domReady();assert.equal(h.messages.length,1,'repeated completion cannot send duplicate readiness');
  });
  test(file+': a missing current stylesheet cannot expose the legacy view',()=>{
    for(const missingStyle of ['simulator-theme-style','simulator-site-type-style','simulator-type-style','simulator-inputs-style']){
      const h=viewReady(file,{missingStyle});h.domReady();
      assert.equal(h.context.__KN_SIMULATOR_VIEW_READY,undefined,missingStyle);
      assert.equal(h.messages.length,0,missingStyle);
    }
  });
  test(file+': missing theme or partial input/amount initialization stays unavailable for parent retry',()=>{
    for(const options of [{calculationReady:false},{themeReady:false},{inputsReady:false},{amountsReady:false},{rowsReady:false},{missingDecoratedRow:true}]){
      const h=viewReady(file,options);h.domReady();
      assert.equal(h.context.__KN_SIMULATOR_VIEW_READY,undefined,JSON.stringify(options));
      assert.equal(h.messages.length,0,JSON.stringify(options));
    }
  });
  test(file+': an already prepared standalone view becomes ready without messaging itself',()=>{
    const h=viewReady(file,{embedded:false,readyState:'complete'});
    assert.equal(h.context.__KN_SIMULATOR_VIEW_READY,true);
    assert.equal(h.messages.length,0);assert.equal(h.listeners.length,0);
  });
}
function background(file,embedded){
  const html=read(file),events=new Map(),docEvents=new Map(),frames=new Map();let seq=0;
  const ctx={clearRect(){},beginPath(){},arc(){},stroke(){},fill(){},save(){},fillText(){},restore(){}};
  const canvas={width:0,height:0,getContext:()=>ctx};
  const document={hidden:false,getElementById:()=>canvas,addEventListener:(name,fn)=>docEvents.set(name,fn)};
  const context={document,location:{origin:'https://example.test'},innerWidth:390,innerHeight:844,
    addEventListener:(name,fn)=>events.set(name,fn),requestAnimationFrame(fn){frames.set(++seq,fn);return seq;},cancelAnimationFrame:id=>frames.delete(id)};
  context.window=context;context.parent=embedded?{}:context;
  const start=html.indexOf('/* 背景パーティクル */'),end=html.indexOf('let chartD,chartM,chartL,chartG;',start);
  vm.runInNewContext(html.slice(start,end),context,{filename:file});
  return {context,document,events,docEvents,frames,message(event){events.get('message')(event);},good(visible){return {origin:context.location.origin,source:context.parent,data:{type:'kn-simulator-visibility',visible}};}};
}
for(const file of files){
  test(`${file}: a retained iframe only animates when its actual parent says it is visible`,()=>{
    const h=background(file,true);assert.equal(h.frames.size,0);
    h.message({...h.good(true),origin:'https://other.test'});h.message({...h.good(true),source:{}});
    h.message({...h.good(true),data:{type:'other',visible:true}});h.message({...h.good(true),data:{type:'kn-simulator-visibility',visible:'true'}});
    assert.equal(h.frames.size,0);
    h.message(h.good(true));assert.equal(h.frames.size,1);h.message(h.good(true));assert.equal(h.frames.size,1,'no duplicate animation loops');
    h.message(h.good(false));assert.equal(h.frames.size,0);assert.equal(h.context.__bgRAF,0);
    h.message(h.good(true));assert.equal(h.frames.size,1);
    h.document.hidden=true;h.docEvents.get('visibilitychange')();assert.equal(h.frames.size,0);
    h.document.hidden=false;h.docEvents.get('visibilitychange')();assert.equal(h.frames.size,1);
    h.events.get('pagehide')();assert.equal(h.frames.size,0);h.events.get('pageshow')();assert.equal(h.frames.size,1);
  });
  test(`${file}: standalone background starts visible and pauses when its browser page is hidden`,()=>{
    const h=background(file,false);assert.equal(h.frames.size,1);
    h.document.hidden=true;h.docEvents.get('visibilitychange')();assert.equal(h.frames.size,0);
    h.document.hidden=false;h.docEvents.get('visibilitychange')();assert.equal(h.frames.size,1);
  });
}
test('the exact existing Chart version and MIT license are kept locally',()=>{
  assert.match(read('static/vendor/chart.umd-4.4.1.js'),/Chart\.js v4\.4\.1/);
  assert.match(read('static/vendor/Chart.js-4.4.1-LICENSE.md'),/MIT License/);
});

test('the current immutable simulator filename is bound to its actual content hash',()=>{
  const html=read('index.html'),url=html.match(/var SIM_URL="([^"]+)"/)[1];
  const name=new URL(url,'https://example.test').pathname;
  const content=fs.readFileSync(path.join(__dirname,'..',name));
  const hash=require('node:crypto').createHash('sha256').update(content).digest('hex').slice(0,10);
  assert.equal(name,'/static/simulator-embed-'+hash+'.html');
});

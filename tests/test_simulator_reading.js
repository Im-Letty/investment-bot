'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','static/simulator-theme.js'),'utf8');

function reading({embedded=true,size='m',scale='1',withChart=true,brand='',custom=false,dark=false,parentBg='#f0eedf',parentInk='#343331',parentMuted='#625d58'}={}) {
  const properties=new Map(),attributes=new Map(),events=new Map(),timers=new Map(),observers=[];
  let parentScale=scale,storedSize=size,sequence=0;if(dark)attributes.set('data-theme','dark');
  const chart={data:{datasets:[{data:[1000,2000]},{data:[1000,2100]}]},options:{
    plugins:{legend:{labels:{font:{family:'system-ui',size:12,weight:'400'}}},
      tooltip:{titleFont:{family:'system-ui',size:14,weight:'500'},bodyFont:{family:'system-ui',size:13,weight:'400'}}},
    scales:{x:{ticks:{font:{family:'system-ui',size:12,weight:'400'}},grid:{}},
      y:{ticks:{font:{family:'system-ui',size:12,weight:'400'}},grid:{}}}
  },updates:0,update(){this.updates++;}};
  const Chart={defaults:{font:{size:12}},getChart:()=>chart};
  const parentBody={classList:{contains:()=>true}},parentDocument={body:parentBody,documentElement:{},getElementById:()=>({})};
  const context={CSS:{supports:()=>true},location:{origin:'https://example.test'},
    localStorage:{getItem:key=>key==='ui_fontscale'?storedSize:key==='userBrandColor'?brand:key==='userBrandColorCustom'?(custom?'1':'0'):null,setItem(){throw Error('must not rewrite preferences');}},
    getComputedStyle:el=>({color:el.style.color}),
    document:{documentElement:{style:{setProperty:(key,value)=>properties.set(key,value)}},
      body:{appendChild(){},getAttribute:key=>attributes.get(key)||null,setAttribute:(key,value)=>attributes.set(key,value)},
      createElement(name){
        if(name==='span')return {style:{}};
        return {getContext:()=>({clearRect(){},fillRect(){},fillStyle:'#607765',getImageData(){
          const hex=this.fillStyle.slice(1);return {data:[parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16),255]};
        }})};
      },querySelectorAll:()=>[{}],addEventListener(){}},
    addEventListener:(name,fn)=>events.set(name,fn),
    MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this);this.targets=[];}observe(target){this.targets.push(target);}disconnect(){}},
    setTimeout(fn,delay){timers.set(++sequence,{fn,delay});return sequence;},clearTimeout:id=>timers.delete(id)
  };
  context.window=context;
  context.parent=embedded?{location:context.location,document:parentDocument,
    getComputedStyle:()=>({backgroundColor:parentBg,getPropertyValue:key=>key==='--kn-a-scale'?parentScale:key==='--kn-site-bg'?parentBg:key==='--kn-site-ink'||key==='--kn-a-ink'?parentInk:key==='--kn-site-muted'||key==='--kn-a-muted'?parentMuted:'#607765'})}:context;
  if(withChart)context.Chart=Chart;
  vm.runInNewContext(source,context,{filename:'simulator-theme.js'});
  function settle(){
    const due=[...timers.entries()].filter(([,timer])=>timer.delay===0);
    due.forEach(([id,timer])=>{timers.delete(id);timer.fn();});
  }
  return {context,chart,Chart,properties,attributes,
    parentSize(value){parentScale=value;observers[0].fn();settle();},
    localSize(value){storedSize=value;events.get('storage')({key:'ui_fontscale'});settle();},
    localTheme(value){if(value)attributes.set('data-theme','dark');else attributes.delete('data-theme');observers.find(o=>o.targets.includes(context.document.body)).fn();settle();}};
}

test('an unchanged color does not hide parent reading-size changes, and chart sizes do not compound',()=>{
  const h=reading(),data=JSON.stringify(h.chart.data.datasets.map(dataset=>dataset.data));
  assert.equal(h.properties.get('--kn-type-scale'),'1');
  const initialUpdates=h.chart.updates;
  h.parentSize('1.3');
  assert.equal(h.properties.get('--kn-type-scale'),'1.3');
  assert.equal(h.attributes.get('data-kn-sim-large-text'),'true');
  assert.equal(h.chart.updates,initialUpdates+1);
  assert.ok(Math.abs(h.chart.options.plugins.legend.labels.font.size-15.6)<1e-9);
  assert.ok(Math.abs(h.chart.options.scales.x.ticks.font.size-15.6)<1e-9);
  assert.equal(h.chart.options.plugins.legend.labels.font.family,'system-ui');
  assert.equal(h.chart.options.plugins.tooltip.titleFont.weight,'500');
  assert.equal(JSON.stringify(h.chart.data.datasets.map(dataset=>dataset.data)),data);
  h.parentSize('1');
  assert.equal(h.chart.options.scales.x.ticks.font.size,12);
  assert.equal(h.attributes.get('data-kn-sim-large-text'),'false');
});

test('standalone preferences update without a parent, and late charts use the chosen size',()=>{
  const h=reading({embedded:false,size:'s',withChart:false});
  assert.equal(h.properties.get('--kn-type-scale'),'0.9');
  h.localSize('xl');
  assert.equal(h.properties.get('--kn-type-scale'),'1.3');
  h.context.KNSimulatorTheme.applyChart(h.chart);
  assert.ok(Math.abs(h.chart.options.scales.y.ticks.font.size-15.6)<1e-9);
  h.localSize('not-a-size');
  assert.equal(h.properties.get('--kn-type-scale'),'1');
});


test('standalone simulator uses the same four home backgrounds including custom green without changing reading cards',()=>{
  for(const [options,expected]of [
    [{},'#f0eedf'],[{brand:'#e91e63'},'color-mix(in srgb,#e91e63 10%,#f5f2e9)'],
    [{dark:true},'#20271f'],[{brand:'#e91e63',dark:true},'color-mix(in srgb,#e91e63 10%,#20241f)'],
    [{brand:'#3da060'},'#f0eedf'],[{brand:'#3da060',custom:true},'color-mix(in srgb,#3da060 10%,#f5f2e9)']
  ]){
    const h=reading({embedded:false,...options});assert.equal(h.properties.get('--sim-bg'),expected);assert.equal(h.properties.get('--sim-paper'),'#fffefb');assert.equal(h.properties.get('--sim-ink'),'#303638');assert.equal(h.properties.get('--sim-chart-bg'),'#fffefb');
  }
});
test('embedded simulator takes the exact shared home background and page captions without flattening chart or card surfaces',()=>{
  const bg='color(srgb 0.12 0.23 0.20)',h=reading({parentBg:bg,parentInk:'#eeeede',parentMuted:'#c0c6b2',brand:'#ff0000'});
  assert.equal(h.properties.get('--sim-bg'),bg);assert.equal(h.properties.get('--sim-page-ink'),'#eeeede');assert.equal(h.properties.get('--sim-page-muted'),'#c0c6b2');assert.equal(h.properties.get('--sim-paper'),'#fffefb');assert.equal(h.properties.get('--sim-ink'),'#303638');
});
test('existing local dark attributes update the standalone backdrop without changing stored preferences or card ink',()=>{
  const h=reading({embedded:false});h.localTheme(true);assert.equal(h.properties.get('--sim-bg'),'#20271f');assert.equal(h.properties.get('--sim-page-ink'),'#eeeede');assert.equal(h.properties.get('--sim-ink'),'#303638');h.localTheme(false);assert.equal(h.properties.get('--sim-bg'),'#f0eedf');
});

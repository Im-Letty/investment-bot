'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','static/mypage-kakeibo-theme.js'),'utf8');
const defaults={bg:'#f0eedf',paper:'#fdfcf6',ink:'#3d4b3c',muted:'#606b57',line:'#d5d6c3',button:'#607765',chip:'#eeeddf'};
function channels(value){
  const hex=value.match(/^#([0-9a-f]{6})$/i);
  if(hex)return [0,2,4].map(i=>parseInt(hex[1].slice(i,i+2),16));
  const rgb=value.match(/^rgba?\(([^)]+)/i);
  if(rgb)return rgb[1].split(/[,\s]+/).slice(0,3).map(Number);
  const srgb=value.match(/^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)\)$/);
  return srgb?srgb.slice(1).map(n=>Math.round(Number(n)*255)):null;
}
function resolveColor(value){
  const mix=value.match(/^color-mix\(in srgb,(#[0-9a-f]{6}) ([\d.]+)%,(#[0-9a-f]{6})\)$/i);
  if(!mix)return value;
  const a=channels(mix[1]),b=channels(mix[3]),weight=Number(mix[2])/100;
  return 'color(srgb '+a.map((v,i)=>(v*weight+b[i]*(1-weight))/255).join(' ')+')';
}
function fixture({stored={},embedded=false,lateChart=false}={}){
  const observers=[],pending=new Set(),frames=new Map(),events=new Map(),charts=new Map(),plugins=[],writes=[],storageWrites=[];
  let frameId=0,observerRounds=0;
  function mutation(target,name){for(const item of observers)if(item.target===target&&item.options.attributeFilter.includes(name))pending.add(item);}
  function element(tag='div',id=''){
    const values=new Map(),attributes=new Map(),classes=new Set();
    const node={id,tagName:tag.toUpperCase(),children:[],classList:{add:value=>classes.add(value),contains:value=>classes.has(value)},
      getAttribute:name=>attributes.get(name)??null,setAttribute(name,value){attributes.set(name,String(value));mutation(node,name);},
      removeAttribute(name){attributes.delete(name);mutation(node,name);},appendChild(child){node.children.push(child);return child;}};
    node.style={getPropertyValue:name=>values.get(name)||'',setProperty(name,value){values.set(name,String(value));writes.push({node,name,value:String(value)});mutation(node,'style');}};
    if(tag==='canvas'){
      const context={fillStyle:'',clearRect(){},fillRect(){},getImageData(){return {data:[...(channels(context.fillStyle)||[0,0,0]),255]};}};
      node.getContext=()=>context;
    }
    return node;
  }
  const root=element('html'),body=element('body'),parentRoot=element('html'),parentBody=element('body');
  for(const [key,value] of Object.entries(defaults))parentRoot.style.setProperty('--kn-sh-'+key,value);
  parentBody.classList.add('kn-home-a');parentBody.style.setProperty('--kn-a-scale','1.15');parentBody.style.setProperty('--kn-a-sans','fixture-family');
  const document={documentElement:root,body,createElement:element,querySelectorAll:selector=>selector==='canvas'?[...charts.keys()]:[]};
  function computed(node){return {fontFamily:'fixture-family',get color(){return resolveColor(node.style.color||'');},getPropertyValue(name){
    if(node===body){
      const aliases={'--kn-ledger-button':'--kn-sh-button','--kn-ledger-ink':'--kn-sh-ink','--kn-ledger-muted':'--kn-sh-muted'};
      return node.style.getPropertyValue(name)||root.style.getPropertyValue(aliases[name]||name);
    }
    return node.style.getPropertyValue(name);
  }};}
  const storage=new Map(Object.entries(stored));
  const context={document,location:{origin:'https://fixture.test'},getComputedStyle:computed,
    localStorage:{getItem:key=>storage.get(key)||null,setItem(key,value){storageWrites.push(key);storage.set(key,String(value));}},
    addEventListener(name,callback){const list=events.get(name)||[];list.push(callback);events.set(name,list);},
    requestAnimationFrame(callback){frames.set(++frameId,callback);return frameId;},
    MutationObserver:class{constructor(callback){this.callback=callback;}observe(target,options){observers.push({callback:this.callback,target,options});}}};
  const Chart={register:plugin=>plugins.push(plugin),getChart:canvas=>charts.get(canvas)};
  context.window=context;
  context.parent=embedded?{document:{documentElement:parentRoot,body:parentBody},location:{origin:context.location.origin},getComputedStyle:computed}:context;
  if(!lateChart)context.Chart=Chart;
  vm.runInNewContext(source,context);
  function event(name){for(const callback of events.get(name)||[])callback({type:name});}
  function flush(){
    let rounds=0;
    while(pending.size||frames.size){
      assert.ok(++rounds<25,'palette mutations must settle without a feedback loop');
      if(pending.size){observerRounds++;const current=[...pending];pending.clear();for(const item of current)item.callback([]);}
      const scheduled=[...frames.values()];frames.clear();for(const callback of scheduled)callback();
    }
  }
  function chart(id,type,datasets){
    const canvas=element('canvas',id),instance={canvas,config:{type},data:{labels:['fixture-a','fixture-b'],datasets},
      options:{plugins:{legend:{labels:{}}},scales:{x:{ticks:{},grid:{},border:{}}}},updates:[],update(mode){this.updates.push(mode);for(const plugin of plugins)plugin.beforeUpdate(this);}};
    charts.set(canvas,instance);return instance;
  }
  flush();
  return {root,body,parentRoot,parentBody,storage,storageWrites,writes,context,Chart,plugins,chart,event,flush,get observerRounds(){return observerRounds;}};
}
function copy(value){return JSON.parse(JSON.stringify(value));}
function ratio(a,b){
  function luminance(color){const c=channels(color).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];}
  const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
test('standalone same-document brand changes update shared palette immediately and settle',()=>{
  const h=fixture({stored:{userBrandColor:'#aa5599',userBrandColorCustom:'1'}});
  assert.match(h.root.style.getPropertyValue('--kn-sh-button'),/#aa5599/);
  h.root.style.setProperty('--brand-color','#4466aa');h.root.setAttribute('data-custom-brand-color','');h.flush();
  assert.match(h.root.style.getPropertyValue('--kn-sh-button'),/#4466aa/);
  const before=h.writes.length,rounds=h.observerRounds;h.flush();
  assert.equal(h.writes.length,before);assert.equal(h.observerRounds,rounds);assert.deepEqual(h.storageWrites,[]);
  h.root.style.setProperty('--brand-color','#3da060');h.root.removeAttribute('data-custom-brand-color');h.flush();
  assert.equal(h.root.style.getPropertyValue('--kn-sh-button'),defaults.button,'reset retains the default shared palette');
});
test('storage and focus synchronize local preferences without rewriting storage',()=>{
  const h=fixture();h.storage.set('userBrandColor','#725799');h.storage.set('userBrandColorCustom','1');h.storage.set('ui_fontscale','xl');h.event('storage');h.flush();
  assert.match(h.root.style.getPropertyValue('--kn-sh-button'),/#725799/);assert.equal(h.root.style.getPropertyValue('--kn-sh-scale'),'1.3');
  h.storage.set('userBrandColor','#998855');h.event('focus');h.flush();
  assert.match(h.root.style.getPropertyValue('--kn-sh-button'),/#998855/);assert.deepEqual(h.storageWrites,[]);
});
test('embedded palette, font and dark state stay authoritative over child preferences',()=>{
  const h=fixture({embedded:true,stored:{userBrandColor:'#aa1122',userBrandColorCustom:'1'}});
  assert.ok(h.body.classList.contains('kn-ledger-embedded'));assert.equal(h.root.style.getPropertyValue('--kn-sh-button'),defaults.button);
  assert.equal(h.root.style.getPropertyValue('--kn-sh-sans'),'fixture-family');assert.equal(h.root.style.getPropertyValue('--kn-sh-scale'),'1.15');
  h.parentRoot.style.setProperty('--kn-sh-button','#47745a');h.parentRoot.style.setProperty('--kn-sh-paper','#1c3027');h.parentBody.setAttribute('data-theme','dark');
  h.event('focus');h.flush();assert.equal(h.body.getAttribute('data-kn-ledger-dark'),'true');
  assert.equal(h.root.style.getPropertyValue('--kn-sh-button'),'#47745a');
  assert.ok(ratio('#47745a',h.root.style.getPropertyValue('--kn-ledger-on-button'))>=4.5);
  // Existing parent integration pushes tokens directly into the retained child frame.
  h.root.style.setProperty('--kn-sh-button','#b7d6f0');h.root.style.setProperty('--kn-sh-ink','#233747');h.flush();
  assert.equal(h.root.style.getPropertyValue('--kn-sh-button'),'#b7d6f0','unrelated root style mutations never restore stale local storage');
  assert.ok(ratio('#b7d6f0',h.root.style.getPropertyValue('--kn-ledger-on-button'))>=4.5);
});
test('financial line and bar presentation follows the palette without changing values or labels',()=>{
  const h=fixture(),line=h.chart('lineChart','line',[
    {label:'fixture-income',data:[100,200],borderColor:'var(--brand-color)',pointBackgroundColor:'var(--brand-color)',backgroundColor:'rgba(93,184,122,0.1)'},
    {label:'fixture-expense',data:[40,60],borderColor:'#e05050',pointBackgroundColor:'#e05050',backgroundColor:'rgba(224,80,80,0.07)'}
  ]),bar=h.chart('barChart','bar',[{label:'inc',data:[100,200],backgroundColor:'rgba(93,184,122,0.75)'},{label:'exp',data:[40,60],backgroundColor:'rgba(224,80,80,0.7)'},{label:'inv',data:[10,20],backgroundColor:'rgba(43,168,136,0.7)'}]);
  const before=[line,bar].map(c=>({labels:copy(c.data.labels),series:c.data.datasets.map(d=>({label:d.label,data:copy(d.data)}))}));
  h.event('kkChartsReady');h.flush();
  assert.equal(line.data.datasets[0].borderColor,defaults.button);assert.equal(line.data.datasets[1].pointBackgroundColor,defaults.muted);
  assert.deepEqual(copy(line.data.datasets[1].borderDash),[4,3]);assert.equal(bar.data.datasets[2].backgroundColor,'rgba(61,75,60,0.75)');
  assert.deepEqual([line,bar].map(c=>({labels:copy(c.data.labels),series:c.data.datasets.map(d=>({label:d.label,data:copy(d.data)}))})),before);
  assert.ok([...line.updates,...bar.updates].every(mode=>mode==='none'));
});
test('concrete canvas colors and all numeric line styles update after a local color change',()=>{
  const h=fixture(),line=h.chart('lineChart','line',[{data:[100]},{data:[50]}]);
  h.event('kkChartsReady');h.flush();const previous=line.data.datasets[0].borderColor;
  h.root.style.setProperty('--brand-color','#4477cc');h.root.setAttribute('data-custom-brand-color','');h.flush();
  const first=line.data.datasets[0];assert.notEqual(first.borderColor,previous);assert.match(first.borderColor,/^rgba\(/);
  for(const name of ['borderColor','backgroundColor','pointBackgroundColor','pointBorderColor','pointHoverBackgroundColor','pointHoverBorderColor'])assert.doesNotMatch(first[name],/var\(|color-mix\(|color\(srgb/);
  assert.equal(first.pointHoverBackgroundColor,first.borderColor);assert.match(line.options.scales.x.ticks.color,/^rgba\(/);
});
test('parent dark token changes repaint numeric charts while preserving category palettes',()=>{
  const h=fixture({embedded:true}),line=h.chart('lineChart','line',[{data:[100]},{data:[40]}]);
  const colors=['#ff0099','#44cc88'],pie=h.chart('donutChart','pie',[{data:[20,30],backgroundColor:colors.slice(),borderColor:'#fff'}]),stack=h.chart('catStackChart','bar',[{data:[20],backgroundColor:'#ff0099'},{data:[30],backgroundColor:'#44cc88'}]);
  const categoryBefore=copy(stack.data);h.event('kkChartsReady');h.flush();
  for(const [key,value] of Object.entries({button:'#b7d6f0',muted:'#bfccc6',ink:'#eef3e8',paper:'#1c3027',line:'#3e5045'}))h.root.style.setProperty('--kn-sh-'+key,value);
  h.body.setAttribute('data-kn-ledger-dark','true');h.flush();
  assert.equal(line.data.datasets[0].borderColor,'#b7d6f0');assert.equal(line.data.datasets[1].borderColor,'#bfccc6');
  assert.equal(line.options.scales.x.grid.color,'#3e5045');assert.equal(pie.data.datasets[0].borderColor,'#1c3027');
  assert.deepEqual(pie.data.datasets[0].backgroundColor,colors);assert.deepEqual(copy(stack.data),categoryBefore);
});
test('button foreground meets 4.5:1 for dark, pale, bright and default palette buttons',()=>{
  const h=fixture();
  for(const button of ['#47745a','#b7d6f0','#f3da70','#e6f0d8','#777777',defaults.button]){
    h.root.style.setProperty('--kn-sh-button',button);h.root.style.setProperty('--kn-sh-paper','#1c3027');h.root.style.setProperty('--kn-sh-ink','#35493d');h.flush();
    assert.ok(ratio(button,h.root.style.getPropertyValue('--kn-ledger-on-button'))>=4.5,button);
  }
});
test('numeric strokes and points use readable ink when dark or pale role colors lack 3:1 contrast',()=>{
  const h=fixture(),line=h.chart('lineChart','line',[{data:[100]},{data:[40]}]),bar=h.chart('barChart','bar',[{data:[100]},{data:[40]},{data:[10]}]);
  h.event('kkChartsReady');h.flush();
  for(const palette of [
    {paper:'#1c3027',button:'#47745a',muted:'#506052',ink:'#e6eee2'},
    {paper:'#fdfcf6',button:'#b7d6f0',muted:'#c0c8bc',ink:'#3d4b3c'}
  ]){
    assert.ok(ratio(palette.button,palette.paper)<3,'fixture covers the low-contrast role');
    for(const [key,value] of Object.entries(palette))h.root.style.setProperty('--kn-sh-'+key,value);
    h.flush();
    for(const chart of [line,bar])for(const dataset of chart.data.datasets){
      assert.equal(dataset.borderColor,palette.ink);assert.equal(dataset.pointBackgroundColor,palette.ink);
      assert.ok(ratio(dataset.borderColor,palette.paper)>=3);assert.ok(ratio(dataset.pointBackgroundColor,palette.paper)>=3);
    }
    assert.deepEqual(copy(line.data.datasets[1].borderDash),[4,3]);
  }
});
test('pale palette captions use local readable ink and restore original muted after the palette changes',()=>{
  const h=fixture({embedded:true}),line=h.chart('lineChart','line',[{data:[100]},{data:[40]}]);
  h.event('kkChartsReady');h.flush();
  const paleMuted='color-mix(in srgb,#f9e0a6 32%,#5e7067)',paleInk='color-mix(in srgb,#f9e0a6 38%,#10251d)';
  h.root.style.setProperty('--kn-sh-paper','#fffdf6');h.root.style.setProperty('--kn-sh-muted',paleMuted);h.root.style.setProperty('--kn-sh-ink',paleInk);h.flush();
  const readable=h.body.style.getPropertyValue('--kn-ledger-muted');
  assert.ok(ratio('rgba(144,148,123,1)','#fffdf6')<4.5,'parent pale formula needs a local fallback');
  assert.ok(ratio(readable,'#fffdf6')>=4.5);assert.equal(line.options.plugins.legend.labels.color,readable);assert.equal(line.options.scales.x.ticks.color,readable);
  assert.equal(h.root.style.getPropertyValue('--kn-sh-muted'),paleMuted,'shared muted is unchanged');assert.equal(h.root.style.getPropertyValue('--kn-sh-ink'),paleInk,'shared ink is unchanged');
  h.root.style.setProperty('--kn-sh-paper','#1c3027');h.root.style.setProperty('--kn-sh-muted','#b8cbbf');h.root.style.setProperty('--kn-sh-ink','#e6eee2');h.body.setAttribute('data-kn-ledger-dark','true');h.flush();
  assert.equal(h.body.style.getPropertyValue('--kn-ledger-muted'),'#b8cbbf','readable shared muted is restored instead of retaining the old override');
  assert.ok(ratio(h.body.style.getPropertyValue('--kn-ledger-muted'),'#1c3027')>=4.5);
  const count=h.writes.length;h.flush();assert.equal(h.writes.length,count,'local override writes settle');
});
test('late Chart availability registers one palette plugin and updates retained charts',()=>{
  const h=fixture({lateChart:true});assert.equal(h.plugins.length,0);
  const line=h.chart('lineChart','line',[{data:[7]},{data:[3]}]);h.context.Chart=h.Chart;h.event('kkChartsReady');h.flush();
  h.event('kkChartsReady');h.flush();assert.equal(h.plugins.length,1);assert.equal(h.plugins[0].id,'knLedgerReading');assert.equal(line.data.datasets[0].borderColor,defaults.button);
});

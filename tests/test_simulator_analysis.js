'use strict';
// Local DOM/VM integration only; these fixtures do not verify a real browser,
// device, camera, account, network request or production publication.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const current=index.match(/var SIM_URL="([^"]+)"/);
assert.ok(current,'the site must identify its current immutable simulator');
const embedded=new URL(current[1],'https://simulator.fixture.test').pathname.replace(/^\//,'');
assert.match(embedded,/^static\/simulator-embed-[a-f0-9]{10}\.html$/);
const files=[...new Set(['simulator.html',embedded])];
const modes={
  daily:{prefix:'d',key:'d',amount:'d-amount',calculate:'calcD',final:'d-final',principal:'d-total'},
  monthly:{prefix:'m',key:'m',amount:'m-amount',calculate:'calcM',final:'m-final',principal:'m-total'},
  lump:{prefix:'lp',key:'l',amount:'lp-amount',calculate:'calcL',final:'lp-final',principal:'lp-principal'},
  goal:{prefix:'g',key:'g',amount:'g-target',calculate:'calcG',principal:'g-total'}
};
const plain=value=>JSON.parse(JSON.stringify(value));

function harness(file) {
  const html=fs.readFileSync(path.join(root,file),'utf8');
  const nodes=new Map(),events=new Map(),timers=new Map(),frames=new Map(),charts=[],requests=[];
  let sequence=0;
  class Element {
    constructor(tag='div') {
      this.tagName=tag.toUpperCase();this.type='';this.id='';this.className='';
      this.children=[];this.parentElement=null;this.attrs=new Map();this.events=new Map();
      this.dataset={};this.style={};this.textContent='';this.innerHTML='';this._value='';
      this.min='';this.max='';this.step='';this.offsetWidth=300;
      this.classList={
        contains:name=>this.className.split(/\s+/).includes(name),
        add:name=>{if(!this.classList.contains(name))this.className=(this.className+' '+name).trim();},
        remove:name=>{this.className=this.className.split(/\s+/).filter(x=>x!==name).join(' ');},
        toggle:(name,on)=>{if(on)this.classList.add(name);else this.classList.remove(name);}
      };
    }
    set value(value) {
      if(this.type==='range' && String(value)!=='' && Number.isFinite(Number(value))) {
        const min=this.min===''?0:Number(this.min),max=this.max===''?100:Number(this.max);
        const step=this.step===''?1:Number(this.step),n=Math.max(min,Math.min(max,Number(value)));
        value=Number((min+Math.round((n-min)/step)*step).toPrecision(15));
        value=Math.max(min,Math.min(max,value));
      }
      this._value=String(value);
    }
    get value(){return this._value;}
    setAttribute(name,value){this.attrs.set(name,String(value));}
    getAttribute(name){return this.attrs.get(name)??null;}
    addEventListener(name,fn){if(!this.events.has(name))this.events.set(name,[]);this.events.get(name).push(fn);}
    appendChild(child){child.parentElement=this;this.children.push(child);return child;}
    querySelector(selector){
      const matches=n=>selector[0]==='.'?n.classList.contains(selector.slice(1)):n.tagName===selector.toUpperCase();
      for(const child of this.children){if(matches(child))return child;const found=child.querySelector(selector);if(found)return found;}
      return null;
    }
  }
  for(const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
    const element=new Element(match[1]),attrs=match[2];
    element.id=match[3];element.type=attrs.match(/type="([^"]*)"/)?.[1]||'';
    element.className=attrs.match(/class="([^"]*)"/)?.[1]||'';
    for(const key of ['min','max','step'])element[key]=attrs.match(new RegExp(key+'="([^"]*)"'))?.[1]||'';
    element.value=attrs.match(/value="([^"]*)"/)?.[1]||'';
    nodes.set(element.id,element);
  }
  const chartParents=new Map();
  for(const mode of Object.values(modes)){
    const parent=new Element(),wrap=parent.appendChild(new Element());
    wrap.appendChild(nodes.get('chart-'+mode.key));chartParents.set(mode.key,parent);
  }
  const ranges=[...nodes.values()].filter(n=>n.type==='range');
  const document={hidden:false,readyState:'complete',documentElement:{lang:'ja'},
    getElementById:id=>nodes.get(id)||null,
    querySelectorAll:selector=>selector==='input[type=range]'?ranges:[],
    createElement:tag=>new Element(tag),
    addEventListener(name,fn){events.set(name,fn);}
  };
  const context={document,console,URLSearchParams,location:{origin:'https://simulator.fixture.test',search:'',hash:'#sim_attempt=fixture'},
    UID:'',localStorage:{getItem(){return null;},setItem(){}},
    performance:{now:()=>0},
    setTimeout(fn,ms){timers.set(++sequence,{fn,ms});return sequence;},
    clearTimeout:id=>timers.delete(id),
    requestAnimationFrame(fn){frames.set(++sequence,fn);return sequence;},
    cancelAnimationFrame:id=>frames.delete(id),
    fetch(url){requests.push(url);throw Error('Unexpected network in a local simulator fixture');}
  };
  context.window=context;context.parent={postMessage(){}};
  const coreStart=html.indexOf('let chartD,chartM,chartL,chartG;');
  const coreEnd=html.indexOf('    // ===== 複数株入力 =====',coreStart);
  assert.ok(coreStart>0 && coreEnd>coreStart);
  vm.runInNewContext(html.match(/const SIM_ATTEMPT=[^;]+;/)[0],context,{filename:file+':attempt'});
  vm.runInNewContext(html.slice(coreStart,coreEnd),context,{filename:file+':core'});
  const detail=html.match(/<script id="simulator-pro-enhance">([\s\S]*?)<\/script>/);
  assert.ok(detail,file+' must include its actual detailed-analysis script');
  vm.runInNewContext(detail[1],context,{filename:file+':analysis'});
  return {
    context,nodes,timers,frames,charts,requests,
    box(mode){return chartParents.get(modes[mode].key).querySelector('.sim-pro-box-'+modes[mode].key);},
    html(mode){const box=this.box(mode);assert.ok(box,'analysis must render immediately for '+mode);return box.innerHTML;},
    detailValue(mode,key='final'){
      return this.html(mode).match(new RegExp('data-sim-analysis-value="'+key+'"[^>]*>([^<]*)<'))?.[1]??null;
    },
    project(mode,{amount,rate=5,years=20}){
      const m=modes[mode];
      nodes.get(m.prefix+'-rate-n').value=rate;
      context.onInput(m.prefix+'-rate-n',m.prefix+'-rate');
      nodes.get(m.prefix+'-years-n').value=years;
      context.onInput(m.prefix+'-years-n',m.prefix+'-years');
      const field=nodes.get(m.amount+'-n');field.value=String(amount);
      // Exercise the actual accepted hand-input path, including native range
      // min/max/step conversion, rather than writing a hypothetical snapshot.
      context.moneyType(field,m.amount,context[m.calculate]);
      return context.__KN_SIMULATOR_RESULTS[mode];
    },
    calculate(mode){return context[modes[mode].calculate]();},
    enableCharts(){
      context.Chart=class {
        constructor(canvas,config){this.canvas=canvas;this.data=config.data;this.options=config.options;this.destroyed=false;charts.push(this);}
        destroy(){this.destroyed=true;}
      };
    }
  };
}
function equalFinal(h,mode,expected){
  assert.equal(h.detailValue(mode),expected,'detailed final amount');
  const main=modes[mode].final;
  if(main)assert.equal(h.nodes.get(main).textContent,expected,'summary final amount');
  assert.equal(h.requests.length,0,'no user-data or other network fetch');
}

for(const file of files) {
  test(file+': core snapshots render detail immediately and calculations share no delayed amount animation',()=>{
    const h=harness(file);
    for(const mode of Object.keys(modes)){
      const result=h.context.__KN_SIMULATOR_RESULTS[mode];
      assert.equal(result.valid,true);
      equalFinal(h,mode,h.context.formatProjectionMoney(result.finalAmount));
    }
    const timerCount=h.timers.size;
    const result=h.project('monthly',{amount:30000});
    assert.equal(result.finalAmount,12223733); // Independent Decimal recurrence.
    equalFinal(h,'monthly','1,222万3,733円');
    assert.equal(h.frames.size,0,'no intermediate countUp amount can disagree with analysis');
    assert.equal(h.timers.size,timerCount,'no delayed200ms analysis refresh');
  });

  test(file+': actual hand-entered monthly amount wins over the clamped slider minimum',()=>{
    const h=harness(file),result=h.project('monthly',{amount:30000});
    assert.equal(Number(h.nodes.get('m-amount').value),100000);
    assert.equal(Number(h.nodes.get('m-amount-n').dataset.raw),30000);
    assert.equal(result.amount,30000);assert.equal(result.principal,7200000);
    equalFinal(h,'monthly','1,222万3,733円');
    assert.equal(h.nodes.get('m-total').textContent,'720万円');
    assert.equal(h.nodes.get('m-gain').textContent,'+502万3,733円');
  });

  test(file+': fractional input above the slider maximum is preserved by header and analysis',()=>{
    const h=harness(file),result=h.project('monthly',{amount:5000000.5,years:2});
    assert.equal(Number(h.nodes.get('m-amount').value),3000000);
    assert.equal(Number(h.nodes.get('m-amount-n').dataset.raw),5000000.5);
    assert.equal(result.principal,120000012);
    // 75-digit Decimal recurrence, rounded to the input one-decimal precision.
    assert.equal(result.finalAmount,126306432.3);
    equalFinal(h,'monthly','1億2,630万6,432.3円');
    assert.equal(h.nodes.get('m-total').textContent,'1億2,000万12円');
    assert.match(h.html('monthly'),/入力額と同じ小数桁/);
  });

  test(file+': accepted222.2-oku input is not silently capped to the old10-billion limit',()=>{
    const h=harness(file),result=h.project('lump',{amount:22220000000,rate:0,years:1});
    assert.equal(Number(h.nodes.get('lp-amount-n').dataset.raw),22220000000);
    assert.equal(result.valid,true);assert.equal(result.amount,22220000000);
    assert.equal(result.finalAmount,22220000000);
    equalFinal(h,'lump','222億2,000万円');
    assert.equal(h.nodes.get('lp-principal').textContent,'222億2,000万円');
  });

  test(file+': zero and tiny positive returns stay finite despite the stale nonzero rate slider',()=>{
    const h=harness(file);
    let result=h.project('monthly',{amount:30000,rate:0,years:2});
    assert.equal(Number(h.nodes.get('m-rate').value),5,'zero numeric entry need not change the range');
    assert.equal(result.finalAmount,720000);equalFinal(h,'monthly','72万円');
    assert.equal(h.nodes.get('m-gain').textContent,'0円');
    result=h.project('monthly',{amount:100000,rate:1e-15,years:20});
    assert.equal(result.valid,true);assert.equal(result.finalAmount,24000000);
    equalFinal(h,'monthly','2,400万円');
    result=h.project('daily',{amount:500,rate:1e-15,years:20});
    assert.equal(result.valid,true);assert.equal(result.finalAmount,3650000);
    equalFinal(h,'daily','365万円');
    assert.doesNotMatch(h.html('daily'),/NaN|Infinity|undefined/);
  });

  test(file+': negative returns retain losses and do not fabricate a tax credit',()=>{
    const h=harness(file),result=h.project('monthly',{amount:100000,rate:-20});
    assert.equal(result.valid,true);assert.equal(result.finalAmount,5266433);
    assert.equal(result.gain,-18733567);
    equalFinal(h,'monthly','526万6,433円');
    assert.equal(h.nodes.get('m-gain').textContent,'-1,873万3,567円');
    assert.equal(h.detailValue('monthly','after-tax'),'526万6,433円');
  });

  test(file+': goal mode uses the displayed rounded-up monthly contribution for actual projected assets',()=>{
    const h=harness(file),result=h.project('goal',{amount:10000000});
    assert.equal(result.monthlyContribution,24543);
    assert.equal(h.nodes.get('g-monthly').textContent,'2万4,543円');
    assert.equal(result.principal,5890320);assert.equal(result.finalAmount,10000236);
    assert.equal(h.nodes.get('g-total').textContent,'589万320円');
    assert.equal(h.nodes.get('g-gain').textContent,'+410万9,916円');
    equalFinal(h,'goal','1,000万236円');
    assert.match(h.html('goal'),/入力した目標額: 1,000万円/);
    assert.match(h.html('goal'),/その月額を実際に積み立てた結果/);
    assert.ok(result.finalAmount>=result.targetAmount);
  });

  test(file+': invalid zero-year input clears previous totals and detail rather than retaining success',()=>{
    const h=harness(file);h.project('monthly',{amount:30000});
    const old=h.detailValue('monthly');assert.ok(old);
    h.nodes.get('m-years-n').value='0';
    const invalid=h.calculate('monthly');
    assert.equal(invalid.valid,false);
    for(const id of ['m-total','m-gain','m-final'])assert.equal(h.nodes.get(id).textContent,'—');
    assert.equal(h.detailValue('monthly'),null);
    assert.match(h.html('monthly'),/入力を確認/);
    assert.doesNotMatch(h.html('monthly'),/data-sim-analysis-value|1,222万3,733/);
    const recovered=h.project('monthly',{amount:30000,rate:0,years:2});
    assert.equal(recovered.valid,true);equalFinal(h,'monthly','72万円');
  });

  test(file+': invalid money typing and blur cannot revive an earlier successful raw amount',()=>{
    const h=harness(file),input=h.nodes.get('m-amount-n');
    for(const invalid of ['0','','-500','-']){
      h.project('monthly',{amount:30000,rate:0,years:2});
      assert.equal(h.nodes.get('m-final').textContent,'72万円');
      input.value=invalid;
      h.context.moneyType(input,'m-amount',h.context.calcM);
      assert.equal(h.context.__KN_SIMULATOR_RESULTS.monthly.valid,false,'invalid typed amount '+JSON.stringify(invalid));
      for(const id of ['m-total','m-gain','m-final'])assert.equal(h.nodes.get(id).textContent,'—');
      assert.equal(h.detailValue('monthly'),null);
      assert.match(h.html('monthly'),/入力を確認/);
      assert.notEqual(Number(input.dataset.raw),30000,'invalid text must invalidate the saved raw amount');
      h.context.moneyBlur(input,'m-amount',h.context.calcM);
      assert.equal(h.context.__KN_SIMULATOR_RESULTS.monthly.valid,false,'blur must not restore old amount');
      assert.equal(h.nodes.get('m-final').textContent,'—');
      assert.equal(h.detailValue('monthly'),null);
      assert.notEqual(Number(input.dataset.raw),30000);
      assert.notEqual(input.value,h.context.fmtInput(30000));
    }
    let recovered=h.project('monthly',{amount:'1,234.5',rate:0,years:1});
    assert.equal(recovered.valid,true);assert.equal(recovered.amount,1234.5);
    equalFinal(h,'monthly','1万4,814円');
    h.context.moneyBlur(input,'m-amount',h.context.calcM);
    assert.equal(Number(input.dataset.raw),1234.5,'valid comma input retains exact fractional raw value on blur');
    recovered=h.project('lump',{amount:'2.222e10',rate:0,years:1});
    assert.equal(recovered.valid,true);assert.equal(recovered.amount,22220000000);
    equalFinal(h,'lump','222億2,000万円');
  });

  test(file+': NISA annual comparison uses annual purchases and keeps lifetime and tax assumptions separate',()=>{
    const h=harness(file),result=h.project('monthly',{amount:20000,rate:0});
    assert.equal(result.annualContribution,240000);assert.equal(result.principal,4800000);
    assert.match(h.html('monthly'),/1年目の購入額: 24万円 — 成人NISAの年間総枠360万円と比較（総枠以内の参考値）/);
    assert.match(h.html('monthly'),/売却しない場合の期間購入額: 480万円/);
    assert.match(h.html('monthly'),/つみたて投資枠120万円／年・成長投資枠240万円／年/);
    assert.match(h.html('monthly'),/正の運用益だけに20.315％/);
    assert.match(h.html('monthly'),/最後に全額売却する概算/);
    h.project('monthly',{amount:200000,rate:0});
    assert.match(h.html('monthly'),/1年目の購入額: 240万円 — 成人NISAの年間総枠360万円と比較（総枠以内の参考値）/);
    assert.match(h.html('monthly'),/売却しない場合の期間購入額: 4,800万円 — 成人NISAの非課税保有限度総額1800万円と比較（総枠を超える参考値）/);
  });

  test(file+': non-JPY language results use their currency and omit Japanese tax or NISA claims',()=>{
    const h=harness(file);
    for(const [lang,expected] of [['en','$1,232,258'],['ko','1,232,258원'],['zh','1,232,258元']]){
      h.context.setLang(lang);
      const result=h.project('monthly',{amount:100000,rate:5,years:1});
      assert.equal(result.finalAmount,1232258);equalFinal(h,'monthly',expected);
      assert.doesNotMatch(h.html('monthly'),/20\.315|NISA|金融庁|国税庁|¥|税引/);
      assert.equal(h.detailValue('monthly','after-tax'),null);
      assert.ok(h.detailValue('monthly','gain'));
    }
  });

  test(file+': a late Chart redraw preserves input values, snapshots and exact detailed amounts',()=>{
    const h=harness(file);
    h.project('daily',{amount:500,rate:0,years:2});
    h.project('monthly',{amount:5000000.5,rate:5,years:2});
    h.project('lump',{amount:22220000000,rate:0,years:1});
    h.project('goal',{amount:10000000,rate:5,years:20});
    const before=plain(h.context.__KN_SIMULATOR_RESULTS),markup=Object.fromEntries(Object.keys(modes).map(mode=>[mode,h.html(mode)]));
    const inputState=[...h.nodes].filter(([,n])=>n.tagName==='INPUT').map(([id,n])=>[id,n.value,n.dataset.raw]);
    h.enableCharts();h.context.__knSimulatorChartsLoaded();
    assert.deepEqual(plain(h.context.__KN_SIMULATOR_RESULTS),before);
    assert.deepEqual([...h.nodes].filter(([,n])=>n.tagName==='INPUT').map(([id,n])=>[id,n.value,n.dataset.raw]),inputState);
    assert.equal(h.charts.length,4);
    for(const [i,mode]of Object.keys(modes).entries()){
      assert.equal(h.charts[i].data.datasets[1].data.at(-1),before[mode].finalAmount);
      assert.equal(h.charts[i].data.datasets[0].data.at(-1),before[mode].principal);
      assert.equal(h.html(mode),markup[mode]);
      equalFinal(h,mode,h.context.formatProjectionMoney(before[mode].finalAmount));
    }
    h.context.__knSimulatorChartsLoaded();
    assert.ok(h.charts.slice(0,4).every(chart=>chart.destroyed));
    assert.equal(h.charts.length,8);
    assert.deepEqual(plain(h.context.__KN_SIMULATOR_RESULTS),before);
  });
}

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../static/home-a.js'),'utf8');
const clockSource=source.slice(source.indexOf('  function startHomeClock()'),source.indexOf('  function renderMarkets()'));

function harness(at='2026-11-10T14:59:59.500Z',hidden=false){
  let now=Date.parse(at),language='ja',sequence=0,dateRenders=0,reduced=false;
  const animationRecords=[],motionListeners=[];
  class Node {
    constructor(){this.children=[];this.parentNode=null;this.attributes={};this.className='';this.value='';}
    get textContent(){return this.children.length?this.children.map(n=>n.textContent).join(''):this.value;}
    set textContent(value){this.children.forEach(n=>n.parentNode=null);this.children=[];this.value=value;}
    appendChild(child){this.children.push(child);child.parentNode=this;return child;}
    remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;}}
    setAttribute(key,value){this.attributes[key]=value;}
    getAttribute(key){return this.attributes[key];}
    querySelectorAll(selector){return this.children.flatMap(child=>[...(child.className.split(' ').includes(selector.slice(1))?[child]:[]),...child.querySelectorAll(selector)]);}
    animate(frames,options){const animation={frames,options,target:this,cancelled:false,onfinish:null,cancel(){this.cancelled=true;}};animationRecords.push(animation);return animation;}
  }
  const timers=new Map(),events=new Map(),numbers=Array.from({length:3},()=>{const n=new Node();n.textContent='--';return n;});
  const time={},zone={textContent:''};
  const clock={querySelector:q=>q==='time'?time:zone,querySelectorAll:()=>numbers};
  const add=(name,fn)=>{const group=events.get(name)||[];group.push(fn);events.set(name,group);};
  const document={hidden,createElement:()=>new Node(),getElementById:id=>id==='knHomeAClock'?clock:null,addEventListener:add};
  const window={addEventListener:add,matchMedia:()=>({get matches(){return reduced;},addEventListener(name,fn){motionListeners.push(fn);}})};
  class WallDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const ctx={window,document,Date:WallDate,Intl,lang:()=>language,renderDate:()=>dateRenders++,
    setTimeout(fn,delay){const id=++sequence;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id),
    renderMarkets(){throw new Error('clock must not render market data');},fetch(){throw new Error('clock must not fetch');}};
  vm.runInNewContext(clockSource+'\nstartHomeClock();',ctx);
  return {time,zone,numbers,timers,events,document,
    digits:()=>numbers.map(n=>n.querySelectorAll('.kn-a-clock-current').map(d=>d.textContent).join('')).join(':'),dateRenders:()=>dateRenders,animations:()=>animationRecords.length,animationRecords,outgoing:()=>numbers.flatMap(n=>n.querySelectorAll('.kn-a-clock-outgoing')),
    mountAgain(){ctx.startHomeClock();},reduced(value){reduced=value;motionListeners.forEach(fn=>fn());},language(value){language=value;},
    fire(name){(events.get(name)||[]).forEach(fn=>fn());},
    jump(iso){now=Date.parse(iso);},
    step(){const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];now=timer.at;timers.delete(id);timer.fn();}
  };
}

test('JST midnight uses00 hours and updates the date from the same live clock',()=>{
  const h=harness();assert.equal(h.digits(),'23:59:59');assert.equal(h.dateRenders(),1);
  h.step();assert.equal(h.digits(),'00:00:00');assert.equal(h.dateRenders(),2);
  assert.equal(h.time.dateTime,'2026-11-10T15:00:00.000Z');assert.equal(h.timers.size,1);
  h.step();assert.equal(h.digits(),'00:00:01');assert.equal(h.dateRenders(),2);
});
test('hidden, pagehide and visible/pageshow resynchronize to wall time without duplicate timers',()=>{
  const h=harness();h.mountAgain();assert.equal(h.timers.size,1);
  h.document.hidden=true;h.fire('visibilitychange');assert.equal(h.timers.size,0);
  h.jump('2026-11-11T05:12:37Z');h.document.hidden=false;h.fire('visibilitychange');
  assert.equal(h.digits(),'14:12:37');assert.equal(h.timers.size,1);
  h.fire('pagehide');assert.equal(h.timers.size,0);h.fire('langChanged');assert.equal(h.timers.size,0);
  h.fire('pageshow');h.fire('visibilitychange');assert.equal(h.timers.size,1);
});
test('reduced motion keeps accurate ticking while language changes preserve the timer',()=>{
  const h=harness('2026-11-10T00:00:00Z');h.reduced(true);h.step();
  assert.equal(h.digits(),'09:00:01');assert.equal(h.animations(),0);
  h.language('en');h.fire('langChanged');assert.equal(h.zone.textContent,'Japan time');assert.equal(h.timers.size,1);
  h.reduced(false);h.step();assert.equal(h.animations(),2);
});
test('the home clock is outside the date replacement and never becomes a live announcement',()=>{
  assert.match(source,/<div id="knHomeADate"><\/div><div id="knHomeAClock"[^>]*role="timer" aria-live="off"/);
  assert.equal(clockSource.includes('fetch('),false);
});


test('only the changing digit falls from above while its old value exits downwards',()=>{
  const h=harness('2026-11-10T00:00:00Z');h.step();
  assert.equal(h.digits(),'09:00:01');assert.equal(h.animations(),2);
  const [leave,enter]=h.animationRecords;
  assert.equal(leave.frames.at(-1).transform,'translateY(110%)');
  assert.equal(enter.frames[0].transform,'translateY(-110%)');
  assert.equal(enter.frames.at(-1).transform,'translateY(0)');
  assert.equal(enter.options.duration,520);
  assert.equal(h.outgoing().length,1);assert.equal(h.outgoing()[0].getAttribute('aria-hidden'),'true');
});
test('interrupting a falling digit removes old layers and never lets stale finish callbacks remove new ones',()=>{
  const h=harness('2026-11-10T00:00:00Z');h.step();
  const oldFinish=h.animationRecords[0].onfinish;
  h.document.hidden=true;h.fire('visibilitychange');
  assert.equal(h.outgoing().length,0);assert.ok(h.animationRecords.every(a=>a.cancelled));
  h.document.hidden=false;h.fire('visibilitychange');h.step();
  assert.equal(h.digits(),'09:00:02');assert.equal(h.outgoing().length,1);
  oldFinish();assert.equal(h.outgoing().length,1);
  h.reduced(true);assert.equal(h.outgoing().length,0);
  h.step();assert.equal(h.digits(),'09:00:03');assert.equal(h.outgoing().length,0);
});

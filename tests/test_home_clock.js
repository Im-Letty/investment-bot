'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../static/home-a.js'),'utf8');
const clockSource=source.slice(source.indexOf('  function startHomeClock()'),source.indexOf('  function renderMarkets()'));

function harness(at='2026-11-10T14:59:59.500Z',hidden=false){
  let now=Date.parse(at),language='ja',sequence=0,dateRenders=0,animations=0,reduced=false;
  const timers=new Map(),events=new Map(),numbers=Array.from({length:3},()=>({textContent:'--',animate(){animations++;}}));
  const time={},zone={textContent:''};
  const clock={querySelector:q=>q==='time'?time:zone,querySelectorAll:()=>numbers};
  const add=(name,fn)=>{const group=events.get(name)||[];group.push(fn);events.set(name,group);};
  const document={hidden,getElementById:id=>id==='knHomeAClock'?clock:null,addEventListener:add};
  const window={addEventListener:add,matchMedia:()=>({get matches(){return reduced;}})};
  class WallDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const ctx={window,document,Date:WallDate,Intl,lang:()=>language,renderDate:()=>dateRenders++,
    setTimeout(fn,delay){const id=++sequence;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id),
    renderMarkets(){throw new Error('clock must not render market data');},fetch(){throw new Error('clock must not fetch');}};
  vm.runInNewContext(clockSource+'\nstartHomeClock();',ctx);
  return {time,zone,numbers,timers,events,document,
    digits:()=>numbers.map(n=>n.textContent).join(':'),dateRenders:()=>dateRenders,animations:()=>animations,
    mountAgain(){ctx.startHomeClock();},reduced(value){reduced=value;},language(value){language=value;},
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
  h.reduced(false);h.step();assert.equal(h.animations(),1);
});
test('the home clock is outside the date replacement and never becomes a live announcement',()=>{
  assert.match(source,/<div id="knHomeADate"><\/div><div id="knHomeAClock"[^>]*role="timer" aria-live="off"/);
  assert.equal(clockSource.includes('fetch('),false);
});

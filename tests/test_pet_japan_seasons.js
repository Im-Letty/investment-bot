'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const Seasons=require('../static/pet-japan-seasons.js');
const at=s=>Date.parse(s);
test('four Japanese calendar edges switch at Japan midnight, not UTC midnight',()=>{
 for(const [stamp,before,after]of [['2026-02-28T15:00:00Z','winter','spring'],['2026-05-31T15:00:00Z','spring','summer'],['2026-08-31T15:00:00Z','summer','autumn'],['2026-11-30T15:00:00Z','autumn','winter']]){
  const n=at(stamp),old=Seasons.resolve(n-1),next=Seasons.resolve(n);
  assert.equal(old.key,before);assert.equal(next.key,after);assert.equal(old.nextDayAt,n);assert.equal(next.nextDayAt,n+86400000);assert.match(next.dateJst,/-01$/);
 }
});
test('all twelve months and leap/year boundaries are independent of the OS timezone',()=>{
 const expected=['winter','winter','spring','spring','spring','summer','summer','summer','autumn','autumn','autumn','winter'];
 for(let i=0;i<12;i++)assert.equal(Seasons.resolve(Date.UTC(2026,i,15)).key,expected[i]);
 assert.equal(Seasons.resolve(at('2024-02-29T14:59:59.999Z')).dateJst,'2024-02-29');
 assert.equal(Seasons.resolve(at('2024-02-29T15:00:00Z')).key,'spring');
 assert.equal(Seasons.resolve(at('2026-12-31T15:00:00Z')).dateJst,'2027-01-01');
 const entry=require.resolve('../static/pet-japan-seasons.js');
 const script='process.stdout.write(JSON.stringify(require('+JSON.stringify(entry)+').resolve('+at('2026-05-31T15:00:00Z')+')))';
 const results=['UTC','Pacific/Honolulu','Asia/Tokyo'].map(TZ=>{
  const p=spawnSync(process.execPath,['-e',script],{env:{...process.env,TZ},encoding:'utf8'});assert.equal(p.status,0);return p.stdout;
 });assert.equal(new Set(results).size,1);
});
test('invalid clocks and keys are rejected without guessing a season; profiles are immutable',()=>{
 for(const ms of [NaN,Infinity,-Infinity,undefined,null,'2026-03-01',8.64e15])assert.equal(Seasons.resolve(ms),null);
 for(const key of ['','__proto__','rainy','Spring'])assert.equal(Seasons.profile(key),null);
 assert.equal(Object.isFrozen(Seasons.profiles),true);assert.equal(Object.isFrozen(Seasons.profile('winter').foliage),true);
 assert.throws(()=>{Seasons.profile('winter').ground='#fff';},TypeError);
});
function clock(){
 let ms=at('2026-05-31T14:59:59.999Z'),seq=0,enabled=true,sub,removed=0;
 const timers=new Map(),changes=[];
 const options={now:()=>ms,enabled:()=>enabled,onChange:s=>changes.push(s),
  setTimeout:(fn,delay)=>{timers.set(++seq,{fn,delay});return seq;},clearTimeout:id=>timers.delete(id),
  subscribe:fn=>{sub=fn;return()=>{removed++;sub=null;};}};
 const watcher=Seasons.watch(options);
 return{watcher,timers,changes,set:v=>{ms=v;},enable:v=>{enabled=v;},notify:()=>sub?.(),get removed(){return removed;}};
}
test('watch changes once at the exact JST edge and once per changed date with one bounded timer',()=>{
 const f=clock();assert.equal(f.changes[0].key,'spring');assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0].delay,1);
 f.set(at('2026-05-31T15:00:00Z'));[...f.timers.values()][0].fn();assert.equal(f.changes.at(-1).key,'summer');assert.equal(f.changes.length,2);assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0].delay,60000);
 f.notify();assert.equal(f.changes.length,2);f.set(at('2026-06-01T15:00:00Z'));f.notify();assert.equal(f.changes.length,3);assert.equal(f.changes.at(-1).key,'summer');
 f.watcher.destroy();assert.equal(f.timers.size,0);assert.equal(f.removed,1);
});
test('hidden/disabled clocks wait for a valid resumed value; stale callbacks cannot resurrect a destroyed watcher',()=>{
 const f=clock();f.enable(false);f.set(at('2026-11-30T15:00:00Z'));f.notify();assert.equal(f.changes.length,1);
 f.enable(true);f.set(NaN);f.notify();assert.equal(f.changes.length,1);assert.equal(f.timers.size,1);
 f.set(at('2026-11-30T15:00:00Z'));f.notify();assert.equal(f.changes.at(-1).key,'winter');
 const old=[...f.timers.values()][0].fn;f.watcher.destroy();f.watcher.destroy();f.set(at('2027-03-01T15:00:00Z'));old();assert.equal(f.timers.size,0);assert.equal(f.changes.length,2);assert.equal(f.removed,1);
});

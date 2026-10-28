'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Town=require('../static/pet-town-walk.js'),Ocean=require('../static/pet-ocean-snorkeling.js'),Discoveries=require('../static/pet-ocean-discoveries.js');
function advance(api,ms){for(let t=0;t<ms;t+=50)api.step(Math.min(50,ms-t));return api.snapshot();}
function setup(options={}){
  const world=options.world||Town.createWorld(),habitat=options.habitat||Ocean.createHabitat(world,Town),changes=[],exits=[];
  let allowed=true;const api=Ocean.create({world,Town,habitat,onChange:s=>changes.push(s),onExit:p=>exits.push(p),canRun:()=>allowed,...options});
  return {world,habitat,api,changes,exits,allow:v=>{allowed=v;},enter(){assert.equal(api.enter(habitat.entry.dry),true);advance(api,1200);assert.equal(api.snapshot().phase,'surface');return api;}};
}
function domFixture(){
  let document;const rafs=new Map();let serial=0,clock=0;
  function target(){return {listeners:new Map(),addEventListener(k,fn){if(!this.listeners.has(k))this.listeners.set(k,new Set());this.listeners.get(k).add(fn);},removeEventListener(k,fn){this.listeners.get(k)?.delete(fn);},emit(k,values={}){const e={target:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...values};for(const fn of [...(this.listeners.get(k)||[])])fn(e);return e;}};}
  function node(tag,parent){const n=Object.assign(target(),{tagName:tag.toUpperCase(),parentNode:parent||null,isConnected:true,getAttribute(){return null;},focus(){document.activeElement=this;document.emit('focusin',{target:this});}});n.ownerDocument=document;return n;}
  const win=Object.assign(target(),{requestAnimationFrame(fn){const id=++serial;rafs.set(id,fn);return id;},cancelAnimationFrame(id){rafs.delete(id);}});
  document=Object.assign(target(),{hidden:false,defaultView:win});const body=node('body'),viewport=node('div',body),input=node('textarea',viewport),button=node('button',viewport),outside=node('button',body);document.body=body;document.activeElement=viewport;
  let tap=null;const f=setup({viewport,document,window:win,resolveTap:()=>tap,projectDirection:(x,y)=>({x,y})});
  return {...f,document,window:win,viewport,input,button,outside,rafs,tap:p=>{tap=p;},tick(ms){for(let elapsed=0;elapsed<ms;elapsed+=16){clock+=Math.min(16,ms-elapsed);const ready=[...rafs.values()];rafs.clear();ready.forEach(fn=>fn(clock));}},key(key,values={}){return document.emit('keydown',{target:viewport,key,...values});},up(key){return document.emit('keyup',{target:viewport,key});},pointer(kind,x=10,y=10,values={}){const o={target:viewport,pointerId:1,isPrimary:true,button:0,clientX:x,clientY:y,...values};return kind==='pointermove'?win.emit(kind,o):viewport.emit(kind,o);}};
}
test('the actual town supplies a reachable dry entry and bounded water on the existing southeast coast',()=>{
  assert.equal(Ocean.revision,'ocean-snorkeling1');const f=setup(),h=f.habitat;assert.ok(h);assert.equal(Town.isWalkable(f.world,h.entry.dry.x,h.entry.dry.y),true);assert.ok(Town.route(f.world,Town.spawn(f.world),h.entry.dry));assert.equal(Ocean.isWater(h,h.entry.water),true);assert.equal(Ocean.isWater(h,h.entry.dry),false);
  for(const y of [1500,1600,1730,1830])for(const gap of [85,110,350,650]){const p={x:Discoveries.coastX(y)+gap,y};assert.equal(Ocean.isWater(h,p),true);assert.ok(p.x>=h.seaBounds.minX&&p.x<=h.seaBounds.maxX&&p.y>=h.seaBounds.minY&&p.y<=h.seaBounds.maxY);}
  assert.deepEqual(Ocean.entryPoint(h),h.entry.dry);const copied=Ocean.entryPoint(h);copied.x=0;assert.notEqual(Ocean.entryPoint(h).x,0);
});
test('land, bridge, out-of-zone, out-of-sea and nonfinite coordinates are rejected',()=>{
  const h=setup().habitat;
  for(const p of [null,{x:NaN,y:1700},{x:Infinity,y:1700},{x:2600,y:1100},{x:Discoveries.coastX(1730)+84,y:1730},{x:Discoveries.coastX(1730)+651,y:1730},{x:3000,y:1499},{x:3000,y:1831},{x:h.seaBounds.maxX+1,y:1700}])assert.equal(Ocean.isWater(h,p),false);
  assert.equal(Ocean.isWater(null,{x:2600,y:1730}),false);assert.equal(Ocean.isWater(h,h.entry.water.x,h.entry.water.y),true);
});
test('entry selection scans around real solids and never claims an inaccessible route as available',()=>{
  const world=Town.createWorld(),first=Ocean.createHabitat(world,Town).entry.dry;world.places.push({id:'shore-obstruction',footprint:{x:first.x,y:first.y,rx:48,ry:48}});
  const h=Ocean.createHabitat(world,Town);assert.ok(h);assert.notEqual(h.entry.dry.y,first.y);assert.equal(Town.isWalkable(world,h.entry.dry.x,h.entry.dry.y),true);assert.ok(Town.route(world,Town.spawn(world),h.entry.dry));
  assert.equal(Ocean.createHabitat(world,{...Town,route:()=>null}),null);assert.equal(Ocean.createHabitat(world,{...Town,isWalkable:()=>false}),null);assert.equal(Ocean.createHabitat(null,Town),null);
});
test('water sweeps stop before real authored solid bounds without tunneling on a large request',()=>{
  const world=Town.createWorld(),y=1730,c=Discoveries.coastX(y);world.places.push({id:'ocean-solid',footprint:{x:c+300,y,rx:22,ry:22}});
  const h=Ocean.createHabitat(world,Town),from={x:c+110,y},to={x:c+500,y};assert.ok(h);assert.equal(Ocean.isWater(h,{x:c+300,y}),false);const moved=Ocean.sweep(h,from,to);assert.ok(moved.x>from.x);assert.ok(moved.x<c+260);assert.equal(Ocean.isWater(h,moved),true);assert.deepEqual(Ocean.sweep(h,from,{x:1e9,y}),from);
});
test('the four encounter anchors and observation conditions come from the shared canonical module',()=>{
  const h=setup().habitat,rows=Ocean.creatures(h);assert.deepEqual(rows,Discoveries.encounters);assert.equal(rows.length,4);assert.deepEqual(rows.map(r=>r.id),['shell','starfish','kelp','reef_fish']);
  rows[0].position.x=0;assert.notEqual(Ocean.creatures(h)[0].position.x,0);
  for(const row of h.creatures){assert.equal(Ocean.nearestDiscovery(h,row.position,'surface',0),null);assert.equal(Ocean.nearestDiscovery(h,row.position,'underwater',.79),null);assert.equal(Ocean.nearestDiscovery(h,row.position,'underwater',1.15).id,row.id);}
});
test('entry needs explicit near-shore input and never moves an arbitrary dry position',()=>{
  const f=setup(),dry=Ocean.entryPoint(f.habitat);assert.equal(f.api.snapshot().mode,'dry');assert.equal(f.api.snapshot().position,null);assert.equal(f.api.enter({x:dry.x-100,y:dry.y}),false);assert.equal(f.api.enter({x:dry.x+40,y:dry.y}),false);assert.equal(f.api.snapshot().position,null);
  assert.equal(f.api.enter(dry),true);assert.equal(f.api.snapshot().phase,'entering');assert.deepEqual(f.api.snapshot().position,dry);advance(f.api,1200);assert.equal(f.api.snapshot().mode,'surface');assert.deepEqual(f.api.snapshot().position,f.habitat.entry.water);assert.equal(f.api.enter(dry),false);assert.equal(f.exits.length,0);
});
test('diving and surfacing change presentation depth only and remain inside the same water zone',()=>{
  const f=setup();f.enter();const start=f.api.snapshot().position;assert.equal(f.api.dive(),true);advance(f.api,1000);assert.equal(f.api.snapshot().mode,'underwater');assert.equal(f.api.snapshot().depth,1.15);assert.deepEqual(f.api.snapshot().position,start);assert.equal(f.api.surface(),true);advance(f.api,1000);assert.equal(f.api.snapshot().depth,0);assert.equal(f.api.snapshot().mode,'surface');assert.equal(f.exits.length,0);
});
test('tap-style goals arrive and stop without changing the caller-owned goal or snapshot data',()=>{
  const f=setup();f.enter();const target={x:f.habitat.entry.water.x+90,y:1730};assert.equal(f.api.goTo(target),true);advance(f.api,1200);assert.deepEqual(f.api.snapshot().position,target);assert.equal(f.api.snapshot().moving,false);assert.equal(f.api.snapshot().destination,null);const snap=f.api.snapshot();snap.position.x=0;snap.entry.dry.x=0;assert.notEqual(f.api.snapshot().position.x,0);assert.notEqual(f.api.snapshot().entry.dry.x,0);
  assert.equal(f.api.goTo({x:0,y:0}),false);assert.deepEqual(f.api.snapshot().position,target);
});
test('far-water exit follows an explicit return intent then the original short landing corridor once',()=>{
  const f=setup();f.enter();const far={x:f.habitat.entry.water.x+350,y:1730};assert.equal(f.api.goTo(far),true);advance(f.api,3000);assert.deepEqual(f.api.snapshot().position,far);f.api.dive();advance(f.api,900);assert.equal(f.api.exit(),true);assert.equal(f.api.snapshot().returning,true);advance(f.api,5000);assert.equal(f.api.snapshot().mode,'dry');assert.deepEqual(f.api.snapshot().position,f.habitat.entry.dry);assert.deepEqual(f.exits,[f.habitat.entry.dry]);advance(f.api,1000);assert.equal(f.exits.length,1);
});
test('a new manual goal cancels a pending return and stop cancels it without automatic resumption',()=>{
  const f=setup();f.enter();f.api.goTo({x:f.habitat.entry.water.x+250,y:1730});advance(f.api,2200);f.api.exit();advance(f.api,200);const target={x:f.api.snapshot().position.x+40,y:1730};assert.equal(f.api.goTo(target),true);assert.equal(f.api.snapshot().returning,false);advance(f.api,800);assert.deepEqual(f.api.snapshot().position,target);f.api.exit();f.api.stop();const stopped=f.api.snapshot().position;advance(f.api,3000);assert.deepEqual(f.api.snapshot().position,stopped);assert.equal(f.exits.length,0);
});
test('paused entry requires a fresh command and may reverse to its validated original dry point',()=>{
  const f=setup();assert.equal(f.api.enter(f.habitat.entry.dry),true);advance(f.api,200);f.api.stop();const paused=f.api.snapshot();assert.equal(paused.transitionPaused,true);assert.equal(f.api.dive(),false);assert.equal(f.api.goTo(f.habitat.entry.water),false);advance(f.api,1000);assert.deepEqual(f.api.snapshot().position,paused.position);assert.equal(f.api.exit(),true);advance(f.api,1000);assert.equal(f.api.snapshot().mode,'dry');assert.deepEqual(f.exits,[f.habitat.entry.dry]);
});
test('a lifecycle reset works while canRun is false but validates the landing and never writes a new reward state',()=>{
  const f=setup();f.enter();f.api.goTo({x:f.habitat.entry.water.x+150,y:1730});advance(f.api,1500);f.allow(false);assert.equal(f.api.reset(),true);assert.equal(f.api.snapshot().mode,'dry');assert.deepEqual(f.api.snapshot().position,f.habitat.entry.dry);assert.deepEqual(f.exits,[f.habitat.entry.dry]);assert.equal('inventory' in f.api.snapshot(),false);assert.equal('rewards' in f.api.snapshot(),false);
  const blocked=setup();blocked.enter();blocked.world.places.push({id:'changed-shore',footprint:{...blocked.habitat.entry.dry,rx:50,ry:50}});assert.equal(blocked.api.reset(),false);assert.equal(blocked.api.snapshot().mode,'surface');
});
test('delta clamping, nonfinite deltas, and a denied canRun cannot cause large jumps or stale-input movement',()=>{
  const f=setup();f.enter();f.api.goTo({x:f.habitat.entry.water.x+300,y:1730});const before=f.api.snapshot().position;f.api.step(1e9);assert.ok(Math.hypot(f.api.snapshot().position.x-before.x,f.api.snapshot().position.y-before.y)<=6.75001);const after=f.api.snapshot().position;f.api.step(NaN);f.api.step(-1);assert.deepEqual(f.api.snapshot().position,after);f.allow(false);advance(f.api,100);f.allow(true);advance(f.api,1000);assert.deepEqual(f.api.snapshot().position,after);assert.equal(f.api.snapshot().destination,null);
});
test('manual arrows and WASD move only while held; key release stops without adding a direction pad',()=>{
  const f=domFixture();f.enter();const start=f.api.snapshot().position;assert.equal(f.key('ArrowRight').defaultPrevented,true);f.tick(600);assert.ok(f.api.snapshot().position.x>start.x);f.up('ArrowRight');const stopped=f.api.snapshot().position;f.tick(600);assert.deepEqual(f.api.snapshot().position,stopped);f.key('a');f.tick(300);f.up('a');assert.ok(f.api.snapshot().position.x<stopped.x);
});
test('forms, modifiers, composition and stale repeats cannot start swimming',()=>{
  const f=domFixture();f.enter();const start=f.api.snapshot().position;for(const values of [{ctrlKey:true},{altKey:true},{metaKey:true},{isComposing:true},{repeat:true}])assert.equal(f.key('ArrowRight',values).defaultPrevented,false);
  f.document.emit('keydown',{key:'ArrowRight',target:f.input});f.document.emit('keydown',{key:'ArrowRight',target:f.button});f.tick(600);assert.deepEqual(f.api.snapshot().position,start);
});
test('a camera drag that travels over eight pixels never turns into a movement tap even after returning to its start',()=>{
  const f=domFixture();f.enter();f.tap({x:f.habitat.entry.water.x+80,y:1730});const start=f.api.snapshot().position;f.pointer('pointerdown');f.pointer('pointermove',20,10);f.pointer('pointermove',10,10);f.pointer('pointerup');f.tick(1000);assert.deepEqual(f.api.snapshot().position,start);
  f.pointer('pointerdown');f.pointer('pointerup',12,11);f.tick(1000);assert.ok(f.api.snapshot().position.x>start.x);
});
test('nonprimary gestures, mismatched pointers, invalid targets and interactive taps cannot swim',()=>{
  const f=domFixture();f.enter();f.tap({x:0,y:0});const start=f.api.snapshot().position;f.pointer('pointerdown');f.pointer('pointerup');f.tap({x:start.x+80,y:start.y});f.pointer('pointerdown');f.pointer('pointerdown',10,10,{isPrimary:false,pointerId:2});f.pointer('pointerup');f.pointer('pointerdown');f.pointer('pointerup',10,10,{pointerId:2});f.pointer('pointerdown',10,10,{target:f.button});f.pointer('pointerup',10,10,{target:f.button});f.tick(1000);assert.deepEqual(f.api.snapshot().position,start);
});
test('blur, hidden document, pagehide, tab change and form focus stop held motion and require fresh input',()=>{
  for(const reason of ['blur','hidden','pagehide','tab','form','focusout','cancel']){
    const f=domFixture();f.enter();f.key('ArrowRight');f.tick(200);
    if(reason==='blur')f.window.emit('blur');if(reason==='hidden'){f.document.hidden=true;f.document.emit('visibilitychange');}if(reason==='pagehide')f.window.emit('pagehide');if(reason==='tab'){f.allow(false);f.tick(32);}if(reason==='form')f.input.focus();if(reason==='focusout')f.viewport.emit('focusout',{relatedTarget:f.outside});if(reason==='cancel')f.window.emit('pointercancel',{pointerId:1});
    const stopped=f.api.snapshot().position;f.document.hidden=false;f.allow(true);f.document.activeElement=f.viewport;f.tick(800);assert.deepEqual(f.api.snapshot().position,stopped,reason);assert.equal(f.api.snapshot().moving,false,reason);assert.equal(f.key('ArrowRight',{repeat:true}).defaultPrevented,false,reason);
  }
});
test('snapshot notifications remain bounded during continuous animation and callbacks cannot corrupt internal state',()=>{
  const f=domFixture();f.enter();f.changes.length=0;f.key('ArrowRight');f.tick(1000);assert.ok(f.changes.length<=31);const p=f.api.snapshot().position;f.changes.forEach(s=>{if(s.position)s.position.x=0;});assert.deepEqual(f.api.snapshot().position,p);
});
test('destroy removes its listeners and frame without moving, calling exit or mutating other controller state',()=>{
  const f=domFixture();f.enter();f.key('ArrowRight');f.tick(100);f.api.destroy();const p=f.api.snapshot().position;assert.equal(f.rafs.size,0);f.key('ArrowRight');f.pointer('pointerdown');f.pointer('pointerup');f.tick(1000);assert.deepEqual(f.api.snapshot().position,p);assert.equal(f.api.enter(f.habitat.entry.dry),false);assert.equal(f.exits.length,0);assert.equal(f.document.listeners.get('keydown').size,0);f.api.destroy();
});


test('a sub-step diagonal solid corner intersection cannot tunnel through a conservative geometry envelope',()=>{
  const world=Town.createWorld(),y=1730,c=Discoveries.coastX(y);world.places.push({id:'corner-solid',footprint:{x:c+300,y,rx:22,ry:22}});const h=Ocean.createHabitat(world,Town),corner={x:c+260,y:1690},from={x:corner.x-100,y:corner.y+100.1},to={x:corner.x+104,y:corner.y-103.9};assert.equal(Ocean.isWater(h,from),true);assert.equal(Ocean.isWater(h,to),true);const moved=Ocean.sweep(h,from,to);assert.ok(moved.x<corner.x);assert.ok(moved.y>corner.y);assert.equal(Ocean.isWater(h,moved),true);
});

test('reset on an already dry controller cannot teleport a dry character or duplicate an exit handoff',()=>{
  const f=setup();assert.equal(f.api.reset(),true);assert.equal(f.api.snapshot().position,null);assert.equal(f.exits.length,0);f.enter();f.api.exit();advance(f.api,1200);assert.equal(f.exits.length,1);f.api.reset();assert.equal(f.exits.length,1);
});

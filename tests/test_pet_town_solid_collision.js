'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Town = require('../static/pet-town-walk.js');
function isolated(id) {
  const place = Town.createWorld().places.find(p => p.id === id);
  place.footprint.x = 1200; place.footprint.y = 750;
  return { world: {width:2880,height:1920,places:[place]}, place };
}
for (const id of ['home','cafe','shop','playground']) test(id+' ground solid blocks a large cardinal pass while open ground stays traversable', () => {
  const {world,place} = isolated(id), c=place.footprint, b=Town.collisionBounds(place);
  for(const [sx,sy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const start={x:c.x+sx*400,y:c.y+sy*400};
    const end=Town.move(world,start,-sx*800,-sy*800);
    assert.ok(Town.isWalkable(world,end.x,end.y));
    assert.ok((end.x-c.x)*sx+(end.y-c.y)*sy>0,'never tunnels to the far side');
    assert.ok(Math.hypot(end.x-start.x,end.y-start.y)>100,'approach is manual movement, not frozen input');
  }
  const laneY=b.maxY+50, start={x:c.x-400,y:laneY};
  const past=Town.move(world,start,800,0);
  assert.ok(Math.abs(past.x-(start.x+800))<1e-8,'no invisible picture-sized blocker beyond the ground solid');
});
test('fountain actor-circle contacts match analytic ellipse normals at diagonal and cardinal angles', () => {
  const {world,place}=isolated('playground'),c=place.footprint;
  for(const theta of [0,Math.PI/12,Math.PI/4,Math.PI/2,2.1,Math.PI,4.2,5.7]) {
    const ex=78*Math.cos(theta),ey=58.5*Math.sin(theta);
    const nx=Math.cos(theta)/78,ny=Math.sin(theta)/58.5,n=Math.hypot(nx,ny);
    const p=d=>({x:c.x+ex+nx/n*d,y:c.y+ey+ny/n*d});
    let inner=p(17.99),outer=p(18.01);
    assert.equal(Town.isWalkable(world,inner.x,inner.y),false,'visible ellipse cannot cut into existing actor radius');
    assert.equal(Town.isWalkable(world,outer.x,outer.y),true,'outside the radius stays open');
  }
});
test('building step and both ground pots block feet while doorway approaches stay reachable', () => {
  const {world,place}=isolated('home'),c=place.footprint,d=Town.solidDimensions(place);
  for(const x of [-d.potX*100,0,d.potX*100]) {
    assert.equal(Town.isWalkable(world,c.x+x,c.y+d.depth*50+13),false);
  }
  const contact=Town.doorContact(place),approach={x:contact.x,y:contact.y+12};
  assert.equal(Town.isWalkable(world,contact.x,contact.y),true);
  assert.equal(Town.isWalkable(world,contact.x,contact.y-1),false);
  const path=Town.route(world,{x:c.x-400,y:c.y-300},approach);
  assert.ok(path?.length>1,'front door is reached by walking around the solid wall');
  assert.deepEqual(path.at(-1),approach);
});
test('changing a layout footprint invalidates derived collision without mutating world or save data', () => {
  const {world,place}=isolated('shop'),old={x:place.footprint.x,y:place.footprint.y};
  assert.equal(Town.isWalkable(world,old.x,old.y),false);
  place.footprint.x+=400;
  const serialized=JSON.stringify(world);
  assert.equal(Town.isWalkable(world,old.x,old.y),true);
  assert.equal(Town.isWalkable(world,place.footprint.x,place.footprint.y),false);
  assert.equal(JSON.stringify(world),serialized);
  const layout={items:[{id:'home',x:15,y:22},{id:'shop',x:60,y:70}]},saved=JSON.stringify(layout);
  const rebuilt=Town.createWorld(layout),inside=rebuilt.places[0].footprint;
  assert.ok(Town.isWalkable(rebuilt,Town.spawn(rebuilt,inside).x,Town.spawn(rebuilt,inside).y));
  assert.equal(JSON.stringify(layout),saved);
});

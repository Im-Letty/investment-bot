'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Town=require('../static/pet-town-walk.js'),Scene=require('../static/pet-village-economy-scene.js');
class Events{constructor(){this.listeners={};}addEventListener(k,f){(this.listeners[k]??=new Set()).add(f);}removeEventListener(k,f){this.listeners[k]?.delete(f);}emit(k){for(const f of this.listeners[k]||[])f();}}
class Element extends Events{
 constructor(doc,tag){super();this.ownerDocument=doc;this.tagName=tag;this.children=[];this.style={};this.dataset={};this.attrs={};this.isConnected=true;}
 appendChild(el){el.parentNode=this;this.children.push(el);return el;}
 removeChild(el){this.children.splice(this.children.indexOf(el),1);el.parentNode=null;el.isConnected=false;}
 setAttribute(k,v){this.attrs[k]=v;}
}
function fixture(){const doc=new Events();doc.hidden=false;doc.createElement=tag=>new Element(doc,tag);return {doc,surface:new Element(doc,'div'),world:Town.createWorld()};}
function view(){return {shops:[{id:'cafe',name:'おやつのお店',status:'funding'},{id:'garden',name:'森の八百屋',status:'building'},{id:'bakery',name:'パンのお店',status:'open'}],residents:[{id:'a',name:'こはる'},{id:'b',name:'くるみ'}],visitors:[{id:'t',name:'旅人ポポ'}]};}

test('three new project sites respect saved landmarks, dry ground and entrance support without modifying their inputs',()=>{
 const world=Town.createWorld(),v=view(),before=JSON.stringify({world,v}),sites=Scene.projectSites(world,v);
 assert.equal(sites.length,3);assert.equal(JSON.stringify({world,v}),before);
 for(const site of sites){assert.ok(Town.isWalkable(world,site.entrance.x,site.entrance.y));assert.ok(Town.isWalkable(world,site.x-110,site.y-75));assert.ok(Town.isWalkable(world,site.x+110,site.y-75));assert.ok(Town.isWalkable(world,site.x,site.y-165));for(const old of world.places)assert.ok(Math.hypot(site.x-old.x,site.y-old.y)>=360);}
 for(let i=0;i<sites.length;i++)for(let j=i+1;j<sites.length;j++)assert.ok(Math.hypot(sites[i].x-sites[j].x,sites[i].y-sites[j].y)>=360);
});

test('the two actual shops retain safe visible sites across differently arranged saved villages',()=>{
 for(let seed=0;seed<32;seed++){
  const ids=['home','cafe','shop','playground','tree','flowers'],layout={items:ids.map((id,i)=>({id,x:15+(seed*17+i*23)%70,y:16+(seed*11+i*19)%68}))};
  const before=JSON.stringify(layout),world=Town.createWorld(layout),v={shops:view().shops.slice(0,2)},sites=Scene.projectSites(world,v);
  assert.equal(sites.length,2,'saved arrangement '+seed);assert.equal(JSON.stringify(layout),before);
  for(const site of sites)assert.ok(Town.isWalkable(world,site.entrance.x,site.entrance.y));
 }
});

test('funding, actual construction and open store have distinct descriptions and building art only appears for open stores',()=>{
 const {doc,surface,world}=fixture(),v=view(),before=JSON.stringify(v),old=world.places.slice();
 const controller=Scene.mount({worldElement:surface,world,view:v});
 const projects=surface.children.filter(el=>el.className==='pve-scene-project');assert.equal(projects.length,3);
 assert.match(projects[0].attrs['aria-label'],/募集中/);assert.match(projects[1].attrs['aria-label'],/建設中/);assert.match(projects[2].attrs['aria-label'],/開店/);
 assert.equal(projects[0].children.some(el=>el.tagName==='img'),false);assert.equal(projects[1].children.some(el=>el.tagName==='img'),false);assert.equal(projects[2].children.some(el=>el.tagName==='img'),true);
 assert.equal(JSON.stringify(v),before);assert.equal(world.places.length,9);assert.deepEqual(world.places.slice(0,6),old);
 for(const p of world.places.slice(6))assert.equal(Town.isWalkable(world,p.footprint.x,p.footprint.y),false,'the character cannot pass through a new shop');
 const start=Town.spawn(world);assert.ok(Town.isWalkable(world,start.x,start.y));for(const p of old.filter(p=>['home','shop'].includes(p.id)))assert.ok(Town.route(world,start,p.entrance));
 controller.dispose();assert.deepEqual(world.places,old);assert.equal(surface.children.length,0);assert.equal(doc.listeners.visibilitychange.size,0);controller.dispose();assert.deepEqual(world.places,old);
});

test('residents and tourists are separate named scene sprites with a strict nine-person maximum and no game commands',()=>{
 const {surface,world}=fixture(),v=view();v.residents=Array.from({length:20},(_,i)=>({id:'r'+i,name:'住人'+i}));v.visitors=Array.from({length:20},(_,i)=>({id:'t'+i,name:'旅人'+i}));let commands=0;
 const controller=Scene.mount({worldElement:surface,world,view:v,onOpenMarket(){commands++;}}),people=surface.children.filter(el=>el.className==='pve-scene-person');
 assert.equal(people.length,9);assert.equal(people.filter(el=>el.dataset.visitor==='true').length,3);assert.equal(people.filter(el=>el.dataset.visitor==='false').length,6);
 assert.ok(surface.children.every(el=>el.tagName!=='button'));assert.equal(commands,0);
 for(const p of people){assert.match(p.attrs['aria-label'],/住人|お客さん/);assert.equal(p.children[0].src,'/static/pet_lilac_reference_v2.png');assert.equal(p.style.zIndex,String(Math.round(Number.parseFloat(p.style.top))));}
 controller.dispose();assert.equal(commands,0);
});

test('detached or denied scenes add no objects, listeners or collision footprints',()=>{
 for(const mode of ['detached','denied']){const {surface,world,doc}=fixture(),before=JSON.stringify(world);if(mode==='detached')surface.isConnected=false;
 const controller=Scene.mount({worldElement:surface,world,view:view(),canRun:()=>mode!=='denied'});assert.equal(surface.children.length,0);assert.equal(JSON.stringify(world),before);assert.equal(doc.listeners.visibilitychange,undefined);controller.dispose();}
});

test('visibility pauses presentation and disposal preserves foreign scene nodes and footprints',()=>{
 const {surface,world,doc}=fixture();let allowed=true;const controller=Scene.mount({worldElement:surface,world,view:view(),canRun:()=>allowed});
 const people=surface.children.filter(el=>el.className==='pve-scene-person');doc.hidden=true;doc.emit('visibilitychange');assert.ok(people.every(el=>el.dataset.paused==='true'));doc.hidden=false;doc.emit('visibilitychange');assert.ok(people.every(el=>el.dataset.paused==='false'));allowed=false;doc.emit('visibilitychange');assert.ok(people.every(el=>el.dataset.paused==='true'));
 const foreign={id:'other-feature',x:300,y:300,footprint:{x:300,y:300,rx:20,ry:20}};world.places.push(foreign);const element=doc.createElement('div');surface.appendChild(element);controller.dispose();assert.deepEqual(surface.children,[element]);assert.equal(world.places.length,7);assert.equal(world.places.at(-1),foreign);
});

test('excess/malformed rows cannot escape a bounded layout or become HTML/remote image sources',()=>{
 const {surface,world}=fixture(),v=view();v.shops=[null,{id:3,name:'bad'},...Array.from({length:999},(_,i)=>({id:'id'+i,name:'<script>untrusted</script>',status:'open'}))];v.residents=[{id:'a',name:'<img src=x onerror=boom>'}];
 const controller=Scene.mount({worldElement:surface,world,view:v}),projects=surface.children.filter(el=>el.className==='pve-scene-project');assert.equal(projects.length,3);assert.ok(projects.every(el=>el.children.at(-1).textContent==='<script>untrusted</script>'));
 assert.ok(surface.children.every(el=>el.children.filter(c=>c.tagName==='img').every(c=>c.src.startsWith('/static/'))));controller.dispose();
 assert.deepEqual(Scene.projectSites(null,v),[]);assert.deepEqual(Scene.projectSites(world,{}),[]);
});

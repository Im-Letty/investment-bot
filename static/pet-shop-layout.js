/* Shop-only free fixtures. No wallet, inventory, home layout or storage access. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetShopLayout = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var WIDTH = 10, DEPTH = 8, STEP = .25, RADIUS = .21;
  var specs = [
    {id:'counter',name:'まるいカウンター',type:'counter',width:3.2,depth:.8,height:1.05,flat:false},
    {id:'display',name:'お菓子のショーケース',type:'display',width:1.65,depth:.9,height:1.1,flat:false},
    {id:'shelf',name:'アーチの食器棚',type:'shelf',width:2.4,depth:.65,height:2.65,flat:false},
    {id:'teaTable',name:'ティーテーブル',type:'teaTable',width:1.45,depth:1.45,height:.78,flat:false},
    {id:'chairA',name:'ティーチェア',type:'chair',width:.65,depth:.7,height:1.1,flat:false},
    {id:'chairB',name:'窓辺のチェア',type:'chair',width:.65,depth:.7,height:1.1,flat:false},
    {id:'plant',name:'窓辺のグリーン',type:'plant',width:.65,depth:.65,height:1.45,flat:false},
    {id:'console',name:'花を飾るキャビネット',type:'console',width:1.25,depth:.6,height:1.05,flat:false},
    {id:'rug',name:'やわらかなラグ',type:'rug',width:2.4,depth:2.8,height:.02,flat:true}
  ].map(function (s) { return Object.freeze(s); });
  var fixtures = Object.freeze(specs);
  function finite(n) { return typeof n === 'number' && Number.isFinite(n); }
  function validRoom(id) { return id === 'shop' || id === 'cafe'; }
  function own(o,k) { return Object.prototype.hasOwnProperty.call(o,k); }
  function plain(o) { return !!o && typeof o === 'object' && !Array.isArray(o) && (Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null); }
  function exact(o,keys) { return plain(o) && Reflect.ownKeys(o).length === keys.length && keys.every(function(k){return own(o,k);}); }
  function fixture(id) { return fixtures.find(function (s) { return s.id === id; }); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function fail(reason) { var e = new Error('invalid_shop_interior_layout'); e.code = 'invalid_shop_interior_layout'; e.reason = reason; throw e; }
  function footprint(item, padding) {
    var s = fixture(item.id); if (!s) return null;
    var p = finite(padding) ? Math.max(0,padding) : 0, w = item.turn % 2 ? s.depth : s.width, d = item.turn % 2 ? s.width : s.depth;
    return { minX:item.x-w/2-p,maxX:item.x+w/2+p,minZ:item.z-d/2-p,maxZ:item.z+d/2+p,width:w,depth:d };
  }
  function overlap(a,b) { return a.minX < b.maxX - 1e-8 && a.maxX > b.minX + 1e-8 && a.minZ < b.maxZ - 1e-8 && a.maxZ > b.minZ + 1e-8; }
  function validateLayout(layout, roomId) {
    if (!validRoom(roomId) || !exact(layout,['version','items']) || layout.version !== 1 || !Array.isArray(layout.items) || layout.items.length > fixtures.length || Reflect.ownKeys(layout.items).length !== layout.items.length+1) fail('schema');
    var seen = Object.create(null), solid = [], aisle = {minX:-.65,maxX:.65,minZ:-1.65,maxZ:3.7};
    layout.items.forEach(function(item,index) {
      if (!own(layout.items,index) || !exact(item,['id','x','z','turn']) || typeof item.id !== 'string' || !fixture(item.id)) fail('fixture');
      if (seen[item.id]) fail('duplicate'); seen[item.id] = true;
      if (!finite(item.x) || !finite(item.z) || Math.abs(item.x*4-Math.round(item.x*4))>1e-7 || Math.abs(item.z*4-Math.round(item.z*4))>1e-7 || !Number.isInteger(item.turn) || item.turn<0 || item.turn>3) fail('position');
      var box = footprint(item), s = fixture(item.id);
      if (box.minX < -4.85-1e-8 || box.maxX > 4.85+1e-8 || box.minZ < -3.85-1e-8 || box.maxZ > 3.85+1e-8) fail('outside');
      if (!s.flat) {
        if (overlap(box,aisle)) fail('aisle');
        if (solid.some(function(b){return overlap(footprint(item,.02),b);})) fail('overlap');
        solid.push(box);
      }
    });
    return clone(layout);
  }
  function defaultLayout(roomId) {
    if (!validRoom(roomId)) fail('room');
    var cafe = roomId === 'cafe', rows = cafe ?
      [['counter',0,-2.75,0],['shelf',-3,-3.25,0],['display',3.25,-.5,0],['teaTable',-2.5,.25,0],['chairA',-2.5,1.75,0],['chairB',-2.5,-1.25,2],['plant',4,2.5,0],['console',-4,2.75,0],['rug',0,.25,0]] :
      [['counter',-.5,-2.75,0],['shelf',2.75,-3.25,0],['display',-3.25,-.25,0],['teaTable',2.5,.25,0],['chairA',2.5,1.75,0],['chairB',2.5,-1.25,2],['plant',-4,2.5,0],['console',4,2.75,0],['rug',0,.25,0]];
    return validateLayout({version:1,items:rows.map(function(r){return {id:r[0],x:r[1],z:r[2],turn:r[3]};})},roomId);
  }
  function walkable(layout,x,z,radius) {
    var r = finite(radius) ? Math.max(0,radius) : RADIUS;
    if (!finite(x)||!finite(z)||x < -4.85+r||x > 4.85-r||z < -3.85+r||z > 3.85-r) return false;
    return !layout.items.some(function(item) {
      if (fixture(item.id).flat) return false;
      var b=footprint(item),dx=Math.max(b.minX-x,0,x-b.maxX),dz=Math.max(b.minZ-z,0,z-b.maxZ);
      if(x>b.minX&&x<b.maxX&&z>b.minZ&&z<b.maxZ)return true;
      return dx*dx+dz*dz < r*r-1e-10;
    });
  }
  function move(layout,position,dx,dz,radius) {
    if (!position||!finite(position.x)||!finite(position.z)||!finite(dx)||!finite(dz)) return null;
    var n=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.045)),x=position.x,z=position.z;
    if(n>400) return {x:x,z:z,blocked:true};
    for(var i=0;i<n;i++) {
      if(walkable(layout,x+dx/n,z,radius)) x+=dx/n;
      if(walkable(layout,x,z+dz/n,radius)) z+=dz/n;
    }
    return {x:x,z:z,blocked:Math.hypot(x-position.x-dx,z-position.z-dz)>.0001};
  }
  function path(layout,start,target,radius) {
    if(!start||!target||!walkable(layout,start.x,start.z,radius)||!walkable(layout,target.x,target.z,radius))return null;
    function cell(p){return {x:Math.round(p.x/STEP),z:Math.round(p.z/STEP)};}
    function key(p){return p.x+':'+p.z;}
    function clear(a,b){var n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.04));for(var i=0;i<=n;i++)if(!walkable(layout,a.x+(b.x-a.x)*i/n,a.z+(b.z-a.z)*i/n,radius))return false;return true;}
    function nearest(point){var base=cell(point),choices=[];for(var z=-2;z<=2;z++)for(var x=-2;x<=2;x++){var c={x:base.x+x,z:base.z+z},p={x:c.x*STEP,z:c.z*STEP};if(walkable(layout,p.x,p.z,radius)&&clear(point,p))choices.push({cell:c,d:Math.hypot(point.x-p.x,point.z-p.z)});}choices.sort(function(a,b){return a.d-b.d;});return choices.length?choices[0].cell:null;}
    var first=nearest(start),last=nearest(target);if(!first||!last)return null;
    var open=[{x:first.x,z:first.z,g:0,f:0}],seen=new Map(),closed=new Set(),end=null;
    seen.set(key(first),open[0]);
    for(var tries=0;open.length&&tries<1800;tries++){
      open.sort(function(a,b){return a.f-b.f;});var cur=open.shift(),k=key(cur);if(closed.has(k))continue;closed.add(k);
      if(cur.x===last.x&&cur.z===last.z){end=cur;break;}
      for(var az=-1;az<=1;az++)for(var ax=-1;ax<=1;ax++){
        if(!ax&&!az)continue;var p={x:cur.x+ax,z:cur.z+az},pk=key(p);
        if(closed.has(pk)||!walkable(layout,p.x*STEP,p.z*STEP,radius))continue;
        if(ax&&az&&(!walkable(layout,(cur.x+ax)*STEP,cur.z*STEP,radius)||!walkable(layout,cur.x*STEP,(cur.z+az)*STEP,radius)))continue;
        if(!clear({x:cur.x*STEP,z:cur.z*STEP},{x:p.x*STEP,z:p.z*STEP}))continue;
        var cost=cur.g+Math.hypot(ax,az),old=seen.get(pk);if(old&&old.g<=cost)continue;
        p.g=cost;p.f=cost+Math.hypot(p.x-last.x,p.z-last.z);p.parent=cur;seen.set(pk,p);open.push(p);
      }
    }
    if(!end)return null;var rows=[];for(var p=end;p;p=p.parent)rows.push({x:p.x*STEP,z:p.z*STEP});rows.reverse();if(rows.length&&Math.hypot(rows[0].x-start.x,rows[0].z-start.z)<.001)rows.shift();rows.push({x:target.x,z:target.z});return rows;
  }
  return Object.freeze({fixtures:fixtures,fixture:fixture,defaultLayout:defaultLayout,validateLayout:validateLayout,footprint:footprint,overlap:overlap,walkable:walkable,move:move,path:path,width:WIDTH,depth:DEPTH,step:STEP,radius:RADIUS,spawn:Object.freeze({x:0,z:2.6}),validRoom:validRoom});
}));

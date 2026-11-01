/* One manual river activity. Time and durable ownership remain in PetGameCore. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./pet-town-walk.js'),require('./pet-japan-seasons.js'));
  else root.PetRiverFishing=factory(root.PetTownWalk,root.PetJapanSeasons);
}(typeof globalThis!=='undefined'?globalThis:this,function(Town,Seasons){
  'use strict';
  var WAIT=2200,WINDOW=10000,COOLDOWN=5000,MAX=9000000000000;
  var FISH_ID='river_silverfish',SPOT_ID='south-bank';
  // Existing catches keep their original identity. Calendar species are authored
  // game collectibles, not a local forecast, fishing season or permit advice.
  var FISHES=Object.freeze([
    {id:FISH_ID,name:'川の小魚',color:'#bbd6ce'},
    {id:'river_cherry_salmon',name:'サクラマス',color:'#d7b7ae'},
    {id:'river_ayu',name:'アユ',color:'#b6c9a4'},
    {id:'river_salmon',name:'サケ',color:'#c3aaa0'},
    {id:'river_smelt',name:'ワカサギ',color:'#c2d6da'}
  ].map(function(row){return Object.freeze(row);}));
  var FISH_IDS=Object.freeze(FISHES.map(function(row){return row.id;}));
  function fishProfile(id){return FISHES.find(function(row){return row.id===id;})||null;}
  function seasonFish(ms){
    var calendar=Seasons||(typeof globalThis!=='undefined'&&globalThis.PetJapanSeasons),life;
    if(!integer(ms)||!calendar||typeof calendar.life!=='function')return null;
    try{life=calendar.life(ms);}catch(_){return null;}
    return life&&life.fish&&life.fish.id!==FISH_ID?fishProfile(life.fish.id):null;
  }
  function demand(ok,code){if(!ok){var e=new Error(code);e.code=code;throw e;}}

  var shore=[[0,2880],[550,2840],[1050,2720],[1450,2510],[1920,1990]];
  function finite(n){return typeof n==='number'&&Number.isFinite(n);}
  function integer(n){return Number.isSafeInteger(n)&&n>=0&&n<=MAX;}
  function plain(o){return !!o&&Object.getPrototypeOf(o)===Object.prototype;}
  function exact(o,keys){return plain(o)&&Reflect.ownKeys(o).length===keys.length&&keys.every(function(k){return Object.prototype.hasOwnProperty.call(o,k);});}
  function copy(o){return JSON.parse(JSON.stringify(o));}
  function bankX(y){for(var i=1;i<shore.length;i++)if(y<=shore[i][0]){var a=shore[i-1],b=shore[i];return a[1]+(b[1]-a[1])*(y-a[0])/(b[0]-a[0]);}return shore[shore.length-1][1];}
  function site(){return {id:SPOT_ID,name:'南の川岸',position:{x:bankX(1500)-78,y:1500},target:{x:bankX(1500)+75,y:1500},radius:70};}
  function legal(world,p){
    var s=site();if(!world||!p||!finite(p.x)||!finite(p.y)||!Town||!Town.isWalkable(world,p.x,p.y))return false;
    if(p.y>=1030&&p.y<=1290||Math.hypot(p.x-s.position.x,p.y-s.position.y)>s.radius)return false;
    var gap=bankX(p.y)-p.x;
    return gap>=38&&gap<=150&&!world.places.some(function(row){return ['home','shop','cafe','playground'].indexOf(row.id)>=0&&(Math.hypot(row.x-p.x,row.y-p.y)<170||row.entrance&&Math.hypot(row.entrance.x-p.x,row.entrance.y-p.y)<150);});
  }
  function empty(){return {version:1,catches:{river_silverfish:0},active:null,nextCastAt:0};}
  function valid(value){
    if(!exact(value,['version','catches','active','nextCastAt'])||(value.version!==1&&value.version!==2)||!integer(value.nextCastAt))return false;
    var keys=value.version===1?[FISH_ID]:FISH_IDS;
    if(!exact(value.catches,keys)||!keys.every(function(id){return integer(value.catches[id]);}))return false;
    var a=value.active;if(a===null)return true;
    var activeKeys=['id','spotId','startedAt','biteAt','expiresAt'];if(value.version===2)activeKeys.push('fishId');
    return exact(a,activeKeys)&&typeof a.id==='string'&&/^river-[0-9]+-[0-9]+$/.test(a.id)&&a.id.length<=80&&a.spotId===SPOT_ID&&integer(a.startedAt)&&a.biteAt===a.startedAt+WAIT&&a.expiresAt===a.startedAt+WINDOW&&integer(a.expiresAt)&&value.nextCastAt>=a.startedAt+COOLDOWN&&(value.version===1||!!fishProfile(a.fishId));
  }
  function phase(state,ms){
    if(!valid(state)||!integer(ms))return 'unavailable';
    var a=state.active;
    return !a?'idle':ms<a.startedAt?'clock_moved_back':ms<a.biteAt?'waiting':ms<=a.expiresAt?'bite':'escaped';
  }
  function activeFishId(state){return valid(state)&&state.active?(state.version===1?FISH_ID:state.active.fishId):null;}
  function collection(state){
    demand(valid(state),'corrupt_data');
    return FISHES.filter(function(row){return (state.catches[row.id]||0)>0;}).map(function(row){return {id:row.id,name:row.name,color:row.color,count:state.catches[row.id]};});
  }
  // These pure helpers produce candidates only. Core owns all location, revision,
  // time and durable-write checks; no caller-visible state changes before ACK.
  function start(state,ms,attemptId){
    demand(valid(state),'corrupt_data');demand(integer(ms)&&integer(ms+WINDOW),'invalid_clock');
    demand(!state.active,'fishing_active');demand(ms>=state.nextCastAt,'fishing_cooldown');
    demand(typeof attemptId==='string'&&/^river-[0-9]+-[0-9]+$/.test(attemptId)&&attemptId.length<=80,'invalid_fishing');
    var selected=seasonFish(ms);demand(!!selected,'invalid_fishing');
    var next=copy(state);next.version=2;
    FISH_IDS.forEach(function(id){if(!Object.prototype.hasOwnProperty.call(next.catches,id))next.catches[id]=0;});
    next.active={id:attemptId,spotId:SPOT_ID,startedAt:ms,biteAt:ms+WAIT,expiresAt:ms+WINDOW,fishId:selected.id};
    next.nextCastAt=ms+COOLDOWN;demand(valid(next),'corrupt_data');return next;
  }
  function reel(state,ms){
    demand(valid(state)&&!!state.active,'invalid_fishing');demand(integer(ms),'invalid_clock');
    demand(ms>=state.active.startedAt,'clock_moved_back');demand(ms>=state.active.biteAt,'fishing_wait');demand(ms<=state.active.expiresAt,'fishing_escaped');
    var id=activeFishId(state),next=copy(state);
    demand(next.catches[id]<MAX,'amount_overflow');next.catches[id]++;next.active=null;return {state:next,reward:{fishId:id,quantity:1}};
  }
  function cancel(state,ms){demand(valid(state)&&!!state.active,'invalid_fishing');demand(integer(ms),'invalid_clock');demand(ms>=state.active.startedAt,'clock_moved_back');var next=copy(state);next.active=null;return next;}
  function view(state,ms,world,p){
    var s=state||empty(),stage=phase(s,ms);
    if(stage==='unavailable')return {version:2,phase:stage,site:site(),nearBank:false,active:null,caught:null,fishId:null,fishName:null,fishCollection:[],canCast:false,canReel:false,remainingMs:0};
    var a=s.active,eligible=legal(world,p),selected=fishProfile(activeFishId(s))||seasonFish(ms),rows=collection(s);
    return {version:2,phase:stage,site:site(),nearBank:eligible,active:a?copy(a):null,caught:rows.reduce(function(total,row){return total+row.count;},0),fishId:selected?selected.id:null,fishName:selected?selected.name:null,fishColor:selected?selected.color:null,fishCollection:rows,
      canCast:stage==='idle'&&eligible&&!!selected&&ms>=s.nextCastAt,canReel:stage==='bite'&&eligible,remainingMs:a?Math.max(0,(stage==='waiting'?a.biteAt:a.expiresAt)-ms):Math.max(0,s.nextCastAt-ms)};
  }
  function createVisual(THREE,world){
    var group=new THREE.Group();group.name='manual-river-fishing';
    var geometries=new Set(),materials=new Set(),dead=false,state=null;
    function mesh(geometry,color,parent){geometries.add(geometry);var material=new THREE.MeshStandardMaterial({color:color,roughness:.72,metalness:0});materials.add(material);var m=new THREE.Mesh(geometry,material);(parent||group).add(m);return m;}
    function segment(m,a,b){var delta=new THREE.Vector3().subVectors(b,a);m.position.copy(a).addScaledVector(delta,.5);m.scale.y=delta.length();m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());}
    var rod=mesh(new THREE.CylinderGeometry(.016,.028,1,8),'#b89770');rod.name='fishing-rod';
    var holder=mesh(new THREE.CylinderGeometry(.05,.07,.48,8),'#b7a078');holder.name='river-rod-holder';
    var grip=mesh(new THREE.CylinderGeometry(.032,.034,.28,8),'#647e64');grip.name='fishing-grip';
    var spool=mesh(new THREE.TorusGeometry(.065,.018,6,12),'#d4bd83');spool.name='fishing-reel';
    var lineGeo=new THREE.BufferGeometry();lineGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));geometries.add(lineGeo);
    var lineMat=new THREE.LineBasicMaterial({color:'#dcdac6',transparent:true,opacity:.88});materials.add(lineMat);
    var line=new THREE.Line(lineGeo,lineMat);line.name='fishing-line';group.add(line);
    var bobber=mesh(new THREE.SphereGeometry(.075,10,8),'#ce7e7e');bobber.name='fishing-float';bobber.scale.set(.75,1.2,.75);
    var ring=mesh(new THREE.TorusGeometry(.18,.009,5,24),'#d9f2e6');ring.name='fishing-ripple';ring.rotation.x=-Math.PI/2;
    var fish=mesh(new THREE.SphereGeometry(1,12,8),'#3a7875');fish.name='fishing-shadow';fish.scale.set(.19,.018,.075);fish.material.transparent=true;fish.material.opacity=.32;
    var caught=mesh(new THREE.SphereGeometry(1,12,8),'#bbd6ce');caught.name='reeled-fish';caught.scale.set(.16,.055,.075);
    var fin=mesh(new THREE.ConeGeometry(.085,.14,3),'#91b6aa',caught);fin.rotation.z=Math.PI/2;fin.position.x=-1.25;fin.scale.set(5,2,2);
    var marker=new THREE.Group();marker.name='river-bank-marker';group.add(marker);
    var post=mesh(new THREE.CylinderGeometry(.035,.045,.45,8),'#bea37f',marker);post.position.y=.225;
    var plaque=mesh(new THREE.BoxGeometry(.35,.19,.05),'#f3e3c8',marker);plaque.position.y=.41;
    var signFish=mesh(new THREE.SphereGeometry(1,10,6),'#779b8b',marker);signFish.position.set(0,.41,.035);signFish.scale.set(.1,.036,.012);
    var point=site().position;marker.position.set((point.x-world.width/2)/100-.55,.025,(point.y-world.height/2)/100+.40);
    function update(value,position,ms,reduced){
      if(dead)return;
      state=value;var active=value&&['waiting','bite','caught'].indexOf(value.phase)>=0&&legal(world,position);
      var selected=value&&fishProfile(value.fishId);caught.material.color.set(selected?selected.color:'#bbd6ce');
      [rod,holder,grip,spool,line,bobber,ring,fish,caught].forEach(function(m){m.visible=!!active;});
      if(active){
        var p=new THREE.Vector3((position.x-world.width/2)/100,.025,(position.y-world.height/2)/100),t=site().target;
        var water=new THREE.Vector3((t.x-world.width/2)/100,-.035,(t.y-world.height/2)/100);
        var bite=value.phase==='bite',now=reduced?0:ms/1000,bob=bite?Math.sin(now*8)*.035:Math.sin(now*2)*.012;
        var base=p.clone().add(new THREE.Vector3(.38,.30,.05)),tip=p.clone().add(new THREE.Vector3(1.13,1.48,.02));
        if(value.phase==='caught')tip.y+=.30;
        holder.position.copy(p).add(new THREE.Vector3(.38,.24,.05));segment(rod,base,tip);grip.position.copy(base);grip.quaternion.copy(rod.quaternion);spool.position.copy(base).add(new THREE.Vector3(0,.12,.04));
        bobber.position.copy(water);bobber.position.y+=bob;bobber.scale.y=bite?.75:1.2;
        lineGeo.attributes.position.setXYZ(0,tip.x,tip.y,tip.z);lineGeo.attributes.position.setXYZ(1,bobber.position.x,bobber.position.y,bobber.position.z);lineGeo.attributes.position.needsUpdate=true;lineGeo.computeBoundingSphere();
        ring.position.copy(water);ring.position.y=-.025;ring.scale.setScalar(bite?1.6+Math.abs(Math.sin(now*5))*.5:1);
        fish.visible=value.phase!=='caught';fish.position.copy(water).add(new THREE.Vector3(.13+Math.sin(now)*.12,-.008,.07));fish.rotation.y=Math.sin(now*.9)*.4;
        caught.visible=value.phase==='caught';caught.position.copy(tip).add(new THREE.Vector3(.1,-.3,0));
        if(value.phase==='caught'){bobber.position.copy(tip).add(new THREE.Vector3(.1,-.2,0));lineGeo.attributes.position.setXYZ(1,bobber.position.x,bobber.position.y,bobber.position.z);lineGeo.attributes.position.needsUpdate=true;}
      }
      group.updateMatrixWorld(true);
    }
    update(null,site().position,0,true);
    return {group:group,update:update,geometries:geometries,materials:materials,dispose:function(){if(dead)return;dead=true;geometries.forEach(function(g){g.dispose();});materials.forEach(function(m){m.dispose();});group.removeFromParent();},state:function(){return state;}};
  }
  return Object.freeze({lifeRevision:'annual-life1',site:site,legal:legal,createWorld:Town.createWorld,empty:empty,valid:valid,phase:phase,view:view,WAIT:WAIT,WINDOW:WINDOW,COOLDOWN:COOLDOWN,fishId:FISH_ID,fishIds:FISH_IDS,catalogue:FISHES,seasonFish:seasonFish,activeFishId:activeFishId,collection:collection,start:start,reel:reel,cancel:cancel,createVisual:createVisual});
}));

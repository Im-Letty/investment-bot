/* Authored ocean observations only. No inventory, rewards, timer, storage or body-fit inference. */
(function(root,factory){
  'use strict';
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PetOceanDiscoveries=api;
}(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var MAX=9000000000000;
  var coast=Object.freeze([[0,2880],[550,2840],[1050,2720],[1450,2510],[1920,1990]].map(function(p){return Object.freeze(p);}));
  var limits=Object.freeze({minY:1500,maxY:1830,minCoastGap:85,maxCoastGap:650,minObservationDepth:.8,maxDepth:1.15});
  function finite(n){return typeof n==='number'&&Number.isFinite(n);}
  function integer(n){return Number.isSafeInteger(n)&&n>=0&&n<=MAX;}
  function own(o,k){return Object.prototype.hasOwnProperty.call(o,k);}
  function plain(o){return !!o&&typeof o==='object'&&!Array.isArray(o)&&Object.prototype.toString.call(o)==='[object Object]';}
  function exact(o,keys){return plain(o)&&Reflect.ownKeys(o).length===keys.length&&keys.every(function(k){return own(o,k);});}
  function copy(o){return JSON.parse(JSON.stringify(o));}
  function fail(code){var e=new Error(code);e.code=code;throw e;}
  function coastX(y){
    if(!finite(y)||y<coast[0][0]||y>coast[coast.length-1][0])return NaN;
    for(var i=1;i<coast.length;i++)if(y<=coast[i][0]){var a=coast[i-1],b=coast[i];return a[1]+(b[1]-a[1])*(y-a[0])/(b[0]-a[0]);}
    return NaN;
  }
  function isWater(p){
    if(!plain(p)||!finite(p.x)||!finite(p.y)||p.y<limits.minY||p.y>limits.maxY)return false;
    var gap=p.x-coastX(p.y);return gap>=limits.minCoastGap&&gap<=limits.maxCoastGap;
  }
  var encounters=Object.freeze([
    {id:'shell',kind:'shell',name:'うみの貝',position:{x:coastX(1600)+180,y:1600},depth:2.25,radius:70},
    {id:'starfish',kind:'starfish',name:'ヒトデ',position:{x:coastX(1690)+260,y:1690},depth:2.25,radius:70},
    {id:'kelp',kind:'seaweed',name:'ゆれる海そう',position:{x:coastX(1770)+390,y:1770},depth:2.30,radius:70},
    {id:'reef_fish',kind:'fish',name:'さんごの小魚',position:{x:coastX(1550)+470,y:1550},depth:1.15,radius:70}
  ].map(function(row){Object.freeze(row.position);return Object.freeze(row);}));
  function encounter(id){return typeof id==='string'?encounters.find(function(row){return row.id===id;})||null:null;}
  function canObserve(id,position,mode,depth){
    var row=encounter(id);
    return !!row&&mode==='underwater'&&finite(depth)&&depth>=limits.minObservationDepth&&depth<=limits.maxDepth&&
      isWater(position)&&Math.hypot(position.x-row.position.x,position.y-row.position.y)<=row.radius;
  }
  function nearest(position,mode,depth){
    var selected=null,distance=Infinity;
    encounters.forEach(function(row){if(!canObserve(row.id,position,mode,depth))return;
      var gap=Math.hypot(position.x-row.position.x,position.y-row.position.y);
      if(gap<distance){selected=row;distance=gap;}
    });return selected?copy(selected):null;
  }
  function empty(){return {version:1,entries:[]};}
  function valid(value){
    if(!exact(value,['version','entries'])||value.version!==1||!Array.isArray(value.entries)||value.entries.length>encounters.length||
        Reflect.ownKeys(value.entries).length!==value.entries.length+1)return false;
    var seen=Object.create(null),previous=-1;
    for(var i=0;i<value.entries.length;i++){
      var row=value.entries[i];
      if(!exact(row,['creatureId','discoveredAt'])||!encounter(row.creatureId)||own(seen,row.creatureId)||!integer(row.discoveredAt)||row.discoveredAt<previous)return false;
      seen[row.creatureId]=true;previous=row.discoveredAt;
    }return true;
  }
  function record(value,action){
    if(!valid(value))fail('corrupt_data');
    if(!plain(action)||!integer(action.at))fail('invalid_clock');
    if(!canObserve(action.creatureId,action.position,action.mode,action.depth))fail('invalid_ocean_discovery');
    var rows=value.entries;
    if(rows.some(function(row){return row.creatureId===action.creatureId;}))fail('ocean_already_discovered');
    if(rows.length&&action.at<rows[rows.length-1].discoveredAt)fail('clock_moved_back');
    var next=copy(value);next.entries.push({creatureId:action.creatureId,discoveredAt:action.at});return next;
  }
  function view(value){
    if(!valid(value))fail('corrupt_data');
    var entries=value.entries.map(function(saved){var row=encounter(saved.creatureId);return {id:row.id,creatureId:row.id,name:row.name,discoveredAt:saved.discoveredAt};});
    return {version:1,entries:entries,total:entries.length,available:encounters.length,complete:entries.length===encounters.length};
  }
  return Object.freeze({revision:'ocean-discoveries1',coastX:coastX,isWater:isWater,limits:limits,encounters:encounters,
    canObserve:canObserve,nearest:nearest,empty:empty,valid:valid,record:record,view:view});
}));

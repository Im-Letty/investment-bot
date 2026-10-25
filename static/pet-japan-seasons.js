/* Japanese calendar seasons are presentation only; no storage or game clock. */
(function(root,factory){
  'use strict';
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PetJapanSeasons=api;
}(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  var OFFSET=9*60*60*1000, DAY=24*60*60*1000;
  var profiles={
    spring:{key:'spring',label:'春',ground:'#b8d59a',light:'rgba(237,238,185,.22)',shade:'rgba(106,153,86,.18)',grain:'rgba(145,180,102,.22)',spark:'rgba(243,235,194,.27)',clear:'rgba(184,213,154,0)',sky:'#cce7eb',
      foliage:['#82af78','#a7c98c','#c2db9f','#91b880'],hills:['#b1cda5','#cadbb7','#bfd6ae'],flowers:['#f4bfd0','#fce2dd']},
    summer:{key:'summer',label:'夏',ground:'#a4c778',light:'rgba(223,233,155,.22)',shade:'rgba(78,136,70,.20)',grain:'rgba(117,164,80,.23)',spark:'rgba(226,234,173,.27)',clear:'rgba(164,199,120,0)',sky:'#b9dfe7',
      foliage:['#6e9e63','#91b96f','#acce88','#7baa69'],hills:['#94b78d','#b2cfa4','#a7c49c'],flowers:['#efc4b5','#fff1d9']},
    autumn:{key:'autumn',label:'秋',ground:'#c8b981',light:'rgba(244,218,155,.24)',shade:'rgba(158,133,79,.17)',grain:'rgba(172,148,87,.22)',spark:'rgba(244,225,177,.28)',clear:'rgba(200,185,129,0)',sky:'#d1e5e8',
      foliage:['#a77951','#c59457','#d5ad69','#8f9e66'],hills:['#b5b383','#c9c297','#b6b991'],flowers:['#c38375','#ebcb91']},
    winter:{key:'winter',label:'冬',ground:'#dae2d2',light:'rgba(249,246,229,.25)',shade:'rgba(148,174,160,.16)',grain:'rgba(166,187,173,.20)',spark:'rgba(250,247,234,.32)',clear:'rgba(218,226,210,0)',sky:'#c9e2e9',
      foliage:['#78998a','#98b4a1','#b0c6b3','#88a58e'],hills:['#abbfb0','#c0d0bf','#b7c9b7'],flowers:['#d3aab7','#f0e5da']}
  };
  Object.keys(profiles).forEach(function(k){Object.freeze(profiles[k].foliage);Object.freeze(profiles[k].hills);Object.freeze(profiles[k].flowers);Object.freeze(profiles[k]);});
  Object.freeze(profiles);
  function profile(key){return Object.prototype.hasOwnProperty.call(profiles,key)?profiles[key]:null;}
  function resolve(ms){
    if(typeof ms!=='number'||!Number.isFinite(ms))return null;
    var shifted=new Date(ms+OFFSET);
    if(!Number.isFinite(shifted.getTime()))return null;
    var y=shifted.getUTCFullYear(),m=shifted.getUTCMonth()+1,d=shifted.getUTCDate();
    var key=m>=3&&m<=5?'spring':m>=6&&m<=8?'summer':m>=9&&m<=11?'autumn':'winter';
    shifted.setUTCHours(24,0,0,0);
    var next=shifted.getTime()-OFFSET;
    if(!Number.isFinite(next)||next<=ms)return null;
    return Object.freeze({key:key,label:profiles[key].label,dateJst:String(y).padStart(4,'0')+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0'),nextDayAt:next});
  }
  function watch(options){
    options=options||{};
    var now=typeof options.now==='function'?options.now:Date.now;
    var set=options.setTimeout||setTimeout,clear=options.clearTimeout||clearTimeout;
    var timer=null,dead=false,last=null,unsubscribe=null;
    function cancel(){if(timer!==null){clear(timer);timer=null;}}
    function check(){
      if(dead)return null;
      cancel();
      var ms,state=null,enabled=true;
      try{enabled=!options.enabled||!!options.enabled();ms=now();if(enabled)state=resolve(ms);}catch(_){}
      if(state&&(!last||last.dateJst!==state.dateJst||last.key!==state.key)){
        last=state;
        if(typeof options.onChange==='function')options.onChange(state);
      }
      if(!dead)timer=set(check,state?Math.max(1,Math.min(60000,state.nextDayAt-ms)):60000);
      return state;
    }
    if(typeof options.subscribe==='function')try{unsubscribe=options.subscribe(check);}catch(_){}
    check();
    return Object.freeze({check:check,destroy:function(){if(dead)return;dead=true;cancel();if(typeof unsubscribe==='function')unsubscribe();unsubscribe=null;}});
  }
  return Object.freeze({resolve:resolve,profile:profile,profiles:profiles,watch:watch,timezone:'Asia/Tokyo',dayMs:DAY});
}));

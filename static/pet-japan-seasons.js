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
    spring:{key:'spring',label:'春',ground:'#c3dda7',light:'rgba(237,238,185,.22)',shade:'rgba(119,165,98,.18)',grain:'rgba(157,192,114,.22)',spark:'rgba(243,235,194,.27)',clear:'rgba(195,221,167,0)',sky:'#cce7eb',
      foliage:['#93bd89','#b5d499','#cee4ae','#a1c58e'],hills:['#bdd6b2','#d2e2c1','#c9deb9'],flowers:['#f4bfd0','#fce2dd']},
    summer:{key:'summer',label:'夏',ground:'#b4d58a',light:'rgba(223,233,155,.22)',shade:'rgba(96,151,83,.20)',grain:'rgba(132,178,94,.23)',spark:'rgba(226,234,173,.27)',clear:'rgba(180,213,138,0)',sky:'#b9dfe7',
      foliage:['#85b477','#a3c880','#bad998','#90bc7a'],hills:['#a5c69a','#bfd9b0','#b6d0a9'],flowers:['#efc4b5','#fff1d9']},
    autumn:{key:'autumn',label:'秋',ground:'#d8c995',light:'rgba(244,218,155,.24)',shade:'rgba(174,151,96,.17)',grain:'rgba(186,163,105,.22)',spark:'rgba(244,225,177,.28)',clear:'rgba(216,201,149,0)',sky:'#d1e5e8',
      foliage:['#b98c62','#d3a86d','#dfbf7f','#a4b47b'],hills:['#c1be91','#d3cea6','#c4c69f'],flowers:['#c38375','#ebcb91']},
    winter:{key:'winter',label:'冬',ground:'#e0e7d9',light:'rgba(249,246,229,.25)',shade:'rgba(159,184,170,.16)',grain:'rgba(177,197,183,.20)',spark:'rgba(250,247,234,.32)',clear:'rgba(224,231,217,0)',sky:'#c9e2e9',
      foliage:['#8caa99','#aac3ae','#bed1bf','#9bb69f'],hills:['#b7c9bb','#ccd8c9','#c3d3c3'],flowers:['#d3aab7','#f0e5da']}
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

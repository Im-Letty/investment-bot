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
    spring:{key:'spring',label:'春',ground:'#a6c58a',light:'rgba(225,236,209,.17)',shade:'rgba(89,124,83,.15)',grain:'rgba(126,161,105,.16)',spark:'rgba(235,239,205,.18)',clear:'rgba(166,197,138,0)',sky:'#cfe5e9',
      foliage:['#607e49','#7c9a5b','#9fb178','#6d8c50'],hills:['#94ac7c','#afc194','#a0b488'],flowers:['#edb1c7','#fae1d8'],accents:['#bfd18d','#d2dcb0']},
    summer:{key:'summer',label:'夏',ground:'#96b87c',light:'rgba(219,233,202,.16)',shade:'rgba(73,113,67,.16)',grain:'rgba(111,150,93,.17)',spark:'rgba(231,237,204,.18)',clear:'rgba(150,184,124,0)',sky:'#bfdfe7',
      foliage:['#4e703d','#6f9150','#96ac6b','#5e8144'],hills:['#879f73','#a6bb8c','#95ad80'],flowers:['#edc364','#ffdf7d'],accents:['#adbf7d','#bfd094']},
    autumn:{key:'autumn',label:'秋',ground:'#a5bc89',light:'rgba(226,230,205,.16)',shade:'rgba(89,117,77,.16)',grain:'rgba(132,157,104,.16)',spark:'rgba(230,232,204,.18)',clear:'rgba(165,188,137,0)',sky:'#d1e5e8',
      foliage:['#627947','#81965a','#a2b780','#718b50'],hills:['#93a67b','#adb996','#9caf89'],flowers:['#b77964','#e1bd73'],accents:['#bc915d','#cfb27c']},
    winter:{key:'winter',label:'冬',ground:'#e4e9e0',light:'rgba(248,247,237,.20)',shade:'rgba(162,181,172,.16)',grain:'rgba(182,198,186,.16)',spark:'rgba(248,247,237,.23)',clear:'rgba(228,233,224,0)',sky:'#cbe2e7',
      foliage:['#617c6b','#809c83','#a2b7a4','#708d77'],hills:['#b7c9bb','#cbd6c9','#c0cec2'],flowers:['#d3aab7','#f0e5da'],accents:['#c2d0c0','#dbe2d3']}
  };
  Object.keys(profiles).forEach(function(k){Object.freeze(profiles[k].foliage);Object.freeze(profiles[k].hills);Object.freeze(profiles[k].flowers);Object.freeze(profiles[k].accents);Object.freeze(profiles[k]);});
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
  return Object.freeze({artRevision:'shop-collection-unity1',resolve:resolve,profile:profile,profiles:profiles,watch:watch,timezone:'Asia/Tokyo',dayMs:DAY});
}));

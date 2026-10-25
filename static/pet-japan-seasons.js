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
    spring:{key:'spring',label:'春',ground:'#aecb83',light:'rgba(225,232,160,.19)',shade:'rgba(83,125,57,.20)',grain:'rgba(122,163,74,.20)',spark:'rgba(235,224,167,.24)',clear:'rgba(174,203,131,0)',sky:'#cce7eb',
      foliage:['#648647','#89a95d','#a8bd75','#73934f'],hills:['#96ae79','#b2c38e','#a2b781'],flowers:['#edb1c7','#fae1d8'],accents:['#c4d48e','#d5ddb0']},
    summer:{key:'summer',label:'夏',ground:'#9fbd70',light:'rgba(218,226,142,.18)',shade:'rgba(65,109,47,.20)',grain:'rgba(110,149,64,.22)',spark:'rgba(229,225,158,.23)',clear:'rgba(159,189,112,0)',sky:'#b9dfe7',
      foliage:['#4f743c','#75974d','#a1b465','#668746'],hills:['#88a36a','#a7bc80','#96af75'],flowers:['#ecc3af','#fff0d2'],accents:['#adbb72','#b7c683']},
    autumn:{key:'autumn',label:'秋',ground:'#afbc78',light:'rgba(231,221,153,.19)',shade:'rgba(87,118,55,.19)',grain:'rgba(135,157,77,.22)',spark:'rgba(235,222,164,.25)',clear:'rgba(175,188,120,0)',sky:'#d1e5e8',
      foliage:['#677d43','#8d9c55','#a9b774','#7e904f'],hills:['#98a673','#b3bc8b','#a3b17e'],flowers:['#c78370','#e8c981'],accents:['#b88d50','#cbab6d']},
    winter:{key:'winter',label:'冬',ground:'#e0e7d9',light:'rgba(249,246,229,.25)',shade:'rgba(159,184,170,.16)',grain:'rgba(177,197,183,.20)',spark:'rgba(250,247,234,.32)',clear:'rgba(224,231,217,0)',sky:'#c9e2e9',
      foliage:['#658472','#86a18a','#a9bdaa','#779580'],hills:['#b7c9bb','#ccd8c9','#c3d3c3'],flowers:['#d3aab7','#f0e5da'],accents:['#c2d0c0','#dbe2d3']}
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
  return Object.freeze({artRevision:'market-photo1',resolve:resolve,profile:profile,profiles:profiles,watch:watch,timezone:'Asia/Tokyo',dayMs:DAY});
}));

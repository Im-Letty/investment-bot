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
  "spring": {
    "key": "spring",
    "label": "春",
    "ground": "#a4c88d",
    "light": "rgba(230,240,210,.14)",
    "shade": "rgba(65,112,67,.15)",
    "grain": "rgba(111,156,88,.17)",
    "spark": "rgba(238,238,202,.16)",
    "clear": "rgba(164,200,141,0)",
    "sky": "#b9dceb",
    "horizon": "#f2eee0",
    "foliage": [
      "#577842",
      "#779952",
      "#a8bb7c",
      "#69864a"
    ],
    "hills": [
      "#91b17e",
      "#b6c99c",
      "#a2bc8a"
    ],
    "flowers": [
      "#e6a9bf",
      "#fff0dc"
    ],
    "accents": [
      "#c2d69a",
      "#dbe5b9"
    ]
  },
  "summer": {
    "key": "summer",
    "label": "夏",
    "ground": "#90bc7a",
    "light": "rgba(223,238,198,.14)",
    "shade": "rgba(49,101,57,.16)",
    "grain": "rgba(90,145,74,.17)",
    "spark": "rgba(235,240,201,.15)",
    "clear": "rgba(144,188,122,0)",
    "sky": "#acd3e8",
    "horizon": "#f0edda",
    "foliage": [
      "#4c733b",
      "#6b9250",
      "#a2b977",
      "#5c8543"
    ],
    "hills": [
      "#86aa74",
      "#aac68e",
      "#96b77e"
    ],
    "flowers": [
      "#dfb96a",
      "#fff0cb"
    ],
    "accents": [
      "#b3cd89",
      "#cfdda6"
    ]
  },
  "autumn": {
    "key": "autumn",
    "label": "秋",
    "ground": "#a3bf89",
    "light": "rgba(234,238,208,.14)",
    "shade": "rgba(66,109,61,.15)",
    "grain": "rgba(121,156,92,.16)",
    "spark": "rgba(240,234,204,.16)",
    "clear": "rgba(163,191,137,0)",
    "sky": "#bddce9",
    "horizon": "#f3ebdc",
    "foliage": [
      "#5e7e45",
      "#7f9a57",
      "#a7bb7e",
      "#6c8a4c"
    ],
    "hills": [
      "#93b17d",
      "#b3c69a",
      "#a0b889"
    ],
    "flowers": [
      "#dcac9d",
      "#f6dfb1"
    ],
    "accents": [
      "#bc9868",
      "#d4b986"
    ]
  },
  "winter": {
    "key": "winter",
    "label": "冬",
    "ground": "#e4e9e0",
    "light": "rgba(248,247,237,.20)",
    "shade": "rgba(162,181,172,.16)",
    "grain": "rgba(182,198,186,.16)",
    "spark": "rgba(248,247,237,.23)",
    "clear": "rgba(228,233,224,0)",
    "sky": "#c6dfed",
    "horizon": "#f4f0e9",
    "foliage": [
      "#617c6b",
      "#809c83",
      "#a2b7a4",
      "#708d77"
    ],
    "hills": [
      "#b7c9bb",
      "#cbd6c9",
      "#c0cec2"
    ],
    "flowers": [
      "#d3aab7",
      "#f0e5da"
    ],
    "accents": [
      "#c2d0c0",
      "#dbe2d3"
    ]
  }
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
  return Object.freeze({artRevision:'shop-cottage-match2',resolve:resolve,profile:profile,profiles:profiles,watch:watch,timezone:'Asia/Tokyo',dayMs:DAY});
}));

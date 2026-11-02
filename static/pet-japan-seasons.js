/* Annual Japanese calendar profiles. Pure reads never modify storage or the game clock. */
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
    "ground": "#7cc65a",
    "light": "rgba(230,240,210,.14)",
    "shade": "rgba(65,112,67,.15)",
    "grain": "rgba(111,156,88,.17)",
    "spark": "rgba(238,238,202,.16)",
    "clear": "rgba(124,198,90,0)",
    "sky": "#7eb9f1",
    "horizon": "#dceef8",
    "foliage": [
      "#397b3d",
      "#5ca448",
      "#91c65b",
      "#498f3e"
    ],
    "hills": [
      "#70ac50",
      "#a3cf71",
      "#86ba5d"
    ],
    "flowers": [
      "#ef9bb9",
      "#fff1d8"
    ],
    "accents": [
      "#c2d69a",
      "#dbe5b9"
    ]
  },
  "summer": {
    "key": "summer",
    "label": "夏",
    "ground": "#66bb4b",
    "light": "rgba(223,238,198,.14)",
    "shade": "rgba(49,101,57,.16)",
    "grain": "rgba(90,145,74,.17)",
    "spark": "rgba(235,240,201,.15)",
    "clear": "rgba(102,187,75,0)",
    "sky": "#69adf0",
    "horizon": "#d7eef9",
    "foliage": [
      "#28733b",
      "#469643",
      "#85bb4e",
      "#36873c"
    ],
    "hills": [
      "#5ba044",
      "#91c85f",
      "#74af4f"
    ],
    "flowers": [
      "#f0be4f",
      "#fff1b8"
    ],
    "accents": [
      "#b3cd89",
      "#cfdda6"
    ]
  },
  "autumn": {
    "key": "autumn",
    "label": "秋",
    "ground": "#8dc24e",
    "light": "rgba(234,238,208,.14)",
    "shade": "rgba(66,109,61,.15)",
    "grain": "rgba(121,156,92,.16)",
    "spark": "rgba(240,234,204,.16)",
    "clear": "rgba(141,194,78,0)",
    "sky": "#7eb4ee",
    "horizon": "#dfedf7",
    "foliage": [
      "#4b8236",
      "#78a33f",
      "#b3c95a",
      "#5e9138"
    ],
    "hills": [
      "#80ae49",
      "#b0cc6a",
      "#97bb54"
    ],
    "flowers": [
      "#e99b87",
      "#f8d485"
    ],
    "accents": [
      "#bc9868",
      "#d4b986"
    ]
  },
  "winter": {
    "key": "winter",
    "label": "冬",
    "ground": "#e4edf0",
    "light": "rgba(248,247,237,.20)",
    "shade": "rgba(162,181,172,.16)",
    "grain": "rgba(182,198,186,.16)",
    "spark": "rgba(248,247,237,.23)",
    "clear": "rgba(228,237,240,0)",
    "sky": "#9bc4ed",
    "horizon": "#e6f2fa",
    "foliage": [
      "#4e7e6a",
      "#6d9a7e",
      "#a2bfab",
      "#608d76"
    ],
    "hills": [
      "#aac7b9",
      "#cadfd3",
      "#b8d2c3"
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
  // A recurring authored game calendar, not a local harvest/weather forecast.
  // Existing strawberry ownership keeps its original ID; all other produce is additive.
  var lifeProfiles={
    spring:{fruit:{id:'berry',name:'いちご',emoji:'🍓'},vegetable:{id:'asparagus',name:'アスパラガス',emoji:'🌱'},fish:{id:'river_cherry_salmon',name:'サクラマス',color:'#d7b7ae'}},
    summer:{fruit:{id:'peach',name:'もも',emoji:'🍑'},vegetable:{id:'cucumber',name:'きゅうり',emoji:'🥒'},fish:{id:'river_ayu',name:'アユ',color:'#b6c9a4'}},
    autumn:{fruit:{id:'pear',name:'なし',emoji:'🍐'},vegetable:{id:'sweet_potato',name:'さつまいも',emoji:'🍠'},fish:{id:'river_salmon',name:'サケ',color:'#c3aaa0'}},
    winter:{fruit:{id:'mandarin',name:'みかん',emoji:'🍊'},vegetable:{id:'daikon',name:'だいこん',emoji:'🌿'},fish:{id:'river_smelt',name:'ワカサギ',color:'#c2d6da'}}
  };
  Object.keys(lifeProfiles).forEach(function(k){var p=lifeProfiles[k];Object.keys(p).forEach(function(t){Object.freeze(p[t]);});Object.freeze(p);});Object.freeze(lifeProfiles);
  function life(ms){var current=resolve(ms);if(!current)return null;var p=lifeProfiles[current.key];return Object.freeze({key:current.key,label:current.label,dateJst:current.dateJst,nextDayAt:current.nextDayAt,fruit:p.fruit,vegetable:p.vegetable,fish:p.fish});}
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
  return Object.freeze({artRevision:'shop-cottage-match2',lifeRevision:'annual-life1',life:life,lifeProfiles:lifeProfiles,resolve:resolve,profile:profile,profiles:profiles,watch:watch,timezone:'Asia/Tokyo',dayMs:DAY});
}));

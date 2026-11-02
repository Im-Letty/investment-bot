/* Whole-artwork manual stepping only. No limbs, direction atlas, timers or state. */
(function(root,factory){
  'use strict';
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PetStillStep=api;
}(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var neutral=Object.freeze({active:false,bob:0,roll:0});
  var limits=Object.freeze({stride:.36,maxBob:.025,heightFraction:.02,maxRoll:.035});
  function enabled(metadata){return !!metadata&&metadata.characterId==='milne'&&metadata.presentation==='static-front'&&metadata.stillStep===true;}
  function pose(distance,height,walking,reduced){
    if(walking!==true||reduced===true||typeof distance!=='number'||!Number.isFinite(distance)||distance<0||
       typeof height!=='number'||!Number.isFinite(height)||height<=0)return neutral;
    var phase=(distance%limits.stride)/limits.stride*Math.PI*2,sine=Math.sin(phase);
    return Object.freeze({active:true,bob:sine*sine*Math.min(limits.maxBob,height*limits.heightFraction),roll:sine*limits.maxRoll});
  }
  return Object.freeze({revision:'whole-artwork-manual-step1',enabled:enabled,pose:pose,limits:limits});
}));

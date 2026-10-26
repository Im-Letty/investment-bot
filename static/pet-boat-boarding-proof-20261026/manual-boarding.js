/* Isolated fixed-boat manual boarding. No sailing, game storage, ownership or unlocks. */
(function(root,factory){'use strict';var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PetManualBoarding=api;}(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';var EPS=1e-7;
function finite(v){return typeof v==='number'&&Number.isFinite(v);}
function point(p){return !!p&&finite(p.x)&&finite(p.y)&&finite(p.z);}
function validatePlan(p){
 if(!p||!point(p.start)||!point(p.end)||!finite(p.width)||p.width<.20||p.width>.80)return null;
 var dx=p.end.x-p.start.x,dz=p.end.z-p.start.z,length=Math.hypot(dx,dz),incline=Math.atan2(Math.abs(p.end.y-p.start.y),length)*180/Math.PI;
 if(!finite(length)||length<.1||length>2||incline>15)return null;
 return{start:{x:p.start.x,y:p.start.y,z:p.start.z},end:{x:p.end.x,y:p.end.y,z:p.end.z},width:p.width,length:length,dx:dx/length,dz:dz/length,incline:incline};
}
function allowsKeyboardTarget(target,scope){
 if(!target||!scope||!(target===scope||typeof scope.contains==='function'&&scope.contains(target)))return false;
 for(var p=target;p;p=p.parentElement){if(['INPUT','TEXTAREA','SELECT','BUTTON','A','SUMMARY'].indexOf(p.tagName)>=0||p.isContentEditable)return false;if(p===scope)return true;}
 return false;
}
function create(plan,options){
 options=options||{};var p=validatePlan(plan),speed=options.speed===undefined?.45:options.speed;
 if(!p||!finite(speed)||speed<.1||speed>1||typeof options.sampleSupport!=='function')throw Error('invalid_manual_boarding');
 Object.freeze(p.start);Object.freeze(p.end);
 var held=new Set(),destination=null,progress=0,distance=0,heading=Math.atan2(p.dx,p.dz),position=null,surface=null,dead=false,reason='initial';
 function support(at){
  var t=at/p.length,q={x:p.start.x+p.dx*at,y:p.start.y+(p.end.y-p.start.y)*t,z:p.start.z+p.dz*at},hit;
  try{hit=options.sampleSupport(q);}catch(_){return null;}
  if(!point(hit)||!finite(hit.normalY)||hit.normalY<.80||Math.abs(hit.x-q.x)>.005||Math.abs(hit.z-q.z)>.005||Math.abs(hit.y-q.y)>.03)return null;
  return hit;
 }
 var first=support(0),last=support(p.length);if(!first||!last)throw Error('unsupported_boarding_plan');position={x:first.x,y:first.y,z:first.z};surface=first.surface||'support';
 function permitted(){try{return !dead&&(typeof options.inputAllowed!=='function'||options.inputAllowed()===true);}catch(_){return false;}}
 function direction(){var d=0;held.forEach(function(k){d+=k==='ArrowUp'||k==='w'?1:-1;});if(d)return Math.sign(d);if(destination!==null&&Math.abs(destination-progress)>EPS)return Math.sign(destination-progress);return 0;}
 function hasIntent(){var d=direction();return !!d&&!(d>0&&progress>=p.length-EPS||d<0&&progress<=EPS);}
 function snapshot(){return{progress:progress,length:p.length,fraction:progress/p.length,position:{x:position.x,y:position.y,z:position.z},heading:heading,distance:distance,phase:progress<=EPS?'dock':progress>=p.length-EPS?'aboard':'plank',walking:hasIntent(),destination:destination,surface:surface,reason:reason,dead:dead,sailing:false,save:false,anatomicalFootFit:false};}
 function notify(){if(typeof options.onChange==='function')try{options.onChange(snapshot());}catch(_){}}
 function cancel(why){if(dead)return;held.clear();destination=null;reason=why||'cancelled';notify();}
 function keyName(k){return k==='ArrowUp'||k==='ArrowDown'?k:k==='w'||k==='W'?'w':k==='s'||k==='S'?'s':null;}
 function keyDown(key,repeat){var k=keyName(key);if(!k||dead)return false;if(!permitted()){cancel('input_gate');return false;}if(repeat&&!held.has(k))return false;held.add(k);destination=null;reason='manual_keyboard';notify();return true;}
 function keyUp(key){if(dead)return false;var k=keyName(key);if(!k)return false;held.delete(k);reason='key_released';notify();return true;}
 function tap(q){
  if(!point(q)||!permitted()){if(!permitted())cancel('input_gate');return false;}
  var dx=q.x-p.start.x,dz=q.z-p.start.z,at=dx*p.dx+dz*p.dz,lateral=Math.abs(dx*p.dz-dz*p.dx);
  if(at<0||at>p.length||lateral>p.width/2-.04)return false;
  var hit=support(at);if(!hit||Math.abs(q.y-hit.y)>.06)return false;
  held.clear();destination=at;reason='manual_tap';notify();return true;
 }
 function tick(ms){
  if(dead)return false;if(!permitted()){cancel('input_gate');return false;}
  if(!finite(ms)||ms<0||ms>250){cancel('invalid_dt');return false;}
  var d=direction();if(!d||!hasIntent()||ms===0)return false;
  var step=speed*Math.min(ms,50)/1000,next=Math.max(0,Math.min(p.length,progress+d*step));
  if(destination!==null)next=d>0?Math.min(next,destination):Math.max(next,destination);
  var n=Math.max(1,Math.ceil(Math.abs(next-progress)/.008)),hit=null;
  for(var i=1;i<=n;i++){hit=support(progress+(next-progress)*i/n);if(!hit){cancel('unsupported_surface');return false;}}
  distance+=Math.abs(next-progress);progress=next;position={x:hit.x,y:hit.y,z:hit.z};surface=hit.surface||'support';heading=Math.atan2(p.dx*d,p.dz*d);reason='manual_move';
  if(destination!==null&&Math.abs(progress-destination)<=EPS)destination=null;notify();return true;
 }
 return Object.freeze({snapshot:snapshot,keyDown:keyDown,keyUp:keyUp,tap:tap,tick:tick,cancel:cancel,hasIntent:hasIntent,destroy:function(){if(dead)return;cancel('destroyed');dead=true;},plan:Object.freeze(p)});
}
return Object.freeze({validatePlan:validatePlan,allowsKeyboardTarget:allowsKeyboardTarget,create:create});
}));

/* One source-bound water route. No free sailing, physics, game storage or ownership. */
(function(root,factory){'use strict';var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PetRouteSailing=api;}(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';var EPS=1e-6;
function finite(n){return typeof n==='number'&&Number.isFinite(n);}
function wrap(a){return((a+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;}
function plan(value){
 if(!value||!Array.isArray(value.route)||value.route.length<2||value.route.length>16||!finite(value.waterY)||Math.abs(value.waterY)>2||!finite(value.dockYaw))return null;
 var route=[],length=0;
 for(var i=0;i<value.route.length;i++){var p=value.route[i];if(!p||!finite(p.x)||!finite(p.z))return null;var q={x:p.x,z:p.z,s:length};if(i){var d=Math.hypot(q.x-route[i-1].x,q.z-route[i-1].z);if(d<.05||!finite(d))return null;length+=d;q.s=length;}route.push(Object.freeze(q));}
 if(length>8)return null;return Object.freeze({route:Object.freeze(route),length:length,waterY:value.waterY,dockYaw:wrap(value.dockYaw)});
}
function pointAt(p,s){if(!p||!Array.isArray(p.route)||!finite(s)||s<0||s>p.length)return null;var i=0;while(i<p.route.length-2&&s>p.route[i+1].s)i++;var a=p.route[i],b=p.route[i+1],t=Math.max(0,Math.min(1,(s-a.s)/(b.s-a.s)));return{x:a.x+(b.x-a.x)*t,y:p.waterY,z:a.z+(b.z-a.z)*t,yaw:Math.atan2(b.x-a.x,b.z-a.z)};}
function create(value,options){
 options=options||{};var p=plan(value),speed=options.speed===undefined?.6:options.speed,turnRate=options.turnRate===undefined?1:options.turnRate;
 if(!p||!finite(speed)||speed<.1||speed>1||!finite(turnRate)||turnRate<.2||turnRate>2||typeof options.validatePose!=='function')throw Error('invalid_route_sailing');
 var s=0,yaw=p.dockYaw,travel=0,held=new Set(),goal=null,dead=false,reason='initial';
 function allowed(){try{return !dead&&(typeof options.inputAllowed!=='function'||options.inputAllowed()===true);}catch(_){return false;}}
 function safe(q){try{return options.validatePose(q)===true;}catch(_){return false;}}
 function homeYaw(){return Math.abs(wrap(yaw-p.dockYaw))<=EPS;}
 function rawDir(){var d=0;held.forEach(function(k){d+=k==='w'||k==='ArrowUp'?1:-1;});if(d)return Math.sign(d);if(goal!==null){if(Math.abs(goal-s)>EPS)return Math.sign(goal-s);if(goal<=EPS&&!homeYaw())return-1;}return 0;}
 function hasIntent(){var d=rawDir();return d>0?s<p.length-EPS:d<0?s>EPS||!homeYaw():false;}
 function pose(){var q=pointAt(p,s);q.yaw=yaw;return q;}
 function snapshot(){var q=pose(),d=hasIntent()?rawDir():0,physicalHome=s<=EPS&&homeYaw(),target=d<0&&s<=EPS?p.dockYaw:pointAt(p,s).yaw,rotating=d!==0&&Math.abs(wrap(target-yaw))>EPS;return{progress:s,length:p.length,fraction:s/p.length,position:{x:q.x,y:q.y,z:q.z},yaw:yaw,targetYaw:target,direction:d,moving:d!==0,turning:rotating,travel:travel,goal:goal,phase:physicalHome&&d===0?'docked':rotating?(d<0&&s<=EPS?'aligning_home':'aligning_route'):s>=p.length-EPS?'route_end':d<0?'returning':d>0?'sailing':'paused_away',boardingAvailable:physicalHome&&d===0,reason:reason,dead:dead,sailingSave:false,normalGame:false};}
 function notify(){if(typeof options.onChange==='function')try{options.onChange(snapshot());}catch(_){}}
 function cancel(why){if(dead)return;held.clear();goal=null;reason=why||'cancelled';notify();}
 function key(k){return k==='ArrowUp'||k==='ArrowDown'?k:k==='w'||k==='W'?'w':k==='s'||k==='S'?'s':null;}
 function keyDown(k,repeat){k=key(k);if(!k||dead)return false;if(!allowed()){cancel('input_gate');return false;}if(repeat&&!held.has(k))return false;held.add(k);goal=null;reason='manual_key';notify();return true;}
 function keyUp(k){if(dead)return false;k=key(k);if(!k)return false;held.delete(k);reason='key_released';notify();return true;}
 function tapProgress(at){if(!finite(at)||at<0||at>p.length||!allowed()){if(!allowed())cancel('input_gate');return false;}held.clear();goal=at;reason='manual_tap';notify();return true;}
 function tick(ms){
  if(dead)return false;if(!allowed()){cancel('input_gate');return false;}if(!finite(ms)||ms<0||ms>250){cancel('invalid_dt');return false;}if(!hasIntent()||ms===0)return false;
  var d=rawDir(),dt=Math.min(ms,50)/1000,desired=d<0&&s<=EPS?p.dockYaw:pointAt(p,s).yaw,diff=wrap(desired-yaw),nextS=s,nextYaw=yaw;
  if(Math.abs(diff)>EPS)nextYaw=wrap(yaw+Math.sign(diff)*Math.min(Math.abs(diff),turnRate*dt));
  else{nextS=Math.max(0,Math.min(p.length,s+d*speed*dt));if(goal!==null)nextS=d>0?Math.min(nextS,goal):Math.max(nextS,goal);}
  var steps=Math.max(1,Math.ceil(Math.abs(nextS-s)/.01));
  for(var i=1;i<=steps;i++){var q=pointAt(p,s+(nextS-s)*i/steps);q.yaw=nextYaw;if(!safe(q)){cancel('unsafe_pose');return false;}}
  travel+=Math.abs(nextS-s);s=nextS;yaw=nextYaw;reason=Math.abs(diff)>EPS?'manual_turn':'manual_sail';
  if(goal!==null&&Math.abs(goal-s)<=EPS&&(goal>EPS||homeYaw()))goal=null;notify();return true;
 }
 if(!safe(pose()))throw Error('unsafe_initial_pose');
 return Object.freeze({snapshot:snapshot,keyDown:keyDown,keyUp:keyUp,tapProgress:tapProgress,tick:tick,cancel:cancel,hasIntent:hasIntent,plan:p,destroy:function(){if(dead)return;cancel('destroyed');dead=true;}});
}
return Object.freeze({validatePlan:plan,pointAt:pointAt,wrap:wrap,create:create});
}));

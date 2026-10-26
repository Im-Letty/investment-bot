/* Isolated supported boarding-to-route handoff. Existing controllers are immutable dependencies. */
(function(root,factory){'use strict';var api=factory(typeof module==='object'&&module.exports?require('../pet-boat-boarding-proof-20261026/manual-boarding.js'):root.PetManualBoarding,typeof module==='object'&&module.exports?require('../pet-boat-state-proof-20261026/restorable-sailing.js'):root.PetRestorableRouteSailing);if(typeof module==='object'&&module.exports)module.exports=api;else root.PetBoatContinuity=api;}(typeof globalThis!=='undefined'?globalThis:this,function(Manual,Sailing){
'use strict';var EPS=1e-6;
function finite(v){return typeof v==='number'&&Number.isFinite(v);}
function point(v){return v&&finite(v.x)&&finite(v.y)&&finite(v.z);}
function exact(v,names){return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===names.slice().sort().join('|');}
function create(boardPlan,routePlan,options){
 options=options||{};var b=Manual.validatePlan(boardPlan),p=Sailing.validatePlan(routePlan),speed=options.speed===undefined?.45:options.speed;
 if(!b||!p||!finite(speed)||speed<.1||speed>1||typeof options.sampleSupport!=='function'||typeof options.aboardSupport!=='function'||typeof options.validatePose!=='function')throw Error('invalid_continuity_basis');
 Object.freeze(b.start);Object.freeze(b.end);Object.freeze(b);
 var mode='boarding',progress=0,held=new Set(),goal=null,reason='initial_shore',dead=false,travel=0,pilot=null;
 function allowed(){try{return !dead&&(typeof options.inputAllowed!=='function'||options.inputAllowed()===true);}catch(_){return false;}}
 function support(at){var f=at/b.length,q={x:b.start.x+b.dx*at,y:b.start.y+(b.end.y-b.start.y)*f,z:b.start.z+b.dz*at},hit;try{hit=options.sampleSupport(q);}catch(_){return null;}if(!point(hit)||!finite(hit.normalY)||hit.normalY<.8||Math.abs(hit.x-q.x)>.005||Math.abs(hit.z-q.z)>.005||Math.abs(hit.y-q.y)>.03)return null;return{x:hit.x,y:hit.y,z:hit.z,surface:hit.surface||'actual_support'};}
 function floor(s){var hit;try{hit=options.aboardSupport(s);}catch(_){return null;}return point(hit)?{x:hit.x,y:hit.y,z:hit.z,surface:hit.surface||'actual_hull_floor'}:null;}
 function distance(a,z){return Math.hypot(a.x-z.x,a.y-z.y,a.z-z.z);}
 function home(y){return Math.abs(Sailing.wrap(y-p.dockYaw))<=EPS;}
 function state(v){
  if(!exact(v,['mode','boardingProgress','routeProgress','yaw'])||!['boarding','aboard'].includes(v.mode)||![v.boardingProgress,v.routeProgress,v.yaw].every(finite)||v.boardingProgress<0||v.boardingProgress>b.length||v.routeProgress<0||v.routeProgress>p.length||v.yaw< -Math.PI||v.yaw>Math.PI)throw Error('invalid_continuity_state');
  if(v.mode==='boarding'&&(v.routeProgress!==0||!home(v.yaw)||!support(v.boardingProgress)))throw Error('unsupported_boarding_state');
  if(v.mode==='aboard'&&(Math.abs(v.boardingProgress-b.length)>EPS||options.validatePose({...Sailing.pointAt(p,v.routeProgress),yaw:v.yaw})!==true||!floor({...Sailing.pointAt(p,v.routeProgress),yaw:v.yaw})))throw Error('unsafe_aboard_state');
  return{mode:v.mode,boardingProgress:v.boardingProgress,routeProgress:v.routeProgress,yaw:v.yaw};
 }
 function freshPilot(v){pilot?.destroy();pilot=Sailing.create(routePlan,{validatePose:options.validatePose,inputAllowed:allowed,initialPose:{progress:v.routeProgress,yaw:v.yaw},onChange:function(){notify();}});}
 function boardDirection(){var d=0;held.forEach(k=>{d+=k==='w'||k==='ArrowUp'?1:-1;});if(d)return Math.sign(d);return goal!==null&&Math.abs(goal-progress)>EPS?Math.sign(goal-progress):0;}
 function hasIntent(){if(dead)return false;if(mode==='aboard')return pilot.hasIntent();var d=boardDirection();return !!d&&!(d>0&&progress>=b.length-EPS||d<0&&progress<=EPS);}
 function snapshot(){var s=pilot.snapshot(),contact=mode==='boarding'?support(progress):floor({...s.position,yaw:s.yaw});if(!contact)throw Error('support_lost');return{mode:mode,phase:mode==='boarding'?(progress<=EPS?'shore':progress>=b.length-EPS?'stern_waiting_helm':'boarding'):s.phase,boardingProgress:progress,boardingLength:b.length,routeProgress:s.progress,routeLength:p.length,yaw:mode==='aboard'?s.yaw:Math.atan2(b.dx*(boardDirection()<0?-1:1),b.dz*(boardDirection()<0?-1:1)),hullPosition:s.position,hullYaw:s.yaw,actorTarget:contact,moving:hasIntent(),walking:mode==='boarding'&&hasIntent(),travel:travel,goal:mode==='boarding'?goal:s.goal,canTakeHelm:mode==='boarding'&&progress>=b.length-EPS&&!hasIntent(),canDisembark:mode==='aboard'&&s.boardingAvailable&&!hasIntent(),plankVisible:s.boardingAvailable,reason:reason,pilot:s,dead:dead,normalGame:false,anatomicalFootFit:false};}
 function notify(){if(typeof options.onChange==='function')try{options.onChange(snapshot());}catch(_){}}
 function cancel(why){if(dead)return;held.clear();goal=null;pilot?.cancel(why||'cancelled');reason=why||'cancelled';notify();}
 function key(k){return k==='ArrowUp'||k==='ArrowDown'?k:k==='w'||k==='W'?'w':k==='s'||k==='S'?'s':null;}
 function keyDown(k,repeat){k=key(k);if(!k||dead)return false;if(!allowed()){cancel('input_gate');return false;}if(mode==='aboard')return pilot.keyDown(k,repeat);if(repeat&&!held.has(k))return false;held.add(k);goal=null;reason='manual_board_key';notify();return true;}
 function keyUp(k){k=key(k);if(!k||dead)return false;held.delete(k);pilot.keyUp(k);reason='key_released';notify();return true;}
 function boardTo(at){if(dead||mode!=='boarding'||!finite(at)||at<0||at>b.length||!allowed()||!support(at))return false;held.clear();goal=at;reason='manual_board_target';notify();return true;}
 function sailTo(at){if(dead||mode!=='aboard'||!allowed())return false;return pilot.tapProgress(at);}
 function takeHelm(){if(dead||!allowed()||mode!=='boarding'||progress<b.length-EPS||hasIntent())return false;var a=support(progress),s=pilot.snapshot(),z=floor({...s.position,yaw:s.yaw});if(!a||!z||!s.boardingAvailable||distance(a,z)>EPS){reason='handoff_contact_mismatch';notify();return false;}cancel('explicit_take_helm');mode='aboard';reason='explicit_take_helm';notify();return true;}
 function disembark(){if(dead||!allowed()||mode!=='aboard'||!pilot.snapshot().boardingAvailable||hasIntent())return false;var s=pilot.snapshot(),a=floor({...s.position,yaw:s.yaw}),z=support(b.length);if(!a||!z||distance(a,z)>EPS){reason='handoff_contact_mismatch';notify();return false;}cancel('explicit_disembark');progress=b.length;mode='boarding';reason='explicit_disembark';notify();return true;}
 function tick(ms){if(dead)return false;if(!allowed()){cancel('input_gate');return false;}if(!finite(ms)||ms<0||ms>250){cancel('invalid_dt');return false;}if(mode==='aboard')return pilot.tick(ms);var d=boardDirection();if(!hasIntent()||ms===0)return false;var next=Math.max(0,Math.min(b.length,progress+d*speed*Math.min(ms,50)/1000));if(goal!==null)next=d>0?Math.min(next,goal):Math.max(next,goal);var n=Math.max(1,Math.ceil(Math.abs(next-progress)/.008));for(var i=1;i<=n;i++)if(!support(progress+(next-progress)*i/n)){cancel('unsupported_surface');return false;}travel+=Math.abs(next-progress);progress=next;if(goal!==null&&Math.abs(goal-progress)<=EPS)goal=null;reason='manual_board_move';notify();return true;}
 function savedState(){var s=pilot.snapshot();return state({mode:mode,boardingProgress:progress,routeProgress:s.progress,yaw:s.yaw});}
 function restore(v){if(dead)return false;var parsed;try{parsed=state(v);}catch(_){return false;}cancel('restore');mode=parsed.mode;progress=parsed.boardingProgress;freshPilot(parsed);reason='restored_paused';notify();return true;}
 var initial=state(options.initialState||{mode:'boarding',boardingProgress:0,routeProgress:0,yaw:p.dockYaw});mode=initial.mode;progress=initial.boardingProgress;freshPilot(initial);
 // The actual measured board endpoint and actual transformed hull socket must meet before using this integration.
 var end=support(b.length),dockPose={...Sailing.pointAt(p,0),yaw:p.dockYaw},aboard=floor(dockPose);if(!end||!aboard||distance(end,aboard)>EPS)throw Error('handoff_basis_mismatch');
 return Object.freeze({snapshot:snapshot,hasIntent:hasIntent,keyDown:keyDown,keyUp:keyUp,boardTo:boardTo,sailTo:sailTo,takeHelm:takeHelm,disembark:disembark,tick:tick,cancel:cancel,restore:restore,savedState:savedState,validateState:state,boardingPlan:Object.freeze(b),routePlan:p,handoffDelta:distance(end,aboard),destroy:function(){if(dead)return;cancel('destroyed');dead=true;pilot.destroy();}});
}
return Object.freeze({create:create});
}));
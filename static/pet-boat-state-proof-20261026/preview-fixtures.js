/* Explicit preview-only failure examples. Memory scenarios do not change real storage. */
(function(root,factory){'use strict';var api=factory(typeof module==='object'&&module.exports?require('./preview-state.js'):root.PetBoatPreviewState,typeof module==='object'&&module.exports?require('../pet-boat-sailing-proof-20261026/sailing-controller.js'):root.PetRouteSailing);if(typeof module==='object'&&module.exports)module.exports=api;else root.PetBoatPreviewFaults=api;}(typeof globalThis!=='undefined'?globalThis:this,function(Persistence,Sailing){
'use strict';function create(storage,mode,options){
 if(!['normal','writeFailure','readFailure','invalid','conflict'].includes(mode))throw Error('invalid_preview_scenario');
 options=options||{};var memory=new Map(),isMemory=mode==='invalid'||mode==='conflict',access=options.accessCounter||{reads:0,writes:0},plan=Sailing.validatePlan(options.plan);if(!plan)throw Error('invalid_fixture_plan');
 var adapter={getItem:function(key){if(mode==='readFailure')throw Error('preview_read_unavailable');if(isMemory)return memory.has(key)?memory.get(key):null;access.reads++;return storage.getItem(key);},setItem:function(key,value){if(mode==='writeFailure')throw Error('preview_write_unavailable');if(isMemory){memory.set(key,value);return;}access.writes++;return storage.setItem(key,value);}};
 var store=Persistence.createStore(adapter,options),start=options.currentPose||{progress:0,yaw:plan.dockYaw,paused:true};
 if(mode==='invalid')memory.set(store.key,'{"format":"BoatSailingPreview","version":99,"source":{},"pose":{}}');
 if(mode==='conflict')memory.set(store.key,store.encode(start));
 var loaded=store.load();
 if(mode==='conflict'){var changed={progress:start.progress<plan.length/2?plan.length:0,yaw:start.yaw,paused:true};memory.set(store.key,store.encode(changed));}
 return Object.freeze({store:store,loaded:loaded,mode:mode,memoryOnly:isMemory,physicalAccess:access,realWritePrevented:mode!=='normal'});
}return Object.freeze({create:create});
}));
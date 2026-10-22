/* Push only: no fetch handler, response cache, timer or data collector. */
'use strict';
var DB='kn-device-notifications-v1';
function state(operation){return new Promise(function(resolve,reject){
  var open=indexedDB.open(DB,1);
  open.onupgradeneeded=function(){open.result.createObjectStore('state');};
  open.onerror=function(){reject(Error('state_unavailable'));};
  open.onsuccess=function(){var db=open.result,tx=db.transaction('state','readwrite'),store=tx.objectStore('state');
    var result;try{result=operation(store);}catch(e){db.close();reject(e);return;}
    tx.oncomplete=function(){db.close();resolve(result);};tx.onerror=function(){db.close();reject(Error('state_unavailable'));};tx.onabort=tx.onerror;
  };
});}
self.addEventListener('install',function(event){event.waitUntil(self.skipWaiting());});
self.addEventListener('message',function(event){
  if(!event.source||!event.source.url||new URL(event.source.url).origin!==self.location.origin)return;
  var data=event.data,port=event.ports&&event.ports[0];
  if(!data||!port)return;
  if(data.kind==='notification-owner-read'){
    var owner='';
    event.waitUntil(state(function(store){var request=store.get('owner');request.onsuccess=function(){owner=request.result||'';};}).then(function(){port.postMessage({ok:true,owner_id:owner});},function(){port.postMessage({ok:false});}));
    return;
  }
  if(data.kind!=='notification-owner'||typeof data.owner_id!=='string'||data.owner_id!==''&&!/^[a-f0-9-]{36}$/i.test(data.owner_id))return;
  event.waitUntil(state(function(store){store.put(data.owner_id,'owner');}).then(function(){port.postMessage({ok:true});},function(){port.postMessage({ok:false});}));
});
self.addEventListener('push',function(event){
  event.waitUntil((async function(){
    var data;try{data=event.data.json();}catch(_){return;}
    if(!data||data.kind!=='todo'||typeof data.id!=='string'||!/^[a-f0-9-]{36}$/i.test(data.id)||typeof data.owner_id!=='string'||typeof data.task_id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(data.task_id))return;
    var allowed=false;
    try{await state(function(store){
      var owner=store.get('owner');owner.onsuccess=function(){
        if(owner.result!==data.owner_id)return;
        var previous=store.get('seen:'+data.id);previous.onsuccess=function(){if(!previous.result){store.put(true,'seen:'+data.id);allowed=true;}};
      };
    });}catch(_){return;}
    if(!allowed)return;
    await self.registration.showNotification('やることリストの確認',{
      body:'設定した通知時刻になりました。サイトを開いて確認してください。',
      tag:'kn-todo-'+data.id,renotify:false,icon:'/static/favicon.png',
      data:{task_id:data.task_id,owner_id:data.owner_id}
    });
  })());
});
self.addEventListener('notificationclick',function(event){
  event.notification.close();
  // Always open our fixed app URL. Payloads cannot navigate to arbitrary URLs.
  event.waitUntil(self.clients.openWindow('/#todo-reminders'));
});

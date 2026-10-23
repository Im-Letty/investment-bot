(function(w){
 'use strict';
 var conversation,entryEpoch=0,roomRead=null;
 function cancelEntry(){entryEpoch++;if(roomRead)roomRead.abort();roomRead=null;}
 function companyCode(value){var key=typeof value==='string'?value.normalize('NFKC').trim().toUpperCase():'';return /^[0-9][0-9A-Z]{3}(?:\.(?:T|JP))?$/.test(key)?key.replace(/\.(?:T|JP)$/,''):'';}
 function open(origin){cancelEntry();return conversation.open(origin);}
 function close(){cancelEntry();return conversation.close();}
 async function openForCompany(value,options){
  cancelEntry();var epoch=entryEpoch,code=companyCode(value);options=options||{};if(!code)return false;
  var controller=new w.AbortController(),onAbort,timer;roomRead=controller;
  var cancelled=new Promise(function(resolve){onAbort=function(){resolve(null);};controller.signal.addEventListener('abort',onAbort,{once:true});});
  timer=w.setTimeout(function(){controller.abort();},12000);
  try{
   var read=w.fetch('/api/stock-talk/rooms?q='+encodeURIComponent(code),{cache:'no-store',signal:controller.signal}).then(function(response){return response.ok?response.json():null;});
   var data=await Promise.race([read,cancelled]);
   if(epoch!==entryEpoch||!data||data.ok!==true||!Array.isArray(data.rooms))return false;
   var room=data.rooms.find(function(item){return item&&item.code===code&&item.category==='stock:'+code&&typeof item.name==='string'&&item.name.trim();});
   if(!room||typeof options.isCurrent==='function'&&!options.isCurrent())return false;
   // Releasing the company sheet changes its current token; open synchronously next.
   if(typeof options.beforeOpen==='function'&&options.beforeOpen()===false)return false;
   if(epoch!==entryEpoch)return false;
   return conversation.openRoom({code:room.code,category:room.category,name:room.name},{onReturn:options.onReturn})===true;
  }catch(_){return false;}finally{w.clearTimeout(timer);controller.signal.removeEventListener('abort',onAbort);if(roomRead===controller)roomRead=null;}
 }
 function setup(){
  if(!w.knCreateConversation){w.setTimeout(setup,100);return;}
  var rooms=[['stock:7203','トヨタ自動車 7203'],['stock:6758','ソニーグループ 6758'],['stock:9984','ソフトバンクグループ 9984'],['stock:8306','三菱UFJ 8306'],['index:N225','日経平均'],['index:SP500','S&P500'],['index:DJI','ダウ平均'],['index:IXIC','ナスダック']];
  conversation=w.knCreateConversation(w,{stock:true,categories:rooms,onReady:function(s){
   if(s.scope)return;
   // Existing watchlist is the only favorites source; no second list is saved.
   var watched;try{watched=JSON.parse(w.localStorage.getItem('alert_watchlist_v1')||'[]');}catch(e){watched=[];}
   if(!Array.isArray(watched))return;
   var links=document.createElement('div');links.className='cw-stock-favorites';
   watched.slice(0,30).forEach(function(item){var raw=typeof item==='string'?item:item.symbol||item.code||'',code=raw.replace(/\.(T|JP)$/,'');if(!/^[0-9][0-9A-Z]{3}$/.test(code))return;
    var b=document.createElement('button');b.type='button';b.className='cw-category';b.textContent='♡ '+(item.name||code);b.addEventListener('click',async function(){try{var r=await w.fetch('/api/stock-talk/rooms?q='+encodeURIComponent(code),{cache:'no-store'}),d=await r.json();if(!s.root.isConnected)return;var room=(d.rooms||[]).find(function(v){return v.code===code;});if(room)s.chooseRoom(room);}catch(e){}});links.appendChild(b);});
   if(links.children.length){if(s.roomPicker)s.roomPicker.appendChild(links);else s.categoryNote.parentNode.before(links);}
  }});
  w.KNStockTalk=Object.assign({},conversation,{open:open,close:close,cancelPending:cancelEntry,openForCompany:openForCompany});w.openStockTalk=open;
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})(window);

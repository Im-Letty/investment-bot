(function(w){
 'use strict';
 var conversation;
 function setup(){
  if(!w.knCreateConversation){w.setTimeout(setup,100);return;}
  var rooms=[['stock:7203','トヨタ自動車 7203'],['stock:6758','ソニーグループ 6758'],['stock:9984','ソフトバンクグループ 9984'],['stock:8306','三菱UFJ 8306'],['index:N225','日経平均'],['index:SP500','S&P500'],['index:DJI','ダウ平均'],['index:IXIC','ナスダック']];
  conversation=w.knCreateConversation(w,{stock:true,categories:rooms,onReady:function(s){
   // Existing watchlist is the only favorites source; no second list is saved.
   var watched;try{watched=JSON.parse(w.localStorage.getItem('alert_watchlist_v1')||'[]');}catch(e){watched=[];}
   if(!Array.isArray(watched))return;
   var links=document.createElement('div');links.className='cw-stock-favorites';
   watched.slice(0,30).forEach(function(item){var raw=typeof item==='string'?item:item.symbol||item.code||'',code=raw.replace(/\.(T|JP)$/,'');if(!/^[0-9][0-9A-Z]{3}$/.test(code))return;
    var b=document.createElement('button');b.type='button';b.className='cw-category';b.textContent='♡ '+(item.name||code);b.addEventListener('click',async function(){try{var r=await w.fetch('/api/stock-talk/rooms?q='+encodeURIComponent(code),{cache:'no-store'}),d=await r.json();if(!s.root.isConnected)return;var room=(d.rooms||[]).find(function(v){return v.code===code;});if(room)s.chooseRoom(room);}catch(e){}});links.appendChild(b);});
   if(links.children.length)s.categoryNote.parentNode.before(links);
  }});
  w.KNStockTalk=conversation;w.openStockTalk=conversation.open;
  var card=document.createElement('button');card.type='button';card.id='talkCard';card.textContent='みんなの銘柄トーク';card.addEventListener('click',conversation.open);
  function place(){var existing=document.getElementById('talkCard');if(existing){if(existing!==card&&!existing.dataset.stockTalkReady){existing.dataset.stockTalkReady='true';existing.addEventListener('click',conversation.open);}return;}var target=document.querySelector('#lp-section .content')||document.getElementById('lp-section')||document.body;target.appendChild(card);}
  place();new MutationObserver(place).observe(document.body,{childList:true,subtree:true});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})(window);

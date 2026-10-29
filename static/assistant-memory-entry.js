/* Two conversational surfaces share one optional, private summary controller. */
(function(root,factory){
  'use strict';var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else {root.KNAssistantMemoryEntry=api;if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',function(){api.start(root);},{once:true});else api.start(root);}
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  function start(w){
    if(w.knAssistantMemory)return w.knAssistantMemory;if(!w.KNSharedAssistantContext||!w.document.body)return null;var d=w.document,seen=new WeakSet();
    var controller=w.KNSharedAssistantContext.createController(w,{ensureReady:async function(){
      // This callback is invoked only by the explicit connection control.
      // No authentication or private-frame preparation occurs on module load.
      if(typeof w.knEnsureGuest!=='function'||typeof w.knPrepareAssistantMemory!=='function')throw Error('memory_not_ready');
      await w.knEnsureGuest();w.knPrepareAssistantMemory();
    }});w.knAssistantMemory=controller;
    function attach(){[['knChatPanel','knChatBody'],['teachOv','teachBody']].forEach(function(ids){var host=d.getElementById(ids[0]),before=d.getElementById(ids[1]);if(!host||seen.has(host))return;seen.add(host);var box=controller.mount(host);if(box&&before&&before.parentNode===host)host.insertBefore(box,before);});}
    attach();if(typeof w.MutationObserver==='function')new w.MutationObserver(attach).observe(d.body,{childList:true,subtree:true});return controller;
  }
  return Object.freeze({start:start});
});

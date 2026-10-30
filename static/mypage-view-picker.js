/* Round view tabs retain the existing controls, keyboard support and controllers.
   This enhancement owns no route, ledger document, draft or persistent state. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory;
  if(root){var api=factory(root);root.KNMyPageViewPicker=api;if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',api.mount,{once:true});else api.mount();}
})(typeof window==='undefined'?null:window,function(w){
  'use strict';
  var doc=w.document,top,source=[],observer,discovery;
  function set(node,key,value){if(node.getAttribute(key)!==value)node.setAttribute(key,value);}
  function sync(){
    // The original controller's .on class remains authoritative, including
    // owner changes and entry from the menu or the retained private iframe.
    source.forEach(function(button){set(button,'aria-pressed',String(button.classList.contains('on')));});
  }
  function mount(){
    var page=doc.getElementById('myPageOv'),nextTop=page&&page.querySelector('.mp-toptabs');
    if(!nextTop){
      if(!discovery&&typeof w.MutationObserver==='function'){discovery=new w.MutationObserver(mount);discovery.observe(doc.body,{childList:true,subtree:true});}
      return false;
    }
    if(top===nextTop){sync();return true;}
    var buttons=Array.from(nextTop.querySelectorAll('.mp-toptab'));
    if(buttons.length!==2)return false;
    if(discovery){discovery.disconnect();discovery=null;}
    if(observer)observer.disconnect();top=nextTop;source=buttons;
    // Keep the same nodes, labels, listeners, focus, hidden/inert state and
    // button semantics supplied by mypage-theme. Missing assets retain the
    // original controls as a fallback, rather than hiding them for a replacement.
    sync();set(top,'data-mp-tabs-ready','true');
    if(typeof w.MutationObserver==='function'){
      observer=new w.MutationObserver(sync);
      observer.observe(top,{subtree:true,attributes:true,attributeFilter:['class']});
    }
    return true;
  }
  return {mount:mount,sync:sync};
});

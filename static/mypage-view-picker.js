/* Present the active view as a heading and the other view as a destination. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory;
  if(root){var api=factory(root);root.KNMyPageViewPicker=api;if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',api.mount,{once:true});else api.mount();}
})(typeof window==='undefined'?null:window,function(w){
  'use strict';
  var doc=w.document,top,title,source=[],observer,discovery;
  function set(node,key,value){if(node.getAttribute(key)!==value)node.setAttribute(key,value);}
  function sync(){
    var current=source.find(function(button){return button.classList.contains('on');});
    if(!current)return;
    var moveFocus=doc.activeElement===current&&!top.hidden;
    var label=current.textContent;
    if(title.textContent!==label)title.textContent=label;
    source.forEach(function(button){
      var selected=button===current;
      set(button,'aria-pressed',String(selected));
      button.hidden=selected;
    });
    if(moveFocus)title.focus({preventScroll:true});
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
    title=top.querySelector('.mp-view-title');
    if(!title){
      title=doc.createElement('h1');
      title.className='mp-view-title';
      title.setAttribute('tabindex','-1');
      top.insertBefore(title,source[0]);
    }
    sync();set(top,'data-mp-tabs-ready','true');
    if(typeof w.MutationObserver==='function'){
      observer=new w.MutationObserver(sync);
      observer.observe(top,{subtree:true,attributes:true,attributeFilter:['class'],childList:true,characterData:true});
    }
    return true;
  }
  return {mount:mount,sync:sync};
});

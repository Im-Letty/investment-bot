/* Use the scroll position of the current MyPage view for the navigation fade. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory;
  if(root){var api=factory(root);root.KNMyPageViewPicker=api;if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',api.mount,{once:true});else api.mount();}
})(typeof window==='undefined'?null:window,function(w){
  'use strict';
  var doc=w.document,page,top,body,pane,frame,frameDocument,buttons=[],observer,discovery;
  var fadeQueued=false,fadeDistance=96;

  function set(node,key,value){
    if(node.getAttribute(key)!==value)node.setAttribute(key,value);
  }

  function updateFade(){
    fadeQueued=false;
    var scroll=body&&!top.hidden?body.scrollTop:0;
    var view=page.getAttribute('data-mp-view');
    if(!top.hidden&&frameDocument&&(view==='assets'||view==='ledger')&&
        frame.getAttribute('data-ready-stage')==='applied_'+view){
      var scroller=frameDocument.scrollingElement||frameDocument.documentElement;
      scroll=Math.max(scroll,scroller.scrollTop);
    }
    var progress=Math.min(1,Math.max(0,scroll/fadeDistance));
    var opacity=String(1-progress*progress*(3-2*progress));
    if(top.style.getPropertyValue('--mp-tabs-opacity')!==opacity)
      top.style.setProperty('--mp-tabs-opacity',opacity);
    set(top,'data-mp-fade-hidden',String(progress===1));
  }

  function queueFade(){
    if(fadeQueued)return;
    fadeQueued=true;
    if(typeof w.requestAnimationFrame==='function')w.requestAnimationFrame(updateFade);
    else updateFade();
  }

  function bindFrameDocument(){
    var next=frame&&frame.contentDocument;
    if(next&&(!next.location||next.location.pathname!=='/kakeibo'))next=null;
    if(next!==frameDocument){
      if(frameDocument)frameDocument.removeEventListener('scroll',queueFade);
      frameDocument=next;
      if(frameDocument)frameDocument.addEventListener('scroll',queueFade,{passive:true});
    }
    queueFade();
  }

  function sync(){
    buttons.forEach(function(button){
      set(button,'aria-pressed',String(button.classList.contains('on')));
    });
    var next=pane&&pane.querySelector('.kb-frame');
    if(frame!==next){
      if(frame)frame.removeEventListener('load',bindFrameDocument);
      frame=next;
      if(frame)frame.addEventListener('load',bindFrameDocument);
    }
    bindFrameDocument();
  }

  function mount(){
    var nextPage=doc.getElementById('myPageOv'),nextTop=nextPage&&nextPage.querySelector('.mp-toptabs');
    if(!nextTop){
      if(!discovery&&typeof w.MutationObserver==='function'){discovery=new w.MutationObserver(mount);discovery.observe(doc.body,{childList:true,subtree:true});}
      return false;
    }
    if(top===nextTop){sync();return true;}
    var controls=Array.from(nextTop.querySelectorAll('.mp-toptab'));
    if(controls.length!==2)return false;
    if(discovery){discovery.disconnect();discovery=null;}
    if(observer)observer.disconnect();
    if(body)body.removeEventListener('scroll',queueFade);
    page=nextPage;
    top=nextTop;
    buttons=controls;
    body=page.querySelector('.mo-body');
    pane=body&&body.querySelector('.kb-pane');
    if(body)body.addEventListener('scroll',queueFade,{passive:true});
    sync();
    set(top,'data-mp-tabs-ready','true');
    if(typeof w.MutationObserver==='function'){
      observer=new w.MutationObserver(sync);
      observer.observe(top,{subtree:true,attributes:true,attributeFilter:['class']});
      observer.observe(page,{attributes:true,attributeFilter:['data-mp-view']});
      if(pane)observer.observe(pane,{childList:true,subtree:true,attributes:true,attributeFilter:['data-ready-stage']});
    }
    return true;
  }

  return {mount:mount,sync:sync};
});

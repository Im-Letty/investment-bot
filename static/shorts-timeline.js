/* Six bounded local-video thumbnails. The caller owns the blob URL. */
(function(root,factory){
  'use strict';var api=factory(root);api.create=factory;
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.KNShortsTimeline=api;
})(typeof window==='undefined'?null:window,function(w){
  'use strict';
  function start(url,duration,onFrame){
    var done=false,video=null,canvas=null,context=null,waiting=null;
    var timers=new Set(),listeners=[],index=0;
    var handle={cancel:cleanup};
    function timer(fn,delay){
      var id=w.setTimeout(function(){timers.delete(id);if(!done)fn();},delay);
      timers.add(id);return id;
    }
    function clearTimer(id){if(id!==undefined){w.clearTimeout(id);timers.delete(id);}}
    function listen(name,fn){video.addEventListener(name,fn);listeners.push([name,fn]);}
    function unlisten(name,fn){
      video.removeEventListener(name,fn);
      listeners=listeners.filter(function(pair){return pair[0]!==name||pair[1]!==fn;});
    }
    function remove(el){if(!el)return;if(typeof el.remove==='function')el.remove();else if(el.parentNode)el.parentNode.removeChild(el);}
    function cleanup(){
      if(done)return;done=true;
      timers.forEach(function(id){w.clearTimeout(id);});timers.clear();waiting=null;
      if(video){
        listeners.forEach(function(pair){video.removeEventListener(pair[0],pair[1]);});listeners=[];
        try{video.pause();}catch(_){}
        try{video.removeAttribute('src');video.load();}catch(_){}
        remove(video);video=null;
      }
      if(canvas){canvas.width=0;canvas.height=0;remove(canvas);canvas=null;}
      context=null;
    }
    function wait(name,next){
      var token={},timeout;
      waiting=token;
      function receive(){
        if(done||waiting!==token)return;
        waiting=null;unlisten(name,receive);clearTimer(timeout);
        try{next();}catch(_){cleanup();}
      }
      listen(name,receive);timeout=timer(cleanup,1500);
      return token;
    }
    function capture(){
      if(done)return;
      try{
        var width=video.videoWidth,height=video.videoHeight,ratio=72/96;
        if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0){cleanup();return;}
        var sw=width,sh=height;
        if(width/height>ratio)sw=height*ratio;else sh=width/ratio;
        context.drawImage(video,(width-sw)/2,(height-sh)/2,sw,sh,0,0,72,96);
        var data=canvas.toDataURL('image/jpeg',0.6);
        if(typeof data!=='string'||data.length>32768||!/^data:image\/jpeg;base64,/.test(data)){cleanup();return;}
        onFrame(index,data);
        if(done)return;
        index+=1;
        if(index===6)cleanup();else seek();
      }catch(_){cleanup();}
    }
    function seek(){
      if(done)return;
      wait('seeked',function(){
        if(video.readyState>=2)capture();else wait('loadeddata',capture);
      });
      try{video.currentTime=(index+0.5)/6*duration;}catch(_){cleanup();}
    }
    function metadata(){
      if(done)return;
      if(!Number.isFinite(video.duration)||video.duration<=0||video.duration>180.05){cleanup();return;}
      seek();
    }
    if(typeof url!=='string'||!/^blob:[^\s]+$/.test(url)||!Number.isFinite(duration)||duration<=0||duration>180||typeof onFrame!=='function'||!w||!w.document||!w.document.body||typeof w.setTimeout!=='function'||typeof w.clearTimeout!=='function'){
      done=true;return handle;
    }
    try{
      video=w.document.createElement('video');canvas=w.document.createElement('canvas');
      video.className=canvas.className='ks-edit-scratch';video.hidden=canvas.hidden=true;
      video.setAttribute('aria-hidden','true');video.setAttribute('tabindex','-1');
      video.muted=true;video.playsInline=true;video.preload='auto';
      canvas.width=72;canvas.height=96;context=canvas.getContext('2d',{alpha:false});
      if(!context){cleanup();return handle;}
      w.document.body.appendChild(video);w.document.body.appendChild(canvas);
      listen('error',cleanup);timer(cleanup,10000);
      wait('loadedmetadata',metadata);
      video.src=url;video.load();
    }catch(_){cleanup();}
    return handle;
  }
  return {start:start};
});

/* Keep the current video and one muted, non-playing next video ready. */
(function(root,factory){
  'use strict';
  var api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.KNShortsPlayback=api;
})(typeof window==='undefined'?null:window,function(root){
  'use strict';
  var origin='https://www.youtube-nocookie.com';
  function create(feed,sheet,w){
    w=w||root;var doc=w&&w.document;
    if(!feed||!sheet||!doc)return null;
    var active=null,records=new Map();
    function live(slide){return !!(slide&&feed.isConnected!==false&&sheet.isConnected!==false&&slide.isConnected!==false&&feed.contains(slide));}
    function shown(){return !doc.hidden&&sheet.isConnected!==false&&sheet.classList.contains('open');}
    function valid(slide){return live(slide)&&/^[A-Za-z0-9_-]{11}$/.test(slide.getAttribute('data-vid')||'');}
    function next(slide){var all=Array.from(feed.querySelectorAll('.ks-slide')),index=all.indexOf(slide);return index>=0?all[index+1]||null:null;}
    function command(frame,name){
      if(!frame||frame.__ksRemoved)return;
      try{frame.contentWindow.postMessage(JSON.stringify({event:'command',func:name,args:''}),origin);}catch(_){/* The native player can still be operated directly. */}
    }
    function discard(slide,record){
      var frame=record&&record.frame;
      if(frame){command(frame,'pauseVideo');frame.__ksRemoved=true;if(frame.parentNode)frame.parentNode.removeChild(frame);}
      if(slide)slide.__m=false;records.delete(slide);
    }
    function trim(){
      var upcoming=active&&next(active);
      records.forEach(function(record,slide){if(!live(slide)||(slide!==active&&slide!==upcoming))discard(slide,record);});
    }
    function mount(slide,autoplay){
      if(!valid(slide)||!shown())return null;
      var frame=slide.querySelector('iframe'),record=records.get(slide);
      if(record&&record.frame===frame)return record;
      if(record)discard(slide,record);
      if(!frame){
        frame=doc.createElement('iframe');
        var host=w.location&&w.location.origin;
        frame.src=origin+'/embed/'+slide.getAttribute('data-vid')+'?playsinline=1&rel=0&modestbranding=1&autoplay='+(autoplay?1:0)+'&mute=1&enablejsapi=1'+(/^https?:\/\//.test(host||'')?'&origin='+encodeURIComponent(host):'');
        frame.setAttribute('allow','autoplay; encrypted-media; picture-in-picture');
        frame.setAttribute('allowfullscreen','');frame.setAttribute('loading','eager');
        var caption=slide.querySelector('.ks-cap');frame.title=caption?caption.textContent:'動画プレーヤー';
        slide.insertBefore(frame,slide.firstChild);
      }
      frame.__ksRemoved=false;slide.__m=true;
      record={frame:frame,ready:false};records.set(slide,record);
      frame.addEventListener('load',function(){
        if(frame.__ksRemoved||records.get(slide)!==record||!live(slide))return;
        record.ready=true;
        var placeholder=slide.querySelector('.ks-ph');if(placeholder)placeholder.style.display='none';
        command(frame,shown()&&active===slide?'playVideo':'pauseVideo');
      });
      return record;
    }
    function prepare(slide){
      if(!shown()||!live(active)||next(active)!==slide)return false;
      trim();var record=mount(slide,false);return !!record;
    }
    function pause(slide){
      var record=records.get(slide),frame=record?record.frame:slide&&slide.querySelector('iframe');
      command(frame,'pauseVideo');if(active===slide)active=null;
    }
    function activate(slide){
      if(!shown()||!valid(slide))return false;
      var same=active===slide,old=active;
      if(old&&old!==slide)pause(old);
      active=slide;trim();
      var record=mount(slide,true);
      if(!record)return false;
      if(!same)command(record.frame,'playVideo');
      prepare(next(slide));return true;
    }
    function close(){
      active=null;records.forEach(function(record,slide){discard(slide,record);});
      Array.from(feed.querySelectorAll('iframe')).forEach(function(frame){command(frame,'pauseVideo');frame.__ksRemoved=true;if(frame.parentNode)frame.parentNode.removeChild(frame);});
      Array.from(feed.querySelectorAll('.ks-slide')).forEach(function(slide){slide.__m=false;});
    }
    if(typeof w.MutationObserver==='function'){
      var visibility=new w.MutationObserver(function(){if(!shown())close();});
      visibility.observe(sheet,{attributes:true,attributeFilter:['class']});
    }
    return {activate:activate,prepare:prepare,pause:pause,close:close};
  }
  function get(feed,sheet,w){
    if(!feed)return null;
    if(!feed.__knShortsPlayback)feed.__knShortsPlayback=create(feed,sheet,w);
    return feed.__knShortsPlayback;
  }
  return {create:create,get:get};
});

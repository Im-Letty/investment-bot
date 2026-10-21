/* Local photos -> a silent MP4. No network or camera access.
 * render(files,{secondsPerPhoto?,onProgress?}) returns {promise,cancel}.
 * promise resolves to {file,duration,width,height,count}; the caller owns the File.
 */
(function(root,factory){
  'use strict';var api=factory(root);api.create=factory;
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.KNShortsPhotoMovie=api;
})(typeof window==='undefined'?null:window,function(w){
  'use strict';
  var limits={count:12,perFileBytes:10000000,totalInputBytes:40000000,outputBytes:20000000,pixels:24000000,side:12000,seconds:60,width:720,height:1280};
  var types=['video/mp4;codecs=avc1','video/mp4;codecs=avc1.42E01F','video/mp4;codecs=avc1.42001f'];
  function error(code){var err=new Error(code);err.code=code;return err;}
  function validateFiles(values){
    if(!values||!Number.isInteger(values.length)||values.length<1||values.length>limits.count)throw error('invalid_photo_count');
    var files=Array.from(values),bytes=0;
    files.forEach(function(file){
      if(!file||typeof file.name!=='string'||!Number.isFinite(file.size)||file.size<=0)throw error('invalid_image');
      if(!/\.(jpe?g|png|webp)$/i.test(file.name)||file.type&&!/^image\/(jpeg|png|webp)$/i.test(file.type))throw error('unsupported_image');
      if(file.size>limits.perFileBytes)throw error('photo_too_large');bytes+=file.size;
    });
    if(bytes>limits.totalInputBytes)throw error('photos_too_large');return files;
  }
  function recorderMime(host){
    if(!host||typeof host.MediaRecorder!=='function'||typeof host.MediaRecorder.isTypeSupported!=='function')return '';
    for(var i=0;i<types.length;i++){try{if(host.MediaRecorder.isTypeSupported(types[i]))return types[i];}catch(_){}}
    return '';
  }
  function stopTracks(stream){if(stream&&typeof stream.getTracks==='function')stream.getTracks().forEach(function(track){try{track.stop();}catch(_){}});}
  function active(job){if(job.cancelled)throw error('cancelled');}
  function clock(){return w.performance&&typeof w.performance.now==='function'?w.performance.now():Date.now();}
  function emit(job,phase,index,percent){if(typeof job.options.onProgress==='function'){try{job.options.onProgress({phase:phase,index:index,count:job.files.length,percent:percent});}catch(_){}}}
  function addTimer(job,fn,delay){var id=w.setTimeout(function(){job.timers.delete(id);fn();},delay);job.timers.add(id);return id;}
  function clearTimer(job,id){if(id!==undefined){w.clearTimeout(id);job.timers.delete(id);}}
  function dimensions(image){
    var width=Number(image.naturalWidth||image.width),height=Number(image.naturalHeight||image.height);
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>limits.side||height>limits.side||width*height>limits.pixels)throw error('invalid_image_dimensions');
    return {width:width,height:height};
  }
  function releaseImage(image){if(image&&typeof image.close==='function'){try{image.close();}catch(_){}}}
  function bitmap(job,file){
    return new Promise(function(resolve,reject){
      var done=false,timer;
      function finish(err,image){if(done){releaseImage(image);return;}done=true;clearTimer(job,timer);job.aborters.delete(cancel);if(err){releaseImage(image);reject(err);}else resolve(image);}
      function cancel(){finish(error('cancelled'));}job.aborters.add(cancel);
      timer=addTimer(job,function(){finish(error('image_decode_timeout'));},10000);
      try{Promise.resolve(w.createImageBitmap(file,{imageOrientation:'from-image'})).then(function(image){if(job.cancelled)finish(error('cancelled'),image);else finish(null,image);},function(){finish(error('invalid_image'));});}
      catch(_){finish(error('invalid_image'));}
    });
  }
  function imageElement(job,file){
    return new Promise(function(resolve,reject){
      if(typeof w.Image!=='function'||!w.URL||typeof w.URL.createObjectURL!=='function'){reject(error('unsupported_images'));return;}
      var image=new w.Image(),url,timer,done=false;
      function finish(err){
        if(done)return;done=true;clearTimer(job,timer);job.aborters.delete(cancel);image.onload=null;image.onerror=null;
        if(url){try{w.URL.revokeObjectURL(url);}catch(_){}job.urls.delete(url);}
        if(err){try{image.src='';}catch(_){}reject(err);}else resolve(image);
      }
      function cancel(){finish(error('cancelled'));}job.aborters.add(cancel);
      image.onload=function(){finish(job.cancelled?error('cancelled'):null);};image.onerror=function(){finish(error('invalid_image'));};
      timer=addTimer(job,function(){finish(error('image_decode_timeout'));},10000);
      try{url=w.URL.createObjectURL(file);job.urls.add(url);image.src=url;}catch(_){finish(error('invalid_image'));}
    });
  }
  async function decode(job,file){
    active(job);var source=typeof w.createImageBitmap==='function'?await bitmap(job,file):await imageElement(job,file);
    try{
      active(job);var size=dimensions(source),scale=Math.min(1,limits.width/size.width,limits.height/size.height);
      var canvas=w.document.createElement('canvas');canvas.width=Math.max(1,Math.round(size.width*scale));canvas.height=Math.max(1,Math.round(size.height*scale));job.images.push(canvas);
      var ctx=canvas.getContext('2d',{alpha:true});if(!ctx)throw error('unsupported_export');ctx.drawImage(source,0,0,canvas.width,canvas.height);return canvas;
    }catch(err){throw err&&err.code?err:error('invalid_image');}
    finally{releaseImage(source);if(source&&source.tagName==='IMG'){try{source.src='';}catch(_){}}}
  }
  function cleanup(job){
    if(job.cleaned)return;job.cleaned=true;
    job.aborters.clear();job.timers.forEach(function(id){w.clearTimeout(id);});job.timers.clear();
    if(job.raf!==null){w.cancelAnimationFrame(job.raf);job.raf=null;}
    if(job.recorder){job.recorder.onstop=null;job.recorder.onerror=null;job.recorder.ondataavailable=null;if(job.recorder.state!=='inactive'){try{job.recorder.stop();}catch(_){}}}
    stopTracks(job.stream);job.stream=null;
    job.urls.forEach(function(url){try{w.URL.revokeObjectURL(url);}catch(_){}});job.urls.clear();
    job.images.forEach(function(image){image.width=0;image.height=0;if(typeof image.remove==='function')image.remove();});job.images=[];
    if(job.canvas){job.canvas.width=0;job.canvas.height=0;if(typeof job.canvas.remove==='function')job.canvas.remove();job.canvas=null;}
    job.chunks=[];
  }
  function draw(job,index){
    var image=job.images[index],scale=Math.min(limits.width/image.width,limits.height/image.height),width=image.width*scale,height=image.height*scale;
    job.context.fillStyle='#16121e';job.context.fillRect(0,0,limits.width,limits.height);
    job.context.drawImage(image,(limits.width-width)/2,(limits.height-height)/2,width,height);
  }
  function encode(job,mime){
    return new Promise(function(resolve,reject){
      var done=false,rec=job.recorder,started=clock(),lastFrame=started,lastIndex=-1,photoStarted=started;
      var photoMs=job.seconds*1000,tolerance=Math.min(250,photoMs*.1),maxFrameGap=Math.min(2000,photoMs);
      function validExposure(current){var elapsed=current-photoStarted;return elapsed>=photoMs-tolerance&&elapsed<=photoMs+tolerance;}
      function finish(err){
        if(done)return;done=true;job.aborters.delete(cancel);
        if(err){reject(err);return;}
        try{resolve(new w.Blob(job.chunks,{type:rec.mimeType||mime}));}catch(_){reject(error('export_failed'));}
      }
      function cancel(){finish(error('cancelled'));}job.aborters.add(cancel);
      rec.ondataavailable=function(event){if(done||!event.data||!event.data.size)return;job.bytes+=event.data.size;if(job.bytes>limits.outputBytes){finish(error('file_too_large'));return;}job.chunks.push(event.data);};
      rec.onerror=function(){finish(error('export_failed'));};
      rec.onstop=function(){if(job.cancelled)finish(error('cancelled'));else if(!job.completed||!job.bytes)finish(error('export_failed'));else finish();};
      function frame(){
        job.raf=null;if(done)return;if(job.cancelled){cancel();return;}
        var current=clock(),elapsed=Math.max(0,(current-started)/1000);
        if(current-lastFrame>maxFrameGap){finish(error('export_timeout'));return;}lastFrame=current;
        try{
          if(elapsed>=job.duration){if(lastIndex!==job.images.length-1||!validExposure(current)){finish(error('export_timeout'));return;}job.completed=true;rec.stop();return;}
          var index=Math.min(job.images.length-1,Math.floor(elapsed/job.seconds));if(index>lastIndex+1){finish(error('export_timeout'));return;}
          if(index!==lastIndex){if(!validExposure(current)){finish(error('export_timeout'));return;}photoStarted=current;}
          draw(job,index);lastIndex=index;emit(job,'encoding',index,Math.min(99,Math.floor(elapsed/job.duration*100)));job.raf=w.requestAnimationFrame(frame);
        }catch(_){finish(error('export_failed'));}
      }
      addTimer(job,function(){finish(error('export_timeout'));},(job.duration+15)*1000);
      try{draw(job,0);lastIndex=0;rec.start(500);emit(job,'encoding',0,0);job.raf=w.requestAnimationFrame(frame);}catch(_){finish(error('export_failed'));}
    });
  }
  function render(values,options){
    options=options||{};var job={options:options,files:[],images:[],urls:new Set(),timers:new Set(),aborters:new Set(),chunks:[],bytes:0,raf:null,cancelled:false,settled:false,cleaned:false};
    var promise=Promise.resolve().then(async function(){
      active(job);job.files=validateFiles(values);job.seconds=options.secondsPerPhoto===undefined?3:Number(options.secondsPerPhoto);
      if(!Number.isFinite(job.seconds)||job.seconds<1||job.seconds>5)throw error('invalid_photo_duration');job.duration=job.files.length*job.seconds;
      if(job.duration>limits.seconds)throw error('invalid_photo_duration');
      if(!w||!w.document||typeof w.Blob!=='function'||typeof w.File!=='function'||typeof w.setTimeout!=='function'||typeof w.requestAnimationFrame!=='function'||typeof w.cancelAnimationFrame!=='function')throw error('unsupported_export');
      var mime=recorderMime(w);if(!mime)throw error('unsupported_export');
      job.canvas=w.document.createElement('canvas');job.canvas.width=limits.width;job.canvas.height=limits.height;
      if(typeof job.canvas.captureStream!=='function')throw error('unsupported_export');
      job.context=job.canvas.getContext('2d',{alpha:false});if(!job.context)throw error('unsupported_export');
      for(var i=0;i<job.files.length;i++){emit(job,'decoding',i,Math.floor(i/job.files.length*100));await decode(job,job.files[i]);}
      active(job);job.stream=job.canvas.captureStream(24);
      if(!job.stream||typeof job.stream.getVideoTracks!=='function'||!job.stream.getVideoTracks().length)throw error('unsupported_export');
      try{job.recorder=new w.MediaRecorder(job.stream,{mimeType:mime,videoBitsPerSecond:720000});}catch(_){throw error('unsupported_export');}
      var blob=await encode(job,mime);active(job);
      if(!blob.size||blob.size>limits.outputBytes||!/^video\/mp4(;|$)/i.test(blob.type))throw error('export_failed');
      var file=new w.File([blob],'photos-'+new Date().toISOString().replace(/[-:]/g,'').slice(0,15)+'.mp4',{type:blob.type,lastModified:Date.now()});
      emit(job,'complete',job.files.length-1,100);return {file:file,duration:job.duration,width:limits.width,height:limits.height,count:job.files.length};
    }).catch(function(err){throw err&&err.code?err:error('export_failed');}).finally(function(){job.settled=true;cleanup(job);});
    return {promise:promise,cancel:function(){if(job.settled||job.cancelled)return;job.cancelled=true;Array.from(job.aborters).forEach(function(cancel){cancel();});}};
  }
  return {render:render,validateFiles:validateFiles,recorderMime:recorderMime,limits:Object.freeze(limits)};
});

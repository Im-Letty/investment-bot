/* Local Shorts capture/editing. Publishing and session checks belong to the caller.
 * KNShortsEditor.open({initialFile?, onConfirm(File, metadata), onCancel?, onStatus?})
 * returns {close, stop}. No network requests or device access occur on open.
 */
(function(root,factory){
  'use strict';var api=factory(root);api.create=factory;
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.KNShortsEditor=api;
})(typeof window==='undefined'?null:window,function(w){
  'use strict';
  var MAX_BYTES=20000000,MAX_SECONDS=180,current=null;
  var AUDIO_MIME_TYPES=['video/mp4;codecs=avc1,opus','video/mp4;codecs=avc1,mp4a.40.2','video/mp4;codecs=avc1.42E01F,mp4a.40.2','video/mp4;codecs=avc1.42001f,mp4a.40.2'];
  var VIDEO_MIME_TYPES=['video/mp4;codecs=avc1','video/mp4;codecs=avc1.42E01F','video/mp4;codecs=avc1.42001f'];
  function validFile(file){
    if(!file||!Number.isFinite(file.size)||file.size<=0)throw new Error('invalid_file');
    if(file.size>MAX_BYTES)throw new Error('file_too_large');
    if(!/\.(mp4|mov)$/i.test(file.name||'')||!/^video\/(mp4|quicktime)(;|$)/i.test(file.type||'')&&file.type!=='')throw new Error('unsupported_file');
    return file;
  }
  function trimRange(start,end,duration){
    start=Number(start);end=Number(end);duration=Number(duration);
    if(!Number.isFinite(duration)||duration<=0||duration>MAX_SECONDS+0.05)throw new Error('invalid_file');
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>duration+0.01||end-start<0.1||end-start>MAX_SECONDS+0.01)throw new Error('invalid_trim');
    return {start:start,end:Math.min(end,duration),duration:Math.min(end,duration)-start};
  }
  function recorderMime(host,hasAudio){
    if(!host||typeof host.MediaRecorder!=='function'||typeof host.MediaRecorder.isTypeSupported!=='function')return '';
    var types=hasAudio===false?VIDEO_MIME_TYPES:AUDIO_MIME_TYPES;
    for(var i=0;i<types.length;i++){try{if(host.MediaRecorder.isTypeSupported(types[i]))return types[i];}catch(_){}}
    return '';
  }
  function message(reason){return ({
    unsupported_file:'MP4・MOV形式のH.264動画を選んでください。',invalid_file:'この動画を読み取れませんでした。別のMP4・MOV動画を選んでください。',
    file_too_large:'動画は20MB以内で選んでください。',file_too_long:'動画は3分以内で選んでください。',invalid_trim:'開始と終了を確認してください。0.1秒以上・3分以内で切り取れます。',
    unsupported_recording:'このブラウザではMP4の録画に対応していません。スマホなどで保存したMP4・MOV動画を選んでください。',
    unsupported_export:'このブラウザでは編集した動画をMP4に保存できません。編集を戻して元の動画を使うか、対応するブラウザでお試しください。',
    unsupported_audio:'このブラウザでは元の音声を付けて編集できません。「音声を消す」を選ぶか、編集を戻して元の動画を使ってください。',
    insecure_camera:'撮影にはHTTPSで開いたページが必要です。保存済みの動画は選べます。',camera_unavailable:'カメラを利用できません。保存済みの動画を選ぶこともできます。',
    permission_denied:'カメラ・マイクが許可されませんでした。ブラウザの設定で許可するか、保存済みの動画を選んでください。',
    record_failed:'録画を保存できませんでした。選択済みの動画はそのまま使えます。',export_failed:'編集した動画を保存できませんでした。設定を確認してもう一度お試しください。',
    export_timeout:'編集の保存が停止したため中断しました。もう一度お試しください。',cancelled:'編集の保存を中断しました。元の動画と編集内容は残っています。',invalid_image:'写真を読み込めませんでした。JPEG・PNG・WebPの写真を選び直してください。',unsupported_image:'JPEG・PNG・WebPの写真を選んでください。',invalid_photo_count:'写真は1〜12枚で選んでください。',photo_too_large:'写真は1枚10MB以内で選んでください。',invalid_image_dimensions:'写真が大きすぎるため読み込めませんでした。2400万画素以内に縮小して選んでください。',image_decode_timeout:'写真を読み込めませんでした。写真を選び直してお試しください。',unsupported_images:'このブラウザでは写真を読み込めません。作成済みの動画を選ぶこともできます。',invalid_photo_duration:'写真1枚の表示時間は1〜5秒で選んでください。',photos_too_large:'写真は1枚10MB、合計40MB以内で選んでください。'
  })[reason]||'動画の処理を完了できませんでした。もう一度お試しください。';}
  function node(tag,className,text){var el=w.document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
  function button(className,text,action){var el=node('button',className,text);el.type='button';el.addEventListener('click',action);return el;}
  function label(parent,text,el){var wrap=node('label','ks-edit-field'),title=node('span','',text);wrap.appendChild(title);wrap.appendChild(el);parent.appendChild(wrap);return el;}
  function stopTracks(stream){if(stream&&typeof stream.getTracks==='function')stream.getTracks().forEach(function(track){try{track.stop();}catch(_){}});}
  function clearVideo(video){if(!video)return;try{video.pause();}catch(_){}video.srcObject=null;video.removeAttribute('src');try{video.load();}catch(_){}}
  function active(s){return !s.closed&&current===s;}
  function say(s,text){if(!active(s))return;s.status.textContent=text;if(typeof s.options.onStatus==='function'){try{s.options.onStatus(text);}catch(_){}}}
  function stageRatio(s,width,height){if(width>0&&height>0){s.stage.style.aspectRatio=String(width)+' / '+String(height);s.stage.style.setProperty('--ks-edit-ratio',String(width/height));}}
  function setButtons(s){
    if(!active(s))return;var busy=!!s.job||!!s.photoJob,locked=busy||!!s.recording||s.cameraPending||s.loadingFile;
    s.dialog.setAttribute('data-view',s.view||'capture');
    s.fileInput.disabled=locked;s.photoInput.disabled=locked;s.albumButton.disabled=locked;
    s.cameraButton.disabled=locked;s.changeAlbumButton.disabled=locked;s.microphone.disabled=busy||!!s.recording||s.cameraPending||!!s.stream;
    s.switchButton.disabled=locked||!s.stream;
    s.recordButton.disabled=busy||s.cameraPending||s.loadingFile;
    var recordLabel=s.recording?'録画を停止':s.stream?'録画を開始':'カメラを開く';
    s.recordButton.textContent=recordLabel;s.recordButton.setAttribute('aria-label',recordLabel);s.recordButton.setAttribute('aria-pressed',String(!!s.recording));s.recordButton.setAttribute('data-recording',String(!!s.recording));
    s.cameraStop.hidden=!s.stream&&!s.cameraPending;
    s.next.disabled=busy||!s.source||s.loadingFile||!!s.recording||s.cameraPending;
    s.next.textContent=busy?'動画を作成しています…':'次へ';s.cancelExport.hidden=!busy;s.returnClip.hidden=!s.source||s.view!=='capture';s.returnClip.disabled=locked;
    [s.trimStart,s.trimEnd,s.text,s.position,s.color,s.muted,s.reset].forEach(function(el){el.disabled=busy||!s.source||!!s.recording;});
    s.settings.hidden=!s.source||s.view!=='edit';s.previewButton.disabled=busy||!s.source||!!s.recording;
    s.empty.hidden=!!s.source||s.cameraVisible||s.cameraPending;s.captureHint.textContent=s.recording?'タップして録画を停止':s.stream?'タップして撮影':'タップしてカメラを開く';
    s.durationButtons.forEach(function(el){el.disabled=locked;el.setAttribute('aria-pressed',String(Number(el.getAttribute('data-seconds'))===s.recordLimit));});
    s.photosPanel.hidden=s.view!=='photos';s.photosBuild.disabled=locked||!s.photos.length;s.photoDuration.disabled=locked;
    Array.from(s.photosList.querySelectorAll('button')).forEach(function(el){el.disabled=locked||el.getAttribute('data-unavailable')==='true';});
    if(s.view!=='capture')showAlbum(s,false);
  }
  function showAlbum(s,open){s.albumPanel.hidden=!open;s.albumButton.setAttribute('aria-expanded',String(open));if(open){var first=s.albumPanel.querySelector('button');if(first)first.focus();}}
  function clearPhotos(s){s.photoUrls.forEach(revoke);s.photoUrls=[];s.photos=[];if(s.photosList)s.photosList.textContent='';}
  function cancelPhotos(s){var job=s.photoJob;if(job){s.photoJob=null;job.cancel();}setButtons(s);}
  function renderPhotos(s){
    s.photosList.textContent='';s.photos.forEach(function(file,index){
      var item=node('div','ks-edit-photo-item'),image=node('img','ks-edit-photo-thumb');image.src=s.photoUrls[index];image.alt='写真 '+(index+1);item.appendChild(image);
      var info=node('span','ks-edit-photo-name',(index+1)+'. '+file.name);item.appendChild(info);
      [['前へ',-1],['後へ',1],['削除',0]].forEach(function(pair){
        var control=button('ks-edit-photo-action',pair[0],function(){
          if(s.photoJob||s.job)return;
          if(pair[1]===0){revoke(s.photoUrls[index]);s.photos.splice(index,1);s.photoUrls.splice(index,1);}
          else{var next=index+pair[1];if(next<0||next>=s.photos.length)return;var f=s.photos[index],u=s.photoUrls[index];s.photos[index]=s.photos[next];s.photoUrls[index]=s.photoUrls[next];s.photos[next]=f;s.photoUrls[next]=u;}
          renderPhotos(s);setButtons(s);
        });control.setAttribute('aria-label','写真'+(index+1)+'を'+pair[0]);control.setAttribute('data-unavailable',String(pair[1]!==0&&(index+pair[1]<0||index+pair[1]>=s.photos.length)));item.appendChild(control);
      });s.photosList.appendChild(item);
    });s.photosSummary.textContent=s.photos.length+'枚・'+(s.photos.length*Number(s.photoDuration.value||3))+'秒の動画';
  }
  function selectPhotos(s,values){
    if(!active(s)||s.job||s.photoJob||s.recording)return;
    var files=Array.from(values||[]),engine=w.KNShortsPhotoMovie;
    if(!engine||typeof engine.render!=='function'){say(s,'写真の動画作成を読み込めませんでした。ページを開き直してください。');return;}
    try{engine.validateFiles(files);}catch(e){say(s,message(e.message));return;}
    cancelLoading(s);stopCamera(s,true);clearPhotos(s);s.photos=files;s.photoUrls=files.map(function(file){return w.URL.createObjectURL(file);});s.view='photos';showAlbum(s,false);renderPhotos(s);setButtons(s);say(s,'写真の順番と表示時間を選んで、動画を作成できます。');
  }
  async function buildPhotos(s){
    if(!active(s)||s.job||s.photoJob||!s.photos.length)return;
    var job;try{job=w.KNShortsPhotoMovie.render(s.photos,{secondsPerPhoto:Number(s.photoDuration.value),onProgress:function(progress){if(active(s)&&s.photoJob===job)say(s,'写真から動画を作成しています… '+Math.round(Number(progress.percent)||0)+'%');}});s.photoJob=job;setButtons(s);say(s,'写真から動画を作成しています…');var result=await job.promise;if(!active(s)||s.photoJob!==job)return;s.photoJob=null;await loadFile(s,result.file);}
    catch(e){if(active(s)&&s.photoJob===job){s.photoJob=null;setButtons(s);say(s,message(e&&e.message||'export_failed'));}}
  }
  function renderOverlay(s){
    var text=s.text.value.trim();s.overlay.textContent=text;s.overlay.hidden=!text||s.cameraVisible;
    s.overlay.style.color=s.color.value;s.overlay.setAttribute('data-position',s.position.value);
  }
  function resetEdits(s){
    if(!s.source)return;s.trimStart.value='0';s.trimEnd.value=String(s.source.duration);s.text.value='';s.position.value='bottom';s.color.value='#ffffff';s.muted.checked=false;
    s.preview.muted=false;renderOverlay(s);say(s,'編集を元に戻しました。');
  }
  function editSettings(s){var range=trimRange(s.trimStart.value,s.trimEnd.value,s.source.duration);return {start:range.start,end:range.end,duration:range.duration,text:s.text.value.trim(),position:s.position.value,color:s.color.value,muted:s.muted.checked};}
  function hasEdits(s,settings){return settings.start>0.005||Math.abs(settings.end-s.source.duration)>0.005||!!settings.text||settings.muted;}
  function revoke(url){if(url&&w.URL&&typeof w.URL.revokeObjectURL==='function')w.URL.revokeObjectURL(url);}
  function waitMedia(s,job,video,event,predicate){
    return new Promise(function(resolve,reject){
      var finished=false,timer;function done(err){if(finished)return;finished=true;w.clearTimeout(timer);video.removeEventListener(event,ready);video.removeEventListener('error',failed);var ix=job.cancellers.indexOf(cancel);if(ix>=0)job.cancellers.splice(ix,1);err?reject(err):resolve();}
      function ready(){if(!predicate||predicate())done();}function failed(){done(new Error('invalid_file'));}function cancel(){done(new Error('cancelled'));}
      job.cancellers.push(cancel);video.addEventListener(event,ready);video.addEventListener('error',failed);timer=w.setTimeout(function(){done(new Error('export_timeout'));},10000);ready();
    });
  }
  function resumeAudio(job){
    return new Promise(function(resolve,reject){
      var finished=false,timer;function done(err){if(finished)return;finished=true;w.clearTimeout(timer);var ix=job.cancellers.indexOf(cancel);if(ix>=0)job.cancellers.splice(ix,1);err?reject(err):resolve();}
      function cancel(){done(new Error('cancelled'));}job.cancellers.push(cancel);timer=w.setTimeout(function(){done(new Error('unsupported_audio'));},10000);
      try{Promise.resolve(job.audio.resume()).then(function(){done();},function(){done(new Error('unsupported_audio'));});}catch(_){done(new Error('unsupported_audio'));}
    });
  }
  function cancelLoading(s){if(s.cancelLoad){var cancel=s.cancelLoad;s.cancelLoad=null;cancel();}}
  function loadFile(s,file){
    if(!active(s))return Promise.resolve(false);
    try{validFile(file);}catch(e){say(s,message(e.message));return Promise.resolve(false);}
    cancelLoading(s);s.loadingFile=true;setButtons(s);say(s,'動画を読み込んでいます…');
    var video=node('video','ks-edit-candidate'),url=w.URL.createObjectURL(file),cancelled=false,timer;
    video.preload='metadata';video.playsInline=true;video.setAttribute('playsinline','');video.src=url;video.hidden=true;s.dialog.appendChild(video);
    return new Promise(function(resolve){
      function cleanup(){w.clearTimeout(timer);video.removeEventListener('loadedmetadata',loaded);video.removeEventListener('error',failed);if(s.cancelLoad===cancel)s.cancelLoad=null;}
      function discard(reason){if(cancelled)return;cancelled=true;cleanup();clearVideo(video);video.remove();revoke(url);if(active(s)){s.loadingFile=false;setButtons(s);if(reason)say(s,message(reason));}resolve(false);}
      function cancel(){discard();}
      function failed(){discard('invalid_file');}
      function loaded(){
        if(cancelled)return;if(!active(s)){discard();return;}
        var duration=Number(video.duration),width=Number(video.videoWidth),height=Number(video.videoHeight);
        if(!Number.isFinite(duration)||duration<=0||!width||!height){discard('invalid_file');return;}
        if(duration>MAX_SECONDS+0.05){discard('file_too_long');return;}
        if(width>3840||height>3840){discard('unsupported_file');return;}
        cleanup();cancelled=true;stopCamera(s,true);clearVideo(s.preview);s.preview.remove();if(s.source)revoke(s.source.url);
        s.source={file:file,url:url,duration:duration,width:width,height:height};s.preview=video;video.hidden=false;video.className='ks-edit-preview';video.controls=true;video.muted=false;
        s.stage.insertBefore(video,s.overlay);stageRatio(s,width,height);s.cameraVisible=false;s.cameraPreview.hidden=true;
        video.addEventListener('timeupdate',function(){if(active(s)&&!s.job&&s.source){var end=Number(s.trimEnd.value);if(Number.isFinite(end)&&video.currentTime>=end){video.pause();}}});
        s.loadingFile=false;s.view='edit';resetEdits(s);setButtons(s);say(s,'切り取り・文字・音声を編集して、次へ進めます。');resolve(true);
      }
      s.cancelLoad=cancel;video.addEventListener('loadedmetadata',loaded);video.addEventListener('error',failed);timer=w.setTimeout(function(){discard('invalid_file');},10000);
      try{video.load();}catch(_){failed();}
    });
  }
  function stopCamera(s,discard){
    s.cameraRevision++;s.cameraPending=false;
    if(s.recording){s.recording.discard=s.recording.discard||discard;stopRecording(s);}
    stopTracks(s.stream);s.stream=null;clearVideo(s.cameraPreview);s.cameraPreview.hidden=true;s.cameraVisible=false;
    if(s.preview)s.preview.hidden=false;if(!discard&&s.source)s.view='edit';if(s.source)stageRatio(s,s.source.width,s.source.height);renderOverlay(s);setButtons(s);
  }
  async function startCamera(s,switching){
    if(!active(s)||s.job||s.recording)return;
    if(w.isSecureContext!==true){say(s,message('insecure_camera'));return;}
    if(!recorderMime(w,s.microphone.checked)){say(s,message('unsupported_recording'));return;}
    if(!w.navigator||!w.navigator.mediaDevices||typeof w.navigator.mediaDevices.getUserMedia!=='function'){say(s,message('camera_unavailable'));return;}
    s.view='capture';stopCamera(s,true);if(switching)s.facing=s.facing==='user'?'environment':'user';
    var revision=++s.cameraRevision;s.cameraPending=true;setButtons(s);say(s,'カメラ'+(s.microphone.checked?'・マイク':'')+'の許可を確認しています…');
    try{
      var stream=await w.navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:s.facing},width:{ideal:720,max:1280},height:{ideal:1280,max:1280},frameRate:{ideal:30,max:30}},audio:s.microphone.checked});
      if(!active(s)||revision!==s.cameraRevision||w.document.hidden){stopTracks(stream);return;}
      s.stream=stream;s.cameraPending=false;s.cameraVisible=true;s.preview.pause();s.preview.hidden=true;s.cameraPreview.hidden=false;s.cameraPreview.srcObject=stream;s.cameraPreview.muted=true;s.cameraPreview.setAttribute('data-facing',s.facing);stageRatio(s,720,1280);renderOverlay(s);setButtons(s);
      var play=s.cameraPreview.play();if(play&&typeof play.catch==='function')play.catch(function(){if(active(s)&&s.stream===stream)say(s,'カメラのプレビューをタップして再生してください。');});
      stream.getTracks().forEach(function(track){if(track.addEventListener)track.addEventListener('ended',function(){if(active(s)&&s.stream===stream){stopCamera(s,false);say(s,'カメラが停止しました。');}});});
      say(s,'録画ボタンで撮影を開始します。');
    }catch(e){if(active(s)&&revision===s.cameraRevision){s.cameraPending=false;if(s.source)s.view='edit';setButtons(s);say(s,message(e&&(/NotAllowed|PermissionDenied|Security/.test(e.name))?'permission_denied':'camera_unavailable'));}}
  }
  function makeFile(blob){if(typeof w.File!=='function')throw new Error('unsupported_export');return new w.File([blob],'short-'+new Date().toISOString().replace(/[-:]/g,'').slice(0,15)+'.mp4',{type:blob.type||'video/mp4',lastModified:Date.now()});}
  function recorder(s,stream,mime){return new w.MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:720000,audioBitsPerSecond:64000});}
  function stopRecording(s){var capture=s.recording;if(!capture)return;w.clearTimeout(capture.timer);w.clearInterval(capture.clock);if(capture.recorder.state!=='inactive'){try{capture.recorder.stop();}catch(_){capture.failed=true;capture.finish();}}stopTracks(s.stream);s.stream=null;clearVideo(s.cameraPreview);setButtons(s);}
  function startRecording(s){
    if(!active(s)||s.job)return;if(s.recording){stopRecording(s);return;}if(!s.stream)return;
    var audio=s.stream.getAudioTracks&&s.stream.getAudioTracks().length>0,mime=recorderMime(w,audio),rec;try{if(!mime)throw new Error('unsupported_recording');rec=recorder(s,s.stream,mime);}catch(_){say(s,message('unsupported_recording'));stopCamera(s,true);return;}
    var capture={recorder:rec,chunks:[],bytes:0,discard:false,failed:false,limit:s.recordLimit,started:Date.now()},finished=false;s.recording=capture;
    capture.finish=function(){
      if(finished)return;finished=true;w.clearTimeout(capture.timer);w.clearInterval(capture.clock);if(s.recording===capture)s.recording=null;
      stopTracks(s.stream);s.stream=null;clearVideo(s.cameraPreview);s.cameraPreview.hidden=true;s.cameraVisible=false;s.preview.hidden=false;if(s.source)s.view='edit';renderOverlay(s);setButtons(s);
      if(!active(s)||capture.discard)return;
      if(capture.failed||!capture.bytes){say(s,message(capture.reason||'record_failed'));return;}
      if(capture.bytes>MAX_BYTES){say(s,message('file_too_large'));return;}
      try{var blob=new w.Blob(capture.chunks,{type:rec.mimeType||mime});if(!/^video\/mp4(;|$)/i.test(blob.type))throw new Error('unsupported_recording');loadFile(s,makeFile(blob));}catch(e){say(s,message(e.message||'record_failed'));}
    };
    rec.ondataavailable=function(e){if(finished||!e.data||!e.data.size)return;capture.bytes+=e.data.size;if(capture.bytes<=MAX_BYTES)capture.chunks.push(e.data);else{capture.failed=true;capture.reason='file_too_large';stopRecording(s);say(s,message('file_too_large'));}};
    rec.onerror=function(){capture.failed=true;stopRecording(s);};rec.onstop=capture.finish;
    try{rec.start(500);capture.timer=w.setTimeout(function(){if(s.recording===capture){stopRecording(s);say(s,capture.limit+'秒の設定に合わせて録画を停止しました。');}},(capture.limit-.5)*1000);capture.clock=w.setInterval(function(){if(active(s)&&s.recording===capture)say(s,'録画中 '+Math.min(capture.limit,Math.floor((Date.now()-capture.started)/1000))+'秒 / '+capture.limit+'秒');},1000);setButtons(s);say(s,'録画中 0秒 / '+capture.limit+'秒');}
    catch(_){capture.failed=true;capture.finish();}
  }
  function cancelJob(s){
    var job=s.job;if(!job)return;job.cancelled=true;job.cancellers.slice().forEach(function(cancel){cancel();});
    if(job.recorder&&job.recorder.state!=='inactive'){try{job.recorder.stop();}catch(_){}}
    cleanupJob(job);if(s.job===job)s.job=null;setButtons(s);
  }
  function cleanupJob(job){
    w.clearTimeout(job.wallTimer);w.clearInterval(job.watchdog);if(job.raf)w.cancelAnimationFrame(job.raf);job.raf=0;
    stopTracks(job.stream);job.stream=null;if(job.audioSource){try{job.audioSource.disconnect();}catch(_){}job.audioSource=null;}
    if(job.audioDestination){stopTracks(job.audioDestination.stream);try{job.audioDestination.disconnect();}catch(_){}job.audioDestination=null;}
    if(job.audio){try{var closing=job.audio.close();if(closing&&closing.catch)closing.catch(function(){});}catch(_){}job.audio=null;}
    clearVideo(job.video);if(job.video)job.video.remove();if(job.canvas)job.canvas.remove();
  }
  function drawFrame(job,settings){
    var canvas=job.canvas,ctx=job.context;ctx.drawImage(job.video,0,0,canvas.width,canvas.height);
    if(!settings.text)return;
    var font=Math.max(20,Math.round(canvas.width*0.052)),maxWidth=canvas.width*.88,lines=[],part='';ctx.font='600 '+font+'px sans-serif';
    Array.from(settings.text).slice(0,100).forEach(function(char){if(char==='\n'||part&&ctx.measureText(part+char).width>maxWidth){lines.push(part);part=char==='\n'?'':char;}else part+=char;});if(part)lines.push(part);lines=lines.slice(0,4);
    var lineHeight=font*1.35,total=lines.length*lineHeight,y=settings.position==='top'?canvas.height*.1:settings.position==='middle'?(canvas.height-total)/2:canvas.height*.86-total;
    ctx.textAlign='center';ctx.textBaseline='top';ctx.lineJoin='round';ctx.lineWidth=Math.max(3,font*.12);ctx.strokeStyle=settings.color==='#000000'?'rgba(255,255,255,.9)':'rgba(0,0,0,.75)';ctx.fillStyle=settings.color;
    lines.forEach(function(line,i){ctx.strokeText(line,canvas.width/2,y+i*lineHeight,maxWidth);ctx.fillText(line,canvas.width/2,y+i*lineHeight,maxWidth);});
  }
  async function exportClip(s,settings){
    var mime=recorderMime(w,!settings.muted),canvas=node('canvas','ks-edit-scratch');if(!mime||typeof canvas.captureStream!=='function'||typeof w.requestAnimationFrame!=='function'){throw new Error('unsupported_export');}
    var video=node('video','ks-edit-scratch'),job={canvas:canvas,video:video,cancellers:[],cancelled:false,chunks:[],bytes:0};
    var ratio=s.source.width/s.source.height;canvas.width=ratio>=1?Math.min(1280,s.source.width):Math.min(720,s.source.width);canvas.height=Math.round(canvas.width/ratio);
    if(canvas.height>1280){canvas.height=1280;canvas.width=Math.round(1280*ratio);}canvas.width=Math.max(2,Math.floor(canvas.width/2)*2);canvas.height=Math.max(2,Math.floor(canvas.height/2)*2);
    try{job.context=canvas.getContext('2d',{alpha:false});}catch(_){throw new Error('unsupported_export');}if(!job.context)throw new Error('unsupported_export');
    s.job=job;setButtons(s);
    video.playsInline=true;video.setAttribute('playsinline','');video.preload='auto';video.src=s.source.url;video.muted=settings.muted;s.dialog.appendChild(video);s.dialog.appendChild(canvas);
    try{
      if(!settings.muted){
        var AudioContext=w.AudioContext||w.webkitAudioContext;if(typeof AudioContext!=='function')throw new Error('unsupported_audio');
        job.audio=new AudioContext();if(typeof job.audio.createMediaElementSource!=='function'||typeof job.audio.createMediaStreamDestination!=='function')throw new Error('unsupported_audio');
        job.audioSource=job.audio.createMediaElementSource(video);job.audioDestination=job.audio.createMediaStreamDestination();job.audioSource.connect(job.audioDestination);
        await resumeAudio(job);if(job.audio.state!=='running')throw new Error('unsupported_audio');
      }
      await waitMedia(s,job,video,'loadeddata',function(){return video.readyState>=2;});
      if(!active(s)||job.cancelled)throw new Error('cancelled');
      if(settings.start>0){var seek=waitMedia(s,job,video,'seeked',function(){return !video.seeking&&Math.abs(video.currentTime-settings.start)<0.03;});video.currentTime=settings.start;await seek;}
      else video.currentTime=0;
      if(!active(s)||job.cancelled)throw new Error('cancelled');
      drawFrame(job,settings);job.stream=canvas.captureStream(30);
      if(!settings.muted){var audioTracks=job.audioDestination.stream.getAudioTracks();if(!audioTracks.length)throw new Error('unsupported_audio');audioTracks.forEach(function(track){job.stream.addTrack(track);});}
      job.recorder=recorder(s,job.stream,mime);
      var blob=await new Promise(function(resolve,reject){
        var rec=job.recorder,done=false,lastTime=settings.start,lastProgress=Date.now();
        function finish(err){if(done)return;done=true;var ix=job.cancellers.indexOf(cancel);if(ix>=0)job.cancellers.splice(ix,1);err?reject(err):resolve(new w.Blob(job.chunks,{type:rec.mimeType||mime}));}
        function cancel(){finish(new Error('cancelled'));}job.cancellers.push(cancel);
        rec.ondataavailable=function(e){if(done||!e.data||!e.data.size)return;job.bytes+=e.data.size;if(job.bytes>MAX_BYTES){finish(new Error('file_too_large'));try{rec.stop();}catch(_){}return;}job.chunks.push(e.data);};
        rec.onerror=function(){finish(new Error('export_failed'));};
        rec.onstop=function(){if(job.cancelled||!active(s))finish(new Error('cancelled'));else if(!job.completed||!job.bytes)finish(new Error('export_failed'));else finish();};
        function frame(){
          if(done||job.cancelled||!active(s))return;
          try{drawFrame(job,settings);}catch(_){finish(new Error('export_failed'));return;}
          var now=video.currentTime;if(now>lastTime+.01){lastTime=now;lastProgress=Date.now();}
          say(s,'編集した動画を保存しています… '+Math.min(100,Math.floor((now-settings.start)/settings.duration*100))+'%');
          if(now>=settings.end-.015||video.ended){job.completed=now>=settings.end-.1;video.pause();try{rec.stop();}catch(_){finish(new Error('export_failed'));}return;}
          if(Date.now()-lastProgress>10000){finish(new Error('export_timeout'));try{rec.stop();}catch(_){}return;}
          job.raf=w.requestAnimationFrame(frame);
        }
        job.wallTimer=w.setTimeout(function(){finish(new Error('export_timeout'));try{rec.stop();}catch(_){}},(Math.min(MAX_SECONDS,settings.duration)+15)*1000);
        try{rec.start(500);var playing=video.play();if(playing&&playing.catch)playing.catch(function(){finish(new Error('export_failed'));});job.raf=w.requestAnimationFrame(frame);}catch(_){finish(new Error('export_failed'));}
      });
      if(!active(s)||job.cancelled)throw new Error('cancelled');
      if(!blob.size||blob.size>MAX_BYTES||!/^video\/mp4(;|$)/i.test(blob.type))throw new Error('export_failed');
      return makeFile(blob);
    }finally{if(job.recorder&&job.recorder.state!=='inactive'){try{job.recorder.stop();}catch(_){}}cleanupJob(job);if(s.job===job)s.job=null;setButtons(s);}
  }
  async function confirm(s){
    if(!active(s)||s.job||s.photoJob||!s.source||s.loadingFile||s.recording||s.cameraPending)return;
    var settings;try{settings=editSettings(s);}catch(e){say(s,message(e.message));return;}
    var edited=hasEdits(s,settings),file=s.source.file;
    try{stopCamera(s,true);s.preview.pause();if(edited)file=await exportClip(s,settings);if(!active(s))return;
      validFile(file);s.confirmed=true;var callback=s.options.onConfirm;closeSession(s,false);callback(file,{edited:edited,duration:settings.duration,mimeType:file.type});
    }catch(e){if(active(s))say(s,message(e&&e.message||'export_failed'));}
  }
  function closeSession(s,cancel){
    if(!s||s.closed)return;s.closed=true;s.cameraRevision++;cancelLoading(s);stopCamera(s,true);cancelJob(s);cancelPhotos(s);clearPhotos(s);clearVideo(s.preview);if(s.source)revoke(s.source.url);s.source=null;
    w.document.removeEventListener('visibilitychange',s.visibility);w.removeEventListener('pagehide',s.pagehide);w.removeEventListener('popstate',s.pagehide);s.modal.remove();if(current===s)current=null;
    if(s.previousFocus&&s.previousFocus.isConnected&&typeof s.previousFocus.focus==='function'&&!w.document.hidden)s.previousFocus.focus();
    if(cancel!==false&&!s.confirmed&&typeof s.options.onCancel==='function')s.options.onCancel();
  }
  function stopSession(s){if(!active(s))return;stopCamera(s,false);cancelJob(s);cancelPhotos(s);s.preview.pause();say(s,'撮影と保存を停止しました。選択した動画は残っています。');}
  function open(options){
    if(!w||!w.document)throw new Error('browser_required');options=options||{};if(typeof options.onConfirm!=='function')throw new Error('onConfirm_required');
    if(current)closeSession(current,true);
    var s={options:options,closed:false,confirmed:false,facing:'user',cameraRevision:0,source:null,view:'capture',recordLimit:60,photos:[],photoUrls:[],previousFocus:w.document.activeElement};current=s;
    s.modal=node('div','ks-edit-modal');s.modal.id='knShortsEditor';s.dialog=node('section','ks-edit-dialog');s.dialog.setAttribute('role','dialog');s.dialog.setAttribute('aria-modal','true');s.dialog.setAttribute('aria-labelledby','ksEditTitle');s.modal.appendChild(s.dialog);
    var head=node('div','ks-edit-head'),title=node('h2','','動画をつくる');title.id='ksEditTitle';s.closeButton=button('ks-edit-close','閉じる',function(){closeSession(s,true);});s.closeButton.setAttribute('aria-label','作成を閉じる');head.appendChild(s.closeButton);head.appendChild(title);s.dialog.appendChild(head);
    s.status=node('p','ks-edit-status');s.status.setAttribute('role','status');s.status.setAttribute('aria-live','polite');s.dialog.appendChild(s.status);
    s.stage=node('div','ks-edit-stage');s.preview=node('video','ks-edit-preview');s.preview.controls=true;s.preview.playsInline=true;s.preview.setAttribute('playsinline','');s.preview.preload='metadata';s.stage.appendChild(s.preview);
    s.cameraPreview=node('video','ks-edit-camera-preview');s.cameraPreview.muted=true;s.cameraPreview.playsInline=true;s.cameraPreview.setAttribute('playsinline','');s.cameraPreview.hidden=true;s.cameraPreview.addEventListener('click',function(){if(s.stream){var playing=s.cameraPreview.play();if(playing&&playing.catch)playing.catch(function(){});}});s.cameraPreview.addEventListener('loadedmetadata',function(){if(active(s)&&s.cameraVisible)stageRatio(s,s.cameraPreview.videoWidth,s.cameraPreview.videoHeight);});s.stage.appendChild(s.cameraPreview);
    s.empty=node('div','ks-edit-empty');s.empty.appendChild(node('span','ks-edit-empty-icon','◎'));s.empty.appendChild(node('strong','','撮影してつくる'));s.empty.appendChild(node('span','','カメラを開くか、アルバムから選ぶ'));s.stage.appendChild(s.empty);
    s.overlay=node('div','ks-edit-text-preview');s.overlay.setAttribute('aria-hidden','true');s.overlay.hidden=true;s.stage.appendChild(s.overlay);s.dialog.appendChild(s.stage);
    var sources=node('div','ks-edit-sources');s.dialog.appendChild(sources);s.fileInput=node('input','ks-edit-file');s.fileInput.type='file';s.fileInput.hidden=true;s.fileInput.tabIndex=-1;s.fileInput.accept='.mp4,.mov,video/mp4,video/quicktime';s.fileInput.setAttribute('aria-label','アルバムの動画を選ぶ');sources.appendChild(s.fileInput);
    s.photoInput=node('input','ks-edit-photo-file');s.photoInput.type='file';s.photoInput.hidden=true;s.photoInput.tabIndex=-1;s.photoInput.accept='.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';s.photoInput.multiple=true;s.photoInput.setAttribute('aria-label','アルバムの写真を選ぶ');sources.appendChild(s.photoInput);
    var cameraOptions=node('div','ks-edit-camera-options');s.microphone=node('input','ks-edit-microphone');s.microphone.type='checkbox';s.microphone.checked=true;label(cameraOptions,'マイク',s.microphone);sources.appendChild(cameraOptions);
    s.cameraButton=button('ks-edit-camera','撮り直す',function(){startCamera(s,false);});sources.appendChild(s.cameraButton);s.changeAlbumButton=button('ks-edit-change-album','アルバムから変更',function(){if(s.job||s.photoJob||s.recording)return;stopCamera(s,true);s.view='capture';setButtons(s);showAlbum(s,true);});sources.appendChild(s.changeAlbumButton);
    var cameraControls=node('div','ks-edit-camera-controls');s.recordButton=button('ks-edit-record','カメラを開く',function(){if(s.stream||s.recording)startRecording(s);else startCamera(s,false);});s.switchButton=button('ks-edit-switch','切替',function(){startCamera(s,true);});s.switchButton.setAttribute('aria-label','前・後カメラを切替');s.cameraStop=button('ks-edit-camera-stop','停止',function(){stopCamera(s,false);if(s.source)s.view='edit';setButtons(s);say(s,'カメラを停止しました。');});s.cameraStop.setAttribute('aria-label','カメラを止める');cameraControls.appendChild(s.recordButton);cameraControls.appendChild(s.switchButton);cameraControls.appendChild(s.cameraStop);s.dialog.appendChild(cameraControls);
    var captureFooter=node('div','ks-edit-capture-footer'),durations=node('div','ks-edit-durations');durations.setAttribute('role','group');durations.setAttribute('aria-label','録画時間');s.durationButtons=[];[[15,'15秒'],[60,'60秒'],[180,'3分']].forEach(function(pair){var control=button('ks-edit-duration',pair[1],function(){if(s.recording||s.cameraPending||s.job||s.photoJob)return;s.recordLimit=pair[0];setButtons(s);});control.setAttribute('data-seconds',String(pair[0]));durations.appendChild(control);s.durationButtons.push(control);});captureFooter.appendChild(durations);
    s.captureHint=node('p','ks-edit-capture-hint');captureFooter.appendChild(s.captureHint);s.albumButton=button('ks-edit-album','アルバム',function(){showAlbum(s,s.albumPanel.hidden);});s.albumButton.setAttribute('aria-label','アルバムから選ぶ');s.albumButton.setAttribute('aria-controls','ksEditAlbumChoices');s.albumButton.setAttribute('aria-expanded','false');captureFooter.appendChild(s.albumButton);s.returnClip=button('ks-edit-return-clip','選択した動画に戻る',function(){if(s.job||s.photoJob||s.recording||s.cameraPending||!s.source)return;stopCamera(s,true);s.view='edit';setButtons(s);say(s,'選択した動画を表示しています。');});captureFooter.appendChild(s.returnClip);captureFooter.appendChild(node('span','ks-edit-mode-label','カメラ'));s.dialog.appendChild(captureFooter);
    s.albumPanel=node('div','ks-edit-album-panel');s.albumPanel.hidden=true;s.albumPanel.id='ksEditAlbumChoices';s.albumPanel.setAttribute('aria-label','アルバムの種類');s.albumPanel.appendChild(button('ks-edit-choose-video','動画を選ぶ',function(){showAlbum(s,false);s.fileInput.click();}));s.albumPanel.appendChild(button('ks-edit-choose-photos','写真から動画をつくる',function(){showAlbum(s,false);s.photoInput.click();}));s.albumPanel.appendChild(button('ks-edit-album-close','閉じる',function(){showAlbum(s,false);s.albumButton.focus();}));s.dialog.appendChild(s.albumPanel);
    s.photosPanel=node('div','ks-edit-photos-panel');s.photosPanel.appendChild(node('h3','','写真を動画にする'));s.photosPanel.appendChild(node('p','','写真を12枚まで選んで、順番と表示時間を変えられます。'));
    s.photosList=node('div','ks-edit-photos-list');s.photosPanel.appendChild(s.photosList);s.photoDuration=node('select','ks-edit-photo-duration');[1,2,3,4,5].forEach(function(seconds){var option=node('option','',seconds+'秒');option.value=String(seconds);s.photoDuration.appendChild(option);});s.photoDuration.value='3';label(s.photosPanel,'1枚の表示時間',s.photoDuration);s.photosSummary=node('p','ks-edit-photos-summary');s.photosPanel.appendChild(s.photosSummary);s.photosBuild=button('ks-edit-photos-build','動画を作成',function(){buildPhotos(s);});s.photosPanel.appendChild(s.photosBuild);s.photosPanel.appendChild(button('ks-edit-photos-camera','カメラに戻る',function(){if(s.photoJob||s.job)return;s.view='capture';setButtons(s);}));s.photosPanel.appendChild(button('ks-edit-photos-back','選び直す',function(){if(!s.photoJob)s.photoInput.click();}));s.dialog.appendChild(s.photosPanel);
    s.settings=node('div','ks-edit-settings');s.dialog.appendChild(s.settings);var trim=node('div','ks-edit-trim');s.settings.appendChild(trim);
    s.trimStart=node('input','ks-edit-trim-start');s.trimEnd=node('input','ks-edit-trim-end');[s.trimStart,s.trimEnd].forEach(function(el){el.type='number';el.min='0';el.max='180';el.step='0.1';el.inputMode='decimal';});label(trim,'開始（秒）',s.trimStart);label(trim,'終了（秒）',s.trimEnd);
    s.previewButton=button('ks-edit-preview-play','切り取りを再生',function(){try{var range=editSettings(s);s.preview.currentTime=range.start;s.preview.muted=s.muted.checked;var playing=s.preview.play();if(playing&&playing.catch)playing.catch(function(){say(s,'動画の再生を開始できませんでした。');});}catch(e){say(s,message(e.message));}});s.settings.appendChild(s.previewButton);
    s.text=node('textarea','ks-edit-text');s.text.rows=2;s.text.maxLength=100;s.text.placeholder='動画に表示する文字（任意）';label(s.settings,'文字を入れる（100文字まで）',s.text);
    var appearance=node('div','ks-edit-appearance');s.settings.appendChild(appearance);s.position=node('select','ks-edit-position');[['top','上'],['middle','中央'],['bottom','下']].forEach(function(pair){var opt=node('option','',pair[1]);opt.value=pair[0];s.position.appendChild(opt);});s.position.value='bottom';label(appearance,'文字の位置',s.position);
    s.color=node('select','ks-edit-color');[['#ffffff','白'],['#ffe45c','黄色'],['#000000','黒']].forEach(function(pair){var opt=node('option','',pair[1]);opt.value=pair[0];s.color.appendChild(opt);});s.color.value='#ffffff';label(appearance,'文字の色',s.color);
    s.muted=node('input','ks-edit-muted');s.muted.type='checkbox';label(s.settings,'音声を消す',s.muted);s.reset=button('ks-edit-reset','編集を元に戻す',function(){resetEdits(s);});s.settings.appendChild(s.reset);
    var footer=node('div','ks-edit-footer');s.next=button('ks-edit-next','次へ',function(){confirm(s);});s.cancelExport=button('ks-edit-export-cancel','作成を中断',function(){cancelJob(s);cancelPhotos(s);say(s,message('cancelled'));});footer.appendChild(s.next);footer.appendChild(s.cancelExport);s.dialog.appendChild(footer);s.dialog.appendChild(node('p','ks-edit-limits','動画は3分・20MBまで'));
    s.fileInput.addEventListener('change',function(){var file=s.fileInput.files&&s.fileInput.files[0];if(file)loadFile(s,file);s.fileInput.value='';});s.photoInput.addEventListener('change',function(){if(s.photoInput.files&&s.photoInput.files.length)selectPhotos(s,s.photoInput.files);s.photoInput.value='';});s.photoDuration.addEventListener('change',function(){renderPhotos(s);});
    [s.text,s.position,s.color].forEach(function(el){el.addEventListener(el===s.text?'input':'change',function(){renderOverlay(s);});});s.muted.addEventListener('change',function(){s.preview.muted=s.muted.checked;});
    s.modal.addEventListener('click',function(e){if(e.target===s.modal)closeSession(s,true);});s.modal.addEventListener('keydown',function(e){
      if(e.key==='Escape'){e.preventDefault();closeSession(s,true);return;}
      if(e.key==='Tab'){var controls=Array.from(s.dialog.querySelectorAll('button,input,textarea,select,[tabindex]')).filter(function(el){return !el.disabled&&!el.hidden&&el.getClientRects().length;});if(!controls.length){e.preventDefault();return;}var first=controls[0],last=controls[controls.length-1];if(e.shiftKey&&w.document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&w.document.activeElement===last){e.preventDefault();first.focus();}}
    });
    s.visibility=function(){if(w.document.hidden){stopCamera(s,false);cancelJob(s);cancelPhotos(s);s.preview.pause();say(s,'画面が非表示になったため撮影と保存を停止しました。');}};s.pagehide=function(){closeSession(s,true);};w.document.addEventListener('visibilitychange',s.visibility);w.addEventListener('pagehide',s.pagehide);w.addEventListener('popstate',s.pagehide);
    w.document.body.appendChild(s.modal);setButtons(s);s.closeButton.focus();if(options.initialFile)loadFile(s,options.initialFile);
    return {close:function(){closeSession(s,true);},stop:function(){stopSession(s);}};
  }
  return {open:open,close:function(){if(current)closeSession(current,true);},stop:function(){if(current)stopSession(current);},validFile:validFile,trimRange:trimRange,recorderMime:recorderMime,limits:{bytes:MAX_BYTES,seconds:MAX_SECONDS}};
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {trimRange,validFile,recorderMime}=require('../static/shorts-editor.js');
const {harness,settle,deferred}=require('./helpers/shorts-editor-harness.js');

test('opening the editor does not request a camera or microphone',()=>{
  const h=harness(),handle=h.open();
  assert.equal(h.deviceCalls.length,0);assert.equal(h.recorders.length,0);
  assert.ok(h.node('.ks-edit-file'));assert.ok(h.node('.ks-edit-camera'));
  handle.close();assert.equal(h.document.body.children.length,0);assert.equal(h.deviceCalls.length,0);
});

test('a permission denial leaves the selected valid file available for confirmation',async()=>{
  const h=harness({getUserMedia:async()=>{throw Object.assign(new Error('Denied'),{name:'NotAllowedError'});}});h.open();
  const selected=h.select();h.metadata();h.node('.ks-edit-camera').click();await settle();
  assert.equal(h.deviceCalls.length,1);assert.ok(h.node('.ks-edit-status').textContent);assert.equal(h.node('.ks-edit-dialog').getAttribute('data-view'),'edit','A denied retake restores visible editing and Next controls');
  h.node('.ks-edit-next').click();await settle();
  assert.equal(h.confirmed.length,1);assert.equal(h.confirmed[0].file,selected);assert.equal(h.confirmed[0].details.edited,false);
});

test('a late camera permission result after close stops every granted track',async()=>{
  const permission=deferred(),h=harness({getUserMedia:()=>permission.promise}),handle=h.open();
  h.node('.ks-edit-camera').click();assert.equal(h.deviceCalls.length,1);handle.close();
  const stream=new h.Stream();permission.resolve(stream);await settle();
  assert.ok(stream.getTracks().every(track=>track.readyState==='ended'));
  assert.equal(h.document.body.children.length,0);assert.equal(h.recorders.length,0);assert.equal(h.confirmed.length,0);
});

test('recording stop keeps a local recording while close releases camera and preview resources',async()=>{
  const h=harness(),handle=h.open();h.node('.ks-edit-camera').click();await settle();
  const camera=h.streams[0];h.node('.ks-edit-record').click();assert.equal(h.recorders.length,1);assert.equal(h.recorders[0].state,'recording');
  h.node('.ks-edit-record').click();await settle();assert.equal(h.recorders[0].state,'inactive');assert.equal(h.recorders[0].stops,1);
  assert.ok(h.urls.size>0,'Stopped recording is available as a local preview');
  const previews=[...h.document.querySelectorAll('video')];handle.close();await settle();
  assert.ok(camera.getTracks().every(track=>track.readyState==='ended'));
  assert.equal(h.urls.size,0);assert.equal(h.timers.size,0);assert.equal(h.frames.size,0);
  assert.ok(previews.every(video=>video.paused&&video.srcObject===null));assert.equal(h.confirmed.length,0);
});

test('hiding the document stops an active recording and releases its devices',async()=>{
  const h=harness(),handle=h.open();h.node('.ks-edit-camera').click();await settle();
  const camera=h.streams[0];h.node('.ks-edit-record').click();h.hidden();await settle();
  assert.equal(h.recorders[0].state,'inactive');assert.equal(h.recorders[0].stops,1);
  assert.ok(camera.getTracks().every(track=>track.readyState==='ended'));assert.equal(h.confirmed.length,0);
  handle.close();assert.equal(h.urls.size,0);assert.equal(h.timers.size,0);assert.equal(h.frames.size,0);
});

test('invalid trim inputs cannot confirm a file or start an export recorder',async()=>{
  const h=harness();h.open();h.select();h.metadata(12);
  h.node('.ks-edit-trim-start').value='10';h.node('.ks-edit-trim-start').emit('change');
  h.node('.ks-edit-trim-end').value='5';h.node('.ks-edit-trim-end').emit('change');
  h.node('.ks-edit-next').click();await settle();
  assert.equal(h.confirmed.length,0);assert.equal(h.recorders.length,0);assert.ok(h.node('.ks-edit-status').textContent);
});

test('a browser without edited export support does not confirm the unedited original',async()=>{
  const h=harness({recorder:false});h.open();h.select();h.metadata();
  h.node('.ks-edit-text').value='Local title';h.node('.ks-edit-text').emit('input');h.node('.ks-edit-next').click();await settle();
  assert.equal(h.confirmed.length,0);assert.equal(h.recorders.length,0);assert.ok(h.node('.ks-edit-status').textContent);
});

test('closing during edited export cancels completion and releases generated media',async()=>{
  const h=harness({autoExportMetadata:true}),handle=h.open();h.select();h.metadata();
  h.node('.ks-edit-text').value='Local title';h.node('.ks-edit-text').emit('input');h.node('.ks-edit-muted').checked=true;h.node('.ks-edit-muted').emit('change');h.node('.ks-edit-next').click();await settle();
  assert.equal(h.recorders.length,1,'The edit must have started exporting before cancellation');
  const exportRecorder=h.recorders[0];assert.equal(exportRecorder.state,'recording');handle.close();await settle();
  assert.equal(exportRecorder.state,'inactive');assert.ok(exportRecorder.stream.getTracks().every(track=>track.readyState==='ended'));
  assert.equal(h.confirmed.length,0);assert.equal(h.document.body.children.length,0);assert.equal(h.urls.size,0);assert.equal(h.timers.size,0);assert.equal(h.frames.size,0);
});

test('successful edited export confirms the new MP4 with its trimmed duration and cleans up',async()=>{
  const h=harness({autoExportMetadata:true});h.open();const original=h.select();h.metadata();
  h.node('.ks-edit-trim-end').value='5';h.node('.ks-edit-trim-end').emit('change');
  h.node('.ks-edit-text').value='Local title';h.node('.ks-edit-text').emit('input');h.node('.ks-edit-muted').checked=true;h.node('.ks-edit-muted').emit('change');h.node('.ks-edit-next').click();await settle();
  assert.equal(h.recorders.length,1);assert.equal(h.recorders[0].state,'recording');
  h.node('video.ks-edit-scratch').currentTime=5;const frames=[...h.frames.values()];h.frames.clear();frames.forEach(fn=>fn());await settle();
  assert.equal(h.confirmed.length,1);assert.notEqual(h.confirmed[0].file,original);assert.ok(h.confirmed[0].file.size>0);assert.match(h.confirmed[0].file.name,/\.mp4$/);assert.match(h.confirmed[0].file.type,/^video\/mp4/);
  assert.equal(h.confirmed[0].details.edited,true);assert.equal(h.confirmed[0].details.duration,5);
  assert.ok(h.recorders[0].stream.getTracks().every(track=>track.readyState==='ended'));assert.equal(h.cancelled.length,0);
  assert.equal(h.document.body.children.length,0);assert.equal(h.urls.size,0);assert.equal(h.timers.size,0);assert.equal(h.frames.size,0);
});

test('an unavailable canvas context restores controls so the original file can still be used',async()=>{
  const h=harness({canvasContext:false});h.open();const original=h.select();h.metadata();
  h.node('.ks-edit-text').value='Local title';h.node('.ks-edit-text').emit('input');h.node('.ks-edit-next').click();await settle();
  assert.equal(h.confirmed.length,0);assert.equal(h.node('.ks-edit-next').disabled,false);assert.equal(h.node('.ks-edit-reset').disabled,false);assert.equal(h.recorders.length,0);
  h.node('.ks-edit-reset').click();h.node('.ks-edit-next').click();await settle();
  assert.equal(h.confirmed.length,1);assert.equal(h.confirmed[0].file,original);assert.equal(h.confirmed[0].details.edited,false);
});

test('stop cancels an edited export while retaining the source and a usable editor',async()=>{
  const h=harness({autoExportMetadata:true}),handle=h.open(),original=h.select();h.metadata();
  h.node('.ks-edit-muted').checked=true;h.node('.ks-edit-muted').emit('change');h.node('.ks-edit-next').click();await settle();
  assert.equal(h.recorders.length,1);handle.stop();await settle();
  assert.equal(h.confirmed.length,0);assert.equal(h.cancelled.length,0);assert.equal(h.recorders[0].state,'inactive');assert.ok(h.recorders[0].stream.getTracks().every(track=>track.readyState==='ended'));
  assert.equal(h.urls.size,1);assert.equal(h.timers.size,0);assert.equal(h.frames.size,0);assert.equal(h.node('.ks-edit-next').disabled,false);
  h.node('.ks-edit-reset').click();h.node('.ks-edit-next').click();await settle();assert.equal(h.confirmed.length,1);assert.equal(h.confirmed[0].file,original);assert.equal(h.urls.size,0);
});

test('unsupported original-audio export leaves the source and mute option available',async()=>{
  const h=harness({autoExportMetadata:true}),handle=h.open();h.select();h.metadata();
  h.node('.ks-edit-text').value='Local title';h.node('.ks-edit-text').emit('input');h.node('.ks-edit-next').click();await settle();
  assert.equal(h.confirmed.length,0);assert.equal(h.recorders.length,0);assert.equal(h.node('.ks-edit-next').disabled,false);assert.equal(h.node('.ks-edit-muted').disabled,false);
  assert.equal(h.urls.size,1);assert.equal(h.document.querySelectorAll('.ks-edit-scratch').length,0);handle.close();assert.equal(h.urls.size,0);
});

test('close cancels pending audio activation and stops its destination tracks',async()=>{
  const h=harness({autoExportMetadata:true}),resume=deferred(),audioTrack=new h.Track('audio');let closed=0,disconnected=0;
  h.window.AudioContext=class{constructor(){this.state='suspended';}createMediaElementSource(){return{connect(){},disconnect(){disconnected++;}};}createMediaStreamDestination(){return{stream:new h.Stream([audioTrack]),disconnect(){disconnected++;}};}resume(){return resume.promise;}close(){closed++;this.state='closed';return Promise.resolve();}};
  const handle=h.open();h.select();h.metadata();h.node('.ks-edit-text').value='Local title';h.node('.ks-edit-text').emit('input');h.node('.ks-edit-next').click();await settle();
  assert.equal(h.recorders.length,0);handle.close();await settle();
  assert.equal(closed,1);assert.equal(disconnected,2);assert.equal(audioTrack.readyState,'ended');assert.equal(h.timers.size,0);assert.equal(h.urls.size,0);assert.equal(h.confirmed.length,0);
  resume.resolve();await settle();assert.equal(h.confirmed.length,0);assert.equal(h.recorders.length,0);
});

test('trim validation rejects nonfinite, reversed, out of source and overlong ranges',()=>{
  assert.deepEqual(trimRange(1,5,12),{start:1,end:5,duration:4});
  for(const args of [[NaN,5,12],[0,Infinity,12],[-1,5,12],[10,5,12],[5,5,12],[0,13,12],[0,181,180]])assert.throws(()=>trimRange(...args),/invalid_trim/);
  for(const duration of [0,NaN,Infinity,181])assert.throws(()=>trimRange(0,5,duration),/invalid_file/);
});

test('file validation and recorder negotiation reject unsupported local input',()=>{
  const h=harness(),video=h.file();assert.equal(validFile(video),video);
  assert.throws(()=>validFile(h.file('image.png','image/png')),/unsupported_file/);
  assert.throws(()=>validFile(new File([],'empty.mp4',{type:'video/mp4'})),/invalid_file/);
  assert.equal(recorderMime({}), '');assert.equal(recorderMime({MediaRecorder:{isTypeSupported:()=>false}}),'');
});

test('recorder negotiation preserves audio codecs and selects AVC-only for muted clips',()=>{
  const host=types=>({MediaRecorder:class{static isTypeSupported(type){return types.includes(type);}}});
  const opus='video/mp4;codecs=avc1,opus',aac='video/mp4;codecs=avc1,mp4a.40.2',video='video/mp4;codecs=avc1';
  assert.equal(recorderMime(host([opus,aac,video]),true),opus);
  assert.equal(recorderMime(host([aac,video]),true),aac);
  assert.equal(recorderMime(host([opus,aac,video]),false),video);
  assert.equal(recorderMime(host([video]),true),'','An audio-bearing clip cannot negotiate a video-only codec');
  assert.equal(recorderMime(host(['video/mp4']),true),'','An unspecified MP4 codec cannot silently replace the original voice');
});

test('an encoder error restores the original clip and settings without confirmation',async()=>{
  const h=harness({autoExportMetadata:true}),audioTrack=new h.Track('audio');let audioClosed=0;
  h.window.AudioContext=class{constructor(){this.state='running';}createMediaElementSource(){return{connect(){},disconnect(){}};}createMediaStreamDestination(){return{stream:new h.Stream([audioTrack]),disconnect(){}};}resume(){return Promise.resolve();}close(){audioClosed++;this.state='closed';return Promise.resolve();}};
  const handle=h.open(),original=h.select();h.metadata();h.node('.ks-edit-text').value='元の音声を残す';h.node('.ks-edit-text').emit('input');h.node('.ks-edit-next').click();await settle();
  assert.equal(h.recorders.length,1);assert.equal(h.recorders[0].mimeType,'video/mp4;codecs=avc1,opus');h.recorders[0].emit('error',{error:new Error('EncodingError')});await settle();
  assert.equal(h.confirmed.length,0);assert.equal(h.node('.ks-edit-text').value,'元の音声を残す');assert.equal(h.node('.ks-edit-next').disabled,false);assert.equal(h.urls.size,1);
  assert.equal(h.recorders[0].state,'inactive');assert.ok(h.recorders[0].stream.getTracks().every(track=>track.readyState==='ended'));assert.equal(audioTrack.readyState,'ended');assert.equal(audioClosed,1);
  h.node('.ks-edit-reset').click();h.node('.ks-edit-next').click();await settle();assert.equal(h.confirmed.length,1);assert.equal(h.confirmed[0].file,original);handle.close();
});

test('capture opens with album choices and starts camera only from the central button',async()=>{
 const h=harness();h.open();assert.equal(h.node('.ks-edit-dialog').getAttribute('data-view'),'capture');
 assert.equal(h.node('.ks-edit-record').getAttribute('aria-label'),'カメラを開く');assert.equal(h.deviceCalls.length,0);
 h.node('.ks-edit-album').click();assert.equal(h.node('.ks-edit-album-panel').hidden,false);assert.ok(h.node('.ks-edit-choose-video'));assert.ok(h.node('.ks-edit-choose-photos'));assert.equal(h.deviceCalls.length,0);
 h.node('.ks-edit-album-close').click();assert.equal(h.node('.ks-edit-album-panel').hidden,true);assert.equal(h.node('.ks-edit-album').getAttribute('aria-expanded'),'false');assert.equal(h.node('.ks-edit-file').tabIndex,-1);assert.equal(h.node('.ks-edit-photo-file').hidden,true);
 h.node('.ks-edit-record').click();await settle();assert.equal(h.deviceCalls.length,1);assert.equal(h.recorders.length,0);assert.equal(h.node('.ks-edit-record').getAttribute('aria-label'),'録画を開始');h.editor.close();
});

test('selected capture duration stops recording at that limit and remains locked during recording',async()=>{
 const h=harness();h.open();h.node('.ks-edit-duration[data-seconds="15"]').click();h.node('.ks-edit-record').click();await settle();h.node('.ks-edit-record').click();
 assert.equal(h.recorders[0].state,'recording');assert.equal(h.node('.ks-edit-duration[data-seconds="60"]').disabled,true);
 const stop=[...h.timers.values()].find(t=>t.delay===14500);assert.ok(stop,'15 second recording has a matching bounded stop timer');stop.fn();await settle();assert.equal(h.recorders[0].state,'inactive');h.editor.close();assert.equal(h.timers.size,0);
});

test('album video moves from capture into editing without device access',async()=>{
 const h=harness();h.open();const file=h.select();h.metadata();assert.equal(h.node('.ks-edit-dialog').getAttribute('data-view'),'edit');assert.equal(h.deviceCalls.length,0);
 h.node('.ks-edit-next').click();await settle();assert.equal(h.confirmed[0].file,file);assert.equal(h.confirmed[0].details.edited,false);
});

function photosEngine(h,pending){let current,options,cancelled=0;h.window.KNShortsPhotoMovie={validateFiles(files){if(files.length<1||files.length>12)throw new Error('invalid_photo_count');},render(files,config){current=files.slice();options=config;return{promise:pending.promise,cancel(){cancelled++;pending.reject(new Error('cancelled'));}};}};return{files:()=>current,options:()=>options,cancelled:()=>cancelled};}
function selectPhotos(h){const files=[new File(['first'],'first.png',{type:'image/png'}),new File(['second'],'second.png',{type:'image/png'})];h.node('.ks-edit-photo-file').files=files;h.node('.ks-edit-photo-file').emit('change');return files;}

test('photo order and selected timing reach the movie engine and its MP4 joins the existing editor',async()=>{
 const h=harness(),pending=deferred(),engine=photosEngine(h,pending);h.open();const photos=selectPhotos(h);assert.equal(h.node('.ks-edit-dialog').getAttribute('data-view'),'photos');
 h.node('.ks-edit-photo-action[aria-label="写真2を前へ"]').click();h.node('.ks-edit-photo-duration').value='2';h.node('.ks-edit-photo-duration').emit('change');h.node('.ks-edit-photos-build').click();assert.deepEqual(engine.files(),[photos[1],photos[0]]);assert.equal(engine.options().secondsPerPhoto,2);engine.options().onProgress({percent:50});assert.match(h.node('.ks-edit-status').textContent,/50%/);
 const movie=h.file('photos.mp4');pending.resolve({file:movie,duration:4,width:720,height:1280,count:2});await settle();h.metadata(4);await settle();assert.equal(h.node('.ks-edit-dialog').getAttribute('data-view'),'edit');h.node('.ks-edit-next').click();await settle();assert.equal(h.confirmed[0].file,movie);assert.equal(h.deviceCalls.length,0);assert.equal(h.urls.size,0);
});

test('closing a pending photo movie cancels it and a late completion cannot reopen the editor',async()=>{
 const h=harness(),pending=deferred(),engine=photosEngine(h,pending);h.open();selectPhotos(h);h.node('.ks-edit-photos-build').click();h.editor.close();await settle();assert.equal(engine.cancelled(),1);assert.equal(h.urls.size,0);assert.equal(h.document.body.children.length,0);assert.equal(h.confirmed.length,0);
});

test('hiding or cancelling photo export retains photos for deliberate retry without confirming',async()=>{
 const h=harness(),pending=deferred(),engine=photosEngine(h,pending);h.open();selectPhotos(h);h.node('.ks-edit-photos-build').click();h.hidden();await settle();assert.equal(engine.cancelled(),1);assert.equal(h.node('.ks-edit-photos-list').children.length,2);assert.equal(h.node('.ks-edit-photos-build').disabled,false);assert.equal(h.confirmed.length,0);h.editor.close();assert.equal(h.urls.size,0);
});


test('visual trim handles clamp crossing and update the real edit values without recording or confirming',()=>{
  const h=harness();h.open();h.select();const video=h.metadata(12);
  h.node('.ks-edit-range-start').value='3';h.node('.ks-edit-range-start').emit('input');h.node('.ks-edit-range-end').value='8';h.node('.ks-edit-range-end').emit('input');
  assert.equal(h.node('.ks-edit-trim-start').value,'3');assert.equal(h.node('.ks-edit-trim-end').value,'8');assert.equal(video.currentTime,7.99);assert.equal(h.node('.ks-edit-selected-duration').textContent,'5.0秒を使用');
  h.node('.ks-edit-range-start').value='12';h.node('.ks-edit-range-start').emit('input');assert.equal(h.node('.ks-edit-trim-start').value,'7.9');assert.equal(trimRange(7.9,8,12).duration,8-7.9);
  h.node('.ks-edit-range-end').value='0';h.node('.ks-edit-range-end').emit('input');assert.equal(h.node('.ks-edit-trim-end').value,'8');assert.equal(h.recorders.length,0);assert.equal(h.confirmed.length,0);assert.equal(h.deviceCalls.length,0);h.editor.close();
});
test('tool panels keep edits while switching and exact seconds stay in a closed optional disclosure',()=>{
  const h=harness();h.open();h.select();h.metadata();assert.equal(h.node('.ks-edit-trim-panel').hidden,false);assert.equal(h.node('.ks-edit-text-panel').hidden,true);assert.notEqual(h.node('.ks-edit-precise').open,true);
  h.node('.ks-edit-tool[data-tool="text"]').click();assert.equal(h.node('.ks-edit-trim-panel').hidden,true);h.node('.ks-edit-text').value='わたしの動画';h.node('.ks-edit-text').emit('input');h.node('.ks-edit-position').value='top';h.node('.ks-edit-position').emit('change');
  h.node('.ks-edit-tool[data-tool="audio"]').click();h.node('.ks-edit-muted').checked=true;h.node('.ks-edit-muted').emit('change');h.node('.ks-edit-tool[data-tool="text"]').click();assert.equal(h.node('.ks-edit-text').value,'わたしの動画');assert.equal(h.node('.ks-edit-position').value,'top');assert.equal(h.node('.ks-edit-muted').checked,true);assert.equal(h.node('.ks-edit-text-count').textContent,'6 / 100');assert.equal(h.recorders.length,0);assert.equal(h.confirmed.length,0);h.editor.close();
});
test('reset and replacement synchronize the handles and selected window with the original media',()=>{
  const h=harness();h.open();h.select();h.metadata();h.node('.ks-edit-range-start').value='4';h.node('.ks-edit-range-start').emit('input');h.node('.ks-edit-text').value='draft';h.node('.ks-edit-text').emit('input');h.node('.ks-edit-muted').checked=true;h.node('.ks-edit-reset').click();assert.equal(h.node('.ks-edit-range-start').value,'0');assert.equal(h.node('.ks-edit-range-end').value,'12');assert.equal(h.node('.ks-edit-selection').style.width,'100%');assert.equal(h.node('.ks-edit-text').value,'');assert.equal(h.node('.ks-edit-muted').checked,false);
  h.select(h.file('replacement.mp4'));h.metadata(5);assert.equal(h.node('.ks-edit-range-end').value,'5');assert.equal(h.node('.ks-edit-selected-duration').textContent,'5.0秒を使用');assert.equal(h.recorders.length,0);h.editor.close();
});
test('range gestures drive the existing exported MP4 range and remain locked until completion',async()=>{
  const h=harness({autoExportMetadata:true});h.open();h.select();h.metadata();h.node('.ks-edit-range-start').value='3';h.node('.ks-edit-range-start').emit('input');h.node('.ks-edit-range-end').value='7';h.node('.ks-edit-range-end').emit('input');h.node('.ks-edit-muted').checked=true;h.node('.ks-edit-muted').emit('change');h.node('.ks-edit-next').click();await settle();h.node('video.ks-edit-scratch').emit('seeked');await settle();assert.equal(h.recorders.length,1);assert.equal(h.node('.ks-edit-range-start').disabled,true);assert.equal(h.node('.ks-edit-tool[data-tool="text"]').disabled,true);
  h.node('.ks-edit-range-start').value='6';h.node('.ks-edit-range-start').emit('input');assert.equal(h.node('.ks-edit-trim-start').value,'3');h.node('video.ks-edit-scratch').currentTime=7;const frames=[...h.frames.values()];h.frames.clear();frames.forEach(fn=>fn());await settle();assert.equal(h.confirmed.length,1);assert.equal(h.confirmed[0].details.duration,4);assert.equal(h.confirmed[0].details.edited,true);assert.equal(h.urls.size,0);
});
test('thumbnail jobs stop on media replacement and close, with stale frames ignored',()=>{
  const h=harness(),jobs=[];h.window.KNShortsTimeline={start(url,duration,onFrame){const job={url,duration,onFrame,cancels:0,cancel(){this.cancels++;}};jobs.push(job);return job;}};h.open();h.select();h.metadata();jobs[0].onFrame(0,'data:image/jpeg;base64,first');assert.equal(h.document.querySelectorAll('img')[0].src,'data:image/jpeg;base64,first');h.select(h.file('new.mp4'));h.metadata(6);assert.equal(jobs[0].cancels,1);jobs[0].onFrame(0,'data:image/jpeg;base64,stale');assert.equal(h.document.querySelectorAll('img')[0].hidden,true);h.editor.close();assert.equal(jobs[1].cancels,1);jobs[1].onFrame(0,'data:image/jpeg;base64,late');assert.equal(h.document.body.children.length,0);
});
test('precise invalid inputs can recover through handles and decimal 0.1-second intervals remain valid',()=>{
  assert.doesNotThrow(()=>trimRange(.3,.4,12));assert.throws(()=>trimRange(.3,.399,12),/invalid_trim/);
  const h=harness();h.open();h.select();h.metadata();h.node('.ks-edit-trim-start').value='99';h.node('.ks-edit-trim-end').value='bad';h.node('.ks-edit-range-start').value='2';h.node('.ks-edit-range-start').emit('input');assert.equal(h.node('.ks-edit-trim-start').value,'2');assert.equal(h.node('.ks-edit-trim-end').value,'12');h.editor.close();
});

test('a fractional source duration keeps a full minimum interval when handles meet the source edge',()=>{
  const h=harness();h.open();h.select();h.metadata(12.3475);h.node('.ks-edit-range-start').value='12.3';h.node('.ks-edit-range-start').emit('input');const range=trimRange(h.node('.ks-edit-trim-start').value,h.node('.ks-edit-trim-end').value,12.3475);assert.ok(Math.abs(range.duration-.1)<1e-8);assert.equal(Number(h.node('.ks-edit-trim-end').value),12.3475);assert.equal(h.node('.ks-edit-selected-duration').textContent,'0.1秒を使用');h.editor.close();
});

test('pointer dragging selects the nearest boundary even when the handles overlap',()=>{
  const h=harness();h.open();h.select();h.metadata(3);const timeline=h.node('.ks-edit-timeline');h.node('.ks-edit-trim-start').value='2.9';h.node('.ks-edit-trim-end').value='3';h.node('.ks-edit-trim-end').emit('change');
  timeline.emit('pointerdown',{button:0,pointerId:7,clientX:348});timeline.emit('pointermove',{pointerId:7,clientX:120});timeline.emit('pointerup',{pointerId:7});assert.equal(h.node('.ks-edit-trim-start').value,'1');assert.equal(h.node('.ks-edit-trim-end').value,'3');assert.equal(h.document.activeElement,h.node('.ks-edit-range-start'));
  timeline.emit('pointerdown',{button:0,pointerId:8,clientX:360});timeline.emit('pointermove',{pointerId:8,clientX:240});timeline.emit('pointercancel',{pointerId:8});assert.equal(h.node('.ks-edit-trim-end').value,'2');assert.equal(h.recorders.length,0);assert.equal(h.confirmed.length,0);h.editor.close();
});
test('clicking the filmstrip middle scrubs without trimming or starting media export',()=>{
  const h=harness();h.open();h.select();const video=h.metadata(12);h.node('.ks-edit-timeline').emit('pointerdown',{button:0,pointerId:1,clientX:180});h.node('.ks-edit-timeline').emit('pointerup',{pointerId:1});assert.equal(video.currentTime,6);assert.equal(h.node('.ks-edit-trim-start').value,'0');assert.equal(h.node('.ks-edit-trim-end').value,'12');assert.equal(h.recorders.length,0);h.editor.close();
});

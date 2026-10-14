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
  assert.equal(h.deviceCalls.length,1);assert.ok(h.node('.ks-edit-status').textContent);
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

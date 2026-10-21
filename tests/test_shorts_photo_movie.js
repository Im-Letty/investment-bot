'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {create,validateFiles,recorderMime}=require('../static/shorts-photo-movie.js');
const settle=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function harness(options={}){
 let time=0,next=0;const timers=new Map(),frames=new Map(),bitmaps=[],canvases=[],streams=[],recorders=[],decodeOrder=[],draws=[],progress=[],urls=new Set(),revoked=[];
 class Track{constructor(){this.kind='video';this.readyState='live';}stop(){this.readyState='ended';}}
 class Stream{constructor(){this.tracks=[new Track()];streams.push(this);}getTracks(){return this.tracks;}getVideoTracks(){return this.tracks;}getAudioTracks(){return[];}}
 class Recorder{
  static isTypeSupported(mime){return options.types===undefined?mime==='video/mp4;codecs=avc1':options.types.includes(mime);}
  constructor(stream,config){if(options.constructorError)throw new Error('encoder');this.stream=stream;this.mimeType=config.mimeType;this.state='inactive';recorders.push(this);}
  start(){if(options.startError)throw new Error('encoder');this.state='recording';}
  stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob([new Uint8Array(options.outputBytes??16)],{type:this.mimeType})});this.onstop?.();});}
 }
 function canvas(){
  const node={tagName:'CANVAS',width:0,height:0,removed:false,remove(){this.removed=true;},getContext(){if(options.context===false)return null;return{set fillStyle(v){},fillRect(){},drawImage(source,...args){if(options.drawError)throw new Error('draw');node.imageName=source.name||source.imageName;draws.push({canvas:node,source:node.imageName,args});}};}};
  if(options.capture!==false)node.captureStream=fps=>{node.fps=fps;return new Stream();};canvases.push(node);return node;
 }
 const host={document:{createElement(tag){assert.equal(tag,'canvas');return canvas();}},Blob,File,MediaRecorder:options.recorder===false?undefined:Recorder,performance:{now:()=>time},setTimeout(fn,delay){const id=++next;timers.set(id,{fn,at:time+delay});return id;},clearTimeout(id){timers.delete(id);},requestAnimationFrame(fn){const id=++next;frames.set(id,fn);return id;},cancelAnimationFrame(id){frames.delete(id);},fetch(){assert.fail('Photo creation must never send traffic');},navigator:{mediaDevices:{getUserMedia(){assert.fail('Photo creation must never access devices');}}},URL:{createObjectURL(){const url='blob:photo/'+(++next);urls.add(url);return url;},revokeObjectURL(url){urls.delete(url);revoked.push(url);}}};
 function bitmap(file){const image={name:file.name,width:file.fixtureWidth||1600,height:file.fixtureHeight||900,closed:false,close(){this.closed=true;}};bitmaps.push(image);return image;}
 if(options.fallback){
  host.Image=class{constructor(){this.tagName='IMG';this.naturalWidth=1600;this.naturalHeight=900;}set src(value){this._src=value;if(value)queueMicrotask(()=>options.decodeError?this.onerror?.():this.onload?.());}get src(){return this._src;}};
 }else host.createImageBitmap=(file)=>{decodeOrder.push(file.name);return options.decode?options.decode(file,bitmap):options.decodeError?Promise.reject(new Error('bad')):Promise.resolve(bitmap(file));};
 const api=create(host);
 function file(name='photo.jpg',width=1600,height=900){const f=new File(['image fixture'],name,{type:/\.png$/i.test(name)?'image/png':/\.webp$/i.test(name)?'image/webp':'image/jpeg'});f.fixtureWidth=width;f.fixtureHeight=height;return f;}
 function render(files=[file()],config={}){return api.render(files,{onProgress:value=>progress.push(value),...config});}
 async function tick(ms=1000){time+=ms;const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(time));for(const[id,timer]of [...timers])if(timer.at<=time){timers.delete(id);timer.fn();}await settle();}
 async function advance(ms){for(let remaining=ms;remaining>0;remaining-=Math.min(1000,remaining))await tick(Math.min(1000,remaining));}
 function released(){assert.equal(timers.size,0);assert.equal(frames.size,0);assert.equal(urls.size,0);assert.ok(streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));assert.ok(bitmaps.every(image=>image.closed));assert.ok(canvases.every(c=>c.width===0&&c.height===0));}
 return{api,host,render,file,tick,advance,released,timers,frames,bitmaps,canvases,streams,recorders,decodeOrder,draws,progress,urls,revoked,bitmap};
}

test('photo inputs have bounded counts, MIME types, individual and aggregate sizes',()=>{
 const f=(name='p.jpg',size=4,type='image/jpeg')=>({name,size,type});
 assert.equal(validateFiles([f()]).length,1);assert.equal(validateFiles([f('p.webp',4,'image/webp')]).length,1);
 for(const values of [[],Array(13).fill(f()),null,{length:Infinity}])assert.throws(()=>validateFiles(values),/invalid_photo_count/);
 assert.throws(()=>validateFiles([f('p.gif',4,'image/gif')]),/unsupported_image/);assert.throws(()=>validateFiles([f('p.jpg',4,'text/plain')]),/unsupported_image/);
 assert.throws(()=>validateFiles([f('p.jpg',0)]),/invalid_image/);assert.throws(()=>validateFiles([f('p.jpg',10000001)]),/photo_too_large/);
 assert.throws(()=>validateFiles(Array(5).fill(f('p.jpg',9000000))),/photos_too_large/);
});

test('photo duration validation and missing H264 support fail without decoding or recording',async()=>{
 for(const secondsPerPhoto of [0,6,NaN,Infinity]){const h=harness(),job=h.render(undefined,{secondsPerPhoto});await assert.rejects(job.promise,/invalid_photo_duration/);assert.equal(h.decodeOrder.length,0);h.released();}
 const h=harness({types:['video/webm']});await assert.rejects(h.render().promise,/unsupported_export/);assert.equal(h.decodeOrder.length,0);h.released();assert.equal(recorderMime({}),'');
});

test('a successful silent MP4 preserves photo order, duration, full-image letterboxing and releases every resource',async()=>{
 const h=harness(),files=[h.file('wide.jpg',1600,900),h.file('portrait.png',900,1600)],job=h.render(files,{secondsPerPhoto:2});await settle();
 assert.deepEqual(h.decodeOrder,['wide.jpg','portrait.png']);assert.equal(h.recorders.length,1);assert.equal(h.streams[0].getAudioTracks().length,0);assert.equal(h.canvases[0].fps,24);
 await h.advance(4000);const result=await job.promise;
 assert.deepEqual({duration:result.duration,width:result.width,height:result.height,count:result.count},{duration:4,width:720,height:1280,count:2});assert.ok(result.file instanceof File);assert.match(result.file.name,/^photos-.*\.mp4$/);assert.equal(result.file.type,'video/mp4;codecs=avc1');assert.ok(result.file.size>0);
 const output=h.draws.filter(item=>item.canvas===h.canvases[0]);assert.deepEqual([...new Set(output.map(v=>v.source))],['wide.jpg','portrait.png']);
 const wide=output.find(v=>v.source==='wide.jpg');assert.deepEqual(wide.args,[0,437.5,720,405]);const portrait=output.find(v=>v.source==='portrait.png');assert.deepEqual(portrait.args,[0,0,720,1280]);
 assert.equal(h.progress.at(-1).phase,'complete');assert.equal(h.progress.at(-1).percent,100);h.released();
});

test('images are scaled down before caching and oversized decoded dimensions never enter the encoder',async()=>{
 const h=harness(),job=h.render([h.file('large.jpg',6000,4000)]);await settle();assert.equal(h.canvases[1].width,720);assert.equal(h.canvases[1].height,480);assert.ok(h.bitmaps[0].closed);job.cancel();await assert.rejects(job.promise,/cancelled/);h.released();
 const bad=harness();await assert.rejects(bad.render([bad.file('huge.jpg',6001,4000)]).promise,/invalid_image_dimensions/);assert.equal(bad.recorders.length,0);bad.released();
});

test('cancel during bitmap decoding rejects promptly and closes a late bitmap without recording',async()=>{
 const pending=deferred(),h=harness({decode:()=>pending.promise}),job=h.render();await settle();job.cancel();await assert.rejects(job.promise,/cancelled/);h.released();
 const late=h.bitmap(h.file());pending.resolve(late);await settle();assert.equal(late.closed,true);assert.equal(h.recorders.length,0);h.released();
});

test('a timed-out bitmap is closed when its decoder eventually settles',async()=>{
 const pending=deferred(),h=harness({decode:()=>pending.promise}),job=h.render();await settle();const rejected=assert.rejects(job.promise,/image_decode_timeout/);await h.tick(10001);await rejected;
 const late=h.bitmap(h.file());pending.resolve(late);await settle();assert.equal(late.closed,true);h.released();
});

test('a corrupt image cannot silently produce a video from the other photos',async()=>{
 let count=0;const h=harness({decode:(file,bitmap)=>++count===2?Promise.reject(new Error('bad')):Promise.resolve(bitmap(file))});
 await assert.rejects(h.render([h.file('first.jpg'),h.file('bad.jpg')]).promise,/invalid_image/);assert.equal(h.recorders.length,0);h.released();
});

test('cancelling during encoding stops the canvas track, recorder, frame callbacks and timers',async()=>{
 const h=harness(),job=h.render();await settle();assert.equal(h.recorders[0].state,'recording');job.cancel();await assert.rejects(job.promise,/cancelled/);assert.equal(h.recorders[0].state,'inactive');h.released();
});

test('fallback Image decoding revokes its temporary URL and can create a local MP4',async()=>{
 const h=harness({fallback:true}),job=h.render();await settle();assert.equal(h.urls.size,0);assert.equal(h.revoked.length,1);assert.equal(h.recorders.length,1);await h.advance(3000);assert.ok((await job.promise).file.size>0);h.released();
});

test('fallback Image decode failure releases the object URL and never starts a recorder',async()=>{
 const h=harness({fallback:true,decodeError:true});await assert.rejects(h.render().promise,/invalid_image/);assert.equal(h.revoked.length,1);assert.equal(h.recorders.length,0);h.released();
});

test('encoder error and constructor failures reject rather than returning an empty or original file',async()=>{
 const h=harness(),job=h.render();await settle();h.recorders[0].onerror();await assert.rejects(job.promise,/export_failed/);h.released();
 const constructor=harness({constructorError:true});await assert.rejects(constructor.render().promise,/unsupported_export/);constructor.released();
 const start=harness({startError:true});await assert.rejects(start.render().promise,/export_failed/);start.released();
});

test('output byte limit is enforced and a stalled frame clock cannot skip photographs',async()=>{
 const h=harness(),job=h.render();await settle();h.recorders[0].ondataavailable({data:{size:20000001}});await assert.rejects(job.promise,/file_too_large/);h.released();
 const stalled=harness(),waiting=stalled.render([stalled.file('one.jpg'),stalled.file('two.jpg')],{secondsPerPhoto:1});await settle();const rejected=assert.rejects(waiting.promise,/export_timeout/);await stalled.tick(2500);await rejected;stalled.released();
});

test('an exact 2000ms terminal jump cannot report two one-second photos when only the first was drawn',async()=>{
 const h=harness(),job=h.render([h.file('first.png'),h.file('last.png')],{secondsPerPhoto:1});await settle();
 const rejected=assert.rejects(job.promise,/export_timeout/);await h.tick(2000);await rejected;
 assert.deepEqual([...new Set(h.draws.filter(item=>item.canvas===h.canvases[0]).map(item=>item.source))],['first.png']);
 assert.equal(h.progress.some(item=>item.phase==='complete'),false);h.released();
});

test('a final jump that omits the last photo and a late last photo both reject instead of confirming a shortened slideshow',async()=>{
 const skipped=harness(),missing=skipped.render([skipped.file('first.jpg'),skipped.file('middle.jpg'),skipped.file('last.jpg')],{secondsPerPhoto:1});await settle();
 await skipped.tick(1000);const missingRejected=assert.rejects(missing.promise,/export_timeout/);await skipped.tick(2000);await missingRejected;
 assert.deepEqual([...new Set(skipped.draws.filter(item=>item.canvas===skipped.canvases[0]).map(item=>item.source))],['first.jpg','middle.jpg']);assert.equal(skipped.progress.some(item=>item.phase==='complete'),false);skipped.released();
 const late=harness(),shortened=late.render([late.file('first.jpg'),late.file('last.jpg')],{secondsPerPhoto:1});await settle();await late.tick(900);
 const shortenedRejected=assert.rejects(shortened.promise,/export_timeout/);await late.tick(900);await shortenedRejected;
 assert.equal(late.progress.some(item=>item.phase==='complete'),false);late.released();
});

test('small scheduling jitter retains both complete photo exposures and nominal duration',async()=>{
 const h=harness(),job=h.render([h.file('first.jpg'),h.file('last.jpg')],{secondsPerPhoto:1});await settle();
 await h.tick(900);await h.tick(150);await h.tick(950);const result=await job.promise;
 assert.equal(result.count,2);assert.equal(result.duration,2);assert.deepEqual([...new Set(h.draws.filter(item=>item.canvas===h.canvases[0]).map(item=>item.source))],['first.jpg','last.jpg']);h.released();
});

test('the independent wall timer ends an encoder when animation frames never resume',async()=>{
 const h=harness(),job=h.render();await settle();h.frames.clear();const rejected=assert.rejects(job.promise,/export_timeout/);await h.tick(18001);await rejected;h.released();
});

test('unsupported capture/context and cancellation before work begins never request devices or network',async()=>{
 for(const options of [{capture:false},{context:false},{recorder:false}]){const h=harness(options);await assert.rejects(h.render().promise,/unsupported_export/);h.released();}
 const h=harness(),job=h.render();job.cancel();await assert.rejects(job.promise,/cancelled/);assert.equal(h.decodeOrder.length,0);h.released();
});

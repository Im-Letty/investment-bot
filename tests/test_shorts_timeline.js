'use strict';
const assert=require('node:assert/strict');
const engine=require('../static/shorts-timeline.js');
const test=require('node:test');
function fixture(options={}){
  let now=0,nextTimer=1;
  const timers=new Map(),nodes=[],events=[],seeks=[],draws=[],encodes=[];
  const body={children:[],appendChild(el){this.children.push(el);el.parentNode=this;},removeChild(el){this.children=this.children.filter(x=>x!==el);el.parentNode=null;}};
  const video={tagName:'VIDEO',readyState:2,duration:12,videoWidth:1920,videoHeight:1080,src:'',pauseCount:0,loadCount:0,removedSrc:false,callbacks:new Map(),
    setAttribute(){},removeAttribute(name){if(name==='src'){this.src='';this.removedSrc=true;}},pause(){this.pauseCount+=1;},load(){this.loadCount+=1;},remove(){if(this.parentNode)this.parentNode.removeChild(this);},
    addEventListener(name,fn){if(!this.callbacks.has(name))this.callbacks.set(name,new Set());this.callbacks.get(name).add(fn);events.push({name,fn});},
    removeEventListener(name,fn){if(this.callbacks.has(name))this.callbacks.get(name).delete(fn);},
    emit(name){Array.from(this.callbacks.get(name)||[]).forEach(fn=>fn());}
  };
  Object.defineProperty(video,'currentTime',{set(value){seeks.push(value);},get(){return seeks[seeks.length-1]||0;}});
  const canvas={tagName:'CANVAS',width:0,height:0,setAttribute(){},remove(){if(this.parentNode)this.parentNode.removeChild(this);},getContext(){return options.contextMissing?null:{drawImage(...args){draws.push(args);}};},toDataURL(type,quality){encodes.push([type,quality,this.width,this.height]);return options.data===undefined?'data:image/jpeg;base64,AAAA':options.data;}};
  const host={document:{body,createElement(name){const el=name==='video'?video:canvas;nodes.push(el);return el;}},
    setTimeout(fn,delay){const id=nextTimer++;timers.set(id,{fn,at:now+delay});return id;},clearTimeout(id){timers.delete(id);}
  };
  for(const name of ['fetch','getUserMedia','MediaRecorder','URL'])Object.defineProperty(host,name,{get(){throw new Error('forbidden capability: '+name);}});
  function tick(ms){const end=now+ms;while(true){const due=Array.from(timers).filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();}now=end;}
  function clean(){assert.equal(timers.size,0);assert.equal(body.children.length,0);assert.equal(Array.from(video.callbacks.values()).reduce((n,set)=>n+set.size,0),0);assert.equal(video.src,'');assert.equal(video.removedSrc,true);assert.equal(canvas.width,0);assert.equal(canvas.height,0);}
  return {api:engine.create(host),host,video,canvas,body,nodes,timers,events,seeks,draws,encodes,tick,clean};
}
test('invalid URLs, durations and callbacks allocate no media resources',()=>{
  for(const url of ['https://example.invalid/video.mp4','data:video/mp4;base64,AA','blob:',' blob:test','blob:test\n']){
    const h=fixture();const job=h.api.start(url,12,()=>assert.fail('frame'));job.cancel();assert.equal(h.nodes.length,0);assert.equal(h.timers.size,0);
  }
  for(const duration of [0,-1,180.01,Infinity,NaN,'12']){const h=fixture();h.api.start('blob:test',duration,()=>{});assert.equal(h.nodes.length,0);}
  const h=fixture();h.api.start('blob:test',12,null);assert.equal(h.nodes.length,0);
});
test('six midpoint frames are sought in order and center-cropped as bounded JPEGs',()=>{
  const h=fixture(),frames=[];const job=h.api.start('blob:test',12,(...args)=>frames.push(args));
  assert.deepEqual(h.nodes.map(n=>n.tagName),['VIDEO','CANVAS']);assert.equal(h.video.src,'blob:test');assert.equal(h.video.muted,true);assert.equal(h.video.playsInline,true);
  assert.equal(h.video.className,'ks-edit-scratch');assert.equal(h.canvas.className,'ks-edit-scratch');
  h.video.emit('loadedmetadata');
  for(let i=0;i<6;i++){assert.equal(frames.length,i);assert.equal(h.seeks[i],1+2*i);h.video.emit('seeked');}
  assert.deepEqual(frames.map(f=>f[0]),[0,1,2,3,4,5]);assert.deepEqual(h.seeks,[1,3,5,7,9,11]);
  assert.deepEqual(h.draws[0].slice(1),[555,0,810,1080,0,0,72,96]);assert.equal(h.draws.length,6);
  assert.equal(h.encodes.every(v=>JSON.stringify(v)===JSON.stringify(['image/jpeg',0.6,72,96])),true);
  h.clean();job.cancel();h.video.emit('seeked');assert.equal(frames.length,6);
});
test('a seek waits for decoded data without capturing stale pixels',()=>{
  const h=fixture(),frames=[];h.api.start('blob:test',12,(...args)=>frames.push(args));h.video.emit('loadedmetadata');h.video.readyState=1;h.video.emit('seeked');
  assert.equal(frames.length,0);assert.equal(h.seeks.length,1);h.video.readyState=2;h.video.emit('loadeddata');assert.equal(frames.length,1);assert.equal(h.seeks.length,2);
  h.tick(1500);h.clean();assert.equal(frames.length,1);
});
test('cancel clears media and all listeners/timers; queued late events emit nothing',()=>{
  const h=fixture(),frames=[];const job=h.api.start('blob:test',12,(...args)=>frames.push(args));h.video.emit('loadedmetadata');const late=h.events.map(e=>e.fn);
  job.cancel();h.clean();late.forEach(fn=>fn());h.tick(20000);assert.equal(frames.length,0);h.clean();
});
test('metadata and seek waits each time out after at most 1500 milliseconds',()=>{
  for(const phase of ['metadata','seek','data']){
    const h=fixture(),frames=[];h.api.start('blob:test',12,(...args)=>frames.push(args));
    if(phase!=='metadata')h.video.emit('loadedmetadata');if(phase==='data'){h.video.readyState=1;h.video.emit('seeked');}
    h.tick(1499);assert.equal(h.body.children.length,2);h.tick(1);h.clean();h.events.forEach(e=>e.fn());assert.equal(frames.length,0);
  }
});
test('the whole job stops by ten seconds even when each individual event arrives in time',()=>{
  const h=fixture(),frames=[];h.api.start('blob:test',12,(...args)=>frames.push(args));h.tick(1400);h.video.emit('loadedmetadata');
  for(let i=0;i<3;i++){h.tick(1400);h.video.readyState=1;h.video.emit('seeked');h.tick(1400);h.video.readyState=2;h.video.emit('loadeddata');}
  assert.equal(frames.length,3);h.tick(200);h.clean();h.events.forEach(e=>e.fn());assert.equal(frames.length,3);
});
test('oversized or non-JPEG output and callback failures stop quietly and release resources',()=>{
  for(const data of ['data:image/jpeg;base64,'+'A'.repeat(32768),'data:image/png;base64,AA']){
    const h=fixture({data});h.api.start('blob:test',12,()=>assert.fail('invalid frame'));h.video.emit('loadedmetadata');h.video.emit('seeked');h.clean();assert.equal(h.seeks.length,1);
  }
  const h=fixture();let calls=0;h.api.start('blob:test',12,()=>{calls+=1;throw new Error('consumer failed');});h.video.emit('loadedmetadata');h.video.emit('seeked');h.clean();assert.equal(calls,1);assert.equal(h.seeks.length,1);
});
test('media errors and unsupported canvas keep the editor usable without callbacks',()=>{
  const h=fixture();h.api.start('blob:test',12,()=>assert.fail('frame'));h.video.emit('error');h.clean();
  const noCanvas=fixture({contextMissing:true});noCanvas.api.start('blob:test',12,()=>assert.fail('frame'));noCanvas.clean();
});

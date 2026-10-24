'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Motion = require('../static/pet-lilac-motion.js');
const source = fs.readFileSync(require.resolve('../static/pet-lilac-motion.js'), 'utf8');

const pngCache = new Map();
function pngPixel(name,x,y) {
  if(!pngCache.has(name)){
    const bytes=fs.readFileSync(require.resolve('../static/'+name)),width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20),chunks=[];
    assert.equal(bytes[24],8);assert.equal(bytes[25],6);assert.equal(bytes[28],0);
    for(let at=8;at<bytes.length;){const length=bytes.readUInt32BE(at);if(bytes.toString('ascii',at+4,at+8)==='IDAT')chunks.push(bytes.subarray(at+8,at+8+length));at+=length+12;}
    const raw=require('node:zlib').inflateSync(Buffer.concat(chunks)),stride=width*4,pixels=new Uint8Array(stride*height);let at=0;
    for(let row=0;row<height;row++){const filter=raw[at++];for(let col=0;col<stride;col++){
      const left=col>=4?pixels[row*stride+col-4]:0,above=row?pixels[(row-1)*stride+col]:0,corner=row&&col>=4?pixels[(row-1)*stride+col-4]:0;
      let predict=0;if(filter===1)predict=left;else if(filter===2)predict=above;else if(filter===3)predict=Math.floor((left+above)/2);else if(filter===4){const p=left+above-corner,a=Math.abs(p-left),b=Math.abs(p-above),c=Math.abs(p-corner);predict=a<=b&&a<=c?left:b<=c?above:corner;}else assert.equal(filter,0);
      pixels[row*stride+col]=(raw[at++]+predict)&255;
    }}pngCache.set(name,{pixels,width,height});
  }
  const png=pngCache.get(name),px=Math.max(0,Math.min(png.width-1,Math.round(x*(png.width-1)))),py=Math.max(0,Math.min(png.height-1,Math.round(y*(png.height-1))));
  return Array.from(png.pixels.subarray((py*png.width+px)*4,(py*png.width+px)*4+4));
}
function events(target = {}) {
  const listeners = new Map();
  target.addEventListener = (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); };
  target.removeEventListener = (name, fn) => listeners.get(name)?.delete(fn);
  target.emit = (name, event = {}) => [...(listeners.get(name) || [])].forEach(fn => fn(event));
  target.listenerCount = () => [...listeners.values()].reduce((n, set) => n + set.size, 0);
  return target;
}
function fixture(config = {}) {
  let clock = 0, id = 0, draws = 0, ready = 0, released = 0, clears=0, updates=0, liveVertices=null, activeUnit=0, maxActiveUnit=0, activeBuffer=null;
  const raf = new Map(), timers = new Map(), images = [], created = [], deleted = [], uploads = [], errors = [], uniforms = {}, shaders = [], buffers = [], attributes = [], drawCalls = [], bindings = [], constants = {}, disabledAttributes = [],hitReads=[];
  const boundTextures={},samplers={},enabled=[],blend=[],enabledAttributes=new Set(),vertexData=new Map();
  const media = events({ matches: !!config.reduced });
  const doc = events({ hidden: !!config.hidden });
  doc.createElement = name => {
    assert.equal(name,'canvas');let image;
    return {width:0,height:0,getContext(kind){assert.equal(kind,'2d');return {
      drawImage(im){image=im;},getImageData(){
        const file=image.url.split('/').at(-1);hitReads.push(file);
        if(config.hitPixels!=='png')throw new Error('unrecorded inaccessible source pixels');
        pngPixel(file,0,0);return {data:pngCache.get(file).pixels};
      }
    };}};
  };
  const win = events({ document: doc, devicePixelRatio: config.dpr || 3,
    performance: { now: () => clock }, matchMedia: () => media,
    requestAnimationFrame(fn) { const key = ++id; raf.set(key, fn); return key; },
    cancelAnimationFrame(key) { raf.delete(key); },
    setTimeout(fn) { const key = ++id; timers.set(key, fn); return key; },
    clearTimeout(key) { timers.delete(key); }
  });
  doc.defaultView = win;
  win.Image = class {
    constructor() { this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0; images.push(this); }
    set src(value) { this.url = value; }
    removeAttribute(name) { if (name === 'src') this.url = null; }
  };
  const gl = {};
  gl.getExtension = name => name === 'WEBGL_lose_context' ? { loseContext() { released++; } } : null;
  ['VERTEX_SHADER', 'FRAGMENT_SHADER', 'COMPILE_STATUS', 'LINK_STATUS', 'ARRAY_BUFFER', 'STATIC_DRAW',
    'FLOAT', 'TEXTURE_2D', 'TEXTURE_WRAP_S', 'TEXTURE_WRAP_T', 'CLAMP_TO_EDGE', 'TEXTURE_MIN_FILTER',
    'TEXTURE_MAG_FILTER', 'LINEAR', 'RGBA', 'UNSIGNED_BYTE', 'TRIANGLES', 'UNPACK_FLIP_Y_WEBGL',
    'DYNAMIC_DRAW','COLOR_BUFFER_BIT','BLEND','ONE','ONE_MINUS_SRC_ALPHA'].forEach((key, n) => { gl[key] = n + 1; });
  gl.TEXTURE0 = 100;
  ['Shader', 'Program', 'Buffer', 'Texture'].forEach(type => {
    gl['create' + type] = () => { const object = { type, id: ++id }; created.push(object); return object; };
    gl['delete' + type] = value => deleted.push(value);
  });
  ['attachShader', 'compileShader', 'linkProgram', 'useProgram', 'bindBuffer', 'bufferData',
    'enableVertexAttribArray', 'vertexAttribPointer', 'bindTexture', 'texParameteri', 'uniform1i',
    'activeTexture', 'pixelStorei', 'viewport'].forEach(key => { gl[key] = () => {}; });
  gl.shaderSource = (_, text) => shaders.push(text);
  gl.getShaderParameter = () => !config.compileFailure;
  gl.getProgramParameter = () => !config.linkFailure;
  gl.getAttribLocation = (_, name) => name === 'a_position' ? 0 : name === 'a_uv' ? 1 : name === 'a_evolution' ? 2 : name === 'a_coverage'?3:name==='a_part'?4:name==='a_sourceRect'?5:name==='a_mouthMode'?6:name==='a_handVolume'?7:-1;
  gl.bindAttribLocation = (_,index,name) => { bindings.push([index,name]); };
  gl.disableVertexAttribArray = index => { disabledAttributes.push(index);enabledAttributes.delete(index); };
  gl.enableVertexAttribArray = index => { enabledAttributes.add(index); };
  gl.vertexAttrib4f = (index,...values) => { constants[index]=values; };
  gl.vertexAttrib1f = (index,value) => { constants[index]=value; };
  gl.enable = flag => enabled.push(flag);gl.blendFunc = (...values) => blend.push(values);
  gl.clearColor = (...values) => { assert.deepEqual(values,[0,0,0,0]); };
  gl.clear = value => { assert.equal(value,gl.COLOR_BUFFER_BIT);clears++; };
  gl.activeTexture = unit => { activeUnit=unit-gl.TEXTURE0;maxActiveUnit=Math.max(maxActiveUnit,activeUnit);assert.ok(activeUnit>=0&&activeUnit<=7,'WebGL 1 eight texture units'); };
  gl.bindTexture = (_,texture) => { boundTextures[activeUnit]=texture; };
  gl.uniform1i = (key,value) => { samplers[key]=value; };
  gl.bindBuffer = (_,value) => { activeBuffer=value; };
  gl.bufferData = (target, data, usage) => { buffers.push({ target, buffer:activeBuffer, data: new Float32Array(data), usage }); };
  gl.bufferSubData = (_,offset,data) => { assert.equal(offset,0);vertexData.set(activeBuffer,new Float32Array(data));if(!enabledAttributes.has(7)){if(!liveVertices||liveVertices.length!==data.length)liveVertices=new Float32Array(data.length);liveVertices.set(data);}updates++; };
  gl.vertexAttribPointer = (index, size, type, normalized, stride, offset) => { attributes.push({ index, size, type, normalized, stride, offset }); };
  gl.getUniformLocation = (_, key) => key;
  gl.uniform1f = (key, value) => { uniforms[key] = value; };
  gl.uniform2f = (key, a, b) => { uniforms[key] = [a, b]; };
  const packedNames = {
    u_motionA: ['breath', 'tilt', 'ear', 'tail'], u_motionB: ['wave', 'wiggle', 'blink', 'chew'],
    u_motionC: ['bounce', 'step', 'scale', 'presence'], u_body: ['bodyAngle', 'shiftX', 'shiftY', 'squash'],
    u_gesture: ['stretch', 'crouch', 'pawSpread', 'mouthOpen'], u_face: ['faceSad', 'faceAngry', 'faceSurprise', 'faceDelighted'],
    u_effect: ['tear', 'blush', 'sweat', 'anger'], u_detail: ['eyeNarrow', 'lookX', 'lookY', 'effectPhase']
  };
  gl.uniform4f = (key, ...values) => {
    uniforms[key] = values;
    packedNames[key]?.forEach((name, index) => { uniforms['u_' + name] = values[index]; });
  };
  gl.texImage2D = (...args) => { if (config.textureFailure) throw new Error('raw private driver detail'); uploads.push(args.at(-1)); };
  gl.drawArrays = (mode, first, count) => { if (config.drawFailure) throw new Error('raw private driver detail'); drawCalls.push({ mode, first, count,part:constants[4],sourceRect:constants[5]?.slice(),mouthMode:constants[6],volume:enabledAttributes.has(7),volumeData:config.captureVolumes&&enabledAttributes.has(7)?new Float32Array(vertexData.get(activeBuffer)):null,texture4:boundTextures[4],texture5:boundTextures[5],texture6:boundTextures[6],buffer:activeBuffer,uniforms:structuredClone(uniforms),frame:clears }); draws++; };
  const canvas = events({ ownerDocument: doc, hidden: true, isConnected: true, width: 240, height: 240,
    clientWidth: config.cssWidth || 320,
    getBoundingClientRect: () => ({ width: config.cssWidth || 320 }),
    getContext: (_, options) => { canvas.contextOptions = options; return config.noWebGL ? null : gl; }
  });
  const api = Motion.mount(canvas, { onError: code => errors.push(code), onReady: () => ready++, ...config.options });
  return { api, canvas, win, doc, media, gl, raf, timers, images, errors, created, deleted, uploads, uniforms, shaders, buffers, attributes, drawCalls, bindings, constants, disabledAttributes, samplers,boundTextures,blend,enabled,hitReads,
    get draws() { return draws; }, get ready() { return ready; }, get released() { return released; },
    get clears(){return clears;},get updates(){return updates;},get liveVertices(){return liveVertices;},get maxActiveUnit(){return maxActiveUnit;},
    complete() { images.forEach((im,i) => { im.complete = true; im.naturalWidth = im.naturalHeight = config.hitPixels||i>=8?1254:1000; im.onload?.(); }); },
    advance(ms = 40) { clock += ms; const callbacks = [...raf.values()]; raf.clear(); callbacks.forEach(fn => fn(clock)); },
    hide(value) { doc.hidden = value; doc.emit('visibilitychange'); },
    reduce(value) { media.matches = value; media.emit('change'); },
    timeout() { const callbacks=[...timers.values()];timers.clear();callbacks.forEach(fn=>fn()); }
  };
}

test('UMD exposes browser API and CommonJS pure helpers without loading assets', () => {
  const sandbox = { window: {} }; vm.runInNewContext(source, sandbox);
  assert.equal(typeof sandbox.window.PetLilacMotion.mount, 'function');
  assert.equal(Motion.sourceType, '2d_image_motion');
  assert.deepEqual(Motion.situations.slice(0, 36), [
    'joy', 'laugh', 'excited', 'proud', 'love', 'grateful', 'sad', 'cry', 'lonely', 'disappointed', 'angry', 'sulky',
    'surprise', 'scared', 'nervous', 'confused', 'curious', 'thinking', 'greeting', 'petted', 'shy', 'embarrassed', 'apology', 'cheer',
    'idle', 'resting', 'sleepy', 'yawn', 'relaxed', 'bored', 'feeding', 'moving', 'caught', 'dance', 'celebrate', 'determined'
  ]);
  assert.equal(Motion.catalogue.length, 100); assert.equal(new Set(Motion.situations).size, 100);
  assert.equal(Object.isFrozen(Motion.catalogue), true);
  const groups = new Map();
  for (const item of Motion.catalogue) {
    assert.equal(Object.isFrozen(item), true); assert.equal(item.durationMs, Motion.durations[item.id]);
    assert.ok(item.label && item.groupLabel && item.face && item.motion);
    assert.ok(Array.isArray(item.keywords) && item.keywords.length >= 2 && item.keywords.every(word => typeof word === 'string' && word.length));
    assert.equal(Object.isFrozen(item.keywords), true);
    assert.ok(['none','hearts','tears','anger','sweat','wonder','sleep','quiet','sparkle'].includes(item.effect));
    groups.set(item.group, (groups.get(item.group) || 0) + 1);
  }
  assert.deepEqual(Object.fromEntries(groups), { happy:17, feeling:16, wonder:16, social:16, calm:16, action:19 });
  assert.equal(Motion.catalogue.find(row => row.id === 'jealous').label, 'うらやましがる');
  assert.equal(Motion.catalogue.find(row => row.id === 'jealous').keywords.includes('envy'), true);
  assert.equal(Motion.catalogue.find(row => row.id === 'affectionate').keywords.includes('adoration'), false);
});

const growthKeys = ['egg', 'baby', 'child', 'final', 'adult', 'companion'];
const bornAppearances=['newborn','baby','toddler','child','juvenile','grown','adult','companion'];

// Independently measured source crown chroma, in 8-bit RGB units. The source
// pixels have alpha > 240, local x .28-.73/y .08-.30, purple fur, and Y 185-205.
// Compare equal-luminance material samples instead of requiring a particular
// renderer coefficient table or confusing the front's cream area with fur.
const measuredFacingCrownChroma=[
  [17.855,25.263],[19.536,31.764],[19.251,35.308],[17.923,41.809],
  [18.151,39.450],[18.265,37.678],[17.450,40.635],[17.205,43.880],
  [16.652,42.994],[16.880,41.820],[17.091,42.108],[16.863,42.706],
  [17.809,39.151],[18.493,37.379],[19.667,33.835],[19.485,30.590]
];
function facingMaterial(chroma,luma){
  const [red,blue]=chroma.map(n=>n/255);
  return [luma+red,luma-(.299*red+.114*blue)/.587,luma+blue];
}
function facingProjectedBounds(matrix,bounds){
  const points=[[bounds.minX,bounds.minY],[bounds.minX,bounds.maxY],[bounds.maxX,bounds.minY],[bounds.maxX,bounds.maxY]]
    .map(([x,y])=>({x:matrix[0]*x+matrix[2]*y+matrix[4],y:matrix[1]*x+matrix[3]*y+matrix[5]}));
  return {height:Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y)),points};
}
function nurseryActualSoles(frame,path='balanced'){
  return ['left','right'].map((side,i)=>{
    const foot=Motion.nurseryFootLandmarks[0][side];
    return Motion.rigPoint(frame,i?'foot_r':'foot_l',foot.x,foot.soleY,'child',path);
  });
}
function touchRigPoint(key,part,x,y,cue='idle',age=0,path='balanced'){
  return Motion.rigPoint(Motion.rigPose(0,cue,age,'child',path,1,key),part,x,y,'child',path);
}
function touchPalmPoint(key,id,cue='idle',age=0,path='balanced'){
  const frame=Motion.handVolumeFrame(0,cue,age,'child',path,1,key),mesh=Motion.handVolumeMesh(frame,id),profile=Motion.handVolumeProfiles[frame.family][id];let best=null;
  for(let at=0;at<mesh.length;at+=27){
    if(mesh[at+8]<.5||Math.min(mesh[at+4],mesh[at+13],mesh[at+22])<.99)continue;
    const u=(mesh[at+2]+mesh[at+11]+mesh[at+20])/3,v=(mesh[at+3]+mesh[at+12]+mesh[at+21])/3,score=Math.hypot(u-profile.center[0],v-profile.center[1]);
    if(!best||score<best.score)best={x:((mesh[at]+mesh[at+9]+mesh[at+18])/3+1)/2,y:(1-(mesh[at+1]+mesh[at+10]+mesh[at+19])/3)/2,score};
  }
  assert.ok(best,'an opaque visible distal palm triangle exists');return best;
}
function touchDirectionAge(index){
  const yaw=index*22.5+.01;let lo=650,hi=6150;
  for(let i=0;i<50;i++){const mid=(lo+hi)/2;if(Motion.directionFrame('direction_spin',mid).yawDeg<yaw)lo=mid;else hi=mid;}
  return (lo+hi)/2;
}
function touchDirectionPoint(key,index,x,y,age,path='balanced'){
  const rig=Motion.rigPose(0,'direction_spin',age/1000,'child',path,1,key),p=Motion.directionPoint(index,x,y,'child',path,key),m=Motion.directionProjection(index,'child',path,rig.matrices.torso,key).matrix;
  return{x:m[0]*p.x+m[2]*p.y+m[4],y:m[1]*p.x+m[3]*p.y+m[5]};
}

test('touch picking tracks the rendered reference face through all born ages and evolution shapes with lazy source alpha',()=>{
  for(const key of bornAppearances)for(const path of Motion.evolutionCatalogue){
    const f=fixture({hitPixels:'png',options:{appearanceKey:key,evolutionPath:path.key}});assert.equal(f.api.hitTest(.5,.5),null);f.complete();assert.equal(f.hitReads.length,0);
    for(const [part,side,x,y]of[['head',null,.55,.24],['cheek','left',.342,.553],['cheek','right',.775,.521]]){
      const p=touchRigPoint(key,'head',x,y,'idle',0,path.key);assert.deepEqual(f.api.hitTest(p.x,p.y),{part,side},key+path.key+': source-local face follows its real rig');
      assert.deepEqual(f.api.hitTest(p.x,p.y),{part,side});
    }
    assert.equal(f.hitReads.length,1,'the already-loaded alpha image is decoded only once per renderer');assert.deepEqual(f.errors,[]);
    f.api.destroy();assert.equal(f.created.length,f.deleted.length);
  }
});

test('touch picking follows opaque animated distal palms, gives foreground hands precedence, and does not use their old canvas positions',()=>{
  const up=.9+1.25/1.85;
  for(const key of bornAppearances.concat(null)){
    const f=fixture({hitPixels:key?'png':undefined,options:{appearanceKey:key}});f.complete();const resources=f.created.length;
    const old={};for(const id of['arm_l','arm_r'])old[id]=touchPalmPoint(key,id);
    f.api.setSituation('body_flap',{elapsedMs:up*1000});
    for(const [id,side]of[['arm_l','left'],['arm_r','right']]){
      const p=touchPalmPoint(key,id,'body_flap',up);
      assert.ok(Math.hypot(p.x-old[id].x,p.y-old[id].y)>.055,'the chosen visible palm has actually moved');
      assert.deepEqual(f.api.hitTest(p.x,p.y),{part:'hand',side},key+id+': the raised palm is picked before the face behind it');
      assert.notEqual(f.api.hitTest(old[id].x,old[id].y)?.part,'hand','the previous resting hand position does not remain clickable');
    }
    assert.equal(f.created.length,resources);assert.equal(f.raf.size,1);f.api.destroy();assert.equal(f.created.length,f.deleted.length);
  }
});

test('touch picking uses each rendered direction mesh and its visible face and paw landmarks, without cheeks on the back',()=>{
  for(const key of['newborn','adult'])for(const path of Motion.evolutionCatalogue){
    const f=fixture({hitPixels:'png',options:{appearanceKey:key,evolutionPath:path.key}});f.complete();let cheeks=0,hands=0;
    for(let index=0;index<16;index++){
      const age=touchDirectionAge(index),view=Motion.nurseryDirectionViews[index];f.api.setSituation('direction_spin',{elapsedMs:age});
      assert.equal(Motion.directionFrame('direction_spin',age).currentIndex,index);assert.equal(Motion.directionFrame('direction_spin',age).blend,0);
      const crown=touchDirectionPoint(key,index,view.headX,.25,age,path.key);assert.deepEqual(f.api.hitTest(crown.x,crown.y),{part:'head',side:null},key+path.key+index+': visible rear and side heads follow the painted atlas');
      if(index>=6&&index<=11){const back=touchDirectionPoint(key,index,view.headX,.55,age,path.key);assert.notEqual(f.api.hitTest(back.x,back.y)?.part,'cheek','hidden cheeks are not recreated on the back');}
      for(let eye=0;eye<4;eye+=2)if(view.eyes[eye]>=0&&index){
        const sign=view.eyes[eye]<view.headX?-1:1,x=view.eyes[eye]+sign*Math.min(.10,view.eyeRadii[eye]*.7),y=view.eyes[eye+1]+view.eyeRadii[eye+1]*.96,uv=Motion.directionCellUV(index,x,y,1254,1254,key);
        if(pngPixel('pet_lilac_baby_turnaround_v1.png',uv.x,uv.y)[3]<=128)continue;
        const p=touchDirectionPoint(key,index,x,y,age,path.key);assert.deepEqual(f.api.hitTest(p.x,p.y),{part:'cheek',side:sign<0?'left':'right'},key+index+': visible cheek');cheeks++;
      }
      for(let hand=0;hand<4;hand+=2)if(view.paws[hand]>=0){
        const x=view.paws[hand],y=view.paws[hand+1],uv=index?Motion.directionCellUV(index,x,y,1254,1254,key):{x,y};
        if(pngPixel(index?'pet_lilac_baby_turnaround_v1.png':'pet_lilac_reference_v2.png',uv.x,uv.y)[3]<=128)continue;
        const p=touchDirectionPoint(key,index,x,y,age,path.key);assert.deepEqual(f.api.hitTest(p.x,p.y),{part:'hand',side:hand?'right':'left'},key+index+': only a visible source paw reacts');hands++;
      }
    }
    assert.ok(cheeks>=5&&hands>=8);assert.equal(f.hitReads.filter(n=>n==='pet_lilac_baby_turnaround_v1.png').length,1);f.api.destroy();assert.equal(f.created.length,f.deleted.length);
  }
});

test('source-switch touch picking reads only the visible view alpha, including the front wrap boundary',()=>{
  for(const key of ['newborn','adult'])for(const yaw of [11.24,11.26,348.74,348.76]){
    let lo=650,hi=6150;
    for(let i=0;i<50;i++){const mid=(lo+hi)/2;if(Motion.directionFrame('direction_spin',mid).yawDeg<yaw)lo=mid;else hi=mid;}
    const age=(lo+hi)/2,frame=Motion.directionFrame('direction_spin',age),index=frame.blend<.5?frame.currentIndex:frame.nextIndex,view=Motion.nurseryDirectionViews[index];
    const f=fixture({hitPixels:'png',options:{appearanceKey:key}});f.complete();
    // Cache both adjacent meshes first, so a stale hidden mesh could be picked.
    for(const neighbour of [frame.currentIndex,frame.nextIndex])f.api.setSituation('direction_spin',{elapsedMs:touchDirectionAge(neighbour)});
    f.api.setSituation('direction_spin',{elapsedMs:age});
    const crown=touchDirectionPoint(key,index,view.headX,.25,age);
    assert.deepEqual(f.api.hitTest(crown.x,crown.y),{part:'head',side:null});
    for(let y=.08;y<.96;y+=.055)for(let x=.08;x<.96;x+=.055)f.api.hitTest(x,y);
    assert.deepEqual(f.hitReads,[index?'pet_lilac_baby_turnaround_v1.png':'pet_lilac_reference_v2.png'],'invisible adjacent view is never eligible for a touch');
    f.api.destroy();assert.equal(f.created.length,f.deleted.length);
  }
});

test('touch picking rejects transparent cutout pixels and noninteractive body rather than accepting a head bounding box',()=>{
  const key='grown',f=fixture({hitPixels:'png',options:{appearanceKey:key}});f.complete();const head=f.drawCalls.find(c=>c.part===6),data=f.liveVertices;let transparent;
  for(let v=head.first;v<head.first+head.count;v+=3){
    const at=v*5,u=(data[at+2]+data[at+7]+data[at+12])/3,y=(data[at+3]+data[at+8]+data[at+13])/3;
    if(y>.30||pngPixel('pet_lilac_reference_v2.png',u,y)[3]>8)continue;
    transparent={x:((data[at]+data[at+5]+data[at+10])/3+1)/2,y:(1-(data[at+1]+data[at+6]+data[at+11])/3)/2};break;
  }
  assert.ok(transparent,'a real transparent crown pixel lies inside the drawn source polygon');assert.equal(f.api.hitTest(transparent.x,transparent.y),null);
  const belly=touchRigPoint(key,'torso',.55,.81);assert.equal(f.api.hitTest(belly.x,belly.y),null);
  for(const [x,y]of[[0,0],[1,1],[-.01,.5],[.5,1.01],[NaN,.5],[.5,Infinity]])assert.equal(f.api.hitTest(x,y),null);
  f.api.destroy();
});

test('touch picking stays tied to the last successful paint, with unloaded, hidden, detached, failed and destroyed guards',()=>{
  let now=0;const key='adult',f=fixture({hitPixels:'png',options:{appearanceKey:key,now:()=>now}});assert.equal(f.api.hitTest(.5,.5),null);f.complete();const up=.9+1.25/1.85;
  f.api.setSituation('body_flap',{elapsedMs:up*1000});const palm=touchPalmPoint(key,'arm_r','body_flap',up);assert.equal(f.api.hitTest(palm.x,palm.y)?.part,'hand');
  now=30000;assert.equal(f.api.hitTest(palm.x,palm.y)?.part,'hand','an event between frames uses the visible hand, not a future pose');f.advance(0);assert.notEqual(f.api.hitTest(palm.x,palm.y)?.part,'hand');
  const p=touchRigPoint(key,'head',.55,.24);assert.equal(f.api.hitTest(p.x,p.y)?.part,'head');
  f.canvas.hidden=true;assert.equal(f.api.hitTest(p.x,p.y),null);f.canvas.hidden=false;f.canvas.isConnected=false;assert.equal(f.api.hitTest(p.x,p.y),null);f.canvas.isConnected=true;
  f.hide(true);assert.equal(f.api.hitTest(p.x,p.y),null);f.hide(false);f.win.emit('pagehide');assert.equal(f.api.hitTest(p.x,p.y),null);f.win.emit('pageshow');assert.equal(f.api.hitTest(p.x,p.y)?.part,'head');
  f.api.destroy();assert.equal(f.api.hitTest(p.x,p.y),null);assert.equal(f.created.length,f.deleted.length);
  const blocked=fixture({hitPixels:'blocked',options:{appearanceKey:key}});blocked.complete();assert.equal(blocked.api.hitTest(p.x,p.y),null);assert.equal(blocked.api.hitTest(p.x,p.y),null);assert.equal(blocked.hitReads.length,1);assert.deepEqual(blocked.errors,[]);blocked.api.destroy();
});

test('reduced visible poses retain touch picking while egg shells never gain a head or hand reaction',()=>{
  const f=fixture({hitPixels:'png',reduced:true,options:{appearanceKey:'adult'}});f.complete();const p=touchRigPoint('adult','head',.342,.553);assert.deepEqual(f.api.hitTest(p.x,p.y),{part:'cheek',side:'left'});assert.equal(f.raf.size,0);
  f.api.destroy();assert.equal(f.created.length,f.deleted.length);
  for(const key of['egg','egg_cracked','hatching']){const egg=fixture({hitPixels:'png',options:{appearanceKey:key}});egg.complete();for(const [x,y]of[[.5,.5],[.45,.8],[.7,.85]])assert.equal(egg.api.hitTest(x,y),null);assert.equal(egg.hitReads.length,0);egg.api.destroy();assert.equal(egg.created.length,egg.deleted.length);}
});

test('nursery lower-body anchors identify actual opaque toe lobes in every measured source view',()=>{
  assert.equal(Motion.nurseryFootLandmarks.length,16);assert.equal(Object.isFrozen(Motion.nurseryFootLandmarks),true);
  for(let index=0;index<16;index++){
    const feet=Motion.nurseryFootLandmarks[index];assert.equal(Object.isFrozen(feet),true);assert.ok(feet.left.x<feet.right.x);
    for(const foot of Object.values(feet)){
      assert.equal(Object.isFrozen(foot),true);assert.ok(foot.minX<foot.x&&foot.x<foot.maxX&&foot.y<foot.soleY&&foot.soleY<1);
      const uv=index?Motion.directionCellUV(index,foot.x,foot.y,1254,1254,'grown'):{x:foot.x,y:foot.y};
      assert.ok(pngPixel(index?'pet_lilac_baby_turnaround_v1.png':'pet_lilac_reference_v2.png',uv.x,uv.y)[3]>128,index+': the moving toe is present in its own source image');
    }
  }
  assert.ok(Math.abs(Motion.nurseryFootLandmarks[0].left.soleY-1164/1254)<.000001);
  assert.ok(Math.abs(Motion.nurseryFootLandmarks[0].right.soleY-1161/1254)<.000001);
});

test('nursery idle visibly transfers weight and occasionally lifts real feet without losing a planted sole',()=>{
  for(const key of bornAppearances)for(const path of Motion.evolutionCatalogue){
    const soles=[[],[]],hip=[];
    for(let tick=0;tick<=120;tick++){
      const frame=Motion.rigPose(tick/10,'idle',0,'child',path.key,1,key),feet=nurseryActualSoles(frame,path.key);
      feet.forEach((p,i)=>soles[i].push(p.y));assert.ok(Math.abs(Math.max(...feet.map(p=>p.y))-.92)<1e-10,key+path.key+': a support foot remains grounded');
      const low=Motion.rigPoint(frame,'torso',.46,.89,'child',path.key),chest=Motion.rigPoint(frame,'torso',.55,.75,'child',path.key);hip.push(low.y-chest.y);
    }
    for(const values of soles)assert.ok(Math.max(...values)-Math.min(...values)>.004,key+path.key+': visible motion replaces the former fixed foot');
    assert.ok(Math.max(...hip)-Math.min(...hip)>.001,key+path.key+': lower torso moves relative to the chest');
  }
});

test('nursery footwork alternates the actual sole contacts at every age and fur path',()=>{
  for(const key of bornAppearances)for(const path of Motion.evolutionCatalogue){
    const phases=[1.25/.85,1.75/.85].map(age=>Motion.rigPose(0,'body_feet',age,'child',path.key,1,key));
    for(const [i,frame]of phases.entries()){
      const feet=nurseryActualSoles(frame,path.key),swing=i===0?0:1,stance=1-swing;
      assert.ok(Math.abs(feet[stance].y-.92)<1e-10,key+path.key+': actual stance sole is pinned');
      assert.ok(feet[stance].y-feet[swing].y>.02,key+path.key+': the swing foot clears the floor visibly');
      assert.ok(frame.lowerBody&&Math.abs(frame.lowerBody.step)>.99);assert.equal(frame.angles.arm_l,0);assert.equal(frame.angles.arm_r,0);
    }
  }
});

test('nursery joy, anger, sadness, sleep and meals have distinct grounded leg acting and settle softly',()=>{
  const cues=['joy','angry','sad','deep_sleep','feeding'];
  for(const key of bornAppearances)for(const path of Motion.evolutionCatalogue){
    const signatures=new Set();
    for(const cue of cues){
      const frames=[1.1,1.8,2.2,5.1].filter(age=>age<Motion.durations[cue]/1000).map(age=>Motion.rigPose(0,cue,age,'child',path.key,1,key));
      signatures.add(JSON.stringify(frames.map(f=>Object.values(f.lowerBody).map(n=>n.toFixed(4)))));
      for(const frame of frames){
        const feet=nurseryActualSoles(frame,path.key);assert.ok(feet.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.y<=.92+1e-10));
        if(frame.pose.bounce<1e-12)assert.ok(Math.abs(Math.max(...feet.map(p=>p.y))-.92)<1e-10,key+cue+': nonjumping acting has a support foot');
      }
      if(cue==='deep_sleep')assert.ok(frames.every(f=>Math.abs(f.lowerBody.step)<1e-12),'sleep bends quietly without stepping');
      const duration=Motion.durations[cue]/1000,idle=Motion.rigPose(2.7,'idle',0,'child',path.key,1,key);
      for(const age of[0,duration-.00001,duration]){
        const frame=Motion.rigPose(2.7,cue,age,'child',path.key,1,key);
        for(const [id,x,y]of[['torso',.46,.89],['torso',.55,.75],['head',.55,.45]]){
          const a=Motion.rigPoint(frame,id,x,y,'child',path.key),b=Motion.rigPoint(idle,id,x,y,'child',path.key);
          assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<.00001,key+cue+': cue entry/release returns to the running idle body');
        }
        nurseryActualSoles(frame,path.key).forEach((p,i)=>{const q=nurseryActualSoles(idle,path.key)[i];assert.ok(Math.hypot(p.x-q.x,p.y-q.y)<.00001);});
      }
    }
    assert.equal(signatures.size,cues.length,'different feelings retain different knee and foot timing');
  }
});

test('nursery lower-body fields stay continuous across angry threshold crossings and meal phase boundaries',()=>{
  const threshold=Math.asin(.1/.8),angry=[(4*Math.PI+threshold)/(Math.PI*2*1.7),(5*Math.PI+threshold)/(Math.PI*2*1.7)];
  for(const key of bornAppearances)for(const path of Motion.evolutionCatalogue)for(const [cue,at]of[...angry.map(at=>['angry',at]),['feeding',4.4],['feeding',7.2]]){
    const [a,b]=[-.000001,.000001].map(delta=>Motion.rigPose(2.7,cue,at+delta,'child',path.key,1,key));
    for(const field of Object.keys(a.lowerBody))assert.ok(Math.abs(a.lowerBody[field]-b.lowerBody[field])<.0001,key+cue+field+': no branch jump');
    for(const [id,x,y]of[['torso',.46,.89],['torso',.64,.88],['head',.55,.45]]){
      const p=Motion.rigPoint(a,id,x,y,'child',path.key),q=Motion.rigPoint(b,id,x,y,'child',path.key);assert.ok(Math.hypot(p.x-q.x,p.y-q.y)<.0001);
    }
    nurseryActualSoles(a,path.key).forEach((p,i)=>{const q=nurseryActualSoles(b,path.key)[i];assert.ok(Math.hypot(p.x-q.x,p.y-q.y)<.0001);});
  }
});

test('nursery knee deformation is continuous and unfolded while the face has no local lower-body warp',()=>{
  for(const key of bornAppearances)for(const path of Motion.evolutionCatalogue)for(const [cue,age]of[['body_feet',1.25/.85],['body_feet',1.75/.85],['joy',1.1],['angry',1.8],['sad',1.8],['deep_sleep',2.2],['feeding',5.1]]){
    const frame=Motion.rigPose(0,cue,age,'child',path.key,1,key),plain={...frame,lowerBody:null};
    for(const [x,y]of[[.44318,.43534],[.68435,.40677],[.58051,.52638]])assert.deepEqual(Motion.rigPoint(frame,'head',x,y,'child',path.key),Motion.rigPoint(plain,'head',x,y,'child',path.key));
    assert.deepEqual(Motion.rigPoint(frame,'torso',.55,.70,'child',path.key),Motion.rigPoint(plain,'torso',.55,.70,'child',path.key),'upper torso keeps the same local shape');
    const point=(x,y)=>Motion.rigPoint(frame,'torso',.33+x/16*.42,.76+y/12*.185,'child',path.key);
    for(let y=0;y<12;y++)for(let x=0;x<16;x++){
      const a=point(x,y),b=point(x,y+1),c=point(x+1,y),d=point(x+1,y+1);
      for(const [u,v,w]of[[a,b,c],[c,b,d]])assert.ok((v.x-u.x)*(w.y-u.y)-(v.y-u.y)*(w.x-u.x)<-1e-10,key+path.key+cue+': no folded knee/hip cells');
    }
  }
});

test('actual nursery uploads articulate lower torso and feet while retaining UVs, clothing, material resources and one frame loop',()=>{
  for(const key of bornAppearances){
    const f=fixture({options:{appearanceKey:key,evolutionPath:'fruit',outfit:'cloth_star_pajamas'}});f.complete();const resources=f.created.length;
    const age=1.25/.85;f.api.setSituation('body_feet',{elapsedMs:age*1000});const a=new Float32Array(f.liveVertices),calls=f.drawCalls.slice(-9),frame=Motion.rigPose(0,'body_feet',age,'child','fruit',1,key);
    let deformed=0;
    for(const call of calls.filter(c=>c.part===1))for(let v=call.first;v<call.first+call.count;v++){
      const at=v*5,x=a[at+2],y=a[at+3],p=Motion.rigPoint(frame,'torso',x,y,'child','fruit'),plain=Motion.rigPoint({...frame,lowerBody:null},'torso',x,y,'child','fruit');
      assert.ok(Math.abs(a[at]-(p.x*2-1))<.000002&&Math.abs(a[at+1]-(1-p.y*2))<.000002,'uploaded torso follows the tested continuous leg field');
      if(y>.84&&Math.hypot(p.x-plain.x,p.y-plain.y)>.003)deformed++;
    }
    assert.ok(deformed>5,key+': lower torso has real independently moving vertices');
    f.api.setSituation('body_feet',{elapsedMs:1.75/.85*1000});const b=f.liveVertices;assert.equal(a.length,b.length);
    for(let at=0;at<a.length;at+=5){assert.equal(a[at+2],b[at+2]);assert.equal(a[at+3],b[at+3]);assert.equal(a[at+4],b[at+4]);}
    assert.equal(Math.floor(f.uniforms.u_anger/2),5);assert.equal(f.created.length,resources);assert.equal(f.maxActiveUnit,7);assert.equal(f.raf.size,1);
    f.api.destroy();assert.equal(f.created.length,f.deleted.length);assert.equal(f.raf.size,0);assert.equal(f.timers.size,0);
  }
});

test('reduced motion keeps the nursery lower body neutral and releases every existing resource',()=>{
  for(const key of bornAppearances){
    const f=fixture({reduced:true,options:{appearanceKey:key}});f.complete();const neutral=new Float32Array(f.liveVertices),resources=f.created.length;
    for(const cue of['body_feet','joy','angry','sad','deep_sleep','feeding']){
      f.api.setSituation(cue,{elapsedMs:1800});assert.deepEqual(f.liveVertices,neutral);assert.equal(f.raf.size,0);assert.equal(f.timers.size,0);assert.equal(f.created.length,resources);
    }
    f.api.destroy();assert.equal(f.created.length,f.deleted.length);assert.equal(f.raf.size,0);assert.equal(f.timers.size,0);
  }
});

test('all born directions match the reference fur chroma without flattening its light and shade',()=>{
  for(const key of bornAppearances)for(let index=0;index<16;index++)for(const luma of [.40,.60,.76]){
    const material=facingMaterial(measuredFacingCrownChroma[index],luma);
    const reference=facingMaterial(measuredFacingCrownChroma[0],luma);
    const color=Motion.directionFurColor(index,'balanced',.5,.15,material,key);
    assert.ok(color.every((n,i)=>Number.isFinite(n)&&n>=0&&n<=1&&Math.abs(n-reference[i])<.0006),key+index+': the measured fur material matches the canonical front');
    assert.ok(Math.abs(.299*color[0]+.587*color[1]+.114*color[2]-luma)<1e-10,key+index+': baked luminance is retained');
    if(index===0)assert.deepEqual(color,material,'the selected canonical front remains exact');
  }
});

test('facing fur calibration protects cream, each real eye and mouth, legacy material, and all six evolution palettes',()=>{
  const purple=[.72,.53,.83],cream=[.96,.89,.78];
  for(const key of bornAppearances)for(const view of Motion.nurseryDirectionViews){
    const palettes=new Set();
    for(const path of Motion.evolutionCatalogue){
      const color=Motion.directionFurColor(view.index,path.key,.5,.15,purple,key);
      assert.ok(color.every(n=>Number.isFinite(n)&&n>=0&&n<=1));palettes.add(color.map(n=>n.toFixed(4)).join(','));
      assert.deepEqual(Motion.directionFurColor(view.index,path.key,.5,.75,cream,key),cream,key+view.index+': cream is unchanged');
      for(let eye=0;eye<4;eye+=2)if(view.eyes[eye]>=0)
        assert.deepEqual(Motion.directionFurColor(view.index,path.key,view.eyes[eye],view.eyes[eye+1],purple,key),purple,key+view.index+': eye material is protected');
      if(view.mouth[0]>=0)assert.deepEqual(Motion.directionFurColor(view.index,path.key,view.mouth[0],view.mouth[1],purple,key),purple,key+view.index+': mouth material is protected');
    }
    assert.equal(palettes.size,6,key+view.index+': all evolution colors still differ');
  }
  for(let index=0;index<16;index++)for(const luma of [.40,.60,.76]){
    const material=facingMaterial(measuredFacingCrownChroma[index],luma);
    assert.deepEqual(Motion.directionFurColor(index,'balanced',.5,.15,material),material,'the retained legacy family is not recalibrated');
  }
});

test('all 8x6x16 born silhouettes share the frontal height and stay grounded at the normal room size',()=>{
  for(const key of bornAppearances)for(const path of Motion.evolutionCatalogue){
    const idle=Motion.rigPose(0,'idle',0,'child',path.key,1,key);
    const front=Motion.directionProjection(0,'child',path.key,idle.matrices.torso,key);
    const frontHeight=facingProjectedBounds(idle.matrices.torso,front.bounds).height;
    const walk=Motion.roomWalkFrame('room_walk_right',1500);
    for(let index=0;index<16;index++){
      const projection=Motion.directionProjection(index,'child',path.key,idle.matrices.torso,key);
      const roomProjection=Motion.directionProjection(index,'child',path.key,idle.matrices.torso,key,walk);
      const expectedHeight=front.bounds.maxY-front.bounds.minY;
      assert.ok(Math.abs(projection.bounds.maxY-projection.bounds.minY-expectedHeight)<1e-10,key+path.key+index+': no source-direction height jump');
      for(const fit of [projection,roomProjection]){
        assert.ok(Math.abs(fit.fitScale-1)<1e-10,key+path.key+index+': neutral views share the same pre-reserved camera fit');
        assert.ok(Math.abs(facingProjectedBounds(fit.matrix,projection.bounds).height-frontHeight)<1e-10,key+path.key+index+': room and turning keep the frontal size');
        for(const p of facingProjectedBounds(fit.matrix,fit.bounds).points)
          assert.ok(p.x>=.012-1e-9&&p.x<=.988+1e-9&&p.y>=.018-1e-9&&p.y<=.96+1e-9,key+path.key+index+': shared fit retains its clip margin');
        assert.ok(Math.abs(fit.matrix[3]*.92+fit.matrix[5]-.92)<1e-10,'the shared camera remains anchored at the floor');
      }
    }
  }
});

test('direction anticipation and room walking never shrink the neutral frontal body before yaw starts',()=>{
  for(const key of bornAppearances)for(const path of Motion.evolutionCatalogue){
    const idle=Motion.rigPose(0,'idle',0,'child',path.key,1,key);
    for(const cue of Motion.directionCatalogue){
      assert.equal(Motion.directionFrame(cue.id,600).front,true);
      for(const age of [.45,.60,2.8]){
        const turn=Motion.rigPose(0,cue.id,age,'child',path.key,1,key);
        turn.matrices.torso.forEach((n,i)=>assert.ok(Math.abs(n-idle.matrices.torso[i])<1e-10,key+path.key+cue.id+': yaw is not a body-scale animation'));
      }
    }
    for(const cue of ['room_walk_left','room_walk_right']){
      const room=Motion.rigPose(0,cue,1.5,'child',path.key,1,key);
      room.matrices.torso.forEach((n,i)=>assert.ok(Math.abs(n-idle.matrices.torso[i])<1e-10,key+path.key+cue+': room travel shares the frontal presentation scale'));
    }
  }
});

test('eleven read-only appearances separate real eggs and the selected reference family from the unchanged canonical six milestones',()=>{
  assert.deepEqual(Motion.appearanceCatalogue.map(row=>[row.key,row.min]),[['egg',0],['egg_cracked',5],['hatching',10],['newborn',15],['baby',30],['toddler',45],['child',75],['juvenile',110],['grown',200],['adult',400],['companion',800]]);
  for(const row of Motion.appearanceCatalogue){assert.equal(Object.isFrozen(row),true);assert.equal(Motion.appearanceProfile(row.key),row);assert.ok(row.stillAsset);assert.equal(Object.isFrozen(Motion.appearanceAssets(row.key)),true);}
  for(const key of['egg','egg_cracked','hatching']){const p=Motion.appearanceProfile(key);assert.equal(p.family,'egg');assert.equal(p.stillRect.length,4);assert.equal(Object.isFrozen(p.stillRect),true);assert.equal(Motion.feedingAnchor('egg','balanced',key).foodVisible,false);}
  for(const key of bornAppearances){
    const profile=Motion.appearanceProfile(key),files=Motion.appearanceAssets(key);
    assert.equal(profile.family,'baby');assert.equal(profile.stillBaseAsset,'pet_lilac_reference_v2.png');assert.equal(profile.stillAsset,profile.stillBaseAsset);
    assert.equal(files.length,8);assert.equal(files[0],profile.stillBaseAsset);assert.equal(files[3],profile.stillAsset);
    assert.deepEqual(files.slice(1,3),['pet_lilac_baby_expressions_v1.png','pet_lilac_baby_turnaround_v1.png']);
    assert.deepEqual(files.slice(4,6),['pet_lilac_tooth_baby_expressions_v1.png','pet_lilac_tooth_baby_turnaround_v1.png']);
  }
  assert.deepEqual(bornAppearances.map(key=>Motion.appearanceProfile(key).overallScale),[.62,.72,.81,.90,.96,1,1.04,1.07]);
  assert.deepEqual(bornAppearances.map(key=>Motion.appearanceProfile(key).visualAge),[0,.2,.4,.6,.8,1,1.08,1.16]);
  for(const key of[null,'unknown','__proto__'])assert.equal(Motion.appearanceProfile(key).family,'mature');
  assert.deepEqual(growthKeys.map(key=>Motion.growthProfile(key).key),growthKeys);
});

test('selected reference is a square PNG and every born age grows gradually without losing its fixed floor',()=>{
  const bytes=fs.readFileSync(require.resolve('../static/pet_lilac_reference_v2.png'));
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(bytes.readUInt32BE(16),1254);assert.equal(bytes.readUInt32BE(20),1254);
  const front=new Set(),side=new Set();let previousScale=0;
  for(const key of bornAppearances){
    const profile=Motion.appearanceProfile(key);assert.ok(Number.isFinite(profile.visualAge)&&profile.visualAge>=0&&profile.visualAge<=1.16);assert.ok(profile.overallScale>previousScale);previousScale=profile.overallScale;
    front.add(JSON.stringify(Motion.appearancePoint(key,.71,.79,'balanced')));side.add(JSON.stringify(Motion.directionPoint(4,.71,.79,'child','balanced',key)));
    for(const path of Motion.evolutionCatalogue){
      assert.equal(Motion.appearancePoint(key,.5,Motion.nurseryLandmarks.floor,path.key).y,.92);
      for(let index=0;index<16;index++)assert.ok(Math.abs(Motion.directionPoint(index,.5,Motion.nurseryDirectionViews[index].groundY,'child',path.key,key).y-.92)<1e-12);
    }
  }
  assert.equal(front.size,8);assert.equal(side.size,8);
});

test('each family loads only its own required textures and never samples an adult asset in the nursery',()=>{
  for(const key of Motion.appearanceCatalogue.map(row=>row.key)){
    const family=Motion.appearanceProfile(key).family,f=fixture({options:{appearanceKey:key}});f.complete();assert.deepEqual(f.errors,[],key);assert.equal(f.ready,1,key);
    const count=family==='egg'?2:family==='baby'?8:15;assert.equal(f.images.length,count);assert.equal(f.uploads.length,count);assert.equal(f.created.filter(row=>row.type==='Texture').length,count);
    assert.deepEqual(f.images.map(row=>row.url),Motion.appearanceAssets(key).map(name=>'/static/'+name));assert.equal(f.draws,family==='egg'?1:9);assert.equal(f.maxActiveUnit,7);
    assert.equal(Object.keys(f.samplers).length,8);assert.equal(Object.keys(f.uniforms).filter(key=>/^u_(motion[A-C]|body|gesture|face|effect|detail)$/.test(key)).length,family==='egg'?1:8);
    if(family!=='egg')assert.deepEqual(f.bindings.at(-1),[7,'a_handVolume']);
    f.api.destroy();assert.equal(f.created.length,f.deleted.length,key);assert.equal(f.raf.size,0);assert.equal(f.timers.size,0);
  }
});

test('all eight legacy and registered expression mouth donors exist as aligned square PNG materials, including the separate closed sleep smile',()=>{
  const files=[...new Set([null,'newborn','hatching'].flatMap(key=>Motion.appearanceAssets(key)).filter(name=>name.startsWith('pet_lilac_tooth_')))];
  assert.equal(files.length,8);assert.ok(files.includes('pet_lilac_tooth_sleep_v1.png'));
  for(const name of files){const bytes=fs.readFileSync(require.resolve('../static/'+name));assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a',name);assert.equal(bytes.readUInt32BE(16),1254,name);assert.equal(bytes.readUInt32BE(20),1254,name);}
});

test('nursery facial registration maps the actual new eyes and nose into each independent expression cell',()=>{
  const sourceEyes=[[.4431803679,.435337801],[.6843505769,.4067696169]],nose=[.57697,.48134];
  const expected={0:[[.421676804,.470586115],[.683406799,.446380506],[.55618,.52681]],3:[[.413877404,.468511330],[.679477371,.444298213],[.55256,.52543]],4:[[.401685561,.472800731],[.663248021,.456263035],[.53496,.52700]]};
  assert.equal(Motion.nurseryFaceMaps.length,9);
  for(const [key,points]of Object.entries(expected)){const cell=Number(key);for(let i=0;i<3;i++){const input=i<2?sourceEyes[i]:nose,p=Motion.nurseryFaceUV(cell,...input);assert.ok(Math.abs(p.x-(cell%3+points[i][0])/3)<.00002);assert.ok(Math.abs(p.y-(Math.floor(cell/3)+points[i][1])/3)<.00002);}}
  for(const row of Motion.nurseryFaceMaps){assert.equal(Object.isFrozen(row.matrix),true);assert.equal(Object.isFrozen(row.sourceRect),true);for(const [x,y]of[[0,0],[.5,.5],[1,1]]){const p=Motion.nurseryFaceUV(row.cell,x,y);assert.ok(p.x>=row.sourceRect[0]&&p.x<=row.sourceRect[2]&&p.y>=row.sourceRect[1]&&p.y<=row.sourceRect[3]);}}
  assert.ok(Motion.nurseryFaceUV(7,.55,.67).y>2/3+.65/3,'cleanplate samples below its own chin');
});

test('the smile borrows eyes and mouth without painting a second cheek, chin or brow outline',()=>{
  for(const [x,y] of [[.32,.60],[.37,.63],[.50,.645],[.70,.63],[.79,.58],[.29,.50],[.82,.51],[.55,.24],[.417,.302],[.682,.274]]){
    assert.ok(pngPixel('pet_lilac_reference_v2.png',x,y)[3]>240,'protected original fur is opaque');
    assert.equal(Motion.nurserySmileCoverage(x,y),0,'the original outline and brows stay owned by B');
  }
  for(const point of [[.44318,.43534],[.68435,.40677],[.58051,.55]])assert.equal(Motion.nurserySmileCoverage(...point),1);
  for(const bad of [NaN,Infinity,undefined,'0.5'])assert.equal(Motion.nurserySmileCoverage(bad,.5),0);
});

test('registered smile material fully covers real old pupils and the outer lash that previously remained as a second black line',()=>{
  // These are opaque dark pixels in the original image, including its outer lash.
  for(const [px,py] of [[445,593],[550,552],[855,510]]){
    const x=px/1253,y=py/1253,old=pngPixel('pet_lilac_reference_v2.png',x,y),uv=Motion.nurseryFaceUV(6,x,y);
    const donor=pngPixel('pet_lilac_baby_expressions_v1.png',uv.x,uv.y);
    assert.ok(Math.max(...old.slice(0,3))<180&&old[3]>250,'the probe is an actual old eye/lash');
    assert.equal(Motion.nurserySmileCoverage(x,y),1,'old eye pixels cannot survive a feathered mask');
    assert.ok(donor[3]>=252,'replacement comes from the opaque registered smile');
  }
  const f=fixture({options:{appearanceKey:'adult'}});f.complete();
  assert.match(f.shaders[1],/float donorEye=eyePaintMask/,'fur rejection uses the same final-UV paint mask that owns the entire real eye and outer lash');
  f.api.destroy();
});

test('smiles switch one opaque expression at a closed blink while body cue easing remains continuous',()=>{
  for(const cue of ['laugh','joy','feeding','petted','celebrate','body_flap']){
    const duration=Motion.durations[cue];let seenNeutral=false,seenSmile=false;
    for(let ms=0;ms<=duration;ms+=20){
      const pose=Motion.pose(0,cue,ms/1000,'adult'),phase=Motion.nurserySmilePhase(pose.presence,pose.faceDelighted>Math.max(pose.faceSad,pose.faceAngry,pose.faceSurprise));
      assert.ok(phase.weight===0||phase.weight===1,'no original-pupil/smile RGB crossfade');
      assert.ok(phase.blink>=0&&phase.blink<=1);if(phase.weight)seenSmile=true;else seenNeutral=true;
    }
    assert.ok(seenNeutral&&seenSmile,cue+' enters and releases the smile');
  }
  assert.ok(Motion.nurserySmilePhase(.499,true).blink>.99);
  assert.deepEqual(Motion.nurserySmilePhase(.5,true),{weight:1,blink:0});
  assert.deepEqual(Motion.nurserySmilePhase(.5,false),{weight:0,blink:0});
});

test('D mouth fallback descriptors retain old alpha bases and cannot repaint eyes, nose, paws or mouthless eggs',()=>{
  for(const key of Motion.appearanceCatalogue.map(row=>row.key).concat(null)){
    const p=Motion.appearanceProfile(key),m=p.stillMouthMask;
    assert.ok(p.stillBaseAsset&&!p.stillBaseAsset.includes('tooth'));
    assert.match(p.stillAsset,p.family==='baby'?/^pet_lilac_reference_v2\.png$/:/^pet_lilac_tooth_/);
    if(key==='egg'||key==='egg_cracked'){assert.equal(m,null);assert.equal(Motion.toothMouthRegion(key),null);assert.equal(Motion.toothMouthCoverage(key,.295,.712),0);continue;}
    assert.equal(Object.isFrozen(m),true);assert.ok(Motion.toothMouthCoverage(key,m.x,m.y)>.99);
    const points=p.family==='baby'?[[.44318,.43534],[.68435,.40677],[.57697,.48134],[.376,.75],[.73,.75],[.5,.85]]:
      p.family==='egg'?[[.238,.661],[.339,.653],[.293,.683],[.25,.75],[.41,.88]]:[[.4665,.429],[.7281,.3405],[.621,.453],[.527,.743],[.718,.729],[.56,.82]];
    for(const point of points)assert.equal(Motion.toothMouthCoverage(key,...point),0,key+point);
    for(const bad of [NaN,Infinity,undefined,'0.6'])assert.equal(Motion.toothMouthCoverage(key,bad,m.y),0);
    const mutable=Motion.toothMouthRegion(key);mutable.center[0]=99;assert.equal(Motion.toothMouthRegion(key).center[0],m.x);
  }
  for(const [x,y]of [[.625,.465],[.636,.476],[.635,.493]])assert.ok(Motion.toothMouthCoverage(null,x,y)>.99,'actual delighted, surprise and default front teeth remain fully inside the patch');
  assert.ok(Motion.toothMouthCoverage('newborn',.58,.56)>.99,'baby opening bottom is retained');
});

test('D donor selection follows the actual dominant face, keeps closed sadness and anger, and leaves sleep teeth hidden',()=>{
  for(const key of bornAppearances.concat(null)){
    const baby=Motion.appearanceProfile(key).family==='baby';
    for(let winner=0;winner<=4;winner++){
      const p={faceSad:0,faceAngry:0,faceSurprise:0,faceDelighted:0};if(winner)p[['faceSad','faceAngry','faceSurprise','faceDelighted'][winner-1]]=1;
      const binding=Motion.toothFaceBinding(p,'idle',key);assert.equal(binding.winner,winner);assert.equal(binding.closed,false);
      assert.equal(binding.oldFaceAsset,baby?(winner?1:0):(winner?winner+3:0));assert.equal(binding.defaultMouthAsset,baby?3:10);
      assert.equal(binding.expressionMouthAsset,baby?(winner>=3?4:1):[0,4,5,11,12][winner]);
    }
    assert.equal(Motion.toothFaceBinding({faceSad:.6,faceAngry:.6,faceDelighted:.5},'idle',key).winner,1,'strict tie order agrees with the GPU');
    for(const cue of ['resting','sleepy','deep_sleep']){const binding=Motion.toothFaceBinding({},cue,key);assert.equal(binding.closed,true);assert.equal(binding.expressionMouthAsset,baby?1:14);}
    for(const cue of ['idle','sad','angry','surprise','feeding'])assert.equal(Motion.toothFaceBinding({},cue,key).closed,false);
  }
});

test('all 100 real face draws select registered old expressions and only borrow new mouth samplers on the head',()=>{
  for(const key of bornAppearances.concat(null)){
    const baby=Motion.appearanceProfile(key).family==='baby',f=fixture({options:{appearanceKey:key,outfit:'cloth_cream_vest'}});f.complete();const textures=f.created.filter(row=>row.type==='Texture');
    for(const cue of Motion.situations){
      const before=f.drawCalls.length;f.api.setSituation(cue,{elapsedMs:cue==='idle'?0:Math.min(1600,Motion.durations[cue]/2)});const calls=f.drawCalls.slice(before),head=calls.find(row=>row.part===6);
      assert.equal(calls.length,9);const scores=head.uniforms.u_face;let winner=0,max=0;scores.forEach((n,i)=>{if(n>max){max=n;winner=i+1;}});
      assert.strictEqual(head.texture4,textures[baby?(winner?1:0):(winner?winner+3:0)],cue+' old complete face');
      assert.strictEqual(head.texture5,textures[baby?3:10],cue+' default teeth');
      assert.strictEqual(head.texture6,textures[['resting','sleepy','deep_sleep'].includes(cue)?(baby?1:14):baby?(winner>=3?4:1):[0,4,5,11,12][winner]],cue+' selected expression mouth');
      assert.equal(head.mouthMode,['resting','sleepy','deep_sleep'].includes(cue)?1:0);
      for(const call of calls.filter(row=>row.part!==6)){
        assert.strictEqual(call.texture5,textures[baby?1:5]);assert.strictEqual(call.texture6,textures[baby?1:6]);assert.equal(call.mouthMode,0);
      }
      assert.strictEqual(f.boundTextures[4],textures[baby?1:4]);assert.strictEqual(f.boundTextures[5],textures[baby?1:5]);assert.strictEqual(f.boundTextures[6],textures[baby?1:6]);assert.equal(f.constants[6],0);assert.equal(f.raf.size,1);
    }
    assert.equal(f.maxActiveUnit,7);f.api.destroy();assert.equal(f.created.length,f.deleted.length);assert.equal(f.raf.size,0);assert.equal(f.timers.size,0);
  }
});

test('mouth shaders keep old silhouette alpha, registered nursery cells and original RGB beyond the local patch',()=>{
  for(const key of bornAppearances.concat(null)){
    const f=fixture({options:{appearanceKey:key}});f.complete();const shader=f.shaders[1];
    assert.match(shader,/if\(headPart>\.5\)\{vec3 toothBase=/);assert.match(shader,/rgb=mix\(rgb,tooth,toothPatch\(uv\)\)/);
    assert.match(shader,/float a=texture2D\(u_alpha,uv\)\.a\*v_coverage/);assert.doesNotMatch(shader,/texture2D\(u_(angry|surprise),[^;]+\)\.a/);
    assert.match(shader,/vec3 tooth=mix\(toothBase,toothExpression,v_mouthMode>\.5\?faceWeight\(u_presence\):weight\)/);assert.doesNotMatch(shader,/toothClosedUV|\(p.y-\.5(?:07|41)\)\*4/);
    assert.match(shader,/float faceWeight\(float presence\)\{return step\(0\.5,presence\);\}/,'sleep mouth selects one opaque source while body easing remains separate');
    assert.equal(shader.match(/uniform sampler2D [^;]+;/g).length,1);assert.equal(shader.match(/uniform vec4 [^;]+;/g).length,1);
    assert.equal(f.maxActiveUnit,7);assert.ok(f.bindings.every(row=>row[0]<8));
    if(Motion.appearanceProfile(key).family==='baby'){
      for(const cell of [3,4,5,6])assert.match(shader,new RegExp('vec4 expressionDonor=nurserySample\\(u_sad,uv,'+cell+'\\.\\)'));
      assert.match(shader,/expression=mix\(rgb,expressionDonor.rgb,faceDonorOpacity\(expressionDonor.a\)\)/);
      assert.match(shader,/if\(u_face.w>max\(max\(u_face.x,u_face.y\),u_face.z\)\)face=max/,'only the smiling donor gets the local feature mask');
      assert.match(shader,/float weight=strongest>0\.\?faceWeight\(u_presence\):0\./,'all facial cues select an opaque donor without altering body easing');
      assert.match(shader,/toothExpression=nurserySample\(u_surprise,uv,v_mouthMode>\.5\?2\.:toothCell\)\.rgb/);
      assert.match(shader,/tooth=texture2D\(u_angry,mix\(v_sourceRect.xy,v_sourceRect.zw,safe\)\)\.rgb/);
    }else assert.match(shader,/toothExpression=texture2D\(u_surprise,uv\)\.rgb/);
    f.api.destroy();
  }
});

test('side and back D mouths use each own atlas while front return and sleep restore all original sampler lanes',()=>{
  for(const key of bornAppearances.concat(null)){
    const baby=Motion.appearanceProfile(key).family==='baby',f=fixture({options:{appearanceKey:key}});f.complete();const textures=f.created.filter(row=>row.type==='Texture');
    for(const cue of Motion.directionCatalogue){f.api.setSituation(cue.id,{elapsedMs:2800});const call=f.drawCalls.at(-1);assert.ok(call.part>=10);assert.strictEqual(call.texture4,textures[baby?2:9]);assert.strictEqual(call.texture5,textures[baby?5:13]);assert.equal(call.mouthMode,0);assert.strictEqual(f.boundTextures[5],textures[baby?1:5]);}
    for(const cue of ['deep_sleep','cry','body_flap','idle']){f.api.setSituation(cue,{elapsedMs:cue==='idle'?0:1500});assert.equal(f.drawCalls.at(-1).part,8);assert.strictEqual(f.boundTextures[5],textures[baby?1:5]);assert.strictEqual(f.boundTextures[6],textures[baby?1:6]);}
    assert.match(f.shaders[1],/step\(-1\.,u_motionC.x\)/,'mouthless back sentinels cannot receive a new mouth');
    f.api.destroy();assert.equal(f.created.length,f.deleted.length);
  }
});

test('hatching alone samples the new mouth sheet and keeps every egg silhouette and shell on the old source',()=>{
  for(const key of ['egg','egg_cracked','hatching']){
    const f=fixture({options:{appearanceKey:key}});f.complete();const textures=f.created.filter(row=>row.type==='Texture'),call=f.drawCalls[0];
    assert.strictEqual(call.texture4,textures[0]);assert.strictEqual(call.texture5,textures[1]);assert.strictEqual(f.boundTextures[5],textures[0]);
    assert.match(f.shaders[1],/float mask=0\.;if\(u_motionA.x>1.5\)/);assert.match(f.shaders[1],/source.rgb=mix\(source.rgb,texture2D\(u_angry,p\)\.rgb,mask\);source.rgb=eggColor\(p,source.rgb\);float a=source.a\*v_coverage/);
    assert.equal(call.uniforms.u_motionA[0],Motion.appearanceProfile(key).stillCell);f.api.destroy();assert.equal(f.created.length,f.deleted.length);
  }
});

test('every added D material is required before ready and failure releases all family resources without animation',()=>{
  for(const [key,start]of [[null,10],...bornAppearances.map(key=>[key,3]),['hatching',1]]){
    const count=Motion.appearanceAssets(key).length;
    for(let missing=start;missing<count;missing++){
      const f=fixture({options:{appearanceKey:key}});
      f.images.forEach((im,index)=>{if(index===missing)return;im.complete=true;im.naturalWidth=im.naturalHeight=index<8?1000:1254;im.onload();});
      assert.equal(f.ready,0);assert.equal(f.draws,0);assert.equal(f.canvas.hidden,true);
      f.images[missing].onerror(new Error('unrecorded private source detail'));
      assert.deepEqual(f.errors,['image_failed']);assert.equal(f.deleted.length,f.created.length);assert.equal(f.raf.size,0);assert.equal(f.timers.size,0);
    }
  }
  for(const key of bornAppearances.concat(null)){const f=fixture({reduced:true,options:{appearanceKey:key,situation:'deep_sleep'}});f.complete();assert.equal(f.drawCalls.find(call=>call.part===6).mouthMode,0,'reduced motion keeps its established neutral pose');assert.equal(f.raf.size,0);f.api.destroy();}
});

test('every born appearance has its own finite, unfolded geometry and follows the same 100 acts and body rig',()=>{
  const names=Motion.situations.concat(Motion.bodyCatalogue.map(row=>row.id));
  for(const key of bornAppearances)for(const path of Motion.evolutionCatalogue){
    for(let y=0;y<24;y++)for(let x=0;x<24;x++){
      const a=Motion.appearancePoint(key,x/24,y/24,path.key),b=Motion.appearancePoint(key,x/24,(y+1)/24,path.key),c=Motion.appearancePoint(key,(x+1)/24,y/24,path.key),d=Motion.appearancePoint(key,(x+1)/24,(y+1)/24,path.key);
      for(const [ta,tb,tc]of[[a,b,c],[c,b,d]])assert.ok((tb.x-ta.x)*(tc.y-ta.y)-(tb.y-ta.y)*(tc.x-ta.x)<0,key+path.key+': no folds');
    }
    assert.equal(Motion.appearancePoint(key,.5,Motion.nurseryLandmarks.floor,path.key).y,.92);
    for(const name of names){const d=(Motion.durations[name]||1)/1000;for(const age of[0,d*.2,d*.55,d*.9,d]){
      const frame=Motion.rigPose(2.3,name,age,'child',path.key,1.15,key);assert.equal(frame.appearanceKey,key);
      for(const part of Motion.nurseryRigParts)for(const [x,y]of part.polygon){const p=Motion.rigPoint(frame,part.id,x,y,'child',path.key);assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=-.001&&p.x<=1.001&&p.y>=-.001&&p.y<=1.001,key+name+part.id);}
    }}
  }
});

test('all born meals share the selected reference mouth anchor while egg cues never draw food or a garment',()=>{
  for(const key of bornAppearances)for(const path of Motion.evolutionCatalogue){const frames=[],f=fixture({options:{appearanceKey:key,evolutionPath:path.key,onPose:p=>frames.push(p),outfit:'cloth_rose_cape'}});f.complete();f.api.setSituation('feeding',{elapsedMs:2200});assert.deepEqual(f.errors,[]);assert.equal(frames.length,1);
    const rig=Motion.rigPose(0,'feeding',2.2,'child',path.key,1,key);assert.ok(Math.abs(frames[0].mouthX-rig.mouth.x)<1e-12&&Math.abs(frames[0].mouthY-rig.mouth.y)<1e-12);assert.equal(frames[0].foodTop,frames[0].mouthY+.005);assert.equal(Math.floor(f.uniforms.u_anger/2),2);f.api.destroy();}
  for(const key of['egg','egg_cracked','hatching']){const frames=[],f=fixture({options:{appearanceKey:key,onPose:p=>frames.push(p),outfit:'cloth_flower_dress'}});f.complete();for(const name of['feeding','cry','angry','body_hands','body_flap','direction_back']){const before=f.draws;f.api.setSituation(name,{elapsedMs:1800});assert.equal(f.draws-before,1);assert.equal(f.drawCalls.at(-1).part,0);}assert.equal(frames.length,0);assert.equal(f.created.filter(row=>row.type==='Texture').length,2);f.api.destroy();}
});

test('all sixteen reference directions use measured expanded rectangles and retain their source ground at every appearance',()=>{
  assert.ok(Motion.nurseryDirectionViews[5].eyes[0]>=0,'the tiny baby side eye is protected');for(let i=6;i<=11;i++)assert.ok(Motion.nurseryDirectionViews[i].eyes.every(n=>n<0));
  for(const key of bornAppearances)for(const path of Motion.evolutionCatalogue)for(let index=0;index<16;index++){
    const view=Motion.nurseryDirectionViews[index],frame=Motion.rigPose(0,'idle',0,'child',path.key,1.15,key),fit=Motion.directionProjection(index,'child',path.key,frame.matrices.torso,key),m=fit.matrix;
    for(let i=0;i<=12;i++)assert.ok(Math.abs(Motion.directionPoint(index,i/12,view.groundY,'child',path.key,key).y-.92)<1e-6);
    for(let y=0;y<=12;y++)for(let x=0;x<=12;x++){const p=Motion.directionPoint(index,view.bounds[0]+(view.bounds[2]-view.bounds[0])*x/12,view.bounds[1]+(view.bounds[3]-view.bounds[1])*y/12,'child',path.key,key),u=m[0]*p.x+m[2]*p.y+m[4],v=m[1]*p.x+m[3]*p.y+m[5];assert.ok(u>=.0119&&u<=.9881&&v>=.0179&&v<=.9601);}
  }
  const f=fixture({options:{appearanceKey:'newborn'}});f.complete();f.api.setSituation('direction_back',{elapsedMs:2800});assert.equal(f.drawCalls.at(-1).part,18);assert.deepEqual(f.drawCalls.at(-1).sourceRect,Motion.nurseryDirectionViews[8].sourceRect);f.api.setSituation('sad',{elapsedMs:1400});assert.equal(f.drawCalls.at(-1).part,8);assert.ok(f.uniforms.u_faceSad>.9);f.api.destroy();assert.equal(f.created.length,f.deleted.length);
});

test('nursery silhouette retains measured newborn fur and every real garment remains a torso layer',()=>{
  const asset=fs.readFileSync(require.resolve('../static/pet_lilac_newborn_v1.png'));assert.equal(require('node:crypto').createHash('sha256').update(asset).digest('hex'),'eb7cf4baf38c97f42b47ec638e55b0983732f26dc534f379d210f90dd0700ef2');
  const pixels=[[321,288],[337,294],[539,211],[748,187],[771,192],[810,207],[844,219],[981,285],[1204,470],[303,708],[361,760],[375,852],[407,873],[415,1041],[851,1131]];
  function inside(x,y,p){let hit=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
  for(const [x,y]of pixels)assert.ok(Motion.nurseryRigParts.some(part=>inside((x+.5)/1254,(y+.5)/1254,part.polygon)),x+','+y+': original baby fur');
  for(const outfit of Motion.outfitCatalogue){let area=0,peak=0;for(let y=68;y<=90;y++)for(let x=30;x<=80;x++){const amount=Motion.nurseryClothingCoverage(outfit.id,x/100,y/100);area+=amount;peak=Math.max(peak,amount);}assert.ok(area>50&&peak>.5,outfit.id+': visible garment area (cape center stays open)');for(const [x,y]of[[.55,.45],[.18,.35],[.85,.34],[.45,.92]])assert.equal(Motion.nurseryClothingCoverage(outfit.id,x,y),0);
    const f=fixture({options:{appearanceKey:'baby',outfit:outfit.id}});f.complete();f.api.setSituation('feeding',{elapsedMs:2200});assert.deepEqual(f.errors,[]);assert.equal(Math.floor(f.uniforms.u_anger/2),outfit.index);f.api.setSituation('direction_back',{elapsedMs:2800});assert.equal(f.drawCalls.at(-1).uniforms.u_motionA[3],outfit.index);f.api.destroy();assert.equal(f.created.length,f.deleted.length);}
});

test('nursery load failures and slow reduced turns retain the proper static fallback without expiry loops',()=>{
  for(const key of['egg','newborn']){const f=fixture({options:{appearanceKey:key}});f.images.at(-1).onerror(new Error('private source path'));assert.deepEqual(f.errors,['image_failed']);assert.equal(f.ready,0);assert.equal(f.canvas.hidden,true);assert.equal(f.created.length,f.deleted.length);assert.equal(f.timers.size,0);}
  const f=fixture({reduced:true,options:{appearanceKey:'newborn',situation:'direction_back'}});assert.equal(f.timers.size,1);f.advance(7000);f.complete();assert.equal(f.ready,1);assert.equal(f.timers.size,0);assert.equal(f.drawCalls.at(-1).part,8);f.api.setSituation('direction_left');assert.equal(f.timers.size,1);f.advance(6001);f.timeout();assert.equal(f.timers.size,0);assert.equal(f.drawCalls.at(-1).part,8);f.api.destroy();assert.equal(f.created.length,f.deleted.length);
});

test('transparent expression donors retain the selected reference cheek colors and silhouette',()=>{
  for(const [x,y]of[[.25,.55],[.27,.56],[.29,.57]]){
    const original=pngPixel('pet_lilac_reference_v2.png',x,y),uv=Motion.nurseryFaceUV(6,x,y),donor=pngPixel('pet_lilac_baby_expressions_v1.png',uv.x,uv.y);
    assert.ok(original[3]>240);assert.ok(donor[3]<8,'transparent donor RGB overlaps opaque reference cheeks');
  }
});

test('six growth profiles are deterministic, physically sized and keep the original child proportions', () => {
  const signatures = new Set();
  for (const key of growthKeys) {
    const p = Motion.growthProfile(key);
    assert.equal(p.key, key); assert.ok(p.label); assert.equal(Object.isFrozen(p), true);
    assert.ok(p.overallScale >= .7 && p.overallScale <= 1);
    signatures.add(JSON.stringify(p));
    for (let step = 0; step <= 100; step++) {
      const n = step / 100;
      for (const [x, y] of [[0,n],[1,n],[n,0],[n,1],[n,.92]]) {
        const point = Motion.growthPoint(key, x, y);
        assert.ok(point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1, key);
        if (y === .92) assert.equal(point.y, .92, key + ': grounded');
        else assert.deepEqual(point, { x, y }, key + ': frame edge');
      }
      assert.deepEqual(Motion.growthPoint('child', n, 1-n), { x:n, y:1-n });
    }
  }
  assert.equal(signatures.size, 6);
  assert.equal(Motion.growthProfile('egg').headWidth > Motion.growthProfile('child').headWidth, true);
  assert.ok(Motion.growthProfile('adult').bodyHeight > Motion.growthProfile('child').bodyHeight);
  assert.ok(Motion.growthProfile('companion').tailScale > Motion.growthProfile('adult').tailScale);
  assert.deepEqual(Motion.growthProfile('__proto__'), Motion.growthProfile('child'));
  assert.deepEqual(Motion.growthPoint('unknown', NaN, Infinity), { x:.5, y:.5 });
});

function inspectRigMesh(f,stage,path='balanced') {
  const rest=f.buffers[0].data,live=f.liveVertices,frame=Motion.rigPose(0,'idle',0,stage,path);
  assert.ok(rest.length>0&&rest.length/5<20000);assert.equal(rest.length%15,0);
  assert.deepEqual(f.attributes.slice(0,3).map(a=>[a.index,a.size,a.stride,a.offset]),[[0,2,20,0],[1,2,20,8],[3,1,20,16]]);
  assert.equal(f.drawCalls.length,9);assert.equal(f.uploads.length,15);
  let total=0;
  for(const call of f.drawCalls){
    if(call.part===7||call.part===8){assert.equal(call.volume,true);assert.equal(call.first,0);assert.ok(call.count>100);assert.notStrictEqual(call.buffer,f.buffers[0].buffer);continue;}
    const part=Motion.rigParts[call.part];assert.equal(call.first,total);total+=call.count;
    for(let i=call.first*5;i<(call.first+call.count)*5;i+=5){
      const [x,y,u,v,coverage]=rest.subarray(i,i+5),grown=Motion.growthPoint(stage,u,v,path),target=Motion.rigPoint(frame,part.id,u,v,stage,path);
      assert.ok([x,y,u,v,coverage].every(Number.isFinite));assert.ok(u>=0&&u<=1&&v>=0&&v<=1&&coverage>=0&&coverage<=1);
      assert.ok(Math.abs(x-grown.x)<.000001&&Math.abs(y-grown.y)<.000001);
      assert.ok(Math.abs((live[i]+1)/2-target.x)<.000001&&Math.abs((1-live[i+1])/2-target.y)<.000001,part.id);
    }
  }
  assert.ok(total<rest.length/5,'the original flat arm vertices are no longer drawn');
  for(let i=0;i<rest.length;i+=15){
    const [ax,ay,,,,bx,by,,,,cx,cy]=rest.subarray(i,i+15);
    assert.ok((bx-ax)*(cy-ay)-(by-ay)*(cx-ax)<0,stage+path+': source winding');
    const [a,b,,,,c,d,,,,e,g]=live.subarray(i,i+15);
    assert.ok((c-a)*(g-b)-(d-b)*(e-a)>0,stage+path+': rendered winding');
  }
}

test('cropped part meshes keep source UVs and one-pixel feathering with positive rendered winding',()=>{
  for(const stage of growthKeys){
    const f=fixture({options:{growthStage:stage}});f.complete();inspectRigMesh(f,stage);
    assert.equal(f.clears,1);assert.equal(f.updates,3);f.api.destroy();assert.equal(f.created.length,f.deleted.length);
  }
});

test('neutral part coverage retains opaque original fur at the cheek, armpit, tail and ear boundaries',()=>{
  // These pixel centers were sampled from the original RGBA asset (alpha>240,
  // colored fur), rather than copied from the rig's polygons. Pinning that asset
  // keeps this dependency-free fixture meaningful without a WebP decoder.
  const asset=fs.readFileSync(require.resolve('../static/pet_lilac_cutout.webp'));
  assert.equal(require('node:crypto').createHash('sha256').update(asset).digest('hex'),'f8b005fd70000148ae34b8cfedd00f0dea67b99774640c8dcf8d5a7c8ac37107');
  const pixels=[[219,550],[222,580],[240,620],[260,650],[275,680],[880,320],[905,360],[922,400],
    [170,640],[200,670],[215,690],[110,476],[560,100],[251,850],[390,912],[720,85],[930,200]];
  function inside(x,y,polygon){let hit=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;
  }return hit;}
  for(const [x,y]of pixels)assert.ok(Motion.rigParts.some(part=>inside((x+.5)/1000,(y+.5)/1000,part.polygon)),x+','+y+': original fur must be drawable');
});

test('seven body demonstrations remain separate from the 100 emotions and end at the real idle rig',()=>{
  assert.equal(Motion.catalogue.length,100);assert.equal(Motion.situations.length,100);
  assert.deepEqual(Motion.bodyCatalogue.map(row=>row.id),['body_hands','body_flap','body_feet','body_ears','body_tail','body_head','body_joy']);
  assert.equal(Object.isFrozen(Motion.bodyCatalogue),true);
  for(const row of Motion.bodyCatalogue){
    const duration=row.id==='body_flap'?6600:6000;
    assert.equal(Object.isFrozen(row),true);assert.equal(row.durationMs,duration);assert.equal(row.effect,'none');assert.ok(row.face&&row.motion);
    assert.equal(Motion.durations[row.id],duration);assert.equal(Motion.situations.includes(row.id),false);
    assert.deepEqual(Motion.rigPose(9,row.id,duration/1000),Motion.rigPose(9,'idle',duration/1000));
  }
});

test('four real-view directions stay separate from the 100 emotions and seven body demonstrations',()=>{
  assert.deepEqual(Motion.directionCatalogue.map(row=>[row.id,row.durationMs]),[['direction_left',6000],['direction_right',6000],['direction_back',6500],['direction_spin',6800]]);
  assert.equal(Object.isFrozen(Motion.directionCatalogue),true);
  for(const row of Motion.directionCatalogue){assert.equal(Object.isFrozen(row),true);assert.equal(row.effect,'none');assert.ok(row.face&&row.motion);assert.equal(Motion.durations[row.id],row.durationMs);assert.equal(Motion.situations.includes(row.id),false);}
  assert.equal(Motion.catalogue.length,100);assert.equal(Motion.bodyCatalogue.length,7);
});

test('private room walks turn, travel out, stop to reverse, walk home and finish front without changing any public catalogue',()=>{
  assert.equal(Motion.catalogue.length,100);assert.equal(Motion.bodyCatalogue.length,7);assert.equal(Motion.directionCatalogue.length,4);
  for(const id of ['room_walk_left','room_walk_right']){
    assert.equal(Motion.durations[id],6000);assert.equal(Motion.situations.includes(id),false);assert.equal(Motion.bodyCatalogue.some(row=>row.id===id),false);assert.equal(Motion.directionCatalogue.some(row=>row.id===id),false);
    const sign=id==='room_walk_left'?-1:1;
    for(const [age,phase,x,yaw]of [[0,'turning_out',0,0],[650,'walking_out',0,sign*90],[1525,'walking_out',sign*.5,sign*90],[2400,'turning_back',sign,sign*90],[2775,'turning_back',sign,0],[3150,'walking_back',sign,-sign*90],[4025,'walking_back',sign*.5,-sign*90],[4900,'settling',0,-sign*90],[6000,'idle',0,0]]){
      const f=Motion.roomWalkFrame(id,age);assert.equal(f.phase,phase);assert.ok(Math.abs(f.x-x)<1e-10);assert.ok(Math.abs(f.yawDeg-yaw)<1e-10);assert.equal(Motion.directionFrame(id,age).yawDeg,f.yawDeg);assert.equal(f.durationMs,6000);
    }
    for(let age=0;age<=6000;age+=25){const f=Motion.roomWalkFrame(id,age),g=Motion.roomWalkFrame(id,age+1);assert.ok(f.x>=-1&&f.x<=1&&f.speed>=0&&f.speed<=1);assert.ok([f.x,f.speed,f.footPhase,f.yawDeg].every(Number.isFinite));if(Math.abs(g.x-f.x)>1e-12){assert.equal(Math.abs(f.yawDeg),90);assert.equal(Math.sign(g.x-f.x),Math.sign(f.yawDeg));}if(f.phase==='turning_back')assert.equal(f.x,sign);}
    for(const at of[650,2400,3150,4900,6000]){const a=Motion.roomWalkFrame(id,at-.00001),b=Motion.roomWalkFrame(id,at+.00001);assert.ok(Math.abs(a.x-b.x)<.0001);assert.ok(Math.abs(a.yawDeg-b.yawDeg)<.0001);assert.ok(Math.abs(a.speed-b.speed)<.0001);}
    assert.equal(Motion.pose(6,id,6).situation,'idle');
  }
  assert.deepEqual(Motion.roomWalkFrame('room_walk_left',NaN),Motion.roomWalkFrame('room_walk_left',0));assert.equal(Motion.roomWalkFrame('unknown',2000).id,null);
});

test('side-view walking lifts opposite real feet while the stance sole stays grounded and the head follows gently',()=>{
  for(const key of bornAppearances.concat(null))for(const id of ['room_walk_left','room_walk_right']){
    const baby=Motion.appearanceProfile(key).family==='baby',age=1500,f=Motion.roomWalkFrame(id,age),index=Motion.directionFrame(id,age).currentIndex,view=(baby?Motion.nurseryDirectionViews:Motion.directionViews)[index],center=view.torso[0];
    const points=baby?['left','right'].map(side=>{const foot=Motion.nurseryFootLandmarks[index][side];return[foot.x,foot.soleY];}):[[center-.10,view.groundY],[center+.10,view.groundY]];
    for(const phase of[Math.PI/2,Math.PI*1.5]){
      const frame={...f,walking:true,speed:1,footPhase:phase},left=Motion.roomWalkPoint(index,...points[0],frame,'child','balanced',key),right=Motion.roomWalkPoint(index,...points[1],frame,'child','balanced',key),a=Motion.directionPoint(index,...points[0],'child','balanced',key),b=Motion.directionPoint(index,...points[1],'child','balanced',key);
      if(phase<Math.PI){assert.ok(a.y-left.y>.025);assert.ok(Math.abs(b.y-right.y)<1e-12);}else{assert.ok(b.y-right.y>.025);assert.ok(Math.abs(a.y-left.y)<1e-12);}
      const head=Motion.roomWalkPoint(index,center,.4,frame,'child','balanced',key),old=Motion.directionPoint(index,center,.4,'child','balanced',key),bob=baby?.008:.005;assert.ok(Math.abs(old.y-head.y-bob)<1e-10);
    }
    const stopped=Motion.roomWalkFrame(id,2775);for(const p of points)assert.deepEqual(Motion.roomWalkPoint(index,...p,stopped,'child','balanced',key),Motion.directionPoint(index,...p,'child','balanced',key));
  }
});

test('room gait meshes remain unfolded and projected inside the canvas across every born appearance and evolution color',()=>{
  for(const key of ['newborn','baby','toddler','child','juvenile','grown','adult','companion'])for(const branch of Motion.evolutionCatalogue)for(const id of ['room_walk_left','room_walk_right'])for(const age of[1250,2000,3750,4500]){
    const stage=key==='adult'?'adult':key==='companion'?'companion':key==='grown'?'final':'child',walk=Motion.roomWalkFrame(id,age),index=Motion.directionFrame(id,age).currentIndex,view=(Motion.appearanceProfile(key).family==='baby'?Motion.nurseryDirectionViews:Motion.directionViews)[index];
    const rig=Motion.rigPose(1,id,age/1000,stage,branch.key,1.15,key),fit=Motion.directionProjection(index,stage,branch.key,rig.matrices.torso,key,walk),m=fit.matrix;
    for(let y=0;y<24;y++)for(let x=0;x<24;x++){
      const p=(u,v)=>Motion.roomWalkPoint(index,u/24,v/24,walk,stage,branch.key,key),a=p(x,y),b=p(x,y+1),c=p(x+1,y),d=p(x+1,y+1);
      for(const [u,v,w]of[[a,b,c],[c,b,d]])assert.ok((v.x-u.x)*(w.y-u.y)-(v.y-u.y)*(w.x-u.x)<0,key+branch.key+id+': no folded leg cells');
    }
    for(let y=0;y<=8;y++)for(let x=0;x<=8;x++){
      const p=Motion.roomWalkPoint(index,view.bounds[0]+(view.bounds[2]-view.bounds[0])*x/8,view.bounds[1]+(view.bounds[3]-view.bounds[1])*y/8,walk,stage,branch.key,key),u=m[0]*p.x+m[2]*p.y+m[4],v=m[1]*p.x+m[3]*p.y+m[5];
      assert.ok(Number.isFinite(u)&&Number.isFinite(v)&&u>=.0119&&u<=.9881&&v>=.0179&&v<=.9601,key+branch.key+id+': bounded silhouette');
    }
  }
});

test('actual room draws change lower-leg vertices with original UVs, clothes, tooth donors and one existing frame loop',()=>{
  for(const key of bornAppearances.concat(null)){
    const frames=[],f=fixture({options:{appearanceKey:key,outfit:'cloth_star_pajamas',evolutionPath:'fruit',onPose:p=>frames.push(p)}});f.complete();const resources=f.created.length,files=f.images.map(im=>im.url),textures=f.created.filter(row=>row.type==='Texture');
    f.api.setSituation('room_walk_left',{elapsedMs:1250});const a=new Float32Array(f.liveVertices),packet=frames.at(-1);assert.equal(f.drawCalls.at(-1).part,22);assert.equal(packet.situation,'room_walk_left');assert.equal(packet.yawDeg,-90);assert.equal(packet.roomX,Motion.roomWalkFrame('room_walk_left',1250).x);assert.equal(packet.walking,true);
    f.api.setSituation('room_walk_left',{elapsedMs:1850});const b=f.liveVertices;let upper=0,lower=0;
    for(let i=0;i<a.length;i+=5){assert.equal(a[i+2],b[i+2]);assert.equal(a[i+3],b[i+3]);assert.equal(a[i+4],b[i+4]);const delta=Math.hypot(a[i]-b[i],a[i+1]-b[i+1]);if(a[i+3]>.88)lower=Math.max(lower,delta);else if(a[i+3]<.6)upper=Math.max(upper,delta);}
    assert.ok(lower>.015,'visible foot motion beyond a full-image slide');assert.ok(lower>upper*2,'legs move independently from the upper-body bob');
    assert.equal(f.drawCalls.at(-1).uniforms.u_motionA[3],5);assert.strictEqual(f.drawCalls.at(-1).texture5,textures[Motion.appearanceProfile(key).family==='baby'?5:13]);assert.equal(f.maxActiveUnit,7);assert.equal(Object.values(f.uniforms).filter(value=>Array.isArray(value)&&value.length===4).length,8);
    f.api.setSituation('feeding',{elapsedMs:2200});assert.equal(frames.at(-1).situation,'feeding');assert.ok(Number.isFinite(frames.at(-1).foodTop));assert.equal('roomX'in frames.at(-1),false);assert.deepEqual(f.images.map(im=>im.url),files);assert.equal(f.created.length,resources+1,'only the existing lazily-created turn buffer is added');assert.equal(f.raf.size,1);
    f.api.destroy();assert.equal(f.created.length,f.deleted.length);assert.equal(f.raf.size,0);assert.equal(f.timers.size,0);
  }
});

test('room direction callbacks end at center, respect interruption and hidden time, and keep old direction yaw observable',()=>{
  const frames=[],f=fixture({options:{onPose:p=>frames.push(p)}});f.complete();f.api.setSituation('room_walk_right',{elapsedMs:4800});assert.ok(frames.at(-1).roomX>0);f.advance(1201);assert.equal(frames.at(-1).roomX,0);assert.equal(frames.at(-1).yawDeg,0);assert.equal(frames.at(-1).done,true);assert.deepEqual(f.drawCalls.slice(-9).map(row=>row.part),Motion.rigParts.map(row=>row.index));
  f.api.setSituation('room_walk_left',{elapsedMs:1500});f.api.setSituation('body_flap',{elapsedMs:1300});const count=frames.length;f.advance(100);assert.equal(frames.length,count);f.api.setSituation('direction_back',{elapsedMs:2800});assert.equal(frames.at(-1).yawDeg,180);assert.equal('roomX'in frames.at(-1),false);
  f.api.setSituation('room_walk_right',{elapsedMs:1000});f.hide(true);const hidden=frames.length;f.advance(12000);assert.equal(frames.length,hidden);f.hide(false);assert.equal(frames.at(-1).roomX,0);assert.equal(frames.at(-1).done,true);f.api.destroy();
});

test('eggs never walk sideways and reduced room routes remain centered with finite expiry and full cleanup',()=>{
  for(const key of ['egg','egg_cracked','hatching']){const frames=[],f=fixture({options:{appearanceKey:key,onPose:p=>frames.push(p)}});f.complete();for(const id of['room_walk_left','room_walk_right']){f.api.setSituation(id,{elapsedMs:1800});assert.equal(f.drawCalls.at(-1).part,0);assert.equal(frames.length,0);assert.equal(f.uniforms.u_motionA[0],Motion.appearanceProfile(key).stillCell);}f.api.destroy();assert.equal(f.created.length,f.deleted.length);}
  for(const key of bornAppearances.concat(null)){const frames=[],f=fixture({reduced:true,options:{appearanceKey:key,onPose:p=>frames.push(p)}});f.complete();f.api.setSituation('room_walk_left',{elapsedMs:1700});assert.equal(frames.at(-1).roomX,0);assert.equal(frames.at(-1).yawDeg,0);assert.equal(frames.at(-1).walking,false);assert.equal(f.raf.size,0);assert.equal(f.timers.size,1);f.advance(4400);f.timeout();assert.equal(frames.at(-1).roomX,0);assert.equal(frames.at(-1).done,true);assert.equal(f.timers.size,0);f.api.destroy();assert.equal(f.created.length,f.deleted.length);}
});

test('direction timelines show the intended real side/back, hold one crisp frame, and return to front',()=>{
  for(const [id,yaw,index]of[['direction_left',-90,12],['direction_right',90,4],['direction_back',180,8]]){
    const d=Motion.durations[id];assert.equal(Motion.directionFrame(id,0).front,true);
    for(const age of[2400,3000,3800]){const p=Motion.directionFrame(id,age);assert.equal(p.yawDeg,yaw);assert.equal(p.currentIndex,index);assert.equal(p.blend,0);assert.equal(p.front,false);}
    assert.equal(Motion.directionFrame(id,d-1).front,true);assert.equal(Motion.directionFrame(id,d).done,true);
    assert.equal(Motion.directionFrame(id,1000,true).currentIndex,index);assert.equal(Motion.directionFrame(id,d,true).front,true);
  }
  let previous=0;const indices=new Set();
  for(let age=0;age<6800;age+=10){const p=Motion.directionFrame('direction_spin',age);assert.ok(p.yawDeg>=previous&&p.yawDeg<=360);previous=p.yawDeg;indices.add(p.blend>.5?p.nextIndex:p.currentIndex);}
  assert.equal(indices.size,16);assert.equal(Motion.directionFrame('direction_spin',6800).front,true);assert.equal(Motion.directionFrame('direction_spin',2000,true).front,true);
  for(const id of['__proto__','missing',null])assert.deepEqual(Motion.directionFrame(id,Infinity),{id:null,yawDeg:0,currentIndex:0,nextIndex:1,blend:0,front:true,done:true});
});

test('all sixteen half-pixel atlas cells keep samples inside their own half-texel guard',()=>{
  assert.equal(Motion.directionViews.length,16);assert.equal(Object.isFrozen(Motion.directionViews),true);
  for(let i=0;i<16;i++){
    const view=Motion.directionViews[i];assert.equal(view.index,i);assert.equal(Object.isFrozen(view),true);
    for(const x of[-1,0,.1,.5,.9,1,2])for(const y of[-1,0,.5,1,2]){
      const p=Motion.directionCellUV(i,x,y,1254,1254),left=i%4/4,top=Math.floor(i/4)/4;
      assert.ok(p.x>=left+.5/1254-1e-12&&p.x<=left+.25-.5/1254+1e-12);
      assert.ok(p.y>=top+.5/1254-1e-12&&p.y<=top+.25-.5/1254+1e-12);
    }
    for(const key of['torso','eyes','eyeRadii','paws','tail','mouth','bounds'])assert.equal(Object.isFrozen(view[key]),true);
  }
});

test('direction shapes keep every 6x6 growth/path grid unfolded and source soles grounded',()=>{
  for(const stage of growthKeys)for(const path of Motion.evolutionCatalogue)for(let index=0;index<16;index++){
    const view=Motion.directionViews[index];
    for(let step=0;step<=24;step++)assert.ok(Math.abs(Motion.directionPoint(index,step/24,view.groundY,stage,path.key).y-.92)<1e-12);
    for(let y=0;y<24;y++)for(let x=0;x<24;x++){
      const a=Motion.directionPoint(index,x/24,y/24,stage,path.key),b=Motion.directionPoint(index,x/24,(y+1)/24,stage,path.key),c=Motion.directionPoint(index,(x+1)/24,y/24,stage,path.key),d=Motion.directionPoint(index,(x+1)/24,(y+1)/24,stage,path.key);
      for(const [ta,tb,tc]of[[a,b,c],[c,b,d]]){assert.ok([ta.x,ta.y,tb.x,tb.y,tc.x,tc.y].every(Number.isFinite));assert.ok((tb.x-ta.x)*(tc.y-ta.y)-(tb.y-ta.y)*(tc.x-ta.x)<0,stage+path.key+index+': unfolded');}
    }
    for(const [x,y]of[[.3,.2],[.5,.7],[.8,.91]])assert.deepEqual(Motion.directionPoint(0,x,y,stage,path.key),Motion.growthPoint(stage,x,y,path.key));
  }
});

test('per-view projection safely fits opaque source bounds at maximum supported size',()=>{
  for(const stage of growthKeys)for(const path of Motion.evolutionCatalogue){
    const root=Motion.rigPose(0,'idle',0,stage,path.key,1.15).matrices.torso;
    for(let index=0;index<16;index++){
      const fit=Motion.directionProjection(index,stage,path.key,root),b=Motion.directionViews[index].bounds,m=fit.matrix;
      assert.ok(fit.fitScale>0&&fit.fitScale<=1);
      for(let y=0;y<=12;y++)for(let x=0;x<=12;x++){
        const p=Motion.directionPoint(index,b[0]+(b[2]-b[0])*x/12,b[1]+(b[3]-b[1])*y/12,stage,path.key),px=m[0]*p.x+m[2]*p.y+m[4],py=m[1]*p.x+m[3]*p.y+m[5];
        assert.ok(px>=.012-1e-9&&px<=.988+1e-9&&py>=.018-1e-9&&py<=.96+1e-9,stage+path.key+index+': visible silhouette fits');
      }
    }
  }
});

test('view-local fur palettes protect real eyes, mouths and cream while coloring side/back fur',()=>{
  const purple=[.8,.65,.83],cream=[.96,.89,.78];
  for(const view of Motion.directionViews){
    const colors=new Set();for(const path of Motion.evolutionCatalogue){
      const sample=Motion.directionFurColor(view.index,path.key,.5,.24,purple);assert.ok(sample.every(c=>c>=0&&c<=1));colors.add(sample.map(c=>c.toFixed(3)).join(','));
      assert.deepEqual(Motion.directionFurColor(view.index,path.key,.5,.75,cream),cream);
      for(let offset=0;offset<4;offset+=2)if(view.eyes[offset]>=0)assert.deepEqual(Motion.directionFurColor(view.index,path.key,view.eyes[offset],view.eyes[offset+1],purple),purple);
      if(view.mouth[0]>=0)assert.deepEqual(Motion.directionFurColor(view.index,path.key,view.mouth[0],view.mouth[1],purple),purple);
    }assert.equal(colors.size,6,view.index+': distinct fur');
    if(view.index>=5&&view.index<=10)assert.ok(view.eyes.every(n=>n<0)&&view.mouth[0]<0,view.index+': no frontal eyes/mouth on the back');
  }
});

test('all six garments have bounded per-view torso coverage without painting paws, tails or heads',()=>{
  for(const view of Motion.directionViews)for(const outfit of Motion.outfitCatalogue){
    let visible=0;
    for(let y=0;y<=40;y++)for(let x=0;x<=40;x++){const amount=Motion.directionClothingCoverage(view.index,outfit.id,x/40,y/40);assert.ok(amount>=0&&amount<=1);visible+=amount;}
    assert.ok(visible>0,outfit.id+': view '+view.index+' has real cloth area');
    for(let offset=0;offset<4;offset+=2)if(view.paws[offset]>=0)assert.equal(Motion.directionClothingCoverage(view.index,outfit.id,view.paws[offset],view.paws[offset+1]),0);
    if(view.tail[0]>=0)assert.equal(Motion.directionClothingCoverage(view.index,outfit.id,view.tail[0],view.tail[1]),0);
    assert.equal(Motion.directionClothingCoverage(view.index,outfit.id,view.headX,.3),0);
    assert.equal(Motion.directionClothingCoverage(view.index,'unknown',view.torso[0],view.torso[1]),0);
  }
  assert.ok(Motion.outfitCoverage('cloth_cream_vest',.58,.72,true,true)>Motion.outfitCoverage('cloth_cream_vest',.58,.72,true,false));
});

test('turn drawing borrows unit four for one cell then restores the frontal VBO and materials',()=>{
  const f=fixture();f.complete();const textures=f.created.filter(row=>row.type==='Texture'),frontBuffer=f.drawCalls[0].buffer;
  assert.equal(f.buffers.length,2);assert.equal(f.updates,3);f.advance();assert.equal(f.buffers.length,2);assert.equal(f.updates,6);
  for(const [id,index]of[['direction_left',12],['direction_right',4],['direction_back',8]]){
    const before=f.draws;f.api.setSituation(id,{elapsedMs:2800});const calls=f.drawCalls.slice(before);
    assert.equal(calls.length,1);assert.equal(calls[0].part,index+10);assert.equal(calls[0].first,0);assert.equal(calls[0].count,3456);assert.strictEqual(calls[0].texture4,textures[9]);
    assert.equal(calls[0].uniforms.u_motionA[0],1);assert.equal(calls[0].uniforms.u_motionA[1],index);
    assert.equal(calls[0].uniforms.u_motionA[2],index>4&&index<12?1:0);
    assert.notStrictEqual(calls[0].buffer,frontBuffer);assert.strictEqual(f.boundTextures[4],textures[4]);assert.equal(f.raf.size,1);
  }
  assert.equal(f.buffers.length,3);assert.deepEqual(f.blend.at(-1),[f.gl.ONE,f.gl.ONE_MINUS_SRC_ALPHA]);assert.equal(f.maxActiveUnit,7);
  const before=f.draws;f.api.setSituation('angry',{elapsedMs:1500});const calls=f.drawCalls.slice(before);assert.equal(calls.length,9);assert.strictEqual(calls[0].buffer,frontBuffer);assert.ok(f.uniforms.u_faceAngry>.9);
  for(const call of calls)assert.strictEqual(call.texture4,call.part===1?textures[8]:call.part===6?textures[5]:textures[4]);
  assert.deepEqual(f.attributes.slice(-3).map(a=>[a.index,a.size,a.stride,a.offset]),[[0,2,20,0],[1,2,20,8],[3,1,20,16]]);
  f.api.destroy();assert.equal(f.created.length,f.deleted.length);assert.equal(f.raf.size,0);
});

test('intermediate turns draw one opaque source, including both sides of each source boundary',()=>{
  for(const appearanceKey of ['newborn','adult','grown',null]){
    const f=fixture({options:{appearanceKey}});f.complete();
    for(const situation of ['direction_left','direction_right','direction_back','direction_spin','room_walk_left','room_walk_right']){
      let transitions=0;
      for(let age=1;age<Motion.durations[situation];age+=17){
        const frame=Motion.directionFrame(situation,age);
        if(frame.front||frame.done||frame.blend<=.02||frame.blend>=.98)continue;
        const before=f.draws;f.api.setSituation(situation,{elapsedMs:age});const calls=f.drawCalls.slice(before);
        assert.equal(calls.length,1,`${appearanceKey} ${situation} ${age}: a single silhouette`);
        assert.equal(calls[0].part,10+(frame.blend<.5?frame.currentIndex:frame.nextIndex));
        assert.equal(calls[0].uniforms.u_motionA[0],1,'source alpha is not attenuated');transitions++;
      }
      assert.ok(transitions>0,`${situation} exercised source transitions`);
    }
    assert.deepEqual(f.blend,[[f.gl.ONE,f.gl.ONE_MINUS_SRC_ALPHA]],'never add a second full-body drawing');
    f.api.destroy();assert.equal(f.created.length,f.deleted.length);
  }
});

test('turns replace food callbacks, expire while hidden, and reduced motion shows one static target',()=>{
  const frames=[],f=fixture({options:{onPose:p=>frames.push(p)}});f.complete();f.api.setSituation('feeding',{elapsedMs:2200});assert.equal(frames.length,1);
  f.api.setSituation('direction_back',{elapsedMs:2800});f.advance(100);assert.equal(frames.filter(row=>row.situation==='feeding').length,1);assert.equal(frames.at(-1).yawDeg,180);assert.equal('roomX'in frames.at(-1),false);f.hide(true);const n=f.draws,count=frames.length;f.advance(10000);assert.equal(f.draws,n);assert.equal(frames.length,count);f.hide(false);assert.deepEqual(f.drawCalls.slice(-9).map(c=>c.part),Motion.rigParts.map(p=>p.index));assert.equal(frames.at(-1).yawDeg,0);assert.equal(frames.at(-1).done,true);f.api.destroy();
  const reduced=fixture({reduced:true,options:{situation:'direction_left'}});reduced.complete();assert.equal(reduced.draws,1);assert.equal(reduced.drawCalls[0].part,22);assert.equal(reduced.raf.size,0);
  reduced.api.setSituation('direction_spin',{elapsedMs:2500});assert.deepEqual(reduced.drawCalls.slice(-9).map(c=>c.part),Motion.rigParts.map(p=>p.index));reduced.api.destroy();assert.equal(reduced.created.length,reduced.deleted.length);
});

test('a reduced-motion static side/back has one finite expiry repaint and cancels it on replacement or destroy',()=>{
  const f=fixture({reduced:true});f.complete();assert.equal(f.timers.size,0);
  f.api.setSituation('direction_back',{elapsedMs:3000});assert.equal(f.drawCalls.at(-1).part,18);assert.equal(f.raf.size,0);assert.equal(f.timers.size,1);
  f.advance(3501);f.timeout();assert.equal(f.timers.size,0);assert.deepEqual(f.drawCalls.slice(-9).map(c=>c.part),Motion.rigParts.map(p=>p.index));
  f.api.setSituation('direction_left',{elapsedMs:2000});assert.equal(f.timers.size,1);f.api.setSituation('feeding',{elapsedMs:2000});assert.equal(f.timers.size,0);
  f.api.setSituation('direction_right',{elapsedMs:2000});assert.equal(f.timers.size,1);f.reduce(false);assert.equal(f.timers.size,0);assert.equal(f.raf.size,1);
  f.reduce(true);assert.equal(f.timers.size,1);f.hide(true);assert.equal(f.timers.size,0);const before=f.draws;f.advance(5000);assert.equal(f.draws,before);f.hide(false);assert.equal(f.timers.size,0);assert.deepEqual(f.drawCalls.slice(-9).map(c=>c.part),Motion.rigParts.map(p=>p.index));
  f.api.setSituation('direction_back',{elapsedMs:2000});const stale=[...f.timers.values()][0];f.api.setSituation('direction_left',{elapsedMs:2000});const current=f.draws;stale();assert.equal(f.draws,current);assert.equal(f.timers.size,1);
  f.win.emit('pagehide');assert.equal(f.timers.size,0);f.advance(5000);f.win.emit('pageshow');assert.equal(f.timers.size,0);assert.deepEqual(f.drawCalls.slice(-9).map(c=>c.part),Motion.rigParts.map(p=>p.index));
  f.api.setSituation('direction_right');assert.equal(f.timers.size,1);f.api.destroy();assert.equal(f.timers.size,0);assert.equal(f.raf.size,0);assert.equal(f.created.length,f.deleted.length);
});

test('reduced directions never schedule expiry loops before loading or while the canvas is disconnected',()=>{
  const slow=fixture({reduced:true,options:{situation:'direction_back'}});
  assert.equal(slow.timers.size,1,'only the image load timeout exists before decoding');
  slow.advance(7000);assert.equal(slow.draws,0);assert.equal(slow.timers.size,1);
  slow.complete();assert.equal(slow.ready,1);assert.equal(slow.timers.size,0);assert.equal(slow.raf.size,0);
  assert.deepEqual(slow.drawCalls.slice(-9).map(c=>c.part),Motion.rigParts.map(p=>p.index));slow.api.destroy();assert.equal(slow.created.length,slow.deleted.length);
  const detached=fixture({reduced:true});detached.complete();detached.api.setSituation('direction_left');assert.equal(detached.timers.size,1);
  detached.canvas.isConnected=false;detached.advance(7000);const before=detached.draws;detached.timeout();assert.equal(detached.draws,before);assert.equal(detached.timers.size,0);assert.equal(detached.raf.size,0);
  detached.api.setSituation('direction_right');assert.equal(detached.timers.size,0);detached.api.destroy();assert.equal(detached.created.length,detached.deleted.length);
});

test('the final real-view atlas is required and failures keep the explicit static fallback honest',()=>{
  const f=fixture();for(const [i,image]of f.images.entries())if(i<9){image.complete=true;image.naturalWidth=image.naturalHeight=i>=8?1254:1000;image.onload();}
  assert.equal(f.ready,0);assert.equal(f.draws,0);f.images[9].onerror(new Error('private atlas path'));assert.deepEqual(f.errors,['image_failed']);assert.equal(f.canvas.hidden,true);assert.equal(f.created.length,f.deleted.length);
  const atlas=fs.readFileSync(require.resolve('../static/pet_lilac_turnaround_v1.png'));assert.equal(require('node:crypto').createHash('sha256').update(atlas).digest('hex'),'2db0cac26e020a68cec910f9ff9f34d992547065d8e7a4948c72046eeb7e9f7c');
});

test('left and right hands move as rigid cutouts by large independent arcs',()=>{
  const left=Motion.rigPose(1.2,'body_hands',1.2,'final'),right=Motion.rigPose(3.8,'body_hands',3.8,'final');
  assert.ok(left.angles.arm_l<-1&&Math.abs(left.angles.arm_r)<.01);
  assert.ok(right.angles.arm_r>1&&Math.abs(right.angles.arm_l)<.01);
  const torsoFrame=frame=>({...frame,matrices:{...frame.matrices,arm_l:frame.matrices.torso,arm_r:frame.matrices.torso}});
  for(const [frame,id,x,y]of[[left,'arm_l',.618,.7],[right,'arm_r',.69,.71]]){
    const moved=Motion.rigPoint(frame,id,x,y,'final'),rest=Motion.rigPoint(torsoFrame(frame),id,x,y,'final');
    assert.ok(Math.hypot(moved.x-rest.x,moved.y-rest.y)>.08,id+': visible hand travel');
  }
  for(const frame of [left,right])for(const id of ['arm_l','arm_r','ear_l','ear_r','tail']){
    const part=Motion.rigParts.find(row=>row.id===id),a=part.polygon[2],b=part.polygon[5];
    const wa=Motion.rigPoint(frame,id,...a,'final'),wb=Motion.rigPoint(frame,id,...b,'final'),m=frame.matrices[id],scale=Math.hypot(m[0],m[1]);
    const ra=Motion.growthPoint('final',...a),rb=Motion.growthPoint('final',...b);
    assert.ok(Math.abs(scale-Math.hypot(m[2],m[3]))<1e-12,id+': uniform scale independent of torso breathing');
    assert.ok(Math.abs(Math.hypot(wa.x-wb.x,wa.y-wb.y)/scale-Math.hypot(ra.x-rb.x,ra.y-rb.y))<1e-12,id+': no rubber stretch');
  }
});

test('hand acting keeps the camera steady instead of shrinking the whole pet at cue entry',()=>{
  for(const key of bornAppearances)for(const path of Motion.evolutionCatalogue){
    const idle=Motion.rigPose(0,'idle',0,'adult',path.key,1,key),scale=Math.hypot(...idle.matrices.head.slice(0,2));
    const torso=[],head=[],tips=[];
    for(const age of[0,.25,.45,.8,1.3,1.58,1.85,2.4,3.2,5.1,6.6]){
      const f=Motion.rigPose(0,'body_flap',age,'adult',path.key,1,key);
      for(const id of['head','arm_l','arm_r'])assert.ok(Math.abs(Math.hypot(...f.matrices[id].slice(0,2))-scale)<1e-12,key+id+': no cue resizing');
      torso.push(Motion.rigPoint(f,'torso',.55,.75,'adult',path.key).y);
      head.push(Motion.rigPoint(f,'head',.55,.45,'adult',path.key).y);
      if(age===1.58||age===1.85)tips.push(Motion.rigPoint(f,'arm_r',.774,.786,'adult',path.key).y);
      assert.ok(nurseryActualSoles(f,path.key).every(p=>Math.abs(p.y-.92)<1e-12));
    }
    assert.ok(Math.max(...torso)-Math.min(...torso)<.002,key+': torso does not ride the arm beat');
    assert.ok(Math.max(...head)-Math.min(...head)<.004,key+': no head drop at entry');
    assert.ok(Math.abs(tips[1]-tips[0])>.03,key+': hands still travel visibly');
  }
});

test('body posture bends the torso while preserving rigid face and hand proportions',()=>{
  for(const key of bornAppearances)for(const path of Motion.evolutionCatalogue){
    const base=Motion.rigPose(0,'idle',0,'adult',path.key,1,key),scale=Math.hypot(...base.matrices.head.slice(0,2));
    let torsoChanges=false;
    for(const cue of['laugh','cry','stretching','feeding','sad','cheer'])for(const age of[.7,1.3,2.2,3.4]){
      const f=Motion.rigPose(age,cue,age,'adult',path.key,1,key);
      torsoChanges ||= Math.abs(Math.hypot(...f.matrices.torso.slice(0,2))-scale)>.001;
      for(const id of['head','arm_l','arm_r']){
        const m=f.matrices[id];
        assert.ok(Math.abs(Math.hypot(m[0],m[1])-scale)<1e-12,key+cue+id+': independent rigid width');
        assert.ok(Math.abs(Math.hypot(m[2],m[3])-scale)<1e-12,key+cue+id+': independent rigid height');
      }
    }
    assert.equal(torsoChanges,true,'torso retains expressive breathing/posture');
  }
});

test('all B performances retain welded sockets and fixed framing; only genuine jumps lift both feet',()=>{
  for(const key of bornAppearances)for(const path of Motion.evolutionCatalogue)for(const row of Motion.catalogue.concat(Motion.bodyCatalogue)){
    const duration=Motion.durations[row.id]/1000;
    for(let tick=0;tick<=16;tick++){
      const age=duration*tick/16,f=Motion.rigPose(age,row.id,age,'adult',path.key,1.15,key);
      assert.equal(f.fitScale,1,key+row.id+': no per-frame camera resize');
      for(const id of['arm_l','arm_r','tail']){
        const part=Motion.nurseryRigParts.find(p=>p.id===id),a=Motion.rigPoint(f,id,...part.pivot,'adult',path.key),b=Motion.rigPoint(f,'torso',...part.pivot,'adult',path.key);
        assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1e-12,key+row.id+id+': attached socket');
      }
      const scale=Math.hypot(...f.matrices.head.slice(0,2)),soles=nurseryActualSoles(f,path.key);
      assert.ok(Math.abs(Math.max(...soles.map(p=>p.y))-(.92-f.flight*.055*scale))<1e-10,key+row.id+': support foot follows actual flight only');
    }
  }
});

test('waving and head gestures stand on their feet while prepared joy can still jump',()=>{
  for(const key of bornAppearances){
    for(const cue of['greeting','cheer','thinking','body_hands','body_flap','body_head'])for(const age of[1.2,1.8,2.4,3.4]){
      const f=Motion.rigPose(0,cue,age,'adult','balanced',1,key);
      assert.equal(f.flight,0);assert.equal(f.lowerBody.step,0);
      assert.ok(nurseryActualSoles(f,'balanced').every(p=>Math.abs(p.y-.92)<1e-12));
    }
    const flight=Array.from({length:30},(_,i)=>Motion.rigPose(i/10,'body_joy',i/10,'adult','balanced',1,key).flight);
    assert.ok(Math.max(...flight)>.5,'a deliberate joy jump still leaves the floor');
  }
});

test('flapping opens both real shoulders outward and raises and lowers both hands on the same beat',()=>{
  const up=.9+1.25/1.85,down=.9+1.75/1.85;
  const born=Motion.appearanceCatalogue.filter(row=>row.family!=='egg');
  for(const appearance of born)for(const path of Motion.evolutionCatalogue){
    const baby=appearance.family==='baby',stage=baby?'child':appearance.key==='grown'?'final':appearance.key;
    const parts=baby?Motion.nurseryRigParts:Motion.rigParts;
    const tips=baby?[[.368,.77],[.774,.786]]:[[.606,.741],[.704,.758]];
    const high=Motion.rigPose(up,'body_flap',up,stage,path.key,1,appearance.key);
    const low=Motion.rigPose(down,'body_flap',down,stage,path.key,1,appearance.key);
    assert.ok(high.angles.arm_l-low.angles.arm_l>1.15,appearance.key+': full left flap');
    assert.ok(low.angles.arm_r-high.angles.arm_r>1.15,appearance.key+': full right flap');
    assert.ok(Math.abs((high.angles.arm_l-low.angles.arm_l)+(high.angles.arm_r-low.angles.arm_r))<1e-12,'same beat, opposite shoulder rotations');
    for(const [i,id]of['arm_l','arm_r'].entries()){
      const part=parts.find(row=>row.id===id),side=i===0?-1:1;
      const offsets=frame=>{
        const palm=Motion.rigPoint(frame,id,...tips[i],stage,path.key),socket=Motion.rigPoint(frame,'torso',...part.pivot,stage,path.key);
        const joint=Motion.rigPoint(frame,id,...part.pivot,stage,path.key);
        assert.ok(Math.hypot(joint.x-socket.x,joint.y-socket.y)<1e-12,id+': attached shoulder');
        return{x:palm.x-socket.x,y:palm.y-socket.y};
      };
      const a=offsets(high),b=offsets(low);
      assert.ok(a.x*side>.035&&b.x*side>.035,appearance.key+id+': reaches outside its shoulder');
      assert.ok(a.y<-.015&&b.y>.015&&b.y-a.y>.045,appearance.key+id+': visible simultaneous vertical travel');
    }
    for(const frame of[high,low])for(const id of['foot_l','foot_r']){
      const part=parts.find(row=>row.id===id),foot=baby?Motion.nurseryFootLandmarks[0][id==='foot_l'?'left':'right']:null;
      const sole=Motion.rigPoint(frame,id,foot?foot.x:part.pivot[0],foot?foot.soleY:.92,stage,path.key);
      assert.ok(Math.abs(sole.y-.92)<1e-12,appearance.key+': both feet remain planted');
    }
  }
  const alternating=Motion.rigPose(1.2,'body_hands',1.2,'final');
  assert.ok(Math.abs(alternating.angles.arm_r)<.01,'the original alternating demonstration is unchanged');
});

test('flapping anticipates and settles to idle, with finite unclipped parts at every born appearance',()=>{
  const duration=Motion.durations.body_flap/1000;
  assert.equal(duration,6.6);
  for(const appearance of Motion.appearanceCatalogue.filter(row=>row.family!=='egg'))for(const path of Motion.evolutionCatalogue){
    const baby=appearance.family==='baby',stage=baby?'child':appearance.key==='grown'?'final':appearance.key,parts=baby?Motion.nurseryRigParts:Motion.rigParts;
    for(const age of[0,.00001,.25,.65,1.03,1.58,1.85,3.2,5.5,6.1,duration-.00001,duration]){
      const frame=Motion.rigPose(7.8,'body_flap',age,stage,path.key,1.15,appearance.key);
      if(age>=1&&age<=5.5)assert.equal(frame.fitScale,1,appearance.key+': fixed acting margin, no per-beat resizing');
      for(const part of parts)for(const [x,y]of part.polygon){
        const p=Motion.rigPoint(frame,part.id,x,y,stage,path.key);
        assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=.0119&&p.x<=.9881&&p.y>=.0179&&p.y<=.9601,appearance.key+part.id+age+': visible canvas bounds');
      }
      if(age===0||age===.00001||age===duration-.00001||age===duration){
        const idle=Motion.rigPose(7.8,'idle',age,stage,path.key,1.15,appearance.key);
        for(const id of Object.keys(idle.matrices))for(let i=0;i<6;i++)assert.ok(Math.abs(frame.matrices[id][i]-idle.matrices[id][i])<.001,appearance.key+': no entry or exit snap');
      }
    }
    const start=Motion.rigPose(1,'body_flap',.1,stage,path.key,1,appearance.key),spread=Motion.rigPose(1,'body_flap',1.5,stage,path.key,1,appearance.key);
    assert.ok(Math.abs(start.angles.arm_l)<Math.abs(spread.angles.arm_l),appearance.key+': anticipation before opening');
    assert.deepEqual(Motion.rigPose(9,'body_flap',duration,stage,path.key,1,appearance.key),Motion.rigPose(9,'idle',duration,stage,path.key,1,appearance.key));
  }
});

test('flapping keeps one rig, real clothes and reduced-motion idle without extra resources or loops',()=>{
  for(const appearance of Motion.appearanceCatalogue.filter(row=>row.family!=='egg')){
    const f=fixture({options:{appearanceKey:appearance.key,outfit:'cloth_rose_cape'}});f.complete();
    const resources=f.created.length;f.api.setSituation('body_flap',{elapsedMs:1600});
    assert.equal(f.drawCalls.at(-1).part,8);assert.equal(f.created.length,resources);assert.equal(f.maxActiveUnit,7);assert.equal(f.raf.size,1);
    assert.equal(Math.floor(f.uniforms.u_effect[3]/2),2);assert.equal(f.uniforms.u_presence,1);
    f.reduce(true);assert.equal(f.raf.size,0);assert.equal(f.timers.size,0);assert.equal(f.uniforms.u_presence,0);
    f.api.setSituation('body_flap',{elapsedMs:3000});assert.equal(f.raf.size,0);assert.equal(f.timers.size,0);assert.equal(f.uniforms.u_presence,0);
    f.api.destroy();assert.equal(f.deleted.length,f.created.length);assert.equal(f.raf.size,0);assert.equal(f.timers.size,0);
  }
});

test('born B draws continuous solid arms without a second flat proximal crop',()=>{
  assert.equal(Motion.armFlapCoverage(.374,.705),1);assert.equal(Motion.armFlapCoverage(.55,.75),1);
  for(const key of bornAppearances.concat(null)){
    const f=fixture({captureVolumes:true,options:{appearanceKey:key,outfit:'cloth_cream_vest'}});f.complete();const resources=f.created.length;
    for(const cue of['body_flap','body_hands','feeding','idle']){
      f.api.setSituation(cue,{elapsedMs:1600});const calls=f.drawCalls.slice(-9),hands=calls.filter(row=>row.part===7||row.part===8);
      assert.equal(hands.length,2);assert.equal(calls.filter(row=>row.volume).length,2);
      for(const hand of hands){assert.equal(hand.first,0);assert.notStrictEqual(hand.buffer,f.buffers[0].buffer);const data=hand.volumeData;let proximal=0,palm=0;
        for(let i=0;i<data.length;i+=9){if(data[i+8]===0)proximal++;else palm++;}
        if(key)assert.equal(proximal,0,'no dangling flat upper-arm copy remains behind the solid arm');
        else assert.ok(proximal>30,'legacy chest-facing shoulders keep their separate layout');
        assert.ok(palm>300,'one rounded 3D surface carries the hand');
      }
    }
    assert.equal(f.created.length,resources);f.api.destroy();assert.equal(f.created.length,f.deleted.length);
  }
});

function palmSummary(vertices){
  let area=0,material=0,weight=0,minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(let i=0;i<vertices.length;i+=27)if(vertices[i+8]>.5){
    const a=Math.abs((vertices[i+9]-vertices[i])*(vertices[i+19]-vertices[i+1])-(vertices[i+10]-vertices[i+1])*(vertices[i+18]-vertices[i]))/2;area+=a;
    for(let k=0;k<3;k++){const at=i+k*9,w=a*vertices[at+4];weight+=w;material+=vertices[at+8]*w;minX=Math.min(minX,vertices[at]);maxX=Math.max(maxX,vertices[at]);minY=Math.min(minY,vertices[at+1]);maxY=Math.max(maxY,vertices[at+1]);}
  }
  return{area,material:material/weight,minX,maxX,minY,maxY};
}
function palmAlphaAt(vertices,x,y){
  let alpha=0;
  for(let i=0;i<vertices.length;i+=27)if(vertices[i+8]>.5){
    const ax=vertices[i],ay=vertices[i+1],bx=vertices[i+9],by=vertices[i+10],cx=vertices[i+18],cy=vertices[i+19],det=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
    if(Math.abs(det)<1e-14)continue;
    const a=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/det,b=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/det,c=1-a-b;
    if(a>=-1e-8&&b>=-1e-8&&c>=-1e-8)alpha=Math.max(alpha,a*vertices[i+4]+b*vertices[i+13]+c*vertices[i+22]);
  }
  return alpha;
}

test('baby and mature palms have real thickness and distinguish front, side and back without stretching their shoulders',()=>{
  assert.equal(Object.isFrozen(Motion.handVolumeProfiles),true);
  for(const family of Object.values(Motion.handVolumeProfiles))for(const profile of Object.values(family)){
    assert.equal(Object.isFrozen(profile),true);assert.equal(Object.isFrozen(profile.center),true);assert.equal(Object.isFrozen(profile.shoulder),true);
    assert.ok(profile.depth>profile.minor*.6&&profile.depth<profile.minor,'a shallow solid mitten, not a paper plane or round ball');
  }
  assert.ok(Motion.handVolumeProfiles.baby.arm_l.major<Motion.handVolumeProfiles.mature.arm_l.major*.4,'newborn hands remain short');
  for(const key of bornAppearances.concat(null))for(const side of['arm_l','arm_r']){
    const frame=Motion.handVolumeFrame(1,'idle',1,'final','balanced',1,key),summaries=[],proximal=[];
    for(const twist of[0,Math.PI/2,Math.PI]){
      frame.twists[side]=twist;const mesh=Motion.handVolumeMesh(frame,side);summaries.push(palmSummary(mesh));
      proximal.push(Array.from(mesh).filter((_,i)=>mesh[Math.floor(i/9)*9+8]===0));
    }
    if(key)assert.ok(proximal.every(p=>p.length===0),'born arms have no second flat surface');
    else {assert.deepEqual(proximal[0],proximal[1],'legacy wrist rotation leaves the original shoulder drawing fixed');assert.deepEqual(proximal[0],proximal[2]);}
    assert.ok(summaries[1].area/summaries[0].area>.6&&summaries[1].area/summaries[0].area<.94,'side view retains visible thickness while becoming narrower');
    assert.ok(Math.abs(summaries[2].area/summaries[0].area-1)<.001,'turning the palm over preserves its mitten size');
    assert.ok(summaries[0].material<1.02&&summaries[1].material>1.4&&summaries[1].material<1.6&&summaries[2].material>1.98,'the visible surface changes from palm through side to back');
  }
});

test('convex palm meshes have opaque interiors with feathered edges and no twisted white stripe',()=>{
  for(const key of bornAppearances.concat(null))for(const side of['arm_l','arm_r'])for(const twist of[0,1.05,2.08,Math.PI]){
    const frame=Motion.handVolumeFrame(3.8,'body_flap',3.8,'final','balanced',1,key);frame.twists[side]=twist;
    const mesh=Motion.handVolumeMesh(frame,side),profile=Motion.handVolumeProfiles[frame.family][side];
    const center=Motion.rigPoint(frame.rig,side,...profile.center,'final','balanced'),cx=center.x*2-1,cy=1-center.y*2;
    for(const dx of[-.3,0,.3])for(const dy of[-.3,0,.3]){
      // Sample the measured palm itself; the continuous forearm is now longer
      // than that palm and must not enlarge this interior test rectangle.
      const radius=Math.min(profile.minor,profile.depth)*.9;
      const p=Motion.rigPoint(frame.rig,side,profile.center[0]+dx*radius,profile.center[1]+dy*radius,'final','balanced');
      const x=p.x*2-1,y=1-p.y*2;
      assert.ok(palmAlphaAt(mesh,x,y)>.97,key+side+twist+': no hole through the central palm');
    }
    let solid=0,feather=0;
    for(let i=0;i<mesh.length;i+=9)if(mesh[i+8]>.5){
      assert.ok(Math.abs(Math.hypot(mesh[i+5],mesh[i+6],mesh[i+7])-1)<1e-6,'unit soft-light normal');
      if(mesh[i+4]===1)solid++;else if(mesh[i+4]>0&&mesh[i+4]<1)feather++;
      if(mesh[i+7]>.1)assert.equal(mesh[i+4],1,'front-facing interior never becomes translucent');
    }
    assert.ok(solid>600&&feather>0,'soft silhouette retains an opaque palm');
    for(let i=0;i<mesh.length;i+=27)if(mesh[i+8]>.5){
      const cross=(mesh[i+9]-mesh[i])*(mesh[i+19]-mesh[i+1])-(mesh[i+10]-mesh[i+1])*(mesh[i+18]-mesh[i]);assert.ok(cross<0,'one consistently visible convex surface');
    }
  }
});

test('born arms stay opaque from shoulder to fingertips, with fixed sockets through wrist twists',()=>{
  for(const key of ['newborn','adult','grown'])for(const side of ['arm_l','arm_r'])for(const cue of ['idle','body_hands','body_flap','feeding']){
    const frame=Motion.handVolumeFrame(2.3,cue,2.3,'final','balanced',1,key),profile=Motion.handVolumeProfiles.baby[side];
    const dx=profile.center[0]-profile.shoulder[0],dy=profile.center[1]-profile.shoulder[1],length=Math.hypot(dx,dy),ux=dx/length,uy=dy/length;
    const start=[profile.shoulder[0]-.012*ux,profile.shoulder[1]-.012*uy],end=[profile.center[0]+profile.major*ux,profile.center[1]+profile.major*uy];
    const expected=Motion.rigPoint(frame.rig,side,...start,'final','balanced');
    for(const twist of [-2.25,0,2.25]){
      frame.twists[side]=twist;const mesh=Motion.handVolumeMesh(frame,side);let socket=0;
      for(let at=0;at<mesh.length;at+=9){
        assert.ok(mesh[at+8]>.5,'only one connected volume is drawn');
        if(Math.hypot(mesh[at+2]-start[0],mesh[at+3]-start[1])<1e-6){
          assert.ok(Math.hypot((mesh[at]+1)/2-expected.x,(1-mesh[at+1])/2-expected.y)<1e-6);socket++;
        }
      }
      assert.ok(socket>0,'the actual socket vertices are present, not an empty proximal array');
      for(let t=.12;t<.96;t+=.04){
        const x=start[0]+(end[0]-start[0])*t,y=start[1]+(end[1]-start[1])*t,p=Motion.rigPoint(frame.rig,side,x,y,'final','balanced');
        assert.ok(palmAlphaAt(mesh,p.x*2-1,1-p.y*2)>.97,`${key} ${side} ${cue} ${twist}: no gap along the arm`);
      }
    }
  }
});

test('the head owns the cheeks and chin without collecting separate original shoulder pixels',()=>{
  const polygon=Motion.nurseryRigParts.find(p=>p.id==='head').polygon;
  function inside(x,y){let hit=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;
  }return hit;}
  for(const [x,y]of [[.400,.665],[.700,.660],[.713,.665]]){
    assert.ok(pngPixel('pet_lilac_reference_v2.png',x,y)[3]>128,'the original shoulder really contains visible pixels');
    assert.equal(inside(x,y),false,'a head tilt cannot move a second shoulder/arm');
  }
  for(const [x,y]of [[.400,.640],[.700,.620],[.550,.640],[.450,.648]])assert.equal(inside(x,y),true,'visible cheek and central chin remain intact');
});

test('the armless torso keeps its own alpha rather than inheriting the original arm-shaped cutout',()=>{
  for(const [x,y]of [[.724,.794],[.730,.820],[.346,.846],[.378,.882]]){
    const uv=Motion.nurseryFaceUV(7,x,y);
    assert.equal(pngPixel('pet_lilac_reference_v2.png',x,y)[3],0);
    assert.ok(pngPixel('pet_lilac_baby_expressions_v1.png',uv.x,uv.y)[3]>230,'registered armless body fills the old cutout');
  }
  const baby=fixture({options:{appearanceKey:'adult'}});baby.complete();
  assert.match(baby.shaders[1],/if\(torsoPart>\.5\)a=nurserySample\(u_sad,/);
  assert.doesNotMatch(baby.shaders[1],/if\(torsoPart>\.5\)a=min\(a,nurserySample/);baby.api.destroy();
  const legacy=fixture();legacy.complete();assert.doesNotMatch(legacy.shaders[1],/a=nurserySample/);legacy.api.destroy();
});

test('rounded hands stay finite and inside the canvas across born appearances, fur paths and strong cue extremes',()=>{
  const f=fixture();f.complete();const capacity=f.buffers[1].data.length;f.api.destroy();
  const target=new Float32Array(capacity),scratch=new Float64Array(21*24*10);
  for(const appearance of Motion.appearanceCatalogue.filter(row=>row.family!=='egg'))for(const path of Motion.evolutionCatalogue){
    const stage=appearance.family==='baby'?'child':appearance.key==='grown'?'final':appearance.key;
    for(const [cue,age]of[['idle',0],['body_flap',1.2],['body_flap',2.4],['body_flap',3.8],['body_hands',1.2],['body_hands',3.8],['feeding',2],['feeding',5.4],['body_joy',1.8]]){
      const frame=Motion.handVolumeFrame(age,cue,age,stage,path.key,1.15,appearance.key);frame.scratch=scratch;
      for(const side of['arm_l','arm_r']){
        const mesh=Motion.handVolumeMesh(frame,side,target);assert.strictEqual(mesh.buffer,target.buffer);assert.ok(mesh.length>0&&mesh.length<=capacity);assert.equal(mesh.length%27,0,'whole triangles fit the allocated shared VBO');
        for(let i=0;i<mesh.length;i+=9){
          for(let j=0;j<9;j++)assert.ok(Number.isFinite(mesh[i+j]),appearance.key+cue+': finite vertex attribute');
          assert.ok(mesh[i]>=-1&&mesh[i]<=1&&mesh[i+1]>=-1&&mesh[i+1]<=1,appearance.key+cue+': no palm clipping at maximum size');
          assert.ok(mesh[i+2]>=0&&mesh[i+2]<=1&&mesh[i+3]>=0&&mesh[i+3]<=1,'fur UV remains on the original source');
          assert.ok(mesh[i+4]>=0&&mesh[i+4]<=1);assert.ok(mesh[i+8]===0||(mesh[i+8]>=1&&mesh[i+8]<=2));
        }
      }
    }
  }
  assert.throws(()=>Motion.handVolumeMesh(Motion.handVolumeFrame(1,'idle',1,'final','balanced',1,'grown'),'arm_l',new Float32Array(27)),/hand_mesh_capacity/,'undersized external scratch fails rather than returning truncated triangles');
  for(const key of['egg','egg_cracked','hatching'])assert.equal(Motion.handVolumeMesh(Motion.handVolumeFrame(1,'body_flap',1,'egg','balanced',1,key),'arm_l').length,0,'eggs do not acquire arms');
});

test('hand waves, paired flaps, joy and meals turn the wrists and release to the same underlying idle',()=>{
  for(const key of bornAppearances.concat(null))for(const cue of['body_hands','body_flap','body_joy','feeding']){
    const duration=Motion.durations[cue]/1000,values=[];
    for(const age of[.8,1.2,1.8,2.4,3.8,5.2])values.push(Motion.handVolumeFrame(age,cue,age,'final','balanced',1,key).twists.arm_l);
    assert.ok(Math.max(...values)-Math.min(...values)>.8,cue+': visible wrist turn rather than a uniformly rotating flat drawing');
    assert.deepEqual(Motion.handVolumeFrame(9,cue,duration,'final','balanced',1,key).twists,Motion.handVolumeFrame(9,'idle',duration,'final','balanced',1,key).twists,'finite acts leave no wrist pose behind');
  }
});

test('hand materials preserve upper-arm fur, cap the exposed wrist spike and restore the eighth attribute on all other passes',()=>{
  for(const key of bornAppearances.concat(null)){
    const f=fixture({captureVolumes:true,options:{appearanceKey:key,outfit:'cloth_cream_vest'}});f.complete();const resources=f.created.length,fragment=f.shaders[1];
    assert.match(fragment,/handUpperMask\(vec2 p\)/);assert.match(fragment,/smoothstep\(-\.025,-\.012,along\)/,'old crop behind the shoulder cannot form an extra triangular finger');
    assert.match(fragment,/if\(volume>\.5\)a=v_coverage/,'the solid mitten cannot reveal cream torso through source alpha');
    assert.match(fragment,/rgb\*=\.90\+\.12\*diffuse/);assert.doesNotMatch(fragment,/specular|shininess|reflect\(/,'no hard plastic highlight');
    assert.equal([...fragment.matchAll(/uniform vec4 ([^;]+);/g)].reduce((n,row)=>n+row[1].split(',').length,0),8);assert.equal(Object.keys(f.samplers).length,8);assert.equal(f.maxActiveUnit,7);
    f.api.setSituation('body_flap',{elapsedMs:3800});const arms=f.drawCalls.slice(-9).filter(row=>row.volume);
    for(const arm of arms){assert.equal(arm.count*9,arm.volumeData.length);assert.equal(arm.volumeData.length%27,0);assert.ok(arm.volumeData.length<=f.buffers[1].data.length);}
    for(const cue of['direction_back','room_walk_right']){f.api.setSituation(cue,{elapsedMs:2200});assert.equal(f.drawCalls.at(-1).volume,false,'atlas pass cannot inherit a palm normal or fur mask');}
    f.api.setSituation('feeding',{elapsedMs:1800});assert.equal(f.drawCalls.at(-1).volume,true);assert.deepEqual(f.constants[7],[0,0,1,0],'all hand draws restore the ordinary material before the next part');
    assert.equal(f.created.length,resources+1,'only the pre-existing turn VBO is added');assert.equal(f.raf.size,1);
    f.reduce(true);const idle=Array.from(f.drawCalls.at(-1).volumeData);f.api.setSituation('body_flap',{elapsedMs:1800});assert.deepEqual(Array.from(f.drawCalls.at(-1).volumeData),idle,'reduced motion holds neutral hands');
    f.api.destroy();assert.equal(f.created.length,f.deleted.length);assert.equal(f.raf.size,0);assert.equal(f.timers.size,0);
  }
});

test('ear and tail sockets stay attached while head parenting and independent demonstrations are visible',()=>{
  const ears=Motion.rigPose(1.1,'body_ears',1.1),head=Motion.rigPose(1.1,'body_head',1.1),tail=Motion.rigPose(1.1,'body_tail',1.1);
  assert.ok(Math.abs(ears.angles.ear_l-ears.angles.ear_r)>.3);assert.equal(ears.angles.head,0);
  assert.ok(Math.abs(head.angles.head)>.05);assert.equal(head.angles.arm_l,0);assert.equal(head.angles.arm_r,0);
  for(const id of ['ear_l','ear_r']){
    const part=Motion.rigParts.find(row=>row.id===id),socket=Motion.rigPoint(ears,id,...part.pivot),parent=Motion.rigPoint(ears,'head',...part.pivot);
    assert.ok(Math.hypot(socket.x-parent.x,socket.y-parent.y)<1e-12);
    assert.deepEqual(head.matrices[id],head.matrices.head,id+': inherits head with no local ear rotation');
  }
  const part=Motion.rigParts.find(row=>row.id==='tail'),socket=Motion.rigPoint(tail,'tail',...part.pivot),body=Motion.rigPoint(tail,'torso',...part.pivot);
  assert.ok(Math.hypot(socket.x-body.x,socket.y-body.y)<1e-12);assert.ok(Math.abs(tail.angles.tail)>.3);
  assert.equal(tail.angles.head,0);assert.equal(tail.angles.arm_l,0);assert.equal(tail.angles.arm_r,0);
});

test('alternating feet keep the stance sole on the floor while the other foot lifts',()=>{
  for(const stage of growthKeys)for(const path of Motion.evolutionCatalogue){
    for(const age of [.9,1.5]){
      const frame=Motion.rigPose(age,'body_feet',age,stage,path.key);
      const soles=['foot_l','foot_r'].map(id=>{const part=Motion.rigParts.find(row=>row.id===id);return Motion.rigPoint(frame,id,part.pivot[0],.92,stage,path.key).y;});
      assert.ok(Math.abs(Math.max(...soles)-.92)<1e-12);
      assert.ok(Math.max(...soles)-Math.min(...soles)>.015,stage+path.key+': distinct lifted foot');
      assert.equal(frame.angles.arm_l,0);assert.equal(frame.angles.arm_r,0);
    }
  }
});

test('all 107 rig cues enter and settle without erasing an in-progress idle hand wave',()=>{
  for(const name of [...Motion.situations,...Motion.bodyCatalogue.map(row=>row.id)].filter(name=>name!=='idle')){
    const duration=Motion.durations[name]/1000;
    for(const age of [0,.00001,duration-.00001]){
      const active=Motion.rigPose(7.8,name,age),idle=Motion.rigPose(7.8,'idle',age);
      for(const id of Object.keys(idle.matrices))for(let i=0;i<6;i++)assert.ok(Math.abs(active.matrices[id][i]-idle.matrices[id][i])<.001,name+id+': boundary');
    }
  }
});

test('transparent clear, premultiplied compositing and temporary cleanplate binding happen once per rig frame',()=>{
  const f=fixture();f.complete();const textures=f.created.filter(row=>row.type==='Texture');
  assert.deepEqual(f.blend,[[f.gl.ONE,f.gl.ONE_MINUS_SRC_ALPHA]]);assert.ok(f.enabled.includes(f.gl.BLEND));
  assert.equal(f.canvas.contextOptions.premultipliedAlpha,true);assert.equal(f.maxActiveUnit,7);
  assert.deepEqual(Object.values(f.samplers),[0,1,2,3,4,5,6,7]);
  for(const call of f.drawCalls)assert.strictEqual(call.texture4,call.part===1?textures[8]:call.part===6?textures[0]:textures[4]);
  assert.strictEqual(f.boundTextures[4],textures[4]);assert.equal(f.clears,1);assert.equal(f.updates,3);
  f.api.setSituation('body_hands',{elapsedMs:1200});assert.equal(f.drawCalls.length,18);assert.equal(f.clears,2);assert.equal(f.updates,6);
  assert.deepEqual(f.drawCalls.slice(9).map(call=>call.part),Motion.rigParts.map(row=>row.index));f.api.destroy();
});

test('the cleanplate cannot sample its generated face and clothing fills the old hand holes on the torso',()=>{
  for(const part of Motion.rigParts)for(const [x,y]of part.polygon){
    const uv=Motion.torsoMaterialPoint(x,y);assert.ok(uv.y>=.7&&uv.y<=1);assert.ok(uv.x>=0&&uv.x<=1);
  }
  for(const outfit of Motion.outfitCatalogue){
    assert.ok(Motion.outfitCoverage(outfit.id,.5,.8,true)>.5,outfit.id+': cloth behind lifted hands');
    assert.ok(Motion.outfitCoverage(outfit.id,.5,.8)<.1,outfit.id+': legacy source-paw exclusion');
    assert.equal(Motion.outfitCoverage(outfit.id,.6,.4,true),0);
  }
});

test('feeding anchors follow the exact head rig in the same frame and stop while hidden or after food disappears',()=>{
  for(const stage of growthKeys)for(const path of Motion.evolutionCatalogue){
    const frames=[],f=fixture({options:{growthStage:stage,evolutionPath:path.key,onPose:frame=>frames.push(frame)}});f.complete();assert.equal(frames.length,0);
    f.api.setSituation('feeding',{elapsedMs:2200});assert.equal(frames.length,1);
    const frame=frames[0],rig=Motion.rigPose(0,'feeding',2.2,stage,path.key);
    assert.equal(frame.situation,'feeding');assert.equal(frame.elapsedMs,2200);
    assert.ok(Math.abs(frame.mouthX-rig.mouth.x)<1e-12&&Math.abs(frame.mouthY-rig.mouth.y)<1e-12);
    assert.equal(frame.foodLeft,frame.mouthX-.11);assert.equal(frame.foodTop,frame.mouthY+.005);
    assert.ok([frame.foodLeft,frame.foodTop,frame.mouthX,frame.mouthY].every(value=>Number.isFinite(value)&&value>=0&&value<=1));
    f.hide(true);f.advance(100);assert.equal(frames.length,1);f.hide(false);assert.equal(frames.length,2);
    f.api.setSituation('feeding',{elapsedMs:4400});assert.equal(frames.length,2);
    f.api.destroy();f.advance();assert.equal(frames.length,2);
  }
  const frames=[],reduced=fixture({reduced:true,options:{onPose:frame=>frames.push(frame)}});reduced.complete();reduced.api.setSituation('feeding',{elapsedMs:2200});
  assert.equal(frames.length,1);const rest=Motion.rigPose(0,'idle',0);assert.equal(frames[0].mouthY,rest.mouth.y);assert.equal(reduced.raf.size,0);reduced.api.destroy();
});

test('the original eight facial images and the independent clean torso must all load before drawing',()=>{
  const f=fixture();for(const image of f.images.slice(0,8)){image.complete=true;image.naturalWidth=image.naturalHeight=1000;image.onload();}
  assert.equal(f.ready,0);assert.equal(f.draws,0);f.images[8].onerror(new Error('private plate path'));
  assert.deepEqual(f.errors,['image_failed']);assert.equal(f.ready,0);assert.equal(f.created.length,f.deleted.length);
});

test('food anchors follow the measured mouth through growth and the fixed camera without an obsolete cue inset', () => {
  const anchors = new Set();
  for (const stage of growthKeys) {
    const anchor = Motion.feedingAnchor(stage),rig=Motion.rigPose(0,'idle',0,stage);
    const mouth=Motion.rigPoint(rig,'head',.628,.499,stage);
    assert.equal(anchor.x,mouth.x);assert.equal(anchor.y,mouth.y);
    assert.equal(anchor.foodLeft, anchor.x-.11); assert.equal(anchor.foodTop, anchor.y+.005);
    // The apple begins below the mouth, rather than covering the nose or eyes.
    // Its upper edge stays within one tenth of the .14-high prop from the mouth.
    assert.ok(anchor.foodTop >= anchor.y && anchor.foodTop-anchor.y <= .14*.1, stage + ': upper bite edge');
    assert.ok(anchor.x >= anchor.foodLeft && anchor.x <= anchor.foodLeft+.16, stage + ': mouth over apple');
    anchors.add(JSON.stringify(anchor));
  }
  assert.equal(anchors.size, 6);
  for(const key of bornAppearances)for(const path of Motion.evolutionCatalogue){
    const anchor=Motion.feedingAnchor('adult',path.key,key),rig=Motion.rigPose(0,'idle',0,'adult',path.key,1,key);
    const mouth=Motion.rigPoint(rig,'head',...Motion.nurseryLandmarks.mouth,'adult',path.key);
    assert.equal(anchor.x,mouth.x);assert.equal(anchor.y,mouth.y);assert.equal(anchor.foodTop,mouth.y+.005);
  }
});

test('growth changes idle and walking cadence while every meal phase and emotion deadline stays unchanged', () => {
  const idle = new Set(), walks = new Set(), neutralMeal = Motion.pose(2.2,'feeding',2.2,'child');
  for (const stage of growthKeys) {
    idle.add(Motion.pose(1.2,'idle',0,stage).breath); walks.add(Motion.pose(.33,'moving',.33,stage).step);
    assert.equal(Motion.pose(2.2,'feeding',2.2,stage).chew, neutralMeal.chew);
    assert.equal(Motion.pose(5.5,'feeding',5.5,stage).faceDelighted, 1);
    for (const situation of Motion.situations) {
      const duration = Motion.durations[situation]/1000;
      if (duration) assert.deepEqual(Motion.pose(9,situation,duration,stage), Motion.pose(9,'idle',0,stage));
    }
  }
  assert.equal(idle.size,6); assert.equal(walks.size,6);
  assert.deepEqual(Motion.pose(1.2,'idle',0),Motion.pose(1.2,'idle',0,'child'));
});

test('six evolution palettes are frozen and unknown paths keep the original balanced B', () => {
  assert.deepEqual(Motion.evolutionCatalogue.map(x=>[x.key,x.label,x.colorName,x.color]),[
    ['balanced','のんびり','薄紫','#b5a0d9'],['fruit','はなほっぺ','桃色','#d99eae'],
    ['hearty','ぽかぽか','はちみつ色','#d2ad70'],['sweet','おやつっこ','杏色','#dfa88b'],
    ['active','そよかぜ','空色','#92b4d1'],['calm','まどろみ','ミント色','#9dbfb0']
  ]);
  assert.equal(Object.isFrozen(Motion.evolutionCatalogue),true);
  const shapes=new Set();
  Motion.evolutionCatalogue.forEach((profile,index)=>{
    assert.equal(profile.index,index); assert.equal(Object.isFrozen(profile),true); assert.equal(Object.isFrozen(profile.rgb),true);
    assert.deepEqual(profile.rgb,[1,3,5].map(start=>parseInt(profile.color.slice(start,start+2),16)/255));
    assert.strictEqual(Motion.evolutionProfile(profile.key),profile);
    shapes.add(JSON.stringify([Motion.growthPoint('child',.16,.34,profile.key),Motion.growthPoint('child',.78,.49,profile.key),Motion.growthPoint('child',.14,.75,profile.key)]));
  });
  assert.equal(shapes.size,6);
  for(const bad of [null,undefined,'unknown','__proto__',{},1])assert.strictEqual(Motion.evolutionProfile(bad),Motion.evolutionCatalogue[0]);
});

test('balanced and unknown paths preserve the previous geometry, motion, food anchor and outfit values exactly', () => {
  const base=fixture({options:{growthStage:'adult',outfit:'cloth_flower_dress'}}); base.complete(); base.api.setSituation('feeding',{elapsedMs:2200});
  for(const evolutionPath of ['balanced','unknown',null]){
    const f=fixture({options:{growthStage:'adult',outfit:'cloth_flower_dress',evolutionPath}}); f.complete(); f.api.setSituation('feeding',{elapsedMs:2200});
    assert.deepEqual(f.buffers[0].data,base.buffers[0].data); assert.deepEqual(f.uniforms,base.uniforms); assert.deepEqual(f.constants,base.constants);
    assert.deepEqual(Motion.feedingAnchor('adult',evolutionPath),Motion.feedingAnchor('adult'));
    for(const name of Motion.situations)assert.deepEqual(Motion.pose(.73,name,.73,'adult',evolutionPath),Motion.pose(.73,name,.73,'adult'));
    f.api.destroy();
  }
  base.api.destroy();
});

test('all evolution and growth combinations retain body rigs, food fallback, uniforms and every cue',()=>{
  for(const stage of growthKeys)for(const path of Motion.evolutionCatalogue){
    const outfit=Motion.outfitCatalogue[path.index],f=fixture({options:{growthStage:stage,evolutionPath:path.key,outfit:outfit.id}});f.complete();
    assert.deepEqual(f.bindings,[[0,'a_position'],[1,'a_uv'],[2,'a_evolution'],[3,'a_coverage'],[4,'a_part'],[6,'a_mouthMode'],[7,'a_handVolume']]);
    assert.deepEqual(f.disabledAttributes.slice(0,4),[4,2,6,7]);assert.deepEqual(f.constants[2],[...path.rgb,path.index]);
    inspectRigMesh(f,stage,path.key);assert.equal(Object.values(f.uniforms).filter(x=>Array.isArray(x)&&x.length===4).length,8);
    const anchor=Motion.feedingAnchor(stage,path.key);assert.equal(anchor.foodTop,anchor.y+.005);assert.equal(anchor.foodLeft,anchor.x-.11);
    for(const name of [...Motion.situations,...Motion.bodyCatalogue.map(row=>row.id)]){
      f.api.setSituation(name,{elapsedMs:Math.min(1000,Motion.durations[name]/2)});
      assert.equal(Math.floor(f.uniforms.u_effect[3]/2),outfit.index);assert.equal(f.raf.size,1);
      for(const values of Object.values(f.uniforms))assert.ok((Array.isArray(values)?values:[values]).every(Number.isFinite));
      for(const fraction of [.1,.5,.9]){
        const age=Motion.durations[name]/1000*fraction,rig=Motion.rigPose(age,name,age,stage,path.key);
        assert.ok(rig.mouth.x>=0&&rig.mouth.x<=1&&rig.mouth.y>=0&&rig.mouth.y<=1,name+': mouth bounds');
        for(const matrix of Object.values(rig.matrices))assert.ok(matrix.every(Number.isFinite));
      }
      if(Motion.durations[name])assert.deepEqual(Motion.pose(10,name,Motion.durations[name]/1000,stage,path.key),Motion.pose(10,'idle',0,stage,path.key));
    }
    assert.equal(f.maxActiveUnit,7);assert.equal(Motion.pose(2.2,'feeding',2.2,stage,path.key).chew,Motion.pose(2.2,'feeding',2.2,stage,'balanced').chew);
    f.reduce(true);assert.equal(f.raf.size,0);assert.equal(f.uniforms.u_presence,0);assert.deepEqual(f.constants[2],[...path.rgb,path.index]);
    f.api.destroy();assert.equal(f.deleted.length,f.created.length);
  }
});

test('fur palettes preserve source shading and protect cream cheeks, eyes, mouth and expressive features', () => {
  const fur=[.77,.66,.86],cream=[.96,.89,.78],iris=[.19,.10,.4],mouth=[.76,.25,.36],colors=new Set();
  const lum=rgb=>rgb[0]*.299+rgb[1]*.587+rgb[2]*.114;
  for(const path of Motion.evolutionCatalogue){
    const tinted=Motion.evolutionFurColor(path.key,.30,.8,fur); colors.add(JSON.stringify(tinted));
    assert.ok(tinted.every(x=>Number.isFinite(x)&&x>=0&&x<=1)); assert.ok(Math.abs(lum(tinted)-lum(fur))<1e-12);
    for(const [x,y]of[[.397,.575],[.795,.482]])assert.deepEqual(Motion.evolutionFurColor(path.key,x,y,cream),cream);
    for(const [x,y]of[[.4665,.429],[.7281,.3405]])assert.deepEqual(Motion.evolutionFurColor(path.key,x,y,iris),iris);
    assert.deepEqual(Motion.evolutionFurColor(path.key,.628,.499,mouth),mouth);
    // A brown expressive eyebrow is retained even when the base image there was fur.
    assert.deepEqual(Motion.evolutionFurColor(path.key,.45,.28,fur,[.48,.29,.27]),[.48,.29,.27]);
    assert.deepEqual(fur,[.77,.66,.86]);
  }
  assert.equal(colors.size,6);
  const dark=Motion.evolutionFurColor('active',.30,.8,fur.map(x=>x*.65)),light=Motion.evolutionFurColor('active',.30,.8,fur);
  assert.ok(lum(light)>lum(dark));
});

test('actual original pink-lilac crown, both paws and torso receive the full pastel fur change', () => {
  // Read-only samples from the fixed 1000px pet_lilac_original.webp. In these
  // fur regions red exceeds blue, so a blue-minus-red gate left them unchanged.
  const samples=[
    {name:'left paw',x:.527,y:.743,rgb:[204,168,205]},
    {name:'right paw',x:.718,y:.729,rgb:[218,182,194]},
    {name:'crown highlight',x:.60,y:.20,rgb:[237,204,225]},
    {name:'crown',x:.58,y:.23,rgb:[234,201,221]},
    {name:'torso',x:.50,y:.67,rgb:[164,123,151]}
  ];
  const lum=rgb=>rgb[0]*.299+rgb[1]*.587+rgb[2]*.114;
  for(const sample of samples){
    const source=sample.rgb.map(x=>x/255);
    assert.deepEqual(Motion.evolutionFurColor('balanced',sample.x,sample.y,source),source);
    for(const path of Motion.evolutionCatalogue.filter(p=>p.key!=='balanced')){
      const rendered=Motion.evolutionFurColor(path.key,sample.x,sample.y,source);
      const target=path.rgb.map(x=>Math.max(0,Math.min(1,x*lum(source)/lum(path.rgb))));
      const expected=source.map((x,i)=>x+(target[i]-x)*.92);
      rendered.forEach((x,i)=>assert.ok(Math.abs(x-expected[i])<1e-12,path.key+': '+sample.name));
      assert.ok(Math.hypot(...rendered.map((x,i)=>x-source[i]))>.04,path.key+': visible '+sample.name);
    }
  }
});

test('actual cream cheek and warm inner ear samples remain unchanged after the broader fur selection', () => {
  const samples=[{x:.40,y:.58,rgb:[228,157,147]},{x:.20,y:.34,rgb:[228,171,158]},
    {x:.58,y:.86,rgb:[197,162,149]},{x:.62,y:.44,rgb:[211,130,137]}];
  for(const path of Motion.evolutionCatalogue)for(const sample of samples){
    const source=sample.rgb.map(x=>x/255);
    assert.deepEqual(Motion.evolutionFurColor(path.key,sample.x,sample.y,source),source,path.key);
  }
});

test('evolution paths keep fallbacks and resource cleanup intact without extra image loads', () => {
  const failed=fixture({compileFailure:true,options:{evolutionPath:'active',outfit:'cloth_mint_knit'}});
  assert.equal(failed.errors.length,1);assert.equal(failed.deleted.length,failed.created.length);assert.equal(failed.images.length,0);
  const image=fixture({options:{evolutionPath:'calm'}});image.images[7].onerror();assert.deepEqual(image.errors,['image_failed']);assert.equal(image.canvas.hidden,true);
  const f=fixture({options:{evolutionPath:'fruit',releaseContextOnDestroy:true}});f.complete();
  f.api.setSituation('feeding',{elapsedMs:2200});f.hide(true);const draws=f.draws;f.advance(30000);assert.equal(f.draws,draws);
  f.hide(false);assert.equal(f.uniforms.u_chew,0);assert.equal(f.images.length,15);f.api.destroy();assert.equal(f.released,1);assert.equal(f.raf.size,0);
});

test('clothing allowlist is frozen, has six real garment styles and never accepts arbitrary outfit values', () => {
  assert.deepEqual(Motion.outfitCatalogue.map(x=>[x.id,x.price]), [
    ['cloth_cream_vest',0],['cloth_rose_cape',30],['cloth_sky_overalls',45],
    ['cloth_mint_knit',40],['cloth_star_pajamas',55],['cloth_flower_dress',65]
  ]);
  assert.equal(Object.isFrozen(Motion.outfitCatalogue),true);
  const appearances=new Set();
  Motion.outfitCatalogue.forEach((entry,index)=>{
    assert.equal(entry.index,index+1); assert.ok(entry.label && entry.style);
    assert.equal(Object.isFrozen(entry),true); assert.equal(Object.isFrozen(entry.color),true);
    assert.strictEqual(Motion.outfitProfile(entry.id),entry);
    appearances.add(JSON.stringify([entry.style,entry.color,entry.trim]));
  });
  assert.equal(appearances.size,6);
  for(const bad of [null,undefined,'unknown','__proto__',1,{},['cloth_cream_vest']]) {
    assert.equal(Motion.outfitProfile(bad),null); assert.equal(Motion.outfitCoverage(bad,.5,.85),0);
  }
});

test('garment coverage stays on the torso while face, ears, paws, feet and fur outline stay clear', () => {
  const protectedPoints=[[.61,.50],[.46,.43],[.73,.34],[.17,.345],[.82,.16],[.155,.728],
    [.527,.743],[.718,.729],[.41,.905],[.69,.905],[.23,.78],[.80,.80],[.50,.68]];
  for(const outfit of Motion.outfitCatalogue) {
    let visible=0;
    for(let row=0;row<=100;row++) for(let col=0;col<=100;col++) {
      const x=col/100,y=row/100,coverage=Motion.outfitCoverage(outfit.id,x,y);
      assert.ok(Number.isFinite(coverage) && coverage>=0 && coverage<=1,outfit.id);
      if(coverage>.5)visible++;
      if(x<.26||x>.79||y<.688||y>.891)assert.equal(coverage,0,outfit.id+': outside torso');
    }
    assert.ok(visible>150 && visible<500,outfit.id+': actual torso garment');
    for(const [x,y]of protectedPoints)assert.equal(Motion.outfitCoverage(outfit.id,x,y),0,outfit.id+': protected area');
    assert.equal(Motion.outfitCoverage(outfit.id,NaN,Infinity),0);
  }
});

test('outfit and anger share one existing lane with exact integer decode and preserve all other effects', () => {
  for(const outfit of [null,...Motion.outfitCatalogue.map(x=>x.id)]) {
    const expected=Motion.outfitProfile(outfit)?.index||0, f=fixture({options:{outfit}}); f.complete();
    for(const [age,anger]of [[0,0],[225,.5],[1000,1]]) {
      const neutral=fixture(); neutral.complete(); neutral.api.setSituation('angry',{elapsedMs:age});
      f.api.setSituation('angry',{elapsedMs:age});
      const packed=f.uniforms.u_effect[3];
      assert.equal(Math.floor(packed/2),expected); assert.equal(packed%2,anger);
      for(const key of ['u_motionA','u_motionB','u_motionC','u_body','u_gesture','u_face','u_detail'])assert.deepEqual(f.uniforms[key],neutral.uniforms[key],key);
      assert.deepEqual(f.uniforms.u_effect.slice(0,3),neutral.uniforms.u_effect.slice(0,3));
      neutral.api.destroy();
    }
    f.api.destroy(); assert.equal(f.deleted.length,f.created.length);
  }
});

test('no outfit, null and unknown outfits keep identical textures, geometry and all uniform values', () => {
  const base=fixture(); base.complete(); base.api.setSituation('feeding',{elapsedMs:2200});
  for(const outfit of [null,'missing',{},1]) {
    const f=fixture({options:{outfit}}); f.complete(); f.api.setSituation('feeding',{elapsedMs:2200});
    assert.deepEqual(f.uniforms,base.uniforms); assert.deepEqual(f.buffers[0].data,base.buffers[0].data);
    assert.deepEqual(f.images.map(x=>x.url),base.images.map(x=>x.url)); f.api.destroy();
  }
  base.api.destroy();
});

test('every outfit works through all six growth meshes and 100 cues without extra textures, vectors or loops', () => {
  for(const stage of growthKeys)for(const outfit of Motion.outfitCatalogue) {
    const f=fixture({options:{growthStage:stage,outfit:outfit.id}}); f.complete();
    assert.equal(f.uploads.length,15); assert.equal(f.created.filter(x=>x.type==='Texture').length,15);
    assert.equal(Object.values(f.uniforms).filter(x=>Array.isArray(x)&&x.length===4).length,8);
    for(const name of Motion.situations) {
      f.api.setSituation(name,{elapsedMs:Math.min(1000,Motion.durations[name]/2)});
      assert.equal(Math.floor(f.uniforms.u_effect[3]/2),outfit.index);
      assert.ok(f.uniforms.u_effect[3]%2>=0 && f.uniforms.u_effect[3]%2<=1);
      assert.equal(f.raf.size,1);
      for(const values of Object.values(f.uniforms))assert.ok((Array.isArray(values)?values:[values]).every(Number.isFinite));
    }
    f.reduce(true); assert.equal(f.raf.size,0); assert.equal(f.uniforms.u_blink,0);
    assert.equal(f.uniforms.u_effect[3],outfit.index*2); assert.equal(f.uniforms.u_presence,0);
    f.api.destroy(); assert.equal(f.deleted.length,f.created.length);
  }
  assert.equal(Motion.durations.feeding,8400);
});

test('all profiles stay finite, differ at meaningful samples and finish at the same idle', () => {
  const signatures = new Set();
  for (const name of Motion.situations) {
    for (const t of [-1, 0, .05, .5, 1.2, 3, 5, 100]) {
      const p = Motion.pose(t, name, t);
      Object.entries(p).forEach(([key, value]) => { if (key !== 'situation') assert.equal(Number.isFinite(value), true, name + ':' + key); });
      assert.ok(p.blink >= 0 && p.blink <= 1);
      assert.ok(Math.abs(p.tilt) <= .115 && Math.abs(p.chew) <= 1 && Math.abs(p.step) <= 1);
      assert.ok(Math.abs(p.bodyAngle) <= .09 && Math.abs(p.shiftX) <= .026);
      assert.ok(p.presence >= 0 && p.presence <= 1);
    }
    if (name !== 'idle') {
      const duration = Motion.durations[name] / 1000;
      assert.deepEqual(Motion.pose(9, name, duration), Motion.pose(9, 'idle', 0));
      const { situation, ...acting } = Motion.pose(.7, name, .7);
      signatures.add(JSON.stringify(acting));
    }
  }
  assert.equal(signatures.size, 99);
  assert.deepEqual(Motion.pose(NaN, 'unknown', Infinity), Motion.pose(0, 'idle', 0));
});

test('all 99 finite acts ease in and release every transform and face to the underlying idle', () => {
  for (const name of Motion.situations.filter(name => name !== 'idle')) {
    const duration = Motion.durations[name] / 1000;
    for (const age of [0, .00001, duration - .00001]) {
      const active = Motion.pose(3.3, name, age), idle = Motion.pose(3.3, 'idle', 0);
      for (const key of Object.keys(idle).filter(key => key !== 'situation')) {
        assert.ok(Math.abs(active[key] - idle[key]) < .001, name + ':' + age + ':' + key);
      }
    }
    for (let tick = 0; tick < 90; tick++) {
      const age = duration * tick / 90, p = Motion.pose(age + 3.3, name, age);
      for (const [key, value] of Object.entries(p)) if (key !== 'situation') assert.ok(Number.isFinite(value), name + ':' + key);
      assert.ok(p.faceSad + p.faceAngry + p.faceSurprise + p.faceDelighted <= 1.000001, name);
      assert.ok(p.faceSad >= 0 && p.faceAngry >= 0 && p.faceSurprise >= 0 && p.faceDelighted >= 0);
      assert.ok(Math.abs(p.shiftX) <= .026 && Math.abs(p.bodyAngle) <= .09, name);
    }
  }
});

// Face scores select a photograph, not opacity. Compare the selected face and
// coarse visible motion channels; a .7 versus 1 score cannot distinguish acts.
function faceWinner(p) {
  let face = 'original', score = 0;
  for (const key of ['faceSad','faceAngry','faceSurprise','faceDelighted']) {
    if (p[key] > score) { face = key; score = p[key]; }
  }
  return face;
}
const visibleSteps = { blink:.2, eyeNarrow:.2, mouthOpen:.2, tilt:.02, bodyAngle:.02,
  shiftX:.006, shiftY:.006, crouch:.15, stretch:.15, squash:.15, bounce:.15,
  step:.2, wave:.2, wiggle:.25, ear:.3, tail:.3, lookX:.004, lookY:.004, breath:.3 };
function visibleSignature(p) {
  return JSON.stringify([faceWinner(p), ...Object.entries(visibleSteps).map(([key, step]) => Math.round(p[key] / step))]);
}
function trajectory(name) {
  const duration = Motion.durations[name] / 1000;
  return [.08,.2,.4,.6,.82,.95].map(fraction => visibleSignature(Motion.pose(duration*fraction,name,duration*fraction)));
}

test('all 64 additions change face and body, use visible distinct trajectories, and recover through an afterglow', () => {
  const signatures = new Map();
  for (const row of Motion.catalogue.slice(36)) {
    const duration = row.durationMs / 1000, samples = [.7,1.3,duration*.5,duration*.75].map(age => Motion.pose(age,row.id,age));
    assert.ok(samples.some(p => faceWinner(p) !== 'original' || p.blink>.9 || Math.abs(p.eyeNarrow) > .1 || Math.abs(p.mouthOpen) > .1 || Math.abs(p.lookY) > .006), row.id+': face');
    assert.ok(samples.some(p => ['crouch','stretch','bounce','wave','pawSpread','bodyAngle'].some(key => Math.abs(p[key]) > (key==='bodyAngle'?.015:.2))), row.id+': body');
    const path = trajectory(row.id); assert.ok(new Set(path).size >= 3, row.id+': anticipation/acting/recovery');
    const signature = JSON.stringify(path); assert.equal(signatures.has(signature),false,row.id+' equals '+signatures.get(signature)); signatures.set(signature,row.id);
    const fading = Motion.pose(duration-.15,row.id,duration-.15), idle = Motion.pose(duration-.15,'idle',0);
    assert.ok(fading.presence > 0 && fading.presence < .15, row.id+': natural release');
    assert.deepEqual(Motion.pose(duration,row.id,duration),Motion.pose(duration,'idle',0));
    assert.notEqual(visibleSignature(samples[1]),visibleSignature(idle),row.id+': not a renamed idle');
  }
  assert.equal(signatures.size,64);
});

test('nearby emotions differ in selected face, gaze, posture and event timing rather than face-score strength', () => {
  const families = [
    ['disgusted','refusing'], ['repulsed','disgusted'], ['contempt','suspicious'], ['content','full'],
    ['relieved','peaceful','secure','relaxed'], ['joy','excited','ecstatic','celebrate'], ['proud','triumphant'],
    ['trusting','compassionate','comforting'], ['lonely','longing','empathic'], ['guilty','regretful','holding_tears']
  ];
  for (const family of families) {
    const paths=family.map(name=>JSON.stringify(trajectory(name)));
    assert.equal(new Set(paths).size,family.length,family.join('/'));
  }
  const at=(name,t=1.4)=>Motion.pose(t,name,t);
  assert.equal(faceWinner(at('disgusted')),'faceAngry'); assert.ok(at('disgusted').eyeNarrow>1);
  assert.equal(faceWinner(at('refusing')),'original'); assert.ok(at('refusing').pawSpread>.5);
  assert.ok(at('disgusted').shiftX<-.015); assert.equal(at('refusing').shiftX,0);
  assert.ok(at('contempt').eyeNarrow<0 && at('contempt').lookY>0 && at('contempt').bodyAngle<0);
  assert.ok(at('suspicious').eyeNarrow>0 && at('suspicious').bodyAngle>0);
  assert.ok(at('suspicious',1.2).lookX*at('suspicious',3.2).lookX<0);
  assert.ok(at('content').stretch>.3 && at('content').bodyAngle===0);
  assert.ok(at('full').bodyAngle<-.05 && at('full').squash>.3);
  assert.ok(at('relieved',.7).stretch>at('relieved',2.8).stretch);
  assert.ok(at('relieved',.7).crouch<at('relieved',2.8).crouch);
  assert.equal(at('peaceful').bodyAngle,0); assert.ok(at('secure').bodyAngle>.03);
  assert.equal(faceWinner(at('peaceful')),'original'); assert.equal(faceWinner(at('relaxed')),'faceDelighted');
});

test('triumph is one prepared victory while ecstatic and celebration repeat different large jumps', () => {
  const countPeaks=name=>{
    const duration=Motion.durations[name]/1000, values=Array.from({length:180},(_,i)=>Motion.pose(i*duration/180,name,i*duration/180).bounce);
    return values.filter((value,i)=>i>0&&i<values.length-1&&value>.35&&value>values[i-1]&&value>=values[i+1]).length;
  };
  assert.equal(countPeaks('triumphant'),1);
  assert.ok(countPeaks('ecstatic')>=3); assert.ok(countPeaks('celebrate')>=3);
  const proud=Motion.pose(2.2,'proud',2.2), victory=Motion.pose(2.2,'triumphant',2.2);
  assert.equal(proud.bounce,0); assert.ok(victory.wave>proud.wave+.8&&victory.stretch>proud.stretch+.3);
  assert.notDeepEqual(trajectory('ecstatic'),trajectory('celebrate'));
});

test('joy, anger and sadness walking have different cadence, arms, head, weight and expression', () => {
  function changes(name) {
    let count=0,previous=0;
    for(let i=1;i<=200;i++){
      const age=.65+i*.02,step=Motion.pose(age,name,age).step;
      if(previous<0&&step>=0)count++; previous=step;
    }
    return count;
  }
  assert.ok(changes('walk_angry')>changes('walk_joy'));
  assert.ok(changes('walk_joy')>changes('walk_sad'));
  const joy=Motion.pose(1.1,'walk_joy',1.1),angry=Motion.pose(1.1,'walk_angry',1.1),sad=Motion.pose(1.1,'walk_sad',1.1);
  assert.equal(faceWinner(joy),'faceDelighted');assert.equal(faceWinner(angry),'faceAngry');assert.equal(faceWinner(sad),'faceSad');
  const arms=Array.from({length:80},(_,i)=>Motion.pose(1+i*.03,'walk_joy',1+i*.03).wave);
  assert.ok(Math.max(...arms)-Math.min(...arms)>1);
  assert.ok(sad.wave<-.6&&angry.pawSpread>sad.pawSpread+1);
  assert.ok(joy.tilt<0&&sad.tilt>0&&sad.crouch>.6&&sad.lookY>.01);
  assert.ok(angry.anger>.7&&sad.ear<-.5&&joy.ear>sad.ear);
});

test('mixed emotions transition between complete face keyframes while stillness, sleep and surprise remain distinct', () => {
  assert.equal(faceWinner(Motion.pose(1.4,'bittersweet',1.4)),'faceSad');
  assert.equal(faceWinner(Motion.pose(3.4,'bittersweet',3.4)),'faceDelighted');
  assert.equal(faceWinner(Motion.pose(1.1,'forgiving',1.1)),'faceAngry');
  assert.equal(faceWinner(Motion.pose(3.1,'forgiving',3.1)),'original');
  assert.equal(faceWinner(Motion.pose(1.2,'realization',1.2)),'faceSurprise');
  assert.equal(faceWinner(Motion.pose(2.4,'realization',2.4)),'original');
  assert.equal(Motion.pose(2.1,'deep_sleep',2.1).blink,1);
  assert.ok(Motion.pose(2.1,'deep_sleep',2.1).crouch>1);
  assert.ok(Motion.pose(2.1,'meditating',2.1).stretch>.6);
  assert.ok(Motion.pose(2.8,'refreshed',2.8).blink<.01);
  assert.ok(Motion.pose(1,'startled',1).bounce>Motion.pose(1.8,'startled',1.8).bounce);
  for(const row of Motion.catalogue.filter(row=>['calm','feeling'].includes(row.group))) {
    if(['refreshed','proud','joy'].includes(row.id))continue;
    assert.notEqual(row.effect,'sparkle',row.id+': no generic glitter for sadness or repose');
  }
});

test('face and acting channels communicate sadness, anger, surprise and joy beyond feeding', () => {
  const p = name => Motion.pose(1.1, name, 1.1);
  assert.ok(p('sad').faceSad > .9 && p('sad').crouch > .7 && p('sad').ear < -.5);
  assert.ok(p('cry').tear > .9 && p('cry').faceSad > .9 && p('cry').wave > .8);
  assert.ok(p('angry').faceAngry > .9 && p('angry').anger > .9 && p('angry').pawSpread > .7);
  assert.ok(p('sulky').faceAngry > .6 && p('sulky').lookX > .01);
  assert.ok(p('surprise').faceSurprise > .9 && p('surprise').mouthOpen > .9);
  assert.ok(p('scared').faceSurprise > .8 && p('scared').crouch > .8 && p('scared').sweat > .6);
  assert.ok(p('laugh').faceDelighted > .9 && p('laugh').mouthOpen > .4);
  assert.ok(p('love').blush > .9 && p('love').pawSpread < -.6);
  assert.ok(p('apology').faceSad > .6 && p('apology').pawSpread < -.8);
  assert.ok(p('dance').faceDelighted > .7 && Math.abs(p('dance').bodyAngle) > .05);
  assert.notEqual(Motion.pose(2.2, 'feeding', 2.2).chew, 0);
});

test('idle covers blink, breathing, head, ears, paw and tail without resetting the loop', () => {
  const samples = Array.from({ length: 241 }, (_, i) => Motion.pose(i * .05, 'idle'));
  for (const key of ['breath', 'blink', 'tilt', 'ear', 'wave', 'tail']) assert.ok(samples.some(p => Math.abs(p[key]) > .001), key);
  const a = Motion.pose(0, 'idle'), b = Motion.pose(12, 'idle');
  for (const key of Object.keys(a).filter(k => k !== 'situation')) assert.ok(Math.abs(a[key] - b[key]) < 1e-12, key);
});

test('only confirmed successful actions return a transient cue; feeding includes its own joy before growth overrides', () => {
  const before = { pet: { exp: 20 }, coins: 100 }, after = { pet: { exp: 28 }, coins: 110 };
  const original = JSON.stringify([before, after]);
  for (const result of [null, {}, { ok: false }, { ok: 1 }]) assert.equal(Motion.situationForAction({ type: 'care', kind: 'feed' }, before, after, result), null);
  for (const [kind, name] of [['feed', 'feeding'], ['play', 'petted'], ['rest', 'resting']]) {
    assert.deepEqual(Motion.situationForAction({ type: 'care', kind }, before, after, { ok: true }), { situation: name, durationMs: Motion.durations[name] });
  }
  assert.equal(Motion.situationForAction({ type: 'care', kind: 'feed' }, before, { pet: { exp: 45 } }, { ok: true }).situation, 'feeding');
  assert.equal(Motion.situationForAction({ type: 'useItem' }, before, { pet: { exp: 45 } }, { ok: true }).situation, 'feeding');
  for (const action of [{ type: 'care', kind: 'play' }, { type: 'care', kind: 'rest' }, { type: 'finishMinigame', score: 3 }]) {
    assert.equal(Motion.situationForAction(action, before, { pet: { exp: 45 } }, { ok: true }).situation, 'joy');
  }
  assert.equal(Motion.situationForAction({ type: 'useItem' }, before, after, { ok: true }).situation, 'feeding');
  assert.equal(Motion.situationForAction({ type: 'finishMinigame', score: 3 }, before, after, { ok: true }).situation, 'caught');
  assert.equal(Motion.situationForAction({ type: 'cancelMinigame' }, before, after, { ok: true }), null);
  assert.equal(Motion.situationForAction({ type: 'care', kind: '__proto__' }, before, after, { ok: true }), null);
  assert.equal(Motion.situationForAction({ type: 'unrelated' }, before, after, { ok: true }), null);
  assert.equal(Motion.situationForAction({ type: 'equipClothing', id: 'cloth_cream_vest' },before,after,{ok:true}).situation,'joy');
  assert.equal(Motion.situationForAction({ type: 'equipClothing', id: 'cloth_cream_vest' },before,after,{ok:false}),null);
  assert.equal(Motion.situationForAction({ type: 'previewClothing', id: 'cloth_cream_vest' },before,after,{ok:true}),null);
  assert.equal(JSON.stringify([before, after]), original);
});

test('feeding timeline exposes one coherent food-to-joy sequence and safe absolute timer boundaries', () => {
  assert.equal(Motion.durations.feeding, 8400);
  const samples = [
    [0, 'anticipation', true, 0, 1200], [1199, 'anticipation', true, 0, 1200],
    [1200, 'chewing', true, 0, 4400], [2800, 'chewing', true, .5, 4400],
    [4400, 'joy', false, 1, 7200], [7199, 'joy', false, 1, 7200],
    [7200, 'settling', false, 1, 8400], [8400, 'idle', false, 1, null], [100000, 'idle', false, 1, null]
  ];
  for (const [age, phase, foodVisible, foodProgress, nextBoundaryMs] of samples) {
    const value = Motion.feedingPhase(age);
    assert.equal(value.phase, phase); assert.equal(value.foodVisible, foodVisible); assert.equal(value.foodProgress, foodProgress);
    assert.equal(value.nextBoundaryMs, nextBoundaryMs); assert.equal(value.done, phase === 'idle'); assert.ok(value.label);
    assert.ok(value.phaseProgress >= 0 && value.phaseProgress <= 1);
    if (!value.done) assert.ok(value.nextBoundaryMs > age);
  }
  for (const bad of [-100, NaN, Infinity, undefined, '1200']) assert.deepEqual(Motion.feedingPhase(bad), Motion.feedingPhase(0));
  const a = Motion.feedingPhase(2800); a.phase = 'changed'; assert.equal(Motion.feedingPhase(2800).phase, 'chewing');
});

test('feeding anticipates, chews with original eyes, celebrates visibly and settles to idle', () => {
  const waiting = Motion.pose(.7, 'feeding', .7), chewing = Motion.pose(2.2, 'feeding', 2.2);
  const joy = Motion.pose(5.5, 'feeding', 5.5), settled = Motion.pose(8.4, 'feeding', 8.4);
  assert.equal(waiting.chew, 0); assert.equal(waiting.faceDelighted, 0); assert.ok(waiting.lookY > .005);
  assert.ok(Math.abs(chewing.chew) > .4); assert.equal(chewing.faceDelighted, 0); assert.ok(chewing.pawSpread < -.8);
  assert.equal(joy.chew, 0); assert.equal(joy.faceDelighted, 1); assert.ok(joy.wave > 1);
  assert.ok(joy.pawSpread > .8 && joy.bounce > .5 && joy.blush > .3);
  assert.deepEqual(settled, Motion.pose(8.4, 'idle', 0));
  for (const boundary of [1.2, 4.4, 7.2]) {
    const before = Motion.pose(boundary, 'feeding', boundary - .00001), after = Motion.pose(boundary, 'feeding', boundary + .00001);
    for (const key of ['chew', 'wave', 'pawSpread', 'tilt', 'bounce', 'bodyAngle', 'squash', 'ear', 'tail']) {
      assert.ok(Math.abs(before[key] - after[key]) < .001, boundary + ':' + key);
    }
  }
});

test('fifteen-image load retains original cutout alpha with eight sampler units and fires ready once', () => {
  const f = fixture(); assert.equal(f.ready, 0); assert.equal(f.draws, 0);
  assert.deepEqual(f.images.map(im => im.url), ['/static/pet_lilac_original.webp', '/static/pet_lilac_half.webp', '/static/pet_lilac_closed.webp', '/static/pet_lilac_cutout.webp', '/static/pet_lilac_sad.webp', '/static/pet_lilac_angry.webp', '/static/pet_lilac_surprise.webp', '/static/pet_lilac_delighted.webp', '/static/pet_lilac_torso_cleanplate_v1.png', '/static/pet_lilac_turnaround_v1.png', '/static/pet_lilac_tooth_original_v1.png', '/static/pet_lilac_tooth_surprise_v1.png', '/static/pet_lilac_tooth_delighted_v1.png', '/static/pet_lilac_tooth_turnaround_v1.png', '/static/pet_lilac_tooth_sleep_v1.png']);
  f.complete(); assert.equal(f.ready, 1); assert.equal(f.draws, 9); assert.equal(f.canvas.hidden, false);
  assert.equal(f.uploads.length, 15); assert.equal(f.canvas.contextOptions.alpha, true); assert.equal(f.canvas.contextOptions.premultipliedAlpha, true);
  assert.match(f.shaders[1], /texture2D\(u_alpha,uv\)\.a/);
  assert.match(f.shaders[1], /else blinkDonor=texture2D\(u_half,uv\)/);
  assert.match(f.shaders[1], /GL_FRAGMENT_PRECISION_HIGH/);
  for (const name of ['sad', 'angry', 'surprise']) assert.match(f.shaders[1], new RegExp('texture2D\\(u_' + name + ',uv\\)\\.rgb'));
  assert.match(f.shaders[1], /face\*weight/);
  assert.match(f.shaders[1], /uniform vec4 u_motionA,u_motionB,u_motionC,u_body,u_gesture,u_face,u_effect,u_detail/);
  f.images[0].onload(); f.advance(); assert.equal(f.ready, 1); assert.equal(f.uploads.length, 15);
  f.api.destroy();
});

test('frame consumers get a fresh post-paint even in reduced motion, cannot fail the source, and stop after destroy',()=>{
  let count=0,throws=false;const f=fixture({reduced:true,options:{onFrame(canvas){count++;assert.equal(canvas,f.canvas);if(throws)throw Error('synthetic consumer failure');}}});
  f.complete();assert.ok(count>0);assert.equal(f.raf.size,0);const before=count,clears=f.clears,pose=structuredClone(f.uniforms);
  f.api.refreshFrame();assert.equal(count,before+1);assert.equal(f.clears,clears+1);assert.deepEqual(f.uniforms,pose);
  throws=true;f.api.refreshFrame();assert.deepEqual(f.errors,[]);assert.equal(f.canvas.hidden,false);
  f.api.destroy();const closed=count;f.api.refreshFrame();assert.equal(count,closed);
});

test('all eight matching textures are required before onReady and expression failure stays honest', () => {
  const f = fixture();
  for (const image of f.images.slice(0, 7)) { image.complete = true; image.naturalWidth = image.naturalHeight = 1000; image.onload(); }
  assert.equal(f.ready, 0); assert.equal(f.draws, 0); assert.equal(f.canvas.hidden, true);
  f.images[7].onerror(new Error('private asset path'));
  assert.deepEqual(f.errors, ['image_failed']); assert.equal(f.canvas.hidden, true);
  assert.equal(f.ready, 0); assert.equal(f.raf.size, 0); assert.equal(f.deleted.length, f.created.length);
});

test('100 cues can be interrupted or replaced without extra RAF loops, writes or stale face uniforms', () => {
  const f = fixture(); f.complete();
  for (const name of Motion.situations) {
    f.api.setSituation(name, { elapsedMs: 1100 });
    assert.equal(f.raf.size, 1);
    if (name === 'sad') assert.ok(f.uniforms.u_faceSad > .9);
    if (name === 'angry') { assert.ok(f.uniforms.u_faceAngry > .9); assert.equal(f.uniforms.u_faceSad, 0); }
  }
  f.api.setSituation('unknown');
  for (const key of ['faceSad', 'faceAngry', 'faceSurprise', 'faceDelighted', 'tear', 'blush', 'anger', 'presence']) assert.equal(f.uniforms['u_' + key], 0, key);
  f.api.destroy();
});

test('DPR is limited to two and drawing buffer to 768 square', () => {
  const f = fixture({ cssWidth: 320, dpr: 4 }); f.complete();
  assert.equal(f.canvas.width, 640); assert.equal(f.canvas.height, 640); f.api.destroy();
  const big = fixture({ cssWidth: 1200, dpr: 4 }); big.complete(); assert.equal(big.canvas.width, 768); big.api.destroy();
});

test('destroy releases the GPU context once so repeated UI rebuilds do not exhaust contexts', () => {
  const f = fixture({ options: { releaseContextOnDestroy: true } }); f.complete(); f.api.destroy(); f.api.destroy();
  assert.equal(f.released, 1);
});

test('finite cue resumes from elapsedMs and settles to idle without another save', () => {
  const f = fixture({ options: { situation: 'resting', durationMs: 1000, elapsedMs: 800 } }); f.complete();
  assert.ok(f.uniforms.u_blink > 0);
  f.advance(40); for (let i = 0; i < 8; i++) f.advance(40);
  assert.equal(f.uniforms.u_blink, 0);
  f.api.setSituation('feeding', { durationMs: 1000, elapsedMs: 500 }); assert.notEqual(f.uniforms.u_chew, 0);
  f.api.setSituation('feeding', { durationMs: 1000, elapsedMs: 1000 }); assert.equal(f.uniforms.u_chew, 0);
  f.api.destroy();
});

test('one frame loop survives repeated cues; hidden/pagehide pauses with no catchup', () => {
  const f = fixture(); f.complete(); f.advance(); f.advance();
  const before = f.draws; f.hide(true); assert.equal(f.raf.size, 0); f.advance(30000); assert.equal(f.draws, before);
  f.hide(false); assert.equal(f.raf.size, 1); f.api.setSituation('joy'); f.api.setSituation('greeting'); assert.equal(f.raf.size, 1);
  f.win.emit('pagehide'); assert.equal(f.raf.size, 0); f.api.setSituation('feeding'); assert.equal(f.raf.size, 0);
  f.win.emit('pageshow'); assert.equal(f.raf.size, 1); f.api.destroy();
});

test('elapsed cue deadlines expire during hidden time or a long frame instead of restarting later', () => {
  const f = fixture(); f.complete();
  f.api.setSituation('feeding', { durationMs: 1000, elapsedMs: 400 });
  assert.notEqual(f.uniforms.u_chew, 0);
  f.hide(true); const before = f.draws; f.advance(5000); assert.equal(f.draws, before);
  f.hide(false); assert.equal(f.uniforms.u_chew, 0);
  f.api.setSituation('joy', { durationMs: 1000 }); f.advance(2000); assert.equal(f.uniforms.u_bounce, 0);
  f.api.destroy();
});

test('reduced motion starts neutral and preference changes stop/restart without hidden animation', () => {
  const f = fixture({ reduced: true, options: { situation: 'resting', elapsedMs: 1500 } }); f.complete();
  assert.equal(f.draws, 9); assert.equal(f.raf.size, 0);
  for (const key of ['u_breath', 'u_blink', 'u_tilt', 'u_ear', 'u_tail', 'u_wave', 'u_presence', 'u_faceSad', 'u_faceAngry', 'u_faceSurprise', 'u_faceDelighted', 'u_tear', 'u_sweat', 'u_blush', 'u_anger']) assert.equal(f.uniforms[key], 0);
  f.reduce(false); assert.equal(f.raf.size, 1); f.advance(); f.advance();
  f.reduce(true); assert.equal(f.raf.size, 0); assert.equal(f.uniforms.u_blink, 0); f.api.destroy();
});

test('all synchronous WebGL failures select a safe fallback and dispose allocated resources', () => {
  for (const config of [{ noWebGL: true }, { compileFailure: true }, { linkFailure: true }]) {
    const f = fixture(config); assert.equal(f.errors.length, 1); assert.equal(f.canvas.hidden, true); assert.equal(f.raf.size, 0);
    assert.equal(f.deleted.length, f.created.length); assert.ok(!f.errors[0].includes('raw')); f.api.destroy();
  }
});

test('image decode, dimension, texture and draw failures fire onError without a blank active engine', () => {
  const image = fixture(); image.images[1].onerror(new Error('raw source URL')); assert.deepEqual(image.errors, ['image_failed']);
  assert.equal(image.canvas.hidden, true); assert.equal(image.images.every(im => !im.onload && !im.onerror), true);
  const size = fixture(); size.images.forEach((im, i) => { im.complete = true; im.naturalWidth = im.naturalHeight = i === 3 ? 900 : 1000; }); size.images[3].onload();
  assert.deepEqual(size.errors, ['image_dimensions_mismatch']);
  for (const config of [{ textureFailure: true }, { drawFailure: true }]) {
    const f = fixture(config); f.complete(); assert.equal(f.errors.length, 1); assert.equal(f.canvas.hidden, true); assert.equal(f.ready, 0); assert.equal(f.raf.size, 0); assert.equal(f.deleted.length, f.created.length);
  }
});

test('load timeout and context loss stop all drawing and notify only once', () => {
  const slow = fixture(); slow.timeout(); assert.deepEqual(slow.errors, ['image_timeout']); assert.equal(slow.timers.size, 0);
  const f = fixture(); f.complete(); let prevented = false;
  f.canvas.emit('webglcontextlost', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.deepEqual(f.errors, ['context_lost']); assert.equal(f.raf.size, 0);
  f.canvas.emit('webglcontextlost'); assert.equal(f.errors.length, 1); assert.equal(f.deleted.length, f.created.length);
});

test('destroy removes callbacks, media/document/window/context listeners, RAF/timer and every GL allocation', () => {
  const f = fixture(); const late = f.images.map(im => im.onload); f.complete();
  assert.ok(f.doc.listenerCount() && f.win.listenerCount() && f.media.listenerCount() && f.canvas.listenerCount());
  const drawn = f.draws; f.api.destroy(); f.api.destroy();
  assert.equal(f.raf.size, 0); assert.equal(f.timers.size, 0); assert.equal(f.deleted.length, f.created.length);
  for (const target of [f.doc, f.win, f.media, f.canvas]) assert.equal(target.listenerCount(), 0);
  late.forEach(fn => fn()); f.api.setSituation('joy'); f.reduce(false); f.hide(false); f.advance(); assert.equal(f.draws, drawn);
  assert.equal(f.images.every(im => im.url === null), true);
});

test('remounting the same canvas destroys the earlier controller', () => {
  const f = fixture(); f.complete(); const oldCreated = f.created.length;
  const next = Motion.mount(f.canvas, { onError: code => f.errors.push(code) });
  assert.equal(f.deleted.length, oldCreated); assert.equal(f.raf.size, 0);
  f.api.setSituation('joy'); assert.equal(f.raf.size, 0); next.destroy(); assert.equal(f.deleted.length, f.created.length);
});

test('external asset roots are refused without starting any image load', () => {
  for (const assetRoot of ['https://example.invalid/', '//example.invalid/', 'data:image/png,', '/static/?token=private']) {
    const f = fixture({ options: { assetRoot } }); assert.deepEqual(f.errors, ['asset_root_invalid']); assert.equal(f.images.length, 0);
  }
});

test('module does not reach game storage, widget state, analytics or external fetch', () => {
  assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage|fetch|XMLHttpRequest|setWidgetState|sendBeacon)\b/);
  assert.doesNotMatch(source, /https?:\/\//);
});


test('egg origins are immutable birth traits composed independently with the care path',()=>{
  assert.deepEqual(Motion.eggOrigins.map(row=>row.key),['lilac','mint','apricot']);
  assert.deepEqual(Motion.eggOrigins.map(row=>row.color),['#b5a0d9','#98c8be','#e6bb8e']);
  assert.ok(Object.isFrozen(Motion.eggOrigins));
  for(const origin of Motion.eggOrigins){assert.ok(Object.isFrozen(origin)&&Object.isFrozen(origin.rgb));assert.strictEqual(Motion.eggOriginProfile(origin.key),origin);}
  for(const invalid of [undefined,null,'__proto__','constructor','missing',{}])assert.strictEqual(Motion.eggOriginProfile(invalid),Motion.eggOrigins[0]);
  for(const care of Motion.evolutionCatalogue){
    assert.strictEqual(Motion.eggVisualProfile(care.key,'lilac'),care,'default B preserves every existing coefficient');
    for(const origin of Motion.eggOrigins.slice(1)){
      const visual=Motion.eggVisualProfile(care.key,origin.key);assert.equal(visual.eggOrigin,origin.key);assert.ok(Object.isFrozen(visual)&&Object.isFrozen(visual.rgb));
      assert.equal(visual.cadence,care.cadence);assert.equal(visual.bounce,care.bounce,'birth does not change care behavior');
      assert.ok(visual.earScale>=.82&&visual.earScale<=1.16);assert.ok(visual.cheekWidth<=1.24&&visual.bodyWidth<=1.17&&visual.tailScale<=1.22);
      const other=Motion.eggVisualProfile(care.key,origin.key==='mint'?'apricot':'mint');
      assert.ok(Math.hypot(...visual.rgb.map((v,i)=>v-other.rgb[i]))>.15,'egg identity survives every later care palette');
    }
  }
  assert.ok(Motion.eggVisualProfile('balanced','mint').earScale>1&&Motion.eggVisualProfile('balanced','mint').bodyWidth<1);
  assert.ok(Motion.eggVisualProfile('balanced','apricot').cheekWidth>1&&Motion.eggVisualProfile('balanced','apricot').tailScale<1);
});

test('omitted and explicit lilac origins keep identical old B geometry materials and behavior',()=>{
  for(const key of bornAppearances)for(const care of Motion.evolutionCatalogue){
    for(const cue of ['idle','feeding','body_flap','sad','direction_spin']){
      const age=1.6,a=Motion.rigPose(age,cue,age,'adult',care.key,1,key),b=Motion.rigPose(age,cue,age,'adult',care.key,1,key,'lilac');assert.deepEqual(a,b);
    }
    for(let view=0;view<16;view++)for(const [x,y]of [[.22,.26],[.55,.53],[.75,.8]])assert.deepEqual(Motion.directionPoint(view,x,y,'adult',care.key,key),Motion.directionPoint(view,x,y,'adult',care.key,key,'lilac'));
  }
  for(const key of ['egg','hatching','adult',null]){
    const a=fixture({captureVolumes:true,options:{appearanceKey:key,evolutionPath:'fruit'}}),b=fixture({captureVolumes:true,options:{appearanceKey:key,evolutionPath:'fruit',eggOrigin:'lilac'}});a.complete();b.complete();
    assert.deepEqual(a.buffers.map(row=>row.data),b.buffers.map(row=>row.data));assert.deepEqual(a.constants,b.constants);assert.deepEqual(a.uniforms,b.uniforms);a.api.destroy();b.api.destroy();
  }
});

test('all birth origins preserve fixed framing welded joints and planted support across every B performance',()=>{
  for(const origin of Motion.eggOrigins.slice(1))for(const key of bornAppearances)for(const care of Motion.evolutionCatalogue)for(const row of Motion.catalogue.concat(Motion.bodyCatalogue)){
    for(let tick=0;tick<=8;tick++){
      const age=Motion.durations[row.id]/1000*tick/8,f=Motion.rigPose(age,row.id,age,'adult',care.key,1.15,key,origin.key);
      assert.equal(f.fitScale,1,origin.key+key+row.id+': birth traits do not cause camera pumping');
      for(const id of ['arm_l','arm_r','tail']){const part=Motion.nurseryRigParts.find(p=>p.id===id),a=Motion.rigPoint(f,id,...part.pivot,'adult',care.key),b=Motion.rigPoint(f,'torso',...part.pivot,'adult',care.key);assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1e-12,'same origin at both sides of every socket');}
      const soles=nurseryActualSoles(f,care.key),scale=Math.hypot(...f.matrices.head.slice(0,2));assert.ok(Math.abs(Math.max(...soles.map(p=>p.y))-(.92-f.flight*.055*scale))<1e-10,'support foot is planted unless genuinely airborne');
    }
  }
});

test('birth morphs are finite through sixteen real directions and origin caches cannot leak between pets',()=>{
  for(const key of bornAppearances)for(const care of Motion.evolutionCatalogue){
    const baseline=[];for(let view=0;view<16;view++)baseline.push(Motion.directionPoint(view,.27,.27,'adult',care.key,key,'lilac'));
    const signatures=[];
    for(const origin of Motion.eggOrigins){let changed=0;const signature=[];
      for(let view=0;view<16;view++){
        for(const [x,y]of [[.17,.28],[.55,.55],[.28,.78],[.75,.83]]){
          const p=Motion.directionPoint(view,x,y,'adult',care.key,key,origin.key);assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));signature.push(p.x,p.y);
        }
        const p=Motion.directionPoint(view,.27,.27,'adult',care.key,key,origin.key);if(Math.hypot(p.x-baseline[view].x,p.y-baseline[view].y)>.00001)changed++;
      }
      signatures.push(JSON.stringify(signature));if(origin.index)assert.ok(changed>=12,'a birth shape exists beyond the front view');
    }
    assert.equal(new Set(signatures).size,3);
    for(let view=0;view<16;view++)assert.deepEqual(Motion.directionPoint(view,.27,.27,'adult',care.key,key,'lilac'),baseline[view],'querying other origins never overwrites the default camera cache');
  }
});

test('birth fur colors protect face features and shell cream while hatching keeps its original eyes and teeth',()=>{
  const purple=[.72,.61,.84],cream=[.94,.89,.82];
  for(const origin of Motion.eggOrigins){
    for(const [x,y]of [[.44318,.43534],[.68435,.40677],[.58051,.52638]])assert.deepEqual(Motion.directionFurColor(0,'balanced',x,y,purple,'adult',origin.key),purple,'original B eye/mouth pigment is protected');
    assert.deepEqual(Motion.directionFurColor(0,'balanced',.5,.82,cream,'adult',origin.key),cream);
    for(const [x,y]of [[.238,.661],[.339,.653],[.295,.705]])assert.deepEqual(Motion.eggOriginColor(origin.key,2,x,y,purple),purple);
    for(const cell of [0,1,2]){
      assert.deepEqual(Motion.eggOriginColor(origin.key,cell,.3,.3,cream),cream);
      const tint=Motion.eggOriginColor(origin.key,cell,.2,.25,purple);assert.equal(tint.length,3);assert.ok(tint.every(v=>Number.isFinite(v)&&v>=0&&v<=1));if(origin.index)assert.notDeepEqual(tint,purple,'the shell spots identify the selected birth color');
    }
  }
  for(const care of Motion.evolutionCatalogue){
    const colors=Motion.eggOrigins.map(origin=>Motion.directionFurColor(0,care.key,.55,.2,purple,'adult',origin.key));
    assert.equal(new Set(colors.map(c=>c.map(v=>Math.round(v*255)).join(','))).size,3,'every care route keeps distinct egg colors');
  }
});

test('origin-correct rendering and touch picking share one 3D arm and mouth frame without more textures',()=>{
  for(const origin of Motion.eggOrigins)for(const key of ['newborn','adult','companion'])for(const care of ['balanced','fruit','active']){
    const f=fixture({hitPixels:'png',captureVolumes:true,options:{growthStage:'adult',appearanceKey:key,evolutionPath:care,eggOrigin:origin.key,outfit:'cloth_cream_vest'}});f.complete();
    assert.equal(f.ready,1);assert.deepEqual(f.errors,[]);assert.equal(f.maxActiveUnit,7);assert.equal(Object.keys(f.samplers).length,8);assert.equal(f.images.length,8);
    const rig=Motion.rigPose(0,'idle',0,'adult',care,1,key,origin.key),crown=Motion.rigPoint(rig,'head',.55,.24,'adult',care);assert.deepEqual(f.api.hitTest(crown.x,crown.y),{part:'head',side:null});
    for(const id of ['arm_l','arm_r']){const profile=Motion.handVolumeProfiles.baby[id],p=Motion.rigPoint(rig,id,...profile.center,'adult',care);assert.equal(f.api.hitTest(p.x,p.y)?.part,'hand','visible origin-specific hand reacts');}
    const anchor=Motion.feedingAnchor('adult',care,key,origin.key);assert.equal(anchor.x,rig.mouth.x);assert.equal(anchor.y,rig.mouth.y);
    const visual=Motion.eggVisualProfile(care,origin.key);assert.deepEqual(f.constants[2],[...visual.rgb,visual.index]);
    f.api.setSituation('body_flap',{elapsedMs:1800});const hands=f.drawCalls.slice(-9).filter(c=>c.volume);assert.equal(hands.length,2);for(const hand of hands)for(let i=8;i<hand.volumeData.length;i+=9)assert.ok(hand.volumeData[i]>.5,'no flat duplicate arm returns');
    f.api.setSituation('direction_spin',{elapsedMs:2200});assert.equal(f.drawCalls.at(-1).volume,false);assert.equal(f.drawCalls.at(-1).uniforms.u_motionA[0],1,'one opaque turnaround source');
    f.api.destroy();assert.equal(f.created.length,f.deleted.length);
  }
  for(const origin of Motion.eggOrigins)for(const key of ['egg','egg_cracked','hatching']){
    const f=fixture({options:{appearanceKey:key,evolutionPath:'fruit',eggOrigin:origin.key}});f.complete();assert.equal(f.ready,1);assert.equal(f.images.length,2);assert.equal(f.maxActiveUnit,7);assert.equal(f.draws,1);assert.equal(Object.keys(f.uniforms).length,5,'only the existing packed egg motion vector is needed');
    assert.equal(f.constants[2][3],origin.index?16+origin.index:Motion.evolutionProfile('fruit').index);assert.match(f.shaders[1],/eggColor/);f.api.destroy();
  }
});

test('birth-specific 3D arms stay continuous finite and inside the fixed camera at strong gesture extremes',()=>{
  for(const origin of ['mint','apricot'])for(const key of ['newborn','adult','companion'])for(const care of Motion.evolutionCatalogue)for(const [cue,age]of [['body_flap',1.2],['body_flap',2.4],['body_flap',3.8],['body_hands',1.2],['feeding',2]]){
    const f=Motion.handVolumeFrame(age,cue,age,'adult',care.key,1.15,key,origin);
    for(const side of ['arm_l','arm_r']){
      const mesh=Motion.handVolumeMesh(f,side);assert.ok(mesh.length>0&&mesh.length%27===0);
      for(let at=0;at<mesh.length;at+=9){
        for(let field=0;field<9;field++)assert.ok(Number.isFinite(mesh[at+field]));
        assert.ok(mesh[at]>=-1&&mesh[at]<=1&&mesh[at+1]>=-1&&mesh[at+1]<=1,'one origin cannot clip the hand beyond the shared camera');
        assert.ok(mesh[at+8]>.5,'no old flat upper-arm copy');
      }
      const profile=Motion.handVolumeProfiles.baby[side],dx=profile.center[0]-profile.shoulder[0],dy=profile.center[1]-profile.shoulder[1],length=Math.hypot(dx,dy),sx=profile.shoulder[0]-.012*dx/length,sy=profile.shoulder[1]-.012*dy/length;
      for(let t=.2;t<=.9;t+=.14){
        const p=Motion.rigPoint(f.rig,side,sx+(profile.center[0]-sx)*t,sy+(profile.center[1]-sy)*t,'adult',care.key);
        assert.ok(palmAlphaAt(mesh,p.x*2-1,1-p.y*2)>.97,'birth shape keeps an opaque continuous forearm');
      }
    }
  }
});


test('blink frame thresholds select exactly one eye image and all face/sleep handovers are opaque',()=>{
  for(const [blink,frame]of [[-1,0],[0,0],[.249999,0],[.25,1],[.5,1],[.749999,1],[.75,2],[1,2],[2,2]]){
    const phase=Motion.faceMaterialPhase(0,false,false,blink,false);assert.equal(phase.frame,frame);assert.equal(phase.weight,0);assert.equal(phase.mouthWeight,0);
  }
  for(const presence of [0,.001,.25,.499,.5,.501,.75,.999,1]){
    for(const delighted of [false,true]){
      const phase=Motion.faceMaterialPhase(presence,true,delighted,0,false);
      assert.equal(phase.weight,presence>=.5?1:0);assert.equal(phase.mouthWeight,phase.weight);
      assert.ok([0,1,2].includes(phase.frame));
      if(presence>=.499&&presence<=.501)assert.equal(delighted&&phase.weight?phase.blink:phase.frame,delighted&&phase.weight?0:2,'both sides hand over closed eyes; an adopted smile keeps its own closed eyes');
    }
    const sleep=Motion.faceMaterialPhase(presence,false,false,0,true);assert.equal(sleep.mouthWeight,presence>=.5?1:0);
    if(presence>=.499&&presence<=.501)assert.equal(sleep.frame,2,'the sleep mouth changes behind closed eyelids');
    const neutral=Motion.faceMaterialPhase(presence,false,false,0,false);assert.equal(neutral.handover,0);assert.equal(neutral.frame,0);
  }
  assert.equal(Motion.faceDonorOpacity(252/255),1);assert.equal(Motion.faceDonorOpacity(253/255),1);assert.equal(Motion.faceDonorOpacity(1),1);
  assert.equal(Motion.faceDonorOpacity(.90),0);assert.ok(Motion.faceDonorOpacity(.95)>0&&Motion.faceDonorOpacity(.95)<1,'only transparent skin boundaries feather');
});

function largestOldEyeComponent(box){
  pngPixel('pet_lilac_reference_v2.png',0,0);const png=pngCache.get('pet_lilac_reference_v2.png'),[x0,y0,x1,y1]=box,width=x1-x0,height=y1-y0;
  const dark=new Uint8Array(width*height),seen=new Uint8Array(width*height);let largest=[];
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const at=(y*png.width+x)*4;dark[(y-y0)*width+x-x0]=png.pixels[at+3]>240&&Math.max(png.pixels[at],png.pixels[at+1],png.pixels[at+2])<180?1:0;}
  for(let seed=0;seed<dark.length;seed++)if(dark[seed]&&!seen[seed]){
    const component=[],stack=[seed];seen[seed]=1;
    while(stack.length){const at=stack.pop(),x=at%width,y=Math.floor(at/width);component.push([x+x0,y+y0]);
      for(const next of [x?at-1:-1,x+1<width?at+1:-1,y?at-width:-1,y+1<height?at+width:-1])if(next>=0&&dark[next]&&!seen[next]){seen[next]=1;stack.push(next);}
    }
    if(component.length>largest.length)largest=component;
  }
  return largest;
}
function registeredDonorAlpha(cell,x,y){
  const uv=Motion.nurseryFaceUV(cell,x,y);pngPixel('pet_lilac_baby_expressions_v1.png',0,0);const png=pngCache.get('pet_lilac_baby_expressions_v1.png');
  const sx=uv.x*png.width-.5,sy=uv.y*png.height-.5,x0=Math.floor(sx),y0=Math.floor(sy),tx=sx-x0,ty=sy-y0;
  function alpha(px,py){return png.pixels[(Math.max(0,Math.min(png.height-1,py))*png.width+Math.max(0,Math.min(png.width-1,px)))*4+3];}
  return (alpha(x0,y0)*(1-tx)+alpha(x0+1,y0)*tx)*(1-ty)+(alpha(x0,y0+1)*(1-tx)+alpha(x0+1,y0+1)*tx)*ty;
}
test('the immutable PNG largest eye components including eyelashes are fully owned by every registered blink/expression donor',()=>{
  // Independent fixed pixel ROIs and dark connected components, never selected by the new mask.
  const components=[largestOldEyeComponent([413,426,702,664]),largestOldEyeComponent([714,376,1003,639])];
  assert.deepEqual(components.map(points=>points.length),[17536,15078]);
  for(const points of components)for(const [px,py]of points){const x=(px+.5)/1254,y=(py+.5)/1254;
    assert.equal(Motion.eyePaintCoverage('adult',x,y),1,'every original pupil/lash pixel is fully replaced, not feathered');
    for(const cell of [1,2,3,4,5,6]){const alpha=registeredDonorAlpha(cell,x,y)/255;assert.ok(alpha>=252/255-1e-12,'registered eye donor remains opaque');assert.ok(Motion.faceDonorOpacity(alpha)>=1-1e-12,'no original dark eye survives the donor alpha');}
  }
  for(const [x,y]of [[.417,.302],[.682,.274],[.32,.60],[.79,.58],[.57697,.48134]])assert.equal(Motion.eyePaintCoverage('adult',x,y),0,'brows, cheeks and nose stay outside eye painting');
  for(const key of ['egg','egg_cracked','hatching'])assert.equal(Motion.eyePaintCoverage(key,.44318,.43534),0,'mouthless eggs cannot acquire old or new eyes from this material');
});

test('actual mature and nursery shaders paint eyes only at final warped UV and use one blink donor with the shared opaque thresholds',()=>{
  for(const key of [null,...bornAppearances]){
    const f=fixture({options:{appearanceKey:key}});f.complete();const shader=f.shaders[1],baby=Motion.appearanceProfile(key).family==='baby';
    const paint=shader.match(/float eyePaintMask=max\(eyeMask\(uv,vec2\(([^)]+)\),vec2\(([^)]+)\)\),eyeMask\(uv,vec2\(([^)]+)\),vec2\(([^)]+)\)\)\)\*headPart;/);assert.ok(paint);
    assert.deepEqual(paint.slice(1).map(v=>v.split(',').map(Number)),baby?[[.44318,.43534],[.120,.124],[.68435,.40677],[.111,.119]]:[[.4665,.429],[.135,.125],[.7281,.3405],[.115,.12]]);
    assert.ok(shader.indexOf(paint[0])>shader.indexOf('vec2 uv=clamp(p,'),'paint mask follows squint/look warps');
    assert.match(shader,baby?/float eyeL=eyeMask\(p,vec2\(\.44318,\.43534\),vec2\(\.112,\.115\)\)/:/float eyeL=eyeMask\(p,vec2\(\.4665,\.429\),vec2\(\.135,\.125\)\)/,'warp control keeps its original mask');
    assert.match(shader,/float blinkFrame\(float amount\)\{return amount>=0\.75\?2\.:amount>=0\.25\?1\.:0\.;\}/);
    assert.match(shader,/if\(lid>1\.5\)blinkDonor=/);assert.match(shader,/else blinkDonor=/);
    assert.match(shader,/eyePaintMask\*faceDonorOpacity\(blinkDonor.a\)/);assert.match(shader,/max\(u_blink,handover\)\*\(1\.-delighted\*weight\)/);
    assert.match(shader,/strongest>0\.\|\|v_mouthMode>\.5\?faceHandover\(u_presence\)/);assert.doesNotMatch(shader,/eye\*smoothstep|v_mouthMode>\.5\?u_presence|__EYE_PAINT_MASK__/);
    if(baby){assert.match(shader,/blinkDonor=texture2D\(u_closed,uv\)/);assert.match(shader,/blinkDonor=texture2D\(u_half,uv\)/);assert.doesNotMatch(shader,/nurserySample\(u_(?:half|closed),/);}
    assert.equal(f.maxActiveUnit,7);f.api.destroy();assert.equal(f.created.length,f.deleted.length);
  }
});

test('all cue entry and release phases use discrete facial materials without mutating body pose',()=>{
  for(const row of Motion.catalogue){const sleep=['resting','sleepy','deep_sleep'].includes(row.id);let sawEnvelope=false;
    for(let ms=0;ms<=row.durationMs;ms+=20){const p=Motion.pose(0,row.id,ms/1000,'adult'),before=JSON.stringify(p),winner=faceWinner(p);
      const phase=Motion.faceMaterialPhase(p.presence,winner!=='original',winner==='faceDelighted',p.blink,sleep);
      assert.ok(phase.weight===0||phase.weight===1);assert.ok(phase.mouthWeight===0||phase.mouthWeight===1);assert.ok([0,1,2].includes(phase.frame));assert.equal(JSON.stringify(p),before);
      if(p.presence>0&&p.presence<1)sawEnvelope=true;if(p.presence>.49&&p.presence<.51&&(winner!=='original'||sleep))assert.equal(winner==='faceDelighted'&&phase.weight?phase.blink:phase.frame,winner==='faceDelighted'&&phase.weight?0:2);
    }
    if(row.id==='idle')assert.equal(sawEnvelope,false,'idle has no finite cue envelope');
    else assert.ok(sawEnvelope,row.id+' retains its continuous finite body envelope');
  }
});

test('reference-resolution blink PNGs fully replace old pupils while the original face remains the owner of protected fur',()=>{
  const reference='pet_lilac_reference_v2.png',donors=['pet_lilac_reference_half_v1.png','pet_lilac_reference_closed_v1.png'];
  const referenceBytes=fs.readFileSync(require.resolve('../static/'+reference));
  assert.equal(require('node:crypto').createHash('sha256').update(referenceBytes).digest('hex'),'2d2cc24745bc74dadeb6dd861c8f85c16e8f36c3cdfbec956e118b0d469e3de6','the original high-detail face is immutable');
  pngPixel(reference,0,0);const original=pngCache.get(reference);
  function alphaAt(name,x,y){
    const png=pngCache.get(name),sx=x*png.width-.5,sy=y*png.height-.5,x0=Math.floor(sx),y0=Math.floor(sy),tx=sx-x0,ty=sy-y0;
    const alpha=(px,py)=>png.pixels[(Math.max(0,Math.min(png.height-1,py))*png.width+Math.max(0,Math.min(png.width-1,px)))*4+3];
    return (alpha(x0,y0)*(1-tx)+alpha(x0+1,y0)*tx)*(1-ty)+(alpha(x0,y0+1)*(1-tx)+alpha(x0+1,y0+1)*tx)*ty;
  }
  for(const name of donors){
    pngPixel(name,0,0);const png=pngCache.get(name);
    assert.ok(png.width>=original.width&&png.height>=original.height,'the blink cannot return to a 418px expression tile');
    assert.equal(png.width,png.height,'direct original UV requires the same square aspect');
  }
  const components=[largestOldEyeComponent([413,426,702,664]),largestOldEyeComponent([714,376,1003,639])];
  for(const points of components)for(const [px,py]of points){
    const x=(px+.5)/original.width,y=(py+.5)/original.height;
    assert.equal(Motion.eyePaintCoverage('adult',x,y),1);
    for(const name of donors)assert.ok(alphaAt(name,x,y)>=252-1e-9,name+' must fully remove the original pupil/lash under LINEAR sampling');
  }
  // Anatomical ROIs are independent of donor colors: brows, nose, cheeks and
  // chin must retain the original texture even if a generated donor differs.
  for(const [x0,y0,x1,y1]of [[.40,.26,.43,.28],[.67,.22,.70,.25],[.576,.480,.579,.482],[.30,.59,.34,.62],[.77,.57,.80,.60],[.49,.64,.55,.66]]){
    for(let y=y0;y<=y1;y+=.005)for(let x=x0;x<=x1;x+=.005)assert.equal(Motion.eyePaintCoverage('adult',x,y),0);
  }
  const f=fixture({options:{appearanceKey:'adult'}});f.complete();
  assert.match(f.shaders[1],/rgb=mix\(rgb,blinkDonor.rgb,eyePaintMask\*faceDonorOpacity\(blinkDonor.a\)\)/,'a full donor image may paint only the registered eye region');
  assert.match(f.shaders[1],/float a=texture2D\(u_alpha,uv\).a\*v_coverage/,'head silhouette remains the original alpha');f.api.destroy();
});

test('all eight born growth appearances bind high-resolution direct-UV blink textures without displacing expression teeth or turns',()=>{
  const oldAssets=['pet_lilac_reference_v2.png','pet_lilac_baby_expressions_v1.png','pet_lilac_baby_turnaround_v1.png','pet_lilac_reference_v2.png','pet_lilac_tooth_baby_expressions_v1.png','pet_lilac_tooth_baby_turnaround_v1.png'];
  for(const key of bornAppearances){
    assert.equal(Motion.appearanceProfile(key).family,'baby');
    const assets=Motion.appearanceAssets(key);assert.deepEqual(assets.slice(0,6),oldAssets);
    assert.deepEqual(assets.slice(6),['pet_lilac_reference_half_v1.png','pet_lilac_reference_closed_v1.png']);
    const f=fixture({options:{appearanceKey:key}});f.complete();const textures=f.created.filter(resource=>resource.type==='Texture');
    assert.deepEqual(f.uploads.slice(6).map(image=>image.url),assets.slice(6).map(name=>'/static/'+name));
    assert.equal(f.samplers.u_half,1);assert.equal(f.samplers.u_closed,2);
    assert.strictEqual(f.boundTextures[1],textures[6]);assert.strictEqual(f.boundTextures[2],textures[7]);
    assert.match(f.shaders[1],/blinkDonor=texture2D\(u_half,uv\)/);assert.match(f.shaders[1],/blinkDonor=texture2D\(u_closed,uv\)/);
    assert.doesNotMatch(f.shaders[1],/nurserySample\(u_(?:half|closed),/);
    for(const cue of ['idle','laugh','deep_sleep','cry']){
      f.api.setSituation(cue,{elapsedMs:1500});assert.strictEqual(f.boundTextures[1],textures[6]);assert.strictEqual(f.boundTextures[2],textures[7]);
    }
    assert.equal(Object.keys(f.samplers).length,8);assert.equal(f.maxActiveUnit,7);f.api.destroy();assert.equal(f.created.length,f.deleted.length);
  }
});

test('circular direction deltas choose the short seam crossing and deterministic half-turns',()=>{
  for(const [from,to,expected]of [[350,10,20],[10,350,-20],[-90,180,-90],[90,-180,90],[0,180,180],[0,-180,-180],[720+350,-720+10,20],[10,10,0]]){
    assert.equal(Motion.shortestYawDelta(from,to),expected);
  }
  for(const value of [NaN,Infinity,undefined,'350'])assert.equal(Motion.shortestYawDelta(value,10),10);
  for(const [from,to]of [[-1e308,1e308],[1e308,-1e308]]){const d=Motion.shortestYawDelta(from,to);assert.ok(Number.isFinite(d)&&Math.abs(d)<=180,'normalization before subtraction avoids overflow');}
});

test('interrupted direction timelines begin at the painted yaw and take the shortest route to each held view',()=>{
  for(const from of [-179,-90,-10,0,10,90,179,350,710]){
    for(const [cue,target,end]of [['direction_left',-90,1900],['direction_right',90,1900],['direction_back',180,2200]]){
      const initial=Motion.shortestYawDelta(0,from),goal=initial+Motion.shortestYawDelta(initial,target);
      assert.equal(Motion.directionFrame(cue,0,false,from).yawDeg,initial);
      assert.equal(Motion.directionFrame(cue,650,false,from).yawDeg,initial,'anticipation keeps the current facing');
      assert.equal(Motion.directionFrame(cue,end,false,from).yawDeg,goal);
      assert.ok(Math.abs(goal-initial)<=180,'never detours through front or the long circle');
      let prior=initial;
      for(let ms=10;ms<=Motion.durations[cue];ms+=10){
        const frame=Motion.directionFrame(cue,ms,false,from);
        assert.ok(Math.abs(Motion.shortestYawDelta(prior,frame.yawDeg))<2.2,cue+from+': bounded continuous angular travel');
        prior=frame.yawDeg;
      }
      assert.equal(Motion.directionFrame(cue,Motion.durations[cue],false,from).front,true);
    }
  }
});

test('a continued spin keeps its intended forward turn and settles at the original front',()=>{
  for(const from of [-179,-90,-10,0,90,179,350]){
    let prior=Motion.shortestYawDelta(0,from),views=new Set();
    for(let ms=0;ms<Motion.durations.direction_spin;ms+=10){
      const frame=Motion.directionFrame('direction_spin',ms,false,from);
      assert.ok(frame.yawDeg>=prior,'a restarted spin does not briefly rotate backwards toward zero');
      assert.ok(frame.yawDeg<=360);
      views.add(frame.blend<.5?frame.currentIndex:frame.nextIndex);prior=frame.yawDeg;
    }
    assert.ok(views.size>=9,'the intended spin remains a turn rather than an immediate front reset');
    assert.equal(Motion.directionFrame('direction_spin',6800,false,from).front,true);
  }
});

test('continued room routes preserve travel and gait but turn from the current facing without a front reset',()=>{
  for(const cue of ['room_walk_left','room_walk_right'])for(const from of [-179,-90,90,179,350]){
    const initial=Motion.shortestYawDelta(0,from),target=cue==='room_walk_left'?-90:90;
    assert.equal(Motion.roomWalkFrame(cue,0,false,from).yawDeg,initial);
    assert.equal(Motion.roomWalkFrame(cue,650,false,from).yawDeg,initial+Motion.shortestYawDelta(initial,target));
    let previous=initial;
    for(let age=0;age<=6000;age+=10){
      const a=Motion.roomWalkFrame(cue,age,false,from),b=Motion.roomWalkFrame(cue,age);
      for(const key of ['x','speed','phase','footPhase','travel','walking','done'])assert.equal(a[key],b[key],key+': turning does not change room motion or foot timing');
      assert.ok(Math.abs(Motion.shortestYawDelta(previous,a.yawDeg))<=180*1.5*10/650+1e-9,'maximum authored half-turn speed bounds a 10ms sample');previous=a.yawDeg;
      const turn=Motion.directionFrame(cue,age,false,from);
      assert.equal(turn.yawDeg,a.yawDeg);assert.deepEqual(turn.roomWalk,a);
    }
  }
});

test('live direction replacements carry the actually drawn angle while explicit elapsed seeks stay exact',()=>{
  for(const key of ['newborn','adult',null]){
    const frames=[],f=fixture({options:{appearanceKey:key,onPose:p=>frames.push(p)}});f.complete();
    f.api.setSituation('direction_left',{elapsedMs:2800});assert.equal(frames.at(-1).yawDeg,-90);
    const resources=f.created.length;
    f.api.setSituation('direction_back');
    assert.equal(frames.at(-1).yawDeg,-90);assert.equal(f.drawCalls.at(-1).part,22,'the very first replacement draw still owns the prior left source');
    f.advance(1300);const intermediate=frames.at(-1).yawDeg;
    assert.ok(intermediate< -90&&intermediate> -180);
    f.api.setSituation('direction_right');assert.equal(frames.at(-1).yawDeg,intermediate,'reentrant replacement begins where the preceding frame was painted');
    f.advance(1900);assert.equal(Motion.shortestYawDelta(frames.at(-1).yawDeg,90),0);
    f.api.setSituation('direction_back',{elapsedMs:2800});assert.equal(frames.at(-1).yawDeg,180,'editor seeks and saved elapsed restores do not inherit the old turn');
    assert.equal(f.created.length,resources,'continuations allocate neither another view nor another RAF loop');
    assert.equal(f.raf.size,1);
    for(const draw of f.drawCalls.filter(d=>d.part>=10))assert.equal(draw.uniforms.u_motionA[0],1,'one opaque source; no translucent second face or hand');
    f.api.destroy();assert.equal(f.created.length,f.deleted.length);assert.equal(f.raf.size,0);
  }
});

test('continued room rendering callbacks use the same yaw as their single source and keep directional alpha ownership',()=>{
  const frames=[],f=fixture({hitPixels:'png',options:{appearanceKey:'adult',onPose:p=>frames.push(p)}});f.complete();
  f.api.setSituation('direction_back',{elapsedMs:2800});f.api.setSituation('room_walk_left');
  assert.equal(frames.at(-1).yawDeg,180);assert.equal(f.drawCalls.at(-1).part,18);
  f.advance(325);
  const expected=Motion.directionFrame('room_walk_left',325,false,180),actual=frames.at(-1);
  assert.equal(actual.yawDeg,expected.yawDeg);assert.equal(actual.roomX,expected.roomWalk.x);
  assert.equal(f.drawCalls.at(-1).part,10+(expected.blend<.5?expected.currentIndex:expected.nextIndex));
  f.advance(325);assert.equal(Motion.shortestYawDelta(frames.at(-1).yawDeg,-90),0);
  f.advance(650);assert.ok(frames.at(-1).roomX<0);assert.equal(frames.at(-1).walking,true);
  f.api.destroy();assert.equal(f.created.length,f.deleted.length);
});

test('continued turns are based on elapsed time rather than RAF cadence or count',()=>{
  function sample(steps){
    const frames=[],f=fixture({options:{appearanceKey:'adult',onPose:p=>frames.push(p)}});f.complete();
    f.api.setSituation('direction_left',{elapsedMs:2800});f.api.setSituation('direction_back');
    for(const ms of steps)f.advance(ms);
    const pose=frames.at(-1),view=f.drawCalls.at(-1).part;f.api.destroy();return {yaw:pose.yawDeg,view};
  }
  const fast=sample(Array(78).fill(1000/60)),slow=sample(Array(13).fill(100));
  assert.ok(Math.abs(fast.yaw-slow.yaw)<1e-10,'only floating clock addition roundoff differs');assert.equal(fast.view,slow.view);
  assert.deepEqual(sample([1300]),sample([400,400,500]),'a long frame evaluates the same authored angle without stepwise catchup');
});

test('hidden, detached, reduced and expired replacements never resurrect an old turn',()=>{
  for(const kind of ['hidden','detached','pagehide']){
    const frames=[],f=fixture({options:{onPose:p=>frames.push(p)}});f.complete();f.api.setSituation('direction_left',{elapsedMs:2800});
    if(kind==='hidden')f.hide(true);else if(kind==='detached')f.canvas.isConnected=false;else f.win.emit('pagehide');
    f.api.setSituation('direction_back');
    f.advance(7000);
    if(kind==='hidden')f.hide(false);else if(kind==='detached'){f.canvas.isConnected=true;f.win.emit('resize');}else f.win.emit('pageshow');
    assert.deepEqual(f.drawCalls.slice(-9).map(d=>d.part),Motion.rigParts.map(p=>p.index));
    assert.equal(f.raf.size,kind==='detached'?0:1,'existing detached lifecycle requires a fresh cue to resume, never a catchup loop');
    f.api.setSituation('idle');assert.equal(f.raf.size,1);f.api.destroy();assert.equal(f.created.length,f.deleted.length);
  }
  const f=fixture({reduced:true});f.complete();f.api.setSituation('direction_left');f.api.setSituation('direction_back');
  assert.equal(f.drawCalls.at(-1).part,18);assert.equal(f.raf.size,0);assert.equal(f.timers.size,1);
  f.advance(7000);f.timeout();assert.deepEqual(f.drawCalls.slice(-9).map(d=>d.part),Motion.rigParts.map(p=>p.index));
  assert.equal(f.timers.size,0);f.api.destroy();assert.equal(f.created.length,f.deleted.length);
});

test('optional direction origins do not modify reduced previews, eggs, view pixels or independent body articulation',()=>{
  for(const cue of Motion.directionCatalogue)for(const initial of [-170,90,350]){
    assert.deepEqual(Motion.directionFrame(cue.id,2000,true,initial),Motion.directionFrame(cue.id,2000,true));
  }
  for(const key of ['egg','hatching']){
    const f=fixture({options:{appearanceKey:key}});f.complete();f.api.setSituation('direction_left');f.advance(2000);f.api.setSituation('direction_back');
    assert.equal(f.drawCalls.at(-1).part,0);f.api.destroy();assert.equal(f.created.length,f.deleted.length);
  }
  const f=fixture({options:{appearanceKey:'adult'}});f.complete();const shader=f.shaders.slice();
  f.api.setSituation('direction_left',{elapsedMs:2800});f.api.setSituation('direction_back');f.advance(1200);f.api.setSituation('body_flap',{elapsedMs:1800});
  assert.deepEqual(f.shaders,shader);assert.deepEqual(f.drawCalls.slice(-9).map(d=>d.part),Motion.nurseryRigParts.map(p=>p.index));
  assert.equal(f.drawCalls.slice(-9).filter(d=>d.volume).length,2,'existing independent volume hands return with the ordinary front rig');
  f.api.destroy();assert.equal(f.created.length,f.deleted.length);
});


test('village locomotion keeps a persistent normalized heading and uses distance rather than RAF time for gait',()=>{
 for(const [yaw,expected] of [[0,0],[180,180],[270,270],[-90,270],[450,90]]){
  const value={yawDeg:yaw,walking:true,distance:.105},before=JSON.stringify(value);
  const a=Motion.locomotionFrame(value,0,false),b=Motion.locomotionFrame(value,999,false);
  assert.equal(a.yawDeg,expected);assert.deepEqual(a,b,'holding distance cannot skate at later RAF time');
  assert.ok(Math.abs(a.roomWalk.footPhase-Math.PI/2)<1e-10);assert.equal(a.roomWalk.walking,true);assert.equal(JSON.stringify(value),before);
  const reduced=Motion.locomotionFrame(value,500,true);assert.equal(reduced.roomWalk.footPhase,0);
  const stopped=Motion.locomotionFrame({...value,walking:false},500,false);
  assert.equal(stopped.yawDeg,expected);assert.equal(stopped.roomWalk.walking,false);assert.equal(stopped.roomWalk.speed,0);
 }
 for(const value of [null,undefined,{}, {yawDeg:NaN},{yawDeg:Infinity},{yawDeg:'90'}])assert.equal(Motion.locomotionFrame(value,0,false),null);
 for(const distance of [undefined,NaN,Infinity,-Infinity])assert.ok(Number.isFinite(Motion.locomotionFrame({yawDeg:90,walking:true,distance},2,false).roomWalk.footPhase));
});

test('village back and side movement draw one opaque saved direction, never two ghosted silhouettes',t=>{
 for(const key of [null,'adult']) {
  const packets=[],f=fixture({options:{appearanceKey:key,onPose:p=>packets.push(p)}});t.after(()=>f.api.destroy());f.complete();
  const textures=f.created.filter(r=>r.type==='Texture'),family=Motion.appearanceProfile(key).family;
  for(const yaw of [11.26,22.5,90,179.9,180,270,348.7]){
   assert.equal(f.api.setLocomotion({yawDeg:yaw,walking:true,distance:.105}),true);f.api.refreshFrame();
   const draws=f.drawCalls.filter(d=>d.frame===f.clears);
   assert.equal(draws.length,1,'one saved drawing owns yaw '+yaw);assert.equal(draws[0].uniforms.u_motionA[0],1);
   assert.equal(draws[0].volume,false);assert.strictEqual(draws[0].texture5,textures[family==='baby'?5:13]);
   assert.ok(Math.abs(packets.at(-1).yawDeg-yaw)<1e-9);assert.equal(packets.at(-1).walking,true);
   assert.ok(Array.from(f.liveVertices).every(Number.isFinite));
  }
  f.api.setLocomotion({yawDeg:180,walking:false,distance:.105});f.api.refreshFrame();
  assert.equal(f.drawCalls.at(-1).part,18,'stopping does not face front after a timed cue');
  const uploads=f.uploads.length;for(let i=0;i<20;i++)f.advance(100);
  assert.equal(f.drawCalls.at(-1).part,18);assert.equal(f.uploads.length,uploads,'persistent movement reuses the already loaded original assets');
  f.api.destroy();assert.equal(f.created.length,f.deleted.length);
 }
});

test('village directional foot vertices move only when distance changes and settle on idle',t=>{
 for(const key of [null,'adult'])for(const yaw of [0,90,180,270]){
  const f=fixture({options:{appearanceKey:key}});t.after(()=>f.api.destroy());f.complete();
  function sample(walking,distance){f.api.setLocomotion({yawDeg:yaw,walking,distance});f.api.refreshFrame();return Array.from(f.liveVertices);}
  const a=sample(true,0),b=sample(true,.105),same=sample(true,.105);
  assert.notDeepEqual(a,b,String(key)+' yaw '+yaw+': real foot vertices must change with travelled distance');
  assert.deepEqual(b,same,'repainting the same movement position cannot advance gait');
  const idle=sample(false,.105);assert.deepEqual(idle,sample(false,.315),'idle never continues the distance gait');
  f.api.destroy();
 }
});

test('village locomotion cannot draw late after hidden, detached, pagehide, destroy or egg lifecycle',t=>{
 for(const kind of ['hidden','detached','pagehide','destroy']){
  const packets=[],f=fixture({options:{onPose:p=>packets.push(p)}});t.after(()=>f.api.destroy());f.complete();
  f.api.setLocomotion({yawDeg:180,walking:true,distance:.105});f.api.refreshFrame();const count=f.draws,poses=packets.length;
  if(kind==='hidden')f.hide(true);else if(kind==='detached')f.canvas.isConnected=false;else if(kind==='pagehide')f.win.emit('pagehide');else f.api.destroy();
  f.api.setLocomotion({yawDeg:90,walking:true,distance:.2});f.api.refreshFrame();f.advance(1000);
  assert.equal(f.draws,count,kind);assert.equal(packets.length,poses,kind);
  f.api.destroy();assert.equal(f.created.length,f.deleted.length);assert.equal(f.raf.size,0);
 }
 for(const key of ['egg','hatching']){
  const f=fixture({options:{appearanceKey:key}});t.after(()=>f.api.destroy());f.complete();const count=f.draws;
  assert.equal(f.api.setLocomotion({yawDeg:180,walking:true,distance:.1}),false);
  assert.equal(f.draws,count);assert.equal(f.drawCalls.at(-1).part,0);f.api.destroy();
 }
 const f=fixture({reduced:true,options:{appearanceKey:'adult'}});t.after(()=>f.api.destroy());f.complete();
 f.api.setLocomotion({yawDeg:180,walking:true,distance:0});const neutral=Array.from(f.liveVertices);
 f.api.setLocomotion({yawDeg:180,walking:true,distance:100});assert.deepEqual(Array.from(f.liveVertices),neutral);
 assert.equal(f.raf.size,0);f.api.setLocomotion({yawDeg:Infinity,walking:true,distance:NaN});
 assert.ok(Array.from(f.liveVertices).every(Number.isFinite));assert.equal(f.raf.size,0);f.api.destroy();assert.equal(f.created.length,f.deleted.length);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Motion = require('../static/pet-lilac-motion.js');
const source = fs.readFileSync(require.resolve('../static/pet-lilac-motion.js'), 'utf8');

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
  const raf = new Map(), timers = new Map(), images = [], created = [], deleted = [], uploads = [], errors = [], uniforms = {}, shaders = [], buffers = [], attributes = [], drawCalls = [], bindings = [], constants = {}, disabledAttributes = [];
  const boundTextures={},samplers={},enabled=[],blend=[];
  const media = events({ matches: !!config.reduced });
  const doc = events({ hidden: !!config.hidden });
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
  gl.getAttribLocation = (_, name) => name === 'a_position' ? 0 : name === 'a_uv' ? 1 : name === 'a_evolution' ? 2 : name === 'a_coverage'?3:name==='a_part'?4:-1;
  gl.bindAttribLocation = (_,index,name) => { bindings.push([index,name]); };
  gl.disableVertexAttribArray = index => { disabledAttributes.push(index); };
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
  gl.bufferSubData = (_,offset,data) => { assert.equal(offset,0);if(!liveVertices||liveVertices.length!==data.length)liveVertices=new Float32Array(data.length);liveVertices.set(data);updates++; };
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
  gl.drawArrays = (mode, first, count) => { if (config.drawFailure) throw new Error('raw private driver detail'); drawCalls.push({ mode, first, count,part:constants[4],texture4:boundTextures[4],buffer:activeBuffer,uniforms:structuredClone(uniforms),frame:clears }); draws++; };
  const canvas = events({ ownerDocument: doc, hidden: true, isConnected: true, width: 240, height: 240,
    clientWidth: config.cssWidth || 320,
    getBoundingClientRect: () => ({ width: config.cssWidth || 320 }),
    getContext: (_, options) => { canvas.contextOptions = options; return config.noWebGL ? null : gl; }
  });
  const api = Motion.mount(canvas, { onError: code => errors.push(code), onReady: () => ready++, ...config.options });
  return { api, canvas, win, doc, media, gl, raf, timers, images, errors, created, deleted, uploads, uniforms, shaders, buffers, attributes, drawCalls, bindings, constants, disabledAttributes, samplers,boundTextures,blend,enabled,
    get draws() { return draws; }, get ready() { return ready; }, get released() { return released; },
    get clears(){return clears;},get updates(){return updates;},get liveVertices(){return liveVertices;},get maxActiveUnit(){return maxActiveUnit;},
    complete() { images.forEach((im,i) => { im.complete = true; im.naturalWidth = im.naturalHeight = i>=8?1254:1000; im.onload?.(); }); },
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
  assert.deepEqual(f.attributes.map(a=>[a.index,a.size,a.stride,a.offset]),[[0,2,20,0],[1,2,20,8],[3,1,20,16]]);
  assert.equal(f.drawCalls.length,9);assert.equal(f.uploads.length,10);
  let total=0;
  for(const call of f.drawCalls){
    const part=Motion.rigParts[call.part];assert.equal(call.first,total);total+=call.count;
    for(let i=call.first*5;i<(call.first+call.count)*5;i+=5){
      const [x,y,u,v,coverage]=rest.subarray(i,i+5),grown=Motion.growthPoint(stage,u,v,path),target=Motion.rigPoint(frame,part.id,u,v,stage,path);
      assert.ok([x,y,u,v,coverage].every(Number.isFinite));assert.ok(u>=0&&u<=1&&v>=0&&v<=1&&coverage>=0&&coverage<=1);
      assert.ok(Math.abs(x-grown.x)<.000001&&Math.abs(y-grown.y)<.000001);
      assert.ok(Math.abs((live[i]+1)/2-target.x)<.000001&&Math.abs((1-live[i+1])/2-target.y)<.000001,part.id);
    }
  }
  assert.equal(total,rest.length/5);
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
    assert.equal(f.clears,1);assert.equal(f.updates,1);f.api.destroy();assert.equal(f.created.length,f.deleted.length);
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

test('six body demonstrations remain separate from the 100 emotions and end at the real idle rig',()=>{
  assert.equal(Motion.catalogue.length,100);assert.equal(Motion.situations.length,100);
  assert.deepEqual(Motion.bodyCatalogue.map(row=>row.id),['body_hands','body_feet','body_ears','body_tail','body_head','body_joy']);
  assert.equal(Object.isFrozen(Motion.bodyCatalogue),true);
  for(const row of Motion.bodyCatalogue){
    assert.equal(Object.isFrozen(row),true);assert.equal(row.durationMs,6000);assert.equal(row.effect,'none');assert.ok(row.face&&row.motion);
    assert.equal(Motion.durations[row.id],6000);assert.equal(Motion.situations.includes(row.id),false);
    assert.deepEqual(Motion.rigPose(9,row.id,6),Motion.rigPose(9,'idle',6));
  }
});

test('four real-view directions stay separate from the 100 emotions and six body demonstrations',()=>{
  assert.deepEqual(Motion.directionCatalogue.map(row=>[row.id,row.durationMs]),[['direction_left',6000],['direction_right',6000],['direction_back',6500],['direction_spin',6800]]);
  assert.equal(Object.isFrozen(Motion.directionCatalogue),true);
  for(const row of Motion.directionCatalogue){assert.equal(Object.isFrozen(row),true);assert.equal(row.effect,'none');assert.ok(row.face&&row.motion);assert.equal(Motion.durations[row.id],row.durationMs);assert.equal(Motion.situations.includes(row.id),false);}
  assert.equal(Motion.catalogue.length,100);assert.equal(Motion.bodyCatalogue.length,6);
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

test('turn drawing borrows unit four for at most two cells then restores the frontal VBO and materials',()=>{
  const f=fixture();f.complete();const textures=f.created.filter(row=>row.type==='Texture'),frontBuffer=f.drawCalls[0].buffer;
  assert.equal(f.buffers.length,1);assert.equal(f.updates,1);f.advance();assert.equal(f.buffers.length,1);assert.equal(f.updates,2);
  for(const [id,index]of[['direction_left',12],['direction_right',4],['direction_back',8]]){
    const before=f.draws;f.api.setSituation(id,{elapsedMs:2800});const calls=f.drawCalls.slice(before);
    assert.equal(calls.length,1);assert.equal(calls[0].part,index+10);assert.equal(calls[0].first,0);assert.equal(calls[0].count,3456);assert.strictEqual(calls[0].texture4,textures[9]);
    assert.equal(calls[0].uniforms.u_motionA[0],1);assert.equal(calls[0].uniforms.u_motionA[1],index);
    assert.equal(calls[0].uniforms.u_motionA[2],index>4&&index<12?1:0);
    assert.notStrictEqual(calls[0].buffer,frontBuffer);assert.strictEqual(f.boundTextures[4],textures[4]);assert.equal(f.raf.size,1);
  }
  assert.equal(f.buffers.length,2);assert.deepEqual(f.blend.at(-1),[f.gl.ONE,f.gl.ONE_MINUS_SRC_ALPHA]);assert.equal(f.maxActiveUnit,7);
  const before=f.draws;f.api.setSituation('angry',{elapsedMs:1500});const calls=f.drawCalls.slice(before);assert.equal(calls.length,9);assert.strictEqual(calls[0].buffer,frontBuffer);assert.ok(f.uniforms.u_faceAngry>.9);
  for(const call of calls)assert.strictEqual(call.texture4,call.part===1?textures[8]:textures[4]);
  assert.deepEqual(f.attributes.slice(-3).map(a=>[a.index,a.size,a.stride,a.offset]),[[0,2,20,0],[1,2,20,8],[3,1,20,16]]);
  f.api.destroy();assert.equal(f.created.length,f.deleted.length);assert.equal(f.raf.size,0);
});

test('short adjacent-view transitions use complementary premultiplied weights, never a held double eye',()=>{
  let age=0;for(;age<6000;age++)if(Motion.directionFrame('direction_right',age).blend>.1&&Motion.directionFrame('direction_right',age).blend<.9)break;
  const frame=Motion.directionFrame('direction_right',age),f=fixture();f.complete();const before=f.draws;f.api.setSituation('direction_right',{elapsedMs:age});const calls=f.drawCalls.slice(before);
  assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>c.part),[frame.currentIndex+10,frame.nextIndex+10]);assert.ok(Math.abs(calls[0].uniforms.u_motionA[0]+calls[1].uniforms.u_motionA[0]-1)<1e-12);
  assert.deepEqual(f.blend.at(-2),[f.gl.ONE,f.gl.ONE]);assert.deepEqual(f.blend.at(-1),[f.gl.ONE,f.gl.ONE_MINUS_SRC_ALPHA]);f.api.destroy();
});

test('turns replace food callbacks, expire while hidden, and reduced motion shows one static target',()=>{
  const frames=[],f=fixture({options:{onPose:p=>frames.push(p)}});f.complete();f.api.setSituation('feeding',{elapsedMs:2200});assert.equal(frames.length,1);
  f.api.setSituation('direction_back',{elapsedMs:2800});f.advance(100);assert.equal(frames.length,1);f.hide(true);const n=f.draws;f.advance(10000);assert.equal(f.draws,n);f.hide(false);assert.deepEqual(f.drawCalls.slice(-9).map(c=>c.part),Motion.rigParts.map(p=>p.index));assert.equal(frames.length,1);f.api.destroy();
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
  function undo(m,p){const det=m[0]*m[3]-m[1]*m[2],x=p.x-m[4],y=p.y-m[5];return{x:(m[3]*x-m[2]*y)/det,y:(-m[1]*x+m[0]*y)/det};}
  for(const frame of [left,right])for(const id of ['arm_l','arm_r','ear_l','ear_r','tail']){
    const part=Motion.rigParts.find(row=>row.id===id),a=part.polygon[2],b=part.polygon[5];
    const wa=undo(frame.matrices.torso,Motion.rigPoint(frame,id,...a,'final')),wb=undo(frame.matrices.torso,Motion.rigPoint(frame,id,...b,'final'));
    const ra=Motion.growthPoint('final',...a),rb=Motion.growthPoint('final',...b);
    assert.ok(Math.abs(Math.hypot(wa.x-wb.x,wa.y-wb.y)-Math.hypot(ra.x-rb.x,ra.y-rb.y))<1e-12,id+': no rubber stretch');
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

test('all 106 rig cues enter and settle without erasing an in-progress idle hand wave',()=>{
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
  for(const call of f.drawCalls)assert.strictEqual(call.texture4,call.part===1?textures[8]:textures[4]);
  assert.strictEqual(f.boundTextures[4],textures[4]);assert.equal(f.clears,1);assert.equal(f.updates,1);
  f.api.setSituation('body_hands',{elapsedMs:1200});assert.equal(f.drawCalls.length,18);assert.equal(f.clears,2);assert.equal(f.updates,2);
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

test('food anchors follow the same growth mesh and active cue inset rather than the old fixed mouth', () => {
  const anchors = new Set();
  for (const stage of growthKeys) {
    const anchor = Motion.feedingAnchor(stage), profile = Motion.growthProfile(stage);
    const u = .5 + (.628-.5)*.88, v = .92 + (.499-.92)*.88;
    const point = Motion.growthPoint(stage,u,v);
    assert.equal(anchor.x, .5 + (point.x-.5)*profile.overallScale);
    assert.equal(anchor.y, .92 + (point.y-.92)*profile.overallScale);
    assert.equal(anchor.foodLeft, anchor.x-.11); assert.equal(anchor.foodTop, anchor.y+.005);
    // The apple begins below the mouth, rather than covering the nose or eyes.
    // Its upper edge stays within one tenth of the .14-high prop from the mouth.
    assert.ok(anchor.foodTop >= anchor.y && anchor.foodTop-anchor.y <= .14*.1, stage + ': upper bite edge');
    assert.ok(anchor.x >= anchor.foodLeft && anchor.x <= anchor.foodLeft+.16, stage + ': mouth over apple');
    anchors.add(JSON.stringify(anchor));
  }
  assert.equal(anchors.size, 6);
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
    assert.deepEqual(f.bindings,[[0,'a_position'],[1,'a_uv'],[2,'a_evolution'],[3,'a_coverage'],[4,'a_part']]);
    assert.deepEqual(f.disabledAttributes,[4,2]);assert.deepEqual(f.constants[2],[...path.rgb,path.index]);
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
  f.hide(false);assert.equal(f.uniforms.u_chew,0);assert.equal(f.images.length,10);f.api.destroy();assert.equal(f.released,1);assert.equal(f.raf.size,0);
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
    assert.equal(f.uploads.length,10); assert.equal(f.created.filter(x=>x.type==='Texture').length,10);
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

test('ten-image load draws original cutout layers with eight sampler units and fires ready once', () => {
  const f = fixture(); assert.equal(f.ready, 0); assert.equal(f.draws, 0);
  assert.deepEqual(f.images.map(im => im.url), ['/static/pet_lilac_original.webp', '/static/pet_lilac_half.webp', '/static/pet_lilac_closed.webp', '/static/pet_lilac_cutout.webp', '/static/pet_lilac_sad.webp', '/static/pet_lilac_angry.webp', '/static/pet_lilac_surprise.webp', '/static/pet_lilac_delighted.webp', '/static/pet_lilac_torso_cleanplate_v1.png', '/static/pet_lilac_turnaround_v1.png']);
  f.complete(); assert.equal(f.ready, 1); assert.equal(f.draws, 9); assert.equal(f.canvas.hidden, false);
  assert.equal(f.uploads.length, 10); assert.equal(f.canvas.contextOptions.alpha, true); assert.equal(f.canvas.contextOptions.premultipliedAlpha, true);
  assert.match(f.shaders[1], /texture2D\(u_alpha,uv\)\.a/);
  assert.match(f.shaders[1], /texture2D\(u_half,uv\)\.rgb/);
  assert.match(f.shaders[1], /GL_FRAGMENT_PRECISION_HIGH/);
  for (const name of ['sad', 'angry', 'surprise', 'delighted']) assert.match(f.shaders[1], new RegExp('texture2D\\(u_' + name + ',uv\\)\\.rgb'));
  assert.match(f.shaders[1], /face\*weight/);
  assert.match(f.shaders[1], /uniform vec4 u_motionA,u_motionB,u_motionC,u_body,u_gesture,u_face,u_effect,u_detail/);
  f.images[0].onload(); f.advance(); assert.equal(f.ready, 1); assert.equal(f.uploads.length, 10);
  f.api.destroy();
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

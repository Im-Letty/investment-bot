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
  let clock = 0, id = 0, draws = 0, ready = 0, released = 0;
  const raf = new Map(), timers = new Map(), images = [], created = [], deleted = [], uploads = [], errors = [], uniforms = {}, shaders = [], buffers = [], attributes = [], drawCalls = [], bindings = [], constants = {}, disabledAttributes = [];
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
    'TEXTURE_MAG_FILTER', 'LINEAR', 'RGBA', 'UNSIGNED_BYTE', 'TRIANGLES', 'UNPACK_FLIP_Y_WEBGL'].forEach((key, n) => { gl[key] = n + 1; });
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
  gl.getAttribLocation = (_, name) => name === 'a_position' ? 0 : name === 'a_uv' ? 1 : name === 'a_evolution' ? 2 : -1;
  gl.bindAttribLocation = (_,index,name) => { bindings.push([index,name]); };
  gl.disableVertexAttribArray = index => { disabledAttributes.push(index); };
  gl.vertexAttrib4f = (index,...values) => { constants[index]=values; };
  gl.bufferData = (target, data, usage) => { buffers.push({ target, data: new Float32Array(data), usage }); };
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
  gl.drawArrays = (mode, first, count) => { if (config.drawFailure) throw new Error('raw private driver detail'); drawCalls.push({ mode, first, count }); draws++; };
  const canvas = events({ ownerDocument: doc, hidden: true, isConnected: true, width: 240, height: 240,
    clientWidth: config.cssWidth || 320,
    getBoundingClientRect: () => ({ width: config.cssWidth || 320 }),
    getContext: (_, options) => { canvas.contextOptions = options; return config.noWebGL ? null : gl; }
  });
  const api = Motion.mount(canvas, { onError: code => errors.push(code), onReady: () => ready++, ...config.options });
  return { api, canvas, win, doc, media, gl, raf, timers, images, errors, created, deleted, uploads, uniforms, shaders, buffers, attributes, drawCalls, bindings, constants, disabledAttributes,
    get draws() { return draws; }, get ready() { return ready; }, get released() { return released; },
    complete() { images.forEach(im => { im.complete = true; im.naturalWidth = im.naturalHeight = 1000; im.onload?.(); }); },
    advance(ms = 40) { clock += ms; const callbacks = [...raf.values()]; raf.clear(); callbacks.forEach(fn => fn(clock)); },
    hide(value) { doc.hidden = value; doc.emit('visibilitychange'); },
    reduce(value) { media.matches = value; media.emit('change'); },
    timeout() { [...timers.values()].forEach(fn => fn()); }
  };
}

test('UMD exposes browser API and CommonJS pure helpers without loading assets', () => {
  const sandbox = { window: {} }; vm.runInNewContext(source, sandbox);
  assert.equal(typeof sandbox.window.PetLilacMotion.mount, 'function');
  assert.equal(Motion.sourceType, '2d_image_motion');
  assert.deepEqual(Motion.situations, [
    'joy', 'laugh', 'excited', 'proud', 'love', 'grateful', 'sad', 'cry', 'lonely', 'disappointed', 'angry', 'sulky',
    'surprise', 'scared', 'nervous', 'confused', 'curious', 'thinking', 'greeting', 'petted', 'shy', 'embarrassed', 'apology', 'cheer',
    'idle', 'resting', 'sleepy', 'yawn', 'relaxed', 'bored', 'feeding', 'moving', 'caught', 'dance', 'celebrate', 'determined'
  ]);
  assert.equal(Motion.catalogue.length, 36);
  assert.equal(Object.isFrozen(Motion.catalogue), true);
  const groups = new Map();
  for (const item of Motion.catalogue) {
    assert.equal(Object.isFrozen(item), true); assert.equal(item.durationMs, Motion.durations[item.id]);
    assert.ok(item.label && item.groupLabel); groups.set(item.group, (groups.get(item.group) || 0) + 1);
  }
  assert.equal(groups.size, 6); assert.ok([...groups.values()].every(n => n === 6));
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

test('growth mesh has separate UVs, bounded vertices and no folded or reversed triangles for any stage', () => {
  for (const stage of growthKeys) {
    const f = fixture({ options: { growthStage:stage } }); f.complete();
    const mesh = f.buffers[0].data, profile = Motion.growthProfile(stage);
    assert.equal(mesh.length, 24 * 24 * 6 * 4);
    assert.deepEqual(f.attributes.map(a => [a.index,a.size,a.stride,a.offset]), [[0,2,16,0],[1,2,16,8]]);
    assert.deepEqual(f.drawCalls[0], { mode:f.gl.TRIANGLES, first:0, count:3456 });
    assert.equal(f.uploads.length, 8);
    for (let i = 0; i < mesh.length; i += 4) {
      const [x,y,u,v] = mesh.subarray(i,i+4);
      assert.ok([x,y,u,v].every(Number.isFinite));
      assert.ok(Math.abs(x) <= 1 && Math.abs(y) <= 1 && u >= 0 && u <= 1 && v >= 0 && v <= 1, stage);
      const point = Motion.growthPoint(stage,u,v);
      const projected = { x:.5 + (point.x-.5)*profile.overallScale, y:.92 + (point.y-.92)*profile.overallScale };
      assert.ok(Math.abs((x+1)/2 - projected.x) < .000001 && Math.abs((1-y)/2 - projected.y) < .000001, stage);
    }
    for (let i = 0; i < mesh.length; i += 12) {
      const [ax,ay,,,bx,by,,,cx,cy] = mesh.subarray(i,i+12);
      assert.ok((bx-ax)*(cy-ay) - (by-ay)*(cx-ax) > 0, stage + ': winding');
    }
    f.api.destroy(); assert.equal(f.created.length, f.deleted.length);
  }
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
    const f = fixture({ options:{ growthStage:stage } });
    const mesh=f.buffers[0].data, col=Math.floor(u*24), row=Math.floor(v*24), a=(row*24+col)*24;
    const fx=u*24-col, fy=v*24-row;
    const indices=fx+fy<=1 ? [a,a+8,a+4] : [a+12,a+16,a+20];
    const weights=fx+fy<=1 ? [1-fx-fy,fx,fy] : [1-fy,1-fx,fx+fy-1];
    const projected={x:0,y:0};
    indices.forEach((offset,i)=>{ projected.x+=(mesh[offset]+1)/2*weights[i]; projected.y+=(1-mesh[offset+1])/2*weights[i]; });
    assert.ok(Math.abs(projected.x-anchor.x)<.001 && Math.abs(projected.y-anchor.y)<.001, stage + ': rendered mouth');
    anchors.add(JSON.stringify(anchor)); f.api.destroy();
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

test('all evolution and growth combinations stay grounded and unfolded with shared UVs and food below the mouth', () => {
  for(const stage of growthKeys)for(const path of Motion.evolutionCatalogue){
    const outfit=Motion.outfitCatalogue[path.index], f=fixture({options:{growthStage:stage,evolutionPath:path.key,outfit:outfit.id}}); f.complete();
    assert.deepEqual(f.bindings,[[0,'a_position'],[1,'a_uv'],[2,'a_evolution']]);
    assert.deepEqual(f.disabledAttributes,[2]); assert.deepEqual(f.constants[2],[...path.rgb,path.index]);
    assert.deepEqual(f.attributes.map(a=>[a.index,a.size,a.stride,a.offset]),[[0,2,16,0],[1,2,16,8]]);
    assert.equal(f.uploads.length,8); assert.equal(Object.values(f.uniforms).filter(x=>Array.isArray(x)&&x.length===4).length,8);
    const mesh=f.buffers[0].data, profile=Motion.growthProfile(stage);
    for(let i=0;i<mesh.length;i+=4){
      const [x,y,u,v]=mesh.subarray(i,i+4),point=Motion.growthPoint(stage,u,v,path.key);
      assert.ok([x,y,u,v].every(Number.isFinite)); assert.ok(Math.abs(x)<=1&&Math.abs(y)<=1,path.key+stage);
      assert.ok(Math.abs((x+1)/2-(.5+(point.x-.5)*profile.overallScale))<.000001);
      assert.ok(Math.abs((1-y)/2-(.92+(point.y-.92)*profile.overallScale))<.000001);
    }
    for(let i=0;i<mesh.length;i+=12){
      const [ax,ay,,,bx,by,,,cx,cy]=mesh.subarray(i,i+12);
      assert.ok((bx-ax)*(cy-ay)-(by-ay)*(cx-ax)>0,path.key+stage+': winding');
    }
    for(let i=0;i<=100;i++){
      const n=i/100;
      assert.equal(Motion.growthPoint(stage,n,.92,path.key).y,.92);
      for(const [x,y]of[[0,n],[1,n],[n,0],[n,1]])assert.deepEqual(Motion.growthPoint(stage,x,y,path.key),{x,y});
    }
    const anchor=Motion.feedingAnchor(stage,path.key),u=.5+(.628-.5)*.88,v=.92+(.499-.92)*.88;
    const col=Math.floor(u*24),row=Math.floor(v*24),a=(row*24+col)*24,fx=u*24-col,fy=v*24-row;
    const indices=fx+fy<=1?[a,a+8,a+4]:[a+12,a+16,a+20],weights=fx+fy<=1?[1-fx-fy,fx,fy]:[1-fy,1-fx,fx+fy-1];
    const projected={x:0,y:0};indices.forEach((offset,i)=>{projected.x+=(mesh[offset]+1)/2*weights[i];projected.y+=(1-mesh[offset+1])/2*weights[i];});
    assert.ok(Math.abs(projected.x-anchor.x)<.001&&Math.abs(projected.y-anchor.y)<.001,path.key+stage+': food mesh');
    assert.equal(anchor.foodTop,anchor.y+.005); assert.equal(anchor.foodLeft,anchor.x-.11);
    for(const name of Motion.situations){
      f.api.setSituation(name,{elapsedMs:Math.min(1000,Motion.durations[name]/2)});
      assert.equal(Math.floor(f.uniforms.u_effect[3]/2),outfit.index); assert.equal(f.raf.size,1);
      for(const values of Object.values(f.uniforms))assert.ok((Array.isArray(values)?values:[values]).every(Number.isFinite));
      const p=Motion.pose(1,name,1,stage,path.key);
      for(const [key,value]of Object.entries(p))if(key!=='situation')assert.ok(Number.isFinite(value));
      if(Motion.durations[name])assert.deepEqual(Motion.pose(10,name,Motion.durations[name]/1000,stage,path.key),Motion.pose(10,'idle',0,stage,path.key));
    }
    assert.equal(Motion.pose(2.2,'feeding',2.2,stage,path.key).chew,Motion.pose(2.2,'feeding',2.2,stage,'balanced').chew);
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

test('evolution paths keep fallbacks and resource cleanup intact without extra image loads', () => {
  const failed=fixture({compileFailure:true,options:{evolutionPath:'active',outfit:'cloth_mint_knit'}});
  assert.equal(failed.errors.length,1);assert.equal(failed.deleted.length,failed.created.length);assert.equal(failed.images.length,0);
  const image=fixture({options:{evolutionPath:'calm'}});image.images[7].onerror();assert.deepEqual(image.errors,['image_failed']);assert.equal(image.canvas.hidden,true);
  const f=fixture({options:{evolutionPath:'fruit',releaseContextOnDestroy:true}});f.complete();
  f.api.setSituation('feeding',{elapsedMs:2200});f.hide(true);const draws=f.draws;f.advance(30000);assert.equal(f.draws,draws);
  f.hide(false);assert.equal(f.uniforms.u_chew,0);assert.equal(f.images.length,8);f.api.destroy();assert.equal(f.released,1);assert.equal(f.raf.size,0);
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

test('every outfit works through all six growth meshes and 36 cues without extra textures, vectors or loops', () => {
  for(const stage of growthKeys)for(const outfit of Motion.outfitCatalogue) {
    const f=fixture({options:{growthStage:stage,outfit:outfit.id}}); f.complete();
    assert.equal(f.uploads.length,8); assert.equal(f.created.filter(x=>x.type==='Texture').length,8);
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
  assert.equal(signatures.size, 35);
  assert.deepEqual(Motion.pose(NaN, 'unknown', Infinity), Motion.pose(0, 'idle', 0));
});

test('all 35 finite acts ease in and release every transform and face to the underlying idle', () => {
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

test('local eight-image load draws expressive RGB keyframes with original cutout alpha and fires ready once', () => {
  const f = fixture(); assert.equal(f.ready, 0); assert.equal(f.draws, 0);
  assert.deepEqual(f.images.map(im => im.url), ['/static/pet_lilac_original.webp', '/static/pet_lilac_half.webp', '/static/pet_lilac_closed.webp', '/static/pet_lilac_cutout.webp', '/static/pet_lilac_sad.webp', '/static/pet_lilac_angry.webp', '/static/pet_lilac_surprise.webp', '/static/pet_lilac_delighted.webp']);
  f.complete(); assert.equal(f.ready, 1); assert.equal(f.draws, 1); assert.equal(f.canvas.hidden, false);
  assert.equal(f.uploads.length, 8); assert.equal(f.canvas.contextOptions.alpha, true); assert.equal(f.canvas.contextOptions.premultipliedAlpha, false);
  assert.match(f.shaders[1], /texture2D\(u_alpha,uv\)\.a/);
  assert.match(f.shaders[1], /texture2D\(u_half,uv\)\.rgb/);
  assert.match(f.shaders[1], /GL_FRAGMENT_PRECISION_HIGH/);
  for (const name of ['sad', 'angry', 'surprise', 'delighted']) assert.match(f.shaders[1], new RegExp('texture2D\\(u_' + name + ',uv\\)\\.rgb'));
  assert.match(f.shaders[1], /face\*weight/);
  assert.match(f.shaders[1], /uniform vec4 u_motionA,u_motionB,u_motionC,u_body,u_gesture,u_face,u_effect,u_detail/);
  assert.match(f.shaders[1], /margin=1\.-\.12\*u_presence/);
  f.images[0].onload(); f.advance(); assert.equal(f.ready, 1); assert.equal(f.uploads.length, 8);
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

test('36 cues can be interrupted or replaced without extra RAF loops, writes or stale face uniforms', () => {
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
  assert.equal(f.draws, 1); assert.equal(f.raf.size, 0);
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

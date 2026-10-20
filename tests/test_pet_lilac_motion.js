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
  const raf = new Map(), timers = new Map(), images = [], created = [], deleted = [], uploads = [], errors = [], uniforms = {}, shaders = [];
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
  gl.getAttribLocation = () => 0;
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
  gl.drawArrays = () => { if (config.drawFailure) throw new Error('raw private driver detail'); draws++; };
  const canvas = events({ ownerDocument: doc, hidden: true, isConnected: true, width: 240, height: 240,
    clientWidth: config.cssWidth || 320,
    getBoundingClientRect: () => ({ width: config.cssWidth || 320 }),
    getContext: (_, options) => { canvas.contextOptions = options; return config.noWebGL ? null : gl; }
  });
  const api = Motion.mount(canvas, { onError: code => errors.push(code), onReady: () => ready++, ...config.options });
  return { api, canvas, win, doc, media, gl, raf, timers, images, errors, created, deleted, uploads, uniforms, shaders,
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

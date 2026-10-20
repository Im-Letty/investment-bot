/* Original B: local 2D image motion. No game state, rewards, storage or network APIs. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PetLilacMotion = api;
})(typeof window !== 'undefined' ? window : null, function (environment) {
  'use strict';
  var PI = Math.PI, TAU = PI * 2;
  var durations = Object.freeze({ idle: 0, greeting: 4200, feeding: 5000, petted: 4600,
    resting: 6500, joy: 3800, moving: 1600, caught: 1500 });
  var mounted = typeof WeakMap === 'function' ? new WeakMap() : null;
  var assets = ['pet_lilac_original.webp', 'pet_lilac_half.webp', 'pet_lilac_closed.webp', 'pet_lilac_cutout.webp'];
  function finite(n, fallback) { return typeof n === 'number' && Number.isFinite(n) ? n : fallback; }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function smooth(n) { n = clamp(n, 0, 1); return n * n * (3 - 2 * n); }
  function known(name) { return Object.prototype.hasOwnProperty.call(durations, name) ? name : 'idle'; }
  function pulse(t, at, width) {
    var x = (t - at) / width;
    if (x < 0 || x > 1) return 0;
    return x < .35 ? smooth(x / .35) : x < .5 ? 1 : 1 - smooth((x - .5) / .5);
  }
  function envelope(t, duration) {
    return smooth(t / Math.min(.55, duration * .22)) * smooth((duration - t) / Math.min(.8, duration * .28));
  }
  // Pure motion profile: seconds is continuous idle phase; elapsedSeconds is this cue's age.
  function pose(seconds, situation, elapsedSeconds) {
    var s = Math.max(0, finite(seconds, 0)), t = s % 12, name = known(situation);
    var age = Math.max(0, finite(elapsedSeconds, s)), duration = durations[name] / 1000;
    if (name !== 'idle' && age >= duration) name = 'idle';
    var tilt = Math.sin((t - 2.8) / 4.2 * PI) * envelope(t - 2.8, 4.2);
    if (t < 2.8 || t > 7) tilt = 0;
    var wave = smooth((t - 7.2) / .7) * smooth((10.1 - t) / .7);
    var p = { situation: name, breath: Math.sin(s * TAU / 4),
      blink: Math.min(1, pulse(t, 1.65, .28) + pulse(t, 4.9, .26) + pulse(t, 5.28, .24) + pulse(t, 10.4, .3)),
      tilt: tilt * .026 + Math.sin(s * TAU / 12) * .0025,
      ear: Math.sin(s * TAU / 6) * .35 + tilt * .4,
      tail: Math.sin(s * TAU / 6) * .25,
      wave: wave, wiggle: Math.sin((t - 7.2) * TAU * 1.45) * wave,
      chew: 0, bounce: 0, step: 0,
      lookX: Math.sin(s * TAU / 12) * .00065, lookY: Math.sin(s * TAU / 6) * .00035 };
    if (name === 'idle') return p;
    var e = envelope(age, duration), beat = Math.sin(age * TAU);
    // Action cues replace the idle gesture, then settle back to idle without persisting anything.
    p.wave *= 1 - e; p.wiggle *= 1 - e; p.tilt *= 1 - e;
    if (name === 'greeting') { p.wave += e * .72; p.wiggle += e * Math.sin(age * TAU * 1.2); p.tilt += e * .018; }
    if (name === 'feeding') { p.chew = e * Math.sin(age * TAU * 1.7); p.wave += e * (.16 + .08 * beat); p.tilt += e * .006 * beat; }
    if (name === 'petted') { p.blink = Math.max(p.blink, e); p.tilt += e * .022; p.ear += e * .3 * Math.sin(age * PI); }
    if (name === 'resting') { p.blink = Math.max(p.blink, e); p.breath = (1 - e) * p.breath + e * .55 * Math.sin(s * TAU / 6); p.tilt += e * .012; p.ear *= 1 - .75 * e; p.tail *= 1 - .8 * e; }
    if (name === 'joy') { p.bounce = e * Math.pow(Math.sin(age * PI * 1.7), 2); p.wave += e * .85; p.wiggle += e * Math.sin(age * TAU * 1.6); p.ear += e * .4 * beat; p.tail += e * .35 * beat; }
    if (name === 'moving') { p.step = e * Math.sin(age * TAU * 2); p.bounce = e * .18 * Math.abs(p.step); p.tilt += e * .004 * Math.sin(age * TAU * 2); }
    if (name === 'caught') { p.bounce = e * .6 * Math.pow(Math.sin(age * PI * 1.4), 2); p.wave += e * .55; p.ear += e * .35; p.tail += e * .2; }
    return p;
  }
  function growth(exp) { return exp >= 110 ? 3 : exp >= 45 ? 2 : exp >= 15 ? 1 : 0; }
  // Returning null is deliberate: rejected/unconfirmed saves must not look successful.
  function situationForAction(action, before, after, result) {
    if (!result || result.ok !== true || !action || typeof action.type !== 'string') return null;
    var name = null;
    if (before && before.pet && after && after.pet &&
        growth(finite(after.pet.exp, 0)) > growth(finite(before.pet.exp, 0))) name = 'joy';
    else if (action.type === 'care') name = action.kind === 'feed' ? 'feeding' : action.kind === 'play' ? 'petted' : action.kind === 'rest' ? 'resting' : null;
    else if (action.type === 'useItem') name = 'feeding';
    else if (action.type === 'finishMinigame' && action.score > 0) name = 'caught';
    else if (action.type === 'chooseSpecies' || action.type === 'rename') name = 'greeting';
    else if (['buyItem', 'equip', 'chooseAppearance', 'transferLegacy'].indexOf(action.type) >= 0) name = 'joy';
    else if (action.type === 'advanceMarketDay' && result.reward && result.reward.dividend > 0) name = 'joy';
    return name ? { situation: name, durationMs: durations[name] } : null;
  }

  var vertexSource = 'attribute vec2 a_position; varying vec2 v_uv; void main(){v_uv=vec2(a_position.x*.5+.5,.5-a_position.y*.5);gl_Position=vec4(a_position,0.,1.);}';
  var fragmentSource = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH', 'precision highp float;', '#else', 'precision mediump float;', '#endif',
    'varying vec2 v_uv; uniform sampler2D u_original,u_half,u_closed,u_alpha;',
    'uniform float u_breath,u_tilt,u_ear,u_tail,u_wave,u_wiggle,u_blink,u_chew,u_bounce,u_step,u_scale;',
    'uniform vec2 u_look;',
    'float region(vec2 p,vec2 c,vec2 r){vec2 q=(p-c)/r;return exp(-dot(q,q)*2.);}',
    'mat2 rotation(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}',
    'float eyeMask(vec2 p,vec2 c,vec2 r){return 1.-smoothstep(.85,1.1,length(rotation(.28)*(p-c)/r));}',
    'void main(){vec2 p=(v_uv-vec2(.5,.92))/u_scale+vec2(.5,.92);',
    'float body=region(p,vec2(.56,.57),vec2(.56,.56));float above=clamp((.91-p.y)/.33,0.,1.);',
    'p.y+=u_breath*.0042*body*above+u_bounce*.004;p.x-=(p.x-.58)*u_breath*.003*body;',
    'vec2 neck=vec2(.62,.675);float head=(1.-smoothstep(.64,.79,p.y))*(1.-smoothstep(.94,1.,p.x));',
    'p=mix(p,neck+rotation(u_tilt)*(p-neck),head);',
    'p+=vec2(u_ear*.0025,u_ear*.005)*region(p,vec2(.17,.345),vec2(.18,.15));',
    'p+=vec2(-u_ear*.0018,u_ear*.003)*region(p,vec2(.82,.16),vec2(.15,.17));',
    'p.x+=u_ear*.003*region(p,vec2(.50,.12),vec2(.105,.14));',
    'float paw=region(p,vec2(.728,.729),vec2(.099,.115));p.y+=u_wave*.014*paw;p.x-=(u_wave*.004+u_wiggle*.005)*paw;',
    'float tail=region(p,vec2(.155,.728),vec2(.115,.19));p.x+=u_tail*.003*tail;p.y-=u_tail*.005*tail;',
    'float mouth=region(p,vec2(.628,.499),vec2(.063,.034));p.y+=u_chew*.0018*mouth;',
    'p.y+=u_step*.0013*(region(p,vec2(.413,.905),vec2(.067,.043))-region(p,vec2(.690,.905),vec2(.060,.043)));',
    'float eye=max(eyeMask(p,vec2(.4665,.429),vec2(.135,.125)),eyeMask(p,vec2(.7281,.3405),vec2(.115,.12)));',
    'float iris=region(p,vec2(.4665,.429),vec2(.052,.059))+region(p,vec2(.7281,.3405),vec2(.045,.065));',
    'p-=u_look*iris*(1.-u_blink);vec2 uv=clamp(p,vec2(.0001),vec2(.9999));',
    'vec3 rgb=texture2D(u_original,uv).rgb;rgb=mix(rgb,texture2D(u_half,uv).rgb,eye*smoothstep(0.,.5,u_blink));',
    'rgb=mix(rgb,texture2D(u_closed,uv).rgb,eye*smoothstep(.5,1.,u_blink));',
    'float a=texture2D(u_alpha,uv).a;if(p.x<0.||p.y<0.||p.x>1.||p.y>1.)a=0.;gl_FragColor=vec4(rgb,a);}'
  ].join('\n');

  function mount(canvas, options) {
    options = options || {};
    if (mounted && canvas && mounted.has(canvas)) mounted.get(canvas).destroy();
    var doc = canvas && canvas.ownerDocument, win = doc && doc.defaultView || environment;
    doc = doc || win && win.document;
    var gl, dead = false, loaded = false, readyNotified = false, pageVisible = true, frame = null, timer = null, observer = null;
    var media = null, removers = [], images = [], resources = [], locations = {};
    var phaseMs = 0, cue = 'idle', cueMs = 0, cueAnchor = 0, cueDuration = 0, last = null;
    var scale = clamp(finite(options.scale, 1), .35, 1.15);
    var clock = typeof options.now === 'function' ? options.now : function () { return win.performance && win.performance.now ? win.performance.now() : Date.now(); };
    function listen(target, type, callback) {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(type, callback);
      removers.push(function () { target.removeEventListener(type, callback); });
    }
    function cancel() { if (frame !== null) { win.cancelAnimationFrame(frame); frame = null; } last = null; }
    function destroy() {
      if (dead) return;
      dead = true; cancel();
      if (timer !== null) { win.clearTimeout(timer); timer = null; }
      images.forEach(function (image) {
        image.onload = null; image.onerror = null;
        if (typeof image.removeAttribute === 'function') image.removeAttribute('src');
      });
      removers.forEach(function (remove) { remove(); }); removers = [];
      if (observer) observer.disconnect();
      resources.reverse().forEach(function (r) { try { gl[r[0]](r[1]); } catch (_) {} }); resources = [];
      // Each UI rebuild owns a fresh canvas; release the old GPU context promptly.
      try {
        var release = options.releaseContextOnDestroy === true && gl && typeof gl.getExtension === 'function' && gl.getExtension('WEBGL_lose_context');
        if (release) release.loseContext();
      } catch (_) {}
      if (mounted && mounted.get(canvas) === controller) mounted.delete(canvas);
    }
    function fail(code) {
      if (dead) return;
      if (canvas) canvas.hidden = true;
      destroy();
      if (typeof options.onError === 'function') { try { options.onError(code); } catch (_) {} }
    }
    function setSituation(name, values) {
      if (dead) return;
      values = values || {}; cue = known(name);
      cueDuration = cue === 'idle' ? 0 : clamp(finite(values.durationMs, durations[cue]), 0, 30000);
      cueMs = Math.max(0, finite(values.elapsedMs, 0)); cueAnchor = finite(clock(), 0);
      if (cue !== 'idle' && cueMs >= cueDuration) { cue = 'idle'; cueMs = 0; }
      if (loaded && !doc.hidden) paint();
      schedule();
    }
    var controller = { setSituation: setSituation, destroy: destroy };
    if (!canvas || !win || !doc || typeof win.Image !== 'function' || !win.requestAnimationFrame || !win.cancelAnimationFrame) { fail('environment_unavailable'); return controller; }
    if (mounted) mounted.set(canvas, controller);
    var assetRoot = options.assetRoot == null ? '/static/' : options.assetRoot;
    if (typeof assetRoot !== 'string' || !/^\/(?!\/)/.test(assetRoot) || /[\\:?#]/.test(assetRoot)) { fail('asset_root_invalid'); return controller; }
    if (assetRoot.charAt(assetRoot.length - 1) !== '/') assetRoot += '/';
    function own(method) {
      var value = gl[method]();
      if (!value) throw new Error('allocation');
      resources.push([{ createShader: 'deleteShader', createProgram: 'deleteProgram', createBuffer: 'deleteBuffer', createTexture: 'deleteTexture' }[method], value]);
      return value;
    }
    function shader(type, source) {
      var value = gl.createShader(type);
      if (!value) throw new Error('allocation');
      resources.push(['deleteShader', value]);
      gl.shaderSource(value, source); gl.compileShader(value);
      if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error('compile');
      return value;
    }
    function active() { return !dead && loaded && pageVisible && !doc.hidden && !(media && media.matches) && canvas.isConnected !== false; }
    function resize() {
      if (dead) return;
      var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
      var css = rect && rect.width > 0 ? rect.width : canvas.clientWidth || 256;
      var side = Math.round(clamp(css * clamp(finite(win.devicePixelRatio, 1), 1, 2), 1, 768));
      if (canvas.width !== side || canvas.height !== side) { canvas.width = side; canvas.height = side; }
    }
    function paint() {
      if (dead || !loaded || !pageVisible || doc.hidden || canvas.isConnected === false) return;
      try {
        resize();
        var reduced = media && media.matches;
        var age = cueMs + Math.max(0, finite(clock(), cueAnchor) - cueAnchor);
        if (cue !== 'idle' && age >= cueDuration) { cue = 'idle'; cueMs = 0; cueDuration = 0; }
        var elapsed = cueDuration ? age / cueDuration * durations[cue] / 1000 : 0;
        var p = reduced ? pose(0, 'idle', 0) : pose(phaseMs / 1000, cue, elapsed);
        if (reduced) { p.tail = 0; }
        gl.viewport(0, 0, canvas.width, canvas.height);
        ['breath', 'tilt', 'ear', 'tail', 'wave', 'wiggle', 'blink', 'chew', 'bounce', 'step'].forEach(function (key) { gl.uniform1f(locations[key], p[key]); });
        gl.uniform1f(locations.scale, scale); gl.uniform2f(locations.look, p.lookX, p.lookY);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        if (!readyNotified) {
          readyNotified = true;
          if (typeof options.onReady === 'function') { try { options.onReady(); } catch (_) {} }
        }
      } catch (_) { fail('render_failed'); }
    }
    function schedule() {
      if (frame !== null || !active()) return;
      frame = win.requestAnimationFrame(tick);
    }
    function tick() {
      frame = null;
      if (!active()) { last = null; return; }
      var stamp = finite(clock(), 0);
      var delta = last === null ? 0 : clamp(stamp - last, 0, 100);
      last = stamp; phaseMs += delta;
      paint(); schedule();
    }
    try {
      gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false });
      if (!gl) { fail('webgl_unavailable'); return controller; }
      var program = own('createProgram');
      gl.attachShader(program, shader(gl.VERTEX_SHADER, vertexSource));
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragmentSource));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('link');
      gl.useProgram(program);
      var buffer = own('createBuffer'); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      var position = gl.getAttribLocation(program, 'a_position');
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      ['breath', 'tilt', 'ear', 'tail', 'wave', 'wiggle', 'blink', 'chew', 'bounce', 'step', 'scale', 'look'].forEach(function (key) { locations[key] = gl.getUniformLocation(program, 'u_' + key); });
      var textures = assets.map(function (_, i) { gl.uniform1i(gl.getUniformLocation(program, ['u_original', 'u_half', 'u_closed', 'u_alpha'][i]), i); return own('createTexture'); });
      if (typeof win.matchMedia === 'function') media = win.matchMedia('(prefers-reduced-motion: reduce)');
      function preference() { cancel(); paint(); schedule(); }
      if (media) {
        if (media.addEventListener) listen(media, 'change', preference);
        else if (media.addListener) { media.addListener(preference); removers.push(function () { media.removeListener(preference); }); }
      }
      listen(doc, 'visibilitychange', function () { cancel(); if (!doc.hidden) { paint(); schedule(); } });
      listen(win, 'pagehide', function () { pageVisible = false; cancel(); });
      listen(win, 'pageshow', function () { pageVisible = true; paint(); schedule(); });
      listen(canvas, 'webglcontextlost', function (event) { if (event.preventDefault) event.preventDefault(); fail('context_lost'); });
      if (typeof win.ResizeObserver === 'function') { observer = new win.ResizeObserver(function () { paint(); }); observer.observe(canvas); }
      else listen(win, 'resize', paint);
      function load() {
        if (dead || loaded || images.length !== 4 || !images.every(function (im) { return im.complete && im.naturalWidth > 0; })) return;
        try {
          var first = images[0];
          if (images.some(function (im) { return im.naturalWidth !== first.naturalWidth || im.naturalHeight !== first.naturalHeight; })) { fail('image_dimensions_mismatch'); return; }
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          images.forEach(function (im, i) {
            gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, textures[i]);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
          });
          loaded = true; canvas.hidden = false;
          if (timer !== null) { win.clearTimeout(timer); timer = null; }
          paint(); schedule();
        } catch (_) { fail('texture_failed'); }
      }
      assets.forEach(function () { var im = new win.Image(); im.onload = load; im.onerror = function () { fail('image_failed'); }; images.push(im); });
      setSituation(options.situation || 'idle', options);
      timer = win.setTimeout(function () { fail('image_timeout'); }, 15000);
      images.forEach(function (im, i) { if (!dead) im.src = assetRoot + assets[i]; });
      load();
    } catch (_) { fail('webgl_setup_failed'); }
    return controller;
  }
  return Object.freeze({ mount: mount, pose: pose, situationForAction: situationForAction,
    durations: durations, situations: Object.freeze(Object.keys(durations)), sourceType: '2d_image_motion' });
});

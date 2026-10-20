/* Original B: local 2D image motion. No game state, rewards, storage or network APIs. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PetLilacMotion = api;
})(typeof window !== 'undefined' ? window : null, function (environment) {
  'use strict';
  var PI = Math.PI, TAU = PI * 2;
  var groups = [
    ['happy', '喜び', [['joy', '喜ぶ', 3800], ['laugh', '大笑い', 5000], ['excited', 'わくわく', 4800], ['proud', '得意げ', 5000], ['love', 'だいすき', 5600], ['grateful', 'ありがとう', 5200]]],
    ['feeling', '悲しみ・怒り', [['sad', '悲しい', 6000], ['cry', '泣く', 6200], ['lonely', 'さみしい', 5800], ['disappointed', 'がっかり', 5000], ['angry', '怒る', 5200], ['sulky', 'すねる', 5500]]],
    ['wonder', '驚き・考え', [['surprise', 'びっくり', 4200], ['scared', 'こわい', 5200], ['nervous', 'そわそわ', 5600], ['confused', '困る', 5500], ['curious', 'きになる', 5400], ['thinking', '考える', 6200]]],
    ['social', 'ふれあい', [['greeting', 'おかえり', 4200], ['petted', 'なでられる', 4600], ['shy', 'はにかむ', 5400], ['embarrassed', 'あせる', 5000], ['apology', 'ごめんね', 5400], ['cheer', '応援', 5200]]],
    ['calm', 'くつろぎ', [['idle', 'ふだん', 0], ['resting', 'おやすみ', 6500], ['sleepy', 'うとうと', 6200], ['yawn', 'あくび', 5600], ['relaxed', 'のんびり', 6200], ['bored', 'ひま', 6000]]],
    ['action', 'アクション', [['feeding', 'ごはん', 5000], ['moving', '移動', 1600], ['caught', 'キャッチ', 1500], ['dance', 'ダンス', 6500], ['celebrate', 'お祝い', 6000], ['determined', 'やるぞ', 5400]]]
  ];
  var catalogue = Object.freeze(groups.reduce(function (list, group) {
    return list.concat(group[2].map(function (item) { return Object.freeze({ id: item[0], label: item[1], group: group[0], groupLabel: group[1], durationMs: item[2] }); }));
  }, []));
  var durations = Object.freeze(catalogue.reduce(function (result, item) { result[item.id] = item.durationMs; return result; }, {}));
  var mounted = typeof WeakMap === 'function' ? new WeakMap() : null;
  // WebGL 1 guarantees eight fragment texture units. Every expression keeps original cutout alpha.
  var assets = ['pet_lilac_original.webp', 'pet_lilac_half.webp', 'pet_lilac_closed.webp', 'pet_lilac_cutout.webp',
    'pet_lilac_sad.webp', 'pet_lilac_angry.webp', 'pet_lilac_surprise.webp', 'pet_lilac_delighted.webp'];
  var packedUniforms = {
    motionA: ['breath', 'tilt', 'ear', 'tail'], motionB: ['wave', 'wiggle', 'blink', 'chew'],
    motionC: ['bounce', 'step', 'scale', 'presence'], body: ['bodyAngle', 'shiftX', 'shiftY', 'squash'],
    gesture: ['stretch', 'crouch', 'pawSpread', 'mouthOpen'], face: ['faceSad', 'faceAngry', 'faceSurprise', 'faceDelighted'],
    effect: ['tear', 'blush', 'sweat', 'anger'], detail: ['eyeNarrow', 'lookX', 'lookY', 'effectPhase']
  };
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
    return smooth(t / Math.min(.45, duration * .22)) * smooth((duration - t) / Math.min(.8, duration * .28));
  }
  // Pure profiles in seconds. Emotions ease in and settle to the exact underlying idle pose.
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
      lookX: Math.sin(s * TAU / 12) * .00065, lookY: Math.sin(s * TAU / 6) * .00035,
      presence: 0, bodyAngle: 0, shiftX: 0, shiftY: 0, squash: 0, stretch: 0, crouch: 0, pawSpread: 0,
      faceSad: 0, faceAngry: 0, faceSurprise: 0, faceDelighted: 0, tear: 0, blush: 0, sweat: 0, anger: 0,
      eyeNarrow: 0, mouthOpen: 0, effectPhase: 0 };
    if (name === 'idle') return p;
    var e = envelope(age, duration), beat = Math.sin(age * TAU), fast = Math.sin(age * TAU * 2.4);
    var hop = Math.pow(Math.max(0, Math.sin(age * TAU * 1.15)), 2);
    var nod = .5 - .5 * Math.cos(age * TAU * .65);
    p.presence = e; p.effectPhase = age;
    p.wave *= 1 - e; p.wiggle *= 1 - e; p.tilt *= 1 - e;
    // The profile values below are intentional acting choices: bows, recoils, hunches,
    // stomps, hiding paws and sweeping dance steps, rather than one reused wobble.
    switch (name) {
      case 'joy': p.faceDelighted = .75; p.bounce = hop; p.wave = .9; p.wiggle = fast; p.ear += .6 * beat; p.tail += .8 * beat; p.squash = .4 * (1 - hop); break;
      case 'laugh': p.faceDelighted = 1; p.blink = Math.max(p.blink, .95 * e); p.mouthOpen = .7 + .3 * fast; p.squash = .65 * fast; p.bodyAngle = .038 * beat; p.crouch = .25; p.wave = .3; p.ear += .8 * fast; break;
      case 'excited': p.faceDelighted = .85; p.bounce = .7 * Math.abs(fast); p.pawSpread = .65; p.wave = .9; p.stretch = .55 * fast; p.tail += 1.4 * fast; p.lookY = -.008; break;
      case 'proud': p.faceDelighted = .35; p.stretch = .8; p.bodyAngle = -.035; p.tilt = -.075; p.pawSpread = 1; p.wave = .35; p.eyeNarrow = .35; p.tail += .75; p.shiftY = -.006; break;
      case 'love': p.faceDelighted = .65; p.blush = 1; p.bodyAngle = .055 * Math.sin(age * PI * .6); p.tilt = .065; p.wave = .75; p.pawSpread = -.7; p.lookX = -.007; p.ear -= .55; break;
      case 'grateful': p.faceDelighted = .45; p.blink = Math.max(p.blink, e * .85); p.tilt = .065 * nod; p.bodyAngle = .03 * nod; p.crouch = .8 * nod; p.pawSpread = -.65; p.wave = .7; p.ear -= .7 * nod; break;
      case 'sad': p.faceSad = 1; p.tilt = .065; p.crouch = .85; p.ear -= 1.1; p.tail -= .8; p.wave = -.5; p.lookY = .012; p.bodyAngle = .02 * Math.sin(age * PI * .4); break;
      case 'cry': p.faceSad = 1; p.tear = 1; p.crouch = .9; p.squash = .35 * fast; p.bodyAngle = .018 * Math.sin(age * TAU * 3.4); p.pawSpread = -.9; p.wave = 1; p.ear -= 1.25; p.mouthOpen = .2 + .2 * fast; break;
      case 'lonely': p.faceSad = .8; p.bodyAngle = -.048; p.tilt = .075 * Math.sin(age * PI * .36); p.shiftX = -.012; p.pawSpread = -.6; p.ear -= .8; p.tail -= .9; p.lookX = .009 * Math.sin(age * PI * .36); p.crouch = .45; break;
      case 'disappointed': p.faceSad = .9; p.crouch = Math.min(1, age / .7); p.squash = .65; p.tilt = .08; p.ear -= 1.35; p.wave = -.8; p.lookY = .014; p.stretch = -.3; break;
      case 'angry': p.faceAngry = 1; p.anger = 1; p.step = .8 * Math.sin(age * TAU * 1.7); p.squash = .45 * Math.abs(p.step); p.bodyAngle = .04 * Math.sin(age * TAU * 1.7); p.pawSpread = .85; p.wave = .55; p.ear += .8; p.tail += 1.3 * beat; p.tilt = -.025; break;
      case 'sulky': p.faceAngry = .7; p.faceSad = .25; p.bodyAngle = -.065; p.tilt = -.075; p.pawSpread = -.75; p.wave = .55; p.eyeNarrow = .6; p.lookX = .014; p.ear -= .65; p.crouch = .3; break;
      case 'surprise': p.faceSurprise = 1; p.bounce = .9 * pulse(age, .12, 1.25); p.stretch = .75; p.pawSpread = 1; p.wave = .95; p.tilt = -.04; p.ear += 1.25; p.mouthOpen = 1; p.shiftX = -.015 * pulse(age, .12, 1.25); break;
      case 'scared': p.faceSurprise = .9; p.sweat = .7; p.bodyAngle = .025 * Math.sin(age * TAU * 5.6); p.shiftX = -.022; p.crouch = .9; p.pawSpread = -.9; p.wave = .9; p.ear -= 1.4; p.tail -= 1.2; p.mouthOpen = .45; break;
      case 'nervous': p.faceSurprise = .45; p.sweat = 1; p.step = .55 * Math.sin(age * TAU * 1.4); p.bodyAngle = .025 * beat; p.lookX = .012 * Math.sin(age * PI * 1.2); p.wave = .45; p.pawSpread = -.4; p.ear += .4 * fast; break;
      case 'confused': p.faceSurprise = .4; p.tilt = .11 * Math.sin(age * PI * .7); p.pawSpread = .7; p.wave = .35 + .3 * nod; p.lookY = -.006; p.ear += .55 * Math.sin(age * PI * .7); p.bodyAngle = -.02; break;
      case 'curious': p.faceSurprise = .3; p.tilt = -.095; p.shiftX = .022 * nod; p.stretch = .6; p.lookX = -.012; p.lookY = -.005; p.wave = .3; p.ear += 1.15; p.tail += .5; break;
      case 'thinking': p.tilt = .075; p.wave = .95; p.pawSpread = -.3; p.eyeNarrow = .45; p.lookX = .01; p.lookY = -.009; p.ear -= .35; p.bodyAngle = .012 * Math.sin(age * PI * .4); p.faceSurprise = .12; break;
      case 'greeting': p.wave = 1; p.wiggle = Math.sin(age * TAU * 1.5); p.tilt = .05; p.faceDelighted = .45; p.pawSpread = .7; p.tail += .8 * beat; break;
      case 'petted': p.blink = Math.max(p.blink, e); p.tilt = .075; p.ear += .5 * Math.sin(age * PI); p.faceDelighted = .45; p.bodyAngle = .035 * nod; p.blush = .55; p.crouch = .25; break;
      case 'shy': p.faceDelighted = .2; p.blush = .9; p.pawSpread = -1; p.wave = 1.1; p.tilt = .065; p.bodyAngle = .045 * Math.sin(age * PI * .65); p.lookY = .007; p.ear -= .85; p.crouch = .3; break;
      case 'embarrassed': p.faceSurprise = .55; p.blush = .85; p.sweat = .65; p.wiggle = Math.sin(age * TAU * 2); p.wave = .9; p.pawSpread = .5; p.tilt = -.055; p.step = .45 * fast; p.ear += .45 * fast; break;
      case 'apology': p.faceSad = .65; p.blink = Math.max(p.blink, e * .8); p.crouch = .85 * nod; p.tilt = .095 * nod; p.bodyAngle = .04 * nod; p.ear -= 1.1; p.wave = .3; p.pawSpread = -.85; break;
      case 'cheer': p.faceDelighted = .85; p.wave = .65 + .45 * Math.abs(fast); p.pawSpread = 1; p.bounce = .6 * hop; p.bodyAngle = .035 * beat; p.tail += .9 * beat; p.stretch = .4; break;
      case 'resting': p.blink = Math.max(p.blink, e); p.breath = (1 - e) * p.breath + e * .55 * Math.sin(s * TAU / 6); p.tilt = .065; p.ear -= .7; p.tail *= .2; p.crouch = .8; p.squash = .25; break;
      case 'sleepy': p.blink = Math.max(p.blink, e * (.65 + .35 * nod)); p.tilt = .10 * nod; p.crouch = .45 + .35 * nod; p.ear -= .85; p.bodyAngle = .025 * Math.sin(age * PI * .5); p.eyeNarrow = .55; break;
      case 'yawn': p.faceSurprise = .7 * nod; p.blink = Math.max(p.blink, e * .9); p.mouthOpen = nod; p.stretch = .9 * nod; p.pawSpread = .8 * nod; p.wave = .8; p.tilt = -.065 * nod; p.ear += .55 * nod; break;
      case 'relaxed': p.blink = Math.max(p.blink, e * .75); p.tilt = -.045; p.bodyAngle = .035 * Math.sin(age * PI * .4); p.crouch = .35; p.ear -= .45; p.tail += .4 * Math.sin(age * PI * .5); p.faceDelighted = .25; p.breath *= .6; break;
      case 'bored': p.faceSad = .25; p.eyeNarrow = .8; p.tilt = .075; p.crouch = .65; p.wave = .65; p.pawSpread = -.25; p.lookX = .014 * Math.sin(age * PI * .45); p.ear -= .9; p.step = .2 * Math.sin(age * TAU * .65); break;
      case 'feeding': p.chew = Math.sin(age * TAU * 1.7); p.wave = .75 + .12 * beat; p.pawSpread = -.65; p.tilt = .025 * beat; p.faceDelighted = .3; p.squash = .12 * beat; break;
      case 'moving': p.step = Math.sin(age * TAU * 2); p.bounce = .25 * Math.abs(p.step); p.bodyAngle = .035 * p.step; p.shiftX = .018 * Math.sin(age * PI * 1.2); p.wave = .25; p.ear += .4 * p.step; break;
      case 'caught': p.bounce = .75 * Math.pow(Math.sin(age * PI * 1.4), 2); p.wave = 1; p.pawSpread = -.3; p.faceDelighted = .8; p.ear += .85; p.tail += .7; p.stretch = .5; break;
      case 'dance': p.faceDelighted = .75; p.bodyAngle = .085 * Math.sin(age * PI * 1.3); p.shiftX = .025 * Math.sin(age * PI * 1.3); p.step = Math.sin(age * TAU * 1.3); p.bounce = .35 * Math.abs(p.step); p.wave = .7; p.wiggle = fast; p.pawSpread = .8 * beat; p.tail += 1.1 * beat; break;
      case 'celebrate': p.faceDelighted = 1; p.bounce = .95 * hop; p.wave = 1.15; p.pawSpread = 1.1; p.stretch = .65; p.bodyAngle = .05 * beat; p.ear += 1; p.tail += 1.2 * fast; p.mouthOpen = .6; break;
      case 'determined': p.faceAngry = .4; p.eyeNarrow = .25; p.crouch = .65 * nod; p.stretch = .55 * (1 - nod); p.pawSpread = .35; p.wave = .85; p.ear += .9; p.tilt = -.045; p.squash = .3 * nod; p.tail += .7; break;
    }
    // All acting offsets, including facial keyframes, share the same release envelope.
    ['bounce', 'step', 'chew', 'bodyAngle', 'shiftX', 'shiftY', 'squash', 'stretch', 'crouch', 'pawSpread',
      'faceSad', 'faceAngry', 'faceSurprise', 'faceDelighted', 'tear', 'blush', 'sweat', 'anger', 'eyeNarrow', 'mouthOpen'].forEach(function (key) { p[key] *= e; });
    p.tilt *= e;
    // Retain the idle motion while releasing a cue; no frozen hold or sudden final snap.
    var idle = pose(s, 'idle', 0);
    p.tilt += idle.tilt * (1 - e);
    p.breath = idle.breath + (p.breath - idle.breath) * e;
    p.ear = idle.ear + (p.ear - idle.ear) * e;
    p.tail = idle.tail + (p.tail - idle.tail) * e;
    p.wave = idle.wave * (1 - e) + p.wave * e;
    p.wiggle = idle.wiggle * (1 - e) + p.wiggle * e;
    p.lookX = idle.lookX * (1 - e) + p.lookX * e;
    p.lookY = idle.lookY * (1 - e) + p.lookY * e;
    p.blink = clamp(p.blink, 0, 1);
    p.effectPhase *= e;
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
    'varying vec2 v_uv; uniform sampler2D u_original,u_half,u_closed,u_alpha,u_sad,u_angry,u_surprise,u_delighted;',
    'uniform vec4 u_motionA,u_motionB,u_motionC,u_body,u_gesture,u_face,u_effect,u_detail;',
    '#define u_breath u_motionA.x', '#define u_tilt u_motionA.y', '#define u_ear u_motionA.z', '#define u_tail u_motionA.w',
    '#define u_wave u_motionB.x', '#define u_wiggle u_motionB.y', '#define u_blink u_motionB.z', '#define u_chew u_motionB.w',
    '#define u_bounce u_motionC.x', '#define u_step u_motionC.y', '#define u_scale u_motionC.z', '#define u_presence u_motionC.w',
    '#define u_bodyAngle u_body.x', '#define u_shiftX u_body.y', '#define u_shiftY u_body.z', '#define u_squash u_body.w',
    '#define u_stretch u_gesture.x', '#define u_crouch u_gesture.y', '#define u_pawSpread u_gesture.z', '#define u_mouthOpen u_gesture.w',
    '#define u_tear u_effect.x', '#define u_blush u_effect.y', '#define u_sweat u_effect.z', '#define u_anger u_effect.w',
    '#define u_eyeNarrow u_detail.x', '#define u_look u_detail.yz', '#define u_phase u_detail.w',
    'float region(vec2 p,vec2 c,vec2 r){vec2 q=(p-c)/r;return exp(-dot(q,q)*2.);}',
    'mat2 rotation(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}',
    'float eyeMask(vec2 p,vec2 c,vec2 r){return 1.-smoothstep(.85,1.1,length(rotation(.28)*(p-c)/r));}',
    'float droplet(vec2 p,vec2 c,vec2 r){vec2 q=(p-c)/r;return 1.-smoothstep(.75,1.05,dot(q,q));}',
    'void main(){vec2 anchor=vec2(.5,.92);float margin=1.-.12*u_presence;',
    'vec2 p=(v_uv-anchor)/(u_scale*margin)+anchor;p-=vec2(u_shiftX,u_shiftY);p=anchor+rotation(u_bodyAngle)*(p-anchor);',
    'p=(p-anchor)/vec2(1.+.085*u_squash,1.-.075*u_squash+.07*u_stretch-.055*u_crouch)+anchor;',
    'p.y+=u_bounce*.055-u_crouch*.012;',
    'float body=region(p,vec2(.56,.57),vec2(.56,.56));float above=clamp((.91-p.y)/.33,0.,1.);',
    'p.y+=u_breath*.0042*body*above;p.x-=(p.x-.58)*u_breath*.003*body;',
    'vec2 neck=vec2(.62,.675);float head=(1.-smoothstep(.64,.79,p.y))*(1.-smoothstep(.94,1.,p.x));',
    'p=mix(p,neck+rotation(u_tilt)*(p-neck),head);',
    'p+=vec2(u_ear*.012,u_ear*.024)*region(p,vec2(.17,.345),vec2(.18,.15));',
    'p+=vec2(-u_ear*.01,u_ear*.018)*region(p,vec2(.82,.16),vec2(.15,.17));',
    'p.x+=u_ear*.014*region(p,vec2(.50,.12),vec2(.105,.14));',
    'float pawR=region(p,vec2(.728,.729),vec2(.099,.115));float pawL=region(p,vec2(.50,.755),vec2(.11,.11));',
    'p.y+=u_wave*.038*max(pawR,pawL);p.x-=(u_wiggle*.018+u_wave*.006)*pawR;',
    'p.x+=u_wiggle*.009*pawL+u_pawSpread*.025*(pawL-pawR);',
    'float tail=region(p,vec2(.155,.728),vec2(.115,.19));p.x+=u_tail*.014*tail;p.y-=u_tail*.024*tail;',
    'float mouth=region(p,vec2(.628,.499),vec2(.080,.055));p.y+=u_chew*.010*mouth;',
    'p.y+=(p.y-.499)*u_mouthOpen*.22*mouth;',
    'p.y+=u_step*.013*(region(p,vec2(.413,.905),vec2(.067,.043))-region(p,vec2(.690,.905),vec2(.060,.043)));',
    'float eyeL=eyeMask(p,vec2(.4665,.429),vec2(.135,.125));float eyeR=eyeMask(p,vec2(.7281,.3405),vec2(.115,.12));float eye=max(eyeL,eyeR);',
    'p.y+=u_eyeNarrow*.35*((p.y-.429)*eyeL+(p.y-.3405)*eyeR);',
    'float iris=region(p,vec2(.4665,.429),vec2(.052,.059))+region(p,vec2(.7281,.3405),vec2(.045,.065));',
    'p-=u_look*iris*(1.-u_blink);vec2 uv=clamp(p,vec2(.0001),vec2(.9999));',
    'float face=1.-smoothstep(.82,1.08,length(rotation(.28)*(p-vec2(.60,.415))/vec2(.255,.215)));',
    'vec3 rgb=texture2D(u_original,uv).rgb;',
    // Pose scores select one face, not a permanent opacity. A held expression must
    // replace the old eyes completely; only the cue envelope fades between faces.
    'vec3 expression=rgb;float strongest=0.;float delighted=0.;',
    'if(u_face.x>strongest){strongest=u_face.x;expression=texture2D(u_sad,uv).rgb;}',
    'if(u_face.y>strongest){strongest=u_face.y;expression=texture2D(u_angry,uv).rgb;}',
    'if(u_face.z>strongest){strongest=u_face.z;expression=texture2D(u_surprise,uv).rgb;}',
    'if(u_face.w>strongest){strongest=u_face.w;expression=texture2D(u_delighted,uv).rgb;delighted=1.;}',
    'float weight=strongest>0.?u_presence:0.;rgb=mix(rgb,expression,face*weight);',
    // Delighted already has closed eyes. Neutral half-open blink frames would
    // paint the old pupils over that expression and create ghost eyes.
    'float blink=u_blink*(1.-delighted*u_presence);',
    'rgb=mix(rgb,texture2D(u_half,uv).rgb,eye*smoothstep(0.,.5,blink));',
    'rgb=mix(rgb,texture2D(u_closed,uv).rgb,eye*smoothstep(.5,1.,blink));',
    'float blush=region(p,vec2(.405,.55),vec2(.062,.04))+region(p,vec2(.80,.445),vec2(.047,.037));',
    'rgb=mix(rgb,vec3(.99,.48,.67),clamp(blush*u_blush*.25,0.,.3));',
    'float fall=fract(u_phase*.85);float tears=max(droplet(p,vec2(.414,.51+.085*fall),vec2(.009,.018)),droplet(p,vec2(.78,.415+.07*fall),vec2(.008,.016)));',
    'rgb=mix(rgb,vec3(.43,.76,.98),tears*u_tear*.9);',
    'float sweat=droplet(p,vec2(.84,.31+.025*fract(u_phase*.7)),vec2(.011,.023));rgb=mix(rgb,vec3(.6,.83,1.),sweat*u_sweat*.85);',
    'vec2 mark=rotation(.3)*(p-vec2(.62,.245));float redMark=(1.-smoothstep(.003,.006,abs(abs(mark.x)-.012)))*(1.-smoothstep(.014,.02,abs(mark.y)));',
    'redMark=max(redMark,(1.-smoothstep(.003,.006,abs(abs(mark.y)-.012)))*(1.-smoothstep(.014,.02,abs(mark.x))));',
    'rgb=mix(rgb,vec3(.76,.13,.35),redMark*u_anger*.8);',
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
        p.scale = scale;
        Object.keys(packedUniforms).forEach(function (key) {
          var fields = packedUniforms[key];
          gl.uniform4f(locations[key], p[fields[0]], p[fields[1]], p[fields[2]], p[fields[3]]);
        });
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
      Object.keys(packedUniforms).forEach(function (key) { locations[key] = gl.getUniformLocation(program, 'u_' + key); });
      var samplerNames = ['u_original', 'u_half', 'u_closed', 'u_alpha', 'u_sad', 'u_angry', 'u_surprise', 'u_delighted'];
      var textures = assets.map(function (_, i) { gl.uniform1i(gl.getUniformLocation(program, samplerNames[i]), i); return own('createTexture'); });
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
        if (dead || loaded || images.length !== assets.length || !images.every(function (im) { return im.complete && im.naturalWidth > 0; })) return;
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
    catalogue: catalogue, durations: durations, situations: Object.freeze(Object.keys(durations)), sourceType: '2d_image_motion' });
});

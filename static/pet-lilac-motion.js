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
    ['action', 'アクション', [['feeding', 'ごはん', 8400], ['moving', '移動', 1600], ['caught', 'キャッチ', 1500], ['dance', 'ダンス', 6500], ['celebrate', 'お祝い', 6000], ['determined', 'やるぞ', 5400]]]
  ];
  var catalogue = Object.freeze(groups.reduce(function (list, group) {
    return list.concat(group[2].map(function (item) { return Object.freeze({ id: item[0], label: item[1], group: group[0], groupLabel: group[1], durationMs: item[2] }); }));
  }, []));
  var durations = Object.freeze(catalogue.reduce(function (result, item) { result[item.id] = item.durationMs; return result; }, {}));
  var outfitCatalogue = Object.freeze([
    { id: 'cloth_cream_vest', label: 'はじめてベスト', price: 0, style: 'vest', color: [.94,.88,.75], trim: [.70,.59,.43] },
    { id: 'cloth_rose_cape', label: 'ももいろケープ', price: 30, style: 'cape', color: [.87,.61,.70], trim: [.63,.37,.47] },
    { id: 'cloth_sky_overalls', label: 'そらいろサロペット', price: 45, style: 'overalls', color: [.58,.75,.84], trim: [.31,.48,.59] },
    { id: 'cloth_mint_knit', label: 'ミントのニット', price: 40, style: 'knit', color: [.63,.78,.69], trim: [.33,.51,.42] },
    { id: 'cloth_star_pajamas', label: '星のおやすみ服', price: 55, style: 'pajamas', color: [.64,.65,.81], trim: [.38,.39,.57] },
    { id: 'cloth_flower_dress', label: 'お花のワンピース', price: 65, style: 'dress', color: [.94,.78,.66], trim: [.66,.46,.35] }
  ].map(function (entry, index) { entry.index = index + 1; Object.freeze(entry.color); Object.freeze(entry.trim); return Object.freeze(entry); }));
  function outfitProfile(id) {
    if (typeof id !== 'string') return null;
    for (var i = 0; i < outfitCatalogue.length; i++) if (outfitCatalogue[i].id === id) return outfitCatalogue[i];
    return null;
  }
  // Shared bounds drive both shader constants and the pure coverage QA helper.
  var clothBounds = Object.freeze({ x: .525, y: .79, rx: .258, ry: .125, top: .688, hem: .891,
    pawLX: .527, pawLY: .743, pawLRX: .153, pawLRY: .100, pawRX: .718, pawRY: .729, pawRRX: .091, pawRRY: .091 });
  function ramp(a, b, value) { return smooth((value-a)/(b-a)); }
  function clothEllipse(x, y, cx, cy, rx, ry) { var dx=(x-cx)/rx, dy=(y-cy)/ry; return 1-ramp(.96,1.02,Math.sqrt(dx*dx+dy*dy)); }
  function clothLine(x, y, ax, ay, bx, by, width) {
    var vx=bx-ax, vy=by-ay, t=clamp(((x-ax)*vx+(y-ay)*vy)/(vx*vx+vy*vy),0,1);
    return 1-ramp(width,width+.003,Math.hypot(x-ax-vx*t,y-ay-vy*t));
  }
  function outfitCoverage(id, inputX, inputY) {
    var entry=outfitProfile(id), x=finite(inputX,-1), y=finite(inputY,-1), b=clothBounds;
    if (!entry) return 0;
    var mask=clothEllipse(x,y,b.x,b.y,b.rx,b.ry)*ramp(b.top,b.top+.008,y)*(1-ramp(b.hem-.006,b.hem,y));
    var paws=Math.max(clothEllipse(x,y,b.pawLX,b.pawLY,b.pawLRX,b.pawLRY),clothEllipse(x,y,b.pawRX,b.pawRY,b.pawRRX,b.pawRRY));
    mask*=1-paws;
    if (entry.style === 'vest') {
      var neck=1-ramp(.005,.012,Math.abs(x-.58)-Math.max(0,.755-y)*1.05);
      mask*=1-neck;
    } else if (entry.style === 'cape') {
      var opening=1-ramp(.0,.008,Math.abs(x-.58)-Math.max(0,y-.70)*.52-.018);
      mask*=1-opening; mask*=1-ramp(.866+.006*Math.cos((x-.28)*TAU*9),.874+.006*Math.cos((x-.28)*TAU*9),y);
    } else if (entry.style === 'overalls') {
      var straps=Math.max(clothLine(x,y,.375,.69,.455,.81,.014),clothLine(x,y,.735,.69,.69,.81,.014));
      var bib=ramp(.77,.778,y)*(1-ramp(.145,.155,Math.abs(x-.58)));
      mask*=Math.max(straps,bib);
    } else if (entry.style === 'knit' || entry.style === 'pajamas') {
      var collar=clothEllipse(x,y,.58,.69,.079,.025);
      mask*=1-collar;
    } else if (entry.style === 'dress') {
      var shoulder=Math.max(clothLine(x,y,.38,.69,.44,.78,.017),clothLine(x,y,.738,.69,.69,.78,.017));
      var width=.132+Math.max(0,y-.766)*.65;
      var skirt=ramp(.756,.766,y)*(1-ramp(width,width+.008,Math.abs(x-.56)));
      mask*=Math.max(shoulder,skirt);
    }
    return clamp(mask,0,1);
  }
  function outfitUniform(id, anger) { var entry=outfitProfile(id); return (entry ? entry.index*2 : 0)+clamp(finite(anger,0),0,1); }
  function vecColor(values) { return 'vec3('+values.map(function (v) { return v.toFixed(3); }).join(',')+')'; }
  var evolutionCatalogue = Object.freeze([
    { key: 'balanced', label: 'のんびり', colorName: '薄紫', color: '#b5a0d9', earScale: 1, earDrop: 0, cheekWidth: 1, cheekRound: 1, bodyWidth: 1, bodyHeight: 1, tailScale: 1, tailLift: 0, cadence: 1, movingCadence: 1, bounce: 1 },
    { key: 'fruit', label: 'はなほっぺ', colorName: '桃色', color: '#d99eae', earScale: .96, earDrop: .004, cheekWidth: 1.18, cheekRound: 1.12, bodyWidth: 1.01, bodyHeight: 1, tailScale: 1.05, tailLift: -.003, cadence: 1.01, movingCadence: 1, bounce: 1.02 },
    { key: 'hearty', label: 'ぽかぽか', colorName: 'はちみつ色', color: '#d2ad70', earScale: 1.01, earDrop: 0, cheekWidth: 1.07, cheekRound: 1.06, bodyWidth: 1.12, bodyHeight: 1.04, tailScale: 1.12, tailLift: 0, cadence: .97, movingCadence: .97, bounce: .98 },
    { key: 'sweet', label: 'おやつっこ', colorName: '杏色', color: '#dfa88b', earScale: .88, earDrop: .014, cheekWidth: 1.12, cheekRound: 1.10, bodyWidth: 1.06, bodyHeight: .96, tailScale: .94, tailLift: .009, cadence: .99, movingCadence: .98, bounce: 1.01 },
    { key: 'active', label: 'そよかぜ', colorName: '空色', color: '#92b4d1', earScale: 1.12, earDrop: -.012, cheekWidth: .97, cheekRound: .98, bodyWidth: .97, bodyHeight: 1.04, tailScale: 1.17, tailLift: -.012, cadence: 1.08, movingCadence: 1.08, bounce: 1.08 },
    { key: 'calm', label: 'まどろみ', colorName: 'ミント色', color: '#9dbfb0', earScale: 1.04, earDrop: .020, cheekWidth: 1.07, cheekRound: 1.07, bodyWidth: 1.06, bodyHeight: .96, tailScale: 1.12, tailLift: .005, cadence: .88, movingCadence: .92, bounce: .90 }
  ].map(function (entry,index) { entry.index=index; entry.rgb=Object.freeze([1,3,5].map(function(start){return parseInt(entry.color.slice(start,start+2),16)/255;})); return Object.freeze(entry); }));
  function evolutionProfile(key) {
    if (typeof key === 'string') for (var i=0;i<evolutionCatalogue.length;i++) if(evolutionCatalogue[i].key===key)return evolutionCatalogue[i];
    return evolutionCatalogue[0];
  }
  function evolutionPoint(path,inputX,inputY) {
    var profile=evolutionProfile(path), x=clamp(finite(inputX,.5),0,1), y=clamp(finite(inputY,.5),0,1);
    if(!profile.index)return {x:x,y:y};
    var leftEar=regionWeight(x,y,.17,.345,.18,.15), rightEar=regionWeight(x,y,.82,.16,.15,.17);
    var dx=(profile.earScale-1)*((x-.29)*leftEar+(x-.76)*rightEar);
    var dy=(profile.earScale-1)*((y-.39)*leftEar+(y-.25)*rightEar)+profile.earDrop*(leftEar+rightEar);
    var leftCheek=regionWeight(x,y,.397,.575,.145,.105), rightCheek=regionWeight(x,y,.795,.482,.13,.105);
    dx+=(x-.59)*(profile.cheekWidth-1)*Math.max(leftCheek,rightCheek);
    dy+=(profile.cheekRound-1)*((y-.575)*leftCheek+(y-.482)*rightCheek);
    var belly=regionWeight(x,y,.53,.80,.26,.18);
    dx+=(x-.55)*(profile.bodyWidth-1)*belly;
    dy+=(y-.92)*(profile.bodyHeight-1)*belly;
    var tail=regionWeight(x,y,.155,.728,.13,.18);
    dx+=(profile.tailScale-1)*(x-.25)*tail;
    dy+=((profile.tailScale-1)*(y-.72)+profile.tailLift)*tail;
    var edge=smooth(x/.06)*smooth((1-x)/.06)*smooth(y/.06)*smooth((1-y)/.06);
    return {x:x+dx*edge,y:y+dy*edge*smooth(Math.abs(y-.92)/.055)};
  }
  // Reference color sampling is also useful for verifying protected face features.
  function furChroma(rgb) {
    // B's hands and crown are pink-lilac: red can exceed blue there. Green
    // separation catches that fur while the warm skin gate retains cream/pink ears.
    return ramp(.012,.045,Math.min(rgb[0],rgb[2])-rgb[1])*(1-ramp(.16,.26,rgb[0]-rgb[2]));
  }
  function evolutionFurColor(path,x,y,source,painted) {
    var profile=evolutionProfile(path), original=source.slice(0,3), color=(painted||source).slice(0,3);
    if(!profile.index)return color;
    var features=Math.max(clothEllipse(x,y,.4665,.429,.16,.145),clothEllipse(x,y,.7281,.3405,.137,.14),clothEllipse(x,y,.625,.48,.105,.095));
    var amount=furChroma(original)*furChroma(color)*(1-features)*.92;
    var lum=color[0]*.299+color[1]*.587+color[2]*.114, paletteLum=profile.rgb[0]*.299+profile.rgb[1]*.587+profile.rgb[2]*.114;
    return color.map(function(value,i){return value+(clamp(profile.rgb[i]*lum/Math.max(.2,paletteLum),0,1)-value)*amount;});
  }
  // Geometry stages use the same original and facial textures. No stage grants EXP.
  var growthProfiles = Object.freeze({
    egg: Object.freeze({ key: 'egg', label: 'うまれたて', overallScale: .70, headWidth: 1.12, headHeight: 1.08, bodyWidth: .86, bodyHeight: .72, earScale: .78, tailScale: .68, cadence: 1.18, movingCadence: 1.16 }),
    baby: Object.freeze({ key: 'baby', label: 'よちよち', overallScale: .82, headWidth: 1.07, headHeight: 1.04, bodyWidth: .96, bodyHeight: .86, earScale: .89, tailScale: .84, cadence: 1.10, movingCadence: 1.08 }),
    child: Object.freeze({ key: 'child', label: 'こども', overallScale: .92, headWidth: 1, headHeight: 1, bodyWidth: 1, bodyHeight: 1, earScale: 1, tailScale: 1, cadence: 1, movingCadence: 1 }),
    final: Object.freeze({ key: 'final', label: 'わかもの', overallScale: .98, headWidth: .98, headHeight: .98, bodyWidth: 1.03, bodyHeight: 1.05, earScale: 1.04, tailScale: 1.06, cadence: .96, movingCadence: .97 }),
    adult: Object.freeze({ key: 'adult', label: 'おとな', overallScale: 1, headWidth: .95, headHeight: .96, bodyWidth: 1.08, bodyHeight: 1.10, earScale: 1.08, tailScale: 1.12, cadence: .90, movingCadence: .94 }),
    companion: Object.freeze({ key: 'companion', label: 'なかよしの姿', overallScale: 1, headWidth: 1.02, headHeight: .99, bodyWidth: 1.11, bodyHeight: 1.08, earScale: 1.03, tailScale: 1.18, cadence: .84, movingCadence: .90 })
  });
  function growthProfile(name) { return Object.prototype.hasOwnProperty.call(growthProfiles, name) ? growthProfiles[name] : growthProfiles.child; }
  function regionWeight(x, y, cx, cy, rx, ry) { var dx = (x - cx) / rx, dy = (y - cy) / ry; return Math.exp(-2 * (dx * dx + dy * dy)); }
  // Forward normalized coordinates. Boundary taper fixes all four frame edges, and
  // the foot line remains grounded. The exact same map positions the food prop.
  function growthPoint(stage, inputX, inputY, evolutionPath) {
    var profile = growthProfile(stage), branchPoint=evolutionPoint(evolutionPath,inputX,inputY), x=branchPoint.x, y=branchPoint.y;
    if (profile.key === 'child') return { x: x, y: y };
    var head = 1 - smooth((y - .58) / .20);
    var width = profile.bodyWidth + (profile.headWidth - profile.bodyWidth) * head;
    var dx = (x - .59) * (width - 1) * Math.sin(PI * x);
    var dy = (y - .92) * (profile.bodyHeight - 1) + (y - .66) * (profile.headHeight - profile.bodyHeight) * head;
    var leftEar = regionWeight(x, y, .17, .345, .18, .15), rightEar = regionWeight(x, y, .82, .16, .15, .17);
    dx += (profile.earScale - 1) * ((x - .29) * leftEar + (x - .76) * rightEar);
    dy += (profile.earScale - 1) * ((y - .39) * leftEar + (y - .25) * rightEar);
    var tail = regionWeight(x, y, .155, .728, .13, .18);
    dx += (profile.tailScale - 1) * (x - .25) * tail;
    dy += (profile.tailScale - 1) * (y - .72) * tail;
    var edge = smooth(x / .06) * smooth((1 - x) / .06) * smooth(y / .06) * smooth((1 - y) / .06);
    // Regional ear/tail displacement also settles at the feet instead of lifting them.
    var grounded = smooth(Math.abs(y - .92) / .055);
    return { x: x + dx * edge, y: y + dy * edge * grounded };
  }
  function feedingAnchor(stage, evolutionPath) {
    var profile = growthProfile(stage);
    var point = growthPoint(profile.key, .5 + (.628 - .5) * .88, .92 + (.499 - .92) * .88, evolutionPath);
    var x = .5 + (point.x - .5) * profile.overallScale, y = .92 + (point.y - .92) * profile.overallScale;
    return { x: x, y: y, foodLeft: x - .11, foodTop: y + .005 };
  }
  function growthMesh(stage, evolutionPath) {
    var profile = growthProfile(stage), columns = 24, values = new Float32Array(columns * columns * 6 * 4), cursor = 0;
    function vertex(x, y) {
      var point = growthPoint(stage, x, y, evolutionPath);
      var targetX = .5 + (point.x - .5) * profile.overallScale, targetY = .92 + (point.y - .92) * profile.overallScale;
      values[cursor++] = targetX * 2 - 1; values[cursor++] = 1 - targetY * 2;
      values[cursor++] = x; values[cursor++] = y;
    }
    for (var row = 0; row < columns; row++) for (var col = 0; col < columns; col++) {
      var x = col / columns, y = row / columns, right = (col + 1) / columns, bottom = (row + 1) / columns;
      vertex(x, y); vertex(x, bottom); vertex(right, y);
      vertex(right, y); vertex(x, bottom); vertex(right, bottom);
    }
    return values;
  }
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
  // Public cue timeline uses absolute elapsed milliseconds, including when a view resumes.
  // The caller can schedule one boundary timer; this helper never starts a timer or changes a pet.
  function feedingPhase(elapsedMs) {
    var age = Math.max(0, finite(elapsedMs, 0)), phase, label, start, end;
    if (age < 1200) { phase = 'anticipation'; label = 'ごはん、うれしいな'; start = 0; end = 1200; }
    else if (age < 4400) { phase = 'chewing'; label = 'もぐもぐ…'; start = 1200; end = 4400; }
    else if (age < 7200) { phase = 'joy'; label = 'おいしい！'; start = 4400; end = 7200; }
    else if (age < durations.feeding) { phase = 'settling'; label = 'ごちそうさま'; start = 7200; end = durations.feeding; }
    else { phase = 'idle'; label = 'ふだん'; start = durations.feeding; end = null; }
    return { phase: phase, label: label, foodVisible: phase === 'anticipation' || phase === 'chewing',
      foodProgress: clamp((age - 1200) / 3200, 0, 1), phaseProgress: end === null ? 1 : clamp((age - start) / (end - start), 0, 1),
      nextBoundaryMs: end, done: end === null };
  }
  // Pure profiles in seconds. Emotions ease in and settle to the exact underlying idle pose.
  function pose(seconds, situation, elapsedSeconds, growthStage, evolutionPath) {
    var profile = growthProfile(growthStage), branch=evolutionProfile(evolutionPath), rawSeconds = Math.max(0, finite(seconds, 0));
    var s = rawSeconds * profile.cadence * branch.cadence, t = s % 12, name = known(situation);
    var age = Math.max(0, finite(elapsedSeconds, rawSeconds)), duration = durations[name] / 1000;
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
      case 'feeding': {
        var reach = 1 - smooth((age - 1.1) / .6);
        var munch = smooth((age - 1.05) / .45) * (1 - smooth((age - 4.05) / .55));
        var celebrating = smooth((age - 4.4) / .35) * (1 - smooth((age - 7.0) / .8));
        var settle = smooth((age - 7.0) / .8), jaw = Math.sin((age - 1.2) * TAU * 2.2);
        var happyBeat = Math.sin((age - 4.4) * TAU * 1.2), happyHop = Math.pow(Math.max(0, happyBeat), 2);
        p.chew = munch > 0 ? munch * jaw : 0;
        p.wave = .35 * reach + munch * (.8 + .12 * beat) + 1.15 * celebrating + .4 * settle;
        p.pawSpread = -.4 * reach - .9 * munch + .95 * celebrating - .25 * settle;
        p.wiggle = .15 * munch * beat + .8 * celebrating * happyBeat;
        p.tilt = -.035 * reach + .028 * munch * jaw - .035 * celebrating + .035 * settle * nod;
        p.bounce = .95 * celebrating * happyHop;
        p.bodyAngle = .065 * celebrating * happyBeat;
        p.squash = .12 * munch * beat + .3 * celebrating * (1 - happyHop) + .08 * settle;
        p.stretch = .3 * reach + .55 * celebrating;
        p.crouch = .25 * reach + .16 * munch + .15 * settle;
        p.ear += .35 * reach + .2 * munch * jaw + .9 * celebrating;
        p.tail += .25 * reach + .3 * munch * beat + 1.2 * celebrating * happyBeat;
        p.lookX = .008 * reach; p.lookY = .01 * reach + .006 * munch;
        p.mouthOpen = .25 * reach + .3 * munch * (.5 + .5 * jaw) + .55 * celebrating;
        // Close the original eyes just before the happy face appears. The happy
        // keyframe stays whole and crisp, then the normal cue envelope releases it.
        p.blink = Math.max(p.blink, pulse(age, 4.12, .5) * e);
        p.faceDelighted = age >= 4.4 ? 1 : 0;
        p.blush = .35 * celebrating;
        break;
      }
      case 'moving': p.step = Math.sin(age * TAU * 2 * profile.movingCadence * branch.movingCadence); p.bounce = .25 * Math.abs(p.step); p.bodyAngle = .035 * p.step; p.shiftX = .018 * Math.sin(age * PI * 1.2); p.wave = .25; p.ear += .4 * p.step; break;
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
    var idle = pose(rawSeconds, 'idle', 0, profile.key, branch.key);
    p.bounce *= branch.bounce;
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
    if ((action.type === 'care' && action.kind === 'feed') || action.type === 'useItem') name = 'feeding';
    else if (before && before.pet && after && after.pet &&
        growth(finite(after.pet.exp, 0)) > growth(finite(before.pet.exp, 0))) name = 'joy';
    else if (action.type === 'care') name = action.kind === 'play' ? 'petted' : action.kind === 'rest' ? 'resting' : null;
    else if (action.type === 'finishMinigame' && action.score > 0) name = 'caught';
    else if (action.type === 'chooseSpecies' || action.type === 'rename') name = 'greeting';
    else if (['buyItem', 'equip', 'equipClothing', 'chooseAppearance', 'transferLegacy'].indexOf(action.type) >= 0) name = 'joy';
    else if (action.type === 'advanceMarketDay' && result.reward && result.reward.dividend > 0) name = 'joy';
    return name ? { situation: name, durationMs: durations[name] } : null;
  }

  var clothingShader = [
    'float ce(vec2 p,vec2 c,vec2 r){return 1.-smoothstep(.96,1.02,length((p-c)/r));}',
    'float cl(vec2 p,vec2 a,vec2 b,float w){vec2 v=b-a;float t=clamp(dot(p-a,v)/dot(v,v),0.,1.);return 1.-smoothstep(w,w+.003,length(p-a-v*t));}',
    'float cb(vec2 p,vec2 c,vec2 h,float r){vec2 q=abs(p-c)-h+vec2(r);float d=length(max(q,vec2(0.)))+min(max(q.x,q.y),0.)-r;return 1.-smoothstep(-.002,.002,d);}',
    'float cs(vec2 p,vec2 c,float size){vec2 q=(p-c)/size;float angle=atan(q.y+.000001,q.x+.000001);float edge=.46+.24*cos(5.*angle);return 1.-smoothstep(edge-.04,edge+.04,length(q));}',
    'float cf(vec2 p,vec2 c){float petals=0.;for(int i=0;i<5;i++){float a=float(i)*6.2831853/5.;vec2 offset=vec2(cos(a),sin(a))*.010;petals=max(petals,ce(p,c+offset,vec2(.0075)));}return petals;}',
    'float clothingMask(vec2 p,float kind){',
    'float mask=ce(p,vec2('+clothBounds.x+','+clothBounds.y+'),vec2('+clothBounds.rx+','+clothBounds.ry+'))*smoothstep('+clothBounds.top+','+(clothBounds.top+.008)+',p.y)*(1.-smoothstep('+(clothBounds.hem-.006)+','+clothBounds.hem+',p.y));',
    'float paws=max(ce(p,vec2('+clothBounds.pawLX+','+clothBounds.pawLY+'),vec2('+clothBounds.pawLRX+','+clothBounds.pawLRY+')),ce(p,vec2('+clothBounds.pawRX+','+clothBounds.pawRY+'),vec2('+clothBounds.pawRRX+','+clothBounds.pawRRY+')));mask*=1.-paws;',
    'if(kind<1.5){float neck=1.-smoothstep(.005,.012,abs(p.x-.58)-max(0.,.755-p.y)*1.05);mask*=1.-neck;}',
    'else if(kind<2.5){float opening=1.-smoothstep(.0,.008,abs(p.x-.58)-max(0.,p.y-.70)*.52-.018);mask*=1.-opening;mask*=1.-smoothstep(.866+.006*cos((p.x-.28)*6.2831853*9.),.874+.006*cos((p.x-.28)*6.2831853*9.),p.y);}',
    'else if(kind<3.5){float straps=max(cl(p,vec2(.375,.69),vec2(.455,.81),.014),cl(p,vec2(.735,.69),vec2(.69,.81),.014));float bib=smoothstep(.77,.778,p.y)*(1.-smoothstep(.145,.155,abs(p.x-.58)));mask*=max(straps,bib);}',
    'else if(kind<5.5){mask*=1.-ce(p,vec2(.58,.69),vec2(.079,.025));}',
    'else{float shoulder=max(cl(p,vec2(.38,.69),vec2(.44,.78),.017),cl(p,vec2(.738,.69),vec2(.69,.78),.017));float width=.132+max(0.,p.y-.766)*.65;float skirt=smoothstep(.756,.766,p.y)*(1.-smoothstep(width,width+.008,abs(p.x-.56)));mask*=max(shoulder,skirt);}',
    'return clamp(mask,0.,1.);}',
    'vec4 clothing(vec2 p,vec3 original,float kind){',
    'if(p.x<.26||p.x>.79||p.y<.688||p.y>.891)return vec4(0.);',
    'float mask=clothingMask(p,kind);if(mask<=0.)return vec4(0.);vec3 base='+vecColor(outfitCatalogue[0].color)+';vec3 trim='+vecColor(outfitCatalogue[0].trim)+';',
    outfitCatalogue.slice(1).map(function(entry){return 'if(kind>'+((entry.index-.5).toFixed(1))+'&&kind<'+((entry.index+.5).toFixed(1))+'){base='+vecColor(entry.color)+';trim='+vecColor(entry.trim)+';}';}).join(''),
    'float light=.85+.15*dot(original,vec3(.299,.587,.114));float weave=.006*sin(p.y*240.)*sin(p.x*190.);vec3 cloth=base*(light+weave);float seam=0.;',
    'if(kind<1.5){',
    'seam=max(cl(p,vec2(.405,.72),vec2(.43,.86),.0035),cl(p,vec2(.724,.725),vec2(.714,.858),.0035));',
    'seam=max(seam,cl(p,vec2(.579,.785),vec2(.579,.878),.0032));seam=max(seam,cl(p,vec2(.32,.87),vec2(.735,.87),.0035));',
    'float lapel=max(cb(p,vec2(.365,.728),vec2(.021,.032),.004),cb(p,vec2(.748,.727),vec2(.018,.029),.004));cloth=mix(cloth,base*.90,lapel*.35);',
    'float buttons=max(ce(p,vec2(.592,.841),vec2(.006)),ce(p,vec2(.592,.867),vec2(.006)));cloth=mix(cloth,trim,buttons*.75);',
    '}else if(kind<2.5){',
    'seam=max(cl(p,vec2(.54,.70),vec2(.465,.865),.004),cl(p,vec2(.62,.70),vec2(.71,.865),.004));',
    'float hem=cl(p,vec2(.295,.856),vec2(.44,.867),.0035)+cl(p,vec2(.72,.866),vec2(.773,.84),.0035);seam=max(seam,hem);',
    'float tie=max(ce(p,vec2(.372,.727),vec2(.016,.009)),ce(p,vec2(.399,.733),vec2(.016,.009)));cloth=mix(cloth,vec3(.96,.83,.83),tie*.9);',
    '}else if(kind<3.5){',
    'seam=max(cl(p,vec2(.578,.827),vec2(.578,.882),.003),cl(p,vec2(.438,.88),vec2(.72,.88),.0035));',
    'float pocket=cb(p,vec2(.583,.846),vec2(.05,.023),.008);float pocketIn=cb(p,vec2(.583,.844),vec2(.044,.017),.006);seam=max(seam,pocket*(1.-pocketIn));',
    'seam=max(seam,cl(p,vec2(.371,.697),vec2(.447,.806),.0028));float buttons=max(ce(p,vec2(.448,.801),vec2(.006)),ce(p,vec2(.69,.801),vec2(.006)));cloth=mix(cloth,vec3(.94,.85,.63),buttons*.8);',
    '}else if(kind<4.5){',
    'float ribs=.5+.5*sin(p.x*6.2831853*24.);cloth*=.97+.035*ribs;',
    'seam=max(cl(p,vec2(.315,.866),vec2(.741,.866),.003),cl(p,vec2(.332,.843),vec2(.337,.878),.003));',
    'float cable=cl(p,vec2(.346,.77),vec2(.367,.80),.0032)+cl(p,vec2(.367,.80),vec2(.346,.83),.0032)+cl(p,vec2(.346,.83),vec2(.367,.86),.0032);seam=max(seam,cable*.7);',
    '}else if(kind<5.5){',
    'float stars=max(max(cs(p,vec2(.337,.797),.029),cs(p,vec2(.407,.858),.025)),max(cs(p,vec2(.657,.859),.027),cs(p,vec2(.751,.817),.022)));cloth=mix(cloth,vec3(.97,.91,.73),stars*.9);',
    'seam=max(cl(p,vec2(.578,.745),vec2(.578,.88),.0035),cl(p,vec2(.32,.875),vec2(.745,.875),.0035));float buttons=max(ce(p,vec2(.59,.838),vec2(.0045)),ce(p,vec2(.59,.866),vec2(.0045)));cloth=mix(cloth,vec3(.94,.9,.84),buttons*.95);',
    '}else{',
    'float flowers=max(cf(p,vec2(.352,.813)),max(cf(p,vec2(.454,.862)),cf(p,vec2(.692,.846))));cloth=mix(cloth,vec3(.99,.95,.87),flowers*.95);',
    'float centers=max(ce(p,vec2(.352,.813),vec2(.0045)),max(ce(p,vec2(.454,.862),vec2(.0045)),ce(p,vec2(.692,.846),vec2(.0045))));cloth=mix(cloth,vec3(.87,.66,.29),centers*.9);',
    'seam=max(cl(p,vec2(.33,.877),vec2(.73,.877),.0035),cl(p,vec2(.406,.804),vec2(.731,.804),.004));',
    '}',
    'cloth=mix(cloth,trim,clamp(seam,0.,1.)*.48);return vec4(cloth,mask);}'
  ].join('\n');
  var evolutionShader = [
    'float furSelect(vec3 c){return smoothstep(.012,.045,min(c.r,c.b)-c.g)*(1.-smoothstep(.16,.26,c.r-c.b));}',
    'vec3 evolvedFur(vec2 p,vec3 original,vec3 painted){if(v_evolution.a<.5)return painted;',
    'float features=max(max(ce(p,vec2(.4665,.429),vec2(.16,.145)),ce(p,vec2(.7281,.3405),vec2(.137,.14))),ce(p,vec2(.625,.48),vec2(.105,.095)));',
    'float amount=furSelect(original)*furSelect(painted)*(1.-features)*.92;',
    'float lum=dot(painted,vec3(.299,.587,.114));float targetLum=max(.2,dot(v_evolution.rgb,vec3(.299,.587,.114)));',
    'vec3 tinted=clamp(v_evolution.rgb*lum/targetLum,vec3(0.),vec3(1.));return mix(painted,tinted,amount);}'
  ].join('\n');
  var vertexSource = 'attribute vec2 a_position; attribute vec2 a_uv; attribute vec4 a_evolution; varying vec2 v_uv; varying vec4 v_evolution; void main(){v_uv=a_uv;v_evolution=a_evolution;gl_Position=vec4(a_position,0.,1.);}';
  var fragmentSource = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH', 'precision highp float;', '#else', 'precision mediump float;', '#endif',
    'varying vec2 v_uv; varying vec4 v_evolution; uniform sampler2D u_original,u_half,u_closed,u_alpha,u_sad,u_angry,u_surprise,u_delighted;',
    'uniform vec4 u_motionA,u_motionB,u_motionC,u_body,u_gesture,u_face,u_effect,u_detail;',
    '#define u_breath u_motionA.x', '#define u_tilt u_motionA.y', '#define u_ear u_motionA.z', '#define u_tail u_motionA.w',
    '#define u_wave u_motionB.x', '#define u_wiggle u_motionB.y', '#define u_blink u_motionB.z', '#define u_chew u_motionB.w',
    '#define u_bounce u_motionC.x', '#define u_step u_motionC.y', '#define u_scale u_motionC.z', '#define u_presence u_motionC.w',
    '#define u_bodyAngle u_body.x', '#define u_shiftX u_body.y', '#define u_shiftY u_body.z', '#define u_squash u_body.w',
    '#define u_stretch u_gesture.x', '#define u_crouch u_gesture.y', '#define u_pawSpread u_gesture.z', '#define u_mouthOpen u_gesture.w',
    '#define u_tear u_effect.x', '#define u_blush u_effect.y', '#define u_sweat u_effect.z', '#define u_anger mod(u_effect.w,2.)', '#define u_outfit floor(u_effect.w/2.)',
    '#define u_eyeNarrow u_detail.x', '#define u_look u_detail.yz', '#define u_phase u_detail.w',
    'float region(vec2 p,vec2 c,vec2 r){vec2 q=(p-c)/r;return exp(-dot(q,q)*2.);}',
    'mat2 rotation(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}',
    'float eyeMask(vec2 p,vec2 c,vec2 r){return 1.-smoothstep(.85,1.1,length(rotation(.28)*(p-c)/r));}',
    'float droplet(vec2 p,vec2 c,vec2 r){vec2 q=(p-c)/r;return 1.-smoothstep(.75,1.05,dot(q,q));}',
    clothingShader, evolutionShader,
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
    'vec3 original=texture2D(u_original,uv).rgb;vec3 rgb=original;',
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
    'rgb=evolvedFur(p,original,rgb);',
    'float blush=region(p,vec2(.405,.55),vec2(.062,.04))+region(p,vec2(.80,.445),vec2(.047,.037));',
    'rgb=mix(rgb,vec3(.99,.48,.67),clamp(blush*u_blush*.25,0.,.3));',
    'float fall=fract(u_phase*.85);float tears=max(droplet(p,vec2(.414,.51+.085*fall),vec2(.009,.018)),droplet(p,vec2(.78,.415+.07*fall),vec2(.008,.016)));',
    'rgb=mix(rgb,vec3(.43,.76,.98),tears*u_tear*.9);',
    'float sweat=droplet(p,vec2(.84,.31+.025*fract(u_phase*.7)),vec2(.011,.023));rgb=mix(rgb,vec3(.6,.83,1.),sweat*u_sweat*.85);',
    'vec2 mark=rotation(.3)*(p-vec2(.62,.245));float redMark=(1.-smoothstep(.003,.006,abs(abs(mark.x)-.012)))*(1.-smoothstep(.014,.02,abs(mark.y)));',
    'redMark=max(redMark,(1.-smoothstep(.003,.006,abs(abs(mark.y)-.012)))*(1.-smoothstep(.014,.02,abs(mark.x))));',
    'rgb=mix(rgb,vec3(.76,.13,.35),redMark*u_anger*.8);',
    'if(u_outfit>.5){vec4 garment=clothing(p,original,u_outfit);rgb=mix(rgb,garment.rgb,garment.a);}',
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
    var scale = clamp(finite(options.scale, 1), .35, 1.15), stageProfile = growthProfile(options.growthStage), branchProfile = evolutionProfile(options.evolutionPath), selectedOutfit = outfitProfile(options.outfit), vertexCount = 0;
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
        var p = reduced ? pose(0, 'idle', 0, stageProfile.key, branchProfile.key) : pose(phaseMs / 1000, cue, elapsed, stageProfile.key, branchProfile.key);
        if (reduced) { p.tail = 0; }
        gl.viewport(0, 0, canvas.width, canvas.height);
        p.scale = scale; p.anger = outfitUniform(selectedOutfit && selectedOutfit.id, p.anger);
        Object.keys(packedUniforms).forEach(function (key) {
          var fields = packedUniforms[key];
          gl.uniform4f(locations[key], p[fields[0]], p[fields[1]], p[fields[2]], p[fields[3]]);
        });
        gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
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
      // Attribute zero always remains an enabled position array. The branch is
      // a constant attribute, leaving all fragment sampler/uniform limits intact.
      gl.bindAttribLocation(program, 0, 'a_position');
      gl.bindAttribLocation(program, 1, 'a_uv');
      gl.bindAttribLocation(program, 2, 'a_evolution');
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('link');
      gl.useProgram(program);
      var buffer = own('createBuffer'); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      var mesh = growthMesh(stageProfile.key, branchProfile.key); vertexCount = mesh.length / 4;
      gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
      var position = gl.getAttribLocation(program, 'a_position'), uv = gl.getAttribLocation(program, 'a_uv');
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(uv); gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);
      var branchAttribute = gl.getAttribLocation(program, 'a_evolution');
      gl.disableVertexAttribArray(branchAttribute);
      gl.vertexAttrib4f(branchAttribute, branchProfile.rgb[0], branchProfile.rgb[1], branchProfile.rgb[2], branchProfile.index);
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
  return Object.freeze({ mount: mount, pose: pose, evolutionCatalogue: evolutionCatalogue, evolutionProfile: evolutionProfile, evolutionFurColor: evolutionFurColor, growthProfile: growthProfile, growthPoint: growthPoint, feedingAnchor: feedingAnchor, feedingPhase: feedingPhase, outfitCatalogue: outfitCatalogue, outfitProfile: outfitProfile, outfitCoverage: outfitCoverage, situationForAction: situationForAction,
    catalogue: catalogue, durations: durations, situations: Object.freeze(Object.keys(durations)), sourceType: '2d_image_motion' });
});

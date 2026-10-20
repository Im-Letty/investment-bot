/* Independent pet game: UI only. State changes belong to PetGameCore. */
(function (w, d) {
  'use strict';
  var host = null, store = null, options = null, mounting = null, unsubscribe = null;
  var tab = 'care', busy = false, game = null, pendingFinish = null;
  var notice = '', failure = '', nameDraft = null, quantities = {}, backupText = '', importText = '';
  var lifecycleEpoch = 0, suspended = false, renderedDay = '';
  var motionControllers = [], motionRequests = [], reaction = null, greeted = false;
  var appearancePreview = false, previewSituation = 'idle', previewStartedAt = 0;
  var emotionGroup = 'bright', previewEmotionGroup = 'bright';
  var growthAlbumOpen = false, growthPreviewStage = null, growthPreviewPath = null;
  var fittingOpen = false, fittingOutfit = null;
  var imageRoot = '/static/';
  var stageLabels = { egg: 'たまご', baby: 'あかちゃん', child: 'こども', final: 'さいしゅうしんか' };
  var tabLabels = { care: 'そだてる', play: 'ミニゲーム', shop: 'お店・もちもの', market: '仮想マーケット' };

  function node(tag, cls, text) {
    var n = d.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function append(parent) {
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]);
    return parent;
  }
  function number(n) { return Number(n || 0).toLocaleString('ja-JP', { maximumFractionDigits: 2 }); }
  function signed(n) { return (n > 0 ? '+' : '') + number(n); }
  function state() { return store.getState(); }
  function displaySpecies(s) { return s.pet.species === 'dragon' ? 'lilac' : s.pet.species; }
  function core() { return w.PetGameCore; }
  function items() { return core().items || core().catalogue || core().ITEMS || []; }
  function item(id) { return items().filter(function (x) { return x.id === id; })[0]; }
  function itemName(id) { var x = item(id); return x ? x.name : 'アイテム'; }
  function clothingItems() { return items().filter(function (x) { return x.type === 'clothing'; }); }
  function wardrobe(s) { return s.wardrobe || { owned: {}, equipped: null }; }
  function outfit(s) {
    var worn = wardrobe(s), entry = item(worn.equipped);
    return entry && entry.type === 'clothing' && worn.owned && worn.owned[entry.id] === true ? entry.id : null;
  }
  function evolution(s) {
    if (typeof core().getLilacEvolution !== 'function') return null;
    return core().getLilacEvolution(s);
  }
  function evolutionPaths() { return Array.isArray(core().lilacEvolutionPaths) ? core().lilacEvolutionPaths : []; }
  function evolutionPath(s) { var view = evolution(s); return view && view.current ? view.current.key : 'balanced'; }
  function evolutionRow(key) { return evolutionPaths().filter(function (entry) { return entry.key === key; })[0] || null; }
  function limits() { return core().LIMITS || {}; }
  function currentDay() {
    var dt = new Date((options && options.now || Date.now)());
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }
  function petMood(s) {
    if (s.care.lastCareAt == null) return 'はじめまして。いっしょに過ごそう。';
    var elapsed = Math.max(0, (options && options.now || Date.now)() - s.care.lastCareAt);
    return elapsed >= 3 * 86400000 ? 'のんびり待っていたよ。今日は何をしよう？' :
      elapsed >= 86400000 ? 'また会えてうれしい！お世話の時間かな。' : 'いいきもち。いっしょに過ごせてうれしいな。';
  }
  function button(label, fn, secondary, disabled) {
    var b = node('button', 'ipg-button' + (secondary ? ' ipg-secondary' : ''), label);
    b.type = 'button';
    if (disabled) { b.disabled = true; b.dataset.ipgDisabled = '1'; }
    b.addEventListener('click', fn);
    return b;
  }
  function card(title, extra) {
    var c = node('section', 'ipg-card' + (extra ? ' ' + extra : ''));
    if (title) c.appendChild(node('h3', '', title));
    return c;
  }
  function text(t, cls) { return node('p', cls || 'ipg-muted', t); }
  function label(caption, input) {
    var l = node('label', 'ipg-field');
    append(l, node('span', '', caption), input);
    return l;
  }
  function metric(caption, value) {
    return append(node('div', 'ipg-metric'), node('dt', '', caption), node('dd', '', value));
  }
  function safeError(result) {
    var e = result && result.error;
    return e && typeof e.message === 'string' ? e.message.slice(0, 250) :
      (typeof e === 'string' ? e.slice(0, 250) : '保存できませんでした。記録を保持したまま、もう一度お試しください。');
  }
  function rewardText(reward) {
    if (!reward || typeof reward !== 'object') return '';
    var bits = [];
    if (typeof reward.coins === 'number' && reward.coins > 0) bits.push('+' + number(reward.coins) + 'コイン');
    if (typeof reward.exp === 'number' && reward.exp > 0) bits.push('+' + number(reward.exp) + 'EXP');
    if (Array.isArray(reward.items)) {
      reward.items.forEach(function (x) { if (x.count > 0) bits.push(itemName(x.id) + ' ×' + number(x.count)); });
    } else if (reward.items && typeof reward.items === 'object') {
      Object.keys(reward.items).forEach(function (id) {
        if (reward.items[id] > 0) bits.push(itemName(id) + ' ×' + number(reward.items[id]));
      });
    }
    if (typeof reward.fee === 'number') bits.push('手数料 ' + number(reward.fee) + 'コイン');
    if (typeof reward.dividend === 'number' && reward.dividend > 0) bits.push('配当 +' + number(reward.dividend) + 'コイン');
    if (typeof reward.realizedProfit === 'number') bits.push('確定損益 ' + signed(reward.realizedProfit) + 'コイン');
    return bits.length ? ' ' + bits.join(' / ') : '';
  }
  function setBusy(value) {
    busy = value;
    if (!host) return;
    host.setAttribute('aria-busy', String(value));
    host.querySelectorAll('button,input,select,textarea').forEach(function (n) {
      n.disabled = value || n.dataset.ipgDisabled === '1';
    });
  }
  function stopMotions() {
    motionRequests.forEach(function (request) {
      if (request.cueTimer != null) w.clearTimeout(request.cueTimer);
      request.cueTimer = null;
      if (request.effect) { request.effect.hidden = true; request.effect.replaceChildren(); }
      if (request.food) request.food.hidden = true;
    });
    motionControllers.forEach(function (controller) { try { controller.destroy(); } catch (_) {} });
    motionControllers = []; motionRequests = [];
  }
  function motionsVisible() {
    var pane = d.getElementById('sect-pet');
    return !suspended && !d.hidden && !(pane && pane.hidden);
  }
  function grew(before, after) {
    var previous = stage(before), current = stage(after);
    return after.pet.exp > before.pet.exp && (previous.key !== current.key || current.min > previous.min);
  }
  function rememberReaction(action, before, after, result) {
    if (!result || !result.ok || !after || displaySpecies(after) !== 'lilac') return;
    var engine = w.PetLilacMotion, cue = null;
    try { if (engine && typeof engine.situationForAction === 'function') cue = engine.situationForAction(action, before, after, result); } catch (_) {}
    if (grew(before, after) && (!cue || cue.situation !== 'feeding')) cue = { situation: 'joy', durationMs: 3500 };
    if (cue) reaction = { situation: cue.situation, durationMs: cue.durationMs, startedAt: Date.now() };
  }
  function currentReaction() {
    if (reaction && Date.now() - reaction.startedAt >= reaction.durationMs) reaction = null;
    return reaction;
  }
  function petVisual(s, extraClass, preview, fittingOverride, evolutionOverride) {
    if (displaySpecies(s) !== 'lilac') {
      var old = node('img', extraClass || 'ipg-pet-image');
      old.src = petImage(s); old.alt = (s.pet.name || 'ペット') + '（' + stage(s).label + '）';
      old.width = 240; old.height = 240; old.draggable = false;
      return old;
    }
    var growthStage = stage(s).key;
    var pathRow = evolutionRow(preview && evolutionOverride ? evolutionOverride : evolutionPath(s));
    var path = pathRow ? pathRow.key : 'balanced';
    var dress = preview === 'fitting' ? fittingOverride : outfit(s);
    var dressItem = item(dress); dress = dressItem && dressItem.type === 'clothing' ? dressItem.id : null;
    var wrap = node('div', 'ipg-lilac-visual ipg-lilac-stage-' + growthStage + (extraClass ? ' ' + extraClass : ''));
    wrap.dataset.growthStage = growthStage; wrap.dataset.evolutionPath = path; wrap.dataset.outfit = dress || 'none';
    var still = node('img', 'ipg-lilac-still');
    still.src = imageRoot + 'pet_lilac_cutout.webp';
    still.alt = (s.pet.name || '薄紫のこ') + '（' + stage(s).label + '）';
    still.width = still.height = 300; still.draggable = false;
    var canvas = node('canvas', 'ipg-lilac-canvas');
    canvas.width = canvas.height = 512; canvas.hidden = true;
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', still.alt);
    append(wrap, still, canvas);
    var food = node('span', 'ipg-feeding-food'); food.hidden = true; food.setAttribute('aria-hidden', 'true');
    wrap.appendChild(food);
    var effect = node('div', 'ipg-emotion-effect'); effect.hidden = true; effect.setAttribute('aria-hidden', 'true');
    wrap.appendChild(effect);
    motionRequests.push({ canvas: canvas, still: still, wrap: wrap, food: food, effect: effect, preview: !!preview, growthPreview: preview === 'growth', fittingPreview: preview === 'fitting', growthStage: growthStage, evolutionPath: path, outfit: dress, visualAlt: still.alt + (pathRow ? '・' + pathRow.label + '・' + pathRow.colorName : '') + (dress ? '・お洋服：' + itemName(dress) : ''), controller: null, cueTimer: null, ready: false });
    return wrap;
  }
  function requestCue(request) {
    return request.growthPreview || request.fittingPreview ? null : request.preview ? previewCue() : currentReaction();
  }
  function startMotions() {
    if (!motionsVisible() || !w.PetLilacMotion || typeof w.PetLilacMotion.mount !== 'function') return;
    if (!greeted && displaySpecies(state()) === 'lilac') {
      greeted = true;
      if (!currentReaction()) reaction = { situation: 'greeting', durationMs: 2500, startedAt: Date.now() };
    }
    currentReaction();
    motionRequests.forEach(function (request) {
      if (request.canvas.isConnected === false) return;
      try {
        var localCue = requestCue(request);
        updateMotionPresentation(request, localCue);
        var controller = w.PetLilacMotion.mount(request.canvas, {
          assetRoot: imageRoot,
          growthStage: request.growthStage,
          evolutionPath: request.evolutionPath,
          outfit: request.outfit,
          situation: localCue ? localCue.situation : 'idle',
          durationMs: localCue ? localCue.durationMs : 0,
          elapsedMs: localCue ? Math.max(0, Date.now() - localCue.startedAt) : 0,
          onReady: function () { if (request.evolutionNotice) request.evolutionNotice.hidden = true; if (request.outfitNotice) request.outfitNotice.hidden = true; request.ready = true; request.canvas.hidden = false; request.still.hidden = true; updateMotionPresentation(request, requestCue(request)); },
          releaseContextOnDestroy: true,
          onError: function () { motionFallback(request); }
        });
        request.controller = controller;
        motionControllers.push(controller);
        if (game && request.wrap.className.indexOf('ipg-catcher') >= 0) game.motion = controller;
      } catch (_) { motionFallback(request); }
    });
  }
  function motionFallback(request) {
    request.ready = false; request.canvas.hidden = true; request.still.hidden = false;
    request.wrap.dataset.situation = 'idle'; request.wrap.dataset.feedingPhase = '';
    if (request.cueTimer != null) w.clearTimeout(request.cueTimer); request.cueTimer = null;
    if (request.effect) { request.effect.hidden = true; request.effect.replaceChildren(); }
    if (request.food) request.food.hidden = true;
    (request.controls || []).forEach(function (control) { control.disabled = true; control.dataset.ipgDisabled = '1'; });
    if (request.caption) request.caption.textContent = 'この画面では動きを表示できないため、絵で表示しています。' + (request.evolutionPath !== 'balanced' ? '育ち方の色・姿は表示できません。' : '') + (request.outfit ? 'この環境では服の見た目を表示できません。' : '');
    if (request.outfitNotice) request.outfitNotice.hidden = false;
    if (request.evolutionNotice) request.evolutionNotice.hidden = false;
    if (request.growthCaption) request.growthCaption.textContent = '成長の動きを表示できないため、基準の絵を表示しています。' + (request.evolutionPath !== 'balanced' ? '育ち方の色・姿は表示できません。' : '') + (request.outfit ? 'この環境では服の見た目を表示できません。' : '');
    if (request.fittingCaption) request.fittingCaption.textContent = '試着の表示を確認できないため、服を描かない基準の絵を表示しています。' + (request.evolutionPath !== 'balanced' ? '育ち方の色・姿は表示できません。' : '');
  }
  // The catalogue is shared with the renderer. A missing optional renderer keeps
  // the original static pet and a readable, disabled emotion selector.
  var emotionFallback = [
    ['bright','うれしい・だいすき',[['joy','喜ぶ'],['laugh','大笑い'],['excited','わくわく'],['proud','得意げ'],['love','だいすき'],['grateful','ありがとう']]],
    ['deep','かなしい・おこる',[['sad','悲しい'],['cry','泣く'],['lonely','さみしい'],['disappointed','がっかり'],['angry','怒る'],['sulky','すねる']]],
    ['wonder','びっくり・かんがえる',[['surprise','びっくり'],['scared','こわい'],['nervous','そわそわ'],['confused','困る'],['curious','きになる'],['thinking','考える']]],
    ['together','ふれあい',[['greeting','おかえり'],['petted','なでられる'],['shy','はにかむ'],['embarrassed','あせる'],['apology','ごめんね'],['cheer','応援']]],
    ['calm','のんびり・おやすみ',[['idle','ふだん'],['resting','おやすみ'],['sleepy','うとうと'],['yawn','あくび'],['relaxed','のんびり'],['bored','ひま']]],
    ['action','あそぶ・がんばる',[['feeding','ごはん'],['moving','移動'],['caught','キャッチ'],['dance','ダンス'],['celebrate','お祝い'],['determined','やるぞ']]]
  ];
  function emotionCatalogue() {
    var shared = w.PetLilacMotion && w.PetLilacMotion.catalogue;
    return emotionFallback.reduce(function (all, group) {
      return all.concat(group[2].map(function (entry) {
        var detail = Array.isArray(shared) && shared.filter(function (x) { return x.id === entry[0]; })[0];
        return { id: entry[0], label: detail && detail.label || entry[1], group: group[0], groupLabel: group[1],
          durationMs: w.PetLilacMotion && w.PetLilacMotion.durations[entry[0]] || 0 };
      }));
    }, []);
  }
  function previewCue() {
    var duration = w.PetLilacMotion && w.PetLilacMotion.durations[previewSituation] || 0;
    if (previewSituation !== 'idle' && Date.now() - previewStartedAt >= duration) previewSituation = 'idle';
    return { situation: previewSituation, durationMs: duration, startedAt: previewStartedAt };
  }
  function effectFor(situation) {
    if (['sad','cry'].indexOf(situation) >= 0) return { kind: 'tears', marks: ['', '', '', ''] };
    if (['angry','sulky','determined'].indexOf(situation) >= 0) return { kind: 'anger', marks: ['╬','☁','☁'] };
    if (['love','grateful','petted','shy'].indexOf(situation) >= 0) return { kind: 'hearts', marks: ['♡','♡','♡'] };
    if (['scared','nervous','embarrassed'].indexOf(situation) >= 0) return { kind: 'sweat', marks: ['', '〰', ''] };
    if (['surprise','confused','curious','thinking'].indexOf(situation) >= 0) return { kind: 'wonder', marks: [situation === 'surprise' ? '！' : '？','·','·'] };
    if (['resting','sleepy','yawn','relaxed'].indexOf(situation) >= 0) return { kind: 'sleep', marks: ['z','Z','·'] };
    if (['lonely','disappointed','bored','apology'].indexOf(situation) >= 0) return { kind: 'quiet', marks: ['·','·','·'] };
    if (situation === 'idle') return null;
    return { kind: 'sparkle', marks: ['✦','♪','✧','✦'] };
  }
  function updateMotionPresentation(request, cue) {
    if (request.cueTimer != null) w.clearTimeout(request.cueTimer);
    request.cueTimer = null;
    var name = cue && cue.situation || 'idle', duration = cue && cue.durationMs || 0;
    var age = cue ? Math.max(0, Date.now() - cue.startedAt) : 0;
    if (name !== 'idle' && age >= duration) name = 'idle';
    var meal = name === 'feeding' && w.PetLilacMotion && typeof w.PetLilacMotion.feedingPhase === 'function' ?
      w.PetLilacMotion.feedingPhase(age) : null;
    var entry = emotionCatalogue().filter(function (x) { return x.id === name; })[0];
    (request.controls || []).forEach(function (control) { control.setAttribute('aria-pressed', String(control.dataset.emotion === name)); });
    if (request.caption) request.caption.textContent = meal ? meal.label + (request.preview ? 'の見本' : '') :
      (entry ? entry.label : 'ふだん') + (request.preview ? 'の見本' : 'のしぐさ');
    request.canvas.setAttribute('aria-label', (request.visualAlt || request.still.alt) + '・' + (meal ? meal.label : entry ? entry.label : 'ふだん'));
    request.wrap.dataset.situation = name;
    request.wrap.dataset.feedingPhase = meal ? meal.phase : '';
    if (request.food) {
      request.food.hidden = !(meal && meal.foodVisible && request.ready && motionsVisible());
      var anchor = w.PetLilacMotion && typeof w.PetLilacMotion.feedingAnchor === 'function' ? w.PetLilacMotion.feedingAnchor(request.growthStage, request.evolutionPath) : null;
      if (anchor && Number.isFinite(anchor.foodLeft) && Number.isFinite(anchor.foodTop)) {
        request.food.style.left = String(anchor.foodLeft * 100) + '%'; request.food.style.top = String(anchor.foodTop * 100) + '%';
      }
      request.food.dataset.bites = !meal || meal.foodProgress < .34 ? '0' : meal.foodProgress < .68 ? '1' : '2';
      request.food.style.animationDelay = meal ? String(-(meal.phase === 'chewing' ? age - 1200 : age) / 1000) + 's' : '0s';
    }
    if (request.effect) {
      request.effect.replaceChildren();
      var effect = request.ready && motionsVisible() ? effectFor(name) : null;
      if (meal) effect = request.ready && motionsVisible() ?
        (meal.phase === 'joy' || meal.phase === 'settling' ? { kind: 'hearts', marks: ['♡','♡','♪','♡'] } :
          meal.phase === 'chewing' ? { kind: 'crumbs', marks: ['·','·','·'] } : null) : null;
      request.effect.hidden = !effect;
      if (effect) {
        request.effect.className = 'ipg-emotion-effect ipg-effect-' + effect.kind;
        effect.marks.forEach(function (mark, i) {
          var mote = node('span', 'ipg-emotion-mote ipg-mote-' + i, mark);
          mote.style.animationDelay = String(-age / 1000 + i * .13) + 's';
          request.effect.appendChild(mote);
        });
      }
    }
    var nextAge = meal && meal.nextBoundaryMs != null ? Math.min(duration, meal.nextBoundaryMs) : duration;
    if (meal && meal.phase === 'chewing') nextAge = Math.min(nextAge, 1200 + (meal.foodProgress < .34 ? .34 : meal.foodProgress < .68 ? .68 : 1) * 3200);
    if (name !== 'idle' && motionsVisible()) request.cueTimer = w.setTimeout(function () {
      request.cueTimer = null;
      if (!request.canvas.isConnected || !motionsVisible()) return;
      if (meal && Date.now() - cue.startedAt < duration) { updateMotionPresentation(request, cue); return; }
      if (request.preview) previewSituation = 'idle';
      else if (reaction && reaction.startedAt === cue.startedAt) reaction = null;
      updateMotionPresentation(request, null);
    }, Math.max(16, nextAge - age));
  }
  function emotionPalette(request, preview) {
    var box = node('section', 'ipg-emotion-panel');
    box.setAttribute('aria-label', preview ? 'しぐさの見本・36種類' : 'きもちとしぐさ・36種類');
    append(box, node('h4', '', preview ? '36種類のしぐさの見本' : 'きもちとしぐさ · 36種類'),
      text('好きなきもちを選んで、もう一度タップすると繰り返せます。', 'ipg-small'));
    var caption = text('ふだんのしぐさ', 'ipg-emotion-caption'); caption.setAttribute('aria-live', 'polite');
    var tabs = node('div', 'ipg-emotion-groups'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', 'きもちのグループ');
    var choices = node('div', 'ipg-emotion-choices'), groups = [], groupButtons = [];
    var selected = preview ? previewEmotionGroup : emotionGroup;
    if (!emotionFallback.some(function (x) { return x[0] === selected; })) selected = 'bright';
    var activeName = preview ? previewCue().situation : (currentReaction() || {}).situation || 'idle';
    var all = emotionCatalogue(), available = !!request && !!w.PetLilacMotion;
    if (request) { request.controls = []; request.caption = caption; }
    emotionFallback.forEach(function (group) {
      var groupBox = node('div', 'ipg-emotion-grid'); groupBox.hidden = selected !== group[0];
      groupBox.setAttribute('role', 'group'); groupBox.setAttribute('aria-label', group[1]);
      var groupButton = button(group[1], function () {
        if (preview) previewEmotionGroup = group[0]; else emotionGroup = group[0];
        groupButtons.forEach(function (x) { x.button.setAttribute('aria-pressed', String(x.id === group[0])); });
        groups.forEach(function (x) { x.box.hidden = x.id !== group[0]; });
      }, true);
      groupButton.setAttribute('aria-pressed', String(selected === group[0]));
      groupButton.dataset.focusKey = (preview ? 'preview-' : 'pet-') + 'emotion-group-' + group[0];
      groupButtons.push({ id: group[0], button: groupButton }); tabs.appendChild(groupButton);
      all.filter(function (entry) { return entry.group === group[0]; }).forEach(function (entry) {
        var choice = button(entry.label, function () {
          if (!request || !request.controller || !request.ready || !motionsVisible()) return;
          var cue = { situation: entry.id, durationMs: entry.durationMs, startedAt: Date.now() };
          if (preview) { previewSituation = entry.id; previewStartedAt = cue.startedAt; }
          else reaction = cue;
          try { request.controller.setSituation(entry.id); updateMotionPresentation(request, cue); }
          catch (_) { motionFallback(request); }
        }, true, !available);
        choice.dataset.emotion = entry.id;
        choice.dataset.focusKey = (preview ? 'preview-' : 'pet-') + 'emotion-' + entry.id;
        choice.setAttribute('aria-pressed', String(entry.id === activeName));
        if (request) request.controls.push(choice);
        groupBox.appendChild(choice);
      });
      groups.push({ id: group[0], box: groupBox }); choices.appendChild(groupBox);
    });
    append(box, caption, tabs, choices);
    if (!request) box.appendChild(text('たまごがかえったら、きもちを選べるようになります。', 'ipg-small'));
    if (!w.PetLilacMotion) caption.textContent = '絵の見本を表示しています。' + (request && request.evolutionPath !== 'balanced' ? '育ち方の色・姿は表示できません。' : '') + (request && request.outfit ? 'この環境では服の見た目を表示できません。' : '');
    return box;
  }
  async function run(action, message) {
    if (!store || busy) return { ok: false, error: { code: 'ui_busy' } };
    var before = state();
    setBusy(true);
    var result;
    try {
      result = await store.dispatch(action);
      if (result && result.ok) {
        failure = ''; notice = (message || '保存しました。') + rewardText(result.reward);
        var afterStage = stage(result.state || state());
        rememberReaction(action, before, result.state || state(), result);
        if (grew(before, result.state || state())) notice += ' ' + afterStage.label + 'へ進化しました！';
      }
      else { failure = safeError(result); notice = ''; }
    } catch (_) {
      result = { ok: false, error: { code: 'save_failed' } };
      failure = '保存を確認できませんでした。記録を保持したまま、もう一度お試しください。';
      notice = '';
    } finally {
      setBusy(false);
      if (!game) render();
    }
    return result;
  }
  function stage(s) {
    if (displaySpecies(s) === 'lilac' && typeof core().getLilacGrowth === 'function') return core().getLilacGrowth(s.pet.exp);
    var fn = core().getStage || store.getStage;
    var info = fn ? fn(s.pet.exp) : { key: 'egg', label: 'たまご', min: 0, next: null, progress: 0 };
    return displaySpecies(s) === 'lilac' && info.key === 'egg' ? Object.assign({}, info, { label: 'うまれたて' }) : info;
  }
  function petImage(s) {
    var key = stage(s).key, bunny = s.pet.species === 'bunny';
    if (!stageLabels[key]) key = 'egg';
    if (!bunny) return imageRoot + 'pet_lilac_cutout.webp';
    if (bunny && key === 'final' && s.pet.path === 'cool') return imageRoot + 'pet_bimg_cool.webp';
    return imageRoot + 'pet_bimg_' + key + '.webp';
  }
  function showGrowthGallery() {
    var shown = host && host.querySelector('.ipg-growth-gallery');
    if (shown && motionsVisible()) {
      if (typeof shown.scrollIntoView === 'function') shown.scrollIntoView({ block: 'center', behavior: 'auto' });
      var caption = shown.querySelector('.ipg-growth-caption'); if (caption && typeof caption.focus === 'function') caption.focus({ preventScroll: true });
    }
  }
  function foodEvolutionHint(id) {
    if (id === 'apple' || id === 'berry') return 'Bの育ち方：桃色の「はなほっぺ」につながるごはん。';
    if (id === 'rice' || id === 'feast') return 'Bの育ち方：はちみつ色の「ぽかぽか」につながるごはん。';
    if (id === 'cake') return 'Bの育ち方：杏色の「おやつっこ」につながるおやつ。';
    return '';
  }
  function renderEvolutionStatus(s, parent) {
    var view = evolution(s); if (!view || !view.current) return;
    var section = node('section', 'ipg-evolution-status'); section.setAttribute('aria-label', '育ち方と次の進化の傾向');
    var heading = node('p', 'ipg-evolution-current');
    var color = node('span', 'ipg-evolution-color'); color.style.backgroundColor = view.current.color; color.setAttribute('aria-hidden', 'true');
    append(heading, color, node('span', '', 'いまの育ち方：' + view.current.label + '・' + view.current.colorName)); section.appendChild(heading);
    section.appendChild(text('次の進化の傾向（予想）：' + (view.tendency ? view.tendency.label + '・' + view.tendency.colorName : 'まだこれから'), 'ipg-evolution-tendency'));
    if (view.nextAt != null) section.appendChild(text(number(view.nextAt) + ' EXPで、その時の育ち方が決まります。', 'ipg-small'));
    section.appendChild(text(view.tracked ? '新しく記録した育成日数：' + number(view.activeDays) + '日' :
      '育ち方の記録は、ここからのお世話から始まります。これまでのEXPやもちものは、そのままです。', 'ipg-evolution-recorded ipg-small'));
    var help = node('details', 'ipg-evolution-help'); help.appendChild(node('summary', '', '育ち方のヒント'));
    var hints = node('ul'); evolutionPaths().forEach(function (entry) { hints.appendChild(node('li', '', entry.label + '・' + entry.colorName + '：' + entry.hint)); });
    append(help, text('食べものやお世話の種類に加えて、日を分けて続けることも育ち方につながります。800 EXPから先も、800 EXPごとに次の育ち方へ変わっていきます。', 'ipg-small'), hints); section.appendChild(help);
    if (Array.isArray(view.history) && view.history.length) {
      var history = node('details', 'ipg-evolution-history'); history.appendChild(node('summary', '', '記録できた進化（' + number(view.history.length) + '）'));
      var list = node('ol');
      view.history.forEach(function (entry) {
        var growth = (core().lilacGrowthStages || []).filter(function (row) { return row.key === entry.stageKey; })[0];
        var branch = evolutionRow(entry.branch), stamp = typeof entry.at === 'number' ? new Date(entry.at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' JST' : '';
        list.appendChild(node('li', '', (growth ? growth.label : entry.stageKey) + ' · ' + number(entry.min) + ' EXP · ' + (branch ? branch.label + '・' + branch.colorName : entry.branch) + (stamp ? ' · ' + stamp : '')));
      }); history.appendChild(list); section.appendChild(history);
    }
    if (view.current.key !== 'balanced') {
      var unavailable = text('育ち方の記録は保存されています。この環境では育ち方の色・姿を表示できません。', 'ipg-evolution-unavailable ipg-small');
      unavailable.hidden = !!(w.PetLilacMotion && typeof w.PetLilacMotion.mount === 'function');
      var request = motionRequests.filter(function (request) { return !request.preview; }).slice(-1)[0];
      if (request) request.evolutionNotice = unavailable; section.appendChild(unavailable);
    }
    parent.appendChild(section);
  }
  function renderGrowthAlbum(s, parent) {
    var stages = core().lilacGrowthStages;
    if (displaySpecies(s) !== 'lilac' || !Array.isArray(stages) || !stages.length) return;
    var album = node('section', 'ipg-growth-album');
    var toggle = button(growthAlbumOpen ? '成長のすがたを閉じる' : '成長のすがたを見る', function () {
      growthAlbumOpen = !growthAlbumOpen; growthPreviewStage = growthAlbumOpen ? stage(state()).key : null; growthPreviewPath = growthAlbumOpen ? evolutionPath(state()) : null; render();
    }, true);
    toggle.dataset.focusKey = 'growth-album-toggle'; toggle.setAttribute('aria-expanded', String(growthAlbumOpen));
    album.appendChild(toggle);
    if (growthAlbumOpen) {
      var current = stage(s), selected = stages.filter(function (entry) { return entry.key === growthPreviewStage; })[0] || current;
      growthPreviewStage = selected.key;
      var actualPath = evolutionPath(s), selectedPath = evolutionRow(growthPreviewPath) || evolutionRow(actualPath);
      growthPreviewPath = selectedPath ? selectedPath.key : actualPath;
      var future = selected.min > s.pet.exp, currentView = selected.key === current.key && growthPreviewPath === actualPath;
      var viewing = node('div', 'ipg-growth-gallery');
      var sample = Object.assign({}, s, { pet: Object.assign({}, s.pet, { exp: selected.min }) });
      var visual = petVisual(sample, 'ipg-growth-sample', 'growth', undefined, growthPreviewPath);
      var request = motionRequests[motionRequests.length - 1];
      var preview = node('div', 'ipg-growth-preview');
      var caption = text(selected.label + (selectedPath ? '・' + selectedPath.label + '・' + selectedPath.colorName : '') + ' · ' + (future ? 'これからの姿・見本' : currentView ? 'いまの姿の見本' : growthPreviewPath !== actualPath ? '育ち方・色の見本' : '育った姿の見本'), 'ipg-growth-caption');
      caption.setAttribute('aria-live', 'polite'); caption.tabIndex = -1;
      request.growthCaption = caption;
      if (!w.PetLilacMotion || typeof w.PetLilacMotion.mount !== 'function') caption.textContent = '成長の動きを表示できないため、基準の絵を表示しています。' + (request.evolutionPath !== 'balanced' ? '育ち方の色・姿は表示できません。' : '') + (request.outfit ? 'この環境では服の見た目を表示できません。' : '');
      append(preview, visual, caption);
      var choices = node('div', 'ipg-growth-choices'); choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', '成長のすがた・6段階');
      stages.forEach(function (entry) {
        var entryFuture = entry.min > s.pet.exp, entryCurrent = entry.key === current.key;
        var choice = button('', function () { growthPreviewStage = entry.key; render(); showGrowthGallery(); }, true);
        choice.dataset.growthStage = entry.key; choice.dataset.focusKey = 'growth-stage-' + entry.key;
        choice.setAttribute('aria-pressed', String(entry.key === selected.key));
        append(choice, node('span', 'ipg-growth-label', entry.label), node('small', '', number(entry.min) + (entry.key === 'companion' ? ' EXP〜 · ' : ' EXP · ') +
          (entryFuture ? 'これから・見本' : entryCurrent ? 'いまの姿' : '到達済み')));
        choices.appendChild(choice);
      });
      var selectors = node('div', 'ipg-growth-selectors'); selectors.appendChild(choices);
      var branches = evolutionPaths();
      if (branches.length) {
        var branchChoices = node('div', 'ipg-evolution-choices'); branchChoices.setAttribute('role', 'group'); branchChoices.setAttribute('aria-label', '育ち方と色・6つの見本');
        selectors.appendChild(text('育ち方・色の見本', 'ipg-small'));
        branches.forEach(function (entry) {
          var branch = button('', function () { growthPreviewPath = entry.key; render(); showGrowthGallery(); }, true);
          branch.dataset.evolutionPath = entry.key; branch.dataset.focusKey = 'growth-path-' + entry.key;
          branch.setAttribute('aria-pressed', String(entry.key === growthPreviewPath));
          var color = node('span', 'ipg-evolution-color'); color.style.backgroundColor = entry.color; color.setAttribute('aria-hidden', 'true');
          append(branch, color, node('span', '', entry.label), node('small', '', entry.colorName + '・見本')); branchChoices.appendChild(branch);
        });
        selectors.appendChild(branchChoices);
      }
      append(viewing, preview, selectors); album.appendChild(viewing);
      album.appendChild(text('これからの姿も、見本で見られます。', 'ipg-small'));
    }
    parent.appendChild(album);
  }
  function renderCare(s, body) {
    var info = stage(s), pet = card('', 'ipg-pet-card');
    var scene = node('div', 'ipg-scene ipg-scene-' + (s.decorations.background || 'meadow').replace(/^bg_/, ''));
    var img = petVisual(s);
    var careRequest = displaySpecies(s) === 'lilac' ? motionRequests[motionRequests.length - 1] : null;
    var equipped = s.decorations.equipped, decor = item(equipped);
    var decorText = decor ? decor.emoji || '🌿' : equipped ? String(equipped).slice(0, 40) : '';
    var decoration = decorText ? node('span', 'ipg-pet-decoration', decorText) : null;
    if (decoration) decoration.setAttribute('aria-label', '身につけているかざり：' + (decor ? decor.name : String(equipped).slice(0, 100)));
    append(scene, node('span', 'ipg-sky', '✧'), img, decoration);
    var emotionStage = careRequest ? append(node('div', 'ipg-emotion-stage'), scene, emotionPalette(careRequest, false)) : scene;
    append(pet, emotionStage, node('h3', 'ipg-pet-name', s.pet.name || 'なまえをつけよう'),
      text(info.label + ' · ' + number(s.pet.exp) + ' EXP', 'ipg-stage'), text(petMood(s), 'ipg-pet-mood'));
    var progress = node('progress', 'ipg-progress');
    progress.max = 100; progress.value = info.progress;
    progress.setAttribute('aria-label', '次の成長までの進み具合');
    append(pet, progress, text(info.next == null ? 'ここまで育ててくれて、ありがとう。お世話はこれからも続けられます。' :
      '次の成長まで あと' + number(Math.max(0, info.next - s.pet.exp)) + ' EXP'));
    if (displaySpecies(s) === 'lilac') { renderEvolutionStatus(s, pet); renderWornOutfit(s, pet); }
    renderGrowthAlbum(s, pet);
    var care = node('div', 'ipg-care-buttons');
    [['feed', 'ごはん', '🍎', 8], ['play', 'なでる', '♡', 5], ['rest', '休む', '☾', 4]].forEach(function (x) {
      var used = s.care.day === currentDay() ? s.care.counts[x[0]] || 0 : 0, cap = (limits().care || {})[x[0]] || 3;
      var b = button('', function () { run({ type: 'care', kind: x[0] }, 'お世話の記録を保存しました。'); }, false, used >= cap);
      b.dataset.focusKey = 'care-' + x[0];
      append(b, node('span', 'ipg-care-icon', x[2]), node('span', '', x[1]),
        node('small', '', number(used) + '/' + cap + '回 · +' + x[3] + 'EXP'));
      care.appendChild(b);
    });
    if (displaySpecies(s) === 'lilac' && !careRequest) pet.appendChild(emotionPalette(null, false));
    append(pet, care, text(s.care.dailyRewardDay === currentDay() ?
      '今日の育成報酬10コインは受け取り済み。お世話は残りの回数まで続けられます。' :
      'その日最初のお世話で、育成報酬10コイン。お世話だけでも成長できます。'));
    if (displaySpecies(s) === 'lilac' && evolution(s)) pet.appendChild(text('いつものごはんは、りんご。食べものの種類や、なでる・休む、日を分けて続けるお世話で育ち方が変わります。同じ日にたくさん繰り返しても、進化の傾向への反映には上限があります。', 'ipg-evolution-explanation ipg-small'));
    body.appendChild(pet);
    var settings = node('details', 'ipg-card ipg-pet-settings');
    settings.appendChild(node('summary', '', 'なまえ・ペットの種類'));
    var form = node('form', 'ipg-form');
    var input = node('input'); input.type = 'text'; input.maxLength = 20; input.autocomplete = 'off';
    input.value = nameDraft == null ? s.pet.name : nameDraft;
    input.addEventListener('input', function () { nameDraft = input.value; });
    var save = node('button', 'ipg-button', 'なまえを保存'); save.type = 'submit';
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var result = await run({ type: 'rename', name: input.value }, 'なまえを保存しました。');
      if (result.ok) { nameDraft = null; render(); }
    });
    append(form, label('なまえ（20文字まで）', input), save);
    var species = node('div', 'ipg-row');
    [['lilac', '薄紫のこ（B）'], ['bunny', 'うさぎ']].forEach(function (x) {
      var b = button(x[1] + (displaySpecies(s) === x[0] ? ' · 選択中' : ''), function () {
        run({ type: 'chooseSpecies', species: x[0] }, 'ペットの種類を保存しました。');
      }, true, displaySpecies(s) === x[0]);
      species.appendChild(b);
    });
    append(settings, form, text('ペットの種類'), species);
    var previewToggle = button(appearancePreview ? 'しぐさの見本を閉じる' : '薄紫のこのしぐさを見る', function () {
      appearancePreview = !appearancePreview; previewSituation = 'idle'; previewStartedAt = Date.now(); render();
    }, true);
    previewToggle.dataset.focusKey = 'lilac-preview';
    previewToggle.setAttribute('aria-expanded', String(appearancePreview));
    settings.appendChild(previewToggle);
    if (appearancePreview) {
      settings.open = true;
      var preview = node('div', 'ipg-appearance-preview');
      var sample = Object.assign({}, s, { pet: Object.assign({}, s.pet, { species: 'lilac', exp: 45 }) });
      var visual = petVisual(sample, 'ipg-lilac-sample', true, undefined, evolutionPath(s));
      var request = motionRequests[motionRequests.length - 1];
      append(preview, visual, emotionPalette(request, true)); settings.appendChild(preview);
    }
    if (displaySpecies(s) === 'lilac') {
      settings.appendChild(text('薄紫のこは、成長に合わせて少しずつ大きくなります。ごはんをもぐもぐ食べたら、うれしくてぴょん！36種類のきもちやしぐさも好きに選べます。'));
    }
    var appearance = node('div', 'ipg-row'), unlocked = s.pet.exp >= 110;
    [['cute', 'かわいい'], ['cool', 'かっこいい']].forEach(function (x) {
      appearance.appendChild(button(x[1] + (s.pet.path === x[0] ? ' · 選択中' : ''), function () {
        run({ type: 'chooseAppearance', path: x[0], pixel: !!s.pet.pixel }, 'すがたを保存しました。');
      }, true, !unlocked || s.pet.path === x[0]));
    });
    if (displaySpecies(s) !== 'lilac') append(settings, text(unlocked ? '最終形のすがた' : '最終形のすがたは、110EXPで選べます。'), appearance);
    body.appendChild(settings);
  }
  function renderPlay(s, body) {
    var c = card('おにぎりキャッチ');
    append(c, text('25秒で、おにぎりをキャッチ。左右に動かすか、← → キーでペットを動かせます。'),
      text('1日3回まで。中止した回も1回に数えます。報酬は終了後、保存できたときに受け取れます。'));
    var used = s.minigames.day === currentDay() ? s.minigames.started || 0 : 0, cap = limits().minigamesPerDay || 3;
    append(c, text('今日 ' + number(used) + '/' + cap + '回 · 最高 ' + number(s.minigames.bestScore) + '個', 'ipg-stage'));
    if (game) {
      buildBoard(c);
    } else if (pendingFinish) {
      append(c, text('結果の保存を確認できていません。再試行しても同じ回の報酬が重複することはありません。'),
        button('結果の保存を再試行', finishPending));
    } else if (s.minigames.active) {
      var interrupted = s.minigames.active.id;
      append(c, text('前の回の中断記録が残っています。報酬を付けずに終了してから、新しいゲームを始められます。'),
        button('前の回を終了する（報酬なし）', function () {
          run({ type: 'cancelMinigame', sessionId: interrupted }, '中断した回を終了しました。');
        }, true));
    } else {
      append(c, button('25秒のゲームをはじめる', startGame, false, used >= cap),
        text('獲得コインやアイテムは、お店やお世話に使えます。'));
    }
    body.appendChild(c);
  }
  async function startGame() {
    if (game || pendingFinish || busy) return;
    var epoch = lifecycleEpoch;
    var result = await run({ type: 'beginMinigame', kind: 'catch' }, 'ゲームを開始しました。');
    if (!result.ok) return;
    var active = state().minigames.active;
    var id = result.reward && result.reward.sessionId || active && active.id;
    if (!id) { failure = 'ゲームの開始記録を確認できませんでした。'; render(); return; }
    if (suspended || epoch !== lifecycleEpoch || d.hidden) {
      await run({ type: 'cancelMinigame', sessionId: id }, '画面を離れたためゲームを中止しました。');
      return;
    }
    game = { id: id, score: 0, x: 50, drops: [], elapsed: 0, nextSpawn: 0, started: null, frame: null, events: [], finished: false };
    tab = 'play'; notice = ''; render();
  }
  function onGame(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    game.events.push(function () { target.removeEventListener(type, fn, opts); });
  }
  function cleanGame(g) {
    if (!g) return;
    if (g.frame != null) w.cancelAnimationFrame(g.frame);
    g.events.forEach(function (remove) { remove(); });
    g.events = []; g.finished = true;
  }
  function buildBoard(parent) {
    var g = game;
    var status = node('p', 'ipg-game-status', '残り25秒 · 0個');
    status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
    var board = node('div', 'ipg-catch-board');
    board.tabIndex = 0; board.setAttribute('role', 'group');
    board.setAttribute('aria-label', 'おにぎりキャッチ。左右に動かすか矢印キーで操作。');
    var catcher = petVisual(state(), 'ipg-catcher'); catcher.alt = '';
    catcher.draggable = false; catcher.setAttribute('aria-hidden', 'true');
    board.appendChild(catcher);
    var controls = node('div', 'ipg-game-controls');
    function move(delta) { if (game === g) { g.x = Math.max(8, Math.min(92, g.x + delta)); catcher.style.left = g.x + '%'; if (g.motion) g.motion.setSituation('moving', { durationMs: 800 }); } }
    append(controls, button('← 左へ', function () { move(-12); }, true),
      button('右へ →', function () { move(12); }, true));
    append(parent, status, board, controls, button('中止する（報酬なし）', function () { cancelGame('中止しました。この回の報酬はありません。'); }, true));
    function pointer(e) {
      if (game !== g) return;
      var r = board.getBoundingClientRect();
      if (r.width) { g.x = Math.max(8, Math.min(92, (e.clientX - r.left) / r.width * 100)); catcher.style.left = g.x + '%'; if (g.motion) g.motion.setSituation('moving', { durationMs: 800 }); }
      if (e.cancelable) e.preventDefault();
    }
    onGame(board, 'pointerdown', pointer);
    onGame(board, 'pointermove', pointer);
    onGame(board, 'keydown', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); move(e.key === 'ArrowLeft' ? -8 : 8); }
    });
    var announced = -1;
    function tick(t) {
      if (game !== g || g.finished) return;
      if (g.started === null) g.started = t;
      g.elapsed = t - g.started;
      if (g.elapsed >= 25000) {
        cleanGame(g); game = null; pendingFinish = { sessionId: g.id, score: Math.min(30, g.score) };
        finishPending(); return;
      }
      if (g.elapsed >= g.nextSpawn) {
        var drop = { x: 8 + Math.random() * 84, at: g.elapsed, el: node('span', 'ipg-drop', '🍙') };
        drop.el.setAttribute('aria-hidden', 'true'); drop.el.style.left = drop.x + '%';
        board.appendChild(drop.el); g.drops.push(drop); g.nextSpawn = g.elapsed + 620;
      }
      g.drops = g.drops.filter(function (drop) {
        var y = (g.elapsed - drop.at) / 1900 * 100;
        if (y >= 79 && y <= 95 && Math.abs(drop.x - g.x) <= 12) {
          if (g.motion) g.motion.setSituation('caught', { durationMs: 800 });
          g.score = Math.min(30, g.score + 1); drop.el.remove(); return false;
        }
        if (y > 103) { drop.el.remove(); return false; }
        drop.el.style.top = y + '%'; return true;
      });
      var seconds = Math.ceil((25000 - g.elapsed) / 1000);
      if (seconds !== announced) { status.textContent = '残り' + seconds + '秒 · ' + g.score + '個'; announced = seconds; }
      g.frame = w.requestAnimationFrame(tick);
    }
    g.frame = w.requestAnimationFrame(tick);
  }
  async function finishPending() {
    if (!pendingFinish || busy) return;
    var p = pendingFinish;
    var result = await run({ type: 'finishMinigame', sessionId: p.sessionId, score: p.score }, 'ゲームの結果を保存しました。');
    if (result.ok || !(state().minigames.active && state().minigames.active.id === p.sessionId)) pendingFinish = null;
    render();
  }
  async function cancelGame(message) {
    if (!game) return;
    var g = game; cleanGame(g); game = null;
    await run({ type: 'cancelMinigame', sessionId: g.id }, message || 'ゲームを中止しました。');
  }
  function owned(s, x) {
    if (x.type === 'food') return s.inventory[x.id] || 0;
    if (x.type === 'clothing') return wardrobe(s).owned && wardrobe(s).owned[x.id] === true ? 1 : 0;
    if (x.type === 'background') return (s.decorations.backgrounds || []).indexOf(x.id) >= 0 ||
      (s.decorations.backgrounds || []).indexOf(x.id.replace(/^bg_/, '')) >= 0 || x.id === 'bg_meadow' ? 1 : 0;
    return s.decorations.owned[x.id] ? 1 : 0;
  }
  function renderWornOutfit(s, parent) {
    var worn = outfit(s), row = node('div', 'ipg-worn-outfit');
    row.appendChild(text(worn ? (displaySpecies(s) === 'lilac' ? '着用中：' : '薄紫のこの着用設定：') + itemName(worn) : 'お洋服：まだ着ていません。', 'ipg-small'));
    if (worn) {
      var remove = button('服を脱ぐ', function () { run({ type: 'equipClothing', itemId: null }, 'お洋服を脱ぎました。'); }, true);
      remove.dataset.focusKey = 'outfit-remove'; row.appendChild(remove);
      if (displaySpecies(s) === 'lilac') {
        var unavailable = text('着用設定は保存されています。この環境では服の見た目を表示できません。', 'ipg-outfit-unavailable ipg-small');
        unavailable.hidden = !!(w.PetLilacMotion && typeof w.PetLilacMotion.mount === 'function');
        var current = motionRequests.filter(function (request) { return !request.preview && request.outfit === worn; }).slice(-1)[0];
        if (current) current.outfitNotice = unavailable; row.appendChild(unavailable);
      }
    }
    parent.appendChild(row);
  }
  function renderClothesShop(s, body) {
    var clothes = clothingItems(); if (!clothes.length) return;
    var section = card('お洋服', 'ipg-clothes-shop');
    append(section, text('薄紫のこ（B）のお洋服です。まずは試着して、お気に入りを見つけよう。', 'ipg-small'));
    renderWornOutfit(s, section);
    if (fittingOpen) {
      var selected = item(fittingOutfit);
      if (!selected || selected.type !== 'clothing') { fittingOpen = false; fittingOutfit = null; }
      else {
        var fitting = node('div', 'ipg-outfit-fitting');
        var sample = Object.assign({}, s, { pet: Object.assign({}, s.pet, { species: 'lilac' }) });
        var visual = petVisual(sample, 'ipg-fitting-sample', 'fitting', selected.id);
        var request = motionRequests[motionRequests.length - 1];
        var fittingInfo = node('div', 'ipg-fitting-info');
        var caption = text(selected.name + ' · ' + (owned(s, selected) ? '購入済み・試着の見本' : '未購入・試着の見本'), 'ipg-fitting-caption');
        caption.setAttribute('aria-live', 'polite'); caption.tabIndex = -1; request.fittingCaption = caption;
        if (!w.PetLilacMotion || typeof w.PetLilacMotion.mount !== 'function') caption.textContent = 'この画面では試着の動きを表示できないため、服を描かない基準の絵を表示しています。' + (request.evolutionPath !== 'balanced' ? '育ち方の色・姿は表示できません。' : '');
        append(fittingInfo, caption, text('試着ではコインを使いません。', 'ipg-small'), button('試着を閉じる', function () {
          fittingOpen = false; fittingOutfit = null; render();
        }, true));
        append(fitting, visual, fittingInfo); section.appendChild(fitting);
      }
    }
    var grid = node('div', 'ipg-clothing-grid');
    var styles = { cloth_cream_vest: 'vest', cloth_rose_cape: 'cape', cloth_sky_overalls: 'overalls', cloth_mint_knit: 'knit', cloth_star_pajamas: 'pajamas', cloth_flower_dress: 'dress' };
    clothes.forEach(function (entry) {
      var has = !!owned(s, entry), wearing = outfit(s) === entry.id;
      var row = node('article', 'ipg-clothing-item'); row.dataset.clothing = entry.id;
      var icon = node('span', 'ipg-clothing-swatch ipg-cloth-' + (styles[entry.id] || 'vest')); icon.setAttribute('aria-hidden', 'true');
      append(row, icon, node('h4', '', entry.name), text(number(entry.price) + 'コイン', 'ipg-stage'),
        text(wearing ? '着用中' : has ? '購入済み' : '未購入', 'ipg-small'));
      var tryOn = button('試着', function () {
        fittingOpen = true; fittingOutfit = entry.id; render();
        var shown = host && host.querySelector('.ipg-outfit-fitting');
        if (shown && motionsVisible()) {
          if (typeof shown.scrollIntoView === 'function') shown.scrollIntoView({ block: 'center', behavior: 'auto' });
          var title = shown.querySelector('.ipg-fitting-caption'); if (title && typeof title.focus === 'function') title.focus({ preventScroll: true });
        }
      }, true);
      tryOn.dataset.focusKey = 'outfit-try-' + entry.id; tryOn.setAttribute('aria-label', entry.name + 'を試着'); row.appendChild(tryOn);
      if (!has) {
        var buy = button('買う', function () { run({ type: 'buyItem', itemId: entry.id }, entry.name + 'を購入しました。着るときは「着る」を選んでね。'); }, false, s.coins < entry.price);
        buy.dataset.focusKey = 'outfit-buy-' + entry.id; buy.setAttribute('aria-label', entry.name + 'を買う・' + number(entry.price) + 'コイン'); row.appendChild(buy);
      } else {
        var wear = button(wearing ? '着用中' : '着る', function () { run({ type: 'equipClothing', itemId: entry.id }, entry.name + 'に着替えました。'); }, true, wearing);
        wear.dataset.focusKey = 'outfit-wear-' + entry.id; wear.setAttribute('aria-label', entry.name + (wearing ? 'を着用中' : 'を着る')); row.appendChild(wear);
      }
      grid.appendChild(row);
    });
    section.appendChild(grid); body.appendChild(section);
  }
  function renderShop(s, body) {
    renderClothesShop(s, body);
    var c = card('お店ともちもの');
    append(c, text('おにぎりキャッチや毎日の育成で集めたコインを使えます。食べものは、もちものから使うとEXPになります。'));
    var grid = node('div', 'ipg-shop-grid');
    items().filter(function (x) { return x.type !== 'clothing'; }).forEach(function (x) {
      var count = owned(s, x), row = node('article', 'ipg-shop-item');
      append(row, node('span', 'ipg-item-icon', x.emoji || '🌿'), node('h4', '', x.name),
        text(x.type === 'food' ? '+' + number(x.exp) + 'EXP · 所持' + number(count) + '個' : count ? '持っています' : '未所持'),
        text(number(x.price) + 'コイン', 'ipg-stage'));
      var foodHint = x.type === 'food' && displaySpecies(s) === 'lilac' && evolution(s) ? foodEvolutionHint(x.id) : '';
      if (foodHint) row.appendChild(text(foodHint, 'ipg-food-evolution-hint ipg-small'));
      if (x.type === 'food' || !count) row.appendChild(button('買う', function () {
        run({ type: 'buyItem', itemId: x.id }, x.name + 'を購入しました。');
      }, false, s.coins < x.price));
      if (count) row.appendChild(button(x.type === 'food' ? '使う' : 'かざる', function () {
        run({ type: x.type === 'food' ? 'useItem' : 'equip', itemId: x.id }, x.type === 'food' ? 'アイテムを使いました。' : 'かざりを保存しました。');
      }, true));
      grid.appendChild(row);
    });
    c.appendChild(grid);
    if (s.decorations.equipped) c.appendChild(button('身につけているかざりを外す', function () {
      run({ type: 'equip', itemId: null }, 'かざりを外しました。');
    }, true));
    body.appendChild(c);
  }
  function renderMarket(s, body) {
    var market = s.market, stocks = core().STOCKS || core().stocks || [], invested = 0, cost = 0;
    stocks.forEach(function (x) { var h = market.holdings[x.id] || {}; invested += (h.quantity || 0) * market.prices[x.id]; cost += h.costBasis || 0; });
    var intro = card('コインで学ぶ、仮想マーケット');
    append(intro, text('登場する会社・株価はすべて架空です。現実のお金は使いません。ゲーム内の時間で価格が動きます。'),
      node('div', 'ipg-game-day', 'ゲーム内 ' + number(market.day) + '日目'));
    var stats = node('dl', 'ipg-metrics');
    append(stats, metric('手持ちコイン', number(s.coins)), metric('株の評価額', number(invested)),
      metric('合計', number(s.coins + invested)), metric('保有株の原価', number(cost)),
      metric('評価損益', signed(invested - cost)), metric('確定した売買損益', signed(market.realizedProfit)),
      metric('受取配当 累計', number(market.dividends)), metric('支払手数料 累計', number(market.feesPaid)));
    intro.appendChild(stats);
    var cap = limits().marketAdvancesPerDay || 12, interval = limits().dividendEvery || 5;
    append(intro, button('ゲーム内の時間を1日進める', function () {
      run({ type: 'advanceMarketDay' }, 'ゲーム内の1日を進めました。');
    }), text('現実の1日に最大' + cap + '回。' + interval + 'ゲーム日ごとに、保有株に応じた配当判定があります。'),
      text('取引をしなくてもペットは育ちます。売るまでは評価損益、売って決まった分が確定損益です。'));
    body.appendChild(intro);
    var list = node('div', 'ipg-stock-list');
    stocks.forEach(function (x) {
      var h = market.holdings[x.id] || { quantity: 0, costBasis: 0 };
      var price = market.prices[x.id], previous = market.previous[x.id];
      var c = card('', 'ipg-stock');
      append(c, node('h3', '', (x.emoji || '🌱') + ' ' + x.name), text('架空の会社', 'ipg-small'),
        node('div', 'ipg-stock-price', number(price) + ' コイン / 株'),
        text('前回比 ' + signed(price - (previous == null ? price : previous)) + 'コイン'),
        text('保有 ' + number(h.quantity) + '株 · 原価 ' + number(h.costBasis) +
          ' · 評価 ' + number(h.quantity * price) + ' · 評価損益 ' + signed(h.quantity * price - h.costBasis)));
      var qty = node('input'); qty.type = 'number'; qty.min = '1'; qty.max = '1000000'; qty.step = '1';
      qty.inputMode = 'numeric'; qty.value = quantities[x.id] || '1';
      qty.addEventListener('input', function () { quantities[x.id] = qty.value; });
      var trade = node('div', 'ipg-trade');
      append(trade, label('株数', qty));
      function transact(type) {
        var n = Number(qty.value);
        if (!Number.isSafeInteger(n) || n < 1) { failure = '株数は1以上の整数で入力してください。'; render(); return; }
        run({ type: type, stockId: x.id, quantity: n }, type === 'buyStock' ? '購入を保存しました。' : '売却を保存しました。');
      }
      append(trade, button('買う', function () { transact('buyStock'); }),
        button('売る', function () { transact('sellStock'); }, true, !h.quantity));
      append(c, trade, text('売買には手数料' + number((limits().feeRate || 0) * 100) +
        '%（最低' + number(limits().minFee || 0) + 'コイン）がかかります。', 'ipg-small'));
      list.appendChild(c);
    });
    body.appendChild(list);
    if (market.legacyPot) {
      var reserve = card('旧ゲームの積立分');
      append(reserve, text('旧積立の記録：残高 ' + number(market.legacyPot.value) +
        'コイン / 元本 ' + number(market.legacyPot.basis) + 'コイン / ' + number(market.legacyPot.days) + 'ゲーム日。'));
      if (market.legacyPot.value > 0) append(reserve,
        text('手持ちコインへ引き出せます。旧積立の元データは保持され、同じ残高を重複して引き出すことはありません。'),
        button('旧積立を手持ちコインへ引き出す', function () {
          run({ type: 'withdrawLegacyPot' }, '旧積立の引出しを保存しました。');
        }, true));
      else reserve.appendChild(text('引出し済みの記録を保持しています。'));
      body.appendChild(reserve);
    }
  }
  function renderLegacy(s, body) {
    var legacy = s.legacyReserve;
    if (!legacy || !legacy.available || legacy.transferred) return;
    var c = card('旧ゲームの記録を引き継ぐ');
    if (legacy.name) c.appendChild(text('旧ゲームのなまえ：' + legacy.name));
    append(c, text('旧ゲームのコイン・EXP・アイテム・かざり・保有株を、一度だけこのゲームへ移せます。旧ゲームの保存記録はそのまま残ります。'),
      text('旧価格はゲーム内の整数コイン価格へ変換します。原額はバックアップに保持します。'),
      text('引継ぎ候補：' + number(legacy.coins) + 'コイン / ' + number(legacy.exp) + 'EXP。旧積立分は別の記録として保持します。'),
      button('旧ゲームの記録を一度だけ引き継ぐ', function () {
        run({ type: 'transferLegacy' }, '旧ゲームの引継ぎを保存しました。');
      }, true));
    body.appendChild(c);
  }
  function renderPreserved(s, body) {
    var names = {pet50:'なでなでマスター',feed20:'まんぷくしょくどう',mg15:'おにぎりハンター',deco3:'おにわデビュー',
      deco7:'まちづくりめいじん',final:'でんせつのきずな',rich:'こつこつちょきん',letter:'朝レター（旧実績）',
      first_trade:'はじめての売買',first_profit:'はじめての売買益',dividend:'配当を受け取った',all_six:'6社の株を保有'};
    var details = node('details', 'ipg-card ipg-preserved');
    details.appendChild(node('summary', '', '実績と引き継いだもちもの'));
    var achievements = node('ul', 'ipg-preserved-list');
    (s.achievements || []).forEach(function (id) {
      achievements.appendChild(node('li', '', names[id] || '旧実績：' + String(id).slice(0, 60)));
    });
    if (achievements.children.length) append(details, node('h4', '', '獲得済み実績'), achievements);
    else details.appendChild(text('実績は、これからのお世話やゲームで少しずつ集まります。'));
    var extras = node('ul', 'ipg-preserved-list');
    Object.keys(s.inventory).forEach(function (id) {
      if (!item(id)) extras.appendChild(node('li', '', '旧アイテム ' + String(id).slice(0, 60) + ' ×' + number(s.inventory[id])));
    });
    Object.keys(s.decorations.owned).forEach(function (id) {
      if (item(id)) return;
      var row = node('li', '', '旧かざり ' + String(id).slice(0, 60) + ' ');
      row.appendChild(button('身につける', function () {
        run({ type: 'equip', itemId: id }, '旧かざりを身につけました。');
      }, true));
      extras.appendChild(row);
    });
    if (extras.children.length) append(details,
      text('今のお店にない旧アイテムも、記録として保持しています。'), extras);
    if (s.legacyReserve && s.legacyReserve.transferred) details.appendChild(text(
      '別の旧ゲームから引継ぎ済み：' + number(s.legacyReserve.coins) + 'コイン / ' + number(s.legacyReserve.exp) + 'EXP。'));
    if (s.legacyReserve && s.legacyReserve.name) details.appendChild(text('別の旧ゲームのなまえ：' + s.legacyReserve.name));
    if (s.pet.pixel) details.appendChild(text('以前のドット絵の設定も記録に保持しています。'));
    body.appendChild(details);
  }
  function renderBackup(body) {
    var details = node('details', 'ipg-card ipg-backup');
    details.appendChild(node('summary', '', 'ゲームのバックアップ'));
    append(details, text('この端末のゲームをバックアップできます。復元すると、現在の独立ゲームの記録がバックアップの内容に置き換わります。'));
    var out = node('div');
    function showBackup() {
      try {
        var result = store.exportBackup();
        backupText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        out.replaceChildren();
        var area = node('textarea'); area.readOnly = true; area.value = backupText; area.rows = 5;
        area.setAttribute('aria-label', 'バックアップの内容');
        append(out, area, button('ファイルとして保存', function () {
          var url = w.URL.createObjectURL(new Blob([backupText], { type: 'application/json' }));
          var a = node('a'); a.href = url; a.download = 'pet-game-backup.json';
          d.body.appendChild(a); a.click(); a.remove(); w.setTimeout(function () { w.URL.revokeObjectURL(url); }, 1000);
        }, true));
      } catch (_) { failure = 'バックアップを作成できませんでした。'; render(); }
    }
    details.appendChild(button('バックアップを表示', showBackup, true));
    details.appendChild(out);
    var form = node('form', 'ipg-form');
    var file = node('input'); file.type = 'file'; file.accept = '.json,application/json';
    var area = node('textarea'); area.rows = 4; area.value = importText;
    area.addEventListener('input', function () { importText = area.value; });
    file.addEventListener('change', async function () {
      var f = file.files && file.files[0];
      if (!f) return;
      if (f.size > 1000000) { failure = 'バックアップは1MB以下のファイルを選んでください。'; render(); return; }
      try { importText = await f.text(); area.value = importText; }
      catch (_) { failure = 'ファイルを読み込めませんでした。'; render(); }
    });
    var submit = node('button', 'ipg-button ipg-secondary', 'バックアップから復元');
    submit.type = 'submit';
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (busy || !area.value.trim()) return;
      if (!w.confirm('現在のゲームを、このバックアップの内容で復元しますか？')) return;
      setBusy(true);
      try {
        var result = await store.importBackup(area.value);
        if (result && result.ok) { importText = ''; nameDraft = null; pendingFinish = null; notice = 'バックアップから復元しました。'; failure = ''; }
        else { failure = safeError(result); notice = ''; }
      } catch (_) { failure = '復元を確認できませんでした。現在の記録を保持しています。'; notice = ''; }
      finally { setBusy(false); render(); }
    });
    append(form, label('バックアップファイル', file), label('またはバックアップの内容を貼り付ける', area), submit);
    details.appendChild(form); body.appendChild(details);
  }
  function render() {
    if (!host || !store || game && host.querySelector('.ipg-catch-board')) return;
    stopMotions();
    var focused = d.activeElement && d.activeElement.dataset && d.activeElement.dataset.focusKey;
    var s = state(), root = node('div', 'ipg');
    renderedDay = currentDay();
    var head = node('header', 'ipg-header');
    if (tab !== 'care' && !game && displaySpecies(s) === 'lilac') head.appendChild(petVisual(s, 'ipg-lilac-compact'));
    append(head, append(node('div'), node('p', 'ipg-eyebrow', '小さな毎日を、いっしょに。'), node('h2', '', 'そだてる')),
      node('div', 'ipg-wallet', number(s.coins) + ' コイン'));
    root.appendChild(head);
    var status = node('p', 'ipg-notice' + (failure ? ' ipg-error' : ''), failure || notice || 'おかえりなさい。今日は何をして過ごそう？');
    status.setAttribute('role', failure ? 'alert' : 'status'); status.setAttribute('aria-live', failure ? 'assertive' : 'polite');
    root.appendChild(status);
    if (s.error && !failure) root.appendChild(text(s.error.message || '記録の読み込みに確認が必要です。', 'ipg-error'));
    var nav = node('nav', 'ipg-tabs'); nav.setAttribute('aria-label', '育成ゲーム');
    Object.keys(tabLabels).forEach(function (key) {
      var b = button(tabLabels[key], async function () {
        if (busy) return;
        if (game) await cancelGame('ゲームを中止しました。この回の報酬はありません。');
        tab = key; if (key !== 'shop') { fittingOpen = false; fittingOutfit = null; } render();
      }, true);
      b.className += tab === key ? ' is-active' : '';
      b.setAttribute('aria-current', tab === key ? 'page' : 'false');
      b.dataset.focusKey = 'tab-' + key;
      nav.appendChild(b);
    });
    root.appendChild(nav);
    var body = node('div', 'ipg-body');
    if (tab === 'care') renderCare(s, body);
    else if (tab === 'play') renderPlay(s, body);
    else if (tab === 'shop') renderShop(s, body);
    else renderMarket(s, body);
    if (!game) { renderLegacy(s, body); renderPreserved(s, body); renderBackup(body); }
    root.appendChild(body);
    host.replaceChildren(root);
    startMotions();
    setBusy(busy);
    if (game) { var board = host.querySelector('.ipg-catch-board'); if (board) board.focus({ preventScroll: true }); }
    if (focused && !game) {
      var n = host.querySelector('[data-focus-key="' + focused + '"]');
      if (n && !n.disabled) n.focus({ preventScroll: true });
    }
  }
  function loading(message, retry) {
    if (!host) return;
    stopMotions();
    var c = card('そだてる');
    append(c, text(message));
    if (retry) c.appendChild(button('もう一度読み込む', function () { mount(host, options); }));
    host.replaceChildren(append(node('div', 'ipg'), c));
  }
  async function mount(target, opts) {
    if (typeof target === 'string') target = d.getElementById(target);
    if (!target) return false;
    suspended = false;
    if (host === target && store) { render(); return true; }
    if (mounting) return mounting;
    if (game) await cancelGame();
    host = target; options = opts || options || {};
    loading('ゲームの記録を読み込んでいます…');
    mounting = (async function () {
      await Promise.resolve();
      try {
        if (!core() || typeof core().create !== 'function') throw new Error('core_unavailable');
        if (w.__knGateReady) await w.__knGateReady;
        var config = Object.assign({}, options);
        if (!config.storage) {
          if (w.__knGateReady) throw new Error('protected_storage_adapter_required');
          config.storage = w.localStorage;
        }
        var candidate = core().create(config);
        var readyResult = await candidate.ready;
        if (readyResult && readyResult.ok === false) throw new Error('storage_read_failed');
        store = candidate;
        if (unsubscribe) unsubscribe();
        unsubscribe = store.subscribe(function () { if (!busy && !game) render(); });
        failure = ''; render(); return true;
      } catch (_) {
        store = null; loading('ゲームの記録を読み込めませんでした。保存先を確認して、もう一度お試しください。', true);
        return false;
      } finally { mounting = null; }
    })();
    return mounting;
  }
  function suspend() {
    suspended = true; lifecycleEpoch++;
    stopMotions(); reaction = null; greeted = false; appearancePreview = false; growthAlbumOpen = false; growthPreviewStage = null; growthPreviewPath = null; fittingOpen = false; fittingOutfit = null;
    return cancelGame('画面を離れたためゲームを中止しました。');
  }
  d.addEventListener('visibilitychange', function () {
    if (d.hidden) suspend();
    else { suspended = false; if (store && !game && !busy) render(); }
  });
  w.addEventListener('pagehide', suspend);
  w.addEventListener('pageshow', function () { suspended = false; if (store && !game && !busy) render(); });
  w.addEventListener('focus', function () { if (store && !game && !busy) render(); });
  w.setInterval(function () { if (store && !game && !busy && renderedDay !== currentDay()) render(); }, 60000);
  w.IndependentPetGame = {
    mount: mount,
    open: function () { return mount(host || d.getElementById('pet-game-root'), options); },
    render: render,
    close: suspend,
    suspend: suspend
  };
})(window, document);

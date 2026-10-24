/* Independent pet game: UI only. State changes belong to PetGameCore. */
(function (w, d) {
  'use strict';
  var host = null, store = null, options = null, mounting = null, unsubscribe = null;
  var tab = 'care', busy = false;
  var notice = '', failure = '', nameDraft = null, quantities = {};
  var lifecycleEpoch = 0, suspended = false, renderedDay = '', roomCarryX = 0;
  var motionControllers = [], motionRequests = [], reaction = null, greeted = false;
  var appearancePreview = false, previewSituation = 'idle', previewStartedAt = 0;
  var emotionBrowse = { pet: { group: 'bright', query: '', page: 0 }, preview: { group: 'bright', query: '', page: 0 }, growth: { group: 'bright', query: '', page: 0 } };
  var bodyDrawerOpen = { pet: false, preview: false, growth: false };
  var directionDrawerOpen = { pet: false, preview: false, growth: false };
  var emotionCacheKey, emotionCacheRows;
  var growthAlbumOpen = false, growthPreviewStage = null, growthPreviewPath = null, growthEmotionOpen = false;
  var fittingOpen = false, fittingOutfit = null;
  var eggDraft = null, eggConfirm = false;
  var roomEdit = null, roomSurfaceCleanup = null, roomSurfaceGeneration = 0, roomSaveAttempt = null;
  var cozyPending = null;
  var villageEdit = null, villageSaveAttempt = null;
  // Walking is a view of the existing pet, not a second pet or a save action.
  // Retain the spot when visiting a facility; never write a frame into the store.
  var townController = null, townEconomyScene = null, townPending = null, townPosition = null;
  var villageListingDraft = null, villageTradeDrafts = {}, villageActionAttempt = null, villageRefreshTimer = null;
  var imageRoot = '/static/';
  var stageLabels = { egg: 'たまご', baby: 'あかちゃん', child: 'こども', final: 'さいしゅうしんか' };
  var tabLabels = { village: '村', care: 'そだてる', shop: 'お店・もちもの', market: '仮想マーケット' };

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
  // Only an explicit developer harness may mount the motion inspection UI.
  // No URL, saved preference or production loader enables it.
  function developerPreview() { return !!options && options.developerPreview === true; }
  function displaySpecies(s) { return s.pet.species === 'dragon' ? 'lilac' : s.pet.species; }
  function core() { return w.PetGameCore; }
  function needsEggChoice(s) { return typeof core().needsEggChoice === 'function' && core().needsEggChoice(s); }
  function eggOrigin(s) { return typeof core().getEggOrigin === 'function' ? core().getEggOrigin(s) : 'lilac'; }
  function eggProfile(key) {
    return typeof core().eggProfile === 'function' ? core().eggProfile(key) : { key: 'lilac', eggLabel: 'すみれのたまご', characterName: 'ふわり', colorName: '薄紫', color: '#b5a0d9', description: 'ふわっとした耳と、ふっくらしたほっぺのこ。' };
  }
  function chosenEgg(s) { return s.pet && Object.prototype.hasOwnProperty.call(s.pet, 'eggOrigin') && s.pet.eggOrigin !== null; }
  function eggIcon(profile) {
    var icon = node('span', 'ipg-egg-icon ipg-egg-icon-' + profile.key);
    icon.style.color = profile.color; icon.setAttribute('aria-hidden', 'true');
    return icon;
  }
  function renderEggChoice(s, body) {
    var box = card('', 'ipg-egg-welcome'), rows = Array.isArray(core().eggCatalogue) ? core().eggCatalogue : [];
    append(box, node('p', 'ipg-eyebrow', 'はじめての出会い'), node('h3', '', eggConfirm ? 'このたまごと、暮らそうか。' : 'いっしょに暮らすたまごを選ぼう'),
      text('たまごによって、うまれてくるこの色や耳、体つきが変わります。お世話を重ねて、少しずつ育てていこう。'));
    var selected = rows.filter(function (row) { return row.key === eggDraft; })[0];
    if (eggConfirm && selected) {
      var review = node('div', 'ipg-egg-review');
      append(review, eggIcon(selected), node('h4', '', selected.eggLabel), text(selected.characterName + ' · ' + selected.colorName, 'ipg-egg-character'), text(selected.description));
      box.appendChild(review);
      box.appendChild(text('迎えたあとは、このたまごを選び直せません。色や個性を大切に育てていこう。', 'ipg-small'));
      var actions = node('div', 'ipg-egg-actions');
      var back = button('選び直す', function () { if (busy) return; eggConfirm = false; render(); var focus = host.querySelector('[data-focus-key="egg-choice-' + eggDraft + '"]'); if (focus) focus.focus({ preventScroll: true }); }, true, s.readOnly);
      back.dataset.focusKey = 'egg-back';
      var confirm = button('このたまごと暮らす', async function () {
        if (busy) return;
        tab = 'care';
        var result = await run({ type: 'chooseEgg', eggOrigin: selected.key }, 'たまごをおへやへ迎えました。');
        if (result && result.ok) { var heading = host.querySelector('.ipg-pet-name'); if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); } }
      }, false, s.readOnly);
      confirm.dataset.focusKey = 'egg-confirm'; append(actions, back, confirm); box.appendChild(actions);
    } else {
      eggConfirm = false;
      var choices = node('div', 'ipg-egg-choices'); choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', 'はじめてのたまご');
      rows.forEach(function (row) {
        var choice = button('', function () { if (busy) return; eggDraft = row.key; render(); }, true, s.readOnly);
        choice.className += ' ipg-egg-choice' + (selected && selected.key === row.key ? ' is-selected' : '');
        choice.dataset.focusKey = 'egg-choice-' + row.key; choice.dataset.eggOrigin = row.key;
        choice.setAttribute('aria-pressed', String(!!selected && selected.key === row.key));
        var words = node('span', 'ipg-egg-choice-words');
        append(words, node('strong', '', row.eggLabel), node('span', 'ipg-egg-character', row.characterName + ' · ' + row.colorName), node('small', '', row.description),
          node('span', 'ipg-egg-selected', selected && selected.key === row.key ? '✓ 選択中' : 'このたまごを見る'));
        append(choice, eggIcon(row), words); choices.appendChild(choice);
      });
      box.appendChild(choices);
      var next = button('このたまごを見てみる', function () { if (busy || !eggDraft) return; eggConfirm = true; render(); var focus = host.querySelector('[data-focus-key="egg-confirm"]'); if (focus) focus.focus({ preventScroll: true }); }, false, !selected || s.readOnly);
      next.dataset.focusKey = 'egg-review'; box.appendChild(next);
      box.appendChild(text('選ぶだけでは、まだお世話やコインの記録は変わりません。', 'ipg-small'));
    }
    body.appendChild(box);
  }
  function items() { return core().items || core().catalogue || core().ITEMS || []; }
  function item(id) { return items().filter(function (x) { return x.id === id; })[0]; }
  function itemName(id) { var x = item(id); return x ? x.name : 'アイテム'; }
  // Artwork is a fixed presentation map, never a saved inventory field or an arbitrary URL.
  var itemArtworkSources = Object.freeze({
    apple: 'pet-items-v1/apple.webp', cake: 'pet-items-v1/cake.webp', berry: 'pet-items-v1/berry.webp',
    rice: 'pet-items-v1/rice.webp', feast: 'pet-items-v1/feast.webp', house: 'pet-items-v1/house.webp',
    tree: 'pet-items-v1/tree.webp', flower: 'pet-items-v1/flower.webp', fountain: 'pet-items-v1/fountain.webp',
    sunflower: 'pet-items-v1/sunflower.webp', mushroom: 'pet-items-v1/mushroom.webp', lantern: 'pet-items-v1/lantern.webp',
    cloth_cream_vest: 'pet-clothes-v1/cloth_cream_vest.webp', cloth_rose_cape: 'pet-clothes-v1/cloth_rose_cape.webp',
    cloth_sky_overalls: 'pet-clothes-v1/cloth_sky_overalls.webp', cloth_mint_knit: 'pet-clothes-v1/cloth_mint_knit.webp',
    cloth_star_pajamas: 'pet-clothes-v1/cloth_star_pajamas.webp', cloth_flower_dress: 'pet-clothes-v1/cloth_flower_dress.webp'
  });
  var stockArtworkSources = Object.freeze({
    apl: 'pet-items-v1/apple.webp', rkt: 'pet-market-v1/rocket.webp', grn: 'pet-items-v1/tree.webp',
    gam: 'pet-market-v1/controller.webp', bnk: 'pet-market-v1/bank.webp', fud: 'pet-items-v1/feast.webp'
  });
  function hasItemArtwork(id) { return typeof id === 'string' && Object.prototype.hasOwnProperty.call(itemArtworkSources, id); }
  function foodArtworkId(id) { var entry = item(id); return entry && entry.type === 'food' && hasItemArtwork(id) ? id : null; }
  function itemArtwork(id, extra, onState) {
    return catalogueArtwork(id, itemArtworkSources, 'itemArt', extra, onState);
  }
  function stockArtwork(id) { return catalogueArtwork(id, stockArtworkSources, 'stockArt', 'ipg-stock-art'); }
  function catalogueArtwork(id, sources, dataKey, extra, onState) {
    var available = typeof id === 'string' && Object.prototype.hasOwnProperty.call(sources, id);
    var shell = node('span', 'ipg-item-art' + (extra ? ' ' + extra : ''));
    shell.setAttribute('aria-hidden', 'true'); shell.dataset[dataKey] = available ? id : ''; shell.dataset.artReady = 'false'; shell.dataset.artState = 'loading';
    // A quiet, fixed-size placeholder never substitutes the platform's emoji.
    // Product names, prices and ownership remain available beside the artwork.
    var placeholder = node('span', 'ipg-item-art-placeholder'); shell.appendChild(placeholder);
    if (!available) { shell.dataset.artState = 'unavailable'; return shell; }
    var image = node('img', 'ipg-item-art-image'); image.width = image.height = 384;
    image.alt = ''; image.draggable = false; image.decoding = 'async'; image.hidden = true; image.setAttribute('aria-hidden', 'true');
    function ready(value) {
      shell.dataset.artReady = String(value); shell.dataset.artState = value ? 'ready' : 'error'; image.hidden = !value; placeholder.hidden = value;
      if (onState) onState(value);
    }
    image.addEventListener('load', function () { ready(true); });
    image.addEventListener('error', function () { ready(false); });
    shell.appendChild(image); image.src = imageRoot + sources[id];
    return shell;
  }
  function shopItemArtwork(entry) {
    var scenes = { bg_meadow: 'meadow', bg_beach: 'beach', bg_snow: 'snow', bg_room: 'room' };
    if (Object.prototype.hasOwnProperty.call(scenes, entry.id)) {
      var scene = node('span', 'ipg-background-swatch ipg-swatch-' + scenes[entry.id]); scene.setAttribute('aria-hidden', 'true');
      return scene;
    }
    return itemArtwork(entry.id, 'ipg-item-icon');
  }
  function setMealArtwork(food, id) {
    id = foodArtworkId(id) || '';
    if (food.dataset.foodId === id) return;
    food.dataset.foodId = id; food.dataset.artReady = 'false'; food.replaceChildren();
    if (id) {
      var art = itemArtwork(id, 'ipg-food-art', function (ready) {
        if (food.dataset.foodId === id && art && art.parentNode === food) food.dataset.artReady = String(ready);
      });
      food.appendChild(art);
    }
  }
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
  function evolutionLook(s, row) {
    if (!row) return null;
    var origin = eggOrigin(s) || 'lilac', engine = w.PetLilacMotion;
    if (origin !== 'lilac' && engine && typeof engine.eggVisualProfile === 'function') return engine.eggVisualProfile(row.key, origin);
    if (origin !== 'lilac') { var born = eggProfile(origin); return { color: born.color, colorName: row.key === 'balanced' ? born.colorName : born.colorName + 'を基調に' + row.colorName + '寄り' }; }
    return row;
  }
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
    motionRequests.forEach(refreshRoomTouch);
  }
  function stopMotions() {
    if (townController) { townController.destroy(); townController = null; }
    if (townEconomyScene) { townEconomyScene.dispose(); townEconomyScene = null; }
    townPending = null;
    if (villageRefreshTimer != null) w.clearTimeout(villageRefreshTimer);
    villageRefreshTimer = null;
    motionRequests.forEach(function (request) {
      (request.touchRemovers || []).forEach(function (remove) { remove(); });
      request.touchRemovers = []; request.touchCue = null; request.touchPointer = null;
      request.wrap.dataset.touchPart = ''; request.wrap.dataset.touchSide = '';
      if (request.roomBehavior) request.roomBehavior.destroy();
      request.roomBehavior = null; request.roomCue = null;
      if (request.cueTimer != null) w.clearTimeout(request.cueTimer);
      request.cueTimer = null;
      if (request.revealFrame != null) w.cancelAnimationFrame(request.revealFrame);
      request.revealFrame = null;
      if (request.effect) { request.effect.hidden = true; request.effect.replaceChildren(); }
      if (request.food) request.food.hidden = true;
      request.wrap.dataset.cuePhase = 'idle';
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
    if (cue) {
      reaction = { situation: cue.situation, durationMs: cue.durationMs, startedAt: Date.now() };
      if (cue.situation === 'feeding') reaction.foodId = action.type === 'useItem' ? foodArtworkId(action.itemId) || 'apple' : 'apple';
    }
  }
  function currentReaction() {
    if (reaction && Date.now() - reaction.startedAt >= reaction.durationMs) reaction = null;
    return reaction;
  }
  function eggStillRect(cell) {
    // Measured padded rectangles in the fixed 1254px egg sheet. Hatching's lid
    // extends beyond its nominal cell, stopping before the spare egg at x722.
    var pixels = [[116, 82, 536, 591], [720, 82, 1140, 591], [99, 648, 721, 1189]];
    return (pixels[cell] || pixels[0]).map(function (value) { return value / 1254; });
  }
  function appearanceProfile(key) {
    var engine = w.PetLilacMotion;
    if (engine && typeof engine.appearanceProfile === 'function') return engine.appearanceProfile(key);
    var eggs = ['egg', 'egg_cracked', 'hatching'], babies = ['newborn', 'baby', 'toddler', 'child', 'juvenile', 'grown', 'adult', 'companion'];
    return eggs.indexOf(key) >= 0 ? { family: 'egg', stillBaseAsset: 'pet_lilac_egg_stages_v1.png', stillAsset: 'pet_lilac_tooth_egg_stages_v1.png', stillCell: eggs.indexOf(key), stillRect: eggStillRect(eggs.indexOf(key)), overallScale: [.64, .64, .67][eggs.indexOf(key)] } :
      babies.indexOf(key) >= 0 ? { family: 'baby', stillBaseAsset: 'pet_lilac_reference_v2.png', stillAsset: 'pet_lilac_reference_v2.png', stillMouthMask: { x: .58051, y: .54, rx: .085, ry: .057, floor: .505 }, stillCell: null, overallScale: [.62, .72, .81, .90, .96, 1, 1.04, 1.07][babies.indexOf(key)] } : { family: 'mature', stillBaseAsset: 'pet_lilac_cutout.webp', stillAsset: 'pet_lilac_tooth_original_v1.png', stillCell: null };
  }
  function stillMouthPatch(profile) {
    if (profile.family === 'egg' && profile.stillCell !== 2) return null;
    var defaults = profile.family === 'egg' ? [.295, .705, .045, .030, .697] :
      profile.family === 'baby' ? [.58051, .54, .085, .057, .505] : [.628, .511, .100, .067, .455];
    var mask = profile.stillMouthMask;
    if (!mask || ![mask.x, mask.y, mask.rx, mask.ry, mask.floor].every(Number.isFinite)) mask = { x: defaults[0], y: defaults[1], rx: defaults[2], ry: defaults[3], floor: defaults[4] };
    var patch = node('img', 'ipg-lilac-mouth-patch');
    patch.src = imageRoot + (profile.stillAsset || (profile.family === 'egg' ? 'pet_lilac_tooth_egg_stages_v1.png' : profile.family === 'baby' ? 'pet_lilac_reference_v2.png' : 'pet_lilac_tooth_original_v1.png'));
    patch.alt = ''; patch.draggable = false; patch.setAttribute('aria-hidden', 'true');
    var gradient = 'radial-gradient(ellipse ' + mask.rx * 100 + '% ' + mask.ry * 100 + '% at ' + mask.x * 100 + '% ' + mask.y * 100 + '%,#000 62%,transparent 100%)';
    patch.style.maskImage = gradient; patch.style.webkitMaskImage = gradient;
    if (Number.isFinite(mask.floor)) patch.style.clipPath = 'inset(' + mask.floor * 100 + '% 0 0 0)';
    return patch;
  }
  function petVisual(s, extraClass, preview, fittingOverride, evolutionOverride) {
    if (displaySpecies(s) !== 'lilac') {
      var old = node('img', extraClass || 'ipg-pet-image');
      old.src = petImage(s); old.alt = (s.pet.name || 'ペット') + '（' + stage(s).label + '）';
      old.width = 240; old.height = 240; old.draggable = false;
      return old;
    }
    var appearance = stage(s), growthStage = canonicalStage(s).key, profile = appearanceProfile(appearance.key);
    var origin = eggOrigin(s) || 'lilac', originRow = eggProfile(origin), originPlaceholder = origin !== 'lilac';
    var pathRow = evolutionRow(preview && evolutionOverride ? evolutionOverride : evolutionPath(s));
    var path = pathRow ? pathRow.key : 'balanced';
    var dress = preview === 'fitting' ? fittingOverride : outfit(s);
    var dressItem = item(dress); dress = dressItem && dressItem.type === 'clothing' ? dressItem.id : null;
    var wrap = node('div', 'ipg-lilac-visual ipg-lilac-stage-' + growthStage + (extraClass ? ' ' + extraClass : ''));
    wrap.dataset.cuePhase = 'idle'; wrap.dataset.growthStage = growthStage; wrap.dataset.appearanceKey = appearance.key; wrap.dataset.evolutionPath = path; wrap.dataset.outfit = dress || 'none';
    wrap.dataset.eggOrigin = origin;
    var still = node('div', 'ipg-lilac-still' + (profile.family === 'egg' ? ' ipg-egg-still' : ' ipg-tooth-still'));
    var stillAsset = profile.stillBaseAsset || (profile.family === 'egg' ? 'pet_lilac_egg_stages_v1.png' : profile.family === 'baby' ? 'pet_lilac_reference_v2.png' : 'pet_lilac_cutout.webp');
    still.alt = (s.pet.name || (origin === 'lilac' ? '薄紫のこ' : originRow.characterName)) + '（' + appearance.label + '）';
    still.setAttribute('role', 'img'); still.setAttribute('aria-label', still.alt);
    if (originPlaceholder) {
      still.className += ' ipg-origin-placeholder'; still.setAttribute('role', 'group');
      still.setAttribute('aria-label', originRow.eggLabel + 'のこ');
      var originNote = text('この子の姿を準備しています…', 'ipg-origin-placeholder-note');
      var retry = button('もう一度表示する', function () { if (!busy) render(); }, true); retry.hidden = true;
      retry.dataset.focusKey = 'pet-appearance-retry';
      append(still, eggIcon(originRow), node('strong', '', originRow.eggLabel), originNote, retry);
    } else if (profile.family === 'egg') {
      still.setAttribute('role', 'img'); still.setAttribute('aria-label', still.alt); still.dataset.eggCell = String(profile.stillCell);
      var rect = profile.stillRect;
      if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite) || rect[0] < 0 || rect[1] < 0 || rect[2] > 1 || rect[3] > 1 || rect[2] <= rect[0] || rect[3] <= rect[1]) rect = eggStillRect(profile.stillCell);
      var crop = node('span', 'ipg-egg-crop'), cropWidth = rect[2] - rect[0], cropHeight = rect[3] - rect[1], longest = Math.max(cropWidth, cropHeight);
      still.dataset.sourceRect = rect.join(',');
      crop.style.width = String(cropWidth / longest * 100) + '%'; crop.style.height = String(cropHeight / longest * 100) + '%';
      crop.style.left = String((1 - cropWidth / longest) * 50) + '%'; crop.style.top = String((1 - cropHeight / longest) * 50) + '%';
      var sheet = node('img', 'ipg-egg-sheet'); sheet.src = imageRoot + stillAsset; sheet.alt = ''; sheet.draggable = false;
      sheet.setAttribute('aria-hidden', 'true'); sheet.style.width = String(100 / cropWidth) + '%'; sheet.style.height = String(100 / cropHeight) + '%';
      sheet.style.left = String(-rect[0] / cropWidth * 100) + '%'; sheet.style.top = String(-rect[1] / cropHeight * 100) + '%';
      crop.appendChild(sheet);
      var eggPatch = stillMouthPatch(profile);
      if (eggPatch) {
        eggPatch.className += ' ipg-egg-sheet';
        ['width', 'height', 'left', 'top'].forEach(function (key) { eggPatch.style[key] = sheet.style[key]; });
        crop.appendChild(eggPatch);
      }
      still.appendChild(crop);
    } else {
      var base = node('img', 'ipg-lilac-still-base'); base.src = imageRoot + stillAsset;
      base.alt = ''; base.draggable = false; base.setAttribute('aria-hidden', 'true');
      still.appendChild(base); still.appendChild(stillMouthPatch(profile));
    }
    if (!originPlaceholder && Number.isFinite(profile.overallScale)) { still.style.transform = 'scale(' + profile.overallScale + ')'; still.style.transformOrigin = '50% 92%'; }
    still.width = still.height = 300; still.draggable = false;
    var canvas = node('canvas', 'ipg-lilac-canvas');
    canvas.width = canvas.height = 512; canvas.hidden = true;
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', still.alt);
    append(wrap, still, canvas);
    var food = node('span', 'ipg-feeding-food'); food.hidden = true; food.setAttribute('aria-hidden', 'true');
    wrap.appendChild(food);
    var effect = node('div', 'ipg-emotion-effect'); effect.hidden = true; effect.setAttribute('aria-hidden', 'true');
    wrap.appendChild(effect);
    motionRequests.push({ canvas: canvas, still: still, wrap: wrap, food: food, effect: effect, preview: !!preview, growthPreview: preview === 'growth', fittingPreview: preview === 'fitting', localCue: null, growthStage: growthStage, appearanceKey: appearance.key, appearanceFamily: profile.family, eggOrigin: origin, originNote: originPlaceholder ? originNote : null, originRetry: originPlaceholder ? retry : null, evolutionPath: path, outfit: dress, visualAlt: still.alt + (pathRow ? '・' + pathRow.label + '・' + evolutionLook(s, pathRow).colorName : '') + (dress ? '・お洋服：' + itemName(dress) : ''), controller: null, cueTimer: null, revealFrame: null, ready: false, failed: false });
    return wrap;
  }
  function requestCue(request) {
    if (request.townCue) return request.townCue;
    if (request.growthPreview) {
      if (request.localCue && Date.now() - request.localCue.startedAt >= request.localCue.durationMs) request.localCue = null;
      return request.localCue;
    }
    if (request.fittingPreview) return null;
    if (request.preview) return previewCue();
    var savedCue = currentReaction();
    if (savedCue) return savedCue;
    if (request.touchCue && Date.now() - request.touchCue.startedAt >= request.touchCue.durationMs) request.touchCue = null;
    if (request.touchCue) return request.touchCue;
    if (request.roomCue && Date.now() - request.roomCue.startedAt >= request.roomCue.durationMs) request.roomCue = null;
    return request.roomCue || null;
  }
  function roomWalk(name) { return name === 'room_walk_left' || name === 'room_walk_right'; }
  function placeInRoom(request, pixels, settling) {
    if (!request.room) return;
    pixels = Number.isFinite(pixels) ? Math.max(-64, Math.min(64, pixels)) : 0;
    // Ready/phase callbacks may repeat in the same frame; keep a care interruption's return intact.
    if (!settling && pixels === 0 && request.roomPixelX === 0 && request.roomSettlingUntil > Date.now()) return;
    request.roomSettlingUntil = settling ? Date.now() + 400 : 0;
    if (settling && request.wrap.isConnected) { try { request.wrap.getBoundingClientRect(); } catch (_) {} }
    request.roomPixelX = pixels;
    request.wrap.style.transition = settling ? 'transform 400ms ease-out' : 'none';
    request.wrap.style.transform = 'translateX(calc(-50% + ' + pixels.toFixed(3) + 'px))';
  }
  function showRoomPose(request, frame) {
    if (!request.room || !frame || !request.ready || !request.canvas.isConnected || !motionsVisible()) return;
    var active = requestCue(request);
    if (!active || active.situation !== frame.situation || Date.now() - active.startedAt >= active.durationMs) return;
    if (Number.isFinite(frame.yawDeg)) {
      var yaw = ((frame.yawDeg % 360) + 360) % 360;
      request.wrap.dataset.facing = yaw >= 135 && yaw <= 225 ? 'back' : yaw > 45 && yaw < 135 ? 'right' : yaw > 225 && yaw < 315 ? 'left' : 'front';
    }
    if (roomWalk(frame.situation) && request.appearanceFamily !== 'egg' && Number.isFinite(frame.roomX)) {
      placeInRoom(request, Math.max(-1, Math.min(1, frame.roomX)) * request.roomWalkDistance, false);
      request.wrap.dataset.roomWalkPhase = typeof frame.phase === 'string' ? frame.phase : '';
    }
  }
  // Touch is a moment together, not a saved care action or a source of rewards.
  var touchReactions = {
    head: [
      ['petted', 'なでなで、うれしいな。'],
      ['love', 'だいすき。もっと、なでて。']
    ],
    cheek: [
      ['laugh', 'くすぐったいよ、えへへ！'],
      ['shy', 'ほっぺをつん。ちょっと、てれちゃう。']
    ],
    hand: [
      ['body_flap', 'おてて、ぎゅっ。うれしくて、ぱたぱた！'],
      ['cheer', 'いっしょに、ばんざい！']
    ]
  };
  function canTouch(request) {
    return !!request && !!request.room && !request.preview && request.appearanceFamily !== 'egg' &&
      request.ready && !request.failed && !!request.controller && !request.canvas.hidden &&
      request.canvas.isConnected && motionsVisible() && !busy && !currentReaction() &&
      !(request.touchCue && Date.now() - request.touchCue.startedAt < request.touchCue.durationMs);
  }
  function refreshRoomTouch(request) {
    if (!request.touchActions) return;
    var available = request.ready && !request.failed;
    request.touchActions.hidden = !available;
    request.touchHint.hidden = !available;
    request.touchActions.querySelectorAll('button').forEach(function (choice) {
      choice.disabled = !canTouch(request); choice.dataset.ipgDisabled = choice.disabled ? '1' : '';
    });
  }
  function touchPet(request, hit) {
    if (!canTouch(request) || !hit || !Object.prototype.hasOwnProperty.call(touchReactions, hit.part)) return;
    var entries = touchReactions[hit.part], counts = request.touchCounts || (request.touchCounts = {});
    var entry = entries[(counts[hit.part] || 0) % entries.length];
    var duration = w.PetLilacMotion && w.PetLilacMotion.durations[entry[0]];
    if (!Number.isFinite(duration) || duration <= 0) return;
    counts[hit.part] = (counts[hit.part] || 0) + 1;
    var cue = { situation: entry[0], durationMs: duration, startedAt: Date.now(), message: entry[1], activity: 'affection' };
    request.roomCue = null; request.touchCue = cue;
    request.wrap.dataset.touchPart = hit.part;
    request.wrap.dataset.touchSide = hit.side === 'left' || hit.side === 'right' ? hit.side : '';
    if (request.roomBehavior) request.roomBehavior.suspendFor(duration);
    try { request.controller.setSituation(cue.situation, { durationMs: duration }); updateMotionPresentation(request, cue); }
    catch (_) { motionFallback(request); }
  }
  function bindRoomTouch(request, parent) {
    if (!request || request.appearanceFamily === 'egg') return;
    var canvas = request.canvas, removers = request.touchRemovers = [];
    function listen(target, type, fn) { target.addEventListener(type, fn); removers.push(function () { target.removeEventListener(type, fn); }); }
    function coordinates(event) {
      var box = canvas.getBoundingClientRect();
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY) || !(box.width > 0 && box.height > 0)) return null;
      return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
    }
    listen(canvas, 'pointerdown', function (event) {
      request.touchPointer = null;
      if (!canTouch(request) || event.isPrimary === false || event.button !== 0 || !coordinates(event)) return;
      request.touchPointer = { id: event.pointerId, x: event.clientX, y: event.clientY, at: Date.now(), moved: false };
    });
    listen(canvas, 'pointermove', function (event) {
      var pointer = request.touchPointer;
      if (pointer && pointer.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 12) pointer.moved = true;
    });
    listen(canvas, 'pointercancel', function () { request.touchPointer = null; });
    listen(canvas, 'pointerleave', function () { request.touchPointer = null; });
    listen(canvas, 'pointerup', function (event) {
      var pointer = request.touchPointer; request.touchPointer = null;
      if (!pointer || pointer.id !== event.pointerId || pointer.moved || event.isPrimary === false || event.button !== 0 ||
        Date.now() - pointer.at > 650 || Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 12 ||
        !canTouch(request) || typeof request.controller.hitTest !== 'function') return;
      var point = coordinates(event); if (!point) return;
      try { touchPet(request, request.controller.hitTest(point.x, point.y)); } catch (_) { /* A missed touch is harmless. */ }
    });
    var actions = node('div', 'ipg-touch-actions'); actions.setAttribute('role', 'group'); actions.setAttribute('aria-label', 'ふれあう');
    [['head', '頭をなでる'], ['cheek', 'ほっぺをつつく'], ['hand', '手をにぎる']].forEach(function (entry) {
      var choice = button(entry[1], function () { touchPet(request, { part: entry[0], side: null }); }, true);
      choice.dataset.focusKey = 'touch-' + entry[0]; choice.dataset.touch = entry[0];
      actions.appendChild(choice);
    });
    request.touchActions = actions;
    request.touchHint = text('頭・ほっぺ・手に、そっとタッチしてみてね。', 'ipg-touch-hint ipg-small');
    append(parent, request.touchHint, actions);
    refreshRoomTouch(request);
    canvas.className += ' ipg-touchable';
    request.roomStatus.setAttribute('role', 'status'); request.roomStatus.setAttribute('aria-live', 'polite');
  }
  function startRoomBehavior(request) {
    if (!request.room || request.roomBehavior || !request.ready || !request.controller || !motionsVisible() ||
      !w.PetRoomBehavior || typeof w.PetRoomBehavior.create !== 'function') return;
    try {
      request.roomBehavior = w.PetRoomBehavior.create({
        appearanceKey: request.appearanceKey, now: Date.now,
        setTimeout: function (fn, ms) { return w.setTimeout(fn, ms); }, clearTimeout: function (id) { w.clearTimeout(id); },
        visible: function () { return request.ready && request.canvas.isConnected && motionsVisible() && !busy; },
        reducedMotion: function () { return !!(w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches); },
        onCue: function (entry) {
          if (!request.ready || !request.canvas.isConnected || !motionsVisible() || currentReaction() ||
            (request.touchCue && Date.now() - request.touchCue.startedAt < request.touchCue.durationMs) || busy) return;
          var cue = entry.situation === 'idle' ? null : { situation: entry.situation, durationMs: entry.durationMs,
            message: entry.message, activity: entry.activity, startedAt: Date.now() };
          request.roomCue = cue;
          try { request.controller.setSituation(cue ? cue.situation : 'idle', { durationMs: cue ? cue.durationMs : 0 }); updateMotionPresentation(request, cue); }
          catch (_) { motionFallback(request); }
        }
      });
      request.roomBehavior.start();
      var active = currentReaction();
      if (active) request.roomBehavior.suspendFor(Math.max(0, active.durationMs - (Date.now() - active.startedAt)));
    } catch (_) { /* Care and its saved reactions remain available without autonomy. */ }
  }
  function startMotions() {
    if (!motionsVisible() || !w.PetLilacMotion || typeof w.PetLilacMotion.mount !== 'function') return;
    if (!greeted && displaySpecies(state()) === 'lilac') {
      greeted = true;
      if (!currentReaction()) reaction = { situation: 'greeting', durationMs: 2500, startedAt: Date.now() };
    }
    currentReaction();
    motionRequests.forEach(function (request) {
      if (request.canvas.isConnected === false || request.controller || request.starting || request.failed) return;
      var owner = store, target = host, epoch = lifecycleEpoch;
      function currentMotion() { return store === owner && host === target && epoch === lifecycleEpoch && motionRequests.indexOf(request) >= 0 && request.canvas.isConnected !== false && motionsVisible(); }
      request.starting = true;
      try {
        var localCue = requestCue(request);
        updateMotionPresentation(request, localCue);
        var controller = w.PetLilacMotion.mount(request.canvas, {
          assetRoot: imageRoot,
          growthStage: request.growthStage,
          appearanceKey: request.appearanceKey,
          eggOrigin: request.eggOrigin,
          evolutionPath: request.evolutionPath,
          outfit: request.outfit,
          situation: localCue ? localCue.situation : 'idle',
          durationMs: localCue ? localCue.durationMs : 0,
          elapsedMs: localCue ? Math.max(0, Date.now() - localCue.startedAt) : 0,
          onReady: function () { if (!currentMotion() || request.failed) return; if (request.evolutionNotice) request.evolutionNotice.hidden = true; if (request.outfitNotice) request.outfitNotice.hidden = true; if (request.bodyNotice && bodyCatalogue().length) request.bodyNotice.hidden = true; if (request.directionNotice && directionCatalogue().length) request.directionNotice.hidden = true; request.ready = true; request.canvas.hidden = false; request.still.hidden = true; updateMotionPresentation(request, requestCue(request)); startRoomBehavior(request); },
          onPose: function (frame) {
            if (!currentMotion() || request.failed) return;
            showRoomPose(request, frame);
            if (!request.ready || !request.canvas.isConnected || !motionsVisible() || !request.food || request.food.hidden ||
              request.wrap.dataset.situation !== 'feeding' || !frame || frame.situation !== 'feeding' ||
              !Number.isFinite(frame.foodLeft) || !Number.isFinite(frame.foodTop)) return;
            var active = requestCue(request);
            if (!active || active.situation !== 'feeding' || Date.now() - active.startedAt >= active.durationMs) return;
            request.food.style.left = String(frame.foodLeft * 100) + '%';
            request.food.style.top = String(frame.foodTop * 100) + '%';
          },
          releaseContextOnDestroy: true,
          onError: function () { if (currentMotion()) motionFallback(request); }
        });
        if (!currentMotion()) { if (controller) controller.destroy(); return; }
        request.controller = controller;
        motionControllers.push(controller);
        startRoomBehavior(request);
      } catch (_) { if (currentMotion()) motionFallback(request); }
      finally { request.starting = false; }
    });
  }
  function refreshVisuals(target) {
    if (target !== host || !store || !host || host.isConnected === false || !motionsVisible() || busy || roomEdit || villageEdit) return false;
    // Adopt late optional code without replacing inputs, focus or scene DOM.
    motionRequests.forEach(function (request) { (request.paletteRefreshers || []).forEach(function (refresh) { refresh(); }); });
    startMotions();
    motionRequests.forEach(function (request) { startRoomBehavior(request); });
    return true;
  }
  function motionFallback(request) {
    (request.touchRemovers || []).forEach(function (remove) { remove(); }); request.touchRemovers = [];
    request.touchCue = null; request.touchPointer = null;
    request.wrap.dataset.touchPart = ''; request.wrap.dataset.touchSide = '';
    if (request.touchActions) request.touchActions.hidden = true;
    if (request.touchHint) request.touchHint.hidden = true;
    if (request.roomBehavior) request.roomBehavior.destroy();
    request.roomBehavior = null; request.roomCue = null;
    request.ready = false; request.failed = true; request.canvas.hidden = true; request.still.hidden = false;
    if (request.originNote) request.originNote.textContent = 'この子の姿を表示できませんでした。卵の選択と育成の記録は保存されています。';
    if (request.originRetry) request.originRetry.hidden = false;
    request.wrap.dataset.situation = 'idle'; request.wrap.dataset.feedingPhase = ''; request.wrap.dataset.cuePhase = 'idle';
    if (request.cueTimer != null) w.clearTimeout(request.cueTimer); request.cueTimer = null;
    if (request.revealFrame != null) w.cancelAnimationFrame(request.revealFrame); request.revealFrame = null;
    if (request.effect) { request.effect.hidden = true; request.effect.replaceChildren(); }
    if (request.food) request.food.hidden = true;
    if (request.room) { request.roomSettlingUntil = 0; placeInRoom(request, 0, false); request.wrap.dataset.facing = 'front'; request.wrap.dataset.roomWalkPhase = ''; request.room.dataset.activity = 'idle'; request.roomBubble.textContent = 'ここで、いっしょに過ごそう。'; request.roomStatus.textContent = request.originNote ? 'この子の姿を表示できませんでした。卵の選択と育成の記録は保存されています。お世話は続けられます。' : '絵で表示しています。お世話の記録はいつもどおり保存できます。'; }
    (request.controls || []).forEach(function (control) { control.disabled = true; control.dataset.ipgDisabled = '1'; });
    if (request.caption) request.caption.textContent = 'この画面では動きを表示できないため、絵で表示しています。' + (request.evolutionPath !== 'balanced' ? '育ち方の色・姿は表示できません。' : '') + (request.outfit ? 'この環境では服の見た目を表示できません。' : '');
    if (request.outfitNotice) request.outfitNotice.hidden = false;
    if (request.evolutionNotice) request.evolutionNotice.hidden = false;
    if (request.bodyNotice) request.bodyNotice.hidden = false;
    if (request.directionNotice) request.directionNotice.hidden = false;
    if (request.growthCaption) request.growthCaption.textContent = '成長の動きを表示できないため、基準の絵を表示しています。' + (request.evolutionPath !== 'balanced' ? '育ち方の色・姿は表示できません。' : '') + (request.outfit ? 'この環境では服の見た目を表示できません。' : '');
    if (request.fittingCaption) request.fittingCaption.textContent = '試着の表示を確認できないため、服を描かない基準の絵を表示しています。' + (request.evolutionPath !== 'balanced' ? '育ち方の色・姿は表示できません。' : '');
    if (request.originNote) [request.caption, request.growthCaption, request.fittingCaption].forEach(function (caption) {
      if (caption) caption.textContent = 'この子の姿を表示できませんでした。卵の選択と育成の記録は保存されています。';
    });
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
    var engine = w.PetLilacMotion, shared = engine && engine.catalogue, key = Array.isArray(shared) && shared.length ? shared : engine || null;
    if (key === emotionCacheKey && emotionCacheRows) return emotionCacheRows;
    var aliases = { happy: 'bright', feeling: 'deep', social: 'together', bright: 'bright', deep: 'deep', together: 'together', wonder: 'wonder', calm: 'calm', action: 'action' };
    var source = Array.isArray(shared) && shared.length ? shared : emotionFallback.reduce(function (all, group) {
      return all.concat(group[2].map(function (entry) { return { id: entry[0], label: entry[1], group: group[0], effect: 'none' }; }));
    }, []);
    var seen = {};
    emotionCacheRows = source.filter(function (entry) {
      if (!entry || typeof entry.id !== 'string' || typeof entry.label !== 'string' || !aliases[entry.group] || seen[entry.id]) return false;
      seen[entry.id] = true; return true;
    }).map(function (entry) {
      var group = emotionFallback.filter(function (row) { return row[0] === aliases[entry.group]; })[0];
      return { id: entry.id, label: entry.label, group: group[0], groupLabel: group[1],
        durationMs: Number.isFinite(entry.durationMs) ? entry.durationMs : engine && engine.durations && engine.durations[entry.id] || 0,
        face: typeof entry.face === 'string' && entry.face ? entry.face : '顔の見本',
        motion: typeof entry.motion === 'string' && entry.motion ? entry.motion : '動きは未表示です',
        keywords: Array.isArray(entry.keywords) ? entry.keywords.filter(function (word) { return typeof word === 'string'; }) : [],
        effect: typeof entry.effect === 'string' ? entry.effect : 'none' };
    });
    emotionCacheKey = key; return emotionCacheRows;
  }
  function emotionSearchText(value) {
    return String(value || '').normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, function (letter) { return String.fromCharCode(letter.charCodeAt(0) - 96); });
  }
  function referenceCatalogue(kind) {
    var engine = w.PetLilacMotion, rows = engine && engine[kind + 'Catalogue'];
    var ids = kind === 'direction' ? ['direction_left', 'direction_right', 'direction_back', 'direction_spin'] :
      ['body_hands', 'body_flap', 'body_feet', 'body_ears', 'body_tail', 'body_head', 'body_joy'];
    return Array.isArray(rows) ? rows.filter(function (entry) {
      return entry && ids.indexOf(entry.id) >= 0 && typeof entry.label === 'string' && Number.isFinite(entry.durationMs) && entry.durationMs > 0;
    }) : [];
  }
  function bodyCatalogue() { return referenceCatalogue('body'); }
  function directionCatalogue() { return referenceCatalogue('direction'); }
  function motionEntry(situation) {
    return emotionCatalogue().concat(bodyCatalogue(), directionCatalogue()).filter(function (row) { return row.id === situation; })[0];
  }
  function previewCue() {
    var duration = w.PetLilacMotion && w.PetLilacMotion.durations[previewSituation] || 0;
    if (previewSituation !== 'idle' && Date.now() - previewStartedAt >= duration) previewSituation = 'idle';
    return { situation: previewSituation, durationMs: duration, startedAt: previewStartedAt };
  }
  function effectFor(situation) {
    var entry = motionEntry(situation);
    var marks = { tears: ['', '', '', ''], anger: ['╬','☁','☁'], hearts: ['♡','♡','♡'], sweat: ['', '〰', ''],
      wonder: [situation === 'surprise' || situation === 'startled' ? '！' : '？','·','·'], sleep: ['z','Z','·'], quiet: ['·','·','·'], sparkle: ['✦','♪','✧','✦'] };
    return entry && Object.prototype.hasOwnProperty.call(marks, entry.effect) ? { kind: entry.effect, marks: marks[entry.effect] } : null;
  }
  function updateMotionPresentation(request, cue) {
    if (request.cueTimer != null) w.clearTimeout(request.cueTimer);
    request.cueTimer = null;
    var name = cue && cue.situation || 'idle', duration = cue && cue.durationMs || 0;
    var age = cue ? Math.max(0, Date.now() - cue.startedAt) : 0;
    if (name !== 'idle' && age >= duration) name = 'idle';
    var meal = name === 'feeding' && w.PetLilacMotion && typeof w.PetLilacMotion.feedingPhase === 'function' ?
      w.PetLilacMotion.feedingPhase(age) : null;
    var entry = motionEntry(name), fullReference = name.indexOf('body_') === 0 || name.indexOf('direction_') === 0, egg = request.appearanceFamily === 'egg';
    var mealLabel = meal && (egg ? ({ anticipation: 'たまごに元気を届けよう', chewing: '殻がぽかぽか…', joy: 'たまごがうれしそう', settling: 'そっと、ひと休み', idle: 'ふだん' })[meal.phase] : meal.label);
    (request.controls || []).forEach(function (control) { control.setAttribute('aria-pressed', String((control.dataset.emotion || control.dataset.bodyMotion || control.dataset.directionMotion) === name)); });
    if (request.caption) request.caption.textContent = meal ? mealLabel + (request.preview ? 'の見本' : '') :
      (entry ? entry.label : 'ふだん') + (request.preview || fullReference ? 'の見本' : 'のしぐさ');
    request.canvas.setAttribute('aria-label', (request.visualAlt || request.still.alt) + '・' + (meal ? mealLabel : cue && cue.message || (entry ? entry.label : 'ふだん')));
    request.wrap.dataset.situation = name;
    if (name === 'idle') { request.wrap.dataset.touchPart = ''; request.wrap.dataset.touchSide = ''; }
    request.wrap.dataset.feedingPhase = meal ? meal.phase : '';
    if (request.room) {
      if (roomWalk(name)) {
        if (request.roomWalkCueAt !== (cue && cue.startedAt)) {
          request.roomWalkCueAt = cue && cue.startedAt;
          var width = 0; try { width = request.room.getBoundingClientRect().width; } catch (_) {}
          request.roomWalkDistance = Math.max(20, Math.min(64, (Number.isFinite(width) ? width : 300) * .09));
        }
      } else {
        request.roomWalkCueAt = null; request.wrap.dataset.roomWalkPhase = '';
        placeInRoom(request, 0, Math.abs(request.roomPixelX || 0) > .01);
        if (name.indexOf('direction_') !== 0) request.wrap.dataset.facing = 'front';
      }
      var roomMessage = meal ? mealLabel : cue && cue.message || ({ greeting: '会えてうれしいな。', petted: 'なでなで、だいすき。', resting: 'すやすや…安心しておやすみ。', joy: 'うれしくて、ぴょん！' })[name] || 'ここで、いっしょに過ごそう。';
      request.room.dataset.activity = name === 'idle' ? 'idle' : meal ? 'feeding' : name === 'petted' ? 'affection' : name === 'resting' ? 'resting' : cue && cue.activity || 'looking';
      request.roomBubble.textContent = roomMessage;
      request.roomStatus.textContent = name === 'idle' ? (request.appearanceFamily === 'egg' ? 'そっと見守りながら、お世話してみよう。' : 'のんびり過ごしています。お世話をすると反応するよ。') : roomMessage;
    }
    var entryEnd = Math.min(450, duration * .22), releaseStart = duration - Math.min(800, duration * .28);
    request.wrap.dataset.cuePhase = name === 'idle' ? 'idle' : meal ? meal.phase : age < entryEnd ? 'enter' : age >= releaseStart ? 'settling' : 'acting';
    refreshRoomTouch(request);
    if (request.food) {
      setMealArtwork(request.food, meal && !egg ? cue && foodArtworkId(cue.foodId) || 'apple' : null);
      request.food.hidden = !(meal && !egg && meal.foodVisible && request.ready && motionsVisible());
      var anchor = w.PetLilacMotion && typeof w.PetLilacMotion.feedingAnchor === 'function' ? w.PetLilacMotion.feedingAnchor(request.growthStage, request.evolutionPath, request.appearanceKey, request.eggOrigin) : null;
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
          meal.phase === 'chewing' && !egg ? { kind: 'crumbs', marks: ['·','·','·'] } : null) : null;
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
    var nextAge = meal && meal.nextBoundaryMs != null ? Math.min(duration, meal.nextBoundaryMs) : age < entryEnd ? entryEnd : age < releaseStart ? releaseStart : duration;
    if (meal && meal.phase === 'chewing') nextAge = Math.min(nextAge, 1200 + (meal.foodProgress < .34 ? .34 : meal.foodProgress < .68 ? .68 : 1) * 3200);
    if (name !== 'idle' && motionsVisible()) request.cueTimer = w.setTimeout(function () {
      request.cueTimer = null;
      if (!request.canvas.isConnected || !motionsVisible()) return;
      if (Date.now() - cue.startedAt < duration) { updateMotionPresentation(request, cue); return; }
      if (request.roomCue && request.roomCue.startedAt === cue.startedAt) request.roomCue = null;
      if (request.touchCue && request.touchCue.startedAt === cue.startedAt) request.touchCue = null;
      if (request.growthPreview) request.localCue = null;
      else if (request.preview) previewSituation = 'idle';
      else if (reaction && reaction.startedAt === cue.startedAt) reaction = null;
      updateMotionPresentation(request, null);
    }, Math.max(16, nextAge - age));
  }
  function keepMotionVisible(request) {
    // The same whole-wrapper bounds protect active poses and the larger idle pose.
    try {
      var rect = request.wrap.getBoundingClientRect(), height = Number(w.innerHeight) || 0;
      if (height) {
        var pane = d.getElementById('sect-pet'), head = pane && pane.querySelector('.ipg-shell-head'), top = 0, bottom = height;
        function bounds(element) {
          if (!element || element.hidden) return null;
          try {
            var box = element.getBoundingClientRect(), start = Number(box.top), size = Number(box.height);
            if (!Number.isFinite(start) || !Number.isFinite(size)) return { unavailable: true };
            if (size <= 0 || start >= height || start + size <= 0) return null;
            return { top: start, bottom: Number.isFinite(box.bottom) ? box.bottom : start + size };
          } catch (_) { return { unavailable: true }; }
        }
        var header = bounds(head);
        if (header) top = Math.max(top, header.unavailable ? 82 : header.bottom);
        [pane && pane.querySelector('.ipg-shell-foot'), d.getElementById('knBottomNav')].forEach(function (element) {
          var footer = bounds(element); if (footer) bottom = Math.min(bottom, footer.unavailable ? height - 82 : footer.top);
        });
        top = Math.min(height, top + 12); bottom = Math.max(top, bottom - 12);
        request.wrap.style.scrollMarginTop = String(top) + 'px';
        request.wrap.style.scrollMarginBottom = String(height - bottom) + 'px';
        // Use the whole fixed-size wrapper, including the larger idle pose.
        if ((rect.top < top || rect.top + rect.height > bottom) && typeof request.wrap.scrollIntoView === 'function') request.wrap.scrollIntoView({ block: 'center', behavior: 'auto' });
      }
    } catch (_) { /* Scrolling must not reject a valid preview. */ }
  }
  function revealAfterDrawerLayout(request) {
    if (!request || !request.ready || !request.canvas.isConnected || !motionsVisible()) return;
    if (request.revealFrame != null) w.cancelAnimationFrame(request.revealFrame);
    request.revealFrame = w.requestAnimationFrame(function () {
      request.revealFrame = null;
      if (request.ready && request.canvas.isConnected && motionsVisible()) keepMotionVisible(request);
    });
  }
  function playMotionReference(request, entry, preview) {
    if (!request || !request.controller || !request.ready || !motionsVisible()) return;
    var cue = { situation: entry.id, durationMs: entry.durationMs, startedAt: Date.now() };
    if (request.growthPreview) request.localCue = cue;
    else if (preview) { previewSituation = entry.id; previewStartedAt = cue.startedAt; } else reaction = cue;
    try { request.controller.setSituation(entry.id); updateMotionPresentation(request, cue); }
    catch (_) { motionFallback(request); }
    keepMotionVisible(request);
  }
  function referenceMotionDrawer(request, preview, kind) {
    var mode = request && request.growthPreview ? 'growth' : preview ? 'preview' : 'pet', rows = referenceCatalogue(kind), drawer = node('details', 'ipg-' + kind + '-motion');
    var direction = kind === 'direction', open = direction ? directionDrawerOpen : bodyDrawerOpen;
    drawer.open = open[mode]; drawer.dataset.focusKey = mode + '-' + kind + '-motion';
    drawer.appendChild(node('summary', '', direction ? '向きと回転を見る' : '全身の動きを見る'));
    drawer.appendChild(text(direction ? '左・右・後ろを向いたり、一周回ったりする見本です。終わると正面に戻ります。育成の記録は変わりません。' :
      '手・足・耳・しっぽ・頭の動きを、ひとつずつ確かめられます。見本の再生で、育成の記録は変わりません。', 'ipg-small'));
    var unavailable = text(direction ? 'この環境では向きと回転の見本を表示できません。' : 'この環境では全身の動きの見本を表示できません。', 'ipg-small');
    unavailable.hidden = !!rows.length; drawer.appendChild(unavailable);
    if (request) request[kind + 'Notice'] = unavailable;
    var choices = node('div', 'ipg-' + kind + '-motion-grid'); choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', direction ? '向きと回転の見本' : '全身の動きの見本');
    var drawerControls = [], source = w.PetLilacMotion && w.PetLilacMotion[kind + 'Catalogue'];
    function populate() {
      if (request) request.controls = request.controls.filter(function (control) { return drawerControls.indexOf(control) < 0; });
      choices.replaceChildren(); drawerControls = []; rows = referenceCatalogue(kind);
      unavailable.hidden = !!rows.length && !(request && request.failed);
      rows.forEach(function (entry) {
      var choice = button('', function () { if (drawer.open) playMotionReference(request, entry, preview); }, true,
        !request || request.failed || !w.PetLilacMotion || typeof w.PetLilacMotion.mount !== 'function');
      choice.dataset[kind + 'Motion'] = entry.id; choice.dataset.focusKey = mode + '-' + kind + '-motion-' + entry.id;
      choice.setAttribute('aria-label', entry.label); choice.setAttribute('aria-description', '顔：' + entry.face + '。動き：' + entry.motion);
      choice.setAttribute('aria-pressed', String(((request && requestCue(request)) || {}).situation === entry.id));
      append(choice, node('span', 'ipg-emotion-name', entry.label), node('small', 'ipg-emotion-description', '顔：' + entry.face + '／動き：' + entry.motion));
      if (request) request.controls.push(choice); drawerControls.push(choice);
      choices.appendChild(choice);
      });
    }
    populate();
    if (request) (request.paletteRefreshers || (request.paletteRefreshers = [])).push(function () {
      var next = w.PetLilacMotion && w.PetLilacMotion[kind + 'Catalogue'];
      if (!drawer.isConnected || next === source) return;
      source = next; populate();
    });
    drawer.appendChild(choices);
    drawer.addEventListener('toggle', function () {
      if (!drawer.isConnected) return;
      open[mode] = drawer.open;
      var cue = request && requestCue(request);
      if (!drawer.open && cue && referenceCatalogue(kind).some(function (entry) { return entry.id === cue.situation; })) {
        if (request.growthPreview) request.localCue = null;
        else if (preview) previewSituation = 'idle'; else reaction = null;
        try { if (request.controller && request.ready) request.controller.setSituation('idle'); updateMotionPresentation(request, null); }
        catch (_) { motionFallback(request); }
      }
      if (!drawer.open) revealAfterDrawerLayout(request);
    });
    return drawer;
  }
  function emotionPalette(request, preview) {
    var all = emotionCatalogue(), count = all.length, mode = request && request.growthPreview ? 'growth' : preview ? 'preview' : 'pet', browse = emotionBrowse[mode];
    var available = !!request && !!w.PetLilacMotion && typeof w.PetLilacMotion.mount === 'function';
    var box = node('section', 'ipg-emotion-panel');
    box.setAttribute('aria-label', (preview ? 'しぐさの見本・' : 'きもちとしぐさ・') + count + '種類');
    var heading = node('h4', '', preview ? count + '種類のしぐさの見本' : 'きもちとしぐさ · ' + count + '種類');
    box.appendChild(heading);
    var caption = text('ふだんのしぐさ', 'ipg-emotion-caption'); caption.setAttribute('aria-live', 'polite');
    var search = node('input', 'ipg-emotion-search'); search.type = 'search'; search.placeholder = '名前・顔・動きで探す';
    search.value = browse.query; search.dataset.focusKey = mode + '-emotion-search'; search.setAttribute('aria-label', '全' + count + '種類からしぐさを検索');
    var clear = button('クリア', function () { browse.query = ''; browse.page = 0; search.value = ''; refreshChoices(); search.focus({ preventScroll: true }); }, true);
    clear.dataset.focusKey = mode + '-emotion-clear';
    var searchRow = append(node('div', 'ipg-emotion-search-row'), search, clear);
    var tabs = node('div', 'ipg-emotion-groups'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', 'きもちのグループ');
    var grid = node('div', 'ipg-emotion-grid'); grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', 'しぐさを選ぶ');
    var resultCount = text('', 'ipg-emotion-count ipg-small'); resultCount.setAttribute('role', 'status'); resultCount.setAttribute('aria-live', 'polite');
    var empty = text('見つかりませんでした。別の言葉で探すか、クリアしてください。', 'ipg-emotion-empty ipg-small'); empty.hidden = true;
    var groupButtons = [], choiceRows = [];
    var activeName = ((request ? requestCue(request) : preview ? previewCue() : currentReaction()) || {}).situation || 'idle';
    if (request) { request.controls = []; request.caption = caption; }
    emotionFallback.forEach(function (group) {
      var size = all.filter(function (entry) { return entry.group === group[0]; }).length;
      var groupButton = button(group[1] + ' ' + size, function () {
        browse.group = group[0]; browse.query = ''; browse.page = 0; search.value = ''; refreshChoices();
      }, true);
      groupButton.dataset.focusKey = mode + '-emotion-group-' + group[0];
      groupButtons.push({ id: group[0], label: group[1], button: groupButton }); tabs.appendChild(groupButton);
    });
    function populate() {
      var oldControls = choiceRows.map(function (row) { return row.button; });
      var focused = oldControls.indexOf(d.activeElement) >= 0 && d.activeElement.dataset.focusKey;
      if (request) request.controls = request.controls.filter(function (control) { return oldControls.indexOf(control) < 0; });
      all = emotionCatalogue(); count = all.length;
      available = !!request && !request.failed && !!w.PetLilacMotion && typeof w.PetLilacMotion.mount === 'function';
      box.setAttribute('aria-label', (preview ? 'しぐさの見本・' : 'きもちとしぐさ・') + count + '種類');
      heading.textContent = preview ? count + '種類のしぐさの見本' : 'きもちとしぐさ · ' + count + '種類';
      search.setAttribute('aria-label', '全' + count + '種類からしぐさを検索');
      groupButtons.forEach(function (group) { group.button.textContent = group.label + ' ' + all.filter(function (entry) { return entry.group === group.id; }).length; });
      grid.replaceChildren(); choiceRows = [];
      all.forEach(function (entry) {
      var choice = button('', function () { playMotionReference(request, entry, preview); }, true, !available);
      append(choice, node('span', 'ipg-emotion-name', entry.label), node('small', 'ipg-emotion-description', '顔：' + entry.face + '／動き：' + entry.motion));
      choice.dataset.emotion = entry.id; choice.dataset.focusKey = mode + '-emotion-' + entry.id;
      choice.setAttribute('aria-label', entry.label); choice.setAttribute('aria-description', '顔：' + entry.face + '。動き：' + entry.motion);
      choice.setAttribute('aria-pressed', String(entry.id === activeName));
      if (request) request.controls.push(choice);
        choiceRows.push({ entry: entry, button: choice }); grid.appendChild(choice);
      });
      if (focused) { var replacement = choiceRows.filter(function (row) { return row.button.dataset.focusKey === focused; })[0]; if (replacement && !replacement.button.disabled) replacement.button.focus({ preventScroll: true }); }
    }
    populate();
    var previous = button('前へ', function () { browse.page--; refreshChoices(); }, true);
    previous.dataset.focusKey = mode + '-emotion-previous';
    var pageInfo = node('span', 'ipg-emotion-page');
    var next = button('次へ', function () { browse.page++; refreshChoices(); }, true); next.dataset.focusKey = mode + '-emotion-next';
    var pages = append(node('div', 'ipg-emotion-pages'), previous, pageInfo, next);
    function refreshChoices() {
      var query = emotionSearchText(browse.query).trim(), words = query.split(/\s+/).filter(Boolean);
      var results = all.filter(function (entry) {
        if (!query) return entry.group === browse.group;
        var haystack = emotionSearchText([entry.id, entry.label, entry.face, entry.motion].concat(entry.keywords).join(' '));
        return words.every(function (word) { return haystack.indexOf(word) >= 0; });
      });
      var totalPages = Math.max(1, Math.ceil(results.length / 6)); browse.page = Math.max(0, Math.min(totalPages - 1, browse.page));
      var visible = results.slice(browse.page * 6, browse.page * 6 + 6);
      choiceRows.forEach(function (row) { row.button.hidden = visible.indexOf(row.entry) < 0; });
      groupButtons.forEach(function (group) { group.button.setAttribute('aria-pressed', String(!query && group.id === browse.group)); });
      resultCount.textContent = '全' + count + '種類 · ' + (query ? '検索' : 'このグループ') + results.length + '件 · ' + visible.length + '件表示';
      empty.hidden = !!results.length; clear.hidden = !browse.query;
      pageInfo.textContent = (browse.page + 1) + ' / ' + totalPages + 'ページ';
      previous.disabled = browse.page === 0; previous.dataset.ipgDisabled = previous.disabled ? '1' : '';
      next.disabled = browse.page >= totalPages - 1; next.dataset.ipgDisabled = next.disabled ? '1' : '';
      pages.hidden = !results.length;
    }
    search.addEventListener('input', function () { browse.query = search.value; browse.page = 0; refreshChoices(); });
    refreshChoices();
    append(box, caption, searchRow, tabs, resultCount, grid, empty, pages, referenceMotionDrawer(request, preview, 'body'), referenceMotionDrawer(request, preview, 'direction'));
    if (request) (request.paletteRefreshers || (request.paletteRefreshers = [])).push(function () {
      var nextAvailable = !request.failed && !!w.PetLilacMotion && typeof w.PetLilacMotion.mount === 'function';
      if (!box.isConnected || (emotionCatalogue() === all && nextAvailable === available)) return;
      populate(); refreshChoices();
    });
    if (!w.PetLilacMotion) caption.textContent = '絵の見本を表示しています。' + (request && request.evolutionPath !== 'balanced' ? '育ち方の色・姿は表示できません。' : '') + (request && request.outfit ? 'この環境では服の見た目を表示できません。' : '');
    return box;
  }
  function showSavedCareReaction(action, result) {
    if (!result || !result.ok || !action || action.type !== 'care' || ['feed', 'play', 'rest'].indexOf(action.kind) < 0 ||
      !host || !store || tab !== 'care' || !motionsVisible()) return;
    var saved = state(); if (saved.readOnly || displaySpecies(saved) !== 'lilac' || !currentReaction()) return;
    var scene = host.querySelector('.ipg-scene');
    if (scene && typeof scene.scrollIntoView === 'function') {
      try { scene.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (_) { /* Viewing must not reject a confirmed save. */ }
    }
  }
  async function run(action, message) {
    if (!store || busy || roomEdit || villageEdit) return { ok: false, error: { code: 'ui_busy' } };
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
      render(); showSavedCareReaction(action, result);
    }
    return result;
  }
  function stage(s) {
    if (displaySpecies(s) === 'lilac' && typeof core().getLilacAppearance === 'function') return core().getLilacAppearance(s.pet.exp);
    return canonicalStage(s);
  }
  function canonicalStage(s) {
    if (displaySpecies(s) === 'lilac' && typeof core().getLilacGrowth === 'function') return core().getLilacGrowth(s.pet.exp);
    var fn = core().getStage || store.getStage;
    var info = fn ? fn(s.pet.exp) : { key: 'egg', label: 'たまご', min: 0, next: null, progress: 0 };
    return displaySpecies(s) === 'lilac' && info.key === 'egg' ? Object.assign({}, info, { label: 'うまれたて' }) : info;
  }
  function petImage(s) {
    var key = stage(s).key, bunny = s.pet.species === 'bunny';
    if (!stageLabels[key]) key = 'egg';
    if (!bunny) return imageRoot + 'pet_lilac_reference_v2.png';
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
    var currentLook = evolutionLook(s, view.current), tendencyLook = evolutionLook(s, view.tendency);
    var color = node('span', 'ipg-evolution-color'); color.style.backgroundColor = currentLook.color; color.setAttribute('aria-hidden', 'true');
    append(heading, color, node('span', '', 'いまの育ち方：' + view.current.label + '・' + currentLook.colorName)); section.appendChild(heading);
    section.appendChild(text('次の進化の傾向（予想）：' + (view.tendency ? view.tendency.label + '・' + tendencyLook.colorName : 'まだこれから'), 'ipg-evolution-tendency'));
    if (view.nextAt != null) section.appendChild(text(number(view.nextAt) + ' EXPで、その時の育ち方が決まります。', 'ipg-small'));
    section.appendChild(text(view.tracked ? '新しく記録した育成日数：' + number(view.activeDays) + '日' :
      '育ち方の記録は、ここからのお世話から始まります。これまでのEXPやもちものは、そのままです。', 'ipg-evolution-recorded ipg-small'));
    var help = node('details', 'ipg-evolution-help'); help.appendChild(node('summary', '', '育ち方のヒント'));
    var hints = node('ul'); evolutionPaths().forEach(function (entry) { hints.appendChild(node('li', '', entry.label + '・' + evolutionLook(s, entry).colorName + '：' + entry.hint)); });
    append(help, text('食べものやお世話の種類に加えて、日を分けて続けることも育ち方につながります。800 EXPから先も、800 EXPごとに次の育ち方へ変わっていきます。', 'ipg-small'), hints); section.appendChild(help);
    if (Array.isArray(view.history) && view.history.length) {
      var history = node('details', 'ipg-evolution-history'); history.appendChild(node('summary', '', '記録できた進化（' + number(view.history.length) + '）'));
      var list = node('ol');
      view.history.forEach(function (entry) {
        var growth = (core().lilacGrowthStages || []).filter(function (row) { return row.key === entry.stageKey; })[0];
        var appearance = typeof core().getLilacAppearance === 'function' ? core().getLilacAppearance(entry.min) : growth;
        var branch = evolutionRow(entry.branch), stamp = typeof entry.at === 'number' ? new Date(entry.at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' JST' : '';
        list.appendChild(node('li', '', (appearance ? appearance.label : entry.stageKey) + ' · ' + number(entry.min) + ' EXP · ' + (branch ? branch.label + '・' + evolutionLook(s, branch).colorName : entry.branch) + (stamp ? ' · ' + stamp : '')));
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
    if (!developerPreview()) return;
    var stages = core().lilacAppearanceStages || core().lilacGrowthStages;
    if (displaySpecies(s) !== 'lilac' || !Array.isArray(stages) || !stages.length) return;
    var album = node('section', 'ipg-growth-album');
    var toggle = button(growthAlbumOpen ? '成長のすがたを閉じる' : '成長のすがたを見る', function () {
      growthAlbumOpen = !growthAlbumOpen; growthPreviewStage = growthAlbumOpen ? stage(state()).key : null; growthPreviewPath = growthAlbumOpen ? evolutionPath(state()) : null; if (!growthAlbumOpen) growthEmotionOpen = false; render();
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
      var caption = text(selected.label + (selectedPath ? '・' + selectedPath.label + '・' + evolutionLook(s, selectedPath).colorName : '') + ' · ' + (future ? 'これからの姿・見本' : currentView ? 'いまの姿の見本' : growthPreviewPath !== actualPath ? '育ち方・色の見本' : '育った姿の見本'), 'ipg-growth-caption');
      caption.setAttribute('aria-live', 'polite'); caption.tabIndex = -1;
      request.growthCaption = caption;
      if (!w.PetLilacMotion || typeof w.PetLilacMotion.mount !== 'function') caption.textContent = '成長の動きを表示できないため、基準の絵を表示しています。' + (request.evolutionPath !== 'balanced' ? '育ち方の色・姿は表示できません。' : '') + (request.outfit ? 'この環境では服の見た目を表示できません。' : '');
      append(preview, visual, caption);
      var motions = node('details', 'ipg-growth-motions'); motions.open = growthEmotionOpen; motions.dataset.focusKey = 'growth-motions-toggle';
      motions.appendChild(node('summary', '', 'この姿のしぐさを見る'));
      var motionPalette = null;
      function ensureMotionPalette() {
        if (!motionPalette) { motionPalette = emotionPalette(request, true); motions.appendChild(motionPalette); }
      }
      if (growthEmotionOpen) ensureMotionPalette();
      motions.addEventListener('toggle', function () {
        if (!motions.isConnected) return;
        growthEmotionOpen = motions.open;
        if (motions.open) {
          ensureMotionPalette();
          if (request.failed) motionFallback(request);
          else if (request.ready) updateMotionPresentation(request, requestCue(request));
        } else {
          request.localCue = null;
          try { if (request.ready && request.controller) request.controller.setSituation('idle'); updateMotionPresentation(request, null); }
          catch (_) { motionFallback(request); }
          revealAfterDrawerLayout(request);
        }
      });
      var choices = node('div', 'ipg-growth-choices'); choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', '成長のすがた・' + stages.length + '段階');
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
          var look = evolutionLook(s, entry), color = node('span', 'ipg-evolution-color'); color.style.backgroundColor = look.color; color.setAttribute('aria-hidden', 'true');
          append(branch, color, node('span', '', entry.label), node('small', '', look.colorName + '・見本')); branchChoices.appendChild(branch);
        });
        selectors.appendChild(branchChoices);
      }
      append(viewing, preview, selectors, motions); album.appendChild(viewing);
      album.appendChild(text('これからの姿も、見本で見られます。', 'ipg-small'));
    }
    parent.appendChild(album);
  }
  function cloneRoomLayout(layout) {
    return { version: 1, items: layout.items.map(function (row) { return { id: row.id, x: row.x, y: row.y, flip: row.flip }; }) };
  }
  function customRoom(s) { return Object.prototype.hasOwnProperty.call(s, 'roomLayout'); }
  function roomBuiltins() { return Array.isArray(core().roomFurniture) ? core().roomFurniture : []; }
  function roomPropName(id) {
    var builtin = roomBuiltins().filter(function (row) { return row.id === id; })[0];
    return builtin ? builtin.name : itemName(id);
  }
  function roomPropVisual(id) {
    var part = id.replace(/^room_/, ''), prop;
    if (/^room_(window|shelf|rug|bed|bowl|toy)$/.test(id)) {
      prop = node('span', 'ipg-room-' + part);
      if (part === 'window') append(prop, node('span', 'ipg-room-sun'), node('span', 'ipg-room-curtain'));
      if (part === 'shelf') append(prop, node('span', 'ipg-room-book'), node('span', 'ipg-room-book'), node('span', 'ipg-room-book'), node('span', 'ipg-room-plant'));
      if (part === 'bed') prop.appendChild(node('span', 'ipg-room-pillow'));
    } else prop = itemArtwork(id, 'ipg-room-layout-art');
    prop.setAttribute('aria-hidden', 'true'); return prop;
  }
  function clearRoomSurface() {
    roomSurfaceGeneration++;
    cozyPending = null;
    if (roomSurfaceCleanup) roomSurfaceCleanup();
    roomSurfaceCleanup = null;
  }
  function discardRoomEdit() {
    clearRoomSurface(); roomEdit = null;
    // A save may finish in its original store after the view closes. It cannot
    // resurrect the editor or unlock a newer operation in another mount.
    if (roomSaveAttempt) { roomSaveAttempt = null; setBusy(false); }
  }
  function beginRoomEdit() {
    if (!store || busy || roomEdit || developerPreview() || !motionsVisible()) return;
    var s = state();
    if (s.readOnly || needsEggChoice(s) || typeof core().getRoomLayout !== 'function' || typeof core().defaultRoomLayout !== 'function') return;
    var cozy = !!w.PetCozyRoom && typeof core().getCozyRoomLayout === 'function';
    roomEdit = { cozy: cozy, draft: cozy ? copyCozyLayout(core().getCozyRoomLayout(s)) : cloneRoomLayout(core().getRoomLayout(s)), defaults: cloneRoomLayout(core().defaultRoomLayout(s)),
      revision: s.revision, selected: null, error: '', saving: false };
    if (cozy) roomEdit.saved = copyCozyLayout(roomEdit.draft);
    tab = 'care'; failure = ''; notice = ''; reaction = null; render();
    var surface = host.querySelector('.ipg-room-layout-surface'); if (surface) surface.focus({ preventScroll: true });
  }
  async function saveRoomEdit(session) {
    if (roomEdit !== session || busy || !store || suspended) return { ok: false };
    var target = host, owner = store, epoch = lifecycleEpoch, attempt = {};
    roomSaveAttempt = attempt; session.error = ''; session.saving = true;
    // The 3D editor owns its draft/undo and stays mounted until the durable
    // adapter confirms the write. Rebuilding here would lose the gesture state.
    if (!session.cozy) render();
    setBusy(true);
    var result;
    try { result = await owner.dispatch({ type: session.cozy ? 'saveCozyRoomLayout' : 'saveRoomLayout', layout: session.cozy ? copyCozyLayout(session.draft) : cloneRoomLayout(session.draft), expectedRevision: session.revision }); }
    catch (_) { result = { ok: false, error: { code: 'save_failed' } }; }
    if (roomSaveAttempt !== attempt) return { ok: false };
    roomSaveAttempt = null; setBusy(false);
    if (roomEdit !== session || host !== target || store !== owner || lifecycleEpoch !== epoch || suspended) return { ok: false };
    session.saving = false;
    if (result && result.ok) { roomEdit = null; failure = ''; notice = 'おへやの配置を保存しました。'; }
    else {
      session.error = result && result.error && result.error.code === 'stale_state' ?
        'ほかの操作で記録が変わったため保存できませんでした。下書きは残っています。やめるで下書きを破棄し、ページを再読み込みしてから、もう一度お試しください。' :
        '配置を保存できませんでした。下書きは残っています。もう一度保存するか、やめるを選べます。';
    }
    if (!session.cozy || result && result.ok) render();
    var focus = host.querySelector('[data-focus-key="' + (roomEdit ? 'room-save' : 'room-edit') + '"]');
    if (focus) focus.focus({ preventScroll: true });
    return result && result.ok ? { ok: true } : { ok: false, message: session.error };
  }
  function copyCozyLayout(layout) { return JSON.parse(JSON.stringify(layout)); }
  function cozyAvailable() { return !!w.PetCozyRoom && typeof w.PetCozyRoom.mount === 'function' && typeof core().getCozyRoomLayout === 'function'; }
  function mountCozyRoom(container, s, session, visual, scene) {
    var generation = roomSurfaceGeneration, owner = store, epoch = lifecycleEpoch;
    function alive() { return generation === roomSurfaceGeneration && store === owner && epoch === lifecycleEpoch && container.isConnected && motionsVisible() && (!session || roomEdit === session); }
    var controller = null, lastPoint = null;
    function project(point) {
      lastPoint = point;
      if (!visual || !alive()) return;
      var stageElement = container.querySelector('.room-stage');
      if (!stageElement) return;
      if (visual.parentNode !== stageElement) stageElement.appendChild(visual);
      visual.style.left = point.left + 'px'; visual.style.bottom = 'calc(100% - ' + point.top + 'px)';
      visual.style.width = (160 * (point.scale || 1)) + 'px'; visual.style.height = (160 * (point.scale || 1)) + 'px';
      visual.className += visual.className.indexOf('ipg-cozy-pet') < 0 ? ' ipg-cozy-pet' : '';
    }
    function cancel() { if (!alive() || busy) return; discardRoomEdit(); notice = '配置の変更をやめました。'; render(); }
    cozyPending = function () {
      if (!alive()) return;
      roomSurfaceCleanup = function () { if (controller) controller.destroy(); };
      Promise.resolve(w.PetCozyRoom.mount({ host: container, layout: session ? session.draft : core().getCozyRoomLayout(s), savedLayout: session && session.saved,
        types: core().cozyRoomTypes, furniture: core().cozyRoomFurniture, editable: !!session, canRun: alive,
        onProjectPet: project, onCancel: cancel,
        onDraftChange: function (layout) { if (session && alive() && !session.saving) { session.draft = copyCozyLayout(layout); session.error = ''; } },
        onSave: function (layout) { if (!session || !alive() || busy) return Promise.resolve({ ok: false }); session.draft = copyCozyLayout(layout); return saveRoomEdit(session); },
        onError: function () {
          if (!alive()) return;
          if (scene) { scene.dataset.cozyUnavailable = 'true'; scene.dataset.cozyReady = 'false'; }
          var error = container.querySelector('.ipg-cozy-failure');
          if (!error) { error = text('立体のお部屋を表示できませんでした。配置の記録はそのままです。ページを読み直してお試しください。', 'ipg-cozy-failure ipg-small'); error.setAttribute('role', 'alert'); container.appendChild(error); }
        }
      })).then(function (mounted) {
        if (!alive()) { if (mounted) mounted.destroy(); return; }
        controller = mounted;
        if (!controller) return;
        if (scene) scene.dataset.cozyReady = 'true';
        if (visual && lastPoint) project(lastPoint);
      }).catch(function () {
        if (!alive()) return;
        if (scene) scene.dataset.cozyUnavailable = 'true';
        container.appendChild(text('立体のお部屋を読み込めませんでした。配置の記録はそのままです。', 'ipg-cozy-failure ipg-small'));
      });
    };
  }
  function renderCozyEditor(s, body) {
    var session = roomEdit, pet = card('', 'ipg-pet-card ipg-room-editor ipg-cozy-editor-card');
    var container = node('div', 'ipg-cozy-editor-host');
    pet.appendChild(container);
    var cancel = button('やめる', function () { if (roomEdit !== session || busy) return; discardRoomEdit(); notice = '配置の変更をやめました。'; render(); }, true);
    cancel.dataset.focusKey = 'room-cancel'; pet.appendChild(cancel);
    body.appendChild(pet); mountCozyRoom(container, s, session);
  }
  function renderRoomProps(scene, layout, session, tools) {
    var surface = node('div', 'ipg-room-layout-surface' + (session ? ' is-editing' : ''));
    surface.dataset.reservedFloor = '64';
    if (session) { surface.tabIndex = 0; surface.setAttribute('role', 'group'); surface.setAttribute('aria-label', '家具の配置。家具を選んでから、おへやをタップすると移動できます'); }
    else surface.setAttribute('aria-hidden', 'true');
    var generation = roomSurfaceGeneration, pointer = null, removers = [], props = Object.create(null), choiceButtons = [];
    function alive() { return !!session && roomEdit === session && generation === roomSurfaceGeneration && motionsVisible() && surface.isConnected; }
    function editable() { return alive() && !busy && !session.saving; }
    function find(id) { return layout.items.filter(function (row) { return row.id === id; })[0]; }
    function selected() { return session && find(session.selected); }
    function listen(target, name, fn) { target.addEventListener(name, fn); removers.push(function () { target.removeEventListener(name, fn); }); }
    function endPointer() {
      var ended = pointer; pointer = null;
      if (ended && typeof ended.element.releasePointerCapture === 'function') { try { ended.element.releasePointerCapture(ended.id); } catch (_) {} }
    }
    function update() {
      layout.items.forEach(function (row) {
        var el = props[row.id]; if (!el) return;
        el.style.left = row.x + '%'; el.style.top = row.y + '%'; el.style.transform = 'translate(-' + row.x + '%,-' + row.y + '%)';
        el.children[0].style.transform = row.flip ? 'scaleX(-1)' : 'none';
        el.dataset.x = String(row.x); el.dataset.y = String(row.y); el.dataset.flip = String(row.flip);
        if (session) { el.setAttribute('aria-pressed', String(session.selected === row.id)); el.setAttribute('aria-label', roomPropName(row.id) + '、横' + row.x + '、縦' + row.y + (row.flip ? '、左右反転' : '')); }
      });
      if (!session || !tools) return;
      var row = selected();
      tools.selection.textContent = row ? roomPropName(row.id) + ' · 横' + row.x + ' / 縦' + row.y : '動かす家具を選んでね';
      tools.actions.forEach(function (control) { control.disabled = busy || !row; control.dataset.ipgDisabled = row ? '' : '1'; });
      choiceButtons.forEach(function (control) { var placed = !!find(control.dataset.roomChoice); control.disabled = busy || placed; control.dataset.ipgDisabled = placed ? '1' : ''; });
    }
    function move(dx, dy) {
      var row = selected(); if (!editable() || !row) return;
      row.x = Math.max(0, Math.min(100, row.x + dx)); row.y = Math.max(0, Math.min(100, row.y + dy)); session.error = ''; update();
    }
    layout.items.forEach(function (row) {
      var builtin = row.id.indexOf('room_') === 0;
      var el = node(session ? 'button' : 'span', 'ipg-room-layout-prop ipg-room-prop-' + (builtin ? row.id.slice(5) : 'decoration'));
      if (session) { el.type = 'button'; el.dataset.focusKey = 'room-prop-' + row.id; }
      el.dataset.roomItem = row.id;
      el.appendChild(append(node('span', 'ipg-room-layout-content'), roomPropVisual(row.id)));
      props[row.id] = el; surface.appendChild(el);
      if (!session) return;
      listen(el, 'click', function () { if (!editable()) return; session.selected = row.id; update(); });
      listen(el, 'lostpointercapture', function (event) { if (pointer && pointer.element === el && pointer.id === event.pointerId) endPointer(); });
      listen(el, 'pointerdown', function (event) {
        if (!editable() || event.isPrimary === false || event.button != null && event.button !== 0 || pointer) return;
        session.selected = row.id; update(); el.focus({ preventScroll: true });
        if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
        var bounds = surface.getBoundingClientRect(), box = el.getBoundingClientRect();
        pointer = { id: event.pointerId, element: el, row: row, x: event.clientX, y: event.clientY, startX: row.x, startY: row.y,
          travelX: Math.max(0, bounds.width - box.width), travelY: Math.max(0, bounds.height - box.height) };
        if (typeof el.setPointerCapture === 'function') { try { el.setPointerCapture(event.pointerId); } catch (_) {} }
        if (event.cancelable) event.preventDefault();
      });
    });
    if (session) {
      listen(w, 'pointermove', function (event) {
        if (!editable() || !pointer || event.pointerId !== pointer.id || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
        pointer.row.x = Math.max(0, Math.min(100, Math.round(pointer.startX + (pointer.travelX ? (event.clientX - pointer.x) / pointer.travelX * 100 : 0))));
        pointer.row.y = Math.max(0, Math.min(100, Math.round(pointer.startY + (pointer.travelY ? (event.clientY - pointer.y) / pointer.travelY * 100 : 0))));
        session.error = ''; update(); if (event.cancelable) event.preventDefault();
      });
      ['pointerup', 'pointercancel'].forEach(function (name) { listen(w, name, function (event) { if (pointer && event.pointerId === pointer.id) endPointer(); }); });
      listen(w, 'blur', endPointer);
      listen(surface, 'click', function (event) {
        if (!editable() || event.target !== surface || !selected() || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
        var row = selected(), bounds = surface.getBoundingClientRect(), box = props[row.id].getBoundingClientRect();
        row.x = Math.max(0, Math.min(100, Math.round(bounds.width > box.width ? (event.clientX - bounds.left - box.width / 2) / (bounds.width - box.width) * 100 : 0)));
        row.y = Math.max(0, Math.min(100, Math.round(bounds.height > box.height ? (event.clientY - bounds.top - box.height / 2) / (bounds.height - box.height) * 100 : 0)));
        session.error = ''; update();
      });
      listen(d, 'keydown', function (event) {
        if (!editable()) return;
        var target = event.target, tag = target && target.tagName, inEditor = false, ancestor = target;
        while (ancestor) { if (ancestor === host) { inEditor = true; break; } ancestor = ancestor.parentNode; }
        if (!inEditor) return;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target && target.isContentEditable) return;
        if (event.key === 'Escape') {
          if (selected()) { session.selected = null; endPointer(); update(); surface.focus({ preventScroll: true }); }
          else { discardRoomEdit(); notice = '配置の変更をやめました。'; render(); }
          if (event.cancelable) event.preventDefault(); return;
        }
        var directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }, step = event.shiftKey ? 10 : 1;
        if (directions[event.key] && selected()) { move(directions[event.key][0] * step, directions[event.key][1] * step); if (event.cancelable) event.preventDefault(); }
      });
      tools.move = move; tools.update = update; tools.selected = selected; tools.editable = editable;
      tools.addChoices = function (buttons) { choiceButtons = buttons; update(); };
      roomSurfaceCleanup = function () { endPointer(); removers.forEach(function (remove) { remove(); }); };
    }
    update(); scene.appendChild(surface); return surface;
  }
  function renderRoomEditor(s, body) {
    if (roomEdit.cozy && cozyAvailable()) return renderCozyEditor(s, body);
    var session = roomEdit, generation = roomSurfaceGeneration, pet = card('おへやの模様替え', 'ipg-pet-card ipg-room-editor');
    function editorActive() { return roomEdit === session && generation === roomSurfaceGeneration && pet.isConnected && !busy && motionsVisible(); }
    append(pet, text('家具を選んで、指で動かそう。おへやの空いた場所をタップして移動することもできます。保存で反映されます。画面を離れると、保存前の変更は取り消されます。', 'ipg-small'));
    var scene = node('div', 'ipg-scene ipg-care-room ipg-room-editing ipg-scene-' + (s.decorations.background || 'meadow').replace(/^bg_/, ''));
    var img = petVisual(s); img.className += ' ipg-room-pet'; img.setAttribute('aria-hidden', 'true'); scene.appendChild(img);
    var selection = text('', 'ipg-room-selection'); selection.setAttribute('role', 'status'); selection.setAttribute('aria-live', 'polite');
    var controls = node('div', 'ipg-room-layout-tools'); controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', '選んだ家具を動かす');
    var tools = { selection: selection, actions: [] };
    [['←', '左へ', -5, 0], ['↑', '上へ', 0, -5], ['↓', '下へ', 0, 5], ['→', '右へ', 5, 0]].forEach(function (direction) {
      var control = button(direction[0], function () { if (tools.move) tools.move(direction[2], direction[3]); }, true);
      control.setAttribute('aria-label', direction[1]); control.dataset.focusKey = 'room-move-' + direction[1];
      tools.actions.push(control); controls.appendChild(control);
    });
    var flip = button('左右反転', function () { var row = tools.selected(); if (!tools.editable() || !row) return; row.flip = !row.flip; session.error = ''; tools.update(); }, true);
    flip.dataset.focusKey = 'room-flip';
    var remove = button('片づける', function () { var row = tools.selected(); if (!tools.editable() || !row) return; session.draft.items = session.draft.items.filter(function (entry) { return entry.id !== row.id; }); session.selected = null; session.error = ''; render(); }, true);
    remove.dataset.focusKey = 'room-remove'; tools.actions.push(flip, remove); append(controls, flip, remove);
    renderRoomProps(scene, session.draft, session, tools);
    append(pet, scene, selection, controls, text('矢印キーで1ずつ、Shift＋矢印キーで10ずつ移動。Escで選択を外し、もう一度Escで模様替えをやめられます。', 'ipg-small'));
    var picker = node('details', 'ipg-room-layout-picker'); picker.open = true;
    picker.appendChild(node('summary', '', '家具・もちものを置く'));
    var choices = node('div', 'ipg-room-layout-choices'), choiceButtons = [];
    var catalogue = roomBuiltins().concat(items().filter(function (entry) { return entry.type === 'decoration' && owned(s, entry); }));
    catalogue.forEach(function (entry) {
      var placed = session.draft.items.some(function (row) { return row.id === entry.id; });
      var choice = button('', function () {
        if (!editorActive() || session.draft.items.length >= 13 || session.draft.items.some(function (row) { return row.id === entry.id; })) return;
        session.draft.items.push({ id: entry.id, x: entry.x == null ? 74 : entry.x, y: entry.y == null ? 94 : entry.y, flip: false });
        session.selected = entry.id; session.error = ''; render();
        var added = host.querySelector('[data-focus-key="room-prop-' + entry.id + '"]'); if (added) added.focus({ preventScroll: true });
      }, true, placed);
      choice.dataset.roomChoice = entry.id; choice.dataset.focusKey = 'room-add-' + entry.id;
      var thumb = append(node('span', 'ipg-room-choice-art'), roomPropVisual(entry.id));
      append(choice, thumb, node('span', '', entry.name), node('small', '', placed ? '配置中' : '置く'));
      choices.appendChild(choice); choiceButtons.push(choice);
    });
    tools.addChoices(choiceButtons); picker.appendChild(choices); pet.appendChild(picker);
    if (session.error) { var error = text(session.error, 'ipg-error'); error.setAttribute('role', 'alert'); pet.appendChild(error); }
    var actions = node('div', 'ipg-room-editor-actions');
    var reset = button('基本の配置に戻す', function () { if (!editorActive()) return; session.draft = cloneRoomLayout(session.defaults); session.selected = null; session.error = ''; render(); }, true);
    reset.dataset.focusKey = 'room-reset';
    var cancel = button('やめる', function () { if (!editorActive()) return; discardRoomEdit(); notice = '配置の変更をやめました。'; render(); var entrance = host.querySelector('[data-focus-key="room-edit"]'); if (entrance) entrance.focus({ preventScroll: true }); }, true);
    cancel.dataset.focusKey = 'room-cancel';
    var save = button(session.saving ? '保存しています…' : '配置を保存', function () { if (editorActive()) saveRoomEdit(session); }); save.dataset.focusKey = 'room-save';
    append(actions, reset, cancel, save); pet.appendChild(actions);
    pet.appendChild(text('模様替え中は、お世話やほかのゲーム操作をお休みします。保存するか、やめるで終了できます。', 'ipg-small'));
    body.appendChild(pet);
  }
  function renderCare(s, body) {
    if (roomEdit) { renderRoomEditor(s, body); return; }
    var info = stage(s), pet = card('', 'ipg-pet-card');
    var scene = node('div', 'ipg-scene' + (!developerPreview() ? ' ipg-care-room' : '') + ' ipg-scene-' + (s.decorations.background || 'meadow').replace(/^bg_/, ''));
    var img = petVisual(s);
    var careRequest = displaySpecies(s) === 'lilac' ? motionRequests[motionRequests.length - 1] : null;
    var equipped = s.decorations.equipped, decor = item(equipped);
    var decoration = equipped && (developerPreview() || !customRoom(s) || !decor || decor.type !== 'decoration') ? node('span', 'ipg-pet-decoration') : null;
    if (decoration) {
      decoration.setAttribute('role', 'img');
      if (decor && hasItemArtwork(decor.id)) decoration.appendChild(itemArtwork(decor.id, 'ipg-decoration-art'));
      else decoration.textContent = decor ? decor.name : String(equipped).slice(0, 40);
    }
    if (decoration) decoration.setAttribute('aria-label', '身につけているかざり：' + (decor ? decor.name : String(equipped).slice(0, 100)));
    if (!developerPreview()) {
      scene.setAttribute('role', 'group'); scene.setAttribute('aria-label', (s.pet.name || 'このこ') + 'のおへや'); scene.dataset.activity = 'idle';
      if (customRoom(s) && typeof core().getRoomLayout === 'function') renderRoomProps(scene, core().getRoomLayout(s));
      else ['window', 'shelf', 'rug', 'bed', 'bowl', 'toy'].forEach(function (part) { scene.appendChild(roomPropVisual('room_' + part)); });
      img.className += ' ipg-room-pet';
      var bubble = node('span', 'ipg-room-bubble', 'ここで、いっしょに過ごそう。');
      var roomStatus = node('p', 'ipg-room-status', 'のんびり過ごしています。お世話をすると反応するよ。');
      append(scene, img, decoration, bubble);
      var heading = append(node('div', 'ipg-room-heading'), node('p', 'ipg-eyebrow', 'いっしょのおへや'), node('h3', 'ipg-pet-name', s.pet.name || 'なまえをつけよう'), text(info.label + ' · ' + number(s.pet.exp) + ' EXP', 'ipg-stage'));
      var edit = button('模様替え', beginRoomEdit, true, s.readOnly || typeof core().getRoomLayout !== 'function');
      edit.className += ' ipg-room-edit-entry'; edit.dataset.focusKey = 'room-edit'; heading.appendChild(edit);
      append(pet, heading, scene, roomStatus);
      if (cozyAvailable()) {
        var cozyHost = node('div', 'ipg-cozy-care-host'); scene.appendChild(cozyHost); scene.className += ' ipg-cozy-care';
        mountCozyRoom(cozyHost, s, null, img, scene);
      }
      if (careRequest) { careRequest.room = scene; careRequest.roomBubble = bubble; careRequest.roomStatus = roomStatus; careRequest.roomWalkDistance = 27; careRequest.wrap.dataset.facing = 'front'; careRequest.wrap.dataset.roomWalkPhase = ''; placeInRoom(careRequest, roomCarryX, false); }
      if (careRequest) bindRoomTouch(careRequest, pet);
    } else {
      append(scene, node('span', 'ipg-sky', '✧'), img, decoration);
      var emotionStage = careRequest ? append(node('div', 'ipg-emotion-stage'), scene, emotionPalette(careRequest, false)) : scene;
      append(pet, emotionStage, node('h3', 'ipg-pet-name', s.pet.name || 'なまえをつけよう'), text(info.label + ' · ' + number(s.pet.exp) + ' EXP', 'ipg-stage'), text(petMood(s), 'ipg-pet-mood'));
    }
    var egg = displaySpecies(s) === 'lilac' && appearanceProfile(info.key).family === 'egg';
    if (egg) pet.appendChild(text('15 EXPで、たまごから赤ちゃんがうまれます。今は殻の揺れで反応します。元気を届けたり、そっとなでて育てよう。', 'ipg-nursery-note ipg-small'));
    var progress = node('progress', 'ipg-progress');
    progress.max = 100; progress.value = info.progress;
    progress.setAttribute('aria-label', '次の成長までの進み具合');
    append(pet, progress, text(info.next == null ? 'ここまで育ててくれて、ありがとう。お世話はこれからも続けられます。' :
      '次の成長まで あと' + number(Math.max(0, info.next - s.pet.exp)) + ' EXP'));
    if (developerPreview()) {
      if (displaySpecies(s) === 'lilac') { renderEvolutionStatus(s, pet); renderWornOutfit(s, pet); }
      renderGrowthAlbum(s, pet);
    }
    var care = node('div', 'ipg-care-buttons' + (!developerPreview() ? ' ipg-room-care' : ''));
    care.setAttribute('role', 'group'); care.setAttribute('aria-label', 'お世話');
    [['feed', 'ごはん', '🍎', 8], ['play', 'なでる', '✋', 5], ['rest', '休む', '☾', 4]].forEach(function (x) {
      var used = s.care.day === currentDay() ? s.care.counts[x[0]] || 0 : 0, cap = (limits().care || {})[x[0]] || 3;
      var b = button('', function () { run({ type: 'care', kind: x[0] }, 'お世話の記録を保存しました。'); }, false, used >= cap);
      b.dataset.focusKey = 'care-' + x[0];
      var label = egg && x[0] === 'feed' ? 'あたためる' : x[1];
      var detail = label + ' · 今日' + number(used) + '/' + cap + '回 · +' + x[3] + 'EXP' + (used >= cap ? ' · 今日はお世話済み' : '');
      b.setAttribute('aria-label', detail); b.title = detail;
      var icon = node('span', 'ipg-care-icon', egg && x[0] === 'feed' ? '☀️' : x[0] === 'feed' ? '' : x[2]); icon.setAttribute('aria-hidden', 'true');
      if (!egg && x[0] === 'feed') icon.appendChild(itemArtwork('apple', 'ipg-care-item-art'));
      b.appendChild(icon);
      if (developerPreview()) append(b, node('span', '', label), node('small', '', number(used) + '/' + cap + '回 · +' + x[3] + 'EXP'));
      care.appendChild(b);
    });
    if (developerPreview() && displaySpecies(s) === 'lilac' && !careRequest) pet.appendChild(emotionPalette(null, false));
    if (developerPreview()) pet.appendChild(care); else scene.appendChild(care);
    append(pet, text(s.care.dailyRewardDay === currentDay() ?
      '今日の育成報酬10コインは受け取り済み。お世話は残りの回数まで続けられます。' :
      'その日最初のお世話で、育成報酬10コイン。お世話だけでも成長できます。'));
    if (displaySpecies(s) === 'lilac' && evolution(s)) pet.appendChild(text('いつものごはんは、りんご。食べものの種類や、なでる・休む、日を分けて続けるお世話で育ち方が変わります。同じ日にたくさん繰り返しても、進化の傾向への反映には上限があります。', 'ipg-evolution-explanation ipg-small'));
    if (!developerPreview()) {
      if (displaySpecies(s) === 'lilac') { renderEvolutionStatus(s, pet); renderWornOutfit(s, pet); }
      renderGrowthAlbum(s, pet);
    }
    body.appendChild(pet);
    var settings = node('details', 'ipg-card ipg-pet-settings');
    settings.appendChild(node('summary', '', chosenEgg(s) ? 'なまえ・この子のたまご' : 'なまえ・ペットの種類'));
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
    settings.appendChild(form);
    if (chosenEgg(s)) {
      var born = eggProfile(eggOrigin(s)), origin = node('div', 'ipg-egg-origin'); origin.dataset.eggOrigin = born.key;
      append(origin, eggIcon(born), node('div', 'ipg-egg-origin-words', born.eggLabel + ' · ' + born.characterName + ' · ' + born.colorName), text(born.description, 'ipg-small'));
      settings.appendChild(origin);
    } else {
      var species = node('div', 'ipg-row');
      [['lilac', '薄紫のこ（B）'], ['bunny', 'うさぎ']].forEach(function (x) {
        var b = button(x[1] + (displaySpecies(s) === x[0] ? ' · 選択中' : ''), function () {
          run({ type: 'chooseSpecies', species: x[0] }, 'ペットの種類を保存しました。');
        }, true, displaySpecies(s) === x[0]);
        species.appendChild(b);
      });
      append(settings, text('ペットの種類'), species);
    }
    if (developerPreview()) {
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
    }
    if (displaySpecies(s) === 'lilac') {
      settings.appendChild(text('たまごで出会い、赤ちゃんから少しずつ育っていきます。孵化したら、ごはんをもぐもぐ、うれしくてぴょん！' + '幼いころから、表情や手足・耳・しっぽの動きで気持ちを伝えてくれます。'));
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
  function copyVillage(layout) { return JSON.parse(JSON.stringify(layout)); }
  function discardVillageEdit() {
    villageEdit = null;
    if (villageSaveAttempt) { villageSaveAttempt = null; setBusy(false); }
  }
  function villagePosition(value, low, high) { return Math.max(low, Math.min(high, Number(value) || low)); }
  function villageVerticalBounds(id) { return id === 'tree' || id === 'flowers' ? [16, 84] : [22, 78]; }
  function villageScenePosition(placed) {
    var bounds = villageVerticalBounds(placed.id);
    return { x: villagePosition(placed.x, 15, 85), y: villagePosition(placed.y, bounds[0], bounds[1]) };
  }
  function villageSvg(tag, cls) {
    var element = d.createElementNS ? d.createElementNS('http://www.w3.org/2000/svg', tag) : node(tag, cls);
    if (cls) element.setAttribute('class', cls);
    return element;
  }
  function drawVillageRoads(map, layout) {
    var roads = map.querySelector('.ipg-village-roads');
    if (!roads) {
      roads = villageSvg('svg', 'ipg-village-roads');
      roads.setAttribute('viewBox', '0 0 1000 1000'); roads.setAttribute('preserveAspectRatio', 'none');
      roads.setAttribute('aria-hidden', 'true'); roads.setAttribute('focusable', 'false');
      var defs = villageSvg('defs'), filter = villageSvg('filter'); filter.setAttribute('id', 'ipg-village-path-texture');
      filter.setAttribute('filterUnits', 'userSpaceOnUse'); filter.setAttribute('x', '0'); filter.setAttribute('y', '0'); filter.setAttribute('width', '1000'); filter.setAttribute('height', '1000');
      var grain = villageSvg('feTurbulence'); grain.setAttribute('type', 'fractalNoise'); grain.setAttribute('baseFrequency', '.035'); grain.setAttribute('numOctaves', '3'); grain.setAttribute('seed', '9'); grain.setAttribute('result', 'grain');
      var roughen = villageSvg('feDisplacementMap'); roughen.setAttribute('in', 'SourceGraphic'); roughen.setAttribute('in2', 'grain'); roughen.setAttribute('scale', '4');
      append(filter, grain, roughen); defs.appendChild(filter); roads.appendChild(defs); map.appendChild(roads);
    }
    layout.items.forEach(function (placed) {
      if (placed.id === 'tree') return;
      var point = villageScenePosition(placed), x = point.x * 10, y = (point.y + 4) * 10;
      // All entrances share the square; doors keep their own short, curved lane.
      var curve = 'M 480 540 C ' + x + ' 540 ' + x + ' ' + ((540 + y) / 2) + ' ' + x + ' ' + y;
      ['ipg-village-lane-edge', 'ipg-village-lane'].forEach(function (cls) {
        var path = Array.prototype.find.call(roads.querySelectorAll('.' + cls), function (row) { return row.dataset.pathFor === placed.id; });
        if (!path) { path = villageSvg('path', cls); path.dataset.pathFor = placed.id; roads.appendChild(path); }
        path.setAttribute('d', curve);
      });
    });
  }
  function villageDestination(id) {
    if (busy || suspended || villageEdit || roomEdit) return;
    if (id === 'home') tab = 'care';
    else if (id === 'shop' || id === 'market') tab = 'market';
    else if (id === 'cafe' || id === 'playground') { notice = id === 'cafe' ? 'カフェの前で、ひとやすみ。' : '広場を、のんびりおさんぽ。'; }
    else { notice = id === 'tree' ? '木かげで、ひとやすみ。' : 'お花が村を彩っています。'; }
    render();
    var target = host.querySelector('.ipg-body h3');
    if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }); }
  }
  async function saveVillageEdit(session) {
    if (villageEdit !== session || busy || !store || suspended) return;
    var owner = store, target = host, epoch = lifecycleEpoch, attempt = {};
    villageSaveAttempt = attempt; session.error = ''; session.saving = true; setBusy(true);
    var result;
    try { result = await owner.dispatch({ type: 'saveVillageLayout', layout: copyVillage(session.draft), expectedRevision: session.revision }); }
    catch (_) { result = { ok: false }; }
    if (villageSaveAttempt !== attempt) return;
    villageSaveAttempt = null; setBusy(false);
    if (villageEdit !== session || owner !== store || target !== host || epoch !== lifecycleEpoch || suspended) return;
    session.saving = false;
    if (result && result.ok) { villageEdit = null; failure = ''; notice = '村の配置を保存しました。'; }
    else session.error = result && result.error && result.error.code === 'stale_state' ?
      'ほかの操作で記録が変わりました。下書きは残っています。やめるで戻り、読み直してから配置してください。' :
      '配置を保存できませんでした。下書きは残っています。もう一度保存するか、やめるを選べます。';
    render();
    var focus = host.querySelector('[data-focus-key="' + (villageEdit ? 'village-save' : 'village-edit') + '"]');
    if (focus) focus.focus({ preventScroll: true });
  }
  function renderTown(s, body, messages) {
    var village = card('', 'ipg-village ipg-town'), engine = w.PetTownWalk;
    village.appendChild(node('h3', '', 'カフェとお店の村'));
    if (!engine || typeof engine.mount !== 'function') {
      var unavailable = node('div', 'ipg-town-load-error'); unavailable.setAttribute('role', 'alert');
      append(unavailable, text('街を読み込めませんでした。'), button('ページを読み直す', function () { w.location.reload(); }, true));
      village.appendChild(unavailable);
      body.appendChild(village); return;
    }
    var world = engine.createWorld(core().getVillageLayout(s));
    var viewport = node('div', 'ipg-town-viewport'); viewport.tabIndex = 0;
    viewport.dataset.focusKey = 'town-walk'; viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', '街をおさんぽ。地面や建物をタップすると、その場所へ歩きます。矢印キーやWASDでも歩けます。おうちやお店の近くで入れます。');
    var scene = node('div', 'ipg-town-world'); scene.style.width = world.width + 'px'; scene.style.height = world.height + 'px';
    var layout = { items: world.places.map(function (p) { return { id: p.id, x: p.x / world.width * 100, y: p.y / world.height * 100 }; }) };
    drawVillageRoads(scene, layout);
    var images = { home: 'pet-items-v1/house.webp', cafe: 'pet-village-art/cafe.webp', shop: 'pet-village-art/shop.webp', playground: 'pet-items-v1/fountain.webp', tree: 'pet-village-art/tree-v2.webp', flowers: 'pet-village-art/flowerbed-v2.webp' };
    var mountedStore = store, epoch = lifecycleEpoch;
    function active() { return village.isConnected && store === mountedStore && epoch === lifecycleEpoch && tab === 'village' && motionsVisible() && !busy && !villageEdit && !roomEdit; }
    world.places.forEach(function (p) {
      var place = button('', function () { if (active() && townController) townController.approach(p.id); }, true);
      place.className = 'ipg-town-place'; place.dataset.place = p.id; place.dataset.focusKey = 'village-place-' + p.id;
      // Keyboard travel uses the viewport and nearby entry. An offscreen
      // landmark must not scroll the clipped world as focus advances.
      place.tabIndex = -1;
      place.dataset.layoutX = String(p.x / world.width * 100); place.dataset.layoutY = String(p.y / world.height * 100);
      place.style.left = p.x + 'px'; place.style.top = p.y + 'px'; place.style.zIndex = String(Math.round(p.y));
      place.setAttribute('aria-label', p.label + 'の近くまで歩く');
      var image = node('img'); image.src = imageRoot + images[p.id]; image.alt = ''; image.draggable = false; image.decoding = 'async';
      image.setAttribute('aria-hidden', 'true');
      image.addEventListener('error', function () { image.hidden = true; place.dataset.unavailable = 'true'; });
      append(place, image, node('strong', '', p.label)); scene.appendChild(place);
    });
    // The props share the same foot-depth order as the pet. Foreground trees can
    // conceal it naturally; the terrain remains one continuous, non-tiled scene.
    [[31,32,'lantern',70],[64,32,'lantern',70],[31,72,'lantern',70],[64,72,'lantern',70],
      [34,24,'flowers',170],[63,28,'flowers',160],[33,68,'flowers',170]].forEach(function (row) {
      var prop = node('img', 'ipg-town-prop'); prop.src = imageRoot + (row[2] === 'lantern' ? 'pet-items-v1/lantern.webp' : images[row[2]]);
      prop.alt = ''; prop.draggable = false; prop.setAttribute('aria-hidden', 'true');
      prop.style.left = row[0] / 100 * world.width + 'px'; prop.style.top = row[1] / 100 * world.height + 'px';
      prop.style.width = row[3] + 'px'; prop.style.zIndex = String(Math.round(row[1] / 100 * world.height)); scene.appendChild(prop);
    });
    var avatar = node('div', 'ipg-town-avatar'), pet = node('div', 'ipg-town-pet');
    avatar.dataset.walking = 'false'; avatar.dataset.facing = 'front'; avatar.dataset.family = appearanceProfile(stage(s).key).family;
    var shadow = node('span', 'ipg-town-shadow'); shadow.setAttribute('aria-hidden', 'true');
    var visual = petVisual(s, 'ipg-town-character'), request = motionRequests.filter(function (r) { return r.wrap === visual; })[0];
    if (request) request.townCue = { situation: 'idle', durationMs: 0, startedAt: Date.now() };
    pet.appendChild(visual); append(avatar, shadow, pet); scene.appendChild(avatar); viewport.appendChild(scene);
    village.appendChild(viewport);
    var guide = text('行きたい場所をタップして、おさんぽ', 'ipg-town-guide'); village.appendChild(guide);
    var enter = button('入る', function () {}, false); enter.hidden = true; enter.className += ' ipg-town-enter'; enter.dataset.focusKey = 'town-enter';
    var edit = button('村の配置を変える', function () {
      if (!active() || state().readOnly) return;
      villageEdit = { draft: copyVillage(core().getVillageLayout(state())), revision: state().revision, selected: 'home', error: '', saving: false };
      failure = ''; notice = ''; render();
    }, true, s.readOnly); edit.dataset.focusKey = 'village-edit';
    // Status and actions share one flow so wrapped messages cannot cover a button.
    var actions = node('div', 'ipg-town-actions');
    (messages || []).forEach(function (message) { actions.appendChild(message); });
    append(actions, edit, enter); village.appendChild(actions);
    body.appendChild(village);
    townPending = function () {
      if (!active()) return;
      if (w.PetVillageEconomyScene && typeof w.PetVillageEconomyScene.mount === 'function' && typeof core().getVillageEconomyView === 'function') {
        townEconomyScene = w.PetVillageEconomyScene.mount({ worldElement: scene, world: world,
          view: core().getVillageEconomyView(s, (options && options.now || Date.now)()), canRun: active,
          onOpenMarket: function () { if (active()) villageDestination('market'); } });
      }
      townController = engine.mount({ viewport: viewport, worldElement: scene, avatar: avatar, enterButton: enter,
        world: world, position: townPosition, canRun: active, enterableIds: ['home', 'shop'],
        onPosition: function (point) { if (active()) townPosition = { x: point.x, y: point.y }; },
        onEnter: function (id) { if (active()) villageDestination(id); },
        onMotion: function (motion) {
          if (!active()) return;
          avatar.dataset.walking = String(motion.walking); avatar.dataset.facing = motion.dx < -.05 ? 'left' : motion.dx > .05 ? 'right' : 'front';
          if (!request) return;
          var name = motion.walking && request.appearanceFamily !== 'egg' ? 'moving' : 'idle';
          var now = Date.now(), changed = request.townCue.situation !== name;
          if (!changed && (name === 'idle' || now - (request.townRefreshAt || 0) < 250)) return;
          if (changed) request.townCue = { situation: name, durationMs: name === 'moving' ? 1600 : 0, startedAt: now };
          request.townRefreshAt = now;
          // The normal 1.6s cue keeps its authored cadence. Refresh its current
          // phase while walking; room choreography never moves world coordinates.
          if (request.controller) { try { request.controller.setSituation(name, { durationMs: request.townCue.durationMs, elapsedMs: name === 'moving' ? (now - request.townCue.startedAt) % 1600 : 0 }); } catch (_) {} }
        }
      });
    };
  }
  function renderVillage(s, body, messages) {
    if (!villageEdit) return renderTown(s, body, messages);
    return renderVillageLayout(s, body);
  }
  function renderVillageLayout(s, body) {
    var editing = villageEdit, layout = editing ? editing.draft : core().getVillageLayout(s);
    var village = card('', 'ipg-village' + (editing ? ' ipg-village-editor' : ''));
    function editorActive() { return !!editing && villageEdit === editing && !busy && !suspended && village.isConnected; }
    append(village, node('h3', '', editing ? '村の配置を変える' : 'カフェとお店の村'));
    var viewport = node('div', 'ipg-village-viewport'); viewport.tabIndex = 0;
    viewport.setAttribute('role', 'region'); viewport.setAttribute('aria-label', '村の地図。指や矢印キーで動かして見渡せます');
    var map = node('div', 'ipg-village-map'); map.setAttribute('role', 'group'); map.setAttribute('aria-label', 'カフェとお店の村');
    var square = node('span', 'ipg-village-square'); square.setAttribute('aria-hidden', 'true'); map.appendChild(square);
    drawVillageRoads(map, layout);
    var scenery = node('div', 'ipg-village-scenery'); scenery.setAttribute('aria-hidden', 'true');
    [[29, 35], [65, 35], [32, 74], [65, 78]].forEach(function (point) {
      var lamp = node('img', 'ipg-village-lantern'); lamp.src = imageRoot + 'pet-items-v1/lantern.webp'; lamp.alt = ''; lamp.draggable = false;
      lamp.style.left = point[0] + '%'; lamp.style.top = point[1] + '%'; scenery.appendChild(lamp);
    });
    [[32, 25], [62, 29], [33, 67]].forEach(function (point) {
      var garden = node('img', 'ipg-village-garden'); garden.src = imageRoot + 'pet-village-art/flowerbed-v2.webp'; garden.alt = ''; garden.draggable = false;
      garden.style.left = point[0] + '%'; garden.style.top = point[1] + '%'; scenery.appendChild(garden);
    });
    map.appendChild(scenery);
    var images = { home: 'pet-items-v1/house.webp', cafe: 'pet-village-art/cafe.webp', shop: 'pet-village-art/shop.webp', playground: 'pet-items-v1/fountain.webp', tree: 'pet-village-art/tree-v2.webp', flowers: 'pet-village-art/flowerbed-v2.webp' };
    var captions = { home: 'お世話・おへや', cafe: 'カフェの風景', shop: 'お店・もちもの', playground: 'おさんぽの広場', tree: '木かげ', flowers: '花だん' };
    layout.items.forEach(function (placed) {
      var spec = core().villagePlaces.filter(function (row) { return row.id === placed.id; })[0];
      var place = button('', function () {
        if (editing) { if (!editorActive()) return; editing.selected = placed.id; render(); }
        else if (village.isConnected && !suspended) villageDestination(placed.id);
      }, true, s.readOnly && !!editing);
      place.className = 'ipg-village-place' + (editing && editing.selected === placed.id ? ' is-selected' : '');
      place.dataset.place = placed.id; place.dataset.focusKey = 'village-place-' + placed.id;
      var point = villageScenePosition(placed);
      place.style.left = point.x + '%'; place.style.top = point.y + '%'; place.style.zIndex = String(Math.round(point.y));
      if (editing) place.setAttribute('aria-pressed', String(editing.selected === placed.id));
      place.setAttribute('aria-label', spec.name + (editing ? 'を配置する' : ' · ' + captions[placed.id]));
      var art = node('span', 'ipg-village-art'); art.setAttribute('aria-hidden', 'true');
      var image = node('img'); image.alt = ''; image.draggable = false; image.decoding = 'async'; image.src = imageRoot + images[placed.id];
      image.addEventListener('error', function () { image.hidden = true; art.dataset.unavailable = 'true'; });
      append(art, image); append(place, art, node('strong', '', spec.name));
      if (placed.id !== 'tree' && placed.id !== 'flowers') place.appendChild(node('span', 'ipg-small', captions[placed.id]));
      map.appendChild(place);
    });
    viewport.appendChild(map); village.appendChild(viewport);
    village.appendChild(text('おうちやお店から、それぞれの画面を開けます。指や矢印キーで動かして村を見渡せます。', 'ipg-small ipg-village-hint'));
    if (editing) {
      var controls = node('div', 'ipg-village-controls'), selected = layout.items.filter(function (row) { return row.id === editing.selected; })[0];
      controls.appendChild(text('動かす建物や木を選び、位置を調節してください。配置の変更にコインは使いません。', 'ipg-small'));
      if (selected) {
        var fields = node('div', 'ipg-village-coordinate-fields');
        var selectedBounds = villageVerticalBounds(selected.id);
        [['x', '横の位置', 15, 85], ['y', '縦の位置', selectedBounds[0], selectedBounds[1]]].forEach(function (axis) {
          var slider = node('input'); slider.type = 'range'; slider.min = axis[2]; slider.max = axis[3]; slider.step = 1;
          slider.value = villagePosition(selected[axis[0]], axis[2], axis[3]); slider.dataset.focusKey = 'village-' + axis[0];
          var caption = node('span', '', axis[1] + ' ' + slider.value + '%');
          slider.addEventListener('input', function () {
            if (!editorActive()) return;
            selected[axis[0]] = villagePosition(slider.value, axis[2], axis[3]); caption.textContent = axis[1] + ' ' + selected[axis[0]] + '%';
            map.querySelectorAll('.ipg-village-place').forEach(function (place) { if (place.dataset.place === selected.id) place.style[axis[0] === 'x' ? 'left' : 'top'] = selected[axis[0]] + '%'; });
            map.querySelectorAll('.ipg-village-place').forEach(function (place) { if (place.dataset.place === selected.id) place.style.zIndex = String(Math.round(villageScenePosition(selected).y)); });
            drawVillageRoads(map, layout);
          });
          append(fields, append(node('label', 'ipg-field'), caption, slider));
        });
        controls.appendChild(fields);
      }
      if (editing.error) { var error = text(editing.error, 'ipg-error'); error.setAttribute('role', 'alert'); controls.appendChild(error); }
      var actions = node('div', 'ipg-row');
      var save = button('配置を保存', function () { if (editorActive()) saveVillageEdit(editing); }); save.dataset.focusKey = 'village-save';
      var cancel = button('やめる', function () { if (!editorActive()) return; discardVillageEdit(); notice = '配置の変更をやめました。'; render(); }, true);
      var reset = button('はじめの配置', function () { if (!editorActive()) return; editing.draft = copyVillage(core().defaultVillageLayout()); render(); }, true);
      append(actions, save, cancel, reset); append(controls, actions); village.appendChild(controls);
    } else {
      var edit = button('村の配置を変える', function () {
        if (busy || suspended || !village.isConnected || roomEdit || villageEdit || s.readOnly) return;
        villageEdit = { draft: copyVillage(core().getVillageLayout(state())), revision: state().revision, selected: 'home', error: '', saving: false };
        failure = ''; notice = ''; render();
      }, true, s.readOnly); edit.dataset.focusKey = 'village-edit'; village.appendChild(edit);
    }
    body.appendChild(village);
  }
  function owned(s, x) {
    if (x.type === 'food') return s.inventory[x.id] || 0;
    if (x.type === 'clothing') return wardrobe(s).owned && wardrobe(s).owned[x.id] === true ? 1 : 0;
    if (x.type === 'background') return (s.decorations.backgrounds || []).indexOf(x.id) >= 0 ||
      (s.decorations.backgrounds || []).indexOf(x.id.replace(/^bg_/, '')) >= 0 || x.id === 'bg_meadow' ? 1 : 0;
    return s.decorations.owned[x.id] ? 1 : 0;
  }
  function renderWornOutfit(s, parent) {
    var worn = outfit(s), row = node('div', 'ipg-worn-outfit'), egg = displaySpecies(s) === 'lilac' && appearanceProfile(stage(s).key).family === 'egg';
    if (worn) row.appendChild(itemArtwork(worn, 'ipg-worn-item-art'));
    row.appendChild(text(worn ? (egg ? '孵化後のお洋服：' : displaySpecies(s) === 'lilac' ? '着用中：' : '薄紫のこの着用設定：') + itemName(worn) : 'お洋服：まだ着ていません。', 'ipg-small'));
    if (egg) row.appendChild(text('お洋服は、孵化すると着られます。購入や着用の設定は、そのまま残ります。', 'ipg-small'));
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
        var sample = Object.assign({}, s, { pet: Object.assign({}, s.pet, { species: 'lilac', exp: Math.max(15, s.pet.exp) }) });
        var visual = petVisual(sample, 'ipg-fitting-sample', 'fitting', selected.id);
        var request = motionRequests[motionRequests.length - 1];
        var fittingInfo = node('div', 'ipg-fitting-info');
        var caption = text(selected.name + ' · ' + (s.pet.exp < 15 ? '孵化後の姿・' : '') + (owned(s, selected) ? '購入済み・試着の見本' : '未購入・試着の見本'), 'ipg-fitting-caption');
        caption.setAttribute('aria-live', 'polite'); caption.tabIndex = -1; request.fittingCaption = caption;
        if (!w.PetLilacMotion || typeof w.PetLilacMotion.mount !== 'function') caption.textContent = 'この画面では試着の動きを表示できないため、服を描かない基準の絵を表示しています。' + (request.evolutionPath !== 'balanced' ? '育ち方の色・姿は表示できません。' : '');
        append(fittingInfo, itemArtwork(selected.id, 'ipg-fitting-item-art'), caption, text('試着ではコインを使いません。', 'ipg-small'), button('試着を閉じる', function () {
          fittingOpen = false; fittingOutfit = null; render();
        }, true));
        append(fitting, visual, fittingInfo); section.appendChild(fitting);
      }
    }
    var grid = node('div', 'ipg-clothing-grid');
    clothes.forEach(function (entry) {
      var has = !!owned(s, entry), wearing = outfit(s) === entry.id;
      var row = node('article', 'ipg-clothing-item'); row.dataset.clothing = entry.id;
      var icon = itemArtwork(entry.id, 'ipg-clothing-art');
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
    append(c, text('毎日の育成で集めたコインを使えます。食べものは、もちものから使うとEXPになります。'));
    var grid = node('div', 'ipg-shop-grid');
    items().filter(function (x) { return x.type !== 'clothing'; }).forEach(function (x) {
      var count = owned(s, x), row = node('article', 'ipg-shop-item');
      row.dataset.itemId = x.id;
      append(row, shopItemArtwork(x), node('h4', '', x.name),
        text(x.type === 'food' ? '+' + number(x.exp) + 'EXP · 所持' + number(count) + '個' : count ? '持っています' : '未所持'),
        text(number(x.price) + 'コイン', 'ipg-stage'));
      var foodHint = x.type === 'food' && displaySpecies(s) === 'lilac' && evolution(s) ? foodEvolutionHint(x.id) : '';
      if (foodHint) row.appendChild(text(foodHint, 'ipg-food-evolution-hint ipg-small'));
      if (x.type === 'food' || !count) row.appendChild(button('買う', function () {
        run({ type: 'buyItem', itemId: x.id }, x.name + 'を購入しました。');
      }, false, s.coins < x.price));
      var roomDecoration = customRoom(s) && x.type === 'decoration';
      var placed = roomDecoration && s.roomLayout.items.some(function (entry) { return entry.id === x.id; });
      if (count) row.appendChild(button(x.type === 'food' ? '使う' : roomDecoration ? placed ? '配置済み' : 'お部屋に置く' : 'かざる', function () {
        run({ type: x.type === 'food' ? 'useItem' : 'equip', itemId: x.id }, x.type === 'food' ? 'アイテムを使いました。' : 'かざりを保存しました。');
      }, true, placed));
      grid.appendChild(row);
    });
    c.appendChild(grid);
    var carriedDecorations = Object.keys(s.decorations.owned).filter(function (id) { return !item(id); });
    if (carriedDecorations.length) {
      var carried = node('div', 'ipg-carried-decorations');
      carried.appendChild(node('h4', '', '引き継いだかざり'));
      carriedDecorations.forEach(function (id) {
        var row = node('div');
        append(row, text('旧かざり ' + String(id).slice(0, 60)), button('身につける', function () {
          run({ type: 'equip', itemId: id }, '旧かざりを身につけました。');
        }, true));
        carried.appendChild(row);
      });
      c.appendChild(carried);
    }
    if (customRoom(s)) c.appendChild(button('配置を変える・片づける', beginRoomEdit, true, s.readOnly));
    else if (s.decorations.equipped) c.appendChild(button('身につけているかざりを外す', function () {
      run({ type: 'equip', itemId: null }, 'かざりを外しました。');
    }, true));
    body.appendChild(c);
  }
  function marketPricePoints(market, spec) {
    function own(value, key) { return !!value && Object.prototype.hasOwnProperty.call(value, key); }
    function object(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
    function day(value) { return Number.isSafeInteger(value) && value >= 1 && value <= market.day; }
    function price(value) { return Number.isSafeInteger(value) && value >= 1 && value <= 99999; }
    var current = own(market.prices, spec.id) ? market.prices[spec.id] : null;
    if (!day(market.day) || !price(current)) return { points: [], connect: false };
    var buckets = Object.create(null), valid = Array.isArray(market.history) && market.history.length <= 100, lastDay = 0;
    var stocks = core().STOCKS || core().stocks || [];
    if (valid) market.history.forEach(function (row) {
      if (!valid) return;
      if (!object(row) || !day(row.day) || row.day < lastDay) { valid = false; return; }
      lastDay = row.day;
      var observed = null;
      if (row.type === 'day') {
        if (!object(row.prices) || !own(row.prices, spec.id) || !price(row.prices[spec.id])) { valid = false; return; }
        observed = row.prices[spec.id];
      } else if (row.type === 'buyStock' || row.type === 'sellStock') {
        if (!stocks.some(function (entry) { return entry.id === row.stockId; }) || !price(row.price) ||
          !Number.isSafeInteger(row.quantity) || row.quantity < 1 || !Number.isSafeInteger(row.fee) || row.fee < 1) { valid = false; return; }
        if (row.stockId === spec.id) observed = row.price;
      } else { valid = false; return; }
      if (observed === null) return;
      var bucket = buckets[row.day];
      if (!bucket) buckets[row.day] = { day: row.day, price: observed, conflict: false };
      else if (bucket.price !== observed) bucket.conflict = true;
    });
    if (!valid) buckets = Object.create(null);
    var today = buckets[market.day], currentConflict = !!today && (today.conflict || today.price !== current);
    buckets[market.day] = { day: market.day, price: current, conflict: false, breakBefore: currentConflict };
    var points = Object.keys(buckets).map(function (key) { return buckets[key]; }).filter(function (entry) { return !entry.conflict; });
    points.sort(function (a, b) { return a.day - b.day; });
    // A legacy conversion can reset a quote within one game day without recording
    // its date. Keep observed dots, but do not depict that reset as a market move.
    var legacy = own(market.legacyPriceSnapshot, spec.id) || Array.isArray(market.legacyConversion) && market.legacyConversion.some(function (entry) {
      return object(entry) && entry.stockId === spec.id;
    });
    return { points: points, connect: !legacy };
  }
  function marketPriceChart(market, spec) {
    var series = marketPricePoints(market, spec), points = series.points;
    var figure = node('figure', 'ipg-price-chart'); figure.dataset.stockId = spec.id; figure.dataset.pointCount = String(points.length);
    var caption = node('figcaption', 'ipg-price-chart-caption');
    append(caption, node('span', '', '株価のうごき'), node('small', '', 'コイン / 株')); figure.appendChild(caption);
    if (!points.length) { figure.appendChild(text('価格を確認できません。', 'ipg-small')); return figure; }
    function svgNode(tag, cls, attributes) {
      var element = d.createElementNS('http://www.w3.org/2000/svg', tag);
      if (cls) element.setAttribute('class', cls);
      Object.keys(attributes || {}).forEach(function (key) { element.setAttribute(key, String(attributes[key])); });
      return element;
    }
    var svg = svgNode('svg', 'ipg-price-chart-svg', { viewBox: '0 0 320 112', role: 'img', tabindex: '0', 'aria-label': spec.name + 'の株価グラフ。左右キーで記録を確認できます。' });
    var values = points.map(function (point) { return point.price; }), low = Math.min.apply(null, values), high = Math.max.apply(null, values);
    var first = points[0].day, last = points[points.length - 1].day, span = high - low;
    function x(point) { return first === last ? 174 : 40 + (point.day - first) / (last - first) * 268; }
    function y(point) { return span === 0 ? 56 : 100 - (point.price - low) / span * 88; }
    [12, 56, 100].forEach(function (at) { svg.appendChild(svgNode('line', 'ipg-price-chart-grid', { x1: 40, y1: at, x2: 308, y2: at })); });
    function priceLabel(value, at) { var label = svgNode('text', 'ipg-price-chart-value', { x: 2, y: at }); label.textContent = number(value); svg.appendChild(label); }
    if (span === 0) priceLabel(high, 60); else { priceLabel(high, 16); priceLabel(low, 104); }
    var runs = [], run = [];
    points.forEach(function (point, index) {
      var previous = points[index - 1];
      if (previous && (!series.connect || point.breakBefore || point.day !== previous.day + 1)) { if (run.length > 1) runs.push(run); run = []; }
      run.push(point);
    });
    if (run.length > 1) runs.push(run);
    runs.forEach(function (segment) { svg.appendChild(svgNode('polyline', 'ipg-price-chart-line', { points: segment.map(function (point) { return x(point).toFixed(2) + ',' + y(point).toFixed(2); }).join(' ') })); });
    points.forEach(function (point) {
      var dot = svgNode('circle', 'ipg-price-chart-dot', { cx: x(point), cy: y(point), r: points.length === 1 ? 4 : 2.5 });
      dot.dataset.day = String(point.day); dot.dataset.price = String(point.price);
      var title = svgNode('title'); title.textContent = number(point.day) + '日目 · ' + number(point.price) + 'コイン'; dot.appendChild(title); svg.appendChild(dot);
    });
    var cursor = svgNode('circle', 'ipg-price-chart-cursor', { r: 5 }), selected = points.length - 1;
    svg.appendChild(cursor); figure.appendChild(svg);
    var axis = node('div', 'ipg-price-chart-axis' + (first === last ? ' is-single' : ''));
    axis.appendChild(node('span', '', number(first) + '日目'));
    if (first !== last) axis.appendChild(node('span', '', number(last) + '日目'));
    var readout = node('output', 'ipg-price-chart-readout'); readout.setAttribute('aria-live', 'polite');
    function select(index) {
      var next = Math.max(0, Math.min(points.length - 1, index));
      if (readout.textContent && next === selected) return;
      selected = next; var point = points[selected];
      cursor.setAttribute('cx', String(x(point))); cursor.setAttribute('cy', String(y(point)));
      readout.textContent = number(point.day) + '日目 · ' + number(point.price) + 'コイン';
    }
    function pointAt(event) {
      var rect = svg.getBoundingClientRect();
      if (!Number.isFinite(event.clientX) || !rect.width) return;
      var at = (event.clientX - rect.left) / rect.width * 320, nearest = 0;
      points.forEach(function (point, index) { if (Math.abs(x(point) - at) < Math.abs(x(points[nearest]) - at)) nearest = index; });
      select(nearest);
    }
    svg.addEventListener('pointerdown', pointAt);
    svg.addEventListener('pointermove', function (event) { if (event.pointerType === 'mouse' || event.buttons) pointAt(event); });
    svg.addEventListener('keydown', function (event) {
      var index = event.key === 'ArrowLeft' ? selected - 1 : event.key === 'ArrowRight' ? selected + 1 : event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : null;
      if (index !== null) { if (event.cancelable) event.preventDefault(); select(index); }
    });
    select(selected); append(figure, axis, readout);
    if (points.length === 1) figure.appendChild(text('これから値動きがたまります。', 'ipg-price-chart-hint'));
    return figure;
  }
  async function runVillageAction(view, source, action, message, saved) {
    if (!store || busy || suspended || tab !== 'market' || roomEdit || villageEdit || !source.isConnected || state().readOnly) return;
    var owner = store, target = host, epoch = lifecycleEpoch, attempt = {};
    function current() { return store === owner && host === target && lifecycleEpoch === epoch && !suspended; }
    villageActionAttempt = attempt; setBusy(true);
    var result;
    try { result = await owner.dispatch(Object.assign({}, action, { expectedRevision: view.revision })); }
    catch (_) { result = { ok: false, error: { code: 'save_failed' } }; }
    if (villageActionAttempt !== attempt) return;
    villageActionAttempt = null;
    // A closed/changed screen may finish its already-started durable save. Its
    // result must never clear another screen's draft or show a success there.
    var live = current();
    setBusy(false);
    if (live) {
      if (result && result.ok) { if (saved) saved(); failure = ''; notice = message; }
      else { failure = safeError(result); notice = ''; }
    }
    if (store && !suspended) render();
    return result;
  }
  function villageInteger(value, max) {
    var n = Number(value);
    return String(value).trim() && Number.isSafeInteger(n) && n >= 1 && (!max || n <= max) ? n : null;
  }
  function renderMarket(s, body) {
    if (typeof core().getVillageEconomyView !== 'function') {
      body.appendChild(card('村のマーケットを読み込めませんでした。'));
      return;
    }
    var view = core().getVillageEconomyView(s, (options && options.now || Date.now)());
    var owner = store, epoch = lifecycleEpoch, intro = card('村のマーケット', 'ipg-village-market');
    intro.dataset.villageDay = String(view.day);
    append(intro, text('住人や旅人と、コインでやりとり。現実のお金は使いません。'),
      node('div', 'ipg-game-day', '村の ' + number(view.day) + '日目'));
    var advance = view.advance || {}, advanceButton = button('村の時間を進める', function () {
      transact(advanceButton, { type: 'advanceVillageEconomy' }, '村の時間を1日進めました。');
    }, false, s.readOnly || !advance.canAdvance);
    advanceButton.dataset.focusKey = 'village-advance';
    function advanceMessage(value) {
      return value.reason === 'daily_limit' ? '今日はここまで。また明日。' :
        value.reason === 'clock_moved_back' ? '端末の時刻を確認してください。' :
        value.reason === 'village_wait' ? '次は約' + Math.max(1, Math.ceil(value.waitMs / 1000)) + '秒後。' :
        '1回で村の1日。今日はあと' + number(value.dailyRemaining) + '回。';
    }
    var advanceHint = text(advanceMessage(advance), 'ipg-small ipg-village-advance-hint');
    append(intro, advanceButton, advanceHint);
    if (view.summary) intro.appendChild(text('売上 ' + number(view.summary.salesRevenue) + 'コイン · 受取配当 ' + number(view.summary.dividends) + 'コイン · 株の評価 ' + number(view.summary.currentValue) + 'コイン', 'ipg-small'));
    var people = (view.residents || []).map(function (x) { return x.name; }).join('・');
    var visitors = (view.visitors || []).map(function (x) { return x.name; }).join('・');
    if (people || visitors) intro.appendChild(text((people ? '住人 ' + people : '') + (visitors ? ' ／ 旅人 ' + visitors : ''), 'ipg-small'));
    var jumps = node('nav', 'ipg-village-market-jumps'); jumps.setAttribute('aria-label', '村のマーケット内');
    [['品物', 'goods'], ['お店', 'shops']].forEach(function (row) {
      var jump = button(row[0], function () {
        if (!jump.isConnected || store !== owner || lifecycleEpoch !== epoch || tab !== 'market' || suspended || busy) return;
        var target = row[1] === 'goods' ? goods : shops;
        target.scrollIntoView({ block: 'start', behavior: 'auto' });
        var heading = target.querySelector('h3'); if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
      }, true); jump.dataset.focusKey = 'village-jump-' + row[1]; jumps.appendChild(jump);
    });
    intro.appendChild(jumps);
    body.appendChild(intro);
    function scheduleAdvance(value) {
      if ((value.reason !== 'village_wait' && value.reason !== 'daily_limit') || !(value.waitMs > 0)) return;
      villageRefreshTimer = w.setTimeout(function () {
        villageRefreshTimer = null;
        if (store !== owner || epoch !== lifecycleEpoch || tab !== 'market' || suspended || !advanceButton.isConnected) return;
        // Time availability is a read-only control update. Replacing the market
        // here would detach a field while someone is typing into its draft.
        var currentState = state(), next = core().getVillageEconomyView(currentState, (options && options.now || Date.now)()).advance;
        var disabled = currentState.readOnly || !next.canAdvance;
        advanceButton.dataset.ipgDisabled = disabled ? '1' : '';
        advanceButton.disabled = busy || disabled;
        advanceHint.textContent = advanceMessage(next);
        scheduleAdvance(next);
      }, Math.min(60000, value.waitMs + 25));
    }
    scheduleAdvance(advance);
    function active(element) { return element.isConnected && store === owner && lifecycleEpoch === epoch && tab === 'market' && !suspended && !busy && !state().readOnly; }
    function transact(source, action, message, saved) {
      if (!active(source)) return;
      return runVillageAction(view, source, action, message, saved);
    }
    function inputValue(key, value, max) {
      var input = node('input'); input.type = 'number'; input.inputMode = 'numeric'; input.min = '1'; input.step = '1';
      if (max != null) input.max = String(max);
      input.value = villageTradeDrafts[key] == null ? String(value) : villageTradeDrafts[key]; input.dataset.focusKey = key;
      if (s.readOnly) { input.disabled = true; input.dataset.ipgDisabled = '1'; }
      input.addEventListener('input', function () { if (active(input)) villageTradeDrafts[key] = input.value; });
      return input;
    }
    function invalid(message) { failure = message; notice = ''; render(); }
    var goods = card('品物', 'ipg-village-goods');
    append(goods, text('もちものを出品。値段は自分で決められます。売れない日もあります。', 'ipg-small'));
    var foods = view.foods || [];
    if (!villageListingDraft) villageListingDraft = { itemId: (foods.filter(function (x) { return x.owned > 0; })[0] || foods[0] || {}).id || '', quantity: '1', unitPrice: '10' };
    var draft = villageListingDraft, listingFields = node('div', 'ipg-village-listing-fields');
    var food = node('select'); food.dataset.focusKey = 'village-list-item';
    foods.forEach(function (x) {
      var option = node('option', '', x.name + ' · もちもの ' + number(x.owned)); option.value = x.id; food.appendChild(option);
    });
    food.value = draft.itemId;
    if (s.readOnly) { food.disabled = true; food.dataset.ipgDisabled = '1'; }
    food.addEventListener('change', function () { if (active(food)) draft.itemId = food.value; });
    var count = node('input'), price = node('input');
    [[count, 'quantity', 'village-list-quantity', 99], [price, 'unitPrice', 'village-list-price', 999]].forEach(function (row) {
      var field = row[0]; field.type = 'number'; field.inputMode = 'numeric'; field.min = '1'; field.max = String(row[3]); field.step = '1';
      field.value = draft[row[1]]; field.dataset.focusKey = row[2];
      if (s.readOnly) { field.disabled = true; field.dataset.ipgDisabled = '1'; }
      field.addEventListener('input', function () { if (active(field)) draft[row[1]] = field.value; });
    });
    append(listingFields, label('品物', food), label('個数', count), label('1個の値段', price));
    var listButton = button('出品する', function () {
      if (!active(listButton)) return;
      var quantity = villageInteger(count.value, 99), unitPrice = villageInteger(price.value, 999);
      if (!quantity || !unitPrice) return invalid('個数は1〜99、値段は1〜999の整数で入力してください。');
      transact(listButton, { type: 'placeVillageListing', itemId: food.value, quantity: quantity, unitPrice: unitPrice }, '出品しました。売れ残りは取り下げられます。');
    }, false, s.readOnly || !foods.length);
    listButton.dataset.focusKey = 'village-list'; append(goods, listingFields, listButton,
      text('出品中の品物は一時お預かり。村の時間を進めると、売れることがあります。', 'ipg-small'));
    var listings = node('div', 'ipg-village-listings');
    (view.listings || []).forEach(function (x) {
      var row = node('div', 'ipg-village-trade-row'); row.dataset.listingId = x.id;
      append(row, node('strong', '', x.name), text('1個 ' + number(x.unitPrice) + 'コイン · 残り' + number(x.remaining) + '個', 'ipg-small'));
      if (x.remaining > 0) {
        var cancel = button('取り下げる', function () {
          transact(cancel, { type: 'cancelVillageListing', listingId: x.id }, '売れ残りをもちものへ戻しました。');
        }, true, s.readOnly); cancel.dataset.focusKey = 'village-cancel-' + x.id; row.appendChild(cancel);
      } else row.appendChild(text('売り切れ', 'ipg-small'));
      listings.appendChild(row);
    });
    if (!(view.listings || []).length) listings.appendChild(text('出品はまだありません。', 'ipg-small'));
    goods.appendChild(listings);
    goods.appendChild(node('h4', '', '住人・旅人から買う'));
    var offers = node('div', 'ipg-village-offers');
    (view.offers || []).forEach(function (x) {
      var row = node('div', 'ipg-village-trade-row'); row.dataset.offerId = x.id;
      append(row, node('strong', '', x.itemName), text(x.name + 'から · 1個 ' + number(x.unitPrice) + 'コイン · 残り' + number(x.remaining) + '個', 'ipg-small'));
      if (x.remaining > 0) {
        var key = 'village-offer-' + x.id, qty = inputValue(key, 1, x.remaining), controls = node('div', 'ipg-village-transaction');
        var buy = button('買う', function () {
          if (!active(buy)) return;
          var n = villageInteger(qty.value, x.remaining);
          if (!n) return invalid('残りの個数まで、1以上の整数で入力してください。');
          transact(buy, { type: 'buyVillageOffer', offerId: x.id, quantity: n }, '購入して、もちものに加えました。');
        }, false, s.readOnly); buy.dataset.focusKey = key + '-buy';
        append(controls, label('個数', qty), buy); row.appendChild(controls);
      } else row.appendChild(text('売り切れ', 'ipg-small'));
      offers.appendChild(row);
    });
    if (!(view.offers || []).length) offers.appendChild(text('次の来村をお楽しみに。', 'ipg-small'));
    goods.appendChild(offers); body.appendChild(goods);
    var shops = card('お店', 'ipg-village-businesses');
    shops.appendChild(text('みんなで出資して建てるお店。株を持つと、利益に応じて配当や優待を受け取れます。', 'ipg-small'));
    (view.shops || []).forEach(function (x) {
      var row = node('section', 'ipg-village-business'); row.dataset.shopId = x.id; row.dataset.shopStatus = x.status;
      append(row, node('h4', '', x.name), text(x.status === 'open' ? '営業中' : x.status === 'building' ? '建設中 · 村の次の日に開店' : '出資募集中', 'ipg-village-business-status'));
      if (x.status !== 'open') {
        append(row, text('集まった資金 ' + number(x.capitalRaised) + ' / ' + number(x.targetCapital) + 'コイン', 'ipg-small'),
          text('あなたの株 ' + number(x.playerShares) + '株 · 住人の株 ' + number(x.npcShares) + '株', 'ipg-small'));
        if (x.canContribute) {
          var key = 'village-fund-' + x.id, qty = inputValue(key, 1, x.remainingShares), controls = node('div', 'ipg-village-transaction');
          var fund = button('出資する', function () {
            if (!active(fund)) return;
            var n = villageInteger(qty.value, x.remainingShares);
            if (!n) return invalid('募集中の株数まで、1以上の整数で入力してください。');
            transact(fund, { type: 'contributeVillageShop', shopId: x.id, quantity: n }, 'お店に出資し、株を保有しました。');
          }, false, s.readOnly); fund.dataset.focusKey = key + '-buy';
          append(controls, label('株数 · 1株' + number(x.sharePrice) + 'コイン', qty), fund); row.appendChild(controls);
        }
      } else {
        append(row, text('1株 ' + number(x.price) + 'コイン · あなたの株 ' + number(x.playerShares) + '株', 'ipg-small'),
          text('評価額 ' + number(x.currentValue) + 'コイン · 評価損益 ' + signed(x.unrealizedProfit), 'ipg-small'),
          text('受取配当 ' + number(x.dividends) + 'コイン · 確定損益 ' + signed(x.realizedProfit), 'ipg-small'));
        var buyKey = 'village-buy-shares-' + x.id, buyQty = inputValue(buyKey, 1, x.maxBuyQuantity), buyControls = node('div', 'ipg-village-transaction');
        var buyShares = button('株を買う', function () {
          if (!active(buyShares)) return;
          var n = villageInteger(buyQty.value, x.maxBuyQuantity);
          if (!n || x.maxBuyQuantity < 1) return invalid('いま買える株数まで、1以上の整数で入力してください。');
          transact(buyShares, { type: 'buyVillageShares', shopId: x.id, quantity: n }, '株を購入し、保有しました。');
        }, false, s.readOnly || !x.canBuyShares); buyShares.dataset.focusKey = buyKey + '-buy';
        append(buyControls, label('株数 · いま買えるのは' + number(x.maxBuyQuantity) + '株', buyQty), buyShares); row.appendChild(buyControls);
        if (x.playerShares > 0) {
          var sellKey = 'village-shares-' + x.id, sellQty = inputValue(sellKey, 1, x.maxSellQuantity), sellControls = node('div', 'ipg-village-transaction');
          var sell = button('時価で売る', function () {
            if (!active(sell)) return;
            var n = villageInteger(sellQty.value, x.maxSellQuantity);
            if (!n || x.maxSellQuantity < 1) return invalid('いま売れる株数まで、1以上の整数で入力してください。');
            transact(sell, { type: 'sellVillageShares', shopId: x.id, quantity: n }, '株を売り、手数料を引いたコインを受け取りました。');
          }, true, s.readOnly || x.maxSellQuantity < 1); sell.dataset.focusKey = sellKey + '-sell';
          append(sellControls, label('株数 · いま売れるのは' + number(x.maxSellQuantity) + '株', sellQty), sell); row.appendChild(sellControls);
        }
        row.appendChild(text('売買手数料1%（最低1コイン）。住人の株数や予算によっては取引できません。', 'ipg-small'));
      }
      if (x.pendingBenefit) {
        var benefit = button('優待を受け取る', function () {
          transact(benefit, { type: 'claimVillageBenefit', shopId: x.id }, '優待をもちものに加えました。');
        }, false, s.readOnly); benefit.dataset.focusKey = 'village-benefit-' + x.id;
        append(row, text('優待 ' + x.benefitItemName, 'ipg-small'), benefit);
      }
      shops.appendChild(row);
    });
    shops.appendChild(text('配当・優待はお店の利益から。開店や保有だけでは保証されません。株価は上がることも下がることもあります。', 'ipg-small'));
    body.appendChild(shops);
    var rules = node('details', 'ipg-village-rules'), ruleList = node('ul');
    rules.appendChild(node('summary', '', '村のあそび方'));
    (view.rules || []).slice(0, 16).forEach(function (rule) { if (typeof rule === 'string') ruleList.appendChild(node('li', '', rule)); });
    rules.appendChild(ruleList); body.appendChild(rules);
    var legacy = node('details', 'ipg-village-legacy');
    legacy.appendChild(node('summary', '', 'これまでの6社の株'));
    renderLegacyMarket(s, legacy); body.appendChild(legacy);
  }
  function renderLegacyMarket(s, body) {
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
    intro.appendChild(text('グラフは記録のあるゲーム日を表示します。', 'ipg-small'));
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
      var heading = node('div', 'ipg-stock-heading'), company = node('div', 'ipg-stock-company');
      append(company, node('h3', '', x.name), text('架空の会社', 'ipg-small'));
      append(heading, stockArtwork(x.id), company);
      append(c, heading,
        node('div', 'ipg-stock-price', number(price) + ' コイン / 株'),
        text('前回比 ' + signed(price - (previous == null ? price : previous)) + 'コイン'), marketPriceChart(market, x),
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
  function render() {
    if (!host || !store) return;
    var priorRoom = motionRequests.filter(function (request) { return !!request.room; })[0];
    roomCarryX = tab === 'care' && priorRoom && Number.isFinite(priorRoom.roomPixelX) ? priorRoom.roomPixelX : 0;
    clearRoomSurface();
    stopMotions();
    var focused = d.activeElement && d.activeElement.dataset && d.activeElement.dataset.focusKey;
    var s = state(), choosing = !developerPreview() && needsEggChoice(s), root = node('div', 'ipg ipg-view-' + tab);
    if (!needsEggChoice(s)) { eggDraft = null; eggConfirm = false; }
    renderedDay = currentDay();
    var head = node('header', 'ipg-header');
    if (!choosing && tab !== 'care' && tab !== 'village' && displaySpecies(s) === 'lilac') head.appendChild(petVisual(s, 'ipg-lilac-compact'));
    append(head, append(node('div'), node('p', 'ipg-eyebrow', '小さな毎日を、いっしょに。'), node('h2', '', tab === 'village' ? 'カフェとお店の村' : 'そだてる')),
      node('div', 'ipg-wallet', number(s.coins) + ' コイン'));
    root.appendChild(head);
    var status = node('p', 'ipg-notice' + (failure ? ' ipg-error' : ''), failure || notice || (tab === 'care' || tab === 'village' ? '' : 'おかえりなさい。今日は何をして過ごそう？'));
    status.setAttribute('role', failure ? 'alert' : 'status'); status.setAttribute('aria-live', failure ? 'assertive' : 'polite');
    root.appendChild(status);
    var stateError = s.error && !failure ? text(s.error.message || '記録の読み込みに確認が必要です。', 'ipg-error') : null;
    if (stateError) root.appendChild(stateError);
    if (choosing) {
      var welcome = node('div', 'ipg-body'); renderEggChoice(s, welcome); root.appendChild(welcome);
      host.replaceChildren(root); setBusy(busy);
      if (focused) { var choiceFocus = host.querySelector('[data-focus-key="' + focused + '"]'); if (choiceFocus && !choiceFocus.disabled) choiceFocus.focus({ preventScroll: true }); }
      return;
    }
    var nav = node('nav', 'ipg-tabs'); nav.setAttribute('aria-label', '育成ゲーム');
    Object.keys(tabLabels).forEach(function (key) {
      var b = button(tabLabels[key], function () {
        if (busy || roomEdit || villageEdit) return;
        tab = key; if (key !== 'shop') { fittingOpen = false; fittingOutfit = null; } render();
      }, true, !!roomEdit || !!villageEdit);
      b.className += tab === key ? ' is-active' : '';
      b.setAttribute('aria-current', tab === key ? 'page' : 'false');
      b.dataset.focusKey = 'tab-' + key;
      nav.appendChild(b);
    });
    root.appendChild(nav);
    var body = node('div', 'ipg-body');
    if (tab === 'village') renderVillage(s, body, stateError ? [status, stateError] : [status]);
    else if (tab === 'care') renderCare(s, body);
    else if (tab === 'shop') renderShop(s, body);
    else renderMarket(s, body);
    root.appendChild(body);
    host.replaceChildren(root);
    if (!roomEdit && !villageEdit) startMotions();
    if (townPending) { var startTown = townPending; townPending = null; startTown(); }
    if (cozyPending) { var startCozy = cozyPending; cozyPending = null; startCozy(); }
    setBusy(busy);
    if (focused) {
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
    discardRoomEdit(); discardVillageEdit(); lifecycleEpoch++;
    host = target; townPosition = null; villageListingDraft = null; villageTradeDrafts = {}; options = opts || options || {};
    tab = developerPreview() ? 'care' : 'village';
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
        var subscribedStore = store, subscribedTarget = host;
        unsubscribe = store.subscribe(function () { if (store === subscribedStore && host === subscribedTarget && !busy) render(); });
        failure = ''; render(); return true;
      } catch (_) {
        store = null; loading('ゲームの記録を読み込めませんでした。保存先を確認して、もう一度お試しください。', true);
        return false;
      } finally { mounting = null; }
    })();
    return mounting;
  }
  function suspend() {
    suspended = true; lifecycleEpoch++; discardRoomEdit(); discardVillageEdit();
    stopMotions(); reaction = null; greeted = false; appearancePreview = false; bodyDrawerOpen.pet = bodyDrawerOpen.preview = bodyDrawerOpen.growth = false; directionDrawerOpen.pet = directionDrawerOpen.preview = directionDrawerOpen.growth = false; growthAlbumOpen = false; growthPreviewStage = null; growthPreviewPath = null; growthEmotionOpen = false; fittingOpen = false; fittingOutfit = null;
  }
  d.addEventListener('visibilitychange', function () {
    if (d.hidden) suspend();
    else { suspended = false; if (store && !busy) render(); }
  });
  w.addEventListener('pagehide', suspend);
  w.addEventListener('pageshow', function () { suspended = false; if (store && !busy) render(); });
  w.addEventListener('focus', function () { if (store && !busy && !(roomEdit && roomEdit.cozy)) render(); });
  w.setInterval(function () { if (store && !busy && renderedDay !== currentDay()) render(); }, 60000);
  w.IndependentPetGame = {
    mount: mount,
    open: function () { return mount(host || d.getElementById('pet-game-root'), options); },
    render: render,
    refreshVisuals: refreshVisuals,
    close: suspend,
    suspend: suspend
  };
})(window, document);

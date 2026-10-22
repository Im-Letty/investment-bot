/* Transient cafe activity. The host owns sessions, persistence and rewards. */
(function (w) {
  'use strict';

  var recipes = [
    {name: 'いちごケーキ', steps: ['sponge', 'cream', 'berry']},
    {name: 'いちごパフェ', steps: ['berry', 'sponge', 'cream']},
    {name: 'クリームケーキ', steps: ['sponge', 'berry', 'cream']}
  ];
  var ingredients = [
    {id: 'sponge', name: 'スポンジ'},
    {id: 'cream', name: 'クリーム'},
    {id: 'berry', name: 'いちご'}
  ];

  function mount(parent, options) {
    if (!parent || !parent.ownerDocument || typeof parent.appendChild !== 'function')
      throw new TypeError('Cafe activity needs a parent element.');
    options = options || {};
    var d = parent.ownerDocument;
    var suppliedDuration = Number(options.durationMs);
    var duration = Number.isFinite(suppliedDuration) ? Math.max(25000, Math.min(120000, suppliedDuration)) : 25000;
    var readTime = typeof options.now === 'function' ? options.now : Date.now;
    var startedAt = Number(readTime());
    if (!Number.isFinite(startedAt)) startedAt = Date.now();
    var lastTime = startedAt, live = true, score = 0, order = 0, step = 0, frame = null, timer = null;
    var removers = [], controls = [], remainingShown = null;

    function node(tag, cls, value) {
      var n = d.createElement(tag);
      if (cls) n.className = cls;
      if (value != null) n.textContent = value;
      return n;
    }
    function append(target) {
      for (var i = 1; i < arguments.length; i++) target.appendChild(arguments[i]);
      return target;
    }
    function listen(target, name, fn) {
      target.addEventListener(name, fn);
      removers.push(function () { target.removeEventListener(name, fn); });
    }
    function currentTime() {
      var value = Number(readTime());
      if (Number.isFinite(value)) lastTime = Math.max(lastTime, value);
      return lastTime;
    }

    var root = node('section', 'ipg-cafe-activity');
    root.setAttribute('aria-label', 'おやつづくり');
    var heading = node('h3', '', 'おやつづくり');
    var status = node('p', 'ipg-cafe-status ipg-game-status');
    status.setAttribute('role', 'timer'); status.setAttribute('aria-live', 'off');
    var orderCard = node('div', 'ipg-cafe-order');
    var art = node('img', 'ipg-cafe-cake');
    art.src = '/static/pet-items-v1/cake.webp'; art.alt = ''; art.width = 128; art.height = 128;
    art.draggable = false; art.setAttribute('aria-hidden', 'true');
    var recipeName = node('h4');
    var recipeList = node('ol', 'ipg-cafe-recipe');
    recipeList.setAttribute('aria-label', '材料を重ねる順番');
    append(orderCard, art, recipeName, recipeList);
    var instruction = node('p', 'ipg-muted', '上の順番で材料を重ねよう。');
    var ingredientButtons = node('div', 'ipg-cafe-ingredients');
    ingredientButtons.setAttribute('role', 'group'); ingredientButtons.setAttribute('aria-label', '材料を選ぶ');
    var feedback = node('p', 'ipg-cafe-feedback ipg-muted', '最初の材料を選んでね。');
    feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');

    function renderRecipe() {
      var recipe = recipes[order % recipes.length];
      recipeName.textContent = recipe.name;
      recipeList.replaceChildren();
      recipe.steps.forEach(function (id, index) {
        var ingredient = ingredients.filter(function (entry) { return entry.id === id; })[0];
        var row = node('li', 'ipg-cafe-step' + (index < step ? ' is-complete' : ''), ingredient.name + (index < step ? ' · できた' : ''));
        row.dataset.ingredient = id;
        if (index === step) row.setAttribute('aria-current', 'step');
        recipeList.appendChild(row);
      });
    }
    function showTime(now) {
      var seconds = Math.max(0, Math.ceil((duration - (now - startedAt)) / 1000));
      var value = seconds + ':' + score;
      if (value !== remainingShown) {
        remainingShown = value;
        status.textContent = '残り' + seconds + '秒 · ' + score + '点';
      }
    }
    function stop() {
      if (!live) return false;
      live = false;
      if (frame !== null) { w.cancelAnimationFrame(frame); frame = null; }
      if (timer !== null) { w.clearTimeout(timer); timer = null; }
      removers.splice(0).forEach(function (remove) { remove(); });
      controls.forEach(function (control) { control.disabled = true; });
      return true;
    }
    function complete() {
      if (!stop()) return;
      status.textContent = 'できあがり · ' + score + '点';
      feedback.textContent = 'お手伝いありがとう。';
      if (typeof options.onComplete === 'function') options.onComplete(score);
    }
    function update() {
      if (!live) return false;
      var now = currentTime();
      showTime(now);
      if (now - startedAt >= duration) { complete(); return false; }
      return true;
    }
    function choose(id) {
      if (!update()) return;
      var recipe = recipes[order % recipes.length];
      if (id !== recipe.steps[step]) {
        step = 0; renderRecipe(); feedback.textContent = '順番を確認して、最初から作ってみよう。';
        return;
      }
      step++;
      if (step === recipe.steps.length) {
        score = Math.min(30, score + 3); order++; step = 0;
        feedback.textContent = 'できた！ 次のおやつもお願いね。';
      } else feedback.textContent = 'いい感じ。次の材料を重ねよう。';
      renderRecipe(); showTime(currentTime());
    }
    ingredients.forEach(function (ingredient) {
      var b = node('button', 'ipg-button ipg-secondary ipg-cafe-ingredient');
      b.type = 'button'; b.dataset.ingredient = ingredient.id;
      var illustration = node('span', 'ipg-cafe-art ipg-cafe-art-' + ingredient.id);
      illustration.setAttribute('aria-hidden', 'true');
      if (ingredient.id === 'berry') {
        var berry = node('img'); berry.src = '/static/pet-items-v1/berry.webp'; berry.alt = '';
        berry.width = 80; berry.height = 80; berry.draggable = false; illustration.appendChild(berry);
      }
      append(b, illustration, node('span', '', ingredient.name));
      listen(b, 'click', function () { choose(ingredient.id); });
      controls.push(b); ingredientButtons.appendChild(b);
    });
    var cancel = node('button', 'ipg-button ipg-secondary ipg-cafe-cancel', '中止する（報酬なし）');
    cancel.type = 'button';
    listen(cancel, 'click', function () {
      if (!stop()) return;
      feedback.textContent = 'おやつづくりを中止しました。';
      if (typeof options.onCancel === 'function') options.onCancel();
    });
    controls.push(cancel);
    append(root, heading, status, orderCard, instruction, ingredientButtons, feedback, cancel);
    parent.appendChild(root);
    renderRecipe(); showTime(startedAt);

    function schedule() {
      if (!live) return;
      if (typeof w.requestAnimationFrame === 'function' && typeof w.cancelAnimationFrame === 'function') {
        frame = w.requestAnimationFrame(function () { frame = null; if (update()) schedule(); });
      } else {
        timer = w.setTimeout(function () { timer = null; if (update()) schedule(); }, 100);
      }
    }
    schedule();
    return {dispose: function () { stop(); }};
  }

  w.PetCafe = Object.freeze({mount: mount});
}(window));

(function () {
  'use strict';
  var select = document.getElementById('exp-cat');
  var label = document.querySelector('label[for="exp-cat"]');
  if (!select || !label || document.getElementById('kkExpenseCategoryPicker')) return;

  var paths = {
    '食費': 'M4 3v6a3 3 0 0 0 6 0V3M7 3v18M18 21V3c-4 3-4 9 0 9',
    '住居': 'm3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8',
    '交通': 'M5 16V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2ZM5 10h14M8 21l2-3m6 3-2-3M8 14h.01M16 14h.01',
    '光熱費': 'm13 2-9 12h7l-1 8 10-12h-7z',
    '通信費': 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM10 18h4',
    '娯楽': 'm12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3L3 9.7l6.2-.9z',
    '医療': 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
    '衣類': 'm8 3-5 3-2 6 5 2v7h12v-7l5-2-2-6-5-3a4 4 0 0 1-8 0Z',
    '教育': 'M12 5v16M3 3l9 2 9-2v16l-9 2-9-2z',
    'その他': 'M5 5h.01M12 5h.01M19 5h.01M5 12h.01M12 12h.01M19 12h.01M5 19h.01M12 19h.01M19 19h.01'
  };
  var tagPath = 'M3 3h8l10 10-8 8L3 11ZM7 7h.01';
  var translations = {ja:'新しいカテゴリ', en:'New category', zh:'新建分类', ko:'새 카테고리'};
  function categoryPath(value) {return Object.prototype.hasOwnProperty.call(paths, value) ? paths[value] : tagPath;}
  var root = document.createElement('div');
  root.id = 'kkExpenseCategoryPicker';
  root.className = 'kk-category-picker';
  var trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.id = 'kkExpenseCategoryToggle';
  trigger.className = 'kk-category-toggle';
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'kkExpenseCategoryChoices');
  label.id = 'kkExpenseCategoryLabel';
  trigger.setAttribute('aria-labelledby', label.id + ' kkExpenseCategoryValue');
  var currentIcon = icon('');
  var currentText = document.createElement('span');
  currentText.id = 'kkExpenseCategoryValue';
  currentText.className = 'kk-category-text';
  var chevron = document.createElement('span');
  chevron.className = 'kk-category-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = svg('m6 9 6 6 6-6');
  trigger.appendChild(currentIcon);
  trigger.appendChild(currentText);
  trigger.appendChild(chevron);
  var choices = document.createElement('div');
  choices.id = 'kkExpenseCategoryChoices';
  choices.className = 'kk-category-choices';
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-labelledby', label.id);
  choices.hidden = true;
  root.appendChild(trigger);
  root.appendChild(choices);
  var signature = '', buttons = [];

  function svg(path) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true"><path d="' + path + '"></path></svg>';
  }
  function icon(value) {
    var node = document.createElement('span');
    node.className = 'kk-category-icon';
    node.setAttribute('aria-hidden', 'true');
    node.innerHTML = svg(categoryPath(value));
    return node;
  }
  function text(option) {
    // Only remove the presentation emoji, never alter the saved option value.
    return Object.prototype.hasOwnProperty.call(paths, option.value) ? option.textContent.replace(/^[^\p{L}\p{N}]+/u, '').trim() : option.textContent.replace(/^🏷️\s*/, '');
  }
  function close(focus) {
    choices.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (focus) trigger.focus();
  }
  function choose(value) {
    select.value = value;
    // Preserve the original custom-category prompt and its cancel behavior.
    select.dispatchEvent(new Event('change', {bubbles:true}));
    refresh();
    close(true);
  }
  function refresh() {
    var options = Array.from(select.options);
    var lang = document.documentElement.getAttribute('lang') || 'ja';
    var addText = translations[lang] || translations.ja;
    var nextSignature = JSON.stringify(options.map(function (option) {return [option.value, option.textContent, option.disabled];})) + lang;
    if (nextSignature !== signature) {
      var focused = document.activeElement;
      var restoreFocus = !choices.hidden && choices.contains(focused);
      var focusedValue = restoreFocus ? focused.getAttribute('data-kk-category') : null;
      choices.textContent = '';
      buttons = [];
      options.forEach(function (option) {
        var add = option.value === '__kkadd__';
        var button = document.createElement('button');
        button.type = 'button';
        button.className = add ? 'kk-category-option kk-category-add' : 'kk-category-option';
        button.disabled = option.disabled;
        button.setAttribute('data-kk-category', option.value);
        if (!add) button.setAttribute('aria-pressed', 'false');
        var glyph = icon(option.value);
        if (add) glyph.innerHTML = svg('M12 5v14M5 12h14');
        var name = document.createElement('span');
        name.className = 'kk-category-text';
        name.textContent = add ? addText : text(option);
        button.appendChild(glyph);
        button.appendChild(name);
        if (!add) {
          var check = document.createElement('span');
          check.className = 'kk-category-check';
          check.setAttribute('aria-hidden', 'true');
          check.innerHTML = svg('m5 12 4 4L19 6');
          button.appendChild(check);
        }
        button.addEventListener('click', function () {choose(option.value);});
        choices.appendChild(button);
        buttons.push(button);
      });
      signature = nextSignature;
      if (restoreFocus) {
        var replacement = buttons.find(function (button) {return !button.disabled && button.getAttribute('data-kk-category') === focusedValue;});
        (replacement || trigger).focus();
      }
    }
    var selected = options.find(function (option) {return option.value === select.value;});
    currentText.textContent = selected ? (selected.value === '__kkadd__' ? addText : text(selected)) : '';
    currentIcon.innerHTML = svg(categoryPath(select.value));
    buttons.forEach(function (button) {
      if (button.hasAttribute('aria-pressed')) button.setAttribute('aria-pressed', String(button.getAttribute('data-kk-category') === select.value));
    });
  }
  trigger.addEventListener('click', function () {
    if (!choices.hidden) {close(false); return;}
    refresh();
    choices.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    var selected = buttons.find(function (button) {return button.getAttribute('aria-pressed') === 'true';});
    if (selected) selected.focus();
  });
  root.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !choices.hidden) {event.preventDefault(); close(true);}
  });
  document.addEventListener('pointerdown', function (event) {if (!root.contains(event.target)) close(false);});
  select.addEventListener('change', refresh);
  refresh();
  select.parentNode.insertBefore(root, select.nextSibling);
  label.htmlFor = trigger.id;
  select.hidden = true;
  new MutationObserver(refresh).observe(select, {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['disabled', 'selected']});
})();

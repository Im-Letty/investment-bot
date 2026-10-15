(function () {
  'use strict';
  function enhance(config) {
  var select = document.getElementById(config.select);
  var label = document.querySelector('label[for="' + config.select + '"]');
  var stem = config.stem;
  if (!select || !label || document.getElementById(stem + 'Picker')) return;

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
    'その他': 'M5 5h.01M12 5h.01M19 5h.01M5 12h.01M12 12h.01M19 12h.01M5 19h.01M12 19h.01M19 19h.01',
    '国内株': 'M3 21h18M5 21V7l7-4 7 4v14M9 10h.01M15 10h.01M9 14h.01M15 14h.01M10 21v-4h4v4',
    '米国株': 'M3 21h18M6 21V9h5V3h7v18M9 13h.01M9 17h.01M14 7h.01M14 11h.01M14 15h.01',
    '投資信託': 'm12 3 9 5-9 5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5',
    'ETF': 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    '債券': 'M6 3h9l4 4v14H6ZM14 3v5h5M9 12h7M9 16h7',
    '仮想通貨': 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM9 6v12M12 6v2m0 8v2M9 8h4a2 2 0 0 1 0 4H9m0 0h5a2 2 0 0 1 0 4H9'
  };
  var tagPath = 'M3 3h8l10 10-8 8L3 11ZM7 7h.01';
  var translations = {ja:'新しいカテゴリ', en:'New category', zh:'新建分类', ko:'새 카테고리'};
  var editorTranslations = {
    ja:{label:'カテゴリ名',add:'追加',cancel:'キャンセル',empty:'カテゴリ名を入力してください。',too_long:'80文字以内で入力してください。',reserved:'別のカテゴリ名を入力してください。',storage:'保存できませんでした。もう一度お試しください。'},
    en:{label:'Category name',add:'Add',cancel:'Cancel',empty:'Enter a category name.',too_long:'Use 80 characters or fewer.',reserved:'Choose another category name.',storage:'Could not save. Please try again.'},
    zh:{label:'类别名称',add:'添加',cancel:'取消',empty:'请输入类别名称。',too_long:'请输入80个字符以内的名称。',reserved:'请使用其他类别名称。',storage:'无法保存，请重试。'},
    ko:{label:'카테고리 이름',add:'추가',cancel:'취소',empty:'카테고리 이름을 입력해 주세요.',too_long:'80자 이내로 입력해 주세요.',reserved:'다른 이름을 입력해 주세요.',storage:'저장하지 못했습니다. 다시 시도해 주세요.'}
  };
  function categoryPath(value) {return Object.prototype.hasOwnProperty.call(paths, value) ? paths[value] : tagPath;}
  var root = document.createElement('div');
  root.id = stem + 'Picker';
  root.className = 'kk-category-picker';
  var trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.id = stem + 'Toggle';
  trigger.className = 'kk-category-toggle';
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', stem + 'Choices');
  label.id = stem + 'Label';
  trigger.setAttribute('aria-labelledby', label.id + ' ' + stem + 'Value');
  var currentIcon = icon('');
  var currentText = document.createElement('span');
  currentText.id = stem + 'Value';
  currentText.className = 'kk-category-text';
  var chevron = document.createElement('span');
  chevron.className = 'kk-category-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = svg('m6 9 6 6 6-6');
  trigger.appendChild(currentIcon);
  trigger.appendChild(currentText);
  trigger.appendChild(chevron);
  var choices = document.createElement('div');
  choices.id = stem + 'Choices';
  choices.className = 'kk-category-choices';
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-labelledby', label.id);
  choices.hidden = true;
  root.appendChild(trigger);
  root.appendChild(choices);
  var signature = '', buttons = [];
  var editor, categoryName, nameLabel, saveButton, cancelButton, error, errorReason = '';
  if (config.create) {
    editor = document.createElement('div');
    editor.id = stem + 'Editor'; editor.className = 'kk-category-editor'; editor.hidden = true;
    editor.setAttribute('role', 'group'); editor.setAttribute('aria-labelledby', stem + 'NameLabel');
    nameLabel = document.createElement('label'); nameLabel.id = stem + 'NameLabel'; nameLabel.htmlFor = stem + 'Name';
    categoryName = document.createElement('input'); categoryName.id = stem + 'Name'; categoryName.type = 'text';
    categoryName.className = 'kk-category-name'; categoryName.setAttribute('maxlength', '80'); categoryName.setAttribute('autocomplete', 'off');
    error = document.createElement('p'); error.id = stem + 'Error'; error.className = 'kk-category-error'; error.hidden = true; error.setAttribute('role', 'alert');
    categoryName.setAttribute('aria-describedby', error.id);
    var actions = document.createElement('div'); actions.className = 'kk-category-actions';
    saveButton = document.createElement('button'); saveButton.id = stem + 'Save'; saveButton.type = 'button';
    cancelButton = document.createElement('button'); cancelButton.id = stem + 'Cancel'; cancelButton.type = 'button';
    actions.appendChild(saveButton); actions.appendChild(cancelButton);
    editor.appendChild(nameLabel); editor.appendChild(categoryName); editor.appendChild(error); editor.appendChild(actions); root.appendChild(editor);
    trigger.setAttribute('aria-controls', choices.id + ' ' + editor.id);
    saveButton.addEventListener('click', saveCategory);
    cancelButton.addEventListener('click', function () {close(true);});
    categoryName.addEventListener('input', function () {errorReason = ''; categoryName.removeAttribute('aria-invalid'); syncEditor();});
    categoryName.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) {event.preventDefault(); saveCategory();}
    });
  }

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
    if (editor) editor.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (focus) trigger.focus();
  }
  function choose(value) {
    if (value === '__kkadd__' && editor) {
      choices.hidden = true; editor.hidden = false; categoryName.value = ''; errorReason = '';
      categoryName.removeAttribute('aria-invalid'); syncEditor(); categoryName.focus(); return;
    }
    select.value = value;
    // Preserve the original custom-category prompt and its cancel behavior.
    select.dispatchEvent(new Event('change', {bubbles:true}));
    refresh();
    close(true);
  }
  function syncEditor() {
    if (!editor) return;
    var lang = document.documentElement.getAttribute('lang') || 'ja';
    var words = editorTranslations[lang] || editorTranslations.ja;
    nameLabel.textContent = words.label; saveButton.textContent = words.add; cancelButton.textContent = words.cancel;
    error.textContent = errorReason ? (words[errorReason] || words.storage) : ''; error.hidden = !errorReason;
  }
  function saveCategory() {
    var result;
    try {result = config.create(categoryName.value);} catch (ignore) {result = {ok:false,reason:'storage'};}
    if (result && result.ok) {refresh(); close(true); return;}
    errorReason = result && result.reason || 'storage'; categoryName.setAttribute('aria-invalid', 'true'); syncEditor(); categoryName.focus();
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
    syncEditor();
  }
  trigger.addEventListener('click', function () {
    if (!choices.hidden || editor && !editor.hidden) {close(false); return;}
    refresh();
    choices.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    var selected = buttons.find(function (button) {return button.getAttribute('aria-pressed') === 'true';});
    if (selected) selected.focus();
  });
  root.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !event.isComposing && (!choices.hidden || editor && !editor.hidden)) {event.preventDefault(); close(true);}
  });
  document.addEventListener('pointerdown', function (event) {if (!root.contains(event.target)) close(false);});
  select.addEventListener('change', refresh);
  refresh();
  select.parentNode.insertBefore(root, select.nextSibling);
  label.htmlFor = trigger.id;
  select.hidden = true;
  new MutationObserver(refresh).observe(select, {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['disabled', 'selected']});
  }
  enhance({select:'exp-cat',stem:'kkExpenseCategory'});
  enhance({select:'inv-cat',stem:'kkInvestmentCategory',create:typeof window.kkAddInvestmentCategory === 'function' ? window.kkAddInvestmentCategory : null});
})();

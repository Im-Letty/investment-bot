/* Home investment categories use the existing owner-separated ledger storage. */
(function () {
  'use strict';
  var select = document.getElementById('inv-cat');
  if (!select || window.kkInvestmentCategoriesReady) return;
  var key = 'kb2_custom_inv_cats', addValue = '__kkadd__';
  var lastValue = select.value;
  function owner() {
    var session = window.knLedgerSession;
    return session && session.user && session.user.id || '';
  }
  var renderedOwner = owner();

  function language() {
    var lang = String(window.KK_LANG || document.documentElement.lang || 'ja').toLowerCase();
    return lang === 'en' || lang === 'zh' || lang === 'ko' ? lang : 'ja';
  }
  function message(kind) {
    var words = {
      ja: {add: '新しいカテゴリ', prompt: '新しい投資カテゴリの名前を入力してください', empty: 'カテゴリ名を入力してください。', too_long: 'カテゴリ名は80文字以内で入力してください。', reserved: '別のカテゴリ名を入力してください。', storage: 'カテゴリを保存できませんでした。もう一度お試しください。'},
      en: {add: 'New category', prompt: 'Enter a new investment category name', empty: 'Enter a category name.', too_long: 'Use 80 characters or fewer.', reserved: 'Choose a different category name.', storage: 'The category could not be saved. Please try again.'},
      zh: {add: '新建分类', prompt: '请输入新的投资分类名称', empty: '请输入分类名称。', too_long: '分类名称不能超过80个字符。', reserved: '请输入其他分类名称。', storage: '无法保存分类，请重试。'},
      ko: {add: '새 카테고리', prompt: '새 투자 카테고리 이름을 입력하세요', empty: '카테고리 이름을 입력하세요.', too_long: '80자 이내로 입력하세요.', reserved: '다른 카테고리 이름을 입력하세요.', storage: '카테고리를 저장하지 못했습니다. 다시 시도하세요.'}
    };
    return words[language()][kind];
  }
  function validName(value) {
    return typeof value === 'string' && value.trim() === value && value.length > 0 &&
      Array.from(value).length <= 80 && value !== addValue;
  }
  function readCategories() {
    try {
      var raw = localStorage.getItem(key);
      var cats = raw === null || raw === '' ? [] : JSON.parse(raw);
      return Array.isArray(cats) && cats.every(validName) ? cats : null;
    } catch (ignore) { return null; }
  }
  function optionFor(value) {
    for (var i = 0; i < select.options.length; i++) {
      if (select.options[i].value === value) return select.options[i];
    }
    return null;
  }
  function ensureOption(value) {
    var existing = optionFor(value);
    if (existing) return existing;
    var option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    option.setAttribute('data-kk-investment-custom', 'true');
    select.insertBefore(option, optionFor(addValue));
    return option;
  }
  function choose(value) {
    select.value = value;
    lastValue = value;
    select.dispatchEvent(new Event('change', {bubbles: true}));
    return {ok: true, value: value};
  }
  function pruneOptions(cats) {
    var selected = select.value;
    Array.from(select.options).forEach(function (option) {
      if (option.getAttribute('data-kk-investment-custom') === 'true' && cats.indexOf(option.value) < 0) {
        select.removeChild(option);
      }
    });
    if (selected !== addValue && !optionFor(selected)) {
      select.value = select.options[0].value;
      lastValue = select.value;
    }
  }

  window.kkRenderInvestmentCats = function () {
    var currentOwner = owner();
    if (currentOwner && currentOwner !== renderedOwner) pruneOptions([]);
    if (currentOwner) renderedOwner = currentOwner;
    var cats = readCategories();
    if (cats === null) return false;
    pruneOptions(cats);
    cats.forEach(ensureOption);
    var addOption = optionFor(addValue);
    if (addOption) addOption.textContent = '＋ ' + message('add');
    return true;
  };
  window.kkAddInvestmentCategory = function (name) {
    name = typeof name === 'string' ? name.trim() : '';
    if (!name) return {ok: false, reason: 'empty'};
    if (Array.from(name).length > 80) return {ok: false, reason: 'too_long'};
    if (name === addValue) return {ok: false, reason: 'reserved'};
    if (optionFor(name)) return choose(name);
    var cats = readCategories();
    if (cats === null) return {ok: false, reason: 'storage'};
    if (cats.indexOf(name) < 0) {
      try { localStorage.setItem(key, JSON.stringify(cats.concat([name]))); }
      catch (ignore) { return {ok: false, reason: 'storage'}; }
    }
    ensureOption(name);
    return choose(name);
  };
  window.kkInvCatChange = function (changedSelect) {
    if (changedSelect !== select || select.value !== addValue) return;
    var name = window.prompt(message('prompt'));
    select.value = optionFor(lastValue) ? lastValue : select.options[0].value;
    if (name === null) return;
    var result = window.kkAddInvestmentCategory(name);
    if (!result.ok) window.alert(message(result.reason));
  };
  select.addEventListener('change', function () {
    if (select.value === addValue) window.kkInvCatChange(select);
    else lastValue = select.value;
  });
  var originalRender = window.kkRenderCustomCats;
  window.kkRenderCustomCats = function () {
    try {
      if (typeof originalRender === 'function') return originalRender.apply(this, arguments);
    } finally {
      window.kkRenderInvestmentCats();
    }
  };
  window.addEventListener('knLedgerAuth', window.kkRenderInvestmentCats);
  window.kkRenderInvestmentCats();
  if (!optionFor(addValue)) {
    var add = document.createElement('option');
    add.value = addValue;
    add.textContent = '＋ ' + message('add');
    select.appendChild(add);
  }
  window.kkInvestmentCategoriesReady = true;
})();

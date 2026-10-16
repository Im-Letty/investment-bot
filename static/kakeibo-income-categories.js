/* Income categories share the existing private ledger storage and restore cycle. */
(function () {
  'use strict';
  var selects = ['inc-cat', 'm-inc-cat'].map(function (id) {return document.getElementById(id);}).filter(Boolean);
  if (!selects.length || window.kkIncomeCategoriesReady) return;
  var key = 'kb2_custom_inc_cats', addValue = '__kkadd__';
  var lastValues = new Map();
  selects.forEach(function (select) {lastValues.set(select, select.value);});
  function owner() {var session = window.knLedgerSession; return session && session.user && session.user.id || '';}
  var renderedOwner = owner();
  function message(kind) {
    var lang = window.KK_LANG || document.documentElement.lang || 'ja';
    var words = {
      ja: {add:'新しいカテゴリ', prompt:'新しい収入カテゴリの名前を入力してください', empty:'カテゴリ名を入力してください。', too_long:'カテゴリ名は80文字以内で入力してください。', reserved:'別のカテゴリ名を入力してください。', storage:'カテゴリを保存できませんでした。もう一度お試しください。'},
      en: {add:'New category', prompt:'Enter a new income category name', empty:'Enter a category name.', too_long:'Use 80 characters or fewer.', reserved:'Choose a different category name.', storage:'The category could not be saved. Please try again.'},
      zh: {add:'新建分类', prompt:'请输入新的收入分类名称', empty:'请输入分类名称。', too_long:'分类名称不能超过80个字符。', reserved:'请输入其他分类名称。', storage:'无法保存分类，请重试。'},
      ko: {add:'새 카테고리', prompt:'새 수입 카테고리 이름을 입력하세요', empty:'카테고리 이름을 입력하세요.', too_long:'80자 이내로 입력하세요.', reserved:'다른 카테고리 이름을 입력하세요.', storage:'카테고리를 저장하지 못했습니다. 다시 시도하세요.'}
    };
    return (words[lang] || words.ja)[kind];
  }
  function validName(value) {
    return typeof value === 'string' && value.trim() === value && value.length > 0 && Array.from(value).length <= 80 && value !== addValue;
  }
  function readCategories() {
    try {
      var raw = localStorage.getItem(key), cats = raw === null || raw === '' ? [] : JSON.parse(raw);
      return Array.isArray(cats) && cats.every(validName) ? cats : null;
    } catch (ignore) {return null;}
  }
  function optionFor(select, value) {
    return Array.from(select.options).find(function (option) {return option.value === value;});
  }
  function ensureOption(select, value) {
    if (optionFor(select, value)) return;
    var option = document.createElement('option');
    option.value = value; option.textContent = value; option.setAttribute('data-kk-income-custom', 'true');
    select.insertBefore(option, optionFor(select, addValue) || null);
  }
  function pruneOptions(select, cats) {
    var selected = select.value;
    Array.from(select.options).forEach(function (option) {
      if (option.getAttribute('data-kk-income-custom') === 'true' && cats.indexOf(option.value) < 0) select.removeChild(option);
    });
    if (selected !== addValue && !optionFor(select, selected)) select.value = select.options[0].value;
    if (select.value !== addValue) lastValues.set(select, select.value);
  }
  window.kkRenderIncomeCats = function () {
    var currentOwner = owner();
    if (currentOwner !== renderedOwner) {selects.forEach(function (select) {pruneOptions(select, []);}); renderedOwner = currentOwner;}
    var cats = readCategories();
    if (cats === null) return false;
    selects.forEach(function (select) {
      pruneOptions(select, cats); cats.forEach(function (cat) {ensureOption(select, cat);});
      var addOption = optionFor(select, addValue);
      if (addOption) addOption.textContent = '＋ ' + message('add');
    });
    return true;
  };
  window.kkAddIncomeCategory = function (name, select) {
    select = selects.indexOf(select) >= 0 ? select : selects[0];
    name = typeof name === 'string' ? name.trim() : '';
    if (!name) return {ok:false, reason:'empty'};
    if (Array.from(name).length > 80) return {ok:false, reason:'too_long'};
    if (name === addValue) return {ok:false, reason:'reserved'};
    if (!optionFor(select, name)) {
      var cats = readCategories();
      if (cats === null) return {ok:false, reason:'storage'};
      if (cats.indexOf(name) < 0) {
        try {localStorage.setItem(key, JSON.stringify(cats.concat([name])));}
        catch (ignore) {return {ok:false, reason:'storage'};}
      }
      selects.forEach(function (target) {ensureOption(target, name);});
    }
    select.value = name; lastValues.set(select, name);
    select.dispatchEvent(new Event('change', {bubbles:true}));
    return {ok:true, value:name};
  };
  window.kkIncCatChange = function (select) {
    if (selects.indexOf(select) < 0 || select.value !== addValue) return;
    var previous = lastValues.get(select);
    select.value = optionFor(select, previous) ? previous : select.options[0].value;
    var name = window.prompt(message('prompt'));
    if (name === null) return;
    var result = window.kkAddIncomeCategory(name, select);
    if (!result.ok) window.alert(message(result.reason));
  };
  selects.forEach(function (select) {
    select.addEventListener('change', function () {
      if (select.value === addValue) window.kkIncCatChange(select);
      else lastValues.set(select, select.value);
    });
  });
  var originalRender = window.kkRenderCustomCats;
  window.kkRenderCustomCats = function () {
    try {if (typeof originalRender === 'function') return originalRender.apply(this, arguments);}
    finally {window.kkRenderIncomeCats();}
  };
  window.addEventListener('knLedgerAuth', window.kkRenderIncomeCats);
  window.kkRenderIncomeCats();
  window.kkIncomeCategoriesReady = true;
})();

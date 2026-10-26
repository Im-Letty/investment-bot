/* Calendar appearance only. Ledger records, dates and drafts remain owned by kakeibo.html. */
(function (document, window) {
  'use strict';
  var KEY = 'knKakeiboCalendarDesignV1';
  var allowed = ['planner', 'modern', 'pop'];
  var section = document.getElementById('tab-calendar');
  if (!section) return;
  var group = section.querySelector('.kk-calendar-designs');
  if (!group) return;
  var buttons = Array.prototype.filter.call(group.querySelectorAll('button[data-kk-calendar-design]'), function (button) {
    return allowed.indexOf(button.getAttribute('data-kk-calendar-design')) !== -1;
  });
  if (!buttons.length) return;
  var storage = null;
  try { storage = window.localStorage; } catch (ignore) {}
  function apply(value) {
    var design = allowed.indexOf(value) !== -1 ? value : 'planner';
    section.setAttribute('data-calendar-design', design);
    buttons.forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-kk-calendar-design') === design));
    });
  }
  var initial = null;
  try { if (storage) initial = storage.getItem(KEY); } catch (ignore) {}
  apply(initial);
  buttons.forEach(function (button) {
    button.addEventListener('click', function () {
      if (button.disabled) return;
      var design = button.getAttribute('data-kk-calendar-design');
      if (allowed.indexOf(design) === -1) return;
      apply(design);
      try { if (storage) storage.setItem(KEY, design); } catch (ignore) {}
    });
  });
  window.addEventListener('storage', function (event) {
    if (event.key !== KEY || event.storageArea && event.storageArea !== storage) return;
    apply(event.newValue);
  });
})(document, window);

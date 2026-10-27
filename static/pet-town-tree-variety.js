/* Stable selection of distinct original tree pictures; no placement or game state. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetTownTreeVariety = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  var KINDS = Object.freeze(['tree', 'treeApple', 'treeBirch']);
  var SEED = 'village-tree-variety-v1';
  function seedValue(value) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff) return value >>> 0;
    if (typeof value !== 'string' || !value.length || value.length > 128) throw new Error('tree_variety_seed');
    var hash = 2166136261;
    for (var i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    return hash >>> 0;
  }
  function plan(options) {
    if (options === undefined) options = {};
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('tree_variety_options');
    var count = options.count === undefined ? 27 : options.count;
    if (!Number.isSafeInteger(count) || count < 1 || count > 64) throw new Error('tree_variety_count');
    var state = seedValue(options.seed === undefined ? SEED : options.seed), rows = [];
    function random() {
      state = (state + 0x6d2b79f5) >>> 0;
      var v = Math.imul(state ^ state >>> 15, state | 1);
      v ^= v + Math.imul(v ^ v >>> 7, v | 61);
      return ((v ^ v >>> 14) >>> 0) / 4294967296;
    }
    // Preserve the saved tree's existing picture. The balanced border bag is
    // shuffled once, rather than repeating a species every second/third site.
    for (var i = 1; i < count; i++) rows.push(KINDS[i % KINDS.length]);
    for (var j = rows.length - 1; j > 0; j--) {
      var at = Math.floor(random() * (j + 1)), swap = rows[j]; rows[j] = rows[at]; rows[at] = swap;
    }
    rows.unshift('tree');
    return Object.freeze(rows);
  }
  return Object.freeze({ revision: 'tree-variety1', kinds: KINDS, seed: SEED, plan: plan });
}));

/* Stable original-art selection; authored shop-family mixture, no placement or game state. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetTownTreeVariety = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // Keep the three saved originals; the pointed-leaf grove is an additional kind.
  var KINDS = Object.freeze(['tree', 'treeApple', 'treeBirch', 'treeGrove']);
  var SEED = 'village-shop-style-v1';
  var PROFILE = Object.freeze(['treeGrove', 'tree', 'treeApple', 'treeBirch']);
  var WEIGHTS = Object.freeze([12, 5, 5, 5]);
  var COUNTS_27 = Object.freeze({ treeGrove: 12, tree: 5, treeApple: 5, treeBirch: 5 });
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
    var state = seedValue(options.seed === undefined ? SEED : options.seed), rows = [], counts = [], total = 0;
    // Proportional small previews retain every old kind when at least four
    // sites exist. At 27 sites this is exactly 12 grove + 5 of each saved kind.
    for (var i = 0; i < PROFILE.length; i++) {
      counts[i] = Math.max(i === 0 || count >= 4 ? 1 : 0, Math.floor(count * WEIGHTS[i] / 27));
      total += counts[i];
    }
    while (total < count) {
      var best = 0;
      for (var i = 1; i < PROFILE.length; i++) {
        if (count * WEIGHTS[i] / 27 - counts[i] > count * WEIGHTS[best] / 27 - counts[best]) best = i;
      }
      counts[best]++; total++;
    }
    // The latest owner reference is the central picture; the previous picture
    // and its original bytes remain available in the mixed border.
    counts[0]--;
    for (var i = 0; i < PROFILE.length; i++) for (var n = 0; n < counts[i]; n++) rows.push(PROFILE[i]);
    function random() {
      state = (state + 0x6d2b79f5) >>> 0;
      var v = Math.imul(state ^ state >>> 15, state | 1);
      v ^= v + Math.imul(v ^ v >>> 7, v | 61);
      return ((v ^ v >>> 14) >>> 0) / 4294967296;
    }
    for (var j = rows.length - 1; j > 0; j--) {
      var at = Math.floor(random() * (j + 1)), swap = rows[j]; rows[j] = rows[at]; rows[at] = swap;
    }
    rows.unshift('treeGrove');
    return Object.freeze(rows);
  }
  return Object.freeze({ revision: 'tree-variety1', shopStyleRevision: 'shop-style1',
    kinds: KINDS, primaryKind: 'treeGrove', counts27: COUNTS_27, seed: SEED, plan: plan });
}));

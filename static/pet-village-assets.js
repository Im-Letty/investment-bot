/* Append future versioned recipe banks here; never rewrite a successful v1 recipe. */
(function (root, factory) {
  'use strict';
  var bank = typeof module === 'object' && module.exports ? require('./pet-village-assets-v1.js') : root.PetVillageAssetsV1;
  var api = factory(bank);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetVillageAssets = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (bank) {
  'use strict';
  if (!bank || typeof bank.build !== 'function') throw new Error('village_asset_recipe_bank_unavailable');
  return Object.freeze({ catalogue: bank.catalogue, get: bank.get, build: bank.build,
    collisionCircle: bank.collisionCircle, intersects: bank.intersects, recipeVersion: 1,
    recipeFiles: Object.freeze(['static/pet-village-assets-v1.js']) });
}));

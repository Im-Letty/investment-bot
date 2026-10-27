/* Exact placement-editor originals in world space. No geometry, game state, storage or art edits. */
(function (root, factory) {
  'use strict'; var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetTownPlacementOriginals = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  var REVISION = 'placement-originals1', ALPHA_TEST = 8 / 255;
  function asset(url, sha256, width, height, bounds, rootPixels) {
    var spec = { url: '/static/' + url, sha256: sha256, width: width, height: height,
      alphaBounds: Object.freeze(bounds), alphaThreshold: 8 };
    if(rootPixels) {
      if(!Array.isArray(rootPixels)||rootPixels.length!==2||rootPixels.some(function(n){return typeof n!=='number'||!Number.isFinite(n);})||
        rootPixels[0]<0||rootPixels[0]>width||rootPixels[1]<0||rootPixels[1]>height)throw new Error('placement_originals_ground_anchor');
      spec.groundAnchor=Object.freeze([rootPixels[0]/width,rootPixels[1]/height]);
    }
    return Object.freeze(spec);
  }
  var catalog = Object.freeze({
    home: asset('pet-items-v1/house.webp', '69ce8c93823a50c5f2225414d4df8adcfe92fcd271ae113982e64f7ccd01cd60', 384, 384, [38, 51, 349, 340]),
    cafe: asset('pet-village-art/cafe.webp', '86ebde4ab01135291d6f7135296686f10aefc64187ac7acf4043f585c29a879d', 384, 384, [29, 47, 362, 347]),
    shop: asset('pet-village-art/shop.webp', '25ea663a1132f09b55329ed326f881a601162689d962ff084a6c653359d61e85', 384, 384, [26, 27, 366, 360]),
    tree: asset('pet-village-art/tree-v2.webp', 'f2f13fd18a0b27cec312c10b2f9dc55694d98072f06b8c52c5a56b25210e03a1', 512, 480, [39, 42, 475, 448]),
    treeApple: asset('pet-village-art/tree-orchard-apple-v1.png', 'ce7ef7adda439841a3fc36de04d5250eb01249ce653337f19b6d9520b028c45b', 1254, 1254, [29, 42, 1236, 1183], [660, 1182]),
    treeBirch: asset('pet-village-art/tree-silver-birch-v1.png', 'ed3a42025eab7a46069550b2b727bc08777053c67a76e2cd5d2b7008d2c51fb0', 1254, 1254, [212, 14, 1131, 1236], [705, 1235]),
    flowers: asset('pet-village-art/flowerbed-v2.webp', 'ac4d6a5aa031054a4d3338ca044718a2d8a82ca83568ea8ae3507e669adebfaf', 512, 341, [37, 55, 476, 293]),
    fountain: asset('pet-items-v1/fountain.webp', 'b7394422852121b2d5b971fb42f82de6b9eb6460cb1b8bff5979b7e39d205006', 384, 384, [40, 40, 344, 342]),
    lantern: asset('pet-items-v1/lantern.webp', 'fcddf79bb51dfd6c892e6f84101f2b59c2bd96b2085fc5339e727232f472a2da', 384, 384, [57, 38, 325, 351]),
    // New grove art and an existing shop tulip; old catalog rows stay untouched.
    // Anchors are authored image baselines, not body/physical contact measurements.
    treeGrove: asset('pet-village-art/tree-shop-grove-v1.png', 'fbd36580f164bb32409de1678d4eddc7f302b197e7d5b81a60f09643a75721b0', 1254, 1254, [55, 42, 1221, 1214], [610, 1213]),
    shopTulip: asset('pet-items-v1/flower.webp', 'f3303351c1e33b84905225edff5dcb361cf049542ad4289b324c4ff588551ab6', 384, 384, [70, 14, 312, 369], [195.5, 368])
  });
  var aliases = Object.freeze({ garden: 'flowers', playground: 'fountain' }), kinds = Object.freeze(Object.keys(catalog));
  function canonical(kind) {
    var key = Object.prototype.hasOwnProperty.call(aliases, kind) ? aliases[kind] : kind;
    if (!Object.prototype.hasOwnProperty.call(catalog, key)) throw new Error('placement_originals_kind');
    return key;
  }
  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
  function imageSize(image) {
    if (!image || image.complete === false) return null;
    var width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    return Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0 ? { width: width, height: height } : null;
  }
  // Resource sets belong to the enclosing scene. Borrowed preloaded textures are
  // cloned; their image object and pixels remain unchanged. Loader results transfer ownership.
  function create(T, ctx) {
    if (!T || !T.Sprite || !T.SpriteMaterial || !ctx || !ctx.textures || !ctx.materials ||
        typeof ctx.textures.add !== 'function' || typeof ctx.textures.delete !== 'function' ||
        typeof ctx.materials.add !== 'function' || typeof ctx.materials.delete !== 'function') throw new Error('placement_originals_context');
    var state = 'idle', failure = null, pending = null, rejectPending = null;
    var textures = new Map(), materials = new Map(), sprites = new Set(), ownedTextures = new Set(), ownedMaterials = new Set();
    function alive() { if (state === 'disposed') throw new Error('placement_originals_disposed'); }
    function validate(texture, kind) {
      var size = texture && texture.isTexture ? imageSize(texture.image) : null, spec = catalog[kind];
      if (!size || size.width !== spec.width || size.height !== spec.height) throw new Error('placement_originals_image:' + kind);
      return texture;
    }
    function own(texture, kind) {
      texture.colorSpace = T.SRGBColorSpace; texture.premultiplyAlpha = false;
      texture.wrapS = T.ClampToEdgeWrapping; texture.wrapT = T.ClampToEdgeWrapping;
      texture.offset.set(0, 0); texture.repeat.set(1, 1); texture.center.set(0, 0); texture.rotation = 0;
      texture.magFilter = T.LinearFilter; texture.minFilter = T.LinearMipmapLinearFilter; texture.generateMipmaps = true;
      texture.userData = Object.assign({}, texture.userData, { originalArt: true, originalArtKind: kind, sourceUrl: catalog[kind].url, sourceSHA256: catalog[kind].sha256 });
      texture.needsUpdate = true; ctx.textures.add(texture); ownedTextures.add(texture); textures.set(kind, texture); return texture;
    }
    function hide() { sprites.forEach(function (sprite) { sprite.visible = false; }); }
    function dropTextures() {
      materials.forEach(function (material) { material.map = null; material.needsUpdate = true; });
      ownedTextures.forEach(function (texture) { ctx.textures.delete(texture); texture.dispose(); });
      ownedTextures.clear(); textures.clear();
    }
    function install() {
      kinds.forEach(function (kind) { if (!textures.has(kind)) throw new Error('placement_originals_missing:' + kind); });
      materials.forEach(function (material, kind) { material.map = textures.get(kind); material.needsUpdate = true; });
      state = 'ready'; sprites.forEach(function (sprite) { sprite.visible = true; });
    }
    if (ctx.loadedTextures !== undefined) {
      if (!(ctx.loadedTextures instanceof Map)) throw new Error('placement_originals_preloaded_map');
      try {
        // Validate the complete set before taking ownership of any clone.
        kinds.forEach(function (kind) { validate(ctx.loadedTextures.get(kind) || ctx.loadedTextures.get(catalog[kind].url), kind); });
        kinds.forEach(function (kind) { own((ctx.loadedTextures.get(kind) || ctx.loadedTextures.get(catalog[kind].url)).clone(), kind); });
        install();
      } catch (error) { dropTextures(); throw error; }
    }
    function materialFor(kind) {
      if (!materials.has(kind)) {
        var material = new T.SpriteMaterial({ color: 0xffffff, map: state === 'ready' ? textures.get(kind) : null,
          transparent: true, opacity: 1, alphaTest: ALPHA_TEST, depthTest: true, depthWrite: true,
          fog: false, toneMapped: false, rotation: 0 });
        material.name = 'placement-original-material-' + kind;
        material.userData = { originalArt: true, originalArtKind: kind, sourceSHA256: catalog[kind].sha256 };
        materials.set(kind, material); ownedMaterials.add(material); ctx.materials.add(material);
      }
      return materials.get(kind);
    }
    function createSprite(kind, options) {
      alive(); var key = canonical(kind), spec = catalog[key]; options = options || {};
      if (!finite(options.width) || options.width <= 0) throw new Error('placement_originals_width');
      var point = options.position || { x: 0, y: 0, z: 0 };
      if (![point.x, point.y, point.z].every(finite)) throw new Error('placement_originals_position');
      var sprite = new T.Sprite(materialFor(key)), bounds = spec.alphaBounds;
      sprite.name = 'placement-original-' + key; sprite.visible = state === 'ready';
      var groundAnchor=spec.groundAnchor;
      sprite.center.set(groundAnchor?groundAnchor[0]:(bounds[0] + bounds[2]) / (2 * spec.width), groundAnchor?1-groundAnchor[1]:1 - bounds[3] / spec.height);
      sprite.scale.set(options.width, options.width * spec.height / spec.width, 1);
      sprite.position.set(point.x, point.y, point.z); sprite.castShadow = false; sprite.receiveShadow = false;
      sprite.userData = { kind: kind, originalArtKind: key, originalArt: true, collisionIndependent: true,
        sourceUrl: spec.url, sourceSHA256: spec.sha256, sourceWidth: spec.width, sourceHeight: spec.height,
        alphaBounds: spec.alphaBounds, groundAnchor:spec.groundAnchor||null, alphaThreshold: spec.alphaThreshold, artRepresentation: 'original-2d-in-world-space' };
      sprites.add(sprite); return sprite;
    }
    function loadOne(loader, kind) {
      var spec = catalog[kind];
      return new Promise(function (resolve, reject) {
        var settled = false;
        function failed() { if (settled) return; settled = true; reject(new Error('placement_originals_load_failed:' + kind)); }
        function loaded(texture) {
          if (settled) return; settled = true;
          if (state === 'disposed' || state === 'failed') { if (texture && texture.isTexture) texture.dispose(); reject(new Error('placement_originals_' + state)); return; }
          try { validate(texture, kind); own(texture, kind); resolve(texture); }
          catch (_) { if (texture && texture.isTexture) texture.dispose(); reject(new Error('placement_originals_image:' + kind)); }
        }
        try {
          if (loader && typeof loader.loadAsync === 'function') Promise.resolve(loader.loadAsync(spec.url)).then(loaded, failed);
          else if (loader && typeof loader.load === 'function') loader.load(spec.url, loaded, undefined, failed);
          else failed();
        } catch (_) { failed(); }
      });
    }
    function preload(loader) {
      if (state === 'disposed') return Promise.reject(new Error('placement_originals_disposed'));
      if (state === 'ready') return Promise.resolve(api);
      if (state === 'failed') return pending || Promise.reject(new Error(failure));
      if (pending) return pending;
      state = 'loading';
      pending = new Promise(function (resolve, reject) {
        rejectPending = reject;
        Promise.all(kinds.map(function (kind) { return loadOne(loader, kind); })).then(function () {
          if (state === 'disposed') { reject(new Error('placement_originals_disposed')); return; }
          try { install(); rejectPending = null; resolve(api); }
          catch (error) { state = 'failed'; failure = error.message; hide(); dropTextures(); rejectPending = null; reject(error); }
        }, function (error) {
          if (state !== 'disposed') { state = 'failed'; failure = error.message; }
          hide(); dropTextures(); rejectPending = null; reject(error);
        });
      });
      return pending;
    }
    function dispose() {
      if (state === 'disposed') return;
      state = 'disposed'; hide(); dropTextures();
      ownedMaterials.forEach(function (material) { ctx.materials.delete(material); material.dispose(); });
      ownedMaterials.clear(); materials.clear(); sprites.clear();
      if (rejectPending) { var reject = rejectPending; rejectPending = null; reject(new Error('placement_originals_disposed')); }
    }
    var api = Object.freeze({ revision: REVISION, createSprite: createSprite, preload: preload, dispose: dispose,
      has: function (kind) { return state === 'ready' && textures.has(canonical(kind)); },
      textureFor: function (kind) { alive(); return state === 'ready' ? textures.get(canonical(kind)) : null; },
      get state() { return state; }, get ready() { return state === 'ready'; }, get error() { return failure; } });
    return api;
  }
  return Object.freeze({ revision: REVISION, treeVarietyRevision:'tree-variety1', shopStyleRevision:'shop-style1', catalog: catalog, aliases: aliases, kinds: kinds, alphaTest: ALPHA_TEST,
    resolve: function (kind) { return catalog[canonical(kind)]; }, create: create });
}));

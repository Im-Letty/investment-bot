/* Canonical 2D frame dimensions/contact only. No artwork, game state or storage. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetFrameFit = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var HEIGHT = 1.65;
  function dimension(value) { return Number.isSafeInteger(value) && value > 0; }
  function contact(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1; }
  function sourceSize(source) {
    if (!source) return null;
    var image = source.tagName === 'IMG', canvas = source.tagName === 'CANVAS';
    if (!canvas && (!image || !source.complete)) return null;
    var width = image ? source.naturalWidth : source.width, height = image ? source.naturalHeight : source.height;
    return dimension(width) && dimension(height) ? { width: width, height: height } : null;
  }
  function alphaAnchor(canvas) {
    var size = sourceSize(canvas);
    if (!size || canvas.tagName !== 'CANVAS') return null;
    var gl = canvas.getContext && canvas.getContext('webgl');
    if (!gl) return null;
    var pixels = new Uint8Array(size.width * size.height * 4);
    gl.readPixels(0, 0, size.width, size.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    for (var y = 0; y < size.height; y++) for (var x = 0; x < size.width; x++) if (pixels[(y * size.width + x) * 4 + 3] >= 31) return y / size.height;
    return null;
  }
  function resolve(source, metadata, previous) {
    var size = sourceSize(source);
    if (!size) return null;
    var same = !!previous && previous.source === source;
    var explicit = metadata != null && Object.prototype.hasOwnProperty.call(metadata, 'anchor');
    var anchor = explicit ? metadata.anchor : same ? previous.anchor : source.tagName === 'IMG' ? .08 : alphaAnchor(source);
    if (!contact(anchor)) return null;
    var width = HEIGHT * size.width / size.height;
    if (!Number.isFinite(width) || width <= 0) return null;
    return { source: source, width: size.width, height: size.height, anchor: anchor,
      worldWidth: width, worldHeight: HEIGHT,
      changed: !same || size.width !== previous.width || size.height !== previous.height || anchor !== previous.anchor };
  }
  return Object.freeze({ sourceSize: sourceSize, alphaAnchor: alphaAnchor, resolve: resolve, worldHeight: HEIGHT });
}));

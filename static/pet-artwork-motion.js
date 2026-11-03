/* Small image-space poses for the saved front artwork used in the village. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetArtworkMotion = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var TAU = 2 * Math.PI;
  var parts = Object.freeze(['leftEye', 'rightEye', 'mouth', 'leftEar', 'rightEar', 'leftPaw', 'rightPaw', 'leftFoot', 'rightFoot', 'tail']);
  var profiles = Object.create(null);
  var neutralMoves = Object.freeze(parts.map(function () { return Object.freeze([0, 0, 0]); }));
  // Each ellipse is measured on that particular saved image, top-left origin.
  // An absent entry means the part is hidden, e.g. feet inside a broken shell.
  function add(path, id, ground, regions) {
    profiles['/static/' + path + '.webp'] = Object.freeze({
      id: id, ground: ground,
      zones: Object.freeze(regions.map(function (region) { return region && Object.freeze(region); }))
    });
  }
  var milne = 'pet-characters/milne-original8-v1/';
  add(milne + 'adult', 'milne-adult', .9578125, [
    [.444,.523,.072,.085], [.691,.481,.074,.081], [.577,.598,.077,.061],
    [.162,.375,.153,.227], [.784,.203,.162,.175],
    [.484,.754,.085,.091], [.696,.748,.076,.081],
    [.459,.914,.090,.077], [.667,.914,.079,.077], [.359,.813,.072,.106]
  ]);
  add(milne + 'child', 'milne-child', .9296875, [
    [.452,.523,.069,.075], [.674,.485,.067,.074], [.565,.591,.069,.053],
    [.156,.385,.137,.211], [.780,.266,.133,.165],
    [.467,.748,.072,.079], [.665,.748,.073,.076],
    [.456,.875,.083,.073], [.644,.879,.081,.072], [.356,.796,.077,.094]
  ]);
  add(milne + 'baby', 'milne-baby', .95, [
    [.460,.554,.090,.096], [.699,.526,.082,.100], [.594,.638,.079,.075],
    [.160,.480,.149,.229], [.823,.324,.159,.204],
    [.488,.756,.096,.081], [.736,.750,.100,.083],
    [.463,.882,.101,.096], [.755,.876,.103,.101], [.363,.829,.071,.100]
  ]);
  add(milne + 'newborn', 'milne-newborn', .9359375, [
    [.443,.577,.100,.105], [.696,.537,.087,.104], [.583,.657,.078,.074],
    [.134,.465,.134,.232], [.808,.314,.157,.198],
    [.501,.796,.092,.077], [.674,.787,.081,.081],
    [.481,.882,.100,.088], [.682,.873,.087,.096], [.383,.835,.058,.089]
  ]);
  add(milne + 'egg', 'milne-egg', .9328125, []);
  add('pet_bimg_baby', 'bunny-baby', .92, [
    [.227,.493,.106,.095], [.535,.499,.110,.095], [.379,.589,.090,.057],
    [.248,.181,.146,.189], [.716,.177,.165,.188],
    [.209,.633,.089,.063], [.578,.642,.099,.063], null, null, null
  ]);
  add('pet_bimg_child', 'bunny-child', .92, [
    [.098,.481,.086,.075], [.421,.514,.121,.084], [.254,.565,.090,.052],
    [.167,.173,.138,.192], [.811,.240,.160,.180],
    [.219,.849,.109,.109], [.419,.858,.105,.110],
    null, [.661,.902,.121,.096], [.834,.735,.134,.130]
  ]);
  add('pet_bimg_final', 'bunny-final', .92, [
    [.179,.453,.093,.088], [.399,.457,.101,.089], [.269,.528,.100,.076],
    [.223,.135,.120,.170], [.598,.215,.149,.176],
    [.092,.669,.112,.105], null,
    null, [.314,.887,.134,.126], [.819,.512,.133,.164]
  ]);
  add('pet_bimg_cool', 'bunny-cool', .92, [
    [.353,.441,.066,.068], [.475,.439,.068,.068], [.411,.488,.067,.045],
    [.322,.166,.084,.161], [.592,.160,.135,.168],
    [.211,.599,.088,.101], [.550,.732,.093,.100],
    [.309,.900,.105,.112], [.534,.902,.098,.113], [.741,.482,.106,.111]
  ]);
  add('pet_bimg_egg', 'bunny-egg', .92, []);

  function profile(path) { return profiles[path] || null; }
  function pose(row, milliseconds, distance, walking, still) {
    var result = { state: 'neutral', blink: 0, step: 0, egg: 0, moves: neutralMoves };
    if (!row || still) return result;
    var seconds = (Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0) / 1000;
    var drift = Math.sin(seconds * 2.3);
    if (!row.zones.length) {
      result.state = 'egg';
      result.egg = .021 * drift;
      return result;
    }
    result.state = walking ? 'walking' : 'idle';
    var step = walking && Number.isFinite(distance) ? Math.sin(distance * TAU / .53) : 0;
    var blink = Math.max(0, 1 - Math.abs(seconds % 4.6 - 3.62) / .17);
    result.blink = blink * blink;
    result.step = step;
    var sway = .32 * drift + .68 * step;
    var ears = Math.sin(seconds * 2.3 - .55) * .45 + step * .55;
    result.moves = [
      [0,.006 * sway,2.25 * result.blink], [0,.006 * sway,2.25 * result.blink],
      [.003 * sway,.007 * drift,.20 * drift],
      [.025 * ears,.013 * sway,0], [-.023 * ears,.016 * sway,0],
      [.014 * sway,.020 * sway,0], [-.012 * sway,-.019 * sway,0],
      [.008 * sway, .025 * Math.max(0, step) + .008 * drift,0],
      [-.008 * sway,.025 * Math.max(0,-step) - .008 * drift,0],
      [.021 * Math.sin(seconds * 3.0 + .4) + .009 * step,.012 * sway,0]
    ];
    return result;
  }

  function attach(THREE, material, row) {
    if (!row || !THREE.ShaderChunk || typeof THREE.ShaderChunk.map_fragment !== 'string') return null;
    var zones = parts.map(function (_, i) { return new THREE.Vector4().fromArray(row.zones[i] || [0,0,0,0]); });
    var moves = parts.map(function () { return new THREE.Vector3(); });
    var enabled = { value: 0 }, egg = { value: 0 };
    // Reuse Three's map chunk, including its normal alpha and color handling.
    // The continuous inverse warp leaves all pixels outside these regions alone.
    var map = THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', 'texture2D( map, artworkUv( vMapUv ) )');
    if (map === THREE.ShaderChunk.map_fragment) return null;
    material.onBeforeCompile = function (shader) {
      shader.uniforms.artworkEnabled = enabled;
      shader.uniforms.artworkEgg = egg;
      shader.uniforms.artworkGround = { value: row.ground };
      shader.uniforms.artworkZones = { value: zones };
      shader.uniforms.artworkMoves = { value: moves };
      shader.fragmentShader = [
        'uniform float artworkEnabled, artworkEgg, artworkGround;',
        'uniform vec4 artworkZones[10];',
        'uniform vec3 artworkMoves[10];',
        'vec2 artworkUv(vec2 uv) {',
        '  if (artworkEnabled < .5) return uv;',
        '  vec2 p = vec2(uv.x, 1. - uv.y);',
        '  vec2 delta = vec2(artworkEgg * clamp(artworkGround - p.y, 0., 1.), 0.);',
        '  for (int i = 0; i < 10; ++i) {',
        '    vec4 zone = artworkZones[i];',
        '    if (zone.z > 0.) {',
        '      vec2 offset = p - zone.xy;',
        '      vec2 local = offset / zone.zw;',
        '      float weight = 1. - smoothstep(.10, 1., dot(local, local));',
        '      delta += weight * vec2(-artworkMoves[i].x, artworkMoves[i].y + offset.y * artworkMoves[i].z);',
        '    }',
        '  }',
        // Leave the bottom contact pixels and texture boundary fixed.
        '  delta *= smoothstep(0., .05, artworkGround - p.y);',
        '  delta *= smoothstep(0., .035, min(min(p.x, 1. - p.x), min(p.y, 1. - p.y)));',
        '  p = clamp(p + delta, 0., 1.);',
        '  return vec2(p.x, 1. - p.y);',
        '}',
        shader.fragmentShader.replace('#include <map_fragment>', map)
      ].join('\n');
    };
    material.needsUpdate = true;
    return function update(stamp, distance, walking, still) {
      var next = pose(row, stamp, distance, walking, still);
      enabled.value = next.state === 'neutral' ? 0 : 1;
      egg.value = next.egg;
      next.moves.forEach(function (move, i) { moves[i].fromArray(move); });
      return next;
    };
  }
  return Object.freeze({ profile: profile, pose: pose, attach: attach, parts: parts });
}));

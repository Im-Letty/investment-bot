/* Shop-family water finish: one shared code-authored texture, no new water geometry.
   The enclosing Scene owns ctx.textures and disposes the texture exactly once.
   animate receives the existing OceanLife phase; it never starts its own clock. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetTownWaterFinish = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var REVISION = 'water-finish1', SIZE = 128, TAU = Math.PI * 2;
  var entries = new WeakMap();
  var PALETTE = Object.freeze({
    sea: '#8fc9c0', foam: '#f1ecdf', glint: '#dbeade', shallowTint: '#eef5eb'
  });
  function finite(n) { return typeof n === 'number' && Number.isFinite(n); }
  function material(value) {
    return value && value.isMaterial && value.color && typeof value.color.set === 'function';
  }
  // Far-sea pigment only. It never changes alpha, depth, geometry or a scene light.
  function farFinish(T, ctx, sea) {
    if (!ctx.world) return null;
    var w = ctx.world;
    if (!finite(w.width) || !finite(w.height) || w.width <= 0 || w.height <= 0 ||
        typeof T.Box3 !== 'function' || typeof T.Vector2 !== 'function' ||
        typeof T.Color !== 'function') throw new Error('town_water_finish_far_context_unavailable');
    sea.updateWorldMatrix(true, false);
    var bounds = new T.Box3().setFromObject(sea), cx = (bounds.min.x + bounds.max.x) / 2,
      cz = (bounds.min.z + bounds.max.z) / 2;
    var end = Math.min((bounds.max.x - bounds.min.x) / 2, (bounds.max.z - bounds.min.z) / 2);
    var protectedExtent = Math.max(Math.abs(-w.width / 200 - cx), Math.abs(w.width / 200 - cx),
      Math.abs(-w.height / 200 - cz), Math.abs(w.height / 200 - cz));
    var metrics = ctx.shoreTransition && ctx.shoreTransition.metrics, ground = metrics && metrics.sourceGrassBounds;
    if (ground) protectedExtent = Math.max(protectedExtent, Math.abs(ground.minX - cx), Math.abs(ground.maxX - cx),
      Math.abs(ground.minZ - cz), Math.abs(ground.maxZ - cz));
    protectedExtent += metrics && finite(metrics.shallowMaxOutsideRadial) ? metrics.shallowMaxOutsideRadial : 0;
    var start = Math.max(end * .75, protectedExtent);
    if (![cx, cz, start, end, protectedExtent].every(finite) || !(end > start + .01)) {
      throw new Error('town_water_finish_far_range_unavailable');
    }
    var uniforms = {
      knWFHorizon: { value: new T.Color(PALETTE.sea) }, knWFCenter: { value: new T.Vector2(cx, cz) },
      knWFStart: { value: start }, knWFEnd: { value: end },
      knWFSky: { value: null }, knWFHasSky: { value: 0 }
    };
    var previousCompile = sea.material.onBeforeCompile, previousKey = sea.material.customProgramCacheKey;
    // The default key reads onBeforeCompile.toString(). Preserve its old value
    // before wrapping; genuinely custom dynamic cache keys continue to be called.
    var defaultKey = T.Material && previousKey === T.Material.prototype.customProgramCacheKey;
    var oldDefaultKey = defaultKey ? previousKey.call(sea.material) : null;
    function install() {
      sea.material.onBeforeCompile = function (shader, renderer) {
        previousCompile.call(this, shader, renderer);
        if (shader.vertexShader.indexOf('#include <common>') < 0 ||
            shader.vertexShader.indexOf('#include <project_vertex>') < 0 ||
            shader.fragmentShader.indexOf('#include <common>') < 0 ||
            shader.fragmentShader.indexOf('#include <tonemapping_fragment>') < 0) {
          throw new Error('town_water_finish_shader_unavailable');
        }
        Object.keys(uniforms).forEach(function (key) { shader.uniforms[key] = uniforms[key]; });
        shader.vertexShader = shader.vertexShader.replace('#include <common>',
          '#include <common>\nvarying vec3 vKnWFWorld;').replace('#include <project_vertex>',
          '#include <project_vertex>\nvec4 knWFWorld = vec4( transformed, 1.0 );\n' +
          '#ifdef USE_BATCHING\nknWFWorld = batchingMatrix * knWFWorld;\n#endif\n' +
          '#ifdef USE_INSTANCING\nknWFWorld = instanceMatrix * knWFWorld;\n#endif\n' +
          'vKnWFWorld = ( modelMatrix * knWFWorld ).xyz;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
          '#include <common>\nvarying vec3 vKnWFWorld;\nuniform vec3 knWFHorizon;\n' +
          'uniform vec2 knWFCenter;\nuniform float knWFStart;\nuniform float knWFEnd;\n' +
          'uniform sampler2D knWFSky;\nuniform float knWFHasSky;').replace('#include <tonemapping_fragment>',
          '#include <tonemapping_fragment>\n' +
          'vec2 knWFDelta = abs( vKnWFWorld.xz - knWFCenter );\n' +
          'float knWFBlend = smoothstep( knWFStart, knWFEnd, max( knWFDelta.x, knWFDelta.y ) );\n' +
          'if ( knWFBlend > 0.0 ) {\n' +
          '  vec3 knWFBackground = knWFHorizon;\n' +
          '  if ( knWFHasSky > 0.5 ) {\n' +
          '    vec3 knWFRay = normalize( vKnWFWorld - cameraPosition );\n' +
          '    knWFBackground = texture2D( knWFSky, equirectUv( knWFRay ) ).rgb;\n' +
          '  }\n' +
          '  gl_FragColor.rgb = mix( gl_FragColor.rgb, knWFBackground, knWFBlend );\n' +
          '}');
      };
      sea.material.customProgramCacheKey = function () {
        return (defaultKey ? oldDefaultKey : previousKey.call(this)) + '|water-finish1-far-edge1';
      };
      sea.material.userData.waterFinishFarFade = true; sea.material.needsUpdate = true;
    }
    return {
      install: install, start: start, end: end, protectedExtent: protectedExtent,
      setHorizonColor: function (color) {
        if (typeof color !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) throw new Error('town_water_finish_horizon_unavailable');
        var before = uniforms.knWFHorizon.value.getHexString();
        uniforms.knWFHorizon.value.set(color); return before !== uniforms.knWFHorizon.value.getHexString();
      },
      setSkyTexture: function (texture) {
        if (texture !== null && (!texture || !texture.isTexture || texture.isCubeTexture)) throw new Error('town_water_finish_sky_unavailable');
        var changed = uniforms.knWFSky.value !== texture;
        uniforms.knWFSky.value = texture; uniforms.knWFHasSky.value = texture ? 1 : 0; return changed;
      },
      summary: function () { return { enabled: true, start: start, end: end, protectedExtent: protectedExtent,
        horizonColor: '#' + uniforms.knWFHorizon.value.getHexString(), existingSkyTextureBound: !!uniforms.knWFSky.value,
        localSeaPigmentOnly: true, alphaDepthAndNearWaterUnchanged: true }; }
    };
  }
  function create(T, ctx) {
    var sea = ctx && ctx.sea, textures = ctx && ctx.textures;
    if (!T || typeof T.DataTexture !== 'function' || !ctx || !sea || !sea.isMesh ||
        !material(sea.material) || !sea.material.isMeshStandardMaterial ||
        !textures || typeof textures.add !== 'function' || typeof textures.has !== 'function') {
      throw new Error('town_water_finish_context_unavailable');
    }
    var foams = [], glints = [], shallows = [], ocean = ctx.oceanLife, shore = ctx.shoreTransition;
    if (ocean) {
      if (!ocean.group || !ocean.group.isObject3D) throw new Error('town_water_finish_context_unavailable');
      ocean.group.children.forEach(function (m) {
        if (/^incoming-shore-foam-[0-9]+$/.test(m.name)) foams.push(m.material);
        else if (m.name === 'ocean-surface-glints') glints.push(m.material);
      });
    }
    if (shore) {
      if (!Array.isArray(shore.shallowMeshes)) throw new Error('town_water_finish_context_unavailable');
      shore.shallowMeshes.forEach(function (m) { if (!m || !m.isMesh) throw new Error('town_water_finish_context_unavailable'); shallows.push(m.material); });
    }
    if (!foams.concat(glints, shallows).every(material)) throw new Error('town_water_finish_material_unavailable');
    var prior = entries.get(sea);
    if (prior) {
      if (prior.textures !== textures || prior.ocean !== ocean || prior.shore !== shore || prior.world !== ctx.world ||
          sea.material.map !== prior.api.texture || sea.material.bumpMap !== prior.api.texture ||
          !textures.has(prior.api.texture)) throw new Error('town_water_finish_conflict');
      return prior.api;
    }
    var far = farFinish(T, ctx, sea);
    // Each term is periodic in u/v: repeats have no random boundary or shared
    // wood/stone texture. Contrast is deliberately small beside the old foam.
    var pixels = new Uint8Array(SIZE * SIZE * 4), low = 255, high = 0;
    for (var y = 0; y < SIZE; y++) for (var x = 0; x < SIZE; x++) {
      var u = x / SIZE, v = y / SIZE;
      var wave = .48 * Math.sin(TAU * (3 * u + v) + .5 * Math.sin(TAU * (u - 2 * v))) +
        .32 * Math.cos(TAU * (u - 3 * v) + .4 * Math.sin(TAU * (2 * u + v))) +
        .20 * Math.sin(TAU * (5 * u + 2 * v));
      var crest = Math.pow(Math.max(0, 1 - Math.abs(wave)), 8);
      var grain = (Math.sin(TAU * (29 * u + 37 * v)) + Math.cos(TAU * (43 * u - 31 * v))) * .25;
      var tone = Math.max(0, Math.min(1, .5 + .32 * wave + .10 * crest + .05 * grain));
      var i = (y * SIZE + x) * 4;
      pixels[i] = 235 + Math.round(12 * tone);
      pixels[i + 1] = 237 + Math.round(11 * tone);
      pixels[i + 2] = 232 + Math.round(12 * tone); pixels[i + 3] = 255;
      low = Math.min(low, pixels[i], pixels[i + 1], pixels[i + 2]);
      high = Math.max(high, pixels[i], pixels[i + 1], pixels[i + 2]);
    }
    var texture = new T.DataTexture(pixels, SIZE, SIZE, T.RGBAFormat);
    texture.name = 'shop-family-water-grain';
    // Linear near-white modulation also supplies height. It is not source art;
    // NoColorSpace keeps these multiplier/height bytes linear so the material
    // tint is not unintentionally darkened by an sRGB image conversion.
    texture.colorSpace = T.NoColorSpace;
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.minFilter = texture.magFilter = T.LinearFilter;
    texture.generateMipmaps = false;
    texture.repeat.set(12, 12);
    texture.userData.waterFinishRevision = REVISION;
    texture.userData.codeAuthored = true;
    texture.userData.disposalOwner = 'scene-texture-set';
    texture.userData.encoding = 'linear-near-white-modulation-and-height';
    texture.needsUpdate = true;
    textures.add(texture);
    sea.material.map = texture; sea.material.bumpMap = texture;
    sea.material.bumpScale = .006; sea.material.roughness = .30; sea.material.metalness = 0;
    sea.material.color.set(PALETTE.sea);
    sea.material.userData.waterFinishRevision = REVISION;
    sea.material.userData.waterFinishColor = PALETTE.sea;
    sea.material.needsUpdate = true;
    foams.forEach(function (m) { m.color.set(PALETTE.foam); });
    glints.forEach(function (m) { m.color.set(PALETTE.glint); });
    shallows.forEach(function (m) { m.color.set(PALETTE.shallowTint); });
    if (far) far.install();
    var dead = false, lastPhase = null, lastReduced = null, season = 'summer';
    texture.addEventListener('dispose', function () { dead = true; entries.delete(sea); });
    function animate(phase, reduced) {
      if (dead) return false;
      var still = !!reduced, p = still ? 0 : (Math.max(0, finite(phase) ? phase : 0) % 1);
      if (p === lastPhase && still === lastReduced) return true;
      // Both position and derivative meet at phase0/1. There is no linear
      // fractional scroll reset and no second timing source.
      texture.offset.set(Math.sin(p * TAU) * .014, (Math.cos(p * TAU) - 1) * .010);
      texture.updateMatrix();
      lastPhase = p; lastReduced = still; return true;
    }
    animate(0, true);
    var api = Object.freeze({
      revision: REVISION, texture: texture, animate: animate, resourceOwner: 'scene-texture-set',
      setHorizonColor: function (color) { return !dead && far ? far.setHorizonColor(color) : false; },
      setSkyTexture: function (texture) { return !dead && far ? far.setSkyTexture(texture) : false; },
      setSeason: function (key) {
        if (['spring', 'summer', 'autumn', 'winter'].indexOf(key) < 0) throw new Error('town_water_finish_season_unavailable');
        if (dead || key === season) return false;
        // The same natural water finish is shared by all seasons. This records
        // the current presentation only; no freeze/weather or water-level model.
        season = key; return true;
      },
      summary: function () { return { revision: REVISION, colors: PALETTE, metrics: api.metrics,
        phase: lastPhase, reduced: lastReduced, season: season, disposed: dead, resourceOwner: 'scene-texture-set',
        farFade: far ? far.summary() : { enabled: false, reason: 'world-not-provided' } }; },
      colors: PALETTE,
      metrics: Object.freeze({ textures: 1, textureSize: SIZE, textureBytes: pixels.length,
        channelMin: low, channelMax: high, materialMapAndBumpShared: true,
        foamMaterials: foams.length, glintMaterials: glints.length, shallowMaterials: shallows.length,
        geometriesAdded: 0, lightsAdded: 0, clocksAdded: 0, repeat: 12,
        farFadeEnabled: !!far, farFadeStart: far ? far.start : null, farFadeEnd: far ? far.end : null,
        seaRoughness: .30, bumpScale: .006, maxOffsetX: .014, maxOffsetY: .020,
        phaseSource: 'existing-ocean-diagnostics', alphaMapPreserved: true,
        waterGeometryAndDepthOrderPreserved: true })
    });
    entries.set(sea, { textures: textures, ocean: ocean, shore: shore, world: ctx.world, api: api });
    return api;
  }
  return Object.freeze({ revision: REVISION, colors: PALETTE, create: create });
}));

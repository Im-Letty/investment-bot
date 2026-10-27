/* Small presentation-only water motion for the village's solid two-bowl fountain. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetTownWaterLife = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  var REVISION = 'fountain-water-life1', TAU = Math.PI * 2;
  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }

  // y is the visible water surface top, in fountain-local world units. Legacy
  // values retain the previous poses exactly when an older Scene has no spec.
  var LEGACY_SURFACES = Object.freeze({
    lower: Object.freeze({ y: .475, radius: .61, depthRatio: .75, rimY: .536, ringY: .478, maximumRadius: .585 }),
    upper: Object.freeze({ y: 1.001, radius: .28, depthRatio: .75, rimY: 1.038, ringY: 1.004, maximumRadius: .25 })
  });
  function waterSurfaces(value) {
    if (value === undefined) return LEGACY_SURFACES;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('town_water_surfaces_invalid');
    var result = {}, keys = ['lower', 'upper'];
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i], spec = value[key];
      if (!spec || typeof spec !== 'object' || Array.isArray(spec) ||
          !finite(spec.y) || spec.y < 0 || spec.y > 16 ||
          !finite(spec.radius) || spec.radius < .08 || spec.radius > 4 ||
          !finite(spec.depthRatio) || spec.depthRatio < .125 || spec.depthRatio > 4 ||
          !finite(spec.rimY) || spec.rimY <= spec.y + .006 || spec.rimY > 16) {
        throw new Error('town_water_surfaces_invalid');
      }
      // Copy the authored values once; later caller changes cannot move water
      // away from the actual basin. The torus tube stays inside its water disc.
      result[key] = Object.freeze({
        y: spec.y, radius: spec.radius, depthRatio: spec.depthRatio, rimY: spec.rimY,
        ringY: spec.y + .003, maximumRadius: spec.radius - (key === 'lower' ? .025 : .03)
      });
    }
    return Object.freeze(result);
  }
  function create(THREE, ctx) {
    if (!THREE || !ctx || !ctx.fountain || !ctx.fountain.isObject3D ||
        !ctx.materials || typeof ctx.materials.add !== 'function' ||
        !ctx.geometries || typeof ctx.geometries.add !== 'function' ||
        ['Group', 'TorusGeometry', 'MeshStandardMaterial', 'Mesh'].some(function (key) { return typeof THREE[key] !== 'function'; })) {
      throw new Error('town_water_context_unavailable');
    }
    var surfaces = waterSurfaces(ctx.fountain.userData.fountainWaterSurfaces);
    var group = new THREE.Group(), rows = [], jet = ctx.fountain.getObjectByName('fountain-top-jet');
    group.name = 'fountain-water-life';
    group.userData.waterLifeRevision = REVISION;
    group.userData.noStaticBatch = true;
    ctx.fountain.add(group);
    // One shared closed ripple shape; three meshes follow the Scene's actual
    // water surface spec, with no new lights, textures or droplet animation.
    var geometry = new THREE.TorusGeometry(1, .006, 3, 24);
    geometry.userData.waterLifeRevision = REVISION;
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    ctx.geometries.add(geometry);
    [[surfaces.lower, 0, 'lower'], [surfaces.lower, .5, 'lower'], [surfaces.upper, .25, 'upper']].forEach(function (spec, index) {
      var material = new THREE.MeshStandardMaterial({
        color: '#eff2e9', emissive: '#dce4df', emissiveIntensity: .10,
        roughness: .24, metalness: 0, transparent: true, opacity: 0, depthWrite: false
      });
      material.userData.waterLifeRevision = REVISION;
      material.userData.surfaceRole = 'fountain-water-ripple';
      ctx.materials.add(material);
      var ring = new THREE.Mesh(geometry, material);
      ring.name = 'fountain-' + spec[2] + '-moving-ripple-' + index;
      ring.position.y = spec[0].ringY; ring.rotation.x = -Math.PI / 2;
      ring.castShadow = false; ring.receiveShadow = false;
      ring.userData.noStaticBatch = true; ring.userData.nonSolidWater = true;
      group.add(ring); rows.push({ mesh: ring, maximumRadius: spec[0].maximumRadius, depthRatio: spec[0].depthRatio, phase: spec[1] });
    });
    var baseJetScale = jet ? jet.scale.clone() : null;
    if (jet) {
      jet.userData.noStaticBatch = true; jet.userData.nonSolidWater = true;
      jet.castShadow = false;
    }
    // Reuse the diagnostics object as well as all render resources per frame.
    var frame = { time: 0, reduced: true, ringCount: rows.length };
    function animate(ms, reduced) {
      var time = reduced ? 0 : Math.max(0, finite(ms) ? ms : 0) / 1000;
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i], progress = (time * .38 + row.phase) % 1;
        // Fade out before wrapping to the centre, avoiding a visible jump.
        var radius = .035 + (row.maximumRadius - .035) * progress;
        row.mesh.scale.set(radius, radius * row.depthRatio, .35);
        row.mesh.material.opacity = .34 * Math.pow(Math.sin(Math.PI * progress), 2);
        row.mesh.updateMatrixWorld(true);
      }
      if (jet && baseJetScale) {
        // Pulse within the original jet envelope; the eight existing falling
        // droplets retain their separate scene update and are never duplicated.
        var horizontal = reduced ? 1 : .94 + .06 * Math.cos(time * 2.1);
        var vertical = reduced ? 1 : .90 + .10 * Math.sin(time * 2.1);
        jet.scale.set(baseJetScale.x * horizontal, baseJetScale.y * vertical, baseJetScale.z * horizontal);
        jet.updateMatrixWorld(true);
      }
      frame.time = time; frame.reduced = !!reduced; return frame;
    }
    animate(0, true);
    return Object.freeze({
      revision: REVISION, group: group, dynamicRoots: Object.freeze([group]),
      animate: animate, resourceOwner: 'scene', ringCount: rows.length,
      surfaces: surfaces, surfaceMode: surfaces === LEGACY_SURFACES ? 'legacy' : 'authored',
      addedTriangles: geometry.index.count / 3 * rows.length
    });
  }
  return Object.freeze({ revision: REVISION, create: create });
}));

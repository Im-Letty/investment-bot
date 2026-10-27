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
  function create(THREE, ctx) {
    if (!THREE || !ctx || !ctx.fountain || !ctx.fountain.isObject3D ||
        !ctx.materials || typeof ctx.materials.add !== 'function' ||
        !ctx.geometries || typeof ctx.geometries.add !== 'function' ||
        ['Group', 'TorusGeometry', 'MeshStandardMaterial', 'Mesh'].some(function (key) { return typeof THREE[key] !== 'function'; })) {
      throw new Error('town_water_context_unavailable');
    }
    var group = new THREE.Group(), rows = [], jet = ctx.fountain.getObjectByName('fountain-top-jet');
    group.name = 'fountain-water-life';
    group.userData.waterLifeRevision = REVISION;
    group.userData.noStaticBatch = true;
    ctx.fountain.add(group);
    // One shared closed ripple shape; three low-cost meshes stay inside the
    // existing .61/.28 water discs and the bowl's .75 depth proportion.
    var geometry = new THREE.TorusGeometry(1, .006, 3, 24);
    geometry.userData.waterLifeRevision = REVISION;
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    ctx.geometries.add(geometry);
    [[.478, .585, 0, 'lower'], [.478, .585, .5, 'lower'], [1.004, .25, .25, 'upper']].forEach(function (spec, index) {
      var material = new THREE.MeshStandardMaterial({
        color: '#eff2e9', emissive: '#dce4df', emissiveIntensity: .10,
        roughness: .24, metalness: 0, transparent: true, opacity: 0, depthWrite: false
      });
      material.userData.waterLifeRevision = REVISION;
      material.userData.surfaceRole = 'fountain-water-ripple';
      ctx.materials.add(material);
      var ring = new THREE.Mesh(geometry, material);
      ring.name = 'fountain-' + spec[3] + '-moving-ripple-' + index;
      ring.position.y = spec[0]; ring.rotation.x = -Math.PI / 2;
      ring.castShadow = false; ring.receiveShadow = false;
      ring.userData.noStaticBatch = true; ring.userData.nonSolidWater = true;
      group.add(ring); rows.push({ mesh: ring, maximumRadius: spec[1], phase: spec[2] });
    });
    var baseJetScale = jet ? jet.scale.clone() : null;
    if (jet) {
      jet.userData.noStaticBatch = true; jet.userData.nonSolidWater = true;
      jet.castShadow = false;
    }
    function animate(ms, reduced) {
      var time = reduced ? 0 : Math.max(0, finite(ms) ? ms : 0) / 1000;
      rows.forEach(function (row) {
        var progress = (time * .38 + row.phase) % 1;
        // Fade out before wrapping to the centre, avoiding a visible jump.
        var radius = .035 + (row.maximumRadius - .035) * progress;
        row.mesh.scale.set(radius, radius * .75, .35);
        row.mesh.material.opacity = .34 * Math.pow(Math.sin(Math.PI * progress), 2);
        row.mesh.updateMatrixWorld(true);
      });
      if (jet && baseJetScale) {
        // Pulse within the original jet envelope; the eight existing falling
        // droplets retain their separate scene update and are never duplicated.
        var horizontal = reduced ? 1 : .94 + .06 * Math.cos(time * 2.1);
        var vertical = reduced ? 1 : .90 + .10 * Math.sin(time * 2.1);
        jet.scale.set(baseJetScale.x * horizontal, baseJetScale.y * vertical, baseJetScale.z * horizontal);
        jet.updateMatrixWorld(true);
      }
      return { time: time, reduced: !!reduced, ringCount: rows.length };
    }
    animate(0, true);
    return Object.freeze({
      revision: REVISION, group: group, dynamicRoots: Object.freeze([group]),
      animate: animate, resourceOwner: 'scene', ringCount: rows.length,
      addedTriangles: geometry.index.count / 3 * rows.length
    });
  }
  return Object.freeze({ revision: REVISION, create: create });
}));

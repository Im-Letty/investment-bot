/* Bounded presentation-only foam and glints along the existing grassy shoreline. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetTownOceanLife = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  var REVISION = 'ocean-motion1', UNIT = 100, TAU = Math.PI * 2;
  var PERIOD_MS = 6000, SEA_HALF_EXTENT = 24, FOAM_COUNT = 3, GLINT_COUNT = 12;
  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
  function create(THREE, ctx) {
    var world = ctx && ctx.world, shore = ctx && ctx.shoreline;
    if (!THREE || !ctx || !ctx.group || !ctx.group.isObject3D ||
        !world || !finite(world.width) || !finite(world.height) || world.width <= 0 || world.height <= 0 ||
        !Array.isArray(shore) || shore.length < 2 ||
        !ctx.geometries || typeof ctx.geometries.add !== 'function' ||
        !ctx.materials || typeof ctx.materials.add !== 'function' ||
        ['Group', 'BufferGeometry', 'Float32BufferAttribute', 'PlaneGeometry', 'MeshBasicMaterial',
         'Mesh', 'InstancedMesh', 'Matrix4', 'Vector3'].some(function (key) { return typeof THREE[key] !== 'function'; })) {
      throw new Error('town_ocean_context_unavailable');
    }
    // Validate the entire coast before allocating GPU resources or attaching a
    // group. The current sea is the existing 48-unit square centred at zero.
    for (var i = 0; i < shore.length; i++) {
      var row = shore[i];
      if (!Array.isArray(row) || row.length !== 2 || !finite(row[0]) || !finite(row[1]) ||
          row[0] < 0 || row[0] > world.height || row[1] < 0 || row[1] > world.width ||
          (i && row[0] <= shore[i - 1][0])) throw new Error('town_ocean_shoreline_unavailable');
      var x = (row[1] - world.width / 2) / UNIT, z = (row[0] - world.height / 2) / UNIT;
      if (x - .2 <= -SEA_HALF_EXTENT || x + 4.8 >= SEA_HALF_EXTENT ||
          Math.abs(z) + .2 >= SEA_HALF_EXTENT) throw new Error('town_ocean_sea_bounds_unavailable');
    }
    if (shore[0][0] !== 0 || shore[shore.length - 1][0] !== world.height) throw new Error('town_ocean_shoreline_unavailable');
    var coast = shore.map(function (row) { return [row[0], row[1]]; });
    function edgeAt(y) {
      for (var k = 1; k < coast.length; k++) if (y <= coast[k][0]) {
        var a = coast[k - 1], b = coast[k];
        return a[1] + (b[1] - a[1]) * (y - a[0]) / (b[0] - a[0]);
      }
      return coast[coast.length - 1][1];
    }
    var group = new THREE.Group();
    // Keep transparent groupOrder aligned with the sea; child renderOrder
    // then draws sea(-3), foam/glints(-2), and original sprites(0).
    group.name = 'ocean-shore-motion'; group.renderOrder = 0;
    group.userData.oceanMotionRevision = REVISION;
    group.userData.noStaticBatch = true; group.userData.nonSolidWater = true;
    function waterMesh(mesh) {
      mesh.renderOrder = -2; mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.userData.noStaticBatch = true; mesh.userData.nonSolidWater = true;
      mesh.userData.presentationOnly = true; group.add(mesh); return mesh;
    }
    function material(color, opacity) {
      var value = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: opacity,
        depthWrite: false, depthTest: true });
      value.userData.oceanMotionRevision = REVISION;
      ctx.materials.add(value); return value;
    }
    // Every bend is a vertex row. Triangles therefore stay within one linear
    // shoreline segment; positive offsets keep their full surface seaward.
    var samples = [], positions = [], indices = [];
    for (var y = 0; y < world.height; y += 80) samples.push(y);
    samples.push(world.height);
    for (var k = 0; k < coast.length; k++) if (samples.indexOf(coast[k][0]) < 0) samples.push(coast[k][0]);
    samples.sort(function (a, b) { return a - b; });
    for (var k = 0; k < samples.length; k++) {
      var y = samples[k], fraction = y / world.height;
      var bend = Math.sin(fraction * TAU * 4) * .024 + Math.sin(fraction * TAU * 7 + .4) * .008;
      var x = (edgeAt(y) - world.width / 2) / UNIT + .10 + bend, z = (y - world.height / 2) / UNIT;
      positions.push(x - .030, 0, z, x + .030, 0, z);
      if (k < samples.length - 1) {
        var base = k * 2;
        indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }
    var foamGeometry = new THREE.BufferGeometry();
    foamGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    foamGeometry.setIndex(indices); foamGeometry.computeVertexNormals();
    foamGeometry.computeBoundingBox(); foamGeometry.computeBoundingSphere();
    foamGeometry.userData.oceanMotionRevision = REVISION;
    ctx.geometries.add(foamGeometry);
    var foams = [];
    for (var k = 0; k < FOAM_COUNT; k++) {
      var mesh = waterMesh(new THREE.Mesh(foamGeometry, material('#e6eee2', 0)));
      mesh.name = 'incoming-shore-foam-' + k;
      foams.push(mesh);
    }
    // One instanced object keeps twelve small surface glints inexpensive.
    // The reusable matrix/vector below are allocated only during construction.
    var glintGeometry = new THREE.PlaneGeometry(.42, .032);
    glintGeometry.rotateX(-Math.PI / 2); ctx.geometries.add(glintGeometry);
    var glintMaterial = material('#d4e9df', .27);
    var glints = waterMesh(new THREE.InstancedMesh(glintGeometry, glintMaterial, GLINT_COUNT));
    glints.name = 'ocean-surface-glints';
    glints.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    var stations = [], matrix = new THREE.Matrix4(), scale = new THREE.Vector3();
    for (var k = 0; k < GLINT_COUNT; k++) {
      var y = (k + .5) / GLINT_COUNT * world.height;
      stations.push({ x: (edgeAt(y) - world.width / 2) / UNIT + .70 + (k % 4) * 1.20,
        z: (y - world.height / 2) / UNIT, phase: k * .71 });
    }
    var state = { phase: 0, reduced: true, foamCount: FOAM_COUNT, glintCount: GLINT_COUNT };
    var lastPhase = null, lastReduced = null;
    function animate(ms, reduced) {
      var still = !!reduced;
      // Reduce the clock before multiplication: even Number.MAX_VALUE remains
      // finite, bounded and deterministic without losing the coastal envelope.
      var phase = still ? 0 : (Math.max(0, finite(ms) ? ms : 0) % PERIOD_MS) / PERIOD_MS;
      if (phase === lastPhase && still === lastReduced) return state;
      for (var k = 0; k < foams.length; k++) {
        var progress = (phase + k / FOAM_COUNT) % 1, mesh = foams[k];
        mesh.position.set(1.50 * (1 - progress), -.035 + Math.sin(progress * TAU) * .002, 0);
        mesh.material.opacity = .55 * Math.pow(Math.sin(Math.PI * progress), 2);
        mesh.updateMatrixWorld(true);
      }
      glintMaterial.opacity = .27 + Math.sin(phase * TAU) * .09;
      for (var k = 0; k < stations.length; k++) {
        var station = stations[k], wave = phase * TAU + station.phase;
        scale.set(.72 + Math.sin(wave) * .28, 1, .72 + Math.cos(wave) * .20);
        matrix.makeRotationY(Math.sin(wave) * .24); matrix.scale(scale);
        matrix.setPosition(station.x + Math.sin(wave) * .055, -.033 + Math.cos(wave) * .001, station.z);
        glints.setMatrixAt(k, matrix);
      }
      glints.instanceMatrix.needsUpdate = true;
      glints.updateMatrixWorld(true); group.updateMatrixWorld(true);
      state.phase = phase; state.reduced = still;
      lastPhase = phase; lastReduced = still;
      return state;
    }
    ctx.group.add(group);
    animate(0, true);
    // Motion is small relative to these fixed bounds, so playback never needs
    // to rebuild bounds or allocate new geometry, materials or matrix helpers.
    glints.computeBoundingBox(); glints.boundingBox.expandByScalar(.35);
    glints.computeBoundingSphere(); glints.boundingSphere.radius += .35;
    return Object.freeze({
      revision: REVISION, group: group, dynamicRoots: Object.freeze([group]),
      animate: animate, resourceOwner: 'scene', instanceMeshes: Object.freeze([glints]),
      diagnostics: state,
      metrics: Object.freeze({ foamCount: FOAM_COUNT, glintCount: GLINT_COUNT, drawObjects: FOAM_COUNT + 1,
        geometries: 2, materials: FOAM_COUNT + 1, shorelineRows: samples.length,
        triangles: foamGeometry.index.count / 3 * FOAM_COUNT + glintGeometry.index.count / 3 * GLINT_COUNT,
        periodMs: PERIOD_MS, seaHalfExtent: SEA_HALF_EXTENT })
    });
  }
  return Object.freeze({ revision: REVISION, create: create });
}));

/* Original pearl-garden mesh recipes v1. Preserve this file when adding later recipes. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetVillageAssetsV1 = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var TAU = Math.PI * 2;
  function freeze(value) { if (value && typeof value === 'object') { Object.keys(value).forEach(function (key) { freeze(value[key]); }); Object.freeze(value); } return value; }
  var catalogue = freeze([
    { id: 'autumn-chrysanthemum-planter-v1', version: 1, name: '秋菊のパールプランター', category: 'flora-planter',
      season: ['autumn'], theme: ['pearl-garden', 'garden-natural'], purpose: 'floor-standing seasonal flowers',
      envelope: { width: .62, height: .78, depth: .62 }, footprint: { type: 'circle', radius: .31, clearance: .04 },
      materialStyle: 'Soft ivory glazed ceramic, sage fluting, solid layered champagne/blush chrysanthemum petals, matte leaves and soil',
      origin: 'base-center-y0', units: 'game-world-units', recipe: 'static/pet-village-assets-v1.js', representation: 'real_mesh_geometry',
      verification: { design: 'candidate', geometry: 'built_when_requested', allAngles: false, villagePlacement: false, interaction: false, saveUnlock: false, production: false } },
    { id: 'pearl-garden-lantern-v1', version: 1, name: 'パールガーデンランタン', category: 'garden-light',
      season: ['all-season'], theme: ['pearl-garden', 'elegant-natural'], purpose: 'floor-standing warm garden light',
      envelope: { width: .54, height: 1.10, depth: .54 }, footprint: { type: 'circle', radius: .27, clearance: .04 },
      materialStyle: 'Rounded ivory and sage pedestal, restrained brushed gold frame, closed glass panels and amber emissive core',
      origin: 'base-center-y0', units: 'game-world-units', recipe: 'static/pet-village-assets-v1.js', representation: 'real_mesh_geometry',
      verification: { design: 'candidate', geometry: 'built_when_requested', allAngles: false, villagePlacement: false, interaction: false, saveUnlock: false, production: false } }
  ]);
  function get(id) { return catalogue.find(function (row) { return row.id === id; }) || null; }
  function fail(code) { var error = new Error(code); error.code = code; throw error; }
  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
  function circle(id, x, z) {
    var spec = get(id); if (!spec) fail('unknown_village_asset');
    if (!finite(x) || !finite(z)) fail('invalid_village_asset_position');
    return { x: x, z: z, radius: spec.footprint.radius, clearance: spec.footprint.clearance };
  }
  function intersects(id, x, z, placedX, placedZ, extraRadius) {
    var c = circle(id, placedX == null ? 0 : placedX, placedZ == null ? 0 : placedZ), extra = extraRadius == null ? 0 : extraRadius;
    if (!finite(x) || !finite(z) || !finite(extra) || extra < 0) fail('invalid_village_asset_position');
    return Math.hypot(x - c.x, z - c.z) <= c.radius + c.clearance + extra + 1e-10;
  }
  function build(THREE, id) {
    var spec = get(id); if (!spec) fail('unknown_village_asset');
    if (!THREE || typeof THREE.Group !== 'function' || typeof THREE.Mesh !== 'function' || typeof THREE.InstancedMesh !== 'function') fail('village_asset_three_required');
    var group = new THREE.Group(); group.name = id;
    group.userData = { assetId: id, recipeVersion: 1, recipePath: spec.recipe, units: 'game-world-units', origin: spec.origin, candidateOnly: true };
    var geometries = new Set(), materials = new Set(), instances = new Set(), shapeCache = new Map(), parts = [], dead = false;
    function geometry(key, create) { if (!shapeCache.has(key)) { var g = create(); shapeCache.set(key, g); geometries.add(g); } return shapeCache.get(key); }
    var sphere = geometry('solid-sphere', function () { return new THREE.SphereGeometry(1, 16, 12); });
    function cylinderShape(ratio) { return geometry('closed-cylinder-' + ratio, function () { return new THREE.CylinderGeometry(1, ratio, 1, 24, 1, false); }); }
    function torusShape(radius, tube) { return geometry('closed-torus-' + radius + '-' + tube, function () { return new THREE.TorusGeometry(radius, tube, 10, 32); }); }
    var box = geometry('closed-glass-box', function () { return new THREE.BoxGeometry(1, 1, 1); });
    function material(color, options) { var m = new THREE.MeshPhysicalMaterial(Object.assign({ color: color, roughness: .52, metalness: .025, clearcoat: .14, clearcoatRoughness: .42 }, options || {})); materials.add(m); return m; }
    var ivory = material('#eee1ca'), sage = material('#b9c7a7'), brass = material('#c4a36a', { metalness: .38, roughness: .46 });
    var leaf = material('#8ca77b', { roughness: .72, clearcoat: .025 }), darkLeaf = material('#6d906d', { roughness: .78, clearcoat: .01 });
    var soil = material('#79634e', { roughness: .98, clearcoat: 0, metalness: 0 });
    var petalCream = material('#f2d8b8'), petalBlush = material('#e2b8bd'), petalMauve = material('#c4a6b8');
    var pollen = material('#d5ad6b', { roughness: .8, clearcoat: .02 });
    function piece(part, geo, mat, position, scale, rotation) {
      var mesh = new THREE.Mesh(geo, mat); mesh.name = id + '/' + part;
      mesh.userData = { assetId: id, partId: part, solidPrimitive: true };
      mesh.position.set.apply(mesh.position, position); if (scale) mesh.scale.set.apply(mesh.scale, scale);
      if (rotation) mesh.rotation.set.apply(mesh.rotation, rotation);
      mesh.castShadow = !mat.transparent; mesh.receiveShadow = true; group.add(mesh); parts.push(mesh); return mesh;
    }
    function ball(part, mat, x, y, z, rx, ry, rz, rotation) { return piece(part, sphere, mat, [x, y, z], [rx, ry, rz], rotation); }
    function cylinder(part, mat, x, y, z, radiusTop, radiusBottom, height) { return piece(part, cylinderShape(radiusBottom / radiusTop), mat, [x, y, z], [radiusTop, height, radiusTop]); }
    function ring(part, mat, x, y, z, radius, tube, rotation) { return piece(part, torusShape(radius, tube), mat, [x, y, z], null, rotation || [Math.PI / 2, 0, 0]); }
    function stem(part, a, b, radius, mat) {
      var av = new THREE.Vector3().fromArray(a), bv = new THREE.Vector3().fromArray(b), delta = bv.clone().sub(av), midpoint = av.clone().add(bv).multiplyScalar(.5);
      var mesh = cylinder(part, mat, midpoint.x, midpoint.y, midpoint.z, radius, radius, delta.length());
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return mesh;
    }
    function flower(part, x, y, z, scale, mat) {
      // Two offset whorls of closed, overlapping petal volumes; undersides are real surfaces.
      ball(part + '/receptacle', darkLeaf, x, y - .016 * scale, z, .058 * scale, .026 * scale, .058 * scale);
      for (var tier = 0; tier < 2; tier++) for (var n = 0; n < 16; n++) {
        var angle = n * TAU / 16 + tier * .19, radius = (.062 - tier * .019) * scale;
        ball(part + '/petal-' + tier + '-' + n, mat, x + Math.sin(angle) * radius, y + tier * .018 * scale, z + Math.cos(angle) * radius,
          (.024 - tier * .004) * scale, .018 * scale, (.067 - tier * .017) * scale, [tier ? .16 : -.10, angle, 0]);
      }
      ball(part + '/pollen', pollen, x, y + .027 * scale, z, .033 * scale, .024 * scale, .033 * scale);
    }
    if (id === 'autumn-chrysanthemum-planter-v1') {
      cylinder('pot/closed-foot', ivory, 0, .0375, 0, .225, .225, .075);
      ring('pot/soft-foot-rim', sage, 0, .075, 0, .213, .016);
      cylinder('pot/closed-bowl', ivory, 0, .2375, 0, .249, .209, .325);
      ring('pot/pearl-lip', ivory, 0, .398, 0, .243, .025);
      ring('pot/sage-thread', sage, 0, .375, 0, .240, .010);
      cylinder('pot/soil-surface', soil, 0, .402, 0, .222, .222, .025);
      for (var flute = 0; flute < 10; flute++) { var fa = flute * TAU / 10;
        ball('pot/sage-flute-' + flute, sage, Math.sin(fa) * .226, .234, Math.cos(fa) * .226, .018, .128, .025, [0, fa, -.09]);
      }
      var flowers = [[0, .729, -.015, 1, petalCream], [-.135, .621, .095, .84, petalBlush], [.135, .651, .075, .84, petalMauve]];
      flowers.forEach(function (f, i) {
        stem('growth/stem-' + i, [f[0] * .25, .406, f[2] * .25], [f[0], f[1] - .012, f[2]], .0105, darkLeaf);
        for (var side = -1; side <= 1; side += 2) {
          var ax = f[0] * .66, ay = .49 + i * .017, az = f[2] * .5, bx = ax + side * .084, bz = az + (i % 2 ? -.034 : .035);
          stem('growth/leaf-stem-' + i + '-' + side, [ax, ay, az], [bx, ay + .023, bz], .0055, darkLeaf);
          ball('growth/leaf-' + i + '-' + side, side > 0 ? leaf : darkLeaf, bx + side * .024, ay + .029, bz, .071, .012, .033, [0, side * -.35, side * .24]);
        }
        flower('flower-' + i, f[0], f[1], f[2], f[3], f[4]);
      });
    } else {
      cylinder('pedestal/closed-foot', ivory, 0, .045, 0, .205, .205, .09);
      ring('pedestal/base-bead', sage, 0, .092, 0, .174, .020);
      cylinder('pedestal/step', ivory, 0, .125, 0, .162, .181, .07);
      cylinder('pedestal/shaft', sage, 0, .285, 0, .066, .079, .25);
      ring('pedestal/collar', brass, 0, .409, 0, .080, .014);
      cylinder('lantern/closed-floor', ivory, 0, .446, 0, .201, .181, .07);
      ring('lantern/lower-ring', brass, 0, .483, 0, .179, .014);
      for (var sx = -1; sx <= 1; sx += 2) for (var sz = -1; sz <= 1; sz += 2) {
        cylinder('lantern/post-' + sx + '-' + sz, brass, sx * .138, .665, sz * .138, .014, .017, .372);
        ball('lantern/post-bead-' + sx + '-' + sz, ivory, sx * .138, .846, sz * .138, .026, .022, .026);
      }
      var glass = material('#e4ece0', { roughness: .13, metalness: 0, clearcoat: .6, transparent: true, opacity: .33, depthWrite: false });
      for (var side = -1; side <= 1; side += 2) {
        piece('lantern/glass-front-' + side, box, glass, [0, .662, side * .139], [.253, .325, .016]);
        piece('lantern/glass-side-' + side, box, glass, [side * .139, .662, 0], [.016, .325, .253]);
      }
      var glow = material('#f9d99c', { emissive: '#edbd6a', emissiveIntensity: .65, roughness: .32, metalness: 0 });
      cylinder('lantern/candle-cup', brass, 0, .511, 0, .066, .075, .055);
      cylinder('lantern/candle', ivory, 0, .570, 0, .043, .046, .084);
      ball('lantern/warm-core', glow, 0, .648, 0, .035, .057, .035);
      ball('lantern/closed-pearl-hood', ivory, 0, .900, 0, .245, .103, .245);
      ring('lantern/sage-eave', sage, 0, .871, 0, .222, .022);
      ring('lantern/gold-eave', brass, 0, .882, 0, .239, .009);
      ball('lantern/crown', brass, 0, 1.023, 0, .033, .029, .033);
      ring('lantern/closed-hanging-ring', brass, 0, 1.059, 0, .032, .009, [0, 0, 0]);
      var light = new THREE.PointLight('#f5d391', .45, 1.5, 2); light.name = id + '/light/warm-core'; light.position.set(0, .653, 0); light.castShadow = false;
      light.userData = { assetId: id, partId: 'light/warm-core', candidateLocalLight: true }; group.add(light);
    }
    var ground = new THREE.Object3D(); ground.name = id + '/anchor/ground'; ground.userData = { assetId: id, partId: 'anchor/ground', contact: 'floor' }; group.add(ground);
    // Repeated solid primitives are instanced without deleting stable part anchors.
    group.updateMatrixWorld(true); var buckets = new Map();
    parts.forEach(function (mesh) { if (mesh.material.transparent) return; var key = mesh.geometry.uuid + ':' + mesh.material.uuid; if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(mesh); });
    var batchIndex = 0;
    buckets.forEach(function (rows) {
      if (rows.length < 4) return;
      var batch = new THREE.InstancedMesh(rows[0].geometry, rows[0].material, rows.length); batch.name = id + '/batch-' + batchIndex++;
      batch.castShadow = true; batch.receiveShadow = true; batch.userData = { assetId: id, instancePartIds: rows.map(function (row) { return row.userData.partId; }) };
      rows.forEach(function (mesh, index) {
        batch.setMatrixAt(index, mesh.matrixWorld); var anchor = new THREE.Object3D(); anchor.name = mesh.name; anchor.userData = mesh.userData;
        anchor.position.copy(mesh.position); anchor.quaternion.copy(mesh.quaternion); anchor.scale.copy(mesh.scale); group.add(anchor); group.remove(mesh);
      });
      batch.instanceMatrix.needsUpdate = true; batch.computeBoundingBox(); batch.computeBoundingSphere(); group.add(batch); instances.add(batch);
    });
    group.updateMatrixWorld(true); var measured = new THREE.Box3().setFromObject(group), size = measured.getSize(new THREE.Vector3());
    return { id: id, group: group, spec: spec,
      bounds: { min: measured.min.toArray(), max: measured.max.toArray(), size: size.toArray() },
      footprint: Object.assign({}, spec.footprint), resources: { geometries: geometries, materials: materials, instancedMeshes: instances },
      dispose: function () { if (dead) return; dead = true; if (group.parent) group.parent.remove(group); instances.forEach(function (m) { m.dispose(); }); geometries.forEach(function (g) { g.dispose(); }); materials.forEach(function (m) { m.dispose(); }); group.clear(); } };
  }
  return Object.freeze({ catalogue: catalogue, get: get, build: build, collisionCircle: circle, intersects: intersects, recipeVersion: 1 });
}));

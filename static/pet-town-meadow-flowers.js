/* Small authored meadow accents beside unchanged original artwork.
   Scene owns every geometry/material in ctx Sets. This helper owns only its
   InstancedMesh buffers; dispose() must precede the enclosing scene disposal. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetTownMeadowFlowers = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  var REVISION = 'meadow-flowers3', MAX_SWAY = .025, MAX_SITES = 45;
  var KINDS = ['daisy', 'tulip', 'bell', 'spike'];
  var COLORS = ['#fff1d9', '#edc0c1', '#c4afd9'];
  // Local olive greens and cream/pink/lilac pigments sit beside the tree
  // originals. They do not recolor any other material in the enclosing Scene.
  var SEASON_COLORS = {
    spring: { stem: '#70874f', leaves: ['#a3b86b', '#809652'], blooms: ['#f6e8cc', '#e6a9a9', '#b49acb'], pollen: '#d2a247' },
    summer: { stem: '#647f46', leaves: ['#95ac58', '#738f49'], blooms: ['#f5e5c7', '#df9f9e', '#ac90c5'], pollen: '#d1a04b' },
    autumn: { stem: '#6b7847', leaves: ['#a6b364', '#7f914e'], blooms: ['#f3e3c5', '#dca29c', '#b09ac2'], pollen: '#ca9b4a' },
    winter: { stem: '#6c8266', leaves: ['#a4b698', '#7e9874'], blooms: ['#f0e8d9', '#d5b0b2', '#b5acc7'], pollen: '#c0a46a' }
  };
  Object.keys(SEASON_COLORS).forEach(function (key) {
    Object.freeze(SEASON_COLORS[key].leaves); Object.freeze(SEASON_COLORS[key].blooms);
    Object.freeze(SEASON_COLORS[key]);
  });
  Object.freeze(SEASON_COLORS);
  function seasonKey(value) {
    var key = typeof value === 'string' ? value : value && value.key;
    if (!Object.prototype.hasOwnProperty.call(SEASON_COLORS, key)) throw new Error('meadow_season_invalid');
    return key;
  }
  function roundedGeometry(T, kind) {
    // A fine single equator rounds the leaf silhouette without the former
    // two-ring vertical side strip. Padded poles keep a closed curved blade.
    // Blossoms keep three latitude bands and48 shared triangles.
    var g = new T.SphereGeometry(1, kind === 'leaf' ? 32 : 12, kind === 'leaf' ? 2 : 3);
    var p = g.attributes.position, n = g.attributes.normal;
    var radial = kind === 'leaf' ? 1 : 2 / Math.sqrt(3), radialSquared = radial * radial;
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i) * radial, y = p.getY(i), z = p.getZ(i) * radial;
      var nx = x / radialSquared, ny = y, nz = z / radialSquared;
      if (kind === 'leaf') {
        // A continuous bend and low midrib keep a broad leaf softly padded.
        // This invertible deformation preserves one closed outward shell.
        var width = 1 - .12 * z * z, ridge = .035;
        var dxDz = -.24 * x * z;
        var dyDx = -2 * ridge * x * (1 - z * z);
        var dyDz = .16 * z - 2 * ridge * z * (1 - x * x);
        var normalY = ny / .32, normalX = (nx - dyDx * normalY) / width;
        var normalZ = nz - dxDz * normalX - dyDz * normalY;
        p.setXYZ(i, x * width, y * .32 + .08 * z * z + ridge * (1 - x * x) * (1 - z * z), z);
        nx = normalX; ny = normalY; nz = normalZ;
      } else p.setXYZ(i, x, y, z);
      var length = Math.hypot(nx, ny, nz);
      n.setXYZ(i, nx / length, ny / length, nz / length);
    }
    // UV seams and poles contain duplicate vertices. Their analytic normals
    // are finite and equal at the same position, including unused pole rows.
    g.userData.botanicalRole = kind === 'leaf' ? 'closed-padded-midrib-leaf' : 'closed-rounded-blossom';
    g.userData.normalPolicy = 'analytic-inverse-transpose';
    g.userData.radialSides = kind === 'leaf' ? 32 : 12;
    return g;
  }
  function finite(n) { return typeof n === 'number' && Number.isFinite(n); }
  function hash(text) {
    var value = 2166136261;
    for (var i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
    return value >>> 0;
  }
  function random(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var value = Math.imul(seed ^ seed >>> 15, 1 | seed);
      value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }
  function checkedSite(site) {
    if (!site || (typeof site.id !== 'string' && !finite(site.id)) || !String(site.id).length ||
        !finite(site.x) || !finite(site.y) || !finite(site.z) ||
        site.seed !== undefined && !finite(site.seed)) throw new Error('meadow_site_invalid');
    return { id: String(site.id), x: site.x, y: site.y, z: site.z,
      seed: site.seed === undefined ? 0 : site.seed };
  }
  // Position, height and species are deterministic; language, season and frames
  // never change the recipe or add a persistent game object.
  function recipe(site) {
    site = checkedSite(site);
    var key = hash(site.id + ':' + site.seed), next = random(key);
    var leafOnly = key % 7 === 0, count = 2 + key % 3, plants = [];
    var rotation = next() * Math.PI * 2;
    for (var i = 0; i < count; i++) {
      var angle = rotation + i * 2.399963229728653, radius = count === 2 ? .105 : .105 + i * .024;
      plants.push({ id: site.id + '/plant-' + i, siteId: site.id,
        kind: leafOnly ? 'leaf' : KINDS[(key + i) % KINDS.length],
        x: Math.cos(angle) * radius, z: Math.sin(angle) * radius,
        height: .20 + next() * .18, turn: next() * Math.PI * 2,
        phase: next() * Math.PI * 2, color: COLORS[(key + i * 2) % COLORS.length] });
    }
    return { id: site.id, seed: site.seed, leafOnly: leafOnly, plants: plants };
  }
  function create(T, ctx) {
    if (!T || !T.InstancedMesh || !T.Matrix4 || !ctx || !ctx.group || !ctx.group.add ||
        !Array.isArray(ctx.sites) || ctx.sites.length > MAX_SITES ||
        !ctx.geometries || !ctx.geometries.add || !ctx.materials || !ctx.materials.add ||
        typeof ctx.mat !== 'function') throw new Error('meadow_context_invalid');
    var sites = [], identities = new Set();
    for (var i = 0; i < ctx.sites.length; i++) {
      var site = checkedSite(ctx.sites[i]);
      if (identities.has(site.id)) throw new Error('meadow_duplicate_site');
      identities.add(site.id); sites.push(site);
    }
    var group = new T.Group(); group.name = 'varied-meadow-flowers';
    group.userData.revision = REVISION; group.userData.nonSolidDecoration = true;
    group.userData.noPlacementOrSaveMutation = true;
    var geometries = [], materialSet = new Set(), buckets = new Map(), plants = [], batches = [];
    // Register shared resources as they are created. On a later failure the
    // enclosing Scene still owns them; only instance buffers belong here.
    function ownedGeometry(geometry) {
      ctx.geometries.add(geometry); geometries.push(geometry); return geometry;
    }
    try {
    var stemGeometry = ownedGeometry(new T.CylinderGeometry(1, 1, 1, 8, 1, false));
    stemGeometry.userData.botanicalRole = 'closed-rounded-stem';
    stemGeometry.userData.radialSides = 8;
    var petalGeometry = ownedGeometry(roundedGeometry(T, 'petal'));
    var leafGeometry = ownedGeometry(roundedGeometry(T, 'leaf'));
    for (i = 0; i < geometries.length; i++) {
      geometries[i].computeBoundingBox(); geometries[i].computeBoundingSphere();
    }
    function material(color, role) {
      // Distinct local roles make the caller's role-keyed cache return meadow
      // resources directly, rather than cloning and retaining source materials.
      var value = ctx.mat(color, false, role);
      if (!value || !value.isMaterial || !value.color || typeof value.color.set !== 'function') throw new Error('meadow_material_invalid');
      value.roughness = role === 'meadow-stem' ? .83 : role === 'meadow-leaf' ? .72 : .68;
      value.metalness = 0; value.bumpScale = 0; value.flatShading = false;
      value.userData.meadowRevision = REVISION; value.userData.meadowSurfaceRole = role;
      ctx.materials.add(value); materialSet.add(value); return value;
    }
    var activeSeason = 'summer', initialColors = SEASON_COLORS[activeSeason];
    var stemMaterial = material(initialColors.stem, 'meadow-stem');
    var leafMaterials = initialColors.leaves.map(function (color) { return material(color, 'meadow-leaf'); });
    var bloomMaterials = initialColors.blooms.map(function (color) { return material(color, 'meadow-bloom'); });
    var pollen = material(initialColors.pollen, 'meadow-bloom');
    function setSeason(value) {
      var key = seasonKey(value);
      if (disposed) return false;
      var colors = SEASON_COLORS[key];
      stemMaterial.color.set(colors.stem);
      leafMaterials.forEach(function (m, i) { m.color.set(colors.leaves[i]); });
      bloomMaterials.forEach(function (m, i) { m.color.set(colors.blooms[i]); });
      pollen.color.set(colors.pollen);
      materialSet.forEach(function (m) { m.userData.meadowSeason = key; });
      activeSeason = key; return true;
    }
    var tempObject = new T.Object3D(), direction = new T.Vector3(), midpoint = new T.Vector3();
    var yAxis = new T.Vector3(0, 1, 0), flowerCounts = { daisy: 0, tulip: 0, bell: 0, spike: 0, leaf: 0 };
    function part(plant, geometry, mat, x, y, z, sx, sy, sz, rx, ry, rz, role) {
      tempObject.position.set(x, y, z); tempObject.scale.set(sx, sy, sz);
      tempObject.rotation.set(rx || 0, ry || 0, rz || 0); tempObject.updateMatrix();
      var row = { plant: plant, localMatrix: tempObject.matrix.clone(), role: role };
      var key = geometry.uuid + ':' + mat.uuid, bucket = buckets.get(key);
      if (!bucket) { bucket = { geometry: geometry, material: mat, rows: [] }; buckets.set(key, bucket); }
      bucket.rows.push(row); plant.partCount++; return row;
    }
    function stem(plant, a, b, radius, role) {
      direction.subVectors(b, a); midpoint.addVectors(a, b).multiplyScalar(.5);
      tempObject.position.copy(midpoint); tempObject.scale.set(radius, direction.length(), radius);
      tempObject.quaternion.setFromUnitVectors(yAxis, direction.normalize()); tempObject.updateMatrix();
      var row = { plant: plant, localMatrix: tempObject.matrix.clone(), role: role || 'stem' };
      var key = stemGeometry.uuid + ':' + stemMaterial.uuid, bucket = buckets.get(key);
      if (!bucket) { bucket = { geometry: stemGeometry, material: stemMaterial, rows: [] }; buckets.set(key, bucket); }
      bucket.rows.push(row); plant.partCount++;
    }
    function leaves(plant, height, count, rooted) {
      // A leaf-only tuft needs visible, joined material down to the floor,
      // rather than a grounded pivot beneath otherwise floating leaves.
      if (rooted) stem(plant, a.set(0, 0, 0), b.set(0, .030, 0), .005, 'leaf-root');
      for (var leaf = 0; leaf < count; leaf++) {
        var side = leaf % 2 ? -1 : 1, turn = leaf * 2.4 + .3;
        var leafY = height * (.26 + leaf * .18);
        if (rooted) stem(plant, a.set(0, .022, 0), b.set(side * .038, leafY, .008 * side),
          .0035, 'rooted-leaf-petiole');
        part(plant, leafGeometry, leafMaterials[leaf % 2], side * .038,
          leafY, .008 * side, .047, .060, .112,
          .36, turn, -side * .48, 'leaf');
      }
    }
    var a = new T.Vector3(), b = new T.Vector3();
    for (i = 0; i < sites.length; i++) {
      var siteRecipe = recipe(sites[i]);
      for (var j = 0; j < siteRecipe.plants.length; j++) {
        var r = siteRecipe.plants[j], plant = { id: r.id, siteId: r.siteId, kind: r.kind,
          base: [sites[i].x + r.x, sites[i].y, sites[i].z + r.z],
          localBase: [r.x, 0, r.z], height: r.height, turn: r.turn, phase: r.phase,
          partCount: 0, sway: 0, restMatrix: new T.Matrix4(), pivotMatrix: new T.Matrix4() };
        plant.restMatrix.makeRotationY(r.turn); plant.restMatrix.setPosition(plant.base[0], plant.base[1], plant.base[2]);
        plant.pivotMatrix.copy(plant.restMatrix); plants.push(plant); flowerCounts[r.kind]++;
        var bloom = bloomMaterials[COLORS.indexOf(r.color)], h = r.height;
        if (r.kind === 'leaf') { leaves(plant, .17, 3, true); continue; }
        stem(plant, a.set(0, 0, 0), b.set(0, h, 0), .006, 'stem'); leaves(plant, h, 2);
        if (r.kind === 'daisy') {
          for (var petal = 0; petal < 6; petal++) {
            var angle = petal * Math.PI / 3;
            part(plant, petalGeometry, bloom, Math.sin(angle) * .039, h, Math.cos(angle) * .039,
              .027, .012, .052, .14, angle, 0, 'daisy-petal');
          }
          part(plant, petalGeometry, pollen, 0, h + .006, 0, .025, .015, .025, 0, 0, 0, 'daisy-center');
        } else if (r.kind === 'tulip') {
          // A short green receptacle overlaps the real stem and the petal
          // ring. The ring's central hollow is not used as a hidden join.
          stem(plant, a.set(0, h - .012, 0), b.set(0, h + .018, 0), .014, 'tulip-receptacle');
          for (petal = 0; petal < 5; petal++) {
            angle = petal * Math.PI * 2 / 5;
            part(plant, petalGeometry, bloom, Math.sin(angle) * .026, h + .015, Math.cos(angle) * .026,
              .032, .055, .019, -.22, angle, 0, 'upright-tulip-petal');
          }
        } else if (r.kind === 'bell') {
          stem(plant, a.set(0, h, 0), b.set(.045, h + .016, 0), .0045, 'arched-bell-neck');
          for (petal = 0; petal < 4; petal++) {
            angle = petal * Math.PI / 2;
            part(plant, petalGeometry, bloom, .045 + Math.sin(angle) * .019, h - .012, Math.cos(angle) * .019,
              .022, .043, .018, .30, angle, 0, 'hanging-bell-petal');
          }
        } else {
          for (var bud = 0; bud < 5; bud++) {
            angle = bud * 2.399963;
            var size = .024 - bud * .002;
            part(plant, petalGeometry, bloom, Math.sin(angle) * .020, h - .095 + bud * .023,
              Math.cos(angle) * .020, size, .031, size, 0, angle, .17, 'spike-blossom');
          }
        }
      }
    }
    var bounds = new T.Box3(), box = new T.Box3(), fullMatrix = new T.Matrix4();
    var rotation = new T.Matrix4(), scratch = new T.Matrix4(), tempPoint = new T.Vector3();
    var partCount = 0, triangleCount = 0;
    buckets.forEach(function (bucket) {
      var mesh = new T.InstancedMesh(bucket.geometry, bucket.material, bucket.rows.length);
      // Track immediately so a subsequent setup failure cannot leak buffers.
      batches.push({ mesh: mesh, rows: bucket.rows, count: bucket.rows.length });
      mesh.name = 'meadow-' + bucket.rows[0].role + '-instances';
      mesh.userData.noStaticBatch = true; mesh.userData.nonSolidDecoration = true;
      mesh.userData.revision = REVISION; mesh.castShadow = false; mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      for (var k = 0; k < bucket.rows.length; k++) {
        var row = bucket.rows[k]; fullMatrix.multiplyMatrices(row.plant.restMatrix, row.localMatrix);
        mesh.setMatrixAt(k, fullMatrix); box.copy(bucket.geometry.boundingBox).applyMatrix4(fullMatrix); bounds.union(box);
      }
      var triangles = (bucket.geometry.index ? bucket.geometry.index.count : bucket.geometry.attributes.position.count) / 3;
      partCount += bucket.rows.length; triangleCount += bucket.rows.length * triangles;
      group.add(mesh);
    });
    // Every stem is below .45 high. .025 radians shifts an extremity < .014;
    // enlarged fixed bounds cover the full animation without per-frame scans.
    if (!bounds.isEmpty()) bounds.expandByScalar(.018);
    var center = new T.Vector3(), radius = 0;
    if (!bounds.isEmpty()) { bounds.getCenter(center); radius = center.distanceTo(bounds.max); }
    for (i = 0; i < batches.length; i++) {
      batches[i].mesh.boundingBox = bounds.clone();
      batches[i].mesh.boundingSphere = new T.Sphere(center.clone(), radius);
    }
    var disposed = false;
    function animate(ms, reduced) {
      if (disposed) return false;
      var seconds = Math.max(0, finite(ms) ? ms : 0) / 1000;
      for (var p = 0; p < plants.length; p++) {
        var plant = plants[p]; plant.sway = reduced ? 0 : Math.sin(seconds * .85 + plant.phase) * MAX_SWAY;
        if (reduced) plant.pivotMatrix.copy(plant.restMatrix);
        else { rotation.makeRotationZ(plant.sway); plant.pivotMatrix.multiplyMatrices(plant.restMatrix, rotation); }
      }
      for (var n = 0; n < batches.length; n++) {
        var batch = batches[n];
        for (var k = 0; k < batch.rows.length; k++) {
          var row = batch.rows[k]; scratch.multiplyMatrices(row.plant.pivotMatrix, row.localMatrix);
          batch.mesh.setMatrixAt(k, scratch);
        }
        batch.mesh.instanceMatrix.needsUpdate = true;
      }
      group.updateMatrixWorld(true);
      return true;
    }
    function summary() {
      return { revision: REVISION, season: activeSeason, sites: sites.length, plants: plants.length, parts: partCount,
        triangles: triangleCount, batches: batches.length, geometries: geometries.length, materials: materialSet.size,
        flowerKinds: Object.assign({}, flowerCounts), maxSwayRadians: MAX_SWAY,
        clusterRadiusLimit: .48, heightLimit: .50, fixedAnimationBounds: bounds.isEmpty() ? null :
          { min: bounds.min.toArray(), max: bounds.max.toArray() },
        textures: 0, lights: 0, placementMutation: false, newOriginalArtwork: false,
        roundedBotanicalSurfaces: true, receivedShadows: true, localSeasonPalette: true,
        geometryMaterialDisposalOwner: 'scene', instanceBufferDisposalOwner: 'meadow-helper', disposed: disposed };
    }
    function dispose() {
      if (disposed) return false;
      disposed = true;
      for (var n = 0; n < batches.length; n++) batches[n].mesh.dispose();
      group.removeFromParent(); group.clear(); return true;
    }
    group.userData.meadow = { revision: REVISION, plants: plants.length, parts: partCount };
    setSeason(activeSeason);
    animate(0, true);
    // Commit to the visible scene only once every buffer is ready.
    ctx.group.add(group);
    return { revision: REVISION, group: group, plants: plants, batches: batches,
      animate: animate, setSeason: setSeason, dispose: dispose, summary: summary };
    } catch (error) {
      for (var failed = 0; failed < batches.length; failed++) batches[failed].mesh.dispose();
      group.removeFromParent(); group.clear();
      throw error;
    }
  }
  return { revision: REVISION, maxSwayRadians: MAX_SWAY, maxSites: MAX_SITES, recipe: recipe, create: create };
}));

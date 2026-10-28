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
  var REVISION = 'meadow-flowers4', MAX_SWAY = .025, MAX_SITES = 45;
  var KINDS = ['daisy', 'tulip', 'bell', 'spike', 'rose', 'pansy', 'leaf'];
  var COLORS = ['#fff0d5', '#ee87b1', '#f4c745', '#bb9cdb', '#f0b7c0', '#dc706a'];
  var COLOR_CHOICES = {
    daisy: [0, 2, 1], pansy: [0, 3, 2], tulip: [0, 2, 4, 5],
    rose: [1, 4, 5], bell: [0, 3, 4], spike: [0, 3, 4], leaf: [0]
  };
  Object.keys(COLOR_CHOICES).forEach(function (kind) { Object.freeze(COLOR_CHOICES[kind]); });
  Object.freeze(COLOR_CHOICES);
  // Local olive greens and cream/pink/lilac pigments sit beside the tree
  // originals. They do not recolor any other material in the enclosing Scene.
  var SEASON_COLORS = {
    spring: { stem: '#6f8c49', leaves: ['#9cb863', '#76984a'], blooms: ['#fff0d5', '#ef8ab9', '#f4ce4f', '#b79ade', '#f4b9c5', '#e47773'], pollen: '#d9a746', eyes: '#67405f' },
    summer: { stem: '#658642', leaves: ['#96b55b', '#709447'], blooms: ['#fff0d2', '#e97eac', '#f4c542', '#ae8bd4', '#eeaabd', '#dc6c63'], pollen: '#d3a040', eyes: '#5e365d' },
    autumn: { stem: '#6e8145', leaves: ['#a3b45c', '#7b944a'], blooms: ['#f8ebcf', '#e58aa5', '#edbf4a', '#b198cf', '#eab3bd', '#d47768'], pollen: '#c89a40', eyes: '#67405f' },
    winter: { stem: '#6b8662', leaves: ['#a3b58d', '#79956d'], blooms: ['#f5eddf', '#d99eaf', '#ddc56f', '#b4a3cd', '#dfbbc5', '#cd9284'], pollen: '#bca268', eyes: '#75627b' }
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
    // Small flower hearts use the same closed lens at six radial sides.
    var g = new T.SphereGeometry(1, kind === 'leaf' ? 20 : 6, 2);
    var p = g.attributes.position, n = g.attributes.normal;
    var radial = 1, radialSquared = radial * radial;
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
    g.userData.radialSides = kind === 'leaf' ? 20 : 6;
    return g;
  }
  // Each bloom is an authored closed shell, not a row of repeated petal
  // spheres. Shared indexed rings keep their full silhouette inexpensive.
  function bloomGeometry(T, kind) {
    var positions = [], indices = [], segments, rings = [], top, bottom;
    function vertex(x, y, z) { positions.push(x, y, z); return positions.length / 3 - 1; }
    if (kind === 'daisy' || kind === 'pansy') {
      segments = kind === 'daisy' ? 64 : 50;
      top = vertex(0, .45, 0); bottom = vertex(0, -.30, 0);
      var ring = [];
      for (var j = 0; j < segments; j++) {
        var angle = j * Math.PI * 2 / segments;
        var lobes = kind === 'daisy' ? 8 : 5;
        var r = .84 + .16 * Math.cos(lobes * angle);
        // Broad upper pansy petals and one lower petal give a different head
        // outline from the regular eight-lobed radial daisy.
        var breadth = kind === 'pansy' ? .86 + .14 * Math.cos(angle) : 1;
        ring.push(vertex(Math.sin(angle) * r * breadth, .018 * Math.sin(lobes * angle), Math.cos(angle) * r));
      }
      for (j = 0; j < segments; j++) {
        var next = (j + 1) % segments;
        indices.push(top, ring[j], ring[next], bottom, ring[next], ring[j]);
      }
    } else {
      segments = kind === 'spike' ? 8 : 12;
      var profiles = kind === 'rose' ? [[.78, -.28], [1, .25]] :
        kind === 'tulip' ? [[.45, -.48], [1, .56]] :
        kind === 'bell' ? [[.32, .42], [1, -.55]] :
        [[.60, -.65], [.93, -.25], [.68, .20], [.38, .62]];
      // Bell profiles run down the flower; sort them so winding stays outward.
      profiles.sort(function (a, b) { return a[1] - b[1]; });
      bottom = vertex(0, profiles[0][1] - .13, 0);
      for (var level = 0; level < profiles.length; level++) {
        ring = [];
        for (j = 0; j < segments; j++) {
          angle = j * Math.PI * 2 / segments;
          var twist = kind === 'rose' ? level * .29 : kind === 'spike' ? level * .5 : 0;
          var ripple = kind === 'rose' ? .13 * Math.cos(6 * angle + level * .8) :
            kind === 'spike' ? .18 * Math.cos(4 * angle + level * 1.7) : .07 * Math.cos(3 * angle);
          r = profiles[level][0] * (1 + ripple);
          var y = profiles[level][1] + (kind === 'tulip' ? .07 * Math.cos(3 * angle) :
            kind === 'rose' ? .06 * Math.sin(6 * angle + level) : .035 * Math.cos(4 * angle));
          ring.push(vertex(Math.sin(angle + twist) * r, y, Math.cos(angle + twist) * r));
        }
        rings.push(ring);
      }
      // A recessed cup top, a curled rose crown and a tapering spike are
      // separate positive-volume shapes. Their interiors are still real mesh.
      var topY = kind === 'tulip' ? .20 : kind === 'bell' ? .51 :
        kind === 'rose' ? .39 : .78;
      top = vertex(0, topY, 0);
      for (j = 0; j < segments; j++) {
        next = (j + 1) % segments;
        indices.push(bottom, rings[0][next], rings[0][j]);
        for (level = 0; level < rings.length - 1; level++) {
          var lo = rings[level], hi = rings[level + 1];
          indices.push(lo[j], lo[next], hi[j], lo[next], hi[next], hi[j]);
        }
        var last = rings[rings.length - 1];
        indices.push(top, last[j], last[next]);
      }
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    g.setIndex(indices); g.computeVertexNormals();
    var pigment = new Float32Array(positions.length); pigment.fill(1);
    if (kind === 'pansy') {
      pigment[top * 3] = .20; pigment[top * 3 + 1] = .10; pigment[top * 3 + 2] = .24;
    }
    g.setAttribute('color', new T.Float32BufferAttribute(pigment, 3));
    g.userData.botanicalRole = 'closed-' + kind + '-flower-head';
    g.userData.flowerKind = kind; g.userData.normalPolicy = 'welded-indexed-smooth';
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
    var leafOnly = false, count = 6, plants = [];
    var rotation = next() * Math.PI * 2;
    for (var i = 0; i < count; i++) {
      var angle = rotation + i * 2.399963229728653, radius = .095 + Math.sqrt(i) * .064;
      var kind = KINDS[(key + i) % KINDS.length];
      // The species palette is seed-only. It consumes no random sample and
      // therefore preserves every authored position, height, turn and phase.
      var choices = COLOR_CHOICES[kind], colorIndex = choices[((key ^ hash(kind)) >>> 0) % choices.length];
      plants.push({ id: site.id + '/plant-' + i, siteId: site.id,
        kind: kind, x: Math.cos(angle) * radius, z: Math.sin(angle) * radius,
        height: .235 + next() * .13, turn: next() * Math.PI * 2,
        phase: next() * Math.PI * 2, colorIndex: colorIndex, color: COLORS[colorIndex] });
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
    var stemGeometry = ownedGeometry(new T.CylinderGeometry(1, 1, 1, 5, 1, false));
    stemGeometry.userData.botanicalRole = 'closed-rounded-stem';
    stemGeometry.userData.radialSides = 5;
    var petalGeometry = ownedGeometry(roundedGeometry(T, 'heart'));
    var headGeometries = {};
    KINDS.forEach(function (kind) { if (kind !== 'leaf') headGeometries[kind] = ownedGeometry(bloomGeometry(T, kind)); });
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
    var bloomMaterial = material('#ffffff', 'meadow-bloom');
    bloomMaterial.vertexColors = true;
    var pollen = material('#ffffff', 'meadow-heart');
    function setSeason(value) {
      var key = seasonKey(value);
      if (disposed) return false;
      var colors = SEASON_COLORS[key];
      stemMaterial.color.set(colors.stem);
      leafMaterials.forEach(function (m, i) { m.color.set(colors.leaves[i]); });
      bloomMaterial.color.set('#ffffff'); pollen.color.set('#ffffff');
      for (var n = 0; n < batches.length; n++) {
        var batch = batches[n];
        batch.rows.forEach(function (row, index) {
          if (row.tintRole) batch.mesh.setColorAt(index, new T.Color(row.tintRole === 'bloom' ?
            colors.blooms[row.colorIndex] : row.colorIndex === 1 ? colors.eyes : colors.pollen));
        });
        if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
      }
      materialSet.forEach(function (m) { m.userData.meadowSeason = key; });
      activeSeason = key; return true;
    }
    var tempObject = new T.Object3D(), direction = new T.Vector3(), midpoint = new T.Vector3();
    var yAxis = new T.Vector3(0, 1, 0), flowerCounts = { daisy: 0, tulip: 0, bell: 0, spike: 0, rose: 0, pansy: 0, leaf: 0 };
    function part(plant, geometry, mat, x, y, z, sx, sy, sz, rx, ry, rz, role, tintRole, colorIndex) {
      tempObject.position.set(x, y, z); tempObject.scale.set(sx, sy, sz);
      tempObject.rotation.set(rx || 0, ry || 0, rz || 0); tempObject.updateMatrix();
      var row = { plant: plant, localMatrix: tempObject.matrix.clone(), role: role,
        tintRole: tintRole || null, colorIndex: colorIndex || 0 };
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
      if (rooted) stem(plant, a.set(0, 0, 0), b.set(0, .035, 0), .006, 'leaf-root');
      for (var leaf = 0; leaf < count; leaf++) {
        var side = leaf % 2 ? -1 : 1, turn = leaf * 2.4 + .3;
        var leafY = rooted ? .085 + leaf * .024 : height * (.35 + leaf * .18);
        if (rooted) stem(plant, a.set(0, .022, 0), b.set(side * .021, leafY, .008 * side),
          .0035, 'rooted-leaf-petiole');
        part(plant, leafGeometry, leafMaterials[leaf % 2], side * .021,
          leafY, .008 * side, .048, .045, .088,
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
        var h = r.height, head = headGeometries[r.kind];
        if (r.kind === 'leaf') { leaves(plant, .16, 2, true); continue; }
        stem(plant, a.set(0, 0, 0), b.set(0, h + .020, 0), .007, 'stem');
        leaves(plant, h, 2);
        if (r.kind === 'daisy' || r.kind === 'pansy') {
          part(plant, head, bloomMaterial, 0, h, 0, .095, .12, .095,
            .45, 0, .12, r.kind + '-lobed-head', 'bloom', r.colorIndex);
          if (r.kind === 'daisy') part(plant, petalGeometry, pollen, -.00635, h + .0474, .0229,
            .027, .019, .027, .45, 0, .12, 'daisy-heart', 'heart', 0);
        } else if (r.kind === 'rose') {
          part(plant, head, bloomMaterial, 0, h, 0, .073, .070, .073,
            -.12, 0, 0, 'rose-outer-rosette', 'bloom', r.colorIndex);
          part(plant, head, bloomMaterial, 0, h + .031, 0, .040, .048, .040,
            -.12, .6, 0, 'rose-curled-crown', 'bloom', r.colorIndex);
        } else if (r.kind === 'tulip') {
          part(plant, head, bloomMaterial, 0, h + .003, 0, .062, .092, .062,
            .10, 0, .10, 'upright-fluted-tulip', 'bloom', r.colorIndex);
        } else if (r.kind === 'bell') {
          stem(plant, a.set(0, h, 0), b.set(.037, h + .018, 0), .005, 'arched-bell-neck');
          part(plant, head, bloomMaterial, .035, h - .016, 0, .062, .072, .062,
            0, 0, -.12, 'hanging-flared-bell', 'bloom', r.colorIndex);
        } else {
          part(plant, head, bloomMaterial, 0, h - .004, 0, .057, .105, .057,
            0, 0, .10, 'tiered-spike-blossoms', 'bloom', r.colorIndex);
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
        roundedBotanicalSurfaces: true, mixedGardenHeads: true, instanceBloomColors: true,
        receivedShadows: true, localSeasonPalette: true,
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

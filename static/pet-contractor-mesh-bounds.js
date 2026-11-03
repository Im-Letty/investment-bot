/* A broad phase over explicit projected Mesh data, never collision permission. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetContractorMeshBounds = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var IDS = ['home', 'cafe', 'shop', 'playground', 'tree', 'flowers'];
  var LIMITS = Object.freeze({jsonCharacters: 64000000, meshes: 2048, positions: 1000000, indices: 3000000, sprites: 16000});
  var COUNT_KEYS = ['meshCount', 'positionCount', 'triangleCount', 'spriteCount', 'batchedOriginalCount', 'nonSolidWaterMeshCount', 'nonSolidWindowMeshCount', 'otherObjectCount'];
  var ROOT_KEYS = ['ok', 'version', 'scope', 'coordinateSpace', 'worldSize', 'originalArtState', 'originalArtResourceState', 'mappingValidation', 'geometryScope', 'batchMatrixScope', 'drawScope', 'places', 'totals', 'gaps', 'collisionOrClearanceAssessed', 'gameOrStorageConnected', 'mutationsPerformed'];
  var MESH_KEYS = ['id', 'name', 'geometryType', 'positionArrayType', 'indexArrayType', 'worldPositions', 'xzPositions', 'indices', 'positionCount', 'triangleCount', 'indexWasPresent', 'matrixWorld', 'visibleAtCapture', 'batchedOriginal', 'batchName', 'batchInstanceIndex', 'batchInstanceMatrix', 'nonSolidWater', 'nonSolidWindow', 'drawRange', 'geometryGroups'];
  var BAD = {}, LIMIT = {}, ARITHMETIC = {};
  function reject() { throw BAD; }
  function finite(n) { return typeof n === 'number' && Number.isFinite(n); }
  function integer(n) { return Number.isSafeInteger(n) && n >= 0; }
  function bool(v) { return typeof v === 'boolean'; }
  function text(v, max) { return typeof v === 'string' && v.length <= max; }
  function exact(v, keys) {
    return v !== null && typeof v === 'object' && !Array.isArray(v) &&
      Object.keys(v).length === keys.length && keys.every(function (k) { return Object.prototype.hasOwnProperty.call(v, k); });
  }
  function freeze(v) {
    if (v && typeof v === 'object') { Object.keys(v).forEach(function (k) { freeze(v[k]); }); Object.freeze(v); }
    return v;
  }
  function safeDifference(a, b) { var n = a - b; if (!finite(n)) throw ARITHMETIC; return n; }
  function point(v, keys) { if (!exact(v, keys) || !keys.every(function (k) { return finite(v[k]); })) reject(); }
  function matrix(v) { if (!Array.isArray(v) || v.length !== 16 || !v.every(finite)) reject(); }
  function counters(v, coverage) {
    if (!exact(v, coverage ? COUNT_KEYS.concat('renderedCoverageComplete') : COUNT_KEYS) ||
        !COUNT_KEYS.every(function (k) { return integer(v[k]); }) || coverage && v.renderedCoverageComplete !== false) reject();
  }
  function zeroCounts() { var out = {}; COUNT_KEYS.forEach(function (k) { out[k] = 0; }); return out; }
  function mapping(v, id) {
    if (!exact(v, ['providedPercent', 'townBefore', 'sceneEffective', 'worldOrigin'])) reject();
    point(v.providedPercent, ['x', 'y']); point(v.worldOrigin, ['x', 'y', 'z']);
    ['townBefore', 'sceneEffective'].forEach(function (k) {
      var p = v[k];
      if (!exact(p, ['id', 'x', 'y', 'footprint', 'entrance']) || p.id !== id) reject();
      if (!finite(p.x) || !finite(p.y)) reject();
      point(p.footprint, ['x', 'y', 'rx', 'ry']); point(p.entrance, ['x', 'y']);
      if (p.footprint.rx <= 0 || p.footprint.ry <= 0) reject();
    });
  }
  function sprite(v) {
    if (!exact(v, ['name', 'kind', 'visibleAtCapture', 'originalArt', 'sourceSHA256', 'worldOrigin']) ||
        !text(v.name, 1024) || !text(v.kind, 1024) || !bool(v.visibleAtCapture) || !bool(v.originalArt) ||
        !(v.sourceSHA256 === null || typeof v.sourceSHA256 === 'string' && /^[0-9a-f]{64}$/i.test(v.sourceSHA256))) reject();
    point(v.worldOrigin, ['x', 'y', 'z']);
  }
  function mesh(v, placeId, seen, totals) {
    if (!exact(v, MESH_KEYS) || !text(v.id, 128) || !v.id.startsWith(placeId + ':mesh:') || seen.has(v.id) ||
        !text(v.name, 1024) || !text(v.geometryType, 256) || !['Float32Array', 'Float64Array'].includes(v.positionArrayType) ||
        !integer(v.positionCount) || v.positionCount === 0 || !integer(v.triangleCount) || v.triangleCount === 0) reject();
    seen.add(v.id);
    if (totals.meshCount + 1 > LIMITS.meshes || totals.positionCount + v.positionCount > LIMITS.positions ||
        (totals.triangleCount + v.triangleCount) * 3 > LIMITS.indices) throw LIMIT;
    if (!Array.isArray(v.worldPositions) || v.worldPositions.length !== v.positionCount * 3 ||
        !Array.isArray(v.xzPositions) || v.xzPositions.length !== v.positionCount * 2 ||
        !Array.isArray(v.indices) || v.indices.length !== v.triangleCount * 3 || !bool(v.indexWasPresent) ||
        !(v.indexArrayType === null || ['Uint8Array', 'Uint16Array', 'Uint32Array'].includes(v.indexArrayType)) ||
        v.indexWasPresent !== (v.indexArrayType !== null) ||
        !['visibleAtCapture', 'batchedOriginal', 'nonSolidWater', 'nonSolidWindow'].every(function (k) { return bool(v[k]); })) reject();
    if (!v.indexWasPresent && v.indices.length !== v.positionCount) reject();
    matrix(v.matrixWorld);
    if (v.batchedOriginal) {
      if (!text(v.batchName, 1024) || !integer(v.batchInstanceIndex)) reject();
      matrix(v.batchInstanceMatrix);
    } else if (v.batchName !== null || v.batchInstanceIndex !== null || v.batchInstanceMatrix !== null) reject();
    if (!exact(v.drawRange, ['start', 'count']) || !integer(v.drawRange.start) || v.drawRange.start > v.indices.length ||
        !(v.drawRange.count === null || integer(v.drawRange.count)) || !Array.isArray(v.geometryGroups) || v.geometryGroups.length > LIMITS.indices) reject();
    v.geometryGroups.forEach(function (g) {
      if (!exact(g, ['start', 'count', 'materialIndex']) || !integer(g.start) || !integer(g.count) || !integer(g.materialIndex) ||
          g.start > v.indices.length || g.count > v.indices.length - g.start) reject();
    });
    for (var p = 0; p < v.positionCount; p++) {
      var x = v.worldPositions[p * 3], y = v.worldPositions[p * 3 + 1], z = v.worldPositions[p * 3 + 2];
      if (!finite(x) || !finite(y) || !finite(z) || !finite(v.xzPositions[p * 2]) || !finite(v.xzPositions[p * 2 + 1]) ||
          x !== v.xzPositions[p * 2] || z !== v.xzPositions[p * 2 + 1]) reject();
    }
    var referenced = new Uint8Array(v.positionCount), count = 0;
    var indexMaximum = v.indexArrayType === 'Uint8Array' ? 255 : v.indexArrayType === 'Uint16Array' ? 65535 : 4294967295;
    var bounds = {minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity};
    for (var i = 0; i < v.indices.length; i++) {
      var n = v.indices[i];
      if (!integer(n) || n >= v.positionCount || n > indexMaximum || !v.indexWasPresent && n !== i) reject();
      if (!referenced[n]) {
        referenced[n] = 1; count++;
        var px = v.xzPositions[n * 2], pz = v.xzPositions[n * 2 + 1];
        bounds.minX = Math.min(bounds.minX, px); bounds.maxX = Math.max(bounds.maxX, px);
        bounds.minZ = Math.min(bounds.minZ, pz); bounds.maxZ = Math.max(bounds.maxZ, pz);
      }
    }
    safeDifference(bounds.maxX, bounds.minX); safeDifference(bounds.maxZ, bounds.minZ);
    totals.meshCount++; totals.positionCount += v.positionCount; totals.triangleCount += v.triangleCount;
    if (v.batchedOriginal) totals.batchedOriginalCount++;
    if (v.nonSolidWater) totals.nonSolidWaterMeshCount++;
    if (v.nonSolidWindow) totals.nonSolidWindowMeshCount++;
    return {id: v.id, name: v.name, bounds: bounds, storedVertexCount: v.positionCount, referencedVertexCount: count,
      unreferencedVertexCount: v.positionCount - count, triangleCount: v.triangleCount,
      visibleAtCapture: v.visibleAtCapture, batchedOriginal: v.batchedOriginal,
      nonSolidWater: v.nonSolidWater, nonSolidWindow: v.nonSolidWindow,
      drawRange: {start: v.drawRange.start, count: v.drawRange.count}, geometryGroupCount: v.geometryGroups.length};
  }
  function union(a, b) {
    if (a === null) return {minX: b.minX, minZ: b.minZ, maxX: b.maxX, maxZ: b.maxZ};
    a.minX = Math.min(a.minX, b.minX); a.minZ = Math.min(a.minZ, b.minZ);
    a.maxX = Math.max(a.maxX, b.maxX); a.maxZ = Math.max(a.maxZ, b.maxZ);
    safeDifference(a.maxX, a.minX); safeDifference(a.maxZ, a.minZ); return a;
  }
  function inspect(projectionJson) {
    try {
      if (typeof projectionJson !== 'string') reject();
      if (projectionJson.length > LIMITS.jsonCharacters) throw LIMIT;
      var input = JSON.parse(projectionJson);
      if (!exact(input, ROOT_KEYS) || input.ok !== true || input.version !== 1 || input.scope !== 'actual_scene_place_mesh_projection' ||
          input.coordinateSpace !== 'scene_world_xyz_and_xz' || input.collisionOrClearanceAssessed !== false ||
          input.gameOrStorageConnected !== false || input.mutationsPerformed !== false ||
          !Array.isArray(input.places) || input.places.length !== IDS.length) reject();
      point(input.worldSize, ['width', 'height']);
      if (input.worldSize.width <= 0 || input.worldSize.height <= 0 ||
          !text(input.originalArtState, 128) || !text(input.originalArtResourceState, 128) ||
          !['mappingValidation', 'geometryScope', 'batchMatrixScope', 'drawScope'].every(function (k) { return text(input[k], 8192); }) ||
          !Array.isArray(input.gaps) || input.gaps.length > 32 || !input.gaps.every(function (v) { return text(v, 8192); })) reject();
      counters(input.totals, false);
      if (input.totals.meshCount > LIMITS.meshes || input.totals.positionCount > LIMITS.positions ||
          input.totals.triangleCount * 3 > LIMITS.indices || input.totals.spriteCount > LIMITS.sprites) throw LIMIT;
      var byId = new Map(), seenMeshes = new Set(), sum = zeroCounts(), places = [];
      input.places.forEach(function (p) {
        if (!exact(p, ['id', 'mapping', 'meshes', 'sprites', 'coverage']) || !IDS.includes(p.id) || byId.has(p.id) ||
            !Array.isArray(p.meshes) || p.meshes.length > LIMITS.meshes || !Array.isArray(p.sprites) || p.sprites.length > LIMITS.sprites) reject();
        mapping(p.mapping, p.id); counters(p.coverage, true);
        var local = zeroCounts(), rows = [], bounds = null, referencedCount = 0;
        p.meshes.forEach(function (m) {
          var row = mesh(m, p.id, seenMeshes, sum);
          rows.push(row); bounds = union(bounds, row.bounds); referencedCount += row.referencedVertexCount;
          local.meshCount++; local.positionCount += row.storedVertexCount; local.triangleCount += row.triangleCount;
          if (row.batchedOriginal) local.batchedOriginalCount++;
          if (row.nonSolidWater) local.nonSolidWaterMeshCount++;
          if (row.nonSolidWindow) local.nonSolidWindowMeshCount++;
        });
        p.sprites.forEach(sprite);
        local.spriteCount = p.sprites.length; local.otherObjectCount = p.coverage.otherObjectCount;
        if (!COUNT_KEYS.every(function (k) { return p.coverage[k] === local[k]; })) reject();
        sum.spriteCount += local.spriteCount; sum.otherObjectCount += local.otherObjectCount;
        if (sum.spriteCount > LIMITS.sprites || !Number.isSafeInteger(sum.otherObjectCount)) throw LIMIT;
        byId.set(p.id, {id: p.id, measuredMeshBounds: bounds, measuredMeshCount: rows.length,
          storedVertexCount: local.positionCount, referencedVertexCount: referencedCount,
          unreferencedVertexCount: local.positionCount - referencedCount, triangleCount: local.triangleCount,
          unmeasuredSpriteCount: local.spriteCount, otherUnmeasuredObjectCount: local.otherObjectCount,
          provenance: {batchedOriginalCount: local.batchedOriginalCount, nonSolidWaterMeshCount: local.nonSolidWaterMeshCount,
            nonSolidWindowMeshCount: local.nonSolidWindowMeshCount, drawCoverageComplete: false}, meshes: rows});
      });
      if (!COUNT_KEYS.every(function (k) { return sum[k] === input.totals[k]; }) || sum.meshCount === 0) reject();
      IDS.forEach(function (id) { if (!byId.has(id)) reject(); places.push(byId.get(id)); });
      var pairs = [];
      for (var i = 0; i < places.length; i++) for (var j = i + 1; j < places.length; j++) {
        var a = places[i].measuredMeshBounds, b = places[j].measuredMeshBounds;
        if (a === null || b === null) pairs.push({ids: [places[i].id, places[j].id], relation: 'unavailable_no_mesh', axisSpans: null});
        else {
          var dx = safeDifference(Math.min(a.maxX, b.maxX), Math.max(a.minX, b.minX));
          var dz = safeDifference(Math.min(a.maxZ, b.maxZ), Math.max(a.minZ, b.minZ));
          pairs.push({ids: [places[i].id, places[j].id], relation: dx < 0 || dz < 0 ? 'bounds_separate' : dx === 0 || dz === 0 ? 'bounds_touch' : 'bounds_overlap',
            axisSpans: {signedOverlapX: dx, signedOverlapZ: dz, gapX: Math.max(0, -dx), gapZ: Math.max(0, -dz), overlapX: Math.max(0, dx), overlapZ: Math.max(0, dz)}});
        }
      }
      return freeze({ok: true, version: 1, scope: 'provided_actual_scene_projected_mesh_bounds_broad_phase', coordinateSpace: 'scene_world_xz',
        worldSize: {width: input.worldSize.width, height: input.worldSize.height}, originalArtState: input.originalArtState,
        originalArtResourceState: input.originalArtResourceState, places: places, pairs: pairs,
        totals: {measuredMeshCount: sum.meshCount, storedVertexCount: sum.positionCount,
          referencedVertexCount: places.reduce(function (n, p) { return n + p.referencedVertexCount; }, 0),
          unreferencedVertexCount: places.reduce(function (n, p) { return n + p.unreferencedVertexCount; }, 0),
          triangleCount: sum.triangleCount, unmeasuredSpriteCount: sum.spriteCount, otherUnmeasuredObjectCount: sum.otherObjectCount,
          batchedOriginalCount: sum.batchedOriginalCount, nonSolidWaterMeshCount: sum.nonSolidWaterMeshCount, nonSolidWindowMeshCount: sum.nonSolidWindowMeshCount},
        geometryScope: 'Envelope of triangle-index-referenced stored Mesh XZ positions. Every Mesh is included, including tagged water/windows and hidden batching originals; no collision policy filter.',
        relationScope: 'Exact JavaScript finite min/max/subtraction with no epsilon. Relations describe axis-aligned envelopes only; overlap/touch is not triangle contact. Separation excludes unmeasured objects and is not clearance.',
        drawScope: input.drawScope, sourceProjectionGaps: input.gaps.slice(),
        limits: ['Sprites and other scene objects are unmeasured; no-Mesh is unavailable, not empty or clear.',
          'Stored buffers include triangles outside the renderer drawRange/groups; envelopes do not prove actual draw coverage.',
          'No triangle intersection, swept path, navigation, physics, body/fit, placement permission or contractor acceptance/construction.',
          'Explicit caller JSON only; this consumer does not authenticate the source scene or saved game. Original typed-buffer bytes and negative zero are not preserved by JSON.'],
        collisionOrClearanceAssessed: false, gameOrStorageConnected: false, mutationsPerformed: false});
    } catch (error) {
      return Object.freeze({ok: false, error: error === LIMIT ? 'size_limit' : error === ARITHMETIC ? 'unsafe_arithmetic' : 'invalid_projection'});
    }
  }
  return Object.freeze({version: 1, inspect: inspect, limits: LIMITS});
}));

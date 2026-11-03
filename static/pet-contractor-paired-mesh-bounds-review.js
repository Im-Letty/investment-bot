/* Explicit endpoint mapping review only; never a placement or construction action. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pet-contractor-intent.js'), require('./pet-contractor-mesh-bounds.js'));
  else root.PetContractorPairedMeshBoundsReview = factory(root.PetContractorIntent, root.PetContractorMeshBounds);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Intent, Bounds) {
  'use strict';
  var intentInspect = Intent && Intent.inspect, boundsInspect = Bounds && Bounds.inspect;
  if (typeof intentInspect !== 'function' || typeof boundsInspect !== 'function') throw Error('paired_bounds_dependency_unavailable');
  var IDS = ['home', 'cafe', 'shop', 'playground', 'tree', 'flowers'];
  var LIMITS = Object.freeze({intentJsonCharacters: 1000000, projectionJsonCharacters: 64000000, combinedJsonCharacters: 96000000,
    endpointMeshes: 2048, endpointPositions: 1000000, endpointIndices: 3000000, endpointSprites: 16000, endpointGeometryGroups: 50000,
    combinedMeshes: 4096, combinedPositions: 2000000, combinedIndices: 6000000, combinedSprites: 32000, combinedGeometryGroups: 100000});
  var COUNTS = ['meshCount', 'positionCount', 'triangleCount', 'spriteCount', 'batchedOriginalCount', 'nonSolidWaterMeshCount', 'nonSolidWindowMeshCount', 'otherObjectCount'];
  var ROOT_KEYS = ['ok', 'version', 'scope', 'coordinateSpace', 'worldSize', 'originalArtState', 'originalArtResourceState', 'mappingValidation', 'geometryScope', 'batchMatrixScope', 'drawScope', 'places', 'totals', 'gaps', 'collisionOrClearanceAssessed', 'gameOrStorageConnected', 'mutationsPerformed'];
  var REPORT_KEYS = ['ok', 'version', 'scope', 'coordinateSpace', 'worldSize', 'originalArtState', 'originalArtResourceState', 'places', 'pairs', 'totals', 'geometryScope', 'relationScope', 'drawScope', 'sourceProjectionGaps', 'limits', 'collisionOrClearanceAssessed', 'gameOrStorageConnected', 'mutationsPerformed'];
  var PLACE_KEYS = ['id', 'measuredMeshBounds', 'measuredMeshCount', 'storedVertexCount', 'referencedVertexCount', 'unreferencedVertexCount', 'triangleCount', 'unmeasuredSpriteCount', 'otherUnmeasuredObjectCount', 'provenance', 'meshes'];
  var TOTAL_KEYS = ['measuredMeshCount', 'storedVertexCount', 'referencedVertexCount', 'unreferencedVertexCount', 'triangleCount', 'unmeasuredSpriteCount', 'otherUnmeasuredObjectCount', 'batchedOriginalCount', 'nonSolidWaterMeshCount', 'nonSolidWindowMeshCount'];
  var MESH_ROW_KEYS = ['id', 'name', 'bounds', 'storedVertexCount', 'referencedVertexCount', 'unreferencedVertexCount', 'triangleCount', 'visibleAtCapture', 'batchedOriginal', 'nonSolidWater', 'nonSolidWindow', 'drawRange', 'geometryGroupCount'];
  var PROVENANCE_KEYS = ['batchedOriginalCount', 'nonSolidWaterMeshCount', 'nonSolidWindowMeshCount', 'drawCoverageComplete'];
  var BAD = {}, currentEndpoint = null;
  function refuse(code) { var error = {marker: BAD, code: code, endpoint: currentEndpoint}; throw error; }
  function finite(n) { return typeof n === 'number' && Number.isFinite(n); }
  function count(n) { return Number.isSafeInteger(n) && n >= 0; }
  function text(s, max) { return typeof s === 'string' && s.length <= max; }
  function freeze(value) { if (value && typeof value === 'object') { Object.keys(value).forEach(function (k) { freeze(value[k]); }); Object.freeze(value); } return value; }
  // Never invoke a getter on a dependency reply or forward its opaque object.
  function fields(value, keys, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) refuse(code);
    var names = Reflect.ownKeys(value), out = {};
    if (names.length !== keys.length || names.some(function (k) { return typeof k !== 'string'; })) refuse(code);
    keys.forEach(function (key) {
      var d = Object.getOwnPropertyDescriptor(value, key);
      if (!d || !Object.prototype.hasOwnProperty.call(d, 'value')) refuse(code);
      out[key] = d.value;
    });
    return out;
  }
  function rows(value, maximum, length, code) {
    if (!Array.isArray(value)) refuse(code);
    var d = Object.getOwnPropertyDescriptor(value, 'length');
    if (!d || !count(d.value) || d.value > maximum || length !== null && d.value !== length) refuse(code);
    if (Reflect.ownKeys(value).length !== d.value + 1) refuse(code);
    var out = [];
    for (var i = 0; i < d.value; i++) {
      var item = Object.getOwnPropertyDescriptor(value, String(i));
      if (!item || !Object.prototype.hasOwnProperty.call(item, 'value')) refuse(code);
      out.push(item.value);
    }
    return out;
  }
  function xy(value, code) { var p = fields(value, ['x', 'y'], code); if (!finite(p.x) || !finite(p.y)) refuse(code); return p; }
  function xyz(value, code) { var p = fields(value, ['x', 'y', 'z'], code); if (!finite(p.x) || !finite(p.y) || !finite(p.z)) refuse(code); return p; }
  function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function layout(value, code) {
    var x = fields(value, ['version', 'theme', 'items'], code);
    if (x.version !== 1 || x.theme !== 'cafe') refuse(code);
    var seen = new Set(), items = rows(x.items, 6, 6, code).map(function (row) {
      var p = fields(row, ['id', 'x', 'y'], code);
      if (!IDS.includes(p.id) || seen.has(p.id) || !count(p.x) || p.x > 100 || !count(p.y) || p.y > 100) refuse(code);
      seen.add(p.id); return p;
    });
    return {version: 1, theme: 'cafe', items: items};
  }
  function parse(value, code) { try { return JSON.parse(value); } catch (_) { refuse(code); } }
  function boundedIntent(snapshotJson, proposalJson) {
    var s = fields(parse(snapshotJson, 'invalid_snapshot'), ['revision', 'currentLayout'], 'invalid_snapshot');
    if (!count(s.revision) || s.revision > 9000000000000) refuse('invalid_snapshot');
    var current = layout(s.currentLayout, 'invalid_snapshot');
    var p = fields(parse(proposalJson, 'invalid_proposal'), ['version', 'expectedRevision', 'requestedLayout'], 'invalid_proposal');
    if (p.version !== 1 || !count(p.expectedRevision) || p.expectedRevision > 9000000000000) refuse('invalid_proposal');
    var requested = layout(p.requestedLayout, 'invalid_proposal');
    if (s.revision !== p.expectedRevision) refuse('stale_revision');
    var changes = [], before = new Map(current.items.map(function (row) { return [row.id, row]; }));
    requested.items.forEach(function (row) { var old = before.get(row.id); if (old.x !== row.x || old.y !== row.y) changes.push({id: row.id, from: {x: old.x, y: old.y}, to: {x: row.x, y: row.y}}); });
    var reply;
    try { reply = intentInspect(snapshotJson, proposalJson); } catch (_) { refuse('dependency_reply_invalid'); }
    var r = fields(reply, ['ok', 'stage', 'draft', 'changes'], 'dependency_reply_invalid');
    var draft = fields(r.draft, ['version', 'expectedRevision', 'requestedLayout'], 'dependency_reply_invalid');
    if (r.ok !== true || r.stage !== 'unsubmitted' || draft.version !== 1 || draft.expectedRevision !== p.expectedRevision ||
        !equal(layout(draft.requestedLayout, 'dependency_reply_invalid'), requested)) refuse('dependency_reply_invalid');
    var importedChanges = rows(r.changes, 6, changes.length, 'dependency_reply_invalid').map(function (row) {
      var v = fields(row, ['id', 'from', 'to'], 'dependency_reply_invalid');
      if (typeof v.id !== 'string' || !IDS.includes(v.id)) refuse('dependency_reply_invalid');
      return {id: v.id, from: xy(v.from, 'dependency_reply_invalid'), to: xy(v.to, 'dependency_reply_invalid')};
    });
    if (!equal(importedChanges, changes)) refuse('dependency_reply_invalid');
    return {revision: s.revision, current: current, requested: requested, changes: changes};
  }
  function numbers(value, keys, code) { var v = fields(value, keys, code); if (!keys.every(function (k) { return count(v[k]); })) refuse(code); return v; }
  function add(a, b, maximum) { var value = a + b; if (!count(value) || value > maximum) refuse('size_limit'); return value; }
  function mapping(value) {
    var m = fields(value, ['providedPercent', 'townBefore', 'sceneEffective', 'worldOrigin'], 'invalid_projection');
    var out = {providedPercent: xy(m.providedPercent, 'invalid_projection')};
    ['townBefore', 'sceneEffective'].forEach(function (key) {
      var p = fields(m[key], ['id', 'x', 'y', 'footprint', 'entrance'], 'invalid_projection');
      var f = fields(p.footprint, ['x', 'y', 'rx', 'ry'], 'invalid_projection');
      if (!IDS.includes(p.id) || !finite(p.x) || !finite(p.y) || !Object.keys(f).every(function (k) { return finite(f[k]); }) || f.rx <= 0 || f.ry <= 0) refuse('invalid_projection');
      out[key] = {id: p.id, x: p.x, y: p.y, footprint: f, entrance: xy(p.entrance, 'invalid_projection')};
    });
    out.worldOrigin = xyz(m.worldOrigin, 'invalid_projection'); return out;
  }
  // Length/counter work is completed for both endpoints before any bounds call.
  function preflight(json, explicitLayout) {
    var input = fields(parse(json, 'invalid_projection'), ROOT_KEYS, 'invalid_projection');
    if (input.ok !== true || input.version !== 1 || input.scope !== 'actual_scene_place_mesh_projection' || input.coordinateSpace !== 'scene_world_xyz_and_xz' ||
        input.collisionOrClearanceAssessed !== false || input.gameOrStorageConnected !== false || input.mutationsPerformed !== false) refuse('invalid_projection');
    var size = fields(input.worldSize, ['width', 'height'], 'invalid_projection');
    if (!finite(size.width) || !finite(size.height) || size.width <= 0 || size.height <= 0) refuse('invalid_projection');
    var total = numbers(input.totals, COUNTS, 'invalid_projection');
    if (total.meshCount > LIMITS.endpointMeshes || total.positionCount > LIMITS.endpointPositions || total.triangleCount > LIMITS.endpointIndices / 3 || total.spriteCount > LIMITS.endpointSprites) refuse('size_limit');
    var resource = {meshes: 0, positions: 0, indices: 0, sprites: 0, groups: 0}, maps = new Map(), expected = new Map(explicitLayout.items.map(function (p) { return [p.id, p]; }));
    rows(input.places, 6, 6, 'invalid_projection').forEach(function (value) {
      var p = fields(value, ['id', 'mapping', 'meshes', 'sprites', 'coverage'], 'invalid_projection');
      if (!IDS.includes(p.id) || maps.has(p.id)) refuse('invalid_projection');
      var map = mapping(p.mapping), percent = map.providedPercent, wanted = expected.get(p.id);
      if (map.townBefore.id !== p.id || map.sceneEffective.id !== p.id) refuse('invalid_projection');
      if (percent.x !== wanted.x || percent.y !== wanted.y) refuse('mapping_mismatch');
      maps.set(p.id, map);
      if (!Array.isArray(p.meshes) || p.meshes.length > LIMITS.endpointMeshes || !Array.isArray(p.sprites) || p.sprites.length > LIMITS.endpointSprites) refuse('size_limit');
      resource.meshes = add(resource.meshes, p.meshes.length, LIMITS.endpointMeshes); resource.sprites = add(resource.sprites, p.sprites.length, LIMITS.endpointSprites);
      p.meshes.forEach(function (mesh) {
        if (!mesh || typeof mesh !== 'object' || !count(mesh.positionCount) || !count(mesh.triangleCount) || mesh.positionCount === 0 || mesh.triangleCount === 0) refuse('invalid_projection');
        resource.positions = add(resource.positions, mesh.positionCount, LIMITS.endpointPositions);
        if (mesh.triangleCount > LIMITS.endpointIndices / 3) refuse('size_limit');
        resource.indices = add(resource.indices, mesh.triangleCount * 3, LIMITS.endpointIndices);
        if (!Array.isArray(mesh.worldPositions) || mesh.worldPositions.length !== mesh.positionCount * 3 || !Array.isArray(mesh.xzPositions) || mesh.xzPositions.length !== mesh.positionCount * 2 ||
            !Array.isArray(mesh.indices) || mesh.indices.length !== mesh.triangleCount * 3 || !Array.isArray(mesh.geometryGroups)) refuse('invalid_projection');
        resource.groups = add(resource.groups, mesh.geometryGroups.length, LIMITS.endpointGeometryGroups);
      });
    });
    if (resource.meshes !== total.meshCount || resource.positions !== total.positionCount || resource.indices !== total.triangleCount * 3 || resource.sprites !== total.spriteCount) refuse('invalid_projection');
    return {worldSize: size, mapping: maps, resource: resource};
  }
  function bounds(value, code) { var b = fields(value, ['minX', 'minZ', 'maxX', 'maxZ'], code); if (!Object.keys(b).every(function (k) { return finite(b[k]); }) || b.minX > b.maxX || b.minZ > b.maxZ) refuse(code); return b; }
  function merge(a, b) { return a === null ? {minX: b.minX, minZ: b.minZ, maxX: b.maxX, maxZ: b.maxZ} : {minX: Math.min(a.minX, b.minX), minZ: Math.min(a.minZ, b.minZ), maxX: Math.max(a.maxX, b.maxX), maxZ: Math.max(a.maxZ, b.maxZ)}; }
  function measureRaw(mesh) {
    // Independent check of every copied mesh envelope/count; no imported ok-only trust.
    var visited = new Uint8Array(mesh.positionCount), referenced = 0, b = null;
    for (var p = 0; p < mesh.positionCount; p++) {
      var x = mesh.worldPositions[p * 3], y = mesh.worldPositions[p * 3 + 1], z = mesh.worldPositions[p * 3 + 2];
      if (!finite(x) || !finite(y) || !finite(z) || mesh.xzPositions[p * 2] !== x || mesh.xzPositions[p * 2 + 1] !== z) refuse('invalid_projection');
    }
    for (var i = 0; i < mesh.indices.length; i++) {
      var n = mesh.indices[i]; if (!count(n) || n >= mesh.positionCount) refuse('invalid_projection');
      if (!visited[n]) { visited[n] = 1; referenced++; var px = mesh.xzPositions[n * 2], pz = mesh.xzPositions[n * 2 + 1]; b = merge(b, {minX: px, maxX: px, minZ: pz, maxZ: pz}); }
    }
    return {bounds: b, referenced: referenced};
  }
  function pairs(places) {
    var result = [];
    for (var i = 0; i < 6; i++) for (var j = i + 1; j < 6; j++) {
      var a = places[i].measuredMeshBounds, b = places[j].measuredMeshBounds;
      if (a === null || b === null) result.push({ids: [places[i].id, places[j].id], relation: 'unavailable_no_mesh', axisSpans: null});
      else {
        var x = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX), z = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
        if (!finite(x) || !finite(z)) refuse('dependency_reply_invalid');
        result.push({ids: [places[i].id, places[j].id], relation: x < 0 || z < 0 ? 'bounds_separate' : x === 0 || z === 0 ? 'bounds_touch' : 'bounds_overlap', axisSpans: {signedOverlapX: x, signedOverlapZ: z, gapX: Math.max(0, -x), gapZ: Math.max(0, -z), overlapX: Math.max(0, x), overlapZ: Math.max(0, z)}});
      }
    }
    return result;
  }
  function endpoint(json, preflightResult) {
    var reply;
    try { reply = boundsInspect(json); } catch (_) { refuse('dependency_reply_invalid'); }
    // Known failure codes are kept small; no raw source exception is exposed.
    var ok = reply && Object.getOwnPropertyDescriptor(reply, 'ok');
    if (!ok || !Object.prototype.hasOwnProperty.call(ok, 'value')) refuse('dependency_reply_invalid');
    if (ok.value === false) {
      var fail = fields(reply, ['ok', 'error'], 'dependency_reply_invalid');
      if (!['size_limit', 'unsafe_arithmetic', 'invalid_projection'].includes(fail.error)) refuse('dependency_reply_invalid');
      refuse(fail.error);
    }
    var r = fields(reply, REPORT_KEYS, 'dependency_reply_invalid');
    var replySize = fields(r.worldSize, ['width', 'height'], 'dependency_reply_invalid');
    if (r.ok !== true || r.version !== 1 || r.scope !== 'provided_actual_scene_projected_mesh_bounds_broad_phase' || r.coordinateSpace !== 'scene_world_xz' ||
        r.collisionOrClearanceAssessed !== false || r.gameOrStorageConnected !== false || r.mutationsPerformed !== false ||
        replySize.width !== preflightResult.worldSize.width || replySize.height !== preflightResult.worldSize.height) refuse('dependency_reply_invalid');
    var raw = parse(json, 'invalid_projection'), original = new Map(raw.places.map(function (p) { return [p.id, p]; })), places = [], seen = new Set();
    rows(r.places, 6, 6, 'dependency_reply_invalid').forEach(function (value, ordinal) {
      var p = fields(value, PLACE_KEYS, 'dependency_reply_invalid');
      if (p.id !== IDS[ordinal] || seen.has(p.id)) refuse('dependency_reply_invalid'); seen.add(p.id);
      var source = original.get(p.id), derivedBounds = null, stored = 0, referenced = 0, triangles = 0, batches = 0, water = 0, windows = 0;
      var meshes = rows(p.meshes, LIMITS.endpointMeshes, source.meshes.length, 'dependency_reply_invalid');
      meshes.forEach(function (value, index) {
        var m = fields(value, MESH_ROW_KEYS, 'dependency_reply_invalid'), s = source.meshes[index], measured = measureRaw(s);
        var b = bounds(m.bounds, 'dependency_reply_invalid'), range = fields(m.drawRange, ['start', 'count'], 'dependency_reply_invalid');
        if (!count(range.start) || !(range.count === null || count(range.count))) refuse('dependency_reply_invalid');
        if (m.id !== s.id || m.name !== s.name || !equal(b, measured.bounds) || m.storedVertexCount !== s.positionCount || m.referencedVertexCount !== measured.referenced || m.unreferencedVertexCount !== s.positionCount - measured.referenced ||
            m.triangleCount !== s.triangleCount || m.geometryGroupCount !== s.geometryGroups.length || range.start !== s.drawRange.start || range.count !== s.drawRange.count ||
            !['visibleAtCapture', 'batchedOriginal', 'nonSolidWater', 'nonSolidWindow'].every(function (k) { return typeof m[k] === 'boolean' && m[k] === s[k]; })) refuse('dependency_reply_invalid');
        derivedBounds = merge(derivedBounds, b); stored += m.storedVertexCount; referenced += m.referencedVertexCount; triangles += m.triangleCount;
        if (m.batchedOriginal) batches++; if (m.nonSolidWater) water++; if (m.nonSolidWindow) windows++;
      });
      var selectedBounds = p.measuredMeshBounds === null ? null : bounds(p.measuredMeshBounds, 'dependency_reply_invalid');
      var prov = fields(p.provenance, PROVENANCE_KEYS, 'dependency_reply_invalid');
      if (!equal(selectedBounds, derivedBounds) || p.measuredMeshCount !== meshes.length || p.storedVertexCount !== stored || p.referencedVertexCount !== referenced || p.unreferencedVertexCount !== stored - referenced || p.triangleCount !== triangles ||
          p.unmeasuredSpriteCount !== source.sprites.length || p.otherUnmeasuredObjectCount !== source.coverage.otherObjectCount || prov.batchedOriginalCount !== batches || prov.nonSolidWaterMeshCount !== water || prov.nonSolidWindowMeshCount !== windows || prov.drawCoverageComplete !== false) refuse('dependency_reply_invalid');
      places.push({id: p.id, mapping: preflightResult.mapping.get(p.id), measuredMeshBounds: selectedBounds, measuredMeshCount: meshes.length,
        storedVertexCount: stored, referencedVertexCount: referenced, unreferencedVertexCount: stored - referenced, triangleCount: triangles,
        unmeasuredSpriteCount: p.unmeasuredSpriteCount, otherUnmeasuredObjectCount: p.otherUnmeasuredObjectCount, provenance: prov});
    });
    var expectedPairs = pairs(places);
    var importedPairs = rows(r.pairs, 15, 15, 'dependency_reply_invalid').map(function (value) {
      var p = fields(value, ['ids', 'relation', 'axisSpans'], 'dependency_reply_invalid'), ids = rows(p.ids, 2, 2, 'dependency_reply_invalid');
      if (!ids.every(function (id) { return typeof id === 'string' && IDS.includes(id); }) ||
          !['unavailable_no_mesh', 'bounds_separate', 'bounds_touch', 'bounds_overlap'].includes(p.relation)) refuse('dependency_reply_invalid');
      var axes = p.axisSpans === null ? null : fields(p.axisSpans, ['signedOverlapX', 'signedOverlapZ', 'gapX', 'gapZ', 'overlapX', 'overlapZ'], 'dependency_reply_invalid');
      if (axes && !Object.keys(axes).every(function (k) { return finite(axes[k]); })) refuse('dependency_reply_invalid');
      return {ids: ids, relation: p.relation, axisSpans: axes};
    });
    if (!equal(importedPairs, expectedPairs)) refuse('dependency_reply_invalid');
    var totals = numbers(r.totals, TOTAL_KEYS, 'dependency_reply_invalid'), expected = {};
    TOTAL_KEYS.forEach(function (k) { expected[k] = 0; });
    places.forEach(function (p) {
      expected.measuredMeshCount += p.measuredMeshCount; expected.storedVertexCount += p.storedVertexCount; expected.referencedVertexCount += p.referencedVertexCount; expected.unreferencedVertexCount += p.unreferencedVertexCount;
      expected.triangleCount += p.triangleCount; expected.unmeasuredSpriteCount += p.unmeasuredSpriteCount; expected.otherUnmeasuredObjectCount += p.otherUnmeasuredObjectCount;
      expected.batchedOriginalCount += p.provenance.batchedOriginalCount; expected.nonSolidWaterMeshCount += p.provenance.nonSolidWaterMeshCount; expected.nonSolidWindowMeshCount += p.provenance.nonSolidWindowMeshCount;
    });
    if (!equal(totals, expected)) refuse('dependency_reply_invalid');
    // Unused prose/opaque values in the dependency reply are never copied or stringified.
    return {places: places, pairs: expectedPairs, totals: totals};
  }
  function inspect(snapshotJson, proposalJson, currentProjectionJson, requestedProjectionJson) {
    var previousEndpoint = currentEndpoint;
    currentEndpoint = null;
    try {
      var inputs = [snapshotJson, proposalJson, currentProjectionJson, requestedProjectionJson];
      if (!inputs.every(function (s) { return typeof s === 'string'; })) refuse('invalid_arguments');
      if (snapshotJson.length > LIMITS.intentJsonCharacters || proposalJson.length > LIMITS.intentJsonCharacters || currentProjectionJson.length > LIMITS.projectionJsonCharacters || requestedProjectionJson.length > LIMITS.projectionJsonCharacters ||
          inputs.reduce(function (sum, s) { return sum + s.length; }, 0) > LIMITS.combinedJsonCharacters) refuse('size_limit');
      var intent = boundedIntent(snapshotJson, proposalJson);
      currentEndpoint = 'current'; var a = preflight(currentProjectionJson, intent.current);
      currentEndpoint = 'requested'; var b = preflight(requestedProjectionJson, intent.requested);
      currentEndpoint = null;
      if (!equal(a.worldSize, b.worldSize)) refuse('world_size_mismatch');
      [['meshes', 'combinedMeshes'], ['positions', 'combinedPositions'], ['indices', 'combinedIndices'], ['sprites', 'combinedSprites'], ['groups', 'combinedGeometryGroups']].forEach(function (row) { add(a.resource[row[0]], b.resource[row[0]], LIMITS[row[1]]); });
      currentEndpoint = 'current'; var first = endpoint(currentProjectionJson, a);
      currentEndpoint = 'requested'; var second = endpoint(requestedProjectionJson, b);
      currentEndpoint = null;
      var changed = new Set(intent.changes.map(function (p) { return p.id; }));
      var perPlace = IDS.map(function (id, i) { return {id: id, layoutChanged: changed.has(id), providedPercentEqual: equal(first.places[i].mapping.providedPercent, second.places[i].mapping.providedPercent),
        effectiveOriginEqual: equal(first.places[i].mapping.worldOrigin, second.places[i].mapping.worldOrigin), measuredBoundsEqual: equal(first.places[i].measuredMeshBounds, second.places[i].measuredMeshBounds)}; });
      var comparisons = first.pairs.map(function (p, i) { return {ids: p.ids.slice(), currentRelation: p.relation, requestedRelation: second.pairs[i].relation, relationChanged: p.relation !== second.pairs[i].relation}; });
      return freeze({ok: true, version: 1, scope: 'provided_explicit_layout_mapping_paired_endpoint_mesh_bounds_review', stage: 'unsubmitted_readonly_review', expectedRevision: intent.revision,
        worldSize: a.worldSize, binding: {mappingOnly: true, sourceAuthenticated: false, ownerSaveAuthenticated: false, endpointRoleAuthenticated: false, projectionRevisionSignature: false}, changes: intent.changes,
        endpoints: {current: first, requested: second}, perPlace: perPlace, pairComparisons: comparisons,
        limits: ['Only six supplied providedPercent mappings are compared with the explicit layouts; projections contain no authenticated role or revision signature. Equal-layout swapped projections may be indistinguishable.',
          'townBefore, sceneEffective and worldOrigin are separate supplied context stages; their authenticity or source scene is not independently established.',
          'Bounds describe triangle-index-referenced stored Mesh envelopes, including water/window tags and hidden batching originals. Sprites and other objects remain unmeasured; draw coverage is incomplete.',
          'No cross-endpoint sweep, triangle contact, clearance, navigation, physics, body fit, owner save, placement permission, contractor receipt or construction is assessed.',
          'Known captured module methods are dependencies, not a sandbox for arbitrary hostile host code. No original typed-buffer or negative-zero byte identity is claimed.'],
        collisionOrClearanceAssessed: false, gameOrStorageConnected: false, mutationsPerformed: false});
    } catch (error) {
      var code = 'dependency_reply_invalid', endpointName = currentEndpoint;
      try {
        var tag = error && Object.getOwnPropertyDescriptor(error, 'marker');
        if (tag && Object.prototype.hasOwnProperty.call(tag, 'value') && tag.value === BAD) {
          code = Object.getOwnPropertyDescriptor(error, 'code').value;
          endpointName = Object.getOwnPropertyDescriptor(error, 'endpoint').value;
        }
      } catch (_) { /* An opaque thrown value never exposes its getters or text. */ }
      return Object.freeze({ok: false, error: code, endpoint: endpointName});
    } finally { currentEndpoint = previousEndpoint; }
  }
  return Object.freeze({version: 1, inspect: inspect, limits: LIMITS});
}));

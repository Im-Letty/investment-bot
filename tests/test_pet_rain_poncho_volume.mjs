import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import * as T from '../static/vendor/three-0.160.1.module.js';
import {build, spec} from '../static/pet-rain-poncho-volume-proof-20261031/poncho.mjs';
import {finiteAudit} from '../static/pet-rain-poncho-volume-proof-20261031/audit.mjs';
import {authoredBoundsArrays, fitPonchoView} from '../static/pet-rain-poncho-volume-proof-20261031/framing.mjs';
import {fitView as legacyFitView} from '../static/pet-scalloped-path-proof-20261027/framing.mjs';
import {inspectTopology, inspectCrossings, strictContainment} from '../static/pet-breeze-cape-proof-20261029/geometry-audit.mjs';
import {independentSegmentAudit} from '../static/pet-breeze-cape-proof-20261029/audit.mjs';
import {startPreview, failureDetails} from '../static/pet-rain-poncho-volume-proof-20261031/entry.mjs';

const root = new URL('../', import.meta.url);
const folder = new URL('../static/pet-rain-poncho-volume-proof-20261031/', import.meta.url);
const read = name => fs.readFileSync(new URL(name, folder));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const model = build(T);
after(() => model.dispose());

// This oracle examines all stored positions/normals, including unused entries.
function bufferErrors(geometry) {
  const p = geometry.getAttribute('position');
  const n = geometry.getAttribute('normal');
  const i = geometry.getIndex();
  const errors = [];
  if (!p || p.itemSize !== 3 || !Number.isInteger(p.count) || !p.count ||
      !Array.from(p.array).every(Number.isFinite)) errors.push('position');
  if (!n || !p || n.itemSize !== 3 || n.count !== p.count ||
      !Array.from(n.array).every(Number.isFinite)) errors.push('normal');
  if (!i || i.itemSize !== 1 || !i.count || i.count % 3 || !p ||
      !Array.from(i.array).every(value => Number.isInteger(value) && value >= 0 && value < p.count)) errors.push('index');
  return errors;
}

function geometryFingerprint(geometry) {
  const p = geometry.getAttribute('position'), i = geometry.getIndex();
  const layout = Buffer.from(JSON.stringify({
    positionType: p.array.constructor.name, positionItemSize: p.itemSize, positionCount: p.count,
    indexType: i.array.constructor.name, indexItemSize: i.itemSize, indexCount: i.count
  }));
  return hash(Buffer.concat([layout,
    Buffer.from(p.array.buffer, p.array.byteOffset, p.array.byteLength),
    Buffer.from(i.array.buffer, i.array.byteOffset, i.array.byteLength)]));
}

function uniqueGeometries(item) {
  return [...new Set(item.parts.map(part => part.geometry))];
}

function actualPoints(item) {
  item.group.updateMatrixWorld(true);
  const points = [];
  for (const part of item.parts) {
    const positions = part.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++)
      points.push(new T.Vector3().fromBufferAttribute(positions, i).applyMatrix4(part.matrixWorld));
  }
  return points;
}

test('every rendered material part has finite indexed buffers and finite positive authored transforms', () => {
  assert(model.parts.length > 0);
  model.group.updateMatrixWorld(true);
  for (const part of model.parts) {
    assert.deepEqual(bufferErrors(part.geometry), [], part.name);
    assert(part.matrixWorld.elements.every(Number.isFinite), part.name);
    assert(part.matrixWorld.determinant() > 0, part.name);
    const normals = part.geometry.getAttribute('normal');
    for (let i = 0; i < normals.count; i++) {
      const length = Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i));
      assert(Math.abs(length - 1) < 2e-4, `${part.name}: stored normal ${i}`);
    }
  }
});

test('a genuinely unused NaN position and fractional or out-of-range indices fail the buffer oracle', () => {
  const g = model.parts[0].geometry.clone();
  const originalIndex = Array.from(g.index.array);
  try {
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    g.setAttribute('position', new T.BufferAttribute(new Float32Array([...p.array, NaN, 0, 0]), 3));
    g.setAttribute('normal', new T.BufferAttribute(new Float32Array([...n.array, 0, 1, 0]), 3));
    assert.equal(g.getAttribute('position').count, p.count + 1);
    assert.equal(g.getAttribute('normal').count, g.getAttribute('position').count);
    assert.deepEqual(Array.from(g.index.array), originalIndex);
    assert(!originalIndex.includes(g.getAttribute('position').count - 1));
    assert.deepEqual(bufferErrors(g), ['position']);
  } finally { g.dispose(); }
  for (const mutate of [
    x => x.setIndex(new T.BufferAttribute(new Float32Array([0, .5, 2]), 1)),
    x => x.setIndex([0, 1, x.getAttribute('position').count]),
    x => x.deleteAttribute('normal')
  ]) {
    const x = model.parts[0].geometry.clone();
    try { mutate(x); assert(bufferErrors(x).length > 0); }
    finally { x.dispose(); }
  }
});

test('actual welded triangle topology is closed, nondegenerate and outward, with a removed-face negative control', () => {
  for (const geometry of uniqueGeometries(model)) {
    const result = inspectTopology(T, geometry);
    assert(result.closedEdges);
    assert.equal(result.badEdges, 0);
    assert.equal(result.degenerateTriangles, 0);
    assert.equal(result.invalidNormals, 0);
    assert(result.signedVolume > 0);
    const p = geometry.attributes.position, n = geometry.attributes.normal, index = geometry.index;
    for (let j = 0; j < index.count; j += 3) {
      const ids = [index.getX(j), index.getX(j + 1), index.getX(j + 2)];
      const [a, b, c] = ids.map(id => new T.Vector3().fromBufferAttribute(p, id));
      const face = b.sub(a).cross(c.sub(a)).normalize();
      const stored = ids.reduce((sum, id) => sum.add(new T.Vector3().fromBufferAttribute(n, id)), new T.Vector3()).normalize();
      assert(face.dot(stored) > 0, `stored normals face the actual oriented triangle ${j / 3}`);
    }
  }
  const g = model.parts[0].geometry.clone();
  try {
    g.setIndex(Array.from(g.index.array).slice(3));
    assert.equal(inspectTopology(T, g).closedEdges, false);
  } finally { g.dispose(); }
});

test('owned material geometries have no strict nonadjacent edge/interior crossings and a real crossing control fails', () => {
  for (const geometry of uniqueGeometries(model))
    assert.equal(inspectCrossings(T, geometry).strictEdgeInteriorCrossings, 0);
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute([
    -1, 0, 0, 1, 0, 0, 0, 1, 0,
    0, .25, -1, 0, .25, 1, .5, .75, 0
  ], 3));
  g.setIndex([0, 1, 2, 3, 4, 5]);
  try { assert(inspectCrossings(T, g).strictEdgeInteriorCrossings > 0); }
  finally { g.dispose(); }
});

test('actual material witnesses connect every rendered decoration and hood to the main shell', () => {
  const parts = new Map(model.parts.map(part => [part.name, part]));
  assert.equal(parts.size, model.parts.length);
  assert(parts.has(model.shell.name));
  assert(model.contactWitnesses.length >= model.parts.length - 1);
  const graph = new Map(model.parts.map(part => [part.name, new Set()]));
  for (const witness of model.contactWitnesses) {
    assert(parts.has(witness.part), witness.part);
    assert(parts.has(witness.target), witness.target);
    for (const name of [witness.part, witness.target]) {
      const actual = strictContainment(T, parts.get(name), witness.point);
      assert(actual.inside, `${witness.part}/${witness.target}: ${name}`);
      assert(actual.minimumSurfaceClearance > 0);
    }
    graph.get(witness.part).add(witness.target);
    graph.get(witness.target).add(witness.part);
  }
  const visited = new Set([model.shell.name]), queue = [model.shell.name];
  for (const name of queue) for (const next of graph.get(name))
    if (!visited.has(next)) { visited.add(next); queue.push(next); }
  assert.equal(visited.size, model.parts.length);
});

test('a displaced decorative part loses a strict actual shared-solid join', () => {
  const witness = model.contactWitnesses.find(row => row.part !== model.shell.name);
  assert(witness);
  const part = model.parts.find(part => part.name === witness.part), before = part.position.clone();
  assert(strictContainment(T, part, witness.point).inside);
  try {
    part.position.x += 20;
    model.group.updateMatrixWorld(true);
    assert.equal(strictContainment(T, part, witness.point).inside, false);
  } finally { part.position.copy(before); model.group.updateMatrixWorld(true); }
});

test('declared hood, neck, hem and sleeve routes are empty through all actual parts and a real obstruction is detected', () => {
  assert(model.passages.length > 0);
  const kinds = new Set(model.passages.map(route => route.kind));
  for (const name of ['hood', 'neck', 'hem', 'left', 'right'])
    assert([...kinds].some(kind => kind.includes(name)), `missing ${name} passage scope`);
  for (const route of model.passages) {
    assert.equal(route.from.length, 3); assert.equal(route.to.length, 3);
    assert([...route.from, ...route.to].every(Number.isFinite));
    assert.equal(independentSegmentAudit(T, model.parts, route.from, route.to).length, 0, route.kind);
  }
  const route = model.passages.find(route => route.kind.includes('hood'));
  const from = new T.Vector3(...route.from), to = new T.Vector3(...route.to);
  const size = Math.min(.08, from.distanceTo(to) / 4);
  assert(size > 1e-5);
  const geometry = new T.BoxGeometry(size, size, size);
  const material = new T.MeshBasicMaterial({side: T.DoubleSide});
  const blocker = new T.Mesh(geometry, material);
  blocker.position.copy(from).lerp(to, .5); blocker.updateMatrixWorld(true);
  try {
    assert(independentSegmentAudit(T, [...model.parts, blocker], route.from, route.to).length >= 2);
  } finally { geometry.dispose(); material.dispose(); }
});

test('thickness sample pairs resolve to actual distinct inner and outer material vertices', () => {
  assert(model.thicknessSamples.length > 0);
  const positions = new Map(model.parts.map(part => [part.name,
    Array.from({length: part.geometry.attributes.position.count}, (_, index) =>
      new T.Vector3().fromBufferAttribute(part.geometry.attributes.position, index).applyMatrix4(part.matrixWorld))]));
  for (const sample of model.thicknessSamples) {
    assert(positions.has(sample.part), sample.part);
    const outer = new T.Vector3(...sample.outer), inner = new T.Vector3(...sample.inner);
    for (const actual of [outer, inner])
      assert(positions.get(sample.part).some(point => point.distanceTo(actual) < 1e-6), `${sample.part}: bound stored vertex`);
    const distance = outer.distanceTo(inner);
    assert(distance > 1e-5);
    assert(Math.abs(distance - sample.distance) < 1e-6);
  }
});

test('occupied actual wall chords traverse real material while a separate exterior ray stays empty', () => {
  assert(model.materialControls.length > 0);
  const parts = new Map(model.parts.map(part => [part.name, part]));
  for (const chord of model.materialControls) {
    assert(parts.has(chord.part), chord.part);
    const hits = independentSegmentAudit(T, [parts.get(chord.part)], chord.from, chord.to);
    const distances = hits.map(hit => hit.distance).sort((a, b) => a - b)
      .filter((distance, index, array) => !index || distance - array[index - 1] > 1e-6);
    assert(distances.length >= 2, chord.kind);
    const origin = new T.Vector3(...chord.from), direction = new T.Vector3(...chord.to).sub(origin).normalize();
    let occupied = 0;
    for (let i = 1; i < distances.length; i++) {
      const midpoint = origin.clone().addScaledVector(direction, (distances[i - 1] + distances[i]) / 2);
      if (strictContainment(T, parts.get(chord.part), midpoint.toArray()).inside) {
        assert(distances[i] - distances[i - 1] > 1e-5);
        occupied++;
      }
    }
    assert(occupied > 0, chord.kind);
  }
  const bounds = authoredBoundsArrays(new T.Box3().setFromObject(model.group, true));
  const from = [bounds.max[0] + 2, bounds.max[1] + 2, bounds.max[2] + 2];
  const to = [bounds.max[0] + 3, bounds.max[1] + 2, bounds.max[2] + 2];
  assert.equal(independentSegmentAudit(T, model.parts, from, to).length, 0);
});

test('exact v3 reference and compiled source bindings preserve the existing design/version distinction', () => {
  const input = JSON.parse(read('input-manifest.json')), png = read('reference.png');
  assert.equal(hash(png), 'b06404edeb06f2ec3b9466e4877d433699dbdc0ed04fa9c51e8a148b0b562ed3');
  assert.equal(png.length, 1558555);
  assert.equal(png.readUInt32BE(16), 1254); assert.equal(png.readUInt32BE(20), 1254);
  assert.equal(input.selected_source_version, 'v3');
  assert.equal(input.source_original.sha256, hash(png));
  assert.equal(input.source_original.bytes, png.length);
  assert.equal(input.version_bound_input.sha256, '1e80e228df3b6990d084e742434c293434caa350cc9ea675cf1e3bd4be4d55df');
  assert.equal(spec.sourceSHA, hash(png));
  assert.equal(input.model_id, spec.id); assert.equal(input.unit_id, spec.unit);
  assert.equal(input.run_id, 'automation360-20261031-223343');
  const testBytes = fs.readFileSync(new URL(import.meta.url));
  assert.equal(input.formal_test.path, 'tests/test_pet_rain_poncho_volume.mjs');
  assert.equal(input.formal_test.sha256, hash(testBytes));
  assert.equal(input.formal_test.bytes, testBytes.length);
  assert(Object.keys(input.artifacts).length > 0);
  for (const [name, expected] of Object.entries(input.artifacts)) {
    const bytes = read(name);
    assert.equal(hash(bytes), expected.sha256, name);
    assert.equal(bytes.length, expected.bytes, name);
    assert(!bytes.includes(Buffer.from('/' + 'Users' + '/')), name);
  }
  assert(Object.keys(input.unchanged_dependencies).length > 0);
  for (const [name, expected] of Object.entries(input.unchanged_dependencies)) {
    const bytes = fs.readFileSync(new URL(name, root));
    assert.equal(hash(bytes), expected.sha256, name); assert.equal(bytes.length, expected.bytes, name);
  }
});

test('135 finite cameras project all actual mesh vertices and eight separate real-box corners without scaling the item', () => {
  const points = actualPoints(model), real = new T.Box3().setFromObject(model.group, true);
  const bounds = authoredBoundsArrays(real), original = model.group.matrixWorld.toArray();
  let cases = 0;
  for (const aspect of [320 / 350, 390 / 350, 844 / 320])
    for (const yaw of [0, 45, 90, 180, 270])
      for (const pitch of [-82, 18, 86])
        for (const roll of [-25, 0, 25]) {
          const view = {yaw, pitch, roll, distance: 1};
          const fit = fitPonchoView(T, real, view, aspect);
          const camera = new T.PerspectiveCamera(46, aspect, .005, 100);
          const target = new T.Vector3(...fit.targetLocal), a = yaw * Math.PI / 180, p = pitch * Math.PI / 180;
          camera.position.copy(target).addScaledVector(new T.Vector3(Math.sin(a) * Math.cos(p), Math.sin(p), Math.cos(a) * Math.cos(p)), fit.actualDistance);
          camera.lookAt(target); camera.rotateZ(roll * Math.PI / 180); camera.updateMatrixWorld(true);
          for (const point of points) {
            const q = point.clone().project(camera);
            assert(q.toArray().every(Number.isFinite));
            assert(Math.abs(q.x) < 1 && Math.abs(q.y) < 1 && Math.abs(q.z) < 1);
          }
          const corners = [];
          for (const x of [bounds.min[0], bounds.max[0]])
            for (const y of [bounds.min[1], bounds.max[1]])
              for (const z of [bounds.min[2], bounds.max[2]]) corners.push(new T.Vector3(x, y, z).project(camera));
          assert.equal(corners.length, 8);
          const actual = {minX: Math.min(...corners.map(p => p.x)), maxX: Math.max(...corners.map(p => p.x)), minY: Math.min(...corners.map(p => p.y)), maxY: Math.max(...corners.map(p => p.y))};
          for (const key in actual) assert(Math.abs(actual[key] - fit.ndcBounds[key]) < 1e-8);
          assert(actual.maxX - actual.minX > .05 && actual.maxY - actual.minY > .05);
          cases++;
        }
  assert.equal(cases, 135);
  assert.deepEqual(model.group.matrixWorld.toArray(), original);
  assert.deepEqual(model.group.scale.toArray(), [1, 1, 1]);
});

test('the preserved raw Vector3-bounds framing bug collapses while the dedicated numeric adapter catches it', () => {
  const box = new T.Box3().setFromObject(model.group, true), view = {yaw: 90, pitch: 18, roll: 0, distance: 1};
  const bad = legacyFitView(T, box, view, 320 / 350), good = fitPonchoView(T, box, view, 320 / 350);
  assert.equal(bad.ndcBounds.minX, bad.ndcBounds.maxX);
  assert.equal(bad.ndcBounds.minY, bad.ndcBounds.maxY);
  assert(good.ndcBounds.maxX - good.ndcBounds.minX > .05);
  assert(good.ndcBounds.maxY - good.ndcBounds.minY > .05);
  assert.deepEqual(good.authoredBounds, authoredBoundsArrays(box));
  assert.throws(() => authoredBoundsArrays({min: [0, 0, 0], max: [0, 1, 1]}), /invalid/);
});

test('startup sanitizes failure details and cleans owned resources once without automatic retry', async () => {
  const nodes = Object.fromEntries(['stage', 'status', 'report'].map(id => [id, {dataset: {}, textContent: ''}]));
  let loads = 0, starts = 0, cleanups = 0;
  assert.equal(await startPreview({doc: {getElementById: id => nodes[id]}, load: async () => {
    loads++;
    return {start(notify) { starts++; notify('reference_ready'); throw Error('private https://example.invalid/path?token=not-a-secret'); }, cleanup() { cleanups++; return {failed: 0}; }};
  }}), false);
  assert.equal(loads, 1); assert.equal(starts, 1); assert.equal(cleanups, 1);
  const result = JSON.parse(nodes.report.textContent);
  assert.equal(result.startup.phaseAtFailure, 'reference_ready');
  assert.equal(result.startup.automaticRetry, false);
  assert.equal(result.startup.failure.code, null);
  assert(!nodes.report.textContent.includes('example.invalid'));
  assert(!nodes.report.textContent.includes('token='));
  assert.deepEqual(failureDetails(Error('poncho_reference_sha')), {kind: 'Error', code: 'poncho_reference_sha', rawMessageStackOrURLSaved: false});
});

test('actual preset handlers clear stale whole and partial highlights after reset, sliders, drag and keyboard', () => {
  const source = read('viewer.mjs').toString();
  const module = source.split('\n').filter(line => !line.startsWith('import')).join('\n').replaceAll('export ', '');
  const start = source.indexOf('function manualPaint()'), end = source.indexOf("on($('capture'),'click'");
  assert(start > 0 && end > start);
  const bindings = source.slice(start, end);
  function fixture(script) {
    const controls = new Map(), listeners = new Map();
    const whole = ['front', 'side', 'back', 'top', 'bottom', 'oblique'].map(view => ({dataset: {view}, pressed: 'false', setAttribute(name, value) { if (name === 'aria-pressed') this.pressed = value; }}));
    const partial = ['inside_body', 'inside_hood'].map(partial => ({dataset: {partial}, pressed: 'false', setAttribute(name, value) { if (name === 'aria-pressed') this.pressed = value; }}));
    const stage = {focus() {}, setPointerCapture() {}};
    const doc = {querySelectorAll: selector => selector === '[data-view]' ? whole : partial, getElementById(id) {
      if (!controls.has(id)) controls.set(id, {value: id === 'distance' ? 3 : 0, min: id === 'distance' ? 1 : -360, max: 360});
      return controls.get(id);
    }};
    const context = vm.createContext({document: doc, window: {}, stage, T, cameraMode: 'whole', selectedView: null, drag: null, paint() {}, lights: [], scene: {background: {set() {}}}, on(object, event, handler) {
      if (!listeners.has(object)) listeners.set(object, {});
      listeners.get(object)[event] = handler;
    }});
    vm.runInContext(module, context); vm.runInContext(script, context);
    return {whole, partial, context, controls, doc, stage,
      click(name) { const button = name === 'reset' ? doc.getElementById(name) : [...whole, ...partial].find(button => button.dataset.view === name || button.dataset.partial === name); listeners.get(button).click(); },
      event(object, event, value = {}) { listeners.get(object)[event](value); }};
  }
  function resetCheck(f) {
    f.click('bottom'); assert.equal(f.whole.find(button => button.dataset.view === 'bottom').pressed, 'true');
    f.click('reset');
    assert(f.whole.every(button => button.pressed === 'false'), 'reset clears stale preset');
    assert(f.partial.every(button => button.pressed === 'false'));
    assert.equal(f.context.cameraMode, 'whole');
  }
  const f = fixture(bindings); resetCheck(f);
  for (const preset of ['inside_body', 'inside_hood', 'back']) for (const mode of ['slider', 'drag', 'keyboard']) {
    f.click(preset);
    if (mode === 'slider') f.event(f.doc.getElementById('yaw'), 'input');
    else if (mode === 'drag') {
      f.event(f.stage, 'pointerdown', {button: 0, isPrimary: true, pointerId: 1, clientX: 1, clientY: 1});
      f.event(f.stage, 'pointermove', {pointerId: 1, clientX: 25, clientY: 18});
    } else f.event(f.stage, 'keydown', {key: 'ArrowRight', preventDefault() {}});
    assert(f.whole.every(button => button.pressed === 'false'));
    assert(f.partial.every(button => button.pressed === 'false'));
    assert.equal(f.context.cameraMode, 'whole'); assert.equal(f.context.selectedView, null);
  }
  const staleReset = bindings.replace("on($('reset'),'click',()=>{cameraMode='whole';selectedView=null;selectViewPreset(document);", "on($('reset'),'click',()=>{cameraMode='whole';selectedView=null;");
  assert.notEqual(staleReset, bindings);
  assert.throws(() => resetCheck(fixture(staleReset)), /reset clears stale preset/);
});

test('six real material boundaries and indexed trim sections retain finite closed round loops without collapsed centers', () => {
  assert.deepEqual(Object.keys(model.rimPaths).sort(), ['hem', 'hood_face', 'hood_neck', 'left_cuff', 'neck', 'right_cuff']);
  for (const [name, path] of Object.entries(model.rimPaths)) {
    assert(path.length >= 16, name);
    assert(path.every(point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)));
    assert(new Set(path.map(point => point.map(x => Math.round(x * 1e6)).join(','))).size >= 16, name);
    const part = name.startsWith('hood_') ? model.hood : model.shell;
    const vertices = Array.from({length: part.geometry.attributes.position.count}, (_, index) =>
      new T.Vector3().fromBufferAttribute(part.geometry.attributes.position, index).applyMatrix4(part.matrixWorld));
    for (const point of path)
      assert(vertices.some(vertex => vertex.distanceTo(new T.Vector3(...point)) < 1e-6), `${name}: actual material boundary`);
  }
  assert(model.tubeProfiles.length > 0);
  for (const profile of model.tubeProfiles) {
    const part = model.parts.find(part => part.name === profile.part);
    assert(part && profile.closed);
    assert(profile.sections.length >= 33 && profile.radialSegments >= 8);
    const p = part.geometry.attributes.position, centers = [];
    for (const section of profile.sections) {
      assert.equal(section.vertices.length, profile.radialSegments);
      const ring = section.vertices.map(index => {
        assert(Number.isInteger(index) && index >= 0 && index < p.count);
        return new T.Vector3().fromBufferAttribute(p, index);
      });
      const actualCenter = ring.reduce((sum, point) => sum.add(point), new T.Vector3()).divideScalar(ring.length);
      assert(actualCenter.distanceTo(new T.Vector3(...section.center)) < 1e-6);
      for (const point of ring) assert(Math.abs(point.distanceTo(actualCenter) - profile.constantRadius) < 1e-6);
      centers.push(actualCenter);
    }
    assert(centers[0].distanceTo(centers.at(-1)) < 1e-6);
    const loop = centers.slice(0, -1);
    let maxTurn = 0;
    for (let i = 0; i < loop.length; i++) {
      const incoming = loop[i].clone().sub(loop[(i + loop.length - 1) % loop.length]);
      const outgoing = loop[(i + 1) % loop.length].clone().sub(loop[i]);
      assert(incoming.length() > 1e-6 && outgoing.length() > 1e-6);
      maxTurn = Math.max(maxTurn, incoming.angleTo(outgoing) * 180 / Math.PI);
    }
    assert(maxTurn < 35, `${profile.part}: finite adjacent section turn ${maxTurn}`);
    if (profile.part === 'gold-hood-face-binding') {
      // These are the two actual bilateral symmetry extrema, not a general
      // quantization allowance. Native Node/Chrome residual bits are controls.
      assert.equal(profile.segments % 4, 0);
      const symmetryX = [];
      for (const k of [profile.segments / 4, 3 * profile.segments / 4]) {
        const ring = profile.sections[k].vertices;
        const seam = Math.max(...ring) + 1;
        assert(new T.Vector3().fromBufferAttribute(p, ring[0]).distanceTo(new T.Vector3().fromBufferAttribute(p, seam)) < 1e-6);
        for (const id of [...ring, seam]) symmetryX.push(p.getX(id));
      }
      assert.equal(symmetryX.length, 18);
      const exactPositiveZero = values => assert(values.every(value => Object.is(value, 0)), 'analytic X=0 symmetry rings use exact positive zero');
      exactPositiveZero(symmetryX);
      const capturedNodeBits = [0x223f65e3,0xa7fbaea7,0xa831fc4e,0xa7fbaea7,0x223f65e3,0x27fbde80,0x2832143b,0x27fbde80,0x223f65e3,0x261a549a,0xa8f6f3ef,0xa92f9ef2,0xa8f6f3ef,0x261a549a,0x29004c9c,0x29347197,0x29004c9c,0x261a549a];
      const capturedChromeBits = [0xa607dc34,0xa806610d,0xa83a8608,0xa806610d,0xa607dc34,0x27eacb0d,0x28298a81,0x27eacb0d,0xa607dc34,0x26967acd,0xa8f25ee7,0xa92d546e,0xa8f25ee7,0x26967acd,0x29029720,0x2936bc1b,0x29029720,0x26967acd];
      for (const bits of [capturedNodeBits, capturedChromeBits])
        assert.throws(() => exactPositiveZero(new Float32Array(new Uint32Array(bits).buffer)), /exact positive zero/);
      assert.throws(() => exactPositiveZero([-0]), /exact positive zero/);
    }
  }
});

test('partial body and hood cameras begin in empty space and reach actual cream inner material without moving the garment', () => {
  const source = read('viewer.mjs').toString();
  const module = source.split('\n').filter(line => !line.startsWith('import')).join('\n').replaceAll('export ', '');
  const context = vm.createContext({document: {getElementById() {}}, window: {}, T});
  vm.runInContext(module, context);
  const points = actualPoints(model), before = model.group.matrixWorld.toArray();
  function approach(name, view) {
    const camera = new T.PerspectiveCamera(68, 708 / 479, .005, 100);
    camera.position.set(...view.eye).applyMatrix4(model.group.matrixWorld);
    camera.lookAt(new T.Vector3(...view.target).applyMatrix4(model.group.matrixWorld));
    camera.updateMatrixWorld(true);
    assert(model.parts.every(part => !strictContainment(T, part, camera.position.toArray()).inside));
    const projection = context.inspectProjection(T, points, camera);
    assert.equal(projection.finitePoints, points.length);
    assert(projection.insideClipVolume > 0);
    assert.match(projection.scope, /not visible pixels or occlusion/);
    const ray = new T.Raycaster(); ray.setFromCamera(new T.Vector2(0, 0), camera);
    const hit = ray.intersectObjects(model.parts, false)[0];
    assert(hit && hit.object === (name === 'body' ? model.shell : model.hood), 'central ray reaches intended garment material');
    assert.equal(hit.face.materialIndex, 1, 'central ray reaches actual cream inner material group');
    assert(hit.distance > .05, 'partial view is not placed directly on the wall');
  }
  assert.deepEqual(Object.keys(model.interiorViews).sort(), ['body', 'hood']);
  for (const [name, view] of Object.entries(model.interiorViews)) approach(name, view);
  assert.throws(() => approach('body', {eye: [0, 1.4, 3], target: [0, 1.4, 0]}), /intended garment material|cream inner material/);
  assert.deepEqual(model.group.matrixWorld.toArray(), before);
});

test('saved mesh and certificate reproduce actual buffers, grouped lining materials, poses and qualified geometry counts', () => {
  const certificate = JSON.parse(read('finite-geometry-certificate.json'));
  const mesh = JSON.parse(read('mesh-geometry.json'));
  assert.equal(certificate.model_sha256, hash(read('poncho.mjs')));
  assert.equal(certificate.audit_sha256, hash(read('audit.mjs')));
  assert.deepEqual(certificate.audit, JSON.parse(JSON.stringify(finiteAudit(T, model))));
  assert.equal(certificate.audit.result, 'pass');
  assert.equal(mesh.recipe_sha256, certificate.model_sha256);
  const geometries = uniqueGeometries(model);
  const materials = [...new Set(model.parts.flatMap(part => Array.isArray(part.material) ? part.material : [part.material]))];
  const fingerprints = geometries.map(geometryFingerprint);
  assert.equal(certificate.counts.parts, model.parts.length);
  assert.equal(certificate.counts.geometry_objects, geometries.length);
  assert.equal(certificate.counts.exact_typed_position_index_groups, new Set(fingerprints).size);
  assert.equal(certificate.counts.actual_stored_mesh_vertices, actualPoints(model).length);
  assert.equal(certificate.counts.separate_box_corners, 8);
  assert.equal(certificate.geometryIdentity.geometry_objects, geometries.length);
  assert.equal(certificate.geometryIdentity.exact_typed_position_index_groups, new Set(fingerprints).size);
  assert.deepEqual(certificate.geometryIdentity.exactTypedPositionIndexSHA256, fingerprints);
  assert.deepEqual(certificate.geometryIdentity.partGeometryIDs, model.parts.map(part => geometries.indexOf(part.geometry)));
  assert.equal(mesh.geometries.length, geometries.length);
  assert.equal(mesh.materials.length, materials.length);
  assert.equal(mesh.parts.length, model.parts.length);
  for (let i = 0; i < geometries.length; i++) {
    const geometry = geometries[i], row = mesh.geometries[i];
    assert.equal(row.id, i); assert.equal(row.exactTypedPositionIndexSHA256, fingerprints[i]);
    assert.deepEqual(Object.keys(row.attributes).sort(), Object.keys(geometry.attributes).sort());
    const reconstructed = new T.BufferGeometry();
    try {
      for (const [name, attr] of Object.entries(geometry.attributes)) {
        const saved = row.attributes[name];
        assert.equal(saved.arrayType, attr.array.constructor.name);
        assert.equal(saved.itemSize, attr.itemSize);
        assert.equal(saved.count, attr.count);
        assert.equal(saved.normalized, attr.normalized);
        // Rebuild from the actual parsed saved JSON, then compare every stored
        // bit. Numeric JSON equality alone would silently accept -0 -> +0.
        const array = new attr.array.constructor(saved.array);
        assert.deepEqual(Buffer.from(array.buffer, array.byteOffset, array.byteLength),
          Buffer.from(attr.array.buffer, attr.array.byteOffset, attr.array.byteLength), `${i}:${name} typed round-trip`);
        reconstructed.setAttribute(name, new T.BufferAttribute(array, saved.itemSize, saved.normalized));
      }
      assert.equal(row.index.arrayType, geometry.index.array.constructor.name);
      assert.equal(row.index.itemSize, geometry.index.itemSize);
      assert.equal(row.index.count, geometry.index.count);
      const array = new geometry.index.array.constructor(row.index.array);
      assert.deepEqual(Buffer.from(array.buffer, array.byteOffset, array.byteLength),
        Buffer.from(geometry.index.array.buffer, geometry.index.array.byteOffset, geometry.index.array.byteLength), `${i}:index typed round-trip`);
      reconstructed.setIndex(new T.BufferAttribute(array, row.index.itemSize));
      assert.equal(geometryFingerprint(reconstructed), row.exactTypedPositionIndexSHA256);
      assert.equal(geometryFingerprint(reconstructed), geometryFingerprint(geometry));
    } finally { reconstructed.dispose(); }
    assert.deepEqual(row.groups, geometry.groups);
  }
  // The previous JSON.stringify array writer loses genuine stored negative
  // zero. Challenge every affected attribute and require the bit oracle to fail;
  // position loss must also invalidate the declared position/index fingerprint.
  let lossyAttributes = 0, lossyPositionFingerprints = 0;
  for (const geometry of geometries) {
    for (const [name, attr] of Object.entries(geometry.attributes)) {
      if (!Array.from(attr.array).some(value => Object.is(value, -0))) continue;
      const lossy = new attr.array.constructor(JSON.parse(JSON.stringify(Array.from(attr.array))));
      assert.notDeepEqual(Buffer.from(lossy.buffer, lossy.byteOffset, lossy.byteLength),
        Buffer.from(attr.array.buffer, attr.array.byteOffset, attr.array.byteLength), `${name}: -0 loss control`);
      lossyAttributes++;
      if (name === 'position') {
        const control = geometry.clone();
        try {
          control.setAttribute('position', new T.BufferAttribute(lossy, attr.itemSize, attr.normalized));
          assert.notEqual(geometryFingerprint(control), geometryFingerprint(geometry));
          lossyPositionFingerprints++;
        } finally { control.dispose(); }
      }
    }
  }
  assert(lossyAttributes > 0, 'negative control uses actual stored negative-zero attributes');
  assert(lossyPositionFingerprints > 0, 'actual position negative zero affects raw fingerprints');
  for (let i = 0; i < materials.length; i++) {
    const material = materials[i], row = mesh.materials[i];
    assert.equal(row.color, material.color.getHexString());
    for (const name of ['roughness', 'metalness', 'side', 'transparent', 'opacity', 'flatShading', 'vertexColors', 'depthWrite', 'depthTest'])
      assert.equal(row[name], material[name]);
  }
  for (let i = 0; i < model.parts.length; i++) {
    const part = model.parts[i], row = mesh.parts[i];
    assert.equal(row.name, part.name);
    assert.equal(row.geometry, geometries.indexOf(part.geometry));
    assert.deepEqual(row.material, Array.isArray(part.material) ? part.material.map(material => materials.indexOf(material)) : materials.indexOf(part.material));
    assert.deepEqual(row.matrixWorld, JSON.parse(JSON.stringify(part.matrixWorld.toArray())));
    assert.deepEqual(row.position, JSON.parse(JSON.stringify(part.position.toArray())));
    assert.deepEqual(row.quaternion, JSON.parse(JSON.stringify(part.quaternion.toArray())));
    assert.deepEqual(row.scale, JSON.parse(JSON.stringify(part.scale.toArray())));
    if (Array.isArray(part.material)) {
      assert(part.geometry.groups.some(group => group.materialIndex === 1), 'actual cream lining group retained');
      for (const group of part.geometry.groups) assert(group.materialIndex < row.material.length);
    }
  }
});

test('owned resources dispose once while body, wearing, fastener physics and ordinary game credits remain unclaimed', () => {
  const second = build(T), resources = new Set([...second.resources.geometries, ...second.resources.materials]);
  const counts = new Map([...resources].map(resource => [resource, 0]));
  for (const resource of resources) resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1));
  second.dispose(); second.dispose();
  assert([...counts.values()].every(count => count === 1));
  assert.equal(spec.bodyBinding, null); assert.equal(model.inspect().bodyBinding, null);
  for (const name of ['bodyMeasurements', 'wearingFit', 'rig', 'clothPhysics', 'fastenerAction', 'normalGame', 'ownershipSave', 'newRaw', 'newDesign', 'newVillageLibraryCandidate'])
    assert.equal(spec[name], false, name);
  assert.equal(model.animate, undefined);
  const input = JSON.parse(read('input-manifest.json'));
  for (const name of ['new_original_designs', 'new_raw_versions', 'new_body', 'new_fit', 'new_library_candidate']) assert.equal(input[name], 0, name);
  assert.equal(input.canonical_v1_input_and_hold_history_retained, true);
  const viewer = read('viewer.mjs').toString();
  assert(!/localStorage|sessionStorage|indexedDB/.test(viewer));
  assert(viewer.includes("toDataURL('image/png')"));
  assert(!viewer.includes("$('download').click"));
});

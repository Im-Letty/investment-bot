import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as T from '../static/vendor/three-0.160.1.module.js';
import Env from '../static/pet-town-environment.js';
import Seasons from '../static/pet-japan-seasons.js';
import Scene from '../static/pet-town-scene.js';
import Town from '../static/pet-town-walk.js';

function textureDocument() {
  const canvases = [];
  return {canvases, createElement() {
    const canvas = {width: 0, height: 0, pixels: null, colors: []};
    const gradient = () => ({stops: [], addColorStop(at, color) { this.stops.push([at, color]); }});
    const context = {
      fillStyle: '', lineWidth: 1,
      createImageData: (width, height) => ({width, height, data: new Uint8ClampedArray(width * height * 4)}),
      putImageData(image) { canvas.pixels = new Uint8ClampedArray(image.data); },
      getImageData(_x, _y, width, height) { return {data: canvas.pixels ? new Uint8ClampedArray(canvas.pixels) : new Uint8ClampedArray(width * height * 4)}; },
      createLinearGradient: gradient, createRadialGradient: gradient,
      fillRect() { canvas.colors.push(this.fillStyle); }, clearRect() {}, drawImage() {},
      beginPath() {}, ellipse() {}, moveTo() {}, lineTo() {}, fill() {}, stroke() {}, fillText() {}
    };
    canvas.getContext = type => type === '2d' ? context : null;
    canvases.push(canvas); return canvas;
  }};
}

function shapeHash(geometry) {
  const hash = createHash('sha256');
  for (const [name, attribute] of Object.entries(geometry.attributes).filter(([name]) => name !== 'color').sort()) {
    const array = attribute.array || attribute.data?.array;
    assert.ok(array, 'actual geometry attribute buffer');
    hash.update(name); hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  }
  if (geometry.index) {
    const array = geometry.index.array;
    hash.update('index'); hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  }
  return hash.digest('hex');
}

function brightStarSizes(pixels, width, height) {
  const rows = Math.floor(height * .60), seen = new Uint8Array(width * rows), sizes = [];
  const bright = index => {
    const at = index * 4;
    return .2126 * pixels[at] + .7152 * pixels[at + 1] + .0722 * pixels[at + 2] > 170;
  };
  for (let index = 0; index < seen.length; index++) {
    if (seen[index] || !bright(index)) continue;
    const pending = [index]; seen[index] = 1; let count = 0;
    while (pending.length) {
      const current = pending.pop(), x = current % width, y = Math.floor(current / width); count++;
      for (const next of [y * width + (x + width - 1) % width, y * width + (x + 1) % width,
        y > 0 ? current - width : -1, y + 1 < rows ? current + width : -1]) {
        if (next >= 0 && !seen[next] && bright(next)) { seen[next] = 1; pending.push(next); }
      }
    }
    sizes.push(count);
  }
  return sizes;
}

test('clear-night phase uses explicit JST06/18 boundaries, valid finite dates and frozen results', () => {
  const cases = [
    ['2026-11-01T20:59:59.999Z', 'clear-night', '2026-11-02', '2026-11-01T21:00:00.000Z'],
    ['2026-11-01T21:00:00.000Z', 'day', '2026-11-02', '2026-11-02T09:00:00.000Z'],
    ['2026-11-02T08:59:59.999Z', 'day', '2026-11-02', '2026-11-02T09:00:00.000Z'],
    ['2026-11-02T09:00:00.000Z', 'clear-night', '2026-11-02', '2026-11-02T21:00:00.000Z'],
    ['2026-12-31T15:00:00.000Z', 'clear-night', '2027-01-01', '2026-12-31T21:00:00.000Z']
  ];
  for (const [at, phase, dateJst, next] of cases) {
    const state = Env.skyPhase(Date.parse(at));
    assert.deepEqual(state, {phase, dateJst, nextChangeAt: Date.parse(next)});
    assert.ok(Object.isFrozen(state)); assert.ok(state.nextChangeAt > Date.parse(at));
    assert.throws(() => { state.phase = 'other'; }, TypeError);
  }
  for (const value of [NaN, Infinity, -Infinity, 8640000000000001, '0', null, undefined, {}, new Date(0)]) {
    assert.equal(Env.skyPhase(value), null);
  }
  assert.equal(Env.skyPhase(-1).phase, 'day', 'valid pre-epoch instants are not silently treated as missing');
});

test('sky watcher notifies same-day dawn and dusk, bounds its poll and releases disabled/subscribed work', () => {
  let now = Date.parse('2026-11-01T20:59:59.000Z'), enabled = true, sequence = 0, subscribe, unsubscribeCount = 0;
  const timers = new Map(), observed = [];
  const watcher = Env.watchSky({now: () => now, enabled: () => enabled,
    setTimeout(fn, delay) { assert.ok(delay >= 1 && delay <= 60000); const id = ++sequence; timers.set(id, {fn, delay}); return id; },
    clearTimeout(id) { timers.delete(id); },
    subscribe(fn) { subscribe = fn; return () => { unsubscribeCount++; }; },
    onChange(state) { assert.ok(Object.isFrozen(state)); observed.push(state); }
  });
  const runNext = () => { assert.equal(timers.size, 1); const [id, timer] = [...timers][0]; timers.delete(id); now += timer.delay; timer.fn(); };
  try {
    assert.deepEqual(observed.map(state => state.phase), ['clear-night']);
    assert.equal([...timers.values()][0].delay, 1000); runNext();
    assert.deepEqual(observed.map(state => state.phase), ['clear-night', 'day']);
    watcher.check(); assert.equal(observed.length, 2); assert.equal(timers.size, 1);
    now = Date.parse('2026-11-02T08:59:59.000Z'); watcher.check();
    assert.equal(observed.length, 2); assert.equal([...timers.values()][0].delay, 1000); runNext();
    assert.deepEqual(observed.map(state => state.phase), ['clear-night', 'day', 'clear-night']);
    assert.ok(observed.every(state => state.dateJst === '2026-11-02'));
    enabled = false; now = Date.parse('2026-11-02T21:00:00.000Z'); watcher.check();
    assert.equal(observed.length, 3); assert.equal(timers.size, 1);
    enabled = true; assert.equal(typeof subscribe, 'function'); subscribe();
    assert.equal(observed.at(-1).phase, 'day'); assert.equal(observed.length, 4);
    const staleTimer = [...timers.values()][0].fn;
    watcher.destroy(); watcher.destroy(); assert.equal(timers.size, 0); assert.equal(unsubscribeCount, 1);
    staleTimer(); subscribe(); watcher.check(); assert.equal(observed.length, 4); assert.equal(timers.size, 0);
  } finally { watcher.destroy(); }
});

test('omitted sky phase retains exact explicit-day pixels and unknown phases fail before allocation', () => {
  const doc = textureDocument(), profile = Seasons.profile('autumn'), saved = JSON.stringify(profile), textures = [];
  try {
    const implicit = Env.skyTexture(T, doc, profile), explicit = Env.skyTexture(T, doc, profile, 'day'); textures.push(implicit, explicit);
    assert.deepEqual(implicit.image.pixels, explicit.image.pixels);
    assert.equal(implicit.image.width, 512); assert.equal(implicit.image.height, 256);
    const allocated = doc.canvases.length;
    for (const phase of ['night', 'rainy', '', null, {}]) assert.throws(() => Env.skyTexture(T, doc, profile, phase), {name: 'TypeError', message: 'sky_phase_invalid'});
    assert.equal(doc.canvases.length, allocated); assert.equal(JSON.stringify(profile), saved);
  } finally { for (const texture of textures) texture.dispose(); }
});

test('clear-night sky is deterministic opaque blue with varied bright star cores, exact seams and bounded memory', () => {
  const profile = Seasons.profile('autumn'), saved = JSON.stringify(profile), textures = [];
  try {
    const a = Env.skyTexture(T, textureDocument(), profile, 'clear-night'), b = Env.skyTexture(T, textureDocument(), profile, 'clear-night');
    const day = Env.skyTexture(T, textureDocument(), profile, 'day'); textures.push(a, b, day);
    const {width, height, pixels} = a.image;
    assert.ok(width > 0 && width <= 2048 && height > 0 && height <= 1024);
    assert.equal(width, height * 2); assert.equal(pixels.length, width * height * 4);
    assert.ok(pixels.byteLength <= 2048 * 1024 * 4); assert.deepEqual(pixels, b.image.pixels);
    assert.equal(a.colorSpace, T.SRGBColorSpace); assert.equal(a.mapping, T.EquirectangularReflectionMapping);
    assert.equal(a.wrapS, T.RepeatWrapping); assert.equal(a.wrapT, T.ClampToEdgeWrapping);
    let nightLuma = 0, blue = 0, dayLuma = 0;
    for (let at = 0; at < pixels.length; at += 4) {
      assert.equal(pixels[at + 3], 255); nightLuma += .2126 * pixels[at] + .7152 * pixels[at + 1] + .0722 * pixels[at + 2];
      if (pixels[at + 2] > pixels[at] && pixels[at + 2] >= pixels[at + 1]) blue++;
    }
    for (let at = 0; at < day.image.pixels.length; at += 4) dayLuma += .2126 * day.image.pixels[at] + .7152 * day.image.pixels[at + 1] + .0722 * day.image.pixels[at + 2];
    assert.ok(blue > width * height * .60, 'night is principally blue, not a white screen wash');
    assert.ok(nightLuma / (width * height) < dayLuma / (day.image.width * day.image.height) * .65);
    for (let y = 0; y < height; y++) for (let channel = 0; channel < 4; channel++) {
      assert.equal(pixels[y * width * 4 + channel], pixels[(y * width + width - 1) * 4 + channel], 'exact panorama seam');
    }
    const stars = brightStarSizes(pixels, width, height);
    assert.ok(stars.length >= 30, 'many separated bright star cores are present in the sky');
    assert.ok(new Set(stars).size >= 2, 'the finite star field has more than one bright-core size');
    assert.equal(JSON.stringify(profile), saved);
  } finally { for (const texture of textures) texture.dispose(); }
});

test('world sky phase swaps one registered texture, rejects unknown modes and disposes each replaced sky once', () => {
  const fallback = Scene.buildWorld(T, Town.createWorld(), {}, null, null, 'autumn');
  try { assert.equal(fallback.setSkyPhase('clear-night'), true); assert.equal(fallback.scene.background.getHexString(), '001127'); }
  finally { fallback.dispose(); }
  const doc = textureDocument(), world = Town.createWorld(), model = Scene.buildWorld(T, world, {}, null, doc, 'autumn');
  const baseline = JSON.stringify(world), day = model.scene.background, count = model.textures.size;
  let dayDisposals = 0, nightDisposals = 0, lastDisposals = 0;
  day.addEventListener('dispose', () => dayDisposals++);
  try {
    assert.equal(model.setSkyPhase('clear-night'), true);
    const night = model.scene.background; night.addEventListener('dispose', () => nightDisposals++);
    assert.notEqual(night, day); assert.equal(dayDisposals, 1);
    assert.equal(model.textures.has(day), false); assert.equal(model.textures.has(night), true); assert.equal(model.textures.size, count);
    const allocated = doc.canvases.length;
    assert.equal(typeof model.setSkyPhase('clear-night'), 'boolean');
    for (const phase of ['night', 'rainy', null, {}]) assert.equal(model.setSkyPhase(phase), false);
    assert.equal(model.scene.background, night); assert.equal(doc.canvases.length, allocated); assert.equal(nightDisposals, 0);
    assert.equal(model.setSkyPhase('day'), true); const last = model.scene.background;
    last.addEventListener('dispose', () => lastDisposals++);
    assert.equal(nightDisposals, 1); assert.equal(model.textures.has(night), false); assert.equal(model.textures.size, count);
    assert.equal(JSON.stringify(world), baseline);
    model.dispose(); model.dispose(); assert.equal(dayDisposals, 1); assert.equal(nightDisposals, 1); assert.equal(lastDisposals, 1);
  } finally { model.dispose(); }
});

test('season changes retain clear-night while sky-only changes preserve actual shape buffers, lights and walk world', () => {
  const doc = textureDocument(), world = Town.createWorld(), model = Scene.buildWorld(T, world, {}, null, doc, 'autumn');
  const textures = [];
  try {
    model.scene.updateMatrixWorld(true);
    const geometry = [...model.geometries], shapes = new Map(geometry.map(value => [value, shapeHash(value)]));
    const lights = model.scene.children.filter(value => value.isLight), lighting = JSON.stringify(lights.map(value => value.toJSON()));
    const colors = new Map([...model.materials].filter(value => value.color).map(value => [value, value.color.getHex()]));
    const baseline = JSON.stringify(world);
    assert.equal(model.setSkyPhase('clear-night'), true);
    for (const [material, color] of colors) assert.equal(material.color.getHex(), color, 'sky mode does not recolor world materials');
    assert.equal(model.setSeason('winter'), true);
    const expected = Env.skyTexture(T, textureDocument(), Seasons.profile('winter'), 'clear-night'); textures.push(expected);
    assert.deepEqual(model.scene.background.image.pixels, expected.image.pixels, 'winter keeps the active night sky rather than resetting to day');
    const allocated = doc.canvases.length, current = model.scene.background;
    model.setSkyPhase('clear-night'); assert.equal(doc.canvases.length, allocated); assert.equal(model.scene.background, current);
    assert.deepEqual([...model.geometries], geometry);
    for (const [value, hash] of shapes) assert.equal(shapeHash(value), hash, 'position/normal/UV/index buffers remain exact');
    assert.deepEqual(model.scene.children.filter(value => value.isLight), lights);
    assert.equal(JSON.stringify(lights.map(value => value.toJSON())), lighting);
    assert.equal(model.scene.fog, null); assert.equal(JSON.stringify(world), baseline);
  } finally { for (const texture of textures) texture.dispose(); model.dispose(); }
});

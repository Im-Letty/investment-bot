import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// A caller may supply an immutable pre-revision tree to demonstrate that these
// regressions fail before the change; ordinary runs exercise this checkout.
const productRoot = process.env.PET_MARKET_PHOTO_TEST_SOURCE ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = async name => (await import(pathToFileURL(path.join(productRoot, 'static', name)).href)).default;
const THREE = await import(pathToFileURL(path.join(productRoot, 'static/vendor/three-0.160.1.module.js')).href);
const [Style, Scene, Town, Seasons] = await Promise.all([
  load('pet-town-style.js'), load('pet-town-scene.js'),
  load('pet-town-walk.js'), load('pet-japan-seasons.js')
]);

function meshes(root, name) {
  const found = [];
  root.traverse(o => { if (o.name === name) found.push(o); });
  return found;
}
function colorOf(material) { return Array.isArray(material) ? material[0].color : material.color; }
function green(c) { return c.g > c.r && c.g > c.b; }
function closedVolume(g, unitUV = true) {
  const p = g.attributes.position, index = g.index, edges = new Map(), used = new Set();
  assert.ok(p && g.attributes.normal && g.attributes.uv, 'solid geometry carries position/normal/UV');
  const vertex = i => [p.getX(i), p.getY(i), p.getZ(i)].map(n => Math.round(n * 1e5)).join(',');
  const count = index ? index.count : p.count;
  let volume6 = 0;
  for (let t = 0; t < count; t += 3) {
    const ids = [0, 1, 2].map(n => index ? index.getX(t + n) : t + n);
    const keys = ids.map(vertex);
    if (new Set(keys).size !== 3) continue;
    ids.forEach(i => used.add(i));
    const a = new THREE.Vector3().fromBufferAttribute(p, ids[0]);
    const b = new THREE.Vector3().fromBufferAttribute(p, ids[1]);
    const c = new THREE.Vector3().fromBufferAttribute(p, ids[2]);
    volume6 += a.dot(b.cross(c));
    for (let n = 0; n < 3; n++) {
      const key = [keys[n], keys[(n + 1) % 3]].sort().join('/');
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  assert.ok(edges.size > 0);
  assert.ok([...edges.values()].every(n => n === 2), 'each welded edge of the nondegenerate surface has two faces');
  assert.ok(Math.abs(volume6) > 1e-6, 'closed topology encloses nonzero material volume');
  for (const key of ['position', 'normal', 'uv']) {
    for (const n of g.attributes[key].array) assert.ok(Number.isFinite(n), key + ' finite');
  }
  for (const i of used) {
    const n = g.attributes.normal;
    assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-3, 'rendered normals have unit length');
  }
  if (unitUV) for (const n of g.attributes.uv.array) assert.ok(n >= -1e-6 && n <= 1 + 1e-6, 'normalized geometry UV bounded');
}
function freshModel(season = 'autumn') {
  const world = Town.createWorld(), original = JSON.stringify(world);
  return { world, original, model: Scene.buildWorld(THREE, world, {}, null, null, season) };
}

test('new ceramic bowl is a closed thick volume with a real hollow, rather than a flat water disc', () => {
  assert.equal(typeof Style.bowlGeometry, 'function', 'the reference-shaped basin needs its own solid geometry');
  const g = Style.bowlGeometry(THREE), material = new THREE.MeshBasicMaterial(), object = new THREE.Mesh(g, material);
  try {
    closedVolume(g);
    g.computeBoundingBox();
    assert.ok(Math.abs(g.boundingBox.min.y) < 1e-6);
    assert.ok(Math.abs(g.boundingBox.max.y - 1) < 1e-6);
    const p = g.attributes.position;
    let radius = 0;
    for (let i = 0; i < p.count; i++) radius = Math.max(radius, Math.hypot(p.getX(i), p.getZ(i)));
    assert.ok(Math.abs(radius - 1) < 1e-5);
    object.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const top = r => {
      ray.set(new THREE.Vector3(r, 2, 0), new THREE.Vector3(0, -1, 0));
      return ray.intersectObject(object, false)[0]?.point.y;
    };
    const center = top(0), rim = Math.max(...[.7, .8, .9].map(top).filter(Number.isFinite));
    assert.ok(Number.isFinite(center) && Number.isFinite(rim), 'the open cavity floor and rim are both visible from above');
    assert.ok(center >= .25 && center < .7, 'the bottom is substantial ceramic, not an unclosed hole');
    assert.ok(rim > center + .2, 'the visible bowl cavity has meaningful depth');
    ray.set(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0));
    assert.ok(Math.abs(ray.intersectObject(object, false)[0]?.point.y) < 1e-5, 'underside is closed and faces outward');
  } finally { g.dispose(); material.dispose(); }
});

test('botanical leaf is an actual thin tapered ovate volume, not the former broad thick paddle', () => {
  const g = Style.leafGeometry(THREE);
  try {
    closedVolume(g); g.computeBoundingBox();
    const box = g.boundingBox, size = box.getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.y - 2) < 1e-6);
    assert.ok(size.x < 1.15, 'small-leaf reference keeps the normalized blade narrow');
    assert.ok(size.z < .2, 'closed leaf thickness stays below the broad former slab');
    const p = g.attributes.position;
    let tipWidth = 0, bodyWidth = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > .8) tipWidth = Math.max(tipWidth, Math.abs(p.getX(i)));
      if (Math.abs(p.getY(i)) < .5) bodyWidth = Math.max(bodyWidth, Math.abs(p.getX(i)));
    }
    assert.ok(tipWidth < bodyWidth, 'blade tapers toward the tip');
  } finally { g.dispose(); }
});

test('fountain has two nested real basins and eight closed continuous falls inside the saved collision footprint', () => {
  const { world, original, model } = freshModel();
  try {
    const fountain = model.scene.getObjectByName('market-photo-fountain');
    assert.ok(fountain, 'the old pillar/disc fountain must be replaced by the reference-shaped group');
    const lower = fountain.getObjectByName('fountain-lower-bowl'), upper = fountain.getObjectByName('fountain-upper-bowl');
    assert.ok(lower?.isMesh && upper?.isMesh);
    assert.equal(lower.geometry, upper.geometry, 'normalized ceramic shape is shared instead of duplicating allocations');
    const falls = meshes(fountain, 'fountain-cascade');
    assert.equal(falls.length, 8);
    const foot = fountain.getObjectByName('fountain-foot');
    const lowerWater = fountain.getObjectByName('fountain-lower-water'), upperWater = fountain.getObjectByName('fountain-upper-water');
    assert.ok(foot?.isMesh && lowerWater?.isMesh && upperWater?.isMesh);
    const basinGeometry = new Set([lower.geometry, upper.geometry, foot.geometry, lowerWater.geometry, upperWater.geometry, ...falls.map(m => m.geometry)]);
    for (const g of basinGeometry) closedVolume(g);
    const lowBox = new THREE.Box3().setFromObject(lower), highBox = new THREE.Box3().setFromObject(upper);
    assert.ok(lowBox.min.y > 0 && highBox.min.y > lowBox.max.y, 'both basins sit above ground at separate readable heights');
    assert.ok(highBox.getSize(new THREE.Vector3()).x < lowBox.getSize(new THREE.Vector3()).x);
    const site = world.places.find(p => p.id === 'playground'), footprint = site.footprint;
    const center = Scene.groundPoint(world, footprint);
    for (const object of [lower, upper, foot, lowerWater, upperWater, ...falls]) {
      const position = object.geometry.attributes.position;
      for (let i = 0; i < position.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
        const ellipse = ((v.x - center.x) / (footprint.rx / 100)) ** 2 + ((v.z - center.z) / (footprint.ry / 100)) ** 2;
        assert.ok(ellipse <= 1 + 1e-5, 'new bowl/water volume stays inside the existing collision ellipse');
        assert.ok(v.y >= 0, 'no component clips below ground');
      }
    }
    // Cylinder helpers already apply radius to X and Z. A later ellipse
    // adjustment must multiply that radius, never replace one scale component.
    const footBox = new THREE.Box3().setFromObject(foot);
    assert.ok(footBox.max.y >= lowBox.min.y - 1e-5 && footBox.min.y < lowBox.min.y, 'the base actually supports the lower bowl');
    const ray = new THREE.Raycaster();
    for (const [water, bowl] of [[lowerWater, lower], [upperWater, upper]]) {
      const waterBox = new THREE.Box3().setFromObject(water), bowlBox = new THREE.Box3().setFromObject(bowl);
      assert.ok(waterBox.min.x > bowlBox.min.x && waterBox.max.x < bowlBox.max.x, 'water X extent stays inside its own bowl');
      assert.ok(waterBox.min.z > bowlBox.min.z && waterBox.max.z < bowlBox.max.z, 'water Z extent stays inside its own bowl');
      const p = water.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const at = new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(water.matrixWorld);
        ray.set(new THREE.Vector3(at.x, bowlBox.max.y + 1, at.z), new THREE.Vector3(0, -1, 0));
        const floor = ray.intersectObject(bowl, false)[0];
        assert.ok(floor && floor.point.y <= waterBox.max.y + 1e-5, 'the rendered water surface lies over the actual hollow floor, not outside or inside the ceramic wall');
      }
    }
    const rims = meshes(fountain, 'lilac-glazed-fountain-rim').sort((a, b) =>
      a.getWorldPosition(new THREE.Vector3()).y - b.getWorldPosition(new THREE.Vector3()).y);
    assert.equal(rims.length, 2);
    for (const [rim, bowl] of [[rims[0], lower], [rims[1], upper]]) {
      const rimBox = new THREE.Box3().setFromObject(rim), bowlBox = new THREE.Box3().setFromObject(bowl);
      assert.ok(rimBox.min.y <= bowlBox.max.y && rimBox.max.y >= bowlBox.max.y, 'glazed rim meets the bowl top instead of floating above it');
    }
    for (const fall of falls) {
      assert.ok(fall.isMesh && fall.material.transparent && fall.material.opacity > 0 && fall.material.opacity < 1);
      assert.ok(new THREE.Box3().setFromObject(fall).getSize(new THREE.Vector3()).y > .3, 'fall connects the two levels, not isolated droplets');
    }
    assert.equal(JSON.stringify(world), original);
  } finally { model.dispose(); }
});

test('three cottages use solid arched dormers and lavender ceramic while seasonal changes leave facade materials alone', () => {
  const { model } = freshModel();
  try {
    const dormers = meshes(model.scene, 'market-photo-dormer');
    assert.equal(dormers.length, 3);
    const owners = dormers.map(o => {
      for (let p = o.parent; p; p = p.parent) if (p.userData.placeId) return p.userData.placeId;
    }).sort();
    assert.deepEqual(owners, ['cafe', 'home', 'shop']);
    const facade = new Set();
    for (const dormer of dormers) {
      const frame = dormer.getObjectByName('dormer-arched-frame');
      assert.ok(frame?.isMesh); closedVolume(frame.geometry, false); // Extruded joinery legitimately repeats its finite UVs.
      dormer.traverse(o => {
        if (o.isMesh) for (const m of [].concat(o.material)) facade.add(m);
      });
    }
    const home = model.placeGroups.find(g => g.userData.placeId === 'home');
    const roof = meshes(home, 'overlapping-round-roof-tile');
    assert.ok(roof.length > 0);
    assert.ok(roof.some(m => { const c = colorOf(m.material); return c.b > c.r && c.r > c.g; }), 'lavender roof is distinct from the former rose/taupe palette');
    const colors = [...facade].map(m => m.color.getHexString());
    assert.ok([...facade].some(m => m.userData.surfaceRole === 'wood' && m.color.r > m.color.g && m.color.g > m.color.b));
    for (const key of ['spring', 'summer', 'winter', 'autumn']) {
      model.setSeason(key);
      assert.deepEqual([...facade].map(m => m.color.getHexString()), colors, 'seasonal leaf tint cannot recolor cream plaster, wood or glazed dormer');
    }
  } finally { model.dispose(); }
});

test('autumn retains a green living canopy with limited warm accent leaves and winter keeps a separate snow decoration', () => {
  const { world, original, model } = freshModel();
  try {
    const trees = meshes(model.scene, 'market-style-branching-tree'), leaves = meshes(model.scene, 'small-pointed-tree-leaf');
    assert.equal(trees.length, 27); assert.equal(leaves.length, 27 * 126);
    for (const tree of trees) {
      assert.equal(tree.userData.leafCount, 126); assert.equal(tree.userData.twigCount, 9);
      const ownLeaves = meshes(tree, 'small-pointed-tree-leaf');
      assert.ok(ownLeaves.filter(m => green(colorOf(m.material))).length / ownLeaves.length > .65, 'autumn must not turn the whole canopy taupe');
      const accent = ownLeaves.filter(m => m.material.userData.seasonRole === 'accent');
      assert.ok(accent.length > 0 && accent.length < ownLeaves.length * .15, 'warm autumn accents are explicit and limited');
      assert.ok(accent.some(m => { const c = colorOf(m.material); return c.r > c.g && c.g > c.b; }));
    }
    assert.ok(green(new THREE.Color(Seasons.profile('autumn').ground)), 'the living lawn remains green beneath autumn accents');
    assert.equal(model.seasonGroups.autumn.visible, true);
    const autumnGround = Seasons.profile('autumn').ground;
    model.setSeason('winter');
    assert.equal(model.seasonGroups.winter.visible, true); assert.equal(model.seasonGroups.autumn.visible, false);
    assert.notEqual(Seasons.profile('winter').ground, autumnGround);
    let winterSolids = 0; model.seasonGroups.winter.traverse(o => { if (o.isMesh) winterSolids++; });
    assert.ok(winterSolids > 0, 'calendar winter has actual bounded snow geometry');
    assert.equal(JSON.stringify(world), original);
  } finally { model.dispose(); }
});

test('the same saved world and walkable surfaces survive all four seasonal appearances and new geometry disposes once', () => {
  const { world, original, model } = freshModel(), disposed = new Map();
  const samples = [{ x: 633.6, y: 611.6 }, { x: 2377, y: 1500 }, { x: 2750, y: 1550 }, { x: 2770, y: 1160 }];
  const walkable = samples.map(p => Town.isWalkable(world, p.x, p.y));
  const surfaces = model.surfaces.map(m => ({ mesh: m, positions: Array.from(m.geometry.attributes.position.array), matrix: m.matrixWorld.toArray() }));
  for (const g of model.geometries) { disposed.set(g, 0); g.addEventListener('dispose', () => disposed.set(g, disposed.get(g) + 1)); }
  try {
    for (const key of ['winter', 'spring', 'summer', 'autumn']) {
      model.setSeason(key);
      assert.equal(JSON.stringify(world), original);
      assert.deepEqual(samples.map(p => Town.isWalkable(world, p.x, p.y)), walkable);
      for (const s of surfaces) {
        assert.deepEqual(Array.from(s.mesh.geometry.attributes.position.array), s.positions);
        assert.deepEqual(s.mesh.matrixWorld.toArray(), s.matrix);
      }
    }
  } finally { model.dispose(); model.dispose(); }
  assert.ok([...disposed.values()].every(n => n === 1), 'all old/new/batched geometry allocations release exactly once');
});

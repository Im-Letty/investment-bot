/* A view of the existing Town world. No game actions, storage or economy clock. */
(function (root, factory) {
  'use strict';
  var api = factory(typeof module === 'object' && module.exports ? require('./pet-town-walk.js') : root.PetTownWalk,
    typeof module === 'object' && module.exports ? require('./pet-frame-fit.js') : root.PetFrameFit,
    typeof module === 'object' && module.exports ? require('./pet-river-fishing.js') : root.PetRiverFishing,
    typeof module === 'object' && module.exports ? require('./pet-japan-seasons.js') : root.PetJapanSeasons,
    typeof module === 'object' && module.exports ? require('./pet-town-style.js') : root.PetTownStyle);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetTownScene = api;
}(typeof window !== 'undefined' ? window : globalThis, function (Town, FrameFit, Fishing, Seasons, Style) {
  'use strict';
  var threeLoading = null, frameFitLoading = null, seasonsLoading = null, styleLoading = null, UNIT = 100, TAU = Math.PI * 2;
  var shoreline = [[0, 2880], [550, 2840], [1050, 2720], [1450, 2510], [1920, 1990]];
  function finite(n) { return typeof n === 'number' && Number.isFinite(n); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function groundPoint(world, p) { return { x: (p.x - world.width / 2) / UNIT, z: (p.y - world.height / 2) / UNIT }; }
  function townPoint(world, p) { return { x: p.x * UNIT + world.width / 2, y: p.z * UNIT + world.height / 2 }; }
  function cameraState(value) {
    value = value || {};
    return { yaw: finite(value.yaw) ? ((value.yaw + Math.PI) % TAU + TAU) % TAU - Math.PI : .18,
      pitch: clamp(finite(value.pitch) ? value.pitch : Math.PI / 6, 22 * Math.PI / 180, 56 * Math.PI / 180),
      distance: clamp(finite(value.distance) ? value.distance : 8, 5, 10) };
  }
  function cameraDirection(x, y, yaw) { return { x: Math.cos(yaw) * x + Math.sin(yaw) * y, y: -Math.sin(yaw) * x + Math.cos(yaw) * y }; }
  function facingFrame(heading, cameraYaw, walking, distance) {
    heading = finite(heading) ? heading : 0; cameraYaw = finite(cameraYaw) ? cameraYaw : 0;
    var yaw = ((heading - cameraYaw) * 180 / Math.PI % 360 + 360) % 360;
    return { yawDeg: yaw, walking: !!walking, distance: finite(distance) ? distance : 0 };
  }
  function cameraDistance(distance, hit) { return finite(hit) ? Math.min(distance, Math.max(.001, hit - .12)) : distance; }
  function safeCamera(THREE, targets, center, requested) {
    var state = cameraState(requested), ray = new THREE.Raycaster(), direction = new THREE.Vector3(), minimum = Math.min(5.5, state.distance);
    var offsets = [0, .45, -.45, .9, -.9, 1.4, -1.4, 2, -2, Math.PI], pitches = [state.pitch, Math.min(56 * Math.PI / 180, state.pitch + .2), 56 * Math.PI / 180], best = null;
    for (var o = 0; o < offsets.length; o++) for (var p = 0; p < pitches.length; p++) {
      var yaw = state.yaw + offsets[o], pitch = pitches[p]; direction.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      ray.set(center, direction); ray.near = .01; ray.far = state.distance + .12;
      var hits = ray.intersectObjects(targets, false), distance = cameraDistance(state.distance, hits.length ? hits[0].distance : null);
      if (distance < minimum) continue;
      var score = Math.abs(offsets[o]) + Math.abs(pitch - state.pitch) * .6 + (state.distance - distance) * .4;
      if (!best || score < best.score) best = { yaw: yaw, pitch: pitch, distance: distance, score: score };
      if (score === 0) return best;
    }
    return best;
  }
  function heightAt(p) { return p.x >= 2480 && p.x <= 2810 && p.y >= 1070 && p.y <= 1250 ? .19 : .025; }
  function natureFrame(ms, reduced) {
    var t = reduced ? 0 : Math.max(0, finite(ms) ? ms : 0) / 1000;
    return { wind: reduced ? 0 : Math.sin(t * 1.05) * .035, ripple: reduced ? 0 : Math.sin(t * 1.7) * .035,
      fountain: reduced ? 0 : (t * .65) % 1, time: t };
  }
  // Economic counterparties do not authorize cloned on-screen characters.
  // The initial world is empty until a story and distinct appearances are adopted.
  function people() { return []; }
  function alphaCoverage(canvas) {
    var size = sourceSize(canvas);
    if (!size || canvas.tagName !== 'CANVAS') return null;
    var gl = canvas.getContext && canvas.getContext('webgl');
    if (!gl) return null;
    var width = size.width, height = size.height, pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    for (var y = 0; y < height; y++) for (var x = 0; x < width; x++) if (pixels[(y * width + x) * 4 + 3] >= 31) return { anchor: y / height, width: width, height: height, pixels: pixels };
    return null;
  }
  function alphaAnchor(canvas) {
    var api = FrameFit || globalThis.PetFrameFit;
    if (api && typeof api.alphaAnchor === 'function') return api.alphaAnchor(canvas);
    // These exported diagnostics predate the lazy renderer dependency. Keep
    // them synchronous before mount; mounted frames use the shared contract.
    var coverage = alphaCoverage(canvas); return coverage ? coverage.anchor : null;
  }
  function sourceSize(source) {
    var api = FrameFit || globalThis.PetFrameFit;
    if (api && typeof api.sourceSize === 'function') return api.sourceSize(source);
    if (!source) return null;
    var image = source.tagName === 'IMG', canvas = source.tagName === 'CANVAS';
    if (!canvas && (!image || !source.complete)) return null;
    var width = image ? source.naturalWidth : source.width, height = image ? source.naturalHeight : source.height;
    return Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0 ? { width: width, height: height } : null;
  }
  function loadThree() {
    if (!threeLoading) threeLoading = import('/static/vendor/three-0.160.1.module.js').catch(function (e) { threeLoading = null; throw e; });
    return threeLoading;
  }
  function loadFrameFit() {
    var current = FrameFit || globalThis.PetFrameFit;
    if (current && typeof current.resolve === 'function') { FrameFit = current; return Promise.resolve(current); }
    if (!frameFitLoading) frameFitLoading = import('/static/pet-frame-fit.js?v=20261025-fit1').then(function () {
      var api = globalThis.PetFrameFit;
      if (!api || typeof api.resolve !== 'function') throw new Error('frame_fit_unavailable');
      FrameFit = api; return api;
    }).catch(function (error) { frameFitLoading = null; throw error; });
    return frameFitLoading;
  }
  function loadSeasons() {
    var current = Seasons || globalThis.PetJapanSeasons;
    if (current && typeof current.watch === 'function') { Seasons = current; return Promise.resolve(current); }
    if (!seasonsLoading) seasonsLoading = import('/static/pet-japan-seasons.js?v=20261026-brightness1').then(function () {
      var api = globalThis.PetJapanSeasons;
      if (!api || typeof api.watch !== 'function') throw new Error('seasons_unavailable');
      Seasons = api; return api;
    }).catch(function (error) { seasonsLoading = null; throw error; });
    return seasonsLoading;
  }
  function loadStyle() {
    var current = Style || globalThis.PetTownStyle;
    if (current && typeof current.leafGeometry === 'function' && typeof current.surfaceTexture === 'function') { Style = current; return Promise.resolve(current); }
    if (!styleLoading) styleLoading = import('/static/pet-town-style.js?v=20261025-market-style1').then(function () {
      var api = globalThis.PetTownStyle;
      if (!api || typeof api.leafGeometry !== 'function' || typeof api.surfaceTexture !== 'function') throw new Error('town_style_unavailable');
      Style = api; return api;
    }).catch(function (error) { styleLoading = null; throw error; });
    return styleLoading;
  }
  function groundTexture(THREE, doc, season) {
    if (!doc || !doc.createElement) return null;
    var canvas = doc.createElement('canvas'); canvas.width = canvas.height = 512;
    var ctx = canvas.getContext && canvas.getContext('2d'); if (!ctx) return null;
    var api = Seasons || globalThis.PetJapanSeasons, palette = api && api.profile(season || 'summer');
    palette = palette || {ground:'#b1cf83',light:'rgba(222,231,161,.22)',shade:'rgba(91,143,72,.20)',clear:'rgba(177,207,131,0)',grain:'rgba(129,171,89,.23)',spark:'rgba(224,234,173,.27)'};
    ctx.fillStyle = palette.ground; ctx.fillRect(0, 0, 512, 512);
    function unit(i) { var n = Math.sin(i * 17.13 + 3.1) * 43758.5453; return n - Math.floor(n); }
    function wrapped(x, y, draw) { for (var dx = -512; dx <= 512; dx += 512) for (var dy = -512; dy <= 512; dy += 512) draw(x + dx, y + dy); }
    // Broad, softly blended moss and warm dappled light, rather than uniform grain.
    for (var i = 0; i < 95; i++) {
      var x = unit(i) * 512, y = unit(i + 4000) * 512, radius = 24 + unit(i + 9) * 76;
      wrapped(x, y, function (cx, cy) { var gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        gradient.addColorStop(0, i % 3 ? palette.light : palette.shade); gradient.addColorStop(1, palette.clear);
        ctx.fillStyle = gradient; ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2); });
    }
    // Quiet, irregular ground grains replace the repeated three-leaf stamp.
    var style = Style || globalThis.PetTownStyle, patches = style ? style.limits.groundPatches : 80;
    for (var c = 0; c < patches; c++) {
      var cx = unit(c + 8000) * 512, cy = unit(c + 10000) * 512, radius = 1.2 + unit(c + 17000) * 3.4;
      ctx.fillStyle = c % 4 ? palette.grain : palette.spark;
      wrapped(cx, cy, function (wx, wy) { ctx.beginPath(); ctx.ellipse(wx, wy, radius, radius * (.28 + unit(c + 19000) * .4), unit(c + 21000) * TAU, 0, TAU); ctx.fill(); });
    }
    var texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 4; return texture;
  }
  function buildWorld(THREE, world, view, avoid, doc, seasonKey) {
    var scene = new THREE.Scene(), group = new THREE.Group(), geometries = new Set(), materials = new Set(), textures = new Set();
    var surfaces = [], occluders = [], pickables = [], trees = [], ripples = [], droplets = [], placeGroups = [], seasonalSites = [], seasonGroups = {}, seasonBatches = [], activeSeason = null, disposed = false;
    scene.add(group); group.name = 'saved-town-geometry';
    var style = Style || globalThis.PetTownStyle, surfaceMaps = {}, cache = {}, boxGeometry = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4), sphereGeometry = new THREE.SphereGeometry(1, 16, 10), leafGeometry = style ? style.leafGeometry(THREE) : new THREE.SphereGeometry(1, 10, 6), cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 16);
    var trunkGeometry = style ? style.branchGeometry(THREE, 'trunk') : null, branchGeometry = style ? style.branchGeometry(THREE, 'branch') : null, roofTileGeometry = style ? style.tileGeometry(THREE) : null;
    [trunkGeometry, branchGeometry, roofTileGeometry].forEach(function (g) { if (g) geometries.add(g); });
    // Shared bevelled box: small trim and furniture keep the adopted soft edges.
    var vertices = boxGeometry.attributes.position, vector = new THREE.Vector3(), inside = new THREE.Vector3();
    for (var vi = 0; vi < vertices.count; vi++) { vector.fromBufferAttribute(vertices, vi); inside.set(clamp(vector.x, -.43, .43), clamp(vector.y, -.43, .43), clamp(vector.z, -.43, .43)); vector.sub(inside).normalize().multiplyScalar(.07).add(inside); vertices.setXYZ(vi, vector.x, vector.y, vector.z); }
    boxGeometry.computeVertexNormals();
    geometries.add(boxGeometry); geometries.add(sphereGeometry); geometries.add(leafGeometry); geometries.add(cylinderGeometry);
    // Match the saved cream/peach/mint artwork with distinct, softly lit surfaces.
    // Grass and plaster stay matte; glazed roof tiles keep a small clear highlight.
    var finishes = {
      grass: { roughness: .96, metalness: 0 }, foliage: { roughness: .88, metalness: 0 }, flower: { roughness: .84, metalness: 0 },
      plaster: { roughness: .84, metalness: 0 }, wood: { roughness: .67, metalness: 0 }, bark: { roughness: .91, metalness: 0 }, glass: { roughness: .27, metalness: 0 },
      ceramic: { roughness: .42, metalness: 0 }, stone: { roughness: .83, metalness: 0 },
      water: { roughness: .26, metalness: 0 }, metal: { roughness: .45, metalness: .18 }
    };
    var roleColors = {
      foliage: ['#80ab6b','#9bc67e','#bbd998','#78aa65','#82ad6b','#a0c783','#b9d79a','#8eb875','#c2dda8','#82aa68','#a0c583','#a2c786','#a3bd7e','#b0ceac','#c4dbb9','#bad4b1'],
      plaster: ['#f6e8d6','#f2ead9','#f7ecda','#f5e7cf','#fcf0dd','#f6e7cf','#f5e9d5'],
      wood: ['#af936d','#bda278','#aa895f','#d5b68a','#b28e63','#ddc7a4','#b99c73','#ded0b1','#cda97d','#dfcbb0','#d8bb93','#b58a69','#e3ceae','#ccab80','#d2af91','#e3ceb1','#ccb18c','#d9b58b','#bd9c73','#cdae85','#dfbf95','#b38e65','#cda47a','#dcc29c','#d1b68f'],
      glass: ['#b8d8c8','#b5d5c0','#99c9be','#abd1c4','#b4d3ca'],
      ceramic: ['#f6e7bc','#f9e6b5','#d4a5b3','#e1bbc5','#a6c4b0','#bfd7c7','#d6a18b','#e7b49b','#cbb394','#ddc6a7','#c7ab88','#ccae8f'],
      water: ['#86c8c8','#91cece','#b9e2df','#c6e8dd'],
      metal: ['#b79461','#b49a6b','#c2ac83','#a59169','#b3976c','#c5a777','#bda071']
    }, colorRoles = {};
    Object.keys(roleColors).forEach(function (role) { roleColors[role].forEach(function (color) { colorRoles[color] = role; }); });
    function surfaceMap(role) {
      if (!style || ['wood','bark','plaster','ceramic','foliage','stone'].indexOf(role) < 0) return null;
      if (!Object.prototype.hasOwnProperty.call(surfaceMaps, role)) {
        if (Object.keys(surfaceMaps).length >= style.limits.surfaceTextures) return null;
        surfaceMaps[role] = style.surfaceTexture(THREE, doc, role);
        if (surfaceMaps[role]) textures.add(surfaceMaps[role]);
      }
      return surfaceMaps[role];
    }
    function mat(color, transparent, role) {
      role = role || colorRoles[color] || 'stone';
      var key = color + ':' + !!transparent + ':' + role, finish = finishes[role] || finishes.stone;
      if (!cache[key]) { cache[key] = new THREE.MeshStandardMaterial({ color: color, roughness: finish.roughness, metalness: finish.metalness, transparent: !!transparent, opacity: transparent ? .72 : 1 }); var bump = surfaceMap(role); if (bump) { cache[key].bumpMap = bump;
          if (role !== 'foliage') cache[key].map = bump;
          cache[key].bumpScale = role === 'bark' ? .065 : role === 'wood' ? .03 : role === 'foliage' ? .028 : role === 'ceramic' ? .006 : .018; }
        cache[key].userData.surfaceRole = role; cache[key].userData.baseColor = color; if (role === 'foliage' || role === 'flower') cache[key].userData.seasonRole = role; materials.add(cache[key]); }
      return cache[key];
    }
    function mesh(geo, material, parent, x, y, z) {
      geometries.add(geo); var m = new THREE.Mesh(geo, typeof material === 'string' ? mat(material) : material);
      m.position.set(x || 0, y || 0, z || 0); m.receiveShadow = true; parent.add(m); return m;
    }
    function box(parent, w, h, d, color, x, y, z) { var m = mesh(boxGeometry, color, parent, x, y, z); m.scale.set(w, h, d); return m; }
    function ball(parent, color, x, y, z, rx, ry, rz) { var m = mesh(sphereGeometry, color, parent, x, y, z); m.scale.set(rx, ry, rz); return m; }
    function cylinder(parent, radius, height, color, x, y, z) { var m = mesh(cylinderGeometry, color, parent, x, y, z); m.scale.set(radius, height, radius); return m; }
    function leaf(parent, color, x, y, z, size, tilt, turn) {
      var m = mesh(leafGeometry, color, parent, x, y, z); m.scale.set(size * (style ? 1 : .52), size, size * (style ? 1 : .22)); m.rotation.set(tilt || 0, turn || 0, .12 * Math.sin(x * 8 + z)); return m;
    }
    function leafBush(parent, x, y, z, size, seed) {
      var bush = new THREE.Group(); bush.name = 'layered-leaf-bush'; bush.position.set(x, y, z); parent.add(bush);
      ball(bush, '#80ab6b', 0, size * .25, 0, size * .65, size * .4, size * .55);
      for (var l = 0; l < 13; l++) { var a = l * 2.4 + seed, ring = l < 8 ? .48 : .24, ly = l < 8 ? .24 : .5;
        var petal = leaf(bush, ['#9bc67e', '#bbd998', '#78aa65'][l % 3], Math.sin(a) * size * ring, size * ly, Math.cos(a) * size * ring, size * .34, .6, a); petal.rotation.z += .35 * Math.sin(a); }
      return bush;
    }
    function daisy(parent, x, y, z, size, blush) {
      var g = new THREE.Group(); g.name = 'five-petal-daisy'; g.position.set(x, y, z); parent.add(g);
      cylinder(g, .012 * size, .19 * size, '#82aa68', 0, .095 * size, 0);
      for (var d = 0; d < 5; d++) { var angle = d * TAU / 5; var petal = ball(g, mat(blush ? '#edc0c1' : '#fff1d9', false, 'flower'), Math.sin(angle) * .069 * size, .21 * size, Math.cos(angle) * .069 * size, .058 * size, .035 * size, .078 * size); petal.rotation.y = angle; }
      ball(g, '#dfb666', 0, .23 * size, 0, .042 * size, .033 * size, .042 * size);
      leaf(g, '#a0c583', -.035 * size, .06 * size, .02 * size, .08 * size, 1.1, -.8); return g;
    }
    function legacySoftTree(parent, seed, scale) {
      var trunk = cylinder(parent, .17 * scale, 1.36 * scale, '#af936d', 0, .68 * scale, 0); trunk.name = 'rounded-tree-trunk';
      ball(parent, '#bda278', 0, .18 * scale, 0, .24 * scale, .28 * scale, .21 * scale);
      for (var root = 0; root < 5; root++) { var ra = root * TAU / 5 + seed; var foot = ball(parent, '#aa895f', Math.sin(ra) * .16 * scale, .07 * scale, Math.cos(ra) * .16 * scale, .1 * scale, .08 * scale, .28 * scale); foot.rotation.y = ra; }
      for (var branch = -1; branch <= 1; branch += 2) { var arm = cylinder(parent, .075 * scale, .7 * scale, '#af936d', branch * .22 * scale, 1.08 * scale, .02); arm.rotation.z = -branch * .55; }
      var crown = new THREE.Group(); crown.name = 'overlapping-leaf-crown'; crown.position.y = 1.23 * scale; parent.add(crown);
      ball(crown, '#82ad6b', 0, .34 * scale, 0, .56 * scale, .5 * scale, .5 * scale);
      for (var tier = 0; tier < 5; tier++) { var ly = -.12 + tier * .235, surface = Math.sqrt(Math.max(0, 1 - Math.pow((ly - .34) / .61, 2))), count = 14 - tier * 2, radius = (.75 * surface + .055) * scale;
        for (var l = 0; l < count; l++) { var a = l * TAU / count + tier * .3 + seed, size = (.43 - tier * .022) * scale;
          var m = leaf(crown, ['#a0c783', '#b9d79a', '#8eb875'][(l + tier) % 3], Math.sin(a) * radius, ly * scale, Math.cos(a) * radius * .91, size);
          var normal = new THREE.Vector3(Math.sin(a) * radius / (.75 * .75), (ly - .34) * scale / (.61 * .61), Math.cos(a) * radius * .91 / (.68 * .68)).normalize();
          m.scale.set(size * .8, size, size * .22); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal); m.rotateZ(.14 * Math.sin(a));
        }
      }
      for (var top = 0; top < 3; top++) { var tip = leaf(crown, '#c2dda8', Math.sin(top * TAU / 3) * .1 * scale, .96 * scale, Math.cos(top * TAU / 3) * .1 * scale, .3 * scale); tip.scale.x = .24 * scale; tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)); tip.rotateZ(top * TAU / 3 + seed); } trees.push(crown); return crown;
    }
    function branchBetween(parent, start, end, radius, color) {
      var delta = new THREE.Vector3().subVectors(end, start), length = delta.length();
      var m = mesh(branchGeometry, mat(color, false, 'bark'), parent, start.x, start.y, start.z);
      m.scale.set(radius, length, radius); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return m;
    }
    function softTree(parent, seed, scale) {
      if (!style) return legacySoftTree(parent, seed, scale);
      var tree = new THREE.Group(); tree.name = 'market-style-branching-tree'; tree.userData.styleRole = 'botanical'; tree.scale.setScalar(scale); parent.add(tree);
      var trunk = mesh(trunkGeometry, mat('#af936d', false, 'bark'), tree, 0, 0, 0); trunk.name = 'rounded-tree-trunk'; trunk.scale.set(.155, 1.43, .155); trunk.rotation.y = seed;
      for (var root = 0; root < 5; root++) {
        var ra = root * TAU / 5 + seed;
        var exposed = branchBetween(tree, new THREE.Vector3(0, .12, 0), new THREE.Vector3(Math.sin(ra)*.30, .014, Math.cos(ra)*.28), .055, '#aa895f');
        exposed.name = 'tapered-tree-root';
      }
      for (var fork = 0; fork < 3; fork++) {
        var a = seed + fork * TAU / 3;
        branchBetween(tree, new THREE.Vector3(.025, .64, 0), new THREE.Vector3(Math.sin(a)*.46, 1.67+fork*.04, Math.cos(a)*.36), .075-fork*.007, '#af936d').name='visible-tree-fork';
      }
      var moss = ball(tree, '#80ab6b', 0, .025, 0, .28, .025, .25); moss.name='quiet-root-moss';
      var crown = new THREE.Group(); crown.name = 'overlapping-leaf-crown'; crown.position.y=1.23; tree.add(crown);
      var leaves=0;
      for (var cluster=0; cluster<style.limits.treeTwigs; cluster++) {
        var a=cluster*2.399963+seed, tier=cluster%3, radius=.36+(cluster%2)*.17;
        var center=new THREE.Vector3(Math.sin(a)*radius,.05+tier*.29,Math.cos(a)*radius*.85);
        var twig=branchBetween(crown,new THREE.Vector3(0,-.16,0),center,.025,'#aa895f');twig.name='canopy-twig';
        for(var l=0;l<style.limits.leavesPerTwig&&leaves<style.limits.treeLeaves;l++,leaves++){
          var turn=l*2.399963+cluster*.43, spread=.11+(l%4)*.032;
          var x=center.x+Math.sin(turn)*spread,y=center.y+(l%4-1.5)*.057,z=center.z+Math.cos(turn)*spread*.85;
          var size=.155+(l%3)*.015;
          var m=leaf(crown,['#a0c783','#b9d79a','#8eb875'][(l+cluster)%3],x,y,z,size);
          var normal=new THREE.Vector3(Math.sin(turn)*.65,.52+(l%3)*.12,Math.cos(turn)*.65).normalize();
          m.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);m.rotateZ(turn*.24);m.name='small-pointed-tree-leaf';
        }
      }
      tree.userData.leafCount=leaves;tree.userData.twigCount=style.limits.treeTwigs;trees.push(crown);return crown;
    }
    function solid(g, place) { g.traverse(function (m) { if (m.isMesh) { m.castShadow = true; occluders.push(m); if (place) { m.userData.placeId = place.id; pickables.push(m); } } }); }
    var landShape = new THREE.Shape();
    landShape.moveTo(-world.width / 200, world.height / 200); landShape.lineTo(world.width / 200, world.height / 200);
    shoreline.forEach(function (row) { landShape.lineTo((row[1] - world.width / 2) / UNIT, -(row[0] - world.height / 2) / UNIT); });
    landShape.lineTo(-world.width / 200, -world.height / 200); landShape.closePath();
    // ShapeGeometry is XY; rotate it into XZ. The shoreline shares the collision model's coordinates.
    var land = mesh(new THREE.ShapeGeometry(landShape), '#b1cf83', group, 0, .025, 0); land.rotation.x = -Math.PI / 2; land.name = 'dry-land'; surfaces.push(land);
    var grassTexture = null; land.material = mat('#ffffff', false, 'grass'); land.material.userData.seasonRole = 'ground';
    var landVertices = land.geometry.attributes.position, uv = land.geometry.attributes.uv;
    for (var li = 0; li < uv.count; li++) uv.setXY(li, (landVertices.getX(li) + world.width / 200) / (world.width / UNIT), (landVertices.getY(li) + world.height / 200) / (world.height / UNIT));
    uv.needsUpdate = true;
    var sea = box(group, 160, .06, 160, '#86c8c8', 0, -.08, 0); sea.name = 'water';
    for (var r = 0; r < 26; r++) {
      var py = (r + .5) / 26 * world.height, bankIndex = Math.min(shoreline.length - 2, Math.floor(py / 500));
      while (bankIndex > 0 && py < shoreline[bankIndex][0]) bankIndex--;
      var a = shoreline[bankIndex], b = shoreline[bankIndex + 1], edge = a[1] + (b[1] - a[1]) * clamp((py - a[0]) / (b[0] - a[0]), 0, 1);
      var rp = groundPoint(world, { x: Math.min(world.width - 25, edge + 40 + r % 3 * 55), y: py });
      var ripple = box(group, .4, .009, .025, '#c6e8dd', rp.x, -.035, rp.z); ripple.userData.baseX = rp.x; ripples.push(ripple);
    }
    var bridgeCenter = groundPoint(world, { x: 2645, y: 1160 });
    var bridge = mesh(new THREE.BoxGeometry(3.3, .14, 1.8), '#d5b68a', group, bridgeCenter.x, .12, bridgeCenter.z); bridge.name = 'bridge-deck'; surfaces.push(bridge);
    for (var rail = -1; rail <= 1; rail += 2) { box(group, 3.3, .09, .07, '#b28e63', bridgeCenter.x, .8, bridgeCenter.z + rail * .85); }
    function road(a, b) {
      var aa = groundPoint(world, a), bb = groundPoint(world, b), dx = bb.x - aa.x, dz = bb.z - aa.z;
      var curve = new THREE.CatmullRomCurve3([new THREE.Vector3(aa.x, .027, aa.z), new THREE.Vector3(aa.x + dx * .42, .027, aa.z + dz * .22), new THREE.Vector3(aa.x + dx * .78, .027, aa.z + dz * .68), new THREE.Vector3(bb.x, .027, bb.z)]);
      function ribbon(width, color, y) { var positions = [], indices = [], points = curve.getPoints(24);
        points.forEach(function (p, index) { var tangent = curve.getTangent(index / 24), normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize().multiplyScalar(width / 2); positions.push(p.x + normal.x, y, p.z + normal.z, p.x - normal.x, y, p.z - normal.z); if (index < 24) { var k = index * 2; indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); } });
        var geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setIndex(indices); geo.computeVertexNormals(); var strip = mesh(geo, color, group); strip.name = 'curved-path'; return strip; }
      ribbon(.88, '#a3bd7e', .027); ribbon(.73, '#d4be91', .029);
      var stones = Math.max(2, Math.floor(curve.getLength() / .36));
      for (var stone = 0; stone <= stones; stone++) { var t = stone / stones, at = curve.getPoint(t), tangent = curve.getTangent(t), offset = stone % 2 ? .13 : -.13;
        var paver = ball(group, stone % 3 ? '#e0cfad' : '#cfbf9e', at.x - tangent.z * offset, .03, at.z + tangent.x * offset, .23 + stone % 3 * .012, .025, .19); paver.name = 'rounded-path-stone'; paver.rotation.y = -Math.atan2(tangent.z, tangent.x);
        if (stone % 5 === 1 && t > .1 && t < .9) {
          var bx = at.x - tangent.z * .68, bz = at.z + tangent.x * .68, point = townPoint(world, { x: bx, z: bz });
          if (Town.isWalkable(world, point.x, point.y) && !world.places.some(function (place) { return Math.hypot(place.x - point.x, place.y - point.y) < 145; })) {
            var garden = new THREE.Group(); garden.position.set(bx, .028, bz); group.add(garden);
            leafBush(garden, 0, 0, 0, .3, stone);
            for (var stem = 0; stem < 3; stem++) { var angle = stem * 2.4, gx = Math.sin(angle) * .26, gz = Math.cos(angle) * .22; daisy(garden, gx, 0, gz, .75 + stem * .1, false); }
          }
        }
      }
    }
    var junction = { x: world.width * .48, y: world.height * .64 };
    world.places.forEach(function (p, index) {
      var ground = groundPoint(world, p.footprint), g = new THREE.Group(); g.name = 'place-' + p.id; g.userData.placeId = p.id;
      g.position.set(ground.x, .025, ground.z); group.add(g); placeGroups.push(g);
      var rx = p.footprint.rx / UNIT, rz = p.footprint.ry / UNIT;
      if (p.id === 'tree') {
        softTree(g, .4, 1.08);
      } else if (p.id === 'flowers') {
        var flowerBase = cylinder(g, rx * .83, .13, '#c7ab88', 0, .065, 0); flowerBase.scale.z *= rz / rx;
        leafBush(g, 0, .1, 0, Math.min(rx, rz) * .7, .6);
        for (var f = 0; f < 7; f++) { var fx = Math.sin(f * 2.4) * rx * .6, fz = Math.cos(f * 2.4) * rz * .55; daisy(g, fx, .12, fz, .95, f % 3 === 0); }
      } else if (p.id === 'playground') {
        var base = cylinder(g, rx * .85, .2, '#e0d1bc', 0, .1, 0); base.scale.z *= rz / rx;
        var basin = cylinder(g, .48, .15, '#e9ddcc', 0, .38, 0); basin.scale.z *= .8;
        var water = cylinder(g, .42, .02, '#91cece', 0, .465, 0); water.scale.z *= .8;
        cylinder(g, .08, .65, '#d8c7ad', 0, .63, 0);
        for (var drop = 0; drop < 9; drop++) { var droplet = ball(g, '#b9e2df', 0, .8, 0, .035, .08, .035); droplet.userData.phase = drop / 9; droplets.push(droplet); }
      } else {
        // The solid base is inscribed in the existing elliptical footprint; roofs can overhang above the pet.
        var cafe = p.id === 'cafe' || p.shopId === 'cafe', market = p.id === 'shop' || p.shopId && !cafe;
        var w = rx * (cafe || market ? 1.15 : 1.7), depth = rz, funding = p.status === 'funding' || p.status === 'building';
        box(g, w, .13, depth, '#ddc7a4', 0, .065, 0);
        if (funding) {
          for (var sx = -1; sx <= 1; sx += 2) for (var sz = -1; sz <= 1; sz += 2) box(g, .08, .6, .08, '#b99c73', sx * w / 2, .3, sz * depth / 2);
          box(g, w, .17, .06, '#ded0b1', 0, .45, depth / 2);
        } else {
          box(g, w, 1.8, depth, cafe ? '#f6e8d6' : '#f2ead9', 0, .96, 0);
          var roof = new THREE.Shape(); roof.moveTo(-w * .62, 0); roof.lineTo(0, .8); roof.lineTo(w * .62, 0); roof.closePath();
          var roofGeo = new THREE.ExtrudeGeometry(roof, { depth: depth + .3, bevelEnabled: true, bevelThickness: .045, bevelSize: .04, bevelSegments: 3, steps: 1 }); roofGeo.translate(0, 1.8, -depth / 2 - .15);
          var roofColor = p.id === 'home' ? '#d4a5b3' : cafe ? '#a6c4b0' : market ? '#d6a18b' : '#cbb394';
          mesh(roofGeo, [mat('#f2ead9'), mat(roofColor)], g);
          for (var gableSide = -1; gableSide <= 1; gableSide += 2) for (var gableEdge = -1; gableEdge <= 1; gableEdge += 2) { var trim = box(g, Math.hypot(w * .62, .8), .065, .065, '#cda97d', gableEdge * w * .31, 2.2, gableSide * (depth / 2 + .19)); trim.rotation.z = -gableEdge * Math.atan2(.8, w * .62); }
          // Thick overlapping ceramic shingles follow both real sloping roof planes.
          var roofRun = w * .62, roofAngle = Math.atan2(.8, roofRun), tileRows = 4, tileColumns = Math.max(3, Math.ceil((depth + .3) / .3));
          for (var roofSide = -1; roofSide <= 1; roofSide += 2) for (var tileRow = 0; tileRow < tileRows; tileRow++) for (var tileColumn = 0; tileColumn < tileColumns; tileColumn++) {
            var fraction = (tileRow + .4) / tileRows, tz = -depth / 2 - .12 + (tileColumn + .5) * (depth + .24) / tileColumns;
            var tile = (roofTileGeometry ? function (color, x, y, z, rx, ry, rz) { var m = mesh(roofTileGeometry, color, g, x, y, z); m.scale.set(rx, ry, rz); return m; } : function (color, x, y, z, rx, ry, rz) { return ball(g, color, x, y, z, rx, ry, rz); })(tileRow % 2 ? roofColor : p.id === 'home' ? '#e1bbc5' : cafe ? '#bfd7c7' : market ? '#e7b49b' : '#ddc6a7', roofSide * roofRun * fraction, 2.6 - fraction * .8 + .035, tz, roofRun / tileRows * .72, .065, (depth + .3) / tileColumns * .61); tile.name = 'overlapping-round-roof-tile';
            if (roofTileGeometry) {
              // The scallop is local -Z. Rotate it down the +/-X roof slope,
              // swapping local X/Z scale so its established box does not grow.
              var rx = tile.scale.x, rz = tile.scale.z; tile.scale.set(rz, tile.scale.y, rx);
              tile.quaternion.setFromAxisAngle(new THREE.Vector3(0,0,1), -roofSide * roofAngle)
                .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), -roofSide * Math.PI / 2));
            } else tile.rotation.z = -roofSide * roofAngle;
          }
          // Fine gable joinery, warm wood edges and door seams echo the shop art.
          // Everything sits inside the existing roof/porch projection.
          ball(g, '#cda97d', 0, 2.12, depth / 2 + .175, .15, .18, .035);
          ball(g, '#b8d8c8', 0, 2.12, depth / 2 + .203, .113, .14, .018);
          box(g, .022, .28, .032, '#f7ecda', 0, 2.12, depth / 2 + .224);
          box(g, .225, .022, .032, '#f7ecda', 0, 2.12, depth / 2 + .224);
          for (var post=-1;post<=1;post+=2) box(g, .048, 1.56, .045, '#dfcbb0', post*w*.475, .98, depth/2+.027);
          box(g, w * 1.25, .11, depth + .36, '#dfcbb0', 0, 1.79, 0);
          box(g, w * 1.04, .12, depth * 1.04, '#d8bb93', 0, .2, 0);
          function doorPart(m) { m.userData.door = true; return m; }
          doorPart(box(g, .47, 1.06, .09, '#f7ecda', 0, .57, depth / 2 + .03));
          doorPart(box(g, .36, .94, .1, '#b58a69', 0, .53, depth / 2 + .08));
          doorPart(ball(g, '#f5e7cf', 0, 1.08, depth / 2 + .045, .235, .25, .065)); doorPart(ball(g, '#b58a69', 0, 1.07, depth / 2 + .09, .18, .21, .055));
          doorPart(box(g, .22, .32, .015, '#b8d8c8', 0, .78, depth / 2 + .138));
          doorPart(ball(g, '#b79461', .115, .48, depth / 2 + .16, .035, .035, .025));
          for (var seam=-1;seam<=1;seam++) doorPart(box(g,.006,.75,.006,'#aa895f',seam*.085,.55,depth/2+.133));
          doorPart(box(g, .53, .1, .26, '#e3ceae', 0, .065, depth / 2 + .1));
          for (var wx = -1; wx <= 1; wx += 2) {
            var windowX = wx * w * .32;
            ball(g, '#ccab80', windowX, 1.23, depth / 2 + .035, .18, .28, .065);
            ball(g, '#b5d5c0', windowX, 1.23, depth / 2 + .08, .137, .226, .04);
            box(g, .22, .38, .09, '#99c9be', windowX, 1.22, depth / 2 + .07);
            box(g, .035, .4, .11, '#fcf0dd', windowX, 1.22, depth / 2 + .11);
            box(g, .25, .035, .11, '#fcf0dd', windowX, 1.22, depth / 2 + .115);
            box(g, .34, .12, .18, '#d2af91', windowX, .92, depth / 2 + .1);
            for (var fl = -1; fl <= 1; fl++) { leaf(g, '#a2c786', windowX + fl * .09, 1.02, depth / 2 + .13, .09, .5, fl); daisy(g, windowX + fl * .09, .93, depth / 2 + .14, .42, fl === 0); }
          }
          // Rear and side windows keep orbiting views finished as well as the front.
          for (var side = -1; side <= 1; side += 2) { box(g, .055, .48, .32, '#f6e7cf', side * (w / 2 + .025), 1.12, 0); box(g, .065, .36, .22, '#abd1c4', side * (w / 2 + .055), 1.12, 0); box(g, .075, .035, .25, '#f7ecda', side * (w / 2 + .065), 1.12, 0); }
          box(g, .35, .5, .06, '#f5e9d5', 0, 1.18, -depth / 2 - .02); box(g, .26, .39, .075, '#b4d3ca', 0, 1.18, -depth / 2 - .05);
          box(g, .22, .42, .22, '#e3ceb1', w * .28, 2.4, -.12); box(g, .3, .09, .3, '#ccb18c', w * .28, 2.64, -.12);
          if (cafe || market) {
            for (var stripe = 0; stripe < 7; stripe++) { var awning = box(g, w * .14, .09, .38, stripe % 2 ? '#faf0db' : cafe ? '#ddb1bc' : '#a5c4aa', (stripe - 3) * w * .14, 1.5, depth / 2 + .14); awning.rotation.x = .12; }
            box(g, .48, .2, .09, cafe ? '#d8afc0' : '#b6cfae', 0, 1.75, depth / 2 + .08);
          }
          if (cafe) {
            var tx = rx * .7;
            cylinder(g, .15, .05, '#d9b58b', tx, .43, .02); cylinder(g, .035, .4, '#bd9c73', tx, .2, .02);
            for (var chair = -1; chair <= 1; chair += 2) { box(g, .15, .05, .15, '#cdae85', tx, .24, chair * .26); box(g, .15, .25, .035, '#dfbf95', tx, .36, chair * .32); for (var leg = -1; leg <= 1; leg += 2) box(g, .025, .22, .025, '#b38e65', tx + leg * .05, .11, chair * .26); }
            cylinder(g, .035, .06, '#f3e7d2', tx, .49, .02);
          } else if (market) {
            for (var crate = 0; crate < 2; crate++) { box(g, .22, .2, .24, '#cda47a', rx * .7, .13 + crate * .17, .05 + crate * .13); for (var fruit = 0; fruit < 3; fruit++) ball(g, crate ? '#c4cf8c' : '#e5a795', rx * .7 + (fruit - 1) * .055, .27 + crate * .17, .05 + crate * .13, .045, .045, .045); }
          }
          for (var yard = -1; yard <= 1; yard += 2) {
            var px = yard * Math.min(rx * .58, .54), pz = depth / 2 + .13;
            var pot = cylinder(g, .09, .17, '#ccae8f', px, .085, pz); pot.scale.z *= .85;
            leafBush(g, px, .17, pz, .2, yard); daisy(g, px, .2, pz, .85, false);
            box(g, .26, .07, .045, '#dcc29c', yard * rx * .66, .21, .38);
            for (var fence = -1; fence <= 1; fence += 2) box(g, .035, .28, .045, '#d1b68f', yard * rx * .66 + fence * .1, .14, .38);
          }
          var lampGlobe = ball(g, '#f9e6b5', -.26, 1.3, depth / 2 + .14, .065, .08, .06); box(g, .12, .04, .1, '#b49a6b', -.26, 1.4, depth / 2 + .13);
        }
        if (doc && doc.createElement) {
          var signCanvas = doc.createElement('canvas'); signCanvas.width = 256; signCanvas.height = 64; var signContext = signCanvas.getContext && signCanvas.getContext('2d');
          if (signContext) { signContext.fillStyle = '#f5e9d6'; signContext.fillRect(0, 0, 256, 64); signContext.fillStyle = '#526449'; signContext.font = '500 28px sans-serif'; signContext.textAlign = 'center'; signContext.fillText(p.label + (funding ? p.status === 'building' ? '・建設中' : '・予定地' : ''), 128, 42, 244);
            var signTexture = new THREE.CanvasTexture(signCanvas); signTexture.colorSpace = THREE.SRGBColorSpace; textures.add(signTexture); var signMaterial = new THREE.MeshBasicMaterial({ map: signTexture }); materials.add(signMaterial); mesh(new THREE.PlaneGeometry(funding ? 1.05 : .78, funding ? .26 : .2), signMaterial, g, 0, funding ? .7 : 1.67, depth / 2 + .13); }
        }
        g.scale.y = .9;
        road(p.entrance, junction);
      }
      solid(g, p);
    });
    // Existing lantern/flower accents become separate objects, not a tilted background image.
    [[31, 32], [64, 32], [31, 72], [64, 72]].forEach(function (v) {
      var p = groundPoint(world, { x: v[0] / 100 * world.width, y: v[1] / 100 * world.height });
      var lamp = new THREE.Group(); lamp.position.set(p.x, .025, p.z); group.add(lamp);
      cylinder(lamp, .075, .09, '#c2ac83', 0, .045, 0); cylinder(lamp, .035, 1.2, '#a59169', 0, .6, 0);
      var bracket = new THREE.TorusGeometry(.12, .018, 6, 14, Math.PI); var arm = mesh(bracket, '#b3976c', lamp, .1, 1.23, 0); arm.rotation.z = -Math.PI / 2;
      ball(lamp, '#f6e7bc', .21, 1.16, 0, .12, .15, .12); cylinder(lamp, .14, .055, '#c5a777', .21, 1.31, 0); ball(lamp, '#bda071', .21, 1.36, 0, .1, .06, .1);
    });
    for (var flower = 0; flower < 65; flower++) {
      var fp = { x: 80 + flower % 13 * 193 + Math.sin(flower * 7.3) * 48, y: 110 + Math.floor(flower / 13) * 353 + Math.cos(flower * 3.1) * 64 };
      if (!Town.isWalkable(world, fp.x, fp.y) || world.places.some(function (p) { return Math.hypot(p.x - fp.x, p.y - fp.y) < 155; })) continue;
      var fpos = groundPoint(world, fp); if (flower % 4 === 0) seasonalSites.push(fpos);
      var clump = new THREE.Group(); clump.position.set(fpos.x, .026, fpos.z); group.add(clump);
      leafBush(clump, -.08, 0, -.04, .18 + flower % 3 * .025, flower);
      daisy(clump, .04, 0, .03, .75 + flower % 4 * .08, flower % 7 === 0);
      if (flower % 3 === 0) { daisy(clump, -.15, 0, .12, .6, false); var rock = ball(clump, '#d0cbb9', .16, .035, -.05, .12, .065, .1); rock.rotation.y = flower; }
    }
    // Unreachable border planting and low distant hills avoid a bare horizon.
    for (var edgeTree = 0; edgeTree < 26; edgeTree++) {
      var ex = edgeTree < 13 ? -world.width / 200 - .45 : -world.width / 200 + (edgeTree - 13) * 1.55, ez = edgeTree < 13 ? -world.height / 200 + edgeTree * 1.55 : -world.height / 200 - .45;
      var edgeGroup = new THREE.Group(); edgeGroup.position.set(ex + Math.sin(edgeTree * 2.7) * .4, .025, ez + Math.cos(edgeTree * 1.7) * .4); group.add(edgeGroup);
      var treeScale = .75 + (edgeTree * 7 % 9) * .055; softTree(edgeGroup, edgeTree * 2.4, treeScale);
      if (edgeTree % 2) { leafBush(group, ex + .5, .025, ez + .5, .6, edgeTree); for (var edgeFlower = 0; edgeFlower < 3; edgeFlower++) daisy(group, ex + .25 + edgeFlower * .2, .026, ez + .85, .85, false); }
    }
    for (var hill = 0; hill < 7; hill++) { ball(group, hill % 2 ? '#b0ceac' : '#c4dbb9', -16 + hill * 5, -.45, -14.5, 3.2, 2.4, 3.2); if (hill < 5) ball(group, '#bad4b1', -16 + hill * 4.5, -.65, 14.5, 3, 2.3, 3); }
    // Small, solid seasonal accents share this village's positions. They are
    // decorative only: never added to walking surfaces, saved layouts or doors.
    ['spring', 'summer', 'autumn', 'winter'].forEach(function (key) {
      var decor = new THREE.Group(); decor.name = 'season-' + key + '-accents'; decor.userData.seasonRole = key; decor.visible = false;
      scene.add(decor); seasonGroups[key] = decor;
      seasonalSites.slice(0, 8).forEach(function (p, i) {
        if (key === 'spring') {
          cylinder(decor, .012, .18, '#82aa68', p.x, .115, p.z).name = 'spring-blossom-stem';
          for (var b = 0; b < 5; b++) {
            var a = b * TAU / 5, petal = ball(decor, '#f4c5d4', p.x + Math.sin(a) * .11, .20, p.z + Math.cos(a) * .11, .10, .045, .13);
            petal.rotation.y = a; petal.name = 'spring-rounded-blossom';
          }
          ball(decor, '#e7c278', p.x, .23, p.z, .055, .035, .055);
        } else if (key === 'autumn') {
          var fallen = leaf(decor, i % 2 ? '#bd8756' : '#d7b16d', p.x + .22, .061, p.z + .13, .16, Math.PI / 2, 0);
          fallen.rotation.set(Math.PI / 2, 0, i * 1.7);
          fallen.name = 'autumn-fallen-leaf';
        } else if (key === 'winter') {
          var snow = ball(decor, '#f0eee0', p.x - .10, .08, p.z + .05, .28, .055, .18);
          snow.name = 'winter-low-snow-edge'; snow.receiveShadow = true;
        }
      });
    });
    // Seasonal accents are static instances per season/material. Their parent
    // visibility changes as one unit without adding dozens of mobile draw calls.
    scene.updateMatrixWorld(true);
    Object.keys(seasonGroups).forEach(function (key) {
      var decor = seasonGroups[key], groups = {};
      decor.children.slice().forEach(function (m) { var id = m.geometry.uuid + ':' + m.material.uuid; (groups[id] || (groups[id] = [])).push(m); });
      Object.keys(groups).forEach(function (id) {
        var rows = groups[id], batch = new THREE.InstancedMesh(rows[0].geometry, rows[0].material, rows.length);
        batch.name = 'season-detail-batch'; batch.userData.seasonRole = key; batch.receiveShadow = true;
        rows.forEach(function (m, i) { batch.setMatrixAt(i, m.matrixWorld); m.visible = false; });
        batch.computeBoundingSphere(); decor.add(batch); seasonBatches.push({ mesh: batch, rows: rows, dynamic: false });
      });
    });
    function setSeason(key) {
      var api = Seasons || globalThis.PetJapanSeasons, palette = api ? api.profile(key) :
        key === 'summer' ? { ground: '#b1cf83', sky: '#cbe7e8' } : null;
      if (disposed || !palette) return false;
      if (activeSeason === key) return true;
      // Texture hues are authored for each season; a green bitmap tinted white
      // would leave winter muddy. One replacement happens only at a season edge.
      var nextTexture = groundTexture(THREE, doc, key);
      if (nextTexture) { textures.add(nextTexture); nextTexture.repeat.set(world.width / 640, world.height / 640); }
      land.material.map = nextTexture; land.material.color.set(nextTexture ? '#ffffff' : palette.ground); land.material.needsUpdate = true;
      if (grassTexture) { textures.delete(grassTexture); grassTexture.dispose(); }
      grassTexture = nextTexture;
      materials.forEach(function (m) {
        var role = m.userData.seasonRole, base = m.userData.baseColor;
        if (role === 'foliage' && palette.foliage) {
          var index = roleColors.foliage.indexOf(base);
          m.color.set(index >= 13 ? palette.hills[(index - 13) % palette.hills.length] : palette.foliage[Math.max(0, index) % palette.foliage.length]);
        } else if (role === 'flower' && palette.flowers) m.color.set(palette.flowers[base === '#edc0c1' ? 0 : 1]);
      });
      Object.keys(seasonGroups).forEach(function (k) { seasonGroups[k].visible = k === key; });
      activeSeason = key; scene.background.set(palette.sky); scene.userData.season = key;
      scene.updateMatrixWorld(true);
      return true;
    }
    // A clear finite village needs no white fog wash over the character's colors.
    scene.background = new THREE.Color('#cbe7e8'); scene.fog = null;
    setSeason(seasonKey || 'summer');
    scene.add(new THREE.HemisphereLight('#f5f8ff', '#bbc8a5', 1.5));
    var sun = new THREE.DirectionalLight('#fff8ed', 2.2); sun.position.set(-7, 12, 8); sun.castShadow = true; sun.shadow.mapSize.set(512, 512); sun.shadow.radius = 3;
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 12, bottom: -12, near: .1, far: 45 }); sun.shadow.normalBias = .04; scene.add(sun);
    // Batch repeated primitives by material and neighborhood. Keep the original
    // meshes only as exact picking/camera collision targets; never draw them twice.
    scene.updateMatrixWorld(true);
    var buckets = {}, batches = seasonBatches.slice(), originals = [];
    group.traverse(function (m) { if (!m.isMesh || !m.visible) return; var cell = Math.floor(m.matrixWorld.elements[12] / 5) + ':' + Math.floor(m.matrixWorld.elements[14] / 5);
      var key = m.geometry.uuid + ':' + m.material.uuid + ':' + cell; (buckets[key] || (buckets[key] = [])).push(m); });
    Object.keys(buckets).forEach(function (key) {
      var rows = buckets[key]; if (rows.length < 2) return;
      var batch = new THREE.InstancedMesh(rows[0].geometry, rows[0].material, rows.length), dynamic = rows.some(function (m) { for (var p = m; p && p !== group; p = p.parent) if (trees.indexOf(p) >= 0 || ripples.indexOf(p) >= 0 || droplets.indexOf(p) >= 0) return true; return false; });
      batch.name = 'town-detail-batch'; batch.castShadow = rows.some(function (m) { return m.castShadow; }); batch.receiveShadow = true;
      rows.forEach(function (m, i) { batch.setMatrixAt(i, m.matrixWorld); m.visible = false; originals.push(m); }); batch.computeBoundingSphere(); if (dynamic) batch.boundingSphere.radius += .75; scene.add(batch); batches.push({ mesh: batch, rows: rows, dynamic: dynamic });
    });
    scene.updateMatrixWorld(true); scene.matrixWorldAutoUpdate = false;
    function animate(ms, reduced) {
      var frame = natureFrame(ms, reduced);
      trees.forEach(function (g, i) { g.rotation.z = frame.wind * Math.cos(i * 1.7); g.updateMatrixWorld(true); });
      ripples.forEach(function (m, i) { m.position.x = m.userData.baseX + (reduced ? 0 : Math.sin(frame.time * 1.1 + i) * .07); m.updateMatrixWorld(true); });
      droplets.forEach(function (m) { var a = reduced ? m.userData.phase : (frame.fountain + m.userData.phase) % 1; m.position.set(Math.sin(a * TAU) * .2, .48 + Math.sin(a * Math.PI) * .65, Math.cos(a * TAU) * .15); m.updateMatrixWorld(true); });
      batches.forEach(function (b) { if (b.dynamic) { b.rows.forEach(function (m, i) { b.mesh.setMatrixAt(i, m.matrixWorld); }); b.mesh.instanceMatrix.needsUpdate = true; } });
      return frame;
    }
    function dispose() { if (disposed) return; disposed = true; batches.forEach(function (b) { b.mesh.dispose(); }); geometries.forEach(function (g) { g.dispose(); }); materials.forEach(function (m) { m.dispose(); }); textures.forEach(function (t) { t.dispose(); }); sun.shadow.dispose(); scene.clear(); }
    return { scene: scene, surfaces: surfaces, occluders: occluders, pickables: pickables, placeGroups: placeGroups, animate: animate, dispose: dispose,
      setSeason: setSeason, seasonGroups: seasonGroups, styleLimits: style ? style.limits : null,
      geometries: geometries, materials: materials, textures: textures, batches: batches, people: people(world, view, avoid) };
  }
  async function mount(options) {
    options = options || {};
    var host = options.viewport, doc = host && host.ownerDocument, win = doc && doc.defaultView;
    var dead = false, failed = false, ready = false, dirty = false, rendering = false, renderer = null, observer = null, raf = null, lastPaint = -Infinity, lastSourceUpload = -Infinity;
    var removers = [], seasonWatch = null, texture = null, source = null, sourceCoverage = null, sourceFrame = null, cameraView = cameraState(options.camera), actualYaw = cameraView.yaw, drag = null, intervals = [];
    var world = options.world, position = Town.spawn(world, options.position), model = null, motion = { walking: false, dx: 0, dy: 0 }, heading = cameraView.yaw, travelled = 0;
    var media = win && win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null, reduced = !!(media && media.matches);
    function active() { if (dead || failed || !host || host.isConnected === false || !doc || doc.hidden) return false; try { return !options.canRun || !!options.canRun(); } catch (_) { return false; } }
    function listen(target, name, fn) { if (!target || !target.addEventListener) return; target.addEventListener(name, fn); removers.push(function () { target.removeEventListener(name, fn); }); }
    function report(name, value) { if (typeof options[name] === 'function') try { options[name](value); } catch (_) {} }
    function cancel() { if (raf !== null) { win.cancelAnimationFrame(raf); raf = null; } }
    function destroy() {
      if (dead) return; cancel(); dead = true; drag = null; sourceCoverage = null;
      function release(fn) { try { fn(); } catch (_) {} }
      if (seasonWatch) release(function () { seasonWatch.destroy(); });
      if (observer) release(function () { observer.disconnect(); }); removers.forEach(release); removers = [];
      if (fishingVisual) release(function () { fishingVisual.dispose(); });
      if (model) release(function () { model.dispose(); }); if (texture) release(function () { texture.dispose(); });
      if (renderer) { release(function () { renderer.renderLists.dispose(); }); release(function () { renderer.dispose(); }); release(function () { renderer.forceContextLoss(); }); release(function () { renderer.domElement.remove(); }); }
      if (host) { host.dataset.visualMode = 'flat'; delete host.dataset.townCamera; delete host.dataset.fishingPhase; delete host.dataset.townSeason; delete host.dataset.townSeasonDate; delete host.dataset.townStyle; }
    }
    function fail(code) { if (dead || failed) return; failed = true; destroy(); report('onFailure', code); }
    var THREE;
    try { var dependencies = await Promise.all([options.three || loadThree(), loadFrameFit(), loadSeasons(), loadStyle()]); THREE = dependencies[0]; } catch (_) { fail('town_module_unavailable'); return null; }
    if (!active()) { destroy(); return null; }
    var sprite, playerShadow, camera, ray, pointer, direction, target, desired, contactMap = null, fishingVisual = null, fishingState = null;
    function contactShadow(radius) {
      if (!contactMap && doc.createElement) {
        var pad = doc.createElement('canvas'); pad.width = pad.height = 64; var ctx = pad.getContext && pad.getContext('2d');
        if (ctx) { var gradient = ctx.createRadialGradient(32, 32, 3, 32, 32, 32); gradient.addColorStop(0, 'rgba(255,255,255,.7)'); gradient.addColorStop(.45, 'rgba(255,255,255,.4)'); gradient.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64); contactMap = new THREE.CanvasTexture(pad); model.textures.add(contactMap); }
      }
      var geometry = new THREE.CircleGeometry(radius, 24), material = new THREE.MeshBasicMaterial({ color: '#64764d', map: contactMap, transparent: true, opacity: .3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      model.geometries.add(geometry); model.materials.add(material); var shadow = new THREE.Mesh(geometry, material); shadow.rotation.x = -Math.PI / 2; shadow.scale.y = .58; model.scene.add(shadow); return shadow;
    }
    function syncCamera() {
      var p = groundPoint(world, position); target.set(p.x, heightAt(position) + .8, p.z);
      var requested = cameraView, activityFraming = !!(fishingState && Fishing && Fishing.legal(world, position));
      if (activityFraming) {
        var water = groundPoint(world, Fishing.site().target), span = Math.hypot(water.x-p.x, water.z-p.z);
        target.set((p.x+water.x)/2, .65, (p.z+water.z)/2);
        var fitDistance = (span+1.05)/(2*Math.tan(25*Math.PI/180)*Math.max(.3,camera.aspect))*1.15;
        requested = { yaw: cameraView.yaw, pitch: cameraView.pitch, distance: Math.max(cameraView.distance,Math.min(10,fitDistance)) };
      }
      var safe = safeCamera(THREE, model.occluders, target, requested); if (!safe) throw new Error('no_safe_camera');
      actualYaw = safe.yaw; direction.set(Math.sin(safe.yaw) * Math.cos(safe.pitch), Math.sin(safe.pitch), Math.cos(safe.yaw) * Math.cos(safe.pitch));
      desired.copy(target).addScaledVector(direction, safe.distance); camera.position.copy(desired); camera.lookAt(target); camera.updateMatrixWorld(true);
      host.dataset.townCamera = JSON.stringify({ yaw: cameraView.yaw, pitch: cameraView.pitch, actualYaw: safe.yaw, actualPitch: safe.pitch, distance: safe.distance, desiredDistance: cameraView.distance, activityFraming: activityFraming });
    }
    function render(stamp) {
      if (!active() || !renderer) return false;
      try {
        rendering = true;
        var p = groundPoint(world, position); sprite.position.set(p.x, heightAt(position), p.z);
        playerShadow.position.set(p.x, heightAt(position) + .003, p.z); playerShadow.visible = sprite.visible;
        sprite.updateMatrixWorld(true); playerShadow.updateMatrixWorld(true);
        model.animate(stamp || 0, reduced);
        if (fishingVisual) fishingVisual.update(fishingState, position, stamp || 0, reduced);
        syncCamera();
        var facing = heading;
        if (fishingState && !motion.walking && Fishing && Fishing.legal(world, position)) { var water = Fishing.site().target; facing = Math.atan2(water.x-position.x, water.y-position.y); }
        if (ready) report('onFacing', facingFrame(facing, actualYaw, motion.walking, travelled));
        renderer.render(model.scene, camera);
        if (renderer.info) { host.dataset.townRenderCalls = String(renderer.info.render.calls); host.dataset.townTriangles = String(renderer.info.render.triangles); }
        var interval = stamp - lastPaint; if (finite(interval) && interval > 0 && interval < 1000) { intervals.push(interval); if (intervals.length > 30) intervals.shift(); host.dataset.townFrameMs = (intervals.reduce(function (sum, n) { return sum + n; }, 0) / intervals.length).toFixed(2); }
        lastPaint = finite(stamp) ? stamp : 0; dirty = false; return true;
      } catch (_) { fail('town_render_failed'); return false; }
      finally { rendering = false; }
    }
    function schedule() { if (active() && ready && (!reduced || dirty) && raf === null) raf = win.requestAnimationFrame(tick); }
    function requestRender() { dirty = true; schedule(); }
    function tick(stamp) {
      raf = null; if (!active()) { cancel(); return; }
      if ((dirty || !reduced) && stamp - lastPaint >= 32) render(stamp);
      schedule();
    }
    function resize() { if (!active()) return; try { var box = host.getBoundingClientRect(); if (!(box.width > 0 && box.height > 0)) return; renderer.setSize(box.width, box.height, false); camera.aspect = box.width / box.height; camera.updateProjectionMatrix(); requestRender(); } catch (_) { fail('town_resize_failed'); } }
    function setFrame(canvas, metadata) {
      if (!active() || !renderer) return false;
      try {
        var changed = source !== canvas, coverage = null, frameMetadata = metadata;
        if (changed && canvas && canvas.tagName === 'CANVAS' && !(metadata != null && Object.prototype.hasOwnProperty.call(metadata, 'anchor'))) {
          // One initial alpha read serves both foot contact and opaque-pixel
          // picking; the shared contract still validates its actual anchor.
          coverage = alphaCoverage(canvas);
          if (!coverage) return false;
          frameMetadata = { anchor: coverage.anchor };
        }
        var fit = FrameFit.resolve(canvas, frameMetadata, sourceFrame);
        if (!fit) return false;
        // A canvas object can keep its identity while its drawing buffer resizes.
        // WebGL2 texture storage is immutable: allocate a fresh GPU texture then.
        var resized = !!sourceFrame && (fit.width !== sourceFrame.width || fit.height !== sourceFrame.height);
        if (resized && !changed && canvas.tagName === 'CANVAS') coverage = alphaCoverage(canvas);
        var stamp = win.performance ? win.performance.now() : Date.now();
        // Reduced-motion direction changes are explicit, not an ambient stream.
        // Consume their newly painted buffer even inside the current world draw.
        if (!fit.changed && !reduced && stamp - lastSourceUpload < 32) return true;
        if (changed || resized) {
          if (texture) texture.dispose(); texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter; source = canvas;
          sourceCoverage = coverage; sprite.material.map = texture; sprite.material.needsUpdate = true;
        }
        sprite.center.set(.5, fit.anchor); sprite.scale.set(fit.worldWidth, fit.worldHeight, 1); sprite.visible = true; texture.needsUpdate = true;
        // r160 initTexture synchronously uploads the borrowed nonpreserved buffer.
        // Subsequent world renders use that GPU copy, and share one 32ms RAF cadence.
        renderer.initTexture(texture); lastSourceUpload = stamp; sourceFrame = fit;
        if (!ready) { if (!render(stamp)) return false; } else if (!rendering) requestRender();
        if (!ready) { ready = true; host.dataset.visualMode = 'three'; report('onReady', controller); schedule(); }
        return true;
      } catch (_) { fail('town_frame_unavailable'); return false; }
    }
    var controller = { destroy: destroy, setFrame: setFrame,
      setFishing: function (value) { if (!active()) return false; fishingState = value && ['waiting','bite','caught'].indexOf(value.phase) >= 0 ? { phase: value.phase } : null; host.dataset.fishingPhase = fishingState ? fishingState.phase : 'idle'; requestRender(); return true; },
      setPosition: function (p) { if (active() && p && Town.isWalkable(world, p.x, p.y)) { travelled += Math.hypot(p.x-position.x,p.y-position.y)/UNIT; position = { x: p.x, y: p.y }; requestRender(); } },
      setMotion: function (m) { if (active()) {
        var valid = m && finite(m.dx) && finite(m.dy) && Math.hypot(m.dx, m.dy) > .001;
        motion = { walking: !!(valid && m.walking), dx: valid ? m.dx : 0, dy: valid ? m.dy : 0 };
        host.dataset.townWalking = String(motion.walking);
        if (motion.walking) { heading = Math.atan2(motion.dx, motion.dy); var relative = cameraDirection(motion.dx, motion.dy, -actualYaw); host.dataset.townFacing = Math.abs(relative.x) > .4 ? relative.x < 0 ? 'left' : 'right' : relative.y < 0 ? 'away' : 'toward'; }
        requestRender();
      } },
      camera: function () { return cameraState(cameraView); },
      direction: function (x, y) { return cameraDirection(x, y, actualYaw); },
      resolveTap: function (event) {
        if (!active() || !ready || drag && drag.moved) return null;
        var box = host.getBoundingClientRect(); pointer.set((event.clientX - box.left) / box.width * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1);
        ray.setFromCamera(pointer, camera); ray.near = camera.near; ray.far = camera.far;
        var hits = ray.intersectObjects((sprite && sprite.visible ? [sprite] : []).concat(model.pickables, model.surfaces), false).filter(function (hit) {
          if (hit.object !== sprite || !sourceCoverage || !hit.uv) return true;
          var x = Math.max(0, Math.min(sourceCoverage.width - 1, Math.floor(hit.uv.x * sourceCoverage.width)));
          var y = Math.max(0, Math.min(sourceCoverage.height - 1, Math.floor(hit.uv.y * sourceCoverage.height)));
          return sourceCoverage.pixels[(y * sourceCoverage.width + x) * 4 + 3] >= 31;
        });
        if (!hits.length) return null;
        var hit = hits[0]; if (hit.object === sprite) return { pet: true };
        var id = hit.object.userData.placeId;
        if (id) return hit.object.userData.door ? { placeId: id, door: true } : { placeId: id };
        var p = townPoint(world, hit.point); return Town.isWalkable(world, p.x, p.y) ? p : null;
      }
    };
    try {
      var seasonNow = typeof options.seasonNow === 'function' ? options.seasonNow : Date.now, firstSeason = null;
      try { firstSeason = Seasons.resolve(seasonNow()); } catch (_) {}
      model = buildWorld(THREE, world, options.view, position, doc, firstSeason ? firstSeason.key : 'summer');
      host.dataset.townStyle = model.styleLimits ? 'market-style1' : 'legacy';
      if (Fishing && typeof Fishing.createVisual === 'function') { fishingVisual = Fishing.createVisual(THREE, world); model.scene.add(fishingVisual.group); }
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false }); renderer.setPixelRatio(Math.min(win.devicePixelRatio || 1, 1.5));
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true; renderer.outputColorSpace = THREE.SRGBColorSpace;
      var canvas = renderer.domElement; canvas.className = 'ipg-town-canvas'; canvas.setAttribute('aria-hidden', 'true'); host.appendChild(canvas);
      camera = new THREE.PerspectiveCamera(50, 1, .05, 80); ray = new THREE.Raycaster(); pointer = new THREE.Vector2(); direction = new THREE.Vector3(); target = new THREE.Vector3(); desired = new THREE.Vector3();
      var spriteMaterial = new THREE.SpriteMaterial({ transparent: true, alphaTest: .12, depthTest: true, depthWrite: true }); model.materials.add(spriteMaterial);
      sprite = new THREE.Sprite(spriteMaterial); sprite.name = 'current-pet-2d-frame'; sprite.visible = false; model.scene.add(sprite);
      playerShadow = contactShadow(.35); playerShadow.name = 'pet-contact-shadow'; playerShadow.visible = false;
      listen(canvas, 'webglcontextlost', function (e) { e.preventDefault(); fail('town_context_lost'); });
      listen(host, 'pointerdown', function (e) { if (!active() || !ready || e.isPrimary === false || e.button !== 0) return; drag = { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false }; });
      listen(host, 'pointermove', function (e) {
        if (!active() || !drag || e.pointerId !== drag.id) return;
        if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 10) return;
        cameraView = cameraState({ yaw: cameraView.yaw - (e.clientX - drag.x) * .008, pitch: cameraView.pitch + (e.clientY - drag.y) * .004, distance: cameraView.distance });
        drag.x = e.clientX; drag.y = e.clientY; drag.moved = true; report('onCamera', cameraView); requestRender(); if (e.cancelable) e.preventDefault();
      });
      function end(e) { if (drag && (e.pointerId === undefined || drag.id === e.pointerId)) drag = null; }
      listen(win, 'pointerup', end); listen(win, 'pointercancel', end); listen(win, 'blur', function () { drag = null; cancel(); });
      seasonWatch = Seasons.watch({ now: seasonNow, subscribe: options.seasonSubscribe, enabled: active,
        setTimeout: function (fn, ms) { return win.setTimeout(fn, ms); }, clearTimeout: function (id) { win.clearTimeout(id); },
        onChange: function (value) {
          if (!active()) return;
          try {
            var changed = model.scene.userData.season !== value.key;
            model.setSeason(value.key); host.dataset.townSeason = value.key; host.dataset.townSeasonDate = value.dateJst;
            if (changed) { renderer.shadowMap.needsUpdate = true; requestRender(); }
          } catch (_) { fail('town_season_unavailable'); }
        }
      });
      if (dead || failed) { seasonWatch.destroy(); return null; }
      listen(win, 'focus', function () { if (seasonWatch) seasonWatch.check(); schedule(); });
      listen(doc, 'visibilitychange', function () { cancel(); drag = null; if (!doc.hidden && active()) { if (seasonWatch) seasonWatch.check(); requestRender(); } });
      if (media) listen(media, 'change', function () { reduced = !!media.matches; cancel(); requestRender(); });
      if (win.ResizeObserver) { observer = new win.ResizeObserver(resize); observer.observe(host); } else listen(win, 'resize', resize);
      resize(); schedule(); return dead || failed ? null : controller;
    } catch (_) { fail('town_renderer_unavailable'); return null; }
  }
  return Object.freeze({ mount: mount, buildWorld: buildWorld, groundPoint: groundPoint, townPoint: townPoint, cameraState: cameraState,
    cameraDirection: cameraDirection, facingFrame: facingFrame, cameraDistance: cameraDistance, safeCamera: safeCamera, natureFrame: natureFrame, people: people, alphaAnchor: alphaAnchor, sourceSize: sourceSize, groundTexture: groundTexture, heightAt: heightAt });
}));

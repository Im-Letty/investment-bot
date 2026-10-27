/* A view of the existing Town world. No game actions, storage or economy clock. */
(function (root, factory) {
  'use strict';
  var api = factory(typeof module === 'object' && module.exports ? require('./pet-town-walk.js') : root.PetTownWalk,
    typeof module === 'object' && module.exports ? require('./pet-frame-fit.js') : root.PetFrameFit,
    typeof module === 'object' && module.exports ? require('./pet-river-fishing.js') : root.PetRiverFishing,
    typeof module === 'object' && module.exports ? require('./pet-japan-seasons.js') : root.PetJapanSeasons,
    typeof module === 'object' && module.exports ? require('./pet-town-style.js') : root.PetTownStyle,
    typeof module === 'object' && module.exports ? require('./pet-town-layout-art.js') : root.PetTownLayoutArt,
    typeof module === 'object' && module.exports ? require('./pet-town-placement-originals.js') : root.PetTownPlacementOriginals,
    typeof module === 'object' && module.exports ? require('./pet-town-water-life.js') : root.PetTownWaterLife);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetTownScene = api;
}(typeof window !== 'undefined' ? window : globalThis, function (Town, FrameFit, Fishing, Seasons, Style, LayoutArt, Originals, WaterLife) {
  'use strict';
  var threeLoading = null, frameFitLoading = null, seasonsLoading = null, styleLoading = null, layoutLoading = null, originalsLoading = null, waterLifeLoading = null, UNIT = 100, TAU = Math.PI * 2;
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
    if (current && current.artRevision === 'shop-cottage-match2' && typeof current.watch === 'function') { Seasons = current; return Promise.resolve(current); }
    if (!seasonsLoading) seasonsLoading = import('/static/pet-japan-seasons.js?v=20261026-shop-cottage-match2').then(function () {
      var api = globalThis.PetJapanSeasons;
      if (!api || api.artRevision !== 'shop-cottage-match2' || typeof api.watch !== 'function') throw new Error('seasons_unavailable');
      Seasons = api; return api;
    }).catch(function (error) { seasonsLoading = null; throw error; });
    return seasonsLoading;
  }
  function styleReady(api) { return !!api && api.revision === 'shop-cottage-match2' && ['leafGeometry','roundedLeafGeometry','branchGeometry','tileGeometry','bowlGeometry','archGeometry','surfaceTexture','paletteColor','materialFinish'].every(function (key) { return typeof api[key] === 'function'; }) && !!api.collection && !!api.collection.light; }
  function loadStyle() {
    var current = Style || globalThis.PetTownStyle;
    if (styleReady(current)) { Style = current; return Promise.resolve(current); }
    if (!styleLoading) styleLoading = import('/static/pet-town-style.js?v=20261027-layout-art3d1').then(function () {
      var api = globalThis.PetTownStyle;
      if (!styleReady(api)) throw new Error('town_style_unavailable');
      Style = api; return api;
    }).catch(function (error) { styleLoading = null; throw error; });
    return styleLoading;
  }
  function loadLayoutArt() {
    var current = LayoutArt || globalThis.PetTownLayoutArt;
    if (current && current.revision === 'layout-art-3d1' && typeof current.build === 'function') { LayoutArt = current; return Promise.resolve(current); }
    if (!layoutLoading) layoutLoading = import('/static/pet-town-layout-art.js?v=20261027-solidlife1').then(function () {
      var api = globalThis.PetTownLayoutArt;
      if (!api || api.revision !== 'layout-art-3d1' || typeof api.build !== 'function') throw new Error('layout_art_unavailable');
      LayoutArt = api; return api;
    }).catch(function (error) { layoutLoading = null; throw error; });
    return layoutLoading;
  }
  function loadOriginals() {
    var current = Originals || globalThis.PetTownPlacementOriginals;
    if (current && current.revision === 'placement-originals1') { Originals=current; return Promise.resolve(current); }
    if (!originalsLoading) originalsLoading=import('/static/pet-town-placement-originals.js?v=20261027-originals1').then(function () {
      Originals=globalThis.PetTownPlacementOriginals;
      if (!Originals || Originals.revision !== 'placement-originals1') throw new Error('town_originals_unavailable');
      return Originals;
    }).catch(function(error){ originalsLoading=null; throw error; });
    return originalsLoading;
  }
  function loadWaterLife() {
    var current=WaterLife||globalThis.PetTownWaterLife;
    if(current&&current.revision==='fountain-water-life1'&&typeof current.create==='function'){WaterLife=current;return Promise.resolve(current);}
    if(!waterLifeLoading)waterLifeLoading=import('/static/pet-town-water-life.js?v=20261027-waterlife1').then(function(){
      WaterLife=globalThis.PetTownWaterLife;
      if(!WaterLife||WaterLife.revision!=='fountain-water-life1'||typeof WaterLife.create!=='function')throw new Error('town_water_life_unavailable');
      return WaterLife;
    }).catch(function(error){waterLifeLoading=null;throw error;});
    return waterLifeLoading;
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
      wrapped(cx, cy, function (wx, wy) { ctx.beginPath(); ctx.ellipse(wx, wy, radius, radius * (.28 + unit(c + 19000) * .4), unit(c + 21000) * TAU, 0, TAU); ctx.fill();
        // Sparse three-blade grains vary in lean/height, with no repeating icon.
        for (var blade = 0; blade < 3; blade++) {
          ctx.beginPath(); ctx.ellipse(wx + blade * 1.5, wy - blade * .7, .45 + unit(c + blade + 24000) * .25, 1.8 + unit(c + blade + 26000) * 2.4, -.35 + unit(c + blade + 28000) * .7, 0, TAU); ctx.fill();
        } });
    }
    var texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 4; return texture;
  }
  // A small equirectangular sky is a world background only: never a screen wash.
  // It has no game clock, reflection/environment role, or effect on sprite colors.
  function skyTexture(THREE, doc, palette) {
    if (!doc || !doc.createElement || !palette || !palette.sky) return null;
    var canvas = doc.createElement('canvas'); canvas.width = 256; canvas.height = 128;
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx || typeof ctx.createLinearGradient !== 'function') return null;
    var gradient = ctx.createLinearGradient(0, 0, 0, 128);
    gradient.addColorStop(0, palette.sky);
    gradient.addColorStop(.52, palette.sky);
    gradient.addColorStop(.65, palette.horizon || '#f0ecdf');
    gradient.addColorStop(1, palette.horizon || '#f0ecdf');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 256, 128);
    var texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.userData.presentationRole = 'bounded-seasonal-sky-background';
    return texture;
  }
  function coastMaskTexture(THREE, doc) {
    if (!doc || !doc.createElement) return null;
    var canvas=doc.createElement('canvas');canvas.width=canvas.height=128;
    var ctx=canvas.getContext&&canvas.getContext('2d');
    if(!ctx||!ctx.createImageData||!ctx.putImageData)return null;
    var pixels=ctx.createImageData(128,128);
    for(var y=0;y<128;y++)for(var x=0;x<128;x++){
      var edge=Math.max(Math.abs((x+.5)/128*2-1),Math.abs((y+.5)/128*2-1));
      var t=Math.max(0,Math.min(1,(edge-.78)/.20)),value=Math.round(255*(1-t*t*(3-2*t))),i=(y*128+x)*4;
      pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=value;pixels.data[i+3]=255;
    }
    ctx.putImageData(pixels,0,0);
    var texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.NoColorSpace;
    texture.userData.presentationRole='distant-coast-edge-mask';return texture;
  }
  function buildWorld(THREE, world, view, avoid, doc, seasonKey) {
    var scene = new THREE.Scene(), group = new THREE.Group(), geometries = new Set(), materials = new Set(), textures = new Set();
    var surfaces = [], occluders = [], pickables = [], trees = [], ripples = [], droplets = [], placeGroups = [], seasonalSites = [], seasonGroups = {}, seasonBatches = [], activeSeason = null, disposed = false;
    scene.add(group); group.name = 'saved-town-geometry';
    var originalAPI=Originals||globalThis.PetTownPlacementOriginals;
    var originalArt=originalAPI?originalAPI.create(THREE,{textures:textures,materials:materials}):null, originalCoverage=new Map(), buildingGeometry=false;
    function originalSprite(kind,parent,width,x,y,z) {
      var sprite=originalArt.createSprite(kind,{width:width});
      sprite.position.set(x||0,y||0,z||0); parent.add(sprite); return sprite;
    }
    async function loadOriginalArt(loader) {
      if (!originalArt) throw new Error('town_originals_unavailable');
      await originalArt.preload(loader||new THREE.TextureLoader());
      if(disposed)return false;
      group.traverse(function(o){
        if(!o.isSprite||!o.userData.originalArt)return;
        var image=o.material.map&&o.material.map.image;
        if(originalCoverage.has(image))return;
        if(!doc||!doc.createElement)throw new Error('town_original_alpha_unavailable');
        var pad=doc.createElement('canvas');pad.width=image.width;pad.height=image.height;
        var context=pad.getContext('2d',{willReadFrequently:true});
        if(!context)throw new Error('town_original_alpha_unavailable');
        context.drawImage(image,0,0);
        originalCoverage.set(image,{width:pad.width,height:pad.height,pixels:context.getImageData(0,0,pad.width,pad.height).data});
      });
      scene.userData.originalArtState='ready';return true;
    }
    function originalHit(hit) {
      if(!hit.object.userData.originalArt||!hit.uv)return true;
      var coverage=originalCoverage.get(hit.object.material.map&&hit.object.material.map.image);
      if(!coverage)return false;
      var x=clamp(Math.floor(hit.uv.x*coverage.width),0,coverage.width-1),y=clamp(Math.floor((1-hit.uv.y)*coverage.height),0,coverage.height-1);
      return coverage.pixels[(y*coverage.width+x)*4+3]>=8;
    }
    function originalDoorHit(hit) {
      if(!hit.object.userData.originalArt)return !!hit.object.userData.door;
      if(!hit.uv)return false;
      // Inset regions were visually read from the actual 384px door panels.
      // Roofs/windows and transparent corners keep ordinary approach semantics.
      var bounds={home:[234,240,278,306],cafe:[226,241,260,305],shop:[239,240,271,312]}[hit.object.userData.originalArtKind];
      if(!bounds)return false;
      var x=Math.floor(hit.uv.x*384),y=Math.floor((1-hit.uv.y)*384);
      return x>=bounds[0]&&x<bounds[2]&&y>=bounds[1]&&y<bounds[3];
    }
    scene.userData.originalArtRevision=originalArt?'placement-originals1':'unavailable';
    scene.userData.originalArtRepresentation='original-2d-art-in-3d-world';scene.userData.originalArtState='pending';
    var style = Style || globalThis.PetTownStyle, surfaceMaps = {}, cache = {}, boxGeometry = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4), sphereGeometry = new THREE.SphereGeometry(1, 16, 10), leafGeometry = style ? style.leafGeometry(THREE) : new THREE.SphereGeometry(1, 10, 6), cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 16);
    var trunkGeometry = style ? style.branchGeometry(THREE, 'trunk') : null, branchGeometry = style ? style.branchGeometry(THREE, 'branch') : null, roofTileGeometry = style ? style.tileGeometry(THREE) : null;
    var roundedLeafGeometry = style && typeof style.roundedLeafGeometry === 'function' ? style.roundedLeafGeometry(THREE) : leafGeometry;
    var bowlGeometry = style && style.bowlGeometry ? style.bowlGeometry(THREE) : null, archGeometry = style && style.archGeometry ? style.archGeometry(THREE) : null;
    [trunkGeometry, branchGeometry, roofTileGeometry, bowlGeometry, archGeometry].forEach(function (g) { if (g) geometries.add(g); });
    // Shared closed botanical/ceramic shapes: one allocation per shape, never one per petal.
    function finishGeometry(g) {
      g.computeVertexNormals(); var p=g.attributes.position,n=g.attributes.normal,pool=new Map();
      for(var i=0;i<p.count;i++){var key=[p.getX(i),p.getY(i),p.getZ(i)].map(function(v){return Math.round(v*1e6);}).join(':'),v=pool.get(key)||new THREE.Vector3();v.add(new THREE.Vector3(n.getX(i),n.getY(i),n.getZ(i)));pool.set(key,v);}
      for(var i=0;i<p.count;i++){var key=[p.getX(i),p.getY(i),p.getZ(i)].map(function(v){return Math.round(v*1e6);}).join(':'),v=pool.get(key);if(v.lengthSq()<1e-12)v.set(0,1,0);v.normalize();n.setXYZ(i,v.x,v.y,v.z);}
      g.computeBoundingBox();g.computeBoundingSphere();geometries.add(g);return g;
    }
    var flowerPetalGeometry=new THREE.SphereGeometry(1,10,6),fp=flowerPetalGeometry.attributes.position;
    for(var fi=0;fi<fp.count;fi++)fp.setXYZ(fi,fp.getX(fi)*(.82+.18*(fp.getZ(fi)+1)/2),fp.getY(fi)*.22,fp.getZ(fi));
    finishGeometry(flowerPetalGeometry);flowerPetalGeometry.userData.styleRole='closed-thin-botanical-petal';
    var panelGeometry=flowerPetalGeometry.clone(),pp=panelGeometry.attributes.position,outerProfile=[[0,.42],[.07,.62],[.21,.81],[.43,.94],[.76,1],[1,.92]];
    for(var pi=0;pi<pp.count;pi++){
      var py=.52+pp.getZ(pi)*.22,pr=1;
      for(var pj=1;pj<outerProfile.length;pj++)if(py<=outerProfile[pj][0]){var pa=outerProfile[pj-1],pb=outerProfile[pj];pr=pa[1]+(pb[1]-pa[1])*(py-pa[0])/(pb[0]-pa[0]);break;}
      var angle=pp.getX(pi)*.16,radius=pr+.002+pp.getY(pi)*.028;pp.setXYZ(pi,-Math.sin(angle)*radius,py,Math.cos(angle)*radius);
    }
    finishGeometry(panelGeometry);panelGeometry.userData.styleRole='closed-raised-fountain-petal';
    var potPoints=[[0,0],[.35,0],[.55,.05],[.77,.18],[.92,.42],[1,.66],[.96,.82],[.82,.94],[.82,1],[.72,1],[.72,.88],[.78,.70],[.68,.35],[.30,.25],[0,.25]].map(function(p){return new THREE.Vector2(p[0],p[1]);});
    var flowerPotGeometry=finishGeometry(new THREE.LatheGeometry(potPoints,20));flowerPotGeometry.userData.styleRole='closed-hollow-glazed-pot';
    var tulipGeometry=new THREE.SphereGeometry(1,10,6),tp=tulipGeometry.attributes.position;
    for(var ti=0;ti<tp.count;ti++){var ty=(tp.getY(ti)+1)/2;tp.setXYZ(ti,tp.getX(ti)*.42,ty,.12*(1-ty)+.34*Math.sin(Math.PI*ty)+tp.getZ(ti)*.06);}
    finishGeometry(tulipGeometry);tulipGeometry.userData.styleRole='closed-cupped-tulip-petal';
    var capPoints=[[0,0],[.17,0],[.18,.025],[.13,.05],[.07,.10],[0,.10]].map(function(p){return new THREE.Vector2(p[0],p[1]);});
    var lanternCapGeometry=finishGeometry(new THREE.LatheGeometry(capPoints,4));lanternCapGeometry.userData.styleRole='closed-flared-paper-lantern-cap';
    // Shared bevelled box: small trim and furniture keep the adopted soft edges.
    var vertices = boxGeometry.attributes.position, vector = new THREE.Vector3(), inside = new THREE.Vector3();
    for (var vi = 0; vi < vertices.count; vi++) { vector.fromBufferAttribute(vertices, vi); inside.set(clamp(vector.x, -.43, .43), clamp(vector.y, -.43, .43), clamp(vector.z, -.43, .43)); vector.sub(inside).normalize().multiplyScalar(.07).add(inside); vertices.setXYZ(vi, vector.x, vector.y, vector.z); }
    boxGeometry.computeVertexNormals();
    geometries.add(boxGeometry); geometries.add(sphereGeometry); geometries.add(leafGeometry); geometries.add(roundedLeafGeometry); geometries.add(cylinderGeometry);
    // Match the saved cream/peach/mint artwork with distinct, softly lit surfaces.
    // Grass and plaster stay matte; glazed roof tiles keep a small clear highlight.
    var finishes = {
      grass: { roughness: .96, metalness: 0 }, foliage: { roughness: .88, metalness: 0 }, flower: { roughness: .84, metalness: 0 }, 'display-flower': { roughness: .84, metalness: 0 },
      plaster: { roughness: .84, metalness: 0 }, wood: { roughness: .67, metalness: 0 }, bark: { roughness: .91, metalness: 0 }, glass: { roughness: .27, metalness: 0 },
      ceramic: { roughness: .42, metalness: 0 }, stone: { roughness: .83, metalness: 0 },
      water: { roughness: .26, metalness: 0 }, metal: { roughness: .45, metalness: .18 }
    };
    var roleColors = {
      foliage: ['#80ab6b','#9bc67e','#bbd998','#78aa65','#82ad6b','#a0c783','#b9d79a','#8eb875','#c2dda8','#82aa68','#a0c583','#a2c786','#a3bd7e','#b0ceac','#c4dbb9','#bad4b1'],
      plaster: ['#f6e8d6','#f2ead9','#f7ecda','#f5e7cf','#fcf0dd','#f6e7cf','#f5e9d5'],
      wood: ['#9c704d','#b98a5e','#825b3e','#c4a171','#a67547','#d0af80','#b38657','#d8bd95','#b88555','#cba67c','#c7a06e','#a8754d','#d8b88b','#b98856','#bc916a','#d2b18a','#bc956b','#c39a6b','#a7794e','#bc8f5e','#cba46f','#a77549','#b98655','#ccaa7a','#c29b6b'],
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
      var paletteRole = role || colorRoles[color] || null;
      role = paletteRole || 'stone';
      var originalColor=color,resolvedColor=paletteRole&&style&&style.paletteColor?style.paletteColor(color,paletteRole):color;
      var finish=(style&&style.materialFinish?style.materialFinish(role,color):null)||finishes[role]||finishes.stone;
      var key = originalColor + ':' + resolvedColor + ':' + !!transparent + ':' + role + ':' + (paletteRole||'identity');
      if (!cache[key]) { cache[key] = new THREE.MeshStandardMaterial({ color: resolvedColor, roughness: finish.roughness, metalness: finish.metalness, transparent: !!transparent, opacity: transparent ? .72 : 1 }); var bump = surfaceMap(finish.textureRole||role); if (bump) { cache[key].bumpMap = bump;
          if (role !== 'foliage') cache[key].map = bump;
          cache[key].bumpScale = finish.bumpScale === undefined ? .018 : finish.bumpScale; }
        cache[key].userData.surfaceRole = role; cache[key].userData.paletteRole = paletteRole || 'identity'; cache[key].userData.baseColor = originalColor; cache[key].userData.paletteColor = resolvedColor; if (role === 'foliage' || role === 'flower') cache[key].userData.seasonRole = role; materials.add(cache[key]); }
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
      var m = mesh(leafGeometry, color, parent, x, y, z);
      m.scale.set(size * (style ? 1 : .52), size, size * (style ? 1 : .22));
      m.rotation.set(tilt || 0, turn || 0, .08 * Math.sin(x * 8 + z)); return m;
    }
    var roundedMaterials = {};
    function roundedLeaf(parent, color, x, y, z, size, tilt, turn) {
      var material = color;
      if (typeof color === 'string') {
        if (!roundedMaterials[color]) {
          material = mat(color, false, 'foliage').clone(); material.bumpMap = null; material.bumpScale = 0;
          material.userData.normalPolicy = 'smooth-analytic-rounded-volume'; materials.add(material); roundedMaterials[color] = material;
        }
        material = roundedMaterials[color];
      }
      var m = mesh(roundedLeafGeometry, material, parent, x, y, z);
      m.scale.set(size * 1.15, size, size); m.rotation.set(tilt || 0, turn || 0, 0);
      // Coarse village shadow texels broke these small padded faces into hard
      // dark islands. Keep their authored light/normals and casting policy;
      // only rounded leaves stop receiving that shadow map.
      m.receiveShadow = false;
      m.name = 'plump-ground-leaf'; return m;
    }
    function leafBush(parent, x, y, z, size, seed, keepCottageRecipe) {
      if(originalArt&&!buildingGeometry&&!keepCottageRecipe){var root=new THREE.Group();root.name='placement-original-garden';root.position.set(x,y,z);parent.add(root);originalSprite('flowers',root,Math.max(.42,size*2.2),0,0,0);return root;}
      var bush = new THREE.Group(); bush.name = 'layered-leaf-bush'; bush.position.set(x, y, z); parent.add(bush);
      // Rounded overlapping blades match the planted clumps in the layout art.
      ball(bush, '#80ab6b', 0, size * .08, 0, size * .23, size * .08, size * .21);
      for (var l = 0; l < 13; l++) {
        var a = l * 2.399963 + seed, outer = l < 8, ring = outer ? .36 : .14;
        var ly = outer ? .30 + .025 * Math.sin(a * 1.7) : .48 + .03 * Math.sin(a);
        var petal = (keepCottageRecipe ? leaf : roundedLeaf)(bush, ['#9bc67e', '#bbd998', '#78aa65'][l % 3],
          Math.sin(a) * size * ring, size * ly, Math.cos(a) * size * ring,
          size * ((keepCottageRecipe ? .23 : .26) + (l % 4) * .018), keepCottageRecipe ? .80 + (l % 3) * .14 : -1.13 - (l % 3) * .09, a);
        petal.rotation.z += .16 * Math.sin(a);
      }
      return bush;
    }
    function daisy(parent, x, y, z, size, blush, keepCottageRecipe) {
      if(originalArt&&!buildingGeometry&&!keepCottageRecipe){var root=new THREE.Group();root.name='placement-original-meadow-flowers';root.position.set(x,y,z);parent.add(root);originalSprite('flowers',root,.36*size,0,0,0);return root;}
      var g = new THREE.Group(); g.name = 'botanical-soft-meadow-flower'; g.position.set(x, y, z); parent.add(g);
      var variant = Math.floor(Math.abs(Math.sin(x * 17 + z * 29 + size * 11)) * 3);
      var count = variant === 1 ? 6 : 7, stemHeight = (.17 + variant * .006) * size;
      g.userData.blossomVariant = variant; g.userData.petalCount = count;
      cylinder(g, .012 * size, stemHeight, '#82aa68', 0, stemHeight / 2, 0);
      for (var d = 0; d < count; d++) {
        var angle = d * TAU / count + variant * .17, cup = variant === 2 ? .26 : .12;
        var petal = mesh(flowerPetalGeometry, mat(blush || variant === 2 ? '#edc0c1' : '#fff1d9', false, 'flower'),
          g, Math.sin(angle) * .048 * size, stemHeight + .008 * size,
          Math.cos(angle) * .048 * size);
        petal.scale.set((keepCottageRecipe ? variant === 1 ? .032 : .036 : variant === 1 ? .038 : .042) * size, (keepCottageRecipe ? .027 : .032) * size, (keepCottageRecipe ? .060 : .068) * size);
        petal.rotation.set(cup + .035 * Math.sin(angle * 2), angle, .035 * Math.cos(angle * 3));
        petal.name = 'thin-botanical-flower-petal';
      }
      // The smaller soft ochre centre meets the actual stem. Cream/blush
      // petals keep the head from reading as a repeated solid yellow button.
      ball(g, '#dfb666', 0, stemHeight + .012 * size, 0, (keepCottageRecipe ? .028 : .031) * size, (keepCottageRecipe ? .017 : .019) * size, (keepCottageRecipe ? .028 : .031) * size);
      (keepCottageRecipe ? leaf : roundedLeaf)(g, '#a0c583', -.035 * size, .06 * size, .02 * size, .07 * size, 1.1, -.8); return g;
    }
    function plantedTulip(parent, x, z, height, color, turn) {
      var g = new THREE.Group(); g.name = 'planted-pink-tulip'; g.position.set(x, .025, z); parent.add(g);
      cylinder(g, .008, height, mat('#82ad6b', false, 'foliage'), 0, height / 2, 0);
      for (var side = -1; side <= 1; side += 2) {
        var blade = leaf(g, mat('#80ab6b', false, 'foliage'), side * .035, height * .43, 0, height * .32, .15, turn);
        blade.rotation.z = -side * .6;
      }
      for (var p = 0; p < 6; p++) {
        var a = turn + p * TAU / 6, petal = mesh(tulipGeometry, mat(p % 2 ? color : '#edc0c1', false, 'display-flower'), g, Math.sin(a) * .009, height, Math.cos(a) * .009);
        petal.scale.set(.12, .14, .12); petal.rotation.y = a; petal.name = 'planted-cupped-tulip-petal';
      }
      return g;
    }
    function flowerBed(parent, seed) {
      if(originalArt&&!buildingGeometry){var root=new THREE.Group();root.name='placement-original-flowerbed';parent.add(root);originalSprite('flowers',root,1.25,0,0,0);return root;}
      var g = new THREE.Group(); g.name = 'mixed-planted-flowerbed'; parent.add(g);
      ball(g, mat('#9bc67e', false, 'foliage'), 0, .012, 0, .30, .012, .19).name = 'low-flowerbed-moss';
      [[-.20,-.05],[.18,-.06],[0,.13],[0,-.14]].forEach(function(p, i) { leafBush(g, p[0], .02, p[1], .20, seed + i * 1.7); });
      [[-.17,0,.29],[.08,-.08,.38],[.22,.04,.31]].forEach(function(p, i) { plantedTulip(g, p[0], p[1], p[2], i % 2 ? '#e3a9bd' : '#edc0c1', seed + i); });
      [[-.28,.10,.65],[-.02,.20,.72],[.26,-.12,.65],[-.05,-.17,.65],[.07,.03,.68]].forEach(function(p) { daisy(g, p[0], .02, p[1], p[2], false); });
      [[-.32,-.08],[.30,.10],[.05,.21]].forEach(function(p) {
        var f = daisy(g, p[0], .02, p[1], .34, true); f.name = 'small-lilac-ground-flower';
        f.traverse(function(o) { if (o.name === 'thin-botanical-flower-petal') o.material = mat('#c4afd9', false, 'display-flower'); });
      });
      [[-.29,.03,.075],[.28,.08,.075],[-.15,-.20,.05]].forEach(function(p, i) { var rock = ball(g, '#d0cbb9', p[0], .035, p[1], p[2], .045, p[2] * .8); rock.rotation.y = seed + i; rock.name = 'flowerbed-rounded-stone'; });
      return g;
    }
    function legacySoftTree(parent, seed, scale) {
      var trunk = cylinder(parent, .17 * scale, 1.36 * scale, '#9c704d', 0, .68 * scale, 0); trunk.name = 'rounded-tree-trunk';
      ball(parent, '#b98a5e', 0, .18 * scale, 0, .24 * scale, .28 * scale, .21 * scale);
      for (var root = 0; root < 5; root++) { var ra = root * TAU / 5 + seed; var foot = ball(parent, '#825b3e', Math.sin(ra) * .16 * scale, .07 * scale, Math.cos(ra) * .16 * scale, .1 * scale, .08 * scale, .28 * scale); foot.rotation.y = ra; }
      for (var branch = -1; branch <= 1; branch += 2) { var arm = cylinder(parent, .075 * scale, .7 * scale, '#9c704d', branch * .22 * scale, 1.08 * scale, .02); arm.rotation.z = -branch * .55; }
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
    function pointedTree(parent, seed, scale) {
      if (!style) return legacySoftTree(parent, seed, scale);
      var tree = new THREE.Group(); tree.name = 'market-style-branching-tree'; tree.userData.styleRole = 'botanical'; tree.scale.setScalar(scale); parent.add(tree);
      var trunk = mesh(trunkGeometry, mat('#8c6043', false, 'bark'), tree, 0, 0, 0); trunk.name = 'rounded-tree-trunk'; trunk.scale.set(.155, 1.43, .155); trunk.rotation.y = seed;
      for (var root = 0; root < 5; root++) {
        var ra = root * TAU / 5 + seed;
        var exposed = branchBetween(tree, new THREE.Vector3(0, .12, 0), new THREE.Vector3(Math.sin(ra)*.30, .014, Math.cos(ra)*.28), .055, '#825b3e');
        exposed.name = 'tapered-tree-root';
      }
      for (var fork = 0; fork < 3; fork++) {
        // The three structural forks end inside the existing middle leaf
        // sprays instead of protruding like pruned tips above the canopy.
        var a = seed + fork * TAU / 3 + .86;
        branchBetween(tree, new THREE.Vector3(.025, .64, 0), new THREE.Vector3(Math.sin(a)*.315, 1.45+fork*.012, Math.cos(a)*.2835), .085-fork*.009, '#8c6043').name='visible-tree-fork';
      }
      for(var mossPart=0;mossPart<5;mossPart++){var ma=mossPart*2.4+seed,moss=ball(tree,'#80ab6b',Math.sin(ma)*.16,.025,Math.cos(ma)*.15,.17,.025,.13);moss.name='quiet-root-moss';}
      var crown = new THREE.Group(); crown.name = 'overlapping-leaf-crown'; crown.position.y=1.23; tree.add(crown);
      var leaves=0;
      for (var cluster=0; cluster<style.limits.treeTwigs; cluster++) {
        var tier=Math.floor(cluster/3), a=seed+(cluster%3)*TAU/3+tier*.86, radius=tier===0?.344:tier===1?.328:.20;
        var center=new THREE.Vector3(Math.sin(a)*radius,-.02+tier*.24,Math.cos(a)*radius*.9);
        var twig=branchBetween(crown,new THREE.Vector3(-.156,-.19,.056),center,.028,'#825b3e');twig.name='canopy-twig';
        for(var l=0;l<style.limits.leavesPerTwig&&leaves<style.limits.treeLeaves;l++,leaves++){
          // Interleaved loose sprays surround the twig tips. Their visible
          // faces turn outward around the canopy instead of all facing skyward
          // as edge-on paired fern rows. The gaps still reveal real branches.
          var turn=l*2.399963+a, spread=.075+(l%4)*.021;
          // Four leaves per spray overlap toward its inner twig, covering
          // the upper forks without a sphere core or any additional leaves.
          var inward=l%4===0?.72:1;
          var x=center.x*inward+Math.sin(turn)*spread,y=center.y+(l%4-1.5)*.045,z=center.z*inward+Math.cos(turn)*spread*.88;
          var size=(.175+(l%5)*.012)*.72*.94, color=['#82ad6b','#9bc67e','#bbd998','#78aa65'][(l+cluster)%4];
          var material=mat(color,false,'foliage');
          if(l===12){material=mat(cluster%2?'#adc17b':'#c6cc99',false,'foliage');material.userData.seasonRole='accent';material.userData.seasonIndex=cluster%2;}
          var m=leaf(crown,material,x,y,z,size);
          var normal=new THREE.Vector3(Math.sin(turn)*.64,.62+(l%3)*.12,Math.cos(turn)*.64).normalize();
          m.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);
          m.rotateZ(turn*.34);
          m.scale.x*=.82+(l%4)*.06;m.userData.botanicalSize=size;
          m.userData.foliagePlacement='overlapping-inner-and-tip-spray-contact-unverified';m.name='small-pointed-tree-leaf';
        }
      }
      tree.userData.leafCount=leaves;tree.userData.twigCount=style.limits.treeTwigs;trees.push(crown);return crown;
    }
    function softTree(parent, seed, scale) {
      if(originalArt){var root=new THREE.Group();root.name='placement-original-tree';parent.add(root);originalSprite('tree',root,3.25*(scale||1),0,0,0);return root;}
      if (!style || typeof style.roundedLeafGeometry !== 'function') return pointedTree(parent, seed, scale);
      var tree = new THREE.Group(); tree.name = 'market-style-branching-tree'; tree.userData.styleRole = 'botanical';
      tree.userData.artDirection = 'rounded-layout-reference'; tree.scale.setScalar(scale); parent.add(tree);
      var bark = mat('#b98a5e', false, 'bark'), trunk = mesh(trunkGeometry, bark, tree, 0, 0, 0);
      trunk.name = 'rounded-tree-trunk'; trunk.scale.set(.18, 1.38, .18); trunk.rotation.y = seed;
      for (var root = 0; root < 5; root++) {
        var a = seed + root * TAU / 5, foot = ball(tree, bark, Math.sin(a) * .18, .085, Math.cos(a) * .17, .085, .085, .22);
        foot.rotation.y = a; foot.name = 'plump-flared-tree-root';
      }
      for (var fork = 0; fork < 3; fork++) {
        var a = seed + fork * TAU / 3 + .86;
        branchBetween(tree, new THREE.Vector3(.025, .60, 0), new THREE.Vector3(Math.sin(a) * .27, 1.37 + fork * .01, Math.cos(a) * .24), .08 - fork * .007, '#b98a5e').name = 'visible-tree-fork';
      }
      var crown = new THREE.Group(); crown.name = 'overlapping-leaf-crown'; crown.position.y = 1.40; tree.add(crown);
      ball(crown, mat('#82ad6b', false, 'foliage'), 0, .25, 0, .53, .31, .46).name = 'hidden-rounded-canopy-heart';
      // A broad oblate dome with downturned lower lobes, rather than a stack
      // of upright thin plates. Saved root/footpoint transforms stay separate.
      var counts = [14,13,11,8,5], heights = [-.04,.12,.30,.48,.62], radii = [.65,.70,.61,.44,.18], sizes = [.31,.34,.30,.27,.22];
      var normalHeights = [-.18,.28,.62,.90,1], normalRadii = [.99,.96,.78,.44,.10], leaves = 0;
      for (var tier = 0; tier < counts.length; tier++) for (var l = 0; l < counts[tier]; l++) {
        var a = seed + l * TAU / counts[tier] + tier * .37;
        var normal = new THREE.Vector3(Math.sin(a) * normalRadii[tier], normalHeights[tier], Math.cos(a) * normalRadii[tier]).normalize(), side = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
        var up = new THREE.Vector3().crossVectors(normal, side).normalize();
        var m = roundedLeaf(crown, ['#82ad6b','#9bc67e','#bbd998','#78aa65'][(l + tier) % 4], Math.sin(a) * radii[tier], heights[tier] + .012 * Math.sin(a * 2), Math.cos(a) * radii[tier] * .88, sizes[tier]);
        m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, normal)); m.rotateZ(.10 * Math.sin(a * 3));
        m.name = 'rounded-overlapping-tree-leaf'; m.userData.tier = tier; leaves++;
      }
      for (var top = 0; top < 3; top++) {
        var a = seed + top * TAU / 3, m = roundedLeaf(crown, '#bbd998', Math.sin(a) * .10, .70, Math.cos(a) * .10, .19);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), new THREE.Vector3(0,1,0)); m.rotateZ(a);
        m.name = 'rounded-overlapping-tree-leaf'; m.userData.tier = 5; leaves++;
      }
      tree.userData.leafCount = leaves; tree.userData.twigCount = 3; trees.push(crown); return crown;
    }
    function solid(g, place) { g.traverse(function (m) { if (m.isMesh) { var decorative=!!(m.userData.nonSolidWater||m.userData.nonSolidWindow);m.castShadow=!decorative;if(!decorative)occluders.push(m);if(place&&!m.userData.nonSolidWater){m.userData.placeId=place.id;pickables.push(m);} } }); }
    // BEGIN shop-cottage-match2: local home shell/roof/joinery only.

    // Closed wall panels and shallow window rooms share the same physical
    // building dimensions as walking. These are decorative interiors only;
    // entered rooms and the player's saved state remain separate.
    var windowRooms = [], windowLifeMaterials = [], waterLife = null;
    var solidLifeRevision = 'solid-living-buildings1';
    scene.userData.solidLifeRevision = solidLifeRevision;
    scene.userData.buildingRepresentation = 'closed-volume-with-recessed-window-rooms';
    function archPointsLocal(width,height,base,x) {
      var half=width/2,spring=height*.62,rise=height-spring,points=[[x-half,base],[x+half,base],[x+half,base+spring]];
      for(var i=1;i<=24;i++){var a=Math.PI*i/24;points.push([x+Math.cos(a)*half,base+spring+Math.sin(a)*rise]);}
      return points;
    }
    function outlinePath(points,isHole) {
      var path=isHole?new THREE.Path():new THREE.Shape(),p=isHole?points.slice().reverse():points;
      path.moveTo(p[0][0],p[0][1]);for(var i=1;i<p.length;i++)path.lineTo(p[i][0],p[i][1]);path.closePath();return path;
    }
    function windowArchGeometry(width,height,base,thickness,inset) {
      var shape=outlinePath(archPointsLocal(width,height,base,0),false);
      if(inset)shape.holes.push(outlinePath(archPointsLocal(width-inset*2,height-inset*2,base+inset,0),true));
      var geo=new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:false,steps:1,curveSegments:12});
      geo.translate(0,0,-thickness/2);return finishGeometry(geo);
    }
    function wallShell(parent,width,height,depth,base,color,profiles) {
      var thickness=.10, rows=[
        ['front',width,0,depth/2-thickness/2,0],
        ['back',width,0,-depth/2+thickness/2,Math.PI],
        ['left',depth,-width/2+thickness/2,0,-Math.PI/2],
        ['right',depth,width/2-thickness/2,0,Math.PI/2]
      ], parts=[];
      rows.forEach(function(row){
        var shape=outlinePath([[-row[1]/2,base],[row[1]/2,base],[row[1]/2,base+height],[-row[1]/2,base+height]],false);
        (profiles[row[0]]||[]).forEach(function(hole){shape.holes.push(outlinePath(archPointsLocal(hole.width,hole.height,hole.base,hole.x||0),true));});
        var geo=new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:false,steps:1,curveSegments:12});geo.translate(0,0,-thickness/2);finishGeometry(geo);
        var wall=mesh(geo,mat(color,false,'plaster'),parent,row[2],0,row[3]);wall.rotation.y=row[4];
        wall.name=row[0]==='front'?'cottage-short-cream-wall':'solid-building-'+row[0]+'-wall';
        wall.userData.solidWall=true;wall.userData.wallSide=row[0];wall.userData.actualOpeningCount=(profiles[row[0]]||[]).length;
        parts.push(wall);
      });return parts;
    }
    function ownedWindowMaterial(color,emission,intensity,transparent) {
      var material=new THREE.MeshStandardMaterial({color:color,roughness:transparent?.24:.82,metalness:0,
        emissive:emission||'#000000',emissiveIntensity:intensity||0,transparent:!!transparent,opacity:transparent?.30:1,depthWrite:!transparent});
      material.userData.windowLifeOwned=true;materials.add(material);windowLifeMaterials.push(material);return material;
    }
    function windowPart(mesh,dynamic) {
      mesh.userData.nonSolidWindow=true;mesh.userData.windowLife=true;mesh.castShadow=false;mesh.receiveShadow=false;
      if(dynamic)mesh.userData.noStaticBatch=true;return mesh;
    }
    function windowRoom(parent,spec) {
      var room=new THREE.Group(),width=spec.width,height=spec.height,phase=windowRooms.length*.73;
      room.name=spec.name||'recessed-window-room';room.position.set(spec.x||0,spec.base||0,spec.z||0);room.rotation.y=spec.turn||0;
      room.userData.windowRoom=true;room.userData.aperture={width:width,height:height,depth:.22,round:!!spec.round};room.userData.decorativeInteriorOnly=true;
      parent.add(room);
      if(spec.frame!==false){
        var frame=mesh(windowArchGeometry(width+.12,height+.12,-.06,.075,.06),mat('#ba8652',false,'wood'),room,0,0,.025);
        frame.name='living-arched-window-ring';
        box(room,width+.17,.07,.07,mat('#ba8652',false,'wood'),0,-.025,.025).name='living-window-sill';
      }
      var backMaterial=ownedWindowMaterial('#c6a777','#e8b777',.30,false);
      var back=windowPart(box(room,width,height,.018,backMaterial,0,height/2,-.205),false);back.name='window-room-warm-backwall';
      windowPart(box(room,width,.018,.19,mat('#b98a5e',false,'wood'),0,.006,-.108),false).name='window-room-floor';
      [-1,1].forEach(function(side){windowPart(box(room,.018,height,.19,mat('#c6aa80',false,'plaster'),side*(width/2-.009),height/2,-.108),false).name='window-room-reveal';});
      var glassMaterial=ownedWindowMaterial('#ecdfbd','#ffd394',.065,true),pane;
      if(spec.round){pane=mesh(new THREE.CylinderGeometry(width/2,width/2,.016,24),glassMaterial,room,0,height/2,.012);pane.rotation.x=Math.PI/2;}
      else pane=mesh(windowArchGeometry(width,height,0,.016,0),glassMaterial,room,0,0,.012);
      windowPart(pane,false);pane.name='living-window-glass';pane.userData.windowPane=true;
      var curtainColor=spec.kind==='cafe'?'#e8b9b4':spec.kind==='shop'?'#bdcdaa':'#eee1cb',curtains=[];
      [-1,1].forEach(function(side){
        var pivot=new THREE.Group();pivot.position.set(side*width*.37,height*.93,-.035);room.add(pivot);
        var cloth=windowPart(box(pivot,width*.19,height*.82,.018,mat(curtainColor,false,'paper'),0,-height*.41,0),true);cloth.name='living-window-curtain';
        pivot.userData.side=side;curtains.push(pivot);
      });
      var lamp=new THREE.Group();lamp.name='window-room-hanging-lamp';lamp.position.set(0,height*.69,-.10);room.add(lamp);
      var glowMaterial=ownedWindowMaterial('#fff1cd','#ffd493',.62,false);
      var bulb=windowPart(ball(lamp,glowMaterial,0,0,0,width*.075,height*.052,width*.075),true);bulb.name='window-room-lamp-bulb';
      var shadeGeo=new THREE.ConeGeometry(width*.15,height*.14,12,1,true),shade=windowPart(mesh(shadeGeo,mat('#b79b73',false,'paper'),lamp,0,height*.055,0),true);shade.name='window-room-lamp-shade';
      if(spec.display){
        windowPart(box(room,width*.86,.035,.12,mat('#b98856',false,'wood'),0,height*.25,-.105),false).name='display-window-shelf';
        if(spec.kind==='cafe'){
          var cake=windowPart(cylinder(room,width*.17,height*.10,mat('#b77f50',false,'ceramic'),-width*.16,height*.32,-.105),false);cake.name='cafe-display-cake';
          windowPart(ball(room,mat('#f4e6cf',false,'ceramic'),-width*.16,height*.38,-.105,width*.18,height*.035,width*.16),false);
          windowPart(ball(room,mat('#c9817d',false,'display-flower'),-width*.16,height*.42,-.105,width*.035,height*.025,width*.035),false);
          windowPart(cylinder(room,width*.065,height*.13,mat('#e6ceb0',false,'ceramic'),width*.24,height*.34,-.105),false).name='cafe-display-cup';
        }else{
          for(var jar=0;jar<3;jar++){var x=(jar-1)*width*.23;windowPart(box(room,width*.16,height*.16,.08,mat(jar%2?'#c4d09b':'#d8b08c',false,'ceramic'),x,height*.34,-.105),false).name='market-display-goods';}
        }
      }
      if(!spec.round){
        box(room,.025,height*.86,.035,mat('#c69b69',false,'wood'),0,height*.43,.040).name='living-window-mullion';
        box(room,width*.96,.025,.035,mat('#c69b69',false,'wood'),0,height*.49,.040).name='living-window-crossbar';
      }
      room.userData.phase=phase;
      windowRooms.push({group:room,curtains:curtains,lamp:lamp,backMaterial:backMaterial,glassMaterial:glassMaterial,glowMaterial:glowMaterial,phase:phase});
      return room;
    }
    function animateWindowRooms(frame,reduced) {
      windowRooms.forEach(function(room){
        var wave=reduced?0:Math.sin(frame.time*.62+room.phase),sway=reduced?0:Math.sin(frame.time*.82+room.phase)*.025;
        room.curtains.forEach(function(c){c.rotation.z=sway*c.userData.side;c.updateMatrixWorld(true);});
        room.lamp.rotation.z=reduced?0:Math.sin(frame.time*.47+room.phase)*.018;room.lamp.updateMatrixWorld(true);
        room.backMaterial.emissiveIntensity=.30+wave*.025;room.glassMaterial.emissiveIntensity=.065+wave*.008;room.glowMaterial.emissiveIntensity=.62+wave*.035;
      });
    }

    function shopCottage(g, w, depth, rx, kind) {
      kind=kind||'home';var commercial=kind==='cafe'||kind==='shop',roofPigment=kind==='cafe'?'#929d83':kind==='shop'?'#cb8b7b':'#9b7ab5',roofLight=kind==='cafe'?'#b6bda1':kind==='shop'?'#e4af9e':'#ae8ec5';
      var roofBase=1.54,roofRise=1.06,run=w*.62,profileSteps=32;
      // Keep the shared shop/cafe tile untouched. One nearly tangent face in
      // its smooth normals needs a home-local lighting correction.
      var homeTileGeometry=roofTileGeometry?roofTileGeometry.toNonIndexed():null;
      if(homeTileGeometry){var tp=homeTileGeometry.attributes.position,tn=homeTileGeometry.attributes.normal,corrections=0;
        for(var ti=0;ti<tp.count;ti+=3){var ta=new THREE.Vector3().fromBufferAttribute(tp,ti),tb=new THREE.Vector3().fromBufferAttribute(tp,ti+1),tc=new THREE.Vector3().fromBufferAttribute(tp,ti+2),face=new THREE.Vector3().subVectors(tb,ta).cross(new THREE.Vector3().subVectors(tc,ta)).normalize(),average=new THREE.Vector3();for(var tk=0;tk<3;tk++)average.add(new THREE.Vector3().fromBufferAttribute(tn,ti+tk));if(face.dot(average.normalize())<.05){for(var tj=0;tj<3;tj++)tn.setXYZ(ti+tj,face.x,face.y,face.z);corrections++;}}
        tn.needsUpdate=true;homeTileGeometry.computeBoundingBox();homeTileGeometry.computeBoundingSphere();homeTileGeometry.userData.cottageAdjustedTriangleNormals=corrections;
      }
      function curve(t){return Math.pow(Math.max(0,1-Math.abs(t)),1.35);}
      function profilePoints(half,rise){var points=[];for(var i=0;i<=profileSteps;i++){var t=-1+2*i/profileSteps;points.push([t*half,curve(t)*rise]);}return points;}
      function outline(points){var s=new THREE.Shape();s.moveTo(points[0][0],points[0][1]);for(var i=1;i<points.length;i++)s.lineTo(points[i][0],points[i][1]);s.closePath();return s;}
      function solidProfile(points,thickness,bevel,holes){
        var shape=outline(points);(holes||[]).forEach(function(h){shape.holes.push(h);});
        var geo=new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:!!bevel,bevelThickness:bevel||0,bevelSize:bevel||0,bevelSegments:3,curveSegments:16,steps:1});geo.translate(0,0,-thickness/2);
        if(holes&&holes.length){
          // Extrude's circular-hole seam emits four zero-area triangles.
          // Keep every nonzero face and its original cap/side material group.
          var positions=geo.attributes.position,groups=geo.groups.slice(),indices=[],keptGroups=[],removed=0;
          groups.forEach(function(group){var start=indices.length;for(var i=group.start;i<group.start+group.count;i+=3){
            var a=new THREE.Vector3().fromBufferAttribute(positions,i),b=new THREE.Vector3().fromBufferAttribute(positions,i+1),c=new THREE.Vector3().fromBufferAttribute(positions,i+2);
            if(new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).lengthSq()<1e-20){removed++;continue;}
            indices.push(i,i+1,i+2);
          }keptGroups.push({start:start,count:indices.length-start,materialIndex:group.materialIndex});});
          geo.setIndex(indices);geo.clearGroups();keptGroups.forEach(function(group){geo.addGroup(group.start,group.count,group.materialIndex);});geo.userData.removedZeroAreaTriangles=removed;
        }
        finishGeometry(geo);
        if(holes&&holes.length){
          // Welding across the circular bevel seam can oppose four tiny
          // nonzero faces. Their vertices remain distinct draw indices;
          // retain the real face direction instead of blending across it.
          var p=geo.attributes.position,n=geo.attributes.normal,index=geo.index,normalCorrections=0;
          for(var i=0;i<index.count;i+=3){var ids=[index.getX(i),index.getX(i+1),index.getX(i+2)],a=new THREE.Vector3().fromBufferAttribute(p,ids[0]),b=new THREE.Vector3().fromBufferAttribute(p,ids[1]),c=new THREE.Vector3().fromBufferAttribute(p,ids[2]),face=new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).normalize(),average=new THREE.Vector3();ids.forEach(function(id){average.add(new THREE.Vector3().fromBufferAttribute(n,id));});
            if(face.dot(average.normalize())<0){ids.forEach(function(id){n.setXYZ(id,face.x,face.y,face.z);});normalCorrections++;}
          }
          n.needsUpdate=true;geo.userData.correctedProfileSeamFaceNormals=normalCorrections;
        }
        return geo;
      }
      function archPoints(width,height,base){var half=width/2,spring=height*.62,rise=height-spring,points=[[-half,base],[half,base],[half,base+spring]];for(var i=1;i<=32;i++){var a=Math.PI*i/32;points.push([i===32?-half:Math.cos(a)*half,base+spring+(i===32?0:Math.sin(a)*rise)]);}return points;}
      function archSolid(width,height,base,thickness){return solidProfile(archPoints(width,height,base),thickness,.006);}
      function archRing(width,height,base,innerWidth,innerHeight,innerBase,thickness){var shape=outline(archPoints(width,height,base)),inner=archPoints(innerWidth,innerHeight,innerBase).slice().reverse(),hole=new THREE.Path();hole.moveTo(inner[0][0],inner[0][1]);for(var i=1;i<inner.length;i++)hole.lineTo(inner[i][0],inner[i][1]);hole.closePath();shape.holes.push(hole);var geo=new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:true,bevelThickness:.008,bevelSize:.008,bevelSegments:3,curveSegments:16,steps:1});geo.translate(0,0,-thickness/2);return finishGeometry(geo);}
      function part(geo,color,role,parent,x,y,z,name){var m=mesh(geo,mat(color,false,role),parent,x,y,z);m.name=name;return m;}
      function marked(m){m.userData.door=true;return m;}
      g.userData.homeDesignRevision='shop-cottage-match2';g.userData.doorEntrancePolicyUnchanged=true;
      // Shorter walls and a larger curved, flared roof keep the same footprint
      // and old maximum ridge/overhang envelope, without stretching the actor.
      var small={width:.285,height:.48},frontHoles=[{x:0,base:.13,width:.50,height:1.21}];
      if(commercial)frontHoles.push({x:w*.35,base:.63,width:.285,height:.48});
      var profiles={front:frontHoles,back:[{x:0,base:.66,width:.285,height:.48}],
        left:[commercial?{x:0,base:.36,width:depth*.66,height:.82}:{x:-.02,base:.63,width:.285,height:.48}],
        right:[{x:.02,base:.63,width:.285,height:.48}]};
      wallShell(g,w,1.42,depth,.12,'#f0e4cf',profiles);
      g.userData.solidDimensions={width:w,depth:depth};g.userData.solidLifeRevision=solidLifeRevision;g.userData.buildingTheme=kind;

      var top=profilePoints(run,roofRise),roofOutline=top.slice();
      var roofHoles=[];if(!commercial){var roundHole=new THREE.Path();roundHole.absellipse(0,1.80-roofBase,.128,.128/.9,0,TAU,true);roofHoles.push(roundHole);}
      var roofGeo=solidProfile(roofOutline,depth+.30,.025,roofHoles);
      var roof=mesh(roofGeo,[mat('#f0e4cf',false,'plaster'),mat(roofPigment,false,'ceramic')],g,0,roofBase,0);roof.name='cottage-curved-gable-roof';roof.userData.profileExponent=1.35;
      var fasciaPoints=top.concat(top.slice().reverse().map(function(v){return[v[0],v[1]-.075];})),fasciaGeo=solidProfile(fasciaPoints,.065,.008);
      [-1,1].forEach(function(side){part(fasciaGeo,'#d1aa76','wood',g,0,roofBase,side*(depth/2+.17),'cottage-curved-wood-fascia');});
      var roofRows=4,roofColumns=Math.max(3,Math.ceil((depth+.30)/.30));
      for(var side=-1;side<=1;side+=2)for(var row=0;row<roofRows;row++)for(var col=0;col<roofColumns;col++){
        var f=(row+.45)/roofRows,tz=-depth/2-.12+(col+.5)*(depth+.24)/roofColumns;
        var angle=Math.atan(roofRise/run*1.35*Math.pow(1-f,.35)),tile=mesh(homeTileGeometry||sphereGeometry,mat(row%2?roofPigment:roofLight,false,'ceramic'),g,side*run*f,roofBase+roofRise*curve(f)+.035,tz);
        tile.name='overlapping-round-roof-tile';tile.userData.cottageCurveFollower=true;
        if(homeTileGeometry){tile.scale.set((depth+.30)/roofColumns*.61,.060,run/roofRows*.72);tile.quaternion.setFromAxisAngle(new THREE.Vector3(0,0,1),-side*angle).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-side*Math.PI/2));}
        else{tile.scale.set(run/roofRows*.72,.060,(depth+.30)/roofColumns*.61);tile.rotation.z=-side*angle;}
      }
      var ridge=cylinder(g,.052,depth+.30,mat(roofPigment,false,'ceramic'),0,roofBase+roofRise-.005,0);ridge.rotation.x=Math.PI/2;ridge.name='cottage-closed-rounded-ridge';
      var ridgeCap=ball(g,mat('#d1aa76',false,'wood'),0,roofBase+roofRise-.006,depth/2+.178,.063,.073,.026);ridgeCap.name='cottage-rounded-wood-ridge-cap';
      var capRing=part(new THREE.TorusGeometry(.027,.004,6,24),'#ba8652','wood',g,0,roofBase+roofRise-.006,depth/2+.205,'cottage-ridge-scroll-ring');
      // The front door is an actual arch-shaped solid inside a closed wooden
      // frame with a real opening. UserData.door and the old threshold remain.
      marked(part(archRing(.67,1.39,.10,.50,1.21,.13,.12),'#d1aa76','wood',g,0,0,depth/2-.05,'cottage-arched-door-frame'));
      marked(part(archSolid(.485,1.19,.135,.07),'#ba8652','wood',g,0,0,depth/2-.025,'cottage-arched-door-panel'));
      marked(ball(g,mat('#d1aa76',false,'wood'),-.15,.64,depth/2+.040,.030,.030,.028)).name='cottage-door-left-knob';
      for(var hinge=0;hinge<2;hinge++){var h=marked(cylinder(g,.009,.13,mat('#96673f',false,'wood'),.245,.40+hinge*.51,depth/2+.028));h.name='cottage-door-right-hinge';}
      for(var seam=0;seam<4;seam++){var sx=(seam-1.5)*.095,half=.485/2,spring=.135+1.19*.62,rise=1.19*.38,topY=spring+rise*Math.sqrt(Math.max(0,1-sx*sx/(half*half)))-.035,bottom=.16;
        marked(box(g,.004,topY-bottom,.004,mat('#96673f',false,'wood'),sx,(topY+bottom)/2,depth/2+.012)).name='cottage-door-grain-groove';}
      marked(box(g,.53,.1,.26,mat('#d1aa76',false,'wood'),0,.065,depth/2+.1)).name='cottage-retained-wood-threshold';
      if(!commercial){
        [-1,1].forEach(function(side){
          var roundGroup=new THREE.Group();roundGroup.name=side===1?'cottage-round-gable-window':'cottage-rear-round-gable-window';
          roundGroup.position.set(0,1.80,side*(depth/2+.195));roundGroup.rotation.y=side===1?0:Math.PI;roundGroup.scale.y=1/.9;g.add(roundGroup);
          part(new THREE.TorusGeometry(.142,.025,8,32),'#ba8652','wood',roundGroup,0,0,0,'cottage-round-window-frame');
          windowRoom(roundGroup,{name:'cottage-round-window-room',width:.256,height:.256,base:-.128,z:-.008,round:true,frame:false,kind:kind});
          box(roundGroup,.022,.30,.035,mat('#d1aa76',false,'wood'),0,0,.035);box(roundGroup,.30,.022,.035,mat('#d1aa76',false,'wood'),0,0,.035);
        });
      }else{
        var badge=new THREE.Group();badge.name=kind==='cafe'?'cafe-cup-sign':'market-basket-sign';badge.position.set(0,1.86,depth/2+.20);g.add(badge);
        var backing=cylinder(badge,.20,.065,mat('#b98856',false,'wood'),0,0,0);backing.rotation.x=Math.PI/2;
        var inset=cylinder(badge,.163,.070,mat('#d1aa76',false,'wood'),0,0,.025);inset.rotation.x=Math.PI/2;
        if(kind==='cafe'){
          var cup=cylinder(badge,.065,.075,mat('#f7eedb',false,'ceramic'),0,-.015,.09);cup.name='cafe-sign-cup-volume';
          var handle=part(new THREE.TorusGeometry(.045,.012,6,16),'#f7eedb','ceramic',badge,.065,-.005,.09,'cafe-sign-cup-handle');
          var saucer=ball(badge,mat('#f7eedb',false,'ceramic'),0,-.060,.09,.095,.018,.055);saucer.name='cafe-sign-saucer';
        }else{
          var basket=ball(badge,mat('#b98856',false,'wood'),0,-.025,.09,.10,.065,.045);basket.name='market-sign-basket-volume';
          var handle=part(new THREE.TorusGeometry(.080,.012,6,20),'#ba8652','wood',badge,0,.015,.09,'market-sign-basket-handle');handle.scale.y=.8;
          for(var produce=0;produce<3;produce++)ball(badge,mat(produce%2?'#87a66d':'#d69a7e',false,'display-flower'),(produce-1)*.055,.025,.13,.030,.045,.023);
        }
        windowRoom(g,{name:'commercial-front-window-room',x:w*.35,base:.63,z:depth/2-.048,width:.285,height:.48,kind:kind});
      }
      for(var post=-1;post<=1;post+=2)box(g,.075,1.38,.075,mat('#d1aa76',false,'wood'),post*w*.47,.81,depth/2-.02).name='cottage-round-corner-post';
      box(g,w*1.04,.10,depth*1.04,mat('#d1aa76',false,'wood'),0,1.49,0).name='cottage-eave-beam';
      box(g,w*1.04,.13,depth*1.04,mat('#ba8652',false,'wood'),0,.14,0).name='cottage-low-wood-plinth';
      // The dormer faces diagonally forward so its arched window reads from
      // the normal village view. Its lower solid sinks into the real roof.
      var dormer=new THREE.Group();dormer.name='market-photo-dormer';dormer.position.set(-w*.35,1.90,depth*.05);dormer.rotation.y=-.70;dormer.scale.setScalar(.8);g.add(dormer);
      part(archSolid(.60,.90,-.20,.40),'#f0e4cf','plaster',dormer,0,0,-.03,'cottage-dormer-joined-cream-body');
      part(archRing(.43,.53,.04,.30,.42,.10,.09),'#d1aa76','wood',dormer,0,0,.15,'dormer-arched-frame');
      part(archSolid(.285,.405,.108,.025),'#715d47','glass',dormer,0,0,.17,'cottage-dormer-arched-glass');
      box(dormer,.024,.44,.035,mat('#d1aa76',false,'wood'),0,.31,.190);box(dormer,.32,.024,.035,mat('#d1aa76',false,'wood'),0,.30,.190);
      box(dormer,.48,.075,.16,mat('#ba8652',false,'wood'),0,.04,.13).name='cottage-dormer-rounded-sill';
      // An arch-band hood leaves the arched window visible through its front.
      // The cream body meets the underside; it is not a filled triangle cap.
      var dTop=[];for(var di=0;di<=32;di++){var dt=-1+2*di/32;dTop.push([dt*.31,.30*Math.sqrt(Math.max(0,1-dt*dt))]);}
      var dOutline=dTop.concat(dTop.slice().reverse().map(function(v){return[v[0],v[1]-.065];}));
      part(solidProfile(dOutline,.48,.012),roofPigment,'ceramic',dormer,0,.40,0,'cottage-curved-dormer-roof');
      for(var side=-1;side<=1;side+=2){var hoodY=.40+.30*Math.sqrt(1-Math.pow(.12/.31,2)),hoodAngle=Math.atan(.30*.12/(.31*.31*Math.sqrt(1-Math.pow(.12/.31,2)))),cap=mesh(homeTileGeometry||sphereGeometry,mat(roofLight,false,'ceramic'),dormer,side*.12,hoodY+.016,.025);cap.name='dormer-rounded-cap';cap.scale.set(.26,.027,.13);cap.quaternion.setFromAxisAngle(new THREE.Vector3(0,0,1),-side*hoodAngle).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-side*Math.PI/2));}
      function cottageSideWindow(turn,x,y,z,display){
        var room=windowRoom(g,{name:'all-angle-arched-window',turn:turn,x:x,base:y,z:z,width:display?depth*.66:.285,height:display?.82:.48,kind:kind,display:!!display});
        return room;
      }
      cottageSideWindow(-Math.PI/2,-w/2+.048,commercial?.36:.63,commercial?0:-.02,commercial);
      cottageSideWindow(Math.PI/2,w/2-.048,.63,-.02,false);
      cottageSideWindow(Math.PI,0,.66,-depth/2+.048,false);
      if(commercial){
        var awningRoot=new THREE.Group();awningRoot.name='commercial-side-striped-awning';awningRoot.position.set(-w/2-.045,1.30,0);awningRoot.rotation.y=-Math.PI/2;g.add(awningRoot);
        var awningWidth=depth*.66+.19;
        for(var stripe=0;stripe<7;stripe++){
          var awning=box(awningRoot,awningWidth/7,.075,.35,mat(stripe%2?'#f4e6d0':kind==='cafe'?'#d9a6a3':'#98b090',false,'paper'),(stripe-3)*awningWidth/7,0,.13);awning.rotation.x=.12;
          ball(awningRoot,awning.material,(stripe-3)*awningWidth/7,-.025,.30,awningWidth/14,.055,.04).name='rounded-awning-scallop';
        }
      }
      box(g,.22,.50,.22,mat('#d1aa76',false,'wood'),w*.28,2.23,-.12).name='cottage-short-roof-chimney';
      box(g,.29,.075,.29,mat('#ba8652',false,'wood'),w*.28,2.495,-.12).name='cottage-rounded-chimney-cap';
      // Keep the two saved small yard accents at the same local sites.
      // Retain the already-verified cottage pot recipe and its strict mesh
      // budget; broad rounded planting belongs to the meadow and flowerbeds.
      for(var yard=-1;yard<=1;yard+=2){var px=yard*Math.min(rx*.58,.54),pz=depth/2+.13,pot=mesh(flowerPotGeometry,mat('#f7efdf',false,'ceramic'),g,px,0,pz);pot.scale.set(.09,.17,.0765);pot.name='rounded-ivory-yard-pot';leafBush(g,px,.17,pz,.2,yard,true);daisy(g,px,.2,pz,.85,false,true);box(g,.26,.07,.045,mat('#d1aa76',false,'wood'),yard*rx*.66,.21,.38);for(var fence=-1;fence<=1;fence+=2)box(g,.035,.28,.045,mat('#ba8652',false,'wood'),yard*rx*.66+fence*.1,.14,.38);}
      var entryLamp=new THREE.Group();entryLamp.name='warm-paper-entry-lantern';entryLamp.position.set(-w*.36,1.16,depth/2+.10);g.add(entryLamp);
      box(entryLamp,.085,.13,.075,mat('#fff1d8',false,'paper'),0,0,0);for(var ex=-1;ex<=1;ex+=2)for(var ez=-1;ez<=1;ez+=2)box(entryLamp,.012,.15,.012,mat('#ba8652',false,'wood'),ex*.047,0,ez*.042);
      box(entryLamp,.115,.02,.105,mat('#ba8652',false,'wood'),0,-.075,0);var entryCap=mesh(lanternCapGeometry,mat('#ba8652',false,'wood'),entryLamp,0,.075,0);entryCap.scale.setScalar(.38);entryCap.rotation.y=Math.PI/4;
    }
    // END shop-cottage-match2 local home shell/roof/joinery.
    var landShape = new THREE.Shape();
    landShape.moveTo(-world.width / 200, world.height / 200); landShape.lineTo(world.width / 200, world.height / 200);
    shoreline.forEach(function (row) { landShape.lineTo((row[1] - world.width / 2) / UNIT, -(row[0] - world.height / 2) / UNIT); });
    landShape.lineTo(-world.width / 200, -world.height / 200); landShape.closePath();
    // ShapeGeometry is XY; rotate it into XZ. The shoreline shares the collision model's coordinates.
    var land = mesh(new THREE.ShapeGeometry(landShape), '#b1cf83', group, 0, .025, 0); land.rotation.x = -Math.PI / 2; land.name = 'dry-land'; surfaces.push(land);
    var grassTexture = null, skyMap = null; land.material = mat('#ffffff', false, 'grass'); land.material.userData.seasonRole = 'ground';
    var landVertices = land.geometry.attributes.position, uv = land.geometry.attributes.uv;
    for (var li = 0; li < uv.count; li++) uv.setXY(li, (landVertices.getX(li) + world.width / 200) / (world.width / UNIT), (landVertices.getY(li) + world.height / 200) / (world.height / UNIT));
    uv.needsUpdate = true;
    // The old160-unit sea filled even the upper view with cyan water.
    // Keep the entire28.8x19.2 saved map plus a generous8-unit coast margin wet,
    // while allowing the real sky to appear beyond this finite village horizon.
    var sea = box(group, 48, .06, 48, mat('#abd3cf',false,'water'), 0, -.08, 0); sea.name = 'water';
    var coastMask=coastMaskTexture(THREE,doc);
    if(coastMask){textures.add(coastMask);sea.material.alphaMap=coastMask;sea.material.transparent=true;sea.material.opacity=1;sea.material.depthWrite=false;}
    for (var r = 0; r < 26; r++) {
      var py = (r + .5) / 26 * world.height, bankIndex = Math.min(shoreline.length - 2, Math.floor(py / 500));
      while (bankIndex > 0 && py < shoreline[bankIndex][0]) bankIndex--;
      var a = shoreline[bankIndex], b = shoreline[bankIndex + 1], edge = a[1] + (b[1] - a[1]) * clamp((py - a[0]) / (b[0] - a[0]), 0, 1);
      var rp = groundPoint(world, { x: Math.min(world.width - 25, edge + 40 + r % 3 * 55), y: py });
      var ripple = box(group, .4, .009, .025, '#c6e8dd', rp.x, -.035, rp.z); ripple.userData.baseX = rp.x; ripples.push(ripple);
    }
    var landscape = LayoutArt || globalThis.PetTownLayoutArt;
    var layoutModel = landscape && landscape.revision === 'layout-art-3d1' && typeof landscape.build === 'function' ?
      landscape.build(THREE, world, { group: group, groundPoint: groundPoint, townPoint: townPoint, doorContact: Town.doorContact,
        mesh: mesh, box: box, ball: ball, mat: mat, groundMaterial: land.material, surfaces: surfaces, occluders: occluders }) : null;
    scene.userData.layoutArtRevision = layoutModel ? layoutModel.layoutArtRevision : 'legacy';
    // Synchronous historical previews may call the builder before lazy dependencies.
    // Normal mounts await the complete native layout module.
    if (!layoutModel) {
      var bridgeCenter = groundPoint(world, { x: 2645, y: 1160 });
      var bridge = mesh(new THREE.BoxGeometry(3.3, .14, 1.8), '#c4a171', group, bridgeCenter.x, .12, bridgeCenter.z); bridge.name = 'bridge-deck'; surfaces.push(bridge);
      for (var rail = -1; rail <= 1; rail += 2) { box(group, 3.3, .09, .07, '#a67547', bridgeCenter.x, .8, bridgeCenter.z + rail * .85); }
    }
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
    var junction = layoutModel ? layoutModel.junction : { x: world.width * .48, y: world.height * .64 };
    world.places.forEach(function (p, index) {
      buildingGeometry=['home','cafe','shop'].indexOf(p.id)>=0;
      var ground = groundPoint(world, p.footprint), g = new THREE.Group(); g.name = 'place-' + p.id; g.userData.placeId = p.id;
      g.position.set(ground.x, .025, ground.z); group.add(g); placeGroups.push(g);
      var rx = p.footprint.rx / UNIT, rz = p.footprint.ry / UNIT;
      if (p.id === 'tree') {
        softTree(g, .4, 1.08);
      } else if (p.id === 'flowers') {
        flowerBed(g, .4);
      } else if (p.id === 'playground') {
        var fountain=new THREE.Group();fountain.name='market-photo-fountain';g.add(fountain);
        // Authored fountain pigments bypass the coarse shared palette bands:
        // its muted lavender/cream must not inherit the house roof's brighter glaze.
        var fountainFinishes={};
        function fountainFinish(color,role,transparent){
          var key=color+':'+role+':'+!!transparent;
          if(!fountainFinishes[key]){
            var m=mat(color,!!transparent,role).clone();m.color.set(color);
            m.roughness=role==='water'?.20:role==='glaze'?.30:.62;m.metalness=0;
            m.bumpScale=role==='glaze'?.003:role==='water'?0:.010;
            m.userData.baseColor=color;m.userData.paletteColor=color;m.userData.paletteRole='identity';
            m.userData.fountainReferenceFinish=true;
            if(transparent){m.opacity=.38;m.depthWrite=false;}
            materials.add(m);fountainFinishes[key]=m;
          }
          return fountainFinishes[key];
        }
        var foot=cylinder(fountain,.40,.12,[fountainFinish('#ad9bb7','glaze',false),fountainFinish('#c6ad76','ceramic',false),fountainFinish('#c6ad76','ceramic',false)],0,.06,0);foot.scale.z*=.78;foot.name='fountain-foot';
        function bowl(name,xz,height,y){
          var m=mesh(bowlGeometry||sphereGeometry,fountainFinish('#d6c4a3','ceramic',false),fountain,0,y,0);m.name=name;m.scale.set(xz,height,xz*.75);return m;
        }
        bowl('fountain-lower-bowl',.74,.42,.12);
        bowl('fountain-upper-bowl',.37,.27,.77);
        [[.74,.42,.12,12,'lower'],[.37,.27,.77,8,'upper']].forEach(function(tier){var tierGroup=new THREE.Group();tierGroup.position.y=tier[2];tierGroup.scale.set(tier[0],tier[1],tier[0]*.75);fountain.add(tierGroup);for(var pi=0;pi<tier[3];pi++){var panel=mesh(panelGeometry,fountainFinish('#e3d4b8','ceramic',false),tierGroup,0,0,0);panel.rotation.y=(pi+.5)*TAU/tier[3];panel.name='fountain-raised-petal-panel';panel.userData.bowlTier=tier[4];}});

        function rim(radius,y){var m=mesh(new THREE.TorusGeometry(radius,.026,6,32),fountainFinish('#ad9bb7','glaze',false),fountain,0,y,0);m.rotation.x=-Math.PI/2;m.scale.y=.75;m.name='lilac-glazed-fountain-rim';return m;}
        rim(.704,.536);rim(.352,1.038);
        cylinder(fountain,.105,.43,fountainFinish('#d6c4a3','ceramic',false),0,.66,0);
        var lowerWater=cylinder(fountain,.61,.012,fountainFinish('#dce4df','water',true),0,.469,0);lowerWater.scale.z*=.75;lowerWater.name='fountain-lower-water';
        var upperWater=cylinder(fountain,.28,.012,fountainFinish('#dce4df','water',true),0,.995,0);upperWater.scale.z*=.75;upperWater.name='fountain-upper-water';
        for(var stream=0;stream<8;stream++){
          var angle=(stream+.5)*TAU/8,start=new THREE.Vector3(Math.sin(angle)*.315,1.01,Math.cos(angle)*.236),end=new THREE.Vector3(Math.sin(angle)*.55,.48,Math.cos(angle)*.412);
          var delta=end.clone().sub(start),cascade=mesh(branchGeometry||cylinderGeometry,fountainFinish('#eef1e7','water',true),fountain,start.x,start.y,start.z);cascade.name='fountain-cascade';cascade.material.opacity=.42;cascade.material.depthWrite=false;cascade.scale.set(.009,delta.length(),.009);cascade.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
          var droplet=ball(fountain,fountainFinish('#eef1e7','water',true),start.x,start.y,start.z,.018,.045,.018);droplet.userData.phase=stream/8;droplet.userData.cascade={start:start,end:end};droplets.push(droplet);
        }
        var jet=ball(fountain,fountainFinish('#eef1e7','water',true),0,1.075,0,.045,.10,.045);jet.name='fountain-top-jet';
        var waterAPI=WaterLife||globalThis.PetTownWaterLife;if(waterAPI&&waterAPI.revision==='fountain-water-life1')waterLife=waterAPI.create(THREE,{fountain:fountain,materials:materials,geometries:geometries});
      } else {
        // The solid base is inscribed in the existing elliptical footprint; roofs can overhang above the pet.
        var cafe = p.id === 'cafe' || p.shopId === 'cafe', market = p.id === 'shop' || p.shopId && !cafe;
        var dimensions=Town.solidDimensions?Town.solidDimensions(p):{width:rx*2.05,depth:rz*2.0};
        var w = dimensions.width, depth = dimensions.depth, funding = p.status === 'funding' || p.status === 'building';
        box(g, w, .13, depth, '#d0af80', 0, .065, 0);
        if (funding) {
          for (var sx = -1; sx <= 1; sx += 2) for (var sz = -1; sz <= 1; sz += 2) box(g, .08, .6, .08, '#b38657', sx * w / 2, .3, sz * depth / 2);
          box(g, w, .17, .06, '#d8bd95', 0, .45, depth / 2);
        } else {
          shopCottage(g,w,depth,rx,cafe?'cafe':market?'shop':'home');
        }
        if (doc && doc.createElement && funding) {
          var signCanvas = doc.createElement('canvas'); signCanvas.width = 256; signCanvas.height = 64; var signContext = signCanvas.getContext && signCanvas.getContext('2d');
          if (signContext) { var signBacking=box(g,funding?1.10:.84,funding?.29:.23,.055,mat('#b98856',false,'wood'),0,funding?.7:1.67,depth/2+.095);signBacking.name='rounded-wood-sign-backing';signContext.fillStyle = '#f5e9d6'; signContext.fillRect(0, 0, 256, 64); signContext.fillStyle = '#526449'; signContext.font = '500 28px sans-serif'; signContext.textAlign = 'center'; signContext.fillText(p.label + (funding ? p.status === 'building' ? '・建設中' : '・予定地' : ''), 128, 42, 244);
            var signTexture = new THREE.CanvasTexture(signCanvas); signTexture.colorSpace = THREE.SRGBColorSpace; textures.add(signTexture); var signMaterial = new THREE.MeshBasicMaterial({ map: signTexture }); materials.add(signMaterial); mesh(new THREE.PlaneGeometry(funding ? 1.05 : .78, funding ? .26 : .2), signMaterial, g, 0, funding ? .7 : 1.67, depth / 2 + .13); }
        }
        g.scale.y = .9;
        if (!layoutModel) road(p.entrance, junction);
      }
      solid(g, p); buildingGeometry=false;
      if(originalArt && (p.id==='tree'||p.id==='flowers')){
        g.traverse(function(o){if(o.isSprite){o.userData.placeId=p.id;pickables.push(o);}});
      }
    });
    // Existing lantern/flower accents become separate objects, not a tilted background image.
    [[31, 32], [64, 32], [31, 72], [64, 72]].forEach(function (v) {
      var p = groundPoint(world, { x: v[0] / 100 * world.width, y: v[1] / 100 * world.height });
      var lamp = new THREE.Group();lamp.name='collection-garden-lantern'; lamp.position.set(p.x, .025, p.z); group.add(lamp);
      if(originalArt){originalSprite('lantern',lamp,.95,0,0,0);return;}
      cylinder(lamp,.08,.07,mat('#ded3bf',false,'stone'),0,.035,0);ball(lamp,mat('#ded3bf',false,'stone'),0,.085,0,.075,.035,.075);
      cylinder(lamp,.026,1.12,mat('#a8754d',false,'wood'),0,.63,0);
      var bracket=new THREE.TorusGeometry(.12,.014,6,14,Math.PI),arm=mesh(bracket,mat('#a8754d',false,'wood'),lamp,.1,1.23,0);arm.rotation.z=-Math.PI/2;
      var head=new THREE.Group();head.name='warm-paper-lantern-head';head.position.set(.21,1.13,0);lamp.add(head);
      var paper=box(head,.17,.22,.15,mat('#fff1d8',false,'paper'),0,0,0);paper.name='ivory-lantern-paper';paper.material.emissive.set('#fff1d8');paper.material.emissiveIntensity=.10;
      for(var lx=-1;lx<=1;lx+=2)for(var lz=-1;lz<=1;lz+=2)box(head,.018,.25,.018,mat('#a8754d',false,'wood'),lx*.10,0,lz*.09);
      box(head,.23,.03,.21,mat('#a8754d',false,'wood'),0,-.13,0);box(head,.23,.025,.21,mat('#a8754d',false,'wood'),0,.125,0);
      var cap=mesh(lanternCapGeometry,mat('#a8754d',false,'wood'),head,0,.14,0);cap.rotation.y=Math.PI/4;cap.name='flared-wood-lantern-cap';ball(head,mat('#825b3e',false,'wood'),0,.26,0,.025,.025,.025);
    });
    for (var flower = 0; flower < 65; flower++) {
      var fp = { x: 80 + flower % 13 * 193 + Math.sin(flower * 7.3) * 48, y: 110 + Math.floor(flower / 13) * 353 + Math.cos(flower * 3.1) * 64 };
      // The new paved oval is a clear walking surface; keep old meadow scatter
      // on grass rather than growing through its solid cream paving.
      if (layoutModel) {
        var plazaDx = (fp.x - layoutModel.plazaPoint.x) / (layoutModel.plazaRadii.x * UNIT + 30);
        var plazaDy = (fp.y - layoutModel.plazaPoint.y) / (layoutModel.plazaRadii.z * UNIT + 30);
        if (plazaDx * plazaDx + plazaDy * plazaDy <= 1) continue;
      }
      if (!Town.isWalkable(world, fp.x, fp.y) || world.places.some(function (p) { return Math.hypot(p.x - fp.x, p.y - fp.y) < (originalArt?225:155); })) continue;
      var fpos = groundPoint(world, fp); if (flower % 4 === 0) seasonalSites.push(fpos);
      if (flower % 5 === 0) {
        var bed = flowerBed(group, flower * .71); bed.position.set(fpos.x, .026, fpos.z); bed.rotation.y = flower * 1.7;
        bed.scale.setScalar(.85 + flower % 3 * .12); bed.name = 'clustered-meadow-flowerbed';
      } else {
        var clump = new THREE.Group(); clump.name = 'low-rounded-ground-planting'; clump.position.set(fpos.x, .026, fpos.z); group.add(clump);
        leafBush(clump, 0, 0, 0, .13 + flower % 3 * .025, flower);
        if (flower % 7 === 0) daisy(clump, .05, 0, .02, .48, false);
      }
    }
    // Unreachable border planting and low distant hills avoid a bare horizon.
    for (var edgeTree = 0; edgeTree < 26; edgeTree++) {
      var ex = edgeTree < 13 ? -world.width / 200 - .45 : -world.width / 200 + (edgeTree - 13) * 1.55, ez = edgeTree < 13 ? -world.height / 200 + edgeTree * 1.55 : -world.height / 200 - .45;
      var edgeGroup = new THREE.Group(); edgeGroup.position.set(ex + Math.sin(edgeTree * 2.7) * .4, .025, ez + Math.cos(edgeTree * 1.7) * .4); group.add(edgeGroup);
      var treeScale = .75 + (edgeTree * 7 % 9) * .055; softTree(edgeGroup, edgeTree * 2.4, treeScale);
      if (edgeTree % 2) { leafBush(group, ex + .5, .025, ez + .5, .6, edgeTree); for (var edgeFlower = 0; edgeFlower < 3; edgeFlower++) daisy(group, ex + .25 + edgeFlower * .2, .026, ez + .85, .85, false); }
    }
    // Low smoothly rounded distant mounds leave a real view of the sky.
    // They stay outside the saved walkable map and never enter the collision set.
    var hillGeometry = finishGeometry(new THREE.SphereGeometry(1, 32, 16));
    function distantHill(color,x,y,z,sx,sy,sz) {
      var m=mesh(hillGeometry,mat(color,false,'foliage'),group,x,y,z);
      m.scale.set(sx,sy,sz);m.name='distant-rounded-hill';return m;
    }
    for (var hill = 0; hill < 7; hill++) {
      distantHill(hill % 2 ? '#b0ceac' : '#c4dbb9', -16 + hill * 5, -.6, -14.5, 3.2, 1.4, 3.2);
      if (hill < 5) distantHill('#bad4b1', -16 + hill * 4.5, -.7, 14.5, 3, 1.3, 3);
    }
    // Small, solid seasonal accents share this village's positions. They are
    // decorative only: never added to walking surfaces, saved layouts or doors.
    ['spring', 'summer', 'autumn', 'winter'].forEach(function (key) {
      var decor = new THREE.Group(); decor.name = 'season-' + key + '-accents'; decor.userData.seasonRole = key; decor.visible = false;
      scene.add(decor); seasonGroups[key] = decor;
      seasonalSites.slice(0, 8).forEach(function (p, i) {
        if (key === 'spring') {
          cylinder(decor, .012, .18, '#82aa68', p.x, .115, p.z).name = 'spring-blossom-stem';
          for (var b = 0; b < 5; b++) {
            var a = b * TAU / 5, petal = mesh(flowerPetalGeometry,mat('#f4c5d4',false,'flower'),decor,p.x+Math.sin(a)*.08,.20,p.z+Math.cos(a)*.08);petal.scale.set(.065,.07,.095);
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
        } else if(role==='accent'&&palette.accents){m.color.set(palette.accents[m.userData.seasonIndex||0]);} else if (role === 'flower' && palette.flowers) m.color.set(palette.flowers[base === '#edc0c1' ? 0 : 1]);
      });
      Object.keys(seasonGroups).forEach(function (k) { seasonGroups[k].visible = k === key; });
      var nextSky = skyTexture(THREE, doc, palette);
      if (nextSky) {
        textures.add(nextSky);
        // Retain the older isolated previews' background.set(color) operation.
        // That explicit request selects their flat background; the game itself
        // keeps the authored gradient until its next actual season transition.
        nextSky.set = function (color) { scene.background = new THREE.Color(color); return scene.background; };
      }
      scene.background = nextSky || new THREE.Color(palette.sky);
      if (skyMap) { textures.delete(skyMap); skyMap.dispose(); }
      skyMap = nextSky;
      activeSeason = key; scene.userData.season = key;
      scene.updateMatrixWorld(true);
      return true;
    }
    // A clear finite village needs no white fog wash over the character's colors.
    scene.background = new THREE.Color('#cbe7e8'); scene.fog = null;
    setSeason(seasonKey || 'summer');
    var light=style&&style.collection?style.collection.light:{hemisphereSky:'#fffaf4',hemisphereGround:'#ddd4c8',hemisphereIntensity:1.45,sunColor:'#fff9f0',sunIntensity:2.2};
    scene.add(new THREE.HemisphereLight(light.hemisphereSky,light.hemisphereGround,light.hemisphereIntensity));
    var sun = new THREE.DirectionalLight(light.sunColor,light.sunIntensity); sun.position.set(-7, 12, 8); sun.castShadow = true; sun.shadow.mapSize.set(512, 512); sun.shadow.radius = 3;
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 12, bottom: -12, near: .1, far: 45 }); sun.shadow.normalBias = .04; scene.add(sun);
    // Batch repeated primitives by material and neighborhood. Keep the original
    // meshes only as exact picking/camera collision targets; never draw them twice.
    scene.updateMatrixWorld(true);
    var buckets = {}, batches = seasonBatches.slice(), originals = [];
    group.traverse(function (m) { if (!m.isMesh || !m.visible || m.userData.noStaticBatch) return; var cell = Math.floor(m.matrixWorld.elements[12] / 5) + ':' + Math.floor(m.matrixWorld.elements[14] / 5);
      var key = m.geometry.uuid + ':' + m.material.uuid + ':' + cell; (buckets[key] || (buckets[key] = [])).push(m); });
    Object.keys(buckets).forEach(function (key) {
      var rows = buckets[key]; if (rows.length < 2) return;
      var batch = new THREE.InstancedMesh(rows[0].geometry, rows[0].material, rows.length), dynamic = rows.some(function (m) { for (var p = m; p && p !== group; p = p.parent) if (trees.indexOf(p) >= 0 || ripples.indexOf(p) >= 0 || droplets.indexOf(p) >= 0) return true; return false; });
      batch.name = 'town-detail-batch'; batch.castShadow = rows.some(function (m) { return m.castShadow; }); batch.receiveShadow = rows.some(function (m) { return m.receiveShadow; });
      rows.forEach(function (m, i) { batch.setMatrixAt(i, m.matrixWorld); m.visible = false; originals.push(m); }); batch.computeBoundingSphere(); if (dynamic) batch.boundingSphere.radius += .75; scene.add(batch); batches.push({ mesh: batch, rows: rows, dynamic: dynamic });
    });
    scene.updateMatrixWorld(true); scene.matrixWorldAutoUpdate = false;
    function animate(ms, reduced) {
      var frame = natureFrame(ms, reduced);
      animateWindowRooms(frame,reduced);if(waterLife)waterLife.animate(ms,reduced);
      trees.forEach(function (g, i) { g.rotation.z = frame.wind * Math.cos(i * 1.7); g.updateMatrixWorld(true); });
      ripples.forEach(function (m, i) { m.position.x = m.userData.baseX + (reduced ? 0 : Math.sin(frame.time * 1.1 + i) * .07); m.updateMatrixWorld(true); });
      droplets.forEach(function (m) { var a = reduced ? m.userData.phase : (frame.fountain + m.userData.phase) % 1; if(m.userData.cascade)m.position.lerpVectors(m.userData.cascade.start,m.userData.cascade.end,a);else m.position.set(Math.sin(a * TAU) * .2, .48 + Math.sin(a * Math.PI) * .65, Math.cos(a * TAU) * .15); m.updateMatrixWorld(true); });
      batches.forEach(function (b) { if (b.dynamic) { b.rows.forEach(function (m, i) { b.mesh.setMatrixAt(i, m.matrixWorld); }); b.mesh.instanceMatrix.needsUpdate = true; } });
      return frame;
    }
    function dispose() { if (disposed) return; disposed = true; if(originalArt)originalArt.dispose(); batches.forEach(function (b) { b.mesh.dispose(); }); geometries.forEach(function (g) { g.dispose(); }); materials.forEach(function (m) { m.dispose(); }); textures.forEach(function (t) { t.dispose(); }); sun.shadow.dispose(); scene.clear(); }
    return { scene: scene, surfaces: surfaces, occluders: occluders, pickables: pickables, placeGroups: placeGroups, solidLifeRevision:solidLifeRevision, windowRooms:windowRooms, windowLifeMaterials:windowLifeMaterials, waterLife:waterLife, animate: animate, dispose: dispose,
      loadOriginalArt:loadOriginalArt, originalHit:originalHit, originalDoorHit:originalDoorHit, originalArt:originalArt, setSeason: setSeason, seasonGroups: seasonGroups, styleLimits: style ? style.limits : null, layoutArtRevision: scene.userData.layoutArtRevision,
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
      if (host) { host.dataset.visualMode = 'flat'; delete host.dataset.townCamera; delete host.dataset.fishingPhase; delete host.dataset.townSeason; delete host.dataset.townSeasonDate; delete host.dataset.townStyle; delete host.dataset.townLayoutArt; delete host.dataset.townOriginalArt; delete host.dataset.townSolidLife; }
    }
    function fail(code) { if (dead || failed) return; failed = true; destroy(); report('onFailure', code); }
    var THREE;
    try { var dependencies = await Promise.all([options.three || loadThree(), loadFrameFit(), loadSeasons(), loadStyle(), loadLayoutArt(), loadOriginals(), loadWaterLife()]); THREE = dependencies[0]; } catch (_) { fail('town_module_unavailable'); return null; }
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
          if (hit.object !== sprite) return model.originalHit(hit);
          if (!sourceCoverage || !hit.uv) return true;
          var x = Math.max(0, Math.min(sourceCoverage.width - 1, Math.floor(hit.uv.x * sourceCoverage.width)));
          var y = Math.max(0, Math.min(sourceCoverage.height - 1, Math.floor(hit.uv.y * sourceCoverage.height)));
          return sourceCoverage.pixels[(y * sourceCoverage.width + x) * 4 + 3] >= 31;
        });
        if (!hits.length) return null;
        var hit = hits[0]; if (hit.object === sprite) return { pet: true };
        var id = hit.object.userData.placeId;
        if (id) return model.originalDoorHit(hit) ? { placeId: id, door: true } : { placeId: id };
        var p = townPoint(world, hit.point); return Town.isWalkable(world, p.x, p.y) ? p : null;
      }
    };
    try {
      var seasonNow = typeof options.seasonNow === 'function' ? options.seasonNow : Date.now, firstSeason = null;
      try { firstSeason = Seasons.resolve(seasonNow()); } catch (_) {}
      model = buildWorld(THREE, world, options.view, position, doc, firstSeason ? firstSeason.key : 'summer');
      await model.loadOriginalArt();
      if(!active()){destroy();return null;}
      host.dataset.townOriginalArt=model.scene.userData.originalArtRevision;host.dataset.townSolidLife=model.solidLifeRevision;
      host.dataset.townStyle = model.styleLimits ? 'shop-cottage-match2' : 'legacy';
      host.dataset.townLayoutArt = model.layoutArtRevision;
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
    cameraDirection: cameraDirection, facingFrame: facingFrame, cameraDistance: cameraDistance, safeCamera: safeCamera, natureFrame: natureFrame, people: people, alphaAnchor: alphaAnchor, sourceSize: sourceSize, groundTexture: groundTexture, skyTexture: skyTexture, heightAt: heightAt });
}));

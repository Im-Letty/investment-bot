/* Manual ocean exploration only. No ownership, currency, rewards or pet-save writes. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pet-town-walk.js'), require('./pet-ocean-discoveries.js'));
  else root.PetOceanSnorkeling = factory(root.PetTownWalk, root.PetOceanDiscoveries);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (DefaultTown, Discoveries) {
  'use strict';
  var SPEED = 135, DEPTH = 1.15, DEPTH_SPEED = 1.5, STEP = 4, ENTRY_REACH = 45, RETURN_RADIUS = 85;
  var contexts = new WeakMap();
  function finite(n) { return typeof n === 'number' && Number.isFinite(n); }
  function point(p) { return !!p && finite(p.x) && finite(p.y); }
  function copy(p) { return p ? { x: p.x, y: p.y } : null; }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function clone(value) { return value == null ? null : JSON.parse(JSON.stringify(value)); }
  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function coastX(y) { return Discoveries && typeof Discoveries.coastX === 'function' ? Discoveries.coastX(y) : NaN; }
  function inSea(h, p) { return point(p) && p.x >= h.seaBounds.minX && p.x <= h.seaBounds.maxX && p.y >= h.seaBounds.minY && p.y <= h.seaBounds.maxY; }
  function blocked(h, p) {
    return h.blocked.some(function (r) { return p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY; });
  }
  function firstSolid(h, from, to) {
    var first = Infinity;
    h.blocked.forEach(function (r) {
      var low = 0, high = 1;
      ['x', 'y'].forEach(function (axis) {
        var delta = to[axis] - from[axis], min = r[axis === 'x' ? 'minX' : 'minY'], max = r[axis === 'x' ? 'maxX' : 'maxY'];
        if (delta === 0) { if (from[axis] < min || from[axis] > max) high = -1; return; }
        var a = (min - from[axis]) / delta, b = (max - from[axis]) / delta;
        low = Math.max(low, Math.min(a, b)); high = Math.min(high, Math.max(a, b));
      });
      if (low <= high && high >= 0 && low <= 1) first = Math.min(first, Math.max(0, low));
    });
    return first;
  }
  function isWater(h, p, y) {
    if (finite(p)) p = { x: p, y: y };
    if (!h || !contexts.has(h) || !inSea(h, p) || !Discoveries || !Discoveries.isWater(p) || blocked(h, p)) return false;
    var c = contexts.get(h);
    try { return !c.Town.isWalkable(c.world, p.x, p.y); } catch (_) { return false; }
  }
  function transitionClear(h, from, to) {
    if (!point(from) || !point(to) || distance(from, to) > 260 || firstSolid(h, from, to) <= 1) return false;
    var n = Math.max(1, Math.ceil(distance(from, to) / STEP));
    for (var i = 0; i <= n; i++) {
      var t = i / n, p = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      if (!inSea(h, p) || blocked(h, p)) return false;
    }
    return true;
  }
  function createHabitat(world, Town) {
    Town = Town || DefaultTown;
    if (!world || !finite(world.width) || !finite(world.height) || world.width <= 0 || world.height <= 0 || !Array.isArray(world.places) ||
        !Town || typeof Town.isWalkable !== 'function' || typeof Town.route !== 'function' || typeof Town.spawn !== 'function' || !Discoveries) return null;
    var h = { version: 1, id: 'southeast-ocean', minY: 1500, maxY: 1830, near: 85, far: 650,
      seaBounds: { minX: world.width / 2 - 2400, maxX: world.width / 2 + 2400, minY: world.height / 2 - 2400, maxY: world.height / 2 + 2400 },
      blocked: [], entry: null, creatures: [] };
    try {
      world.places.forEach(function (place) {
        var r = typeof Town.collisionBounds === 'function' ? Town.collisionBounds(place) : null, f = place && place.footprint;
        if (!r && f && point(f) && finite(f.rx) && finite(f.ry)) r = { minX: f.x - f.rx, maxX: f.x + f.rx, minY: f.y - f.ry, maxY: f.y + f.ry };
        if (r && [r.minX, r.maxX, r.minY, r.maxY].every(finite)) h.blocked.push({ minX: r.minX - 18, maxX: r.maxX + 18, minY: r.minY - 18, maxY: r.maxY + 18 });
      });
      contexts.set(h, { world: world, Town: Town });
      var spawn = Town.spawn(world), ys = [1730];
      for (var y = 1600; y <= 1810; y += 15) if (y !== 1730) ys.push(y);
      if (!point(spawn) || !Town.isWalkable(world, spawn.x, spawn.y)) return null;
      for (var k = 0; k < ys.length; k++) {
        var dry = { x: coastX(ys[k]) - 60, y: ys[k] }, water = { x: coastX(ys[k]) + 110, y: ys[k] };
        if (!Town.isWalkable(world, dry.x, dry.y) || !isWater(h, water) || !transitionClear(h, dry, water)) continue;
        var route = Town.route(world, spawn, dry);
        if (!Array.isArray(route) || !route.length || !route.every(point) || distance(route[route.length - 1], dry) > .01) continue;
        if (!route.every(function (p) { return Town.isWalkable(world, p.x, p.y); })) continue;
        h.entry = { dry: dry, water: water, reach: ENTRY_REACH, returnRadius: RETURN_RADIUS };
        break;
      }
      if (!h.entry) { contexts.delete(h); return null; }
      h.creatures = Discoveries.encounters.filter(function (row) { return row && isWater(h, row.position); }).map(clone);
      return h;
    } catch (_) { contexts.delete(h); return null; }
  }
  function entryPoint(h) { return h && h.entry ? copy(h.entry.dry) : null; }
  function creatures(h) { return h && Array.isArray(h.creatures) ? clone(h.creatures) : []; }
  function nearestDiscovery(h, p, mode, depth) {
    if (!isWater(h, p) || !Discoveries || typeof Discoveries.nearest !== 'function') return null;
    var found = Discoveries.nearest(p, mode, depth);
    return found && h.creatures.some(function (row) { return row.id === found.id; }) ? clone(found) : null;
  }
  function sweep(h, from, to) {
    if (!isWater(h, from) || !point(to) || distance(from, to) > 16384) return copy(from);
    var contact = firstSolid(h, from, to);
    if (contact <= 1) { var ratio = Math.max(0, contact - 1e-8); to = { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio }; }
    var n = Math.max(1, Math.ceil(distance(from, to) / STEP)), last = copy(from);
    for (var i = 1; i <= n; i++) {
      var t = i / n, p = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      if (!isWater(h, p)) break;
      last = p;
    }
    return last;
  }
  function create(options) {
    options = options || {};
    var Town = options.Town || DefaultTown, world = options.world || (Town && Town.createWorld && Town.createWorld()), h = options.habitat || createHabitat(world, Town);
    var viewport = options.viewport, doc = options.document || viewport && viewport.ownerDocument, win = options.window || doc && doc.defaultView;
    var mode = 'dry', phase = 'dry', position = null, depth = 0, depthGoal = 0, entry = h && clone(h.entry), destination = null, returning = false, transition = null;
    var keys = {}, pointer = null, dead = false, raf = null, lastFrame = null, clock = 0, lastNotice = -Infinity, dx = 0, dy = 0, removers = [];
    function active() {
      if (dead || !h || !entry || doc && doc.hidden || viewport && viewport.isConnected === false) return false;
      try { return typeof options.canRun !== 'function' || !!options.canRun(); } catch (_) { return false; }
    }
    function snapshot() {
      return { mode: mode, phase: phase, position: copy(position), depth: depth, moving: !!(dx || dy || transition && !transition.paused),
        dx: dx, dy: dy, entry: clone(entry), destination: copy(destination), returning: returning,
        transitionPaused: !!(transition && transition.paused), discovery: nearestDiscovery(h, position, mode, depth) };
    }
    function notify(force) {
      if (dead || !force && clock - lastNotice < 1000 / 30) return;
      lastNotice = clock;
      if (typeof options.onChange === 'function') try { options.onChange(snapshot()); } catch (_) {}
    }
    function cancelFrame() { if (raf !== null && win && win.cancelAnimationFrame) win.cancelAnimationFrame(raf); raf = null; lastFrame = null; }
    function stop() {
      keys = {}; pointer = null; destination = null; returning = false; dx = 0; dy = 0; depthGoal = depth;
      if (transition) transition.paused = true;
      cancelFrame(); notify(true);
    }
    function work() { return transition && !transition.paused || Object.keys(keys).length || destination || Math.abs(depthGoal - depth) > .0001; }
    function schedule() {
      if (dead || raf !== null || !active() || !work() || !win || typeof win.requestAnimationFrame !== 'function') return;
      raf = win.requestAnimationFrame(function (ms) {
        raf = null;
        if (!active()) { stop(); return; }
        if (lastFrame === null) lastFrame = ms;
        var dt = finite(ms) ? clamp(ms - lastFrame, 0, 50) : 0; lastFrame = finite(ms) ? ms : null;
        step(dt); schedule();
      });
    }
    function beginTransition(target, exiting) {
      if (!transitionClear(h, position, target)) return false;
      transition = { from: copy(position), to: copy(target), elapsed: 0, duration: Math.max(300, distance(position, target) / 210 * 1000), paused: false, exiting: exiting };
      destination = null; keys = {}; returning = false; mode = 'surface'; phase = exiting ? 'exiting' : 'entering'; depthGoal = 0;
      dx = 0; dy = 0; notify(true); schedule(); return true;
    }
    function enter(dryPosition) {
      if (!active()) return false;
      if (transition && phase === 'entering') { transition.paused = false; notify(true); schedule(); return true; }
      if (mode !== 'dry' || !point(dryPosition) || distance(dryPosition, h.entry.dry) > ENTRY_REACH) return false;
      try { if (!Town.isWalkable(world, dryPosition.x, dryPosition.y)) return false; } catch (_) { return false; }
      if (!transitionClear(h, dryPosition, h.entry.water)) return false;
      entry = clone(h.entry); entry.dry = copy(dryPosition); position = copy(dryPosition); depth = 0; depthGoal = 0;
      return beginTransition(entry.water, false);
    }
    function dive() {
      if (!active() || mode === 'dry' || transition || !isWater(h, position)) return false;
      keys = {}; destination = null; returning = false; dx = dy = 0; mode = phase = 'underwater'; depthGoal = DEPTH; notify(true); schedule(); return true;
    }
    function surface() {
      if (!active() || mode === 'dry' || transition || !isWater(h, position)) return false;
      mode = phase = 'surface'; depthGoal = 0; notify(true); schedule(); return true;
    }
    function goTo(p) {
      if (!active() || mode === 'dry' || transition || !isWater(h, p)) return false;
      keys = {}; pointer = null; returning = false; destination = copy(p); dx = dy = 0; notify(true); schedule(); return true;
    }
    function exit() {
      if (!active() || mode === 'dry' || !position) return false;
      if (transition) return beginTransition(entry.dry, true);
      if (!isWater(h, position)) return false;
      keys = {}; mode = phase = 'surface'; depthGoal = 0; returning = true; destination = copy(entry.water); dx = dy = 0;
      if (distance(position, entry.water) <= .5) return beginTransition(entry.dry, true);
      notify(true); schedule(); return true;
    }
    function vector() {
      var x = 0, y = 0;
      Object.keys(keys).forEach(function (key) { x += keys[key].x; y += keys[key].y; });
      if ((x || y) && typeof options.projectDirection === 'function') {
        try { var p = options.projectDirection(x, y); if (!point(p)) return null; x = p.x; y = p.y; } catch (_) { return null; }
      }
      if (!x && !y && destination) { x = destination.x - position.x; y = destination.y - position.y; }
      var length = Math.hypot(x, y);
      return length ? { x: x / length, y: y / length, distance: destination && !Object.keys(keys).length ? length : Infinity } : null;
    }
    function step(ms) {
      if (!finite(ms) || ms < 0 || dead) return snapshot();
      if (!active()) { stop(); return snapshot(); }
      if (ms === 0) return snapshot();
      var dt = Math.min(50, ms); clock += dt; dx = dy = 0;
      if (transition && !transition.paused) {
        transition.elapsed = Math.min(transition.duration, transition.elapsed + dt);
        var t = transition.elapsed / transition.duration;
        position = { x: transition.from.x + (transition.to.x - transition.from.x) * t, y: transition.from.y + (transition.to.y - transition.from.y) * t };
        var len = distance(transition.from, transition.to); dx = len ? (transition.to.x - transition.from.x) / len : 0; dy = len ? (transition.to.y - transition.from.y) / len : 0;
        if (t >= 1) {
          var exited = transition.exiting; transition = null; dx = dy = 0;
          if (exited) {
            mode = phase = 'dry'; depth = depthGoal = 0; notify(true);
            if (typeof options.onExit === 'function') try { options.onExit(copy(position)); } catch (_) {}
          } else { mode = phase = 'surface'; notify(true); }
        }
      } else if (!transition && mode !== 'dry') {
        var direction = vector();
        if (direction) {
          var travel = Math.min(SPEED * dt / 1000, direction.distance), next = sweep(h, position, { x: position.x + direction.x * travel, y: position.y + direction.y * travel });
          var moved = distance(position, next); position = next;
          if (moved > .0001) { dx = direction.x; dy = direction.y; }
          if (destination && distance(position, destination) <= .5) {
            position = copy(destination); destination = null; dx = dy = 0;
            if (returning) beginTransition(entry.dry, true);
          } else if (moved < .0001) { destination = null; keys = {}; returning = false; }
        }
      }
      if (depth !== depthGoal) depth += Math.sign(depthGoal - depth) * Math.min(Math.abs(depthGoal - depth), DEPTH_SPEED * dt / 1000);
      notify(!work()); return snapshot();
    }
    function reset() {
      if (dead || !entry || !point(entry.dry)) return false;
      if (mode === 'dry' && !transition) { stop(); return true; }
      try { if (!Town.isWalkable(world, entry.dry.x, entry.dry.y)) return false; } catch (_) { return false; }
      stop(); transition = null; mode = phase = 'dry'; position = copy(entry.dry); depth = depthGoal = 0; notify(true);
      if (typeof options.onExit === 'function') try { options.onExit(copy(position)); } catch (_) {}
      return true;
    }
    function within(target) { for (var n = target; n; n = n.parentNode) if (n === viewport) return true; return false; }
    function interactive(target) {
      for (var n = target; n && n !== viewport; n = n.parentNode) if (/^(BUTTON|INPUT|TEXTAREA|SELECT|A)$/.test(String(n.tagName || '').toUpperCase()) || n.isContentEditable || n.getAttribute && ['button', 'textbox'].indexOf(n.getAttribute('role')) >= 0) return true;
      return false;
    }
    function listen(target, name, fn, settings) {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(name, fn, settings);
      removers.push(function () { if (target.removeEventListener) target.removeEventListener(name, fn, settings); });
    }
    var directions = { arrowup: { x: 0, y: -1 }, w: { x: 0, y: -1 }, arrowdown: { x: 0, y: 1 }, s: { x: 0, y: 1 }, arrowleft: { x: -1, y: 0 }, a: { x: -1, y: 0 }, arrowright: { x: 1, y: 0 }, d: { x: 1, y: 0 } };
    listen(doc, 'keydown', function (event) {
      var key = String(event.key || '').toLowerCase();
      if (!directions[key] || !active() || mode === 'dry' || transition || event.altKey || event.ctrlKey || event.metaKey || event.isComposing || event.repeat && !keys[key]) return;
      if (interactive(event.target) || !within(event.target) && !(doc && within(doc.activeElement))) return;
      if (event.preventDefault) event.preventDefault(); keys[key] = directions[key]; destination = null; returning = false; schedule();
    });
    listen(doc, 'keyup', function (event) {
      var key = String(event.key || '').toLowerCase(); if (!keys[key]) return; delete keys[key];
      if (!Object.keys(keys).length) { dx = dy = 0; notify(true); } schedule();
    });
    listen(viewport, 'pointerdown', function (event) {
      if (event.isPrimary === false) { pointer = null; return; }
      if (!active() || mode === 'dry' || transition || interactive(event.target) || event.button !== undefined && event.button !== 0 || !finite(event.clientX) || !finite(event.clientY)) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false };
    });
    listen(win, 'pointermove', function (event) { if (pointer && event.pointerId === pointer.id && finite(event.clientX) && finite(event.clientY) && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 8) pointer.dragged = true; });
    listen(viewport, 'pointerup', function (event) {
      var tap = pointer; pointer = null;
      if (!tap || tap.id !== event.pointerId || tap.dragged || !active() || interactive(event.target) || !finite(event.clientX) || !finite(event.clientY) || Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 8) return;
      var target;
      try { target = typeof options.resolveTap === 'function' ? options.resolveTap(event, snapshot()) : null; } catch (_) { return; }
      if (!goTo(target)) return;
      if (event.preventDefault) event.preventDefault(); if (viewport && viewport.focus) viewport.focus({ preventScroll: true });
    });
    listen(win, 'pointercancel', stop); listen(win, 'blur', stop); listen(win, 'pagehide', stop);
    listen(doc, 'visibilitychange', function () { if (doc.hidden) stop(); });
    listen(doc, 'focusin', function (event) { if (interactive(event.target) || mode !== 'dry' && !within(event.target)) stop(); });
    listen(viewport, 'focusout', function (event) { if (!within(event.relatedTarget) || interactive(event.relatedTarget)) stop(); });
    function destroy() { if (dead) return; stop(); dead = true; removers.splice(0).forEach(function (remove) { remove(); }); }
    return { habitat: h, enter: enter, dive: dive, surface: surface, exit: exit, stop: stop, snapshot: snapshot, destroy: destroy, step: step, goTo: goTo, reset: reset };
  }
  return Object.freeze({ revision: 'ocean-snorkeling1', createHabitat: createHabitat, isWater: isWater, entryPoint: entryPoint, coastX: coastX,
    creatures: creatures, nearestDiscovery: nearestDiscovery, sweep: sweep, create: create, mount: create, SPEED: SPEED, MAX_DEPTH: DEPTH });
}));

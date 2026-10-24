/* Presentation-only town movement. The pet, inventory and rewards stay in the game core. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.PetTownWalk = factory(root);
}(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (environment) {
  'use strict';

  var WIDTH = 2880, HEIGHT = 1920, RADIUS = 18, SPEED = 200;
  var bank = [[0, 2880], [550, 2840], [1050, 2720], [1450, 2510], [1920, 1990]];
  var defaults = [
    { id: 'home', label: 'おうち', x: 22, y: 23 },
    { id: 'cafe', label: 'カフェ', x: 72, y: 23 },
    { id: 'shop', label: 'マルシェ', x: 22, y: 65 },
    { id: 'playground', label: 'あそびの広場', x: 72, y: 65 },
    { id: 'tree', label: '村の木', x: 48, y: 44 },
    { id: 'flowers', label: '花だん', x: 48, y: 83 }
  ];
  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
  function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
  function point(value) { return !!value && finite(value.x) && finite(value.y); }
  function copy(value) { return { x: value.x, y: value.y }; }
  function facility(id) { return ['home', 'cafe', 'shop', 'playground'].indexOf(id) >= 0; }
  function bankX(y) {
    y = clamp(y, 0, HEIGHT);
    for (var i = 1; i < bank.length; i++) {
      if (y <= bank[i][0]) {
        var a = bank[i - 1], b = bank[i], t = (y - a[0]) / (b[0] - a[0]);
        return a[1] + (b[1] - a[1]) * t;
      }
    }
    return bank[bank.length - 1][1];
  }
  function dryGround(x, y) {
    var bridge = y >= 1070 + RADIUS && y <= 1250 - RADIUS && x >= 2480 + RADIUS && x <= 2810 - RADIUS;
    return x <= bankX(y + RADIUS) - RADIUS || bridge;
  }
  function isWalkable(world, x, y) {
    if (!world || !finite(x) || !finite(y) || x < 28 || y < 28 || x > world.width - 28 || y > world.height - 28 || !dryGround(x, y)) return false;
    return !world.places.some(function (place) {
      var f = place.footprint, dx = (x - f.x) / (f.rx + RADIUS), dy = (y - f.y) / (f.ry + RADIUS);
      return dx * dx + dy * dy < 1;
    });
  }
  function spawn(world, requested) {
    if (point(requested) && isWalkable(world, requested.x, requested.y)) return copy(requested);
    var home = world.places[0], start = { x: home.entrance.x, y: home.entrance.y + 100 };
    if (isWalkable(world, start.x, start.y)) return start;
    // User-arranged buildings may overlap. Find nearby dry ground without altering their save.
    for (var radius = 40; radius <= 1200; radius += 40) {
      for (var angle = 0; angle < 16; angle++) {
        var x = start.x + Math.cos(angle * Math.PI / 8) * radius, y = start.y + Math.sin(angle * Math.PI / 8) * radius;
        if (isWalkable(world, x, y)) return { x: x, y: y };
      }
    }
    return { x: 1440, y: 960 };
  }
  function createWorld(layout) {
    var saved = layout && Array.isArray(layout.items) ? layout.items : [];
    var world = { width: WIDTH, height: HEIGHT, places: [] };
    defaults.forEach(function (spec) {
      var row = saved.filter(function (entry) { return entry && entry.id === spec.id; })[0] || spec;
      var flora = !facility(spec.id), rx = flora ? 48 : 94, ry = flora ? 32 : 68;
      var y = clamp(finite(row.y) ? row.y : spec.y, flora ? 16 : 22, flora ? 84 : 78) / 100 * HEIGHT;
      var x = clamp(finite(row.x) ? row.x : spec.x, 15, 85) / 100 * WIDTH;
      // Keep the whole footprint and its approach on the near bank. Saved percentages remain untouched.
      x = Math.min(x, bankX(y + 70 + RADIUS) - rx - RADIUS - 24);
      world.places.push({ id: spec.id, label: spec.label, x: x, y: y,
        entrance: { x: x, y: y + 70 }, footprint: { x: x, y: y - (flora ? 30 : 52), rx: rx, ry: ry } });
    });
    world.spawn = spawn(world);
    return world;
  }
  function move(world, position, dx, dy) {
    var next = copy(position);
    if (!finite(dx) || !finite(dy)) return next;
    dx = clamp(dx, -WIDTH * 2, WIDTH * 2); dy = clamp(dy, -HEIGHT * 2, HEIGHT * 2);
    var steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 8)), sx = dx / steps, sy = dy / steps;
    for (var i = 0; i < steps; i++) {
      if (isWalkable(world, next.x + sx, next.y + sy)) { next.x += sx; next.y += sy; }
      else {
        if (isWalkable(world, next.x + sx, next.y)) next.x += sx;
        if (isWalkable(world, next.x, next.y + sy)) next.y += sy;
      }
    }
    return next;
  }
  function nearestFacility(world, position, allowedIds) {
    if (!point(position)) return null;
    var nearest = null, distance = 110;
    world.places.forEach(function (place) {
      if (!facility(place.id) || allowedIds && allowedIds.indexOf(place.id) < 0) return;
      var d = Math.hypot(position.x - place.entrance.x, position.y - place.entrance.y);
      if (d <= distance) { nearest = place; distance = d; }
    });
    return nearest;
  }
  function clearSegment(world, a, b) {
    var count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 8));
    for (var i = 1; i <= count; i++) if (!isWalkable(world, a.x + (b.x - a.x) * i / count, a.y + (b.y - a.y) * i / count)) return false;
    return true;
  }
  function route(world, from, to) {
    if (!point(from) || !point(to) || !isWalkable(world, from.x, from.y) || !isWalkable(world, to.x, to.y)) return null;
    if (clearSegment(world, from, to)) return [copy(to)];
    // Six footprints produce at most 26 visibility nodes. Search only on a facility tap.
    var nodes = [copy(from), copy(to)];
    world.places.forEach(function (place) {
      var f = place.footprint;
      [-1, 1].forEach(function (x) { [-1, 1].forEach(function (y) {
        var p = { x: f.x + x * (f.rx + RADIUS + 16), y: f.y + y * (f.ry + RADIUS + 16) };
        if (isWalkable(world, p.x, p.y)) nodes.push(p);
      }); });
    });
    var distances = nodes.map(function () { return Infinity; }), parents = [], visited = [], edges = {};
    distances[0] = 0;
    for (var step = 0; step < nodes.length; step++) {
      var current = -1;
      for (var i = 0; i < nodes.length; i++) if (!visited[i] && (current < 0 || distances[i] < distances[current])) current = i;
      if (current < 0 || distances[current] === Infinity) return null;
      if (current === 1) {
        var path = [], at = 1;
        while (at !== 0) { path.unshift(copy(nodes[at])); at = parents[at]; }
        return path;
      }
      visited[current] = true;
      for (var next = 1; next < nodes.length; next++) {
        if (visited[next] || next === current) continue;
        var key = Math.min(current, next) + ':' + Math.max(current, next);
        if (!Object.prototype.hasOwnProperty.call(edges, key)) edges[key] = clearSegment(world, nodes[current], nodes[next]);
        if (!edges[key]) continue;
        var candidate = distances[current] + Math.hypot(nodes[current].x - nodes[next].x, nodes[current].y - nodes[next].y);
        if (candidate < distances[next]) { distances[next] = candidate; parents[next] = current; }
      }
    }
    return null;
  }
  function camera(world, width, height, position) {
    width = finite(width) && width > 0 ? width : 390;
    height = finite(height) && height > 0 ? height : 700;
    // Never fit the whole map: a viewport sees at most a 960 by 800 neighborhood.
    var scale = Math.max(.72, width / 960, height / 800), anchorY = height <= 560 ? .45 : .58;
    return { x: clamp(position.x - width / scale * .5, 0, Math.max(0, world.width - width / scale)),
      y: clamp(position.y - height / scale * anchorY, 0, Math.max(0, world.height - height / scale)), scale: scale };
  }
  function mount(options) {
    options = options || {};
    var viewport = options.viewport, surface = options.worldElement, avatar = options.avatar;
    var doc = viewport && viewport.ownerDocument || environment.document, win = doc && doc.defaultView || environment;
    var world = options.world || createWorld(), position = spawn(world, options.position);
    var dead = false, raf = null, last = null, keys = {}, pointers = {}, destination = null, waypoints = [], ground = null;
    var removers = [], observer = null, lastMotion = '', view = null;
    var enter = options.enterButton, controls = options.controls || [], enterableIds = Array.isArray(options.enterableIds) ? options.enterableIds.slice() : null;
    function active() {
      if (dead || !viewport || !surface || !avatar || !doc || doc.hidden || viewport.isConnected === false || surface.isConnected === false || avatar.isConnected === false) return false;
      try { return typeof options.canRun !== 'function' || !!options.canRun(); } catch (_) { return false; }
    }
    function callback(name, value) { if (typeof options[name] === 'function') try { options[name](value); } catch (_) {} }
    function listen(target, type, handler, settings) {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(type, handler, settings);
      removers.push(function () { target.removeEventListener(type, handler, settings); });
    }
    function motion(walking, dx, dy) {
      var state = (walking ? '1:' : '0:') + dx.toFixed(3) + ':' + dy.toFixed(3);
      if (!walking && state === lastMotion) return;
      lastMotion = state; callback('onMotion', { walking: walking, dx: dx, dy: dy });
    }
    function draw() {
      if (!active()) return;
      var box = viewport.getBoundingClientRect(), width = box.width || viewport.clientWidth, height = box.height || viewport.clientHeight;
      view = camera(world, width, height, position);
      surface.style.width = world.width + 'px'; surface.style.height = world.height + 'px'; surface.style.transformOrigin = '0 0';
      surface.style.transform = 'translate3d(' + (-view.x * view.scale).toFixed(3) + 'px,' + (-view.y * view.scale).toFixed(3) + 'px,0) scale(' + view.scale.toFixed(6) + ')';
      avatar.style.left = position.x.toFixed(3) + 'px'; avatar.style.top = position.y.toFixed(3) + 'px';
      avatar.style.zIndex = String(Math.round(position.y));
      callback('onDraw', copy(position));
      if (enter) {
        var nearby = nearestFacility(world, position, enterableIds);
        enter.disabled = !nearby; enter.hidden = !nearby;
        if (nearby) { enter.textContent = nearby.label + 'に入る'; enter.setAttribute('aria-label', nearby.label + 'に入る'); }
      }
    }
    function vector() {
      var x = 0, y = 0;
      Object.keys(keys).forEach(function (key) { x += keys[key].x; y += keys[key].y; });
      Object.keys(pointers).forEach(function (id) { x += pointers[id].x; y += pointers[id].y; });
      if ((x || y) && typeof options.projectDirection === 'function') {
        try { var projected = options.projectDirection(x, y); if (point(projected)) { x = projected.x; y = projected.y; } } catch (_) {}
      }
      if (!x && !y && destination) { x = destination.x - position.x; y = destination.y - position.y; }
      var length = Math.hypot(x, y);
      return length > 0 ? { x: x / length, y: y / length, length: length } : { x: 0, y: 0, length: 0 };
    }
    function cancelFrame() {
      if (raf !== null) { if (win.cancelAnimationFrame) win.cancelAnimationFrame(raf); raf = null; }
      last = null;
    }
    function releasePointers() {
      Object.keys(pointers).forEach(function (id) {
        var entry = pointers[id];
        try { if (entry.element.releasePointerCapture) entry.element.releasePointerCapture(Number(id)); } catch (_) {}
      });
      pointers = {};
    }
    function stop() {
      keys = {}; destination = null; waypoints = []; ground = null; releasePointers(); cancelFrame(); motion(false, 0, 0);
    }
    function schedule() {
      if (!active()) { stop(); return; }
      if (!vector().length) { cancelFrame(); motion(false, 0, 0); return; }
      if (raf === null && win.requestAnimationFrame) raf = win.requestAnimationFrame(tick);
    }
    function tick(stamp) {
      raf = null;
      if (!active()) { stop(); return; }
      var direction = vector(), elapsed = last === null ? 0 : clamp(finite(stamp) ? stamp - last : 0, 0, 50);
      last = finite(stamp) ? stamp : null;
      if (!direction.length) { stop(); return; }
      var distance = SPEED * elapsed / 1000;
      if (destination && !Object.keys(keys).length && !Object.keys(pointers).length) distance = Math.min(distance, direction.length);
      var next = move(world, position, direction.x * distance, direction.y * distance), dx = next.x - position.x, dy = next.y - position.y;
      var moved = Math.hypot(dx, dy);
      if (moved > .001) {
        position = next; draw(); callback('onPosition', copy(position)); motion(true, dx / moved, dy / moved);
      }
      if (destination && Math.hypot(destination.x - position.x, destination.y - position.y) <= 1) destination = waypoints.shift() || null;
      if (destination && distance > 0 && moved < .001) { destination = null; waypoints = []; }
      if (distance > 0 && moved < .001) { cancelFrame(); motion(false, 0, 0); return; }
      schedule();
    }
    function focusViewport() { try { viewport.focus({ preventScroll: true }); } catch (_) {} }
    function editing(target) {
      for (var n = target; n; n = n.parentNode) {
        if (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName || '')) return true;
        if (n === viewport) break;
      }
      return false;
    }
    function within(target) { return !!target && (target === viewport || typeof viewport.contains === 'function' && viewport.contains(target)); }
    function keyVector(key) {
      return { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
        a: { x: -1, y: 0 }, d: { x: 1, y: 0 }, w: { x: 0, y: -1 }, s: { x: 0, y: 1 } }[key];
    }
    function keyName(event) { return typeof event.key === 'string' && event.key.length === 1 ? event.key.toLowerCase() : event.key; }
    function prevent(event) { if (event && typeof event.preventDefault === 'function') event.preventDefault(); }
    listen(win, 'keydown', function (event) {
      var name = keyName(event), direction = keyVector(name);
      if (!direction || !active() || event.altKey || event.ctrlKey || event.metaKey || !within(doc.activeElement) || editing(event.target) || editing(doc.activeElement)) return;
      prevent(event); keys[name] = direction; destination = null; waypoints = []; schedule();
    });
    listen(win, 'keyup', function (event) {
      var name = keyName(event);
      if (!Object.prototype.hasOwnProperty.call(keys, name)) return;
      prevent(event); delete keys[name]; schedule();
    });
    controls.forEach(function (control) {
      var element = control.element, skipPointerClick = false;
      if (!element || !finite(control.x) || !finite(control.y)) return;
      listen(element, 'pointerdown', function (event) {
        if (!active() || element.isConnected === false || event.button !== undefined && event.button !== 0) return;
        prevent(event); focusViewport(); destination = null; waypoints = []; ground = null;
        skipPointerClick = true;
        pointers[event.pointerId] = { x: control.x, y: control.y, element: element };
        try { if (element.setPointerCapture) element.setPointerCapture(event.pointerId); } catch (_) {}
        schedule();
      });
      listen(element, 'lostpointercapture', function (event) {
        if (!pointers[event.pointerId]) return;
        delete pointers[event.pointerId]; schedule();
      });
      listen(element, 'click', function (event) {
        if (skipPointerClick && event.detail !== 0) { skipPointerClick = false; prevent(event); return; }
        if (!active() || element.isConnected === false) return;
        var length = Math.hypot(control.x, control.y); if (!length) return;
        prevent(event); stop(); focusViewport();
        destination = { x: position.x + control.x / length * 48, y: position.y + control.y / length * 48 }; schedule();
      });
    });
    function pointerEnd(event) {
      var entry = pointers[event.pointerId];
      if (!entry) return;
      delete pointers[event.pointerId];
      try { if (entry.element.releasePointerCapture) entry.element.releasePointerCapture(event.pointerId); } catch (_) {}
      schedule();
    }
    listen(win, 'pointerup', pointerEnd); listen(win, 'pointercancel', function (event) { ground = null; pointerEnd(event); });
    function interactive(target) {
      for (var n = target; n && n !== viewport; n = n.parentNode) {
        if (/^(BUTTON|INPUT|TEXTAREA|SELECT|A)$/.test(n.tagName || '') || n.isContentEditable || n.getAttribute && n.getAttribute('role') === 'button') return true;
      }
      return false;
    }
    listen(viewport, 'pointerdown', function (event) {
      if (!active() || interactive(event.target) || event.isPrimary === false || event.button !== undefined && event.button !== 0 || !finite(event.clientX) || !finite(event.clientY)) return;
      ground = { id: event.pointerId, x: event.clientX, y: event.clientY };
    });
    listen(viewport, 'pointerup', function (event) {
      var tap = ground; ground = null;
      if (!tap || tap.id !== event.pointerId || !active() || interactive(event.target) || !view || !finite(event.clientX) || !finite(event.clientY) || Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 10) return;
      var box = viewport.getBoundingClientRect(), target = { x: (event.clientX - box.left) / view.scale + view.x, y: (event.clientY - box.top) / view.scale + view.y };
      if (typeof options.resolveTap === 'function') {
        try { target = options.resolveTap(event, view); } catch (_) { return; }
        if (target && typeof target.placeId === 'string') { approach(target.placeId); return; }
      }
      if (!point(target)) return;
      if (!isWalkable(world, target.x, target.y)) return;
      prevent(event); focusViewport(); keys = {}; releasePointers(); destination = target; waypoints = []; schedule();
    });
    listen(viewport, 'focusout', function (event) { if (!within(event.relatedTarget)) stop(); });
    listen(win, 'blur', stop); listen(win, 'pagehide', stop);
    listen(doc, 'visibilitychange', function () { if (doc.hidden) stop(); else draw(); });
    listen(enter, 'click', function () {
      if (!active() || enter.isConnected === false || enter.disabled || enter.hidden) return;
      var nearby = nearestFacility(world, position, enterableIds);
      if (!nearby) return;
      stop(); callback('onEnter', nearby.id);
    });
    if (win.ResizeObserver) {
      observer = new win.ResizeObserver(function () { if (!dead) draw(); }); observer.observe(viewport);
    } else listen(win, 'resize', draw);
    draw();
    function approach(id) {
      if (!active()) return false;
      var place = world.places.filter(function (row) { return row.id === id; })[0];
      if (!place || !isWalkable(world, place.entrance.x, place.entrance.y)) return false;
      var path = route(world, position, place.entrance);
      if (!path) return false;
      stop(); destination = path.shift(); waypoints = path; focusViewport(); schedule(); return true;
    }
    return {
      destroy: function () { if (dead) return; stop(); dead = true; if (observer) observer.disconnect(); removers.forEach(function (remove) { remove(); }); removers = []; },
      approach: approach,
      stop: stop,
      position: function () { return copy(position); }
    };
  }
  return Object.freeze({ createWorld: createWorld, mount: mount, isWalkable: isWalkable, move: move,
    nearestFacility: nearestFacility, camera: camera, spawn: spawn, route: route });
}));
